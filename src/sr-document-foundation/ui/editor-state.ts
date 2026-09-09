import type { DocumentView, VersionRef } from '../../shared/contracts.js';
export interface EditorState { base: VersionRef; original: string; draft: string }
export function beginEdit(view: DocumentView): EditorState { return { base: { srId: view.srId, documentId: view.documentId, versionId: view.versionId }, original: view.body, draft: view.body }; }
export const isDirty = (s: EditorState) => s.original !== s.draft;
export function editDraft(s: EditorState, draft: string): EditorState { return { ...s, draft }; }
export function refreshEditor(s: EditorState, _view: DocumentView): EditorState { return s; }
