import assert from "node:assert/strict";
import { step, replay, project } from "../../app/_runtime/lib/rules/index.ts";
import { PRODUCTION_RUNTIME_PROFILE_REGISTRY } from "../../app/_runtime/lib/rules/profiles/registry.ts";
import { pinnedModuleRef } from "../../app/_runtime/lib/module/registry.ts";
import { canonicalSha256 } from "../../app/_runtime/lib/rules/profiles/canonical.ts";
import { createEventTransition, createScopeProof } from "../../app/_runtime/lib/rules/v2/events.ts";
import { storyTemporalEvidenceIssue, storyTemporalEvidenceRef } from "../../app/_runtime/lib/rules/v2/story-temporal-evidence.ts";
import { buildAuthoritativeArchive } from "../../app/_runtime/lib/room/archive.ts";
import { createVersionedRulesRuntime } from "../../app/_runtime/lib/rules/v2-runtime.ts";
import { createRuntimeProfileRegistry } from "../../app/_runtime/lib/rules/profiles/registry.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import { worldFactPointer } from "../../app/_runtime/lib/rules/v2/world-facts.ts";

export const ACTOR = "character:historical:original", OTHER = "character:historical:other";
export const BOATMAN = "npc:historical:boatman", ARCHIVIST = "npc:historical:archivist";
export const HARBOR = "scene:historical:harbor", LIBRARY = "scene:historical:library";
export const FACT = "fact:historical:old-event", ORIGIN = "fact:historical:origin";
export const PRINCIPAL = "principal:historical:original";
export const at = (timelineId, micros) => ({ kind: "at", start: { timelineId, micros }, end: null, basisRefs: [ORIGIN] });

