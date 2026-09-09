# Worktree Document Edit and History — Implementation Summary

## Outcome

SR 상세 화면에서 성공한 `claude -p` Worktree 실행이 관찰한 모든 `aidlc-docs/**/*.md` 문서를 선택할 수 있다. 작성자는 허용된 최신 문서를 실제 Worktree에 저장할 수 있고, AI 생성 및 사람 편집 본문은 SQLite의 불변 버전으로 남는다. 과거 버전은 재시작 후에도 읽기 전용으로 열람할 수 있다.

## Created Application and Test Files

- `src/sr-document-foundation/storage/migrations/007-worktree-document-history.ts`
- `src/worktree-spike/storage/sqlite-worktree-document-history.ts`
- `src/worktree-spike/files/worktree-document-writer.ts`
- `src/worktree-spike/ui/worktree-editor-state.ts`
- `tests/worktree-spike/document-history.test.ts`
- `tests/worktree-spike/document-history.property.test.ts`
- `tests/worktree-spike/files/worktree-document-writer.test.ts`
- `tests/worktree-spike/ui/worktree-editor-state.test.ts`

## Modified Boundaries

- Worktree contracts, document reader/path policy, status persistence, service and application composition.
- Worktree HTTP routes, strict browser client guards, document tree, editor/version workspace and SR-detail query routing.
- Shared HTTP error status mapping and styles.
- Migration, service, integration, persistence, client, tree and manifest-generator tests.

## Storage and Save Model

- Schema v7 adds one current document identity per SR/path, append-only versions and append-only edit receipts.
- Versions have a positive contiguous number, exact UTF-8 body, SHA-256, origin, timestamp, prior version and optional operation reference.
- Latest identical hashes are no-ops. A durable operation receipt makes a repeated edit request return the original result.
- Save revalidates canonical containment, rejects symlinks/protected paths, checks the expected hash, fsyncs a same-directory temporary file and atomically renames it.
- If SQLite metadata commit fails after the file replacement, the service attempts an atomic compensating restore and never reports success.

## User Experience

- The document tree shows version, AI/human origin, current change classification and read-only state.
- Stable `worktreePath` and `worktreeVersionId` query parameters select current or historical content.
- Only an author viewing the latest editable version receives edit/save/cancel controls.
- Dirty drafts participate in existing route, reload and role-switch protection. Save conflicts and failures retain the draft.

## Deliberately Deferred

Visual diff, version restoration, tombstones, external drift import, full content-addressed checkpoints, approval invalidation and Git mutations remain outside this unit.

An unexpected process or machine crash between filesystem rename and SQLite commit is not fully recoverable without a durable checkpoint/journal protocol. Catchable metadata failures are compensated and tested; the broader crash-consistency mechanism remains deferred.
