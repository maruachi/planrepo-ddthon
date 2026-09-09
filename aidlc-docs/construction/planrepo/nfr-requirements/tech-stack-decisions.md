# PlanRepo 기술 스택 결정

버전은 0.1이며 **사용자 승인 완료**입니다. UOW-01의 모듈형 단일 로컬 앱을 구현할 기술 방향과 확인할 조건을 정합니다. 승인 시점에는 패키지 설치·앱 실행·실제 Claude 생성·성능 측정을 하지 않았습니다. 사용자 응답 “진행하자”를 2026-09-08T15:27:15Z에 기록하고 이 기술 선택을 승인받았습니다. 2026-09-09 구현 결정에서 기존 설치 환경의 `global.anthropic.claude-opus-4-8`/Bedrock 실제 호출을 확인했습니다.

## 1. 기준과 결정 범위

승인된 `aidlc-docs/inception/requirements/requirements.md` 0.4, `aidlc-docs/inception/application-design/unit-of-work.md` 0.1, `aidlc-docs/inception/application-design/component-methods.md` 0.1과 Functional Design을 유지합니다. 상세 기능 기준은 `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`, `aidlc-docs/construction/planrepo/functional-design/business-rules.md`, `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`, `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`에 있습니다.

검증 규모·응답시간·문서 크기·동시 작업·생성 제한·복구 목표는 같은 단계의 `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`에서 정합니다. 기술 선택 문서에 별도 수치를 중복 확정하지 않습니다. 외부 URL은 기술 사실의 확인 근거입니다. 설계에 필요한 핵심 사실과 적용 판단은 본문에 요약합니다.

브라우저 UI, 로컬 백엔드, 로컬 영속저장과 설치된 Claude CLI를 사용합니다. 운영 배포·클라우드·조직 인증 구축은 범위에 없습니다. 가상 사용자 역할 선택은 실제 인증 체계를 뜻하지 않습니다. Jira·GitHub는 승인된 Mock 자료와 명시적 링크 처리를 유지합니다. 개발 도구 Codex와 제품의 생성 provider인 Claude를 구분합니다.

### 읽기 전용으로 확인한 기준 환경

| 항목 | 확인한 값 | 이번 단계의 해석 |
|---|---|---|
| Node.js | v22.23.2입니다. | 현재 설치 버전을 개발 기준으로 유지합니다. |
| npm | 10.9.8입니다. | 기존 npm을 사용하고 프로젝트 lockfile을 후속 단계에서 만듭니다. |
| 호스트 | macOS의 Darwin 25.6.0, arm64입니다. | native 모듈과 브라우저 실행을 이 환경에서 검증합니다. |
| 메모리·CPU | 16 GiB, 물리 코어 8개입니다. | 성능 측정 환경의 기준값입니다. |
| Python | 3.9.6입니다. | native 빌드 도구 전체의 준비를 확인한 결과는 아닙니다. |
| Claude CLI | 2.1.263입니다. | PATH에서 실행 파일을 찾습니다. 실제 생성 성공을 확인한 값은 아닙니다. |

환경 조회 명령은 정상 종료했습니다. 패키지별 바이너리 로딩·브라우저 실행·Claude 인증·지원 model ID·생성 출력은 별도 검증 대상입니다. 시스템 업그레이드를 이 프로젝트의 시작 조건으로 추가하지 않습니다.

## 2. 선택 목록

