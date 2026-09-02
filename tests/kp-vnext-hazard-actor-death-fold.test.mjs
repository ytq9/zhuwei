import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
} from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import {
  authorityRevisionOrHash,
} from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import {
  createEventTransition,
  createScopeProof,
} from "../app/_runtime/lib/rules/v2/events.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const ACTOR = "character:fold-actor";
const VIEWER = "character:fold-viewer";
const SCENE = "scene:fold-scene";
const SOURCE = "semantic:fold-source";
const ZONE = "semantic:fold-zone";
const ACTOR_RELATION = "relation:fold-actor-in-zone";

const runtime = createVersionedRulesRuntime({
  registrations: [{
    manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    interpreterKind: "authoritative-v2",
  }],
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});

function profileRef(profileId, digit) {
  return { profileId, profileHash: `sha256:${digit.repeat(64)}` };
}

function semanticDefinition(semanticKind, definitionRef, content) {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition(
    semanticKind,
    "visibility:scene-observers",
    snapshot,
    { templateRef: definitionRef, templateHash: snapshot.definitionHash },
  );
}

function actor() {
  return {
    id: ACTOR,
    kind: "player",
    name: "Fold Actor",
    sceneId: SCENE,
    tenureStatus: "active",
    classId: "fighter",
    raceId: "human",
    level: 1,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
    proficiencyBonus: 2,
    proficientSkills: ["perception"],
    resources: {},
    resourceMaximums: {},
    hitPoints: { current: 6, maximum: 6 },
    loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: {
      classId: "fighter",
      raceId: "human",
      cantrips: [],
      prepared: [],
    },
  };
}

