# CG-16 부분 구현 보고

## 범위와 결과

M-008 재답변과 M-009 해결, M-011 결정 전환, M-013 재결정, M-014 범위 분류의 backend 계약을 구현했습니다. 질문 답변·결과, 결정·결정 버전, 분류 버전, ReviewImpact, activity와 command receipt는 한 SQLite transaction에서 확정됩니다.

- M-009는 현재 SR owner와 정확한 현재 답변 ref를 검사합니다. 해결 근거와 반영 artifact ref 또는 문서 변경 불필요 이유를 불변 QuestionResultSnapshot에 보존합니다.
- M-008 재답변은 같은 answer ID의 다음 version과 previousVersion을 만들고 과거 해결 확인을 새 결과에서 제거합니다.
- M-011은 원 질문 결과 ref를 고정하고, 질문과 연결된 미확정 decision을 하나만 만듭니다. 새 decision은 원 질문 분류를 직접 공유하지 않고 독립 classification 계보를 시작합니다. 전환 뒤 원 질문의 M-008/M-009/M-014는 거절하며 연결 decision의 M-014는 허용합니다.
- M-012/M-013이 전환 decision을 확정하면 originQuestionId와 originQuestionResultSnapshotRef를 DecisionVersion에도 고정합니다. M-013은 현재 decision maker와 정확한 이전 version을 검사합니다.
- M-014 current→followup은 현재 확정 decision version과 현재 개정 requirements artifact version을 요구합니다. 이미 followup인 항목의 담당자·재검토 조건 변경은 새 축소 근거를 요구하지 않습니다. 현재 classification의 requiredGate를 이후 decision 조회와 ReviewImpact의 기준으로 사용합니다.
- M-047 QuestionView·DecisionView와 ScopeView에 검증한 현재 classification 내용을 반환합니다. 해결·전환·재결정의 업무 근거를 typed generation basis와 fixed InputSnapshot에 포함합니다.
- classification target과 entity pointer, converted question과 origin decision의 양방향 연결을 읽을 때 다시 검사합니다.

`src/runtime/application-composition.ts`의 M-009/M-011/M-013/M-014 Q adapter는 먼저 동결해 CG-10 작성자에게 넘겼습니다. 그 뒤 이 파일은 수정하지 않았습니다.

## TDD 근거

첫 행동 RED는 다음과 같습니다.

- `npm test -- tests/integration/question-decision.test.ts`: exit 1. M-008 첫 답변은 성공했지만 M-009가 미구현이라 성공 단언이 실패했습니다.
- 각 method의 좁은 `-t` 실행에서 M-011, M-013, M-014가 `NOT_IMPLEMENTED`로 실패한 뒤 구현하여 GREEN을 확인했습니다.
- `npm test -- tests/integration/question-decision.test.ts -t "M-014는 current 축소"`: exit 1. M-014 뒤 M-047 decision의 `requiredGate`가 현재 followup classification의 `None` 대신 과거 정의의 `G1`로 남았습니다. 현재 classification을 권위 기준으로 바꾼 뒤 exit 0, 1 passed입니다.
- `npm test -- tests/integration/question-decision.test.ts -t "M-011은 원 질문"`: exit 1. 전환 decision의 첫 DecisionVersion에 origin question 근거가 없었습니다. 정의와 각 DecisionVersion에 같은 고정 ref를 저장·검사한 뒤 exit 0, 1 passed입니다.

최종 검증은 다음과 같습니다.

- `npm test -- tests/integration/question-decision.test.ts`: exit 0, 1 file 6 tests passed.
- `npm test -- tests/contract/public-methods.test.ts tests/integration/question-decision.test.ts tests/integration/question-decision-service.test.ts tests/unit/generation-snapshot.test.ts tests/integration/generation-preparation.test.ts tests/unit/web/client.test.ts`: exit 0, 6 files 76 tests passed.
- `npm run typecheck`: exit 0. server와 web TypeScript 검사가 모두 통과했습니다.

테스트는 권한, exact guard/ref, idempotent replay, 동시 전환, 재답변의 과거 해결 제거, reflected/no-change 해결, 독립 전환 classification, 전환 뒤 차단, 재결정 이력, 범위 축소 basis, followup 재분류, G1/G2 영향, generation fixed snapshot과 late activity 실패 rollback을 검사합니다. 임의 classification target 손상도 읽기 단계에서 거절합니다.

## 변경 파일

- `src/application/question-decision-service.ts`
- `src/domain/question-decision-policy.ts`
- `src/domain/question-decision-rules.ts`
- `src/persistence/question-decision-repository.ts`
- `src/persistence/generation-input-repository.ts`
- `src/contracts/question-decision-content.ts`
- `src/contracts/views.ts`
- `src/contracts/schemas.ts`
- `src/runtime/application-composition.ts`의 동결된 Q adapter 부분
- `tests/integration/question-decision.test.ts`
- `aidlc-docs/construction/planrepo/code/task-16-report.md`

## 남은 경계

질문·결정·범위 분류 UI와 실제 브라우저 E2E는 backend 독립 검토 뒤 같은 CG-16의 다음 부분에서 연결합니다. 현재 web response codec은 새 resolution·currentClassification·origin version 필드를 아직 소비하지 않습니다. 전체 CG-16과 US-007/US-008을 완료 처리하지 않았습니다.

## 독립 검토 fix round 1

저장된 Q/Decision/Scope command receipt replay가 부분 필드 검사 뒤 원 JSON 객체를 그대로 반환하던 문제를 수정했습니다. 새 codec은 `QuestionView`, `DecisionView`, `ScopeView`의 허용 필드만 재구성합니다. scope, entity/version ref, classification, 답변·해결, decision confirmation, ReviewImpact의 필수 구조가 잘못되면 `STORE_UNAVAILABLE`로 거절합니다. 정상 receipt의 과거 `value`는 그대로 재생하고 `current`는 현재 DB revision에서 별도로 계산합니다.

- RED: `npm test -- tests/integration/question-decision.test.ts -t "stored replay codec"`는 exit 1입니다. M-009 replay의 top-level `ownershipToken`과 `currentResult.rawEnvironment`가 실제 응답에 그대로 포함되어 `not.toContain('secret')` 단언이 실패했습니다.
- GREEN: 같은 명령은 exit 0이며 1개가 통과하고 6개를 선택 제외했습니다. M-009/M-013/M-014의 top-level·nested canary 제거, question/decision/scope 필수 nested 값 손상 시 `STORE_UNAVAILABLE`, 원 `value`와 이후 변경된 최신 `currentRevision` 분리를 검사합니다.
- 영향 검증: `npm test -- tests/integration/question-decision-service.test.ts tests/integration/question-decision.test.ts`는 exit 0이며 2개 파일의 22개가 통과했습니다.
- 최종 관련 검증: `npm test -- tests/contract/public-methods.test.ts tests/integration/question-decision.test.ts tests/integration/question-decision-service.test.ts tests/unit/generation-snapshot.test.ts tests/integration/generation-preparation.test.ts tests/unit/web/client.test.ts`는 exit 0이며 6개 파일의 79개가 통과했습니다.
- `npm run typecheck`은 exit 0입니다.

fix round 1 변경 파일은 다음과 같습니다.

- `src/application/question-decision-replay.ts`
- `src/application/question-decision-service.ts`
- `tests/integration/question-decision.test.ts`
- `aidlc-docs/construction/planrepo/code/task-16-report.md`
