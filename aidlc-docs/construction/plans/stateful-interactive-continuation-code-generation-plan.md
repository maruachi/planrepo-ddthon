# Stateful Interactive AI-DLC Continuation — Code Generation Plan

This document is the single source of truth for the 30-minute interactive continuation unit. Product code must not change until Part 1 approval is recorded. Every completed generation step is checked in the same interaction.

## Unit Context

- **Unit**: `stateful-interactive-continuation`
- **Project type**: Brownfield local TypeScript application.
- **Primary stories**: US-WT-08 actual Worktree execution, US-WT-10 progress visibility, and US-WT-11 user responses.
- **Requirements**: FR-SIC-01 through FR-SIC-05 and NFR-SIC-01 through NFR-SIC-08.
- **Existing dependencies**: Worktree provision/state/manifest, schema-v7 JSON view persistence, document history/review, Express REST, React polling patterns, process-group cancellation, Vitest and fast-check.
- **Out of scope**: SSE/WebSocket, PTY/TUI, crash-time child reattachment, multi-session history, transcript search/export and generic permission broker.

## Frozen Contracts

### Claude CLI and Conversation Identity

- Generate one UUID session ID per SR before its first interactive process starts and persist it in `WorktreeSpikeView`.
- New conversation arguments are `-p --verbose --input-format stream-json --output-format stream-json --session-id <uuid>`.
- Stored-conversation arguments replace `--session-id` with `--resume <uuid>`.
- The process `cwd` remains the provisioned SR worktree and `shell` remains false.
- The first JSONL user message is the frozen `RESUME_PROMPT`; later messages use the exact browser text.
- Keep stdin open until graceful finish, cancellation, timeout, shutdown or process failure.

### Stream Protocol

- Add a pure protocol module that encodes one user message as a newline-terminated stream-JSON object.
- Buffer stdout fragments until newline boundaries and accept multiple complete events in one chunk.
- Normalize user, assistant, result/status and error text into bounded transcript entries; ignore unsupported metadata without exposing secrets.
- A system/init event may confirm session identity but must never replace a different persisted SR session ID.
- Malformed JSON produces one bounded diagnostic transcript entry and a failed turn; it must not crash the server.

### Runner Handle

- Replace one-shot `run()` with `start(request, onEvent)`, returning a handle containing `sessionId`, `send(message)`, `finish()`, `cancel()` and `completion`.
- `send` writes exactly one JSONL user message and rejects after stdin closes.
- `finish` closes stdin gracefully and lets the process exit; `cancel` reuses process-group TERM/KILL behavior.
- Output byte and four-hour timeout bounds remain enforced across the whole child lifetime.
- `close()` cancels every active handle and awaits all completions.

### Worktree View and Transcript

- Add optional backward-compatible `sessionId`, `transcript`, and `interactionStatus` fields to the persisted JSON view.
- Interaction status is one of `idle`, `running`, `awaiting_input`, `finishing`, `succeeded`, `failed`, or `cancelled`.
- Transcript entries contain positive monotonic `sequence`, role `user|assistant|status|error`, non-empty text and ISO timestamp.
- Retain at most 500 entries and 256 KiB of UTF-8 transcript text by evicting oldest entries; never split one UTF-8 entry.
- Older stored rows without interactive fields load as an empty idle interaction.

### Service Lifecycle

- Keep one active runner handle and one pre-run manifest per SR in memory.
- `resume` starts the child in the background, persists `running`, and returns immediately.
- `message` uses the active handle; if no handle exists but a stored session exists, it starts a resumed child with the new message.
- Operation-ID deduplication prevents a repeated message/finish/cancel request from executing twice within the process lifetime.
- `finish` closes stdin and marks `finishing`; completion captures manifest/document history/state exactly once and persists success/failure.
- `cancel` kills the process, preserves session/transcript and records `cancelled` without claiming successful completion.
- A persisted active state without an in-memory handle is projected as interrupted/failed while preserving the session ID for explicit resume.

### HTTP and UI

