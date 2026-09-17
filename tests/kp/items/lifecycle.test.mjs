// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { project, PLAYER, RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, SCENE, initialize, materialize, apply, assertReplay } from '../../support/fixtures/inventory-operations.mjs';


test("lifecycle and opaque dropped-item projection preserve the same authoritative entry", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const definition = itemDefinitionFromStandardGear(itemById("longsword"));
  definition.visibilityPolicyRef = `visibility:character-controller:${PLAYER}`;
  const initial = materialize(scenario, definition);
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const broken = apply(scenario, initial, "break", { kind: "lifecycle", entryRef, action: "break" });
  assert.equal(broken.state.campaignRuntime.itemSystem.entries[entryRef].condition, "broken");
  const repaired = apply(scenario, broken, "repair", { kind: "lifecycle", entryRef, action: "repair" });
  assert.equal(repaired.state.campaignRuntime.itemSystem.entries[entryRef].condition, "usable");
  const dropped = apply(scenario, repaired, "private-drop", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  const projected = project(scenario.profiles, dropped.state, { kind: "player", principalId: RECIPIENT_PRINCIPAL,
    sessionVersion: 1, seatId: RECIPIENT_SEAT, characterId: RECIPIENT },
    { channel: "realtime", committedRange: { receiptId: dropped.receipt.receiptId, actorCharacterId: PLAYER,
      priorState: repaired.state, events: dropped.events } });
  const visible = projected.visibleItems.find((item) => item.itemEntryId === entryRef);
  assert.equal(visible.kind, "opaque"); assert.equal(visible.name, undefined); assert.equal(visible.definitionRef, undefined);
  const outcome = projected.renderableClaims.claims.find(claim => claim.kind === "inventoryOutcome");
  assert.ok(outcome);
  assert.match(outcome.summary, /1 件该物品/);
  assert.equal(JSON.stringify(outcome).includes(definition.content.label), false);
  assert.equal(JSON.stringify(outcome).includes(JSON.stringify(definition.definitionId)), false);
  const destroyed = apply(scenario, dropped, "destroy", { kind: "lifecycle", entryRef, action: "destroy" });
  assert.equal(destroyed.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "destroyed");
  assertReplay(scenario, [...initial.events, ...broken.events, ...repaired.events, ...dropped.events, ...destroyed.events], destroyed.state);
});
