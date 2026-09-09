# PlanRepo 비기능 설계 패턴

버전은 0.1이며 **사용자 승인 완료**입니다. 승인 응답 “어 진행해도될거같아”를 2026-09-08T15:50:03Z에 기록했습니다. 사용자 응답 “진행하자”로 승인된 NFR Requirements를 UOW-01의 저장·동시성·복구·실행·표시 패턴에 반영합니다. 아래는 구현할 설계이며 승인 시점에는 설치·동작·성능을 검증한 결과가 아니었습니다. 2026-09-09에 짧은 실제 Claude 연결만 별도로 검증했습니다.

## 1. 입력과 설계 선택

기준은 `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`와 `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md`입니다. 기존 `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`, `aidlc-docs/construction/planrepo/functional-design/business-rules.md`, `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`, `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`를 유지합니다. 논리 책임은 `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`, 계획은 `aidlc-docs/construction/plans/planrepo-nfr-design-plan.md`에 연결합니다.

ND는 구현 패턴, LC는 기존 9개 모듈 안의 협력 책임입니다. 별도 제품 기능·배포 서비스·업무 승인 단계를 추가하지 않습니다. 한 로컬 앱·SQLite·설치 Claude·가상 자료를 유지합니다. 내부 실행 상태·launch intent·slot은 업무 도메인의 대체 상태가 아닙니다.

| 선택 | 대안과 판단 |
|---|---|
| 같은 SQLite 안의 버전·현재 참조·receipt·작업을 함께 확정합니다. | 파일별 저장이나 별도 broker는 원자적 확정·복구의 조정 비용이 커 초기에는 사용하지 않습니다. |
| DELETE/FULL·짧은 동기 트랜잭션을 사용합니다. | WAL은 읽기/쓰기 병행의 실측 필요가 생기면 검토합니다. 지금 선택하지 않습니다. |
| 영속 singleton 슬롯과 부모 runtime의 제한 실행을 사용합니다. | 메모리 queue만으로 crash를 복구하지 않습니다. 별도 작업 서버·supervisor 서비스는 추가하지 않습니다. |
| 미확인 종료·관찰된 실행 정책 충돌은 AI 시작을 막고 비AI 기능을 유지합니다. | 시간 경과·PID 파일 삭제·제한 옵션 제거로 실행을 겹치게 하지 않습니다. |
| 서버 현재 정책과 UI 입력 상태를 분리합니다. | 클라이언트의 낙관적 승인이나 오래된 조회를 업무 기준으로 사용하지 않습니다. |

정확한 앱 경로·port·OS 관찰 수단·명령은 다음 Infrastructure Design에서 매핑합니다. SQL DDL·wire schema·테스트 코드·패키지 pin은 Code Generation 계획과 TDD에서 구체화합니다. 이 문서는 그때 지켜야 할 알고리즘·조건·실패 처리를 정합니다.

## 2. 패턴

### ND-01 짧은 SQLite 업무 트랜잭션

**추적**: NQ-02, NQ-04, NQ-05, NQ-06, NQ-23.
**협력 책임**: LC-02, LC-03, LC-12.

