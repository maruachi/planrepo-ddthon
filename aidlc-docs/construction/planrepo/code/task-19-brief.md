# CG-19 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-19 댓글·수정 반영·현재 버전 확인과 모든 미해결 요청 승계

**구현 묶음**: B-03입니다. **선행**: CG-09, CG-17, CG-18입니다.

**연결 기준**: M-022, M-023, M-024, M-025, M-026, M-015, M-030, M-027, M-047, US-016, US-017, US-018, US-026, ENT-08, ENT-17, ENT-18, ENT-19, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-34, ENT-35, SCN-07, SCN-08, SCN-11, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, ND-01, ND-02, ND-03, ND-05, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/review-workflow-service.ts` | 갱신합니다. | M-022~026의 댓글·요청·반영·해결 확인·추가 수정을 구현합니다. |
| `src/persistence/change-request-repository.ts` | 생성합니다. | 원 요청·현재 대상·불변 처리 이벤트와 삭제 섹션 승계를 저장합니다. |
| `src/domain/change-resolution.ts` | 생성합니다. | 원 요청자 OR 현재 검토자와 현재 반영 버전 일치를 판정합니다. |
| `src/domain/review-impact.ts` | 갱신합니다. | 차단 요청과 일반 댓글/비차단 요청의 영향을 구분합니다. |
| `tests/integration/change-request.test.ts` | 생성합니다. | 배정에서 빠진 원 요청자·오래된 반영·차단/비차단 승계를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 수정 요청 상태·확인 권한·현재 반영 refs를 정리합니다. |
| `src/web/components/SectionDiscussion.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/change.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. AUTH-331 fixture의 현재 반영 확인 대기 요청은 실제 최신 ArtifactVersion과 currentApplicationEventRef를 가리키도록 검증합니다. 이 시작 상태는 M-025의 RED를 독립 실행하기 위한 자료이며 M-023/M-024 자체의 통과 증거가 아닙니다. 이 task에서 두 메서드의 실제 작성 흐름도 별도 검사합니다. US-026 통합 완료는 B-06입니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 109: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('검토자에서 제외된 원 요청자도 현재 반영 결과를 확인할 수 있습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('AUTH-331');
    let now = await currentCase(app.db, c.key);
    const change = now.awaitingChange;
    expect(change.status).toBe('awaiting_confirmation');
    const scope = { actorId: c.personaIds['P-05'], projectId: c.projectId, srId: c.srId };
    const reviewers = now.gates.G2.reviewerIds.filter(id => id !== change.requesterId);
    expect((await app.invoke('M-030', { ...scope, requestId: 'remove-requester',
      idempotencyKey: 'remove-requester', guard: currentGateGuard(app.db, c, 'G2') }, {
      gate: 'G2', reviewerIds: reviewers,
      previousAssignmentRef: now.gates.G2.assignmentRef, changeReason: '검토 배정을 변경합니다.'
    })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect(now.gates.G2.reviewerIds).not.toContain(change.requesterId);
    const currentChange = now.changes.find(item => item.changeRequestId === change.changeRequestId);
    if (!currentChange) throw new Error('현재 수정 요청이 없습니다.');
    const confirmed = await app.invoke('M-025', { ...scope, actorId: change.requesterId,
      requestId: 'confirm-current', idempotencyKey: 'confirm-current',
      guard: { resource: { target: { kind: 'change_request', projectId: c.projectId, srId: c.srId, entityId: currentChange.changeRequestId }, expectedRevision: currentChange.revision } } }, {
      changeRequestId: change.changeRequestId,
      applicationEventRef: currentChange.currentApplicationEventRef,
      appliedArtifactVersionRef: currentChange.appliedArtifactVersionRef,
      result: { kind: 'resolved', verification: '현재 반영 버전에서 요청한 수정을 확인했습니다.' }
    });
    expect(confirmed.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).changes.find(item =>
      item.changeRequestId === change.changeRequestId)?.status).toBe('resolved');
  } finally {
    await app.close();
  }
});
```

- [x] **Step 110: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/change-request.test.ts
```

예상 결과는 다음과 같습니다. 현재 검토자 여부만 확인하여 원 요청자의 M-025를 거절하는 구현에서 confirmed.ok가 실패합니다.

- [x] **Step 111: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-022 일반 댓글은 원 버전/섹션에 추가하고 gate epoch를 유지합니다. M-023은 blocking/affectedGate/원 요청자/담당자를 고정하고 영향받는 기준만 무효화합니다. M-024는 정확한 현재 반영 ArtifactVersion과 이벤트를 저장해 awaiting_confirmation으로 두며 blocking을 해제하지 않습니다. M-025는 requesterId==actorId OR currentReviewerIds.has(actorId), currentApplicationEventRef 일치, 현재 반영 VersionRef 일치를 모두 검증합니다. 반영자 겸임은 별도 거절 사유가 아닙니다. M-026은 피드백과 open 전이를 기록합니다. 문서/묶음 교체 때 모든 unresolved 요청의 ID/requester/blocking을 보존하고 삭제 섹션은 missing_section으로 승계합니다.

- [ ] **Step 112: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/change-request.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/change.spec.ts
```

통과 조건은 다음과 같습니다. 직접 작성·반영·확인·추가 수정, 원 요청자 자격, 현재 reviewer 자격, 무자격 반영자 거절, 오래된 application/문서 확인 거절, 차단/비차단 요청의 섹션 삭제 승계, 일반 댓글의 승인 보존이 통과합니다.

CG-17에서 검토자 배정이 제거된 원 요청자가 M-025로 자기 수정 요청의 현재 반영본을 확인할 수 있는 실제 HTTP 경로를 검증합니다.

- [x] **Step 113: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 114: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-016~018의 실제 서비스 경로와 미해결 요청 보존을 검증합니다. G1/G2 상태·요청 승계·반영 이벤트·활동·receipt 실패 주입과 중복 재생도 통과시킵니다.

이 묶음의 화면과 tests/e2e/bundles/change.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

## 독립 검토 fix round 1

- [x] 해결된 요청의 역사 artifact target은 이후 문서 version이 바뀌어도 실재하는 당시 ref로 조회합니다. 현재 artifact 강제는 `open`·`awaiting_confirmation` 요청에만 적용합니다.
- [x] M-023은 과거 artifact version·section을 원 대상으로 허용하고 같은 논리 문서의 현재 section 또는 `missing_section`을 현재 대상으로 저장합니다.
- [x] M-015·M-017·M-018의 문서 version 생성은 미해결 요청을 같은 transaction에서 승계합니다. 동일 명령 재생은 carry event를 중복하지 않고 늦은 activity 실패는 문서·승계·receipt를 함께 되돌립니다.
