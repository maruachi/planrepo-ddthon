# PlanRepo 인프라 설계

버전은 0.1이며 **사용자 승인 완료**입니다. 사용자 응답 “응 승인함 진행해”를 2026-09-08T16:10:00Z에 기록했습니다. 승인된 UOW-01의 12개 LC·14개 ND를 한 macOS 호스트의 실행·저장·설정·복구 구조로 연결합니다. 이 문서의 경로·JSON·npm 명령은 후속 구현 계약입니다. 앱·설정 파일·DB·실행 가능한 빌드를 이 단계에서 만들지 않았습니다.

## 1. 기준과 읽는 방법

승인된 기능은 `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`, `aidlc-docs/construction/planrepo/functional-design/business-rules.md`, `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`, `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`를 유지합니다. 정량 기준은 `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`, 기술 선택은 `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md`입니다.

논리 책임과 복구 조건은 `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`, `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`를 따릅니다. 기존 모듈과 개발 묶음은 `aidlc-docs/inception/application-design/unit-of-work.md`에 있습니다. 작성 계획은 `aidlc-docs/construction/plans/planrepo-infrastructure-design-plan.md`, 프로세스와 요청 흐름은 `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`에 연결합니다.

이 문서의 모든 제품 파일 경로는 프로젝트 루트에서 시작합니다. OS 명령 경로는 시스템 관찰 수단이며 프로젝트 외부의 업무 자료를 참조하지 않습니다. 현재 환경 확인·공식 API 근거·후속 실행 검증을 구분합니다. 앱 독립성은 소스·설정·가상 자료의 자체 완결성을 뜻하며 설치 Claude·인증·모델 통신까지 프로젝트 파일에 포함한다는 뜻은 아닙니다.

## 2. 실제 환경 매핑

### INF-01 실행 환경과 프로젝트 루트

**설계 추적**: ND-13, ND-14입니다.

**논리 책임**: LC-01, LC-12입니다.

현재 읽기 전용 확인은 Node v22.23.2, npm 10.9.8, macOS 26.6.2/Darwin 25.6.0 arm64, 설치 Claude Code 2.1.263입니다. 기존 NFR의 16 GiB·8 physical CPU 측정 환경을 유지합니다. 새 Node·전역 CLI·인증 설정·OS 서비스를 설치하지 않습니다. 패키지/native 조합과 브라우저 실행은 아직 확인하지 않았습니다.

앱은 Node backend 한 개와 브라우저를 기본으로 하며 Claude만 작업별 자식 프로세스로 실행합니다. C-05의 인수 루프는 backend 안에 있습니다. Docker·클라우드 VM·Redis·외부 작업 서버·launchd 서비스 등록은 추가하지 않습니다. macOS arm64에서 검증한 동작을 모든 OS 지원으로 표시하지 않습니다.

제품 루트는 명시적인 PLANREPO_ROOT 또는 실행 진입점과 package manifest의 정해진 배치로 결정합니다. 임의의 상위 폴더·다른 프로젝트를 탐색하지 않습니다. 기본 진입점은 src/main.ts이며 build 뒤 dist/server/main.js입니다. source와 build 진입점은 같은 프로젝트 루트를 해석합니다. 명시 루트는 런타임에서 realpath로 해석하며 문서·설정에 개인 절대경로를 고정하지 않습니다.

실행 명령은 프로젝트 루트에서 시작합니다. config와 자료 경로는 이 루트에 붙여 해석하고 상위 폴더 성분·NUL·허용 밖 절대경로·symlink 탈출은 거절합니다. runtime 데이터 위치나 루트의 부재를 전역 홈 저장소로 fallback하지 않습니다. symlink의 실제 대상이 같은 프로젝트 루트 안인지 확인하며 테스트에서도 같은 경계를 검사합니다.

### INF-02 코드·설정·저장 경로

**설계 추적**: ND-01, ND-07, ND-11, ND-13입니다.

**논리 책임**: LC-03, LC-05, LC-08, LC-12입니다.

아래는 Code Generation에서 만들 경로의 계약입니다. 현재 이 단계에서 이 앱 파일·폴더는 만들지 않았습니다. 기존 9개 모듈의 src 경로는 단위 정의와 같습니다.

