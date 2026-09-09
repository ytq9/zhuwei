import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { initializeHistoricalWorld, isHistoricalOrigin } from "../app/_runtime/lib/rules/v2/historical-world.ts";
import { isAuthoritativeWorldState, hashWorldState } from "../app/_runtime/lib/rules/v2/validation.ts";
import { isStoryTemporalBasis, isStoryTemporalEvidence, storyTemporalEvidenceIssue,
  storyTemporalEvidenceRef } from "../app/_runtime/lib/rules/v2/story-temporal-evidence.ts";
import { worldFactDefinition, worldFactPointer } from "../app/_runtime/lib/rules/v2/world-facts.ts";
import { prepareNpcActorPlanFormation } from "../app/_runtime/lib/rules/v2/npc-plan-formation.ts";
import { scheduledActorPlanDescriptors } from "../app/_runtime/lib/rules/v2/actor-plans.ts";
import { createHistoricalWorldFixture, ACTOR, OTHER, BOATMAN, ARCHIVIST, HARBOR, LIBRARY, FACT, ORIGIN, PRINCIPAL,
  emit, archive } from "./fixtures/historical-world.mjs";

const initialize = (f, input = f.input) => initializeHistoricalWorld(f.registry, undefined, undefined, input, f.runtime.replay);
const initialized = (f, input = f.input) => {
  const result = initialize(f, input); assert.equal(result.kind, "initialized", JSON.stringify(result)); return result;
};
function rehashArchive(value) {
  const { archiveHash: _archiveHash, ...body } = value;
  value.archiveHash = canonicalSha256(body);
}

test("public Rules step initializes historical genesis and replay preserves later target changes independently", async () => {
  for (const semanticFact of [false, true]) {
    const f = await createHistoricalWorldFixture({ semanticFact }), source = structuredClone(f.archive);
    const result = f.runtime.step(undefined, undefined, f.input);
    assert.equal(result.kind, "initialized", JSON.stringify(result));
    assert.equal(isHistoricalOrigin(result.genesis.historicalOrigin), true);
    assert.deepEqual(result.events, []);
    const restored = f.runtime.replay(structuredClone(result.genesis), []);
    assert.equal(restored.kind, "replayed", JSON.stringify(restored));
    assert.deepEqual(restored.state, result.genesis.initialState);
    assert.deepEqual(restored.profiles, result.profiles);
    assert.equal(restored.state.roomId, f.input.roomId);
    assert.equal(restored.state.canonicalFacts["fact:historical:future"], undefined);
    assert.equal(restored.state.knowledge[ARCHIVIST][f.factRef], undefined);
    const changed = f.runtime.step(result.profiles, restored.state, {
      kind: "declareCanonicalFact", proposalId: "root:public-history:choice",
      fact: { factId: "fact:public-history:outcome", factKind: "worldOutcome", subjectRefs: [BOATMAN],
        value: "新身份说服守军归还药船。", source: "characterAction", causalParentIds: [f.factRef], visibilityPolicy: "public" },
    });
    assert.equal(changed.kind, "committed", JSON.stringify(changed));
    const replayed = f.runtime.replay(structuredClone(result.genesis), structuredClone(changed.events));
    assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
    assert.deepEqual(replayed.state, changed.state);
    assert.deepEqual(f.archive, source);
    const original = f.runtime.replay(f.genesis, f.events);
    assert.equal(original.kind, "replayed", JSON.stringify(original));
    assert.deepEqual(original.state, f.state);
    assert.equal(original.state.canonicalFacts["fact:public-history:outcome"], undefined);
    const forged = structuredClone(result.genesis);
    forged.historicalOrigin.identity.seedHash = canonicalSha256("a different historical identity");
    assert.equal(f.runtime.replay(forged, []).kind, "rejected");
  }
});

