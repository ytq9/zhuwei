import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE,
  PROBE_SOURCE } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { authoritativeModuleProfile } from "../../../app/_runtime/lib/module/authoritative.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { placesReachableFrom } from "../../../app/_runtime/lib/rules/authority-read.ts";
import { dynamicLocationSceneRef } from "../../../app/_runtime/lib/rules/v2/dynamic-locations.ts";
import { visitedSceneIds } from "../../../app/_runtime/lib/rules/v2/places.ts";
import { hashWorldState } from "../../../app/_runtime/lib/rules/v2/validation.ts";
import { entityOccupanciesOverlap, rectangularFeatureEntity } from "../../../app/_runtime/lib/rules/profiles/combat-geometry.ts";
import { nextTo } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import { stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";
import { atomicCompletionInput } from "../../support/fixtures/vnext-action-duration.mjs";

// SPEC 0014 §4 (ADR 0103): the module's connections are registered at room
// start; the KP sees where the actor can go and writes one goTo step; Rules
// walks the actor to the departure door, plans the route over open doors,
// advances its clock by the time on the way and puts it at the destination
// door. The two sides of a door keep the same state.

const HALL = "wake", YARD = "yard", WILLS = "wills", UPSTAIRS = "private-lian", CELLAR = "cellar";
const HALL_YARD_DOOR = "feature:wake:yard-door", YARD_HALL_DOOR = "feature:yard:hall-door", YARD_CELLAR_DOOR = "feature:yard:cellar-door";
const v4 = await authoritativeModuleProfile("black-oak-will");
const MODULE_SCENES = v4.storyBible.storyAnchors.locations.map(location => ({ id: location.sceneId, name: location.name,
  geometry: structuredClone(location.tacticalGeometry) }));
// What Room passes at genesis: the module profile's connections and site plan.
const PLACE_MAP = structuredClone(v4.tacticalSite);
const ONE_MINUTE = 60_000_000n;

function house(caseId, characterScenes = { [ACTOR]: HALL, [PEER]: YARD }) {
  return createAuthoredProbeFixture(`places:${caseId}`, { additionalScenes: MODULE_SCENES, placeMap: PLACE_MAP, characterScenes });
}
/** `who`'s act from `state`, with its own frozen context. */
function as(f, state, suffix, who = ACTOR, intentText = "我从后门出去，到后院。") {
  const next = { ...f, state, actorCharacterId: who, rootActionId: `${f.rootActionId}:${suffix}` };
  return { ...next, requiredContext: freezeAuthoredProbeContext(next, state, { rootActionId: next.rootActionId, intentText }).context };
}
const result = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
function goTo(sceneRef, placeRef, duration = "0") {
  return { mode: "adjudication", basisRefs: [sceneRef], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: duration, risk: "没有风险。", successOutcome: "到了那里。" },
    proposals: [{ kind: "worldInteraction", basisRefs: [sceneRef], consumes: [], produces: [], outcomeBinding: "always", sceneRef,
      intent: "从后门出去，到后院。", method: "推开后门走出去。", targetRefs: [], directTargetRefs: [], instrumentRefs: [],
      abilityRef: { kind: "none" }, commonAction: { kind: "goTo", targetRef: placeRef, destinationRef: null, option: "none" },
      branches: { success: result("went", "走到了那里。"), failure: null } }] };
}
function lower(f, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ value: parsed.bundle, state: f.state, requiredContext: f.requiredContext,
    actorCharacterId: f.actorCharacterId, rootActionId: f.rootActionId, profiles: f.profiles });
}
function act(f, bundle) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const committed = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(committed.kind, "committed", JSON.stringify(committed).slice(0, 2000));
  return { lowered, committed };
}
const timelineOf = (state, id) => state.multiplayerRuntime.characterTimelineIds[id] ?? state.activeBranchId;
const clockOf = (state, id) => BigInt(state.fictionTimelines[timelineOf(state, id)].nowMicros);
const featureOf = (state, sceneId, featureId) => state.combatRuntime.scenes[sceneId].geometry.obstacles.find(entry => entry.featureId === featureId);
const placeOf = (places, ref) => places.find(place => place.placeRef === ref);
function closeDoor(f, state, who, featureId, intent = "close", principal = "principal:probe-actor") {
  const done = f.runtime.step(f.profiles, state, { kind: "interactEnvironmentFeature", rootActionId: `root:places:${featureId}:${intent}`,
    actorCharacterId: who, controllerPrincipalId: principal, featureId, intent });
  assert.equal(done.kind, "committed", JSON.stringify(done));
  return done;
}

