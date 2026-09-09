# CG-09 DraftReview 부분 구현 보고

CG-09 전체 중 UI-20의 저장 초안 조회, 사람 검토 초안 저장과 명시 적용 화면을 구현했습니다. 이 화면의 fixture는 저장·조회·적용 경로를 검증하기 위한 가상 입력이며 실제 Claude 실행 증거가 아닙니다.

## 구현한 경계

- `src/web/components/DraftReview.tsx`는 M-047의 작은 `generationDrafts` 목록에서 provider 초안과 `human_review` 초안을 고릅니다. 선택한 초안은 `{kind:'draft',draftId}`로 다시 읽어 불변 InputSnapshot, 원 fingerprint, 현재 fingerprint와 적용 이력을 표시합니다. 원 absent 대상이 occupied로 바뀐 경우 원 문서 기준과 현재 문서 기준을 구분합니다.
- 현재 SR owner만 M-019와 M-018 입력을 제출합니다. 다른 멤버는 고정 본문, 후보, provenance와 현재성만 읽습니다. 브라우저 권한 표시는 서버의 실제 현재 멤버십·owner 재검사를 대신하지 않습니다.
- stale 초안의 직접 적용은 막습니다. 사람은 비교 검토 사유와 판별된 `GenerationResult` 본문을 M-019로 별도 저장합니다. 응답으로 받은 새 `human_review` draftId를 M-047로 다시 읽은 뒤 M-018을 별도 행동으로 실행합니다.
- 질문 초안은 temporaryId별 후보, 제안 담당자, 필요 gate와 답변 후보를 보여주고 사람이 적용 대상을 고릅니다. 결정 초안은 대안·영향·추천을 보여주며 사람이 decision maker와 current G1/G2 또는 followup 분류를 명시합니다. 적용 결과는 질문의 답변이나 결정의 확정으로 표시하지 않습니다.
- artifact 초안은 Markdown, 변경 요약, section ID, 요구사항 ID, 연결 section과 수용 기준을 구조형 폼으로 만듭니다. section 제목과 offset은 `src/domain/artifact-rules.ts`의 원문 inspector로 계산합니다. raw JSON 편집 입력은 제공하지 않습니다.
- WorkflowPlan 초안은 `v1.0.1`, 한 implementation unit, 복수 단계의 실행 또는 생략 이유, design artifact ref, 복수 task의 requirement·verification·order를 완전한 M-018 `WorkflowPlanEdit`로 만듭니다. CG-20의 전체 WorkflowPlanEditor와 G2 정책 완성은 이 범위에 포함하지 않습니다.
- FormDraft는 actor·프로젝트·SR·draftId별 입력과 기준을 분리합니다. 409 뒤 dirty 입력을 보존하고 최신 기준을 비교한 뒤 기준만 채택하거나 `discardToLatest`로 입력과 guard를 함께 폐기합니다. CommandSession은 M-018/M-019의 입력·guard·idempotency key를 고정하며 전송 결과가 불명확하면 같은 요청으로 확인합니다.
- 선택 M-047 조회 순번은 늦은 다른 draft 응답을 폐기합니다. M-019 처리 중 바뀐 모든 form 입력은 이전 응답이 도착해도 유지합니다. M-018의 Committed와 응답 유실 뒤 Replayed 결과는 같은 적용 한 건으로 다시 읽습니다.
- `src/web/api/client.ts`는 새로 소비하는 GenerationDraftIndexView, DraftView, InputSnapshot, GenerationResult, provenance, freshness, application, draft preparation과 M-018/M-019 결과를 판별합니다. malformed command 성공값은 TransportUncertainError로 처리하며 malformed query는 렌더 전에 거절합니다. EntityRef와 VersionRef도 알려진 kind, scope 필드와 양의 정수 version을 검사합니다.

## TDD 근거

