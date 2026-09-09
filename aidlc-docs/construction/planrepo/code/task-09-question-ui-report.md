# CG-09 질문·결정 UI 부분 구현 보고

CG-09 전체 중 UI-09 질문 답변·후속 질문과 UI-10 결정 확정의 React 화면 및 실제 HTTP 연결만 구현했습니다. ArtifactWorkspace, VersionComparison, DraftReview와 CG-09 전체 완료 판정은 이 부분의 범위가 아닙니다.

## 구현한 경계

- `src/web/components/QuestionPanel.tsx`는 M-047의 실제 QuestionView를 표시하고 M-008과 M-010을 호출합니다. 모든 멤버가 질문 이유, 담당자, 게이트, 기한, 선택지, 답변 후보, 출처·관련 문서와 현재 답변을 읽을 수 있습니다. 현재 담당자만 선택지 또는 직접 작성 답변과 근거를 저장할 수 있습니다. 현재 SR owner만 현재 프로젝트 멤버 중 담당자를 고른 후속 질문을 만들 수 있습니다.
- `src/web/components/DecisionPanel.tsx`는 모든 멤버에게 대안, 설명, 추천과 현재 확정을 표시합니다. 현재 decision maker에게만 M-012 확정 폼을 제공하며 선택, 이유와 근거를 함께 제출합니다.
- `src/web/components/SRDetail.tsx`는 기존 검토 요약·SOURCE와 새 질문·결정 탭을 연결합니다. 탭을 바꿀 때 각 패널을 unmount하지 않아 저장하지 않은 설명, SOURCE, 질문 답변, 후속 질문과 결정 입력을 보존합니다.
- `src/web/components/SRDetailShell.tsx`는 기존 loading, 오류, 헤더와 새로고침 동작을 유지한 채 SRDetail을 연결합니다. `src/web/App.tsx`는 현재 workspace의 공개 actor ID와 표시 이름만 멤버 후보로 전달합니다. 실제 권한과 현재 멤버십은 각 backend 명령이 다시 검사합니다.
- `src/web/styles/base.css`에는 질문·결정 card, 읽기 정의, 입력, 최신 기준 비교와 상태 표시용 scoped 스타일만 추가했습니다. 기존 SOURCE 스타일과 동작은 바꾸지 않았습니다.

## dirty 입력과 현재성

답변, 후속 질문과 결정 폼은 FormDraft와 CommandSession으로 form identity, 읽은 revision, 시도 input과 idempotency key를 고정합니다. 409 또는 M-047 새로고침으로 최신 자료가 도착해도 dirty input을 덮어쓰지 않습니다. 사용자는 최신 기준을 비교한 뒤 입력을 유지하며 새 revision을 채택하거나 작성 중 입력을 폐기합니다. 최신 질문이 answered이거나 최신 결정이 confirmed이면 CG-16 전에는 새 답변·재확정을 저장할 수 없음을 설명하고 기준 채택 버튼을 제공하지 않습니다.

HTTP 응답을 기다리는 동안 입력을 바꾸면 이전 시도의 성공이나 replay가 새 입력을 저장 완료로 표시하지 않습니다. 답변은 answer kind·값·근거, 후속 질문은 전체 제안 입력, 결정은 option ID·이유·근거를 시도 값과 비교합니다. 후속 질문 생성 결과의 새 자식 revision은 부모 질문의 제출 기준으로 사용하지 않습니다. 부모 질문 자체의 최신 revision만 M-010 guard에 채택합니다.

## TDD와 검증

- 최초 질문·결정 E2E scaffold의 `npx playwright test tests/e2e/question-decision.spec.ts --project=chromium`은 질문·결정 탭이 비활성 상태여서 당시 4개가 모두 timeout으로 실패했습니다. 실제 탭과 HTTP 폼을 연결한 뒤 초기 4개 중 2개가 통과했고, 접근 가능한 locator와 저장 뒤 폼 상태 기대를 실제 동작에 맞춰 좁힌 뒤 4개가 통과했습니다.
- 선택형 현재 답변과 지연된 결정 응답 중 option 변경 회귀는 각각 새 assertion이 실패하는 RED를 확인한 뒤 통과시켰습니다.
- 비결정권자의 대안·추천 읽기와 탭 왕복 중 설명·SOURCE 및 질문·결정 dirty 입력 보존의 새 3개 회귀는 모두 RED였습니다. 읽기 영역과 편집 권한을 분리하고 두 탭의 패널을 mounted 상태로 유지한 뒤 3개가 통과했습니다.
- 후속 질문의 지연 응답과 부모 revision 변경 회귀를 추가했습니다. 첫 지연 fixture 실행 두 번은 DOM에 필드가 있었지만 locator가 찾지 못해 timeout이 발생했으며 행동 RED로 세지 않았습니다. 안정적인 test ID로 fixture를 바로잡은 뒤 시도 input 비교와 최신 부모 기준 채택을 실제 HTTP에서 검증했습니다.
- 선택형 질문 내용을 담당자가 아닌 owner도 읽는 새 assertion은 exit 1이었고 1개가 실패했습니다. Received text에 질문·담당자·게이트만 있고 선택지가 없었습니다. 선택지와 후보·출처를 권한 없는 읽기 영역으로 옮긴 뒤 같은 명령은 exit 0이며 1개가 통과했습니다.
- 첫 동결 직전 `npx playwright test tests/e2e/question-decision.spec.ts --project=chromium`은 exit 0이며 10개가 통과했습니다. 자유 입력·선택형 직접 작성·현재 선택지, answered와 resolved 구분, 후속 질문, 결정 권한, 409, 지연 응답, 최신 기준 채택·폐기와 탭 입력 보존을 실제 TestApp HTTP와 브라우저에서 확인했습니다.
- 영향받는 기존 상세·SOURCE 검사 `npx playwright test tests/e2e/ui/base.spec.ts --project=chromium --grep '직접 등록한 SR|설명 변경은|설명 충돌 뒤|상세 조회 오류|SOURCE 저장 직후|Markdown 근거'`는 exit 0이며 6개가 통과했습니다.
- `npm run typecheck`는 exit 0이었고 server와 web 타입 검사가 통과했습니다.
- `npm run build`는 exit 0이었고 Vite가 194개 module을 변환해 `dist/web` 자산을 생성했습니다. Vite 8의 향후 native config loader와 관련된 기존 JSON import attribute·확장자 경고는 출력됐지만 빌드는 통과했습니다.
- 소유 source·test·report 8개 파일의 tab, trailing whitespace와 Markdown code fence 짝을 검사한 Python 명령은 exit 0이었고 `validated 8 files`를 출력했습니다.

