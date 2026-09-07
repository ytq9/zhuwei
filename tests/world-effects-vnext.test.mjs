import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { effectiveConditions, worldEffectIds } from "../app/_runtime/lib/rules/v2/world-effects.ts";

const ACTOR = "character:effects";
const HELPER = "character:effects-helper";
const SCENE = "scene:effects";
const SOURCE = "semantic:effects-source";
const ZONE = "semantic:effects-zone";
const RELATION = "semantic:effects-contains";
const viewer = { kind: "player", principalId: "principal:effects", sessionVersion: 1,
  seatId: "seat:effects", characterId: ACTOR };
const runtime = createVersionedRulesRuntime({
  registrations: [{ manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, interpreterKind: "authoritative-v2" }],
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});

function semantic(kind, id, content) {
  const snapshot = createDefinitionSnapshot(id, "1", content);
  return storedSemanticDefinition(kind, "visibility:scene-observers", snapshot,
    { templateRef: id, templateHash: snapshot.definitionHash });
}

function initialize(conditionImmunities = []) {
  const initialInput = {
    kind: "initializeAuthoritativeWorld", roomId: "room:effects", runtimeEpochId: "epoch:effects",
    moduleRef: { profileId: "module:effects", profileHash: `sha256:${"a".repeat(64)}` },
    initialDefinitionCatalogRef: { profileId: "catalog:effects", profileHash: `sha256:${"b".repeat(64)}` },
    activeBranchId: "branch:effects", fictionInstantMicros: "0",
    scenes: [{ id: SCENE, name: "Effects room", geometry: {
      schema: "zhuwei.tactical-geometry/v1", unit: "inch",
      boundary: { kind: "polygon", points: [{ x: "0", y: "0" }, { x: "600", y: "0" },
        { x: "600", y: "600" }, { x: "0", y: "600" }] },
      spawnPoints: [{ x: "100", y: "100", elevation: "0" }, { x: "250", y: "100", elevation: "0" }],
      obstacles: [{ featureId: "feature:effects-marker", kind: "barrier", label: "Room marker",
        state: "present", polygon: [{ x: "400", y: "400" }, { x: "450", y: "400" },
          { x: "450", y: "450" }, { x: "400", y: "450" }], elevation: "0", height: "10",
        opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal",
        visibilityPolicyId: "visibility:scene-observers" }], clearanceZones: [],
    } }],
    principals: [{ id: viewer.principalId, sessionVersion: 1, role: "host" }],
    seats: [{ id: viewer.seatId, principalId: viewer.principalId, status: "active" }],
    characters: [{ id: ACTOR, kind: "player", name: "Observer", sceneId: SCENE, tenureStatus: "active",
      classId: "fighter", raceId: "human", level: 1,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2, proficientSkills: [], resources: {}, resourceMaximums: {},
      hitPoints: { current: 20, maximum: 20 },
      loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
      characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] },
      ...(conditionImmunities.length === 0 ? {} : { conditionImmunities }),
    }],
    characterControls: [{ characterId: ACTOR, seatId: viewer.seatId }],
    canonicalFacts: [], initialKnowledge: [],
    vNextSeed: { semanticDefinitions: [
      semantic("sceneFeature", SOURCE, { sceneRef: SCENE, label: "Source", description: "A visible source.",
        observableState: "ready", affordances: ["interact"] }),
      semantic("sceneFeature", ZONE, { sceneRef: SCENE, label: "Zone", description: "The occupied zone.",
        observableState: "occupied", affordances: ["leave"] }),
      semantic("worldRelation", RELATION, { relationRef: RELATION, kind: "contains", subjectRef: ZONE,
        objectRef: ACTOR, state: "active" }),
    ], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  };
  initialInput.characters.push({ ...structuredClone(initialInput.characters[0]), id: HELPER,
    name: "Awake companion", conditionImmunities: [] });
  initialInput.principals.push({ id: "principal:helper", sessionVersion: 1, role: "player" });
  initialInput.seats.push({ id: "seat:helper", principalId: "principal:helper", status: "active" });
  initialInput.characterControls.push({ characterId: HELPER, seatId: "seat:helper" });
  const initialized = runtime.step(undefined, undefined, initialInput);
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = runtime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { genesis: initialized.genesis, profiles: initialized.profiles, state: replayed.state, events: [] };
}

function commit(world, input) {
  let result = runtime.step(world.profiles, world.state, input);
  const events = [...result.events];
  if (result.kind === "awaitingRandomness") {
    assert.ok(result.randomnessRequest.hazardRolls.every(spec => spec.purposeKey.includes(":concentration:")));
    result = runtime.step(world.profiles, result.state, {
      kind: "fulfillAuthoritativeRandomness", continuation: result.continuation,
      rolls: result.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(20)),
    });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  world.state = result.state;
  world.events.push(...events);
  return result;
}

