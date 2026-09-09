import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createPersistence } from '@/src/persistence/transaction';
import {
  readCommandReceipt,
  storeCommandReceipt,
} from '@/src/persistence/command-receipts';
import { openPlanRepoDatabase } from '@/src/persistence/database';
import {
  assertSupportedSchema,
  migrateDatabase,
  registerRuntime,
  runOfflineMaintenance,
  unregisterRuntime,
} from '@/src/persistence/maintenance';
import {
  PLANREPO_MIGRATION_0001,
  type AppMigration,
} from '@/src/persistence/migrations/0001-planrepo';
import { createTestDatabase } from '@/tests/helpers/test-database';

const businessEntityTables = [
  'workspace_projects',
  'demo_user_memberships',
  'srs',
  'sr_description_versions',
  'context_sources',
  'context_source_versions',
  'artifacts',
  'artifact_versions',
  'workflow_plan_versions',
  'questions',
  'question_answer_versions',
  'question_result_snapshots',
  'decisions',
  'decision_versions',
  'scope_classification_versions',
  'review_policy_versions',
  'review_assignment_versions',
  'review_bundles',
  'review_requests',
  'approvals',
  'review_gate_states',
  'gate_transition_records',
  'comments',
  'change_requests',
  'change_request_events',
  'input_snapshots',
  'generation_runs',
  'execution_claims',
  'execution_observations',
  'generation_drafts',
  'draft_applications',
  'handoffs',
  'implementation_records',
  'activity_events',
  'command_receipts',
] as const;

function insertProjectAndUser(db: Database.Database, projectId = 'project-1', userId = 'user-1') {
  db.prepare(
    `INSERT INTO workspace_projects(project_id, team_id, name, revision)
     VALUES (?, 'team-1', 'PlanRepo', 1)`,
  ).run(projectId);
  db.prepare(
    `INSERT INTO demo_user_memberships(
       project_id, user_id, display_name, roles_json, revision, demo
     ) VALUES (?, ?, '사용자', '["owner"]', 1, 1)`,
  ).run(projectId, userId);
}

function insertSr(db: Database.Database, srId = 'sr-1', key = 'SR-1') {
  createPersistence(db).withinTransaction((tx) => {
    tx.prepare(
      `INSERT INTO srs(
         project_id, sr_id, sr_key, owner_id, original_description_id,
         original_description_version, current_description_id,
         current_description_version, workflow_version, implementation_unit_count,
         progress_stage, revision, created_at, updated_at
       ) VALUES (
         'project-1', ?, ?, 'user-1', 'description-1', 1,
         'description-1', 1, 'v1.0.1', 1, 'sr_received', 1,
         '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z'
       )`,
    ).run(srId, key);
    tx.prepare(
      `INSERT INTO sr_description_versions(
         project_id, sr_id, description_id, version, title, purpose,
         description, author_id, created_at
       ) VALUES (
         'project-1', ?, 'description-1', 1, '제목', '목적',
         '설명', 'user-1', '2026-09-09T00:00:00Z'
       )`,
    ).run(srId);
  });
}

describe('SQLite 저장 원자성', () => {
  it('callback 실패가 업무와 receipt 성격의 두 쓰기를 모두 취소합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const db = fixture.db;
      db.pragma('foreign_keys = ON');
      db.exec('CREATE TEMP TABLE atomic_values (id TEXT PRIMARY KEY)');
      db.exec('CREATE TEMP TABLE atomic_receipts (id TEXT PRIMARY KEY)');
      const persistence = createPersistence(db);

      expect(() =>
        persistence.withinTransaction((tx) => {
          tx.prepare('INSERT INTO atomic_values(id) VALUES (?)').run('version-1');
          tx.prepare('INSERT INTO atomic_receipts(id) VALUES (?)').run('receipt-1');
          throw new Error('주입한 저장 실패');
        }),
      ).toThrow('주입한 저장 실패');

      expect(db.prepare('SELECT count(*) AS n FROM atomic_values').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT count(*) AS n FROM atomic_receipts').get()).toEqual({ n: 0 });
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it('async function callback은 호출 전 거절해 첫 쓰기도 실행하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.exec('CREATE TABLE async_values (id TEXT PRIMARY KEY)');
      const persistence = createPersistence(fixture.db);

      expect(() =>
        persistence.withinTransaction(async (tx) => {
          tx.prepare('INSERT INTO async_values(id) VALUES (?)').run('before-await');
          await Promise.resolve();
        }),
      ).toThrow('transaction callback은 동기 함수여야 합니다.');

      expect(fixture.db.prepare('SELECT count(*) AS n FROM async_values').get()).toEqual({ n: 0 });
      expect(fixture.db.open).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it('일반 callback이 Promise를 반환하면 rollback하고 connection을 폐기합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    fixture.db.exec('CREATE TABLE promised_values (id TEXT PRIMARY KEY)');
    const persistence = createPersistence(fixture.db);
    let continuation: Promise<void> | undefined;

    expect(() =>
      persistence.withinTransaction((tx) => {
        tx.prepare('INSERT INTO promised_values(id) VALUES (?)').run('before-promise');
        continuation = Promise.resolve().then(() => {
          tx.prepare('INSERT INTO promised_values(id) VALUES (?)').run('continuation');
        });
        return continuation;
      }),
    ).toThrow('transaction callback은 Promise나 thenable을 반환할 수 없습니다.');

    await expect(continuation).rejects.toThrow('database connection is not open');
    expect(fixture.db.open).toBe(false);

    const reopened = new Database(fixture.databasePath);
    expect(reopened.prepare('SELECT count(*) AS n FROM promised_values').get()).toEqual({ n: 0 });
    reopened.close();
    await fixture.close();
  });

  it('schema checksum이 바뀌면 새 업무 transaction을 시작하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.exec('CREATE TABLE guarded_values(id TEXT PRIMARY KEY)');
      fixture.db.prepare("UPDATE app_migrations SET checksum='mismatch' WHERE number=1").run();
      expect(() =>
        createPersistence(fixture.db).withinTransaction((tx) => {
          tx.prepare("INSERT INTO guarded_values(id) VALUES ('must-not-write')").run();
        }),
      ).toThrow('checksum');
      expect(fixture.db.prepare('SELECT count(*) AS n FROM guarded_values').get()).toEqual({ n: 0 });
    } finally {
      await fixture.close();
    }
  });

  it('실제 버전·현재 포인터·activity·receipt 쓰기 실패를 모두 rollback합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      const receipt = {
        scope: { kind: 'sr', projectId: 'project-1', srId: 'sr-1' },
        receiptId: 'receipt-atomic',
        actorRef: { actorId: 'user-1', projectId: 'project-1' },
        commandKind: 'updateSrDescription', requestId: 'request-atomic',
        idempotencyKey: 'atomic-key', inputFingerprint: 'sha256:atomic',
        committedRevision: 2,
        resultRefs: [{
          kind: 'sr_description', projectId: 'project-1', srId: 'sr-1',
          entityId: 'description-1', version: 2,
        }],
        committedAt: '2026-09-09T00:01:00Z',
      } as const;
      expect(() =>
        createPersistence(fixture.db).withinTransaction((tx) => {
          tx.prepare(
            `INSERT INTO sr_description_versions(
              project_id,sr_id,description_id,version,title,purpose,description,author_id,
              created_at,previous_version,change_reason
            ) VALUES ('project-1','sr-1','description-1',2,'새 제목','목적','설명','user-1',
              '2026-09-09T00:01:00Z',1,'개정')`,
          ).run();
          tx.prepare(
            `UPDATE srs SET current_description_version=2, revision=2,
              updated_at='2026-09-09T00:01:00Z' WHERE project_id='project-1' AND sr_id='sr-1'`,
          ).run();
          storeCommandReceipt(tx, { receipt, replayValue: { revision: 2 } });
          tx.prepare(
            `INSERT INTO activity_events(
              project_id,activity_id,sr_id,event_type,actor_kind,actor_id,target_refs_json,
              occurred_at,receipt_id,description
            ) VALUES ('project-1','activity-atomic','sr-1','description_updated','user','user-1',
              '[]','2026-09-09T00:01:00Z','receipt-atomic','설명 변경')`,
          ).run();
          throw new Error('activity 뒤 실패');
        }),
      ).toThrow('activity 뒤 실패');
      expect(fixture.db.prepare("SELECT current_description_version AS version, revision FROM srs WHERE sr_id='sr-1'").get())
        .toEqual({ version: 1, revision: 1 });
      expect(fixture.db.prepare('SELECT count(*) AS n FROM sr_description_versions').get()).toEqual({ n: 1 });
      expect(fixture.db.prepare('SELECT count(*) AS n FROM command_receipts').get()).toEqual({ n: 0 });
      expect(fixture.db.prepare('SELECT count(*) AS n FROM activity_events').get()).toEqual({ n: 0 });
    } finally {
      await fixture.close();
    }
  });
});

