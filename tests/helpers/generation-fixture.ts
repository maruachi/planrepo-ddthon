import { createHash } from 'node:crypto';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import type { FingerprintGuard } from '@/src/contracts/context';
import type { GenerationInput, ProviderSelection } from '@/src/contracts/views';
import type { DatabaseConnection } from '@/src/persistence/database';
import type { InvokeScope, TestApp } from '@/tests/helpers/test-app';

export interface GenerationFixture {
  readonly scope: Required<Pick<InvokeScope, 'actorId' | 'projectId' | 'srId'>>;
  readonly input: GenerationInput & { readonly taskKind: 'QUESTION_PROPOSALS' };
  readonly guard: FingerprintGuard;
}

interface GenerationStateRun {
  readonly runId: string;
  readonly status: string;
  readonly inputSnapshotRef: string;
  readonly providerSelection: ProviderSelection;
  readonly retryOfRunId?: string;
}

export interface GenerationState {
  readonly nonterminalCount: number;
  readonly runs: readonly GenerationStateRun[];
  readonly snapshots: readonly string[];
  readonly receipts: readonly string[];
  readonly slot: readonly string[];
  readonly activeSlot?: { readonly runId: string; readonly claimId: string };
  readonly claims: readonly string[];
  readonly observations: readonly string[];
  readonly businessDigest: string;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestRows(db: DatabaseConnection): string {
  const statements = [
    `SELECT project_id,sr_id,sr_key,owner_id,original_description_id,original_description_version,
            current_description_id,current_description_version,progress_stage,revision
       FROM srs ORDER BY project_id,sr_id`,
    `SELECT project_id,sr_id,description_id,version,title,purpose,description
       FROM sr_description_versions ORDER BY project_id,sr_id,description_id,version`,
    `SELECT project_id,sr_id,source_id,current_version,revision
       FROM context_sources ORDER BY project_id,sr_id,source_id`,
    `SELECT project_id,sr_id,source_id,version,kind,content,target_url,provenance,confirmation,payload_json
       FROM context_source_versions ORDER BY project_id,sr_id,source_id,version`,
    `SELECT project_id,sr_id,artifact_id,kind,current_version,revision
       FROM artifacts ORDER BY project_id,sr_id,artifact_id`,
    `SELECT project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
            requirement_links_json,payload_json
       FROM artifact_versions ORDER BY project_id,sr_id,artifact_id,kind,version`,
    `SELECT project_id,sr_id,question_id,current_result_version,status
       FROM questions ORDER BY project_id,sr_id,question_id`,
    `SELECT project_id,sr_id,question_id,version,status,evidence_refs_json,selected_answer_id,selected_answer_version
       FROM question_result_snapshots ORDER BY project_id,sr_id,question_id,version`,
    `SELECT project_id,sr_id,question_id,answer_id,version,answer_text,evidence_json
       FROM question_answer_versions ORDER BY project_id,sr_id,question_id,answer_id,version`,
    `SELECT project_id,sr_id,decision_id,current_confirmed_version
       FROM decisions ORDER BY project_id,sr_id,decision_id`,
    `SELECT project_id,sr_id,decision_id,version,selected_option,rationale,evidence_json
       FROM decision_versions ORDER BY project_id,sr_id,decision_id,version`,
    `SELECT project_id,sr_id,classification_id,version,target_kind,target_id,scope,required_gate
       FROM scope_classification_versions ORDER BY project_id,sr_id,classification_id,version`,
    `SELECT project_id,policy_id,version,gates_json,require_all_assigned,require_distinct_peer
       FROM review_policy_versions ORDER BY project_id,policy_id,version`,
    `SELECT project_id,sr_id,gate,assignment_id,version
       FROM review_assignment_versions ORDER BY project_id,sr_id,gate,assignment_id,version`,
    `SELECT project_id,sr_id,gate,assignment_id,assignment_version,reviewer_id
       FROM review_assignment_reviewers ORDER BY project_id,sr_id,gate,assignment_id,assignment_version,reviewer_id`,
    `SELECT project_id,sr_id,gate,review_epoch,current_bundle_id,validity,revision
       FROM review_gate_states ORDER BY project_id,sr_id,gate`,
    `SELECT project_id,sr_id,bundle_id,gate,review_epoch
       FROM review_bundles ORDER BY project_id,sr_id,bundle_id`,
    `SELECT project_id,sr_id,approval_id,bundle_id,result
       FROM approvals ORDER BY project_id,sr_id,approval_id`,
    `SELECT project_id,sr_id,transition_id,gate,review_epoch,kind,affected_version_refs_json
       FROM gate_transition_records ORDER BY project_id,sr_id,transition_id`,
  ];
  const serialized = statements.map((sql) => db.prepare(sql).all());
  return `sha256:${createHash('sha256').update(JSON.stringify(serialized)).digest('hex')}`;
}

export async function createGenerationFixture(app: TestApp): Promise<GenerationFixture> {
  const existing = app.db.prepare('SELECT count(*) AS count FROM srs').get() as { readonly count: number };
  if (existing.count !== 0) throw new Error('generation fixture는 업무 SR이 없는 empty TestApp에서만 만들 수 있습니다.');

  const created = await app.invoke('M-003', {
    actorId: manifest.defaultActorId,
    projectId: manifest.projectId,
    idempotencyKey: 'generation-fixture-sr',
  }, {
    key: 'GEN-001',
    title: '생성 접수 검증',
    purpose: '현재 입력과 생성 대기열을 검증합니다.',
    description: '질문 제안을 생성할 최소 요구사항입니다.',
    ownerId: manifest.defaultActorId,
  });
  if (!created.ok) throw new Error(`generation fixture SR 등록 실패: ${created.error.code}`);

  const scope = {
    actorId: manifest.defaultActorId,
    projectId: manifest.projectId,
    srId: created.value.scope.srId,
  };
  const input = { taskKind: 'QUESTION_PROPOSALS' as const };
  const prepared = await app.invoke('M-047', scope, { kind: 'new_generation', input });
  if (!prepared.ok) throw new Error(`generation fixture 입력 준비 실패: ${prepared.error.code}`);
  if (prepared.value.preparation?.kind !== 'new_generation') {
    throw new Error('generation fixture의 새 생성 준비 결과가 없습니다.');
  }
  return {
    scope,
    input,
    guard: { expectedInputFingerprint: prepared.value.preparation.expectedInputFingerprint },
  };
}

export function readGenerationState(db: DatabaseConnection, runId?: string): GenerationState {
  const where = runId === undefined ? '' : ' WHERE run_id=?';
  const args = runId === undefined ? [] : [runId];
  const rows = db.prepare(
    `SELECT run_id,status,input_snapshot_id,provider_selection_json,retry_of_run_id
       FROM generation_runs${where} ORDER BY requested_at,run_id`,
  ).all(...args) as Array<{
    readonly run_id: string;
    readonly status: string;
    readonly input_snapshot_id: string;
    readonly provider_selection_json: string;
    readonly retry_of_run_id: string | null;
  }>;
  const scalarIds = (sql: string, column: string, parameters: readonly string[] = []): readonly string[] =>
    (db.prepare(sql).all(...parameters) as Array<Record<string, string>>).map((row) => row[column] ?? '');
  const selected = runId === undefined ? { clause: '', parameters: [] as string[] } : {
    clause: ' WHERE run_id=?', parameters: [runId],
  };
  const activeSlot = db.prepare(
    'SELECT run_id,claim_id FROM execution_slot WHERE singleton_id=1 AND run_id IS NOT NULL',
  ).get() as { readonly run_id: string; readonly claim_id: string } | undefined;
  return deepFreeze({
    nonterminalCount: (db.prepare(
      "SELECT count(*) AS count FROM generation_runs WHERE status IN ('pending','running')",
    ).get() as { readonly count: number }).count,
    runs: rows.map((row) => ({
      runId: row.run_id,
      status: row.status,
      inputSnapshotRef: row.input_snapshot_id,
      providerSelection: JSON.parse(row.provider_selection_json) as ProviderSelection,
      ...(row.retry_of_run_id === null ? {} : { retryOfRunId: row.retry_of_run_id }),
    })),
    snapshots: scalarIds(
      runId === undefined
        ? 'SELECT snapshot_id FROM input_snapshots ORDER BY snapshot_id'
        : `SELECT s.snapshot_id FROM input_snapshots s JOIN generation_runs r
             ON r.project_id=s.project_id AND r.sr_id=s.sr_id AND r.input_snapshot_id=s.snapshot_id
            WHERE r.run_id=? ORDER BY s.snapshot_id`,
      'snapshot_id',
      selected.parameters,
    ),
    receipts: scalarIds(
      runId === undefined
        ? "SELECT receipt_id FROM command_receipts WHERE command_kind IN ('M-032','M-034','M-035') ORDER BY receipt_id"
        : `SELECT receipt_id FROM command_receipts
            WHERE command_kind IN ('M-032','M-034','M-035')
              AND json_extract(replay_value_json,'$.runId')=? ORDER BY receipt_id`,
      'receipt_id',
      selected.parameters,
    ),
    slot: scalarIds(
      `SELECT coalesce(run_id, '') AS run_id FROM execution_slot
        WHERE singleton_id=1 AND run_id IS NOT NULL${runId === undefined ? '' : ' AND run_id=?'}`,
      'run_id',
      selected.parameters,
    ),
    ...(activeSlot === undefined ? {} : {
      activeSlot: { runId: activeSlot.run_id, claimId: activeSlot.claim_id },
    }),
    claims: scalarIds(
      `SELECT claim_id FROM execution_claims${selected.clause} ORDER BY claim_id`,
      'claim_id', selected.parameters,
    ),
    observations: scalarIds(
      `SELECT observation_id FROM execution_observations${selected.clause} ORDER BY observation_id`,
      'observation_id', selected.parameters,
    ),
    businessDigest: digestRows(db),
  });
}
