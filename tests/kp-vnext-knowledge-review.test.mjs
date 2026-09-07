import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as OTHER, PROBE_SOURCE as SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { deepSeekStrictToolSchemaIssues } from "../app/_runtime/lib/kp/deepseek-strict-tool.ts";
import { authorityKnowledgeCatalog, authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createEventTransition } from "../app/_runtime/lib/rules/v2/events.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { heldKnowledgeNarrationFacts } from "../app/_runtime/lib/rules/v2/knowledge-expression.ts";
import { projectHeldKnowledgeIdentities } from "../app/_runtime/lib/rules/v2/knowledge-identities.ts";
import { freezeNarrationContext } from "../app/_runtime/lib/kp/narration-context.ts";
import { naturalNarrationContext, frozenNarrationReviewContext, narrationReviewModelInput,
  decodeNarrationReview } from "../app/_runtime/lib/kp/narration-vnext.ts";

const held = (knowledgeRef, content, kind = "canonicalFact", layer = "full", characterId = ACTOR) => ({
  characterId, knowledgeRef, kind, layer, content, visibility: "private", provenanceChain: ["genesis:held-knowledge"],
});
const opening = held("knowledge:opening", { schema: "zhuwei.module-opening-knowledge/v1", moduleRef: { profileId: "module:probe" },
  sceneId: "scene:probe-gallery", description: "你来到一条狭长的走廊。" }, "sensoryEvidence");
const rumor = held("knowledge:rumor", "北桥已经封闭。", "sourceClaim", "partial");
function candidate(scope = "allKnown", knowledgeRefs = []) {
  return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision: { kind: "knowledgeReview", inquiry: "我目前知道些什么？", scope, knowledgeRefs } }));
}
function lower(fixture, value = candidate().bundle, context) {
  return lowerVNext2ProposalBundle({ ...fixture, value, requiredContext: context ?? freezeAuthoredProbeContext(fixture, fixture.state,
    { rootActionId: fixture.rootActionId, intentText: "我目前知道些什么？", focusRefs: [] }).context });
}
function project(fixture, result, viewer = fixture.viewer) {
  return fixture.runtime.project(fixture.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: fixture.state, events: result.events,
  } });
}
function unchangedWorld(before, after) {
  for (const key of ["knowledge", "canonicalFacts", "entities", "combatRuntime", "campaignRuntime", "fictionTime", "fictionTimelines"]) {
    assert.deepEqual(after[key], before[key], key);
  }
  const { causalFrontiers: _beforeFrontier, ...beforeMultiplayer } = before.multiplayerRuntime;
  const { causalFrontiers: _afterFrontier, ...afterMultiplayer } = after.multiplayerRuntime;
  assert.deepEqual(afterMultiplayer, beforeMultiplayer);
  for (const [id, frontier] of Object.entries(before.multiplayerRuntime.causalFrontiers)) {
    assert.equal(after.multiplayerRuntime.causalFrontiers[id].nowMicros, frontier.nowMicros);
  }
}

test("knowledge overview uses the actual terminal schema, private Rules event, Claims and replay with no world effect", () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const fixture = createAuthoredProbeFixture("knowledge-overview", { initialKnowledge: [opening, rumor,
    held("knowledge:other-secret", "OTHER_PRIVATE_CANARY", "canonicalFact", "full", OTHER)] });
  const parsed = candidate();
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  const lowered = lower(fixture, parsed.bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  assert.deepEqual(lowered.command.rulesInput.plan.knowledgeRefs, ["knowledge:opening", "knowledge:rumor"]);
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.deepEqual(result.events.map(event => event.eventType), ["KnowledgeReviewed"]);
  unchangedWorld(fixture.state, result.state);
  const view = project(fixture, result);
  assert.equal(view.kind, "projected", JSON.stringify(view));
  const claim = view.renderableClaims.claims.find(claim => claim.kind === "knowledgeReview");
  assert.deepEqual(claim.records.map(record => record.content), [opening.content, rumor.content]);
  assert.match(claim.narrationFacts.join("\n"), /来源声称，尚未由这条记录证实/);
  assert.match(claim.narrationFacts.join("\n"), /目前只掌握部分内容/);
  assert.equal(JSON.stringify(view).includes("OTHER_PRIVATE_CANARY"), false);
  const other = project(fixture, result, { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: OTHER });
  assert.deepEqual(other.renderableClaims.claims, []);
  assert.equal(JSON.stringify(other).includes("北桥已经封闭"), false);
  const replay = fixture.runtime.replay(fixture.genesis, result.events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, result.state);
  assert.equal(fixture.runtime.step(fixture.profiles, result.state, lowered.command.rulesInput).rejection.code, "duplicateRootAction");
});