function applyHazard(world, label, effects, actorCharacterId = ACTOR) {
  const abilityRef = `ability:effects:${label}`;
  const hazardRef = `hazard:effects:${label}`;
  commit(world, { kind: "registerDynamicDefinition", proposalId: `register:${label}:ability`, definition: {
    definitionId: abilityRef, definitionKind: "environmentHazardMechanics", revision: "1",
    rulesBasis: "srd5.1-2014", effect: { kind: "fixedDamage", amount: 1, damageType: "poison" }, effects,
  } });
  commit(world, { kind: "registerDynamicDefinition", proposalId: `register:${label}:hazard`, definition: {
    definitionId: hazardRef, revision: "1", definitionKind: "environmentHazard", rulesBasis: "srd5.1-2014",
    visibilityPolicyRef: "visibility:scene-observers", causalBasisRefs: [], content: {
      schema: "zhuwei.environment-hazard-definition/v1", label: "Visible danger",
      trigger: { kind: "contactFeature", ref: SOURCE }, perceptibleSigns: ["An acrid trace."],
      disableMethods: ["Seal the source."], environmentalConsequences: [], mechanicsRef: abilityRef,
    },
  } });
  const refs = [...new Set([ACTOR, actorCharacterId, SCENE, SOURCE, ZONE, RELATION, abilityRef, hazardRef])].sort();
  return commit(world, { kind: "resolveWorldInteraction", rootActionId: `root:effects:${label}`,
    actorCharacterId, plan: {
      schema: "zhuwei.world-interaction-resolution-plan/v1", resolutionId: `resolution:effects:${label}`,
      interactionRef: `interaction:effects:${label}`, actorCharacterId, sceneRef: SCENE,
      abilityRef: null, contextHash: canonicalSha256({ label }),
      readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(world.state, ref) })),
      targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], basisRefs: [SOURCE],
      intent: "Touch the source.", method: "Touch the exposed surface.", ruling: { kind: "directSuccess" }, costs: [],
      branches: {
        success: { outcomeCode: `outcome:${label}`, summary: "The danger takes effect.",
          effects: [{ kind: "registeredHazard", sourceDefinitionRef: SOURCE, zoneRef: ZONE,
            damage: { kind: "authored", hazardDefinitionRef: hazardRef } }],
          sensoryEvidence: [], pressures: [], opportunities: [] },
        failure: { outcomeCode: `outcome:${label}:failure`, summary: "Nothing changes.", effects: [],
          sensoryEvidence: [], pressures: [], opportunities: [] },
      },
    } });
}

function advance(world, label, durationMicros, actorCharacterId = ACTOR) {
  return commit(world, { kind: "ruleWorldInteractionFeasibility", rootActionId: `advance:${label}`,
    actorCharacterId, plan: {
      schema: "zhuwei.world-interaction-feasibility-ruling-plan/v1", actorCharacterId,
      contextHash: canonicalSha256({ label }),
      readSet: [actorCharacterId, SOURCE, `character-timeline:${actorCharacterId}`].sort()
        .map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(world.state, ref) })),
      intent: "Open the secured route.", method: "Try without the required key.", rulingKind: "missingPrerequisite",
      publicBasis: "The route needs a key.", prerequisites: [{ kind: "tool", ref: null, description: "A key." }],
      nextActions: [{ description: "Find the key." }], basisRefs: [SOURCE],
      costs: [{ kind: "fictionTime", durationMicros }],
    } });
}

function conditions(world) {
  const projected = runtime.project(world.profiles, world.state, viewer);
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected.controlledCharacter.conditions;
}

function replay(world) {
  const result = runtime.replay(world.genesis, world.events);
  assert.equal(result.kind, "replayed", JSON.stringify(result));
  assert.deepEqual(result.state, world.state);
  return result;
}

test("a timed condition expires by committed fiction time while a different ongoing condition remains", () => {
  const world = initialize();
  const applied = applyHazard(world, "durations", [
    { kind: "grantEffect", condition: "poisoned", duration: { kind: "timed", durationMicros: "10000000" } },
    { kind: "grantEffect", condition: "deafened", duration: { kind: "untilEnded" } },
  ]);
  assert.equal(applied.events.filter((event) => event.eventType === "EffectApplied").length, 2);
  assert.equal(conditions(world).poisoned, true);
  assert.equal(conditions(world).deafened, true);
  advance(world, "before", "9999999");
  assert.equal(conditions(world).poisoned, true);
  const expired = advance(world, "exact", "1");
  assert.equal(expired.events.filter((event) => event.eventType === "EffectEnded").length, 1);
  assert.equal(conditions(world).poisoned, undefined);
  assert.equal(conditions(world).deafened, true);
  assert.equal(worldEffectIds(world.state, { targetEntityId: ACTOR, condition: "poisoned" }).length, 0);
  replay(world);
});

