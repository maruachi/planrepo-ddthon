import { randomUUID } from 'node:crypto';
import type { ArtifactVersionRef, EntityRef, SrScope, VersionRef } from '@/src/contracts/context';
import type {
  ArtifactTargetBasis,
  DocumentKind,
  GenerationInput,
  GenerationTaskKind,
  InputSnapshot,
  SnapshotContentItem,
} from '@/src/contracts/views';
import {
  canonicalJson,
  GENERATION_INPUT_MAX_BYTES,
  GenerationInputTooLargeError,
  type PreparedGenerationSnapshot,
} from '@/src/application/generation-snapshot';
import type { GenerationBasis } from '@/src/persistence/generation-input-repository';
import type { DatabaseConnection } from '@/src/persistence/database';
import type { ProjectRuleSnapshot } from '@/src/runtime/project-rule-source';
import { generationSourceRefKey } from '@/src/contracts/generation-source-refs';

export class InputSnapshotRepositoryError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CORRUPT_DATA', message: string) {
    super(message);
    this.name = 'InputSnapshotRepositoryError';
  }
}

interface SnapshotRow {
  readonly project_id: string;
  readonly sr_id: string;
  readonly snapshot_id: string;
  readonly workflow_version: string;
  readonly task_kind: string;
  readonly content_fingerprint: string;
  readonly contents_json: string;
  readonly project_rules_json: string;
  readonly captured_at: string;
  readonly document_kind: string | null;
  readonly target_basis_json: string | null;
  readonly supplement: string | null;
}

