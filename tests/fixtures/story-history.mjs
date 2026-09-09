import assert from "node:assert/strict";
import { step, replay, project } from "../../app/_runtime/lib/rules/index.ts";
import { pinnedModuleRef } from "../../app/_runtime/lib/module/registry.ts";
import { archiveSha256, buildAuthoritativeArchive } from "../../app/_runtime/lib/room/archive.ts";

export const ACTOR = "character:history:original";
export const OTHER = "character:history:other";
export const BOATMAN = "npc:history:boatman";
export const ARCHIVIST = "npc:history:archivist";
export const HARBOR = "scene:history:harbor";
export const LIBRARY = "scene:history:library";
export const ACCESS = { principalId: "principal:history:original", authorizationVersion: "7" };
const profile = pinnedModuleRef("black-oak-will", "social-resolution-v1");
const versionRef = { id: "story-history-fixture", version: "1", hash: `sha256:${"1".repeat(64)}` };
export const at = (timelineId, micros) => ({ kind: "at", start: { timelineId, micros }, end: null, basisRefs: ["fact:history:origin"] });
function geometry(sceneId) {
  return { schema: "zhuwei.tactical-geometry/v1", unit: "inch",
    boundary: { kind: "polygon", points: [{ x: "0", y: "0" }, { x: "600", y: "0" }, { x: "600", y: "600" }, { x: "0", y: "600" }] },
    spawnPoints: [{ x: "100", y: "100", elevation: "0" }, { x: "200", y: "100", elevation: "0" }],
    obstacles: [{ featureId: `feature:history:${sceneId}`, kind: "barrier", label: "矮墙", state: "intact",
      polygon: [{ x: "400", y: "400" }, { x: "450", y: "400" }, { x: "450", y: "450" }, { x: "400", y: "450" }],
      elevation: "0", height: "30", opaque: false, impassable: true, cover: "half", propagation: "passes", terrain: "normal",
      visibilityPolicyId: "visibility:scene-observers" }], clearanceZones: [] };
}

function preparation(fixture, subject, label, factRef, holders) {
  const occurrence = at(fixture.cutState.multiplayerRuntime.characterTimelineIds[subject], "50");
  const knowledge = holders.map(({ holder, time }, index) => ({
    ref: `knowledge:prepared:${index}`, holderRef: holder, factRef: "candidate:history", layer: "sensoryEvidence",
    content: `${label}的亲历证据`, sourceRef: factRef,
    acquisition: at(fixture.cutState.multiplayerRuntime.characterTimelineIds[holder], time), explanation: "本人真实接触所得。",
  }));
  return {
    format: "zhuwei.story-preparation/v1", jobId: `job:${label}`, version: "1",
    requestHash: versionRef.hash, contextHash: versionRef.hash, recipeRefs: [versionRef],
    title: label, cause: "地方已有冲突产生可行动的局面。", centralQuestion: "当事人如何解决争端？", worldConnection: "源自同一地方人物。",
    existingFactRefs: ["fact:history:origin"],
    facts: [{ ref: "candidate:history", layer: label === "档案调查" ? "statement" : "worldTruth", content: label,
      subjectRefs: [subject], occurrence, basisRefs: ["fact:history:origin"], creationBasis: "authorizedOpenSpace", knowledge }],
    participants: [{ ref: subject, identity: "existing", label: subject, participationReason: "亲历过该事件。", goal: "解决当地问题。",
      concerns: ["承诺"], resources: ["经验"], relationships: [], knowledgeRefs: knowledge.map(entry => entry.ref), nextIntention: "等待交谈机会。", voice: "简洁" }],
    definitions: [], opportunities: [{ ref: "opportunity:history", contact: "在当地接触当事人。", understandableStake: "帮助当地居民。", basisRefs: [subject] }],
    scenes: [{ ref: "scene:prepared", locationRef: fixture.cutState.entities[subject].sceneId, question: "是否能够查明情况？", space: "公共场所。",
      interactables: [], pressure: "窗口有限。", exitConditions: ["问题回答"], participation: "每人可提出做法。" }],
    evidence: [], developments: [{ ref: "development:prepared", actorRef: subject, intention: "寻求帮助。", trigger: "有人主动交谈。",
      basisRefs: [subject], knowledgeRefs: knowledge.map(entry => entry.ref), observableTraces: ["有人求助。"], changeConditions: ["问题解决"], execution: "pendingWorldAdjudication" }],
    resolutions: [{ ref: "resolution:prepared", condition: "争端得到解决。", result: "各方依照选择行动。", persistentConsequences: ["保留关系变化。"] }],
    stages: [], notApplicable: [{ path: "evidence", reason: "本样例验证历史材料传递。" }], hostingNotes: "接受其他合理方法。",
  };
}

