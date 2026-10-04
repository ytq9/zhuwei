import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NPC_COMBAT_TURN_TOOL_NAME } from "../../../app/_runtime/lib/kp/npc-combat-turn";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import { sentContext } from "../../support/fixtures/vnext-request-layout.mjs";

// SPEC 0012 §§3、5, SPEC 0006 §§6、7 (ADR 0101): a player who says they draw
// a sword and attack Naes starts a fight. The KP's startCombat names who takes
// part and who is surprised and writes Naes's first combat statistics; Rules
// opens the encounter and asks for initiative: the player rolls its own, the
// Room draws Naes's. The attack waits for the player's turn. When Naes goes
// first, its turn is planned by the NPC turn driver; then the player attacks
// Naes from the map.
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:combat-start:alice", sessionVersion: 1 } };
const ACTOR = "character:combat-start:alice", NAES = "npc:black-oak-will:naes", HALL = "wake";
const SAY = "我拔出长剑，冲向奈斯并挥剑攻击他。";
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

/** The KP's ruling: both aware, hostile both ways, Naes's first statistics. */
const startCombat = { decision: { kind: "startCombat",
  participants: [{ creatureRef: ACTOR, surprise: { kind: "aware" } }, { creatureRef: NAES, surprise: { kind: "aware" } }],
  hostilities: [{ fromRefs: [ACTOR], toRefs: [NAES] }, { fromRefs: [NAES], toRefs: [ACTOR] }],
  combatStatistics: [{ npcRef: NAES, armorClass: 11, speedFeet: 30, hitPointsMaximum: 38, deathPolicy: "deathSaves",
    attacks: [{ kind: "meleeAttack", label: "钉头锤", ability: "str", reachFeet: 5, damage: "1d6", damageType: "bludgeoning" }] }],
  description: "长剑出鞘的一瞬，奈斯收起了笑意，退后半步，袖中露出钉头锤。" } };

type Calls = { proposals: Data[]; decisions: Data[]; narrations: Data[] };

/** The Room instance with a scripted model: the KP selects and fills the
 * start, Naes's own turn strikes the actor when it can, and every die lands
 * on 10 (or the die's largest face below that). */
async function scenario<T>(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>,
  body: (act: (input: RoomActionInput) => Promise<Data>, target: Data, calls: Calls) => Promise<T>) {
  return runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    target.authorityRoll = (sides: number) => Math.min(sides, 10);
    const calls: Calls = { proposals: [], decisions: [], narrations: [] };
    const act = async (input: RoomActionInput) => {
      const scope = createVNextModelCallScope({ roomId: "combat-start-room-test", limit: "12", emit() {} });
      const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, body) {
        const request = body as Data;
        const tool = request.tools?.[0]?.function?.name;
        if (tool !== NPC_COMBAT_TURN_TOOL_NAME) throw new Error(`unexpected model call ${String(tool)}`);
        const frame = JSON.parse(request.messages[1].content) as Data;
        calls.decisions.push(frame);
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
      const narrationAdapter = { async narrate(request: Data) { calls.narrations.push(structuredClone(request)); return { body: "战斗开始了。" }; },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
      const kp = createVNextKpAdapter({ narrationAdapter, journal: {
        begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
      }, proposalBinding: scope.bind({ async run(_model, body) {
        const request = body as Data;
        calls.proposals.push(structuredClone(request));
        const name = String(request.tools[0].function.name);
        return toolResult(name, name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: ["startCombat"] } : startCombat);
      } }) });
      return await handleRoomAction({ principal: ALICE, authority, kp }, input) as Data;
    };
    return body(act, target, calls);
  });
}

const view = async (target: Data) => { const observed = await target.observe(ALICE) as Data; return observed.readModel ?? observed; };
const state = (target: Data) => structuredClone(target.authoritativeReplay().state) as Data;
const events = (target: Data) => structuredClone(target.authorityStore.events()) as Data[];

