import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE,
  PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { npcOwnRequiredContext } from "../../../app/_runtime/lib/kp/vnext/npc-work.ts";
import { authoritySpatialRefVisibleTo } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { HIDE_COVER_DC_ADJUSTMENT, hideCover, hideObserverCandidates, hiddenFollowupDrafts, hiddenFromIds } from "../../../app/_runtime/lib/rules/v2/hiding.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { stepActionToDecision, committedActionRange } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { parseWithNpcReplies } from "../../support/fixtures/vnext-npc-replies.mjs";

// SPEC 0004 §4 (ADR 0093, ADR 0094): hiding and searching outside combat.
// The hide is a concealed Dexterity (Stealth) check with a `hide` effect in
// both branches. Rules compares its total with each aware NPC in the scene:
// one that cannot see is fooled outright, any other when the total beats its
// threshold plus the cover adjustment (none +5, half +2, three-quarters 0,
// full -2). Player characters are never compared (SPEC 0005 §6.2). The record
// is `conditions.hidden` on the hider; those it is hidden from lose it from
// their views and their KP-citable refs. Moving re-weighs each pair; attacking,
// speaking, being perceived and a Perception check that meets the total end
// it. Each plan is lowered as a concealed check and its effects replaced, as
// the other effect tests do.

const LOW = "npc:hide-lian", HIGH = "npc:hide-odo";
const at = (x, y) => ({ x: String(x), y: String(y), elevation: "0" });
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** A brick wall between the actor at (100,100) and both NPCs south of it. */
const WALL = { kind: "barrier", label: "砖墙", state: "present", polygon: rectangle("40", "160", "300", "170"), elevation: "0", height: "96",
  opaque: true, impassable: true, cover: "full", propagation: "blocks", terrain: "normal" };
/** The same wall, waist-high: half cover. */
const LOW_WALL = { ...WALL, label: "矮墙", height: "40", cover: "half" };
/** No wall: the fixture's valve, see-through and walkable. */
const OPEN = {};
/** Odo is keen-eyed: Wisdom 18 and proficient, passive Perception 16. Lian keeps 10. */
const KEEN = { [HIGH]: { abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 }, proficientSkills: ["perception"] } };

/** The actor at (100,100), the other player across the room at (500,100),
 * Lian at (100,300) and Odo at (220,300). */
function fixture(name, featureOverrides = WALL, options = {}) {
  return createAuthoredProbeFixture(`hide:${name}`, { npcCharacters: [{ id: LOW, name: "莉安" }, { id: HIGH, name: "奥多" }],
    spawnPoints: [at(100, 100), at(500, 100), at(100, 300), at(220, 300)], featureOverrides, characterOverrides: KEEN, ...options });
}

const outcome = (code, summary, extra = {}) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [],
  pressures: [], opportunities: [], ...extra });
const HIDE = { kind: "hide" };

/** A concealed Stealth check behind the wall, mainly from Lian. */
function hideBundle({ skill = "stealth", primary = LOW } = {}) {
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill, dc: null, mode: "normal",
      risk: "可能被人看见。", successOutcome: "躲好了。", failureOutcome: "露了行迹。",
      concealment: { primaryObserverRef: primary, sense: "sight", evidence: "看见有人往墙后一闪。", observers: [] } },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "躲到墙后。", method: "贴着墙蹲下。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("hidden", "躲好了。"), failure: outcome("seen", "露了行迹。") } }] };
}

/** A plain act with no check, for the refusals. */
function plainBundle() {
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "蹲下了。" },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "蹲到墙后。", method: "蹲下。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("crouched", "蹲下了。"), failure: { kind: "none" } } }] };
}

/** Each branch gets its own copies: Rules refuses an input that shares one object twice. */
const effects = (success, failure = success) => plan => {
  plan.branches.success.effects = JSON.parse(JSON.stringify(success)); plan.branches.failure.effects = JSON.parse(JSON.stringify(failure));
};

function parse(bundle) {
  const parsed = bundle.proposals.some(entry => entry.kind === "social")
    ? parseWithNpcReplies(encodeVNextStrictToolBundle(bundle), bundle)
    : parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return parsed.bundle;
}

/** The actor's act from `state`, with its own frozen context. */
function actorAt(f, state, suffix) {
  const rootActionId = `${f.rootActionId}:${suffix}`;
  return { ...f, state, rootActionId, requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE, LOW, HIGH] }).context };
}

