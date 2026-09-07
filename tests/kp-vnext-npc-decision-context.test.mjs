import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { freezeNpcDecisionEntry, npcDecisionContext, npcDecisionEntryRef } from "../app/_runtime/lib/kp/vnext/context/npc-decision.ts";
import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";

const NPC = "npc:gatekeeper", OTHER = "npc:courier", SHARED = "knowledge:same-ref";
const DEFINITION = "definition:gatekeeper";
const NPC_TEXT = "我只见到送信人经过。";
const PLAYER_SECRET = "PLAYER-PRIVATE-CANARY";
const OTHER_SECRET = "OTHER-NPC-PRIVATE-CANARY";
const AUTHORITY_SECRET = "AUTHORITY-PRIVATE-CANARY";
function knowledge(characterId, content) {
  return { characterId, knowledgeRef: SHARED, content, kind: "sourceClaim", layer: "partial", visibility: "private", provenanceChain: [`genesis:${characterId}`] };
}
function fixture(name, empty = false) {
  const content = { label: "守门人", description: "四十二岁，年轻时在河港做过船工。", links: { entityRef: NPC },
    semantics: { attitude: "谨慎", goals: [{ goalRef: "goal:guard", description: "按规定守好门。" }], plans: [] },
    privateNotes: AUTHORITY_SECRET };
  return createAuthoredProbeFixture(`npc-context:${name}`, {
    npcCharacters: [{ id: NPC, name: "守门人" }, { id: OTHER, name: "送信人" }],
    initialKnowledge: empty ? [] : [knowledge(ACTOR, PLAYER_SECRET), knowledge(NPC, NPC_TEXT), knowledge(OTHER, OTHER_SECRET)],
    canonicalFacts: [{ id: "fact:hidden", kind: "worldFact", source: "moduleAnchor", subjectRefs: [SCENE],
      value: { text: AUTHORITY_SECRET }, visibilityPolicyId: "visibility:room-authority-only" }],
    semanticDefinitions: [storedSemanticDefinition("npc", "visibility:scene-observers", createDefinitionSnapshot(DEFINITION, "1", content))],
    entityDefinitionBindings: [{ entityRef: NPC, definitionRef: DEFINITION }],
  });
}
function project(f, state = f.state) {
  const value = f.runtime.project(f.profiles, state, { kind: "npc", npcId: NPC, purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });
  assert.equal(value.kind, "projected"); return value;
}
function freeze(f, state = f.state) {
  return freezeAuthoredProbeContext(f, state, { focusRefs: [NPC], intentText: "我向守门人询问他亲眼见到的事。" }).context;
}
function resign(value) {
  const { projectionHash: _, ...body } = value;
  return { ...body, projectionHash: canonicalHash(body) };
}
function known(f, context, projection = project(f), state = f.state) {
  return freezeNpcDecisionEntry(state, f.profiles, NPC, projection, context.entries);
}

test("NPC decision context binds the real Rules projection and resolves identical knowledge refs by actual holder", () => {
  const f = fixture("holders"), context = freeze(f), decision = npcDecisionContext(context.entries, NPC);
  assert.ok(decision);
  assert.equal(decision.projectionHash, project(f).projectionHash);
  assert.deepEqual(decision.knowledge.map(entry => entry.entryRef), [`knowledge:${NPC}:${SHARED}`]);
  const bodies = decision.knowledge.map(ref => context.entries.find(entry => entry.entryRef === ref.entryRef).value);
  assert.equal(bodies[0].content, NPC_TEXT); assert.equal(bodies[0].layer, "partial");
  const visible = JSON.stringify({ decision, bodies });
  for (const secret of [PLAYER_SECRET, OTHER_SECRET, AUTHORITY_SECRET]) assert.equal(visible.includes(secret), false);
  assert.equal(JSON.stringify(decision).includes(NPC_TEXT), false, "knowledge body stays in one namespaced entry");
  assert.ok(decision.records.find(record => record.kind === "identity").value.goals);
  assert.equal(decision.records.find(record => record.kind === "identity").value.label, "守门人");
  assert.equal(decision.records.find(record => record.kind === "identity").value.description, "四十二岁，年轻时在河港做过船工。",
    "the NPC must receive established self-background to keep new history consistent");
  assert.ok(decision.records.find(record => record.kind === "timeline"));
  const serialized = JSON.parse(JSON.stringify(context));
  assert.deepEqual(npcDecisionContext(serialized.entries, NPC), decision);
});

