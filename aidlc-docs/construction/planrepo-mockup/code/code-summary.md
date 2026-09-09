# Code Summary — Unit U1: planrepo-mockup

> Markdown summary of generated code (application code lives at workspace root, NOT here). Per the code-generation plan, the whole app is ONE self-contained file.

## Files
| File | Type | Notes |
|---|---|---|
| `/mnt/c/Users/82105/ddton/index.html` | Application (created) | Entire app: inline HTML + CSS + JS. ~1160 lines. Opens via `file://` or any static server. Zero external deps. |
| `aidlc-docs/construction/planrepo-mockup/code/code-summary.md` | Doc (this file) | Summary only. |

## Internal module map (namespaced sections in the single `<script>`)
| Module | Role |
|---|---|
| `buildInitialState()` (seed) | Fixed-timestamp object graph — SR-1024 (table-order-ddthon), units U1주문/U2메뉴/U3결제, DOC-U2-FUNC v1✓/v2✓/v3-draft(+diff), Q2/Q3/Q5/Q7 + parser-error Q4/Q6, RR-2, RUN-U2-03, 6 users. No Date/random. |
| `store` | Single in-memory tree + pub/sub (`init/get/set/subscribe/reset`). |
| `roleService` | Which role may perform which action + reason. |
| `answerParser` | `applyAnswer` (target [Answer] only), `errors` (parser errors w/ location). |
| `versionService` | `versionsOf`, `canApprove` (past-version block), `getDiff`, `confirmToDoc`. |
| `gateService` | Pure `evaluate(gate)` for AI실행 / 문서승인 / 다음단계인계 — derived, uncached. |
| `reviewService` | `needNow` — the "지금 필요한 행동" priority resolver. |
| `aiRunService` | `canStart` guard (delegates to gate). |
| widgets | `tok`/StatusToken, `actionBtn`, `questionCard`, `parseErrorCard`, `versionTimeline`, `diffView`, `revisionPanel`, `aiRunPanel`, `approvalPanel`, `gatePanel`, `docTree`, `unitTimeline`, `handoffContext`, `drawer`. |
| `variants` | V1 단일 컬럼 · V2 2-pane 비교 · V3 3-pane 콕핏 · V4 점진 공개 위저드 — share store; layout only. |
| shell | `sidebar`/`boardView`/`inboxView`/`topbar`/`detailView`/`render`. |
| events | Delegated click/change on `#app`; Esc closes drawer; V2 divider drag + ←/→ resize. |

## §12 Acceptance-criteria coverage (how to see each in the running mockup)
| AC | Where |
|---|---|
| AC-1 원문 보존·지정 Answer만 | Answer a question → only that decision changes; choice text preserved. |
| AC-2 저장≠확정≠승인 | Q card: "답변 저장"(개발자)→제안됨; "결정 확정"(결정권자) separate; approval separate. Toasts state the distinction. |
| AC-3 후속 질문 실행 이어감 | Q7 card shows parent RUN-U2-03 link + "실행 이어감" note; AI panel "후속 답변 후 실행 계속". |
| AC-4 v2 승인 후 v3 재승인 | Version timeline: v1✓ v2✓ v3 draft needs its own approval. |
| AC-5 과거 버전 승인 불가 | Click v1/v2 in timeline → approval blocked with "최신으로 이동". |
| AC-6 제출 후 확인 전 차단 | RR-2: "수정 완료 제출" keeps blocking; only reviewer 박민지 "수정 확인" clears. |
| AC-7 수정 초안 미해결 | RR panel + AI note: draft doesn't auto-resolve original. |
| AC-8 재검토 필요 전파 | v3 `staleReview` → shown; handoff gate lists "입력 변경 영향". |
| AC-9 실패·재시작 복구 | AI panel note + refresh resets to seed (reset banner). |
| AC-10 입력 변경·중복 방지 | AI panel "startRun" disabled with duplicate/unsaved/req reasons. |
| AC-11 Git 없이 구현 대기 | Handoff gate → "다음 단계로 인계" moves to 구현 대기; note "Git 쓰기 없음". |
| AC-12 파서 오류 구별 | ParseErrorCard lists Q4(중복번호)/Q6(Answer누락) with line locations; not hidden as 0. |

## How to run
- **Simplest:** open `index.html` directly in a browser (`file://`).
- **Local static server (clean origin):** from the workspace root run `python3 -m http.server 8080 --bind 127.0.0.1`, then open `http://127.0.0.1:8080/index.html`.
- Refresh resets to the seeded demo state (MK-6).

## Verification performed (self-check, Step 10)
- No external references (grep: no http(s)/CDN/googleapis/fonts). ✅
- No `Date.now`/`new Date`/`Math.random` in app code (determinism). ✅
- Inline JS structurally sound: braces `{}`/`()`/`[]` balanced, backticks even; all dispatched actions have handlers (`v2drag` handled by drag/keydown listeners). ✅
- Served over HTTP 200, byte-identical to source. ✅
- Statuses use color + icon + text (grayscale-legible by construction via StatusToken). ✅
