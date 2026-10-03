import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER,
  PROBE_SCENE as SCENE, PROBE_SOURCE as VALVE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { createVNextProposalBundleSchema, encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { entitiesWithinRange, rectangularFeatureEntity } from "../../../app/_runtime/lib/rules/profiles/combat-geometry.ts";
import { nextTo } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";
import { parseWithNpcReplies } from "../../support/fixtures/vnext-npc-replies.mjs";

// SPEC 0014 §4 (ADR 0087): before an observe or worldInteraction step the
// actor may first walk within its scene, next to a creature or mapped object
// or to a map point. Rules finds the route on the full scene map and commits
// CharacterRepositioned before the step, on either result of its check.

// Five NPCs stand at (100,160) … (340,160); the actor at (100,100), the
// other player at (200,100). Naes is the far one.
const NPCS = ["npc:walk-a", "npc:walk-b", "npc:walk-c", "npc:walk-d", "npc:walk-naes"];
const NAES = NPCS[4];
const WALL = { featureId: "feature:probe-valve", kind: "barrier", label: "砖墙", state: "intact",
  polygon: [{ x: "250", y: "0" }, { x: "290", y: "0" }, { x: "290", y: "400" }, { x: "250", y: "400" }],
  elevation: "0", height: "96", opaque: true, impassable: true, cover: "full", propagation: "blocks" };

function fixture(name, options = {}) {
  const f = createAuthoredProbeFixture(`approach:${name}`, options);
  const focusRefs = [VALVE, PEER, ...(options.npcCharacters ?? []).map(npc => npc.id)];
  return { ...f, requiredContext: freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs }).context };
}
const hall = name => fixture(name, { npcCharacters: NPCS.map(id => ({ id, name: id === NAES ? "奈斯" : id })) });

const position = (state, id) => state.combatRuntime.entities[id].position;
const result = (suffix, summary, sensoryEvidence = []) => ({ outcomeCode: `outcome:${suffix}`, summary, effects: [],
  sensoryEvidence, pressures: [], opportunities: [] });

/** The replay test sample: walk to Naes in the stair shadow and lift him. */
function liftNaes(approach = { kind: "nextTo", ref: NAES }) {
  const felt = summary => [{ observerRef: ACTOR, subjectRef: NAES, sense: "touch", evidence: summary, basisRefs: [NAES] }];
  return { mode: "adjudication", basisRefs: [NAES], terminal: { kind: "none" },
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: 13,
      mode: "normal", risk: "奈斯会挣扎，可能两人一起摔倒。", successOutcome: "奈斯被拦腰抱起。", failureOutcome: "奈斯挣脱落地。" },
    proposals: [{ kind: "worldInteraction", basisRefs: [NAES], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      intent: "走到楼梯阴影里，把奈斯拦腰抱起。", method: "走过去，双臂环住他的腰往上提。",
      targetRefs: [NAES], directTargetRefs: [NAES], instrumentRefs: [], abilityRef: { kind: "none" }, approach,
      branches: { success: result("lifted", "奈斯被抱离了地面。", felt("他的腰被你箍住，脚离开了地面。")),
        failure: result("slipped", "奈斯挣脱落地。", felt("他一拧身，从你臂弯里滑了出去。")) } }] };
}

/** A look from somewhere else in the room: an observe step that walks first. */
function lookFrom(approach, duration = "300000000") {
  return { mode: "adjudication", basisRefs: [VALVE], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: duration, risk: "没有风险。", successOutcome: "看清了墙。" },
    proposals: [{ kind: "observe", basisRefs: [VALVE], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      inquiry: "从墙另一边看过去是什么样子？", method: "走过去看。", focusRefs: [VALVE], existingFactRefs: [], approach,
      branches: { success: { outcomeCode: "outcome:looked", summary: "看清了砖墙。", sensoryEvidence: [{ observerRef: ACTOR,
        subjectRef: VALVE, sense: "sight", evidence: "砖墙一直砌到廊道中段。", basisRefs: [VALVE] }], characterInferences: [] },
      failure: { kind: "none" } } }] };
}