## 독립 검토 fix round 1

- client runtime codec 회귀를 먼저 추가했습니다. `npm test -- tests/unit/web/client.test.ts`는 exit 1이며 8개 중 2개가 실패했습니다. M-008·M-010·M-012의 `value: null`이 성공으로 해석됐고 M-047의 `questions: [null]`, `decisions: [{}]`가 query 결과로 해석된 것이 기대한 RED 원인이었습니다. 현재 UI가 소비하는 QuestionView와 DecisionView의 필수 필드·중첩 결과를 좁혀 검사한 뒤 같은 명령은 exit 0이며 8개가 통과했습니다. 명령 응답의 잘못된 성공 payload는 `TransportUncertainError`로 남겨 같은 idempotency key를 다시 확인할 수 있고, query의 잘못된 payload는 렌더 전에 거절합니다.
- 지연 응답과 종료 상태 회귀를 먼저 추가했습니다. `npx playwright test tests/e2e/question-decision.spec.ts --project=chromium --grep '409와|답변 저장 응답|결정 저장 응답|후속 질문 저장 응답'`은 exit 1이며 4개가 모두 실패했습니다. answered·confirmed 최신 기준에서 지원되지 않는 계속 작성 동작이 노출됐고, 지연 성공 뒤 dirty 입력은 남았지만 실제 최신 revision과 새 후속 질문을 M-047로 갱신하지 못한 것이 기대한 RED 원인이었습니다. 이전 시도가 Committed 또는 Replayed이면 dirty 입력을 보존하면서 `onSaved`로 최신 상세와 workspace를 다시 읽도록 고친 뒤 같은 명령은 exit 0이며 4개가 통과했습니다.
- 최종 `npx playwright test tests/e2e/question-decision.spec.ts --project=chromium`은 exit 0이며 11개가 통과했습니다. 지연된 답변·결정 성공 뒤 최신 revision과 `latestServer`, 지연된 후속 질문 성공 뒤 실제 생성된 질문 표시, dirty 입력 보존과 종료 상태의 제한 안내를 실제 HTTP와 브라우저에서 확인했습니다.
- `npx tsc -p tsconfig.web.json --noEmit`은 exit 0이었습니다. `npm run build`도 exit 0이며 Vite가 194개 module을 변환했습니다. 기존 native config loader 관련 경고만 출력됐습니다.
- 최신 `npm run typecheck`는 exit 1이었습니다. 병행 CG-13 코드의 `tests/contract/claude-provider.test.ts:239`, `tests/contract/claude-provider.test.ts:266`, `tests/contract/claude-provider.test.ts:294`에서 각각 ProviderRequest narrowing 1건과 `ClaudeCliProviderOptions`의 `projectRoot` 관련 2건이 발생했습니다. 이번 UI·client 소유 파일 오류는 없었습니다. CG-13 동결 뒤 전역 타입 검사는 root가 닫습니다.
- client 변경 뒤 질문·결정 전체 E2E가 M-047과 M-008·M-010·M-012의 실제 HTTP 응답을 다시 검증했습니다. 첫 동결에서 통과한 기존 상세·SOURCE 6개 grep 검사는 이 round에서 반복하지 않았습니다.
- 현재 소유 source·test·report 10개 파일의 tab, trailing whitespace와 Markdown code fence 짝을 검사한 Python 명령은 exit 0이었고 `validated 10 files`를 출력했습니다.

## 남은 연결과 제한

질문의 해결·결정 전환·재분류와 answered 질문의 새 답변 version은 CG-16 범위입니다. 이 UI의 첫 답변은 answered로 표시하며 사람의 별도 해결 확인 없이 resolved로 표시하지 않습니다. Artifact 편집·버전 비교·생성 초안 검토 UI와 전체 acceptance 검증은 후속 CG-09 범위에서 이어집니다.

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 이 부분 구현에는 N/A입니다.
