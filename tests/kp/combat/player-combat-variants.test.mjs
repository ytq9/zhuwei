import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCanonicalCharacterCombat, planPlayerAbilityCatalog } from '../../../app/_runtime/lib/rules/v2/character-abilities.ts';
import { emptyItemSystemState, isItemSystemStateV1, itemDefinitionFromStandardGear, isItemDefinitionV1 } from '../../../app/_runtime/lib/rules/v2/items.ts';
import { mergeInitialStandardLoadout, deriveCharacterLoadoutFromItems, releaseItemQuantity, acquireItemQuantity, changeItemLifecycle, itemEntryGearResolver } from '../../../app/_runtime/lib/rules/v2/item-transitions.ts';
import { weaponUseIssue, recordWeaponAttack, thrownWeaponReleaseDraft } from '../../../app/_runtime/lib/rules/v2/combat-weapon-variants.ts';
import { planInventoryTransition, isInventoryOperationAppliedPayload } from '../../../app/_runtime/lib/rules/v2/inventory-operations.ts';
import { compileAbilityDefinition, registeredAbilityRecord } from '../../../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { canonicalSha256 } from '../../../app/_runtime/lib/rules/profiles/canonical.ts';
import { STANDARD_GEAR_PROFILE, STANDARD_GEAR_PROFILE_DOCUMENT, standardGearResolverForProfile } from '../../../app/_runtime/lib/rules/profiles/standard-gear.ts';
import { itemById } from '../../../app/_runtime/lib/dnd/gear.ts';
import { spellDefinition, spellDurationAtSlot, formulaAtSlot } from '../../../app/_runtime/lib/rules/spell-catalog.ts';

const ACTOR = 'character:variants';
const SCENE = 'scene:yard';
function fixture({ main = 'dagger', off = 'handaxe', str = 14, dex = 16, backpack = [], spells = [], slots = {} } = {}) {
  const seed = { equipped: { ...(main ? { main } : {}), ...(off ? { off } : {}) }, backpack, armorClass: 10, speedFeet: 30 };
  const imported = mergeInitialStandardLoadout(emptyItemSystemState(), ACTOR, seed);
  assert.equal('error' in imported, false, JSON.stringify(imported));
  const itemSystem = imported.itemSystem;
  const loadout = deriveCharacterLoadoutFromItems(itemSystem, { holderRef: ACTOR, scores: { dex }, speedFeet: 30 });
  assert.equal('error' in loadout, false, JSON.stringify(loadout));
  const character = { id: ACTOR, kind: 'player', name: '阿岚', entityOrdinal: '1', sceneId: SCENE, tenureStatus: 'active',
    level: 5, classId: 'cleric', abilityScores: { str, dex, con: 10, int: 10, wis: 16, cha: 10 }, proficiencyBonus: 3,
    proficientWeapons: ['simple', 'martial'], resources: { ...slots }, resourceMaximums: { ...slots },
    preparedSpellIds: spells, loadout: loadout.loadout };
  const compiled = compileCanonicalCharacterCombat(character, itemSystem, {});
  const state = { entities: { [ACTOR]: character }, scenes: { [SCENE]: { id: SCENE } }, canonicalFacts: {},
    campaignRuntime: { itemSystem, activities: {} }, combatRuntime: { entities: { [ACTOR]: { id: ACTOR, kind: 'player',
      sceneId: SCENE, position: { x: '60', y: '60', elevation: '0' }, conditions: {}, lifeState: 'alive',
      turn: { action: '1', attacksRemaining: '0', bonusAction: '1', reaction: '1', hasteAction: '0' } } }, effects: {}, encounters: {} } };
  return { character, itemSystem, compiled, state };
}
const uses = f => Object.values(f.compiled.definitions).filter(d => d.weaponUse);
const pick = (f, slot, mode, bonusAttack = false) => uses(f).find(d => d.weaponUse.slot === slot && d.weaponUse.mode === mode && d.weaponUse.bonusAttack === bonusAttack);

