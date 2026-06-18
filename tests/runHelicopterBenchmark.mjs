import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const outfile = join(tmpdir(), `city-grid-helicopter-benchmark-${Date.now()}.mjs`);
await build({
  entryPoints: ['tests/helicopterBenchmark.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
});
await import(pathToFileURL(outfile).href);
