import { randomUUID } from 'node:crypto';
import type { ClaimRef, EntityRef, SrScope } from '@/src/contracts/context';
import type {
  ClaimedRun,
  ExecutionObservation,
  ExecutionPolicy,
  ExecutionReport,
  ExecutionTermination,
  GenerationResult,
  GenerationRunView,
  GenerationTaskKind,
  InputSnapshot,
  ProviderFailureCore,
  ProviderSelection,
} from '@/src/contracts/views';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readInputSnapshot } from '@/src/persistence/input-snapshot-repository';
import {
  readGenerationRuns,
  type CurrentInputFingerprintPort,
} from '@/src/persistence/generation-run-query';

export interface PendingGenerationRunInput {
  readonly scope: SrScope;
  readonly taskKind: GenerationTaskKind;
  readonly snapshot: InputSnapshot;
  readonly selection: ProviderSelection;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly retryOfRunId?: string;
  readonly runId?: string;
}

export class GenerationRepositoryError extends Error {}

export interface StoredGenerationClaim {
  readonly scope: SrScope;
  readonly runId: string;
  readonly claimId: string;
  readonly ownerRuntimeId: string;
  readonly tokenHash: string;
  readonly launchIntentId: string;
  readonly executionPolicyRef: string;
  readonly status: GenerationRunView['status'];
}

export interface StoredRuntimeRecoveryOwner {
  readonly runtimeId: string;
  readonly hostId: string;
  readonly bootId: string;
  readonly parentPid: number;
  readonly parentStartedAt: string;
}

export interface StoredRuntimeRecoveryCandidate extends StoredRuntimeRecoveryOwner {
  readonly projectId: string;
  readonly srId: string;
  readonly runId: string;
  readonly claimId: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
}

export function readPriorActiveRuntimeOwners(
  db: DatabaseConnection,
  currentRuntimeId: string,
): readonly StoredRuntimeRecoveryOwner[] {
  return (db.prepare(
    `SELECT i.runtime_id,i.host_id,i.boot_id,i.parent_pid,i.parent_started_at
       FROM runtime_instances a JOIN runtime_identities i ON i.runtime_id=a.runtime_id
      WHERE a.runtime_id<>? ORDER BY i.runtime_id`,
  ).all(currentRuntimeId) as Array<{
    readonly runtime_id: string;
    readonly host_id: string;
    readonly boot_id: string;
    readonly parent_pid: number;
    readonly parent_started_at: string;
  }>).map((row) => ({
    runtimeId: row.runtime_id,
    hostId: row.host_id,
    bootId: row.boot_id,
    parentPid: row.parent_pid,
    parentStartedAt: row.parent_started_at,
  }));
}

export function removeRecoveredRuntimeRegistration(
  db: DatabaseConnection,
  runtimeId: string,
): boolean {
  if (db.prepare(
    'SELECT 1 FROM execution_slot WHERE singleton_id=1 AND runtime_id=?',
  ).get(runtimeId) !== undefined) return false;
  return db.prepare('DELETE FROM runtime_instances WHERE runtime_id=?').run(runtimeId).changes === 1;
}

export interface ClaimCapabilityInput {
  readonly claimRef: ClaimRef;
  readonly tokenHash: string;
}

export function countNonterminalGenerationRuns(db: DatabaseConnection): number {
  return (db.prepare(
    "SELECT count(*) AS count FROM generation_runs WHERE status IN ('pending','running')",
  ).get() as { readonly count: number }).count;
}

export function insertPendingGenerationRun(
  db: DatabaseConnection,
  input: PendingGenerationRunInput,
): string {
  const runId = input.runId ?? `run-${randomUUID()}`;
  db.prepare(
    `INSERT INTO generation_runs(
       project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
       requested_by,requested_at,status,revision,retry_of_run_id,payload_json
     ) VALUES(?,?,?,?,?,?,?,?,'pending',1,?,'{}')`,
  ).run(
    input.scope.projectId,
    input.scope.srId,
    runId,
    input.taskKind,
    input.snapshot.snapshotId,
    JSON.stringify(input.selection),
    input.requestedBy,
    input.requestedAt,
    input.retryOfRunId ?? null,
  );
  return runId;
}

