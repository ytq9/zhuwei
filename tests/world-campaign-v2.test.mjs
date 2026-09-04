import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  project,
  replay,
  step,
} from "../app/_runtime/lib/rules/index.ts";
import { compileKpFormDraft } from "../app/_runtime/lib/kp/causal-action-program.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { ITEM_SYSTEM_PROFILE } from "../app/_runtime/lib/rules/profiles/item-system.ts";
import { createInitialItemEntry } from "../app/_runtime/lib/rules/v2/items.ts";
import { dueActorPlanChildRoot } from "../app/_runtime/lib/rules/v2/actor-plans.ts";
import { continueCompoundRoot } from "../app/_runtime/lib/rules/v2/internal-compound.ts";
import {
  applyCampaignEvent,
  validateCampaignEventPayload,
} from "../app/_runtime/lib/rules/v2/campaign-events.ts";
import { correctionEffectsBefore } from "../app/_runtime/lib/rules/v2/correction.ts";

const PROFILES = ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST;

const MODULE_REF = {
  profileId: "module-world-campaign-acceptance-v1",
  profileHash: "sha256:35bb9cc63a2f74f9befa623c639ee53a9bf42e8ddc943345dc35e0bc0d85ef03",
};

const CATALOG_REF = {
  profileId: "catalog-world-campaign-acceptance-v1",
  profileHash: "sha256:428d0ccad153abcc8e42c6f19b3de8d6d925b666513386a247be7f6c5eff20bb",
};

const SEALED_LETTER_DEFINITION_ID = "item-definition:black-lantern:sealed-letter:1";
const SEALED_LETTER_ENTRY_ID = "item-entry:black-lantern:sealed-letter:1";
const WATCH_FACTION_RESOURCE_REF = "resource:faction:watch:night-patrol";

