import { useEffect, useRef, type ReactNode } from 'react';
export function ConfirmDialog({ title, children, confirm, cancel, label = '확인', busy = false, cancelDisabled = false }: { title: string; children: ReactNode; confirm: () => void; cancel: () => void; label?: string; busy?: boolean; cancelDisabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby="confirm-title" onCancel={e => { e.preventDefault(); if (!busy && !cancelDisabled) cancel(); }}><h2 id="confirm-title">{title}</h2><div>{children}</div><div className="actions"><button data-testid="confirm-cancel-button" autoFocus disabled={busy || cancelDisabled} onClick={cancel}>취소</button><button className="primary" data-testid="confirm-submit-button" disabled={busy} onClick={confirm}>{busy ? '처리 중…' : label}</button></div></dialog>;
}