export function readGenerationRun(
  db: DatabaseConnection,
  scope: SrScope,
  runId: string,
  currentInputFingerprints?: CurrentInputFingerprintPort,
): GenerationRunView | undefined {
  return readGenerationRuns(
    db,
    scope.projectId,
    scope.srId,
    currentInputFingerprints,
  ).find((run) => run.runId === runId);
}

interface ActiveSlotRow {
  readonly project_id: string | null;
  readonly sr_id: string | null;
  readonly run_id: string | null;
  readonly claim_id: string | null;
  readonly claim_token_hash: string | null;
  readonly runtime_id: string | null;
  readonly launch_intent_id: string | null;
}

function activeSlot(db: DatabaseConnection): ActiveSlotRow {
  return db.prepare(
    `SELECT project_id,sr_id,run_id,claim_id,claim_token_hash,runtime_id,launch_intent_id
       FROM execution_slot WHERE singleton_id=1`,
  ).get() as ActiveSlotRow;
}

export function readRuntimeRecoveryCandidate(
  db: DatabaseConnection,
): StoredRuntimeRecoveryCandidate | undefined {
  const rows = db.prepare(
    `SELECT s.runtime_id,s.project_id,s.sr_id,s.run_id,s.claim_id,
            r.status,i.host_id,i.boot_id,i.parent_pid,i.parent_started_at
       FROM execution_slot s
       JOIN generation_runs r
         ON r.project_id=s.project_id AND r.sr_id=s.sr_id AND r.run_id=s.run_id
       JOIN runtime_identities i ON i.runtime_id=s.runtime_id
      WHERE s.singleton_id=1 AND s.run_id IS NOT NULL`,
  ).all() as Array<{
    readonly runtime_id: string;
    readonly project_id: string;
    readonly sr_id: string;
    readonly run_id: string;
    readonly claim_id: string;
    readonly status: string;
    readonly host_id: string;
    readonly boot_id: string;
    readonly parent_pid: number;
    readonly parent_started_at: string;
  }>;
  if (rows.length > 1) throw new GenerationRepositoryError('복구할 실행 slot이 둘 이상입니다.');
  const row = rows[0];
  if (row === undefined) return undefined;
  if (!['running', 'succeeded', 'failed', 'cancelled'].includes(row.status)) {
    throw new GenerationRepositoryError('실행 slot의 Run 상태가 복구 계약과 다릅니다.');
  }
  return {
    runtimeId: row.runtime_id,
    hostId: row.host_id,
    bootId: row.boot_id,
    parentPid: row.parent_pid,
    parentStartedAt: row.parent_started_at,
    projectId: row.project_id,
    srId: row.sr_id,
    runId: row.run_id,
    claimId: row.claim_id,
    status: row.status as StoredRuntimeRecoveryCandidate['status'],
  };
}

