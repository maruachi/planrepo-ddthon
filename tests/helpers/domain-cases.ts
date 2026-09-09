import manifest from '@/config/demo/manifest.json' with { type: 'json' };
import type { BundleRef, GateKind } from '@/src/contracts/context';
import type { SRView } from '@/src/contracts/views';
import type { DatabaseConnection } from '@/src/persistence/database';
import { readSrView } from '@/src/persistence/sr-repository';
import { readDemoManifest } from '@/tests/helpers/demo-manifest';

export type DemoSrKey = keyof typeof manifest.srIds;

export interface DemoCase {
  readonly key: DemoSrKey;
  readonly projectId: string;
  readonly srId: string;
  readonly ownerId: string;
  readonly personaIds: typeof manifest.personaIds;
  readonly entityIds: Readonly<Record<string, string>>;
}

export interface CurrentCase extends DemoCase {
  readonly sr: SRView;
}

export interface CurrentReviewInput {
  readonly projectId: string;
  readonly srId: string;
  readonly gate: GateKind;
  readonly reviewEpoch: number;
  readonly expectedSrRevision: number;
  readonly currentBundleRef?: BundleRef;
}

export function demoCase(key: DemoSrKey): DemoCase {
  return {
    key,
    projectId: manifest.projectId,
    srId: manifest.srIds[key],
    ownerId: manifest.defaultActorId,
    personaIds: manifest.personaIds,
    entityIds: manifest.entityIds[key],
  };
}

export function currentCase(db: DatabaseConnection, key: DemoSrKey): CurrentCase {
  const storedManifest = readDemoManifest(db);
  const base = demoCase(key);
  if (
    storedManifest.projectId !== base.projectId ||
    storedManifest.srIds[key] !== base.srId
  ) throw new Error(`${key} manifest와 현재 DB가 다릅니다.`);
  const sr = readSrView(db, base.projectId, base.srId);
  if (sr === undefined) throw new Error(`${key} SR을 찾을 수 없습니다.`);
  return { ...base, ownerId: sr.ownerId, sr };
}

export function currentReviewInput(
  db: DatabaseConnection,
  key: DemoSrKey,
  gate: GateKind,
): CurrentReviewInput {
  const current = currentCase(db, key);
  const gateState = current.sr.gates.find((item) => item.gate === gate);
  if (gateState === undefined) throw new Error(`${key} ${gate} 현재 상태를 찾을 수 없습니다.`);
  return {
    projectId: current.projectId,
    srId: current.srId,
    gate,
    reviewEpoch: gateState.reviewEpoch,
    expectedSrRevision: current.sr.revision,
    ...(gateState.currentBundleRef === undefined
      ? {}
      : { currentBundleRef: gateState.currentBundleRef }),
  };
}
