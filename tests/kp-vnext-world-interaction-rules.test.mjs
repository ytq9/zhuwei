import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  VNEXT_KP_PROPOSAL_SCHEMA,
  VNEXT_WORLD_INTERACTION_FORM_ID,
  lowerVNextCoarseFormProposal,
  validateVNextCoarseFormProposal,
} from "../app/_runtime/lib/kp/vnext/proposals.ts";
import { requiredContextViewerRefs } from "../app/_runtime/lib/kp/vnext/required-context-runtime.ts";
import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const ACTOR = "character:q1";
const SCENE = "scene:q2";
const OTHER_SCENE = "scene:q2b";
const SOURCE = "semantic:q7";
const SECOND_SOURCE = "semantic:q7b";
const ZONE = "semantic:q8";
const RELATION = "relation:q9";
const ACTOR_RELATION = "relation:q9a";
const TARGET = "character:q10";
const FOREIGN_SOURCE = "semantic:q26";
const WRONG_ROLE_SOURCE = "semantic:q27";
const HIDDEN_SOURCE = "semantic:q28";
const HIDDEN_GEOMETRY_SOURCE = "semantic:q29";
const NPC_DEFINITION = "semantic:q30";
const NPC_ENTITY = "character:q30";
const FOREIGN_RELATION = "relation:q31";
const UNBOUND_SOURCE = "semantic:q32";

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

function semanticDefinition(
  semanticKind,
  definitionRef,
  content,
  visibilityPolicyRef = "visibility:scene-observers",
) {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition(
    semanticKind,
    visibilityPolicyRef,
    snapshot,
    { templateRef: definitionRef, templateHash: snapshot.definitionHash },
  );
}