describe('초기 관계 schema', () => {
  it('실제 파일 DB에 35개 업무 엔티티와 확인된 연결 설정을 준비합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const tableNames = fixture.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);

      for (const tableName of businessEntityTables) expect(tableNames).toContain(tableName);
      expect(fixture.db.pragma('journal_mode', { simple: true })).toBe('delete');
      expect(fixture.db.pragma('synchronous', { simple: true })).toBe(2);
      expect(fixture.db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(fixture.db.pragma('busy_timeout', { simple: true })).toBe(100);
      expect(fixture.db.prepare('SELECT number FROM app_migrations').all()).toEqual([
        { number: 1 },
        { number: 2 },
      ]);
      expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it('DEMO-4 완료 표식을 35개 업무 ENT와 분리한 보조 registry로 둡니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      expect(businessEntityTables).not.toContain('demo_seed_manifests' as never);
      const table = fixture.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_seed_manifests'",
      ).get();
      expect(table).toEqual({ name: 'demo_seed_manifests' });
      insertProjectAndUser(fixture.db);
      fixture.db.prepare(
        `INSERT INTO demo_seed_manifests(
          seed_id, manifest_version, project_id, completed_at, manifest_digest, manifest_json
        ) VALUES ('DEMO-4','1','project-1','2026-09-09T00:00:00Z','sha256:manifest','{}')`,
      ).run();
      expect(() => fixture.db.prepare(
        `INSERT INTO demo_seed_manifests(
          seed_id, manifest_version, project_id, completed_at, manifest_digest, manifest_json
        ) VALUES ('OTHER','1','missing','2026-09-09T00:00:00Z','sha256:other','{}')`,
      ).run()).toThrow();
    } finally {
      await fixture.close();
    }
  });

  it('필수 SR current 포인터와 최초 불변 버전을 한 transaction에서 삽입합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `INSERT INTO srs(
             project_id, sr_id, sr_key, owner_id, original_description_id,
             original_description_version, current_description_id,
             current_description_version, workflow_version, implementation_unit_count,
             progress_stage, revision, created_at, updated_at
           ) VALUES (
             'project-1', 'sr-1', 'SR-1', 'user-1', 'description-1', 1,
             'description-1', 1, 'v1.0.1', 1, 'sr_received', 1,
             '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z'
           )`,
        ).run();
        tx.prepare(
          `INSERT INTO sr_description_versions(
             project_id, sr_id, description_id, version, title, purpose,
             description, author_id, created_at
           ) VALUES (
             'project-1', 'sr-1', 'description-1', 1, '제목', '목적',
             '설명', 'user-1', '2026-09-09T00:00:00Z'
           )`,
        ).run();
      });

      expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it('필수 current 자식 누락과 다른 프로젝트 사용자 연결을 commit에서 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertProjectAndUser(fixture.db, 'project-2', 'user-2');
      const persistence = createPersistence(fixture.db);

      expect(() =>
        persistence.withinTransaction((tx) => {
          tx.prepare(
            `INSERT INTO srs(
               project_id, sr_id, sr_key, owner_id, original_description_id,
               original_description_version, current_description_id,
               current_description_version, workflow_version, implementation_unit_count,
               progress_stage, revision, created_at, updated_at
             ) VALUES (
               'project-1', 'missing-child', 'SR-MISSING', 'user-1', 'missing', 1,
               'missing', 1, 'v1.0.1', 1, 'sr_received', 1,
               '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z'
             )`,
          ).run();
        }),
      ).toThrow();

      expect(() =>
        persistence.withinTransaction((tx) => {
          tx.prepare(
            `INSERT INTO srs(
               project_id, sr_id, sr_key, owner_id, original_description_id,
               original_description_version, current_description_id,
               current_description_version, workflow_version, implementation_unit_count,
               progress_stage, revision, created_at, updated_at
             ) VALUES (
               'project-1', 'wrong-owner', 'SR-WRONG', 'user-2', 'description-2', 1,
               'description-2', 1, 'v1.0.1', 1, 'sr_received', 1,
               '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z'
             )`,
          ).run();
          tx.prepare(
            `INSERT INTO sr_description_versions(
               project_id, sr_id, description_id, version, title, purpose,
               description, author_id, created_at
             ) VALUES (
               'project-1', 'wrong-owner', 'description-2', 1, '제목', '목적',
               '설명', 'user-1', '2026-09-09T00:00:00Z'
             )`,
          ).run();
        }),
      ).toThrow();

      expect(fixture.db.prepare('SELECT count(*) AS n FROM srs').get()).toEqual({ n: 0 });
    } finally {
      await fixture.close();
    }
  });

  it('gate 참조와 실행 슬롯은 종류를 포함한 복합 FK이며 Handoff ID는 version을 허용합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const foreignKeyShapes = (table: string) => {
        const rows = fixture.db.pragma(`foreign_key_list(${table})`) as {
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
        }[];
        const grouped = new Map<number, typeof rows>();
        for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
        return [...grouped.values()].map((group) => ({
          table: group[0]?.table,
          from: group.sort((left, right) => left.seq - right.seq).map((row) => row.from),
          to: group.sort((left, right) => left.seq - right.seq).map((row) => row.to),
        }));
      };

      expect(foreignKeyShapes('review_bundles')).toContainEqual({
        table: 'review_bundles',
        from: ['project_id', 'sr_id', 'g1_gate', 'g1_bundle_id', 'g1_bundle_version'],
        to: ['project_id', 'sr_id', 'gate', 'bundle_id', 'version'],
      });
      expect(foreignKeyShapes('review_bundles')).toContainEqual({
        table: 'review_bundles',
        from: ['project_id', 'sr_id', 'gate', 'previous_bundle_id', 'previous_bundle_version'],
        to: ['project_id', 'sr_id', 'gate', 'bundle_id', 'version'],
      });
      expect(foreignKeyShapes('handoffs')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: ['project_id', 'sr_id', 'g1_gate', 'g1_bundle_id', 'g1_bundle_version'] }),
          expect.objectContaining({ from: ['project_id', 'sr_id', 'g2_gate', 'g2_bundle_id', 'g2_bundle_version'] }),
          expect.objectContaining({
            from: ['project_id', 'sr_id', 'previous_handoff_id', 'previous_handoff_version'],
          }),
        ]),
      );
      expect(foreignKeyShapes('workflow_plan_versions')).toContainEqual({
        table: 'artifact_versions',
        from: ['project_id', 'sr_id', 'artifact_id', 'artifact_kind', 'version'],
        to: ['project_id', 'sr_id', 'artifact_id', 'kind', 'version'],
      });
      expect(foreignKeyShapes('execution_slot')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: 'execution_claims' }),
          expect.objectContaining({ table: 'runtime_instances' }),
        ]),
      );

      const handoffUniqueShapes = (fixture.db.pragma('index_list(handoffs)') as { name: string; unique: number }[])
        .filter((index) => index.unique === 1)
        .map((index) =>
          (fixture.db.pragma(`index_info(${index.name})`) as { seqno: number; name: string }[])
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => column.name),
        );
      expect(handoffUniqueShapes).not.toContainEqual(['project_id', 'sr_id', 'handoff_id']);
      expect(handoffUniqueShapes).toContainEqual(['project_id', 'sr_id', 'handoff_id', 'version']);
    } finally {
      await fixture.close();
    }
  });

  it('ContextSource·Artifact·Question의 필수 current 자식을 같은 transaction에서 완성합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `INSERT INTO context_sources(project_id,sr_id,source_id,current_version,revision,created_by,created_at)
           VALUES ('project-1','sr-1','source-1',1,1,'user-1','2026-09-09T00:00:00Z')`,
        ).run();
        tx.prepare(
          `INSERT INTO context_source_versions(
            project_id,sr_id,source_id,version,kind,provenance,confirmation,created_by,created_at,content
           ) VALUES ('project-1','sr-1','source-1',1,'text','사용자','unconfirmed','user-1',
             '2026-09-09T00:00:00Z','근거')`,
        ).run();
        tx.prepare(
          `INSERT INTO artifacts(project_id,sr_id,artifact_id,kind,current_version,revision)
           VALUES ('project-1','sr-1','artifact-1','requirements',1,1)`,
        ).run();
        tx.prepare(
          `INSERT INTO artifact_versions(
            project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
            requirement_links_json,author_origin,author_id,created_at,change_summary
           ) VALUES ('project-1','sr-1','artifact-1','requirements',1,'# 요구사항','[]','[]',
             'human','user-1','2026-09-09T00:00:00Z','최초')`,
        ).run();
        tx.prepare(
          `INSERT INTO scope_classification_versions(
            project_id,sr_id,classification_id,version,target_kind,target_id,scope,
            required_gate,reason,classified_by,classified_at
           ) VALUES ('project-1','sr-1','classification-1',1,'question','question-1','current',
             'G1','필수','user-1','2026-09-09T00:00:00Z')`,
        ).run();
        tx.prepare(
          `INSERT INTO questions(
            project_id,sr_id,question_id,text,reason,assignee_id,answer_mode,required_gate,
            classification_id,classification_version,status,current_result_version,revision,created_at
           ) VALUES ('project-1','sr-1','question-1','질문','이유','user-1','free_text','G1',
             'classification-1',1,'open',1,1,'2026-09-09T00:00:00Z')`,
        ).run();
        tx.prepare(
          `INSERT INTO question_result_snapshots(
            project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
            status,classification_id,classification_version,evidence_refs_json,captured_at
           ) VALUES ('project-1','sr-1','question-1',1,'질문','이유','user-1','free_text','[]',
             'open','classification-1',1,'[]','2026-09-09T00:00:00Z')`,
        ).run();
      });
      expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it('INSERT OR REPLACE로 불변 DescriptionVersion을 덮어쓰지 못합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      expect(fixture.db.pragma('recursive_triggers', { simple: true })).toBe(1);
      expect(() => fixture.db.prepare(
        `INSERT OR REPLACE INTO sr_description_versions(
          project_id,sr_id,description_id,version,title,purpose,description,author_id,created_at
        ) VALUES ('project-1','sr-1','description-1',1,'덮어쓴 제목','목적','설명','user-1',
          '2026-09-09T00:00:00Z')`,
      ).run()).toThrow('append-only');
      expect(fixture.db.prepare(
        "SELECT title FROM sr_description_versions WHERE project_id='project-1' AND sr_id='sr-1' AND description_id='description-1' AND version=1",
      ).get()).toEqual({ title: '제목' });
    } finally {
      await fixture.close();
    }
  });

  it('다른 SR의 같은 논리 ID version을 current 포인터로 연결하지 못합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db, 'sr-1', 'SR-1');
      insertSr(fixture.db, 'sr-2', 'SR-2');
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `INSERT INTO context_sources(project_id,sr_id,source_id,current_version,revision,created_by,created_at)
           VALUES ('project-1','sr-2','shared-source',1,1,'user-1','2026-09-09T00:00:00Z')`,
        ).run();
        tx.prepare(
          `INSERT INTO context_source_versions(
            project_id,sr_id,source_id,version,kind,provenance,confirmation,created_by,created_at,content
           ) VALUES ('project-1','sr-2','shared-source',1,'text','사용자','unconfirmed','user-1',
             '2026-09-09T00:00:00Z','근거')`,
        ).run();
      });
      expect(() =>
        createPersistence(fixture.db).withinTransaction((tx) => {
          tx.prepare(
            `INSERT INTO context_sources(project_id,sr_id,source_id,current_version,revision,created_by,created_at)
             VALUES ('project-1','sr-1','shared-source',1,1,'user-1','2026-09-09T00:00:00Z')`,
          ).run();
        }),
      ).toThrow();
      expect(fixture.db.prepare("SELECT count(*) AS n FROM context_sources WHERE sr_id='sr-1'").get()).toEqual({ n: 0 });
    } finally {
      await fixture.close();
    }
  });
});

describe('CommandReceipt 저장', () => {
  it('고유 키 다섯 열이 모두 NOT NULL이고 command_kind는 고유 키 밖에 있습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const columns = fixture.db.pragma('table_info(command_receipts)') as {
        name: string;
        notnull: number;
      }[];
      for (const name of ['scope_kind', 'project_id', 'scope_target_id', 'actor_id', 'idempotency_key']) {
        expect(columns.find((column) => column.name === name)?.notnull).toBe(1);
      }

      const indexes = fixture.db.pragma('index_list(command_receipts)') as {
        name: string;
        unique: number;
      }[];
      const uniqueColumns = indexes
        .filter((index) => index.unique === 1)
        .map((index) =>
          (fixture.db.pragma(`index_info(${index.name})`) as { seqno: number; name: string }[])
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => column.name),
        );
      expect(uniqueColumns).toContainEqual([
        'scope_kind',
        'project_id',
        'scope_target_id',
        'actor_id',
        'idempotency_key',
      ]);
      expect(uniqueColumns.some((columnsInIndex) => columnsInIndex.includes('command_kind'))).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it('현재 포인터가 바뀌고 재개방돼도 고정 결과 참조와 확정 revision을 그대로 읽습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    const receipt = {
      scope: { kind: 'sr', projectId: 'project-1', srId: 'sr-1' },
      receiptId: 'receipt-1',
      actorRef: { actorId: 'user-1', projectId: 'project-1' },
      commandKind: 'saveArtifact',
      requestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      inputFingerprint: 'sha256:input-1',
      committedRevision: 7,
      resultRefs: [
        {
          kind: 'artifact',
          projectId: 'project-1',
          srId: 'sr-1',
          entityId: 'artifact-1',
          version: 1,
        },
        {
          projectId: 'project-1',
          srId: 'sr-1',
          gate: 'G2',
          bundleId: 'bundle-2',
          version: 3,
        },
      ],
      committedAt: '2026-09-09T00:00:00Z',
    } as const;

    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `INSERT INTO artifacts(project_id,sr_id,artifact_id,kind,current_version,revision)
           VALUES ('project-1','sr-1','artifact-1','requirements',1,1)`,
        ).run();
        tx.prepare(
          `INSERT INTO artifact_versions(
            project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
            requirement_links_json,author_origin,author_id,created_at,change_summary
           ) VALUES ('project-1','sr-1','artifact-1','requirements',1,'v1','[]','[]',
             'human','user-1','2026-09-09T00:00:00Z','최초')`,
        ).run();
        storeCommandReceipt(tx, { receipt, replayValue: { artifactVersion: 1 } });
      });
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `INSERT INTO artifact_versions(
            project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
            requirement_links_json,author_origin,author_id,created_at,change_summary,previous_version
           ) VALUES ('project-1','sr-1','artifact-1','requirements',2,'v2','[]','[]',
             'human','user-1','2026-09-09T00:01:00Z','개정',1)`,
        ).run();
        tx.prepare(
          "UPDATE artifacts SET current_version=2, revision=2 WHERE project_id='project-1' AND sr_id='sr-1' AND artifact_id='artifact-1'",
        ).run();
      });

      fixture.db.close();
      const reopened = openPlanRepoDatabase(fixture.databasePath);
      try {
        expect(
          readCommandReceipt(reopened, {
            scope: receipt.scope,
            actorId: 'user-1',
            idempotencyKey: 'idempotency-1',
          }),
        ).toEqual({ receipt, replayValue: { artifactVersion: 1 } });
      } finally {
        reopened.close();
      }
    } finally {
      await fixture.close();
    }
  });

  it('다른 connection의 같은 5-tuple 저장은 하나만 남기고 범위 의미 위반을 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      const other = openPlanRepoDatabase(fixture.databasePath);
      const base = {
        scope: { kind: 'sr', projectId: 'project-1', srId: 'sr-1' },
        receiptId: 'receipt-first',
        actorRef: { actorId: 'user-1', projectId: 'project-1' },
        commandKind: 'saveArtifact',
        requestId: 'request-first',
        idempotencyKey: 'same-key',
        inputFingerprint: 'sha256:first',
        committedRevision: 2,
        resultRefs: [],
        committedAt: '2026-09-09T00:00:00Z',
      } as const;
      storeCommandReceipt(fixture.db, { receipt: base, replayValue: { ok: true } });
      expect(() =>
        storeCommandReceipt(other, {
          receipt: {
            ...base,
            receiptId: 'receipt-second',
            commandKind: 'differentCommand',
            inputFingerprint: 'sha256:second',
          },
          replayValue: { ok: false },
        }),
      ).toThrow();
      expect(other.prepare('SELECT count(*) AS n FROM command_receipts').get()).toEqual({ n: 1 });
      expect(() =>
        other.prepare(
          `INSERT INTO command_receipts(
             project_id, receipt_id, scope_kind, scope_target_id, actor_id,
             command_kind, request_id, idempotency_key, input_fingerprint,
             committed_revision, result_refs_json, replay_value_json, committed_at
           ) VALUES (
             'project-1', 'receipt-bad-project-scope', 'project', 'not-project-1', 'user-1',
             'command', 'request', 'bad-project-scope', 'sha256:bad', 1, '[]', '{}',
             '2026-09-09T00:00:00Z'
           )`,
        ).run(),
      ).toThrow();
      other.close();
    } finally {
      await fixture.close();
    }
  });
});

describe('migration과 runtime/maintenance 소유권', () => {
  it('migration 중간 실패가 migration row와 부분 DDL을 모두 rollback합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
    try {
      const failingMigration: AppMigration = {
        number: 1,
        checksum: 'sha256:failing',
        sql: `
          CREATE TABLE app_migrations(number INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
          CREATE TABLE partial_schema(id TEXT PRIMARY KEY);
          INSERT INTO table_that_does_not_exist(id) VALUES ('fail');
        `,
      };
      expect(() => migrateDatabase(fixture.db, [failingMigration])).toThrow();
      expect(
        fixture.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('app_migrations','partial_schema')").all(),
      ).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it('후속 migration 실패가 기존 schema와 migration 1 기록을 보존합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
    try {
      migrateDatabase(fixture.db, [PLANREPO_MIGRATION_0001]);
      const failingSecond: AppMigration = {
        number: 2,
        checksum: 'sha256:failing-second',
        sql: `
          CREATE TABLE partial_second_migration(id TEXT PRIMARY KEY);
          INSERT INTO missing_second_table(id) VALUES ('fail');
        `,
      };
      expect(() => migrateDatabase(fixture.db, [PLANREPO_MIGRATION_0001, failingSecond])).toThrow();
      expect(fixture.db.prepare('SELECT number, checksum FROM app_migrations').all()).toEqual([
        { number: 1, checksum: PLANREPO_MIGRATION_0001.checksum },
      ]);
      expect(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name='partial_second_migration'").get())
        .toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it('checksum 불일치와 migration 번호 gap을 준비 성공으로 인정하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.prepare("UPDATE app_migrations SET checksum='tampered' WHERE number=1").run();
      expect(() => assertSupportedSchema(fixture.db)).toThrow('checksum');
      fixture.db.prepare('UPDATE app_migrations SET checksum=? WHERE number=1').run(PLANREPO_MIGRATION_0001.checksum);
      fixture.db.prepare(
        "INSERT INTO app_migrations(number, checksum, applied_at) VALUES (3, 'gap', '2026-09-09T00:00:00Z')",
      ).run();
      expect(() => assertSupportedSchema(fixture.db)).toThrow();
    } finally {
      await fixture.close();
    }
  });

  it('빈 DB의 backend 등록은 실패하고 migration commit 뒤에만 등록됩니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
    const runtime = {
      runtimeId: 'runtime-1',
      hostId: 'host-1',
      bootId: 'boot-1',
      parentPid: 123,
      parentStartedAt: '2026-09-09T00:00:00Z',
      registeredAt: '2026-09-09T00:00:01Z',
    };
    try {
      expect(() => registerRuntime(fixture.db, runtime)).toThrow('schema가 준비되지 않았습니다');
      migrateDatabase(fixture.db);
      registerRuntime(fixture.db, runtime);
      expect(fixture.db.prepare('SELECT runtime_id FROM runtime_instances').all()).toEqual([
        { runtime_id: 'runtime-1' },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it('runtime·slot·running 중 하나라도 남으면 offline maintenance를 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const runtime = {
        runtimeId: 'runtime-1',
        hostId: 'host-1',
        bootId: 'boot-1',
        parentPid: 123,
        parentStartedAt: '2026-09-09T00:00:00Z',
        registeredAt: '2026-09-09T00:00:01Z',
      };
      registerRuntime(fixture.db, runtime);
      expect(() => runOfflineMaintenance(fixture.db, 'maintenance-1', () => undefined)).toThrow('runtime');
      unregisterRuntime(fixture.db, runtime.runtimeId);

      fixture.db.pragma('foreign_keys = OFF');
      fixture.db.prepare(
        `UPDATE execution_slot SET project_id='project-1', sr_id='sr-1', run_id='run-1',
          claim_id='claim-1', claim_token_hash='hash', runtime_id='runtime-1', launch_intent_id='launch-1'
          WHERE singleton_id=1`,
      ).run();
      fixture.db.pragma('foreign_keys = ON');
      expect(() => runOfflineMaintenance(fixture.db, 'maintenance-1', () => undefined)).toThrow('슬롯');

      fixture.db.pragma('foreign_keys = OFF');
      fixture.db.prepare(
        `UPDATE execution_slot SET project_id=NULL, sr_id=NULL, run_id=NULL, claim_id=NULL,
          claim_token_hash=NULL, runtime_id=NULL, launch_intent_id=NULL WHERE singleton_id=1`,
      ).run();
      fixture.db.prepare(
        `INSERT INTO generation_runs(
          project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
          requested_by,requested_at,status,revision,claim_id,started_at
        ) VALUES ('project-1','sr-1','run-1','TEST','snapshot-1','{}','user-1',
          '2026-09-09T00:00:00Z','running',1,'claim-1','2026-09-09T00:00:00Z')`,
      ).run();
      fixture.db.pragma('foreign_keys = ON');
      expect(() => runOfflineMaintenance(fixture.db, 'maintenance-1', () => undefined)).toThrow('running');
    } finally {
      await fixture.close();
    }
  });

  it('같은 DB의 EXCLUSIVE lock이 backend 등록을 막고 해제 뒤 재시도는 성공합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    const other = openPlanRepoDatabase(fixture.databasePath);
    const runtime = {
      runtimeId: 'runtime-lock',
      hostId: 'host-1',
      bootId: 'boot-1',
      parentPid: 123,
      parentStartedAt: '2026-09-09T00:00:00Z',
      registeredAt: '2026-09-09T00:00:01Z',
    };
    try {
      fixture.db.exec('BEGIN EXCLUSIVE');
      expect(() => registerRuntime(other, runtime)).toThrow();
      fixture.db.exec('ROLLBACK');
      registerRuntime(other, runtime);
      expect(other.prepare('SELECT count(*) AS n FROM runtime_instances').get()).toEqual({ n: 1 });
      unregisterRuntime(other, runtime.runtimeId);
    } finally {
      if (fixture.db.inTransaction) fixture.db.exec('ROLLBACK');
      other.close();
      await fixture.close();
    }
  });

  it('terminal Run의 과거 Claim을 보존하면서 활성 runtime 등록을 해제합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      registerRuntime(fixture.db, {
        runtimeId: 'runtime-history', hostId: 'host-1', bootId: 'boot-1', parentPid: 123,
        parentStartedAt: '2026-09-09T00:00:00Z', registeredAt: '2026-09-09T00:00:01Z',
      });
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `INSERT INTO input_snapshots(
            project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
            contents_json,project_rules_json,captured_at
          ) VALUES ('project-1','sr-1','snapshot-history','v1.0.1','TEST','sha256:input','[]','[]',
            '2026-09-09T00:00:00Z')`,
        ).run();
        tx.prepare(
          `INSERT INTO generation_runs(
            project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
            requested_by,requested_at,status,revision,claim_id,started_at
          ) VALUES ('project-1','sr-1','run-history','TEST','snapshot-history','{}','user-1',
            '2026-09-09T00:00:00Z','running',1,'claim-history','2026-09-09T00:00:01Z')`,
        ).run();
        tx.prepare(
          `INSERT INTO execution_claims(
            project_id,sr_id,run_id,claim_id,owner_runtime_id,ownership_token_hash,
            claimed_at,execution_policy_ref,launch_intent_id
          ) VALUES ('project-1','sr-1','run-history','claim-history','runtime-history','hash',
            '2026-09-09T00:00:01Z','policy-1','launch-1')`,
        ).run();
      });
      createPersistence(fixture.db).withinTransaction((tx) => {
        tx.prepare(
          `UPDATE generation_runs SET status='failed', error_code='INTERRUPTED',
            finished_at='2026-09-09T00:01:00Z', revision=2
           WHERE project_id='project-1' AND sr_id='sr-1' AND run_id='run-history'`,
        ).run();
      });

      expect(() => unregisterRuntime(fixture.db, 'runtime-history')).not.toThrow();
      expect(fixture.db.prepare('SELECT count(*) AS n FROM runtime_instances').get()).toEqual({ n: 0 });
      expect(fixture.db.prepare("SELECT runtime_id FROM runtime_identities WHERE runtime_id='runtime-history'").get())
        .toEqual({ runtime_id: 'runtime-history' });
      expect(fixture.db.prepare('SELECT count(*) AS n FROM execution_claims').get()).toEqual({ n: 1 });
      expect(() => runOfflineMaintenance(fixture.db, 'maintenance-after-runtime', () => undefined)).not.toThrow();
    } finally {
      await fixture.close();
    }
  });

  it('migration·runtime 등록·offline maintenance의 IOERR가 connection을 폐기합니다', async () => {
    const migrationFixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
    try {
      migrateDatabase(migrationFixture.db, [PLANREPO_MIGRATION_0001]);
      const ioError = Object.assign(new Error('migration io failure'), { code: 'SQLITE_IOERR_WRITE' });
      migrationFixture.db.function('fail_io', () => { throw ioError; });
      const failingMigration: AppMigration = { number: 2, checksum: 'ioerr', sql: 'SELECT fail_io();' };
      expect(() => migrateDatabase(migrationFixture.db, [PLANREPO_MIGRATION_0001, failingMigration]))
        .toThrow('migration io failure');
      expect(migrationFixture.db.open).toBe(false);
    } finally {
      await migrationFixture.close();
    }

    const runtimeFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const ioError = Object.assign(new Error('runtime io failure'), { code: 'SQLITE_IOERR_WRITE' });
      runtimeFixture.db.function('fail_io', () => { throw ioError; });
      runtimeFixture.db.exec(
        `CREATE TEMP TRIGGER runtime_insert_io BEFORE INSERT ON runtime_instances
         BEGIN SELECT fail_io(); END`,
      );
      expect(() => registerRuntime(runtimeFixture.db, {
        runtimeId: 'runtime-io', hostId: 'host-1', bootId: 'boot-1', parentPid: 123,
        parentStartedAt: '2026-09-09T00:00:00Z', registeredAt: '2026-09-09T00:00:01Z',
      })).toThrow('runtime io failure');
      expect(runtimeFixture.db.open).toBe(false);
    } finally {
      await runtimeFixture.close();
    }

    const maintenanceFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      const ioError = Object.assign(new Error('maintenance io failure'), { code: 'SQLITE_IOERR_WRITE' });
      maintenanceFixture.db.function('fail_io', () => { throw ioError; });
      expect(() => runOfflineMaintenance(maintenanceFixture.db, 'maintenance-io', (tx) => {
        tx.prepare('SELECT fail_io()').get();
      })).toThrow('maintenance io failure');
      expect(maintenanceFixture.db.open).toBe(false);
    } finally {
      await maintenanceFixture.close();
    }
  });

  it('maintenance callback 실패가 자료와 소유권 표시를 함께 rollback합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.exec('CREATE TABLE maintenance_values(id TEXT PRIMARY KEY)');
      expect(() =>
        runOfflineMaintenance(fixture.db, 'maintenance-1', (tx) => {
          tx.prepare("INSERT INTO maintenance_values(id) VALUES ('partial')").run();
          throw new Error('maintenance 실패 주입');
        }),
      ).toThrow('maintenance 실패 주입');
      expect(fixture.db.prepare('SELECT count(*) AS n FROM maintenance_values').get()).toEqual({ n: 0 });
      expect(fixture.db.prepare('SELECT owner_id FROM maintenance_state WHERE singleton_id=1').get()).toEqual({
        owner_id: null,
      });
    } finally {
      await fixture.close();
    }
  });

  it('이미 기록된 maintenance owner를 덮어쓰지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.prepare(
        "UPDATE maintenance_state SET owner_id='existing-owner', started_at='2026-09-09T00:00:00Z' WHERE singleton_id=1",
      ).run();
      expect(() => runOfflineMaintenance(fixture.db, 'new-owner', () => undefined)).toThrow('maintenance');
      expect(fixture.db.prepare('SELECT owner_id FROM maintenance_state WHERE singleton_id=1').get()).toEqual({
        owner_id: 'existing-owner',
      });
    } finally {
      await fixture.close();
    }
  });

  it('기존 maintenance owner가 있으면 migration도 시작하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.prepare(
        "UPDATE maintenance_state SET owner_id='existing-owner', started_at='2026-09-09T00:00:00Z' WHERE singleton_id=1",
      ).run();
      expect(() => migrateDatabase(fixture.db)).toThrow('maintenance');
      expect(fixture.db.prepare('SELECT owner_id FROM maintenance_state WHERE singleton_id=1').get()).toEqual({
        owner_id: 'existing-owner',
      });
    } finally {
      await fixture.close();
    }
  });

  it('known async maintenance callback은 실행 전에 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.exec('CREATE TABLE async_maintenance_values(id TEXT PRIMARY KEY)');
      expect(() =>
        runOfflineMaintenance(fixture.db, 'maintenance-async', async (tx) => {
          tx.prepare("INSERT INTO async_maintenance_values(id) VALUES ('before-await')").run();
          await Promise.resolve();
        }),
      ).toThrow('동기 함수');
      expect(fixture.db.prepare('SELECT count(*) AS n FROM async_maintenance_values').get()).toEqual({ n: 0 });
      expect(fixture.db.open).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it('일반 maintenance callback의 Promise continuation은 rollback 뒤 DB를 쓸 수 없습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    fixture.db.exec('CREATE TABLE promised_maintenance_values(id TEXT PRIMARY KEY)');
    let continuation: Promise<void> | undefined;
    expect(() =>
      runOfflineMaintenance(fixture.db, 'maintenance-promise', (tx) => {
        tx.prepare("INSERT INTO promised_maintenance_values(id) VALUES ('before-promise')").run();
        continuation = Promise.resolve().then(() => {
          tx.prepare("INSERT INTO promised_maintenance_values(id) VALUES ('continuation')").run();
        });
        return continuation;
      }),
    ).toThrow('Promise나 thenable');
    await expect(continuation).rejects.toThrow('database connection is not open');
    expect(fixture.db.open).toBe(false);
    const reopened = openPlanRepoDatabase(fixture.databasePath);
    expect(reopened.prepare('SELECT count(*) AS n FROM promised_maintenance_values').get()).toEqual({ n: 0 });
    reopened.close();
    await fixture.close();
  });
});

describe('불변 이력과 범위 관계', () => {
  it('불변 버전과 receipt의 UPDATE·DELETE를 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      const receipt = {
        scope: { kind: 'sr', projectId: 'project-1', srId: 'sr-1' },
        receiptId: 'receipt-immutable',
        actorRef: { actorId: 'user-1', projectId: 'project-1' },
        commandKind: 'command', requestId: 'request', idempotencyKey: 'immutable-key',
        inputFingerprint: 'sha256:immutable', committedRevision: 1, resultRefs: [],
        committedAt: '2026-09-09T00:00:00Z',
      } as const;
      storeCommandReceipt(fixture.db, { receipt, replayValue: {} });
      fixture.db.prepare(
        `INSERT INTO review_assignment_versions(
          project_id,sr_id,gate,assignment_id,version,assigned_by,assigned_at
        ) VALUES ('project-1','sr-1','G1','assignment-1',1,'user-1','2026-09-09T00:00:00Z')`,
      ).run();
      fixture.db.prepare(
        `INSERT INTO review_assignment_reviewers(
          project_id,sr_id,gate,assignment_id,assignment_version,reviewer_id
        ) VALUES ('project-1','sr-1','G1','assignment-1',1,'user-1')`,
      ).run();
      expect(() => fixture.db.prepare("UPDATE sr_description_versions SET title='변경' WHERE sr_id='sr-1'").run()).toThrow('append-only');
      expect(() => fixture.db.prepare("DELETE FROM command_receipts WHERE receipt_id='receipt-immutable'").run()).toThrow('append-only');
      expect(() => fixture.db.prepare("DELETE FROM review_assignment_reviewers WHERE assignment_id='assignment-1'").run()).toThrow('append-only');
    } finally {
      await fixture.close();
    }
  });

  it('두 질문의 parent 순환을 recursive 검사로 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      expect(() =>
        createPersistence(fixture.db).withinTransaction((tx) => {
          for (const id of ['a', 'b']) {
            tx.prepare(
              `INSERT INTO scope_classification_versions(
                project_id,sr_id,classification_id,version,target_kind,target_id,scope,
                required_gate,reason,classified_by,classified_at
              ) VALUES ('project-1','sr-1',?,1,'question',?,'current','G1','이유','user-1','2026-09-09T00:00:00Z')`,
            ).run(`classification-${id}`, id);
          }
          tx.prepare(
            `INSERT INTO questions(
              project_id,sr_id,question_id,text,reason,assignee_id,answer_mode,required_gate,
              classification_id,classification_version,status,current_result_version,revision,created_at,parent_question_id
            ) VALUES ('project-1','sr-1','a','A','이유','user-1','free_text','G1','classification-a',1,
              'open',1,1,'2026-09-09T00:00:00Z','b')`,
          ).run();
          tx.prepare(
            `INSERT INTO question_result_snapshots(
              project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
              status,classification_id,classification_version,evidence_refs_json,captured_at
            ) VALUES ('project-1','sr-1','a',1,'A','이유','user-1','free_text','[]','open',
              'classification-a',1,'[]','2026-09-09T00:00:00Z')`,
          ).run();
          tx.prepare(
            `INSERT INTO questions(
              project_id,sr_id,question_id,text,reason,assignee_id,answer_mode,required_gate,
              classification_id,classification_version,status,current_result_version,revision,created_at,parent_question_id
            ) VALUES ('project-1','sr-1','b','B','이유','user-1','free_text','G1','classification-b',1,
              'open',1,1,'2026-09-09T00:00:00Z','a')`,
          ).run();
        }),
      ).toThrow('순환');
      expect(fixture.db.prepare('SELECT count(*) AS n FROM questions').get()).toEqual({ n: 0 });
    } finally {
      await fixture.close();
    }
  });

  it('정상 질문 두 개의 parent UPDATE로 순환을 만들지 못합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertProjectAndUser(fixture.db);
      insertSr(fixture.db);
      createPersistence(fixture.db).withinTransaction((tx) => {
        for (const id of ['a', 'b']) {
          tx.prepare(
            `INSERT INTO scope_classification_versions(
              project_id,sr_id,classification_id,version,target_kind,target_id,scope,
              required_gate,reason,classified_by,classified_at
            ) VALUES ('project-1','sr-1',?,1,'question',?,'current','G1','이유','user-1',
              '2026-09-09T00:00:00Z')`,
          ).run(`classification-update-${id}`, `update-${id}`);
          tx.prepare(
            `INSERT INTO questions(
              project_id,sr_id,question_id,text,reason,assignee_id,answer_mode,required_gate,
              classification_id,classification_version,status,current_result_version,revision,created_at
            ) VALUES ('project-1','sr-1',?,?,'이유','user-1','free_text','G1',?,1,'open',1,1,
              '2026-09-09T00:00:00Z')`,
          ).run(`update-${id}`, id.toUpperCase(), `classification-update-${id}`);
          tx.prepare(
            `INSERT INTO question_result_snapshots(
              project_id,sr_id,question_id,version,text,reason,assignee_id,answer_mode,options_json,
              status,classification_id,classification_version,evidence_refs_json,captured_at
            ) VALUES ('project-1','sr-1',?,1,?,'이유','user-1','free_text','[]','open',?,1,'[]',
              '2026-09-09T00:00:00Z')`,
          ).run(`update-${id}`, id.toUpperCase(), `classification-update-${id}`);
        }
      });
      fixture.db.prepare("UPDATE questions SET parent_question_id='update-b' WHERE question_id='update-a'").run();
      expect(() => fixture.db.prepare(
        "UPDATE questions SET parent_question_id='update-a' WHERE question_id='update-b'",
      ).run()).toThrow('순환');
      expect(fixture.db.prepare("SELECT parent_question_id FROM questions WHERE question_id='update-b'").get())
        .toEqual({ parent_question_id: null });
    } finally {
      await fixture.close();
    }
  });

  it('검토 요청 승계·실행 재시도·비교 초안의 2-node 순환을 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.pragma('foreign_keys = OFF');

      fixture.db.exec('BEGIN');
      try {
        fixture.db.prepare(
          `INSERT INTO review_requests(
            project_id,sr_id,request_id,gate,bundle_id,bundle_version,review_epoch,reviewer_id,
            request_kind,requested_by,requested_at,status,revision
          ) VALUES ('project-1','sr-1','request-a','G1','bundle-1',1,1,'user-1',
            'review','user-1','2026-09-09T00:00:00Z','pending',1)`,
        ).run();
        fixture.db.prepare(
          `INSERT INTO review_requests(
            project_id,sr_id,request_id,gate,bundle_id,bundle_version,review_epoch,reviewer_id,
            request_kind,requested_by,requested_at,status,revision,superseded_by_request_id
          ) VALUES ('project-1','sr-1','request-b','G1','bundle-1',1,1,'user-1',
            'review','user-1','2026-09-09T00:00:00Z','superseded',1,'request-a')`,
        ).run();
        expect(() => fixture.db.prepare(
          "UPDATE review_requests SET superseded_by_request_id='request-b', status='superseded' WHERE request_id='request-a'",
        ).run()).toThrow('순환');
      } finally {
        fixture.db.exec('ROLLBACK');
      }

      fixture.db.exec('BEGIN');
      try {
        const insertRun = fixture.db.prepare(
          `INSERT INTO generation_runs(
            project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
            requested_by,requested_at,status,revision,retry_of_run_id
          ) VALUES ('project-1','sr-1',?,'TEST','snapshot-1','{}','user-1',
            '2026-09-09T00:00:00Z','pending',1,?)`,
        );
        insertRun.run('run-a', 'run-b');
        expect(() => insertRun.run('run-b', 'run-a')).toThrow('순환');
      } finally {
        fixture.db.exec('ROLLBACK');
      }

      fixture.db.exec('BEGIN');
      try {
        const insertDraft = fixture.db.prepare(
          `INSERT INTO generation_drafts(
            project_id,sr_id,draft_id,schema_version,task_kind,body_json,basis_input_snapshot_id,
            basis_fingerprint,provenance_json,created_at,source_draft_id
          ) VALUES ('project-1','sr-1',?,1,'TEST','{}','snapshot-1','sha256:input','{}',
            '2026-09-09T00:00:00Z',?)`,
        );
        insertDraft.run('draft-a', 'draft-b');
        expect(() => insertDraft.run('draft-b', 'draft-a')).toThrow('순환');
      } finally {
        fixture.db.exec('ROLLBACK');
      }
      fixture.db.pragma('foreign_keys = ON');
    } finally {
      if (fixture.db.inTransaction) fixture.db.exec('ROLLBACK');
      if (fixture.db.open) fixture.db.pragma('foreign_keys = ON');
      await fixture.close();
    }
  });
});
