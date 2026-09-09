# Initial SR Prompt Selection Hotfix — Implementation Summary

## Outcome

The first Claude Code session for an SR now receives a prompt built from that SR's title, description and optional Markdown attachment. The prompt explicitly asks Claude to create the requirements document and begin the AI-DLC workflow.

After a session ID has been stored, every explicit later run sends only the unchanged resume message:

`aidlc-docs/aidlc-state.md를 확인하고, 첫 번째 미완료 항목부터 이어서 진행해주세요.`

The existing session ID is passed with `--resume`, including after the service restarts and reloads its persisted Worktree view.

## Modified Application Files

- `src/worktree-spike/contracts.ts` — initial prompt builder, SR requirements port and flexible internal run prompt.
- `src/worktree-spike/worktree-spike-service.ts` — first-versus-subsequent prompt selection and unchanged prompt forwarding.
- `src/app/create-app.ts` — read-only adapter from the existing SQLite store to SR requirements.
- `src/worktree-spike/runner/worktree-aidlc-runner.ts` — legacy execution accepts either selected non-empty prompt while retaining existing validation.

## Modified Test Files

- `tests/worktree-spike/integration.test.ts` — initial prompt, attachment, lookup failure, same-session resume and persisted restart scenarios.
- `tests/worktree-spike/document-history.test.ts` — supplies the SR requirements fixture to the updated service boundary.

## Created Test File

- `tests/worktree-spike/runner/aidlc-prompt.property.test.ts` — deterministic prompt, source preservation and SR-isolation properties.

## Preserved Boundaries

- No HTTP route, response shape or browser UI change.
- No SQLite migration or persisted Worktree-view shape change.
- No package dependency, environment variable, infrastructure or deployment change.
- Existing stream-JSON messaging, transcript polling, finish, cancel, Worktree documents, reviews and board movement remain unchanged.

## Selection Rule

1. If the pre-run persisted Worktree view has no `sessionId`, load the matching SR requirements and build the initial workflow prompt.
2. If the view has a `sessionId`, do not reload or resend the SR requirements; use the exact resume prompt.
3. Pass the selected prompt unchanged to the interactive or compatibility runner path.
4. If first-run SR requirements cannot be loaded, fail before launching Claude.

