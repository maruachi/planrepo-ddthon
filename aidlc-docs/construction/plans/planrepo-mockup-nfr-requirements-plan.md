# NFR Requirements Plan — Unit U1: planrepo-mockup (concise)

> Depth = concise per `execution-plan.md`. Deliverable is a self-contained client-only HTML mockup (§3): NO server, auth, persistence, real AI, or Git. Therefore classic server-side NFRs (scalability/availability/DR/authZ/throughput) are **N/A**; the meaningful NFRs are usability, accessibility, self-containment, integrity, responsiveness, and determinism. Questions below auto-answered on the recommended path (standing authorization 2026-09-08).

## Plan Steps (Step 2)
- [x] Read functional-design artifacts (domain-entities, business-logic-model, business-rules, frontend-components)
- [x] Classify each NFR category as applicable / N/A for a client-only mockup
- [x] Answer context-appropriate questions (recommended path)
- [x] Generate `nfr-requirements.md`
- [x] Generate `tech-stack-decisions.md`

## NFR Category Applicability (Step 3)
| Category | Applies? | Note |
|---|---|---|
| Scalability | N/A | Single-user demo, in-memory seed; no load. |
| Performance | Partial | No latency SLA; only "instant/local, no jank". |
| Availability / DR | N/A | No server; open file / local static serve. |
| Security | N/A | No auth/PII/network/secrets (§3). |
| Reliability (integrity) | **Yes** | Never show unsaved/failed as saved/latest (NFR-INTEGRITY-1). |
| Maintainability | **Yes** | Single readable file, module-organized JS, deterministic. |
| Usability | **Yes** | Two-task speed (T1/T2); comparison across 4 variants. |
| Accessibility | **Yes** | Color-independent status, keyboard, ~12px floor, landmarks. |
| Self-containment | **Yes** | One HTML file, no external fetch/CDN/fonts (NFR-SELF-1). |
| Determinism | **Yes** | Fixed seed, no Date/random; refresh resets (MK-6). |

## Questions (recommended path — auto-answered)

### Q-NFR1. Performance target
- A) "Feels instant" on a normal laptop — all state changes synchronous in-memory, no perceptible delay; no numeric latency SLA (recommended)
- B) Define numeric latency/throughput budgets
- X) Other
- [Answer]: A — single-user in-memory demo; no network or heavy compute. Avoid layout jank on variant switch.

### Q-NFR2. Accessibility bar
- A) WCAG-informed pragmatic bar: never color-only status (text+icon+count), full keyboard operability, visible focus, ~12px label floor, semantic landmarks + aria-live for counters/save-state (recommended)
- B) Formal WCAG 2.1 AA conformance audit
- X) Other
- [Answer]: A — matches NFR-A11Y-* and Q12=C; full AA audit is beyond an MVP mockup but the concrete rules are enforced.

### Q-NFR3. Browser/runtime support
- A) Current evergreen desktop browsers (Chrome/Edge/Firefox/Safari), no IE, no build step (recommended)
- B) Broad legacy support / transpilation
- X) Other
- [Answer]: A — vanilla ES2020+, no bundler; keeps single-file self-containment.

### Q-NFR4. Self-containment strictness
- A) Zero external runtime dependencies — no CDN, no Google Fonts, no network calls; system-font stack; everything inline in one `index.html` (recommended)
- B) Allow pinned CDN assets
- X) Other
- [Answer]: A — NFR-SELF-1; reference mockup's DM Sans/Noto Sans KR Google Fonts replaced with a system-font stack incl. Korean fallback.

### Q-NFR5. Responsive scope
- A) Optimize for desktop (primary review surface); degrade gracefully to narrow widths per variant (V2→tabs, V3→tabs/drawers, V1/V4 stay sequential); Topbar stays fixed (recommended)
- B) Full mobile-first responsive
- X) Other
- [Answer]: A — the tool is a reviewer workbench used on desktop; narrow-width degradation defined in frontend-components §6.

### Q-NFR6. Data integrity emphasis
- A) Hard rule: never render unsaved/failed/stale as saved/latest/approved; every status carries explicit text + the derived gate always recomputes from the single store (recommended)
- B) Best-effort
- X) Other
- [Answer]: A — NFR-INTEGRITY-1 + BR-ANS-4/BR-VER-*; core trust property of the tool.

## Verification
- [x] All server-side NFRs justified as N/A with rationale (no silent omission)
- [x] Applicable NFRs are testable/observable and traced to NFR-*/FR-*/AC IDs
- [x] Extensions all disabled → no security/resiliency/PBT NFR obligations (N/A)
