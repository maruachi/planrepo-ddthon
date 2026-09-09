import type { DomainError } from '@/src/contracts/results';

export type CommandFeedbackState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'processing' }
  | { readonly kind: 'confirmation-required'; retry(): void }
  | { readonly kind: 'committed'; readonly message: string }
  | { readonly kind: 'replayed'; readonly message: string; readonly receiptId: string }
  | { readonly kind: 'rejected'; readonly error: DomainError };

export function CommandFeedback({ state }: { readonly state: CommandFeedbackState }) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'processing':
      return <p className="command-feedback" role="status">저장하고 있습니다.</p>;
    case 'confirmation-required':
      return (
        <div className="command-feedback warning" role="alert">
          <p>저장 결과를 확인해야 합니다. 같은 요청으로 다시 확인할 수 있습니다.</p>
          <button type="button" onClick={state.retry}>같은 요청 확인</button>
        </div>
      );
    case 'committed':
      return <p className="command-feedback success" role="status">{state.message}</p>;
    case 'replayed':
      return (
        <div className="command-feedback notice" role="status">
          <p>{state.message}</p>
        </div>
      );
    case 'rejected':
      return (
        <div className="command-feedback error" role="alert">
          <strong>{state.error.message}</strong>
          {state.error.blockers.map((blocker) => (
            <p key={`${blocker.code}-${blocker.reason}`}>{blocker.reason}</p>
          ))}
        </div>
      );
  }
}
