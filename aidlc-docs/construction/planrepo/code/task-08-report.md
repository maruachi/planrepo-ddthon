# CG-08 구현·검증 보고

## 공통 화면 상태 모듈

이 보고는 상태 모듈과 AppShell·등록·상세·SOURCE UI, HTTP client, Playwright fixture, 독립 production·dev 실행 검증을 기록합니다. M-006/M-007 SOURCE 연결까지 구현했으며 SOURCE fix2 독립 재검토를 통과했습니다. 전역 typecheck의 병행 CG09 오류는 별도 추적합니다.

- `QueryCoordinator`는 actor·project·SR·target·method로 key를 구분하고 key별 발행 seq를 증가시킵니다. 현재 활성 key의 최신 seq와 모두 일치하는 응답만 수락합니다.
- `CommandSession`은 target·actor·scope·command·input·guard·idempotencyKey를 deep snapshot합니다. 처리 중 같은 제출과 결과 확인 재전송은 같은 key를 사용하고, 편집한 명시 제출은 새 key를 받습니다. 이전 scope나 target의 늦은 결과는 이력에 남기되 현재 폼 적용 여부를 false로 반환합니다. Committed receipt와 Replayed의 priorReceipt/current는 다른 결과 타입으로 유지합니다.
- `FormDraft`는 identity·input·편집 basis·field errors를 서버 view와 분리합니다. dirty 입력은 조회 갱신으로 덮지 않으며 명시적인 저장 확정이나 폐기에서만 clean 상태로 바뀝니다.

## 공통 화면과 실제 HTTP 연결

- AppShell은 M-002로 저장된 가상 사용자를 현재 프로젝트 멤버십에서 다시 검증한 뒤 M-001과 M-045를 조회합니다. actor 전환 즉시 이전 actor의 조회 ticket을 무효화하고 이전 workspace·board view를 화면에서 내립니다. 팀 보드·내 검토함·SR 목록·팀 설정 메뉴와 브라우저 context별 사용자 저장소를 연결했습니다.
- 팀 보드는 phase, G1/G2 validity, 검토 상태를 서로 다른 표시로 유지합니다. M-047 상세도 phase, gate, 검토 묶음, 승인 영역을 합치지 않습니다. 현재 상세 DTO에 승인 행이 없어 승인 성공을 추정하지 않습니다.
- 등록 폼은 M-003 직접 등록과 M-004 Mock 키 가져오기를 실제 HTTP로 호출합니다. 설명 폼은 현재 SR revision을 가진 `RevisionGuard<'sr'>`로 M-005를 호출합니다. 재조회 중에도 폼을 unmount하지 않아 dirty 입력과 저장 결과를 보존합니다.
- HTTP client는 method별 actor·scope·input·guard 타입을 유지합니다. M-002는 actor header 없이 호출합니다. 명령 제출은 `CommandSession`의 idempotency key를 사용하며, 성공 status 뒤 envelope나 M-042 metadata를 복원하지 못한 경우 결과 확인 필요 상태로 전환합니다. M-042는 별도 Markdown bytes와 base64url command metadata를 복원합니다.
- 현재 설명 Markdown은 `react-markdown`과 `rehype-sanitize`를 사용합니다. E2E에서 event handler가 든 HTML이 DOM이나 전역 상태로 실행되지 않음을 확인했습니다.
- Playwright fixture는 SHA-256 기반 testRunId, DEMO-4 실제 SQLite, 예약 loopback listener, `serveWeb:true`, 읽기 전용 manifest를 사용합니다. 다섯 persona context는 같은 앱과 DB를 쓰되 브라우저 저장소를 공유하지 않으며 테스트 안에서 모두 닫습니다.

## TDD와 검증 근거

- 첫 `npm test -- tests/unit/web/query-coordinator.test.ts tests/unit/web/command-session.test.ts tests/unit/web/form-draft.test.ts`는 세 모듈이 없어 3개 suite가 import 단계에서 실패했습니다.
- API stub 뒤 같은 명령에서 11개 행동 테스트가 `not implemented`로 실패해 행동 RED를 확인했습니다.
- 최소 구현 뒤 target 전환 RED 1개를 추가로 확인했습니다. 최종 같은 명령은 exit 0이었고 3개 파일의 13개 테스트가 통과했습니다.
- `npm run typecheck`는 test literal의 command widening을 바로잡은 뒤 exit 0이었습니다.

## UI TDD와 현재 검증 근거

