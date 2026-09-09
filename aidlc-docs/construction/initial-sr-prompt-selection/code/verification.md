# Initial SR Prompt Selection Hotfix — Verification

## Results

- `npm run typecheck`: passed for client, server and test TypeScript projects.
- Focused Vitest run: 4 files and 18 tests passed.
- `npm test`: worker build plus 43 test files and 160 tests passed.
- `npm run build`: Vite client and server TypeScript production build passed.
- `git diff --check`: passed.
- Duplicate scan: no `_modified` or `_new` source/test files found.

The production build retained the existing non-blocking advisory that one client bundle is approximately 501 kB. This Hotfix does not change the client bundle boundary.

## Focused Coverage

- Exact initial prompt body with title, description, attachment name and attachment Markdown.
- Initial prompt without an attachment section.
- First-run HTTP/legacy execution receives the generated SR prompt.
- Interactive first run uses a new session; a later run uses exact `RESUME_PROMPT` and the same session ID.
- A restarted service with a persisted session selects resume mode without reading SR requirements again.
- SR lookup failure prevents runner invocation.
- Worktree file generation and document-history integration remain passing.

## Property-Based Testing Compliance

- **PBT-02**: N/A because prompt construction has no inverse or round trip.
- **PBT-03**: Compliant. Generated valid SR inputs preserve their own fields, produce deterministic prompts and remain isolated from another generated SR.
- **PBT-07**: Compliant. The generator produces structured SR requirements with optional attachments, Unicode and Markdown-shaped characters.
- **PBT-08**: Compliant. fast-check shrinking is enabled; the test logs and uses fixed seed `424242` for 150 runs per property.
- **PBT-09**: Compliant. The existing fast-check 4.9.0 and Vitest 5.0.0 integration is used.

Focused replay command:

`./node_modules/.bin/vitest run tests/worktree-spike/runner/aidlc-prompt.property.test.ts tests/worktree-spike/runner/worktree-aidlc-runner.test.ts tests/worktree-spike/integration.test.ts tests/worktree-spike/document-history.test.ts`

## Extension Compliance

- Security Baseline: disabled; N/A.
- Resiliency Baseline: disabled; N/A.
- Property-Based Testing Partial: compliant for applicable PBT-03, PBT-07, PBT-08 and PBT-09; PBT-02 N/A.
- Blocking findings: none.

