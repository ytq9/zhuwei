import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { geometry } from "../../support/fixtures/historical-world.mjs";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { npcOwnRequiredContext, npcMoveChoices } from "../../../app/_runtime/lib/kp/vnext/npc-work.ts";
import { concealmentCandidates } from "../../../app/_runtime/lib/rules/v2/concealment.ts";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";

// SPEC 0006 §7: an NPC changes its own scene through its own decision. The
// move commits the ordinary CharacterMoved, so presence, the tactical map,
// replay and every observer's projection follow authoritative state.
const LIAN = "npc:move-lian", YARD = "scene:move-yard", HALL = "scene:move-hall";

function fixture(name, options = {}) {
  return createAuthoredProbeFixture(`npc-move:${name}`, { npcCharacters: [{ id: LIAN, name: "莉安" }],
    additionalScenes: [{ id: YARD, name: "后院", geometry: geometry() }, { id: HALL, name: "镇公所", geometry: geometry() }], ...options });
}
function npcContext(f, state = f.state, root = `${f.rootActionId}:lian`) {
  const context = npcOwnRequiredContext(state, f.profiles, f.moduleProfile, LIAN, root,
    { submissionRef: `npc-work:${root}`, actorRef: LIAN, text: "去后院看看酒窖门。" });
  assert.ok(context, "the NPC's own context");
  return context;
}
/** Lian walks off; the actor in the corridor sees her go. */
function leave(destination, { observers = [ACTOR], sceneRef = SCENE } = {}) {
  const target = destination.kind === "scene" ? destination.sceneRef : destination.passageRef;
  const saw = observers.map(observerRef => ({ observerRef, subjectRef: LIAN, sense: "sight", evidence: "莉安起身从侧门出去了。", basisRefs: [LIAN] }));
  return { mode: "adjudication", basisRefs: [LIAN], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "莉安离开了。" },
    proposals: [{ basisRefs: [LIAN], consumes: [], produces: [], sceneRef, kind: "worldInteraction", outcomeBinding: "always",
      intent: "去后院看看酒窖门。", method: "起身从侧门出去。", targetRefs: [target], directTargetRefs: [target], instrumentRefs: [],
      abilityRef: { kind: "none" }, branches: { success: { outcomeCode: "outcome:left", summary: "莉安去了后院。",
        effects: [{ kind: "moveNpc", destination }], sensoryEvidence: saw, pressures: [], opportunities: [] }, failure: { kind: "none" } } }] };
}
function lower(f, bundle, { actor = LIAN, state = f.state, context = npcContext(f, state) } = {}) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ value: parsed.bundle, requiredContext: context, state, profiles: f.profiles,
    rootActionId: context.binding.rootActionId, actorCharacterId: actor });
}
function commit(f, bundle, options) {
  const result = lower(f, bundle, options);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  const committed = stepActionToDecision(f.runtime, f.profiles, options?.state ?? f.state, result.command.rulesInput);
  assert.equal(committed.kind, "committed", JSON.stringify(committed));
  return committed;
}
function replayed(f, events) {
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  return replay.state;
}
function player(f, state, characterId = ACTOR) {
  const principal = characterId === ACTOR ? "principal:probe-actor" : "principal:probe-target";
  const projected = f.runtime.project(f.profiles, state, { kind: "player", principalId: principal,
    seatId: `seat:${principal.slice("principal:".length)}`, sessionVersion: 1, characterId });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}

