# U1 코드 생성 계획

상태: 코드 계획 Q1 B와 코드 산출물 Q1 B 승인 완료. Steps 1–21 완료, U2로 인계했다.

이 문서는 U1 Code Generation 실행 순서와 체크박스의 단일 기준이다. 작업공간은 /Users/dgyim/works/planrepo-ddthon이며, 하나의 로컬 앱 안에 기능별 모듈을 두는 Greenfield 프로젝트다. 계획 작성 당시 앱 코드·package.json은 없었으며 승인 후 아래 경로에 구현했다. 기존 README.md 삭제, requirements/, AGENTS.md, 규칙 파일과 .obsidian/ 등 사용자 변경을 보존한다.

## 승인 근거와 준비 상태

- [요구사항](../../inception/requirements/requirements.md), [스토리](../../inception/user-stories/stories.md), [페르소나](../../inception/user-stories/personas.md), [실행 계획](../../inception/plans/execution-plan.md)은 승인됐다.
- [단위 정의](../../inception/application-design/unit-of-work.md), [의존성과 인계](../../inception/application-design/unit-of-work-dependency.md), [수용 기준 배정](../../inception/application-design/unit-of-work-story-map.md)을 따른다. U1의 선행 구현 단위는 없다.
- [도메인](../sr-document-foundation/functional-design/domain-entities.md), [업무 규칙](../sr-document-foundation/functional-design/business-rules.md), [처리 모델](../sr-document-foundation/functional-design/business-logic-model.md), [화면](../sr-document-foundation/functional-design/frontend-components.md)은 Q1 B 승인됐다.
- [NFR 요구사항](../sr-document-foundation/nfr-requirements/nfr-requirements.md), [기술 선택](../sr-document-foundation/nfr-requirements/tech-stack-decisions.md), [설계 패턴](../sr-document-foundation/nfr-design/nfr-design-patterns.md), [논리 컴포넌트](../sr-document-foundation/nfr-design/logical-components.md)도 Q1 B 승인됐다. NFR Design 승인은 사용자 채팅 “승인 후 진행”으로 기록했다.

계획 작성의 선행 조건은 충족했다. 정확한 패키지 버전·네이티브 SQLite 로딩·실행 경로·브라우저 동작은 아래 구현 단계에서 확인할 환경 사실이다. 현재 설치된 Node가 최신이라는 가정이나 실행 성공 주장을 하지 않는다.

## U1 범위와 인계

SR 직접 입력, 고정 6열 보드와 상세, 문서·과거 버전·사건 조회, 편집·비교·복원, SQLite 저장과 공통 앱 실행 기반을 구현한다. 주 담당 스토리는 US-01/06/07/08/09/10이며 US-02의 보드·상세 기반을 제공한다. 작성자 역할로 U1을 실행하고 리뷰어 역할 선택은 U3에서 연결한다.

U2가 사용할 prepareGenerated는 문서 변경을 준비하고 자체 커밋하지 않는다. U1은 Run 테이블·CLI 호출·단계/회차·질문/결정을 구현하지 않는다. U3의 Review·역할 전환·수동 완료도 해당 단위에서 연결한다. SR 생성 시 문서는 0개이며 첨부를 계획 문서로 자동 복제하지 않는다.

U1 소유 테이블은 srs, documents, document_versions, history_events, event_version_refs, command_receipts의 6개다. run_id는 선택적 연결 자리이며 실제 Run 소속 FK는 U2 마이그레이션 책임이다. U2/U3는 동일 C09 저장 경계를 확장하고 U1에서 저장한 데이터를 보존해야 한다.

## 순차 실행 체크리스트

총 21개 추적 단계다. 1–5는 계획과 승인, 6–20은 15개 구현·검증·문서화 작업, 21은 코드 산출물 승인이다. 완료한 단계만 즉시 [x]로 바꾸고 상태와 증거를 같은 작업에서 기록한다. 승인 대기를 완료로 표시하지 않는다.

