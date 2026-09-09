# Worktree Document Edit and History

This unit adds safe editing and immutable history for AI-DLC Markdown produced in each SR Worktree.

## Review Map

- [Implementation summary](implementation-summary.md)
- [API reference](api-reference.md)
- [Verification evidence](verification.md)
- [Generated-artifact approval](code-generation-approval-questions.md)
- [Approved code generation plan](../../plans/worktree-document-edit-history-code-generation-plan.md)

Application code remains in the workspace root under `src/`; tests remain under `tests/`. This documentation directory contains summaries only.

The normal user path is: open an SR card, prepare or resume its Worktree AI-DLC run, choose a document in the AI-DLC tree, edit the latest eligible version as author, save, and use the version selector to inspect prior immutable content.
