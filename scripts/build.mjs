import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';

await mkdir('dist/web', { recursive: true });
await cp('public', 'dist/web', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/client.ts'], outfile: 'dist/web/app.js', bundle: true, minify: true, format: 'esm', target: 'es2022' }),
  build({ entryPoints: ['src/alexa.ts'], outfile: 'dist/lambda/index.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22' }),
]);
