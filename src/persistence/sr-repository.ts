import type { DatabaseConnection } from './database';
import type {
  BundleRef,
  GateKind,
  GateValidity,
  ProgressStage,
  SrDescriptionVersionRef,
  SrVersionRef,
} from '@/src/contracts/context';
import type { ReviewImpact } from '@/src/contracts/results';
import type {
  BoardCardView,
  BoardFilter,
  ContextSourceView,
  ExternalEvidence,
  ImplementationView,
  MockTicketView,
  NonEmpty,
  ReviewBundleSnapshot,
  SRDescriptionView,
  SRDetailView,
  SRView,
} from '@/src/contracts/views';
import {
  readGenerationDrafts,
  readGenerationRuns,
  type CurrentInputFingerprintPort,
} from './generation-run-query';
import { readContextSources, toContextSourceView } from './context-source-repository';
import { readCurrentArtifacts, toArtifactView } from './artifact-repository';
import { readDecisionViews, readQuestionViews } from './question-decision-repository';
import { readApprovals, readReviewRequests } from './review-repository';
import { readChangeRequests, readComments } from './change-request-repository';

export class ReviewBundleReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewBundleReadError';
  }
}

export interface StoredMembership {
  readonly actorId: string;
  readonly roles: readonly string[];
}

export interface NewStoredSr {
  readonly projectId: string;
  readonly srId: string;
  readonly key: string;
  readonly ownerId: string;
  readonly descriptionId: string;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly authorId: string;
  readonly createdAt: string;
  readonly existingSystem?: boolean;
  readonly mockTicket?: MockTicketView;
}

interface SrRow {
  readonly project_id: string;
  readonly sr_id: string;
  readonly sr_key: string;
  readonly owner_id: string;
  readonly original_description_id: string;
  readonly original_description_version: number;
  readonly current_description_id: string;
  readonly current_description_version: number;
  readonly progress_stage: ProgressStage;
  readonly revision: number;
  readonly title: string;
}

interface GateRow {
  readonly gate: GateKind;
  readonly validity: GateValidity;
  readonly review_epoch: number;
  readonly current_bundle_id: string | null;
  readonly current_bundle_version: number | null;
}

interface DescriptionRow {
  readonly description_id: string;
  readonly version: number;
  readonly title: string;
  readonly purpose: string;
  readonly description: string;
  readonly author_id: string;
  readonly created_at: string;
  readonly change_reason: string | null;
  readonly payload_json: string;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} JSON이 올바르지 않습니다.`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${label}가 객체가 아닙니다.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label}가 문자열 배열이 아닙니다.`);
  }
  return value;
}

function externalEvidence(value: unknown): NonEmpty<ExternalEvidence> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('외부 구현 완료 근거가 없습니다.');
  }
  const parsed = value.map((item): ExternalEvidence => {
    const evidence = objectValue(item, '외부 구현 근거');
    const kind = evidence.kind;
    if (
      (kind !== 'pr' && kind !== 'verification' && kind !== 'link') ||
      typeof evidence.label !== 'string' || typeof evidence.value !== 'string'
    ) throw new Error('외부 구현 근거가 올바르지 않습니다.');
    return { kind, label: evidence.label, value: evidence.value };
  });
  const [first, ...rest] = parsed;
  if (first === undefined) throw new Error('외부 구현 완료 근거가 없습니다.');
  return [first, ...rest];
}

function versionRef(
  projectId: string,
  srId: string,
  descriptionId: string,
  version: number,
): SrDescriptionVersionRef {
  return { kind: 'sr_description', projectId, srId, entityId: descriptionId, version };
}

export function readMembership(
  db: DatabaseConnection,
  projectId: string,
  actorId: string,
): StoredMembership | undefined {
  const row = db.prepare(
    `SELECT user_id, roles_json FROM demo_user_memberships
      WHERE project_id=? AND user_id=? AND demo=1`,
  ).get(projectId, actorId) as { user_id: string; roles_json: string } | undefined;
  if (row === undefined) return undefined;
  return { actorId: row.user_id, roles: stringArray(parseJson(row.roles_json, 'roles'), 'roles') };
}