test("NPC sparse revision accepts its advertised holder record and rejects another holder's identical raw knowledge ID", () => {
  const f = fixture("revision-citations"), context = freeze(f);
  const stored = f.state.campaignRuntime.definitions[DEFINITION];
  const ownRef = context.references.citations.npcKnowledge.find(entry => entry.npcRef === NPC).refs[0];
  for (const ref of [ownRef, `knowledge:${ACTOR}:${SHARED}`, `knowledge:${OTHER}:${SHARED}`]) {
    const result = f.runtime.step(f.profiles, f.state, { kind: "reviseSemanticDefinition", rootActionId: f.rootActionId,
      actorCharacterId: ACTOR, plan: { schema: "zhuwei.semantic-definition-revision-plan/v1", definitionRef: DEFINITION,
        semanticKind: "npc", baseRevision: stored.revision, baseHash: stored.definitionHash,
        templateRef: stored.templateRef, templateHash: stored.templateHash, contextHash: context.binding.contextHash,
        readSet: [ACTOR, NPC, DEFINITION, ref].sort().map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })),
        basisRefs: [ref], operations: [{ kind: "set", path: ["semantics", "attitude"], value: "愿意说明所见。" }],
        summary: "根据亲眼见闻调整态度。" } });
    if (ref === ownRef) assert.equal(result.kind, "committed", JSON.stringify(result));
    else { assert.equal(result.kind, "rejected"); assert.equal(result.rejection.code, "npcKnowledgeInsufficient"); }
  }
});

test("a re-signed NPC projection cannot import authority facts, private identity fields, another holder or continuity", () => {
  const f = fixture("forged"), context = freeze(f);
  for (const mutate of [
    value => value.visibleFacts.push(f.state.canonicalFacts["fact:hidden"]),
    value => { value.npcIdentity.privateNotes = AUTHORITY_SECRET; },
    value => { value.knowledge = [f.state.knowledge[ACTOR][SHARED]]; },
    value => { value.relationships = [{ relationshipId: "relationship:forged", subjectIds: [NPC, ACTOR], value: OTHER_SECRET }]; },
    value => { value.sourceClaims = [{ claimId: SHARED, semanticContent: AUTHORITY_SECRET }]; },
    value => { value.knowledge = []; },
  ]) {
    const forged = structuredClone(project(f)); mutate(forged);
    assert.deepEqual(known(f, context, resign(forged)), { kind: "unavailable", entryRef: npcDecisionEntryRef(NPC), reason: "invalidProjection", critical: false });
  }
});

test("a trustworthy empty knowledge collection differs from missing projection, missing bodies, and malformed metadata", () => {
  const empty = fixture("empty", true), emptyContext = freeze(empty);
  assert.deepEqual(npcDecisionContext(emptyContext.entries, NPC).knowledge, []);
  assert.equal(known(empty, emptyContext, undefined).kind, "known", "default helper requests the real projection");
  assert.equal(freezeNpcDecisionEntry(empty.state, empty.profiles, NPC, undefined, emptyContext.entries).reason, "notLoaded");
  const f = fixture("missing"), context = freeze(f), withoutBody = context.entries.filter(entry => entry.entryRef !== `knowledge:${NPC}:${SHARED}`);
  assert.equal(freezeNpcDecisionEntry(f.state, f.profiles, NPC, project(f), withoutBody).reason, "notLoaded");
  assert.equal(npcDecisionContext(withoutBody, NPC), undefined);
  for (const projection of [{}, { ...project(f), runtimeProfiles: undefined }, { ...project(f), stateVersion: "999" },
    { ...project(f), viewer: { kind: "npc", subjectId: OTHER } }, { ...project(f), visibleFacts: [undefined] }]) {
    assert.equal(known(f, context, projection).reason, "invalidProjection");
  }
});

