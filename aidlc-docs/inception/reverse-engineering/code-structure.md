# Code Structure

## Build System

- **Type**: npm with a committed lockfile.
- **Runtime**: Node.js 24.
- **Development**: compile the comparison worker, then run the TypeScript server through `tsx`; Vite is mounted as middleware.
- **Production build**: Vite builds browser assets and TypeScript builds server/worker output.
- **Verification**: separate client, server, and test TypeScript projects plus Vitest.
- **Configuration**: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.client.json`, `tsconfig.server.json`, `tsconfig.worker.json`, `tsconfig.test.json`, and `vite.config.ts`.

## Key Module Hierarchy

```mermaid
flowchart TB
    App[src/app]
    Shared[src/shared]
    Foundation[src/sr-document-foundation]
    Planning[src/aidlc-planning]
    Review[src/review-implementation]
    App --> Foundation
    App --> Planning
    App --> Review
    Foundation --> Shared
    Planning --> Shared
    Planning --> Foundation
    Review --> Shared
    Review --> Foundation
```

Text alternative: the app composition root depends on the three feature areas. Every feature uses shared contracts; planning and review also depend on the document/storage foundation.

## Existing Source Files Inventory

### Application composition

- `src/app/client.tsx` - mounts the React router and application shell.
- `src/app/config.ts` - resolves loopback server, database, Claude, rules, and worker configuration.
- `src/app/create-app.ts` - composition root for database, services, API, Vite/static assets, and shutdown.
- `src/app/server.ts` - starts the HTTP server and installs signal handling.
- `src/app/WorkspaceShell.tsx` - global layout, demo role switch, and multi-owner dirty-navigation guard.
- `src/app/roles.css` - role switch styling.
- `src/app/styles.css` - global application styling.

### Shared contracts and client support

- `src/shared/contracts.ts` - SR, document, version, history, command, receipt, query, and result contracts.
- `src/shared/planning-contracts.ts` - fixed stages, workflow/run/question/decision/context contracts, and planning limits.
- `src/shared/review-contracts.ts` - review and demo-role contracts.
- `src/shared/planning.ts` - planning-related shared helpers and guards.
- `src/shared/errors.ts` - typed error/result helpers.
- `src/shared/limits.ts` - content, pagination, and Kanban-column limits.
- `src/shared/validation.ts` - primitive object, ID, and UTF-8 text validation.
- `src/shared/client/api-client.ts` - browser fetch wrapper, response guards, and version routes.
- `src/shared/client/operation-tracker.ts` - browser idempotency/unknown-outcome tracking.

### SR and document foundation

- `src/sr-document-foundation/services/sr-input.ts` - normalizes initial SR input.
- `src/sr-document-foundation/services/sr-service.ts` - creates/lists SRs and records manual implementation completion.
- `src/sr-document-foundation/services/document-service.ts` - document queries, immutable edits, generation, diff, and restoration.
- `src/sr-document-foundation/http/boundary.ts` - translates local commands/queries into service calls.
- `src/sr-document-foundation/http/routes.ts` - root REST routes and loopback/JSON guards.
- `src/sr-document-foundation/http/validation.ts` - SR and pagination request validators.
- `src/sr-document-foundation/http/operations.ts` - command fingerprint and receipt behavior.
- `src/sr-document-foundation/http/error-handler.ts` - result-to-HTTP and exception mapping.
- `src/sr-document-foundation/storage/database.ts` - opens and configures SQLite.
- `src/sr-document-foundation/storage/migrations.ts` - validates schema identity and migrates versions 1 through 3.
- `src/sr-document-foundation/storage/migrations/001-foundation.ts` - SR/document/version/history/receipt schema.
- `src/sr-document-foundation/storage/migrations/002-planning.ts` - workflow/run/link schema.
- `src/sr-document-foundation/storage/migrations/003-reviews.ts` - review schema.
- `src/sr-document-foundation/storage/store-port.ts` - read algebra and transactional `ChangeSet` port.
- `src/sr-document-foundation/storage/sqlite-store.ts` - `StorePort` implementation and atomic optimistic commit.
- `src/sr-document-foundation/storage/queries.ts` - prepared/query mapping helpers.
- `src/sr-document-foundation/storage/cursors.ts` - stable pagination cursor encoding and validation.
- `src/sr-document-foundation/compare/diff-contracts.ts` - worker request/result contracts.
- `src/sr-document-foundation/compare/diff-worker-adapter.ts` - worker lifecycle, request correlation, and failure handling.
- `src/sr-document-foundation/compare/diff-worker.ts` - worker entry point.
- `src/sr-document-foundation/compare/line-diff.ts` - bounded detailed/coarse line diff algorithm.
- `src/sr-document-foundation/ui/AsyncStatus.tsx` - compact async-state rendering.
- `src/sr-document-foundation/ui/BoardPage.tsx` - paged Kanban board.
- `src/sr-document-foundation/ui/KanbanColumn.tsx` - one board column.
- `src/sr-document-foundation/ui/SRCard.tsx` - SR summary card.
- `src/sr-document-foundation/ui/SRCreateForm.tsx` - SR input form.
- `src/sr-document-foundation/ui/SRDetailPage.tsx` - orchestrates input, planning, documents, history, and review panels.
- `src/sr-document-foundation/ui/InitialInputPanel.tsx` - immutable input display.
- `src/sr-document-foundation/ui/DocumentWorkspace.tsx` - document route/view/edit/compare composition.
- `src/sr-document-foundation/ui/DocumentList.tsx` - document index.
- `src/sr-document-foundation/ui/DocumentReader.tsx` - Markdown/raw paged reader.
- `src/sr-document-foundation/ui/DocumentEditor.tsx` - optimistic Markdown editing.
- `src/sr-document-foundation/ui/VersionPicker.tsx` - historical-version selector.
- `src/sr-document-foundation/ui/VersionCompare.tsx` - comparison UI.
- `src/sr-document-foundation/ui/RestoreConfirm.tsx` - restoration confirmation.
- `src/sr-document-foundation/ui/HistoryPanel.tsx` - paged audit history.
- `src/sr-document-foundation/ui/PagedText.tsx` - bounded raw-text pages.
- `src/sr-document-foundation/ui/Pagination.tsx` - pagination controls.
- `src/sr-document-foundation/ui/ConfirmDialog.tsx` - reusable confirmation dialog.
- `src/sr-document-foundation/ui/ErrorNotice.tsx` - error presentation.
- `src/sr-document-foundation/ui/attachment.ts` - attachment client rules.
- `src/sr-document-foundation/ui/compare-state.ts` - comparison state helper.
- `src/sr-document-foundation/ui/editor-state.ts` - editor state helper.
- `src/sr-document-foundation/ui/use-query.ts` - abortable query hook.

### AI-DLC planning

- `src/aidlc-planning/policy/planning-policy.ts` - transition rules over the fixed nine-stage workflow.
- `src/aidlc-planning/context/planning-context-builder.ts` - reads stage rules and serializes SR/doc/history DB context.
- `src/aidlc-planning/cli/claude-plan-runner.ts` - isolated CLI process and strict JSON output parser.
- `src/aidlc-planning/services/planning-service.ts` - workflow commands, concurrency, approvals, run completion, and recovery.
- `src/aidlc-planning/http/planning-routes.ts` - workflow/run/action/answer/decision endpoints.
- `src/aidlc-planning/ui/PlanningPanel.tsx` - fixed-stage actions, polling, questions, and decisions UI.
- `src/aidlc-planning/ui/planning-client.ts` - planning response guards and mutation tracker.
- `src/aidlc-planning/ui/planning.css` - planning panel styling.

### Review and implementation

- `src/review-implementation/services/review-service.ts` - immutable version-specific review lifecycle and role checks.
- `src/review-implementation/http/review-routes.ts` - review and manual completion endpoints.
- `src/review-implementation/ui/ReviewPanel.tsx` - request/result/history/manual-completion UI.
- `src/review-implementation/ui/review-client.ts` - review response guards and mutation tracker.
- `src/review-implementation/ui/review.css` - review panel styling.

## Test Structure

- `tests/sr-document-foundation/` - configuration, migrations, storage, services, HTTP, idempotency, pagination, worker/diff, and UI-state tests with four helpers.
- `tests/aidlc-planning/` - policy, context, CLI, migration, service, HTTP, and client-state tests plus a fake Claude executable.
- `tests/review-implementation/` - migration, service, HTTP, cross-feature integration, and client-state tests.
- The previous completed workflow records 23 test files and 86 passing tests. This reverse-engineering session could not rerun them because dependencies are not installed in this checkout; both `npm test` and `npm run typecheck` stopped at `tsc: command not found` before compiling code.

## Design Patterns

### Ports and adapters

- **Location**: `StorePort`, `PlanRunnerPort`, `DiffPort`, `SRInputPort`.
- **Purpose**: isolate persistence, external process, worker, and input behavior.
- **Implementation**: services depend on TypeScript interfaces; SQLite, Claude, and direct input provide concrete adapters.

### Atomic change set

- **Location**: `storage/store-port.ts` and `sqlite-store.ts`.
- **Purpose**: combine expected-version checks, domain records, events, workflow state, and receipts in one transaction.
- **Implementation**: services prepare a `ChangeSet`; SQLite commits it with optimistic checks.

### Immutable history with mutable pointers

- **Location**: document versions, history events, planning runs/links, reviews, and triggers.
- **Purpose**: retain an audit trail while presenting the latest state efficiently.
- **Implementation**: immutable version/event rows plus mutable document/workflow/review terminal pointers under guarded transitions.

### Idempotent commands

- **Location**: `X-Operation-Id`, command fingerprints, receipts, and client mutation trackers.
- **Purpose**: prevent duplicate mutation after a lost HTTP response.
- **Implementation**: replay the committed receipt when operation ID, kind, SR, and fingerprint agree.

### Optimistic concurrency

- **Location**: document version references and workflow revisions.
- **Purpose**: reject edits, approvals, and transitions based on stale state.
- **Implementation**: exact expected refs/revisions are checked in the storage transaction.

## Structural Risks for the Enhancement

- Fixed `PLANNING_STAGES` and `stageIndex` are embedded in contracts, policy, service, storage payloads, board projection, UI, and tests.
- The runner deliberately creates and deletes an OS temporary directory; it cannot observe or preserve repository files.
- The system prompt and CLI flags explicitly forbid tools/file edits and disable project settings, hooks, slash commands, MCP, and session persistence.
- `DocumentRecord.logicalKey` is not a worktree-relative path contract, and document bodies are authoritative in SQLite.
- Startup recovery only changes database run status; it does not inspect partially changed files.
- The schema has no repository, workspace, profile, checkpoint, file snapshot/blob, interaction-version, approval-baseline, or restore entity.
- Source modules are mostly compact, but several files are highly condensed into long statements, which raises review and modification risk for a broad cross-cutting change.
