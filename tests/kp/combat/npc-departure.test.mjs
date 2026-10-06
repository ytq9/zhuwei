// SPEC 0012 §§3.4, 6.3, 7, 13: pure Rules transition and replay probe.
import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { authoritativeModuleProfile } from "../../../app/_runtime/lib/module/authoritative.ts";
import { npcCombatTurnOptions, npcCombatTurnPlanIssues } from "../../../app/_runtime/lib/rules/v2/npc-turn-options.ts";
import { npcCombatTurnRootPrefix } from "../../../app/_runtime/lib/rules/v2/npc-combat-turn-state.ts";
import { isNpcSpatialShell } from "../../../app/_runtime/lib/rules/v2/npc-mechanics.ts";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";
import { planSceneApproach } from "../../../app/_runtime/lib/rules/v2/scene-approach.ts";
import { placeTravelPlan } from "../../../app/_runtime/lib/rules/v2/places.ts";
for (const grouped of [false, true])
test(`NPC departs, expires residual Ready and rejoins uniquely (${grouped ? "shared" : "individual"} initiative)`, async () => {
  const FLEEING_NPC = "npc:review:flee", STAYING_NPC = "npc:review:stays", ENCOUNTER = "encounter:review:exit";
  const module = await authoritativeModuleProfile("black-oak-will");
  const f = createAuthoredProbeFixture("review-npc-depart", {
    npcCharacters: [{ id: FLEEING_NPC, name: "离开者" }, { id: STAYING_NPC, name: "留下者" }],
    additionalScenes: module.storyBible.storyAnchors.locations.map(location => ({
      id: location.sceneId, name: location.name, geometry: structuredClone(location.tacticalGeometry),
    })),
    placeMap: structuredClone(module.tacticalSite),
    characterScenes: { [ACTOR]: "wake", [PEER]: "wake", [FLEEING_NPC]: "wake", [STAYING_NPC]: "wake" },
  });
  f.events = [];
  let serial = 0;
  function take(input) {
    const result = f.runtime.step(f.profiles, f.state, input);
    if (result.events?.length) {
      f.events.push(...result.events);
      f.state = result.state;
      const p = f.runtime.replay(f.genesis, f.events);
      assert.equal(p.kind, "replayed", JSON.stringify(p));
      assert.deepEqual(p.state, f.state);
    }
    return result;
  }
  function settle(result) {
    while (result.kind === "awaitingRandomness") {
      result = take({
        kind: "authoritativeRandomness", resolutionId: result.resolutionId,
        responseId: `authority:${++serial}`, continuationCapability: result.continuationCapability,
        randomnessResults: result.randomnessRequests.map(request => ({
          randomnessId: request.randomnessId, requestHash: request.requestHash,
          draws: request.dice.map(term => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(
            request.purposeKey.startsWith("initiative:")
              ? request.purposeKey.includes(FLEEING_NPC) ? 20 : request.purposeKey.includes(ACTOR) ? 15
                : request.purposeKey.includes(PEER) ? 10 : 5 : 2,
          ) })),
        })),
      });
    }
    return result;
  }
  function npc(id) {
    const character = f.state.entities[id], body = f.state.combatRuntime.entities[id];
    const scores = character.abilityScores ?? character.socialMechanics?.abilityScores;
    return { entityId: id, name: character.name, placement: { position: body.position },
      mechanics: { kind: "bespokeDefinition", definition: {
        definitionId: `npc-template:${id}`, revision: "1", definitionKind: "npcMechanicalTemplate",
        rulesBasis: "srd5.1-2014", causalBasisRefs: ["wake"], visibilityPolicyRef: "visibility:scene-observers",
        content: {
          schema: "zhuwei.npc-mechanical-template/v1", label: character.name, footprint: body.footprint,
          stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
          proficiencyBonus: String(character.proficiencyBonus ?? 2), armorClass: "10",
          armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "10", shieldBonus: "0" },
          hitPointsMaximum: "20", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: "deadAtZero",
          intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] },
        },
      } },
    };
  }
  for (const [id, x, y] of [[FLEEING_NPC, 60, -120]]) {
    const p = planSceneApproach(f.state, id, "wake", { kind: "point", position: { x: String(x), y: String(y), elevation: "0" } });
    assert.equal(p.kind, "move", JSON.stringify({ id, position: f.state.combatRuntime.entities[id].position, p }));
    const t = createEventTransition(f.state, f.profiles, { rootActionId: "place:" + id, eventType: "CharacterRepositioned", payload: p.payload, visibilityPolicyId: "visibility:scene-observers", secrecy: "public" });
    f.events.push(t.event);
    f.state = t.state;
  }
  const dynamic = [FLEEING_NPC, STAYING_NPC].filter((id) => isNpcSpatialShell(f.state.combatRuntime.entities[id])).map(npc);
  let result = settle(take({ kind: "startEncounter", rootActionId: "open:review", proposalAttemptId: "proposal:review",
    encounterId: ENCOUNTER, sceneId: "wake",
    participantEntityIds: [ACTOR, PEER, ...[FLEEING_NPC, STAYING_NPC].filter(id => !dynamic.some(npc => npc.entityId === id))],
    dynamicEntities: dynamic, battlefieldFactIds: [],
    initiativeGroups: grouped
      ? [{ entryId: `init:${FLEEING_NPC}`, combatantEntityIds: [FLEEING_NPC, STAYING_NPC] },
        ...[ACTOR, PEER].map(id => ({ entryId: `init:${id}`, combatantEntityIds: [id] }))]
      : [FLEEING_NPC, ACTOR, PEER, STAYING_NPC].map(id => ({ entryId: `init:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [FLEEING_NPC, STAYING_NPC], toEntityIds: [ACTOR, PEER] },
      { fromEntityIds: [ACTOR, PEER], toEntityIds: [FLEEING_NPC, STAYING_NPC] }],
  }));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  const ready = take({ kind: "readyAction", rootActionId: "review:ready-before-depart", encounterId: ENCOUNTER,
    sourceEntityId: FLEEING_NPC, trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: STAYING_NPC },
    response: { kind: "move", movementMode: "walk", path: [f.state.combatRuntime.entities[FLEEING_NPC].position,
      { ...f.state.combatRuntime.entities[FLEEING_NPC].position, x: "65" }] },
  });
  assert.equal(ready.kind, "committed", JSON.stringify(ready.rejection));
  const options = npcCombatTurnOptions(f.profiles, f.state, FLEEING_NPC), exit = options.abilities.find((a) => a.abilityRef === "action:depart:yard");
  const steps = [{ kind: "move", to: { kind: "nextTo", ref: exit.departure.featureRef } },
    { kind: "ability", abilityRef: exit.abilityRef, target: { kind: "none" } }, { kind: "endTurn" }];
  assert.equal(exit.departure.atExitNow, false, "the exit must already be offered before arriving");
  assert.deepEqual(npcCombatTurnPlanIssues(options, steps), []);
  const enc = f.state.combatRuntime.encounters[ENCOUNTER], root = npcCombatTurnRootPrefix(ENCOUNTER, String(enc.round), String(enc.turnCursor), FLEEING_NPC) + "0";
  result = settle(take({ kind: "takeNpcCombatTurn", proposalId: root, encounterId: ENCOUNTER, sourceEntityId: FLEEING_NPC, steps }));
  assert.equal(result.kind, "committed", JSON.stringify(result.rejection));
  assert.equal(f.state.entities[FLEEING_NPC].sceneId, "yard");
  assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].participantEntityIds.includes(FLEEING_NPC), false);
  assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].historicalParticipantEntityIds.includes(FLEEING_NPC), true);
  assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].activeEntityId, grouped ? STAYING_NPC : ACTOR);
  assert.notEqual(f.state.combatRuntime.encounters[ENCOUNTER].status, "concluded", "the second NPC still fights the players");
  assert.equal(result.events.filter((e) => e.eventType === "TurnEnded" && e.payload.sourceEntityId === FLEEING_NPC).length, 1);
  assert.deepEqual(result.events.find((e) => e.eventType === "NpcCombatTurnSettled").payload, { rootActionId: root, npcCharacterId: FLEEING_NPC, outcome: "completed", stoppedAtStep: null, reason: null });
  assert.equal(f.state.combatRuntime.npcTurnPlans?.[root], undefined);
  assert.equal(result.events.filter((e) => e.eventType === "CombatantDeparted").length, 1);
  if (result.kind === "committed" && f.state.entities[FLEEING_NPC].sceneId === "yard") {
    const tasks = f.state.combatRuntime.encounters[ENCOUNTER].residualPhaseTasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].targetEntityId, FLEEING_NPC);
    assert.ok(BigInt(tasks[0].dueMicros) > 0n, "next-round phase cannot expire at time zero");
    assert.equal(tasks[0].targetRound, 2);
    assert.equal(tasks[0].edge, "turnStart");
    assert.equal(tasks[0].effectId, "effect:ready:review:ready-before-depart");
    const expired = take({ kind: "resolveFreeAction", proposalId: "review:expiry-boundary", characterId: FLEEING_NPC,
      goal: "站稳", method: "观察自身", feasibility: { kind: "directSuccess", publicBasis: "已经站稳" },
      outcome: { fictionTimeCostMicros: "0" },
    });
    assert.equal(expired.kind, "committed", JSON.stringify(expired.rejection));
    assert.equal(expired.events.filter((e) => e.eventType === "ReadiedActionExpired").length, 1);
    assert.deepEqual(f.state.combatRuntime.encounters[ENCOUNTER].residualPhaseTasks, []);
    assert.equal(Object.values(f.state.combatRuntime.effects).filter((e) => e.kind === "readiedAction").length, 0);
    const trip = placeTravelPlan(f.state, FLEEING_NPC, "wake");
    assert.equal(trip.kind, "accepted", JSON.stringify(trip));
    if (trip.kind === "accepted") {
      const t = createEventTransition(f.state, f.profiles, { rootActionId: "review:return", eventType: "CharacterMoved", payload: { characterId: FLEEING_NPC, destinationSceneId: "wake", ...trip.movement }, visibilityPolicyId: "visibility:scene-observers", secrecy: "public" });
      f.events.push(t.event);
      f.state = t.state;
      const back = f.runtime.replay(f.genesis, f.events);
      assert.equal(back.kind, "replayed");
      assert.deepEqual(back.state, f.state);
      result = settle(take({ kind: "joinEncounter", rootActionId: "review:rejoin", encounterId: ENCOUNTER, joiningEntityIds: [FLEEING_NPC], dynamicEntities: [], hostilities: [{ fromEntityIds: [FLEEING_NPC], toEntityIds: [ACTOR] }] }));
      assert.equal(result.kind, "committed", JSON.stringify(result.rejection));
      assert.deepEqual(f.state.combatRuntime.encounters[ENCOUNTER].departedEntityIds, []);
      assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].turnOrderEntityIds.filter((id) => id === FLEEING_NPC).length, 1);
      assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].participantEntityIds.filter((id) => id === FLEEING_NPC).length, 1);
      assert.equal(f.state.entities[FLEEING_NPC].sceneId, "wake");
      const survivingGroup = f.state.combatRuntime.encounters[ENCOUNTER].initiative.entries
        .find(entry => entry.combatantEntityIds.includes(STAYING_NPC));
      assert.ok(survivingGroup, "the other member of the old initiative group retains its entry");
      assert.equal(survivingGroup.total, grouped ? 20 : 5);
      assert.equal(f.state.combatRuntime.encounters[ENCOUNTER].initiative.entries
        .flatMap(entry => entry.combatantEntityIds).filter(id => id === FLEEING_NPC).length, 1);
    }
  }
});