test("complete empty catalogs and selected-empty answers are distinct from missing context", () => {
  for (const scope of ["allKnown", "relevantKnown"]) {
    const fixture = createAuthoredProbeFixture(`knowledge-empty-${scope}`);
    assert.deepEqual(authorityKnowledgeCatalog(fixture.state, ACTOR).records, []);
    const frozen = freezeAuthoredProbeContext(fixture, fixture.state, { rootActionId: fixture.rootActionId, focusRefs: [] }).context;
    const lowered = lower(fixture, candidate(scope).bundle, frozen);
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const view = project(fixture, result);
    assert.equal(view.kind, "projected", JSON.stringify(view));
    const claim = view.renderableClaims.claims.find(claim => claim.kind === "knowledgeReview");
    assert.match(claim.narrationFacts[0], scope === "allKnown" ? /目录为空/ : /没有选到.*不证明/);
    const absent = structuredClone(frozen);
    absent.entries = absent.entries.filter(entry => entry.entryRef !== `knowledge-catalog:${ACTOR}`);
    assert.equal(lower(fixture, candidate(scope).bundle, absent).code, "CONTEXT_INSUFFICIENT");
  }
});

test("selection, catalog concurrency, missing bodies and typed terminal fields fail closed", () => {
  const fixture = createAuthoredProbeFixture("knowledge-conflicts", { initialKnowledge: [opening, rumor] });
  const frozen = freezeAuthoredProbeContext(fixture, fixture.state, { rootActionId: fixture.rootActionId, focusRefs: [] }).context;
  const lowered = lower(fixture, candidate("relevantKnown", ["knowledge:rumor"]).bundle, frozen);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const changed = structuredClone(fixture.state);
  changed.knowledge[ACTOR]["knowledge:new"] = { ...changed.knowledge[ACTOR]["knowledge:rumor"], knowledgeRef: "knowledge:new", content: "新增知识" };
  assert.notEqual(authorityRevisionOrHash(changed, `knowledge-catalog:${ACTOR}`), authorityRevisionOrHash(fixture.state, `knowledge-catalog:${ACTOR}`));
  assert.equal(fixture.runtime.step(fixture.profiles, changed, lowered.command.rulesInput).kind, "rejected");
  assert.equal(lower(fixture, candidate("relevantKnown", ["knowledge:foreign"]).bundle).code, "PROPOSAL_REFERENCE_INVALID");
  const missing = structuredClone(frozen);
  missing.entries = missing.entries.filter(entry => entry.entryRef !== `knowledge:${ACTOR}:knowledge:rumor`);
  assert.equal(lower(fixture, candidate().bundle, missing).code, "CONTEXT_INSUFFICIENT");
  assert.equal(candidate("allKnown", ["knowledge:rumor"]).kind, "locallyRejected");
  const forged = structuredClone(candidate().bundle);
  forged.terminal.effects = [{ kind: "damage", amount: 1 }];
  assert.equal(lower(fixture, forged).kind, "rejected");
});

test("fold independently rejects public, altered-content, foreign-holder and legacy-profile review events", () => {
  const fixture = createAuthoredProbeFixture("knowledge-fold", { initialKnowledge: [opening, rumor] });
  const lowered = lower(fixture);
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const event = result.events[0];
  const draft = { rootActionId: fixture.rootActionId, eventType: "KnowledgeReviewed", payload: event.payload,
    scopeProof: result.scopeProof, secrecy: "private", visibilityPolicyId: event.visibilityPolicyId };
  // createEventTransition recomputes hashes; semantic fold, not just stale hashes, must reject.
  for (const change of [
    { secrecy: "public", visibilityPolicyId: "visibility:public" },
    { payload: { ...event.payload, records: event.payload.records.map((record, index) => index ? record : { ...record, content: "FULL_SECRET" }) } },
    { payload: { ...event.payload, records: event.payload.records.map(record => ({ ...record, characterId: OTHER })) } },
  ]) assert.throws(() => createEventTransition(fixture.state, fixture.profiles, { ...draft, ...change }));
  assert.throws(() => createEventTransition(fixture.state, ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST, draft));
  assert.equal(event.payload.catalogHash, canonicalSha256(authorityKnowledgeCatalog(fixture.state, ACTOR)));
});

