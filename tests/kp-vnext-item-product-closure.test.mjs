import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { itemEntryUseAbilityId } from "../app/_runtime/lib/rules/v2/items.ts";
import { itemBundle } from "./fixtures/vnext-authored-bundles.mjs";

const NPC = "character:item-closure:keeper";

function scenario(name) {
  return { ...createAuthoredProbeFixture(name), events: [], counter: 0 };
}
function record(fixture, result) {
  assert.notEqual(result.kind, "rejected", JSON.stringify(result));
  fixture.state = result.state;
  fixture.events.push(...result.events);
  return result;
}
function settle(fixture, result) {
  record(fixture, result);
  while (result.kind === "awaitingRandomness") {
    const input = result.continuation
      ? { kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
          rolls: result.randomnessRequest.dice.flatMap(term => Array(Number(term.count)).fill(2)) }
      : { kind: "authoritativeRandomness", resolutionId: result.resolutionId,
          responseId: `response:item-closure:${++fixture.counter}`, continuationCapability: result.continuationCapability,
          randomnessResults: result.randomnessRequests.map((request, index) => ({ randomnessId: request.randomnessId,
            requestHash: request.requestHash, draws: request.dice.map(term => ({ sides: Number(term.sides),
              faces: Array(Number(term.count)).fill(Math.min(Number(term.sides), 2 + index * 5)) })) })) };
    result = record(fixture, fixture.runtime.step(fixture.profiles, fixture.state, input));
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}
function replay(fixture) {
  const restored = fixture.runtime.replay(fixture.genesis, fixture.events);
  assert.equal(restored.kind, "replayed", JSON.stringify(restored));
  assert.deepEqual(restored.state, fixture.state);
  fixture.state = restored.state;
}
function executeBundle(fixture, value, actor = ACTOR, selectedItemRef) {
  const rootActionId = `root:item-closure:${++fixture.counter}`;
  const actorFixture = { ...fixture, actorCharacterId: actor };
  // This lifecycle action selects an existing item. Actor context intentionally
  // does not expand every held item; the selected object must enter preparation.
  const frozen = freezeAuthoredProbeContext(actorFixture, fixture.state, { rootActionId, focusRefs: [SOURCE, ACTOR, TARGET,
    ...(selectedItemRef === undefined ? [] : [selectedItemRef]), ...(fixture.state.entities[NPC] ? [NPC] : [])] });
  const lowered = lowerVNext2ProposalBundle({ value, rootActionId, actorCharacterId: actor,
    requiredContext: frozen.context, state: fixture.state });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  return settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput));
}
function inventory(fixture, operation, actor = ACTOR) {
  const value = itemBundle();
  value.proposals = [{ kind: "inventoryOperation", basisRefs: [SOURCE], consumes: [], produces: [],
    outcomeBinding: "always", operation, summary: "The authoritative item changes." }];
  return executeBundle(fixture, value, actor, operation.entryRef);
}
function seedNpc(fixture) {
  // Public native fixture setup; the vNext bundle below only operates an existing NPC.
  const encounterId = "encounter:item-closure:setup";
  settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, {
    kind: "startEncounter", rootActionId: "root:item-closure:setup", proposalAttemptId: "proposal:item-closure:setup",
    encounterId, sceneId: SCENE, participantEntityIds: [ACTOR], battlefieldFactIds: [],
    dynamicEntities: [{ entityId: NPC, name: "Keeper", placement: { position: { x: "300", y: "100", elevation: "0" } },
      initialState: { hitPointsCurrent: "5" },
      mechanics: { kind: "bespokeDefinition", definition: { definitionId: "npc-template:item-closure:keeper", revision: "1",
        definitionKind: "npcMechanicalTemplate", rulesBasis: "srd5.1-2014", causalBasisRefs: [], visibilityPolicyRef: "visibility:scene-observers",
        content: { schema: "zhuwei.npc-mechanical-template/v1", label: "Keeper",
          stats: { str: "10", dex: "10", con: "10", int: "10", wis: "10", cha: "10" }, proficiencyBonus: "2",
          armorClass: "10", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "10", shieldBonus: "0" },
          hitPointsMaximum: "20", footprint: { width: "60", depth: "60", height: "60" }, speedInches: { walk: "360" },
          resourceMaximums: {}, deathPolicy: "deadAtZero", intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
    initiativeGroups: [{ entryId: "initiative:item-closure:actor", combatantEntityIds: [ACTOR] }, { entryId: "initiative:item-closure:npc", combatantEntityIds: [NPC] }],
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NPC] }, { fromEntityIds: [NPC], toEntityIds: [ACTOR] }],
  }));
  let result = record(fixture, fixture.runtime.step(fixture.profiles, fixture.state, { kind: "proposeEncounterConclusion",
    rootActionId: "root:item-closure:peace", encounterId, proposal: { reason: "hostilitiesEnded" } }));
  while (result.kind === "awaitingInput") result = record(fixture, fixture.runtime.step(fixture.profiles, fixture.state,
    { kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId,
      responseId: `response:item-closure:peace:${++fixture.counter}`, answer: { kind: "acceptEncounterConclusion" } }));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  replay(fixture);
}

