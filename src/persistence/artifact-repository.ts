import { randomUUID } from 'node:crypto';
import type {
  ArtifactVersionRef,
  DecisionVersionRef,
  QuestionResultSnapshotRef,
  ContextSourceVersionRef,
  SrScope,
} from '@/src/contracts/context';
import type {
  ArtifactEdit,
  ArtifactView,
  RequirementLink,
  SectionIndexEntry,
  WorkflowPlanEdit,
  WorkflowPlanView,
} from '@/src/contracts/views';
import { artifactLogicalTarget, parseArtifactLogicalKey } from '@/src/domain/artifact-target';
import type { DatabaseConnection } from '@/src/persistence/database';

export type ArtifactRepositoryErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'CORRUPT_DATA';

export class ArtifactRepositoryError extends Error {
  constructor(readonly code: ArtifactRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'ArtifactRepositoryError';
  }
}

export interface StoredArtifactVersion {
  readonly scope: SrScope;
  readonly artifactId: string;
  readonly kind: ArtifactView['kind'];
  readonly designStage?: 'application' | 'functional' | 'nfr' | 'infrastructure';
  readonly versionRef: ArtifactVersionRef;
  readonly markdown: string;
  readonly sectionIndex: readonly SectionIndexEntry[];
  readonly requirementLinks: readonly RequirementLink[];
  readonly authorOrigin: 'human' | 'ai_applied';
  readonly authorId: string;
  readonly createdAt: string;
  readonly changeSummary: string;
  readonly previousVersionRef?: ArtifactVersionRef;
  readonly draftApplicationId?: string;
  readonly inputSnapshotId?: string;
  readonly decisionRefs: readonly DecisionVersionRef[];
  readonly sourceRefs: readonly ContextSourceVersionRef[];
  readonly questionResultRefs: readonly QuestionResultSnapshotRef[];
  readonly revision: number;
  readonly workflow?: {
    readonly workflowVersion: 'v1.0.1';
    readonly stages: WorkflowPlanEdit['stages'];
    readonly implementationUnitCount: 1;
    readonly requirementTaskLinks: WorkflowPlanEdit['requirementTaskLinks'];
  };
}

export interface StoreArtifactInput {
  readonly scope: SrScope;
  readonly edit: ArtifactEdit | WorkflowPlanEdit;
  readonly authorOrigin: 'human' | 'ai_applied';
  readonly authorId: string;
  readonly createdAt: string;
  readonly draftApplicationId?: string;
  readonly inputSnapshotId?: string;
}

export function insertArtifactActivity(
  db: DatabaseConnection,
  input: {
    readonly scope: SrScope;
    readonly actorId: string;
    readonly occurredAt: string;
    readonly receiptId: string;
    readonly targetRefs: readonly object[];
    readonly eventType: string;
    readonly description: string;
  },
): void {
  db.prepare(
    `INSERT INTO activity_events(
       project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
       occurred_at,receipt_id,internal_basis_json,description,payload_json
     ) VALUES (?,?,?,?,'user',?,?,?, ?,NULL,?,'{}')`,
  ).run(
    input.scope.projectId,
    `activity-${randomUUID()}`,
    input.scope.srId,
    input.eventType,
    input.actorId,
    JSON.stringify(input.targetRefs),
    input.occurredAt,
    input.receiptId,
    input.description,
  );
}

interface ArtifactRow {
  readonly project_id: string;
  readonly sr_id: string;
  readonly artifact_id: string;
  readonly kind: ArtifactView['kind'];
  readonly current_version: number;
  readonly revision: number;
  readonly design_stage: 'application' | 'functional' | 'nfr' | 'infrastructure' | null;
  readonly version: number;
  readonly markdown: string;
  readonly section_index_json: string;
  readonly requirement_links_json: string;
  readonly author_origin: 'human' | 'ai_applied';
  readonly author_id: string;
  readonly created_at: string;
  readonly change_summary: string;
  readonly previous_version: number | null;
  readonly draft_application_id: string | null;
  readonly input_snapshot_id: string | null;
  readonly payload_json: string;
}

