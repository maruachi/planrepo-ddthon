# PlanRepo Code Generation 구현 계획

**2026-09-09 범위 조정:** 사용자 요청으로 핵심 프로토타입을 우선 구현했습니다. 최신 실행 계획은 aidlc-docs/construction/plans/planrepo-prototype-plan.md이며 결과는 aidlc-docs/construction/planrepo/code/prototype-report.md입니다. 아래 기존 전체 제품 계획의 미완료 항목과 새 TDD는 후속으로 보류합니다. 미검증 단계를 완료로 바꾸지 않습니다.

> 구현 시 Superpowers의 subagent-driven-development 또는 executing-plans로 작은 과제를 순서대로 실행합니다. AI-DLC의 이 계획과 단계 승인·체크박스를 기준으로 삼습니다.

버전은 0.1이며 **사용자 승인 완료 · 구현 중**입니다. 사용자 응답 “응 승인함 진행해”로 Infrastructure Design 0.1 두 문서를 승인받았습니다. 사용자 응답 “응 진행하도록”으로 전체 계획과 생성 순서를 승인받았습니다. Part 2의 첫 미완료 Step부터 구현합니다.

**목표**: UOW-01의 SR 등록부터 질문·결정·G1·G2·Handoff·외부 구현 이력까지 연결한 로컬 PlanRepo를 구현합니다.

**구조**: 단일 Node backend가 SQLite와 내부 생성 runtime을 소유합니다. React UI는 공개 44개 계약을 사용하며 설치 Claude는 교체 가능한 provider로 연결합니다. 9개 C 모듈과 9개 S 서비스·50개 M 메서드를 유지합니다.

**기술 스택**: 현재 Node 22.23.2·npm 10.9.8과 TypeScript·React/Vite·Fastify 5·better-sqlite3·Vitest·Playwright를 사용합니다. 현재 Claude CLI 2.1.263을 첫 provider로 검증하며 실제 패키지 pin과 native 조합은 첫 구현 과제에서 lockfile로 확정합니다.

**최신 Claude 실행 결정**: 사용자 지시에 따라 기존 환경과 explicit 모델 `global.anthropic.claude-opus-4-8`을 사용합니다. 실제 짧은 호출을 확인했으며 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`가 이전 제한 후보의 모델·환경 선택을 대체합니다.

**기준 설계**: `aidlc-docs/inception/application-design/unit-of-work.md`, `aidlc-docs/inception/application-design/unit-of-work-story-map.md`, `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`, `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`와 연결된 승인 문서 전체입니다.

## Part 1 작성 진행

- [x] 사용자 원문을 기록하고 Infrastructure Design 승인을 반영했습니다.
- [x] 단계·공통 규칙과 비활성 확장 설정을 확인했습니다.
- [x] 승인 문서의 단위·인터페이스·엔티티·스토리·수용 기준을 구현 과제에 연결했습니다.
- [x] B-01부터 B-06의 파일·계약·TDD RED/GREEN·검증 순서를 작성했습니다.
- [x] 직접 계획 대조와 독립 검토로 누락·타입·선행 관계를 보정했습니다.
- [x] 문서 파싱·추적·순서·경로·승인 입력 보존을 검증했습니다.
- [x] 상태·시작 안내·감사 기록을 갱신하고 전체 구현 계획 승인을 요청합니다.
- [x] 사용자 응답 “응 진행하도록”을 기록하고 Part 2 구현을 시작했습니다.

## 범위와 승인 경계

이 계획은 단일 UOW-01 Code Generation의 유일한 실행 기준입니다. B-01부터 B-06은 내부 구현 묶음이며 별도 unit이나 새 단계 승인 대상이 아닙니다. 작은 과제의 완료마다 테스트 근거와 체크박스를 함께 갱신합니다. 단위의 34개 스토리 전체 완료는 개별 122개 기준과 공통 7개 기준·연결 품질 조건의 실제 실행 근거가 모두 있을 때만 기록합니다.

문서 경로는 프로젝트 루트에서 시작합니다. 앱은 `src/`, 테스트는 `tests/`, 설정은 `config/` 아래에 구현하고 설명 문서는 `aidlc-docs/`에 둡니다. 다른 프로젝트·개인 경로를 필수 입력으로 쓰지 않습니다. 현재 작업 폴더의 기존 untracked 자산을 보존합니다. 승인된 구현·로컬 검증을 진행하며 외부 기록·배포는 별도 승인 경계를 유지합니다.

Security Baseline·Resiliency Baseline·PBT는 비활성으로 개별 규칙 N/A입니다. opt-in 3개만 읽고 full rule 적용을 생략합니다. 승인된 기본 품질 조건·권한·표시 안전성과 행동 변경의 TDD는 유지합니다.

## 1. 승인 입력과 전역 조건

이 계획과 함께 다음 문서의 전체 계약을 읽습니다. 이름만 가져오고 필수 조건을 생략하지 않습니다.

- 제품 범위는 `aidlc-docs/inception/requirements/requirements.md` 0.4이며 FR 23개·NFR 8개·AC 19개입니다.
- 스토리·역할은 `aidlc-docs/inception/user-stories/stories.md`, `aidlc-docs/inception/user-stories/personas.md`입니다.
- 서비스·호출 방향은 `aidlc-docs/inception/application-design/components.md`, `aidlc-docs/inception/application-design/component-methods.md`, `aidlc-docs/inception/application-design/services.md`, `aidlc-docs/inception/application-design/component-dependency.md`입니다.
- 단위·순서는 `aidlc-docs/inception/application-design/unit-of-work.md`, `aidlc-docs/inception/application-design/unit-of-work-dependency.md`, `aidlc-docs/inception/application-design/unit-of-work-story-map.md`입니다.
- 데이터·행동·화면은 `aidlc-docs/construction/planrepo/functional-design/domain-entities.md`, `aidlc-docs/construction/planrepo/functional-design/business-rules.md`, `aidlc-docs/construction/planrepo/functional-design/business-logic-model.md`, `aidlc-docs/construction/planrepo/functional-design/frontend-components.md`입니다.
- 수치·기술·패턴은 `aidlc-docs/construction/planrepo/nfr-requirements/nfr-requirements.md`, `aidlc-docs/construction/planrepo/nfr-requirements/tech-stack-decisions.md`, `aidlc-docs/construction/planrepo/nfr-design/nfr-design-patterns.md`, `aidlc-docs/construction/planrepo/nfr-design/logical-components.md`입니다.
- 실행 계약은 `aidlc-docs/construction/planrepo/infrastructure-design/infrastructure-design.md`와 `aidlc-docs/construction/planrepo/infrastructure-design/deployment-architecture.md`입니다.

| 조건 | 구현에 적용할 값 |
|---|---|
| 호스트·런타임 | macOS arm64, Node 22.23.2, npm 10.9.8, 기존 Claude CLI 2.1.263입니다. 전역 업그레이드를 준비 조건으로 추가하지 않습니다. |
| 일반·개발 주소 | 127.0.0.1:4173, 127.0.0.1:5173이며 정확한 Host/Origin·strictPort를 사용합니다. |
| 저장 | 프로젝트 내부 .planrepo/data/planrepo.sqlite, DELETE/FULL/FK ON/busy timeout 100ms입니다. |
| 생성 용량 | 같은 DB의 실제 실행 1개·nonterminal 총 10개입니다. running 1개이면 pending 최대 9개입니다. 종료 미확인 terminal도 실행 슬롯을 보유합니다. |
| 생성 시간 | spawn 시도부터 양쪽 출력 close·검증까지 300000ms입니다. 성공 commit 직전에 deadline을 다시 검사합니다. |
| 취소 관찰 | 제어 조회 250ms, 취소 확정 뒤 signal 전달 1초 목표, 유예 2000ms, 실제 종료 관찰 10000ms 목표입니다. |
| 요청·문서 bytes | command 8388608, artifact 1048576입니다. |
| AI 입출력 bytes | 모든 명시 입력 합계 2097152, stdout 4194304, stderr 262144, 정규화 초안 2097152입니다. |
| 인계 bytes | 고정 UTF-8 Markdown 8388608이며 초과 내용을 잘라 성공시키지 않습니다. |
| 응답·시작 | 비AI 읽기 p95 500ms·변경 p95 1000ms, UI 실제 내용 2초, 정상 기존 DB 시작 10초입니다. |
| 표본 | PERF-100의 100 SR·문서버전 2000개·질문1000·결정500·수정요청1000·활동20000개와 5 context입니다. API 동작별100개·UI 동작별20개, p95=ceil(0.95×n)번째입니다. |
| 표시·사용성 | 200 KiB 대표 본문과 1 MiB 경계를 분리합니다. 차단 이유·담당자10초 과업은 실제 대표 사용자로 관찰합니다. |

PERF-100의 기본 본문은 20 KiB입니다. 대표 문서 200 KiB·BOUNDARY 1 MiB 사례의 측정값을 섞지 않습니다.

현재 입력·역할·배정·묶음·receipt·현재 유효성은 별개입니다. 새 버전·ReviewImpact·미해결 요청 승계·활동·receipt를 같은 짧은 저장 경계에서 확정합니다. 개별 승인과 게이트 통과, answered와 resolved, 반영 확인 대기와 해결, AI 성공과 사람 적용을 구분합니다. G1 변경은 종속 G2를 무효화하고 과거 G2를 자동 복원하지 않습니다. H1의 외부 완료는 H2나 현재 SR의 완료가 아닙니다.

C-02는 C-05/C-06을 직접 호출하지 않습니다. C-05가 내부 S-07과 provider를 조정합니다. C-09의 기반 포트가 상위 업무 모듈을 역호출하지 않으며 조립은 `src/main.ts`가 맡습니다. provider는 DB·업무 API·승인 권한을 받지 않습니다.

같은 boot에서 강한 identity가 없는 crash gap은 승인 ND-10/INF-07의 알려진 제한입니다. 원 실행의 종료가 미확인이면 슬롯을 유지하고 NQ-21을 통과로 집계하지 않습니다. 이를 해결하려면 근거 있는 관찰 설계 보완과 별도 검증이 필요합니다. 시간이 지났다는 이유로 자동 해제하거나 재시도하지 않습니다.

## 2. 공통 구현·검증 인터페이스

### 요청·결과와 공개 연결

`src/contracts/context.ts`의 ProjectScope는 {kind:'project',projectId}, SrScope는 {kind:'sr',projectId,srId}로 구분합니다. ActorContext는 서버의 현재 역할/배정 결과입니다. wire 입력의 actorId는 가상 사용자 선택이며 역할 선언은 받지 않습니다. WriteGuard는 승인된 ENT-35와 NFR의 자원별 version/absent·BundleRef·InputFingerprint를 메서드별 schema로 표현합니다. 전체 SR revision을 모든 승인자 표의 충돌 기준으로 사용하는 단순화를 금지합니다.

`src/application/http/routes.ts`는 공개 44개 ID만 `POST /api/methods/M-ID`에 등록합니다. actor 선택은 `X-PlanRepo-Actor`, 몸체는 {scope,meta,input}입니다. meta에는 변경의 requestId·idempotencyKey·guard를 넣습니다. QueryContext에는 변경용 receipt를 요구하지 않습니다. M-002는 해당 브라우저의 사용자 선택 검증이며 서버 전역 actor를 바꾸지 않습니다. M-042의 고정 다운로드 bytes는 응답 본문으로 전송하며 receipt/현재 유효성 검사를 건너뛰지 않습니다.

Committed·Replayed·Rejected는 서비스의 실제 반환 구분입니다. 다음 helper의 ok는 테스트 편의를 위한 표기일 뿐이며 disposition·receipt·current·priorReceipt를 보존합니다. unknown 타입의 payload에 바로 필드를 접근하지 않고 메서드별 타입으로 좁힙니다.

```ts
type InvokeScope = {
  actorId: string; projectId: string; srId?: string;
  requestId?: string; idempotencyKey?: string; guard?: WriteGuard;
};
type InvokeResult<T> =
  | { ok: true; value: T; disposition: 'Query' | 'Committed' | 'Replayed';
      receipt?: CommandReceipt; current?: CurrentBasis }
  | { ok: false; error: DomainError; priorReceipt?: CommandReceipt };
interface TestApp {
  baseURL: string;
  server: FastifyInstance;
  db: DatabaseConnection;
  invoke<M extends PublicMethodId>(
    method: M, scope: InvokeScope, input: MethodInput<M>
  ): Promise<InvokeResult<MethodValue<M>>>;
  close(): Promise<void>;
}
declare function createTestApp(options: {
  fixture: 'empty' | 'DEMO-4'; testRunId: string;
}): Promise<TestApp>;
```

이 타입은 `tests/helpers/test-app.ts`에서 정의합니다. MethodInput/MethodValue/PublicMethodId는 CONTRACT의 `src/contracts/methods.ts`, 나머지 업무 타입은 `src/contracts/context.ts`·`src/contracts/results.ts`·`src/contracts/views.ts`에서 가져옵니다. FastifyInstance는 fastify, DatabaseConnection은 STORAGE의 SQLite 연결 타입입니다. 테스트 시작 시 실제 임시 DB에 migration·fixture를 적용하고 invoke는 실제 HTTP route를 inject합니다. runtime 내부 계약은 별도 test-only helper에서 실제 S-07을 주입하며 제품 HTTP로 열지 않습니다.

각 과제의 파일 표에는 핵심 소유 파일을 표시합니다. 실제 공개 handler를 연결하는 main·HTTP routes·TestApp·조회 소비부 변경도 그 과제의 구현과 검토 범위입니다. 조회 내용 보완은 `aidlc-docs/construction/planrepo/code/view-readiness.md`, 선행 의존 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`를 따릅니다. CG-05부터 task 시작 snapshot은 전체 애플리케이션 소스를 보존하고 변경된 파일만 diff에 포함해 공통 연결 변경을 빠뜨리지 않습니다.

TestApp의 생성 인수는 기본 manual/paused입니다. provider unavailable만으로 자동 인수 정지를 추정하지 않습니다. CG-12의 tests/helpers/generation-controller.ts가 startTestAdapter를, CG-15가 사전 검증한 startLiveCandidate를 명시 호출할 때만 해당 앱의 루프를 시작합니다. 제품의 일반 runtime 시작과 분리하며 공개 HTTP에서 이 제어를 제공하지 않습니다.

보존할 실행 증거가 있는 테스트는 randomUUID 기반 testRunId를 발급합니다. 기존 testRunId 폴더가 남아 있으면 덮거나 자동 reset하지 않고 새 ID를 사용합니다.

DB 직접 경계 테스트는 HTTP보다 먼저 실행할 수 있어야 합니다. STORAGE의 fixture는 connection/transaction만 만듭니다. `createTestApp`은 HTTP 과제에서 완성합니다. Playwright는 테스트별로 예약한 정확한 loopback 포트와 TestApp의 같은 baseURL을 사용합니다. test mode와 testRunId가 없거나 사용자 DB와 경로가 겹치면 실패합니다. close는 내부 정리·종료 관찰·저장 확정 뒤 서버와 DB를 닫으며 확인되지 않은 자식의 폴더를 지우지 않습니다.

### 빌드·명령 계약

