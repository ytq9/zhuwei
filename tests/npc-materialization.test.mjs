import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE,
  PROBE_SOURCE as BASIS } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { compileAbilityDefinition, registeredAbilityRecord } from '../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { isNpcMechanicalTemplateDefinition, npcMechanicalEntityMatchesTemplate } from '../app/_runtime/lib/rules/v2/npc-mechanics.ts';
import { isAuthoritativeWorldState } from '../app/_runtime/lib/rules/v2/validation.ts';
import { NPC_MATERIALIZATION_PLAN_SCHEMA, NPC_MATERIALIZATION_SOURCE_SCHEMA, isNpcMaterializationSource,
  isNpcMaterializationPlan, isNpcMaterializedPayload, npcMaterializationDefinitionRefs, deriveNpcMaterialization,
  applyNpcMaterializedEvent, stepMaterializeNpc } from '../app/_runtime/lib/rules/v2/npc-materialization.ts';

const NPC = 'npc:new-story-participant';
const ABILITY = 'ability:npc-source:frost-touch';
const clone = structuredClone;
function source(shape = 'guard') {
  const stats = shape === 'guard' ? { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 11 }
    : { str: 8, dex: 14, con: 10, int: 18, wis: 16, cha: 14 };
  return {
    name: shape === 'guard' ? '河堤巡守林英' : '档案学者何露',
    description: shape === 'guard' ? '穿着旧链衫，右臂系着巡夜布带。' : '携带防水卷宗盒。',
    background: 'PRIVATE_BACKGROUND：在上游洪灾后转调本地。',
    goals: ['保护河道附近的居民', '查明旧档案缺页的原因'],
    behavioralConstraints: ['不会把陌生人的说法直接当作事实'],
    voice: '说话简短，先陈述亲眼所见，再指出不确定的部分。',
    initialUnknowns: ['UNKNOWN_CANARY：不知道失踪卷宗现在的持有人'],
    rulesBasis: 'srd5.1-2014',
    mechanicalTemplate: {
      schema: 'zhuwei.npc-mechanical-template/v1', label: shape === 'guard' ? '巡守完整机制' : '学者完整机制',
      stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, String(value)])),
      proficiencyBonus: '2', armorClass: shape === 'guard' ? '12' : '11',
      armorClassModel: { kind: 'higherOfBaseAndEquipment', baseArmorClass: shape === 'guard' ? '12' : '11', shieldBonus: '2' },
      hitPointsMaximum: shape === 'guard' ? '26' : '16', footprint: { width: '60', depth: '60', height: '70' },
      speedInches: shape === 'guard' ? { walk: '360', swim: '240' } : { walk: '300' },
      resourceMaximums: shape === 'guard' ? {} : { 'resource:research-focus': '3' },
      deathPolicy: shape === 'guard' ? 'defeatedAtZero' : 'deathSaves',
      intrinsicAbilityRefs: shape === 'guard' ? [] : [ABILITY], itemDefinitionRefs: [],
      initialLoadout: { entries: shape === 'guard' ? [
        { entryId: 'spear', quantity: 1, equippedSlot: 'main', source: { kind: 'standardGear', ref: 'spear' } },
        { entryId: 'armor', quantity: 1, equippedSlot: 'armor', source: { kind: 'standardGear', ref: 'chain-shirt' } },
        { entryId: 'shield', quantity: 1, equippedSlot: 'off', source: { kind: 'standardGear', ref: 'shield' } },
      ] : [] },
      ...(shape === 'guard' ? { attacksPerAttackAction: '2', sizeCategory: 'medium' }
        : { damageDefenses: { resistant: ['cold'] }, spellcasting: { ability: 'int', spellAttackBonus: '6', spellSaveDc: '14' } }),
    },
    socialMechanics: { abilityScores: stats, proficiencyBonus: 2,
      skillModifiers: shape === 'guard' ? { insight: 3, intimidation: 2 } : { insight: 5, persuasion: 4, history: 8 },
      initialTrust: shape === 'guard' ? -1 : 1, authorityModifier: shape === 'guard' ? 2 : 0,
      stakesSensitivity: shape === 'guard' ? 2 : 1, maximumInfluenceDegree: shape === 'guard' ? 'limitedSuccess' : 'strongSuccess' },
    position: { x: '400', y: '400', elevation: '0' },
  };
}
function fixture(label, shape = 'guard') {
  const f = createAuthoredProbeFixture(`npc-materialization:${label}`);
  if (shape === 'scholar') {
    const compiled = compileAbilityDefinition({ definitionId: ABILITY, revision: '1', rulesBasis: 'srd5.1-2014',
      mechanicalKey: 'frost-touch', activation: { kind: 'attack', actionGrant: 'attack' },
      target: { kind: 'creature', count: '1', reachInches: '60', requiresSight: true },
      attack: { ability: 'int', proficiency: true }, damage: [{ type: 'cold', formula: '1d6+4' }] });
    assert.equal(compiled.ok, true, JSON.stringify(compiled));
    // Existing compiled authority fixture: this helper slice has no public
    // materializeNpc dispatch until the integration owner registers its event.
    f.state.combatRuntime.definitions[ABILITY] = registeredAbilityRecord(compiled.artifact);
    f.state.campaignRuntime.definitions[ABILITY] = registeredAbilityRecord(compiled.artifact);
  }
  const pin = `profile-context:${f.state.campaignRuntime.campaign.moduleRef.profileId}`;
  const src = source(shape);
  const refs = [...new Set([ACTOR, SCENE, BASIS, pin, `character-timeline:${ACTOR}`, ...src.mechanicalTemplate.intrinsicAbilityRefs])].sort();
  f.input = { kind: 'materializeNpc', rootActionId: `${f.rootActionId}:npc`, actorCharacterId: ACTOR,
    plan: { schema: NPC_MATERIALIZATION_PLAN_SCHEMA, contextHash: canonicalSha256({ label }), prospectiveRef: NPC,
      sceneRef: SCENE, source: src, basisRefs: [BASIS, SCENE].sort(), authorizationRefs: [pin],
      readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })),
      visibilityPolicyRef: 'visibility:scene-observers' } };
  return f;
}
function event(f, input = f.input) {
  const timeline = characterTimelineId(f.state, ACTOR);
  return { eventType: 'NpcMaterialized', rootActionId: input.rootActionId, profiles: clone(f.profiles),
    payload: { actorCharacterId: ACTOR, plan: clone(input.plan) },
    roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId, branchId: f.state.activeBranchId,
    fictionTimelineId: timeline, fictionInstantMicros: f.state.fictionTimelines[timeline].nowMicros,
    visibilityPolicyId: 'visibility:room-authority-only', secrecy: 'internal' };
}
function derived(f, input = f.input, state = f.state) {
  const result = deriveNpcMaterialization(state, input);
  assert.equal(result.kind, 'derived', JSON.stringify(result));
  return result;
}
function rejects(f, input, code, pattern, state = f.state) {
  const before = clone(state);
  const result = deriveNpcMaterialization(state, input);
  assert.equal(result.kind, 'rejected', JSON.stringify(result));
  assert.equal(result.rejection.code, code);
  assert.match(result.rejection.message, pattern);
  assert.deepEqual(result.events, []);
  assert.deepEqual(state, before);
}

