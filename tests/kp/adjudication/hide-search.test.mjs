import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE,
  PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { npcOwnRequiredContext } from "../../../app/_runtime/lib/kp/vnext/npc-work.ts";
import { authoritySpatialRefVisibleTo } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { PERCEPTION_COVER_ADJUSTMENT, hideCover, hidingObservers, hiddenFollowupDrafts } from "../../../app/_runtime/lib/rules/v2/hiding.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { stepActionToDecision, committedActionRange } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { parseWithNpcReplies } from "../../support/fixtures/vnext-npc-replies.mjs";

// SPEC 0004 §4 (ADR 0097): hiding and searching outside encounters. The hide
// is a concealed Dexterity (Stealth) check whose total the hider keeps as
// `conditions.hidden`; from then on its opponents -- NPCs for a player
// character, player characters for an NPC -- do not see it, its own side
// does. After every action committed in the scene, each opponent that can see
// the hider (not behind full cover from it, not blinded) rolls Perception
// with the action's own dice; roll + modifier + cover adjustment (none +5,
// half +2, three-quarters 0) reaching the Stealth total finds it, and the
// hiding ends for everyone. A Perception search does the same. Attacking,
// speaking, being perceived in an outcome and leaving the scene end it.

const LOW = "npc:hide-lian", HIGH = "npc:hide-odo";
const at = (x, y) => ({ x: String(x), y: String(y), elevation: "0" });
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** A brick wall between the actor at (100,100) and Lian at (100,300). */
const WALL = { kind: "barrier", label: "砖墙", state: "present", polygon: rectangle("40", "160", "300", "170"), elevation: "0", height: "96",
  opaque: true, impassable: true, cover: "full", propagation: "blocks", terrain: "normal" };
/** The same wall, waist-high: half cover. */
const LOW_WALL = { ...WALL, label: "矮墙", height: "40", cover: "half" };
/** No wall: the fixture's valve, see-through and walkable. */
const OPEN = {};
/** Odo is keen-eyed: Wisdom 18 and proficient, Perception +6. Lian has +0. */
const KEEN = { [HIGH]: { abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 }, proficientSkills: ["perception"] } };
/** The actor at (100,100), the other player across the room at (500,100),
 * Lian at (100,300) and Odo at (220,300), both behind the wall. */
const BEHIND = [at(100, 100), at(500, 100), at(100, 300), at(220, 300)];
/** Odo standing in the open on the actor's side of the wall instead. */
const ODO_IN_THE_OPEN = [at(100, 100), at(500, 500), at(100, 300), at(400, 100)];

function fixture(name, featureOverrides = WALL, spawnPoints = BEHIND) {
  return createAuthoredProbeFixture(`hide:${name}`, { npcCharacters: [{ id: LOW, name: "莉安" }, { id: HIGH, name: "奥多" }],
    spawnPoints, featureOverrides, characterOverrides: KEEN });
}

const outcome = (code, summary, extra = {}) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [],
  pressures: [], opportunities: [], ...extra });
const HIDE_SCRIPT = { kind: "hide", targetRef: null, destinationRef: null, option: "none" };
const HIDE = { kind: "hide" };
const targets = refs => ({ targetRefs: refs, directTargetRefs: refs });

/** The hide common action: a concealed Stealth check, mainly from `primary`. */
function hideBundle({ primary = LOW, skill = "stealth", durationMicros = "300000000", commonAction = HIDE_SCRIPT, ref = SOURCE } = {}) {
  return { mode: "adjudication", basisRefs: [ref], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros, checkKind: "abilityCheck", ability: "dex", skill, dc: null, mode: "normal",
      risk: "可能被人看见。", successOutcome: "躲好了。", failureOutcome: "露了行迹。",
      concealment: { primaryObserverRef: primary, sense: "sight", evidence: "看见有人往墙后一闪。", observers: [] } },
    proposals: [{ basisRefs: [ref], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      // The script adds the hider itself as the target; the scene is no target.
      intent: "躲到墙后。", method: "贴着墙蹲下。", ...targets(ref === SCENE ? commonAction === null ? [primary] : [] : [ref]),
      instrumentRefs: [], abilityRef: { kind: "none" },
      ...(commonAction === null ? {} : { commonAction }),
      branches: { success: outcome("hidden", "躲好了。"), failure: outcome("seen", "露了行迹。") } }] };
}

