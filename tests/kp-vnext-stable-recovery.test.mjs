import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, PROBE_ACTOR as PC, PROBE_TARGET as OBSERVER,
  PROBE_SCENE as SCENE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { deriveAuthorityClaimsFromCommittedRange, frozenRenderableClaimsConform,
  projectRenderableClaims } from "../app/_runtime/lib/rules/v2/claims.ts";
import { buildFrozenNarrationMaterial, reuseFrozenNarrationMaterialForRetry } from "../app/_runtime/lib/kp/vnext/narration.ts";

const NPC = "npc:stable:patient", MEDIC = "npc:stable:medic", SOURCE = "npc:stable:source";
const HOUR = 3_600_000_000n;
const INJURE = "ability:stable:injure", HARM = "ability:stable:harm", HEAL = "ability:stable:heal";

function npc(id, position, abilities = []) {
  return { entityId: id, name: id === NPC ? "伤员" : id === MEDIC ? "医师" : "术士", placement: { position },
    initialState: { hitPointsCurrent: "10" }, mechanics: { kind: "bespokeDefinition", definition: {
      definitionId: `template:${id}`, revision: "1", definitionKind: "npcMechanicalTemplate", rulesBasis: "srd5.1-2014",
      causalBasisRefs: [], visibilityPolicyRef: "visibility:scene-observers", content: {
        schema: "zhuwei.npc-mechanical-template/v1", label: "恢复测试角色",
        stats: { str: "10", dex: "10", con: "10", int: "10", wis: "10", cha: "10" }, proficiencyBonus: "2",
        armorClass: "10", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "10", shieldBonus: "0" },
        hitPointsMaximum: "20", footprint: { width: "60", depth: "60", height: "60" }, speedInches: { walk: "360" },
        resourceMaximums: {}, deathPolicy: "deathSaves", intrinsicAbilities: abilities,
        itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] },
      } } } };
}
function ability(id, activation, effect) {
  return { definitionId: id, revision: "1", rulesBasis: "srd5.1-2014", activation: { kind: activation },
    target: { kind: "creature", count: "1", rangeNormalInches: "1200", rangeLongInches: "1200", requiresSight: true }, ...effect };
}
function append(fixture, result) {
  assert.notEqual(result.kind, "rejected", JSON.stringify(result));
  fixture.state = result.state;
  fixture.events.push(...result.events);
  return result;
}
function drive(fixture, input) {
  const priorState = fixture.state;
  const eventOffset = fixture.events.length;
  let result = append(fixture, fixture.runtime.step(fixture.profiles, fixture.state, input));
  while (result.kind === "awaitingRandomness") {
    // Only this test Authority adapter supplies faces, after inspecting the
    // actual frozen request. Rules input never supplies a stable duration.
    const randomnessResults = result.randomnessRequests.map(request => {
      fixture.requests.push(structuredClone(request));
      const value = request.purposeKey.startsWith("initiative:")
        ? 20 - fixture.initiativeIndex++ * 3
        : request.purposeKey.startsWith("stable-recovery:") ? 3
        : request.purposeKey.startsWith("check:medicine:") ? 15
        : request.purposeKey.startsWith("attack:") ? 15
        : request.purposeKey === `damage:${INJURE}` ? 4
        : request.purposeKey === `damage:${HARM}` ? 1 : 2;
      return { randomnessId: request.randomnessId, requestHash: request.requestHash,
        draws: request.dice.map(term => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(value) })) };
    });
    result = append(fixture, fixture.runtime.step(fixture.profiles, fixture.state, {
      kind: "authoritativeRandomness", resolutionId: result.resolutionId,
      responseId: `response:stable:${++fixture.counter}`, continuationCapability: result.continuationCapability, randomnessResults,
    }));
  }
  return { ...result, receipt: result.receipt === undefined ? undefined : {
    ...result.receipt, eventRange: fixture.state.receipts[result.receipt.rootActionId].eventRange,
  }, priorState, events: fixture.events.slice(eventOffset) };
}
function scenario(id) {
  const fixture = { ...createAuthoredProbeFixture(id), events: [], requests: [], counter: 0, initiativeIndex: 0 };
  const encounterId = `encounter:${id}`;
  const dynamic = [npc(MEDIC, { x: "100", y: "160", elevation: "0" }),
    npc(NPC, { x: "160", y: "160", elevation: "0" }),
    npc(SOURCE, { x: "400", y: "100", elevation: "0" }, [
      ability(INJURE, "action", { attack: { ability: "wis", proficiency: true }, damage: [{ type: "force", formula: "1d4+6" }] }),
      ability(HARM, "bonusAction", { attack: { ability: "wis", proficiency: true }, damage: [{ type: "force", formula: "1d4" }] }),
      ability(HEAL, "bonusAction", { healing: { formula: "1d4+2" } }),
    ])];
  const participants = [PC, OBSERVER, MEDIC, NPC, SOURCE];
  const opened = drive(fixture, { kind: "startEncounter", rootActionId: `root:${id}:setup`, proposalAttemptId: `proposal:${id}:setup`,
    encounterId, sceneId: SCENE, participantEntityIds: [PC, OBSERVER], dynamicEntities: dynamic, battlefieldFactIds: [],
    initiativeGroups: participants.map(entityId => ({ entryId: `initiative:${entityId}`, combatantEntityIds: [entityId] })),
    hostilities: [{ fromEntityIds: [PC, OBSERVER], toEntityIds: [SOURCE] }, { fromEntityIds: [SOURCE], toEntityIds: [PC, OBSERVER] }],
  });
  assert.equal(opened.kind, "committed", JSON.stringify(opened));
  // Give every participant its actual first turn before ending the setup
  // encounter; later Medicine must consume a Rules-issued action grant.
  for (let index = 1; index < participants.length; index += 1) {
    const encounter = fixture.state.combatRuntime.encounters[encounterId];
    drive(fixture, { kind: "endTurn", rootActionId: `root:${id}:turn:${index}`,
      sourceEntityId: encounter.activeEntityId, encounterId });
  }
  let conclusion = drive(fixture, { kind: "proposeEncounterConclusion", rootActionId: `root:${id}:peace`, encounterId,
    proposal: { reason: "hostilitiesEnded" } });
  while (conclusion.kind === "awaitingInput") conclusion = drive(fixture, { kind: "answerPendingInput",
    pendingInputId: conclusion.pending.pendingInputId, responseId: `response:peace:${++fixture.counter}`,
    answer: { kind: "acceptEncounterConclusion" } });
  assert.equal(conclusion.kind, "committed");
  return fixture;
}
function invoke(fixture, abilityRef, target, source = SOURCE) {
  return drive(fixture, { kind: "invokeAbility", rootActionId: `root:stable:ability:${++fixture.counter}`,
    sourceEntityId: source, abilityRef, parameters: { targetEntityId: target } });
}
function replay(fixture) {
  const rebuilt = fixture.runtime.replay(fixture.genesis, fixture.events);
  assert.equal(rebuilt.kind, "replayed", JSON.stringify(rebuilt));
  assert.deepEqual(rebuilt.state, fixture.state);
  return rebuilt;
}
function stabilize(fixture, patient) {
  invoke(fixture, INJURE, patient);
  assert.equal(fixture.state.combatRuntime.entities[patient].hitPoints.current, "0");
  const result = invoke(fixture, "action:stabilize", patient, MEDIC);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const medicine = fixture.requests.find(request => request.purposeKey === `check:medicine:${MEDIC}`);
  assert.equal(medicine.frozenParameters.dc, 10);
  const recovery = fixture.requests.filter(request => request.purposeKey === `stable-recovery:${patient}`);
  assert.equal(recovery.length, 1);
  assert.deepEqual(recovery[0].dice, [{ count: "1", sides: "4" }]);
  assert.deepEqual(recovery[0].frozenParameters, { targetEntityId: patient, recoveryHitPoints: 1, hourMicros: HOUR.toString() });
  const activity = Object.values(fixture.state.campaignRuntime.activities).find(entry =>
    entry.activityKind === "stableRecovery2014" && entry.characterId === patient);
  assert.ok(activity);
  assert.equal(activity.intendedDurationMicros, (3n * HOUR).toString());
  assert.equal(fixture.state.combatRuntime.entities[patient].conditions.stable, true);
  replay(fixture);
  return activity;
}
function completionInput(activity) {
  const instant = BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros);
  return { kind: "completeActivity", proposalId: `activity-due:${activity.activityId}:${instant}`, activityId: activity.activityId };
}
function elapse(fixture, activity) {
  const instant = BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros);
  const now = BigInt(fixture.state.fictionTimelines[fixture.state.activeBranchId].nowMicros);
  return drive(fixture, { kind: "resolveFreeAction", proposalId: `root:stable:wait:${++fixture.counter}`, characterId: OBSERVER,
    goal: "等待自然恢复", method: "在原地照看", feasibility: { kind: "directSuccess", publicBasis: "没有新的中断。" },
    outcome: { publicResult: "等待结束。", fictionTimeCostMicros: (instant - now + HOUR).toString() } });
}
function projected(fixture, result, patient) {
  const value = fixture.runtime.project(fixture.profiles, fixture.state, fixture.viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: patient, priorState: result.priorState, events: result.events,
  } });
  assert.equal(value.kind, "projected", JSON.stringify(value));
  assert.equal(frozenRenderableClaimsConform(value.renderableClaims), true);
  return value.renderableClaims;
}
function authorityClaims(fixture, result, actorCharacterId) {
  const eventStates = new Map();
  let priorState = result.priorState;
  const offset = fixture.events.length - result.events.length;
  for (const [index, event] of result.events.entries()) {
    const after = fixture.runtime.replay(fixture.genesis, fixture.events.slice(0, offset + index + 1));
    assert.equal(after.kind, "replayed", JSON.stringify(after));
    eventStates.set(event.eventId, { priorState, state: after.state });
    priorState = after.state;
  }
  return deriveAuthorityClaimsFromCommittedRange({ receipt: result.receipt, actorCharacterId,
    priorState: result.priorState, state: fixture.state, events: result.events, eventStates });
}
for (const patient of [PC, NPC]) test(`Medicine freezes one 1d4 recovery for ${patient === PC ? "PC" : "NPC"} and its due Claims report waking`, () => {
  const fixture = scenario(`stable-${patient === PC ? "pc" : "npc"}`);
  const activity = stabilize(fixture, patient);
  const input = completionInput(activity);
  const early = fixture.runtime.step(fixture.profiles, fixture.state, input);
  assert.equal(early.kind, "rejected");
  assert.equal(early.rejection.code, "missingPrerequisite");
  elapse(fixture, activity);
  const requestCount = fixture.requests.length;
  const completed = drive(fixture, input);
  assert.equal(completed.kind, "committed");
  assert.equal(fixture.requests.length, requestCount, "completion does not request another recovery die");
  assert.deepEqual(completed.events.map(event => event.eventType), ["ActivityCompleted", "HealingResolved"]);
  assert.deepEqual([...new Set(completed.events.map(event => event.rootActionId))], [input.proposalId]);
  const target = fixture.state.combatRuntime.entities[patient];
  assert.equal(target.hitPoints.current, "1");
  assert.equal(target.lifeState, "alive");
  assert.equal(target.conditions.unconscious, undefined);
  assert.equal(target.conditions.stable, undefined);
  assert.equal(fixture.state.entities[patient].hitPoints.current, 1);
  const claims = projected(fixture, completed, patient);
  const text = claims.claims.flatMap(claim => claim.narrationFacts).join("\n");
  assert.match(text, /生命值.*0.*1/u);
  assert.match(text, /昏迷已结束/u);
  assert.match(text, /生命状态由 昏迷 变为 存活/u);
  const material = buildFrozenNarrationMaterial(completed.receipt, claims.viewerKey, claims);
  assert.deepEqual(reuseFrozenNarrationMaterialForRetry(material), material);
  const hidden = projectRenderableClaims(authorityClaims(fixture, completed, patient),
  { viewerKey: "viewer:unrelated", refs: [], displayNames: {} });
  assert.equal(hidden.claims.length, 0);
  replay(fixture);
  assert.equal(fixture.runtime.step(fixture.profiles, fixture.state, input).kind, "rejected");
});

