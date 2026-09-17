#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, discoverTests, selectTests } from './config/suites.mjs';

const HELP = `Usage: npm run test:function -- --feature kp/npc --suite unit
  --suite unit|structure|worker|http|node|local|all|live (default: local)
  --feature kp/npc      Exact feature directory; use --list --suite all to discover
  --file tests/...      Exact test path; repeat to select several files
  --name pattern       Native test-name filter
  --list [--json]       Inspect selection without importing tests or calling models
  --help               Show this help

local = unit + structure + Worker; HTTP requires its separate entry.
Live evaluations only run through npm run test:eval with explicit probe options.
This command never builds, deploys or provisions remote resources.`;

export function parseOptions(args) {
  const options = { suite: 'local', files: [] };
  const values = { '--suite': 'suite', '--feature': 'feature', '--name': 'name', '--file': 'files' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--help', '--list', '--json'].includes(arg)) options[arg.slice(2)] = true;
    else if (Object.hasOwn(values, arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg !== '--file' && seen.has(arg)) throw new Error(`Repeated option: ${arg}`);
      if (arg === '--file') options.files.push(relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, value)).replaceAll('\\', '/'));
      else options[values[arg]] = value;
      seen.add(arg);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.json && !options.list) throw new Error('--json requires --list');
  return options;
}

export function executionPlan(selected, { name } = {}) {
  if (selected.some(entry => entry.suite === 'live')) {
    throw new Error('Live model evaluations require the explicit test:eval probe entry; ordinary test selection cannot run them.');
  }
  const plan = [];
  const nodeFiles = selected.filter(entry => entry.file.endsWith('.mjs')).map(entry => entry.file);
  if (nodeFiles.length) plan.push({ environment: 'node', files: nodeFiles,
    args: ['--import', 'tsx', '--test', '--test-reporter=spec', ...(name ? ['--test-name-pattern', name] : []), ...nodeFiles] });
  for (const [suite, config] of [['worker', 'worker.config.ts'], ['http', 'history-http.config.mjs']]) {
    const files = selected.filter(entry => entry.suite === suite && !entry.file.endsWith('.mjs')).map(entry => entry.file);
    if (files.length) plan.push({ environment: suite, files,
      args: ['node_modules/vitest/vitest.mjs', 'run', '--config', `tests/config/${config}`,
        ...files, ...(name ? ['--testNamePattern', name] : [])] });
  }
  return plan;
}

export function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return 0; }
  const selected = selectTests(discoverTests(), options);
  if (options.list) {
    if (options.json) console.log(JSON.stringify(selected, null, 2));
    else {
      for (const entry of selected) console.log(`${entry.suite.padEnd(10)} ${entry.file}`);
      console.log(`\n${selected.length} files selected; no tests executed.`);
    }
    return 0;
  }
  const plan = executionPlan(selected, options);
  if (selected.some(entry => entry.suite === 'http' && entry.file.endsWith('.mjs'))
    && ['dist/server/index.js', 'dist/server/wrangler.json'].some(file => !existsSync(resolve(REPOSITORY_ROOT, file)))) {
    throw new Error('HTTP tests require the current production build in dist/server. Run the build explicitly in the applicable validation stage, then test:http.');
  }
  let exitCode = 0;
  const environment = { ...process.env };
  // A CLI invoked from a runner test must start a new test process, not inherit
  // Node's child-test marker (which silently skips all selected files).
  delete environment.NODE_TEST_CONTEXT;
  for (const run of plan) {
    console.log(`\n[${run.environment}] ${run.files.length} test files`);
    const child = spawnSync(process.execPath, run.args, { cwd: REPOSITORY_ROOT, stdio: 'inherit', env: environment });
    if (child.error) throw child.error;
    if (child.signal) return 1;
    if (child.status !== 0) exitCode = child.status ?? 1;
  }
  return exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