export function geometry() {
  return { schema: "zhuwei.tactical-geometry/v1", unit: "inch",
    boundary: { kind: "polygon", points: [{ x: "0", y: "0" }, { x: "600", y: "0" }, { x: "600", y: "600" }, { x: "0", y: "600" }] },
    spawnPoints: ["100", "200", "300", "400"].map(x => ({ x, y: "100", elevation: "0" })),
    obstacles: [{ featureId: "feature:historical:low-wall", kind: "barrier", label: "矮墙", state: "intact",
      polygon: [{ x: "450", y: "450" }, { x: "500", y: "450" }, { x: "500", y: "500" }, { x: "450", y: "500" }],
      elevation: "0", height: "30", opaque: false, impassable: true, cover: "half", propagation: "passes", terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers" }], clearanceZones: [] };
}

/** Fixture-only typed event emitter, using Rules' real transition and replay
 * interpreter. Production materialization/Room dispatch has its own tests.
 * No event bytes, hashes or replayed states are repaired after generation. */
export function emit(f, rootActionId, eventType, payload, visibilityPolicyId = "visibility:kp-internal", secrecy = "internal") {
  if (eventType === "CanonicalFactDeclared" && payload.fact.kind === "storyTemporalEvidence") {
    assert.equal(storyTemporalEvidenceIssue(f.state, payload.fact.value), undefined);
  }
  const transition = createEventTransition(f.state, f.profiles, { rootActionId, eventType, payload,
    visibilityPolicyId, secrecy, scopeProof: createScopeProof(f.state, [], [`receipt:${rootActionId}`], []) });
  f.events.push(transition.event);
  const rebuilt = f.runtime.replay(f.genesis, f.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, transition.state);
  f.state = rebuilt.state;
  return transition.event;
}

export async function archive(f) {
  f.archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis,
    events: f.events, receiptRefs: [], projectionAudits: [] }, f.runtime.replay);
  return f.archive;
}

export async function createHistoricalWorldFixture({ beforeCut, beforeStory, afterStory, focus = HARBOR, semanticFact = false } = {}) {
  const config = { registrations: [{ manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, interpreterKind: "authoritative-v2" }],
    defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest };
  const runtime = semanticFact ? createVersionedRulesRuntime(config) : { step, replay, project };
  const registry = semanticFact ? createRuntimeProfileRegistry(config) : PRODUCTION_RUNTIME_PROFILE_REGISTRY;
  const initialized = runtime.step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld", roomId: "room:historical:source", runtimeEpochId: "epoch:historical:source",
    moduleRef: pinnedModuleRef("black-oak-will", "social-resolution-v1"),
    initialDefinitionCatalogRef: { profileId: "catalog:historical", profileHash: canonicalSha256("historical-test") },
    activeBranchId: "branch:historical:source", fictionInstantMicros: "100",
    scenes: [{ id: HARBOR, name: "码头", geometry: geometry() }, { id: LIBRARY, name: "档案馆", geometry: geometry() }],
    principals: [{ id: PRINCIPAL, sessionVersion: 1, role: "host" }, { id: "principal:historical:other", sessionVersion: 1, role: "player" }],
    seats: [{ id: "seat:historical:original", principalId: PRINCIPAL, status: "active" },
      { id: "seat:historical:other", principalId: "principal:historical:other", status: "active" }],
    characters: [{ id: ACTOR, kind: "player", name: "原主角", sceneId: HARBOR, tenureStatus: "active" },
      { id: OTHER, kind: "player", name: "另一名原角色", sceneId: LIBRARY, tenureStatus: "active" },
      { id: BOATMAN, kind: "npc", name: "船夫", sceneId: HARBOR, tenureStatus: "active" },
      { id: ARCHIVIST, kind: "npc", name: "档案管理员", sceneId: LIBRARY, tenureStatus: "active" }],
    characterControls: [{ characterId: ACTOR, seatId: "seat:historical:original" }, { characterId: OTHER, seatId: "seat:historical:other" }],
    canonicalFacts: [{ id: ORIGIN, kind: "worldHistory", subjectRefs: [HARBOR, LIBRARY], value: "两地居民互有来往。", visibilityPolicyId: "visibility:public", source: "moduleAnchor" }],
    initialKnowledge: [{ characterId: ACTOR, knowledgeRef: "knowledge:historical:old-private", kind: "sourceClaim", layer: "full",
      content: "ORIGINAL-PLAYER-PRIVATE-KNOWLEDGE", visibility: "private", provenanceChain: ["genesis:old-player-private"] }],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const initial = runtime.replay(initialized.genesis, []); assert.equal(initial.kind, "replayed", JSON.stringify(initial));
  const f = { genesis: initialized.genesis, profiles: initialized.profiles, state: initial.state, events: [],
    registry, runtime };
  f.run = input => {
    const result = f.runtime.step(f.profiles, f.state, input);
    assert.ok(["committed", "awaitingInput", "awaitingRandomness"].includes(result.kind), JSON.stringify(result));
    f.events.push(...result.events);
    const rebuilt = f.runtime.replay(f.genesis, f.events); assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
    assert.deepEqual(rebuilt.state, result.state); f.state = rebuilt.state; return result;
  };
  const advance = (id, duration, root) => f.run({ kind: "resolveFreeAction", proposalId: root, characterId: id,
    goal: "整理资料", method: "安静整理", feasibility: { kind: "directSuccess", publicBasis: "资料可直接整理。" }, outcome: { fictionTimeCostMicros: duration } });
  advance(ACTOR, "200", "root:historical:harbor-time"); advance(OTHER, "50", "root:historical:library-time");
  beforeCut?.(f);
  f.cutState = structuredClone(f.state); f.cutSeq = f.state.version;
  advance(OTHER, "150", "root:historical:later-library-time");
  beforeStory?.(f);
  const root = "root:historical:story";
  const definitionRef = `definition:materialized:${"1".repeat(32)}`;
  f.factRef = semanticFact ? `fact:${definitionRef}` : FACT;
  if (semanticFact) {
    const template = VNEXT_SEMANTIC_TEMPLATES.worldFact;
    f.worldFactDefinition = storedSemanticDefinition("worldFact", "visibility:hidden-until-evidence",
      createDefinitionSnapshot(definitionRef, "1", { label: "征船事件", description: "药船曾被地方守军征用。",
        worldFact: { historyCoverage: null, subjectRefs: [BOATMAN, ARCHIVIST], occurrence: "此刻之前的征船事件。",
          consistency: { judgment: "compatible", explanation: "此前未写下的个人经历。" }, initialKnowledge: [BOATMAN, ARCHIVIST].map(holderRef => ({ holderRef,
            acquisitionBasisRefs: [holderRef], acquisitionExplanation: "本人曾经接触这次事件。" })) } }),
      { templateRef: template.templateRef, templateHash: template.templateHash });
    emit(f, root, "SemanticDefinitionMaterialized", { actorCharacterId: ACTOR, bundleHash: canonicalSha256("fixture-bundle"),
      prospectiveRef: `prospective:${"2".repeat(32)}`, definitionRef, semanticKind: "worldFact",
      templateRef: template.templateRef, templateHash: template.templateHash, contextHash: canonicalSha256("fixture-context"),
      basisRefs: [ORIGIN], sourceRefs: [ORIGIN], summary: "将未记载的过往经历固化。", definition: f.worldFactDefinition });
  }
  emit(f, root, "CanonicalFactDeclared", { fact: { id: f.factRef, kind: semanticFact ? "worldFact" : "hiddenReality", subjectRefs: [BOATMAN, ARCHIVIST],
    value: semanticFact ? worldFactPointer(f.worldFactDefinition) : "药船曾被地方守军征用。",
    visibilityPolicyId: "visibility:hidden-until-evidence", source: "dynamicMaterialization", causalParentIds: [ORIGIN] } });
  for (const holder of [BOATMAN, ARCHIVIST]) {
    if (semanticFact) emit(f, root, "KnowledgeAcquired", { characterId: holder, knowledgeRef: f.factRef,
      objectKind: "canonicalFact", layer: "full", content: worldFactPointer(f.worldFactDefinition), causeFactId: f.factRef,
      acquisition: { sense: "memory", sceneId: f.state.entities[holder].sceneId, method: "本人曾经接触这次事件。" }, visibility: "private" },
    `visibility:knowledge-holder:${holder}`, "private");
    else emit(f, root, "SensoryEvidenceAcquired", { characterId: holder, factId: f.factRef,
      sense: "hearing", clarity: "obvious", publicEvidence: holder === BOATMAN ? "记得过去征船的亲历。" : "FUTURE-ARCHIVIST-KNOWLEDGE" },
    `visibility:knowledge-holder:${holder}`, "private");
  }
  f.evidence = { schema: "zhuwei.story-temporal-evidence/v1", preparationHash: canonicalSha256("frozen-preparation"),
    candidateRef: "candidate:historical:fact", factRef: f.factRef,
    occurrence: at(f.cutState.multiplayerRuntime.characterTimelineIds[BOATMAN], "50"),
    knowledge: [{ candidateRef: "candidate:knowledge:boatman", holderRef: BOATMAN, knowledgeRef: f.factRef, sourceRef: f.factRef, layer: semanticFact ? "truth" : "sensoryEvidence",
      acquisition: at(f.cutState.multiplayerRuntime.characterTimelineIds[BOATMAN], "80") },
    { candidateRef: "candidate:knowledge:archivist", holderRef: ARCHIVIST, knowledgeRef: f.factRef, sourceRef: f.factRef, layer: semanticFact ? "truth" : "sensoryEvidence",
      acquisition: at(f.cutState.multiplayerRuntime.characterTimelineIds[ARCHIVIST], "200") }] };
  f.evidenceRef = storyTemporalEvidenceRef(f.evidence.preparationHash, f.evidence.candidateRef);
  emit(f, root, "CanonicalFactDeclared", { fact: { id: f.evidenceRef, kind: "storyTemporalEvidence", subjectRefs: [f.factRef],
    value: f.evidence, visibilityPolicyId: "visibility:kp-internal", source: "dynamicMaterialization", causalParentIds: [f.factRef] } });
  afterStory?.(f);
  emit(f, "root:historical:future", "CanonicalFactDeclared", { fact: { id: "fact:historical:future", kind: "hiddenReality", subjectRefs: [BOATMAN],
    value: "ORIGINAL-FUTURE-OUTCOME", visibilityPolicyId: "visibility:hidden-until-evidence", source: "dynamicMaterialization", causalParentIds: [f.factRef] } });
  await archive(f);
  f.input = { kind: "initializeHistoricalWorld", schema: "zhuwei.historical-world-initialization/v1",
    roomId: "room:historical:target", runtimeEpochId: "epoch:historical:target", activeBranchId: "branch:historical:target", sourceArchive: f.archive,
    cut: { eventSeq: f.cutSeq, focusSceneId: focus }, identity: { principal: { id: PRINCIPAL, sessionVersion: 2 },
      seatId: "seat:historical:new", character: { id: "character:historical:new", kind: "player", name: "当地医师", sceneId: focus, tenureStatus: "active" }, originBasisRefs: [ORIGIN] } };
  return f;
}
