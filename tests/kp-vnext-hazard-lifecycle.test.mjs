import assert from "node:assert/strict";
import test from "node:test";
import { authorityRevisionOrHash, authorityRefBoundToScene } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as TARGET, PROBE_SOURCE as SOURCE, PROBE_ZONE as ZONE, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { parseSubmitKpProposalBundleArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { hazardTriggerRelationRef } from "../app/_runtime/lib/rules/v2/hazard-lifecycle.ts";
import { hazardDamageForTarget, hazardDiceSpecs, hazardMechanics, hazardOccurrence, registeredHazardTargets } from "../app/_runtime/lib/rules/v2/world-interaction-hazards.ts";
import { combatPendingAnswerOptions, openFrozenAttackReaction } from "../app/_runtime/lib/rules/v2/combat-actions.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const A = "prospective:mechanics", H = "prospective:hazard";
const branch = (effects, summary = "行为产生固化结果。") => ({ outcomeCode: "outcome:resolved", summary, effects,
  sensoryEvidence: [], pressures: [], opportunities: [] });
function wire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(wire);
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wire(child)])) : value;
}
function bundle(proposals) {
  const value = { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [SOURCE],
    adjudication: { kind: "directSuccess", risk: "按已固化来源和机械结算。", successOutcome: "完成合法的行为。" }, terminal: null, proposals };
  const { schema, kind, ...argumentsValue } = value;
  return parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle(wire(argumentsValue)));
}
function source(kind, content, handle, dependencies = []) {
  return { kind: "materializeDefinition", basisRefs: [SOURCE], consumes: dependencies.map(handle => ({ kind: "prospective", handle })),
    produces: [{ handle, kind: `${kind}Definition`, outcomeBinding: "always" }], outcomeBinding: "always",
    source: { kind, content }, visibilityPolicyRef: "visibility:scene-observers", summary: "固化危险及其机械。" };
}
function author(attack = null, triggerRef = SOURCE, target = null) {
  return bundle([
    source("ability", { label: "喷射机制", description: "来源依据自身机械执行冻结后果。", aliases: [], tags: [],
      activation: { kind: "nonCombatHazard" }, target: target ?? { kind: "creature", count: "1", rangeInches: "120", requiresSight: false },
      attack, save: null, damage: [{ formula: "1d4", type: "fire", sharedAcrossTargets: true }], healing: null,
      temporaryHitPoints: null, effect: null, effects: [], costs: [], grants: [] }, A),
    source("hazard", { schema: "zhuwei.environment-hazard-definition/v1", label: "有来源的喷流",
      trigger: { kind: "contactFeature", ref: triggerRef }, perceptibleSigns: ["出现可见水汽。"],
      disableMethods: ["关闭并锁住供汽阀门。"], environmentalConsequences: ["地面留下冷凝水。"], mechanicsRef: A }, H, [A]),
  ]);
}
function interaction(effects, refs = [], sourceRef = SOURCE) {
  return bundle([{ kind: "worldInteraction", basisRefs: [SOURCE], consumes: refs.map(ref => ({ kind: "existing", ref })),
    produces: [], outcomeBinding: "always", sceneRef: SCENE, targetRefs: [sourceRef], directTargetRefs: [sourceRef],
    instrumentRefs: [], abilityRef: null, intent: "操作当前机关。", method: "按已经掌握的方法操作。",
    branches: { success: branch(effects), failure: null } }]);
}
function effect(hazardRef, sourceDefinitionRef = SOURCE) {
  return { kind: "registeredHazard", sourceDefinitionRef, zoneRef: ZONE,
    damage: { kind: "authored", hazardDefinitionRef: hazardRef } };
}
function lower(fixture, state, id, value, focusRefs = [SOURCE, ZONE, TARGET]) {
  const rootActionId = `${fixture.rootActionId}:${id}`;
  const frozen = freezeAuthoredProbeContext(fixture, state, { rootActionId, focusRefs });
  const result = lowerVNext2ProposalBundle({ value, rootActionId, actorCharacterId: ACTOR, requiredContext: frozen.context, state });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  return { input: result.command.rulesInput, context: frozen.context };
}
function commit(fixture, state, input, events) {
  let result = fixture.runtime.step(fixture.profiles, state, input);
  events.push(...result.events);
  while (result.kind === "awaitingRandomness") {
    result = fixture.runtime.step(fixture.profiles, result.state, { kind: "fulfillAuthoritativeRandomness",
      continuation: result.continuation,
      rolls: result.randomnessRequest.dice.flatMap(({ count, sides }) => Array(Number(count)).fill(Number(sides))) });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result.state;
}
function authored(fixture, attack = null, triggerRef = SOURCE, target = null) {
  const events = [];
  const input = lower(fixture, fixture.state, "author", author(attack, triggerRef, target), [SOURCE, ZONE, TARGET, ACTOR]).input;
  const state = commit(fixture, fixture.state, input, events);
  const hazardRef = Object.keys(state.campaignRuntime.definitions).find(ref => ref.startsWith("authored-definition:hazard:"));
  assert.ok(hazardRef);
  return { state, events, hazardRef };
}
function replay(fixture, events, state) {
  const rebuilt = fixture.runtime.replay(fixture.genesis, events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, state);
}
function reseedFixture(fixture, mutate) {
  const state = structuredClone(fixture.state);
  mutate(state);
  const { eventHeadHash, lastEventId, ...domain } = state;
  const initialStateHash = canonicalSha256(domain);
  state.eventHeadHash = initialStateHash;
  const unsigned = { ...fixture.genesis, initialState: state, initialStateHash };
  delete unsigned.genesisHash;
  fixture.genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  const rebuilt = fixture.runtime.replay(fixture.genesis, []);
  assert.equal(rebuilt.kind, "replayed");
  fixture.state = rebuilt.state;
  return fixture;
}

test("KP authoring creates a discoverable trigger relation; ordinary relation ending prevents another roll", () => {
  const fixture = createAuthoredProbeFixture("hazard-lifecycle");
  let { state, events, hazardRef } = authored(fixture);
  const relationRef = hazardTriggerRelationRef(hazardRef);
  const relation = state.campaignRuntime.definitions[relationRef];
  assert.deepEqual(relation.content, { relationRef, kind: "triggers", subjectRef: SOURCE, objectRef: hazardRef, state: "active" });
  assert.equal(authorityRefBoundToScene(state, hazardRef, SCENE), true);
  assert.equal(authorityRefBoundToScene(state, hazardRef, "scene:elsewhere"), false);
  const activeHash = authorityRevisionOrHash(state, hazardRef);
  const use = lower(fixture, state, "trigger", interaction([effect(hazardRef), {
    kind: "definitionRevision", definitionRef: SOURCE, summary: "地面留下冷凝水。",
    operations: [{ kind: "set", path: ["observableState"], value: "condensation remains" }],
  }], [hazardRef]));
  assert.ok(use.context.entries.some(entry => entry.entryRef === relationRef));
  state = commit(fixture, state, use.input, events);
  assert.equal(state.entities[TARGET].hitPoints.current, 16);
  assert.equal(state.campaignRuntime.definitions[SOURCE].content.observableState, "condensation remains");
  const disable = lower(fixture, state, "disable", interaction([
    { kind: "relationTransition", relationRef, toState: "ended" },
    { kind: "definitionRevision", definitionRef: SOURCE, summary: "供汽连接被关闭。",
      operations: [{ kind: "set", path: ["observableState"], value: "sealed" }] },
  ], [relationRef, hazardRef]));
  state = commit(fixture, state, disable.input, events);
  assert.equal(state.campaignRuntime.definitions[relationRef].content.state, "ended");
  assert.notEqual(authorityRevisionOrHash(state, hazardRef), activeHash);
  const retry = lower(fixture, state, "retry", interaction([effect(hazardRef)], [hazardRef]));
  assert.ok(retry.context.entries.some(entry => entry.entryRef === relationRef));
  const rejected = fixture.runtime.step(fixture.profiles, state, retry.input);
  assert.equal(rejected.kind, "rejected", JSON.stringify(rejected));
  assert.deepEqual(rejected.events, []);
  assert.equal(state.entities[TARGET].hitPoints.current, 16);
  replay(fixture, events, state);
});

test("a creature-sourced hazard derives its ability modifier and proficiency instead of requiring a fixed bonus", () => {
  const fixture = createAuthoredProbeFixture("hazard-creature-attack");
  let { state, events, hazardRef } = authored(fixture, { ability: "dex", proficiency: true }, ACTOR);
  const planned = lower(fixture, state, "attack", interaction([effect(hazardRef, ACTOR)], [hazardRef], ACTOR));
  const pending = fixture.runtime.step(fixture.profiles, state, planned.input);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const attack = pending.randomnessRequest.hazardRolls.find(spec => spec.purposeKey.includes(":attack:"));
  assert.equal(attack.frozenParameters.modifier, 2);
  state = commit(fixture, state, planned.input, events);
  assert.equal(state.entities[TARGET].hitPoints.current, 12);
  replay(fixture, events, state);
});

test("spell attacks use available source spellcasting; missing source mechanics and cyclic scope fail closed", () => {
  const fixture = createAuthoredProbeFixture("hazard-spell-source");
  const { state, hazardRef } = authored(fixture, { kind: "spellAttack" }, ACTOR);
  const request = effect(hazardRef, ACTOR);
  assert.equal(registeredHazardTargets(state, SCENE, request), undefined);
  const unavailable = lower(fixture, state, "missing-spellcasting", interaction([request], [hazardRef], ACTOR));
  const rejected = fixture.runtime.step(fixture.profiles, state, unavailable.input);
  assert.equal(rejected.kind, "rejected");
  assert.deepEqual(rejected.events, []);
  const mechanicalFixture = structuredClone(state);
  mechanicalFixture.combatRuntime.entities[ACTOR].spellcasting = { ability: "int", spellAttackBonus: "7" };
  const specs = hazardDiceSpecs(fixture.profiles, mechanicalFixture, { resolutionId: "resolution:spell",
    sceneRef: SCENE, ruling: { kind: "directSuccess" }, branches: { success: branch([request]) } });
  assert.equal(specs.find(spec => spec.purposeKey.includes(":attack:")).frozenParameters.modifier, 7);
  const cyclic = structuredClone(state);
  cyclic.campaignRuntime.definitions[hazardRef].content.trigger.ref = hazardRef;
  assert.equal(authorityRefBoundToScene(cyclic, hazardRef, SCENE), false);
});

test("hazard hit continuation uses current Shield armor with the already frozen roll and source modifier", () => {
  const fixture = createAuthoredProbeFixture("hazard-shield-helper");
  const { state, hazardRef } = authored(fixture, { ability: "dex", proficiency: true }, ACTOR);
  const request = effect(hazardRef, ACTOR);
  const plan = { resolutionId: "resolution:shield", sceneRef: SCENE, ruling: { kind: "directSuccess" },
    branches: { success: branch([request]) } };
  const specs = hazardDiceSpecs(fixture.profiles, state, plan);
  const key = hazardOccurrence(plan, "success", 0), mechanics = hazardMechanics(state, request);
  const faces = new Map(specs.map(spec => [spec.purposeKey,
    spec.dice.flatMap(({ count, sides }) => Array(Number(count)).fill(Number(sides) === 20 ? 10 : 4))]));
  assert.equal(specs.find(spec => spec.purposeKey === `${key}:attack:${TARGET}`).frozenParameters.coverBonus, 0);
  const before = hazardDamageForTarget(mechanics, key, TARGET, specs, faces, state);
  assert.equal(before.hit, true);
  assert.equal(before.components[0].rolled, 4);
  const afterReaction = structuredClone(state);
  afterReaction.combatRuntime.effects["effect:shield"] = {
    id: "effect:shield", kind: "shield", targetEntityId: TARGET, armorClassBonus: "5",
  };
  afterReaction.combatRuntime.entities[ACTOR].stats.dex = "30";
  const after = hazardDamageForTarget(mechanics, key, TARGET, specs, faces, afterReaction);
  assert.equal(after.hit, false);
  assert.equal(after.affected, false);
  assert.equal(after.components[0].rolled, 0);
  faces.set(`${key}:attack:${TARGET}`, [20, 1]);
  const critical = hazardDamageForTarget(mechanics, key, TARGET, specs, faces, afterReaction);
  assert.equal(critical.hit, true);
  assert.equal(critical.critical, true);
  assert.equal(critical.components[0].rolled, 8);
});

test("nonarea hazards with no reachable targets need no dice; visibility is rechecked at settlement", () => {
  for (const [kind, distance] of [["reachInches", "10"], ["rangeInches", "10"]]) {
    const fixture = createAuthoredProbeFixture(`hazard-${kind}`);
    const target = { kind: "creature", count: "1", [kind]: distance, requiresSight: false };
    const { state, hazardRef } = authored(fixture, { ability: "dex", proficiency: true }, ACTOR, target);
    const planned = lower(fixture, state, "outside-range", interaction([effect(hazardRef, ACTOR)], [hazardRef], ACTOR));
    const result = fixture.runtime.step(fixture.profiles, state, planned.input);
    assert.equal(result.kind, "committed", `${kind} must filter the frozen attack target`);
    assert.equal(result.events.some(event => event.eventType === "RandomnessRequested"), false);
    assert.equal(result.state.entities[TARGET].hitPoints.current, 20);
  }
  const fixture = createAuthoredProbeFixture("hazard-requires-sight");
  const { state, hazardRef } = authored(fixture, { ability: "dex", proficiency: true }, ACTOR,
    { kind: "creature", count: "1", rangeInches: "120", requiresSight: true });
  const request = effect(hazardRef, ACTOR);
  assert.ok(registeredHazardTargets(state, SCENE, request));
  const blinded = structuredClone(state);
  blinded.combatRuntime.entities[ACTOR].conditions = { blinded: true };
  assert.deepEqual(registeredHazardTargets(blinded, SCENE, request), []);
  const absentGeometry = structuredClone(state);
  delete absentGeometry.combatRuntime.entities[ACTOR].position;
  assert.equal(registeredHazardTargets(absentGeometry, SCENE, request), undefined);
});

test("one zone independently filters reach and sight while count=1 still settles every eligible creature", () => {
  const NEAR = "character:probe-near", RELATION = "relation:probe-near-occupant";
  const fixtureFor = name => reseedFixture(createAuthoredProbeFixture(name), state => {
    state.entities[NEAR] = { ...structuredClone(state.entities[TARGET]), id: NEAR, name: "近处角色", entityOrdinal: "3" };
    state.combatRuntime.entities[NEAR] = { ...structuredClone(state.combatRuntime.entities[TARGET]), id: NEAR, entityId: NEAR,
      entityOrdinal: "3", controllerPrincipalId: "principal:probe-near", position: { x: "160", y: "100", elevation: "0" } };
    state.combatRuntime.entities[TARGET].position = { x: "250", y: "100", elevation: "0" };
    state.principals["principal:probe-near"] = { id: "principal:probe-near", sessionVersion: 1, role: "player" };
    state.seats["seat:probe-near"] = { id: "seat:probe-near", principalId: "principal:probe-near", status: "active" };
    state.characterControls[NEAR] = { characterId: NEAR, seatId: "seat:probe-near" };
    state.multiplayerRuntime.members["principal:probe-near"] = { principalId: "principal:probe-near", role: "player", status: "active" };
    state.knowledge[NEAR] = {};
    state.multiplayerRuntime.characterTimelineIds[NEAR] = state.multiplayerRuntime.characterTimelineIds[TARGET];
    state.campaignRuntime.definitions[RELATION] = storedSemanticDefinition("worldRelation", "visibility:room-authority-only",
      createDefinitionSnapshot(RELATION, "1", { relationRef: RELATION, kind: "contains", subjectRef: ZONE, objectRef: NEAR, state: "active" }));
    if (name === "hazard-mixed-sight") state.combatRuntime.entities[TARGET].conditions = { invisible: true };
    if (name === "hazard-missing-target-geometry") delete state.combatRuntime.entities[TARGET].position;
    if (name === "hazard-malformed-target-geometry") state.combatRuntime.entities[TARGET].footprint.width = "0";
  });
  for (const [caseId, target] of [
    ["hazard-mixed-reach", { reachInches: "60", requiresSight: false }],
    ["hazard-mixed-range", { rangeInches: "60", requiresSight: false }],
    ["hazard-mixed-sight", { rangeInches: "400", requiresSight: true }],
    ["hazard-count-per-creature", { rangeInches: "400", requiresSight: false }],
  ]) {
    const fixture = fixtureFor(caseId);
    let { state, events, hazardRef } = authored(fixture, { ability: "dex", proficiency: true }, ACTOR,
      { kind: "creature", count: "1", ...target });
    const expected = caseId === "hazard-count-per-creature" ? [NEAR, TARGET].sort() : [NEAR];
    const request = effect(hazardRef, ACTOR);
    assert.deepEqual(registeredHazardTargets(state, SCENE, request)?.map(value => value.targetRef), expected, caseId);
    const input = lower(fixture, state, "mixed-targets", interaction([request], [hazardRef], ACTOR), [SOURCE, ZONE, TARGET, NEAR]).input;
    const waiting = fixture.runtime.step(fixture.profiles, state, input);
    assert.equal(waiting.kind, "awaitingRandomness", caseId);
    const reserved = caseId === "hazard-mixed-sight" ? [NEAR, TARGET].sort() : expected;
    assert.deepEqual(waiting.randomnessRequest.hazardRolls.filter(spec => spec.purposeKey.includes(":attack:"))
      .map(spec => spec.frozenParameters.targetRef), reserved, "spatially eligible creatures reserve dice before visibility conditions can change");
    state = commit(fixture, state, input, events);
    assert.equal(state.entities[NEAR].hitPoints.current, 12);
    assert.equal(state.entities[TARGET].hitPoints.current, expected.includes(TARGET) ? 12 : 20);
    replay(fixture, events, state);
  }
  for (const caseId of ["hazard-missing-target-geometry", "hazard-malformed-target-geometry"]) {
    const missing = fixtureFor(caseId);
    const { state, hazardRef } = authored(missing, { ability: "dex", proficiency: true }, ACTOR,
      { kind: "creature", count: "1", rangeInches: "400", requiresSight: false });
    const input = lower(missing, state, "invalid-geometry", interaction([effect(hazardRef, ACTOR)], [hazardRef], ACTOR), [SOURCE, ZONE, TARGET, NEAR]).input;
    const result = missing.runtime.step(missing.profiles, state, input);
    assert.equal(result.kind, "rejected", "an unavailable bound cannot be treated as a harmless target outside range");
    assert.deepEqual(result.events, []);
  }
});

for (const placement of ["effect", "effects"]) test(`equipped authored Shield and Counterspell use frozen ${placement} as reaction identity`, () => {
  const fixture = createAuthoredProbeFixture("authored-reaction-identities");
  const seed = structuredClone(fixture.state);
  seed.entities[ACTOR].resources["spellSlot:3"] = 3;
  seed.entities[ACTOR].resourceMaximums["spellSlot:3"] = 3;
  seed.combatRuntime.entities[ACTOR].resources["spellSlot:3"] = { current: "3", maximum: "3" };
  const { eventHeadHash, lastEventId, ...domain } = seed;
  const initialStateHash = canonicalSha256(domain);
  seed.eventHeadHash = initialStateHash;
  const unsigned = { ...fixture.genesis, initialState: seed, initialStateHash };
  delete unsigned.genesisHash;
  fixture.genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  const rebuilt = fixture.runtime.replay(fixture.genesis, []);
  assert.equal(rebuilt.kind, "replayed");
  fixture.state = rebuilt.state;
  const S = "prospective:defense", C = "prospective:interrupt", I = "prospective:focus", E = "prospective:focus-entry";
  const ability = (effect, spellLevel) => ({ label: "无固定名称的冻结反应", description: "装备授予其编译效果对应的反应。", aliases: [], tags: [],
    activation: { kind: "reactionSpell", spellLevel }, target: { kind: "creature", count: "1", rangeInches: "720", requiresSight: false },
    attack: null, save: null, damage: [], healing: null, temporaryHitPoints: null,
    effect: placement === "effect" ? effect : null, effects: placement === "effects" ? [effect] : [],
    costs: [{ kind: "spellSlot", level: spellLevel, amount: "1" }], grants: [] });
  const inventory = operation => ({ kind: "inventoryOperation", basisRefs: [SOURCE], consumes: [{ kind: "prospective", handle: E }],
    produces: [], outcomeBinding: "always", operation, summary: "取得并佩戴赋予反应的物品。" });
  const authoredBundle = bundle([
    source("ability", ability({ kind: "shield", armorClassBonus: "5", duration: "untilOwnNextTurnStart", magicMissileImmunity: true }, "1"), S),
    source("ability", ability({ kind: "counterspell", rangeInches: "720" }, "3"), C),
    source("item", { schema: "zhuwei.item-definition-content/v1", label: "反应护符", description: "携带两种冻结效果。", category: "equipment",
      aliases: [], tags: [], stackable: false, equipment: { allowedSlots: ["neck"], twoHanded: false, armor: null, weapon: null },
      equippedAbilityRefs: [S, C], use: null, chargesMaximum: null, durabilityMaximum: null }, I, [S, C]),
    { kind: "materializeItem", basisRefs: [SOURCE], consumes: [{ kind: "prospective", handle: I }],
      produces: [{ handle: E, kind: "itemEntry", outcomeBinding: "always" }], outcomeBinding: "always", definitionRef: I,
      sceneRef: SCENE, quantity: 1, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:scene-observers", summary: "物品已固化。" },
    inventory({ kind: "acquire", entryRef: E, quantity: 1 }), inventory({ kind: "equip", entryRef: E, action: "wear", slot: "neck" }),
  ]);
  const events = [];
  const input = lower(fixture, fixture.state, "author-reactions", authoredBundle).input;
  const state = commit(fixture, fixture.state, input, events);
  const refs = {};
  for (const reactionKind of ["shield", "counterspell"]) {
    const ref = Object.entries(state.combatRuntime.definitions).find(([, value]) =>
      value.effect?.kind === reactionKind || value.effects?.some(effect => effect.kind === reactionKind))?.[0];
    assert.ok(ref?.startsWith("authored-definition:ability:"));
    assert.ok(state.combatRuntime.entities[ACTOR].abilityRefs.includes(ref));
    assert.equal(state.combatRuntime.definitions[ref].mechanicalKey, undefined);
    refs[reactionKind] = ref;
    const options = combatPendingAnswerOptions(state, { choiceKind: "reaction", reactionKind,
      controllerEntityId: ACTOR, candidateAbilityRefs: [ref] });
    assert.ok(options.some(option => option.answer.abilityRef === ref && option.answer.slotLevel === "3"), reactionKind);
  }
  const corrupted = structuredClone(state);
  const corruptDefinition = corrupted.combatRuntime.definitions[refs.counterspell];
  (placement === "effect" ? corruptDefinition.effect : corruptDefinition.effects[0]).kind = "shield";
  const unavailable = combatPendingAnswerOptions(corrupted, { choiceKind: "reaction", reactionKind: "shield",
    controllerEntityId: ACTOR, candidateAbilityRefs: [refs.counterspell] });
  assert.equal(unavailable.some(option => option.answer.kind === "useReaction"), false,
    "changing an uncompiled source field cannot impersonate another frozen Effect");
  const pending = openFrozenAttackReaction(fixture.profiles, state, {
    rootActionId: "root:authored-shield-hit", occurrenceId: "attack:opaque", sourceRef: TARGET, targetRef: ACTOR, hit: true,
  });
  assert.equal(pending?.kind, "awaitingInput");
  assert.deepEqual(pending.pending.candidateAbilityRefs, [refs.shield]);
  const done = fixture.runtime.step(fixture.profiles, pending.state, { kind: "answerPendingInput",
    pendingInputId: pending.pending.pendingInputId, responseId: "response:authored-shield",
    answer: { kind: "useReaction", abilityRef: refs.shield, slotLevel: "3" } });
  assert.equal(done.kind, "committed", JSON.stringify(done));
  assert.equal(done.state.entities[ACTOR].resources["spellSlot:3"], 2);
  assert.ok(Object.values(done.state.combatRuntime.effects).some(effect => effect.kind === "shield" && effect.targetEntityId === ACTOR));
  replay(fixture, [...events, ...pending.events, ...done.events], done.state);
});

function orderedHazardFixture(name, condition, mechanic, { remove = false, concentrating = false, sourceAttack = false } = {}) {
  const fixture = createAuthoredProbeFixture(name);
  const attackZone = "scene-feature:ordered-source-attack-zone";
  if (sourceAttack) reseedFixture(fixture, state => {
    state.campaignRuntime.definitions[attackZone] = storedSemanticDefinition("sceneFeature", "visibility:scene-observers",
      createDefinitionSnapshot(attackZone, "1", { sceneRef: SCENE, label: "来源攻击范围", mechanicDefinitionRefs: [] }));
    const relationRef = "world-relation:ordered-source-attack-target";
    state.campaignRuntime.definitions[relationRef] = storedSemanticDefinition("worldRelation", "visibility:room-authority-only",
      createDefinitionSnapshot(relationRef, "1", { relationRef, kind: "contains", subjectRef: attackZone, objectRef: ACTOR, state: "active" }));
  });
  if (concentrating) reseedFixture(fixture, state => {
    state.combatRuntime.entities[TARGET].concentration = { abilityRef: "ability:held-concentration" };
  });
  const grant = { kind: "grantEffect", condition, duration: { kind: "untilEnded" },
    ...(condition === "exhaustion" ? { level: 3 } : {}) };
  const contents = [
    { damage: [], effects: [grant] },
    { damage: [], effects: [{ kind: "endEffect", condition, sourceRef: null }] },
    mechanic,
  ];
  const proposalTemplate = author().proposals;
  const proposals = contents.flatMap((content, index) => {
    const abilityHandle = `prospective:ordered-ability-${index}`, hazardHandle = `prospective:ordered-hazard-${index}`;
    return [source("ability", { ...proposalTemplate[0].source.content, ...content }, abilityHandle),
      source("hazard", { ...proposalTemplate[1].source.content, mechanicsRef: abilityHandle,
        ...(sourceAttack && index === 2 ? { trigger: { kind: "contactFeature", ref: TARGET } } : {}) }, hazardHandle, [abilityHandle])];
  });
  const events = [];
  let state = commit(fixture, fixture.state, lower(fixture, fixture.state, "author-order", bundle(proposals)).input, events);
  const hazards = Object.entries(state.campaignRuntime.definitions).filter(([, definition]) => definition.definitionKind === "environmentHazard");
  const refs = contents.map((content) => hazards.find(([, hazard]) => {
    const ability = state.campaignRuntime.definitions[hazard.content.mechanicsRef];
    return content.effects ? ability.effects?.[0]?.kind === content.effects[0].kind
      : content.attack ? ability.attack !== undefined : content.save ? ability.save !== undefined : Array.isArray(ability.damage) && ability.damage.length > 0;
  })?.[0]);
  assert.ok(refs.every(Boolean));
  if (remove) state = commit(fixture, state, lower(fixture, state, "seed-condition", interaction([effect(refs[0])], [refs[0]])).input, events);
  return { fixture, state, events, first: refs[remove ? 1 : 0], second: refs[2],
    secondEffect: sourceAttack ? { ...effect(refs[2], TARGET), zoneRef: attackZone } : effect(refs[2]),
    focusRefs: [SOURCE, ZONE, TARGET, ACTOR, ...(sourceAttack ? [attackZone] : [])] };
}
function executeOrderedHazards(prepared, mode, { saveFaces = [20, 2], attackFaces = [5, 12], concentrationFaces = [15, 2] } = {}) {
  const { fixture, state, events, first, second } = prepared;
  const selected = [effect(first), prepared.secondEffect];
  const value = mode === "atomic-steps"
    ? bundle(selected.map((value, index) => interaction([value], [index === 0 ? first : second]).proposals[0]))
    : mode === "atomic-branch" ? bundle([
      interaction(selected, [first, second]).proposals[0],
      interaction([{ kind: "definitionRevision", definitionRef: SOURCE, summary: "连续结算已完成。",
        operations: [{ kind: "set", path: ["observableState"], value: "ordered hazards resolved" }] }]).proposals[0],
    ]) : interaction(selected, [first, second]);
  const lowered = lower(fixture, state, `ordered-${mode}`, value, prepared.focusRefs).input;
  const input = mode === "single" ? (lowered.kind === "resolveWorldInteraction" ? lowered : lowered.plan.steps[0].rulesInput) : lowered;
  if (mode === "single") assert.equal(input.kind, "resolveWorldInteraction");
  else assert.equal(input.kind, "applyAtomicWorldInteractionSteps");
  let result = fixture.runtime.step(fixture.profiles, state, input), waves = 0;
  const observed = [...result.events];
  while (result.kind === "awaitingRandomness") {
    assert.equal(++waves, 1, "conditions never request another dice batch after seeing the prefix outcome");
    const rolls = result.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => {
      const pair = spec.purposeKey.includes(":save:") ? saveFaces : spec.purposeKey.includes(":attack:") ? attackFaces
        : spec.purposeKey.includes(":concentration:") ? concentrationFaces : [4, 4];
      return Array.from({ length: Number(die.count) }, (_, index) => pair[index % pair.length]);
    }));
    result = fixture.runtime.step(fixture.profiles, result.state, { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation, rolls });
    observed.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  replay(fixture, [...events, ...observed], result.state);
  return { ...result, observed };
}

for (const mode of ["single", "atomic-branch", "atomic-steps"]) test(`${mode} applies current save conditions after a prior hazard grants or ends them`, () => {
  for (const condition of ["paralyzed", "restrained"]) for (const remove of [false, true]) {
    const prepared = orderedHazardFixture(`ordered-save-${mode}-${condition}-${remove}`, condition,
      { save: { ability: "dex", dc: 10, halfOnSuccess: false } }, { remove });
    const result = executeOrderedHazards(prepared, mode);
    assert.equal(result.state.entities[TARGET].hitPoints.current, remove ? 20 : 16, `${condition}, remove=${remove}`);
  }
});

for (const mode of ["single", "atomic-branch", "atomic-steps"]) test(`${mode} derives attack advantage and automatic criticals from the preceding hazard outcome`, () => {
  for (const condition of ["paralyzed", "restrained"]) for (const remove of [false, true]) {
    const prepared = orderedHazardFixture(`ordered-attack-${mode}-${condition}-${remove}`, condition,
      { attack: { kind: "fixed", bonus: "0" } }, { remove });
    const attackFaces = remove ? (condition === "paralyzed" ? [12, 20] : [5, 20]) : [5, 12];
    const result = executeOrderedHazards(prepared, mode, { attackFaces });
    const expected = remove ? (condition === "paralyzed" ? 16 : 20) : condition === "paralyzed" ? 12 : 16;
    assert.equal(result.state.entities[TARGET].hitPoints.current, expected, `${condition}, remove=${remove}`);
  }
});

for (const mode of ["single", "atomic-branch", "atomic-steps"]) test(`${mode} settles passive hazard source conditions after the preceding outcome`, () => {
  for (const condition of ["paralyzed", "poisoned", "blinded"]) for (const remove of [false, true]) {
    const prepared = orderedHazardFixture(`ordered-source-${mode}-${condition}-${remove}`, condition,
      { attack: { kind: "fixed", bonus: "0" },
        target: { kind: "creature", count: "1", rangeInches: "120", requiresSight: condition === "blinded" } },
      { remove, sourceAttack: true });
    const result = executeOrderedHazards(prepared, mode, { attackFaces: [12, 2] });
    assert.equal(result.state.entities[ACTOR].hitPoints.current, remove ? 6 : 10, `${condition}, remove=${remove}`);
  }
});

for (const mode of ["single", "atomic-branch", "atomic-steps"]) test(`${mode} applies current visibility using dice reserved for potential targets`, () => {
  for (const remove of [false, true]) {
    const prepared = orderedHazardFixture(`ordered-visibility-${mode}-${remove}`, "invisible",
      { save: { ability: "dex", dc: 10, halfOnSuccess: false },
        target: { kind: "creature", count: "1", rangeInches: "120", requiresSight: true } }, { remove });
    const result = executeOrderedHazards(prepared, mode, { saveFaces: [2, 20] });
    assert.equal(result.state.entities[TARGET].hitPoints.current, remove ? 16 : 20, `remove=${remove}`);
  }
});

for (const mode of ["single", "atomic-branch", "atomic-steps"]) test(`${mode} interprets concentration reserves after exhaustion changes or incapacitation`, () => {
  for (const remove of [false, true]) {
    const prepared = orderedHazardFixture(`ordered-concentration-${mode}-${remove}`, "exhaustion",
      { damage: [{ formula: "1d4", type: "fire", sharedAcrossTargets: true }] }, { remove, concentrating: true });
    const result = executeOrderedHazards(prepared, mode);
    const checked = result.observed.find(event => event.eventType === "ConcentrationTested");
    assert.equal(checked?.payload.succeeded, remove);
    assert.equal(checked?.payload.roll, remove ? 15 : 2);
  }
  const prepared = orderedHazardFixture(`ordered-incapacitated-concentration-${mode}`, "paralyzed",
    { damage: [{ formula: "1d4", type: "fire", sharedAcrossTargets: true }] }, { concentrating: true });
  const result = executeOrderedHazards(prepared, mode);
  assert.equal(result.observed.some(event => event.eventType === "ConcentrationTested"), false);
  assert.equal(result.state.combatRuntime.entities[TARGET].concentration, null);
});
