# Initial SR Prompt Selection Hotfix — Build and Test Plan

## Checklist

- [x] Step 1 — Load the Build and Test rules, generated artifacts and Code Generation approval.
- [x] Step 2 — Classify tests: prompt builder/runner units, Worktree service integration, full regression and production build.
- [x] Step 3 — Mark performance, microservice contract, security certification and browser E2E load testing N/A for this local prompt-only Hotfix.
- [x] Step 4 — Run full TypeScript typecheck — passed.
- [x] Step 5 — Run focused prompt, runner, Worktree integration and document-history tests — 4 files/18 tests passed.
- [x] Step 6 — Run the full worker/test suite — 43 files/160 tests passed.
- [x] Step 7 — Run the production build and `git diff --check` — both passed; only the existing client chunk advisory remains.
- [x] Step 8 — Append this Hotfix's build, unit, integration, performance and summary instructions to the existing shared documents.
- [x] Step 9 — Validate documentation, update state/audit and create the Operations approval gate.

## Extension Scope

- Security Baseline: disabled; N/A.
- Resiliency Baseline: disabled; N/A.
- Property-Based Testing Partial: PBT-03, PBT-07, PBT-08 and PBT-09 applicable; PBT-02 N/A.
