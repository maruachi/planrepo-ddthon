import Database from 'better-sqlite3';

export type DatabaseConnection = Database.Database;

export interface DatabaseConfiguration {
  readonly journalMode: string;
  readonly synchronous: number;
  readonly foreignKeys: number;
  readonly busyTimeout: number;
  readonly recursiveTriggers: number;
}

export function configureDatabase(db: Database.Database): DatabaseConfiguration {
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 100');
  db.pragma('recursive_triggers = ON');
  return verifyDatabaseConfiguration(db);
}

export function verifyDatabaseConfiguration(db: Database.Database): DatabaseConfiguration {
  const configuration = {
    journalMode: String(db.pragma('journal_mode', { simple: true })).toLowerCase(),
    synchronous: Number(db.pragma('synchronous', { simple: true })),
    foreignKeys: Number(db.pragma('foreign_keys', { simple: true })),
    busyTimeout: Number(db.pragma('busy_timeout', { simple: true })),
    recursiveTriggers: Number(db.pragma('recursive_triggers', { simple: true })),
  };
  if (
    configuration.journalMode !== 'delete' ||
    configuration.synchronous !== 2 ||
    configuration.foreignKeys !== 1 ||
    configuration.busyTimeout !== 100 ||
    configuration.recursiveTriggers !== 1
  ) {
    throw new Error(`SQLite 연결 설정이 지원 계약과 다릅니다: ${JSON.stringify(configuration)}`);
  }
  return configuration;
}

export function openPlanRepoDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  try {
    configureDatabase(db);
    return db;
  } catch (error) {
    if (db.open) db.close();
    throw error;
  }
}
