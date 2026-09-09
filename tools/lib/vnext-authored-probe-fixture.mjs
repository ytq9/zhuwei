import { canonicalSha256 } from "../../app/_runtime/lib/rules/profiles/canonical.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createVersionedRulesRuntime } from "../../app/_runtime/lib/rules/v2-runtime.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { freezeAdjudicationContext } from "../../app/_runtime/lib/kp/vnext/context/index.ts";

export const PROBE_ACTOR = "character:probe-actor";
export const PROBE_TARGET = "character:probe-target";
export const PROBE_SCENE = "scene:probe-gallery";
export const PROBE_SOURCE = "definition:probe-valve";
export const PROBE_ZONE = "definition:probe-steam-zone";
const RELATION = "relation:probe-occupant";
const hash = (id) => ({ profileId: id, profileHash: canonicalSha256({ id }) });
// Explicit versioned authority for an isolated test room. Production supplies
// the registered module snapshot through Room prepare instead.
const probeModuleBody = {
  moduleId: "authored-probe", moduleVersion: "fixture-v1", compatibleRulesetVersion: "srd5.1-2014",
  moduleRef: { profileId: "module:authored-probe" }, title: "Authoring probe", tone: "bounded test",
  storyBible: { coreTruth: "The gallery is an isolated mechanical test scope.",
    contentBoundary: { tone: "bounded test", failureMeans: "Apply the frozen mechanics.", bannedPatterns: [] },
    storyAnchors: { chapters: [], locations: [], clues: [] }, importantNpcs: [],
    openBlanks: ["Unspecified objects, items and dangers may be authored within this gallery before outcomes are known."],
    initialPressures: [], sequelSignals: [] },
};
export const PROBE_MODULE_PROFILE = { ...probeModuleBody,
  moduleRef: { ...probeModuleBody.moduleRef, profileHash: canonicalSha256(probeModuleBody) } };
