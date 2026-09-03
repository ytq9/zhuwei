import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  WORLD_INTERACTION_PROFILE,
} from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { stepVNextWorldInteraction } from "../app/_runtime/lib/rules/v2/world-interactions.ts";
import {
  materializedSemanticDefinitionRef,
  normalizedProspectiveRef,
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { bundleCommandToRoomLowering } from "../app/_runtime/lib/kp/vnext/room-bridge.ts";

const ACTOR = "character:mf1";
const SCENE = "scene:mf2";
const ITEM_DEFINITION_REF = "item-definition:mf-torch";
const ITEM_ENTRY_REF = "item-entry:mf-torch-1";
const BASIS_CANARY = "fact:mf-authority-only-canary";

const runtime = createVersionedRulesRuntime({
  registrations: [{
    manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    interpreterKind: "authoritative-v2",
  }],
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});

function player(id) {
  return {
    id,
    kind: "player",
    name: "MF",
    sceneId: SCENE,
    tenureStatus: "active",
    classId: "fighter",
    raceId: "human",
    level: 1,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    proficientSkills: [],
    resources: {},
    resourceMaximums: {},
    hitPoints: { current: 20, maximum: 20 },
    loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
  };
}

function tacticalGeometry() {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: {
      kind: "polygon",
      points: [
        { x: "0", y: "0" },
        { x: "200", y: "0" },
        { x: "200", y: "200" },
        { x: "0", y: "200" },
      ],
    },
    spawnPoints: [{ x: "10", y: "10", elevation: "0" }],
    obstacles: [{
      featureId: "feature:mf-wall",
      kind: "barrier",
      label: "MF wall",
      state: "present",
      polygon: [
        { x: "150", y: "150" },
        { x: "160", y: "150" },
        { x: "160", y: "160" },
        { x: "150", y: "160" },
      ],
      elevation: "0",
      height: "10",
      opaque: false,
      impassable: false,
      cover: "none",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    }],
    clearanceZones: [],
  };
}

function itemDefinition() {
  return {
    schema: "zhuwei.item-definition/v1",
    definitionKind: "item",
    definitionId: ITEM_DEFINITION_REF,
    revision: "1",
    rulesBasis: { kind: "zhuwei-product-ruling", profileRef: WORLD_INTERACTION_PROFILE },
    causalBasisRefs: [],
    visibilityPolicyRef: "visibility:scene-observers",
    content: {
      schema: "zhuwei.item-definition-content/v1",
      label: "测试消耗品",
      description: "用于测试世界互动消耗的普通物品。",
      category: "tool",
      aliases: [],
      tags: ["stage3", "testing"],
      stackable: true,
      equipment: null,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  };
}

function initialize(extraDefinitions = []) {
  const initialized = runtime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:mf",
    runtimeEpochId: "epoch:mf",
    moduleRef: { profileId: "module:mf", profileHash: `sha256:${"a".repeat(64)}` },
    initialDefinitionCatalogRef: { profileId: "catalog:mf", profileHash: `sha256:${"b".repeat(64)}` },
    activeBranchId: "branch:mf",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "MF", geometry: tacticalGeometry() }],
    principals: [{ id: "principal:mf1", sessionVersion: 1, role: "host" }],
    seats: [{ id: "seat:mf1", principalId: "principal:mf1", status: "active" }],
    characters: [player(ACTOR)],
    characterControls: [{ characterId: ACTOR, seatId: "seat:mf1" }],
    canonicalFacts: [],
    initialKnowledge: [],
    vNextSeed: {
      semanticDefinitions: extraDefinitions,
      itemDefinitions: [itemDefinition()],
      itemEntries: [{
        definitionRef: ITEM_DEFINITION_REF,
        entry: {
          entryId: ITEM_ENTRY_REF,
          quantity: 3,
          placement: { kind: "held", holderRef: ACTOR, equippedSlot: null },
          ownership: { kind: "character", ownerRef: ACTOR },
          visibilityPolicyRef: "visibility:scene-observers",
        },
      }],
      entityDefinitionBindings: [],
    },
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = runtime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { genesis: initialized.genesis, profiles: initialized.profiles, state: replayed.state };
}

function actorReadSet(state) {
  const revisionOrHash = authorityRevisionOrHash(state, ACTOR);
  assert.notEqual(revisionOrHash, null);
  return [{ ref: ACTOR, revisionOrHash }];
}

