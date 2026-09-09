# U1 논리 컴포넌트와 실행 구성

상태: NFR Design Q1 B 승인 완료(사용자 채팅 “승인 후 진행”). [설계 패턴](nfr-design-patterns.md)의 P01–P08을 한 로컬 앱에 배치한다. 구현·설치·실행 성공 기록이 아니다.

근거: [단위 정의](../../../inception/application-design/unit-of-work.md), [메서드 계약](../../../inception/application-design/component-methods.md), [기술 선택](../nfr-requirements/tech-stack-decisions.md), [화면 API](../functional-design/frontend-components.md), [설계 계획](../../plans/sr-document-foundation-nfr-design-plan.md).

## 책임과 연결

브라우저 C01이 C02의 타입이 정해진 조회/명령을 호출한다. C02는 C03/C04를 호출하고 C03은 C10으로 입력을 정규화한다. C03/C04는 C09에서 조회·확정하며 C04의 비교 계산은 DB 밖의 DiffWorkerAdapter에 보낸다. AppRuntime은 구현을 조립하고 시작·종료를 관리한다. 워커는 앱 프로세스의 내부 실행 자원이며 별도 서비스가 아니다.

| 논리 요소 | 소유·코드 위치안 | 입력·출력과 책임 |
|---|---|---|
| WorkspaceUI C01 | src/sr-document-foundation/ui/ | 보드/상세/문서/이력, P07 초안·오류·키보드 상태. U2/U3 화면 확장 |
| ApiClient / OperationTracker | 같은 ui/와 src/shared/client/ | Page/Result 파싱, operation_id와 미확정 요청 보존, P04 커밋 재조회, 오래된 응답 무시 |
| LocalAppBoundary C02 | src/sr-document-foundation/http/ | 런타임 입력 검증, HTTP/도메인 오류 매핑, 역할·CommandContext 전달, P05 조회 옵션 |
| SRService C03 / SRInputPort C10 | src/sr-document-foundation/services/ | SR 정규화·생성·보드/상세. Git/Jira/로컬 첨부 경로 읽기 없음 |
| DocumentService C04 | 같은 services/ | 정확한 버전·편집·복원·이력·비교·prepareGenerated. U2 서비스 호출 없음 |
| SQLiteStore C09 | src/sr-document-foundation/storage/ | 파라미터 SQL, 타입별 read/commit, P01 스키마·P02 트랜잭션, 요청 확인 기록 |
| MigrationRunner / DBLifecycle | 같은 storage/ | P03 설정 확인·버전별 마이그레이션·보존·정상 종료. UI 임의 초기화 API 없음 |
| DiffWorkerAdapter | src/sr-document-foundation/compare/ | 한 작업 실행, 제한/실패/취소 관리, P06 원문 보존 결과 |
| SharedContracts | src/shared/ | VersionRef/ActorContext/Result/Page/CommandContext/상한/오류 타입. 브라우저에 안전한 순수 값만 공유 |
| AppRuntime | src/app/ | Node/Express 진입, UI 라우터·Vite 연결, 설정 해석·의존성 조립·시작/종료 |

이 배치는 기존 C01/02/03/04/09/10 책임을 세분화한 내부 구조다. 외부 큐·캐시·브로커·별도 DB를 추가하지 않는다. UI/공통 값에서 storage·Node fs·네이티브 SQLite·서버 워커를 import하지 않도록 진입점을 분리한다. U1에 C05/C06/C07/C08/C11 의존을 만들지 않는다.

## 타입과 고수준 계약의 구체화

기존 설계의 언어 독립 List와 Result를 다음과 같이 구현 타입으로 구체화한다. 업무 메서드 18개의 담당은 그대로이며 페이지네이션과 명령 문맥은 이번 NFR 설계의 검토 대상이다.