| 경로 | 역할과 보존 조건 |
|---|---|
| `src/main.ts` | 모듈을 조립하는 서버 진입점입니다. C-09 기반 포트가 업무 모듈을 역호출하지 않도록 조립 책임을 분리합니다. |
| `src/contracts/` | I/O 없는 wire DTO·공개 요청/응답 schema를 둡니다. 새 업무 구성요소가 아닙니다. |
| `src/persistence/migrations/` | 버전 순서가 고정된 앱 migration 소스와 checksum을 둡니다. |
| `config/planrepo.json` | 아래 제품 설정의 기본값입니다. 실제 인증 비밀을 넣지 않습니다. |
| `config/claude/mcp-empty.json` | 내용이 {"mcpServers":{}}인 앱 소유 제한 설정입니다. |
| `config/claude/launch-policy.json` | ND-11 프로파일 버전·고정 인자/허용 환경 정책을 둡니다. 사용자 임의 명령을 실행하는 설정이 아닙니다. |
| `config/demo/` | 가상 사용자·팀·프로젝트·DEMO-4 manifest를 둡니다. 실행 시 외부 사례 폴더를 읽지 않습니다. |
| `tests/fixtures/` | PERF-100·BOUNDARY와 제어 가능한 실패 fixture를 둡니다. 제품 DB 복사본을 fixture로 쓰지 않습니다. |
| `dist/server/` | TypeScript 서버 빌드입니다. 웹 정적 제공 대상이 아닙니다. |
| `dist/web/` | Vite의 웹 빌드와 허용된 정적 파일만 둡니다. |
| `.planrepo/data/planrepo.sqlite` | 업무 원문·불변 버전·현재 참조·정책·활동·receipt·Run·slot·종료 관찰의 영속 기준입니다. |
| `.planrepo/runs/<runId>/<claimId>/` | 실행별 빈 cwd입니다. claimId는 ownership token과 다른 비밀이 아닌 ID입니다. |
| `.planrepo/logs/` | 선택한 정제 진단의 로컬 저장 위치입니다. 업무 이력이나 raw CLI 출력을 저장하지 않습니다. |
| `.planrepo/test-runs/<testRunId>/` | 테스트별 DB·실행 cwd·정제 결과를 격리합니다. 기본 앱 DB로 fallback하지 않습니다. |

.planrepo와 dist, node_modules, 테스트 결과는 소스 관리에서 제외합니다. 일반 실행의 정적 제공은 dist/web만 허용합니다. 개발 실행은 INF-05의 웹·공유 계약·필요 의존성 목록만 허용하며 runtime 자료·설정·테스트 결과는 두 모드 모두 제공하지 않습니다. .gitignore는 Code Generation에서 만듭니다. 실행 폴더 이름은 서버가 발급한 제한된 ID만 사용합니다. 입력 문장·외부 경로·모델 문자열로 경로를 만들지 않습니다. ID/host/실행 경로는 snapshot의 업무 fingerprint에 넣지 않습니다.

업무 입력·모델 결과의 raw 파이프는 메모리에서 제한 처리합니다. 원시 프롬프트·stdout/stderr를 실행 cwd에 덤프하지 않습니다. tmp 파일이 필요한 CLI 내부 동작도 제품 자료와 분리해 검증합니다. 디렉터리 부재·삭제·이동을 실제 실행 종료의 증거로 쓰지 않습니다.

### INF-03 제품 설정과 제한값

**설계 추적**: ND-04, ND-07, ND-08, ND-09, ND-11, ND-13입니다.

**논리 책임**: LC-01, LC-05, LC-06, LC-07, LC-08, LC-12입니다.

기본 제품 설정은 다음 JSON 계약입니다. 구현 시 runtime schema로 타입·범위·미지원 키를 검사합니다. 제한값은 승인 NFR/ND와 같으며 보이지 않는 전역 기본값을 사용하지 않습니다.

```json
{
  "schemaVersion": 1,
  "server": {
    "host": "127.0.0.1",
    "port": 4173,
    "devPort": 5173
  },
  "paths": {
    "dataDir": ".planrepo/data",
    "runsDir": ".planrepo/runs",
    "logsDir": ".planrepo/logs"
  },
  "generation": {
    "providerId": "claude-cli",
    "modelChoice": {
      "kind": "explicit",
      "modelId": "global.anthropic.claude-opus-4-8"
    },
    "concurrency": 1,
    "maxNonterminal": 10,
    "timeoutMs": 300000,
    "controlPollMs": 250,
    "terminationGraceMs": 2000,
    "terminationObservationMs": 10000
  },
  "limits": {
    "commandBytes": 8388608,
    "artifactBytes": 1048576,
    "providerInputBytes": 2097152,
    "stdoutBytes": 4194304,
    "stderrBytes": 262144,
    "draftBytes": 2097152,
    "handoffBytes": 8388608
  },
  "sqlite": {
    "journalMode": "DELETE",
    "synchronous": "FULL",
    "foreignKeys": true,
    "busyTimeoutMs": 100
  }
}
```

설정 우선순위는 versioned 기본 파일, 명시적으로 허용한 환경 override, 테스트 harness의 전용 입력 순입니다. 임의 CLI 추가 인자·실행 파일 경로를 제품 API에서 받지 않습니다. PLANREPO_ROOT, PLANREPO_PORT, PLANREPO_DEV_PORT, PLANREPO_DATA_DIR만 일반 실행 override로 허용합니다. 포트는 1부터 65535까지의 정수이고 dataDir는 프로젝트 내부 경로여야 합니다. 제한값·provider 프로파일 변경은 파일의 검증된 설정으로만 처리하며 새 Run에 적용합니다.

test 실행은 PLANREPO_MODE=test와 서버가 검증한 PLANREPO_TEST_RUN_ID를 함께 요구합니다. 테스트 경로는 harness가 계산하며 DATA_DIR override를 그대로 받지 않습니다. 누락·범위 탈출·앱 DB와 같은 realpath는 실패입니다. 5개 브라우저 context는 같은 테스트 앱/DB에서 사용자만 분리하며, 서로 다른 테스트 실행은 별도 저장소와 포트를 사용합니다.

