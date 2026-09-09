import { useEffect, useMemo, useState } from 'react';
import type { BoardView, DemoActorView, SRDetailView } from '@/src/contracts/views';
import type { invoke } from '@/src/web/api/client';
import { planState } from '../state/inception-plan';

export type PlanRepoClient = typeof invoke;

export interface MyWorkProps {
  readonly client: PlanRepoClient;
  readonly actorId: string;
  readonly projectId: string;
  readonly board: BoardView | undefined;
  readonly members: readonly DemoActorView[];
  readonly onOpen: (srId: string, tab?: string) => void;
}

type WorkKind = 'change' | 'review' | 'assignment' | 'decision' | 'document';

interface WorkItem {
  readonly key: string;
  readonly kind: WorkKind;
  readonly srId: string;
  readonly srKey: string;
  readonly srTitle: string;
  readonly action: string;
  readonly reason: string;
  readonly tab: string;
}

const PRIORITY: Readonly<Record<WorkKind, number>> = {
  change: 1,
  review: 2,
  assignment: 3,
  decision: 4,
  document: 5,
};

function sameBundle(
  left: { readonly gate: string; readonly bundleId: string; readonly version: number } | undefined,
  right: { readonly gate: string; readonly bundleId: string; readonly version: number },
): boolean {
  return left !== undefined && left.gate === right.gate &&
    left.bundleId === right.bundleId && left.version === right.version;
}

function directItems(detail: SRDetailView, actorId: string, isAdmin: boolean): readonly WorkItem[] {
  const srId = detail.sr.scope.srId;
  const base = { srId, srKey: detail.sr.key, srTitle: detail.sr.title };
  const items: WorkItem[] = [];

  for (const request of detail.changeRequests) {
    const configuration = detail.reviewConfigurations.find((item) => item.gate === request.affectedGate);
    const currentReviewer = configuration?.assignment?.reviewerIds.includes(actorId) === true;
    if (request.status === 'open' && (request.assigneeId === actorId || detail.sr.ownerId === actorId)) {
      items.push({
        ...base,
        key: `${srId}:change:${request.changeRequestId}:apply`,
        kind: 'change',
        action: '문서 수정 요청 반영하기',
        reason: request.body,
        tab: 'documents',
      });
    } else if (request.status === 'awaiting_confirmation' &&
      (request.requesterId === actorId || currentReviewer)) {
      items.push({
        ...base,
        key: `${srId}:change:${request.changeRequestId}:confirm`,
        kind: 'change',
        action: '반영된 문서 확인하기',
        reason: request.body,
        tab: 'documents',
      });
    }
  }

  for (const decision of detail.decisions) {
    if (decision.state === 'unconfirmed' && decision.decisionMakerId === actorId) {
      items.push({
        ...base,
        key: `${srId}:decision:${decision.decisionId}`,
        kind: 'decision',
        action: '결정 확정하기',
        reason: decision.prompt,
        tab: 'questions',
      });
    }
  }

  for (const request of detail.reviewRequests) {
    if (request.bundleRef.gate !== 'G1') continue;
    const configuration = detail.reviewConfigurations.find((item) => item.gate === request.bundleRef.gate);
    if (request.status === 'pending' && request.reviewerId === actorId &&
      configuration?.reviewEpoch === request.reviewEpoch && sameBundle(configuration.currentBundleRef, request.bundleRef)) {
      items.push({
        ...base,
        key: `${srId}:review:${request.requestId}`,
        kind: 'review',
        action: 'Plan 문서 검토하기',
        reason: '현재 검토본을 읽고 문단 의견이나 수정 요청을 남긴 뒤 승인 여부를 판단해 주세요.',
        tab: request.bundleRef.gate === 'G1' ? 'review-g1' : 'review',
      });
    }
  }

  if (isAdmin || detail.sr.ownerId === actorId || detail.originalDescription.authorId === actorId) {
    const gates = detail.reviewConfigurations
      .filter((item) => item.gate === 'G1')
      .filter((item) => item.assignment === undefined || !item.assignment.ready)
      .map((item) => item.gate);
    if (gates.length > 0) {
      items.push({
        ...base,
        key: `${srId}:assignment`,
        kind: 'assignment',
        action: '문서 검토자 배정하기',
        reason: 'Plan을 함께 검토할 사람을 선택해 주세요.',
        tab: 'assignment',
      });
    }
  }

  return items;
}

