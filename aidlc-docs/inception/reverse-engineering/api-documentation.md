# API Documentation

## Transport Contract

- Base path is `/api` on a loopback-only HTTP server.
- The remote address, exact `Host`, and optional `Origin` must match `127.0.0.1:<listening-port>`.
- Every response disables caching.
- Every `POST` requires uncompressed `application/json` and `X-Operation-Id`.
- Mutations use operation fingerprints and receipts to detect replay versus conflicting reuse.
- Results use a shared success/error envelope represented by `Result<T>` and `AppError`.

## REST APIs

### Configuration and board

| Method | Path | Purpose | Request | Success response |
| --- | --- | --- | --- | --- |
| GET | `/api/config` | Read client-visible limits/configuration. | None. | Configuration object. |
| GET | `/api/board` | List paged SR summaries by Kanban column. | Optional `limit`, `cursor`. | `Page<SRSummary>`. |
| POST | `/api/srs` | Create an SR. | `SRDraft`; operation header. | `SR`, HTTP 201. |
| GET | `/api/operations/:operationId` | Resolve a mutation with an uncertain response. | Operation ID path. | `OperationStatus`. |
| GET | `/api/srs/:srId` | Read SR details. | SR ID path. | `SR`. |

### Documents and history

| Method | Path | Purpose | Request | Success response |
| --- | --- | --- | --- | --- |
| GET | `/api/srs/:srId/documents` | List current document versions. | Optional `limit`, `cursor`. | `Page<DocumentSummary>`. |
| GET | `/api/srs/:srId/documents/:documentId/versions` | List versions. | Optional `limit`, `cursor`. | `Page<VersionSummary>`. |
| GET | `/api/srs/:srId/documents/:documentId/versions/:versionId` | Read one immutable version. | Version reference in path. | `DocumentView`. |
| GET | `/api/srs/:srId/documents/:documentId/compare` | Compare two versions of one document. | `left` and `right` version IDs. | `DiffView`. |
| POST | `/api/srs/:srId/documents/:documentId/edits` | Save a human-edit version. | `{ versionId, body }`; operation header. | `MutationResult`. |
| POST | `/api/srs/:srId/documents/:documentId/restorations` | Restore historical content as a new version. | `{ versionId }`; operation header. | `MutationResult`. |
| GET | `/api/srs/:srId/history` | List SR or document history. | Optional `documentId`, `limit`, `cursor`. | `Page<HistoryEvent>`. |
| GET | `/api/srs/:srId/history/:eventId` | Read full event details. | Event ID path. | `HistoryEvent`. |

### Planning

| Method | Path | Purpose | Request | Success response |
| --- | --- | --- | --- | --- |
| GET | `/api/srs/:srId/workflow` | Read computed planning state and actions. | SR ID path. | `WorkflowView`. |
| GET | `/api/srs/:srId/runs/:runId` | Read one planning run. | SR and run IDs. | `RunView`. |
| POST | `/api/srs/:srId/planning/advance` | Generate, revise, or advance a fixed stage. | `{ action, revision }`; operation header. | Accepted `RunView`, HTTP 202. |
| POST | `/api/srs/:srId/planning/answers` | Save a complete answer set. | `{ questionSetId, answers, revision }`; operation header. | `WorkflowView`. |
| POST | `/api/srs/:srId/planning/decisions` | Approve or request changes for exact versions. | `{ kind, comment, targets, revision }`; operation header. | `WorkflowView`. |
| POST | `/api/srs/:srId/planning/complete` | Move an approved final plan to implementation-ready. | `{ revision }`; operation header. | `WorkflowView`. |

### Reviews and manual implementation

| Method | Path | Purpose | Request | Success response |
| --- | --- | --- | --- | --- |
| GET | `/api/srs/:srId/reviews` | List reviews. | Optional `limit`, `cursor`. | `Page<ReviewView>`. |
| GET | `/api/srs/:srId/reviews/:reviewId` | Read one review. | SR and review IDs. | `ReviewView`. |
| POST | `/api/srs/:srId/reviews` | Request review of an exact version. | Role header and `{ target, comment }`; operation header. | `ReviewView`, HTTP 201. |
| POST | `/api/srs/:srId/reviews/:reviewId/results` | Record a terminal review result. | Reviewer role and `{ kind, comment }`; operation header. | `ReviewView`. |
| POST | `/api/srs/:srId/implementation` | Record manual implementation completion. | Author role and `{ revision }`; operation header. | `SR`. |