function corrupt(message: string): never {
  throw new InputSnapshotRepositoryError('CORRUPT_DATA', message);
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return corrupt(`${label} JSON이 올바르지 않습니다.`);
  }
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return corrupt(`${label}가 객체가 아닙니다.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) return corrupt(`${label}가 비었습니다.`);
  return value;
}

function taskKind(value: unknown): GenerationTaskKind {
  if (
    value !== 'QUESTION_PROPOSALS' && value !== 'DECISION_PROPOSALS' &&
    value !== 'ARTIFACT_DRAFT' && value !== 'ARTIFACT_REVISION'
  ) return corrupt('snapshot taskKind가 올바르지 않습니다.');
  return value;
}

function documentKind(value: unknown): DocumentKind {
  if (
    value !== 'requirements' && value !== 'workflow_plan' &&
    value !== 'design' && value !== 'implementation_plan'
  ) return corrupt('snapshot documentKind가 올바르지 않습니다.');
  return value;
}

function artifactRef(value: unknown, scope: SrScope): ArtifactVersionRef {
  const ref = object(value, 'snapshot artifact ref');
  if (
    ref.kind !== 'artifact' || ref.projectId !== scope.projectId || ref.srId !== scope.srId ||
    typeof ref.entityId !== 'string' || !Number.isInteger(ref.version) || Number(ref.version) < 1
  ) return corrupt('snapshot artifact ref 범위가 올바르지 않습니다.');
  return {
    kind: 'artifact', projectId: scope.projectId, srId: scope.srId,
    entityId: ref.entityId, version: Number(ref.version),
  };
}

function targetBasis(raw: string, task: GenerationTaskKind, scope: SrScope): ArtifactTargetBasis {
  const value = object(parseJson(raw, 'snapshot target basis'), 'snapshot target basis');
  if (task === 'ARTIFACT_DRAFT') {
    if (value.kind !== 'absent' || typeof value.logicalKey !== 'string' || value.logicalKey.length === 0) {
      return corrupt('snapshot absent target이 올바르지 않습니다.');
    }
    return { kind: 'absent', logicalKey: value.logicalKey };
  }
  if (task !== 'ARTIFACT_REVISION' || value.kind !== 'version') {
    return corrupt('snapshot version target이 올바르지 않습니다.');
  }
  return { kind: 'version', ref: artifactRef(value.ref, scope) };
}

const SR_ENTITY_KINDS = new Set([
  'sr', 'sr_description', 'context_source', 'artifact', 'question', 'question_answer',
  'question_result', 'decision', 'scope_classification', 'review_assignment', 'handoff',
]);

const SR_VERSION_KINDS = new Set([
  'sr_description', 'context_source', 'artifact', 'question_answer', 'question_result',
  'decision', 'scope_classification', 'review_assignment', 'handoff',
]);

function versionRef(value: unknown, scope: SrScope): VersionRef | EntityRef {
  const ref = object(value, 'snapshot content ref');
  if (ref.projectId !== scope.projectId || (ref.srId !== undefined && ref.srId !== scope.srId)) {
    return corrupt('snapshot content ref 범위가 올바르지 않습니다.');
  }
  if (typeof ref.kind !== 'string' || typeof ref.entityId !== 'string') {
    return corrupt('snapshot content ref가 올바르지 않습니다.');
  }
  if (ref.kind === 'review_policy') {
    if (
      ref.srId !== undefined || !Number.isInteger(ref.version) || Number(ref.version) < 1
    ) return corrupt('snapshot policy ref가 올바르지 않습니다.');
    return {
      kind: 'review_policy', projectId: scope.projectId,
      entityId: ref.entityId, version: Number(ref.version),
    };
  }
  if (ref.srId !== scope.srId) return corrupt('snapshot SR content ref가 올바르지 않습니다.');
  if (!SR_ENTITY_KINDS.has(ref.kind)) return corrupt('snapshot content ref kind가 올바르지 않습니다.');
  const base = {
    projectId: scope.projectId, srId: scope.srId, entityId: ref.entityId,
  };
  if (ref.version === undefined) return { kind: ref.kind, ...base } as EntityRef;
  if (
    !SR_VERSION_KINDS.has(ref.kind) ||
    !Number.isInteger(ref.version) || Number(ref.version) < 1
  ) return corrupt('snapshot content ref version이 올바르지 않습니다.');
  return { kind: ref.kind, ...base, version: Number(ref.version) } as VersionRef;
}

export function decodeSnapshotContents(raw: string, scope: SrScope): readonly SnapshotContentItem[] {
  const value = parseJson(raw, 'snapshot contents');
  if (!Array.isArray(value)) return corrupt('snapshot contents가 배열이 아닙니다.');
  return value.map((entry) => {
    const item = object(entry, 'snapshot content');
    if (
      typeof item.content !== 'string' ||
      (item.confirmation !== 'confirmed' && item.confirmation !== 'unconfirmed' && item.confirmation !== 'not_applicable')
    ) return corrupt('snapshot content가 올바르지 않습니다.');
    return { ref: versionRef(item.ref, scope), content: item.content, confirmation: item.confirmation };
  });
}

function projectRules(raw: string): InputSnapshot['projectRules'] {
  const value = parseJson(raw, 'snapshot project rules');
  if (!Array.isArray(value)) return corrupt('snapshot project rules가 배열이 아닙니다.');
  const ids = new Set<string>();
  return value.map((entry) => {
    const rule = object(entry, 'snapshot project rule');
    const logicalId = text(rule.logicalId, 'snapshot rule logicalId');
    if (ids.has(logicalId)) return corrupt('snapshot rule logicalId가 중복됐습니다.');
    ids.add(logicalId);
    return {
      logicalId,
      version: text(rule.version, 'snapshot rule version'),
      content: text(rule.content, 'snapshot rule content'),
    };
  });
}

export function snapshotContents(
  basis: GenerationBasis,
  basisRefs: readonly VersionRef[] = [],
): readonly SnapshotContentItem[] {
  const participantRef: EntityRef<'sr'> = {
    kind: 'sr', projectId: basis.scope.projectId, srId: basis.scope.srId, entityId: basis.scope.srId,
  };
  const primary: readonly SnapshotContentItem[] = [
    { ref: participantRef, content: canonicalJson({ participants: basis.participants }), confirmation: 'not_applicable' },
    { ref: basis.currentDescription.ref, content: canonicalJson(basis.currentDescription), confirmation: 'not_applicable' },
    ...basis.sources.map((source) => ({
      ref: source.ref,
      content: canonicalJson(source),
      confirmation: source.confirmation,
    })),
    ...basis.questions.map((question) => ({
      ref: question.resultRef, content: canonicalJson(question), confirmation: 'not_applicable' as const,
    })),
    ...basis.decisions.map((decision) => ({
      ref: decision.currentVersion?.ref ?? {
        kind: 'decision' as const,
        projectId: basis.scope.projectId,
        srId: basis.scope.srId,
        entityId: decision.definition.decisionId,
      },
      content: canonicalJson(decision),
      confirmation: decision.currentVersion === null ? 'unconfirmed' as const : 'confirmed' as const,
    })),
    ...basis.classifications.map((classification) => ({
      ref: classification.ref, content: canonicalJson(classification), confirmation: 'not_applicable' as const,
    })),
    ...basis.artifacts.map((artifact) => ({
      ref: artifact.ref, content: canonicalJson(artifact), confirmation: 'not_applicable' as const,
    })),
  ];
  const primaryRefs = new Set(
    primary.flatMap((item) => 'version' in item.ref ? [generationSourceRefKey(item.ref)] : []),
  );
  return [
    ...primary,
    ...basisRefs
      .filter((ref) => !primaryRefs.has(generationSourceRefKey(ref)))
      .map((ref) => ({
        ref,
        content: canonicalJson({ kind: 'referenced_input' }),
        confirmation: 'not_applicable' as const,
      })),
  ];
}

export function insertInputSnapshot(
  db: DatabaseConnection,
  input: {
    readonly basis: GenerationBasis;
    readonly prepared: PreparedGenerationSnapshot;
    readonly projectRules: ProjectRuleSnapshot;
    readonly capturedAt: string;
    readonly snapshotId?: string;
  },
): InputSnapshot {
  const snapshotId = input.snapshotId ?? `snapshot-${randomUUID()}`;
  const generation = input.prepared.input;
  const storedContents = snapshotContents(input.basis, input.prepared.basisRefs);
  const serializedSnapshot = JSON.stringify({
    scope: input.basis.scope,
    snapshotId,
    workflowVersion: input.basis.workflowVersion,
    contentFingerprint: input.prepared.contentFingerprint,
    contents: storedContents,
    projectRules: input.projectRules,
    ...(generation.supplement === undefined ? {} : { supplement: generation.supplement }),
    capturedAt: input.capturedAt,
    taskKind: generation.taskKind,
    ...('documentKind' in generation ? { documentKind: generation.documentKind } : {}),
    ...('targetBasis' in generation ? { targetBasis: generation.targetBasis } : {}),
  });
  if (Buffer.byteLength(serializedSnapshot, 'utf8') > GENERATION_INPUT_MAX_BYTES) {
    throw new GenerationInputTooLargeError(
      `명시 InputSnapshot은 UTF-8 ${GENERATION_INPUT_MAX_BYTES} bytes를 넘을 수 없습니다.`,
    );
  }
  db.prepare(
    `INSERT INTO input_snapshots(
       project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
       contents_json,project_rules_json,captured_at,document_kind,target_basis_json,supplement
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.basis.scope.projectId,
    input.basis.scope.srId,
    snapshotId,
    input.basis.workflowVersion,
    generation.taskKind,
    input.prepared.contentFingerprint,
    JSON.stringify(storedContents),
    JSON.stringify(input.projectRules),
    input.capturedAt,
    'documentKind' in generation ? generation.documentKind : null,
    'targetBasis' in generation ? JSON.stringify(generation.targetBasis) : null,
    generation.supplement ?? null,
  );
  const stored = readInputSnapshot(db, input.basis.scope, snapshotId);
  if (stored === undefined) return corrupt('저장한 input snapshot을 읽을 수 없습니다.');
  return stored;
}

