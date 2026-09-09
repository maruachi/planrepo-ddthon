# CG-28 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

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
