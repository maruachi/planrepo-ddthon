# Worktree Document Edit and History — API Reference

All routes are under `/api`, use the existing loopback-only boundary and return the common `{ ok, data }` or `{ ok, error }` envelope.

## Current or Historical Document

`GET /srs/:srId/worktree-spike/document?path=:relativePath&versionId=:optionalVersionId`

- Without `versionId`, reads the actual current Worktree file and verifies its SHA-256 against the latest indexed summary.
- With `versionId`, reads the exact immutable SQLite body and reports whether it is latest.
- `path` must be a normalized Worktree-relative `aidlc-docs/**/*.md` path.

## Version List

`GET /srs/:srId/worktree-spike/document/versions?path=:relativePath`

Returns `{ items, nextCursor }`, with version summaries ordered by descending version number. `nextCursor` is currently `null` for the focused local workflow.

## Save Human Edit

`POST /srs/:srId/worktree-spike/document/edits`

Required headers:

- `Content-Type: application/json`
- `X-Operation-Id: <UUID>`

Request body fields:

- `path`: normalized Worktree-relative Markdown path.
- `expectedHash`: lowercase 64-character SHA-256 observed when editing began.
- `body`: complete UTF-8 Markdown body, at most 1 MiB.

The result contains `{ view, changed }`. Identical content returns `changed: false` without a new version. Reusing the same operation ID and request returns the durable original result; reusing it for different content returns `OPERATION_CONFLICT`.

Relevant bounded errors include `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`, `WORKTREE_DOCUMENT_READ_ONLY`, `VERSION_CONFLICT`, `OPERATION_CONFLICT` and `STORAGE_FAILED`.
