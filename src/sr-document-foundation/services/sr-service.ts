import { randomUUID } from 'node:crypto';
import type { ActorContext, CommandContext, PageOptions, SR, SRDraft } from '../../shared/contracts.js';
import { fail, result, unwrap } from '../../shared/errors.js';
import { emptyChanges, type StorePort } from '../storage/store-port.js';
import { DirectSRInput, type SRInputPort } from './sr-input.js';
export class SRService {
  constructor(private store: StorePort, private input: SRInputPort = new DirectSRInput()) {}
  create(input: SRDraft, actor: ActorContext, command?: CommandContext) { return result(() => {
    const normalized = unwrap(this.input.normalize(input)); const now = new Date().toISOString();
    const sr: SR = { ...normalized, id: randomUUID(), createdAt: now, actor, column: 'sr_list' };
    const c = emptyChanges(); c.sr = sr; c.command = command; c.outcome = { kind: 'create', srId: sr.id, changed: true };
    c.events.push({ id: randomUUID(), srId: sr.id, kind: 'sr_created', actor, occurredAt: now, summary: 'SR을 생성했습니다.', versionRefs: [] });
    const receipt = unwrap(this.store.commit(c))!;
    return unwrap(this.store.read({ kind: 'sr', srId: receipt.srId }));
  }, 'STORAGE_FAILED'); }
  listBoard(options?: PageOptions) { return this.store.read({ kind: 'board', options }); }
  getDetail(srId: string) { return this.store.read({ kind: 'sr', srId }); }
  markImplemented(srId: string, actor: ActorContext, revision: number, command?: CommandContext) { return result(() => {
    if (actor.source !== 'user' || actor.role !== 'author') fail('ROLE_REQUIRED', '작성자 역할에서 완료를 표시해 주세요.');
    if (command) {
      const receipt = unwrap(this.store.read({ kind: 'receipt', operationId: command.operationId }));
      if (receipt) {
        if (receipt.kind !== command.kind || receipt.fingerprint !== command.fingerprint || receipt.srId !== srId) fail('OPERATION_CONFLICT', '같은 요청 식별자에 다른 내용이 있습니다.');
        return unwrap(this.getDetail(srId));
      }
    }
    const sr = unwrap(this.getDetail(srId)); const state = unwrap(this.store.read({ kind: 'workflow', srId }));
    if (sr.column !== 'implementation_ready' || !state || state.column !== 'implementation_ready' || state.status !== 'complete') fail('PLANNING_ACTION_BLOCKED', '구현 대기 상태에서 완료를 표시할 수 있습니다.');
    if (!Number.isSafeInteger(revision) || revision !== state.revision) fail('WORKFLOW_CONFLICT', '계획 상태가 변경되었습니다. 새로 확인해 주세요.');
    const c = emptyChanges(); c.requireSrs.push(srId); c.planning = { expectedRevision: revision, state: { ...state, column: 'implemented', revision: revision + 1 } };
    c.command = command; c.outcome = { kind: 'mark_implemented', srId, changed: true };
    c.events.push({ id: randomUUID(), srId, kind: 'implementation_marked', actor, occurredAt: new Date().toISOString(), summary: '사용자가 외부 구현 완료를 수동으로 표시했습니다.', versionRefs: [], details: { declaration: 'manual', buildVerified: false } });
    unwrap(this.store.commit(c)); return unwrap(this.getDetail(srId));
  }, 'STORAGE_FAILED'); }
}