export function markGenerationRunInterrupted(
  db: DatabaseConnection,
  input: {
    readonly candidate: StoredRuntimeRecoveryCandidate;
    readonly observedByRuntime: string;
    readonly observedAt: string;
    readonly basis: 'confirmed_owner_exit' | 'host_reboot_confirmed';
  },
): boolean {
  const changed = db.prepare(
    `UPDATE generation_runs
        SET status='failed',revision=revision+1,error_code='INTERRUPTED',finished_at=?,
            payload_json=json_set(payload_json,'$.recovery',json(?))
      WHERE project_id=? AND sr_id=? AND run_id=? AND claim_id=? AND status='running'
        AND EXISTS (
          SELECT 1 FROM execution_slot s
           WHERE s.singleton_id=1 AND s.project_id=generation_runs.project_id
             AND s.sr_id=generation_runs.sr_id AND s.run_id=generation_runs.run_id
             AND s.claim_id=generation_runs.claim_id AND s.runtime_id=?
        )`,
  ).run(
    input.observedAt,
    JSON.stringify({
      policyRef: 'runtime-recovery-v1',
      basis: input.basis,
      observedByRuntime: input.observedByRuntime,
    }),
    input.candidate.projectId,
    input.candidate.srId,
    input.candidate.runId,
    input.candidate.claimId,
    input.candidate.runtimeId,
  ).changes;
  if (changed === 0) return false;
  if (changed !== 1) throw new GenerationRepositoryError('복구할 running Run이 둘 이상 변경됐습니다.');
  const targetRef: EntityRef<'generation_run'> = {
    kind: 'generation_run',
    projectId: input.candidate.projectId,
    srId: input.candidate.srId,
    entityId: input.candidate.runId,
  };
  db.prepare(
    `INSERT INTO activity_events(
       project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
       occurred_at,receipt_id,internal_basis_json,description,payload_json
     ) VALUES(?,?,?,?,?,?,?, ?,NULL,?,?,'{}')`,
  ).run(
    input.candidate.projectId,
    `activity-${randomUUID()}`,
    input.candidate.srId,
    'generation_failed',
    'system',
    input.observedByRuntime,
    JSON.stringify([targetRef]),
    input.observedAt,
    JSON.stringify({
      runId: input.candidate.runId,
      claimId: input.candidate.claimId,
      previousRuntimeId: input.candidate.runtimeId,
      recoveryPolicyRef: 'runtime-recovery-v1',
      basis: input.basis,
    }),
    '검증된 이전 runtime 중단을 generation 실패로 확정했습니다.',
  );
  return true;
}

export function recordHostRebootTermination(
  db: DatabaseConnection,
  input: {
    readonly candidate: StoredRuntimeRecoveryCandidate;
    readonly observedByRuntime: string;
    readonly observedAt: string;
  },
): boolean {
  if (db.prepare(
    `SELECT 1 FROM execution_observations
      WHERE project_id=? AND sr_id=? AND run_id=? AND claim_id=?`,
  ).get(
    input.candidate.projectId, input.candidate.srId,
    input.candidate.runId, input.candidate.claimId,
  ) !== undefined) return false;
  const exactSlot = db.prepare(
    `SELECT 1 FROM execution_slot WHERE singleton_id=1
      AND project_id=? AND sr_id=? AND run_id=? AND claim_id=? AND runtime_id=?`,
  ).get(
    input.candidate.projectId, input.candidate.srId, input.candidate.runId,
    input.candidate.claimId, input.candidate.runtimeId,
  );
  if (exactSlot === undefined) return false;
  if (db.prepare('SELECT 1 FROM runtime_instances WHERE runtime_id=?')
    .get(input.observedByRuntime) === undefined) {
    throw new GenerationRepositoryError('복구 observation을 기록할 현재 runtime이 등록되지 않았습니다.');
  }
  db.prepare(
    `INSERT INTO execution_observations(
       project_id,sr_id,observation_id,run_id,claim_id,observation_kind,
       observed_by_runtime,observed_at,termination_result_json,diagnostic
     ) VALUES(?,?,?,?,?,'termination_confirmed',?,?,?,?)`,
  ).run(
    input.candidate.projectId, input.candidate.srId, `observation-${randomUUID()}`,
    input.candidate.runId, input.candidate.claimId, input.observedByRuntime,
    input.observedAt,
    JSON.stringify({
      kind: 'host_reboot_confirmed',
      evidence: 'same physical host identity and changed boot session',
    }),
    'runtime-recovery-v1 trusted host reboot observer',
  );
  db.prepare(
    `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
            claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL
      WHERE singleton_id=1 AND project_id=? AND sr_id=? AND run_id=? AND claim_id=? AND runtime_id=?`,
  ).run(
    input.candidate.projectId, input.candidate.srId, input.candidate.runId,
    input.candidate.claimId, input.candidate.runtimeId,
  );
  if (!removeRecoveredRuntimeRegistration(db, input.candidate.runtimeId)) {
    throw new GenerationRepositoryError('종료를 확인한 이전 runtime 활성 등록을 해제하지 못했습니다.');
  }
  return true;
}

