import { resolve } from 'node:path';
import { build as buildServer } from 'esbuild';
import { build as buildWeb } from 'vite';

const projectRoot = resolve(import.meta.dirname, '..');

await buildServer({
  entryPoints: [resolve(projectRoot, 'src/main.ts')],
  outfile: resolve(projectRoot, 'dist/server/main.js'),
  platform: 'node',
  format: 'esm',
  target: 'node22',
  bundle: true,
  packages: 'external',
  alias: { '@': projectRoot },
  sourcemap: true,
});

await buildWeb({
  configFile: resolve(projectRoot, 'vite.config.ts'),
});
