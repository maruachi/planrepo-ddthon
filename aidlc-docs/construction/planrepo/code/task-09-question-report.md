# CG-09 질문·답변·결정 부분 구현 보고

CG-09 전체 중 M-008 질문 답변, M-010 후속 질문, M-012 결정 확정과 M-018 질문·결정 제안 저장에 필요한 DB·domain·application 경계만 구현했습니다. shared HTTP 조립과 React UI, 해결·전환·재분류·결정 개정은 이 부분의 완료 범위가 아닙니다.

## 구현한 경계

- `src/contracts/question-decision-content.ts`는 `QContentFields`와 `DecisionContentFields`를 정의합니다. 질문 원문·이유·담당자·답변 방식·선택지·분류·출처·현재 결과와 결정 원문·대안·영향·결정권자·추천·현재 확정 내용을 실제 값으로 반환합니다. shared `QuestionView`와 `DecisionView`가 이 필드를 상속합니다.
- `src/persistence/question-decision-repository.ts`는 현재 질문·결정의 단건 및 복수 reader를 제공합니다. 현재 pointer가 가리키는 질문 결과, 선택 답변, 결정 확정 version을 실제 불변 row에서 읽으며 JSON shape, ref kind, project/SR scope, version과 실제 참조 row를 검사합니다.
- `applyQuestionDraftSelections`와 `applyDecisionDraftSelections`는 호출자가 연 transaction 안에서 현재 member와 명시 분류를 검사하고 temporary ID와 새 entity ref의 mapping만 반환합니다. 자체 transaction, receipt와 commit은 만들지 않습니다. 질문 제안은 `free_text`와 `current` 분류로 저장합니다. 결정 제안은 사람이 지정한 `decisionMakerId`와 `classification`으로 미확정 entity만 만듭니다.
- `src/domain/question-decision-rules.ts`는 G1 변경의 G2 종속 영향, G2 전용 영향과 followup/None의 gate 무변경을 계산합니다. 선택형 질문은 현재 option 선택과 담당자의 직접 작성 `free_text` 답변을 모두 허용합니다. `free_text` 질문의 임의 choice는 거절합니다.
- `src/application/question-decision-service.ts`의 `createQuestionDecisionService(persistence)`는 `answerQuestion`, `addFollowupQuestion`, `confirmDecision`을 제공합니다. 실제 current member와 담당자·SR owner·decision maker 권한을 receipt 조회보다 먼저 검사합니다. guard, 현재 참조, 지문, 불변 version, ReviewImpact, SR revision, activity와 receipt를 한 IMMEDIATE transaction에서 확정합니다.
- 명령 fingerprint는 command kind, scope, guard와 명시 input을 포함하고 request ID와 실행 시각은 제외합니다. 같은 입력은 고정 replay를 반환하며 같은 idempotency key의 다른 입력은 거절합니다.
- 저장 JSON·row codec 손상과 SQLite 오류만 `STORE_UNAVAILABLE`로 변환합니다. 입력 위반은 `VALIDATION_ERROR`이며 일반 `TypeError` 같은 programmer 오류는 원본으로 전파해 상위 HTTP 500 경계가 처리하도록 둡니다.

## 소비 API

- application: `createQuestionDecisionService(persistence)`가 반환한 `answerQuestion(ctx, input)`, `addFollowupQuestion(ctx, input)`, `confirmDecision(ctx, input)`을 공개 method handler가 호출합니다.
- query: `readQuestionViews(db, projectId, srId)`와 `readDecisionViews(db, projectId, srId)`를 SR reader가 사용합니다. 단건 명령 경계는 `readQuestionView(db, scope, questionId)`와 `readDecisionView(db, scope, decisionId)`를 사용합니다.
- draft apply: `applyQuestionDraftSelections(db, input)`과 `applyDecisionDraftSelections(db, input)`은 외부 application transaction 안에서 호출하고 반환 mappings를 M-018 결과에 그대로 사용합니다.

## TDD와 검증