/** Lowers the actor's `bundle` from `state` and lets `edit` change the frozen plan. */
function frozen(f, bundle, edit, state, suffix) {
  const lowered = lowerVNext2ProposalBundle({ ...actorAt(f, state, suffix), value: parse(bundle) });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = structuredClone(lowered.command.rulesInput);
  edit(atomicCompletionInput(input).steps[0].rulesInput.plan);
  return input;
}

/** Lowers an NPC's own `bundle` from `state`. */
function npcFrozen(f, npcId, bundle, state, suffix) {
  const root = `${f.rootActionId}:${suffix}`;
  const context = npcOwnRequiredContext(state, f.profiles, f.moduleProfile, npcId, root, { submissionRef: `npc-work:${root}`, actorRef: npcId,
    text: "看看四周。" });
  assert.ok(context, "the NPC's own context");
  // On the spot, so the act takes no fiction time and settles at once.
  const lowered = lowerVNext2ProposalBundle({ value: parse(bundle), requiredContext: context, state, profiles: f.profiles,
    rootActionId: context.binding.rootActionId, actorCharacterId: npcId, onTheSpot: true });
  return lowered;
}

/** Runs to the end, rolling `rolls` when a check asks for them. */
function run(f, input, state, rolls) {
  const first = stepActionToDecision(f.runtime, f.profiles, state, input);
  if (rolls === undefined) {
    assert.equal(first.kind, "committed", JSON.stringify(first.kind === "rejected" ? first.rejection : first.kind));
    return first;
  }
  assert.equal(first.kind, "awaitingRandomness", JSON.stringify(first.kind === "rejected" ? first.rejection : first.kind));
  const result = f.runtime.step(f.profiles, first.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(first.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { ...result, events: [...first.events, ...result.events] };
}

function refused(f, input, reason, state) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(result.kind, "rejected", reason);
  assert.ok(JSON.stringify(result.rejection).includes(reason), JSON.stringify(result.rejection));
}

/** The actor hides with a Stealth total of `roll` (it has no Dexterity or
 * proficiency bonus). An NPC that noticed the covert act gets one reaction
 * (SPEC 0006 §7); it declines here, so the next act may follow. `result` is
 * the hide's own commit, `state` and `events` include the declines. */
function hide(f, roll, state = f.state, suffix = `hide:${roll}`) {
  const result = run(f, frozen(f, hideBundle(), effects([HIDE]), state, suffix), state, [roll]);
  let after = result.state;
  const events = [...result.events];
  for (const due of dueActivityDescriptors(result.state).filter(work => work.npcReaction !== undefined)) {
    const closed = f.runtime.step(f.profiles, after, { kind: "resolveNpcReaction", proposalId: due.childRootActionId,
      reactionId: due.npcReaction.reactionId, reactionHash: due.npcReaction.reactionHash, decision: { kind: "decline", reason: "不想多事。" } });
    assert.equal(closed.kind, "committed", JSON.stringify(closed));
    after = closed.state;
    events.push(...closed.events);
  }
  return { result, state: after, events };
}

function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}

const PEER_VIEWER = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target", sessionVersion: 1, characterId: PEER };
const npcViewer = npcId => ({ kind: "npc", npcId, purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });
function view(f, state, viewer, committed, actorCharacterId = ACTOR) {
  const projected = f.runtime.project(f.profiles, state, viewer, committed === undefined ? undefined : { channel: "realtime",
    committedRange: committedActionRange(state, { receiptId: committed.result.receipt.receiptId, actorCharacterId, priorState: committed.priorState,
      events: committed.result.events }) });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}
/** Whether `viewer` sees the actor: on its map, among its entities and as a ref its acts may cite. */
function seesActor(f, state, viewer, viewerId) {
  const projected = view(f, state, viewer);
  const onMap = projected.tacticalProjection.visibleEntities.some(entity => entity.id === ACTOR);
  const listed = Object.hasOwn(projected.entities ?? {}, ACTOR);
  const citable = authoritySpatialRefVisibleTo(state, ACTOR, SCENE, viewerId);
  assert.equal(onMap, listed, "the map and the entity list agree");
  assert.equal(onMap, citable, "what an act may cite follows what is seen");
  return onMap;
}