test("the module's connections are registered at room start, and each character has been only where it starts", () => {
  const f = house("registered");
  const placeMap = f.state.campaignRuntime.placeMap;
  assert.deepEqual(placeMap.connections.map(connection => connection.id), ["cellar-shrine", "wake-private-lian", "wake-wills", "wake-yard", "yard-cellar"]);
  assert.ok(placeMap.connections.every(connection => connection.source === "module" && connection.sides.every(side => side.featureId !== null)));
  assert.deepEqual(placeMap.connections.find(connection => connection.id === "wake-yard"),
    { id: "wake-yard", source: "module", bidirectional: true, travelMicros: "60000000", sides: [
      { sceneId: HALL, featureId: HALL_YARD_DOOR, arrival: { x: "60", y: "-300", elevation: "0" } },
      { sceneId: YARD, featureId: YARD_HALL_DOOR, arrival: { x: "-180", y: "360", elevation: "0" } }] });
  assert.deepEqual(placeMap.sitePlan, Object.fromEntries(Object.keys(v4.tacticalSite.sitePlan).sort()
    .map(sceneId => [sceneId, v4.tacticalSite.sitePlan[sceneId]])));
  // Nothing is written at genesis, so a room's start keeps its shape; until
  // a first arrival elsewhere a character has been only where it is.
  assert.equal(f.state.entities[ACTOR].visitedSceneIds, undefined);
  assert.deepEqual([visitedSceneIds(f.state, ACTOR), visitedSceneIds(f.state, PEER)], [[HALL], [YARD]]);
  // A room whose module has no site has no place map.
  assert.equal(createAuthoredProbeFixture("places:no-map").state.campaignRuntime.placeMap, undefined);
  // A connection whose door state the maps do not hold, or whose door is not on the map, is refused at genesis.
  const wrongState = structuredClone(PLACE_MAP);
  wrongState.connections.find(connection => connection.id === "wake-yard").initialState = "closed";
  const missingDoor = structuredClone(PLACE_MAP);
  missingDoor.connections.find(connection => connection.id === "wake-yard").sides[0].featureId = "feature:wake:no-such-door";
  for (const placeMap of [wrongState, missingDoor]) {
    assert.throws(() => createAuthoredProbeFixture("places:bad-map", { additionalScenes: MODULE_SCENES, placeMap,
      characterScenes: { [ACTOR]: HALL, [PEER]: YARD } }), /initialization failed/);
  }
});

test("from the hall the yard, the wills room and upstairs are open; the cellar is behind the yard's locked door", () => {
  const f = house("reachable");
  const places = placesReachableFrom(f.state, ACTOR);
  assert.deepEqual(places.map(place => [place.placeRef, place.open]),
    [[CELLAR, false], [UPSTAIRS, true], [WILLS, true], [YARD, true]]);
  assert.deepEqual(placeOf(places, YARD), { placeRef: YARD, label: MODULE_SCENES.find(scene => scene.id === YARD).name,
    viaFeatureRef: HALL_YARD_DOOR, viaLabel: featureOf(f.state, HALL, HALL_YARD_DOOR).label, travelMicros: "60000000", open: true });
  const cellar = placeOf(places, CELLAR);
  assert.equal(cellar.viaFeatureRef, HALL_YARD_DOOR);
  assert.equal(cellar.closedRef, YARD_CELLAR_DOOR);
  assert.equal(cellar.closedLabel, featureOf(f.state, YARD, YARD_CELLAR_DOOR).label);
  assert.equal(cellar.travelMicros, "120000000");
  // Nothing past the locked door is listed.
  assert.equal(placeOf(places, "shrine"), undefined);
  // The KP's frozen context lists the same places.
  const context = as(f, f.state, "context").requiredContext;
  const entry = context.entries.find(candidate => candidate.entryRef === `reachable-places:${ACTOR}`);
  assert.deepEqual(entry.value.reachablePlaces, places);
});