- [x] Step 1. U1 NFR Design Q1 B와 이전 계획 8번 완료를 기록하고 코드 계획 단계로 전환
- [x] Step 2. 승인된 설계·스토리·18개 메서드·의존성·작업공간과 확장 상태 확인
- [x] Step 3. 정확한 경로·순서·계약·검증·인계·예상 범위를 포함한 본 계획과 검토 Q1 작성
- [x] Step 4. 계획 번호·메서드/스토리/NFR 추적·문서 구문·참조 검증, 상태와 감사 로그 갱신 및 승인 요청
- [x] Step 5. 전체 코드 계획 승인 기록, Part 1 완료 및 Part 2 전환
- [x] Step 6. 프로젝트·의존성·TypeScript/Vite/Vitest 설정 작성 및 설치 호환성 확인
- [x] Step 7. 공통 값·입력·조회·명령·저장 포트 계약 구현
- [x] Step 8. SQLite 연결·초기 마이그레이션·조회·원자 커밋·확인 기록 구현
- [x] Step 9. 실제 파일 DB의 보존·롤백·참조·경합·페이지네이션 집중 테스트 작성·실행, 저장 계층 요약
- [x] Step 10. SR 입력 경계와 SR/문서 업무 서비스 구현
- [x] Step 11. 비교 알고리즘·워커·제한·간략 비교·실패/취소 처리 구현
- [x] Step 12. 업무·비교 집중 테스트 작성·실행 및 업무 계층 요약
- [x] Step 13. HTTP 조회/명령·검증·오류·요청 확인 경계 구현
- [x] Step 14. 실제 HTTP/DB 계약 및 응답 유실·중복 요청 테스트 작성·실행, API 계층 요약
- [x] Step 15. 브라우저 요청·결과 확인·초안/비교 상태·페이지 처리 구현
- [x] Step 16. 보드·SR·문서·이력·편집·비교·복원 화면과 스타일 구현
- [x] Step 17. UI 상태 집중 테스트 작성·실행 및 프론트엔드 계층 요약
- [x] Step 18. 앱 조립·개발/빌드 실행·워커 경로·정상 종료·로컬 실행 산출물 완성
- [x] Step 19. 타입 검사·집중 테스트·빌드·개발/빌드 시작·브라우저/키보드 및 상한 입력 확인, 발견 문제 수정
- [x] Step 20. 실행/API/검증/인계 문서 완성, 실제 증거로 스토리 기여·상태 갱신 및 코드 산출물 검토 요청
- [x] Step 21. U1 코드 산출물 명시적 승인 기록 후 U1 완료, U2 Functional Design으로 전환 — “승인 후 코드 구현 병렬 진행해줘.”

## 생성 파일 경로와 책임

아래는 작업공간 루트 기준의 생성 대상이다. 아직 존재하지 않는 파일은 코드 표기로 표시한다. 코드·설정·테스트는 루트에, 생성 문서는 aidlc-docs/에 둔다. 파일이 먼저 생겼다면 읽고 같은 위치에서 수정한다.