/** A plain act with no check; an NPC's own act names the scene, which its context holds. */
function plainBundle({ durationMicros = "300000000", success = outcome("crouched", "蹲着没动。"), approach, ref = SOURCE } = {}) {
  return { mode: "adjudication", basisRefs: [ref], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros, risk: "没有风险。", successOutcome: success.summary },
    proposals: [{ basisRefs: [ref], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "蹲着不动。", method: "屏住呼吸。", targetRefs: [ref], directTargetRefs: [ref], instrumentRefs: [], abilityRef: { kind: "none" },
      ...(approach === undefined ? {} : { approach }), branches: { success, failure: { kind: "none" } } }] };
}

/** A Perception search of the room with the KP's DC 15. */
function lookBundle(observerRef, durationMicros = "0") {
  return { mode: "adjudication", basisRefs: [SCENE], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros, checkKind: "abilityCheck", ability: "wis", skill: "perception", dc: 15, mode: "normal",
      risk: "可能什么也看不出。", successOutcome: "看清了四周。", failureOutcome: "没看出什么。" },
    proposals: [{ kind: "observe", basisRefs: [SCENE], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      inquiry: "墙那边有没有人？", method: "仔细打量四周。", focusRefs: [SCENE], existingFactRefs: [],
      branches: { success: { outcomeCode: "outcome:looked", summary: "看清了四周。", sensoryEvidence: [{ observerRef, subjectRef: SCENE,
        sense: "sight", evidence: "廊道里很安静。", basisRefs: [SCENE] }], characterInferences: [] },
      failure: { outcomeCode: "outcome:missed", summary: "没看出什么。", sensoryEvidence: [{ observerRef, subjectRef: SCENE,
        sense: "sight", evidence: "矮墙挡住了一半视线。", basisRefs: [SCENE] }], characterInferences: [] } } }] };
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
  return { ...f, state, rootActionId, requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE] }).context };
}

/** Lowers the actor's `bundle` from `state`. */
function lowered(f, bundle, state, suffix) {
  return lowerVNext2ProposalBundle({ ...actorAt(f, state, suffix), value: parse(bundle) });
}

/** Lowers the actor's `bundle` from `state` and lets `edit` change the frozen plan. */
function frozen(f, bundle, edit, state, suffix) {
  const result = lowered(f, bundle, state, suffix);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  const input = structuredClone(result.command.rulesInput);
  edit(atomicCompletionInput(input).steps[0].rulesInput.plan);
  return input;
}

/** Lowers an NPC's own `bundle` from `state`, on the spot. */
function npcLowered(f, npcId, bundle, state, suffix) {
  const root = `${f.rootActionId}:${suffix}`;
  const context = npcOwnRequiredContext(state, f.profiles, f.moduleProfile, npcId, root, { submissionRef: `npc-work:${root}`, actorRef: npcId,
    text: "看看四周。" });
  assert.ok(context, "the NPC's own context");
  return lowerVNext2ProposalBundle({ value: parse(bundle), requiredContext: context, state, profiles: f.profiles,
    rootActionId: context.binding.rootActionId, actorCharacterId: npcId, onTheSpot: true });
}

/** Runs to the end; when the act waits for dice it is given `rolls`, which
 * must be exactly the faces it froze. */
function run(f, input, state, rolls) {
  const first = stepActionToDecision(f.runtime, f.profiles, state, input);
  if (rolls === undefined) {
    assert.equal(first.kind, "committed", JSON.stringify(first.kind === "rejected" ? first.rejection : first.kind));
    return { ...first, priorState: state };
  }
  assert.equal(first.kind, "awaitingRandomness", JSON.stringify(first.kind === "rejected" ? first.rejection : first.kind));
  assert.equal(first.randomnessRequest.dice.length, rolls.length, JSON.stringify(first.randomnessRequest.hazardRolls.map(spec => spec.purposeKey)));
  const result = f.runtime.step(f.profiles, first.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(first.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { ...result, events: [...first.events, ...result.events], priorState: state, request: first.randomnessRequest };
}

/** Any NPC reaction a noticed covert act opened is declined, so the next act may follow. */
function declineReactions(f, state, events) {
  let after = state;
  for (const due of dueActivityDescriptors(state).filter(work => work.npcReaction !== undefined)) {
    const closed = f.runtime.step(f.profiles, after, { kind: "resolveNpcReaction", proposalId: due.childRootActionId,
      reactionId: due.npcReaction.reactionId, reactionHash: due.npcReaction.reactionHash, decision: { kind: "decline", reason: "不想多事。" } });
    assert.equal(closed.kind, "committed", JSON.stringify(closed));
    after = closed.state;
    events.push(...closed.events);
  }
  return after;
}

/** The actor hides with `rolls`: its Stealth d20 (no Dexterity or
 * proficiency bonus), then the frozen Perception faces in code-unit order of
 * the opponents. `result` is the hide's own commit; `state` and `events`
 * include any declined reactions. */
function hide(f, rolls, state = f.state, suffix = `hide:${rolls.join("-")}`) {
  const result = run(f, lowered(f, hideBundle(), state, suffix).command.rulesInput, state, rolls);
  const events = [...result.events];
  return { result, state: declineReactions(f, result.state, events), events };
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
    committedRange: committedActionRange(state, { receiptId: committed.receipt.receiptId, actorCharacterId, priorState: committed.priorState,
      events: committed.events }) });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}
