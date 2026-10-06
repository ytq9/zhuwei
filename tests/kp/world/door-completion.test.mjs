import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE }
  from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../../app/_runtime/lib/rules/profiles/semantic-templates.ts";
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA, encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { parseSubmitKpProposalBundleCandidateArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { lowerVNext2ProposalBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { proposalCompletableObjectRefs, proposalUnofferedCapabilities } from "../../../app/_runtime/lib/kp/vnext/proposal-context.ts";
import { dynamicLocationSceneRef } from "../../../app/_runtime/lib/rules/v2/dynamic-locations.ts";
import { publicDamageableFeature } from "../../../app/_runtime/lib/rules/v2/environment.ts";
import { lockablePortalStateGraph } from "../../../app/_runtime/lib/rules/profiles/door-graph.ts";
import { committedActionRange, stepActionToDecision } from "../../support/fixtures/vnext-action-lifecycle.mjs";

// SPEC 0015 §11.1 (user ruling 2026-10-05): a door of a place the KP created
// has no state graph or durability on its map. The first act that uses it
// completes it -- its state as it already is, its AC and hit points -- and
// from then on it is the module's lockable door.

const DOOR = "feature:vault:iron-door";
const rectangle = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** The new place's map as the KP writes it: a locked iron door, no graph. */
function vaultGeometry(doorState = "locked") {
  const open = doorState === "open";
  return { schema: "zhuwei.tactical-geometry/v1", unit: "inch", boundary: { kind: "polygon", points: rectangle("0", "0", "480", "480") },
    spawnPoints: [{ x: "100", y: "100", elevation: "0" }, { x: "160", y: "100", elevation: "0" }],
    obstacles: [{ featureId: DOOR, kind: "portal", label: "铁门", state: doorState, polygon: rectangle("300", "200", "340", "208"), elevation: "0",
      height: "84", opaque: !open, impassable: !open, cover: open ? "none" : "full", propagation: open ? "passes" : "blocks",
      visibilityPolicyId: "visibility:scene-observers" }],
    clearanceZones: [] };
}

const template = kind => ({ templateRef: VNEXT_SEMANTIC_TEMPLATES[kind].templateRef, templateHash: VNEXT_SEMANTIC_TEMPLATES[kind].templateHash });
function created(kind, handle, definition, consumes = []) {
  return { kind: "materializeObject", basisRefs: [SOURCE], consumes, produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }],
    outcomeBinding: "always", semanticKind: kind, ...template(kind), visibilityPolicyRef: "visibility:scene-observers",
    definition: { sceneRef: SCENE, visibilityFactId: null, label: kind === "location" ? "地下库房" : "石阶", description: kind === "location"
      ? "石砌的库房，尽头是一扇铁门。" : "墙角有向下的石阶。", observableState: kind === "passage" ? "open" : null, affordances: null,
      mechanicDefinitionRefs: [], ...definition }, summary: "固化发现的库房与石阶。" };
}

const outcome = (code, summary) => ({ outcomeCode: `outcome:${code}`, summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
const direct = (successOutcome, durationMicros = "300000000") => ({ kind: "directSuccess", durationMicros, risk: "没有风险。", successOutcome });
const force = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: "athletics", dc: 15, mode: "normal",
  risk: "撞门声会传开。", successOutcome: "门被撞开了。", failureOutcome: "门纹丝不动。" };

function act(basisRef, adjudication, proposals) {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [basisRef], adjudication,
    terminal: null, proposals };
}
function doorStep(sceneRef, option, adjudication) {
  return { kind: "worldInteraction", basisRefs: [sceneRef], consumes: [], produces: [], outcomeBinding: "always", sceneRef,
    intent: option === "open" ? "把铁门撞开。" : "把铁门关上。", method: "用肩膀顶。", targetRefs: [], directTargetRefs: [], instrumentRefs: [],
    abilityRef: null, commonAction: { kind: "operateObject", targetRef: DOOR, destinationRef: null, option },
    branches: { success: outcome("door", "门动了。"), failure: adjudication.kind === "check" ? outcome("held", "门没动。") : null } };
}
function completion(observableState, mechanics, definitionRef = DOOR) {
  return { kind: "completeObject", definitionRef, description: "none", observableState,
    ...(mechanics === undefined ? {} : { mechanics: { opensPassage: true, ...mechanics } }), summary: "KP确定这扇门原本的状态与结实程度。",
    basisRefs: [], consumes: [], produces: [], outcomeBinding: "always" };
}

