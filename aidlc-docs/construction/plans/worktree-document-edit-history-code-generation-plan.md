# Worktree Document Edit and History — Code Generation Plan

This document is the single source of truth for the focused Worktree document unit. Product code must not change until Part 1 approval is recorded. After approval, every completed generation step is checked in the same interaction.

## Unit Context

- **Unit**: `worktree-document-edit-history`
- **Project type**: Brownfield local TypeScript application.
- **Primary stories**: US-WT-13 Worktree file/history exploration and US-WT-14 safe plan-document editing.
- **Requirements**: FR-WDEH-01 through FR-WDEH-07 and NFR-WDEH-01 through NFR-WDEH-07.
- **Existing dependencies**: Worktree provisioning, scoped manifest, `claude -p` Worktree runner, schema-v4 status persistence, schema-v5 Worktree review records, SR-detail document tree and common validation/error/UI utilities.
- **Out of scope**: Visual diff, restore, tombstone, full checkpoint/blob storage, drift import, approval invalidation and Git write operations.

## Frozen Contracts

### Migration Ownership

- This unit owns `src/sr-document-foundation/storage/migrations/007-worktree-document-history.ts`.
- Schema v5 is occupied by Worktree review storage and the approved manual-board Hotfix has reserved schema v6 in the current working tree.
- Generation Step 1 must stop and revise this plan if another change claims migration 007 before implementation; it must never overwrite, combine or silently renumber an unrelated migration.
- Existing v1 through v6 databases migrate additively to v7 without deleting or rewriting user rows.

### Worktree Document Entities

- `WorktreeDocumentSummary`: path, current hash, change classification, latest version ID/number/origin and editable flag.
- `WorktreeDocumentVersionSummary`: SR, path, version ID/number, hash, origin, created time, prior version and optional source operation.
- `WorktreeDocumentVersionView`: version summary plus exact UTF-8 body and `isLatest`.
- `WorktreeDocumentEditRequest`: path, expected hash and complete body.
- `WorktreeDocumentEditResult`: version view and `changed` boolean.
- Allowed origins in this unit: `ai_generated` and `human_edit`.

### Storage Rules

- `worktree_documents` owns one SR/path identity and a mutable latest-version pointer.
- `worktree_document_versions` is append-only with unique SR/path/version number and immutable update/delete triggers.
- `worktree_document_edit_receipts` is append-only and makes operation-ID replay durable.
- A snapshot whose hash equals the latest hash is a no-op and returns the existing latest version.
- Version numbers are positive, contiguous per SR/path and allocated inside one immediate SQLite transaction.
- Stored bodies are exact UTF-8 text and never exceed 1 MiB.

### Path and Edit Policy

- A document path must be a normalized Worktree-relative `aidlc-docs/**/*.md` path accepted by the existing managed-path policy.
- Absolute paths, traversal, `.git`, external symlinks, directories, non-Markdown and non-UTF-8 content are rejected.
- `aidlc-docs/aidlc-state.md` and `aidlc-docs/audit.md` are always read-only.
- Historical versions and reviewer-role UI are read-only.
- The server enforces policy independently of browser state.

### Safe Save Ordering

1. Resolve and revalidate the canonical Worktree file.
2. Read exact current bytes and verify the SHA-256 equals `expectedHash`.
3. Return a no-op without replacing the file or appending a version when the new body is identical.
4. Write and fsync a uniquely named same-directory temporary file, preserving the original mode where available.
5. Atomically rename the temporary file over the target.
6. Append the `human_edit` version, latest pointer and durable operation receipt in one immediate SQLite transaction.
7. If metadata commit fails, atomically restore the original bytes and report failure; if compensation also fails, report a bounded storage failure and never claim success.
8. Always remove remaining temporary files on known failure paths.

Crash consistency outside the process remains a deferred checkpoint/recovery concern and must be documented honestly; tests cover all catchable failure boundaries.

### AI Run Collection

- After a successful Worktree runner result, collect every managed `aidlc-docs/**/*.md` entry from the complete after-manifest, not only the latest delta.
- Read and validate each body using its captured hash before marking the run successful.
- Record created or hash-changed files as `ai_generated`; unchanged hashes do not append versions.
- The SR document tree is rebuilt from the complete current set so unchanged documents remain visible across runs.
- Deleted files are excluded from current selection without creating tombstones in this unit.

### HTTP Contract

- `GET /api/srs/:srId/worktree-spike/document?path=...&versionId=...` reads current or one stored version; `versionId` is optional.
- `GET /api/srs/:srId/worktree-spike/document/versions?path=...` returns newest-first version summaries using the existing bounded pagination conventions where practical.
- `POST /api/srs/:srId/worktree-spike/document/edits` accepts path, expectedHash and body with UUID `X-Operation-Id` and returns the exact idempotent result.
- Existing status, provision, resume and current-document consumers remain compatible.

### UI Contract