function tacticalGeometry(sceneId) {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "0", y: "0" },
        { x: "1200", y: "0" },
        { x: "1200", y: "800" },
        { x: "0", y: "800" },
      ],
    },
    spawnPoints: [
      { x: "120", y: "160", elevation: "0" },
      { x: "300", y: "160", elevation: "0" },
      { x: "480", y: "160", elevation: "0" },
      { x: "660", y: "160", elevation: "0" },
      { x: "840", y: "160", elevation: "0" },
      { x: "1020", y: "160", elevation: "0" },
    ],
    obstacles: [{
      featureId: `feature:world-campaign:${sceneId}:wall`,
      kind: "barrier",
      label: "低矮隔墙",
      state: "intact",
      polygon: [
        { x: "420", y: "460" },
        { x: "480", y: "460" },
        { x: "480", y: "580" },
        { x: "420", y: "580" },
      ],
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

const initializedWorld = step(PROFILES, undefined, {
  kind: "initializeAuthoritativeWorld",
  roomId: "world-campaign-acceptance-room",
  runtimeEpochId: "epoch:world-campaign-v5:1",
  moduleRef: MODULE_REF,
  initialDefinitionCatalogRef: CATALOG_REF,
  activeBranchId: "branch:main",
  fictionInstantMicros: "0",
  scenes: [
    { id: "shrine", name: "黑灯神龛", geometry: tacticalGeometry("shrine") },
    { id: "yard", name: "守钥庭院", geometry: tacticalGeometry("yard") },
  ],
  principals: [
    { id: "principal-1", sessionVersion: 1, role: "host" },
    { id: "principal-2", sessionVersion: 1, role: "player" },
  ],
  seats: [
    { id: "seat:auto:principal-1", principalId: "principal-1", status: "active" },
    { id: "seat:auto:principal-2", principalId: "principal-2", status: "active" },
  ],
  characters: [
    {
      id: "pc-1",
      kind: "player",
      name: "阿岚",
      sceneId: "shrine",
      classId: "rogue",
      raceId: "human",
      subclassId: "thief",
      level: 3,
      hitPoints: { current: 7, maximum: 18 },
      resources: { resolve: 1, hitDice: 2 },
      resourceMaximums: { resolve: 1, hitDice: 3 },
      abilityScores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["acrobatics", "stealth"],
      expertiseSkills: [],
      proficientSaves: ["dex", "int"],
      featureIds: ["feature:cunning-action", "feature:sneak-attack"],
      tenureStatus: "active",
      loadout: { armorClass: 13, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "rogue", raceId: "human", cantrips: [], prepared: [] },
    },
    {
      id: "pc-2",
      kind: "player",
      name: "柏舟",
      sceneId: "yard",
      classId: "fighter",
      raceId: "human",
      level: 3,
      hitPoints: { current: 16, maximum: 16 },
      resources: { resolve: 1, hitDice: 2 },
      resourceMaximums: { resolve: 1, hitDice: 3 },
      abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 14, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
      expertiseSkills: [],
      proficientSaves: ["con", "str"],
      featureIds: [],
      tenureStatus: "active",
      loadout: { armorClass: 11, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
    },
    {
      id: "npc-warden",
      kind: "npc",
      name: "守钥人",
      sceneId: "yard",
      tenureStatus: "active",
      hitPoints: { current: 12, maximum: 12 },
      abilityScores: { str: 12, dex: 12, con: 12, int: 10, wis: 14, cha: 10 },
      proficiencyBonus: 2,
    },
  ],
  characterControls: [
    { characterId: "pc-1", seatId: "seat:auto:principal-1" },
    { characterId: "pc-2", seatId: "seat:auto:principal-2" },
  ],
  canonicalFacts: [
    {
      id: "fact:unbreakable-arch",
      kind: "materialLimit",
      source: "moduleAnchor",
      subjectRefs: ["shrine"],
      value: "徒手无法破坏黑石拱门",
      visibilityPolicyId: "visibility:public",
    },
    {
      id: "fact:chapter-one-goal",
      kind: "chapterOutcome",
      source: "moduleAnchor",
      subjectRefs: ["chapter:one"],
      value: "封印已经解除",
      visibilityPolicyId: "visibility:public",
    },
    {
      id: "fact:party-speaking-stones",
      kind: "establishedCommunicationChannel",
      source: "moduleAnchor",
      subjectRefs: ["npc-warden", "pc-1", "pc-2"],
      value: "三枚配对传声石仍保持连接",
      visibilityPolicyId: "visibility:channel-participants",
    },
  ],
  initialKnowledge: [{
    characterId: "pc-1",
    knowledgeRef: "knowledge:private-sigil",
    kind: "canonicalFact",
    layer: "full",
    content: "银叶印记对应旧王室密道",
    visibility: "private",
    provenanceChain: ["fact:chapter-one-goal"],
  }],
});
assert.equal(initializedWorld.kind, "initialized", JSON.stringify(initializedWorld));

const INITIAL_STATE = structuredClone(initializedWorld.genesis.initialState);
INITIAL_STATE.campaignRuntime.campaign = {
  campaignId: "campaign:black-lantern",
  moduleRef: structuredClone(MODULE_REF),
  advancementProfile: "milestone",
  currentChapterId: "chapter:one",
  status: "active",
};
INITIAL_STATE.campaignRuntime.chapters = {
  "chapter:one": {
    chapterId: "chapter:one",
    ordinal: "1",
    status: "active",
    moduleRef: structuredClone(MODULE_REF),
    storyAnchorRefs: ["fact:chapter-one-goal"],
    sceneQuestion: "金库封印会如何改变守钥人的命运？",
  },
};
INITIAL_STATE.combatRuntime.story = {
  chapterId: "chapter:one",
  status: "active",
  endingCandidates: [],
};
INITIAL_STATE.campaignRuntime.relationships = {
  "relationship:warden-alan": {
    relationshipId: "relationship:warden-alan",
    subjectIds: ["npc-warden", "pc-1"],
    value: "守钥人信任阿岚",
    visibility: "participants",
    basisFactIds: ["fact:chapter-one-goal"],
  },
};
INITIAL_STATE.campaignRuntime.promises = {
  "promise:return-key": {
    promiseId: "promise:return-key",
    promisorId: "pc-1",
    promiseeId: "npc-warden",
    content: "下一章归还铜钥匙",
    condition: "进入下一章后",
    status: "active",
  },
};
INITIAL_STATE.campaignRuntime.factions = {
  "faction:watch": {
    factionId: "faction:watch",
    name: "巡夜人",
    goal: "封锁地窖",
    memberRefs: ["npc-warden"],
    resourceRefs: [WATCH_FACTION_RESOURCE_REF],
    visibilityPolicyId: "visibility:public",
  },
};
INITIAL_STATE.campaignRuntime.unresolvedThreats = ["threat:powder-smugglers"];

const sealedLetterDefinition = {
  schema: "zhuwei.item-definition/v1",
  definitionKind: "item",
  definitionId: SEALED_LETTER_DEFINITION_ID,
  revision: "1",
  rulesBasis: { kind: "zhuwei-product-ruling", profileRef: ITEM_SYSTEM_PROFILE },
  causalBasisRefs: ["fact:chapter-one-goal"],
  visibilityPolicyRef: "visibility:public",
  content: {
    schema: "zhuwei.item-definition-content/v1",
    label: "密封信",
    description: "一封由阿岚保管、可交付或销毁的密封信。",
    category: "object",
    aliases: [],
    tags: [],
    stackable: false,
    equipment: null,
    equippedAbilityRefs: [],
    use: null,
    chargesMaximum: null,
    durabilityMaximum: null,
  },
};
const sealedLetterEntry = createInitialItemEntry(sealedLetterDefinition, {
  entryId: SEALED_LETTER_ENTRY_ID,
  quantity: 1,
  placement: { kind: "held", holderRef: "pc-1", equippedSlot: null },
  ownership: { kind: "character", ownerRef: "pc-1" },
  visibilityPolicyRef: "visibility:character-controller:pc-1",
});
INITIAL_STATE.campaignRuntime.itemSystem.definitions[SEALED_LETTER_DEFINITION_ID] =
  sealedLetterDefinition;
INITIAL_STATE.campaignRuntime.itemSystem.entries[SEALED_LETTER_ENTRY_ID] = sealedLetterEntry;
INITIAL_STATE.entities["pc-1"].loadout.backpack = [
  { itemId: SEALED_LETTER_ENTRY_ID, quantity: 1 },
];

// This signs only the immutable genesis fixture. Product hashes and event folding
// remain the responsibility of replay; no test action can call this helper.
function canonicalFixture(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalFixture).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalFixture(value[key])}`).join(",")}}`;
}

function fixtureHash(value) {
  return `sha256:${createHash("sha256").update(canonicalFixture(value)).digest("hex")}`;
}

function fixtureStateHash(state) {
  const domainState = { ...state };
  delete domainState.eventHeadHash;
  delete domainState.lastEventId;
  return fixtureHash(domainState);
}

const INITIAL_STATE_HASH = fixtureStateHash(INITIAL_STATE);
INITIAL_STATE.eventHeadHash = INITIAL_STATE_HASH;
const UNSIGNED_GENESIS = {
  kind: "roomGenesis",
  roomId: "world-campaign-acceptance-room",
  runtimeEpochId: "epoch:world-campaign-v5:1",
  profiles: PROFILES,
  moduleRef: MODULE_REF,
  initialDefinitionCatalogRef: CATALOG_REF,
  initialState: INITIAL_STATE,
  initialStateHash: INITIAL_STATE_HASH,
};
const GENESIS = {
  ...UNSIGNED_GENESIS,
  genesisHash: fixtureHash(UNSIGNED_GENESIS),
};

function signedGenesis(initialState) {
  const signedInitialState = structuredClone(initialState);
  const initialStateHash = fixtureStateHash(signedInitialState);
  signedInitialState.eventHeadHash = initialStateHash;
  const unsigned = {
    ...UNSIGNED_GENESIS,
    initialState: signedInitialState,
    initialStateHash,
  };
  return {
    ...unsigned,
    genesisHash: fixtureHash(unsigned),
  };
}

const ALICE_VIEWER = {
  kind: "player",
  principalId: "principal-1",
  sessionVersion: 1,
  seatId: "seat:auto:principal-1",
  characterId: "pc-1",
};
const BOB_VIEWER = {
  kind: "player",
  principalId: "principal-2",
  sessionVersion: 1,
  seatId: "seat:auto:principal-2",
  characterId: "pc-2",
};
const WARDEN_VIEWER = { kind: "npc", npcId: "npc-warden" };

const FORBIDDEN_ACTION_KEYS = new Set([
  "profile",
  "profiles",
  "profileId",
  "profileHash",
  "principal",
  "principalId",
  "die",
  "dice",
  "roll",
  "event",
  "events",
  "eventType",
  "worldState",
]);

function assertActionOwnsNoAuthority(value, path = "input") {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertActionOwnsNoAuthority(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(!FORBIDDEN_ACTION_KEYS.has(key), `${path}.${key} must remain authority-owned`);
    assertActionOwnsNoAuthority(entry, `${path}.${key}`);
  }
}

function assertReplayed(result) {
  assert.equal(
    result?.kind,
    "replayed",
    `expected replayed, received ${result?.kind ?? typeof result}: ${result?.rejection?.code ?? ""}`,
  );
  assert.ok(result.state, "replay must return the reconstructed state");
  return result;
}

function outputEvents(result) {
  assert.ok(Array.isArray(result?.events), "step must expose its proposed authoritative events");
  return result.events;
}

function eventTypes(result) {
  return outputEvents(result).map((entry) => entry.eventType);
}

function eventOf(result, eventType) {
  const event = outputEvents(result).find((entry) => entry.eventType === eventType);
  assert.ok(event, `expected ${eventType}, received ${eventTypes(result).join(", ")}`);
  return event;
}

function createScenario(genesis = GENESIS) {
  let committedEvents = [];

  function currentReplay() {
    return assertReplayed(replay(genesis, committedEvents));
  }

  function run(input, expectedKind) {
    assertActionOwnsNoAuthority(input);
    const originalInput = structuredClone(input);
    const result = step(PROFILES, currentReplay().state, input);
    assert.deepEqual(input, originalInput, `${input.kind} input must remain immutable`);
    assert.equal(
      result?.kind,
      expectedKind,
      `${input.kind}: expected ${expectedKind}, received ${result?.kind ?? typeof result}`
        + ` (${result?.rejection?.code ?? "no rejection code"})`,
    );
    committedEvents = committedEvents.concat(structuredClone(outputEvents(result)));
    currentReplay();
    return result;
  }

  function reject(input, expectedCode) {
    const before = committedEvents;
    const result = run(input, "rejected");
    assert.equal(result.rejection?.code, expectedCode);
    assert.deepEqual(result.events, []);
    assert.deepEqual(committedEvents, before);
    return result;
  }

  function view(viewer) {
    const result = project(PROFILES, currentReplay().state, viewer);
    assert.equal(
      result?.kind,
      "projected",
      `expected projected, received ${result?.kind ?? typeof result}: ${result?.rejection?.code ?? ""}`,
    );
    return result;
  }

  function state() {
    return structuredClone(currentReplay().state);
  }

  function fulfill(continuation, rolls, expectedKind) {
    const result = step(PROFILES, currentReplay().state, {
      kind: "fulfillAuthoritativeRandomness",
      continuation,
      rolls,
    });
    assert.equal(
      result?.kind,
      expectedKind,
      `randomness fulfillment: expected ${expectedKind}, received ${result?.kind ?? typeof result}`
        + ` (${result?.rejection?.code ?? "no rejection code"})`,
    );
    committedEvents = committedEvents.concat(structuredClone(outputEvents(result)));
    currentReplay();
    return result;
  }

  return { fulfill, reject, run, state, view };
}

function projectionText(value) {
  return JSON.stringify(value);
}

function assertProjectionContains(view, ...needles) {
  const text = projectionText(view);
  for (const needle of needles) {
    assert.ok(text.includes(needle), `projection must contain ${needle}`);
  }
}

function assertProjectionOmits(view, ...needles) {
  const text = projectionText(view);
  for (const needle of needles) {
    assert.ok(!text.includes(needle), `projection must omit ${needle}`);
  }
}

test("campaign genesis carries the exact current ModuleRef without normalization", () => {
  const current = replay(GENESIS, []);
  assertReplayed(current);
  assert.deepEqual(current.state.campaignRuntime.campaign.moduleRef, MODULE_REF);
  assert.deepEqual(current.state.campaignRuntime.chapters["chapter:one"].moduleRef, MODULE_REF);
});

test("replay rejects moduleless or differently pinned current campaign descriptors", () => {
  const cases = [
    {
      name: "missing Campaign",
      mutate(state) {
        state.campaignRuntime.campaign = null;
      },
      code: "archiveIntegrityMismatch",
    },
    {
      name: "moduleless current Chapter",
      mutate(state) {
        delete state.campaignRuntime.chapters["chapter:one"].moduleRef;
      },
      code: "archiveIntegrityMismatch",
    },
    {
      name: "Campaign and Chapter pinned to a different module",
      mutate(state) {
        const otherModule = {
          profileId: "module-world-campaign-other-v1",
          profileHash: "sha256:ddf95fe9f30a3330e310fa35d502a2eecdd4785216f996260b1e6c03a9e44ae2",
        };
        state.campaignRuntime.campaign.moduleRef = otherModule;
        state.campaignRuntime.chapters["chapter:one"].moduleRef = otherModule;
      },
      code: "archiveIntegrityMismatch",
    },
  ];

  for (const fixture of cases) {
    const initialState = structuredClone(INITIAL_STATE);
    fixture.mutate(initialState);
    const result = replay(signedGenesis(initialState), []);
    assert.equal(result.kind, "rejected", fixture.name);
    assert.equal(result.rejection.code, fixture.code, fixture.name);
  }
});

test("internal scene item materialization creates and reuses one narrative definition without acquisition", () => {
  const scenario = createScenario();
  const before = scenario.state();
  const definition = {
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: "item-definition:black-lantern:carved-token:1",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: ["fact:chapter-one-goal"],
    visibilityPolicyRef: "visibility:public",
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "刻纹木牌",
      description: "一块留在黑灯神龛地面的旧木牌。",
      category: "object",
      aliases: [],
      tags: ["narrative-object"],
      stackable: false,
      equipment: null,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  };
  const internalCommand = (proposalId, entryId) => continueCompoundRoot({
    kind: "materializeSceneItem",
    proposalId,
    definition: structuredClone(definition),
    entryId,
    sceneId: "shrine",
    quantity: 1,
  }, proposalId);

  scenario.reject({
    kind: "materializeSceneItem",
    proposalId: "proposal:public-scene-item-bypass",
    definition: structuredClone(definition),
    entryId: "item-entry:black-lantern:public-bypass",
    sceneId: "shrine",
    quantity: 1,
  }, "invalidRulesInput");

  const firstEntryId = "item-entry:black-lantern:carved-token:1";
  const first = scenario.run(internalCommand(
    "proposal:internal-scene-item:first",
    firstEntryId,
  ), "committed");
  assert.deepEqual(eventTypes(first), ["ItemDefinitionRegistered", "ItemMaterialized"]);
  assert.ok(first.scopeProof.creates.includes(`item-definition:${definition.definitionId}`));
  assert.ok(first.scopeProof.creates.includes(`item-entry:${firstEntryId}`));
  const firstState = scenario.state();
  assert.deepEqual(
    firstState.campaignRuntime.itemSystem.entries[firstEntryId],
    {
      schema: "zhuwei.item-entry/v1",
      entryId: firstEntryId,
      definitionRef: definition.definitionId,
      definitionRevision: "1",
      disposition: "scene",
      holderRef: null,
      sceneRef: "shrine",
      equippedSlot: null,
      quantity: 1,
      condition: "usable",
      charges: null,
      durability: null,
      visibilityPolicyRef: "visibility:public",
      ownership: { kind: "unowned", ownerRef: null },
    },
  );
  assert.deepEqual(firstState.entities["pc-1"].loadout, before.entities["pc-1"].loadout);
  assert.deepEqual(firstState.entities["pc-2"].loadout, before.entities["pc-2"].loadout);
  assert.deepEqual(firstState.combatRuntime.definitions, before.combatRuntime.definitions);
  assert.deepEqual(firstState.campaignRuntime.definitions, before.campaignRuntime.definitions);
  assert.ok(!eventTypes(first).includes("ItemAcquired"));
  assert.ok(!eventTypes(first).includes("DefinitionRegistered"));

  const secondEntryId = "item-entry:black-lantern:carved-token:2";
  const reused = scenario.run(internalCommand(
    "proposal:internal-scene-item:reuse",
    secondEntryId,
  ), "committed");
  assert.deepEqual(eventTypes(reused), ["ItemMaterialized"]);
  assert.equal(
    scenario.state().campaignRuntime.itemSystem.entries[secondEntryId].ownership.kind,
    "unowned",
  );

  scenario.reject(internalCommand(
    "proposal:internal-scene-item:duplicate-entry",
    firstEntryId,
  ), "privateOrUnknownReference");
});

test("ActorPlan correction captures every current NPC/faction record changed by lifecycle events", () => {
  const replayed = replay(GENESIS, []);
  assertReplayed(replayed);
  const state = structuredClone(replayed.state);
  state.campaignRuntime.npcPlans["plan:correction"] = { status: "scheduled" };
  state.campaignRuntime.factionPlans["plan:correction"] = { status: "scheduled" };
  const cases = [
    ["NpcPlanFormed", ["npcPlans"]],
    ["NpcActionCommitted", ["npcPlans"]],
    ["FactionPlanFormed", ["factionPlans"]],
    ["NpcPlanCancelled", ["factionPlans", "npcPlans"]],
    ["NpcPlanRevised", ["factionPlans", "npcPlans"]],
    ["FactionActionCommitted", ["factionPlans", "npcPlans"]],
    ["FactionPlanAdvanced", ["factionPlans"]],
  ];
  for (const [eventType, expectedCollections] of cases) {
    const effects = correctionEffectsBefore(state, {
      eventType,
      payload: { planId: "plan:correction" },
    });
    assert.deepEqual(
      effects.map((effect) => effect.kind === "restoreCampaignEntry" && effect.collection).sort(),
      expectedCollections,
    );
    assert.ok(effects.every((effect) =>
      effect.kind === "restoreCampaignEntry" && effect.before.status === "scheduled"));
  }
});

test("free rulings cover all feasibility outcomes, clarification, and pre-random freeze", () => {
  const direct = createScenario().run({
    kind: "resolveFreeAction",
    proposalId: "proposal:open-door",
    characterId: "pc-1",
    goal: "打开普通未锁的木门",
    method: "转动门把后推开",
    feasibility: {
      kind: "directSuccess",
      publicBasis: "门没有上锁，也不存在有意义的失败后果。",
    },
    outcome: { publicResult: "门被推开", fictionTimeCostMicros: "1000000" },
  }, "committed");
  assert.ok(eventTypes(direct).includes("FeasibilityRuled"));
  assert.ok(!eventTypes(direct).includes("RandomnessRequested"));

  const checkScenario = createScenario();
  const checkInput = {
    kind: "resolveFreeAction",
    proposalId: "proposal:force-door",
    characterId: "pc-1",
    goal: "撞开受潮卡死的门",
    method: "肩撞",
    feasibility: {
      kind: "checkRequired",
      publicBasis: "门可能打开，失败会消耗时间并暴露位置。",
    },
    check: {
      kind: "skill",
      ability: "str",
      skill: "athletics",
      dc: 14,
      mode: "normal",
      success: { publicResult: "门被撞开" },
      failure: { publicResult: "门仍卡住", fictionTimeCostMicros: "6000000" },
    },
  };
  const check = checkScenario.run(checkInput, "awaitingRandomness");
  const frozenCheck = eventOf(check, "CheckFrozen");
  const requestedCheck = eventOf(check, "RandomnessRequested");
  assert.equal(frozenCheck.payload.dc, 14);
  assert.equal(frozenCheck.payload.failure.fictionTimeCostMicros, "6000000");
  assert.equal(requestedCheck.payload.purpose, "abilityCheck");
  assert.equal(requestedCheck.payload.formula, "1d20");
  assert.ok(!Object.hasOwn(requestedCheck.payload, "face"));

  const risky = createScenario().run({
    kind: "resolveFreeAction",
    proposalId: "proposal:cross-burning-beam",
    characterId: "pc-1",
    goal: "越过燃烧横梁",
    method: "绑好绳索后快速攀过",
    feasibility: {
      kind: "highRiskFeasible",
      publicBasis: "高热与坠落风险已经可感知，绳索提供真实帮助。",
    },
    acceptedCost: { resourceId: "resolve", amount: 1 },
    check: {
      kind: "skill",
      ability: "dex",
      skill: "acrobatics",
      dc: 18,
      mode: "advantage",
      success: { publicResult: "安全抵达另一侧" },
      failure: { publicResult: "悬在绳上并受到火焰威胁" },
    },
  }, "awaitingRandomness");
  assert.deepEqual(
    eventTypes(risky).filter((type) => [
      "FeasibilityRuled",
      "ResourceReserved",
      "CheckFrozen",
      "RandomnessRequested",
    ].includes(type)),
    ["FeasibilityRuled", "ResourceReserved", "CheckFrozen", "RandomnessRequested"],
  );

  const missingScenario = createScenario();
  const missing = missingScenario.reject({
    kind: "resolveFreeAction",
    proposalId: "proposal:pick-arcane-lock",
    characterId: "pc-1",
    goal: "撬开秘法锁",
    method: "使用普通发夹",
    feasibility: {
      kind: "missingPrerequisite",
      publicBasis: "需要能够解除秘法锁的工具或魔法。",
      prerequisite: { kind: "capability", capabilityId: "capability:dispel-magic" },
    },
  }, "missingPrerequisite");
  assert.ok(!eventTypes(missing).includes("RandomnessRequested"));

  const impossibleScenario = createScenario();
  const impossible = impossibleScenario.reject({
    kind: "resolveFreeAction",
    proposalId: "proposal:break-black-arch",
    characterId: "pc-1",
    goal: "徒手击碎黑石拱门",
    method: "连续挥拳",
    feasibility: {
      kind: "worldLawViolation",
      publicBasis: "既有材质事实表明徒手无法破坏它。",
      factRefs: ["fact:unbreakable-arch"],
    },
  }, "worldLawViolation");
  assert.ok(!eventTypes(impossible).includes("RandomnessRequested"));

  const clarification = createScenario().run({
    kind: "resolveFreeAction",
    proposalId: "proposal:ambiguous-lever",
    characterId: "pc-1",
    goal: "拉下那根拉杆",
    method: "尚未说明具体目标",
    feasibility: {
      kind: "clarificationRequired",
      publicBasis: "两根拉杆分别会触发警铃和开启闸门，后果不可逆。",
      choices: [
        { choiceId: "alarm", label: "左侧警铃" },
        { choiceId: "gate", label: "右侧闸门" },
      ],
    },
  }, "awaitingInput");
  assert.ok(eventTypes(clarification).includes("ClarificationRequested"));
  assert.match(clarification.pending.pendingInputId, /^pending:/);
  assert.equal(clarification.pending.kind, "clarification");
  assert.deepEqual(
    clarification.pending.controller,
    { kind: "character", characterId: "pc-1" },
  );
});

test("noncombat mechanics share resources, unified items, interruptible Activity, and damage/death", () => {
  const contest = createScenario().run({
    kind: "resolveContest",
    proposalId: "proposal:arm-wrestle",
    initiatorId: "pc-1",
    defenderId: "npc-warden",
    initiatorCheck: { ability: "str", skill: "athletics", mode: "normal" },
    defenderCheck: { ability: "str", skill: "athletics", mode: "normal" },
    tieResult: "statusQuo",
  }, "awaitingRandomness");
  assert.ok(eventTypes(contest).includes("ContestFrozen"));
  assert.equal(eventTypes(contest).filter((type) => type === "RandomnessRequested").length, 2);

  const savingThrow = createScenario().run({
    kind: "resolveSavingThrow",
    proposalId: "proposal:powder-fumes-save",
    targetId: "pc-1",
    sourceDefinitionId: "hazard:powder-fumes",
    ability: "con",
    dc: 13,
    success: { publicResult: "咳嗽后稳住呼吸" },
    failure: { publicResult: "陷入中毒状态" },
  }, "awaitingRandomness");
  assert.ok(eventTypes(savingThrow).includes("SaveFrozen"));
  assert.equal(eventTypes(savingThrow).filter((type) => type === "RandomnessRequested").length, 1);

  const scenario = createScenario();
  scenario.run({
    kind: "useResource",
    proposalId: "proposal:spend-resolve",
    characterId: "pc-1",
    resourceId: "resolve",
    amount: 1,
    purpose: "保持专注完成仪式准备",
  }, "committed");
  scenario.run({
    kind: "moveIndividually",
    rootActionId: "root:alice-meets-bob-for-letter",
    characterId: "pc-1",
    destinationSceneId: "yard",
    fictionTimeCostMicros: "1000000",
  }, "committed");
  scenario.run({
    kind: "transferItem",
    proposalId: "proposal:hand-letter-to-bob",
    fromCharacterId: "pc-1",
    toCharacterId: "pc-2",
    itemId: SEALED_LETTER_ENTRY_ID,
    quantity: 1,
    method: "当面交付",
    ownershipDisposition: "preserve",
  }, "committed");
  assert.equal(
    scenario.state().campaignRuntime.itemSystem.entries[SEALED_LETTER_ENTRY_ID].holderRef,
    "pc-2",
  );
  assert.equal(
    scenario.state().campaignRuntime.itemSystem.entries[SEALED_LETTER_ENTRY_ID].definitionRef,
    SEALED_LETTER_DEFINITION_ID,
  );
  const rest = scenario.run({
    kind: "startRest",
    proposalId: "proposal:start-short-rest",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3600000000",
  }, "committed");
  const restEvent = eventOf(rest, "RestStarted");
  const duringRest = scenario.view(ALICE_VIEWER);
  assert.equal(duringRest.controlledCharacter.resources.resolve, 0);
  assertProjectionContains(duringRest, "active", restEvent.payload.activityId);

  const interrupted = scenario.run({
    kind: "interruptActivity",
    proposalId: "proposal:interrupt-rest",
    activityId: restEvent.payload.activityId,
    cause: { kind: "worldThreat", factId: "fact:chapter-one-goal" },
  }, "committed");
  assert.ok(eventTypes(interrupted).includes("ActivityInterrupted"));
  const afterInterruption = scenario.view(ALICE_VIEWER);
  assert.equal(afterInterruption.controlledCharacter.resources.resolve, 0);
  assertProjectionContains(afterInterruption, "interrupted");
  assertProjectionOmits(afterInterruption, "RestCompleted");
  assertProjectionContains(scenario.view(BOB_VIEWER), SEALED_LETTER_ENTRY_ID, "密封信");

  const definition = scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:define-flash-fire",
    definition: {
      definitionId: "hazard:flash-fire",
      revision: "1",
      definitionKind: "environmentHazard",
      rulesBasis: "srd5.1-2014",
      trigger: { kind: "enterZone", zoneId: "zone:powder-cellar" },
      perceptibleSigns: ["强烈火药味", "地面积尘中的火星"],
      disableMethods: ["隔绝火源", "浸湿火药"],
      effect: {
        kind: "fixedDamage",
        amount: 30,
        damageType: "fire",
      },
    },
  }, "committed");
  assert.ok(eventTypes(definition).includes("DefinitionRegistered"));
  const hazard = scenario.run({
    kind: "triggerHazard",
    proposalId: "proposal:trigger-flash-fire",
    definitionId: "hazard:flash-fire",
    triggeringEntityId: "pc-1",
    zoneId: "zone:powder-cellar",
    causeFactIds: ["fact:chapter-one-goal"],
  }, "committed");
  assert.ok(eventTypes(hazard).includes("HazardTriggered"));
  assert.ok(eventTypes(hazard).includes("DamagePacketResolved"));
  assert.ok(eventTypes(hazard).includes("HitPointsChanged"));
  assert.ok(eventTypes(hazard).includes("CreatureDied"));
  assert.equal(scenario.state().characterControls["pc-1"], undefined);
  assert.equal(scenario.state().entities["pc-1"].lastControllerSeatId, "seat:auto:principal-1");
  assert.equal(scenario.state().entities["pc-1"].tenureStatus, "dead");
  const deadLifecycle = project(PROFILES, scenario.state(), {
    kind: "player",
    purpose: "lifecycle",
    principalId: "principal-1",
    sessionVersion: 1,
    seatId: "seat:auto:principal-1",
    characterId: "pc-1",
  });
  assert.equal(deadLifecycle?.kind, "projected");
  assert.deepEqual(deadLifecycle.lifecycle, {
    kind: "successorRequired",
    defaultPredecessorCharacterId: "pc-1",
    eligiblePredecessors: [{
      characterId: "pc-1",
      name: "阿岚",
      tenureStatus: "dead",
    }],
  });
});