- Existing `POST .../resume` returns HTTP 202 with the running view without waiting for child exit.
- Add `POST .../message` with `{ message }`, `POST .../finish` with `{}`, and `POST .../cancel` with `{}`; all require UUID `X-Operation-Id`.
- Bound a message to 16 KiB UTF-8 and reject empty/whitespace-only input.
- Existing `GET .../worktree-spike` supplies transcript polling state; no new realtime transport is introduced.
- UI polls every 500 ms while running, awaiting input or finishing; it renders ordered roles/status and exposes stable message input/send/finish/cancel test IDs.
- Keyboard Enter submits; Shift+Enter inserts a newline. Draft and error text remain visible after a failed send.

## Exact Application Targets

### Create

- `src/worktree-spike/runner/claude-stream-protocol.ts`
- `tests/worktree-spike/runner/claude-stream-protocol.test.ts`
- `tests/worktree-spike/runner/claude-stream-protocol.property.test.ts`

### Modify In Place

- `src/worktree-spike/contracts.ts`
- `src/worktree-spike/runner/worktree-aidlc-runner.ts`
- `src/worktree-spike/storage/sqlite-worktree-spike-persistence.ts`
- `src/worktree-spike/worktree-spike-service.ts`
- `src/worktree-spike/http/worktree-spike-routes.ts`
- `src/worktree-spike/ui/worktree-spike-client.ts`
- `src/worktree-spike/ui/WorktreeSpikePanel.tsx`
- `src/app/styles.css`
- `tests/worktree-spike/runner/worktree-aidlc-runner.test.ts`
- `tests/worktree-spike/persistence.test.ts`
- `tests/worktree-spike/integration.test.ts`
- `tests/worktree-spike/ui/worktree-spike-client.test.ts`

### Documentation Created After Generation

- `aidlc-docs/construction/stateful-interactive-continuation/code/implementation-summary.md`
- `aidlc-docs/construction/stateful-interactive-continuation/code/api-reference.md`
- `aidlc-docs/construction/stateful-interactive-continuation/code/verification.md`
- `aidlc-docs/construction/stateful-interactive-continuation/code/code-generation-approval-questions.md`

## Part 1 — Planning Checklist

- [x] Load approved Requirements, reused stories and approved 30-minute execution plan.
- [x] Load current source, tests, schema-v7 persistence and concurrent completed Worktree changes.
- [x] Confirm workspace root and brownfield modify-in-place rules.
- [x] Freeze CLI, stream, runner-handle, transcript, lifecycle, API and UI contracts.
- [x] List exact create/modify/documentation targets.
- [x] Map requirements and stories to numbered generation steps.
- [x] Include example tests and blocking Partial-PBT evidence.
- [x] Record skipped design-stage risk, rollback and timebox boundaries.
- [x] Validate this plain-Markdown plan before creation.
- [x] Log and present the Part 1 approval prompt.
- [x] Record explicit approval of the entire plan before application code changes.

## Part 2 — Generation Steps

### Step 1 — Preflight and current baseline

- [x] Re-read Git status and exact target diffs immediately before editing.
- [x] Confirm all concurrent Worktree document/history and board changes are complete and preserved.
- [x] Run focused Worktree runner/client tests and typecheck; record any pre-existing failure without fixing unrelated scope.

### Step 2 — Stream protocol and interactive contracts

- [x] Create the stream-JSON encoder, decoder/framer and normalized transcript helpers.
- [x] Extend contracts with session, transcript, status, message and runner-handle types.
- [x] Add example tests for fragments, multiple lines, supported events, malformed input and UTF-8 bounds.
- **Trace**: FR-SIC-01, FR-SIC-02, FR-SIC-03; NFR-SIC-02, NFR-SIC-04.

### Step 3 — Duplex Worktree Claude runner

- [x] Start new and resumed Claude sessions with the frozen argument arrays, worktree `cwd`, open stdin and shell disabled.
- [x] Implement send, graceful finish, cancellation, timeout, byte bounds, event callbacks and shutdown.
- [x] Update fake-launcher tests for session isolation, same-process follow-up, resume arguments, finish and cancellation.
- **Trace**: FR-SIC-01, FR-SIC-02, FR-SIC-05; NFR-SIC-03.