- 첫 E2E 실행은 TestApp 전이 경로의 JSON import attribute가 없어 테스트 수집 전에 실패했습니다. 이는 행동 RED로 세지 않았고 CG-06 소유 경로가 보정된 뒤 `playwright test --list`와 fixture 준비가 통과했습니다.
- 최소 HTML 진입점 뒤 `npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1`은 M-001 preflight가 성공하고 없는 `navigation`을 기다리다 exit 1이었습니다. AppShell 구현 뒤 같은 기본 테스트는 GREEN이었습니다.
- 등록·가져오기·설명·persona 격리를 추가한 첫 실행은 5개 중 3개가 통과했습니다. Mock 테스트의 selector 모호성은 테스트 준비 오류로 고쳤습니다. 설명 저장은 재조회 중 폼을 unmount해 성공 상태를 잃는 행동 RED였고 상세 화면을 유지하도록 고친 뒤 GREEN이었습니다.
- dirty 설명을 둔 채 `최신 상태 확인`을 누르는 행동은 버튼이 없어 RED였습니다. 명시 재조회와 입력 보존을 연결한 뒤 targeted 테스트가 GREEN이었습니다.
- command의 malformed 200 body를 주입한 테스트는 결과 확인 안내가 없어 RED였습니다. `TransportUncertainError` 경계를 보완한 뒤 안내와 dirty 입력 보존이 GREEN이었습니다. 결과 확인 전 제목을 편집한 뒤 재시도한 두 번째 RED는 새 idempotency key를 보냈습니다. 확인 callback이 최초 frozen attempt를 `CommandSession.retry`로 재전송하도록 고쳐 두 HTTP 요청의 key 일치와 후속 편집 보존을 확인했습니다. 설명 변경도 같은 frozen-attempt 재확인 경계를 사용합니다.
- 이 단계의 `npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1`은 당시 실제 브라우저 테스트 6개가 모두 통과했습니다. 직접 등록 결과는 별도 M-045로, 설명 저장 결과는 별도 M-047로 다시 읽었습니다. 이후 실행 검증에서 발견한 회귀 테스트 1개를 더해 최종 7개가 통과했습니다.
- actor 전환 때 이전 view를 즉시 내리는 마지막 변경 뒤 영향받는 기본 화면과 다섯 context 테스트 2개를 `--grep '가상 사용자|다섯 가상'`으로 다시 실행했고 모두 통과했습니다.
- 최종 `npm run typecheck`는 exit 0이었습니다. `npm run build`도 서버와 웹 bundle을 생성하고 exit 0이었습니다. Vite는 향후 native config loader에서 지원하지 않을 JSON import attribute와 확장자 없는 import 경고를 출력했습니다. 현재 빌드는 통과했습니다. 이후 dev 실행 RED의 원인을 고치기 위해 승인된 범위에서 `vite.config.ts`의 proxy 경계만 수정했습니다.
- 상태 모듈은 이 UI 변경에서 수정하지 않았습니다. 앞서 통과한 3개 파일 13개 단위 테스트 근거를 재사용해 같은 테스트를 반복하지 않았습니다.

## production·dev 실행 검증

