import { expect, test } from 'vitest';
import type { WorktreeDocumentView } from '../../../src/worktree-spike/contracts.js';
import { beginWorktreeEdit, editWorktreeDraft, isWorktreeDraftDirty } from '../../../src/worktree-spike/ui/worktree-editor-state.js';

const view: WorktreeDocumentView = {
  srId: 'sr-1', path: 'aidlc-docs/plan.md', versionId: 'version-1', versionNumber: 1, hash: 'a'.repeat(64), body: '# plan\n', origin: 'ai_generated', createdAt: '2026-09-09T00:00:00.000Z', isLatest: true, change: 'created', editable: true,
};

test('keeps the original hash and body while tracking a mutable dirty draft', () => {
  const initial = beginWorktreeEdit(view);
  expect(initial).toEqual({ path: view.path, expectedHash: view.hash, original: view.body, draft: view.body });
  expect(isWorktreeDraftDirty(initial)).toBe(false);
  const edited = editWorktreeDraft(initial, '# edited\n');
  expect(isWorktreeDraftDirty(edited)).toBe(true);
  expect(edited).toMatchObject({ expectedHash: view.hash, original: view.body, draft: '# edited\n' });
  expect(initial.draft).toBe(view.body);
});
