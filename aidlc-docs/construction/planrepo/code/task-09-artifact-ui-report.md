# CG-09 ArtifactWorkspace·VersionComparison 부분 구현 보고

CG-09 전체 중 UI-12의 일반 문서 편집과 UI-14의 고정 문서 version 비교를 구현했습니다. WorkflowPlan 전용 편집과 DraftReview는 이 부분의 범위가 아닙니다.

## 구현한 경계

- `src/web/components/ArtifactWorkspace.tsx`는 요구사항, application·functional·nfr·infrastructure 설계와 구현 계획을 M-015로 새로 만들거나 개정합니다. 진행 계획은 현재 원문과 이전 version 비교만 제공하며 전용 구조 편집이 준비되지 않았음을 제품 문구로 안내합니다.
- 문서 원문, 안정 section ID, 요구사항 ID, 연결 section, 줄 단위 수용 기준, 변경 사유와 현재 질문 결과·결정·SOURCE version 참조를 별도 입력으로 제공합니다. JSON blob을 편집 입력으로 사용하지 않습니다.
- 현재 SR owner에게만 저장 폼을 제공하며 다른 멤버는 원문·구조·작성자·사람 작성 또는 AI 초안 적용 origin·version을 읽습니다. 서버는 M-015 안에서 실제 멤버십, owner, targetBasis와 revision guard를 다시 검사합니다.
- `src/domain/artifact-rules.ts`의 browser-safe `deriveArtifactSectionIndex`는 사람이 고른 section ID에 대응하는 실제 Markdown level-2 heading에서 제목과 원문 offset을 계산합니다. 인용문과 code fence 안의 표기는 section heading으로 사용하지 않습니다. UTF-8 크기 검사는 Node 전용 Buffer 대신 같은 byte 의미의 TextEncoder를 사용합니다.
- `src/web/components/VersionComparison.tsx`는 M-016이 반환한 고정 before·after 원문과 변경 요구사항, 결정 ref, section ID를 함께 표시합니다. 조회 중 현재 문서 version이 바뀌면 이전 pair의 늦은 응답을 조회 순번으로 폐기합니다.
- `src/web/components/SRDetail.tsx`는 요구사항, 진행 계획·설계, 구현 계획 탭을 연결합니다. 탭 패널을 mounted 상태로 유지해 저장하지 않은 문서 입력을 탭 왕복 중 보존합니다. actor·SR·논리 대상별 component key와 FormDraft identity를 분리합니다.
- 문서 저장은 FormDraft와 CommandSession으로 제출 input, guard와 idempotency key를 고정합니다. 409 뒤 최신 M-047 기준을 별도로 표시하고 작성 중 원문을 유지한 채 기준을 채택하거나 편집을 폐기합니다. 지연된 Committed·Replayed 결과가 도착하면 새 dirty 입력을 보존하고 M-047·M-045를 다시 읽습니다. 전송 결과가 불명확하면 같은 idempotency key로 확인합니다.
- `src/web/api/client.ts`는 현재 UI가 소비하는 ArtifactView, WorkflowPlanView와 ArtifactDiffView를 runtime에서 검사합니다. 잘못된 M-015·M-017 성공 payload는 TransportUncertainError로 처리하고 잘못된 M-016·M-047 query payload는 렌더 전에 거절합니다.

## TDD 근거

- `npm test -- tests/unit/web/client.test.ts`의 첫 실행은 exit 1이며 10개 중 신규 2개가 실패했습니다. M-015의 null value와 M-016의 malformed before·after가 성공으로 해석된 것이 기대한 RED 원인이었습니다. artifact runtime codec을 추가한 뒤 같은 명령은 exit 0이며 10개가 통과했습니다.
- `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium`의 첫 실행은 exit 1이며 5개가 모두 실패했습니다. 요구사항·진행 계획·설계·구현 계획 탭이 비활성이라 click이 timeout된 것이 실제 UI 부재 RED였습니다. 수집 가능한 탭과 최소 화면을 연결한 다음 저장·생성·비교·충돌·지연 행동을 순차 구현했습니다.
- offset 입력 제거와 원문 계산 회귀를 추가한 `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium --grep '수용 기준의 쉼표|비교 중 문서 version|owner가 요구사항'`은 exit 1이며 3개 중 2개가 실패했습니다. 시작 offset 입력이 노출된 것이 기대한 RED 원인이었습니다. 제목과 offset을 원문 heading에서 계산하고 수용 기준을 줄바꿈으로만 나눈 뒤 같은 3개 검사는 통과했습니다.
- 늦은 비교 응답 검사는 실제 response 완료를 기다리도록 고정했습니다. 기존 구현으로 `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium --grep '비교 중 문서 version'`을 실행한 결과 exit 1이며 1개가 실패했고, version이 바뀐 뒤에도 이전 v1 비교가 한 건 남았습니다. 조회 순번을 추가한 뒤 최종 artifact E2E에서 통과했습니다.
- 저장 결과의 ReviewImpact 표시 assertion은 처음 exit 1이었고 저장된 화면에 G1·G2 영향이 없었습니다. 확정 M-015 결과의 검토 영향만 `이번 저장 결과`로 표시하고 같은 revision의 뒤늦은 M-047가 이 결과를 덮지 않게 한 뒤 통과했습니다. M-047 ArtifactView의 기본 no-impact 값은 현재 인계나 검토의 유효성 근거로 사용하지 않습니다.
- 영향받는 기존 상세 검사 첫 실행은 exit 1이며 6개 중 2개가 실패했습니다. hidden 상태로 보존한 문서 폼의 “변경 이유”가 기존 설명 폼 locator와 충돌한 것이 원인이었습니다. 문서 필드 이름을 “문서 개정 사유”로 분리한 뒤 같은 영향 검사 6개가 통과했습니다.

