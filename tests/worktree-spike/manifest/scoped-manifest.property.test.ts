import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  deserializeScopedManifest,
  isManagedManifestPath,
  serializeScopedManifest,
} from '../../../src/worktree-spike/manifest/scoped-manifest.js';
import {
  invalidManifestPathArbitrary,
  managedRelativePathArbitrary,
  scopedManifestArbitrary,
} from './generators.js';

const PBT_SEED = 424242;
const PBT_PARAMETERS = { seed: PBT_SEED, numRuns: 150 } as const;
const byPath = <T extends { path: string }>(left: T, right: T): number => left.path.localeCompare(right.path, 'en');

beforeAll(() => {
  console.info(`[PBT] scoped-manifest seed=${PBT_SEED}; shrinking=enabled`);
});

describe('scoped manifest properties', () => {
  it('round-trips every valid manifest through its canonical serialized form', () => {
    fc.assert(fc.property(scopedManifestArbitrary, (manifest) => {
      const canonical = { entries: [...manifest.entries].sort(byPath) };
      expect(deserializeScopedManifest(serializeScopedManifest(manifest))).toEqual(canonical);
    }), PBT_PARAMETERS);
  });

  it('serializes deterministically regardless of input entry order', () => {
    fc.assert(fc.property(scopedManifestArbitrary, (manifest) => {
      const reversed = { entries: [...manifest.entries].reverse() };
      expect(serializeScopedManifest(reversed)).toBe(serializeScopedManifest(manifest));
      const paths = deserializeScopedManifest(serializeScopedManifest(manifest)).entries.map((entry) => entry.path);
      expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right, 'en')));
    }), PBT_PARAMETERS);
  });

  it('keeps generated paths worktree-relative and rejects escaping or out-of-scope paths', () => {
    fc.assert(fc.property(managedRelativePathArbitrary, (path) => {
      expect(isManagedManifestPath(path)).toBe(true);
      expect(path.startsWith('/')).toBe(false);
      expect(path.split('/')).not.toContain('..');
    }), PBT_PARAMETERS);

    fc.assert(fc.property(invalidManifestPathArbitrary, (path) => {
      expect(isManagedManifestPath(path)).toBe(false);
      expect(() => deserializeScopedManifest(JSON.stringify({ entries: [{ path, hash: 'a'.repeat(64) }] }))).toThrow();
    }), PBT_PARAMETERS);
  });
});
