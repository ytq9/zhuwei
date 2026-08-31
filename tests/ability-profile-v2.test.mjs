import assert from "node:assert/strict";
import test from "node:test";

import {
  project,
  replay,
  step,
} from "../app/_runtime/lib/rules/index.ts";
import {
  compileAbilityDefinition,
  isDefinitionRegisteredAbilityPayload,
} from "../app/_runtime/lib/rules/profiles/ability-compiler.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { normalizeRoomKpProposal } from "../app/_runtime/lib/room/proposal-adapter.ts";

const ALICE = {
  principalId: "principal:ability-profile:alice",
  seatId: "seat:ability-profile:alice",
  characterId: "character:ability-profile:alice",
};
const EXPECTED_STORM_LANCE_DEFINITION_HASH =
  "sha256:0708b86d2910cc54752b12527e7fec92b4f70db7c4b03a52663c42bce289035d";

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function tacticalGeometry() {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "0", y: "0" },
        { x: "900", y: "0" },
        { x: "900", y: "600" },
        { x: "0", y: "600" },
      ],
    },
    spawnPoints: [
      { x: "120", y: "180", elevation: "0" },
      { x: "420", y: "180", elevation: "0" },
      { x: "720", y: "180", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:ability-profile:hall-wall",
      kind: "barrier",
      label: "能力校验厅隔墙",
      state: "intact",
      polygon: [
        { x: "300", y: "360" },
        { x: "360", y: "360" },
        { x: "360", y: "480" },
        { x: "300", y: "480" },
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

function initialize(suffix) {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: `room:ability-profile:${suffix}`,
    runtimeEpochId: `epoch:ability-profile:${suffix}`,
    moduleRef: profileRef(`module:ability-profile:${suffix}`, "a"),
    initialDefinitionCatalogRef: profileRef(`catalog:ability-profile:${suffix}`, "b"),
    activeBranchId: "branch:main",
    fictionInstantMicros: "0",
    scenes: [{
      id: "scene:ability-profile:hall",
      name: "能力校验厅",
      geometry: tacticalGeometry(),
    }],
    principals: [{ id: ALICE.principalId, sessionVersion: 1, role: "host" }],
    seats: [{
      id: ALICE.seatId,
      principalId: ALICE.principalId,
      status: "active",
    }],
    characters: [
      {
        id: ALICE.characterId,
        kind: "player",
        name: "阿莱莎",
        sceneId: "scene:ability-profile:hall",
        tenureStatus: "active",
        hitPoints: { current: 20, maximum: 20 },
        resources: { focus: 3 },
      },
      {
        id: "npc:ability-profile:one",
        kind: "npc",
        name: "一号靶",
        sceneId: "scene:ability-profile:hall",
        tenureStatus: "active",
        hitPoints: { current: 12, maximum: 12 },
      },
      {
        id: "npc:ability-profile:two",
        kind: "npc",
        name: "二号靶",
        sceneId: "scene:ability-profile:hall",
        tenureStatus: "active",
        hitPoints: { current: 12, maximum: 12 },
      },
    ],
    characterControls: [{ characterId: ALICE.characterId, seatId: ALICE.seatId }],
    canonicalFacts: [],
    initialKnowledge: [],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: replayed.state,
  };
}

function stormLance(aliases, tags) {
  return {
    definitionId: "ability:profile:storm-lance",
    revision: "1",
    definitionKind: "spell",
    rulesBasis: "srd5.1-2014",
    aliases,
    tags,
    activation: { kind: "action" },
    target: { kind: "creature", count: 1 },
    costs: [{ kind: "resource", resourceRef: "resource:storm-charge", amount: 1 }],
    damage: [{ kind: "damage", formula: "2d6", damageType: "lightning" }],
    publicDescription: "一道高压雷霆长矛。",
    visibilityPolicy: "public",
  };
}

function register(world, proposalId, definition) {
  return step(world.profiles, world.state, {
    kind: "registerDynamicDefinition",
    proposalId,
    definition,
  });
}

function playerView(world, state) {
  return project(world.profiles, state, {
    kind: "player",
    principalId: ALICE.principalId,
    seatId: ALICE.seatId,
    sessionVersion: 1,
    characterId: ALICE.characterId,
  });
}

test("A01 set-like tags and aliases produce one JCS definition and compiled hash", () => {
  const firstWorld = initialize("a01-first");
  const secondWorld = initialize("a01-second");
  const first = register(
    firstWorld,
    "root:ability-profile:a01:first",
    stormLance(["Storm Lance", "Lance of Storms"], ["spell", "lightning"]),
  );
  const second = register(
    secondWorld,
    "root:ability-profile:a01:second",
    stormLance(["Lance of Storms", "Storm Lance"], ["lightning", "spell"]),
  );

  assert.equal(first.kind, "committed", JSON.stringify(first));
  assert.equal(second.kind, "committed", JSON.stringify(second));
  const firstRegistration = first.events[0].payload;
  const secondRegistration = second.events[0].payload;
  assert.equal(firstRegistration.definitionHash, EXPECTED_STORM_LANCE_DEFINITION_HASH);
  assert.equal(secondRegistration.definitionHash, EXPECTED_STORM_LANCE_DEFINITION_HASH);
  assert.equal(firstRegistration.compiledHash, secondRegistration.compiledHash);
  assert.deepEqual(firstRegistration.definition.aliases, ["Lance of Storms", "Storm Lance"]);
  assert.deepEqual(firstRegistration.definition.tags, ["lightning", "spell"]);
  assert.deepEqual(firstRegistration.referenceClosure, ["resource:storm-charge"]);

  const replayed = replay(firstWorld.genesis, first.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  const view = playerView(firstWorld, replayed.state);
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.equal(
    view.abilityDefinitions["ability:profile:storm-lance"].definitionHash,
    EXPECTED_STORM_LANCE_DEFINITION_HASH,
  );
  assert.doesNotMatch(JSON.stringify(view), /mechanicGraph|entryOpIds|sourcePath|opId/);
});

test("A02 ordered resolution nodes remain order-sensitive", () => {
  const base = stormLance([], []);
  const costThenDamage = {
    ...base,
    definitionId: "ability:profile:ordered",
    resolution: [
      { nodeId: "cost", kind: "cost", resourceRef: "resource:storm-charge", amount: 1 },
      { nodeId: "damage", kind: "damage", formula: "2d6", damageType: "lightning" },
    ],
  };
  const damageThenCost = {
    ...base,
    definitionId: "ability:profile:ordered",
    resolution: [
      { nodeId: "damage", kind: "damage", formula: "2d6", damageType: "lightning" },
      { nodeId: "cost", kind: "cost", resourceRef: "resource:storm-charge", amount: 1 },
    ],
  };
  const firstWorld = initialize("a02-first");
  const secondWorld = initialize("a02-second");
  const first = register(firstWorld, "root:ability-profile:a02:first", costThenDamage);
  const second = register(secondWorld, "root:ability-profile:a02:second", damageThenCost);
  assert.equal(first.kind, "committed", JSON.stringify(first));
  assert.equal(second.kind, "committed", JSON.stringify(second));
  assert.notEqual(first.events[0].payload.compiledHash, second.events[0].payload.compiledHash);
});

test("A03 executable patches, scripts, callbacks, and event payloads fail atomically", () => {
  for (const [suffix, injected] of [
    ["set-path", { setPath: "/hitPoints/current" }],
    ["json-patch", { jsonPatch: [{ op: "replace", path: "/x", value: 1 }] }],
    ["script", { script: "return true" }],
    ["callback", { callback: "applyDamage" }],
    ["event", { eventPayload: { eventType: "DamagePacketResolved" } }],
  ]) {
    const world = initialize(`a03-${suffix}`);
    const result = register(world, `root:ability-profile:a03:${suffix}`, {
      ...stormLance([], []),
      definitionId: `ability:profile:a03:${suffix}`,
      effect: injected,
    });
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.rejection.code, "unsupportedMechanicPrimitive");
    assert.deepEqual(result.events, []);
  }
});

test("A04 cycles, unbound choices, and excessive branch complexity return diagnosable needsKp with no commit", () => {
  const cases = [
    ["cycle", {
      resolution: [
        { nodeId: "a", kind: "guard", next: ["b"] },
        { nodeId: "b", kind: "effect", next: ["a"] },
      ],
    }, "invalidAbilityDefinition"],
    ["unbound-choice", {
      resolution: [{ nodeId: "choice", kind: "choice", choices: [{ choiceId: "one" }] }],
    }, "invalidAbilityDefinition"],
    ["too-many-choices", {
      effect: { kind: "choice", choices: Array.from({ length: 33 }, (_, index) => ({ choiceId: `choice:${index}` })) },
    }, "definitionComplexityExceeded"],
  ];
  for (const [suffix, addition, expectedCode] of cases) {
    const world = initialize(`a04-${suffix}`);
    const result = register(world, `root:ability-profile:a04:${suffix}`, {
      ...stormLance([], []),
      definitionId: `ability:profile:a04:${suffix}`,
      ...addition,
    });
    assert.equal(result.kind, "needsKp", JSON.stringify(result));
    assert.equal(result.diagnostics[0].code, expectedCode);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].source, "SPEC 0013");
    assert.deepEqual(result.events, []);
  }
});