- scaffold와 5개 행동 assertion을 만든 첫 `npm test -- tests/integration/question-decision-service.test.ts`는 exit 1이었습니다. 5개가 모두 명시 미구현 오류로 실패했습니다.
- 첫 최소 구현 뒤 같은 명령은 exit 1이었고 5개 중 2개가 실패했습니다. G2 영향의 실제 earliest return stage가 테스트 기대와 달랐고 Decision content에 `requiredGate`가 없어 영향 gate가 비어 있었습니다. 실제 stage 기대를 바로잡고 저장된 분류 gate를 typed content로 연결한 뒤 5개가 모두 통과했습니다.
- 선택형 질문의 직접 작성 답변과 programmer 오류 경계를 추가한 같은 명령은 exit 1이었고 7개 중 새 2개가 실패했습니다. 선택형에 `free_text`를 허용하고 answer payload에 실제 answer kind를 보존했습니다. 모든 예외를 저장소 장애로 바꾸던 catch를 typed codec과 SQLite 오류로 좁힌 뒤 7개가 통과했습니다.
- proposal 원자성, followup/None 영향, JSON codec과 입력 오류 구분, actual plural reader를 추가한 `npm test -- tests/integration/question-decision-service.test.ts`는 exit 0이며 11개가 통과했습니다.
- command receipt 손상 fixture의 첫 두 실행은 append-only trigger와 `json_valid` 제약에 막혀 행동 RED 근거로 세지 않았습니다. 격리 TestApp에서 update 방지 trigger만 제거하고 유효 JSON의 잘못된 shape를 저장한 실행은 exit 1이었고 13개 중 1개가 `TypeError`를 냈습니다. receipt JSON parse와 최소 replay target shape를 typed codec 오류로 바꾼 뒤 같은 명령은 exit 0이며 13개가 통과했습니다.
- 동결 직전 격리 DB probe에서 M-010의 존재하지 않는 related Artifact ref가 `STORE_UNAVAILABLE`로 잘못 분류되고, 결정 제안의 중복 option ID 두 개가 그대로 저장되는 문제를 재현했습니다. 회귀를 추가한 `npm test -- tests/integration/question-decision-service.test.ts`는 exit 1이었고 15개 중 새 2개가 실패했습니다. 입력 ref 검사를 stored codec과 구분하고 대안의 빈 ID·본문 및 중복 ID를 쓰기 전에 검사했습니다. 같은 명령은 exit 0이며 15개가 통과했습니다. 서로 다른 option ID의 원문 보존과 실패 배치의 row rollback도 함께 확인했습니다.
- 첫 `npx tsc -p tsconfig.server.json --noEmit`은 exit 1이었습니다. 본인 소유 파일 오류는 없고 병행 작성 중이던 `tests/integration/artifact-edit.test.ts:78`, `:96`, `:121`, `:138`의 optional `srId` 오류 4건만 남았습니다. 다른 과제 파일은 수정하지 않았습니다.
- 최종 관련 검사 `npm test -- tests/integration/question-decision-service.test.ts tests/unit/generation-snapshot.test.ts`는 exit 0이며 2개 파일의 33개가 통과했습니다. 실제 Q/Decision 저장·서비스와 이 reader를 소비하는 생성 입력 회귀를 함께 확인했습니다.
- 병행 파일이 고정된 뒤 `npx tsc -p tsconfig.server.json --noEmit`은 exit 0이었습니다. 이어 실행한 `npm run typecheck`도 exit 0으로 server와 web 타입 검사가 모두 통과했습니다.
- 소유 source·test·report 6개 파일의 tab, trailing whitespace와 Markdown code fence 짝을 검사한 Python 명령은 exit 0이었고 `validated 6 files`를 출력했습니다.

## 남은 연결과 제한

M-008은 이 CG-09 기본 경계에서 `open` 질문의 첫 답변만 받습니다. `answered` 또는 `resolved` 질문의 새 답변 version, 해결 확인, 결정 전환과 분류 변경은 CG-16이 이 repository를 확장합니다. 답변은 항상 `answered`로 남고 사람의 해결 확인 없이 `resolved`로 바뀌지 않습니다.

shared method handler와 application composition, 실제 HTTP 계약 검증, QuestionPanel·DecisionPanel의 선택/직접 작성 UI는 후속 연결 범위입니다. M-018 service는 선택한 초안의 누락·중복·현재 fingerprint를 검증한 뒤 이 mappings-only repository API를 같은 transaction에서 호출해야 합니다. CG-09 전체 완료는 Artifact service, snapshot 조립, HTTP/UI와 전체 검증이 끝난 뒤 판단합니다.

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 이 부분 구현에는 N/A입니다.
