import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { dueActivityDescriptors } from "../../../app/_runtime/lib/rules/v2/due-activities.ts";
import { pushOffset } from "../../../app/_runtime/lib/rules/v2/creature-push.ts";
import { nextTo } from "../../../app/_runtime/lib/rules/v2/carry.ts";
import { stepActionToDecision, committedActionRange } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";

// SPEC 0014 §4 and SPEC 0004 §4 (ADR 0092): the branch effects the common
// action scripts expand into -- dropping prone and standing, a shove that
// pushes 5 feet away, and opening or closing a door -- validate, apply,
// replay, project and refuse in Rules. Each plan is lowered with an existing
// effect and its effects replaced, which also reaches refusals the scripts
// never produce; common-actions.test.mjs covers the scripts themselves.

const NAES = "npc:common-naes", VARO = "npc:common-varo", ODO = "npc:common-odo";
const DOOR = "feature:probe-valve";
const GRAPPLE = [{ ability: "str", skill: "athletics" }, { ability: "dex", skill: "acrobatics" }];

function fixture(name, options = {}) {
  return createAuthoredProbeFixture(`common:${name}`, { npcCharacters: [{ id: NAES, name: "奈斯" }, { id: VARO, name: "瓦罗" }], ...options });
}

/** A closed, unlocked door; the fixture's one mapped feature becomes it. */
function door(polygon) {
  const closed = { state: "closed", opaque: true, impassable: true, cover: "full", propagation: "blocks", terrain: "normal" };
  return { kind: "portal", label: "木门", state: "closed", polygon, elevation: "0", height: "96", opaque: true, impassable: true,
    cover: "full", propagation: "blocks", terrain: "normal", stateGraph: { definitionId: "environment-definition:probe-door:open-closed-v1",
      states: [closed, { state: "open", opaque: false, impassable: false, cover: "none", propagation: "passes", terrain: "normal" }],
      transitions: [{ fromState: "closed", intent: "open", toState: "open" }, { fromState: "open", intent: "close", toState: "closed" }] } };
}
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** Flush with the actor's east side at (100, 100). */
const BESIDE = rectangle("130", "70", "140", "130");
/** Across the room. */
const AFAR = rectangle("480", "400", "490", "460");

const outcome = (code, summary, extra = {}) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [],
  pressures: [], opportunities: [], ...extra });

/** An act on the valve with no check; its frozen effects are replaced. */
function plainBundle(intent) {
  return { mode: "adjudication", basisRefs: [SOURCE], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: intent },
    proposals: [{ basisRefs: [SOURCE], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent, method: intent, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("done", intent), failure: { kind: "none" } } }] };
}

/** A shove contest against `target`, frozen as knocking it prone. */
function shoveBundle(target) {
  return { mode: "adjudication", basisRefs: [target], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: null, mode: "normal",
      risk: "对方会顶住。", successOutcome: "对方被推开。", failureOutcome: "对方站稳了。", opposition: { opponentRef: target, checks: GRAPPLE } },
    proposals: [{ basisRefs: [target], consumes: [], produces: [], sceneRef: SCENE, kind: "worldInteraction", outcomeBinding: "always",
      intent: "把他推开。", method: "用肩膀顶过去。", targetRefs: [target], directTargetRefs: [target], instrumentRefs: [], abilityRef: { kind: "none" },
      branches: { success: outcome("shoved", "对方被推开。", { effects: [{ kind: "knockProne", targetRef: target }] }),
        failure: outcome("held-ground", "对方站稳了。") } }] };
}

function parse(bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return parsed.bundle;
}

/** The action of the actor from `state`, with its own frozen context. */
function at(f, state, suffix) {
  if (state === f.state && suffix === undefined) return f;
  const rootActionId = `${f.rootActionId}:${suffix}`;
  return { ...f, state, rootActionId, requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [SOURCE, NAES, VARO] }).context };
}

/** Lowers `bundle` from `state` and lets `edit` change the frozen plan. */
function frozen(f, bundle, edit, state = f.state, suffix) {
  const lowered = lowerVNext2ProposalBundle({ ...at(f, state, suffix), value: parse(bundle) });
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const input = structuredClone(lowered.command.rulesInput);
  edit(atomicCompletionInput(input).steps[0].rulesInput.plan);
  return input;
}

function act(f, input, state = f.state) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(result.kind, "committed", JSON.stringify(result.kind === "rejected" ? result.rejection : result.kind));
  return result;
}

function contest(f, input, rolls, state = f.state) {
  const pending = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending.kind === "rejected" ? pending.rejection : pending.kind));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { ...result, events: [...pending.events, ...result.events] };
}

