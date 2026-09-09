import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { verifyWorldStoryTrigger, worldStoryTriggerMatchesAuthority, worldStorySelectionModelInput,
  parseWorldStorySelection, worldStoryRequestInput, worldStorySelectionInvocationBinding,
  WORLD_STORY_SELECTION_TOOL, WORLD_STORY_SELECTION_TOOL_NAME } from '../app/_runtime/lib/room/story-world-event.ts';
import { StoryCreationStore } from '../app/_runtime/lib/room/story-creation-store.ts';
import { roomModelInvocationBinding } from '../app/_runtime/lib/room/story-runtime-policy.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { assertDeepSeekStrictToolSchema } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { scheduledActorPlanDescriptors } from '../app/_runtime/lib/rules/v2/actor-plans.ts';
import { worldStoryFixture, worldStoryEmptyCatalog, WORLD_PLAN, WORLD_TRACE } from './fixtures/story-world-event.mjs';
import { ACTOR, ARCHIVIST, HARBOR, ARCHIVE } from './fixtures/story-context.mjs';

const selection = { method: 'story.method.archive-investigation', scale: 'short', connection: 'local' };
const response = decision => ({ choices: [{ message: { tool_calls: [{ type: 'function',
  function: { name: WORLD_STORY_SELECTION_TOOL_NAME, arguments: JSON.stringify({ decision }) } }] } }] });
function verified(f, input = f.commitInput()) {
  const result = verifyWorldStoryTrigger(input, f.runtime);
  assert.equal(result.kind, 'verified', JSON.stringify(result));
  return result.trigger;
}
function journal() {
  const db = new DatabaseSync(':memory:'); let sequence = 0;
  const storage = { sql: { exec(query, ...args) {
    const rows = args.length === 0 && query.trim().startsWith('CREATE') ? (db.exec(query), [])
      : db.prepare(query).all(...args).map(row => ({ ...row }));
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; },
      [Symbol.iterator]: function* () { yield* rows; } };
  } }, transactionSync(callback) {
    const name = `world_story_${++sequence}`; db.exec(`SAVEPOINT ${name}`);
    try { const value = callback(); db.exec(`RELEASE ${name}`); return value; }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
  } };
  const store = new StoryCreationStore(storage, { hash: canonicalHash, now: () => 10, newId: () => `world-call-${++sequence}` });
  store.ensureSchema(); return { db, store };
}

test('real remote NPC and faction due commits create the same private preparation trigger without a player turn', () => {
  for (const faction of [false, true]) {
    const f = worldStoryFixture({ faction }), input = f.commitInput(), before = canonicalHash(input);
    const trigger = verified(f, input);
    assert.equal(canonicalHash(input), before, 'verification is a pure Rules check');
    assert.equal(trigger.actorRef, ARCHIVIST);
    assert.deepEqual(trigger.scope.sceneIds, [ARCHIVE]);
    assert.equal(input.afterState.entities[ACTOR].sceneId, HARBOR);
    assert.equal(input.afterState.fictionTimelines[input.afterState.activeBranchId].nowMicros, '0');
    assert.ok(input.afterState.canonicalFacts[WORLD_TRACE]);
    const viewer = f.runtime.project(f.profiles, input.afterState, f.viewer);
    assert.equal(viewer.kind, 'projected');
    assert.equal(viewer.visibleFacts.some(fact => fact.id === WORLD_TRACE), false, 'remote trace is not automatically known locally');
    assert.equal(worldStoryTriggerMatchesAuthority(JSON.parse(JSON.stringify(trigger)), input.afterState, f.profiles, true), true);
    const request = worldStoryRequestInput(trigger, selection);
    assert.equal(request.trigger.kind, 'causalDevelopment');
    assert.equal(request.trigger.basisRefs[0], trigger.triggerRef);
    assert.deepEqual(request.source, input.budgetSource, 'the original root budget identity is retained in full');
  }
});