## Internal APIs

### `StorePort`

- `read<Q extends ReadQuery>(query: Q): Result<ReadResults[Q['kind']]>` performs typed queries for SRs, documents, versions, history, receipts, workflows, runs, and reviews.
- `commit(changes: ChangeSet): Result<CommandReceipt | null>` applies expected-state checks and all mutation records atomically.
- `ChangeSet` can carry an SR, documents, versions, pointer updates, events, workflow/run state, review state, expected refs, expected document set, command fingerprint, and receipt outcome.

### `SRService`

- `create(input, actor, command)` creates immutable SR input.
- `listBoard(options)` and `getDetail(srId)` query SRs.
- `markImplemented(srId, actor, revision, command)` makes a guarded manual completion declaration.

### `DocumentService`

- `listDocuments`, `readVersion`, `listVersions`, and `listHistory` expose document queries.
- `edit(target, body, actor, command)` requires the target to be latest and creates a human-edit version.
- `restore(source, actor, command)` creates a new latest restoration version.
- `compare(left, right, signal)` delegates same-document comparison to `DiffPort`.
- `prepareGenerated(srId, runId, artifacts)` prepares but does not commit AI-generated versions.

### `PlanningService`

- `getWorkflow` computes actions, latest targets, approval validity, and latest run.
- `command` dispatches idempotent advance, answer, decision, and complete commands.
- `advance` commits running state before scheduling the runner.
- `finishRun` validates output and atomically commits documents, run, workflow, and history.
- `recoverInterrupted` changes database runs left running to `CLI_INTERRUPTED` failures.
- `close` cancels the runner and waits for in-process tasks.

### `PlanRunnerPort`

- `execute(context, scope): Promise<Result<RunnerOutcome>>` runs one planning generation.
- `close?(): Promise<void>` supports process cancellation and shutdown.
- Current `ClaudePlanRunner` accepts only `planning-only` context and returns JSON artifacts/questions/summary.

### `PlanningContextBuilder`

- `loadRules(spec)` reads common rules and only the current fixed stage rule.
- `build(srId, runId, spec)` materializes complete latest documents and history into an 8 MiB bounded JSON context.

### `PlanningPolicy`

- `evaluate(state, action)` validates and computes a fixed stage-index transition.
- `evaluateOutcome(state, outcome)` chooses answer-waiting or approval-waiting.

### `ReviewService`

- `request` creates an author-owned review request tied to an exact version.
- `submitResult` records one reviewer-owned terminal result.
- `listReviews` and `getReview` enrich stored reviews with latest-version context.

## Data Models and Relationships

### SR

- Fields: ID, title, description, optional attachment, actor, created time, and Kanban column.
- Relationships: owns documents, history, workflow, runs, reviews, and receipts.
- Validation: UUID-like IDs, byte-bounded text, fixed columns; initial input columns are immutable.

### Document and DocumentVersion

- `DocumentRecord` supplies SR-scoped identity, logical key, latest pointer, and creation time.
- `DocumentView` contains an immutable version number, body, title, origin, actor, base/source/run references, and latest-state indicator.
- One document owns many versions; the latest pointer is transactionally advanced.
- Body is limited to 1 MiB; title/logical key is limited to 4 KiB.

### Workflow and PlanningRun

- Workflow fields: revision, fixed `stageIndex`, column, status, inception/construction cycle counts, latest run, questions, decision, and review targets.
- Run fields: fixed stage, status, timestamps, error/summary, input/output references, and optional serialized context.
- One SR owns one workflow and many runs.

### HistoryEvent and CommandReceipt

- Events are immutable and monotonically sequenced within an SR, with optional document-version links and JSON details.
- Receipts map a unique operation ID/fingerprint to one committed outcome and optional version, run, or review reference.

### Review

- A review belongs to one SR and exact document version.
- Status transitions once from requested to approved or changes-requested.
- Review target identity and terminal results are protected by triggers/service checks.

## Required API Evolution

The worktree requirements need new resource families for repositories, SR workspaces, profiles, synchronization/drift, executions/transcripts, file artifacts, checkpoints, approval baselines, interactions, restore previews/execution, and lifecycle cleanup. Existing document and planning endpoints cannot represent path-based file truth or dynamic AI-DLC state without contract changes.
