import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const outfile = join(tmpdir(), `city-grid-simulation-4x-benchmark-${Date.now()}.mjs`);
await build({
  entryPoints: ['tests/simulation4xBenchmark.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
});
await import(pathToFileURL(outfile).href);
