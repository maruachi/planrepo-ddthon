import fc from 'fast-check';
import type { ManifestEntry, ScopedManifest } from '../../../src/worktree-spike/contracts.js';

const pathSegmentArbitrary = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/u),
  fc.constantFrom('space name', '한글-문서', 'UPPER_case-01'),
);

export const managedRelativePathArbitrary = fc.oneof(
  fc.constantFrom('AGENTS.md', 'CLAUDE.md'),
  fc.array(pathSegmentArbitrary, { minLength: 0, maxLength: 3 })
    .chain((directories) => pathSegmentArbitrary.map((filename) => ['aidlc-docs', ...directories, `${filename}.md`].join('/'))),
);

export const sha256Arbitrary = fc
  .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 64, maxLength: 64 })
  .map((characters) => characters.join(''));

export const manifestEntryArbitrary: fc.Arbitrary<ManifestEntry> = fc.record({
  path: managedRelativePathArbitrary,
  hash: sha256Arbitrary,
});

export const scopedManifestArbitrary: fc.Arbitrary<ScopedManifest> = fc
  .uniqueArray(manifestEntryArbitrary, { minLength: 0, maxLength: 24, selector: (entry) => entry.path })
  .map((entries) => ({ entries }));

export const invalidManifestPathArbitrary = fc.oneof(
  fc.constantFrom(
    '../AGENTS.md',
    'aidlc-docs/../AGENTS.md',
    '/aidlc-docs/state.md',
    'aidlc-docs/.git/config.md',
    'aidlc-docs/not-markdown.txt',
    'nested/CLAUDE.md',
    'aidlc-docs\\state.md',
  ),
  pathSegmentArbitrary.map((segment) => `../${segment}.md`),
);
