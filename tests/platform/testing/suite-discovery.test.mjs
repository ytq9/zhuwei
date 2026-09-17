import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { discoverTests, selectTests, REPOSITORY_ROOT } from '../../config/suites.mjs';
import { executionPlan, parseOptions } from '../../run.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'zhuwei-suite-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    // Discovery must not evaluate even a module that would throw immediately.
    writeFileSync(join(root, file), 'throw new Error("must not import during discovery");');
  }
  return root;
}

test('nested feature discovery retains every environment without importing live or fixture modules', t => {
  const root = fixture(t, [
    'tests/kp/npc/generation.test.mjs', 'tests/kp/npc/plans.room.test.ts',
    'tests/kp/narration/continuity/deferred.test.mjs', 'tests/kp/stories/creation.eval.mts',
    'tests/product/history/export.http.test.mts', 'tests/product/identity/session.http.test.mjs',
    'tests/platform/architecture/layout.structure.test.mjs', 'tests/support/fixture.mjs',
  ]);
  const entries = discoverTests(root);
  assert.equal(entries.length, 7);
  assert.deepEqual(selectTests(entries).map(entry => entry.suite).sort(), ['structure', 'unit', 'unit', 'worker']);
  assert.equal(selectTests(entries, { suite: 'http' }).length, 2);
  assert.deepEqual(selectTests(entries, { suite: 'node' }).map(entry => entry.suite).sort(), ['http', 'structure', 'unit', 'unit']);
  assert.deepEqual(selectTests(entries, { feature: 'kp/npc' }).map(entry => entry.suite).sort(), ['unit', 'worker']);
});

test('unknown features, environments and excluded exact files fail instead of reporting an empty pass', t => {
  const entries = discoverTests(fixture(t, ['tests/kp/npc/generation.test.mjs']));
  for (const options of [{ feature: 'kp/npcs' }, { suite: 'missing' }, { suite: 'worker' },
    { files: ['tests/kp/npc/missing.test.mjs'] }, { suite: 'worker', files: [entries[0].file] }]) {
    assert.throws(() => selectTests(entries, options));
  }
  assert.throws(() => discoverTests(fixture(t, ['tests/kp/npc/forgot-environment.test.ts'])), /Unknown test environment/);
  assert.throws(() => discoverTests(fixture(t, ['tests/accidental.test.mjs'])), /outside a feature/);
});

test('isolated HTTP and Worker selections use their respective native runners', t => {
  const entries = discoverTests(fixture(t, ['tests/kp/npc/plans.room.test.ts', 'tests/product/history/export.http.test.mts']));
  const plan = executionPlan(selectTests(entries, { suite: 'all' }), { name: 'retry' });
  assert.deepEqual(plan.map(run => run.environment), ['worker', 'http']);
  assert.ok(plan[0].args.includes('tests/config/worker.config.ts'));
  assert.ok(plan[1].args.includes('tests/config/history-http.config.mjs'));
  assert.ok(plan.every(run => run.args.includes('retry')));
});

test('live evaluation is discoverable but cannot be dispatched by ordinary test execution', t => {
  const selected = selectTests(discoverTests(fixture(t, ['tests/kp/stories/creation.eval.mts'])), { suite: 'live' });
  assert.equal(selected.length, 1);
  assert.throws(() => executionPlan(selected), /explicit test:eval/);
  const cli = spawnSync(process.execPath, ['tests/run.mjs', '--suite', 'live'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /explicit test:eval/);
});

test('CLI rejects ambiguous options before any test execution', () => {
  for (const args of [['--suite'], ['--suite', 'unit', '--suite', 'worker'], ['--json'], ['--unknown']]) {
    assert.throws(() => parseOptions(args));
  }
});

test('CLI executes only the selected file and propagates an actual assertion failure', t => {
  const directory = mkdtempSync(join(REPOSITORY_ROOT, 'tests/platform/testing/runner-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const selected = join(directory, 'selected.test.mjs');
  const excluded = join(directory, 'excluded.test.mjs');
  writeFileSync(excluded, 'throw new Error("unselected sentinel");');
  const invoke = () => spawnSync(process.execPath, ['tests/run.mjs', '--suite', 'unit', '--file', relative(REPOSITORY_ROOT, selected)],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
  writeFileSync(selected, 'import test from "node:test"; test("selected pass", () => {});');
  const pass = invoke();
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.doesNotMatch(pass.stdout + pass.stderr, /unselected sentinel/);
  writeFileSync(selected, 'import test from "node:test"; import assert from "node:assert/strict"; test("selected failure", () => assert.fail("expected sentinel"));');
  const fail = invoke();
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /expected sentinel/);
  assert.doesNotMatch(fail.stdout + fail.stderr, /unselected sentinel/);
});
