# CG-27 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

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