function player(id, name, wisdom, proficientSkills = [], options = {}) {
  const classId = options.classId ?? "fighter";
  return {
    id,
    kind: "player",
    name,
    sceneId: SCENE,
    tenureStatus: "active",
    classId,
    raceId: "human",
    level: 1,
    abilityScores: {
      str: 10,
      dex: 10,
      con: 10,
      int: options.intelligence ?? 10,
      wis: wisdom,
      cha: 10,
    },
    proficiencyBonus: 2,
    proficientSkills,
    resources: {},
    resourceMaximums: {},
    hitPoints: { current: 20, maximum: 20 },
    loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: {
      classId,
      raceId: "human",
      cantrips: options.cantrips ?? [],
      prepared: [],
    },
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
      { x: "300", y: "100", elevation: "0" },
    ],
    obstacles: [{
      featureId: "feature:q-a-near",
      kind: "barrier",
      label: "Q-near",
      state: "present",
      polygon: [
        { x: "145", y: "95" },
        { x: "155", y: "95" },
        { x: "155", y: "105" },
        { x: "145", y: "105" },
      ],
      elevation: "0",
      height: "10",
      opaque: false,
      impassable: false,
      cover: "none",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    }, {
      featureId: "feature:q-b-near",
      kind: "barrier",
      label: "Q-near-b",
      state: "present",
      polygon: [
        { x: "45", y: "95" },
        { x: "55", y: "95" },
        { x: "55", y: "105" },
        { x: "45", y: "105" },
      ],
      elevation: "0",
      height: "10",
      opaque: false,
      impassable: false,
      cover: "none",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers",
    }, {
      featureId: "feature:q-hidden",
      kind: "barrier",
      label: "Q-hidden",
      state: "present",
      polygon: [
        { x: "155", y: "115" },
        { x: "165", y: "115" },
        { x: "165", y: "125" },
        { x: "155", y: "125" },
      ],
      elevation: "0",
      height: "10",
      opaque: false,
      impassable: false,
      cover: "none",
      propagation: "passes",
      terrain: "normal",
      visibilityPolicyId: "visibility:hidden-until-evidence",
    }, {
      featureId: "feature:q-z-far",
      kind: "barrier",
      label: "Q-far",
      state: "present",
      polygon: [
        { x: "520", y: "520" },
        { x: "530", y: "520" },
        { x: "530", y: "530" },
        { x: "520", y: "530" },
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

function initialize(options = {}) {
  const source = semanticDefinition("sceneFeature", SOURCE, {
    sceneRef: SCENE,
    label: "Q7",
    description: "Q7 is a scene feature available to the ruling.",
    mechanicDefinitionRefs: ["feature:q-a-near"],
    observableState: "ready",
    affordances: ["interact"],
    ...(options.embeddedGrantCanary === true
      ? { secretTargetRef: HIDDEN_SOURCE }
      : {}),
  });
  const zone = semanticDefinition("sceneFeature", ZONE, {
    sceneRef: SCENE,
    label: "Q8",
    description: "Q8 is an affected scene zone.",
    mechanicDefinitionRefs: ["feature:q-z-far"],
    observableState: "occupied",
    affordances: ["leave"],
  });
  const secondSource = semanticDefinition("sceneFeature", SECOND_SOURCE, {
    sceneRef: SCENE,
    label: "Q7b",
    description: "Q7b is another scene feature available to the ruling.",
    mechanicDefinitionRefs: ["feature:q-b-near"],
    observableState: "ready",
    affordances: ["interact"],
  });
  const actorRelation = semanticDefinition("worldRelation", ACTOR_RELATION, {
    relationRef: ACTOR_RELATION,
    kind: "contains",
    subjectRef: ZONE,
    objectRef: ACTOR,
    state: "active",
  }, "visibility:room-authority-only");
  const hiddenRelation = semanticDefinition("worldRelation", RELATION, {
    relationRef: RELATION,
    kind: "contains",
    subjectRef: ZONE,
    objectRef: TARGET,
    state: "active",
  }, "visibility:room-authority-only");
  const foreignSource = semanticDefinition("sceneFeature", FOREIGN_SOURCE, {
    sceneRef: OTHER_SCENE,
    label: "Q26",
    description: "Q26 has the same semantic shape but belongs elsewhere.",
    mechanicDefinitionRefs: ["feature:q-a-near"],
    observableState: "ready",
    affordances: ["interact"],
  });
  const wrongRoleSource = semanticDefinition("worldFact", WRONG_ROLE_SOURCE, {
    sceneRef: SCENE,
    label: "Q27",
    description: "Q27 is a fact carrying incidental spatial-looking fields.",
    mechanicDefinitionRefs: ["feature:q-a-near"],
    observableState: "ready",
    affordances: ["interact"],
  });
  const hiddenSource = semanticDefinition("sceneFeature", HIDDEN_SOURCE, {
    sceneRef: SCENE,
    label: "Q28",
    description: "Q28 is not known to the acting Viewer.",
    mechanicDefinitionRefs: ["feature:q-a-near"],
    observableState: "ready",
    affordances: ["interact"],
  }, "visibility:room-authority-only");
  const hiddenGeometrySource = semanticDefinition("sceneFeature", HIDDEN_GEOMETRY_SOURCE, {
    sceneRef: SCENE,
    label: "Q29",
    description: "Q29 is public but its tactical binding is not.",
    mechanicDefinitionRefs: ["feature:q-hidden"],
    observableState: "ready",
    affordances: ["interact"],
  });
  const npcDefinition = semanticDefinition("npc", NPC_DEFINITION, {
    sceneRef: SCENE,
    label: "Q30",
    description: "Q30 is not an environment object.",
    links: { entityRef: NPC_ENTITY },
    semantics: { attitude: "neutral", goals: [], plans: [] },
  });
  const foreignRelation = semanticDefinition("worldRelation", FOREIGN_RELATION, {
    relationRef: FOREIGN_RELATION,
    kind: "supports",
    subjectRef: SOURCE,
    objectRef: FOREIGN_SOURCE,
    state: "active",
  });
  const unboundSource = semanticDefinition("sceneFeature", UNBOUND_SOURCE, {
    label: "Q32",
    description: "Q32 has a spatial role but no authoritative scene binding.",
    mechanicDefinitionRefs: ["feature:q-a-near"],
    observableState: "ready",
    affordances: ["interact"],
  });
  const initialized = runtime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld",
    roomId: "room:q3",
    runtimeEpochId: "epoch:q4",
    moduleRef: profileRef("module:q5", "a"),
    initialDefinitionCatalogRef: profileRef("catalog:q6", "b"),
    activeBranchId: "branch:q0",
    fictionInstantMicros: "0",
    scenes: [
      { id: SCENE, name: "Q2", geometry: tacticalGeometry() },
      { id: OTHER_SCENE, name: "Q2b", geometry: tacticalGeometry() },
    ],
    principals: [
      { id: "principal:q1", sessionVersion: 1, role: "host" },
      { id: "principal:q10", sessionVersion: 1, role: "player" },
    ],
    seats: [
      { id: "seat:q1", principalId: "principal:q1", status: "active" },
      { id: "seat:q10", principalId: "principal:q10", status: "active" },
    ],
    characters: [
      player(ACTOR, "Q1", 16, ["perception"], options),
      player(TARGET, "Q10", 10),
      {
        ...player(NPC_ENTITY, "Q30", 10),
        kind: "npc",
        spatialVisibilityPolicyId: "visibility:hidden-until-evidence",
      },
    ],
    characterControls: [
      { characterId: ACTOR, seatId: "seat:q1" },
      { characterId: TARGET, seatId: "seat:q10" },
    ],
    canonicalFacts: [],
    initialKnowledge: [],
    vNextSeed: {
      semanticDefinitions: [
        source,
        secondSource,
        zone,
        hiddenRelation,
        actorRelation,
        foreignSource,
        wrongRoleSource,
        hiddenSource,
        hiddenGeometrySource,
        npcDefinition,
        foreignRelation,
        unboundSource,
      ],
      itemDefinitions: [],
      itemEntries: [],
      entityDefinitionBindings: [{ entityRef: NPC_ENTITY, definitionRef: NPC_DEFINITION }],
    },
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = runtime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return {
    genesis: initialized.genesis,
    profiles: initialized.profiles,
    state: replayed.state,
    head: replayed.head,
  };
}

function interactionPlan(state, modifier = "5") {
  const readSet = [ACTOR, SCENE, SOURCE, ZONE, RELATION, ACTOR_RELATION, TARGET]
    .sort()
    .map((ref) => {
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      assert.notEqual(revisionOrHash, null, `missing authority binding for ${ref}`);
      return { ref, revisionOrHash };
    });
  return {
    schema: "zhuwei.world-interaction-resolution-plan/v1",
    resolutionId: "resolution:q11",
    interactionRef: "interaction:q12",
    actorCharacterId: ACTOR,
    sceneRef: SCENE,
    abilityRef: null,
    contextHash: canonicalSha256({ context: "q13" }),
    readSet,
    targetRefs: [SOURCE],
    directTargetRefs: [SOURCE],
    instrumentRefs: [],
    basisRefs: [SOURCE],
    intent: "Q14",
    method: "Q15",
    ruling: {
      kind: "check",
      resolutionKind: "abilityCheck",
      randomnessId: "randomness:q16",
      check: {
        kind: "skill",
        ability: "wisdom",
        skill: "perception",
        dc: "10",
        modifier,
        mode: "normal",
        costs: [],
        goal: "Q17",
        method: "Q18",
        risk: "Q19",
        successOutcome: "Q20",
        failureOutcome: "Q21",
      },
    },
    costs: [],
    branches: {
      success: {
        outcomeCode: "outcome:q22",
        summary: "Q23",
        effects: [{
          kind: "registeredHazard",
          sourceDefinitionRef: SOURCE,
          zoneRef: ZONE,
          damage: { kind: "profile", damageProfileRef: "world-damage:falling-object:moderate" },
        }],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
      failure: {
        outcomeCode: "outcome:q24",
        summary: "Q25",
        effects: [],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
    },
  };
}

function abilityRefByMechanicalKey(state, mechanicalKey) {
  const match = Object.values(state.combatRuntime.definitions)
    .find((definition) => definition.mechanicalKey === mechanicalKey);
  assert.ok(match, `missing combat Ability for ${mechanicalKey}`);
  return match.definitionId;
}

function attackInteractionPlan(state, {
  abilityRef,
  checkAbility,
  modifier,
  directTargetRefs = [SOURCE],
  targetRefs = directTargetRefs,
  dc = "10",
  nonce = "attack",
}) {
  const canonicalTargets = [...new Set(targetRefs)].sort();
  const canonicalDirectTargets = [...new Set(directTargetRefs)].sort();
  const readSet = [...new Set([
    ACTOR,
    SCENE,
    abilityRef,
    SOURCE,
    ...canonicalTargets,
  ])].sort().map((ref) => {
    const revisionOrHash = authorityRevisionOrHash(state, ref);
    assert.notEqual(revisionOrHash, null, `missing authority binding for ${ref}`);
    return { ref, revisionOrHash };
  });
  return {
    schema: "zhuwei.world-interaction-resolution-plan/v1",
    resolutionId: `resolution:q:${nonce}`,
    interactionRef: `interaction:q:${nonce}`,
    actorCharacterId: ACTOR,
    sceneRef: SCENE,
    abilityRef,
    contextHash: canonicalSha256({ context: nonce }),
    readSet,
    targetRefs: canonicalTargets,
    directTargetRefs: canonicalDirectTargets,
    instrumentRefs: [],
    basisRefs: [SOURCE],
    intent: `intent:${nonce}`,
    method: `method:${nonce}`,
    ruling: {
      kind: "check",
      resolutionKind: "attack",
      randomnessId: `randomness:q:${nonce}`,
      check: {
        kind: "ability",
        ability: checkAbility,
        skill: null,
        dc,
        modifier,
        mode: "normal",
        costs: [],
        goal: `goal:${nonce}`,
        method: `method:${nonce}`,
        risk: `risk:${nonce}`,
        successOutcome: `success:${nonce}`,
        failureOutcome: `failure:${nonce}`,
      },
    },
    costs: [],
    branches: {
      success: {
        outcomeCode: `outcome:q:${nonce}:success`,
        summary: `summary:${nonce}:success`,
        effects: [],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
      failure: {
        outcomeCode: `outcome:q:${nonce}:failure`,
        summary: `summary:${nonce}:failure`,
        effects: [],
        sensoryEvidence: [],
        pressures: [],
        opportunities: [],
      },
    },
  };
}

function bindPlanReadSet(state, plan, additionalRefs) {
  const bound = structuredClone(plan);
  bound.readSet = [...new Set([
    ...bound.readSet.map(({ ref }) => ref),
    ...additionalRefs,
  ])].sort().map((ref) => {
    const revisionOrHash = authorityRevisionOrHash(state, ref);
    assert.notEqual(revisionOrHash, null, `missing authority binding for ${ref}`);
    return { ref, revisionOrHash };
  });
  return bound;
}

function nextSemanticDefinition(state, definitionRef, mutate) {
  const current = state.campaignRuntime.definitions[definitionRef];
  assert.ok(current, `missing semantic definition ${definitionRef}`);
  const content = structuredClone(current.content);
  mutate(content);
  const snapshot = createDefinitionSnapshot(
    definitionRef,
    (BigInt(current.revision) + 1n).toString(),
    content,
  );
  return storedSemanticDefinition(
    current.semanticKind,
    current.visibilityPolicyRef,
    snapshot,
    { templateRef: current.templateRef, templateHash: current.templateHash },
  );
}

function definitionRevisionEffect(state, definitionRef) {
  return {
    kind: "definitionRevision",
    nextDefinition: nextSemanticDefinition(state, definitionRef, (content) => {
      if (content.semantics && typeof content.semantics === "object") {
        content.semantics.attitude = "changed";
      } else {
        content.description = `${content.description ?? "Q"}:changed`;
      }
    }),
    summary: `summary:${definitionRef}`,
  };
}

function relationTransitionEffect(state, relationRef) {
  const current = state.campaignRuntime.definitions[relationRef];
  assert.ok(current, `missing relation ${relationRef}`);
  return {
    kind: "relationTransition",
    relationRef,
    relationKind: current.content.kind,
    subjectRef: current.content.subjectRef,
    objectRef: current.content.objectRef,
    fromState: current.content.state,
    toState: "ended",
    nextDefinition: nextSemanticDefinition(state, relationRef, (content) => {
      content.state = "ended";
    }),
    summary: `summary:${relationRef}`,
  };
}

function collectContext(world, rootActionId = "root:q:context") {
  const kpProjection = runtime.project(world.profiles, world.state, {
    kind: "kp",
    capability: "internal:kp-spatial-evidence",
  });
  assert.equal(kpProjection.kind, "projected", JSON.stringify(kpProjection));
  // The fixture's intent text is an opaque marker rather than prose, so the
  // refs under test arrive as UI focus -- addressing the pipeline trusts,
  // exactly as a player pointing at them on the map would.
  const frozen = freezeAdjudicationContext({
    state: world.state,
    profiles: world.profiles,
    kpProjection,
    replayHead: world.head,
    preparedActionId: `prepared:${rootActionId}`,
    rootActionId,
    submissionRef: `submission:${rootActionId}`,
    actorCharacterId: ACTOR,
    intentText: "intent:q:context",
    focusRefs: [
      SOURCE, SECOND_SOURCE, ZONE, RELATION, ACTOR_RELATION, TARGET,
      FOREIGN_SOURCE, WRONG_ROLE_SOURCE, HIDDEN_SOURCE, HIDDEN_GEOMETRY_SOURCE,
      NPC_DEFINITION, NPC_ENTITY, FOREIGN_RELATION, UNBOUND_SOURCE,
    ],
    maxUnits: 160_000,
  });
  assert.equal(frozen.kind, "ready", JSON.stringify(frozen));
  return frozen.context;
}

function proposalEnvelope({
  contextHash = canonicalSha256({ context: "proposal" }),
  directTargetRef = SOURCE,
} = {}) {
  const branch = (suffix) => ({
    outcomeCode: `outcome:q:${suffix}`,
    summary: `summary:${suffix}`,
    effects: [],
    sensoryEvidence: [{
      observerRef: ACTOR,
      subjectRef: SOURCE,
      sense: "sight",
      evidence: `evidence:${suffix}`,
      basisRefs: [SOURCE],
    }],
    pressures: [{
      description: `pressure:${suffix}`,
      sourceRef: SOURCE,
      basisRefs: [SOURCE],
    }],
    opportunities: [{
      description: `opportunity:${suffix}`,
      targetRef: SOURCE,
      actionHint: `hint:${suffix}`,
      basisRefs: [SOURCE],
    }],
  });
  return {
    schema: VNEXT_KP_PROPOSAL_SCHEMA,
    kind: "vnextCoarseFormProposal",
    formId: VNEXT_WORLD_INTERACTION_FORM_ID,
    proposalRef: "proposal:q:grounded",
    contextHash,
    basisRefs: [SOURCE],
    proposal: {
      kind: "worldInteraction",
      sceneRef: SCENE,
      targetRefs: [directTargetRef],
      directTargetRefs: [directTargetRef],
      instrumentRefs: [],
      abilityRef: null,
      intent: "intent:q:grounded",
      method: "method:q:grounded",
      adjudication: {
        kind: "directSuccess",
        risk: "risk:q:grounded",
        successOutcome: "success:q:grounded",
        failureOutcome: "failure:q:grounded",
      },
      branches: {
        success: branch("success"),
        failure: branch("failure"),
      },
    },
  };
}

test("opaque IDs resolve registered hazard targets and damage through step/project/replay", () => {
  const world = initialize();
  const plan = interactionPlan(world.state);
  const effect = plan.branches.success.effects[0];
  assert.deepEqual(Object.keys(effect).sort(), [
    "damage",
    "kind",
    "sourceDefinitionRef",
    "zoneRef",
  ]);
  assert.equal(JSON.stringify(effect).includes(TARGET), false);
  assert.equal(Object.hasOwn(effect, "amount"), false);

  const legacyDamagePlan = structuredClone(plan);
  legacyDamagePlan.branches.success.effects = [{
    kind: "damage",
    sourceDefinitionRef: SOURCE,
    targetRef: TARGET,
    amount: 999,
    damageType: "bludgeoning",
  }];
  const legacyDamage = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:legacy-damage",
    actorCharacterId: ACTOR,
    plan: legacyDamagePlan,
  });
  assert.equal(legacyDamage.kind, "rejected", JSON.stringify(legacyDamage));
  assert.equal(legacyDamage.rejection.code, "invalidRulesInput");

  const forgedModifier = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:forged-modifier",
    actorCharacterId: ACTOR,
    plan: interactionPlan(world.state, "999"),
  });
  assert.equal(forgedModifier.kind, "rejected", JSON.stringify(forgedModifier));
  assert.equal(forgedModifier.rejection.code, "invalidRulesInput");

  const pending = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:valid",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  assert.equal(pending.randomnessRequest.frozenCheck.modifier, "5");
  assert.equal(pending.state.entities[TARGET].hitPoints.current, 20);

  const committed = runtime.step(world.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pending.continuation,
    rolls: [20],
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  assert.equal(committed.state.entities[ACTOR].hitPoints.current, 14);
  assert.equal(committed.state.entities[TARGET].hitPoints.current, 14);
  assert.deepEqual(
    committed.mechanicalResult.appliedEffects
      .filter(({ kind }) => kind === "damage")
      .map(({ targetRef, amount, damageType, hpBefore, hpAfter, died }) => ({
        targetRef,
        amount,
        damageType,
        hpBefore,
        hpAfter,
        died,
      })),
    [ACTOR, TARGET].sort().map((targetRef) => ({
      targetRef,
      amount: 6,
      damageType: "bludgeoning",
      hpBefore: 20,
      hpAfter: 14,
      died: false,
    })),
  );

  const events = [...pending.events, ...committed.events];
  assert.ok(events.every(({ rootActionId }) => rootActionId === "root:q:valid"));
  const projected = runtime.project(world.profiles, committed.state, {
    kind: "player",
    principalId: "principal:q1",
    sessionVersion: 1,
    seatId: "seat:q1",
    characterId: ACTOR,
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
  assert.ok(projected.committedDelta, "committed range must project an observer delta");
  assert.ok(projected.renderableClaims, "committed range must project frozen narration Claims");
  const damageClaim = projected.renderableClaims.claims.find((claim) =>
    claim.kind === "mechanicalOutcome"
    && claim.targetRefs?.includes(TARGET)
    && claim.outcomeCode === "damageApplied");
  assert.ok(damageClaim, JSON.stringify(projected.renderableClaims));
  assert.match(damageClaim.summary, /6/u);
  assert.match(damageClaim.summary, /bludgeoning/u);
  assert.equal(JSON.stringify(projected.renderableClaims).includes(RELATION), false);
  assert.equal(JSON.stringify(projected.renderableClaims).includes(ACTOR_RELATION), false);

  const rebuilt = runtime.replay(world.genesis, events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
  assert.equal(rebuilt.state.entities[ACTOR].hitPoints.current, 14);
  assert.equal(rebuilt.state.entities[TARGET].hitPoints.current, 14);
});

// Test level: T2 — crosses Rules step, committed events and the real Viewer
// projector to prove that visible semantic/free-text content cannot mint another grant.
test("visible raw content cannot grant a hidden Claim payload reference", () => {
  const initialized = initialize({ embeddedGrantCanary: true });
  const seeded = runtime.step(initialized.profiles, initialized.state, {
    kind: "createSourceClaim",
    proposalId: "root:q:viewer-grant-source",
    speakerId: ACTOR,
    claimId: "claim:q:viewer-grant-source",
    semanticContent: "这段已知主张不授予任何对象权限。",
    sourceBasis: HIDDEN_SOURCE,
    motive: "记录授权边界",
    formedAtFictionMicros: "0",
  });
  assert.equal(seeded.kind, "committed", JSON.stringify(seeded));
  const world = { ...initialized, state: seeded.state };
  const plan = bindPlanReadSet(world.state, interactionPlan(world.state), [HIDDEN_SOURCE]);
  plan.basisRefs = [HIDDEN_SOURCE, SOURCE].sort();
  plan.branches.success.pressures = [{
    description: "PRIVATE-GRANT-CANARY",
    sourceRef: HIDDEN_SOURCE,
    visibilityPolicyRef: "visibility:scene-observers",
    basisRefs: [SOURCE],
  }];

  const pending = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:viewer-grant-canary",
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
  const events = [...pending.events, ...committed.events];
  const projected = runtime.project(world.profiles, committed.state, {
    kind: "player",
    principalId: "principal:q1",
    sessionVersion: 1,
    seatId: "seat:q1",
    characterId: ACTOR,
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
  assert.ok(projected.renderableClaims, "committed range must freeze Viewer Claims");
  assert.equal(
    JSON.stringify(projected.renderableClaims).includes("PRIVATE-GRANT-CANARY"),
    false,
  );
  assert.equal(JSON.stringify(projected.renderableClaims).includes(HIDDEN_SOURCE), false);
});

test("direct mechanical targets cannot borrow Geometry from causal objects or be rejected by incidental objects", () => {
  const world = initialize();
  const abilityRef = abilityRefByMechanicalKey(world.state, "improvised-strike");
  const accepted = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:direct-target",
    actorCharacterId: ACTOR,
    plan: attackInteractionPlan(world.state, {
      abilityRef,
      checkAbility: "strength",
      modifier: "2",
      directTargetRefs: [SOURCE],
      targetRefs: [SOURCE, ZONE],
      nonce: "direct-target",
    }),
  });
  assert.equal(accepted.kind, "awaitingRandomness", JSON.stringify(accepted));
  assert.deepEqual(accepted.randomnessRequest.frozenCheck.costs, []);

  const borrowedGeometry = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:borrowed-geometry",
    actorCharacterId: ACTOR,
    plan: attackInteractionPlan(world.state, {
      abilityRef,
      checkAbility: "strength",
      modifier: "2",
      directTargetRefs: [RELATION],
      targetRefs: [RELATION, SOURCE],
      nonce: "borrowed-geometry",
    }),
  });
  assert.equal(borrowedGeometry.kind, "rejected", JSON.stringify(borrowedGeometry));
  assert.equal(borrowedGeometry.rejection.code, "privateOrUnknownReference");
});

test("registered Ability target count limits opaque direct semantic targets", () => {
  const world = initialize();
  const abilityRef = abilityRefByMechanicalKey(world.state, "improvised-strike");
  assert.equal(world.state.combatRuntime.definitions[abilityRef].target.count, "1");

  const tooManyDirectTargets = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:target-count",
    actorCharacterId: ACTOR,
    plan: attackInteractionPlan(world.state, {
      abilityRef,
      checkAbility: "strength",
      modifier: "2",
      directTargetRefs: [SOURCE, SECOND_SOURCE],
      targetRefs: [SOURCE, SECOND_SOURCE],
      nonce: "target-count",
    }),
  });
  assert.equal(tooManyDirectTargets.kind, "rejected", JSON.stringify(tooManyDirectTargets));
  assert.equal(
    tooManyDirectTargets.rejection.code,
    "invalidRulesInput",
    JSON.stringify(tooManyDirectTargets),
  );
});

test("direct targets require current-scene spatial roles and Viewer addressability", () => {
  const world = initialize();
  for (const targetRef of [
    FOREIGN_SOURCE,
    WRONG_ROLE_SOURCE,
    HIDDEN_SOURCE,
    NPC_ENTITY,
    UNBOUND_SOURCE,
  ]) {
    const plan = interactionPlan(world.state);
    plan.targetRefs = [targetRef];
    plan.directTargetRefs = [targetRef];
    const result = runtime.step(world.profiles, world.state, {
      kind: "resolveWorldInteraction",
      rootActionId: `root:q:direct:${targetRef}`,
      actorCharacterId: ACTOR,
      plan: bindPlanReadSet(world.state, plan, [targetRef]),
    });
    assert.equal(result.kind, "rejected", `${targetRef}: ${JSON.stringify(result)}`);
    assert.equal(result.rejection.code, "privateOrUnknownReference", targetRef);
  }

  const abilityRef = abilityRefByMechanicalKey(world.state, "improvised-strike");
  const hiddenGeometry = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:hidden-geometry",
    actorCharacterId: ACTOR,
    plan: attackInteractionPlan(world.state, {
      abilityRef,
      checkAbility: "strength",
      modifier: "2",
      directTargetRefs: [HIDDEN_GEOMETRY_SOURCE],
      targetRefs: [HIDDEN_GEOMETRY_SOURCE],
      nonce: "hidden-geometry",
    }),
  });
  assert.equal(hiddenGeometry.kind, "rejected", JSON.stringify(hiddenGeometry));
  assert.equal(hiddenGeometry.rejection.code, "privateOrUnknownReference");
});

test("proposal lowering derives direct addressability without exposing KP-only causes", () => {
  const world = initialize();
  const rootActionId = "root:q:lowering";
  const context = collectContext(world, rootActionId);
  const viewerRefs = requiredContextViewerRefs(context);
  assert.equal(viewerRefs.has(SOURCE), true);
  assert.equal(viewerRefs.has(HIDDEN_SOURCE), false);

  const visible = lowerVNextCoarseFormProposal({
    value: proposalEnvelope({ contextHash: context.binding.contextHash }),
    requiredContext: context,
    state: world.state,
    rootActionId,
    actorCharacterId: ACTOR,
  });
  assert.equal(visible.kind, "accepted", JSON.stringify(visible));

  for (const directTargetRef of [
    HIDDEN_SOURCE,
    NPC_ENTITY,
    FOREIGN_SOURCE,
    WRONG_ROLE_SOURCE,
  ]) {
    const result = lowerVNextCoarseFormProposal({
      value: proposalEnvelope({
        contextHash: context.binding.contextHash,
        directTargetRef,
      }),
      requiredContext: context,
      state: world.state,
      rootActionId,
      actorCharacterId: ACTOR,
    });
    assert.equal(result.kind, "rejected", `${directTargetRef}: ${JSON.stringify(result)}`);
    assert.equal(result.code, "PROPOSAL_REFERENCE_INVALID", directTargetRef);
  }
});

test("proposal lowering fails closed for malformed authority inputs", () => {
  const world = initialize();
  const rootActionId = "root:q:malformed-lowering";
  const context = collectContext(world, rootActionId);
  const value = proposalEnvelope({ contextHash: context.binding.contextHash });
  const base = {
    value,
    requiredContext: context,
    state: world.state,
    rootActionId,
    actorCharacterId: ACTOR,
  };

  for (const malformed of [
    { ...base, requiredContext: null },
    { ...base, state: null },
    null,
  ]) {
    const result = lowerVNextCoarseFormProposal(malformed);
    assert.equal(result.kind, "rejected", JSON.stringify(result));
    assert.equal(result.code, "PROPOSAL_FORM_INVALID", JSON.stringify(result));
    assert.deepEqual(result.issues, ["proposal:lowering-input-invalid"]);
  }
});

function authoredHazardMechanics(definitionId, amount) {
  return {
    definitionId,
    revision: "1",
    definitionKind: "environmentHazardMechanics",
    rulesBasis: "srd5.1-2014",
    effect: { kind: "fixedDamage", amount, damageType: "bludgeoning" },
  };
}

function authoredHazardDefinition(overrides = {}) {
  return {
    definitionId: overrides.definitionId ?? "hazard:vnext:collapsing-gallery",
    revision: "1",
    definitionKind: "environmentHazard",
    rulesBasis: "srd5.1-2014",
    visibilityPolicyRef: "visibility:hidden-until-evidence",
    causalBasisRefs: [],
    content: {
      schema: "zhuwei.environment-hazard-definition/v1",
      label: "回廊塌落",
      trigger: { kind: "enterZone", ref: ZONE },
      perceptibleSigns: ["承重柱上的新裂纹"],
      disableMethods: ["先加固承重柱再通过"],
      environmentalConsequences: ["回廊被碎石堵死"],
      mechanicsRef: overrides.mechanicsRef ?? "ability:vnext:collapsing-gallery",
      ...(overrides.content ?? {}),
    },
  };
}

function registerDefinitionStep(world, state, definition, rootActionId) {
  const registered = runtime.step(world.profiles, state, {
    kind: "registerDynamicDefinition",
    proposalId: rootActionId,
    definition,
  });
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  return registered;
}

/** Mechanics first, then the danger that cites them: a hazard's numbers are
 * frozen by the registration of the Ability it settles through. */
function registerAuthoredHazard(world, definition, rootActionId, amount = 9) {
  const mechanics = registerDefinitionStep(
    world,
    world.state,
    authoredHazardMechanics(definition.content.mechanicsRef, amount),
    `${rootActionId}:mechanics`,
  );
  const hazard = registerDefinitionStep(world, mechanics.state, definition, rootActionId);
  return { ...hazard, events: [...mechanics.events, ...hazard.events] };
}

test("a branch settles a hazard the KP froze this session, not only one the runtime shipped", () => {
  // SPEC 0001 section 8 lets the KP invent the danger; section 10 says it only
  // takes effect once frozen. The frozen definition supplies the numbers and
  // the interaction's own check decides whether the branch carrying it runs,
  // so authoring a danger needs no settlement machinery of its own.
  const world = initialize();
  const registered = registerAuthoredHazard(
    world,
    authoredHazardDefinition(),
    "root:q:register-authored-hazard",
  );
  const plan = interactionPlan(registered.state);
  plan.branches.success.effects = [{
    kind: "registeredHazard",
    sourceDefinitionRef: SOURCE,
    zoneRef: ZONE,
    damage: { kind: "authored", hazardDefinitionRef: "hazard:vnext:collapsing-gallery" },
  }];

  const pending = runtime.step(registered.profiles ?? world.profiles, registered.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:authored-hazard",
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
  // Nine, the amount the KP froze -- not the six the shipped profile carries.
  assert.deepEqual(
    committed.mechanicalResult.appliedEffects
      .filter(({ kind }) => kind === "damage")
      .map(({ amount, damageType }) => ({ amount, damageType })),
    [
      { amount: 9, damageType: "bludgeoning" },
      { amount: 9, damageType: "bludgeoning" },
    ],
  );
  assert.equal(committed.state.entities[TARGET].hitPoints.current, 11);

  const rebuilt = runtime.replay(
    world.genesis,
    [...registered.events, ...pending.events, ...committed.events],
  );
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
});

test("a branch cannot cite a hazard the KP has not frozen, nor the bare mechanics behind one", () => {
  const world = initialize();
  const frozen = registerAuthoredHazard(
    world,
    authoredHazardDefinition({ definitionId: "hazard:vnext:reject-case" }),
    "root:q:register-reject-case",
  );
  for (const [label, hazardDefinitionRef, state] of [
    // Section 10: a danger takes effect only once it has been frozen.
    ["never frozen", "hazard:vnext:never-frozen", world.state],
    // The Ability carries the numbers, but the hazard is what carries the
    // trigger, the signs and the ways to deal with it. Citing the mechanics
    // alone would settle damage with none of the fairness the danger owes.
    ["bare mechanics", "ability:vnext:collapsing-gallery", frozen.state],
  ]) {
    const plan = interactionPlan(state);
    plan.branches.success.effects = [{
      kind: "registeredHazard",
      sourceDefinitionRef: SOURCE,
      zoneRef: ZONE,
      damage: { kind: "authored", hazardDefinitionRef },
    }];
    const result = runtime.step(world.profiles, state, {
      kind: "resolveWorldInteraction",
      rootActionId: `root:q:authored-hazard:${hazardDefinitionRef}`,
      actorCharacterId: ACTOR,
      plan,
    });
    assert.equal(result.kind, "rejected", `${label}: ${JSON.stringify(result)}`);
    assert.equal(state.entities[TARGET].hitPoints.current, 20, label);
  }
});

test("registered hazards reject foreign or non-spatial sources before randomness", () => {
  const world = initialize();
  for (const sourceRef of [FOREIGN_SOURCE, WRONG_ROLE_SOURCE, UNBOUND_SOURCE]) {
    const plan = interactionPlan(world.state);
    plan.branches.success.effects = [{
      kind: "registeredHazard",
      sourceDefinitionRef: sourceRef,
      zoneRef: sourceRef,
      damage: { kind: "profile", damageProfileRef: "world-damage:falling-object:moderate" },
    }];
    const result = runtime.step(world.profiles, world.state, {
      kind: "resolveWorldInteraction",
      rootActionId: `root:q:hazard:${sourceRef}`,
      actorCharacterId: ACTOR,
      plan: bindPlanReadSet(world.state, plan, [sourceRef]),
    });
    assert.equal(result.kind, "rejected", `${sourceRef}: ${JSON.stringify(result)}`);
    assert.equal(world.state.entities[ACTOR].hitPoints.current, 20);
    assert.equal(world.state.entities[TARGET].hitPoints.current, 20);
  }
});

test("world-interaction effects cannot revise another Form domain or a foreign scene", () => {
  const world = initialize();
  for (const definitionRef of [NPC_DEFINITION, FOREIGN_SOURCE]) {
    const plan = interactionPlan(world.state);
    plan.branches.success.effects = [definitionRevisionEffect(world.state, definitionRef)];
    const result = runtime.step(world.profiles, world.state, {
      kind: "resolveWorldInteraction",
      rootActionId: `root:q:revision:${definitionRef}`,
      actorCharacterId: ACTOR,
      plan: bindPlanReadSet(world.state, plan, [definitionRef]),
    });
    assert.equal(result.kind, "rejected", `${definitionRef}: ${JSON.stringify(result)}`);
    assert.equal(
      world.state.campaignRuntime.definitions[definitionRef].revision,
      "1",
      definitionRef,
    );
  }

  const relationPlan = interactionPlan(world.state);
  relationPlan.branches.success.effects = [relationTransitionEffect(world.state, FOREIGN_RELATION)];
  const relationResult = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:foreign-relation",
    actorCharacterId: ACTOR,
    plan: bindPlanReadSet(world.state, relationPlan, [FOREIGN_RELATION, FOREIGN_SOURCE]),
  });
  assert.equal(relationResult.kind, "rejected", JSON.stringify(relationResult));
  assert.equal(world.state.campaignRuntime.definitions[FOREIGN_RELATION].revision, "1");
});

