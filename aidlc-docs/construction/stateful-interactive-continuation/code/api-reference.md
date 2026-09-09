# Stateful Interactive AI-DLC Continuation — API Reference

All routes are under `/api`, require the existing loopback application boundary and return the common `{ ok, data }` or `{ ok, error }` envelope.

## Read Interaction State

`GET /srs/:srId/worktree-spike`

The existing Worktree view now optionally includes:

- `sessionId`: the persisted Claude conversation UUID.
- `interactionStatus`: `idle`, `running`, `awaiting_input`, `finishing`, `succeeded`, `failed`, or `cancelled`.
- `transcript`: ordered entries with positive `sequence`, `role`, `text` and `createdAt`.

Older responses without these optional fields remain accepted by the browser client.

## Start or Resume

`POST /srs/:srId/worktree-spike/resume`

Requires `Content-Type: application/json`, UUID `X-Operation-Id` and body `{}`. Returns HTTP 202 promptly with the running view. A first invocation creates a session; later invocations resume the persisted session. If the SR already has an active child, it returns that interaction instead of starting another.

## Send Message

`POST /srs/:srId/worktree-spike/message`

Requires UUID `X-Operation-Id` and body `{ "message": "진행해줘." }`. The message must contain non-whitespace text and be at most 16 KiB UTF-8. An active child receives it on the existing stdin. If the prior child ended but a stored session exists, this action starts a new process with `--resume` and uses the message as the first input.

## Finish Input

`POST /srs/:srId/worktree-spike/finish`

Requires UUID `X-Operation-Id` and body `{}`. Closes stdin gracefully and returns the `finishing` projection. Child completion then captures the Worktree manifest, document history and current AI-DLC state before persisting success or failure.

## Cancel Execution

`POST /srs/:srId/worktree-spike/cancel`

Requires UUID `X-Operation-Id` and body `{}`. Reuses process-group TERM/KILL cancellation, records `cancelled`, and preserves session identity and transcript for a later explicit resume.

Relevant errors include `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `PLANNING_ACTION_BLOCKED`, `OPERATION_CONFLICT`, `CLI_FAILED`, `CLI_TIMEOUT`, `CLI_OUTPUT_TOO_LARGE` and `CLI_PROTOCOL_ERROR`.