test("historical genesis preserves two clocks, late past truth and only already acquired knowledge", async () => {
  const f = await createHistoricalWorldFixture(), before = structuredClone({ state: f.state, events: f.events, genesis: f.genesis });
  const result = initialized(f), state = result.genesis.initialState;
  assert.equal(isAuthoritativeWorldState(state), true);
  assert.equal(state.version, "0"); assert.equal(state.lastEventId, null);
  assert.equal(state.roomId, f.input.roomId); assert.equal(state.runtimeEpochId, f.input.runtimeEpochId);
  assert.equal(state.activeBranchId, f.input.activeBranchId);
  assert.equal(state.fictionTimelines[state.multiplayerRuntime.characterTimelineIds[BOATMAN]].nowMicros, "300");
  assert.equal(state.fictionTimelines[state.multiplayerRuntime.characterTimelineIds[ARCHIVIST]].nowMicros, "150");
  assert.equal(state.multiplayerRuntime.characterTimelineIds[f.input.identity.character.id], state.multiplayerRuntime.characterTimelineIds[BOATMAN]);
  assert.equal(state.canonicalFacts[FACT].value, f.state.canonicalFacts[FACT].value);
  assert.equal(state.knowledge[BOATMAN][FACT].acquiredAtFictionMicros, "80");
  assert.equal(state.knowledge[ARCHIVIST][FACT], undefined);
  assert.equal(state.canonicalFacts["fact:historical:future"], undefined);
  assert.equal(state.canonicalFacts[f.evidenceRef], undefined);
  assert.ok(!JSON.stringify(state).includes("ORIGINAL-FUTURE-OUTCOME"));
  assert.ok(!JSON.stringify(state).includes("FUTURE-ARCHIVIST-KNOWLEDGE"));
  assert.deepEqual(f.state, before.state); assert.deepEqual(f.events, before.events); assert.deepEqual(f.genesis, before.genesis);
});

test("a different starting scene uses the same initializer and preserves the original players without inheriting control", async () => {
  const f = await createHistoricalWorldFixture({ focus: LIBRARY });
  const result = initialized(f), state = result.genesis.initialState, freshId = f.input.identity.character.id;
  assert.equal(state.entities[ACTOR].kind, "player"); assert.equal(state.entities[OTHER].kind, "player");
  assert.equal(state.entities[BOATMAN].kind, "npc");
  assert.deepEqual(Object.keys(state.principals), [PRINCIPAL]);
  assert.equal(state.principals[PRINCIPAL].sessionVersion, 2);
  assert.deepEqual(Object.keys(state.characterControls), [freshId]);
  assert.deepEqual(Object.keys(state.seats), [f.input.identity.seatId]);
  assert.equal(state.combatRuntime.entities[ACTOR].controllerPrincipalId, undefined);
  assert.equal(state.combatRuntime.entities[OTHER].controllerPrincipalId, undefined);
  assert.equal(state.combatRuntime.entities[freshId].controllerPrincipalId, PRINCIPAL);
  assert.deepEqual(state.knowledge[freshId], {});
  assert.equal(state.knowledge[ACTOR]["knowledge:historical:old-private"].content, "ORIGINAL-PLAYER-PRIVATE-KNOWLEDGE");
  assert.deepEqual(state.receipts, {}); assert.deepEqual(state.internalContinuations, {});
  assert.deepEqual(state.correctionRuntime.audit, {});
  assert.notEqual(state.correctionRuntime.authorityCapability, f.cutState.correctionRuntime.authorityCapability);
  assert.notEqual(state.multiplayerRuntime.roomAdministrationCapability, f.cutState.multiplayerRuntime.roomAdministrationCapability);
  assert.equal(state.multiplayerRuntime.characterTimelineIds[freshId], state.multiplayerRuntime.characterTimelineIds[ARCHIVIST]);
  const positions = Object.values(state.combatRuntime.entities).filter(e => e.sceneId === LIBRARY).map(e => JSON.stringify(e.position));
  assert.equal(new Set(positions).size, positions.length);
  const viewer = { kind: "player", principalId: PRINCIPAL, sessionVersion: 2, seatId: f.input.identity.seatId, characterId: freshId };
  const visible = f.runtime.project(result.profiles, state, viewer);
  assert.equal(visible.kind, "projected", JSON.stringify(visible));
  assert.ok(!JSON.stringify(visible).includes("ORIGINAL-PLAYER-PRIVATE-KNOWLEDGE"));
  assert.equal(f.runtime.project(result.profiles, state, { ...viewer, characterId: ACTOR }).kind, "rejected");
});