function refused(f, input, reason, state = f.state) {
  const result = stepActionToDecision(f.runtime, f.profiles, state, input);
  assert.equal(result.kind, "rejected", reason);
  assert.ok(JSON.stringify(result.rejection).includes(reason), JSON.stringify(result.rejection));
}

function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}

function claims(f, result, priorState) {
  const view = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(result.state, {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState, events: result.events }) });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  return view;
}

const resolved = events => events.filter(event => event.eventType === "WorldInteractionResolved").at(-1).payload;
const applied = (events, kind) => resolved(events).appliedEffects.filter(effect => effect.kind === kind);
const conditionsOf = (state, id) => state.combatRuntime.entities[id].conditions;
const positionOf = (state, id) => state.combatRuntime.entities[id].position;
const setEffects = effects => plan => { plan.branches.success.effects = effects; };

test("the actor drops prone, then stands up, each without a check; both replay", () => {
  const f = fixture("prone");
  const dropped = act(f, frozen(f, plainBundle("趴到地上。"), setEffects([{ kind: "dropProne" }])));
  assert.equal(conditionsOf(dropped.state, ACTOR).prone, true);
  assert.deepEqual(applied(dropped.events, "droppedProne"), [{ kind: "droppedProne", characterRef: ACTOR }]);
  assert.deepEqual(replayed(f, dropped.events), dropped.state);
  const view = claims(f, dropped, f.state);
  assert.ok(view.renderableClaims.claims.some(claim => claim.outcomeCode === "conditionsChanged" && /倒地已生效/.test(claim.summary)),
    JSON.stringify(view.renderableClaims.claims.map(claim => [claim.outcomeCode, claim.summary])));

  // Standing is the act itself: one ConditionChanged, recorded as stoodUp,
  // not a second automatic stand before it.
  const stood = act(f, frozen(f, plainBundle("站起来。"), setEffects([{ kind: "standUp" }]), dropped.state, "stand"), dropped.state);
  assert.equal(conditionsOf(stood.state, ACTOR).prone, undefined);
  assert.deepEqual(applied(stood.events, "stoodUp"), [{ kind: "stoodUp", characterRef: ACTOR }]);
  assert.equal(stood.events.filter(event => event.eventType === "ConditionChanged" && event.payload.entityId === ACTOR).length, 1);
  assert.deepEqual(replayed(f, [...dropped.events, ...stood.events]), stood.state);
});

test("Rules refuses dropping prone while prone, standing while up, and standing without any speed", () => {
  const f = fixture("prone-refusals");
  refused(f, frozen(f, plainBundle("站起来。"), setEffects([{ kind: "standUp" }])), "prone:not-prone");
  refused(f, frozen(f, plainBundle("趴下又站起。"), setEffects([{ kind: "dropProne" }, { kind: "standUp" }])), "prone:one-change-per-outcome");
  const prone = structuredClone(f.state);
  prone.combatRuntime.entities[ACTOR].conditions = { prone: true };
  refused(f, frozen(f, plainBundle("趴到地上。"), setEffects([{ kind: "dropProne" }]), prone, "again"), "prone:already-prone", prone);
  // Grappled: speed 0, so it cannot stand (SRD 5.1).
  const pinned = structuredClone(f.state);
  pinned.combatRuntime.entities[ACTOR].conditions = { prone: true, grappledBy: NAES };
  refused(f, frozen(f, plainBundle("站起来。"), setEffects([{ kind: "standUp" }]), pinned, "pinned"), "prone:cannot-stand", pinned);
});

