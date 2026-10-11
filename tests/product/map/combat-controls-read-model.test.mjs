import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../../../app/_runtime/lib/rules/index.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/manifests.ts";
import { hashWorldState } from "../../../app/_runtime/lib/rules/v2/validation.ts";
import {
  BASIC_COMBAT_ACTIONS,
  buildAuthoritativeTableState,
  projectAuthoritativeTableObservation,
} from "../../../app/_runtime/lib/table/authoritative.ts";
import { AUTHORITATIVE_RULESET_VERSION } from "../../../app/_runtime/lib/rules/ruleset.ts";

// SPEC 0014 §8 (ADR 0091): the map's action bar reads the player's own
// abilities, turn grants and walking budget from Rules through the table
// read model; the page computes none of them.

const PROFILES = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST;
const PLAYER = "pc:alice";
const NPC = "npc:warden";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/** SPEC 0014 §4 (ADR 0098): a 3-foot-wide gutter, 2 feet deep, just east of the player. */
const GUTTER = {
  featureId: "feature:yard:gutter",
  kind: "terrain",
  label: "排水沟",
  state: "muddy",
  polygon: [{ x: "30", y: "-60" }, { x: "66", y: "-60" }, { x: "66", y: "60" }, { x: "30", y: "60" }],
  elevation: "0",
  height: "1",
  opaque: false,
  impassable: true,
  cover: "none",
  propagation: "passes",
  terrain: "normal",
  landform: "ditch",
  depth: "24",
  material: "earth",
  visibilityPolicyId: "visibility:scene-observers",
};

function geometry({ gutter = false } = {}) {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [{ x: "-1200", y: "-1200" }, { x: "1200", y: "-1200" }, { x: "1200", y: "1200" }, { x: "-1200", y: "1200" }],
    },
    spawnPoints: [{ x: "0", y: "0", elevation: "0" }, { x: "240", y: "0", elevation: "0" }],
    obstacles: [...(gutter ? [GUTTER] : []), {
      featureId: "feature:yard:marker",
      kind: "barrier",
      label: "院角石墩",
      state: "intact",
      polygon: [{ x: "1000", y: "1000" }, { x: "1060", y: "1000" }, { x: "1060", y: "1060" }, { x: "1000", y: "1060" }],
      elevation: "0",
      height: "60",
      opaque: false,
      impassable: true,
      cover: "half",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    }],
    clearanceZones: [],
  };
}