const resolved = events => events.filter(event => event.eventType === "WorldInteractionResolved").at(-1).payload;
const applied = (events, kind) => resolved(events).appliedEffects.filter(effect => effect.kind === kind);
const hiddenOf = (state, id = ACTOR) => state.combatRuntime.entities[id].conditions.hidden;

test("the cover adjustments are the four values the KP and the SPEC cite", () => {
  assert.deepEqual(HIDE_COVER_DC_ADJUSTMENT, { none: 5, half: 2, threeQuarters: 0, full: -2 });
  const f = fixture("covers");
  assert.deepEqual([hideCover(f.state, LOW, ACTOR), hideCover(f.state, HIGH, ACTOR)], ["full", "full"]);
  assert.deepEqual([hideCover(fixture("covers-low", LOW_WALL).state, LOW, ACTOR), hideCover(fixture("covers-open", OPEN).state, LOW, ACTOR)],
    ["half", "none"]);
});

test("behind full cover a total of 12 beats Lian's 10 - 2 but not Odo's 16 - 2; Lian loses the actor, everyone else keeps it; replay agrees", () => {
  const f = fixture("full");
  const hid = hide(f, 12);
  assert.deepEqual(hiddenOf(hid.state), { stealthTotal: "12", fromIds: [LOW] });
  assert.deepEqual(applied(hid.events, "hid"), [{ kind: "hid", characterRef: ACTOR, stealthTotal: "12", fromIds: [LOW] }]);
  const changed = hid.events.filter(event => event.eventType === "ConditionChanged" && event.payload.entityId === ACTOR);
  assert.deepEqual(changed.map(event => [event.payload.conditions.hidden, event.visibilityPolicyId, event.secrecy]),
    [[{ stealthTotal: "12", fromIds: [LOW] }, "visibility:room-authority-only", "internal"]]);
  assert.deepEqual(replayed(f, hid.events), hid.state);

  assert.equal(seesActor(f, hid.state, npcViewer(LOW), LOW), false, "Lian");
  assert.equal(seesActor(f, hid.state, npcViewer(HIGH), HIGH), true, "Odo");
  assert.equal(seesActor(f, hid.state, PEER_VIEWER, PEER), true, "the other player is never compared");
  const own = view(f, hid.state, f.viewer);
  assert.ok(own.tacticalProjection.self.publicStates.includes("condition:hidden"), JSON.stringify(own.tacticalProjection.self));
  assert.equal(view(f, hid.state, PEER_VIEWER).tacticalProjection.visibleEntities.find(entity => entity.id === ACTOR)
    .publicStates.includes("condition:hidden"), false, "only the hider's own map says it hides");
  assert.deepEqual(own.entities[ACTOR].conditions.hidden, { stealthTotal: "12", fromIds: [LOW] });
  for (const viewer of [PEER_VIEWER, npcViewer(HIGH)]) {
    assert.equal(view(f, hid.state, viewer).entities[ACTOR].conditions.hidden, undefined, "whom it hides from is the hider's own record");
  }

  // The actor's claim names whom it slipped from; Lian, who no longer sees
  // it and did not notice the act (12 is not below her 10), is not told.
  const committed = { result: hid.result, priorState: f.state };
  const claim = view(f, hid.result.state, f.viewer, committed).renderableClaims.claims.find(entry => entry.outcomeCode === "hid");
  assert.deepEqual([claim?.actorRef, claim?.targetRefs, claim?.summary], [ACTOR, [LOW], "该角色躲进了掩蔽处，这些在场者暂时看不到其位置。"]);
  const lian = view(f, hid.result.state, npcViewer(LOW), committed);
  assert.equal((lian.renderableClaims?.claims ?? []).some(entry => entry.actorRef === ACTOR || entry.outcomeCode === "hid"), false,
    JSON.stringify(lian.renderableClaims?.claims));

  // At 9 the concealed check fails against Lian's bare 10: she notices the
  // act and is told what she saw, yet the cover still decides that she lost
  // where the actor went (9 beats 10 - 2).
  const noticed = hide(fixture("full-noticed"), 9);
  assert.equal(resolved(noticed.events).branch, "failure");
  assert.deepEqual(noticed.events.filter(event => event.eventType === "SensoryEvidenceAcquired").map(event => event.payload.characterId).sort(),
    [HIGH, LOW].sort());
  assert.deepEqual(hiddenOf(noticed.state), { stealthTotal: "9", fromIds: [LOW] });
});