// SPEC 0012 §§6.2、6.3; SPEC 0001 §8: one compilation path, distinct real inventory sources.
test('both equipped hands have ordinary attacks, distinct throws, and light bonus variants with no positive damage modifier', () => {
  const f = fixture();
  const main = pick(f, 'main', 'melee'), off = pick(f, 'off', 'melee');
  assert.equal(main.damage[0].formula, '1d4+3');
  assert.equal(off.damage[0].formula, '1d6+2');
  assert.equal(off.activation.kind, 'attack');
  assert.equal(pick(f, 'off', 'melee', true).damage[0].formula, '1d6');
  assert.equal(pick(f, 'main', 'thrown', true).damage[0].formula, '1d4');
  assert.equal(pick(f, 'main', 'thrown').weaponUse.entryId, f.character.loadout.equipped.main);
  assert.deepEqual(pick(f, 'main', 'thrown').target, { kind: 'creatureOrEnvironmentFeature', count: '1', rangeNormalInches: '240', rangeLongInches: '720' });
  assert.equal(pick(f, 'main', 'thrown').costs, undefined, 'a weapon is released, not consumed as ammunition');
  assert.equal(new Set(uses(f).map(d => d.definitionId)).size, uses(f).length);
  const beforeModifier = fixture({ str: 16, dex: 14 });
  const afterModifier = fixture({ str: 14, dex: 16 });
  assert.notEqual(pick(beforeModifier, 'main', 'melee').definitionId, pick(afterModifier, 'main', 'melee').definitionId,
    'changing the selected ability while retaining the modifier gets a new identity');
  const strong = fixture({ main: 'mace', off: null, str: 14, dex: 12 });
  const agile = fixture({ main: 'mace', off: null, str: 14, dex: 16 });
  assert.notEqual(pick(strong, 'main', 'improvisedThrown').definitionId, pick(agile, 'main', 'improvisedThrown').definitionId,
    'improvised throwing derives a new identity from its own Dexterity modifier');
  for (const d of uses(f)) assert.equal(compileAbilityDefinition(d).ok, true, JSON.stringify(d));
  const weak = fixture({ str: 8, dex: 8 });
  assert.equal(pick(weak, 'off', 'melee', true).damage[0].formula, '1d6-1');
  const spear = fixture({ main: 'javelin', off: null });
  assert.equal(pick(spear, 'main', 'thrown').target.rangeLongInches, '1440');
  assert.equal(uses(spear).some(d => d.weaponUse.bonusAttack), false);
});

test('bonus qualification requires an actual normal Attack action; Multiattack, reactions and haste do not grant it', () => {
  const f = fixture(), main = pick(f, 'main', 'melee'), bonus = pick(f, 'off', 'melee', true);
  assert.equal(weaponUseIssue(f.state, ACTOR, bonus), 'weapon:two-weapon-attack-not-earned');
  for (const turn of [
    { ...f.state.combatRuntime.entities[ACTOR].turn, multiattackRemaining: { bite: '1' } },
    { ...f.state.combatRuntime.entities[ACTOR].turn, reaction: '0' },
    { ...f.state.combatRuntime.entities[ACTOR].turn, hasteAction: '-1' },
  ]) {
    const patch = { turn }; recordWeaponAttack(f.state, ACTOR, main, patch);
    assert.equal(patch.turn.twoWeaponBonusEntryIds, undefined);
  }
  const patch = { turn: { ...f.state.combatRuntime.entities[ACTOR].turn, action: '0' } };
  recordWeaponAttack(f.state, ACTOR, pick(f, 'main', 'thrown'), patch);
  assert.deepEqual(patch.turn.twoWeaponBonusEntryIds, [f.character.loadout.equipped.off]);
  f.state.combatRuntime.entities[ACTOR].turn = patch.turn;
  assert.equal(weaponUseIssue(f.state, ACTOR, bonus), undefined);
  const released = releaseItemQuantity(f.itemSystem, { entryId: f.character.loadout.equipped.main, holderRef: ACTOR, sceneRef: SCENE, quantity: 1 });
  f.state.campaignRuntime.itemSystem = released.itemSystem;
  delete f.character.loadout.equipped.main;
  assert.equal(weaponUseIssue(f.state, ACTOR, bonus), undefined, 'throwing the first weapon does not erase the earned other-hand attack');
  const next = { turn: { action: '1', attacksRemaining: '0', bonusAction: '1', reaction: '1', hasteAction: '0' } };
  f.state.combatRuntime.entities[ACTOR].turn = next.turn;
  assert.equal(weaponUseIssue(f.state, ACTOR, bonus), 'weapon:two-weapon-attack-not-earned');
});

