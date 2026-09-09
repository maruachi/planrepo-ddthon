# CG-26 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

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