test("expiry removes its own source and does not erase another grant of the same condition", () => {
  const world = initialize();
  applyHazard(world, "overlap", [
    { kind: "grantEffect", condition: "blinded", duration: { kind: "timed", durationMicros: "1000000" } },
    { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  ]);
  advance(world, "overlap", "1000000");
  assert.equal(conditions(world).blinded, true);
  assert.equal(worldEffectIds(world.state, { targetEntityId: ACTOR, condition: "blinded" }).length, 1);
  assert.equal(effectiveConditions(replay(world).state, ACTOR).blinded, true);
});

test("a target turn boundary outside initiative expires after one canonical fiction round", () => {
  const world = initialize();
  applyHazard(world, "outside-turn", [
    { kind: "grantEffect", condition: "deafened",
      duration: { kind: "turnBoundary", subject: "target", edge: "turnEnd" } },
  ]);
  advance(world, "turn-before", "5999999");
  assert.equal(conditions(world).deafened, true);
  const ended = advance(world, "turn-end", "1");
  assert.equal(ended.events.filter((event) => event.eventType === "EffectEnded").length, 1);
  assert.equal(conditions(world).deafened, undefined);
  replay(world);
});

test("frozen condition immunity refuses only that grant without suppressing other hazard results", () => {
  const world = initialize(["poisoned"]);
  const before = world.state.entities[ACTOR].hitPoints.current;
  applyHazard(world, "immune", [
    { kind: "grantEffect", condition: "poisoned", duration: { kind: "untilEnded" } },
    { kind: "grantEffect", condition: "deafened", duration: { kind: "untilEnded" } },
  ]);
  assert.equal(conditions(world).poisoned, undefined);
  assert.equal(conditions(world).deafened, true);
  assert.equal(world.state.entities[ACTOR].hitPoints.current, before - 1);
  replay(world);
});


test("petrification rejects newly granted poison while other conditions can still apply", () => {
  const world = initialize();
  applyHazard(world, "stone-first", [
    { kind: "grantEffect", condition: "petrified", duration: { kind: "untilEnded" } },
  ]);
  const before = world.state.entities[ACTOR].hitPoints.current;
  applyHazard(world, "new-poison", [
    { kind: "grantEffect", condition: "poisoned", duration: { kind: "untilEnded" } },
    { kind: "grantEffect", condition: "deafened", duration: { kind: "untilEnded" } },
  ], HELPER);
  assert.equal(worldEffectIds(world.state, { targetEntityId: ACTOR, condition: "poisoned" }).length, 0);
  assert.equal(world.state.entities[ACTOR].hitPoints.current, before);
  assert.equal(conditions(world).deafened, true);
  replay(world);
});

test("existing poison pauses until the final overlapping petrification ends, then keeps its remaining duration", () => {
  const world = initialize();
  applyHazard(world, "old-poison", [
    { kind: "grantEffect", condition: "poisoned", duration: { kind: "timed", durationMicros: "10000000" } },
  ]);
  advance(world, "poison-elapsed", "2000000");
  applyHazard(world, "stone-overlap", [
    { kind: "grantEffect", condition: "petrified", duration: { kind: "timed", durationMicros: "5000000" } },
    { kind: "grantEffect", condition: "petrified", duration: { kind: "timed", durationMicros: "8000000" } },
  ]);
  advance(world, "one-stone-ended", "6000000", HELPER);
  assert.equal(conditions(world).petrified, true);
  assert.equal(worldEffectIds(world.state, { targetEntityId: ACTOR, condition: "poisoned" }).length, 1);
  advance(world, "last-stone-ended", "2000000", HELPER);
  assert.equal(conditions(world).petrified, undefined);
  assert.equal(conditions(world).poisoned, true);
  advance(world, "resumed-before", "7999999");
  assert.equal(conditions(world).poisoned, true);
  advance(world, "resumed-exact", "1");
  assert.equal(conditions(world).poisoned, undefined);
  replay(world);
});

test("waking from an unconscious grant preserves the independent fall prone", () => {
  const world = initialize();
  applyHazard(world, "asleep", [
    { kind: "grantEffect", condition: "unconscious", duration: { kind: "timed", durationMicros: "1000000" } },
  ]);
  assert.equal(conditions(world).prone, true);
  advance(world, "wake", "1000000", HELPER);
  assert.equal(conditions(world).unconscious, undefined);
  assert.equal(conditions(world).prone, true);
  replay(world);
});

test("one time advance beyond stone and resumed poison settles both at their actual deadlines", () => {
  const world = initialize();
  applyHazard(world, "jump-poison", [
    { kind: "grantEffect", condition: "poisoned", duration: { kind: "timed", durationMicros: "10000000" } },
  ]);
  advance(world, "jump-before-stone", "2000000");
  applyHazard(world, "jump-stone", [
    { kind: "grantEffect", condition: "petrified", duration: { kind: "timed", durationMicros: "5000000" } },
  ]);
  const ended = advance(world, "jump-past-both", "18000000", HELPER);
  assert.equal(conditions(world).petrified, undefined);
  assert.equal(conditions(world).poisoned, undefined);
  assert.equal(ended.events.filter((event) => event.eventType === "EffectEnded").length, 2);
  assert.equal(worldEffectIds(world.state, { targetEntityId: ACTOR }).length, 0);
  replay(world);
});