test("A05 high but bounded authored mechanics register without party scaling", () => {
  const world = initialize("a05");
  const result = register(world, "root:ability-profile:a05", {
    ...stormLance([], []),
    definitionId: "ability:profile:a05:cataclysm",
    damage: [{ kind: "damage", formula: "1000d1000", damageType: "force" }],
    save: { ability: "con", dc: 999, halfOnSuccess: false },
  });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.events[0].payload.definition.save.dc, 999);
  assert.equal(result.events[0].payload.definition.damage[0].formula, "1000d1000");

  const productWorld = initialize("a05-product-ruling");
  const product = register(productWorld, "root:ability-profile:a05:product-ruling", {
    ...stormLance([], []),
    definitionId: "ability:profile:a05:product-ruling",
    rulesBasis: {
      kind: "zhuwei-product-ruling",
      profileRef: profileRef("ruling:storm-lance-v1", "c"),
    },
  });
  assert.equal(product.kind, "committed", JSON.stringify(product));
});

test("A07 replay and later invocation consume the frozen graph/hash instead of current definition fields", () => {
  const world = initialize("a07");
  const frozenHazard = {
    definitionId: "hazard:ability-profile:a07:frozen",
    revision: "1",
    definitionKind: "environmentHazard",
    rulesBasis: "srd5.1-2014",
    trigger: { kind: "enterZone", zoneId: "zone:ability-profile:a07" },
    // This authored convenience field deliberately differs from the explicit
    // graph. The registered graph is the execution authority after commit.
    effect: { kind: "fixedDamage", amount: 19, damageType: "fire" },
    resolution: [{
      nodeId: "apply-frozen-damage",
      kind: "effect",
      effect: { kind: "fixedDamage", amount: 7, damageType: "fire" },
    }],
  };
  const registered = register(world, "root:ability-profile:a07", frozenHazard);
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  const frozen = structuredClone(registered.events[0].payload);
  const replayed = replay(world.genesis, registered.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  const stored = replayed.state.campaignRuntime.definitions[frozen.definition.definitionId];
  assert.equal(stored.definitionHash, frozen.definitionHash);
  assert.equal(stored.compiledHash, frozen.compiledHash);
  assert.deepEqual(stored.mechanicGraph, frozen.mechanicGraph);

  const newerCatalogEntry = step(world.profiles, replayed.state, {
    kind: "registerDynamicDefinition",
    proposalId: "root:ability-profile:a07:new-catalog-entry",
    definition: {
      ...frozenHazard,
      definitionId: "hazard:ability-profile:a07:new-current",
      revision: "2",
      effect: { kind: "fixedDamage", amount: 1, damageType: "cold" },
      resolution: [{
        nodeId: "apply-new-damage",
        kind: "effect",
        effect: { kind: "fixedDamage", amount: 1, damageType: "cold" },
      }],
    },
  });
  assert.equal(newerCatalogEntry.kind, "committed", JSON.stringify(newerCatalogEntry));
  const afterCatalogUpdate = replay(world.genesis, [
    ...registered.events,
    ...newerCatalogEntry.events,
  ]);
  assert.equal(afterCatalogUpdate.kind, "replayed", JSON.stringify(afterCatalogUpdate));

  const invoked = step(world.profiles, afterCatalogUpdate.state, {
    kind: "triggerHazard",
    proposalId: "root:ability-profile:a07:invoke-frozen",
    definitionId: frozenHazard.definitionId,
    triggeringEntityId: ALICE.characterId,
    zoneId: "zone:ability-profile:a07",
    causeFactIds: [],
  });
  assert.equal(invoked.kind, "committed", JSON.stringify(invoked));
  const damage = invoked.events.find(({ eventType }) => eventType === "DamagePacketResolved");
  assert.equal(damage.payload.amount, 7);
  assert.equal(damage.payload.damageType, "fire");
  const finalReplay = replay(world.genesis, [
    ...registered.events,
    ...newerCatalogEntry.events,
    ...invoked.events,
  ]);
  assert.equal(finalReplay.kind, "replayed", JSON.stringify(finalReplay));
  assert.equal(finalReplay.state.entities[ALICE.characterId].hitPoints.current, 13);
  assert.equal(
    finalReplay.state.campaignRuntime.definitions[frozenHazard.definitionId].compiledHash,
    frozen.compiledHash,
  );
});

test("A08 renamed Weapon Mastery and one-slot-per-turn semantics are rejected", () => {
  const cases = [
    ["mastery", { effect: { kind: "weapon", masteryProperty: "push" } }],
    ["spell-limit", { effect: { kind: "resource", resourceKind: "spellSlot", cadence: "perTurn", maximum: 1 } }],
  ];
  for (const [suffix, addition] of cases) {
    const world = initialize(`a08-${suffix}`);
    const result = register(world, `root:ability-profile:a08:${suffix}`, {
      ...stormLance([], []),
      definitionId: `ability:profile:a08:${suffix}`,
      ...addition,
    });
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.rejection.code, "unsupportedRulesBasis");
    assert.deepEqual(result.events, []);
  }
});