/** Whether `viewer` sees `targetId`: on its map, among its entities and as a ref its acts may cite. */
function sees(f, state, viewer, viewerId, targetId = ACTOR) {
  const projected = view(f, state, viewer);
  const onMap = projected.tacticalProjection.visibleEntities.some(entity => entity.id === targetId);
  const listed = Object.hasOwn(projected.entities ?? {}, targetId);
  const citable = authoritySpatialRefVisibleTo(state, targetId, SCENE, viewerId);
  assert.equal(onMap, listed, "the map and the entity list agree");
  assert.equal(onMap, citable, "what an act may cite follows what is seen");
  return onMap;
}
const ACTOR_VIEWER = f => f.viewer;

const resolved = events => events.filter(event => event.eventType === "WorldInteractionResolved").at(-1).payload;
const applied = (events, kind) => resolved(events).appliedEffects.filter(effect => effect.kind === kind);
const hiddenOf = (state, id = ACTOR) => state.combatRuntime.entities[id].conditions.hidden;
const perceptions = events => events.filter(event => event.eventType === "HiddenPerceptionRolled").map(event => event.payload);
const roll = (perceiverRef, face, modifier, coverAdjustment) => ({ perceiverRef, roll: face, modifier, coverAdjustment,
  total: face + modifier + coverAdjustment });

test("the cover adjustments are the three values the SPEC cites; full cover takes the hider out of sight", () => {
  assert.deepEqual(PERCEPTION_COVER_ADJUSTMENT, { none: 5, half: 2, threeQuarters: 0 });
  assert.deepEqual([hideCover(fixture("covers").state, LOW, ACTOR), hideCover(fixture("covers-low", LOW_WALL).state, LOW, ACTOR),
    hideCover(fixture("covers-open", OPEN).state, LOW, ACTOR)], ["full", "half", "none"]);
});

