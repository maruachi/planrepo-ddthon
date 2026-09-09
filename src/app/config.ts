import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export interface AppConfig { appRoot: string; dbPath: string; port: number; host: '127.0.0.1'; dev: boolean; workerPath: string; claudePath?: string; rulesPath?: string; repositoryPath?: string; workspaceRoot: string }
export function findAppRoot(modulePath = fileURLToPath(import.meta.url)): string {
  let dir = dirname(modulePath);
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) { try { if (JSON.parse(readFileSync(file, 'utf8')).name === 'planrepo') return dir; } catch { /* Keep looking for the named application root. */ } }
    const parent = dirname(dir); if (parent === dir) throw new Error('PlanRepo application root not found'); dir = parent;
  }
}
export function loadConfig(env: Record<string, string | undefined> = process.env, modulePath = fileURLToPath(import.meta.url)): AppConfig {
  const appRoot = findAppRoot(modulePath); const rawPort = env.PLANREPO_PORT ?? '4310';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('PLANREPO_PORT must be an integer from 1 to 65535');
  const dbSetting = env.PLANREPO_DB_PATH ?? '.planrepo/planrepo.sqlite'; if (!dbSetting.trim() || dbSetting.includes('\0')) throw new Error('PLANREPO_DB_PATH is invalid');
  const dev = modulePath.endsWith('.ts');
  const claudePath = env.PLANREPO_CLAUDE_PATH ?? 'claude'; const rulesPath = resolve(appRoot, env.PLANREPO_RULES_PATH ?? '.aidlc-rule-details');
  const repositorySetting = env.PLANREPO_REPOSITORY_PATH; const workspaceSetting = env.PLANREPO_WORKSPACE_ROOT ?? '.planrepo/worktrees';
  if (!claudePath.trim() || claudePath.includes('\0') || rulesPath.includes('\0') || repositorySetting?.includes('\0') || !workspaceSetting.trim() || workspaceSetting.includes('\0')) throw new Error('Invalid planning configuration');
  const repositoryPath = repositorySetting?.trim() ? (isAbsolute(repositorySetting) ? repositorySetting : resolve(appRoot, repositorySetting)) : undefined;
  const workspaceRoot = isAbsolute(workspaceSetting) ? workspaceSetting : resolve(appRoot, workspaceSetting);
  return { appRoot, host: '127.0.0.1', port: Number(rawPort), dev, claudePath: claudePath.includes('/') && !isAbsolute(claudePath) ? resolve(appRoot, claudePath) : claudePath, rulesPath, repositoryPath, workspaceRoot, dbPath: isAbsolute(dbSetting) ? dbSetting : resolve(appRoot, dbSetting), workerPath: join(appRoot, dev ? '.dev' : 'dist', 'server/sr-document-foundation/compare/diff-worker.js') };
}