서버는 `scripts/build.mjs`에서 esbuild의 platform=node·format=esm·target=node22·bundle=true·packages=external로 자체 TypeScript와 alias를 묶어 `dist/server/main.js`로 출력합니다. native better-sqlite3는 외부 package로 남깁니다. Vite는 웹만 `dist/web/`에 출력합니다. 서버 빌드의 별칭 치환과 typecheck는 다른 작업입니다. [esbuild packages](https://esbuild.github.io/api/#packages), [TypeScript 처리](https://esbuild.github.io/content-types/#tsconfig-json)

Vitest는 Vite와 별도 설정에서도 같은 루트 alias를 명시하고 unit/contract/integration을 지정합니다. 브라우저 테스트는 별도 Playwright 구성으로 실행합니다. 설정·API가 설치 버전과 일치하는지 BOOT에서 확인합니다. [Vitest 설정](https://vitest.dev/config/)

패키지는 첫 구현 시 version·engines·peerDependencies를 확인하고 정확한 버전으로 고정합니다. runtime 의존은 React·React DOM·Fastify 5·호환 @fastify/static·better-sqlite3·선택한 Markdown parser/sanitizer입니다. 개발 의존은 TypeScript·해당 타입·Vite/React plugin·Vitest·Playwright·tsx·esbuild입니다. 테스트 helper 목적만의 추가 프레임워크를 기본으로 늘리지 않습니다. Markdown 도구는 승인 TECH/ND의 raw HTML·URL·원문 보존 조건을 실제 fixture로 비교해 선택하고 근거를 기록합니다.

모든 실행 명령은 프로젝트 루트에서 실행합니다. 아래 scripts는 각 소유 과제의 코드와 함께 연결하고 파일이 없는데 성공 exit를 내는 임시 구현을 넣지 않습니다.

| 명령 | 연결할 구현 |
|---|---|
| npm ci | package-lock.json에 고정한 의존성을 설치합니다. |
| npm run typecheck | tsconfig.server.json·tsconfig.web.json으로 noEmit 검사합니다. |
| npm test | vitest run으로 단위·계약·실제 SQLite 통합을 실행합니다. |
| npm run build | node scripts/build.mjs로 서버와 Vite 웹을 빌드합니다. |
| npm run db:migrate | 정지 상태의 migration 명령을 실행합니다. |
| npm run seed:demo | 정지 상태의 빈 업무 DB에만 DEMO-4를 원자적으로 넣습니다. |
| npm start | node dist/server/main.js로 일반 앱을 시작합니다. |
| npm run dev | tsx scripts/start-dev.ts로 두 로컬 프로세스를 관리합니다. |
| npm run test:e2e | Playwright의 격리 앱과 브라우저 검증을 실행합니다. |
| npm run test:perf | PERF-100 자료·표본·원시 측정값과 p95를 기록합니다. |
| npm run verify:claude | 별도 명시한 실제 가상 Claude 검증을 실행합니다. |
| npm run test:acceptance | 실제 테스트 결과와 AI·사용성 증거의 기준 충족 여부를 집계합니다. |

최초 정상 실행은 의존성 준비·타입 검사·기본 테스트·build 뒤 offline migration·seed를 수행하고 start합니다. 기존 DB는 start만 하며 자동 seed/reset/migration을 하지 않습니다. 실제 Claude·Chromium·native 의존성의 설치/네트워크/인증 전제는 실행 결과에 기록합니다. 실패나 미실행을 자동 테스트 성공으로 바꾸지 않습니다.

## 3. 과제 진행 규칙

아래 Task는 구현·검토 가능한 작업 단위입니다. 각 task의 Step 번호는 문서 전체에서 순서대로 증가합니다. 행동별 테스트 하나를 추가해 예상한 RED를 확인하고 최소 코드로 GREEN을 만든 뒤 다음 사례로 진행합니다. task에 나열된 모든 경계 사례를 한꺼번에 구현한 뒤 테스트를 덧붙이지 않습니다.

각 task의 파일 목록은 첫 등장 때 생성하고 이후 같은 파일은 수정합니다. 실제 소유 파일을 나눌 수 있는 과제만 병행합니다. 저장·공통 계약·registry·같은 컴포넌트는 선행 변경을 반영한 뒤 순서대로 수정합니다. task의 계약과 코드 예시는 구현에 필요한 시작 단위이며 같은 절에 적힌 거절·경쟁·표시 조건도 완료에 포함합니다.

RED에서 테스트 실행기·import 설정·fixture 자체 오류는 행동 실패와 구분합니다. GREEN 뒤 필요한 타입·관련 전체 테스트를 실행하고 `aidlc-docs/audit.md`에 명령·exit code·결과를 추가합니다. 코드 요약 문서는 DOCS 과제에서 모으고 마지막 ACCEPTANCE 결과로 갱신하되 각 task의 구현/테스트 근거는 즉시 기록합니다. commit은 로컬 변경을 구체적으로 검토한 뒤 관련 파일만 묶고 기존 untracked 자산을 한꺼번에 추가하지 않습니다. push·외부 기록·배포는 이 계획의 자동 단계에 넣지 않습니다.

계약 구현이 준비돼도 실제 Claude·사용성·복구 증거가 막히면 그 기준과 완료 체크박스는 미완료로 남깁니다. 승인된 단위 정의에 따라 독립 작업은 이어갈 수 있습니다. 같은 boot 복구의 NQ-21을 포함해 필수 기준의 실패가 남아 있으면 UOW를 완료하지 않습니다. 관찰 수단 추가나 요구사항 조정이 필요하면 실행 근거와 검토 가능한 변경안을 먼저 제시합니다.

## 4. 구현 순서와 파일 소유

총 28개 과제와 168개 구현 Step입니다. B-01은 8개, B-02는 7개, B-03은 4개, B-04는 1개, B-05는 2개, B-06은 6개 과제입니다. 같은 파일은 첫 task에서 생성하고 뒤 task에서 확장합니다. 기존 9개 모듈을 추가 서비스나 unit으로 쪼개지 않습니다.

| 과제 | key | 묶음 | 내용 | 선행 과제 |
|---|---|---|---|---|
| CG-01 | BOOT | B-01 | 프로젝트 도구·루트 설정과 격리된 테스트 실행기 | 없습니다. |
| CG-02 | CONTRACT | B-01 | 공통 자료형·50개 서비스 계약과 공개 메서드 경계 | CG-01 |
| CG-03 | STORAGE | B-01 | 35개 엔티티 관계 스키마와 원자적 저장·receipt 기반 | CG-01, CG-02 |
| CG-04 | SEED | B-01 | 정지 상태의 schema 준비와 원자적 DEMO-4 시드 | CG-03 |
| CG-05 | HTTP | B-01 | 로컬 HTTP 연결·준비 상태와 실제 앱 테스트 harness | CG-01, CG-02, CG-03, CG-04 |
| CG-06 | SR_CONTEXT | B-01 | SR 직접 등록·Mock 중복 가져오기·최초 설명과 기본 조회 | CG-03, CG-05 |
| CG-07 | SOURCE | B-01 | 근거 자료의 미확인 등록과 버전에 고정한 사람의 확인 | CG-06 |
| CG-08 | UI_BASE | B-01 | 공통 화면·요청 상태와 격리된 브라우저 fixture를 연결합니다. | CG-01, CG-02, CG-03, CG-04, CG-05, CG-06, CG-07 |
| CG-09 | EDITOR | B-02 | 질문·답변·결정 기본 경로와 문서 버전·초안 적용 | CG-05, CG-06, CG-07, CG-08 |
| CG-10 | RUN_REQUEST | B-02 | 현재 입력·provider 선택의 고정과 생성 접수·조회·취소·재시도 | CG-01, CG-02, CG-03, CG-05, CG-09 |
| CG-11 | RUN_CLAIM | B-02 | 단일 claim·launch intent·첫 terminal·종료 slot의 저장 경계 | CG-10 |
| CG-12 | RUN_PROCESS | B-02 | 동시 pipe·deadline·취소·종료 관찰을 분리하는 제한 Node runner | CG-01, CG-02, CG-11 |
| CG-13 | RUN_PROVIDER | B-02 | 검증 가능한 Claude CLI 프로파일·결과 검증·동일 provider 교체 계약 | CG-10, CG-11, CG-12 |
| CG-14 | RUN_RECOVERY | B-02 | 시작·정상 종료·crash gap 복구와 known limitation의 명시 | CG-11, CG-12, CG-13 |
| CG-15 | RUN_LIVE | B-02 | 초기 실제 Claude 가상 흐름·교체 증거와 지원 판정 | CG-09, CG-10, CG-11, CG-12, CG-13, CG-14 |
| CG-16 | QUESTION | B-03 | 질문 해결·결정 전환·재결정·후속 범위의 불변 처리 이력 | CG-07, CG-09 |
| CG-17 | POLICY | B-03 | 팀 정책 버전과 문서 없는 최초 검토자 배정 | CG-06, CG-09 |
| CG-18 | G1 | B-03 | G1 불변 묶음·개별 승인·현재 조건 재검사와 단계 전환 | CG-09, CG-16, CG-17 |
| CG-19 | CHANGE | B-03 | 댓글·수정 반영·현재 버전 확인과 모든 미해결 요청 승계 | CG-09, CG-17, CG-18 |
| CG-20 | G2 | B-04 | 진행 계획·설계·구현 계획과 정확한 G1을 고정하는 G2 | CG-09, CG-17, CG-18, CG-19 |
| CG-21 | HANDOFF | B-05 | 불변 Handoff 생성·미리보기·현재용 내보내기와 receipt 재검사 | CG-05, CG-09, CG-15, CG-20 |
| CG-22 | EXTERNAL | B-05 | Handoff별 수동 외부 시작·완료와 과거 활동 조회 | CG-19, CG-20, CG-21 |
| CG-23 | UI_BOARD | B-06 | 팀 보드·내 검토함과 실제 처리 대상 이동을 마무리합니다. | CG-08, CG-18, CG-20, CG-21 |
| CG-24 | UI_REVIEW | B-06 | 결정·범위·배정 변경과 재검토 화면을 통합합니다. | CG-08, CG-18, CG-20, CG-21, CG-23 |
| CG-25 | UI_DRAFT | B-06 | 생성 작업·초안 적용·문서 비교의 사용자 경계를 완성합니다. | CG-08, CG-15, CG-18, CG-20, CG-21, CG-23 |
| CG-26 | QUALITY | B-06 | 5 context의 표시·키보드·성능을 검증합니다. | CG-21, CG-23, CG-24, CG-25 |
| CG-27 | DOCS | B-06 | 실행 안내·계층 요약과 Build and Test 인계를 정리합니다. | CG-26 |
| CG-28 | ACCEPTANCE | B-06 | 원 수용 기준의 실행 증거와 전체 완료 판정을 연결합니다. | CG-21, CG-23, CG-24, CG-25, CG-26, CG-27 |

정상 구현은 표의 순서를 따릅니다. BOOT·CONTRACT·STORAGE·HTTP의 공유 파일을 동시에 수정하지 않습니다. B-02의 실제 외부 검증이 막히더라도 그 결과를 보존하고 독립 업무 구현은 이어갈 수 있다는 단위 정의의 예외를 유지합니다.

### CG-01 프로젝트 도구·루트 설정과 격리된 테스트 실행기

**구현 묶음**: B-01입니다. **선행**: 없습니다.

**연결 기준**: SCN-24, NQ-04, NQ-17, NQ-23, NQ-24, ND-13, INF-01, INF-02, INF-03, INF-09입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `package.json` | 생성합니다. | Node engine·정확한 의존성과 승인 CMD-01부터 CMD-12의 scripts입니다. |
| `package-lock.json` | 생성합니다. | 선택한 호환 버전과 설치 결과를 고정합니다. |
| `.gitignore` | 생성합니다. | node_modules·dist·.planrepo·테스트 결과를 제외합니다. |
| `tsconfig.json` | 생성합니다. | 공통 strict·별칭 설정입니다. |
| `tsconfig.server.json` | 생성합니다. | 서버와 명령 스크립트의 TypeScript 검사·빌드 범위입니다. |
| `tsconfig.web.json` | 생성합니다. | 브라우저 전용 DOM 타입·검사 범위입니다. |
| `vitest.config.ts` | 생성합니다. | unit/contract/integration 테스트와 명시 test mode입니다. |
| `vite.config.ts` | 생성합니다. | 5173 strictPort·정적 경계·4173 proxy입니다. |
| `config/planrepo.json` | 생성합니다. | INF-03의 기본 JSON을 그대로 구현합니다. |
| `src/runtime/config.ts` | 생성합니다. | RuntimeConfig·루트·환경 override·포트 검증입니다. |
| `src/runtime/paths.ts` | 생성합니다. | 프로젝트 내부 realpath와 경로 탈출 검사입니다. |
| `tests/helpers/root-fixture.ts` | 생성합니다. | createRootFixture(): {root:string;remove():void}로 빈 임시 프로젝트를 만들고 정리합니다. |
| `tests/unit/runtime-paths.test.ts` | 생성합니다. | 루트 이동·상위/절대경로·symlink 탈출·test DB 중첩 거절을 검사합니다. |
| `src/web/env.d.ts` | 생성합니다. | 브라우저 전용 타입 선언이며 서버 타입을 전역으로 노출하지 않습니다. |

**인터페이스와 입력 조건**

resolveProjectPath(root: string, configuredPath: string): string은 존재하는 가장 가까운 조상까지 realpath를 확인하고 루트 안의 정상 경로만 반환합니다. loadRuntimeConfig(root: string, env: Record<string,string | undefined>): RuntimeConfig는 INF-03 JSON schema·허용 override를 검사합니다. 루트 fixture는 테스트가 소유한 경로만 정리합니다. 코드 별칭 @는 프로젝트 루트로 정하고 앱·Vitest·TS·Vite의 해석을 일치시킵니다.

- [x] **Step 001: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { resolveProjectPath } from '@/src/runtime/paths';
import { createRootFixture } from '@/tests/helpers/root-fixture';

test('설정 경로로 프로젝트 바깥을 선택하지 못한다', () => {
  const fixture = createRootFixture();
  try {
    expect(() => resolveProjectPath(fixture.root, ['..', 'outside'].join('/'))).toThrow();
  } finally { fixture.remove(); }
});
```

- [x] **Step 002: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/unit/runtime-paths.test.ts
```

예상 결과는 다음과 같습니다. 테스트 실행기와 import 가능한 최소 모듈을 준비한 뒤 루트 밖 경로 거절 assertion이 실패하는지 확인합니다. 미구현 모듈의 import 오류·npm 자체 미설치·설정 파싱 오류는 행동 RED로 세지 않습니다.

- [x] **Step 003: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

도구 설정은 행동 구현 전 준비합니다. npm view로 각 패키지의 version·engines·peerDependencies를 읽고 현재 Node 22.23.2와 Fastify 5의 호환성을 확인한 정확한 버전만 --save-exact로 설치합니다. manifest/lockfile을 함께 생성하며 native module과 Chromium 준비 조건을 기록합니다. 프로젝트 밖 경로·NUL·상위 성분·symlink 탈출을 검사한 뒤 INF-03 값을 검증합니다. 일반 실행에 테스트 경로를 허용하는 암묵 fallback을 두지 않습니다.

```ts
const segments = configuredPath.split(/[\\/]/u);
if (segments.includes('..') || configuredPath.includes('\0')) {
  throw new Error('프로젝트 내부 경로만 사용할 수 있습니다.');
}
```

이 검사는 paths.ts 함수의 첫 검사입니다. 이어 isAbsolute·realpath 경계를 검사하며 문자열 prefix만으로 경계를 판정하지 않습니다. 성공 뒤 npm run typecheck로 서버/브라우저 분리를 확인합니다.

- [x] **Step 004: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/unit/runtime-paths.test.ts
```

통과 조건은 다음과 같습니다. 정상 내부 경로·새 루트 재배치·탈출 거절·testRunId 누락과 사용자 DB 중첩 거절이 통과합니다.

- [x] **Step 005: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 006: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

프로젝트 도구로 Vitest와 타입 검사를 실행하고 INF-03 기본 설정을 파싱합니다. 실제 Claude는 호출하지 않습니다. 승인된 전체 package script 중 구현 전 명령은 성공으로 위장하지 않으며 소유 task에서 실제 파일을 연결합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-02 공통 자료형·50개 서비스 계약과 공개 메서드 경계

**구현 묶음**: B-01입니다. **선행**: CG-01입니다.

**연결 기준**: M-001, M-002, M-003, M-004, M-005, M-006, M-007, M-008, M-009, M-010, M-011, M-012, M-013, M-014, M-015, M-016, M-017, M-018, M-019, M-020, M-021, M-022, M-023, M-024, M-025, M-026, M-027, M-028, M-029, M-030, M-031, M-032, M-033, M-034, M-035, M-036, M-037, M-038, M-039, M-040, M-041, M-042, M-043, M-044, M-045, M-046, M-047, M-048, M-049, M-050, SCN-12, NQ-07, NQ-08, NQ-10, NQ-22, ND-01, ND-04, INF-05입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/context.ts` | 생성합니다. | ProjectScope/SrScope·Actor 입력·WriteGuard·VersionRef/BundleRef입니다. |
| `src/contracts/results.ts` | 생성합니다. | Committed/Replayed/Rejected·DomainError·receipt DTO입니다. |
| `src/contracts/methods.ts` | 생성합니다. | M-001부터 M-050까지 입력/출력 타입과 공개 44개 목록입니다. |
| `src/contracts/schemas.ts` | 생성합니다. | JSON schema와 명령별 필수 guard·요청 상한입니다. |
| `src/contracts/views.ts` | 생성합니다. | 조회·문서·Run·검토·인계 화면의 wire DTO입니다. |
| `tests/contract/public-methods.test.ts` | 생성합니다. | 내부 6개 계약 비노출·명령 schema/guard 누락을 검사합니다. |
| `src/providers/generation/provider-contract.ts` | 생성합니다. | GenerationProvider와 ProviderRequest/결과의 provider 독립 계약입니다. |

**인터페이스와 입력 조건**

PublicMethodId와 InternalMethodId를 분리합니다. Methods[M]은 승인 component-methods의 input·output을 연결합니다. srId와 projectId는 wire에서 함께 받고 서버가 소속을 재확인합니다. CommandResult<T>의 kind는 Committed/Replayed/Rejected이며 조회·현재 유효성·이전 receipt를 합치지 않습니다. 시각·역할·실행 token은 서버에서만 만듭니다.

src/providers/generation/provider-contract.ts도 여기서 먼저 정의합니다. GenerationProvider.generate(ProviderRequest,ExecutionControl): Promise<ProviderOutcome>와 provider 독립 입력·초안/실패·제어·관찰 타입을 승인 C-06 경계로 구체화합니다. DB·RuntimeContext·HTTP 주체를 넘기지 않습니다. CG-12는 이 타입으로 C-05 루프를 구현하고 CG-13은 같은 계약의 실제 adapter를 구현합니다.

- [x] **Step 007: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { PUBLIC_METHOD_IDS } from '@/src/contracts/methods';

test('내부 실행 계약 여섯 개를 공개하지 않는다', () => {
  expect(PUBLIC_METHOD_IDS).toHaveLength(44);
  for (const method of ['M-036', 'M-037', 'M-038', 'M-039', 'M-049', 'M-050']) {
    expect(PUBLIC_METHOD_IDS).not.toContain(method);
  }
});
```

- [x] **Step 008: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/contract/public-methods.test.ts
```

예상 결과는 다음과 같습니다. 공개 계약 목록 구현 전 테스트가 실패합니다. 내부 6개를 공개로 추가한 변형도 실패해야 합니다.

- [x] **Step 009: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

승인된 50행에서 서비스 이름·메서드 이름·필수 입력·결과를 하나의 명시 등록표로 옮깁니다. 조건부 필드는 ENT 정의와 WriteGuard 매핑으로 구체화하고 타입과 runtime schema를 같은 테스트로 검사합니다. 아래 구분을 results.ts에 사용합니다.

```ts
export type CommandResult<T> =
  | { kind: 'Committed'; value: T; receipt: CommandReceipt }
  | { kind: 'Replayed'; value: T; receipt: CommandReceipt; current: CurrentBasis }
  | { kind: 'Rejected'; error: DomainError; priorReceipt?: CommandReceipt };
```

CommandReceipt·DomainError는 승인 공통 계약을 그대로 타입화합니다. CurrentBasis는 현재 revision과 해당 대상의 현재 유효성·허용 행동이며 receipt의 과거 값으로 채우지 않습니다. 텍스트 코드를 eval하거나 임의 서비스 이름으로 dispatch하지 않습니다.

- [x] **Step 010: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/contract/public-methods.test.ts
```

통과 조건은 다음과 같습니다. 50개 메서드가 고유하고 공개44/내부6이 분리됩니다. 각 명령 schema에 필요한 scope·guard·enum·크기·미지원 필드 거절 검증이 통과합니다.

- [x] **Step 011: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 012: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

후속 task가 같은 DTO·서비스 반환을 사용합니다. wire DTO에 DB 핸들·RuntimeContext·ClaimRef token을 포함하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-03 35개 엔티티 관계 스키마와 원자적 저장·receipt 기반

**구현 묶음**: B-01입니다. **선행**: CG-01, CG-02입니다.

**연결 기준**: US-001, US-002, US-003, ENT-01, ENT-02, ENT-03, ENT-04, ENT-05, ENT-06, ENT-07, ENT-08, ENT-09, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, ENT-32, ENT-33, ENT-34, ENT-35, SCN-01, SCN-14, SCN-17, SCN-24, NQ-02, NQ-04, NQ-05, NQ-06, NQ-07, NQ-08, NQ-14, NQ-21, NQ-23, ND-01, ND-02, ND-08, ND-10, ND-13, INF-02, INF-04, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/persistence/migrations/0001-planrepo.ts` | 생성합니다. | ENT-01부터 ENT-35까지의 초기 DDL, 복합 범위 FK·고유 제약·bootstrap registry를 한곳에서 정의합니다. |
| `src/persistence/database.ts` | 생성합니다. | 단일 connection의 DELETE/FULL/FK ON/busy timeout 확인과 준비 실패를 처리합니다. |
| `src/persistence/failure.ts` | 생성합니다. | transaction 종류와 관계없이 rollback과 IO/손상 오류의 connection 폐기를 같은 경계에서 처리합니다. |
| `src/persistence/transaction.ts` | 생성합니다. | 동기 withinTransaction/readConsistent와 rollback·connection 불확실 상태를 처리합니다. |
| `src/persistence/command-receipts.ts` | 생성합니다. | NULL 없는 receipt 고유 키와 입력 지문·고정 결과 참조를 저장합니다. |
| `src/persistence/maintenance.ts` | 생성합니다. | 동시 시작과 offline migration/seed의 공통 DB 소유권 경계를 구현합니다. |
| `src/contracts/results.ts` | 수정합니다. | 고정 receipt 결과가 EntityRef·VersionRef·BundleRef를 정확히 표현하도록 ReceiptResultRef를 정의합니다. |
| `tests/helpers/test-database.ts` | 생성합니다. | HTTP 없는 createTestDatabase와 실제 연결·close를 제공합니다. |
| `tests/integration/storage-atomicity.test.ts` | 생성합니다. | 실제 SQLite rollback·FK·receipt 경쟁·재개방을 검사합니다. |
| `tests/contract/public-methods.test.ts` | 수정합니다. | version·bundle 결과 참조를 담은 정상 receipt 타입 사례를 고정합니다. |
| `aidlc-docs/construction/planrepo/code/storage-and-schema.md` | 생성합니다. | 35개 ENT의 테이블·키·FK·현재 포인터·불변 버전 및 migration 결과를 기록합니다. |
| `aidlc-docs/construction/planrepo/code/repository-summary.md` | 생성합니다. | 저장 포트와 트랜잭션 소유를 정리합니다. |

**인터페이스와 입력 조건**

HTTP나 createTestApp에 의존하지 않는 DB 직접 테스트입니다. createTestDatabase({testRunId})는 독립 경로의 실제 DB와 close를 반환하고 createPersistence(db)의 withinTransaction(work)는 같은 connection을 동기 callback에 전달합니다. 초기 DDL은 35개 업무 ENT와 별도 runtime/maintenance/slot 보조 자료를 만들되 각 업무 행동은 뒤 task에서 구현합니다. 자기 참조·현재 포인터는 같은 SrScope의 불변 버전만 가리키고 업무 참조는 프로젝트 절대경로를 저장하지 않습니다.

- [x] **Step 013: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '@/tests/helpers/test-database';
import { createPersistence } from '@/src/persistence/transaction';

it('callback 실패가 업무와 receipt 성격의 두 쓰기를 모두 취소합니다', async () => {
  const fixture = await createTestDatabase({ testRunId: randomUUID() });
  try {
    const db = fixture.db;
    db.exec('CREATE TEMP TABLE atomic_values (id TEXT PRIMARY KEY)');
    db.exec('CREATE TEMP TABLE atomic_receipts (id TEXT PRIMARY KEY)');
    const persistence = createPersistence(db);
    expect(() => persistence.withinTransaction(tx => {
      tx.prepare('INSERT INTO atomic_values(id) VALUES (?)').run('version-1');
      tx.prepare('INSERT INTO atomic_receipts(id) VALUES (?)').run('receipt-1');
      throw new Error('주입한 저장 실패');
    })).toThrow('주입한 저장 실패');
    expect(db.prepare('SELECT count(*) AS n FROM atomic_values').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM atomic_receipts').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    await fixture.close();
  }
});
```

- [x] **Step 014: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/storage-atomicity.test.ts
```

예상 결과는 다음과 같습니다. 모듈·harness의 수집 가능 상태를 BOOT/CONTRACT에서 준비합니다. 초기 비원자적 저장 구현에서 주입한 예외 뒤 행이 남아 count=0 단언이 실패해야 합니다. import/설치 실패나 SQLite 자체 예외만을 예상 RED로 집계하지 않습니다.

- [x] **Step 015: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

db.transaction(work).immediate()를 감싸되 callback은 Promise를 반환하지 못하게 검사합니다. rollback 여부를 확인할 수 없는 IO/commit 실패는 connection을 폐기하고 readiness를 내립니다. receipt UNIQUE(scope_kind, project_id, scope_target_id, actor_id, idempotency_key)를 만들고 command_kind는 비교값으로 둡니다. ProjectScope의 scope_target_id=projectId로 NULL을 없앱니다. app_migrations 번호/checksum과 DDL/DML을 같은 commit에 넣고 내부 schema_version을 수정하지 않습니다. backend 등록은 BEGIN IMMEDIATE 안에서 maintenance·지원 schema를 재확인해 확정하고, offline 유지보수는 BEGIN EXCLUSIVE 이후 runtime/slot/running 재확인부터 commit까지 같은 잠금을 유지합니다. FK·SR 소속·불변 버전의 append-only repository 경계를 만들고 receipt/activity를 임의 삭제하지 않습니다.

- [x] **Step 016: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/storage-atomicity.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 대표 rollback, 각 업무 쓰기 지점의 실패 주입, 다른 connection의 동일 키 경쟁, schema mismatch, migration/seed 경쟁과 실패 보존, 재개방 검증이 통과합니다. DELETE/FULL을 전원 손실 무손실 보장으로 확대하지 않습니다.

- [x] **Step 017: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 018: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

35개 ENT 대응표·FK 검사·소속 위반·NULL 없는 receipt 고유성·불변 버전 보존과 metadata 원자성을 검증합니다. 실제 업무 API 원자성은 SR_CONTEXT부터 확대합니다. HTTP와 순환 의존하지 않으며 실제 실행 명령·exit code를 문서에 기록합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-04 정지 상태의 schema 준비와 원자적 DEMO-4 시드

**구현 묶음**: B-01입니다. **선행**: CG-03입니다.

**연결 기준**: US-001, US-002, US-003, ENT-01, ENT-02, ENT-03, ENT-04, ENT-05, ENT-06, ENT-07, ENT-08, ENT-09, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, ENT-32, ENT-33, ENT-34, ENT-35, SCN-01, SCN-24, NQ-01, NQ-05, NQ-06, NQ-23, ND-01, ND-13, INF-04, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `config/demo/manifest.json` | 생성합니다. | 가상 프로젝트·사용자와 네 SR의 고정 ID·초기 상태·자료 버전입니다. |
| `config/demo/scenarios.json` | 생성합니다. | PAY-102·AUTH-331·NOTI-028·CAT-093의 관계가 유효한 업무 시드입니다. |
| `config/demo/reference-mocks.json` | 생성합니다. | Jira·GitHub와 내부 검토 사례의 가상 근거입니다. |
| `src/persistence/seed-demo.ts` | 생성합니다. | seedDemo(db)와 빈 업무 자료 검사·한 번의 확정입니다. |
| `scripts/db-migrate.ts` | 생성합니다. | offline maintenance 경계에서 schema/checksum을 검사·적용합니다. |
| `scripts/seed-demo.ts` | 생성합니다. | 명시 seed 명령과 거절 exit code입니다. |
| `tests/helpers/demo-manifest.ts` | 생성합니다. | readDemoManifest(db)의 읽기 전용 typed 가상 ID/상태 조회입니다. |
| `tests/integration/demo-seed.test.ts` | 생성합니다. | schema만 있는 빈 DB·중간 실패·기존 자료 거절·네 시드 관계를 검사합니다. |

**인터페이스와 입력 조건**

seedDemo(db: DatabaseConnection): void는 지원 schema의 빈 업무 DB에 네 SR과 관련 불변 자료·manifest를 한 트랜잭션으로 기록합니다. 이미 seed 완료 표식이나 업무 자료가 있으면 거절합니다. createTestDatabase는 STORAGE의 실제 DB helper입니다. readDemoManifest(db)는 {projectId,personaIds,srIds}와 명시 가상 자료의 ID만 반환하며 역할을 변경하거나 DB에 쓰지 않습니다. tests/helpers/domain-cases.ts의 demoCase는 이 manifest와 동일한 고정 자료를 읽습니다.

- [x] **Step 019: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '@/tests/helpers/test-database';
import { seedDemo } from '@/src/persistence/seed-demo';

test('이미 시드한 업무 자료를 다시 덮어쓰지 않는다', async () => {
  const fixture = await createTestDatabase({ testRunId: randomUUID() });
  try {
    seedDemo(fixture.db);
    const before = fixture.db.prepare('SELECT * FROM srs ORDER BY sr_id').all();
    expect(before).toHaveLength(4);
    expect(() => seedDemo(fixture.db)).toThrow();
    expect(fixture.db.prepare('SELECT * FROM srs ORDER BY sr_id').all()).toEqual(before);
  } finally { await fixture.close(); }
});
```

- [x] **Step 020: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/demo-seed.test.ts
```

예상 결과는 다음과 같습니다. seed 구현 전 실패하거나, 두 번째 실행이 기존 자료를 덮어쓰면 거절 assertion이 실패합니다.

- [x] **Step 021: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

PAY-102는 requirements와 미해결 질문, AUTH-331은 planning과 반영 확인 대기, NOTI-028은 유효한 G1/G2의 구현 준비 완료, CAT-093은 외부 H1 started 이력과 현재 requirements 재검토 상태로 구성합니다. CAT-093의 G1·종속 G2는 invalid·새 epoch·needsNewBundle이며 과거 통과와 인계를 보존합니다. 시드에는 각 상태를 뒷받침하는 문서·질문/결정·정책·배정·묶음·승인·인계 refs를 함께 넣고 FK·게이트 조건을 검사합니다. CLI 진입은 offline maintenance를 획득하고 기존 runtime/slot/running을 검사합니다. 업무 emptiness 확인부터 자료 전체·완료 manifest까지 같은 commit에 둡니다.

```ts
const insertDemo = db.transaction(() => {
  assertBusinessStoreEmpty(db);
  insertValidatedDemoGraph(db, manifest);
  recordSeedManifest(db, manifest.version);
});
insertDemo.exclusive();
```

assertBusinessStoreEmpty·insertValidatedDemoGraph·recordSeedManifest는 seed-demo.ts의 내부 함수이며 같은 connection만 사용합니다. 첫 함수는 업무 ENT와 seed 표식의 부재를 검사하고 두 번째는 검증한 가상 그래프만 입력받습니다. 중간 삽입 실패·seed 직전 다른 runtime 등록·반복 실행을 검사합니다. 제품의 일반 start/조회에서는 seed를 호출하지 않습니다.

- [x] **Step 022: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/demo-seed.test.ts tests/integration/storage-atomicity.test.ts
```

통과 조건은 다음과 같습니다. 빈 schema DB의 4개 SR과 유효 참조, 중간 실패 전체 rollback, 기존 자료·완료표식·active/unknown 실행의 유지보수 거절이 통과합니다.

- [x] **Step 023: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 024: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

db:migrate·seed:demo 명령이 실제 경로와 exit code로 연결됩니다. fixture가 제공하는 초기 승인 상태와 이후 실제 사용자 흐름의 통과를 구분합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-05 로컬 HTTP 연결·준비 상태와 실제 앱 테스트 harness

**구현 묶음**: B-01입니다. **선행**: CG-01, CG-02, CG-03, CG-04입니다.

**연결 기준**: M-001, M-002, ENT-01, ENT-02, ENT-03, ENT-04, SCN-12, SCN-24, NQ-02, NQ-04, NQ-10, NQ-19, NQ-22, NQ-23, ND-04, ND-13, INF-04, INF-05, INF-08, INF-09입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/persistence/workspace-repository.ts` | 생성합니다. | M-001/M-002의 프로젝트·현재 멤버십 읽기를 typed 저장 포트로 제공합니다. |
| `src/runtime/macos-observation.ts` | 생성합니다. | CG-14의 고정 host/boot 관찰을 먼저 제공하며 프로세스 시작 identity는 미지원으로 명시합니다. |
| `tests/unit/runtime-identity.test.ts` | 생성합니다. | 제한 관찰의 UUID 파싱·실패·미지원과 비노출을 검사합니다. |
| `vite.config.ts` | 갱신합니다. | 정확한 개발 Host/Origin 검사와 manifest의 공개 bootstrap ID 두 값만 연결합니다. |
| `src/main.ts` | 생성합니다. | composition root와 일반 시작입니다. |
| `src/application/http/server.ts` | 생성합니다. | Fastify 생성·Host/Origin·body 정책·정적 경계입니다. |
| `src/application/http/routes.ts` | 생성합니다. | 명시 공개 계약 route·schema·응답 변환입니다. |
| `src/application/workspace-service.ts` | 생성합니다. | M-001/M-002의 가상 사용자·작업 공간 조회입니다. |
| `src/application/app-lifecycle.ts` | 생성합니다. | C-02의 저장소·runtime 등록·maintenance 경합·ready 조정입니다. C-05 호출은 main의 조립 순서가 맡습니다. |
| `tests/helpers/test-app.ts` | 생성합니다. | 실제 SQLite·서비스·HTTP를 가진 TestApp과 정리 책임입니다. |
| `tests/contract/http-boundary.test.ts` | 생성합니다. | 내부 메서드·Origin·정적 파일·오류 비노출을 검사합니다. |
| `tests/integration/readiness.test.ts` | 생성합니다. | DB·provider 준비 분리와 동시 시작을 검사합니다. |
| `scripts/start-dev.ts` | 생성합니다. | Vite/backend 자식의 시작·신호 전달·종료 대기입니다. |
| `scripts/build.mjs` | 생성합니다. | dist/server·dist/web 빌드와 실패 exit code입니다. |

**인터페이스와 입력 조건**

createHttpServer(deps: ApplicationDependencies): FastifyInstance는 listen 전 주입 가능한 앱을 만듭니다. POST /api/methods/M-ID의 고정 allowlist만 업무 계약에 연결합니다. 입력은 {scope,meta,input}, 가상 actorId는 X-PlanRepo-Actor로 전달하고 현재 권한을 서버가 해석합니다. 같은 endpoint 형식을 쓰더라도 조회와 변경의 receipt/guard 책임은 메서드별로 다릅니다. health 두 경로는 별도 GET입니다. createTestApp/TestApp 전체 계약은 공통 인터페이스 절에 정의합니다.

- [x] **Step 025: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';

test('정상 DB는 Claude가 없어도 준비되고 내부 계약은 HTTP에 없다', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const ready = await app.server.inject({ method: 'GET', url: '/health/ready', headers: { host: new URL(app.baseURL).host } });
    expect(ready.statusCode).toBe(200);
    const internal = await app.server.inject({ method: 'POST', url: '/api/methods/M-036', headers: { host: new URL(app.baseURL).host, origin: app.baseURL }, payload: {} });
    expect(internal.statusCode).toBe(404);
  } finally { await app.close(); }
});
```

- [x] **Step 026: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts
```

예상 결과는 다음과 같습니다. API/health 연결 전 기대한 status assertion이 실패합니다. test mode의 provider는 기본 unavailable이며 실제 CLI를 자동 실행하지 않습니다.

- [x] **Step 027: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

정확한 Host/Origin 검사를 body parsing·proxy 처리 전에 적용합니다. 변경 본문은 identity JSON과 8 MiB 수신 상한을 요구하며 명령별 문서 상한을 따로 검사합니다. 정적 파일은 INF-05 allowlist와 realpath 경계를 따릅니다. ready는 storageReady만으로 결정하고 generationReady를 별도 값으로 반환합니다.

```ts
server.get('/health/ready', async (_request, reply) => {
  const status = lifecycle.readiness();
  return reply.code(status.storageReady ? 200 : 503).send({
    ready: status.storageReady,
    generationReady: status.generationReady,
    code: status.publicCode,
  });
});
```

lifecycle.readiness(): {storageReady:boolean;generationReady:boolean;publicCode:string}는 내부 식별값을 반환하지 않습니다. lifecycle은 schema/maintenance 확인과 runtime 등록 commit 뒤 준비를 알립니다. test helper의 invoke는 실제 route를 inject하며 내부 메서드를 호출하는 우회 API를 만들지 않습니다. 각 업무 task가 등록표에 실제 handler를 연결하고 최종 검증은 44개가 모두 연결됐는지 확인합니다.

- [x] **Step 028: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/contract/http-boundary.test.ts tests/integration/readiness.test.ts
```

통과 조건은 다음과 같습니다. 잘못된 Host/Origin·내부6개·정적 탈출·본문 초과를 거절하고 DB 미준비503/provider 부재200이 구분됩니다. maintenance와 시작의 원자적 등록 경쟁이 통과합니다.

- [x] **Step 029: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 030: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

HTTP·준비 상태·정적 경계의 테스트가 통과합니다. UI_BASE 연결 뒤 npm run build·npm start·npm run dev의 전체 웹 실행을 검증합니다. 각 업무 task는 실제 handler를 연결하며 가짜 성공 handler는 두지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-06 SR 직접 등록·Mock 중복 가져오기·최초 설명과 기본 조회

**구현 묶음**: B-01입니다. **선행**: CG-03, CG-05입니다.

**연결 기준**: M-001, M-002, M-003, M-004, M-005, M-028, M-045, M-047, US-001, US-002, US-003, US-027, ENT-01, ENT-02, ENT-03, ENT-04, ENT-21, ENT-34, ENT-35, SCN-01, SCN-14, SCN-23, SCN-24, NQ-01, NQ-04, NQ-05, NQ-06, NQ-07, NQ-08, NQ-10, NQ-23, ND-01, ND-02, ND-03, ND-04, ND-05, ND-13, INF-01, INF-02, INF-04, INF-05, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | SR 제목·최초/현재 설명·Mock 출처의 실제 조회 DTO를 완성합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 메서드 계약을 검사합니다. |
| `src/domain/review-impact.ts` | 생성합니다. | 설명 변경의 G1·종속 G2 영향과 가장 앞선 검토 단계 복귀를 판정합니다. |
| `src/persistence/review-impact-repository.ts` | 생성합니다. | 게이트·epoch·인계 현재성과 이전 요청의 현재 기준 이탈을 명령과 같은 트랜잭션에서 저장합니다. |
| `src/runtime/application-composition.ts` | 생성합니다. | main과 TestApp이 같은 공개 메서드 adapter와 서비스 조립을 사용하게 합니다. |
| `src/application/workspace-service.ts` | 변경 없이 재사용합니다. | 기존 M-001/M-002 계약을 공통 application composition에서 연결합니다. |
| `src/application/sr-context-service.ts` | 생성합니다. | M-003/M-004/M-005의 등록·원 설명·현재 설명을 처리합니다. |
| `src/persistence/generation-run-query.ts` | 생성합니다. | 실제 생성 작업·초안·적용·종료 관찰을 조회하며 미확정 입력 최신성은 명시적으로 구분합니다. |
| `src/application/workspace-query-service.ts` | 생성합니다. | M-045/M-047의 기본 보드·SR 조회를 일관된 읽기로 준비합니다. |
| `src/domain/authorization.ts` | 생성합니다. | ProjectScope/SrScope와 현재 역할·담당자를 검사합니다. |
| `src/persistence/sr-repository.ts` | 생성합니다. | SR·설명 버전·G1/G2 초기 상태와 활동·receipt를 저장합니다. |
| `src/providers/reference/mock-ticket-provider.ts` | 생성합니다. | 프로젝트 config/demo에서만 티켓을 조회합니다. |
| `tests/helpers/domain-cases.ts` | 생성합니다. | DEMO-4 typed ID와 현재 조회 기반 입력 builder를 제공합니다. |
| `tests/integration/sr-context.test.ts` | 생성합니다. | 등록·재생·Mock 중복·설명 보존·scope 거절·원자성을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 생성합니다. | S-01/S-02와 기본 S-09 공개 계약·오류·receipt 의미를 추가합니다. |

**인터페이스와 입력 조건**

공통 invoke는 {actorId,projectId,srId?,requestId?,idempotencyKey?,guard?}를 받고 서버가 ActorContext/TargetScope를 검증합니다. 성공의 disposition·receipt·current와 거절의 priorReceipt를 보존합니다. demoCase는 승인 DEMO-4 manifest의 ID/입력만 반환하고 currentCase/currentReviewInput은 현재 자료를 읽는 typed helper입니다. 이 helper는 업무 자료를 쓰거나 승인·전환 성공을 대신하지 않습니다. helper의 필드와 wire DTO는 CONTRACT에서 ENT/M 원문에 맞춰 고정합니다. 아래 코드는 구현 시 실행할 대표 RED이며 지금 실행한 결과가 아닙니다. NewSR은 key/title/purpose/description/ownerId이며 projectId는 scope에서 검증합니다. 처음 progressStage는 sr_received이고 M-028의 담당자 명시 요청만 requirements로 전환합니다. 보드 전체 스토리 US-027 완료는 B-06에 남깁니다.

- [x] **Step 031: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput } from '@/tests/helpers/domain-cases';

it('같은 등록 재전송은 하나의 SR과 receipt만 남깁니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const scope = { actorId: c.ownerId, projectId: c.projectId,
      requestId: 'register-1', idempotencyKey: 'register-1' };
    const input = { key: 'TEST-REGISTER-1', title: '중복 접수 검증',
      purpose: '하나의 SR만 등록합니다.', description: '최초 설명입니다.', ownerId: c.ownerId };
    const first = await app.invoke('M-003', scope, input);
    const replay = await app.invoke('M-003', { ...scope, requestId: 'register-2' }, input);
    expect(first).toMatchObject({ ok: true, disposition: 'Committed' });
    expect(replay).toMatchObject({ ok: true, disposition: 'Replayed' });
    if (first.ok && replay.ok) expect(replay.value).toEqual(first.value);
    expect(app.db.prepare('SELECT count(*) AS n FROM srs WHERE project_id = ? AND sr_key = ?')
      .get(c.projectId, input.key)).toEqual({ n: 1 });
    expect(app.db.prepare('SELECT count(*) AS n FROM command_receipts WHERE project_id = ? AND actor_id = ? AND idempotency_key = ?')
      .get(c.projectId, c.ownerId, scope.idempotencyKey)).toEqual({ n: 1 });
    const conflict = await app.invoke('M-003', scope, { ...input, title: '다른 입력입니다.' });
    expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  } finally {
    await app.close();
  }
});
```

- [x] **Step 032: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/sr-context.test.ts
```

예상 결과는 다음과 같습니다. 현재 권한 검증을 통과한 같은 입력의 두 번째 등록이 새 SR을 만들거나 중복 키 오류만 반환해 Replayed 단언이 실패합니다.

- [x] **Step 033: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

현재 membership·ProjectScope를 확인한 뒤 receipt를 검사합니다. 동일 지문은 고정 resultRefs와 현재성을 Replayed로 반환합니다. 새 요청은 프로젝트 key/jiraKey 고유성, 담당자, 필수 입력을 검증하고 SRDescriptionVersion v1, SR의 original/currentDescriptionRef, G1/G2 not_passed, 활동·receipt를 한 tx에서 생성합니다. M-004의 기존 jiraKey는 기존 SR을 안내하고 내용을 덮어쓰지 않습니다. M-005는 expectedRevision과 새 설명 버전·ReviewImpact만 확정하며 originalDescriptionRef는 고정합니다. M-045/M-047은 읽기 중 활동이나 검토 시작을 쓰지 않습니다.

- [x] **Step 034: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/sr-context.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 직접 등록, 같은 키 다른 명령/입력, Mock 중복, 최초 설명 보존, 담당자/다른 SR 범위 거절, 응답 유실 후 재생, receipt 저장 실패 주입 시 SR/활동 전체 rollback이 통과합니다.

- [x] **Step 035: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 036: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-001/US-002/US-003의 기반 메서드와 네 SR 데모 조회를 실제 DB에 연결합니다. M-028의 sr_received→requirements만 이 task에서 구현하고 G1/G2 전환은 G1/G2로 확장합니다. 원문과 현재 설명·Mock 표시·actor 선택을 HTTP 직접 호출에서도 검증합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-07 근거 자료의 미확인 등록과 버전에 고정한 사람의 확인

**구현 묶음**: B-01입니다. **선행**: CG-06입니다.

**연결 기준**: M-006, M-007, M-047, US-003, ENT-05, ENT-06, ENT-21, ENT-22, ENT-34, ENT-35, SCN-01, SCN-09, SCN-14, SCN-20, NQ-05, NQ-06, NQ-07, NQ-09, NQ-10, NQ-18, NQ-22, ND-01, ND-02, ND-03, ND-07, ND-14, INF-02, INF-04, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/sr-context-service.ts` | 갱신합니다. | M-006/M-007의 자료 등록·확인 버전과 ReviewImpact를 연결합니다. |
| `src/persistence/context-source-repository.ts` | 생성합니다. | ContextSource와 불변 ContextSourceVersion을 저장합니다. |
| `src/domain/review-impact.ts` | 갱신합니다. | 근거의 내용·확인 변경과 영향 없는 표시명 변경을 구분합니다. |
| `tests/integration/context-source.test.ts` | 생성합니다. | 미확인 링크·사람 확인·이전 버전·다른 SR 참조를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 자료 확인의 필수 근거·버전·권한 계약을 추가합니다. |

**인터페이스와 입력 조건**

공통 invoke는 {actorId,projectId,srId?,requestId?,idempotencyKey?,guard?}를 받고 서버가 ActorContext/TargetScope를 검증합니다. 성공의 disposition·receipt·current와 거절의 priorReceipt를 보존합니다. demoCase는 승인 DEMO-4 manifest의 ID/입력만 반환하고 currentCase/currentReviewInput은 현재 자료를 읽는 typed helper입니다. 이 helper는 업무 자료를 쓰거나 승인·전환 성공을 대신하지 않습니다. helper의 필드와 wire DTO는 CONTRACT에서 ENT/M 원문에 맞춰 고정합니다. 아래 코드는 구현 시 실행할 대표 RED이며 지금 실행한 결과가 아닙니다. SourceInput은 text/markdown/link별 필수 내용·출처를 받고 link이면 targetUrl과 확인 가능 여부를 기록합니다. SourceConfirmation은 정확한 기존 source version과 사람이 남긴 confirmationEvidence를 연결합니다. confirmedBy/confirmedAt은 서버가 결정합니다.

- [x] **Step 037: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput } from '@/tests/helpers/domain-cases';

it('링크 등록은 미확인이며 확인해도 이전 버전은 바뀌지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId,
      requestId: 'source-1', idempotencyKey: 'source-1' };
    const detail = await app.invoke('M-047', scope, {});
    if (!detail.ok) throw new Error('현재 SR 조회에 실패했습니다.');
    const result = await app.invoke('M-006', { ...scope, guard: { resource: {
      target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId },
      expectedRevision: detail.value.sr.revision,
    } } }, {
      kind: 'link', targetUrl: 'https://example.invalid/reference',
      provenance: '사용자가 추가한 가상 근거입니다.', verifiable: false
    });
    expect(result.ok).toBe(true);
    const fresh = await currentCase(app, c);
    const source = fresh.sources.find(item => item.targetUrl === 'https://example.invalid/reference');
    expect(source?.confirmation).toBe('unconfirmed');
    expect(source?.confirmedBy).toBeUndefined();
    if (!source) throw new Error('등록한 근거가 없습니다.');
    const originalRef = source.currentVersionRef;
    const confirmed = await app.invoke('M-007', { ...scope, requestId: 'source-2',
      idempotencyKey: 'source-2', guard: { resource: {
        target: { kind: 'context_source', projectId: c.projectId, srId: c.srId,
          entityId: source.sourceId }, expectedRevision: source.revision,
      } } }, {
      sourceVersionRef: originalRef,
      confirmationEvidence: '사용자가 별도로 제공한 가상 확인 요약입니다.'
    });
    expect(confirmed.ok).toBe(true);
    const rows = app.db.prepare('SELECT version, confirmation FROM context_source_versions WHERE project_id = ? AND sr_id = ? AND source_id = ? ORDER BY version')
      .all(c.projectId, c.srId, source.sourceId);
    expect(rows).toEqual([{ version: 1, confirmation: 'unconfirmed' }, { version: 2, confirmation: 'confirmed' }]);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 038: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/context-source.test.ts
```

예상 결과는 다음과 같습니다. 링크를 자동 confirmed로 저장하거나 M-007이 이전 레코드만 덮어써 불변 버전 두 개의 단언이 실패합니다.

- [x] **Step 039: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-006은 서버에서 unconfirmed로 시작하며 링크 존재·모델 주장만으로 확인 필드를 채우지 않습니다. M-007은 현재 담당자·동일 SR·기대 revision·대상 source version·확인 근거를 검사합니다. 새 ContextSourceVersion과 currentVersionRef, 관련 ReviewImpact·활동·receipt를 함께 확정합니다. 단순 displayName 변경은 source 내용과 확인 결과가 같으면 epoch를 바꾸지 않습니다. 확인 불가능한 외부 링크의 내용을 자동 수집하지 않습니다.

- [x] **Step 040: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/context-source.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 등록/확인의 두 버전, 과거 bundle의 옛 근거 상태, 오래된 확인과 다른 SR 버전 거절, 영향받는 게이트 무효화 및 원자성 검증이 통과합니다.

- [x] **Step 041: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 042: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-003 C1~C3와 기본 source scope·기록 경계를 통과합니다. 추후 생성 fingerprint와 검토 묶음은 같은 ContextSourceVersion refs를 사용합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-08 공통 화면·요청 상태와 격리된 브라우저 fixture를 연결합니다.

**구현 묶음**: B-01입니다. **선행**: CG-01, CG-02, CG-03, CG-04, CG-05, CG-06, CG-07입니다.

**연결 기준**: M-001, M-002, M-003, M-004, M-005, M-006, M-007, ENT-01, ENT-02, ENT-03, ENT-04, ENT-05, ENT-06, ENT-35, SCN-01, SCN-14, SCN-24, NQ-04, NQ-07, NQ-08, NQ-10, NQ-11, NQ-12, NQ-22, NQ-23, ND-02, ND-04, ND-06, ND-13, INF-01, INF-02, INF-05, INF-08, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/web/App.tsx` | 생성합니다. | UI-01 AppShell과 승인된 메뉴·가상 사용자 선택을 연결합니다. |
| `src/web/components/SRRegistrationForm.tsx` | 생성합니다. | UI-05의 직접 등록·Mock 키 가져오기 폼을 연결합니다. |
| `src/web/components/SRContextPanel.tsx` | 생성합니다. | UI-08의 설명·근거·확인 상태 편집을 연결합니다. |
| `src/web/components/CommandFeedback.tsx` | 생성합니다. | UI-26의 저장 상태·오류·차단 사유를 표시합니다. |
| `src/web/state/query-coordinator.ts` | 생성합니다. | actor·프로젝트·SR·대상·매 발행 순번으로 조회 응답을 검사합니다. |
| `src/web/state/command-session.ts` | 생성합니다. | 제출 입력·guard·idempotencyKey와 dirty 폼을 분리합니다. |
| `src/web/state/form-draft.ts` | 생성합니다. | scope별 편집 입력·기준·dirty와 필드 오류를 서버 조회와 분리합니다. |
| `src/web/styles/base.css` | 생성합니다. | 읽기·검토 중심 레이아웃과 초점·텍스트 상태 표현을 만듭니다. |
| `tests/e2e/fixtures/test-app.ts` | 생성합니다. | 실제 HTTP·SQLite를 쓰는 Playwright fixture를 연결합니다. |
| `tests/e2e/fixtures/personas.ts` | 생성합니다. | SEED의 읽기 전용 manifest helper를 사용해 가상 사용자별 독립 브라우저 context를 정의합니다. |
| `tests/e2e/ui/base.spec.ts` | 생성합니다. | 공통 화면·등록·선택 사용자 격리를 검사합니다. |
| `tests/unit/web/query-coordinator.test.ts` | 생성합니다. | 같은 키의 Q2 선착·Q1 지연과 다른 대상 응답을 거절하는지 검사합니다. |
| `tests/unit/web/command-session.test.ts` | 생성합니다. | 실패 입력 보존·같은 요청 재전송·다른 제출의 새 키를 검사합니다. |
| `tests/unit/web/form-draft.test.ts` | 생성합니다. | 조회 갱신에도 dirty 입력과 편집 기준을 보존하는지 검사합니다. |
| `src/web/main.tsx` | 생성합니다. | React mount와 AppShell의 진입점입니다. |
| `src/web/index.html` | 생성합니다. | PlanRepo 제목과 React root를 가진 Vite HTML 진입점입니다. |
| `src/web/api/client.ts` | 생성합니다. | 공개 계약·actor·scope·guard·receipt·고정 다운로드 bytes를 처리합니다. |
| `src/web/components/TeamBoard.tsx` | 생성합니다. | B-01의 기본 보드·등록·상세 이동과 실제 조회를 연결합니다. 최종 필터/통합은 UI_BOARD가 확장합니다. |
| `src/web/components/SRList.tsx` | 생성합니다. | B-01의 기본 보드·등록·상세 이동과 실제 조회를 연결합니다. 최종 필터/통합은 UI_BOARD가 확장합니다. |
| `src/web/components/SRDetailShell.tsx` | 생성합니다. | B-01의 기본 보드·등록·상세 이동과 실제 조회를 연결합니다. 최종 필터/통합은 UI_BOARD가 확장합니다. |
| `playwright.config.ts` | 생성합니다. | 실제 테스트 앱과 고정 예약 포트·test/e2e를 연결합니다. |

**인터페이스와 입력 조건**

최종 컴포넌트 확인 책임은 UI-01·UI-05·UI-08·UI-26입니다. US-001~US-003의 UI를 B-01에서 함께 검증하지만 스토리 최종 책임은 승인된 B-01 업무 과제에 유지합니다. 이후 묶음도 자신의 최소 UI를 연결하며 B-06만 기다리지 않습니다.

createTestApp({fixture:'empty'|'DEMO-4',testRunId})는 실제 구성의 격리 앱을 반환합니다. app.invoke(methodId,{actorId,projectId,srId?,requestId?,idempotencyKey?,guard?},input)는 Query·Committed·Replayed를 정상화한 {ok:true,value,disposition,receipt?,current?} 또는 {ok:false,error,priorReceipt?}입니다. 실제 서비스의 CommandResult kind는 바꾸지 않습니다.

테스트 harness의 app.baseURL은 사전에 확보한 명시 loopback 포트의 URL입니다. 포트 충돌은 준비 실패이고 자동 다음 포트로 바꾸지 않습니다. app.db는 격리 DB 검사·가상 시작 자료 준비용이며 브라우저 업무 변경을 대신하지 않습니다.

Playwright testInfo.workerIndex·retry·testId의 SHA-256 일부로 안전한 testRunId를 만듭니다. 테스트마다 .planrepo/test-runs/<testRunId>/의 DB·실행·진단 경로를 사용합니다. 일반 실행 DB와 같으면 시작을 거절합니다. Playwright page의 baseURL은 app.baseURL이며 서버는 테스트가 직접 생성합니다.

