import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json';
import { createWorkspaceQueryService, type WorkspaceQueryService } from '@/src/application/workspace-query-service';
import { createPersistence } from '@/src/persistence/transaction';
import { createTestApp, type InvokeScope } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];

function commandScope(overrides: Partial<InvokeScope> = {}): InvokeScope {
  return {
    actorId: ownerId,
    projectId,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

function srGuard(srId: string, expectedRevision: number) {
  return {
    resource: {
      target: { kind: 'sr' as const, projectId, srId, entityId: srId },
      expectedRevision,
    },
  };
}

const registeredInput = {
  key: 'TEST-REGISTER-1',
  title: '중복 접수 검증',
  purpose: '하나의 SR만 등록합니다.',
  description: '최초 설명입니다.',
  ownerId,
};

function insertPendingRun(
  app: Awaited<ReturnType<typeof createTestApp>>,
  srId: string,
  providerSelection: unknown,
): void {
  app.db.transaction(() => {
    app.db.prepare(
      `INSERT INTO input_snapshots(
         project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
         contents_json,project_rules_json,captured_at
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      projectId, srId, 'snapshot-http-error', 'v1.0.1', 'QUESTION_PROPOSALS',
      'sha256:http-error', '[]', '[]', '2026-09-09T04:00:00Z',
    );
    app.db.prepare(
      `INSERT INTO generation_runs(
         project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
         requested_by,requested_at,status,revision
       ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      projectId, srId, 'run-http-error', 'QUESTION_PROPOSALS', 'snapshot-http-error',
      JSON.stringify(providerSelection), ownerId, '2026-09-09T04:00:00Z', 'pending', 1,
    );
  }).immediate();
}

async function requestSrDetail(
  app: Awaited<ReturnType<typeof createTestApp>>,
  srId: string,
) {
  return app.server.inject({
    method: 'POST',
    url: '/api/methods/M-047',
    headers: {
      host: new URL(app.baseURL).host,
      origin: app.baseURL,
      'x-planrepo-actor': ownerId,
    },
    payload: {
      scope: { kind: 'sr', projectId, srId },
      input: {},
    },
  });
}

describe('SR 접수와 기본 조회', () => {
  it('같은 등록 재전송은 고정 결과를 재생하고 다른 입력은 충돌시킵니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const scope = commandScope({ requestId: 'register-1', idempotencyKey: 'register-key' });
      const first = await app.invoke('M-003', scope, registeredInput);
      const replay = await app.invoke('M-003', { ...scope, requestId: 'register-2' }, registeredInput);
      const conflict = await app.invoke('M-003', scope, { ...registeredInput, title: '다른 제목' });

      expect(first).toMatchObject({ ok: true, disposition: 'Committed' });
      expect(replay).toMatchObject({ ok: true, disposition: 'Replayed' });
      if (first.ok && replay.ok) expect(replay.value).toEqual(first.value);
      expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM srs WHERE project_id=? AND sr_key=?',
      ).get(projectId, registeredInput.key)).toEqual({ count: 1 });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM command_receipts WHERE project_id=? AND actor_id=? AND idempotency_key=?',
      ).get(projectId, ownerId, scope.idempotencyKey)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('현재 프로젝트 멤버와 같은 프로젝트 owner만 새 SR을 등록합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const nonMember = await app.invoke('M-003', commandScope({ actorId: 'not-a-member' }), registeredInput);
      const invalidOwner = await app.invoke(
        'M-003',
        commandScope(),
        { ...registeredInput, ownerId: 'not-a-member' },
      );
      const deniedBoard = await app.invoke(
        'M-045',
        commandScope({ actorId: 'not-a-member' }),
        {},
      );
      const missingDetail = await app.invoke(
        'M-047',
        commandScope({ srId: 'missing-sr' }),
        {},
      );
      expect(nonMember).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(invalidOwner).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(deniedBoard).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(missingDetail).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(app.db.prepare('SELECT count(*) AS count FROM srs').get()).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('Mock Jira를 가져오고 두 키 공간의 중복을 기존 SR로 안내합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const first = await app.invoke('M-004', commandScope(), 'PAY-102');
      const duplicate = await app.invoke('M-004', commandScope(), 'PAY-102');
      expect(first).toMatchObject({
        ok: true,
        value: { kind: 'Imported', sr: { key: 'PAY-102', title: '결제 취소 기능' } },
      });
      expect(duplicate).toMatchObject({
        ok: true,
        value: { kind: 'Existing', ticketKey: 'PAY-102' },
      });

      const crossDuplicate = await app.invoke(
        'M-003',
        commandScope(),
        { ...registeredInput, key: 'PAY-102' },
      );
      expect(crossDuplicate).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
      expect(app.db.prepare(
        "SELECT count(*) AS count FROM srs WHERE project_id=? AND (sr_key='PAY-102' OR jira_key='PAY-102')",
      ).get(projectId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('설명 변경은 원 설명과 과거 사실을 보존하고 G1·G2를 재검토로 돌립니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      for (const [key, srId, revision, expectedEpoch, expectedDescriptionVersion] of [
        ['NOTI-028', manifest.srIds['NOTI-028'], 3, 2, 2],
        ['CAT-093', manifest.srIds['CAT-093'], 5, 3, 2],
      ] as const) {
        const result = await app.invoke(
          'M-005',
          commandScope({ srId, guard: srGuard(srId, revision) }),
          {
            title: `${key} 변경 제목`,
            purpose: `${key} 변경 목적`,
            description: `${key} 변경 설명`,
            changeReason: '승인 기준 설명을 고칩니다.',
          },
        );
        expect(result).toMatchObject({
          ok: true,
          value: {
            title: `${key} 변경 제목`,
            progressStage: 'requirements',
            originalDescriptionRef: { version: 1 },
            currentDescriptionRef: { version: expectedDescriptionVersion },
            gates: [
              { gate: 'G1', reviewEpoch: expectedEpoch, validity: 'invalid' },
              { gate: 'G2', reviewEpoch: expectedEpoch, validity: 'invalid' },
            ],
          },
        });
      }

      expect(app.db.prepare(
        'SELECT count(*) AS count FROM approvals WHERE project_id=? AND sr_id IN (?, ?)',
      ).get(projectId, manifest.srIds['NOTI-028'], manifest.srIds['CAT-093'])).toEqual({ count: 4 });
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM handoffs WHERE project_id=? AND sr_id IN (?, ?)',
      ).get(projectId, manifest.srIds['NOTI-028'], manifest.srIds['CAT-093'])).toEqual({ count: 2 });
      expect(app.db.prepare(
        "SELECT status, count(*) AS count FROM implementation_records WHERE project_id=? AND sr_id=? GROUP BY status",
      ).get(projectId, manifest.srIds['CAT-093'])).toEqual({ status: 'started', count: 1 });
    } finally {
      await app.close();
    }
  });

  it('설명 변경과 접수 전환은 실제 SR owner와 정확한 범위만 허용합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const created = await app.invoke('M-003', commandScope(), registeredInput);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const srId = created.value.scope.srId;
      const otherActor = manifest.personaIds['P-05'];
      const denied = await app.invoke(
        'M-005',
        commandScope({ actorId: otherActor, srId, guard: srGuard(srId, 1) }),
        { title: '거절', purpose: '거절', description: '거절', changeReason: '거절' },
      );
      expect(denied).toMatchObject({ ok: false, error: { code: 'NOT_ASSIGNED' } });

      const transition = await app.invoke(
        'M-028',
        commandScope({ srId, guard: srGuard(srId, 1) }),
        { toStage: 'requirements', reason: '요구사항 구체화를 시작합니다.' },
      );
      expect(transition).toMatchObject({
        ok: true,
        value: { progressStage: 'requirements', revision: 2 },
      });
      const directReady = await app.invoke(
        'M-028',
        commandScope({ srId, guard: srGuard(srId, 2) }),
        { toStage: 'ready', reason: '직접 이동을 시도합니다.' },
      );
      expect(directReady).toMatchObject({ ok: false, error: { code: 'GATE_BLOCKED' } });
    } finally {
      await app.close();
    }
  });

  it('보드와 상세는 같은 읽기 안의 실제 제목·설명·Mock·seed 자료를 쓰기 없이 반환합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const before = app.db.prepare('SELECT total_changes() AS changes').get();
      const board = await app.invoke('M-045', commandScope(), {});
      const detail = await app.invoke(
        'M-047',
        commandScope({ srId: manifest.srIds['CAT-093'] }),
        {},
      );
      expect(board).toMatchObject({
        ok: true,
        value: {
          projectId,
          revision: 1,
          cards: expect.arrayContaining([
            expect.objectContaining({
              sr: expect.objectContaining({ key: 'CAT-093', title: '상품 검색 필터', revision: 5 }),
            }),
          ]),
        },
      });
      expect(detail).toMatchObject({
        ok: true,
        value: {
          sr: { key: 'CAT-093', title: '상품 검색 필터' },
          originalDescription: { versionRef: { version: 1 }, description: expect.any(String) },
          currentDescription: { versionRef: { version: 1 }, description: expect.any(String) },
          mockTicket: { key: 'CAT-093', mock: true, status: '외부 구현 시작·현재 재검토' },
          artifacts: expect.arrayContaining([
            expect.objectContaining({ kind: 'requirements' }),
          ]),
          bundles: expect.arrayContaining([
            expect.objectContaining({ bundleRef: expect.objectContaining({ gate: 'G1' }) }),
            expect.objectContaining({ bundleRef: expect.objectContaining({ gate: 'G2' }) }),
          ]),
          implementations: expect.arrayContaining([
            expect.objectContaining({ status: 'started', activeForCurrentSr: false }),
          ]),
        },
      });
      expect(app.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('M-047 저장 JSON shape 손상을 STORE_UNAVAILABLE 503으로 정제합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const srId = manifest.srIds['PAY-102'];
      insertPendingRun(app, srId, {
        providerId: 'reference', modelChoice: { kind: 'explicit' },
      });
      const response = await requestSrDetail(app, srId);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'STORE_UNAVAILABLE' } });
    } finally {
      await app.close();
    }
  });

  it('M-047 calculator의 빈 fingerprint를 STORE_UNAVAILABLE 503으로 정제합니다', async () => {
    let queries: WorkspaceQueryService | undefined;
    let calculatorMode: 'empty' | 'programmer_error' = 'empty';
    const app = await createTestApp({
      fixture: 'DEMO-4',
      testRunId: randomUUID(),
      handlers: {
        'M-047': () => {
          if (queries === undefined) throw new Error('query service가 준비되지 않았습니다.');
          const srId = manifest.srIds['PAY-102'];
          return queries.getSrDetail({
            actor: {
              actorId: ownerId, projectId, roles: [], srAssignments: [], demo: true,
            },
            scope: { kind: 'sr', projectId, srId },
          });
        },
      },
    });
    try {
      queries = createWorkspaceQueryService(createPersistence(app.db), {
        currentInputFingerprints: {
          readCurrentInputFingerprint() {
            if (calculatorMode === 'programmer_error') throw new Error('programmer error');
            return '';
          },
        },
      });
      const srId = manifest.srIds['PAY-102'];
      insertPendingRun(app, srId, {
        providerId: 'reference', modelChoice: { kind: 'installed_default' },
      });
      const response = await requestSrDetail(app, srId);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'STORE_UNAVAILABLE' } });

      calculatorMode = 'programmer_error';
      const programmerError = await requestSrDetail(app, srId);
      expect(programmerError.statusCode).toBe(500);
      expect(programmerError.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    } finally {
      await app.close();
    }
  });

  it('receipt나 activity 저장 실패는 SR과 설명·gate를 함께 rollback합니다', async () => {
    for (const table of ['command_receipts', 'activity_events'] as const) {
      const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
      try {
        app.db.exec(
          `CREATE TEMP TRIGGER fail_${table} BEFORE INSERT ON ${table}
           BEGIN SELECT RAISE(ABORT, '주입한 ${table} 실패'); END`,
        );
        const result = await app.invoke(
          'M-003',
          commandScope(),
          { ...registeredInput, key: `ROLLBACK-${table}` },
        );
        expect(result).toMatchObject({ ok: false, error: { code: 'STORE_UNAVAILABLE' } });
        expect(app.db.prepare('SELECT count(*) AS count FROM srs').get()).toEqual({ count: 0 });
        expect(app.db.prepare('SELECT count(*) AS count FROM sr_description_versions').get()).toEqual({ count: 0 });
        expect(app.db.prepare('SELECT count(*) AS count FROM review_gate_states').get()).toEqual({ count: 0 });
        expect(app.db.prepare('SELECT count(*) AS count FROM command_receipts').get()).toEqual({ count: 0 });
        expect(app.db.prepare('SELECT count(*) AS count FROM activity_events').get()).toEqual({ count: 0 });
      } finally {
        await app.close();
      }
    }
  });
});
