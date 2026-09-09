# 수동 계획 보드 상태 이동 — Code Generation Plan

이 문서는 단일 Hotfix unit `manual-board-status-movement`의 Code Generation single source of truth다. 승인 전에는 application code를 변경하지 않는다.

## Part 1 — Planning Checklist

- [x] P1. 승인된 Requirements와 Workflow Plan, reverse-engineering 및 current dirty worktree를 로드한다.
- [x] P2. User Stories와 조건부 design stages의 승인된 skip 상태를 확인한다.
- [x] P3. 기존 source, migration v4, storage transaction, HTTP operation replay와 board UI 경계를 조사한다.
- [x] P4. exact application/test/documentation paths와 순서를 확정한다.
- [x] P5. FR-MB-01..07, NFR-MB-01..05와 acceptance scenarios를 실행 단계에 매핑한다.
- [x] P6. PBT Partial의 blocking rules PBT-02/03/07/08/09 및 advisory rules를 평가하고 test steps에 반영한다.
- [x] P7. 계획의 Markdown, checkbox, links와 path ownership을 검증한다.
- [x] P8. Code Generation plan approval prompt를 audit에 기록한다.
- [x] P9. 전체 계획과 생성 순서에 대한 명시적 사용자 승인을 기록한다.

## Unit Context

- **Unit**: `manual-board-status-movement`
- **Type**: Brownfield Hotfix; existing files are modified in place.
- **Dependencies**: existing React/Express/SQLite, `Column`, `StorePort`, `ChangeSet`, `Operations`, `LocalAppBoundary`, `SRService`, `ApiClient`.
- **External dependency changes**: none.
- **Database ownership**: nullable `srs.manual_board_column` added by additive schema migration v5.
- **Service boundary**: `SRService.moveBoard` owns manual movement; it does not call `PlanningService` or mutate `planning_workflows`/`workflow_column`.
- **UI boundary**: board card controls only. SR detail, documents, reviews, planning and worktree-spike UI are out of scope.
- **Story traceability**: User Stories were explicitly skipped. FR/NFR and acceptance-scenario mapping below is authoritative.

## Frozen Contracts

- `BoardMoveDirection`: `previous | next`.
- `BoardMoveCommand`: SR ID, expected visible column, target column and operation ID.
- `adjacentColumn(column, direction)`: returns the exact adjacent `Column` or `undefined` at a boundary.
- HTTP: `POST /api/srs/:srId/board-movements` with `{ expectedColumn, targetColumn }` and `X-Operation-Id`.
- Success: current `SRSummary` after the override commit; replay performs no second movement.
- Persistence precedence for board reads only: `manual_board_column` then `workflow_column`.
- `Queries.sr()` continues to return `workflow_column`, preserving AI-DLC/review/manual-implementation semantics.
- Stale expected column, non-adjacent target, invalid column and boundary movement are rejected without mutation.

## Exact Paths

### Create

- `src/sr-document-foundation/storage/migrations/006-manual-board-column.ts`
- `src/sr-document-foundation/ui/board-client.ts`
- `tests/sr-document-foundation/board-movement.property.test.ts`
- `tests/sr-document-foundation/board-client.test.ts`
- `aidlc-docs/construction/manual-board-status-movement/code/implementation-summary.md`
- `aidlc-docs/construction/manual-board-status-movement/code/verification.md`
- `aidlc-docs/construction/manual-board-status-movement/code/code-generation-approval-questions.md`

### Modify in place

- `src/shared/limits.ts`
- `src/shared/contracts.ts`
- `src/shared/client/api-client.ts`
- `src/sr-document-foundation/storage/migrations.ts`
- `src/sr-document-foundation/storage/store-port.ts`
- `src/sr-document-foundation/storage/queries.ts`
- `src/sr-document-foundation/storage/sqlite-store.ts`
- `src/sr-document-foundation/services/sr-service.ts`
- `src/sr-document-foundation/http/operations.ts`
- `src/sr-document-foundation/http/boundary.ts`
- `src/sr-document-foundation/http/routes.ts`
- `src/sr-document-foundation/ui/BoardPage.tsx`
- `src/sr-document-foundation/ui/KanbanColumn.tsx`
- `src/sr-document-foundation/ui/SRCard.tsx`
- `src/app/styles.css`
- `tests/sr-document-foundation/migrations.test.ts`
- `tests/sr-document-foundation/storage.test.ts`
- `tests/sr-document-foundation/services.test.ts`
- `tests/sr-document-foundation/http.test.ts`
- `tests/aidlc-planning/migration.test.ts`
- `tests/review-implementation/migration.test.ts`
- `tests/worktree-spike/persistence.test.ts`

`migrations.ts`, both downstream migration tests, `api-client.ts`, and `styles.css` already contain unrelated uncommitted worktree changes. Every edit must be a minimal patch against the current file; those changes must remain intact.

## Part 2 — Generation Steps

### Step 1 — Preflight and baseline preservation

- [x] Re-read every modified target and `git diff` immediately before editing.
- [x] Confirm migration v4/v5 worktree document/review changes remain present.
- [x] Record the current focused/full test baseline without editing unrelated failures.

### Step 2 — Shared column and command contracts

- [x] Add `BoardMoveDirection` and `adjacentColumn` based only on canonical `COLUMNS` order.
- [x] Extend shared command/query/result types for `move_board` and one board-item read.
- [x] Extend browser guards/operation recognition without regressing worktree client changes.
- [x] Cover FR-MB-01, FR-MB-02, NFR-MB-01 and contract portions of NFR-MB-03.

### Step 3 — Additive schema v6 and board projection