it("the text attack on Naes starts an encounter; the player rolls initiative, Naes's first turn is planned by the driver, then the player strikes from the map", async () => {
  const stub = await initialize("combat-start-room");
  await scenario(stub, async (act, target, calls) => {
    // Before the fight the actor stands next to Naes (a map move outside an encounter).
    const walked = await act({ kind: "mapMove", submissionId: "combat-start-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
    expect(walked.kind, JSON.stringify(walked).slice(0, 800)).toBe("committed");
    const before = events(target).length;

    const started = await act({ kind: "intent", submissionId: "combat-start-intent", text: SAY } as RoomActionInput);
    const detail = () => JSON.stringify({ started: { kind: started.kind, code: started.code, issues: started.issues },
      events: events(target).slice(before).map(event => event.eventType) }).slice(0, 4000);
    expect(started.kind, detail()).toBe("awaitingPlayerRoll");
    // The KP selected the start and filled it; the frozen context names the
    // creatures present and Naes's module stat line.
    expect(calls.proposals.map(request => request.tools[0].function.name)[0]).toBe(OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    const filling = calls.proposals.at(-1)!;
    expect(JSON.stringify(filling.tools[0].function.parameters)).toContain("startCombat");
    const context = sentContext(filling) as Data;
    const anchors = (context.requiredContext ?? context).entries.find((entry: Data) => String(entry.entryRef).startsWith("profile-context:"));
    expect(JSON.stringify(anchors)).toContain(NAES);
    expect(JSON.stringify(anchors)).toContain("AC 13 HP 38");
    // The act resolves no attack; it asks the player for its initiative.
    expect(events(target).slice(before).some(event => event.eventType === "AbilityInvoked"), detail()).toBe(false);
    const rolls = (await target.observe(ALICE) as Data).pendingPlayerRolls as Data[];
    expect(rolls, detail()).toHaveLength(1);
    expect(rolls[0]).toMatchObject({ characterId: ACTOR, kind: "init", reason: "进行先攻检定" });

    const rolled = await act({ kind: "roll", submissionId: "combat-start-initiative", randomnessId: String(rolls[0].id) } as RoomActionInput);
    const added = events(target).slice(before);
    const rolledDetail = JSON.stringify({ rolled: { kind: rolled.kind, code: rolled.code }, events: added.map(event => `${event.eventType}:${event.rootActionId}`),
      decisions: calls.decisions.length }).slice(0, 6000);
    expect(rolled.kind, rolledDetail).toBe("committed");
    const opened = state(target);
    const [encounterId, encounter] = Object.entries(opened.combatRuntime.encounters)[0] as [string, Data];
    expect([...encounter.participantEntityIds].sort()).toEqual([ACTOR, NAES].sort());
    expect(encounter.surprisedEntityIds).toEqual([]);
    // Initiative: the actor rolled 10 - 1, Naes 10 + 1; Naes went first.
    expect(encounter.turnOrderEntityIds, rolledDetail).toEqual([NAES, ACTOR]);
    const initiative = added.find(event => event.eventType === "InitiativeEstablished")!;
    expect(initiative.payload.entries.map((entry: Data) => [entry.combatantEntityIds[0], entry.total])).toEqual([[NAES, 11], [ACTOR, 9]]);
    expect(opened.combatRuntime.entities[NAES]).toMatchObject({ hitPoints: { maximum: "38" }, armorClass: "11" });
    // Naes's turn was due as soon as it started: the driver asked Naes once,
    // from its own view, and its strike landed before the turn came back.
    expect(calls.decisions, rolledDetail).toHaveLength(1);
    expect(calls.decisions[0].npcViewer.viewer).toMatchObject({ kind: "npc", subjectId: NAES });
    expect(calls.decisions[0].options.npcRef).toBe(NAES);
    expect(added.some(event => event.eventType === "NpcCombatTurnPlanned" && event.payload.npcCharacterId === NAES), rolledDetail).toBe(true);
    expect(added.some(event => event.eventType === "AbilityInvoked" && event.payload.sourceEntityId === NAES), rolledDetail).toBe(true);
    expect(opened.combatRuntime.encounters[encounterId].activeEntityId).toBe(ACTOR);
    // The fight's opening is narrated from its claims, the KP's description among them.
    const openingClaims = calls.narrations.flatMap(request => (request.renderableClaims?.claims ?? []) as Data[]);
    expect(openingClaims.find(claim => claim.outcomeCode === "encounterStarted")?.summary).toContain("奈斯收起了笑意");
    expect(openingClaims.filter(claim => claim.outcomeCode === "initiativeRolled").length).toBe(2);

    // The player's turn: it attacks Naes from the map with its longsword.
    const strike = (opened.combatRuntime.entities[ACTOR].abilityRefs as string[]).find(ref => ref.includes("longsword"));
    expect(strike).toBeTypeOf("string");
    const hitPointsBefore = Number(opened.combatRuntime.entities[NAES].hitPoints.current);
    let attacked = await act({ kind: "combatAbility", submissionId: "combat-start-strike", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      abilityRef: strike!, target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    for (let roll = 0; attacked.kind === "awaitingPlayerRoll" && roll < 3; roll++) {
      const pending = (await target.observe(ALICE) as Data).pendingPlayerRolls as Data[];
      attacked = await act({ kind: "roll", submissionId: `combat-start-strike-roll-${roll}`, randomnessId: String(pending[0].id) } as RoomActionInput);
    }
    expect(attacked.kind, JSON.stringify(attacked).slice(0, 1500)).toBe("committed");
    const after = state(target);
    expect(events(target).some(event => event.eventType === "AbilityInvoked" && event.payload.sourceEntityId === ACTOR
      && event.payload.abilityRef === strike)).toBe(true);
    // 1d8 shows 8, plus Strength 3.
    expect(Number(after.combatRuntime.entities[NAES].hitPoints.current)).toBe(hitPointsBefore - 11);
  });
}, 120_000);
