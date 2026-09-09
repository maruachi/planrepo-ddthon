import { Worker } from 'node:worker_threads';
import { DomainError } from '../../shared/errors.js';
import type { DiffContent, DiffInput, DiffPort } from './diff-contracts.js';
export class DiffWorkerAdapter implements DiffPort {
  private worker: Worker | null = null;
  private active: ((reason: string) => void) | null = null;
  private closed = false;
  constructor(private workerPath: string | URL, private timeout = 2000, private factory = (path: string | URL) => new Worker(path, { execArgv: [] })) {}
  compare(input: DiffInput, signal?: AbortSignal): Promise<DiffContent> {
    if (this.closed || signal?.aborted) return Promise.reject(new DomainError({ code: 'COMPARE_FAILED', message: '비교가 취소되었습니다.' }));
    if (this.active) return Promise.reject(new DomainError({ code: 'COMPARE_BUSY', message: '다른 비교가 진행 중입니다. 잠시 후 다시 비교해 주세요.' }));
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try { worker = this.worker ??= this.factory(this.workerPath); } catch { reject(new DomainError({ code: 'COMPARE_FAILED', message: '비교 워커를 시작하지 못했습니다.' })); return; }
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.off('message', success); worker.off('error', error); worker.off('exit', exit); this.active = null; };
      const fail = (reason: string) => { cleanup(); this.worker = null; void worker.terminate(); reject(new DomainError({ code: 'COMPARE_FAILED', message: reason })); };
      const success = (content: DiffContent) => { cleanup(); resolve(content); };
      const error = () => fail('비교 중 오류가 발생했습니다. 다시 비교해 주세요.');
      const exit = () => fail('비교 워커가 종료되었습니다. 다시 비교해 주세요.');
      const cancel = () => fail('비교가 취소되었습니다.');
      const timer = setTimeout(() => fail('비교 응답 시간이 초과되었습니다. 다시 비교해 주세요.'), this.timeout);
      this.active = fail; worker.once('message', success); worker.once('error', error); worker.once('exit', exit); signal?.addEventListener('abort', cancel, { once: true });
      try { worker.postMessage(input); } catch { error(); }
    });
  }
  async close(): Promise<void> { this.closed = true; this.active?.('앱이 종료되어 비교를 중단했습니다.'); const worker = this.worker; this.worker = null; if (worker) await worker.terminate(); }
}
