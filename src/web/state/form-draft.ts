import type { TargetScope } from '@/src/contracts/context';

export interface FormDraftIdentity {
  readonly actorId: string;
  readonly scope: TargetScope;
  readonly target: string;
  readonly form: string;
}

export interface FormDraftSnapshot<I, B> {
  readonly identity: FormDraftIdentity;
  readonly input: I;
  readonly basis: B;
  readonly dirty: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly latestServer?: {
    readonly input: I;
    readonly basis: B;
  };
}

export class FormDraft<I, B> {
  private readonly identity: FormDraftIdentity;
  private input: I;
  private basis: B;
  private dirty = false;
  private fieldErrors: Readonly<Record<string, string>> = Object.freeze({});
  private latestServer: { readonly input: I; readonly basis: B } | undefined;

  constructor(identity: FormDraftIdentity, input: I, basis: B) {
    this.identity = immutableSnapshot(identity);
    this.input = immutableSnapshot(input);
    this.basis = immutableSnapshot(basis);
  }

  edit(input: I): void {
    this.input = immutableSnapshot(input);
    this.dirty = true;
  }

  setFieldErrors(errors: Readonly<Record<string, string>>): void {
    this.fieldErrors = immutableSnapshot(errors);
  }

  refreshFromServer(input: I, basis: B): boolean {
    if (this.dirty) {
      this.latestServer = immutableSnapshot({ input, basis });
      return false;
    }
    this.reset(input, basis);
    return true;
  }

  adoptLatestBasis(identity: FormDraftIdentity): boolean {
    if (!sameIdentity(this.identity, identity) || this.latestServer === undefined) return false;
    this.basis = this.latestServer.basis;
    this.latestServer = undefined;
    this.fieldErrors = Object.freeze({});
    return true;
  }

  discardToLatest(identity: FormDraftIdentity): boolean {
    if (!sameIdentity(this.identity, identity) || this.latestServer === undefined) return false;
    const latest = this.latestServer;
    this.reset(latest.input, latest.basis);
    return true;
  }

  discard(input: I, basis: B): void {
    this.reset(input, basis);
  }

  markSaved(input: I, basis: B): void {
    this.reset(input, basis);
  }

  snapshot(): FormDraftSnapshot<I, B> {
    return Object.freeze({
      identity: this.identity,
      input: this.input,
      basis: this.basis,
      dirty: this.dirty,
      fieldErrors: this.fieldErrors,
      ...(this.latestServer === undefined ? {} : { latestServer: this.latestServer }),
    });
  }

  private reset(input: I, basis: B): void {
    this.input = immutableSnapshot(input);
    this.basis = immutableSnapshot(basis);
    this.dirty = false;
    this.fieldErrors = Object.freeze({});
    this.latestServer = undefined;
  }
}

function sameIdentity(left: FormDraftIdentity, right: FormDraftIdentity): boolean {
  return left.actorId === right.actorId
    && left.target === right.target
    && left.form === right.form
    && left.scope.kind === right.scope.kind
    && left.scope.projectId === right.scope.projectId
    && ('srId' in left.scope ? left.scope.srId : undefined)
      === ('srId' in right.scope ? right.scope.srId : undefined);
}

function immutableSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
