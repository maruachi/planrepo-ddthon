import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json';
import { createSrContextService } from '@/src/application/sr-context-service';
import { createWorkspaceQueryService } from '@/src/application/workspace-query-service';
import type { CommandContext, NoGuard, ProjectScope, RevisionGuard, SrScope } from '@/src/contracts/context';
import { createPersistence } from '@/src/persistence/transaction';
import { readGenerationRuns } from '@/src/persistence/generation-run-query';
import { createMockTicketProvider } from '@/src/providers/reference/mock-ticket-provider';
import { currentCase, currentReviewInput, demoCase } from '@/tests/helpers/domain-cases';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];

function actor(actorId = ownerId) {
  return { actorId, projectId, roles: [], srAssignments: [], demo: true as const };
}

function projectCommand(idempotencyKey: string = randomUUID()): CommandContext<ProjectScope, NoGuard> {
  return {
    actor: actor(),
    scope: { kind: 'project', projectId },
    requestId: randomUUID(),
    idempotencyKey,
    guard: { kind: 'none' },
  };
}

function srCommand(srId: string, revision: number): CommandContext<SrScope, RevisionGuard<'sr'>> {
  return {
    actor: actor(),
    scope: { kind: 'sr', projectId, srId },
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    guard: {
      resource: {
        target: { kind: 'sr', projectId, srId, entityId: srId },
        expectedRevision: revision,
      },
    },
  };
}

function services(app: Awaited<ReturnType<typeof createTestApp>>) {
  const persistence = createPersistence(app.db);
  return {
    sr: createSrContextService({ persistence, mockTickets: createMockTicketProvider() }),
    query: createWorkspaceQueryService(persistence),
  };
}