test("behind half cover a Stealth 15 holds while Lian and Odo roll short; a later act where Lian reaches 15 finds the actor for everyone; replay agrees", () => {
  const f = fixture("half", LOW_WALL);
  assert.deepEqual([hideCover(f.state, LOW, ACTOR), hideCover(f.state, HIGH, ACTOR)], ["half", "half"]);
  // The hide's own action: Stealth 15, then Lian 1 + 0 + 2 and Odo 1 + 6 + 2.
  const hid = hide(f, [15, 1, 1]);
  assert.deepEqual(hiddenOf(hid.state), { stealthTotal: "15" });
  assert.deepEqual(applied(hid.result.events, "hid"), [{ kind: "hid", characterRef: ACTOR, stealthTotal: "15" }]);
  assert.deepEqual(perceptions(hid.events), [{ hiderRef: ACTOR, sceneRef: SCENE, stealthTotal: "15",
    rolls: [roll(LOW, 1, 0, 2), roll(HIGH, 1, 6, 2)], foundByRef: null }]);
  const recorded = hid.events.find(event => event.eventType === "HiddenPerceptionRolled");
  assert.deepEqual([recorded.visibilityPolicyId, recorded.secrecy], ["visibility:room-authority-only", "internal"]);
  assert.deepEqual(replayed(f, hid.events), hid.state);

  // Every opponent loses it; the other player, its own side, does not.
  assert.equal(sees(f, hid.state, npcViewer(LOW), LOW), false, "Lian");
  assert.equal(sees(f, hid.state, npcViewer(HIGH), HIGH), false, "Odo");
  assert.equal(sees(f, hid.state, PEER_VIEWER, PEER), true, "the other player");
  const own = view(f, hid.state, f.viewer);
  assert.ok(own.tacticalProjection.self.publicStates.includes("condition:hidden"), JSON.stringify(own.tacticalProjection.self));
  assert.deepEqual(own.entities[ACTOR].conditions.hidden, { stealthTotal: "15" });
  assert.equal(view(f, hid.state, PEER_VIEWER).entities[ACTOR].conditions.hidden, undefined, "the Stealth total is the hider's own record");
  // While hidden, the actor is no ref an NPC's own act may name.
  const toActor = plainBundle({ durationMicros: "0", approach: { kind: "nextTo", ref: ACTOR }, ref: SCENE });
  assert.notEqual(npcLowered(f, LOW, toActor, hid.state, "lian-to-actor").kind, "accepted");
  assert.equal(npcLowered(f, LOW, toActor, f.state, "lian-to-actor-seen").kind, "accepted", "before the hide she may");

  // A later act of the actor's: Lian 12 + 2 and Odo 6 + 8 are 14, one short.
  const stay = run(f, lowered(f, plainBundle(), hid.state, "stay").command.rulesInput, hid.state, [12, 6]);
  assert.deepEqual(hiddenOf(stay.state), { stealthTotal: "15" });
  assert.deepEqual(perceptions(stay.events).map(entry => [entry.rolls, entry.foundByRef]),
    [[[roll(LOW, 12, 0, 2), roll(HIGH, 6, 6, 2)], null]]);
  assert.deepEqual(replayed(f, [...hid.events, ...stay.events]), stay.state);

  // Lian's 13 + 2 reaches 15: found, for everyone; Odo does not roll.
  const found = run(f, lowered(f, plainBundle(), hid.state, "found").command.rulesInput, hid.state, [13, 20]);
  assert.deepEqual(perceptions(found.events).map(entry => [entry.rolls, entry.foundByRef]), [[[roll(LOW, 13, 0, 2)], LOW]]);
  const types = found.events.map(event => event.eventType);
  assert.equal(types.at(-1), "ConditionChanged", types.join());
  assert.equal(types.at(-2), "HiddenPerceptionRolled", types.join());
  assert.equal(hiddenOf(found.state), undefined);
  for (const [viewer, id] of [[npcViewer(LOW), LOW], [npcViewer(HIGH), HIGH], [PEER_VIEWER, PEER]]) {
    assert.equal(sees(f, found.state, viewer, id), true, id);
  }
  assert.deepEqual(replayed(f, [...hid.events, ...found.events]), found.state);
  // The other player is told who found the actor; the rolls stay with the authority.
  const claims = view(f, found.state, PEER_VIEWER, found).renderableClaims.claims;
  const claim = claims.find(entry => entry.outcomeCode === "foundHidden");
  assert.deepEqual([claim?.actorRef, claim?.targetRefs, claim?.summary], [LOW, [ACTOR], "该角色发现了躲藏者的位置。"]);
  assert.equal(claims.some(entry => entry.outcomeCode === "stillHidden"), false);
});

test("anyone's act brings the rolls: Odo's own act rolls for him and for Lian", () => {
  const f = fixture("npc-act", LOW_WALL);
  const hid = hide(f, [15, 1, 1]);
  const idle = plainBundle({ durationMicros: "0", ref: SCENE });
  const loweredIdle = npcLowered(f, HIGH, idle, hid.state, "odo-idle");
  assert.equal(loweredIdle.kind, "accepted", JSON.stringify(loweredIdle));
  // Odo's 9 + 6 + 2 = 17 reaches 15 after Lian's 1 + 2 fell short.
  const looked = run(f, loweredIdle.command.rulesInput, hid.state, [1, 9]);
  assert.deepEqual(perceptions(looked.events).map(entry => [entry.rolls, entry.foundByRef]),
    [[[roll(LOW, 1, 0, 2), roll(HIGH, 9, 6, 2)], HIGH]]);
  assert.equal(hiddenOf(looked.state), undefined);
  assert.deepEqual(replayed(f, [...hid.events, ...looked.events]), looked.state);
});

