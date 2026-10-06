import assert from "node:assert/strict";
import test from "node:test";
import { planNativeObjectCompletion } from "../../../app/_runtime/lib/rules/v2/native-object-completion.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { terrainCheckRequirement } from "../../../app/_runtime/lib/rules/v2/terrain-checks.ts";
import { publicDamageableFeature } from "../../../app/_runtime/lib/rules/v2/environment.ts";
import { step, project, replay, initialize, inventoryInput, PLAYER, PRINCIPAL, SEAT, SCENE, withCombatFixture, assertReplay } from "../../support/fixtures/inventory-operations.mjs";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR, PROBE_SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { proposalCompletableObjectRefs } from "../../../app/_runtime/lib/kp/vnext/proposal-context.ts";
import { itemBundle } from "../../support/fixtures/vnext-authored-bundles.mjs";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";

function complete(f, targetRef, completion, rootActionId, actor = PLAYER, scene = SCENE) {
  const before = structuredClone(f.state);
  const prepared = planNativeObjectCompletion(f.profiles, f.state, actor, rootActionId, targetRef, completion);
  assert.equal(prepared.kind, "accepted", JSON.stringify(prepared));
  assert.deepEqual(f.state, before, "preparation is pure");
  const refs = [...new Set([actor, scene, targetRef])].sort();
  const result = (f.runtime?.step ?? step)(f.profiles, f.state, { kind: "completeObjectMechanics", actorCharacterId: actor, rootActionId,
    plan: { schema: "zhuwei.object-mechanics-completion-plan/v1", contextHash: `sha256:${"c".repeat(64)}`,
      readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })), sceneRef: scene, targetRef,
      completion, expectedHash: prepared.afterHash } });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}

