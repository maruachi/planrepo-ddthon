# Integration / End-to-End Verification — PlanRepo mockup (U1)

> "Integration" here = interactions between the client modules (store ↔ services ↔ widgets ↔ variants) and the end-to-end task flows. There is a single unit and no services to network together, so these are browser-driven E2E scenarios. `data-testid` attributes are present on interactive elements for future automation (e.g. Playwright), though no automated harness is bundled.

## Setup
Open `http://127.0.0.1:8080/index.html` (or `file://.../index.html`). Refresh any time to reset to seed (MK-6).

## Scenario 1 — T1: find & answer the question due now
1. Sidebar → "SR 상세 (SR-1024)". Read Topbar "지금 필요한 행동".
2. In the question area, pick a choice on **Q2**. → status 편집중(미저장).
3. Click **답변 저장** (role 개발자). → status 제안됨; toast states "제안됨 (확정 아님)". **(AC-1, AC-2)**
4. Switch role → **결정권자**; click **결정 확정** on Q2. → status 확정됨; doc reflected. **(AC-2)**

## Scenario 2 — T2: confirm what changed since last review, then approve
1. In the review region, read the v2→v3 diff (added/modified lines tagged 신규·미검토 / 수정). **(FR-REV)**
2. Click v2 in the timeline → approval blocked ("최신으로 이동"). Click v3. **(AC-5)**
3. Fix parser errors (Q4, Q6) via "오류 수정". **(AC-12)**
4. Confirm required decisions (Q2, Q3). Switch role → **리뷰어**; tick the checklist. **(AC-4)**
5. Resolve **RR-2**: as 개발자 the fix is already submitted (수정확인대기); switch to **리뷰어** (박민지) and click **수정 확인**. → blocking clears. **(AC-6, AC-7)**
6. Click **설계 산출물 승인**. → v3 승인; unit reviewStatus 승인완료.

## Scenario 3 — gate to 구현 대기 (no Git)
1. With decisions confirmed, RR resolved, parser clean, checklist done, and v3 approved: the **다음 단계 인계** gate shows 조건 충족.
2. Switch role → **리더** or **리뷰어**; click **다음 단계로 인계**. → SR stage becomes 구현 대기; toast "Git 쓰기 없음". **(AC-11)**
3. (Alt) Before conditions are met, as **리더** use **예외 진행** → records reason+actor, badge shown; does NOT mark unapproved as complete. **(FR-GATE-4)**

## Scenario 4 — cross-variant consistency (the comparison purpose)
1. Perform Scenario 1 steps 1-3 in **V1**.
2. Switch the "화면 구성" selector to **V2**, **V3**, **V4** in turn.
3. **Expected**: the same store state is reflected in every variant (Q2 remains 제안됨; same diff, same gate states). Only the information LAYOUT differs. **(NFR-VIS-1)** This is the core artifact for choosing the fastest layout for T1+T2.

## Scenario 5 — AI run guards
1. Open the AI panel. "산출물 생성 시작" is disabled with reasons (미확정/파서오류/중복 실행). **(AC-10)**
2. Confirm Q7 (후속) then "후속 답변 후 실행 계속" → status 초안준비. **(AC-3)**

## Cleanup
Refresh the browser (resets to seed). Stop the server with Ctrl-C if running.