test("2014 rests wait for fictional time and resolve recovery through Room-owned randomness", () => {
  function restGenesis(character, suffix) {
    const initialState = structuredClone(INITIAL_STATE);
    const roomId = `world-campaign-rest-${suffix}`;
    initialState.roomId = roomId;
    initialState.entities["pc-1"] = {
      ...structuredClone(initialState.entities["pc-1"]),
      ...structuredClone(character),
    };
    const initialStateHash = fixtureStateHash(initialState);
    initialState.eventHeadHash = initialStateHash;
    const unsigned = {
      ...UNSIGNED_GENESIS,
      roomId,
      initialState,
      initialStateHash,
    };
    return { ...unsigned, genesisHash: fixtureHash(unsigned) };
  }

  const shortScenario = createScenario(restGenesis({
    classId: "fighter",
    level: 3,
    hitPoints: { current: 4, maximum: 20 },
    resources: { resolve: 0, hitDice: 2, surge: 0, slot1: 0 },
    resourceMaximums: { resolve: 1, hitDice: 3, surge: 1, slot1: 2 },
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
  }, "short"));
  shortScenario.reject({
    kind: "startRest",
    proposalId: "proposal:short-too-brief",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3599999999",
    hitDiceToSpend: 2,
    arcaneRecoverySlotLevels: [],
  }, "invalidRulesInput");
  const started = shortScenario.run({
    kind: "startRest",
    proposalId: "proposal:short-authoritative",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 2,
    arcaneRecoverySlotLevels: [],
  }, "committed");
  const activityId = eventOf(started, "RestStarted").payload.activityId;
  shortScenario.reject({
    kind: "completeActivity",
    proposalId: "proposal:short-premature",
    activityId,
  }, "missingPrerequisite");
  shortScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:short-hour-elapses",
    characterId: "pc-1",
    goal: "完成不受打扰的一小时短休",
    method: "安静包扎并补充水分",
    feasibility: { kind: "directSuccess", publicBasis: "这一小时没有新的中断事件。" },
    outcome: { publicResult: "一小时过去", fictionTimeCostMicros: "3600000000" },
  }, "committed");
  const completion = shortScenario.run({
    kind: "completeActivity",
    proposalId: "proposal:short-complete",
    activityId,
  }, "awaitingRandomness");
  const request = eventOf(completion, "RandomnessRequested").payload.request;
  assert.equal(request.purpose, "restHitDice");
  assert.deepEqual(request.dice, [{ count: "2", sides: "10" }]);
  assert.equal(shortScenario.state().campaignRuntime.activities[activityId].status, "active");

  const fulfilled = shortScenario.fulfill(completion.continuation, [7, 4], "committed");
  assert.deepEqual(
    eventTypes(fulfilled),
    ["DiceRolled", "ActivityCompleted", "RestCompleted", "CharacterMechanicsSynchronized"],
  );
  const shortCharacter = shortScenario.state().entities["pc-1"];
  assert.equal(shortCharacter.hitPoints.current, 19, "d10 rolls 7 and 4 each add CON +2");
  assert.equal(shortCharacter.resources.hitDice, 0);
  assert.equal(shortCharacter.resources.surge, 1);
  assert.equal(shortCharacter.resources.slot1, 0, "short rest does not restore spell slots");
  assert.equal(shortCharacter.resources.resolve, 0, "product resources are not implicitly restored");

  const longScenario = createScenario(restGenesis({
    classId: "fighter",
    level: 3,
    hitPoints: { current: 1, maximum: 20 },
    resources: { resolve: 0, hitDice: 0, surge: 0, rage: 0, slot1: 0 },
    resourceMaximums: { resolve: 1, hitDice: 3, surge: 1, rage: 2, slot1: 2 },
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
  }, "long"));
  const longStarted = longScenario.run({
    kind: "startRest",
    proposalId: "proposal:long-authoritative",
    characterId: "pc-1",
    restKind: "long",
    intendedDurationMicros: "28800000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  }, "committed");
  const longActivityId = eventOf(longStarted, "RestStarted").payload.activityId;
  longScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:long-eight-hours-elapse",
    characterId: "pc-1",
    goal: "完成八小时长休",
    method: "轮流守夜并休息",
    feasibility: { kind: "directSuccess", publicBasis: "八小时内没有超过许可的中断。" },
    outcome: { publicResult: "八小时过去", fictionTimeCostMicros: "28800000000" },
  }, "committed");
  longScenario.run({
    kind: "completeActivity",
    proposalId: "proposal:long-complete",
    activityId: longActivityId,
  }, "committed");
  const longCharacter = longScenario.state().entities["pc-1"];
  assert.equal(longCharacter.hitPoints.current, 20);
  assert.equal(longCharacter.resources.hitDice, 1, "long rest regains at least one and at most half the maximum");
  assert.equal(longCharacter.resources.surge, 1);
  assert.equal(longCharacter.resources.rage, 2);
  assert.equal(longCharacter.resources.slot1, 2);
  assert.equal(longCharacter.resources.resolve, 0);
  assert.equal(longCharacter.lastLongRestCompletedAtMicros, "28800000000");
  longScenario.reject({
    kind: "startRest",
    proposalId: "proposal:second-long-too-soon",
    characterId: "pc-1",
    restKind: "long",
    intendedDurationMicros: "28800000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  }, "missingPrerequisite");

  const wizardScenario = createScenario(restGenesis({
    classId: "wizard",
    level: 3,
    hitPoints: { current: 10, maximum: 14 },
    resources: { hitDice: 2, arcaneRecovery: 1, slot1: 1, slot2: 0 },
    resourceMaximums: { hitDice: 3, arcaneRecovery: 1, slot1: 4, slot2: 2 },
    abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
  }, "arcane-recovery"));
  assert.deepEqual(
    wizardScenario.view(ALICE_VIEWER).controlledCharacter.restRecoveryOptions,
    {
      shortRest: {
        hitDiceMaximumSpend: 2,
        hitDieSides: 6,
        arcaneRecovery: {
          eligible: true,
          spellLevelBudget: 2,
          maximumSlotsByLevel: { 1: 3, 2: 2, 3: 0, 4: 0, 5: 0 },
        },
      },
    },
  );
  const wizardRest = wizardScenario.run({
    kind: "startRest",
    proposalId: "proposal:wizard-short-rest",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [2],
  }, "committed");
  const wizardActivityId = eventOf(wizardRest, "RestStarted").payload.activityId;
  wizardScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:wizard-hour-elapses",
    characterId: "pc-1",
    goal: "完成奥术回想所需的一小时短休",
    method: "研读法术书并回想施法结构",
    feasibility: { kind: "directSuccess", publicBasis: "这一小时没有发生中断。" },
    outcome: { fictionTimeCostMicros: "3600000000" },
  }, "committed");
  wizardScenario.run({
    kind: "completeActivity",
    proposalId: "proposal:wizard-rest-complete",
    activityId: wizardActivityId,
  }, "committed");
  assert.equal(wizardScenario.state().entities["pc-1"].resources.slot2, 1);
  assert.equal(wizardScenario.state().entities["pc-1"].resources.arcaneRecovery, 0);
});