test("goTo the yard walks to the hall's back door, takes a minute on the way and arrives at the yard door", () => {
  const f = house("go-to-yard");
  const before = clockOf(f.state, ACTOR);
  const { lowered, committed } = act(as(f, f.state, "go"), goTo(HALL, YARD));
  const plan = atomicCompletionInput(lowered.command.rulesInput).steps[0].rulesInput.plan;
  assert.deepEqual(plan.branches.success.effects, [{ kind: "travelTo", destinationRef: YARD }]);
  assert.equal(plan.approach.kind, "point");
  // The walk ends next to the hall's back door, before the move.
  const types = committed.events.map(event => event.eventType);
  assert.ok(types.indexOf("CharacterRepositioned") >= 0 && types.indexOf("CharacterRepositioned") < types.indexOf("CharacterMoved"), types.join(","));
  const walk = committed.events.find(event => event.eventType === "CharacterRepositioned").payload;
  const door = rectangularFeatureEntity(featureOf(f.state, HALL, HALL_YARD_DOOR), HALL);
  assert.equal(nextTo({ ...f.state.combatRuntime.entities[ACTOR], position: walk.path.at(-1) }, door), true);
  const moved = committed.events.find(event => event.eventType === "CharacterMoved").payload;
  assert.deepEqual(moved.travel, { connectionIds: ["wake-yard"], arrival: { x: "-180", y: "360", elevation: "0" } });
  const state = committed.state;
  assert.equal(state.entities[ACTOR].sceneId, YARD);
  assert.equal(state.combatRuntime.entities[ACTOR].sceneId, YARD);
  assert.deepEqual(state.combatRuntime.entities[ACTOR].position, { x: "-180", y: "360", elevation: "0" });
  assert.equal(clockOf(state, ACTOR) - before, ONE_MINUTE);
  assert.deepEqual(state.entities[ACTOR].visitedSceneIds, [HALL, YARD]);
  const resolved = committed.events.find(event => event.eventType === "WorldInteractionResolved").payload;
  assert.ok(resolved.appliedEffects.some(effect => effect.kind === "travelled" && effect.toSceneRef === YARD));
  // Replay is exact.
  const replayed = f.runtime.replay(f.genesis, committed.events);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(hashWorldState(replayed.state), hashWorldState(state));
  // A move whose arrival spot is changed does not replay.
  const forged = structuredClone(committed.events);
  forged.find(event => event.eventType === "CharacterMoved").payload.travel.arrival.x = "-150";
  assert.notEqual(f.runtime.replay(f.genesis, forged).kind, "replayed");
  // Going back, the actor already stands next to the yard's door to the hall.
  const back = act(as(f, state, "back"), goTo(YARD, HALL));
  assert.equal(back.committed.state.entities[ACTOR].sceneId, HALL);
  assert.equal(back.committed.events.some(event => event.eventType === "CharacterRepositioned"), false);
  assert.deepEqual(back.committed.state.entities[ACTOR].visitedSceneIds, [HALL, YARD]);
});

test("the arrival spot taken by someone else, the actor arrives at the nearest free spot beside it", () => {
  const f = house("go-to-taken");
  const state = structuredClone(f.state);
  state.combatRuntime.entities[PEER].position = { x: "-180", y: "360", elevation: "0" };
  const { committed } = act(as(f, state, "go"), goTo(HALL, YARD));
  // A body is five feet across: the nearest free spot is one body away.
  const arrived = committed.state.combatRuntime.entities[ACTOR].position;
  assert.notDeepEqual(arrived, { x: "-180", y: "360", elevation: "0" });
  assert.equal((BigInt(arrived.x) + 180n) ** 2n + (BigInt(arrived.y) - 360n) ** 2n, 60n * 60n, JSON.stringify(arrived));
  assert.equal(entityOccupanciesOverlap(committed.state.combatRuntime.entities[ACTOR], committed.state.combatRuntime.entities[PEER]), false);
});

// ADR 0090: whoever the actor holds comes along on the walk within the
// place; leaving the place ends the hold (SPEC 0006 §7: an NPC changes place
// only by its own decision).
test("a creature the actor holds comes along to the door and is let go when the actor leaves the place", () => {
  const NAES = "npc:places:naes";
  const f = createAuthoredProbeFixture("places:carry", { additionalScenes: MODULE_SCENES, placeMap: PLACE_MAP,
    characterScenes: { [ACTOR]: HALL, [PEER]: YARD, [NAES]: HALL }, npcCharacters: [{ id: NAES, name: "奈斯" }] });
  const state = structuredClone(f.state);
  state.combatRuntime.entities[NAES].conditions = { ...(state.combatRuntime.entities[NAES].conditions ?? {}), grappledBy: ACTOR };
  const { committed } = act(as(f, state, "carry"), goTo(HALL, YARD));
  const walk = committed.events.find(event => event.eventType === "CharacterRepositioned").payload;
  assert.deepEqual(walk.carried.map(entry => entry.characterId), [NAES]);
  assert.equal(committed.state.entities[ACTOR].sceneId, YARD);
  assert.equal(committed.state.entities[NAES].sceneId, HALL);
  assert.deepEqual(committed.state.combatRuntime.entities[NAES].position, walk.carried[0].position);
  assert.equal(committed.state.combatRuntime.entities[NAES].conditions?.grappledBy, undefined);
});

