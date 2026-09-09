# PlanRepo 로컬 실행 아키텍처

버전은 0.1이며 **사용자 승인 완료**입니다. 사용자 응답 “응 승인함 진행해”를 2026-09-08T16:10:00Z에 기록했습니다. 승인된 단일 UOW-01을 한 호스트의 브라우저·Node 백엔드·SQLite·설치 Claude에 배치합니다. 여기서 배포는 로컬 앱의 빌드와 실행 구성을 뜻합니다. 클라우드·운영 서비스 공개·실제 조직 인증은 포함하지 않습니다. 아래 경로·포트·명령은 구현할 설계이며 현재 실행 가능한 앱이나 검증 결과를 뜻하지 않습니다.

## 1. 기준과 실행 범위

9개 C 모듈·9개 S 서비스·50개 M 메서드는 `aidlc-docs/inception/application-design/components.md`, `aidlc-docs/inception/application-design/component-methods.md`, `aidlc-docs/inception/application-design/component-dependency.md`를 유지합니다. 단일 UOW와 개발 묶음의 책임은 `aidlc-docs/inception/application-design/unit-of-work.md`, `aidlc-docs/inception/application-design/unit-of-work-story-map.md`를 따릅니다.

12개 LC와 14개 ND는 `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`, `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`를 구현 환경에 연결하는 기준입니다. 수치·표본은 `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`, 기술 선택은 `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md`를 따릅니다. 상세 업무 상태와 화면은 `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`, `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`에 연결합니다.

프로세스나 폴더가 나뉘어도 새 제품 서비스·추가 UOW·공개 메서드를 만들지 않습니다. 여러 unit이 공유하는 인프라는 없으므로 별도 shared-infrastructure 산출물은 N/A입니다. 모든 파일 경로는 프로젝트 루트 기준입니다. 설정 값·데이터 수명·OS 관찰 수단의 상세 계약은 `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`와 함께 검토합니다.

## 2. 실행 환경과 프로세스

| 구분 | 실행 위치·주소 | 맡는 역할 | 상태와 제한 |
|---|---|---|---|
| 기준 호스트 | macOS 계열 arm64, 16 GiB RAM, 물리 코어 8개입니다. | 승인된 로컬 데모와 측정 기준입니다. | 실제 패키지·브라우저·프로세스 제어의 호환성은 후속 검증 대상입니다. |
| 기존 런타임 | Node 22.23.2, npm 10.9.8입니다. | 백엔드와 빌드·검증 명령을 실행할 기준입니다. | 시스템 업그레이드·전역 도구 변경을 준비 조건으로 추가하지 않습니다. |
| 일반 실행 UI | 브라우저의 `http://127.0.0.1:4173`입니다. | Fastify가 제공한 `dist/web/`의 정적 UI를 사용합니다. | UI와 API가 같은 origin을 사용합니다. |
| 일반·개발 백엔드 | Node와 Fastify가 `127.0.0.1:4173`에서 수신합니다. | C-02부터 C-09까지와 내부 생성 관리 루프를 실행합니다. | loopback 전용이며 LAN 공개·자동 포트 이동을 하지 않습니다. |
| 개발 UI | Vite가 `127.0.0.1:5173`에서 strictPort로 수신합니다. | UI HMR과 백엔드로의 명시적 프록시를 제공합니다. | 개발 프로세스이며 Claude 작업 소유자가 아닙니다. |
| 로컬 저장 | 백엔드 안의 better-sqlite3와 SQLite입니다. | 업무·버전·작업·슬롯·관찰·receipt를 저장합니다. | 별도 DB 서버나 broker를 실행하지 않습니다. |
| 실제 생성 | 설치 Claude CLI 2.1.263을 PATH로 찾는 제한 자식 프로세스입니다. | 고정 입력에서 질문·결정 제안·문서 초안을 만듭니다. | 2026-09-09 짧은 실제 호출은 exit 0과 `global.anthropic.claude-opus-4-8`/Bedrock을 확인했습니다. 같은 DB의 슬롯·앱 통합·전체 격리는 후속 검증 대상입니다. |
| 테스트 실행 | 별도 테스트 설정과 저장 경로의 앱·브라우저입니다. | 가상 fixture·경쟁·장애·성능을 재현합니다. | 사용자 DB와 분리하며 포트 충돌을 확인합니다. 지원하지 않은 환경의 성공으로 일반화하지 않습니다. |