test("genesis commits exact source lineage and repeats deterministically without source mutation", async () => {
  const f = await createHistoricalWorldFixture(), a = initialized(f), b = initialized(f);
  assert.deepEqual(a, b); assert.equal(isHistoricalOrigin(a.genesis.historicalOrigin), true);
  const { genesisHash, ...unsigned } = a.genesis;
  assert.equal(canonicalSha256(unsigned), genesisHash);
  assert.equal(hashWorldState(a.genesis.initialState), a.genesis.initialStateHash);
  assert.equal(a.genesis.initialState.eventHeadHash, a.genesis.initialStateHash);
  assert.equal(a.genesis.historicalOrigin.source.archiveHash, f.archive.archiveHash);
  assert.equal(a.genesis.historicalOrigin.cut.stateHash, hashWorldState(f.cutState));
  assert.equal(a.genesis.historicalOrigin.supplements[0].knowledge.length, 1);
  assert.equal(a.genesis.historicalOrigin.supplements[0].knowledge[0].holderRef, BOATMAN);
  const changed = structuredClone(unsigned); changed.historicalOrigin.identity.seedHash = canonicalSha256("other-seed");
  assert.notEqual(canonicalSha256(changed), genesisHash);
  for (const mutate of [o => { o.extra = true; }, o => { o.timelineMap.push(o.timelineMap[0]); },
    o => { o.source.archiveHash = "bad"; }, o => { o.cut.eventSeq = "99999"; }]) {
    const origin = structuredClone(a.genesis.historicalOrigin); mutate(origin); assert.equal(isHistoricalOrigin(origin), false);
  }
});

test("target actions can produce a different later result while the source future stays unchanged", async () => {
  const f = await createHistoricalWorldFixture(), result = initialized(f), state = result.genesis.initialState;
  const changed = f.runtime.step(result.profiles, state, { kind: "declareCanonicalFact", proposalId: "root:new-history:choice",
    fact: { factId: "fact:new-history:outcome", factKind: "worldOutcome", subjectRefs: [BOATMAN],
      value: "新身份说服守军归还药船。", source: "characterAction", causalParentIds: [FACT], visibilityPolicy: "public" } });
  assert.equal(changed.kind, "committed", JSON.stringify(changed));
  assert.equal(changed.events[0].runtimeEpochId, f.input.runtimeEpochId);
  assert.equal(changed.events[0].eventSeq, "1"); assert.equal(changed.events[0].parentEventId, null);
  assert.equal(changed.events[0].previousEventHash, result.genesis.initialStateHash);
  assert.equal(f.state.canonicalFacts["fact:historical:future"].value, "ORIGINAL-FUTURE-OUTCOME");
  assert.equal(f.state.canonicalFacts["fact:new-history:outcome"], undefined);
});

test("archive corruption and a lying source head fail before target initialization", async () => {
  const f = await createHistoricalWorldFixture();
  for (const mutate of [
    i => { i.sourceArchive.events.at(-1).payload.fact.value = "tampered"; },
    i => { i.sourceArchive.events.at(-1).payload.fact.value = "tampered"; rehashArchive(i.sourceArchive); },
    i => { i.sourceArchive.head.stateHash = canonicalSha256("wrong"); rehashArchive(i.sourceArchive); },
    i => { i.sourceArchive.signedGenesis.initialState.entities[BOATMAN].name = "tampered"; rehashArchive(i.sourceArchive); },
  ]) {
    const input = structuredClone(f.input); mutate(input);
    const result = initialize(f, input); assert.equal(result.kind, "rejected"); assert.equal(result.rejection.code, "archiveIntegrityMismatch");
    assert.deepEqual(result.events, []);
  }
});

test("cuts inside a source action, beyond history or across an unresolved input are rejected", async () => {
  const f = await createHistoricalWorldFixture();
  const internal = structuredClone(f.input); internal.cut.eventSeq = f.events.find(e => e.eventType === "SensoryEvidenceAcquired").eventSeq;
  assert.equal(initialize(f, internal).rejection.code, "pendingInputUnresolved");
  const future = structuredClone(f.input); future.cut.eventSeq = "10000";
  assert.equal(initialize(f, future).kind, "rejected");
  f.run({ kind: "resolveFreeAction", proposalId: "root:historical:pending", characterId: ACTOR,
    goal: "寻找目标", method: "需要说明", feasibility: { kind: "clarificationRequired", publicBasis: "目标尚不明确。",
      choices: [{ choiceId: "harbor", label: "码头" }, { choiceId: "library", label: "档案馆" }] } });
  await archive(f);
  const pending = structuredClone(f.input); pending.sourceArchive = f.archive; pending.cut.eventSeq = f.state.version;
  assert.equal(initialize(f, pending).rejection.code, "pendingInputUnresolved");
});

