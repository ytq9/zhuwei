import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";

const PROFILES = Object.freeze({
  manifest: { profileId: "runtime-srd51-2014-authoritative-v2", profileHash: "sha256:496da17f16d52cbe5dfa3e97facfa8ed7dcf3f4bbb7a882fc0e384d464898051" },
  ruleset: { profileId: "dnd5e-2014-srd5.1-authoritative-v2", profileHash: "sha256:7651d58190da6bfb6241cabb41b07ef5cfee3266edf3c62b8af443d94daf4af0" },
  eventSchema: { profileId: "room-world-events-v2", profileHash: "sha256:3f1d953752be8981f4f7862ba1a90d6f613d113ecfd2d18dfd983abf974a8a67" },
  abilityCompiler: { profileId: "ability-srd51-2014-v1", profileHash: "sha256:561710d6ae32fc14f0ba22863e0d6cd92d12c6d32b8728a81608561a66b25ba3" },
  geometry: { profileId: "geometry-2d-feet-2014-v1", profileHash: "sha256:59caa4e73c58dc20a92cd9b50370f2c9b275a9b57740c7dd1d519f78cb72611e" },
  triggerOrdering: { profileId: "trigger-initiative-order-2014-v1", profileHash: "sha256:825ef8de6f962f01111c9ce325189c0d203ee71ab305149fd7b2b7485b6b8089" },
  fictionCombatTime: { profileId: "combat-round-six-seconds-2014-v1", profileHash: "sha256:067eb4870fcee1cda2563c7633daac4c2b7249ecd53e0f9b1c986d3de8d12f08" },
  extensions: [
    { profileId: "combat-srd51-2014-v1", profileHash: "sha256:b9e12294db25409844e1ecd63d048e404b315ecfcd8c493cd6af5cb593e4acc6" },
    { profileId: "damage-death-srd51-2014-v1", profileHash: "sha256:37dbf131c6325f2f07e3693ee8c3420372c8d7f9154a757dfafdc6f853537d7a" },
    { profileId: "presentation-observer-specific-v1", profileHash: "sha256:86bfdfebe7062d90f87e4add65d1d109cb14dead7b3d758e452af76c13f7457c" },
    { profileId: "projection-observer-safe-v1", profileHash: "sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91" },
    { profileId: "delivery-single-current-frame-v1", profileHash: "sha256:cd0d684841bd43f621665dc538db35b81c25421d8b345e444681054bbc894d7e" },
  ],
});

const ENCOUNTER_ID = "encounter:three-factions";
const LANTERN_ID = "pc:lantern";
const ASH_ID = "npc:ash";
const TIDE_ID = "npc:tide";

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

