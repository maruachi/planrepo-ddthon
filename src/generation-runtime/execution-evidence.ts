import type { ExecutionTermination } from '@/src/contracts/views';
import type { ProviderCompletion, ProviderFailure } from '@/src/contracts/views';

export interface CompletionTimingEvidence {
  readonly completedAtMono: number;
  readonly deadlineMono: number;
}

export interface InternalExecutionEvidencePort {
  completion(input: ProviderCompletion): CompletionTimingEvidence | undefined;
  failure(input: ProviderFailure): boolean;
  termination(input: ExecutionTermination): boolean;
}

export interface MonotonicDeadlineClock {
  now(): number;
}
