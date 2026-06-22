import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const outfile = join(tmpdir(), `city-grid-simulation-timing-tests-${Date.now()}.mjs`);
await build({
  entryPoints: ['tests/simulationTiming.test.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
});
await import(pathToFileURL(outfile).href);
