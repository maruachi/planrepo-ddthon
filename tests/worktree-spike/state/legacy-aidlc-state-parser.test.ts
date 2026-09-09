import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyAidlcStateParser } from '../../../src/worktree-spike/state/legacy-aidlc-state-parser.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LegacyAidlcStateParser', () => {
  it('reads the current stage and first incomplete checkbox in document order', async () => {
    const root = await temporaryRoot('planrepo-state-');
    await mkdir(join(root, 'aidlc-docs'), { recursive: true });
    await writeFile(join(root, 'aidlc-docs', 'aidlc-state.md'), [
      '# AI-DLC State Tracking',
      '- **Current Phase**: CONSTRUCTION',
      '- **Current Stage**: Code Generation Part 2',
      '',
      '- [x] Contract freeze',
      '- [ ] Implement parser',
      '- [ ] Integrate service',
    ].join('\n'));

    await expect(new LegacyAidlcStateParser().parse(root)).resolves.toMatchObject({
      currentStage: 'Code Generation Part 2',
      firstIncomplete: 'Implement parser',
      status: 'parsed',
    });
  });

  it('reports a missing state file without treating it as malformed', async () => {
    const root = await temporaryRoot('planrepo-state-missing-');
    const result = await new LegacyAidlcStateParser().parse(root);
    expect(result).toEqual({ statePath: join(root, 'aidlc-docs', 'aidlc-state.md'), status: 'missing' });
  });

  it('returns a parsed result with optional fields absent for incomplete legacy Markdown', async () => {
    const root = await temporaryRoot('planrepo-state-malformed-');
    await mkdir(join(root, 'aidlc-docs'), { recursive: true });
    await writeFile(join(root, 'aidlc-docs', 'aidlc-state.md'), '# Legacy state\n- [x] Everything represented here is complete\n');
    await expect(new LegacyAidlcStateParser().parse(root)).resolves.toEqual({
      statePath: join(root, 'aidlc-docs', 'aidlc-state.md'),
      status: 'parsed',
    });
  });

  it('does not follow a symbolic-link state file', async () => {
    const root = await temporaryRoot('planrepo-state-link-');
    const outside = await temporaryRoot('planrepo-state-outside-');
    await mkdir(join(root, 'aidlc-docs'), { recursive: true });
    await writeFile(join(outside, 'state.md'), '- **Current Stage**: Outside\n- [ ] Do not read\n');
    await symlink(join(outside, 'state.md'), join(root, 'aidlc-docs', 'aidlc-state.md'));
    await expect(new LegacyAidlcStateParser().parse(root)).rejects.toThrow('must not be a symbolic link');
  });
});
