import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NPC_COMBAT_TURN_TOOL_NAME } from "../../../app/_runtime/lib/kp/npc-combat-turn";
import { NPC_PENDING_DECISION_TOOL_NAME } from "../../../app/_runtime/lib/kp/pending-decision-policy";
import { entitiesWithinRange } from "../../../app/_runtime/lib/rules/profiles/combat-geometry";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0006 §§6、7: when an encounter's turn comes to an NPC, the Room asks that
// NPC once, from its own view and the options Rules computed, for its whole
// turn; Rules carries the plan out under one root through the ordinary due
// commit path, and one narration covers the turn. A failed call leaves the
// turn waiting and a later request asks again; a player's opportunity attack
// stops the turn at that choice and the turn goes on after the answer.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:npc-turn:alice", sessionVersion: 1 } };
const ACTOR = "character:npc-turn:alice", NAES = "npc:black-oak-will:naes", VARO = "npc:black-oak-will:varo", HALL = "wake";
const KNIFE = "ability:npc-turn:naes-knife";
// Room telemetry lines, including those of alarms that fire after a test,
// are not under test; keep them off the shared test pool.
vi.spyOn(console, "info").mockImplementation(() => {});
const toolResult = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });

async function initialize(name: string, hitPoints = 20) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "1", sceneId: HALL, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 16, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["athletics"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: hitPoints, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

type Plan = (frame: Data) => Data[] | "fail";
type Calls = { decisions: Data[]; narrations: Data[]; pendings: Data[] };

/** Everything runs on the Room instance itself: its authority methods with a
 * model transport, the production action layer, and dice that always land 1. */
async function scenario<T>(stub: Stub, body: (act: (input: RoomActionInput, plan: Plan) => Promise<Data>, target: Data, calls: Calls) => Promise<T>,
  roll: (sides: number) => number = () => 1) {
  return runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    target.authorityRoll = roll;
    const calls: Calls = { decisions: [], narrations: [], pendings: [] };
    const act = async (input: RoomActionInput, plan: Plan) => {
      const scope = createVNextModelCallScope({ roomId: "npc-turn-room-test", limit: "12", emit() {} });
      const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, body) {
        const request = body as Data;
        const tool = request.tools?.[0]?.function?.name;
        if (tool === NPC_PENDING_DECISION_TOOL_NAME) {
          // The existing NPC pending decision, answered from the NPC's own view.
          const frame = JSON.parse(request.messages[1].content) as Data;
          const options = request.tools[0].function.parameters.properties.answer.enum as Data[];
          calls.pendings.push({ frame, options });
          return toolResult(NPC_PENDING_DECISION_TOOL_NAME, { answer: options.find(option => option.kind === "knockOut") ?? options[0] });
        }
        if (tool !== NPC_COMBAT_TURN_TOOL_NAME) throw new Error(`unexpected model call ${String(tool)}`);
        const frame = JSON.parse(request.messages[1].content) as Data;
        const steps = plan(frame);
        calls.decisions.push({ frame, schema: request.tools[0].function.parameters, failed: steps === "fail" });
        if (steps === "fail") throw new Error("provider unavailable");
        return toolResult(NPC_COMBAT_TURN_TOOL_NAME, { steps });
      } }));
      const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
        commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
        resumePlayerRandomness: (context: unknown, id: string) => target.resumePlayerRandomness(context, id, transport),
        observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
        publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
        deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
        beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
        failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
        beginViewerNarrationRecovery: (...args: unknown[]) => target.beginViewerNarrationRecovery(...args),
        publishViewerNarrationRecovery: (...args: unknown[]) => target.publishViewerNarrationRecovery(...args),
        failViewerNarrationRecovery: (...args: unknown[]) => target.failViewerNarrationRecovery(...args),
      } as RoomAuthorityCapability;
      const narrationAdapter = { async narrate(request: Data) { calls.narrations.push(structuredClone(request)); return { body: "奈斯动了。" }; },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
      const kp = createVNextKpAdapter({ narrationAdapter, journal: {
        begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
      }, proposalBinding: scope.bind({ async run() { throw new Error("no proposal call"); } }) });
      return await handleRoomAction({ principal: ALICE, authority, kp }, input) as Data;
    };
    return body(act, target, calls);
  });
}