- `npm test -- tests/unit/web/client.test.ts`의 첫 실행은 exit 1이며 12개 중 신규 2개가 실패했습니다. M-018의 null value가 확정 성공으로 해석됐고, provider provenance의 필수 sourceRunId가 없는 M-047 `generationDrafts` 항목이 통과한 것이 기대한 RED였습니다. runtime codec을 연결한 같은 명령은 exit 0이며 12개가 통과했습니다.
- `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium`의 첫 실행은 exit 1이며 최초 2개가 모두 실패했습니다. 상세 화면에 `초안 검토` 탭이 없어 provider 초안 재개방·현재 적용과 stale absent 초안 검토 경로가 각각 timeout된 것이 실제 UI 부재 RED였습니다.
- 초기 UI 연결 뒤 페이지 재진입을 단순 reload로 잘못 가정한 검사와 중복 `status` locator, section label이 입력 검증보다 먼저 실패했습니다. 테스트를 실제 보드 재진입과 고유 label로 바로잡았으며 이 실행들은 행동 RED로 세지 않았습니다.
- `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium --grep 'owner가 아닌|지연 응답|409 뒤|전송 결과'`은 exit 1이며 4개 중 2개가 실패했습니다. 409 뒤 최신 M-047가 INPUT_CHANGED 오류를 지웠고, 전송 실패 뒤 실행 중 표식이 남아 같은 idempotency key 재시도가 시작되지 않은 것이 기대한 RED였습니다. 오류를 유지한 최신 기준 갱신과 실행 상태 해제 후 `--grep '409 뒤|전송 결과'`은 exit 0이며 2개가 통과했습니다.
- 적용된 초안을 페이지 재진입 뒤 다시 선택할 때 본문 로딩을 기다리는 assertion을 보완한 검사는 exit 1이며 적용 버튼이 한 개 남았습니다. 적용 이력을 읽은 초안에서는 버튼을 제거한 뒤 `--grep '한 번만 적용'`은 exit 0이며 1개가 통과했습니다.
- WorkflowPlan 다중 구조 검사는 `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium --grep 'WorkflowPlan'`에서 exit 1이며 `단계 추가` 버튼이 없어 timeout됐습니다. 복수 단계·task 추가와 삭제 입력을 연결했습니다. 직후 GREEN 재실행은 병행 작성 중이던 `src/persistence/generation-repository.ts:157`의 잘못된 `readonly` 구문 때문에 Playwright 수집 전에 중단됐습니다. 이 과제에서는 그 파일을 수정하지 않았습니다. 병행 작성자가 구문을 고정한 뒤 같은 명령은 exit 0이며 1개가 통과했습니다.

## 최종 검증

- `npm test -- tests/unit/web/client.test.ts`는 exit 0이며 13개가 통과했습니다.
- `npx playwright test tests/e2e/draft-review.spec.ts tests/e2e/artifact-workspace.spec.ts tests/e2e/question-decision.spec.ts --project=chromium`은 exit 0이며 38개가 통과했습니다. 이 중 DraftReview 검사는 17개입니다.
- `npm run typecheck`는 exit 0입니다. server와 web TypeScript 검사가 모두 통과했습니다.
- `npm run build`는 exit 0입니다. Vite가 199개 module을 변환하고 `dist/web`을 생성했습니다. Vite 8의 향후 native config loader와 관련된 기존 JSON import attribute 및 확장자 경고는 남아 있습니다.
- 변경한 Markdown에는 Mermaid, ASCII diagram, JSON/YAML code block이 없습니다. 제목, 목록, inline code의 Markdown 구문과 특수문자 표기를 확인했습니다.

## 독립 검토 fix round 1

- M-018과 M-019 실행은 시작한 draft와 현재 선택한 draft를 별도 identity로 추적합니다. 이전 draft의 늦은 성공, 거절, 불명확 결과는 command 이력에는 남지만 새로 선택한 draft의 화면, dirty 입력, loading, 오류와 재시도 안내를 바꾸지 않습니다. M-019 응답을 기다리는 동안 같은 draft를 고친 경우에도 입력 revision을 비교해 새 입력을 유지합니다.
- 고정 InputSnapshot의 업무 본문과 현재 SR 자료를 종류와 entity ID로 대응시켜 `동일`, `변경`, `추가`, `삭제`, `현재값 미확인`으로 표시합니다. 설명, 출처, artifact, 질문 결과, 결정 결과, 분류와 멤버 자료의 실제 이전·현재 내용을 안전한 텍스트로 보여줍니다. 현재 값을 조회할 수 없는 ref는 삭제로 추정하지 않습니다. 당시 확인되지 않은 출처도 별도 표시합니다.
- 질문 제안은 문구, 이유, 제안 담당자, gate와 답변 후보를 수정합니다. 결정 제안은 문구, 영향, 추천과 대안을 수정하고 대안을 추가하거나 삭제합니다. 출처 ref는 읽을 수 있게 표시합니다. M-019는 원 provider draft를 바꾸지 않고 새 `human_review` draft를 저장하며 M-018은 그 새 draft에 별도로 실행합니다.
- artifact 제안은 요구사항 행을 추가하거나 삭제하고 `body.requirementRefs`를 화면의 구조형 요구사항 행과 항상 일치시킵니다.
- InputSnapshot codec은 `version` 속성이 있으면 VersionRef 전체 계약을 먼저 검사합니다. 문자열·0 version과 entity-only kind에 version이 붙은 값은 malformed query로 거절합니다.