function materializationPlan(state, overrides = {}) {
  const rootActionId = overrides.rootActionId ?? "root:materialize";
  const bundleHash = overrides.bundleHash ?? canonicalSha256({ bundle: "mf-bundle" });
  const handle = overrides.handle ?? "prospective:mf-handle";
  const readSet = overrides.readSet ?? actorReadSet(state);
  // The frozen RequiredContext binding hash, as Proposal lowering supplies it.
  const contextHash = overrides.contextHash ?? `sha256:${"c".repeat(64)}`;
  return {
    rootActionId,
    plan: {
      schema: "zhuwei.semantic-definition-materialization-plan/vnext-1",
      bundleHash,
      handle,
      semanticKind: overrides.semanticKind ?? "worldFact",
      templateRef: overrides.templateRef ?? "template:mf-worldfact",
      templateHash: overrides.templateHash ?? canonicalSha256({ template: "mf-worldfact" }),
      visibilityPolicyRef: overrides.visibilityPolicyRef ?? "visibility:scene-observers",
      contextHash,
      readSet,
      basisRefs: overrides.basisRefs ?? [],
      sourceRefs: overrides.sourceRefs ?? [],
      content: overrides.content ?? { description: "桌上的一张便条。" },
      summary: overrides.summary ?? "为测试而创建的世界事实。",
    },
  };
}

test("materializeSemanticDefinition is rejected when the world-interaction profile is disabled", () => {
  const result = stepVNextWorldInteraction({ extensions: [] }, {}, {
    kind: "materializeSemanticDefinition",
    rootActionId: "root:disabled",
    actorCharacterId: ACTOR,
    plan: {},
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "unsupportedOperation");
});

test("ruleWorldInteractionFeasibility is rejected when the world-interaction profile is disabled", () => {
  const result = stepVNextWorldInteraction({ extensions: [] }, {}, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId: "root:disabled-2",
    actorCharacterId: ACTOR,
    plan: {},
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "unsupportedOperation");
});

test("materializeSemanticDefinition commits a new sparse definition and replays identically", () => {
  const world = initialize();
  const { rootActionId, plan } = materializationPlan(world.state);
  const committed = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.events.length, 1);
  assert.equal(committed.events[0].eventType, "SemanticDefinitionMaterialized");

  const expectedProspectiveRef = normalizedProspectiveRef(rootActionId, plan.bundleHash, plan.handle);
  const expectedDefinitionRef =
    materializedSemanticDefinitionRef(rootActionId, plan.bundleHash, expectedProspectiveRef);
  assert.equal(committed.mechanicalResult.definitionRef, expectedDefinitionRef);
  assert.equal(committed.mechanicalResult.prospectiveRef, expectedProspectiveRef);

  const stored = committed.state.campaignRuntime.definitions[expectedDefinitionRef];
  assert.ok(stored, "materialized definition must be stored under its derived ref");
  assert.equal(stored.revision, "1");
  assert.equal(stored.semanticKind, "worldFact");
  assert.deepEqual(stored.content, plan.content);

  const rebuilt = runtime.replay(world.genesis, committed.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
  assert.deepEqual(
    rebuilt.state.campaignRuntime.definitions[expectedDefinitionRef],
    stored,
  );
});

test("materializeSemanticDefinition rejects a stale read set", () => {
  const world = initialize();
  const { rootActionId, plan } = materializationPlan(world.state, {
    readSet: [{ ref: ACTOR, revisionOrHash: `sha256:${"9".repeat(64)}` }],
  });
  const result = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "causalFrontierConflict");
});

test("materializeSemanticDefinition records the authorising context hash verbatim", () => {
  // Rules holds no RequiredContext and so cannot re-derive this hash. It is
  // verified against the frozen context at Proposal lowering time; Rules
  // carries it into the committed event so the audit trail records which
  // adjudication context authorised the creation. Recomputing it from the
  // plan's own fields would be self-satisfying, and would reject the KP-side
  // lowering, which supplies the binding hash like the revision path does.
  const world = initialize();
  const authorisingHash = `sha256:${"7".repeat(64)}`;
  const { rootActionId, plan } = materializationPlan(world.state, {
    contextHash: authorisingHash,
  });
  const committed = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.events[0].payload.contextHash, authorisingHash);
});

test("materializeSemanticDefinition refuses to create over an existing definition ref", () => {
  const rootActionId = "root:materialize-conflict";
  const bundleHash = canonicalSha256({ bundle: "mf-conflict" });
  const handle = "prospective:mf-conflict";
  const prospectiveRef = normalizedProspectiveRef(rootActionId, bundleHash, handle);
  const collidingRef = materializedSemanticDefinitionRef(rootActionId, bundleHash, prospectiveRef);
  const snapshot = createDefinitionSnapshot(collidingRef, "1", { description: "已经存在的定义。" });
  const colliding = storedSemanticDefinition(
    "worldFact",
    "visibility:scene-observers",
    snapshot,
    { templateRef: collidingRef, templateHash: snapshot.definitionHash },
  );
  const world = initialize([colliding]);
  const { plan } = materializationPlan(world.state, { rootActionId, bundleHash, handle });
  const result = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "causalFrontierConflict");
  assert.match(result.rejection.message, /DEFINITION_CONFLICT/u);
});