test("an NPC with the hider behind full cover from it never rolls, even on a 20; a blinded one never rolls nor gets a die", () => {
  // Lian is behind the wall; Odo stands in the open on the actor's side.
  const f = fixture("mixed", WALL, ODO_IN_THE_OPEN);
  assert.deepEqual([hideCover(f.state, LOW, ACTOR), hideCover(f.state, HIGH, ACTOR)], ["full", "none"]);
  const hid = hide(f, [20, 20, 1]);
  assert.deepEqual(perceptions(hid.events), [{ hiderRef: ACTOR, sceneRef: SCENE, stealthTotal: "20",
    rolls: [roll(HIGH, 1, 6, 5)], foundByRef: null }], "Lian's 20 is never rolled");
  assert.deepEqual(hiddenOf(hid.state), { stealthTotal: "20" });
  assert.deepEqual(replayed(f, hid.events), hid.state);

  // Blinded, Odo gets no die: the hide freezes only the Stealth d20 and Lian's.
  const blind = structuredClone(f.state);
  blind.combatRuntime.entities[HIGH].conditions = { blinded: true };
  const dark = run(f, lowered(f, hideBundle(), blind, "blind").command.rulesInput, blind, [20, 20]);
  assert.deepEqual(dark.request.hazardRolls.map(spec => spec.frozenParameters.perceiverRef), [LOW]);
  assert.deepEqual(perceptions(dark.events), [], "Lian is behind full cover and Odo cannot see");
  assert.deepEqual(hiddenOf(dark.state), { stealthTotal: "20" });
});

test("an NPC hides from the players: its concealed check weighs them, it leaves their maps and citable refs until a player's search finds it", () => {
  const f = fixture("npc-hider", LOW_WALL);
  assert.deepEqual([hideCover(f.state, ACTOR, LOW), hideCover(f.state, PEER, LOW)], ["half", "none"]);
  // Only a hide takes players as the observers of a concealed check.
  const sneak = hideBundle({ primary: ACTOR, durationMicros: "0", commonAction: null, ref: SCENE });
  assert.deepEqual(npcLowered(f, LOW, sneak, f.state, "lian-sneak").issues, ["concealment:primary-observer-not-present"]);
  const loweredHide = npcLowered(f, LOW, hideBundle({ primary: ACTOR, durationMicros: "0", ref: SCENE }), f.state, "lian-hide");
  assert.equal(loweredHide.kind, "accepted", JSON.stringify(loweredHide));
  const plan = atomicCompletionInput(loweredHide.command.rulesInput).steps[0].rulesInput.plan;
  assert.deepEqual(plan.ruling.check.concealment.observers.map(observer => observer.observerRef), [ACTOR, PEER]);
  // Lian's Stealth 18; the actor's 1 + 0 + 2 and the other player's 1 + 0 + 5 fall short.
  const hid = run(f, loweredHide.command.rulesInput, f.state, [18, 1, 1]);
  assert.deepEqual(hiddenOf(hid.state, LOW), { stealthTotal: "18" });
  assert.deepEqual(perceptions(hid.events).map(entry => [entry.hiderRef, entry.rolls, entry.foundByRef]),
    [[LOW, [roll(ACTOR, 1, 0, 2), roll(PEER, 1, 0, 5)], null]]);
  const declined = [];
  const hiddenState = declineReactions(f, hid.state, declined);
  assert.deepEqual(replayed(f, hid.events), hid.state);
  // Stealth 7 fails the check against the actor's passive 10, which only
  // picks the failure branch: no player is told it noticed anything, and the
  // rolls (3 and 6) leave her hidden.
  const clumsy = run(f, loweredHide.command.rulesInput, f.state, [7, 1, 1]);
  assert.equal(resolved(clumsy.events).branch, "failure");
  assert.equal(resolved(clumsy.events).check.noticerRefs, undefined);
  assert.deepEqual(clumsy.events.filter(event => event.eventType === "SensoryEvidenceAcquired"), []);
  assert.deepEqual(hiddenOf(clumsy.state, LOW), { stealthTotal: "7" });

  assert.equal(sees(f, hiddenState, ACTOR_VIEWER(f), ACTOR, LOW), false, "the actor");
  assert.equal(sees(f, hiddenState, PEER_VIEWER, PEER, LOW), false, "the other player");
  assert.equal(sees(f, hiddenState, npcViewer(HIGH), HIGH, LOW), true, "Odo, her own side");
  // The actor's KP cannot name her: a walk up to her is refused.
  const toLian = plainBundle({ approach: { kind: "nextTo", ref: LOW } });
  assert.notEqual(lowered(f, toLian, hiddenState, "to-lian").kind, "accepted");
  // Nor does her Stealth roll reach the players' dice log.
  const delta = view(f, hid.state, f.viewer, hid, LOW).committedDelta;
  assert.ok(delta, "the actor's view of Lian's act has a delta");
  assert.equal(delta.changes.some(change => change.kind === "diceRolled" && change.characterId === LOW), false, JSON.stringify(delta.changes));

  // The actor searches: 15 + 2 is one short of 18, and the rolls after the
  // act fall short too; 16 + 2 finds her, whatever the KP's DC 15 made of it.
  const look = lowered(f, lookBundle(ACTOR, "300000000"), hiddenState, "look");
  assert.equal(look.kind, "accepted", JSON.stringify(look));
  const short = run(f, look.command.rulesInput, hiddenState, [15, 1, 1]);
  assert.deepEqual(hiddenOf(short.state, LOW), { stealthTotal: "18" });
  assert.deepEqual(applied(short.events, "foundHidden"), []);
  assert.equal(perceptions(short.events).length, 1);
  const met = run(f, look.command.rulesInput, hiddenState, [16, 1, 1]);
  assert.equal(resolved(met.events).branch, "success");
  assert.deepEqual(applied(met.events, "foundHidden"), [{ kind: "foundHidden", characterRef: LOW }]);
  assert.deepEqual(perceptions(met.events), [], "nobody is left hiding to roll against");
  assert.equal(hiddenOf(met.state, LOW), undefined);
  assert.equal(sees(f, met.state, ACTOR_VIEWER(f), ACTOR, LOW), true);
  assert.equal(sees(f, met.state, PEER_VIEWER, PEER, LOW), true);
  assert.ok(lowered(f, toLian, met.state, "to-lian-found").kind === "accepted", "now the KP may name her");
  assert.deepEqual(replayed(f, [...hid.events, ...declined, ...met.events]), met.state);
  const claim = view(f, met.state, PEER_VIEWER, met).renderableClaims.claims.find(entry => entry.outcomeCode === "foundHidden");
  assert.deepEqual([claim?.actorRef, claim?.targetRefs], [ACTOR, [LOW]]);
});

