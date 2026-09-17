// Behavior assertions grouped by function; see README.md in this directory.
/**
 * Gate for SPEC 0016 §8.3: continuity review reports contradicting facts
 * instead of building a per-fragment evidence matrix.
 *
 * A passing review carries no per-fragment or per-fact proof; completeness is
 * checked once per committed mechanical group; a zero-mechanical review omits
 * resultChecks entirely, which is also the shape the real provider accepts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NARRATION_REVIEW_SCHEMA } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { transfer, reviewFor, binding, response } from '../../support/fixtures/narration.mjs';
import { createJournaledNarrationAdapter } from '../../../app/_runtime/lib/room/story-narration.ts';


test('recovery keeps the identical frozen inputs and records recoveryReview; rate limit and total timeout never repair', async () => {
  const request = { ...transfer(), narrationPurpose: 'narrationRecovery' }, body = '远行者把两面玻璃镜递给了药师。';
  const good = binding(request, body, reviewFor(request, body)); await good.adapter.narrate(request);
  assert.deepEqual(good.receipts.map(r => r.invocationPurpose), ['narrationRecovery', 'narrationRecoveryReview']);
  for (const options of [{ reviewError: Object.assign(new Error('limited'), { status: 429 }) }, { hang: true, adapter: { invocationTimeoutMs: 15 } }]) {
    const run = binding(request, body, {}, options); await assert.rejects(run.adapter.narrate(request));
    assert.equal(run.calls.length, 2); assert.equal(run.receipts.length, 2);
    assert.equal(run.receipts[1].schemaVersion, NARRATION_REVIEW_SCHEMA);
  }
});

test('slow frozen recovery has three minutes shared by generation and review, including the RPC transport', async () => {
  // SPEC 0011 §2 / SPEC 0015 §8.2: widen waiting, retain the frozen call identity.
  const request = { ...transfer(), narrationPurpose: 'narrationRecovery', deliveryGeneration: 1,
    publicationAuthority: { kind: 'recovery', capability: 'test:recovery' } };
  const body = '远行者把两面玻璃镜递给了药师。';
  let now = 0;
  const stages = [];
  const adapter = createJournaledNarrationAdapter({ ai: { run() { throw new Error('unexpected direct call'); } }, now: () => now },
    async (authority, generation, ordinal, input, timeoutMs) => {
      stages.push({ authority, generation, ordinal, timeoutMs });
      now += 60_000;
      return ordinal === 1 ? response('submit_frozen_narration', { body })
        : response('review_frozen_narration', reviewFor(request, body));
    }, async () => { throw new Error('unexpected NPC call'); });
  assert.equal((await adapter.narrate(request)).body, body);
  assert.deepEqual(stages.map(stage => stage.timeoutMs), [180_000, 120_000]);
  assert.ok(stages.every(stage => stage.generation === 1 && stage.authority === request.publicationAuthority));
});

test('a review cannot restart the three-minute clock after slow generation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = { ...transfer(), deliveryGeneration: 1,
    publicationAuthority: { kind: 'recovery', capability: 'test:deadline' } };
  const body = '远行者把两面玻璃镜递给了药师。';
  let now = 0, entered;
  const reviewing = new Promise(resolve => { entered = resolve; });
  const adapter = createJournaledNarrationAdapter({ ai: { run() { throw new Error('unexpected direct call'); } }, now: () => now },
    async (_authority, _generation, ordinal, _input, timeoutMs) => {
      if (ordinal === 1) { now = 179_000; return response('submit_frozen_narration', { body }); }
      assert.equal(timeoutMs, 1_000);
      entered();
      return new Promise(() => {});
    }, async () => { throw new Error('unexpected NPC call'); });
  let finished = false;
  const result = adapter.narrate(request).catch(error => { finished = true; return error; });
  await reviewing;
  t.mock.timers.tick(999);
  await Promise.resolve();
  assert.equal(finished, false);
  now = 180_000;
  t.mock.timers.tick(1);
  assert.equal((await result).code, 'modelTransient');
});