readDemoManifest(app.db)는 {projectId,personaIds:{'P-01':id,...,'P-05':id},srIds:{'PAY-102':id,'AUTH-331':id,'NOTI-028':id,'CAT-093':id}}를 반환하는 읽기 전용 테스트 helper입니다. 이는 제품 DTO나 공개 메서드가 아닙니다. openPersonaContext(browser,app,personaId)는 browser.newContext({baseURL:app.baseURL}) 뒤 UI의 가상 사용자 선택으로 설정합니다. 실제 조직 인증·쿠키 공유를 가정하지 않습니다.

하나의 테스트 안에서 5 context는 같은 app·DB를 사용하되 브라우저 저장소·현재 actor는 독립입니다. context는 finally에서 닫고 app.close()는 테스트 종료 시 반드시 호출합니다. 종료 미확인 실행의 자료·슬롯을 지우거나 다음 앱에 넘기지 않습니다.

src/web는 C-02의 공개 HTTP 계약만 호출합니다. 내부 6개 메서드나 DB·provider·ClaimRef를 브라우저에서 사용하지 않습니다. 인터랙션에 안정적인 {component}-{element-role} data-testid와 접근 가능한 이름을 함께 둡니다.

RED 실행 전 BOOT·CONTRACT·HTTP와 fixture import·서버 준비가 통과해야 합니다. 모듈 없음·서버 기동 실패·시드 실패는 행동 RED가 아닌 선행 준비 실패로 기록합니다.

config/demo/manifest.json·scenarios.json·reference-mocks.json, seed-demo.ts, db-migrate.ts와 readDemoManifest의 생성 책임은 SEED에 있습니다. 여기서는 이 파일을 중복 작성하지 않고 기존 helper를 import합니다.

- [x] **Step 043: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { test, expect } from '@/tests/e2e/fixtures/test-app';

test('가상 사용자와 등록 진입을 같은 작업 공간에 표시한다', async ({ page, app, manifest }) => {
  const workspace = await app.invoke('M-001', {
    actorId: manifest.personaIds['P-01'], projectId: manifest.projectId,
  }, {});
  expect(workspace.ok).toBe(true);
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await expect(page.getByRole('navigation')).toContainText('내 검토함');
  await page.getByRole('button', { name: 'SR 등록', exact: true }).click();
  await expect(page.getByTestId('sr-registration-form-title-input')).toBeVisible();
});
```

- [x] **Step 044: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1
```

예상 결과는 다음과 같습니다. workspace 조회·fixture 준비는 성공하고, 아직 없는 공통 화면의 메뉴 또는 등록 입력 기대에서 실패합니다. 실패 위치와 출력을 남깁니다.

- [x] **Step 045: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

AppShell은 M-001 조회와 M-002 선택을 사용합니다. 선택 actor를 각 브라우저 context 안에 저장하고 actor 전환 때 해당 actor의 조회 키만 활성화합니다. 보드·내 검토함·SR 목록·팀 설정의 승인된 메뉴를 연결합니다.

QueryCoordinator는 key별 seq를 매 조회·재조회 발행마다 증가시킵니다. accept(key,seq,value)는 현재 활성 키와 latestSeq가 모두 같은 경우에만 서버 view를 바꿉니다. 같은 화면에서 Q2가 먼저 오면 늦은 Q1을 버립니다. FormDraft는 view와 다른 저장소에 두고 dirty 내용을 자동 덮어쓰지 않습니다.

CommandSession은 시작 시 actor·scope·command·input·guard·idempotencyKey를 고정합니다. 처리 중 같은 제출과 결과 확인 재전송은 같은 키를 사용합니다. 입력을 바꿔 명시 제출하면 새 key를 발급합니다. Replayed의 과거 receipt와 current를 따로 표시하며 현재 승인·게이트 성공으로 바꾸지 않습니다.

네트워크 결과가 불명확하면 결과 확인 필요를 표시합니다. Rejected는 필드 입력·편집 기준을 보존하고 서버 error/current로 복구 경로를 제공합니다. SR·actor 이동 때 이전 입력을 새 scope로 보내지 않습니다.

fixture는 test.extend의 app fixture에서 testRunId를 만들고 createTestApp({fixture:'DEMO-4',testRunId})를 호출합니다. baseURL fixture가 app.baseURL을 반환하도록 연결합니다. teardown은 page/context 종료 후 await app.close() 순서로 실행합니다.

- [x] **Step 046: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/base.spec.ts --project=chromium --workers=1
```

통과 조건은 다음과 같습니다. 실제 격리 앱에서 메뉴·가상 사용자 선택·등록 진입이 통과합니다. 추가 단위 검사에서 Q2/Q1 순서·폼·요청 키 경계가 통과한 출력을 함께 기록합니다.

- [x] **Step 047: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 048: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

UI-01·UI-05·UI-08·UI-26과 B-01의 실제 저장·조회 UI를 연결합니다.

B-01의 US-001~US-003 완료 증거에 공통 UI 결과를 연결합니다.

명시 포트·격리 DB·독립 actor fixture와 npm run typecheck 결과를 기록합니다.

과제 완료 전 tests/unit/web/query-coordinator.test.ts와 command-session.test.ts의 RED·GREEN을 별도 실행해 기록합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-09 질문·답변·결정 기본 경로와 문서 버전·초안 적용

**구현 묶음**: B-02입니다. **선행**: CG-05, CG-06, CG-07, CG-08입니다.

**연결 기준**: M-008, M-010, M-012, M-015, M-016, M-018, M-019, US-004, US-007, US-009, US-011, US-012, ENT-07, ENT-08, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-26, ENT-27, ENT-30, ENT-31, SCN-02, SCN-03, SCN-15, SCN-16, NQ-06, NQ-07, NQ-08, NQ-11, NQ-17, NQ-18, ND-01, ND-02, ND-03, ND-06, ND-07, ND-12, INF-04, INF-06입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/persistence/question-decision-repository.ts` | 생성합니다. | M-008/M-010/M-012와 초안 적용의 질문·답변·미확정/확정 결정·현재 결과를 같은 트랜잭션에서 저장합니다. |
| `src/application/question-decision-service.ts` | 생성합니다. | 답변·후속 질문·미확정 결정과 사람 확정 기본 처리입니다. |
| `config/generation/project-rules.json` | 생성합니다. | 승인 제품 규칙의 자체 완결 요약과 명시적 규칙 ID를 둡니다. |
| `src/runtime/project-rule-source.ts` | 생성합니다. | 프로젝트 루트 자산을 검증하고 내용 기반의 안정 버전으로 제공합니다. |
| `src/persistence/migrations/0002-input-snapshot-supplement.ts` | 생성합니다. | 기존 snapshot을 보존하며 supplement 열을 추가하고 알려진 이전 설계 단계 표기를 정규화합니다. |
| `src/persistence/migrations/index.ts` | 생성합니다. | SQL checksum을 유지하는 순차 migration registry입니다. |
| `src/persistence/maintenance.ts` | 갱신합니다. | 최신 registry의 offline migration과 supported schema 검사를 사용합니다. |
| `tests/integration/snapshot-supplement-migration.test.ts` | 생성합니다. | 기존 version 1 자료를 보존한 upgrade와 불변 snapshot round trip을 검사합니다. |
| `tests/unit/generation-snapshot.test.ts` | 생성합니다. | canonical 순서·원문·규칙·입력 기준·제외 메타데이터를 검사합니다. |
| `src/application/generation-snapshot.ts` | 생성합니다. | 초안 적용·사람 검토·생성 준비가 공유하는 현재 입력 canonical envelope와 fingerprint입니다. |
| `src/persistence/generation-input-repository.ts` | 생성합니다. | 같은 SR의 현재 입력·규칙·run/draft 기준을 쓰기 없는 일관된 읽기로 제공합니다. |
| `src/contracts/methods.ts` | 갱신합니다. | 기존 M-047의 선택적 생성 준비 조회 입력을 연결합니다. |
| `src/contracts/schemas.ts` | 갱신합니다. | 빈 상세 입력 호환과 준비 대상별 판별 입력을 검증합니다. |
| `tests/unit/artifact-rules.test.ts` | 생성합니다. | 문서 원문·구조 참조·absent/version 기준을 검증합니다. |
| `tests/unit/documents.test.ts` | 생성합니다. | 비교 원문의 보존과 안전한 표시 경계를 검사합니다. |
| `src/application/artifact-service.ts` | 생성합니다. | M-015/M-016/M-017/M-018/M-019와 현재성 검사입니다. |
| `src/persistence/artifact-repository.ts` | 생성합니다. | ArtifactVersion·현재 참조·적용 이력의 원자적 저장입니다. |
| `src/domain/artifact-rules.ts` | 생성합니다. | 종류·고유 ID·absent/existing guard·범위·변경 영향 검사입니다. |
| `src/domain/artifact-target.ts` | 생성합니다. | 문서 종류와 설계 단계의 정확한 logical key를 생성·판별하는 공통 순수 함수입니다. |
| `src/persistence/seed-demo.ts` | 갱신합니다. | 새 시드의 design_stage를 기존 계약의 functional로 맞춥니다. |
| `src/presentation/documents.ts` | 생성합니다. | 안전한 표시와 원문을 보존하는 비교입니다. |
| `src/web/components/ArtifactWorkspace.tsx` | 생성합니다. | UI-12의 편집·원문·저장 입력입니다. |
| `src/web/components/VersionComparison.tsx` | 생성합니다. | UI-14의 고정 버전 원문 비교입니다. |
| `src/web/components/QuestionPanel.tsx` | 생성합니다. | UI-09 답변·후속 질문 기본 행동입니다. |
| `src/web/components/DecisionPanel.tsx` | 생성합니다. | UI-10 확정 권한과 선택·근거입니다. |
| `src/web/components/DraftReview.tsx` | 생성합니다. | UI-20 현재/오래된 초안의 사람 검토·적용입니다. |
| `tests/integration/artifact-edit.test.ts` | 생성합니다. | absent 경합·새 버전·원문·현재성·적용 중복을 검사합니다. |
| `tests/helpers/editor-fixture.ts` | 생성합니다. | createEditorFixture(app)로 같은 SR의 유효한 편집/초안 fixture와 typed 요청을 제공합니다. |

**인터페이스와 입력 조건**


CG-09 연결 시 결정 24의 문서 logical key를 공통으로 사용합니다. requirements/workflow_plan/implementation_plan과 design:application/design:functional/design:nfr/design:infrastructure를 구분합니다. 다른 단계의 design이 있다는 이유로 새 design target을 거절하지 않습니다. ARTIFACT_REVISION은 정확한 참조에서 현재 종류·단계를 읽습니다. 기존 seed의 design_stage=functional_design은 계약의 functional로 수정하고 0002 migration의 알려진 이전 표기 정규화도 실제 upgrade 테스트에 포함합니다. M-017 공개 예시의 guard와 input targetBasis도 workflow_plan으로 맞춥니다.


생성 입력의 participants에는 현재 SR ownerId와 같은 프로젝트 현재 멤버의 userId·displayName을 고정합니다. 역할·인증 capability는 포함하지 않으며 canonical 지문과 InputSnapshot에 같은 값을 사용합니다. 질문 제안의 suggestedAssigneeId는 이 명시 후보에서 선택하고 실제 적용은 현재 멤버십을 다시 검사합니다. 결정 25와 새 SR의 실제 준비 조회 회귀를 함께 따릅니다.


M-019는 사람이 본 원 초안의 preparation.currentInputFingerprint를 잠금 안에서 검사합니다. 새 검토 초안은 현재 본문·참조·규칙과 현재 문서 target을 별도 InputSnapshot으로 고정합니다. 원 ARTIFACT_DRAFT의 absent 대상에 문서가 생겼으면 명시적인 사람 비교 이후 만든 새 검토 초안만 ARTIFACT_REVISION으로 기록하며 원 실행·원 초안·원 snapshot은 바꾸지 않습니다. 새 fingerprint는 정규화한 현재 입력으로 계산하므로 원 초안 preparation의 검사용 지문과 다를 수 있습니다. 반면 M-035 retry는 absent 작업을 revision으로 자동 전환하지 않고 새 M-032를 요구합니다. 기존 ARTIFACT_REVISION retry는 현재 exact version을 대상으로 새 입력·지문을 준비합니다.

초안 적용은 결정 26을 따릅니다. decisions는 selections의 각 temporaryId·decisionMakerId·classification을 사람이 지정합니다. artifact는 selectedContent.edit의 완전한 편집 입력을 받고 edit.targetBasis만 사용합니다. WorkflowPlan 구조는 명시적으로 검증하며 Markdown으로 추정하지 않습니다. M-017의 1:1 저장은 이 과제에서 연결하고 CG-20의 필수 정책·G2 전체 검증은 유지합니다.

초안 화면의 영속 조회는 결정30을 따릅니다. M047 상세의 작은 generationDrafts 목록에서 원 provider 초안과 human_review 초안을 고르고, 기존 kind=draft 준비 조회의 선택 DraftView/InputSnapshot으로 고정 입력을 읽습니다. 페이지 재개방 뒤 조회·적용과 조회 무변경을 실제 HTTP/E2E로 검증합니다. 새 endpoint와 브라우저 DB 접근을 추가하지 않습니다.

saveArtifact(ctx, ArtifactEdit)와 applyDraft(ctx, DraftApplication)는 승인 M-015/M-018 계약을 구현합니다. createEditorFixture(app): Promise<{scope: InvokeScope; edit: ArtifactEdit; competingEdit: ArtifactEdit}>는 같은 absent 대상·동일 guard·서로 다른 idempotencyKey의 두 제출을 만듭니다. 입력의 key는 InvokeScope에서 나누고 ArtifactEdit은 본문·참조만 유지합니다. 가상 성공 Run fixture는 적용 테스트의 시작 조건이며 실제 생성 통과로 세지 않습니다.

- [x] **Step 049: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { createEditorFixture } from '@/tests/helpers/editor-fixture';

test('같은 absent 문서를 동시에 만들면 하나만 확정한다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const fixture = await createEditorFixture(app);
    const results = await Promise.all([
      app.invoke('M-015', { ...fixture.scope, idempotencyKey: 'edit-a' }, fixture.edit),
      app.invoke('M-015', { ...fixture.scope, idempotencyKey: 'edit-b' }, fixture.competingEdit),
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.error.code === 'STALE_VERSION')).toHaveLength(1);
  } finally { await app.close(); }
});
```

- [x] **Step 050: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/artifact-edit.test.ts
```

예상 결과는 다음과 같습니다. 실제 absent 경쟁에서 중복 Artifact가 생기거나 비교 없이 두 요청을 수락하면 실패합니다.

- [x] **Step 051: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

입력 본문을 bytes로 검사하고 구조 색인과 원문 ID를 대조합니다. BEGIN IMMEDIATE 안에서 현재 권한·guard·receipt·input fingerprint를 재확인한 뒤 새 버전·현재 포인터·ReviewImpact·요청 승계·활동·receipt를 같이 저장합니다. 순수 비교·Markdown 변환은 트랜잭션 밖에서 수행하고 적용 직전 basis를 다시 확인합니다.

```ts
export function matchesArtifactBasis(
  current: number | undefined,
  expected: { kind: 'absent' } | { kind: 'version'; version: number },
): boolean {
  return expected.kind === 'absent' ? current === undefined : current === expected.version;
}
```

matchesArtifactBasis는 artifact-rules.ts가 제공하는 순수 함수입니다. 서비스는 승인 WriteGuard를 absent/version 인자로 정규화하고, 잠금 안의 현재 버전과 대조해 false이면 STALE_VERSION을 반환합니다. AI 제안은 미확정 질문·결정 또는 새 문서로만 사람 적용합니다. 오래된 원 실행은 보존하며 M-019로 만든 새 비교 초안도 별도 fingerprint를 검사합니다. 답변 저장은 answered이고 resolved가 아니며 지정 결정권자의 확인만 DecisionVersion을 만듭니다.

- [x] **Step 052: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/artifact-edit.test.ts
```

통과 조건은 다음과 같습니다. 동시 생성 한 건만 확정, 기존 문서 개정·원문 비교·1 MiB 상한·오래된 입력 거절·같은 초안 적용 재생·새 결정 미확정·답변됨/해결됨 구분이 통과합니다.

- [x] **Step 053: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 054: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

B-02 실제 생성에 필요한 질문/답변·문서·사람 적용 화면과 서비스가 연결됩니다. 전체 AI·편집 스토리는 B-06 상호작용 검증 전 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-10 현재 입력·provider 선택의 고정과 생성 접수·조회·취소·재시도

**구현 묶음**: B-02입니다. **선행**: CG-01, CG-02, CG-03, CG-05, CG-09입니다.

**연결 기준**: M-032, M-033, M-034, M-035, US-009, US-010, US-013, ENT-26, ENT-27, ENT-34, ENT-35, SCN-14, SCN-15, SCN-17, SCN-19, NQ-07, NQ-08, NQ-10, NQ-14, NQ-17, NQ-18, NQ-20, NQ-22, ND-02, ND-04, ND-07, ND-08, ND-14, INF-03, INF-04, INF-05, INF-06입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/results.ts` | 갱신합니다. | 새 접수 포화의 QUEUE_FULL을 DomainErrorCode와 HTTP 매핑에 연결합니다. |
| `src/application/generation-service.ts` | 생성합니다. | S-07 공개 M-032~M-035 구현입니다. |
| `src/application/generation-snapshot.ts` | 갱신합니다. | CG-09의 공유 calculator를 실제 생성 접수·재시도에 연결합니다. |
| `src/persistence/generation-repository.ts` | 생성합니다. | 기존 schema의 snapshot/Run/receipt/용량 조건을 같은 트랜잭션으로 처리합니다. |
| `tests/helpers/generation-fixture.ts` | 생성합니다. | 아래에 정의한 최소 실제 DB fixture와 읽기 전용 snapshot helper입니다. |
| `tests/integration/generation-request.test.ts` | 생성합니다. | 접수·포화·재생·선택 고정·현재 입력 재시도를 검증합니다. |
| `tests/contract/generation-public.test.ts` | 생성합니다. | 공개 입력/오류/조회 정제와 내부 메서드 비노출을 검증합니다. |

**인터페이스와 입력 조건**

createGenerationFixture(app) -> Promise<{scope,input,guard}>는 tests/helpers/generation-fixture.ts에 정의합니다. empty 테스트 DB에 STORAGE의 fixture builder로 한 가상 프로젝트·담당 membership·editable SR·설명·프로젝트 내부 규칙만 한 트랜잭션으로 넣습니다. 생산 서비스의 권한/용량 코드는 구현하지 않습니다. scope는 실제 fixture의 actorId/projectId/srId이며 guard를 포함하지 않습니다. input은 CONTRACT GenerationInput의 질문 생성값입니다. fixture는 TestApp empty의 기존 프로젝트·멤버를 재사용하고 업무 SR·설명·규칙만 준비합니다. 그 뒤 실제 M-047의 new_generation 준비 조회에서 얻은 expectedInputFingerprint를 별도 guard로 반환합니다. M-034 같은 다른 메서드에 이 guard를 자동으로 섞지 않습니다. 이미 업무 자료가 있는 DB이면 거절합니다. 생성 Run/receipt는 미리 만들지 않습니다.

readGenerationState(app.db,runId?)는 같은 파일의 읽기 전용 SELECT입니다. 결과는 깊게 동결한 {nonterminalCount,runs:[{runId,status,inputSnapshotRef,providerSelection,retryOfRunId}],snapshots,receipts,slot,claims,observations,businessDigest}입니다. businessDigest는 원문 버전·질문/결정·게이트·승인 기준을 안정 정렬한 digest이며 runtime/receipt/활동 추가는 제외합니다. ownership token과 raw 모델/인증 값을 반환하지 않습니다. 정확한 SQL 열 이름은 STORAGE schema에 맞추며 helper가 제품 상태를 수정하지 않습니다.

taskKind wire enum은 CONTRACT와 일치시킵니다. 질문·결정 제안·요구사항/진행 계획/설계/구현 계획의 작업 구분을 유지합니다. 문서 대상은 정확한 versionRef 또는 absent 기준입니다. providerSelection은 서버 설정에서 고정하고 사용자 임의 실행 인자를 받지 않습니다.

최종 크기 검사는 canonical 지문용 envelope와 별도로 실행합니다. InputSnapshot 저장은 실제 직렬화 snapshot 2 MiB 상한을 검사합니다. M032/M035는 서버에서 고정한 selection과 task/documentKind를 합친 실제 ProviderRequest JSON의 UTF-8 bytes도 2 MiB 이하인지 같은 transaction의 commit 전에 검사합니다. canonical 입력이 한도 이하여도 JSON 문자열 escaping·명시 ref marker·전송 포장으로 커지면 snapshot/Run/receipt를 남기지 않고 VALIDATION_ERROR로 거절합니다. provider/model은 이 크기 검사에는 포함되지만 업무 fingerprint에는 포함되지 않습니다.

M-033 Query와 M-032/M-034/M-035의 receipt를 구분합니다. M-035는 failed/cancelled에서만 새 Run을 만듭니다. succeeded의 새 생성은 M-032입니다. 공개 registry는 M-032~035만 연결하며 M-036~039/M-049~050은 HTTP에 등록하지 않습니다.

- [x] **Step 055: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';

it('replays a queued request at capacity and rejects only the eleventh new request', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const { scope, input, guard } = await createGenerationFixture(app);
    const sent = [];
    for (let i = 0; i < 10; i += 1) {
      const result = await app.invoke('M-032', { ...scope, guard, idempotencyKey: `queue-${i}` }, input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      expect(result.value.status).toBe('pending');
      sent.push(result.value.runId);
    }
    const replay = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'queue-0' }, input);
    expect(replay).toMatchObject({ ok: true, disposition: 'Replayed', value: { runId: sent[0] } });
    const overflow = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'queue-10' }, input);
    expect(overflow).toMatchObject({ ok: false, error: { code: 'QUEUE_FULL' } });
    expect(readGenerationState(app.db).nonterminalCount).toBe(10);
    expect(readGenerationState(app.db).snapshots).toHaveLength(10);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 056: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/generation-request.test.ts -t "replays a queued request at capacity"
```

예상 결과는 다음과 같습니다. 미구현 M-032가 pending을 만들지 못하거나 receipt 우선/11번째 제한을 빠뜨려 행동 assertion이 실패해야 합니다. import 오류·DB fixture 실패는 RED 증거로 인정하지 않습니다.

최초 실제 RED는 `npm test -- tests/integration/generation-request.test.ts -t "replays a queued request at capacity"`에서 exit 1, 1 failed입니다. empty TestApp의 실제 M003 등록과 M047 준비는 성공했고 첫 M032의 미등록 handler가 ok:false를 반환해 pending 생성 단언이 실패했습니다.

- [x] **Step 057: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

BEGIN IMMEDIATE에서 현재 역할·SrScope·receipt를 먼저 확인합니다. 기존 같은 키/지문이면 현재 권한 재검사 후 Replayed를 반환하고 포화 검사를 새 접수에만 적용합니다. nonterminal 개수<10을 확인한 뒤 ENT-26·ENT-27 pending·ENT-35·활동을 함께 commit합니다. 실패 지점 주입으로 부분 snapshot/Run/receipt 0건을 검증합니다.

입력 지문은 task/refinement·설명·확인 상태·답변/결정/분류·참조 문서·규칙 내용/버전·targetBasis를 포함합니다. provider/model·host·cwd·runtime ID는 별도 실행 선택/메타데이터이며 업무 fingerprint에 넣지 않습니다. 실행 시 현재 포인터를 다시 읽어 옛 snapshot을 바꾸지 않습니다.

UTF-8 직렬화 명시 입력 총 2 MiB를 검사합니다. 새 문서 absent와 기존 정확한 versionRef를 구분합니다. 잘못된 다른 SR 참조·권한·누락 targetBasis·크기 초과는 작업을 남기지 않고 명확히 거절합니다.

M-034는 pending/running에서 첫 terminal을 CAS로 cancelled로 바꾸고 제어 알림을 commit 뒤 전달합니다. 여기서 프로세스 종료/slot 해제를 쓰지 않습니다. M-035는 이전 failed/cancelled를 보존한 채 현재 입력/선택으로 새 pending과 retryOfRunId를 만듭니다.

조회에 provider 종류·요청 모델·확인된 실제 모델·상태·stale·적용·신호/종료 확인을 별개 값으로 연결합니다. 질문 조회나 M-033 조회가 hidden write를 만들지 않게 합니다. 소유권 token·개인 경로·raw 진단을 직렬화하지 않습니다.

포화 상태의 M-033/M-034, 입력 변경 후 재시도, 설정만 변경한 뒤 기존 snapshot/문서/게이트 불변, 같은 입력 다른 키/같은 키 다른 입력, 공개 경로의 6개 내부 메서드 거절을 각각 별도 테스트로 추가합니다.

- [x] **Step 058: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/generation-request.test.ts tests/contract/generation-public.test.ts
```

통과 조건은 다음과 같습니다. 실제 SQLite의 10개 접수·동일 receipt 재생·11번째 거절·새 재시도·조회 무변경·내부 비노출이 통과해야 합니다. Claude 실제 성공은 이 명령의 결과에 포함하지 않습니다.

- [x] **Step 059: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 060: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

대기 작업과 고정 입력/선택/receipt의 원자적 저장 증거가 있습니다.

질문·결정/문서 작업 구분과 실제/테스트 표시 계약을 보존합니다.

관련 targeted GREEN과 typecheck를 기록하고 스토리 전체 완료를 표시하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-11 단일 claim·launch intent·첫 terminal·종료 slot의 저장 경계

**구현 묶음**: B-02입니다. **선행**: CG-10입니다.

**연결 기준**: M-036, M-037, M-038, M-049, M-050, US-009, US-010, US-011, US-013, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-34, SCN-14, SCN-15, SCN-16, SCN-17, SCN-19, SCN-20, NQ-06, NQ-08, NQ-14, NQ-16, NQ-18, NQ-21, NQ-22, ND-01, ND-07, ND-08, ND-09, ND-10, ND-12, INF-04, INF-06, INF-07, INF-08입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/application/generation-internal.ts` | 생성합니다. | C-02 S-07 내부 M-036~M-038/M-049/M-050과 capability 검증입니다. |
| `src/persistence/generation-repository.ts` | 갱신합니다. | 기존 DDL의 FIFO claim·singleton slot·terminal CAS·종료 observation 조건부 query입니다. |
| `src/generation-runtime/claim-context.ts` | 생성합니다. | 서버에서 발급한 runtime/claim capability를 관리하며 공개 DTO와 분리합니다. |
| `tests/helpers/internal-generation-rig.ts` | 생성합니다. | 제품 내부 포트를 직접 사용하는 아래 계약의 test helper입니다. |
| `tests/helpers/runtime-workers.ts` | 생성합니다. | 실제 별도 Node 프로세스에서 같은 DB를 다루는 테스트 실행기입니다. |
| `tests/fixtures/runtime-worker.test.ts` | 생성합니다. | 전용 Vitest 설정에서만 실행하는 claim/장애 worker입니다. |
| `vitest.runtime-worker.config.ts` | 생성합니다. | 위 한 worker 테스트만 포함하고 일반 테스트 재귀 실행을 막는 설정입니다. |
| `tests/integration/generation-claim.test.ts` | 생성합니다. | terminal 경쟁·늦은 observation·두 프로세스 claim과 crash gap 저장을 검증합니다. |

**인터페이스와 입력 조건**

createInternalGenerationRig(app) -> {claim():Promise<ClaimHandle|null>,complete(claim,draft):Promise<RunCompletionOutcome>,fail(claim,error):Promise<RunCompletionOutcome>,control(claim):Promise<RunControlView>,observe(claim,evidence):Promise<ExecutionObservation>}를 tests/helpers/internal-generation-rig.ts에 정의합니다. ClaimHandle은 테스트 접근용 runId/claimId와 helper가 비공개로 보관하는 실제 ClaimedRun/ClaimRef를 연결합니다. 제품 DTO의 필드 모양을 변경하지 않습니다. create 함수는 C-09 test runtime 등록과 C-02 S-07 내부 포트를 조립합니다. app.invoke나 공개 HTTP로 내부 계약을 부르지 않습니다. provider generation과 자동 인수 루프는 시작하지 않습니다. validDraft(claim)는 claim snapshot의 참조만 사용한 명시 fixture를 반환하며 생산 출력 validator를 우회하지 않습니다. complete/observe의 테스트 실행 증거는 좁은 test 포트로만 공급하며 public JSON에서 만들 수 없습니다.

terminationFixture(claim,{kind:'confirmed_test_child_close'|'no_process_created'})는 테스트 포트가 소유한 실행 증거에만 연결됩니다. 문자열 한 개만으로 production M-050 capability가 만들어지지 않습니다. 생산 경로의 no_process_created는 실제 spawn 미발생 증명에만 허용합니다.

tests/helpers/runtime-workers.ts의 startRuntimeWorker({app,testWorkerId,operation,barrier}) -> Promise<{ready,release(),result,crashOwnedWorker(),close()}>를 정의합니다. process.execPath와 로컬 node_modules/vitest/vitest.mjs의 인자 ['run','--config','vitest.runtime-worker.config.ts','tests/fixtures/runtime-worker.test.ts']로 실행합니다. 전용 설정은 worker 테스트 한 개만 포함합니다. 그 테스트가 같은 격리 DB를 별도 connection/runtime으로 열며 새 seed/reset을 하지 않습니다. 제어 정보는 .planrepo/test-runs/<testRunId>/control/<testWorkerId>/의 구조화한 JSON 파일에 READY/RELEASE/CRASH/RESULT로 교환합니다. DB/control 경로는 부모가 app.db에서 확인한 같은 testRunId realpath만 허용합니다. fs.watch와 제한시간 있는 확인으로 barrier를 구현하며 stdout이나 전체 PID 목록을 통신 규약으로 쓰지 않습니다. crashOwnedWorker()는 자기 helper가 소유한 control 채널에 CRASH를 쓰고, 실제 DB owner인 worker 테스트가 자신의 process.pid에만 SIGKILL을 보내도록 합니다. Vitest 관리자의 종료와 DB owner 종료를 혼동하지 않습니다. close()는 살아 있는 자기 worker에 정상 종료를 요청하고 확인하지 못하면 진단/자료를 보존합니다. runtime ID와 관찰 사실은 내부 테스트 자료이며 token/raw 출력은 기록하지 않습니다. 제품 runtime에 Vitest 의존성이나 외부 supervisor를 추가하지 않습니다.

M-037의 결과 입력은 C-06/C-09가 준 실제 관찰/검증 결과와 결합합니다. 테스트에서 control 가능한 증거 port를 주입하되 production HTTP나 JSON에서 이 port를 구성할 수 없습니다.

- [x] **Step 061: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { createGenerationFixture, readGenerationState } from '@/tests/helpers/generation-fixture';
import { createInternalGenerationRig, validDraft, terminationFixture } from '@/tests/helpers/internal-generation-rig';

it('preserves cancellation until matching termination and ignores old observations after a new claim', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const { scope, input, guard } = await createGenerationFixture(app);
    const first = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'r1' }, input);
    if (!first.ok) throw new Error(first.error.code);
    const rig = createInternalGenerationRig(app);
    const c1 = await rig.claim();
    expect(c1).not.toBeNull();
    if (!c1) throw new Error('claim missing');
    await app.invoke('M-034', { ...scope, idempotencyKey: 'cancel-r1' }, first.value.runId);
    await rig.complete(c1, validDraft(c1));
    expect(readGenerationState(app.db, c1.runId).runs[0].status).toBe('cancelled');
    expect(readGenerationState(app.db).slot?.claimId).toBe(c1.claimId);
    const second = await app.invoke('M-032', { ...scope, guard, idempotencyKey: 'r2' }, input);
    expect(second.ok).toBe(true);
    expect(await rig.claim()).toBeNull();
    const observation = terminationFixture(c1, { kind: 'confirmed_test_child_close' });
    await rig.observe(c1, observation);
    const c2 = await rig.claim();
    if (!c2) throw new Error('second claim missing');
    await rig.observe(c1, observation);
    expect(readGenerationState(app.db).slot?.claimId).toBe(c2.claimId);
    expect(readGenerationState(app.db, c1.runId).observations).toHaveLength(1);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 062: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/generation-claim.test.ts -t "preserves cancellation until matching termination"
```

예상 결과는 다음과 같습니다. cancel 뒤 complete가 succeeded로 뒤집히거나, terminal만으로 slot을 비우거나, R1 재전송이 R2 slot을 지우는 결함을 assertion으로 잡아야 합니다.

- [x] **Step 063: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-036: BEGIN IMMEDIATE -> slot 비어 있음 AND 다른 running 없음 -> FIFO(createdAt,runId) pending 1개 -> 단 하나의 claim 발급 -> Run running+claim+slot+launchIntent를 같은 commit에 기록합니다. 반환 전에 PID를 요구하지 않습니다. spawn 전에 취소/지원 환경을 다시 확인할 수 있게 합니다.

M-037/M-038: 원 runtime/claim capability와 status=running을 WHERE 조건으로 검사합니다. M-037은 유효한 payload/같은 snapshot refs/정제 2 MiB/성공 관찰/deadline을 확인한 뒤 초안+terminal을 commit합니다. current fingerprint 불일치는 stale 초안으로 보존하며 업무 적용을 하지 않습니다. 늦은 결과는 첫 terminal과 본문을 유지합니다.

M-049는 terminal 뒤에도 같은 claim의 제어만 읽습니다. M-050은 검증된 observation 고유성을 확인하고 claim당 한 번 기록합니다. slot.claimRef=observation.claimRef인 경우에만 slot을 지웁니다. 이미 다른 slot이면 원 observation 재생만 하며 상태를 바꾸지 않습니다.

spawn 미시도 확정/명시 spawn 실패는 no_process_created 증거로 정리할 수 있습니다. PID 저장 전 crash gap·부모 사망·signal 성공·heartbeat 만료를 그 증거로 쓰지 않습니다. 기존 DDL의 claim 유일성·slot singleton·observation 유일성을 실제 SQL로 검증합니다.

두 실제 worker 프로세스를 barrier에서 동시에 M-036에 진입시켜 claim 1개/slot 1개/다른 Run pending을 확인합니다. 같은 키 접수도 서로 다른 connection에서 경쟁시킵니다. BUSY/rollback을 성공으로 삼지 않고 NQ-02 실패 응답 기준에 연결합니다.

성공 먼저/취소 먼저/실패 먼저/timeout 먼저, 잘못된 claim·다른 SR·이전 owner의 completion, 출력 검증 후 commit 직전 입력 변경, slot/Run 모순을 별도 테스트로 둡니다. 상태 모순은 새 인수를 막고 복구 오류를 반환합니다.