### Fix TDD 근거

- `npm test -- tests/unit/web/client.test.ts`의 RED 실행은 exit 1이며 13개 중 신규 1개가 실패했습니다. `version: "1"`인 artifact ref를 M-047 InputSnapshot이 받아들인 것이 기대한 실패였습니다. entity-only question kind에 version이 붙은 사례도 같은 회귀에 포함했습니다. codec 수정 뒤 같은 명령은 exit 0이며 13개가 통과했습니다.
- `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium --grep '늦은 응답|고정 입력과 현재 자료|구조형으로|요구사항 행'`의 RED 실행은 exit 1입니다. 신규 5개 중 4개가 실패했고 최초 M-018 검사는 실제 서버 적용 대기 전에 끝나는 약한 검사였습니다. 실패한 검사는 M-019 응답이 다른 draft 입력을 지우는 동작, 본문 비교 영역 부재, 질문·결정 편집 필드 부재, artifact 요구사항 삭제 행동 부재를 재현했습니다.
- 약한 M-018 검사를 실제 서버 적용 완료까지 기다리도록 강화한 `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium --grep 'M-018의 늦은 응답'`은 exit 1이며 1개가 실패했습니다. A의 늦은 응답이 선택된 B를 A로 바꾼 것이 기대한 RED였습니다.
- 늦은 거절과 전송 불명확 결과가 다른 draft에 누출되지 않는 검사, 고정 설명 A와 현재 설명 B를 함께 읽는 검사, 질문·결정의 별도 사람 검토 초안 저장·적용 검사와 artifact 요구사항 추가·삭제 검사를 더했습니다. `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium`은 exit 0이며 17개가 통과했습니다.
- 영향 범위를 합친 첫 실행은 38개 중 37개가 통과했고, M-018 회귀가 B의 M-047 로딩 전에 입력을 찾는 테스트 동기화 문제로 실패했습니다. B 제목 로딩을 기다리도록 고친 뒤 제품 코드는 바꾸지 않았습니다. 최종 `npx playwright test tests/e2e/draft-review.spec.ts tests/e2e/artifact-workspace.spec.ts tests/e2e/question-decision.spec.ts --project=chromium`은 exit 0이며 38개가 통과했습니다.
- fix 뒤 `npm run typecheck`는 exit 0입니다. `npm run build`도 exit 0이며 199개 module을 변환했습니다. Build에는 앞에서 기록한 기존 Vite native config loader 경고만 있습니다.

## 독립 검토 fix round 2

- 고정 입력과 현재 자료를 `src/web/state/draft-input-comparison.ts`의 한 대칭 projection으로 변환합니다. 질문은 정의, 선택지, 상태, 답변 option·근거·답변자, 해결 근거·문서 반영·해결자, 전환 결정을 비교합니다. 분류는 followup 담당자, 재검토 조건과 basis refs까지 비교합니다. 결정은 정의와 현재 대안, 선택, 근거, 확정자와 변경 이유를 비교합니다. 출처, 문서 원문과 구조, SR 설명과 참여자도 같은 규칙으로 비교합니다.
- 같은 version의 같은 질문 답변과 근거는 `비교 범위 동일`로 표시합니다. 상태 설명은 고정 생성 입력에 포함됐고 현재 조회에서도 확인 가능한 업무 필드에 한정된다고 화면에 밝힙니다.
- 고정 snapshot에는 있지만 현재 M-047 DTO가 제공하지 않는 결정의 영향 요구사항과 연결 문서는 `현재값 미확인`으로 표시합니다. 조회하지 못한 값을 같음이나 삭제로 추정하지 않습니다. 이미 확인 가능한 대안이나 근거가 바뀌었으면 `변경`을 표시합니다.
- M-019 늦은 성공 검사는 route 응답 완료와 원 draft에서 파생된 `human_review` draft의 실제 저장을 기다린 뒤 현재 draft를 확인합니다. 늦은 M-018 거절은 브라우저 응답을, M-019 전송 실패는 브라우저 `requestfailed` 처리를 기다립니다. 고정 시간 sleep은 제거했습니다.

### Fix round 2 TDD와 검증 근거