// SPEC 0016 §7.2: a missing capacity is filled on one original item without
// changing its sibling or replenishing resources already spent.
test("an item's declared gaps are completed without rebuilding its identity or other instances", () => {
  const definition = healingPotionItemDefinition();
  definition.definitionId = "item-definition:undetermined:instrument";
  Object.assign(definition.content, { stackable: false, use: null, chargesMaximum: 3, durabilityMaximum: null, undeterminedFields: ["durabilityMaximum"] });
  const refs = ["item-entry:undetermined:first", "item-entry:undetermined:second"];
  let f = initialize(undefined, { vNextSeed: { semanticDefinitions: [], entityDefinitionBindings: [], itemDefinitions: [definition],
    itemEntries: refs.map(entryId => ({ definitionRef: definition.definitionId, entry: { entryId, quantity: 1,
      placement: { kind: "held", holderRef: PLAYER, equippedSlot: null }, ownership: { kind: "character", ownerRef: PLAYER } } })) } });
  f = withCombatFixture(f, state => { state.campaignRuntime.itemSystem.entries[refs[0]].charges.current = 1; });
  const original = structuredClone(f.state.campaignRuntime.itemSystem.entries[refs[0]]);
  const content = { ...structuredClone(definition.content), durabilityMaximum: 4, undeterminedFields: [] };
  const result = complete(f, refs[0], { kind: "itemDefinition", content }, "root:native:item");
  const entry = result.state.campaignRuntime.itemSystem.entries[refs[0]];
  assert.equal(entry.entryId, original.entryId); assert.equal(entry.holderRef, original.holderRef);
  assert.equal(entry.charges.current, 1); assert.equal(entry.quantity, 1);
  assert.deepEqual(entry.durability, { maximum: 4, current: 4 });
  assert.equal(result.state.campaignRuntime.itemSystem.entries[refs[1]].durability, null);
  assert.equal(planNativeObjectCompletion(f.profiles, result.state, PLAYER, "root:native:again", refs[0], { kind: "itemDefinition", content }).kind, "rejected");
  assert.equal(planNativeObjectCompletion(f.profiles, f.state, PLAYER, "root:native:overwrite", refs[0], {
    kind: "itemDefinition", content: { ...content, chargesMaximum: 6 } }).kind, "rejected");
  assertReplay(f, result.events, result.state);
  const prior = replay(f.genesis, result.events, { retainCorrectionAudit: true });
  assert.equal(prior.kind, "replayed");
  const corrected = step(f.profiles, prior.state, { kind: "applyServiceCorrection", correctionAuthority: {
    kind: "roomCorrectionAuthority", capability: prior.state.correctionRuntime.authorityCapability },
    correctionId: "correction:native-item", targetReceiptId: result.receipt.receiptId, actorCharacterId: PLAYER,
    errorKind: "rulesMisapplication", publicExplanation: "撤回这次错误补全。", basis: { eventSeq: prior.head.eventSeq, lastEventId: prior.head.lastEventId } });
  assert.equal(corrected.kind, "committed", JSON.stringify(corrected.rejection));
  assert.deepEqual(corrected.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  assertReplay(f, [...result.events, ...corrected.events], corrected.state);
});

test("item completion keeps earlier identification without granting newly filled private mechanics", () => {
  const definition = healingPotionItemDefinition(), ref = "item-entry:known-before-completion";
  definition.visibilityPolicyRef = "visibility:room-authority-only";
  Object.assign(definition.content, { stackable: false, use: null, durabilityMaximum: null, undeterminedFields: ["durabilityMaximum"] });
  const f = initialize(undefined, { vNextSeed: { semanticDefinitions: [], entityDefinitionBindings: [], itemDefinitions: [definition],
    itemEntries: [{ definitionRef: definition.definitionId, entry: { entryId: ref, quantity: 1,
      visibilityPolicyRef: `visibility:character-controller:${PLAYER}`,
      placement: { kind: "held", holderRef: PLAYER, equippedSlot: null }, ownership: { kind: "character", ownerRef: PLAYER } } }] } });
  const identified = step(f.profiles, f.state, inventoryInput(f.state, "root:native:identify", { kind: "identify", entryRef: ref }));
  assert.equal(identified.kind, "committed", JSON.stringify(identified.rejection));
  const result = complete({ ...f, state: identified.state }, ref, { kind: "itemDefinition",
    content: { ...definition.content, durabilityMaximum: 4, undeterminedFields: [] } }, "root:native:private-completion");
  const view = project(f.profiles, result.state, { kind: "player", principalId: PRINCIPAL, sessionVersion: 1, seatId: SEAT, characterId: PLAYER });
  assert.equal(view.kind, "projected");
  const inventory = view.controlledCharacter.inventory.entries.find(entry => entry.entryId === ref);
  assert.equal(inventory.kind, "identified"); assert.equal(inventory.name, definition.content.label);
  assert.equal(inventory.durability, null, "filling a secret definition is not a knowledge acquisition");
  assert.equal(view.visibleItems.find(item => item.itemEntryId === ref).name, definition.content.label);
  const reidentified = step(f.profiles, result.state, inventoryInput(result.state, "root:native:identify-again", { kind: "identify", entryRef: ref }));
  assert.equal(reidentified.kind, "committed", JSON.stringify(reidentified.rejection));
  const current = project(f.profiles, reidentified.state, { kind: "player", principalId: PRINCIPAL, sessionVersion: 1, seatId: SEAT, characterId: PLAYER });
  assert.deepEqual(current.controlledCharacter.inventory.entries.find(entry => entry.entryId === ref).durability, { current: 4, maximum: 4 });
  assertReplay(f, [...identified.events, ...result.events, ...reidentified.events], reidentified.state);
});

test("terrain completion feeds the existing climb rules and cannot change a known material", () => {
  const f = withCombatFixture(initialize(), state => {
    const feature = state.combatRuntime.scenes[SCENE].geometry.obstacles[0];
    feature.height = "120"; feature.landform = "cliff";
  });
  const ref = f.state.combatRuntime.scenes[SCENE].geometry.obstacles[0].featureId;
  assert.equal(terrainCheckRequirement(f.state, PLAYER, ref, "climb").kind, "kp");
  const completion = { kind: "terrain", material: "metal", landform: null, depth: null, current: null };
  const result = complete(f, ref, completion, "root:native:terrain");
  assert.equal(terrainCheckRequirement(result.state, PLAYER, ref, "climb").dc, 20);
  assert.equal(planNativeObjectCompletion(f.profiles, result.state, PLAYER, "root:native:wood", ref, { ...completion, material: "wood" }).kind, "rejected");
  assertReplay(f, result.events, result.state);
});

test("a feature with an existing state graph receives missing durability while preserving its transitions", () => {
  const f = withCombatFixture(initialize(), state => {
    const feature = state.combatRuntime.scenes[SCENE].geometry.obstacles[0];
    const visible = { opaque: feature.opaque, impassable: feature.impassable, cover: feature.cover, propagation: feature.propagation, terrain: feature.terrain };
    feature.stateGraph = { definitionId: "object-state:existing", states: [{ state: feature.state, ...visible }, { state: "shifted", ...visible }],
      transitions: [{ fromState: feature.state, intent: "open", toState: "shifted" }, { fromState: "shifted", intent: "close", toState: feature.state }] };
  });
  const prior = f.state.combatRuntime.scenes[SCENE].geometry.obstacles[0];
  const result = complete(f, prior.featureId, { kind: "durability", armorClass: 15, hitPoints: 12, damageThreshold: 0,
    immuneDamageTypes: ["poison", "psychic"], destroyed: { opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "rubble" } }, "root:native:durability");
  const feature = publicDamageableFeature(result.state, PLAYER, prior.featureId);
  assert.ok(feature); assert.equal(feature.state, prior.state);
  assert.deepEqual(feature.stateGraph.states.find(state => state.state === prior.state), prior.stateGraph.states[0]);
  assert.deepEqual(feature.stateGraph.transitions, prior.stateGraph.transitions);
  assert.equal(feature.durability.current, "12");
  assertReplay(f, result.events, result.state);
});

test("an existing wounded NPC gains executable combat mechanics without restoring hit points", () => {
  const npcRef = "npc:native:guard";
  const f = createAuthoredProbeFixture("native-npc", { npcCharacters: [{ id: npcRef, name: "守卫", mechanical: false,
    abilityScores: { str: 12, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2,
    resources: { "resource:guard-focus": 1 }, resourceMaximums: { "resource:guard-focus": 3 },
    hitPoints: { current: 3, maximum: 11 }, loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] } }] });
  const npc = f.state.entities[npcRef];
  const completion = { kind: "npcCombat", statistics: [{ npcRef, armorClass: npc.loadout.armorClass, speedFeet: npc.loadout.speedFeet,
    hitPointsMaximum: 11, deathPolicy: "deadAtZero", attacks: [{ kind: "meleeAttack", label: "拳击", ability: "str", reachFeet: 5, damage: "1d4+1", damageType: "bludgeoning" }] }] };
  const result = complete(f, npcRef, completion, "root:native:npc", PROBE_ACTOR, PROBE_SCENE);
  assert.equal(result.state.entities[npcRef].hitPoints.current, 3);
  assert.equal(result.state.combatRuntime.entities[npcRef].hitPoints.current, "3");
  assert.equal(result.state.entities[npcRef].resources["resource:guard-focus"], 1);
  assert.equal(planNativeObjectCompletion(f.profiles, f.state, PROBE_ACTOR, "root:native:npc-overwrite", npcRef,
    { ...completion, statistics: [{ ...completion.statistics[0], armorClass: 25 }] }).kind, "rejected");
  assert.ok(result.state.combatRuntime.entities[npcRef].abilityRefs.length);
  assert.equal(planNativeObjectCompletion(f.profiles, result.state, PROBE_ACTOR, "root:native:npc-again", npcRef, completion).kind, "rejected");
  const replayed = f.runtime.replay(f.genesis, result.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed)); assert.deepEqual(replayed.state, result.state);
});

