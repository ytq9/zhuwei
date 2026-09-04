import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  WORLD_INTERACTION_PROFILE,
} from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import {
  eventHash,
  validateEventEnvelope,
} from "../app/_runtime/lib/rules/v2/events.ts";
import { stepVNextWorldInteraction } from "../app/_runtime/lib/rules/v2/world-interactions.ts";
import {
  materializedSemanticDefinitionRef,
  normalizedProspectiveRef,
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import {
  bundleCommandToRoomLowering,
  VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE,
} from "../app/_runtime/lib/kp/vnext/room-bridge.ts";

const ACTOR = "character:mf1";
const OBSERVER = "character:mf-observer";
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

function player(id, resources = {}) {
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
    resources: { ...resources },
    resourceMaximums: { ...resources },
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
    spawnPoints: [
      { x: "10", y: "10", elevation: "0" },
      { x: "30", y: "10", elevation: "0" },
    ],
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

function initialize(extraDefinitions = [], options = {}) {
  const withObserver = options.withObserver === true;
  const initialized = runtime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:mf",
    runtimeEpochId: "epoch:mf",
    moduleRef: { profileId: "module:mf", profileHash: `sha256:${"a".repeat(64)}` },
    initialDefinitionCatalogRef: { profileId: "catalog:mf", profileHash: `sha256:${"b".repeat(64)}` },
    activeBranchId: "branch:mf",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "MF", geometry: tacticalGeometry() }],
    principals: [
      { id: "principal:mf1", sessionVersion: 1, role: "host" },
      ...(withObserver
        ? [{ id: "principal:mf-observer", sessionVersion: 1, role: "player" }]
        : []),
    ],
    seats: [
      { id: "seat:mf1", principalId: "principal:mf1", status: "active" },
      ...(withObserver
        ? [{ id: "seat:mf-observer", principalId: "principal:mf-observer", status: "active" }]
        : []),
    ],
    characters: [
      player(ACTOR, options.actorResources ?? {}),
      ...(withObserver ? [player(OBSERVER)] : []),
    ],
    characterControls: [
      { characterId: ACTOR, seatId: "seat:mf1" },
      ...(withObserver
        ? [{ characterId: OBSERVER, seatId: "seat:mf-observer" }]
        : []),
    ],
    canonicalFacts: [],
    initialKnowledge: options.initialKnowledge ?? [],
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

test("hidden materialization becomes a Viewer Claim only after its evidence grant", () => {
  const visibilityFactId = "knowledge:hidden-alcove-seen";
  const projectForObserver = (initialKnowledge) => {
    const world = initialize([], { withObserver: true, initialKnowledge });
    const { rootActionId, plan } = materializationPlan(world.state, {
      rootActionId: "root:hidden-materialization-claims",
      semanticKind: "sceneFeature",
      visibilityPolicyRef: "visibility:hidden-until-evidence",
      content: {
        sceneRef: SCENE,
        visibilityFactId,
        label: "浅壁龛",
        description: "墙面上显露出一个浅壁龛。",
        observableState: "open",
        affordances: ["inspect"],
      },
    });
    const committed = runtime.step(world.profiles, world.state, {
      kind: "materializeSemanticDefinition",
      rootActionId,
      actorCharacterId: ACTOR,
      plan,
    });
    assert.equal(committed.kind, "committed", JSON.stringify(committed));
    const projected = runtime.project(committed.profiles ?? world.profiles, committed.state, {
      kind: "player",
      principalId: "principal:mf-observer",
      sessionVersion: 1,
      seatId: "seat:mf-observer",
      characterId: OBSERVER,
    }, {
      channel: "realtime",
      committedRange: {
        receiptId: committed.receipt.receiptId,
        actorCharacterId: ACTOR,
        priorState: world.state,
        events: committed.events,
      },
    });
    assert.equal(projected.kind, "projected", JSON.stringify(projected));
    assert.ok(projected.renderableClaims, "vNext projection must freeze even an empty Claim set");
    return projected.renderableClaims.claims;
  };

  assert.deepEqual(projectForObserver([]), []);
  const unlocked = projectForObserver([{
    characterId: OBSERVER,
    knowledgeRef: visibilityFactId,
    kind: "canonicalFact",
    layer: "full",
    content: "观察者已经发现墙上的浅壁龛。",
    visibility: "private",
    provenanceChain: [visibilityFactId],
  }]);
  assert.deepEqual(unlocked.map(({ kind }) => kind), [
    "definitionRevised",
    "sceneFeature",
  ]);
  assert.match(unlocked[1].description, /浅壁龛/u);
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

test("materializeSemanticDefinition rejects a visibility policy unknown to the spatial projector", () => {
  const world = initialize();
  const { rootActionId, plan } = materializationPlan(world.state, {
    rootActionId: "root:materialize-unknown-visibility",
    visibilityPolicyRef: "visibility:made-up-never-visible",
  });
  const result = runtime.step(world.profiles, world.state, {
    kind: "materializeSemanticDefinition",
    rootActionId,
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "privateOrUnknownReference");
  assert.equal(world.state.receipts[rootActionId], undefined);
  assert.equal(Object.keys(world.state.campaignRuntime.definitions).length, 0);
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

function atomicSceneFeatureInput(state, overrides = {}) {
  const rootActionId = overrides.rootActionId ?? "root:atomic-materialize-use";
  const bundleHash = overrides.bundleHash ?? canonicalSha256({ bundle: "atomic-materialize-use" });
  const contextHash = overrides.contextHash ?? canonicalSha256({ context: "atomic-materialize-use" });
  const handle = overrides.handle ?? "prospective:atomic-scene-feature";
  const existingReadSet = [ACTOR, SCENE].sort().map((ref) => {
    const revisionOrHash = authorityRevisionOrHash(state, ref);
    assert.notEqual(revisionOrHash, null, `missing authority binding for ${ref}`);
    return { ref, revisionOrHash };
  });
  const producerPlan = materializationPlan(state, {
    rootActionId,
    bundleHash,
    contextHash,
    handle,
    semanticKind: "sceneFeature",
    readSet: structuredClone(existingReadSet),
    content: {
      sceneRef: SCENE,
      label: "新出现的壁龛",
      description: "墙面上露出一个可检查的浅壁龛。",
      observableState: "open",
      affordances: ["inspect"],
    },
  }).plan;
  const interactionPlan = {
    schema: "zhuwei.world-interaction-resolution-plan/v1",
    resolutionId: "resolution:atomic-materialize-use",
    interactionRef: "interaction:atomic-materialize-use",
    actorCharacterId: ACTOR,
    sceneRef: SCENE,
    abilityRef: null,
    contextHash,
    readSet: structuredClone(existingReadSet),
    targetRefs: [handle],
    directTargetRefs: [handle],
    instrumentRefs: [],
    basisRefs: [handle],
    intent: "检查新出现的壁龛。",
    method: "靠近后查看。",
    ruling: { kind: "directSuccess" },
    costs: [],
    branches: {
      success: {
        outcomeCode: "outcome:atomic-inspected",
        summary: "角色检查了壁龛。",
        effects: [],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
      failure: {
        outcomeCode: "outcome:atomic-not-inspected",
        summary: "角色没有检查到壁龛。",
        effects: [],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
    },
  };
  return {
    kind: "applyAtomicWorldInteractionSteps",
    rootActionId,
    actorCharacterId: ACTOR,
    bundleHash,
    contextHash,
    sharedRuling: "directSuccess",
    steps: [{
      formId: "materialization.vnext-1",
      proposalRef: "proposal:atomic-producer",
      ruling: "directSuccess",
      rulesInput: {
        kind: "materializeSemanticDefinition",
        rootActionId,
        actorCharacterId: ACTOR,
        plan: producerPlan,
      },
      dependsOn: [],
      consumes: [],
      produces: [{
        handle,
        kind: "semanticDefinition",
        outcomeBinding: "always",
      }],
      outcomeBinding: "always",
    }, {
      formId: "world-interaction.vnext-1",
      proposalRef: "proposal:atomic-consumer",
      ruling: "directSuccess",
      rulesInput: {
        kind: "resolveWorldInteraction",
        rootActionId,
        actorCharacterId: ACTOR,
        plan: interactionPlan,
      },
      dependsOn: ["proposal:atomic-producer"],
      consumes: [{ kind: "prospective", handle }],
      produces: [],
      outcomeBinding: "always",
    }],
  };
}

function atomicCheckedBranchInput(state, overrides = {}) {
  const input = atomicSceneFeatureInput(state, {
    rootActionId: overrides.rootActionId ?? "root:atomic-checked-branches",
    bundleHash: overrides.bundleHash
      ?? canonicalSha256({ bundle: "atomic-checked-branches" }),
    contextHash: overrides.contextHash
      ?? canonicalSha256({ context: "atomic-checked-branches" }),
    handle: overrides.handle ?? "prospective:atomic-checked-target",
  });
  const { rootActionId, bundleHash, contextHash } = input;
  const existingReadSet = structuredClone(input.steps[0].rulesInput.plan.readSet);
  const successHandle = "prospective:atomic-success-feature";
  const failureHandle = "prospective:atomic-failure-feature";
  input.sharedRuling = "check";
  input.steps.forEach((step) => { step.ruling = "check"; });
  input.steps[1].rulesInput.plan.ruling = {
    kind: "check",
    resolutionKind: "abilityCheck",
    randomnessId: "randomness:atomic-shared-check",
    check: {
      kind: "ability",
      ability: "strength",
      skill: null,
      dc: "10",
      modifier: "0",
      mode: "normal",
      costs: [],
      goal: "检查刚出现的场景对象。",
      method: "直接检查。",
      risk: "可能没有找到有用的信息。",
      successOutcome: "检查成功。",
      failureOutcome: "检查失败。",
    },
  };
  const branchMaterialization = (handle, outcomeBinding, label) => {
    const plan = materializationPlan(state, {
      rootActionId,
      bundleHash,
      contextHash,
      handle,
      semanticKind: "sceneFeature",
      readSet: structuredClone(existingReadSet),
      content: {
        sceneRef: SCENE,
        label,
        description: `${label}只在对应共享检定结果中出现。`,
        observableState: "present",
        affordances: ["inspect"],
      },
      summary: `${label}已固化。`,
    }).plan;
    return {
      formId: "materialization.vnext-1",
      proposalRef: `proposal:${outcomeBinding}`,
      ruling: "check",
      rulesInput: {
        kind: "materializeSemanticDefinition",
        rootActionId,
        actorCharacterId: ACTOR,
        plan,
      },
      dependsOn: ["proposal:atomic-consumer"],
      consumes: [],
      produces: [{ handle, kind: "semanticDefinition", outcomeBinding }],
      outcomeBinding,
    };
  };
  input.steps.push(
    branchMaterialization(successHandle, "onSuccess", "成功痕迹"),
    branchMaterialization(failureHandle, "onFailure", "失败痕迹"),
  );
  return { input, successHandle, failureHandle };
}

test("applyAtomicWorldInteractionSteps materializes and consumes one prospective ref atomically", () => {
  const world = initialize();
  const input = atomicSceneFeatureInput(world.state);
  const committed = runtime.step(world.profiles, world.state, input);
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const prospectiveRef = normalizedProspectiveRef(
    input.rootActionId,
    input.bundleHash,
    input.steps[0].produces[0].handle,
  );
  const definitionRef = materializedSemanticDefinitionRef(
    input.rootActionId,
    input.bundleHash,
    prospectiveRef,
  );
  assert.ok(committed.state.campaignRuntime.definitions[definitionRef]);
  const resolved = committed.events.find((event) => event.eventType === "WorldInteractionResolved");
  assert.ok(resolved, JSON.stringify(committed.events));
  assert.deepEqual(resolved.payload.targetRefs, [definitionRef]);
  assert.deepEqual(resolved.payload.directTargetRefs, [definitionRef]);
  assert.ok(committed.events.every((event) => event.rootActionId === input.rootActionId));
  assert.equal(Object.keys(committed.state.receipts).filter((ref) => ref === input.rootActionId).length, 1);
  const settlement = committed.events.at(-1);
  assert.equal(settlement.eventType, "AtomicWorldInteractionStepsResolved");
  assert.deepEqual(settlement.payload.steps.map(({ proposalRef, status }) => ({ proposalRef, status })), [
    { proposalRef: "proposal:atomic-producer", status: "applied" },
    { proposalRef: "proposal:atomic-consumer", status: "applied" },
  ]);
  assert.equal(committed.scopeProof.reads.includes(definitionRef), false);
  assert.equal("proposalBundleSettlement" in committed.receipt, false);
  assert.equal("inputHash" in committed.receipt, false);
  assert.equal("subjectCharacterIds" in committed.receipt, false);
  assert.deepEqual(
    committed.state.receipts[input.rootActionId].proposalBundleSettlement.steps
      .map(({ proposalRef, status }) => ({ proposalRef, status })),
    settlement.payload.steps.map(({ proposalRef, status }) => ({ proposalRef, status })),
  );

  const replayed = runtime.replay(world.genesis, committed.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.head.stateHash, committed.stateHash);
  assert.deepEqual(replayed.state.campaignRuntime.definitions[definitionRef],
    committed.state.campaignRuntime.definitions[definitionRef]);
  assert.deepEqual(
    replayed.state.receipts[input.rootActionId].proposalBundleSettlement,
    committed.state.receipts[input.rootActionId].proposalBundleSettlement,
  );
});

test("atomic prospective substitution changes typed refs but leaves identical narrative text opaque", () => {
  const world = initialize();
  const input = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:atomic-typed-substitution",
  });
  const handle = input.steps[0].produces[0].handle;
  input.steps[0].rulesInput.plan.summary = handle;
  input.steps[1].rulesInput.plan.intent = handle;
  input.steps[1].rulesInput.plan.branches.success.summary = handle;
  const committed = runtime.step(world.profiles, world.state, input);
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const materialized = committed.events.find((event) =>
    event.eventType === "SemanticDefinitionMaterialized");
  const resolved = committed.events.find((event) => event.eventType === "WorldInteractionResolved");
  assert.equal(materialized.payload.summary, handle);
  assert.equal(resolved.payload.summary, handle);
  assert.notEqual(resolved.payload.targetRefs[0], handle);
});

test("atomic Bundle rejects a prospective handle in a server-bound template field", () => {
  const world = initialize();
  const input = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:atomic-template-handle",
  });
  input.steps[0].rulesInput.plan.templateRef = input.steps[0].produces[0].handle;
  const result = runtime.step(world.profiles, world.state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "invalidRulesInput");
  assert.equal(world.state.receipts[input.rootActionId], undefined);
  assert.equal(Object.keys(world.state.campaignRuntime.definitions).length, 0);
});

test("atomic Bundle rejects an unproduced typed handle before any transition", () => {
  const world = initialize();
  const input = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:atomic-unproduced",
  });
  const missing = "prospective:atomic-missing";
  input.steps[1].consumes = [{ kind: "prospective", handle: missing }];
  input.steps[1].rulesInput.plan.targetRefs = [missing];
  input.steps[1].rulesInput.plan.directTargetRefs = [missing];
  input.steps[1].rulesInput.plan.basisRefs = [missing];
  const result = runtime.step(world.profiles, world.state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "invalidRulesInput");
  assert.equal(world.state.receipts[input.rootActionId], undefined);
  assert.equal(Object.keys(world.state.campaignRuntime.definitions).length, 0);
});

test("atomic Bundle rejects a derived prospective authority ref in an initial read set", () => {
  const world = initialize();
  const input = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:atomic-derived-ref-read-set",
  });
  const handle = input.steps[0].produces[0].handle;
  const prospectiveRef = normalizedProspectiveRef(
    input.rootActionId,
    input.bundleHash,
    handle,
  );
  const definitionRef = materializedSemanticDefinitionRef(
    input.rootActionId,
    input.bundleHash,
    prospectiveRef,
  );
  input.steps[1].rulesInput.plan.readSet.push({
    ref: definitionRef,
    revisionOrHash: `sha256:${"9".repeat(64)}`,
  });
  const result = runtime.step(world.profiles, world.state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "invalidRulesInput");
  assert.equal(world.state.receipts[input.rootActionId], undefined);
  assert.equal(Object.keys(world.state.campaignRuntime.definitions).length, 0);
});

