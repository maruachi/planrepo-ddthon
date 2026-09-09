import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import { assessGate, type GateAssessmentInput } from '@/src/domain/gate-assessment';
import { createTestApp } from '@/tests/helpers/test-app';

const projectId = manifest.projectId;
const ownerId = manifest.personaIds['P-01'];

describe('게이트 사용자 문구', () => {
  it('M045는 내부 condition ID와 epoch 표현 없이 사용자가 할 일을 안내합니다', async () => {
    const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
    try {
      const board = await app.invoke('M-045', { actorId: ownerId, projectId }, {});
      expect(board.ok).toBe(true);
      if (!board.ok) return;
      const blockers = board.value.cards.flatMap((card) => card.blockers);
      expect(blockers.length).toBeGreaterThan(0);
      expect(blockers.join('\n')).not.toMatch(/GP-\d+|epoch|reviewEpoch/u);
      expect(blockers).toContain('검토 기준이 바뀌었습니다. 최신 내용으로 검토를 다시 요청해 주세요.');
    } finally {
      await app.close();
    }
  });

  it('M027은 condition ID와 판정을 유지하고 G2의 실제 누락 문서를 구분합니다', async () => {
    const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
    try {
      const registered = await app.invoke('M-003', {
        actorId: ownerId, projectId, requestId: 'copy-register', idempotencyKey: 'copy-register',
      }, {
        key: 'COPY-001', title: '게이트 문구 검증', purpose: '누락 자료 안내를 검증합니다.',
        description: '아직 문서를 작성하지 않았습니다.', ownerId,
      });
      expect(registered.ok).toBe(true);
      if (!registered.ok) return;
      const srId = registered.value.scope.srId;
      const assessment = await app.invoke('M-027', { actorId: ownerId, projectId, srId }, 'G2');
      expect(assessment.ok).toBe(true);
      if (!assessment.ok) return;
      expect(assessment.value.conditions.map(({ conditionId, passed }) => [conditionId, passed])).toEqual([
        ['GP-01', false], ['GP-02', false], ['GP-03', true],
        ['GP-04', true], ['GP-05', true], ['GP-06', false],
        ['GP-07', false], ['GP-08', false], ['GP-09', false],
      ]);
      expect(assessment.value.canTransition).toBe(false);
      const reasons = Object.fromEntries(assessment.value.conditions.map((item) => [item.conditionId, item.reason]));
      expect(reasons['GP-01']).toBe('검토할 자료를 준비한 뒤 검토를 요청해 주세요.');
      expect(reasons['GP-02']).toContain('요구사항, 진행 계획, 설계, 구현 계획');
      expect(reasons['GP-07']).toBe('검토자를 먼저 배정해 주세요.');
      expect(reasons['GP-09']).toBe('요구사항 검토를 먼저 완료해 주세요.');
    } finally {
      await app.close();
    }
  });

  it('GP08은 검토자 역할 부족과 체크리스트 미확인을 구분합니다', () => {
    const srId = 'sr-copy';
    const bundleRef = { projectId, srId, gate: 'G1' as const, bundleId: 'bundle-copy', version: 1 };
    const assignmentRef = { kind: 'review_assignment' as const, projectId, srId, entityId: 'assignment-copy', version: 1 };
    const policyRef = { kind: 'review_policy' as const, projectId, entityId: 'policy-copy', version: 1 };
    const base = {
      projectId, srId, ownerId, assessedRevision: 1, gate: 'G1', reviewEpoch: 1,
      needsNewBundle: false, currentBundleRef: bundleRef,
      bundle: { ref: bundleRef, reviewEpoch: 1, assignmentRef, policyRef,
        artifactKinds: ['requirements'], requirementsStructured: true, basisCurrent: true },
      assignment: { ref: assignmentRef, reviewerIds: ['reviewer-copy'] },
      policy: { ref: policyRef, requiredRoles: ['reviewer'], checklistItemIds: ['check-copy'] },
      reviewerRoles: { 'reviewer-copy': [] },
      approvals: [{ approvalId: 'approval-copy', approverId: 'reviewer-copy', checklistItemIds: ['check-copy'] }],
      questions: [], decisions: [], blockingChanges: [],
    } satisfies GateAssessmentInput;
    const roleReason = assessGate(base).conditions.find(({ conditionId }) => conditionId === 'GP-08')?.reason;
    const checklistReason = assessGate({
      ...base,
      reviewerRoles: { 'reviewer-copy': ['reviewer'] },
      approvals: [],
    }).conditions.find(({ conditionId }) => conditionId === 'GP-08')?.reason;
    expect(roleReason).toBe('정책에 필요한 역할을 가진 검토자를 배정해 주세요.');
    expect(checklistReason).toBe('아직 체크리스트 확인이 끝나지 않았습니다.');
  });
});