function assertClaimStateConsistent(db: DatabaseConnection): boolean {
  const slot = activeSlot(db);
  const running = db.prepare(
    `SELECT project_id,sr_id,run_id,claim_id FROM generation_runs
      WHERE status='running' ORDER BY requested_at,run_id`,
  ).all() as Array<{
    readonly project_id: string;
    readonly sr_id: string;
    readonly run_id: string;
    readonly claim_id: string;
  }>;
  if (slot.run_id === null) {
    if (
      slot.project_id !== null || slot.sr_id !== null || slot.claim_id !== null ||
      slot.claim_token_hash !== null || slot.runtime_id !== null || slot.launch_intent_id !== null ||
      running.length !== 0
    ) throw new GenerationRepositoryError('실행 slot과 running Run 상태가 일치하지 않습니다.');
    return false;
  }
  if (
    slot.project_id === null || slot.sr_id === null || slot.claim_id === null ||
    slot.claim_token_hash === null || slot.runtime_id === null || slot.launch_intent_id === null ||
    running.length > 1 ||
    (running.length === 1 && (
      running[0]?.project_id !== slot.project_id || running[0].sr_id !== slot.sr_id ||
      running[0].run_id !== slot.run_id || running[0].claim_id !== slot.claim_id
    ))
  ) throw new GenerationRepositoryError('실행 slot과 running Run 상태가 일치하지 않습니다.');
  const claim = db.prepare(
    `SELECT ownership_token_hash,owner_runtime_id,launch_intent_id FROM execution_claims
      WHERE project_id=? AND sr_id=? AND run_id=? AND claim_id=?`,
  ).get(slot.project_id, slot.sr_id, slot.run_id, slot.claim_id) as {
    readonly ownership_token_hash: string;
    readonly owner_runtime_id: string;
    readonly launch_intent_id: string;
  } | undefined;
  if (
    claim === undefined || claim.ownership_token_hash !== slot.claim_token_hash ||
    claim.owner_runtime_id !== slot.runtime_id || claim.launch_intent_id !== slot.launch_intent_id
  ) throw new GenerationRepositoryError('실행 slot과 claim 근거가 일치하지 않습니다.');
  const slottedRun = db.prepare(
    `SELECT claim_id FROM generation_runs WHERE project_id=? AND sr_id=? AND run_id=?`,
  ).get(slot.project_id, slot.sr_id, slot.run_id) as { readonly claim_id: string | null } | undefined;
  if (slottedRun?.claim_id !== slot.claim_id) {
    throw new GenerationRepositoryError('실행 slot이 가리키는 Run과 claim이 일치하지 않습니다.');
  }
  return true;
}

