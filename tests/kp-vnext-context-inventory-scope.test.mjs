import assert from "node:assert/strict";
import test from "node:test";
import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { authorityEntityComposite, authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createInitialItemEntry, healingPotionItemDefinition, healingPotionUseAbilityDefinition,
  itemEntryUseAbilityDefinition, itemEntryUseAbilityId } from "../app/_runtime/lib/rules/v2/items.ts";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SOURCE as SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { compileEquippedWeaponAbility, compileStaticCharacterCombat } from "../app/_runtime/lib/rules/v2/character-abilities.ts";
import { itemEntryGearResolver } from "../app/_runtime/lib/rules/v2/item-transitions.ts";

function inventoryFixture() {
  const f = createAuthoredProbeFixture("inventory-scope");
  const definition = { ...healingPotionItemDefinition(), definitionId: "item-definition:specimen-tube" };
  definition.content = { ...definition.content, label: "标本管", description: "一个空容器。", stackable: false, use: null };
  f.state.campaignRuntime.itemSystem.definitions[definition.definitionId] = definition;
  for (let i = 0; i < 90; i++) {
    const ref = `item-entry:unrelated-inventory:${i}`;
    f.state.campaignRuntime.itemSystem.entries[ref] = createInitialItemEntry(definition, {
      entryId: ref, placement: { kind: "held", holderRef: ACTOR, equippedSlot: null }, quantity: 1,
      ownership: { kind: "character", ownerRef: ACTOR },
    });
  }
  return f;
}
function freeze(f, focusRefs = [], intentText = "我轻轻扶正这里的物件，检查它是否稳固。") {
  const kpProjection = { kind: "projected", viewer: { kind: "kp" }, stateVersion: f.state.version,
    activeBranchId: f.state.activeBranchId, projectionHash: canonicalHash(f.state), spatialEvidence: {} };
  return freezeAdjudicationContext({ state: f.state, profiles: f.profiles, kpProjection, moduleProfile: f.moduleProfile,
    actorCharacterId: ACTOR, replayHead: { eventSeq: f.state.version, stateHash: canonicalHash(f.state) },
    preparedActionId: "prepared:inventory-scope", rootActionId: "root:inventory-scope", submissionRef: "submission:inventory-scope",
    intentText, focusRefs, maxUnits: 16_000 });
}
function known(result) {
  assert.equal(result.kind, "ready", JSON.stringify(result));
  return new Map(result.context.entries.filter(({ kind }) => kind === "known").map((entry) => [entry.entryRef, entry]));
}

test("an ordinary physical action keeps the full actor authority without treating every possession as its instrument", () => {
  const f = inventoryFixture();
  const entries = known(freeze(f, [SOURCE]));
  assert.deepEqual(entries.get(ACTOR).value, authorityEntityComposite(f.state, ACTOR));
  assert.equal(entries.get(ACTOR).revisionOrHash, authorityRevisionOrHash(f.state, ACTOR));
  assert.ok(entries.has(SOURCE));
  assert.ok(![...entries.keys()].some((ref) => ref.startsWith("item-entry:unrelated-inventory:")));
});

test("an explicitly selected usable instance closes its complete definition and exact costs without selecting same-definition siblings", () => {
  const f = inventoryFixture();
  const definition = healingPotionItemDefinition(), base = healingPotionUseAbilityDefinition();
  f.state.campaignRuntime.itemSystem.definitions[definition.definitionId] = definition;
  f.state.combatRuntime.definitions[base.definitionId] = base;
  for (const ref of ["item-entry:selected-tool", "item-entry:unselected-sibling"]) {
    f.state.campaignRuntime.itemSystem.entries[ref] = createInitialItemEntry(definition, {
      entryId: ref, placement: { kind: "held", holderRef: ACTOR, equippedSlot: null }, quantity: 2,
      ownership: { kind: "character", ownerRef: ACTOR },
    });
    const executable = itemEntryUseAbilityDefinition(definition, ref, base);
    f.state.combatRuntime.definitions[executable.definitionId] = executable;
  }
  const selected = "item-entry:selected-tool", bound = itemEntryUseAbilityId(base.definitionId, selected);
  f.state.canonicalFacts["fact:selected-definition-constraint"] = {
    id: "fact:selected-definition-constraint", kind: "worldFact", branchId: f.state.activeBranchId,
    subjectRefs: [definition.definitionId], visibilityPolicyId: "visibility:room-authority-only",
    value: { description: "这类配方有已固化的使用约束。" },
  };
  const entries = known(freeze(f, [selected]));
  for (const ref of [selected, definition.definitionId, base.definitionId, bound]) {
    assert.ok(entries.has(ref), ref);
    assert.equal(entries.get(ref).revisionOrHash, authorityRevisionOrHash(f.state, ref));
  }
  assert.deepEqual(entries.get(bound).value.costs, f.state.combatRuntime.definitions[bound].costs);
  assert.ok(entries.has("fact:selected-definition-constraint"), "definition obligations retain their typed causal facts");
  assert.ok(!entries.has("item-entry:unselected-sibling"));
  delete f.state.combatRuntime.definitions[bound];
  assert.equal(freeze(f, [selected]).reason, "criticalUnavailable", "missing selected executable remains decisive");
});