test("the real filling codec and atomic action prepare an existing NPC before starting combat", () => {
  const npcRef = "npc:native:opening-guard";
  const f = createAuthoredProbeFixture("native-start", { npcCharacters: [{ id: npcRef, name: "守卫", mechanical: false,
    abilityScores: { str: 12, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2,
    hitPoints: { current: 3, maximum: 11 }, loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] } }] });
  const requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [PROBE_ACTOR, npcRef], intentText: "我攻击守卫。" }).context;
  assert.ok(proposalCompletableObjectRefs(requiredContext).includes(npcRef));
  const statistics = { npcRef, armorClass: f.state.entities[npcRef].loadout.armorClass, speedFeet: 30, hitPointsMaximum: 11,
    deathPolicy: "deadAtZero", attacks: [{ kind: "meleeAttack", label: "拳击", ability: "str", reachFeet: 5, damage: "1d4+1", damageType: "bludgeoning" }] };
  const bundle = { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "terminal", basisRefs: [], adjudication: null,
    terminal: { kind: "startCombat", participants: [PROBE_ACTOR, npcRef].map(creatureRef => ({ creatureRef, surprise: { kind: "aware" } })),
      hostilities: [{ fromRefs: [PROBE_ACTOR], toRefs: [npcRef] }], combatStatistics: [], description: "调查员向守卫发动攻击。" },
    proposals: [{ kind: "completeObject", definitionRef: npcRef, description: "none", observableState: "none", summary: "补齐守卫尚未确定的战斗属性。",
      mechanics: { kind: "npcCombat", statistics: [statistics] }, basisRefs: [PROBE_SCENE], consumes: [], produces: [], outcomeBinding: "always" }] };
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, requiredContext, value: parsed.bundle });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const waiting = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  lowered.command.rulesInput.steps[0].rulesInput.plan.completion.statistics[0].hitPointsMaximum = 999;
  const rolls = waiting.randomnessRequest.hazardRolls.flatMap(spec => spec.dice.flatMap(die => Array(Number(die.count)).fill(10)));
  const result = f.runtime.step(f.profiles, waiting.state, { kind: "fulfillAuthoritativeRandomness", continuation: waiting.continuation, rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.deepEqual(result.state.entities[npcRef].hitPoints, { current: 3, maximum: 11 });
  assert.ok(result.events.some(event => event.eventType === "ObjectCompletionResolved"));
  const replayed = f.runtime.replay(f.genesis, [...waiting.events, ...result.events]);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed)); assert.deepEqual(replayed.state, result.state);
});

