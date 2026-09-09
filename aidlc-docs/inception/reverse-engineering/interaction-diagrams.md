# Business Interaction Diagrams

## Document Edit and Restore

```mermaid
sequenceDiagram
    participant Author
    participant UI
    participant DocumentService
    participant Store
    Author->>UI: Save edited Markdown
    UI->>DocumentService: Edit expected version
    DocumentService->>Store: Read current version
    alt Base is latest
        DocumentService->>Store: Commit new immutable version and receipt
        Store-->>UI: Updated document view
    else Base is stale
        DocumentService-->>UI: Version conflict and latest reference
    end
    Author->>UI: Restore historical version
    UI->>DocumentService: Restore source version
    DocumentService->>Store: Commit restoration as a new latest version
```

Text alternative: edits use optimistic version checks and preserve the draft on conflict. Restore never deletes newer history; it creates another latest version containing historical content.

## Planning Approval and Progression

```mermaid
sequenceDiagram
    participant Author
    participant UI
    participant PlanningService
    participant Store
    Author->>UI: Approve current document set
    UI->>PlanningService: Decision with exact version references
    PlanningService->>Store: Verify latest versions and workflow revision
    Store-->>PlanningService: Current state
    PlanningService->>Store: Commit approval and audit event
    Author->>UI: Continue to next stage
    UI->>PlanningService: Next action
    PlanningService->>Store: Revalidate approval fingerprint by references
    PlanningService->>PlanningService: Advance fixed stage index
```

Text alternative: approval is bound to exact latest version references. A later document edit makes the approval invalid, and progression is rejected until the new versions are approved.

## Review Lifecycle

```mermaid
sequenceDiagram
    participant Author
    participant Reviewer
    participant ReviewService
    participant Store
    Author->>ReviewService: Request review for one version
    ReviewService->>Store: Commit immutable target and request
    Reviewer->>ReviewService: Approve or request changes
    ReviewService->>Store: Transition requested review once
    Store-->>Reviewer: Result tied to original version
```

Text alternative: an author requests review for an exact version. A reviewer records one terminal outcome. Newer document versions do not move the review target and pending reviews do not block planning.

## Target Worktree Interaction Gap

```mermaid
sequenceDiagram
    participant PlanRepo
    participant Worktree
    participant Claude
    participant CheckpointStore
    Note over PlanRepo,CheckpointStore: Components below do not exist yet
    PlanRepo->>Worktree: Validate profile and create start checkpoint
    PlanRepo->>Claude: Run with worktree as current directory
    Claude->>Worktree: Read state and instructions; change files
    PlanRepo->>Worktree: Reparse state and collect changed files
    PlanRepo->>CheckpointStore: Persist immutable manifest and blobs
```

Text alternative: the requested architecture must validate and checkpoint a worktree, run Claude in that worktree, then reparse AI-DLC state and persist changed files. None of these file/worktree interactions exists in the current code.
