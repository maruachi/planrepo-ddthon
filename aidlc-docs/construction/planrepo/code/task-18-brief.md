# CG-18 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-18 G1 불변 묶음·개별 승인·현재 조건 재검사와 단계 전환

**구현 묶음**: B-03입니다. **선행**: CG-09, CG-16, CG-17입니다.

**연결 기준**: M-020, M-021, M-027, M-028, M-047, US-014, US-015, US-019, ENT-03, ENT-04, ENT-06, ENT-08, ENT-12, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-24, ENT-34, ENT-35, SCN-05, SCN-06, SCN-09, SCN-12, SCN-14, SCN-23, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, ND-01, ND-02, ND-03, ND-05, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/review-workflow-service.ts` | 생성합니다. | M-020/M-021/M-027/M-028의 G1 요청·개별 승인·평가·전환을 연결합니다. |
| `src/domain/gate-assessment.ts` | 생성합니다. | GP-01~09의 G1 조건과 사유·담당자·대상을 순수 계산합니다. |
| `src/domain/review-state.ts` | 생성합니다. | 조회로 쓰지 않는 검토 상태와 validity/needsNewBundle을 구분합니다. |
| `src/application/review-bundle-snapshot.ts` | 갱신합니다. | DPOLICY에서 준비한 공통 캡처를 재사용해 공식 검토 요청을 고정합니다. |
| `src/persistence/review-repository.ts` | 생성합니다. | 묶음·요청·승인·현재 게이트·통과 이력·receipt를 원자적으로 저장합니다. |
| `tests/integration/g1-review.test.ts` | 생성합니다. | 지정 전원 승인·미해결 질문·오래된 묶음·중복 전환을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | G1의 개별 승인과 게이트 전환·현재 receipt 재검사 계약을 정리합니다. |
| `src/web/components/ReviewSummary.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/ReviewRequestForm.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/BundleReviewForm.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/GateConditionPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/g1.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. PAY-102의 대표 시작 fixture는 검토 가능한 요구사항·정책·검토자(담당자와 다른 동료 포함)가 있고 G1 필수 질문이 남아 있도록 manifest에 고정합니다. 미확정 결정은 unconfirmedDecisionSnapshots에 고정하고 개별 승인에 GP 전체를 적용하지 않습니다. approval guard는 현재 BundleRef/epoch이며 무관한 SR revision 증가로 다른 검토자의 승인을 거절하지 않습니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 103: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('지정 전원 개별 승인은 남지만 미해결 G1 질문이 전환을 막습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const requestInput = await currentReviewInput(app.db, c.key, 'G1');
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    expect((await app.invoke('M-020', { ...scope, requestId: 'g1-request',
      idempotencyKey: 'g1-request', guard: currentGateGuard(app.db, c, 'G1') }, requestInput)).ok).toBe(true);
    const now = await currentCase(app.db, c.key);
    const bundle = now.gates.G1.currentBundle;
    const approvals = await Promise.all(bundle.reviewerIds.map((actorId: string, index: number) =>
      app.invoke('M-021', { ...scope, actorId, requestId: 'g1-approve-' + index,
        idempotencyKey: 'g1-approve-' + index, guard: { expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, {
        bundleRef: bundle.ref, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1', checklistResults: bundle.checklist.map(item => ({
          itemId: item.itemId, checked: true
        }))
      })));
    expect(approvals.every(result => result.ok)).toBe(true);
    const fresh = await currentCase(app.db, c.key);
    expect(fresh.sr.progressStage).toBe('requirements');
    const transition = await app.invoke('M-028', { ...scope, requestId: 'g1-pass',
      idempotencyKey: 'g1-pass', guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: fresh.sr.revision }, expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, {
      toStage: 'planning', reason: 'G1 검토 조건을 확인했습니다.', gate: 'G1', bundleRef: bundle.ref
    });
    expect(transition).toMatchObject({ ok: false, error: { code: 'GATE_BLOCKED' } });
    expect((await currentCase(app.db, c.key)).sr.progressStage).toBe('requirements');
  } finally {
    await app.close();
  }
});
```

- [x] **Step 104: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/g1-review.test.ts
```

예상 결과는 다음과 같습니다. 필수 질문 때문에 개별 승인 자체를 거절하거나 전원 승인만으로 planning으로 전환하는 구현에서 단언이 실패합니다. 실제 지정된 모든 검토자의 승인을 사용합니다.

- [x] **Step 105: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-020은 고정 가능한 현재 refs·정책·배정·reviewEpoch를 검증해 불변 bundle과 reviewer별 요청을 만들며 동일 기준 재요청은 같은 현재 기준을 재사용합니다. M-021은 현재 지정·체크리스트·BundleRef/epoch만 검증해 UNIQUE(SrScope,gate,bundle,version,approver)를 저장합니다. M-027은 읽기 snapshot에서 GP를 계산할 뿐 활동·검토 시작을 쓰지 않습니다. M-028은 tx 안에서 현재 owner/guard/bundle/GP를 다시 계산한 뒤 ReviewGateState.valid와 GateTransitionRecord·progressStage·활동·receipt를 함께 확정합니다. G1 변경은 종속 G2를 invalid/not_passed로 만들며 옛 G2 pass를 자동 복원하지 않습니다.

- [ ] **Step 106: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/g1-review.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/g1.spec.ts
```

통과 조건은 다음과 같습니다. 미해결 질문 속 개별 승인, 빈 전원 승인 방지, G2 필수 문제만 남은 G1 통과, stale bundle/제거된 reviewer 거절, 전환 경쟁·재생·쓰기 장애와 순수 조회가 통과합니다.

CG-17에서 배정을 제거한 검토자의 옛 M-021 승인 명령이 현재 자격 검사로 거절되는 실제 HTTP 통합 검증도 포함합니다.

- [ ] **Step 107: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 108: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-014/015/019의 모든 서비스 조건을 검증합니다. UI 원문 비교·체크리스트 표시와 전체 공통 기준은 담당 UI task와 함께 완료하며 서비스 테스트만으로 화면 기준을 완료 처리하지 않습니다.

이 묶음의 화면과 tests/e2e/bundles/g1.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