export function readInputSnapshot(
  db: DatabaseConnection,
  scope: SrScope,
  snapshotId: string,
): InputSnapshot | undefined {
  const row = db.prepare(
    `SELECT project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
            contents_json,project_rules_json,captured_at,document_kind,target_basis_json,supplement
       FROM input_snapshots WHERE project_id=? AND sr_id=? AND snapshot_id=?`,
  ).get(scope.projectId, scope.srId, snapshotId) as SnapshotRow | undefined;
  if (row === undefined) return undefined;
  if (row.workflow_version !== 'v1.0.1') return corrupt('snapshot workflow version이 올바르지 않습니다.');
  const task = taskKind(row.task_kind);
  const base = {
    scope,
    snapshotId: text(row.snapshot_id, 'snapshot ID'),
    workflowVersion: 'v1.0.1' as const,
    contentFingerprint: text(row.content_fingerprint, 'snapshot fingerprint'),
    contents: decodeSnapshotContents(row.contents_json, scope),
    projectRules: projectRules(row.project_rules_json),
    ...(row.supplement === null ? {} : { supplement: row.supplement }),
    capturedAt: text(row.captured_at, 'snapshot capturedAt'),
  };
  if (task === 'QUESTION_PROPOSALS' || task === 'DECISION_PROPOSALS') {
    if (row.document_kind !== null || row.target_basis_json !== null) {
      return corrupt('질문·결정 snapshot에 문서 target이 섞였습니다.');
    }
    return { ...base, taskKind: task };
  }
  if (row.document_kind === null || row.target_basis_json === null) {
    return corrupt('문서 snapshot target이 없습니다.');
  }
  const kind = documentKind(row.document_kind);
  const target = targetBasis(row.target_basis_json, task, scope);
  if (task === 'ARTIFACT_DRAFT') {
    if (target.kind !== 'absent') return corrupt('draft snapshot target 종류가 다릅니다.');
    return { ...base, taskKind: 'ARTIFACT_DRAFT', documentKind: kind, targetBasis: target };
  }
  if (target.kind !== 'version') return corrupt('revision snapshot target 종류가 다릅니다.');
  return { ...base, taskKind: 'ARTIFACT_REVISION', documentKind: kind, targetBasis: target };
}

export function inputFromSnapshot(snapshot: InputSnapshot): GenerationInput {
  const supplement = snapshot.supplement === undefined ? {} : { supplement: snapshot.supplement };
  if (snapshot.taskKind === 'QUESTION_PROPOSALS' || snapshot.taskKind === 'DECISION_PROPOSALS') {
    return { taskKind: snapshot.taskKind, ...supplement };
  }
  if (snapshot.taskKind === 'ARTIFACT_DRAFT') {
    if (snapshot.documentKind === undefined || snapshot.targetBasis?.kind !== 'absent') {
      return corrupt('draft snapshot 입력이 올바르지 않습니다.');
    }
    return {
      taskKind: 'ARTIFACT_DRAFT', documentKind: snapshot.documentKind,
      targetBasis: snapshot.targetBasis, ...supplement,
    };
  }
  if (snapshot.documentKind === undefined || snapshot.targetBasis?.kind !== 'version') {
    return corrupt('revision snapshot 입력이 올바르지 않습니다.');
  }
  return {
    taskKind: 'ARTIFACT_REVISION',
    documentKind: snapshot.documentKind,
    targetBasis: snapshot.targetBasis,
    ...supplement,
  };
}