- [x] **Step 064: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/generation-claim.test.ts tests/integration/generation-request.test.ts
```

통과 조건은 다음과 같습니다. 첫 terminal·slot/관찰 분리·두 프로세스 단일 인수·잘못된 claim 거절·원자적 실패가 실제 SQLite에서 통과해야 합니다. 모의 termination fixture는 실제 Claude 종료 증거로 보고하지 않습니다.

- [x] **Step 065: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 066: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

6개 내부 계약 중 이 task가 맡는 5개가 공개 경로 없이 연결됩니다. M-039는 RUN_RECOVERY에서 완성합니다.

single slot 보호를 메모리 busy flag로 대체하지 않습니다.

M-050 재생과 다음 Run의 slot 보호가 실제 DB assertion으로 남습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-12 동시 pipe·deadline·취소·종료 관찰을 분리하는 제한 Node runner

**구현 묶음**: B-02입니다. **선행**: CG-01, CG-02, CG-11입니다.

**연결 기준**: M-034, M-036, M-037, M-038, M-049, M-050, US-009, US-010, ENT-27, ENT-28, ENT-29, ENT-30, SCN-16, SCN-17, SCN-20, NQ-02, NQ-14, NQ-15, NQ-16, NQ-17, NQ-19, NQ-22, ND-08, ND-09, ND-10, ND-11, ND-12, INF-02, INF-03, INF-06, INF-07, INF-08입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/runtime/controlled-process-runner.ts` | 생성합니다. | 비동기 spawn과 소유 handle·pipe·signal·종료 관찰을 구현합니다. |
| `src/runtime/process-evidence.ts` | 생성합니다. | 현재 실행에 연결된 observation capability와 unknown을 구분합니다. |
| `src/generation-runtime/execution-loop.ts` | 생성합니다. | C-05의 provider 호출·M-049 제어·M-038/M-050 전달입니다. |
| `tests/helpers/process-rig.ts` | 생성합니다. | 가짜 시계/명시 event의 좁은 spawn port와 실제 runner를 연결합니다. |
| `tests/fixtures/process-child.mjs` | 생성합니다. | Node만 사용하는 실제 child fixture이며 아래 명령/수명 계약을 따릅니다. |
| `tests/unit/controlled-process.test.ts` | 생성합니다. | 두 pipe·시간·signal 경계의 결정적 순서를 검증합니다. |
| `tests/integration/controlled-process-os.test.ts` | 생성합니다. | 현재 macOS의 실제 child exit/close·입출력·취소/강제 종료를 검증합니다. |
| `tests/helpers/generation-controller.ts` | 생성합니다. | 자동 인수를 기본 정지한 TestApp에서 명시한 테스트 adapter 또는 사전 검증한 live 후보의 C-05 루프를 제어합니다. |

**인터페이스와 입력 조건**

ControlledProcessRunner.start(spec,observer) -> OwnedExecution을 정의합니다. spec={executable,args,cwd,env,stdinBytes,launchRef,limits}; observer는 실제 실행 관찰/정제 실패만 받습니다. OwnedExecution={result:Promise<ProcessResult>,requestStop(reason),getObservationState()}. ProcessResult는 Completed{stdout:Buffer,stderrByteCount,exitCode:0,closedAtMono,deadlineMono}|Failure{code}의 판별을 유지하며, CG13 첫 실제 adapter 소비에서 양쪽 분기에 최초 결과 확정 시점의 정제된 실행 metrics를 추가합니다. 실제 byte 수·pipe close 관측·시작 시도와 결과 확정 시각·관측한 exit/signal을 담고 늦은 관찰로 소급 수정하지 않습니다. Completed는 business 성공이 아니며 C-06/C-02의 결과 schema·refs·deadline 재검사가 남습니다. observation이 unknown이 되어도 동일 live handle의 늦은 신뢰 가능한 close를 observer로 전달할 수 있습니다. raw stderr를 Failure에 포함하지 않습니다.

tests/helpers/process-rig.ts의 createProcessRig() -> {start(),stdout(Buffer),stdoutEnd(),stderr(Buffer),stderrEnd(),exit(code),close(code),advance(ms),flush(),resultSettled(),signals()}를 정의합니다. 이것은 생산 ControlledProcessRunner에 fake SpawnPort/MonotonicClock를 주입하는 helper이며 결과/slot을 자체 구현하지 않습니다. flush는 이미 예약한 promise/event만 소진합니다. advance는 단조 시계와 timer를 명시적으로 움직입니다. 실제 OS 증거와 구분합니다.

tests/fixtures/process-child.mjs는 process.execPath로만 실행합니다. argv의 enum mode는 success, late-stderr-overflow, flood-both, wait-for-term, ignore-term, nonzero, invalid-json입니다. stdin으로 받은 명시 가상 bytes만 처리합니다. 생산 runner와 같은 stdin/stdout/stderr 세 pipe를 사용하며 시작은 현재 ChildProcess spawn 이벤트로 관찰합니다. 추가 IPC descriptor를 생산 runner에 요구하지 않습니다. success는 stdout 후 정상 exit; late-stderr-overflow는 stdout을 끝낸 뒤 stderr 262145 bytes; ignore-term만 자기 SIGTERM을 무시합니다. 네트워크·설정·credential·다른 파일 접근·자손 spawn은 하지 않습니다. 테스트 종료는 자신이 만든 handle만 정리하며 살아 있는 child/unknown evidence면 cwd를 삭제하지 않습니다.

createGenerationController(app)는 tests/helpers/generation-controller.ts에서 실제 C-05와 S-07 비공개 포트를 조립합니다. 반환값은 startTestAdapter(provider:GenerationProvider):Promise<void>, stop():Promise<void>입니다. TestApp은 기본 manual/paused이며 생성 접수·수동 claim 테스트 중 background loop가 자동 시작되지 않습니다. controller는 app.close에 stop을 등록하고 동일 앱에서 중복 루프 시작을 거절합니다. 테스트 adapter 주입은 이 내부 helper만 사용하며 일반 제품 API나 설정에서는 접근할 수 없습니다.

- [x] **Step 067: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { createProcessRig } from '@/tests/helpers/process-rig';

it('does not finish on stdout and fails if stderr later exceeds its byte limit', async () => {
  const rig = createProcessRig();
  const execution = rig.start();
  rig.stdout(Buffer.from('{"type":"result","subtype":"success","is_error":false,"result":"{}"}'));
  rig.stdoutEnd();
  await rig.flush();
  expect(rig.resultSettled()).toBe(false);
  rig.stderr(Buffer.alloc(262145));
  await rig.flush();
  expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
  expect(execution.getObservationState().kind).not.toBe('Confirmed');
  rig.exit(0);
  rig.stderrEnd();
  rig.close(0);
  await rig.flush();
  expect(await execution.result).toMatchObject({ kind: 'Failure', code: 'OUTPUT_LIMIT' });
});
```

- [x] **Step 068: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/unit/controlled-process.test.ts -t "does not finish on stdout"
```

예상 결과는 다음과 같습니다. stdout 하나의 완료를 전체 성공으로 처리하는 구현에서 첫 assertion이 실패해야 합니다. 또는 stderr 초과를 부분 성공으로 처리하는 동작에서 Failure assertion이 실패해야 합니다.

- [x] **Step 069: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

spawn(executable,args,{shell:false,detached:true,cwd,env,stdio:[pipe,pipe,pipe]})를 사용하고 unref하지 않습니다. C-05가 저장한 launchIntent/capability와 현재 ChildProcess handle을 연결합니다. 프롬프트는 stdin에 쓰고 backpressure/입력 오류를 처리합니다. stdout/stderr data listener를 즉시 함께 붙입니다.

각 Buffer raw bytes를 누적하며 stdout>4194304 또는 stderr>262144면 OUTPUT_LIMIT과 정리를 시작합니다. Korean UTF-8 경계와 JSON escape 후 입력 2097152 bytes를 검사합니다. stderr 끝까지 소비하거나 상한에서 명시적으로 실패 처리하고 raw 덤프를 남기지 않습니다.

deadlineMono=spawnAttemptMono+300000입니다. timer 통지뿐 아니라 close/파싱/참조 검증 후 M-037 직전 nowMono<=deadlineMono를 재검사합니다. direct child 정상 exit 0, 양쪽 stream close, 최종 bytes, IO 오류 부재가 모두 있어야 ProcessResult.Completed가 됩니다. nonzero/invalid IO는 실패이며 JSON envelope 판정은 RUN_PROVIDER가 맡습니다.

M-034 commit 알림+250ms M-049 확인으로 중단 요청을 감지합니다. 1초 내 SIGTERM 목표, 2초 유예 후 여전히 같은 실행의 소유 범위를 확인할 때만 SIGKILL을 시도합니다. pgid>1의 현재 소유 group만 허용하고 종료 후 timer를 해제합니다. 재시작 DB PID/PGID에 signal을 보내지 않습니다.

signal 성공·child.killed·ESRCH 하나를 종료로 쓰지 않습니다. direct child/양쪽 pipe와 검증된 실행 범위 부재를 결합합니다. EPERM·escaped descendant·identity 불확실이면 unknown, 10초 관찰 목표 미통과, slot 유지입니다. 신뢰 가능한 늦은 관찰만 M-050에 전달합니다.

실제 Node child fixture로 stdin 한글/backpressure, 동시 flood, 정상/비정상 exit, SIGTERM 반응/무응답, close 지연을 검증합니다. fake clock 테스트는 300초 경계/1ms 초과/파싱으로 timer 지연을 검증하고 실제 clock 테스트는 별도 증거로 기록합니다. tests/helpers/runtime-workers.ts의 앱 worker와 연결해 비AI 요청이 생성 중에도 처리됨을 확인합니다.

검증 목록에 ENOENT spawn 확정 실패의 no_process_created와 PID 저장 전 crash gap의 unknown을 별도로 둡니다. 어떤 경우도 기존 문서/승인이나 terminal 결과를 뒤집지 않습니다.

- [x] **Step 070: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/unit/controlled-process.test.ts tests/integration/controlled-process-os.test.ts tests/integration/generation-claim.test.ts
```

통과 조건은 다음과 같습니다. 결정적 event 경쟁과 현재 macOS 실제 child 검증을 각각 기록합니다. actual child fixture의 성공을 Claude no-spawn/managed 정책 검증으로 일반화하지 않습니다. 시간 목표를 초과하면 실패/미통과 수치를 남깁니다.

- [x] **Step 071: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 072: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

모든 pending listener/pipe/timer의 정상 종료와 unknown 보존을 검사했습니다.

표준 시간·bytes 제한을 상향해 테스트를 통과시키지 않습니다.

timeout/취소/실패의 terminal 확정과 실제 종료 관찰이 다른 사건임을 검증했습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-13 검증 가능한 Claude CLI 프로파일·결과 검증·동일 provider 교체 계약

**구현 묶음**: B-02입니다. **선행**: CG-10, CG-11, CG-12입니다.

**연결 기준**: M-032, M-033, M-036, M-037, M-038, US-009, US-010, US-011, US-013, ENT-26, ENT-27, ENT-28, ENT-30, SCN-15, SCN-18, SCN-19, SCN-20, NQ-04, NQ-17, NQ-18, NQ-19, NQ-20, NQ-22, ND-07, ND-09, ND-11, ND-12, ND-13, ND-14, INF-03, INF-06, INF-07, INF-08입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/providers/generation/provider-contract.ts` | 갱신합니다. | GenerationProvider와 ProviderRequest/결과의 provider 독립 계약입니다. |
| `src/contracts/views.ts` | 갱신합니다. | 기존 provider 판별 계약을 유지하며 명시 provider 오류의 PROVIDER_ERROR를 token 없는 실패 코드에 추가합니다. |
| `src/providers/generation/provider-registry.ts` | 생성합니다. | 요청 시 고정 providerSelection으로 adapter를 선택합니다. |
| `src/providers/generation/claude-cli.ts` | 생성합니다. | 제한 실행을 호출하고 실제 CLI envelope를 정규화합니다. |
| `src/providers/generation/claude-profile.ts` | 생성합니다. | 고정 argv·환경 allowlist·지원/정책 증거를 검사합니다. |
| `src/providers/generation/claude-result.ts` | 생성합니다. | exit/JSON error/schema/model 정보를 검증합니다. |
| `config/claude/mcp-empty.json` | 생성합니다. | 내용은 {"mcpServers":{}}입니다. |
| `config/claude/launch-policy.json` | 생성합니다. | 승인 ND-11 후보와 정책 지문/허용 환경 기준입니다. 성공 확인 플래그를 미리 만들지 않습니다. |
| `tests/helpers/provider-fixture.ts` | 생성합니다. | 가상 envelope·테스트 adapter·runner spy를 정의합니다. |
| `tests/contract/claude-provider.test.ts` | 생성합니다. | is_error·실행 인자 전달·정책 거절을 검증합니다. |
| `tests/integration/provider-swap.test.ts` | 생성합니다. | 실제 저장과 동일 계약의 Claude fixture/test adapter 교체를 검증합니다. |

**인터페이스와 입력 조건**

CG13 첫 실제 adapter 연결에서 ExecutionControl에 런타임이 만든 execution={launchRef,cwd}를 추가합니다. ProviderRequest에는 넣지 않습니다. ProcessResult는 최초 결과 확정 시점의 실제 stdout/stderr byte 수, pipe close 관측, 시작 시도·결과 확정 시각과 관측한 exit/signal을 정제 metrics로 제공합니다. 취소 뒤 늦은 close는 metrics를 소급 변경하지 않고 별도 observation으로 전달합니다. finishedAt은 전체 OS 실행 범위 종료의 증명이 아닙니다. deadline은 기존 monotonic clock을 유지합니다. C-05 관찰 연결은 adapter 생성자에 주입한 좁은 observer sink를 사용하며 ClaimRef·DB·RuntimeContext를 전달하지 않습니다.

GenerationProvider.generate(ProviderRequest,ExecutionControl) -> Promise<ProviderOutcome>를 모든 adapter가 구현합니다. CG-02의 기존 판별 계약인 {kind:'completed',result,execution} 또는 {kind:'failed',failure,execution}를 유지합니다. result는 GenerationResult, failure는 token 없는 ProviderFailureCore, execution은 ExecutionReport입니다. 유효한 CLI envelope가 is_error=true인 실패를 구분하도록 CG-13에서 ProviderFailureCore에 PROVIDER_ERROR를 추가합니다. RuntimeContext/DB/repository/API 주체를 ProviderRequest에 주지 않습니다. 테스트 adapter는 tests/helpers/provider-fixture.ts에서만 등록하며 실제 기본 연결을 조용히 대체하지 않습니다.

decodeClaudeResult({stdout,process,request}) -> ProviderOutcome는 src/providers/generation/claude-result.ts에 정의합니다. process는 RUN_PROCESS Completed 증거, request는 고정 snapshot/선택입니다. tests/helpers/provider-fixture.ts의 providerFixture()는 {request,closedProcess}를 반환하며 고정 가상 참조만 포함합니다. closedProcess는 테스트 증거이며 실제 Claude 실행으로 기록되지 않습니다.

프로파일은 설치 2.1.263과 최신 사용자 지시로 검증한 기존 환경 재사용 조합입니다. --print --input-format text --output-format json --tools '' --disallowedTools 'mcp__*' --strict-mcp-config --mcp-config <앱 empty 파일> --no-session-persistence --disable-slash-commands --no-chrome --permission-mode dontAsk --permission-prompts none --settings '{"disableAllHooks":true}' --system-prompt <고정 앱 문구>를 인자 배열로 전달합니다. --model은 explicit 선택일 때만 고정 modelId를 넣습니다. bare/bypass/resume/continue/불확실한 setting-sources는 추가하지 않습니다.

기본 선택은 explicit/global.anthropic.claude-opus-4-8입니다. installed_default는 교체 가능한 선택지로 유지하며 CLI가 실제 사용하는 기본값입니다. 사용자 설정 alias만 보고 실제 model ID를 추정하지 않습니다. 실제 model ID는 확인된 result 메타데이터만 쓰고 없으면 null/미확인입니다. CLI/정책 변경은 지원 상태를 미검증으로 내립니다.

- [x] **Step 073: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { decodeClaudeResult } from '@/src/providers/generation/claude-result';
import { providerFixture } from '@/tests/helpers/provider-fixture';

it('rejects an is_error result even when its subtype says success', () => {
  const { request, closedProcess } = providerFixture();
  const outcome = decodeClaudeResult({
    request,
    process: closedProcess,
    stdout: Buffer.from(JSON.stringify({
      type: 'result', subtype: 'success', is_error: true,
      result: 'provider failure with synthetic secret CANARY_DO_NOT_LOG'
    }))
  });
  expect(outcome).toMatchObject({ kind: 'failed', failure: { code: 'PROVIDER_ERROR' } });
  expect(JSON.stringify(outcome)).not.toContain('CANARY_DO_NOT_LOG');
});
```

- [x] **Step 074: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/contract/claude-provider.test.ts -t "rejects an is_error result"
```

예상 결과는 다음과 같습니다. subtype success만 신뢰하거나 raw result를 오류에 복제하는 구현에서 실패해야 합니다. 정상 error envelope를 알 수 없는 성공 초안으로 저장하면 안 됩니다.

- [x] **Step 075: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

PATH에서 실행 파일을 찾고 --version/--help로 현재 버전·지원 인자를 확인합니다. 개인 설치 경로를 config에 고정하지 않습니다. CLI version과 approved candidate/profile의 차이를 기록하며 새 옵션/패키지 버전을 근거 없이 추가하지 않습니다.

지원 사전조건은 검증한 tools/MCP 비활성·strict MCP 유효성·새로운 비저장 세션·CLI hook 제한입니다. 관찰된 자동 명령이나 managed MCP 충돌은 PROVIDER_UNAVAILABLE로 처리합니다. 모든 MDM·전역 문맥의 부재를 입증하지 못했다는 일반적 한계만으로 기존 연결을 차단하지 않습니다. 최신 사용자 지시와 aidlc-docs/construction/planrepo/code/claude-execution-decision.md의 실제 호출 근거를 적용합니다. credential 원문을 별도로 읽거나 기록하지 않고 global settings/login을 변경하지 않습니다. 검증 사전조건과 실제 업무 생성 검증 단계는 RUN_LIVE에서 구분합니다.

args는 빈 tools 문자열과 mcp__*를 각각 한 인자로 보존합니다. HOME·PATH와 기존 인증 및 provider 라우팅 환경을 유지하며 CLI가 자신의 user settings를 읽게 합니다. provider 구현에서 필요한 환경 이름을 명시하고 값을 로그·스냅샷·설정 파일로 복제하지 않습니다. 검증된 locale·작업별 TMPDIR를 사용하며 NODE_OPTIONS/NODE_PATH·업무 token·DB 경로를 전달하지 않습니다. CLI 도구·MCP·hook 제한은 고정 argv로 적용합니다. 모든 prompt bytes는 stdin 또는 고정 system prompt이며 외부 경로/명령을 사용자 문자열로 구성하지 않습니다.

stdout JSON은 error flag/subtype·결과 타입·본문 schemaVersion/taskKind·허용 참조·크기를 검사합니다. stdout error를 stderr 부재로 성공 처리하지 않습니다. 알려지지 않은 envelope·다른 SR 참조·모델 승인/명령·truncated JSON·정제 draft>2 MiB는 실패입니다. schema와 실제 envelope fixture는 최초 실제 검증에서 확인한 형식에 맞춰 고정합니다.

C-06은 provider 독립 draft/실패만 반환하고 C-02 M-037은 원 claim·상태·현재 fingerprint·deadline을 다시 확인합니다. 실제 model/CLI 표시는 근거가 있는 경우에만 채웁니다. AI 출력의 runId/claim/role은 내부 실행을 식별하는 권한이 아닙니다.

provider-swap 테스트는 요청 뒤 기본 설정 변경, explicit model 인자, 기존 선택 고정, 입력 지문 불변, 교체 전후 stale/결과 검증/업무 digest 불변을 실제 DB에서 확인합니다. Claude 쪽은 runner의 명시 envelope fixture를 쓰는 계약 테스트임을 표시합니다. 실제 Claude와 test adapter의 초기 공통 경로 증거는 RUN_LIVE에서 별도 수집합니다.

후속 EDITOR/B-06 연결에서 두 adapter 초안에 같은 사람 적용·충돌·게이트 규칙을 검증합니다. 이 task의 green만으로 US-013 C2/전체 AC-18을 완료하지 않습니다.

- [x] **Step 076: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/contract/claude-provider.test.ts tests/integration/provider-swap.test.ts tests/unit/controlled-process.test.ts
```

통과 조건은 다음과 같습니다. 프로파일 인자 transport·정책 fail-closed·error envelope·참조·정제·고정 선택·provider 교체 계약이 통과합니다. 실제 지원 활성화는 RUN_LIVE의 명시 검증 증거가 있어야 합니다.

- [x] **Step 077: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 078: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

첫 실제 연결은 설치 Claude이며 자동 test fallback이 없습니다.

관찰하지 못한 실제 model과 관리 정책을 추정하지 않습니다.

실제/fixture/test 결과를 구분한 계약 증거를 남깁니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-14 시작·정상 종료·crash gap 복구와 known limitation의 명시

**구현 묶음**: B-02입니다. **선행**: CG-11, CG-12, CG-13입니다.

**연결 기준**: M-036, M-039, M-049, M-050, US-009, US-010, ENT-27, ENT-28, ENT-29, ENT-30, SCN-16, SCN-17, SCN-20, NQ-04, NQ-05, NQ-14, NQ-16, NQ-21, NQ-22, NQ-23, ND-08, ND-09, ND-10, ND-13, ND-14, INF-04, INF-07, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/generation-runtime/recovery.ts` | 생성합니다. | M-039 부모 중단 분류와 제한된 M-050 복구 경로입니다. |
| `src/runtime/macos-observation.ts` | 갱신합니다. | CG-05에서 준비한 고정 sysctl/ioreg host/boot 관찰을 복구 판단에 연결합니다. |
| `src/generation-runtime/runtime-lifecycle.ts` | 생성합니다. | runtime 등록·shutdown·pending 보존과 정리 중 DB 수명입니다. |
| `src/application/generation-internal.ts` | 갱신합니다. | 검증한 원 claim의 복구 관찰 capability만 연결합니다. |
| `tests/helpers/recovery-rig.ts` | 생성합니다. | 같은 실제 DB와 명시 OS 관찰 fixture를 결합하는 아래 계약입니다. |
| `tests/helpers/runtime-workers.ts` | 갱신합니다. | 기존 helper에 claim/spawn/commit 장애 barrier를 추가합니다. |
| `tests/fixtures/runtime-worker.test.ts` | 갱신합니다. | 기존 worker에 제한 child fixture와 crash 지점을 추가합니다. |
| `tests/integration/generation-recovery.test.ts` | 생성합니다. | unknown·reboot 조건·terminal 보존·낡은 claim을 검증합니다. |
| `tests/integration/generation-crash-os.test.ts` | 생성합니다. | 실제 worker 중단 후 저장·slot 보존을 검증합니다. |

**인터페이스와 입력 조건**

createRecoveryRig(app) -> {prepareClaim():Promise<{runId,claimId}>,restartWithObservation(observation):Promise<RecoverySummary>,signals():readonly SignalAttempt[]}를 tests/helpers/recovery-rig.ts에 정의합니다. prepareClaim은 RUN_REQUEST fixture/M-032와 RUN_CLAIM M-036을 실제 DB에서 호출합니다. restartWithObservation은 test 전용 OS observation port와 새 runtime을 조립하며 DB를 직접 terminal/빈 slot으로 수정하지 않습니다. 관찰 fixture의 출처를 Test로 남깁니다. 실제 owner crash는 별도 generation-crash-os.test.ts에서 runtime-workers로 검증합니다.

RecoverySummary는 {classification:'KnownInterrupted'|'Unknown'|'PreservedTerminal',goalMet:boolean,reason,...}를 내부 결과로 사용하며 공개 GenerationRunView에는 정제한 상태/미확인 이유만 매핑합니다. same-host/same-boot에서 strong start identity가 없으면 owner PID ESRCH·ps lstart·heartbeat로 M-039를 완화하지 않습니다.

정상 observation과 host_reboot_confirmed가 M-050에 연결되어도 Run이 running이면 검증된 부모 중단에 따른 M-039 terminal 확정이 필요합니다. M-036은 slot 없음 AND 다른 running 없음일 때만 다음 pending을 인수합니다.

macOS observation 명령은 /usr/sbin/sysctl -n kern.bootsessionuuid 및 /usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice -k IOPlatformUUID입니다. shell=false·고정 args·제한 출력·UUID 형식을 검사합니다. raw UUID/OS 전체 출력은 로그/UI/인계에 내보내지 않습니다. 시작 정보가 미지원이면 그 사실을 저장하고 가짜 strong identity를 만들지 않습니다. 초기 native libproc helper/Python/Swift runtime 추가는 없습니다.

- [x] **Step 079: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { readGenerationState } from '@/tests/helpers/generation-fixture';
import { createRecoveryRig } from '@/tests/helpers/recovery-rig';

it('keeps same-boot recovery unknown without strong identity even when the owner PID is absent', async () => {
  const app = await createTestApp({ fixture: 'empty', testRunId: randomUUID() });
  try {
    const rig = createRecoveryRig(app);
    const before = await rig.prepareClaim();
    const report = await rig.restartWithObservation({
      source: 'Test', hostRelation: 'same', bootRelation: 'same',
      startIdentity: 'unavailable', ownerPidCheck: 'ESRCH',
      executionTermination: 'unknown'
    });
    expect(report).toMatchObject({ classification: 'Unknown', goalMet: false });
    const state = readGenerationState(app.db, before.runId);
    expect(state.runs[0].status).toBe('running');
    expect(state.slot?.claimId).toBe(before.claimId);
    expect(state.observations).toHaveLength(0);
    expect(rig.signals()).toHaveLength(0);
  } finally {
    await app.close();
  }
});
```

- [x] **Step 080: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/generation-recovery.test.ts -t "keeps same-boot recovery unknown"
```

예상 결과는 다음과 같습니다. PID 부재/새 runtime만으로 interrupted 또는 종료 확인을 확정하거나 slot을 지우는 구현에서 실패해야 합니다. fake observation으로 실제 OS 복구 지원 완료를 표시하는 테스트도 실패시킵니다.

- [x] **Step 081: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

앱 등록은 새 runtimeInstanceId와 host/boot·부모 PID·관찰 가능한 시작 identity/미지원 상태를 claim/launchIntent에 연결합니다. 복구용 비밀은 공개 DTO/로그에 넣지 않습니다. 조회 준비 뒤 10초 내 분류 목표를 측정하고 증거 부족이면 Unknown+goalMet=false를 기록합니다.

M-039는 승인 ND-10의 강한 OS 근거가 있는 이전 runtime의 running만 interrupted 실패로 CAS합니다. 초기 same-boot strong identity 부재는 알려진 한계이며 미확인 상태/slot을 보존합니다. 테스트가 이 보수적 동작을 확인했다고 NQ-21 목표 통과로 바꾸지 않습니다.

같은 물리 host·검증된 boot 전환·실행 전 저장된 원 identity가 모두 있을 때만 host_reboot_confirmed를 사용합니다. 실제 reboot 없이 주입한 fixture는 알고리즘 테스트입니다. sleep/same boot·다른 host·복사/VM 복원·UUID 파싱 실패·EPERM·ESRCH 단독은 자동 종료 근거가 아닙니다. 신뢰 조건을 실제로 검증하지 못하면 해당 OS recovery capability는 비활성입니다.

실제 worker를 claim commit 전/후, spawn 직후 PID 저장 전, 성공 commit 뒤 M-050 전에서 중단합니다. worker가 만든 제한 Node child를 테스트 harness가 현재 소유 handle로 별도 정리하더라도, 앱 복구의 trusted observation을 조작하지 않습니다. slot/Run/초안/receipt/pending 보존과 재인수 거절을 확인합니다. 종료 미확인 child가 남으면 test-runs를 지우지 않습니다.

검증된 부모 중단과 실제 Claude 전체 종료를 분리합니다. M-039 뒤에도 slot을 유지합니다. terminal 성공은 보존하고 M-050만 보충합니다. 복구 runtime은 완료 권한을 재발급하지 않으며 옛 claim completion을 차단하고 동일 claim observation만 허용합니다.

정상 shutdown은 새 HTTP 변경/인수 중단, 짧은 commit/rollback 완료, 자기 runner 정리, M-049/M-050 저장, runtime 종료 기록, DB close 순서입니다. running 정리는 내부 실패 사유이며 사용자의 가상 취소 행위로 만들지 않습니다. 10초 뒤에도 종료 미확인/저장 실패면 slot을 보존하고 오류 종료합니다.

ready는 DB 사용 준비와 provider/복구 제한을 분리합니다. Unknown일 때 비AI 조회·편집이 가능하고 새 인수만 막히는지 검사합니다. maintenance는 active/unknown runtime·slot/running이면 거절하여 source 변경/시드로 상태를 초기화하지 않습니다.

B-02 결과에 same-boot crash의 NQ-21 미통과와 실제 reboot 미검증을 분명히 남깁니다. 목표 충족이 필요한 후속 결정을 위해 원인·가능한 strong identity 수단·native 추가 비용을 제시하며 현재 승인 경계를 임의 완화하지 않습니다.

- [x] **Step 082: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/generation-recovery.test.ts tests/integration/generation-crash-os.test.ts tests/integration/generation-claim.test.ts
```

통과 조건은 다음과 같습니다. 보수적 unknown 처리와 실제 crash 자료 보존 테스트는 GREEN이어야 합니다. 그러나 same-boot 강한 identity 미지원으로 NQ-21 해당 목표는 미통과이며, fixture reboot는 실제 reboot 검증을 대체하지 않습니다.

- [x] **Step 083: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 084: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

저장·복구 테스트의 GREEN과 NQ-21 목표 달성을 별개로 보고합니다.

재시작 후 stale PID/PGID signal·자동 slot 삭제·claim 재발급이 없습니다.

실제 crash 테스트의 환경·지점·자료 보존·미확인 child/목표 결과를 기록합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-15 초기 실제 Claude 가상 흐름·교체 증거와 지원 판정

**구현 묶음**: B-02입니다. **선행**: CG-09, CG-10, CG-11, CG-12, CG-13, CG-14입니다.

**연결 기준**: M-008, M-015, M-016, M-018, M-019, M-032, M-033, M-034, M-035, M-036, M-037, M-038, M-049, M-050, US-004, US-009, US-010, US-011, US-013, ENT-08, ENT-10, ENT-11, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, SCN-15, SCN-16, SCN-17, SCN-18, SCN-19, SCN-20, NQ-04, NQ-14, NQ-15, NQ-16, NQ-17, NQ-18, NQ-19, NQ-20, NQ-21, NQ-22, NQ-23, ND-07, ND-08, ND-09, ND-10, ND-11, ND-12, ND-13, ND-14, INF-03, INF-06, INF-07, INF-08, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/runtime/claude-verification-status.ts` | 생성합니다. | 확인된 profile/실제 증거와 미검증·제한 상태를 분리합니다. |
| `tests/helpers/claude-evidence.ts` | 생성합니다. | 증거 fixture와 보고서 schema를 정의합니다. 실제 증거를 생성하지 않습니다. |
| `tests/unit/claude-readiness.test.ts` | 생성합니다. | 설치·mock 결과를 실제 생성/격리 통과로 바꾸지 못하게 합니다. |
| `tests/live/claude-live.test.ts` | 생성합니다. | 명시 실행에서만 설치 Claude의 가상 질문/후속 문서와 제한 경계를 검증합니다. |
| `vitest.claude-live.config.ts` | 생성합니다. | tests/live 한정·직렬 실행·300초 생성 기준에 맞는 테스트 외부 제한을 정의합니다. |
| `scripts/verify-claude.mjs` | 생성합니다. | npm run verify:claude의 명시 진입점입니다. 자동 설치/로그인/설정 변경/재호출을 하지 않습니다. |
| `package.json` | 갱신합니다. | verify:claude를 명시 live 설정에 연결하고 일반 test에서 live를 제외합니다. |
| `config/claude/launch-policy.json` | 갱신합니다. | 실제 확인한 호환 profile을 반영하되 credential과 개인 경로는 넣지 않습니다. |
| `src/web/components/GenerationPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/run_live.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |
| `tests/helpers/generation-controller.ts` | 갱신합니다. | 자동 인수를 기본 정지한 TestApp에서 명시한 테스트 adapter 또는 사전 검증한 live 후보의 C-05 루프를 제어합니다. |

**인터페이스와 입력 조건**

evaluateClaudeEvidence(report) -> {actualGenerationVerified:boolean,isolationVerified:boolean,eligibleForProduct:boolean,limitations:string[]}를 src/runtime/claude-verification-status.ts에 정의합니다. report는 CLI/옵션 확인·정책 사전조건·실제 호출·실제 제한 관찰·fixture 계약·recovery 범위를 별도 필드로 가집니다. 테스트 helper의 evidenceFixture(overrides) 기본값은 모든 실제 항목 NotRun이며 프로파일을 활성화하지 않습니다.

scripts/verify-claude.mjs는 로컬 설치 Vitest의 고정 live 설정만 실행하고 최종 sanitized JSON 결과를 .planrepo/test-runs/<서버발급 testRunId>/results/claude-verification.json에 씁니다. testRunId는 외부 임의 경로가 아니며 앱 DB를 복사하지 않습니다. raw stdout/stderr·prompt·credential·host UUID·ownership token은 보고서에 넣지 않습니다. 실제 가상 초안은 의도한 격리 테스트 DB 결과로만 보존합니다.

live 설정은 일반 npm test/설치 hook에서 제외합니다. 테스트 함수 timeout은 각 승인 300초 생성과 후속 정리/검증에 충분한 외부 한도이며 제품 timeout을 늘리지 않습니다. Vitest retry와 provider 자동 재호출은 끕니다. quota/auth/network 실패는 실패/미실행이며 test adapter 성공으로 대체하지 않습니다.

첫 실제 검증 전 현재 CLI version·필수 옵션·고정 도구/hook 제어·strict empty MCP를 확인합니다. 기존 PATH·HOME·인증과 Bedrock 라우팅 환경을 보존하고 `global.anthropic.claude-opus-4-8`을 사용합니다. 전체 MDM·전역 문맥의 부재를 입증하지 못한 사실만으로 승인된 가상 호출을 막지 않습니다. 관찰된 자동 명령·managed MCP 충돌 또는 고정 profile을 적용할 수 없는 구체적 실패는 호출 전에 거절합니다. 이 기준은 `claude-execution-decision.md`와 최신 사용자 지시를 따릅니다. 실제 검증 전 일반 제품 eligibility를 켜지 않으며, 후보 검증 진입점은 HTTP/API에서 접근할 수 없습니다.

NQ-20/AC-17 전체 중 B-02는 질문·사람 답변·후속 문서·사람 적용의 초기 증거입니다. G1/G2/Handoff 완료는 B-05로 남깁니다. same-boot crash NQ-21 미통과는 실제 생성 성공과 무관하게 보고서 limitations에 유지합니다.

CG-12의 generation-controller에 startLiveCandidate(candidate)를 추가합니다. candidate는 CG-13의 비생성 사전 검사를 통과한 비공개 결과이며 임의 JSON이나 passed 플래그로 만들 수 없습니다. verify:claude의 명시 live 테스트만 이를 전달하고 실제 C-05 루프를 켭니다. 일반 TestApp은 manual/paused를 유지하며 제품 eligibility는 실제 검증 결과 전에는 바꾸지 않습니다. stop/close는 소유 실행 종료와 증거 보존 계약을 따릅니다.

- [x] **Step 085: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { evaluateClaudeEvidence } from '@/src/runtime/claude-verification-status';
import { evidenceFixture } from '@/tests/helpers/claude-evidence';

it('does not activate real Claude from installation and mock evidence alone', () => {
  const report = evidenceFixture({
    cliProbe: 'Passed', optionProbe: 'Passed', fixtureContract: 'Passed',
    policyPreflight: 'Passed', actualGeneration: 'NotRun',
    actualIsolation: 'NotRun', sameBootRecovery: 'KnownUnsupported'
  });
  const status = evaluateClaudeEvidence(report);
  expect(status).toMatchObject({
    actualGenerationVerified: false,
    isolationVerified: false,
    eligibleForProduct: false
  });
  expect(status.limitations).toContain('NQ21_SAME_BOOT_IDENTITY_UNAVAILABLE');
});
```