test('complete authored social and mechanical shapes use the same derivation and NPC reducer', () => {
  for (const shape of ['guard', 'scholar']) {
    const f = fixture(shape, shape), before = clone(f.state), result = derived(f);
    assert.equal(isNpcMaterializationSource(f.input.plan.source), true);
    assert.equal(isNpcMaterializationPlan(f.input.plan), true);
    assert.equal(isNpcMaterializedPayload(event(f).payload), true);
    assert.equal(isNpcMechanicalTemplateDefinition(result.mechanicalDefinition), true);
    assert.deepEqual(result.character.socialMechanics, f.input.plan.source.socialMechanics);
    assert.equal(result.character.hitPoints.maximum, Number(f.input.plan.source.mechanicalTemplate.hitPointsMaximum));
    assert.equal(npcMechanicalEntityMatchesTemplate(result.combatEntity, result.mechanicalDefinition,
      { ...f.state.combatRuntime.definitions, ...result.itemSystem.definitions,
        ...Object.fromEntries(result.equipmentDefinitions.map(entry => [entry.definitionId, entry])) },
      result.character, result.itemSystem), true);
    if (shape === 'guard') {
      assert.equal(result.character.loadout.armorClass, 16);
      assert.equal(Object.values(result.itemSystem.entries).filter(entry => entry.holderRef === NPC).length, 3);
      assert.ok(result.equipmentDefinitions.length > 0);
      assert.equal(result.combatEntity.attacksPerAttackAction, '2');
    } else {
      assert.equal(result.character.resources['resource:research-focus'], 3);
      assert.deepEqual(result.combatEntity.abilityRefs, [ABILITY]);
      assert.deepEqual(result.combatEntity.damageDefenses, { resistant: ['cold'] });
    }
    assert.deepEqual(f.state, before, 'derivation is pure');
    const state = clone(f.state);
    applyNpcMaterializedEvent(state, event(f));
    assert.equal(isAuthoritativeWorldState(state), true);
    assert.deepEqual(state.entities[NPC], result.character);
    assert.deepEqual(state.combatRuntime.entities[NPC], result.combatEntity);
    assert.deepEqual(state.entities[ACTOR], before.entities[ACTOR]);
    assert.deepEqual(state.entities[OTHER], before.entities[OTHER]);
    const npc = f.runtime.project(f.profiles, state, { kind: 'npc', npcId: NPC,
      purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
    assert.equal(npc.kind, 'projected', JSON.stringify(npc));
    assert.match(npc.npcIdentity.description, /PRIVATE_BACKGROUND/);
    assert.equal(npc.npcIdentity.goals.length, 2);
  }
});

test('the published source schema requires the actual full template and excludes authority patches', () => {
  const schema = NPC_MATERIALIZATION_SOURCE_SCHEMA;
  assert.equal(schema.additionalProperties, false);
  for (const key of ['background', 'goals', 'behavioralConstraints', 'voice', 'initialUnknowns', 'mechanicalTemplate', 'socialMechanics']) {
    assert.ok(schema.required.includes(key));
  }
  assert.equal(schema.properties.mechanicalTemplate.properties.schema.const, 'zhuwei.npc-mechanical-template/v1');
  for (const mutate of [src => { delete src.mechanicalTemplate; }, src => { src.mechanicalTemplate.stats.str = '31'; },
    src => { src.socialMechanics.abilityScores.str = 10; }, src => { src.controllerPrincipalId = 'principal:probe-actor'; },
    src => { src.knowledge = { secret: true }; }, src => { src.entityId = ACTOR; },
    src => { src.mechanicalTemplate.initialLoadout.entries.push(clone(src.mechanicalTemplate.initialLoadout.entries[0])); }]) {
    const src = source(); mutate(src);
    assert.equal(isNpcMaterializationSource(src), false, JSON.stringify(src));
  }
});

test('new NPC gains no player control, prior knowledge, world facts, party or encounter membership', () => {
  const f = fixture('no-grants'), before = clone(f.state), state = clone(f.state);
  applyNpcMaterializedEvent(state, event(f));
  assert.deepEqual(state.knowledge, { ...before.knowledge, [NPC]: {} });
  assert.deepEqual(state.characterControls, before.characterControls);
  assert.equal(state.entities[NPC].controllerPrincipalId, undefined);
  assert.equal(state.entities[NPC].lastControllerSeatId, undefined);
  assert.deepEqual(state.canonicalFacts, before.canonicalFacts);
  assert.deepEqual(state.combatRuntime.encounters, before.combatRuntime.encounters);
  const { characterTimelineIds, ...multiplayer } = state.multiplayerRuntime;
  const { characterTimelineIds: oldTimelines, ...priorMultiplayer } = before.multiplayerRuntime;
  assert.deepEqual(multiplayer, priorMultiplayer);
  assert.deepEqual(characterTimelineIds, { ...oldTimelines, [NPC]: characterTimelineId(before, ACTOR) });
  const player = f.runtime.project(f.profiles, state, f.viewer);
  assert.equal(player.kind, 'projected');
  assert.doesNotMatch(JSON.stringify(player), /PRIVATE_BACKGROUND|UNKNOWN_CANARY|frost-touch/);
});

test('missing mechanical, item, source or authorization definitions fail before any mutation', () => {
  const f = fixture('missing');
  for (const [mutate, code, message] of [
    [input => { input.plan.source.mechanicalTemplate.intrinsicAbilityRefs = ['ability:missing']; }, 'privateOrUnknownReference', /definition-unavailable/],
    [input => { input.plan.source.mechanicalTemplate.itemDefinitionRefs = ['item:missing']; }, 'privateOrUnknownReference', /definition-unavailable/],
    [input => { input.plan.source.mechanicalTemplate.initialLoadout.entries[0].source.ref = 'missing-gear'; }, 'privateOrUnknownReference', /closure-invalid/],
    [input => { input.plan.authorizationRefs = ['profile-context:wrong-module']; }, 'privateOrUnknownReference', /authorization-required/],
    [input => { input.plan.basisRefs = [SCENE, 'source:missing'].sort(); }, 'privateOrUnknownReference', /source-or-authorization-unavailable/],
  ]) {
    const input = clone(f.input); mutate(input); rejects(f, input, code, message);
  }
});

test('existing entity identities, stale and omitted source reads cannot be replaced or refreshed', () => {
  const f = fixture('conflicts', 'scholar');
  for (const id of [ACTOR, OTHER, BASIS]) {
    const input = clone(f.input); input.plan.prospectiveRef = id;
    rejects(f, input, 'invalidRulesInput', /new-identity-required/);
  }
  for (const ref of [ACTOR, SCENE, BASIS, ABILITY]) {
    const input = clone(f.input); input.plan.readSet.find(binding => binding.ref === ref).revisionOrHash = canonicalSha256('stale');
    rejects(f, input, 'causalFrontierConflict', /frozen-reads-changed/);
  }
  const missing = clone(f.input); missing.plan.readSet = missing.plan.readSet.filter(binding => binding.ref !== ABILITY);
  rejects(f, missing, 'causalFrontierConflict', /complete-frozen-source-bindings/);
  const occupied = clone(f.input); occupied.plan.source.position = clone(f.state.combatRuntime.entities[ACTOR].position);
  rejects(f, occupied, 'spatialCapacityUnavailable', /occupied-placement/);
  const refs = npcMaterializationDefinitionRefs(f.input.rootActionId, NPC), altered = clone(f.state);
  altered.campaignRuntime.definitions[refs.semanticDefinitionRef] = clone(altered.campaignRuntime.definitions[BASIS]);
  rejects(f, f.input, 'invalidRulesInput', /new-identity-required/, altered);
});

test('serialized event replay rederives deterministic identity, gear and mechanics with no model calls', () => {
  const f = fixture('replay'), state = clone(f.state), restored = JSON.parse(JSON.stringify(f.state));
  const original = event(f), persisted = JSON.parse(JSON.stringify(original));
  applyNpcMaterializedEvent(state, original);
  applyNpcMaterializedEvent(restored, persisted);
  assert.deepEqual(restored, state);
  assert.deepEqual(Object.keys(persisted.payload).sort(), ['actorCharacterId', 'plan']);
  const committed = clone(state);
  assert.throws(() => applyNpcMaterializedEvent(state, original), /new-identity-required/);
  assert.deepEqual(state, committed);
});

test('replay rejects hidden source patches, changed actor timeline and public private-source payloads atomically', () => {
  const f = fixture('replay-rejection');
  for (const mutate of [e => { e.payload.plan.source.socialMechanics.abilityScores.str = 9; },
    e => { e.payload.plan.source.knowledge = { secret: true }; }, e => { e.payload.entity = { id: OTHER }; },
    e => { e.fictionInstantMicros = '999'; }, e => { e.roomId = 'room:wrong'; },
    e => { e.branchId = 'branch:wrong'; }, e => { e.secrecy = 'public'; }]) {
    const changed = event(f), state = clone(f.state); mutate(changed);
    assert.throws(() => applyNpcMaterializedEvent(state, changed), /npc-materialization:/);
    assert.deepEqual(state, f.state);
  }
});

test('step rejects invalid and duplicate inputs without calling its authority transition port', () => {
  const f = fixture('step-rejects'), invalid = clone(f.input); invalid.plan.prospectiveRef = ACTOR;
  let calls = 0;
  const appendTransition = () => { calls += 1; throw new Error('must not append'); };
  assert.equal(stepMaterializeNpc(f.profiles, f.state, invalid, { appendTransition }).kind, 'rejected');
  const duplicate = clone(f.state); duplicate.receipts[f.input.rootActionId] = {};
  assert.equal(stepMaterializeNpc(f.profiles, duplicate, f.input, { appendTransition }).rejection.code, 'duplicateRootAction');
  assert.equal(stepMaterializeNpc(f.profiles, f.state, f.input).rejection.code, 'unsupportedOperation');
  assert.equal(calls, 0);
});
