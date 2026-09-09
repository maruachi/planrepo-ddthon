# CG-16 질문 해결·결정 전환·재결정·범위 분류 UI 보고

CG-16 backend의 M-009, M-011, M-013, M-014를 실제 M-047 DTO, HTTP 서버, SQLite TestApp과 React 화면에 연결했습니다. 질문 답변·후속 질문·첫 결정 확정 화면의 기존 동작도 유지합니다.

## 구현한 경계

- `src/web/components/QuestionPanel.tsx`는 answered 질문의 정확한 selected answer ref를 기준으로 해결 확인을 저장합니다. 사람은 해결 근거와 현재 artifact version을 복수 선택하거나 문서 변경 불필요 이유를 명시합니다. 해결 이력은 answered와 resolved를 구분해 모든 멤버에게 표시합니다.
- SR owner는 아직 전환되지 않은 질문을 결정으로 바꿉니다. 현재 question result snapshot과 classification ref는 화면의 실제 DTO에서 가져옵니다. 결정 문구, 구조형 대안, 영향과 현재 프로젝트의 decision maker를 입력합니다. 전환된 질문에는 답변, 해결, 후속 질문, 중복 전환과 분류 변경 행동을 제공하지 않습니다.
- `src/web/components/DecisionPanel.tsx`는 현재 decision maker에게만 재결정 폼을 제공합니다. 현재 confirmation ref를 previousVersionRef로 고정하고 새 선택, 이유, 근거와 변경 이유를 저장합니다. 연결 질문과 결과 version, 이전 결정 version과 변경 이유를 읽기 이력에 표시합니다.
- `src/web/components/ScopeClassificationForm.tsx`는 현재 분류의 이유, 분류자, version, 후속 담당자·재검토 조건과 basis refs를 표시합니다. SR owner만 current G1/G2 또는 followup None을 저장합니다. current에서 followup으로 옮길 때 실제 확정 decision version과 현재 requirements artifact version을 선택합니다. 이미 followup인 항목은 새 범위 축소 근거 없이 담당자와 재검토 조건을 갱신합니다.
- 새 폼은 actor, project, SR, entity, command identity로 CommandSession을 분리합니다. 전송 결과가 불명확하면 같은 idempotency key로 확인합니다. 409 또는 새 M-047 응답은 dirty 입력을 보존하고 최신 basis를 별도로 보여줍니다. 사람은 최신 basis만 채택하거나 입력과 basis를 함께 폐기합니다. 늦은 성공 중 입력을 바꾸면 이전 시도의 결과는 기록하되 현재 입력을 저장 완료 상태로 덮지 않습니다.
- `src/web/api/client.ts`는 QuestionView, DecisionView, ScopeView의 classification, selected answer, resolution, decision confirmation, previous version과 상태 조합을 좁은 runtime codec으로 검사합니다. M-009, M-011, M-013, M-014의 malformed 성공 응답은 TransportUncertainError로 남겨 같은 key를 확인할 수 있습니다. M-047의 malformed 질문·결정은 렌더 전에 query 오류로 거절합니다.
- `src/web/components/SRDetail.tsx`는 workspace의 공개 actor ID와 표시 이름을 결정·범위 폼에도 전달합니다. backend는 제출 시 실제 owner, decision maker와 현재 멤버십을 다시 검사합니다.

## TDD 근거

- 첫 client RED 명령 `./node_modules/.bin/vitest run tests/unit/web/client.test.ts`는 exit 1이었습니다. 14개 중 신규 1개가 실패했습니다. M-009의 `value: null` 응답이 TransportUncertainError 대신 성공값으로 해석된 것이 기대한 실패였습니다. M-009, M-011, M-013, M-014 codec을 연결하고 nested 상태 불일치 회귀를 추가한 최종 실행은 exit 0이며 15개가 통과했습니다.
- 첫 브라우저 RED 명령 `npm run test:e2e -- tests/e2e/bundles/question.spec.ts`는 exit 1이었습니다. 1개가 30.1초 뒤 timeout됐습니다. answered 질문에 `해결 확인` 버튼이 없었던 것이 기대한 실패였습니다.
- M-014의 첫 후속 범위 검사는 현재 seed requirements가 범위 축소 결정 전에 작성돼 VALIDATION_ERROR를 반환했습니다. 실제 M-015로 결정 뒤 requirements v2를 만든 fixture로 고쳤습니다. label locator가 중첩 select를 함께 잡은 두 실패도 고유 폼 순서 locator로 바로잡았습니다. 이 세 실행은 제품 행동 RED로 세지 않았습니다.

