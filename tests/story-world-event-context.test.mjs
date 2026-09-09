import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoomStoryContext, buildRoomWorldStoryContext, validateRoomStoryContext } from '../app/_runtime/lib/room/story-context.ts';
import { verifyWorldStoryTrigger, worldStoryRequestInput } from '../app/_runtime/lib/room/story-world-event.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { worldStoryFixture, worldStoryEmptyCatalog, WORLD_TRACE } from './fixtures/story-world-event.mjs';
import { storyContextFixture, refreshTrigger, fact, ACTOR, BOATMAN, ARCHIVIST, CLERK, OTHER, HARBOR, ARCHIVE } from './fixtures/story-context.mjs';

const entry = (context, ref) => context.materials.find(material => material.ref === ref);
function worldInput(f = worldStoryFixture()) {
  const commit = f.commitInput(), result = verifyWorldStoryTrigger(commit, f.runtime);
  assert.equal(result.kind, 'verified', JSON.stringify(result));
  const selected = worldStoryRequestInput(result.trigger, { method: 'story.method.archive-investigation', scale: 'short', connection: 'local' });
  return { ...f, state: commit.afterState, trigger: result.trigger, libraryCatalog: worldStoryEmptyCatalog(result.trigger),
    request: { ...f.request, source: selected.source, trigger: selected.trigger, scope: selected.scope } };
}
function readyWorld(input) {
  const result = buildRoomWorldStoryContext(input);
  assert.equal(result.kind, 'ready', JSON.stringify(result));
  return result.context;
}

test('a no-player world trigger gets a complete private author context and keeps its real event/receipt witness', () => {
  for (const faction of [false, true]) {
    const input = worldInput(worldStoryFixture({ faction })), before = canonicalHash(input.state), context = readyWorld(input);
    assert.equal(canonicalHash(input.state), before);
    assert.ok(entry(context, WORLD_TRACE));
    assert.equal(entry(context, input.trigger.triggerRef).content.receipt.rootActionId, input.trigger.rootActionId);
    assert.equal(entry(context, 'story-context:binding').content.schema, 'zhuwei.room-world-story-context-binding/v1');
    assert.ok(entry(context, `knowledge:${ARCHIVIST}:knowledge:source-claim`));
    assert.ok(entry(context, `story-context:scene-frontiers:${ARCHIVE}`));
    assert.equal(context.timelines.some(point => point.timelineId === input.due.timelineId), true);
    assert.deepEqual(validateRoomStoryContext({ ...input, context: JSON.parse(JSON.stringify(context)) }), { kind: 'valid' });
    assert.equal(entry(context, `knowledge:${OTHER}:knowledge:private-player`), undefined);
    assert.doesNotMatch(JSON.stringify(context), /OTHER_PLAYER_PRIVATE_CANARY/);
    const npc = input.runtime.project(input.profiles, input.state,
      { kind: 'npc', npcId: ARCHIVIST, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
    assert.equal(npc.kind, 'projected');
    assert.equal(npc.knowledge.some(record => record.characterId !== ARCHIVIST), false);
    assert.doesNotMatch(JSON.stringify(npc), /story-context:binding|zhuwei.room-world-story-trigger/);
  }
});

test('a typed remote location dependency loads that place, its NPCs, records and independent frontier', () => {
  const input = storyContextFixture('conflict');
  input.state.canonicalFacts['fact:story:shipping-route'] = fact(input.state, 'fact:story:shipping-route', [BOATMAN],
    { sourceSceneRef: HARBOR, destinationSceneRef: ARCHIVE, text: '两处机构各自保留独立的运输记录。' });
  const result = buildRoomStoryContext(refreshTrigger(input));
  assert.equal(result.kind, 'ready', JSON.stringify(result));
  const context = result.context;
  assert.ok(entry(context, ARCHIVE));
  assert.ok(entry(context, ARCHIVIST), 'the remotely linked scene expands resident membership');
  assert.ok(entry(context, `knowledge:${ARCHIVIST}:knowledge:source-claim`));
  assert.ok(entry(context, `story-context:scene-frontiers:${ARCHIVE}`));
  const timelines = context.timelines.map(point => point.timelineId);
  assert.ok(timelines.includes(input.state.activeBranchId));
  assert.ok(timelines.includes(input.state.multiplayerRuntime.characterTimelineIds[ARCHIVIST]));
  const changed = structuredClone(input.state);
  changed.knowledge[ARCHIVIST]['knowledge:later'] = { ...changed.knowledge[ARCHIVIST]['knowledge:source-claim'],
    knowledgeRef: 'knowledge:later', content: '稍后取得的独立核对记录。' };
  assert.equal(validateRoomStoryContext({ ...input, state: changed, context }).kind, 'conflict');
  assert.equal(entry(context, `knowledge:${OTHER}:knowledge:private-player`), undefined);
});

test('missing causal frontiers, scope widening, receipt changes and incomplete dependencies fail closed', () => {
  const input = worldInput(), context = readyWorld(input);
  for (const part of ['frontier', 'clock', 'parent', 'receipt', 'membership']) {
    const state = structuredClone(input.state), timelineId = input.due.timelineId;
    if (part === 'frontier') delete state.multiplayerRuntime.causalFrontiers[timelineId];
    if (part === 'clock') state.fictionTimelines[timelineId].nowMicros = '100';
    if (part === 'parent') state.multiplayerRuntime.causalFrontiers[timelineId].causalParentTimelineIds.push('timeline:missing');
    if (part === 'receipt') state.receipts[input.trigger.rootActionId].status = 'superseded';
    if (part === 'membership') state.entities['npc:new-remote-resident'] = { ...state.entities[ARCHIVIST], id: 'npc:new-remote-resident' };
    assert.equal(validateRoomStoryContext({ ...input, state, context }).kind, 'conflict', part);
  }
  assert.equal(buildRoomWorldStoryContext({ ...input, request: { ...input.request,
    scope: { ...input.request.scope, entityIds: [...input.request.scope.entityIds, ACTOR] } } }).kind, 'blocked');
  const forged = structuredClone(context);
  forged.readSet = forged.readSet.filter(dependency => !dependency.ref.startsWith('story-context:scene-frontiers:'));
  const { contextHash, ...body } = forged;
  forged.contextHash = canonicalHash(body);
  assert.equal(validateRoomStoryContext({ ...input, context: forged }).kind, 'conflict');
  assert.equal(buildRoomWorldStoryContext({ ...input, maxUnits: 1 }).code, 'STORY_BUDGET_EXHAUSTED');
});

test('unrelated local activity cannot expose private player knowledge or invalidate the immutable world receipt alone', () => {
  const input = worldInput(), context = readyWorld(input), state = structuredClone(input.state);
  state.version = String(BigInt(state.version) + 1n);
  state.knowledge[OTHER]['knowledge:another-local-secret'] = { ...state.knowledge[OTHER]['knowledge:private-player'],
    knowledgeRef: 'knowledge:another-local-secret', content: 'ANOTHER_PLAYER_SECRET' };
  state.campaignRuntime.promises['promise:unrelated-local'] = { promisorId: CLERK, promiseeId: BOATMAN, content: '当地的新约定' };
  assert.deepEqual(validateRoomStoryContext({ ...input, state, context }), { kind: 'valid' });
});
