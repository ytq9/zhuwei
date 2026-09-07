import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMISE_DUE_TIERS, isPromiseDueTier, promiseDueDurationMicros } from '../app/_runtime/lib/rules/v2/promise-due.ts';
import { FICTION_DAWN_OFFSET_MICROS, FICTION_DAY_MICROS } from '../app/_runtime/lib/rules/profiles/fiction-time.ts';

const state = (nowMicros, origin) => ({ fictionTimelines: { 'branch:main': { branchId: 'branch:main', nowMicros } },
  campaignRuntime: { campaign: origin === undefined ? null : { fictionClock: { originTimeOfDayMicros: origin } } } });

test('the five due tiers are the whole vocabulary and the fixed ones map to their durations', () => {
  assert.deepEqual([...PROMISE_DUE_TIERS], ['none', '1h', 'halfDay', 'day', 'nextDawn']);
  assert.ok(isPromiseDueTier('nextDawn')); assert.ok(!isPromiseDueTier('tomorrow'));
  assert.equal(promiseDueDurationMicros(state('0'), 'branch:main', 'none'), undefined);
  assert.equal(promiseDueDurationMicros(state('123'), 'branch:main', '1h'), '3600000000');
  assert.equal(promiseDueDurationMicros(state('123'), 'branch:main', 'halfDay'), '43200000000');
  assert.equal(promiseDueDurationMicros(state('123'), 'branch:main', 'day'), '86400000000');
});

test('nextDawn is the next dawn on the fictional clock, tomorrow when it is dawn already, and follows the campaign clock origin', () => {
  const dawn = FICTION_DAWN_OFFSET_MICROS, day = FICTION_DAY_MICROS;
  // Midnight origin by default: from 0, dawn is six hours away.
  assert.equal(promiseDueDurationMicros(state('0'), 'branch:main', 'nextDawn'), dawn.toString());
  // One hour after dawn, the next dawn is 23 hours away.
  assert.equal(promiseDueDurationMicros(state((dawn + 3_600_000_000n).toString()), 'branch:main', 'nextDawn'), (day - 3_600_000_000n).toString());
  // Exactly at dawn, the next dawn is a full day away.
  assert.equal(promiseDueDurationMicros(state(dawn.toString()), 'branch:main', 'nextDawn'), day.toString());
  // A campaign that opens at 20:00 reaches dawn ten hours later.
  assert.equal(promiseDueDurationMicros(state('0', '72000000000'), 'branch:main', 'nextDawn'), '36000000000');
  assert.equal(promiseDueDurationMicros(state('0'), 'branch:missing', 'nextDawn'), undefined);
});