test("authored charged Item survives NPC transfer, use, break, repair and replay with exact-entry costs", () => {
  const fixture = scenario("item-product-npc");
  seedNpc(fixture);
  const value = itemBundle();
  const definition = value.proposals[1].source.content;
  Object.assign(definition, { label: "Charged vessel", category: "tool", stackable: false,
    chargesMaximum: 3, durabilityMaximum: 4,
    equipment: { allowedSlots: ["main"], twoHanded: false, armor: null, weapon: null } });
  Object.assign(definition.use, { quantityCost: 0, chargeCost: 1, durabilityCost: 2 });
  value.proposals[2].quantity = 1; value.proposals[3].operation.quantity = 1; value.proposals.pop();
  executeBundle(fixture, value);
  const entryRef = Object.keys(fixture.state.campaignRuntime.itemSystem.entries)[0];
  inventory(fixture, { kind: "transfer", entryRef, quantity: 1, targetCharacterRef: NPC, ownershipDisposition: "transferToRecipient" });
  const entry = () => fixture.state.campaignRuntime.itemSystem.entries[entryRef];
  const itemDefinition = fixture.state.campaignRuntime.itemSystem.definitions[entry().definitionRef];
  const abilityRef = itemEntryUseAbilityId(itemDefinition.content.use.abilityRef, entryRef);
  assert.ok(fixture.state.combatRuntime.entities[NPC].abilityRefs.includes(abilityRef), "NPC must receive the authored exact-entry executable");
  inventory(fixture, { kind: "equip", entryRef, action: "wear", slot: "main" }, NPC);
  inventory(fixture, { kind: "use", entryRef, targetRefs: [NPC] }, NPC);
  assert.equal(fixture.state.entities[NPC].hitPoints.current, 11);
  assert.deepEqual(entry().charges, { current: 2, maximum: 3 });
  assert.deepEqual(entry().durability, { current: 2, maximum: 4 });
  inventory(fixture, { kind: "use", entryRef, targetRefs: [NPC] }, NPC);
  assert.equal(entry().condition, "broken");
  assert.equal(entry().equippedSlot, null);
  assert.equal(fixture.state.combatRuntime.entities[NPC].abilityRefs.includes(abilityRef), false);
  replay(fixture);
  inventory(fixture, { kind: "lifecycle", entryRef, action: "repair" }, NPC);
  assert.equal(entry().charges.current, 1, "repair restores durability, never replenishes charges");
  assert.equal(entry().durability.current, 4);
  assert.ok(fixture.state.combatRuntime.entities[NPC].abilityRefs.includes(abilityRef));
  inventory(fixture, { kind: "use", entryRef, targetRefs: [NPC] }, NPC);
  assert.equal(entry().charges.current, 0);
  assert.equal(entry().quantity, 1);
  assert.equal(entry().ownership.ownerRef, NPC);
  assert.equal(fixture.events.filter(event => event.eventType === "ItemUsed").length, 3);
  replay(fixture);
});

test("a stackable authored consumable splits ownership and exhausts only the used recipient entry", () => {
  const fixture = scenario("item-product-stack");
  const value = itemBundle(); value.proposals.pop();
  executeBundle(fixture, value);
  const entryRef = Object.keys(fixture.state.campaignRuntime.itemSystem.entries)[0];
  inventory(fixture, { kind: "transfer", entryRef, quantity: 1, targetCharacterRef: TARGET, ownershipDisposition: "transferToRecipient" });
  const recipient = Object.values(fixture.state.campaignRuntime.itemSystem.entries).find(entry => entry.holderRef === TARGET);
  assert.notEqual(recipient.entryId, entryRef);
  inventory(fixture, { kind: "use", entryRef, targetRefs: [ACTOR] });
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "consumed");
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[recipient.entryId].quantity, 1);
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[recipient.entryId].ownership.ownerRef, TARGET);
  replay(fixture);
  const projected = fixture.runtime.project(fixture.profiles, fixture.state, { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: TARGET });
  assert.equal(projected.kind, "projected");
  assert.ok(projected.controlledCharacter.inventory.entries.some(entry => entry.entryId === recipient.entryId && entry.kind === "identified"));
});

