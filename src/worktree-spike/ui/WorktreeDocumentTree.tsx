import { Link } from 'react-router-dom';
import type { WorktreeDocumentSummary } from '../contracts.js';
import { AsyncStatus } from '../../sr-document-foundation/ui/AsyncStatus.js';
import { ErrorNotice } from '../../sr-document-foundation/ui/ErrorNotice.js';
import { useQuery } from '../../sr-document-foundation/ui/use-query.js';
import { isWorktreeSpikeView, worktreeSpikePath } from './worktree-spike-client.js';

export interface WorktreeTreeNode {
  name: string;
  path: string;
  kind: 'directory' | 'document';
  change?: WorktreeDocumentSummary['change'];
  versionNumber?: number;
  origin?: WorktreeDocumentSummary['origin'];
  editable?: boolean;
  children: WorktreeTreeNode[];
}

const byKindAndName = (left: WorktreeTreeNode, right: WorktreeTreeNode) => {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name, 'ko');
};

export function buildWorktreeDocumentTree(documents: WorktreeDocumentSummary[]): WorktreeTreeNode[] {
  const roots: WorktreeTreeNode[] = [];
  for (const document of documents) {
    const segments = document.path.split('/').filter(Boolean);
    let siblings = roots;
    let currentPath = '';
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isDocument = index === segments.length - 1;
      let node = siblings.find(candidate => candidate.name === segment && candidate.kind === (isDocument ? 'document' : 'directory'));
      if (!node) {
        node = { name: segment, path: currentPath, kind: isDocument ? 'document' : 'directory', change: isDocument ? document.change : undefined, versionNumber: isDocument ? document.versionNumber : undefined, origin: isDocument ? document.origin : undefined, editable: isDocument ? document.editable : undefined, children: [] };
        siblings.push(node);
      }
      siblings = node.children;
    });
  }
  const sort = (nodes: WorktreeTreeNode[]) => nodes.sort(byKindAndName).forEach(node => sort(node.children));
  sort(roots);
  return roots;
}

function Nodes({ nodes, srId, selectedPath }: { nodes: WorktreeTreeNode[]; srId: string; selectedPath?: string }) {
  return <ul className="worktree-document-nodes">{nodes.map(node => <li key={`${node.kind}:${node.path}`}>
    {node.kind === 'directory'
      ? <details open><summary><span aria-hidden="true">▾</span> {node.name}</summary><Nodes nodes={node.children} srId={srId} selectedPath={selectedPath} /></details>
      : <Link
          className={`worktree-document-link ${selectedPath === node.path ? 'selected' : ''}`}
          aria-current={selectedPath === node.path ? 'page' : undefined}
          data-testid="worktree-document-link"
          to={`/srs/${encodeURIComponent(srId)}?worktreePath=${encodeURIComponent(node.path)}`}
        ><span aria-hidden="true">▤</span><span>{node.name}<small className="worktree-document-meta">v{node.versionNumber} · {node.origin === 'human_edit' ? '사람 편집' : 'AI 생성'}{node.editable ? '' : ' · 읽기 전용'}</small></span><small>{node.change === 'created' ? '신규' : node.change === 'modified' ? '변경' : '유지'}</small></Link>}
  </li>)}</ul>;
}

export function WorktreeDocumentTree({ srId, selectedPath, revision }: { srId: string; selectedPath?: string; revision: number }) {
  const query = useQuery(worktreeSpikePath(srId), isWorktreeSpikeView, revision);
  const tree = buildWorktreeDocumentTree(query.data?.documents ?? []);
  return <section className="worktree-document-tree" data-testid="worktree-document-tree">
    <h3>AI-DLC 문서 <span>{query.data?.documents.length ?? 0}</span></h3>
    <ErrorNotice error={query.error} retry={query.reload} />
    <AsyncStatus loading={query.loading} />
    {tree.length ? <Nodes nodes={tree} srId={srId} selectedPath={selectedPath} /> : query.data && <p className="empty">AI-DLC 실행에서 생성되거나 변경된 Markdown 문서가 없습니다.</p>}
  </section>;
}