test("speaking to Odo ends the hiding once the conversation settles; an attack and leaving the scene end it too", () => {
  const f = fixture("speak", LOW_WALL);
  const hid = hide(f, [15, 1, 1]);
  const reply = { outcomeCode: "outcome:answers", summary: "奥多答了一句。", npcPerceives: null,
    response: { kind: "speech", text: "你躲那儿干什么？", motive: "觉得奇怪。", basis: [{ kind: "npcContext", ref: HIGH }] }, consequences: [] };
  const talk = { mode: "adjudication", basisRefs: [HIGH], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "低声说了一句。" },
    proposals: [{ kind: "social", basisRefs: [HIGH], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: HIGH,
      actorSpeech: "别出声。", goal: "让奥多别声张。", method: "压低声音说。", communication: "spokenConversation", audience: "participants",
      branches: { success: reply, failure: { kind: "none" } } }] };
  // The talk froze both NPCs' dice, but nobody is hiding once it settles.
  const spoke = run(f, frozen(f, talk, () => {}, hid.state, "speak"), hid.state, [20, 20]);
  const types = spoke.events.map(event => event.eventType);
  const ended = spoke.events.findIndex(event => event.eventType === "ConditionChanged" && event.payload.entityId === ACTOR);
  assert.ok(ended > types.indexOf("WorldInteractionResolved"), types.join());
  assert.deepEqual(perceptions(spoke.events), []);
  assert.equal(hiddenOf(spoke.state), undefined);
  assert.equal(sees(f, spoke.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...spoke.events]), spoke.state);

  // A combat attack the hider makes ends it, as Rules' own follow-up.
  const attack = { eventType: "AbilityInvoked", rootActionId: "root:hide:attack", payload: { sourceEntityId: ACTOR,
    abilityRef: "ability:test", mechanicalResult: { attack: { rolls: [12], total: 14, hit: true } }, sourcePatch: {} } };
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, attack).map(draft => [draft.payload.entityId, draft.payload.conditions.hidden]),
    [[ACTOR, undefined]]);
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, { ...attack, payload: { ...attack.payload, sourceEntityId: HIGH } }), []);
  // So does leaving the scene, alone or with a party; moving within it does not.
  const left = { eventType: "CharacterMoved", rootActionId: "root:hide:leave", payload: { characterId: ACTOR, destinationSceneId: "scene:elsewhere" } };
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, left).map(draft => draft.payload.entityId), [ACTOR]);
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, { eventType: "PartyMoved", rootActionId: "root:hide:party",
    payload: { memberCharacterIds: [PEER, ACTOR], destinationSceneId: "scene:elsewhere" } }).map(draft => draft.payload.entityId), [ACTOR]);
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, { ...left, payload: { ...left.payload, characterId: PEER } }), []);
  assert.deepEqual(hiddenFollowupDrafts(f.profiles, hid.state, { eventType: "CharacterRepositioned", rootActionId: "root:hide:step",
    payload: { characterId: ACTOR } }), []);
});

