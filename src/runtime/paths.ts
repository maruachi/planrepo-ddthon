import { lstatSync, realpathSync } from 'node:fs';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';

const OUTSIDE_PROJECT_ERROR = '프로젝트 내부 경로만 사용할 수 있습니다.';

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

export function resolveProjectPath(root: string, configuredPath: string): string {
  const segments = configuredPath.split(/[\\/]/u);
  if (segments.includes('..') || configuredPath.includes('\0')) {
    throw new Error(OUTSIDE_PROJECT_ERROR);
  }

  if (
    configuredPath.length === 0 ||
    isAbsolute(configuredPath) ||
    win32.isAbsolute(configuredPath)
  ) {
    throw new Error(OUTSIDE_PROJECT_ERROR);
  }

  const realRoot = realpathSync(root);
  const lexicalTarget = resolve(realRoot, configuredPath);
  let ancestor = lexicalTarget;

  for (;;) {
    try {
      lstatSync(ancestor);
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }

      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error(OUTSIDE_PROJECT_ERROR);
      ancestor = parent;
    }
  }

  const realAncestor = realpathSync(ancestor);
  if (!isInside(realRoot, realAncestor)) {
    throw new Error(OUTSIDE_PROJECT_ERROR);
  }

  const resolvedTarget = resolve(realAncestor, relative(ancestor, lexicalTarget));
  if (!isInside(realRoot, resolvedTarget)) {
    throw new Error(OUTSIDE_PROJECT_ERROR);
  }

  return resolvedTarget;
}
