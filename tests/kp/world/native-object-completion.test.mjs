import assert from "node:assert/strict";
import test from "node:test";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { planNativeObjectCompletion } from "../../../app/_runtime/lib/rules/v2/native-object-completion.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { healingPotionItemDefinition, itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
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
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";

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

// SPEC 0016 §7.3: grouped filling positions are never execution precedence.
function nativeContainerFixture(caseId) {
  const f = createAuthoredProbeFixture(caseId), runner = bundleExecutor(f);
  const create = itemBundle(), [, definition, vessel, acquire] = create.proposals;
  definition.consumes = [];
  Object.assign(definition.source.content, { stackable: false, use: null, label: '小箱' });
  vessel.quantity = 1; vessel.initialState = 'closed'; acquire.operation.quantity = 1;
  const child = structuredClone(vessel); child.initialState = 'absent';
  child.containerRef = vessel.produces[0].handle; child.produces[0].handle = 'prospective:contents';
  child.consumes.push({ kind: 'prospective', handle: vessel.produces[0].handle });
  create.proposals = [definition, vessel, child, acquire];
  runner.execute(create, `root:${caseId}:create`);
  const entries = Object.values(f.state.campaignRuntime.itemSystem.entries);
  return { f, ...runner, container: entries.find(entry => !entry.containerRef).entryId,
    child: entries.find(entry => entry.containerRef).entryId };
}
function operateContainer(ref, option) {
  return { kind: 'worldInteraction', sceneRef: PROBE_SCENE, targetRefs: [ref], directTargetRefs: [ref], instrumentRefs: [], abilityRef: null,
    commonAction: { kind: 'operateObject', targetRef: ref, destinationRef: null, option }, intent: '操作原箱盖。', method: '按实际开合方式操作。',
    basisRefs: [ref], consumes: [], produces: [], outcomeBinding: 'always',
    branches: { success: { outcomeCode: 'outcome:container', summary: '箱盖操作完成。', effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } };
}
test('closed container opens, releases original contents and closes in one timed grouped action', () => {
  const { f, execute, journal, container, child } = nativeContainerFixture('native-closed-container');
  const act = itemBundle();
  const take = { ...act.proposals[3], consumes: [], basisRefs: [container, child], operation: { kind: 'acquire', entryRef: child, quantity: 1 } };
  // Even reversed world-group rows are ordered from the original state graph.
  act.proposals = [take, operateContainer(container, 'close'), operateContainer(container, 'open')];
  execute(act, 'root:native:closed-open-take-close', [container, child]);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[child].containerRef, undefined);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[child].holderRef, PROBE_ACTOR);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[container].stateMachine.state, 'closed');
  const operations = journal.filter(event => event.rootActionId.includes('closed-open-take-close')
    && ['ItemStateTransitioned', 'InventoryOperationApplied'].includes(event.eventType));
  assert.deepEqual(operations.map(event => event.eventType === 'ItemStateTransitioned' ? event.payload.intent : event.payload.operation.kind), ['open', 'acquire', 'close']);
  assert.deepEqual(f.runtime.replay(f.genesis, journal).state, f.state);
});
// SPEC 0001 §17, SPEC 0011 §7: correcting the physical operation also
// corrects its inspection, without rebuilding it from the restored stock.
test('an audited correction restores container contents and the exact prior inspection record', () => {
  const { f, execute, journal, container, child } = nativeContainerFixture('container-inspection-correction');
  const beforeItems = structuredClone(f.state.campaignRuntime.itemSystem);
  const beforeAuthority = structuredClone(f.state.vNextItemAuthority);
  const act = itemBundle();
  act.proposals = [operateContainer(container, 'open'), { ...act.proposals[3], consumes: [], basisRefs: [container, child],
    operation: { kind: 'acquire', entryRef: child, quantity: 1 } }, operateContainer(container, 'close')];
  const root = 'root:native:wrong-container-inspection';
  execute(act, root, [container, child]);
  const prior = f.runtime.replay(f.genesis, journal, { retainCorrectionAudit: true });
  assert.equal(prior.kind, 'replayed', JSON.stringify(prior));
  const corrected = f.runtime.step(f.profiles, prior.state, { kind: 'applyServiceCorrection', correctionAuthority: {
    kind: 'roomCorrectionAuthority', capability: prior.state.correctionRuntime.authorityCapability },
    correctionId: 'correction:wrong-container-inspection', targetReceiptId: prior.state.receipts[root].receiptId,
    actorCharacterId: PROBE_ACTOR, errorKind: 'rulesMisapplication', publicExplanation: '撤回这次错误的开箱取物。',
    basis: { eventSeq: prior.head.eventSeq, lastEventId: prior.head.lastEventId } });
  assert.equal(corrected.kind, 'committed', JSON.stringify(corrected.rejection));
  assert.deepEqual(corrected.state.campaignRuntime.itemSystem, beforeItems);
  assert.deepEqual(corrected.state.vNextItemAuthority, beforeAuthority);
  assert.deepEqual(f.runtime.replay(f.genesis, [...journal, ...corrected.events]).state, corrected.state);
  f.state = corrected.state; journal.push(...corrected.events);
  act.proposals = [operateContainer(container, 'open')];
  execute(act, 'root:native:corrected-container-use', [container]);
  const resumed = f.runtime.replay(f.genesis, journal);
  assert.equal(resumed.kind, 'replayed', JSON.stringify(resumed));
  assert.deepEqual(resumed.state, f.state);
  assert.equal(f.state.vNextItemAuthority.containerMemories[PROBE_ACTOR][container].entries[0].entryId, child);
});
test('opening for storage uses the same container dependency path and does not repair a damaged vessel', () => {
  const { f, execute, container, child } = nativeContainerFixture('native-damaged-container');
  const act = itemBundle();
  const take = { ...act.proposals[3], consumes: [], basisRefs: [container, child], operation: { kind: 'acquire', entryRef: child, quantity: 1 } };
  act.proposals = [operateContainer(container, 'open'), take]; execute(act, 'root:native:take-original', [container, child]);
  act.proposals = [{ ...take, basisRefs: [container], operation: { kind: 'lifecycle', entryRef: container, action: 'break', containerStateAfter: 'locked' } }];
  execute(act, 'root:native:damage-lock', [container]);
  act.proposals = [{ ...take, operation: { kind: 'store', entryRef: child, quantity: 1, containerRef: container } }, operateContainer(container, 'open')];
  execute(act, 'root:native:force-and-store', [container, child]);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[container].condition, 'broken');
  assert.equal(f.state.campaignRuntime.itemSystem.entries[container].stateMachine.state, 'open');
  assert.equal(f.state.campaignRuntime.itemSystem.entries[child].containerRef, container);
});