test("facts and knowledge drive bounded NPC plans, meaningful failure, and a real sequel boundary", () => {
  const scenario = createScenario();
  scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:define-powder-cellar",
    definition: {
      definitionId: "location:powder-cellar",
      revision: "1",
      definitionKind: "location",
      rulesBasis: "zhuwei-product-ruling",
      storyBasis: ["fact:chapter-one-goal"],
      publicDescription: "旧地窖的石墙吸满潮气。",
    },
  }, "committed");
  scenario.run({
    kind: "declareCanonicalFact",
    proposalId: "proposal:materialize-powder-cache",
    fact: {
      factId: "fact:powder-cache",
      factKind: "hiddenReality",
      subjectRefs: ["location:powder-cellar"],
      value: "墙后封存着走私火药",
      source: "dynamicMaterialization",
      causalParentIds: ["fact:chapter-one-goal"],
      visibilityPolicy: "hiddenUntilEvidence",
    },
  }, "committed");
  scenario.run({
    kind: "acquireSensoryEvidence",
    proposalId: "proposal:alice-smells-powder",
    characterId: "pc-1",
    factId: "fact:powder-cache",
    sense: "smell",
    clarity: "obvious",
    publicEvidence: "墙缝持续渗出浓重火药味",
  }, "committed");
  scenario.run({
    kind: "createSourceClaim",
    proposalId: "proposal:warden-rumor",
    speakerId: "npc-warden",
    claimId: "claim:cellar-treasure",
    semanticContent: "守钥人听说地窖里只有旧王的宝藏",
    sourceBasis: "十年前商旅转述",
    motive: "阻止外人靠近",
    formedAtFictionMicros: "0",
  }, "committed");
  scenario.run({
    kind: "formCharacterInference",
    proposalId: "proposal:alice-infers-smuggling",
    characterId: "pc-1",
    inferenceId: "inference:smuggling-cache",
    evidenceRefs: ["fact:powder-cache"],
    conclusion: "有人近期利用地窖储存走私火药",
    confidence: "probable",
  }, "committed");
  scenario.run({
    kind: "changeRelationship",
    proposalId: "proposal:alice-reassures-warden",
    subjectIds: ["pc-1", "npc-warden"],
    relationshipId: "relationship:warden-alan",
    change: "守钥人愿意听取阿岚的调查结论",
    basisFactIds: ["fact:chapter-one-goal"],
  }, "committed");
  scenario.run({
    kind: "makePromise",
    proposalId: "proposal:promise-protect-warden",
    promiseId: "promise:protect-warden",
    promisorId: "pc-1",
    promiseeId: "npc-warden",
    content: "调查期间保护守钥人",
    condition: "直到地窖威胁解除",
  }, "committed");

  const aliceBeforeShare = scenario.view(ALICE_VIEWER);
  const bobBeforeShare = scenario.view(BOB_VIEWER);
  const wardenBeforeShare = scenario.view(WARDEN_VIEWER);
  assertProjectionContains(
    aliceBeforeShare,
    "墙缝持续渗出浓重火药味",
    "inference:smuggling-cache",
    "promise:protect-warden",
  );
  assertProjectionOmits(bobBeforeShare, "fact:powder-cache", "inference:smuggling-cache");
  assertProjectionOmits(wardenBeforeShare, "inference:smuggling-cache");
  assertProjectionContains(wardenBeforeShare, "claim:cellar-treasure");

  scenario.reject({
    kind: "formNpcPlan",
    proposalId: "proposal:warden-counter-secret-plan",
    npcId: "npc-warden",
    planId: "plan:counter-alice-secret",
    goal: "针对阿岚未分享的推断布置伏击",
    knowledgeRefs: ["inference:smuggling-cache"],
    nextAction: "封死阿岚尚未提到的入口",
  }, "unsupportedOperation");

  scenario.reject({
    kind: "shareKnowledge",
    proposalId: "proposal:alice-tries-out-of-world-share",
    senderCharacterId: "pc-1",
    recipientEntityIds: ["pc-2"],
    knowledgeRefs: ["fact:powder-cache"],
    medium: "没有世界内媒介的元游戏转述",
    contentLayer: "full",
  }, "privateOrUnknownReference");

  const shared = scenario.run({
    kind: "shareKnowledge",
    proposalId: "proposal:alice-shares-powder-evidence",
    senderCharacterId: "pc-1",
    recipientEntityIds: ["pc-2", "npc-warden"],
    knowledgeRefs: ["fact:powder-cache", "inference:smuggling-cache"],
    medium: "配对传声石中的口头说明",
    mediumFactId: "fact:party-speaking-stones",
    contentLayer: "full",
  }, "committed");
  assert.equal(eventTypes(shared).filter((type) => type === "KnowledgeAcquired").length, 2);
  assertProjectionContains(scenario.view(BOB_VIEWER), "fact:powder-cache", "pc-1");
  assertProjectionContains(scenario.view(WARDEN_VIEWER), "inference:smuggling-cache", "pc-1");

  scenario.reject({
    kind: "formNpcPlan",
    proposalId: "proposal:warden-secures-cellar",
    npcId: "npc-warden",
    planId: "plan:secure-cellar",
    goal: "阻止火药被点燃",
    knowledgeRefs: ["fact:powder-cache"],
    nextAction: "带领巡夜人隔绝火源",
    resourceRefs: ["faction:watch", WATCH_FACTION_RESOURCE_REF],
  }, "unsupportedOperation");
  scenario.reject({
    kind: "advanceFactionPlan",
    proposalId: "proposal:watch-isolates-flame",
    factionId: "faction:watch",
    planId: "plan:secure-cellar",
    actingNpcId: "npc-warden",
    causeFactIds: ["fact:powder-cache"],
    action: "封锁明火并留下可见警戒线",
  }, "unsupportedOperation");

  const actorPlanFact = JSON.stringify({
    schema: "zhuwei.actor-plan-draft/v1",
    npcRef: "npc-warden",
    factionRef: "faction:watch",
    planId: "plan:secure-cellar",
    goal: "阻止火药被点燃",
    premiseRefs: ["fact:powder-cache"],
    nextStep: "带领巡夜人隔绝火源",
    resourceRefs: ["faction:watch", WATCH_FACTION_RESOURCE_REF],
    activity: {
      activityId: "activity:watch-secures-cellar",
      activityKind: "factionOperation",
      intendedDurationMicros: "1000000",
    },
    due: { kind: "activityCompletion" },
    trigger: null,
    trace: {
      factRef: "fact:watch-fire-cordon",
      description: "庭院通往地窖的路口出现巡夜人拉起的明火警戒线",
      visibilityPolicyRef: "visibility:scene-observers",
    },
    alternateTarget: {
      targetRef: "yard",
      reason: "地窖入口不可用时，先封锁庭院中的火源通路",
    },
  });
  const directActorPlan = JSON.parse(actorPlanFact);
  scenario.reject({
    kind: "formNpcActorPlan",
    proposalId: "proposal:direct-actor-plan-bypass",
    npcId: directActorPlan.npcRef,
    factionRef: directActorPlan.factionRef,
    planId: directActorPlan.planId,
    goal: directActorPlan.goal,
    premiseRefs: directActorPlan.premiseRefs,
    nextStep: directActorPlan.nextStep,
    resourceRefs: directActorPlan.resourceRefs,
    activity: directActorPlan.activity,
    due: null,
    trigger: {
      kind: "knowledgeAcquired",
      knowledgeRef: "fact:powder-cache",
    },
    trace: directActorPlan.trace,
    alternateTarget: directActorPlan.alternateTarget,
  }, "invalidRulesInput");
  const actorPlanProgram = compileKpFormDraft("materialization.v1", {
    goal: "让守钥人依据已知火药证据组织巡夜人",
    method: "formActorPlan",
    proposedFact: actorPlanFact,
    basisRefs: [
      "yard",
      "npc-warden",
      "faction:watch",
      WATCH_FACTION_RESOURCE_REF,
      "fact:powder-cache",
    ],
    resolution: "direct",
    durationUnit: "second",
    durationValue: 1,
  });
  const formedFactionPlan = scenario.run({
    kind: "executeCausalActionProgram",
    rootActionId: "root:form-current-faction-actor-plan",
    actorCharacterId: "pc-2",
    actionLanguageRef: actorPlanProgram.languageRef,
    actionLanguageHash: actorPlanProgram.languageHash,
    causalActionProgram: actorPlanProgram,
  }, "committed");
  assert.ok(eventTypes(formedFactionPlan).includes("NpcPlanFormed"));
  assert.ok(eventTypes(formedFactionPlan).includes("FactionPlanFormed"));
  assert.deepEqual(eventOf(formedFactionPlan, "NpcPlanFormed").payload.resourceRefs, [
    "faction:watch",
    WATCH_FACTION_RESOURCE_REF,
  ]);
  assert.deepEqual(eventOf(formedFactionPlan, "FactionPlanFormed").payload.resourceRefs, [
    "faction:watch",
    WATCH_FACTION_RESOURCE_REF,
  ]);
  assert.ok(formedFactionPlan.scopeProof.reads.includes("faction:faction:watch"));
  assert.ok(formedFactionPlan.scopeProof.reads.includes(
    `faction-resource:${WATCH_FACTION_RESOURCE_REF}`,
  ));
  assert.ok(formedFactionPlan.scopeProof.creates.includes("npc-plan:plan:secure-cellar"));
  assert.ok(formedFactionPlan.scopeProof.creates.includes("faction-plan:plan:secure-cellar"));
  assert.ok(
    formedFactionPlan.scopeProof.creates.includes("activity:activity:watch-secures-cellar"),
    JSON.stringify(formedFactionPlan.scopeProof),
  );

  const frozenFactionPlan = scenario.state().campaignRuntime.npcPlans["plan:secure-cellar"];
  const dueChildRoot = dueActorPlanChildRoot(frozenFactionPlan);
  assert.equal(typeof dueChildRoot, "string");
  const dueExecution = {
    kind: "resolveDueActorPlan",
    proposalId: dueChildRoot,
    affectedCharacterId: "pc-2",
    causedByRootActionId: "root:player-observes-faction-plan-due",
    decision: "execute",
    planId: "plan:secure-cellar",
    mechanicalProposal: null,
  };
  const authorityLostState = scenario.state();
  authorityLostState.campaignRuntime.factions["faction:watch"].memberRefs = [];
  const authorityLost = step(PROFILES, authorityLostState, dueExecution);
  assert.equal(authorityLost.kind, "rejected");
  assert.equal(authorityLost.rejection.code, "invalidWorldState");

  const beforeAdvance = scenario.state();
  const deferred = step(PROFILES, beforeAdvance, {
    ...dueExecution,
    causedByRootActionId: "root:player-observes-faction-plan-deferred",
    decision: "defer",
    reason: "巡夜人仍在集结",
    deferUntilFictionMicros: (
      BigInt(frozenFactionPlan.due.atFictionMicros) + 2_000_000n
    ).toString(),
  });
  assert.equal(deferred.kind, "committed");
  assert.ok(
    deferred.scopeProof.writes.includes("faction-plan:plan:secure-cellar"),
  );
  assert.ok(deferred.scopeProof.reads.includes("faction:faction:watch"));
  assert.ok(deferred.scopeProof.reads.includes("knowledge:npc-warden:fact:powder-cache"));

  const cancelled = step(PROFILES, beforeAdvance, {
    ...dueExecution,
    causedByRootActionId: "root:player-observes-faction-plan-cancelled",
    decision: "cancel",
    reason: "火药已经被安全转移",
  });
  assert.equal(cancelled.kind, "committed");
  assert.ok(cancelled.scopeProof.writes.includes("npc-plan:plan:secure-cellar"));
  assert.ok(cancelled.scopeProof.writes.includes("faction-plan:plan:secure-cellar"));
  assert.ok(cancelled.scopeProof.writes.includes("activity:activity:watch-secures-cellar"));

  const advancedFactionPlan = scenario.run(dueExecution, "committed");
  assert.ok(eventTypes(advancedFactionPlan).includes("FactionActionCommitted"));
  assert.ok(eventTypes(advancedFactionPlan).includes("FactionPlanAdvanced"));
  assert.ok(advancedFactionPlan.scopeProof.reads.includes("faction:faction:watch"));
  assert.ok(advancedFactionPlan.scopeProof.reads.includes(
    `faction-resource:${WATCH_FACTION_RESOURCE_REF}`,
  ));
  assert.ok(advancedFactionPlan.scopeProof.reads.includes(
    "knowledge:npc-warden:fact:powder-cache",
  ));
  assert.ok(advancedFactionPlan.scopeProof.writes.includes("npc-plan:plan:secure-cellar"));
  assert.ok(advancedFactionPlan.scopeProof.writes.includes("faction-plan:plan:secure-cellar"));
  assert.ok(advancedFactionPlan.scopeProof.writes.includes("activity:activity:watch-secures-cellar"));
  const committedFactionAction = eventOf(advancedFactionPlan, "FactionActionCommitted");
  const factionAdvance = eventOf(advancedFactionPlan, "FactionPlanAdvanced");
  const foldState = structuredClone(beforeAdvance);
  assert.equal(applyCampaignEvent(foldState, committedFactionAction), true);
  assert.equal(validateCampaignEventPayload("FactionPlanAdvanced", {
    ...factionAdvance.payload,
    causeFactIds: [],
  }), false);
  assert.throws(
    () => applyCampaignEvent(structuredClone(foldState), {
      ...factionAdvance,
      payload: {
        ...factionAdvance.payload,
        action: "伪造的势力行动",
      },
    }),
    /faction plan advance precondition mismatch/,
  );
  assert.equal(
    scenario.state().campaignRuntime.factionPlans["plan:secure-cellar"].status,
    "advanced",
  );
  assert.equal(
    scenario.state().campaignRuntime.factionPlans["plan:secure-cellar"].lastAdvance.action,
    "带领巡夜人隔绝火源",
  );

  const failureScenario = createScenario();
  failureScenario.run({
    kind: "openSceneQuestion",
    proposalId: "proposal:open-vault-question",
    sceneQuestionId: "scene-question:vault",
    question: "能否在巡夜人抵达前打开金库？",
  }, "committed");
  const failure = failureScenario.run({
    kind: "commitMeaningfulFailure",
    proposalId: "proposal:vault-route-fails",
    characterId: "pc-1",
    goalId: "goal:open-vault",
    methodFingerprint: "bare-hands-on-sealed-wheel",
    factualCause: "金库轮盘的倒计时已经归零",
    consequences: {
      routeClosed: "正门锁芯熔断",
      fictionTimeCostMicros: "60000000",
      factionPlanAdvanced: "faction:watch",
      newChoice: "寻找排水渠或与守钥人交易",
    },
  }, "committed");
  assert.ok(eventTypes(failure).includes("MeaningfulFailureCommitted"));
  failureScenario.reject({
    kind: "resolveFreeAction",
    proposalId: "proposal:repeat-vault-check",
    characterId: "pc-1",
    goal: "打开金库",
    method: "继续徒手转动同一个轮盘",
    retryOfGoalId: "goal:open-vault",
    methodFingerprint: "bare-hands-on-sealed-wheel",
    feasibility: { kind: "checkRequired", publicBasis: "请求原样重试" },
    check: { kind: "ability", ability: "str", dc: 15, mode: "normal" },
  }, "unchangedRetry");
  failureScenario.run({
    kind: "changeRetryCondition",
    proposalId: "proposal:accept-drain-cost",
    characterId: "pc-1",
    goalId: "goal:open-vault",
    change: "costAccepted",
    evidence: "接受从排水渠进入并损失一小时",
  }, "committed");
  const revisedAttempt = failureScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:drain-vault-check",
    characterId: "pc-1",
    goal: "经排水渠进入金库",
    method: "使用绳索从排水渠下降",
    retryOfGoalId: "goal:open-vault",
    methodFingerprint: "rope-through-drain",
    feasibility: { kind: "checkRequired", publicBasis: "路线与代价均已实质改变" },
    check: { kind: "skill", ability: "dex", skill: "acrobatics", dc: 12, mode: "normal" },
  }, "awaitingRandomness");
  assert.ok(eventTypes(revisedAttempt).includes("RandomnessRequested"));

  const endingScenario = createScenario();
  endingScenario.run({
    kind: "openSceneQuestion",
    proposalId: "proposal:open-ending-question",
    sceneQuestionId: "scene-question:seal",
    question: "封印能否在黎明前解除？",
  }, "committed");
  endingScenario.run({
    kind: "declareCanonicalFact",
    proposalId: "proposal:seal-resolved",
    fact: {
      factId: "fact:seal-resolved",
      factKind: "conflictOutcome",
      subjectRefs: ["chapter:one"],
      value: "封印已解除且不会自行复原",
      source: "characterAction",
      causalParentIds: ["fact:chapter-one-goal"],
      visibilityPolicy: "public",
    },
  }, "committed");
  endingScenario.run({
    kind: "answerSceneQuestion",
    proposalId: "proposal:answer-ending-question",
    sceneQuestionId: "scene-question:seal",
    answerFactIds: ["fact:seal-resolved"],
  }, "committed");
  endingScenario.run({
    kind: "raiseEndingCandidate",
    proposalId: "proposal:raise-ending",
    endingCandidateId: "ending:seal-broken",
    basisFactIds: ["fact:seal-resolved"],
    unresolvedConsequences: ["threat:powder-smugglers"],
  }, "committed");
  const concluded = endingScenario.run({
    kind: "concludeStory",
    proposalId: "proposal:conclude-seal-story",
    storyId: "story:seal",
    endingCandidateId: "ending:seal-broken",
    outcome: "success",
    longTermConsequences: ["守钥人恢复自由", "走私威胁留待未来处理"],
  }, "concluded");
  assert.ok(eventTypes(concluded).includes("StoryConcluded"));
  endingScenario.run({
    kind: "recordEpilogueChoice",
    proposalId: "proposal:alice-epilogue",
    characterId: "pc-1",
    storyId: "story:seal",
    choice: "把封印碎片交还守钥人",
  }, "committed");
  endingScenario.run({
    kind: "startSequel",
    proposalId: "proposal:start-smuggler-sequel",
    priorStoryId: "story:seal",
    sequelStoryId: "story:powder-smugglers",
    chapterId: "chapter:two",
    anchorFactIds: ["fact:seal-resolved", "threat:powder-smugglers"],
    sceneQuestion: "谁在利用旧地窖走私火药？",
    activityTransitions: [],
  }, "committed");
  assert.deepEqual(
    endingScenario.state().campaignRuntime.chapters["chapter:two"].moduleRef,
    MODULE_REF,
  );
  assertProjectionContains(
    endingScenario.view(ALICE_VIEWER),
    "story:seal",
    "success",
    "story:powder-smugglers",
    "chapter:two",
  );
});

