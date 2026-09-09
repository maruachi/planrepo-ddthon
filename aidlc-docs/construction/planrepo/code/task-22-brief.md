# CG-22 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-22 Handoff별 수동 외부 시작·완료와 과거 활동 조회

**구현 묶음**: B-05입니다. **선행**: CG-19, CG-20, CG-21입니다.

**연결 기준**: M-043, M-044, M-048, M-040, M-041, M-015, M-020, M-021, M-028, M-047, US-032, US-033, US-034, ENT-03, ENT-18, ENT-20, ENT-21, ENT-22, ENT-32, ENT-33, ENT-34, ENT-35, SCN-09, SCN-10, SCN-14, SCN-21, SCN-22, SCN-23, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-22, ND-01, ND-02, ND-03, ND-05, ND-14, INF-02, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/handoff-implementation-service.ts` | 갱신합니다. | M-043/M-044의 선택한 인계별 수동 사실과 현재 SR 단계를 조정합니다. |
| `src/persistence/implementation-repository.ts` | 생성합니다. | Handoff별 0..1 ImplementationRecord와 불변 활동 참조를 보존합니다. |
| `src/application/workspace-query-service.ts` | 갱신합니다. | M-048의 범위·버전·행위자·시각과 과거 기준을 일관되게 조회합니다. |
| `src/persistence/activity-repository.ts` | 생성합니다. | 추가 전용 활동과 안정된 페이지 정렬을 제공합니다. |
| `tests/integration/implementation-handoff-history.test.ts` | 생성합니다. | H1/H2 분리·재검토 중 사실 보존·수동 근거·조회 무쓰기 검증입니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 외부 사실의 수동 표시·현재 기준·과거 조회·중복 계약을 정리합니다. |
| `src/web/components/ExternalImplementationPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/ActivityHistory.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/external.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. helper는 fixture의 제한된 ID·검증된 문서 입력과 현재 저장 상태를 읽기만 합니다. 모든 실제 변경·승인·전환은 아래 M 메서드로 호출하며 helper가 성공 상태를 DB에 주입하지 않습니다. DTO 필드 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED는 구현 시 실행할 코드이며 현재 실행 결과가 아닙니다. Handoff당 ImplementationRecord는 최대 하나이며 started/completed를 사용합니다. M-043은 ready 및 현재 유효 Handoff에서만 현재 구현 시작을 선택합니다. M-044는 이미 시작한 그 ImplementationRecord의 summary/evidence를 요구합니다. 오래된 H1 사실 기록은 허용하지만 다른 활성 H2나 현재 SR을 완료하지 않습니다. 아래 준비 과정은 모두 공개 메서드를 사용합니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [ ] **Step 127: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('새 H2가 실행 중이면 옛 H1 완료는 H2와 현재 SR을 완료시키지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('NOTI-028');
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    let now = await currentCase(app.db, c.key);
    expect((await app.invoke('M-040', { ...scope, requestId: 'h1', idempotencyKey: 'h1',
      guard: { expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { g2BundleRef: now.gates.G2.currentBundle.ref })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const h1 = now.latestHandoff;
    expect((await app.invoke('M-043', { ...scope, requestId: 'start-h1', idempotencyKey: 'start-h1',
      guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: now.sr.revision }, expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { handoffId: h1.handoffRef.entityId })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect((await app.invoke('M-015', { ...scope, requestId: 'revise-plan',
      idempotencyKey: 'revise-plan', guard: { resource: { target: { kind: 'artifact', projectId: c.projectId, srId: c.srId, entityId: now.implementationPlan.versionRef.entityId }, expectedRevision: now.implementationPlan.revision } } },
      currentArtifactEdit(app.db, c, 'implementation_plan'))).ok).toBe(true);
    expect((await app.invoke('M-020', { ...scope, requestId: 'review-h2',
      idempotencyKey: 'review-h2', guard: currentGateGuard(app.db, c, 'G2') }, await currentReviewInput(app.db, c.key, 'G2'))).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const bundle = now.gates.G2.currentBundle;
    for (const actorId of bundle.reviewerIds) {
      expect((await app.invoke('M-021', { ...scope, actorId, requestId: 'approve-h2-' + actorId,
        idempotencyKey: 'approve-h2-' + actorId, guard: { expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, {
        bundleRef: bundle.ref, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G2', checklistResults: bundle.checklist.map(item => ({ itemId: item.itemId, checked: true }))
      })).ok).toBe(true);
    }
    now = await currentCase(app.db, c.key);
    expect((await app.invoke('M-028', { ...scope, requestId: 'ready-h2', idempotencyKey: 'ready-h2',
      guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: now.sr.revision }, expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } },
      { toStage: 'ready', reason: 'G2 검토 조건을 확인했습니다.', gate: 'G2', bundleRef: bundle.ref })).ok).toBe(true);
    expect((await app.invoke('M-040', { ...scope, requestId: 'h2', idempotencyKey: 'h2',
      guard: { expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, { g2BundleRef: bundle.ref })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const h2 = now.latestHandoff;
    expect(h2.handoffRef.entityId).not.toBe(h1.handoffRef.entityId);
    expect((await app.invoke('M-043', { ...scope, requestId: 'start-h2', idempotencyKey: 'start-h2',
      guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: now.sr.revision }, expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { handoffId: h2.handoffRef.entityId })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const oldImplementation = now.implementations.find(item => item.handoffRef.entityId === h1.handoffRef.entityId);
    if (!oldImplementation) throw new Error('H1 시작 기록이 없습니다.');
    expect((await app.invoke('M-044', { ...scope, requestId: 'complete-h1', idempotencyKey: 'complete-h1',
      guard: { resource: { target: { kind: 'implementation', projectId: c.projectId, srId: c.srId, entityId: oldImplementation.implementationId }, expectedRevision: oldImplementation.revision } } }, {
      implementationId: oldImplementation.implementationId,
      completionSummary: '옛 인계의 구현을 마쳤습니다.', evidence: [{ kind: 'verification', label: '가상 검증', value: '테스트에서 가상 구현 완료를 확인했습니다.' }]
    })).ok).toBe(true);
    const after = await currentCase(app.db, c.key);
    expect(after.sr.progressStage).toBe('implementing');
    expect(after.implementations.find(item => item.handoffRef.entityId === h2.handoffRef.entityId)?.status).toBe('started');
    expect(after.implementations.find(item => item.handoffRef.entityId === h1.handoffRef.entityId)?.status).toBe('completed');
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 128: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/implementation-handoff-history.test.ts
```

예상 결과는 다음과 같습니다. SR에 외부 완료 상태 하나만 저장하거나 H1 완료를 활성 H2에 복사하는 구현에서 H2.started 또는 현재 SR.implementing 단언이 실패합니다.

- [ ] **Step 129: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

UNIQUE(SrScope,handoffRef)로 시작 기록을 한 번만 만들고 현재 SR activeImplementationRef는 명시 M-043에서 선택합니다. 완료는 전달된 implementationId와 같은 handoffRef·현재 owner·기대 revision·요약·근거를 확인합니다. 선택한 기록만 completed로 갱신한 뒤 그 인계가 현재 활성 기준이며 G1/G2와 정확히 일치할 때만 SR.completed로 전환합니다. 재검토 중이거나 H2가 활성 기준이면 SR 단계·gate 유효성을 그대로 둡니다. M-048은 같은 read snapshot의 과거 refs·수동 사실·시각을 페이지로 반환하며 일반 조회로 새 활동을 쓰지 않습니다.

- [ ] **Step 130: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/implementation-handoff-history.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/external.spec.ts
```

통과 조건은 다음과 같습니다. H1 재검토 중 완료, H2 시작 뒤 H1 완료, 중복 시작/완료 receipt, 완료 요약/근거 누락, 무효 과거 인계의 신규 시작 거절, 과거 미리보기/활동 보존과 조회 전후 write count 불변이 통과합니다.

- [ ] **Step 131: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 132: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-032~034의 실제 시작·완료·과거 조회를 검증합니다. GitHub Mock/링크를 자동 동기화·외부 테스트/배포 검증으로 표현하지 않습니다. 모든 완료와 활동·receipt는 원자적으로 저장하며 과거 사실을 현재 승인으로 복원하지 않습니다.

이 묶음의 화면과 tests/e2e/bundles/external.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
