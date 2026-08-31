import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectAuthoritativeTableObservation } from "../app/_runtime/lib/table/authoritative.ts";

const root = new URL("../", import.meta.url);

function projectedObservation(entry) {
  return {
    readModel: {
      kind: "projected",
      stateVersion: "1",
      projectionHash: "sha256:inventory-projection",
      viewer: {
        kind: "player",
        principalId: "principal:alice",
        subjectId: "character:alice",
      },
      controlledCharacter: {
        characterId: "character:alice",
        inventory: { entries: [entry] },
      },
      knowledge: [],
      receipts: [],
      pendingInputs: [],
    },
    delivery: { kind: "none" },
  };
}

const dynamicPotion = {
  kind: "identified",
  entryId: "item-entry:dynamic:potion:1",
  name: "雾港医师调制的赤红药剂",
  description: "饮用后恢复生命。",
  category: "consumable",
  quantity: 2,
  condition: "usable",
  equippedSlot: null,
  charges: { current: 2, maximum: 3 },
  durability: { current: 4, maximum: 5 },
  allowedSlots: [],
  twoHanded: false,
  publicDamageText: null,
  activities: [{
    activityId: "use",
    label: "使用",
    enabled: true,
    disabledReason: null,
  }],
};

const opaqueRelic = {
  kind: "opaque",
  entryId: "item-entry:hidden:relic:1",
  quantity: 1,
  condition: "usable",
  equippedSlot: null,
};

test("table adapter preserves only the closed public inventory DTO", () => {
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: {},
    observation: projectedObservation(dynamicPotion),
  });

  assert.deepEqual(projected.controlledCharacter.inventory, {
    entries: [dynamicPotion],
  });
  assert.doesNotMatch(
    JSON.stringify(projected.controlledCharacter.inventory),
    /definitionRef|abilityRef|ownerRef|visibilityPolicyRef|causalBasisRefs/,
  );
});

test("table adapter preserves the exact opaque inventory DTO without identity facts", () => {
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: {},
    observation: projectedObservation(opaqueRelic),
  });

  assert.deepEqual(projected.controlledCharacter.inventory, {
    entries: [opaqueRelic],
  });
  assert.doesNotMatch(
    JSON.stringify(projected.controlledCharacter.inventory),
    /name|description|category|activities|allowedSlots|publicDamageText|definitionRef/,
  );
});

test("table adapter rejects malformed inventory instead of falling back to legacy gear", () => {
  for (const malformedEntry of [
    { ...dynamicPotion, definitionRef: "private:item-definition" },
    { ...dynamicPotion, attuned: false },
    { ...opaqueRelic, name: "不应泄漏的名称" },
    { ...opaqueRelic, activities: [] },
    {
      ...dynamicPotion,
      activities: [{
        activityId: "use",
        label: "使用",
        enabled: true,
        disabledReason: "insufficientQuantity",
      }],
    },
    {
      ...dynamicPotion,
      activities: [{
        activityId: "use",
        label: "使用",
        enabled: false,
        disabledReason: "attunementRequired",
      }],
    },
  ]) {
    assert.throws(() => projectAuthoritativeTableObservation({
      userId: "principal:alice",
      members: ["principal:alice"],
      locationLabels: {},
      observation: projectedObservation(malformedEntry),
    }), /inventory projection is invalid/i);
  }
});

test("V5 inventory UI renders DTO names and submits only the entry identity for use", async () => {
  const [panel, client, playTable] = await Promise.all([
    readFile(new URL("app/_runtime/components/inventory-panel.tsx", root), "utf8"),
    readFile(new URL("app/_runtime/lib/table/client.ts", root), "utf8"),
    readFile(new URL("app/_runtime/components/play-table.tsx", root), "utf8"),
  ]);
  const authoritativeUi = panel.slice(
    panel.indexOf("export function inventoryWornSummary"),
    panel.indexOf("function AuthoritativeItemFacts"),
  );
  const actionHook = panel.slice(
    panel.indexOf("function useGearActions"),
    panel.indexOf("function InventorySection"),
  );

  assert.match(panel, /entry\.kind === "identified" \? entry\.name : OPAQUE_ITEM_LABEL/);
  assert.match(authoritativeUi, /inventoryEntryLabel\(entry\)/);
  assert.doesNotMatch(authoritativeUi, /itemById/);
  assert.match(actionHook, /useInventoryItem\(\{ data: \{ code, itemEntryId \} \}\)/);
  assert.match(actionHook, /if \(!canEdit \|\| inFlight\.current\) return/g);
  assert.match(client, /useInventoryItem[^]*callWithStableTableSubmission\("useInventoryItem", data\)/);
  assert.match(playTable, /inventory=\{authoritativeCharacter\?\.inventory\}/);
  assert.doesNotMatch(actionHook, /abilityRef|definitionRef|targetEntityId/);
});