일반 실행의 기본 서버는 하나입니다. 개발 실행의 명령 관리자는 Vite와 백엔드 두 자식을 관리합니다. Claude는 백엔드가 맡는 별도 실행이며 브라우저·Vite·개발 명령 관리자가 업무 Run을 직접 claim하지 않습니다. 같은 DB를 두 백엔드가 열게 되는 상황에서도 ND-08의 DB singleton 슬롯으로 실제 생성 경쟁을 막습니다. 별도 DB 사본 전체의 총 실행 수를 통제한다고 주장하지 않습니다.

## 3. 요청 경로와 노출 경계

일반 브라우저는 4173에서 UI를 받고 같은 origin의 `/api` 경로로 업무 요청을 보냅니다. 백엔드는 정확한 Host·허용 Origin·JSON 입력을 검사한 뒤 C-02의 공개 계약을 호출합니다. 서버 전역의 현재 사용자를 두지 않으며 각 브라우저 context가 선택한 가상 사용자와 현재 배정을 매 요청에서 확인합니다.

개발 브라우저는 5173만 사용합니다. Vite는 `/api`와 `/health` 경로만 4173 백엔드에 프록시합니다. 프록시는 changeOrigin=true로 upstream Host를 `127.0.0.1:4173`에 맞추되 브라우저 Origin은 `http://127.0.0.1:5173`을 유지합니다. 백엔드의 개발 설정은 이 Origin만 허용하며 일반 실행은 `http://127.0.0.1:4173`만 허용합니다. 개발 브라우저가 백엔드를 직접 교차 origin으로 호출하는 구성을 사용하지 않습니다. GET `/health/live`는 서버 생존 상태를, GET `/health/ready`는 비AI 저장소 사용 준비를 표시합니다. ready는 DB가 준비됐으면 200, DB가 준비되지 않았으면 503입니다. provider 불가나 종료 미확인만으로 준비된 비AI 앱을 503으로 내리지 않습니다. 이 기술 경로는 업무 M 메서드를 추가하지 않습니다.

일반 실행과 개발 실행 모두 포트가 이미 사용 중이면 준비 실패를 표시합니다. 자동으로 다른 포트를 선택하거나 `0.0.0.0`에 공개해 문제를 우회하지 않습니다. 브라우저 주소·프록시 upstream·허용 Host/Origin은 같은 실행 설정에 맞춰 검증합니다. 테스트 실행도 명시한 설정을 사용하며 실행 중인 사용자 앱의 포트를 빼앗지 않습니다.

M-001부터 M-035, M-040부터 M-048까지 공개 44개 계약만 업무 HTTP 경로에 연결합니다. 내부 M-036, M-037, M-038, M-039, M-049, M-050은 백엔드 내부 주체만 호출합니다. health는 로컬 준비 상태를 알리는 기술 경로이며 내부 실행 토큰·개인 경로·원시 오류를 노출하지 않습니다. 일반 실행의 UI 정적 제공 범위는 `dist/web/`로 제한하고 프로젝트 루트·설정·DB·실행 폴더·로그를 정적 파일로 제공하지 않습니다.

개발 Vite root는 `src/web/`로 두고 fs.strict와 명시적 allow 목록인 `src/web/`, `src/contracts/`, `node_modules/`를 사용합니다. `config/`, `.planrepo/`, `aidlc-docs/`, `requirements/` 등 제품 자산을 UI public 폴더로 복사하지 않습니다. `/@fs` 접근과 public 경로까지 포함해 미허용 파일의 비노출을 검증합니다. 정적 접근 제한을 실제 OS 프로세스 격리로 표현하지 않습니다.

## 4. 모듈의 프로세스·저장 매핑

