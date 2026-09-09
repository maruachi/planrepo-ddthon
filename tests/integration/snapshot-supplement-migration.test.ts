import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  assertSupportedSchema,
  migrateDatabase,
} from '@/src/persistence/maintenance';
import { PLANREPO_MIGRATION_0001 } from '@/src/persistence/migrations/0001-planrepo';
import { createTestDatabase } from '@/tests/helpers/test-database';

function installVersion1(db: Database.Database): void {
  migrateDatabase(db, [PLANREPO_MIGRATION_0001], '2026-09-09T00:00:00.000Z');
}

function insertLegacyGraph(db: Database.Database): Buffer {
  const binaryMarkdown = Buffer.from([0, 255, 1, 2, 128, 10]);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO workspace_projects(project_id,team_id,name,revision)
       VALUES ('project-1','team-1','PlanRepo',1)`,
    ).run();
    db.prepare(
      `INSERT INTO demo_user_memberships(
         project_id,user_id,display_name,roles_json,revision,demo
       ) VALUES ('project-1','user-1','사용자','["owner"]',1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO srs(
         project_id,sr_id,sr_key,owner_id,original_description_id,
         original_description_version,current_description_id,current_description_version,
         workflow_version,implementation_unit_count,progress_stage,revision,created_at,updated_at
       ) VALUES (
         'project-1','sr-1','SR-1','user-1','description-1',1,'description-1',1,
         'v1.0.1',1,'requirements',1,'2026-09-09T00:00:00Z','2026-09-09T00:00:00Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO sr_description_versions(
         project_id,sr_id,description_id,version,title,purpose,description,author_id,created_at
       ) VALUES (
         'project-1','sr-1','description-1',1,'제목','목적','설명','user-1',
         '2026-09-09T00:00:00Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO input_snapshots(
         project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
         contents_json,project_rules_json,captured_at,document_kind,target_basis_json
       ) VALUES (
         'project-1','sr-1','snapshot-v1','v1.0.1','ARTIFACT_DRAFT','sha256:legacy',
         '[{"kind":"legacy"}]','[{"logicalId":"rule-1","version":"sha256:rule"}]',
         '2026-09-09T00:00:00Z','design','{"kind":"absent","logicalKey":"design:functional"}'
       )`,
    ).run();
    for (const [artifactId, designStage] of [
      ['artifact-functional', 'functional_design'],
      ['artifact-other', 'functional_design_extra'],
    ] as const) {
      db.prepare(
        `INSERT INTO artifacts(
           project_id,sr_id,artifact_id,kind,current_version,revision,design_stage,display_title
         ) VALUES ('project-1','sr-1',?,'design',1,1,?,'설계')`,
      ).run(artifactId, designStage);
      db.prepare(
        `INSERT INTO artifact_versions(
           project_id,sr_id,artifact_id,kind,version,markdown,section_index_json,
           requirement_links_json,author_origin,author_id,created_at,change_summary,payload_json
         ) VALUES ('project-1','sr-1',?,'design',1,?,'[]','[]','human','user-1',
           '2026-09-09T00:00:00Z','legacy','{}')`,
      ).run(artifactId, artifactId === 'artifact-functional' ? binaryMarkdown : '# 그대로');
    }
  }).immediate();
  return binaryMarkdown;
}

function supplementColumn(db: Database.Database) {
  return (db.pragma('table_info(input_snapshots)') as Array<{
    readonly name: string;
    readonly notnull: number;
    readonly dflt_value: string | null;
  }>).find((column) => column.name === 'supplement');
}

describe('input snapshot supplement migration', () => {
  it('실제 version 1 DB를 upgrade하며 기존 snapshot·artifact·checksum·trigger를 보존합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
    try {
      installVersion1(fixture.db);
      const binaryMarkdown = insertLegacyGraph(fixture.db);
      const triggersBefore = fixture.db.prepare(
        `SELECT name,sql FROM sqlite_master
          WHERE type='trigger' AND tbl_name IN ('input_snapshots','artifact_versions')
          ORDER BY name`,
      ).all();
      expect(() => assertSupportedSchema(fixture.db)).toThrow('지원하지 않는 migration 개수');

      migrateDatabase(fixture.db, undefined, '2026-09-09T01:00:00.000Z');

      expect(supplementColumn(fixture.db)).toEqual(expect.objectContaining({
        name: 'supplement', notnull: 0, dflt_value: null,
      }));
      expect(fixture.db.prepare(
        `SELECT snapshot_id,contents_json,project_rules_json,document_kind,target_basis_json,supplement
           FROM input_snapshots WHERE snapshot_id='snapshot-v1'`,
      ).get()).toEqual({
        snapshot_id: 'snapshot-v1',
        contents_json: '[{"kind":"legacy"}]',
        project_rules_json: '[{"logicalId":"rule-1","version":"sha256:rule"}]',
        document_kind: 'design',
        target_basis_json: '{"kind":"absent","logicalKey":"design:functional"}',
        supplement: null,
      });
      fixture.db.prepare(
        `INSERT INTO input_snapshots(
           project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
           contents_json,project_rules_json,captured_at,supplement
         ) VALUES ('project-1','sr-1',?,'v1.0.1','TEST',?,'[]','[]',
           '2026-09-09T01:00:00Z',?)`,
      ).run('snapshot-empty', 'sha256:empty', '');
      fixture.db.prepare(
        `INSERT INTO input_snapshots(
           project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
           contents_json,project_rules_json,captured_at,supplement
         ) VALUES ('project-1','sr-1',?,'v1.0.1','TEST',?,'[]','[]',
           '2026-09-09T01:00:00Z',?)`,
      ).run('snapshot-text', 'sha256:text', '추가 지시');
      expect(fixture.db.prepare(
        'SELECT snapshot_id,supplement FROM input_snapshots ORDER BY snapshot_id',
      ).all()).toEqual([
        { snapshot_id: 'snapshot-empty', supplement: '' },
        { snapshot_id: 'snapshot-text', supplement: '추가 지시' },
        { snapshot_id: 'snapshot-v1', supplement: null },
      ]);
      expect(fixture.db.prepare(
        'SELECT artifact_id,current_version,revision,design_stage FROM artifacts ORDER BY artifact_id',
      ).all()).toEqual([
        { artifact_id: 'artifact-functional', current_version: 1, revision: 1, design_stage: 'functional' },
        { artifact_id: 'artifact-other', current_version: 1, revision: 1, design_stage: 'functional_design_extra' },
      ]);
      const storedBinary = fixture.db.prepare(
        `SELECT markdown FROM artifact_versions
          WHERE project_id='project-1' AND sr_id='sr-1' AND artifact_id='artifact-functional'`,
      ).get() as { readonly markdown: Buffer };
      expect(Buffer.compare(storedBinary.markdown, binaryMarkdown)).toBe(0);
      expect(fixture.db.prepare(
        `SELECT number,checksum,applied_at FROM app_migrations ORDER BY number`,
      ).all()).toEqual([
        {
          number: 1,
          checksum: PLANREPO_MIGRATION_0001.checksum,
          applied_at: '2026-09-09T00:00:00.000Z',
        },
        {
          number: 2,
          checksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
          applied_at: '2026-09-09T01:00:00.000Z',
        },
      ]);
      expect(fixture.db.prepare(
        `SELECT name,sql FROM sqlite_master
          WHERE type='trigger' AND tbl_name IN ('input_snapshots','artifact_versions')
          ORDER BY name`,
      ).all()).toEqual(triggersBefore);
      expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
      expect(() => fixture.db.prepare(
        "UPDATE input_snapshots SET supplement='바꿈' WHERE snapshot_id='snapshot-v1'",
      ).run()).toThrow('append-only');
    } finally {
      await fixture.close();
    }
  });

  it('0002 중간 실패는 supplement DDL·정규화·migration row를 모두 rollback합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
    try {
      installVersion1(fixture.db);
      insertLegacyGraph(fixture.db);
      fixture.db.exec(
        `CREATE TEMP TRIGGER fail_known_stage_migration
         BEFORE UPDATE OF design_stage ON artifacts
         WHEN OLD.design_stage='functional_design'
         BEGIN SELECT RAISE(ABORT, '주입한 0002 실패'); END`,
      );
      expect(() => migrateDatabase(fixture.db)).toThrow('주입한 0002 실패');
      expect(supplementColumn(fixture.db)).toBeUndefined();
      expect(fixture.db.prepare(
        "SELECT design_stage FROM artifacts WHERE artifact_id='artifact-functional'",
      ).get()).toEqual({ design_stage: 'functional_design' });
      expect(fixture.db.prepare('SELECT number FROM app_migrations ORDER BY number').all())
        .toEqual([{ number: 1 }]);
      fixture.db.exec('DROP TRIGGER fail_known_stage_migration');
      migrateDatabase(fixture.db);
      expect(supplementColumn(fixture.db)?.name).toBe('supplement');
    } finally {
      await fixture.close();
    }
  });

  it('version 1 DB의 maintenance owner·runtime·slot·running blocker를 유지합니다', async () => {
    for (const blocker of ['maintenance', 'runtime', 'slot', 'running'] as const) {
      const fixture = await createTestDatabase({ testRunId: randomUUID(), prepared: false });
      try {
        installVersion1(fixture.db);
        if (blocker === 'maintenance') {
          fixture.db.prepare(
            `UPDATE maintenance_state SET owner_id='owner',started_at='2026-09-09T00:00:00Z'
              WHERE singleton_id=1`,
          ).run();
        } else if (blocker === 'runtime') {
          fixture.db.prepare(
            `INSERT INTO runtime_identities(
               runtime_id,host_id,boot_id,parent_pid,parent_started_at,registered_at
             ) VALUES ('runtime-1','host-1','boot-1',123,'known','2026-09-09T00:00:00Z')`,
          ).run();
          fixture.db.prepare(
            `INSERT INTO runtime_instances(runtime_id,heartbeat_at)
             VALUES ('runtime-1','2026-09-09T00:00:00Z')`,
          ).run();
        } else if (blocker === 'slot') {
          fixture.db.pragma('foreign_keys = OFF');
          fixture.db.prepare(
            `UPDATE execution_slot SET project_id='project-1',sr_id='sr-1',run_id='run-1',
               claim_id='claim-1',claim_token_hash='hash',runtime_id='runtime-1',
               launch_intent_id='launch-1' WHERE singleton_id=1`,
          ).run();
          fixture.db.pragma('foreign_keys = ON');
        } else {
          fixture.db.pragma('foreign_keys = OFF');
          fixture.db.prepare(
            `INSERT INTO generation_runs(
               project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
               requested_by,requested_at,status,revision,claim_id,started_at
             ) VALUES ('project-1','sr-1','run-1','TEST','snapshot-1','{}','user-1',
               '2026-09-09T00:00:00Z','running',1,'claim-1','2026-09-09T00:00:00Z')`,
          ).run();
          fixture.db.pragma('foreign_keys = ON');
        }
        const expectedMessage = {
          maintenance: 'maintenance', runtime: 'runtime', slot: '슬롯', running: 'running',
        }[blocker];
        expect(() => migrateDatabase(fixture.db), blocker).toThrow(expectedMessage);
        expect(supplementColumn(fixture.db), blocker).toBeUndefined();
        expect(fixture.db.prepare('SELECT number FROM app_migrations').all(), blocker)
          .toEqual([{ number: 1 }]);
      } finally {
        if (fixture.db.open) fixture.db.pragma('foreign_keys = ON');
        await fixture.close();
      }
    }
  });
});
