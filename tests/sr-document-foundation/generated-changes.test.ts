import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { services } from './helpers/test-db.js';
import { AUTHOR } from '../../src/shared/contracts.js';
import { unwrap } from '../../src/shared/errors.js';
test('generation prepares without writes and rejects duplicates, empty AI bodies and stale commits', () => {
  const t = services(); try {
    const s = unwrap(t.sr.create({ title: 'SR', description: '설명' }, AUTHOR)); const run = randomUUID(); const a = { logicalKey: 'plan', title: '계획', body: '첫 내용' };
    const c = unwrap(t.docs.prepareGenerated(s.id, run, [a])); expect(unwrap(t.docs.listDocuments(s.id)).items).toEqual([]);
    expect(unwrap(t.docs.prepareGenerated(s.id, run, [])).versions).toEqual([]);
    for (const artifacts of [[a, a], [{ ...a, body: ' ' }], [{ ...a, logicalKey: '' }]]) expect(t.docs.prepareGenerated(s.id, run, artifacts).ok).toBe(false);
    unwrap(t.store.commit(c)); const ref = c.pointers[0];
    const next = unwrap(t.docs.prepareGenerated(s.id, run, [{ ...a, documentId: ref.documentId, title: '다른 제목' }]));
    unwrap(t.docs.edit(ref, '사람 편집', AUTHOR)); expect(t.store.commit(next)).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(unwrap(t.docs.listVersions(s.id, ref.documentId)).items).toHaveLength(2);
    expect(t.docs.prepareGenerated(s.id, run, [a]).ok).toBe(false);
  } finally { t.close(); }
});