// SPEC 0016 §7.2: inapplicable depth/current cannot offer an impossible form.
test('terrain offers include only undecided applicable dimensions', () => {
  for (const [landform, material, depth, current, offered] of [
    ['cliff', 'stone', undefined, undefined, false], ['ditch', 'earth', '24', undefined, false],
    ['water', 'earth', '24', 'still', false], ['water', 'earth', '24', undefined, true],
    ['cliff', undefined, undefined, undefined, true],
  ]) {
    const fields = Object.fromEntries(Object.entries({ landform, material, depth, current }).filter(([, value]) => value !== undefined));
    const hollow = ['ditch', 'water'].includes(landform);
    if (landform === 'water') fields.current = current ?? 'still';
    const f = createAuthoredProbeFixture(`terrain-offer-${landform}-${offered}`, { featureOverrides: { kind: 'terrain', impassable: hollow, ...fields } });
    const ref = 'feature:probe-valve';
    if (landform === 'water' && current === undefined) delete f.state.combatRuntime.scenes[PROBE_SCENE].geometry.obstacles[0].current;
    const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [ref] }).context;
    assert.equal(proposalCompletableObjectRefs(context, 'terrain').includes(ref), offered, `${landform}/${material}/${depth}/${current}`);
  }
});

function tryCreatingContents(f, container, definitionRef, rootActionId, sourceRef) {
  const act = itemBundle(); act.adjudication.durationMicros = '0';
  act.proposals = [{ ...act.proposals[2], definitionRef, containerRef: container, quantity: 1, consumes: [],
    basisRefs: [container, definitionRef, ...(sourceRef ? [sourceRef] : [])],
    ...(sourceRef ? { uniquenessBasisRef: sourceRef } : {}),
    produces: [{ handle: 'prospective:additional', kind: 'itemEntry', outcomeBinding: 'always' }] }];
  const requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId, focusRefs: [container, definitionRef, ...(sourceRef ? [sourceRef] : [])] }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(act)));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, rootActionId, requiredContext, value: parsed.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  return stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
}
// SPEC 0001 §§7、16: creation permission does not replenish personal resources.
test('ordinary starting backpacks need no opening and cannot receive invented original contents', () => {
  const definition = itemDefinitionFromStandardGear(itemById('backpack'));
  const f = createAuthoredProbeFixture('personal-bag-source', { itemDefinitions: [definition], itemEntries: [{ definitionRef: definition.definitionId,
    entry: { entryId: 'item-entry:personal:bag', quantity: 1, placement: { kind: 'held', holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: 'character', ownerRef: PROBE_ACTOR } } }] });
  const bag = Object.values(f.state.campaignRuntime.itemSystem.entries)[0];
  assert.equal(bag.stateMachine, null);
  const before = structuredClone(f.state);
  const result = tryCreatingContents(f, bag.entryId, bag.definitionRef, 'root:native:invent-personal-content');
  assert.equal(result.kind, 'rejected');
  assert.equal(result.rejection.message, 'container:player-held-content-source-required');
  assert.deepEqual(f.state, before);
});
test('a personal bag can materialize one prior container-bound source before inspection without duplicating it', () => {
  const bagDefinition = itemDefinitionFromStandardGear(itemById('backpack'));
  const contents = healingPotionItemDefinition();
  Object.assign(contents.content, { stackable: false, use: null });
  const container = 'item-entry:sourced:bag', sourceRef = 'fact:sourced:original-item';
  const f = createAuthoredProbeFixture('personal-bag-fixed-source', { itemDefinitions: [bagDefinition, contents],
    itemEntries: [{ definitionRef: bagDefinition.definitionId, entry: { entryId: container, quantity: 1,
      placement: { kind: 'held', holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: 'character', ownerRef: PROBE_ACTOR } } }] });
  const source = createEventTransition(f.state, f.profiles, { rootActionId: 'root:native:declare-original-source',
    eventType: 'CanonicalFactDeclared', payload: { fact: { id: sourceRef, kind: 'originalContainerItem',
      subjectRefs: [container, contents.definitionId], value: { quantity: 1 }, visibilityPolicyId: 'visibility:room-authority-only',
      source: 'moduleAnchor', causalParentIds: [] } }, visibilityPolicyId: 'visibility:room-authority-only', secrecy: 'internal' });
  f.state = source.state;
  const beforeItems = structuredClone(f.state.campaignRuntime.itemSystem);
  const beforeAuthority = structuredClone(f.state.vNextItemAuthority);
  const result = tryCreatingContents(f, container, contents.definitionId, 'root:native:sourced-personal-content', sourceRef);
  assert.equal(result.kind, 'committed', JSON.stringify(result.rejection));
  f.state = result.state;
  const created = Object.values(f.state.campaignRuntime.itemSystem.entries).filter(entry => entry.containerRef === container);
  assert.equal(created.length, 1); assert.equal(created[0].quantity, 1);
  assert.equal(f.state.vNextItemAuthority.uniqueItems[sourceRef].entryRef, created[0].entryId);
  assert.equal(tryCreatingContents(f, container, contents.definitionId, 'root:native:repeat-sourced-content', sourceRef).kind, 'rejected');
  assert.deepEqual(f.runtime.replay(f.genesis, [source.event, ...result.events]).state, f.state);
  const history = [source.event, ...result.events];
  const prior = f.runtime.replay(f.genesis, history, { retainCorrectionAudit: true });
  const corrected = f.runtime.step(f.profiles, prior.state, { kind: 'applyServiceCorrection', correctionAuthority: {
    kind: 'roomCorrectionAuthority', capability: prior.state.correctionRuntime.authorityCapability },
    correctionId: 'correction:sourced-personal-content', targetReceiptId: result.receipt.receiptId,
    actorCharacterId: PROBE_ACTOR, errorKind: 'rulesMisapplication', publicExplanation: '撤回这次错误的内容物化。',
    basis: { eventSeq: prior.head.eventSeq, lastEventId: prior.head.lastEventId } });
  assert.equal(corrected.kind, 'committed', JSON.stringify(corrected.rejection));
  assert.deepEqual(corrected.state.campaignRuntime.itemSystem, beforeItems);
  assert.deepEqual(corrected.state.vNextItemAuthority, beforeAuthority);
  f.state = corrected.state;
  const retried = tryCreatingContents(f, container, contents.definitionId, 'root:native:corrected-sourced-content', sourceRef);
  assert.equal(retried.kind, 'committed', JSON.stringify(retried.rejection));
  const restored = f.runtime.replay(f.genesis, [...history, ...corrected.events, ...retried.events]);
  assert.equal(restored.kind, 'replayed', JSON.stringify(restored));
  assert.deepEqual(restored.state, retried.state);
});
test('fixed original contents cannot be regenerated on a later action or after an empty inspection', () => {
  const { f, execute, container, child } = nativeContainerFixture('fixed-container-source');
  const definitionRef = f.state.campaignRuntime.itemSystem.entries[child].definitionRef;
  assert.equal(tryCreatingContents(f, container, definitionRef, 'root:native:repeat-contents').kind, 'rejected');
  const act = itemBundle(); act.proposals = [operateContainer(container, 'open'), { ...act.proposals[3], consumes: [],
    basisRefs: [container, child], operation: { kind: 'acquire', entryRef: child, quantity: 1 } }, operateContainer(container, 'close')];
  execute(act, 'root:native:empty-container', [container, child]);
  const before = structuredClone(f.state);
  const result = tryCreatingContents(f, container, definitionRef, 'root:native:refill-inspected-empty');
  assert.equal(result.kind, 'rejected');
  assert.equal(result.rejection.message, 'container:original-contents-already-fixed');
  assert.deepEqual(f.state, before);
});

