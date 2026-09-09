# CG-25 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

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