test("in the open the DC is 5 higher: 15 does not beat Lian's 15, 16 does; Odo needs more than 21", () => {
  const f = fixture("open", OPEN);
  const seen = hide(f, 15);
  assert.equal(hiddenOf(seen.state), undefined);
  assert.deepEqual(applied(seen.events, "hid"), [{ kind: "hid", characterRef: ACTOR, stealthTotal: "15", fromIds: [] }]);
  assert.equal(seesActor(f, seen.state, npcViewer(LOW), LOW), true);
  const hid = hide(f, 16);
  assert.deepEqual(hiddenOf(hid.state), { stealthTotal: "16", fromIds: [LOW] });
  assert.deepEqual(replayed(f, hid.events), hid.state);
  // A blinded NPC cannot see at all and is fooled by any total.
  const blind = structuredClone(f.state);
  blind.combatRuntime.entities[HIGH].conditions = { blinded: true };
  assert.deepEqual(hiddenFromIds(f.profiles, blind, ACTOR, 1, undefined, new Set()), [HIGH]);
});

test("a half-cover hide breaks when the hider steps into the open; a full-cover hide survives a short move along the wall", () => {
  const half = fixture("half", LOW_WALL);
  const hid = hide(half, 13);
  assert.deepEqual(hiddenOf(hid.state), { stealthTotal: "13", fromIds: [LOW] }, "13 beats 10 + 2, not Odo's 16 + 2");
  const out = half.runtime.step(half.profiles, hid.state, { kind: "repositionCharacter", rootActionId: "root:hide:step-out",
    characterId: ACTOR, destination: { kind: "point", position: at(500, 500) } });
  assert.equal(out.kind, "committed", JSON.stringify(out));
  assert.equal(hideCover(out.state, LOW, ACTOR), "none");
  assert.deepEqual(out.events.map(event => event.eventType), ["CharacterRepositioned", "ConditionChanged"], "13 no longer beats 10 + 5");
  assert.equal(hiddenOf(out.state), undefined);
  assert.equal(seesActor(half, out.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(half, [...hid.events, ...out.events]), out.state);

  const full = fixture("full-move");
  const behind = hide(full, 9);
  const along = full.runtime.step(full.profiles, behind.state, { kind: "repositionCharacter", rootActionId: "root:hide:along",
    characterId: ACTOR, destination: { kind: "point", position: at(160, 100) } });
  assert.equal(along.kind, "committed", JSON.stringify(along));
  assert.equal(hideCover(along.state, LOW, ACTOR), "full");
  assert.deepEqual(along.events.map(event => event.eventType), ["CharacterRepositioned"], "9 still beats 10 - 2");
  assert.deepEqual(hiddenOf(along.state), { stealthTotal: "9", fromIds: [LOW] });
  assert.deepEqual(replayed(full, [...behind.events, ...along.events]), along.state);
});

test("Lian walking round the end of the wall sees the actor again; a move never adds anyone", () => {
  const f = fixture("walk-round");
  const hid = hide(f, 9);
  const walk = { mode: "adjudication", basisRefs: [SCENE], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "绕过了墙。" },
    proposals: [{ basisRefs: [SCENE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "绕到墙的另一头。", method: "沿着墙走过去。", targetRefs: [SCENE], directTargetRefs: [SCENE], instrumentRefs: [], abilityRef: { kind: "none" },
      approach: { kind: "point", x: "400", y: "130" }, branches: { success: outcome("round", "绕过了墙。"), failure: { kind: "none" } } }] };
  // While hidden from her, the actor is no ref her own act may name.
  const toActor = structuredClone(walk);
  toActor.proposals[0].approach = { kind: "nextTo", ref: ACTOR };
  assert.notEqual(npcFrozen(f, LOW, toActor, hid.state, "lian-to-actor").kind, "accepted");
  assert.equal(npcFrozen(f, HIGH, toActor, hid.state, "odo-to-actor").kind, "accepted", "Odo still may");
  const lowered = npcFrozen(f, LOW, walk, hid.state, "lian-walk");
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const walked = run(f, lowered.command.rulesInput, hid.state);
  const types = walked.events.map(event => event.eventType);
  const moved = types.indexOf("CharacterRepositioned"), unhidden = walked.events.findIndex(event => event.eventType === "ConditionChanged"
    && event.payload.entityId === ACTOR);
  assert.ok(moved >= 0 && unhidden > moved, types.join());
  assert.equal(hideCover(walked.state, LOW, ACTOR), "none");
  assert.equal(hiddenOf(walked.state), undefined);
  assert.equal(seesActor(f, walked.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...walked.events]), walked.state);

  // A move only ever drops NPCs: blinded now, Odo would be fooled by a new
  // hide, but re-weighing after a move leaves him out.
  const blind = structuredClone(hid.state);
  blind.combatRuntime.entities[HIGH].conditions = { blinded: true };
  assert.deepEqual(hiddenFromIds(f.profiles, blind, ACTOR, 9, undefined, new Set()), [LOW, HIGH].sort());
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, blind, walked.events[moved]), [], "Lian is still behind the wall there");
});