const premise = (characterId = ACTOR) => ({ schema: "zhuwei.character-premise/v2", characterId, predicate: "priorRelationship",
  policyRef: "policy:known-relationship", anchorRefs: ["anchor:character"], statementTemplateRef: "template:relationship",
  sourceRefs: ["policy:known-relationship", "anchor:character"], scope: "characterBackstory", truthStatus: "canonical",
  origin: "kpOpenBlankWithinModuleAnchor", bindings: [
    { slotRef: "counterparty", relationKind: "previouslyConnectedTo", referenceKind: "openArchetype", entityRef: "person:offstage-a", entityKind: "person", archetypeRef: "archetype:person" },
    { slotRef: "counterparty", relationKind: "previouslyConnectedTo", referenceKind: "openArchetype", entityRef: "person:offstage-b", entityKind: "person", archetypeRef: "archetype:person" },
  ] });
function knownDefinitions(fixture, holder = ACTOR) {
  for (const [ref, name] of [["person:offstage-a", "许叔"], ["person:offstage-b", "林舟"]]) fixture.state.campaignRuntime.definitions[ref] = {
    definitionId: ref, definitionKind: "npc", visibilityPolicyRef: `visibility:knowledge-holder:${holder}`,
    content: { name, displayAlias: name, lifecycleStatus: "definedOffstage", SECRET: "HIDDEN_DEFINITION_CANARY" },
  };
}
test("structured premise identities are frozen names only, keep every binding, and do not expose definition contents", () => {
  const fixture = createAuthoredProbeFixture("knowledge-structured", { initialKnowledge: [held("knowledge:premise", premise())] });
  knownDefinitions(fixture);
  const lowered = lower(fixture);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const view = project(fixture, result);
  assert.equal(view.kind, "projected", JSON.stringify(view));
  const claim = view.renderableClaims.claims.find(claim => claim.kind === "knowledgeReview");
  assert.equal(claim.narrationFacts.length, 2);
  assert.match(claim.narrationFacts[0], /该角色本人.*许叔/);
  assert.match(claim.narrationFacts[1], /该角色本人.*林舟/);
  assert.deepEqual(claim.records[0].content, premise());
  assert.equal(JSON.stringify(view).includes("HIDDEN_DEFINITION_CANARY"), false);
  assert.equal(view.entities?.["person:offstage-a"], undefined);
  assert.equal(claim.basisRefs.includes("person:offstage-a"), false);
  assert.equal(view.knowledgeIdentities.length, 2);
});

test("shared premise keeps its original subject and cannot inherit the source holder's hidden name grants", () => {
  const fixture = createAuthoredProbeFixture("knowledge-shared", { initialKnowledge: [held("knowledge:premise", premise(OTHER))] });
  knownDefinitions(fixture, OTHER);
  fixture.state.knowledge[ACTOR]["knowledge:premise"].sourceCharacterId = OTHER;
  const record = fixture.state.knowledge[ACTOR]["knowledge:premise"];
  assert.deepEqual(projectHeldKnowledgeIdentities(fixture.state, ACTOR, [record]), []);
  assert.throws(() => heldKnowledgeNarrationFacts("allKnown", [record], new Map([[OTHER, "莱恩"]])), /KNOWLEDGE_DISPLAY_NAME_UNAVAILABLE/);
  const facts = heldKnowledgeNarrationFacts("allKnown", [record], new Map([[OTHER, "莱恩"], ["person:offstage-a", "许叔"], ["person:offstage-b", "林舟"]]));
  assert.ok(facts.every(fact => fact.includes("莱恩此前") && !fact.includes("该角色本人")));
  for (const layer of ["hint", "partial"]) {
    assert.deepEqual(projectHeldKnowledgeIdentities(fixture.state, OTHER, [{ ...record, characterId: OTHER, layer }]), []);
  }
});

