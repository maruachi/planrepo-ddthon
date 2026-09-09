import type Database from 'better-sqlite3';

function hasUncertainStorageCode(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = String(error.code);
  return (
    code.startsWith('SQLITE_IOERR') ||
    code === 'SQLITE_CORRUPT' ||
    code === 'SQLITE_NOTADB' ||
    code === 'SQLITE_PROTOCOL' ||
    code === 'SQLITE_FULL' ||
    code === 'SQLITE_NOMEM' ||
    code === 'SQLITE_INTERNAL'
  );
}

function rollback(db: Database.Database): boolean {
  if (!db.open || !db.inTransaction) return true;
  try {
    db.exec('ROLLBACK');
    return !db.inTransaction;
  } catch {
    return false;
  }
}

export function rethrowAfterStorageFailure(
  db: Database.Database,
  error: unknown,
  options: { readonly discardConnection?: boolean } = {},
): never {
  const rolledBack = rollback(db);
  if (
    db.open &&
    (options.discardConnection === true || !rolledBack || hasUncertainStorageCode(error))
  ) {
    db.close();
  }
  throw error;
}
