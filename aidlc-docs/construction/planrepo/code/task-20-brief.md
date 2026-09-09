# CG-20 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-20 진행 계획·설계·구현 계획과 정확한 G1을 고정하는 G2

**구현 묶음**: B-04입니다. **선행**: CG-09, CG-17, CG-18, CG-19입니다.

**연결 기준**: M-015, M-016, M-017, M-020, M-021, M-027, M-028, M-047, US-020, US-021, US-022, US-023, US-025, ENT-03, ENT-07, ENT-08, ENT-09, ENT-12, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-24, ENT-34, ENT-35, SCN-05, SCN-09, SCN-10, SCN-12, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-17, ND-01, ND-02, ND-03, ND-05, INF-02, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/application/artifact-service.ts` | 갱신합니다. | M-017의 WorkflowPlanVersion을 ArtifactVersion과 같은 버전으로 저장합니다. |
| `src/domain/workflow-plan-policy.ts` | 생성합니다. | 필수 단계/문서와 요구사항·작업·검증·회귀·순서 연결을 검사합니다. |
| `src/application/review-workflow-service.ts` | 갱신합니다. | M-020/M-021/M-027/M-028에 G2와 현재 유효 G1 고정을 적용합니다. |
| `src/domain/gate-assessment.ts` | 갱신합니다. | G2 GP-01~09와 정확한 상위 G1 참조를 판정합니다. |
| `src/persistence/artifact-repository.ts` | 갱신합니다. | 진행 계획의 1:1 구조와 불변 문서 버전·참조를 저장합니다. |
| `tests/integration/g2-workflow.test.ts` | 생성합니다. | G2 전용 변경·G1 고정·필수 자료 누락·ready 전환 경쟁을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | M-017과 G2 검토/통과의 조건·오류·참조를 추가합니다. |
| `src/web/components/WorkflowPlanEditor.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/g2.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. helper는 fixture의 제한된 ID·검증된 문서 입력과 현재 저장 상태를 읽기만 합니다. 모든 실제 변경·승인·전환은 아래 M 메서드로 호출하며 helper가 성공 상태를 DB에 주입하지 않습니다. DTO 필드 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED는 구현 시 실행할 코드이며 현재 실행 결과가 아닙니다. NOTI-028은 승인 DEMO-4의 ready·유효 G1/G2 상태를 사용합니다. implementationPlanEdit는 같은 논리 문서의 유효한 후속 버전 입력으로 requirement/task/section ID를 보존합니다. WorkflowPlanVersion은 workflow_plan ArtifactVersion과 1:1이며 별도 current 포인터를 만들지 않습니다. 별도 테스트 전략 문서를 항상 요구하지 않습니다. US-025 전체 통합은 B-06에 남깁니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [ ] **Step 115: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('G2 전용 구현 계획 변경은 G1을 보존하고 옛 G2 승인을 거절합니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('NOTI-028');
    const before = await currentCase(app.db, c.key);
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    const oldG1 = before.gates.G1.currentBundle.ref;
    const oldG2 = before.gates.G2.currentBundle.ref;
    const saved = await app.invoke('M-015', { ...scope, requestId: 'g2-plan-edit',
      idempotencyKey: 'g2-plan-edit', guard: { resource: { target: { kind: 'artifact', projectId: c.projectId, srId: c.srId, entityId: before.implementationPlan.versionRef.entityId }, expectedRevision: before.implementationPlan.revision } } }, currentArtifactEdit(app.db, c, 'implementation_plan'));
    expect(saved.ok).toBe(true);
    const after = await currentCase(app.db, c.key);
    expect(after.gates.G1.validity).toBe('valid');
    expect(after.gates.G1.currentBundle.ref).toEqual(oldG1);
    expect(after.gates.G2.validity).toBe('invalid');
    expect(after.gates.G2.needsNewBundle).toBe(true);
    expect(after.sr.progressStage).toBe('planning');
    const oldApproval = await app.invoke('M-021', { ...scope,
      actorId: before.gates.G2.reviewerIds[0], requestId: 'old-g2-approval',
      idempotencyKey: 'old-g2-approval', guard: { expectedBundleRef: oldG2, expectedReviewEpoch: before.gates.G2.currentBundle.reviewEpoch } }, {
      bundleRef: oldG2, reviewEpoch: before.gates.G2.currentBundle.reviewEpoch,
      approvalScope: 'G2', checklistResults: before.gates.G2.currentBundle.checklist.map(item =>
        ({ itemId: item.itemId, checked: true }))
    });
    expect(oldApproval).toMatchObject({ ok: false, error: { code: 'STALE_BUNDLE' } });
    const request = await app.invoke('M-020', { ...scope,
      requestId: 'new-g2', idempotencyKey: 'new-g2', guard: currentGateGuard(app.db, c, 'G2') },
      await currentReviewInput(app.db, c.key, 'G2'));
    expect(request.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).gates.G2.currentBundle.g1BundleRef).toEqual(oldG1);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 116: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/g2-workflow.test.ts
```

예상 결과는 다음과 같습니다. G2 편집이 G1까지 불필요하게 무효화하거나 과거 G2 bundle/승인을 현재로 받아들이는 구현에서 validity·STALE_BUNDLE 단언이 실패합니다.

- [ ] **Step 117: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-017은 workflowVersion v1.0.1, implementationUnitCount=1, 실행/생략 이유, 선택 설계 refs와 요구사항/작업/검증/회귀 연결을 검증해 ArtifactVersion과 WorkflowPlanVersion을 같은 tx에 추가합니다. G2 bundle 생성 시 현재 G1.valid 및 정확한 lastPass/bundle ref를 고정합니다. G2 전환은 현재 G1·G2 필수 질문/결정·차단 요청·필수 문서·배정 전원과 체크리스트를 tx 안에서 다시 검사합니다. G2 전용 변경은 G1을 유지하며 이미 requirements로 돌아간 SR을 planning으로 밀어내지 않습니다. 새 G1을 통과해도 이전 G2 pass를 valid로 복원하지 않습니다.

- [ ] **Step 118: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/g2-workflow.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/g2.spec.ts
```

통과 조건은 다음과 같습니다. 선택 설계 누락, 필수 단계/문서 생략, 구현 단위 수 위반, 작업/요구사항/검증 연결 누락, 무효 G1, 확인 대기 차단, stale bundle, 반복 G2 통과와 입력 변경 경쟁이 모두 통과합니다.

- [ ] **Step 119: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 120: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-020~023의 서비스 기준을 검증하고 승인된 plan/design/implementation_plan을 같은 G2 기준으로 연결합니다. 실제 전환·활동·receipt의 원자성, G1 변경 뒤 새 G2 재검토, G2 전용 변경의 범위를 확인합니다.

이 묶음의 화면과 tests/e2e/bundles/g2.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