- [x] **Step 086: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/unit/claude-readiness.test.ts -t "does not activate real Claude"
```

예상 결과는 다음과 같습니다. 설치 확인/fixture 통과만으로 실제 연결을 활성화하거나 same-boot 복구 미지원 표시를 지우는 구현에서 assertion이 실패해야 합니다.

- [ ] **Step 087: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

실제 검증은 계획 승인 범위의 가상 자료만 사용하고 package 설치/기본 테스트에서 자동 실행하지 않습니다. 현재 PATH의 Claude·version·help를 다시 확인하되 옵션이나 모델 ID를 추측하지 않습니다. 인증 정보 출력·quota/billing/auth/global settings 변경·새 로그인/설치는 하지 않습니다.

현재 고정 profile에 구체적인 충돌이나 필수 옵션 실패가 있으면 정제한 실패와 비AI 사용 가능을 기록하고 모델을 호출하지 않습니다. 전역 문맥의 검증 한계는 limitations에 따로 남기며 실제 생성 성공이나 전체 격리 성공으로 바꾸지 않습니다. profile 검증 전에 제품 eligibility를 true로 두는 순환 우회를 만들지 않습니다. 실제 검증 목적의 제한 진입점으로 승인된 가상 후보를 검증하며 모든 제한 인자는 동일합니다.

createTestApp(DEMO-4,testRunId)의 editable SR을 선택해 M-032 질문 생성, M-033 결과/실제 표시 확인, EDITOR의 M-018로 사람 선택 적용, M-008 가상 담당자의 명시 답변 저장, 현재 답변 버전을 포함한 새 M-032 문서 생성, M-018 적용, M-016 조회로 새 불변 버전과 provenance를 확인합니다. 질문 답변/적용은 테스트가 사람 행동을 명시 실행하는 것이며 모델이 자동 승인하지 않습니다.

가상 canary는 같은 testRunId 내부의 다른 SR·허용 밖 테스트 파일·진단 전용 비밀 문자열로 제한합니다. 위험 도구/파일/승인 지시 입력에 대해 tools/MCP/session/customization/managed 근거와 실제 관찰을 함께 확인합니다. canary 무변화만으로 no-spawn/격리를 증명하지 않습니다. 원 사용자 파일·credential에 접근하도록 유도하지 않습니다.

실제 제한 생성 중 M-033/기존 M-016 조회와 취소 M-034를 검사합니다. 취소 확정·signal 시각·direct child/pipe close·정리 범위·M-050을 각각 기록합니다. 이미 완료되어 취소 실행 사례를 얻지 못하면 skipped/not-observed로 남기며 의도적으로 무한 추가 호출하지 않습니다. 실제 종료를 확인하지 못하면 slot과 한계가 남습니다.

같은 provider 계약의 test adapter를 선택한 새 Run도 동일 적용/현재 입력 거절 규칙을 통과시킵니다. 기존 Claude Run 선택·실제 모델 표시·기존 문서/게이트는 설정 변경만으로 바꾸지 않습니다. 사람 적용 뒤 입력을 변경해 stale 적용 거절을 양쪽 경로에서 확인합니다.

정제 보고서에 CLI/profile 버전·사전조건 근거의 관련 지문·실제/fixture 구분·요청/확인된 model·작업 종류·입력/결과 참조·명령/exit code·지연·terminal/종료·시나리오별 Passed/Failed/NotRun/KnownUnsupported를 기록합니다. raw 결과나 허위 actualModelId를 넣지 않습니다. 실패/정책 변경 때 profile eligibility를 유지하지 않습니다.

NQ-21 same-boot known limitation과 실제 reboot 미검증은 별도로 남깁니다. B-02에서 실제 초기 흐름이 실패하면 AC-17 성공을 선언하지 않고 원인·환경 조정 필요사항을 구체적으로 보고합니다. 별도 사용자 결정이 필요한 인증/전역설정 변경을 자동 수행하지 않습니다.

- [ ] **Step 088: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/unit/claude-readiness.test.ts
npm run verify:claude
npm run test:e2e -- tests/e2e/bundles/run_live.spec.ts
```

통과 조건은 다음과 같습니다. 첫 명령은 증거 판정 단위 테스트 GREEN입니다. 둘째 명령은 명시 실제 실행이며 옵션/정책/인증/모델 조건과 가상 생성·제한 검증이 실제로 통과한 항목만 Passed입니다. 미실행/실패/known limitation이 있으면 모두 통과한 것처럼 exit 0이나 전체 완료로 보고하지 않습니다. same-boot NQ-21 known limitation은 별도 미통과로 유지합니다.

- [ ] **Step 089: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 090: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

실제 Claude 질문·답변 반영 후속 문서의 초기 증거 또는 구체적 실패/미실행 근거가 있습니다. 실패/미실행이면 실제 연결 완료 checkbox를 체크하지 않습니다.

지원 eligibility는 실제 증거에 근거하며 fixture 성공과 구분됩니다.

G1/G2/Handoff 전체 AC-17·B-06 최종 스토리와 NQ-21 한계의 미완료를 보존합니다.

이 묶음의 화면과 tests/e2e/bundles/run_live.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-16 질문 해결·결정 전환·재결정·후속 범위의 불변 처리 이력

**구현 묶음**: B-03입니다. **선행**: CG-07, CG-09입니다.

**연결 기준**: M-008, M-009, M-010, M-011, M-012, M-013, M-014, M-047, US-004, US-005, US-006, US-007, US-008, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-18, ENT-21, ENT-22, ENT-34, ENT-35, SCN-02, SCN-03, SCN-04, SCN-09, SCN-10, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-18, ND-01, ND-02, ND-03, ND-07, INF-02, INF-04, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/application/question-decision-service.ts` | 갱신합니다. | M-009/M-011/M-013/M-014를 추가하고 EDITOR의 답변·후속 질문·결정 확정에 전파 규칙을 연결합니다. |
| `src/domain/question-decision-policy.ts` | 생성합니다. | 답변·해결·전환·지정 결정권자·범위 변경의 순수 조건을 판정합니다. |
| `src/persistence/question-decision-repository.ts` | 갱신합니다. | 질문 결과·답변·결정·분류의 새 버전과 현재 포인터를 원자적으로 저장합니다. |
| `src/domain/review-impact.ts` | 갱신합니다. | 질문·결정·범위 변경의 G1/G2 영향과 해결 확인 최신성을 판정합니다. |
| `tests/integration/question-decision.test.ts` | 생성합니다. | 특정 답변 해결·새 답변·중복 전환·확정 권한·범위 우회를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | S-03의 버전·권한·거절 계약을 정리합니다. |
| `src/web/components/QuestionPanel.tsx` | 갱신합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/DecisionPanel.tsx` | 갱신합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/ScopeClassificationForm.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/question.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. EDITOR가 M-008/M-010/M-012의 기본 경로를 제공하며 이 task는 해결·전환·재결정·분류와 상호작용을 완성합니다. answeredQuestionSnapshotRef는 답변 전 질문 정의, selectedAnswerRef는 결과가 채택한 답변입니다. 해결 확인은 정확한 답변/근거/반영 문서 또는 noDocumentChangeReason에 고정합니다. US-007/US-008 최종 완료는 B-06입니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 091: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('새 답변은 과거 해결 확인을 재사용하지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    let now = await currentCase(app.db, c.key);
    const q = now.question;
    const base = { actorId: q.assigneeId, projectId: c.projectId, srId: c.srId };
    const answer = await app.invoke('M-008', { ...base, requestId: 'answer-1',
      idempotencyKey: 'answer-1', guard: { resource: { target: { kind: 'question', projectId: c.projectId, srId: c.srId, entityId: q.questionId }, expectedRevision: q.revision } } }, {
      questionId: q.questionId, answeredQuestionSnapshotRef: q.currentResult.ref,
      answer: { kind: 'free_text', text: '결제 후 7일 이내 취소합니다.' },
      evidence: { text: '가상 정책 확인입니다.' }
    });
    expect(answer.ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect(now.question.status).toBe('answered');
    const resolved = await app.invoke('M-009', { ...base, actorId: c.ownerId,
      requestId: 'resolve-1', idempotencyKey: 'resolve-1',
      guard: { resource: { target: { kind: 'question', projectId: c.projectId, srId: c.srId, entityId: q.questionId }, expectedRevision: now.question.revision } } }, {
      questionId: q.questionId, selectedAnswerRef: now.question.currentResult.selectedAnswer!.ref,
      resolutionEvidence: { text: '현재 요구사항과 일치함을 확인했습니다.' },
      documentDisposition: { kind: 'not_required', reason: '현재 요구사항에 동일한 취소 기한이 있습니다.' }
    });
    expect(resolved.ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect(now.question.status).toBe('resolved');
    const changed = await app.invoke('M-008', { ...base, requestId: 'answer-2',
      idempotencyKey: 'answer-2', guard: { resource: { target: { kind: 'question', projectId: c.projectId, srId: c.srId, entityId: q.questionId }, expectedRevision: now.question.revision } } }, {
      questionId: q.questionId, answeredQuestionSnapshotRef: now.question.currentResult.ref,
      answer: { kind: 'free_text', text: '결제 후 3일 이내 취소합니다.' },
      evidence: { text: '변경된 가상 정책입니다.' }
    });
    expect(changed.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).question.status).toBe('answered');
  } finally {
    await app.close();
  }
});
```

- [x] **Step 092: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/question-decision.test.ts
```

예상 결과는 다음과 같습니다. 새 답변 저장 뒤 기존 resolved 포인터나 확인을 유지하는 구현에서 마지막 answered 단언이 실패합니다. 첫 답변·해결 성공 단언으로 준비 실패를 구분합니다.

실제 최초 RED는 같은 HTTP·SQLite에서 M008 첫 답변과 answered 단언을 통과한 뒤 미구현 M009의 resolved.ok가 false여서 실패했습니다. `npm test -- tests/integration/question-decision.test.ts`는 exit 1이며 테스트 1개가 실패했습니다. import나 fixture 오류가 아닙니다. 해결 연결 뒤 새 답변의 과거 해결 재사용 방지도 같은 시나리오에서 검증합니다.

- [x] **Step 093: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

각 명령에서 현재 배정과 기대 revision을 확인한 뒤 답변/질문 결과/분류/결정의 불변 버전을 추가합니다. M-011은 UNIQUE(projectId,srId,originQuestionId)로 공식 결정을 하나만 만들고 질문 상태를 converted_to_decision으로 고정합니다. 전환된 질문의 M-008/M-009는 거절하며 GateAssessment는 연결 결정만 한 번 집계합니다. M-012/M-013은 현재 decisionMakerId만 허용하고 이전 결정 버전·분류를 보존합니다. M-014의 followup은 None·이유·담당자·재검토 시점과 필요한 범위 결정/요구사항 개정 refs를 요구합니다. G1 내용 변화는 종속 G2까지, G2 전용 변화는 G2만 ReviewImpact로 같은 tx에 확정합니다.

- [x] **Step 094: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/question-decision.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/question.spec.ts
```

통과 조건은 다음과 같습니다. SCN-02~04의 답변/해결 분리, 특정 답변 최신성, 동시 두 전환, 전환 뒤 재답변 금지, 미확정 결정 단일 차단, 비지정 확정 거절과 범위 축소 순서가 통과합니다.

- [x] **Step 095: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 096: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-004~006의 서비스 기준을 검증하고 US-007/008의 기본 경로와 B-06 재검토 입력을 제공합니다. 질문·결정·분류·게이트·활동·receipt 중 한 쓰기 실패가 전체 rollback되는 증거를 기록합니다.

이 묶음의 화면과 tests/e2e/bundles/question.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-17 팀 정책 버전과 문서 없는 최초 검토자 배정

**구현 묶음**: B-03입니다. **선행**: CG-06, CG-09입니다.

**연결 기준**: M-029, M-030, M-031, M-003, M-027, M-047, US-029, US-030, ENT-01, ENT-02, ENT-03, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-34, ENT-35, SCN-06, SCN-12, SCN-13, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, ND-01, ND-02, ND-03, ND-04, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/review-policy-service.ts` | 생성합니다. | M-029/M-030/M-031의 정책 생성·최초/변경 배정·명시 적용을 처리합니다. |
| `src/domain/review-policy.ts` | 생성합니다. | 지정 전원·담당자 외 동료·필수 역할/체크리스트를 유지합니다. |
| `src/persistence/review-policy-repository.ts` | 생성합니다. | 정책·배정 불변 버전과 SR 게이트 현재 참조를 저장합니다. |
| `src/application/review-bundle-snapshot.ts` | 생성합니다. | M-030/M-031과 뒤 DG1의 M-020이 공유할 현재 자료의 불변 묶음 캡처를 준비합니다. 별도 공개 메서드를 만들지 않습니다. |
| `tests/integration/review-policy.test.ts` | 생성합니다. | 최초 배정·정책 비소급·특정 SR 명시 적용·옛 요청 교체를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | S-06의 ProjectScope/SrScope와 준비 결과를 정리합니다. |
| `src/web/components/TeamPolicyEditor.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/SRReviewAssignment.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/policy.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. M-029는 관리자 ProjectScope이고 새 기본 정책이 기존 SR의 policyRef를 바꾸지 않습니다. M-030은 최초 배정 시 문서/BundleRef를 요구하지 않습니다. M-031의 ReviewBundleView는 준비에 따라 BundleAvailable/NeedsInputs를 구분합니다. requireAllAssigned/requireDistinctPeer 완화는 거절합니다. US-030 전체 완료는 B-06입니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 097: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('문서 없는 SR에 최초 검토자를 배정해도 가짜 묶음을 만들지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const project = { actorId: c.ownerId, projectId: c.projectId,
      requestId: 'new-unprepared', idempotencyKey: 'new-unprepared' };
    const registered = await app.invoke('M-003', project, { key: 'TEST-ASSIGN-1', title: '최초 배정',
      purpose: '문서 전 배정을 검사합니다.', description: '아직 문서가 없습니다.', ownerId: c.ownerId });
    if (!registered.ok) throw new Error('테스트 SR을 등록하지 못했습니다.');
    const sr = registered.value;
    const unprepared = { projectId: c.projectId, srId: sr.scope.srId };
    const result = await app.invoke('M-030', { actorId: c.personaIds['P-05'], projectId: c.projectId,
      srId: sr.scope.srId, requestId: 'assign-first', idempotencyKey: 'assign-first',
      guard: currentGateGuard(app.db, unprepared, 'G1') }, {
      gate: 'G1', reviewerIds: [c.ownerId, c.personaIds['P-03']]
    });
    expect(result.ok).toBe(true);
    expect(app.db.prepare('SELECT count(*) AS n FROM review_assignment_versions WHERE project_id = ? AND sr_id = ? AND gate = ?')
      .get(c.projectId, sr.scope.srId, 'G1')).toEqual({ n: 1 });
    expect(app.db.prepare('SELECT count(*) AS n FROM review_bundles WHERE project_id = ? AND sr_id = ?')
      .get(c.projectId, sr.scope.srId)).toEqual({ n: 0 });
  } finally {
    await app.close();
  }
});
```

- [x] **Step 098: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/review-policy.test.ts
```

예상 결과는 다음과 같습니다. 최초 배정에 문서/묶음을 강제해 result.ok가 false이거나 실제 문서 없는 ReviewBundle을 생성해 count=0이 실패합니다.

- [x] **Step 099: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

policy/assignment 버전과 게이트의 현재 참조를 분리합니다. 새 정책 생성은 프로젝트 기본 참조만 갱신하고 SR policyRef는 M-031에서만 바꿉니다. 배정/명시 정책 적용은 해당 gate epoch를 새로 만들고 과거 Approval을 새 epoch로 복사하지 않습니다. 현재 자료가 충분하면 새 묶음·요청을 만들고 부족하면 배정·미준비 사유만 저장합니다. 현재 ReviewRequest만 교체하되 과거 이력과 모든 미해결 ChangeRequest·원 요청자를 보존합니다. 역할 겸임을 금지하지 않으며 전환 시 담당자 외 동료 조건을 별도로 계산합니다. 현재 자료의 불변 묶음 캡처는 shared review-bundle-snapshot 내부 함수로 먼저 준비하고 G1의 M-020에서 재사용합니다. POLICY를 미구현 M-020 호출에 의존시키지 않아 DAG 순환을 피합니다.

- [x] **Step 100: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/review-policy.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/policy.spec.ts
```

통과 조건은 다음과 같습니다. 문서 없는 최초 배정, 빈 검토자/담당자만의 통과를 막는 순수 자격 판정, 정책 비소급과 특정 SR 적용, 미해결 요청·원 요청자 보존이 통과합니다. 제거된 검토자의 M-021 HTTP 거절은 CG-18에서, 원 요청자의 M-025 확인은 CG-19에서 해당 메서드 구현 뒤 검증합니다.

- [x] **Step 101: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [x] **Step 102: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-029 전체 서비스 동작과 US-030 선행 배정 경로를 구현합니다. 정책/배정 변경이 G1/G2/현재 요청/활동/receipt와 원자적으로 반영되는 검증을 기록합니다.

이 묶음의 화면과 tests/e2e/bundles/policy.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-18 G1 불변 묶음·개별 승인·현재 조건 재검사와 단계 전환

**구현 묶음**: B-03입니다. **선행**: CG-09, CG-16, CG-17입니다.

**연결 기준**: M-020, M-021, M-027, M-028, M-047, US-014, US-015, US-019, ENT-03, ENT-04, ENT-06, ENT-08, ENT-12, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-24, ENT-34, ENT-35, SCN-05, SCN-06, SCN-09, SCN-12, SCN-14, SCN-23, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, ND-01, ND-02, ND-03, ND-05, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/review-workflow-service.ts` | 생성합니다. | M-020/M-021/M-027/M-028의 G1 요청·개별 승인·평가·전환을 연결합니다. |
| `src/domain/gate-assessment.ts` | 생성합니다. | GP-01~09의 G1 조건과 사유·담당자·대상을 순수 계산합니다. |
| `src/domain/review-state.ts` | 생성합니다. | 조회로 쓰지 않는 검토 상태와 validity/needsNewBundle을 구분합니다. |
| `src/application/review-bundle-snapshot.ts` | 갱신합니다. | DPOLICY에서 준비한 공통 캡처를 재사용해 공식 검토 요청을 고정합니다. |
| `src/persistence/review-repository.ts` | 생성합니다. | 묶음·요청·승인·현재 게이트·통과 이력·receipt를 원자적으로 저장합니다. |
| `tests/integration/g1-review.test.ts` | 생성합니다. | 지정 전원 승인·미해결 질문·오래된 묶음·중복 전환을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | G1의 개별 승인과 게이트 전환·현재 receipt 재검사 계약을 정리합니다. |
| `src/web/components/ReviewSummary.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/ReviewRequestForm.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/BundleReviewForm.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/GateConditionPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/g1.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. PAY-102의 대표 시작 fixture는 검토 가능한 요구사항·정책·검토자(담당자와 다른 동료 포함)가 있고 G1 필수 질문이 남아 있도록 manifest에 고정합니다. 미확정 결정은 unconfirmedDecisionSnapshots에 고정하고 개별 승인에 GP 전체를 적용하지 않습니다. approval guard는 현재 BundleRef/epoch이며 무관한 SR revision 증가로 다른 검토자의 승인을 거절하지 않습니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 103: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('지정 전원 개별 승인은 남지만 미해결 G1 질문이 전환을 막습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('PAY-102');
    const requestInput = await currentReviewInput(app.db, c.key, 'G1');
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    expect((await app.invoke('M-020', { ...scope, requestId: 'g1-request',
      idempotencyKey: 'g1-request', guard: currentGateGuard(app.db, c, 'G1') }, requestInput)).ok).toBe(true);
    const now = await currentCase(app.db, c.key);
    const bundle = now.gates.G1.currentBundle;
    const approvals = await Promise.all(bundle.reviewerIds.map((actorId: string, index: number) =>
      app.invoke('M-021', { ...scope, actorId, requestId: 'g1-approve-' + index,
        idempotencyKey: 'g1-approve-' + index, guard: { expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, {
        bundleRef: bundle.ref, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G1', checklistResults: bundle.checklist.map(item => ({
          itemId: item.itemId, checked: true
        }))
      })));
    expect(approvals.every(result => result.ok)).toBe(true);
    const fresh = await currentCase(app.db, c.key);
    expect(fresh.sr.progressStage).toBe('requirements');
    const transition = await app.invoke('M-028', { ...scope, requestId: 'g1-pass',
      idempotencyKey: 'g1-pass', guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: fresh.sr.revision }, expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, {
      toStage: 'planning', reason: 'G1 검토 조건을 확인했습니다.', gate: 'G1', bundleRef: bundle.ref
    });
    expect(transition).toMatchObject({ ok: false, error: { code: 'GATE_BLOCKED' } });
    expect((await currentCase(app.db, c.key)).sr.progressStage).toBe('requirements');
  } finally {
    await app.close();
  }
});
```

- [x] **Step 104: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/g1-review.test.ts
```

예상 결과는 다음과 같습니다. 필수 질문 때문에 개별 승인 자체를 거절하거나 전원 승인만으로 planning으로 전환하는 구현에서 단언이 실패합니다. 실제 지정된 모든 검토자의 승인을 사용합니다.

- [ ] **Step 105: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-020은 고정 가능한 현재 refs·정책·배정·reviewEpoch를 검증해 불변 bundle과 reviewer별 요청을 만들며 동일 기준 재요청은 같은 현재 기준을 재사용합니다. M-021은 현재 지정·체크리스트·BundleRef/epoch만 검증해 UNIQUE(SrScope,gate,bundle,version,approver)를 저장합니다. M-027은 읽기 snapshot에서 GP를 계산할 뿐 활동·검토 시작을 쓰지 않습니다. M-028은 tx 안에서 현재 owner/guard/bundle/GP를 다시 계산한 뒤 ReviewGateState.valid와 GateTransitionRecord·progressStage·활동·receipt를 함께 확정합니다. G1 변경은 종속 G2를 invalid/not_passed로 만들며 옛 G2 pass를 자동 복원하지 않습니다.

- [ ] **Step 106: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/g1-review.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/g1.spec.ts
```

통과 조건은 다음과 같습니다. 미해결 질문 속 개별 승인, 빈 전원 승인 방지, G2 필수 문제만 남은 G1 통과, stale bundle/제거된 reviewer 거절, 전환 경쟁·재생·쓰기 장애와 순수 조회가 통과합니다.

CG-17에서 배정을 제거한 검토자의 옛 M-021 승인 명령이 현재 자격 검사로 거절되는 실제 HTTP 통합 검증도 포함합니다.

- [ ] **Step 107: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 108: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-014/015/019의 모든 서비스 조건을 검증합니다. UI 원문 비교·체크리스트 표시와 전체 공통 기준은 담당 UI task와 함께 완료하며 서비스 테스트만으로 화면 기준을 완료 처리하지 않습니다.

이 묶음의 화면과 tests/e2e/bundles/g1.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-19 댓글·수정 반영·현재 버전 확인과 모든 미해결 요청 승계

**구현 묶음**: B-03입니다. **선행**: CG-09, CG-17, CG-18입니다.

**연결 기준**: M-022, M-023, M-024, M-025, M-026, M-015, M-030, M-027, M-047, US-016, US-017, US-018, US-026, ENT-08, ENT-17, ENT-18, ENT-19, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-34, ENT-35, SCN-07, SCN-08, SCN-11, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, ND-01, ND-02, ND-03, ND-05, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/review-workflow-service.ts` | 갱신합니다. | M-022~026의 댓글·요청·반영·해결 확인·추가 수정을 구현합니다. |
| `src/persistence/change-request-repository.ts` | 생성합니다. | 원 요청·현재 대상·불변 처리 이벤트와 삭제 섹션 승계를 저장합니다. |
| `src/domain/change-resolution.ts` | 생성합니다. | 원 요청자 OR 현재 검토자와 현재 반영 버전 일치를 판정합니다. |
| `src/domain/review-impact.ts` | 갱신합니다. | 차단 요청과 일반 댓글/비차단 요청의 영향을 구분합니다. |
| `tests/integration/change-request.test.ts` | 생성합니다. | 배정에서 빠진 원 요청자·오래된 반영·차단/비차단 승계를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 수정 요청 상태·확인 권한·현재 반영 refs를 정리합니다. |
| `src/web/components/SectionDiscussion.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/change.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. currentCase/currentReviewInput은 승인 fixture와 현재 DB의 조회만으로 typed 입력을 만들며 업무 상태를 직접 바꾸지 않습니다. wire 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED 코드만으로 전체 기준을 대체하지 않으며 지금 실행한 코드가 아닙니다. AUTH-331 fixture의 현재 반영 확인 대기 요청은 실제 최신 ArtifactVersion과 currentApplicationEventRef를 가리키도록 검증합니다. 이 시작 상태는 M-025의 RED를 독립 실행하기 위한 자료이며 M-023/M-024 자체의 통과 증거가 아닙니다. 이 task에서 두 메서드의 실제 작성 흐름도 별도 검사합니다. US-026 통합 완료는 B-06입니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [x] **Step 109: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('검토자에서 제외된 원 요청자도 현재 반영 결과를 확인할 수 있습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('AUTH-331');
    let now = await currentCase(app.db, c.key);
    const change = now.awaitingChange;
    expect(change.status).toBe('awaiting_confirmation');
    const scope = { actorId: c.personaIds['P-05'], projectId: c.projectId, srId: c.srId };
    const reviewers = now.gates.G2.reviewerIds.filter(id => id !== change.requesterId);
    expect((await app.invoke('M-030', { ...scope, requestId: 'remove-requester',
      idempotencyKey: 'remove-requester', guard: currentGateGuard(app.db, c, 'G2') }, {
      gate: 'G2', reviewerIds: reviewers,
      previousAssignmentRef: now.gates.G2.assignmentRef, changeReason: '검토 배정을 변경합니다.'
    })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect(now.gates.G2.reviewerIds).not.toContain(change.requesterId);
    const currentChange = now.changes.find(item => item.changeRequestId === change.changeRequestId);
    if (!currentChange) throw new Error('현재 수정 요청이 없습니다.');
    const confirmed = await app.invoke('M-025', { ...scope, actorId: change.requesterId,
      requestId: 'confirm-current', idempotencyKey: 'confirm-current',
      guard: { resource: { target: { kind: 'change_request', projectId: c.projectId, srId: c.srId, entityId: currentChange.changeRequestId }, expectedRevision: currentChange.revision } } }, {
      changeRequestId: change.changeRequestId,
      applicationEventRef: currentChange.currentApplicationEventRef,
      appliedArtifactVersionRef: currentChange.appliedArtifactVersionRef,
      result: { kind: 'resolved', verification: '현재 반영 버전에서 요청한 수정을 확인했습니다.' }
    });
    expect(confirmed.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).changes.find(item =>
      item.changeRequestId === change.changeRequestId)?.status).toBe('resolved');
  } finally {
    await app.close();
  }
});
```

- [x] **Step 110: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/change-request.test.ts
```

예상 결과는 다음과 같습니다. 현재 검토자 여부만 확인하여 원 요청자의 M-025를 거절하는 구현에서 confirmed.ok가 실패합니다.

- [ ] **Step 111: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-022 일반 댓글은 원 버전/섹션에 추가하고 gate epoch를 유지합니다. M-023은 blocking/affectedGate/원 요청자/담당자를 고정하고 영향받는 기준만 무효화합니다. M-024는 정확한 현재 반영 ArtifactVersion과 이벤트를 저장해 awaiting_confirmation으로 두며 blocking을 해제하지 않습니다. M-025는 requesterId==actorId OR currentReviewerIds.has(actorId), currentApplicationEventRef 일치, 현재 반영 VersionRef 일치를 모두 검증합니다. 반영자 겸임은 별도 거절 사유가 아닙니다. M-026은 피드백과 open 전이를 기록합니다. 문서/묶음 교체 때 모든 unresolved 요청의 ID/requester/blocking을 보존하고 삭제 섹션은 missing_section으로 승계합니다.

- [ ] **Step 112: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/change-request.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/change.spec.ts
```

통과 조건은 다음과 같습니다. 직접 작성·반영·확인·추가 수정, 원 요청자 자격, 현재 reviewer 자격, 무자격 반영자 거절, 오래된 application/문서 확인 거절, 차단/비차단 요청의 섹션 삭제 승계, 일반 댓글의 승인 보존이 통과합니다.

CG-17에서 검토자 배정이 제거된 원 요청자가 M-025로 자기 수정 요청의 현재 반영본을 확인할 수 있는 실제 HTTP 경로를 검증합니다.

- [ ] **Step 113: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 114: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-016~018의 실제 서비스 경로와 미해결 요청 보존을 검증합니다. G1/G2 상태·요청 승계·반영 이벤트·활동·receipt 실패 주입과 중복 재생도 통과시킵니다.

이 묶음의 화면과 tests/e2e/bundles/change.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-20 진행 계획·설계·구현 계획과 정확한 G1을 고정하는 G2

**구현 묶음**: B-04입니다. **선행**: CG-09, CG-17, CG-18, CG-19입니다.

**연결 기준**: M-015, M-016, M-017, M-020, M-021, M-027, M-028, M-047, US-020, US-021, US-022, US-023, US-025, ENT-03, ENT-07, ENT-08, ENT-09, ENT-12, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-24, ENT-34, ENT-35, SCN-05, SCN-09, SCN-10, SCN-12, SCN-14, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-17, ND-01, ND-02, ND-03, ND-05, INF-02, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/application/artifact-service.ts` | 갱신합니다. | M-017의 WorkflowPlanVersion을 ArtifactVersion과 같은 버전으로 저장합니다. |
| `src/domain/workflow-plan-policy.ts` | 생성합니다. | 필수 단계/문서와 요구사항·작업·검증·회귀·순서 연결을 검사합니다. |
| `src/application/review-workflow-service.ts` | 갱신합니다. | M-020/M-021/M-027/M-028에 G2와 현재 유효 G1 고정을 적용합니다. |
| `src/domain/gate-assessment.ts` | 갱신합니다. | G2 GP-01~09와 정확한 상위 G1 참조를 판정합니다. |
| `src/persistence/artifact-repository.ts` | 갱신합니다. | 진행 계획의 1:1 구조와 불변 문서 버전·참조를 저장합니다. |
| `tests/integration/g2-workflow.test.ts` | 생성합니다. | G2 전용 변경·G1 고정·필수 자료 누락·ready 전환 경쟁을 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | M-017과 G2 검토/통과의 조건·오류·참조를 추가합니다. |
| `src/web/components/WorkflowPlanEditor.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/g2.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. helper는 fixture의 제한된 ID·검증된 문서 입력과 현재 저장 상태를 읽기만 합니다. 모든 실제 변경·승인·전환은 아래 M 메서드로 호출하며 helper가 성공 상태를 DB에 주입하지 않습니다. DTO 필드 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED는 구현 시 실행할 코드이며 현재 실행 결과가 아닙니다. NOTI-028은 승인 DEMO-4의 ready·유효 G1/G2 상태를 사용합니다. implementationPlanEdit는 같은 논리 문서의 유효한 후속 버전 입력으로 requirement/task/section ID를 보존합니다. WorkflowPlanVersion은 workflow_plan ArtifactVersion과 1:1이며 별도 current 포인터를 만들지 않습니다. 별도 테스트 전략 문서를 항상 요구하지 않습니다. US-025 전체 통합은 B-06에 남깁니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [ ] **Step 115: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('G2 전용 구현 계획 변경은 G1을 보존하고 옛 G2 승인을 거절합니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('NOTI-028');
    const before = await currentCase(app.db, c.key);
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    const oldG1 = before.gates.G1.currentBundle.ref;
    const oldG2 = before.gates.G2.currentBundle.ref;
    const saved = await app.invoke('M-015', { ...scope, requestId: 'g2-plan-edit',
      idempotencyKey: 'g2-plan-edit', guard: { resource: { target: { kind: 'artifact', projectId: c.projectId, srId: c.srId, entityId: before.implementationPlan.versionRef.entityId }, expectedRevision: before.implementationPlan.revision } } }, currentArtifactEdit(app.db, c, 'implementation_plan'));
    expect(saved.ok).toBe(true);
    const after = await currentCase(app.db, c.key);
    expect(after.gates.G1.validity).toBe('valid');
    expect(after.gates.G1.currentBundle.ref).toEqual(oldG1);
    expect(after.gates.G2.validity).toBe('invalid');
    expect(after.gates.G2.needsNewBundle).toBe(true);
    expect(after.sr.progressStage).toBe('planning');
    const oldApproval = await app.invoke('M-021', { ...scope,
      actorId: before.gates.G2.reviewerIds[0], requestId: 'old-g2-approval',
      idempotencyKey: 'old-g2-approval', guard: { expectedBundleRef: oldG2, expectedReviewEpoch: before.gates.G2.currentBundle.reviewEpoch } }, {
      bundleRef: oldG2, reviewEpoch: before.gates.G2.currentBundle.reviewEpoch,
      approvalScope: 'G2', checklistResults: before.gates.G2.currentBundle.checklist.map(item =>
        ({ itemId: item.itemId, checked: true }))
    });
    expect(oldApproval).toMatchObject({ ok: false, error: { code: 'STALE_BUNDLE' } });
    const request = await app.invoke('M-020', { ...scope,
      requestId: 'new-g2', idempotencyKey: 'new-g2', guard: currentGateGuard(app.db, c, 'G2') },
      await currentReviewInput(app.db, c.key, 'G2'));
    expect(request.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).gates.G2.currentBundle.g1BundleRef).toEqual(oldG1);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 116: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/g2-workflow.test.ts
```

예상 결과는 다음과 같습니다. G2 편집이 G1까지 불필요하게 무효화하거나 과거 G2 bundle/승인을 현재로 받아들이는 구현에서 validity·STALE_BUNDLE 단언이 실패합니다.

- [ ] **Step 117: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

M-017은 workflowVersion v1.0.1, implementationUnitCount=1, 실행/생략 이유, 선택 설계 refs와 요구사항/작업/검증/회귀 연결을 검증해 ArtifactVersion과 WorkflowPlanVersion을 같은 tx에 추가합니다. G2 bundle 생성 시 현재 G1.valid 및 정확한 lastPass/bundle ref를 고정합니다. G2 전환은 현재 G1·G2 필수 질문/결정·차단 요청·필수 문서·배정 전원과 체크리스트를 tx 안에서 다시 검사합니다. G2 전용 변경은 G1을 유지하며 이미 requirements로 돌아간 SR을 planning으로 밀어내지 않습니다. 새 G1을 통과해도 이전 G2 pass를 valid로 복원하지 않습니다.

- [ ] **Step 118: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/g2-workflow.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/g2.spec.ts
```

통과 조건은 다음과 같습니다. 선택 설계 누락, 필수 단계/문서 생략, 구현 단위 수 위반, 작업/요구사항/검증 연결 누락, 무효 G1, 확인 대기 차단, stale bundle, 반복 G2 통과와 입력 변경 경쟁이 모두 통과합니다.

- [ ] **Step 119: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 120: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-020~023의 서비스 기준을 검증하고 승인된 plan/design/implementation_plan을 같은 G2 기준으로 연결합니다. 실제 전환·활동·receipt의 원자성, G1 변경 뒤 새 G2 재검토, G2 전용 변경의 범위를 확인합니다.

이 묶음의 화면과 tests/e2e/bundles/g2.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-21 불변 Handoff 생성·미리보기·현재용 내보내기와 receipt 재검사

**구현 묶음**: B-05입니다. **선행**: CG-05, CG-09, CG-15, CG-20입니다.