- Worktree document links retain `worktreePath`; historical links additionally use `worktreeVersionId`.
- The latest editable author view exposes stable `worktree-document-edit-button`, `worktree-document-editor-input`, `worktree-document-save-button` and `worktree-document-cancel-button` test IDs.
- Version navigation exposes `worktree-document-version-select`; historical and protected views have no enabled edit action.
- Unsaved text participates in the existing dirty-route and role-switch protection.
- Conflict and failure preserve the draft; success reloads the tree, version list and selected latest view.

## Exact Application Targets

### Create

- `src/sr-document-foundation/storage/migrations/007-worktree-document-history.ts`
- `src/worktree-spike/storage/sqlite-worktree-document-history.ts`
- `src/worktree-spike/files/worktree-document-writer.ts`
- `src/worktree-spike/ui/worktree-editor-state.ts`
- `tests/worktree-spike/document-history.test.ts`
- `tests/worktree-spike/document-history.property.test.ts`
- `tests/worktree-spike/files/worktree-document-writer.test.ts`
- `tests/worktree-spike/ui/worktree-editor-state.test.ts`

### Modify In Place

- `src/sr-document-foundation/storage/migrations.ts`
- `src/worktree-spike/contracts.ts`
- `src/worktree-spike/files/worktree-document-reader.ts`
- `src/worktree-spike/storage/sqlite-worktree-spike-persistence.ts`
- `src/worktree-spike/worktree-spike-service.ts`
- `src/worktree-spike/http/worktree-spike-routes.ts`
- `src/sr-document-foundation/http/error-handler.ts`
- `src/worktree-spike/ui/worktree-spike-client.ts`
- `src/worktree-spike/ui/WorktreeDocumentTree.tsx`
- `src/worktree-spike/ui/WorktreeDocumentWorkspace.tsx`
- `src/sr-document-foundation/ui/SRDetailPage.tsx`
- `src/app/create-app.ts`
- `src/app/styles.css`
- `tests/sr-document-foundation/migrations.test.ts`
- `tests/aidlc-planning/migration.test.ts`
- `tests/review-implementation/migration.test.ts`
- `tests/worktree-spike/integration.test.ts`
- `tests/worktree-spike/persistence.test.ts`
- `tests/worktree-spike/ui/worktree-document-tree.test.ts`
- `tests/worktree-spike/ui/worktree-spike-client.test.ts`
- `tests/worktree-spike/manifest/generators.ts`

### Documentation Created After Generation

- `aidlc-docs/construction/worktree-document-edit-history/code/implementation-summary.md`
- `aidlc-docs/construction/worktree-document-edit-history/code/api-reference.md`
- `aidlc-docs/construction/worktree-document-edit-history/code/verification.md`
- `aidlc-docs/construction/worktree-document-edit-history/code/README.md`
- `aidlc-docs/construction/worktree-document-edit-history/code/code-generation-approval-questions.md`

## Part 1 — Planning Checklist

- [x] Load the approved focused requirements, reused stories and minimal execution plan.
- [x] Load current source, tests, migration chain and concurrent Worktree review changes.
- [x] Confirm workspace root and brownfield modify-in-place rules.
- [x] Freeze migration, entity, path, save-order, run-collection, API and UI contracts.
- [x] List exact create/modify/documentation targets.
- [x] Map requirements and stories to numbered generation steps.
- [x] Include example tests and blocking Partial-PBT evidence.
- [x] Record skipped design-stage risk and rollback boundaries.
- [x] Validate this plain-Markdown plan before creation.
- [x] Log and present the Part 1 approval prompt.
- [x] Record explicit approval of the entire plan before application code changes.

## Part 2 — Generation Steps

### Step 1 — Preflight and migration reservation

- [x] Re-read Git status and current migration chain immediately before editing.
- [x] Confirm migration 007 remains unclaimed and all unrelated user/concurrent changes can be preserved.
- [x] Run the current focused Worktree tests and typecheck to record the pre-change baseline without fixing unrelated failures.

### Step 2 — Contracts, path policy and schema v7

- [x] Extend Worktree contracts with summaries, versions, edit request/result and history port interfaces.
- [x] Centralize current/historical/editable path validation without weakening existing containment and hash checks.
- [x] Add schema v7 document, immutable version and edit-receipt tables/triggers and extend the versioned migration chain.
- [x] Update migration tests across supported prior versions.
- **Trace**: FR-WDEH-01, FR-WDEH-02, FR-WDEH-04; NFR-WDEH-01, NFR-WDEH-02, NFR-WDEH-04.

### Step 3 — SQLite Worktree history repository

- [x] Implement transactional snapshot deduplication, contiguous version allocation, current pointers, historical reads, newest-first lists and durable edit receipts.
- [x] Reject SR/path/version mismatches and preserve immutable records.
- [x] Add repository example tests for AI v1, human v2, no-op, replay, restart and update/delete denial.
- **Trace**: FR-WDEH-04, FR-WDEH-05; NFR-WDEH-01, NFR-WDEH-04.

### Step 4 — Atomic Worktree file writer

