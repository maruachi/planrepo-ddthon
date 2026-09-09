import { useEffect, useRef, useState } from 'react';
import type { DocumentView } from '../../shared/contracts.js';
import { api } from '../../shared/client/api-client.js';
import { OperationTracker, type OperationState } from '../../shared/client/operation-tracker.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { ErrorNotice } from './ErrorNotice.js';
export function RestoreConfirm({ view, saved, cancel }: { view: DocumentView; saved: (v: DocumentView, changed: boolean) => void; cancel: () => void }) {
  const [retry, setRetry] = useState(false); const [state, setState] = useState<OperationState>({ status: 'idle' }); const tracker = useRef(new OperationTracker(api, setState));
  useEffect(() => { if (state.status === 'succeeded' && state.data && 'view' in state.data) saved(state.data.view, true); }, [state]);
  if (retry) return <ConfirmDialog title="새 복원 시도를 준비할까요?" label="확인하고 새 시도 준비" cancel={() => setRetry(false)} confirm={() => { tracker.current.reset(); setRetry(false); }}><p>이전 요청이 나중에 완료되면 복원 버전이 중복 생성될 수 있습니다. 결과를 다시 확인한 뒤 새로 시도하는 것을 권장합니다.</p></ConfirmDialog>;
  return <ConfirmDialog title="이 내용을 새 버전으로 복원" label={state.status === 'unknown' ? '결과 다시 확인' : '새 버전으로 복원'} busy={state.status === 'saving'} cancelDisabled={state.status === 'unknown'} cancel={cancel} confirm={() => state.status === 'unknown' ? void tracker.current.check() : void tracker.current.submit(`/api/srs/${view.srId}/documents/${view.documentId}/restorations`, { versionId: view.versionId })}><p><strong>{view.title} · v{view.versionNumber}</strong></p><p>선택한 제목과 본문이 새 버전으로 저장됩니다. 원본과 복원 전 최신 버전은 계속 열람할 수 있습니다.</p><ErrorNotice error={state.error} /><p role="status">{state.message}</p>{state.status === 'unknown' && <button data-testid="restore-new-attempt-button" onClick={() => setRetry(true)}>새 시도 준비</button>}</ConfirmDialog>;
}