test('container context carries only the acting character inspection and binds the full authority version', () => {
  const { f, execute, container } = nativeContainerFixture('container-context-privacy');
  const act = itemBundle(); act.proposals = [operateContainer(container, 'open'), operateContainer(container, 'close')];
  execute(act, 'root:native:inspect-for-context', [container]);
  const own = f.state.vNextItemAuthority.containerMemories[PROBE_ACTOR][container];
  f.state.vNextItemAuthority.containerMemories['character:probe-target'] = { [container]: {
    ...structuredClone(own), observerRef: 'character:probe-target', entries: [{ entryId: 'item-entry:private:memory', quantity: 1, condition: 'usable', name: '另一角色的私密记录' }] } };
  const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: 'root:native:remember-only-self', focusRefs: [container] }).context;
  const entry = context.entries.find(entry => entry.entryRef === container);
  assert.deepEqual(entry.value.containerMemories, [own]);
  assert.equal(entry.revisionOrHash, authorityRevisionOrHash(f.state, container));
  assert.ok(!JSON.stringify(context).includes('另一角色的私密记录'));
});

test('uninspected world loot retains an auditable origin for exactly one original-content materialization', () => {
  const f = createAuthoredProbeFixture('uninspected-world-loot'), { execute, journal } = bundleExecutor(f);
  const create = itemBundle(), [, definition, vessel, acquire] = create.proposals;
  definition.consumes = []; Object.assign(definition.source.content, { stackable: false, use: null, label: '战利品箱' });
  vessel.quantity = 1; vessel.initialState = 'closed'; acquire.operation.quantity = 1;
  create.proposals = [definition, vessel, acquire]; execute(create, 'root:native:acquire-uninspected-loot');
  const box = Object.values(f.state.campaignRuntime.itemSystem.entries)[0];
  assert.equal(f.state.vNextItemAuthority.containerOrigins[box.entryId].sourceRef, PROBE_SCENE);
  const first = tryCreatingContents(f, box.entryId, box.definitionRef, 'root:native:fix-original-loot');
  assert.equal(first.kind, 'committed', JSON.stringify(first.rejection));
  f.state = first.state; journal.push(...first.events);
  assert.equal(Object.values(f.state.campaignRuntime.itemSystem.entries).filter(entry => entry.containerRef === box.entryId).length, 1);
  assert.equal(tryCreatingContents(f, box.entryId, box.definitionRef, 'root:native:repeat-original-loot').kind, 'rejected');
  assert.deepEqual(f.runtime.replay(f.genesis, journal).state, f.state);
});