- production 검증은 `PLANREPO_MODE=test`, testRunId `cg08-prod-0909-a1f4c2`, backend port 24381, dev port 25381만 사용했습니다. `npm run db:migrate`와 `npm run seed:demo`를 별도로 실행해 모두 exit 0을 확인했습니다. `/health/ready`는 `ready=true`, `generationReady=false`, `code=READY`였습니다.
- `npm start`의 실제 정적 앱에서 DEMO-4 보드와 상세를 열고 `PROD-IMG-801`을 UI로 등록했습니다. 서버 재시작 뒤에도 이 카드를 보드에서 조회하고 상세로 이동했습니다. 새 페이지 조회로 지속성을 확인했으며 state 기반 상세에는 URL route가 없으므로 상세에서 reload하면 보드로 돌아갑니다. 이를 상세 heading 유지로 잘못 검사해 발생한 timeout은 제품 RED로 세지 않았습니다.
- production 원문에 `![외부 이미지](https://example.invalid/private.png)`를 넣었을 때 브라우저가 외부 URL을 요청해 실제 검사가 exit 1이었습니다. 같은 행동을 E2E에 옮겨 `<img>` 1개와 외부 요청을 확인한 뒤 `SafeMarkdown`이 이미지 구문을 비요청 텍스트 참조로 표시하도록 고쳤습니다. targeted E2E와 production 재검증에서 `<img>` 0개, 외부 요청 0개였습니다.
- production에서 초기 M-045가 끝나기 전에 현재 P-01을 다시 선택하면 보드 ticket을 잃고 계속 loading에 머무는 race를 확인했습니다. 지연된 M-045 E2E가 RED였고 같은 actor 선택을 no-op으로 처리해 GREEN으로 바꿨습니다.
- 화면 캡처에서 담당자 내부 ID가 노출되는 RED를 확인했습니다. M-001의 `DemoActorView.displayName`을 보드·목록·상세에 사용하며 lookup 실패도 내부 ID를 표시하지 않습니다. 390px에서는 상세 header가 세로 배치되어 phase 카드가 제목과 폭을 다투지 않습니다. sidebar의 가상 사용자 label은 어두운 배경에서 밝은 색으로 고정했습니다.
- production 캡처는 `.planrepo/test-runs/cg08-prod-0909-a1f4c2/screenshots/production-board-1440x900.png`, `production-detail-1440x900.png`, `production-detail-390x844.png`입니다. 캡처 뒤 DOM·HTTP 검사를 별도로 통과했으며 이미지 자체만으로 수용 통과를 주장하지 않습니다.
- dev 검증은 testRunId `cg08-dev-0909-b2d5e3`, backend port 24382, Vite port 25382에서 별도 migrate·seed 뒤 `npm run dev`로 실행했습니다. backend ready와 Vite `/`는 200이었고 Vite를 통한 M-001은 원래 dev Origin으로 200 JSON을 반환했습니다. config와 root 밖 `/@fs` 경로, 잘못된 Host·Origin은 모두 403이었습니다.
- 첫 dev 브라우저는 HMR에 연결됐지만 `src/web/api/client.ts`가 Vite URL `/api/client.ts`가 되어 넓은 `/api` proxy에 잡히고 backend 404를 받아 App이 mount되지 않았습니다. `vite.config.ts`의 proxy key를 `^/api/methods(?:/|$)`로 좁혔습니다. 수정 뒤 `/api/client.ts`는 200 `text/javascript`, M-001은 200 JSON이었고 `/api/methodsX/...`는 backend가 아닌 Vite HTML로 처리됐습니다.
- 실제 브라우저에서 App mount, M-001 proxy, `ws://127.0.0.1:25382` HMR WebSocket과 `connected` frame을 확인했습니다. 실행 중 source/config 변경에는 Vite가 component HMR update와 server restart를 기록했습니다. 두 번째 Vite를 같은 port로 시작한 명령은 `Port 25382 is already in use`로 exit 1이어서 strictPort를 확인했습니다.
- `npm run dev` 부모에 SIGINT를 보낸 결과 exit 0이었고 backend/Vite port가 모두 비었으며 dev DB의 `runtime_instances`는 0개였습니다.
- production을 처음 종료할 때 PTY Ctrl-C와 process-group SIGINT를 사용해 npm과 서버 자식에 동시에 신호가 전달됐습니다. listener는 내려갔지만 격리 production DB에 runtime 행 5개가 남았고 이 진단 자료를 직접 삭제하지 않았습니다. 이후 새 `npm start`의 실제 `node dist/server/main.js` 자식 PID 하나에만 SIGINT를 보내 npm exit 0을 확인했습니다. runtime 행 수는 시작 전후 5개로 같아 이 종료가 새 활성 등록을 남기지 않았고 port 24381도 비었습니다. 일반 `.planrepo/data`는 사용하거나 수정하지 않았습니다.

마지막 UI·Vite 수정 뒤 전체 E2E는 7개가 통과했고 `npm run typecheck`와 `npm run build`는 exit 0이었습니다. build는 앞서 기록한 Vite native config loader 경고를 계속 출력합니다.

이 시점에는 CG-08 전체 완료와 Step 043~048 완료를 표시하지 않았고 M-006/M-007 SOURCE UI가 남아 있었습니다. 아래 SOURCE 연결에서 구현과 통합 재검증을 추가했습니다.

## 독립 검토 fix round 1

