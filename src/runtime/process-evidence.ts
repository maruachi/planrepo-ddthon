export type ProcessObservationState =
  | {
      readonly kind: 'Pending';
      readonly launchRef: string;
    }
  | {
      readonly kind: 'Running';
      readonly launchRef: string;
      readonly pid: number;
    }
  | {
      readonly kind: 'Confirmed';
      readonly launchRef: string;
      readonly result:
        | { readonly kind: 'no_process_created'; readonly evidence: string }
        | {
            readonly kind: 'restricted_scope_exited';
            readonly scopePolicyRef: string;
            readonly exitCode: number | null;
            readonly signal?: NodeJS.Signals;
          };
    }
  | {
      readonly kind: 'Unknown';
      readonly launchRef: string;
      readonly reason:
        | 'spawn_crash_gap'
        | 'spawn_error_not_proven'
        | 'execution_scope_not_proven'
        | 'signal_denied'
        | 'signal_result_unknown';
      readonly directProcess?: {
        readonly pid: number;
        readonly exitCode: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stdoutClosed: boolean;
        readonly stderrClosed: boolean;
        readonly childClosed: boolean;
      };
    };

export type ProcessObserver = (state: ProcessObservationState) => void;

export function noProcessCreated(launchRef: string, evidence: string): ProcessObservationState {
  return Object.freeze({
    kind: 'Confirmed',
    launchRef,
    result: Object.freeze({ kind: 'no_process_created', evidence }),
  });
}

export function unknownProcess(
  launchRef: string,
  reason: Extract<ProcessObservationState, { kind: 'Unknown' }>['reason'],
  directProcess?: Extract<ProcessObservationState, { kind: 'Unknown' }>['directProcess'],
): ProcessObservationState {
  return Object.freeze({
    kind: 'Unknown',
    launchRef,
    reason,
    ...(directProcess === undefined ? {} : { directProcess: Object.freeze(directProcess) }),
  });
}
