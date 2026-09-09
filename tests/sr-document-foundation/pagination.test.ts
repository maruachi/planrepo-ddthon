import { expect, test } from 'vitest';
import { testDB } from './helpers/test-db.js';
import { srFixture, documentFixture } from './helpers/fixtures.js';
import { unwrap } from '../../src/shared/errors.js';
test('same-timestamp keyset pages have no missing or duplicate records', () => {
  const t = testDB(); try {
    for (let i = 0; i < 7; i++) unwrap(t.store.commit(srFixture()));
    let cursor: string | undefined; const ids: string[] = [];
    do { const p = unwrap(t.store.read({ kind: 'board', options: { limit: 2, cursor } })); ids.push(...p.items.map(s => s.id)); cursor = p.nextCursor ?? undefined; } while (cursor);
    expect(new Set(ids).size).toBe(7); expect(ids).toHaveLength(7);
    const s = unwrap(t.store.read({ kind: 'board', options: { limit: 1 } }));
    expect(t.store.read({ kind: 'documents', srId: ids[0], options: { cursor: s.nextCursor! } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(t.store.read({ kind: 'board', options: { limit: 101 } }).ok).toBe(false);
  } finally { t.close(); }
});
test('document and history pages omit bodies/details and support bodyless events', () => {
  const t = testDB(); try {
    const c = srFixture(); unwrap(t.store.commit(c)); const srId = c.sr!.id;
    for (let i = 0; i < 3; i++) unwrap(t.store.commit(documentFixture(srId)));
    const p = unwrap(t.store.read({ kind: 'documents', srId, options: { limit: 2 } })); expect(p.nextCursor).toBeTruthy(); expect(p.items[0]).not.toHaveProperty('body');
    expect(unwrap(t.store.read({ kind: 'documents', srId, options: { limit: 2, cursor: p.nextCursor! } })).items).toHaveLength(1);
    const events = unwrap(t.store.read({ kind: 'history', srId })).items; expect(events).toHaveLength(4); expect(events.at(-1)!.versionRefs).toEqual([]);
  } finally { t.close(); }
});