| 계약 | 구체화 | 유지할 의미 |
|---|---|---|
| listBoard/listDocuments/listVersions/listHistory | 선택적 PageOptions와 Page(items,nextCursor) | 받은 부분만 전체인 것처럼 표시하지 않음. 같은 소속·정렬 계약 유지 |
| listDocuments | DocumentSummary: IDs/latestVersionRef/title/versionNumber/origin/actor/time | 목록에서 본문을 일괄 읽지 않음; 선택 본문은 기존 readVersion |
| getDetail | SR 최초 입력·workflow·문서/후속 요약 연결 | 문서 본문을 상세 응답에 중복 묶지 않음 |
| listHistory | 사건 요약·versionRefs 반환, 상세는 별도 타입별 query | 본문 없는 사건과 모든 종류를 유지; 상세 내용 접근 가능 |
| create/edit/restore | 선택적 마지막 내부 CommandContext 인자 | operation_id와 fingerprint를 ChangeSet에 전달. 업무 입력과 기존 버전 의미 유지 |
| C09 ChangeSet/CommitReceipt | 선택적 command context와 결과 참조/changed | 관련 쓰기와 확인 기록을 한 번에 확정. 임의 SQL/브라우저 ChangeSet 접수 금지 |
| DiffView | mode, reason, left/right 메타데이터, 제목 차이, 원문을 재구성할 블록 | 상세/간략 구분, 두 본문 완전 보존, 저장 없음 |
| Result | ok/data 또는 ok=false/error, 필요시 operationId | 성공·실패·unknown 구분. HTTP 성공만으로 업무 저장 확정 금지 |

CommandContext는 C02가 요청별로 생성해 명시적으로 전달한다. 공유 전역 변수에 현재 요청을 저장하지 않는다. UI는 X-Operation-Id만 전달하고 fingerprint는 서버가 계산한다. 서비스의 내부 호출/테스트는 문맥을 생략할 수 있으나 모든 U1 HTTP 변경 명령은 문맥이 필수다. prepareGenerated에는 요청 성공 확인을 넣지 않으며 U2가 최종 실행 변경과 함께 처리한다.

## 전송과 오류

기존 [기능 설계 HTTP 경로](../functional-design/frontend-components.md)의 생성·열람·편집·복원·비교를 유지한다. 목록 GET은 limit/cursor를 추가한다. 아래 두 조회와 공개 상한 조회만 추가한다.

| 요청 | 응답 | 처리 경계 |
|---|---|---|
| GET /api/operations/{operationId} | committed 참조 또는 in_progress/unknown | C02.query에서 C09 receipt 조회와 진행 메모리 표를 조합; 쓰기 없음 |
| GET /api/srs/{srId}/history/{eventId} | 사건 전체 내용과 정확한 versionRefs | C02.query/C09.read 타입별 조회, 같은 SR 소속 검증 |
| GET /api/config | 입력 바이트/페이지/표시 상한 | 경로·DB 내부 설정 없이 UI가 사용하는 공개 값만 반환 |