function fail(code: ArtifactRepositoryErrorCode, message: string): never {
  throw new ArtifactRepositoryError(code, message);
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return fail('CORRUPT_DATA', `${label} JSON이 올바르지 않습니다.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('CORRUPT_DATA', `${label}가 객체가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

function parseArray(raw: string, label: string): readonly unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return fail('CORRUPT_DATA', `${label} JSON이 올바르지 않습니다.`);
  }
  if (!Array.isArray(value)) return fail('CORRUPT_DATA', `${label}가 배열이 아닙니다.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) return fail('CORRUPT_DATA', `${label}가 비었습니다.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) return fail('CORRUPT_DATA', `${label}가 올바르지 않습니다.`);
  return Number(value);
}

function versionRef<K extends 'decision' | 'context_source' | 'question_result'>(
  value: unknown,
  expectedKind: K,
  projectId: string,
  srId: string,
): Extract<DecisionVersionRef | ContextSourceVersionRef | QuestionResultSnapshotRef, { kind: K }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('CORRUPT_DATA', '문서 추적 ref가 객체가 아닙니다.');
  }
  const ref = value as Record<string, unknown>;
  if (
    ref.kind !== expectedKind || ref.projectId !== projectId || ref.srId !== srId ||
    typeof ref.entityId !== 'string'
  ) return fail('CORRUPT_DATA', '문서 추적 ref 범위가 올바르지 않습니다.');
  return {
    kind: expectedKind,
    projectId,
    srId,
    entityId: ref.entityId,
    version: positiveInteger(ref.version, '문서 추적 ref version'),
  } as Extract<DecisionVersionRef | ContextSourceVersionRef | QuestionResultSnapshotRef, { kind: K }>;
}

function sectionIndex(raw: string): readonly SectionIndexEntry[] {
  return parseArray(raw, 'sectionIndex').map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('CORRUPT_DATA', 'sectionIndex 항목이 객체가 아닙니다.');
    }
    const item = value as Record<string, unknown>;
    if (!Number.isInteger(item.startOffset) || !Number.isInteger(item.endOffset)) {
      return fail('CORRUPT_DATA', 'sectionIndex 범위가 올바르지 않습니다.');
    }
    return {
      sectionId: string(item.sectionId, 'sectionId'),
      title: string(item.title, 'section title'),
      startOffset: Number(item.startOffset),
      endOffset: Number(item.endOffset),
    };
  });
}

function requirementLinks(raw: string): readonly RequirementLink[] {
  return parseArray(raw, 'requirementLinks').map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('CORRUPT_DATA', 'requirementLink 항목이 객체가 아닙니다.');
    }
    const item = value as Record<string, unknown>;
    if (!Array.isArray(item.sectionIds) || !Array.isArray(item.acceptanceCriteria)) {
      return fail('CORRUPT_DATA', 'requirementLink 배열이 올바르지 않습니다.');
    }
    const sectionIds = item.sectionIds.map((entry) => string(entry, 'requirement sectionId'));
    const firstSection = sectionIds[0];
    if (firstSection === undefined) return fail('CORRUPT_DATA', 'requirement sectionIds가 비었습니다.');
    return {
      requirementId: string(item.requirementId, 'requirementId'),
      sectionIds: [firstSection, ...sectionIds.slice(1)],
      acceptanceCriteria: item.acceptanceCriteria.map((entry) => string(entry, 'acceptance criterion')),
    };
  });
}

