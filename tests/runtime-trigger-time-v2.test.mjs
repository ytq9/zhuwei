import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { project, replay, step } from "../app/_runtime/lib/rules/index.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";

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

const SYNTHETIC_NEXT_PROFILES = Object.freeze({
  ...structuredClone(PROFILES),
  manifest: {
    profileId: "runtime-srd51-2014-authoritative-time-test-v3",
    profileHash: `sha256:${"a".repeat(64)}`,
  },
  triggerOrdering: {
    profileId: "trigger-initiative-order-2014-time-test-v2",
    profileHash: `sha256:${"c".repeat(64)}`,
  },
  fictionCombatTime: {
    profileId: "combat-round-six-seconds-2014-time-test-v2",
    profileHash: `sha256:${"d".repeat(64)}`,
  },
  extensions: [
    ...structuredClone(PROFILES.extensions),
    {
      profileId: "runtime-time-test-extension-srd51-2014-v1",
      profileHash: `sha256:${"b".repeat(64)}`,
    },
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

function combatant(id, ordinal, kind = "npc", principalId) {
  return {
    id,
    kind,
    name: id,
    ...(principalId === undefined ? {} : { controllerPrincipalId: principalId }),
    entityOrdinal: String(ordinal),
    sceneId: "scene:clock",
    position: { x: String(ordinal * 60), y: "0", elevation: "0" },
    footprint: { width: "60", depth: "60", height: "60" },
    stats: { str: "10", dex: "10", con: "10", int: "10", wis: "10", cha: "10" },
    proficiencyBonus: "2",
    armorClass: "10",
    hitPoints: { current: "1", maximum: "1", temporary: "0" },
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

function makeGenesis(entities, suffix = "base") {
  const initialState = {
    version: "0",
    activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    story: { chapterId: "chapter:clock", status: "active", endingCandidates: [] },
    scenes: { "scene:clock": { sceneId: "scene:clock", geometry: { unit: "inch", obstacles: [], clearanceZones: [] } } },
    entities,
    definitions: {},
    encounters: {},
    effects: {},
    pendingInputs: {},
  };
  const unsigned = {
    kind: "roomGenesis",
    roomId: `room:trigger-time:${suffix}`,
    runtimeEpochId: "epoch:trigger-time:v1",
    profiles: PROFILES,
    moduleRef: { profileId: "module:trigger-time", profileHash: hash({ module: "trigger-time" }) },
    initialDefinitionCatalogRef: { profileId: "catalog:trigger-time", profileHash: hash({ definitions: [] }) },
    initialState,
    initialStateHash: hash(initialState),
  };
  return { ...unsigned, genesisHash: hash(unsigned) };
}

function initialWorld(genesis) {
  const result = replay(genesis, []);
  assert.equal(result?.kind, "replayed", JSON.stringify(result));
  return result.state;
}

function scenario(genesis) {
  return { genesis, events: [], state: initialWorld(genesis) };
}

function apply(current, input) {
  const result = step(PROFILES, current.state, input);
  const events = [...current.events, ...(result.events ?? [])];
  const rebuilt = replay(current.genesis, events);
  assert.equal(rebuilt?.kind, "replayed", JSON.stringify(rebuilt));
  return { current: { ...current, events, state: rebuilt.state }, result };
}

function fulfill(current, waiting, facesByIndex = []) {
  assert.equal(waiting.kind, "awaitingRandomness");
  return apply(current, {
    kind: "authoritativeRandomness",
    resolutionId: waiting.resolutionId,
    responseId: `authority:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request, requestIndex) => ({
      randomnessId: request.randomnessId,
      requestHash: request.requestHash,
      draws: request.dice.map((term) => ({
        sides: Number(term.sides),
        faces: Array.from({ length: Number(term.count) }, () =>
          Math.min(Number(term.sides), facesByIndex[requestIndex] ?? requestIndex + 1)),
      })),
    })),
  });
}

function startEncounterScenario({ entryGroups, suffix }) {
  const ids = [...new Set(entryGroups.flat())];
  const entities = Object.fromEntries(ids.map((id, index) => [
    id,
    combatant(id, index + 1, index === 0 ? "player" : "npc", index === 0 ? `principal:${suffix}` : undefined),
  ]));
  let current = scenario(makeGenesis(entities, suffix));
  const started = apply(current, {
    kind: "startEncounter",
    rootActionId: `root:${suffix}:start`,
    proposalAttemptId: `proposal:${suffix}:start`,
    encounterId: `encounter:${suffix}`,
    sceneId: "scene:clock",
    participantEntityIds: [...ids],
    dynamicEntities: [],
    initiativeGroups: entryGroups.map((members, index) => ({
      entryId: `initiative:${suffix}:${index + 1}`,
      combatantEntityIds: [...members],
    })),
    hostilities: [{ fromEntityIds: [ids[0]], toEntityIds: ids.slice(1) }],
    battlefieldFactIds: [],
  });
  current = started.current;
  const established = fulfill(current, started.result, entryGroups.map((_, index) => 20 - index));
  assert.equal(established.result.kind, "committed", JSON.stringify(established.result));
  return { current: established.current, encounterId: `encounter:${suffix}`, principalId: `principal:${suffix}`, characterId: ids[0] };
}

function readyEffect(rootActionId, sourceEntityId, triggerSourceEntityId, endpointX) {
  return {
    effectId: `effect:ready:${rootActionId}`,
    kind: "readiedAction",
    sourceEntityId,
    encounterId: "encounter:ready",
    trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: triggerSourceEntityId },
    response: {
      kind: "move",
      movementMode: "walk",
      path: [
        { x: String(({ "pc:a": 0, "pc:b": 60, "pc:c": 120 })[sourceEntityId]), y: "0", elevation: "0" },
        { x: String(endpointX), y: "0", elevation: "0" },
      ],
    },
    createdRound: 1,
    expiresAt: { kind: "turnStart", entityId: sourceEntityId },
    spellAlreadyCast: false,
  };
}

function makeReadyGenesis({
  effectOrder,
  sameController = false,
  sharedEndpoint = false,
  clearSharedEndpointLane = false,
  suffix,
}) {
  const controllers = {
    "pc:a": sameController ? "principal:shared" : "principal:a",
    "pc:b": sameController ? "principal:shared" : "principal:b",
    "pc:c": "principal:c",
  };
  const ids = ["pc:a", "pc:b", "pc:c", "npc:causal"];
  const entities = Object.fromEntries(ids.map((id, index) => [
    id,
    {
      ...combatant(id, index + 1, id.startsWith("pc:") ? "player" : "npc", controllers[id]),
      position: { x: String(index * 60), y: "0", elevation: "0" },
      turn: { action: "0", bonusAction: "0", reaction: "1", attacksRemaining: "0", leveledBonusActionSpell: false },
    },
  ]));
  const endpoints = { "pc:a": 300, "pc:b": sharedEndpoint ? 300 : 360, "pc:c": 420 };
  const effects = Object.fromEntries(effectOrder.map((sourceEntityId) => {
    const effect = readyEffect(`seed:${sourceEntityId}`, sourceEntityId, "npc:causal", endpoints[sourceEntityId]);
    return [effect.effectId, effect];
  }));
  if (clearSharedEndpointLane) {
    entities["pc:a"].position = { x: "0", y: "60", elevation: "0" };
    effects["effect:ready:seed:pc:a"].response.path = [
      { x: "0", y: "60", elevation: "0" },
      { x: "300", y: "60", elevation: "0" },
    ];
    effects["effect:ready:seed:pc:b"].response.path = [
      { x: "60", y: "0", elevation: "0" },
      { x: "300", y: "60", elevation: "0" },
    ];
  }
  const genesis = makeGenesis(entities, suffix);
  genesis.initialState.effects = effects;
  genesis.initialState.encounters = {
    "encounter:ready": {
      encounterId: "encounter:ready",
      sceneId: "scene:clock",
      status: "active",
      participantEntityIds: ids,
      initiativeGroups: ids.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
      hostilities: [{ fromEntityIds: ["pc:a", "pc:b", "pc:c"], toEntityIds: ["npc:causal"] }],
      battlefieldFactIds: [],
      surprisedEntityIds: [],
      initiative: { entries: ids.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id], total: 10 })), ordered: true },
      round: 1,
      turnCursor: 2,
      activeEntityId: "pc:c",
      turnOrderEntityIds: ids,
      roundClosed: false,
    },
  };
  genesis.initialStateHash = hash(genesis.initialState);
  const unsigned = { ...genesis };
  delete unsigned.genesisHash;
  genesis.genesisHash = hash(unsigned);
  return genesis;
}

function openSeededReadyBatch(genesis, rootActionId = "root:ready:causal-turn") {
  const current = scenario(genesis);
  return apply(current, {
    kind: "endTurn",
    rootActionId,
    encounterId: "encounter:ready",
    sourceEntityId: "pc:c",
  });
}

const SPELL_DEFINITIONS = {
  "spell:test-bolt": {
    definitionId: "spell:test-bolt",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "0" },
    target: { kind: "creature", count: "1", rangeInches: "720", requiresSight: true },
    attack: { kind: "spellAttack" },
    damage: [{ type: "force", formula: "1d4" }],
  },
  "spell:test-counterspell": {
    definitionId: "spell:test-counterspell",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    mechanicalKey: "counterspell",
    activation: { kind: "reactionSpell", spellLevel: "3" },
    costs: [{ kind: "spellSlot", level: "3", amount: "1" }],
    effect: { kind: "counterspell", rangeInches: "720" },
  },
};

function spellEntity(id, ordinal, kind, abilities) {
  const entity = combatant(id, ordinal, kind, kind === "player" ? `principal:${id}` : undefined);
  entity.position = { x: String((ordinal - 1) * 60), y: "0", elevation: "0" };
  entity.abilityRefs = [...abilities];
  entity.spellcasting = { ability: "int", spellAttackBonus: "2", spellSaveDc: "10" };
  entity.resources = abilities.includes("spell:test-counterspell")
    ? { "spellSlot:3": { current: "3", maximum: "3" } }
    : {};
  return entity;
}

function makeSpellGenesis(entries, suffix) {
  const entities = Object.fromEntries(entries.map(({ id, ordinal, kind, abilities }) => [
    id,
    spellEntity(id, ordinal, kind, abilities),
  ]));
  const genesis = makeGenesis(entities, suffix);
  genesis.initialState.definitions = structuredClone(SPELL_DEFINITIONS);
  genesis.initialStateHash = hash(genesis.initialState);
  const unsigned = { ...genesis };
  delete unsigned.genesisHash;
  genesis.genesisHash = hash(unsigned);
  return genesis;
}

function makeSpellEncounterGenesis(entries, suffix, activeEntityId) {
  const genesis = makeSpellGenesis(entries, suffix);
  const ids = entries.map(({ id }) => id);
  for (const id of ids) {
    genesis.initialState.entities[id].turn = {
      action: id === activeEntityId ? "1" : "0",
      bonusAction: id === activeEntityId ? "1" : "0",
      reaction: "1",
      attacksRemaining: id === activeEntityId ? "1" : "0",
      leveledBonusActionSpell: false,
    };
  }
  genesis.initialState.encounters = {
    "encounter:spell-order": {
      encounterId: "encounter:spell-order",
      sceneId: "scene:clock",
      status: "active",
      participantEntityIds: ids,
      initiativeGroups: ids.map((id) => ({
        entryId: `initiative:${id}`,
        combatantEntityIds: [id],
      })),
      hostilities: [{ fromEntityIds: [ids[0]], toEntityIds: ids.slice(1) }],
      battlefieldFactIds: [],
      surprisedEntityIds: [],
      initiative: {
        entries: ids.map((id) => ({
          entryId: `initiative:${id}`,
          combatantEntityIds: [id],
          total: 10,
        })),
        ordered: true,
      },
      round: 1,
      turnCursor: ids.indexOf(activeEntityId),
      activeEntityId,
      turnOrderEntityIds: ids,
      roundClosed: false,
    },
  };
  genesis.initialStateHash = hash(genesis.initialState);
  const unsigned = { ...genesis };
  delete unsigned.genesisHash;
  genesis.genesisHash = hash(unsigned);
  return genesis;
}

function openSpellTrigger(genesis, rootActionId, sourceEntityId, targetEntityId) {
  return apply(scenario(genesis), {
    kind: "invokeAbility",
    rootActionId,
    sourceEntityId,
    abilityRef: "spell:test-bolt",
    parameters: { targetEntityId },
  });
}

function makeCampaignGenesis(suffix) {
  const initialState = {
    version: "0",
    activeBranchId: "branch:main",
    fictionTimelines: { "branch:main": { branchId: "branch:main", nowMicros: "0" } },
    campaign: {
      campaignId: "campaign:time",
      advancementProfile: "milestone",
      currentChapterId: "chapter:one",
      status: "active",
    },
    chapters: {
      "chapter:one": { chapterId: "chapter:one", ordinal: "1", status: "active", sceneQuestionId: "question:time" },
    },
    entities: {
      "pc:alpha": {
        id: "pc:alpha",
        kind: "player",
        name: "Alpha",
        controllerPrincipalId: "principal:alpha",
        sceneId: "scene:alpha",
        tenureStatus: "active",
        classId: "fighter",
        level: 3,
        hitPoints: { current: 10, maximum: 10 },
        resources: { focus: 1, hitDice: 0 },
        resourceMaximums: { focus: 1, hitDice: 3 },
        abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      },
      "pc:beta": {
        id: "pc:beta",
        kind: "player",
        name: "Beta",
        controllerPrincipalId: "principal:beta",
        sceneId: "scene:beta",
        tenureStatus: "active",
        classId: "fighter",
        level: 3,
        hitPoints: { current: 10, maximum: 10 },
        resources: { focus: 1, hitDice: 0 },
        resourceMaximums: { focus: 1, hitDice: 3 },
        abilityScores: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      },
    },
    artifacts: {},
    canonicalFacts: {
      "fact:time-anchor": {
        factId: "fact:time-anchor",
        kind: "moduleAnchor",
        subjectRefs: ["pc:alpha", "pc:beta"],
        value: "The clock and both scenes are established.",
        visibility: "public",
      },
    },
    knowledge: { "pc:alpha": [], "pc:beta": [] },
    relationships: {},
    promises: {},
    debts: {},
    factions: {},
    activities: {},
    unresolvedThreats: [],
  };
  const unsigned = {
    kind: "roomGenesis",
    roomId: `room:campaign-time:${suffix}`,
    runtimeEpochId: "epoch:campaign-time:v1",
    profiles: PROFILES,
    moduleRef: { profileId: "module:campaign-time", profileHash: hash({ module: "campaign-time" }) },
    initialDefinitionCatalogRef: { profileId: "catalog:campaign-time", profileHash: hash({ definitions: [] }) },
    initialState,
    initialStateHash: hash(initialState),
  };
  return { ...unsigned, genesisHash: hash(unsigned) };
}

function advanceCampaignTime(current, characterId, micros, suffix) {
  return apply(current, {
    kind: "resolveFreeAction",
    proposalId: `proposal:${suffix}:advance`,
    characterId,
    goal: `wait ${micros} micros`,
    method: "explicitly wait in the fiction",
    feasibility: { kind: "directSuccess", publicBasis: "The wait is possible and uninterrupted." },
    outcome: { publicResult: "Time passes.", fictionTimeCostMicros: String(micros) },
  });
}

function concludeEncounter(current, encounterId, suffix) {
  let answered = apply(current, {
    kind: "proposeEncounterConclusion",
    rootActionId: `root:${suffix}:propose-conclusion`,
    encounterId,
    proposal: { reason: "hostilitiesEnded" },
  });
  let responseIndex = 0;
  while (answered.result.kind === "awaitingInput") {
    assert.equal(answered.result.pending.choiceKind, "encounterConclusion");
    responseIndex += 1;
    answered = apply(answered.current, {
      kind: "answerPendingInput",
      pendingInputId: answered.result.pending.pendingInputId,
      responseId: `response:${suffix}:accept-conclusion:${responseIndex}`,
      answer: { kind: "acceptEncounterConclusion" },
    });
  }
  return answered;
}

function activityCompletion(characterId, sourceSceneId) {
  return {
    method: "finish the established work",
    primaryFactRef: "fact:time-anchor",
    sourceSceneId,
    success: [{ kind: "changeResource", targetRef: characterId, resourceRef: "focus", amount: -1 }],
    failure: [],
  };
}

test("F09 accepts more than 4096 individuals in a mechanically shared initiative entry and diagnoses too many entries without truncation", () => {
  const entities = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => {
    const id = `npc:shared:${String(index + 1).padStart(4, "0")}`;
    return [id, combatant(id, index + 1)];
  }));
  const participantEntityIds = Object.keys(entities);
  const state = initialWorld(makeGenesis(entities, "f09"));
  const shared = step(PROFILES, state, {
    kind: "startEncounter",
    rootActionId: "root:f09:shared",
    proposalAttemptId: "proposal:f09:shared",
    encounterId: "encounter:f09:shared",
    sceneId: "scene:clock",
    participantEntityIds: [...participantEntityIds],
    dynamicEntities: [],
    initiativeGroups: [{ entryId: "initiative:shared-swarm", combatantEntityIds: [...participantEntityIds] }],
    hostilities: [{ fromEntityIds: [participantEntityIds[0]], toEntityIds: participantEntityIds.slice(1) }],
    battlefieldFactIds: [],
  });
  assert.equal(shared.kind, "awaitingRandomness", JSON.stringify(shared));
  assert.equal(shared.randomnessRequests.length, 1);
  assert.equal(shared.randomnessRequests[0].frozenParameters.combatantEntityIds.length, 4097);

  const tooManyEntries = step(PROFILES, state, {
    kind: "startEncounter",
    rootActionId: "root:f09:ungrouped",
    proposalAttemptId: "proposal:f09:ungrouped",
    encounterId: "encounter:f09:ungrouped",
    sceneId: "scene:clock",
    participantEntityIds: [...participantEntityIds],
    dynamicEntities: [],
    initiativeGroups: participantEntityIds.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [participantEntityIds[0]], toEntityIds: participantEntityIds.slice(1) }],
    battlefieldFactIds: [],
  });
  assert.equal(tooManyEntries.kind, "rejected");
  assert.equal(tooManyEntries.rejection.code, "invalidRulesInput");
  assert.match(tooManyEntries.rejection.message, /4096.*shared initiative/i);
  assert.equal(tooManyEntries.events?.length ?? 0, 0);
});

test("F01/F02 close a one-entry, four-entry, or shared-entry round by six seconds exactly once and reality delay changes nothing", () => {
  const cases = [
    [["pc:one", "npc:one"]],
    [["pc:four"], ["npc:four:1"], ["npc:four:2"], ["npc:four:3"]],
    [["pc:shared", "npc:shared:1", "npc:shared:2", "npc:shared:3"]],
  ];
  for (const [caseIndex, entryGroups] of cases.entries()) {
    let { current, encounterId, principalId, characterId } = startEncounterScenario({
      entryGroups,
      suffix: `f01-${caseIndex + 1}`,
    });
    const order = current.state.combatRuntime.encounters[encounterId].turnOrderEntityIds;
    assert.equal(current.state.fictionTimelines["branch:main"].nowMicros, "0");
    for (const [turnIndex, sourceEntityId] of order.entries()) {
      const ended = apply(current, {
        kind: "endTurn",
        rootActionId: `root:f01:${caseIndex + 1}:turn:${turnIndex + 1}`,
        encounterId,
        sourceEntityId,
      });
      assert.equal(ended.result.kind, "committed", JSON.stringify(ended.result));
      current = ended.current;
      assert.equal(
        current.state.fictionTimelines["branch:main"].nowMicros,
        turnIndex === order.length - 1 ? "6000000" : "0",
      );
    }

    const beforeDelay = project(PROFILES, current.state, {
      kind: "player",
      principalId,
      characterId,
    }, { channel: "realtime" });
    const afterDelayReplay = replay(current.genesis, structuredClone(current.events));
    assert.equal(afterDelayReplay?.kind, "replayed");
    const afterDelay = project(PROFILES, afterDelayReplay.state, {
      kind: "player",
      principalId,
      characterId,
    }, { channel: "reconnect" });
    assert.deepEqual(afterDelay.fictionTime, beforeDelay.fictionTime);
    assert.deepEqual(afterDelay.encounters, beforeDelay.encounters);
  }
});

test("T01/T03/T06 freeze a stable batch, rotate from the causal initiative slot, and hold its private window across replay", () => {
  const left = openSeededReadyBatch(makeReadyGenesis({
    effectOrder: ["pc:c", "pc:a", "pc:b"],
    suffix: "t01-left",
  }));
  const right = openSeededReadyBatch(makeReadyGenesis({
    effectOrder: ["pc:b", "pc:c", "pc:a"],
    suffix: "t01-right",
  }));
  assert.equal(left.result.kind, "awaitingInput");
  assert.equal(right.result.kind, "awaitingInput");
  assert.equal(left.result.pending.controllerEntityId, "pc:a");
  assert.equal(right.result.pending.controllerEntityId, "pc:a");
  assert.equal(left.result.pending.triggerBatchHash, right.result.pending.triggerBatchHash);
  assert.match(left.result.pending.triggerBatchHash, /^sha256:[0-9a-f]{64}$/);

  let current = left.current;
  const firstBatchId = left.result.pending.triggerBatchId;
  for (const expectedController of ["pc:a", "pc:b", "pc:c"]) {
    const pending = Object.values(current.state.combatRuntime.pendingInputs)[0];
    assert.equal(pending.controllerEntityId, expectedController);
    assert.equal(pending.triggerBatchId, firstBatchId);
    const replayed = replay(current.genesis, structuredClone(current.events));
    assert.equal(replayed?.kind, "replayed");
    assert.deepEqual(replayed.state.combatRuntime.pendingInputs, current.state.combatRuntime.pendingInputs);
    const heldTime = current.state.fictionTimelines["branch:main"].nowMicros;
    const blocked = step(PROFILES, current.state, {
      kind: "endTurn",
      rootActionId: `root:t06:timeout:${expectedController}`,
      encounterId: "encounter:ready",
      sourceEntityId: "npc:causal",
    });
    assert.equal(blocked.kind, "rejected");
    assert.equal(blocked.rejection.code, "pendingInputUnresolved");
    assert.equal(current.state.fictionTimelines["branch:main"].nowMicros, heldTime);
    const answered = apply(current, {
      kind: "answerPendingInput",
      pendingInputId: pending.pendingInputId,
      responseId: `response:decline:${expectedController}`,
      answer: { kind: "decline" },
    });
    current = answered.current;
  }
  assert.equal(Object.keys(current.state.combatRuntime.pendingInputs).length, 0);
});

test("T03 rotates a nested trigger batch from the frozen current initiative entry rather than its out-of-turn causal caster", () => {
  const genesis = makeSpellEncounterGenesis([
    { id: "pc:active-caster", ordinal: 1, kind: "player", abilities: ["spell:test-bolt", "spell:test-counterspell"] },
    { id: "pc:first-counter", ordinal: 2, kind: "player", abilities: ["spell:test-counterspell"] },
    { id: "pc:second-counter", ordinal: 3, kind: "player", abilities: ["spell:test-counterspell"] },
  ], "t03-current-slot", "pc:active-caster");
  const opened = openSpellTrigger(genesis, "root:t03:bolt", "pc:active-caster", "pc:first-counter");
  assert.equal(opened.result.kind, "awaitingInput");
  assert.equal(opened.result.pending.controllerEntityId, "pc:first-counter");

  const child = apply(opened.current, {
    kind: "answerPendingInput",
    pendingInputId: opened.result.pending.pendingInputId,
    responseId: "response:t03:first-counter",
    answer: { kind: "useReaction", abilityRef: "spell:test-counterspell", slotLevel: "3" },
  });
  assert.equal(child.result.kind, "awaitingInput");
  assert.equal(child.result.pending.controllerEntityId, "pc:active-caster");
});

test("T02 exposes same-controller noncommutative ordering only to that controller and honors the frozen choice", () => {
  const opened = openSeededReadyBatch(makeReadyGenesis({
    effectOrder: ["pc:b", "pc:a"],
    sameController: true,
    suffix: "t02",
  }));
  assert.equal(opened.result.kind, "awaitingInput");
  assert.equal(opened.result.pending.choiceKind, "triggerOrder");
  assert.equal(opened.result.pending.orderedTriggerInstanceIds.length, 2);
  const ownerView = project(PROFILES, opened.current.state, {
    kind: "player", principalId: "principal:shared", characterId: "pc:a",
  });
  const outsiderView = project(PROFILES, opened.current.state, {
    kind: "player", principalId: "principal:c", characterId: "pc:c",
  });
  assert.equal(ownerView.pendingInputs[0].orderedTriggerInstanceIds.length, 2);
  assert.equal(outsiderView.pendingInputs.length, 0);

  const reversed = [...opened.result.pending.orderedTriggerInstanceIds].reverse();
  const ordered = apply(opened.current, {
    kind: "answerPendingInput",
    pendingInputId: opened.result.pending.pendingInputId,
    responseId: "response:t02:reverse",
    answer: { orderedTriggerInstanceIds: reversed },
  });
  assert.equal(ordered.result.kind, "awaitingInput");
  assert.equal(ordered.result.pending.controllerEntityId, "pc:b");
  assert.equal(ordered.result.pending.triggerBatchHash, opened.result.pending.triggerBatchHash);
});

test("T04 revalidates each frozen Ready item, invalidates a now-occupied response without cost or retarget, and continues the batch", () => {
  let opened = openSeededReadyBatch(makeReadyGenesis({
    effectOrder: ["pc:b", "pc:a"],
    sharedEndpoint: true,
    clearSharedEndpointLane: true,
    suffix: "t04",
  }));
  assert.equal(opened.result.kind, "awaitingInput");
  assert.equal(opened.result.pending.controllerEntityId, "pc:a");
  const used = apply(opened.current, {
    kind: "answerPendingInput",
    pendingInputId: opened.result.pending.pendingInputId,
    responseId: "response:t04:a-moves",
    answer: { kind: "useReaction" },
  });
  assert.equal(used.result.kind, "committed");
  assert.deepEqual(
    used.result.events.map(({ eventType }) => eventType).filter((type) =>
      ["MovementSegmentCommitted", "TriggerInvalidated"].includes(type)),
    ["MovementSegmentCommitted", "TriggerInvalidated"],
  );
  assert.equal(used.current.state.combatRuntime.entities["pc:b"].turn.reaction, "1");
  assert.deepEqual(used.current.state.combatRuntime.entities["pc:b"].position, { x: "60", y: "0", elevation: "0" });
  assert.equal(Object.keys(used.current.state.combatRuntime.pendingInputs).length, 0);
});

test("T05 completes nested Counterspell child batches before resuming the frozen parent continuation", () => {
  const genesis = makeSpellGenesis([
    { id: "pc:caster", ordinal: 1, kind: "player", abilities: ["spell:test-bolt", "spell:test-counterspell"] },
    { id: "pc:first-counter", ordinal: 2, kind: "player", abilities: ["spell:test-counterspell"] },
    { id: "pc:second-counter", ordinal: 3, kind: "player", abilities: ["spell:test-counterspell"] },
  ], "t05");
  let opened = openSpellTrigger(genesis, "root:t05:bolt", "pc:caster", "pc:first-counter");
  assert.equal(opened.result.kind, "awaitingInput");
  assert.equal(opened.result.pending.controllerEntityId, "pc:first-counter");
  const parentBatchId = opened.result.pending.triggerBatchId;

  let child = apply(opened.current, {
    kind: "answerPendingInput",
    pendingInputId: opened.result.pending.pendingInputId,
    responseId: "response:t05:first-counter",
    answer: { kind: "useReaction", abilityRef: "spell:test-counterspell", slotLevel: "3" },
  });
  assert.equal(child.result.kind, "awaitingInput");
  assert.equal(child.result.pending.controllerEntityId, "pc:caster");
  assert.equal(child.result.pending.parentTriggerBatchId, parentBatchId);
  const childBatchId = child.result.pending.triggerBatchId;
  assert.notEqual(childBatchId, parentBatchId);

  let grandchild = apply(child.current, {
    kind: "answerPendingInput",
    pendingInputId: child.result.pending.pendingInputId,
    responseId: "response:t05:counter-the-counter",
    answer: { kind: "useReaction", abilityRef: "spell:test-counterspell", slotLevel: "3" },
  });
  assert.equal(grandchild.result.kind, "awaitingInput");
  assert.equal(grandchild.result.pending.controllerEntityId, "pc:second-counter");
  assert.equal(grandchild.result.pending.parentTriggerBatchId, childBatchId);

  const resumedParent = apply(grandchild.current, {
    kind: "answerPendingInput",
    pendingInputId: grandchild.result.pending.pendingInputId,
    responseId: "response:t05:decline-grandchild",
    answer: { kind: "decline" },
  });
  assert.equal(resumedParent.result.kind, "awaitingInput", JSON.stringify(resumedParent.result));
  assert.equal(resumedParent.result.pending.controllerEntityId, "pc:second-counter");
  assert.equal(resumedParent.result.pending.triggerBatchId, parentBatchId);
  assert.equal(resumedParent.result.pending.parentTriggerBatchId, undefined);
});

test("T07 orders noncombat entity triggers by causal ordinal and environment last, with replay-stable windows", () => {
  const genesis = makeSpellGenesis([
    { id: "environment:ward", ordinal: 1, kind: "environment", abilities: ["spell:test-counterspell"] },
    { id: "npc:second", ordinal: 3, kind: "npc", abilities: ["spell:test-counterspell"] },
    { id: "pc:caster", ordinal: 4, kind: "player", abilities: ["spell:test-bolt"] },
    { id: "npc:first", ordinal: 2, kind: "npc", abilities: ["spell:test-counterspell"] },
  ], "t07");
  let opened = openSpellTrigger(genesis, "root:t07:bolt", "pc:caster", "npc:first");
  const expected = ["npc:first", "npc:second", "environment:ward"];
  const batchHash = opened.result.pending.triggerBatchHash;
  for (const controllerEntityId of expected) {
    assert.equal(opened.result.kind, "awaitingInput");
    assert.equal(opened.result.pending.controllerEntityId, controllerEntityId);
    assert.equal(opened.result.pending.triggerBatchHash, batchHash);
    const rebuilt = replay(opened.current.genesis, structuredClone(opened.current.events));
    assert.equal(rebuilt?.kind, "replayed");
    assert.equal(
      Object.values(rebuilt.state.combatRuntime.pendingInputs)[0].controllerEntityId,
      controllerEntityId,
    );
    opened = apply(opened.current, {
      kind: "answerPendingInput",
      pendingInputId: opened.result.pending.pendingInputId,
      responseId: `response:t07:${controllerEntityId}`,
      answer: { kind: "decline" },
    });
  }
  assert.equal(opened.result.kind, "awaitingRandomness");
});

test("T07 orders simultaneous environment triggers by definition, source, and trigger id instead of object insertion", () => {
  const genesis = makeSpellGenesis([
    { id: "environment:a-source", ordinal: 1, kind: "environment", abilities: ["spell:z-counterspell"] },
    { id: "pc:caster", ordinal: 4, kind: "player", abilities: ["spell:test-bolt"] },
    { id: "environment:z-source", ordinal: 2, kind: "environment", abilities: ["spell:a-counterspell"] },
    { id: "npc:first", ordinal: 3, kind: "npc", abilities: ["spell:test-counterspell"] },
  ], "t07-environment-tie");
  genesis.initialState.definitions["spell:a-counterspell"] = {
    ...structuredClone(SPELL_DEFINITIONS["spell:test-counterspell"]),
    definitionId: "spell:a-counterspell",
  };
  genesis.initialState.definitions["spell:z-counterspell"] = {
    ...structuredClone(SPELL_DEFINITIONS["spell:test-counterspell"]),
    definitionId: "spell:z-counterspell",
  };
  for (const id of ["environment:a-source", "environment:z-source"]) {
    genesis.initialState.entities[id].resources = {
      "spellSlot:3": { current: "3", maximum: "3" },
    };
  }
  genesis.initialStateHash = hash(genesis.initialState);
  const unsigned = { ...genesis };
  delete unsigned.genesisHash;
  genesis.genesisHash = hash(unsigned);

  let opened = openSpellTrigger(genesis, "root:t07:environment-tie", "pc:caster", "npc:first");
  const observed = [];
  while (opened.result.kind === "awaitingInput") {
    const controllerEntityId = opened.result.pending.controllerEntityId;
    observed.push(controllerEntityId);
    opened = apply(opened.current, {
      kind: "answerPendingInput",
      pendingInputId: opened.result.pending.pendingInputId,
      responseId: `response:t07:environment-tie:${controllerEntityId}`,
      answer: { kind: "decline" },
    });
  }
  assert.deepEqual(observed, ["npc:first", "environment:z-source", "environment:a-source"]);
  assert.equal(opened.result.kind, "awaitingRandomness");
});

test("F03 enforces exact 2014 short- and long-rest fictional-duration thresholds", () => {
  for (const [restKind, below, exact] of [
    ["short", "3599999999", "3600000000"],
    ["long", "28799999999", "28800000000"],
  ]) {
    const genesis = makeCampaignGenesis(`f03:${restKind}`);
    const base = scenario(genesis);
    const tooBrief = step(PROFILES, base.state, {
      kind: "startRest",
      proposalId: `proposal:f03:${restKind}:brief`,
      characterId: "pc:alpha",
      restKind,
      intendedDurationMicros: below,
      hitDiceToSpend: 0,
      arcaneRecoverySlotLevels: [],
    });
    assert.equal(tooBrief.kind, "rejected");
    assert.equal(tooBrief.rejection.code, "invalidRulesInput");
    const accepted = apply(base, {
      kind: "startRest",
      proposalId: `proposal:f03:${restKind}:exact`,
      characterId: "pc:alpha",
      restKind,
      intendedDurationMicros: exact,
      hitDiceToSpend: 0,
      arcaneRecoverySlotLevels: [],
    });
    assert.equal(accepted.result.kind, "committed");
    assert.equal(accepted.result.events.some(({ eventType }) => eventType === "RestStarted"), true);
  }
});

test("F04 interrupts before due without completion effects and settles a due Activity as an independent root before retrying the next intent", () => {
  let interrupted = scenario(makeCampaignGenesis("f04-interrupted"));
  let started = apply(interrupted, {
    kind: "startActivity",
    proposalId: "proposal:f04:interrupt:start",
    activityId: "activity:f04:interrupted",
    activityKind: "repair",
    characterId: "pc:alpha",
    intendedDurationMicros: "100",
    completion: activityCompletion("pc:alpha", "scene:alpha"),
  });
  interrupted = started.current;
  const stopped = apply(interrupted, {
    kind: "interruptActivity",
    proposalId: "proposal:f04:interrupt",
    activityId: "activity:f04:interrupted",
    cause: { kind: "voluntaryStop" },
  });
  interrupted = advanceCampaignTime(stopped.current, "pc:alpha", "100", "f04-interrupted").current;
  const afterInterruptedDue = apply(interrupted, {
    kind: "useResource",
    proposalId: "proposal:f04:after-interrupt",
    characterId: "pc:alpha",
    resourceId: "focus",
    amount: 1,
    purpose: "continue after interruption",
  });
  assert.equal(afterInterruptedDue.result.events.some(({ eventType }) => eventType === "ActivityCompleted"), false);
  assert.equal(afterInterruptedDue.current.state.entities["pc:alpha"].resources.focus, 0);

  let due = scenario(makeCampaignGenesis("f04-due"));
  started = apply(due, {
    kind: "startActivity",
    proposalId: "proposal:f04:due:start",
    activityId: "activity:f04:due",
    activityKind: "repair",
    characterId: "pc:alpha",
    intendedDurationMicros: "100",
    completion: activityCompletion("pc:alpha", "scene:alpha"),
  });
  due = advanceCampaignTime(started.current, "pc:alpha", "100", "f04-due").current;
  const originalIntent = {
    kind: "resolveFreeAction",
    proposalId: "proposal:f04:original-intent",
    characterId: "pc:alpha",
    goal: "inspect the finished repair",
    method: "look at the result",
    feasibility: { kind: "directSuccess", publicBasis: "The completed work is visible." },
    outcome: { publicResult: "The repair is complete." },
  };
  const settledFirst = apply(due, originalIntent);
  assert.equal(settledFirst.result.kind, "committed");
  assert.equal(settledFirst.result.events[0].rootActionId.startsWith("activity-due:"), true);
  assert.equal(settledFirst.result.events.some(({ eventType }) => eventType === "ActivityCompleted"), true);
  assert.equal(settledFirst.result.mechanicalResult.retryOriginalIntent, true);
  assert.equal(settledFirst.current.state.receipts[originalIntent.proposalId], undefined);
  assert.equal(settledFirst.current.state.entities["pc:alpha"].resources.focus, 0);
  const retried = apply(settledFirst.current, originalIntent);
  assert.equal(retried.result.kind, "committed");
  assert.equal(retried.result.events[0].rootActionId, originalIntent.proposalId);
});

test("F05 converts a future turn anchor when an Encounter ends mid-round and later expires it once without granting combat actions", () => {
  const genesis = makeReadyGenesis({
    effectOrder: ["pc:b"],
    suffix: "f05",
  });
  genesis.initialState.effects["effect:f05:remaining-round"] = {
    effectId: "effect:f05:remaining-round",
    kind: "testPhaseEffect",
    sourceEntityId: "npc:causal",
    targetEntityId: "npc:causal",
    expiresAt: { kind: "turnStart", entityId: "npc:causal" },
  };
  genesis.initialStateHash = hash(genesis.initialState);
  const unsigned = { ...genesis };
  delete unsigned.genesisHash;
  genesis.genesisHash = hash(unsigned);
  let concluded = concludeEncounter(scenario(genesis), "encounter:ready", "f05");
  assert.equal(concluded.result.kind, "committed", JSON.stringify(concluded.result));
  assert.equal(concluded.current.state.fictionTimelines["branch:main"].nowMicros, "6000000");
  assert.equal(concluded.current.state.combatRuntime.effects["effect:ready:seed:pc:b"]?.kind, "readiedAction");
  assert.equal(concluded.current.state.combatRuntime.effects["effect:f05:remaining-round"], undefined);
  assert.deepEqual(
    concluded.result.events
      .filter(({ eventType }) => ["EncounterConcluded", "EffectEnded", "RoundStarted", "TurnStarted"].includes(eventType))
      .map(({ eventType }) => eventType),
    ["EncounterConcluded", "EffectEnded"],
  );
  assert.equal(
    concluded.result.events.find(({ eventType }) => eventType === "EffectEnded").fictionInstantMicros,
    "6000000",
  );
  const encounter = concluded.current.state.combatRuntime.encounters["encounter:ready"];
  assert.equal(encounter.status, "concluded");
  assert.equal(encounter.residualPhaseTasks.length, 1);
  assert.deepEqual(
    {
      dueMicros: encounter.residualPhaseTasks[0].dueMicros,
      edge: encounter.residualPhaseTasks[0].edge,
      effectId: encounter.residualPhaseTasks[0].effectId,
      slotIndex: encounter.residualPhaseTasks[0].slotIndex,
    },
    {
      dueMicros: "7500000",
      edge: "turnStart",
      effectId: "effect:ready:seed:pc:b",
      slotIndex: 1,
    },
  );

  concluded = advanceCampaignTime(concluded.current, "pc:a", "1500000", "f05-due");
  assert.equal(concluded.result.kind, "committed", JSON.stringify(concluded.result));
  const originalIntent = {
    kind: "resolveFreeAction",
    proposalId: "proposal:f05:after-due",
    characterId: "pc:a",
    goal: "continue after the expired combat effect",
    method: "observe the quiet battlefield",
    feasibility: { kind: "directSuccess", publicBasis: "The encounter has already ended." },
    outcome: { publicResult: "The battlefield remains quiet." },
  };
  const settled = apply(concluded.current, originalIntent);
  assert.equal(settled.result.kind, "committed", JSON.stringify(settled.result));
  assert.equal(settled.result.mechanicalResult.retryOriginalIntent, true);
  assert.equal(settled.result.events[0].rootActionId, "combat-phase-due:encounter:ready:7500000");
  assert.deepEqual(
    settled.result.events.map(({ eventType }) => eventType),
    ["ReadiedActionExpired"],
  );
  assert.equal(settled.current.state.combatRuntime.effects["effect:ready:seed:pc:b"], undefined);
  assert.equal(settled.current.state.combatRuntime.encounters["encounter:ready"].residualPhaseTasks.length, 0);
  assert.equal(settled.current.state.combatRuntime.entities["pc:b"].turn.reaction, "1");
  assert.equal(settled.current.state.combatRuntime.encounters["encounter:ready"].status, "concluded");

  const retried = apply(settled.current, originalIntent);
  assert.equal(retried.result.kind, "committed", JSON.stringify(retried.result));
  assert.equal(retried.result.events.some(({ eventType }) => eventType === "ReadiedActionExpired"), false);
  assert.equal(retried.result.events[0].rootActionId, originalIntent.proposalId);
});

test("F06 settles same-microsecond residual phases by saved initiative, edge, and effect id under object-order perturbation", () => {
  const effects = [
    {
      effectId: "effect:f06:z-slot-one-start",
      kind: "testPhaseEffect",
      sourceEntityId: "pc:b",
      targetEntityId: "pc:b",
      expiresAt: { kind: "turnStart", entityId: "pc:b" },
    },
    {
      effectId: "effect:f06:slot-zero-end",
      kind: "testPhaseEffect",
      sourceEntityId: "pc:a",
      targetEntityId: "pc:a",
      expiresAt: { kind: "turnEnd", entityId: "pc:a" },
    },
    {
      effectId: "effect:f06:a-slot-one-start",
      kind: "testPhaseEffect",
      sourceEntityId: "pc:b",
      targetEntityId: "pc:b",
      expiresAt: { kind: "turnStart", entityId: "pc:b" },
    },
  ];
  const run = (effectOrder, suffix) => {
    const genesis = makeReadyGenesis({ effectOrder: [], suffix });
    genesis.initialState.effects = Object.fromEntries(effectOrder.map((index) => {
      const effect = effects[index];
      return [effect.effectId, structuredClone(effect)];
    }));
    genesis.initialStateHash = hash(genesis.initialState);
    const unsigned = { ...genesis };
    delete unsigned.genesisHash;
    genesis.genesisHash = hash(unsigned);
    let current = concludeEncounter(scenario(genesis), "encounter:ready", suffix).current;
    current = advanceCampaignTime(current, "pc:a", "1500000", `${suffix}:advance`).current;
    const settled = apply(current, {
      kind: "resolveFreeAction",
      proposalId: `proposal:${suffix}:after-due`,
      characterId: "pc:a",
      goal: "continue after simultaneous expiries",
      method: "observe the settled effects",
      feasibility: { kind: "directSuccess", publicBasis: "The encounter has ended." },
      outcome: { publicResult: "The phase effects have ended." },
    });
    assert.equal(settled.result.kind, "committed", JSON.stringify(settled.result));
    assert.equal(settled.result.mechanicalResult.retryOriginalIntent, true);
    const replayed = replay(settled.current.genesis, structuredClone(settled.current.events));
    assert.equal(replayed?.kind, "replayed", JSON.stringify(replayed));
    assert.equal(replayed.head.stateHash, settled.current.events.at(-1).stateHashAfter);
    return settled.result.events
      .filter(({ eventType }) => eventType === "EffectEnded")
      .map(({ payload }) => payload.effectId);
  };
  const expected = [
    "effect:f06:slot-zero-end",
    "effect:f06:a-slot-one-start",
    "effect:f06:z-slot-one-start",
  ];
  assert.deepEqual(run([0, 1, 2], "f06-left"), expected);
  assert.deepEqual(run([2, 0, 1], "f06-right"), expected);
});

test("F07 keeps separated scene timelines causal until an explicit crossing action", () => {
  let current = scenario(makeCampaignGenesis("f07"));
  current = advanceCampaignTime(current, "pc:alpha", "1000", "f07-alpha").current;
  assert.equal(current.state.fictionTimelines["branch:main"].nowMicros, "1000");
  assert.equal(current.state.fictionTimelines["timeline:branch:main:scene:beta"].nowMicros, "0");

  const betaStarted = apply(current, {
    kind: "startActivity",
    proposalId: "proposal:f07:beta-activity",
    activityId: "activity:f07:beta",
    activityKind: "watch",
    characterId: "pc:beta",
    intendedDurationMicros: "500",
    completion: activityCompletion("pc:beta", "scene:beta"),
  });
  current = betaStarted.current;
  const alphaActs = apply(current, {
    kind: "resolveFreeAction",
    proposalId: "proposal:f07:alpha-acts",
    characterId: "pc:alpha",
    goal: "act on alpha branch",
    method: "remain in alpha scene",
    feasibility: { kind: "directSuccess", publicBasis: "No cross-scene causal link exists." },
    outcome: { publicResult: "Alpha acts." },
  });
  assert.equal(alphaActs.result.events.some(({ eventType }) => eventType === "ActivityCompleted"), false);
  assert.equal(alphaActs.current.state.campaignRuntime.activities["activity:f07:beta"].status, "active");
  assert.equal(alphaActs.current.state.fictionTimelines["timeline:branch:main:scene:beta"].nowMicros, "0");

  const crossed = apply(alphaActs.current, {
    kind: "moveIndividually",
    rootActionId: "root:f07:cross",
    characterId: "pc:alpha",
    destinationSceneId: "scene:beta",
    fictionTimeCostMicros: "100",
  });
  assert.equal(crossed.result.kind, "committed");
  assert.equal(crossed.current.state.fictionTimelines["timeline:branch:main:scene:beta"].nowMicros, "1100");
});

test("F08 a new default Time/Trigger implementation replays the old pinned instant, phase task, and state hash", () => {
  assert.notDeepEqual(
    SYNTHETIC_NEXT_PROFILES.fictionCombatTime,
    PROFILES.fictionCombatTime,
    "the deployment fixture must select a genuinely different Time Profile",
  );
  assert.notDeepEqual(
    SYNTHETIC_NEXT_PROFILES.triggerOrdering,
    PROFILES.triggerOrdering,
    "the deployment fixture must select a genuinely different Trigger Profile",
  );

  const oldRuntime = createVersionedRulesRuntime({
    registrations: [
      { manifest: PROFILES, interpreterKind: "authoritative-v2" },
      { manifest: SYNTHETIC_NEXT_PROFILES, interpreterKind: "authoritative-v2" },
    ],
    defaultManifest: PROFILES.manifest,
  });
  const deployedRuntime = createVersionedRulesRuntime({
    registrations: [
      { manifest: PROFILES, interpreterKind: "authoritative-v2" },
      { manifest: SYNTHETIC_NEXT_PROFILES, interpreterKind: "authoritative-v2" },
    ],
    defaultManifest: SYNTHETIC_NEXT_PROFILES.manifest,
  });
  const newWorld = deployedRuntime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:trigger-time:f08-new-default",
    runtimeEpochId: "epoch:trigger-time:f08-new-default",
    moduleRef: { profileId: "module:f08-new-default", profileHash: `sha256:${"e".repeat(64)}` },
    initialDefinitionCatalogRef: {
      profileId: "catalog:f08-new-default",
      profileHash: `sha256:${"f".repeat(64)}`,
    },
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{ id: "scene:clock", name: "新部署时间测试场" }],
    principals: [{ id: "principal:b", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:b", principalId: "principal:b", status: "active" }],
    characters: [{
      id: "pc:b",
      kind: "player",
      name: "时间测试角色",
      sceneId: "scene:clock",
      tenureStatus: "active",
    }],
    characterControls: [{ characterId: "pc:b", seatId: "seat:b" }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(newWorld.kind, "initialized", JSON.stringify(newWorld));
  assert.deepEqual(newWorld.profiles.fictionCombatTime, SYNTHETIC_NEXT_PROFILES.fictionCombatTime);
  assert.deepEqual(newWorld.profiles.triggerOrdering, SYNTHETIC_NEXT_PROFILES.triggerOrdering);

  const genesis = makeReadyGenesis({ effectOrder: ["pc:b"], suffix: "f08-old-profile" });
  const concluded = concludeEncounter(scenario(genesis), "encounter:ready", "f08-old-profile");
  const beforeDeployment = oldRuntime.replay(genesis, structuredClone(concluded.current.events));
  const afterDeployment = deployedRuntime.replay(genesis, structuredClone(concluded.current.events));
  assert.equal(beforeDeployment.kind, "replayed", JSON.stringify(beforeDeployment));
  assert.equal(afterDeployment.kind, "replayed", JSON.stringify(afterDeployment));

  const beforeEncounter = beforeDeployment.state.combatRuntime.encounters["encounter:ready"];
  const afterEncounter = afterDeployment.state.combatRuntime.encounters["encounter:ready"];
  assert.equal(beforeDeployment.state.fictionTimelines["branch:main"].nowMicros, "6000000");
  assert.equal(afterDeployment.state.fictionTimelines["branch:main"].nowMicros, "6000000");
  assert.deepEqual(afterEncounter.residualPhaseTasks, beforeEncounter.residualPhaseTasks);
  assert.deepEqual(afterEncounter.residualPhaseTasks.map((task) => ({
    dueMicros: task.dueMicros,
    edge: task.edge,
    effectId: task.effectId,
    slotIndex: task.slotIndex,
  })), [{
    dueMicros: "7500000",
    edge: "turnStart",
    effectId: "effect:ready:seed:pc:b",
    slotIndex: 1,
  }]);
  assert.equal(afterDeployment.head.stateHash, beforeDeployment.head.stateHash);
  assert.deepEqual(afterDeployment.state, beforeDeployment.state);
  assert.deepEqual(afterDeployment.profiles, PROFILES);

  const viewer = { kind: "player", principalId: "principal:b", characterId: "pc:b" };
  assert.deepEqual(
    deployedRuntime.project(PROFILES, afterDeployment.state, viewer),
    oldRuntime.project(PROFILES, beforeDeployment.state, viewer),
  );
});
