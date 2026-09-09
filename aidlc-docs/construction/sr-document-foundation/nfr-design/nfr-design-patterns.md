# U1 NFR 설계 패턴

상태: Q1 B 승인 완료(사용자 채팅 “승인 후 진행”). 승인된 NFR을 구현 가능한 계약으로 구체화했다. 코드·실행·성능 검증 결과가 아니다.

근거: [NFR 요구사항](../nfr-requirements/nfr-requirements.md), [기술 선택](../nfr-requirements/tech-stack-decisions.md), [도메인](../functional-design/domain-entities.md), [업무 규칙](../functional-design/business-rules.md), [처리 모델](../functional-design/business-logic-model.md), [화면](../functional-design/frontend-components.md).

## P01 — 한 저장 경계에서 불변 기록 확정

C09의 SQLite 어댑터가 SR·문서·버전·사건·최신 참조와 요청 확인 기록을 한 동기 트랜잭션으로 확정한다. C03/C04는 SQL을 직접 실행하지 않는다. ID는 서버 UUID 문자열, 시각은 UTC ISO 8601 문자열이다. 정렬과 저장 순서는 시각에 의존하지 않고 문서별 version_number와 SR별 sequence를 사용한다.

다음은 논리 스키마이다. 실제 DDL·타입·마이그레이션 코드는 Code Generation에서 작성한다. 모든 필수 키는 NOT NULL이며 본문은 TEXT로 원문 그대로 저장한다. 문자열 UTF-8 바이트 수는 서버에서 검증하고 핵심 본문 상한은 DB CHECK로도 보강한다.

| 테이블 | 핵심 필드 | 키·관계·제약 |
|---|---|---|
| srs | id, title, description, attachment_markdown, attachment_display_name, created_at, actor_source, actor_role, workflow_column | id PK. 첨부 NULL과 빈 문자열 구분. workflow_column은 승인된 6열 값, 초기 sr_list |
| documents | id, sr_id, logical_key, latest_version_id, created_at | id PK; UNIQUE(sr_id,id), UNIQUE(sr_id,logical_key). sr_id는 srs 참조. 최신 참조는 아래 복합 FK |
| document_versions | id, sr_id, document_id, version_number, title, body, origin, created_at, actor_source, actor_role, base_version_id, source_version_id, run_id | id PK; UNIQUE(sr_id,document_id,id), UNIQUE(document_id,version_number). 문서 소속 복합 FK. 번호는 양의 정수 |
| history_events | id, sr_id, sequence, kind, actor_source, actor_role, occurred_at, summary, subject_json, details_json | id PK; UNIQUE(sr_id,id), UNIQUE(sr_id,sequence). sr_id FK. JSON은 서버가 소유한 타입별 값, 본문 없음 허용 |
| event_version_refs | sr_id, event_id, document_id, version_id | 네 필드 복합 PK. 사건과 버전에 각각 소속 포함 복합 FK. 같은 버전을 중복 연결하지 않음 |
| command_receipts | operation_id, command_kind, fingerprint, sr_id, document_id, version_id, changed, committed_at | operation_id PK. 성공한 명령의 최소 결과 참조만 저장. sr_id FK; 문서/버전은 둘 다 NULL 또는 둘 다 존재하고 복합 버전 FK |

Document의 (sr_id,id,latest_version_id)는 DocumentVersion의 (sr_id,document_id,id)를 참조한다. 이 FK를 DEFERRABLE INITIALLY DEFERRED로 선언하고 latest_version_id는 NULL을 허용하지 않는다. 신규 문서와 첫 버전의 ID를 미리 발급한 뒤 같은 트랜잭션에 넣어 상호 참조를 만족시킨다. 버전의 (sr_id,document_id)는 documents(sr_id,id)를 참조한다. base/source는 같은 sr_id/document_id를 포함한 버전 FK이며, 없을 때만 NULL이다. 앱은 base/source가 이미 존재한 과거 버전인지도 검사한다.

