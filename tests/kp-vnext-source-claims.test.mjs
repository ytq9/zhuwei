import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ALICE, PROBE_TARGET as BOB } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { createEventTransition, createScopeProof } from "../app/_runtime/lib/rules/v2/events.ts";
import { frozenRenderableClaimsConform } from "../app/_runtime/lib/rules/v2/claims.ts";

const CLAIM = "claim:opaque-rumor";
const TEXT = "地窖里存着旧宝藏。";
const BOB_VIEWER = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: BOB };
function create(f) {
  const result = f.runtime.step(f.profiles, f.state, { kind: "createSourceClaim", proposalId: `${f.rootActionId}:create`,
    speakerId: BOB, claimId: CLAIM, semanticContent: TEXT, sourceBasis: "PRIVATE_SOURCE_BASIS_CANARY",
    motive: "PRIVATE_MOTIVE_CANARY", formedAtFictionMicros: "0" });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}
function share(f, state, layer = "full", refs = [CLAIM]) {
  return f.runtime.step(f.profiles, state, { kind: "shareKnowledge", proposalId: `${f.rootActionId}:share`,
    senderCharacterId: BOB, recipientEntityIds: [ALICE], knowledgeRefs: refs,
    medium: "spokenConversation", contentLayer: layer });
}
function view(f, state, viewer = f.viewer, query) {
  const result = f.runtime.project(f.profiles, state, viewer, query);
  assert.equal(result.kind, "projected", JSON.stringify(result));
  return result;
}
function assertPrivate(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_SOURCE_BASIS_CANARY|PRIVATE_MOTIVE_CANARY/);
}

test("source claim sharing exposes only held content and keeps authority-only motives out of every Viewer channel", () => {
  const f = createAuthoredProbeFixture("source-privacy"), created = create(f);
  assert.doesNotMatch(JSON.stringify(view(f, created.state)), /地窖里存着旧宝藏/);
  const result = share(f, created.state);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(share(f, created.state, "partial").kind, "rejected");
  assert.deepEqual(result.state.canonicalFacts, f.state.canonicalFacts);
  for (const viewer of [f.viewer, BOB_VIEWER]) for (const channel of ["realtime", "history", "reconnect", "error", "candidates", "voice", "transcript"]) {
    const projection = view(f, result.state, viewer, { channel });
    assert.match(JSON.stringify(projection), /地窖里存着旧宝藏/);
    assertPrivate(projection);
  }
  assert.equal(result.state.campaignRuntime.sourceClaims[CLAIM].motive, "PRIVATE_MOTIVE_CANARY");
  const replayed = f.runtime.replay(f.genesis, [...created.events, ...result.events]);
  assert.equal(replayed.kind, "replayed"); assert.deepEqual(replayed.state, result.state);
  assert.equal(share(f, result.state).kind, "rejected");
});

test("source claim projection cannot fill a partial holder record from the complete authority claim", () => {
  const f = createAuthoredProbeFixture("source-partial", { initialKnowledge: [{ characterId: ALICE, knowledgeRef: CLAIM,
    kind: "sourceClaim", layer: "partial", content: "只听到了宝藏这个词。", visibility: "private", provenanceChain: ["genesis:fragment"] }] });
  const created = create(f), projection = view(f, created.state);
  assert.match(JSON.stringify(projection), /只听到了宝藏这个词/);
  assert.doesNotMatch(JSON.stringify(projection), /地窖里存着旧宝藏/);
  assertPrivate(projection);
  const row = projection.sourceClaims.find(entry => entry.claimId === CLAIM);
  assert.equal(row.layer, "partial"); assert.equal(row.speakerId, undefined);
});

test("sharing cannot upgrade the sender's partial knowledge and cannot use inherited records", () => {
  const f = createAuthoredProbeFixture("source-layers", { initialKnowledge: [{ characterId: BOB, knowledgeRef: CLAIM,
    kind: "sourceClaim", layer: "partial", content: "只听到了短片段。", visibility: "private", provenanceChain: ["genesis:fragment"] }] });
  assert.equal(share(f, f.state, "full").kind, "rejected");
  const partial = share(f, f.state, "partial");
  assert.equal(partial.kind, "committed", JSON.stringify(partial));
  assert.equal(partial.state.knowledge[ALICE][CLAIM].layer, "partial");
  const inherited = share(f, f.state, "partial", ["__proto__"]);
  assert.equal(inherited.kind, "rejected");
});

test("the listener's acquired event yields private attributed Claims and replays without publishing the creator's internals", () => {
  const f = createAuthoredProbeFixture("source-acquired-claims"), created = create(f);
  const result = share(f, created.state); assert.equal(result.kind, "committed", JSON.stringify(result));
  const query = { channel: "realtime", committedRange: { receiptId: result.receipt.receiptId,
    actorCharacterId: BOB, priorState: created.state, events: result.events } };
  const projection = view(f, result.state, f.viewer, query);
  const claims = projection.renderableClaims.claims.filter(claim => claim.kind === "sourceClaim");
  assert.equal(frozenRenderableClaimsConform(projection.renderableClaims), true);
  assert.equal(claims.length, 1); assert.equal(claims[0].speakerRef, BOB);
  assert.match(claims[0].statement, /地窖里存着旧宝藏/);
  assert.match(claims[0].narrationFacts.join("\n"), /主张.*尚未由这条记录证实/);
  assertPrivate(projection);
  const speaker = view(f, result.state, BOB_VIEWER, query);
  assert.equal(speaker.renderableClaims.claims.some(claim => claim.kind === "sourceClaim"), false);
});