export async function createHistoryFixture(variant = "boat") {
  const initialized = step(undefined, undefined, {
    kind: "initializeAuthoritativeWorld", roomId: `room:history:${variant}`, runtimeEpochId: `epoch:history:${variant}`,
    moduleRef: profile, initialDefinitionCatalogRef: { profileId: "catalog:history", profileHash: versionRef.hash },
    activeBranchId: "branch:history", fictionInstantMicros: "100",
    scenes: [{ id: HARBOR, name: "码头", geometry: geometry(HARBOR) }, { id: LIBRARY, name: "档案馆", geometry: geometry(LIBRARY) }],
    principals: [{ id: ACCESS.principalId, sessionVersion: 1, role: "host" }, { id: "principal:history:other", sessionVersion: 1, role: "player" }],
    seats: [{ id: "seat:history:original", principalId: ACCESS.principalId, status: "active" },
      { id: "seat:history:other", principalId: "principal:history:other", status: "active" }],
    characters: [
      { id: ACTOR, kind: "player", name: "原团主角", sceneId: HARBOR, tenureStatus: "active" },
      { id: OTHER, kind: "player", name: "另一名角色", sceneId: LIBRARY, tenureStatus: "active" },
      { id: BOATMAN, kind: "npc", name: "原有船夫", sceneId: HARBOR, tenureStatus: "active" },
      { id: ARCHIVIST, kind: "npc", name: "档案管理员", sceneId: LIBRARY, tenureStatus: "active" },
    ],
    characterControls: [{ characterId: ACTOR, seatId: "seat:history:original" }, { characterId: OTHER, seatId: "seat:history:other" }],
    canonicalFacts: [{ id: "fact:history:origin", kind: "historyOrigin", subjectRefs: [HARBOR, LIBRARY], value: "两地居民一直互有往来。", visibilityPolicyId: "visibility:public", source: "moduleAnchor" }],
    initialKnowledge: [{ characterId: ACTOR, knowledgeRef: "knowledge:old-private", kind: "sourceClaim", layer: "full",
      content: "ORIGINAL-CHARACTER-PRIVATE", visibility: "private", provenanceChain: ["genesis:old-private"] }],
  });
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const initial = replay(initialized.genesis, []);
  assert.equal(initial.kind, "replayed", JSON.stringify(initial));
  const fixture = { profiles: initialized.profiles, genesis: initialized.genesis, state: initial.state, events: [],
    runtime: { step, replay, project }, preparations: [] };
  fixture.run = input => {
    const result = step(fixture.profiles, fixture.state, input);
    assert.ok(["committed", "awaitingInput"].includes(result.kind), JSON.stringify(result));
    fixture.events.push(...result.events);
    const rebuilt = replay(fixture.genesis, fixture.events);
    assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
    assert.deepEqual(rebuilt.state, result.state);
    fixture.state = rebuilt.state;
    return result;
  };
  fixture.run({ kind: "resolveFreeAction", proposalId: "root:history:harbor-time", characterId: ACTOR,
    goal: "整理码头记录", method: "查看资料", feasibility: { kind: "directSuccess", publicBasis: "资料在手边。" }, outcome: { fictionTimeCostMicros: "200" } });
  fixture.run({ kind: "resolveFreeAction", proposalId: "root:history:library-time", characterId: OTHER,
    goal: "整理档案", method: "查看资料", feasibility: { kind: "directSuccess", publicBasis: "资料在手边。" }, outcome: { fictionTimeCostMicros: "50" } });
  fixture.cutState = structuredClone(fixture.state);
  fixture.cutSeq = fixture.state.version;
  const subject = variant === "archive" ? ARCHIVIST : BOATMAN;
  const label = variant === "archive" ? "档案调查" : "药船征用";
  const factRef = `fact:history:${variant}`;
  fixture.run({ kind: "declareCanonicalFact", proposalId: "root:history:record-old-event", fact: {
    factId: factRef, factKind: "hiddenReality", subjectRefs: [subject], value: label, source: "dynamicMaterialization",
    causalParentIds: ["fact:history:origin"], visibilityPolicy: "hiddenUntilEvidence",
  } });
  const holders = [{ holder: BOATMAN, time: "80" }, { holder: ARCHIVIST, time: "200" }];
  for (const { holder } of holders) fixture.run({ kind: "acquireSensoryEvidence", proposalId: `root:history:knowledge:${holder}`,
    characterId: holder, factId: factRef, sense: "hearing", clarity: "obvious", publicEvidence: `${label}的亲历证据` });
  const prepared = preparation(fixture, subject, label, factRef, holders);
  const record = fixture.state.canonicalFacts[factRef];
  const bySeq = new Map(fixture.events.map(event => [event.eventSeq, event]));
  fixture.preparations = [{ preparation: prepared, preparationHash: await archiveSha256(prepared), recordedAtEventSeq: fixture.state.version,
    facts: [{ candidateRef: "candidate:history", factRef, recordedByEventId: bySeq.get(record.validFromEventSeq).eventId, definitionRefs: [],
      knowledge: holders.map(({ holder }, index) => {
        const knowledge = Object.values(fixture.state.knowledge[holder]).find(entry => entry.provenanceChain.includes(factRef));
        assert.ok(knowledge);
        return { candidateRef: `knowledge:prepared:${index}`, holderRef: holder, knowledgeRef: knowledge.knowledgeRef, recordedByEventId: knowledge.acquiredByEventId };
      }) }] }];
  fixture.run({ kind: "declareCanonicalFact", proposalId: "root:history:future", fact: {
    factId: "fact:history:future", factKind: "hiddenReality", subjectRefs: [subject], value: "ORIGINAL-FUTURE-OUTCOME",
    source: "dynamicMaterialization", causalParentIds: [factRef], visibilityPolicy: "hiddenUntilEvidence",
  } });
  fixture.archive = await buildAuthoritativeArchive({ roomId: fixture.state.roomId, signedGenesis: fixture.genesis, events: fixture.events, receiptRefs: [], projectionAudits: [] });
  fixture.source = { roomId: fixture.state.roomId, runtimeEpochId: fixture.state.runtimeEpochId, archiveHash: fixture.archive.archiveHash, branchId: fixture.state.activeBranchId };
  fixture.request = { access: { ...ACCESS }, source: fixture.source, cut: { eventSeq: fixture.cutSeq, focusSceneId: variant === "archive" ? LIBRARY : HARBOR },
    identity: { kind: "newCharacter", characterId: "character:history:new-physician", sceneId: variant === "archive" ? LIBRARY : HARBOR,
      originBasisRefs: ["fact:history:origin"], character: { name: "当地医师", background: "为本地居民治疗。" } } };
  return fixture;
}