test('throw release uses the frozen target position, keeps ownership and identity, and replay planning reproduces it', () => {
  const f = fixture(), ability = pick(f, 'main', 'thrown');
  const point = { x: '300', y: '180', elevation: '0' };
  const before = canonicalSha256(f.itemSystem);
  const draft = thrownWeaponReleaseDraft(f.state, ACTOR, ability, 'root:throw', point);
  assert.ok(draft); assert.equal(isInventoryOperationAppliedPayload(draft.payload), true);
  assert.equal(canonicalSha256(f.itemSystem), before, 'planning never releases a weapon');
  const p = draft.payload;
  const applied = planInventoryTransition(f.state, ACTOR, p.operation, 'root:throw', p.contextHash, p.authority, p.targetEntryId);
  assert.equal('error' in applied, false, JSON.stringify(applied));
  assert.equal(canonicalSha256(applied.itemSystem), p.itemSystemHashAfter);
  const entry = applied.itemSystem.entries[ability.weaponUse.entryId];
  assert.equal(entry.disposition, 'scene'); assert.equal(entry.quantity, 1); assert.equal(entry.equippedSlot, null);
  assert.deepEqual(entry.position, point); assert.deepEqual(entry.ownership, { kind: 'character', ownerRef: ACTOR });
  f.state.campaignRuntime.itemSystem = applied.itemSystem;
  assert.equal(thrownWeaponReleaseDraft(f.state, ACTOR, ability, 'root:throw-again', point), undefined);
  const recovered = acquireItemQuantity(applied.itemSystem, { entryId: entry.entryId, holderRef: ACTOR, quantity: 1 });
  assert.equal(recovered.itemSystem.entries[entry.entryId].position, undefined);
  assert.equal(isItemSystemStateV1(recovered.itemSystem), true);
  const destroyed = changeItemLifecycle(applied.itemSystem, { entryId: entry.entryId, action: 'destroy' });
  assert.equal('error' in destroyed, false);
});

test('improvised attacks require an explicitly held object, deal 1d4, and never come from the backpack; a bow can be used in melee without ammunition', () => {
  const f = fixture({ main: 'hammer', off: null, backpack: [{ itemId: 'book', quantity: 1 }] });
  const melee = pick(f, 'main', 'improvisedMelee'), thrown = pick(f, 'main', 'improvisedThrown');
  assert.equal(uses(f).some(d => d.weaponUse.entryId === f.character.loadout.backpack[0].itemId), false);
  assert.equal(melee.damage[0].formula, '1d4+2'); assert.equal(melee.attack.proficiency, false);
  assert.equal(thrown.damage[0].formula, '1d4+3'); assert.equal(thrown.target.rangeNormalInches, '240');
  assert.equal(weaponUseIssue(f.state, ACTOR, melee), undefined);
  f.character.loadout.equipped = {};
  assert.equal(weaponUseIssue(f.state, ACTOR, melee), 'weapon:not-equipped');
  const bow = fixture({ main: 'shortbow', off: null });
  assert.equal(pick(bow, 'main', 'ranged'), undefined);
  assert.equal(pick(bow, 'main', 'improvisedMelee').damage[0].formula, '1d4+2');
  assert.equal(pick(bow, 'main', 'improvisedMelee').attack.proficiency, false);
});

