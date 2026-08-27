import assert from "node:assert/strict";
import test from "node:test";

import {
  CLERIC_CANTRIPS,
  CLERIC_SPELLS,
  RANGER_SPELLS,
  SPELLS,
  WIZARD_CANTRIPS,
  WIZARD_SPELLS,
} from "../app/_runtime/lib/dnd/catalog.ts";
import { spellcastingProfile } from "../app/_runtime/lib/dnd/compute.ts";
import { BLACK_OAK_WILL } from "../app/_runtime/lib/module/black-oak-will.ts";
import {
  applyEvents,
  createWorldState,
  project,
  step,
} from "../app/_runtime/lib/rules/engine.ts";
import {
  SPELL_DEFINITIONS,
  assertSpellDefinitions,
} from "../app/_runtime/lib/rules/spell-catalog.ts";

function entity(id, overrides = {}) {
  return {
    id,
    kind: id === "caster" ? "player" : "npc",
    name: id,
    sceneId: "wake",
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 16, cha: 10 },
    proficiencyBonus: 2,
    proficientSaves: [],
    proficientSkills: [],
    expertiseSkills: [],
    creatureType: "humanoid",
    conditionImmunities: [],
    capabilities: [],
    hp: { current: 20, max: 20 },
    ac: 12,
    resources: {},
    ...overrides,
  };
}

function caster(spells, resources = {}) {
  return entity("caster", {
    kind: "player",
    spellLevels: Object.fromEntries(spells.map((id) => [id, SPELL_DEFINITIONS[id].level])),
    spellActionCosts: Object.fromEntries(spells.map((id) => [id, SPELL_DEFINITIONS[id].actionCost])),
    spellcasting: Object.fromEntries(
      spells.map((id) => [id, { ability: "wis", castingModifier: 3, attackBonus: 5, saveDc: 13 }]),
    ),
    resources,
    resourceRules: {
      slot1: { max: resources.slot1 ?? 0, recovery: "long" },
      slot2: { max: resources.slot2 ?? 0, recovery: "long" },
    },
  });
}

function command(state, id, body) {
  return { id, actorId: "caster", expectedVersion: state.version, ...body };
}

function commit(state, decision) {
  assert.notEqual(decision.kind, "rejected", decision.rejection?.message);
  return applyEvents(state, decision.events);
}

test("all 45 level-three card spells have one validated SRD rules definition", () => {
  assert.equal(SPELLS.length, 45);
  assert.deepEqual(assertSpellDefinitions(SPELLS.map((spell) => spell.id)), []);
  assert.equal(Object.keys(SPELL_DEFINITIONS).length, 45);
  const selectable = new Set([
    ...WIZARD_CANTRIPS,
    ...WIZARD_SPELLS,
    ...CLERIC_CANTRIPS,
    ...CLERIC_SPELLS,
    ...RANGER_SPELLS,
  ]);
  assert.deepEqual(SPELLS.filter((spell) => !selectable.has(spell.id)), []);
  for (const spell of Object.values(SPELL_DEFINITIONS)) {
    assert.ok(spell.range);
    assert.ok(spell.targets);
    assert.ok(spell.duration);
    assert.ok(spell.resolution);
    if (spell.resolution.mode === "save") assert.ok(spell.resolution.save?.ability);
    if (spell.resolution.damage) {
      assert.ok(spell.resolution.damage.formula.count > 0);
      assert.ok(spell.resolution.damage.formula.sides > 0);
    }
  }
});

test("level-three spell attack and save DC use the class casting ability", () => {
  const base = {
    classId: "ranger",
    raceId: "human",
    scores: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 8 },
    proficiency: 2,
  };
  assert.deepEqual(spellcastingProfile(base, "cure"), {
    ability: "wis",
    castingModifier: 2,
    attackBonus: 4,
    saveDc: 12,
  });
  assert.equal(
    spellcastingProfile({ ...base, classId: "wizard", scores: { ...base.scores, int: 16 } }, "fire-bolt")?.saveDc,
    13,
  );
});

test("spell attacks, saves, damage, healing and slots resolve only through step", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    caster(["fire-bolt", "burning-hands", "cure"], { slot1: 2 }),
    entity("foe", { hp: { current: 30, max: 30 } }),
    entity("ally", { kind: "player", hp: { current: 0, max: 20 }, activeEffects: ["unconscious"] }),
  ]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "bolt", {
    kind: "castSpell",
    spellId: "fire-bolt",
    targetIds: ["foe"],
    rolls: {
      attack: [{ mode: "normal", faces: [10] }],
      effect: [6, 9],
    },
  })));
  assert.equal(state.entities.foe.hp.current, 24);

  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "hands", {
    kind: "castSpell",
    spellId: "burning-hands",
    targetIds: ["foe", "ally"],
    rolls: {
      saves: {
        foe: { mode: "normal", faces: [5] },
        ally: { mode: "normal", faces: [19] },
      },
      effect: [6, 5, 4],
    },
  })));
  assert.equal(state.entities.foe.hp.current, 9, "failed save takes all 15 fire damage");
  assert.equal(state.entities.ally.hp.current, 0, "damage cannot make a downed target negative");
  assert.equal(state.entities.caster.resources.slot1, 1);

  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "cure", {
    kind: "castSpell",
    spellId: "cure",
    targetIds: ["ally"],
    rolls: { effect: [8] },
  })));
  assert.equal(state.entities.ally.hp.current, 11);
  assert.ok(!state.entities.ally.activeEffects.includes("unconscious"));
  assert.equal(state.entities.caster.resources.slot1, 0);
});