test("growth and chapter transition preserve continuity while a successor inherits only by provenance", () => {
  const scenario = createScenario();
  const debt = scenario.run({
    kind: "incurDebt",
    proposalId: "proposal:alice-owes-warden",
    debtId: "debt:replace-vault-door",
    debtorId: "pc-1",
    creditorId: "npc-warden",
    obligation: "重铸地窖被破坏的青铜门",
    condition: "下一次月圆前",
    basisFactIds: ["fact:chapter-one-goal"],
  }, "committed");
  assert.ok(eventTypes(debt).includes("DebtIncurred"));
  const advancement = scenario.run({
    kind: "grantMilestone",
    proposalId: "proposal:chapter-one-milestone",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "awaitingInput");
  assert.ok(eventTypes(advancement).includes("AdvancementAvailable"));
  assert.equal(advancement.pending.kind, "advancementChoice");
  const advanced = scenario.run({
    kind: "recordAdvancementChoice",
    proposalId: "proposal:alice-level-four",
    pendingInputId: advancement.pending.pendingInputId,
    characterId: "pc-1",
    choice: {
      classId: "rogue",
      newLevel: 4,
      hitPointMethod: "fixed2014",
      selectedFeatureIds: ["feature:ability-score-improvement"],
      abilityScoreIncreases: { dex: 2 },
    },
  }, "committed");
  assert.ok(eventTypes(advanced).includes("CharacterAdvanced"));
  assert.ok(eventTypes(advanced).includes("CharacterMechanicsSynchronized"));
  const advancedState = scenario.state();
  assert.equal(advancedState.entities["pc-1"].level, 4);
  assert.equal(advancedState.entities["pc-1"].abilityScores.dex, 18);
  assert.equal(advancedState.entities["pc-1"].hitPoints.current, 7, "advancement must not heal");
  assert.equal(advancedState.entities["pc-1"].hitPoints.maximum, 24);
  assert.equal(advancedState.entities["pc-1"].proficiencyBonus, 2);
  assert.deepEqual(advancedState.entities["pc-1"].featureIds, [
    "feature:ability-score-improvement",
    "feature:cunning-action",
    "feature:sneak-attack",
  ]);
  assert.equal(advancedState.combatRuntime.entities["pc-1"].hitPoints.current, "7");
  assert.equal(advancedState.combatRuntime.entities["pc-1"].hitPoints.maximum, "24");
  assert.equal(advancedState.combatRuntime.entities["pc-1"].stats.dex, "18");

  const chapterTransition = scenario.run({
    kind: "transitionChapter",
    proposalId: "proposal:transition-to-chapter-two",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:two",
    ordinal: "2",
    reason: "success",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal", "threat:powder-smugglers"],
    sceneQuestion: "走私者会如何回应封印解除？",
    activityTransitions: [],
  }, "committed");
  assert.deepEqual(
    eventTypes(chapterTransition).filter((eventType) => eventType.startsWith("Chapter")),
    ["ChapterConcluded", "ChapterContinuityRecorded", "ChapterStarted"],
  );
  const continuityManifest = eventOf(
    chapterTransition,
    "ChapterContinuityRecorded",
  ).payload.manifest;
  assert.ok(continuityManifest.characterStates.some(({ ref }) => ref === "character:pc-1"));
  assert.ok(continuityManifest.itemStates.some(({ ref }) =>
    ref === `item:${SEALED_LETTER_ENTRY_ID}`));
  assert.ok(continuityManifest.definitionStates.some(({ ref }) =>
    ref === `item-definition:${SEALED_LETTER_DEFINITION_ID}`));
  assert.ok(continuityManifest.knowledgeStates.some(({ ref }) =>
    ref === "knowledge:pc-1:knowledge:private-sigil"));
  assert.ok(continuityManifest.relationshipStates.some(({ ref }) =>
    ref === "relationship:relationship:warden-alan"));
  assert.ok(continuityManifest.debtStates.some(({ ref }) =>
    ref === "debt:debt:replace-vault-door"));
  assert.ok(continuityManifest.promiseStates.some(({ ref }) =>
    ref === "promise:promise:return-key"));
  assert.ok(continuityManifest.unresolvedThreatRefs.includes("threat:powder-smugglers"));
  const chapterTwoView = scenario.view(ALICE_VIEWER);
  assertProjectionContains(
    chapterTwoView,
    '"level":4',
    '"current":7',
    SEALED_LETTER_ENTRY_ID,
    "knowledge:private-sigil",
    "relationship:warden-alan",
    "debt:replace-vault-door",
    "promise:return-key",
    "threat:powder-smugglers",
    "chapter:two",
  );

  const retired = scenario.run({
    kind: "retireCharacter",
    proposalId: "proposal:alice-retires",
    characterId: "pc-1",
    reason: "阿岚选择留下来重建守钥人组织",
    continueAsNpc: false,
  }, "committed");
  assert.ok(eventTypes(retired).includes("CharacterRetired"));
  const successor = scenario.run({
    kind: "introduceSuccessor",
    proposalId: "proposal:introduce-cang",
    controllerPrincipalId: "principal-1",
    predecessorCharacterId: "pc-1",
    successor: {
      id: "pc-3",
      kind: "player",
      name: "苍岚",
      level: 4,
      sceneId: "yard",
      tenureStatus: "active",
      classId: "rogue",
      raceId: "human",
      subclassId: "thief",
      abilityScores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      hitPoints: { current: 24, maximum: 24 },
      proficiencyBonus: 2,
      resources: { hitDice: 4 },
      resourceMaximums: { hitDice: 4 },
      featureIds: ["feature:ability-score-improvement"],
      cantripIds: [],
      preparedSpellIds: [],
      characterBuild: { classId: "rogue", raceId: "human", cantrips: [], prepared: [] },
    },
    worldEntry: "受守钥人邀请来到庭院",
  }, "committed");
  assert.ok(eventTypes(successor).includes("SuccessorIntroduced"));
  assert.ok(!eventTypes(successor).includes("CharacterMechanicsSynchronized"));
  assert.equal(scenario.state().characterControls["pc-3"].seatId, "seat:auto:principal-1");
  assert.ok(scenario.state().combatRuntime.entities["pc-3"]);
  const successorViewer = {
    kind: "player",
    principalId: "principal-1",
    sessionVersion: 1,
    seatId: "seat:auto:principal-1",
    characterId: "pc-3",
  };
  const initialSuccessorView = scenario.view(successorViewer);
  assertProjectionOmits(
    initialSuccessorView,
    "knowledge:private-sigil",
    SEALED_LETTER_ENTRY_ID,
    "relationship:warden-alan",
    "debt:replace-vault-door",
    "promise:return-key",
  );

  scenario.run({
    kind: "moveIndividually",
    rootActionId: "root:successor-reaches-predecessor-effects",
    characterId: "pc-3",
    destinationSceneId: "shrine",
    fictionTimeCostMicros: "1000000",
  }, "committed");

  scenario.reject({
    kind: "transferInheritance",
    proposalId: "proposal:automatic-inheritance",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: "fact:inheritance:not-established",
    authorizationId: "inheritance-authorization:not-established",
  }, "inheritanceProvenanceRequired");

  const inheritanceSource = scenario.run({
    kind: "establishInheritanceSource",
    proposalId: "proposal:read-sealed-will",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    source: {
      kind: "will",
      publicClause: "将信件和其中记载的银叶印记含义交给苍岚",
      authorizations: [
        {
          authorizationId: "inheritance-authorization:sealed-letter",
          subjectCharacterId: "pc-1",
          kind: "item",
          sourceRef: SEALED_LETTER_ENTRY_ID,
          targetCharacterId: "pc-3",
          targetRef: SEALED_LETTER_ENTRY_ID,
          scope: "transferPossession",
        },
        {
          authorizationId: "inheritance-authorization:private-sigil",
          subjectCharacterId: "pc-1",
          kind: "knowledge",
          sourceRef: "knowledge:private-sigil",
          targetCharacterId: "pc-3",
          targetRef: "knowledge:private-sigil",
          scope: "acquireExactKnowledge",
        },
        {
          authorizationId: "inheritance-authorization:warden-introduction",
          subjectCharacterId: "pc-1",
          kind: "relationship",
          sourceRef: "relationship:warden-alan",
          targetCharacterId: "pc-3",
          targetRef: "relationship:warden-cang",
          scope: "establishDerivedRelationship",
        },
        {
          authorizationId: "inheritance-authorization:vault-door-debt",
          subjectCharacterId: "pc-1",
          kind: "debt",
          sourceRef: "debt:replace-vault-door",
          targetCharacterId: "pc-3",
          targetRef: "debt:cang-replaces-vault-door",
          scope: "assumeDebtObligation",
        },
        {
          authorizationId: "inheritance-authorization:return-key-promise",
          subjectCharacterId: "pc-1",
          kind: "promise",
          sourceRef: "promise:return-key",
          targetCharacterId: "pc-3",
          targetRef: "promise:cang-return-key",
          scope: "assumePromiseObligation",
        },
      ],
    },
  }, "committed");
  const inheritanceSourceFactId = eventOf(
    inheritanceSource,
    "InheritanceSourceEstablished",
  ).payload.factId;
  assertProjectionOmits(
    scenario.view(BOB_VIEWER),
    inheritanceSourceFactId,
    "将信件和其中记载的银叶印记含义交给苍岚",
  );
  const itemInherited = scenario.run({
    kind: "transferInheritance",
    proposalId: "proposal:provenance-bound-item-inheritance",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: inheritanceSourceFactId,
    authorizationId: "inheritance-authorization:sealed-letter",
  }, "committed");
  assert.ok(eventTypes(itemInherited).includes("InheritanceTransferred"));
  assert.ok(eventTypes(itemInherited).includes("ItemTransferred"));
  assert.equal(
    scenario.state().campaignRuntime.itemSystem.entries[SEALED_LETTER_ENTRY_ID].holderRef,
    "pc-3",
  );
  const itemOnlyView = scenario.view(successorViewer);
  assertProjectionContains(itemOnlyView, SEALED_LETTER_ENTRY_ID, "密封信");
  assertProjectionOmits(itemOnlyView, "knowledge:private-sigil");

  scenario.reject({
    kind: "transferInheritance",
    proposalId: "proposal:cannot-reuse-item-authorization",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: inheritanceSourceFactId,
    authorizationId: "inheritance-authorization:sealed-letter",
  }, "inheritanceAuthorizationConsumed");

  const knowledgeInherited = scenario.run({
    kind: "transferInheritance",
    proposalId: "proposal:provenance-bound-knowledge-inheritance",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: inheritanceSourceFactId,
    authorizationId: "inheritance-authorization:private-sigil",
  }, "committed");
  assert.ok(eventTypes(knowledgeInherited).includes("InheritanceTransferred"));
  assert.ok(eventTypes(knowledgeInherited).includes("KnowledgeAcquired"));
  const relationshipInherited = scenario.run({
    kind: "transferInheritance",
    proposalId: "proposal:provenance-bound-relationship-introduction",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: inheritanceSourceFactId,
    authorizationId: "inheritance-authorization:warden-introduction",
  }, "committed");
  assert.ok(eventTypes(relationshipInherited).includes("RelationshipEstablished"));
  const debtInherited = scenario.run({
    kind: "transferInheritance",
    proposalId: "proposal:provenance-bound-debt-assumption",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: inheritanceSourceFactId,
    authorizationId: "inheritance-authorization:vault-door-debt",
  }, "committed");
  assert.ok(eventTypes(debtInherited).includes("DebtAssumed"));
  const promiseInherited = scenario.run({
    kind: "transferInheritance",
    proposalId: "proposal:provenance-bound-promise-assumption",
    predecessorCharacterId: "pc-1",
    successorCharacterId: "pc-3",
    sourceFactId: inheritanceSourceFactId,
    authorizationId: "inheritance-authorization:return-key-promise",
  }, "committed");
  assert.ok(eventTypes(promiseInherited).includes("PromiseAssumed"));
  const inheritedView = scenario.view(successorViewer);
  assertProjectionContains(
    inheritedView,
    SEALED_LETTER_ENTRY_ID,
    "knowledge:private-sigil",
    "relationship:warden-cang",
    "debt:cang-replaces-vault-door",
    "promise:cang-return-key",
  );
  assertProjectionOmits(
    inheritedView,
    "relationship:warden-alan",
    "debt:replace-vault-door",
    "promise:return-key",
  );
});

test("chapter transition is atomic and cannot bypass pending choices or active Activity disposition", () => {
  const pendingScenario = createScenario();
  pendingScenario.run({
    kind: "grantMilestone",
    proposalId: "proposal:chapter-transition-pending-milestone",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "awaitingInput");
  pendingScenario.reject({
    kind: "transitionChapter",
    proposalId: "proposal:cannot-bypass-growth-choice",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:two",
    ordinal: "2",
    reason: "success",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal"],
    sceneQuestion: "下一章如何开始？",
    activityTransitions: [],
  }, "pendingInputUnresolved");

  const activityScenario = createScenario();
  const rest = activityScenario.run({
    kind: "startRest",
    proposalId: "proposal:chapter-boundary-rest",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  }, "committed");
  const activityId = eventOf(rest, "RestStarted").payload.activityId;
  activityScenario.reject({
    kind: "transitionChapter",
    proposalId: "proposal:cannot-drop-active-activity",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:two",
    ordinal: "2",
    reason: "success",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal"],
    sceneQuestion: "下一章如何开始？",
    activityTransitions: [],
  }, "pendingInputUnresolved");
  const transitioned = activityScenario.run({
    kind: "transitionChapter",
    proposalId: "proposal:interrupt-activity-at-chapter-boundary",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:two",
    ordinal: "2",
    reason: "success",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal", "threat:powder-smugglers"],
    sceneQuestion: "下一章如何开始？",
    activityTransitions: [{ activityId, disposition: "interrupt" }],
  }, "committed");
  assert.deepEqual(eventTypes(transitioned), [
    "ActivityInterrupted",
    "ChapterConcluded",
    "ChapterContinuityRecorded",
    "ChapterStarted",
  ]);
  assertProjectionContains(
    activityScenario.view(ALICE_VIEWER),
    activityId,
    '"status":"interrupted"',
    "chapter:two",
  );

  const completionScenario = createScenario();
  const dueRest = completionScenario.run({
    kind: "startRest",
    proposalId: "proposal:chapter-boundary-completable-rest",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 0,
    arcaneRecoverySlotLevels: [],
  }, "committed");
  const dueActivityId = eventOf(dueRest, "RestStarted").payload.activityId;
  completionScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:chapter-boundary-hour-elapses",
    characterId: "pc-1",
    goal: "完成切章前已经冻结的一小时短休",
    method: "在安全地点持续休息一小时",
    feasibility: { kind: "directSuccess", publicBasis: "这一小时没有中断事件。" },
    outcome: { publicResult: "一小时过去", fictionTimeCostMicros: "3600000000" },
  }, "committed");
  const completedAtTransition = completionScenario.run({
    kind: "transitionChapter",
    proposalId: "proposal:complete-due-activity-at-chapter-boundary",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:two",
    ordinal: "2",
    reason: "success",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal", "threat:powder-smugglers"],
    sceneQuestion: "下一章如何开始？",
    activityTransitions: [{ activityId: dueActivityId, disposition: "complete" }],
  }, "committed");
  assert.deepEqual(eventTypes(completedAtTransition), [
    "ActivityCompleted",
    "RestCompleted",
    "CharacterMechanicsSynchronized",
    "ChapterConcluded",
    "ChapterContinuityRecorded",
    "ChapterStarted",
  ]);
  assertProjectionContains(
    completionScenario.view(ALICE_VIEWER),
    dueActivityId,
    '"status":"completed"',
    "chapter:two",
  );

  const randomnessScenario = createScenario();
  const randomRest = randomnessScenario.run({
    kind: "startRest",
    proposalId: "proposal:chapter-boundary-random-rest",
    characterId: "pc-1",
    restKind: "short",
    intendedDurationMicros: "3600000000",
    hitDiceToSpend: 1,
    arcaneRecoverySlotLevels: [],
  }, "committed");
  const randomActivityId = eventOf(randomRest, "RestStarted").payload.activityId;
  randomnessScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:chapter-boundary-random-rest-hour-elapses",
    characterId: "pc-1",
    goal: "完成切章前已经冻结的一小时短休",
    method: "在安全地点持续休息一小时",
    feasibility: { kind: "directSuccess", publicBasis: "这一小时没有中断事件。" },
    outcome: { publicResult: "一小时过去", fictionTimeCostMicros: "3600000000" },
  }, "committed");
  randomnessScenario.reject({
    kind: "transitionChapter",
    proposalId: "proposal:cannot-hide-rest-dice-inside-chapter-transition",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:two",
    ordinal: "2",
    reason: "success",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal"],
    sceneQuestion: "下一章如何开始？",
    activityTransitions: [{ activityId: randomActivityId, disposition: "complete" }],
  }, "pendingInputUnresolved");
});

