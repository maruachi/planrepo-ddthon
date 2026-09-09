import { describe, expect, it } from 'vitest';
import type { CommandReceipt, CommandResult, CurrentBasis } from '@/src/contracts/results';
import { CommandSession, type CommandSubmission } from '@/src/web/state/command-session';

type Input = { readonly title: string; readonly nested: { readonly count: number } };
type Guard = { readonly expected: { readonly revision: number } };

const submission = (overrides: Partial<CommandSubmission<Input, Guard>> = {}): CommandSubmission<Input, Guard> => ({
  actorId: 'actor-a',
  scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
  target: 'description',
  command: 'M-005',
  input: { title: '첫 제출', nested: { count: 1 } },
  guard: { expected: { revision: 3 } },
  ...overrides,
});

const receipt: CommandReceipt = {
  scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
  receiptId: 'receipt-1',
  actorRef: { actorId: 'actor-a', projectId: 'project-a' },
  commandKind: 'M-005',
  requestId: 'request-1',
  idempotencyKey: 'key-1',
  inputFingerprint: 'sha256:input',
  committedRevision: 4,
  resultRefs: [],
  committedAt: '2026-09-09T00:00:00.000Z',
};

const current: CurrentBasis = {
  target: {
    kind: 'sr',
    projectId: 'project-a',
    srId: 'sr-a',
    entityId: 'sr-a',
  },
  currentRevision: 5,
  allowedActions: ['edit'],
};

describe('CommandSession', () => {
  it('제출 시 actor, scope, command, input, guard, key를 deep snapshot합니다', () => {
    const mutable = {
      actorId: 'actor-a',
      scope: { kind: 'sr' as const, projectId: 'project-a', srId: 'sr-a' },
      target: 'description',
      command: 'M-005' as const,
      input: { title: '첫 제출', nested: { count: 1 } },
      guard: { expected: { revision: 3 } },
    };
    const session = new CommandSession(() => 'key-1');
    const attempt = session.submit(mutable);

    mutable.scope.srId = 'sr-b';
    mutable.input.nested.count = 99;
    mutable.guard.expected.revision = 9;

    expect(attempt).toMatchObject({
      idempotencyKey: 'key-1',
      submission: {
        actorId: 'actor-a',
        scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
        target: 'description',
        command: 'M-005',
        input: { title: '첫 제출', nested: { count: 1 } },
        guard: { expected: { revision: 3 } },
      },
    });
  });

  it('처리 중 같은 제출은 같은 key이고 편집한 명시 제출은 새 key입니다', () => {
    const keys = ['key-1', 'key-2'];
    const session = new CommandSession(() => {
      const key = keys.shift();
      if (key === undefined) throw new Error('예상보다 많은 key를 요청했습니다.');
      return key;
    });

    const first = session.submit(submission());
    const repeated = session.submit(submission());
    const edited = session.submit(submission({
      input: { title: '편집한 제출', nested: { count: 2 } },
    }));

    expect(repeated.idempotencyKey).toBe(first.idempotencyKey);
    expect(edited.idempotencyKey).toBe('key-2');
  });

  it('결과가 불명확한 재조회는 고정 snapshot과 같은 key를 사용합니다', () => {
    const session = new CommandSession(() => 'key-1');
    const first = session.submit(submission());

    expect(session.markResultUnknown(first)).toMatchObject({
      phase: 'result_confirmation_required',
      attempt: { idempotencyKey: 'key-1' },
    });
    expect(session.retry(first)).toEqual(first);
  });

  it('같은 attempt의 중복 실행은 합치고 실행이 끝난 뒤 같은 key 재확인을 허용합니다', () => {
    const session = new CommandSession(() => 'key-1');
    const attempt = session.submit(submission());

    expect(session.beginExecution(attempt)).toBe(true);
    expect(session.beginExecution(attempt)).toBe(false);
    session.endExecution(attempt);

    expect(session.retry(attempt)).toEqual(attempt);
    expect(session.beginExecution(attempt)).toBe(true);
  });

  it('늦은 이전 scope 결과는 처리 사실만 남기고 현재 폼에 적용하지 않습니다', () => {
    const keys = ['key-a', 'key-b'];
    const session = new CommandSession(() => keys.shift() ?? 'unexpected');
    const oldAttempt = session.submit(submission());
    const currentAttempt = session.submit(submission({
      actorId: 'actor-b',
      scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-b' },
    }));
    const result: CommandResult<{ revision: number }> = {
      kind: 'Committed',
      value: { revision: 4 },
      receipt,
    };

    const resolution = session.resolve(oldAttempt, result, {
      actorId: 'actor-b',
      scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-b' },
      target: 'description',
      command: 'M-005',
    });

    expect(resolution.appliesToCurrentForm).toBe(false);
    expect(resolution.result.kind).toBe('committed');
    expect(session.current()?.attempt.idempotencyKey).toBe(currentAttempt.idempotencyKey);
    expect(session.history()).toHaveLength(1);
  });

  it('같은 scope와 command여도 늦은 이전 target 결과는 현재 폼에 적용하지 않습니다', () => {
    const session = new CommandSession(() => 'key-1');
    const attempt = session.submit(submission());
    const result: CommandResult<{ revision: number }> = {
      kind: 'Committed',
      value: { revision: 4 },
      receipt,
    };

    const resolution = session.resolve(attempt, result, {
      actorId: 'actor-a',
      scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
      target: 'source:source-2',
      command: 'M-005',
    });

    expect(resolution.appliesToCurrentForm).toBe(false);
  });

  it('Replayed receipt와 현재 기준을 Committed와 분리합니다', () => {
    const session = new CommandSession(() => 'key-1');
    const attempt = session.submit(submission());
    const result: CommandResult<{ revision: number }> = {
      kind: 'Replayed',
      value: { revision: 4 },
      receipt,
      current,
    };

    const resolution = session.resolve(attempt, result, {
      actorId: 'actor-a',
      scope: { kind: 'sr', projectId: 'project-a', srId: 'sr-a' },
      target: 'description',
      command: 'M-005',
    });

    expect(resolution).toMatchObject({
      appliesToCurrentForm: true,
      result: {
        kind: 'replayed',
        priorReceipt: receipt,
        current,
      },
    });
    expect(resolution.result).not.toHaveProperty('committedReceipt');
  });
});
