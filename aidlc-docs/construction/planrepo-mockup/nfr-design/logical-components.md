# Logical Components — Unit U1: planrepo-mockup

> The logical (client-side) components that realize the NFR design patterns. No infrastructure components (queues/caches/circuit-breakers/LBs) — those are N/A for a client-only mockup. These map 1:1 onto the JS modules that will be generated inline in `index.html`.

## Core state
| Component | Responsibility | Realizes patterns |
|---|---|---|
| `store` | Single in-memory object graph; `get`/`set(mutator)`/`subscribe`; notifies subscribers on change | P1, P7 |
| `seed` | `buildInitialState()` with fixed timestamps (table-order-ddthon SR-1024/U2); `reset()` | P7 |

## Domain services (pure where possible)
| Component | Responsibility | Realizes |
|---|---|---|
| `answerParser` | `parse` / `applyAnswer` (only the target `[Answer]` line) / `validate` (errors w/ location) | P4 |
| `versionService` | `createVersionOnConfirm`, `getDiff`, `canApprove`, `propagateStaleReview` | P3, P4 |
| `reviewService` | Assemble the fixed 5-region review view; checklist state | P4 |
| `gateService` | Pure `evaluate(gate, ctx)`; `exceptionAdvance` (leader) | P3 |
| `policyService` | Per-SR policy + reviewer set; snapshot at approval time | P3 |
| `roleService` | Active role; which actions each role may perform + reason when not | P3 |
| `aiRunService` | Simulated run states + guards (unsaved/duplicate/plan/input-changed); follow-up run linkage | P4 |
| `variantController` | Which variant is active; swaps center-region renderer only | P1 |

## Cross-cutting UI primitives
| Component | Responsibility | Realizes |
|---|---|---|
| `StatusToken` | swatch + icon + text (+count); the ONLY way to show status | P2 |
| `ActionButton` | binds enabled=(gate.passed && roleAllows); always renders disabledReason | P3, P5 |
| `Drawer` | focus-trap slide-over, Esc-close, focus return | P5, P6 |
| `LiveRegion` | `aria-live=polite` announcer for counters/save-state/card transitions | P5 |
| `ResetBanner` | states refresh-resets-to-seed | P7 |
| layout grids (V1/V2/V3/V4) | per-variant CSS grid + breakpoints; sticky Topbar | P6 |

## Data-flow (single direction)
```
UI event → service method → store.set(mutator) → subscribers re-render (targeted)
                                   ↑
              gateService.evaluate / versionService.canApprove read store (derived, uncached)
```
No component writes another component's state directly; all mutations funnel through `store` (single source of truth) — supports integrity (P4) and determinism (P7).

## Explicitly absent (N/A)
Message queues, caches, circuit breakers, load balancers, connection pools, auth/session stores, retry/backoff controllers — none apply: no server, network, concurrency, or persistence (§3).