| ID | 기술 방향 | 결정 수준 |
|---|---|---|
| TECH-01 | 설치된 Node.js 22.23.2와 npm 10.9.8을 유지합니다. | 실행 기준을 선택합니다. 지원 종료 전 재평가는 필요합니다. |
| TECH-02 | React와 Vite로 한국어 SPA를 구성합니다. | UI·빌드 방향을 선택합니다. 정확한 패키지 버전은 후속 확정입니다. |
| TECH-03 | TypeScript와 별도 타입 검사를 사용합니다. | 언어·계약 검사 방향을 선택합니다. |
| TECH-04 | Fastify 5를 얇은 로컬 전송 계층으로 사용합니다. | 서버 프레임워크 major를 선택합니다. |
| TECH-05 | SQLite와 better-sqlite3를 저장 후보로 선택합니다. | 13.0.3을 확인 후보로 둡니다. 설치·정확한 pin은 후속 검증 대상입니다. |
| TECH-06 | 로컬 저장 포트와 영속 생성 작업을 같은 앱에서 관리합니다. | 저장 방향을 선택합니다. WAL과 상세 저장 패턴은 보류합니다. |
| TECH-07 | Node 비동기 자식 프로세스 API로 Claude adapter를 연결합니다. | 수단 후보를 선택합니다. 구체적인 실행·격리 수단은 NFR Design에서 검증합니다. |
| TECH-08 | Vitest로 단위·계약·통합 검증을 구성합니다. | 테스트 도구 방향을 선택합니다. |
| TECH-09 | Playwright로 실제 브라우저 흐름을 검증합니다. | 화면 검증 도구를 선택합니다. |
| TECH-10 | 안전한 Markdown 표시 수단으로 react-markdown을 우선 검토합니다. | renderer·plugin 정책은 NFR Design에서 확정합니다. |
| TECH-11 | npm lockfile과 npm ci로 설치 재현성을 관리합니다. | 정확한 버전 고정·재검증 절차를 선택합니다. |

### TECH-01 — 기존 Node LTS 환경 유지