function attemptBundle(fixture, value, actor = ACTOR) {
  const rootActionId = `root:item-closure:${++fixture.counter}`;
  const frozen = freezeAuthoredProbeContext({ ...fixture, actorCharacterId: actor }, fixture.state, { rootActionId, focusRefs: [SOURCE, ACTOR, TARGET] });
  const lowered = lowerVNext2ProposalBundle({ value, rootActionId, actorCharacterId: actor, requiredContext: frozen.context, state: fixture.state });
  return lowered.kind === "accepted" ? fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput) : lowered;
}
function viewer(fixture, characterId) {
  const suffix = characterId === ACTOR ? "actor" : "target";
  const projected = fixture.runtime.project(fixture.profiles, fixture.state, { kind: "player", principalId: `principal:probe-${suffix}`, seatId: `seat:probe-${suffix}`, sessionVersion: 1, characterId });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}

test("a unique canonical source cannot rematerialize under another root or definition after destruction", () => {
  const fixture = scenario("item-product-unique");
  const basisRef = "fact:item-closure:only-vessel";
  settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, { kind: "declareCanonicalFact", proposalId: "root:item-closure:identity-fact",
    fact: { factId: basisRef, factKind: "uniqueWorldObject", subjectRefs: [SOURCE], value: { description: "Exactly one vessel occupies this sealed source." },
      source: "dynamicMaterialization", visibilityPolicy: "public", causalParentIds: [] } }));
  const value = itemBundle(); value.proposals.pop();
  value.proposals[2].quantity = 1; value.proposals[3].operation.quantity = 1;
  value.proposals[2].uniquenessBasisRef = basisRef;
  value.proposals[1].source.content.stackable = false;
  executeBundle(fixture, value);
  const entryRef = fixture.state.vNextItemAuthority.uniqueItems[basisRef].entryRef;
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 1);
  const repeated = attemptBundle(fixture, value);
  assert.equal(repeated.kind, "rejected", JSON.stringify(repeated)); assert.deepEqual(repeated.events, []);
  inventory(fixture, { kind: "lifecycle", entryRef, action: "destroy" });
  replay(fixture);
  const changed = structuredClone(value); changed.proposals[1].source.content.label = "Renamed vessel";
  const respawn = attemptBundle(fixture, changed);
  assert.equal(respawn.kind, "rejected", JSON.stringify(respawn)); assert.deepEqual(respawn.events, []);
  assert.equal(fixture.state.vNextItemAuthority.uniqueItems[basisRef].entryRef, entryRef);
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "destroyed");
  const forged = structuredClone(value); forged.proposals[2].uniquenessBasisRef = SOURCE;
  assert.equal(attemptBundle(fixture, forged).kind, "rejected", "spatial definitions are not unique canonical sources");
});

test("identification grants exact Item knowledge to one viewer while transfer preserves knowledge without sharing it", () => {
  const fixture = scenario("item-product-identify");
  const value = itemBundle(); value.proposals.pop();
  value.proposals[0].source.content.label = "Secret restorative mechanism";
  value.proposals[1].source.content.label = "Vaultflower essence";
  value.proposals[1].source.content.description = "The hidden formula restores vitality.";
  value.proposals[1].visibilityPolicyRef = "visibility:hidden-until-evidence";
  executeBundle(fixture, value);
  const entryRef = Object.keys(fixture.state.campaignRuntime.itemSystem.entries)[0];
  const before = viewer(fixture, ACTOR);
  assert.ok(before.controlledCharacter.inventory.entries.some(entry => entry.entryId === entryRef && entry.kind === "opaque" && entry.quantity === 2));
  assert.doesNotMatch(JSON.stringify(before), /Vaultflower|hidden formula|Secret restorative mechanism/);
  assert.equal(before.controlledCharacter.combat.abilityRefs.some(ref => ref.endsWith(entryRef)), false);
  assert.equal(Object.hasOwn(before.controlledCharacter.combat.resources, entryRef), false);
  const priorState = fixture.state;
  const identifiedResult = inventory(fixture, { kind: "identify", entryRef });
  const query = { committedRange: { receiptId: identifiedResult.receipt.receiptId, actorCharacterId: ACTOR, priorState, events: identifiedResult.events } };
  const claimsForActor = fixture.runtime.project(fixture.profiles, fixture.state, fixture.viewer, query);
  assert.equal(claimsForActor.kind, "projected", JSON.stringify(claimsForActor));
  assert.match(JSON.stringify(claimsForActor), /Vaultflower essence/);
  const claimsForOther = fixture.runtime.project(fixture.profiles, fixture.state, { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: TARGET }, query);
  assert.equal(claimsForOther.kind, "projected", JSON.stringify(claimsForOther));
  assert.doesNotMatch(JSON.stringify(claimsForOther), /Vaultflower|hidden formula|Secret restorative mechanism/);
  const identified = viewer(fixture, ACTOR).controlledCharacter.inventory.entries.find(entry => entry.entryId === entryRef);
  assert.equal(identified.kind, "identified"); assert.equal(identified.name, "Vaultflower essence");
  const grant = fixture.state.vNextItemAuthority.identifications[ACTOR][entryRef];
  inventory(fixture, { kind: "transfer", entryRef, quantity: 2, targetCharacterRef: TARGET, ownershipDisposition: "transferToRecipient" });
  const recipient = viewer(fixture, TARGET);
  assert.equal(recipient.controlledCharacter.inventory.entries.find(entry => entry.entryId === entryRef).kind, "opaque");
  assert.doesNotMatch(JSON.stringify(recipient), /Vaultflower|hidden formula|Secret restorative mechanism/);
  assert.equal(viewer(fixture, ACTOR).itemKnowledge.find(entry => entry.entryRef === entryRef).name, "Vaultflower essence");
  replay(fixture);
  assert.deepEqual(fixture.state.vNextItemAuthority.identifications[ACTOR][entryRef], grant);
  inventory(fixture, { kind: "lifecycle", entryRef, action: "destroy" }, TARGET);
  assert.deepEqual(fixture.state.vNextItemAuthority.identifications[ACTOR][entryRef], grant);
  assert.equal(viewer(fixture, ACTOR).itemKnowledge.find(entry => entry.entryRef === entryRef).name, "Vaultflower essence");
  replay(fixture);
});