export function readProjectRevision(
  db: DatabaseConnection,
  projectId: string,
): number | undefined {
  return (db.prepare('SELECT revision FROM workspace_projects WHERE project_id=?')
    .get(projectId) as { revision: number } | undefined)?.revision;
}

export function findSrIdByEitherKey(
  db: DatabaseConnection,
  projectId: string,
  key: string,
): string | undefined {
  return (db.prepare(
    `SELECT sr_id FROM srs
      WHERE project_id=? AND (sr_key=? OR jira_key=?) LIMIT 1`,
  ).get(projectId, key, key) as { sr_id: string } | undefined)?.sr_id;
}

export function readSrOwner(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): string | undefined {
  return (db.prepare('SELECT owner_id FROM srs WHERE project_id=? AND sr_id=?')
    .get(projectId, srId) as { owner_id: string } | undefined)?.owner_id;
}

function readSrRow(db: DatabaseConnection, projectId: string, srId: string): SrRow | undefined {
  return db.prepare(
    `SELECT s.project_id, s.sr_id, s.sr_key, s.owner_id,
            s.original_description_id, s.original_description_version,
            s.current_description_id, s.current_description_version,
            s.progress_stage, s.revision, d.title
       FROM srs s JOIN sr_description_versions d
         ON d.project_id=s.project_id AND d.sr_id=s.sr_id
        AND d.description_id=s.current_description_id AND d.version=s.current_description_version
      WHERE s.project_id=? AND s.sr_id=?`,
  ).get(projectId, srId) as SrRow | undefined;
}

function currentReviewImpact(gates: readonly GateRow[]): ReviewImpact | undefined {
  const affected = gates.filter((gate) => gate.validity === 'invalid').map((gate) => gate.gate);
  if (affected.length === 0) return undefined;
  return {
    affectedGates: affected,
    needsNewReview: true,
    returnStage: affected.includes('G1') ? 'requirements' : 'planning',
    carriedBlockingRequestIds: [],
    currentHandoffValid: false,
  };
}

function readGateRows(db: DatabaseConnection, projectId: string, srId: string): readonly GateRow[] {
  return db.prepare(
    `SELECT gate, validity, review_epoch, current_bundle_id, current_bundle_version
       FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate`,
  ).all(projectId, srId) as GateRow[];
}

export function readSrView(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  explicitImpact?: ReviewImpact,
): SRView | undefined {
  const row = readSrRow(db, projectId, srId);
  if (row === undefined) return undefined;
  const gates = readGateRows(db, projectId, srId);
  const reviewImpact = explicitImpact ?? currentReviewImpact(gates);
  return {
    scope: { kind: 'sr', projectId, srId },
    key: row.sr_key,
    title: row.title,
    ownerId: row.owner_id,
    originalDescriptionRef: versionRef(
      projectId, srId, row.original_description_id, row.original_description_version,
    ),
    currentDescriptionRef: versionRef(
      projectId, srId, row.current_description_id, row.current_description_version,
    ),
    progressStage: row.progress_stage,
    revision: row.revision,
    gates: gates.map((gate) => ({
      gate: gate.gate,
      validity: gate.validity,
      reviewEpoch: gate.review_epoch,
      ...(gate.current_bundle_id === null || gate.current_bundle_version === null
        ? {}
        : {
            currentBundleRef: {
              projectId,
              srId,
              gate: gate.gate,
              bundleId: gate.current_bundle_id,
              version: gate.current_bundle_version,
            },
          }),
      blockers: [],
    })),
    ...(reviewImpact === undefined ? {} : { reviewImpact }),
  };
}

