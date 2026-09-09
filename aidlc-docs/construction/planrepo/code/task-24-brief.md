# CG-24 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

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