function lower(f, bundle, { state = f.state, requiredContext = f.requiredContext } = {}) {
  const parsed = bundle.proposals.some(entry => entry.kind === "social")
    ? parseWithNpcReplies(encodeVNextStrictToolBundle(bundle), bundle)
    : parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ value: parsed.bundle, requiredContext, state, profiles: f.profiles,
    rootActionId: requiredContext.binding.rootActionId, actorCharacterId: ACTOR });
}

/** Runs the lowered act to its end, rolling `roll` for a check. */
function run(f, bundle, roll) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  let step = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  let events = [...step.events];
  if (roll !== undefined) {
    assert.equal(step.kind, "awaitingRandomness", JSON.stringify(step));
    step = f.runtime.step(f.profiles, step.state, { kind: "fulfillAuthoritativeRandomness", continuation: step.continuation, rolls: [roll] });
    events = [...events, ...step.events];
  }
  assert.equal(step.kind, "committed", JSON.stringify(step));
  const replayed = f.runtime.replay(f.genesis, events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(replayed.state, step.state, "replay rebuilds the same map");
  return { ...step, events, lowered };
}

function peerView(f, committed) {
  const projected = f.runtime.project(f.profiles, committed.state, { kind: "player", principalId: "principal:probe-target",
    seatId: "seat:probe-target", sessionVersion: 1, characterId: PEER },
  { channel: "realtime", committedRange: committedActionRange(committed.state,
    { receiptId: committed.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: committed.events }) });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}

test("the actor first walks next to Naes on both results of the check, and Naes stays where he stood", () => {
  for (const [roll, branch] of [[18, "success"], [2, "failure"]]) {
    const f = hall(`lift:${branch}`);
    const naesBefore = structuredClone(position(f.state, NAES));
    assert.equal(entitiesWithinRange(f.state.combatRuntime.entities[ACTOR], f.state.combatRuntime.entities[NAES], "60"), false,
      "Naes is out of reach at first");
    const committed = run(f, liftNaes(), roll);
    const types = committed.events.map(event => event.eventType);
    const walked = committed.events.find(event => event.eventType === "CharacterRepositioned");
    assert.ok(walked, types.join());
    assert.ok(types.indexOf("CharacterRepositioned") < types.lastIndexOf("WorldInteractionResolved"), "the walk precedes the step");
    assert.equal(committed.events.find(event => event.eventType === "WorldInteractionResolved"
      && event.payload.rulingKind === "check").payload.branch, branch);
    assert.deepEqual(walked.payload.toward, { kind: "nextTo", ref: NAES });
    assert.deepEqual(walked.payload.path[0], { x: "100", y: "100", elevation: "0" });
    assert.equal(walked.visibilityPolicyId, "visibility:scene-observers");

    const state = committed.state;
    assert.ok(entitiesWithinRange(state.combatRuntime.entities[ACTOR], state.combatRuntime.entities[NAES], "60"),
      `the actor stands next to Naes: ${JSON.stringify(position(state, ACTOR))}`);
    assert.deepEqual(position(state, ACTOR), walked.payload.path.at(-1));
    assert.deepEqual(position(state, NAES), naesBefore, "nobody carries Naes anywhere");
    assert.equal(state.entities[ACTOR].sceneId, SCENE);

    // The other player in the room sees the actor on its new square and is
    // told the actor walked next to Naes.
    const seen = peerView(f, committed);
    assert.deepEqual(seen.tacticalProjection.visibleEntities.find(entity => entity.id === ACTOR).position, position(state, ACTOR));
    const claim = seen.renderableClaims.claims.find(entry => entry.kind === "mechanicalOutcome" && entry.outcomeCode === "walkedNextTo");
    assert.ok(claim, JSON.stringify(seen.renderableClaims.claims.map(entry => entry.outcomeCode ?? entry.kind)));
    assert.deepEqual(claim.targetRefs, [NAES]);
  }
});

