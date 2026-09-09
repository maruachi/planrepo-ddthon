# WT-Spike Verification

## Environment

- Node: 24.7.0
- Git: 2.39.5
- Vitest: 5.0.0
- fast-check: 4.9.0, exact lockfile version
- Timebox start: 2026-09-09T03:46:59Z
- Core implementation verification captured by: 2026-09-09T03:52:52Z

## Verification Results

| Check | Command/evidence | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Passed: client, server and test projects |
| Spike focused suite | `vitest run tests/worktree-spike` | Passed: 8 files, 32 tests |
| Impact regression sample | spike + config + SR HTTP + planning HTTP + review HTTP | Passed: 12 files, 40 tests |
| Full suite | `npm test` | Passed: 31 files, 118 tests; worker built |
| Production build | `npm run build` | Passed; existing chunk-size warning only |
| Markdown/code whitespace | `git diff --check` | Passed |
| Duplicate brownfield files | `_new`/`_modified` scan under `src` and `tests` | None |

The first sandboxed focused test attempt could not bind loopback and failed with `listen EPERM`; it did not indicate a product defect. The same suite was rerun with approved local-test permission. One Lead test fixture then exposed a default-argument setup defect, which was corrected. All subsequent focused, regression and full runs passed.

## Isolated Vertical Proof

`tests/worktree-spike/integration.test.ts` creates an OS temporary local Git repository and performs this sequence:

1. Commit `AGENTS.md` and a legacy `aidlc-docs/aidlc-state.md` fixture.
2. Provision `planrepo/sr/<uuid>` at the deterministic managed root path.
3. Parse `Current Stage: Code Generation` and the first unchecked item `Integrate vertical proof`.
4. Capture the managed-file manifest.
5. Invoke an injected fake launcher with the exact resume prompt, `shell: false` and the provisioned worktree as `cwd`.
6. Have the fake launcher create `aidlc-docs/generated.md`.
7. Capture the second manifest and report `aidlc-docs/generated.md` as created.
8. Close the runner and recursively remove the temporary fixture.

This proves the local Git/filesystem/process integration without changing the user's configured repository or default database.

## PBT Evidence

Command: `vitest run tests/worktree-spike/manifest/scoped-manifest.property.test.ts --reporter verbose`

- Output identifies `seed=424242; shrinking=enabled`.
- Three properties passed, each with 150 runs.
- PBT-02: manifest canonical serialize/deserialize round-trip.
- PBT-03: deterministic order/serialization and relative managed-path invariant.
- PBT-07: reusable path, SHA-256, manifest and invalid-path generators.
- PBT-08: fast-check shrinking remains enabled; fixed seed is replayable and emitted.
- PBT-09: Vitest-compatible fast-check 4.9.0 is exactly locked.
- Example tests cover real filesystem capture/diff, parser, Git provision/policy and runner/client behavior alongside PBT.

## Fake versus Real CLI

- Fake launcher: passed exact prompt/cwd/shell-free tests and isolated file-change proof.
- Actual authenticated Claude CLI: not run. No provider success claim is made.
- Browser UI smoke: not run. The panel is client/server typechecked and included in the successful production bundle; interactive elements use stable `worktree-spike-*` test IDs.

## Residual Risk

The spike does not verify restart recovery, durable checkpoints, official AI-DLC profile detection, external drift resolution, file edit/restore, peer review compatibility, 20,000-file performance or a real authenticated Claude run. These remain in the superseded full P0+P1 plan backlog.