## 검증 결과

- `./node_modules/.bin/vitest run tests/unit/web/client.test.ts`는 exit 0이며 1개 파일의 15개 테스트가 통과했습니다.
- `npm run test:e2e -- tests/e2e/bundles/question.spec.ts tests/e2e/question-decision.spec.ts`는 exit 0이며 20개가 통과했습니다. 이 중 새 CG-16 검사는 9개입니다. 해결의 not_required와 reflected 경로, 결정 전환, 재결정, current에서 followup 전환과 followup 재분류, 409 dirty 보존과 명시 기준 채택, 같은 key 확인, owner·decision maker 권한, 늦은 재결정 응답을 실제 HTTP와 SQLite에서 확인했습니다.
- `npm run typecheck`는 exit 0입니다. server와 web TypeScript 검사가 모두 통과했습니다.
- `npm run build`는 exit 0입니다. Vite가 201개 module을 변환했습니다. Vite native config loader의 기존 JSON import attribute와 확장자 경고는 남아 있습니다.
- 소유 11개 경로의 tab, trailing whitespace와 Markdown code fence 짝을 검사한 Python 명령은 exit 0이며 `validated 11 files`를 출력했습니다. 변경한 Markdown에는 Mermaid, ASCII diagram, JSON 또는 YAML code block이 없습니다.

## 변경 경로

- `src/web/api/client.ts`
- `src/web/components/QuestionPanel.tsx`
- `src/web/components/DecisionPanel.tsx`
- `src/web/components/ScopeClassificationForm.tsx`
- `src/web/components/SRDetail.tsx`
- `src/web/styles/base.css`
- `tests/unit/web/client.test.ts`
- `tests/e2e/bundles/question.spec.ts`
- `aidlc-docs/construction/planrepo/code/task-16-brief.md`
- `aidlc-docs/construction/planrepo/code/task-16-ui-report.md`
- `aidlc-docs/construction/planrepo/code/task-09-draft-ui-report.md`의 요청된 사실 정정

CG-09 DraftReview 보고서의 병행 과제 표기를 CG-18로 바로잡았습니다. `tsconfig.web.json`은 web과 contracts 코드를 검사하고 테스트 파일은 포함하지 않는다고 정확히 적었습니다.

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 이 구현에는 N/A입니다.

## 독립 검토 fix round 1

`src/web/api/client.ts`의 질문·결정 codec을 바깥 SR scope와 논리 대상에 연결했습니다. QuestionView는 현재 결과, 선택 답변이 기준으로 삼은 질문 결과, 해결 근거의 문서 refs, 분류와 근거 refs가 같은 project/SR에 속하는지 검사합니다. DecisionView는 현재/이전 decision version, 분류, origin 질문 결과와 근거 refs의 scope와 entity 관계를 검사합니다. 현재 requiredGate도 현재 classification과 일치해야 합니다. M-009, M-011, M-013, M-014 성공 응답은 요청 scope와 question/decision/분류 대상을 추가로 대조합니다. M-047은 질문·결정 각각의 scope와 converted question·origin decision 양방향 연결을 렌더 전에 검사합니다. 명령의 malformed 성공은 `TransportUncertainError`, M-047의 malformed 조회는 query 오류로 유지합니다.

첫 RED 명령 `npm test -- tests/unit/web/client.test.ts`는 exit 1이었습니다. 17개 중 신규 2개가 실패했습니다. M-009의 `answeredQuestionSnapshotRef`가 다른 SR이어도 `Committed`로 복원됐고, M-047도 같은 변조 질문을 정상 조회로 받았습니다. 최소 codec 구현 뒤 같은 명령은 exit 0이며 17개가 통과했습니다. 이 검사는 네 명령의 교차 scope 변조와 M-047의 분류·전환 연결 변조를 모두 실행합니다.