| 모듈 | 코드 경로 | 실행 위치 | 소유·사용 자료와 경계 | LC·ND 연결 |
|---|---|---|---|---|
| C-01 WebUI | `src/web/` | 브라우저입니다. | FormDraft·조회 키·응답 순번을 관리합니다. DB·CLI를 직접 호출하지 않습니다. | LC-10, LC-11; ND-04, ND-05, ND-06 |
| C-02 ApplicationServices | `src/application/` | 백엔드입니다. | 9개 서비스의 순서·현재 검사·저장 확정을 조정합니다. C-05/C-06 직접 호출을 추가하지 않습니다. | LC-01, LC-02, LC-04, LC-05, LC-06, LC-09; ND-01, ND-02, ND-03, ND-04, ND-07, ND-08, ND-12, ND-14 |
| C-03 DomainPolicies | `src/domain/` | 백엔드입니다. | 현재 스냅샷의 권한·게이트·ReviewImpact를 순수하게 판단합니다. | LC-02, LC-04, LC-05; ND-02, ND-03 |
| C-04 LocalPersistence | `src/persistence/` | 백엔드입니다. | 앱 프로세스별 단일 SQLite 연결과 영속 자료의 유일한 쓰기 경계입니다. | LC-03, LC-04, LC-05, LC-06, LC-09; ND-01, ND-02, ND-03, ND-05, ND-08, ND-10 |
| C-05 GenerationRuntime | `src/generation-runtime/` | 백엔드의 관리 루프입니다. | 내부 S-07로 Run을 인수하고 C-06과 실행 소유권·취소·종료 관찰을 연결합니다. | LC-06, LC-07; ND-08, ND-09, ND-10 |
| C-06 GenerationProviders | `src/providers/generation/` | adapter 코드는 백엔드입니다. | C-09 제한 실행으로 Claude를 호출하며 provider 출력만 정규화합니다. 업무 저장소를 받지 않습니다. | LC-08, LC-09; ND-07, ND-09, ND-11, ND-12 |
| C-07 ReferenceProviders | `src/providers/reference/` | 백엔드입니다. | 프로젝트의 Jira/GitHub Mock 자산과 명시적 링크만 사용합니다. 실제 API 쓰기·임의 수집을 추가하지 않습니다. | LC-02, LC-12; ND-13, ND-14 |
| C-08 DocumentPresentation | `src/presentation/` | 백엔드의 순수 표현 계층입니다. | 받은 불변 자료의 안전한 표현·원문 비교·고정 인계 직렬화를 맡습니다. | LC-04, LC-10; ND-03, ND-05, ND-06, ND-12 |
| C-09 ProjectRuntime | `src/runtime/` | 백엔드의 기반 계층입니다. | 설정·시각·ID·PATH 탐색·제한 프로세스 실행 포트를 제공합니다. | LC-01, LC-07, LC-08, LC-12; ND-04, ND-09, ND-10, ND-11, ND-13, ND-14 |

`src/main.ts`는 이 모듈의 포트를 조립하는 진입점 후보입니다. 조립 코드가 모듈을 연결하는 것과 C-09의 기반 포트가 상위 업무 모듈을 역호출하는 것은 다릅니다. `src/contracts/`는 I/O 없는 wire DTO·schema 계약의 공유 배치 후보이며 새 C 모듈이 아닙니다. C-01은 공유 계약과 C-02의 응답을 사용하고 C-08의 서버 구현·DB·프로세스 코드를 브라우저에 포함하지 않습니다. 정확한 파일과 빌드 출력 구성은 Code Generation 계획에서 정합니다.

## 5. 프로젝트 자산과 수명

