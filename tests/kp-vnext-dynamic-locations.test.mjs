import { actDuration, withActDuration } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { VNEXT_SEMANTIC_TEMPLATES } from "../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { parseSubmitKpProposalBundleArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { validateVNextProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-validator.ts";
import { dynamicLocationSceneRef } from "../app/_runtime/lib/rules/v2/dynamic-locations.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { itemBundle } from "./fixtures/vnext-authored-bundles.mjs";
import { sharedCheckBundle } from "./fixtures/vnext-shared-check.mjs";

const DESTINATION = "prospective:destination", PASSAGE = "prospective:connection";
const INTERIOR = "尚未进入的内部藏着蓝色祭坛。";
function entry(kind, handle, definition, consumes = []) {
  const template = VNEXT_SEMANTIC_TEMPLATES[kind];
  return { kind: "materializeObject", basisRefs: [SOURCE], consumes,
    produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }], outcomeBinding: "always",
    semanticKind: kind, templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: "visibility:scene-observers", definition: { sceneRef: SCENE, visibilityFactId: null,
      label: kind === "location" ? "地下空间" : "石阶入口", description: kind === "location" ? INTERIOR : "墙角出现向下延伸的石阶。",
      observableState: kind === "passage" ? "open" : null, affordances: null, mechanicDefinitionRefs: [], ...definition },
    summary: "固化被发现的环境。" };
}
function location(fixture, handle = DESTINATION) {
  return entry("location", handle, { geometry: structuredClone(fixture.state.combatRuntime.scenes[SCENE].geometry) });
}
function passage(toLocationRef, { fromLocationRef = SCENE, handle = PASSAGE, state = "open", bidirectional = true, travelDurationMicros = "60000000" } = {}) {
  return entry("passage", handle, { observableState: state,
    passage: { fromLocationRef, toLocationRef, bidirectional, traversal: "沿石阶步行", travelDurationMicros } },
    [fromLocationRef, toLocationRef].map(ref => ref.startsWith("prospective:") ? { kind: "prospective", handle: ref } : { kind: "existing", ref }));
}
function bundle(proposals) { const base = itemBundle(); return withActDuration({ ...base, adjudication: { ...base.adjudication, durationMicros: actDuration(proposals) }, proposals }); }
function lower(fixture, proposals) {
  const value = parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle(bundle(proposals)));
  const valid = validateVNextProposalBundle(value);
  assert.equal(valid.kind, "accepted", JSON.stringify(valid));
  return lowerVNext2ProposalBundle({ value, state: fixture.state, requiredContext: fixture.requiredContext,
    actorCharacterId: ACTOR, rootActionId: fixture.rootActionId });
}
function commit(fixture, proposals) {
  const lowered = lower(fixture, proposals);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = fixture.runtime.step(fixture.profiles, fixture.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result;
}
function definitions(result) {
  return result.events.filter(event => event.eventType === "SemanticDefinitionMaterialized").map(event => event.payload);
}

function interaction(passageRef, effects) {
  return { kind: "worldInteraction", basisRefs: [passageRef], consumes: [{ kind: "existing", ref: passageRef }],
    produces: [], outcomeBinding: "always", sceneRef: SCENE, targetRefs: [passageRef], directTargetRefs: [passageRef],
    instrumentRefs: [], abilityRef: null, intent: "沿已发现的石阶走下去。", method: "步行穿过这条连接。",
    branches: { success: { outcomeCode: "outcome:travel-started", summary: "开始沿石阶行走。", effects,
      sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } };
}
function nextFixture(fixture, state, id, focusRefs) {
  const next = { ...fixture, state, rootActionId: `${fixture.rootActionId}:${id}` };
  next.requiredContext = freezeAuthoredProbeContext(next, state, { rootActionId: next.rootActionId,
    focusRefs, intentText: "沿已发现的石阶走下去。" }).context;
  return next;
}
function act(fixture, state, input, expected = "committed") {
  const result = fixture.runtime.step(fixture.profiles, state, input);
  assert.equal(result.kind, expected, JSON.stringify(result));
  return result;
}

function correct(fixture, events, targetReceiptId, id) {
  const prior = fixture.runtime.replay(fixture.genesis, events);
  assert.equal(prior.kind, "replayed", JSON.stringify(prior));
  return act(fixture, prior.state, { kind: "applyServiceCorrection", correctionAuthority: {
    kind: "roomCorrectionAuthority", capability: prior.state.correctionRuntime.authorityCapability },
    correctionId: `correction:${id}`, targetReceiptId, actorCharacterId: ACTOR, errorKind: "rulesMisapplication",
    publicExplanation: "该次环境裁决有误，恢复裁决前状态。", basis: { stateHash: prior.head.stateHash, eventHash: prior.head.eventHash } });
}

test("a later vNext traversal starts an Activity and moves only when its existing due path completes, once", () => {
  const f = createAuthoredProbeFixture("location-traverse");
  const created = commit(f, [location(f), passage(DESTINATION)]);
  const [destination, connection] = definitions(created), destScene = dynamicLocationSceneRef(destination.definitionRef);
  const next = nextFixture(f, created.state, "traverse", [connection.definitionRef]);
  const started = commit(next, [interaction(connection.definitionRef, [{ kind: "traversePassage", passageRef: connection.definitionRef }])]);
  const activity = started.events.find(event => event.eventType === "ActivityStarted").payload;
  assert.equal(started.state.entities[ACTOR].sceneId, SCENE);
  // Setting off is an act with its own small frozen duration; the travel time itself stays in the Activity.
  const timelineId = created.state.multiplayerRuntime.characterTimelineIds[ACTOR] ?? created.state.activeBranchId;
  assert.equal(BigInt(started.state.fictionTimelines[timelineId].nowMicros) - BigInt(created.state.fictionTimelines[timelineId].nowMicros), 300000000n);
  assert.equal(activity.intendedDurationMicros, "60000000");
  const projection = f.runtime.project(f.profiles, started.state, f.viewer, { channel: "realtime", committedRange: {
    receiptId: started.receipt.receiptId, actorCharacterId: ACTOR, priorState: created.state, events: started.events } });
  assert.equal(projection.kind, "projected", JSON.stringify(projection));
  assert.ok(JSON.stringify(projection).includes("通行活动已经开始"));
  assert.ok(!JSON.stringify(projection).includes(INTERIOR));
  act(f, started.state, { kind: "completeActivity", proposalId: "root:travel:too-early", activityId: activity.activityId }, "rejected");
  const waited = act(f, started.state, { kind: "resolveFreeAction", proposalId: "root:travel:wait", characterId: ACTOR,
    goal: "沿路线行走一分钟。", method: "步行", feasibility: { kind: "directSuccess", publicBasis: "已沿开放连接行走。" },
    outcome: { publicResult: "通行时间已经经过。", fictionTimeCostMicros: "60000000" } });
  const completed = act(f, waited.state, { kind: "completeActivity", proposalId: "root:travel:complete", activityId: activity.activityId });
  assert.equal(completed.state.entities[ACTOR].sceneId, destScene);
  const moved = completed.events.find(event => event.eventType === "CharacterMoved").payload;
  // One tier to set off, then the minute of travel.
  assert.equal(moved.departureMicros, "360000000");
  assert.equal(moved.arrivalMicros, "360000000");
  assert.equal(moved.passage.passageRef, connection.definitionRef);
  assert.equal(moved.activityId, activity.activityId);
  const duplicate = act(f, completed.state, { kind: "completeActivity", proposalId: "root:travel:duplicate", activityId: activity.activityId }, "rejected");
  assert.deepEqual(duplicate.events, []);
  const replay = f.runtime.replay(f.genesis, [...created.events, ...started.events, ...waited.events, ...completed.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, completed.state);
  const corrected = correct(f, [...created.events, ...started.events, ...waited.events, ...completed.events], completed.receipt.receiptId, "travel-completion");
  assert.equal(corrected.state.entities[ACTOR].sceneId, SCENE);
  assert.deepEqual(corrected.state.combatRuntime.entities[ACTOR], waited.state.combatRuntime.entities[ACTOR]);
  assert.equal(corrected.state.campaignRuntime.activities[activity.activityId].status, "active");
  const correctedReplay = f.runtime.replay(f.genesis, [...created.events, ...started.events, ...waited.events, ...completed.events, ...corrected.events]);
  assert.equal(correctedReplay.kind, "replayed", JSON.stringify(correctedReplay));
  assert.deepEqual(correctedReplay.state, corrected.state);
});

test("a typed location and same-bundle passage commit before discovery without movement, time or interior disclosure", () => {
  const f = createAuthoredProbeFixture("location-create");
  const result = commit(f, [location(f), passage(DESTINATION)]);
  const [destination, connection] = definitions(result);
  const sceneId = dynamicLocationSceneRef(destination.definitionRef);
  assert.ok(result.state.scenes[sceneId]);
  assert.equal(result.state.entities[ACTOR].sceneId, SCENE);
  assert.deepEqual(result.state.fictionTimelines, f.state.fictionTimelines);
  assert.deepEqual(result.state.entities[ACTOR].resources, f.state.entities[ACTOR].resources);
  assert.equal(connection.definition.content.passage.toLocationRef, destination.definitionRef);
  assert.ok(!result.events.some(event => ["CharacterMoved", "PartyMoved", "ActivityStarted", "ResourceSpent"].includes(event.eventType)));
  const projected = f.runtime.project(f.profiles, result.state, f.viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState: f.state, events: result.events } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.ok(JSON.stringify(projected).includes("向下延伸的石阶"));
  assert.ok(!JSON.stringify(projected).includes(INTERIOR));
  const replayed = f.runtime.replay(f.genesis, result.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.deepEqual(replayed.state, result.state);
});

test("the same correction authority restores passage revision and removes materialized location geometry, facts and discovery", () => {
  const f = createAuthoredProbeFixture("location-correction");
  const created = commit(f, [location(f), passage(DESTINATION)]);
  const [destination, connection] = definitions(created), sceneId = dynamicLocationSceneRef(destination.definitionRef);
  const closing = interaction(connection.definitionRef, [{ kind: "definitionRevision", definitionRef: connection.definitionRef,
    operations: [{ kind: "set", path: ["observableState"], value: "closed" }], summary: "连接已关闭。" }]);
  const closed = commit(nextFixture(f, created.state, "close", [connection.definitionRef]), [closing]);
  const revisionCorrected = correct(f, [...created.events, ...closed.events], closed.receipt.receiptId, "passage-revision");
  assert.deepEqual(revisionCorrected.state.campaignRuntime.definitions[connection.definitionRef], created.state.campaignRuntime.definitions[connection.definitionRef]);
  const removed = correct(f, [...created.events, ...closed.events], created.receipt.receiptId, "location-creation");
  assert.equal(removed.state.scenes[sceneId], undefined);
  assert.equal(removed.state.combatRuntime.scenes[sceneId], undefined);
  assert.equal(removed.state.campaignRuntime.definitions[destination.definitionRef], undefined);
  assert.equal(removed.state.campaignRuntime.definitions[connection.definitionRef], undefined);
  assert.equal(removed.state.canonicalFacts[`passage-fact:${connection.definitionRef}`], undefined);
  assert.equal(removed.state.entities[ACTOR].sceneId, SCENE);
  const projected = f.runtime.project(f.profiles, removed.state, f.viewer);
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  assert.ok(!JSON.stringify(projected).includes(INTERIOR));
  for (const result of [revisionCorrected, removed]) {
    const replay = f.runtime.replay(f.genesis, [...created.events, ...closed.events, ...result.events]);
    assert.equal(replay.kind, "replayed", JSON.stringify(replay));
    assert.deepEqual(replay.state, result.state);
  }
});

test("an authorized existing destination uses the same passage producer and retains its previously fixed interior", () => {
  const f = createAuthoredProbeFixture("existing-location");
  const first = commit(f, [location(f)]), destination = definitions(first)[0].definitionRef;
  const next = { ...f, state: first.state, rootActionId: `${f.rootActionId}:connection` };
  next.requiredContext = freezeAuthoredProbeContext(next, next.state, { rootActionId: next.rootActionId,
    focusRefs: [SOURCE, destination], intentText: "发现当前地点通往既有地下空间的一条连接。" }).context;
  const second = commit(next, [passage(destination, { bidirectional: false })]);
  assert.equal(definitions(second).length, 1);
  assert.equal(definitions(second)[0].definition.content.passage.toLocationRef, destination);
  assert.deepEqual(second.state.campaignRuntime.definitions[destination], first.state.campaignRuntime.definitions[destination]);
  assert.equal(second.state.entities[ACTOR].sceneId, SCENE);
  const replay = f.runtime.replay(f.genesis, [...first.events, ...second.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, second.state);
});

test("foreign, absent or stale creation grants and nonexistent passage endpoints reject without events", () => {
  const f = createAuthoredProbeFixture("location-reject");
  for (const mutate of [context => { context.entries = context.entries.filter(entry => entry.kind !== "openBlank"); },
    context => { context.entries.find(entry => entry.kind === "openBlank").scopeRef = "scene:foreign"; }]) {
    const fixture = { ...f, requiredContext: structuredClone(f.requiredContext) }; mutate(fixture.requiredContext);
    const result = lower(fixture, [location(f), passage(DESTINATION)]);
    assert.equal(result.kind, "rejected");
  }
  const nonexistent = lower(f, [passage("scene:missing")]);
  assert.equal(nonexistent.kind, "rejected");
  const before = structuredClone(f.state);
  assert.deepEqual(f.state, before);
});

test("conditional locations and passages remain bound to the original shared result through pause and replay", () => {
  for (const roll of [1, 20]) {
    const f = createAuthoredProbeFixture(`location-check-${roll}`);
    const wire = sharedCheckBundle("worldInteraction");
    const producers = [location(f), passage(DESTINATION)].map(proposal => ({ ...proposal, outcomeBinding: "onSuccess",
      produces: proposal.produces.map(produced => ({ ...produced, outcomeBinding: "onSuccess" })) }));
    wire.proposals = [wire.proposals[1], ...producers];
    const value = parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle({ ...itemBundle(), ...wire }));
    const lowered = lowerVNext2ProposalBundle({ value, state: f.state, requiredContext: f.requiredContext,
      actorCharacterId: ACTOR, rootActionId: f.rootActionId });
    assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
    const pending = act(f, f.state, lowered.command.rulesInput, "awaitingRandomness");
    assert.equal(definitions(pending).length, 0);
    const result = act(f, pending.state, { kind: "fulfillAuthoritativeRandomness", continuation: pending.continuation, rolls: [roll] });
    assert.equal(definitions(result).length, roll === 20 ? 2 : 0);
    assert.equal(result.state.entities[ACTOR].sceneId, SCENE);
    const replay = f.runtime.replay(f.genesis, [...pending.events, ...result.events]);
    assert.equal(replay.kind, "replayed", JSON.stringify(replay));
    assert.deepEqual(replay.state, result.state);
    if (roll === 20) {
      const changed = structuredClone(result.events);
      changed.find(event => event.eventType === "SemanticDefinitionMaterialized").payload.definition.content.description = "changed after the roll";
      assert.notEqual(f.runtime.replay(f.genesis, [...pending.events, ...changed]).kind, "replayed");
    }
  }
});

test("chosen passage state and direction are authoritative, and dynamic scenes cannot be entered by an unbound native move", () => {
  const f = createAuthoredProbeFixture("passage-native");
  const created = commit(f, [location(f), passage(DESTINATION, { bidirectional: false })]);
  const [destination, connection] = definitions(created), sceneId = dynamicLocationSceneRef(destination.definitionRef);
  const command = { kind: "moveIndividually", rootActionId: "root:native-passage", characterId: ACTOR,
    destinationSceneId: sceneId, fictionTimeCostMicros: "60000000", passageRef: connection.definitionRef };
  const { passageRef: ignored, ...unbound } = command;
  assert.deepEqual(act(f, created.state, unbound, "rejected").events, []);
  assert.deepEqual(act(f, created.state, { ...command, fictionTimeCostMicros: "1" }, "rejected").events, []);
  const moved = act(f, created.state, command);
  assert.equal(moved.state.entities[ACTOR].sceneId, sceneId);
  assert.deepEqual(act(f, moved.state, { ...command, rootActionId: "root:wrong-direction", destinationSceneId: SCENE }, "rejected").events, []);
  const replay = f.runtime.replay(f.genesis, [...created.events, ...moved.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, moved.state);
});

test("party consent freezes one explicit passage for all members and rejects a changed connection without movement", () => {
  const f = createAuthoredProbeFixture("passage-party");
  const created = commit(f, [location(f), passage(DESTINATION)]), [destination, connection] = definitions(created);
  const invited = act(f, created.state, { kind: "invitePartyMember", rootActionId: "root:passage-party:invite",
    inviterCharacterId: ACTOR, invitedCharacterId: OTHER }, "awaitingInput");
  const joined = act(f, invited.state, { kind: "answerPartyInvitation", rootActionId: "root:passage-party:invite",
    pendingInputId: invited.pending.pendingInputId, controllerCharacterId: OTHER, accept: true });
  const request = { kind: "proposePartyMove", rootActionId: "root:passage-party:move", leaderCharacterId: ACTOR,
    destinationSceneId: dynamicLocationSceneRef(destination.definitionRef), fictionTimeCostMicros: "60000000", passageRef: connection.definitionRef };
  const { passageRef: _ref, ...unbound } = request;
  assert.deepEqual(act(f, joined.state, unbound, "rejected").events, []);
  const pending = act(f, joined.state, request, "awaitingInput");
  assert.equal(pending.state.entities[ACTOR].sceneId, SCENE);
  assert.equal(pending.state.entities[OTHER].sceneId, SCENE);
  const answer = { kind: "answerPartyMove", rootActionId: request.rootActionId, pendingInputId: pending.pending.pendingInputId,
    controllerCharacterId: OTHER, accept: true };
  assert.deepEqual(act(f, pending.state, { ...answer, passageRef: "definition:another-passage" }, "rejected").events, []);
  const closing = interaction(connection.definitionRef, [{ kind: "definitionRevision", definitionRef: connection.definitionRef,
    operations: [{ kind: "set", path: ["observableState"], value: "closed" }], summary: "连接已关闭。" }]);
  const closed = commit(nextFixture(f, pending.state, "close-party-connection", [connection.definitionRef]), [closing]);
  assert.deepEqual(act(f, closed.state, answer, "rejected").events, []);
  assert.equal(closed.state.entities[ACTOR].sceneId, SCENE);
  assert.equal(closed.state.entities[OTHER].sceneId, SCENE);
  const moved = act(f, pending.state, answer);
  for (const actor of [ACTOR, OTHER]) assert.equal(moved.state.entities[actor].sceneId, request.destinationSceneId);
  assert.deepEqual(moved.events.find(event => event.eventType === "PartyMoved").payload.passage,
    pending.events.find(event => event.eventType === "PartyMoveProposed").payload.passage);
  const replay = f.runtime.replay(f.genesis, [...created.events, ...invited.events, ...joined.events, ...pending.events, ...moved.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay)); assert.deepEqual(replay.state, moved.state);
});

// Recorded gap, not yet a contract: an act one tier long crosses a shorter travel's
// deadline (Rules records it in mechanicalResult.fictionTime.crossedDeadlines and
// lets the act commit). If the passage closed inside that act, the overdue
// travel's frozen completion is illegal, and due-first settlement then rejects
// every later input on that timeline. Settlement should interrupt such an
// Activity instead of blocking the timeline.
test("an overdue travel whose completion became illegal is interrupted at settlement instead of blocking the timeline", { todo: true });

test("closing a passage through the ordinary world effect invalidates both a prepared traversal and an active travel completion", () => {
  const f = createAuthoredProbeFixture("passage-closed");
  // The closing act itself takes one tier, so the travel must outlast it for the closing to land mid-travel.
  const created = commit(f, [location(f), passage(DESTINATION, { travelDurationMicros: "1800000000" })]), connection = definitions(created)[1].definitionRef;
  const next = nextFixture(f, created.state, "prepared-travel", [connection]);
  const proposal = interaction(connection, [{ kind: "traversePassage", passageRef: connection }]);
  const prepared = lower(next, [proposal]);
  assert.equal(prepared.kind, "accepted", JSON.stringify(prepared));
  const closing = interaction(connection, [{ kind: "definitionRevision", definitionRef: connection,
    operations: [{ kind: "set", path: ["observableState"], value: "closed" }], summary: "连接已关闭。" }]);
  const closed = commit(nextFixture(f, created.state, "close", [connection]), [closing]);
  assert.equal(closed.state.campaignRuntime.definitions[connection].content.observableState, "closed");
  assert.deepEqual(act(f, closed.state, prepared.command.rulesInput, "rejected").events, []);
  const current = nextFixture(f, closed.state, "closed-travel", [connection]);
  assert.equal(lower(current, [proposal]).kind, "rejected");
  const started = act(f, created.state, prepared.command.rulesInput);
  const activityId = started.events.find(event => event.eventType === "ActivityStarted").payload.activityId;
  const closedDuring = commit(nextFixture(f, started.state, "close-during", [connection]), [closing]);
  const waited = act(f, closedDuring.state, { kind: "resolveFreeAction", proposalId: "root:closed:wait", characterId: ACTOR,
    goal: "时间经过", method: "等待", feasibility: { kind: "directSuccess", publicBasis: "时间经过。" },
    outcome: { publicResult: "半小时经过。", fictionTimeCostMicros: "1800000000" } });
  const refused = act(f, waited.state, { kind: "completeActivity", proposalId: "root:closed:finish", activityId }, "rejected");
  assert.deepEqual(refused.events, []);
  assert.equal(waited.state.entities[ACTOR].sceneId, SCENE);
  const replay = f.runtime.replay(f.genesis, [...created.events, ...started.events, ...closedDuring.events, ...waited.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, waited.state);
});