**연결 기준**: M-040, M-041, M-042, M-015, M-047, US-031, ENT-08, ENT-09, ENT-12, ENT-14, ENT-15, ENT-18, ENT-20, ENT-21, ENT-22, ENT-32, ENT-34, ENT-35, SCN-14, SCN-18, SCN-20, SCN-21, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-17, NQ-20, NQ-22, ND-01, ND-02, ND-03, ND-05, ND-12, ND-14, INF-02, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/handoff-implementation-service.ts` | 생성합니다. | M-040/M-041/M-042의 현재 기준 검사와 고정 결과를 조정합니다. |
| `src/presentation/handoff-serializer.ts` | 생성합니다. | 명시된 불변 snapshot만으로 Markdown·UTF-8 bytes·digest를 만듭니다. |
| `src/persistence/handoff-repository.ts` | 생성합니다. | 고정 Handoff·정확한 G1/G2·승인/문서 refs와 receipt를 함께 저장합니다. |
| `tests/integration/handoff-current-export.test.ts` | 생성합니다. | 고정 bytes·무효 후 내보내기/receipt 거절·생성 경쟁을 검사합니다. |
| `tests/contract/handoff-serialization.test.ts` | 생성합니다. | 8 MiB 경계·한글·비밀 canary와 원문 일치를 검사합니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | S-08 생성/미리보기/현재용 내보내기와 과거 이력 구분을 정리합니다. |
| `aidlc-docs/construction/planrepo/code/repository-summary.md` | 갱신합니다. | 고정 bytes와 불변 refs의 저장 책임을 추가합니다. |
| `src/web/components/HandoffPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/handoff.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |
| `tests/live/claude-handoff.test.ts` | 생성합니다. | 실제 Claude 질문·답변·후속 생성·사람 적용·G1/G2·Handoff의 AC-17 전체 흐름입니다. |
| `vitest.claude-handoff.config.ts` | 생성합니다. | 실제 Handoff 수용 테스트만 명시 실행하며 자동 retry를 하지 않습니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. helper는 fixture의 제한된 ID·검증된 문서 입력과 현재 저장 상태를 읽기만 합니다. 모든 실제 변경·승인·전환은 아래 M 메서드로 호출하며 helper가 성공 상태를 DB에 주입하지 않습니다. DTO 필드 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED는 구현 시 실행할 코드이며 현재 실행 결과가 아닙니다. HandoffRequest는 정확한 g2BundleRef이며 서버가 그 묶음의 g1BundleRef와 승인/문서/질문/결정/후속 범위/검증 내용을 고정합니다. preview의 markdownSnapshot과 export bytes는 동일합니다. M-042 같은 key 재생도 현재 게이트/기준을 먼저 확인하며 무효이면 priorReceipt와 현재 거절을 구분합니다. 실제 Claude AC-17은 별도 B-05 통합 실행 증거가 필요합니다.