test("atomic shared check preflights every reachable branch before requesting randomness", () => {
  const world = initialize();
  const { input } = atomicCheckedBranchInput(world.state, {
    rootActionId: "root:atomic-invalid-failure-preflight",
  });
  input.steps[1].rulesInput.plan.branches.failure.pressures = [{
    description: "这个失败分支引用了不存在的权威来源。",
    sourceRef: "semantic:atomic-missing-source",
    visibilityPolicyRef: "visibility:scene-observers",
    basisRefs: [ACTOR],
  }];
  const result = runtime.step(world.profiles, world.state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "privateOrUnknownReference", JSON.stringify(result));
  assert.equal(world.state.receipts[input.rootActionId], undefined);
  assert.equal(Object.keys(world.state.internalContinuations).length, 0);
  assert.equal(Object.keys(world.state.campaignRuntime.definitions).length, 0);
});

test("atomic outcome-bound steps cannot precede their shared mechanical check", () => {
  const world = initialize();
  const { input } = atomicCheckedBranchInput(world.state, {
    rootActionId: "root:atomic-conditional-before-check",
  });
  const conditional = input.steps.splice(2, 1)[0];
  input.steps.splice(1, 0, conditional);
  const result = runtime.step(world.profiles, world.state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "invalidRulesInput");
  assert.equal(world.state.receipts[input.rootActionId], undefined);
  assert.equal(Object.keys(world.state.internalContinuations).length, 0);
});