test("Lian's Perception check finds the actor when it meets the Stealth total, not when it falls one short; replay agrees", () => {
  const f = fixture("search");
  const hid = hide(f, 9);
  const look = { mode: "adjudication", basisRefs: [SCENE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "wis", skill: "perception", dc: 15, mode: "normal",
      risk: "可能什么也看不出。", successOutcome: "看清了四周。", failureOutcome: "没看出什么。" },
    proposals: [{ kind: "observe", basisRefs: [SCENE], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      inquiry: "墙那边有没有人？", method: "仔细打量四周。", focusRefs: [SCENE], existingFactRefs: [],
      branches: { success: { outcomeCode: "outcome:looked", summary: "看清了四周。", sensoryEvidence: [{ observerRef: LOW, subjectRef: SCENE,
        sense: "sight", evidence: "廊道里很安静。", basisRefs: [SCENE] }], characterInferences: [] },
      failure: { outcomeCode: "outcome:missed", summary: "没看出什么。", sensoryEvidence: [{ observerRef: LOW, subjectRef: SCENE,
        sense: "sight", evidence: "砖墙挡住了一半视线。", basisRefs: [SCENE] }], characterInferences: [] } } }] };
  const lowered = npcFrozen(f, LOW, look, hid.state, "lian-look");
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));

  const short = run(f, lowered.command.rulesInput, hid.state, [8]);
  assert.deepEqual(hiddenOf(short.state), { stealthTotal: "9", fromIds: [LOW] });
  assert.deepEqual(applied(short.events, "foundHidden"), []);

  const met = run(f, lowered.command.rulesInput, hid.state, [9]);
  assert.equal(resolved(met.events).branch, "failure", "the KP's DC 15 is untouched; the finding is a fixed comparison");
  assert.equal(hiddenOf(met.state), undefined);
  assert.deepEqual(applied(met.events, "foundHidden"), [{ kind: "foundHidden", characterRef: ACTOR }]);
  assert.equal(seesActor(f, met.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...met.events]), met.state);
  const claim = view(f, met.state, f.viewer, { result: met, priorState: hid.state }, LOW).renderableClaims.claims
    .find(entry => entry.outcomeCode === "foundHidden");
  assert.deepEqual([claim?.actorRef, claim?.targetRefs, claim?.summary], [LOW, [ACTOR], "该角色发现了躲藏者的位置。"]);
});

test("speaking to Odo ends the actor's hiding once the conversation settles; an attack ends it too", () => {
  const f = fixture("speak");
  const hid = hide(f, 9);
  const reply = { outcomeCode: "outcome:answers", summary: "奥多答了一句。", npcPerceives: null,
    response: { kind: "speech", text: "你躲那儿干什么？", motive: "觉得奇怪。", basis: [{ kind: "npcContext", ref: HIGH }] }, consequences: [] };
  const talk = { mode: "adjudication", basisRefs: [HIGH], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "低声说了一句。" },
    proposals: [{ kind: "social", basisRefs: [HIGH], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: HIGH,
      actorSpeech: "别出声。", goal: "让奥多别声张。", method: "压低声音说。", communication: "spokenConversation", audience: "participants",
      branches: { success: reply, failure: { kind: "none" } } }] };
  const spoke = run(f, frozen(f, talk, () => {}, hid.state, "speak"), hid.state);
  const types = spoke.events.map(event => event.eventType);
  const ended = spoke.events.findIndex(event => event.eventType === "ConditionChanged" && event.payload.entityId === ACTOR);
  assert.ok(ended > types.indexOf("WorldInteractionResolved"), types.join());
  assert.equal(hiddenOf(spoke.state), undefined);
  assert.equal(seesActor(f, spoke.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...spoke.events]), spoke.state);

  // A combat attack the hider makes ends it for everyone, as Rules' own
  // follow-up of the attack.
  const attack = { eventType: "AbilityInvoked", rootActionId: "root:hide:attack", payload: { sourceEntityId: ACTOR,
    abilityRef: "ability:test", mechanicalResult: { attack: { rolls: [12], total: 14, hit: true } }, sourcePatch: {} } };
  const drafts = hiddenFollowupDrafts(f.profiles, hid.state, attack);
  assert.deepEqual(drafts.map(draft => [draft.payload.entityId, draft.payload.conditions.hidden]), [[ACTOR, undefined]]);
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, { ...attack, payload: { ...attack.payload, sourceEntityId: HIGH } }), []);
});