export function insertSrGraph(db: DatabaseConnection, input: NewStoredSr): void {
  const mockPayload = input.mockTicket === undefined
    ? {}
    : { jira: input.mockTicket, source: 'DEMO-4' };
  db.prepare(
    `INSERT INTO srs(
       project_id,sr_id,sr_key,owner_id,original_description_id,original_description_version,
       current_description_id,current_description_version,workflow_version,implementation_unit_count,
       progress_stage,revision,created_at,updated_at,jira_key,jira_url,existing_system,active_implementation_id
     ) VALUES (?,?,?,?,?,1,?,1,'v1.0.1',1,'sr_received',1,?,?,?,?,?,NULL)`,
  ).run(
    input.projectId, input.srId, input.key, input.ownerId, input.descriptionId,
    input.descriptionId, input.createdAt, input.createdAt,
    input.mockTicket?.key ?? null, input.mockTicket?.url ?? null,
    input.existingSystem === undefined ? null : Number(input.existingSystem),
  );
  db.prepare(
    `INSERT INTO sr_description_versions(
       project_id,sr_id,description_id,version,title,purpose,description,author_id,
       created_at,previous_version,change_reason,payload_json
     ) VALUES (?,?,?,1,?,?,?,?,?,NULL,NULL,?)`,
  ).run(
    input.projectId, input.srId, input.descriptionId, input.title, input.purpose,
    input.description, input.authorId, input.createdAt, JSON.stringify(mockPayload),
  );
  const defaultPolicy = db.prepare(
    'SELECT default_policy_id,default_policy_version FROM workspace_projects WHERE project_id=?',
  ).get(input.projectId) as { default_policy_id: string | null; default_policy_version: number | null } | undefined;
  if (defaultPolicy === undefined) throw new Error('SR의 프로젝트를 찾을 수 없습니다.');
  const insertGate = db.prepare(
    `INSERT INTO review_gate_states(
       project_id,sr_id,gate,review_epoch,needs_new_bundle,validity,revision,
       policy_id,policy_version,assignment_id,assignment_version,current_bundle_id,
       current_bundle_version,last_pass_transition_id,impact_json
     ) VALUES (?,?,?,1,0,'not_passed',1,?,?,NULL,NULL,NULL,NULL,NULL,NULL)`,
  );
  insertGate.run(input.projectId, input.srId, 'G1', defaultPolicy.default_policy_id, defaultPolicy.default_policy_version);
  insertGate.run(input.projectId, input.srId, 'G2', defaultPolicy.default_policy_id, defaultPolicy.default_policy_version);
}

export function updateDescription(
  db: DatabaseConnection,
  input: {
    readonly projectId: string;
    readonly srId: string;
    readonly actorId: string;
    readonly title: string;
    readonly purpose: string;
    readonly description: string;
    readonly changeReason: string;
    readonly updatedAt: string;
  },
): SrDescriptionVersionRef {
  const current = db.prepare(
    `SELECT current_description_id, current_description_version FROM srs
      WHERE project_id=? AND sr_id=?`,
  ).get(input.projectId, input.srId) as {
    current_description_id: string; current_description_version: number;
  };
  const nextVersion = current.current_description_version + 1;
  db.prepare(
    `INSERT INTO sr_description_versions(
       project_id,sr_id,description_id,version,title,purpose,description,author_id,
       created_at,previous_version,change_reason,payload_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'{}')`,
  ).run(
    input.projectId, input.srId, current.current_description_id, nextVersion,
    input.title, input.purpose, input.description, input.actorId, input.updatedAt,
    current.current_description_version, input.changeReason,
  );
  db.prepare(
    `UPDATE srs SET current_description_version=?, revision=revision+1, updated_at=?
      WHERE project_id=? AND sr_id=?`,
  ).run(nextVersion, input.updatedAt, input.projectId, input.srId);
  return versionRef(input.projectId, input.srId, current.current_description_id, nextVersion);
}

export function transitionReceivedSr(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  updatedAt: string,
): void {
  db.prepare(
    `UPDATE srs SET progress_stage='requirements', revision=revision+1, updated_at=?
      WHERE project_id=? AND sr_id=? AND progress_stage='sr_received'`,
  ).run(updatedAt, projectId, srId);
}

