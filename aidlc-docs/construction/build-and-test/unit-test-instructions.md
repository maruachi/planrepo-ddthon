# Unit / Static Verification — PlanRepo mockup (U1)

> This single-file mockup ships no separate automated unit-test suite (no build/test runner — appropriate to a self-contained HTML PoC). Unit-level correctness is verified by (a) the automated static checks below and (b) the manual per-widget checks. The pure functions (`gateService.evaluate`, `versionService.getDiff/canApprove`, `answerParser`) are deterministic and inspectable.

## A. Automated static checks (repeatable)
Run from the workspace root:
```bash
# 1) No external dependencies / network refs
grep -nEi "https?://|cdn\.|googleapis|fonts\.google|integrity=|src=\"http" index.html || echo "PASS: no external refs"

# 2) Determinism — no wall-clock / randomness in app code
grep -nE "Date\.now|new Date|Math\.random" index.html || echo "PASS: deterministic"

# 3) Structural sanity of the inline script (balanced brackets, even backticks)
python3 - <<'PY'
import re
js=re.findall(r"<script>(.*?)</script>", open("index.html",encoding="utf-8").read(), re.S)[-1]
ok=all(js.count(a)==js.count(b) for a,b in ["{}","()","[]"]) and js.count("`")%2==0
print("PASS: structure balanced" if ok else "FAIL: structure")
PY
```
**Expected**: all three print PASS. (These were run at generation time and passed.)

## B. Manual per-widget checks
| Widget | Check | Expected |
|---|---|---|
| StatusToken | View any status; switch OS to grayscale (or squint) | Still legible via icon + text + count (never color-only) |
| QuestionCard | Pick a choice on Q2 → observe status | State goes 미답변 → 편집중(미저장); "답변 저장" enables |
| Save vs Confirm | As 개발자 save Q2; then switch role to 결정권자 | "결정 확정" enables only for 결정권자 after save |
| Role gating | As 요청자, look at action buttons | Disabled with explicit reason text (not silently greyed) |
| VersionTimeline | Click v1/v2 then v3 | Past versions block approval with "최신으로 이동"; v3 allows |
| ParseErrorCard | Observe Q4/Q6 | Listed with kind + line location; counted, not hidden as 0 |
| Gate panels | Observe unmet lists | Numeric + textual unmet conditions; recompute after each action |

## C. Fix on failure
If a manual check fails, edit `index.html` (the relevant widget/service function), reload the browser, and re-run section A.