function viewer() {
  return {
    ...actor(),
    id: VIEWER,
    name: "Fold Viewer",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficientSkills: [],
    hitPoints: { current: 20, maximum: 20 },
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
        { x: "600", y: "0" },
        { x: "600", y: "600" },
        { x: "0", y: "600" },
      ],
    },
    spawnPoints: [
      { x: "100", y: "100", elevation: "0" },
      { x: "200", y: "100", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:fold-boundary-marker",
      kind: "barrier",
      label: "Boundary marker",
      state: "present",
      polygon: [
        { x: "400", y: "400" },
        { x: "450", y: "400" },
        { x: "450", y: "450" },
        { x: "400", y: "450" },
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

function initialize() {
  const source = semanticDefinition("sceneFeature", SOURCE, {
    sceneRef: SCENE,
    label: "Hazard source",
    description: "A registered scene feature can release a hazard into its bound zone.",
    observableState: "ready",
    affordances: ["interact"],
  });
  const zone = semanticDefinition("sceneFeature", ZONE, {
    sceneRef: SCENE,
    label: "Hazard zone",
    description: "The zone affected by the registered scene hazard.",
    observableState: "occupied",
    affordances: ["leave"],
  });
  const relation = semanticDefinition("worldRelation", ACTOR_RELATION, {
    relationRef: ACTOR_RELATION,
    kind: "contains",
    subjectRef: ZONE,
    objectRef: ACTOR,
    state: "active",
  });
  const initialized = runtime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:fold",
    runtimeEpochId: "epoch:fold",
    moduleRef: profileRef("module:fold", "a"),
    initialDefinitionCatalogRef: profileRef("catalog:fold", "b"),
    activeBranchId: "branch:fold",
    fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "Fold Scene", geometry: tacticalGeometry() }],
    principals: [
      { id: "principal:fold", sessionVersion: 1, role: "host" },
      { id: "principal:fold-viewer", sessionVersion: 1, role: "player" },
    ],
    seats: [
      { id: "seat:fold", principalId: "principal:fold", status: "active" },
      { id: "seat:fold-viewer", principalId: "principal:fold-viewer", status: "active" },
    ],
    characters: [actor(), viewer()],
    characterControls: [
      { characterId: ACTOR, seatId: "seat:fold" },
      { characterId: VIEWER, seatId: "seat:fold-viewer" },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
    vNextSeed: {
      semanticDefinitions: [source, zone, relation],
      itemDefinitions: [],
      itemEntries: [],
      entityDefinitionBindings: [],
    },
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = runtime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: replayed.state,
  };
}

function interactionPlan(state) {
  const readSet = [ACTOR, SCENE, SOURCE, ZONE, ACTOR_RELATION]
    .sort()
    .map((ref) => {
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      assert.notEqual(revisionOrHash, null, `missing authority binding for ${ref}`);
      return { ref, revisionOrHash };
    });
  return {
    schema: "zhuwei.world-interaction-resolution-plan/v1",
    resolutionId: "resolution:fold",
    interactionRef: "interaction:fold",
    actorCharacterId: ACTOR,
    sceneRef: SCENE,
    abilityRef: null,
    contextHash: canonicalSha256({ context: "fold" }),
    readSet,
    targetRefs: [SOURCE],
    directTargetRefs: [SOURCE],
    instrumentRefs: [],
    basisRefs: [SOURCE],
    intent: "Interact with the scene feature.",
    method: "Use an available method established by the frozen ruling.",
    ruling: {
      kind: "check",
      resolutionKind: "abilityCheck",
      randomnessId: "randomness:fold",
      check: {
        kind: "skill",
        ability: "wisdom",
        skill: "perception",
        dc: "10",
        modifier: "5",
        mode: "normal",
        costs: [],
        goal: "Resolve the interaction.",
        method: "Apply the frozen interaction method.",
        risk: "The registered hazard affects occupants of its zone.",
        successOutcome: "The success branch resolves.",
        failureOutcome: "The failure branch resolves without effects.",
      },
    },
    costs: [],
    branches: {
      success: {
        outcomeCode: "outcome:fold-success",
        summary: "The interaction succeeds and releases the registered hazard.",
        effects: [{
          kind: "registeredHazard",
          sourceDefinitionRef: SOURCE,
          zoneRef: ZONE,
          damageProfileRef: "world-damage:falling-object:moderate",
        }],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
      failure: {
        outcomeCode: "outcome:fold-failure",
        summary: "The interaction fails without releasing the hazard.",
        effects: [],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
    },
  };
}

test("an interaction can kill its actor before its summary event is folded and replayed", () => {
  const world = initialize();
  const plan = interactionPlan(world.state);
  const pending = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:fold",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));

  const committed = runtime.step(world.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pending.continuation,
    rolls: [20],
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.state.entities[ACTOR].hitPoints.current, 0);
  assert.equal(committed.state.entities[ACTOR].tenureStatus, "dead");
  assert.deepEqual(
    committed.mechanicalResult.appliedEffects
      .filter(({ kind }) => kind === "damage")
      .map(({ targetRef, hpBefore, hpAfter, died }) => ({ targetRef, hpBefore, hpAfter, died })),
    [{ targetRef: ACTOR, hpBefore: 6, hpAfter: 0, died: true }],
  );

  const laterAction = runtime.step(world.profiles, committed.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:fold-after-death",
    actorCharacterId: ACTOR,
    plan: interactionPlan(committed.state),
  });
  assert.equal(laterAction.kind, "rejected", JSON.stringify(laterAction));

  const events = [...pending.events, ...committed.events];
  const replayed = runtime.replay(world.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(replayed.head.stateHash, committed.stateHash);
  assert.equal(replayed.state.entities[ACTOR].hitPoints.current, 0);
  assert.equal(replayed.state.entities[ACTOR].tenureStatus, "dead");

  const projected = runtime.project(world.profiles, committed.state, {
    kind: "player",
    principalId: "principal:fold-viewer",
    sessionVersion: 1,
    seatId: "seat:fold-viewer",
    characterId: VIEWER,
  }, {
    channel: "realtime",
    committedRange: {
      receiptId: committed.receipt.receiptId,
      actorCharacterId: ACTOR,
      priorState: world.state,
      events,
    },
  });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  const actorDamageClaim = projected.renderableClaims?.claims.find((claim) =>
    claim.kind === "mechanicalOutcome"
    && claim.outcomeCode === "died"
    && claim.targetRefs?.includes(ACTOR));
  assert.ok(actorDamageClaim, JSON.stringify(projected));
});

test("a dead actor cannot authorize a forged world-interaction damage summary", () => {
  const world = initialize();
  const plan = interactionPlan(world.state);
  const pending = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:fold-legitimate",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  const committed = runtime.step(world.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pending.continuation,
    rolls: [20],
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.state.entities[ACTOR].tenureStatus, "dead");

  const forgedRootActionId = "root:fold-forged-summary";
  const forgedPayload = {
    interactionRef: "interaction:fold-forged-summary",
    resolutionId: "resolution:fold-forged-summary",
    actorCharacterId: ACTOR,
    sceneRef: SCENE,
    abilityRef: null,
    targetRefs: [SOURCE],
    directTargetRefs: [SOURCE],
    instrumentRefs: [],
    basisRefs: [SOURCE],
    contextHash: canonicalSha256({ context: "fold-forged-summary" }),
    planHash: canonicalSha256({ plan: "fold-forged-summary" }),
    rulingKind: "directSuccess",
    branch: "success",
    outcomeCode: "outcome:fold-forged-summary",
    summary: "A forged summary claims that this root action caused the earlier death.",
    check: null,
    appliedEffects: [{
      kind: "damage",
      sourceDefinitionRef: SOURCE,
      targetRef: ACTOR,
      amount: 6,
      damageType: "bludgeoning",
      hpBefore: 6,
      hpAfter: 0,
      died: true,
    }],
    sensoryEvidence: [],
    pressures: [],
    opportunities: [],
  };
  const scopeProof = createScopeProof(
    committed.state,
    [`entity:${ACTOR}`, `scene:${SCENE}`, SOURCE],
    [`receipt:${forgedRootActionId}`],
    [],
  );

  assert.throws(() => createEventTransition(committed.state, world.profiles, {
    rootActionId: forgedRootActionId,
    resolutionId: forgedPayload.resolutionId,
    eventType: "WorldInteractionResolved",
    payload: forgedPayload,
    scopeProof,
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  }), /damage effects were not committed by this root action/u);
});
