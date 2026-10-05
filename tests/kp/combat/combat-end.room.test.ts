import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NPC_COMBAT_TURN_TOOL_NAME } from "../../../app/_runtime/lib/kp/npc-combat-turn";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { planPlaceRoute } from "../../../app/_runtime/lib/rules/v2/places";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0012 §§3.3、13, §15 B29/B30/B53 (ADR 0112, ADR 0117): a fight started
// from a text act can end. The player says it surrenders; the KP records the
// player's side, and on its own turn Naes accepts, which puts the end to the
// player, who first declines (the fight goes on) and later, after saying the
// fight is over, accepts. In another fight the
// player's strike drops Naes; as the player ends its turn Rules itself puts
// the end to the player, who accepts. Each ended fight leaves the actor free
// to go elsewhere, and its reply is told from claims.
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:combat-end:alice", sessionVersion: 1 } };
const ACTOR = "character:combat-end:alice", NAES = "npc:black-oak-will:naes", HALL = "wake";
vi.spyOn(console, "info").mockImplementation(() => {});
const toolResult = (name: string, value: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function",
  function: { name, arguments: JSON.stringify(value) } }] } }] });

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      // Dexterity 8: with equal faces Naes (Dexterity 12) acts first.
      staticCard: { name: "1", sceneId: HALL, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 16, dex: 8, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["athletics"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30,
        equipped: { main: "longsword" }, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

/** The KP's start: both aware, hostile both ways, Naes's first statistics. */
const startCombat = (hitPoints: number) => ({ decision: { kind: "startCombat",
  participants: [{ creatureRef: ACTOR, surprise: { kind: "aware" } }, { creatureRef: NAES, surprise: { kind: "aware" } }],
  hostilities: [{ fromRefs: [ACTOR], toRefs: [NAES] }, { fromRefs: [NAES], toRefs: [ACTOR] }],
  combatStatistics: [{ npcRef: NAES, armorClass: 11, speedFeet: 30, hitPointsMaximum: hitPoints, deathPolicy: "deathSaves",
    attacks: [{ kind: "meleeAttack", label: "钉头锤", ability: "str", reachFeet: 5, damage: "1d6", damageType: "bludgeoning" }] }],
  description: "长剑出鞘的一瞬，奈斯收起了笑意，退后半步，袖中露出钉头锤。" } });

type Calls = { proposals: Data[]; narrations: Data[] };
type Ruling = { capability: string; filling: Data };

/** The Room instance with a scripted model: each text act selects and fills
 * the next ruling in `rulings`; Naes's own turn strikes the actor; every die
 * lands on 10 (or the die's largest face below that). */
async function scenario<T>(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>, rulings: Ruling[],
  body: (act: (input: RoomActionInput) => Promise<Data>, target: Data, calls: Calls) => Promise<T>) {
  return runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    target.authorityRoll = (sides: number) => Math.min(sides, 10);
    const calls: Calls = { proposals: [], narrations: [] };
    const act = async (input: RoomActionInput) => {
      const scope = createVNextModelCallScope({ roomId: "combat-end-room-test", limit: "12", emit() {} });
      const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, body) {
        const request = body as Data;
        const tool = request.tools?.[0]?.function?.name;
        if (tool !== NPC_COMBAT_TURN_TOOL_NAME) throw new Error(`unexpected model call ${String(tool)}`);
        const frame = JSON.parse(request.messages[1].content) as Data;
        // ADR 0117: Naes accepts the surrender of a player who stopped fighting it.
        const stance = frame.options.stance as Data;
        if (stance.fighting.some((entry: Data) => entry.ref === ACTOR) && !stance.fightingYou.some((entry: Data) => entry.ref === ACTOR)) {
          return toolResult(NPC_COMBAT_TURN_TOOL_NAME, { steps: [{ kind: "speak", words: "好，我收手。" }, { kind: "yield", fromRefs: [ACTOR] }, { kind: "endTurn" }] });
        }
        const strike = (frame.options.abilities as Data[]).find(entry => (entry.targets as Data[]).some(option => option.ref === ACTOR));
        return toolResult(NPC_COMBAT_TURN_TOOL_NAME, { steps: strike === undefined ? [{ kind: "basic", action: "dodge" }, { kind: "endTurn" }]
          : [{ kind: "ability", abilityRef: strike.abilityRef, target: { kind: "creature", ref: ACTOR } }, { kind: "endTurn" }] });
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
      const narrationAdapter = { async narrate(request: Data) { calls.narrations.push(structuredClone(request)); return { body: "战况有了变化。" }; },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
      const ruling = rulings[0];
      const kp = createVNextKpAdapter({ narrationAdapter, journal: {
        begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
      }, proposalBinding: scope.bind({ async run(_model, body) {
        const request = body as Data;
        calls.proposals.push(structuredClone(request));
        const name = String(request.tools[0].function.name);
        if (ruling === undefined) throw new Error("no ruling scripted");
        return toolResult(name, name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: [ruling.capability] } : ruling.filling);
      } }) });
      const result = await handleRoomAction({ principal: ALICE, authority, kp }, input) as Data;
      if (input.kind === "intent") rulings.shift();
      return result;
    };
    return body(act, target, calls);
  });
}