function character(id, hitPoints) {
  return { id, kind: "player", name: id, sceneId: PROBE_SCENE, tenureStatus: "active", classId: "fighter", raceId: "human", level: 1,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2, proficientSkills: [], resources: {}, resourceMaximums: {},
    hitPoints: { current: hitPoints, maximum: 20 }, loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: { classId: "fighter", raceId: "human", cantrips: [], prepared: [] } };
}
function semantic(kind, ref, content, policy = "visibility:scene-observers") {
  return storedSemanticDefinition(kind, policy, createDefinitionSnapshot(ref, "1", content));
}
/** Local isolated authority fixtures only; this never reads or changes a real Room. */
export function createAuthoredProbeFixture(caseId, { featureOverrides = {}, initialKnowledge = [], npcCharacters = [],
  semanticDefinitions = [], entityDefinitionBindings = [], canonicalFacts = [], additionalScenes = [], characterScenes = {} } = {}) {
  const runtime = createVersionedRulesRuntime({ registrations: [{ manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, interpreterKind: "authoritative-v2" }], defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest });
  const geometry = { schema: "zhuwei.tactical-geometry/v1", unit: "inch", boundary: { kind: "polygon", points: [{ x: "0", y: "0" }, { x: "600", y: "0" }, { x: "600", y: "600" }, { x: "0", y: "600" }] },
    spawnPoints: [{ x: "100", y: "100", elevation: "0" }, { x: "200", y: "100", elevation: "0" },
      ...npcCharacters.map((_, index) => ({ x: String(100 + index * 60), y: "160", elevation: "0" }))],
    obstacles: [{ featureId: "feature:probe-valve", kind: "barrier", label: "供汽阀门", state: "present", polygon: [{ x: "145", y: "95" }, { x: "155", y: "95" }, { x: "155", y: "105" }, { x: "145", y: "105" }],
      elevation: "0", height: "10", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal", visibilityPolicyId: "visibility:scene-observers", ...featureOverrides }], clearanceZones: [] };
  const seeded = runtime.step(undefined, undefined, { kind: "initializeAuthoritativeWorld", roomId: `room:authored-probe:${caseId}`, runtimeEpochId: `epoch:authored-probe:${caseId}`,
    moduleRef: PROBE_MODULE_PROFILE.moduleRef, initialDefinitionCatalogRef: hash("catalog:authored-probe"), activeBranchId: "branch:probe", fictionInstantMicros: "0",
    scenes: [{ id: PROBE_SCENE, name: "蒸汽廊道", geometry }, ...additionalScenes],
    principals: [{ id: "principal:probe-actor", sessionVersion: 1, role: "host" }, { id: "principal:probe-target", sessionVersion: 1, role: "player" }],
    seats: [{ id: "seat:probe-actor", principalId: "principal:probe-actor", status: "active" }, { id: "seat:probe-target", principalId: "principal:probe-target", status: "active" }],
    characters: [character(PROBE_ACTOR, 10), character(PROBE_TARGET, 20), ...npcCharacters.map(({ mechanical = true, ...npc }) => ({
      ...(mechanical ? character(npc.id, 20) : { sceneId: PROBE_SCENE, tenureStatus: "active" }), kind: "npc", ...npc,
    }))]
      .map(entity => ({ ...entity, sceneId: characterScenes[entity.id] ?? entity.sceneId })),
    characterControls: [{ characterId: PROBE_ACTOR, seatId: "seat:probe-actor" }, { characterId: PROBE_TARGET, seatId: "seat:probe-target" }], canonicalFacts, initialKnowledge,
    vNextSeed: { semanticDefinitions: [
      semantic("sceneFeature", PROBE_SOURCE, { sceneRef: PROBE_SCENE, label: "阀门", description: "生锈阀门发出细微嘶鸣。", mechanicDefinitionRefs: ["feature:probe-valve"], observableState: "ready", affordances: ["interact"] }),
      semantic("sceneFeature", PROBE_ZONE, { sceneRef: PROBE_SCENE, label: "喷流区域", description: "阀门附近的固定区域。", mechanicDefinitionRefs: ["feature:probe-valve"], observableState: "occupied", affordances: ["leave"] }),
      semantic("worldRelation", RELATION, { relationRef: RELATION, kind: "contains", subjectRef: PROBE_ZONE, objectRef: PROBE_TARGET, state: "active" }, "visibility:room-authority-only"),
      ...semanticDefinitions,
    ], itemDefinitions: [], itemEntries: [], entityDefinitionBindings } });
  if (seeded.kind !== "initialized") throw Object.assign(new Error("probe fixture initialization failed"), { code: "PROBE_FIXTURE_INITIALIZATION_FAILED", diagnostics: seeded });
  const replayed = runtime.replay(seeded.genesis, []);
  if (replayed.kind !== "replayed") throw Object.assign(new Error("probe fixture replay failed"), { code: "PROBE_FIXTURE_REPLAY_FAILED" });
  const state = replayed.state;
  const rootActionId = `root:authored-probe:${caseId}`;
  const fixture = { runtime, genesis: seeded.genesis, profiles: seeded.profiles, state, rootActionId, actorCharacterId: PROBE_ACTOR,
    moduleProfile: PROBE_MODULE_PROFILE,
    viewer: { kind: "player", principalId: "principal:probe-actor", seatId: "seat:probe-actor", sessionVersion: 1, characterId: PROBE_ACTOR } };
  const frozen = freezeAuthoredProbeContext(fixture, state, { rootActionId, focusRefs: [PROBE_SOURCE, PROBE_ZONE, PROBE_TARGET] });
  return { ...fixture, requiredContext: frozen.context };
}

/** Uses the production context collector against the same isolated authority. */
export function freezeAuthoredProbeContext(fixture, state, {
  rootActionId = `${fixture.rootActionId}:next`, focusRefs = [], intentText = "继续检查当前对象。",
} = {}) {
  const kpProjection = fixture.runtime.project(fixture.profiles, state, { kind: "kp", capability: "internal:kp-spatial-evidence" });
  if (kpProjection.kind !== "projected") throw Object.assign(new Error("probe KP projection failed"), { code: "PROBE_KP_PROJECTION_FAILED" });
  const npcProjections = Object.fromEntries(Object.values(state.entities).filter(entity => entity.kind === "npc" && entity.tenureStatus === "active")
    .map(entity => [entity.id, fixture.runtime.project(fixture.profiles, state, { kind: "npc", npcId: entity.id,
      purpose: "kpDecision", capability: "internal:npc-limited-knowledge" })]));
  const frozen = freezeAdjudicationContext({ state, profiles: fixture.profiles, kpProjection, npcProjections, moduleProfile: fixture.moduleProfile,
    replayHead: { eventSeq: state.version, stateHash: canonicalSha256(state) },
    preparedActionId: `prepared:${rootActionId}`, rootActionId, submissionRef: `submission:${rootActionId}`,
    actorCharacterId: fixture.actorCharacterId, intentText, focusRefs, maxUnits: 160_000 });
  if (frozen.kind !== "ready") throw Object.assign(new Error("probe context freezing failed"), {
    code: "PROBE_CONTEXT_BINDING_FAILED", diagnostics: { reason: frozen.reason, issues: frozen.issues },
  });
  return frozen;
}