function bundleExecutor(f) {
  const journal = [];
  const execute = (bundle, rootActionId, focusRefs = []) => {
    const requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId, focusRefs: [PROBE_ACTOR, "definition:probe-valve", ...focusRefs] }).context;
    const draft = structuredClone(bundle);
    const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
    assert.deepEqual(bundle, draft, "wire defaults do not modify the source definition or frozen draft");
    assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
    const lowered = lowerVNext2ProposalBundle({ ...f, rootActionId, requiredContext, value: parsed.bundle });
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    let result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
    while (true) {
      assert.notEqual(result.kind, "rejected", JSON.stringify(result.rejection));
      journal.push(...result.events); f.state = result.state;
      if (result.kind !== "awaitingRandomness") break;
      result = stepActionToDecision(f.runtime, f.profiles, f.state, { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
        rolls: result.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(2)) });
    }
    assert.equal(result.kind, "committed");
  };
  return { execute, journal };
}

test("one action authors the missing ability, completes the original item and pays its native use cost", () => {
  const f = createAuthoredProbeFixture("native-item-use");
  const { execute, journal } = bundleExecutor(f);
  const create = itemBundle();
  create.proposals = create.proposals.slice(1, 4);
  create.proposals[0].consumes = [];
  Object.assign(create.proposals[0].source.content, { stackable: false, use: null, chargesMaximum: 3, undeterminedFields: ["use"] });
  create.proposals[1].quantity = 1; create.proposals[2].operation.quantity = 1;
  execute(create, "root:native:create-item");
  const entry = Object.values(f.state.campaignRuntime.itemSystem.entries)[0], entryRef = entry.entryId;
  const content = structuredClone(f.state.campaignRuntime.itemSystem.definitions[entry.definitionRef].content);
  content.use = { kind: "useObject", abilityRef: "prospective:mechanics", quantityCost: 0, chargeCost: 1, durabilityCost: 0 };
  content.undeterminedFields = [];
  const use = itemBundle();
  use.proposals = [use.proposals[0], { kind: "completeObject", definitionRef: entryRef, description: "none", observableState: "none",
    mechanics: { kind: "itemDefinition", content }, basisRefs: ["definition:probe-valve"], consumes: [{ kind: "prospective", handle: "prospective:mechanics" }],
    produces: [], outcomeBinding: "always", summary: "补齐这件原有器物的用途。" }, { ...use.proposals[4], consumes: [], operation: { kind: "use", entryRef, targetRefs: [PROBE_ACTOR] } }];
  execute(use, "root:native:complete-and-use", [entryRef]);
  assert.equal(f.state.entities[PROBE_ACTOR].hitPoints.current, 16);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[entryRef].charges.current, 2);
  assert.deepEqual(Object.keys(f.state.campaignRuntime.itemSystem.entries), [entryRef]);
  assert.equal(journal.filter(event => event.eventType === "ItemUsed").length, 1);
  const replayed = f.runtime.replay(f.genesis, journal);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed.rejection));
  assert.deepEqual(replayed.state, f.state);
});


