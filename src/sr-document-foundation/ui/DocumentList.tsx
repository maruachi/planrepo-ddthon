import { WorktreeDocumentTree } from '../../worktree-spike/ui/WorktreeDocumentTree.js';

export function DocumentList({ srId, selectedWorktreePath, revision }: { srId: string; selectedWorktreePath?: string; revision: number }) {
  return <aside className="document-list">
    <h2>계획 문서</h2>
    <WorktreeDocumentTree srId={srId} selectedPath={selectedWorktreePath} revision={revision} />
  </aside>;
}