| 자산 | 프로젝트 루트 기준 경로 | 소유와 수명 |
|---|---|---|
| 앱 설정 | `config/planrepo.json` | 모드·경로·포트·제품 제한을 연결할 설정입니다. 비밀 값과 개인 고정 경로를 넣지 않습니다. |
| Claude 제한 설정 | `config/claude/mcp-empty.json`, `config/claude/launch-policy.json` | 빈 MCP 구성과 승인된 제한 실행 프로파일을 관리합니다. 전역 Claude 설정을 수정하는 수단이 아닙니다. |
| 가상 자산 | `config/`, `tests/fixtures/` | 승인된 가상 사용자·네 시드·Mock과 별도 검증 fixture를 보존합니다. 실제 사내 자료를 넣지 않습니다. |
| 업무 DB | `.planrepo/data/planrepo.sqlite` | 확정 문서·묶음·승인·Run·실행 슬롯·관찰·활동·receipt의 기준입니다. 정상 시작에서 초기화하지 않습니다. |
| 실행별 작업 폴더 | `.planrepo/runs/<runId>/<claimId>/` | 실행별 빈 cwd를 제공할 임시 공간입니다. claimId는 비밀 token 원문과 구분한 식별자입니다. 프롬프트·다른 SR 자료를 파일로 복제하지 않습니다. |
| 정제한 진단 | `.planrepo/logs/` | 정제한 오류·식별자·경과 시간만 남깁니다. 업무 원문·raw stdout/stderr·소유권 token의 저장소가 아닙니다. |
| 테스트 격리 | `.planrepo/test-runs/<testRunId>/` | 실행별 테스트 DB·가상 자산·검증 결과를 사용자 자료와 분리합니다. 정확한 하위 배치는 테스트 계획에서 정합니다. |
| 브라우저 정적 파일 | `dist/web/` | 빌드로 재생성하는 UI 산출물입니다. 업무 저장본을 넣지 않습니다. |
| 인계 파일 | 브라우저 다운로드입니다. | DB의 고정 Handoff bytes를 전달합니다. 다운로드 위치는 브라우저가 결정하며 파일 경로가 업무의 현재 기준이 되지 않습니다. |

업무 DB는 DELETE rollback journal·FULL 동기화·외래 키 검사·짧은 BEGIN IMMEDIATE 트랜잭션을 사용합니다. 실행별 폴더나 로그를 지워도 DB의 실행 종료 증거가 생기는 것은 아닙니다. 종료 미확인 실행과 관련된 자료를 지워 슬롯을 해제하는 정리 방식을 사용하지 않습니다.

프로젝트 사본은 자체 소스·내부 규칙·설정·가상 자산·lockfile로 준비할 수 있어야 합니다. 기존 DB를 옮기는 절차와 실행 관찰 자료의 취급은 상세 인프라 설계의 데이터 수명 규칙을 따릅니다. 동작 중인 DB 파일을 복사한 사실만으로 일관된 복구본이나 실행 종료를 확인했다고 판단하지 않습니다. 새 테스트는 사용자의 DB를 초기화하거나 복사해 만드는 것을 기본 절차로 삼지 않습니다.

## 6. 준비·실행 명령의 설계

다음은 Code Generation에서 package scripts와 구현을 갖춘 뒤 제공할 명령 계약입니다. 현재 실행하지 않았으며 이 표만으로 명령이 동작한다고 주장하지 않습니다.

| 순서·목적 | 제안 명령 | 준비·결과 계약 |
|---|---|---|
| 의존성 준비 | `npm ci` | manifest·lockfile이 맞는 설치를 재현합니다. native·브라우저 준비와 실제 Claude 연결은 별도로 검증합니다. |
| 타입 검사 | `npm run typecheck` | UI·백엔드·공유 계약을 검사합니다. 빌드가 타입 검사를 대신하지 않습니다. |
| 기본 테스트 | `npm test` | 승인된 테스트 계획에 따른 단위·계약·통합 검증을 실행합니다. 실제 Claude 통과를 자동으로 뜻하지 않습니다. |
| 빌드 | `npm run build` | UI와 백엔드 산출물을 만듭니다. 일반 UI는 `dist/web/`에서 제공할 수 있어야 합니다. |
| DB schema 준비 | `npm run db:migrate` | 서버가 정지된 상태에서 지원 schema를 준비하거나 명시 migration을 적용합니다. 시드보다 먼저 실행합니다. |
| 최초 가상 자료 준비 | `npm run seed:demo` | 서버가 정지된 상태에서 지원 schema를 가진 빈 업무 DB에만 DEMO-4와 manifest를 원자적으로 기록합니다. 기존 seed 완료 표식이나 사용자 자료가 있으면 거절합니다. |
| 일반 실행 | `npm start` | 빌드된 백엔드와 정적 UI를 4173에서 제공합니다. 저장소 준비와 provider 준비를 나눕니다. |
| 개발 실행 | `npm run dev` | 5173 Vite와 4173 백엔드의 두 자식을 관리하고 정상 종료를 전달합니다. 자동 포트 이동을 하지 않습니다. |

