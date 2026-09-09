# NFR Design Plan — Unit U1: planrepo-mockup (concise)

> Turns the applicable NFRs (usability, a11y, self-containment, integrity, responsive, determinism, maintainability) into concrete front-end design patterns + logical components. Server-side pattern families (resilience/scaling/perf-infra/security) are N/A for a client-only mockup (§3). Questions auto-answered on the recommended path.

## Plan Steps (Step 2)
- [x] Read nfr-requirements artifacts
- [x] Map each applicable NFR → design pattern(s)
- [x] Define logical components realizing the patterns
- [x] Generate `nfr-design-patterns.md`
- [x] Generate `logical-components.md`

## Category Evaluation (Step 3, all categories)
| Category | Applies? | Justification |
|---|---|---|
| Resilience Patterns | N/A | No network/process to fail; only in-app "AI 실패/취소/재개" states are simulated by seed + guards (not real fault tolerance). |
| Scalability Patterns | N/A | Single-user, fixed seed; no load boundary. |
| Performance Patterns | Partial | Only client render perf → targeted-render + no-layout-jank on variant switch. |
| Security Patterns | N/A | No auth/network/secrets/PII. |
| Logical Components | **Yes** | Client modules + cross-cutting UI patterns (status token, gate evaluator, drawer) — see logical-components.md. |
| + Usability/A11y/Integrity/Determinism (mockup-relevant) | **Yes** | Primary NFRs — full pattern set below. |

## Questions (recommended path — auto-answered)

### Q-ND1. Render/update pattern
- A) Central store + pub/sub; subscribers re-render their own subtree on change (targeted render), variant switch swaps only the center-region renderer (recommended)
- B) Full-page re-render on every change
- X) Other
- [Answer]: A — avoids jank (NR-USE-2 state preserved), keeps single source of truth (NR-INT-3).

### Q-ND2. Status representation pattern
- A) Single `StatusToken` primitive that always renders {color-swatch + icon + text label + optional count}; forbid color-only usage anywhere (recommended)
- B) Ad-hoc colored dots per screen
- X) Other
- [Answer]: A — enforces NR-A11Y-1 / BR-A11Y-1 uniformly and makes the grayscale-legible test pass by construction.

### Q-ND3. Gate/derived-state pattern
- A) Pure `gateService.evaluate(gate, ctx)` recomputed on read; UI binds button enabled-state + disabled-reason to it; no cached gate flags (recommended)
- B) Store computed gate booleans as entity fields
- X) Other
- [Answer]: A — NR-INT-3; single source of truth; always-fresh unmet-condition list.

### Q-ND4. Accessibility interaction pattern
- A) Landmark regions + roving-tabindex for card/radio groups + focus-trap Drawer (Esc closes) + `aria-live` polite regions for counters/save-state/card-transition (recommended)
- B) Rely on native tab order only
- X) Other
- [Answer]: A — realizes NR-A11Y-2/4.

### Q-ND5. Responsive pattern
- A) CSS-grid layouts with per-variant breakpoints; container-driven collapse to tabs/drawers (V2/V3) while V1/V4 stay sequential; Topbar `position: sticky` (recommended)
- B) Fixed desktop-only widths
- X) Other
- [Answer]: A — NR-RESP-1 + US-H2.

### Q-ND6. Determinism pattern
- A) Seed builder produces the entire object graph with fixed timestamp strings; `reset()` rebuilds it; zero `Date`/`Math.random` in app code (recommended)
- B) Generate timestamps at load
- X) Other
- [Answer]: A — NR-DET-1/2, reproducible render.

## Verification
- [x] Every applicable NFR maps to ≥1 concrete pattern + logical component
- [x] N/A categories justified (no silent skip)
- [x] Patterns are implementable in vanilla JS single-file (no deps)