function ensureStoredArtifactRelations(db: DatabaseConnection, artifact: StoredArtifactVersion): void {
  const sectionIds = artifact.sectionIndex.map(({ sectionId }) => sectionId);
  const requirementIds = artifact.requirementLinks.map(({ requirementId }) => requirementId);
  if (new Set(sectionIds).size !== sectionIds.length || new Set(requirementIds).size !== requirementIds.length) {
    return fail('CORRUPT_DATA', '저장된 문서 항목 ID가 중복됩니다.');
  }
  const knownSections = new Set(sectionIds);
  let previousEnd = -1;
  for (const section of artifact.sectionIndex) {
    if (
      section.startOffset < 0 || section.endOffset <= section.startOffset ||
      section.endOffset > artifact.markdown.length || section.startOffset < previousEnd
    ) return fail('CORRUPT_DATA', '저장된 문서 section 범위가 올바르지 않습니다.');
    previousEnd = section.endOffset;
  }
  for (const link of artifact.requirementLinks) {
    if (
      new Set(link.sectionIds).size !== link.sectionIds.length ||
      link.sectionIds.some((sectionId) => !knownSections.has(sectionId)) ||
      link.acceptanceCriteria.length === 0 ||
      link.acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
    ) return fail('CORRUPT_DATA', '저장된 문서 requirement 관계가 올바르지 않습니다.');
  }
  const refGroups = [
    { table: 'decision_versions', idColumn: 'decision_id', refs: artifact.decisionRefs },
    { table: 'context_source_versions', idColumn: 'source_id', refs: artifact.sourceRefs },
    { table: 'question_result_snapshots', idColumn: 'question_id', refs: artifact.questionResultRefs },
  ];
  for (const group of refGroups) {
    const keys = group.refs.map((ref) => `${ref.entityId}\u0000${ref.version}`);
    if (new Set(keys).size !== keys.length) return fail('CORRUPT_DATA', '저장된 문서 추적 ref가 중복됩니다.');
    for (const ref of group.refs) {
      const exists = db.prepare(
        `SELECT 1 FROM ${group.table}
          WHERE project_id=? AND sr_id=? AND ${group.idColumn}=? AND version=?`,
      ).get(ref.projectId, ref.srId, ref.entityId, ref.version);
      if (exists === undefined) return fail('CORRUPT_DATA', '저장된 문서 추적 ref 대상이 없습니다.');
    }
  }
}

function workflowStages(
  db: DatabaseConnection,
  raw: string,
  projectId: string,
  srId: string,
): WorkflowPlanEdit['stages'] {
  const values = parseArray(raw, 'workflow stages');
  const stages = values.map((value): WorkflowPlanEdit['stages'][number] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('CORRUPT_DATA', 'workflow stage가 객체가 아닙니다.');
    }
    const stage = value as Record<string, unknown>;
    const stageId = string(stage.stageId, 'workflow stageId');
    if (stage.choice === 'skipped') {
      return { stageId, choice: 'skipped', reason: string(stage.reason, 'workflow skip reason') };
    }
    if (stage.choice !== 'executed' || !Array.isArray(stage.designArtifactRefs)) {
      return fail('CORRUPT_DATA', 'workflow stage choice가 올바르지 않습니다.');
    }
    const refs = stage.designArtifactRefs.map((entry): ArtifactVersionRef => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return fail('CORRUPT_DATA', 'workflow design artifact ref가 객체가 아닙니다.');
      }
      const ref = entry as Record<string, unknown>;
      if (
        ref.kind !== 'artifact' || ref.projectId !== projectId || ref.srId !== srId ||
        typeof ref.entityId !== 'string'
      ) return fail('CORRUPT_DATA', 'workflow design artifact ref 범위가 올바르지 않습니다.');
      const version = positiveInteger(ref.version, 'workflow design artifact version');
      const exists = db.prepare(
        `SELECT 1 FROM artifact_versions
          WHERE project_id=? AND sr_id=? AND artifact_id=? AND version=? AND kind='design'`,
      ).get(projectId, srId, ref.entityId, version);
      if (exists === undefined) return fail('CORRUPT_DATA', 'workflow design artifact ref 대상이 없습니다.');
      return { kind: 'artifact', projectId, srId, entityId: ref.entityId, version };
    });
    const [first, ...rest] = refs;
    if (first === undefined) return fail('CORRUPT_DATA', 'executed workflow stage의 design ref가 비었습니다.');
    return { stageId, choice: 'executed', designArtifactRefs: [first, ...rest] };
  });
  const [first, ...rest] = stages;
  if (first === undefined) return fail('CORRUPT_DATA', 'workflow stages가 비었습니다.');
  return [first, ...rest];
}