describe('CG-06 서비스와 저장 경계', () => {
  it('등록 결과와 receipt를 고정해 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { sr } = services(app);
      const ctx = projectCommand('same-register');
      const input = {
        key: 'DIRECT-1', title: '직접 등록', purpose: '재생 검증',
        description: '최초 설명', ownerId,
      };
      const first = sr.registerSr(ctx, input);
      const replay = sr.registerSr({ ...ctx, requestId: randomUUID() }, input);
      expect(first).toMatchObject({ kind: 'Committed', value: { title: '직접 등록', revision: 1 } });
      expect(replay).toMatchObject({ kind: 'Replayed', value: first.kind === 'Committed' ? first.value : {} });
      expect(app.db.prepare('SELECT count(*) AS count FROM srs').get()).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('Mock 조회 뒤 가져오고 두 키 공간의 중복을 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { sr } = services(app);
      const firstContext = projectCommand('cross-command-key');
      expect(sr.importMockTicket(firstContext, 'PAY-102')).toMatchObject({
        kind: 'Committed', value: { kind: 'Imported', sr: { key: 'PAY-102', title: '결제 취소 기능' } },
      });
      expect(sr.registerSr(firstContext, {
        key: 'OTHER-KEY', title: '다른 명령', purpose: '다른 명령',
        description: '다른 명령', ownerId,
      })).toMatchObject({ kind: 'Rejected', error: { code: 'IDEMPOTENCY_CONFLICT' } });
      expect(sr.importMockTicket(projectCommand(), 'PAY-102')).toMatchObject({
        kind: 'Committed', value: { kind: 'Existing', ticketKey: 'PAY-102' },
      });
      expect(sr.registerSr(projectCommand(), {
        key: 'PAY-102', title: '충돌', purpose: '충돌', description: '충돌', ownerId,
      })).toMatchObject({ kind: 'Rejected', error: { code: 'IDEMPOTENCY_CONFLICT' } });
    } finally {
      await app.close();
    }
  });

  it('현재 멤버·지정 owner와 실제 SR owner를 저장 경계에서 다시 검사합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { sr } = services(app);
      const invalidActor = sr.registerSr(
        { ...projectCommand(), actor: actor('not-a-member') },
        { key: 'DENY-1', title: '거절', purpose: '거절', description: '거절', ownerId },
      );
      const invalidOwner = sr.registerSr(projectCommand(), {
        key: 'DENY-2', title: '거절', purpose: '거절', description: '거절', ownerId: 'not-a-member',
      });
      expect(invalidActor).toMatchObject({ kind: 'Rejected', error: { code: 'FORBIDDEN' } });
      expect(invalidOwner).toMatchObject({ kind: 'Rejected', error: { code: 'NOT_FOUND' } });

      const created = sr.registerSr(projectCommand(), {
        key: 'OWNER-1', title: '담당자 검사', purpose: '담당자 검사', description: '최초', ownerId,
      });
      expect(created.kind).toBe('Committed');
      if (created.kind !== 'Committed') return;
      const srId = created.value.scope.srId;
      const denied = sr.updateSrDescription(
        { ...srCommand(srId, 1), actor: actor(manifest.personaIds['P-05']) },
        { title: '거절', purpose: '거절', description: '거절', changeReason: '거절' },
      );
      expect(denied).toMatchObject({ kind: 'Rejected', error: { code: 'NOT_ASSIGNED' } });
      expect(app.db.prepare('SELECT count(*) AS count FROM srs').get()).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });

  it('Mock 조회 전에 현재 멤버를 검사하고 재생 전에도 지정 owner 현재성을 다시 검사합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const persistence = createPersistence(app.db);
      let lookupCount = 0;
      const sr = createSrContextService({
        persistence,
        mockTickets: {
          find(key) {
            lookupCount += 1;
            return createMockTicketProvider().find(key);
          },
        },
      });
      expect(sr.importMockTicket(
        { ...projectCommand(), actor: actor('not-a-member') },
        'PAY-102',
      )).toMatchObject({ kind: 'Rejected', error: { code: 'FORBIDDEN' } });
      expect(lookupCount).toBe(0);

      const assignedOwner = manifest.personaIds['P-02'];
      const ctx = projectCommand('owner-current-replay');
      const input = {
        key: 'OWNER-CURRENT-1', title: '현재 owner', purpose: '현재성',
        description: '현재성', ownerId: assignedOwner,
      };
      expect(sr.registerSr(ctx, input)).toMatchObject({ kind: 'Committed' });
      app.db.pragma('foreign_keys = OFF');
      app.db.prepare(
        'DELETE FROM demo_user_memberships WHERE project_id=? AND user_id=?',
      ).run(projectId, assignedOwner);
      expect(sr.registerSr({ ...ctx, requestId: randomUUID() }, input)).toMatchObject({
        kind: 'Rejected', error: { code: 'NOT_FOUND' },
      });
    } finally {
      await app.close();
    }
  });

  it('접수 SR만 명시적으로 requirements로 전환하고 재전송을 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { sr } = services(app);
      const created = sr.registerSr(projectCommand(), {
        key: 'TRANSITION-1', title: '전환', purpose: '전환', description: '전환', ownerId,
      });
      expect(created.kind).toBe('Committed');
      if (created.kind !== 'Committed') return;
      const srId = created.value.scope.srId;
      const ctx = srCommand(srId, 1);
      const input = { toStage: 'requirements' as const, reason: '구체화를 시작합니다.' };
      const first = sr.transitionStage(ctx, input);
      const replay = sr.transitionStage({ ...ctx, requestId: randomUUID() }, input);
      expect(first).toMatchObject({ kind: 'Committed', value: { progressStage: 'requirements', revision: 2 } });
      expect(replay).toMatchObject({ kind: 'Replayed', value: first.kind === 'Committed' ? first.value : {} });
      const blocked = sr.transitionStage(srCommand(srId, 2), {
        toStage: 'ready', reason: '직접 이동',
      });
      expect(blocked).toMatchObject({ kind: 'Rejected', error: { code: 'GATE_BLOCKED' } });
    } finally {
      await app.close();
    }
  });

  it('같은 receipt key라도 M-005와 M-028의 guard가 바뀌면 기존 receipt와 함께 충돌합니다', async () => {
    const demo = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { sr } = services(demo);
      const noti = currentCase(demo.db, 'NOTI-028');
      const updateContext = {
        ...srCommand(noti.srId, noti.sr.revision),
        idempotencyKey: 'guarded-description',
      };
      const edit = {
        title: 'guard 검사', purpose: 'guard 검사', description: 'guard 검사', changeReason: 'guard 검사',
      };
      const first = sr.updateSrDescription(updateContext, edit);
      const conflict = sr.updateSrDescription({
        ...updateContext,
        requestId: randomUUID(),
        guard: {
          resource: {
            ...updateContext.guard.resource,
            expectedRevision: 999,
          },
        },
      }, edit);
      expect(first).toMatchObject({ kind: 'Committed' });
      expect(conflict).toMatchObject({
        kind: 'Rejected',
        error: { code: 'IDEMPOTENCY_CONFLICT' },
        priorReceipt: first.kind === 'Committed' ? { receiptId: first.receipt.receiptId } : {},
      });
    } finally {
      await demo.close();
    }

    const empty = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { sr } = services(empty);
      const created = sr.registerSr(projectCommand(), {
        key: 'GUARD-TRANSITION', title: 'guard 검사', purpose: 'guard 검사',
        description: 'guard 검사', ownerId,
      });
      expect(created.kind).toBe('Committed');
      if (created.kind !== 'Committed') return;
      const transitionContext = {
        ...srCommand(created.value.scope.srId, created.value.revision),
        idempotencyKey: 'guarded-transition',
      };
      const transition = { toStage: 'requirements' as const, reason: 'guard 검사' };
      const first = sr.transitionStage(transitionContext, transition);
      const conflict = sr.transitionStage({
        ...transitionContext,
        requestId: randomUUID(),
        guard: {
          resource: {
            ...transitionContext.guard.resource,
            expectedRevision: 999,
          },
        },
      }, transition);
      expect(first).toMatchObject({ kind: 'Committed' });
      expect(conflict).toMatchObject({
        kind: 'Rejected',
        error: { code: 'IDEMPOTENCY_CONFLICT' },
        priorReceipt: first.kind === 'Committed' ? { receiptId: first.receipt.receiptId } : {},
      });
    } finally {
      await empty.close();
    }
  });

  it('확정된 Mock import는 provider를 다시 호출하지 않고 현재 권한을 검사해 재생합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      let mode: 'present' | 'missing' | 'throw' = 'present';
      let lookupCount = 0;
      const sr = createSrContextService({
        persistence: createPersistence(app.db),
        mockTickets: {
          find(key) {
            lookupCount += 1;
            if (mode === 'throw') throw new Error('provider down');
            if (mode === 'missing') return undefined;
            return createMockTicketProvider().find(key);
          },
        },
      });
      const context = projectCommand('provider-independent-replay');
      expect(sr.importMockTicket(context, 'PAY-102')).toMatchObject({ kind: 'Committed' });
      mode = 'missing';
      expect(sr.importMockTicket({ ...context, requestId: randomUUID() }, 'PAY-102')).toMatchObject({
        kind: 'Replayed',
      });
      mode = 'throw';
      expect(sr.importMockTicket({ ...context, requestId: randomUUID() }, 'PAY-102')).toMatchObject({
        kind: 'Replayed',
      });
      expect(lookupCount).toBe(1);

      app.db.pragma('foreign_keys = OFF');
      app.db.prepare(
        'DELETE FROM demo_user_memberships WHERE project_id=? AND user_id=?',
      ).run(projectId, ownerId);
      expect(sr.importMockTicket({ ...context, requestId: randomUUID() }, 'PAY-102')).toMatchObject({
        kind: 'Rejected', error: { code: 'FORBIDDEN' },
      });
      expect(lookupCount).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('새 Mock import에서 provider 예외를 정제된 오류로 반환합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const sr = createSrContextService({
        persistence: createPersistence(app.db),
        mockTickets: { find() { throw new Error('provider secret'); } },
      });
      expect(sr.importMockTicket(projectCommand(), 'PAY-102')).toMatchObject({
        kind: 'Rejected', error: { code: 'PROVIDER_UNAVAILABLE' },
      });
    } finally {
      await app.close();
    }
  });

  it('등록과 개정에서 설명 본문의 Unicode·줄바꿈·양끝 공백을 그대로 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const { sr, query } = services(app);
      const original = '\n  첫 줄 🌱  \n둘째 줄\n';
      const created = sr.registerSr(projectCommand(), {
        key: 'EXACT-BODY', title: '본문 보존', purpose: '본문 보존', description: original, ownerId,
      });
      expect(created.kind).toBe('Committed');
      if (created.kind !== 'Committed') return;
      const srId = created.value.scope.srId;
      const firstDetail = query.getSrDetail({ actor: actor(), scope: { kind: 'sr', projectId, srId } });
      expect(firstDetail.currentDescription.description).toBe(original);

      const revised = '\n\t개정 첫 줄 한글  \n개정 둘째 줄 ✨\n';
      expect(sr.updateSrDescription(srCommand(srId, created.value.revision), {
        title: '본문 보존 개정', purpose: '본문 보존', description: revised, changeReason: '원문 확인',
      })).toMatchObject({ kind: 'Committed' });
      const secondDetail = query.getSrDetail({ actor: actor(), scope: { kind: 'sr', projectId, srId } });
      expect(secondDetail.originalDescription.description).toBe(original);
      expect(secondDetail.currentDescription.description).toBe(revised);
    } finally {
      await app.close();
    }
  });

  it('M-047 상세 조회가 실제 pending generation run을 노출합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { query } = services(app);
      const target = currentCase(app.db, 'PAY-102');
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO input_snapshots(
             project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
             contents_json,project_rules_json,captured_at
           ) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          target.projectId, target.srId, 'snapshot-pending', 'v1.0.1',
          'QUESTION_PROPOSALS', 'sha256:pending', '[]', '[]', '2026-09-09T02:00:00Z',
        );
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision
           ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          target.projectId, target.srId, 'run-pending', 'QUESTION_PROPOSALS', 'snapshot-pending',
          JSON.stringify({ providerId: 'reference', modelChoice: { kind: 'installed_default' } }),
          target.ownerId, '2026-09-09T02:00:00Z', 'pending', 1,
        );
        app.db.prepare(
          `INSERT INTO input_snapshots(
             project_id,sr_id,snapshot_id,workflow_version,task_kind,content_fingerprint,
             contents_json,project_rules_json,captured_at
           ) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          target.projectId, target.srId, 'snapshot-succeeded', 'v1.0.1',
          'QUESTION_PROPOSALS', 'sha256:succeeded', '[]', '[]', '2026-09-09T03:00:00Z',
        );
        app.db.prepare(
          `INSERT INTO generation_runs(
             project_id,sr_id,run_id,task_kind,input_snapshot_id,provider_selection_json,
             requested_by,requested_at,status,revision,result_draft_id,finished_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          target.projectId, target.srId, 'run-succeeded', 'QUESTION_PROPOSALS', 'snapshot-succeeded',
          JSON.stringify({ providerId: 'reference', modelChoice: { kind: 'explicit', modelId: 'fixture-v1' } }),
          target.ownerId, '2026-09-09T03:00:00Z', 'succeeded', 2,
          'draft-succeeded', '2026-09-09T03:01:00Z',
        );
        app.db.prepare(
          `INSERT INTO generation_drafts(
             project_id,sr_id,draft_id,schema_version,task_kind,body_json,
             basis_input_snapshot_id,basis_fingerprint,provenance_json,created_at,source_run_id
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          target.projectId, target.srId, 'draft-succeeded', 1, 'QUESTION_PROPOSALS',
          JSON.stringify({
            schemaVersion: 1,
            kind: 'question_proposals',
            proposals: [{
              temporaryId: 'q-1', text: '결제 취소 조건은?', reason: '요구사항 확인',
              suggestedAssigneeId: target.ownerId, requiredGate: 'G1', sourceRefs: [],
              candidateAnswers: ['전액 취소', '부분 취소'],
            }],
          }),
          'snapshot-succeeded', 'sha256:succeeded',
          JSON.stringify({ kind: 'provider', sourceRunId: 'run-succeeded' }),
          '2026-09-09T03:01:00Z', 'run-succeeded',
        );
      }).immediate();
      const detail = query.getSrDetail({
        actor: actor(), scope: { kind: 'sr', projectId: target.projectId, srId: target.srId },
      });
      expect(detail.generationRuns).toEqual([
        {
          scope: { kind: 'sr', projectId: target.projectId, srId: target.srId },
          runId: 'run-pending',
          taskKind: 'QUESTION_PROPOSALS',
          inputSnapshotId: 'snapshot-pending',
          revision: 1,
          requestedBy: target.ownerId,
          requestedAt: '2026-09-09T02:00:00Z',
          requestedSelection: { providerId: 'reference', modelChoice: { kind: 'installed_default' } },
          freshness: {
            kind: 'unknown', reason: '현재 생성 입력 기준을 아직 계산할 수 없습니다.',
          },
          termination: 'unobserved',
          application: { kind: 'not_applied' },
          status: 'pending',
        },
        expect.objectContaining({
          runId: 'run-succeeded',
          status: 'succeeded',
          freshness: {
            kind: 'unknown', reason: '현재 생성 입력 기준을 아직 계산할 수 없습니다.',
          },
          requestedSelection: {
            providerId: 'reference', modelChoice: { kind: 'explicit', modelId: 'fixture-v1' },
          },
          draft: expect.objectContaining({
            draftId: 'draft-succeeded',
            freshness: {
              kind: 'unknown', reason: '현재 생성 입력 기준을 아직 계산할 수 없습니다.',
            },
            provenance: { kind: 'provider', sourceRunId: 'run-succeeded' },
            application: { kind: 'not_applied' },
          }),
        }),
      ]);

      const withCurrentBasis = readGenerationRuns(app.db, target.projectId, target.srId, {
        readCurrentInputFingerprint(_db, request) {
          return request.inputSnapshotId === 'snapshot-pending'
            ? 'sha256:pending'
            : 'sha256:changed';
        },
      });
      expect(withCurrentBasis[0]).toMatchObject({ runId: 'run-pending', freshness: 'current' });
      expect(withCurrentBasis[1]).toMatchObject({
        runId: 'run-succeeded', freshness: 'stale', draft: { freshness: 'stale' },
      });
      const queryWithCurrentBasis = createWorkspaceQueryService(createPersistence(app.db), {
        currentInputFingerprints: {
          readCurrentInputFingerprint(_db, request) {
            return request.inputSnapshotId === 'snapshot-pending'
              ? 'sha256:pending'
              : 'sha256:changed';
          },
        },
      });
      expect(queryWithCurrentBasis.getSrDetail({
        actor: actor(), scope: { kind: 'sr', projectId: target.projectId, srId: target.srId },
      }).generationRuns).toMatchObject([
        { runId: 'run-pending', freshness: 'current' },
        { runId: 'run-succeeded', freshness: 'stale', draft: { freshness: 'stale' } },
      ]);
    } finally {
      await app.close();
    }
  });

  it('설명 변경은 NOTI의 현재 기준만 무효화하고 과거 인계를 보존합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { sr } = services(app);
      const srId = manifest.srIds['NOTI-028'];
      const result = sr.updateSrDescription(srCommand(srId, 3), {
        title: '알림 변경', purpose: '재검토', description: '변경 설명', changeReason: '설명 변경',
      });
      expect(result).toMatchObject({
        kind: 'Committed',
        value: {
          title: '알림 변경', progressStage: 'requirements',
          originalDescriptionRef: { version: 1 }, currentDescriptionRef: { version: 2 },
          gates: [
            { gate: 'G1', validity: 'invalid', reviewEpoch: 2 },
            { gate: 'G2', validity: 'invalid', reviewEpoch: 2 },
          ],
        },
      });
      expect(app.db.prepare('SELECT count(*) AS count FROM handoffs WHERE sr_id=?').get(srId)).toEqual({ count: 1 });
      expect(app.db.prepare('SELECT count(*) AS count FROM approvals WHERE sr_id=?').get(srId)).toEqual({ count: 2 });
    } finally {
      await app.close();
    }
  });

  it('보드 revision과 상세 본문·Mock·seed 관계를 읽기 전용으로 조립합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { query } = services(app);
      const cat = demoCase('CAT-093');
      expect(currentCase(app.db, 'CAT-093').sr.scope.srId).toBe(cat.srId);
      expect(currentReviewInput(app.db, 'CAT-093', 'G1')).toMatchObject({
        srId: cat.srId,
        reviewEpoch: 2,
        currentBundleRef: { bundleId: cat.entityIds.g1BundleId },
      });
      const before = app.db.prepare('SELECT total_changes() AS changes').get();
      const board = query.getBoard({
        actor: actor(), scope: { kind: 'project', projectId },
      }, {});
      const detail = query.getSrDetail({
        actor: actor(), scope: { kind: 'sr', projectId, srId: manifest.srIds['CAT-093'] },
      });
      expect(board).toMatchObject({
        revision: 1,
        cards: expect.arrayContaining([
          expect.objectContaining({
            sr: expect.objectContaining({ key: 'CAT-093', title: '상품 검색 필터', revision: 5 }),
          }),
        ]),
      });
      expect(detail).toMatchObject({
        originalDescription: { versionRef: { version: 1 } },
        currentDescription: { versionRef: { version: 1 } },
        mockTicket: { key: 'CAT-093', mock: true },
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
      });
      expect(app.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('상세 조회가 실제 source와 완료 구현 근거를 타입 계약대로 조립합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { query } = services(app);
      const cat = currentCase(app.db, 'CAT-093');
      app.db.transaction(() => {
        app.db.prepare(
          `INSERT INTO context_sources(
             project_id,sr_id,source_id,current_version,revision,created_by,created_at,display_name
           ) VALUES (?,?,?,1,1,?,?,?)`,
        ).run(
          cat.projectId, cat.srId, 'source-cat-contract', cat.ownerId,
          '2026-09-09T00:00:00Z', '계약 근거',
        );
        app.db.prepare(
          `INSERT INTO context_source_versions(
             project_id,sr_id,source_id,version,kind,provenance,confirmation,created_by,
             created_at,content,target_url,confirmed_by,confirmed_at,confirmation_evidence,
             previous_version,payload_json
           ) VALUES (?,?,?,1,'markdown','사용자 입력','confirmed',?,?,?,NULL,?,?,?,NULL,'{}')`,
        ).run(
          cat.projectId, cat.srId, 'source-cat-contract', cat.ownerId,
          '2026-09-09T00:00:00Z', '# 계약 근거', cat.ownerId,
          '2026-09-09T00:00:00Z', '원문을 확인했습니다.',
        );
      }).immediate();
      app.db.prepare(
        `UPDATE implementation_records
            SET status='completed',revision=2,completed_by=?,completed_at=?,
                completion_summary=?,evidence_json=?
          WHERE project_id=? AND sr_id=? AND implementation_id=?`,
      ).run(
        cat.ownerId,
        '2026-09-09T01:00:00Z',
        '외부 구현을 검증했습니다.',
        JSON.stringify([{ kind: 'verification', label: '통합 테스트', value: '통과' }]),
        cat.projectId,
        cat.srId,
        cat.entityIds.implementationId,
      );
      expect(query.getSrDetail({
        actor: actor(), scope: { kind: 'sr', projectId: cat.projectId, srId: cat.srId },
      })).toMatchObject({
        sources: [
          { sourceId: 'source-cat-contract', kind: 'markdown', confirmation: 'confirmed' },
        ],
        implementations: expect.arrayContaining([
          expect.objectContaining({
            status: 'completed',
            evidence: [{ kind: 'verification', label: '통합 테스트', value: '통과' }],
          }),
        ]),
      });
    } finally {
      await app.close();
    }
  });

  it('receipt와 activity 실패가 생성 그래프 전체를 rollback합니다', async () => {
    for (const table of ['command_receipts', 'activity_events'] as const) {
      const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
      try {
        const { sr } = services(app);
        app.db.exec(
          `CREATE TEMP TRIGGER fail_service_${table} BEFORE INSERT ON ${table}
           BEGIN SELECT RAISE(ABORT, '주입한 실패'); END`,
        );
        expect(sr.registerSr(projectCommand(), {
          key: `ROLLBACK-${table}`, title: 'rollback', purpose: 'rollback',
          description: 'rollback', ownerId,
        })).toMatchObject({ kind: 'Rejected', error: { code: 'STORE_UNAVAILABLE' } });
        for (const entity of [
          'srs', 'sr_description_versions', 'review_gate_states',
          'command_receipts', 'activity_events',
        ]) {
          expect(app.db.prepare(`SELECT count(*) AS count FROM ${entity}`).get()).toEqual({ count: 0 });
        }
      } finally {
        await app.close();
      }
    }
  });

  it('설명 변경 activity 실패가 새 설명·gate·단계를 모두 rollback합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const { sr } = services(app);
      const noti = currentCase(app.db, 'NOTI-028');
      const before = {
        sr: app.db.prepare(
          'SELECT current_description_version,progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?',
        ).get(noti.projectId, noti.srId),
        gates: app.db.prepare(
          'SELECT gate,review_epoch,validity FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
        ).all(noti.projectId, noti.srId),
      };
      app.db.exec(
        `CREATE TEMP TRIGGER fail_description_activity BEFORE INSERT ON activity_events
         BEGIN SELECT RAISE(ABORT, '주입한 설명 활동 실패'); END`,
      );
      expect(sr.updateSrDescription(srCommand(noti.srId, noti.sr.revision), {
        title: '실패', purpose: '실패', description: '실패', changeReason: '실패 주입',
      })).toMatchObject({ kind: 'Rejected', error: { code: 'STORE_UNAVAILABLE' } });
      expect(app.db.prepare(
        'SELECT current_description_version,progress_stage,revision FROM srs WHERE project_id=? AND sr_id=?',
      ).get(noti.projectId, noti.srId)).toEqual(before.sr);
      expect(app.db.prepare(
        'SELECT gate,review_epoch,validity FROM review_gate_states WHERE project_id=? AND sr_id=? ORDER BY gate',
      ).all(noti.projectId, noti.srId)).toEqual(before.gates);
      expect(app.db.prepare(
        'SELECT count(*) AS count FROM sr_description_versions WHERE project_id=? AND sr_id=?',
      ).get(noti.projectId, noti.srId)).toEqual({ count: 1 });
    } finally {
      await app.close();
    }
  });
});