test('an ordinary bag can be explicitly sealed and reopened without completion, recreation or changing its contents', () => {
  const definition = itemDefinitionFromStandardGear(itemById('backpack'));
  const f = createAuthoredProbeFixture('ordinary-bag-sealing', { itemDefinitions: [definition], itemEntries: [{ definitionRef: definition.definitionId,
    entry: { entryId: 'item-entry:seal:bag', quantity: 1, placement: { kind: 'held', holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: 'character', ownerRef: PROBE_ACTOR } } }] });
  const { execute, journal } = bundleExecutor(f), bag = 'item-entry:seal:bag';
  const act = itemBundle(); act.proposals = [operateContainer(bag, 'close')]; execute(act, 'root:native:seal-bag', [bag]);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[bag].stateMachine.state, 'closed');
  assert.deepEqual(f.state.vNextItemAuthority.containerMemories[PROBE_ACTOR][bag].entries, []);
  act.proposals = [operateContainer(bag, 'open')]; execute(act, 'root:native:reopen-bag', [bag]);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[bag].stateMachine.state, 'open');
  assert.equal(Object.keys(f.state.campaignRuntime.itemSystem.entries).length, 1);
  const restored = f.runtime.replay(f.genesis, journal);
  assert.equal(restored.kind, "replayed", JSON.stringify(restored));
  assert.deepEqual(restored.state, f.state);
});