- [x] Add nullable, check-constrained `manual_board_column` after the current schema-v5 migration.
- [x] Extend schema validation/migration from v5 to v6 while preserving v1–v5 data.
- [x] Add `boardItem` query and reuse it in paged board projection.
- [x] Keep `Queries.sr()` and planning writes bound to `workflow_column` only.
- [x] Add atomic `ChangeSet` support for expected projected column → target manual override plus receipt.
- [x] Cover FR-MB-04, FR-MB-05 and NFR-MB-02/03.

### Step 4 — Service and HTTP mutation

- [x] Extend operation fingerprint/replay for `move_board` before current-state validation.
- [x] Implement `SRService.moveBoard` with canonical adjacency and stale-column checks.
- [x] Route the command through `LocalAppBoundary` without referencing `PlanningService`.
- [x] Add `POST /api/srs/:srId/board-movements` with strict object/column validation.
- [x] Preserve loopback, JSON, operation-ID and error-envelope behavior.
- [x] Cover FR-MB-02, FR-MB-04, FR-MB-05 and NFR-MB-03.

### Step 5 — Board client and button UI

- [x] Implement a typed `board-client` mutation using `ApiClient` and stable operation IDs.
- [x] Refactor card markup so the detail link never contains movement buttons.
- [x] Add stable `data-testid` values for previous/next controls.
- [x] Disable boundary and in-flight controls; reload the board on success.
- [x] Keep the card in its visible column and show a retryable error on failure.
- [x] Add minimal CSS without removing the concurrent worktree document styles.
- [x] Cover FR-MB-01, FR-MB-03, FR-MB-06, FR-MB-07 and NFR-MB-04.

### Step 6 — Example and property tests

- [x] Add example tests for first/middle/last columns, stale/non-adjacent rejection, idempotent replay, migration preservation, restart persistence and workflow-state non-mutation.
- [x] Add client tests for encoding, headers, success guard and error behavior.
- [x] Add render-level assertions for accessible names, disabled boundaries and non-nested interactive markup using existing test dependencies only.
- [x] Add fast-check round-trip properties for interior previous/next inverse pairs.
- [x] Add fast-check adjacency/range/boundary invariants with reusable domain generators.
- [x] Use fixed seed `424242`, at least 150 runs per property and default shrinking.
- [x] Cover all six acceptance scenarios and NFR-MB-05.

### Step 7 — Focused verification

- [x] Run the board helper/client/storage/service/HTTP/migration/UI test set.
- [x] Run `npm run typecheck`.
- [x] Fix only Hotfix-caused failures and rerun until focused checks pass.

### Step 8 — Regression and build verification

- [x] Run impacted planning/review/worktree migration and operation tests.
- [x] Run `npm test` and distinguish any pre-existing unrelated failure from a Hotfix regression.
- [x] Run `npm run build`.
- [x] Record commands, counts, seed and limitations in `verification.md`.

### Step 9 — Documentation and generated-artifact gate

- [x] Create `implementation-summary.md` with modified/created paths, API/storage behavior, FR/NFR traceability and explicit exclusions.
- [x] Verify no duplicate `_new`/`_modified` files, no dependency change and no accidental workflow mutation.
- [x] Validate Markdown/code fences/links and run `git diff --check`.
- [x] Create the standardized generated-artifact approval file.
- [x] Present Code Generation completion and wait for Request Changes or Continue to Build and Test.
- [x] Record explicit generated-artifact approval before marking Code Generation complete.

## Requirements Traceability

| Requirement | Generation steps |
| --- | --- |
| FR-MB-01 | 2, 5, 6 |
| FR-MB-02 | 2, 4, 6 |
| FR-MB-03 | 5, 6 |
| FR-MB-04 | 3, 4, 6 |
| FR-MB-05 | 3, 4, 6 |
| FR-MB-06 | 5, 6 |
| FR-MB-07 | 5, 9 |
| NFR-MB-01 | 2, 5, 9 |
| NFR-MB-02 | 3, 6, 8 |
| NFR-MB-03 | 2, 3, 4, 6 |
| NFR-MB-04 | 5, 6 |
| NFR-MB-05 | 6, 7, 8 |

## PBT Compliance at Planning Time

| Rule | Status | Planned evidence or rationale |
| --- | --- | --- |
| PBT-01 | Compliant advisory | Functional Design was skipped, so inverse and adjacency properties are identified directly in this plan. |
| PBT-02 | Compliant planned | Interior previous/next round trips use generated columns. |
| PBT-03 | Compliant planned | Index adjacency, valid range and boundary invariants use generated inputs. |
| PBT-04 | N/A advisory | Persistent command idempotency is stateful I/O and is covered by explicit replay examples. |
| PBT-05 | N/A advisory | No optimized/reference-algorithm pair exists. |
| PBT-06 | N/A advisory | Partial mode does not enforce stateful PBT; transactional sequences use focused examples. |
| PBT-07 | Compliant planned | Reusable `Column` and direction arbitraries respect the finite domain. |
| PBT-08 | Compliant planned | fast-check shrinking remains enabled with seed 424242 and 150 runs; no CI configuration exists, so CI wiring is N/A. |
| PBT-09 | Compliant | Existing fast-check 4.9.0 integrates with Vitest and needs no dependency change. |
| PBT-10 | Compliant advisory | Business-critical examples accompany the property tests. |

No blocking PBT finding exists at planning time. PBT-02/03/07/08/09 become blocking implementation evidence in Part 2.

## Completion Criteria

- All Part 2 checkboxes through generated-artifact presentation are checked in the same interactions as their work.
- All FR/NFR mappings have code or verification evidence.
- Focused Hotfix tests and typecheck pass.
- Full test/build status and any unrelated baseline failure are explicit.
- Existing uncommitted worktree changes remain preserved.
- Generated code receives explicit user approval before Build and Test.