test("a corrupt re-signed frozen directory cannot claim the player's same-named record or omit required context", () => {
  const f = fixture("directory"), context = freeze(f);
  for (const mutate of [
    value => { value.knowledge[0].entryRef = `knowledge:${ACTOR}:${SHARED}`; },
    value => { value.knowledge = []; },
    value => { value.records = value.records.filter(record => record.kind !== "self"); },
    value => { value.records.push(value.records[0]); },
    value => { value.extra = "unexpected"; },
  ]) {
    const entries = structuredClone(context.entries), entry = entries.find(value => value.entryRef === npcDecisionEntryRef(NPC));
    mutate(entry.value); entry.revisionOrHash = canonicalHash(entry.value);
    assert.equal(npcDecisionContext(entries, NPC), undefined);
  }
});

test("an existing conversation is versioned using authority while its NPC-visible body stays redacted", () => {
  const f = fixture("conversation"), state = structuredClone(f.state);
  const ref = "thread:prior";
  state.campaignRuntime.conversationThreads = { [ref]: { threadRef: ref, actorCharacterId: ACTOR, npcCharacterId: NPC,
    claimRef: "claim:prior", topicFingerprint: canonicalHash({ topic: "prior" }), resolution: "direct", sourceSceneId: SCENE,
    utterance: "我想向你问个问题。", claimKind: "sourceClaim", claimTruthStatus: "unresolved", status: "active", pendingInputId: null,
    updatedByEventId: "event:prior", privateNotes: AUTHORITY_SECRET,
    claimSemantics: { schema: "zhuwei.social-claim-semantics/v1", targetNpcRef: NPC, addressedThreadRef: null,
      evidenceRefs: [], assertion: null, topicFingerprint: canonicalHash({ topic: "prior" }), influenceGoal: "disclose", desiredBehavior: PLAYER_SECRET } } };
  const context = freeze(f, state), decision = npcDecisionContext(context.entries, NPC);
  assert.ok(decision);
  const thread = decision.records.find(record => record.kind === "conversation");
  assert.equal(thread.ref, `continuity:conversationThreads:${ref}`);
  assert.equal(thread.revisionOrHash, canonicalHash(state.campaignRuntime.conversationThreads[ref]));
  assert.equal(JSON.stringify(thread.value).includes(AUTHORITY_SECRET), false);
  assert.equal(JSON.stringify(thread.value).includes(PLAYER_SECRET), false);
});

test("missing optional NPC projection keeps physical preparation usable without inventing NPC absence", () => {
  const f = fixture("physical"), kpProjection = f.runtime.project(f.profiles, f.state, { kind: "kp", capability: "internal:kp-spatial-evidence" });
  const frozen = freezeAdjudicationContext({ state: f.state, profiles: f.profiles, kpProjection,
    replayHead: { eventSeq: f.state.version, stateHash: canonicalHash(f.state) }, preparedActionId: "prepared:physical",
    rootActionId: f.rootActionId, submissionRef: "submission:physical", actorCharacterId: ACTOR,
    intentText: "我观察守门人的外观。", focusRefs: [NPC], maxUnits: 160_000 });
  assert.equal(frozen.kind, "ready");
  assert.equal(frozen.context.entries.find(entry => entry.entryRef === npcDecisionEntryRef(NPC)).reason, "notLoaded");
  assert.equal(npcDecisionContext(frozen.context.entries, NPC), undefined);
});