test("a won shove pushes the NPC 5 feet straight away from the actor, and replay agrees", () => {
  // The actor at (100, 100) shoves Varo at (160, 160): 60 inches along the
  // diagonal is (42.4, 42.4), rounded to (42, 42).
  assert.deepEqual(pushOffset({ x: "100", y: "100", elevation: "0" }, { x: "160", y: "160", elevation: "0" }), { x: 42n, y: 42n });
  assert.deepEqual(pushOffset({ x: "100", y: "100", elevation: "0" }, { x: "100", y: "160", elevation: "0" }), { x: 0n, y: 60n });
  assert.deepEqual(pushOffset({ x: "100", y: "100", elevation: "0" }, { x: "100", y: "100", elevation: "0" }), undefined);
  const f = fixture("push");
  const from = positionOf(f.state, VARO);
  const run = contest(f, frozen(f, shoveBundle(VARO), setEffects([{ kind: "shovePush", targetRef: VARO }])), [18, 2]);
  const to = { x: "202", y: "202", elevation: "0" };
  assert.deepEqual(positionOf(run.state, VARO), to);
  assert.deepEqual(applied(run.events, "pushedAway"), [{ kind: "pushedAway", targetRef: VARO, from, to }]);
  const pushed = run.events.filter(event => event.eventType === "CreaturePushed");
  assert.deepEqual(pushed.map(event => event.payload), [{ characterId: VARO, sceneId: SCENE, byCharacterId: ACTOR, from, to }]);
  assert.equal(conditionsOf(run.state, VARO).prone, undefined, "pushed, not knocked down");
  assert.deepEqual(replayed(f, run.events), run.state);
  const view = claims(f, run, f.state);
  assert.deepEqual(view.renderableClaims.claims.find(claim => claim.outcomeCode === "pushedAway")?.targetRefs, [VARO]);
  assert.deepEqual(view.tacticalProjection.visibleEntities.find(entity => entity.id === VARO)?.position, to);

  // A forged destination, or a push from where Varo no longer stands, is refused.
  const event = pushed[0];
  for (const payload of [{ ...event.payload, to: { ...to, x: "262" } }, { ...event.payload, from: { ...from, x: "130" } }]) {
    const replay = f.runtime.replay(f.genesis, run.events.map(entry => entry === event ? { ...entry, payload } : entry));
    assert.notEqual(replay.kind, "replayed", JSON.stringify(payload));
  }
  // Only a contest's success pushes, as with every shove: the closed plan
  // shape refuses it anywhere else.
  refused(f, frozen(f, plainBundle("推开瓦罗。"), plan => {
    plan.targetRefs = [SOURCE, VARO]; plan.directTargetRefs = [SOURCE, VARO];
    plan.branches.success.effects = [{ kind: "shovePush", targetRef: VARO }];
  }), "plan is not canonical");
});

test("a push into a wall or onto another creature is blocked and moves nobody", () => {
  // An impassable wall right behind Varo.
  const walled = fixture("push-wall", { featureOverrides: { polygon: rectangle("195", "195", "260", "260"), height: "120", impassable: true, opaque: true,
    cover: "full", propagation: "blocks" } });
  const before = positionOf(walled.state, VARO);
  const wall = contest(walled, frozen(walled, shoveBundle(VARO), setEffects([{ kind: "shovePush", targetRef: VARO }])), [18, 2]);
  assert.deepEqual(positionOf(wall.state, VARO), before);
  assert.deepEqual(applied(wall.events, "pushBlocked"), [{ kind: "pushBlocked", targetRef: VARO }]);
  assert.deepEqual(wall.events.filter(event => event.eventType === "CreaturePushed"), []);
  assert.deepEqual(replayed(walled, wall.events), wall.state);
  const view = claims(walled, wall, walled.state);
  assert.deepEqual(view.renderableClaims.claims.find(claim => claim.outcomeCode === "pushBlocked")?.targetRefs, [VARO]);

  // Spawn points go in id order: Odo at (160, 160), Varo at (220, 160),
  // across the spot (202, 202) Odo would land on.
  const crowded = fixture("push-crowd", { npcCharacters: [{ id: NAES, name: "奈斯" }, { id: VARO, name: "瓦罗" }, { id: ODO, name: "奥多" }] });
  assert.deepEqual([positionOf(crowded.state, ODO), positionOf(crowded.state, VARO)],
    [{ x: "160", y: "160", elevation: "0" }, { x: "220", y: "160", elevation: "0" }]);
  const crowd = contest(crowded, frozen(crowded, shoveBundle(ODO), setEffects([{ kind: "shovePush", targetRef: ODO }])), [18, 2]);
  assert.deepEqual(positionOf(crowd.state, ODO), positionOf(crowded.state, ODO));
  assert.deepEqual(applied(crowd.events, "pushBlocked"), [{ kind: "pushBlocked", targetRef: ODO }]);
  assert.deepEqual(replayed(crowded, crowd.events), crowd.state);
});