const knife = { definitionId: KNIFE, revision: "1", rulesBasis: "srd5.1-2014", activation: { kind: "attack", actionGrant: "attack" },
  target: { kind: "creature", count: "1", reachInches: "60" }, attack: { ability: "dex", proficiency: true },
  damage: [{ type: "piercing", formula: "1d4+2" }] };

function npcEntry(state: Data, id: string, abilities: Data[]) {
  const body = state.combatRuntime.entities[id], entity = state.entities[id];
  const social = entity.socialMechanics ?? {};
  const scores = entity.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  return { entityId: id, name: entity.name, placement: { position: structuredClone(body.position) },
    mechanics: { kind: "bespokeDefinition", definition: {
      definitionId: `npc-template:npc-turn:${id}`, revision: "1", definitionKind: "npcMechanicalTemplate",
      rulesBasis: "srd5.1-2014", causalBasisRefs: [entity.semanticDefinitionRef], visibilityPolicyRef: "visibility:scene-observers",
      content: { schema: "zhuwei.npc-mechanical-template/v1", label: entity.name, footprint: structuredClone(body.footprint),
        stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
        proficiencyBonus: String(entity.proficiencyBonus ?? social.proficiencyBonus ?? 2),
        armorClass: "11", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "11", shieldBonus: "0" },
        hitPointsMaximum: "9", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: "deadAtZero",
        intrinsicAbilities: abilities, itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } };
}

/** Test precondition, stored as Room events: an encounter the actor opens
 * against the given NPCs, the actor first and the NPCs after it in order. */
function startEncounter(target: Data, npcs: Data[]) {
  const replay = target.authoritativeReplay();
  const ids = npcs.map(entry => entry.entityId);
  let result = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:npc-turn-fixture",
    proposalAttemptId: "proposal:npc-turn-fixture", encounterId: "encounter:npc-turn", sceneId: HALL, participantEntityIds: [ACTOR],
    dynamicEntities: npcs, battlefieldFactIds: [], initiativeGroups: [ACTOR, ...ids].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [...ids] }, { fromEntityIds: [...ids], toEntityIds: [ACTOR] }] });
  const events: unknown[] = [];
  let draw = 0;
  while (result.kind === "awaitingRandomness") {
    events.push(...result.events);
    const waiting = result;
    result = target.rulesRuntime.step(replay.profiles, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
      responseId: `authority:npc-turn:${draw}`, continuationCapability: waiting.continuationCapability,
      randomnessResults: waiting.randomnessRequests.map((request: Data) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
        draws: request.dice.map((term: Data) => ({ sides: Number(term.sides),
          faces: Array.from({ length: Number(term.count) }, () => { draw += 1; return draw === 1 ? 20 : draw === 2 ? 12 : 1; }) })) })) });
  }
  expect(result.kind, JSON.stringify(result).slice(0, 1500)).toBe("committed");
  events.push(...result.events);
  target.authorityStore.appendEvents(events); target.authorityStore.updateState(result.state); target.authorityStore.syncAuthorityIndex(result.state);
}

const view = async (target: Data) => { const observed = await target.observe(ALICE) as Data; return observed.readModel ?? observed; };
const state = (target: Data) => structuredClone(target.authoritativeReplay().state) as Data;
const events = (target: Data) => structuredClone(target.authorityStore.events()) as Data[];
const npcRoots = (list: Data[]) => [...new Set(list.map(event => String(event.rootActionId)).filter(root => root.startsWith("npc-turn:")))];
const turnOf = (frame: Data) => frame.options.npcRef as string;

/** Naes walks up to the actor and strikes with its knife; Varo dodges. */
const fight: Plan = frame => turnOf(frame) === NAES
  ? [{ kind: "move", to: { kind: "nextTo", ref: ACTOR } }, { kind: "ability", abilityRef: KNIFE, target: { kind: "creature", ref: ACTOR } }, { kind: "endTurn" }]
  : [{ kind: "basic", action: "dodge" }, { kind: "endTurn" }];

