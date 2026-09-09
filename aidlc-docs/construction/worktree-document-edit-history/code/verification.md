# Worktree Document Edit and History — Verification

## Completed Checks

- `npm test`: 40 test files and 146 tests passed.
- `npm run typecheck`: client, server and test TypeScript projects passed.
- `npm run build`: Vite production client and server TypeScript build passed.
- `git diff --check`: passed.
- Duplicate `_new` or `_modified` application files: none.

The suite covers schema v1–v7 migration, immutable version/update/delete protection, AI v1, human v2, no-op, operation replay/conflict, restart recovery, current/historical HTTP reads, version ordering, optimistic conflicts, protected paths, traversal, symlinks, 1 MiB bounds, atomic replacement, mode preservation and compensation.

## Property-Based Testing

- PBT-02 snapshot round-trip: 150 cases.
- PBT-03 contiguous newest-first versions, latest-hash no-op and current-pointer invariant: 150 cases.
- Library: fast-check 4.9.0 with Vitest.
- Fixed seed: `424242`; shrinking remains enabled.

Replay command:

```sh
./node_modules/.bin/vitest run tests/worktree-spike/document-history.property.test.ts
```

The test source fixes the seed and run count, so the command replays the same generated sequence. A shrunk counterexample printed by fast-check can be added as a focused regression case.

## Known Boundary

Catchable failures after file replacement trigger compensating restore. A host crash between atomic rename and SQLite commit still requires the deferred durable checkpoint/recovery design and is not presented as solved.