function ownerDocumentItem(details: readonly SRDetailView[], actorId: string): WorkItem | undefined {
  for (const detail of details) {
    if (detail.sr.ownerId !== actorId) continue;
    const base = {
      srId: detail.sr.scope.srId,
      srKey: detail.sr.key,
      srTitle: detail.sr.title,
    };
    const state = planState(detail);
    if (state === 'approved') continue;
    return { ...base, key: `${base.srId}:document:plan`, kind: 'document',
      action: state === 'review' || state === 'changes' ? '문서와 수정 요청 확인하기' : 'Plan 문서 이어서 작성',
      reason: state === 'review' || state === 'changes'
        ? '검토자가 남긴 의견과 수정 요청을 문서에서 확인해 주세요.'
        : '현재 Plan 문서를 읽고 필요한 내용을 직접 보완해 주세요.',
      tab: 'documents' };
  }
  return undefined;
}

function sortItems(items: readonly WorkItem[]): readonly WorkItem[] {
  return [...items].sort((left, right) =>
    PRIORITY[left.kind] - PRIORITY[right.kind] || left.srKey.localeCompare(right.srKey) || left.key.localeCompare(right.key));
}

export function MyWork({ client, actorId, projectId, board, members, onOpen }: MyWorkProps) {
  const [items, setItems] = useState<readonly WorkItem[]>([]);
  const [loading, setLoading] = useState(board === undefined);
  const [failedCount, setFailedCount] = useState(0);
  const [reload, setReload] = useState(0);
  const isAdmin = useMemo(
    () => members.find((member) => member.actorId === actorId)?.roles.includes('team_admin') === true,
    [actorId, members],
  );

  useEffect(() => {
    let active = true;
    if (board === undefined) {
      setItems([]);
      setLoading(true);
      setFailedCount(0);
      return () => { active = false; };
    }
    setLoading(true);
    setFailedCount(0);
    void Promise.allSettled(board.cards.map(async (card) => {
      const srId = card.sr.scope.srId;
      const result = await client('M-047', { actorId, projectId, srId }, {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    })).then((results) => {
      if (!active) return;
      const details = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const direct = details.flatMap((detail) => directItems(detail, actorId, isAdmin));
      const fallback = direct.length === 0 ? ownerDocumentItem(details, actorId) : undefined;
      setItems(sortItems(fallback === undefined ? direct : [...direct, fallback]));
      setFailedCount(results.filter((result) => result.status === 'rejected').length);
      setLoading(false);
    });
    return () => { active = false; };
  }, [actorId, board, client, isAdmin, projectId, reload]);

  return (
    <section aria-labelledby="my-work-title">
      <div className="section-heading">
        <div><p className="eyebrow">선택 사용자</p><h2 id="my-work-title">내 할 일</h2></div>
        <button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>새로고침</button>
      </div>
      {loading && <p role="status">현재 맡은 일을 확인하고 있습니다.</p>}
      {!loading && failedCount > 0 && (
        <div className="page-error" role="alert">
          <p>{items.length === 0 ? '내 할 일을 불러오지 못했습니다.' : '일부 업무를 불러오지 못했습니다.'}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>다시 시도</button>
        </div>
      )}
      {!loading && failedCount === 0 && items.length === 0 &&
        <p className="empty-state">지금 바로 처리할 일이 없습니다.</p>}
      <div className="board-grid">
        {items.map((item) => (
          <article className="sr-card" key={item.key}>
            <p className="sr-key">{item.srKey}</p>
            <h3>{item.srTitle}</h3>
            <p><strong>{item.action}</strong></p>
            <p className="card-meta">{item.reason}</p>
            <button type="button" className="text-button" onClick={() => onOpen(item.srId, item.tab)}>
              처리 화면 열기
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