function combatant(id, factionId, ordinal, kind, controllerPrincipalId) {
  return {
    id,
    kind,
    name: id,
    factionId,
    ...(controllerPrincipalId === undefined ? {} : { controllerPrincipalId }),
    entityOrdinal: String(ordinal),
    sceneId: "scene:crossroads",
    position: { x: String((ordinal - 1) * 120), y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    stats: { str: "10", dex: "10", con: "10", int: "10", wis: "10", cha: "10" },
    proficiencyBonus: "2",
    armorClass: "10",
    hitPoints: { current: "10", maximum: "10", temporary: "0" },
    speedInches: { walk: "360" },
    resources: {},
    abilityRefs: kind === "player" ? ["ability:lantern-strike"] : [],
    conditions: {},
    concentration: null,
    lifeState: "alive",
    deathSaves: { successes: 0, failures: 0 },
    movement: { spentMilliInches: "0" },
    deathPolicy: kind === "player" ? "deathSaves" : "deadAtZero",
    turn: {
      action: kind === "player" ? "1" : "0",
      bonusAction: kind === "player" ? "1" : "0",
      reaction: "1",
      attacksRemaining: kind === "player" ? "1" : "0",
      hasteAction: "0",
      bonusActionSpellCast: false,
      leveledActionSpell: false,
      leveledBonusActionSpell: false,
      surprised: false,
    },
  };
}

function makeGenesis() {
  const definitions = {
    "ability:lantern-strike": {
      definitionId: "ability:lantern-strike",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      activation: { kind: "attack", actionGrant: "attack" },
      target: { kind: "creature", count: "1", rangeInches: "600", requiresSight: true },
      attack: { ability: "str", proficiency: true },
      damage: [{ type: "bludgeoning", formula: "1d4" }],
    },
  };
  const initialState = {
    version: "0",
    activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    story: { chapterId: "chapter:crossroads", status: "active", endingCandidates: [] },
    scenes: {
      "scene:crossroads": {
        sceneId: "scene:crossroads",
        geometry: { unit: "inch", obstacles: [], clearanceZones: [] },
      },
    },
    entities: {
      [LANTERN_ID]: combatant(LANTERN_ID, "faction:lantern", 1, "player", "principal:lantern"),
      [ASH_ID]: combatant(ASH_ID, "faction:ash", 2, "npc"),
      [TIDE_ID]: combatant(TIDE_ID, "faction:tide", 3, "npc"),
    },
    definitions,
    encounters: {
      [ENCOUNTER_ID]: {
        encounterId: ENCOUNTER_ID,
        sceneId: "scene:crossroads",
        status: "active",
        participantEntityIds: [LANTERN_ID, ASH_ID, TIDE_ID],
        initiativeGroups: [
          { entryId: "initiative:lantern", combatantEntityIds: [LANTERN_ID] },
          { entryId: "initiative:ash", combatantEntityIds: [ASH_ID] },
          { entryId: "initiative:tide", combatantEntityIds: [TIDE_ID] },
        ],
        hostilities: [
          { fromEntityIds: [LANTERN_ID], toEntityIds: [ASH_ID] },
          { fromEntityIds: [LANTERN_ID], toEntityIds: [TIDE_ID] },
          { fromEntityIds: [ASH_ID], toEntityIds: [LANTERN_ID] },
          { fromEntityIds: [TIDE_ID], toEntityIds: [ASH_ID] },
        ],
        battlefieldFactIds: [],
        surprisedEntityIds: [],
        initiative: {
          entries: [
            { entryId: "initiative:lantern", combatantEntityIds: [LANTERN_ID], total: 20 },
            { entryId: "initiative:ash", combatantEntityIds: [ASH_ID], total: 15 },
            { entryId: "initiative:tide", combatantEntityIds: [TIDE_ID], total: 10 },
          ],
          ordered: true,
        },
        round: 1,
        turnCursor: 0,
        activeEntityId: LANTERN_ID,
        turnOrderEntityIds: [LANTERN_ID, ASH_ID, TIDE_ID],
        roundClosed: false,
      },
    },
    effects: {},
    pendingInputs: {},
  };
  const unsigned = {
    kind: "roomGenesis",
    roomId: "room:combat-hostility-v2",
    runtimeEpochId: "epoch:combat-hostility-v2",
    profiles: PROFILES,
    moduleRef: { profileId: "module:combat-hostility-v2", profileHash: hash({ module: "combat-hostility-v2" }) },
    initialDefinitionCatalogRef: {
      profileId: "catalog:combat-hostility-v2",
      profileHash: hash({ definitions: Object.keys(definitions) }),
    },
    initialState,
    initialStateHash: hash(initialState),
  };
  return { ...unsigned, genesisHash: hash(unsigned) };
}

function scenario() {
  const genesis = makeGenesis();
  const rebuilt = replay(genesis, []);
  assert.equal(rebuilt?.kind, "replayed", JSON.stringify(rebuilt));
  return { genesis, events: [], state: rebuilt.state };
}

function apply(current, input) {
  const result = step(PROFILES, current.state, input);
  const events = [...current.events, ...(result.events ?? [])];
  const rebuilt = replay(current.genesis, events);
  assert.equal(rebuilt?.kind, "replayed", JSON.stringify(rebuilt));
  return { current: { ...current, events, state: rebuilt.state }, result };
}

function lanternView(current) {
  return project(PROFILES, current.state, {
    kind: "player",
    principalId: "principal:lantern",
    characterId: LANTERN_ID,
  });
}

function openTargetChoice(current, suffix) {
  return apply(current, {
    kind: "invokeAbility",
    rootActionId: `root:b07:${suffix}`,
    sourceEntityId: LANTERN_ID,
    abilityRef: "ability:lantern-strike",
    parameters: {},
  });
}

test("B07 projects every independently hostile faction as a target candidate", () => {
  const opened = openTargetChoice(scenario(), "initial-targets");
  assert.equal(opened.result.kind, "awaitingInput", JSON.stringify(opened.result));
  assert.deepEqual(
    lanternView(opened.current).pendingInputs[0].candidateEntityIds,
    [ASH_ID, TIDE_ID],
  );
});

test("B07 changes hostility by event so candidates and explicit target validation replay consistently", () => {
  let current = openTargetChoice(scenario(), "before-truce").current;
  const pendingBefore = lanternView(current).pendingInputs[0];
  const cancelledBefore = apply(current, {
    kind: "answerPendingInput",
    pendingInputId: pendingBefore.pendingInputId,
    responseId: "response:b07:cancel-before-truce",
    answer: { kind: "cancel" },
  });
  assert.equal(cancelledBefore.result.kind, "committed", JSON.stringify(cancelledBefore.result));
  current = cancelledBefore.current;

  const changed = apply(current, {
    kind: "changeEncounterHostility",
    rootActionId: "root:b07:lantern-truce-with-ash",
    encounterId: ENCOUNTER_ID,
    sourceEntityId: LANTERN_ID,
    targetEntityIds: [TIDE_ID],
    reason: "truce",
  });
  assert.equal(changed.result.kind, "committed", JSON.stringify(changed.result));
  assert.deepEqual(changed.result.events.map(({ eventType }) => eventType), ["HostilityChanged"]);
  assert.deepEqual(changed.result.events[0].payload, {
    encounterId: ENCOUNTER_ID,
    sourceEntityId: LANTERN_ID,
    previousTargetEntityIds: [ASH_ID, TIDE_ID],
    targetEntityIds: [TIDE_ID],
    reason: "truce",
  });
  current = changed.current;

  const rebuilt = replay(current.genesis, current.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, current.state);

  const openedAfter = openTargetChoice(current, "after-truce");
  assert.equal(openedAfter.result.kind, "awaitingInput", JSON.stringify(openedAfter.result));
  assert.deepEqual(
    lanternView(openedAfter.current).pendingInputs[0].candidateEntityIds,
    [TIDE_ID],
  );
  const pendingAfter = lanternView(openedAfter.current).pendingInputs[0];
  const cancelledAfter = apply(openedAfter.current, {
    kind: "answerPendingInput",
    pendingInputId: pendingAfter.pendingInputId,
    responseId: "response:b07:cancel-after-truce",
    answer: { kind: "cancel" },
  });
  assert.equal(cancelledAfter.result.kind, "committed", JSON.stringify(cancelledAfter.result));
  current = cancelledAfter.current;

  const formerTarget = step(PROFILES, current.state, {
    kind: "invokeAbility",
    rootActionId: "root:b07:former-target",
    sourceEntityId: LANTERN_ID,
    abilityRef: "ability:lantern-strike",
    parameters: { targetEntityId: ASH_ID },
  });
  assert.equal(formerTarget.kind, "rejected", JSON.stringify(formerTarget));
  assert.equal(formerTarget.rejection.code, "privateOrUnknownReference");

  const remainingTarget = step(PROFILES, current.state, {
    kind: "invokeAbility",
    rootActionId: "root:b07:remaining-target",
    sourceEntityId: LANTERN_ID,
    abilityRef: "ability:lantern-strike",
    parameters: { targetEntityId: TIDE_ID },
  });
  assert.equal(remainingTarget.kind, "awaitingRandomness", JSON.stringify(remainingTarget));
});
