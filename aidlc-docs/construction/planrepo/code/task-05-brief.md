# CG-05 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, 최신 Claude 실행 결정은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`입니다. 선행 과제의 실제 코드와 테스트를 사용합니다.

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

추가 연결 결정은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md` 9·10과 `aidlc-docs/construction/planrepo/code/http-ui-preflight.md`를 따릅니다. 이 과제의 host/boot 관찰은 강한 프로세스 시작 identity나 복구 완료가 아닙니다.

**실제 선행 API**: TestApp은 open → migrate → seedDemo 또는 test-only empty fixture → registerRuntime 순서를 지킵니다. seedDemo가 내부 offline maintenance를 잡으므로 runtime 등록 뒤 호출하지 않습니다. readDemoManifest(db)는 seed 완료 DB 검증용입니다. empty와 Vite bootstrap은 config/demo의 manifest·scenarios에서 필요한 고정 필드만 읽습니다. cleanup은 저장 오류로 connection이 이미 닫혔을 수 있으므로 db.open을 확인합니다.

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