function lower(f, bundle) {
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle)));
  assert.equal(parsed.kind, "accepted", JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
}
function acted(f, bundle) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result.kind === "rejected" ? result.rejection : result.kind));
  return result;
}
function rolled(f, bundle, rolls) {
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const pending = stepActionToDecision(f.runtime, f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(pending.kind, "awaitingRandomness", JSON.stringify(pending.kind === "rejected" ? pending.rejection : pending.kind));
  const result = f.runtime.step(f.profiles, pending.state, { kind: "fulfillAuthoritativeRandomness",
    continuation: JSON.parse(JSON.stringify(pending.continuation)), rolls });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return { result, events: [...pending.events, ...result.events] };
}
/** The actor's next action from `state`, with its own frozen context. */
function next(f, state, suffix, ref = DOOR) {
  const rootActionId = `${f.rootActionId}:${suffix}`;
  return { ...f, state, rootActionId,
    requiredContext: freezeAuthoredProbeContext(f, state, { rootActionId, focusRefs: [ref], intentText: "把铁门打开。" }).context };
}

/** The KP creates the vault with its incomplete door and the stairs down;
 * the actor goes down. Returns the actor standing in the vault. */
function inVault(name, doorState) {
  const f = createAuthoredProbeFixture(`door-completion:${name}`);
  const built = acted(f, act(SOURCE, direct("发现了向下的石阶。", "0"), [
    created("location", "prospective:vault", { geometry: vaultGeometry(doorState) }),
    created("passage", "prospective:stairs", { passage: { fromLocationRef: SCENE, toLocationRef: "prospective:vault", bidirectional: true,
      traversal: "沿石阶走下去", travelDurationMicros: "60000000" } }, [{ kind: "prospective", handle: "prospective:vault" }])]));
  const location = built.events.filter(event => event.eventType === "SemanticDefinitionMaterialized")
    .map(event => event.payload).find(payload => payload.semanticKind === "location").definitionRef;
  const vault = dynamicLocationSceneRef(location);
  const going = next(f, built.state, "go");
  const went = acted(going, act(SCENE, direct("走下石阶。", "0"), [{ kind: "worldInteraction", basisRefs: [SCENE], consumes: [], produces: [],
    outcomeBinding: "always", sceneRef: SCENE, intent: "走下石阶。", method: "步行。", targetRefs: [], directTargetRefs: [], instrumentRefs: [],
    abilityRef: null, commonAction: { kind: "goTo", targetRef: location, destinationRef: null, option: "none" },
    branches: { success: outcome("went", "走下了石阶。"), failure: null } }]));
  assert.equal(went.state.entities[ACTOR].sceneId, vault);
  return { f, vault, state: went.state, events: [...built.events, ...went.events] };
}

const doorIn = (state, sceneId) => state.combatRuntime.scenes[sceneId].geometry.obstacles.find(entry => entry.featureId === DOOR);
const doorEvents = events => events.filter(event => event.eventType === "EnvironmentFeatureCompleted" || event.eventType === "EnvironmentFeatureStateChanged")
  .map(event => event.eventType === "EnvironmentFeatureCompleted" ? ["completed", event.payload.state]
    : ["changed", event.payload.intent, event.payload.fromState, event.payload.toState]);

test("a new place's incomplete door: the door script alone is sent back to complete it, and completeObject is offered for it", () => {
  const { f, vault, state } = inVault("alone");
  assert.equal(doorIn(state, vault).stateGraph, undefined);
  const here = next(f, state, "open-alone");
  assert.ok(proposalCompletableObjectRefs(here.requiredContext).includes(DOOR), JSON.stringify(proposalCompletableObjectRefs(here.requiredContext)));
  assert.ok(!proposalUnofferedCapabilities(here.requiredContext).includes("completeObject"));
  const alone = lower(here, act(vault, force, [doorStep(vault, "open", force)]));
  assert.equal(alone.kind, "rejected", JSON.stringify(alone));
  assert.deepEqual(alone.diagnostics.map(entry => [entry.constraint, entry.repair?.allowed]), [["commonAction:object-incomplete", true]]);
  assert.match(alone.diagnostics[0].expected.requirement, /completeObject/);
});

test("completeObject (locked, AC 15, HP 18) with the door script in one act: a won force check completes and unlocks it, a lost one only completes it", () => {
  const { f, vault, state, events } = inVault("force");
  const here = next(f, state, "force");
  const forced = act(vault, force, [completion("locked", { armorClass: 15, hitPoints: 18 }), doorStep(vault, "open", force)]);
  const won = rolled(here, forced, [18]);
  assert.deepEqual(doorEvents(won.events), [["completed", "locked"], ["changed", "unlock", "locked", "closed"], ["changed", "open", "closed", "open"]]);
  const door = doorIn(won.result.state, vault);
  assert.equal(door.state, "open");
  assert.equal(door.impassable, false);
  const replay = f.runtime.replay(f.genesis, [...events, ...won.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, won.result.state);
  // The narration is told how the door was, and that the actor opened it.
  const view = f.runtime.project(f.profiles, won.result.state, f.viewer, { channel: "realtime", committedRange: committedActionRange(won.result.state, {
    receiptId: won.result.receipt.receiptId, actorCharacterId: ACTOR, priorState: state, events: won.events }) });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.deepEqual(view.renderableClaims.claims.filter(claim => /^object/.test(claim.outcomeCode ?? ""))
    .map(claim => [claim.outcomeCode, claim.targetRefs, claim.summary]),
    [["objectMechanicsEstablished", [DOOR], "这个物件原本锁着。"], ["objectUnlocked", [DOOR], "该角色解除了这个物件的锁定。"], ["objectOpened", [DOOR], "该角色打开了这个物件。"]]);

  const lost = rolled(here, forced, [3]);
  assert.deepEqual(doorEvents(lost.events), [["completed", "locked"]]);
  const held = doorIn(lost.result.state, vault);
  assert.equal(held.state, "locked");
  assert.equal(held.impassable, true);
  assert.equal(held.stateGraph.definitionId, `environment-definition:${DOOR}:open-closed-locked-destroyed-v2`);
  const lostReplay = f.runtime.replay(f.genesis, [...events, ...lost.events]);
  assert.equal(lostReplay.kind, "replayed", JSON.stringify(lostReplay));
  assert.deepEqual(lostReplay.state, lost.result.state);
});

test("a completed door is a module door with the KP's AC and hit points: it closes later, is damageable like one, and a correction undoes the completion", () => {
  const { f, vault, state, events } = inVault("later", "closed");
  const here = next(f, state, "open");
  const opened = acted(here, act(vault, direct("门开了。"), [completion("closed", { armorClass: 12, hitPoints: 10 }),
    doorStep(vault, "open", direct("门开了。"))]));
  assert.deepEqual(doorEvents(opened.events), [["completed", "closed"], ["changed", "open", "closed", "open"]]);
  const door = doorIn(opened.state, vault);
  const lockable = lockablePortalStateGraph(DOOR);
  assert.deepEqual(door.stateGraph, { ...lockable, durability: { ...lockable.durability, maximum: "10", armorClass: "12" } });
  assert.deepEqual(door.durability, { current: "10", maximum: "10", armorClass: "12", damageThreshold: "0", immuneDamageTypes: ["poison", "psychic"] });
  assert.equal(publicDamageableFeature(opened.state, ACTOR, DOOR)?.featureId, DOOR);

  const later = next(f, opened.state, "close");
  const shut = acted(later, act(vault, direct("门关上了。"), [doorStep(vault, "close", direct("门关上了。"))]));
  assert.deepEqual(doorEvents(shut.events), [["changed", "close", "open", "closed"]]);
  const replay = f.runtime.replay(f.genesis, [...events, ...opened.events, ...shut.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, shut.state);

  // SPEC 0011 §7: correcting the act that completed it leaves the door as the map had it.
  const history = [...events, ...opened.events];
  const prior = f.runtime.replay(f.genesis, history, { retainCorrectionAudit: true });
  assert.equal(prior.kind, "replayed", JSON.stringify(prior));
  const corrected = f.runtime.step(f.profiles, prior.state, { kind: "applyServiceCorrection", correctionAuthority: {
    kind: "roomCorrectionAuthority", capability: prior.state.correctionRuntime.authorityCapability },
    correctionId: "correction:door-completion", targetReceiptId: opened.receipt.receiptId, actorCharacterId: ACTOR, errorKind: "rulesMisapplication",
    publicExplanation: "该次裁决有误，恢复裁决前状态。", basis: { eventSeq: prior.head.eventSeq, lastEventId: prior.head.lastEventId } });
  assert.equal(corrected.kind, "committed", JSON.stringify(corrected));
  assert.deepEqual(doorIn(corrected.state, vault), doorIn(state, vault));
  const correctedReplay = f.runtime.replay(f.genesis, [...history, ...corrected.events]);
  assert.equal(correctedReplay.kind, "replayed", JSON.stringify(correctedReplay));
  assert.deepEqual(correctedReplay.state, corrected.state);
});

test("completing a door again, in a state it cannot have, or giving mechanics to a non-door goes back to the KP to revise", () => {
  const { f, vault, state } = inVault("refused");
  const here = next(f, state, "ajar");
  const ajar = lower(here, act(vault, force, [completion("ajar", { armorClass: 15, hitPoints: 18 }), doorStep(vault, "open", force)]));
  assert.equal(ajar.kind, "rejected", JSON.stringify(ajar));
  assert.deepEqual(ajar.diagnostics.map(entry => [entry.constraint, entry.repair?.allowed]), [["object:initial-state-invalid", true]]);
  const bare = lower(here, act(vault, force, [completion("locked"), doorStep(vault, "open", force)]));
  assert.equal(bare.kind, "rejected", JSON.stringify(bare));
  assert.deepEqual(bare.diagnostics.map(entry => entry.constraint), ["object:state-and-mechanics-required"]);

  const done = acted(here, act(vault, direct("KP确定了门。", "0"), [completion("locked", { armorClass: 15, hitPoints: 18 })]));
  assert.deepEqual(doorEvents(done.events), [["completed", "locked"]]);
  const again = next(f, done.state, "again");
  assert.ok(!proposalCompletableObjectRefs(again.requiredContext).includes(DOOR));
  const twice = lower(again, act(vault, force, [completion("closed", { armorClass: 10, hitPoints: 5 }), doorStep(vault, "open", force)]));
  assert.equal(twice.kind, "rejected", JSON.stringify(twice));
  assert.deepEqual(twice.diagnostics.map(entry => [entry.constraint, entry.repair?.allowed, entry.expected?.initialState]),
    [["object:already-complete", true, ["open", "closed", "locked"]]]);

  const g = createAuthoredProbeFixture("door-completion:not-a-door");
  const valve = lower(g, act(SOURCE, direct("看清了阀门。", "0"), [completion("ready", { armorClass: 15, hitPoints: 18 }, SOURCE)]));
  assert.equal(valve.kind, "rejected", JSON.stringify(valve));
  assert.deepEqual(valve.diagnostics.map(entry => entry.constraint), ["object:unavailable"]);
});

// SPEC 0014 §2.3: object identity and kind do not choose state transitions.
test("a map chest uses the same completion and operations; unlocking leaves it closed and opening keeps its spatial footprint", () => {
  const ref = "feature:brass-chest";
  const f = createAuthoredProbeFixture("generic-chest", { featureOverrides: {
    featureId: ref, kind: "destructible", label: "铜箱", state: "locked", opaque: true, impassable: true, cover: "half", propagation: "blocks",
  } });
  const feature = state => state.combatRuntime.scenes[SCENE].geometry.obstacles.find(value => value.featureId === ref);
  const operation = option => ({ ...doorStep(SCENE, option, direct("操作完成。")), intent: "操作铜箱的锁和箱盖。", method: "用钥匙和把手。",
    commonAction: { kind: "operateObject", targetRef: ref, destinationRef: null, option } });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [ref] }).context;
  const completed = acted(f, act(SCENE, direct("锁已解除，箱盖仍关闭。"), [
    completion("locked", { opensPassage: false, armorClass: 15, hitPoints: 18 }, ref), operation("unlock"),
  ]));
  assert.equal(feature(completed.state).state, "closed");
  assert.deepEqual(doorEvents(completed.events), [["completed", "locked"], ["changed", "unlock", "locked", "closed"]]);
  const beforeGeometry = feature(f.state);
  let state = completed.state;
  const events = [...completed.events];
  for (const [option, expected] of [["open", "open"], ["close", "closed"], ["lock", "locked"]]) {
    const result = acted(next(f, state, option, ref), act(SCENE, direct("操作完成。"), [operation(option)]));
    assert.equal(feature(result.state).state, expected);
    for (const key of ["polygon", "height", "opaque", "impassable", "cover", "propagation"]) {
      assert.deepEqual(feature(result.state)[key], beforeGeometry[key], key);
    }
    events.push(...result.events); state = result.state;
  }
  assert.deepEqual(state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem, "opening never creates or acquires contents");
  const replay = f.runtime.replay(f.genesis, events);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, state);
});