function readDescription(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  id: string,
  version: number,
): { readonly view: SRDescriptionView; readonly payload: Record<string, unknown> } {
  const row = db.prepare(
    `SELECT description_id,version,title,purpose,description,author_id,created_at,change_reason,payload_json
       FROM sr_description_versions
      WHERE project_id=? AND sr_id=? AND description_id=? AND version=?`,
  ).get(projectId, srId, id, version) as DescriptionRow | undefined;
  if (row === undefined) throw new Error('SR 설명 버전을 찾을 수 없습니다.');
  return {
    view: {
      versionRef: versionRef(projectId, srId, row.description_id, row.version),
      title: row.title,
      purpose: row.purpose,
      description: row.description,
      authorId: row.author_id,
      createdAt: row.created_at,
      ...(row.change_reason === null ? {} : { changeReason: row.change_reason }),
    },
    payload: objectValue(parseJson(row.payload_json, 'SR 설명 payload'), 'SR 설명 payload'),
  };
}

function noImpact(): ReviewImpact {
  return {
    affectedGates: [],
    needsNewReview: false,
    carriedBlockingRequestIds: [],
    currentHandoffValid: true,
  };
}

function readArtifacts(db: DatabaseConnection, projectId: string, srId: string) {
  return readCurrentArtifacts(db, projectId, srId)
    .map((artifact) => toArtifactView(artifact, noImpact()));
}

type BundlePayloadRefKind = 'artifact' | 'decision' | 'question_result' | 'scope_classification' | 'context_source' | 'review_assignment' | 'sr_description';

function isVersionRef(value: unknown): value is Record<'kind' | 'projectId' | 'srId' | 'entityId' | 'version', unknown> {
  if (!isObject(value)) return false;
  const ref = value;
  return (
    (ref.kind === 'artifact' || ref.kind === 'decision' || ref.kind === 'question_result' ||
      ref.kind === 'scope_classification' || ref.kind === 'context_source' ||
      ref.kind === 'review_assignment' || ref.kind === 'sr_description') &&
    typeof ref.projectId === 'string' && ref.projectId.length > 0 &&
    typeof ref.srId === 'string' && ref.srId.length > 0 &&
    typeof ref.entityId === 'string' && ref.entityId.length > 0 &&
    Number.isInteger(ref.version) && (ref.version as number) > 0
  );
}

function decodeVersionRef<K extends BundlePayloadRefKind>(value: unknown, kind: K): SrVersionRef<K> {
  if (!isVersionRef(value) || value.kind !== kind) throw new Error(`bundle ${kind} 참조가 올바르지 않습니다.`);
  return {
    kind,
    projectId: value.projectId as string,
    srId: value.srId as string,
    entityId: value.entityId as string,
    version: value.version as number,
  };
}

function refArray<K extends 'artifact' | 'decision' | 'question_result' | 'scope_classification' | 'context_source'>(value: unknown, kind: K): readonly SrVersionRef<K>[] {
  if (!Array.isArray(value) || value.some((item) => !isVersionRef(item) || item.kind !== kind)) {
    throw new Error(`bundle ${kind} 참조가 올바르지 않습니다.`);
  }
  return value.map((item) => decodeVersionRef(item, kind));
}

function singleRef<K extends 'review_assignment' | 'sr_description'>(value: unknown, kind: K): SrVersionRef<K> {
  return decodeVersionRef(value, kind);
}