| 묶음 | 정확한 경로 | 단계 |
|---|---|---|
| 패키지·환경 | package.json, package-lock.json, .nvmrc, .gitignore, .env.example | 6, 18 |
| 빌드·검사 설정 | tsconfig.json, tsconfig.client.json, tsconfig.server.json, tsconfig.worker.json, tsconfig.test.json, vite.config.ts, vitest.config.ts, index.html | 6, 18 |
| 공통 값 | src/shared/contracts.ts, src/shared/errors.ts, src/shared/limits.ts, src/shared/validation.ts | 7 |
| 내부 저장 계약 | src/sr-document-foundation/storage/store-port.ts | 7 |
| SQLite | src/sr-document-foundation/storage/database.ts, src/sr-document-foundation/storage/migrations.ts, src/sr-document-foundation/storage/migrations/001-foundation.ts, src/sr-document-foundation/storage/sqlite-store.ts, src/sr-document-foundation/storage/queries.ts, src/sr-document-foundation/storage/cursors.ts | 8 |
| 업무 서비스 | src/sr-document-foundation/services/sr-input.ts, src/sr-document-foundation/services/sr-service.ts, src/sr-document-foundation/services/document-service.ts | 10 |
| 비교 | src/sr-document-foundation/compare/diff-contracts.ts, src/sr-document-foundation/compare/line-diff.ts, src/sr-document-foundation/compare/diff-worker.ts, src/sr-document-foundation/compare/diff-worker-adapter.ts | 7, 11 |
| HTTP | src/sr-document-foundation/http/boundary.ts, src/sr-document-foundation/http/routes.ts, src/sr-document-foundation/http/validation.ts, src/sr-document-foundation/http/operations.ts, src/sr-document-foundation/http/error-handler.ts | 13 |
| 브라우저 공통 요청 | src/shared/client/api-client.ts, src/shared/client/operation-tracker.ts | 15 |
| UI 상태 | src/sr-document-foundation/ui/editor-state.ts, src/sr-document-foundation/ui/compare-state.ts, src/sr-document-foundation/ui/use-query.ts, src/sr-document-foundation/ui/attachment.ts | 15 |
| 보드·SR | src/sr-document-foundation/ui/BoardPage.tsx, src/sr-document-foundation/ui/SRCreateForm.tsx, src/sr-document-foundation/ui/KanbanColumn.tsx, src/sr-document-foundation/ui/SRCard.tsx, src/sr-document-foundation/ui/SRDetailPage.tsx, src/sr-document-foundation/ui/InitialInputPanel.tsx | 16 |
| 문서·이력 | src/sr-document-foundation/ui/DocumentList.tsx, src/sr-document-foundation/ui/DocumentWorkspace.tsx, src/sr-document-foundation/ui/VersionPicker.tsx, src/sr-document-foundation/ui/DocumentReader.tsx, src/sr-document-foundation/ui/DocumentEditor.tsx, src/sr-document-foundation/ui/VersionCompare.tsx, src/sr-document-foundation/ui/RestoreConfirm.tsx, src/sr-document-foundation/ui/HistoryPanel.tsx | 16 |
| 공통 화면 | src/sr-document-foundation/ui/AsyncStatus.tsx, src/sr-document-foundation/ui/ErrorNotice.tsx, src/sr-document-foundation/ui/ConfirmDialog.tsx, src/sr-document-foundation/ui/Pagination.tsx, src/sr-document-foundation/ui/PagedText.tsx | 16 |
| 앱 조립 | src/app/config.ts, src/app/create-app.ts, src/app/server.ts, src/app/client.tsx, src/app/WorkspaceShell.tsx, src/app/styles.css | 16, 18 |
| 테스트 기반 | tests/sr-document-foundation/helpers/test-db.ts, tests/sr-document-foundation/helpers/fixtures.ts, tests/sr-document-foundation/helpers/test-server.ts, tests/sr-document-foundation/helpers/prepare-browser-fixture.ts | 9, 14, 19 |
| 저장 테스트 | tests/sr-document-foundation/storage.test.ts, tests/sr-document-foundation/migrations.test.ts, tests/sr-document-foundation/pagination.test.ts | 9 |
| 업무·비교 테스트 | tests/sr-document-foundation/services.test.ts, tests/sr-document-foundation/generated-changes.test.ts, tests/sr-document-foundation/compare.test.ts, tests/sr-document-foundation/worker.test.ts | 12 |
| HTTP·UI·실행 테스트 | tests/sr-document-foundation/http.test.ts, tests/sr-document-foundation/operations.test.ts, tests/sr-document-foundation/client-state.test.ts, tests/sr-document-foundation/config.test.ts | 14, 17, 19 |

문서 경로의 공통 접두사는 aidlc-docs/construction/sr-document-foundation/code/이다. 생성 파일은 repository-summary.md, business-logic-summary.md, api-summary.md, frontend-summary.md, README.md, api-reference.md, verification.md, implementation-summary.md이다. 루트 README.md 삭제는 보존하고 실행 안내를 이 문서 디렉터리에 작성한다. .env.example은 공개 포트/DB 설정 예시이며 자동 .env 로더를 새로 요구하지 않는다.

## 구현 단계의 세부 작업과 완료 기준

### Step 6 — 설정과 설치

승인된 Node 24·React 19·TypeScript·Vite·Express 5·better-sqlite3·React Router·react-markdown/remark-gfm·diff·Vitest·tsx 조합을 사용한다. 필요한 Vite React 플러그인과 타입 선언만 개발 의존성으로 추가한다. 설치 시 공식 자료와 engines/peerDependencies로 호환 조합을 확인하고 정확한 버전을 package.json 및 잠금 파일에 기록한다. 사용자 전역 런타임을 교체하지 않는다.

