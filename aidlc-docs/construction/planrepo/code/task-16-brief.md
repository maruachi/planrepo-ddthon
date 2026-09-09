# CG-16 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

### CG-16 질문 해결·결정 전환·재결정·후속 범위의 불변 처리 이력

**구현 묶음**: B-03입니다. **선행**: CG-07, CG-09입니다.

**연결 기준**: M-008, M-009, M-010, M-011, M-012, M-013, M-014, M-047, US-004, US-005, US-006, US-007, US-008, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-18, ENT-21, ENT-22, ENT-34, ENT-35, SCN-02, SCN-03, SCN-04, SCN-09, SCN-10, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-18, ND-01, ND-02, ND-03, ND-07, INF-02, INF-04, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/application/question-decision-service.ts` | 갱신합니다. | M-009/M-011/M-013/M-014를 추가하고 EDITOR의 답변·후속 질문·결정 확정에 전파 규칙을 연결합니다. |
| `src/domain/question-decision-policy.ts` | 생성합니다. | 답변·해결·전환·지정 결정권자·범위 변경의 순수 조건을 판정합니다. |
| `src/persistence/question-decision-repository.ts` | 갱신합니다. | 질문 결과·답변·결정·분류의 새 버전과 현재 포인터를 원자적으로 저장합니다. |
| `src/domain/review-impact.ts` | 갱신합니다. | 질문·결정·범위 변경의 G1/G2 영향과 해결 확인 최신성을 판정합니다. |
| `tests/integration/question-decision.test.ts` | 생성합니다. | 특정 답변 해결·새 답변·중복 전환·확정 권한·범위 우회를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | S-03의 버전·권한·거절 계약을 정리합니다. |
| `src/web/components/QuestionPanel.tsx` | 갱신합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/DecisionPanel.tsx` | 갱신합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/ScopeClassificationForm.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/question.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**첫 소비 보완**: 결정31과32를 따릅니다. current에서 followup 전환의 확정된 범위 축소·개정 요구사항 refs를 wire와 저장에서 보존합니다. 현재 분류 이유·담당자·재검토 조건·basisRefs는 실제 M047/ScopeView typed 조회에 연결합니다. 해결·전환·재결정의 새 업무 내용은 generation-input-repository와 generation-snapshot의 명시 typed 입력에도 포함해 fixed snapshot이 실제 사람 근거를 보존하게 합니다.

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. EDITOR가 M-008/M-010/M-012의 기본 경로를 제공하며 이 task는 해결·전환·재결정·분류와 상호작용을 완성합니다. answeredQuestionSnapshotRef는 답변 전 질문 정의, selectedAnswerRef는 결과가 채택한 답변입니다. 해결 확인은 정확한 답변/근거/반영 문서 또는 noDocumentChangeReason에 고정합니다. US-007/US-008 최종 완료는 B-06입니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 091: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('새 답변은 과거 해결 확인을 재사용하지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    let now = await currentCase(app.db, c.key);
    const q = now.question;
    const base = { actorId: q.assigneeId, projectId: c.projectId, srId: c.srId };
    const answer = await app.invoke('M-008', { ...base, requestId: 'answer-1',
      idempotencyKey: 'answer-1', guard: { resource: { target: { kind: 'question', projectId: c.projectId, srId: c.srId, entityId: q.questionId }, expectedRevision: q.revision } } }, {
      questionId: q.questionId, answeredQuestionSnapshotRef: q.currentResult.ref,
      answer: { kind: 'free_text', text: '결제 후 7일 이내 취소합니다.' },
      evidence: { text: '가상 정책 확인입니다.' }
    });
    expect(answer.ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect(now.question.status).toBe('answered');
    const resolved = await app.invoke('M-009', { ...base, actorId: c.ownerId,
      requestId: 'resolve-1', idempotencyKey: 'resolve-1',
      guard: { resource: { target: { kind: 'question', projectId: c.projectId, srId: c.srId, entityId: q.questionId }, expectedRevision: now.question.revision } } }, {
      questionId: q.questionId, selectedAnswerRef: now.question.currentResult.selectedAnswer!.ref,
      resolutionEvidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
      documentDisposition: { kind: 'not_required', reason: '현재 요구사항에 동일한 취소 기한이 있습니다.' }
    });
    expect(resolved.ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect(now.question.status).toBe('resolved');
    const changed = await app.invoke('M-008', { ...base, requestId: 'answer-2',
      idempotencyKey: 'answer-2', guard: { resource: { target: { kind: 'question', projectId: c.projectId, srId: c.srId, entityId: q.questionId }, expectedRevision: now.question.revision } } }, {
      questionId: q.questionId, answeredQuestionSnapshotRef: now.question.currentResult.ref,
      answer: { kind: 'free_text', text: '결제 후 3일 이내 취소합니다.' },
      evidence: { text: '변경된 가상 정책입니다.' }
    });
    expect(changed.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).question.status).toBe('answered');
  } finally {
    await app.close();
  }
});
```

- [x] **Step 092: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/question-decision.test.ts
```

예상 결과는 다음과 같습니다. 새 답변 저장 뒤 기존 resolved 포인터나 확인을 유지하는 구현에서 마지막 answered 단언이 실패합니다. 첫 답변·해결 성공 단언으로 준비 실패를 구분합니다.

- [x] **Step 093: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

각 명령에서 현재 배정과 기대 revision을 확인한 뒤 답변/질문 결과/분류/결정의 불변 버전을 추가합니다. M-011은 UNIQUE(projectId,srId,originQuestionId)로 공식 결정을 하나만 만들고 질문 상태를 converted_to_decision으로 고정합니다. 전환된 질문의 M-008/M-009는 거절하며 GateAssessment는 연결 결정만 한 번 집계합니다. M-012/M-013은 현재 decisionMakerId만 허용하고 이전 결정 버전·분류를 보존합니다. M-014의 followup은 None·이유·담당자·재검토 시점과 필요한 범위 결정/요구사항 개정 refs를 요구합니다. G1 내용 변화는 종속 G2까지, G2 전용 변화는 G2만 ReviewImpact로 같은 tx에 확정합니다.

- [x] **Step 094: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/question-decision.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/question.spec.ts
```

통과 조건은 다음과 같습니다. SCN-02~04의 답변/해결 분리, 특정 답변 최신성, 동시 두 전환, 전환 뒤 재답변 금지, 미확정 결정 단일 차단, 비지정 확정 거절과 범위 축소 순서가 통과합니다.

- [x] **Step 095: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 096: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-004~006의 서비스 기준을 검증하고 US-007/008의 기본 경로와 B-06 재검토 입력을 제공합니다. 질문·결정·분류·게이트·활동·receipt 중 한 쓰기 실패가 전체 rollback되는 증거를 기록합니다.

이 묶음의 화면과 tests/e2e/bundles/question.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