function workflowTasks(raw: string): WorkflowPlanEdit['requirementTaskLinks'] {
  const values = parseArray(raw, 'workflow requirementTaskLinks');
  const tasks = values.map((value): WorkflowPlanEdit['requirementTaskLinks'][number] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('CORRUPT_DATA', 'workflow task가 객체가 아닙니다.');
    }
    const task = value as Record<string, unknown>;
    if (!Array.isArray(task.requirementIds) || !Array.isArray(task.verification)) {
      return fail('CORRUPT_DATA', 'workflow task 배열이 올바르지 않습니다.');
    }
    const requirementIds = task.requirementIds.map((entry) => string(entry, 'workflow requirement ID'));
    const verification = task.verification.map((entry) => string(entry, 'workflow verification'));
    const [firstRequirement, ...otherRequirements] = requirementIds;
    const [firstVerification, ...otherVerification] = verification;
    if (firstRequirement === undefined || firstVerification === undefined) {
      return fail('CORRUPT_DATA', 'workflow task의 requirement 또는 verification이 비었습니다.');
    }
    return {
      taskId: string(task.taskId, 'workflow taskId'),
      requirementIds: [firstRequirement, ...otherRequirements],
      verification: [firstVerification, ...otherVerification],
      order: positiveInteger(task.order, 'workflow task order'),
    };
  });
  const [first, ...rest] = tasks;
  if (first === undefined) return fail('CORRUPT_DATA', 'workflow tasks가 비었습니다.');
  return [first, ...rest];
}

function mapRow(db: DatabaseConnection, row: ArtifactRow): StoredArtifactVersion {
  if (row.version < 1 || row.revision < 0) return fail('CORRUPT_DATA', '문서 version 또는 revision이 올바르지 않습니다.');
  if (
    (row.version === 1 && row.previous_version !== null) ||
    (row.version > 1 && row.previous_version !== row.version - 1)
  ) return fail('CORRUPT_DATA', '문서 이전 version 연결이 올바르지 않습니다.');
  if ((row.kind === 'design') !== (row.design_stage !== null)) {
    return fail('CORRUPT_DATA', '문서 종류와 설계 단계가 일치하지 않습니다.');
  }
  const payload = parseObject(row.payload_json, 'artifact payload');
  const parseRefs = <K extends 'decision' | 'context_source' | 'question_result'>(
    key: string,
    kind: K,
  ) => {
    const raw = payload[key];
    if (!Array.isArray(raw)) return fail('CORRUPT_DATA', `${key}가 배열이 아닙니다.`);
    return raw.map((value) => versionRef(value, kind, row.project_id, row.sr_id));
  };
  const base: StoredArtifactVersion = {
    scope: { kind: 'sr', projectId: row.project_id, srId: row.sr_id },
    artifactId: row.artifact_id,
    kind: row.kind,
    ...(row.design_stage === null ? {} : { designStage: row.design_stage }),
    versionRef: {
      kind: 'artifact', projectId: row.project_id, srId: row.sr_id,
      entityId: row.artifact_id, version: row.version,
    },
    markdown: row.markdown,
    sectionIndex: sectionIndex(row.section_index_json),
    requirementLinks: requirementLinks(row.requirement_links_json),
    authorOrigin: row.author_origin,
    authorId: row.author_id,
    createdAt: row.created_at,
    changeSummary: row.change_summary,
    ...(row.previous_version === null ? {} : {
      previousVersionRef: {
        kind: 'artifact', projectId: row.project_id, srId: row.sr_id,
        entityId: row.artifact_id, version: row.previous_version,
      },
    }),
    ...(row.draft_application_id === null ? {} : { draftApplicationId: row.draft_application_id }),
    ...(row.input_snapshot_id === null ? {} : { inputSnapshotId: row.input_snapshot_id }),
    decisionRefs: parseRefs('decisionRefs', 'decision'),
    sourceRefs: parseRefs('sourceRefs', 'context_source'),
    questionResultRefs: parseRefs('questionResultRefs', 'question_result'),
    revision: row.revision,
  };
  ensureStoredArtifactRelations(db, base);
  if (row.kind !== 'workflow_plan') return base;
  const workflow = db.prepare(
    `SELECT workflow_version,stages_json,implementation_unit_count,requirement_task_links_json
       FROM workflow_plan_versions
      WHERE project_id=? AND sr_id=? AND artifact_id=? AND version=?`,
  ).get(row.project_id, row.sr_id, row.artifact_id, row.version) as {
    workflow_version: string; stages_json: string; implementation_unit_count: number;
    requirement_task_links_json: string;
  } | undefined;
  if (workflow === undefined || workflow.workflow_version !== 'v1.0.1' || workflow.implementation_unit_count !== 1) {
    return fail('CORRUPT_DATA', 'WorkflowPlan 구조를 찾을 수 없습니다.');
  }
  const stored: StoredArtifactVersion = {
    ...base,
    workflow: {
      workflowVersion: 'v1.0.1',
      stages: workflowStages(db, workflow.stages_json, row.project_id, row.sr_id),
      implementationUnitCount: 1,
      requirementTaskLinks: workflowTasks(workflow.requirement_task_links_json),
    },
  };
  const stageIds = stored.workflow?.stages.map(({ stageId }) => stageId) ?? [];
  const taskIds = stored.workflow?.requirementTaskLinks.map(({ taskId }) => taskId) ?? [];
  const taskOrders = stored.workflow?.requirementTaskLinks.map(({ order }) => order) ?? [];
  const requirementIds = new Set(stored.requirementLinks.map(({ requirementId }) => requirementId));
  if (
    new Set(stageIds).size !== stageIds.length ||
    new Set(taskIds).size !== taskIds.length ||
    new Set(taskOrders).size !== taskOrders.length ||
    stored.workflow?.requirementTaskLinks.some(({ requirementIds: linkedIds }) =>
      linkedIds.some((requirementId) => !requirementIds.has(requirementId)),
    ) === true
  ) {
    return fail('CORRUPT_DATA', '저장된 WorkflowPlan 관계가 올바르지 않습니다.');
  }
  return stored;
}

