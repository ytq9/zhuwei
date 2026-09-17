import { readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SUITES = Object.freeze({
  unit: ['unit'], structure: ['structure'], worker: ['worker'], http: ['http'], live: ['live'],
  // The Node ratchet retains HTTP tests from the former flat Node suite.
  node: ['unit', 'structure', 'http'],
  local: ['unit', 'structure', 'worker'],
  all: ['unit', 'structure', 'worker', 'http', 'live'],
});

function suiteOf(file) {
  if (/\.eval\.mts$/.test(file)) return 'live';
  if (/\.http\.test\.(mjs|mts)$/.test(file)) return 'http';
  if (/\.structure\.test\.mjs$/.test(file)) return 'structure';
  if (/\.room\.test\.ts$/.test(file)) return 'worker';
  if (/\.test\.mjs$/.test(file)) return 'unit';
  throw new Error(`Unknown test environment: ${file}. Use the suffixes documented in tests/README.md.`);
}

/** Discover without importing a test, its fixtures, credentials or a Provider. */
export function discoverTests(root = REPOSITORY_ROOT) {
  const entries = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!/\.(test|eval)\.(mjs|mts|ts)$/.test(entry.name)) continue;
      const file = relative(root, absolute).replaceAll('\\', '/');
      const [, area, feature] = file.split('/');
      if (!['kp', 'product', 'platform'].includes(area) || !feature || feature.includes('.')) {
        throw new Error(`Test outside a feature directory: ${file}`);
      }
      entries.push({ file, feature: `${area}/${feature}`, suite: suiteOf(file) });
    }
  }
  walk(resolve(root, 'tests'));
  return entries.sort((a, b) => a.file.localeCompare(b.file, 'en'));
}

export function selectTests(entries, { suite = 'local', feature, files = [] } = {}) {
  if (!Object.hasOwn(SUITES, suite)) throw new Error(`Unknown suite: ${suite}`);
  if (feature && !entries.some(entry => entry.feature === feature)) {
    throw new Error(`Unknown feature: ${feature}. Use --list --suite all to see available features.`);
  }
  for (const file of files) {
    if (!entries.some(entry => entry.file === file)) throw new Error(`Unknown test file: ${file}`);
  }
  const selected = entries.filter(entry => SUITES[suite].includes(entry.suite)
    && (suite !== 'node' || entry.file.endsWith('.mjs'))
    && (!feature || entry.feature === feature)
    && (!files.length || files.includes(entry.file)));
  if (!selected.length) throw new Error('No tests selected; an empty selection is not a pass.');
  for (const file of files) {
    if (!selected.some(entry => entry.file === file)) throw new Error(`Test excluded by suite or feature: ${file}`);
  }
  return selected;
}
