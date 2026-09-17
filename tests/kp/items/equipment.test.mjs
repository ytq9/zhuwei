// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { PLAYER, SCENE, initialize, materialize, apply, assertReplay } from '../../support/fixtures/inventory-operations.mjs';


test("equipment removal clears derived loadout and frozen combat abilities after its Activity", () => {
  const scenario = initialize();
  const initial = materialize(scenario, itemDefinitionFromStandardGear(itemById("longsword")));
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const equipped = apply(scenario, initial, "equip", { kind: "equip", entryRef, action: "wear", slot: "main" });
  assert.equal(equipped.state.entities[PLAYER].loadout.equipped.main, entryRef);
  assert.deepEqual(equipped.events.slice(0, 3).map((event) => event.eventType), ["ActivityStarted", "FictionTimeAdvanced", "ActivityCompleted"]);
  const dropped = apply(scenario, equipped, "unequip-drop", { kind: "release", entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "placement" });
  assert.equal(dropped.state.entities[PLAYER].loadout.equipped.main, undefined);
  assert.equal(dropped.state.combatRuntime.entities[PLAYER].abilityRefs.some((ref) => ref.includes(entryRef)), false);
  assertReplay(scenario, [...initial.events, ...equipped.events, ...dropped.events], dropped.state);
});