export function claimNextGenerationRun(
  db: DatabaseConnection,
  input: {
    readonly runtimeId: string;
    readonly claimedAt: string;
    readonly executionPolicy: ExecutionPolicy;
    readonly issue: (runId: string, claimId: string) => ClaimCapabilityInput;
  },
): ClaimedRun | null {
  const activeRuntime = db.prepare(
    'SELECT 1 FROM runtime_instances WHERE runtime_id=?',
  ).get(input.runtimeId);
  if (activeRuntime === undefined) throw new GenerationRepositoryError('등록되지 않은 runtime은 Run을 인수할 수 없습니다.');
  if (assertClaimStateConsistent(db)) return null;
  const pending = db.prepare(
    `SELECT project_id,sr_id,run_id,input_snapshot_id FROM generation_runs
      WHERE status='pending' ORDER BY requested_at,run_id LIMIT 1`,
  ).get() as {
    readonly project_id: string;
    readonly sr_id: string;
    readonly run_id: string;
    readonly input_snapshot_id: string;
  } | undefined;
  if (pending === undefined) return null;
  const claimId = `claim-${randomUUID()}`;
  const launchIntentId = `launch-${randomUUID()}`;
  const issued = input.issue(pending.run_id, claimId);
  if (issued.claimRef.runId !== pending.run_id || issued.claimRef.claimId !== claimId) {
    throw new GenerationRepositoryError('발급한 claim capability가 Run과 일치하지 않습니다.');
  }
  const scope: SrScope = {
    kind: 'sr', projectId: pending.project_id, srId: pending.sr_id,
  };
  db.prepare(
    `INSERT INTO execution_claims(
       project_id,sr_id,run_id,claim_id,owner_runtime_id,ownership_token_hash,
       claimed_at,execution_policy_ref,launch_intent_id
     ) VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(
    scope.projectId, scope.srId, pending.run_id, claimId, input.runtimeId,
    issued.tokenHash, input.claimedAt, input.executionPolicy.profileVersion, launchIntentId,
  );
  const changed = db.prepare(
    `UPDATE generation_runs SET status='running',revision=revision+1,claim_id=?,started_at=?
      WHERE project_id=? AND sr_id=? AND run_id=? AND status='pending'`,
  ).run(claimId, input.claimedAt, scope.projectId, scope.srId, pending.run_id).changes;
  if (changed !== 1) throw new GenerationRepositoryError('pending Run 인수 경합을 확정하지 못했습니다.');
  const slotted = db.prepare(
    `UPDATE execution_slot SET project_id=?,sr_id=?,run_id=?,claim_id=?,claim_token_hash=?,
            runtime_id=?,launch_intent_id=? WHERE singleton_id=1 AND run_id IS NULL`,
  ).run(
    scope.projectId, scope.srId, pending.run_id, claimId, issued.tokenHash,
    input.runtimeId, launchIntentId,
  ).changes;
  if (slotted !== 1) throw new GenerationRepositoryError('singleton 실행 slot을 점유하지 못했습니다.');
  const snapshot = readInputSnapshot(db, scope, pending.input_snapshot_id);
  const run = readGenerationRun(db, scope, pending.run_id);
  if (snapshot === undefined || run === undefined) {
    throw new GenerationRepositoryError('인수한 Run의 고정 입력을 읽을 수 없습니다.');
  }
  return {
    claimRef: issued.claimRef,
    snapshot,
    selection: run.requestedSelection,
    executionPolicy: input.executionPolicy,
  };
}

export function readStoredGenerationClaim(
  db: DatabaseConnection,
  claimRef: Pick<ClaimRef, 'runId' | 'claimId'>,
): StoredGenerationClaim | undefined {
  const rows = db.prepare(
    `SELECT c.project_id,c.sr_id,c.run_id,c.claim_id,c.owner_runtime_id,c.ownership_token_hash,
            c.launch_intent_id,c.execution_policy_ref,r.status
       FROM execution_claims c JOIN generation_runs r
         ON r.project_id=c.project_id AND r.sr_id=c.sr_id AND r.run_id=c.run_id
      WHERE c.run_id=? AND c.claim_id=?`,
  ).all(claimRef.runId, claimRef.claimId) as Array<{
    readonly project_id: string;
    readonly sr_id: string;
    readonly run_id: string;
    readonly claim_id: string;
    readonly owner_runtime_id: string;
    readonly ownership_token_hash: string;
    readonly launch_intent_id: string;
    readonly execution_policy_ref: string;
    readonly status: GenerationRunView['status'];
  }>;
  if (rows.length > 1) throw new GenerationRepositoryError('claim 식별자가 둘 이상의 scope에 연결됐습니다.');
  const row = rows[0];
  return row === undefined ? undefined : {
    scope: { kind: 'sr', projectId: row.project_id, srId: row.sr_id },
    runId: row.run_id,
    claimId: row.claim_id,
    ownerRuntimeId: row.owner_runtime_id,
    tokenHash: row.ownership_token_hash,
    launchIntentId: row.launch_intent_id,
    executionPolicyRef: row.execution_policy_ref,
    status: row.status,
  };
}

function executionPayload(report: ExecutionReport): string {
  return JSON.stringify({
    execution: {
      providerId: report.providerId,
      ...(report.actualModelId === undefined ? {} : { actualModelId: report.actualModelId }),
      ...(report.cliVersion === undefined ? {} : { cliVersion: report.cliVersion }),
      profileVersion: report.profileVersion,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      ...(report.exitCode === undefined ? {} : { exitCode: report.exitCode }),
      ...(report.terminationSignal === undefined ? {} : { terminationSignal: report.terminationSignal }),
      stdoutBytes: report.stdoutBytes,
      stderrBytes: report.stderrBytes,
      stdoutClosed: report.stdoutClosed,
      stderrClosed: report.stderrClosed,
    },
  });
}

function insertInternalActivity(
  db: DatabaseConnection,
  input: {
    readonly claim: StoredGenerationClaim;
    readonly occurredAt: string;
    readonly eventType: 'generation_completed' | 'generation_failed';
  },
): void {
  const targetRef: EntityRef<'generation_run'> = {
    kind: 'generation_run', projectId: input.claim.scope.projectId,
    srId: input.claim.scope.srId, entityId: input.claim.runId,
  };
  db.prepare(
    `INSERT INTO activity_events(
       project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
       occurred_at,receipt_id,internal_basis_json,description,payload_json
     ) VALUES(?,?,?,?,?,?,?, ?,NULL,?,?,'{}')`,
  ).run(
    input.claim.scope.projectId,
    `activity-${randomUUID()}`,
    input.claim.scope.srId,
    input.eventType,
    'system',
    input.claim.ownerRuntimeId,
    JSON.stringify([targetRef]),
    input.occurredAt,
    JSON.stringify({
      runId: input.claim.runId,
      claimId: input.claim.claimId,
      runtimeId: input.claim.ownerRuntimeId,
    }),
    input.eventType === 'generation_completed'
      ? '생성 결과를 첫 terminal로 확정했습니다.'
      : '생성 실패를 첫 terminal로 확정했습니다.',
  );
}

export function completeClaimedGenerationRun(
  db: DatabaseConnection,
  input: {
    readonly claim: StoredGenerationClaim;
    readonly result: GenerationResult;
    readonly execution: ExecutionReport;
  },
): GenerationRunView {
  const current = readGenerationRun(db, input.claim.scope, input.claim.runId);
  if (current === undefined) throw new GenerationRepositoryError('claim Run을 찾을 수 없습니다.');
  if (current.status !== 'running') return current;
  const snapshot = readInputSnapshot(db, input.claim.scope, current.inputSnapshotId);
  if (snapshot === undefined) throw new GenerationRepositoryError('claim InputSnapshot을 찾을 수 없습니다.');
  const draftId = `draft-${randomUUID()}`;
  db.prepare(
    `INSERT INTO generation_drafts(
       project_id,sr_id,draft_id,schema_version,task_kind,body_json,
       basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,
       source_run_id,payload_json
     ) VALUES(?,?,?,1,?,?,?,?,?,?,?,'{}')`,
  ).run(
    input.claim.scope.projectId, input.claim.scope.srId, draftId, current.taskKind,
    JSON.stringify(input.result), current.inputSnapshotId, snapshot.contentFingerprint,
    JSON.stringify({ kind: 'provider', sourceRunId: current.runId }),
    input.execution.finishedAt, current.runId,
  );
  const changed = db.prepare(
    `UPDATE generation_runs SET status='succeeded',revision=revision+1,result_draft_id=?,
            finished_at=?,payload_json=?
      WHERE project_id=? AND sr_id=? AND run_id=? AND claim_id=? AND status='running'`,
  ).run(
    draftId, input.execution.finishedAt, executionPayload(input.execution),
    input.claim.scope.projectId, input.claim.scope.srId, input.claim.runId, input.claim.claimId,
  ).changes;
  if (changed !== 1) throw new GenerationRepositoryError('생성 완료의 first-terminal 조건이 바뀌었습니다.');
  insertInternalActivity(db, {
    claim: input.claim, occurredAt: input.execution.finishedAt, eventType: 'generation_completed',
  });
  const stored = readGenerationRun(db, input.claim.scope, input.claim.runId);
  if (stored === undefined) throw new GenerationRepositoryError('완료한 Run을 읽을 수 없습니다.');
  return stored;
}

export function failClaimedGenerationRun(
  db: DatabaseConnection,
  input: {
    readonly claim: StoredGenerationClaim;
    readonly failure: ProviderFailureCore;
    readonly execution: ExecutionReport;
  },
): GenerationRunView {
  const current = readGenerationRun(db, input.claim.scope, input.claim.runId);
  if (current === undefined) throw new GenerationRepositoryError('claim Run을 찾을 수 없습니다.');
  if (current.status !== 'running') return current;
  const changed = db.prepare(
    `UPDATE generation_runs SET status='failed',revision=revision+1,error_code=?,
            finished_at=?,payload_json=?
      WHERE project_id=? AND sr_id=? AND run_id=? AND claim_id=? AND status='running'`,
  ).run(
    input.failure.code, input.execution.finishedAt, executionPayload(input.execution),
    input.claim.scope.projectId, input.claim.scope.srId, input.claim.runId, input.claim.claimId,
  ).changes;
  if (changed !== 1) throw new GenerationRepositoryError('생성 실패의 first-terminal 조건이 바뀌었습니다.');
  insertInternalActivity(db, {
    claim: input.claim, occurredAt: input.execution.finishedAt, eventType: 'generation_failed',
  });
  const stored = readGenerationRun(db, input.claim.scope, input.claim.runId);
  if (stored === undefined) throw new GenerationRepositoryError('실패한 Run을 읽을 수 없습니다.');
  return stored;
}

function terminationResult(value: string): ExecutionTermination['result'] {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch {
    throw new GenerationRepositoryError('저장된 종료 observation JSON이 올바르지 않습니다.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GenerationRepositoryError('저장된 종료 observation이 객체가 아닙니다.');
  }
  const result = parsed as Record<string, unknown>;
  if (result.kind === 'exited' && Number.isInteger(result.exitCode) &&
    (result.signal === undefined || typeof result.signal === 'string')) {
    return {
      kind: 'exited', exitCode: Number(result.exitCode),
      ...(result.signal === undefined ? {} : { signal: result.signal }),
    };
  }
  if ((result.kind === 'no_process_created' || result.kind === 'host_reboot_confirmed') &&
    typeof result.evidence === 'string' && result.evidence.length > 0) {
    return { kind: result.kind, evidence: result.evidence };
  }
  if (result.kind === 'restricted_scope_exited' &&
    typeof result.scopePolicyRef === 'string' && /^sha256:[0-9a-f]{64}$/u.test(result.scopePolicyRef) &&
    (result.exitCode === null || Number.isInteger(result.exitCode)) &&
    (result.signal === undefined || typeof result.signal === 'string')) {
    return {
      kind: 'restricted_scope_exited',
      scopePolicyRef: result.scopePolicyRef,
      exitCode: result.exitCode === null ? null : Number(result.exitCode),
      ...(result.signal === undefined ? {} : { signal: result.signal }),
    };
  }
  throw new GenerationRepositoryError('저장된 종료 observation 결과가 올바르지 않습니다.');
}

export function readExecutionObservation(
  db: DatabaseConnection,
  claimRef: ClaimRef,
): ExecutionObservation | undefined {
  const rows = db.prepare(
    `SELECT observation_id,observed_at,termination_result_json FROM execution_observations
      WHERE run_id=? AND claim_id=?`,
  ).all(claimRef.runId, claimRef.claimId) as Array<{
    readonly observation_id: string;
    readonly observed_at: string;
    readonly termination_result_json: string;
  }>;
  if (rows.length > 1) throw new GenerationRepositoryError('종료 observation이 둘 이상의 scope에 연결됐습니다.');
  const row = rows[0];
  return row === undefined ? undefined : {
    observationId: row.observation_id,
    claimRef,
    observationKind: 'termination_confirmed',
    observedAt: row.observed_at,
    result: terminationResult(row.termination_result_json),
  };
}

export function insertExecutionObservation(
  db: DatabaseConnection,
  input: {
    readonly claim: StoredGenerationClaim;
    readonly termination: ExecutionTermination;
    readonly observationId: string;
    readonly observedByRuntime: string;
  },
): ExecutionObservation {
  db.prepare(
    `INSERT INTO execution_observations(
       project_id,sr_id,observation_id,run_id,claim_id,observation_kind,
       observed_by_runtime,observed_at,termination_result_json,diagnostic
     ) VALUES(?,?,?,?,?,'termination_confirmed',?,?,?,?)`,
  ).run(
    input.claim.scope.projectId, input.claim.scope.srId, input.observationId,
    input.claim.runId, input.claim.claimId, input.observedByRuntime,
    input.termination.observedAt, JSON.stringify(input.termination.result),
    input.termination.diagnostic ?? null,
  );
  db.prepare(
    `UPDATE execution_slot SET project_id=NULL,sr_id=NULL,run_id=NULL,claim_id=NULL,
            claim_token_hash=NULL,runtime_id=NULL,launch_intent_id=NULL
      WHERE singleton_id=1 AND project_id=? AND sr_id=? AND run_id=? AND claim_id=?`,
  ).run(
    input.claim.scope.projectId, input.claim.scope.srId,
    input.claim.runId, input.claim.claimId,
  );
  return {
    observationId: input.observationId,
    claimRef: input.termination.claimRef,
    observationKind: 'termination_confirmed',
    observedAt: input.termination.observedAt,
    result: input.termination.result,
  };
}

export function cancelGenerationRun(
  db: DatabaseConnection,
  input: {
    readonly scope: SrScope;
    readonly runId: string;
    readonly actorId: string;
    readonly cancelledAt: string;
  },
): boolean {
  return db.prepare(
    `UPDATE generation_runs
        SET status='cancelled',revision=revision+1,cancelled_by=?,cancelled_at=?
      WHERE project_id=? AND sr_id=? AND run_id=? AND status IN ('pending','running')`,
  ).run(
    input.actorId,
    input.cancelledAt,
    input.scope.projectId,
    input.scope.srId,
    input.runId,
  ).changes === 1;
}

export function insertGenerationActivity(
  db: DatabaseConnection,
  input: {
    readonly scope: SrScope;
    readonly actorId: string;
    readonly receiptId: string;
    readonly runId: string;
    readonly occurredAt: string;
    readonly eventType: 'generation_requested' | 'generation_cancelled' | 'generation_retried';
    readonly description: string;
  },
): void {
  const targetRef: EntityRef<'generation_run'> = {
    kind: 'generation_run',
    projectId: input.scope.projectId,
    srId: input.scope.srId,
    entityId: input.runId,
  };
  db.prepare(
    `INSERT INTO activity_events(
       project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
       occurred_at,receipt_id,internal_basis_json,description,payload_json
     ) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,'{}')`,
  ).run(
    input.scope.projectId,
    `activity-${randomUUID()}`,
    input.scope.srId,
    input.eventType,
    'user',
    input.actorId,
    JSON.stringify([targetRef]),
    input.occurredAt,
    input.receiptId,
    input.description,
  );
}
