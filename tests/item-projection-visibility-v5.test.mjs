import assert from "node:assert/strict";
import test from "node:test";
import { projectHeldInventory } from "../app/_runtime/lib/rules/v2/item-projection.ts";
import {
  createInitialItemEntry,
  healingPotionItemDefinition,
  ITEM_SYSTEM_STATE_SCHEMA,
} from "../app/_runtime/lib/rules/v2/items.ts";

const CHARACTER = "character:item-visibility:player";
const ENTRY = "item-entry:item-visibility:potion";
const VIEWER = { kind: "player", characterId: CHARACTER };

function inventory(definitionPolicy, entryPolicy) {
  const definition = {
    ...healingPotionItemDefinition(),
    visibilityPolicyRef: definitionPolicy,
    content: {
      ...healingPotionItemDefinition().content,
      label: "密封赤红药剂",
      description: "秘密机械：饮用后恢复生命。",
    },
  };
  const entry = createInitialItemEntry(definition, {
    entryId: ENTRY,
    quantity: 2,
    placement: { kind: "held", holderRef: CHARACTER, equippedSlot: null },
    ownership: { kind: "character", ownerRef: CHARACTER },
    visibilityPolicyRef: entryPolicy,
  });
  return {
    schema: ITEM_SYSTEM_STATE_SCHEMA,
    definitions: { [definition.definitionId]: definition },
    entries: { [entry.entryId]: entry },
  };
}

test("an entry-private held item is absent from the player inventory", () => {
  const projected = projectHeldInventory(inventory(
    "visibility:room-authority-only",
    "visibility:room-authority-only",
  ), VIEWER);

  assert.deepEqual(projected, { entries: [] });
});

test("an entry-visible definition-private item projects only an opaque possession shell", () => {
  const projected = projectHeldInventory(inventory(
    "visibility:room-authority-only",
    `visibility:character-controller:${CHARACTER}`,
  ), VIEWER);

  assert.deepEqual(projected, {
    entries: [{
      kind: "opaque",
      entryId: ENTRY,
      quantity: 2,
      condition: "usable",
      equippedSlot: null,
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(projected),
    /密封赤红药剂|秘密机械|category|publicDamageText|allowedSlots|charges|durability|activities/,
  );
});

test("identified details require both the definition and entry policy", () => {
  const identified = projectHeldInventory(inventory(
    "visibility:public",
    `visibility:character-controller:${CHARACTER}`,
  ), VIEWER).entries[0];
  assert.equal(identified.kind, "identified");
  assert.equal(identified.name, "密封赤红药剂");
  assert.deepEqual(identified.activities, [{
    activityId: "use",
    label: "使用",
    enabled: true,
    disabledReason: null,
  }]);
  assert.equal("attuned" in identified, false);
  assert.equal("attunementRequired" in identified, false);

  assert.deepEqual(projectHeldInventory(inventory(
    "visibility:public",
    "visibility:room-authority-only",
  ), VIEWER), { entries: [] });

  assert.equal(projectHeldInventory(inventory(
    `visibility:npc:${CHARACTER}`,
    "visibility:public",
  ), VIEWER).entries[0].kind, "opaque");
  assert.equal(projectHeldInventory(inventory(
    `visibility:npc:${CHARACTER}`,
    "visibility:public",
  ), { kind: "npc", characterId: CHARACTER }).entries[0].kind, "identified");
});