- 닫은 등록 폼의 M-003 응답을 지연한 뒤 actor를 P-02로 바꾸고 응답을 release하는 E2E를 추가했습니다. 최초 실행은 이전 P-01 callback이 상세 화면을 강제로 열어 `PlanRepo` 보드 heading을 찾지 못해 1개가 실패했습니다. 등록·설명 폼은 await 뒤에도 같은 컴포넌트가 mount된 경우에만 session·feedback·`onSaved`를 적용합니다. 서버가 확정한 명령 자체를 취소나 실패로 표시하지 않습니다. targeted 재실행은 1개가 통과했습니다.
- M-045의 첫 503과 M-047의 최초·갱신 503을 실제 HTTP 경계에서 주입했습니다. 최초 실행은 보드 loading이 남고 상세에는 alert가 없어 2개가 실패했습니다. board와 detail은 각 query ticket의 seq가 여전히 현재일 때만 성공이나 오류를 반영합니다. 오류에서 loading을 내리고 같은 actor·SR 재시도와 상세 뒤로가기를 제공합니다. 저장하지 않은 설명은 상세 갱신 실패에도 남습니다. targeted 재실행은 2개가 통과했습니다.
- `CommandSession`의 같은 attempt에 `beginExecution`/`endExecution` 점유를 추가했습니다. 최초 단위 테스트는 없는 메서드 호출로 1개가 실패했고 수정 뒤 7개가 통과했습니다. 실제 브라우저에서는 빠른 등록 저장 두 번이 M-003 HTTP 한 번만 만들었고, 불명확 결과의 `같은 요청 확인` 두 번도 같은 key의 재요청 한 번만 만들었습니다.
- browser client가 `{kind:'Committed',value:null,receipt:{}}`와 빈 Replayed current를 정상 결과로 받는 단위 RED를 추가했습니다. 최초 실행은 5개 중 malformed 4개가 모두 잘못 resolve했습니다. 현재 화면이 소비하는 M-001~M-005·M-045·M-047 value와 `CommandReceipt`·`CurrentBasis`의 필수 구조를 runtime에서 검사합니다. command의 형식 불명확은 session을 resolve하기 전에 `TransportUncertainError`가 되어 같은 key 확인 경로를 유지합니다. 수정 뒤 client 테스트 5개가 통과했습니다.

최종 영향 검증은 `npm test -- tests/unit/web/client.test.ts tests/unit/web/command-session.test.ts` 12개 통과, `npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1` 11개 통과, `npm run typecheck` exit 0, `npm run build` exit 0입니다. build는 기존 Vite native config loader 경고를 계속 출력했습니다. SOURCE UI는 이 fix에 포함하지 않았습니다.

## SOURCE UI 연결

- 최초 link 등록 E2E는 `근거 종류` 입력이 없어 timeout으로 RED였습니다. `SourcePanel`은 text·Markdown·link의 정확한 `SourceInput`을 만들고, M-006에 폼이 읽은 SR revision guard를 보냅니다. displayName·provenance와 link의 targetUrl·verifiable·observedExternalVersion·unavailableReason를 구분합니다. 등록은 항상 사람 확인 전 상태로 표시합니다.
- `verifiable`은 `확인 가능`/`확인 불가`, 사람의 confirmation은 `사람 확인 전`/`사람 확인 완료`로 별도 표시합니다. link URL은 자동 fetch·embed·image를 만들지 않고 텍스트로 표시합니다. Markdown source는 `SafeMarkdown`을 사용하며 이미지 구문 E2E에서 `<img>` 0개와 외부 요청 0개를 확인했습니다.
- M-007 owner·권한·stale 묶음의 최초 실행은 확인 입력이 없어 4개 중 3개가 timeout으로 RED였고, M-006 dirty refresh는 기존 `FormDraft` 경계로 통과했습니다. source별 확인 폼은 정확한 `currentVersionRef`와 source revision을 basis로 유지해 `RevisionGuard<'context_source'>`와 `confirmationEvidence`를 보냅니다. confirmedBy·confirmedAt은 입력하지 않고 서버 응답을 actor 표시 이름과 함께 읽습니다.
- non-owner의 실제 403과 동시 source version 변경의 `STALE_VERSION`은 작성한 확인 근거를 보존합니다. 서로 다른 source의 draft/session은 sourceId로 분리됩니다. 상세 재조회는 dirty source 입력과 읽은 basis를 덮지 않습니다. 다른 M-006이 SR revision을 올린 뒤 재조회한 E2E에서도 작성 중 입력과 최초 expectedRevision을 유지해 서버의 stale 거절을 받았습니다.
- 빠른 M-006/M-007 두 번 클릭은 각 attempt당 HTTP 한 번만 실행했습니다. pending M-006 중 상세를 닫고 actor를 바꾼 테스트는 서버 확정 source를 M-047에서 확인하면서도 이전 callback이 새 actor 화면을 바꾸지 않음을 검증했습니다.
- browser client의 M-006 null value 단위 테스트는 처음 6개 중 1개가 잘못 resolve해 RED였습니다. M-006/M-007 결과를 실제 `ContextSourceView` 구조로 검사하며 malformed 200은 `TransportUncertainError`가 됩니다. 실제 SOURCE 폼의 malformed 200 E2E는 입력을 확정하지 않고 같은 idempotency key 확인으로 복구했습니다.
- CG-07 URL fix 전 한 차례 `npm run typecheck`가 `src/domain/source-url.ts`의 작성 중 `node:url` 오류로 중단됐습니다. shared 파일을 수정하지 않았고 CG-07 fix 안정화 뒤 같은 명령이 exit 0이었습니다. userinfo가 든 HTTPS URL의 실제 400 E2E도 서버 오류와 source 입력 보존을 확인했습니다.