test("goTo the cellar is refused while its door is locked, naming the door; so is going inside an encounter or with a duration", () => {
  const f = house("cellar-locked");
  const refused = lower(as(f, f.state, "cellar", ACTOR, "我去地窖。"), goTo(HALL, CELLAR));
  assert.equal(refused.kind, "rejected", JSON.stringify(refused));
  const detail = refused.diagnostics.find(entry => entry.constraint === "place:no-open-route");
  assert.ok(detail, JSON.stringify(refused.diagnostics));
  assert.deepEqual(detail.path, ["proposals", 0, "commonAction", "targetRef"]);
  assert.equal(detail.expected.closedRef, YARD_CELLAR_DOOR);
  assert.equal(detail.expected.closedLabel, featureOf(f.state, YARD, YARD_CELLAR_DOOR).label);
  assert.ok(detail.expected.reachablePlaces.some(place => place.placeRef === YARD && place.open));
  // A place that is not on the map is named as such, with the places that are.
  const unknown = lower(as(f, f.state, "nowhere", ACTOR, "我去别处。"), goTo(HALL, PROBE_SOURCE));
  assert.equal(unknown.kind, "rejected");
  assert.ok(unknown.diagnostics.some(entry => entry.constraint === "place:unknown-destination"), JSON.stringify(unknown.diagnostics));
  // The way takes its own time; the act says none.
  const timed = lower(as(f, f.state, "timed"), goTo(HALL, YARD, "300000000"));
  assert.equal(timed.kind, "rejected");
  assert.ok(timed.diagnostics.some(entry => entry.constraint === "bundle2:duration-forbidden-for-go-to"), JSON.stringify(timed.diagnostics));
  // Inside an encounter nobody goes elsewhere this way.
  const fighting = structuredClone(f.state);
  fighting.combatRuntime.entities[ACTOR].turn = { action: "1", bonusAction: "1", reaction: "1", attacksRemaining: "1", leveledBonusActionSpell: false };
  fighting.combatRuntime.encounters["encounter:places"] = { encounterId: "encounter:places", sceneId: HALL, status: "active",
    participantEntityIds: [ACTOR], initiativeGroups: [{ entryId: `initiative:${ACTOR}`, combatantEntityIds: [ACTOR] }],
    hostilities: [], battlefieldFactIds: [], surprisedEntityIds: [], initiative: { ordered: true,
      entries: [{ entryId: `initiative:${ACTOR}`, combatantEntityIds: [ACTOR], total: 20 }] },
    round: 1, turnCursor: 0, activeEntityId: ACTOR, turnOrderEntityIds: [ACTOR], roundClosed: false };
  const inFight = lower(as(f, fighting, "fight"), goTo(HALL, YARD));
  assert.equal(inFight.kind, "rejected");
  assert.ok(inFight.diagnostics.some(entry => entry.constraint === "place:in-encounter"), JSON.stringify(inFight.diagnostics));
});

test("closing or opening a door on one side does the same on the other, and the way follows it; replay is exact", () => {
  const f = house("doors");
  const closed = closeDoor(f, f.state, ACTOR, HALL_YARD_DOOR, "close");
  assert.deepEqual([featureOf(closed.state, HALL, HALL_YARD_DOOR).state, featureOf(closed.state, YARD, YARD_HALL_DOOR).state], ["closed", "closed"]);
  assert.equal(featureOf(closed.state, YARD, YARD_HALL_DOOR).impassable, true);
  assert.deepEqual(placeOf(placesReachableFrom(closed.state, ACTOR), YARD),
    { placeRef: YARD, label: MODULE_SCENES.find(scene => scene.id === YARD).name, viaFeatureRef: HALL_YARD_DOOR,
      viaLabel: featureOf(f.state, HALL, HALL_YARD_DOOR).label, travelMicros: "60000000", open: false,
      closedRef: HALL_YARD_DOOR, closedLabel: featureOf(f.state, HALL, HALL_YARD_DOOR).label });
  const refused = lower(as(f, closed.state, "closed"), goTo(HALL, YARD));
  assert.equal(refused.kind, "rejected");
  assert.ok(refused.diagnostics.some(entry => entry.constraint === "place:no-open-route" && entry.expected.closedRef === HALL_YARD_DOOR));
  // The one in the yard opens it from its side; the hall's side opens with it.
  const opened = closeDoor(f, closed.state, PEER, YARD_HALL_DOOR, "open", "principal:probe-target");
  assert.deepEqual([featureOf(opened.state, HALL, HALL_YARD_DOOR).state, featureOf(opened.state, YARD, YARD_HALL_DOOR).state], ["open", "open"]);
  assert.equal(placeOf(placesReachableFrom(opened.state, ACTOR), YARD).open, true);
  const replayed = f.runtime.replay(f.genesis, [...closed.events, ...opened.events]);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(hashWorldState(replayed.state), hashWorldState(opened.state));
});

