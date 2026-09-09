# CG-08 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약 해석은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, 최신 Claude 실행 결정은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`입니다. 선행 과제의 실제 코드와 테스트를 사용합니다.

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