test("an observe step walks around a wall to a map point, and a mapped object can be the place to stand by", () => {
  const f = fixture("point", { featureOverrides: WALL });
  const committed = run(f, lookFrom({ kind: "point", x: "400", y: "100" }));
  const walked = committed.events.find(event => event.eventType === "CharacterRepositioned");
  assert.ok(walked, committed.events.map(event => event.eventType).join());
  assert.deepEqual(walked.payload.toward, { kind: "point" });
  assert.deepEqual(position(committed.state, ACTOR), { x: "400", y: "100", elevation: "0" });
  assert.ok(walked.payload.path.length > 2, "the straight line runs into the wall, so the route turns");
  assert.ok(walked.payload.path.some(point => BigInt(point.y) >= 430n), `the route goes round the wall's end: ${JSON.stringify(walked.payload.path)}`);
  assert.equal(committed.events.some(event => event.eventType === "SensoryEvidenceAcquired"), true, "the look itself still happens");

  // The valve's scene object is placed by the wall feature; standing by it
  // means within reach of the wall.
  const g = fixture("object", { featureOverrides: WALL });
  const byWall = run(g, lookFrom({ kind: "nextTo", ref: VALVE }));
  const wall = rectangularFeatureEntity(WALL, SCENE);
  assert.ok(entitiesWithinRange(byWall.state.combatRuntime.entities[ACTOR], wall, "60"), JSON.stringify(position(byWall.state, ACTOR)));

  // A low counter-height object is beside whoever stands flush against it.
  const low = fixture("low-object", { featureOverrides: { ...WALL, label: "矮柜", height: "36" } });
  const byLow = run(low, lookFrom({ kind: "nextTo", ref: VALVE }));
  assert.ok(byLow.events.some(event => event.eventType === "CharacterRepositioned"));
  assert.ok(nextTo(byLow.state.combatRuntime.entities[ACTOR], rectangularFeatureEntity({ ...WALL, height: "36" }, SCENE)),
    JSON.stringify(position(byLow.state, ACTOR)));

  // Already there: no walk is recorded.
  const h = fixture("stay");
  const stayed = run(h, lookFrom({ kind: "point", x: "100", y: "100" }));
  assert.equal(stayed.events.some(event => event.eventType === "CharacterRepositioned"), false);
});

test("a step that stays put lowers without a walk, and the form offers the walk only to world and observe steps", () => {
  const f = hall("none");
  const committed = run(f, liftNaes({ kind: "none" }), 18);
  assert.equal(committed.events.some(event => event.eventType === "CharacterRepositioned"), false);
  assert.deepEqual(position(committed.state, ACTOR), position(f.state, ACTOR));
  const plan = atomicCompletionInput(committed.lowered.command.rulesInput).steps[0].rulesInput.plan;
  assert.equal(Object.hasOwn(plan, "approach"), false, "a plan that stays put is the same plan as before");

  const schema = createVNextProposalBundleSchema(["worldInteraction", "observe", "social"], [], [NAES, VALVE, SCENE]);
  const shapes = [];
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    if (value.properties !== undefined) shapes.push(value.properties);
    Object.values(value).forEach(walk);
  };
  walk(schema);
  const world = shapes.filter(properties => "directTargetRefs" in properties && "otherTargetRefs" in properties);
  const observe = shapes.filter(properties => "inquiry" in properties && "focusRefs" in properties);
  const social = shapes.filter(properties => "actorSpeech" in properties);
  assert.ok(world.length > 0 && observe.length > 0 && social.length > 0);
  assert.ok(world.every(properties => "approach" in properties));
  assert.ok(observe.every(properties => "approach" in properties));
  assert.ok(social.every(properties => !("approach" in properties)), "a conversation does not move the speaker");
});

