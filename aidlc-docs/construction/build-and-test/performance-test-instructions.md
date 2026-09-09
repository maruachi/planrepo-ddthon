# Performance / Accessibility Verification — PlanRepo mockup (U1)

> No numeric latency/throughput SLA applies (single-user, in-memory, no network — NFR per Q-NFR1=A). Performance verification is qualitative ("feels instant, no jank"); accessibility is included here because it is the substantive non-functional bar for this UI.

## Performance (qualitative)
| Check | Expected |
|---|---|
| Variant switch (V1↔V2↔V3↔V4) | Instant re-render, no visible flash/jank; state preserved |
| Action → state update (save/confirm/approve) | Immediate; toast + aria-live update |
| Initial load | Immediate; no spinner, no network wait (all inline) |
| Memory | Stable across many interactions (in-memory store, no leaks expected) |

Optional: DevTools → Performance → record a variant switch; confirm no long tasks and no layout thrash beyond the single re-render.

## Accessibility (the real NFR bar — NFR-A11Y-*)
| Check | How | Expected |
|---|---|---|
| Color independence | OS grayscale filter, view statuses | All statuses legible via icon + text + count |
| Keyboard operability | Tab through shell, radios, buttons | Visible focus ring everywhere; radios arrow-key navigable |
| Drawer (V4) | Open "맥락 서랍"; press Esc | Opens, focus moves in; Esc closes |
| V2 divider | Focus divider; press ←/→ | Pane width adjusts via keyboard |
| Disabled actions | Inspect any disabled button | Text reason shown (not silently greyed) |
| Label size | Inspect smallest labels | ≥ ~12px (no <11px text) |
| Landmarks / live regions | DevTools accessibility tree | nav/main/complementary present; `aria-live` region announces counters & save-state |

## On failure
Adjust the relevant CSS (focus ring, font-size floor, token markup) or the `announce()`/aria wiring in `index.html`, reload, re-check.
