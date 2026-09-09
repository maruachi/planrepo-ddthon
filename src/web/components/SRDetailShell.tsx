import type { DemoActorView, PolicyView, SRDetailView } from '@/src/contracts/views';
import { SRDetail } from './SRDetail';
import { planStateLabel } from '../state/inception-plan';

export function SRDetailShell({ actorId, projectId, detail, loading, error, members, policies, actorName, initialTab, onBack, onRetry, onRefresh }: {
  readonly actorId: string;
  readonly projectId: string;
  readonly detail: SRDetailView | undefined;
  readonly loading: boolean;
  readonly error?: string;
  readonly members: readonly DemoActorView[];
  readonly policies: readonly PolicyView[];
  readonly initialTab?: string;
  readonly actorName: (actorId: string) => string;
  onBack(): void;
  onRetry(): void;
  onRefresh(): void;
}) {
  if (detail === undefined) {
    return (
      <section className="detail-shell">
        <div className="detail-actions"><button className="back-button" type="button" onClick={onBack}>← 팀 보드</button></div>
        {loading ? <p role="status">SR 상세를 불러오고 있습니다.</p> : error !== undefined ? (
          <div className="page-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>상세 다시 시도</button></div>
        ) : <p role="alert">SR 상세를 불러오지 못했습니다.</p>}
      </section>
    );
  }
  return (
    <section className="detail-shell" aria-labelledby="sr-detail-title">
      <div className="detail-actions">
        <button className="back-button" type="button" onClick={onBack}>← 팀 보드</button>
        <button className="text-button" type="button" onClick={onRefresh}>최신 상태 확인</button>
      </div>
      {loading && <p className="quiet" role="status">현재 입력을 유지하며 최신 상태를 확인하고 있습니다.</p>}
      {error !== undefined && <div className="page-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>상세 다시 시도</button></div>}
      <header className="detail-header">
        <div><p className="sr-key">{detail.sr.key}</p><h1 id="sr-detail-title">{detail.sr.title}</h1><p>담당자 {actorName(detail.sr.ownerId)}</p></div>
        <div className="phase-card"><span>Plan 상태</span><strong>{planStateLabel(detail)}</strong></div>
      </header>
      <SRDetail key={`${actorId}:${detail.sr.scope.srId}`} {...(initialTab === undefined ? {} : { initialTab })} actorId={actorId} projectId={projectId} detail={detail} members={members} policies={policies} actorName={actorName} onRefresh={onRefresh} />
    </section>
  );
}
