import { randomUUID } from 'node:crypto';
import { AUTHOR, type SR } from '../../../src/shared/contracts.js';
import { emptyChanges, type ChangeSet } from '../../../src/sr-document-foundation/storage/store-port.js';
export function srFixture(): ChangeSet {
  const c = emptyChanges(); const sr: SR = { id: randomUUID(), title: '테스트 SR', description: ' 원문\r\n', attachmentMarkdown: '', createdAt: '2026-09-09T00:00:00.000Z', actor: AUTHOR, column: 'sr_list' };
  c.sr = sr; c.events.push({ id: randomUUID(), srId: sr.id, kind: 'sr_created', actor: AUTHOR, occurredAt: sr.createdAt, summary: 'SR 생성', versionRefs: [] }); return c;
}
export function documentFixture(srId: string, body = '원본\r\n', logicalKey = randomUUID()): ChangeSet {
  const c = emptyChanges(); const documentId = randomUUID(); const versionId = randomUUID(); const createdAt = '2026-09-09T00:00:00.000Z';
  c.requireSrs.push(srId); c.documents.push({ id: documentId, srId, logicalKey, latestVersionId: versionId, createdAt });
  c.versions.push({ srId, documentId, versionId, title: '테스트 문서', body, origin: 'ai_generated', createdAt, actor: { source: 'ai' }, runId: randomUUID() });
  c.pointers.push({ srId, documentId, versionId }); c.events.push({ id: randomUUID(), srId, kind: 'document_generated', actor: { source: 'ai' }, occurredAt: createdAt, summary: '준비 데이터 생성', versionRefs: c.pointers }); return c;
}