test("concentration replaces the prior spell and typed status reaches projection", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    caster(["bless", "hold-person"], { slot1: 1, slot2: 1 }),
    entity("foe"),
  ]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "bless", {
    kind: "castSpell",
    spellId: "bless",
    targetIds: ["caster"],
  })));
  assert.ok(Object.values(state.spellEffects).some((effect) => effect.tags.includes("bless")));

  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "hold", {
    kind: "castSpell",
    spellId: "hold-person",
    targetIds: ["foe"],
    rolls: { saves: { foe: { mode: "normal", faces: [4] } } },
  })));
  assert.ok(!Object.values(state.spellEffects).some((effect) => effect.tags.includes("bless")));
  assert.ok(Object.values(state.spellEffects).some((effect) => effect.tags.includes("paralyzed")));
  const foeView = project(BLACK_OAK_WILL.world, state, "foe");
  assert.ok(foeView.viewer.spellEffects.some((effect) => effect.tags.includes("paralyzed")));
});

test("range, magic missile allocation and ten-minute casting are deterministic", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    caster(["magic-missile", "prayer"], { slot1: 1, slot2: 1 }),
    entity("foe", { hp: { current: 30, max: 30 } }),
    entity("ally", { kind: "player", hp: { current: 5, max: 20 } }),
  ]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "missiles", {
    kind: "castSpell",
    spellId: "magic-missile",
    targetIds: ["foe", "foe", "ally"],
    rolls: { effect: [4, 3, 2] },
  })));
  assert.equal(state.entities.foe.hp.current, 21);
  assert.equal(state.entities.ally.hp.current, 2);

  const prayer = step(BLACK_OAK_WILL.world, state, command(state, "prayer", {
    kind: "castSpell",
    spellId: "prayer",
    targetIds: ["ally"],
    rolls: { effect: [8, 7] },
  }));
  state = commit(state, prayer);
  assert.equal(state.timelines.caster.fictionSeconds, 606);
  assert.equal(state.entities.ally.hp.current, 20);
  assert.equal(state.entities.caster.resources.slot2, 0);
  assert.ok(prayer.events.some((event) => event.type === "ActivityStarted"));
  assert.ok(prayer.events.some((event) => event.type === "ActivityCompleted"));
});

test("combat spell range is checked against authoritative combat positions", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    caster(["fire-bolt"]),
    entity("foe"),
  ]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "start-range", {
    kind: "startCombat",
    targetIds: ["foe"],
    initiativeRolls: { caster: 20, foe: 1 },
  })));
  const combat = state.combats.wake;
  combat.order.find((entry) => entry.entityId === "caster").positionFeet = 0;
  combat.order.find((entry) => entry.entityId === "foe").positionFeet = 125;
  const rejected = step(BLACK_OAK_WILL.world, state, command(state, "too-far", {
    kind: "castSpell",
    spellId: "fire-bolt",
    targetIds: ["foe"],
    rolls: {
      attack: [{ mode: "normal", faces: [20] }],
      effect: [10, 10],
    },
  }));
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.rejection.code, "unreachable");
});

test("turn-bound spell effects expire on the declared combat boundary", () => {
  let state = createWorldState(BLACK_OAK_WILL.world, [
    caster(["shield"], { slot1: 1 }),
    entity("foe"),
  ]);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "start-shield", {
    kind: "startCombat",
    targetIds: ["foe"],
    initiativeRolls: { caster: 20, foe: 1 },
  })));
  const combatId = state.combats.wake.id;
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "shield", {
    kind: "castSpell",
    spellId: "shield",
  })));
  assert.equal(project(BLACK_OAK_WILL.world, state, "caster").viewer.ac, 17);
  state = commit(state, step(BLACK_OAK_WILL.world, state, command(state, "end-caster", {
    kind: "endCombatTurn",
    combatId,
  })));
  state = commit(state, step(BLACK_OAK_WILL.world, state, {
    id: "end-foe",
    actorId: "foe",
    expectedVersion: state.version,
    kind: "endCombatTurn",
    combatId,
  }));
  assert.equal(project(BLACK_OAK_WILL.world, state, "caster").viewer.ac, 12);
  assert.ok(!Object.values(state.spellEffects).some((effect) => effect.tags.includes("shield-ac")));
});