test("an opponent the outcome says perceives the hider ends the hiding, in the hide itself or later", () => {
  const f = fixture("perceived", LOW_WALL);
  const heard = evidence => [{ observerRef: LOW, subjectRef: ACTOR, sense: "hearing", evidence, basisRefs: [ACTOR] }];
  // The hide itself: Lian hears the actor scrape the wall, so it never takes.
  const loud = frozen(f, hideBundle(), plan => {
    for (const branch of [plan.branches.success, plan.branches.failure]) {
      branch.sensoryEvidence = heard("墙后传来鞋底蹭地的声音。").map(entry => ({ ...entry, visibilityPolicyRef: `visibility:knowledge-holder:${LOW}` }));
    }
  }, f.state, "loud");
  const scraped = run(f, loud, f.state, [20, 20, 20]);
  assert.deepEqual(applied(scraped.events, "hid"), [{ kind: "hid", characterRef: ACTOR, stealthTotal: "20" }]);
  assert.equal(hiddenOf(scraped.state), undefined);
  assert.deepEqual(perceptions(scraped.events), []);
  assert.deepEqual(replayed(f, scraped.events), scraped.state);

  // Later the hidden actor taps the wall; Lian hears it and has it again.
  const hid = hide(f, [15, 1, 1]);
  const tap = { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "会被听见。", successOutcome: "敲了敲墙。" },
    proposals: [{ basisRefs: [SOURCE, ACTOR], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "敲墙试探。", method: "用指节敲两下墙。", targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("tapped", "敲了两下墙。", { sensoryEvidence: heard("墙那边有人敲了两下。") }), failure: { kind: "none" } } }] };
  const tapped = run(f, frozen(f, tap, () => {}, hid.state, "tap"), hid.state, [1, 1]);
  assert.equal(hiddenOf(tapped.state), undefined);
  const types = tapped.events.map(event => event.eventType);
  assert.ok(types.indexOf("ConditionChanged") < types.indexOf("SensoryEvidenceAcquired"), types.join());
  assert.equal(sees(f, tapped.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...tapped.events]), tapped.state);
});

test("Rules refuses a hide that is not a concealed Stealth check, twice or beside a move; nobody aware means nobody to hide from", () => {
  const f = fixture("refusals");
  const refused = (input, reason) => {
    const result = stepActionToDecision(f.runtime, f.profiles, f.state, input);
    assert.equal(result.kind, "rejected", reason);
    assert.ok(JSON.stringify(result.rejection).includes(reason), JSON.stringify(result.rejection));
  };
  refused(frozen(f, plainBundle(), effects([HIDE], []), f.state, "plain"), "hide:needs-concealed-stealth-check");
  refused(frozen(f, hideBundle({ skill: "sleight", commonAction: null }), effects([HIDE]), f.state, "sleight"), "hide:needs-concealed-stealth-check");
  refused(frozen(f, hideBundle(), effects([HIDE, HIDE]), f.state, "twice"), "hide:one-per-outcome");
  refused(frozen(f, hideBundle(), effects([HIDE, { kind: "jumpOver", featureRef: "feature:probe-valve", landProne: false }]), f.state, "jump"),
    "hide:one-per-outcome");

  // The opponents a hide needs: the aware NPCs for a player character, the
  // player characters for an NPC; asleep NPCs leave a player nobody.
  assert.deepEqual(hidingObservers(f.state, ACTOR), [HIGH, LOW].sort());
  assert.deepEqual(hidingObservers(f.state, LOW), [ACTOR, PEER].sort());
  const asleep = structuredClone(f.state);
  for (const id of [LOW, HIGH]) asleep.combatRuntime.entities[id].conditions = { unconscious: true, prone: true };
  assert.deepEqual(hidingObservers(asleep, ACTOR), []);
});