test("an NPC's own move takes it out of its scene at once: state, map, clock, replay and presence agree", () => {
  const f = fixture("leave");
  assert.deepEqual(npcMoveChoices(npcContext(f)).sceneRefs, [HALL, YARD], "the places Lian can walk to");
  assert.ok(player(f, f.state).perceivedCharacters.some(entry => entry.characterId === LIAN), "Lian is perceived before she leaves");
  const before = f.state.fictionTimelines[f.state.multiplayerRuntime.characterTimelineIds[LIAN]].nowMicros;

  const { state, events } = commit(f, leave({ kind: "scene", sceneRef: YARD, travel: "5min" }));
  const moved = events.find(event => event.eventType === "CharacterMoved");
  assert.ok(moved, events.map(event => event.eventType).join());
  assert.equal(moved.payload.characterId, LIAN);
  assert.equal(moved.visibilityPolicyId, "visibility:scene-observers");
  const resolved = events.find(event => event.eventType === "WorldInteractionResolved");
  assert.deepEqual(resolved.payload.appliedEffects.filter(effect => effect.kind === "npcMoved"),
    [{ kind: "npcMoved", characterId: LIAN, fromSceneRef: SCENE, toSceneRef: YARD, passageRef: null }]);

  assert.equal(state.entities[LIAN].sceneId, YARD);
  assert.equal(state.combatRuntime.entities[LIAN].sceneId, YARD, "the tactical map follows");
  assert.ok(geometry().spawnPoints.some(point => JSON.stringify(point) === JSON.stringify(state.combatRuntime.entities[LIAN].position)),
    "she stands on one of the yard's spawn points");
  const timeline = state.multiplayerRuntime.characterTimelineIds[LIAN];
  assert.equal(state.fictionTimelines[timeline].nowMicros, (BigInt(before) + 300_000_000n).toString(), "she arrives after five minutes on the way");
  assert.equal(state.fictionTimelines[f.state.multiplayerRuntime.characterTimelineIds[ACTOR]].nowMicros, before,
    "the actor's clock does not move because Lian left");
  assert.deepEqual(replayed(f, events), state);

  // SPEC 0005 §6.2: she no longer counts as present for a covert act here.
  assert.equal(concealmentCandidates(state, ACTOR, "sight").includes(LIAN), false);
  const seen = player(f, state);
  assert.equal(Object.hasOwn(seen.entities, LIAN), false);
  assert.equal(seen.tacticalProjection.visibleEntities.some(entity => entity.id === LIAN), false);
  assert.equal(seen.perceivedCharacters.some(entry => entry.characterId === LIAN), false);
});

// SPEC 0010 §7: the viewer's list of who is present carries what it can see
// of each of them; someone it cannot see is not listed.
test("the viewer's present list shows who is down or dead and leaves out whom it cannot see", () => {
  const f = fixture("states");
  const state = structuredClone(f.state);
  state.combatRuntime.entities[PEER].conditions = { ...state.combatRuntime.entities[PEER].conditions, unconscious: true };
  state.combatRuntime.entities[LIAN].lifeState = "dead";
  const status = ({ tenureStatus, alive, conscious }) => ({ tenureStatus, alive, conscious });
  const listed = Object.fromEntries(player(f, state).perceivedCharacters.map(entry => [entry.characterId, status(entry)]));
  assert.deepEqual(listed, { [LIAN]: { tenureStatus: "active", alive: false, conscious: false },
    [PEER]: { tenureStatus: "active", alive: true, conscious: false } });

  state.combatRuntime.entities[LIAN].visibilityPolicyId = "visibility:hidden-until-evidence";
  state.combatRuntime.entities[LIAN].visibilityFactId = "fact:npc-move:unseen-lian";
  assert.deepEqual(player(f, state).perceivedCharacters.map(entry => entry.characterId), [PEER]);
});

function observed(f, result, prior, characterId) {
  const principal = characterId === ACTOR ? "principal:probe-actor" : "principal:probe-target";
  const projected = f.runtime.project(f.profiles, result.state, { kind: "player", principalId: principal,
    seatId: `seat:${principal.slice("principal:".length)}`, sessionVersion: 1, characterId },
  { channel: "realtime", committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: LIAN, priorState: prior, events: result.events } });
  assert.equal(projected.kind, "projected", JSON.stringify(projected));
  return projected;
}
const outcomes = (projected) => (projected.renderableClaims?.claims ?? [])
  .filter(claim => claim.kind === "mechanicalOutcome" && ["departed", "arrived"].includes(claim.outcomeCode))
  .map(claim => claim.outcomeCode);
const changes = (projected) => (projected.committedDelta?.changes ?? [])
  .filter(change => ["characterDeparted", "characterArrived"].includes(change.kind)).map(change => [change.kind, change.characterId]);

// SPEC 0010 §7: each observer learns what its own scene saw; a scene that saw
// neither end learns nothing.
test("the room she leaves sees her go, the room she enters sees her arrive and she keeps its clock", () => {
  const f = fixture("arrive", { characterScenes: { [PEER]: YARD } });
  const peerTimeline = f.state.multiplayerRuntime.characterTimelineIds[PEER];
  const result = commit(f, leave({ kind: "scene", sceneRef: YARD, travel: "none" }));
  const { state } = result;
  assert.equal(state.multiplayerRuntime.characterTimelineIds[LIAN], peerTimeline, "she joins the clock of the player already there");
  assert.equal(state.fictionTimelines[peerTimeline].nowMicros, f.state.fictionTimelines[peerTimeline].nowMicros,
    "the next room reached at once leaves that clock where it was");

  const hall = observed(f, result, f.state, ACTOR), yard = observed(f, result, f.state, PEER);
  assert.deepEqual(outcomes(hall), ["departed"]);
  assert.deepEqual(changes(hall), [["characterDeparted", LIAN]]);
  assert.deepEqual(outcomes(yard), ["arrived"]);
  assert.deepEqual(changes(yard), [["characterArrived", LIAN]]);
  assert.deepEqual(yard.perceivedCharacters.find(entry => entry.characterId === LIAN),
    { characterId: LIAN, name: "莉安", kind: "npc", tenureStatus: "active", alive: true, conscious: true });
  assert.equal(yard.tacticalProjection.visibleEntities.some(entity => entity.id === LIAN), true, "she stands on the yard's map");
  assert.deepEqual(replayed(f, result.events), state);
});