최종 검증은 `npm test -- tests/unit/web/query-coordinator.test.ts tests/unit/web/command-session.test.ts tests/unit/web/form-draft.test.ts tests/unit/web/client.test.ts` 20개 통과, `npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1` 22개 통과, `npm run typecheck` exit 0, `npm run build` exit 0입니다. build는 기존 Vite native config loader 경고를 계속 출력했습니다. 독립 검토와 root의 완료 추적 전까지 CG-08 전체 완료 checkbox는 표시하지 않습니다.

## SOURCE 독립 검토 fix round 2

- dirty `FormDraft`가 최신 서버 view를 비교 후보로 저장하고 같은 actor·scope·target·form에서만 명시적인 기준 채택이나 입력 폐기를 허용하도록 확장했습니다. 세 단위 테스트는 `latestServer`, `adoptLatestBasis`, `discardToLatest`가 없어 3개 RED였고 최소 구현 뒤 7개가 통과했습니다. 기준 채택은 입력과 dirty 상태를 유지하며 필드 오류만 지웁니다. 자동 guard 교체나 자동 재전송은 하지 않습니다.
- SOURCE 추가 충돌 E2E는 다른 M-006이 SR revision을 올린 뒤 최초 제출이 `STALE_VERSION`으로 거절됨을 먼저 확인합니다. 최신 상세의 SR revision을 화면에 표시하고 사용자가 `최신 SR 기준으로 계속 작성`을 선택한 뒤에도 Markdown 본문을 유지했습니다. 두 번째 명시 제출은 최신 revision과 첫 제출과 다른 idempotency key를 사용해 저장됐습니다.
- 설명 편집도 같은 공통 경계를 사용합니다. 다른 M-005가 먼저 저장한 최신 제목·목적·설명을 비교 영역에 표시합니다. 사용자가 최신 설명 기준을 채택하면 작성 중 설명과 변경 이유를 보존하고, 새 revision과 새 idempotency key로 다시 저장합니다. SOURCE와 설명 모두 최신 서버 입력으로 명시 폐기하는 버튼을 제공합니다.
- 다른 요청이 source를 이미 확인한 경우 서버의 실제 확인자·시각·근거를 항상 표시합니다. 동시에 남은 로컬 확인 근거는 `작성 중인 확인 근거`로 분리해 보여 주며 새 확인으로 제출할 수 없습니다. 사용자가 명시적으로 폐기할 때만 로컬 입력을 닫고 서버 확인 기록은 그대로 둡니다.
- M-006 성공 직후 M-047 재조회가 지연되는 동안 다음 근거를 작성하는 E2E를 추가했습니다. 늦은 상세 응답은 다음 입력을 덮지 않고 최신 basis 후보를 제공했습니다. 사용자가 이를 채택한 다음 제출은 stale 없이 저장됐습니다.

RED는 네 실제 브라우저 시나리오 모두 명시 비교·채택·폐기 UI가 없어 실패한 결과였습니다. 수정 뒤 같은 targeted 실행은 4/4가 통과했습니다. 최종 영향 검증은 `npm test -- tests/unit/web/query-coordinator.test.ts tests/unit/web/command-session.test.ts tests/unit/web/form-draft.test.ts tests/unit/web/client.test.ts` 23/23, `npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1` 24/24, `./node_modules/.bin/tsc -p tsconfig.web.json --noEmit` exit 0, `npm run build` exit 0입니다. build는 기존 Vite native config loader 경고를 출력했습니다. 전체 `npm run typecheck`은 동시에 작성 중인 CG-09의 application/persistence 파일 오류로 exit 2였으며 CG-08 파일 오류는 없었습니다. root가 실제 동결 파일 7개의 diff를 승인된 선행 snapshot과 비교했습니다. 명시 기준 채택과 dirty 입력·확인 기록 분리를 검토했고 새로운 Critical/Important는 없습니다. CG08 Step043–048을 체크했습니다. 병행 CG09의 전역 typecheck 오류를 CG08 통과로 숨기지 않습니다.
