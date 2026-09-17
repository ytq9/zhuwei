// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { HEALING_POTION_ITEM_DEFINITION_ID } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { canonicalSha256 } from "../../../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createInitialItemEntry, emptyItemSystemState, healingPotionItemDefinition, itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { acquireItemQuantity, releaseItemQuantity } from "../../../app/_runtime/lib/rules/v2/item-transitions.ts";
import { stepInventoryOperation } from "../../../app/_runtime/lib/rules/v2/inventory-operations.ts";
import { step, project, PLAYER, PRINCIPAL, SEAT, RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, SCENE, initialize, inventoryInput, materialize, apply, assertReplay } from '../../support/fixtures/inventory-operations.mjs';


test("partial release, acquisition and transfer share homogeneous stack identities", () => {
  const definition = healingPotionItemDefinition();
  const itemSystem = emptyItemSystemState();
  itemSystem.definitions[definition.definitionId] = definition;
  const entry = createInitialItemEntry(definition, { entryId: "item-entry:inventory:stack", quantity: 5,
    placement: { kind: "held", holderRef: PLAYER, equippedSlot: null },
    visibilityPolicyRef: `visibility:character-controller:${PLAYER}`, ownership: { kind: "character", ownerRef: PLAYER } });
  itemSystem.entries[entry.entryId] = entry;
  const partial = releaseItemQuantity(itemSystem, { entryId: entry.entryId, holderRef: PLAYER,
    sceneRef: SCENE, quantity: 2, targetEntryId: "item-entry:inventory:dropped" });
  assert.equal("error" in partial, false, JSON.stringify(partial));
  assert.equal(partial.itemSystem.entries[entry.entryId].quantity, 3);
  assert.equal(partial.itemSystem.entries[partial.targetEntryId].quantity, 2);
  assert.equal(partial.itemSystem.entries[partial.targetEntryId].ownership.ownerRef, PLAYER);
  const more = releaseItemQuantity(partial.itemSystem, { entryId: entry.entryId, holderRef: PLAYER,
    sceneRef: SCENE, quantity: 1 });
  assert.equal(more.targetEntryId, partial.targetEntryId);
  const recovered = acquireItemQuantity(more.itemSystem, { entryId: more.targetEntryId, holderRef: PLAYER, quantity: 1 });
  assert.equal(recovered.targetEntryId, entry.entryId);
  assert.equal(recovered.itemSystem.entries[entry.entryId].quantity, 3);
  const wrongOwner = releaseItemQuantity(itemSystem, { entryId: entry.entryId, holderRef: RECIPIENT, sceneRef: SCENE, quantity: 1 });
  assert.equal(wrongOwner.error, "itemHolderMismatch");
  assert.equal(itemSystem.entries[entry.entryId].quantity, 5);
});


test("Rules release and re-acquire preserve entry identity and replay projection", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, healingPotionItemDefinition());
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const dropped = apply(scenario, initial, "drop", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  assert.equal(dropped.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "scene");
  assert.equal(dropped.state.entities[PLAYER].loadout.backpack.length, 0);
  const projected = project(scenario.profiles, dropped.state, { kind: "player", principalId: RECIPIENT_PRINCIPAL,
    sessionVersion: 1, seatId: RECIPIENT_SEAT, characterId: RECIPIENT },
    { channel: "realtime", committedRange: { receiptId: dropped.receipt.receiptId, actorCharacterId: PLAYER,
      priorState: initial.state, events: dropped.events } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.ok(projected.visibleItems.some((item) => item.itemEntryId === entryRef && item.disposition === "scene"));
  const acquired = apply(scenario, dropped, "acquire", { kind: "acquire", entryRef, quantity: 1 }, RECIPIENT);
  assert.equal(acquired.state.campaignRuntime.itemSystem.entries[entryRef].holderRef, RECIPIENT);
  assert.equal(acquired.state.campaignRuntime.itemSystem.entries[entryRef].ownership.ownerRef, PLAYER);
  assertReplay(scenario, [...initial.events, ...dropped.events, ...acquired.events], acquired.state);
  const duplicate = stepInventoryOperation(scenario.profiles, dropped.state,
    inventoryInput(dropped.state, "root:inventory:drop", { kind: "acquire", entryRef, quantity: 1 }));
  assert.equal(duplicate.rejection.code, "duplicateRootAction");
});


test("foreign holder, remote placement, stale readset and JSON-forged grant reject atomically", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = materialize(scenario, healingPotionItemDefinition());
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const before = canonicalSha256(initial.state);
  const input = inventoryInput(initial.state, "root:inventory:theft", { kind: "transfer", entryRef, quantity: 1,
    targetCharacterRef: RECIPIENT, ownershipDisposition: "preserve" }, RECIPIENT);
  for (const options of [{}, { adjudicationGrant: { authorized: true, kind: "sharedCheckSuccess" } }]) {
    const denied = stepInventoryOperation(scenario.profiles, initial.state, input, options);
    assert.equal(denied.kind, "rejected"); assert.deepEqual(denied.events, []);
  }
  const remote = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:remote", {
    kind: "release", entryRef, quantity: 1, sceneRef: "scene:elsewhere", releaseKind: "loss" }));
  assert.equal(remote.kind, "rejected");
  const stale = inventoryInput(initial.state, "root:inventory:stale", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  stale.plan.readSet[0].revisionOrHash = `sha256:${"0".repeat(64)}`;
  assert.equal(stepInventoryOperation(scenario.profiles, initial.state, stale).kind, "rejected");
  assert.equal(canonicalSha256(initial.state), before);
});