const view = async (target: Data) => { const observed = await target.observe(ALICE) as Data; return observed.readModel ?? observed; };
const state = (target: Data) => structuredClone(target.authoritativeReplay().state) as Data;
const events = (target: Data) => structuredClone(target.authorityStore.events()) as Data[];
const encounterOf = (target: Data) => Object.values(state(target).combatRuntime.encounters)[0] as Data;
const claimsOf = (calls: Calls) => calls.narrations.flatMap(request => (request.renderableClaims?.claims ?? []) as Data[]);

/** Walks up to Naes, starts the fight from a text act, rolls initiative; Naes
 * strikes on its turn and the turn comes back to the player. */
async function begin(act: (input: RoomActionInput) => Promise<Data>, target: Data) {
  const walked = await act({ kind: "mapMove", submissionId: "combat-end-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
  expect(walked.kind, JSON.stringify(walked).slice(0, 800)).toBe("committed");
  const started = await act({ kind: "intent", submissionId: "combat-end-start", text: "我拔出长剑，冲向奈斯并挥剑攻击他。" } as RoomActionInput);
  expect(started.kind, JSON.stringify(started).slice(0, 1500)).toBe("awaitingPlayerRoll");
  const rolls = (await target.observe(ALICE) as Data).pendingPlayerRolls as Data[];
  const rolled = await act({ kind: "roll", submissionId: "combat-end-initiative", randomnessId: String(rolls[0].id) } as RoomActionInput);
  expect(rolled.kind, JSON.stringify(rolled).slice(0, 1500)).toBe("committed");
  expect(encounterOf(target).activeEntityId).toBe(ACTOR);
}

async function conclusionPending(target: Data) {
  const pending = ((await view(target)).pendingInputs as Data[] ?? []).find(entry => entry.choiceKind === "encounterConclusion");
  expect(pending, JSON.stringify((await view(target)).pendingInputs).slice(0, 1500)).toBeDefined();
  return pending!;
}

it("B29/B30: the player's surrender, accepted by Naes on its turn, is declined by the player and the fight goes on; then the player calls the fight off and accepts, and the hall's doors open again", async () => {
  const stub = await initialize("combat-end-surrender-room");
  const rulings: Ruling[] = [
    { capability: "startCombat", filling: startCombat(38) },
    { capability: "endCombat", filling: { decision: { kind: "endCombat", outcome: "actorSurrenders", stopFightingRefs: [NAES],
      description: "你把长剑丢在脚边，奈斯盯了你片刻，收起了钉头锤。" } } },
    { capability: "endCombat", filling: { decision: { kind: "endCombat", outcome: "conflictOver", stopFightingRefs: [],
      description: "两人都不再动手，大厅里只剩下炉火的声音。" } } },
  ];
  await scenario(stub, rulings, async (act, target, calls) => {
    await begin(act, target);
    const encounterId = String(encounterOf(target).encounterId);
    expect(planPlaceRoute(state(target) as never, ACTOR, "wills")).toMatchObject({ kind: "rejected", reason: "place:in-encounter" });

    const surrendered = await act({ kind: "intent", submissionId: "combat-end-surrender", text: "我放下长剑，向奈斯投降。" } as RoomActionInput);
    // ADR 0117: the KP records only the player's side; Naes has not answered.
    expect(surrendered.kind, JSON.stringify(surrendered).slice(0, 2000)).toBe("committed");
    // The KP was offered the end form inside the encounter and filled it.
    const offer = calls.proposals.filter(request => request.tools[0].function.name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME).at(-1)!;
    expect(JSON.stringify(offer.tools[0].function.parameters)).toContain("endCombat");
    expect(JSON.stringify(calls.proposals.at(-1)!.tools[0].function.parameters)).toContain("actorSurrenders");
    expect(JSON.stringify(calls.proposals.at(-1)!.tools[0].function.parameters)).not.toContain("foesSurrender");
    expect(encounterOf(target).hostilities).toEqual([{ fromEntityIds: [NAES], toEntityIds: [ACTOR] }]);
    // The player ends its turn; on its own turn Naes accepts and the end is asked.
    const turnEnded = await act({ kind: "combatEndTurn", submissionId: "combat-end-surrender-end-turn" } as RoomActionInput);
    expect(turnEnded.kind, JSON.stringify(turnEnded).slice(0, 2000)).toBe("committed");
    const asked = await conclusionPending(target);
    expect(asked.question).toBe("投降被对方接受了。是否结束这场战斗？");

    const declined = await act({ kind: "answer", submissionId: "combat-end-decline", pendingInputId: asked.pendingInputId,
      answer: { kind: "rejectEncounterConclusion" } } as RoomActionInput);
    expect(declined.kind, JSON.stringify(declined).slice(0, 2000)).toBe("committed");
    expect(encounterOf(target).status).not.toBe("concluded");
    expect(encounterOf(target).hostilities).toEqual([]);
    // The replies tell who stopped, as it looks, and why the end was put to the player.
    const told = claimsOf(calls);
    const stopped = told.filter(claim => claim.outcomeCode === "stoppedFighting");
    expect(stopped.find(claim => claim.actorRef === ACTOR)?.summary).toBe("该角色向目标投降，不再与目标交手。你把长剑丢在脚边，奈斯盯了你片刻，收起了钉头锤。");
    expect(stopped.find(claim => claim.actorRef === NAES)?.summary).toBe("该生物接受了目标的投降，不再与目标交手。");
    expect(told.find(claim => claim.kind === "sourceClaim" && claim.speakerRef === NAES)?.statement).toBe("好，我收手。");
    expect(told.find(claim => claim.outcomeCode === "encounterConclusionProposed")?.summary).toBe("投降被对方接受了。");
    expect(told.some(claim => claim.outcomeCode === "encounterConcluded")).toBe(false);

    const calledOff = await act({ kind: "intent", submissionId: "combat-end-call-off", text: "我们别打了，就到这里吧。" } as RoomActionInput);
    expect(calledOff.kind, JSON.stringify(calledOff).slice(0, 2000)).toBe("awaitingInput");
    const again = await conclusionPending(target);
    expect(again.question).toBe("这场冲突已经不必再按先攻轮流进行。是否结束这场战斗？");
    const accepted = await act({ kind: "answer", submissionId: "combat-end-accept", pendingInputId: again.pendingInputId,
      answer: { kind: "acceptEncounterConclusion" } } as RoomActionInput);
    expect(accepted.kind, JSON.stringify(accepted).slice(0, 2000)).toBe("committed");
    const ended = state(target);
    expect(ended.combatRuntime.encounters[encounterId].status).toBe("concluded");
    expect(events(target).find(event => event.eventType === "EncounterConcluded")?.payload.reason).toBe("conflictNoLongerNeeded");
    const last = claimsOf(calls);
    // The KP's description of the moment is its own claim, told; the reason is the question's.
    expect(last.find(claim => claim.outcomeCode === "encounterConclusionMoment" && claim.summary.includes("炉火"))).toBeDefined();
    expect(last.filter(claim => claim.outcomeCode === "encounterConclusionProposed").map(claim => claim.summary)).toContain("这场冲突已经不必再按先攻轮流进行。");
    expect(last.some(claim => claim.outcomeCode === "encounterConcluded")).toBe(true);
    // Time and places work again: the way to the wills room is open.
    expect(planPlaceRoute(ended as never, ACTOR, "wills").kind).toBe("accepted");
    expect((await view(target)).tacticalProjection.encounter?.status ?? "concluded").toBe("concluded");
  });
}, 180_000);

it("B53: the player's strike drops Naes; ending the turn, Rules asks the player whether the fight ends, and it ends", async () => {
  const stub = await initialize("combat-end-downed-room");
  await scenario(stub, [{ capability: "startCombat", filling: startCombat(8) }], async (act, target, calls) => {
    await begin(act, target);
    const encounterId = String(encounterOf(target).encounterId);
    const strike = (state(target).combatRuntime.entities[ACTOR].abilityRefs as string[]).find(ref => ref.includes("longsword"));
    let attacked = await act({ kind: "combatAbility", submissionId: "combat-end-strike", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      abilityRef: strike!, target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    for (let roll = 0; attacked.kind === "awaitingPlayerRoll" && roll < 3; roll++) {
      const pending = (await target.observe(ALICE) as Data).pendingPlayerRolls as Data[];
      attacked = await act({ kind: "roll", submissionId: `combat-end-strike-roll-${roll}`, randomnessId: String(pending[0].id) } as RoomActionInput);
    }
    // 1d8 shows 8, plus Strength 3: the melee blow drops Naes (8 hit points)
    // and asks the attacker whether to knock it out; the player strikes to kill.
    expect(attacked.kind, JSON.stringify(attacked).slice(0, 1500)).toBe("awaitingInput");
    const choice = ((await view(target)).pendingInputs as Data[]).find(entry => entry.choiceKind === "knockOut");
    expect(choice, JSON.stringify(attacked).slice(0, 1500)).toBeDefined();
    attacked = await act({ kind: "answer", submissionId: "combat-end-lethal", pendingInputId: choice!.pendingInputId,
      answer: { kind: "dealLethalDamage" } } as RoomActionInput);
    expect(attacked.kind, JSON.stringify(attacked).slice(0, 1500)).toBe("committed");
    // Naes keeps death saves: at 0 hit points it is dying, not dead, and cannot fight.
    expect(state(target).combatRuntime.entities[NAES]).toMatchObject({ lifeState: "unconscious", hitPoints: { current: "0" } });

    const ended = await act({ kind: "combatEndTurn", submissionId: "combat-end-end-turn" } as RoomActionInput);
    expect(ended.kind, JSON.stringify(ended).slice(0, 2000)).toBe("awaitingInput");
    const asked = await conclusionPending(target);
    expect(asked.question).toBe("与你们为敌的已经没有谁还能战斗。是否结束这场战斗？");
    const accepted = await act({ kind: "answer", submissionId: "combat-end-auto-accept", pendingInputId: asked.pendingInputId,
      answer: { kind: "acceptEncounterConclusion" } } as RoomActionInput);
    expect(accepted.kind, JSON.stringify(accepted).slice(0, 2000)).toBe("committed");
    expect(state(target).combatRuntime.encounters[encounterId].status).toBe("concluded");
    expect(events(target).find(event => event.eventType === "EncounterConcluded")?.payload.reason).toBe("hostilesCannotContinue");
    const told = claimsOf(calls);
    expect(told.find(claim => claim.outcomeCode === "encounterConclusionProposed")?.summary).toBe("与玩家一方为敌的已经没有谁还能战斗。");
    expect(told.some(claim => claim.outcomeCode === "encounterConcluded")).toBe(true);
    expect(planPlaceRoute(state(target) as never, ACTOR, "wills").kind).toBe("accepted");
  });
}, 180_000);