async function placeActor(act: (input: RoomActionInput, plan: Plan) => Promise<Data>, target: Data, destination: Data) {
  const moved = await act({ kind: "mapMove", submissionId: `npc-turn-place:${JSON.stringify(destination)}`,
    spatialRevision: (await view(target)).tacticalProjection.spatialRevision, destination } as RoomActionInput, () => "fail");
  expect(moved.kind, JSON.stringify(moved).slice(0, 800)).toBe("committed");
}

it("the player ends its turn; Naes's own plan walks up and strikes, one reply tells it, and the turn comes back to the player", async () => {
  const stub = await initialize("npc-turn-room");
  await scenario(stub, async (act, target, calls) => {
    await placeActor(act, target, { kind: "point", x: "120", y: "120" });
    startEncounter(target, [npcEntry(state(target), NAES, [knife])]);
    const before = events(target).length;
    const ended = await act({ kind: "combatEndTurn", submissionId: "npc-turn-end" } as RoomActionInput, fight);
    const added = events(target).slice(before);
    const rows = (sql: string) => target.ctx.storage.sql.exec(sql).toArray() as Data[];
    const detail = JSON.stringify({ ended: { kind: ended.kind, code: ended.code }, events: added.map(e => `${e.eventType}:${e.rootActionId}`),
      due: rows("SELECT child_root_action_id, work_kind, status, next_attempt_at FROM authority_due_work"),
      subs: rows("SELECT submission_id, status, result_json FROM authority_submissions WHERE input_kind = 'dueActivity'") }).slice(0, 6000);
    expect(ended.kind, detail).toBe("committed");

    // One decision, made from Naes's own view and Rules' options for Naes.
    expect(calls.decisions, detail).toHaveLength(1);
    const [{ frame, schema }] = calls.decisions;
    expect(frame.npcViewer.viewer).toMatchObject({ kind: "npc", subjectId: NAES });
    expect(frame.options.npcRef).toBe(NAES);
    expect(frame.options.abilities.find((entry: Data) => entry.abilityRef === KNIFE)?.targets.map((entry: Data) => entry.ref)).toEqual([ACTOR]);
    expect(frame.options.movement.destinations.map((entry: Data) => entry.ref)).toContain(ACTOR);
    expect(JSON.stringify(schema)).toContain(KNIFE);

    // Rules took the plan in order under one root: walk, strike, end.
    const roots = npcRoots(added);
    expect(roots, detail).toEqual([`npc-turn:encounter:npc-turn:1:1:${NAES}:0`]);
    const own = added.filter(e => e.rootActionId === roots[0]);
    const kinds = own.map(e => e.eventType);
    expect(kinds[0]).toBe("NpcCombatTurnPlanned");
    expect(kinds.at(-1)).toBe("NpcCombatTurnSettled");
    const walk = own.findIndex(e => e.eventType === "MovementSegmentCommitted" && e.payload.sourceEntityId === NAES);
    const strike = own.findIndex(e => e.eventType === "AbilityInvoked" && e.payload.sourceEntityId === NAES && e.payload.abilityRef === KNIFE);
    const end = own.findIndex(e => e.eventType === "TurnEnded" && e.payload.sourceEntityId === NAES);
    expect(walk, detail).toBeGreaterThan(0);
    expect(strike, detail).toBeGreaterThan(walk);
    expect(end, detail).toBeGreaterThan(strike);
    expect(own.find(e => e.eventType === "NpcCombatTurnSettled")?.payload).toMatchObject({ outcome: "completed" });
    const after = state(target);
    expect(entitiesWithinRange(after.combatRuntime.entities[NAES], after.combatRuntime.entities[ACTOR], "60")).toBe(true);
    expect(after.combatRuntime.encounters["encounter:npc-turn"].activeEntityId).toBe(ACTOR);
    expect(after.combatRuntime.npcTurnPlans).toBeUndefined();
    expect(after.receipts[roots[0]]).toMatchObject({ status: "committed",
      eventRange: { fromEventSeq: own[0].eventSeq, toEventSeq: own.at(-1)!.eventSeq } });

    // One reply tells Naes's turn, and it reached the player.
    const replies = calls.narrations.filter(n => n.rootActionId === roots[0]);
    expect(replies, detail).toHaveLength(1);
    // ADR 0101: the reply is written from the turn's claims, as a world act's is.
    expect(replies[0].narrationInputMode).toBe("frozenRenderableClaims-vnext-1");
    const outcomes = (replies[0].renderableClaims.claims as Data[]).map(claim => claim.outcomeCode);
    expect(outcomes, JSON.stringify(outcomes)).toEqual(expect.arrayContaining(["movedInCombat", "turnStarted"]));
    // ADR 0108: the walk is committed in segments; the reply tells it as one move of their total distance.
    const segments = own.filter(event => event.eventType === "MovementSegmentCommitted");
    const feet = (segments.reduce((sum, event) => sum + BigInt(String((event.payload as Data).distanceMilliInches)), 0n) + 6_000n) / 12_000n;
    const moves = (replies[0].renderableClaims.claims as Data[]).filter(claim => claim.outcomeCode === "movedInCombat");
    expect(segments.length, JSON.stringify(outcomes)).toBeGreaterThan(1);
    expect(moves.map(claim => claim.summary)).toEqual([`该角色移动了约 ${feet} 尺。`]);
    const strikes = (replies[0].renderableClaims.claims as Data[]).filter(claim => claim.kind === "abilityEffectApplied" && claim.sourceRef === NAES);
    expect(strikes.length, JSON.stringify(replies[0].renderableClaims.claims.map((claim: Data) => [claim.kind, claim.outcomeCode, claim.abilityName]))).toBeGreaterThan(0);
    const seen = await view(target);
    expect(seen.tacticalProjection.encounter.activeEntityId).toBe(ACTOR);
    expect(seen.npcCombatTurn).toBeUndefined();
    expect(target.authorityStore.pendingDueWork()).toEqual([]);
  });
}, 60_000);

