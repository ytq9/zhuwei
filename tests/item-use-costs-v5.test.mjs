import assert from "node:assert/strict";
import test from "node:test";

import { compileAbilityDefinition } from "../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import {
  compileItemEntryUseAbility,
  createInitialItemEntry,
  emptyItemSystemState,
  isItemDefinitionV1,
  ITEM_DEFINITION_CONTENT_SCHEMA,
  ITEM_DEFINITION_SCHEMA,
} from "../app/_runtime/lib/rules/v2/items.ts";
import {
  acquireItemQuantity,
  spendItemEntryCosts,
  transferItemQuantity,
} from "../app/_runtime/lib/rules/v2/item-transitions.ts";

function definition(overrides = {}) {
  return {
    schema: ITEM_DEFINITION_SCHEMA,
    definitionKind: "item",
    definitionId: "item-definition:item-use-costs-v5:wand",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:public",
    content: {
      schema: ITEM_DEFINITION_CONTENT_SCHEMA,
      label: "裂纹短杖",
      description: "消耗充能和耐久释放一束微光。",
      category: "equipment",
      aliases: [],
      tags: ["wand"],
      stackable: false,
      equipment: {
        allowedSlots: ["main"],
        twoHanded: false,
        armor: null,
        weapon: null,
      },
      equippedAbilityRefs: [],
      use: {
        kind: "useObject",
        abilityRef: "ability:item-use-costs-v5:wand-light",
        quantityCost: 0,
        chargeCost: 1,
        durabilityCost: 2,
      },
      chargesMaximum: 3,
      durabilityMaximum: 2,
      ...overrides,
    },
  };
}

function stateWith(definitionValue, entry) {
  const state = emptyItemSystemState();
  state.definitions[definitionValue.definitionId] = definitionValue;
  state.entries[entry.entryId] = entry;
  return state;
}

test("exact-entry use atomically spends charges and durability, then breaks and stows", () => {
  const itemDefinition = definition();
  assert.equal(isItemDefinitionV1(itemDefinition), true);
  const entry = createInitialItemEntry(itemDefinition, {
    entryId: "item-entry:item-use-costs-v5:wand",
    quantity: 1,
    placement: { kind: "held", holderRef: "character:item-use-costs-v5:alice", equippedSlot: "main" },
    ownership: { kind: "character", ownerRef: "character:item-use-costs-v5:alice" },
  });
  const spent = spendItemEntryCosts(stateWith(itemDefinition, entry), {
    entryId: entry.entryId,
    holderRef: "character:item-use-costs-v5:alice",
    quantityCost: 0,
    chargeCost: 1,
    durabilityCost: 2,
  });
  assert.equal("error" in spent, false, JSON.stringify(spent));
  assert.deepEqual(spent.snapshot, {
    quantityBefore: 1,
    quantityAfter: 1,
    chargesBefore: 3,
    chargesAfter: 2,
    durabilityBefore: 2,
    durabilityAfter: 0,
  });
  assert.equal(spent.itemSystem.entries[entry.entryId].condition, "broken");
  assert.equal(spent.itemSystem.entries[entry.entryId].equippedSlot, null);
  assert.deepEqual(spendItemEntryCosts(spent.itemSystem, {
    entryId: entry.entryId,
    holderRef: "character:item-use-costs-v5:alice",
    quantityCost: 0,
    chargeCost: 1,
    durabilityCost: 2,
  }), { error: "itemNotUsable" });
});

test("the generic wrapper freezes definition.use against one exact entry", () => {
  const itemDefinition = definition();
  const baseAbility = {
    definitionId: itemDefinition.content.use.abilityRef,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "useObject", actionGrant: "normalAction" },
    target: { kind: "creature", count: "1", rangeInches: "0", selfOnly: true },
    healing: { formula: "1d4" },
  };
  const entryId = "item-entry:item-use-costs-v5:wrapped-wand";
  const artifact = compileItemEntryUseAbility(itemDefinition, entryId, baseAbility);
  assert.deepEqual(artifact.definition.costs, [{
    kind: "item",
    resourceId: entryId,
    amount: "0",
    chargeCost: "1",
    durabilityCost: "2",
  }]);
  assert.equal(
    artifact.definition.definitionId,
    `${itemDefinition.content.use.abilityRef}:entry:${entryId}`,
  );

  const malformed = compileAbilityDefinition({
    ...baseAbility,
    definitionId: "ability:item-use-costs-v5:malformed",
    costs: [{
      kind: "item",
      resourceId: entryId,
      amount: "0",
      chargeCost: "1",
    }],
  });
  assert.equal(malformed.ok, false, JSON.stringify(malformed));
  assert.equal(malformed.code, "invalidAbilityDefinition");
  assert.throws(
    () => compileItemEntryUseAbility(itemDefinition, entryId, {
      ...baseAbility,
      activation: { kind: "attack", actionGrant: "attack" },
    }),
    /does not match the item definition/,
  );
  assert.throws(
    () => compileItemEntryUseAbility(itemDefinition, "wand-without-entry-namespace", baseAbility),
    /item entry id is not canonical/,
  );
});