test("held partial content never dereferences its complete canonical secret; source and inference are not promoted by full", () => {
  const fixture = createAuthoredProbeFixture("knowledge-layers", { initialKnowledge: [
    held("fact:hidden", "封蜡上有一道浅痕。", "sensoryEvidence", "partial"),
    held("knowledge:inference", "可能有人拆过信。", "characterInference", "full"),
    held("knowledge:claim", "他说没有拆信。", "sourceClaim", "full"),
  ] });
  fixture.state.canonicalFacts["fact:hidden"] = { id: "fact:hidden", kind: "worldFact", subjectRefs: [SOURCE],
    value: "COMPLETE_SECRET_CANARY", visibilityPolicyId: "visibility:room-authority-only", source: "moduleFixedFact",
    branchId: fixture.state.activeBranchId, validFromEventSeq: "0", causalParentIds: [] };
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lower(fixture).command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const view = project(fixture, result);
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.equal(JSON.stringify(view.renderableClaims).includes("COMPLETE_SECRET_CANARY"), false);
  const facts = view.renderableClaims.claims.find(claim => claim.kind === "knowledgeReview").narrationFacts.join("\n");
  assert.match(facts, /已有推断，仍未确定/);
  assert.match(facts, /来源声称，尚未由这条记录证实/);
  assert.match(facts, /目前只掌握部分内容/);
});

test("complete actor knowledge cannot freeze with an unavailable oversized body", () => {
  assert.throws(() => createAuthoredProbeFixture("knowledge-too-large", { initialKnowledge: [held("knowledge:large", "甲".repeat(65_000))] }),
    error => error.code === "PROBE_CONTEXT_BINDING_FAILED");
});

test("scalar, activity and assertion content keep their meaning; unknown or malformed JSON fails explicitly", () => {
  const fixture = createAuthoredProbeFixture("knowledge-expression", { initialKnowledge: [opening] });
  const record = fixture.state.knowledge[ACTOR]["knowledge:opening"];
  for (const value of [false, 0, null, "记录原文", { observedActivityId: "activity:old", status: "听到了警钟" }]) {
    assert.ok(heldKnowledgeNarrationFacts("allKnown", [{ ...record, content: value }], new Map()).length > 0);
  }
  const assertion = { schema: "zhuwei.typed-assertion-fact/v1", sourcePremiseFactRef: "fact:premise", relationKind: "previouslyConnectedTo",
    assertion: { subjectRef: ACTOR, predicate: "relatedTo", polarity: "affirm", object: { referenceKind: "existing", ref: OTHER } } };
  assert.match(heldKnowledgeNarrationFacts("allKnown", [{ ...record, content: assertion }], new Map([[OTHER, "莱恩"]]))[0], /该角色本人.*莱恩/);
  for (const value of [{ schema: "unknown", fact: "不可略去" }, ["未注册数组"], { ...premise(), extra: "不可略去" },
    { ...premise(), predicate: "affiliation" }, { ...assertion, assertion: { ...assertion.assertion, predicate: "locatedAt" } }]) {
    assert.throws(() => heldKnowledgeNarrationFacts("allKnown", [{ ...record, content: value }], new Map()), /EXPRESSION_UNAVAILABLE/);
  }
});

test("model inquiry text cannot become narration fact or payload evidence", () => {
  const fixture = createAuthoredProbeFixture("knowledge-inquiry", { initialKnowledge: [opening] });
  const bundle = structuredClone(candidate().bundle);
  bundle.terminal.inquiry = "INQUIRY_ONLY_CANARY";
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lower(fixture, bundle).command.rulesInput);
  const view = project(fixture, result);
  const request = { receipt: result.receipt, viewerKey: view.renderableClaims.viewerKey, renderableClaims: view.renderableClaims,
    narrationContext: freezeNarrationContext(view.renderableClaims, { viewer: { characterRef: ACTOR, name: "旅人" },
      actor: { characterRef: ACTOR, name: "旅人" }, actorIntent: "我目前知道些什么？", scene: null,
      characters: [], recentDialogue: [], establishedDetails: [] }) };
  assert.equal(JSON.stringify(naturalNarrationContext(request)).includes("INQUIRY_ONLY_CANARY"), false);
  assert.equal(JSON.stringify(frozenNarrationReviewContext(request, "回顾已有知识。")).includes("INQUIRY_ONLY_CANARY"), false);
  const body = "回顾已有知识。", context = frozenNarrationReviewContext(request, body);
  const input = narrationReviewModelInput(request, body), schema = input.tools[0].function.parameters;
  assert.deepEqual(context.mechanicalResults, []);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  assert.equal(Object.hasOwn(schema.properties, "resultChecks"), false);
  const review = { reviewId: context.reviewId, checks: { results: "pass", continuity: "pass",
    attribution: "pass", agency: "pass", presentation: "pass" }, issues: [] };
  assert.deepEqual(decodeNarrationReview(review, request, body), review);
  assert.throws(() => decodeNarrationReview({ ...review, resultChecks: {} }, request, body));
});
