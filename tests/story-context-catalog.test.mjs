import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoomStoryContext, validateRoomStoryContext } from '../app/_runtime/lib/room/story-context.ts';
import { compileAbilityDefinition } from '../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { applyCampaignEvent } from '../app/_runtime/lib/rules/v2/campaign-events.ts';
import { applyCombatEvent } from '../app/_runtime/lib/rules/v2/combat-events.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { NPC_MATERIALIZATION_PLAN_SCHEMA } from '../app/_runtime/lib/rules/v2/npc-materialization.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { storyContextFixture, refreshTrigger, ACTOR, BOATMAN, HARBOR } from './fixtures/story-context.mjs';
import { npcStorySource } from './fixtures/kp-vnext-story-materialization.mjs';

function ready(input) {
  const result = buildRoomStoryContext(refreshTrigger(input));
  assert.equal(result.kind, 'ready', JSON.stringify(result));
  return result.context;
}
function registerAbility(input, formula = '1d6+2') {
  const result = compileAbilityDefinition({ definitionId: 'ability:story-context:shared', revision: '1', rulesBasis: 'srd5.1-2014',
    mechanicalKey: 'story-context-shared', activation: { kind: 'attack', actionGrant: 'attack' },
    target: { kind: 'creature', count: '1', reachInches: '60', requiresSight: true },
    attack: { ability: 'str', proficiency: true }, damage: [{ type: 'cold', formula }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const event = { eventType: 'DefinitionRegistered', payload: result.artifact, resolutionId: null };
  assert.equal(applyCampaignEvent(input.state, event), true);
  assert.equal(applyCombatEvent(input.state, event), true);
  const npc = input.state.combatRuntime.entities[BOATMAN];
  npc.abilityRefs = [...(npc.abilityRefs ?? []), result.artifact.definition.definitionId];
  return result.artifact.definition.definitionId;
}

test('a registered ability remains one canonical authoring dependency across both runtime catalogs', () => {
  const input = storyContextFixture(), ref = registerAbility(input), context = ready(input);
  assert.equal(context.materials.filter(material => material.ref === ref).length, 1);
  assert.equal(context.readSet.filter(dependency => dependency.ref === ref).length, 1);
  assert.deepEqual(validateRoomStoryContext({ ...input, context }), { kind: 'valid' });
  assert.equal(context.materials.find(material => material.ref === ref).content.compiledHash,
    input.state.combatRuntime.definitions[ref].compiledHash);
});

test('a Rules-materialized NPC with equipment does not block the next complete story context', () => {
  const input = storyContextFixture(), source = npcStorySource(), pin = `profile-context:${input.moduleProfile.moduleRef.profileId}`;
  source.mechanicalTemplate.initialLoadout.entries.push({ entryId: 'dagger', quantity: 1, equippedSlot: 'main',
    source: { kind: 'standardGear', ref: 'dagger' } });
  const refs = [ACTOR, HARBOR, 'fact:story:permit', pin, `character-timeline:${ACTOR}`].sort();
  const result = input.runtime.step(input.profiles, input.state, { kind: 'materializeNpc', rootActionId: `${input.rootActionId}:new-npc`,
    actorCharacterId: ACTOR, plan: { schema: NPC_MATERIALIZATION_PLAN_SCHEMA, contextHash: canonicalHash({ refs }),
      prospectiveRef: 'npc:story-context:new', sceneRef: HARBOR, source, basisRefs: ['fact:story:permit', HARBOR].sort(),
      authorizationRefs: [pin], readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(input.state, ref) })),
      visibilityPolicyRef: 'visibility:scene-observers' } });
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.ok(result.events.some(event => event.eventType === 'NpcMaterialized'));
  input.state = result.state;
  const context = ready(input), npc = input.state.combatRuntime.entities['npc:story-context:new'];
  assert.ok(context.materials.some(material => material.ref === 'npc:story-context:new'));
  assert.ok(npc.abilityRefs.length > 0);
  for (const ref of [npc.mechanicalDefinitionRef, ...npc.abilityRefs]) {
    assert.deepEqual(input.state.campaignRuntime.definitions[ref], input.state.combatRuntime.definitions[ref]);
    assert.equal(context.materials.filter(material => material.ref === ref).length, 1, ref);
  }
  assert.deepEqual(validateRoomStoryContext({ ...input, context }), { kind: 'valid' });
});

test('conflicting or forged duplicate definitions block both preparation and saved-context admission', () => {
  for (const change of ['source', 'compilerArtifact']) {
    const input = storyContextFixture(), ref = registerAbility(input), context = ready(input);
    if (change === 'source') {
      const other = storyContextFixture();
      registerAbility(other, '2d6+2');
      input.state.combatRuntime.definitions[ref] = other.state.combatRuntime.definitions[ref];
    } else input.state.combatRuntime.definitions[ref].mechanicGraph.operations[0].input = { forged: true };
    const before = canonicalHash(input.state), result = buildRoomStoryContext(refreshTrigger(input));
    assert.equal(result.kind, 'blocked', change);
    assert.match(result.issues.join(','), /authority:(conflicting-definition|invalid-compiled-definition)/);
    assert.equal(validateRoomStoryContext({ ...input, context }).kind, 'conflict');
    assert.equal(canonicalHash(input.state), before);
  }
});