it("a failed decision leaves Naes's turn waiting, shown at the table, and the retried request asks again and completes it", async () => {
  const stub = await initialize("npc-turn-retry-room");
  await scenario(stub, async (act, target, calls) => {
    await placeActor(act, target, { kind: "point", x: "120", y: "120" });
    startEncounter(target, [npcEntry(state(target), NAES, [knife])]);
    const ended = await act({ kind: "combatEndTurn", submissionId: "npc-turn-retry-end" } as RoomActionInput, () => "fail");
    // The player's own end of turn stands; Naes's turn waits, with no act invented.
    expect(ended.kind, JSON.stringify(ended).slice(0, 1500)).toBe("committed");
    expect(calls.decisions.map(entry => entry.failed)).toEqual([true]);
    const waiting = state(target);
    expect(waiting.combatRuntime.encounters["encounter:npc-turn"].activeEntityId).toBe(NAES);
    expect(npcRoots(events(target))).toEqual([]);
    expect((await view(target)).npcCombatTurn).toEqual({ npcRef: NAES, state: "waitingForRetry" });

    const retried = await act({ kind: "combatEndTurn", submissionId: "npc-turn-retry-end" } as RoomActionInput, fight);
    expect(retried.kind, JSON.stringify(retried).slice(0, 1500)).toBe("committed");
    expect(calls.decisions.map(entry => entry.failed)).toEqual([true, false]);
    const roots = npcRoots(events(target));
    expect(roots).toEqual([`npc-turn:encounter:npc-turn:1:1:${NAES}:0`]);
    expect(target.authorityStore.vnextInvocationOrdinals(roots[0])).toEqual([1, 2]);
    expect(events(target).some(e => e.eventType === "AbilityInvoked" && e.payload.sourceEntityId === NAES && e.payload.abilityRef === KNIFE)).toBe(true);
    expect(state(target).combatRuntime.encounters["encounter:npc-turn"].activeEntityId).toBe(ACTOR);
    expect(calls.narrations.filter(n => n.rootActionId === roots[0])).toHaveLength(1);
    expect((await view(target)).npcCombatTurn).toBeUndefined();
  });
}, 60_000);

