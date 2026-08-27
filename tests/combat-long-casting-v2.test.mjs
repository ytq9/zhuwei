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

function combatant(id, ordinal, kind, controllerPrincipalId) {
  return {
    id,
    kind,
    name: id,
    ...(controllerPrincipalId === undefined ? {} : { controllerPrincipalId }),
    entityOrdinal: String(ordinal),
    sceneId: "scene:ritual",
    position: { x: String((ordinal - 1) * 120), y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    stats: { str: "10", dex: "10", con: "10", int: "14", wis: "10", cha: "10" },
    proficiencyBonus: "2",
    armorClass: "10",
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
    turn: { action: "0", bonusAction: "0", reaction: "1", attacksRemaining: "0", leveledBonusActionSpell: false },
  };
}

function makeGenesis({ encounter = true, casterHitPoints = 20, counterspeller = false } = {}) {
  const caster = combatant("pc:caster", 1, "player", "principal:caster");
  caster.hitPoints.current = String(casterHitPoints);
  caster.abilityRefs = ["spell:slow-ward"];
  caster.resources = { "spellSlot:1": { current: "1", maximum: "1" } };
  caster.spellcasting = { ability: "int", spellAttackBonus: "4", spellSaveDc: "12" };
  caster.turn = { action: "1", bonusAction: "1", reaction: "1", attacksRemaining: "1", leveledBonusActionSpell: false };
  const attacker = combatant("npc:attacker", 2, "npc");
  attacker.abilityRefs = ["attack:club"];
  if (counterspeller) {
    attacker.abilityRefs.push("spell:counterspell");
    attacker.resources = { "spellSlot:3": { current: "1", maximum: "1" } };
    attacker.spellcasting = { ability: "int", spellAttackBonus: "2", spellSaveDc: "10" };
  }
  const definitions = {
    "spell:slow-ward": {
      definitionId: "spell:slow-ward",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      activation: {
        kind: "actionSpell",
        spellLevel: "1",
        castingTimeMicros: "12000000",
        ritual: true,
      },
      costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
      target: { kind: "creature", count: "1", rangeInches: "0", selfOnly: true },
      effect: { kind: "concentration", durationMicros: "60000000" },
    },
    "attack:club": {
      definitionId: "attack:club",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      activation: { kind: "action" },
      target: { kind: "creature", count: "1", reachInches: "120" },
      attack: { ability: "str", proficiency: true },
      damage: [{ type: "bludgeoning", formula: "1d4" }],
    },
    "spell:counterspell": {
      definitionId: "spell:counterspell",
      revision: "1",
      rulesBasis: "srd5.1-2014",
      mechanicalKey: "counterspell",
      activation: { kind: "reactionSpell", spellLevel: "3" },
      costs: [{ kind: "spellSlot", level: "3", amount: "1" }],
      effect: { kind: "counterspell", rangeInches: "720" },
    },
  };
  const initialState = {
    version: "0",
    activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    story: { chapterId: "chapter:ritual", status: "active", endingCandidates: [] },
    scenes: { "scene:ritual": { sceneId: "scene:ritual", geometry: { unit: "inch", obstacles: [], clearanceZones: [] } } },
    entities: { "pc:caster": caster, "npc:attacker": attacker },
    definitions,
    encounters: encounter ? {
      "encounter:ritual": {
        encounterId: "encounter:ritual",
        sceneId: "scene:ritual",
        status: "active",
        participantEntityIds: ["pc:caster", "npc:attacker"],
        initiativeGroups: [
          { entryId: "initiative:caster", combatantEntityIds: ["pc:caster"] },
          { entryId: "initiative:attacker", combatantEntityIds: ["npc:attacker"] },
        ],
        hostilities: [{ fromEntityIds: ["npc:attacker"], toEntityIds: ["pc:caster"] }],
        battlefieldFactIds: [],
        surprisedEntityIds: [],
        initiative: {
          entries: [
            { entryId: "initiative:caster", combatantEntityIds: ["pc:caster"], total: 20 },
            { entryId: "initiative:attacker", combatantEntityIds: ["npc:attacker"], total: 10 },
          ],
          ordered: true,
        },
        round: 1,
        turnCursor: 0,
        activeEntityId: "pc:caster",
        turnOrderEntityIds: ["pc:caster", "npc:attacker"],
        roundClosed: false,
      },
    } : {},
    effects: {},
    pendingInputs: {},
  };
  const unsigned = {
    kind: "roomGenesis",
    roomId: `room:long-casting:${encounter ? "combat" : "ritual"}`,
    runtimeEpochId: "epoch:long-casting:v1",
    profiles: PROFILES,
    moduleRef: { profileId: "module:long-casting", profileHash: hash({ module: "long-casting" }) },
    initialDefinitionCatalogRef: { profileId: "catalog:long-casting", profileHash: hash({ definitions: Object.keys(definitions) }) },
    initialState,
    initialStateHash: hash(initialState),
  };
  return { ...unsigned, genesisHash: hash(unsigned) };
}

function scenario(genesis = makeGenesis()) {
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

function fulfill(current, waiting, faceForPurpose) {
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  return apply(current, {
    kind: "authoritativeRandomness",
    resolutionId: waiting.resolutionId,
    responseId: `authority:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({
      randomnessId: request.randomnessId,
      requestHash: request.requestHash,
      draws: request.dice.map((term) => ({
        sides: Number(term.sides),
        faces: Array.from({ length: Number(term.count) }, () =>
          Math.min(Number(term.sides), faceForPurpose(request.purposeKey))),
      })),
    })),
  });
}

function casterView(current) {
  return project(PROFILES, current.state, {
    kind: "player",
    principalId: "principal:caster",
    characterId: "pc:caster",
  });
}

function startLongCast(current, { ritual = false, suffix = "normal" } = {}) {
  return apply(current, {
    kind: "invokeAbility",
    rootActionId: `root:long-cast:${suffix}`,
    sourceEntityId: "pc:caster",
    abilityRef: "spell:slow-ward",
    parameters: { targetEntityId: "pc:caster", ritual },
  });
}

function advanceFictionTime(current, micros, suffix) {
  return apply(current, {
    kind: "resolveFreeAction",
    proposalId: `proposal:b38:${suffix}:wait`,
    characterId: "pc:caster",
    goal: "continue the uninterrupted casting work",
    method: "remain focused while fictional time passes",
    feasibility: { kind: "directSuccess", publicBasis: "The caster can continue uninterrupted." },
    outcome: { publicResult: "The casting time passes.", fictionTimeCostMicros: String(micros) },
  });
}

test("B38 starts a long spell as an Activity, invests the current action, and does not spend its slot early", () => {
  const started = startLongCast(scenario());
  assert.equal(started.result.kind, "committed", JSON.stringify(started.result));
  assert.deepEqual(
    started.result.events.map(({ eventType }) => eventType),
    ["ActivityStarted", "AbilityInvoked", "ConcentrationStarted"],
  );
  const view = casterView(started.current);
  assert.equal(view.entities["pc:caster"].turn.action, "0");
  assert.equal(view.controlledCharacter.combat.resources["spellSlot:1"].current, "1");
  assert.equal(view.entities["pc:caster"].concentration.kind, "longSpellcasting");
  const activity = started.current.state.campaignRuntime.activities["activity:long-spell:root:long-cast:normal"];
  assert.equal(activity.activityKind, "longSpellcasting");
  assert.equal(activity.intendedDurationMicros, "12000000");
  assert.equal(activity.status, "active");
});

test("B38 requires an action on every combat round and spends the slot only when the long spell completes", () => {
  let current = startLongCast(scenario()).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:round1:caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:round1:attacker-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "npc:attacker",
  }).current;
  assert.equal(current.state.fictionTimelines["branch:main"].nowMicros, "6000000");

  const continued = apply(current, {
    kind: "continueLongSpellcasting",
    rootActionId: "root:b38:round2:continue",
    activityId: "activity:long-spell:root:long-cast:normal",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  });
  assert.equal(continued.result.kind, "committed", JSON.stringify(continued.result));
  assert.deepEqual(continued.result.events.map(({ eventType }) => eventType), ["AbilityInvoked"]);
  assert.equal(continued.current.state.combatRuntime.entities["pc:caster"].turn.action, "0");
  assert.equal(continued.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
  assert.equal(continued.current.state.combatRuntime.entities["pc:caster"].concentration.investedActionRounds, 2);

  current = apply(continued.current, {
    kind: "endTurn",
    rootActionId: "root:b38:round2:caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:round2:attacker-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "npc:attacker",
  }).current;
  assert.equal(current.state.fictionTimelines["branch:main"].nowMicros, "12000000");

  const originalIntent = {
    kind: "endTurn",
    rootActionId: "root:b38:round3:caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  };
  const completed = apply(current, originalIntent);
  assert.equal(completed.result.kind, "committed", JSON.stringify(completed.result));
  assert.equal(completed.result.mechanicalResult.retryOriginalIntent, true);
  assert.equal(completed.result.events[0].rootActionId, "long-spell-due:activity:long-spell:root:long-cast:normal:12000000");
  assert.deepEqual(completed.result.events.map(({ eventType }) => eventType), [
    "ActivityCompleted",
    "ConcentrationEnded",
    "ResourceSpent",
    "SpellCastingStarted",
    "AbilityInvoked",
    "ConcentrationStarted",
    "SpellResolved",
  ]);
  assert.equal(completed.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "0");
  assert.equal(completed.current.state.campaignRuntime.activities["activity:long-spell:root:long-cast:normal"].status, "completed");
  assert.equal(completed.current.state.combatRuntime.entities["pc:caster"].concentration.abilityRef, "spell:slow-ward");
  assert.equal(completed.result.events.some(({ eventType }) => eventType === "TurnEnded"), false);

  const retried = apply(completed.current, originalIntent);
  assert.equal(retried.result.kind, "committed", JSON.stringify(retried.result));
  assert.equal(retried.result.events[0].eventType, "TurnEnded");
});

test("B38 interrupts a long-spell Activity on a failed damage concentration save and never spends the deferred slot", () => {
  let current = startLongCast(scenario(), { suffix: "damaged" }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:damaged:caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  }).current;
  const attacked = apply(current, {
    kind: "invokeAbility",
    rootActionId: "root:b38:damage-caster",
    sourceEntityId: "npc:attacker",
    abilityRef: "attack:club",
    parameters: { targetEntityId: "pc:caster" },
  });
  assert.equal(attacked.result.kind, "awaitingRandomness", JSON.stringify(attacked.result));
  const damageResolved = fulfill(attacked.current, attacked.result, (purposeKey) => {
    if (purposeKey.startsWith("attack:")) return 20;
    if (purposeKey.startsWith("damage:")) return 4;
    return 1;
  });
  assert.equal(damageResolved.result.kind, "awaitingRandomness", JSON.stringify(damageResolved.result));
  const damaged = fulfill(damageResolved.current, damageResolved.result, () => 1);
  assert.equal(damaged.result.kind, "committed", JSON.stringify(damaged.result));
  assert.equal(damaged.result.events.some(({ eventType }) => eventType === "ConcentrationEnded"), true);
  assert.equal(damaged.current.state.combatRuntime.entities["pc:caster"].concentration, null);
  assert.equal(damaged.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
  assert.equal(
    damaged.current.state.campaignRuntime.activities["activity:long-spell:root:long-cast:damaged"].status,
    "interrupted",
  );

  current = apply(damaged.current, {
    kind: "endTurn",
    rootActionId: "root:b38:damaged:round1-attacker-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "npc:attacker",
  }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:damaged:round2-caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:damaged:round2-attacker-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "npc:attacker",
  }).current;
  const afterDue = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:damaged:after-due",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  });
  assert.equal(afterDue.result.kind, "committed", JSON.stringify(afterDue.result));
  assert.equal(afterDue.result.events[0].eventType, "TurnEnded");
  assert.equal(afterDue.result.events.some(({ eventType }) => eventType === "ActivityCompleted"), false);
  assert.equal(afterDue.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
});

test("B38 incapacity from damage interrupts the Activity before its deferred effect or slot cost can occur", () => {
  let current = startLongCast(scenario(makeGenesis({ casterHitPoints: 4 })), {
    suffix: "incapacitated",
  }).current;
  const activityId = "activity:long-spell:root:long-cast:incapacitated";
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:incapacitated:caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  }).current;
  const attacked = apply(current, {
    kind: "invokeAbility",
    rootActionId: "root:b38:incapacitated:damage",
    sourceEntityId: "npc:attacker",
    abilityRef: "attack:club",
    parameters: { targetEntityId: "pc:caster" },
  });
  const damageResolved = fulfill(attacked.current, attacked.result, (purposeKey) =>
    purposeKey.startsWith("damage:") ? 4 : 10);
  assert.equal(damageResolved.result.kind, "awaitingInput", JSON.stringify(damageResolved.result));
  assert.equal(damageResolved.result.pending.choiceKind, "knockOut");
  const incapacitated = apply(damageResolved.current, {
    kind: "answerPendingInput",
    pendingInputId: damageResolved.result.pending.pendingInputId,
    responseId: "response:b38:incapacitated:lethal",
    answer: { kind: "dealLethalDamage" },
  });
  assert.equal(incapacitated.result.kind, "committed", JSON.stringify(incapacitated.result));
  assert.equal(incapacitated.result.events.some(({ eventType }) => eventType === "ConcentrationEnded"), true);
  assert.equal(incapacitated.result.events.some(({ eventType }) => eventType === "SpellResolved"), false);
  const caster = incapacitated.current.state.combatRuntime.entities["pc:caster"];
  assert.equal(caster.lifeState, "unconscious");
  assert.equal(caster.concentration, null);
  assert.equal(caster.resources["spellSlot:1"].current, "1");
  assert.equal(incapacitated.current.state.campaignRuntime.activities[activityId].status, "interrupted");
  const view = casterView(incapacitated.current);
  assert.equal(view.entities["pc:caster"].concentration, null);
  assert.equal(view.activities.find(({ activityId: id }) => id === activityId).status, "interrupted");
  const replayed = replay(
    incapacitated.current.genesis,
    structuredClone(incapacitated.current.events),
  );
  assert.equal(replayed?.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.state.campaignRuntime.activities[activityId].status, "interrupted");
  assert.equal(replayed.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
});

test("B38 interrupts long casting when the caster ends a later turn without investing that round's action", () => {
  let current = startLongCast(scenario(), { suffix: "missed-round" }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:missed:round1-caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  }).current;
  current = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:missed:round1-attacker-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "npc:attacker",
  }).current;
  const missed = apply(current, {
    kind: "endTurn",
    rootActionId: "root:b38:missed:round2-caster-end",
    encounterId: "encounter:ritual",
    sourceEntityId: "pc:caster",
  });
  assert.equal(missed.result.kind, "committed", JSON.stringify(missed.result));
  assert.deepEqual(missed.result.events.map(({ eventType }) => eventType).slice(0, 3), [
    "ActivityInterrupted",
    "ConcentrationEnded",
    "TurnEnded",
  ]);
  assert.equal(
    missed.current.state.campaignRuntime.activities["activity:long-spell:root:long-cast:missed-round"].status,
    "interrupted",
  );
  assert.equal(missed.current.state.combatRuntime.entities["pc:caster"].concentration, null);
  assert.equal(missed.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
});

test("B38 voluntary Activity interruption also ends long-spell concentration and preserves the unspent effect", () => {
  const started = startLongCast(scenario(makeGenesis({ encounter: false })), {
    suffix: "voluntary-stop",
  });
  const activityId = "activity:long-spell:root:long-cast:voluntary-stop";
  const interrupted = apply(started.current, {
    kind: "interruptActivity",
    proposalId: "proposal:b38:voluntary-stop",
    activityId,
    cause: { kind: "voluntaryStop" },
  });
  assert.equal(interrupted.result.kind, "committed", JSON.stringify(interrupted.result));
  assert.deepEqual(interrupted.result.events.map(({ eventType }) => eventType), [
    "ActivityInterrupted",
    "ConcentrationEnded",
  ]);
  const view = casterView(interrupted.current);
  assert.equal(view.entities["pc:caster"].concentration, null);
  assert.equal(view.controlledCharacter.combat.resources["spellSlot:1"].current, "1");
  assert.equal(view.activities.find(({ activityId: id }) => id === activityId).status, "interrupted");

  const elapsed = advanceFictionTime(interrupted.current, "12000000", "voluntary-stop");
  const afterDue = apply(elapsed.current, {
    kind: "resolveFreeAction",
    proposalId: "proposal:b38:voluntary-stop:after-due",
    characterId: "pc:caster",
    goal: "inspect the abandoned casting",
    method: "confirm that no spell effect occurred",
    feasibility: { kind: "directSuccess", publicBasis: "The interrupted casting is inert." },
    outcome: { publicResult: "No spell effect appears." },
  });
  assert.equal(afterDue.result.kind, "committed", JSON.stringify(afterDue.result));
  assert.equal(afterDue.result.events.some(({ eventType }) => eventType === "ActivityCompleted"), false);
  assert.equal(afterDue.result.events.some(({ eventType }) => eventType === "SpellResolved"), false);
  assert.equal(afterDue.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
  const replayed = replay(afterDue.current.genesis, structuredClone(afterDue.current.events));
  assert.equal(replayed?.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.state.campaignRuntime.activities[activityId].status, "interrupted");
  assert.equal(replayed.state.combatRuntime.entities["pc:caster"].concentration, null);
});

test("B38 adds exactly ten fictional minutes for a legal ritual and completes without consuming its spell slot", () => {
  const started = startLongCast(scenario(makeGenesis({ encounter: false })), {
    ritual: true,
    suffix: "ritual",
  });
  assert.equal(started.result.kind, "committed", JSON.stringify(started.result));
  const activityId = "activity:long-spell:root:long-cast:ritual";
  assert.equal(started.current.state.campaignRuntime.activities[activityId].intendedDurationMicros, "612000000");
  assert.equal(started.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");

  const elapsed = advanceFictionTime(started.current, "612000000", "ritual");
  assert.equal(elapsed.result.kind, "committed", JSON.stringify(elapsed.result));
  assert.equal(elapsed.current.state.campaignRuntime.activities[activityId].status, "active");
  const originalIntent = {
    kind: "resolveFreeAction",
    proposalId: "proposal:b38:ritual:after-due",
    characterId: "pc:caster",
    goal: "observe the completed ritual",
    method: "inspect the resulting ward",
    feasibility: { kind: "directSuccess", publicBasis: "The ritual duration has elapsed." },
    outcome: { publicResult: "The ward is complete." },
  };
  const completed = apply(elapsed.current, originalIntent);
  assert.equal(completed.result.kind, "committed", JSON.stringify(completed.result));
  assert.equal(completed.result.mechanicalResult.retryOriginalIntent, true);
  assert.equal(completed.current.state.campaignRuntime.activities[activityId].status, "completed");
  assert.equal(completed.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "1");
  assert.equal(completed.result.events.some(({ eventType }) => eventType === "ResourceSpent"), false);
  assert.equal(completed.result.events.some(({ eventType }) => eventType === "SpellResolved"), true);
  const replayed = replay(completed.current.genesis, structuredClone(completed.current.events));
  assert.equal(replayed?.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.head.stateHash, completed.current.events.at(-1).stateHashAfter);
});

test("B38 commits the completed long spell's slot before ordinary Counterspell and never refunds it", () => {
  const started = startLongCast(scenario(makeGenesis({
    encounter: false,
    counterspeller: true,
  })), { suffix: "countered" });
  const elapsed = advanceFictionTime(started.current, "12000000", "countered");
  const completion = apply(elapsed.current, {
    kind: "resolveFreeAction",
    proposalId: "proposal:b38:countered:after-due",
    characterId: "pc:caster",
    goal: "finish the long spell",
    method: "release the completed ward",
    feasibility: { kind: "directSuccess", publicBasis: "The casting duration has elapsed." },
    outcome: { publicResult: "The ward is released." },
  });
  assert.equal(completion.result.kind, "awaitingInput", JSON.stringify(completion.result));
  assert.deepEqual(completion.result.events.map(({ eventType }) => eventType), [
    "ActivityCompleted",
    "ConcentrationEnded",
    "ResourceSpent",
    "SpellCastingStarted",
    "ReactionOpportunityOpened",
  ]);
  assert.equal(completion.result.pending.reactionKind, "counterspell");
  assert.equal(completion.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "0");

  const countered = apply(completion.current, {
    kind: "answerPendingInput",
    pendingInputId: completion.result.pending.pendingInputId,
    responseId: "response:b38:countered:use-counterspell",
    answer: { kind: "useReaction", abilityRef: "spell:counterspell", slotLevel: "3" },
  });
  assert.equal(countered.result.kind, "committed", JSON.stringify(countered.result));
  assert.equal(countered.result.events.some(({ eventType }) => eventType === "SpellCountered"), true);
  assert.equal(countered.result.events.some(({ eventType, payload }) =>
    eventType === "SpellResolved" && payload.abilityRef === "spell:slow-ward"), false);
  assert.equal(countered.current.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "0");
  assert.equal(countered.current.state.combatRuntime.entities["npc:attacker"].resources["spellSlot:3"].current, "0");
  assert.equal(countered.current.state.combatRuntime.entities["pc:caster"].concentration, null);
  const replayed = replay(countered.current.genesis, structuredClone(countered.current.events));
  assert.equal(replayed?.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.state.combatRuntime.entities["pc:caster"].resources["spellSlot:1"].current, "0");
  assert.equal(replayed.state.combatRuntime.entities["pc:caster"].concentration, null);
});