test("stackability and ownership are explicit current-only contracts", () => {
  assert.equal(isItemDefinitionV1(definition({ stackable: true })), false);
  assert.equal(isItemDefinitionV1(definition({ attunementRequired: false })), false);

  const coinDefinition = definition({
    category: "currency",
    label: "银币",
    tags: ["currency"],
    stackable: true,
    equipment: null,
    use: null,
    chargesMaximum: null,
    durabilityMaximum: null,
  });
  const source = createInitialItemEntry(coinDefinition, {
    entryId: "item-entry:item-use-costs-v5:coins",
    quantity: 2,
    placement: { kind: "held", holderRef: "character:item-use-costs-v5:alice", equippedSlot: null },
    ownership: { kind: "character", ownerRef: "character:item-use-costs-v5:alice" },
  });
  const sourceState = stateWith(coinDefinition, source);
  assert.deepEqual(transferItemQuantity(sourceState, {
    entryId: source.entryId,
    fromHolderRef: "character:item-use-costs-v5:alice",
    toHolderRef: "character:item-use-costs-v5:bram",
    quantity: 1,
    targetEntryId: "item-entry:item-use-costs-v5:preserved-coins",
  }), { error: "invalidOwnershipDisposition" });
  const preserved = transferItemQuantity(sourceState, {
    entryId: source.entryId,
    fromHolderRef: "character:item-use-costs-v5:alice",
    toHolderRef: "character:item-use-costs-v5:bram",
    quantity: 1,
    targetEntryId: "item-entry:item-use-costs-v5:preserved-coins",
    ownershipDisposition: "preserve",
  });
  assert.equal("error" in preserved, false, JSON.stringify(preserved));
  assert.deepEqual(
    preserved.itemSystem.entries[preserved.targetEntryId].ownership,
    { kind: "character", ownerRef: "character:item-use-costs-v5:alice" },
  );
  const transferred = transferItemQuantity(sourceState, {
    entryId: source.entryId,
    fromHolderRef: "character:item-use-costs-v5:alice",
    toHolderRef: "character:item-use-costs-v5:bram",
    quantity: 1,
    targetEntryId: "item-entry:item-use-costs-v5:transferred-coins",
    ownershipDisposition: "transferToRecipient",
  });
  assert.equal("error" in transferred, false, JSON.stringify(transferred));
  assert.deepEqual(
    transferred.itemSystem.entries[transferred.targetEntryId].ownership,
    { kind: "character", ownerRef: "character:item-use-costs-v5:bram" },
  );

  for (const [ownership, expected] of [
    [{ kind: "unowned", ownerRef: null }, { kind: "character", ownerRef: "character:item-use-costs-v5:alice" }],
    [{ kind: "party", ownerRef: "party:item-use-costs-v5" }, { kind: "party", ownerRef: "party:item-use-costs-v5" }],
  ]) {
    const sceneEntry = createInitialItemEntry(coinDefinition, {
      entryId: `item-entry:item-use-costs-v5:scene:${ownership.kind}`,
      quantity: 1,
      placement: { kind: "scene", sceneRef: "scene:item-use-costs-v5" },
      ownership,
    });
    const acquired = acquireItemQuantity(stateWith(coinDefinition, sceneEntry), {
      entryId: sceneEntry.entryId,
      holderRef: "character:item-use-costs-v5:alice",
      quantity: 1,
    });
    assert.equal("error" in acquired, false, JSON.stringify(acquired));
    assert.deepEqual(acquired.itemSystem.entries[acquired.targetEntryId].ownership, expected);
  }
});
