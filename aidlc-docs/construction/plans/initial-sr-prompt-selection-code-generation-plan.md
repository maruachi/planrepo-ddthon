# Initial SR Prompt Selection Hotfix — Code Generation Plan

This checklist is the single source of truth for the Hotfix implementation. Complete it in order and mark each checkbox in the same interaction as the work.

## Unit Context

- **Unit**: Initial SR Prompt Selection Hotfix.
- **Workspace root**: `/Users/dgyim/works/ddthon-2026/fix-ydg-01`.
- **Project type**: Brownfield TypeScript application.
- **Requirements**: FR-ISP-01 through FR-ISP-03 and NFR-ISP-01 through NFR-ISP-06.
- **User stories**: None generated; eight acceptance scenarios in the focused requirements are authoritative.
- **Dependencies**: Existing `StorePort` SR query, Worktree session persistence, Claude runner and interactive service lifecycle.
- **Owned database entities**: None.
- **API/UI/deployment changes**: None.

## Expected Contracts

- `RESUME_PROMPT` remains byte-for-byte unchanged.
- A pure builder accepts only SR title, description and optional attachment fields and returns a deterministic initial prompt.
- A narrow read-only dependency resolves the current SR requirements by `srId`.
- `WorktreeSpikeService.resume` selects the initial prompt when the pre-run view has no `sessionId`; otherwise it selects `RESUME_PROMPT`.
- The selected prompt is passed unchanged to both interactive and legacy runner paths.
- The runner remains shell-free and rejects empty prompts and invalid session IDs.

## Part 1 — Planning Checklist

- [x] Step 1 — Load approved requirements, execution plan, current state and reverse-engineered code structure.
- [x] Step 2 — Confirm the existing files to modify in place and that no new production package is required.
- [x] Step 3 — Map requirements and acceptance scenarios to implementation steps.
- [x] Step 4 — Define the read-only SR requirements interface and prompt-selection contract.
- [x] Step 5 — Evaluate Partial-PBT applicability and include PBT-03, PBT-07, PBT-08 and PBT-09.
- [x] Step 6 — Define focused, full-regression and rollback checks.
- [x] Step 7 — Create and validate this plan and its approval question.
- [x] Step 8 — Receive explicit approval for Part 2 generation — approved via chat on 2026-09-09T05:53:23Z.

## Part 2 — Generation Checklist

### Step 9 — Prompt Contract and Builder

- [x] Modify `src/worktree-spike/contracts.ts` in place.
- [x] Add the narrow SR requirements input/port types.
- [x] Add a deterministic initial prompt builder with optional attachment handling.
- [x] Keep `RESUME_PROMPT` exactly unchanged and broaden internal run request typing only as required.
- [x] Verify no duplicate contract or prompt files were created.

**Traceability**: FR-ISP-01, FR-ISP-02.3–4, NFR-ISP-02, NFR-ISP-04; Acceptance 1–3.

### Step 10 — Service Prompt Selection

- [x] Modify `src/worktree-spike/worktree-spike-service.ts` in place.
- [x] Add the read-only SR requirements dependency without changing HTTP contracts.
- [x] Read SR source only when the pre-run view has no persisted `sessionId`.
- [x] Use the generated initial prompt for a new session and exact `RESUME_PROMPT` for an existing session.
- [x] Pass the selected prompt unchanged through interactive and legacy execution.
- [x] Ensure SR lookup failure occurs before runner invocation.

**Traceability**: FR-ISP-01, FR-ISP-02, FR-ISP-03; Acceptance 4–7.

### Step 11 — Composition Root and Runner Compatibility

- [x] Modify `src/app/create-app.ts` in place to adapt the existing `StorePort` SR read into the Worktree dependency.
- [x] Modify `src/worktree-spike/runner/worktree-aidlc-runner.ts` in place only if legacy prompt validation requires it.
- [x] Preserve shell-free arguments, Worktree `cwd`, session ID and resume flags.
- [x] Verify no database migration, HTTP route, browser UI or new dependency was added.

**Traceability**: FR-ISP-03, NFR-ISP-01, NFR-ISP-03, NFR-ISP-05.

### Step 12 — Focused Example Tests

- [x] Update `tests/worktree-spike/integration.test.ts` for first-run SR prompt capture.
- [x] Cover title, description, optional attachment name/body and no-attachment output.
- [x] Cover exact follow-up `RESUME_PROMPT` with the same persisted session ID.
- [x] Cover a restarted service loading a persisted session and choosing resume mode.
- [x] Cover SR lookup failure without a runner call.
- [x] Update runner tests only where internal prompt typing or legacy validation changes — no runner-test edit needed; existing non-empty/session validation remains valid.

**Traceability**: Acceptance 1–7 and NFR-ISP-06.

### Step 13 — Partial Property-Based Tests

- [x] Add or update a clearly named property test under `tests/worktree-spike/runner/`.
- [x] PBT-03: generated valid SR requirement objects always produce deterministic, SR-local prompt content and preserve the exact resume constant.
- [x] PBT-07: use a domain-specific SR requirements generator including empty optional attachment, Unicode and boundary-shaped Markdown.
- [x] PBT-08: retain fast-check shrinking and use/log seed `424242` with at least 100 runs.
- [x] PBT-09: use existing fast-check 4.9.0 with Vitest.
- [x] Mark PBT-02 N/A because prompt construction has no inverse or round trip.

**Traceability**: NFR-ISP-02, NFR-ISP-04, NFR-ISP-06.

### Step 14 — Focused Verification

- [x] Run TypeScript typecheck.
- [x] Run focused Worktree prompt, runner and integration tests with seed `424242` embedded in the PBT files.
- [x] Fix only failures caused by this Hotfix and repeat until passing — no code failure; removed unsupported Vitest CLI `--seed` while retaining the in-test fixed seed.

### Step 15 — Full Regression Verification

- [x] Run the full Vitest suite with seed `424242` embedded in applicable PBT files.
- [x] Run the production build.
- [x] Run `git diff --check`.
- [x] Confirm no duplicate source files and no unintended API, UI, migration or dependency changes.

### Step 16 — Generated Documentation and Handoff

- [x] Create concise Markdown summaries under `aidlc-docs/construction/initial-sr-prompt-selection/code/`.
- [x] Record modified and created application/test files separately.
- [x] Record commands, results, PBT compliance and any environment limitations.
- [x] Update `aidlc-docs/aidlc-state.md` and `aidlc-docs/audit.md` after every completed step.
- [x] Create the standardized generated-artifact approval question and stop before Build and Test.

## Rollback Boundary

- Revert only the prompt builder/types, Worktree service wiring, composition root adaptation and focused tests introduced by this plan.
- No database rollback is needed because the plan introduces no migration or persisted-shape change.
- Do not alter or discard unrelated dirty-worktree changes.

## PBT Compliance Plan

- **PBT-02**: N/A; there is no inverse transformation.
- **PBT-03**: Applicable; verify prompt determinism, source inclusion and SR isolation.
- **PBT-07**: Applicable; use a structured SR requirements generator.
- **PBT-08**: Applicable; preserve shrinking and fixed-seed reproduction.
- **PBT-09**: Compliant by plan; fast-check 4.9.0 and Vitest are already installed.
- Security Baseline and Resiliency Baseline are disabled and N/A.