비AI 인계 구현은 독립적으로 진행할 수 있습니다. 실제 AC-17 검증과 이 과제의 전체 완료는 CG-15의 실제 후보 검증 증거를 선행 조건으로 삼으며, 그 증거가 없으면 해당 검증과 완료 체크박스를 미완료로 둡니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [ ] **Step 121: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('한 번 성공한 export key도 게이트 무효 후에는 현재용 다운로드를 허용하지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('NOTI-028');
    let now = await currentCase(app.db, c.key);
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    expect((await app.invoke('M-040', { ...scope, requestId: 'handoff-create',
      idempotencyKey: 'handoff-create', guard: { expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { g2BundleRef: now.gates.G2.currentBundle.ref })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const handoff = now.latestHandoff;
    const preview = await app.invoke('M-041', scope, handoff.handoffRef.entityId);
    const exportScope = { ...scope, requestId: 'export-1', idempotencyKey: 'export-1',
      guard: { expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } };
    const first = await app.invoke('M-042', exportScope, handoff.handoffRef.entityId);
    expect(first).toMatchObject({ ok: true, disposition: 'Committed' });
    expect((await app.invoke('M-015', { ...scope, requestId: 'invalidate-export',
      idempotencyKey: 'invalidate-export', guard: { resource: { target: { kind: 'artifact', projectId: c.projectId, srId: c.srId, entityId: now.implementationPlan.versionRef.entityId }, expectedRevision: now.implementationPlan.revision } } }, currentArtifactEdit(app.db, c, 'implementation_plan'))).ok).toBe(true);
    const rejected = await app.invoke('M-042', { ...exportScope, requestId: 'export-2' }, handoff.handoffRef.entityId);
    expect(rejected).toMatchObject({ ok: false, error: { code: 'GATE_BLOCKED' } });
    if (!rejected.ok) expect(rejected.priorReceipt).toBeDefined();
    const past = await app.invoke('M-041', scope, handoff.handoffRef.entityId);
    expect(preview.ok && past.ok).toBe(true);
    expect((await currentCase(app.db, c.key)).handoffs.find(item =>
      item.handoffRef.entityId === handoff.handoffRef.entityId)?.markdownSnapshot).toBe(handoff.markdownSnapshot);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 122: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/handoff-current-export.test.ts
```

예상 결과는 다음과 같습니다. receipt를 먼저 무조건 성공 재생하거나 현재 포인터로 인계 본문을 다시 조합하는 구현에서 무효 export 거절 또는 고정 원문 단언이 실패합니다.

- [ ] **Step 123: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

1) 일관된 읽기로 불변 후보 refs/내용을 복사합니다. 2) tx 밖에서 필수 내용과 정확한 8 MiB 이하 Markdown/bytes/digest를 만듭니다. 3) BEGIN IMMEDIATE에서 현재 권한·같은 refs·유효 G1/G2·epoch를 다시 검사한 뒤 Handoff/활동/receipt를 저장합니다. M-042는 현재 유효성을 확정한 시점의 고정 bytes를 반환하고 네트워크 송신/backpressure는 tx 밖에서 처리합니다. M-041은 과거 원문을 유지하면서 현재 유효성을 따로 반환합니다. 다른 요청의 성공을 새 전환이나 새 유효 인계로 재사용하지 않습니다.

실제 AC-17 통합은 tests/live/claude-handoff.test.ts가 RUN_LIVE의 검증된 후보와 가상 입력을 사용합니다. M-032 질문 생성, M-018 사람 적용, M-008 답변, 현재 답변을 넣은 후속 문서 생성·적용, M-009 해결·M-012 결정, G1/G2의 현재 묶음별 사람 검토/승인/전환, M-040/M-041/M-042 인계까지 실제 서비스로 연결합니다. 초기 승인 fixture나 test adapter로 누락된 전환을 대신하지 않습니다. 부족한 모델 결과는 실패·미실행 근거로 남기고 무제한 재호출하지 않습니다.

- [ ] **Step 124: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/handoff-current-export.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/handoff.spec.ts
npm exec -- vitest run --config vitest.claude-handoff.config.ts tests/live/claude-handoff.test.ts
```

통과 조건은 다음과 같습니다. 고정 원문/bytes/digest, 8 MiB 정확 경계·초과 거절, 같은 생성/내보내기 동시 재생, 후보 읽기 뒤 기준 변경, 과거 미리보기 보존, invalid 후 receipt 우회 거절·canary 비노출이 통과합니다.

- [ ] **Step 125: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 126: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-031 C1~C4의 서비스·직렬화 기준을 통과합니다. C5/AC-17/SCN-18은 실제 Claude의 질문·사람 답변·후속 생성·적용·G1/G2·Handoff 통합을 별도 실행한 뒤에만 완료합니다. 테스트 adapter 성공으로 대체하지 않습니다.

이 묶음의 화면과 tests/e2e/bundles/handoff.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-22 Handoff별 수동 외부 시작·완료와 과거 활동 조회

**구현 묶음**: B-05입니다. **선행**: CG-19, CG-20, CG-21입니다.

**연결 기준**: M-043, M-044, M-048, M-040, M-041, M-015, M-020, M-021, M-028, M-047, US-032, US-033, US-034, ENT-03, ENT-18, ENT-20, ENT-21, ENT-22, ENT-32, ENT-33, ENT-34, ENT-35, SCN-09, SCN-10, SCN-14, SCN-21, SCN-22, SCN-23, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-22, ND-01, ND-02, ND-03, ND-05, ND-14, INF-02, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/application/handoff-implementation-service.ts` | 갱신합니다. | M-043/M-044의 선택한 인계별 수동 사실과 현재 SR 단계를 조정합니다. |
| `src/persistence/implementation-repository.ts` | 생성합니다. | Handoff별 0..1 ImplementationRecord와 불변 활동 참조를 보존합니다. |
| `src/application/workspace-query-service.ts` | 갱신합니다. | M-048의 범위·버전·행위자·시각과 과거 기준을 일관되게 조회합니다. |
| `src/persistence/activity-repository.ts` | 생성합니다. | 추가 전용 활동과 안정된 페이지 정렬을 제공합니다. |
| `tests/integration/implementation-handoff-history.test.ts` | 생성합니다. | H1/H2 분리·재검토 중 사실 보존·수동 근거·조회 무쓰기 검증입니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 외부 사실의 수동 표시·현재 기준·과거 조회·중복 계약을 정리합니다. |
| `src/web/components/ExternalImplementationPanel.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `src/web/components/ActivityHistory.tsx` | 생성합니다. | 이 묶음에서 실제 서비스·현재 권한·guard·오류를 UI에 연결합니다. B-06은 이 화면의 상호작용을 확대 검증합니다. |
| `tests/e2e/bundles/external.spec.ts` | 생성합니다. | 같은 묶음의 실제 서버·DB·브라우저 경로와 주요 키보드 행동을 검증합니다. |

**인터페이스와 입력 조건**

scope는 actorId/projectId/srId와 요청별 requestId/idempotencyKey/guard를 사용합니다. helper는 fixture의 제한된 ID·검증된 문서 입력과 현재 저장 상태를 읽기만 합니다. 모든 실제 변경·승인·전환은 아래 M 메서드로 호출하며 helper가 성공 상태를 DB에 주입하지 않습니다. DTO 필드 이름은 CONTRACT에서 ENT/M의 의미에 맞춰 고정합니다. 대표 RED는 구현 시 실행할 코드이며 현재 실행 결과가 아닙니다. Handoff당 ImplementationRecord는 최대 하나이며 started/completed를 사용합니다. M-043은 ready 및 현재 유효 Handoff에서만 현재 구현 시작을 선택합니다. M-044는 이미 시작한 그 ImplementationRecord의 summary/evidence를 요구합니다. 오래된 H1 사실 기록은 허용하지만 다른 활성 H2나 현재 SR을 완료하지 않습니다. 아래 준비 과정은 모두 공개 메서드를 사용합니다.


대표 테스트의 helper는 구현할 읽기 전용 fixture입니다. 기존 currentCase(app.db, c.key)를 실제 DTO와 저장 조회로 확장합니다. currentGateGuard(app.db, scope, gate)는 그 gate의 RevisionGuard<review_gate_state>를 읽고, currentArtifactEdit(app.db, c, kind)는 현재 문서의 targetBasis·구조를 유지한 typed 수정 입력을 만듭니다. helper는 업무 상태를 직접 쓰지 않습니다. 아래 예제는 아직 실행한 검증이 아니며 각 과제에서 실제 테스트를 작성하고 RED를 확인합니다.

- [ ] **Step 127: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp } from '@/tests/helpers/test-app';
import { demoCase, currentCase, currentReviewInput, currentGateGuard, currentArtifactEdit } from '@/tests/helpers/domain-cases';

it('새 H2가 실행 중이면 옛 H1 완료는 H2와 현재 SR을 완료시키지 않습니다', async () => {
  const app = await createTestApp({ fixture: 'DEMO-4', testRunId: randomUUID() });
  try {
    const c = demoCase('NOTI-028');
    const scope = { actorId: c.ownerId, projectId: c.projectId, srId: c.srId };
    let now = await currentCase(app.db, c.key);
    expect((await app.invoke('M-040', { ...scope, requestId: 'h1', idempotencyKey: 'h1',
      guard: { expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { g2BundleRef: now.gates.G2.currentBundle.ref })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const h1 = now.latestHandoff;
    expect((await app.invoke('M-043', { ...scope, requestId: 'start-h1', idempotencyKey: 'start-h1',
      guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: now.sr.revision }, expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { handoffId: h1.handoffRef.entityId })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    expect((await app.invoke('M-015', { ...scope, requestId: 'revise-plan',
      idempotencyKey: 'revise-plan', guard: { resource: { target: { kind: 'artifact', projectId: c.projectId, srId: c.srId, entityId: now.implementationPlan.versionRef.entityId }, expectedRevision: now.implementationPlan.revision } } },
      currentArtifactEdit(app.db, c, 'implementation_plan'))).ok).toBe(true);
    expect((await app.invoke('M-020', { ...scope, requestId: 'review-h2',
      idempotencyKey: 'review-h2', guard: currentGateGuard(app.db, c, 'G2') }, await currentReviewInput(app.db, c.key, 'G2'))).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const bundle = now.gates.G2.currentBundle;
    for (const actorId of bundle.reviewerIds) {
      expect((await app.invoke('M-021', { ...scope, actorId, requestId: 'approve-h2-' + actorId,
        idempotencyKey: 'approve-h2-' + actorId, guard: { expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, {
        bundleRef: bundle.ref, reviewEpoch: bundle.reviewEpoch, approvalScope: 'G2', checklistResults: bundle.checklist.map(item => ({ itemId: item.itemId, checked: true }))
      })).ok).toBe(true);
    }
    now = await currentCase(app.db, c.key);
    expect((await app.invoke('M-028', { ...scope, requestId: 'ready-h2', idempotencyKey: 'ready-h2',
      guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: now.sr.revision }, expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } },
      { toStage: 'ready', reason: 'G2 검토 조건을 확인했습니다.', gate: 'G2', bundleRef: bundle.ref })).ok).toBe(true);
    expect((await app.invoke('M-040', { ...scope, requestId: 'h2', idempotencyKey: 'h2',
      guard: { expectedBundleRef: bundle.ref, expectedReviewEpoch: bundle.reviewEpoch } }, { g2BundleRef: bundle.ref })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const h2 = now.latestHandoff;
    expect(h2.handoffRef.entityId).not.toBe(h1.handoffRef.entityId);
    expect((await app.invoke('M-043', { ...scope, requestId: 'start-h2', idempotencyKey: 'start-h2',
      guard: { resource: { target: { kind: 'sr', projectId: c.projectId, srId: c.srId, entityId: c.srId }, expectedRevision: now.sr.revision }, expectedBundleRef: now.gates.G2.currentBundle.ref, expectedReviewEpoch: now.gates.G2.currentBundle.reviewEpoch } },
      { handoffId: h2.handoffRef.entityId })).ok).toBe(true);
    now = await currentCase(app.db, c.key);
    const oldImplementation = now.implementations.find(item => item.handoffRef.entityId === h1.handoffRef.entityId);
    if (!oldImplementation) throw new Error('H1 시작 기록이 없습니다.');
    expect((await app.invoke('M-044', { ...scope, requestId: 'complete-h1', idempotencyKey: 'complete-h1',
      guard: { resource: { target: { kind: 'implementation', projectId: c.projectId, srId: c.srId, entityId: oldImplementation.implementationId }, expectedRevision: oldImplementation.revision } } }, {
      implementationId: oldImplementation.implementationId,
      completionSummary: '옛 인계의 구현을 마쳤습니다.', evidence: [{ kind: 'verification', label: '가상 검증', value: '테스트에서 가상 구현 완료를 확인했습니다.' }]
    })).ok).toBe(true);
    const after = await currentCase(app.db, c.key);
    expect(after.sr.progressStage).toBe('implementing');
    expect(after.implementations.find(item => item.handoffRef.entityId === h2.handoffRef.entityId)?.status).toBe('started');
    expect(after.implementations.find(item => item.handoffRef.entityId === h1.handoffRef.entityId)?.status).toBe('completed');
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 128: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm test -- tests/integration/implementation-handoff-history.test.ts
```

예상 결과는 다음과 같습니다. SR에 외부 완료 상태 하나만 저장하거나 H1 완료를 활성 H2에 복사하는 구현에서 H2.started 또는 현재 SR.implementing 단언이 실패합니다.

- [ ] **Step 129: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

UNIQUE(SrScope,handoffRef)로 시작 기록을 한 번만 만들고 현재 SR activeImplementationRef는 명시 M-043에서 선택합니다. 완료는 전달된 implementationId와 같은 handoffRef·현재 owner·기대 revision·요약·근거를 확인합니다. 선택한 기록만 completed로 갱신한 뒤 그 인계가 현재 활성 기준이며 G1/G2와 정확히 일치할 때만 SR.completed로 전환합니다. 재검토 중이거나 H2가 활성 기준이면 SR 단계·gate 유효성을 그대로 둡니다. M-048은 같은 read snapshot의 과거 refs·수동 사실·시각을 페이지로 반환하며 일반 조회로 새 활동을 쓰지 않습니다.

- [ ] **Step 130: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm test -- tests/integration/implementation-handoff-history.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/bundles/external.spec.ts
```

통과 조건은 다음과 같습니다. H1 재검토 중 완료, H2 시작 뒤 H1 완료, 중복 시작/완료 receipt, 완료 요약/근거 누락, 무효 과거 인계의 신규 시작 거절, 과거 미리보기/활동 보존과 조회 전후 write count 불변이 통과합니다.

- [ ] **Step 131: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 132: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-032~034의 실제 시작·완료·과거 조회를 검증합니다. GitHub Mock/링크를 자동 동기화·외부 테스트/배포 검증으로 표현하지 않습니다. 모든 완료와 활동·receipt는 원자적으로 저장하며 과거 사실을 현재 승인으로 복원하지 않습니다.

이 묶음의 화면과 tests/e2e/bundles/external.spec.ts도 연결합니다. 서비스 테스트만으로 해당 스토리의 UI 기준을 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-23 팀 보드·내 검토함과 실제 처리 대상 이동을 마무리합니다.

**구현 묶음**: B-06입니다. **선행**: CG-08, CG-18, CG-20, CG-21입니다.

**연결 기준**: M-045, M-046, M-047, M-048, US-027, US-028, ENT-02, ENT-03, ENT-10, ENT-13, ENT-17, ENT-18, ENT-19, ENT-21, ENT-24, ENT-32, ENT-33, ENT-34, SCN-12, SCN-13, SCN-22, SCN-23, SCN-24, NQ-01, NQ-02, NQ-03, NQ-10, NQ-12, NQ-13, ND-03, ND-04, ND-05, ND-06, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/contracts/views.ts` | 갱신합니다. | 실제 조회가 화면에 필요한 내용·참조·현재성을 구체 타입으로 반환하게 보완합니다. |
| `tests/contract/public-methods.test.ts` | 갱신합니다. | 확장한 정상 조회 타입과 기존 공개 메서드 계약을 검사합니다. |
| `src/web/components/TeamBoard.tsx` | 갱신합니다. | UI-02의 검색·필터·카드·다음 행동을 마무리합니다. |
| `src/web/components/PersonalInbox.tsx` | 생성합니다. | UI-03의 현재 배정·정렬·처리 대상 이동을 마무리합니다. |
| `src/web/components/SRList.tsx` | 갱신합니다. | UI-04의 목록과 검색·필터 기준을 보드와 맞춥니다. |
| `src/web/components/SRDetailShell.tsx` | 갱신합니다. | UI-06의 기본 검토 요약과 대상별 패널 이동을 연결합니다. |
| `src/web/components/ActivityHistory.tsx` | 갱신합니다. | UI-25의 현재·과거 기준과 행위자를 표시합니다. |
| `tests/e2e/ui/board-inbox.spec.ts` | 생성합니다. | US-027·US-028의 각 기준과 읽기 무변경·정렬을 검증합니다. |
| `src/application/workspace-query-service.ts` | 갱신합니다. | M-045/M-046/M-047/M-048의 일관된 조회와 정렬·필터를 완성합니다. |
| `src/persistence/workspace-read-model.ts` | 생성합니다. | 서버의 단일 읽기 snapshot에서 보드·검토함·상세를 계산합니다. |

**인터페이스와 입력 조건**

최종 스토리 책임은 US-027 C1~C6과 US-028 C1~C4의 10개 기준입니다. 최종 컴포넌트 확인 책임은 UI-02·UI-03·UI-04·UI-06·UI-25입니다. US-034의 완료 책임은 B-05에 유지하고 이력 화면 연동만 다시 확인합니다.

M-045·M-046·M-047·M-048의 서버 조회를 표시합니다. 읽기만으로 검토 중 상태·활동·묶음·배정을 저장하지 않습니다. 보드 카드의 진행 단계·검토 상태·차단 이유·담당자·현재 G1/G2·외부 사실을 별개 값으로 표시합니다.

내 검토함은 현재 배정과 승인된 정렬 규칙을 따릅니다. 항목 선택은 질문·결정·묶음·수정 요청의 실제 처리 위치로 이동합니다. 배정 제거 뒤 낡은 탭과 직접 요청은 서버의 현재 권한 검사에 따릅니다.

DEMO-4의 단계별 가상 상태는 최초 화면 시작 조건입니다. 배정 변경 후 inbox 교체·처리 후 갱신의 검증은 실제 M-030/M-031 등 명령으로 수행합니다. seed의 상태를 이 명령의 성공 증거로 세지 않습니다.

같은 actor/SR의 재조회도 UI_BASE의 새 순번을 발급합니다. 변경 성공 뒤 관련 상세·게이트·보드·내 검토함·활동을 다시 읽습니다. 갱신 실패 때 오래된 표시임을 알려 주고 최신으로 가장하지 않습니다.

- [ ] **Step 133: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { test, expect } from '@/tests/e2e/fixtures/test-app';

test('보드의 차단 항목에서 해당 SR 검토 요약으로 이동한다', async ({ page, manifest }) => {
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByRole('link', { name: '팀 보드', exact: true }).click();
  await page.getByLabel('SR 검색').fill('PAY-102');
  const card = page.getByTestId('team-board-sr-card').filter({ hasText: 'PAY-102' });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('team-board-blocker-summary')).not.toHaveText('');
  await card.getByRole('link', { name: '검토 요약 보기' }).click();
  await expect(page.getByRole('tab', { name: '검토 요약', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sr-detail-shell-sr-key')).toHaveText('PAY-102');
});
```

- [ ] **Step 134: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/board-inbox.spec.ts --project=chromium --workers=1
```

예상 결과는 다음과 같습니다. DEMO-4 조회는 준비되지만 카드의 차단 정보·링크 또는 실제 대상 이동 기대가 실패합니다. 기존 선행 화면이 있으면 아직 누락된 정렬·배정 변경 사례가 RED가 됩니다.

- [ ] **Step 135: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

보드와 목록은 같은 검색·필터 DTO를 만들고 서버가 반환한 기준·카드를 사용합니다. 키/제목 검색과 담당자·검토 필요·차단 필터를 명확한 label로 제공합니다. 카드에 상태별 텍스트와 실제 처리 대상 링크를 둡니다.

내 검토함 항목을 targetRef로 상세 화면의 해당 패널·문서 버전·섹션에 연결합니다. URL이나 화면 state에 담긴 actor·scope를 현재 서버 권한의 대체로 사용하지 않습니다.

상세 화면은 M-047 한 view를 기준으로 탭을 조립합니다. 버전·BundleRef·HandoffRef를 서로 바꿔 쓰지 않습니다. 활동 화면은 과거 참조를 조회하되 현재 유효성 배지를 따로 표시합니다.

5개의 actor context에서 같은 DB의 배정 변경을 관찰합니다. 이전 배정자의 새 inbox 결과에는 제거된 처리가 없어야 하며 이전 열린 폼의 직접 요청은 거절되어야 합니다. 조회 전후 ENT-34·ENT-35와 업무 revision이 불필요하게 증가하지 않았는지 실제 DB에서 검사합니다.

- [ ] **Step 136: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/board-inbox.spec.ts --project=chromium --workers=1
```

통과 조건은 다음과 같습니다. US-027의 6개·US-028의 4개 기준 및 읽기 무변경·현재 배정·정렬·Q2/Q1 경계가 통과합니다. 10초 사람 탐색 목표는 이 자동 통과로 대체하지 않습니다.

- [ ] **Step 137: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 138: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-027:C1~C6·US-028:C1~C4를 개별 테스트 증거와 연결합니다.

UI-02·UI-03·UI-04·UI-06·UI-25의 링크가 실제 저장된 대상에 도달합니다.

현재/과거 상태와 갱신 실패를 분리하고 5 context의 actor·SR 혼합이 없음을 확인합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-24 결정·범위·배정 변경과 재검토 화면을 통합합니다.

**구현 묶음**: B-06입니다. **선행**: CG-08, CG-18, CG-20, CG-21, CG-23입니다.

**연결 기준**: M-008, M-009, M-010, M-011, M-012, M-013, M-014, M-017, M-020, M-021, M-022, M-023, M-024, M-025, M-026, M-027, M-028, M-029, M-030, M-031, M-040, M-041, M-042, M-043, M-044, M-045, M-046, M-047, M-048, US-007, US-008, US-024, US-025, US-026, US-030, ENT-03, ENT-07, ENT-08, ENT-09, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-32, ENT-33, ENT-34, ENT-35, SCN-03, SCN-04, SCN-05, SCN-06, SCN-07, SCN-08, SCN-09, SCN-10, SCN-11, SCN-12, SCN-13, SCN-21, SCN-22, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-12, NQ-13, ND-01, ND-02, ND-03, ND-04, ND-05, ND-06, INF-04, INF-05, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/web/components/ReviewSummary.tsx` | 갱신합니다. | UI-07의 범위·변경점·문제·게이트 요약을 연결합니다. |
| `src/web/components/QuestionPanel.tsx` | 갱신합니다. | UI-09의 답변·해결·전환과 필요 시점 표시를 마무리합니다. |
| `src/web/components/DecisionPanel.tsx` | 갱신합니다. | UI-10의 지정 결정·이유·재결정 이력을 연결합니다. |
| `src/web/components/ScopeClassificationForm.tsx` | 갱신합니다. | UI-11의 G1/G2·후속 분류와 근거를 연결합니다. |
| `src/web/components/WorkflowPlanEditor.tsx` | 갱신합니다. | UI-13의 실행·생략 이유와 관련 계획 연결을 마무리합니다. |
| `src/web/components/ReviewRequestForm.tsx` | 갱신합니다. | UI-15의 고정 묶음 기준과 검토 요청을 표시합니다. |
| `src/web/components/BundleReviewForm.tsx` | 갱신합니다. | UI-16의 현재 묶음 확인·개별 승인·체크리스트 초기화를 연결합니다. |
| `src/web/components/SectionDiscussion.tsx` | 갱신합니다. | UI-17의 반영 제출·해결 확인·이어진 요청을 분리합니다. |
| `src/web/components/GateConditionPanel.tsx` | 갱신합니다. | UI-18의 현재 조건·차단 대상·명시적 전환을 연결합니다. |
| `src/web/components/TeamPolicyEditor.tsx` | 갱신합니다. | UI-21의 정책 버전과 기존 SR 비소급을 표시합니다. |
| `src/web/components/SRReviewAssignment.tsx` | 갱신합니다. | UI-22의 최초 배정·변경·정책 명시 적용을 연결합니다. |
| `src/web/components/HandoffPanel.tsx` | 갱신합니다. | UI-23의 현재·과거 인계와 재검토 뒤 내보내기 거절을 마무리합니다. |
| `src/web/components/ExternalImplementationPanel.tsx` | 갱신합니다. | UI-24의 H1/H2별 외부 수동 기록을 분리합니다. |
| `tests/e2e/fixtures/review-journeys.ts` | 생성합니다. | 승인된 실제 메서드로 검토·변경 시작 조건을 만듭니다. |
| `tests/e2e/ui/review-impact.spec.ts` | 생성합니다. | 재결정·분류·G1/G2 변경·승계·배정을 검증합니다. |

**인터페이스와 입력 조건**

최종 스토리 책임은 US-007 C1~C3, US-008 C1~C3, US-024 C1~C4, US-025 C1~C4, US-026 C1~C3, US-030 C1~C4의 21개 기준입니다. UI-07·UI-09·UI-10·UI-11·UI-13·UI-15·UI-16·UI-17·UI-18·UI-21·UI-22·UI-23·UI-24의 최종 화면 확인을 맡습니다. 기존 G1/G2/Handoff 스토리의 최종 책임을 옮기지 않습니다.

prepareReviewJourney(app,'gates-passed')는 seed를 통과 결과로 취급하지 않고 담당자·결정권자·필수 검토자별 실제 M-008~M-031 명령을 실행해 현재 G1/G2가 유효한 사례를 반환하는 테스트 helper입니다. 반환값은 {projectId,srId,srKey,ownerId,reviewerIds,documentRefs,bundleRefs,handoffRefs}이며 결과마다 ok·현재 기준을 검사합니다.

질문 답변·해결 확인·결정 전환·결정 확정·개별 승인·게이트 전환은 별개 명령입니다. 전환된 질문의 원답변·해결 수정은 거절하고 조회·후속 질문을 허용합니다. 현재 지정 결정권자만 확정·재결정합니다.

범위 축소는 결정 이유·요구사항과 완료 기준 변경·새 묶음 검토를 함께 보여 줍니다. 단순 후속 분류만으로 차단을 우회하지 않습니다. 첫 배정은 문서나 공식 묶음이 없어도 가능하고 새 정책은 명시 적용한 SR에만 반영합니다.

G1 변경은 G1/G2와 현재 인계의 유효성에 영향을 주고 가장 앞선 필요한 단계로 되돌립니다. G2 전용 변경은 유효 G1을 유지합니다. 이미 더 앞선 재검토 단계이면 뒤 단계로 올리지 않습니다. 일반 댓글·비차단 문제를 새 차단 정책으로 확대하지 않습니다.

반영 제출은 해결 확인이 아닙니다. 미해결·확인 대기 요청은 섹션 삭제·새 버전·새 묶음 뒤에도 원/현재 대상을 구분해 이어집니다. 원 요청자의 확인 권리와 현재 지정 검토자 권리를 승인 규칙대로 표시합니다.

Handoff는 고정본 미리보기와 현재 구현용 export 검사를 분리합니다. H1 외부 완료를 H2나 현재 SR 완료로 표시하지 않습니다. 오래된 receipt는 현재 게이트·인계의 유효성 증거가 아닙니다.

- [ ] **Step 139: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { test, expect } from '@/tests/e2e/fixtures/test-app';
import { prepareReviewJourney } from '@/tests/e2e/fixtures/review-journeys';

test('G1 변경 뒤 기존 승인과 현재 재검토 필요를 함께 보여 준다', async ({ page, app }) => {
  const journey = await prepareReviewJourney(app, 'gates-passed');
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(journey.ownerId);
  await page.getByLabel('SR 검색').fill(journey.srKey);
  await page.getByTestId('team-board-sr-card').filter({ hasText: journey.srKey }).getByRole('link', { name: '검토 요약 보기' }).click();
  await page.getByRole('tab', { name: '요구사항', exact: true }).click();
  await page.getByLabel('문서 본문').fill('# 변경한 요구사항\n\n새 예외 조건을 포함합니다.');
  await page.getByLabel('변경 이유').fill('확정된 업무 결정 반영');
  await page.getByRole('button', { name: '문서 저장', exact: true }).click();
  await page.getByRole('tab', { name: '검토 요약', exact: true }).click();
  await expect(page.getByTestId('gate-condition-panel-g1-status')).toHaveText('재검토 필요');
  await expect(page.getByTestId('gate-condition-panel-g2-status')).toHaveText('재검토 필요');
  await expect(page.getByTestId('sr-detail-shell-stage')).toHaveText('요구사항 구체화');
});
```

- [ ] **Step 140: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/review-impact.spec.ts --project=chromium --workers=1
```

예상 결과는 다음과 같습니다. 실제 G1/G2 통과 시작 조건은 성공하고 아직 연결하지 않은 재검토 상태·변경 이유·담당자 표시 또는 배정 교체 기대에서 실패합니다. helper 생성 실패를 행동 RED로 세지 않습니다.

- [ ] **Step 141: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

현재 SRDetailView와 GateAssessment를 ReviewSummary·GateConditionPanel에 전달합니다. 과거 Approval의 존재와 현재 게이트 통과를 각각 표시하고 승인 폼은 actor+BundleRef 단위로 checklist를 보관합니다. 새 묶음이 오면 기존 확인 체크를 이월하지 않습니다.

DecisionPanel과 ScopeClassificationForm은 현재 버전 guard를 제출합니다. 지정 결정권자가 아닌 actor에게 허용 행동을 표시하지 않으며 direct request의 서버 거절도 같은 사유로 보여 줍니다.

배정·정책 저장 뒤 현재 SR·보드·해당 actor의 inbox를 갱신합니다. 미지정 첫 묶음은 문서가 없어도 배정 편집을 열고, 새 정책 버전 저장과 기존 SR 적용을 별도 행동으로 제공합니다.

수정 요청마다 originalTarget/currentTarget과 제출·확인 상태를 보여 줍니다. 삭제된 섹션의 미해결 요청은 현재 미해결 목록에서 계속 처리하게 합니다. 변경 후 원자적으로 확정된 서버 결과를 새 조회 기준으로 읽고 UI에서 독자적으로 게이트를 계산하지 않습니다.

H1/H2의 고정 미리보기·현재 사용 가능성·외부 사실을 handoffId별로 유지합니다. 오래된 export 거절은 과거 본문을 지우지 않고 새 인계가 필요한 이유를 표시합니다.

- [ ] **Step 142: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/review-impact.spec.ts --project=chromium --workers=1
```

통과 조건은 다음과 같습니다. 6개 최종 스토리의 21개 기준과 G1/G2 변경·이어진 요청·정책 비소급·현재 권한·H1/H2 표시가 통과합니다. 관련 실제 DB 결과와 화면 결과가 일치합니다.

- [ ] **Step 143: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 144: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-007·US-008·US-024·US-025·US-026·US-030의 모든 개별 기준과 지정 SC를 연결합니다.

13개 UI의 실제 메서드·현재 권한·고정 버전 참조를 확인합니다.

새 묶음 체크리스트 초기화와 STALE_BUNDLE 입력 보존을 브라우저에서 확인합니다.

G1/G2/Handoff의 기존 완료 증거를 보존하고 재검토 상호작용 증거만 추가합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-25 생성 작업·초안 적용·문서 비교의 사용자 경계를 완성합니다.

**구현 묶음**: B-06입니다. **선행**: CG-08, CG-15, CG-18, CG-20, CG-21, CG-23입니다.

**연결 기준**: M-015, M-016, M-018, M-019, M-032, M-033, M-034, M-035, M-047, US-009, US-010, US-011, US-012, US-013, ENT-07, ENT-08, ENT-10, ENT-11, ENT-12, ENT-18, ENT-20, ENT-21, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, ENT-34, ENT-35, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-19, SCN-20, SCN-24, NQ-07, NQ-08, NQ-11, NQ-12, NQ-14, NQ-15, NQ-16, NQ-17, NQ-18, NQ-19, NQ-20, NQ-21, NQ-22, NQ-23, ND-02, ND-06, ND-07, ND-08, ND-09, ND-10, ND-11, ND-12, ND-13, INF-03, INF-05, INF-06, INF-07, INF-08, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `src/web/components/ArtifactWorkspace.tsx` | 갱신합니다. | UI-12의 문서 원문·저장·실패 입력 보존을 마무리합니다. |
| `src/web/components/VersionComparison.tsx` | 갱신합니다. | UI-14의 두 고정 버전과 의미 단위 변경을 표시합니다. |
| `src/web/components/GenerationPanel.tsx` | 갱신합니다. | UI-19의 요청·상태·실패·취소·재시도 정보를 분리합니다. |
| `src/web/components/DraftReview.tsx` | 갱신합니다. | UI-20의 초안·현재 입력·오래됨·사람 반영·1회 적용을 표시합니다. |
| `tests/e2e/fixtures/generation-control.ts` | 생성합니다. | 테스트 구성의 provider 제어와 유효한 가상 출력 fixture만 연결합니다. |
| `tests/e2e/ui/generation-draft.spec.ts` | 생성합니다. | US-009~US-013의 23개 기준과 긴 생성 중 검토를 검증합니다. |
| `tests/e2e/ui/document-conflict.spec.ts` | 생성합니다. | 실제 오래된 버전 저장 충돌과 저장 실패를 별도로 검증합니다. |

**인터페이스와 입력 조건**

최종 책임은 US-009 C1~C4·US-010 C1~C4·US-011 C1~C6·US-012 C1~C5·US-013 C1~C4의 23개 기준입니다. UI-12·UI-14·UI-19·UI-20의 최종 화면 확인을 맡습니다. B-02의 실제 실행·기초 편집 구현을 전제로 통합하며 B-06에서 처음 실제 Claude 위험을 발견하는 순서로 바꾸지 않습니다.

생성 상태·입력 최신성·초안 적용 여부·실제 실행 종료 관찰은 다른 값입니다. 취소가 확정돼도 종료가 미확인이면 그렇게 표시합니다. 오류를 raw stderr·인증값으로 표시하지 않습니다. 종료 미확인 슬롯 때문에 새 실행이 막혀도 비AI 문서 열람·검토는 계속됩니다.

getTestProviderControl(app)는 테스트 harness가 보유한 provider만 제어하는 helper입니다. holdNext({outputFixture})는 다음 테스트 실행을 대기시키고 {started:Promise<void>,release():void}를 반환합니다. failNext는 명시한 정제 오류·비정상 출력 사례를 준비합니다. 제품 HTTP endpoint·브라우저 전역·실제 Claude 호출을 추가하지 않습니다.

test adapter로 지연·취소·형식 오류·SR 혼합·교체를 재현합니다. 실제 Claude 생성과 제한 효과는 RUN_LIVE/B-02 및 B-05 AC-17 증거에서 받아 별도로 유지합니다. test adapter의 성공은 AC-17이나 실제 profile 통과가 아닙니다.

ProviderSelection은 생성 요청 시 고정하며 provider/model 교체에도 공통 초안·버전·승인 계약을 유지합니다. 설정 화면·두 번째 실제 provider·새 model 지원을 필수로 추가하지 않습니다.

미저장 폼은 생성 입력·공식 검토·인계 기준에 몰래 포함하지 않습니다. targetVersionRef의 absent 대상과 기존 버전은 구분합니다. 오래된 초안은 현재 기준으로 바로 적용하지 않고 재생성 또는 현재 자료와 사람의 비교 반영 경로를 제공합니다. 하나의 초안은 한 번만 적용합니다.

문서 저장 충돌은 실제 두 context의 같은 VersionRef 저장으로 검증합니다. 저장 실패는 별도 fault 주입으로 검사하고 두 경우 모두 편집 내용·기존 승인·저장본을 보존합니다. 비교는 두 고정 버전의 실제 내용을 사용합니다.

- [ ] **Step 145: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { test, expect } from '@/tests/e2e/fixtures/test-app';
import { getTestProviderControl } from '@/tests/e2e/fixtures/generation-control';

test('생성 성공을 문서 적용이나 승인으로 표시하지 않는다', async ({ page, app, manifest }) => {
  const run = getTestProviderControl(app).holdNext({ outputFixture: 'valid-requirements-draft' });
  await page.goto('/');
  await page.getByLabel('가상 사용자').selectOption(manifest.personaIds['P-01']);
  await page.getByLabel('SR 검색').fill('PAY-102');
  await page.getByTestId('team-board-sr-card').filter({ hasText: 'PAY-102' }).getByRole('link', { name: '검토 요약 보기' }).click();
  await page.getByRole('button', { name: '요구사항 초안 생성', exact: true }).click();
  await run.started;
  await expect(page.getByTestId('generation-panel-run-status')).toHaveText('진행 중');
  await page.getByRole('tab', { name: '요구사항', exact: true }).click();
  await expect(page.getByTestId('artifact-workspace-document-body')).toBeVisible();
  run.release();
  await expect(page.getByTestId('generation-panel-run-status')).toHaveText('성공');
  await expect(page.getByTestId('draft-review-application-status')).toHaveText('미적용');
  await expect(page.getByTestId('gate-condition-panel-g1-status')).not.toHaveText('통과');
});
```

- [ ] **Step 146: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/generation-draft.spec.ts --project=chromium --workers=1
```

예상 결과는 다음과 같습니다. 테스트 실행기·유효 출력은 준비되고 아직 구분하지 않은 작업/초안/승인 상태 또는 긴 생성 중 본문 이용 기대가 실패합니다.

- [ ] **Step 147: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

GenerationPanel은 M-032로 고정 저장 기준을 제출하고 M-033을 순번 보호 조회로 읽습니다. M-034 취소와 M-035 명시 재시도를 별개 버튼·결과로 표시합니다. 새 runId와 이전 runId의 이력을 이어 보여 주고 자동 재시도를 만들지 않습니다.

DraftReview는 결과 원문·고정 입력·현재 버전·오래된 이유를 보여 줍니다. 유효한 적용은 M-018을 사용합니다. 오래된 결과의 사람 반영은 M-019로 현재 기준 초안을 작성한 뒤 별도 적용합니다. AI 문자열의 승인 문구로 Approval·Gate·Stage를 만들지 않습니다.

ArtifactWorkspace는 본문·변경 이유·VersionRef를 고정해서 M-015를 제출합니다. STALE_VERSION과 일반 저장 실패의 화면을 구분하고 dirty 내용을 보존합니다. VersionComparison은 M-016의 고정 비교 결과를 C-08의 안전한 표시로 보여 줍니다.

provider 교체 테스트는 요청 직후 설정을 바꾸어 기존 Run 선택이 유지되는지 검사합니다. 다음 새 요청의 다른 test provider/model 전달과 결과 적용·공식 승인 절차 유지를 확인합니다. 브라우저에는 업무 결과와 검증된 연결 상태만 표시합니다.

한글 UTF-8 bytes 경계·출력 형식 오류·초안 과대·다른 SR 참조·timeout·취소·늦은 성공을 테스트 provider로 주입합니다. 화면은 정제 오류와 복구 경로만 보여 주고 기존 문서·승인·미저장 입력을 유지합니다.

- [ ] **Step 148: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/ui/generation-draft.spec.ts tests/e2e/ui/document-conflict.spec.ts --project=chromium --workers=1
```

통과 조건은 다음과 같습니다. 5개 스토리의 23개 기준과 긴 생성 중 읽기·검토·현재 입력 비교·1회 적용·실제 저장 충돌·정제 오류가 통과합니다. 실제 Claude 관련 기준은 별도 실행 증거가 없으면 미검증으로 남습니다.

- [ ] **Step 149: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 150: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

US-009~US-013의 23개 개별 기준과 해당 SC를 연결합니다.

4개 UI에서 작업·종료·초안·입력 최신성·승인을 분리합니다.

AC-18의 test provider 교체와 AC-19의 경계 결과를 수용 registry에 연결합니다.

AC-17과 실제 Claude profile 검증은 자동 UI 성공으로 완료 처리하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-26 5 context의 표시·키보드·성능을 검증합니다.

**구현 묶음**: B-06입니다. **선행**: CG-21, CG-23, CG-24, CG-25입니다.

**연결 기준**: M-001, M-002, M-015, M-016, M-021, M-027, M-028, M-032, M-033, M-034, M-041, M-042, M-045, M-046, M-047, M-048, ENT-02, ENT-03, ENT-07, ENT-08, ENT-10, ENT-13, ENT-17, ENT-20, ENT-21, ENT-24, ENT-27, ENT-32, ENT-34, ENT-35, SCN-12, SCN-14, SCN-16, SCN-20, SCN-23, SCN-24, NQ-01, NQ-02, NQ-03, NQ-04, NQ-10, NQ-11, NQ-12, NQ-13, NQ-14, NQ-16, NQ-17, NQ-19, NQ-21, NQ-22, NQ-23, NQ-24, ND-04, ND-05, ND-06, ND-09, ND-10, ND-11, ND-12, ND-13, ND-14, INF-01, INF-02, INF-03, INF-05, INF-06, INF-08, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `tests/e2e/quality/five-contexts.spec.ts` | 생성합니다. | 같은 DB의 5 actor context에서 권한·재조회·dirty 폼을 검사합니다. |
| `tests/e2e/quality/keyboard-display.spec.ts` | 생성합니다. | 주요 행동의 키보드·초점·이름·상태 표현·안전한 본문을 검사합니다. |
| `tests/e2e/quality/local-exposure.spec.ts` | 생성합니다. | 일반·개발 정적 노출 경계와 AI 불가 시 비AI 사용을 검사합니다. |
| `tests/performance/profile.ts` | 생성합니다. | 승인된 PERF-100 자료 수·표본·측정 환경을 고정합니다. |
| `tests/performance/api-latency.test.ts` | 생성합니다. | 실제 API 수신부터 응답 완료까지 지연과 실패를 기록합니다. |
| `tests/performance/ui-latency.spec.ts` | 생성합니다. | 실제 내용 준비까지 화면 지연을 측정합니다. |
| `tests/fixtures/perf-100.ts` | 생성합니다. | 격리 DB의 가상 부하 시작 자료를 만듭니다. |
| `tests/helpers/performance-report.ts` | 생성합니다. | 표본 원자료·p95·환경·실패 수를 정제된 결과로 작성합니다. |
| `aidlc-docs/construction/planrepo/code/usability-observation-template.md` | 생성합니다. | 실제 사람 과업·10초 기준·관찰 결과 기록 형식을 정의합니다. |
| `vitest.performance.config.ts` | 생성합니다. | PERF-100 API 성능 테스트만 수집합니다. |
| `playwright.performance.config.ts` | 생성합니다. | PERF-100 UI 표본의 브라우저 측정만 수집합니다. |
| `scripts/test-performance.ts` | 생성합니다. | 두 측정과 표본/환경/지연 보고서를 연결합니다. 실제 Claude 측정은 --provider=claude 명시 인자로만 실행합니다. |

**인터페이스와 입력 조건**

이 과제는 기존 최종 스토리 책임을 옮기지 않고 SC-04·SC-05·SC-06과 NQ-01~NQ-04·NQ-10~NQ-13의 통합 증거를 보완합니다. 접근성·안전한 표시는 앞 묶음마다 적용하며 이 단계에서는 26개 UI의 전체 경로를 확인합니다.

5 context는 1프로젝트·5가상 사용자·같은 DB이며 context별 동시 요청은 최대 1개입니다. 테스트 DB·진단·브라우저 trace는 해당 testRunId 아래에 둡니다. 타 context의 actor·SR·dirty 폼·승인 체크가 섞이지 않아야 합니다.

PERF-100은 SR100·논리 문서400·문서 버전2000·질문1000·결정500·수정 요청1000·활동20000입니다. 본문 기본20KiB, 대표 SR 현재/비교200KiB입니다. fixtures는 관찰 전 격리 테스트 DB에 하나의 준비 transaction으로 넣으며 이 자료를 실제 업무 쓰기 성공 증거로 세지 않습니다. 준비 동안 테스트 요청·생성 작업은 없습니다.

API는 endpoint별 warm-up 10회 뒤 본표본100회로 측정하고 각 context가20회를 순차 수행합니다. 읽기 p95≤500ms, 쓰기 p95≤1000ms입니다. 서버의 요청 수신부터 응답 완료까지 실제 경과를 기록하며 AI 장기 생성 시간은 제외하고 생성 접수·조회·취소는 포함합니다.

UI는 작업별 warm-up 5회 뒤 본표본20회로 측정하고 각 context가4회를 순차 수행합니다. 200KiB 대표 본문을 1440×900 및 1280×800 Chromium에서 해상도별로 표본을 따로 모아 조회·검토·비교하며 실제 내용 표시 p95≤2초입니다. 1MiB 최대 경계는 본래 기능·실측을 따로 기록하고 200KiB 결과에 섞지 않습니다.

p95는 오름차순 표본의 ceil(0.95*n)-1 인덱스 값입니다. 예상한 거절·예기치 않은 실패·timeout의 수와 시간을 정상 표본과 별도로 남깁니다. 정상 표본 수가 부족하거나 예기치 않은 실패가 있으면 성공 p95만으로 전체 통과하지 않습니다. 성능 전 fixture 수·실행 환경·동시성·측정 구간을 확인하고 미달 시 수치를 자동 완화하지 않습니다.

NQ-13은 실제 사람이 차단 SR의 이유·담당자를10초 안에 찾는 관찰과 나머지 주요 과업의 도움·완료 여부를 기록합니다. 자동 browser 소요시간이나 가상 페르소나 설명을 실제 참여자 결과로 만들지 않습니다. 관찰하지 않았으면 미검증입니다.

정상 DB 준비는 CLI 부재·profile 실패·종료 미확인과 분리됩니다. /health/ready는 비AI 준비를 표시하고 일반 문서·검토가 계속되어야 합니다. runtime·config·원본 요구·문서·테스트 결과의 정적 노출 거절은 일반·개발 모드와 /@fs·인코딩·symlink 사례에서 검사합니다.

- [ ] **Step 151: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { test, expect } from '@/tests/e2e/fixtures/test-app';
import { openPersonaContext } from '@/tests/e2e/fixtures/personas';

test('같은 DB의 다섯 화면이 서로 다른 선택 사용자를 유지한다', async ({ browser, app, manifest }) => {
  const entries = [];
  try {
    for (const persona of ['P-01', 'P-02', 'P-03', 'P-04', 'P-05'] as const) {
      entries.push(await openPersonaContext(browser, app, manifest.personaIds[persona]));
    }
    for (const [index, entry] of entries.entries()) {
      const persona = `P-0${index + 1}` as keyof typeof manifest.personaIds;
      await expect(entry.page.getByLabel('가상 사용자')).toHaveValue(manifest.personaIds[persona]);
      await entry.page.getByRole('link', { name: '내 검토함', exact: true }).click();
      await expect(entry.page.getByTestId('personal-inbox-current-actor')).toHaveAttribute('data-actor-id', manifest.personaIds[persona]);
    }
  } finally {
    await Promise.all(entries.map(entry => entry.context.close()));
  }
});
```

- [ ] **Step 152: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/quality --project=chromium --workers=1
```

예상 결과는 다음과 같습니다. 실제 5 context 준비 뒤 현재 actor 혼합·늦은 조회·키보드 누락·위험 본문 실행·정적 노출 중 새로 추가한 경계 기대가 실패합니다. 기존 기능이 이미 통과하면 확인되지 않은 경계 사례의 RED를 먼저 남깁니다.

- [ ] **Step 153: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

키보드만으로 SR 등록·질문 답변·결정·문서 저장·검토 요청·승인·수정 확인·게이트 전환·인계 내보내기에 도달합니다. label·name·visible focus·오류 필드 연결·텍스트 상태를 검사하고 모달 닫기·초점 복귀를 확인합니다. 추가 접근성 라이브러리를 필수로 도입하지 않습니다.

위험 Markdown·HTML·javascript URL·모델 출력·댓글·이력·인계 미리보기를 실제 렌더러로 표시해 실행·이벤트 핸들러·위험 링크가 없음을 확인합니다. 외부 canary 송신 시도와 비밀 canary 노출을 브라우저 요청·화면·정제 진단에서 검사합니다.

5 context의 같은 키 조회 Q2/Q1 역전과 저장 중 actor/SR 이동을 네트워크 지연 제어로 재현합니다. 실제 응답 내용을 바꾸지 않고 전달 순서만 지연합니다. 늦은 응답이 current view·dirty 입력·새 승인 체크를 덮지 않게 합니다.

PERF fixture의 건수를 DB에서 검사한 뒤 승인 표본을 수집합니다. performance-report는 rawSamples·실패·p95·환경·자료량·증거시각을 담습니다. API와 UI 구간을 분리하고 단순 스켈레톤 출현을 내용 준비 완료로 세지 않습니다.

이 과제는 현재 격리 테스트 앱에서 CLI 부재·종료 미확인 시 비AI 준비·읽기·검토를 확인합니다. 별도 경로의 소스 사본을 준비하는 독립 실행 검증은 후속 DOCS 과제가 맡습니다. 여기서 아직 없는 사본 helper를 호출하지 않습니다.

npm run test:perf는 전용 Vitest/Playwright 설정으로 API·UI 표본을 수집합니다. 일반 측정은 지연 test adapter이며 실제 Claude 중 측정은 npm run test:perf -- --provider=claude로 명시 실행한 별도 증거입니다. 환경/fixture가 다르면 결과를 합쳐 p95를 만들지 않습니다. 이 옵션은 테스트 runner 전용이며 일반 제품 API가 provider 실행 인자를 받는 통로가 아닙니다.

- [ ] **Step 154: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm run test:e2e -- tests/e2e/quality --project=chromium --workers=1
npm run test:perf
```

통과 조건은 다음과 같습니다. 5 context·안전한 표시·키보드·정적 노출·현재 격리 앱의 비AI 사용 자동 검사가 통과합니다. npm run test:perf는 별도로 실행하고 승인 표본·p95·실패 수를 기록합니다. 실제 NQ-13 관찰은 자동 테스트 결과와 따로 남습니다.

- [ ] **Step 155: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 156: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

NT-16과 SCN-12·SCN-23·SCN-24에 5 context·같은 키 Q2/Q1·dirty·키보드·안전한 표시 증거를 연결합니다.

npm run test:perf의 환경·자료 수·표본 수·조회500ms/쓰기1s/UI2s p95를 실제 값으로 남깁니다.

NQ-13 실제 사람 관찰은 미실행·실행 실패·통과를 구분합니다. 계획 단계에서는 모두 미실행입니다.

CLI 부재와 종료 미확인에서도 비AI 준비·읽기·검토가 되는지 실제 앱으로 확인합니다.

실측 미달이나 누락 표본은 완료로 표시하지 않습니다.

정상 PERF-100 DB의 앱 시작 5회를 측정해 자료 조회까지 각각10초 이하인지 확인하고 설치·빌드·최초 schema 준비 시간은 별도로 기록합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-27 실행 안내·계층 요약과 Build and Test 인계를 정리합니다.

**구현 묶음**: B-06입니다. **선행**: CG-26입니다.

**연결 기준**: M-001, M-002, M-045, M-047, ENT-01, ENT-02, ENT-03, SCN-01, SCN-24, NQ-04, NQ-20, NQ-22, NQ-23, NQ-24, ND-13, ND-14, INF-01, INF-02, INF-04, INF-05, INF-08, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `aidlc-docs/README.md` | 갱신합니다. | 현재 프로젝트만으로 준비·실행·검토·다음 단계에 도달하는 안내를 갱신합니다. |
| `aidlc-docs/construction/planrepo/code/frontend-summary.md` | 생성합니다. | 26개 UI·44개 공개 연결·상태·권한·테스트 결과를 정리합니다. |
| `aidlc-docs/construction/planrepo/code/implementation-summary.md` | 생성합니다. | 9개 모듈과 계층별 요약·현재 완료·실패·미검증을 연결합니다. |
| `aidlc-docs/construction/planrepo/code/build-test-handoff.md` | 생성합니다. | 후속 Build and Test의 입력·명령·남은 실제 검증·증거 위치를 연결합니다. |
| `tests/relocation/independent-handoff.test.ts` | 생성합니다. | 새 경로의 프로젝트 사본에서 DB 준비·DEMO-4·CLI 부재 비AI 사용을 검사합니다. |
| `tests/helpers/project-copy.ts` | 생성합니다. | 현재 프로젝트의 소스·설정·고정 manifest만 복사하고 명시 포트·격리 경로를 준비합니다. |
| `vitest.relocation.config.ts` | 생성합니다. | 독립 사본 검증만 실행하고 사본 npm test에서 재귀 실행되지 않게 분리합니다. |
| `aidlc-docs/construction/planrepo/code/business-logic-summary.md` | 생성합니다. | 순수 규칙·서비스·ReviewImpact·행동 테스트 결과 요약입니다. |
| `aidlc-docs/construction/planrepo/code/api-summary.md` | 갱신합니다. | 44개 공개/6개 내부 메서드와 HTTP·거절 결과 요약입니다. |
| `aidlc-docs/construction/planrepo/code/repository-summary.md` | 갱신합니다. | 35 ENT·migration·tx·receipt·복구 결과 요약입니다. |

**인터페이스와 입력 조건**

문서는 실제 구현·검증을 설명하는 Markdown 산출물입니다. README는 현재 있는 aidlc-docs/README.md를 갱신합니다. 앱 소스는 src·tests·scripts·config 등 프로젝트 루트 경로에 두고 aidlc-docs 아래에 실행 코드를 만들지 않습니다.

초기 실행 명령은 npm ci, npm run typecheck, npm test, npm run build 뒤 offline npm run db:migrate와 npm run seed:demo, 이후 npm start입니다. 기존 자료 재실행에는 seed를 반복하지 않습니다. npm run dev의 5173/4173·strictPort·proxy 경계를 설명합니다.

createIsolatedProjectCopy({testRunId,claude:'absent'})는 현재 프로젝트의 소스·lockfile·config·fixture·aidlc-docs·규칙을 복사하고 .planrepo의 운영/실행 자료·기존 node_modules·dist를 가져오지 않는 테스트 helper입니다. 반환 {run(command),start(),request(path),stop(),dispose()}는 복사한 루트의 고정 node/npm과 격리 테스트 경로·명시 포트를 사용합니다. 실제 Claude 실행은 하지 않습니다.

복사본 검증은 명시된 준비 명령을 그대로 실행합니다. 의존성 설치·빌드·migration·시드는 시작10초 측정에서 제외합니다. 기존 프로젝트 파일·외부 문서·절대 경로를 읽어야 실행된다면 실패입니다. 외부 패키지 설치 준비와 실제 AI 연결 요구는 문서에서 분리합니다.

정지·종료 미확인·DB 오류·Claude 미설치·profile 미확보의 현재 처리와 복구 경로를 실제 확인한 범위로 기록합니다. 실제 모델 지원·제한 효과를 도움말만으로 보장하지 않습니다. 인증·raw 출력·비밀 canary는 요약이나 인계에 넣지 않습니다.

각 계층 담당 과제가 작성할 business-logic-summary.md·api-summary.md·repository-summary.md는 aidlc-docs/construction/planrepo/code/ 아래에서 참조합니다. 이 UI 과제가 다른 계층의 테스트 성공이나 미작성 요약을 대신 확정하지 않습니다.

후속 Build and Test 경로는 aidlc-docs/construction/build-and-test/build-instructions.md, unit-test-instructions.md, integration-test-instructions.md, performance-test-instructions.md, build-and-test-summary.md입니다. 이번 Code Generation 인계에서 입력과 실행 증거를 넘기며 후속 단계 자체의 완료·승인을 대신하지 않습니다.

이 문서 과제에 내용 그대로를 검사하는 가짜 TDD를 추가하지 않습니다. 아래 RED·GREEN은 독립 사본 실행이라는 승인 NQ-23의 의미 있는 통합 검사입니다. 이미 앞 과제에 같은 검사가 있으면 그 증거를 재사용하며 중복 테스트를 만들지 않습니다.

copy.request(path)는 {status,text,json}을 반환합니다. copy.queryBoard(): Promise<{items:Array<{key:string}>}>는 사본 manifest의 가상 사용자/프로젝트로 실제 M-045를 호출하고 승인 BoardView를 이 테스트용 최소 조회 형태로 읽기 변환합니다. copy.run(command)는 승인된 명령 enum을 executable/args 배열에 매핑해 shell=false로 실행합니다. 테스트 경로는 tests/relocation/이며 기본 npm test의 unit/contract/integration include와 분리합니다.

relocation 전체 suite의 외부 timeout은 설치/브라우저 준비 시간까지 포함해 별도 구성하고, 제품의 시작·생성 timeout을 늘리는 근거로 쓰지 않습니다. stop()은 시작 전이나 이미 정지한 사본에도 반복 호출할 수 있습니다. DB/child 종료가 확인되지 않으면 dispose는 자료를 보존하고 실패를 반환합니다.

이 과제는 최종 수용 집계보다 먼저 독립 실행 증거와 실행 안내를 준비합니다. 아직 실행하지 않은 전체 수용 집계는 미실행으로 표시하고 최종 ACCEPTANCE 과제에서 implementation-summary와 build-test-handoff를 실제 집계 결과로 갱신합니다.

- [ ] **Step 157: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { it, expect } from 'vitest';
import { createIsolatedProjectCopy } from '@/tests/helpers/project-copy';

it('새 프로젝트 사본에서 Claude 없이 DEMO-4를 조회한다', async () => {
  const copy = await createIsolatedProjectCopy({ testRunId: 'handoff-no-cli', claude: 'absent' });
  try {
    for (const command of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build', 'npm run db:migrate', 'npm run seed:demo']) {
      const result = await copy.run(command);
      expect(result.exitCode, result.sanitizedOutput).toBe(0);
    }
    await copy.start();
    const ready = await copy.request('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.json.generationReady).toBe(false);
    const board = await copy.queryBoard();
    expect(board.items.map(item => item.key).sort()).toEqual(['PAY-102', 'AUTH-331', 'NOTI-028', 'CAT-093'].sort());
    const page = await copy.request('/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('PlanRepo');
  } finally {
    await copy.stop();
    await copy.dispose();
  }
}, 300_000);
```

- [ ] **Step 158: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm exec -- vitest run --config vitest.relocation.config.ts tests/relocation/independent-handoff.test.ts
```

예상 결과는 다음과 같습니다. 사본 준비 후 누락된 로컬 설정·프로젝트 경로 의존·CLI와 DB 준비의 잘못된 결합·실행 진입 문제 중 실제 경계가 드러납니다. 단순 문서 미작성은 행동 RED로 계산하지 않습니다.

- [ ] **Step 159: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

실제 실행한 정확 명령·exit code·실패 원인·미실행 항목을 계층 요약과 implementation-summary에 기록합니다. 코드 경로·공개 계약·추적 기준을 같은 현재 프로젝트의 문서로 연결하고 외부 이전 작업 공간의 문서를 요구하지 않습니다.

project-copy helper는 실행 목록을 고정 배열로 받아 shell 문자열 보간 없이 argv로 호출합니다. 기존 앱 DB·ClaimRef·provider 비밀을 복사하지 않습니다. 테스트 재귀 실행을 막기 위해 사본의 npm test 실행에서는 tests/relocation을 기본 include에서 명시적으로 제외합니다.

독립 사본의 DB는 지원 schema이고 업무 자료·seed 완료표식이 없을 때만 DEMO-4를 넣습니다. 검사·4SR·manifest를 한 transaction으로 확정합니다. 다시 seed하면 거절되는지 확인하고 원본 프로젝트 DB가 달라지지 않았는지 검사합니다.

HTTP ready·정적 화면 확인 뒤 같은 사본에 Playwright를 연결해 4개 시드와 사람 문서 편집·검토를 실제 화면으로 확인합니다. CLI 부재는 생성 불가로 표시하고 비AI ready는 유지합니다. 위험 실행이 없으므로 정리 가능한 자원만 정리합니다.

build-test-handoff에는 자동 검사·실제 Claude·사용자 관찰·성능·독립 실행의 결과와 남은 사유를 분리합니다. 계획 승인·코드 생성 승인·Build and Test 승인을 혼동하지 않습니다.

독립 사본 검증은 vitest.relocation.config.ts에서만 실행합니다. 복사본 npm test는 이 검증을 포함하지 않아 재귀 사본을 만들지 않습니다. 사본의 실제 M-045 결과에 네 시드 key가 있고 provider 부재/DB 준비 상태가 분리되는지 검사합니다.

- [ ] **Step 160: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm exec -- vitest run --config vitest.relocation.config.ts tests/relocation/independent-handoff.test.ts
npm run typecheck
```

통과 조건은 다음과 같습니다. 별도 프로젝트 경로에서 고정 준비 명령·DB migration·DEMO-4·비AI ready와 실제 시드 조회·편집·검토가 통과한 증거를 기록합니다. 문서는 Markdown 파싱·경로 확인 뒤 저장하며 Build and Test는 후속 단계로 남깁니다.

- [ ] **Step 161: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 162: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

frontend-summary·implementation-summary·Build and Test 인계·현재 README를 실제 결과로 갱신합니다.

독립 사본의 정확 준비 명령과 결과·seed 재실행 거절·비AI 이용 결과를 남깁니다.

실제 Claude/사용성/성능이 미검증이면 문서에 그대로 표시하고 UOW 완료로 보고하지 않습니다.

문서 저장 전 Markdown 파싱·표 열 수·프로젝트 루트 기준 링크·현재 소스/증거 경로를 검증합니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.

### CG-28 원 수용 기준의 실행 증거와 전체 완료 판정을 연결합니다.

**구현 묶음**: B-06입니다. **선행**: CG-21, CG-23, CG-24, CG-25, CG-26, CG-27입니다.

**연결 기준**: M-001, M-002, M-003, M-004, M-005, M-006, M-007, M-008, M-009, M-010, M-011, M-012, M-013, M-014, M-015, M-016, M-017, M-018, M-019, M-020, M-021, M-022, M-023, M-024, M-025, M-026, M-027, M-028, M-029, M-030, M-031, M-032, M-033, M-034, M-035, M-040, M-041, M-042, M-043, M-044, M-045, M-046, M-047, M-048, ENT-01, ENT-02, ENT-03, ENT-04, ENT-05, ENT-06, ENT-07, ENT-08, ENT-09, ENT-10, ENT-11, ENT-12, ENT-13, ENT-14, ENT-15, ENT-16, ENT-17, ENT-18, ENT-19, ENT-20, ENT-21, ENT-22, ENT-23, ENT-24, ENT-25, ENT-26, ENT-27, ENT-28, ENT-29, ENT-30, ENT-31, ENT-32, ENT-33, ENT-34, ENT-35, SCN-01, SCN-02, SCN-03, SCN-04, SCN-05, SCN-06, SCN-07, SCN-08, SCN-09, SCN-10, SCN-11, SCN-12, SCN-13, SCN-14, SCN-15, SCN-16, SCN-17, SCN-18, SCN-19, SCN-20, SCN-21, SCN-22, SCN-23, SCN-24, NQ-01, NQ-02, NQ-03, NQ-04, NQ-05, NQ-06, NQ-07, NQ-08, NQ-09, NQ-10, NQ-11, NQ-12, NQ-13, NQ-14, NQ-15, NQ-16, NQ-17, NQ-18, NQ-19, NQ-20, NQ-21, NQ-22, NQ-23, NQ-24, ND-01, ND-02, ND-03, ND-04, ND-05, ND-06, ND-07, ND-08, ND-09, ND-10, ND-11, ND-12, ND-13, ND-14, INF-01, INF-02, INF-03, INF-04, INF-05, INF-06, INF-07, INF-08, INF-09, INF-10입니다. 중복 등장한 ID는 협력 책임이며 아래 최종 완료 추적표와 구분합니다.

| 파일 | 처리 | 책임 |
|---|---|---|
| `tests/acceptance/registry.ts` | 생성합니다. | 승인된 34개 스토리·122개 개별 기준과 공유 기준·제품 기준·설계 검증의 연결을 보존합니다. |
| `tests/acceptance/evidence.ts` | 생성합니다. | 자동·실제 Claude·사용자 관찰·성능·독립 실행의 증거 유형과 상태를 분리합니다. |
| `tests/acceptance/registry.test.ts` | 생성합니다. | 원 기준 누락·중복 소유·허위 증거·필수 미검증을 검출합니다. |
| `tests/acceptance/product-flow.spec.ts` | 생성합니다. | 가상 시작 자료에서 실제 업무 명령으로 전체 검토·인계 흐름을 검증합니다. |
| `scripts/report-acceptance.ts` | 생성합니다. | CMD-12의 수용 상태와 실패·미검증·증거 파일을 집계합니다. |
| `aidlc-docs/construction/planrepo/code/acceptance-traceability.md` | 생성합니다. | 기준별 테스트·실제 결과·미검증 사유를 기록합니다. |
| `vitest.acceptance.config.ts` | 생성합니다. | registry/evidence집계의 단위 검증만 실행합니다. |
| `playwright.acceptance.config.ts` | 생성합니다. | tests/acceptance/product-flow.spec.ts를 기본 e2e와 구분해 실행합니다. |
| `aidlc-docs/construction/planrepo/code/implementation-summary.md` | 갱신합니다. | 앞 DOCS 과제의 문서에 최종 수용 집계의 명령·결과·미검증·인계 상태를 반영합니다. |
| `aidlc-docs/construction/planrepo/code/build-test-handoff.md` | 갱신합니다. | 앞 DOCS 과제의 문서에 최종 수용 집계의 명령·결과·미검증·인계 상태를 반영합니다. |

**인터페이스와 입력 조건**

registry는 승인 원문을 기준으로 US-001~US-034와 US-ID:Cn 키122개를 정확히 보존합니다. 공통 SC-01~SC-07의 스토리별 적용도 승인 story-map 그대로 연결합니다. 숫자 합계만 맞추고 원 기준 의미를 줄이지 않습니다.

최종 묶음은 B-01=3, B-02=0, B-03=10, B-04=4, B-05=4, B-06=13이며 정확히 한 묶음만 각 스토리의 최종 책임을 갖습니다. 이 과제의 stories 배열은 비워 두어 기존 책임을 옮기지 않고 전체 증거 집계만 맡습니다.

추가 연결은 제품 AC-01~AC-19, NFR-01~NFR-08, NQ-01~NQ-24, SCN-01~SCN-24, NT-01~NT-16, UI-01~UI-26입니다. 모든 항목은 실행할 테스트 파일·개별 case명·담당 과제·필요 증거 유형을 갖습니다. 문서 ID가 나타난다는 사실만으로 통과하지 않습니다.

증거는 {criterionId,kind:'automated'|'real-claude'|'human-observation'|'performance'|'independent-run',status:'not-run'|'passed'|'failed'|'blocked',command?,startedAt?,resultPath?,details}로 기록하는 테스트 산출물입니다. 모델 이름·도움말 조회·fixture 상태만으로 real-claude 또는 human-observation을 만들 수 없습니다.

AC-17은 B-02 실제 질문·문서·답변 반영 후속 생성과 B-05 사람 적용·실제 G1/G2·Handoff를 모두 요구합니다. NQ-13은 실제 SR 담당자/동료 검토자 관찰이 필요합니다. AC-18의 test provider 교체와 AC-19의 실제 제한 효과·가짜 오류 재현은 증거 유형별로 분리합니다.

evaluateAcceptance(registry,evidence)는 {complete,missing,failed,blocked,passed}를 반환합니다. missing은 없는 실행·필요 유형 불일치, failed는 실제 실패, blocked는 실행 제약을 구분합니다. 필수 미검증이 있으면 complete=false입니다. CMD-12의 전체 완료 모드는 미완료 시 비정상 종료하고 정제된 요약을 남깁니다.

NT 책임 연결은 NT-01~NT-05를 저장·G1/G2·Handoff 과제, NT-06~NT-12를 생성 실행·복구 과제, NT-13을 생성·초안, NT-14를 HTTP/생성 bytes 경계·표시, NT-15를 실제 CLI profile·출력, NT-16을 QUALITY에 연결합니다. 내부6메서드는 runtime 테스트 증거로 연결하고 공개 UI 호출로 만들지 않습니다.

DEMO-4 전체를 표시 검증하고 새 가상 SR의 실제 입력·질문·결정·문서·검토·전환·인계를 수행합니다. PAY 예외 규칙 변경은 검토 연습이며 결제 업무 자체를 구현하지 않습니다. 시드의 가짜 통과·외부 기록을 실제 실행 증거로 계산하지 않습니다.

- [ ] **Step 163: 아래 실패 테스트와 필요한 fixture를 작성합니다.**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateAcceptance } from '@/tests/acceptance/evidence';

describe('필수 증거 유형', () => {
  it('자동 성공만으로 실제 Claude와 사용자 관찰을 완료하지 않는다', () => {
    const registry = [
      { id: 'AC-17', requiredKinds: ['real-claude'], ownerBundle: 'B-05' },
      { id: 'NQ-13', requiredKinds: ['human-observation'], ownerBundle: 'B-06' },
    ];
    const result = evaluateAcceptance(registry, [
      { criterionId: 'AC-17', kind: 'automated', status: 'passed', resultPath: '.planrepo/test-runs/acceptance-evidence/results/fake-ai.json' },
      { criterionId: 'NQ-13', kind: 'automated', status: 'passed', resultPath: '.planrepo/test-runs/acceptance-evidence/results/browser-timing.json' },
    ]);
    expect(result.complete).toBe(false);
    expect(result.missing.map(item => item.criterionId).sort()).toEqual(['AC-17', 'NQ-13']);
  });
});
```

- [ ] **Step 164: 테스트를 실행하고 예상한 RED를 확인합니다.**

```sh
npm exec -- vitest run --config vitest.acceptance.config.ts tests/acceptance/registry.test.ts
```

예상 결과는 다음과 같습니다. 초기 집계기가 ID별 자동 성공만으로 통과시키는 사례에서 필수 real-claude·human-observation 누락 기대가 실패합니다. 새 파일 import 실패는 준비 RED로 남기고, 컴파일 가능한 최소 집계 뒤 의미 있는 실패를 확인합니다.

- [ ] **Step 165: 다음 저장·검사·표시 경계의 최소 코드를 구현합니다.**

승인된 story-map과 stories의 C별 원문을 registry 작성 시 대조합니다. 각 US:C key에 실제 테스트 case와 요구된 SC를 연결하고, 제품 AC 연결표를 그대로 따라 관련 criterion evidence를 모읍니다.

집계는 항목마다 requiredKinds를 순회해 해당 유형의 실제 실행 evidence를 요구합니다. passed 표시뿐 아니라 실행 시각·실행 명령 또는 실제 관찰 기록·읽을 수 있는 결과 파일을 검사합니다. 자동 수행 결과로 실제 사람/Claude 증거 유형을 바꾸지 않습니다.

성능은 고정 fixture·표본·실측값을, 독립 실행은 별도 경로 준비·시작·조회 결과를 연결합니다. 테스트가 skip됐거나 실패했으면 관련 개별 기준과 스토리를 완료로 만들지 않습니다.

34개 스토리의122개 기준·7SC·19AC·24NQ·24SCN·16NT·26UI에 누락/유효하지 않은 연결이 없는지 검사합니다. 전체 자동 검사가 성공해도 실제 AC-17이나 NQ-13이 비면 complete=false를 반환합니다.

test:acceptance는 통과·실패·미검증·차단을 별도 목록으로 남깁니다. Code Generation 체크박스에는 실행하고 증거가 있는 항목만 반영하며 실제 AI가 막히면 해당 기준과 UOW 미완료를 유지합니다.

vitest.acceptance.config.ts는 registry.test.ts만, playwright.acceptance.config.ts는 product-flow.spec.ts만 수집합니다. scripts/report-acceptance.ts는 두 검증과 이미 기록된 실제 AI/사용성/성능/복구 증거를 집계합니다. evidence 집계만 통과하고 실제 수용 증거가 빠진 경우 최종 exit code는 실패입니다. 기본 npm test의 include에서 acceptance/live/performance/relocation을 제외합니다.

- [ ] **Step 166: 대상 테스트와 이 과제의 실제 연결을 검증해 GREEN을 확인합니다.**

```sh
npm exec -- vitest run --config vitest.acceptance.config.ts tests/acceptance/registry.test.ts
npm run test:acceptance
```

통과 조건은 다음과 같습니다. 필수 증거 누락·유형 불일치·중복 최종 책임·기준 누락을 잡는 집계 테스트가 통과합니다. 실제 전체 완료 여부는 이후 npm run test:acceptance의 실제 결과로만 보고합니다.

- [ ] **Step 167: GREEN 뒤 중복과 책임 경계를 정리하고 변경한 경로만 재검증합니다.**

공통 DTO·현재성·원자성 경계를 우회하지 않습니다. 리팩터링이 없으면 생략 사유를 기록합니다. 동작을 바꿨으면 그 동작의 새 RED부터 반복합니다.

- [ ] **Step 168: 관련 전체 검증과 근거를 기록하고 완료 조건을 확인합니다.**

이 과제에서 아직 실행하지 않은 `npm run typecheck`와 영향을 받는 단위·계약·통합 테스트를 실행합니다. 이미 같은 변경에서 통과한 검사를 이유 없이 반복하지 않습니다. 실제 Claude·브라우저·성능·복구가 필요한 기준은 그 증거를 별도로 연결합니다.

승인 원문 34US·122개별 기준·7SC·19AC·8NFR·24NQ·24SCN·16NT·26UI의 의미와 실행 연결을 대조합니다.

B-06 최종13US와 앞 묶음21US의 최종 책임이 중복 없이 유지됩니다.

npm run test:acceptance 결과와 실제 Claude·실제 사람 관찰의 미실행 여부를 분리합니다.

코드 계획 단계에서는 어떤 앱 수용 기준도 통과 또는 완료로 표시하지 않습니다.

DOCS의 독립 사본 검증을 포함한 모든 증거를 모은 뒤 npm run test:acceptance를 최종 실행합니다. implementation-summary와 build-test-handoff를 이 결과로 갱신합니다. 필수 실패·미검증이 남으면 이 전체 완료 단계와 UOW 완료는 체크하지 않습니다.

명령·exit code·실패·미실행을 `aidlc-docs/audit.md`에 추가하고 완료한 Step만 같은 작업 회차에서 체크합니다.
## 5. 메서드 구현 책임

표의 과제는 최초 업무 구현의 책임입니다. CONTRACT는 모든 타입을 정의하지만 업무 구현 완료로 세지 않습니다. G2와 B-06은 기존 메서드를 확장하며 각 task에 추가 기준을 명시했습니다.

| 메서드 | 서비스 | 승인 시그니처 | 구현 과제 | 접근 |
|---|---|---|---|---|
| M-001 | S-01 | `describeWorkspace(query: QueryContext)` | CG-05 | 공개입니다. |
| M-002 | S-01 | `selectDemoActor(selection: DemoActorId)` | CG-05 | 공개입니다. |
| M-003 | S-02 | `registerSr(ctx: CommandContext, input: NewSR)` | CG-06 | 공개입니다. |
| M-004 | S-02 | `importMockTicket(ctx: CommandContext, key: TicketKey)` | CG-06 | 공개입니다. |
| M-005 | S-02 | `updateSrDescription(ctx: CommandContext, input: SRDescriptionEdit)` | CG-06 | 공개입니다. |
| M-006 | S-02 | `attachSource(ctx: CommandContext, input: SourceInput)` | CG-07 | 공개입니다. |
| M-007 | S-02 | `confirmSource(ctx: CommandContext, input: SourceConfirmation)` | CG-07 | 공개입니다. |
| M-008 | S-03 | `answerQuestion(ctx: CommandContext, input: QuestionAnswer)` | CG-09 | 공개입니다. |
| M-009 | S-03 | `resolveQuestion(ctx: CommandContext, input: QuestionResolution)` | CG-16 | 공개입니다. |
| M-010 | S-03 | `addFollowupQuestion(ctx: CommandContext, input: FollowupQuestion)` | CG-09 | 공개입니다. |
| M-011 | S-03 | `convertQuestionToDecision(ctx: CommandContext, input: DecisionConversion)` | CG-16 | 공개입니다. |
| M-012 | S-03 | `confirmDecision(ctx: CommandContext, input: DecisionConfirmation)` | CG-09 | 공개입니다. |
| M-013 | S-03 | `redecide(ctx: CommandContext, input: DecisionRevision)` | CG-16 | 공개입니다. |
| M-014 | S-03 | `classifyScope(ctx: CommandContext, input: ScopeClassification)` | CG-16 | 공개입니다. |
| M-015 | S-04 | `saveArtifact(ctx: CommandContext, input: ArtifactEdit)` | CG-09 | 공개입니다. |
| M-016 | S-04 | `compareArtifacts(query: QueryContext, refs: ArtifactVersionPair)` | CG-09 | 공개입니다. |
| M-017 | S-04 | `saveWorkflowPlan(ctx: CommandContext, input: WorkflowPlanEdit)` | CG-20 | 공개입니다. |
| M-018 | S-04 | `applyDraft(ctx: CommandContext, input: DraftApplication)` | CG-09 | 공개입니다. |
| M-019 | S-04 | `createReviewedDraft(ctx: CommandContext, input: ReviewedDraftInput)` | CG-09 | 공개입니다. |
| M-020 | S-05 | `requestReview(ctx: CommandContext, input: ReviewRequestInput)` | CG-18 | 공개입니다. |
| M-021 | S-05 | `recordApproval(ctx: CommandContext, input: ApprovalInput)` | CG-18 | 공개입니다. |
| M-022 | S-05 | `addComment(ctx: CommandContext, input: CommentInput)` | CG-19 | 공개입니다. |
| M-023 | S-05 | `requestChange(ctx: CommandContext, input: ChangeRequestInput)` | CG-19 | 공개입니다. |
| M-024 | S-05 | `submitChangeResult(ctx: CommandContext, input: ChangeApplication)` | CG-19 | 공개입니다. |
| M-025 | S-05 | `confirmChangeResolution(ctx: CommandContext, input: ChangeConfirmation)` | CG-19 | 공개입니다. |
| M-026 | S-05 | `requestFurtherChange(ctx: CommandContext, input: ChangeFeedback)` | CG-19 | 공개입니다. |
| M-027 | S-05 | `assessGate(query: QueryContext, gate: GateKind)` | CG-18 | 공개입니다. |
| M-028 | S-05 | `transitionStage(ctx: CommandContext, input: StageTransition)` | CG-18 | 공개입니다. |
| M-029 | S-06 | `createPolicyVersion(ctx: CommandContext, input: PolicyEdit)` | CG-17 | 공개입니다. |
| M-030 | S-06 | `assignReviewers(ctx: CommandContext, input: ReviewerAssignment)` | CG-17 | 공개입니다. |
| M-031 | S-06 | `applyPolicyToSr(ctx: CommandContext, input: PolicyApplication)` | CG-17 | 공개입니다. |
| M-032 | S-07 | `requestGeneration(ctx: CommandContext, input: GenerationInput)` | CG-10 | 공개입니다. |
| M-033 | S-07 | `getGeneration(query: QueryContext, run: GenerationRunId)` | CG-10 | 공개입니다. |
| M-034 | S-07 | `cancelGeneration(ctx: CommandContext, run: GenerationRunId)` | CG-10 | 공개입니다. |
| M-035 | S-07 | `retryGeneration(ctx: CommandContext, run: GenerationRunId)` | CG-10 | 공개입니다. |
| M-036 | S-07 | `claimRun(internal: RuntimeContext)` | CG-11 | 내부입니다. |
| M-037 | S-07 | `completeRun(internal: RuntimeContext, result: ProviderCompletion)` | CG-11 | 내부입니다. |
| M-038 | S-07 | `failRun(internal: RuntimeContext, error: ProviderFailure)` | CG-11 | 내부입니다. |
| M-039 | S-07 | `reconcileInterruptedRuns(internal: RuntimeContext)` | CG-14 | 내부입니다. |
| M-040 | S-08 | `createHandoff(ctx: CommandContext, input: HandoffRequest)` | CG-21 | 공개입니다. |
| M-041 | S-08 | `previewHandoff(query: QueryContext, ref: HandoffId)` | CG-21 | 공개입니다. |
| M-042 | S-08 | `exportCurrentHandoff(ctx: CommandContext, ref: HandoffId)` | CG-21 | 공개입니다. |
| M-043 | S-08 | `recordImplementationStart(ctx: CommandContext, input: ImplementationStart)` | CG-22 | 공개입니다. |
| M-044 | S-08 | `recordImplementationCompletion(ctx: CommandContext, input: ImplementationCompletion)` | CG-22 | 공개입니다. |
| M-045 | S-09 | `getBoard(query: QueryContext, filter: BoardFilter)` | CG-06 | 공개입니다. |
| M-046 | S-09 | `getInbox(query: QueryContext, filter: InboxFilter)` | CG-23 | 공개입니다. |
| M-047 | S-09 | `getSrDetail(query: QueryContext)` | CG-06 | 공개입니다. |
| M-048 | S-09 | `getActivity(query: QueryContext, filter: HistoryFilter)` | CG-22 | 공개입니다. |
| M-049 | S-07 | `readRunControl(internal: RuntimeContext, claim: ClaimRef)` | CG-11 | 내부입니다. |
| M-050 | S-07 | `recordExecutionTermination(internal: RuntimeContext, input: ExecutionTermination)` | CG-11 | 내부입니다. |

## 6. 엔티티와 화면의 소유

35개 ENT의 초기 DDL·FK·불변성·SR 소속·runtime 보조 자료는 CG-03 STORAGE가 소유합니다. 실제 repository 동작은 각 과제에서 추가합니다. 엔티티 수를 SQL 테이블 수와 무조건 같게 만들지 않으며 mapping을 storage-and-schema 문서에 남깁니다.

| 엔티티 | 이름 | 행동·표현 과제 |
|---|---|---|
| ENT-01 | WorkspaceProject | CG-05, CG-06, CG-08, CG-17 |
| ENT-02 | DemoUserMembership | CG-05, CG-06, CG-08, CG-17, CG-23 |
| ENT-03 | SR | CG-05, CG-06, CG-08, CG-17, CG-18, CG-20, CG-22, CG-23, CG-24 |
| ENT-04 | SRDescriptionVersion | CG-05, CG-06, CG-08, CG-18 |
| ENT-05 | ContextSource | CG-07, CG-08 |
| ENT-06 | ContextSourceVersion | CG-07, CG-08, CG-18 |
| ENT-07 | Artifact | CG-09, CG-20, CG-24, CG-25 |
| ENT-08 | ArtifactVersion | CG-09, CG-15, CG-18, CG-19, CG-20, CG-21, CG-24, CG-25 |
| ENT-09 | WorkflowPlanVersion | CG-20, CG-21, CG-24 |
| ENT-10 | Question | CG-09, CG-15, CG-16, CG-23, CG-24, CG-25 |
| ENT-11 | QuestionAnswerVersion | CG-09, CG-15, CG-16, CG-24, CG-25 |
| ENT-12 | QuestionResultSnapshot | CG-09, CG-16, CG-18, CG-20, CG-21, CG-24, CG-25 |
| ENT-13 | Decision | CG-09, CG-16, CG-23, CG-24 |
| ENT-14 | DecisionVersion | CG-09, CG-16, CG-18, CG-20, CG-21, CG-24 |
| ENT-15 | ScopeClassificationVersion | CG-16, CG-18, CG-20, CG-21, CG-24 |
| ENT-16 | ReviewPolicyVersion | CG-17, CG-18, CG-20, CG-24 |
| ENT-17 | ReviewAssignmentVersion | CG-17, CG-18, CG-19, CG-20, CG-23, CG-24 |
| ENT-18 | ReviewBundle | CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-23, CG-24, CG-25 |
| ENT-19 | ReviewRequest | CG-17, CG-18, CG-19, CG-20, CG-23, CG-24 |
| ENT-20 | Approval | CG-17, CG-18, CG-20, CG-21, CG-22, CG-24, CG-25 |
| ENT-21 | ReviewGateState | CG-06, CG-07, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-23, CG-24, CG-25 |
| ENT-22 | GateTransitionRecord | CG-07, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24 |
| ENT-23 | Comment | CG-19, CG-24 |
| ENT-24 | ChangeRequest | CG-18, CG-19, CG-20, CG-23, CG-24 |
| ENT-25 | ChangeRequestEvent | CG-19, CG-24 |
| ENT-26 | InputSnapshot | CG-09, CG-10, CG-11, CG-13, CG-15, CG-25 |
| ENT-27 | GenerationRun | CG-09, CG-10, CG-11, CG-12, CG-13, CG-14, CG-15, CG-25 |
| ENT-28 | ExecutionClaim | CG-11, CG-12, CG-13, CG-14, CG-15, CG-25 |
| ENT-29 | ExecutionObservation | CG-11, CG-12, CG-14, CG-15, CG-25 |
| ENT-30 | GenerationDraft | CG-09, CG-11, CG-12, CG-13, CG-14, CG-15, CG-25 |
| ENT-31 | DraftApplication | CG-09, CG-15, CG-25 |
| ENT-32 | Handoff | CG-21, CG-22, CG-23, CG-24 |
| ENT-33 | ImplementationRecord | CG-22, CG-23, CG-24 |
| ENT-34 | ActivityEvent | CG-06, CG-07, CG-10, CG-11, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-23, CG-24, CG-25 |
| ENT-35 | CommandReceipt | CG-06, CG-07, CG-08, CG-10, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24, CG-25 |

26개 UI의 최종 기능 확인 책임은 다음과 같습니다. 최초 최소 화면은 앞 묶음의 task에서 먼저 연결하고 B-06은 변경·경쟁·권한·현재성 상호작용을 검증합니다.

| UI | 컴포넌트 | 실제 파일 | 최초 연결 | 최종 확인 |
|---|---|---|---|---|
| UI-01 | AppShell | `src/web/App.tsx` | CG-08 | CG-08 |
| UI-02 | TeamBoard | `src/web/components/TeamBoard.tsx` | CG-08 | CG-23 |
| UI-03 | PersonalInbox | `src/web/components/PersonalInbox.tsx` | CG-23 | CG-23 |
| UI-04 | SRList | `src/web/components/SRList.tsx` | CG-08 | CG-23 |
| UI-05 | SRRegistrationForm | `src/web/components/SRRegistrationForm.tsx` | CG-08 | CG-08 |
| UI-06 | SRDetailShell | `src/web/components/SRDetailShell.tsx` | CG-08 | CG-23 |
| UI-07 | ReviewSummary | `src/web/components/ReviewSummary.tsx` | CG-18 | CG-24 |
| UI-08 | SRContextPanel | `src/web/components/SRContextPanel.tsx` | CG-08 | CG-08 |
| UI-09 | QuestionPanel | `src/web/components/QuestionPanel.tsx` | CG-09 | CG-24 |
| UI-10 | DecisionPanel | `src/web/components/DecisionPanel.tsx` | CG-09 | CG-24 |
| UI-11 | ScopeClassificationForm | `src/web/components/ScopeClassificationForm.tsx` | CG-16 | CG-24 |
| UI-12 | ArtifactWorkspace | `src/web/components/ArtifactWorkspace.tsx` | CG-09 | CG-25 |
| UI-13 | WorkflowPlanEditor | `src/web/components/WorkflowPlanEditor.tsx` | CG-20 | CG-24 |
| UI-14 | VersionComparison | `src/web/components/VersionComparison.tsx` | CG-09 | CG-25 |
| UI-15 | ReviewRequestForm | `src/web/components/ReviewRequestForm.tsx` | CG-18 | CG-24 |
| UI-16 | BundleReviewForm | `src/web/components/BundleReviewForm.tsx` | CG-18 | CG-24 |
| UI-17 | SectionDiscussion | `src/web/components/SectionDiscussion.tsx` | CG-19 | CG-24 |
| UI-18 | GateConditionPanel | `src/web/components/GateConditionPanel.tsx` | CG-18 | CG-24 |
| UI-19 | GenerationPanel | `src/web/components/GenerationPanel.tsx` | CG-15 | CG-25 |
| UI-20 | DraftReview | `src/web/components/DraftReview.tsx` | CG-09 | CG-25 |
| UI-21 | TeamPolicyEditor | `src/web/components/TeamPolicyEditor.tsx` | CG-17 | CG-24 |
| UI-22 | SRReviewAssignment | `src/web/components/SRReviewAssignment.tsx` | CG-17 | CG-24 |
| UI-23 | HandoffPanel | `src/web/components/HandoffPanel.tsx` | CG-21 | CG-24 |
| UI-24 | ExternalImplementationPanel | `src/web/components/ExternalImplementationPanel.tsx` | CG-22 | CG-24 |
| UI-25 | ActivityHistory | `src/web/components/ActivityHistory.tsx` | CG-22 | CG-23 |
| UI-26 | CommandFeedback | `src/web/components/CommandFeedback.tsx` | CG-08 | CG-08 |

## 7. 스토리별 완료 추적

모든 항목은 구현 미착수입니다. 완료 과제와 같은 B 묶음을 유지하며 개별 C와 지정 SC의 실제 실행 근거가 있어야 체크합니다. 이 표는 승인 원문의 기준을 대체하거나 줄이지 않습니다.

| 스토리 | 최종 묶음 | 완료 과제 | 개별 기준 | 공통 기준 |
|---|---|---|---|---|
| US-001 | B-01 | CG-06 | C1, C2, C3 | SC-01, SC-04, SC-05, SC-07 |
| US-002 | B-01 | CG-06 | C1, C2, C3 | SC-01, SC-03, SC-04, SC-05, SC-07 |
| US-003 | B-01 | CG-07 | C1, C2, C3 | SC-01, SC-04, SC-05, SC-07 |
| US-004 | B-03 | CG-16 | C1, C2, C3 | SC-01, SC-04, SC-05, SC-07 |
| US-005 | B-03 | CG-16 | C1, C2, C3 | SC-01, SC-04, SC-05, SC-07 |
| US-006 | B-03 | CG-16 | C1, C2 | SC-01, SC-03, SC-04, SC-05, SC-07 |
| US-007 | B-06 | CG-24 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-008 | B-06 | CG-24 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-009 | B-06 | CG-25 | C1, C2, C3, C4 | SC-01, SC-04, SC-05, SC-06, SC-07 |
| US-010 | B-06 | CG-25 | C1, C2, C3, C4 | SC-01, SC-04, SC-05, SC-06, SC-07 |
| US-011 | B-06 | CG-25 | C1, C2, C3, C4, C5, C6 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-012 | B-06 | CG-25 | C1, C2, C3, C4, C5 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-013 | B-06 | CG-25 | C1, C2, C3, C4 | SC-01, SC-04, SC-05, SC-06, SC-07 |
| US-014 | B-03 | CG-18 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-015 | B-03 | CG-18 | C1, C2, C3, C4, C5 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-016 | B-03 | CG-19 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-017 | B-03 | CG-19 | C1, C2 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-018 | B-03 | CG-19 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-019 | B-03 | CG-18 | C1, C2, C3, C4, C5 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-020 | B-04 | CG-20 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-021 | B-04 | CG-20 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-022 | B-04 | CG-20 | C1, C2, C3 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-023 | B-04 | CG-20 | C1, C2, C3, C4 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-024 | B-06 | CG-24 | C1, C2, C3, C4 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-025 | B-06 | CG-24 | C1, C2, C3, C4 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-026 | B-06 | CG-24 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-027 | B-06 | CG-23 | C1, C2, C3, C4, C5, C6 | SC-04, SC-05 |
| US-028 | B-06 | CG-23 | C1, C2, C3, C4 | SC-02, SC-04, SC-05 |
| US-029 | B-03 | CG-17 | C1, C2, C3 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-030 | B-06 | CG-24 | C1, C2, C3, C4 | SC-01, SC-02, SC-04, SC-05, SC-07 |
| US-031 | B-05 | CG-21 | C1, C2, C3, C4, C5 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-032 | B-05 | CG-22 | C1, C2, C3 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-033 | B-05 | CG-22 | C1, C2, C3 | SC-01, SC-02, SC-03, SC-04, SC-05, SC-07 |
| US-034 | B-05 | CG-22 | C1, C2, C3 | SC-04, SC-05 |

- [ ] US-001 SR 직접 등록의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-002 가상 Jira 가져오기와 원 설명 확인의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-003 근거 연결과 확인 상태 관리의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-004 배정된 질문에 답변의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-005 답변 해결 확인과 후속 질문의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-006 질문을 공식 결정으로 전환의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-007 근거 있는 결정 확정과 재결정의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-008 질문·결정의 필요 시점과 후속 범위 분류의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-009 AI 생성 요청과 진행 상태 확인의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-010 생성 실패·취소 확인과 재시도의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-011 초안 검토·적용과 오래된 결과 처리의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-012 문서 편집과 버전 비교의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-013 교체 가능한 AI 연결 사용의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-014 G1 공식 검토 요청의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-015 현재 G1 묶음 검토와 개별 승인의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-016 섹션 댓글과 수정 요청의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-017 수정 반영 결과 제출의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-018 수정 반영 해결 확인의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-019 G1 통과와 계획·설계 진입의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-020 진행 계획·설계·구현 계획 정리의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-021 G2 공식 검토 요청의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-022 현재 G2 묶음 검토와 개별 승인의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-023 G2 통과와 구현 준비 완료의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-024 G1 변경 후 영향 확인과 재검토의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-025 G2 전용 변경 후 재검토의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-026 새 차단 문제와 이어진 요청 처리의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-027 팀 보드에서 다음 행동 찾기의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-028 내 검토함에서 배정 업무 처리의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-029 검토 정책 버전 관리의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-030 SR 검토자 지정과 정책 명시 적용의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-031 승인 기준본 인계 생성·미리보기·내보내기의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-032 외부 구현 시작 기록의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-033 외부 구현 완료 기록의 개별 기준과 지정 공통 기준을 통과했습니다.
- [ ] US-034 활동 이력과 과거 기준 조회의 개별 기준과 지정 공통 기준을 통과했습니다.

합계는 34개 스토리·122개 개별 기준·7개 공통 기준입니다. 최종 묶음별 담당 수는 B-01 3개, B-02 0개, B-03 10개, B-04 4개, B-05 4개, B-06 13개입니다. B-02의 실제 AI 초기 증거는 스토리 전체 완료를 뜻하지 않습니다.

## 8. 품질·경계·전체 수용 추적

| NQ | 원 기준 | 구현·검증 과제 |
|---|---|---|
| NQ-01 | 검증 규모 | CG-04, CG-06, CG-23, CG-26, CG-28 |
| NQ-02 | 비AI API 응답 | CG-03, CG-05, CG-12, CG-23, CG-26, CG-28 |
| NQ-03 | 화면 반응 | CG-23, CG-26, CG-28 |
| NQ-04 | 로컬 이용과 시작 | CG-01, CG-03, CG-05, CG-06, CG-08, CG-13, CG-14, CG-15, CG-26, CG-27, CG-28 |
| NQ-05 | 확정 자료 보존 | CG-03, CG-04, CG-06, CG-07, CG-14, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24, CG-28 |
| NQ-06 | 원자성 | CG-03, CG-04, CG-06, CG-07, CG-09, CG-11, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24, CG-28 |
| NQ-07 | 충돌과 현재 조건 | CG-02, CG-03, CG-06, CG-07, CG-08, CG-09, CG-10, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24, CG-25, CG-28 |
| NQ-08 | 중복 처리 | CG-02, CG-03, CG-06, CG-08, CG-09, CG-10, CG-11, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24, CG-25, CG-28 |
| NQ-09 | 이력과 재검토 일관성 | CG-07, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-24, CG-28 |
| NQ-10 | 현재 역할과 범위 | CG-02, CG-05, CG-06, CG-07, CG-08, CG-10, CG-16, CG-17, CG-18, CG-19, CG-20, CG-22, CG-23, CG-24, CG-26, CG-28 |
| NQ-11 | 안전한 문서 표시 | CG-08, CG-09, CG-25, CG-26, CG-28 |
| NQ-12 | 키보드와 입력 보존 | CG-08, CG-23, CG-24, CG-25, CG-26, CG-28 |
| NQ-13 | 사용성 관찰 | CG-23, CG-24, CG-26, CG-28 |
| NQ-14 | 생성 용량과 대기 | CG-03, CG-10, CG-11, CG-12, CG-14, CG-15, CG-25, CG-26, CG-28 |
| NQ-15 | 생성 시간 제한 | CG-12, CG-15, CG-25, CG-28 |
| NQ-16 | 취소와 종료 관찰 | CG-11, CG-12, CG-14, CG-15, CG-25, CG-26, CG-28 |
| NQ-17 | 입출력 크기 제한 | CG-01, CG-09, CG-10, CG-12, CG-13, CG-15, CG-20, CG-21, CG-25, CG-26, CG-28 |
| NQ-18 | 입력 고정과 초안 적용 | CG-07, CG-09, CG-10, CG-11, CG-13, CG-15, CG-16, CG-25, CG-28 |
| NQ-19 | Claude 실행 경계 | CG-05, CG-12, CG-13, CG-15, CG-25, CG-26, CG-28 |
| NQ-20 | 실제 실행과 교체 계약 | CG-10, CG-13, CG-15, CG-21, CG-25, CG-27, CG-28 |
| NQ-21 | 중단 복구 | CG-03, CG-11, CG-14, CG-15, CG-25, CG-26, CG-28 |
| NQ-22 | 오류와 추적 기록 | CG-02, CG-05, CG-07, CG-08, CG-10, CG-11, CG-12, CG-13, CG-14, CG-15, CG-21, CG-22, CG-25, CG-26, CG-27, CG-28 |
| NQ-23 | 독립 실행과 재현성 | CG-01, CG-03, CG-04, CG-05, CG-06, CG-08, CG-14, CG-15, CG-25, CG-26, CG-27, CG-28 |
| NQ-24 | 검증 증거와 유지보수 | CG-01, CG-26, CG-27, CG-28 |

16개 NT는 승인 NFR Design의 같은 행을 그대로 재현합니다. 다음 과제의 전용 테스트에서 검증하고 실제 OS/model/사용성 증거가 필요한 경우 fake 결과와 구분합니다.

| NT | 입력·경쟁 | 구현·검증 과제 |
|---|---|---|
| NT-01 | 동일 키의 프로젝트 명령 두 개와 다른 명령 재사용입니다. | CG-03, CG-10 |
| NT-02 | 저장 각 지점과 commit 후 응답 전 중단입니다. | CG-03, CG-18, CG-19 |
| NT-03 | 같은 묶음의 두 검토자 승인과 배정 제거를 교차합니다. | CG-17, CG-18 |
| NT-04 | G1 변경과 G2 통과·현재 인계 내보내기를 경쟁시킵니다. | CG-20, CG-21, CG-24 |
| NT-05 | H2를 활성화한 뒤 H1 완료를 기록합니다. | CG-22 |
| NT-06 | 11번째 접수·동일 receipt 재생·두 runtime 인수를 경쟁시킵니다. | CG-10, CG-11 |
| NT-07 | R1 종료 후 R2 인수, 이어 R1 M-050을 재전송합니다. | CG-11 |
| NT-08 | 완료·취소·실패·timeout과 stdout 종료 후 늦은 stderr 초과의 순서를 바꿉니다. | CG-12, CG-13 |
| NT-09 | claim 직후·spawn 직후·PID 저장 전 부모를 중단합니다. | CG-14 |
| NT-10 | spawn의 확정 실패와 PID 없는 crash gap을 비교합니다. | CG-12, CG-14 |
| NT-11 | 성공 commit 후 종료 관찰 전 재시작합니다. | CG-14 |
| NT-12 | 같은 boot·sleep·다른 host 사본·검증된 동일 host reboot를 구분합니다. | CG-14, CG-27 |
| NT-13 | 입력 변경·설정 변경·absent 생성·오래된 결과 적용을 경쟁시킵니다. | CG-09, CG-10, CG-25 |
| NT-14 | 각 bytes 상한과 1바이트 초과·한국어·동시 파이프 폭주입니다. | CG-05, CG-09, CG-12, CG-21 |
| NT-15 | CLI 제한 조합·managed 충돌·위험 출력·is_error를 검사합니다. | CG-13, CG-15 |
| NT-16 | 5 context·같은 화면의 Q2/Q1 응답 역전·dirty 폼·악성 Markdown·키보드·실측입니다. | CG-08, CG-23, CG-26 |

24개 SCN은 기능 설계의 동일 시나리오입니다. 과제의 관련 테스트와 acceptance registry에 연결하며 시나리오의 일부 assertion만 통과했다고 전체 통과로 세지 않습니다.

| 시나리오 | 담당 과제 |
|---|---|
| SCN-01 | CG-03, CG-04, CG-06, CG-07, CG-08, CG-27, CG-28 |
| SCN-02 | CG-09, CG-16, CG-28 |
| SCN-03 | CG-09, CG-16, CG-24, CG-28 |
| SCN-04 | CG-16, CG-24, CG-28 |
| SCN-05 | CG-18, CG-20, CG-24, CG-28 |
| SCN-06 | CG-17, CG-18, CG-24, CG-28 |
| SCN-07 | CG-19, CG-24, CG-28 |
| SCN-08 | CG-19, CG-24, CG-28 |
| SCN-09 | CG-07, CG-16, CG-18, CG-20, CG-22, CG-24, CG-28 |
| SCN-10 | CG-16, CG-20, CG-22, CG-24, CG-28 |
| SCN-11 | CG-19, CG-24, CG-28 |
| SCN-12 | CG-02, CG-05, CG-17, CG-18, CG-20, CG-23, CG-24, CG-26, CG-28 |
| SCN-13 | CG-17, CG-23, CG-24, CG-28 |
| SCN-14 | CG-03, CG-06, CG-07, CG-08, CG-10, CG-11, CG-16, CG-17, CG-18, CG-19, CG-20, CG-21, CG-22, CG-25, CG-26, CG-28 |
| SCN-15 | CG-09, CG-10, CG-11, CG-13, CG-15, CG-25, CG-28 |
| SCN-16 | CG-09, CG-11, CG-12, CG-14, CG-15, CG-25, CG-26, CG-28 |
| SCN-17 | CG-03, CG-10, CG-11, CG-12, CG-14, CG-15, CG-25, CG-28 |
| SCN-18 | CG-13, CG-15, CG-21, CG-25, CG-28 |
| SCN-19 | CG-10, CG-11, CG-13, CG-15, CG-25, CG-28 |
| SCN-20 | CG-07, CG-11, CG-12, CG-13, CG-14, CG-15, CG-21, CG-25, CG-26, CG-28 |
| SCN-21 | CG-21, CG-22, CG-24, CG-28 |
| SCN-22 | CG-22, CG-23, CG-24, CG-28 |
| SCN-23 | CG-06, CG-18, CG-22, CG-23, CG-26, CG-28 |
| SCN-24 | CG-01, CG-03, CG-04, CG-05, CG-06, CG-08, CG-23, CG-25, CG-26, CG-27, CG-28 |

FR-01부터 FR-23, NFR-01부터 NFR-08, AC-01부터 AC-19의 전체 기준은 CG-28 acceptance registry에서 스토리·SCN·NQ·NT와 실제 테스트 결과를 연결합니다. registry는 미실행·실패·known limitation·증거 종류 불일치를 성공으로 채우지 않습니다. 소스의 ID 개수만 맞는 것은 수용 테스트 통과가 아닙니다.

AC-17은 CG-15의 초기 실제 생성 뒤 CG-21에서 실제 질문·사람 답변·후속 생성·적용·G1·G2·인계까지 확인합니다. AC-18은 CG-13과 CG-25의 provider 교체 후 동일한 업무 정책, AC-19는 CG-12·CG-13·CG-14·CG-15·CG-25의 실패·취소·경계와 실제 제한 증거에 연결합니다. NQ-13은 CG-26의 실제 대표 사용자 관찰이 필요합니다. NQ-21의 알려진 미지원 범위는 별도 실패 상태로 남깁니다.

## 9. 코드 생성 결과와 다음 단계

- [ ] 28개 과제의 168개 Step과 스토리별 실제 기준을 확인하고 구현 결과를 정리합니다.
- [ ] 사용자에게 코드 생성 결과를 검토받고 Build and Test로 진행할 승인을 기록합니다.

Code Generation Part 2 결과 설명은 실제 파일·동작·테스트·남은 실패와 한계를 기준으로 작성합니다. 코드가 아직 없는데 생성됐다고 표시하거나 계획 문서 검증을 앱 테스트로 바꾸지 않습니다. 계층별 요약과 전체 결과는 `aidlc-docs/construction/planrepo/code/`에 Markdown으로 만들고 앱·테스트·설정 코드는 프로젝트 루트에 둡니다.

Build and Test의 공식 안내 파일은 그 단계의 규칙을 읽고 생성합니다. 현재 계획 승인으로 그 단계나 Operations/배포를 완료 처리하지 않습니다. 질문·승인은 기존 사용자 선호에 따라 현재 대화에서 받고 감사 기록에 원문을 남깁니다.
