import type { InputSnapshot, ProviderFailureCore } from '../../contracts/views';
import type {
  DocumentKind,
  ExecutionPolicy,
  ExecutionReport,
  GenerationResult,
  GenerationTaskKind,
  ProviderSelection,
} from '../../contracts/views';

export interface ProviderRequest {
  readonly schemaVersion: 1;
  readonly taskKind: GenerationTaskKind;
  readonly documentKind?: DocumentKind;
  readonly snapshot: InputSnapshot;
  readonly selection: ProviderSelection;
}

export interface ExecutionControl {
  readonly signal: AbortSignal;
  readonly policy: ExecutionPolicy;
  readonly execution: {
    readonly launchRef: string;
    readonly cwd: string;
  };
}

export type ProviderOutcome =
  | {
      readonly kind: 'completed';
      readonly result: GenerationResult;
      readonly execution: ExecutionReport;
    }
  | {
      readonly kind: 'failed';
      readonly failure: ProviderFailureCore;
      readonly execution: ExecutionReport;
    };

export interface GenerationProvider {
  generate(request: ProviderRequest, control: ExecutionControl): Promise<ProviderOutcome>;
}
