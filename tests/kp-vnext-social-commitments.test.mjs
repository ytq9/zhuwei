import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ALICE, PROBE_TARGET as BOB } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { createEventTransition } from "../app/_runtime/lib/rules/v2/events.ts";
import { committedRangeUsesFrozenRenderableClaims, deriveAuthorityClaimsFromCommittedRange,
  frozenRenderableClaimsConform, projectRenderableClaims } from "../app/_runtime/lib/rules/v2/claims.ts";

const NPC = "character:commitment-npc", BASIS = "fact:PRIVATE_SOCIAL_BASIS";
const NPC_VIEWER = { kind: "npc", npcId: NPC, purpose: "kpDecision", capability: "internal:npc-limited-knowledge" };
const BOB_VIEWER = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: BOB };
const variants = [
  { kind: "relationship", command: "changeRelationship", event: "RelationshipChanged", collection: "relationships", id: "relationship:trust",
    body: { relationshipId: "relationship:trust", subjectIds: [ALICE, NPC], change: "愿意先听完解释。", basisFactIds: [BASIS] } },
  { kind: "promise", command: "makePromise", event: "PromiseMade", collection: "promises", id: "promise:escort",
    body: { promiseId: "promise:escort", promisorId: NPC, promiseeId: ALICE, content: "为来访者打开侧门。", condition: "核实介绍信以后。" } },
  { kind: "debt", command: "incurDebt", event: "DebtIncurred", collection: "debts", id: "debt:repayment",
    body: { debtId: "debt:repayment", debtorId: ALICE, creditorId: NPC, obligation: "归还借来的灯。", condition: "离开地窖以后。", basisFactIds: [BASIS] } },
];
function fixture(label) {
  const f = createAuthoredProbeFixture(`social-commitment-${label}`, { npcCharacters: [{ id: NPC, name: "守门人" }] });
  const declared = f.runtime.step(f.profiles, f.state, { kind: "declareCanonicalFact", proposalId: `${f.rootActionId}:basis`,
    fact: { factId: BASIS, factKind: "relationshipBasis", subjectRefs: [], source: "observedEvent",
      value: { description: "PRIVATE_SOCIAL_REASON_CANARY" }, causalParentIds: [], visibilityPolicy: "hiddenUntilEvidence" } });
  assert.equal(declared.kind, "committed", JSON.stringify(declared));
  return { ...f, state: declared.state, prefix: declared.events };
}
function commit(f, variant, state = f.state, extra = {}) {
  return f.runtime.step(f.profiles, state, { kind: variant.command, proposalId: `${f.rootActionId}:${variant.kind}`, ...variant.body, ...extra });
}
function projection(f, result, viewer = f.viewer, channel = "realtime") {
  const projected = f.runtime.project(f.profiles, result.state, viewer, { channel, committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ALICE, priorState: f.state, events: result.events } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.equal(frozenRenderableClaimsConform(projected.renderableClaims), true);
  return projected;
}
function noBasis(value) { assert.doesNotMatch(JSON.stringify(value), /PRIVATE_SOCIAL_BASIS|PRIVATE_SOCIAL_REASON_CANARY|basisFactIds|sourceFactId/); }

for (const variant of variants) test(`${variant.kind}: public Rules commit, private Claims, unchanged physical state, replay and correction`, () => {
  const f = fixture(variant.kind), result = commit(f, variant);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.deepEqual(result.state.entities, f.state.entities);
  assert.deepEqual(result.state.scenes, f.state.scenes);
  assert.deepEqual(result.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  assert.deepEqual(result.state.canonicalFacts, f.state.canonicalFacts);
  assert.ok(result.state.campaignRuntime[variant.collection][variant.id]);
  for (const viewer of [f.viewer, NPC_VIEWER]) for (const channel of ["realtime", "history", "reconnect", "error", "candidates", "voice", "transcript"]) {
    const value = projection(f, result, viewer, channel), claims = value.renderableClaims.claims.filter(c => c.kind === "socialCommitment");
    assert.equal(claims.length, 1); assert.equal(claims[0].commitment.kind, variant.kind); noBasis(value);
    if (variant.kind === "promise") {
      assert.equal(claims[0].commitment.promisorId, NPC); assert.equal(claims[0].commitment.promiseeId, ALICE);
      assert.match(claims[0].narrationFacts.join("\n"), /守门人向.*作出的承诺（尚未履行）/);
      assert.match(claims[0].narrationFacts.join("\n"), /履行条件：核实介绍信以后/);
    }
    if (variant.kind === "debt") {
      assert.equal(claims[0].commitment.debtorId, ALICE); assert.equal(claims[0].commitment.creditorId, NPC);
      assert.match(claims[0].narrationFacts.join("\n"), /欠守门人的义务（尚未履行）/);
    }
  }
  const other = projection(f, result, BOB_VIEWER); noBasis(other);
  assert.equal(other.renderableClaims.claims.some(c => c.kind === "socialCommitment"), false);
  assert.equal(JSON.stringify(other).includes(variant.id), false);
  const events = [...f.prefix, ...result.events], replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay)); assert.deepEqual(replay.state, result.state);
  const corrected = f.runtime.step(f.profiles, replay.state, { kind: "applyServiceCorrection",
    correctionAuthority: { kind: "roomCorrectionAuthority", capability: replay.state.correctionRuntime.authorityCapability },
    correctionId: `correction:${variant.kind}`, targetReceiptId: result.receipt.receiptId, actorCharacterId: ALICE,
    errorKind: "rulesMisapplication", publicExplanation: "撤销错误记录的社交后果。", basis: { stateHash: replay.head.stateHash, eventHash: replay.head.eventHash } });
  assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
  assert.equal(corrected.state.campaignRuntime[variant.collection][variant.id], undefined);
  assert.deepEqual(f.runtime.replay(f.genesis, [...events, ...corrected.events]).state, corrected.state);
});

