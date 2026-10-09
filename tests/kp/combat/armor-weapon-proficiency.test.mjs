import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "../../../app/_runtime/lib/rules/profiles/canonical.ts";
import { compileAbilityDefinition, registeredAbilityRecord } from "../../../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import { combatAttackBonus } from "../../../app/_runtime/lib/rules/profiles/attack-resolution.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as TARGET } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { vnext2CommandToRoomLowering } from "../../../app/_runtime/lib/kp/vnext/room-bridge.ts";
import { compileEquippedWeaponAbility } from "../../../app/_runtime/lib/rules/v2/character-abilities.ts";
import { conditionAbilityCheck, conditionAttack, conditionSavingThrow } from "../../../app/_runtime/lib/rules/v2/condition-mechanics.ts";
import { itemEntryGearResolver } from "../../../app/_runtime/lib/rules/v2/item-transitions.ts";
import { createInitialItemEntry, itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { hashWorldState } from "../../../app/_runtime/lib/rules/v2/validation.ts";
import { ITEMS } from "../../../app/_runtime/lib/dnd/gear.ts";
import { buildAuthoritativeCharacterSeed } from "../../../app/_runtime/lib/table/authoritative.ts";

// SPEC 0004 §4 (2014): a weapon adds the proficiency bonus to its attack only
// when the bearer is proficient with its category or kind; armor or a shield
// worn without proficiency gives disadvantage on Strength and Dexterity
// checks, saves and attacks, and the wearer cannot cast spells. A creature
// whose record lists no proficiencies (an NPC's stat block) is proficient
// with what it wields and wears.

/** Put one standard gear item into the actor's hand or on its body. */
function equip(state, gearId, slot) {
  const definition = itemDefinitionFromStandardGear(ITEMS.find(item => item.id === gearId));
  const system = state.campaignRuntime.itemSystem;
  system.definitions[definition.definitionId] = definition;
  const entry = createInitialItemEntry(definition, { entryId: `item-entry:${gearId}:${slot}`, quantity: 1,
    placement: { kind: "held", holderRef: ACTOR, equippedSlot: slot }, ownership: { kind: "character", ownerRef: ACTOR } });
  system.entries[entry.entryId] = entry;
  state.entities[ACTOR].loadout.equipped[slot] = entry.entryId;
  return entry.entryId;
}

test("a wizard's longsword attack adds no proficiency bonus, its dagger does, so does a longsword for one proficient with martial weapons; an NPC's always does", () => {
  const wizard = buildAuthoritativeCharacterSeed({ characterId: ACTOR, controllerPrincipalId: "principal:probe-actor",
    sheet: { name: "法师", classId: "wizard", raceId: "human", subclassId: "evocation", backgroundId: "sage", skills: [], expertise: [] },
    sceneId: "scene:any", runtimeProfiles: createAuthoredProbeFixture("proficiency:profiles").profiles }).staticCard;
  assert.deepEqual(wizard.proficientWeapons, ["dagger", "dart", "light-crossbow", "sling", "staff"]);
  assert.deepEqual(wizard.proficientArmor, []);
  const f = createAuthoredProbeFixture("proficiency:weapons");
  const state = structuredClone(f.state);
  const record = state.entities[ACTOR];
  record.abilityScores = { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const attack = (proficientWeapons, gearId) => {
    const character = { ...structuredClone(record), ...(proficientWeapons === undefined ? {} : { proficientWeapons }) };
    character.loadout.equipped = {};
    const scratch = structuredClone(state);
    scratch.entities[ACTOR] = character;
    equip(scratch, gearId, "main");
    const ability = compileEquippedWeaponAbility(scratch.entities[ACTOR], itemEntryGearResolver(scratch.campaignRuntime.itemSystem), "main");
    return { proficient: ability.attack.proficiency, bonus: combatAttackBonus({ stats: { str: "14", dex: "10" }, proficiencyBonus: "2" }, ability),
      definitionId: ability.definitionId };
  };
  const longsword = attack(wizard.proficientWeapons, "longsword");
  assert.deepEqual([longsword.proficient, longsword.bonus], [false, 2]);
  // The frozen ID names the missing proficiency; ADR 0126 versions each
  // compiled weapon variant with a hash of its source after it.
  assert.match(longsword.definitionId, /:not-proficient:weapon-v2:[0-9a-f]{16}$/);
  const dagger = attack(wizard.proficientWeapons, "dagger");
  assert.deepEqual([dagger.proficient, dagger.bonus], [true, 4]);
  assert.doesNotMatch(dagger.definitionId, /not-proficient/);
  // A category covers every weapon in it; an NPC's stat block lists none.
  assert.equal(attack(["simple", "martial"], "longsword").proficient, true);
  assert.equal(attack(undefined, "longsword").proficient, true);
});

// The registered-spell fixture of tests/kp/combat/ability-operation.test.mjs,
// with the caster in chain mail.
function caster(name, proficientArmor) {
  const f = createAuthoredProbeFixture(`proficiency:armor:${name}`), abilityRef = `ability:registered:armor-${name}`;
  const compiled = compileAbilityDefinition(JSON.parse(JSON.stringify({ definitionId: abilityRef, revision: "1", rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "1" },
    target: { kind: "creature", count: "1", rangeInches: "600", requiresSight: true },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }], healing: { formula: "1d4+1" } })));
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  const state = structuredClone(f.state), combatant = state.combatRuntime.entities[ACTOR];
  state.combatRuntime.definitions[abilityRef] = registeredAbilityRecord(compiled.artifact);
  combatant.abilityRefs = [abilityRef]; combatant.resources = { "spellSlot:1": { current: "2", maximum: "2" } };
  state.entities[ACTOR].resources = { ...state.entities[ACTOR].resources, slot1: 2 };
  state.entities[ACTOR].resourceMaximums = { ...state.entities[ACTOR].resourceMaximums, slot1: 2 };
  combatant.spellcasting = { ability: "wis", spellAttackBonus: "4", spellSaveDc: "12" }; delete combatant.turn;
  state.entities[ACTOR].proficientArmor = proficientArmor;
  equip(state, "chain", "armor");
  const initialStateHash = hashWorldState(state);
  const genesis = { ...structuredClone(f.genesis), initialState: state, initialStateHash }; delete genesis.genesisHash;
  genesis.genesisHash = canonicalSha256(genesis);
  const replayed = f.runtime.replay(genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  const result = { ...f, genesis, state: replayed.state, abilityRef };
  result.requiredContext = freezeAuthoredProbeContext(result, result.state, { rootActionId: result.rootActionId,
    focusRefs: [ACTOR, TARGET], intentText: "按本人已掌握的能力对明确目标施法。" }).context;
  return result;
}
function cast(f) {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision: { kind: "abilityOperation",
    operation: { kind: "invoke", abilityRef: f.abilityRef, castingMode: "normal", target: { kind: "creatures", refs: [ACTOR] } } } }));
  assert.equal(candidate.kind, "accepted", JSON.stringify(candidate));
  const lowered = lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId, actorCharacterId: ACTOR,
    profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const room = vnext2CommandToRoomLowering(lowered.command);
  assert.equal(room.kind, "accepted");
  return f.runtime.step(f.profiles, f.state, room.input);
}