### Step 4 — Persisted view and service orchestration

- [x] Load older persisted views with safe interactive defaults and store bounded session/transcript projections.
- [x] Implement immediate background resume, active-handle registry, message/start-resumed-turn, finish, cancel and single completion collection.
- [x] Preserve manifest/document-history collection and recover stale persisted active states without losing session identity.
- [x] Add persistence/service tests for restart, deduplication, ordering, bounds and SR isolation.
- **Trace**: FR-SIC-01 through FR-SIC-05; NFR-SIC-01, NFR-SIC-02, NFR-SIC-04, NFR-SIC-06.

### Step 5 — HTTP and guarded browser client

- [x] Make resume return the running view promptly and add strict message, finish and cancel routes.
- [x] Extend client guards for backward-compatible interactive fields and add typed mutation methods.
- [x] Add HTTP/client tests for validation, operation replay, transcript polling, messages, finish, cancel and malformed responses.
- **Trace**: FR-SIC-02, FR-SIC-03, FR-SIC-04, FR-SIC-05.

### Step 6 — Interactive transcript UI

- [x] Poll status every 500 ms while active and clean timers on unmount/SR change.
- [x] Render ordered transcript roles and states; add message textarea, send, finish and cancel controls with stable test IDs.
- [x] Support Enter submit, Shift+Enter newline, busy/disabled/error behavior and draft preservation.
- [x] Add focused UI behavior tests using the existing lightweight test style.
- **Trace**: FR-SIC-03, FR-SIC-04, FR-SIC-05; NFR-SIC-05.

### Step 7 — Blocking Partial-PBT and regression verification

- [x] PBT-02: verify valid generated user messages encode/decode without text loss and arbitrary chunking reconstructs identical ordered events.
- [x] PBT-03: verify append/eviction preserves monotonic sequence, SR-local order, entry/count/byte bounds and duplicate-final suppression.
- [x] PBT-07: reuse constrained Unicode message, stream-event and chunk-boundary generators.
- [x] PBT-08: run at least 150 cases per property with shrinking and fixed seed `424242`; document replay command.
- [x] PBT-09: use pinned fast-check 4.9.0 with Vitest.
- [x] Run focused Worktree tests, affected regressions, full tests, typecheck, production build and `git diff --check`.
- **Trace**: NFR-SIC-06, NFR-SIC-07, NFR-SIC-08 and all acceptance scenarios.

### Step 8 — Documentation and generated-artifact gate

- [x] Create implementation, API and verification summaries under the unit code documentation directory.
- [x] Record modified/created files, CLI protocol, limits, test evidence and deferred transport/reattachment scope.
- [x] Create the standardized two-option generated-code approval file.
- [x] Validate documentation, links and parsing compatibility.
- [x] Present Code Generation completion and wait for explicit approval before Build and Test.

## Story Completion Rules

- US-WT-08 completes only the interactive session/resume slice; full checkpoint and resource scheduling remain incomplete.
- US-WT-10 completes polling-based transcript/status visibility; SSE/WebSocket and broader profile actions remain incomplete.
- US-WT-11 completes free-text interactive responses; durable versioned interaction editing and permission-broker UI remain incomplete.

## Rollback and Preservation

- Preserve all pre-existing dirty files and completed Worktree document/history, review and manual-board artifacts.
- No migration is planned; older schema-v7 JSON rows must remain readable.
- Do not run the real Claude executable in automated tests; use fake handles/process fixtures.
- Do not modify user repositories during tests; use temporary Worktree/SQLite fixtures.
- No Git commit, push, reset, clean, stash or branch/worktree deletion is authorized.

## Extension Compliance

- **Security Baseline**: Disabled; N/A.
- **Resiliency Baseline**: Disabled; N/A.
- **PBT Partial**: PBT-02, PBT-03, PBT-07, PBT-08 and PBT-09 have explicit blocking generation steps. PBT-01, PBT-04, PBT-05, PBT-06 and PBT-10 are advisory in Partial mode; focused example tests remain mandatory.
