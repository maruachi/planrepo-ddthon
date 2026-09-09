# CG-17 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-17 팀 정책 버전과 문서 없는 최초 검토자 배정

**구현 묶음**: B-03입니다. **선행**: CG-06, CG-09입니다.

**연결 기준**: M-029, M-030, M-031, M-003, M-027, M-047, US-029, US-030, ENT-01, ENT-02, ENT-03, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-34, ENT-35, SCN-06, SCN-12, SCN-13, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, ND-01, ND-02, ND-03, ND-04, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/review-policy-service.ts` | 생성합니다. | M-029/M-030/M-031의 정책 생성·최초/변경 배정·명시 적용을 처리합니다. |
| `src/domain/review-policy.ts` | 생성합니다. | 지정 전원·담당자 외 동료·필수 역할/체크리스트를 유지합니다. |
| `src/persistence/review-policy-repository.ts` | 생성합니다. | 정책·배정 불변 버전과 SR 게이트 현재 참조를 저장합니다. |
| `src/application/review-bundle-snapshot.ts` | 생성합니다. | M-030/M-031과 뒤 DG1의 M-020이 공유할 현재 자료의 불변 묶음 캡처를 준비합니다. 별도 공개 메서드를 만들지 않습니다. |
| `tests/integration/review-policy.test.ts` | 생성합니다. | 최초 배정·정책 비소급·특정 SR 명시 적용·옛 요청 교체를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | S-06의 ProjectScope/SrScope와 준비 결과를 정리합니다. |
| `src/web/components/TeamPolicyEditor.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/SRReviewAssignment.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/policy.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

M031의 복수 gate 입력은 구현 결정33을 따릅니다. 각 선택 gate의 기대 revision을 명시적으로 검사하고 gate별 준비 결과를 하나의 원자적 PolicyApplicationResult로 반환합니다. 단일 gate 예제만으로 G1/G2 동시 적용의 현재성 검증을 대체하지 않습니다.

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. M-029는 관리자 ProjectScope이고 새 기본 정책이 기존 SR의 policyRef를 바꾸지 않습니다. M-030은 최초 배정 시 문서/BundleRef를 요구하지 않습니다. M-031의 gate별 ReviewBundleView는 준비에 따라 BundleAvailable/NeedsInputs를 구분하며 전체 결과는 PolicyApplicationResult로 모읍니다. requireAllAssigned/requireDistinctPeer 완화는 거절합니다. US-030 전체 완료는 B-06입니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 097: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('문서 없는 SR에 최초 검토자를 배정해도 가짜 묶음을 만들지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const project = { actorId: c.ownerId, projectId: c.projectId,
      requestId: 'new-unprepared', idempotencyKey: 'new-unprepared' };
    const registered = await app.invoke('M-003', project, { key: 'TEST-ASSIGN-1', title: '최초 배정',
      purpose: '문서 전 배정을 검사합니다.', description: '아직 문서가 없습니다.', ownerId: c.ownerId });
    if (!registered.ok) throw new Error('테스트 SR을 등록하지 못했습니다.');
    const sr = registered.value;
    const unprepared = { projectId: c.projectId, srId: sr.scope.srId };
    const result = await app.invoke('M-030', { actorId: c.personaIds['P-05'], projectId: c.projectId,
      srId: sr.scope.srId, requestId: 'assign-first', idempotencyKey: 'assign-first',
      guard: currentGateGuard(app.db, unprepared, 'G1') }, {
      gate: 'G1', reviewerIds: [c.ownerId, c.personaIds['P-03']]
    });
    expect(result.ok).toBe(true);
    expect(app.db.prepare('SELECT count(*) AS n FROM review_assignment_versions WHERE project_id = ? AND sr_id = ? AND gate = ?')
      .get(c.projectId, sr.scope.srId, 'G1')).toEqual({ n: 1 });
    expect(app.db.prepare('SELECT count(*) AS n FROM review_bundles WHERE project_id = ? AND sr_id = ?')
      .get(c.projectId, sr.scope.srId)).toEqual({ n: 0 });
  } finally {
    await app.close();
  }
});
```

- [x] **Step 098: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/review-policy.test.ts
```

예상 결과는 다음과 같습니다. 최초 배정에 문서/묶음을 강제해 result.ok가 false이거나 실제 문서 없는 ReviewBundle을 생성해 count=0이 실패합니다.

- [x] **Step 099: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

policy/assignment 버전과 게이트의 현재 참조를 분리합니다. 새 정책 생성은 프로젝트 기본 참조만 갱신하고 SR policyRef는 M-031에서만 바꿉니다. 배정/명시 정책 적용은 해당 gate epoch를 새로 만들고 과거 Approval을 새 epoch로 복사하지 않습니다. 현재 자료가 충분하면 새 묶음·요청을 만들고 부족하면 배정·미준비 사유만 저장합니다. 현재 ReviewRequest만 교체하되 과거 이력과 모든 미해결 ChangeRequest·원 요청자를 보존합니다. 역할 겸임을 금지하지 않으며 전환 시 담당자 외 동료 조건을 별도로 계산합니다. 현재 자료의 불변 묶음 캡처는 shared review-bundle-snapshot 내부 함수로 먼저 준비하고 G1의 M-020에서 재사용합니다. POLICY를 미구현 M-020 호출에 의존시키지 않아 DAG 순환을 피합니다.

- [x] **Step 100: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/review-policy.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/policy.spec.ts
```

통과 조건은 다음과 같습니다. 문서 없는 최초 배정, 빈 검토자/담당자만의 통과를 막는 순수 자격 판정, 정책 비소급과 특정 SR 적용, 미해결 요청·원 요청자 보존이 통과합니다. 제거된 검토자의 M-021 HTTP 거절은 CG-18에서, 원 요청자의 M-025 확인은 CG-19에서 해당 메서드 구현 뒤 검증합니다.

- [x] **Step 101: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 102: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-029 전체 서비스 동작과 US-030 선행 배정 경로를 구현합니다. 정책/배정 변경이 G1/G2/현재 요청/활동/receipt와 원자적으로 반영되는 검증을 기록합니다.

이 묶음의 화면과 tests/e2e/bundles/policy.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