JSON 변경 요청은 application/json과 X-Operation-Id를 요구한다. 파서에 16 MiB 상한을 지정하고 압축 요청 본문은 지원하지 않는 것으로 명시해 거절한다. 파싱 이후 필드별 바이트·타입·소속 검증을 다시 한다. 잘못된 JSON/큰 입력/미지원 형식을 오류 미들웨어에서 공통 JSON 오류로 변환한다. Express의 JSON 파서 옵션으로 구성하고 설치한 Express 버전에서 동작을 확인한다. [Express JSON 파서](https://expressjs.com/en/5x/api/express/#express.json)

| 상황 | HTTP·도메인 코드 | UI 동작 |
|---|---|---|
| SR 생성 확정 | 201, ok=true | 결과 SR 열기 |
| 편집/복원 확정, 같은 요청의 확정 결과 재조회 | 200, ok=true | 정확한 결과 버전 열기, changed 표시 |
| 검증 실패·잘못된 JSON/커서 | 400, VALIDATION_ERROR | 필드·원인 표시, 입력 유지 |
| 바이트 상한 초과 | 413, PAYLOAD_TOO_LARGE | 상한과 필드 표시, 절단 없음 |
| 미지원 Content-Type/압축 | 415, UNSUPPORTED_MEDIA_TYPE | 형식 오류, 입력 유지 |
| 대상 없음 | 404, NOT_FOUND | 대상을 다시 선택, 빈 성공으로 숨기지 않음 |
| 소속 불일치 | 400, REFERENCE_MISMATCH | 올바른 대상 다시 열기 |
| 최신 경합·operation_id 내용 충돌 | 409, VERSION_CONFLICT 또는 OPERATION_CONFLICT | 최신 확인/초안 유지, 자동 덮어쓰기 없음 |
| 같은 요청 처리 중 | 409, IN_PROGRESS | 결과 확인 행동, 재제출 없음 |
| 일시 DB 잠금·비교 사용 중 | 503, STORAGE_BUSY 또는 COMPARE_BUSY | 원인 표시, 사용자가 재시도 선택 |
| 명시적 롤백 완료의 저장 오류 | 500, STORAGE_FAILED | 저장 실패·초안 유지 |
| 조회/비교 오류 | 500, READ_FAILED 또는 COMPARE_FAILED | 오류와 재조회/비교 행동 |
| 커밋 결과 확인 불가 | 503, OUTCOME_UNKNOWN 또는 브라우저 통신 오류 | P04 조회, 성공/미저장 추측 금지 |

오류 객체는 code/message와 선택적 field/target/currentVersionRef/operationId만 공개한다. stack·SQL·원문 입력을 반환하지 않는다. 클라이언트가 응답을 파싱하지 못하거나 예상 Result가 아니면 변경 요청은 unknown, 단순 조회는 읽기 실패로 처리한다. fetch 취소는 서버의 저장 취소를 뜻하지 않는다. API 데이터는 Cache-Control: no-store로 제공하고 전역 클라이언트 캐시 없이 영향을 받은 조회를 갱신한다.

기본 앱 주소는 http://127.0.0.1:4310이다. Host는 실제 로컬 앱 주소로 제한하고 브라우저의 Origin이 있으면 같은 앱 Origin인지 확인한다. 공개 CORS를 켜지 않고 외부 Origin은 명시적 전송 오류로 거절한다. Origin이 없는 로컬 테스트 클라이언트도 타입/ID/내용 검증을 동일하게 적용한다. 이는 승인된 로컬 경계의 구체화이며 로그인·사용자 인증을 의미하지 않는다.

## 시작·개발·빌드·종료

| 항목 | 설계 |
|---|---|
| 앱 루트 | 서버 모듈 파일 위치에서 상위의 프로젝트 package.json(name=planrepo)을 찾음. process.cwd()에 의존하지 않고 잘못된 루트는 시작 실패 |
| DB | 기본 appRoot/.planrepo/planrepo.sqlite. PLANREPO_DB_PATH의 상대값도 appRoot 기준, 절대값은 명시한 위치. 브라우저 경로 입력 없음 |
| 포트 | PLANREPO_PORT 또는 4310. 1–65535 정수만 허용, 충돌·잘못된 값은 실패. 임의 포트/전체 인터페이스 대체 없음 |
| 런타임/타입 | 승인된 Node 24, TypeScript strict. 정확한 패치는 구현 시 확인·기록 |
| 개발 | npm run dev 목표: 비교 워커를 .dev/server에 먼저 컴파일한 뒤 tsx로 서버를 시작하고 Vite 미들웨어 연결. tsx는 구현 시 호환성을 확인할 개발 의존성 제안 |
| UI 빌드 | Vite client 진입, dist/client 산출물. 서버 전용 모듈을 번들에 넣지 않음 |
| 서버 빌드 | TypeScript NodeNext/ESM을 dist/server에 컴파일, 워커 진입도 함께 컴파일. JSX UI는 별도 설정으로 타입 검사 |
| 실행 | npm start 목표: 컴파일한 서버가 정적 UI와 /api 제공. DB/native binding은 런타임 의존성으로 유지 |
| 검사 | npm run typecheck, npm test 목표. 잠금 파일과 프로젝트 Node 버전을 함께 기록 |

설정 해석 → DB 열기·P03 설정/마이그레이션 확인 → 서비스/라우트/워커 어댑터 조립 → HTTP listen 순서다. Vite 개발 서버는 middlewareMode와 appType=custom으로 붙이고 같은 HTTP 서버를 HMR에 연결한다. API는 Vite/SPA 처리보다 먼저 둔다. 개발 HTML은 Vite 변환을 거쳐 제공한다. 이 미들웨어 구성은 공식 가이드의 서버 연결 패턴을 참고하며 앱의 SSR 기능을 추가하는 것은 아니다. [Vite 미들웨어 예시](https://vite.dev/guide/ssr.html#setting-up-the-dev-server)

빌드 실행은 dist/client 정적 파일을 제공하고 알려진 브라우저 화면 경로만 index.html로 보낸다. /api의 없는 경로는 JSON 404로 유지한다. 공개 라우트는 /, /srs/{srId}, /srs/{srId}/documents/{documentId}/versions/{versionId}로 구체화한다. 상세 진입에서 문서 미선택·정확한 버전 선택을 구분하며 버전 없음은 최신으로 조용히 대체하지 않는다.

SIGINT/SIGTERM에서 새 요청을 막고 최대 5초 동안 진행 요청을 정리한다. 비교 작업은 종료하고 Vite 자원·HTTP 연결·DB를 닫는다. 한도 초과는 비정상 종료로 기록하고 사용 중 DB 파일을 지우지 않는다. CLI 자식 프로세스 정리는 U2에서 이 순서에 추가한다. 서버 재시작 후 데이터와 확인 기록을 재열람하되 브라우저 초안 복구는 약속하지 않는다.

개발 워커는 tsconfig.worker.json으로 워커 진입과 순수 비교 의존성만 .dev/server에 컴파일한다. 앱 루트 기준 .dev/server/sr-document-foundation/compare/diff-worker.js를 실행하고, 빌드에서는 dist/server/sr-document-foundation/compare/diff-worker.js를 실행한다. 워커 변경 후에는 개발 서버를 다시 시작하여 재컴파일한다. 브라우저 UI는 Vite HMR을 사용한다. .dev/는 재생성 가능한 산출물로 버전 관리에서 제외하고 .planrepo/ DB와 분리한다.

tsx는 TypeScript 서버 진입 실행용 개발 도구로 사용하며 워커에서 TS 로더 상속에 의존하지 않는다. NodeNext 확장자와 실제 산출 경로, Vite HMR·SPA 연결은 Code Generation에서 개발/빌드 양쪽을 확인한다. [tsx 공식 저장소](https://github.com/privatenumber/tsx) 이 문서의 npm 명령은 아직 생성되지 않은 목표다.

## 화면 상태 연결

DocumentEditor의 draftBody와 baseVersionRef는 조회 모델과 별도다. 저장 성공 후 정확한 새 결과를 읽고 문서/버전/사건 첫 페이지를 갱신한다. 충돌은 최신 링크와 비교 행동을 제공한다. unknown에서는 입력을 남기고 OperationTracker로 결과를 확인한다. SR 생성도 같은 확인 절차를 사용하므로 응답 유실 때문에 카드 중복 생성이 자동 발생하지 않는다.

VersionCompare는 선택 pair와 요청 세대를 함께 저장한다. 선택이 바뀌면 이전 요청 결과를 버리고, 사용 중/실패에는 기존 선택을 보존한다. P06 간략 비교와 표시 페이지를 구분하고 원문 두 버전 링크를 유지한다. HistoryPanel은 목록/상세 조회를 분리하며 사건 원래 참조로 이동한다. 모든 페이지 이동 버튼·레이블·진행/오류 상태는 키보드와 텍스트로 접근 가능하게 한다.

## 후속 단위 인계와 검증

| 수신 | U1 제공 계약 | 후속 책임 |
|---|---|---|
| U2 | P01/P02 저장, prepareGenerated, 공통 오류·입력 상한·Page·CommandContext | Run 테이블/소속 FK, 결과 묶음 한도, 실행 입력/늦은 결과 정책, 실제 CLI·질문/결정·회차 |
| U3 | 불변 VersionRef/사건·목록/상세·복원/비교, 공통 UI/저장 | 원래 리뷰 대상·역할·본문 없는 검토 사건·수동 완료, 새 타입의 크기 검증 |
| Build and Test | 파일 저장/재열람·오류·비교·화면 계약, 설정과 잠금 파일 | 모든 단위 연결 핵심 흐름·실제 CLI 실패·키보드·최종 빌드 증거 |

U1 집중 검증은 [P08 추적표](nfr-design-patterns.md)의 12 NFR과 BR01–22를 따른다. 데이터 보존을 확인할 파일 DB 테스트, 확인 기록 중복/응답 유실, 큰 비교 재구성·키보드 조작을 우선한다. PBT·전체 E2E 자동화·운영 부하 테스트를 새 필수 범위로 만들지 않는다. U2/U3를 구현하거나 완료 처리하지 않는다.

## 확장 준수

Security Baseline, Resiliency Baseline, Property-Based Testing은 모두 Enabled No, N/A이며 전체 규칙 로드·적용을 생략했다. Infrastructure Design 생략을 유지한다. 여기서 정의한 워커/저장/전송은 로컬 논리 구성으로, 새 배포 인프라 단계가 아니다.