/** A trusted in-memory host at the same seam used by Room integration. Its
 * admission knowledge comes from the fixture's stored receipts, not a model. */
export function historyHost(fixture, changes = {}) {
  const calls = { source: 0, viewer: 0, cut: 0, identity: 0 };
  const authorized = request => request.access.principalId === ACCESS.principalId
    && request.access.authorizationVersion === ACCESS.authorizationVersion;
  const unavailable = () => ({ kind: "rejected", code: "STORY_HISTORY_SOURCE_UNAVAILABLE" });
  const host = {
    replay,
    async readSource({ request, authorizationBindingHash }) {
      calls.source++;
      if (!authorized(request)) return unavailable();
      return { kind: "available", authorizationBindingHash, value: {
        archive: structuredClone(fixture.archive), preparations: structuredClone(fixture.preparations),
        requiredPreparationHashes: fixture.preparations.map(material => material.preparationHash),
      } };
    },
    async readViewerExport({ request, authorizationBindingHash }) {
      calls.viewer++;
      if (!authorized(request) || request.characterId !== ACTOR) return unavailable();
      const readModel = project(fixture.profiles, fixture.state, { kind: "player", principalId: ACCESS.principalId,
        sessionVersion: 1, seatId: "seat:history:original", characterId: ACTOR });
      assert.equal(readModel.kind, "projected", JSON.stringify(readModel));
      return { kind: "available", authorizationBindingHash, value: { readModel, projectionHash: readModel.projectionHash,
        transcript: [{ ordinal: 1, messageId: "message:original:1", sceneIds: [HARBOR], kind: "kp", speakerCharacterId: null,
          speakerName: "KP", body: "ONLY-EXPERIENCED-TEXT", sourceEventSeq: fixture.cutSeq, receiptId: "receipt:experienced" }], nextCursor: null } };
    },
    async validateHistoricalCut(input) {
      calls.cut++;
      if (!authorized(input.value.request)) return unavailable();
      const { moduleRef } = input.value.sourceArchive.signedGenesis;
      if (JSON.stringify(moduleRef) !== JSON.stringify(profile)) return { kind: "rejected", code: "STORY_HISTORY_PROFILE_UNSUPPORTED" };
      if (input.value.cut.eventSeq !== fixture.cutSeq) return { kind: "rejected", code: "STORY_HISTORY_CUT_UNSUPPORTED" };
      for (const fact of input.value.lateFacts) {
        assert.equal(fact.candidate.content, fixture.state.canonicalFacts[fact.record.id].value);
        assert.ok(fixture.events.some(event => event.eventHash === fact.recordedBy.eventHash));
      }
      return { kind: "verified", authorizationBindingHash: input.authorizationBindingHash, verificationHash: input.verificationHash };
    },
    async validateNewIdentity(input) {
      calls.identity++;
      if (!authorized(input.value.request)) return unavailable();
      if (input.value.request.identity.character.copyOf || input.value.request.identity.character.uniqueItemRef) {
        return { kind: "rejected", code: "STORY_HISTORY_IDENTITY_CONFLICT" };
      }
      return { kind: "verified", authorizationBindingHash: input.authorizationBindingHash, verificationHash: input.verificationHash };
    },
    ...changes,
  };
  return { host, calls };
}