function unconfirmedDecisions(value: unknown): ReviewBundleSnapshot['unconfirmedDecisionSnapshots'] {
  if (!Array.isArray(value)) throw new Error('bundle unconfirmedDecisionSnapshots가 배열이 아닙니다.');
  return value.map((item) => {
    const row = objectValue(item, 'bundle unconfirmed decision');
    if (typeof row.decisionId !== 'string' || !Number.isInteger(row.revision) || typeof row.prompt !== 'string' ||
      !Array.isArray(row.alternatives) || row.alternatives.length === 0 || typeof row.impact !== 'string' ||
      typeof row.decisionMakerId !== 'string' || !isVersionRef(row.classificationRef) || row.classificationRef.kind !== 'scope_classification') {
      throw new Error('bundle unconfirmed decision이 올바르지 않습니다.');
    }
    const alternatives = row.alternatives.map((item) => {
      const option = objectValue(item, 'bundle decision alternative');
      if (typeof option.optionId !== 'string' || typeof option.label !== 'string' || typeof option.description !== 'string') throw new Error('bundle decision alternative이 올바르지 않습니다.');
      return { optionId: option.optionId, label: option.label, description: option.description };
    });
    return { decisionId: row.decisionId, revision: row.revision as number, prompt: row.prompt, alternatives: alternatives as unknown as ReviewBundleSnapshot['unconfirmedDecisionSnapshots'][number]['alternatives'], impact: row.impact, decisionMakerId: row.decisionMakerId, classificationRef: decodeVersionRef(row.classificationRef, 'scope_classification') };
  });
}

function checklist(value: unknown): ReviewBundleSnapshot['checklistSnapshot'] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('bundle checklist가 비었습니다.');
  const parsed = value.map((item) => {
    const row = objectValue(item, 'bundle checklist item');
    if (typeof row.itemId !== 'string' || typeof row.label !== 'string') throw new Error('bundle checklist 항목이 올바르지 않습니다.');
    return { itemId: row.itemId, label: row.label };
  });
  return parsed as unknown as ReviewBundleSnapshot['checklistSnapshot'];
}

function parseGatePolicyForBundle(value: unknown): ReviewBundleSnapshot['checklistSnapshot'] {
  const policy = objectValue(value, 'bundle gate policy');
  return checklist(policy.checklist);
}

function assertBundleRefExists(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  ref: SrVersionRef,
): void {
  if (ref.projectId !== projectId || ref.srId !== srId) throw new Error('bundle ref의 SR 범위가 다릅니다.');
  const tables: Record<SrVersionRef['kind'], readonly [string, string]> = {
    artifact: ['artifact_versions', 'artifact_id'], context_source: ['context_source_versions', 'source_id'],
    question_answer: ['question_answer_versions', 'answer_id'], question_result: ['question_result_snapshots', 'question_id'],
    decision: ['decision_versions', 'decision_id'], scope_classification: ['scope_classification_versions', 'classification_id'],
    sr_description: ['sr_description_versions', 'description_id'], review_assignment: ['review_assignment_versions', 'assignment_id'],
    handoff: ['handoffs', 'handoff_id'],
  };
  const [table, idColumn] = tables[ref.kind];
  const found = db.prepare(`SELECT 1 AS found FROM ${table} WHERE project_id=? AND sr_id=? AND ${idColumn}=? AND version=?`)
    .get(projectId, srId, ref.entityId, ref.version) as { found: 1 } | undefined;
  if (found === undefined) throw new Error(`bundle ${ref.kind} ref가 실제 저장 version을 가리키지 않습니다.`);
}

