import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface OwnedRunDirectory {
  readonly path: string;
  removeAfterConfirmedTermination(): Promise<void>;
}

export async function createOwnedRunDirectory(
  runsRoot: string,
  launchIntentId: string,
): Promise<OwnedRunDirectory> {
  if (!/^launch-[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(launchIntentId)) {
    throw new Error('launch intent ID가 run directory 계약과 다릅니다.');
  }
  const path = resolve(runsRoot, launchIntentId);
  if (dirname(path) !== resolve(runsRoot)) throw new Error('run directory가 허용 경계를 벗어났습니다.');
  await mkdir(path, { recursive: false, mode: 0o700 });
  let removed = false;
  return Object.freeze({
    path,
    async removeAfterConfirmedTermination() {
      if (removed) return;
      await rm(path, { recursive: true });
      removed = true;
    },
  });
}
