# Stateful Interactive AI-DLC Continuation — Implementation Summary

## Outcome

`AI-DLC 이어서 실행`은 더 이상 장시간 HTTP 요청 안에서 one-shot `claude -p`를 기다리지 않는다. 서버는 SR별 Claude session UUID를 저장하고 stream-JSON child process를 백그라운드에서 유지한다. 사용자는 SR 화면에서 Claude 출력과 상태를 확인하고, 자유 텍스트를 같은 process에 보내거나 입력 종료·실행 취소를 선택할 수 있다.

Process가 정상 종료되거나 서버가 재시작된 뒤 다시 실행하면 저장된 session UUID를 `--resume`에 전달하므로 Claude 대화 컨텍스트가 이어진다. 서버 재시작 중 기존 child process 자체를 재연결하지는 않으며, 중단 상태를 표시한 후 사용자의 명시적 재실행으로 session을 복구한다.

## Created Application and Test Files

- `src/worktree-spike/runner/claude-stream-protocol.ts`
- `tests/worktree-spike/runner/claude-stream-protocol.test.ts`
- `tests/worktree-spike/runner/claude-stream-protocol.property.test.ts`

## Modified Boundaries

- Worktree contracts, SQLite JSON view validation and service lifecycle.
- Claude runner, HTTP routes and guarded browser client.
- Worktree status panel and shared application styles.
- Runner, persistence, integration and browser-client tests.

## Session and Stream Model

- New session arguments: `-p --verbose --input-format stream-json --output-format stream-json --session-id <uuid>`.
- Continued session arguments: the same base arguments with `--resume <uuid>`.
- The first JSONL message is the fixed AI-DLC continuation prompt. Later JSONL messages contain the exact browser-authored text.
- stdin stays open until the user finishes or cancels, the process exits, the four-hour timeout expires, output exceeds its bound, or the server shuts down.
- stdout JSONL is decoded across arbitrary UTF-8 chunks. User, assistant, status and error entries are persisted in monotonic order.

## Bounds and Recovery

- One user message is limited to 16 KiB UTF-8 and cannot be empty or whitespace-only.
- Transcript history retains at most 500 entries and 256 KiB of text by evicting the oldest entries.
- One active child is allowed per SR. Operation IDs deduplicate message, finish and cancel mutations within the server process.
- Persisted active state without an in-memory child becomes a visible interrupted failure while retaining the session ID and transcript.
- Existing schema-v7 JSON rows without interactive fields load as an empty idle interaction; no database migration was required.

## Deliberately Deferred

SSE/WebSocket transport, terminal emulation, crash-time child reattachment, multiple session history, versioned transcript editing and a dedicated reset-session action remain outside this focused slice.