test("chain mail without heavy armor proficiency: Strength and Dexterity rolls at disadvantage, other rolls not, and no spellcasting", () => {
  const f = caster("light-only", ["light", "medium", "shield"]);
  const check = ability => conditionAbilityCheck(f.state, ACTOR, { ability, visibleFearSourceRefs: [] }).mode;
  assert.deepEqual([check("dex"), check("strength"), check("int"), check(undefined)], ["disadvantage", "disadvantage", "normal", "normal"]);
  assert.deepEqual(["str", "dex", "wis"].map(ability => conditionSavingThrow(f.state, ACTOR, ability).mode), ["disadvantage", "disadvantage", "normal"]);
  assert.equal(conditionAttack(f.state, ACTOR, TARGET, { withinFiveFeet: true, ability: "str", visibleFearSourceRefs: [] }).mode, "disadvantage");
  const refused = cast(f);
  assert.equal(refused.kind, "rejected", JSON.stringify(refused));
  assert.deepEqual([refused.rejection.code, refused.rejection.message], ["missingPrerequisite", "armor:not-proficient-cannot-cast"]);

  // Proficient with heavy armor, the same caster rolls normally and casts.
  const g = caster("heavy", ["heavy", "light", "medium", "shield"]);
  assert.equal(conditionAbilityCheck(g.state, ACTOR, { ability: "dex", visibleFearSourceRefs: [] }).mode, "normal");
  assert.notEqual(cast(g).kind, "rejected");
});