C-04의 앱 프로세스별 단일 connection과 prepared statement를 사용합니다. 초기 저장 모드는 rollback journal의 DELETE, synchronous=FULL, foreign_keys=ON으로 선택합니다. 연결 직후 설정을 읽어 확인합니다. 기본 busy timeout은 100ms로 제한하며 무제한 SQL 재시도를 하지 않습니다. SQLite는 동시에 한 쓰기 트랜잭션만 허용하므로 변경 시작에 BEGIN IMMEDIATE를 사용합니다. [SQLite 트랜잭션](https://sqlite.org/lang_transaction.html), [SQLite PRAGMA](https://sqlite.org/pragma.html#pragma_synchronous)

선택 이유는 승인된 작은 로컬 작업량에서 저장·복구 경계를 단순하게 유지하기 위해서입니다. WAL은 별도 읽기 연결의 병행성에 이점이 있지만 checkpoint와 관련 파일 관리가 추가됩니다. 초기에는 선택하지 않습니다. 실측 병목이 쿼리·렌더링 개선으로 해결되지 않아 WAL을 도입하면 내장 SQLite의 WAL-reset 수정 버전과 재시작/백업 검증을 다시 확인합니다. [SQLite WAL](https://sqlite.org/wal.html)

업무 명령은 구조 검증과 불변 입력의 파싱을 먼저 하고, 트랜잭션 안에서 현재 주체·범위·receipt·WriteGuard를 읽습니다. C-03 판단 후 새 버전·현재 포인터·ReviewImpact·요청 승계·활동·receipt·필요한 Run을 모두 저장합니다. commit이 끝난 후에만 Committed를 반환합니다. 성공 응답 후 프로세스 강제 종료에서도 이 전체 자료를 다시 읽어야 합니다. FULL 선택을 디스크 고장·전원 손실의 무손실 운영 보장으로 확대하지 않습니다.

callback은 동기이며 await·provider 호출·파일 쓰기·Markdown 렌더링·네트워크 응답 대기를 넣지 않습니다. 오류를 내부에서 삼키고 부분 commit하지 않습니다. commit 실패·IO 오류·외래 키 오류는 rollback을 확인한 뒤 STORE_UNAVAILABLE 또는 적절한 도메인 오류로 반환합니다. connection 상태가 불확실하면 폐기하고 준비 상태를 내립니다. 같은 키 재요청으로 확정 여부를 확인합니다. [better-sqlite3 transaction API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

참조는 projectId·srId·논리 ID·버전을 함께 제한합니다. 프로젝트 범위와 SR 범위를 분리하고 nullable 참조로 소속 검사를 대신하지 않습니다. 불변 버전 repository에는 수정·삭제 메서드를 제공하지 않습니다. 후속 SQL schema는 외래 키와 고유 제약을 포함하며 FK를 연결마다 켜고 검사합니다. [SQLite 외래 키](https://sqlite.org/foreignkeys.html)

검증은 실제 SQLite에서 각 쓰기 지점의 장애, commit 후 응답 유실, 다른 connection의 쓰기 경쟁, 재시작 내용 비교를 수행합니다. 파일이 잠겼다고 초기화하거나 새 빈 DB로 성공 표시하지 않습니다.

### ND-02 행동별 충돌 검사와 receipt 재생

**추적**: NQ-07, NQ-08, NQ-10.
**협력 책임**: LC-01, LC-02, LC-03.

revision은 변경 자원의 충돌 기준, BundleRef·reviewEpoch는 검토 기준, fingerprint는 AI 입력 기준입니다. 서버는 각 명령에 필요한 조건만 비교합니다. 개별 승인에는 현재 묶음·epoch·검토자 배정을 검사하며 다른 사람의 같은 묶음 승인 때문에 SR revision만으로 거절하지 않습니다. 기대하는 문서가 아직 없는 경우도 명시적 absent 기준으로 처리합니다.

receipt 고유 키는 NULL 없는 scopeKind·projectId·scopeTargetId·actorId·idempotencyKey입니다. ProjectScope의 scopeTargetId는 projectId, SrScope의 값은 srId입니다. commandKind를 고유 키에 넣지 않고 저장값과 비교하므로 같은 키의 다른 명령도 IDEMPOTENCY_CONFLICT입니다. SQLite UNIQUE의 NULL은 같은 값으로 취급되지 않으므로 nullable srId만 고유 키에 넣지 않습니다. [SQLite 고유 인덱스](https://sqlite.org/lang_createindex.html)

입력 지문에는 명령 종류·명시 대상·기대 기준·사용자 입력을 넣습니다. requestId·서버 시각처럼 재전송에서 달라질 수 있는 추적값은 제외합니다. 같은 지문과 키의 receipt가 있으면 현재 권한을 먼저 검사합니다. 전환·현재용 인계는 현재 게이트/기준도 확인합니다. 유효하면 Replayed와 고정 결과 참조·현재 유효성을 반환하고 쓰지 않습니다. 과거 전환 후 출발 단계가 바뀌었다고 같은 전환을 재실행하거나 무조건 거절하지 않습니다.

새 명령의 모든 조건부 update는 변경 행 수가 정확히 기대와 맞는지 확인합니다. 승인 고유성은 SrScope·gate·bundleId·version·reviewerId로 제한하고 epoch도 일치시킵니다. 동일 요청 동시 실행·응답 유실·현재 권한 제거·다른 명령 재사용·다른 검토자 승인 경쟁을 테스트합니다.

### ND-03 불변 검토 기준과 현재 상태의 원자적 갱신

**추적**: NQ-05, NQ-06, NQ-07, NQ-09.
**협력 책임**: LC-02, LC-03, LC-04, LC-10.

C-03의 ReviewImpact는 순수 함수로 유지합니다. G1 기준 변경은 G1과 종속 G2의 epoch를 갱신하고 기존 통과의 현재 유효성을 무효화합니다. G2 전용 변경은 G1을 보존합니다. 복귀 단계는 이미 요구되는 가장 앞선 검토 단계보다 뒤로 이동하지 않습니다. 관련 없는 댓글·동일 자료 표시명 변경은 승인 기준을 바꾸지 않습니다.

버전·묶음·개별 승인·통과·현재 요청·수정 반영/확인은 별개 레코드로 유지합니다. 요청 승계는 원 요청 식별자·차단 여부·현재 대상·삭제 섹션 연결을 보존합니다. 이전 요청을 현재 검토함에 중복 표시하지 않습니다. 원 요청자의 해결 확인 자격과 역할 겸임을 그대로 허용합니다. 답변 저장을 해결 확인으로, 반영 제출을 해결 완료로 만들지 않습니다.

Handoff 생성 M-040은 고정 후보 자료를 읽고 잠금 밖에서 순수 직렬화한 뒤, 쓰기 트랜잭션에서 같은 refs·현재 G1/G2가 여전히 유효한지 검사하고 본문·digest·receipt를 함께 확정합니다. 바뀌었으면 후보를 저장하지 않고 충돌을 반환합니다. M-042의 현재용 내보내기는 이 확정 경계에서 다시 검사한 고정 bytes만 응답합니다. 트랜잭션 종료 뒤 송신하며 다운로드를 기다리는 동안 DB를 잠그지 않습니다. 판정 시각과 BundleRef를 응답에 포함하고 이미 내려받은 파일을 회수한다고 주장하지 않습니다.

H1의 외부 완료는 H1의 ImplementationRecord와 활동만 갱신합니다. 현재 활성 인계·게이트와 맞는 경우에만 현재 SR 완료를 확정합니다. H2 활성화 후 H1 완료, G1 변경과 G2 통과/내보내기 경쟁, 오래된 승인 재생, 모든 미해결 요청 승계를 검사합니다.

### ND-04 로컬 전송 경계와 현재 권한

**추적**: NQ-02, NQ-07, NQ-10, NQ-17, NQ-22.
**협력 책임**: LC-01, LC-02, LC-12.

Fastify 전송 계층은 공개 논리 메서드 44개를 명시적으로 연결합니다. M-036·M-037·M-038·M-039·M-049·M-050은 HTTP에서 등록하지 않습니다. 메서드명을 문자열로 받아 임의 dispatch하는 endpoint를 만들지 않습니다. ActorResolver는 고정 가상 사용자 선택과 현재 membership·배정으로 권한을 구성합니다. 사용자 선택은 브라우저 context별이며 서버 전역의 현재 사용자 변수로 보관하지 않습니다.

서버는 loopback에서만 수신하고 요청 Host를 실행 설정의 정확한 허용 host/port와 비교합니다. UI와 API는 같은 origin을 사용합니다. 변경 요청은 허용 Origin·JSON Content-Type·명시적 사용자 행동을 요구하며 교차 origin CORS를 열지 않습니다. 같은 origin 확인은 실제 조직 인증을 대신하지 않습니다. 개발 서버 proxy와 구체적인 port는 Infrastructure Design에서 매핑합니다.

runtime schema로 타입·enum·길이·구조·미지원 필드를 검사합니다. 본문 전송은 identity encoding만 지원하고 압축 Content-Encoding은 거절합니다. 단일 요청 8 MiB를 수신 중 누적 검사하고 파싱 전에 초과를 중단합니다. 단일 Markdown 1 MiB 제한도 별도로 검사합니다. 클라이언트가 보낸 역할·runtime token·승인 문구·다른 SR 참조를 저장 권한으로 사용하지 않습니다.

도메인 거절과 전송 실패를 구분합니다. 입력 오류는 400 계열, 권한은 403, 없는 범위/대상은 안전한 404, 오래된 기준·중복 키 충돌·게이트 차단은 409, 크기 초과는 413, 저장소/필요 provider 이용 불가는 503 계열로 매핑합니다. 실제 오류 코드·사유·대상·현재 revision은 계약의 DomainError로 전달합니다. 원시 예외·CLI 출력·token을 응답하지 않습니다. 정확한 endpoint와 wire schema는 Code Generation 계획에서 44개 공개 계약에 연결합니다.

### ND-05 일관된 조회와 제한된 자료 로딩

**추적**: NQ-01, NQ-02, NQ-03, NQ-04, NQ-13, NQ-17.
**협력 책임**: LC-04, LC-10, LC-11.

보드·검토함·SR 상세의 한 응답에 필요한 현재 포인터·게이트·요청·활동은 한 read transaction에서 조회합니다. 이 안에서도 await하지 않습니다. 복사한 불변 자료로 표시 모델을 만들고 읽기 잠금을 해제합니다. 각 SR revision과 읽은 기준 refs를 응답에 넣습니다. 서로 다른 응답의 시점을 같다고 주장하지 않고 오래된 응답은 ND-06 규칙으로 배제합니다. 서버의 파생 상태 캐시는 초기에는 두지 않습니다.

보드 카드에 전체 문서 본문이나 생성 raw 출력을 싣지 않습니다. 세부 문서·버전 비교·활동은 사용자가 열 때 요청합니다. 목록은 기본 50개·최대 100개의 페이지로 읽으며 100 SR은 저장 상한이 아닙니다. 검토함은 기한 초과·현재 단계 차단·직접 요청·최신순·안정 ID의 승인된 순서를 유지합니다. cursor에는 필터/정렬 조건을 연결하며 조건이 바뀌면 새 조회로 시작합니다.

인덱스는 SR의 project/key, 현재 pointer, 요청의 scope/담당자/상태, 활동의 scope/시각/ID, Run 상태/생성시각/ID, receipt 고유 키를 우선합니다. 필요한 좁은 열만 읽고 N+1 조회를 피합니다. 실행 계획과 PERF-100 실측을 보고 인덱스를 확정합니다. 본문 원문 비교는 표시 지연 로딩과 계산 결과 재사용을 우선하며 200 KiB 목표·1 MiB 경계의 시간을 각각 측정합니다. 긴 diff로 이벤트 루프가 막히면 해당 계산을 worker로 옮기는 변경을 검토합니다.

고정 Handoff는 ND-03에서 확인한 최대 8 MiB bytes를 잠금 밖에서 작은 chunk로 송신하고 backpressure를 따릅니다. 응답 중 게이트가 바뀌어도 과거 판정을 새로운 현재 승인으로 재표시하지 않습니다. UTF-8 원문과 digest는 미리보기·파일에서 같습니다. 성능 측정은 NFR Requirements의 준비 횟수·표본·p95 방식·실제 생성 중 측정을 그대로 따릅니다.

### ND-06 입력 보존과 안전한 한국어 화면

**추적**: NQ-03, NQ-10, NQ-11, NQ-12, NQ-13, NQ-17.
**협력 책임**: LC-10, LC-11.

UI의 조회 키는 actorId·ProjectScope/SrScope·자료 종류/ID·버전 또는 필터를 포함합니다. 같은 조회 키에서도 매 조회·재조회 발행마다 요청 순번을 올립니다. 화면 전환 때에도 이전 화면의 적용 자격을 폐기합니다. 응답이 도착했을 때 현재 키와 최신 발행 순번이 모두 맞는 응답만 반영합니다. 같은 화면에서 저장 후 재조회 Q2가 먼저 도착하고 이전 Q1이 늦게 도착해도 Q1이 현재 표시를 덮지 못합니다. Abort만 믿지 않고 늦은 응답도 무시합니다. 편집 초안은 같은 주체·SR·대상의 독립 상태로 두고 query refresh로 덮어쓰지 않습니다. 사용자/SR 전환 때 dirty 입력을 명시적으로 처리하고 오류 후에도 입력·대상·expectedRevision을 보존합니다.

저장 중·확정됨·실패·충돌을 구분합니다. 낙관적으로 게이트·승인·현재 문서를 확정하지 않습니다. 충돌하면 새 원문과 사용자 입력을 비교한 뒤 사용자가 다시 저장합니다. 제출 중 중복 클릭 방지와 별개로 같은 명령 재전송의 idempotencyKey는 보존합니다. 의미 있는 입력을 고치면 새 키를 만듭니다.

C-08의 표시 경로를 문서·diff·초안·인계가 공유합니다. react-markdown 기반으로 raw HTML 해석 plugin을 추가하지 않고 raw 노드는 표시에서 제외합니다. 저장 원문과 내려받는 Markdown 자체는 바꾸지 않습니다. URL은 허용한 http/https와 문서 내부 anchor만 해석하고 javascript·data·file 등은 링크로 만들지 않습니다. 외부 이미지를 자동 요청하지 않고 대체 텍스트와 명시적 링크로 보여줍니다. 외부 링크는 사용자 클릭 때만 열며 opener를 분리합니다. [react-markdown 표시·보안 안내](https://github.com/remarkjs/react-markdown)

표처럼 필요한 Markdown 확장을 추가할 때도 같은 fixture를 통과해야 합니다. innerHTML·실행형 embed를 쓰지 않습니다. raw HTML 미지원은 사용자에게 문법 제한으로 안내하며 입력을 저장 과정에서 조용히 잘라내지 않습니다.

폼 label·오류 연결·키보드 순서·modal 초점 복귀·텍스트 상태를 UI-01부터 UI-26의 책임에 반영합니다. 차단 이유·담당자를 보드/상세에 직접 표시합니다. 자동 키보드 검증과 실제 사용자 10초 관찰은 다른 증거로 기록합니다.

### ND-07 명시적 입력 스냅샷과 지문

**추적**: NQ-07, NQ-17, NQ-18, NQ-20, NQ-23.
**협력 책임**: LC-02, LC-05, LC-08, LC-09.

M-032는 같은 SR의 문서·질문 결과·답변·결정·근거 확인 상태·분류·workflowVersion·선택 로컬 규칙의 정확한 버전과 내용을 InputSnapshot으로 저장합니다. taskKind·documentKind·보완 요청·대상 VersionRef 또는 absent·ProviderSelection도 고정합니다. 암묵적으로 다른 프로젝트나 CLI 대화를 이어 쓰지 않습니다.

fingerprint는 versioned canonical envelope를 UTF-8 JSON으로 직렬화한 SHA-256입니다. 객체 키를 고정 순서로 정렬하고 참조 집합만 안정 ID/버전 순으로 정렬합니다. 의미 있는 배열·문단·줄바꿈·Unicode 원문은 보존하며 정규화로 문서 의미를 바꾸지 않습니다. 부재는 명시적 null/absent 종류로 표현하고 빈 문자열·빈 배열과 구분합니다. 숫자는 schema가 허용한 유한 정수만 받습니다. schemaVersion이 바뀌면 같은 지문 계약으로 취급하지 않습니다. hash 충돌 검사에만 의존하지 않고 필요한 버전·scope도 검증합니다. [Node 22 crypto API](https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/crypto.md)

시각·requestId·원시 인증 값은 내용 지문에서 제외합니다. 입력 변경 여부를 계산할 때는 저장한 task와 ProviderSelection을 기준으로 현재 업무 자료를 다시 조립합니다. 대기 이후 기본 provider/model 설정 변경만으로 기존 Run 선택을 바꾸거나 input changed로 만들지 않습니다.

직렬화한 모든 명시적 시스템/사용자 입력·규칙은 합계 2 MiB를 넘을 수 없습니다. 넘으면 요청을 실패시키고 축소할 입력을 안내합니다. 모델의 실제 context 상한이 더 작을 수 있으므로 adapter 오류를 성공으로 바꾸지 않습니다. UI에 받은 fingerprint만 믿지 않고 완료와 적용 시 서버가 각각 최신 자료를 비교합니다.

### ND-08 같은 저장소의 영속 대기열과 단일 실행 슬롯

**추적**: NQ-06, NQ-08, NQ-14, NQ-18, NQ-21.
**협력 책임**: LC-02, LC-03, LC-05, LC-06, LC-07.

GenerationRun과 같은 DB에 singleton ExecutionSlot 및 실행 관찰 보조 자료를 둡니다. 이는 ENT-27 GenerationRun·ENT-28 ExecutionClaim·ENT-29 ExecutionObservation 계약을 지원하는 저장 구현 정보이며 별도 공개 업무 객체가 아닙니다. 업무 엔티티와 기술 보조 자료를 구분합니다. 슬롯은 비어 있거나 정확한 runId·claimTokenHash·runtimeInstanceId·launchIntentId를 소유합니다.

M-032/M-035는 receipt 재생을 먼저 처리합니다. 새 Run이면 nonterminal(pending+running) 개수가 10 미만인지 검사하고 snapshot·pending·receipt를 같은 트랜잭션에 넣습니다. running=1이면 pending≤9, running=0이면 pending≤10입니다. terminal인데 종료 미확인인 Run은 이 개수에 넣지 않지만 슬롯을 계속 보유합니다. 새 pending 접수와 새 실행 시작을 혼동하지 않습니다. 포화여도 조회·취소를 허용합니다.

C-05의 인수 루프는 완료/취소 알림과 짧은 주기 확인으로 실행합니다. 초기 주기는 250ms입니다. M-036은 BEGIN IMMEDIATE 안에서 슬롯이 비고 다른 running이 없는지 검사하고 FIFO(createdAt, runId)의 pending 하나를 선택합니다. claim을 한 번만 발급하고 running·슬롯·launch intent를 원자적으로 확정합니다. 재시작 때 같은 Run을 다시 claim하지 않습니다. 슬롯/Run 상태가 모순되면 새 인수를 멈추고 복구 오류를 표시합니다.

슬롯은 실제 spawn 전에 예약합니다. C-05가 취소 상태를 다시 읽고 입력/지원 환경을 확인한 뒤 C-09 runner가 launchIntent에 연결된 프로세스를 시작합니다. PID 저장 전에 앱이 죽는 간격도 이미 슬롯을 보유한 상태입니다. 아무 PID도 없다는 이유만으로 그 슬롯을 비우지 않습니다. spawn을 시도하지 않았음을 살아 있는 소유자가 입증하거나 신뢰 가능한 종료를 관찰한 경우에만 M-050으로 해제합니다.

앱 프로세스마다 connection을 하나 사용해도 같은 DB를 연 두 앱 사이의 보호가 생기는 것은 아닙니다. 두 인수 요청도 DB singleton 조건으로 직렬화합니다. 메모리 busy flag·PID 파일·heartbeat 만료만으로 실행 권한을 부여하지 않습니다. 두 별도 DB 사본의 총 실행 수까지 통제한다고 주장하지 않습니다.

### ND-09 첫 terminal 승자와 종료 관찰

**추적**: NQ-02, NQ-14, NQ-15, NQ-16, NQ-17, NQ-22.
**협력 책임**: LC-02, LC-03, LC-06, LC-07, LC-08.

M-037/M-038은 원 ClaimRef와 running 상태를 조건으로 성공/실패를 확정합니다. M-034는 허용된 pending/running 상태에서 cancelled를 확정합니다. M-039는 사망이 확인된 이전 runtime 소유 running만 중단 실패로 바꿉니다. 각 전이는 compare-and-set으로 처음 확정한 terminal 상태를 유지합니다. 후속 완료·실패·취소는 기존 상태를 반환하거나 RUN_FINAL로 거절하며 다른 결과·초안을 저장하지 않습니다.

실행 제한은 spawn 시도부터 단조 시계로 300초이며 direct child의 정상 종료와 stdout/stderr 양쪽 close·최종 누적 bytes 검사·구조/참조 검증까지 포함합니다. M-037의 성공은 이 선행 조건과 deadline을 모두 확인한 뒤에만 확정합니다. 대기열 시간은 별도입니다. timer 통지만 믿지 않고 파싱/검증 후 성공 확정 직전에도 단조 시계의 deadline을 검사합니다. 긴 동기 작업 때문에 timer가 늦게 실행돼도 제한을 지난 성공을 확정하지 않습니다. 시간 초과·출력 상한 초과는 실패 확정과 종료 정리를 시작합니다. 자동 provider 재호출은 하지 않습니다. 재시도는 사용자의 M-035이며 현재 입력과 새 Run을 만듭니다.

취소 commit 후 C-05가 즉시 알림을 받고 M-049의 250ms 확인으로도 감지합니다. 실행 중이면 1초 안에 종료 신호를 보내는 목표입니다. 최초 신호 후 2초 유예를 두고 여전히 살아 있으면 지원 플랫폼에서 강제 종료를 시도합니다. 최초 취소/timeout 정리 시작부터 10초 내 종료 관찰을 목표로 합니다. 신호 전송 성공이나 child.killed는 종료 증거가 아닙니다. direct child의 exit와 stdio close, 실행 그룹의 정리 범위를 따로 관찰합니다.

Run terminal 상태·종료 신호 시각·종료 관찰은 별도입니다. M-050은 관찰 고유 키로 중복을 막고 slot.claimRef가 termination.claimRef와 같을 때만 슬롯을 해제합니다. R1 종료 관찰 후 R2가 인수한 상태에서 R1의 관찰이 다시 와도 R2 슬롯을 지우지 않습니다. 원 ClaimRef의 M-049/M-050은 terminal 후에도 허용하지만 성공/실패 재확정·다른 Run 제어 권한은 주지 않습니다.

종료 미확인은 경과 시간과 정제한 사유로 표시하고 새 인수를 막습니다. 제한 없는 대기나 거짓 정상 종료로 바꾸지 않습니다. 파이프는 동시에 소비하고 stdout 4 MiB·stderr 256 KiB의 raw 누적 상한을 각각 검사합니다. 상한을 넘은 부분 출력을 초안으로 보존하지 않습니다. 프로세스 그룹과 managed command의 한계는 ND-10/ND-11을 함께 따릅니다.

spawn이 명시적으로 실패해 실제 프로세스가 만들어지지 않았다는 runner의 결과 또는 살아 있는 소유자가 시작 시도를 하지 않았음을 확정한 결과는 no_process_created로 기록합니다. M-050의 terminationResult에 이 부재 근거를 연결해 해당 슬롯을 정리합니다. exit code·종료 시각을 만들어 내지 않습니다. PID가 없지만 spawn 여부를 모르는 crash gap은 이 경우가 아닙니다.

비동기 spawn·kill·exit·close의 의미는 Node 공식 계약을 기준으로 구현하며, 신호 전달과 실제 종료를 같은 것으로 취급하지 않습니다. [Node 22 child_process API](https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/child_process.md)

### ND-10 재시작과 실행 증거의 복구

**추적**: NQ-04, NQ-05, NQ-14, NQ-16, NQ-21, NQ-22.
**협력 책임**: LC-02, LC-03, LC-06, LC-07, LC-12.

runtimeInstanceId는 백엔드 실행마다 새로 발급합니다. runtime 등록에는 호스트 실행 환경의 식별·boot identity·부모 PID와 시작 식별자·claim/launch intent 연결을 보존합니다. 소유권 비밀은 공개 응답·로그에 넣지 않습니다. heartbeat는 관찰 신호일 뿐 사망이나 Claude 종료의 증거가 아닙니다. PID만 같거나 없어도 같은 프로세스의 생명주기를 증명한 것으로 취급하지 않습니다.

정상 DB 준비 후 10초 안에 pending·running·terminal+슬롯을 분류합니다. 이전 부모의 PID와 시작 식별자를 신뢰 가능한 OS 관찰로 비교해 이전 runtime이 사라졌다고 확인한 running만 M-039로 interrupted 실패 처리합니다. 확인할 수 없으면 상태를 꾸미지 않고 복구 판정 미확인으로 남기며 이 사례의 10초 목표를 미통과로 기록합니다. 살아 있는 다른 앱의 작업을 중단 실패로 바꾸지 않습니다.

부모 사망은 Claude와 그 자손의 종료가 아닙니다. 따라서 M-039는 슬롯을 자동 해제하지 않습니다. 재시작 전에 성공이 commit됐고 M-050만 빠졌으면 성공 초안과 상태를 그대로 두고 종료 관찰만 보충합니다. 원 소유권은 완료 확정용으로 재발급하지 않으며 복구 runtime에는 동일 claim의 검증된 관찰만 기록할 수 있는 내부 경로를 둡니다.

종료 근거는 실행별 launch handshake/identity에 연결된 정상 관찰, 지원 플랫폼에서 검증한 원 실행 그룹의 종료 관찰, 또는 같은 호스트에서 이전 실행 이후 실제 OS 부팅이 바뀌었음을 확인한 기록으로 제한합니다. 부팅 증거는 오래된 로컬 프로세스가 더 이상 실행될 수 없다는 복구 추론이며 자동 재부팅 지시가 아닙니다. VM·복원 이미지·복사한 DB·호스트 변경은 같은 호스트의 부팅 증거로 인정하지 않습니다. 구체적인 OS 조회 수단은 Infrastructure Design에서 고정하고 B-02 장애 주입으로 검증하기 전에는 지원 완료로 표시하지 않습니다.

spawn 직후 launch identity 저장 전 중단처럼 원 실행을 추적할 수 없으면 종료 미확인을 유지합니다. 운영자가 UI에서 '끝남'을 눌러 슬롯을 비우는 우회 경로를 만들지 않습니다. 신뢰 가능한 관찰이 나중에 도착하면 M-050이 기존 terminal을 유지하고 해당 슬롯만 해제합니다. 그 뒤 보존된 다른 pending Run이 자기 새 ClaimRef로 실행됩니다. 이 동안 비AI 열람·편집·검토는 사용할 수 있습니다.

host/PID 조회가 거절되거나 process group이 비어 있다는 사실만으로 탈출 자손 부재를 입증할 수 없는 환경도 종료 미확인입니다. 정상 정리의 빠른 회복과 증거 없는 crash gap의 안전한 차단을 별도 검증합니다. 종료 확인 10초를 모든 비정상 환경의 자동 복구 보장으로 확대하지 않습니다.

macOS의 boot session UUID와 실제 호스트 동일성 확인 수단을 복구 후보로 사용합니다. boot UUID는 sleep/wake와 앱 재시작으로 바뀌는 값으로 취급하지 않습니다. 동일 호스트의 다른 boot임을 확인한 경우에도 정확한 종료 코드·signal·실제 종료 시각은 알 수 없으므로 기록하지 않습니다. 관찰 시각과 host_reboot_confirmed 근거만 저장합니다. 이것은 로컬 프로세스의 부재 근거이며 원격 모델 서버의 계산 종료를 보장하지 않습니다. [Apple BootSessionUUID 정의](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/iokit/IOKit/pwr_mgt/IOPM.h), [XNU sysctl 정의](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/kern_sysctl.c)

### ND-11 Claude의 제한 실행 프로파일

**추적**: NQ-04, NQ-14, NQ-17, NQ-19, NQ-20, NQ-22, NQ-23.
**협력 책임**: LC-07, LC-08, LC-12.

첫 실제 provider는 PATH에서 찾은 설치 Claude CLI입니다. 개발 도구 Codex와 제품 provider를 분리합니다. 기본 ProviderSelection은 explicit이며 modelId는 `global.anthropic.claude-opus-4-8`입니다. 이 값을 해당 Run의 인자로 전달하고 실제 model과 provider는 출력에서 확인된 값만 기록합니다. provider와 model을 교체 가능한 계약은 유지합니다. CLI 부재·지원 옵션 미충족·관찰된 정책 충돌은 PROVIDER_UNAVAILABLE이며 비AI 서버의 시작 실패로 전파하지 않습니다.

C-09는 executable과 인자 배열, stdin을 분리해 비동기 spawn을 수행하고 shell=false를 유지합니다. 프롬프트를 명령 문자열·파일 경로·환경 변수에 넣지 않습니다. cwd는 프로젝트에서 관리하는 실행별 빈 작업 폴더입니다. 원문과 명시적 규칙은 stdin으로 전달하고 repository·다른 SR·Codex 상태를 자동 문맥으로 쓰지 않습니다. 시작 폴더만 분리했다고 OS 격리가 됐다고 표시하지 않습니다.

실행 정책은 비대화식 출력, 내장 도구 없음, MCP 없음, slash command/skill 자동 호출 없음, 새로운 세션, session persistence 없음, hooks 비활성화를 함께 요구합니다. 2026-09-09 실제 호출은 기존 인증 환경에서 이 인자 프로파일과 모델/provider 연결이 동작함을 확인했습니다. 제한 인자를 빼거나 권한 우회 모드로 바꾸는 자동 fallback은 없습니다. 제품 출력 schema, AC-17 전체 흐름, 취소·timeout·자손 정리와 전체 customization 격리는 별도 검증합니다.

safe-mode와 restricted는 사용하지 않습니다. `disableAllHooks=true`만으로 모든 managed 정책을 지웠다고 가정하지 않습니다. 표준 managed 설정 파일은 관찰되지 않았고 Bedrock의 remote managed policy fetch는 비활성으로 보고됐지만 모든 MDM과 전역 문맥의 부재를 입증하지는 않았습니다. 이 일반적 미입증만으로 검증된 연결을 막지 않습니다. 관리 MCP 충돌이나 자동 명령이 실제 관찰되면 제한을 풀지 않고 실패로 남깁니다. [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Claude 설정](https://code.claude.com/docs/en/settings)

기존 PATH·HOME·인증 환경을 보존해 Claude의 전역 설정과 credential chain을 그대로 사용합니다. 앱은 credential 값을 읽거나 복사하지 않고 전역 설정·로그인·자격 증명을 변경하지 않습니다. 자식에게 업무 API 권한·runtime 소유권·DB 경로·다른 앱 비밀을 추가로 넘기지 않으며 raw 환경 전체를 진단에 저장하지 않습니다. [Claude 비대화식 실행](https://code.claude.com/docs/en/headless)

macOS의 process group 정리는 보조 수단입니다. hooks가 별도 session을 만들 수 있으므로 group kill이 모든 자손을 포함한다고 보장하지 않습니다. managed 자동 명령 부재·도구/MCP 비활성의 지원 전제와 실제 실행 관찰을 함께 검사합니다. 다른 session/미확인 자손이 나타나면 ND-10의 종료 미확인을 유지합니다. [Claude hooks 실행 환경](https://code.claude.com/docs/en/hooks)

실제 검증은 위험 동작 유도 가상 입력·다른 SR canary·허용 밖 파일 canary·도구/MCP 호출·세션 재사용·stdout/stderr 유출을 포함합니다. 단순히 canary 변화가 없었다는 관찰만으로 모든 정책이 비활성이라고 단정하지 않습니다. 설치 프로파일·정책 근거·관찰을 함께 기록하고 변경되면 다시 검증합니다.

설치 버전 2.1.263의 도움말에서 확인한 옵션 조합은 다음과 같습니다. NFR Design 승인 시점에는 후보였으며 2026-09-09의 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`에서 같은 프로파일의 짧은 실제 호출과 모델/provider 연결을 확인했습니다. 제품 출력 schema와 AC-17 전체 동작은 B-02와 B-05에서 이어서 검증합니다.

| 인자 | 값과 목적 |
|---|---|
| --print, --input-format, --output-format | 비대화식·text 입력·json 출력입니다. |
| --tools | 빈 문자열 한 인자를 전달합니다. shell에서 생략된 인자로 바꾸지 않습니다. |
| --disallowedTools | mcp__* 한 인자를 전달합니다. shell glob으로 확장하지 않습니다. |
| --strict-mcp-config, --mcp-config | 앱 소유의 빈 MCP 설정 파일만 사용합니다. 내용은 아래 JSON입니다. |
| --no-session-persistence, --disable-slash-commands, --no-chrome | 실행 간 저장 세션·명령 확장·Chrome 연계를 제한합니다. resume/continue는 전달하지 않습니다. |
| --permission-mode, --permission-prompts | dontAsk와 none입니다. 내장/MCP 제한을 대신하지 않습니다. |
| --settings | disableAllHooks=true인 명시 JSON입니다. managed hooks 제거 수단이 아닙니다. |
| --system-prompt | 앱 소유의 고정 제어문만 전달합니다. 사용자 본문·규칙·스냅샷은 stdin에 넣고 전체 입력 상한에는 이 제어문도 포함합니다. |
| --model | explicit이면 저장된 modelId를 전달하며 기본값은 `global.anthropic.claude-opus-4-8`입니다. installed_default이면 --model을 생략합니다. |

빈 MCP 설정의 검증할 내용입니다.

```json
{"mcpServers":{}}
```

safe-mode·restricted·setting-sources·bare·권한 우회 플래그·resume/continue는 기본 프로파일에 넣지 않습니다. 옵션 확인용 help와 실제 호출 검증은 다른 증거입니다. managed MCP에 의해 strict 설정이 거절되면 자동 재시도하지 않습니다. [Managed MCP 설정 우선순위](https://code.claude.com/docs/en/managed-mcp#exclusive-control-with-managed-mcpjson)

검증된 프로파일에는 CLI 버전·모델·argv·출력 schema를 연결합니다. 이 값이 바뀌면 짧은 실제 호출과 provider 확인을 다시 실행합니다. 정책 내용 전체나 인증 값은 지문·로그의 공개 자료로 복제하지 않습니다. 모든 전역 정책의 부재를 입증하지 못했다는 사실은 기록하되 새 연결의 blocker로 쓰지 않습니다. 관찰된 정책 충돌은 해당 실행을 실패로 처리합니다.

### ND-12 결과 검증과 사람의 적용

**추적**: NQ-07, NQ-11, NQ-17, NQ-18, NQ-19, NQ-20, NQ-22.
**협력 책임**: LC-02, LC-05, LC-08, LC-09, LC-10, LC-11.

C-06은 CLI envelope를 provider 독립 결과로 정규화합니다. C-02의 S-07은 작업 종류·schemaVersion·필수 필드·SR/스냅샷 참조·새 제안 ID 범위를 다시 검사합니다. M-037 성공 확정 전에 direct child의 정상 종료 코드 0, stdout과 stderr 양쪽의 close, 각 파이프의 최종 누적 bytes 상한·입출력 오류 부재·deadline을 모두 확인합니다. stdout 결과가 먼저 완성돼도 stderr가 아직 열려 있으면 성공을 확정하지 않습니다. 실행 파일 종료 코드만으로 성공을 만들지 않습니다. JSON result의 error 상태·terminal 경쟁·timeout·누적 출력 제한·본문 schema를 모두 통과해야 합니다. 실제 CLI envelope는 B-02 fixture로 고정합니다.

JSON의 subtype이 success여도 is_error=true인 응답은 실패입니다. error로 표시된 result를 유효 문서로 저장하지 않습니다. stdout에도 오류가 올 수 있으므로 stderr 유무로 분류하지 않습니다. 알 수 없는 출력은 INVALID_OUTPUT 또는 판별 가능한 provider 실패로 처리합니다. 원시 출력은 활동·인계·오류 메시지로 복제하지 않습니다. [Claude SDK ResultMessage 계약](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-python/main/src/claude_agent_sdk/types.py)

정규화 초안은 UTF-8 직렬화 2 MiB 이하여야 합니다. M-037이 현재 입력 최신성을 확인해 새 초안을 저장하지만 오래됨은 성공 여부와 별도 표시합니다. 모델이 보낸 runId·권한·확인/승인 문자열은 신뢰하지 않고 runtime이 연결한 원 실행을 사용합니다. 출력 참조는 고정 snapshot 안에 있어야 하며 새로운 임시 제안 ID는 서버가 실제 ID로 매핑합니다.

M-018 적용은 현재 담당자의 명시적 행동입니다. 트랜잭션 안에서 현재 fingerprint·대상 버전 또는 absent·미적용 상태·실행 허용 상태를 재검사합니다. 문서 1 MiB 제한·일반 저장 규칙·ReviewImpact·활동·DraftApplication·receipt를 함께 적용합니다. 이미 적용된 초안을 다시 적용하지 않습니다. 오래된 결과는 사람이 현재 자료와 비교한 새 검토 초안으로만 재사용할 수 있으며 원 실행과 비교 근거를 보존합니다.

질문은 미답변 제안, 결정은 미확정 제안, 문서는 새 버전 초안의 사람 적용으로 저장합니다. 모델이 질문에 답하거나 결정을 확정하거나 G1/G2를 통과시키지 않습니다. 실제 provider와 테스트 adapter에 같은 계약 검증을 적용하되 테스트 성공으로 실제 Claude AC-17을 대체하지 않습니다.

### ND-13 독립 시작과 부분 기능 준비

**추적**: NQ-01, NQ-04, NQ-05, NQ-20, NQ-21, NQ-23.
**협력 책임**: LC-03, LC-06, LC-07, LC-12.

C-09 bootstrap은 명시적으로 찾은 프로젝트 루트에서 설정·내부 규칙·가상 자료를 해석합니다. 프로세스의 임의 현재 폴더나 개인 홈에 제품 자료를 저장하지 않습니다. runtime 경로의 실제 배치는 Infrastructure Design에서 정하고 테스트 저장소·PERF-100은 사용자의 DB와 분리합니다. 실행 폴더·원시 출력은 업무 저장소의 기준본이 아닙니다.

시작 순서는 설정 검증, SQLite 모듈/연결·스키마 버전 확인, 비AI 조회 준비, 중단 작업 판정, provider 지원 상태 확인, 인수 루프 활성화입니다. 일반 시작에서 시드로 기존 자료를 덮어쓰거나 자동 reset하지 않습니다. migration은 버전별 원자적 변경과 검사로 처리하며 실패 시 준비 오류로 멈춥니다. 기존 자료의 파괴적 migration은 구현 계획에서 구체적으로 검토합니다.

DB 준비와 provider 준비를 분리합니다. 정상 저장소에서 자료 조회 10초 목표는 Claude 로그인·네트워크 응답을 기다리지 않습니다. provider unavailable이면 생성 행동에 사유를 표시하고 저장·검토·내보내기는 허용합니다. 종료 미확인은 새 인수만 막으며 기존 pending과 업무 이력은 보존합니다.

정상 종료는 새 인수 중지, 진행 중 실행의 제한된 정리, 저장 중 명령 완료/rollback 확인, DB 종료 순으로 처리합니다. pending은 다음 시작까지 보존합니다. 강제 종료에 대한 증거는 ND-10으로 복구합니다. lockfile 설치·native 모듈·Chromium·실제 모델 검증은 Code Generation에서 수행합니다. 별도 프로젝트 사본에 옮겨도 내부 문서·규칙·Mock으로 같은 동작을 재현해야 합니다.

### ND-14 추적 정보와 검증 책임

**추적**: NQ-01, NQ-02, NQ-03, NQ-05, NQ-06, NQ-09, NQ-10, NQ-11, NQ-12, NQ-13, NQ-14, NQ-15, NQ-16, NQ-17, NQ-18, NQ-19, NQ-20, NQ-21, NQ-22, NQ-23, NQ-24.
**협력 책임**: LC-01, LC-02, LC-03, LC-04, LC-05, LC-06, LC-07, LC-08, LC-09, LC-10, LC-11, LC-12.

업무 활동은 같은 트랜잭션의 append 자료로 보존합니다. 진단 로그는 requestId·행동·대상 ID·확정/거절 분류·경과 시간·Run 식별자·정제한 오류 코드만 기본으로 남깁니다. 원문·전체 입력·raw stdout/stderr·소유권 token·환경·인증 값은 복제하지 않습니다. 모델 초안 본문은 의도된 업무 결과이며 로그가 아닙니다. 비밀 canary가 진단/잘못된 출력에 포함되면 공개 오류와 활동에 나타나지 않아야 합니다.

실행은 요청 provider/model·실제 확인 model·CLI 버전·프로파일 버전·시작/terminal/종료 관찰 시각을 구분합니다. 출력 raw bytes 수와 파싱/종료 오류 분류는 기록하되 raw 자체는 보존하지 않습니다. 모델/인증 원인을 확인하지 못하면 미확인으로 표시합니다. 사용자가 입력한 내용의 모든 비밀을 자동 탐지한다는 보장은 하지 않으며 현재는 가상 자료만 사용합니다.

검증 계층은 C-03 순수 규칙, C-02/C-04 실제 SQLite 경계, C-05/C-06/C-09 runner·provider 계약, C-01/C-08 브라우저 흐름, 실제 Claude 연결로 나눕니다. B-01에서 저장·권한·충돌, B-02에서 실제 CLI·취소·출력·복구, B-03/B-04에서 G1/G2, B-05에서 Handoff와 실제 AC-17 전체, B-06에서 전파·UI·성능을 연결합니다.

각 행동 변경은 예상 실패 테스트의 RED, 최소 구현 후 GREEN과 관련 전체 검증을 남깁니다. SQL/프로세스 mock만으로 원자성·실제 종료를 통과시키지 않습니다. NFR의 목표/표본을 조용히 변경하지 않고 명령·환경·결과·예상 거절·실패·미실행을 구분합니다. 현재 단계의 문서 검증은 앱 테스트·native 설치·성능·실제 Claude 성공 증거가 아닙니다.

## 3. 품질 기준과 설계의 양방향 추적

목표 수치·표본·프로파일은 승인 NFR Requirements가 기준입니다. 아래 표는 같은 기준을 어떤 패턴으로 실현할지 연결하며 목표값을 덮어쓰지 않습니다.

| 품질 기준 | 설계 패턴 |
|---|---|
| NQ-01 | ND-05, ND-13, ND-14 |
| NQ-02 | ND-01, ND-04, ND-05, ND-09, ND-14 |
| NQ-03 | ND-05, ND-06, ND-14 |
| NQ-04 | ND-01, ND-05, ND-10, ND-11, ND-13 |
| NQ-05 | ND-01, ND-03, ND-10, ND-13, ND-14 |
| NQ-06 | ND-01, ND-03, ND-08, ND-14 |
| NQ-07 | ND-02, ND-03, ND-04, ND-07, ND-12 |
| NQ-08 | ND-02, ND-08 |
| NQ-09 | ND-03, ND-14 |
| NQ-10 | ND-02, ND-04, ND-06, ND-14 |
| NQ-11 | ND-06, ND-12, ND-14 |
| NQ-12 | ND-06, ND-14 |
| NQ-13 | ND-05, ND-06, ND-14 |
| NQ-14 | ND-08, ND-09, ND-10, ND-11, ND-14 |
| NQ-15 | ND-09, ND-14 |
| NQ-16 | ND-09, ND-10, ND-14 |
| NQ-17 | ND-04, ND-05, ND-06, ND-07, ND-09, ND-11, ND-12, ND-14 |
| NQ-18 | ND-07, ND-08, ND-12, ND-14 |
| NQ-19 | ND-11, ND-12, ND-14 |
| NQ-20 | ND-07, ND-11, ND-12, ND-13, ND-14 |
| NQ-21 | ND-08, ND-10, ND-13, ND-14 |
| NQ-22 | ND-04, ND-09, ND-10, ND-11, ND-12, ND-14 |
| NQ-23 | ND-01, ND-07, ND-11, ND-13, ND-14 |
| NQ-24 | ND-14 |

## 4. 구현 시 검증할 경계 사례

NT는 승인된 Functional Design 시나리오를 구체적인 기술 경쟁·장애로 확장한 검증 설계입니다. 이번 단계에서 테스트 코드를 실행했다는 뜻이 아닙니다. 기존 24개 시나리오 전체와 34개 스토리·122개 개별 기준·7개 공통 기준은 ND-14와 단위 스토리 맵의 완료 책임을 유지합니다.

| 사례 | 입력·경쟁 | 판정 | 패턴 | 기존 시나리오 |
|---|---|---|---|---|
| NT-01 | 동일 키의 프로젝트 명령 두 개와 다른 명령 재사용입니다. | receipt/대상/활동은 한 개이고 다른 명령은 충돌입니다. | ND-02, ND-08 | SCN-03, SCN-14 |
| NT-02 | 저장 각 지점과 commit 후 응답 전 중단입니다. | 부분 변경이 없고 재요청은 고정 receipt입니다. | ND-01, ND-02, ND-03 | SCN-09, SCN-11, SCN-14 |
| NT-03 | 같은 묶음의 두 검토자 승인과 배정 제거를 교차합니다. | 두 유효 승인은 공존하고 제거된 검토자는 거절됩니다. | ND-02, ND-03, ND-04 | SCN-05, SCN-08, SCN-12 |
| NT-04 | G1 변경과 G2 통과·현재 인계 내보내기를 경쟁시킵니다. | 확정 순서에 맞는 현재 기준만 통과하며 옛 G2를 복구하지 않습니다. | ND-02, ND-03 | SCN-08, SCN-09, SCN-21 |
| NT-05 | H2를 활성화한 뒤 H1 완료를 기록합니다. | H1 이력만 늘고 H2와 현재 SR의 완료를 만들지 않습니다. | ND-03 | SCN-22 |
| NT-06 | 11번째 접수·동일 receipt 재생·두 runtime 인수를 경쟁시킵니다. | 총량·단일 슬롯을 지키며 포화여도 조회/취소가 됩니다. | ND-02, ND-08 | SCN-14, SCN-16, SCN-17 |
| NT-07 | R1 종료 후 R2 인수, 이어 R1 M-050을 재전송합니다. | R2 슬롯과 Run은 유지되고 R1 관찰은 중복되지 않습니다. | ND-08, ND-09, ND-10 | SCN-16, SCN-17 |
| NT-08 | 완료·취소·실패·timeout과 stdout 종료 후 늦은 stderr 초과의 순서를 바꿉니다. | 최초 terminal만 남고 종료 사실은 별도입니다. | ND-09, ND-12 | SCN-16, SCN-17, SCN-20 |
| NT-09 | claim 직후·spawn 직후·PID 저장 전 부모를 중단합니다. | 재인수하지 않고 증거 없는 슬롯을 유지합니다. | ND-08, ND-09, ND-10 | SCN-16, SCN-17 |
| NT-10 | spawn의 확정 실패와 PID 없는 crash gap을 비교합니다. | no_process_created만 정리하고 unknown은 실행을 막습니다. | ND-09, ND-10 | SCN-16, SCN-17, SCN-20 |
| NT-11 | 성공 commit 후 종료 관찰 전 재시작합니다. | 성공 초안을 보존하고 같은 claim의 종료만 보충합니다. | ND-09, ND-10, ND-12 | SCN-16, SCN-17 |
| NT-12 | 같은 boot·sleep·다른 host 사본·검증된 동일 host reboot를 구분합니다. | 근거가 부족하면 unknown이며 확인된 reboot만 이전 실행 부재로 기록합니다. | ND-10, ND-13 | SCN-17, SCN-24 |
| NT-13 | 입력 변경·설정 변경·absent 생성·오래된 결과 적용을 경쟁시킵니다. | 선택은 고정하고 현재 입력/대상 충돌은 거절합니다. | ND-07, ND-12 | SCN-15, SCN-19, SCN-20 |
| NT-14 | 각 bytes 상한과 1바이트 초과·한국어·동시 파이프 폭주입니다. | 잘라낸 성공 없이 기존 원문·승인을 보존합니다. | ND-04, ND-05, ND-07, ND-09, ND-12 | SCN-14, SCN-15, SCN-20, SCN-24 |
| NT-15 | CLI 제한 조합·managed 충돌·위험 출력·is_error를 검사합니다. | 경계 미확보는 AI만 실패하고 raw 진단은 노출하지 않습니다. | ND-11, ND-12, ND-13, ND-14 | SCN-18, SCN-19, SCN-20, SCN-24 |
| NT-16 | 5 context·같은 화면의 Q2/Q1 응답 역전·dirty 폼·악성 Markdown·키보드·실측입니다. | actor/SR 혼합 없이 실제 내용·차단 이유·시간을 검증합니다. | ND-04, ND-05, ND-06, ND-14 | SCN-12, SCN-23, SCN-24 |

## 5. 다음 단계로 넘길 실행 검증

Infrastructure Design에서 프로젝트 내부의 DB·실행별 임시 폴더·허용 origin·CLI 설정 파일·runtime 관찰 경로를 구체화합니다. same-host boot identity와 PID/시작 식별자·프로세스 그룹을 확인하는 OS 수단을 고정합니다. wrapper를 추가하지 않는 초기 구성에서 확인할 수 없는 종료는 ND-10의 unknown 경로로 남깁니다.

2026-09-09의 짧은 실제 호출은 CLI 프로파일·기존 인증 호환성·모델/provider 연결과 도구/MCP/subagent 미사용을 확인했습니다. Code Generation B-02는 제품 출력 schema·managed 자동 명령·세션·취소·종료·자손·비밀 비노출을 이어서 검증합니다. 이 조건을 충족하지 못하면 원인을 기록하며 실제 AI 전체 완료를 선언하지 않습니다. 패키지/native 조합·SQLite crash/경쟁·브라우저 표시·성능·사용성도 각각 실제 증거가 필요합니다.

NFR Design 승인 시점에는 문서·공식 근거와 로컬 도움말/버전만 확인했습니다. 이후 2026-09-09에 짧은 실제 Claude 생성을 실행해 exit 0과 `global.anthropic.claude-opus-4-8`/Bedrock을 확인했습니다. 앱 통합·DB·브라우저·AC-17 전체·취소·timeout·복구·OS 재부팅은 아직 실행하지 않았습니다. Security Baseline·Resiliency Baseline·PBT는 비활성으로 개별 규칙의 로딩·적용을 생략했고 준수 판정은 N/A입니다. 기본 NFR과 이후 행동 변경의 TDD는 유지합니다.