test("authored item counters, executable and typed knowledge survive rest and chapter change", () => {
  const fixture = scenario("item-product-continuity");
  const value = itemBundle();
  const content = value.proposals[1].source.content;
  content.stackable = false; content.chargesMaximum = 3; content.durabilityMaximum = 6;
  Object.assign(content.use, { quantityCost: 0, chargeCost: 1, durabilityCost: 2 });
  value.proposals[2].quantity = 1; value.proposals[3].operation.quantity = 1;
  executeBundle(fixture, value);
  const entryRef = Object.keys(fixture.state.campaignRuntime.itemSystem.entries)[0];
  inventory(fixture, { kind: "identify", entryRef });
  const entryBefore = structuredClone(fixture.state.campaignRuntime.itemSystem.entries[entryRef]);
  const knowledgeBefore = structuredClone(fixture.state.vNextItemAuthority.identifications[ACTOR][entryRef]);
  const rest = settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, { kind: "startRest", proposalId: "root:item-closure:rest",
    characterId: ACTOR, restKind: "short", intendedDurationMicros: "3600000000", hitDiceToSpend: 0, arcaneRecoverySlotLevels: [] }));
  const activityId = rest.events.find(event => event.eventType === "RestStarted").payload.activityId;
  settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, { kind: "resolveFreeAction", proposalId: "root:item-closure:rest-time", characterId: ACTOR,
    goal: "Complete the quiet rest", method: "Wait through the established hour", feasibility: { kind: "directSuccess", publicBasis: "No interruption occurs during this hour." },
    outcome: { publicResult: "The hour passes.", fictionTimeCostMicros: "3600000000" } }));
  settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, { kind: "completeActivity", proposalId: "root:item-closure:rest-complete", activityId }));
  const chapter = settle(fixture, fixture.runtime.step(fixture.profiles, fixture.state, { kind: "transitionChapter", proposalId: "root:item-closure:next-chapter",
    campaignId: fixture.state.campaignRuntime.campaign.campaignId, fromChapterId: "chapter:opening", toChapterId: "chapter:item-closure:two", ordinal: "2",
    reason: "The scene question is resolved.", continuityPolicy: "preserveAuthoritativeFacts", storyAnchorRefs: [], sceneQuestion: "What follows from these choices?", activityTransitions: [] }));
  const manifest = chapter.events.find(event => event.eventType === "ChapterContinuityRecorded").payload.manifest;
  assert.ok(manifest.itemStates.some(item => item.ref === `item:${entryRef}`));
  assert.ok(manifest.knowledgeStates.some(item => item.ref === `item-knowledge:${ACTOR}:${entryRef}`));
  assert.deepEqual(fixture.state.campaignRuntime.itemSystem.entries[entryRef], entryBefore);
  assert.deepEqual(fixture.state.vNextItemAuthority.identifications[ACTOR][entryRef], knowledgeBefore);
  replay(fixture);
  inventory(fixture, { kind: "use", entryRef, targetRefs: [ACTOR] });
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[entryRef].charges.current, 1);
  assert.equal(fixture.state.campaignRuntime.itemSystem.entries[entryRef].durability.current, 2);
  replay(fixture);
});