test("materializeSemanticDefinition rejects a duplicate RootAction", () => {
  const world = initialize();
  const { rootActionId, plan } = materializationPlan(world.state);
  const committed = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const secondPlan = materializationPlan(committed.state, {
    rootActionId,
    handle: "prospective:mf-handle-2",
  }).plan;
  const replay = runtime.step(committed.profiles ?? world.profiles, committed.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan: secondPlan,
  });
  assert.equal(replay.kind, "rejected", JSON.stringify(replay));
  assert.equal(replay.rejection.code, "duplicateRootAction");
});

test("materializeSemanticDefinition still refuses a sparse definition carrying a mechanical field", () => {
  const world = initialize();
  const { rootActionId, plan } = materializationPlan(world.state, {
    content: { description: "note", hp: 5 },
  });
  const result = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "invalidRulesInput");
});

function feasibilityPlan(overrides = {}) {
  return {
    schema: "zhuwei.world-interaction-feasibility-ruling-plan/v1",
    actorCharacterId: ACTOR,
    intent: overrides.intent ?? "尝试打开一扇上锁的门。",
    method: overrides.method ?? "徒手推门。",
    rulingKind: overrides.rulingKind ?? "missingPrerequisite",
    publicBasis: overrides.publicBasis ?? "这扇门被锁住了，需要钥匙。",
    prerequisites: overrides.prerequisites ?? [
      { kind: "tool", ref: null, description: "需要一把钥匙。" },
    ],
    nextActions: overrides.nextActions ?? [{ description: "去别处寻找钥匙。" }],
    costs: overrides.costs ?? [],
    basisRefs: overrides.basisRefs ?? [],
  };
}

test("ruleWorldInteractionFeasibility commits a refusal with no cost and replays identically", () => {
  const world = initialize();
  const rootActionId = "root:feasibility-basic";
  const plan = feasibilityPlan({ basisRefs: [BASIS_CANARY] });
  const committed = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.events.length, 1);
  const event = committed.events[0];
  assert.equal(event.eventType, "WorldInteractionFeasibilityRuled");
  assert.equal(event.payload.rulingKind, "missingPrerequisite");
  assert.equal(event.payload.publicBasis, plan.publicBasis);
  assert.deepEqual(event.payload.nextActions, [{ description: "去别处寻找钥匙。" }]);
  assert.deepEqual(event.payload.appliedCosts, []);

  // Confidentiality invariant: an authority-only basis ref must never appear
  // anywhere in the committed, player-facing event stream.
  assert.equal(Object.hasOwn(event.payload, "basisRefs"), false);
  assert.equal(JSON.stringify(committed.events).includes(BASIS_CANARY), false);

  const rebuilt = runtime.replay(world.genesis, committed.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
});

test("ruleWorldInteractionFeasibility applies a real attempt cost through the item-cost transition path", () => {
  const world = initialize();
  const rootActionId = "root:feasibility-cost";
  const plan = feasibilityPlan({
    rulingKind: "worldLawViolation",
    costs: [{ kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 1, charges: 0, durability: 0 }],
  });
  const committed = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(
    committed.events.some((event) => event.eventType === "ItemUsed" && event.payload.entryId === ITEM_ENTRY_REF),
    true,
    JSON.stringify(committed.events),
  );
  assert.equal(committed.state.campaignRuntime.itemSystem.entries[ITEM_ENTRY_REF].quantity, 2);
  const ruled = committed.events.find((event) => event.eventType === "WorldInteractionFeasibilityRuled");
  assert.deepEqual(
    ruled.payload.appliedCosts.map(({ entryRef, quantityAfter }) => ({ entryRef, quantityAfter })),
    [{ entryRef: ITEM_ENTRY_REF, quantityAfter: 2 }],
  );

  const rebuilt = runtime.replay(world.genesis, committed.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
  assert.equal(rebuilt.state.campaignRuntime.itemSystem.entries[ITEM_ENTRY_REF].quantity, 2);
});

test("ruleWorldInteractionFeasibility rejects an attempt cost that is not actually available", () => {
  const world = initialize();
  const plan = feasibilityPlan({
    costs: [{ kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 99, charges: 0, durability: 0 }],
  });
  const result = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId: "root:feasibility-insufficient",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "insufficientResource");
});