function readBundles(db: DatabaseConnection, projectId: string, srId: string): readonly ReviewBundleSnapshot[] {
  const rows = db.prepare(
    `SELECT gate,bundle_id,version,review_epoch,assignment_id,assignment_version,policy_id,policy_version,
            checklist_json,created_by,created_at,previous_bundle_id,previous_bundle_version,
            g1_bundle_id,g1_bundle_version,payload_json
       FROM review_bundles WHERE project_id=? AND sr_id=? ORDER BY gate,version`,
  ).all(projectId, srId) as Array<{
    gate: GateKind; bundle_id: string; version: number; review_epoch: number; assignment_id: string; assignment_version: number;
    policy_id: string; policy_version: number; g1_bundle_id: string | null;
    g1_bundle_version: number | null; checklist_json: string; created_by: string; created_at: string;
    previous_bundle_id: string | null; previous_bundle_version: number | null; payload_json: string;
  }>;
  try {
    return rows.map((row) => {
    const payload = objectValue(parseJson(row.payload_json, 'bundle payload'), 'bundle payload');
    const reviewers = stringArray(payload.reviewerIds, 'bundle reviewerIds');
    const artifacts = refArray(payload.artifactVersionRefs, 'artifact');
    const decisions = refArray(payload.decisionVersionRefs, 'decision');
    const questions = refArray(payload.questionResultRefs, 'question_result');
    const classifications = refArray(payload.classificationRefs, 'scope_classification');
    const sources = refArray(payload.contextSourceVersionRefs, 'context_source');
    const assignment = singleRef(payload.assignmentRef, 'review_assignment');
    const description = singleRef(payload.descriptionRef, 'sr_description');
    const unconfirmed = unconfirmedDecisions(payload.unconfirmedDecisionSnapshots);
    [...artifacts, ...decisions, ...questions, ...classifications, ...sources, assignment, description]
      .forEach((ref) => assertBundleRefExists(db, projectId, srId, ref));
    unconfirmed.forEach((item) => {
      assertBundleRefExists(db, projectId, srId, item.classificationRef);
      const classification = db.prepare(`SELECT target_kind,target_id FROM scope_classification_versions
        WHERE project_id=? AND sr_id=? AND classification_id=? AND version=?`)
        .get(projectId, srId, item.classificationRef.entityId, item.classificationRef.version) as {
          target_kind: string; target_id: string;
        } | undefined;
      const decision = db.prepare('SELECT 1 AS found FROM decisions WHERE project_id=? AND sr_id=? AND decision_id=?')
        .get(projectId, srId, item.decisionId) as { found: 1 } | undefined;
      if (classification?.target_kind !== 'decision' || classification.target_id !== item.decisionId || decision === undefined) {
        throw new Error('bundle 미확정 결정의 분류 대상 관계가 올바르지 않습니다.');
      }
    });
    if (assignment.entityId !== row.assignment_id || assignment.version !== row.assignment_version) throw new Error('bundle assignment ref와 저장 열이 다릅니다.');
    const policyPayload = objectValue(payload.policyRef, 'bundle policyRef');
    if (policyPayload.kind !== 'review_policy' || policyPayload.projectId !== projectId || policyPayload.entityId !== row.policy_id || policyPayload.version !== row.policy_version) throw new Error('bundle policy ref와 저장 열이 다릅니다.');
    const storedReviewers = (db.prepare(`SELECT reviewer_id FROM review_assignment_reviewers
      WHERE project_id=? AND sr_id=? AND gate=? AND assignment_id=? AND assignment_version=? ORDER BY reviewer_id`)
      .all(projectId, srId, row.gate, row.assignment_id, row.assignment_version) as Array<{ reviewer_id: string }>).map((item) => item.reviewer_id);
    if (JSON.stringify([...reviewers].sort()) !== JSON.stringify(storedReviewers)) throw new Error('bundle reviewerIds가 배정 version과 다릅니다.');
    const gatePolicies = objectValue(parseJson((db.prepare('SELECT gates_json FROM review_policy_versions WHERE project_id=? AND policy_id=? AND version=?')
      .get(projectId, row.policy_id, row.policy_version) as { gates_json: string }).gates_json, 'bundle policy gates'), 'bundle policy gates');
    const policyChecklist = parseGatePolicyForBundle(gatePolicies[row.gate]);
    const snapshotChecklist = checklist(parseJson(row.checklist_json, 'bundle checklist'));
    if (JSON.stringify(policyChecklist) !== JSON.stringify(snapshotChecklist)) throw new Error('bundle checklist가 정책 version과 다릅니다.');
    if (unconfirmed.some((item) => decisions.some((ref) => ref.entityId === item.decisionId) ||
      !classifications.some((ref) => ref.entityId === item.classificationRef.entityId && ref.version === item.classificationRef.version))) {
      throw new Error('bundle 미확정 결정 snapshot의 참조 관계가 올바르지 않습니다.');
    }
    const artifactKinds = artifacts.map((ref) => (db.prepare('SELECT kind FROM artifact_versions WHERE project_id=? AND sr_id=? AND artifact_id=? AND version=?')
      .get(projectId, srId, ref.entityId, ref.version) as { kind: string }).kind);
    if (!artifactKinds.includes('requirements') || (row.gate === 'G2' &&
      (!artifactKinds.includes('workflow_plan') || !artifactKinds.includes('design') || !artifactKinds.includes('implementation_plan')))) {
      throw new Error('bundle의 gate 필수 문서가 부족합니다.');
    }
    return {
      bundleRef: { projectId, srId, gate: row.gate, bundleId: row.bundle_id, version: row.version },
      reviewEpoch: row.review_epoch,
      artifactVersionRefs: artifacts,
      decisionVersionRefs: decisions,
      unconfirmedDecisionSnapshots: unconfirmed,
      questionResultRefs: questions,
      classificationRefs: classifications,
      contextSourceVersionRefs: sources,
      assignmentRef: assignment,
      reviewerIds: reviewers,
      policyRef: {
        kind: 'review_policy', projectId, entityId: row.policy_id, version: row.policy_version,
      },
      checklistSnapshot: snapshotChecklist,
      descriptionRef: description,
      createdBy: row.created_by,
      createdAt: row.created_at,
      ...(row.previous_bundle_id === null || row.previous_bundle_version === null ? {} : {
        previousBundleRef: { projectId, srId, gate: row.gate, bundleId: row.previous_bundle_id, version: row.previous_bundle_version },
      }),
      ...(row.g1_bundle_id === null || row.g1_bundle_version === null ? {} : {
        g1BundleRef: {
          projectId, srId, gate: 'G1' as const,
          bundleId: row.g1_bundle_id, version: row.g1_bundle_version,
        },
      }),
    };
    });
  } catch (error) {
    throw new ReviewBundleReadError(error instanceof Error ? error.message : 'bundle snapshot을 읽을 수 없습니다.');
  }
}