TypeScript strict, 브라우저/NodeNext 서버/워커/테스트 설정을 나눈다. node_modules/, dist/, .dev/, .planrepo/를 버전 관리 제외 대상으로 둔다. npm 설치와 임시 파일 DB의 네이티브 로딩을 먼저 확인하고 실패 원인을 해결한다. 패키지 설치가 끝났다고 UI 빌드까지 성공으로 기록하지 않는다. 네트워크/샌드박스 제한은 도구의 필요한 승인 절차를 따른다.

### Step 7 — 공통 계약

VersionRef·ActorContext·SRDraft·DocumentView·DocumentSummary·VersionSummary·HistoryEvent·DiffView·Result·Page/PageOptions·LocalQuery/LocalCommand와 내부 ReadQuery/ChangeSet/CommitReceipt/CommandContext를 정의한다. 공유 계약에서 Node·SQLite·서버 모듈을 import하지 않는다. 6열 상수와 바이트 상한을 함께 둔다.

조회 결과의 전체/일부, 저장 성공/거절/불확실, 최신/과거 참조를 타입으로 구분한다. 서버 전용 fingerprint와 임의 ChangeSet은 브라우저 입력으로 받지 않는다. 후기 단계 필드를 미리 모두 만드는 대신 C09의 타입별 조회·저장 확장 지점을 유지한다.

### Steps 8–9 — 저장과 마이그레이션

승인된 6개 테이블, 부모 UNIQUE 키, 복합 소속 FK, 최신 참조의 지연 FK, 본문 CHECK, 불변 버전/사건/참조/확인 기록 트리거와 목록 인덱스를 구현한다. BEGIN IMMEDIATE 안에서 확인 기록 중복 확인, 최신 전제·새 문서 키·소속 검증, 버전 번호/사건 순서 할당, 레코드/포인터/사건/receipt를 함께 확정한다. 예외는 트랜잭션 밖에서 Result로 변환한다.

foreign_keys ON, WAL, FULL, busy_timeout 100 ms 적용과 결과 확인, user_version=1의 순차 마이그레이션, 잠금 후 버전 재검사, quick_check/foreign_key_check를 구현한다. 알 수 없는 스키마·더 높은 버전·손상·적용 실패 시 원본을 유지하고 준비를 실패시킨다.

실제 임시 파일 DB로 재열기, 지연 FK 커밋 실패, 중간 삽입/포인터 오류의 전체 롤백, 소속 불일치, 기존 불변 기록 수정 거절, 최신 경합, 잠금 실패, 손상/미지원 스키마 보존을 확인한다. 성공 데이터뿐 아니라 실패 후 원래 레코드도 비교한다. 커서의 소속·필터·정렬·동일 시각 경계·다음 페이지를 검사한다. 두 연결을 쓸 경우 데이터 경합 결과를 검사하며 불안정한 벽시계 시간 단언은 피한다. repository-summary.md에 실제 결과를 기록한다.

### Steps 10–12 — 업무와 비교

C10은 필수값과 문자열/UTF-8 상한을 검증하고 설명·첨부의 원문 및 없음/빈 값을 보존한다. C03은 SR과 sr_created를 함께 저장한다. C04는 정확한 소속 조회, 최신 기준 편집, 동일 편집의 변경 없음, 빈 본문 편집, 새 버전 복원, 본문 없는 사건 조회, 커밋 없는 prepareGenerated를 구현한다. BR01–22의 실패 경로를 포함한다.

비교는 한 워커에서 수행하고 DB·CLI를 접근하지 않는다. 공백·CRLF/LF·끝 개행·제목 차이를 보존한다. 상세 계산 250 ms/편집 거리 2000, 합계 20,000줄 또는 결과 20,000블록 초과의 간략 비교, 전체 워커 2초 고장 한도를 적용한다. 간략 비교는 양쪽 원문을 모두 재구성할 수 있어야 한다. 사용 중·취소·고장은 명시적 오류이고 이후 명시적 요청으로 회복한다.