test("correcting an invalid chapter transition restores the prior active chapter", () => {
  const scenario = createScenario();
  const transitioned = scenario.run({
    kind: "transitionChapter",
    proposalId: "proposal:chapter-transition-to-correct",
    campaignId: "campaign:black-lantern",
    fromChapterId: "chapter:one",
    toChapterId: "chapter:invalid",
    ordinal: "2",
    reason: "rulesMisapplication",
    continuityPolicy: "preserveAuthoritativeFacts",
    storyAnchorRefs: ["fact:chapter-one-goal"],
    sceneQuestion: "这个错误章节不应留在连续性中。",
    activityTransitions: [],
  }, "committed");
  const transitionedHead = scenario.state();
  scenario.run({
    kind: "applyServiceCorrection",
    correctionId: "correction:invalid-chapter-transition",
    targetReceiptId: transitioned.receipt.receiptId,
    actorCharacterId: "pc-1",
    errorKind: "rulesMisapplication",
    publicExplanation: "切章记录错误，恢复原章继续行动。",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: transitionedHead.correctionRuntime.authorityCapability,
    },
    basis: {
      eventHash: transitionedHead.eventHeadHash,
      stateHash: transitioned.events.at(-1).stateHashAfter,
    },
  }, "committed");
  const corrected = scenario.state();
  assert.equal(corrected.campaignRuntime.campaign.currentChapterId, "chapter:one");
  assert.equal(corrected.campaignRuntime.chapters["chapter:one"].status, "active");
  assert.equal(corrected.campaignRuntime.chapters["chapter:one"].continuityManifestHash, undefined);
  assert.equal(corrected.campaignRuntime.chapters["chapter:one"].nextChapterId, undefined);
  assert.equal(corrected.campaignRuntime.chapters["chapter:invalid"], undefined);
});