test("ruleWorldInteractionFeasibility rejects a duplicate RootAction", () => {
  const world = initialize();
  const rootActionId = "root:feasibility-duplicate";
  const plan = feasibilityPlan();
  const committed = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const again = runtime.step(world.profiles, committed.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(again.kind, "rejected", JSON.stringify(again));
  assert.equal(again.rejection.code, "duplicateRootAction");
});

function refusalCommand(overrides = {}) {
  return {
    kind: "inWorldRefusal",
    rootActionId: "root:bridge-refusal",
    actorCharacterId: ACTOR,
    proposalRef: "proposal:bridge-refusal",
    formId: "in-world-refusal.vnext-1",
    intent: "尝试打开一扇上锁的门。",
    method: "徒手推门。",
    basisRefs: overrides.basisRefs ?? [BASIS_CANARY],
    ruling: {
      kind: overrides.rulingKind ?? "missingPrerequisite",
      publicBasis: overrides.publicBasis ?? "这扇门被锁住了，需要钥匙。",
      prerequisites: overrides.prerequisites ?? [
        { kind: "tool", ref: null, description: "需要一把钥匙。" },
      ],
      nextActions: overrides.nextActions ?? [
        { description: "去别处寻找钥匙。", basisRefs: [BASIS_CANARY] },
      ],
      attemptCosts: overrides.attemptCosts ?? [],
    },
  };
}

test("bundleCommandToRoomLowering lowers an in-world refusal into the typed feasibility Rules input", () => {
  const result = bundleCommandToRoomLowering(refusalCommand());
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(result.input.kind, "ruleWorldInteractionFeasibility");
  assert.equal(result.input.rootActionId, "root:bridge-refusal");
  assert.equal(result.input.actorCharacterId, ACTOR);
  assert.equal(result.input.plan.rulingKind, "missingPrerequisite");
  assert.deepEqual(result.input.plan.nextActions, [{ description: "去别处寻找钥匙。" }]);
  // The nested nextAction basisRefs and the command's own basisRefs are both
  // folded into the plan's authority-only basisRefs, deduplicated and sorted.
  assert.deepEqual(result.input.plan.basisRefs, [BASIS_CANARY]);
  // No player-visible nextAction entry may carry a basisRefs field.
  assert.ok(result.input.plan.nextActions.every((entry) => !("basisRefs" in entry)));
});

test("bundleCommandToRoomLowering lowers an item attempt cost from an in-world refusal", () => {
  const command = refusalCommand({
    attemptCosts: [{ kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 1, charges: 0, durability: 0 }],
  });
  const result = bundleCommandToRoomLowering(command);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.deepEqual(result.input.plan.costs, [
    { kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 1, charges: 0, durability: 0 },
  ]);
});

test("bundleCommandToRoomLowering fails an in-world refusal closed when an attempt cost has no Rules transition", () => {
  const command = refusalCommand({
    attemptCosts: [{ kind: "resource", resourceId: "resource:mf-unsupported", amount: 1 }],
  });
  const result = bundleCommandToRoomLowering(command);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "BUNDLE_LOWERING_UNSUPPORTED");
});

test("bundleCommandToRoomLowering still fails atomicRulesSteps and highRiskConfirmed closed", () => {
  const atomic = bundleCommandToRoomLowering({
    kind: "atomicRulesSteps",
    rootActionId: "root:bridge-atomic",
    actorCharacterId: ACTOR,
    steps: [],
  });
  assert.equal(atomic.kind, "rejected", JSON.stringify(atomic));
  assert.equal(atomic.code, "BUNDLE_LOWERING_UNSUPPORTED");

  const highRisk = bundleCommandToRoomLowering({
    kind: "highRiskConfirmed",
    rootActionId: "root:bridge-high-risk",
    actorCharacterId: ACTOR,
    proposalRef: "proposal:bridge-high-risk",
    formId: "in-world-refusal.vnext-1",
    ruling: {
      kind: "highRisk",
      risk: "风险描述。",
      confirmationQuestion: "确认吗？",
      successOutcome: "成功结果。",
      failureOutcome: "失败结果。",
      check: null,
      acceptedCosts: [],
    },
    basisRefs: [],
    confirmationId: "confirmation:bridge-high-risk",
  });
  assert.equal(highRisk.kind, "rejected", JSON.stringify(highRisk));
  assert.equal(highRisk.code, "BUNDLE_LOWERING_UNSUPPORTED");
});