첫 영향 E2E 명령 `npm run test:e2e -- tests/e2e/bundles/question.spec.ts tests/e2e/question-decision.spec.ts`에서는 구현 중 `switch` case grouping 오류로 M-008/M-010까지 M-009 결과 상관 검사를 적용했습니다. 30초 도구 yield 시점에 기존 M-008 자유 답변, M-010 후속 질문, M-008 선택 답변 3개가 연속 실패했고 process는 exit 1이었습니다. yield 뒤 최종 합계 출력은 수집하지 못했으므로 이 중간 실행의 정확한 전체 실패 수는 기록하지 않습니다. grouping을 바로잡은 최종 동일 명령은 exit 0이며 20개가 통과했습니다. 기존 질문 답변·후속 질문·확정, 409·불명확 결과·늦은 응답과 탭 왕복도 유지됩니다.

첫 `npm run typecheck`는 테스트 fixture literal 두 곳의 `kind`가 string으로 넓어져 exit 1이었습니다. `QuestionAnswerVersionRef`와 `ScopeClassificationRef` literal을 `as const`로 좁힌 최종 동일 명령은 exit 0입니다. `npm run build`는 exit 0이며 Vite가 201개 module을 변환했습니다. 기존 Vite native config loader 경고는 그대로입니다.

검토의 actor ABA 후보는 현재 제품 경로에서 재현되지 않았습니다. `App.tsx`의 actor 변경은 `selectedSrId`를 즉시 비워 SR 상세 전체를 unmount하고, 상세 화면에는 actor picker가 없습니다. 기존 폼의 unmount cleanup이 진행 중 응답을 차단합니다. 새 actor 전환 기능이나 가짜 E2E fixture는 만들지 않았습니다. reviewer와 root가 이 항목을 현재 결함에서 제외했으며, 기존 늦은 응답과 탭 보존 E2E를 다시 통과시켰습니다.

fix round 1에서 바꾼 경로는 다음 세 개입니다.

- `src/web/api/client.ts`
- `tests/unit/web/client.test.ts`
- `aidlc-docs/construction/planrepo/code/task-16-ui-report.md`

## 독립 검토 fix round 2

M-047의 converted question과 origin decision 연결에서 snapshot version 순서를 검사합니다. decision의 `originQuestionResultSnapshotRef.version`은 전환 뒤 만들어진 linked question의 `currentResult.ref.version`보다 작아야 합니다. 같거나 미래인 version은 거절합니다. 과거 snapshot row의 실제 존재 여부는 M-047 DTO에 없으므로 추정하지 않으며, version 차이가 정확히 1이라고 가정하지도 않습니다.

첫 RED 명령 `npm test -- tests/unit/web/client.test.ts -t 'converted question의 현재 결과보다 같거나 미래인 origin result'`는 exit 1이며 신규 1개가 실패했습니다. linked question의 current result가 v2인데 origin result만 v3으로 변조한 M-047 응답을 Query 성공으로 받았습니다. 최소 `<` 검사 뒤 같은 명령은 exit 0이며 1개가 통과하고 17개는 필터로 건너뛰었습니다. 이어서 `npm test -- tests/unit/web/client.test.ts`는 exit 0이며 18개가 통과했습니다.

정상 실제 전환 검증 `npm run test:e2e -- tests/e2e/bundles/question.spec.ts -g 'owner가 현재 질문 결과와 분류를 기준으로 사람 결정권자에게 전환한다'`는 exit 0이며 1개가 통과했습니다. 실제 M-011의 origin v1과 converted current v2를 정상 수락했습니다. `npm run typecheck`도 exit 0입니다. fix round 2는 `src/web/api/client.ts`, `tests/unit/web/client.test.ts`, 이 보고서만 바꿨습니다. build와 관련 E2E 20개는 fix round 1에서 이미 통과했고 이번 변경은 browser codec의 단일 숫자 관계만 좁혔으므로 반복하지 않았습니다.