function combatant(id, ordinal, kind) {
  return {
    id,
    entityId: id,
    kind,
    name: kind === "player" ? "阿莱莎" : "守夜人",
    ...(kind === "player" ? { controllerPrincipalId: "principal:alice" } : {}),
    entityOrdinal: String(ordinal),
    sceneId: "scene:yard",
    position: { x: String((ordinal - 1) * 240), y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    stats: { str: "12", dex: "12", con: "12", int: "14", wis: "12", cha: "10" },
    proficiencyBonus: "2",
    armorClass: "12",
    hitPoints: { current: "20", maximum: "20", temporary: "0" },
    speedInches: { walk: "360" },
    resources: {},
    abilityRefs: [],
    conditions: {},
    concentration: null,
    lifeState: "alive",
    deathSaves: { successes: 0, failures: 0 },
    movement: { spentMilliInches: "0" },
    deathPolicy: kind === "player" ? "deathSaves" : "deadAtZero",
  };
}

const DEFINITIONS = {
  "ability:alice:spell:healing-word": {
    definitionId: "ability:alice:spell:healing-word",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "spell:healing-word",
    sourceSpellId: "healing-word",
    activation: { kind: "bonusActionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    target: { kind: "creature", count: "1", rangeInches: "720" },
    healing: { formula: "1d4+2" },
  },
  "ability:alice:spell:sleep": {
    definitionId: "ability:alice:spell:sleep",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "spell:sleep",
    sourceSpellId: "sleep",
    activation: { kind: "actionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    target: { kind: "area", rangeInches: "1080", shape: { kind: "sphere", radiusInches: "240", propagation: "straight" } },
  },
  "ability:alice:spell:thunderwave": {
    definitionId: "ability:alice:spell:thunderwave",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "spell:thunderwave",
    sourceSpellId: "thunderwave",
    activation: { kind: "actionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    target: { kind: "area", rangeInches: "0", shape: { kind: "cube", edgeInches: "180", propagation: "straight" } },
    save: { ability: "con", halfOnSuccess: true },
    damage: [{ type: "thunder", formula: "2d8" }],
  },
  "ability:alice:spell:shield": {
    definitionId: "ability:alice:spell:shield",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "spell:shield",
    sourceSpellId: "shield",
    activation: { kind: "reactionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    effect: { kind: "shield", armorClassBonus: "5", duration: "untilOwnNextTurnStart", magicMissileImmunity: true },
  },
  // SPEC 0012 §9.1 (ADR 0113): SRD 5.1 Unarmed Strike, 1 + Strength modifier.
  "ability:alice:unarmed-strike": {
    definitionId: "ability:alice:unarmed-strike",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "unarmed-strike",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creatureOrEnvironmentFeature", count: "1", reachInches: "60" },
    attack: { ability: "str", proficiency: true },
    damage: [{ type: "bludgeoning", formula: "1+1" }],
  },
  "ability:alice:class:second-wind": {
    definitionId: "ability:alice:class:second-wind",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "second-wind",
    activation: { kind: "bonusAction" },
    target: { kind: "creature", count: "1", selfOnly: true, rangeInches: "0" },
    costs: [{ kind: "classResource", resourceId: "resource:second-wind", amount: "1" }],
    healing: { formula: "1d10+1" },
  },
};

const ALLY = "pc:bob";

function genesis({ spentMilliInches = "120000", grappled = false, prone = false, ally = false, hidden = false, readied = false,
  gutter = false, allyDying = false } = {}) {
  const player = combatant(PLAYER, 1, "player");
  player.abilityRefs = Object.keys(DEFINITIONS).sort();
  player.resources = {
    "spellSlot:1": { current: "2", maximum: "2" },
    "resource:second-wind": { current: "1", maximum: "1" },
  };
  player.spellcasting = { ability: "int", spellAttackBonus: "4", spellSaveDc: "12" };
  player.turn = { action: "1", bonusAction: "0", reaction: "1", attacksRemaining: "0", hasteAction: "0",
    bonusActionSpellCast: false, leveledActionSpell: false, leveledBonusActionSpell: false };
  player.movement = { spentMilliInches };
  if (grappled) player.conditions = { grappled: true };
  if (prone) player.conditions = { ...player.conditions, prone: true };
  if (hidden) player.conditions = { ...player.conditions, hidden: { stealthTotal: "17" } };
  const npc = combatant(NPC, 2, "npc");
  // ADR 0099: with an ally beside her and the warden in reach, Help applies.
  const bob = combatant(ALLY, 3, "player");
  if (ally) {
    npc.position = { x: "60", y: "0", elevation: "0" };
    bob.position = { x: "0", y: "60", elevation: "0" };
  }
  // SPEC 0012 §12.1: Bob lies dying at 0 HP beside her, not yet stable.
  if (allyDying) {
    bob.hitPoints = { current: "0", maximum: "20", temporary: "0" };
    bob.lifeState = "unconscious";
    bob.conditions = { unconscious: true, prone: true };
  }
  const initialized = step(PROFILES, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:combat-controls",
    runtimeEpochId: "epoch:combat-controls:v1",
    moduleRef: { profileId: "module:combat-controls", profileHash: hash({ module: "combat-controls" }) },
    initialDefinitionCatalogRef: { profileId: "catalog:combat-controls", profileHash: hash({ definitions: Object.keys(DEFINITIONS) }) },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:yard", name: "钟楼庭院", geometry: geometry({ gutter }) }],
    principals: [{ id: "principal:alice", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:alice", principalId: "principal:alice", status: "active" }],
    characters: [{
      id: PLAYER, kind: "player", name: "阿莱莎", sceneId: "scene:yard", tenureStatus: "active",
      classId: "wizard", raceId: "human", level: 1,
      abilityScores: { str: 12, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
      proficiencyBonus: 2, proficientSkills: [], expertiseSkills: [], proficientSaves: [],
      cantripIds: [], preparedSpellIds: [], featureIds: [],
      resources: { "spellSlot:1": 2, "resource:second-wind": 1 },
      resourceMaximums: { "spellSlot:1": 2, "resource:second-wind": 1 },
      hitPoints: { current: 20, maximum: 20 },
      loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "wizard", raceId: "human", cantrips: [], prepared: [] },
    }],
    characterControls: [{ characterId: PLAYER, seatId: "seat:alice" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const initialState = structuredClone(initialized.genesis.initialState);
  // The warden is a character of the world as well as a combatant, so the
  // player has someone to hide from (SPEC 0004 §4).
  initialState.entities[NPC] = { id: NPC, kind: "npc", name: "守夜人", sceneId: "scene:yard", tenureStatus: "active", entityOrdinal: "2" };
  initialState.combatRuntime = {
    story: { chapterId: "chapter:yard", status: "active", endingCandidates: [] },
    scenes: { "scene:yard": { sceneId: "scene:yard", geometry: geometry({ gutter }) } },
    entities: { [PLAYER]: player, [NPC]: npc, ...(ally ? { [ALLY]: bob } : {}) },
    definitions: structuredClone(DEFINITIONS),
    encounters: {
      "encounter:yard": {
        encounterId: "encounter:yard",
        sceneId: "scene:yard",
        status: "starting",
        participantEntityIds: ally ? [PLAYER, NPC, ALLY] : [PLAYER, NPC],
        initiativeGroups: [
          { entryId: "initiative:alice", combatantEntityIds: [PLAYER] },
          { entryId: "initiative:warden", combatantEntityIds: [NPC] },
        ],
        hostilities: ally
          ? [{ fromEntityIds: [NPC], toEntityIds: [ALLY, PLAYER] }, { fromEntityIds: [ALLY, PLAYER], toEntityIds: [NPC] }]
          : [{ fromEntityIds: [NPC], toEntityIds: [PLAYER] }],
        battlefieldFactIds: [],
        surprisedEntityIds: [],
        initiative: {
          entries: [
            { entryId: "initiative:alice", combatantEntityIds: [PLAYER], total: 20 },
            { entryId: "initiative:warden", combatantEntityIds: [NPC], total: 10 },
          ],
          ordered: true,
        },
        round: 1,
        turnCursor: 0,
        activeEntityId: PLAYER,
        turnOrderEntityIds: [PLAYER, NPC],
        roundClosed: false,
      },
    },
    effects: readied ? { "effect:ready:root:alice-readies": { effectId: "effect:ready:root:alice-readies", kind: "readiedAction",
      sourceEntityId: PLAYER, encounterId: "encounter:yard", trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: NPC },
      response: { kind: "move", movementMode: "walk", path: [{ x: "0", y: "0", elevation: "0" }, { x: "-60", y: "0", elevation: "0" }] },
      createdRound: 1, expiresAt: { kind: "turnStart", entityId: PLAYER }, spellAlreadyCast: false } } : {},
    pendingInputs: {},
    randomnessResolutions: {},
  };
  const unsigned = { ...structuredClone(initialized.genesis), initialState, initialStateHash: hashWorldState(initialState) };
  delete unsigned.genesisHash;
  return { ...unsigned, genesisHash: hash(unsigned) };
}

function playerView(world) {
  const rebuilt = replay(world, []);
  assert.equal(rebuilt?.kind, "replayed", JSON.stringify(rebuilt));
  const view = project(PROFILES, rebuilt.state, {
    kind: "player",
    principalId: "principal:alice",
    sessionVersion: 1,
    seatId: "seat:alice",
    characterId: PLAYER,
  });
  assert.equal(view?.kind, "projected", JSON.stringify(view));
  return { view, state: rebuilt.state };
}

test("Rules projects the player's own combat controls outside the actor's delta fields", () => {
  const { view, state } = playerView(genesis());
  assert.deepEqual(Object.keys(view.combatControls).sort(), ["abilities", "hidden", "jumps", "movement", "offers", "prone", "turn"]);
  assert.equal(view.combatControls.prone, false);
  assert.equal(view.combatControls.hidden, false);
  assert.deepEqual(view.combatControls.jumps, [], "nothing in the yard is in jumping range");
  // SPEC 0012 §6.3 (ADR 0097, 0099): the warden is someone to hide from and
  // to ready against; with no ally there is nobody to help.
  assert.deepEqual(view.combatControls.offers, { hide: true, search: true, help: null, ready: { triggerRefs: [NPC] }, stabilize: null });
  assert.deepEqual(view.combatControls.turn, { action: "1", bonusAction: "0", reaction: "1", attacksRemaining: "0" });
  // 30 feet of walking, 10 spent this turn.
  assert.deepEqual(view.combatControls.movement, {
    speedInches: "360",
    spentMilliInches: "120000",
    remainingMilliInches: "240000",
  });
  assert.deepEqual(Object.keys(view.combatControls.abilities).sort(), Object.keys(DEFINITIONS).sort());
  assert.deepEqual(view.combatControls.abilities["ability:alice:spell:sleep"], {
    activation: { kind: "actionSpell", spellLevel: "1" },
    target: DEFINITIONS["ability:alice:spell:sleep"].target,
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    mechanicalKey: "spell:sleep",
    sourceSpellId: "sleep",
  });
  // The spent action stays out of `controlledCharacter`, so it is not a
  // projection change sent to the narration writer.
  assert.equal(Object.hasOwn(view.controlledCharacter, "combatControls"), false);
  assert.equal(Object.hasOwn(view.controlledCharacter.combat, "turn"), false);
  assert.equal(Object.hasOwn(view.controlledCharacter.combat, "movement"), false);

  const npcView = project(PROFILES, state, {
    kind: "npc",
    npcId: NPC,
    purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  });
  if (npcView.kind === "projected") assert.equal(Object.hasOwn(npcView, "combatControls"), false);
});

test("the walking budget follows conditions the way Rules limits a move", () => {
  const { view } = playerView(genesis({ spentMilliInches: "0", grappled: true }));
  assert.deepEqual(view.combatControls.movement, { speedInches: "0", spentMilliInches: "0", remainingMilliInches: "0" });
  const { view: spentOut } = playerView(genesis({ spentMilliInches: "400000" }));
  assert.equal(spentOut.combatControls.movement.remainingMilliInches, "0");
});

test("the table read model forwards closed combat controls built from that projection", () => {
  const { view } = playerView(genesis());
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: {},
    observation: { readModel: view, delivery: { kind: "none" } },
  });
  const controls = projected.combatControls;
  assert.deepEqual(controls.turn, { action: 1, bonusAction: 0, reaction: 1, attacksRemaining: 0 });
  assert.deepEqual(controls.movement, { speedFeet: 30, remainingFeet: 20 });
  assert.equal(controls.hidden, false);
  assert.deepEqual(controls.basicActions.map((action) => [action.abilityRef, action.activation, action.target.kind]), [
    ["action:dash", "action", "none"],
    ["action:disengage", "action", "none"],
    ["action:dodge", "action", "none"],
    ["action:grapple", "attack", "creatures"],
    ["action:shove", "attack", "creatures"],
    ["action:shove-away", "attack", "creatures"],
    ["action:drop-prone", "free", "none"],
    ["action:hide", "action", "none"],
    ["action:search", "action", "none"],
    ["action:ready", "action", "ready"],
  ]);
  for (const action of controls.basicActions) {
    const listed = BASIC_COMBAT_ACTIONS.find((entry) => entry.abilityRef === action.abilityRef);
    assert.deepEqual([action.name, action.group, action.activation], [listed.name, listed.group, listed.activation]);
  }
  // Ready names the creatures the actor perceives and the three events.
  assert.deepEqual(controls.basicActions.at(-1).target,
    { kind: "ready", triggerRefs: [NPC], events: ["turnStarted", "movementCommitted", "spellCastingStarted"] });
  // Grapple and shove against a player need that player's own answer.
  for (const action of controls.basicActions.slice(3, 6)) {
    assert.deepEqual(action.target, { kind: "creatures", count: 1, reachFeet: 5, npcOpponentsOnly: true });
  }
  // ADR 0092: a prone creature is offered standing up instead of lying down.
  const { view: lying } = playerView(genesis({ prone: true }));
  const proneControls = projectAuthoritativeTableObservation({ userId: "principal:alice", members: ["principal:alice"], locationLabels: {},
    observation: { readModel: lying, delivery: { kind: "none" } } }).combatControls;
  assert.equal(lying.combatControls.prone, true);
  assert.deepEqual(proneControls.basicActions.filter((action) => action.activation === "free").map((action) => action.abilityRef), ["action:stand-up"]);
  const byRef = Object.fromEntries(controls.abilities.map((ability) => [ability.abilityRef, ability]));
  // A reaction is offered only by its frozen reaction window, never from the bar.
  assert.equal(byRef["ability:alice:spell:shield"], undefined);
  assert.deepEqual(byRef["ability:alice:spell:healing-word"], {
    abilityRef: "ability:alice:spell:healing-word",
    name: "治愈真言",
    group: "spell",
    activation: "bonusAction",
    spellLevel: 1,
    slotLevel: 1,
    target: { kind: "creatures", count: 1, rangeFeet: 60 },
  });
  assert.deepEqual(byRef["ability:alice:spell:sleep"].target, {
    kind: "area", shape: "sphere", sizeFeet: 20, origin: "point", rangeFeet: 90, needsDirection: false,
  });
  assert.deepEqual(byRef["ability:alice:spell:thunderwave"].target, {
    kind: "area", shape: "cube", sizeFeet: 15, origin: "self", needsDirection: true,
  });
  // ADR 0097 decision 4: an attack roll may be aimed at a point instead.
  assert.deepEqual(byRef["ability:alice:unarmed-strike"], {
    abilityRef: "ability:alice:unarmed-strike",
    name: "徒手攻击",
    group: "attack",
    activation: "attack",
    target: { kind: "creatures", count: 1, reachFeet: 5, aimable: true },
  });
  assert.equal(byRef["ability:alice:spell:healing-word"].target.aimable, undefined);
  assert.deepEqual(byRef["ability:alice:class:second-wind"], {
    abilityRef: "ability:alice:class:second-wind",
    name: "回气",
    group: "feature",
    activation: "bonusAction",
    target: { kind: "self" },
  });
  // Closed: nothing of the definitions' mechanics, hashes or other creatures
  // beyond the ones Ready can wait for, which the map shows anyway.
  assert.doesNotMatch(
    JSON.stringify({ ...controls, basicActions: controls.basicActions.filter((action) => action.abilityRef !== "action:ready") }),
    /"(formula|healing|damage|save|costs|mechanicalKey|sourceSpellId|definitionId|attackRoll)"|sha256|npc:warden|spellSlot/,
  );

  const table = buildAuthoritativeTableState({ rulesetVersion: AUTHORITATIVE_RULESET_VERSION, projected });
  assert.deepEqual(table.combatControls, controls);
});

// SPEC 0012 §§6.3、8.1 (ADR 0097, 0099): the bar offers Hide, Search, Help
// and Ready only when they apply, the way it swaps standing and lying down.
test("the bar offers Help with an ally beside, Hide while already hidden, and drops Ready while one is held", () => {
  const close = (view) => projectAuthoritativeTableObservation({ userId: "principal:alice", members: ["principal:alice"],
    locationLabels: {}, observation: { readModel: view, delivery: { kind: "none" } } }).combatControls;
  const { view: beside } = playerView(genesis({ ally: true }));
  assert.deepEqual(beside.combatControls.offers.help, { allyRefs: [ALLY], enemyRefs: [NPC] });
  const help = close(beside).basicActions.find((action) => action.abilityRef === "action:help");
  assert.deepEqual(help.target, { kind: "help", allyRefs: [ALLY], enemyRefs: [NPC] });

  // A hider may hide again for a new total.
  const { view: hiding } = playerView(genesis({ hidden: true }));
  assert.equal(hiding.combatControls.hidden, true);
  assert.equal(hiding.combatControls.offers.hide, true);
  const hidingControls = close(hiding);
  assert.equal(hidingControls.hidden, true);
  assert.deepEqual(hidingControls.basicActions.filter((action) => ["action:hide", "action:search"].includes(action.abilityRef))
    .map((action) => action.abilityRef), ["action:hide", "action:search"]);

  const { view: holding } = playerView(genesis({ readied: true }));
  assert.equal(holding.combatControls.offers.ready, null);
  assert.equal(close(holding).basicActions.some((action) => action.abilityRef === "action:ready"), false);
});

// SPEC 0012 §12.1 (ADR 0113): first aid (a DC 10 Medicine check) is offered
// only while a dying creature lies within reach, and picks only it.
test("the bar offers first aid on a dying ally within reach, and only on it", () => {
  const close = (view) => projectAuthoritativeTableObservation({ userId: "principal:alice", members: ["principal:alice"],
    locationLabels: {}, observation: { readModel: view, delivery: { kind: "none" } } }).combatControls;
  const { view: dying } = playerView(genesis({ ally: true, allyDying: true }));
  assert.deepEqual(dying.combatControls.offers.stabilize, { targetRefs: [ALLY] });
  const aid = close(dying).basicActions.find((action) => action.abilityRef === "action:stabilize");
  assert.deepEqual(aid, { abilityRef: "action:stabilize", name: "急救", group: "basic", activation: "action",
    target: { kind: "creatures", count: 1, reachFeet: 5, onlyRefs: [ALLY] } });
  // A healthy ally beside her, or a dying one out of reach, is not offered.
  const { view: healthy } = playerView(genesis({ ally: true }));
  assert.equal(healthy.combatControls.offers.stabilize, null);
  assert.equal(close(healthy).basicActions.some((action) => action.abilityRef === "action:stabilize"), false);
  const { view: far } = playerView(genesis({ allyDying: true }));
  assert.equal(far.combatControls.offers.stabilize, null);
});

// SPEC 0014 §4 (ADR 0098): the bar offers the jumps Rules finds the actor can
// make now, each with where it lands and what it costs.
test("the bar offers a jump across the gutter beside her once she has run 10 feet, with its landing and cost", () => {
  const { view } = playerView(genesis({ gutter: true }));
  assert.deepEqual(view.combatControls.jumps, [{ abilityRef: "action:long-jump", featureId: GUTTER.featureId,
    to: { x: "96", y: "0", elevation: "0" }, running: true, costMilliInches: "96000", clearCheck: false, landingCheck: false }]);
  const controls = projectAuthoritativeTableObservation({ userId: "principal:alice", members: ["principal:alice"], locationLabels: {},
    observation: { readModel: view, delivery: { kind: "none" } } }).combatControls;
  assert.deepEqual(controls.jumps, [{ abilityRef: "action:long-jump", featureId: GUTTER.featureId,
    landing: { x: "96", y: "0", elevation: "0" }, running: true, costFeet: 8, clearCheck: false, landingCheck: false }]);
  // Standing still, Strength 12 reaches 6 feet: the far side, 8 feet off, is out of reach.
  assert.deepEqual(playerView(genesis({ gutter: true, spentMilliInches: "0" })).view.combatControls.jumps, []);
});

function syntheticObservation(combatControls, extra = {}) {
  return {
    readModel: {
      kind: "projected",
      stateVersion: "1",
      projectionHash: "sha256:combat-controls",
      viewer: { kind: "player", principalId: "principal:alice", subjectId: PLAYER },
      controlledCharacter: {
        characterId: PLAYER,
        inventory: {
          entries: [{
            kind: "identified",
            entryId: "item-entry:alice:longsword",
            name: "旧长剑",
            description: "一把旧长剑。",
            category: "weapon",
            quantity: 1,
            condition: "usable",
            equippedSlot: "main",
            charges: null,
            durability: null,
            allowedSlots: ["main"],
            twoHanded: false,
            publicDamageText: "1d8 挥砍",
            activities: [],
          }],
        },
        ...extra,
      },
      knowledge: [],
      receipts: [],
      pendingInputs: [],
      combatControls,
    },
    delivery: { kind: "none" },
  };
}

test("a weapon attack is named by the held item and a malformed budget fails closed", () => {
  const weapon = {
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creatureOrEnvironmentFeature", count: "1", reachInches: "60" },
    mechanicalKey: "weapon:item-entry:alice:longsword",
  };
  const offers = { hide: false, search: false, help: null, ready: null, stabilize: null };
  const projected = projectAuthoritativeTableObservation({
    userId: "principal:alice",
    members: ["principal:alice"],
    locationLabels: {},
    observation: syntheticObservation({ abilities: { "ability:alice:weapon": weapon }, turn: null, movement: null, prone: false,
      hidden: false, offers, jumps: [] }),
  });
  assert.equal(projected.combatControls.abilities[0].name, "旧长剑");
  assert.equal(projected.combatControls.turn, null);
  assert.equal(projected.combatControls.movement, null);

  const closed = { hidden: false, offers, jumps: [] };
  const jump = { abilityRef: "action:long-jump", featureId: "feature:yard:gutter", to: { x: "96", y: "0", elevation: "0" }, running: true,
    costMilliInches: "96000", clearCheck: false, landingCheck: false };
  for (const malformed of [
    { abilities: {}, turn: null, movement: null, prone: false, otherCreatures: {}, ...closed },
    { abilities: {}, turn: { action: "1" }, movement: null, prone: false, ...closed },
    { abilities: {}, turn: null, movement: { speedInches: "360", spentMilliInches: "0", remainingMilliInches: "-1" }, prone: false, ...closed },
    { abilities: {}, turn: null, movement: null, prone: "yes", ...closed },
    { abilities: {}, turn: null, movement: null, prone: false, hidden: false, jumps: [],
      offers: { ...offers, help: { allyRefs: "pc:bob", enemyRefs: [] } } },
    { abilities: {}, turn: null, movement: null, prone: false, hidden: false, jumps: [],
      offers: { ...offers, stabilize: { targetRefs: ["pc:bob"], dc: 10 } } },
    { abilities: {}, turn: null, movement: null, prone: false, hidden: "no", offers, jumps: [] },
    { abilities: {}, turn: null, movement: null, prone: false, hidden: false, offers },
    { abilities: {}, turn: null, movement: null, prone: false, ...closed, jumps: [{ ...jump, abilityRef: "action:pole-vault" }] },
    { abilities: {}, turn: null, movement: null, prone: false, ...closed, jumps: [{ ...jump, to: { x: "96", y: "0" } }] },
    { abilities: {}, turn: null, movement: null, prone: false, ...closed, jumps: [{ ...jump, damage: "1d6" }] },
  ]) {
    assert.throws(() => projectAuthoritativeTableObservation({
      userId: "principal:alice",
      members: ["principal:alice"],
      locationLabels: {},
      observation: syntheticObservation(malformed),
    }), TypeError);
  }
});

// SPEC 0006 §§6、7 (ADR 0101): the Room's NPC turn status reaches the table
// state the page reads, as given; anything else is dropped.
test("the table forwards the NPC combat turn status the Room reports", () => {
  const { view } = playerView(genesis());
  const table = readModel => buildAuthoritativeTableState({ rulesetVersion: AUTHORITATIVE_RULESET_VERSION,
    projected: projectAuthoritativeTableObservation({ userId: "principal:alice", members: ["principal:alice"],
      locationLabels: {}, observation: { readModel, delivery: { kind: "none" } } }) });
  assert.deepEqual(table({ ...view, npcCombatTurn: { npcRef: NPC, state: "acting" } }).npcCombatTurn, { npcRef: NPC, state: "acting" });
  assert.deepEqual(table({ ...view, npcCombatTurn: { npcRef: NPC, state: "waitingForRetry" } }).npcCombatTurn, { npcRef: NPC, state: "waitingForRetry" });
  assert.equal(table({ ...view, npcCombatTurn: { npcRef: NPC, state: "thinking" } }).npcCombatTurn, undefined);
  assert.equal(Object.hasOwn(table(view), "npcCombatTurn"), false);
});