**선택과 근거:** Node.js 22.23.2를 유지합니다. 공식 릴리스는 이 버전을 LTS로 표시합니다. Node 22의 공식 일정은 2025-10-21에 Maintenance LTS로 전환하고 2027-04-30에 지원을 종료하는 계획입니다. 현재 런타임을 쓸 수 있으므로 이 설계를 위해 Node 24 이상으로 시스템을 올리지 않습니다. [Node.js 22.23.2 릴리스](https://nodejs.org/en/blog/release/v22.23.2), [Node.js 지원 일정](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)

**대안과 위험:** 더 긴 지원 기간이 필요한 후속 사용에서는 지원 중인 다른 LTS를 재평가할 수 있습니다. 현재 major의 지원 상태와 설치된 patch의 적합성은 구분합니다. Fastify는 지원하는 Node LTS 계열의 최신 patch를 지원 기준으로 명시합니다. 따라서 22.23.2가 최소 engine 조건을 만족한다는 사실만으로 미래 설치 시점의 전체 지원을 보장하지 않습니다. [Fastify LTS 정책](https://fastify.dev/docs/latest/Reference/LTS/)

**후속 검증과 경로:** Code Generation에서 설치 버전과 선택 패키지의 engine·peer dependency를 함께 확인합니다. 맞지 않으면 원인과 호환 가능한 선택을 검토하고 기록합니다. 지원 종료 전에 계속 사용할 런타임을 재평가합니다. 실행 확인과 설정 연결은 `src/runtime/`에 배치하며 사용자별 절대경로를 고정하지 않습니다.

### TECH-02 — React와 Vite SPA

**선택과 근거:** 한국어 보드·검토함·SR 상세·문서 편집·생성·인계를 React SPA로 구성하고 Vite로 개발·빌드합니다. React 공식 문서는 Vite의 react-ts 템플릿으로 앱을 시작하는 방법을 제공합니다. Vite 안내의 Node 최소 조건은 20.19 이상 또는 22.12 이상이며 설치된 22.23.2는 이 조건을 만족합니다. 템플릿·plugin의 추가 조건은 별도로 확인합니다. [React 앱 구성 안내](https://react.dev/learn/build-a-react-app-from-scratch), [Vite 시작 안내](https://vite.dev/guide/)

**대안과 위험:** 서버 렌더링을 포함하는 통합 React 프레임워크도 대안입니다. 현재 승인된 로컬 데모에는 SSR·서버 컴포넌트 요구가 없어 SPA를 선택합니다. 이는 제품 범위에 대한 설계 판단입니다. Vite를 선택해도 화면 전환·조회 상태·dirty 입력·오류 처리가 자동 구현되지는 않습니다. 별도 상태 관리·라우팅 라이브러리는 필요성을 확인한 경우에만 추가합니다.

**후속 검증과 경로:** `src/web/`의 UI-01부터 UI-26까지를 Functional Design에 맞춰 구현합니다. React·Vite·React plugin의 정확한 조합은 Code Generation에서 타입 검사·빌드·화면 검증 후 고정합니다. 역할과 현재 묶음, 진행·검토·게이트 유효성·Handoff별 외부 사실을 각각 표현합니다. Node·DB·CLI 의존성이 브라우저 번들로 들어가지 않게 검사합니다.

### TECH-03 — TypeScript와 런타임 검증 분리

**선택과 근거:** UI·서비스·도메인·adapter 계약에 TypeScript를 사용합니다. Vite는 TypeScript를 변환하지만 타입 검사는 하지 않습니다. 따라서 빌드와 별도로 `tsc --noEmit`에 해당하는 타입 검사를 필수 검증에 포함합니다. 실제 명령·프로젝트 설정은 Code Generation에서 정의합니다. [Vite TypeScript 안내](https://vite.dev/guide/features#transpile-only)

**대안과 위험:** JavaScript와 런타임 검증만으로도 구현할 수 있습니다. 다만 이 앱은 50개 메서드와 버전·게이트·오류 계약을 공유하므로 TypeScript를 선택합니다. 타입 검사를 통과해도 저장 데이터·브라우저 요청·Claude JSON의 실제 형식과 현재 권한이 보장되지는 않습니다. 입력 경계에서 구조를 검증하고 업무 규칙을 서버에서 다시 평가합니다.

**후속 검증과 경로:** `src/application/`과 `src/domain/`의 업무 타입은 Fastify·SQLite·React에 의존하지 않도록 유지합니다. 공통 DTO의 구체적 배치는 승인된 모듈 방향을 기준으로 후속 설계에서 정합니다. `tests/contract/`에서 공개 입력·출력·실패 형식과 provider 교체 계약을 검사합니다.

### TECH-04 — Fastify 5의 얇은 전송 계층

**선택과 근거:** Fastify 5로 브라우저 요청을 논리 서비스 계약에 연결합니다. Fastify 5는 Node 20 이상을 요구합니다. 기본 validator를 쓰는 경우 body·params·querystring과 응답에 해당하는 전체 JSON Schema 형식을 사용합니다. 선택 버전의 실제 schema 적용 지점은 후속 구현에서 확인합니다. [Fastify 5 전환 안내](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)

**대안과 위험:** Express도 Node 18 이상을 지원하는 간단한 서버 대안입니다. Fastify의 schema 기반 입력 검증과 응답 직렬화가 현재 계약 검증에 적합하다고 판단했습니다. framework 선택이 역할·동시 수정·게이트 유효성 검사를 대신하지는 않습니다. Fastify schema는 실행 코드처럼 취급해야 하며 사용자나 AI가 제공한 schema를 그대로 등록하지 않습니다. [Express 설치 조건](https://expressjs.com/en/starter/installing/), [Fastify 검증·직렬화 안내](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

**후속 검증과 경로:** C-02의 `src/application/`은 S-01부터 S-09까지 조정 책임을 유지합니다. Fastify 연결과 앱 시작의 구체적 배치는 `src/runtime/`을 포함한 Infrastructure Design에서 정합니다. UI 공개 메서드는 M-001부터 M-035, M-040부터 M-048까지 44개입니다. 내부 M-036부터 M-039, M-049, M-050을 공개 UI 호출로 노출하지 않습니다. 로컬 loopback 바인딩과 허용 origin·요청 검증 경계는 NFR Design·Infrastructure Design에서 정합니다. 실제 조직 인증이나 전역 인증 정보 변경을 전제하지 않습니다. HTTP 경로와 직렬화 세부 형식은 이 문서에서 확정하지 않습니다.

### TECH-05 — SQLite와 better-sqlite3

**선택과 근거:** 서버 설치가 따로 필요 없는 로컬 SQLite를 선택합니다. SQLite는 트랜잭션의 ACID 특성을 제공합니다. Node 연결 수단은 better-sqlite3를 우선 선택하고 13.0.3을 확인 후보로 둡니다. 공식 13.0.3 manifest의 Node 조건은 22 이상이며 darwin-arm64 항목과 prebuild 배포 파일을 확인했습니다. 이는 설치된 Node와 아키텍처의 후보 적합성 근거이며 실제 바이너리 로딩 결과는 아닙니다. [SQLite 트랜잭션 설명](https://sqlite.org/transactional.html), [better-sqlite3 13.0.3 릴리스](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3), [13.0.3 manifest](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/package.json)

**대안과 위험:** Node 내장 `node:sqlite`는 별도 DB addon을 줄이는 대안입니다. 다만 Node 22 문서상 플래그 없이 사용할 수 있게 된 뒤에도 experimental이며 Stability 1.1의 Active development 상태입니다. 현재 기준에서는 better-sqlite3를 우선 검증합니다. SQLite 자체의 트랜잭션 지원만으로 PlanRepo의 불변 버전·권한·승계·receipt 원자성이 자동 완성되지는 않습니다. [Node 22 SQLite API](https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/sqlite.md)

**native 배포 조건:** better-sqlite3 13.0.0부터 N-API로 전환하고 prebuilt 바이너리를 패키지에 포함하도록 변경했습니다. 이것이 모든 호스트의 로딩 성공을 보장하지는 않습니다. 선택 버전의 darwin-arm64 바이너리를 현재 Node에서 실제 로딩해야 합니다. 바이너리가 없거나 로딩에 실패하면 자동 컴파일이 반드시 실행된다고 가정하지 않습니다. 소스 빌드가 필요한 경우 지원되는 Python과 Xcode Command Line Tools를 확인해야 합니다. Python 3.9.6 조회만으로 준비 완료로 판정하지 않습니다. [better-sqlite3 13.0.0 변경](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0), [node-gyp macOS 조건](https://github.com/nodejs/node-gyp#on-macos)

**후속 검증과 경로:** `src/persistence/`에서 실제 DB 열기·쓰기·롤백·재개방과 내장 SQLite 버전을 확인합니다. Code Generation에서 검증한 정확한 driver 버전을 lockfile로 고정합니다. native 실패는 호환 릴리스 검토나 명시적 빌드 준비, 대안 driver 재평가로 다룹니다. 실패를 숨기고 메모리 저장이나 다른 driver로 자동 전환하지 않습니다. native 의존성은 백엔드에만 둡니다.

### TECH-06 — 같은 저장 경계의 업무 데이터와 영속 작업

**선택과 근거:** 한 로컬 앱의 저장 포트에서 업무 데이터와 생성 작업을 영속 관리합니다. C-02가 정책·변경·버전·현재 참조·요청 승계·활동·중복 요청 기록의 확정을 조정하고 C-04가 트랜잭션을 제공합니다. 별도 ORM·외부 작업 broker를 추가하지 않는 방향입니다. 이는 승인된 원자성과 로컬 범위를 충족하기 위한 설계 선택입니다. better-sqlite3의 동기 API는 짧은 저장 작업에 사용하며 transaction 함수 안에서 비동기 처리를 기다리지 않습니다. 공식 API는 async 함수를 transaction에 사용할 수 없다고 설명합니다. [better-sqlite3 소개](https://github.com/WiseLibs/better-sqlite3), [better-sqlite3 transaction API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

**대안과 위험:** 메모리 큐만 사용하면 재시작 후 작업 상태·소유권을 보존할 수 없습니다. 외부 DB나 broker는 현재 로컬 단위에 추가 실행 전제를 만듭니다. 동기 DB 작업이 길어지면 서버 응답이 지연될 수 있으므로 정해진 부하에서 측정합니다. worker thread·연결 수·인덱스·경합 재시도·복구 전략은 NFR Design에서 선택합니다. 긴 Claude 호출은 업무 트랜잭션 밖에 둡니다.

**WAL 선택 보류:** WAL은 읽기와 쓰기의 동시 진행에 도움이 되지만 동시에 쓸 수 있는 writer는 하나입니다. 같은 호스트의 저장이 전제이며 네트워크 파일시스템에서는 동작하지 않습니다. 추가 WAL·shared-memory 파일과 checkpoint 관리도 고려해야 합니다. SQLite는 WAL-reset 문제를 3.51.3 이상에서 수정했고 3.44.6·3.50.7에 수정 backport를 제공합니다. WAL을 선택하기 전에 실제 내장 SQLite 버전이 수정 버전인지 확인합니다. [SQLite WAL 동작과 수정 버전](https://sqlite.org/wal.html)

**후속 검증과 경로:** `src/persistence/`의 journal mode는 NFR Design에서 rollback journal과 WAL을 비교한 뒤 선택합니다. 실제 내구성 설정·재시작 보존·경합·checkpoint 영향과 데이터 이동 절차를 검증합니다. `src/generation-runtime/`은 내부 S-07 계약으로 영속 작업을 인수합니다. C-02가 C-05 또는 C-06을 직접 호출하는 의존성을 추가하지 않습니다. SQL schema·migration·claim 원자성·idempotency replay의 세부 패턴은 후속 설계에 남깁니다.

### TECH-07 — 설치 Claude의 교체 가능한 subprocess adapter

**선택과 근거:** C-06의 provider 계약 뒤에서 설치된 Claude CLI를 실행하는 수단으로 Node의 비동기 자식 프로세스 API를 검토합니다. Node 22의 `spawn`은 실행 파일과 인자 배열, 표준 입출력 스트림, 작업 폴더·환경, 취소·시간 제한 관련 수단을 제공합니다. shell은 기본적으로 사용하지 않습니다. 정확한 API·옵션 조합은 NFR Design에서 실행 경계를 검증한 뒤 확정합니다. [Node 22 child_process API](https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/child_process.md)

**대안과 위험:** 동기 실행은 기다리는 동안 호출 프로세스를 막으므로 긴 생성과 병행 화면 이용에 적합하지 않다고 판단했습니다. 별도 호스팅 AI API는 향후 adapter 대안이지만 첫 provider인 설치 Claude를 대체하지 않습니다. Node API만으로 Claude의 도구·파일·MCP·세션·인증 접근을 제한했다고 주장할 수 없습니다. `killed` 값은 신호 전달을 뜻하며 실제 종료와 같지 않습니다. 프로세스 종료와 표준 입출력 종료의 관찰도 구분합니다. [Node 22 자식 프로세스 종료 의미](https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/child_process.md)

**후속 검증과 경로:** `src/runtime/`이 PATH·프로젝트 기준 폴더·제한된 실행 환경을 제공하고 `src/providers/generation/`이 provider 입출력을 변환합니다. `src/generation-runtime/`은 실행 소유권·취소 전달·실제 종료 관찰을 담당합니다. 요청의 ProviderSelection과 입력 스냅샷을 고정하고 늦은 결과가 terminal 상태를 바꾸지 못하게 합니다. 2026-09-09 실제 호출로 기존 인증·`global.anthropic.claude-opus-4-8`/Bedrock 연결을 확인했습니다. 제품 출력 schema·취소·timeout·종료·전체 격리는 후속 검증으로 판정합니다. 테스트 adapter 통과만으로 실제 Claude 수용 기준을 충족했다고 기록하지 않습니다.

### TECH-08 — Vitest로 정책·계약·저장 통합 검증

**선택과 근거:** Vitest를 TypeScript 단위·계약·통합 테스트 도구로 사용합니다. 조사 시점의 공식 안내는 Vite 6.4.0 이상과 Node 22.12.0 이상을 요구합니다. 설치된 Node는 이 하한을 만족합니다. 실제 Vite·Vitest 조합과 plugin의 추가 조건은 Code Generation에서 함께 확인합니다. [Vitest 시작 안내](https://vitest.dev/guide/)

**대안과 위험:** Node 내장 테스트 runner도 대안입니다. Vite·TypeScript 개발 구성과 함께 관리하기 위해 Vitest를 선택합니다. 테스트 도구의 mock이나 타입 검사만으로 SQLite의 동시 변경·원자성·재시작 보존을 입증할 수 없습니다. 테스트 adapter는 실패·취소·오래된 결과를 재현하는 수단이며 실제 Claude 연결 증거를 대체하지 않습니다.

**후속 검증과 경로:** `tests/unit/`에서 순수 정책·표현 규칙을 검증합니다. `tests/contract/`에서 provider·저장 포트·Mock 계약을 검사합니다. `tests/integration/`에서는 실제 SQLite로 승인 행위와 게이트 통과의 분리, 버전 충돌·중복 receipt·요청 승계·인계 보존을 확인합니다. 행동 변경의 RED·GREEN과 관련 전체 검증을 기록합니다. 정확한 테스트 명령과 fixture 구성은 Code Generation 계획에서 정합니다.

### TECH-09 — Playwright로 브라우저 흐름 검증

**선택과 근거:** Playwright로 한국어 UI의 실제 사용자 흐름과 키보드 이용을 검증합니다. 공식 시스템 요구사항은 최신 Node 22.x·24.x·26.x와 macOS 14 이상을 안내합니다. 설치된 Node 22 계열은 대상 계열에 포함됩니다. Darwin 버전 조회만으로 macOS 제품 버전과 브라우저 실행의 전체 적합성을 판정하지 않습니다. [Playwright 시스템 요구사항](https://playwright.dev/docs/intro#system-requirements)

**대안과 위험:** 수동 브라우저 확인만으로 반복되는 승인·변경·인계 회귀를 검증할 수도 있으나 재현성이 낮습니다. Playwright로 흐름을 자동화하고 사용성 관찰을 별도로 남깁니다. Playwright 버전별로 대응하는 브라우저 바이너리가 필요하므로 npm 의존성 설치만으로 브라우저 준비가 끝나지 않습니다. [Playwright 브라우저 관리](https://playwright.dev/docs/browsers)

**후속 검증과 경로:** `tests/e2e/`에서 브라우저부터 실제 서비스·저장까지 연결합니다. 현재 묶음·권한·dirty 입력·중복 클릭·재접속·생성 중 조회·차단 이유와 담당자 탐색을 확인합니다. 시간 목표와 관찰 방법은 NFR 요구사항 문서를 따릅니다. 가상 시드를 쓰더라도 미구현 저장을 가짜 성공으로 대체한 결과를 실제 통합 통과로 집계하지 않습니다. 브라우저 설치·시작 명령과 지원 대상은 후속 실행 안내에서 확정합니다.

### TECH-10 — 안전한 Markdown 미리보기와 원문 보존

**선택과 근거:** React에서 Markdown을 표시하는 수단으로 react-markdown을 우선 검토합니다. 이 도구는 Markdown에서 React 요소를 만들고 기본적으로 raw HTML을 이스케이프하거나 설정으로 무시할 수 있습니다. plugin과 URL 변환·사용자 정의 컴포넌트는 안전성에 영향을 줄 수 있습니다. 따라서 라이브러리 도입 자체를 안전성 검증으로 취급하지 않습니다. [react-markdown 표시·보안 안내](https://github.com/remarkjs/react-markdown)

**대안과 위험:** 단순 텍스트 표시는 원문 확인에는 사용할 수 있지만 승인된 Markdown 미리보기 전체를 대신할 수 없습니다. raw HTML을 해석하는 plugin을 기본으로 추가하지 않습니다. 표 등 실제로 필요한 문법을 지원할 때만 관련 plugin을 검토합니다. 허용하지 않은 요소·속성을 제거하는 rehype-sanitize도 후보입니다. 선택한 변환 경로에 맞춰 필요성과 허용 schema를 NFR Design에서 정합니다. [rehype-sanitize 동작](https://github.com/rehypejs/rehype-sanitize)

**후속 검증과 경로:** `src/presentation/`은 안전한 표현·원문 비교·고정 Handoff 직렬화 규칙을 유지합니다. `src/web/`의 renderer는 C-02를 통해 받은 표현 계약을 사용하며 C-08의 서버 구현을 직접 호출하는 의존성을 추가하지 않습니다. 저장·내보내기 원문과 화면의 안전한 표시를 구분합니다. 스크립트·위험 URL·이벤트 속성·악성 HTML을 포함한 입력과 정상 한국어·표·코드 블록을 실제 렌더링으로 검사합니다. 실행 가능한 Markdown이나 문서 내용으로부터 명령을 실행하는 기능은 추가하지 않습니다.

### TECH-11 — lockfile과 재현 가능한 설치

**선택과 근거:** 프로젝트의 package manifest와 lockfile로 검증된 정확한 의존성을 고정합니다. npm 10의 `npm ci`는 lockfile을 요구하며 manifest와 lockfile이 맞지 않으면 수정 대신 실패합니다. 이 명령은 기존 설치 폴더를 다시 구성하므로 후속 검증용 프로젝트에서 실행 시점을 명확히 관리합니다. 이번 문서 단계에서는 실행하지 않았습니다. [npm 10 npm ci 안내](https://docs.npmjs.com/cli/v10/commands/npm-ci/)

**대안과 위험:** 범위 지정만 있는 manifest는 설치 시점마다 다른 의존성 조합을 허용할 수 있습니다. 다른 패키지 매니저를 추가할 필요는 현재 없습니다. 최신 버전 번호만 모아 즉시 pin하지 않습니다. better-sqlite3의 13.0.3은 조사한 확인 후보이며 React·Vite·TypeScript·Vitest·Playwright·Markdown 관련 정확한 버전도 아직 설치 검증 전입니다. Node 지원 일정과 각 패키지의 실제 engine·peer 조건을 따로 확인합니다.

**후속 검증과 경로:** Code Generation에서 프로젝트 루트의 `package.json`과 `package-lock.json`을 작성합니다. `npm ci`, 타입 검사, 빌드, 단위·계약·통합·브라우저 검증의 명령·exit code·결과를 남깁니다. 다른 프로젝트 경로에서 자산을 읽지 않는 복사본으로 재현성을 확인합니다. native 모듈과 브라우저 바이너리의 별도 설치 조건도 기록합니다. 구현 시작 명령·데이터 폴더·포트·배포 매핑은 Infrastructure Design에서 정하며 이 문서에서 전역 설치나 시스템 설정을 변경하지 않습니다.

## 3. 기존 9모듈과의 호환 매핑

다음 경로는 승인된 코드 배치입니다. 코드 폴더나 실행 파일을 지금 생성했다는 뜻은 아닙니다. 기술 도입으로 C 모듈·S 서비스·UOW를 추가하거나 별도 배포 단위로 바꾸지 않습니다.

| 모듈 | 프로젝트 루트 기준 경로 | 연결 기술 | 유지할 책임과 경계 |
|---|---|---|---|
| C-01 WebUI | `src/web/` | TECH-02, TECH-03, TECH-09, TECH-10 | 한국어 화면과 공개 서비스 호출을 담당합니다. DB·CLI를 직접 사용하지 않습니다. |
| C-02 ApplicationServices | `src/application/` | TECH-03, TECH-04, TECH-06, TECH-08 | 9개 S 서비스·50개 M 계약을 조정합니다. 6개 내부 메서드를 UI로 노출하지 않습니다. |
| C-03 DomainPolicies | `src/domain/` | TECH-03, TECH-08 | 현재 권한·게이트·ReviewImpact의 순수 정책을 유지합니다. |
| C-04 LocalPersistence | `src/persistence/` | TECH-05, TECH-06, TECH-08 | 불변 버전·현재 참조·원자적 저장·일관된 조회를 담당합니다. |
| C-05 GenerationRuntime | `src/generation-runtime/` | TECH-03, TECH-06, TECH-07, TECH-08 | 영속 작업 인수·실행 소유권·취소·종료 관찰을 담당합니다. |
| C-06 GenerationProviders | `src/providers/generation/` | TECH-03, TECH-07, TECH-08 | Claude와 테스트 adapter가 같은 provider 계약을 구현합니다. |
| C-07 ReferenceProviders | `src/providers/reference/` | TECH-03, TECH-08 | 가상 Jira·GitHub 자료와 링크를 처리합니다. 실계정 연결을 추가하지 않습니다. |
| C-08 DocumentPresentation | `src/presentation/` | TECH-03, TECH-08, TECH-10 | 안전한 표현·원문 비교·고정 인계 직렬화를 담당합니다. |
| C-09 ProjectRuntime | `src/runtime/` | TECH-01, TECH-04, TECH-07, TECH-11 | 프로젝트 기준 설정·PATH·가상 사용자·제한 프로세스 실행을 제공합니다. |

`tests/fixtures/`와 `config/`에는 승인된 가상 자료와 제품 설정을 둡니다. 실제 비밀 값을 fixture·설정 예시·로그·Handoff에 넣지 않습니다. 앱 코드는 프로젝트 루트의 구현 경로에 두고 문서는 `aidlc-docs/`에 둡니다. 호출 방향은 `aidlc-docs/inception/application-design/component-dependency.md`와 `aidlc-docs/inception/application-design/unit-of-work-dependency.md`를 유지합니다.

## 4. 후속 결정과 증거

| 다음 단계 | 확정하거나 검증할 내용 | 완료 판단에 필요한 증거 |
|---|---|---|
| NFR Design | 트랜잭션·충돌·receipt·일관된 조회·작업 claim·복구, journal mode와 안전한 Markdown 정책을 구체화합니다. | 승인된 품질 기준과 업무 불변식을 만족하는 패턴과 실패 처리 근거를 문서화합니다. 실행 증거가 필요한 가정은 미검증으로 표시합니다. |
| NFR Design | 설치 Claude를 제약 안에서 실행하는 API·CLI 옵션·도구/파일/세션 접근·취소/종료 수단을 검토합니다. | 지원하지 않는 제약을 옵션 이름만으로 보장하지 않습니다. 구현 시 확인할 관찰 기준과 불충족 처리를 정합니다. |
| Infrastructure Design | 로컬 프로세스·저장 위치·실행 명령·설정·PATH·복사본 실행과 정리 절차를 정합니다. | 사용자별 고정 경로 없이 프로젝트 자산으로 구성할 수 있는 실행 안내를 작성합니다. 운영 배포는 추가하지 않습니다. |
| Code Generation | 호환 패키지 설치·native 로딩·브라우저 준비·정확한 lockfile을 확정하고 행동 변경을 구현합니다. | 실제 명령과 결과, 타입 검사·빌드·테스트, 내장 SQLite 버전, 실제 Claude 초기 연결 결과를 기록합니다. |
| Build and Test | 승인된 NFR 측정 조건과 전체 수용 기준의 실제 통합 증거를 정리합니다. | 문서·mock 통과와 실제 저장·브라우저·Claude 통과를 구분합니다. 실패나 미검증 수용 기준은 완료로 바꾸지 않습니다. |

NFR 승인 시점에는 로컬 환경 값과 공식 기술 문서의 조건만 확인했습니다. 2026-09-09에는 기존 설치 환경으로 실제 모델 호출을 실행해 exit 0과 `global.anthropic.claude-opus-4-8`/Bedrock을 확인했습니다. 패키지 설치·native 모듈 로딩·서버 시작·브라우저 실행·앱 테스트·성능 측정과 AC-17 전체 흐름은 아직 실행하지 않았습니다.

Security Baseline·Resiliency Baseline·PBT 확장은 비활성입니다. 확장별 강제 규칙의 로딩과 적용은 생략했고 이 문서의 확장 준수 판정은 N/A입니다. 승인된 제품 NFR·현재 권한 검사·안전한 표시·TDD 기준은 유지합니다. NFR Requirements의 사용자 승인과 다음 단계 전환은 `aidlc-docs/aidlc-state.md`에서 별도로 기록합니다.
