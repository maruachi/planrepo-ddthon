import type Database from 'better-sqlite3';
import { assertSupportedSchema } from './maintenance';
import { rethrowAfterStorageFailure } from './failure';

type TransactionWork<T> = (tx: Database.Database) => T;

export interface Persistence {
  withinTransaction<T>(work: TransactionWork<T>): T;
  readConsistent<T>(work: TransactionWork<T>): T;
}

export class AsyncTransactionCallbackError extends TypeError {}

const ASYNC_FUNCTION_TAG = '[object AsyncFunction]';

function isKnownAsyncFunction(work: TransactionWork<unknown>): boolean {
  return Object.prototype.toString.call(work) === ASYNC_FUNCTION_TAG;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && 'then' in value && typeof value.then === 'function';
}

export function createPersistence(db: Database.Database): Persistence {
  const run = <T>(mode: 'immediate' | 'deferred', work: TransactionWork<T>): T => {
    if (isKnownAsyncFunction(work)) {
      throw new AsyncTransactionCallbackError('transaction callback은 동기 함수여야 합니다.');
    }

    let returnedThenable = false;
    const transaction = db.transaction(() => {
      assertSupportedSchema(db);
      const result = work(db);
      if (isThenable(result)) {
        returnedThenable = true;
        if (result instanceof Promise) void result.catch(() => undefined);
        throw new AsyncTransactionCallbackError(
          'transaction callback은 Promise나 thenable을 반환할 수 없습니다.',
        );
      }
      return result;
    });

    try {
      return mode === 'immediate' ? transaction.immediate() : transaction.deferred();
    } catch (error) {
      rethrowAfterStorageFailure(db, error, { discardConnection: returnedThenable });
    }
  };

  return {
    withinTransaction<T>(work: TransactionWork<T>): T {
      return run('immediate', work);
    },
    readConsistent<T>(work: TransactionWork<T>): T {
      return run('deferred', work);
    },
  };
}