test("a location the KP creates joins the place map with its passage and can be gone to", () => {
  const f = house("kp-location", { [ACTOR]: HALL, [PEER]: HALL });
  const template = kind => ({ templateRef: VNEXT_SEMANTIC_TEMPLATES[kind].templateRef, templateHash: VNEXT_SEMANTIC_TEMPLATES[kind].templateHash });
  const common = { kind: "materializeObject", basisRefs: [HALL], outcomeBinding: "always", visibilityPolicyRef: "visibility:scene-observers" };
  const definition = { sceneRef: HALL, visibilityFactId: null, observableState: null, affordances: null, mechanicDefinitionRefs: [] };
  const geometry = structuredClone(f.state.combatRuntime.scenes[PROBE_SCENE].geometry);
  const create = { mode: "adjudication", basisRefs: [HALL], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "没有风险。", successOutcome: "发现了暗门后的小间。" },
    proposals: [
      { ...common, semanticKind: "location", ...template("location"), consumes: [],
        produces: [{ handle: "prospective:closet", kind: "semanticDefinition", outcomeBinding: "always" }],
        definition: { ...definition, label: "暗门后的小间", description: "一间堆着旧椅子的小储藏间。", geometry }, summary: "固化小间。" },
      { ...common, semanticKind: "passage", ...template("passage"),
        consumes: [{ kind: "existing", ref: HALL }, { kind: "prospective", handle: "prospective:closet" }],
        produces: [{ handle: "prospective:closet-door", kind: "semanticDefinition", outcomeBinding: "always" }],
        definition: { ...definition, label: "暗门", description: "墙板后有一扇暗门。", observableState: "open",
          passage: { fromLocationRef: HALL, toLocationRef: "prospective:closet", bidirectional: true, traversal: "推开暗门进去",
            travelDurationMicros: "6000000" } }, summary: "固化暗门。" },
    ] };
  const created = act(as(f, f.state, "create", ACTOR, "我推墙板，找暗门后的地方。"), create).committed;
  const materialized = created.events.filter(event => event.eventType === "SemanticDefinitionMaterialized").map(event => event.payload);
  const locationRef = materialized.find(entry => entry.semanticKind === "location").definitionRef;
  const passageRef = materialized.find(entry => entry.semanticKind === "passage").definitionRef;
  const sceneId = dynamicLocationSceneRef(locationRef);
  const connection = created.state.campaignRuntime.placeMap.connections.find(entry => entry.id === passageRef);
  assert.deepEqual(connection, { id: passageRef, source: "kp", bidirectional: true, travelMicros: "6000000", sides: [
    { sceneId: HALL, featureId: null, arrival: v4.storyBible.storyAnchors.locations.find(location => location.sceneId === HALL).tacticalGeometry.spawnPoints[0] },
    { sceneId, featureId: null, arrival: geometry.spawnPoints[0] }] });
  const listed = placeOf(placesReachableFrom(created.state, ACTOR), locationRef);
  assert.deepEqual(listed, { placeRef: locationRef, label: "暗门后的小间", viaFeatureRef: null, viaLabel: null, travelMicros: "6000000", open: true });
  const went = act(as(f, created.state, "enter", ACTOR, "我进暗门后的小间。"), goTo(HALL, locationRef)).committed;
  assert.equal(went.state.entities[ACTOR].sceneId, sceneId);
  assert.deepEqual(went.state.entities[ACTOR].visitedSceneIds, [sceneId, HALL].sort());
  assert.equal(clockOf(went.state, ACTOR) - clockOf(created.state, ACTOR), 6_000_000n);
  const replayed = f.runtime.replay(f.genesis, [...created.events, ...went.events]);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  assert.equal(hashWorldState(replayed.state), hashWorldState(went.state));
});
