# Code Quality Assessment

## Test Coverage

- **Overall**: good behavioral coverage for the completed MVP, but no percentage/branch coverage instrumentation is configured.
- **Unit, integration, and property tests**: the 2026-09-09 refresh compiled the worker and passed 139 tests across 38 files.
- **Current refresh verification**: `npm run typecheck` passed all client, server and test projects; `npm test` passed 139/139. No product/test source was changed by this Reverse Engineering stage.
- **Browser verification**: prior workflow records actual CLI document generation plus browser flows for planning, review, restoration, draft protection, lost-response recovery, restart persistence, worktree document browsing and editing.
- **Worktree requirements coverage**: the current slice covers deterministic provisioning, legacy state parsing, exact-prompt/current-directory execution, scoped manifest delta, changed Markdown reads/edits/history, worktree reviews, persistence/API/UI, manual board movement and property tests. It does not provide interactive Claude sessions, transcript streaming, repository/profile/checkpoint/drift/restore completion.

## Code Quality Indicators

| Indicator | Assessment | Evidence |
| --- | --- | --- |
| Type safety | Good | Separate strict client/server/test TypeScript checks and typed result/contracts. |
| Input validation | Good for current API | Strict object fields, byte limits, IDs, revisions, refs, Host/Origin, and content type. |
| Transactional integrity | Good for current DB model | Central `ChangeSet`, immediate transactions, expected refs/revisions, foreign-key and schema checks. |
| Auditability | Good for DB operations | Immutable versions/events/receipts and version-specific decisions/reviews. |
| Failure handling | Good within current boundaries | Typed errors, worker cancellation, CLI timeout/size bounds, startup run recovery, unknown-response clients. |
| Linting/formatting | Not configured | No lint or format script/config found. |
| CI | Not configured | No CI workflow found. |
| Documentation | Good workflow artifacts; limited inline API docs | Extensive `aidlc-docs`; application modules rely mostly on types/tests. |
| Readability | Mixed | Clear layering and naming, but many modules compress multiple statements and JSX structures into long lines. |

## Good Patterns

- Atomic persistence combines state mutation, immutable audit event, and operation receipt.
- Lost-response replay is checked before stale-revision validation, preventing accidental duplicate work.
- Document approvals and reviews bind to exact immutable versions.
- SQLite schema identity and integrity are checked before migration.
- Subprocess spawning uses argument arrays and process-group cancellation instead of shell interpolation.
- Diff work is isolated from the HTTP thread and bounded for large inputs.
- UI tracks multiple independent dirty drafts and blocks navigation/role changes.
- Managed worktree paths are canonicalized, symlinks are rejected, Git commands are allowlisted, and changed document reads verify the captured hash.
- Scoped-manifest invariants and serialization round trips have reproducible property tests with shrinking.

## Technical Debt and Risks

### Fixed workflow model

- **Locations**: `shared/planning-contracts.ts`, `planning-policy.ts`, `planning-service.ts`, `PlanningPanel.tsx`, migrations and tests.
- **Issue**: a compile-time nine-stage array and numeric `stageIndex` are the source of truth. This directly conflicts with dynamic AI-DLC profile/state requirements.

### Split artifact authority

- **Locations**: `DocumentService`, `PlanningContextBuilder`, `SQLiteStore`.
- **Issue**: the legacy planner keeps document/workflow truth in SQLite, while the worktree path treats files as current truth and now stores immutable per-document bodies in SQLite. There is still no unified authority model, full checkpoint manifest/blob set, tombstone history, restore flow, or complete file-to-run/session lineage.

### Isolated runner policy

- **Location**: `claude-plan-runner.ts`.
- **Issue**: every run uses a newly deleted temp directory and deliberately disables project settings, tools, slash commands, hooks, MCP, and persistence. This is safe for the original planner but incompatible with real AI-DLC execution.

### Partial worktree recovery

- **Location**: `PlanningService.recoverInterrupted`.
- **Issue**: worktree status survives restart in schema v7, but a persisted `running` view is not reconciled, operation deduplication is process-memory-only, handles are reconstructed through provisioning, and partial-run manifests are not durably retained.

### One-shot Claude execution

- **Location**: `src/worktree-spike/runner/worktree-aidlc-runner.ts` and the resume service/API/UI path.
- **Issue**: `claude -p` receives one prompt followed by immediate stdin close; output is buffered until exit and stderr is discarded. No session ID, transcript event model, browser stream, user-message endpoint or process reattachment exists, so approval questions deadlock the workflow and subsequent launches lose conversation context.

### Repository configuration is not a trust registry

- **Locations**: `app/config.ts`, `git-worktree.ts`, `scoped-manifest.ts`, and `worktree-document-reader.ts`.
- **Issue**: one configured repository path and containment checks exist, but there is no repository entity, multi-root allowlist, user trust confirmation, project-instruction policy, or lifecycle ownership model.

### No process resource scheduler

- **Location**: `PlanningService.tasks`.
- **Issue**: one workflow state prevents concurrent writes to one SR, but there is no explicit global concurrency/resource limit across SRs or child-process persistence after restart.

### Dense formatting

- **Locations**: `create-app.ts`, service files, large TSX components, and the SQLite adapter.
- **Issue**: compact one-line statements reduce diff clarity for a broad architectural change. Refactoring should stay behavior-preserving and scoped to touched modules.

### Board state is workflow-derived and read-only

- **Locations**: `queries.ts`, `BoardPage.tsx`, `KanbanColumn.tsx`, and `SRCard.tsx`.
- **Issue**: board projection prefers `planning_workflows.column`, and cards are links with no mutation controls. A manual movement feature needs an explicit command/persistence rule that stays independent from AI-DLC progression without being immediately overwritten by the workflow projection.

## Improvement Readiness

- Existing ports/adapters, `ChangeSet`, immutable records, operation receipts, and worker/process boundaries are useful foundations.
- Further worktree enhancement should preserve current document/review behavior through compatibility adapters while completing repository/worktree and file-checkpoint domains.
- Schema changes should remain additive and versioned; destructive migration would violate current data preservation expectations.
- Security and resiliency concerns are unusually prominent in the new requirements even though optional extension packs remain disabled. Their explicit NFRs are still mandatory product requirements and should be handled at comprehensive requirements/design depth.