- [x] Implement bounded UTF-8 writes with canonical containment, symlink/read-only policy and expected-hash validation.
- [x] Implement same-directory temporary write, fsync, atomic rename, mode preservation, cleanup and compensating restore support.
- [x] Add example tests for success, no-op, conflict, protected paths, traversal, symlink, oversize, write failure and compensation.
- **Trace**: FR-WDEH-02, FR-WDEH-03; NFR-WDEH-02, NFR-WDEH-03, NFR-WDEH-06.

### Step 5 — Service and AI-run history integration

- [x] Inject the history repository and writer into `WorktreeSpikeService` without changing Git/runner ownership.
- [x] Collect the complete current Markdown set after each successful run and append only new hashes as AI versions.
- [x] Implement current/historical reads, version listing and idempotent human edit orchestration with compensation.
- [x] Preserve unchanged documents across runs and refresh the persisted status view after edits.
- [x] Extend service/integration/restart tests through AI v1, human v2 and later unchanged run.
- **Trace**: FR-WDEH-01, FR-WDEH-03, FR-WDEH-04, FR-WDEH-07; US-WT-13, US-WT-14.

### Step 6 — HTTP and client contracts

- [x] Add validated historical-read, versions-list and edit routes behind the existing loopback/JSON/operation-ID guards.
- [x] Add strict client response guards and mutation methods without exposing absolute Worktree paths.
- [x] Add API/client tests for valid reads, edit, replay, conflict, protected path and malformed responses.
- **Trace**: FR-WDEH-03, FR-WDEH-05; NFR-WDEH-04.

### Step 7 — Worktree editor and version UI

- [x] Extend the Worktree tree to display all current documents with version/origin/editability metadata.
- [x] Add current and historical version navigation using stable query parameters.
- [x] Add latest-author editing, save/cancel, byte count, dirty protection, loading, no-op, success, conflict and retryable error states.
- [x] Keep protected, historical and reviewer views read-only.
- [x] Add pure editor-state and tree/version rendering tests with stable `data-testid` values.
- **Trace**: FR-WDEH-01, FR-WDEH-05, FR-WDEH-06; NFR-WDEH-05; US-WT-13, US-WT-14.

### Step 8 — Blocking Partial-PBT coverage

- [x] Add reusable valid Unicode-body, managed-path, hash, snapshot and version-sequence generators.
- [x] PBT-02: verify randomly generated valid snapshot write/read preserves path, body, hash, origin and version identity.
- [x] PBT-03: verify ordered versions are contiguous/newest-first, duplicate latest hashes are no-ops, and all current summaries reference their latest version.
- [x] PBT-07: keep domain generators reusable and constrained to managed paths, 1 MiB bounds and valid SHA-256.
- [x] PBT-08: run at least 150 cases per property with shrinking and fixed seed `424242`; retain the replay command in verification docs.
- [x] PBT-09: use the already pinned fast-check 4.9.0 with Vitest.
- **Trace**: NFR-WDEH-07.

### Step 9 — Focused and regression verification

- [x] Run all Worktree document/history/file/UI tests.
- [x] Run all Worktree spike tests, legacy document/review tests and every migration test.
- [x] Run the full test suite and distinguish new failures from preserved unrelated dirty-worktree failures.
- [x] Run TypeScript typecheck and production build.
- [x] Run `git diff --check` and verify no duplicate `_new` or `_modified` application files exist.
- **Trace**: all focused requirements and acceptance scenarios.

### Step 10 — Code documentation and generated-artifact gate

- [x] Create implementation, API, verification and README summaries under the unit code documentation directory.
- [x] Record modified versus created files, migration compatibility, test evidence, known crash-consistency limit and deferred diff/restore/checkpoint scope.
- [x] Create the standardized generated-code approval question with Request Changes and Continue to Build and Test choices.
- [x] Validate documentation content and local links.
- [x] Present Code Generation completion and wait for explicit generated-artifact approval.

## Story Completion Rules

- US-WT-13 is complete for current-path catalog and immutable AI/human version browsing only; checkpoint/external-edit/tombstone portions remain explicitly incomplete.
- US-WT-14 is complete for safe human editing and next-run file visibility only; approval invalidation and full checkpoint semantics remain incomplete.
- US-WT-15 is not implemented.

## Rollback and Preservation

- Preserve every pre-existing dirty file and all concurrent Worktree review/manual-board workflow artifacts.
- Never delete or rewrite migration 005 or its Worktree review tables.
- Do not modify user repositories during tests; use temporary Git/worktree/SQLite fixtures.
- An applied schema v7 is additive and remains readable even if UI/service code is rolled back; no destructive downgrade is generated.
- No Git commit, push, reset, clean, stash or branch/worktree deletion is authorized.

## Extension Compliance

- **Security Baseline**: Disabled; N/A.
- **Resiliency Baseline**: Disabled; N/A.
- **PBT Partial**: PBT-02, PBT-03, PBT-07, PBT-08 and PBT-09 have explicit blocking generation steps. PBT-01, PBT-04, PBT-05, PBT-06 and PBT-10 are advisory in Partial mode; example tests remain mandatory through NFR-WDEH-06.
