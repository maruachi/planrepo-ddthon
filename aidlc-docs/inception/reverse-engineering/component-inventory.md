# Component Inventory

## Application Packages

| Package | Type | Purpose |
| --- | --- | --- |
| `src/app` | Application | Local server/client composition, configuration, routing shell, shutdown, and dirty-state protection. |
| `src/sr-document-foundation` | Domain/application | SRs, documents, versions, history, comparison, restoration, HTTP, persistence, and main UI. |
| `src/aidlc-planning` | Domain/integration | Fixed AI-DLC planning workflow, context, Claude execution, questions, decisions, and UI. |
| `src/review-implementation` | Domain/application | Version-specific peer review, demo roles, and manual implementation completion. |

## Shared Packages

| Package | Type | Purpose |
| --- | --- | --- |
| `src/shared` | Models/utilities | Cross-feature contracts, limits, validation, errors, and result types. |
| `src/shared/client` | Browser client | HTTP API parsing and idempotent mutation tracking. |

## Infrastructure Packages

None. The repository contains no CDK, Terraform, CloudFormation, container definition, or deployment package.

## Test Packages

| Package | Type | Purpose |
| --- | --- | --- |
| `tests/sr-document-foundation` | Unit/integration | Foundation services, SQLite, HTTP, worker, and client state. |
| `tests/aidlc-planning` | Unit/integration | Policy, context, runner, workflow service, migration, HTTP, and client state. |
| `tests/review-implementation` | Unit/integration | Review storage/service/HTTP/UI and end-to-end feature interaction. |

## Runtime Components

| Component | Count | Notes |
| --- | ---: | --- |
| Node HTTP process | 1 | Express and either Vite middleware or static assets. |
| SQLite database | 1 | Local file with schema version 3. |
| Diff worker | 1 | Long-lived worker per app instance. |
| Claude process | 0..N | One per running SR in theory; current service has no explicit global resource limiter. |

## Total Count

- **Logical source packages**: 6.
- **Application/domain packages**: 4.
- **Shared packages**: 2.
- **Infrastructure packages**: 0.
- **Test packages**: 3.
- **Source files**: 72 under `src/`.
- **Test/support files**: 29 under `tests/`.