테스트는 편집 v1→v2→v1 복원 v3, 동일 편집/명시 복원의 차이, 제목 복원, 오래된 입력·준비 이후 충돌, 생성 키/ID 중복·공백 AI 본문 거절·빈 결과 준비·준비 중 저장 불변을 확인한다. 실제 diff와 파일 저장 전후를 검사하고, 제한/워커 실패는 좁은 의존성 주입으로 재현한다. 두 본문 재구성·같은/빈 버전·제목만 변경·반복 줄·끝 개행을 확인한다. business-logic-summary.md에 계약별 증거와 U2 잔여 Run 소속 검증을 기록한다.

### Steps 13–14 — API와 응답 유실

기능 설계의 10개 API에 NFR 설계의 operations/history 상세/config 조회 3개를 추가한다. 목록은 limit/cursor, 문서 목록은 DocumentSummary, 사건 목록은 요약과 참조를 반환한다. 모든 VersionRef의 소속을 서버에서 확인한다.

JSON 16 MiB·필드별 상한·잘못된 JSON·미지원 압축/Content-Type·ID·커서·허용 필드를 검사한다. loopback/Host/동일 Origin, no-store, 공통 상태 코드/오류를 적용한다. U1 변경 명령은 X-Operation-Id가 필수이고 서버가 fingerprint를 계산한다. 확인 기록을 현재 최신 검증보다 먼저 읽고 트랜잭션 안에서도 재검사한다. 준비 중 경합이 발생한 경우에도 이미 확인된 동일 요청 성공 결과가 있으면 이를 반환한다.

일시 테스트 서버와 실제 DB로 SR 생성→조회, 편집/복원/비교, 추가 조회 3개, 오류 매핑을 검증한다. 커밋 뒤 응답 유실, 원래 결과 이후 최신 변경, 동일 ID/다른 입력, 진행 중 요청, 없는 receipt/재시작을 재현한다. 자동 재제출 없이 committed/in_progress/unknown을 구분하고 중복 버전/사건이 생기지 않는지 확인한다. 테스트용 실패 주입은 생성 앱의 공개 API로 노출하지 않는다. api-summary.md에 결과를 기록한다.

### Steps 15–17 — 화면과 상태

ApiClient와 OperationTracker를 두고 조회 모델·초안·명령 상태를 분리한다. 잘못된 성공 응답과 연결 단절은 변경 명령에서 unknown으로 처리한다. 결과 조회 한 번과 사용자 재조회, 미확정 상태의 명시적 새 시도 확인을 제공한다. 조회 갱신이 초안을 지우거나 늦은 비교 응답이 새 선택을 덮어쓰지 않게 한다.

한국어 중심의 보드와 문서 작업 화면을 구현한다. 밝은 배경, 명확한 본문 폭, 일관된 간격과 텍스트 상태를 사용한다. 보드 6열은 가로 스크롤이 가능하고 문서 작업은 목록·본문·이력을 구분한다. 좁은 화면에서는 영역을 쌓되 주요 행동과 상태가 잘리지 않게 한다. 기능 없는 AI/Jira/리뷰 버튼은 노출하지 않는다.

작은 Markdown은 안전하게 렌더링하고 원문 보기를 제공한다. 이미지는 alt만 표시하며 링크 허용 목록을 적용한다. 256 KiB 또는 5,000줄 초과는 200줄 원본 모드로 연다. 비교도 200줄 구간과 총량·간략 비교 이유·끝 개행/줄바꿈 표식을 제공한다. 목록은 기본 50/최대 100개, 1 KiB 커서와 추가 조회를 적용한다. 긴 한 줄과 원문 복사·편집을 보존한다.

입력/버튼/링크/폼에 안정된 data-testid를 {component}-{element-role} 형태로 둔다. 레이블·오류 연결, 키보드 이동, 대화상자 초점·취소·복귀, dirty 이동 확인을 구현한다. 순수 UI 상태와 요청 모듈의 실패/충돌/unknown·초안 유지·늦은 응답·페이지 경계를 Vitest로 검사한다. 단순 렌더링을 그대로 복제하는 테스트는 만들지 않고 실제 컴포넌트 조작은 Step 19 브라우저 확인으로 보완한다. frontend-summary.md에 자동/브라우저 검증의 구분을 기록한다.

### Step 18 — 앱 실행 산출물

