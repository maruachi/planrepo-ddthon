import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { services } from './helpers/test-db.js';
import { SRService } from '../../src/sr-document-foundation/services/sr-service.js';
import { DocumentService } from '../../src/sr-document-foundation/services/document-service.js';
import { compareLines } from '../../src/sr-document-foundation/compare/line-diff.js';
import { AUTHOR } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
import { LIMITS } from '../../src/shared/limits.js';
test('create validates bytes/Unicode while preserving original description and empty attachment', () => {
  const t = services(); try {
    for (const input of [{ title: ' ', description: 'a' }, { title: 'a', description: ' ' }, { title: 'a', description: '\ud800' }, { title: '가'.repeat(1366), description: 'a' }]) expect(t.sr.create(input, AUTHOR).ok).toBe(false);
    const s = unwrap(t.sr.create({ title: ' 제목 ', description: ' \r\n설명 \n', attachmentMarkdown: '' }, AUTHOR));
    expect(s.title).toBe('제목'); expect(s.description).toBe(' \r\n설명 \n'); expect(s.attachmentMarkdown).toBe(''); expect(unwrap(t.docs.listDocuments(s.id)).items).toEqual([]);
    expect(t.sr.create({ title: 'a'.repeat(LIMITS.title), description: 'x'.repeat(LIMITS.text) }, AUTHOR).ok).toBe(true);
    expect(t.sr.create({ title: 'a', description: 'x'.repeat(LIMITS.text + 1) }, AUTHOR)).toMatchObject({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
  } finally { t.close(); }
});
test('edit and restore create new immutable versions; no-op edit differs from explicit restore', async () => {
  const t = services(); try {
    const sr = unwrap(t.sr.create({ title: 'SR', description: '설명' }, AUTHOR));
    const changes = unwrap(t.docs.prepareGenerated(sr.id, randomUUID(), [{ logicalKey: 'requirements', title: '원래 제목', body: '원본\r\n' }])); unwrap(t.store.commit(changes)); const v1 = changes.pointers[0];
    const v2 = unwrap(t.docs.edit(v1, '수정\n', AUTHOR)).view;
    expect(v2.versionNumber).toBe(2); expect(unwrap(t.docs.readVersion(v1)).body).toBe('원본\r\n');
    expect(t.docs.edit(v1, 'stale', AUTHOR)).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(unwrap(t.docs.edit(v2, v2.body, AUTHOR)).changed).toBe(false);
    const v3 = unwrap(t.docs.restore(v1, AUTHOR)).view; expect(v3).toMatchObject({ body: '원본\r\n', title: '원래 제목', versionNumber: 3, sourceVersionId: v1.versionId, baseVersionId: v2.versionId });
    expect(unwrap(t.docs.restore(v3, AUTHOR)).view.versionNumber).toBe(4);
    const latest = unwrap(t.docs.readVersion(unwrap(t.docs.readVersion(v1)).latestVersionRef));
    expect(unwrap(t.docs.edit(latest, '', AUTHOR)).view.body).toBe('');
    const before = t.db.prepare('SELECT count(*) AS n FROM history_events').get();
    expect(unwrap(await t.docs.compare(v1, v2)).unchanged).toBe(false);
    expect(t.db.prepare('SELECT count(*) AS n FROM history_events').get()).toEqual(before);
  } finally { t.close(); }
});