test('legal slot variants freeze damage, healing, targets, area and cost from structured source scaling, independent of remaining slots', () => {
  const f = fixture({ spells: ['cure', 'guiding-bolt', 'bless', 'hold-person', 'fog', 'scorching'], slots: { slot1: 4, slot2: 3, slot3: 2 } });
  f.character.resources.slot3 = 0;
  const compiled = compileCanonicalCharacterCombat(f.character, f.itemSystem, {});
  const spell = (id, slot) => Object.values(compiled.definitions).find(d => d.sourceSpellId === id && d.activation.spellLevel === String(slot));
  assert.equal(spell('cure', 3).healing.formula, '3d8+3');
  assert.equal(spell('guiding-bolt', 3).damage[0].formula, '6d6');
  assert.equal(spell('bless', 3).target.count, '5');
  assert.equal(spell('hold-person', 3).target.count, '2');
  assert.equal(spell('fog', 3).target.shape.radiusInches, '720');
  assert.deepEqual(spell('cure', 3).costs, [{ kind: 'spellSlot', level: '3', amount: '1' }]);
  assert.equal(spell('cure', 4), undefined); assert.equal(spell('scorching', 3), undefined, 'unsupported repeat rays never become a single hit');
  assert.notEqual(spell('cure', 1).definitionId, spell('cure', 3).definitionId);
  for (const definition of Object.values(compiled.definitions)) assert.equal(compileAbilityDefinition(definition).ok, true, JSON.stringify(definition));
  const catalog = Object.fromEntries(Object.entries(compiled.definitions).map(([id, d]) => [id, registeredAbilityRecord(compileAbilityDefinition(d).artifact)]));
  assert.equal('error' in planPlayerAbilityCatalog({ character: f.character, itemSystem: f.itemSystem, catalog }), false);
  const before = structuredClone(catalog);
  f.character.resourceMaximums.slot4 = 1; f.character.resources.slot4 = 1;
  const extended = planPlayerAbilityCatalog({ character: f.character, itemSystem: f.itemSystem, catalog });
  assert.equal('error' in extended, false, JSON.stringify(extended)); assert.deepEqual(catalog, before);
  assert.ok(extended.registrations.some(a => a.definition.sourceSpellId === 'cure' && a.definition.activation.spellLevel === '4'));
});

test('source scaling represents stepped dice, duration thresholds and effect values without reading prose', () => {
  assert.equal(formulaAtSlot(spellDefinition('spiritual').resolution.damage.formula, 2, 3).count, 1);
  assert.equal(formulaAtSlot(spellDefinition('spiritual').resolution.damage.formula, 2, 4).count, 2);
  assert.equal(spellDurationAtSlot(spellDefinition('hunters-mark'), 3), 8 * 3600);
  assert.equal(spellDurationAtSlot(spellDefinition('hunters-mark'), 5), 24 * 3600);
  const f = fixture({ spells: ['aid'], slots: { slot2: 2, slot3: 1 } });
  const aid = Object.values(f.compiled.definitions).find(d => d.sourceSpellId === 'aid' && d.activation.spellLevel === '3');
  assert.equal(aid.effects[0].value, 10); assert.equal(aid.target.count, '3');
});

test('the new gear profile has a matching immutable hash and versioned weapons; an earlier frozen weapon stays readable', () => {
  assert.equal(canonicalSha256(STANDARD_GEAR_PROFILE_DOCUMENT), STANDARD_GEAR_PROFILE.profileHash);
  assert.equal(STANDARD_GEAR_PROFILE.profileId, 'standard-gear-srd51-2014-v3');
  assert.equal(standardGearResolverForProfile({ ...STANDARD_GEAR_PROFILE, profileHash: 'sha256:' + '0'.repeat(64) }), undefined);
  const current = itemDefinitionFromStandardGear(itemById('dagger'));
  assert.equal(current.revision, '2'); assert.equal(current.content.equipment.weapon.light, true);
  assert.deepEqual(current.content.equipment.weapon.thrown, { rangeNormalInches: '240', rangeLongInches: '720' });
  const prior = structuredClone(current); prior.definitionId = 'item-definition:standard-gear:dagger:1'; prior.revision = '1';
  delete prior.content.equipment.weapon.light; delete prior.content.equipment.weapon.thrown;
  assert.equal(isItemDefinitionV1(prior), true);
  const f = fixture(); const id = f.character.loadout.equipped.main;
  f.itemSystem.definitions[prior.definitionId] = prior; f.itemSystem.entries[id].definitionRef = prior.definitionId; f.itemSystem.entries[id].definitionRevision = '1';
  const frozen = itemEntryGearResolver(f.itemSystem)(id);
  assert.equal(frozen.weapon.light, undefined); assert.equal(frozen.weapon.thrown, undefined);
});