// SPEC 0014 §§3、4 (ADR 0091, 0097): a map move outside an encounter is a
// committed action too. Once the mover stands at its destination, each
// opponent that sees a hider rolls Perception with the Room's dice; the move
// brings no player roll, no fiction time and no KP call.
test("a map move that brings the hider into view brings the opponents' Perception rolls with the Room's dice", () => {
  const f = fixture("map-move", WALL);
  const hid = hide(f, [15, 20, 20]);
  assert.deepEqual(perceptions(hid.events), [], "behind the wall nobody rolls");
  const move = (state, rootActionId) => f.runtime.step(f.profiles, state, { kind: "repositionCharacter", rootActionId,
    characterId: ACTOR, destination: { kind: "point", position: at(400, 250) } });
  const moved = move(hid.state, "root:hider-walks-into-view");
  assert.equal(moved.kind, "awaitingRandomness", JSON.stringify(moved.kind === "rejected" ? moved.rejection : moved.kind));
  assert.deepEqual(moved.events.map(event => event.eventType), ["CharacterRepositioned", "RandomnessRequested"]);
  // Odo, between them, gives the actor half cover from Lian.
  assert.deepEqual([hideCover(moved.state, LOW, ACTOR), hideCover(moved.state, HIGH, ACTOR)], ["half", "none"]);
  // One d20 for each opponent in sight, in code-unit order; none is a player's.
  assert.deepEqual(moved.randomnessRequests.map(request => [request.purposeKey, request.frozenParameters]), [LOW, HIGH].sort().map(id =>
    [`hidden-perception:${ACTOR}:${id}`, { hiderRef: ACTOR, perceiverRef: id, sceneRef: SCENE }]));
  assert.equal(moved.state.fiction?.nowMicros ?? null, hid.state.fiction?.nowMicros ?? null, "no fiction time passes");
  const fulfil = (waiting, faces) => f.runtime.step(f.profiles, waiting.state, { kind: "authoritativeRandomness",
    resolutionId: waiting.resolutionId, responseId: `response:${waiting.resolutionId}`, continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request, index) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: [{ sides: 20, faces: [faces[index]] }] })) });

  // Lian 1 + 0 + 2 and Odo 3 + 6 + 5 fall short of 15.
  const held = fulfil(moved, [1, 3]);
  assert.equal(held.kind, "committed", JSON.stringify(held.kind === "rejected" ? held.rejection : held.kind));
  assert.deepEqual(perceptions(held.events), [{ hiderRef: ACTOR, sceneRef: SCENE, stealthTotal: "15",
    rolls: [roll(LOW, 1, 0, 2), roll(HIGH, 3, 6, 5)], foundByRef: null }]);
  assert.deepEqual(hiddenOf(held.state), { stealthTotal: "15" });
  assert.deepEqual(held.state.combatRuntime.randomnessResolutions, {});
  assert.deepEqual(replayed(f, [...hid.events, ...moved.events, ...held.events]), held.state);

  // Odo's 4 + 6 + 5 reaches 15: found, for everyone.
  const found = fulfil(moved, [1, 4]);
  assert.equal(found.kind, "committed");
  assert.deepEqual(perceptions(found.events).map(entry => entry.foundByRef), [HIGH]);
  assert.equal(found.events.at(-1).eventType, "ConditionChanged");
  assert.equal(hiddenOf(found.state), undefined);
  assert.equal(sees(f, found.state, npcViewer(LOW), LOW), true);
  assert.deepEqual(replayed(f, [...hid.events, ...moved.events, ...found.events]), found.state);

  // With nobody hidden in sight the move commits at once, as before.
  const plain = f.runtime.step(f.profiles, f.state, { kind: "repositionCharacter", rootActionId: "root:plain-walk",
    characterId: ACTOR, destination: { kind: "point", position: at(400, 250) } });
  assert.equal(plain.kind, "committed");
  assert.deepEqual(plain.events.map(event => event.eventType), ["CharacterRepositioned"]);
});