test("one shared check settles success/failure bindings atomically and replays", () => {
  for (const [expectedBranch, roll] of [["success", 20], ["failure", 1]]) {
    const world = initialize();
    const { input, successHandle, failureHandle } = atomicCheckedBranchInput(world.state, {
      rootActionId: `root:atomic-shared-${expectedBranch}`,
      bundleHash: canonicalSha256({ bundle: `atomic-shared-${expectedBranch}` }),
      contextHash: canonicalSha256({ context: `atomic-shared-${expectedBranch}` }),
    });
    const pending = runtime.step(world.profiles, world.state, input);
    assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
    assert.deepEqual(pending.events.map(({ eventType }) => eventType), ["RandomnessRequested"]);
    assert.equal(Object.keys(pending.state.campaignRuntime.definitions).length, 0);

    const committed = runtime.step(world.profiles, pending.state, {
      kind: "fulfillAuthoritativeRandomness",
      continuation: pending.continuation,
      rolls: [roll],
    });
    assert.equal(committed.kind, "committed", JSON.stringify(committed));
    assert.equal(committed.mechanicalResult.branch, expectedBranch);
    const statusByProposal = Object.fromEntries(
      committed.mechanicalResult.steps.map(({ proposalRef, status }) => [proposalRef, status]),
    );
    assert.equal(statusByProposal["proposal:onSuccess"],
      expectedBranch === "success" ? "applied" : "skipped");
    assert.equal(statusByProposal["proposal:onFailure"],
      expectedBranch === "failure" ? "applied" : "skipped");

    const definitionRef = (handle) => materializedSemanticDefinitionRef(
      input.rootActionId,
      input.bundleHash,
      normalizedProspectiveRef(input.rootActionId, input.bundleHash, handle),
    );
    assert.equal(Boolean(committed.state.campaignRuntime.definitions[definitionRef(successHandle)]),
      expectedBranch === "success");
    assert.equal(Boolean(committed.state.campaignRuntime.definitions[definitionRef(failureHandle)]),
      expectedBranch === "failure");
    const settlement = committed.events.at(-1);
    assert.equal(settlement.eventType, "AtomicWorldInteractionStepsResolved");
    assert.equal(settlement.payload.branch, expectedBranch);
    assert.ok(committed.events.every(({ rootActionId }) => rootActionId === input.rootActionId));

    const replayed = runtime.replay(world.genesis, [...pending.events, ...committed.events]);
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    assert.equal(replayed.head.stateHash, committed.stateHash);
  }
});