test("SRD XP awards cross thresholds through staged player choices while milestone grants stay profile-bound", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.campaignRuntime.campaign.advancementProfile = "srdXp2014";
  initialState.entities["pc-1"].experiencePoints = 900;
  const scenario = createScenario(signedGenesis(initialState));

  scenario.reject({
    kind: "grantMilestone",
    proposalId: "proposal:xp-profile-cannot-use-milestone",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "invalidRulesInput");
  scenario.reject({
    kind: "awardExperience",
    proposalId: "proposal:xp-award-zero",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    amount: 0,
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "invalidRulesInput");
  scenario.reject({
    kind: "awardExperience",
    proposalId: "proposal:xp-award-over-bound",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    amount: 1_000_001,
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "invalidRulesInput");

  const award = scenario.run({
    kind: "awardExperience",
    proposalId: "proposal:xp-award-cross-two-levels",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    amount: 5_600,
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "awaitingInput");
  assert.deepEqual(eventOf(award, "ExperienceAwarded").payload, {
    amount: 5_600,
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    sourceFactIds: ["fact:chapter-one-goal"],
    total: 6_500,
  });
  assert.equal(award.pending.kind, "advancementChoice");
  assert.equal(scenario.view(ALICE_VIEWER).controlledCharacter.experiencePoints, 6_500);

  const levelFour = scenario.run({
    kind: "recordAdvancementChoice",
    proposalId: "proposal:xp-choice-level-four",
    pendingInputId: award.pending.pendingInputId,
    characterId: "pc-1",
    choice: {
      classId: "rogue",
      newLevel: 4,
      hitPointMethod: "fixed2014",
      selectedFeatureIds: ["feature:ability-score-improvement"],
      abilityScoreIncreases: { dex: 2 },
    },
  }, "awaitingInput");
  assert.ok(eventTypes(levelFour).includes("CharacterAdvanced"));
  assert.ok(eventTypes(levelFour).includes("AdvancementAvailable"));
  assert.equal(levelFour.pending.options.newLevel, 5);

  const levelFive = scenario.run({
    kind: "recordAdvancementChoice",
    proposalId: "proposal:xp-choice-level-five",
    pendingInputId: levelFour.pending.pendingInputId,
    characterId: "pc-1",
    choice: {
      classId: "rogue",
      newLevel: 5,
      hitPointMethod: "fixed2014",
      selectedFeatureIds: ["feature:uncanny-dodge"],
    },
  }, "committed");
  assert.ok(eventTypes(levelFive).includes("CharacterAdvanced"));
  assert.ok(!eventTypes(levelFive).includes("AdvancementAvailable"));
  assert.equal(scenario.state().entities["pc-1"].level, 5);
  assert.equal(scenario.state().entities["pc-1"].experiencePoints, 6_500);
  assert.equal(scenario.view(ALICE_VIEWER).controlledCharacter.experiencePoints, 6_500);
});

test("correcting an XP award restores the cumulative total and removes its pending advancement", () => {
  const initialState = structuredClone(INITIAL_STATE);
  initialState.campaignRuntime.campaign.advancementProfile = "srdXp2014";
  initialState.entities["pc-1"].experiencePoints = 900;
  const scenario = createScenario(signedGenesis(initialState));
  const awarded = scenario.run({
    kind: "awardExperience",
    proposalId: "proposal:xp-award-to-correct",
    campaignId: "campaign:black-lantern",
    characterId: "pc-1",
    amount: 1_800,
    sourceFactIds: ["fact:chapter-one-goal"],
  }, "awaitingInput");
  assert.ok(scenario.state().pendingInputs[awarded.pending.pendingInputId]);
  const awardedHead = scenario.state();
  scenario.run({
    kind: "applyServiceCorrection",
    correctionId: "correction:xp-award",
    targetReceiptId: awarded.receipt.receiptId,
    actorCharacterId: "pc-1",
    errorKind: "rulesMisapplication",
    publicExplanation: "该经验值奖励记录有误，撤销后重新结算。",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: awardedHead.correctionRuntime.authorityCapability,
    },
    basis: {
      eventHash: awardedHead.eventHeadHash,
      stateHash: awarded.events.at(-1).stateHashAfter,
    },
  }, "committed");
  assert.equal(scenario.state().entities["pc-1"].experiencePoints, 900);
  assert.equal(scenario.state().pendingInputs[awarded.pending.pendingInputId], undefined);
});

test("retirement transitions a former player into an NPC only with explicit consent", () => {
  const rejectedScenario = createScenario();
  rejectedScenario.reject({
    kind: "retireCharacter",
    proposalId: "proposal:retire-without-consent-field",
    characterId: "pc-1",
    reason: "留下守护神龛",
  }, "invalidRulesInput");

  const scenario = createScenario();
  scenario.run({
    kind: "retireCharacter",
    proposalId: "proposal:retire-into-npc",
    characterId: "pc-1",
    reason: "玩家明确同意阿岚留在神龛成为常驻 NPC",
    continueAsNpc: true,
  }, "committed");
  const state = scenario.state();
  assert.equal(state.entities["pc-1"].kind, "npc");
  assert.equal(state.entities["pc-1"].tenureStatus, "npcTransitioned");
  assert.equal(state.entities["pc-1"].lastControllerSeatId, "seat:auto:principal-1");
  assert.equal(state.characterControls["pc-1"], undefined);
  assertProjectionContains(scenario.view({ kind: "npc", npcId: "pc-1" }), "knowledge:private-sigil");
});

test("the Rules projector owns the successor-required view after active character control ends", () => {
  const scenario = createScenario();
  scenario.run({
    kind: "retireCharacter",
    proposalId: "proposal:retire-before-successor-projection",
    characterId: "pc-1",
    reason: "玩家明确让阿岚退役，并在稍后创建继任角色",
    continueAsNpc: false,
  }, "committed");

  const formerControlBypass = project(PROFILES, scenario.state(), ALICE_VIEWER);
  assert.equal(formerControlBypass?.kind, "rejected");
  assert.equal(formerControlBypass.rejection?.code, "viewerUnauthorized");

  const projected = project(PROFILES, scenario.state(), {
    kind: "player",
    purpose: "lifecycle",
    principalId: "principal-1",
    sessionVersion: 1,
    seatId: "seat:auto:principal-1",
    characterId: "pc-1",
  });
  assert.equal(
    projected?.kind,
    "projected",
    `expected projected lifecycle view, received ${projected?.kind ?? typeof projected}`,
  );
  assert.deepEqual(projected.controlledCharacter, null);
  assert.deepEqual(projected.lifecycle, {
    kind: "successorRequired",
    defaultPredecessorCharacterId: "pc-1",
    eligiblePredecessors: [{
      characterId: "pc-1",
      name: "阿岚",
      tenureStatus: "retired",
    }],
  });
  assert.match(projected.projectionHash, /^sha256:[0-9a-f]{64}$/);
});

test("lifecycle correction restores suspended input and removes an invalid successor completely", () => {
  const retirementScenario = createScenario();
  const clarification = retirementScenario.run({
    kind: "resolveFreeAction",
    proposalId: "proposal:lifecycle-pending",
    characterId: "pc-1",
    goal: "拉下地窖中的拉杆",
    method: "尚未说明是哪一根",
    feasibility: {
      kind: "clarificationRequired",
      publicBasis: "两根拉杆后果不同且不可逆。",
      choices: [
        { choiceId: "left", label: "左侧" },
        { choiceId: "right", label: "右侧" },
      ],
    },
  }, "awaitingInput");
  const pendingInputId = clarification.pending.pendingInputId;
  const combatBeforeRetirement = retirementScenario.state().combatRuntime.entities["pc-1"];
  const retired = retirementScenario.run({
    kind: "retireCharacter",
    proposalId: "proposal:lifecycle-retirement",
    characterId: "pc-1",
    reason: "错误地记录为离团",
    continueAsNpc: false,
  }, "committed");
  assert.equal(retirementScenario.state().pendingInputs[pendingInputId], undefined);
  assert.ok(retirementScenario.state().multiplayerRuntime.suspendedPendingInputs[pendingInputId]);
  const retiredHead = retirementScenario.state();
  retirementScenario.run({
    kind: "applyServiceCorrection",
    correctionId: "correction:lifecycle-retirement",
    targetReceiptId: retired.receipt.receiptId,
    actorCharacterId: "pc-1",
    errorKind: "rulesMisapplication",
    publicExplanation: "该角色并未确认离团。",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: retiredHead.correctionRuntime.authorityCapability,
    },
    basis: {
      eventHash: retiredHead.eventHeadHash,
      stateHash: retired.events.at(-1).stateHashAfter,
    },
  }, "committed");
  const restored = retirementScenario.state();
  assert.equal(restored.entities["pc-1"].tenureStatus, "active");
  assert.equal(restored.characterControls["pc-1"].seatId, "seat:auto:principal-1");
  assert.ok(restored.pendingInputs[pendingInputId]);
  assert.equal(restored.multiplayerRuntime.suspendedPendingInputs[pendingInputId], undefined);
  assert.equal(restored.receipts["proposal:lifecycle-pending"].status, "awaitingInput");
  assert.deepEqual(restored.combatRuntime.entities["pc-1"], combatBeforeRetirement);

  const successorScenario = createScenario();
  successorScenario.run({
    kind: "retireCharacter",
    proposalId: "proposal:predecessor-retirement",
    characterId: "pc-1",
    reason: "交棒给后来者",
    continueAsNpc: false,
  }, "committed");
  const introduced = successorScenario.run({
    kind: "introduceSuccessor",
    proposalId: "proposal:invalid-successor",
    predecessorCharacterId: "pc-1",
    controllerPrincipalId: "principal-1",
    successor: {
      id: "pc-invalid-successor",
      kind: "player",
      name: "误入记录的继任者",
      sceneId: "shrine",
      tenureStatus: "active",
      classId: "fighter",
      raceId: "human",
      level: 3,
      hitPoints: { current: 25, maximum: 25 },
      resources: { hitDice: 3 },
      resourceMaximums: { hitDice: 3 },
      abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      featureIds: ["feature:action-surge", "feature:second-wind"],
      characterBuild: {
        classId: "fighter",
        raceId: "human",
        subclassId: "champion",
        equipped: {},
        backpack: [],
        cantrips: [],
        prepared: [],
      },
    },
    worldEntry: "在神龛前与队伍会合",
  }, "committed");
  const introducedHead = successorScenario.state();
  successorScenario.run({
    kind: "applyServiceCorrection",
    correctionId: "correction:invalid-successor",
    targetReceiptId: introduced.receipt.receiptId,
    actorCharacterId: "pc-1",
    errorKind: "rulesMisapplication",
    publicExplanation: "继任人物卡录入错误，尚未进入因果链。",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: introducedHead.correctionRuntime.authorityCapability,
    },
    basis: {
      eventHash: introducedHead.eventHeadHash,
      stateHash: introduced.events.at(-1).stateHashAfter,
    },
  }, "committed");
  const correctedSuccessor = successorScenario.state();
  assert.equal(correctedSuccessor.entities["pc-invalid-successor"], undefined);
  assert.equal(correctedSuccessor.characterControls["pc-invalid-successor"], undefined);
  assert.equal(correctedSuccessor.knowledge["pc-invalid-successor"], undefined);
  assert.equal(correctedSuccessor.combatRuntime.entities["pc-invalid-successor"], undefined);
  assert.equal(
    correctedSuccessor.multiplayerRuntime.characterTimelineIds["pc-invalid-successor"],
    undefined,
  );
  assert.equal(correctedSuccessor.multiplayerRuntime.spotlightLedger["pc-invalid-successor"], undefined);
  assert.equal(correctedSuccessor.entities["pc-1"].tenureStatus, "retired");
});