test("pushing a creature the actor holds out of reach ends the grapple in the same transition", () => {
  const f = fixture("push-held");
  const grab = frozen(f, shoveBundle(NAES), plan => {
    plan.branches.success.effects = [{ kind: "grapple", targetRef: NAES }];
    plan.branches.success.sensoryEvidence = [{ observerRef: NAES, subjectRef: ACTOR, sense: "touch", evidence: "被人抓住了胳膊。",
      visibilityPolicyRef: `visibility:knowledge-holder:${NAES}`, basisRefs: [ACTOR] }];
  });
  const held = contest(f, grab, [18, 2]);
  assert.equal(conditionsOf(held.state, NAES).grappledBy, ACTOR);
  const [due] = dueActivityDescriptors(held.state).filter(work => work.npcReaction !== undefined);
  const waited = f.runtime.step(f.profiles, held.state, { kind: "resolveNpcReaction", proposalId: due.childRootActionId,
    reactionId: due.npcReaction.reactionId, reactionHash: due.npcReaction.reactionHash, decision: { kind: "decline", reason: "先看看。" } });
  assert.equal(waited.kind, "committed", JSON.stringify(waited));
  // Naes at (100, 160) goes to (100, 220): 10 feet from the actor.
  const shove = contest(f, frozen(f, shoveBundle(NAES), setEffects([{ kind: "shovePush", targetRef: NAES }]), waited.state, "push"),
    [18, 2], waited.state);
  assert.deepEqual(positionOf(shove.state, NAES), { x: "100", y: "220", elevation: "0" });
  assert.ok(!nextTo(shove.state.combatRuntime.entities[NAES], shove.state.combatRuntime.entities[ACTOR]));
  assert.equal(conditionsOf(shove.state, NAES).grappledBy, undefined);
  const pushedAt = shove.events.findIndex(event => event.eventType === "CreaturePushed");
  const released = shove.events.findIndex(event => event.eventType === "ConditionChanged" && event.payload.entityId === NAES);
  assert.ok(pushedAt >= 0 && released > pushedAt, shove.events.map(event => event.eventType).join());
  assert.deepEqual(replayed(f, [...held.events, ...waited.events, ...shove.events]), shove.state);
});

test("the actor opens and closes a door it stands beside, along the door's own states", () => {
  const f = fixture("door", { featureOverrides: door(BESIDE) });
  const withDoor = (intent, effects = [{ kind: "objectStateTransition", targetRef: DOOR, intent }]) => plan => {
    plan.targetRefs = [SOURCE, DOOR]; plan.directTargetRefs = [SOURCE, DOOR]; plan.branches.success.effects = effects;
  };
  const feature = state => state.combatRuntime.scenes[SCENE].geometry.obstacles.find(entry => entry.featureId === DOOR);
  const opened = act(f, frozen(f, plainBundle("把门打开。"), withDoor("open")));
  assert.equal(feature(opened.state).state, "open");
  assert.equal(feature(opened.state).impassable, false);
  assert.deepEqual(applied(opened.events, "objectStateChanged"), [{ kind: "objectStateChanged", targetRef: DOOR, fromState: "closed", toState: "open" }]);
  const changed = opened.events.filter(event => event.eventType === "EnvironmentFeatureStateChanged");
  assert.deepEqual(changed.map(event => [event.payload.intent, event.visibilityPolicyId]), [["open", "visibility:scene-observers"]]);
  assert.deepEqual(replayed(f, opened.events), opened.state);
  const view = claims(f, opened, f.state);
  assert.ok(view.renderableClaims.claims.some(claim => claim.outcomeCode === "objectOpened"),
    JSON.stringify(view.renderableClaims.claims.map(claim => claim.outcomeCode)));

  // An open door cannot be opened again; it closes.
  refused(f, frozen(f, plainBundle("把门打开。"), withDoor("open"), opened.state, "reopen"), "object:transition-unavailable", opened.state);
  const closed = act(f, frozen(f, plainBundle("把门关上。"), withDoor("close"), opened.state, "close"), opened.state);
  assert.equal(feature(closed.state).state, "closed");
  assert.deepEqual(replayed(f, [...opened.events, ...closed.events]), closed.state);

  // The door is the step's direct target, and moves once per outcome.
  refused(f, frozen(f, plainBundle("把门打开。"), setEffects([{ kind: "objectStateTransition", targetRef: DOOR, intent: "open" }])),
    "object:not-a-direct-target");
  refused(f, frozen(f, plainBundle("开门又开门。"), withDoor("open", [{ kind: "objectStateTransition", targetRef: DOOR, intent: "open" },
    { kind: "objectStateTransition", targetRef: DOOR, intent: "close" }])), "object:one-change-per-target");
});

test("a door across the room is out of reach", () => {
  const f = fixture("door-far", { featureOverrides: door(AFAR) });
  refused(f, frozen(f, plainBundle("把门打开。"), plan => {
    plan.targetRefs = [SOURCE, DOOR]; plan.directTargetRefs = [SOURCE, DOOR];
    plan.branches.success.effects = [{ kind: "objectStateTransition", targetRef: DOOR, intent: "open" }];
  }), "object:out-of-reach");
});
