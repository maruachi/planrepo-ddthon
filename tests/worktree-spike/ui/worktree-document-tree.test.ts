import { expect, test } from 'vitest';
import { buildWorktreeDocumentTree } from '../../../src/worktree-spike/ui/WorktreeDocumentTree.js';

test('builds and sorts a nested tree for the managed AI-DLC documents', () => {
  const document = (path: string, change: 'created' | 'modified' | 'unchanged', hash: string) => ({ srId: 'sr-1', path, change, hash, versionId: `v-${hash[0]}`, versionNumber: 1, origin: 'ai_generated' as const, createdAt: '2026-09-09T00:00:00.000Z', editable: true });
  const tree = buildWorktreeDocumentTree([
    document('aidlc-docs/inception/requirements/z.md', 'modified', 'a'.repeat(64)),
    { ...document('aidlc-docs/aidlc-state.md', 'unchanged', 'b'.repeat(64)), editable: false },
    document('aidlc-docs/inception/requirements/a.md', 'created', 'c'.repeat(64)),
  ]);

  expect(tree).toHaveLength(1);
  expect(tree[0]).toMatchObject({ name: 'aidlc-docs', path: 'aidlc-docs', kind: 'directory' });
  expect(tree[0].children.map(node => [node.kind, node.name])).toEqual([
    ['directory', 'inception'],
    ['document', 'aidlc-state.md'],
  ]);
  expect(tree[0].children[0].children[0].children.map(node => [node.name, node.change])).toEqual([
    ['a.md', 'created'],
    ['z.md', 'modified'],
  ]);
  expect(tree[0].children[0].children[0].children[0]).toMatchObject({ versionNumber: 1, origin: 'ai_generated', editable: true });
  expect(tree[0].children[1]).toMatchObject({ change: 'unchanged', editable: false });
});