외래 키의 부모 복합 키는 같은 열 순서의 UNIQUE/PK로 제공한다. 지연 FK는 커밋 시 검사되므로 커밋 오류도 전체 실패 처리에 포함한다. 연결별 foreign_keys를 트랜잭션 밖에서 활성화한다. 이 관계 설계는 SQLite의 복합·지연 FK 동작을 이용한 프로젝트 결정이다. [SQLite FK 문서](https://sqlite.org/foreignkeys.html)

버전·사건·사건 참조·커밋 확인 기록은 생성 후 UPDATE/DELETE를 거절하는 저장 어댑터와 DB 트리거를 둔다. 연쇄 삭제를 사용하지 않는다. SR 최초 입력과 문서 소속/키도 기존 값 수정 API가 없다. 최신 참조와 workflow만 승인된 서버 명령으로 변경한다. 새로운 사건 종류는 U2/U3의 타입 검증을 추가하여 수용하며 U1 종류만 허용하는 영구 CHECK로 막지 않는다.

run_id는 U1에서 선택적 문자열 연결 자리만 둔다. 아직 없는 Run 테이블에 FK를 만들지 않는다. 운영 UI는 U1에서 AI 버전을 생성하지 않으며 테스트 데이터는 명시적으로 구분한다. U2가 Run의 실제 저장과 같은 SR 소속 검증을 추가하고, 기존 데이터 검사를 거친 마이그레이션으로 FK를 강화한다. U1만으로 Run 소속의 전체 검증이 끝났다고 주장하지 않는다.

## P02 — 최신 참조 검사와 저장 순서

1. C02가 명령 타입·입력·operation_id를 검증한다. C03/C04가 현재 참조로 ChangeSet과 예상 최신 참조를 준비한다. prepareGenerated는 조회와 준비만 한다.
2. C09가 BEGIN IMMEDIATE에 해당하는 트랜잭션을 시작한다. 동일 operation_id의 기존 확인 기록이 있으면 P04를 적용한다.
3. 현재 최신, 문서 키, SR 소속 및 변경 후 참조를 재검사한다. 충돌은 VERSION_CONFLICT다. 문서 번호와 SR sequence는 이 쓰기 잠금 안에서 현재 최대값 이후로 할당한다. 최대값은 인덱스로 조회하며 JavaScript 안전 정수 범위 초과 시 명시적으로 실패한다.
4. 새 SR/문서/버전과 사건·참조를 넣고, 기대 최신값과 일치하는 문서만 포인터를 변경한다. 영향 행 수가 예상과 다르면 예외로 전체 롤백한다. 새 문서의 키 경합도 전체 실패다.
5. 입력과 결과가 유효하면 같은 트랜잭션에 command_receipts를 기록한다. 최종 불변 조건과 FK를 만족한 커밋 뒤에만 CommitReceipt를 반환한다.

트랜잭션 내부 검증 실패는 예외를 던진다. 오류 Result를 정상 반환하여 앞선 쓰기가 커밋되는 경로를 만들지 않는다. 오류를 Result로 바꾸는 위치는 트랜잭션 래퍼 바깥이다. better-sqlite3의 immediate 트랜잭션과 예외 롤백을 사용하고 async/await·CLI·네트워크·비교 계산을 안에 두지 않는다. [better-sqlite3 트랜잭션 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

동일 본문 편집도 트랜잭션 안에서 기준 버전의 최신 여부를 확인한다. 새 버전/업무 사건은 만들지 않고 기존 버전 참조와 changed=false의 요청 확인 기록만 남긴다. 복원은 같은 본문이어도 새 버전을 만들며 source는 원본, base는 처리 시작 시 최신이다. 준비 이후 경합은 commit에서 거절한다. U2의 늦은 생성 결과 채택은 실행 입력 스냅샷을 추가로 비교하는 별도 정책이다.

## P03 — DB 시작·보존·실패

| 항목 | 이번 설계 값 | 실패 처리 |
|---|---|---|
| foreign_keys | ON, 읽어서 1 확인 | 적용 불가 시 준비 실패 |
| journal_mode | WAL, 반환 모드 확인 | 원하는 모드가 아니면 원인 표시 후 중단 |
| synchronous | FULL | 설정 확인 실패 시 중단 |
| busy_timeout | 100 ms | 잠금 실패를 명시적 일시 저장/조회 오류로 반환; 자동 쓰기 재시도 없음 |
| 마이그레이션 | PRAGMA user_version, U1 최초 1 | 순차 트랜잭션 적용, 지원 버전보다 높으면 실행 중단 |

위 값은 새 설계 제안이며 지연시간이나 전원 장애 무손실을 보장한 수치가 아니다. WAL/FULL의 추가 동기화와 busy_timeout의 잠금 대기 의미는 공식 PRAGMA 문서를 근거로 한다. 읽은 설정값을 확인하여 오타나 적용 실패를 숨기지 않는다. [SQLite PRAGMA](https://sqlite.org/pragma.html)

처음부터 없는 DB만 생성한다. 기존 파일의 user_version=0인 경우에도 임의의 사용자 테이블이 있으면 새 빈 DB로 간주하지 않는다. 마이그레이션 전에 기존 DB의 quick_check를, 적용 후 foreign_key_check를 확인하고 지원하는 스키마와 일치하지 않으면 앱 준비를 실패시킨다. 검사 실패·쓰기 권한·디스크 부족·손상 시 원본을 보존하며 자동 초기화·삭제·백업 복원으로 숨기지 않는다. 정상 준비 완료 전에 업무 HTTP 요청을 받지 않는다.

같은 DB의 마이그레이션 버전은 쓰기 잠금을 얻은 뒤 다시 확인하여 중복 적용을 방지한다. 실패한 변경은 롤백하고, 롤백/연결 상태가 불확실하면 연결을 닫고 서버를 준비 실패 상태로 전환한다. 물리 DB 오류의 저장 결과는 P04 재조회로만 확인한다.

정상 종료는 새 요청 중단, 진행 중 짧은 요청 정리, 비교 워커 종료, DB 닫기 순서다. 수동 보관은 앱이 완전히 종료된 뒤 데이터 디렉터리와 남은 WAL/SHM 파일을 함께 보관하는 지침으로 제공한다. 실행 중 .sqlite 파일만 복사해 일관된 백업이라고 안내하지 않는다. 자동 원격 백업·HA·RTO/RPO는 추가하지 않는다.

## P04 — 응답 유실의 커밋 확인

UI가 생성·편집·복원을 시작할 때 operation_id UUID를 만들고 응답이 확정될 때까지 초안과 함께 메모리에 유지한다. C02는 이를 명령 문맥으로 C03/C04와 C09에 전달한다. fingerprint는 명령 종류·대상 ID·정확한 입력·역할을 고정 필드 순서로 직렬화한 값의 SHA-256이다. 원문을 로그나 확인 기록에 복제하지 않는다. 이 값은 인증 수단이 아니라 동일 요청의 내용 구분이다.

같은 operation_id로 이미 커밋된 같은 fingerprint가 들어오면 기존 결과 참조를 반환하고 다시 쓰지 않는다. 다른 fingerprint면 OPERATION_CONFLICT다. C02는 타입·fingerprint 검증 후 업무 서비스의 현재 최신 검사보다 먼저 기존 확인 기록을 조회한다. 이미 성공한 편집을 다시 확인하는 요청이 그 편집 자체로 바뀐 최신 때문에 충돌하지 않게 한다. C09에서도 확인 기록 검사와 삽입을 쓰기 트랜잭션 안에서 수행한다. 준비 중 경합으로 서비스가 실패했더라도 같은 ID의 커밋이 확인되면 해당 원래 결과를 우선 반환한다. 진행 중인 같은 ID는 C02 메모리 표에서 판별해 IN_PROGRESS로 반환한다. 자동 재시도는 하지 않으며 외부 중복 처리 패키지를 추가하지 않는다.

GET /api/operations/{operationId}는 커밋된 확인 기록을 조회한다. SR 생성은 정확한 SR ID, 편집/복원은 원래 결과 VersionRef와 changed를 반환한다. 이후 최신 버전이 바뀌어도 원래 결과 참조를 사용한다. 응답 본문을 만들다가 실패해도 이미 커밋된 기록을 실패로 취소하거나 다시 쓰지 않는다.

| 조회 결과 | UI 해석과 행동 |
|---|---|
| committed | 정확한 결과 참조 재열람, 저장 완료 표시. 현재 최신과 원래 결과를 구분 |
| in_progress | 아직 처리 중 표시. 초안 유지, 사용자가 다시 확인 가능 |
| unknown | 확인 기록 없음. 미저장이라고 단정하지 않음; 처리 중·미수신·실패·재시작을 구분할 증거 부족 |
| 조회 오류 | 저장 여부 확인 불가. 초안과 요청 식별자 유지, 재조회 제공 |

초기 명령의 명시적 검증/충돌/롤백 완료 응답은 미저장 실패로 표시할 수 있다. 연결 단절·비정상 응답·타임아웃은 unknown으로 표시하고 조회를 한 번 시도한 뒤 사용자 재조회 행동을 제공한다. unknown만 보고 자동 제출하거나 폼을 비우지 않는다. 별도 새 시도를 선택하면 아직 완료될 수 있는 이전 요청과 중복될 수 있음을 설명하고 확인받는다. 브라우저 종료 후 초안/요청 ID 복원은 기존 범위대로 보장하지 않는다.

command_receipts는 업무 이력의 대체가 아니며 이력 화면에 기술 기록으로 노출하지 않는다. C09의 내부 ChangeSet에 선택적 command context를 포함하는 구체화이며 기존 서비스의 업무 의미를 바꾸지 않는다. U2의 CLI Run 상태와 요청 확인은 다르며 CLI 성공을 이 확인 기록만으로 판정하지 않는다.

## P05 — 목록을 나누어 읽고 본문은 선택해서 읽기

목록 쿼리는 본문을 묶어서 읽지 않는다. SR 상세는 입력과 문서 메타데이터 연결을 제공하고, 실제 문서 본문은 readVersion으로 읽는다. 기존 언어 독립 List 계약을 구현할 때 Page(items,nextCursor)와 선택적 조회 옵션으로 구체화한다. listDocuments의 각 항목은 DocumentSummary로 분리하고 latestVersionRef·제목·버전/출처/시각을 포함한다. DocumentView는 본문을 포함한 선택 조회에 유지한다. 이는 이번 승인에서 검토하는 계약 구체화이며 코드 계획에서 공통 타입·전송·UI를 함께 맞춘다.

| 목록 | 정렬과 커서 | 기본/최대 크기 |
|---|---|---|
| 보드 SR | created_at 내림차순, id 내림차순 | 50/100 |
| 문서 | created_at 오름차순, id 오름차순 | 50/100 |
| 버전 | version_number 내림차순 | 50/100 |
| 사건 | sequence 내림차순 | 50/100 |

복합 정렬 키와 소속·필터를 커서에 넣고 서버가 타입·길이·범위를 검사한다. 커서는 최대 1 KiB 인코딩 문자열로 제한하고 다른 SR/문서/필터의 커서를 거절한다. LIMIT+1로 다음 페이지 유무를 판별한다. srs(created_at,id), documents(sr_id,created_at,id), 버전/사건 UNIQUE 키, event_version_refs(sr_id,document_id,event_id)에 인덱스를 둔다. 사건 필터는 EXISTS 방식으로 사건 중복을 피한다.

UI는 다음 페이지 버튼과 현재 일부 목록임을 표시한다. 보드는 받은 카드를 고정 6열에 배치하고 미조회 카드가 있을 수 있음을 보드 전체에 알린다. 새 변경 후 첫 페이지를 갱신하고 ID로 중복을 제거한다. 목록 페이지는 영구 스냅샷이 아니며 새 항목은 새로고침으로 확인한다. 선택 버전이나 비교 대상이 현재 페이지 밖이면 ID로 읽고, 더 읽어서 과거 버전 선택이 가능해야 한다.

사건 목록은 요약·참조만 제공하고 큰 details는 GET /api/srs/{srId}/history/{eventId}로 필요할 때 읽는다. 이 상세 조회는 C02.query/C09.read의 타입 확장이며 임의 저장 접근 API가 아니다. U2/U3가 새 사건 데이터를 넣을 때 summary·details·참조 수의 상한을 정한다. U1의 현재 사건은 고정 요약과 최대 세 버전 참조를 사용한다.

## P06 — 계산과 화면 크기가 제한된 비교

C04.compare가 소속을 검증해 두 불변 버전만 읽은 뒤, DB 트랜잭션 밖에서 Node worker_threads 워커에 계산을 보낸다. 워커는 DB·CLI에 접근하지 않는 순수 비교 어댑터다. CPU 계산을 워커로 분리하는 것은 Node 24 문서의 용도에 맞춘 결정이다. [Node 24 worker_threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)

서버 전체에서 비교 워커는 한 개의 작업만 실행한다. 추가 요청은 COMPARE_BUSY로 응답하고 UI가 선택 입력을 보존한다. 무제한 대기 큐를 만들지 않는다. 각 비교 요청에 세대 번호를 붙여 이미 바뀐 선택의 늦은 결과를 UI에 적용하지 않는다. 연결 종료 시 해당 작업 취소를 요청하고 강제 종료가 필요하면 다음 명시적 요청에서 새 워커를 준비한다.

jsdiff diffLines는 공백·개행을 무시하지 않는 설정을 명시한다. ignoreWhitespace=false, ignoreNewlineAtEof=false, stripTrailingCr=false, newlineIsToken=false를 기준으로 하고 제목 차이는 별도로 계산한다. CRLF/LF와 마지막 개행을 표시 정보로 보존한다. timeout=250 ms, maxEditLength=2000을 최초 설계값으로 제안하며 undefined는 계산 중단으로 취급한다. 해당 옵션과 중단 반환은 공식 문서에 근거한다. [jsdiff 옵션](https://github.com/kpdecker/jsdiff)

두 본문 합계 20,000줄을 넘으면 상세 diff를 건너뛰고 간략 비교로 간다. 상세 결과가 20,000개 변경 블록을 넘거나 제한에 걸려도 동일하다. 간략 비교는 원본 왼쪽/오른쪽 텍스트를 각각 하나의 삭제/추가 블록으로 반환하므로 모든 줄을 포함한다. 양쪽 원문이 정확히 같으면 본문 동일로 처리하며 제목 차이가 있으면 전체 변경 없음은 아니다. 원문 재구성이 가능한 블록 문자열·줄 수를 전송하고 줄별 객체 수백만 개를 만들지 않는다.

워커 전체 작업 2초 한도는 고장 탐지용이다. 이 한도에서 응답이 없거나 워커가 비정상 종료하면 COMPARE_FAILED와 다시 비교 행동을 제공한다. 고장 상태에서 완전한 비교 결과를 꾸며내지 않는다. 타임아웃에 따라 상세/간략 모드가 달라질 수 있으나 동일 입력·동일 모드에서 줄 순서와 결과는 결정적이어야 한다. 위 수치는 성능 SLA가 아니며 상한 입력 검증에서 조정할 수 있는 초기 설계값이다.

UI는 비교 블록을 최대 200줄 단위로 나누어 표시하고 다음/이전 구간과 전체 줄 수를 제공한다. 부분 표시와 데이터 누락을 구분한다. 간략 비교 이유를 텍스트로 표시하고 원본 두 버전 열람도 제공한다. 추가/삭제·좌/우 줄 번호·끝 개행 없음·CRLF/LF 차이를 색 외의 표식으로 표시한다. 비교는 버전·사건·포인터·command_receipts를 전혀 쓰지 않는다.

## P07 — 입력과 렌더링을 데이터 경계에 유지

서버는 JSON object 형식, 허용 필드, 문자열 타입, ID 형식·소속과 UTF-8 바이트 상한을 검사한다. 제목 4,096바이트, 설명/첨부/본문 각 1,048,576바이트, U1 JSON 본문 16,777,216바이트를 사용한다. 공통 상수는 브라우저의 TextEncoder 기준 안내와 서버 바이트 검사에 공유한다. 제목은 trim 후 필수/상한을 검사하고 설명·첨부·본문의 유효한 공백·개행은 보존한다. 잘못된 유니코드 surrogate 등 원문 손실이 생길 입력은 변환하여 저장하지 않고 거절한다.

첨부는 UI에서 원시 파일 크기를 확인하고 UTF-8 엄격 디코딩을 수행한다. 읽기 실패는 필드 오류다. 파일 이름은 표시용 문자열이며 경로로 사용하지 않는다. 표시 이름과 logicalKey는 각각 최대 4 KiB의 서버 검증을 추가한다. AI 결과 묶음 전체 상한과 CLI 출력 제한은 U2가 지정한다.

마크다운은 react-markdown/remark-gfm으로 렌더링하고 raw HTML 플러그인·dangerouslySetInnerHTML을 사용하지 않는다. HTML은 실행하지 않으며 항상 원본 보기로 확인할 수 있다. 이미지 컴포넌트는 alt 텍스트만 표시한다. 링크는 명시적 http/https/mailto와 문서 내부 #fragment만 허용하고 상대 링크·file/data/javascript 등은 텍스트로 표시한다. 외부 링크는 사용자가 클릭할 때만 열고 새 창에는 noopener/noreferrer를 적용한다. 렌더러의 URL 변환과 컴포넌트 교체 지점을 사용한다. [react-markdown](https://github.com/remarkjs/react-markdown)

256 KiB 또는 5,000줄을 넘는 본문은 초기 화면에서 원본을 200줄씩 보여 주며 큰 Markdown AST를 자동 생성하지 않는다. 작은 문서만 렌더링/원본 전환을 제공하고 큰 문서는 원본 모드 이유를 설명한다. 단일 긴 줄은 가로 스크롤과 원문 복사를 제공한다. 이는 내용을 줄여 저장하는 제한이 아니며 전체 원문과 편집은 유지한다. 상한 textarea·단일 긴 줄 조작은 구현 검증 대상이다.

UI 상태는 조회 데이터, 미저장 초안, 저장 결과를 분리한다. saving/succeeded/rejected/conflict/unknown을 텍스트로 표시하고 중복 제출을 막는다. 제목·오류 레이블, 키보드 링크/버튼, 대화상자 초점 이동·복귀와 취소, dirty 이동 확인을 기본 컴포넌트로 제공한다. 문서 조회 갱신이 초안을 덮어쓰지 않는다.

## P08 — 검증과 관찰의 범위

기본 로그는 시각·operation_id·대상 ID·오류 코드·처리 시간만 남긴다. 입력 본문·첨부·details·인증 파일 내용·SQL 바인딩 값은 기록하지 않는다. 오류 원인은 서버 로그용 범주와 사용자 메시지로 나누고 원래 저장 오류를 빈 데이터로 바꾸지 않는다.

| NFR | 설계 근거 | 구현에서 확보할 증거 |
|---|---|---|
| U1-NFR01 | P03/P07, 앱 조립 | loopback 주소, 기본/대체 DB, 외부 서비스 없이 U1 동작 |
| U1-NFR02 | P01/P02 | 중간 쓰기·지연 FK·최신 포인터 실패에 전체 롤백 |
| U1-NFR03 | P01/P03 | 파일 DB 닫기/재열기, 버전/사건 보존, 이전 스키마 유지 |
| U1-NFR04 | P02 | 오래된 편집·동일 편집 경합·준비 이후 변경 충돌 |
| U1-NFR05 | P05/P06/P07 | 비교 원문 재구성, 제목/끝 개행/CRLF, 큰 입력·간략/실패·늦은 응답 |
| U1-NFR06 | P07 | 핵심 입력·비교·복원·페이지·대화상자의 수동 키보드 조작 |
| U1-NFR07 | P04/P07 | 커밋 후 응답 손실, 확인 기록 재조회, 중복 ID, 초안 보존 |
| U1-NFR08 | P01/P07 | 타입·소속·본문 비실행·이미지 자동 요청 없음 |
| U1-NFR09 | 논리 컴포넌트 문서 | 타입 검사·빌드·서버/브라우저 경계·잠금 파일 |
| U1-NFR10 | P08 | 저장/참조/비교 중심 집중 검증, 전체 통합은 최종 단계 |
| U1-NFR11 | P03/P08 | 실패 코드·대상 식별 가능, 원문/인증값 로그 없음 |
| U1-NFR12 | P07 | 한글·경계 바이트·초과 거절·원본 불변 |

테스트 DB는 임시 경로를 명시하고 실제 .planrepo DB를 초기화하지 않는다. 필요한 테스트는 실제 파일 SQLite를 사용해 어댑터/트랜잭션의 의미를 검증한다. UI는 로컬 브라우저에서 핵심 흐름과 키보드 조작을 확인한다. NFR의 20 SR × 5 문서 × 10 버전 및 상한 본문을 관찰용으로 사용하며 부하 성능 인증으로 표현하지 않는다. 이 문서 작성 중에는 테스트를 실행하지 않았다.

## 확장 준수

| 확장 | Enabled | 평가 | 사유 |
|---|---|---|---|
| Security Baseline | No | N/A | 기존 Q11 B; 전체 규칙·적용 생략 |
| Resiliency Baseline | No | N/A | 기존 Q12 B; 전체 규칙·적용 생략 |
| Property-Based Testing | No | N/A | 기존 Q13 C; 전체 규칙·적용 생략 |

승인된 제품 NFR만 구체화했다. Infrastructure Design 생략, U2 CLI 실동작 검증, U3 리뷰/역할 범위는 유지한다.