test("an NPC the outcome says perceives the actor is not hidden from, or stops being so", () => {
  const f = fixture("perceived");
  const heard = evidence => [{ observerRef: LOW, subjectRef: ACTOR, sense: "hearing", evidence, basisRefs: [ACTOR] }];
  // The hide itself: the branch says Lian hears the actor scrape the wall, so
  // only Odo, whose 16 - 2 a total of 20 beats, loses it.
  const loud = frozen(f, hideBundle(), plan => {
    effects([HIDE])(plan);
    for (const branch of [plan.branches.success, plan.branches.failure]) {
      branch.sensoryEvidence = heard("墙后传来鞋底蹭地的声音。").map(entry => ({ ...entry, visibilityPolicyRef: `visibility:knowledge-holder:${LOW}` }));
    }
  }, f.state, "loud");
  const scraped = run(f, loud, f.state, [20]);
  assert.deepEqual(hiddenOf(scraped.state), { stealthTotal: "20", fromIds: [HIGH] });
  assert.deepEqual(replayed(f, scraped.events), scraped.state);

  // Later the hidden actor taps the wall; Lian hears it and has it again.
  const hid = hide(f, 9);
  const tap = { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "会被听见。", successOutcome: "敲了敲墙。" },
    proposals: [{ basisRefs: [SOURCE, ACTOR], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "敲墙试探。", method: "用指节敲两下墙。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("tapped", "敲了两下墙。", { sensoryEvidence: heard("墙那边有人敲了两下。") }), failure: { kind: "none" } } }] };
  const tapped = run(f, frozen(f, tap, () => {}, hid.state, "tap"), hid.state);
  assert.equal(hiddenOf(tapped.state), undefined);
  const types = tapped.events.map(event => event.eventType);
  assert.ok(types.indexOf("ConditionChanged") < types.indexOf("SensoryEvidenceAcquired"), types.join());
  assert.equal(seesActor(f, tapped.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...tapped.events]), tapped.state);
});

test("Rules refuses a hide that is not a concealed Stealth check, twice or beside a move; nobody aware means nobody to hide from", () => {
  const f = fixture("refusals");
  refused(f, frozen(f, plainBundle(), effects([HIDE], []), f.state, "plain"), "hide:needs-concealed-stealth-check", f.state);
  refused(f, frozen(f, hideBundle({ skill: "sleight" }), effects([HIDE]), f.state, "sleight"), "hide:needs-concealed-stealth-check", f.state);
  refused(f, frozen(f, hideBundle(), effects([HIDE, HIDE]), f.state, "twice"), "hide:one-per-outcome", f.state);
  refused(f, frozen(f, hideBundle(), effects([HIDE, { kind: "jumpOver", featureRef: "feature:probe-valve", landProne: false }]), f.state, "jump"),
    "hide:one-per-outcome", f.state);

  // Both NPCs asleep: nobody aware to hide from, and players never count.
  // A concealed check already needs an aware NPC to hide from, so the
  // refusal (`hide:no-one-to-hide-from`) only guards a scene emptied in
  // between; its candidate list is what it reads.
  const asleep = structuredClone(f.state);
  for (const id of [LOW, HIGH]) asleep.combatRuntime.entities[id].conditions = { unconscious: true, prone: true };
  assert.deepEqual(hideObserverCandidates(f.state, ACTOR), [HIGH, LOW].sort());
  assert.deepEqual(hideObserverCandidates(asleep, ACTOR), []);

});
