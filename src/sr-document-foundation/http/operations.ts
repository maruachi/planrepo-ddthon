import { createHash } from 'node:crypto';
import type { ActorContext, CommandContext, CommandReceipt, LocalCommand, MutationResult, OperationStatus, Result, SR } from '../../shared/contracts.js';
import { fail, result, unwrap } from '../../shared/errors.js';
import type { StorePort } from '../storage/store-port.js';
export class Operations {
  private pending = new Map<string, string>();
  constructor(private store: StorePort) {}
  context(operationId: string, c: LocalCommand, actor: ActorContext): CommandContext {
    const fields = c.kind === 'create' ? [c.input.title, c.input.description, c.input.attachmentMarkdown ?? null, c.input.attachmentDisplayName ?? null] : c.kind === 'edit' ? [c.target.srId, c.target.documentId, c.target.versionId, c.body] : [c.source.srId, c.source.documentId, c.source.versionId];
    return { operationId, kind: c.kind, fingerprint: createHash('sha256').update(JSON.stringify([c.kind, fields, actor.source, actor.role ?? null])).digest('hex') };
  }
  status(operationId: string): Result<OperationStatus> { return result(() => {
    const r = unwrap(this.store.read({ kind: 'receipt', operationId }));
    if (r) { const { fingerprint: _, ...receipt } = r; return { status: 'committed', receipt }; }
    return { status: this.pending.has(operationId) ? 'in_progress' : 'unknown' };
  }); }
  private replay(context: CommandContext): SR | MutationResult | null {
    const r = unwrap(this.store.read({ kind: 'receipt', operationId: context.operationId })); if (!r) return null;
    if (r.fingerprint !== context.fingerprint || r.kind !== context.kind) fail('OPERATION_CONFLICT', '같은 요청 식별자에 다른 내용이 있습니다.');
    return this.resolve(r);
  }
  resolve(r: CommandReceipt): SR | MutationResult {
    if (r.kind === 'create') return unwrap(this.store.read({ kind: 'sr', srId: r.srId }));
    if (!r.ref) fail('OUTCOME_UNKNOWN', '저장 결과를 다시 확인해 주세요.');
    return { view: unwrap(this.store.read({ kind: 'version', target: r.ref })), changed: r.changed };
  }
  async execute(context: CommandContext, work: () => Result<SR | MutationResult> | Promise<Result<SR | MutationResult>>): Promise<Result<SR | MutationResult>> {
    const prior = result(() => this.replay(context)); if (!prior.ok) return prior; if (prior.data) return { ok: true, data: prior.data };
    const active = this.pending.get(context.operationId);
    if (active) return { ok: false, error: { code: active === context.fingerprint ? 'IN_PROGRESS' : 'OPERATION_CONFLICT', message: '같은 식별자의 요청을 확인 중입니다.', operationId: context.operationId } };
    this.pending.set(context.operationId, context.fingerprint);
    try {
      const response = await work();
      if (!response.ok) { const saved = result(() => this.replay(context)); if (!saved.ok) return saved; if (saved.data) return { ok: true, data: saved.data }; }
      return response;
    } finally { this.pending.delete(context.operationId); }
  }
}