const selectVersion = `SELECT a.project_id,a.sr_id,a.artifact_id,a.kind,a.current_version,
       a.revision,a.design_stage,v.version,v.markdown,v.section_index_json,
       v.requirement_links_json,v.author_origin,v.author_id,v.created_at,v.change_summary,
       v.previous_version,v.draft_application_id,v.input_snapshot_id,v.payload_json
  FROM artifacts a JOIN artifact_versions v
    ON v.project_id=a.project_id AND v.sr_id=a.sr_id AND v.artifact_id=a.artifact_id
   AND v.kind=a.kind`;

export function readArtifactVersion(
  db: DatabaseConnection,
  ref: ArtifactVersionRef,
): StoredArtifactVersion | undefined {
  const row = db.prepare(
    `${selectVersion} WHERE a.project_id=? AND a.sr_id=? AND a.artifact_id=? AND v.version=?`,
  ).get(ref.projectId, ref.srId, ref.entityId, ref.version) as ArtifactRow | undefined;
  return row === undefined ? undefined : mapRow(db, row);
}

export function readCurrentArtifacts(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): readonly StoredArtifactVersion[] {
  const rows = db.prepare(
    `${selectVersion} WHERE a.project_id=? AND a.sr_id=? AND v.version=a.current_version
      ORDER BY a.kind,a.design_stage,a.artifact_id`,
  ).all(projectId, srId) as ArtifactRow[];
  return rows.map((row) => mapRow(db, row));
}

export function findCurrentArtifactByLogicalKey(
  db: DatabaseConnection,
  scope: SrScope,
  logicalKey: string,
): StoredArtifactVersion | undefined {
  let target;
  try {
    target = parseArtifactLogicalKey(logicalKey);
  } catch (error) {
    return fail('VALIDATION_ERROR', error instanceof Error ? error.message : '문서 logical key가 올바르지 않습니다.');
  }
  return readCurrentArtifacts(db, scope.projectId, scope.srId).find((artifact) =>
    artifactLogicalTarget(artifact.kind, artifact.designStage).logicalKey === target.logicalKey,
  );
}

function ensureRefsExist(db: DatabaseConnection, input: StoreArtifactInput): void {
  const checks = [
    ...(input.edit.decisionRefs ?? []).map((ref) => ({
      table: 'decision_versions', id: 'decision_id', ref,
    })),
    ...(input.edit.sourceRefs ?? []).map((ref) => ({
      table: 'context_source_versions', id: 'source_id', ref,
    })),
    ...(input.edit.questionResultRefs ?? []).map((ref) => ({
      table: 'question_result_snapshots', id: 'question_id', ref,
    })),
  ];
  for (const check of checks) {
    const found = db.prepare(
      `SELECT 1 FROM ${check.table}
        WHERE project_id=? AND sr_id=? AND ${check.id}=? AND version=?`,
    ).get(input.scope.projectId, input.scope.srId, check.ref.entityId, check.ref.version);
    if (found === undefined) return fail('VALIDATION_ERROR', '문서가 참조한 version을 찾을 수 없습니다.');
  }
}

