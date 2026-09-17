// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createInitialItemEntry, healingPotionItemDefinition, itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { stepInventoryOperation, createInventoryAdjudicationGrant } from "../../../app/_runtime/lib/rules/v2/inventory-operations.ts";
import { step, project, PLAYER, PRINCIPAL, SEAT, RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, SCENE, initialize, inventoryInput, materialize, apply, assertReplay } from '../../support/fixtures/inventory-operations.mjs';



test("partial Rules transfer freezes the recipient exact-entry Ability and only merges matching ownership", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, healingPotionItemDefinition(), 5);
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const transferred = apply(scenario, initial, "partial-transfer", { kind: "transfer", entryRef, quantity: 2,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" });
  const destination = transferred.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
  assert.notEqual(destination, entryRef);
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 3);
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[destination].quantity, 2);
  assert.ok(transferred.state.combatRuntime.entities[RECIPIENT].abilityRefs.some((ref) => ref.endsWith(destination)));
  const merged = apply(scenario, transferred, "partial-transfer-merge", { kind: "transfer", entryRef, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" });
  assert.equal(merged.state.campaignRuntime.itemSystem.entries[destination].quantity, 3);
  const owned = apply(scenario, merged, "partial-transfer-owner", { kind: "transfer", entryRef, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "transferToRecipient" });
  const newDestination = owned.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
  assert.notEqual(newDestination, destination);
  assert.equal(owned.state.campaignRuntime.itemSystem.entries[newDestination].ownership.ownerRef, RECIPIENT);
  assertReplay(scenario, [...initial.events, ...transferred.events, ...merged.events, ...owned.events], owned.state);
});



test("only a successful same-root shared check grants a foreign-held transfer and replay verifies its proof", () => {
  const definition = itemDefinitionFromStandardGear(itemById("longsword"));
  const entry = createInitialItemEntry(definition, { entryId: "item-entry:inventory:contested-blade", quantity: 1,
    placement: { kind: "held", holderRef: PLAYER, equippedSlot: null }, ownership: { kind: "character", ownerRef: PLAYER },
    visibilityPolicyRef: "visibility:public" });
  const scenario = initialize(VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, { includeRecipient: true,
    vNextSeed: { semanticDefinitions: [], itemDefinitions: [definition], itemEntries: [{ definitionRef: definition.definitionId, entry: {
      entryId: entry.entryId, quantity: 1, placement: { kind: "held", holderRef: PLAYER, equippedSlot: null },
      ownership: entry.ownership, visibilityPolicyRef: "visibility:public" } }], entityDefinitionBindings: [] } });
  const rootActionId = "root:inventory:contested-transfer";
  const contextHash = `sha256:${"c".repeat(64)}`;
  const refs = [RECIPIENT, PLAYER, SCENE, entry.entryId].sort();
  const branch = (outcomeCode) => ({ outcomeCode, summary: "冻结裁决结果", effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
  const plan = { schema: "zhuwei.world-interaction-resolution-plan/v1", resolutionId: "resolution:inventory:contest",
    interactionRef: "interaction:inventory:contest", actorCharacterId: RECIPIENT, sceneRef: SCENE, abilityRef: null, contextHash,
    readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(scenario.state, ref) })),
    targetRefs: [entry.entryId], directTargetRefs: [entry.entryId], instrumentRefs: [], basisRefs: [entry.entryId],
    intent: "取回手中的物品", method: "准确把握松手的时机", costs: [],
    ruling: { kind: "check", resolutionKind: "abilityCheck", randomnessId: "randomness:inventory:contest",
      check: { kind: "skill", ability: "dexterity", skill: "sleight", dc: "10", modifier: "2", mode: "normal", costs: [],
        goal: "取得物品", method: "把握时机", risk: "未能拿到", successOutcome: "取得物品", failureOutcome: "物品保持原状" } },
    branches: { success: branch("inventory:success"), failure: branch("inventory:failure") } };
  const waiting = step(scenario.profiles, scenario.state, { kind: "resolveWorldInteraction", rootActionId, actorCharacterId: RECIPIENT, plan });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const resolved = step(scenario.profiles, waiting.state, { kind: "fulfillAuthoritativeRandomness", continuation: waiting.continuation, rolls: [20] });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  const event = resolved.events.find((event) => event.eventType === "WorldInteractionResolved");
  const binding = { rootActionId, actorCharacterId: RECIPIENT, contextHash, outcomeBinding: "onSuccess" };
  const grant = createInventoryAdjudicationGrant(resolved.state, event, binding);
  assert.ok(grant);
  assert.equal(createInventoryAdjudicationGrant(resolved.state, event, { ...binding, rootActionId: "root:unrelated" }), undefined);
  assert.equal(createInventoryAdjudicationGrant(resolved.state, event, { ...binding, outcomeBinding: "always" }), undefined);
  const input = inventoryInput(resolved.state, rootActionId, { kind: "transfer", entryRef: entry.entryId, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" }, RECIPIENT);
  const forged = stepInventoryOperation(scenario.profiles, resolved.state, input, { continuedRoot: true, adjudicationGrant: JSON.parse(JSON.stringify(grant)) });
  assert.equal(forged.kind, "rejected");
  const transferred = stepInventoryOperation(scenario.profiles, resolved.state, input, { continuedRoot: true, adjudicationGrant: grant });
  assert.equal(transferred.kind, "committed", JSON.stringify(transferred));
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[entry.entryId].holderRef, RECIPIENT);
  assert.equal(transferred.state.campaignRuntime.itemSystem.entries[entry.entryId].ownership.ownerRef, PLAYER);
  assertReplay(scenario, [...waiting.events, ...resolved.events, ...transferred.events], transferred.state);
  const tampered = structuredClone(event); tampered.payload.check.succeeded = false;
  assert.equal(createInventoryAdjudicationGrant(resolved.state, tampered, binding), undefined);
});


