import type { ClaimRef } from '@/src/contracts/context';
import type {
  ExecutionTermination,
  ProviderCompletion,
  ProviderFailure,
} from '@/src/contracts/views';
import type { ProviderOutcome } from '@/src/providers/generation/provider-contract';
import type { ProcessObservationState, ProcessObserver } from '@/src/runtime/process-evidence';
import type {
  CompletionTimingEvidence,
  InternalExecutionEvidencePort,
} from './execution-evidence';

export type ProviderOutcomeEvidence =
  | { readonly kind: 'completion'; readonly completedAtMono: number; readonly deadlineMono: number }
  | { readonly kind: 'failure' };

export interface ProviderOutcomeEvidenceSink {
  record(outcome: ProviderOutcome, evidence: ProviderOutcomeEvidence): void;
}

interface LaunchBinding {
  readonly claimRef: ClaimRef;
  confirmed?: Extract<ProcessObservationState, { kind: 'Confirmed' }>;
  wake?: () => void;
}

export class ExecutionEvidenceRegistry implements InternalExecutionEvidencePort {
  private readonly outcomes = new WeakMap<ProviderOutcome, ProviderOutcomeEvidence>();
  private readonly completions = new WeakMap<ProviderCompletion, CompletionTimingEvidence>();
  private readonly failures = new WeakSet<ProviderFailure>();
  private readonly terminations = new WeakSet<ExecutionTermination>();
  private readonly launches = new Map<string, LaunchBinding>();

  readonly sink: ProviderOutcomeEvidenceSink = Object.freeze({
    record: (outcome: ProviderOutcome, evidence: ProviderOutcomeEvidence) => {
      if (this.outcomes.has(outcome)) throw new Error('provider outcome 증거가 중복 등록됐습니다.');
      this.outcomes.set(outcome, Object.freeze({ ...evidence }));
    },
  });

  readonly observer: ProcessObserver = (state) => {
    const binding = this.launches.get(state.launchRef);
    if (binding !== undefined && state.kind === 'Confirmed') {
      binding.confirmed = state;
      binding.wake?.();
      delete binding.wake;
    }
  };

  bindLaunch(launchRef: string, claimRef: ClaimRef): void {
    if (this.launches.has(launchRef)) throw new Error('launch evidence binding이 중복됐습니다.');
    this.launches.set(launchRef, { claimRef });
  }

  bindCompletion(outcome: ProviderOutcome, input: ProviderCompletion): void {
    const evidence = this.outcomes.get(outcome);
    if (outcome.kind !== 'completed' || evidence?.kind !== 'completion') {
      throw new Error('검증되지 않은 provider 완료 결과입니다.');
    }
    this.completions.set(input, {
      completedAtMono: evidence.completedAtMono,
      deadlineMono: evidence.deadlineMono,
    });
  }

  bindFailure(outcome: ProviderOutcome, input: ProviderFailure): void {
    const evidence = this.outcomes.get(outcome);
    if (outcome.kind !== 'failed' || evidence?.kind !== 'failure') {
      throw new Error('검증되지 않은 provider 실패 결과입니다.');
    }
    this.failures.add(input);
  }

  bindDeadlineFailure(outcome: ProviderOutcome, input: ProviderFailure): void {
    if (outcome.kind !== 'completed' || this.outcomes.get(outcome)?.kind !== 'completion') {
      throw new Error('deadline 실패의 실행 증거가 없습니다.');
    }
    this.failures.add(input);
  }

  confirmedTermination(launchRef: string, observedAt: string): ExecutionTermination | undefined {
    const binding = this.launches.get(launchRef);
    if (binding?.confirmed === undefined) return undefined;
    const input: ExecutionTermination = Object.freeze({
      claimRef: binding.claimRef,
      observedAt,
      result: binding.confirmed.result,
      diagnostic: 'trusted process observer',
    });
    this.terminations.add(input);
    return input;
  }

  confirmTerminationStored(launchRef: string): void {
    this.launches.delete(launchRef);
  }

  async waitForConfirmedTermination(
    launchRef: string,
    observedAt: () => string,
    signal: AbortSignal,
  ): Promise<ExecutionTermination | undefined> {
    const immediate = this.confirmedTermination(launchRef, observedAt());
    if (immediate !== undefined) return immediate;
    const binding = this.launches.get(launchRef);
    if (binding === undefined || signal.aborted) return undefined;
    await new Promise<void>((resolve) => {
      const finish = () => {
        signal.removeEventListener('abort', finish);
        resolve();
      };
      binding.wake = finish;
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
    const confirmed = this.confirmedTermination(launchRef, observedAt());
    if (confirmed !== undefined) return confirmed;
    if (signal.aborted) this.releaseUnknownLaunch(launchRef);
    return undefined;
  }

  releaseUnknownLaunch(launchRef: string): void {
    this.launches.delete(launchRef);
  }

  completion(input: ProviderCompletion): CompletionTimingEvidence | undefined {
    return this.completions.get(input);
  }

  failure(input: ProviderFailure): boolean {
    return this.failures.has(input);
  }

  termination(input: ExecutionTermination): boolean {
    return this.terminations.has(input);
  }
}