it("the player's opportunity attack stops Naes's walk at the player's choice, and the turn goes on after the answer", async () => {
  const stub = await initialize("npc-turn-oa-room");
  await scenario(stub, async (act, target, calls) => {
    await placeActor(act, target, { kind: "nextTo", ref: NAES });
    startEncounter(target, [npcEntry(state(target), NAES, [knife])]);
    const away = { x: "240", y: "90" };
    const flee: Plan = () => [{ kind: "move", to: { kind: "point", ...away } }, { kind: "endTurn" }];
    const ended = await act({ kind: "combatEndTurn", submissionId: "npc-turn-oa-end" } as RoomActionInput, flee);
    expect(ended.kind, JSON.stringify(ended).slice(0, 1500)).toBe("committed");
    const roots = npcRoots(events(target));
    expect(roots).toHaveLength(1);
    expect(state(target).receipts[roots[0]].status).toBe("awaitingInput");
    const asked = await view(target);
    expect(asked.npcCombatTurn).toEqual({ npcRef: NAES, state: "waitingForAnswer" });
    const pending = (asked.pendingInputs as Data[]).find(entry => entry.choiceKind === "reaction");
    expect(pending, JSON.stringify(asked.pendingInputs).slice(0, 1500)).toBeDefined();
    const opportunity = pending!.answerOptions.map((option: Data) => option.answer).find((answer: Data) => answer.kind === "useReaction");
    expect(opportunity).toMatchObject({ abilityRef: "action:opportunity-attack", targetEntityId: NAES });
    expect(calls.narrations.filter(n => n.rootActionId === roots[0])).toHaveLength(0);

    let answered = await act({ kind: "answer", submissionId: "npc-turn-oa-use", pendingInputId: pending!.pendingInputId, answer: opportunity } as RoomActionInput, flee);
    for (let rolls = 0; answered.kind === "awaitingPlayerRoll" && rolls < 3; rolls++) {
      const pendingRolls = (await target.observe(ALICE) as Data).pendingPlayerRolls as Data[];
      answered = await act({ kind: "roll", submissionId: `npc-turn-oa-roll-${rolls}`, randomnessId: String(pendingRolls[0].id) } as RoomActionInput, flee);
    }
    const own = events(target).filter(e => e.rootActionId === roots[0]);
    const detail = JSON.stringify({ answered: { kind: answered.kind, code: answered.code }, own: own.map(e => e.eventType) }).slice(0, 3000);
    expect(answered.kind, detail).toBe("committed");
    // The plan was still legal after the attack: no second decision.
    expect(calls.decisions, detail).toHaveLength(1);
    const attack = own.findIndex(e => e.eventType === "AbilityInvoked" && e.payload.sourceEntityId === ACTOR && e.payload.abilityRef === "action:opportunity-attack");
    const walked = own.map((e, index) => e.eventType === "MovementSegmentCommitted" && e.payload.sourceEntityId === NAES ? index : -1).filter(index => index >= 0);
    expect(attack, detail).toBeGreaterThan(0);
    expect(walked.at(-1)!, detail).toBeGreaterThan(attack);
    expect(own.find(e => e.eventType === "NpcCombatTurnSettled")?.payload, detail).toMatchObject({ outcome: "completed" });
    const after = state(target);
    expect(after.combatRuntime.entities[NAES].position).toEqual({ ...away, elevation: "0" });
    expect(after.combatRuntime.encounters["encounter:npc-turn"].activeEntityId).toBe(ACTOR);
    expect(after.receipts[roots[0]].status).toBe("committed");
    // One reply for the whole turn, published with the answer that ended it.
    expect(calls.narrations.filter(n => n.rootActionId === roots[0]), detail).toHaveLength(1);
    expect((await view(target)).npcCombatTurn).toBeUndefined();
  });
}, 60_000);

