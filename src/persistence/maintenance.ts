import type Database from 'better-sqlite3';
import {
  PLANREPO_MIGRATIONS,
  type AppMigration,
} from './migrations';
import { rethrowAfterStorageFailure } from './failure';

interface MigrationRow {
  readonly number: number;
  readonly checksum: string;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName) !== undefined;
}

function assertNoMaintenanceBlockers(db: Database.Database): void {
  const maintenance = db.prepare('SELECT owner_id FROM maintenance_state WHERE singleton_id=1').get() as {
    owner_id: string | null;
  };
  if (maintenance.owner_id !== null) throw new Error('maintenance가 이미 진행 중입니다.');
  const runtime = db.prepare('SELECT runtime_id FROM runtime_instances LIMIT 1').get();
  if (runtime !== undefined) throw new Error('runtime이 등록된 DB에서는 offline maintenance를 시작할 수 없습니다.');
  const slot = db.prepare('SELECT run_id FROM execution_slot WHERE singleton_id=1').get() as { run_id: string | null };
  if (slot.run_id !== null) throw new Error('실행 슬롯이 점유된 DB에서는 offline maintenance를 시작할 수 없습니다.');
  const running = db.prepare("SELECT run_id FROM generation_runs WHERE status='running' LIMIT 1").get();
  if (running !== undefined) throw new Error('running 작업이 있는 DB에서는 offline maintenance를 시작할 수 없습니다.');
}

export function assertSupportedSchema(
  db: Database.Database,
  migrations: readonly AppMigration[] = PLANREPO_MIGRATIONS,
): void {
  if (!tableExists(db, 'app_migrations')) throw new Error('PlanRepo schema가 준비되지 않았습니다.');
  const rows = db.prepare('SELECT number, checksum FROM app_migrations ORDER BY number').all() as MigrationRow[];
  if (rows.length !== migrations.length) throw new Error('지원하지 않는 migration 개수입니다.');
  rows.forEach((row, index) => {
    const expected = migrations[index];
    if (expected === undefined || row.number !== index + 1 || row.number !== expected.number) {
      throw new Error('migration 번호가 연속되지 않습니다.');
    }
    if (row.checksum !== expected.checksum) throw new Error(`migration ${row.number} checksum이 다릅니다.`);
  });
}

export function migrateDatabase(
  db: Database.Database,
  migrations: readonly AppMigration[] = PLANREPO_MIGRATIONS,
  appliedAt = new Date().toISOString(),
): void {
  try {
    db.exec('BEGIN EXCLUSIVE');
    const hasRegistry = tableExists(db, 'app_migrations');
    if (hasRegistry) assertNoMaintenanceBlockers(db);
    const applied = hasRegistry
      ? (db.prepare('SELECT number, checksum FROM app_migrations ORDER BY number').all() as MigrationRow[])
      : [];

    applied.forEach((row, index) => {
      const expected = migrations[index];
      if (expected === undefined || row.number !== index + 1 || expected.number !== row.number) {
        throw new Error('migration 번호가 연속되지 않습니다.');
      }
      if (row.checksum !== expected.checksum) throw new Error(`migration ${row.number} checksum이 다릅니다.`);
    });

    for (const migration of migrations.slice(applied.length)) {
      if (migration.number !== applied.length + 1) throw new Error('migration 번호가 연속되지 않습니다.');
      db.exec(migration.sql);
      db.prepare('INSERT INTO app_migrations(number, checksum, applied_at) VALUES (?, ?, ?)')
        .run(migration.number, migration.checksum, appliedAt);
      applied.push({ number: migration.number, checksum: migration.checksum });
    }
    const violations = db.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) throw new Error('migration 뒤 foreign key 위반이 있습니다.');
    db.exec('COMMIT');
  } catch (error) {
    rethrowAfterStorageFailure(db, error);
  }
}

export interface RuntimeRegistration {
  readonly runtimeId: string;
  readonly hostId: string;
  readonly bootId: string;
  readonly parentPid: number;
  readonly parentStartedAt: string;
  readonly registeredAt: string;
}

export function registerRuntime(db: Database.Database, runtime: RuntimeRegistration): void {
  const transaction = db.transaction(() => {
    assertSupportedSchema(db);
    const maintenance = db.prepare('SELECT owner_id FROM maintenance_state WHERE singleton_id=1').get() as { owner_id: string | null };
    if (maintenance.owner_id !== null) throw new Error('maintenance가 진행 중입니다.');
    db.prepare(
      `INSERT INTO runtime_identities(
         runtime_id, host_id, boot_id, parent_pid, parent_started_at, registered_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      runtime.runtimeId,
      runtime.hostId,
      runtime.bootId,
      runtime.parentPid,
      runtime.parentStartedAt,
      runtime.registeredAt,
    );
    db.prepare('INSERT INTO runtime_instances(runtime_id, heartbeat_at) VALUES (?, ?)')
      .run(runtime.runtimeId, runtime.registeredAt);
  });
  try {
    transaction.immediate();
  } catch (error) {
    rethrowAfterStorageFailure(db, error);
  }
}

export function unregisterRuntime(db: Database.Database, runtimeId: string): void {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM runtime_instances WHERE runtime_id=?').run(runtimeId);
  });
  try {
    transaction.immediate();
  } catch (error) {
    rethrowAfterStorageFailure(db, error);
  }
}

export function runOfflineMaintenance<T>(
  db: Database.Database,
  ownerId: string,
  work: (tx: Database.Database) => T,
  startedAt = new Date().toISOString(),
): T {
  if (Object.prototype.toString.call(work) === '[object AsyncFunction]') {
    throw new TypeError('offline maintenance callback은 동기 함수여야 합니다.');
  }
  let returnedThenable = false;
  try {
    db.exec('BEGIN EXCLUSIVE');
    assertSupportedSchema(db);
    assertNoMaintenanceBlockers(db);
    db.prepare('UPDATE maintenance_state SET owner_id=?, started_at=? WHERE singleton_id=1')
      .run(ownerId, startedAt);
    const result = work(db);
    if (
      ((typeof result === 'object' && result !== null) || typeof result === 'function') &&
      'then' in result && typeof result.then === 'function'
    ) {
      returnedThenable = true;
      if (result instanceof Promise) void result.catch(() => undefined);
      throw new TypeError('offline maintenance callback은 Promise나 thenable을 반환할 수 없습니다.');
    }
    db.prepare('UPDATE maintenance_state SET owner_id=NULL, started_at=NULL WHERE singleton_id=1').run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    rethrowAfterStorageFailure(db, error, { discardConnection: returnedThenable });
  }
}
