import type { WorktreeDocumentView } from '../contracts.js';

export interface WorktreeEditorState {
  path: string;
  expectedHash: string;
  original: string;
  draft: string;
}

export function beginWorktreeEdit(view: WorktreeDocumentView): WorktreeEditorState {
  return { path: view.path, expectedHash: view.hash, original: view.body, draft: view.body };
}

export function editWorktreeDraft(state: WorktreeEditorState, draft: string): WorktreeEditorState {
  return { ...state, draft };
}

export function isWorktreeDraftDirty(state: WorktreeEditorState): boolean {
  return state.original !== state.draft;
}
