import type { AppError } from '../../shared/contracts.js';
export function ErrorNotice({ error, retry }: { error?: AppError; retry?: () => void }) { return error ? <div className="notice error" role="alert"><p>{error.message}</p>{retry && <button data-testid="error-retry-button" onClick={retry}>다시 읽기</button>}</div> : null; }
