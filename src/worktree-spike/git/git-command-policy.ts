const SAFE_BRANCH = /^planrepo\/sr\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class GitCommandPolicyError extends Error {
  constructor(message = 'Git command is not allowed by the worktree spike policy.') {
    super(message);
    this.name = 'GitCommandPolicyError';
  }
}

function isBranch(value: string | undefined): value is string {
  return value !== undefined && SAFE_BRANCH.test(value);
}

/**
 * Keep the spike's Git surface deliberately small. Callers must pass arguments
 * directly to a shell-free process launcher after this check.
 */
export function assertGitCommandAllowed(args: readonly string[]): void {
  const allowed =
    args.length === 2 && args[0] === 'rev-parse' && args[1] === '--show-toplevel'
    || args.length === 4 && args[0] === 'show-ref' && args[1] === '--verify' && args[2] === '--quiet' && isBranch(args[3]?.replace(/^refs\/heads\//, ''))
    || args.length === 3 && args[0] === 'worktree' && args[1] === 'list' && args[2] === '--porcelain'
    || args.length === 6 && args[0] === 'worktree' && args[1] === 'add' && args[2] === '-b' && isBranch(args[3]) && args[5] === 'HEAD'
    || args.length === 4 && args[0] === 'worktree' && args[1] === 'add' && isBranch(args[3]);

  if (!allowed) throw new GitCommandPolicyError();
}
