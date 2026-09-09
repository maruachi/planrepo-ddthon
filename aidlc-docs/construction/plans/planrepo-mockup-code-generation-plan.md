# Code Generation Plan — Unit U1: planrepo-mockup

> Single source of truth for Code Generation. Deliverable = ONE self-contained `index.html` at workspace root (`/mnt/c/Users/82105/ddton/index.html`) — all HTML/CSS/JS inline, no external deps (NFR-SELF-1). Standing authorization (2026-09-08) auto-approves this plan and its execution on the recommended path.

## Unit Context
- **Unit**: U1 planrepo-mockup (single self-contained front-end mockup).
- **Stories covered**: all epics US-A..US-I; the two hero tasks T1 (find the question to answer now) + T2 (confirm what changed since last review); §12 AC-1..12 representable in seeded state.
- **Dependencies**: none (no other units; no server/API/DB).
- **Interfaces/contracts**: none external. Internal module contracts per `services.md` / `logical-components.md`.
- **Entities owned**: all client-domain entities (in-memory), seeded from table-order-ddthon SR-1024.

## Code Location (greenfield, single unit, no build)
- **Application code**: `/mnt/c/Users/82105/ddton/index.html` (the whole app).
- **Docs (markdown summaries only)**: `aidlc-docs/construction/planrepo-mockup/code/`.
- Standard `src/tests/config` layout is intentionally collapsed into one file — required by NFR-SELF-1 (single self-contained HTML). Documented deviation from the generic greenfield pattern.

## Generation Approach
Author ONE cohesive file directly (not fanned out) — an HTML mockup is a single tightly-coupled artifact (shared store, shared palette, cross-variant consistency); splitting would harm coherence. Internal structure still follows the module boundaries from design (store, answerParser, versionService, reviewService, gateService, policyService, roleService, aiRunService, variantController, seed) as namespaced sections within one `<script>`.

## Steps (numbered; checkboxes)
- [x] **Step 1** — Project structure decision: single `index.html` at workspace root (no `src/` tree). No package manager, no build. (NFR-SELF-1)
- [x] **Step 2** — `<head>` + inline CSS: Autumn palette as CSS custom properties (locked, identical across variants — NFR-VIS-1), system-font stack incl. Korean fallback (no Google Fonts — NR-SELF-2), 13px base / ~12px label floor, focus-visible rings, StatusToken styles, 4 variant layout grids + responsive breakpoints (P2/P5/P6). [US-VIS, NFR-A11Y-*]
- [x] **Step 3** — Domain + seed (`seed.buildInitialState`): full object graph with FIXED timestamps (no Date/random) — SR-1024, units U1주문/U2메뉴/U3결제, DOC-U2-FUNC v1✓/v2✓/v3-draft, questions Q2-Q7, parser errors Q4/Q6, RR-2, RUN-U2-03, 6 users/roles. [MK-4, NR-DET-1]
- [x] **Step 4** — `store` (single tree + pub/sub) + `reset()` + ResetBanner. [P1, P7, MK-6]
- [x] **Step 5** — Business-logic services (pure where possible): answerParser (parse/applyAnswer/validate), versionService (createVersionOnConfirm/getDiff/canApprove/propagateStaleReview), gateService (evaluate/exceptionAdvance), reviewService, policyService, roleService, aiRunService. [FR-QN/VER/GATE/RR/AI-*, AC-1..12]
- [x] **Step 6** — Shared UI widgets: StatusToken, ActionButton (enabled+disabledReason), QuestionCard, AnswerRadioGroup, SaveStateIndicator, ParseErrorCard, VersionDiffView, VersionTimeline, ReviewChecklist, ApprovalPanel, RevisionRequestPanel, AiRunInline, GatePanel, PolicySelector, DocTree, Drawer (focus-trap), LiveRegion, HandoffContextView, StatusBadge. `data-testid` on interactive elements. [frontend-components.md, automation rules]
- [x] **Step 7** — Shell: Sidebar (nav + RoleSwitcher + VariantSwitcher + ResetBanner), SkipLink, Board (4 columns + SrCard), Inbox (filter tabs + rows), SrDetail (sticky Topbar + variant center slot). [US-B/US-H]
- [x] **Step 8** — 4 center-region variants sharing the store (variantController swaps only the center renderer): V1 단일 컬럼, V2 2-pane 비교, V3 3-pane 콕핏, V4 점진 공개(위저드+Drawer). [NFR-VIS-1, D-AD-1]
- [x] **Step 9** — Wire interactions/handlers for T1 & T2 + four actions + three gates + revision lifecycle + parser errors + AI guards; aria-live announcements. [AC-1..12]
- [x] **Step 10** — Self-check pass: open logic review against AC checklist; ensure no external requests, no Date/random in app code, grayscale-legible statuses.
- [x] **Step 11** — Documentation summary at `aidlc-docs/construction/planrepo-mockup/code/code-summary.md` (file map, module list, AC coverage, how-to-run).

## Story / AC Traceability (summary)
- T1/T2 → Steps 7-9. Four actions (FR-QN-14) → Steps 6,9. Gates (FR-GATE) → Steps 5,6,9. Version-pinned approval (AC-4/5) → Steps 5,6. Revision lifecycle (AC-6/7) → Steps 5,6,9. Parser errors (AC-1/12) → Steps 5,6. AI states (AC-3/9/10) → Steps 5,6. Self-containment/determinism/reset (MK-1/6) → Steps 1-4. All 4 variants (NFR-VIS-1) → Step 8.

## Scope note
~1 application file + 1 doc summary. ~11 steps. No tests generated as separate files (single-file mockup); a self-verification checklist (Step 10) + Build & Test instructions substitute, appropriate to a no-build client mockup.
