import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifestJson from '@/config/demo/manifest.json';
import { seedDemo } from '@/src/persistence/seed-demo';
import { registerRuntime } from '@/src/persistence/maintenance';
import { BUSINESS_ENTITY_TABLES } from '@/src/persistence/migrations/0001-planrepo';
import { createTestDatabase } from '@/tests/helpers/test-database';
import { readDemoManifest } from '@/tests/helpers/demo-manifest';

function businessRowCount(db: import('better-sqlite3').Database): number {
  return BUSINESS_ENTITY_TABLES.reduce((count, table) => {
    const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
    return count + row.count;
  }, 0);
}

function insertRunningRun(db: import('better-sqlite3').Database): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO runtime_identities(
         runtime_id, host_id, boot_id, parent_pid, parent_started_at, registered_at
       ) VALUES ('runtime-history','host','boot',1,'unavailable','2026-09-09T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO workspace_projects(project_id, team_id, name, revision)
       VALUES ('existing-project','team','기존 프로젝트',1)`,
    ).run();
    db.prepare(
      `INSERT INTO demo_user_memberships(project_id,user_id,display_name,roles_json,revision,demo)
       VALUES ('existing-project','owner','담당자','["sr_owner"]',1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO srs(
         project_id,sr_id,sr_key,owner_id,original_description_id,original_description_version,
         current_description_id,current_description_version,workflow_version,implementation_unit_count,
         progress_stage,revision,created_at,updated_at
       ) VALUES (
         'existing-project','existing-sr','EXIST-1','owner','description',1,
         'description',1,'v1.0.1',1,'requirements',1,
         '2026-09-09T00:00:00Z','2026-09-09T00:00:00Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO sr_description_versions(
         project_id,sr_id,description_id,version,title,purpose,description,author_id,created_at
       ) VALUES (
         'existing-project','existing-sr','description',1,'기존','기존','기존','owner','2026-09-09T00:00:00Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO input_snapshots(
         project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
         contents_json,project_rules_json,captured_at
       ) VALUES (
         'existing-project','existing-sr','snapshot','v1.0.1','ARTIFACT_DRAFT','sha256:input',
         '{}','{}','2026-09-09T00:00:00Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO generation_runs(
         project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
         requested_by,requested_at,status,revision,claim_id,started_at
       ) VALUES (
         'existing-project','existing-sr','running-run','ARTIFACT_DRAFT','snapshot','{}',
         'owner','2026-09-09T00:00:00Z','running',1,'claim','2026-09-09T00:00:01Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO execution_claims(
         project_id,sr_id,run_id,claim_id,owner_runtime_id,ownership_token_hash,
         claimed_at,execution_policy_ref,launch_intent_id
       ) VALUES (
         'existing-project','existing-sr','running-run','claim','runtime-history','sha256:token',
         '2026-09-09T00:00:01Z','policy','launch'
       )`,
    ).run();
  }).immediate();
}

function corruptCatG1PassEpoch(db: import('better-sqlite3').Database): void {
  db.exec(
    `CREATE TEMP TRIGGER corrupt_cat_g1_pass_epoch BEFORE INSERT ON gate_transition_records
     WHEN NEW.transition_id='transition-cat-093-g1-passed' AND NEW.review_epoch=1
     BEGIN
       INSERT INTO gate_transition_records(
         project_id,sr_id,transition_id,gate,review_epoch,kind,actor_kind,actor_id,
         occurred_at,affected_version_refs_json,bundle_id,bundle_version,payload_json
       ) VALUES (
         NEW.project_id,NEW.sr_id,NEW.transition_id,NEW.gate,2,NEW.kind,NEW.actor_kind,NEW.actor_id,
         NEW.occurred_at,NEW.affected_version_refs_json,NEW.bundle_id,NEW.bundle_version,NEW.payload_json
       );
       SELECT RAISE(IGNORE);
     END`,
  );
}

function corruptCatHandoffRequirement(db: import('better-sqlite3').Database): void {
  db.exec(
    `CREATE TEMP TRIGGER corrupt_cat_handoff_requirement BEFORE INSERT ON handoffs
     WHEN NEW.handoff_id='handoff-cat-093-h1'
      AND json_extract(NEW.refs_json, '$.artifactVersionRefs[0].version')=1
     BEGIN
       INSERT INTO handoffs(
         project_id,sr_id,handoff_id,version,g1_gate,g1_bundle_id,g1_bundle_version,
         g2_gate,g2_bundle_id,g2_bundle_version,refs_json,workflow_version,validation_json,
         markdown_snapshot,digest,created_by,created_at,previous_handoff_id,
         previous_handoff_version,reason
       ) VALUES (
         NEW.project_id,NEW.sr_id,NEW.handoff_id,NEW.version,NEW.g1_gate,NEW.g1_bundle_id,NEW.g1_bundle_version,
         NEW.g2_gate,NEW.g2_bundle_id,NEW.g2_bundle_version,
         json_set(NEW.refs_json, '$.artifactVersionRefs[0].version', 2),
         NEW.workflow_version,NEW.validation_json,NEW.markdown_snapshot,NEW.digest,
         NEW.created_by,NEW.created_at,NEW.previous_handoff_id,NEW.previous_handoff_version,NEW.reason
       );
       SELECT RAISE(IGNORE);
     END`,
  );
}

describe('DEMO-4 시드', () => {
  it('공식 문서와 Workflow JSON 구조를 Markdown 범위에 맞춰 저장합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      seedDemo(fixture.db);
      const artifacts = fixture.db.prepare(
        `SELECT markdown, section_index_json, requirement_links_json
           FROM artifact_versions ORDER BY sr_id, artifact_id, version`,
      ).all() as Array<{
        markdown: string;
        section_index_json: string;
        requirement_links_json: string;
      }>;
      for (const artifact of artifacts) {
        const sections = JSON.parse(artifact.section_index_json) as Array<{
          sectionId: string; title: string; startOffset: number; endOffset: number;
        }>;
        expect(sections.length).toBeGreaterThan(0);
        for (const section of sections) {
          expect(Number.isInteger(section.startOffset)).toBe(true);
          expect(Number.isInteger(section.endOffset)).toBe(true);
          expect(section.startOffset).toBeGreaterThanOrEqual(0);
          expect(section.endOffset).toBeGreaterThan(section.startOffset);
          expect(section.endOffset).toBeLessThanOrEqual(artifact.markdown.length);
          expect(artifact.markdown.slice(section.startOffset, section.endOffset))
            .toContain(`## ${section.sectionId}`);
        }
        const sectionIds = new Set(sections.map((section) => section.sectionId));
        const links = JSON.parse(artifact.requirement_links_json) as Array<{
          requirementId: string; sectionIds: string[]; acceptanceCriteria: string[];
        }>;
        for (const link of links) {
          expect(link.requirementId).toMatch(/^REQ-/u);
          expect(link.sectionIds.length).toBeGreaterThan(0);
          expect(link.sectionIds.every((id) => sectionIds.has(id))).toBe(true);
          expect(link.acceptanceCriteria.length).toBeGreaterThan(0);
        }
      }

      const workflowRows = fixture.db.prepare(
        'SELECT stages_json, requirement_task_links_json FROM workflow_plan_versions ORDER BY sr_id',
      ).all() as Array<{ stages_json: string; requirement_task_links_json: string }>;
      for (const row of workflowRows) {
        expect(JSON.parse(row.stages_json)).toEqual([
          expect.objectContaining({
            stageId: 'functional_design', choice: 'executed', designArtifactRefs: expect.any(Array),
          }),
          expect.objectContaining({
            stageId: 'nfr_requirements', choice: 'skipped', reason: expect.any(String),
          }),
        ]);
        expect(JSON.parse(row.requirement_task_links_json)).toEqual([
          expect.objectContaining({
            taskId: 'task-implement',
            requirementIds: expect.arrayContaining([expect.stringMatching(/^REQ-/u)]),
            verification: expect.arrayContaining([expect.any(String)]),
            order: 1,
          }),
        ]);
      }
    } finally {
      await fixture.close();
    }
  });

  it('manifest의 명시 ID가 시나리오와 다르면 시드를 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    const entityIds = manifestJson.entityIds['NOTI-028'];
    const original = entityIds.handoffId;
    try {
      entityIds.handoffId = 'handoff-noti-028-malformed';
      expect(() => seedDemo(fixture.db)).toThrow('DEMO-4 manifest');
      expect(businessRowCount(fixture.db)).toBe(0);
    } finally {
      entityIds.handoffId = original;
      await fixture.close();
    }

    const storedFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      seedDemo(storedFixture.db);
      storedFixture.db.exec('DROP TRIGGER demo_seed_manifests_no_update');
      const row = storedFixture.db.prepare(
        "SELECT manifest_json FROM demo_seed_manifests WHERE seed_id='DEMO-4'",
      ).get() as { manifest_json: string };
      const malformed = JSON.parse(row.manifest_json) as typeof manifestJson;
      malformed.entityIds['NOTI-028'].handoffId = 'handoff-noti-028-missing';
      const text = JSON.stringify(malformed);
      const digest = `sha256:${createHash('sha256').update(text).digest('hex')}`;
      storedFixture.db.prepare(
        "UPDATE demo_seed_manifests SET manifest_json=?, manifest_digest=? WHERE seed_id='DEMO-4'",
      ).run(text, digest);
      expect(() => readDemoManifest(storedFixture.db)).toThrow('실제 자료와 일치하지 않습니다');
    } finally {
      await storedFixture.close();
    }
  });

  it('빈 schema DB에 고정된 네 SR을 준비합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      seedDemo(fixture.db);

      expect(
        fixture.db
          .prepare('SELECT sr_key, progress_stage FROM srs ORDER BY sr_key')
          .all(),
      ).toEqual([
        { sr_key: 'AUTH-331', progress_stage: 'planning' },
        { sr_key: 'CAT-093', progress_stage: 'requirements' },
        { sr_key: 'NOTI-028', progress_stage: 'ready' },
        { sr_key: 'PAY-102', progress_stage: 'requirements' },
      ]);
      expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
      const writesBeforeRead = fixture.db.prepare('SELECT total_changes() AS changes').get();
      expect(readDemoManifest(fixture.db)).toMatchObject({
        seedId: 'DEMO-4',
        version: '1',
        projectId: 'demo-project',
        defaultActorId: 'persona-p01-owner',
        personaIds: {
          'P-01': 'persona-p01-owner',
          'P-02': 'persona-p02-requester',
          'P-03': 'persona-p03-reviewer',
          'P-04': 'persona-p04-decision-maker',
          'P-05': 'persona-p05-admin',
        },
        srIds: {
          'PAY-102': 'sr-pay-102',
          'AUTH-331': 'sr-auth-331',
          'NOTI-028': 'sr-noti-028',
          'CAT-093': 'sr-cat-093',
        },
      });
      expect(fixture.db.prepare('SELECT total_changes() AS changes').get()).toEqual(writesBeforeRead);
      expect(fixture.db.prepare(
        `SELECT DISTINCT actor_kind, actor_id FROM (
           SELECT actor_kind, actor_id FROM gate_transition_records
           UNION ALL
           SELECT actor_kind, actor_id FROM activity_events
         ) ORDER BY actor_kind, actor_id`,
      ).all()).toEqual([{ actor_kind: 'user', actor_id: 'persona-p01-owner' }]);
    } finally {
      await fixture.close();
    }
  });

  it('현재 상태와 과거 기준을 서로 다른 축으로 보존합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      seedDemo(fixture.db);

      expect(
        fixture.db.prepare(
          `SELECT s.sr_key, s.progress_stage, g.gate, g.review_epoch,
                  g.validity, g.needs_new_bundle
             FROM srs s JOIN review_gate_states g
               ON g.project_id=s.project_id AND g.sr_id=s.sr_id
            ORDER BY s.sr_key, g.gate`,
        ).all(),
      ).toEqual([
        { sr_key: 'AUTH-331', progress_stage: 'planning', gate: 'G1', review_epoch: 1, validity: 'valid', needs_new_bundle: 0 },
        { sr_key: 'AUTH-331', progress_stage: 'planning', gate: 'G2', review_epoch: 2, validity: 'not_passed', needs_new_bundle: 1 },
        { sr_key: 'CAT-093', progress_stage: 'requirements', gate: 'G1', review_epoch: 2, validity: 'invalid', needs_new_bundle: 1 },
        { sr_key: 'CAT-093', progress_stage: 'requirements', gate: 'G2', review_epoch: 2, validity: 'invalid', needs_new_bundle: 1 },
        { sr_key: 'NOTI-028', progress_stage: 'ready', gate: 'G1', review_epoch: 1, validity: 'valid', needs_new_bundle: 0 },
        { sr_key: 'NOTI-028', progress_stage: 'ready', gate: 'G2', review_epoch: 1, validity: 'valid', needs_new_bundle: 0 },
        { sr_key: 'PAY-102', progress_stage: 'requirements', gate: 'G1', review_epoch: 1, validity: 'not_passed', needs_new_bundle: 0 },
        { sr_key: 'PAY-102', progress_stage: 'requirements', gate: 'G2', review_epoch: 1, validity: 'not_passed', needs_new_bundle: 0 },
      ]);

      expect(fixture.db.prepare(
        `SELECT s.progress_stage, s.active_implementation_id, i.status, i.handoff_id
           FROM srs s JOIN implementation_records i
             ON i.project_id=s.project_id AND i.sr_id=s.sr_id
          WHERE s.sr_key='CAT-093'`,
      ).get()).toEqual({
        progress_stage: 'requirements',
        active_implementation_id: null,
        status: 'started',
        handoff_id: 'handoff-cat-093-h1',
      });

      expect(fixture.db.prepare(
        `SELECT status, blocking, current_application_event_id
           FROM change_requests WHERE change_request_id='change-auth-error-handling'`,
      ).get()).toEqual({
        status: 'awaiting_confirmation',
        blocking: 1,
        current_application_event_id: 'event-auth-error-handling-applied',
      });

      const catOrder = fixture.db.prepare(
        `SELECT i.started_at, v.created_at,
                json_extract(g1.payload_json, '$.fromStage') AS g1_from_stage,
                json_extract(g1.payload_json, '$.toStage') AS g1_to_stage,
                json_extract(g2.payload_json, '$.productStageChanged') AS g2_stage_changed
           FROM implementation_records i
           JOIN artifact_versions v
             ON v.project_id=i.project_id AND v.sr_id=i.sr_id
            AND v.artifact_id='artifact-cat-093-requirements' AND v.version=2
           JOIN gate_transition_records g1
             ON g1.project_id=i.project_id AND g1.sr_id=i.sr_id
            AND g1.transition_id='transition-cat-093-g1-invalidated'
           JOIN gate_transition_records g2
             ON g2.project_id=i.project_id AND g2.sr_id=i.sr_id
            AND g2.transition_id='transition-cat-093-g2-invalidated'`,
      ).get() as {
        started_at: string;
        created_at: string;
        g1_from_stage: string;
        g1_to_stage: string;
        g2_stage_changed: number;
      };
      expect(Date.parse(catOrder.created_at)).toBeGreaterThan(Date.parse(catOrder.started_at));
      expect(catOrder).toMatchObject({
        g1_from_stage: 'implementing',
        g1_to_stage: 'requirements',
        g2_stage_changed: 0,
      });

      const authOrder = fixture.db.prepare(
        `SELECT a.approved_at, v.created_at, e.occurred_at AS applied_at
           FROM approvals a JOIN artifact_versions v
             ON v.project_id=a.project_id AND v.sr_id=a.sr_id
            AND v.artifact_id='artifact-auth-331-implementation-plan' AND v.version=2
           JOIN change_request_events e
             ON e.project_id=v.project_id AND e.sr_id=v.sr_id
            AND e.event_id='event-auth-error-handling-applied'
          WHERE a.approval_id='approval-auth-331-g2-v1'`,
      ).get() as { approved_at: string; created_at: string; applied_at: string };
      expect(Date.parse(authOrder.created_at)).toBeGreaterThan(Date.parse(authOrder.approved_at));
      expect(Date.parse(authOrder.applied_at)).toBeGreaterThan(Date.parse(authOrder.created_at));
      expect(fixture.db.prepare(
        `SELECT count(*) AS count
           FROM change_requests c
           JOIN artifact_versions v
             ON v.project_id=c.project_id AND v.sr_id=c.sr_id
            AND v.artifact_id=c.original_artifact_id
            AND v.kind=c.original_artifact_kind
            AND v.version=c.original_artifact_version
           JOIN json_each(v.section_index_json) section
             ON json_extract(section.value, '$.sectionId')=c.original_section_id
          WHERE c.change_request_id='change-auth-error-handling'`,
      ).get()).toEqual({ count: 1 });
    } finally {
      await fixture.close();
    }
  });

  it('반복 실행을 거절하고 기존 네 SR을 그대로 보존합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      seedDemo(fixture.db);
      const before = fixture.db.prepare('SELECT * FROM srs ORDER BY sr_id').all();

      expect(() => seedDemo(fixture.db)).toThrow('이미 DEMO-4 시드가 완료됐습니다.');
      expect(fixture.db.prepare('SELECT * FROM srs ORDER BY sr_id').all()).toEqual(before);
      expect(fixture.db.prepare('SELECT count(*) AS count FROM demo_seed_manifests').get()).toEqual({ count: 1 });
    } finally {
      await fixture.close();
    }
  });

  it('기존 업무 자료가 있으면 거절하고 보존합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.prepare(
        `INSERT INTO workspace_projects(project_id,team_id,name,revision)
         VALUES ('existing-project','team','기존 프로젝트',1)`,
      ).run();

      expect(() => seedDemo(fixture.db)).toThrow('업무 자료가 있는 DB에는 DEMO-4 시드를 넣을 수 없습니다.');
      expect(fixture.db.prepare('SELECT project_id FROM workspace_projects').all()).toEqual([
        { project_id: 'existing-project' },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it('중간 삽입 실패가 전체 그래프와 완료 표식을 rollback합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.exec(
        `CREATE TEMP TRIGGER fail_demo_bundle BEFORE INSERT ON review_bundles
         BEGIN SELECT RAISE(ABORT, '주입한 시드 실패'); END`,
      );

      expect(() => seedDemo(fixture.db)).toThrow('주입한 시드 실패');
      expect(businessRowCount(fixture.db)).toBe(0);
      expect(fixture.db.prepare('SELECT count(*) AS count FROM demo_seed_manifests').get()).toEqual({ count: 0 });
      expect(fixture.db.prepare('SELECT owner_id FROM maintenance_state WHERE singleton_id=1').get()).toEqual({ owner_id: null });
    } finally {
      await fixture.close();
    }
  });

  it('활성 runtime과 기존 maintenance owner를 각각 거절합니다', async () => {
    const runtimeFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      registerRuntime(runtimeFixture.db, {
        runtimeId: 'runtime-active',
        hostId: 'host',
        bootId: 'boot',
        parentPid: 1,
        parentStartedAt: 'unavailable',
        registeredAt: '2026-09-09T00:00:00Z',
      });
      expect(() => seedDemo(runtimeFixture.db)).toThrow('runtime이 등록된 DB');
      expect(businessRowCount(runtimeFixture.db)).toBe(0);
    } finally {
      await runtimeFixture.close();
    }

    const ownerFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      ownerFixture.db.prepare(
        `UPDATE maintenance_state SET owner_id='other-owner', started_at='2026-09-09T00:00:00Z'
          WHERE singleton_id=1`,
      ).run();
      expect(() => seedDemo(ownerFixture.db)).toThrow('maintenance가 이미 진행 중입니다.');
      expect(businessRowCount(ownerFixture.db)).toBe(0);
    } finally {
      await ownerFixture.close();
    }
  });

  it('비활성 runtime 이력만으로는 시드를 차단하지 않습니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.prepare(
        `INSERT INTO runtime_identities(
           runtime_id,host_id,boot_id,parent_pid,parent_started_at,registered_at
         ) VALUES ('runtime-history','host','boot',1,'unavailable','2026-09-09T00:00:00Z')`,
      ).run();

      seedDemo(fixture.db);
      expect(fixture.db.prepare('SELECT count(*) AS count FROM srs').get()).toEqual({ count: 4 });
      expect(fixture.db.prepare('SELECT runtime_id FROM runtime_identities').all()).toEqual([
        { runtime_id: 'runtime-history' },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it('점유 slot과 running 작업을 각각 거절합니다', async () => {
    const slotFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      slotFixture.db.pragma('foreign_keys = OFF');
      slotFixture.db.prepare(
        `UPDATE execution_slot SET
           project_id='unknown-project', sr_id='unknown-sr', run_id='unknown-run',
           claim_id='unknown-claim', claim_token_hash='sha256:unknown',
           runtime_id='unknown-runtime', launch_intent_id='unknown-launch'
         WHERE singleton_id=1`,
      ).run();
      slotFixture.db.pragma('foreign_keys = ON');

      expect(() => seedDemo(slotFixture.db)).toThrow('실행 슬롯이 점유된 DB');
      expect(businessRowCount(slotFixture.db)).toBe(0);
    } finally {
      await slotFixture.close();
    }

    const runningFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      insertRunningRun(runningFixture.db);
      const before = businessRowCount(runningFixture.db);
      expect(() => seedDemo(runningFixture.db)).toThrow('running 작업이 있는 DB');
      expect(businessRowCount(runningFixture.db)).toBe(before);
    } finally {
      await runningFixture.close();
    }
  });

  it('DB FK 밖의 누락 JSON 참조를 commit 전에 거절합니다', async () => {
    const fixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      fixture.db.exec(
        `CREATE TEMP TRIGGER omit_pay_requirement BEFORE INSERT ON artifact_versions
         WHEN NEW.artifact_id='artifact-pay-102-requirements'
         BEGIN SELECT RAISE(IGNORE); END`,
      );

      expect(() => seedDemo(fixture.db)).toThrow('DEMO-4 시드 참조 검증');
      expect(businessRowCount(fixture.db)).toBe(0);
      expect(fixture.db.prepare('SELECT count(*) AS count FROM demo_seed_manifests').get()).toEqual({ count: 0 });
    } finally {
      await fixture.close();
    }
  });

  it('존재하지만 관계가 다른 JSON 참조도 commit 전에 거절합니다', async () => {
    const bundleFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      bundleFixture.db.exec(
        `CREATE TEMP TRIGGER corrupt_bundle_assignment BEFORE INSERT ON review_bundles
         WHEN NEW.bundle_id='bundle-auth-331-g1-v1'
          AND json_extract(NEW.payload_json, '$.assignmentRef.entityId') <> 'assignment-auth-331-g2'
         BEGIN
           INSERT INTO review_bundles(
             project_id,sr_id,gate,bundle_id,version,review_epoch,
             assignment_id,assignment_version,policy_id,policy_version,checklist_json,
             created_by,created_at,previous_bundle_id,previous_bundle_version,
             g1_gate,g1_bundle_id,g1_bundle_version,payload_json
           ) VALUES (
             NEW.project_id,NEW.sr_id,NEW.gate,NEW.bundle_id,NEW.version,NEW.review_epoch,
             NEW.assignment_id,NEW.assignment_version,NEW.policy_id,NEW.policy_version,NEW.checklist_json,
             NEW.created_by,NEW.created_at,NEW.previous_bundle_id,NEW.previous_bundle_version,
             NEW.g1_gate,NEW.g1_bundle_id,NEW.g1_bundle_version,
             json_set(NEW.payload_json, '$.assignmentRef.entityId', 'assignment-auth-331-g2')
           );
           SELECT RAISE(IGNORE);
         END`,
      );
      expect(() => seedDemo(bundleFixture.db)).toThrow('DEMO-4 시드 참조 검증');
      expect(businessRowCount(bundleFixture.db)).toBe(0);
    } finally {
      await bundleFixture.close();
    }

    const handoffFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      handoffFixture.db.exec(
        `CREATE TEMP TRIGGER corrupt_handoff_approval BEFORE INSERT ON handoffs
         WHEN NEW.handoff_id='handoff-noti-028-h1'
          AND json_extract(NEW.refs_json, '$.approvalRefs[1].entityId') <> 'approval-noti-028-g1-v1'
         BEGIN
           INSERT INTO handoffs(
             project_id,sr_id,handoff_id,version,g1_gate,g1_bundle_id,g1_bundle_version,
             g2_gate,g2_bundle_id,g2_bundle_version,refs_json,workflow_version,validation_json,
             markdown_snapshot,digest,created_by,created_at,previous_handoff_id,
             previous_handoff_version,reason
           ) VALUES (
             NEW.project_id,NEW.sr_id,NEW.handoff_id,NEW.version,NEW.g1_gate,NEW.g1_bundle_id,NEW.g1_bundle_version,
             NEW.g2_gate,NEW.g2_bundle_id,NEW.g2_bundle_version,
             json_set(NEW.refs_json, '$.approvalRefs[1].entityId', 'approval-noti-028-g1-v1'),
             NEW.workflow_version,NEW.validation_json,NEW.markdown_snapshot,NEW.digest,
             NEW.created_by,NEW.created_at,NEW.previous_handoff_id,NEW.previous_handoff_version,NEW.reason
           );
           SELECT RAISE(IGNORE);
         END`,
      );
      expect(() => seedDemo(handoffFixture.db)).toThrow('DEMO-4 시드 참조 검증');
      expect(businessRowCount(handoffFixture.db)).toBe(0);
    } finally {
      await handoffFixture.close();
    }
  });

  it('pass·handoff·현재 gate의 교차 관계 오염을 각각 거절합니다', async () => {
    const passFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      corruptCatG1PassEpoch(passFixture.db);
      expect(() => seedDemo(passFixture.db)).toThrow('DEMO-4 시드 참조 검증');
      expect(businessRowCount(passFixture.db)).toBe(0);
    } finally {
      await passFixture.close();
    }

    const handoffFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      corruptCatHandoffRequirement(handoffFixture.db);
      expect(() => seedDemo(handoffFixture.db)).toThrow('DEMO-4 시드 참조 검증');
      expect(businessRowCount(handoffFixture.db)).toBe(0);
    } finally {
      await handoffFixture.close();
    }

    const gateFixture = await createTestDatabase({ testRunId: randomUUID() });
    try {
      gateFixture.db.exec(
        `CREATE TEMP TRIGGER corrupt_cat_g1_last_pass AFTER INSERT ON review_gate_states
         WHEN NEW.sr_id='sr-cat-093' AND NEW.gate='G1'
         BEGIN
           UPDATE review_gate_states
              SET last_pass_transition_id='transition-cat-093-g2-passed'
            WHERE project_id=NEW.project_id AND sr_id=NEW.sr_id AND gate=NEW.gate;
         END`,
      );
      expect(() => seedDemo(gateFixture.db)).toThrow('DEMO-4 시드 참조 검증');
      expect(businessRowCount(gateFixture.db)).toBe(0);
    } finally {
      await gateFixture.close();
    }
  });
});