test("an initially open passage can be completed and closed; completion cannot overwrite its established open state", () => {
  const { f, vault, state, events } = inVault("initially-open", "open");
  const here = next(f, state, "close");
  const rejected = lower(here, act(vault, direct("确定现状。", "0"), [completion("locked", { armorClass: 12, hitPoints: 10 })]));
  assert.equal(rejected.kind, "rejected");
  assert.deepEqual(rejected.issues, ["object-completion:state-or-mechanics-invalid"]);
  const closed = acted(here, act(vault, direct("门关上了。"), [completion("open", { armorClass: 12, hitPoints: 10 }),
    doorStep(vault, "close", direct("门关上了。"))]));
  assert.equal(doorIn(closed.state, vault).state, "closed");
  assert.equal(doorIn(closed.state, vault).impassable, true);
  assert.equal(doorIn(closed.state, vault).opaque, true);
  const replay = f.runtime.replay(f.genesis, [...events, ...closed.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, closed.state);
});

test("operations follow a non-portal object's authored states, reject hidden references and freeze the exact prior graph", () => {
  const ref = "feature:folding-grille";
  const names = { closed: "latched", destroyed: "broken", locked: "secured", open: "unfolded" };
  const graph = lockablePortalStateGraph(ref);
  graph.definitionId = "environment-definition:grille:custom-states-v1";
  graph.states = graph.states.map(state => ({ ...state, state: names[state.state] })).sort((a, b) => a.state.localeCompare(b.state));
  graph.transitions = graph.transitions.map(t => ({ ...t, fromState: names[t.fromState], toState: names[t.toState] }))
    .sort((a, b) => a.fromState.localeCompare(b.fromState) || a.intent.localeCompare(b.intent));
  graph.damageTransitions = graph.damageTransitions.map(t => ({ ...t, fromState: names[t.fromState], toState: names[t.toState] }))
    .sort((a, b) => a.fromState.localeCompare(b.fromState));
  const f = createAuthoredProbeFixture("custom-grille", { featureOverrides: { featureId: ref, kind: "barrier", label: "折叠格栅",
    state: "secured", opaque: true, impassable: true, cover: "full", propagation: "blocks", stateGraph: graph,
    durability: { current: "4", ...graph.durability } } });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [ref] }).context;
  const operation = { ...doorStep(SCENE, "unlock", direct("解锁。")), commonAction: { kind: "operateObject", targetRef: ref, destinationRef: null, option: "unlock" } };
  const bundle = act(SCENE, direct("解锁。"), [operation]);
  const lowered = lower(f, bundle);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const unlocked = acted(f, bundle);
  assert.deepEqual(doorEvents(unlocked.events), [["changed", "unlock", "secured", "latched"]]);
  assert.equal(publicDamageableFeature(unlocked.state, ACTOR, ref)?.featureId, ref);
  const altered = structuredClone(f.state);
  altered.combatRuntime.scenes[SCENE].geometry.obstacles[0].stateGraph.definitionId += ":revised";
  const stale = stepActionToDecision(f.runtime, f.profiles, altered, lowered.command.rulesInput);
  assert.equal(stale.kind, "rejected", JSON.stringify(stale));
  assert.equal(stale.rejection.code, "causalFrontierConflict");
  assert.deepEqual(stale.events, []);
  const hidden = structuredClone(f.state);
  hidden.combatRuntime.scenes[SCENE].geometry.obstacles[0].visibilityPolicyId = "visibility:hidden-until-evidence";
  const unseen = next(f, hidden, "hidden", ref);
  assert.equal(lower(unseen, bundle).kind, "rejected");
});

test("a completed object stays bound to its original scene when the actor leaves later in the same action", () => {
  const { f, vault, state, events } = inVault("complete-and-leave");
  const here = next(f, state, "leave");
  const travel = { ...doorStep(vault, "open", direct("回到楼上。", "0")),
    commonAction: { kind: "goTo", targetRef: SCENE, destinationRef: null, option: "none" }, intent: "回到楼上。", method: "沿石阶回去。" };
  const left = acted(here, act(vault, direct("回到楼上。", "0"), [completion("locked", { armorClass: 15, hitPoints: 18 }), travel]));
  assert.equal(left.state.entities[ACTOR].sceneId, SCENE);
  assert.equal(doorIn(left.state, vault).state, "locked");
  const replay = f.runtime.replay(f.genesis, [...events, ...left.events]);
  assert.equal(replay.kind, "replayed", JSON.stringify(replay));
  assert.deepEqual(replay.state, left.state);
});