test('a newly fixed closed container is opened and its original item taken in the same real timed action', () => {
  const f = createAuthoredProbeFixture('fresh-closed-container'), { execute, journal } = bundleExecutor(f);
  const act = itemBundle(), [, definition, vessel, acquire] = act.proposals;
  definition.consumes = []; Object.assign(definition.source.content, { stackable: false, use: null, label: '封闭箱' });
  vessel.quantity = 1; vessel.initialState = 'closed';
  const child = structuredClone(vessel); child.initialState = 'absent'; child.containerRef = vessel.produces[0].handle;
  child.produces[0].handle = 'prospective:inside'; child.consumes.push({ kind: 'prospective', handle: vessel.produces[0].handle });
  acquire.operation = { kind: 'acquire', entryRef: 'prospective:inside', quantity: 1 }; acquire.consumes = [{ kind: 'prospective', handle: 'prospective:inside' }];
  const open = operateContainer(vessel.produces[0].handle, 'open'); open.basisRefs = ['definition:probe-valve'];
  open.consumes = [{ kind: 'prospective', handle: vessel.produces[0].handle }];
  act.proposals = [definition, vessel, child, acquire, open];
  execute(act, 'root:native:new-closed-open-take');
  const created = journal.filter(event => event.eventType === 'ItemMaterialized').map(event => event.payload.entry);
  assert.equal(created.length, 2);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[created[0].entryId].stateMachine.state, 'open');
  assert.equal(f.state.campaignRuntime.itemSystem.entries[created[1].entryId].holderRef, PROBE_ACTOR);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[created[1].entryId].containerRef, undefined);
  assert.deepEqual(f.runtime.replay(f.genesis, journal).state, f.state);
});