test("a walk the world refuses is named at the approach field, and Rules refuses a forged one with no events", () => {
  const f = hall("refused");
  const diagnosticOf = lowered => {
    assert.equal(lowered.kind, "rejected", JSON.stringify(lowered));
    return lowered.diagnostics.find(entry => String(entry.constraint).startsWith("approach:"));
  };

  // The scene itself is not something to stand next to; the correction is
  // told which refs are.
  const notPlaced = diagnosticOf(lower(f, liftNaes({ kind: "nextTo", ref: SCENE })));
  assert.equal(notPlaced.constraint, "approach:target-not-placed-or-visible");
  assert.deepEqual(notPlaced.path, ["proposals", 0, "approach", "ref"]);
  assert.ok(notPlaced.expected.refs.includes(NAES) && notPlaced.expected.refs.includes(VALVE), JSON.stringify(notPlaced.expected));
  assert.equal(notPlaced.expected.refs.includes(ACTOR), false);

  // A point inside a solid wall has no route.
  const g = fixture("refused-wall", { featureOverrides: WALL });
  const blocked = diagnosticOf(lower(g, lookFrom({ kind: "point", x: "270", y: "200" })));
  assert.equal(blocked.constraint, "approach:no-route");
  assert.deepEqual(blocked.path, ["proposals", 0, "approach"]);

  // Inside an encounter the actor moves on its turn instead.
  const begun = f.runtime.step(f.profiles, f.state, { kind: "startEncounter", rootActionId: "root:approach-combat",
    proposalAttemptId: "proposal:approach-combat", encounterId: "encounter:approach", sceneId: SCENE, participantEntityIds: [ACTOR, NAES],
    dynamicEntities: [], battlefieldFactIds: [], initiativeGroups: [ACTOR, NAES].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NAES] }, { fromEntityIds: [NAES], toEntityIds: [ACTOR] }] });
  assert.notEqual(begun.kind, "rejected", JSON.stringify(begun));
  const combatContext = freezeAuthoredProbeContext(f, begun.state, { rootActionId: `${f.rootActionId}:combat`, focusRefs: [VALVE, NAES] }).context;
  const inCombat = diagnosticOf(lower(f, { ...liftNaes(), adjudication: { ...liftNaes().adjudication, durationMicros: "0" } },
    { state: begun.state, requiredContext: combatContext }));
  assert.equal(inCombat.constraint, "approach:in-encounter");

  // Rules plans the walk itself: a frozen plan whose point was moved into the
  // wall after lowering is refused before any event or roll.
  const lowered = lower(g, lookFrom({ kind: "point", x: "400", y: "100" }));
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const forged = structuredClone(lowered.command.rulesInput);
  atomicCompletionInput(forged).steps[0].rulesInput.plan.approach.position = { x: "270", y: "200", elevation: "0" };
  const refused = stepActionToDecision(g.runtime, g.profiles, g.state, forged);
  assert.equal(refused.kind, "rejected", JSON.stringify(refused));
  assert.equal(refused.rejection.message, "approach:no-route");
  assert.deepEqual(refused.events ?? [], []);
  assert.deepEqual(position(g.state, ACTOR), { x: "100", y: "100", elevation: "0" });
});

// A conversation's frozen NPC view admits no earlier change to the speaker
// (SPEC 0016 §7.1), so a walk in the same act is ordered after the talk.
test("walking up to Naes and speaking to him commits both, the talk ahead of the walk", () => {
  const f = hall("talk");
  const reply = { outcomeCode: "outcome:answers", summary: "奈斯答了一句。", npcPerceives: null,
    response: { kind: "speech", text: "有话就说。", motive: "不想多谈。", basis: [{ kind: "npcContext", ref: NAES }] }, consequences: [] };
  const bundle = { mode: "adjudication", basisRefs: [NAES], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "没有风险。", successOutcome: "走到奈斯身边问了一句。" },
    proposals: [
      { kind: "worldInteraction", basisRefs: [NAES], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
        intent: "走到奈斯身边。", method: "穿过大厅走过去。", targetRefs: [NAES], directTargetRefs: [NAES], instrumentRefs: [],
        abilityRef: { kind: "none" }, approach: { kind: "nextTo", ref: NAES },
        branches: { success: result("beside", "走到了奈斯身边。"), failure: { kind: "none" } } },
      { kind: "social", basisRefs: [NAES], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: NAES,
        actorSpeech: "你站在这儿做什么？", goal: "问奈斯为什么躲在楼梯阴影里。", method: "压低声音问。",
        communication: "spokenConversation", audience: "participants", branches: { success: reply, failure: { kind: "none" } } },
    ] };
  const committed = run(f, bundle);
  const types = committed.events.map(event => event.eventType);
  const talked = committed.events.findIndex(event => event.eventType === "WorldInteractionResolved" && event.payload.social !== undefined);
  assert.ok(talked >= 0, types.join());
  assert.ok(talked < types.indexOf("CharacterRepositioned"), types.join());
  assert.ok(entitiesWithinRange(committed.state.combatRuntime.entities[ACTOR], committed.state.combatRuntime.entities[NAES], "60"));
});