export function readReviewBundles(db: DatabaseConnection, projectId: string, srId: string): readonly ReviewBundleSnapshot[] {
  return readBundles(db, projectId, srId);
}

function readImplementations(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): readonly ImplementationView[] {
  const rows = db.prepare(
    `SELECT implementation_id,handoff_id,handoff_version,started_by,started_at,status,
            revision,completed_by,completed_at,completion_summary,evidence_json,
            CASE WHEN implementation_id=(SELECT active_implementation_id FROM srs
              WHERE project_id=? AND sr_id=?) THEN 1 ELSE 0 END AS active
       FROM implementation_records WHERE project_id=? AND sr_id=? ORDER BY started_at`,
  ).all(projectId, srId, projectId, srId) as Array<{
    implementation_id: string; handoff_id: string; handoff_version: number;
    started_by: string; started_at: string; status: 'started' | 'completed'; revision: number;
    completed_by: string | null; completed_at: string | null; completion_summary: string | null;
    evidence_json: string | null; active: number;
  }>;
  return rows.map((row) => {
    const base = {
      implementationId: row.implementation_id,
      handoffRef: {
        kind: 'handoff' as const, projectId, srId,
        entityId: row.handoff_id, version: row.handoff_version,
      },
      startedBy: row.started_by,
      startedAt: row.started_at,
      activeForCurrentSr: row.active === 1,
      revision: row.revision,
    };
    if (row.status === 'started') return { ...base, status: 'started' };
    if (
      row.completed_by === null || row.completed_at === null ||
      row.completion_summary === null || row.evidence_json === null
    ) throw new Error('완료된 외부 구현 자료가 불완전합니다.');
    const evidence = externalEvidence(parseJson(row.evidence_json, 'implementation evidence'));
    return {
      ...base,
      status: 'completed',
      completedBy: row.completed_by,
      completedAt: row.completed_at,
      completionSummary: row.completion_summary,
      evidence,
    };
  });
}