appRoot를 서버 모듈 위치와 package.json(name=planrepo)로 판별한다. 기본 DB는 appRoot/.planrepo/planrepo.sqlite이고 PLANREPO_DB_PATH의 상대값도 appRoot 기준이다. PLANREPO_PORT는 4310 기본의 유효한 정수다. DB 준비를 마친 뒤 127.0.0.1에만 listen한다.

npm run dev는 워커를 먼저 컴파일한 뒤 tsx로 src/app/server.ts를 실행하고 Vite middlewareMode/appType=custom과 같은 HTTP 서버의 HMR을 연결한다. npm run build는 UI와 NodeNext 서버/워커를 빌드한다. npm start는 dist/server/app/server.js를 실행한다. 워커 경로는 개발 .dev/server/sr-document-foundation/compare/diff-worker.js, 빌드 dist/server/sr-document-foundation/compare/diff-worker.js다. 서버/워커 rootDir=src 배치에 맞춰 실제 산출물을 확인한다.

정적 UI는 dist/client에서 제공하고 /api를 먼저 처리한다. 브라우저 경로 /, /srs/{srId}, /srs/{srId}/documents/{documentId}/versions/{versionId}만 SPA fallback 대상이다. 알 수 없는 API는 JSON 404다. 종료 시 신규 요청 중단, 최대 5초 정리, 워커/Vite/HTTP/DB 닫기를 수행한다. 로그는 식별자·코드·시간 중심이며 본문·첨부·SQL 바인딩을 출력하지 않는다. 로컬 실행 설정과 스크립트가 이 단위의 실행 산출물이며 클라우드 배포는 N/A다.

### Step 19 — 실행 증거와 수정

npm run typecheck, npm test, npm run build를 실행하고 잠금 파일의 재설치 재현성을 npm ci로 확인한다. 실제 선택한 버전과 명령 결과를 기록한다. 개발/빌드 모두 시작·SR 생성·페이지 재진입·비교 워커·정상 종료를 확인한다. 다른 작업 디렉터리에서 앱 루트/대체 DB 해석과 재시작 후 원본 보존을 점검한다.

테스트 도우미는 OS 임시 디렉터리에 새 전용 DB를 만들고 준비된 문서·본문 없는 사건 및 명시적 테스트 표식을 넣는다. 기존 경로를 초기화하지 않고 이 DB를 PLANREPO_DB_PATH로 지정해 브라우저를 실행한다. C04/C09 계약과 prepareGenerated를 재사용하고 정상 앱 시작 시 자동 seed를 하지 않는다. 준비 데이터는 실제 CLI 성공 증거가 아니다.

브라우저에서 SR 필수값/첨부, 6열/상세 이동, 정확한 버전 열람, 편집·충돌 초안, 비교·복원·과거 보존, 이력 필터/상세, 목록 추가 조회, 대화상자와 키보드를 확인한다. 20 SR×5문서×10버전 관찰 데이터와 상한 본문 2개로 큰 원문·비교/간략 결과·긴 한 줄 조작을 확인한다. 시간은 관찰값으로 기록한다. 테스트에서 발견한 구현/빌드/화면 문제는 이 계획 범위에서 수정하고 영향받은 검증을 다시 수행한다. 수행 불가 항목은 통과로 기록하지 않는다.

### Steps 20–21 — 문서와 다음 단위

code/README.md에 설치·개발·빌드·시작·설정·데이터 위치·정상 종료·앱 종료 후 데이터 디렉터리와 남은 WAL/SHM 수동 보관을 안내한다. code/api-reference.md는 실제 구현한 13개 경로·타입·오류·페이지·operation 결과 예시를 담는다. code/verification.md에 명령/환경/시나리오/결과/제한을, code/implementation-summary.md에 생성 경로·18개 메서드 대응·스토리 기여·U2/U3 인계를 기록한다. 마지막 전체 Build and Test 단계의 필수 문서는 그 단계에서 작성한다.

관련 스토리의 U1 기여만 실제 구현·검증 이후 체크한다. 준비 데이터로 확인한 US-06/08과 U2/U3 연결이 필요한 항목의 최종 수용은 열린 상태로 둔다. 코드 산출물 검토는 Request Changes 또는 Continue to Next Stage로 요청한다. 새 산출물 승인을 받은 뒤 U1 Code Generation을 완료하고 U2 Functional Design으로 간다.