시드는 DB 파일의 단순 존재 여부로 판단하지 않습니다. migration으로 schema를 만든 빈 DB도 초기 시드 대상이 될 수 있습니다. 업무 자료·완료 표식의 부재 검사와 네 시드 전체·manifest 저장은 같은 트랜잭션입니다. 일반 앱 시작이나 재시작에서 시드를 자동 적용하지 않습니다.

브라우저 검증·PERF-100·실제 Claude 전체 흐름의 세부 명령과 fixture는 Code Generation과 Build and Test에서 연결합니다. 2026-09-09의 짧은 실제 호출 근거는 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`에 있습니다. 기본 테스트나 설치 hook에 실제 모델 호출·인증 변경·외부 시스템 쓰기를 숨기지 않습니다. 명령·환경·exit code·실패·건너뛴 검증을 기록하며 테스트 adapter와 실제 연결 증거를 구분합니다.

UI HMR은 브라우저 표시 코드만 갱신하며 백엔드의 ClaimRef·실행 핸들·인수 루프를 교체하지 않습니다. 백엔드 코드 변경으로 재시작이 필요하면 새 인수를 멈추고 기존 runner의 정리·저장 확정을 먼저 처리합니다. 정상 종료를 확인하지 못한 경우에도 새 백엔드는 DB의 unknown 슬롯을 존중합니다. 개발 도구의 재시작을 근거로 같은 Run을 다시 실행하거나 Claude 종료를 가정하지 않습니다.

## 7. 핵심 실행 흐름

1. **시작**: 앱 조립부는 프로젝트 설정과 선택한 일반/개발 모드를 검증합니다. C-04가 실제 DB·스키마와 저장 설정을 확인하면 비AI 조회를 준비합니다. C-05는 내부 M-039로 중단 작업을 판정하고 C-09/C-06의 provider 준비 결과를 확인합니다. CLI가 없거나 검증 프로파일이 맞지 않아도 비AI 준비를 유지하며 실제 생성만 막습니다.
2. **조회와 저장**: 브라우저는 선택한 actor와 ProjectScope/SrScope로 요청합니다. 개발 모드는 Vite 프록시를 거칩니다. C-02는 C-04의 일관된 읽기와 C-03/C-08의 순수 결과를 조합합니다. 변경은 현재 역할·guard·receipt·검토 영향을 한 짧은 저장 경계에서 확정합니다. C-01은 현재 조회 키와 매 발행 순번을 검사하고 dirty 입력을 보존합니다.
3. **생성**: M-032/M-035가 현재 입력·ProviderSelection·pending·receipt를 함께 저장합니다. C-05가 M-036으로 DB 슬롯을 인수한 뒤 C-06/C-09가 실행별 폴더에서 Claude를 호출합니다. 외부 생성은 DB 트랜잭션 밖입니다. 정규화·현재 상태 검사를 거쳐 M-037/M-038로 초안 또는 실패를 저장하고 실제 종료는 M-050으로 따로 관찰합니다. 사람의 M-018 적용은 별도입니다.
4. **취소와 재시작**: M-034의 취소 확정과 M-049의 제어 조회, 신호 전달, 실제 종료를 구분합니다. 같은 ClaimRef의 검증된 종료 관찰만 해당 슬롯을 해제합니다. 이전 관찰로 다른 실행의 슬롯을 해제하지 않습니다. 부모 앱의 종료·PID 부재·heartbeat 만료는 자식 종료의 증거가 아닙니다. 종료 미확인 동안 비AI 기능과 기존 pending을 보존합니다.
5. **인계**: M-040은 현재 유효한 G1/G2와 정확한 자료에서 고정 본문을 만듭니다. M-041은 같은 고정 인계와 현재 유효성을 보여줍니다. M-042는 확정 시 현재 조건을 다시 검사한 bytes를 잠금 밖에서 다운로드합니다. H1/H2의 외부 시작·완료는 선택한 인계에 연결하며 파일 다운로드가 새 승인이나 외부 구현 시작을 만들지 않습니다.
6. **종료**: 일반 실행과 개발 명령 관리자는 새 인수를 중지하고 진행 실행의 제한된 정리를 요청합니다. 저장 중 명령의 완료 또는 rollback을 확인한 뒤 DB와 서버를 닫습니다. pending과 업무 이력을 보존합니다. 강제 종료나 미확인 정리는 ND-10의 복구 대상으로 남기고 자동 reset으로 지우지 않습니다.

## 8. 실패와 후속 검증

| 상황 | 설계상 처리 | 필요한 실제 증거 |
|---|---|---|
| 4173 또는 5173 포트 충돌 | 준비 오류를 표시하고 포트나 bind 주소를 자동 변경하지 않습니다. | 일반 실행·개발 실행의 충돌과 자식 프로세스 정리입니다. |
| 정적 UI 산출물 누락 | 일반 실행의 준비 오류를 표시합니다. 개발 UI는 Vite 준비 상태로 구분합니다. | 빌드 전후 시작과 잘못된 정적 경로의 비노출입니다. |
| DB 열기·migration·commit 실패 | 빈 DB·가짜 성공으로 전환하지 않고 저장 오류를 표시합니다. | 실제 SQLite 장애·재개방·receipt 확인·확정 자료 보존입니다. |
| CLI 부재·실행 정책 미확인 | 실제 생성만 막고 조회·편집·검토·유효 인계 내보내기를 유지합니다. | CLI 없는 시작과 실제 연결 상태·앱 준비 상태의 구분입니다. |
| 개발 proxy Host/Origin 불일치 | 요청을 거절하고 준비 설정을 수정할 근거를 표시합니다. | 5173 브라우저 Origin 유지·4173 upstream Host·일반/개발 허용 목록입니다. |
| 취소·HMR·백엔드 재시작 경쟁 | 첫 terminal과 실행 슬롯을 보존하며 UI 갱신으로 소유권을 바꾸지 않습니다. | 실제 프로세스의 취소·종료 관찰과 중단 후 같은 Run 재실행 거절입니다. |
| 늦은 조회·저장 응답 유실 | 현재 키/순번과 같은 제출의 receipt로 판단합니다. | 같은 화면 Q2/Q1 역전·5개 context·dirty 입력 보존입니다. |
| 큰 문서·출력·인계 | 각 bytes 제한을 적용하고 부분 내용을 성공으로 전달하지 않습니다. | 200 KiB 대표 문서·각 상한/1바이트 초과·생성 중 비AI 지연 측정입니다. |
| 악성 본문·진단 canary | 안전한 표시와 정제된 진단을 사용하며 원문을 임의로 바꾸지 않습니다. | 문서·diff·초안·인계·오류·로그의 실제 브라우저/기록 검사입니다. |
| 프로젝트 사본 실행 | 사본 내부 자산과 명시 런타임으로 준비하고 원 프로젝트를 자료 저장소로 사용하지 않습니다. | 별도 경로의 설치·타입 검사·테스트·빌드·실행과 독립 DB 확인입니다. |

NQ-01부터 NQ-24까지의 수치와 책임은 승인된 NFR 문서와 LC 검증표를 유지합니다. B-01에서 저장·준비·권한·원자성, B-02에서 실제 Claude 제한·출력·취소·복구를 먼저 확인합니다. B-05에서 실제 질문·후속 문서·사람 적용·검토·인계의 AC-17 전체를 검증하고 B-06의 UI·전파·성능·접근성 완료 책임을 유지합니다. 개발자가 직접 클릭한 결과만으로 대표 사용자의 10초 과업 관찰을 대신하지 않습니다.

Infrastructure Design 승인 시점에는 설계 문서만 작성했고 package scripts·설정 파일·실행 폴더·앱 소스·설치·DB·브라우저·Claude 실행·성능은 미검증이었습니다. 이후 2026-09-09에 기존 설치 환경의 짧은 실제 Claude 호출과 모델/provider 확인을 마쳤습니다. 앱 통합·AC-17 전체·취소·timeout·복구·전체 격리·성능은 남아 있습니다. 운영 배포·외부 기록 생성·인증 변경은 하지 않았습니다. Security Baseline·Resiliency Baseline·PBT 확장은 비활성으로 적용을 생략했으며 N/A입니다. 기본 NFR과 행동 변경의 TDD는 유지합니다.