function readSources(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
): readonly ContextSourceView[] {
  return readContextSources(db, projectId, srId)
    .map((source) => toContextSourceView(source, noImpact()));
}

export function readBoardCards(
  db: DatabaseConnection,
  projectId: string,
  filter: BoardFilter,
): readonly BoardCardView[] {
  const ids = db.prepare('SELECT sr_id FROM srs WHERE project_id=? ORDER BY sr_key')
    .all(projectId) as Array<{ sr_id: string }>;
  return ids.flatMap(({ sr_id }) => {
    const sr = readSrView(db, projectId, sr_id);
    if (sr === undefined) return [];
    if (filter.search !== undefined && !`${sr.key} ${sr.title}`.toLowerCase().includes(filter.search.toLowerCase())) return [];
    if (filter.stages !== undefined && !filter.stages.includes(sr.progressStage)) return [];
    if (filter.ownerIds !== undefined && !filter.ownerIds.includes(sr.ownerId)) return [];
    if (filter.gates !== undefined && !filter.gates.some((gate) => sr.gates.some((item) => item.gate === gate))) return [];
    const invalid = sr.gates.filter((gate) => gate.validity === 'invalid');
    if (filter.blocked === true && invalid.length === 0) return [];
    if (filter.blocked === false && invalid.length > 0) return [];
    return [{
      sr,
      reviewStatus: invalid.length > 0
        ? '재검토 필요'
        : sr.gates.every((gate) => gate.validity === 'valid') ? '승인 완료' : '미통과',
      blockers: invalid.map((gate) => `${gate.gate} 재검토가 필요합니다.`),
      nextActions: [sr.progressStage === 'sr_received' ? '요구사항 구체화 시작' : '현재 단계 계속'],
    }];
  });
}

export function readSrDetail(
  db: DatabaseConnection,
  projectId: string,
  srId: string,
  currentInputFingerprints?: CurrentInputFingerprintPort,
): SRDetailView | undefined {
  const row = readSrRow(db, projectId, srId);
  const sr = readSrView(db, projectId, srId);
  if (row === undefined || sr === undefined) return undefined;
  const original = readDescription(
    db, projectId, srId, row.original_description_id, row.original_description_version,
  );
  const current = readDescription(
    db, projectId, srId, row.current_description_id, row.current_description_version,
  );
  const jiraValue = original.payload.jira;
  let mockTicket: MockTicketView | undefined;
  if (jiraValue !== undefined) {
    const jira = objectValue(jiraValue, 'Jira mock');
    if (
      typeof jira.key !== 'string' || typeof jira.url !== 'string' ||
      typeof jira.status !== 'string' || jira.mock !== true
    ) throw new Error('Jira mock 자료가 올바르지 않습니다.');
    mockTicket = { key: jira.key, url: jira.url, status: jira.status, mock: true };
  }
  return {
    sr,
    originalDescription: original.view,
    currentDescription: current.view,
    ...(mockTicket === undefined ? {} : { mockTicket }),
    sources: readSources(db, projectId, srId),
    artifacts: readArtifacts(db, projectId, srId),
    questions: readQuestionViews(db, projectId, srId),
    decisions: readDecisionViews(db, projectId, srId),
    bundles: readBundles(db, projectId, srId),
    reviewRequests: readReviewRequests(db, projectId, srId),
    approvals: readApprovals(db, projectId, srId),
    gateAssessments: [],
    reviewConfigurations: [],
    reviewPreparations: [],
    comments: readComments(db, { kind: 'sr', projectId, srId }),
    changeRequests: readChangeRequests(db, { kind: 'sr', projectId, srId }),
    generationRuns: readGenerationRuns(db, projectId, srId, currentInputFingerprints),
    generationDrafts: readGenerationDrafts(db, projectId, srId, currentInputFingerprints),
    implementations: readImplementations(db, projectId, srId),
    revision: sr.revision,
  };
}