## 메서드 추적 — U1 18개

| 메서드 | 구현 경계 | 단계 |
|---|---|---|
| C01.render | WorkspaceShell와 UI 컴포넌트 | 16 |
| C01.submit | ApiClient/OperationTracker와 폼 행동 | 15–16 |
| C02.query | boundary/routes | 13 |
| C02.command | boundary/operations | 13 |
| C03.create | sr-service/sr-input | 10 |
| C03.listBoard | sr-service, Page 반환 | 10 |
| C03.getDetail | sr-service, 본문 일괄 조회 제외 | 10 |
| C04.listDocuments | document-service, DocumentSummary의 Page | 10 |
| C04.readVersion | document-service, 정확한 VersionRef | 10 |
| C04.listVersions | document-service, Page | 10 |
| C04.listHistory | document-service, Page와 사건 참조 | 10 |
| C04.edit | document-service, optional CommandContext | 10 |
| C04.compare | document-service/diff-worker-adapter | 10–11 |
| C04.restore | document-service, optional CommandContext | 10 |
| C04.prepareGenerated | document-service, 저장 전 DocumentChanges | 10 |
| C09.read | sqlite-store/queries/cursors | 8 |
| C09.commit | sqlite-store, 원자 확인 기록 | 8 |
| C10.normalize | sr-input, 미래 외부 입력 경계 | 10 |

## 스토리 기여 추적

체크박스는 U1 기여의 구현·검증 완료를 뜻한다. 스토리 전체 완료 범위는 마지막 열을 함께 본다.

| U1 기여 | AC와 구현 | 단계 | 최종 수용 경계 |
|---|---|---|---|
| [x] US-01 | AC1/2/3 생성·필수 입력·첨부와 Jira 독립 입력 경계 | 8–10, 13–19 | U1에서 전체 확인 |
| [x] US-02 기반 | AC1/3 고정 6열·카드·입력/문서 링크 | 10, 16, 19 | 회차/계획은 U2, 리뷰·완료는 U3 |
| [x] US-06 기반 | AC1/2 Git 없이 파일 저장·재열람 | 8–10, 16, 19 | 준비 데이터 확인 후 실제 생성·역할 U2/U3 연결 |
| [x] US-07 | AC1/2 새 편집과 과거 보존·충돌 초안 | 10, 12–19 | 실행 중 편집/늦은 결과는 U2 추가 확인 |
| [x] US-08 기반 | AC1/2/3 과거 버전·모든 종류/본문 없는 사건 조회 | 8–10, 16, 19 | 실제 AI·질문·결정·리뷰 생산은 U2/U3 |
| [x] US-09 | AC1/2 두 버전/제목/개행 차이·저장 불변 | 11–12, 16–19 | U3 역할 재사용 확인 잔여 |
| [x] US-10 | AC1/2 새 복원 버전·원본/복원 전 최신 보존 | 10, 12–19 | U1에서 전체 확인 |
| [x] US-03/04 연결 계약 | prepareGenerated 검증·준비 중 저장 불변·원자 커밋 | 8–12 | 스토리 담당/실제 CLI 성공·실패는 U2 |

## NFR 검증 추적

| NFR | 설계 패턴 | 필요한 증거·단계 |
|---|---|---|
| U1-NFR01 | P03/P07·앱 조립 | 로컬 주소·DB/앱 루트·설정, 18–19 |
| U1-NFR02 | P01/P02 | 중간 실패·지연 FK·포인터 전체 롤백, 9 |
| U1-NFR03 | P01/P03 | 재열기·마이그레이션 보존·앱 재시작, 9/19 |
| U1-NFR04 | P02 | 오래된 편집·동일 편집·복원/생성 준비 경합, 9/12/14 |
| U1-NFR05 | P05/P06/P07 | 원문 재구성·간략/실패/늦은 응답·상한 입력, 12/17/19 |
| U1-NFR06 | P07 | 폼·문서·비교·복원·페이지·초점/키보드, 19 |
| U1-NFR07 | P04/P07 | 응답 유실·원래 결과 재조회·초안 유지, 14/17/19 |
| U1-NFR08 | P01/P07 | 타입·소속·HTML 비실행·이미지 자동 요청 없음, 9/14/19 |
| U1-NFR09 | 논리 컴포넌트 | 타입/의존 경계·잠금 재설치·빌드·워커, 6/18–19 |
| U1-NFR10 | P08 | 집중 검증과 후속 통합의 범위 구분, 20 |
| U1-NFR11 | P08 | 실패 진단·본문/첨부 없는 로그, 14/19 |
| U1-NFR12 | P07 | UTF-8 경계·한글·초과 거절·초안/원본 보존, 12/14/19 |