test("a no-resource spell attack uses spellcasting authority through step/project/replay", () => {
  const world = initialize({
    classId: "wizard",
    intelligence: 16,
    cantrips: ["fire-bolt"],
  });
  const abilityRef = abilityRefByMechanicalKey(world.state, "spell:fire-bolt");
  assert.deepEqual(world.state.combatRuntime.definitions[abilityRef].attack, {
    kind: "spellAttack",
  });
  assert.equal(
    world.state.combatRuntime.definitions[abilityRef].target.kind,
    "creatureOrEnvironmentFeature",
  );
  const plan = attackInteractionPlan(world.state, {
    abilityRef,
    checkAbility: "intelligence",
    modifier: "5",
    nonce: "spell-attack",
  });
  const pending = runtime.step(world.profiles, world.state, {
    kind: "resolveWorldInteraction",
    rootActionId: "root:q:spell-attack",
    actorCharacterId: ACTOR,
    plan,
  });
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending));
  assert.equal(pending.randomnessRequest.frozenCheck.modifier, "5");
  assert.deepEqual(pending.randomnessRequest.frozenCheck.costs, []);

  const committed = runtime.step(world.profiles, pending.state, {
    kind: "fulfillAuthoritativeRandomness",
    continuation: pending.continuation,
    rolls: [10],
  });
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  const resolved = committed.events.find(({ eventType }) => eventType === "WorldInteractionResolved");
  assert.deepEqual(resolved.payload.check, {
    resolutionKind: "attack",
    randomnessId: plan.ruling.randomnessId,
    rolls: [10],
    selectedRoll: 10,
    total: 15,
    dc: 10,
    succeeded: true,
  });
  const invoked = committed.events.find(({ eventType }) => eventType === "AbilityInvoked");
  assert.deepEqual(invoked.payload.mechanicalResult.targetRefs, [SOURCE]);

  const events = [...pending.events, ...committed.events];
  const projected = runtime.project(world.profiles, committed.state, {
    kind: "player",
    principalId: "principal:q1",
    sessionVersion: 1,
    seatId: "seat:q1",
    characterId: ACTOR,
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
  const attackClaim = projected.renderableClaims.claims.find((claim) =>
    claim.kind === "mechanicalOutcome" && claim.check?.kind === "attack");
  assert.equal(attackClaim?.check?.result, "success", JSON.stringify(projected.renderableClaims));

  const rebuilt = runtime.replay(world.genesis, events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.equal(rebuilt.head.stateHash, committed.stateHash);
});

test("world-interaction proposals fail closed without grounded evidence, pressure, opportunity, or direct targets", () => {
  const valid = proposalEnvelope();
  assert.equal(validateVNextCoarseFormProposal(valid).kind, "accepted");
  const mutations = [
    ["sensory evidence", (value) => {
      value.proposal.branches.success.sensoryEvidence[0].basisRefs = [];
    }],
    ["pressure", (value) => {
      value.proposal.branches.success.pressures[0].basisRefs = [];
    }],
    ["opportunity", (value) => {
      value.proposal.branches.success.opportunities[0].basisRefs = [];
    }],
    ["direct target", (value) => {
      value.proposal.directTargetRefs = [];
    }],
    ["non-subset direct target", (value) => {
      value.proposal.directTargetRefs = [ZONE];
    }],
  ];
  for (const [label, mutate] of mutations) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    const result = validateVNextCoarseFormProposal(invalid);
    assert.equal(result.kind, "rejected", `${label}: ${JSON.stringify(result)}`);
    assert.equal(result.code, "PROPOSAL_FORM_INVALID", label);
  }
});

test("world-interaction production mechanics contain no fixture-name or material dispatch", () => {
  const sources = [
    "../app/_runtime/lib/kp/vnext/proposals.ts",
    "../app/_runtime/lib/kp/vnext/required-context-runtime.ts",
    "../app/_runtime/lib/kp/vnext/room-bridge.ts",
    "../app/_runtime/lib/room/vnext-adjudication-bridge.ts",
    "../app/_runtime/lib/rules/v2/world-interactions.ts",
    "../app/_runtime/lib/rules/v2/world-interaction-mechanics.ts",
    "../app/_runtime/lib/rules/v2/world-interaction-model.ts",
    "../app/_runtime/lib/rules/v2/semantic-definitions.ts",
    "../app/_runtime/lib/rules/profiles/world-interaction-registry.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(
    sources,
    /semantic:q7|semantic:q8|relation:q9a?|character:q1(?:0)?/u,
  );
  assert.doesNotMatch(
    sources,
    /\b(?:chandelier|rope|iron|wood|stone|rock|trap|pressure[-_ ]?plate|pistol|firearm|gun|flammability|materialClass)\b|吊灯|绳索|铁链|木材|石头|陷阱|压板|枪/iu,
  );
});
