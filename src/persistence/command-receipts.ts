import type Database from 'better-sqlite3';
import type { CommandReceipt } from '@/src/contracts/results';
import type { TargetScope } from '@/src/contracts/context';

export interface StoredCommandReceipt<T = unknown> {
  readonly receipt: CommandReceipt;
  readonly replayValue: T;
}

export interface CommandReceiptLookup {
  readonly scope: TargetScope;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

interface CommandReceiptRow {
  readonly project_id: string;
  readonly receipt_id: string;
  readonly scope_kind: 'project' | 'sr';
  readonly scope_target_id: string;
  readonly actor_id: string;
  readonly command_kind: string;
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly input_fingerprint: string;
  readonly committed_revision: number;
  readonly result_refs_json: string;
  readonly replay_value_json: string;
  readonly committed_at: string;
}

function json(value: unknown, field: string): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError(`${field}는 JSON 값이어야 합니다.`);
  return serialized;
}

export function storeCommandReceipt<T>(
  db: Database.Database,
  input: StoredCommandReceipt<T>,
): void {
  const { receipt } = input;
  if (receipt.actorRef.projectId !== receipt.scope.projectId) {
    throw new Error('receipt actor와 scope의 projectId가 다릅니다.');
  }
  const scopeTargetId = receipt.scope.kind === 'project' ? receipt.scope.projectId : receipt.scope.srId;
  db.prepare(
    `INSERT INTO command_receipts(
       project_id, receipt_id, scope_kind, scope_target_id, actor_id,
       command_kind, request_id, idempotency_key, input_fingerprint,
       committed_revision, result_refs_json, replay_value_json, committed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    receipt.scope.projectId,
    receipt.receiptId,
    receipt.scope.kind,
    scopeTargetId,
    receipt.actorRef.actorId,
    receipt.commandKind,
    receipt.requestId,
    receipt.idempotencyKey,
    receipt.inputFingerprint,
    receipt.committedRevision,
    json(receipt.resultRefs, 'resultRefs'),
    json(input.replayValue, 'replayValue'),
    receipt.committedAt,
  );
}

export function readCommandReceipt<T>(
  db: Database.Database,
  lookup: CommandReceiptLookup,
): StoredCommandReceipt<T> | undefined {
  const scopeTargetId = lookup.scope.kind === 'project' ? lookup.scope.projectId : lookup.scope.srId;
  const row = db.prepare(
    `SELECT * FROM command_receipts
      WHERE scope_kind=? AND project_id=? AND scope_target_id=?
        AND actor_id=? AND idempotency_key=?`,
  ).get(
    lookup.scope.kind,
    lookup.scope.projectId,
    scopeTargetId,
    lookup.actorId,
    lookup.idempotencyKey,
  ) as CommandReceiptRow | undefined;
  if (row === undefined) return undefined;

  return {
    receipt: {
      scope:
        row.scope_kind === 'project'
          ? { kind: 'project', projectId: row.project_id }
          : { kind: 'sr', projectId: row.project_id, srId: row.scope_target_id },
      receiptId: row.receipt_id,
      actorRef: { actorId: row.actor_id, projectId: row.project_id },
      commandKind: row.command_kind,
      requestId: row.request_id,
      idempotencyKey: row.idempotency_key,
      inputFingerprint: row.input_fingerprint,
      committedRevision: row.committed_revision,
      resultRefs: JSON.parse(row.result_refs_json) as CommandReceipt['resultRefs'],
      committedAt: row.committed_at,
    },
    replayValue: JSON.parse(row.replay_value_json) as T,
  };
}