test("correcting an ended tenure after the successor acted opens a causal branch", () => {
  const scenario = createScenario();
  const retired = scenario.run({
    kind: "retireCharacter",
    proposalId: "proposal:causal-retirement-to-correct",
    characterId: "pc-1",
    reason: "错误地记录为离团",
    continueAsNpc: false,
  }, "committed");
  scenario.run({
    kind: "introduceSuccessor",
    proposalId: "proposal:causal-successor",
    predecessorCharacterId: "pc-1",
    controllerPrincipalId: "principal-1",
    successor: {
      id: "pc-causal-successor",
      kind: "player",
      name: "错误离团后进入因果链的继任者",
      sceneId: "shrine",
      tenureStatus: "active",
      classId: "fighter",
      raceId: "human",
      level: 3,
      hitPoints: { current: 25, maximum: 25 },
      resources: { hitDice: 3 },
      resourceMaximums: { hitDice: 3 },
      abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      featureIds: ["feature:action-surge", "feature:second-wind"],
      characterBuild: {
        classId: "fighter",
        raceId: "human",
        subclassId: "champion",
        equipped: {},
        backpack: [],
        cantrips: [],
        prepared: [],
      },
    },
    worldEntry: "在神龛前与队伍会合",
  }, "committed");
  const successorAction = scenario.run({
    kind: "moveIndividually",
    rootActionId: "root:causal-successor-acts",
    characterId: "pc-causal-successor",
    destinationSceneId: "yard",
    fictionTimeCostMicros: "1000000",
  }, "committed");
  const currentHead = scenario.state();
  const corrected = scenario.run({
    kind: "applyServiceCorrection",
    correctionId: "correction:causal-retirement",
    targetReceiptId: retired.receipt.receiptId,
    actorCharacterId: "pc-1",
    errorKind: "rulesMisapplication",
    publicExplanation: "前任没有确认离团；其后的继任行动保留在旧因果分支。",
    correctionAuthority: {
      kind: "roomCorrectionAuthority",
      capability: currentHead.correctionRuntime.authorityCapability,
    },
    basis: {
      eventHash: currentHead.eventHeadHash,
      stateHash: successorAction.events.at(-1).stateHashAfter,
    },
  }, "committed");
  assert.deepEqual(eventTypes(corrected), ["CorrectionBranchOpened", "BranchActivated"]);
  const branched = scenario.state();
  assert.match(branched.activeBranchId, /^branch:correction:/);
  assert.equal(branched.entities["pc-1"].tenureStatus, "active");
  assert.equal(branched.characterControls["pc-1"].seatId, "seat:auto:principal-1");
  assert.equal(branched.entities["pc-causal-successor"], undefined);
  assert.equal(branched.receipts["proposal:causal-successor"].status, "superseded");
  assert.equal(branched.receipts["root:causal-successor-acts"].status, "superseded");
  assert.ok(Object.values(branched.correctionRuntime.audit).some((entry) =>
    entry.rootActionId === "root:causal-successor-acts"));
});

test("SPEC 0001 F: a rumour cannot be recorded without its source, its time, or its motive", () => {
  const validSourceClaimPayload = {
    speakerId: "npc-warden",
    claimId: "claim:cellar-treasure",
    semanticContent: "守钥人听说地窖里只有旧王的宝藏",
    sourceBasis: "十年前商旅转述",
    motive: "阻止外人靠近",
    formedAtFictionMicros: "0",
  };
  assert.equal(
    validateCampaignEventPayload("SourceClaimCreated", validSourceClaimPayload),
    true,
    "the baseline payload must itself be valid before its negatives are meaningful",
  );

  // Source, time and motive are what make a rumour attributable, which is what
  // lets a player cross-examine one instead of having to believe it: a claim
  // may be false, but never anonymous.
  for (const omitted of ["sourceBasis", "formedAtFictionMicros", "motive"]) {
    const withoutOne = { ...validSourceClaimPayload };
    delete withoutOne[omitted];
    assert.equal(
      validateCampaignEventPayload("SourceClaimCreated", withoutOne),
      false,
      `a claim missing ${omitted} must not validate`,
    );
  }
});

test("SPEC 0001 F: sensory evidence citing a fact that was never frozen is refused", () => {
  const scenario = createScenario();
  const declared = scenario.run({
    kind: "declareCanonicalFact",
    proposalId: "proposal:freeze-scorch-marks",
    fact: {
      factId: "fact:scorch-marks",
      factKind: "hiddenReality",
      subjectRefs: ["zone:powder-cellar"],
      value: "地窖墙面留有新鲜焦痕",
      source: "dynamicMaterialization",
      causalParentIds: ["fact:chapter-one-goal"],
      visibilityPolicy: "hiddenUntilEvidence",
    },
  }, "committed");
  assert.ok(eventTypes(declared).includes("CanonicalFactDeclared"));
  const stateWithFrozenFact = scenario.state();

  const acquired = scenario.run({
    kind: "acquireSensoryEvidence",
    proposalId: "proposal:alice-smells-scorch",
    characterId: "pc-1",
    factId: "fact:scorch-marks",
    sense: "smell",
    clarity: "obvious",
    publicEvidence: "焦痕散发出刺鼻的火药味",
  }, "committed");
  const sensoryEvent = eventOf(acquired, "SensoryEvidenceAcquired");

  assert.equal(
    applyCampaignEvent(structuredClone(stateWithFrozenFact), sensoryEvent),
    true,
    "sensory evidence citing an already-frozen fact must apply cleanly",
  );

  const fabricatedEvent = {
    ...sensoryEvent,
    payload: { ...sensoryEvent.payload, factId: "fact:never-frozen" },
  };
  assert.throws(
    () => applyCampaignEvent(structuredClone(stateWithFrozenFact), fabricatedEvent),
    /fact unavailable/,
    "sensory evidence citing a fact that was never frozen must be refused -- the火药味 must have an already-frozen cause",
  );
});

function hazardMechanics(definitionId, body) {
  return {
    definitionId,
    revision: "1",
    definitionKind: "environmentHazardMechanics",
    rulesBasis: "srd5.1-2014",
    ...body,
  };
}

function spec8Hazard(overrides = {}) {
  return {
    definitionId: overrides.definitionId ?? "hazard:spec8:powder-blast",
    revision: "1",
    definitionKind: "environmentHazard",
    rulesBasis: "srd5.1-2014",
    visibilityPolicyRef: "visibility:hidden-until-evidence",
    causalBasisRefs: [],
    content: {
      schema: "zhuwei.environment-hazard-definition/v1",
      label: "火药地窖的爆燃",
      trigger: { kind: "enterZone", ref: "zone:powder-cellar" },
      perceptibleSigns: ["强烈火药味", "地面积尘中的火星"],
      disableMethods: ["隔绝火源", "浸湿火药"],
      environmentalConsequences: ["地窖顶部塌落，通道被封"],
      mechanicsRef: overrides.mechanicsRef ?? "ability:spec8:powder-blast",
      ...(overrides.content ?? {}),
    },
  };
}

function scenarioWithHazardMechanics(definitionId, body) {
  const scenario = createScenario();
  scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: `proposal:mechanics:${definitionId}`,
    definition: hazardMechanics(definitionId, body),
  }, "committed");
  return scenario;
}

test("SPEC 0001 8: a KP-created hazard must settle every one of its properties", () => {
  const scenario = scenarioWithHazardMechanics("ability:spec8:powder-blast", {
    effect: { kind: "fixedDamage", amount: 30, damageType: "fire" },
  });
  scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:spec8-hazard",
    definition: spec8Hazard(),
  }, "committed");

  // Section 8 requires the KP to determine 触发条件、可感知迹象、调查或解除方法、
  // 环境后果 and the mechanics the danger settles through before it is real.
  // Dropping any one leaves a hazard the KP did not finish deciding.
  for (const omitted of [
    "trigger",
    "perceptibleSigns",
    "disableMethods",
    "environmentalConsequences",
    "mechanicsRef",
  ]) {
    const incomplete = spec8Hazard({ definitionId: `hazard:spec8:missing-${omitted}` });
    delete incomplete.content[omitted];
    scenarioWithHazardMechanics("ability:spec8:powder-blast", {
      effect: { kind: "fixedDamage", amount: 30, damageType: "fire" },
    }).reject({
      kind: "registerDynamicDefinition",
      proposalId: `proposal:spec8-missing-${omitted}`,
      definition: incomplete,
    }, "invalidRulesInput");
  }

  // 可感知迹象 and 调查或解除方法 must be non-empty rather than merely present:
  // a danger nobody could notice and nobody could deal with is unfair by
  // construction, which section 10 does not license.
  for (const emptied of ["perceptibleSigns", "disableMethods"]) {
    scenarioWithHazardMechanics("ability:spec8:powder-blast", {
      effect: { kind: "fixedDamage", amount: 30, damageType: "fire" },
    }).reject({
      kind: "registerDynamicDefinition",
      proposalId: `proposal:spec8-empty-${emptied}`,
      definition: spec8Hazard({
        definitionId: `hazard:spec8:empty-${emptied}`,
        content: { [emptied]: [] },
      }),
    }, "invalidRulesInput");
  }

  // Section 10: a danger takes effect only once frozen, and a hazard's numbers
  // are frozen by the registration of the ability it settles through.
  createScenario().reject({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:spec8-unfrozen-mechanics",
    definition: spec8Hazard({
      definitionId: "hazard:spec8:unfrozen",
      mechanicsRef: "ability:spec8:never-registered",
    }),
  }, "privateOrUnknownReference");
});

test("SPEC 0001 8: a hazard's mechanics are the whole Ability vocabulary, not one template", () => {
  // The question this answers is whether the KP can author any danger the
  // rules can express, or only the one shape a bespoke schema happened to
  // allow. The mechanics below use a dexterity save with half on success, an
  // area target and rolled damage -- none of which the hazard contract itself
  // knows anything about, because it defers all five mechanical properties of
  // section 8 to the Ability compiler that already validates them.
  const scenario = scenarioWithHazardMechanics("ability:spec8:collapsing-gallery", {
    activation: { kind: "trigger", actionGrant: "none" },
    target: { kind: "area", area: { shape: "sphere", sizeFeet: 20 } },
    save: { ability: "dex", dc: 15, halfOnSuccess: true },
    damage: [{ type: "bludgeoning", formula: "8d6" }],
    effects: [{ tag: "buried", label: "被碎石压住", kind: "special" }],
  });
  scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:spec8-general-mechanics",
    definition: spec8Hazard({
      definitionId: "hazard:spec8:collapsing-gallery",
      mechanicsRef: "ability:spec8:collapsing-gallery",
      content: { label: "回廊塌落" },
    }),
  }, "committed");
  assert.equal(
    scenario.state().campaignRuntime.definitions["hazard:spec8:collapsing-gallery"]
      .content.mechanicsRef,
    "ability:spec8:collapsing-gallery",
  );
});

test("SPEC 0001 8: a hazard is never refused for being too dangerous", () => {
  // "高 AC、高 HP、高攻击或高伤害本身不能作为拒绝理由" -- the kernel reports
  // danger and never scales it down.
  const scenario = scenarioWithHazardMechanics("ability:spec8:deadly", {
    effect: { kind: "fixedDamage", amount: 999999, damageType: "force" },
  });
  scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:spec8-deadly",
    definition: spec8Hazard({
      definitionId: "hazard:spec8:deadly",
      mechanicsRef: "ability:spec8:deadly",
    }),
  }, "committed");
  assert.equal(
    scenario.state().campaignRuntime.definitions["hazard:spec8:deadly"].content.mechanicsRef,
    "ability:spec8:deadly",
  );
});

test("SPEC 0001 G: a frozen hazard's damage is applied at full amount even past the target's remaining HP", () => {
  const scenario = createScenario();
  scenario.run({
    kind: "registerDynamicDefinition",
    proposalId: "proposal:define-flash-fire-lethal",
    definition: {
      definitionId: "hazard:flash-fire-lethal",
      revision: "1",
      definitionKind: "environmentHazard",
      rulesBasis: "srd5.1-2014",
      trigger: { kind: "enterZone", zoneId: "zone:powder-cellar" },
      perceptibleSigns: ["强烈火药味", "地面积尘中的火星"],
      disableMethods: ["隔绝火源", "浸湿火药"],
      effect: { kind: "fixedDamage", amount: 30, damageType: "fire" },
    },
  }, "committed");
  assert.equal(scenario.state().entities["pc-1"].hitPoints.current, 7,
    "the fixture must start pc-1 with fewer HP than the frozen hazard's damage amount");

  const hazard = scenario.run({
    kind: "triggerHazard",
    proposalId: "proposal:trigger-flash-fire-lethal",
    definitionId: "hazard:flash-fire-lethal",
    triggeringEntityId: "pc-1",
    zoneId: "zone:powder-cellar",
    causeFactIds: ["fact:chapter-one-goal"],
  }, "committed");

  const damagePacket = eventOf(hazard, "DamagePacketResolved");
  assert.equal(
    damagePacket.payload.amount,
    30,
    "the frozen fixedDamage amount must be applied at full value -- 不降低伤害",
  );

  const hpChanged = eventOf(hazard, "HitPointsChanged");
  assert.equal(hpChanged.payload.before, 7);
  assert.equal(
    hpChanged.payload.after,
    0,
    "the kernel floors HP at 0 rather than going negative, so the undiminished quantity is the "
      + "damage amount above, not this HP delta",
  );

  assert.ok(
    eventTypes(hazard).includes("CreatureDied"),
    "damage sufficient to kill must be allowed to kill -- 足以致死时允许死亡",
  );
});
