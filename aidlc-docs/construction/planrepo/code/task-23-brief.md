# CG-23 구현 지시서

승인 계획의 과제 발췌입니다. 공통 계약은 `aidlc-docs/construction/planrepo/code/implementation-decisions.md`, Claude 연결은 `aidlc-docs/construction/planrepo/code/claude-execution-decision.md`를 따릅니다. 실행 전 최신 계획과 실제 선행 코드를 확인합니다. 구현·실행 전에는 완료로 집계하지 않습니다.

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

**조회 연결 보완**: `aidlc-docs/construction/planrepo/code/view-readiness.md`의 이 과제 항목을 실제 저장 조회와 DTO에 함께 반영합니다. 필요한 main·HTTP handlers·TestApp·workspace-query-service의 실제 소비 연결도 변경 diff에 포함합니다.

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
