import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DemoRole } from '../../shared/review-contracts.js';
import { errorOf } from '../../shared/errors.js';
import type { AppError } from '../../shared/contracts.js';
import { useDirty } from '../../app/WorkspaceShell.js';
import { DocumentReader } from '../../sr-document-foundation/ui/DocumentReader.js';
import { ErrorNotice } from '../../sr-document-foundation/ui/ErrorNotice.js';
import { AsyncStatus } from '../../sr-document-foundation/ui/AsyncStatus.js';
import { useQuery } from '../../sr-document-foundation/ui/use-query.js';
import { isWorktreeDocumentVersionPage, isWorktreeDocumentView, worktreeSpikeClient, worktreeSpikePath } from './worktree-spike-client.js';
import { beginWorktreeEdit, editWorktreeDraft, isWorktreeDraftDirty, type WorktreeEditorState } from './worktree-editor-state.js';

export function WorktreeDocumentWorkspace({ srId, path, versionId, role, revision, changed }: { srId: string; path: string; versionId?: string; role: DemoRole; revision: number; changed: () => void }) {
  const versionParameter = versionId ? `&versionId=${encodeURIComponent(versionId)}` : '';
  const query = useQuery(`${worktreeSpikePath(srId)}/document?path=${encodeURIComponent(path)}${versionParameter}`, isWorktreeDocumentView, revision);
  const versions = useQuery(`${worktreeSpikePath(srId)}/document/versions?path=${encodeURIComponent(path)}`, isWorktreeDocumentVersionPage, revision);
  const [editor, setEditor] = useState<WorktreeEditorState>(); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState<AppError>(); const [message, setMessage] = useState('');
  const navigate = useNavigate(); const view = query.data;
  useDirty(!!editor && (isWorktreeDraftDirty(editor) || saving));
  const selectVersion = (selected: string) => {
    const latest = versions.data?.items[0]?.versionId;
    const suffix = selected === latest ? '' : `&worktreeVersionId=${encodeURIComponent(selected)}`;
    navigate(`/srs/${encodeURIComponent(srId)}?worktreePath=${encodeURIComponent(path)}${suffix}`);
  };
  const save = async () => {
    if (!editor || saving) return;
    setSaving(true); setSaveError(undefined); setMessage('');
    try {
      const result = await worktreeSpikeClient.edit(srId, { path: editor.path, expectedHash: editor.expectedHash, body: editor.draft });
      setEditor(undefined); setMessage(result.changed ? `v${result.view.versionNumber} 사람 편집 버전을 저장했습니다.` : '변경된 내용이 없습니다.');
      changed(); navigate(`/srs/${encodeURIComponent(srId)}?worktreePath=${encodeURIComponent(path)}`);
    } catch (error) { setSaveError(errorOf(error)); }
    finally { setSaving(false); }
  };
  return <section className="document-workspace worktree-document-workspace" data-testid="worktree-document-workspace">
    <ErrorNotice error={query.error} retry={query.reload} />
    <AsyncStatus loading={query.loading} />
    {view && <>
      <div className="document-heading"><div><p className="eyebrow">WORKTREE PLAN DOCUMENT</p><h2>{view.path.split('/').at(-1)}</h2><div className="version-meta"><span className={`badge ${view.isLatest ? 'success' : ''}`}>{view.isLatest ? '최신 버전' : '과거 버전'} · v{view.versionNumber}</span><span>{view.origin === 'ai_generated' ? 'AI 생성' : '사람 편집'}</span><span>{view.path}</span></div></div>
        <label className="worktree-version-picker">버전 <select data-testid="worktree-document-version-select" value={view.versionId} onChange={event => selectVersion(event.target.value)}>{versions.data?.items.map(item => <option key={item.versionId} value={item.versionId}>v{item.versionNumber} · {item.origin === 'ai_generated' ? 'AI 생성' : '사람 편집'}</option>)}</select></label>
      </div>
      <ErrorNotice error={versions.error} retry={versions.reload} />
      {!view.isLatest && <p className="notice">과거 Worktree 버전을 읽기 전용으로 보고 있습니다.</p>}
      {message && <p className="notice" role="status">{message}</p>}
      <ErrorNotice error={saveError} />
      {!editor && role === 'author' && view.isLatest && view.editable && <div className="document-actions"><button data-testid="worktree-document-edit-button" onClick={() => { setEditor(beginWorktreeEdit(view)); setMessage(''); setSaveError(undefined); }}>✎ 본문 편집</button></div>}
      {editor ? <section className="editor"><div className="notice">v{view.versionNumber} 기준 편집 · 저장하면 사람 편집 버전으로 보관됩니다.</div><label>문서 본문<textarea className="document-textarea" autoFocus spellCheck={false} data-testid="worktree-document-editor-input" disabled={saving} value={editor.draft} onChange={event => setEditor(state => state ? editWorktreeDraft(state, event.target.value) : state)} /></label><div className="editor-meta"><span>{new TextEncoder().encode(editor.draft).length.toLocaleString()} / 1,048,576 bytes</span><span>{isWorktreeDraftDirty(editor) ? '저장하지 않은 변경' : '변경 없음'}</span></div><div className="actions"><button data-testid="worktree-document-cancel-button" disabled={saving} onClick={() => setEditor(undefined)}>편집 취소</button><button className="primary" data-testid="worktree-document-save-button" disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : '새 버전 저장'}</button></div></section> : <DocumentReader key={view.versionId} view={{ body: view.body, versionId: `worktree:${view.versionId}` }} />}
    </>}
  </section>;
}
