# Manual Board Status Movement Verification

## Environment

- Node: 24.7.0
- Git: 2.39.5
- Vitest: 5.0.0
- fast-check: 4.9.0
- PBT seed: 424242

## Results

| Check | Command | Result |
| --- | --- | --- |
| Pre-implementation baseline | `npm test` | 122 tests: 119 passed, 3 pre-existing migration-version expectation failures |
| Focused Hotfix suite | `vitest run` with board property/client/migration/storage/service/HTTP files | Passed: 6 files, 23 tests |
| Impacted regression suite | `vitest run` with operation, planning/review migrations, review and worktree persistence/review files | Passed: 7 files, 17 tests |
| TypeScript | `npm run typecheck` | Passed: client, server and test projects |
| Full suite | `npm test` | Passed: 36 files, 133 tests; worker build passed |
| Production build | `npm run build` | Passed: 309 modules transformed |
| Markdown/code whitespace | `git diff --check` | Passed |
| Duplicate brownfield files | `_new` and `_modified` scan under `src` and `tests` | None |
| Dependency changes | `git diff -- package.json package-lock.json` | None |

The three baseline failures expected schema version 4 while a concurrent worktree-review migration had already produced version 5. Migration coordination allocated this Hotfix to v6, and the current coordinated suite passes. No unrelated failure remains in the captured full-suite run.

## Acceptance Evidence

1. First, middle and last column behavior is covered by generated canonical columns plus explicit boundary rendering.
2. Both movement directions use the same adjacent-column function and service validation.
3. HTTP tests cover success, stale conflict, non-adjacent rejection, invalid columns and strict body validation.
4. Storage and service tests prove board projection persistence while SR/workflow state remains unchanged.
5. Reusing one operation ID returns the committed board item without moving again, including after database reopen.
6. Render-level assertions verify accessible names, disabled boundary controls and that buttons are not nested inside the detail link.

## Property-Based Testing Evidence

- Reusable generators: canonical `Column` values and `previous | next` directions.
- Property 1: every generated move is exactly one canonical index step or undefined at a boundary.
- Property 2: every valid adjacent move followed by its inverse returns the original column.
- Each property runs at least 150 cases with fixed seed 424242.
- fast-check default shrinking remains enabled; no cases are filtered except the valid-move precondition for the inverse property.
- PBT-02, PBT-03, PBT-07, PBT-08 and PBT-09 are compliant.

## Limitations

- No live browser smoke test was run; client/render tests, typecheck and the production bundle cover the UI integration at this gate.
- Formal Build and Test instruction artifacts remain the next mandatory AI-DLC stage after generated-artifact approval.

## Post-verification Concurrent Drift

After the clean full-suite and build capture, the separately approved Worktree Document Edit and History workflow began writing schema v7 and service code in the same worktree. A subsequent global `npm run typecheck` stopped on `src/worktree-spike/worktree-spike-service.ts` because that in-progress code had not yet populated newly required `WorktreeDocumentSummary` fields. This is outside the Manual Board Hotfix and was not edited here.

The Manual Board focused suite was rerun against that newer shared state and passed 24 of 24 tests across 6 files. The count increased by one due to a concurrent migration test. The earlier clean global result remains the Hotfix completion baseline; the current temporary global failure is recorded rather than being changed outside scope.

After the concurrent workflow stabilized, a final `npm run typecheck` and `npm run build` rerun passed without modifying its files. The latest privileged full suite also passed 139 of 139 tests across 38 files.