function itemIds(artifact: StoredArtifactVersion): {
  readonly sections: ReadonlySet<string>;
  readonly requirements: ReadonlySet<string>;
  readonly tasks: ReadonlySet<string>;
} {
  return {
    sections: new Set(artifact.sectionIndex.map(({ sectionId }) => sectionId)),
    requirements: new Set(artifact.requirementLinks.map(({ requirementId }) => requirementId)),
    tasks: new Set(artifact.workflow?.requirementTaskLinks.map(({ taskId }) => taskId) ?? []),
  };
}

function ensureRetiredIdsAreNotReused(
  db: DatabaseConnection,
  current: StoredArtifactVersion,
  edit: ArtifactEdit | WorkflowPlanEdit,
): void {
  const currentIds = itemIds(current);
  const retiredSections = new Set<string>();
  const retiredRequirements = new Set<string>();
  const retiredTasks = new Set<string>();
  for (let version = 1; version < current.versionRef.version; version += 1) {
    const historical = readArtifactVersion(db, {
      kind: 'artifact',
      projectId: current.scope.projectId,
      srId: current.scope.srId,
      entityId: current.artifactId,
      version,
    });
    if (historical === undefined) return fail('CORRUPT_DATA', '문서 version 이력이 연속적이지 않습니다.');
    const ids = itemIds(historical);
    for (const id of ids.sections) if (!currentIds.sections.has(id)) retiredSections.add(id);
    for (const id of ids.requirements) if (!currentIds.requirements.has(id)) retiredRequirements.add(id);
    for (const id of ids.tasks) if (!currentIds.tasks.has(id)) retiredTasks.add(id);
  }
  if (edit.sectionIndex.some(({ sectionId }) => retiredSections.has(sectionId))) {
    return fail('VALIDATION_ERROR', '삭제한 section ID를 다시 사용할 수 없습니다.');
  }
  if (edit.requirementLinks.some(({ requirementId }) => retiredRequirements.has(requirementId))) {
    return fail('VALIDATION_ERROR', '삭제한 requirement ID를 다시 사용할 수 없습니다.');
  }
  if (
    'requirementTaskLinks' in edit &&
    edit.requirementTaskLinks.some(({ taskId }) => retiredTasks.has(taskId))
  ) {
    return fail('VALIDATION_ERROR', '삭제한 task ID를 다시 사용할 수 없습니다.');
  }
}