test("atomic settlement replay rejects a ledger that contradicts its branch binding", () => {
  const world = initialize();
  const input = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:atomic-invalid-settlement-ledger",
  });
  const committed = runtime.step(world.profiles, world.state, input);
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const tamperedEvents = structuredClone(committed.events);
  const settlement = tamperedEvents.at(-1);
  assert.equal(settlement.eventType, "AtomicWorldInteractionStepsResolved");
  settlement.payload.steps[0].status = "skipped";
  settlement.payloadHash = canonicalSha256(settlement.payload);
  settlement.eventHash = eventHash(settlement);
  assert.deepEqual(validateEventEnvelope(settlement), {
    ok: false,
    message: "Event payload does not match its closed event type schema.",
  });
  const replayed = runtime.replay(world.genesis, tamperedEvents);
  assert.equal(replayed.kind, "rejected", JSON.stringify(replayed));
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

test("ruleWorldInteractionFeasibility spends the fiction time an attempt really burned", () => {
  // A refusal used to be free whatever it cost, because `item` was the only
  // attempt cost the wire and Rules had a word for. Ten minutes spent failing
  // to force a door is a real change to the world and now settles as one.
  const world = initialize();
  const plan = feasibilityPlan({
    costs: [{ kind: "fictionTime", durationMicros: "600000000" }],
  });
  const committed = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId: "root:feasibility-time-cost",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const advanced = committed.events.find((event) => event.eventType === "FictionTimeAdvanced");
  assert.ok(advanced, JSON.stringify(committed.events.map((event) => event.eventType)));
  assert.equal(advanced.payload.durationMicros, "600000000");
  assert.equal(committed.state.fictionTimelines[advanced.fictionTimelineId].nowMicros, "600000000");
  const ruled = committed.events.find((event) =>
    event.eventType === "WorldInteractionFeasibilityRuled");
  assert.deepEqual(ruled.payload.appliedCosts, [
    { kind: "fictionTimeCost", durationMicros: "600000000", nowMicrosAfter: "600000000" },
  ]);

  const rebuilt = runtime.replay(world.genesis, committed.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
  assert.equal(
    rebuilt.state.fictionTimelines[advanced.fictionTimelineId].nowMicros,
    "600000000",
  );
});

test("ruleWorldInteractionFeasibility spends a resource the attempt had already committed", () => {
  const world = initialize([], { actorResources: { "spellSlot:1": 1 } });
  const plan = feasibilityPlan({
    rulingKind: "worldLawViolation",
    costs: [{ kind: "resource", resourceId: "spellSlot:1", amount: 1 }],
  });
  const committed = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId: "root:feasibility-resource-cost",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const used = committed.events.find((event) => event.eventType === "ResourceUsed");
  assert.ok(used, JSON.stringify(committed.events.map((event) => event.eventType)));
  assert.equal(used.payload.resourceId, "spellSlot:1");
  assert.equal(used.payload.amount, 1);
  assert.equal(committed.state.entities[ACTOR].resources["spellSlot:1"], 0);
  const ruled = committed.events.find((event) =>
    event.eventType === "WorldInteractionFeasibilityRuled");
  assert.deepEqual(ruled.payload.appliedCosts, [
    { kind: "resourceCost", resourceId: "spellSlot:1", amountBefore: 1, amountAfter: 0 },
  ]);

  const rebuilt = runtime.replay(world.genesis, committed.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
  assert.equal(rebuilt.state.entities[ACTOR].resources["spellSlot:1"], 0);
});

test("ruleWorldInteractionFeasibility refuses a resource cost the actor cannot pay", () => {
  // The fold throws on an unaffordable spend, so this has to be caught while
  // ruling: an actor who cannot pay produces a rejection, never a crash.
  const world = initialize();
  const result = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId: "root:feasibility-resource-missing",
    actorCharacterId: ACTOR,
    plan: feasibilityPlan({
      costs: [{ kind: "resource", resourceId: "spellSlot:1", amount: 1 }],
    }),
  });
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.rejection.code, "insufficientResource");
});

