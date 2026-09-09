# NFR Design Patterns — Unit U1: planrepo-mockup

> Front-end patterns realizing the applicable NFRs. All implementable in one self-contained vanilla-JS `index.html` (no deps). Each pattern cites the NFR it satisfies.

## P1 — Central store + pub/sub targeted render (NR-USE-2, NR-INT-3, Performance)
- Single `store` holds the whole object graph. `store.subscribe(fn)` / `store.set(mutator)` notifies subscribers.
- Components register a render fn for their subtree; on change they re-render only their subtree → no full-page repaint, no scroll/focus loss.
- **Variant switch** swaps ONLY the center-region renderer; shell, Topbar, and store are untouched → all state/selection preserved across variants (isolates layout as the single comparison variable).

## P2 — StatusToken primitive: never color-only (NR-A11Y-1, NR-INT-1, BR-A11Y-1)
- One `StatusToken(kind, {count})` primitive renders **swatch + icon + text label (+ count)** together; there is no API to render a bare colored dot.
- Palette maps status→color for at-a-glance scanning, but legibility never depends on it (grayscale test passes by construction).
- Used for every AnswerState / SaveState / ReviewStatus / AiStatus / VersionStatus / RrState / Gate badge.

## P3 — Derived-gate binding: no cached booleans (NR-INT-2/3, FR-GATE-*)
- `gateService.evaluate(gate, ctx) → {passed, unmet:[{key,label}]}` is a pure function recomputed whenever an action button renders.
- `ActionButton` binds `enabled = passed && roleAllows` and always renders `disabledReason` (the unmet list / role reason) when disabled — satisfies NR-A11Y-5.
- `canApprove(docId, viewingVersion)` similarly derived → past-version screens cannot approve latest (NR-INT-2, AC-5).

## P4 — Integrity guards on mutating actions (NR-INT-1/4, BR-ANS-4, AC-6/7/10/12)
- `saveAnswer` sets SaveState truthfully (`저장중`→`저장됨`/`저장실패`); never optimistic "saved".
- `submitFix` keeps `blocking=true` — only the requesting reviewer's `confirmFix` clears it (submitter≠confirmer enforced).
- `startRun` guards: unsaved-answer block, duplicate-run block (shows target+input version), plan-approval gate; input-changed → output tagged "이전 입력 기준 초안", never overwrites latest.
- `answerParser.validate` surfaces missing-`[Answer]`/duplicate-number/format errors with line/section location; the unanswered tally never reports errors as "0 issues".

## P5 — Accessibility interaction pattern (NR-A11Y-2/3/4)
- Landmarks: `<nav>` sidebar, `<main>` detail, `<aside role="complementary">` docks/drawers.
- Roving-tabindex within card lists and radio groups (arrow-key navigation); visible focus ring on all interactive elements.
- `Drawer` = focus-trap slide-over, Esc closes, returns focus to trigger.
- `aria-live="polite"` regions announce counter changes, save-state changes, and focus-card transitions (V4).
- Type: 13px base, ~12px label floor (no <11px text).

## P6 — Responsive layout pattern (NR-RESP-1, US-H2)
- CSS grid per variant: V1 single column, V2 two-pane (draggable divider), V3 three-pane (280/fluid/360), V4 single focus card + step strip.
- Breakpoints collapse: V2 → top tabs (질문·결정 | 변경 검토) + drawer; V3 → tabs/left+right drawers; V1/V4 remain sequential (already narrow-friendly).
- Topbar `position: sticky; top:0` so SR context (지금 필요한 행동·차단 이유) stays visible while scrolling.

## P7 — Determinism & reset pattern (NR-DET-1/2, MK-6)
- `seed.buildInitialState()` constructs the full graph with **fixed timestamp strings**; app code never calls `Date.now()`/`new Date()`/`Math.random()`.
- `reset()` = re-run seed builder + re-render; a persistent ResetBanner states "새로고침 시 데모 상태로 초기화됩니다".

## P8 — Module boundaries for maintainability (NR-MAINT-1)
- Namespaced modules within the single file: `store`, `answerParser`, `versionService`, `reviewService`, `gateService`, `policyService`, `roleService`, `aiRunService`, `variantController`, `seed`; pure functions for diff/gate/parse (deterministic, unit-checkable by inspection).

## N/A pattern families (justified)
Resilience / Scalability / Security infra patterns — N/A: no network, no concurrency, no auth, single-user in-memory mockup (§3). "AI 실패/취소/재개" are *simulated display states* (P4), not real fault-tolerance mechanisms.
