# Tech Stack Decisions — Unit U1: planrepo-mockup

> Constrained by §3 (no server/build/deps) + NFR-SELF-1 (self-contained) + the reference mockup's stack. Decisions favor the simplest thing that satisfies self-containment, determinism, and accessibility.

## Decisions
| Concern | Decision | Rationale | Traces |
|---|---|---|---|
| Delivery format | Single self-contained `index.html` (inline `<style>` + `<script>`) at workspace root | NFR-SELF-1; opens via `file://`; matches reference mockup's no-build model | MK-1, NR-SELF-1 |
| Language | Vanilla JavaScript (ES2020+), no framework | No build step; small enough for hand-written modules; evergreen-browser native | NR-SELF-1, NR-MAINT-1 |
| Module organization | IIFE/namespaced modules inside one file (store, answerParser, versionService, reviewService, gateService, policyService, roleService, aiRunService, variantController, seed) | Maintainability + testable pure functions without bundler | services.md, NR-MAINT-1 |
| State management | Single in-memory store + pub/sub subscribe/render | Single source of truth; deterministic; 4 variants share it | Q-FD1, Q-FD6, NR-USE-2 |
| Rendering | Function components that read store & return DOM/HTML strings; re-render on store change | No virtual-DOM lib needed at this scale; keeps self-containment | frontend-components.md |
| Styling | Inline CSS with the fixed Autumn palette as CSS custom properties; CSS grid/flex for the 4 layouts | Palette locked across variants (isolate layout variable); responsive via grid | NFR-VIS-1, NR-RESP-1 |
| Fonts | System-font stack incl. Korean fallback (NO Google Fonts) | NFR-SELF-1 (no network); replaces reference DM Sans/Noto Sans KR | NR-SELF-2 |
| Icons | Unicode glyphs / inline SVG only | No icon CDN; supports color-independent status (icon + text) | NR-A11Y-1, NR-SELF-1 |
| Base type size | 13px base, ~12px label floor | Density + readability floor | Q12=C, NR-A11Y-3 |
| Persistence | None — in-memory only; refresh resets to seed | MK-6 demo reset; determinism | NR-DET-2 |
| Time/randomness | Fixed seed timestamp strings; no `Date.now()`/`Math.random()` | Deterministic, reproducible render | NR-DET-1 |
| Local serving | Optional `python3 -m http.server` (static) for a clean origin; `file://` also works | Satisfies "서버까지 띄워줘" without violating §3 (no application backend) | Build & Test |

## Rejected alternatives
- **React/Vue/Svelte + bundler** — rejected: requires build/deps, breaks single-file self-containment (NFR-SELF-1).
- **CDN-hosted fonts/icons/CSS** — rejected: network dependency; fails offline `file://` requirement.
- **localStorage/IndexedDB persistence** — rejected: MK-6 requires refresh to reset to the seeded demo state.
- **Any backend (Node/DB/API)** — rejected: §3 places server/persistence/auth/real-AI/Git out of scope.