test("commitment folds reject invented participants, extra fields and wrong secrecy or audience", () => {
  for (const variant of variants) {
    const f = fixture(`forged-${variant.kind}`), result = commit(f, variant);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const event = result.events.find(e => e.eventType === variant.event);
    for (const mutate of [
      d => { d.payload.internalMotive = "SECRET"; },
      d => { d.visibilityPolicyId = "visibility:public"; d.secrecy = "public"; },
      d => { d.secrecy = "public"; },
      d => { d.visibilityPolicyId = "visibility:relationship-participants"; if (variant.kind === "relationship") d.visibilityPolicyId = "visibility:promise-participants"; },
      d => { if (variant.kind === "relationship") d.payload.subjectIds = [ALICE, "__proto__"];
        else if (variant.kind === "promise") d.payload.promisorId = "__proto__"; else d.payload.creditorId = "__proto__"; },
      ...(variant.kind === "debt" ? [d => { d.payload.basisFactIds = []; }] : []),
      ...(variant.kind === "relationship" ? [d => { d.payload.subjectIds = [ALICE, ALICE]; }] : []),
    ]) {
      const draft = { rootActionId: event.rootActionId, eventType: event.eventType, payload: structuredClone(event.payload),
        scopeProof: result.scopeProof, visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy };
      mutate(draft); assert.throws(() => createEventTransition(f.state, f.profiles, draft));
    }
  }
});

test("relationship identity keeps its participants and promises/debts cannot overwrite an existing obligation", () => {
  for (const variant of variants) {
    const f = fixture(`identity-${variant.kind}`), result = commit(f, variant);
    assert.equal(result.kind, "committed", JSON.stringify(result));
    const change = variant.kind === "relationship" ? { subjectIds: [ALICE, BOB] } : {};
    assert.equal(commit(f, variant, result.state, { proposalId: `${f.rootActionId}:new`, ...change }).kind, "rejected");
    if (variant.kind === "relationship") {
      const updated = commit(f, variant, result.state, { proposalId: `${f.rootActionId}:update`, change: "已恢复谨慎的信任。" });
      assert.equal(updated.kind, "committed", JSON.stringify(updated));
      const events = [...f.prefix, ...result.events, ...updated.events], replay = f.runtime.replay(f.genesis, events);
      assert.deepEqual(replay.state, updated.state);
      const corrected = f.runtime.step(f.profiles, replay.state, { kind: "applyServiceCorrection",
        correctionAuthority: { kind: "roomCorrectionAuthority", capability: replay.state.correctionRuntime.authorityCapability },
        correctionId: "correction:relationship-update", targetReceiptId: updated.receipt.receiptId, actorCharacterId: ALICE,
        errorKind: "rulesMisapplication", publicExplanation: "恢复此前关系。", basis: { stateHash: replay.head.stateHash, eventHash: replay.head.eventHash } });
      assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
      assert.deepEqual(corrected.state.campaignRuntime.relationships[variant.id], result.state.campaignRuntime.relationships[variant.id]);
      assert.deepEqual(f.runtime.replay(f.genesis, [...events, ...corrected.events]).state, corrected.state);
    }
  }
});

test("Claims require the precise participant event grant and refuse authority fields inside a commitment", () => {
  const f = fixture("grant"), variant = variants[0], result = commit(f, variant);
  const authority = deriveAuthorityClaimsFromCommittedRange({ receipt: result.receipt, actorCharacterId: ALICE,
    priorState: f.state, state: result.state, events: result.events });
  const refs = [ALICE, NPC, variant.id, "visibility:relationship-participants"];
  const withoutEvent = projectRenderableClaims(authority, { viewerKey: "viewer:test", refs });
  assert.equal(withoutEvent.claims.some(c => c.kind === "socialCommitment"), false);
  const value = projection(f, result).renderableClaims, malformed = structuredClone(value);
  malformed.claims.find(c => c.kind === "socialCommitment").commitment.basisFactIds = [BASIS];
  assert.equal(frozenRenderableClaimsConform(malformed), false);
  assert.equal(committedRangeUsesFrozenRenderableClaims([{ eventType: "PromiseMade" }, { eventType: "SocialCheckResolved" }]), false);
});