test("same room, epoch, branch, prior character, copied payload, seat and absent origin cannot become a new identity", async () => {
  const f = await createHistoricalWorldFixture();
  for (const mutate of [i => { i.roomId = f.archive.roomId; }, i => { i.runtimeEpochId = f.genesis.runtimeEpochId; },
    i => { i.activeBranchId = f.state.activeBranchId; }, i => { i.identity.character.id = ACTOR; },
    i => { i.identity.character.copyOf = BOATMAN; }, i => { i.identity.character.uniqueItemRef = "item:old-unique"; },
    i => { i.identity.seatId = "seat:historical:original"; }, i => { i.identity.character.lastControllerSeatId = "seat:historical:original"; },
    i => { i.identity.originBasisRefs = ["fact:not-established"]; }, i => { i.identity.character.sceneId = LIBRARY; },
    i => { i.targetState = f.cutState; }]) {
    const input = structuredClone(f.input); mutate(input); const result = initialize(f, input);
    assert.equal(result.kind, "rejected", JSON.stringify(input)); assert.deepEqual(result.events, []);
  }
  assert.equal(initializeHistoricalWorld(f.registry, undefined, f.state, f.input, f.runtime.replay).kind, "rejected");
});

test("typed occurrence/acquisition validates real holder, layer, source and causality independently", async () => {
  const f = await createHistoricalWorldFixture();
  assert.equal(isStoryTemporalEvidence(f.evidence), true); assert.equal(storyTemporalEvidenceIssue(f.state, f.evidence), undefined);
  for (const mutate of [e => { e.knowledge[0].holderRef = ACTOR; }, e => { e.knowledge[0].layer = "truth"; },
    e => { e.knowledge[0].sourceRef = "knowledge:unknown"; }, e => { e.factRef = ORIGIN; },
    e => { e.knowledge[0].acquisition.start.micros = "40"; }, e => { e.knowledge[0].acquisition.start.micros = "9999"; },
    e => { e.occurrence.start.timelineId = "timeline:missing"; }, e => { e.knowledge.push(e.knowledge[0]); }]) {
    const changed = structuredClone(f.evidence); mutate(changed);
    assert.equal(typeof storyTemporalEvidenceIssue(f.state, changed), "string");
  }
  const invalidRange = { ...structuredClone(f.evidence.occurrence), kind: "between", end: { timelineId: "other", micros: "49" } };
  assert.equal(isStoryTemporalBasis(invalidRange), false);
  assert.equal(isStoryTemporalEvidence({ ...f.evidence, extra: true }), false);
});

test("duplicate protocol binding cannot give the same historical fact a second retrospective date", async () => {
  const f = await createHistoricalWorldFixture({ afterStory(f) {
    const value = { ...f.evidence, candidateRef: "candidate:other-binding" };
    emit(f, "root:historical:story", "CanonicalFactDeclared", { fact: {
      id: storyTemporalEvidenceRef(value.preparationHash, value.candidateRef), kind: "storyTemporalEvidence", subjectRefs: [FACT],
      value, visibilityPolicyId: "visibility:kp-internal", source: "dynamicMaterialization", causalParentIds: [FACT] } });
  } });
  assert.equal(initialize(f).rejection.code, "archiveIntegrityMismatch");
});

test("a later evidence action cannot retrospectively relabel an earlier fact", async () => {
  const f = await createHistoricalWorldFixture();
  const input = structuredClone(f.input);
  // Removing an earlier event or rewriting its root does not create a new
  // source proof even when the outer archive commitment is recalculated.
  input.sourceArchive.events.find(e => e.eventType === "CanonicalFactDeclared" && e.payload.fact.id === FACT).rootActionId = "other-root";
  rehashArchive(input.sourceArchive);
  assert.equal(initialize(f, input).rejection.code, "archiveIntegrityMismatch");
});

