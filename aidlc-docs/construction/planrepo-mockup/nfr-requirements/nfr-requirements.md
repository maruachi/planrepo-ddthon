# NFR Requirements — Unit U1: planrepo-mockup

> Client-only, single-user, self-contained HTML mockup (§3). Server-side NFR families (scalability, availability/DR, authZ, throughput) are **N/A** by scope — documented below so the omission is explicit, not accidental. Applicable NFRs are measurable and traced to requirement IDs.

## 1. Applicable NFRs (measurable)

### NFR-U1-USABILITY — Two-task speed & comparability
- **NR-USE-1**: Each of the 4 variants must let a user (a) find "the question I must answer now" (T1) and (b) confirm "what changed since my last review" (T2) without leaving the SR-detail center region. *Measure:* both tasks reachable in ≤2 interactions from SR open in every variant. (US-H1, FR-STG-6)
- **NR-USE-2**: Variants differ ONLY in information placement/density — same store, same data, same palette — so a comparison isolates layout as the single variable. *Measure:* switching variant preserves all state/selection. (NFR-VIS-1, Q-FD6)
- **NR-USE-3**: The four actions (답변 저장 / 결정 확정 / 생성 계획 승인 / 설계 산출물 승인) are visually and interactively distinct in every variant. (FR-QN-14, BR-ACT-1)

### NFR-U1-A11Y — Accessibility (pragmatic, WCAG-informed)
- **NR-A11Y-1**: No status conveyed by color alone — every status shows text + icon + count. *Measure:* grayscale render still fully legible. (NFR-A11Y-1, BR-A11Y-1, Q12=C)
- **NR-A11Y-2**: Full keyboard operability — tab order, visible focus ring, radio arrow-keys, drawer focus-trap + Esc. (NFR-A11Y-2)
- **NR-A11Y-3**: Minimum label size ~12px (no <11px text). (Q12=C)
- **NR-A11Y-4**: Semantic landmarks (nav/main/complementary), `aria-live` on counters, save-state, and focus-card transitions. (NFR-A11Y-3)
- **NR-A11Y-5**: Disabled actions expose a text reason (not silently greyed). (BR-ROLE-1, BR-GATE-1)

### NFR-U1-SELF — Self-containment
- **NR-SELF-1**: Single `index.html` at workspace root with all HTML/CSS/JS inline; zero external runtime deps — no CDN, no web fonts, no network calls. *Measure:* opens fully functional offline via `file://`. (NFR-SELF-1, MK-1)
- **NR-SELF-2**: System-font stack incl. Korean fallback (`-apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`) replaces Google Fonts. (NFR-SELF-1)

### NFR-U1-INTEGRITY — Data integrity / trust
- **NR-INT-1**: Never render unsaved/failed as saved, or non-latest as latest/approved. *Measure:* SaveState/VersionStatus badges always reflect true store state. (NFR-INTEGRITY-1, BR-ANS-4)
- **NR-INT-2**: Approval is pinned to (docId, version); past-version screens cannot approve latest. (FR-VER-1/3, BR-VER-1/3, AC-4/5)
- **NR-INT-3**: Gates recompute from the single store on every relevant change (no stale cached pass/fail). (Q-FD4, FR-GATE-*)
- **NR-INT-4**: Parser never hides `[Answer]`-missing / duplicate-number / format errors as "0 issues". (FR-QN-13, AC-12)

### NFR-U1-RESPONSIVE — Responsive degradation
- **NR-RESP-1**: Desktop-first; each variant has a defined narrow-width behavior (V2→tabs, V3→tabs/drawers, V1/V4 sequential); Topbar context stays fixed while scrolling. (US-H2, frontend-components §6)

### NFR-U1-DETERMINISM — Determinism & reset
- **NR-DET-1**: No `Date.now()`/`Math.random()`; seed uses fixed timestamp strings → identical render every load. *Measure:* two fresh loads are byte-identical in rendered state.
- **NR-DET-2**: Refresh fully resets to the seeded demo state; an on-screen reset banner states this. (MK-6)

### NFR-U1-MAINTAIN — Maintainability
- **NR-MAINT-1**: JS organized into the named client modules (store, answerParser, versionService, reviewService, gateService, policyService, roleService, aiRunService, variantController, seed) even within one file; pure functions for diff/gate/parse. (services.md, business-logic-model §7)

## 2. Explicitly N/A (by §3 scope) — with rationale
| NFR family | Status | Rationale |
|---|---|---|
| Scalability / capacity | N/A | Single-user, fixed in-memory seed; no load or growth. |
| Throughput / concurrency | N/A | No server, no concurrent writers. |
| Availability / uptime / DR / failover | N/A | No hosted service; open file or local static serve. |
| Security (authN/authZ, encryption, secrets, PII) | N/A | No auth, no network, no real data (roles are demo view-switch only). |
| Compliance (GDPR/PCI/etc.) | N/A | No data collection or transmission. |
| Observability / alerting / logging infra | N/A | No runtime backend to monitor. |

## 3. Extension NFR obligations
Security Baseline / Resiliency Baseline / Property-Based Testing all **disabled** at Requirements Analysis → no extension-imposed NFRs (N/A, non-blocking).