test('a plan decision remains a decision; future schedules and tampered commit proofs cannot manufacture outcomes', () => {
  const cancelled = worldStoryFixture({ decision: 'cancel' }), input = cancelled.commitInput();
  const trigger = verified(cancelled, input);
  assert.equal(input.afterState.canonicalFacts[WORLD_TRACE], undefined);
  assert.doesNotMatch(trigger.goal, /已经完成|已完成/);
  assert.ok(trigger.events.some(event => /Cancel/.test(event.eventType)));
  const future = worldStoryFixture();
  future.state.campaignRuntime.npcPlans[WORLD_PLAN].due.atFictionMicros = '1000000';
  const futureDue = scheduledActorPlanDescriptors(future.state).find(due => due.actorPlan?.planId === WORLD_PLAN);
  assert.ok(futureDue);
  assert.equal(verifyWorldStoryTrigger({ ...input, beforeState: future.state, due: futureDue }, future.runtime).kind, 'blocked');
  for (const part of ['rulesInput', 'committedEvents', 'afterState']) {
    const forged = structuredClone(input);
    if (part === 'rulesInput') forged.rulesInput.decision = 'execute';
    if (part === 'committedEvents') forged.committedEvents[0].payload.injectedResult = '原目标已达成';
    if (part === 'afterState') forged.afterState.scenes[ARCHIVE].name = '伪造后态';
    assert.equal(verifyWorldStoryTrigger(forged, cancelled.runtime).kind, 'blocked', part);
  }
});

test('the routing tool selects requirements only and cannot write a draft, invent a rule, or grant NPC knowledge', () => {
  const f = worldStoryFixture(), input = f.commitInput(), trigger = verified(f, input);
  const npcViewer = { kind: 'npc', npcId: ARCHIVIST, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' };
  const npc = f.runtime.project(f.profiles, input.afterState, npcViewer), before = canonicalHash(npc);
  assert.equal(npc.kind, 'projected');
  assertDeepSeekStrictToolSchema(WORLD_STORY_SELECTION_TOOL.function.parameters);
  const model = worldStorySelectionModelInput(trigger, worldStoryEmptyCatalog(trigger));
  assert.deepEqual(model.tools, [WORLD_STORY_SELECTION_TOOL]);
  assert.equal(model.max_completion_tokens, 1000);
  assert.deepEqual(parseWorldStorySelection(response({ kind: 'prepareStory', reason: '真实登记冲突值得调查。', selection })),
    { kind: 'prepareStory', reason: '真实登记冲突值得调查。', selection });
  assert.deepEqual(parseWorldStorySelection(response({ kind: 'noStory', reason: '普通事务，没有新的玩法空间。' })),
    { kind: 'noStory', reason: '普通事务，没有新的玩法空间。' });
  for (const invalid of [{ kind: 'prepareStory', reason: 'x', selection, draft: '偷偷写稿' },
    { kind: 'prepareStory', reason: 'x', selection: { ...selection, method: 'inventRules' } },
    { kind: 'noStory', reason: 'x', knowledge: ['KP_PRIVATE_CANARY'] }]) assert.throws(() => parseWorldStorySelection(response(invalid)));
  const duplicate = response({ kind: 'noStory', reason: 'x' });
  duplicate.choices[0].message.tool_calls[0].function.arguments = '{"decision":{"kind":"noStory","kind":"prepareStory","reason":"x"}}';
  assert.throws(() => parseWorldStorySelection(duplicate));
  assert.equal(canonicalHash(f.runtime.project(f.profiles, input.afterState, npcViewer)), before);
});

test('context selection shares the NPC source ledger and an unknown response cannot be sampled again', () => {
  const f = worldStoryFixture(), input = f.commitInput(), trigger = verified(f, input), { db, store } = journal();
  try {
    const existing = roomModelInvocationBinding(input.afterState, trigger.source.sourceId, 'existing-npc-decision', 'npc',
      { model: 'deepseek-v4-flash', max_completion_tokens: 1000, messages: [] });
    assert.equal(store.openBudget(existing).kind, 'opened');
    const binding = worldStorySelectionInvocationBinding(input.afterState, f.profiles, trigger, worldStoryEmptyCatalog(trigger));
    assert.deepEqual(binding.source, existing.source);
    assert.equal(binding.purpose, 'context');
    const { budget, ...external } = binding;
    const reserved = store.reserveExternalInvocation(external);
    assert.equal(reserved.kind, 'reserved', JSON.stringify(reserved));
    assert.equal(store.startInvocation(reserved).kind, 'ready');
    assert.equal(store.completeInvocation({ ...reserved, result: { kind: 'unknown' } }).kind, 'saved');
    const before = store.readBudget(binding.source.budgetAccountId);
    assert.equal(before.spent.calls, 1);
    assert.ok(before.held.inputTokens > 0 && before.held.outputTokens > 0);
    assert.equal(store.reserveExternalInvocation(external).kind, 'waiting');
    assert.deepEqual(store.readBudget(binding.source.budgetAccountId), before);
    assert.equal(store.openBudget({ source: { ...binding.source, kind: 'worldEvent' }, budget: binding.budget }).kind, 'rejected');
  } finally { db.close(); }
});