ProviderSelection의 providerId는 claude-cli 또는 테스트에서 명시한 test adapter입니다. modelChoice는 installed_default와 explicit을 지원합니다. 제품 기본 선택은 explicit `global.anthropic.claude-opus-4-8`입니다. 2026-09-09 실제 호출의 actual model과 provider는 `global.anthropic.claude-opus-4-8`과 `bedrock`이었습니다. 실제 모델명은 확인된 출력만 기록합니다. 다른 explicit model 선택을 내부 설정에서 지원하되 모델 선택 전용 UI나 두 번째 실제 서비스는 추가하지 않습니다.

생성 한 개·nonterminal 열 개, 300초 실행, 250ms 제어 조회·2초 종료 유예·10초 관찰을 별개 값으로 유지합니다. 1 MiB 본문·2 MiB 명시 입력/초안·4 MiB stdout·256 KiB stderr·8 MiB 명령/인계는 bytes로 검사합니다. 설정값을 바꾸어 목표를 조용히 완화하지 않습니다.

### INF-04 SQLite·migration·시드의 수명

**설계 추적**: ND-01, ND-02, ND-03, ND-08, ND-13입니다.

**논리 책임**: LC-02, LC-03, LC-06, LC-12입니다.

C-04가 앱 프로세스별 단일 better-sqlite3 connection을 소유합니다. 정확한 패키지 pin과 내장 SQLite 버전은 설치 후 기록합니다. 연결마다 DELETE/FULL/FK ON/busy timeout을 읽어 확인합니다. 업무 변경은 BEGIN IMMEDIATE, 일관된 조회는 짧은 읽기 트랜잭션을 사용합니다. receipt·버전·epoch·인계·작업의 원자성을 다른 파일 저장으로 쪼개지 않습니다.

