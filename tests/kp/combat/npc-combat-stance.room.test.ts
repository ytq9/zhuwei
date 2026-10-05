import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NPC_COMBAT_TURN_TOOL_NAME } from "../../../app/_runtime/lib/kp/npc-combat-turn";
import { NPC_FIGHT_SO_FAR_ITEMS, npcFightSoFar } from "../../../app/_runtime/lib/room/npc-combat-turn-host";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0006 §7, SPEC 0012 §§3.3、13 (ADR 0117): an NPC in a fight decides from
// its own view whether to keep fighting, yield or turn on someone again. The
// Room sends it its stance and what it saw of the fight so far; Rules
// records what it decides as its own hostility change and its words as heard
// by those present; the reply tells both as they look; and the players still
// answer whether the fight ends.
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:npc-stance:alice", sessionVersion: 1 } };
const ACTOR = "character:npc-stance:alice", NAES = "npc:black-oak-will:naes", HALL = "wake";
const KNIFE = "ability:npc-stance:naes-knife";
vi.spyOn(console, "info").mockImplementation(() => {});
const toolResult = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "1", sceneId: HALL, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 16, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["athletics"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

type Plan = (frame: Data) => Data[];
type Calls = { decisions: Data[]; narrations: Data[] };

async function scenario<T>(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>,
  body: (act: (input: RoomActionInput, plan: Plan) => Promise<Data>, target: Data, calls: Calls) => Promise<T>) {
  return runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    // Every die lands 1: no blow lands.
    target.authorityRoll = () => 1;
    const calls: Calls = { decisions: [], narrations: [] };
    const act = async (input: RoomActionInput, plan: Plan) => {
      const scope = createVNextModelCallScope({ roomId: "npc-stance-room-test", limit: "12", emit() {} });
      const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, body) {
        const request = body as Data;
        const tool = request.tools?.[0]?.function?.name;
        if (tool !== NPC_COMBAT_TURN_TOOL_NAME) throw new Error(`unexpected model call ${String(tool)}`);
        const frame = JSON.parse(request.messages[1].content) as Data;
        calls.decisions.push({ frame, schema: request.tools[0].function.parameters, system: request.messages[0].content });
        return toolResult(NPC_COMBAT_TURN_TOOL_NAME, { steps: plan(frame) });
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
      const narrationAdapter = { async narrate(request: Data) { calls.narrations.push(structuredClone(request)); return { body: "奈斯有了动作。" }; },
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

/** Test precondition, stored as Room events: the actor and Naes fight each
 * other, the actor first. Naes has 9 hit points. */
function startEncounter(target: Data) {
  const replay = target.authoritativeReplay();
  const body = replay.state.combatRuntime.entities[NAES], entity = replay.state.entities[NAES];
  const social = entity.socialMechanics ?? {};
  const scores = entity.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const naes = { entityId: NAES, name: entity.name, placement: { position: structuredClone(body.position) },
    mechanics: { kind: "bespokeDefinition", definition: {
      definitionId: "npc-template:npc-stance:naes", revision: "1", definitionKind: "npcMechanicalTemplate",
      rulesBasis: "srd5.1-2014", causalBasisRefs: [entity.semanticDefinitionRef], visibilityPolicyRef: "visibility:scene-observers",
      content: { schema: "zhuwei.npc-mechanical-template/v1", label: entity.name, footprint: structuredClone(body.footprint),
        stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
        proficiencyBonus: String(entity.proficiencyBonus ?? social.proficiencyBonus ?? 2),
        armorClass: "11", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "11", shieldBonus: "0" },
        hitPointsMaximum: "9", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: "deadAtZero",
        intrinsicAbilities: [knife], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } };
  let result = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:npc-stance-fixture",
    proposalAttemptId: "proposal:npc-stance-fixture", encounterId: "encounter:npc-stance", sceneId: HALL, participantEntityIds: [ACTOR],
    dynamicEntities: [naes], battlefieldFactIds: [], initiativeGroups: [ACTOR, NAES].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NAES] }, { fromEntityIds: [NAES], toEntityIds: [ACTOR] }] });
  const events: unknown[] = [];
  let draw = 0;
  while (result.kind === "awaitingRandomness") {
    events.push(...result.events);
    const waiting = result;
    result = target.rulesRuntime.step(replay.profiles, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
      responseId: `authority:npc-stance:${draw}`, continuationCapability: waiting.continuationCapability,
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
const encounter = (target: Data) => state(target).combatRuntime.encounters["encounter:npc-stance"] as Data;
const npcRoots = (list: Data[]) => [...new Set(list.map(event => String(event.rootActionId)).filter(root => root.startsWith("npc-turn:")))];

async function placeNextToNaes(act: (input: RoomActionInput, plan: Plan) => Promise<Data>, target: Data) {
  const moved = await act({ kind: "mapMove", submissionId: "npc-stance-place", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: NAES } } as RoomActionInput, () => [{ kind: "endTurn" }]);
  expect(moved.kind, JSON.stringify(moved).slice(0, 800)).toBe("committed");
}

async function conclusionPending(target: Data) {
  const pending = ((await view(target)).pendingInputs as Data[] ?? []).find(entry => entry.choiceKind === "encounterConclusion");
  expect(pending, JSON.stringify((await view(target)).pendingInputs).slice(0, 1500)).toBeDefined();
  return pending!;
}

it("Naes says it gives up and yields on its own turn; the reply tells its words and that it stopped fighting, and the player is asked and accepts", async () => {
  const stub = await initialize("npc-stance-yield-room");
  await scenario(stub, async (act, target, calls) => {
    await placeNextToNaes(act, target);
    startEncounter(target);
    const yieldPlan: Plan = () => [{ kind: "speak", words: "别打了，我认输！" }, { kind: "yield", fromRefs: [ACTOR] }, { kind: "endTurn" }];
    const ended = await act({ kind: "combatEndTurn", submissionId: "npc-stance-end" } as RoomActionInput, yieldPlan);
    expect(ended.kind, JSON.stringify(ended).slice(0, 1500)).toBe("committed");

    // Naes was asked from its own view: its stance and what it saw so far.
    expect(calls.decisions).toHaveLength(1);
    const [{ frame, schema, system }] = calls.decisions;
    expect(frame.options.stance).toMatchObject({ fighting: [{ ref: ACTOR, canFight: true }], fightingYou: [{ ref: ACTOR, canFight: true }],
      yieldRefs: [ACTOR], turnOnRefs: [] });
    expect(frame.options.speak).toBe(true);
    // Nothing it could tell has happened yet: the fixture opened the fight
    // and the player only ended its turn.
    expect(frame.fightSoFar).toEqual([]);
    for (const kind of ["speak", "yield"]) expect(JSON.stringify(schema)).toContain(`"${kind}"`);
    expect(system).toContain("yield");

    // The yield waits on the player's answer, asked as Naes's turn ends.
    const asked = await conclusionPending(target);
    expect(asked.question).toBe("对手投降了。是否接受并结束这场战斗？");
    const root = npcRoots(events(target))[0];
    const own = events(target).filter(event => event.rootActionId === root);
    expect(own.find(event => event.eventType === "HostilityChanged")?.payload).toMatchObject({ sourceEntityId: NAES,
      previousTargetEntityIds: [ACTOR], targetEntityIds: [], reason: "npcSurrendered" });
    expect(own.some(event => event.eventType === "KnowledgeAcquired" && event.payload.characterId === ACTOR)).toBe(true);

    const accepted = await act({ kind: "answer", submissionId: "npc-stance-accept", pendingInputId: asked.pendingInputId,
      answer: { kind: "acceptEncounterConclusion" } } as RoomActionInput, () => [{ kind: "endTurn" }]);
    expect(accepted.kind, JSON.stringify(accepted).slice(0, 1500)).toBe("committed");
    expect(encounter(target).status).toBe("concluded");
    // One reply tells the turn: Naes's words, that it stopped fighting, and the end.
    const replies = calls.narrations.filter(request => request.rootActionId === root);
    expect(replies).toHaveLength(1);
    const claims = replies[0].renderableClaims.claims as Data[];
    const words = claims.find(claim => claim.kind === "sourceClaim" && claim.speakerRef === NAES);
    expect(words?.statement, JSON.stringify(claims.map(claim => [claim.kind, claim.outcomeCode]))).toBe("别打了，我认输！");
    const stopped = claims.find(claim => claim.outcomeCode === "stoppedFighting");
    expect(stopped).toMatchObject({ actorRef: NAES, targetRefs: [ACTOR], summary: "该生物向目标投降，不再与目标交手。" });
    expect(JSON.stringify(claims)).not.toContain("为敌");
    expect(claims.some(claim => claim.outcomeCode === "encounterConcluded")).toBe(true);
  });
}, 120_000);

it("declined, Naes later turns on the player: its plan stops there, the rest of its turn is asked again with the player to strike, and it strikes", async () => {
  const stub = await initialize("npc-stance-turn-on-room");
  await scenario(stub, async (act, target, calls) => {
    await placeNextToNaes(act, target);
    startEncounter(target);
    await act({ kind: "combatEndTurn", submissionId: "npc-stance-turn-on-end" } as RoomActionInput,
      () => [{ kind: "yield", fromRefs: [ACTOR] }, { kind: "endTurn" }]);
    const asked = await conclusionPending(target);
    const declined = await act({ kind: "answer", submissionId: "npc-stance-decline", pendingInputId: asked.pendingInputId,
      answer: { kind: "rejectEncounterConclusion" } } as RoomActionInput, () => [{ kind: "endTurn" }]);
    expect(declined.kind, JSON.stringify(declined).slice(0, 1500)).toBe("committed");
    expect(encounter(target).activeEntityId).toBe(ACTOR);

    // Naes turns on the player, then is asked the rest of its turn and strikes.
    const betray: Plan = frame => frame.options.stance.turnOnRefs.includes(ACTOR)
      ? [{ kind: "speak", words: "你以为我真的认输了？" }, { kind: "turnOn", targetRefs: [ACTOR] }, { kind: "endTurn" }]
      : [{ kind: "ability", abilityRef: KNIFE, target: { kind: "creature", ref: ACTOR } }, { kind: "endTurn" }];
    const before = calls.decisions.length;
    const ended = await act({ kind: "combatEndTurn", submissionId: "npc-stance-turn-on-again" } as RoomActionInput, betray);
    expect(ended.kind, JSON.stringify(ended).slice(0, 1500)).toBe("committed");
    const asks = calls.decisions.slice(before);
    expect(asks).toHaveLength(2);
    expect(asks[0].frame.options.abilities.some((entry: Data) => entry.targets.some((option: Data) => option.ref === ACTOR))).toBe(false);
    expect(asks[1].frame.interruption).toMatchObject({ reason: "turnOn:asked-again", stoppedAtStep: 2 });
    expect(asks[1].frame.options.stance.fighting.map((entry: Data) => entry.ref)).toEqual([ACTOR]);
    expect(asks[1].frame.options.abilities.find((entry: Data) => entry.abilityRef === KNIFE)?.targets.map((entry: Data) => entry.ref)).toEqual([ACTOR]);
    // What it saw now includes its own turn on the player, most recent first,
    // and, before it, its yield.
    const seen = asks[1].frame.fightSoFar as Data[];
    expect(seen[0].what, JSON.stringify(seen)).toContain("转而与目标交手");
    expect(seen.findIndex(item => item.what.includes("你以为我真的认输了"))).toBeGreaterThan(0);
    expect(seen.some(item => item.by === NAES && item.what.includes("向目标投降"))).toBe(true);
    const roots = npcRoots(events(target)).slice(-2);
    const second = events(target).filter(event => event.rootActionId === roots[1]);
    expect(second.some(event => event.eventType === "AbilityInvoked" && event.payload.sourceEntityId === NAES && event.payload.abilityRef === KNIFE)).toBe(true);
    // The turn on the player is told as it looks.
    const turned = calls.narrations.filter(request => request.rootActionId === roots[0]).flatMap(request => request.renderableClaims.claims as Data[]);
    expect(turned.find(claim => claim.outcomeCode === "turnedHostile")).toMatchObject({ actorRef: NAES, targetRefs: [ACTOR], summary: "该生物转而与目标交手。" });
    expect(encounter(target).activeEntityId).toBe(ACTOR);
  });
}, 120_000);

it("what Naes saw of the fight stays bounded however long it lasts, most recent first", async () => {
  const stub = await initialize("npc-stance-bounded-room");
  await scenario(stub, async (act, target, calls) => {
    await placeNextToNaes(act, target);
    startEncounter(target);
    // Each round Naes says which round it counts and dodges.
    let round = 0;
    const talk: Plan = () => { round += 1; return [{ kind: "speak", words: `第${round}回合了。` }, { kind: "basic", action: "dodge" }, { kind: "endTurn" }]; };
    const started = Date.now();
    for (let turn = 0; turn < 14; turn++) {
      const ended = await act({ kind: "combatEndTurn", submissionId: `npc-stance-bounded-${turn}` } as RoomActionInput, talk);
      expect(ended.kind, JSON.stringify(ended).slice(0, 1500)).toBe("committed");
    }
    const elapsed = Date.now() - started;
    expect(calls.decisions).toHaveLength(14);
    const last = calls.decisions.at(-1)!.frame.fightSoFar as Data[];
    expect(last.length).toBeGreaterThan(0);
    expect(last.length).toBeLessThanOrEqual(NPC_FIGHT_SO_FAR_ITEMS);
    // Most recent first: its own words of the round before come first.
    const said = last.filter(item => item.by === NAES && item.what.includes("回合了"));
    expect(said[0]?.what, JSON.stringify(last)).toContain("第13回合了");
    expect(JSON.stringify(last)).not.toContain("第1回合了");
    // The frame does not grow with the fight.
    const sizes = calls.decisions.map(decision => JSON.stringify(decision.frame.fightSoFar).length);
    expect(Math.max(...sizes.slice(7))).toBeLessThanOrEqual(Math.max(...sizes.slice(0, 7)) * 2);
    console.warn(`npc-stance-bounded: 14 NPC turns took ${elapsed} ms; fightSoFar sizes ${sizes.join(",")}`);
    // The Room keeps what each act gave Naes as it is told; read again from
    // the journal alone, it is the same.
    const replay = target.authoritativeReplay();
    const args = { profiles: replay.profiles, genesis: replay.genesis, events: target.authorityStore.events(), npcId: NAES,
      encounterId: "encounter:npc-stance", actorOf: (receiptId: string, root: string, subjects: readonly string[]) =>
        target.authorityStore.receipt(receiptId)?.actorCharacterId ?? target.authorityStore.initiatingSubmission(root)?.character_id ?? subjects[0] };
    const remembered = npcFightSoFar({ ...args, memo: target.npcFightMemo }, target.rulesRuntime);
    expect(remembered.length).toBeGreaterThan(0);
    expect(npcFightSoFar({ ...args, memo: new Map() }, target.rulesRuntime)).toEqual(remembered);
  });
}, 180_000);
