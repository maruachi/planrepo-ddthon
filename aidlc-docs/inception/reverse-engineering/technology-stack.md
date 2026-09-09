# Technology Stack

## Programming Languages

| Language | Version | Usage |
| --- | --- | --- |
| TypeScript | 7.0.2 compiler | Server, browser UI, worker, contracts, migrations, and tests. |
| JavaScript | ES modules on Node 24 | Runtime module format and fake CLI fixture. |
| SQL | SQLite dialect | Schema, triggers, queries, and transactions embedded in TypeScript. |
| CSS | Browser standard | Global and feature styling. |
| Markdown | CommonMark/GFM | SR attachments, generated documents, and workflow documentation. |

## Frameworks and Libraries

| Technology | Version | Purpose |
| --- | ---: | --- |
| React | 19.2.8 | Browser component model. |
| React DOM | 19.2.8 | Browser rendering. |
| React Router DOM | 7.18.3 | Board, SR, document, and version routes. |
| Express | 5.2.1 | Local REST API and static/Vite middleware host. |
| better-sqlite3 | 13.0.3 | Synchronous embedded SQLite adapter. |
| react-markdown | 10.1.0 | Markdown rendering. |
| remark-gfm | 4.0.1 | GFM table/list support. |
| diff | 9.0.0 | Line-diff generation inside a worker. |

## Runtime and Infrastructure

| Technology | Version/configuration | Purpose |
| --- | --- | --- |
| Node.js | `>=24 <25` | Server, worker threads, filesystem/process APIs. |
| SQLite | bundled through `better-sqlite3` | Local durable state with WAL/full-sync configuration. |
| Claude Code CLI | Configurable executable; 2.1.266 observed locally | External worktree AI-DLC execution. The installed CLI exposes session resume and bidirectional stream-JSON modes, but the application currently uses only one-shot print mode. |
| HTTP | `127.0.0.1`, default port 4310 | Local browser/server transport. |
| Git and filesystem | Configured repository plus `.planrepo/worktrees` by default | Deterministic SR worktrees, managed-file hashing, legacy state reads, and changed Markdown reads. |

## Build Tools

| Tool | Version | Purpose |
| --- | ---: | --- |
| npm | Lockfile version 3 | Dependency and script management. |
| TypeScript | 7.0.2 | Client/server/worker/test compilation and checking. |
| Vite | 8.2.2 | Browser development middleware and production bundle. |
| `tsx` | 4.23.13 | Execute TypeScript server during development. |
| Vite React plugin | 6.1.1 | React transformation. |

## Testing Tools

| Tool | Version | Purpose |
| --- | ---: | --- |
| Vitest | 5.0.0 | Unit and integration tests. |
| fast-check | 4.9.0 | Property tests for scoped-manifest normalization, serialization round trips, and delta invariants. |
| Node assertions/process fixtures | Node 24 | Fake CLI, temporary Git/filesystem, worker, and HTTP integration tests. |

## Infrastructure Assessment

- No cloud SDK, container runtime, IaC framework, remote database, queue, or telemetry backend is declared.
- No lint script or formatter configuration is present.
- No CI workflow is present.
- The vertical spike uses existing Node `child_process`, crypto, path and filesystem APIs plus the system Git executable; no Git library was added.
- Git command allowlisting, canonical containment, symlink rejection and SHA-256 hashing exist for the spike. Content-addressed blobs, full checkpoints, lifecycle cleanup/recovery and a repository trust registry remain absent.