- `npm test -- tests/unit/web/draft-comparison.test.ts`의 첫 실행은 exit 1이며 신규 4개가 모두 실패했습니다. 같은 질문 답변·근거를 `변경`으로 오탐했고, 질문 해결 근거를 표시하지 않았으며, 결정 대안과 followup 분류의 사람·재검토·basis 변경을 판별하지 못한 것이 기대한 RED였습니다.
- projection 구현 뒤 표시 이름이 없는 같은 출처의 `null`과 `undefined`가 다르게 정규화되는 추가 RED를 같은 명령으로 확인했습니다. 5개 중 1개가 실패했습니다. 표시 이름 부재를 `null`로 통일한 최종 실행은 exit 0이며 5개가 통과했습니다.
- 지연 명령 완료 신호를 보강한 첫 E2E 실행은 5개 중 4개가 통과했고, M-019 검사에 completion promise를 잘못 둬 `ReferenceError`가 발생했습니다. 이는 제품 행동 실패로 세지 않았습니다. 검사 위치를 바로잡은 `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium --grep '늦은 응답|늦은 M-018 거절|늦은 M-019 불명확|고정 입력과 현재 자료'`는 exit 0이며 5개가 통과했습니다.
- `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium`은 exit 0이며 17개가 통과했습니다. 출처 부재 정규화 뒤 본문 비교 검사를 다시 실행한 `--grep '고정 입력과 현재 자료 비교'`도 exit 0이며 1개가 통과했습니다.
- 첫 `npm run typecheck`는 test fixture의 의도적인 부분 객체 direct cast 5곳을 TS2352로 거절해 exit 1이었습니다. `unknown` 경계를 명시한 뒤 최종 `npm run typecheck`는 exit 0입니다.
- 최종 `npm run build`는 exit 0이며 새 helper를 포함해 200개 module을 변환했습니다. 기존 Vite native config loader 경고는 그대로입니다.

## 독립 검토 fix round 3

- 외부 근거는 label, URL 유무와 verification summary를 고정 입력과 현재 자료 양쪽에 표시합니다. entityId가 없는 합법 external EvidenceRef를 `알 수 없음`으로 축약하지 않습니다.
- link 출처는 verifiable, observed external version과 unavailable reason을 표시합니다. 문서는 section title과 offset, requirement별 section과 acceptance criteria를 표시합니다. WorkflowPlan은 각 단계의 실행·생략과 design refs, task 순서·요구사항·verification을 표시합니다. 비교 판정에 사용한 업무 필드가 바뀌면 사람이 양쪽의 실제 차이를 읽을 수 있습니다.
- 고정 snapshot의 decision `selectedOption`은 option 선택과 직접 입력 text를 구분하지 않습니다. 대안 ID와 값이 우연히 같은지 보고 선택 방식을 추정하지 않고, 양쪽 모두 저장된 선택 값으로 비교합니다. 화면에도 이 고정 입력 한계를 명시합니다.

### Fix round 3 TDD와 검증 근거

- `npm test -- tests/unit/web/draft-comparison.test.ts`의 RED 실행은 exit 1이며 9개 중 신규 4개가 실패했습니다. 외부 근거, 수용 기준·workflow 계획, link 검증 정보가 판정에는 반영돼도 양쪽 본문에서 보이지 않았고, 직접 입력 text와 option ID가 같은 결정은 `변경`으로 오탐한 것이 기대한 실패였습니다.
- 표시와 대칭 선택 값 projection을 고친 같은 명령은 exit 0이며 9개가 통과했습니다.
- `npx playwright test tests/e2e/draft-review.spec.ts --project=chromium --grep '고정 입력과 현재 자료 비교'`는 exit 0이며 1개가 통과했습니다.
- `npm run typecheck`는 exit 1입니다. 병행 CG-18 파일인 `src/application/review-workflow-service.ts:94`, `src/persistence/review-repository.ts:33`, `src/persistence/sr-repository.ts:692`의 작성 중 타입 오류 3건에서 server 검사 중단됐습니다. 이 과제 파일은 수정하지 않았습니다. `./node_modules/.bin/tsc -p tsconfig.web.json --noEmit`은 exit 0이며 fix round 3의 web 및 contracts 코드 타입이 통과했습니다. 이 web 설정은 테스트 파일을 포함하지 않습니다.

## 후속 범위

CG-20은 전용 WorkflowPlanEditor, 단계 정책과 G2 전체 검증을 완성합니다. CG-09 전체와 중앙 계획 완료 표시는 주 작업자가 독립 검토 뒤 관리합니다.

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 이 부분 구현에는 N/A입니다.