## 독립 검토 fix round 1

- `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium --grep 'owner가 요구사항|owner가 아닌|채택하지 않고 폐기'`의 수정 전 첫 실행은 exit 1이며 3개가 실패했습니다. 저장 뒤 `이번 저장 결과: 검토 영향 G1, G2`가 없었고, 읽기 화면은 근거 없이 `인계 유효`와 `현재 검토 유지`를 표시했습니다. 직접 폐기 검사는 최초 fixture의 요구사항 ID가 Markdown과 맞지 않아 입력 검증에서 실패했으므로 이 실행을 폐기 회귀의 RED로 세지 않았습니다.
- fixture를 바로잡은 `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium --grep '채택하지 않고 폐기'`은 exit 1이며 1개가 실패했습니다. 409 뒤 최신 v2를 읽고도 직접 폐기하면 기대한 v2 원문 대신 snapshot의 v1 원문으로 돌아간 것이 기대한 행동 RED였습니다.
- ArtifactEditor는 최신 서버 기준이 있으면 `discardToLatest`로 원문과 guard를 함께 복원합니다. 조회 header는 문서 작성 origin만 표시하고 현재 인계 유효성을 추정하지 않습니다. 성공한 M-015의 ReviewImpact는 조회 상태와 분리한 `이번 저장 결과`로 표시합니다.
- 수정 뒤 `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium --grep 'owner가 요구사항|owner가 아닌|채택하지 않고 폐기'`은 exit 0이며 3개가 통과했습니다. 직접 폐기 뒤 v2 원문을 복원하고 그 기준으로 v3를 저장하는 실제 HTTP 경로, 인계 없는 조회에서 허위 유효 문구가 없는 경로, 저장 결과의 G1·G2 영향 표시를 확인했습니다.

## 최종 검증

- fix round 1 뒤 `npx playwright test tests/e2e/artifact-workspace.spec.ts --project=chromium`은 exit 0이며 10개가 통과했습니다. 요구사항 개정, 구현 계획 개정, functional 설계 신규 작성, owner 권한, 원문 기반 구조, 쉼표 보존, 고정 비교, 늦은 비교 폐기, 409 직접 폐기와 지연 저장을 실제 TestApp HTTP와 브라우저에서 확인했습니다.
- `npx playwright test tests/e2e/artifact-workspace.spec.ts tests/e2e/question-decision.spec.ts --project=chromium`은 exit 0이며 20개가 통과했습니다. 문서 탭 연결 뒤 질문·결정, 설명·SOURCE와 각 dirty 입력 보존을 함께 확인했습니다.
- `npx playwright test tests/e2e/ui/base.spec.ts --project=chromium --grep '직접 등록한 SR|설명 변경은|설명 충돌 뒤|상세 조회 오류|SOURCE 저장 직후|Markdown 근거'`는 exit 0이며 6개가 통과했습니다.
- `npm test -- tests/unit/web/client.test.ts tests/unit/web/artifact-structure.test.ts tests/unit/artifact-rules.test.ts`는 exit 0이며 3개 파일의 23개가 통과했습니다.
- `npx tsc -p tsconfig.web.json --noEmit`은 exit 0입니다.
- 중간 `npm run typecheck`는 병행 작성 중이던 `tests/integration/question-decision.test.ts:276`, `tests/integration/question-decision.test.ts:278`, `tests/integration/question-decision.test.ts:287`의 미정의 지역 변수 3건으로 exit 1이었습니다. fix round 1 뒤 다시 실행한 `npm run typecheck`는 exit 0이며 server와 web 검사가 모두 통과했습니다.
- fix round 1 뒤 `npm run build`는 exit 0입니다. Vite는 198개 module을 변환했습니다. 기존 native config loader 관련 JSON import attribute·확장자 경고는 출력됐습니다.
- fix round 1은 UI component와 E2E만 바꿨으므로 이미 통과한 unit codec·구조 검사와 질문·결정 E2E는 반복하지 않았습니다.
- 소유 source·test·report 10개 파일의 tab, trailing whitespace와 Markdown code fence 짝을 검사한 Python 명령은 exit 0이며 `validated 10 files`를 출력했습니다.

## 남은 연결

WorkflowPlan의 단계 선택·생략 이유·요구사항별 task와 verification 편집은 전용 화면 범위입니다. 사람 검토 초안의 비교·적용은 저장 초안 조회 계약을 사용하는 DraftReview 범위입니다. 이 보고서는 CG-09 전체 완료를 표시하지 않습니다.

Security Baseline, Resiliency Baseline, Property-Based Testing 확장은 `aidlc-docs/aidlc-state.md`에서 비활성화돼 이 부분 구현에는 N/A입니다.