test("ordinary healing of a conscious creature does not invent waking or a life-state change", () => {
  const fixture = scenario("stable-normal-healing");
  const result = invoke(fixture, HEAL, PC);
  const authority = authorityClaims(fixture, result, SOURCE);
  const healing = authority.claims.filter(claim => claim.outcomeCode === "healed");
  assert.equal(healing.length, 1);
  assert.match(healing[0].summary, /10.*14/u);
  assert.doesNotMatch(JSON.stringify(authority), /昏迷已结束|生命状态由/u);
  assert.equal(fixture.state.combatRuntime.entities[PC].lifeState, "alive");
  replay(fixture);
});

test("damage interrupts real Medicine recovery and the former due root cannot heal or wake the patient", () => {
  const fixture = scenario("stable-interrupted");
  const activity = stabilize(fixture, PC);
  const damaged = invoke(fixture, HARM, PC);
  assert.ok(damaged.events.some(event => event.eventType === "ActivityInterrupted"));
  assert.equal(fixture.state.campaignRuntime.activities[activity.activityId].status, "interrupted");
  assert.equal(fixture.state.combatRuntime.entities[PC].conditions.stable, undefined);
  elapse(fixture, activity);
  const before = structuredClone(fixture.state);
  const rejected = fixture.runtime.step(fixture.profiles, fixture.state, completionInput(activity));
  assert.equal(rejected.kind, "rejected");
  assert.deepEqual(fixture.state, before);
  assert.equal(fixture.state.combatRuntime.entities[PC].hitPoints.current, "0");
  assert.equal(fixture.state.combatRuntime.entities[PC].conditions.unconscious, true);
  assert.equal(fixture.events.filter(event => event.eventType === "HealingResolved").length, 0);
  replay(fixture);
});