test("mixed attempt costs settle in the order the ruling declared them", () => {
  // Item costs go through the one item transition a cost at a time precisely
  // so that a mixed list keeps its declared order in the event stream.
  const world = initialize([], { actorResources: { "spellSlot:1": 1 } });
  const committed = runtime.step(world.profiles, world.state, {
    kind: "ruleWorldInteractionFeasibility",
    rootActionId: "root:feasibility-mixed-costs",
    actorCharacterId: ACTOR,
    plan: feasibilityPlan({
      rulingKind: "worldLawViolation",
      costs: [
        { kind: "fictionTime", durationMicros: "60000000" },
        { kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 1, charges: 0, durability: 0 },
        { kind: "resource", resourceId: "spellSlot:1", amount: 1 },
      ],
    }),
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.deepEqual(
    committed.events.map((event) => event.eventType),
    [
      "FictionTimeAdvanced",
      "ItemUsed",
      "ResourceUsed",
      "WorldInteractionFeasibilityRuled",
    ],
  );
  const ruled = committed.events.at(-1);
  assert.deepEqual(
    ruled.payload.appliedCosts.map((cost) => cost.kind),
    ["fictionTimeCost", "itemCost", "resourceCost"],
  );

  const rebuilt = runtime.replay(world.genesis, committed.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
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

test("bundleCommandToRoomLowering carries every attempt cost kind Rules can spend", () => {
  const command = refusalCommand({
    attemptCosts: [
      { kind: "fictionTime", durationMicros: "600000000" },
      { kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 1, charges: 0, durability: 0 },
      { kind: "resource", resourceId: "spellSlot:1", amount: 1 },
    ],
  });
  const result = bundleCommandToRoomLowering(command);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.deepEqual(result.input.plan.costs, [
    { kind: "fictionTime", durationMicros: "600000000" },
    { kind: "item", entryRef: ITEM_ENTRY_REF, quantity: 1, charges: 0, durability: 0 },
    { kind: "resource", resourceId: "spellSlot:1", amount: 1 },
  ]);
});

test("bundleCommandToRoomLowering fails an in-world refusal closed when an attempt cost has no Rules transition", () => {
  // Every kind the domain models has a Rules transition today, so what this
  // still guards is the next one added: an unrecognised cost has to fail the
  // whole lowering, because a cost that is quietly dropped is one the fiction
  // charged the player and the world never took.
  const command = refusalCommand({
    attemptCosts: [{ kind: "standing", factionRef: "faction:mf", amount: 1 }],
  });
  const result = bundleCommandToRoomLowering(command);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.equal(result.code, "BUNDLE_LOWERING_UNSUPPORTED");
});

test("bundleCommandToRoomLowering emits one atomic Rules input and keeps highRisk closed", () => {
  const world = initialize();
  const expectedInput = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:bridge-atomic",
  });
  const atomic = bundleCommandToRoomLowering({
    kind: "atomicRulesSteps",
    rootActionId: expectedInput.rootActionId,
    actorCharacterId: expectedInput.actorCharacterId,
    bundleHash: expectedInput.bundleHash,
    contextHash: expectedInput.contextHash,
    sharedRuling: expectedInput.sharedRuling,
    steps: expectedInput.steps,
  });
  assert.equal(atomic.kind, "accepted", JSON.stringify(atomic));
  assert.deepEqual(atomic.input, expectedInput);
  const committed = runtime.step(world.profiles, world.state, atomic.input);
  assert.equal(committed.kind, "committed", JSON.stringify(committed));

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

function bridgeReadSetValidation(world, rulesInput) {
  const profiles = [
    world.profiles.manifest,
    world.profiles.ruleset,
    world.profiles.eventSchema,
    world.profiles.abilityCompiler,
    world.profiles.geometry,
    world.profiles.triggerOrdering,
    world.profiles.fictionCombatTime,
    ...world.profiles.extensions,
  ].map(({ profileId, profileHash }) => ({ profileRef: profileId, profileHash }));
  return VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE.validateReadSet({
    phase: "beforeFirstRulesStep",
    requiredContext: { binding: { profiles } },
    rulesInput,
    profiles: world.profiles,
    state: world.state,
    replayHead: { eventSeq: world.state.version, stateHash: canonicalSha256(world.state) },
  });
}

test("Room validates the union of atomic child read sets and rejects conflicting/prospective members", () => {
  const world = initialize();
  const valid = atomicSceneFeatureInput(world.state, {
    rootActionId: "root:bridge-read-set",
  });
  assert.deepEqual(bridgeReadSetValidation(world, valid), { kind: "valid" });

  const conflicting = structuredClone(valid);
  conflicting.steps[1].rulesInput.plan.readSet[0].revisionOrHash = "revision:conflict";
  assert.deepEqual(bridgeReadSetValidation(world, conflicting), {
    kind: "conflict",
    changedRefs: [],
  });

  const prospective = structuredClone(valid);
  prospective.steps[1].rulesInput.plan.readSet[0] = {
    ref: "prospective:not-an-initial-read",
    revisionOrHash: "revision:1",
  };
  assert.deepEqual(bridgeReadSetValidation(world, prospective), {
    kind: "conflict",
    changedRefs: [],
  });
});

test("Room treats a canonical player-choice opening as a zero-world-read Pending transition", () => {
  const world = initialize();
  const result = bridgeReadSetValidation(world, {
    kind: "resolveImprovisedAction",
    rootActionId: "root:bridge-choice",
    actorCharacterId: ACTOR,
    ruling: {
      kind: "playerChoice",
      pendingInputId: "pending:bridge-choice",
      question: "选择哪一种明确做法？",
      choices: [
        { choiceId: "a", label: "做法 A", consequence: "承担 A 的公开后果。" },
        { choiceId: "b", label: "做法 B", consequence: "承担 B 的公开后果。" },
      ],
    },
  });
  assert.deepEqual(result, { kind: "valid" });
});
