import { describe, expect, it } from 'vitest';
import { assertGitCommandAllowed, GitCommandPolicyError } from '../../../src/worktree-spike/git/git-command-policy.js';

describe('Git command policy', () => {
  it('allows only the reads and worktree provisioning used by the spike', () => {
    const branch = 'planrepo/sr/SR-123';
    expect(() => assertGitCommandAllowed(['rev-parse', '--show-toplevel'])).not.toThrow();
    expect(() => assertGitCommandAllowed(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).not.toThrow();
    expect(() => assertGitCommandAllowed(['worktree', 'list', '--porcelain'])).not.toThrow();
    expect(() => assertGitCommandAllowed(['worktree', 'add', '-b', branch, '/tmp/managed/SR-123', 'HEAD'])).not.toThrow();
    expect(() => assertGitCommandAllowed(['worktree', 'add', '/tmp/managed/SR-123', branch])).not.toThrow();
  });

  it.each([
    ['commit', '-m', 'no'],
    ['push', 'origin', 'main'],
    ['push', '--force', 'origin', 'main'],
    ['reset', '--hard', 'HEAD'],
    ['clean', '-fd'],
    ['worktree', 'remove', '/tmp/worktree'],
    ['branch', '-D', 'planrepo/sr/SR-123'],
  ])('rejects git %s', (...args) => {
    expect(() => assertGitCommandAllowed(args)).toThrow(GitCommandPolicyError);
  });

  it('rejects global options and unsafe branch/path-shaped arguments', () => {
    expect(() => assertGitCommandAllowed(['-C', '/tmp/repo', 'status'])).toThrow(GitCommandPolicyError);
    expect(() => assertGitCommandAllowed(['show-ref', '--verify', '--quiet', 'refs/heads/main'])).toThrow(GitCommandPolicyError);
    expect(() => assertGitCommandAllowed(['worktree', 'add', '-b', 'planrepo/sr/../escape', '/tmp/escape', 'HEAD'])).toThrow(GitCommandPolicyError);
  });
});