test("a portable object's missing state is completed and opened through the ordinary action path", () => {
  const f = createAuthoredProbeFixture("native-portable-state"), { execute, journal } = bundleExecutor(f);
  const create = itemBundle(); create.proposals = create.proposals.slice(1, 3); create.adjudication.durationMicros = "0";
  create.proposals[0].consumes = [];
  Object.assign(create.proposals[0].source.content, { stackable: false, use: null, label: "小箱子" });
  create.proposals[1].quantity = 1;
  execute(create, "root:native:portable-create");
  const ref = Object.keys(f.state.campaignRuntime.itemSystem.entries)[0];
  const act = itemBundle(), common = { basisRefs: [PROBE_SCENE], consumes: [], produces: [], outcomeBinding: "always" };
  act.proposals = [{ ...common, kind: "completeObject", definitionRef: ref, description: "none", observableState: "closed",
    mechanics: { armorClass: null, hitPoints: null, opensPassage: false }, summary: "确定原箱盖处于关闭状态。" },
    { ...common, kind: "worldInteraction", sceneRef: PROBE_SCENE, targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: null,
      intent: "打开小箱子。", method: "掀开箱盖。", commonAction: { kind: "operateObject", targetRef: ref, destinationRef: null, option: "open" },
      branches: { success: { outcomeCode: "outcome:opened", summary: "箱盖打开。", effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } }];
  execute(act, "root:native:portable-open", [ref]);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[ref].stateMachine.state, "open");
  const replayed = f.runtime.replay(f.genesis, journal);
  assert.equal(replayed.kind, "replayed"); assert.deepEqual(replayed.state, f.state);
});

test("new container and original contents use typed handles and can be taken in the same action", () => {
  const f = createAuthoredProbeFixture("native-contained-create"), { execute, journal } = bundleExecutor(f);
  const act = itemBundle(), [ , definition, vessel, acquire ] = act.proposals;
  definition.consumes = [];
  Object.assign(definition.source.content, { stackable: false, use: null, label: "容器" });
  vessel.quantity = 1; vessel.initialState = "open";
  const child = structuredClone(vessel);
  child.containerRef = vessel.produces[0].handle;
  child.produces[0].handle = "prospective:child";
  child.consumes.push({ kind: "prospective", handle: vessel.produces[0].handle });
  acquire.operation = { kind: "acquire", entryRef: "prospective:child", quantity: 1 };
  acquire.consumes = [{ kind: "prospective", handle: "prospective:child" }];
  act.proposals = [definition, vessel, child, acquire];
  execute(act, "root:native:contained-create");
  const entries = Object.values(f.state.campaignRuntime.itemSystem.entries);
  assert.equal(entries.length, 2);
  assert.equal(entries.filter(entry => entry.holderRef === PROBE_ACTOR).length, 1);
  const created = journal.filter(event => event.eventType === "ItemMaterialized").map(event => event.payload.entry);
  assert.ok(created.some(entry => entry.containerRef === created[0].entryId));
  const replayed = f.runtime.replay(f.genesis, journal);
  assert.equal(replayed.kind, "replayed"); assert.deepEqual(replayed.state, f.state);
});
