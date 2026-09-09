import type { ActorContext, LocalCommand, LocalQuery, Result } from '../../shared/contracts.js';
import { LIMITS } from '../../shared/limits.js';
import type { StorePort } from '../storage/store-port.js';
import type { SRService } from '../services/sr-service.js';
import type { DocumentService } from '../services/document-service.js';
import { Operations } from './operations.js';
export class LocalAppBoundary {
  readonly operations: Operations;
  constructor(private sr: SRService, private docs: DocumentService, private store: StorePort) { this.operations = new Operations(store); }
  async query(q: LocalQuery): Promise<Result<unknown>> {
    switch (q.kind) {
      case 'board': return this.sr.listBoard(q.options);
      case 'boardItem': return this.sr.getBoardItem(q.srId);
      case 'sr': return this.sr.getDetail(q.srId);
      case 'documents': return this.docs.listDocuments(q.srId, q.options);
      case 'version': return this.docs.readVersion(q.target);
      case 'versions': return this.docs.listVersions(q.srId, q.documentId, q.options);
      case 'history': return this.docs.listHistory(q.srId, q.documentId, q.options);
      case 'event': return this.store.read(q);
      case 'compare': return this.docs.compare(q.left, q.right, q.signal);
      case 'operation': return this.operations.status(q.operationId);
      case 'config': return { ok: true, data: LIMITS };
    }
  }
  command(c: LocalCommand, actor: ActorContext, operationId: string) {
    const context = this.operations.context(operationId, c, actor);
    return this.operations.execute(context, () => {
      switch (c.kind) {
        case 'create': return this.sr.create(c.input, actor, context);
        case 'edit': return this.docs.edit(c.target, c.body, actor, context);
        case 'restore': return this.docs.restore(c.source, actor, context);
        case 'move_board': return this.sr.moveBoard(c.srId, c.expectedColumn, c.targetColumn, actor, context);
      }
    });
  }
}