test("late worldFact definitions get a derived revision with future holder metadata removed and all pointers rebound", async () => {
  const f = await createHistoricalWorldFixture({ semanticFact: true }), original = structuredClone(f.worldFactDefinition);
  const result = initialized(f), state = result.genesis.initialState;
  const definition = worldFactDefinition(state, state.canonicalFacts[f.factRef]);
  assert.ok(definition); assert.equal(definition.revision, "2");
  assert.equal(definition.content.description, original.content.description);
  assert.deepEqual(definition.content.worldFact.initialKnowledge.map(k => k.holderRef), [BOATMAN]);
  assert.equal(state.knowledge[ARCHIVIST][f.factRef], undefined);
  assert.equal(state.knowledge[BOATMAN][f.factRef].objectKind, "canonicalFact");
  assert.deepEqual(state.knowledge[BOATMAN][f.factRef].content, worldFactPointer(definition));
  assert.deepEqual(state.canonicalFacts[f.factRef].value, worldFactPointer(definition));
  assert.deepEqual(f.state.campaignRuntime.definitions[original.definitionId], original);
  assert.equal(original.content.worldFact.initialKnowledge.length, 2);
  const derivation = result.genesis.historicalOrigin.supplements[0].definitions[0];
  assert.equal(derivation.sourceHash, original.definitionHash); assert.equal(derivation.targetHash, definition.definitionHash);
  assert.notEqual(derivation.sourceHash, derivation.targetHash);
});

test("scheduled NPC world plans and their scheduling activities survive and use the new scene clock", async () => {
  const f = await createHistoricalWorldFixture({ beforeCut(f) {
    const planned = prepareNpcActorPlanFormation(f.state, { kind: "formNpcActorPlan", npcId: BOATMAN, factionRef: null,
      planId: "plan:historical:boatman", goal: "修复拦船绳", nextStep: "在码头检查绳索。", premiseRefs: [BOATMAN], resourceRefs: [],
      activity: { activityId: "activity:historical:boatman", activityKind: "npcActorPlan", intendedDurationMicros: "1000" },
      due: { kind: "fictionTime", atFictionMicros: "1300" }, trigger: null,
      trace: { factRef: "fact:historical:rope", description: "码头出现修复的绳索。", visibilityPolicyRef: "visibility:scene-observers" },
      alternateTarget: { targetRef: HARBOR, reason: "检查码头其他绳索。" } });
    assert.equal(planned.kind, "accepted", JSON.stringify(planned));
    for (const draft of planned.drafts) emit(f, "root:historical:plan", draft.eventType, draft.payload, draft.visibilityPolicyId, draft.secrecy);
  } });
  const result = initialized(f), state = result.genesis.initialState;
  assert.deepEqual(state.campaignRuntime.npcPlans, f.cutState.campaignRuntime.npcPlans);
  assert.equal(state.campaignRuntime.activities["activity:historical:boatman"].status, "active");
  const descriptors = scheduledActorPlanDescriptors(state);
  assert.equal(descriptors.length, 1); assert.equal(descriptors[0].completionFictionMicros, "1300");
  assert.equal(descriptors[0].timelineId, state.multiplayerRuntime.characterTimelineIds[BOATMAN]);
  assert.ok(descriptors[0].timelineId.includes(f.input.activeBranchId));
});

test("an in-progress mechanical Activity is an unsupported cut rather than silently being erased", async () => {
  const f = await createHistoricalWorldFixture();
  emit(f, "root:historical:unfinished-work", "ActivityStarted", { activityId: "activity:historical:unfinished", characterId: ACTOR,
    activityKind: "investigation", intendedDurationMicros: "1000", completion: { kind: "fact", content: "调查完成后才得到的结果。" } });
  await archive(f);
  const input = structuredClone(f.input); input.sourceArchive = f.archive; input.cut.eventSeq = f.state.version;
  const result = initialize(f, input);
  assert.equal(result.kind, "rejected"); assert.equal(result.rejection.code, "pendingInputUnresolved");
  assert.equal(f.state.campaignRuntime.activities["activity:historical:unfinished"].status, "active");
});

test("a later complete cut inherits already experienced facts and knowledge without reimporting their creation snapshots", async () => {
  const f = await createHistoricalWorldFixture({ semanticFact: true });
  const input = structuredClone(f.input); input.cut.eventSeq = f.state.version;
  const result = initialized(f, input), state = result.genesis.initialState;
  assert.equal(result.genesis.historicalOrigin.supplements.length, 0);
  assert.equal(state.knowledge[ARCHIVIST][f.factRef].objectKind, "canonicalFact");
  assert.equal(worldFactDefinition(state, state.canonicalFacts[f.factRef]).revision, "1");
  assert.equal(state.canonicalFacts["fact:historical:future"].value, "ORIGINAL-FUTURE-OUTCOME");
  assert.equal(state.canonicalFacts[f.evidenceRef], undefined);
});
