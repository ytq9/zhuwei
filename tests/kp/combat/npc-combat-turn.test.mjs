import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR, PROBE_SOURCE, PROBE_TARGET } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";
import { npcCombatTurnOptions, npcCombatTurnPlanIssues } from "../../../app/_runtime/lib/rules/authority-read.ts";
import { createAuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative.ts";
import { NPC_COMBAT_TURN_TOOL_NAME, npcCombatTurnModelInput, validateNpcCombatTurnOutput } from "../../../app/_runtime/lib/kp/npc-combat-turn.ts";

// SPEC 0006 §§6、7, SPEC 0012 §6.3 (ADR 0097 decision 4): the options Rules
// lists for the NPC whose combat turn it is, the one model call that turns
// them into a plan, and the checks on that plan. The NPC sees only what its
// own projection shows: a creature hiding from it is offered only as a point
// to aim at.

const GUARD = "npc:probe:guard";
const KNIFE = "ability:probe:guard-knife";
const ENCOUNTER = "encounter:probe-npc-turn";

function encounterFixture(name, { hideActor = false } = {}) {
  const f = createAuthoredProbeFixture(name, { npcCharacters: [{ id: GUARD, name: "守卫", mechanical: false }] });
  const guard = f.state.combatRuntime.entities[GUARD];
  let result = f.runtime.step(f.profiles, f.state, { kind: "startEncounter", rootActionId: `root:${name}:encounter`,
    proposalAttemptId: `proposal:${name}:encounter`, encounterId: ENCOUNTER, sceneId: guard.sceneId,
    participantEntityIds: [PROBE_ACTOR, PROBE_TARGET], battlefieldFactIds: [],
    dynamicEntities: [{ entityId: GUARD, name: "守卫", placement: { position: structuredClone(guard.position) },
      mechanics: { kind: "bespokeDefinition", definition: {
        definitionId: `npc-template:${name}:guard`, revision: "1", definitionKind: "npcMechanicalTemplate",
        rulesBasis: "srd5.1-2014", causalBasisRefs: [PROBE_SOURCE], visibilityPolicyRef: "visibility:scene-observers",
        content: { schema: "zhuwei.npc-mechanical-template/v1", label: "守卫", footprint: structuredClone(guard.footprint),
          stats: { str: "12", dex: "12", con: "10", int: "10", wis: "10", cha: "10" }, proficiencyBonus: "2",
          armorClass: "12", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "12", shieldBonus: "0" },
          hitPointsMaximum: "11", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: "deadAtZero",
          // ADR 0102: the KP writes a stat-block attack's label as its mechanical key.
          intrinsicAbilities: [{ definitionId: KNIFE, revision: "1", rulesBasis: "srd5.1-2014", mechanicalKey: "匕首",
            activation: { kind: "attack", actionGrant: "attack" }, target: { kind: "creature", count: "1", reachInches: "60" },
            attack: { ability: "dex", proficiency: true }, damage: [{ type: "piercing", formula: "1d4+1" }] }],
          itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
    initiativeGroups: [GUARD, PROBE_ACTOR, PROBE_TARGET].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [GUARD], toEntityIds: [PROBE_ACTOR, PROBE_TARGET] },
      { fromEntityIds: [PROBE_ACTOR, PROBE_TARGET], toEntityIds: [GUARD] }] });
  let draw = 0;
  while (result.kind === "awaitingRandomness") {
    const waiting = result;
    result = f.runtime.step(f.profiles, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
      responseId: `authority:${name}:${draw}`, continuationCapability: waiting.continuationCapability,
      randomnessResults: waiting.randomnessRequests.map(request => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
        draws: request.dice.map(term => ({ sides: Number(term.sides),
          faces: Array.from({ length: Number(term.count) }, () => { draw += 1; return draw === 1 ? 20 : draw === 2 ? 10 : 2; }) })) })) });
  }
  assert.equal(result.kind, "committed", JSON.stringify(result).slice(0, 1500));
  let state = result.state;
  assert.equal(state.combatRuntime.encounters[ENCOUNTER].activeEntityId, GUARD);
  if (hideActor) {
    const conditions = { ...(state.combatRuntime.entities[PROBE_ACTOR].conditions ?? {}), hidden: { stealthTotal: "40" } };
    state = createEventTransition(state, f.profiles, { rootActionId: `root:${name}:hide`, eventType: "ConditionChanged",
      payload: { entityId: PROBE_ACTOR, conditions }, visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" }).state;
  }
  const projection = f.runtime.project(f.profiles, state, { kind: "npc", npcId: GUARD, purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge" });
  assert.equal(projection.kind, "projected");
  const options = npcCombatTurnOptions(f.profiles, state, GUARD);
  assert.ok(options);
  return { f, state, options, request: { preparedActionId: "npc-turn:probe", rootActionId: "npc-turn:probe", options, projection } };
}

test("the guard's options list what it may do now from its own view, and the model is asked for the whole turn", () => {
  const { options, request } = encounterFixture("npc-turn-options-open");
  assert.equal(options.npcRef, GUARD);
  assert.deepEqual(options.turn, { action: 1, bonusAction: 1, reaction: 1, attacksRemaining: 0, attacksPerAttackAction: 1 });
  assert.equal(options.movement.canMove, true);
  assert.equal(options.movement.remainingFeet, 30);
  assert.deepEqual(options.movement.destinations.filter(entry => entry.kind === "creature").map(entry => entry.ref).sort(), [PROBE_ACTOR, PROBE_TARGET]);
  const knife = options.abilities.find(entry => entry.abilityRef === KNIFE);
  assert.deepEqual(knife.targets.map(entry => [entry.ref, entry.inReachNow]), [[PROBE_ACTOR, true], [PROBE_TARGET, false]]);
  assert.equal(knife.aimAtPointAllowed, false);
  // ADR 0113: the guard knows its own attack by name and how far it reaches.
  assert.deepEqual([knife.name, knife.reachFeet, knife.rangeFeet], ["匕首", 5, undefined]);
  // SPEC 0012 §6.3: these now wait for the defending player's private skill choice.
  assert.deepEqual(options.abilities.map(entry => entry.abilityRef), [KNIFE, "action:grapple", "action:shove", "action:shove-away"]);
  assert.deepEqual(options.basicActions, ["dash", "dodge", "disengage", "hide", "search"]);
  assert.equal(options.help, null);
  assert.deepEqual(options.ready?.triggerRefs.sort(), [PROBE_ACTOR, PROBE_TARGET]);

  const input = npcCombatTurnModelInput(request);
  assert.equal(input.tools.length, 1);
  assert.equal(input.tools[0].function.name, NPC_COMBAT_TURN_TOOL_NAME);
  assert.equal(input.tool_choice, "required");
  const user = JSON.parse(input.messages[1].content);
  assert.equal(user.npcViewer.viewer.subjectId, GUARD);
  assert.deepEqual(user.options, options);
  assert.match(input.messages[0].content, /只扮演这一个 NPC/u);
  // The schema names only what the options offer; no tactic is prescribed.
  const schema = JSON.stringify(input.tools[0].function.parameters);
  assert.ok(schema.includes(KNIFE) && schema.includes(PROBE_TARGET));
});

test("a creature hiding from the guard is never named to it; its attack may only be aimed at a point", () => {
  const { options, request } = encounterFixture("npc-turn-options-hidden", { hideActor: true });
  const knife = options.abilities.find(entry => entry.abilityRef === KNIFE);
  assert.deepEqual(knife.targets.map(entry => entry.ref), [PROBE_TARGET]);
  assert.equal(knife.aimAtPointAllowed, true);
  assert.ok(!options.movement.destinations.some(entry => entry.ref === PROBE_ACTOR));
  assert.ok(!options.ready.triggerRefs.includes(PROBE_ACTOR));
  // Nothing the guard is sent names the hider or where it stands.
  assert.ok(!JSON.stringify(options).includes(PROBE_ACTOR));
  const input = npcCombatTurnModelInput(request);
  const sent = JSON.stringify(input);
  const user = JSON.parse(input.messages[1].content);
  assert.ok(!JSON.stringify(user.npcViewer.tacticalProjection).includes(PROBE_ACTOR));
  assert.ok(!JSON.stringify(input.tools).includes(PROBE_ACTOR));
  assert.ok(!sent.includes('"x":"100","y":"100"') && !sent.includes('{"elevation":"0","x":"100","y":"100"}'));
  // A guessed point is a legal target; the hider by name is not.
  const aimed = [{ kind: "ability", abilityRef: KNIFE, target: { kind: "point", x: "100", y: "100" } }, { kind: "endTurn" }];
  assert.deepEqual(npcCombatTurnPlanIssues(options, aimed), []);
  assert.deepEqual(validateNpcCombatTurnOutput({ steps: aimed }, request), { kind: "npcCombatTurnDecision", steps: aimed });
  const named = [{ kind: "ability", abilityRef: KNIFE, target: { kind: "creature", ref: PROBE_ACTOR } }, { kind: "endTurn" }];
  assert.deepEqual(npcCombatTurnPlanIssues(options, named), ["steps[0]:ability:target-unavailable"]);
  assert.throws(() => validateNpcCombatTurnOutput({ steps: named }, request));
});

test("plans that leave the options, spend what the guard lacks or do not end the turn are rejected", async () => {
  const { options, request } = encounterFixture("npc-turn-options-invalid");
  const end = { kind: "endTurn" };
  const strike = { kind: "ability", abilityRef: KNIFE, target: { kind: "creature", ref: PROBE_ACTOR } };
  const valid = [{ kind: "move", to: { kind: "nextTo", ref: PROBE_TARGET } }, strike, end];
  assert.deepEqual(validateNpcCombatTurnOutput({ steps: valid }, request).steps, valid);
  for (const [label, value] of [
    ["no end of turn", { steps: [strike] }],
    ["a step after the end", { steps: [end, strike] }],
    ["two attacks with one", { steps: [strike, strike, end] }],
    ["an unknown ability", { steps: [{ kind: "ability", abilityRef: "ability:unknown", target: { kind: "none" } }, end] }],
    ["an unknown destination", { steps: [{ kind: "move", to: { kind: "nextTo", ref: "npc:nobody" } }, end] }],
    ["help with no ally to help", { steps: [{ kind: "basic", action: "help", allyRef: PROBE_TARGET, enemyRef: null }, end] }],
    ["an extra field", { steps: [end], note: "x" }],
    ["a dodge and a strike on one action", { steps: [{ kind: "basic", action: "dodge" }, strike, end] }],
  ]) assert.throws(() => validateNpcCombatTurnOutput(value, request), undefined, label);
  // The adapter turns such a reply into a failed decision, never a plan.
  const reply = (steps) => ({ choices: [{ message: { tool_calls: [{ type: "function",
    function: { name: NPC_COMBAT_TURN_TOOL_NAME, arguments: JSON.stringify({ steps }) } }] } }] });
  const adapter = (steps) => createAuthoritativeKpAdapter({ ai: { async run() { return reply(steps); } } });
  assert.deepEqual(await adapter(valid).decideNpcCombatTurn(request), { kind: "npcCombatTurnDecision", steps: valid });
  await assert.rejects(adapter([strike, strike, end]).decideNpcCombatTurn(request), error => error.publicCode === "NPC_COMBAT_TURN_DECISION_INVALID");
  // A request whose projection is not this NPC's own view is never sent.
  assert.throws(() => npcCombatTurnModelInput({ ...request, projection: { ...request.projection, viewer: { kind: "kp", subjectId: "kp" } } }));
  assert.ok(options.endTurn);
});