export function storeArtifactVersion(
  db: DatabaseConnection,
  input: StoreArtifactInput,
): StoredArtifactVersion {
  ensureRefsExist(db, input);
  const edit = input.edit;
  const target = edit.targetBasis;
  const current = target.kind === 'absent'
    ? findCurrentArtifactByLogicalKey(db, input.scope, target.logicalKey)
    : readArtifactVersion(db, target.ref);
  if (target.kind === 'absent' && current !== undefined) {
    return fail('STALE_VERSION', '문서 대상이 더 이상 비어 있지 않습니다.');
  }
  if (target.kind === 'version') {
    if (current === undefined) return fail('NOT_FOUND', '개정할 문서 version을 찾을 수 없습니다.');
    if (current.versionRef.version !== target.ref.version) {
      return fail('STALE_VERSION', '개정할 문서의 현재 version이 바뀌었습니다.');
    }
    const actualCurrent = readCurrentArtifacts(db, input.scope.projectId, input.scope.srId)
      .find((artifact) => artifact.artifactId === target.ref.entityId);
    if (actualCurrent?.versionRef.version !== target.ref.version) {
      return fail('STALE_VERSION', '개정할 문서의 현재 version이 바뀌었습니다.');
    }
    if (current.kind !== edit.kind || current.designStage !== ('designStage' in edit ? edit.designStage : undefined)) {
      return fail('VALIDATION_ERROR', '개정 중 문서 종류나 설계 단계를 바꿀 수 없습니다.');
    }
    ensureRetiredIdsAreNotReused(db, current, edit);
  }
  const artifactId = current?.artifactId ?? `artifact-${randomUUID()}`;
  if (edit.artifactId !== undefined && edit.artifactId !== artifactId) {
    return fail('VALIDATION_ERROR', '클라이언트 artifactId가 서버 대상과 다릅니다.');
  }
  const version = (current?.versionRef.version ?? 0) + 1;
  const revision = (current?.revision ?? 0) + 1;
  const designStage = edit.kind === 'design' ? edit.designStage : null;
  if (current === undefined) {
    db.prepare(
      `INSERT INTO artifacts(
         project_id,sr_id,artifact_id,kind,current_version,revision,design_stage,display_title
       ) VALUES (?,?,?,?,?,?,?,NULL)`,
    ).run(input.scope.projectId, input.scope.srId, artifactId, edit.kind, version, revision, designStage);
  }
  const payload = {
    decisionRefs: edit.decisionRefs ?? [],
    sourceRefs: edit.sourceRefs ?? [],
    questionResultRefs: edit.questionResultRefs ?? [],
  };
  db.prepare(
    `INSERT INTO artifact_versions(
       project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
       requirement_links_json,author_origin,author_id,created_at,change_summary,
       previous_version,draft_application_id,input_snapshot_id,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.scope.projectId, input.scope.srId, artifactId, edit.kind, version,
    edit.markdown, JSON.stringify(edit.sectionIndex), JSON.stringify(edit.requirementLinks),
    input.authorOrigin, input.authorId, input.createdAt, edit.changeSummary,
    current?.versionRef.version ?? null, input.draftApplicationId ?? null,
    input.inputSnapshotId ?? null, JSON.stringify(payload),
  );
  if ('workflowVersion' in edit) {
    db.prepare(
      `INSERT INTO workflow_plan_versions(
         project_id,sr_id,artifact_id,version,workflow_version,stages_json,
         implementation_unit_count,requirement_task_links_json
       ) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      input.scope.projectId, input.scope.srId, artifactId, version,
      edit.workflowVersion, JSON.stringify(edit.stages), edit.implementationUnitCount,
      JSON.stringify(edit.requirementTaskLinks),
    );
  }
  if (current !== undefined) {
    const updated = db.prepare(
      `UPDATE artifacts SET current_version=?,revision=revision+1
        WHERE project_id=? AND sr_id=? AND artifact_id=? AND current_version=? AND revision=?`,
    ).run(
      version, input.scope.projectId, input.scope.srId, artifactId,
      current.versionRef.version, current.revision,
    );
    if (updated.changes !== 1) return fail('STALE_VERSION', '개정할 문서의 현재 version이 바뀌었습니다.');
  }
  const stored = readArtifactVersion(db, {
    kind: 'artifact', projectId: input.scope.projectId, srId: input.scope.srId,
    entityId: artifactId, version,
  });
  if (stored === undefined) return fail('CORRUPT_DATA', '저장한 문서 version을 읽을 수 없습니다.');
  return stored;
}

export function toArtifactView(
  artifact: StoredArtifactVersion,
  reviewImpact: ArtifactView['reviewImpact'],
): ArtifactView | WorkflowPlanView {
  const base: ArtifactView = {
    scope: artifact.scope,
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    ...(artifact.designStage === undefined ? {} : { designStage: artifact.designStage }),
    versionRef: artifact.versionRef,
    markdown: artifact.markdown,
    sectionIndex: artifact.sectionIndex,
    requirementLinks: artifact.requirementLinks,
    authorOrigin: artifact.authorOrigin,
    authorId: artifact.authorId,
    createdAt: artifact.createdAt,
    changeSummary: artifact.changeSummary,
    ...(artifact.previousVersionRef === undefined ? {} : { previousVersionRef: artifact.previousVersionRef }),
    ...(artifact.draftApplicationId === undefined ? {} : { draftApplicationId: artifact.draftApplicationId }),
    ...(artifact.inputSnapshotId === undefined ? {} : { inputSnapshotId: artifact.inputSnapshotId }),
    decisionRefs: artifact.decisionRefs,
    sourceRefs: artifact.sourceRefs,
    questionResultRefs: artifact.questionResultRefs,
    revision: artifact.revision,
    reviewImpact,
  };
  if (artifact.kind !== 'workflow_plan' || artifact.workflow === undefined) return base;
  return {
    ...base,
    kind: 'workflow_plan',
    workflowVersion: artifact.workflow.workflowVersion,
    stages: artifact.workflow.stages,
    implementationUnitCount: artifact.workflow.implementationUnitCount,
    requirementTaskLinks: artifact.workflow.requirementTaskLinks,
  };
}
