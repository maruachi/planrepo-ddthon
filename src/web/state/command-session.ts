import type { TargetScope } from '@/src/contracts/context';
import type { PublicMethodId } from '@/src/contracts/methods';
import type {
  CommandReceipt,
  CommandResult,
  CurrentBasis,
  DomainError,
} from '@/src/contracts/results';

export interface CommandSubmission<I, G> {
  readonly actorId: string;
  readonly scope: TargetScope;
  readonly target: string;
  readonly command: PublicMethodId;
  readonly input: I;
  readonly guard: G;
}

export interface CommandAttempt<I, G> {
  readonly idempotencyKey: string;
  readonly submission: CommandSubmission<I, G>;
}

export interface ActiveCommand<I, G> {
  readonly phase: 'processing' | 'result_confirmation_required';
  readonly attempt: CommandAttempt<I, G>;
}

export interface CurrentCommandContext {
  readonly actorId: string;
  readonly scope: TargetScope;
  readonly target: string;
  readonly command: PublicMethodId;
}

export type DisplayedCommandResult<T> =
  | { readonly kind: 'committed'; readonly value: T; readonly committedReceipt: CommandReceipt }
  | { readonly kind: 'replayed'; readonly value: T; readonly priorReceipt: CommandReceipt; readonly current: CurrentBasis }
  | { readonly kind: 'rejected'; readonly error: DomainError; readonly priorReceipt?: CommandReceipt };

export interface CommandResolution<T> {
  readonly appliesToCurrentForm: boolean;
  readonly result: DisplayedCommandResult<T>;
}

export class CommandSession {
  private readonly records = new Map<string, ActiveCommand<unknown, unknown>>();
  private readonly resolutions: CommandResolution<unknown>[] = [];
  private readonly executing = new Set<string>();
  private activeKey: string | undefined;

  constructor(
    private readonly createIdempotencyKey: () => string = () => crypto.randomUUID(),
  ) {}

  submit<I, G>(submission: CommandSubmission<I, G>): CommandAttempt<I, G> {
    const active = this.current();
    if (active !== undefined && deepEqual(active.attempt.submission, submission)) {
      return active.attempt as CommandAttempt<I, G>;
    }

    const attempt = immutableSnapshot({
      idempotencyKey: this.createIdempotencyKey(),
      submission,
    });
    const state = immutableSnapshot({ phase: 'processing' as const, attempt });
    this.records.set(attempt.idempotencyKey, state);
    this.activeKey = attempt.idempotencyKey;
    return attempt;
  }

  markResultUnknown<I, G>(attempt: CommandAttempt<I, G>): ActiveCommand<I, G> {
    const known = this.requireAttempt(attempt);
    const state = immutableSnapshot({
      phase: 'result_confirmation_required' as const,
      attempt: known,
    });
    this.records.set(known.idempotencyKey, state);
    return state as ActiveCommand<I, G>;
  }

  retry<I, G>(attempt: CommandAttempt<I, G>): CommandAttempt<I, G> {
    const known = this.requireAttempt(attempt);
    const state = immutableSnapshot({ phase: 'processing' as const, attempt: known });
    this.records.set(known.idempotencyKey, state);
    return known as CommandAttempt<I, G>;
  }

  beginExecution<I, G>(attempt: CommandAttempt<I, G>): boolean {
    const known = this.requireAttempt(attempt);
    if (this.executing.has(known.idempotencyKey)) return false;
    this.executing.add(known.idempotencyKey);
    return true;
  }

  endExecution<I, G>(attempt: CommandAttempt<I, G>): void {
    this.executing.delete(attempt.idempotencyKey);
  }

  resolve<T, I, G>(
    attempt: CommandAttempt<I, G>,
    result: CommandResult<T>,
    current: CurrentCommandContext,
  ): CommandResolution<T> {
    const known = this.requireAttempt(attempt);
    const displayed = displayResult(result);
    const resolution = immutableSnapshot({
      appliesToCurrentForm:
        this.activeKey === known.idempotencyKey &&
        sameCommandContext(known.submission, current),
      result: displayed,
    });
    this.records.delete(known.idempotencyKey);
    this.executing.delete(known.idempotencyKey);
    if (this.activeKey === known.idempotencyKey) this.activeKey = undefined;
    this.resolutions.push(resolution as CommandResolution<unknown>);
    return resolution;
  }

  current(): ActiveCommand<unknown, unknown> | undefined {
    return this.activeKey === undefined ? undefined : this.records.get(this.activeKey);
  }

  history(): readonly CommandResolution<unknown>[] {
    return Object.freeze([...this.resolutions]);
  }

  private requireAttempt<I, G>(attempt: CommandAttempt<I, G>): CommandAttempt<unknown, unknown> {
    const known = this.records.get(attempt.idempotencyKey)?.attempt;
    if (known === undefined || !deepEqual(known, attempt)) {
      throw new Error('이 CommandSession에 속한 처리 중 제출이 아닙니다.');
    }
    return known;
  }
}

function displayResult<T>(result: CommandResult<T>): DisplayedCommandResult<T> {
  switch (result.kind) {
    case 'Committed':
      return {
        kind: 'committed',
        value: result.value,
        committedReceipt: result.receipt,
      };
    case 'Replayed':
      return {
        kind: 'replayed',
        value: result.value,
        priorReceipt: result.receipt,
        current: result.current,
      };
    case 'Rejected':
      return {
        kind: 'rejected',
        error: result.error,
        ...(result.priorReceipt === undefined ? {} : { priorReceipt: result.priorReceipt }),
      };
  }
}

function sameCommandContext(
  submission: CommandSubmission<unknown, unknown>,
  current: CurrentCommandContext,
): boolean {
  return (
    submission.actorId === current.actorId &&
    submission.target === current.target &&
    submission.command === current.command &&
    deepEqual(submission.scope, current.scope)
  );
}

function immutableSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] &&
      deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
