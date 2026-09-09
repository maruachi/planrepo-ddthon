import type { PublicMethodId } from '@/src/contracts/methods';

export interface QueryKey {
  readonly actorId: string;
  readonly projectId: string;
  readonly srId?: string;
  readonly target: string;
  readonly methodId: PublicMethodId;
}

export interface QueryTicket {
  readonly key: QueryKey;
  readonly seq: number;
}

export type QueryAcceptance<T> =
  | { readonly accepted: true; readonly value: T }
  | { readonly accepted: false };

export class QueryCoordinator {
  private readonly latestByKey = new Map<string, number>();
  private active: { readonly identity: string; readonly seq: number } | undefined;

  issue(key: QueryKey): QueryTicket {
    const snapshot = Object.freeze({ ...key });
    const identity = queryIdentity(snapshot);
    const seq = (this.latestByKey.get(identity) ?? 0) + 1;
    this.latestByKey.set(identity, seq);
    this.active = { identity, seq };
    return Object.freeze({ key: snapshot, seq });
  }

  accept<T>(key: QueryKey, seq: number, value: T): QueryAcceptance<T> {
    const identity = queryIdentity(key);
    if (
      this.active?.identity !== identity ||
      this.active.seq !== seq ||
      this.latestByKey.get(identity) !== seq
    ) {
      return { accepted: false };
    }
    return { accepted: true, value };
  }
}

function queryIdentity(key: QueryKey): string {
  return JSON.stringify([
    key.actorId,
    key.projectId,
    key.srId ?? null,
    key.target,
    key.methodId,
  ]);
}
