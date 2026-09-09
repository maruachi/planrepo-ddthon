# Initial SR Prompt Selection Hotfix — Internal Contract Reference

## Prompt Constants

- `RESUME_PROMPT`: unchanged exact Korean state-continuation message.
- `INITIAL_WORKFLOW_PROMPT_CLOSING`: tells Claude to create the requirements document from the SR specification and start the AI-DLC workflow.

## Prompt Builder

`buildInitialWorkflowPrompt(requirements)` returns deterministic Markdown containing:

- `# SR 요구사항 명세서`
- SR title
- SR description
- optional attachment display name and Markdown body
- the initial workflow closing sentence

The optional attachment section is omitted when `attachmentMarkdown` is absent.

## Read-Only Requirements Port

`WorktreeSrRequirementsPort.get(srId)` returns only the current SR title, description and optional attachment fields. The production adapter uses the existing `StorePort` SR query; it performs no write.

## Service Behavior

`WorktreeSpikeService.resume(srId, operationId)` keeps its existing HTTP-facing contract. Internally it selects:

- initial prompt plus a new `--session-id` when no persisted session exists;
- exact resume prompt plus `--resume` when a persisted session exists.

The active-run deduplication behavior remains unchanged. Repeated resume requests while a process is active return the current view without starting another process or sending another prompt.

## Compatibility Runner

`RunRequest.prompt` is an internal non-empty string so the compatibility path can receive either canonical prompt. `WorktreeAidlcRunner.start` continues to validate non-empty input, UUID session IDs, bounded execution and shell-disabled process arguments.