일반 시작은 지원 schema를 검사하며 기존 DB를 자동 migration하거나 reset하지 않습니다. 준비 명령 db:migrate가 빈 DB의 schema를 만들고 기존 DB의 명시적 버전 변경을 담당합니다. app_migrations의 번호·checksum·적용 시각과 변경 DDL/DML을 같은 commit에 기록합니다. SQLite 내부 schema_version을 앱 migration 번호로 덮어쓰지 않습니다. 실패하면 이전 버전과 자료를 유지하고 성공 준비로 표시하지 않습니다. [SQLite PRAGMA](https://sqlite.org/pragma.html)

migration과 시드는 모든 앱이 정지한 offline 작업으로만 지원합니다. 시작·유지보수 진입은 같은 DB의 runtime/maintenance 등록 상태를 검사합니다. 활성 또는 사망을 판정할 수 없는 runtime이 있거나 실행 슬롯·running이 남으면 유지보수를 거절합니다. 유지보수 소유권을 BEGIN EXCLUSIVE 안에서 재검사하고 migration 또는 seed의 commit까지 잠금을 유지합니다. backend도 maintenance 확인·지원 schema 재확인·runtime 등록을 한 BEGIN IMMEDIATE에서 확정하고 commit 뒤 ready로 전환합니다. 준비 중 새 backend가 등록/준비되지 못하도록 같은 소유권 경계를 사용합니다. SQL lock만으로 다른 버전 앱과의 동시 운영을 지원한다고 쓰지 않습니다. bootstrap registry와 소유권 검사는 최초 schema부터 유지하며 다음 구현 계획에서 동시 시작·migration 경쟁을 검증합니다.

DEMO-4 시드는 지원 schema가 있고 업무 자료와 seed 완료 표식이 없는 DB에만 명시적으로 넣습니다. 파일이 있다는 이유만으로 schema만 있는 빈 DB를 거절하지 않습니다. emptiness 재검사·가상 사용자·네 SR·관련 기준/이력·manifest를 한 트랜잭션에 확정합니다. 이미 시드되거나 사용자 자료가 있으면 덮어쓰기 없이 거절합니다. 서버 시작·페이지 조회에서 seed를 자동 실행하지 않습니다.

같은 DB를 실수로 여는 두 runtime 사이에도 인수·용량·receipt는 DB 조건부 확정으로 지킵니다. 서로 다른 schema 버전으로 같은 DB를 계속 운영하는 것은 지원하지 않습니다. connection마다 명령 시작 시 앱 schema 호환성을 확인하고 달라지면 준비 오류로 내려 새 변경·인수를 막습니다. 실행 중 DB의 이름 변경·교체·일반 파일 복사를 정상 절차로 삼지 않습니다. [SQLite 파일 손상 방지](https://sqlite.org/howtocorrupt.html)

### INF-05 HTTP·정적 파일·개발 연결

**설계 추적**: ND-04, ND-05, ND-06, ND-13입니다.

**논리 책임**: LC-01, LC-04, LC-10, LC-11, LC-12입니다.

일반 로컬 앱의 URL은 http://127.0.0.1:4173입니다. Fastify가 /api 업무 경로·/health 관찰 경로와 dist/web 정적 파일을 제공합니다. bind는 127.0.0.1만 사용하고 Host는 실제 설정된 127.0.0.1:port와 정확히 비교합니다. Origin은 일반 실행에서 같은 origin만 허용합니다. 변경 요청은 Origin·application/json·identity encoding·8 MiB 수신 상한을 검사합니다. Origin null·누락·다른 origin의 변경 요청은 거절합니다. localhost와 IPv6 별칭을 자동으로 넓히지 않습니다.

개발에서는 Vite http://127.0.0.1:5173의 /api와 /health만 backend 4173으로 proxy합니다. changeOrigin=true로 upstream Host를 backend에 맞추되 브라우저 Origin은 보존합니다. backend의 dev 모드는 정확한 5173 origin만 브라우저 Origin으로 허용합니다. 브라우저는 항상 자신의 origin으로 요청하므로 광범위 CORS 허용이 필요하지 않습니다. 포트 override 시 두 프로세스의 설정·허용 origin·proxy를 같은 계산값으로 맞춥니다. 사용 중인 포트에서는 실패하며 다른 포트로 몰래 이동하지 않습니다. [Vite server options](https://vite.dev/config/server-options)

Vite root는 src/web, publicDir=false이며 fs.strict와 src/web·src/contracts·필요 node_modules의 명시 allow 목록을 적용합니다. .planrepo·config·aidlc-docs·requirements·서버 소스는 허용하지 않습니다. /@fs·URL encoding·symlink·public 자산 경로를 포함해 비노출을 검사합니다. 개발 서버의 기본 fs 탐색이나 allowedHosts 기본값만으로 이 경계를 보장했다고 표시하지 않습니다. 명시 Host/Origin 검사 middleware를 proxy보다 먼저 배치하고 HMR 연결도 허용한 dev origin만 사용합니다. 자동 브라우저 로그 전달은 비활성화하고 원문을 console에 남기지 않습니다.

일반 정적 제공 root는 dist/web의 realpath만입니다. @fastify/static의 Fastify 5 호환 버전을 고정하고 dotfiles·디렉터리 listing·root 밖 symlink를 허용하지 않습니다. /api·/health 오류와 금지된 경로를 SPA HTML로 바꾸지 않습니다. SPA fallback은 허용한 화면 경로의 HTML 요청에만 적용합니다. 브라우저에 서버 설정·DB·실행 폴더·문서 워크플로우를 제공하지 않습니다. [Fastify static plugin](https://github.com/fastify/fastify-static)

Jira/GitHub는 config/demo의 가상 자료와 명시적 링크입니다. 자동 외부 동기화나 링크 내용 수집은 없습니다. Claude의 실제 모델 통신은 설치 환경의 전제이며 OS 네트워크 sandbox가 생겼다고 주장하지 않습니다. 별도 API gateway·TLS 인증서·로드밸런서·공개 배포는 N/A입니다.

### INF-06 Claude 실행 폴더와 프로파일

**설계 추적**: ND-07, ND-08, ND-09, ND-11, ND-12입니다.

**논리 책임**: LC-05, LC-06, LC-07, LC-08, LC-09, LC-12입니다.

C-09가 PATH에서 실행 가능한 Claude를 찾고 버전과 지원 프로파일을 확인합니다. 설치 경로를 제품 JSON에 고정하지 않습니다. 실행은 spawn(executable, args)의 인자 배열과 shell=false·detached=true·pipe 3개·실행별 cwd를 사용합니다. unref하지 않으며 프롬프트를 shell·환경 변수·파일명으로 해석하지 않습니다. ND-11의 --print/text/json, explicit model, 빈 tools·제한 MCP·no-session-persistence·disable-slash-commands·no-chrome·dontAsk/none·disableAllHooks·고정 system prompt를 매핑합니다. safe-mode·restricted·setting-sources는 전달하지 않습니다. 이 조합은 2026-09-09 기존 설치 환경의 실제 호출에서 exit 0으로 검증했습니다. [Node 22 child_process](https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/child_process.md)

config/claude/mcp-empty.json은 앱 소유의 빈 서버 목록입니다. --settings의 disableAllHooks=true만으로 모든 managed 자동 명령을 제거했다고 보지 않습니다. 표준 managed 설정 파일은 관찰되지 않았고 Bedrock의 remote managed policy fetch는 비활성으로 보고됐습니다. 모든 MDM과 전역 문맥의 부재는 입증하지 않았지만 이를 새 연결의 blocker로 쓰지 않습니다. 실행 파일·버전·모델·argv·출력 schema가 바뀌면 짧은 실제 호출과 provider 확인을 다시 실행합니다. managed MCP 충돌·자동 명령·옵션 미지원이 실제 관찰되면 제한을 빼거나 권한 우회로 fallback하지 않습니다.

자식은 기존 PATH·HOME·인증 환경을 보존해 Claude의 전역 설정과 credential chain을 그대로 사용합니다. HOME을 제품 폴더로 덮어쓰지 않습니다. 앱은 credential 값을 읽거나 복사하지 않고 새 credential을 만들거나 전역 로그인·설정·자격 증명을 변경하지 않습니다. 업무 API 권한·DB 경로·소유권 token은 새로 주입하지 않으며 raw 환경 전체를 로그에 남기지 않습니다.

입력 snapshot·규칙·task는 stdin에 전달하고 고정 system prompt를 포함한 모든 명시 입력 bytes를 검사합니다. stdout/stderr는 함께 소비하고 raw 저장 없이 상한을 집행합니다. M-037 성공 전에 direct child 정상 종료 코드·양쪽 close·최종 누적 bytes·schema/참조·deadline을 확인합니다. 오류 envelope의 subtype=success라도 is_error=true이면 실패입니다. 모델 출력은 업무 API를 호출하지 않으며 사람이 M-018로 적용해야 합니다.

실행 cwd와 TMPDIR는 작업별로 분리하지만 OS 전체 격리를 뜻하지 않습니다. 2026-09-09 실제 호출은 기존 인증, 모델 응답, exit 0과 도구·웹·subagent 사용 0건을 확인했습니다. 제품 출력 schema, 자동 명령·자손·다른 SR 문맥 부재, 취소·timeout·복구와 전체 customization 격리는 가상 canary와 구현 검증으로 판정합니다. 검증 실패면 AI만 PROVIDER_UNAVAILABLE이며 비AI 저장·검토를 유지합니다.

### INF-07 macOS 프로세스 관찰과 복구 한계

**설계 추적**: ND-08, ND-09, ND-10, ND-11입니다.

**논리 책임**: LC-06, LC-07, LC-08, LC-12입니다.

현재 프로세스의 제어는 C-09가 직접 만든 ChildProcess 핸들과 실행 intent에 연결합니다. detached 실행의 PGID는 검증한 child 그룹으로 기록합니다. 최초 SIGTERM, 2초 후 아직 같은 실행임을 확인할 수 있을 때 SIGKILL을 시도합니다. 그룹 신호는 pgid > 1이고 현재 runtime이 직접 시작해 소유를 유지하는 실행에만 사용합니다. 종료 뒤 예약 signal timer를 해제하며 오래된 DB의 PID/PGID로 새 runtime이 신호를 보내지 않습니다.

kill의 성공은 종료 관찰이 아닙니다. ESRCH는 그 시점의 대상 부재이고 EPERM·관찰 오류는 종료 증거가 아닙니다. direct child close와 stdio 완료, 검증된 실행 범위의 부재를 함께 확인합니다. 숫자 PGID의 조회/신호는 원자적 identity 보장이 아니며 탈출 자손까지 포함하지 않습니다. 실제 검증된 프로파일에서 같은 실행의 정리 범위를 확인할 수 없으면 M-050을 만들지 않고 slot을 유지합니다. [Apple kill(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html)

읽기 전용 관찰 수단은 /usr/sbin/sysctl의 kern.bootsessionuuid, /usr/sbin/ioreg의 IOPlatformUUID입니다. 고정 실행 파일·고정 인자·shell=false로 호출하며 제한된 출력에서 UUID 형식만 추출합니다. 시스템 하드웨어 식별값은 일반 로그·UI·인계에 넣지 않고 비교에 필요한 host digest와 boot 식별 정보만 내부 runtime 기록에 보존합니다. 프로젝트에 만든 임의 host ID나 복사된 파일만으로 동일 host를 증명하지 않습니다. VM 복제·복원·식별 조회 실패는 미확인입니다.

동일 물리 host의 검증된 boot 전환은 ND-10의 host_reboot_confirmed 근거입니다. sleep/wake나 앱 재시작은 boot 전환으로 취급하지 않습니다. launch intent 전에 기록한 host/boot와 현재를 비교하며 실제 종료 코드·종료 시각을 만들어 내지 않습니다. 원격 모델 서버의 계산 종료도 보장하지 않습니다. [Apple boot UUID](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/iokit/IOKit/pwr_mgt/IOPM.h), [XNU sysctl](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/kern_sysctl.c)

같은 boot에서 부모 앱이 비정상 종료되면 원 실행의 강한 identity/종료 근거가 없는 작업은 unknown으로 유지합니다. /bin/ps의 lstart는 초 단위 문자열이므로 원 소유권 확인에 쓰지 않습니다. libproc의 microsecond 시작 필드는 강한 관찰의 후보지만 초기 제품에 native helper를 추가하지 않습니다. 필요하면 별도 source·Node-API 빌드·OS 호환성 검증을 구현 계획의 변경으로 검토합니다. [Apple ps](https://raw.githubusercontent.com/apple-oss-distributions/adv_cmds/main/ps/print.c), [libproc 필드](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/proc_info.h)

부모 runtime 중단 판정과 실제 Claude 종료 판정은 다른 결과입니다. 확인할 수 없는 소유권은 살아 있다고 단정하거나 새 소유권으로 교체하지 않습니다. 정상 DB 준비 후 10초 안에 분류하되 필요한 관찰을 얻지 못하면 중단 판정 미확인과 그 목표 미통과를 기록합니다. 성공이 이미 commit된 작업은 보존합니다. 신뢰 가능한 종료를 얻을 때만 원 claim의 M-050으로 해당 slot을 해제합니다. 다음 pending 인수는 기존 Run이 terminal이고 다른 running이 없다는 M-036 조건도 충족해야 합니다. 재부팅 복구의 기존 Run이 running이면 검증된 부모 중단에 따른 M-039 실패 확정을 함께 마쳐야 합니다. M-050만으로 Run의 업무 상태를 바꾸지 않습니다. 같은 boot의 crash gap에서 AI가 계속 차단될 수 있는 초기 제한을 숨기지 않습니다.

현재 확인한 것은 OS 명령의 지원과 UUID 형식입니다. signal 전달·실제 Claude 종료·libproc 호출·reboot 전후 비교는 실행하지 않았습니다. 이 관찰 수단만으로 전체 NFR의 실제 복구를 통과했다고 표시하지 않습니다.

### INF-08 준비 상태·시작·정상 종료

**설계 추적**: ND-01, ND-04, ND-08, ND-09, ND-10, ND-13입니다.

**논리 책임**: LC-01, LC-03, LC-06, LC-07, LC-12입니다.

시작은 루트/설정 검증, FK/저장 연결 확인, 원자적 runtime 등록, HTTP/비AI 준비, 이전 실행 분류, provider 적합성, C-05 인수 루프 순서입니다. 등록 트랜잭션에서 maintenance와 지원 schema를 재확인하고 등록 commit 뒤 ready로 전환합니다. CLI 네트워크나 로그인 완료를 기다려 비AI readiness를 지연시키지 않습니다. DB가 없거나 schema가 다르면 명시한 준비 명령을 안내하고 정상 준비로 표시하지 않습니다. 앱 시작 10초 목표는 승인된 기존 정상 DB 조건에서 측정합니다.

GET /health/live는 프로세스 응답 여부, GET /health/ready는 비AI 저장·조회 준비를 반환합니다. 정상 DB의 ready는 200이며 provider unavailable·실행 종료 미확인은 별도 제한 상태로 표시합니다. DB 미준비·연결 실패는 ready 503입니다. 응답은 준비 상태·정제한 오류 코드만 포함하고 경로·host UUID·token·입력·모델 raw 응답은 반환하지 않습니다. health는 업무 50개 계약에 추가된 승인/변경 메서드가 아닙니다.

SIGINT/SIGTERM 정상 종료는 새 HTTP 변경 접수와 새 인수를 중지하고 진행 중 짧은 명령의 commit/rollback을 기다립니다. 소유한 Claude 실행은 내부 runtime의 shutdown 사유로 정리합니다. 사용자 M-034 취소를 임의의 가상 사용자 행동으로 만들어 기록하지 않습니다. 먼저 terminal이 확정됐다면 유지하고, 아직 running이면 허용된 내부 실패로 기록한 뒤 종료를 관찰합니다.

M-049/M-050을 포함한 내부 정리·실행 관찰 저장이 끝날 때까지 DB를 유지합니다. 10초 관찰 목표를 넘기거나 DB에 관찰을 저장하지 못하면 slot을 비우지 않고 unknown 근거를 남길 수 있는 범위에서 보존한 뒤 오류 종료합니다. 마지막에 runtime 종료 기록과 connection을 닫습니다. pending은 보존합니다. 다음 시작에서 DB에 남은 상태를 다시 읽습니다.

개발 모드의 웹 HMR은 backend나 Claude 실행 소유권을 재시작하지 않습니다. backend source 변경은 자동 강제 재시작 대신 명시적 정지/재시작으로 반영합니다. npm run dev의 부모 관리자는 Vite와 backend의 신호를 전달하고 둘의 종료를 기다립니다. 백엔드 정리 완료 전에 자식 전체를 강제 제거하는 watcher를 기본으로 사용하지 않습니다.

### INF-09 준비·빌드·실행 명령 계약

**설계 추적**: ND-13, ND-14입니다.

**논리 책임**: LC-03, LC-07, LC-11, LC-12입니다.

아래 명령은 후속 구현에서 제공할 npm script 계약입니다. 현재 package.json과 script는 없으므로 지금 실행 가능한 명령이나 실행 결과로 읽지 않습니다. Code Generation 계획에 실제 파일·TDD 검증과 함께 반영합니다. 모든 명령은 프로젝트 루트에서 시작하며 실패 exit code를 숨기지 않습니다.

| ID | 명령 | 후속 구현에서 보장할 동작 |
|---|---|---|
| CMD-01 | `npm ci` | 고정 lockfile로 의존성을 준비합니다. manifest 불일치면 실패하며 전역 설치하지 않습니다. |
| CMD-02 | `npm run typecheck` | 웹·서버·공유 계약을 별도 TypeScript 검사합니다. |
| CMD-03 | `npm test` | 단위·계약·실제 SQLite 통합을 수행하며 테스트마다 격리 DB를 사용합니다. 실제 Claude 호출은 자동 포함하지 않습니다. |
| CMD-04 | `npm run build` | dist/server와 dist/web을 생성합니다. 원본 자료·실행 DB를 지우지 않습니다. |
| CMD-05 | `npm run db:migrate` | 정지 상태에서 지원 schema를 준비하거나 명시 migration을 적용합니다. |
| CMD-06 | `npm run seed:demo` | 빈 업무 DB에 DEMO-4를 원자적으로 넣습니다. 이미 자료가 있으면 거절합니다. |
| CMD-07 | `npm start` | build된 backend가 4173에서 웹/API/health를 제공합니다. |
| CMD-08 | `npm run dev` | backend 4173과 Vite 5173을 관리합니다. 웹 HMR과 backend 재시작을 분리합니다. |
| CMD-09 | `npm run test:e2e` | Playwright와 테스트 앱의 명시 포트·DB·5 context를 사용합니다. |
| CMD-10 | `npm run test:perf` | 고정 PERF-100과 승인 표본으로 API/UI 지연을 기록합니다. |
| CMD-11 | `npm run verify:claude` | 명시적으로 실제 가상 Claude 실행·제한 프로파일·교체 경계를 검증합니다. 네트워크/설치 인증이 필요합니다. |
| CMD-12 | `npm run test:acceptance` | 스토리/AC 연결 검증을 실행하고 실제 AI·사용성 등 별도 증거의 미완료를 구분합니다. |

첫 준비 순서는 CMD-01·CMD-02·CMD-03·CMD-04 뒤 offline CMD-05·CMD-06, 일반 실행 CMD-07입니다. 기존 데이터의 재실행은 CMD-07만 사용하며 seed를 반복하지 않습니다. 개발은 준비된 DB에서 CMD-08을 사용합니다. DB version 변경은 앱을 멈추고 migration 결과를 검증한 뒤 다시 시작합니다.

npm ci는 기존 node_modules를 다시 구성하는 명령입니다. 의존성 설치·브라우저 다운로드·native fallback build와 실제 Claude 통신은 완전 오프라인 전제가 아닙니다. 정확한 버전·브라우저 준비 명령·native compiler 필요 여부는 lockfile을 만드는 구현 시 확인해 시작 안내에 기록합니다. 현재 Node·Claude 외 런타임을 자동 추가하지 않습니다. [npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci/)

일반 자동 테스트는 test adapter로 실패·지연·출력 경계를 재현합니다. CMD-11과 실제 AI를 포함한 수용 경로는 별도 명시 실행으로 기록합니다. test adapter 결과를 실제 provider 통과로 집계하지 않습니다. AC-17의 전체 사람 적용·G1/G2·Handoff 완료는 B-05 이후에 확인합니다.

### INF-10 테스트·진단·자료 이동과 검증 인계

**설계 추적**: ND-01, ND-02, ND-03, ND-05, ND-06, ND-10, ND-12, ND-13, ND-14입니다.

**논리 책임**: LC-01, LC-02, LC-03, LC-04, LC-05, LC-06, LC-07, LC-08, LC-09, LC-10, LC-11, LC-12입니다.

테스트 harness는 .planrepo/test-runs 아래에 새 testRunId를 만들고 그 안의 DB·run cwd·정제한 결과 위치를 명시합니다. test mode의 경로 입력이 없거나 사용자 DB와 겹치면 실패합니다. 병렬 테스트 앱은 명시적으로 예약한 별도 loopback 포트와 저장소를 사용합니다. 자동 포트 이동에 기대어 잘못된 앱을 테스트하지 않습니다. 열린 연결·종료 미확인 child가 있으면 테스트 폴더를 지우지 않습니다.

진단은 request/Run/receipt ID·정제 코드·지연·출력 byte 수만 기본으로 기록합니다. raw CLI 출력·전체 HTTP 본문·환경·인증·ownership token·host UUID는 일반 로그로 복제하지 않습니다. 파일 진단은 선택이며 .planrepo/logs에만 씁니다. 필요하면 1 MiB씩 3개 파일로 제한해 순환하되 이 제한은 업무 DB 활동/이력에는 적용하지 않습니다. 로그 쓰기 실패와 DB commit 실패를 구분하고 이미 확정한 업무를 되돌린 것으로 표시하지 않습니다.

재현용 프로젝트 사본은 소스·lockfile·config·fixture·aidlc-docs·규칙만 옮기고 .planrepo·node_modules·dist를 재현 입력에서 제외합니다. 새 경로에서 의존성·build·빈 DB·시드를 준비합니다. 개발 도구 전역 상태·다른 프로젝트 자료를 복사하지 않습니다. 기존 사용자 자료의 이동은 별도 절차입니다.

초기 백업/복구는 모든 앱의 연결과 원 실행이 종료됐고 저장소가 정합한 정지 상태에서만 지원합니다. DB 전체와 앱 schema/manifest를 하나의 기준으로 보존합니다. 실행 중 파일 복사·이름 변경·DB 덮어쓰기·hot journal 삭제를 허용하지 않습니다. runtime이 남은 사본을 새 host에 재바인딩하거나 slot만 지우지 않습니다. 복구는 별도 새 대상에서 정합성·FK·버전·기준/receipt·인계·실행 이력을 검증한 뒤 사용합니다. 온라인 백업은 초기 범위가 아니며 필요하면 SQLite Backup API를 별도 검증합니다. [SQLite 복구 규칙](https://sqlite.org/lockingv3.html), [SQLite Backup API](https://sqlite.org/backup.html)

단위 간 shared infrastructure는 N/A입니다. UOW-01 내부 공유 DB/runtime은 이 문서와 deployment-architecture에 모두 포함했습니다. 별도 공유 문서를 필수 자산처럼 참조하지 않습니다. 클라우드/운영 경보/조직 인증/실제 외부 레코드 쓰기는 이번 단계에 없습니다.

B-01은 루트 재배치·설정·build·migration/seed·권한·저장, B-02는 실제 Claude와 제한/종료/중단·교체 계약, B-03/B-04는 G1/G2, B-05는 인계와 실제 AC-17, B-06은 UI/재검토·성능·접근성을 검증합니다. 별도 사본에서의 실행·로그 비노출·모든 경로의 자료 보존도 Build and Test에 연결합니다. 문서 파싱·OS 명령 지원 확인을 이 실제 실행 증거로 대신하지 않습니다.

## 3. NFR 설계 추적

| 승인 패턴 | 인프라 결정 |
|---|---|
| ND-01 | INF-02, INF-04, INF-08, INF-10 |
| ND-02 | INF-04, INF-10 |
| ND-03 | INF-04, INF-10 |
| ND-04 | INF-03, INF-05, INF-08 |
| ND-05 | INF-05, INF-10 |
| ND-06 | INF-05, INF-10 |
| ND-07 | INF-02, INF-03, INF-06 |
| ND-08 | INF-03, INF-04, INF-06, INF-07, INF-08 |
| ND-09 | INF-03, INF-06, INF-07, INF-08 |
| ND-10 | INF-07, INF-08, INF-10 |
| ND-11 | INF-02, INF-03, INF-06, INF-07 |
| ND-12 | INF-06, INF-10 |
| ND-13 | INF-01, INF-02, INF-03, INF-04, INF-05, INF-08, INF-09, INF-10 |
| ND-14 | INF-01, INF-09, INF-10 |

12개 LC의 프로세스·모듈 배치는 실행 아키텍처 문서의 매핑표와 일치합니다. 새 업무 메서드·단위·사용자 권한을 추가하지 않습니다. receipt·현재성·불변 인계·first-terminal-wins와 실제 종료의 분리는 승인된 설계를 그대로 적용합니다.

## 4. 확인 범위와 완료 조건

문서 확인은 Markdown·JSON 파싱, 표 열 수, INF-01부터 INF-10까지의 고유 ID, ND 14개·LC 12개 추적, 두 문서의 설정/포트/준비 상태, 내부 참조와 승인 입력 보존입니다. 실제 실행 검증은 후속 Code Generation의 RED·GREEN 및 Build and Test에 기록합니다.

| 항목 | 이번 확인 | 남은 실행 검증 |
|---|---|---|
| 런타임·CLI | 기존 Node/npm/Claude 버전과 OS 관찰 명령을 확인했고 2026-09-09 실제 호출에서 exit 0, `global.anthropic.claude-opus-4-8`/Bedrock을 확인했습니다. | package pin·native 의존성·제품 출력 schema·취소·timeout·복구·전체 격리는 미검증입니다. |
| 저장·준비 | 경로·offline migration/seed·원자성·실패 계약을 정했습니다. | 실제 SQLite·경쟁·rollback·재개방·준비 지연은 미검증입니다. |
| 웹 연결 | 4173 일반 실행·5173 개발 proxy와 정확한 Host/Origin을 정했습니다. | 실제 서버·브라우저·정적 비노출·HMR·포트 충돌은 미검증입니다. |
| 프로세스 복구 | signal과 관찰·부모와 자식의 종료 증거를 구분했습니다. | 실제 취소·강제 종료·crash gap·같은 host 재부팅 검증은 하지 않았습니다. |
| 독립 실행 | 프로젝트 내부의 자료와 실행 설정 계약을 정했습니다. | 새 경로에서 앱을 설치·시드·빌드·실행하는 검증은 코드 생성 후에 합니다. |
| 품질·수용 | NQ-01부터 NQ-24와 NT-01부터 NT-16을 유지합니다. | PERF-100·5 context·실제 AC-17·대표 사용자 과업 관찰은 미검증입니다. |

Security Baseline·Resiliency Baseline·PBT는 모두 비활성이므로 개별 규칙은 **N/A**입니다. 세 opt-in 확인과 비활성 적용 생략은 상태·감사 기록에 반영합니다. opt-in 없는 강제 확장은 없습니다. 단일 UOW 내부 공유 자원은 두 문서에 포함했으며 단위 간 shared infrastructure·클라우드/운영 배포는 N/A입니다.