test("an unmentioned defensive reaction and its complete actor defense remain available by their mechanical type", () => {
  const f = inventoryFixture();
  const base = healingPotionUseAbilityDefinition();
  const reaction = { ...base, definitionId: "ability:unmentioned-response", activation: { kind: "reactionSpell", spellLevel: "1" } };
  const unrelated = { ...base, definitionId: "ability:unused-action", activation: { kind: "action" } };
  f.state.combatRuntime.definitions[reaction.definitionId] = reaction;
  f.state.combatRuntime.definitions[unrelated.definitionId] = unrelated;
  f.state.combatRuntime.entities[ACTOR].abilityRefs.push(reaction.definitionId, unrelated.definitionId);
  f.state.combatRuntime.entities[ACTOR].armorClass = 19;
  const entries = known(freeze(f, [SOURCE]));
  assert.ok(entries.has(reaction.definitionId));
  assert.ok(!entries.has(unrelated.definitionId));
  assert.equal(entries.get(ACTOR).value.combat.armorClass, 19);
});

test("selected equipped sources close their existing weapon abilities for different slots without granting unowned catalog entries", () => {
  for (const [slot, label] of [["main", "长剑"], ["off", "短刀"]]) {
    const f = inventoryFixture(), system = f.state.campaignRuntime.itemSystem, character = f.state.entities[ACTOR];
    const definition = structuredClone(healingPotionItemDefinition());
    definition.definitionId = "item-definition:opaque-blade";
    Object.assign(definition.content, { label, description: "一件完好的近战武器。", category: "weapon", stackable: false, use: null,
      equipment: { allowedSlots: [slot], twoHanded: false, armor: null, weapon: {
        attackAbility: "str", ammunitionDefinitionRef: null, damageDice: "1d6", damageType: "slashing",
        reachInches: "60", rangeNormalInches: null, rangeLongInches: null, requiresSight: false,
      } } });
    system.definitions[definition.definitionId] = definition;
    const entry = createInitialItemEntry(definition, { entryId: "item-entry:opaque-blade", quantity: 1,
      placement: { kind: "held", holderRef: ACTOR, equippedSlot: slot }, ownership: { kind: "character", ownerRef: ACTOR } });
    system.entries[entry.entryId] = entry;
    character.loadout.equipped[slot] = entry.entryId;
    const ability = compileEquippedWeaponAbility(character, itemEntryGearResolver(system), slot);
    assert.ok(ability);
    f.state.combatRuntime.definitions[ability.definitionId] = ability;
    f.state.combatRuntime.entities[ACTOR].abilityRefs.push(ability.definitionId);
    f.state.combatRuntime.definitions["ability:unowned-twin"] = { ...ability, definitionId: "ability:unowned-twin" };
    const entries = known(freeze(f, [entry.entryId]));
    assert.deepEqual(entries.get(ability.definitionId)?.value, ability, slot);
    assert.ok(!entries.has("ability:unowned-twin"));
    assert.ok(![...entries.keys()].some(ref => ref.startsWith("item-entry:unrelated-inventory:")));
    delete f.state.combatRuntime.definitions[ability.definitionId];
    assert.equal(freeze(f, [entry.entryId]).reason, "criticalUnavailable", "a broken entitlement cannot silently disappear");
    f.state.combatRuntime.definitions[ability.definitionId] = ability;
    delete character.loadout.equipped[slot];
    assert.ok(!known(freeze(f, [entry.entryId])).has(ability.definitionId), "inventory possession is not equipment authority");
  }
});


test("spell and class names discover only the actor's existing abilities and preserve frozen resources", () => {
  for (const [name, key] of [["火焰箭", "spell:fire-bolt"], ["冷冻射线", "spell:ray-frost"],
    ["动作如潮", "action-surge"], ["回气", "second-wind"]]) {
    const f = inventoryFixture(), character = f.state.entities[ACTOR];
    character.resources = { surge: 1, secondWind: 1 };
    character.resourceMaximums = { surge: 1, secondWind: 1 };
    character.classId = "wizard";
    const compiled = compileStaticCharacterCombat(character, { classId: "wizard", cantrips: ["fire-bolt", "ray-frost"] },
      f.state.campaignRuntime.itemSystem, {});
    Object.assign(f.state.combatRuntime.definitions, compiled.definitions);
    Object.assign(f.state.combatRuntime.entities[ACTOR], compiled);
    const ability = Object.values(compiled.definitions).find(value => value.mechanicalKey === key);
    assert.ok(ability, key);
    const foreignRef = "ability:foreign-source";
    f.state.combatRuntime.definitions[foreignRef] = { ...ability, definitionId: foreignRef };
    const entries = known(freeze(f, [], `我使用${name}。`));
    assert.deepEqual(entries.get(ability.definitionId)?.value, ability, name);
    assert.equal(entries.get(ability.definitionId)?.revisionOrHash, authorityRevisionOrHash(f.state, ability.definitionId));
    assert.ok(!entries.has(foreignRef), "a catalog match is not an actor capability");
    assert.deepEqual(entries.get(ACTOR).value, authorityEntityComposite(f.state, ACTOR));
    assert.ok(![...entries.keys()].some(ref => ref.startsWith("item-entry:unrelated-inventory:")));
    if (key === "action-surge") {
      // Two existing abilities can spend the same source resource. Discovery
      // retains both candidates without deciding which mechanical action to use.
      const sibling = { ...ability, definitionId: "ability:shared-resource-action", grants: [{ kind: "bonusAction", count: "1" }] };
      f.state.combatRuntime.definitions[sibling.definitionId] = sibling;
      f.state.combatRuntime.entities[ACTOR].abilityRefs.push(sibling.definitionId);
      assert.ok(known(freeze(f, [], `我使用${name}。`)).has(sibling.definitionId));
    }
    f.state.combatRuntime.entities[ACTOR].abilityRefs = [];
    assert.ok(!known(freeze(f, [], `我使用${name}。`)).has(ability.definitionId), "removing the entitlement removes name discovery");
  }
});
