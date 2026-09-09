import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RootFixture {
  root: string;
  remove(): void;
}

export function createRootFixture(): RootFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planrepo-root-')));
  let removed = false;

  return {
    root,
    remove() {
      if (removed) return;
      rmSync(root, { recursive: true, force: true });
      removed = true;
    },
  };
}