test("batch acquisition preserves structured facts and inference confidence while marking perception as reported", () => {
  const records = [
    { knowledgeRef: "knowledge:fact", kind: "canonicalFact", content: { schema: "zhuwei.module-opening-knowledge/v1",
      moduleRef: { profileId: "module:held" }, sceneId: "scene:held", description: "来访者已知道档案馆今晚开放。" } },
    { knowledgeRef: "knowledge:inference", kind: "characterInference", content: { schema: "zhuwei.character-inference/v1",
      conclusion: "守门人也许仍在值班。", confidence: "未经确认。" } },
    { knowledgeRef: "knowledge:sensory", kind: "sensoryEvidence", content: "听到了门铃声。" },
  ].map(record => ({ ...record, characterId: BOB, layer: "full", visibility: "private", provenanceChain: ["genesis:source"] }));
  const f = createAuthoredProbeFixture("source-batch", { initialKnowledge: records });
  const result = share(f, f.state, "full", records.map(record => record.knowledgeRef));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const projection = view(f, result.state, f.viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: BOB, priorState: f.state, events: result.events } });
  const claims = projection.renderableClaims.claims.filter(claim => claim.kind === "knowledgeAcquisition");
  assert.equal(claims.length, 3); assert.equal(frozenRenderableClaimsConform(projection.renderableClaims), true);
  assert.match(JSON.stringify(claims), /档案馆今晚开放/);
  assert.match(JSON.stringify(claims), /未经确认/);
  assert.match(JSON.stringify(claims), /非本人当场感知/);
  assert.deepEqual(f.runtime.replay(f.genesis, result.events).state, result.state);
});

test("vNext event folding rejects forged shared content, kind, provenance, layer and audience before any write", () => {
  const f = createAuthoredProbeFixture("source-fold"), created = create(f);
  const shared = share(f, created.state), event = shared.events[0];
  for (const mutate of [
    draft => { draft.payload.items[0].content = "伪造的未表达正文。"; },
    draft => { draft.payload.items[0].objectKind = "canonicalFact"; },
    draft => { draft.payload.items[0].provenanceChain = ["unknown:source"]; },
    draft => { draft.payload.items.push(structuredClone(draft.payload.items[0])); },
    draft => { draft.payload.contentLayer = "hint"; },
    draft => { draft.visibilityPolicyId = "visibility:public"; draft.secrecy = "public"; },
  ]) {
    const draft = { rootActionId: event.rootActionId, eventType: event.eventType,
      payload: structuredClone(event.payload), scopeProof: shared.scopeProof,
      visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy };
    mutate(draft);
    assert.throws(() => createEventTransition(created.state, f.profiles, draft));
    assert.equal(created.state.knowledge[ALICE][CLAIM], undefined);
  }
});

test("a single acquired document claim without an authorized speaker keeps its content and safe attribution", () => {
  const f = createAuthoredProbeFixture("source-document-event");
  const declared = f.runtime.step(f.profiles, f.state, { kind: "declareCanonicalFact", proposalId: `${f.rootActionId}:origin`,
    fact: { factId: "fact:document-origin", factKind: "itemInformationSource", subjectRefs: [],
      source: "observedEvent", value: { motive: "PRIVATE_MOTIVE_CANARY", sourceBasis: "PRIVATE_SOURCE_BASIS_CANARY" },
      causalParentIds: [], visibilityPolicy: "hiddenUntilEvidence" } });
  assert.equal(declared.kind, "committed", JSON.stringify(declared));
  // This checks the existing single-event interpreter shape. It does not
  // claim the legacy observeItemInformation Form is reachable in vNext.
  const root = `${f.rootActionId}:acquire`, ref = "knowledge:document-fragment";
  const transition = createEventTransition(declared.state, f.profiles, { rootActionId: root, eventType: "KnowledgeAcquired",
    payload: { characterId: ALICE, knowledgeRef: ref, objectKind: "sourceClaim", layer: "partial",
      content: "残页上写着桥头有人驻守。", causeFactId: "fact:document-origin",
      acquisition: { sense: "worldItemContact", sceneId: f.state.entities[ALICE].sceneId, method: "阅读残页" }, visibility: "private" },
    scopeProof: createScopeProof(declared.state, ["fact:document-origin"], [`knowledge:${ALICE}:${ref}`, `receipt:${root}`], [`knowledge:${ALICE}:${ref}`]),
    visibilityPolicyId: `visibility:knowledge-holder:${ALICE}`, secrecy: "private" });
  const projection = view(f, transition.state, f.viewer, { channel: "realtime", committedRange: {
    receiptId: transition.receipt.receiptId, actorCharacterId: ALICE, priorState: declared.state, events: [transition.event] } });
  const claim = projection.renderableClaims.claims.find(entry => entry.kind === "sourceClaim");
  assert.equal(claim.speakerRef, undefined); assert.equal(claim.speakerName, "该消息来源");
  assert.equal(claim.acquisition.layer, "partial"); assert.equal(frozenRenderableClaimsConform(projection.renderableClaims), true);
  assert.match(claim.narrationFacts.join("\n"), /桥头有人驻守/); assertPrivate(projection);
  assert.deepEqual(f.runtime.replay(f.genesis, [...declared.events, transition.event]).state, transition.state);
  assert.doesNotMatch(JSON.stringify(view(f, transition.state, BOB_VIEWER)), /桥头有人驻守/);
});