test("A09 caller-supplied MechanicOps fail at the Rules interface without private op disclosure", () => {
  const world = initialize("a09");
  const privateFields = [
    ["mechanic-ops", { mechanicOps: [{ family: "Damage", input: { amount: 999 } }] }],
    ["mechanic-graph", { mechanicGraph: { operations: [] } }],
    ["compiled-graph", { compiledGraph: { operations: [] } }],
    ["compiled-hash", { compiledHash: `sha256:${"9".repeat(64)}` }],
    ["compiler-profile", { compilerProfile: profileRef("ability-compiler:caller", "9") }],
    ["definition-hash", { definitionHash: `sha256:${"8".repeat(64)}` }],
    ["reference-closure", { referenceClosure: ["resource:caller-owned"] }],
    ["op-id", { opId: "op:caller-owned" }],
    ["source-path", { sourcePath: "/hitPoints/current" }],
  ];
  const embedded = register(world, "root:ability-profile:a09:embedded", {
    ...stormLance([], []),
    definitionId: "ability:profile:a09:embedded",
    mechanicOps: [{ family: "Damage", input: { amount: 999 } }],
  });
  assert.equal(embedded.kind, "rejected", JSON.stringify(embedded));
  assert.equal(embedded.rejection.code, "unsupportedMechanicPrimitive");
  assert.deepEqual(embedded.events, []);
  assert.doesNotMatch(embedded.rejection.message, /Damage|family|input|opId/);

  const sibling = step(world.profiles, world.state, {
    kind: "registerDynamicDefinition",
    proposalId: "root:ability-profile:a09:sibling",
    definition: stormLance([], []),
    mechanicOps: [],
  });
  assert.equal(sibling.kind, "rejected", JSON.stringify(sibling));
  assert.equal(sibling.rejection.code, "invalidRulesInput");
  assert.deepEqual(sibling.events, []);

  for (const [suffix, privateField] of privateFields) {
    const bypass = register(world, `root:ability-profile:a09:${suffix}`, {
      definitionId: `ability:profile:a09:${suffix}`,
      revision: "1",
      definitionKind: "spell",
      rulesBasis: "srd5.1-2014",
      ...privateField,
    });
    assert.equal(bypass.kind, "rejected", JSON.stringify(bypass));
    assert.equal(bypass.rejection.code, "unsupportedMechanicPrimitive");
    assert.deepEqual(bypass.events, []);
    assert.doesNotMatch(bypass.rejection.message, /Damage|family|input|opId|sourcePath/);
  }

  for (const [suffix, privateField] of privateFields) {
    const kpProposal = {
      kind: "directSuccess",
      goal: "固化一个危险",
      method: "让危险进入权威世界",
      publicBasisRefs: [],
      privateBasisRefs: [],
      risk: null,
      pendingInput: null,
      dynamicMaterializations: [{
        kind: "hazard",
        factRef: `fact:ability-profile:a09:kp:${suffix}`,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:public",
        definition: privateField,
      }],
      npcActions: [],
      mechanicalProposal: {
        operation: "resolveDirectConsequences",
        duration: { unit: "second", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
      scene: { question: "接下来怎么办？", pressure: "", opportunities: [], conclusionCandidate: null },
    };
    assert.equal(normalizeRoomKpProposal(kpProposal), undefined);
  }
});

test("A10 item costs require one exact item-entry authority in source and frozen Cost graphs", () => {
  const base = {
    definitionId: "ability:profile:a10:item-use",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "useObject", actionGrant: "normalAction" },
    healing: { formula: "2d4+2" },
  };
  for (const [suffix, cost] of [
    ["generic-item", { kind: "item", resourceId: "item:healing-potion", amount: "1" }],
    ["empty-entry", { kind: "item", resourceId: "item-entry:", amount: "1" }],
    ["item-charge", { kind: "itemCharge", resourceId: "resource:wand-charge", amount: "1" }],
  ]) {
    const compiled = compileAbilityDefinition({
      ...base,
      definitionId: `ability:profile:a10:${suffix}`,
      costs: [cost],
    });
    assert.equal(compiled.ok, false, JSON.stringify(compiled));
    assert.equal(compiled.code, "invalidAbilityDefinition");
  }

  const explicit = compileAbilityDefinition({
    ...base,
    definitionId: "ability:profile:a10:explicit-item-cost",
    resolution: [{
      nodeId: "legacy-item-cost",
      kind: "cost",
      costKind: "item",
      resourceId: "item:healing-potion",
      amount: "1",
    }],
  });
  assert.equal(explicit.ok, false, JSON.stringify(explicit));
  assert.equal(explicit.code, "invalidAbilityDefinition");

  const duplicate = compileAbilityDefinition({
    ...base,
    definitionId: "ability:profile:a10:duplicate-exact-item-cost",
    costs: [
      {
        kind: "item",
        resourceId: "item-entry:ability-profile:a10:potion",
        amount: "1",
      },
      {
        kind: "item",
        resourceId: "item-entry:ability-profile:a10:potion",
        amount: "1",
      },
    ],
  });
  assert.equal(duplicate.ok, false, JSON.stringify(duplicate));
  assert.equal(duplicate.code, "invalidAbilityDefinition");

  const exact = compileAbilityDefinition({
    ...base,
    costs: [{
      kind: "item",
      resourceId: "item-entry:ability-profile:a10:potion",
      amount: "1",
    }],
  });
  assert.equal(exact.ok, true, JSON.stringify(exact));
  assert.equal(isDefinitionRegisteredAbilityPayload(exact.artifact), true);

  const frozenLegacy = structuredClone(exact.artifact);
  frozenLegacy.definition.costs[0].resourceId = "item:healing-potion";
  const frozenCost = frozenLegacy.mechanicGraph.operations.find(({ family }) => family === "Cost");
  assert.ok(frozenCost);
  frozenCost.input.resourceId = "item:healing-potion";
  frozenLegacy.definitionHash = canonicalSha256(frozenLegacy.definition);
  const remappedIds = new Map(frozenLegacy.mechanicGraph.operations.map((operation) => [
    operation.opId,
    `op:${canonicalSha256({
      definitionHash: frozenLegacy.definitionHash,
      path: operation.sourcePath,
    }).slice("sha256:".length)}`,
  ]));
  frozenLegacy.mechanicGraph.entryOpIds = frozenLegacy.mechanicGraph.entryOpIds
    .map((opId) => remappedIds.get(opId));
  frozenLegacy.mechanicGraph.operations = frozenLegacy.mechanicGraph.operations.map((operation) => ({
    ...operation,
    opId: remappedIds.get(operation.opId),
    next: operation.next.map((opId) => remappedIds.get(opId)),
  }));
  frozenLegacy.referenceClosure = ["item:healing-potion"];
  frozenLegacy.compiledHash = canonicalSha256({
    compilerProfile: frozenLegacy.compilerProfile,
    definitionHash: frozenLegacy.definitionHash,
    mechanicGraph: frozenLegacy.mechanicGraph,
  });
  assert.equal(isDefinitionRegisteredAbilityPayload(frozenLegacy), false);
});

test("A11 unified item lifecycle compiles only to the Item MechanicOp family", () => {
  const compiled = compileAbilityDefinition({
    definitionId: "ability:profile:a11:item-lifecycle",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    resolution: [{
      nodeId: "damage-item",
      kind: "item",
      itemEntryId: "item-entry:ability-profile:a11:lantern",
      transition: "damage",
    }],
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.deepEqual(
    compiled.artifact.mechanicGraph.operations.map(({ family }) => family),
    ["Item"],
  );

  const retiredArtifact = compileAbilityDefinition({
    definitionId: "ability:profile:a11:retired-artifact",
    revision: "1",
    rulesBasis: "srd5.1-2014",
    resolution: [{
      nodeId: "retired-artifact",
      kind: "artifact",
      itemEntryId: "item-entry:ability-profile:a11:lantern",
      transition: "damage",
    }],
  });
  assert.equal(retiredArtifact.ok, false, JSON.stringify(retiredArtifact));
  assert.equal(retiredArtifact.code, "unsupportedMechanicPrimitive");
});