it("two NPC turns in a row are each decided and told in the request that ended the player's turn", async () => {
  const stub = await initialize("npc-turn-two-room");
  await scenario(stub, async (act, target, calls) => {
    await placeActor(act, target, { kind: "point", x: "120", y: "120" });
    const now = state(target);
    startEncounter(target, [npcEntry(now, NAES, [knife]), npcEntry(now, VARO, [])]);
    expect(state(target).combatRuntime.encounters["encounter:npc-turn"].turnOrderEntityIds).toEqual([ACTOR, NAES, VARO]);
    const ended = await act({ kind: "combatEndTurn", submissionId: "npc-turn-two-end" } as RoomActionInput, fight);
    expect(ended.kind, JSON.stringify(ended).slice(0, 1500)).toBe("committed");
    expect(calls.decisions.map(entry => turnOf(entry.frame))).toEqual([NAES, VARO]);
    // Each NPC was asked from its own view only.
    for (const { frame } of calls.decisions) expect(frame.npcViewer.viewer.subjectId).toBe(frame.options.npcRef);
    const roots = npcRoots(events(target));
    expect(roots).toEqual([`npc-turn:encounter:npc-turn:1:1:${NAES}:0`, `npc-turn:encounter:npc-turn:1:2:${VARO}:0`]);
    expect(events(target).some(e => e.eventType === "AbilityInvoked" && e.payload.sourceEntityId === VARO && e.payload.abilityRef === "action:dodge")).toBe(true);
    const after = state(target);
    expect(after.combatRuntime.encounters["encounter:npc-turn"]).toMatchObject({ activeEntityId: ACTOR, round: 2 });
    for (const root of roots) expect(calls.narrations.filter(n => n.rootActionId === root)).toHaveLength(1);
    expect(target.authorityStore.pendingDueWork()).toEqual([]);
  });
}, 60_000);

it("a choice Rules opens for Naes during its own turn is answered by Naes's pending decision, and the turn goes on", async () => {
  const stub = await initialize("npc-turn-knockout-room", 1);
  await scenario(stub, async (act, target, calls) => {
    await placeActor(act, target, { kind: "point", x: "120", y: "120" });
    startEncounter(target, [npcEntry(state(target), NAES, [knife])]);
    let ended = await act({ kind: "combatEndTurn", submissionId: "npc-turn-knockout-end" } as RoomActionInput, fight);
    // The knocked-out actor's own recovery roll is the player's gesture.
    for (let rolls = 0; rolls < 3; rolls++) {
      const pendingRolls = ((await target.observe(ALICE) as Data).pendingPlayerRolls ?? []) as Data[];
      if (pendingRolls.length === 0) break;
      ended = await act({ kind: "roll", submissionId: `npc-turn-knockout-roll-${rolls}`, randomnessId: String(pendingRolls[0].id) } as RoomActionInput, fight);
    }
    const roots = npcRoots(events(target));
    const own = events(target).filter(e => e.rootActionId === roots[0]);
    const detail = JSON.stringify({ ended: { kind: ended.kind, code: ended.code }, own: own.map(e => e.eventType) }).slice(0, 3000);
    expect(ended.kind, detail).toBe("committed");
    // Naes's knife drops the actor to 0 HP; Naes is asked, from its own view,
    // whether to knock the actor out, and its answer is applied.
    expect(calls.decisions, detail).toHaveLength(1);
    expect(calls.pendings, detail).toHaveLength(1);
    expect(calls.pendings[0].frame.pending).toMatchObject({ npcId: NAES, choiceKind: "knockOut" });
    expect(calls.pendings[0].frame.npcViewer.viewer).toMatchObject({ kind: "npc", subjectId: NAES });
    expect(own.find(e => e.eventType === "NpcCombatTurnSettled")?.payload, detail).toMatchObject({ outcome: "completed" });
    const after = state(target);
    expect(after.combatRuntime.entities[ACTOR].conditions).toMatchObject({ unconscious: true, stable: true });
    expect(after.combatRuntime.entities[ACTOR].lifeState).toBe("unconscious");
    expect(after.combatRuntime.pendingInputs).toEqual({});
    expect(calls.narrations.filter(n => n.rootActionId === roots[0]), detail).toHaveLength(1);
  }, sides => sides === 20 ? 20 : 1);
}, 60_000);