## 예상 범위와 변경 처리

U1의 15개 구현·검증·문서화 작업은 저장·트랜잭션·워커·화면을 새로 만드는 중간 규모의 작업이다. 순차 구현 예상은 4–6시간이며 승인 대기와 의존성/브라우저 환경 문제를 제외한 계획 추정이다. 전체 프로젝트의 기존 8–12시간 추정은 U1 실제 결과를 얻은 뒤 재평가한다. 하루 완료를 보장하거나 승인된 기능을 줄이는 근거로 쓰지 않는다.

경로 내 함수 분리·검증 실패 수정·호환 패치 선택은 계획의 구현 세부로 처리하고 결과를 기록한다. 공개 계약·기술 선택·단위 책임의 실질적 변경이 필요하면 영향을 설명하고 관련 설계/계획을 갱신해 검토한다. 코드 승인 후에도 새 사용자 작업이 보이면 덮어쓰기 전에 내용을 확인한다.

## 확장 준수와 비적용 항목

| 확장/단계 | 상태 | 판단 |
|---|---|---|
| Security Baseline | Enabled No, N/A | Q11 B 유지; 전체 규칙·적용 생략 |
| Resiliency Baseline | Enabled No, N/A | Q12 B 유지; 전체 규칙·적용 생략 |
| Property-Based Testing | Enabled No, N/A | Q13 C 유지; 전체 규칙·적용 생략 |
| Infrastructure Design | SKIPPED | 승인된 로컬 앱 실행 설정으로 충족 |
| 클라우드 배포·운영 부하·전체 E2E 자동화 | N/A | 승인된 로컬 MVP/집중 검증 범위 |

현재 계획의 확장 차단 항목은 없다. 승인된 제품 BR/NFR 검증은 수행한다. 문서는 일반 Markdown 표와 텍스트를 사용하므로 Mermaid/ASCII 도형 검사는 N/A다.

## 계획 검토

[코드 계획 검토 Q1](sr-document-foundation-code-generation-approval-questions.md)은 전체 생성 순서와 설치·검증·인계 범위에 대한 승인이다. 이 질문이 승인되면 Step 5를 완료하고 Step 6부터 순차 실행한다. 이번 NFR Design 승인을 코드 계획 승인으로 대신 기록하지 않는다.

## 계획 검증 기록

연속된 Step 1–21, 기능 설계와 정확히 일치하는 18개 U1 메서드, 12개 NFR, 스토리 기여별 후속 검증 범위, 표 열 수·로컬 링크와 개발/빌드 워커 경로를 확인했다. 새 생성 경로는 코드 표기이며 파일 존재를 주장하지 않는다. NFR Design Q1 B와 이전 계획 8번 완료도 확인했다. Step 1–4는 완료, 첫 미완료는 Step 5의 코드 계획 승인이다. 현재 런타임 검증 결과는 없다.

## 최종 실행 결과

Steps 6–20 완료. 31개 집중 테스트의 최신 관련 실행, 타입 검사·잠금 재설치·UI/서버 빌드, 개발/빌드/다른 디렉터리 시작, 실제 브라우저·키보드·응답 유실·상한 본문을 확인했다. [구현 요약](../sr-document-foundation/code/implementation-summary.md)과 [검증 결과](../sr-document-foundation/code/verification.md)에 실제 증거를 기록했다.

스토리 표의 체크는 각 행에 명시한 U1 기여 완료다. 실제 CLI/리뷰/전체 상태 연결의 최종 수용은 후속 단위에 남아 있다. [코드 산출물 Q1](../sr-document-foundation/code/code-generation-approval-questions.md)은 “승인 후 코드 구현 병렬 진행해줘.”로 승인되어 Step 21을 완료했다.