test("transfer Claims keep each participant's own stack identity across splits and full merges", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, itemDefinitionFromStandardGear(itemById('bolt')), 20);
  const sourceRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  let previous = initial, targetRef;
  const events = [...initial.events];
  for (const quantity of [7, 2, 11]) {
    const result = apply(scenario, previous, `claims-transfer-${quantity}`, { kind: 'transfer', entryRef: sourceRef,
      quantity, targetCharacterRef: RECIPIENT, ownershipDisposition: 'transferToRecipient' });
    targetRef ??= result.events.find(event => event.eventType === 'InventoryOperationApplied').payload.targetEntryId;
    for (const [characterId, principalId, seatId, ownRef, privateRef] of [
      [PLAYER, PRINCIPAL, SEAT, sourceRef, targetRef],
      [RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, targetRef, sourceRef],
    ]) {
      const view = project(scenario.profiles, result.state, { kind: 'player', characterId, principalId, seatId, sessionVersion: 1 },
        { channel: 'realtime', committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: PLAYER,
          priorState: previous.state, events: result.events } });
      assert.equal(view.kind, 'projected', JSON.stringify(view));
      const claims = view.renderableClaims.claims.filter(claim => claim.kind === 'inventoryOutcome');
      assert.equal(claims.length, 1, JSON.stringify(claims));
      assert.equal(claims[0].itemRef, ownRef);
      assert.equal(claims[0].operation.actorRef, PLAYER);
      assert.equal(claims[0].operation.recipientRef, RECIPIENT);
      assert.ok(claims[0].narrationFacts.includes(`${claims[0].displayNames[PLAYER] ?? '行动角色'}已将 ${quantity} 件${claims[0].displayNames[ownRef] ?? '该物品'}交给${claims[0].displayNames[RECIPIENT] ?? '接收角色'}`));
      assert.match(claims[0].summary, new RegExp(`${quantity} 件`));
      assert.equal(claims[0].quantity, undefined, 'do not invent per-event before/after totals from a whole committed range');
      assert.equal(JSON.stringify(claims).includes(privateRef), false);
    }
    previous = result; events.push(...result.events);
  }
  assert.equal(previous.state.campaignRuntime.itemSystem.entries[sourceRef], undefined);
  assert.equal(previous.state.campaignRuntime.itemSystem.entries[targetRef].quantity, 20);
  assertReplay(scenario, events, previous.state);
});