test("incapacitated actors cannot acquire an item through the shared inventory transition",()=>{
  const scenario=initialize(),created=materialize(scenario,healingPotionItemDefinition());
  const entry=Object.values(created.state.campaignRuntime.itemSystem.entries).find(entry=>entry.definitionRef===HEALING_POTION_ITEM_DEFINITION_ID);
  const released=step(scenario.profiles,created.state,inventoryInput(created.state,'root:inventory:before-stun',
    {kind:'release',entryRef:entry.entryId,quantity:1,sceneRef:SCENE,releaseKind:'placement'}));
  assert.equal(released.kind,'committed',JSON.stringify(released));
  const frozen=structuredClone(released.state);
  frozen.combatRuntime.entities[PLAYER].conditions={stunned:true};
  const result=step(scenario.profiles,frozen,inventoryInput(frozen,'root:inventory:stunned',{kind:'acquire',entryRef:entry.entryId,quantity:1}));
  assert.equal(result.kind,'rejected');
  assert.deepEqual(result.events,[]);
  assert.equal(frozen.campaignRuntime.itemSystem.entries[entry.entryId].disposition,'scene');
});


test("Rules inventory reference diagnostics hide missing and unavailable ground entries without mutation", () => {
  for (const definition of [healingPotionItemDefinition(), itemDefinitionFromStandardGear(itemById("rope-50ft"))]) {
    const remoteScene = "scene:inventory-diagnostics:private-room";
    const entries = [
      { entryId: "item-entry:inventory-diagnostics:available", sceneRef: SCENE, policy: "visibility:public" },
      { entryId: "item-entry:inventory-diagnostics:hidden-local", sceneRef: SCENE, policy: `visibility:character-controller:${RECIPIENT}` },
      { entryId: "item-entry:inventory-diagnostics:hidden-remote", sceneRef: remoteScene, policy: `visibility:character-controller:${RECIPIENT}` },
    ];
    const scenario = initialize(undefined, { includeRecipient: true,
      additionalScenes: [{ id: remoteScene, name: "未公开的私人房间" }],
      vNextSeed: { semanticDefinitions: [], itemDefinitions: [definition], entityDefinitionBindings: [],
        itemEntries: entries.map(({ entryId, sceneRef, policy }) => ({ definitionRef: definition.definitionId,
          entry: { entryId, quantity: 1, placement: { kind: "scene", sceneRef },
            ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: policy } })),
      },
    });
    const before = structuredClone(scenario.state);
    const beforeHash = canonicalSha256(scenario.state);
    const unavailableRefs = [definition.definitionId, "item-entry:inventory-diagnostics:missing", entries[1].entryId, entries[2].entryId];
    const expectedRejection = { code: "invalidRulesInput", message: "inventoryReferenceUnavailable", diagnostics: [{
      code: "REFERENCE_UNAVAILABLE", path: "/plan/operation/entryRef",
      constraint: "inventory:entry-ref-must-resolve-to-item-entry", expected: { referenceKind: "itemEntry" },
      message: "The inventory operation entryRef must resolve to an ItemEntry instance.",
      source: "SPEC 0013", visibility: "public",
    }] };
    for (const [index, entryRef] of unavailableRefs.entries()) {
      const input = inventoryInput(scenario.state, `root:inventory:diagnostic-reject:${index}`,
        { kind: "acquire", entryRef: entries[0].entryId, quantity: 1 });
      input.plan.operation.entryRef = entryRef;
      // Freeze only authorized reads; do not retrieve a hidden entry's hash or
      // invent a revision for a missing ref merely to reach the Rules validator.
      input.plan.readSet = [PLAYER, SCENE, definition.definitionId, entries[0].entryId]
        .map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(scenario.state, ref) }));
      const denied = step(scenario.profiles, scenario.state, input);
      assert.equal(denied.kind, "rejected", JSON.stringify(denied));
      assert.deepEqual(denied.rejection, expectedRejection);
      assert.deepEqual(denied.events, []);
      assert.deepEqual(scenario.state, before);
      assert.equal(canonicalSha256(scenario.state), beforeHash);
      const diagnosticText = JSON.stringify(denied.rejection);
      for (const privateValue of [...unavailableRefs, remoteScene, RECIPIENT, definition.content.label, "未公开的私人房间"]) {
        assert.equal(diagnosticText.includes(privateValue), false, privateValue);
      }
    }
    assertReplay(scenario, [], scenario.state);
    const acquired = apply(scenario, scenario, "diagnostic-valid-acquire", { kind: "acquire", entryRef: entries[0].entryId, quantity: 1 });
    assert.equal(acquired.state.campaignRuntime.itemSystem.entries[entries[0].entryId].holderRef, PLAYER);
    const projected = project(scenario.profiles, acquired.state, { kind: "player", principalId: PRINCIPAL,
      sessionVersion: 1, seatId: SEAT, characterId: PLAYER },
      { channel: "realtime", committedRange: { receiptId: acquired.receipt.receiptId, actorCharacterId: PLAYER,
        priorState: scenario.state, events: acquired.events } });
    assert.equal(projected.kind, "projected", JSON.stringify(projected));
    assert.ok(projected.visibleItems.some(item => item.itemEntryId === entries[0].entryId));
    assert.equal(projected.visibleItems.some(item => [entries[1].entryId, entries[2].entryId].includes(item.itemEntryId)), false);
    assertReplay(scenario, acquired.events, acquired.state);
  }
});