test("an NPC that is not free to walk off, or a player, cannot use the move", () => {
  const f = fixture("refused");
  const bundle = leave({ kind: "scene", sceneRef: YARD, travel: "5min" });
  const player = lower(f, bundle, { actor: ACTOR, context: f.requiredContext });
  assert.equal(player.kind, "rejected");
  assert.match(JSON.stringify(player), /movement:npc-actor-only|PROPOSAL_REFERENCE_INVALID/);

  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  // A Rules guard, checked against a copy in which Lian has fallen unconscious.
  const unconscious = structuredClone(f.state);
  unconscious.combatRuntime.entities[LIAN].conditions = { ...unconscious.combatRuntime.entities[LIAN].conditions, unconscious: true };
  const refused = f.runtime.step(f.profiles, unconscious, lowered.command.rulesInput);
  assert.equal(refused.kind, "rejected", JSON.stringify(refused));
  assert.equal(f.runtime.step(f.profiles, f.state, lowered.command.rulesInput).kind, "committed", "the same move commits while she can walk");

  const nowhere = lower(f, leave({ kind: "scene", sceneRef: SCENE, travel: "5min" }));
  assert.equal(nowhere.kind, "rejected", "her own scene is not a destination");
});

const PLACE = "prospective:town-hall", WAY = "prospective:street";
function created(kind, handle, definition, consumes = []) {
  const template = VNEXT_SEMANTIC_TEMPLATES[kind];
  return { kind: "materializeObject", basisRefs: [LIAN], consumes,
    produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }], outcomeBinding: "always",
    semanticKind: kind, templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: "visibility:scene-observers", definition: { sceneRef: SCENE, visibilityFactId: null,
      label: kind === "location" ? "镇公所" : "通往镇公所的街", description: kind === "location" ? "镇公所的前厅，柜台后面堆着备案卷宗。" : "侧门外的石板街，走到镇公所要一会儿。",
      observableState: kind === "passage" ? "open" : null, affordances: null, mechanicDefinitionRefs: [], ...definition },
    summary: "莉安要去的地方和去那里的路。" };
}

// The user's ruling: a place the module does not have is a dynamic location.
// The NPC creates it and the way there in the same decision, then walks it.
test("an NPC creates the place it goes to and the way there, then walks that way at once", () => {
  const f = fixture("new-place");
  const move = leave({ kind: "passage", passageRef: WAY });
  const walk = { ...move.proposals[0], consumes: [{ kind: "prospective", handle: WAY }] };
  const bundle = { ...move, proposals: [
    created("location", PLACE, { geometry: geometry() }),
    created("passage", WAY, { passage: { fromLocationRef: SCENE, toLocationRef: PLACE, bidirectional: true,
      traversal: "出侧门沿石板街走", travelDurationMicros: "600000000" } }, [{ kind: "existing", ref: SCENE }, { kind: "prospective", handle: PLACE }]),
    walk] };
  const result = commit(f, bundle);
  const location = Object.values(result.state.campaignRuntime.definitions).find(definition => definition.semanticKind === "location");
  assert.ok(location, "the town hall exists");
  assert.equal(result.state.entities[LIAN].sceneId, location.content.sceneRef, "she is at the town hall");
  const moved = result.events.find(event => event.eventType === "CharacterMoved");
  assert.equal(moved.payload.passage.destinationSceneRef, location.content.sceneRef);
  assert.equal(BigInt(moved.payload.arrivalMicros) - BigInt(moved.payload.departureMicros), 600_000_000n, "the street takes ten minutes");
  assert.equal(concealmentCandidates(result.state, ACTOR, "sight").includes(LIAN), false);
  assert.deepEqual(replayed(f, result.events), result.state);
});
