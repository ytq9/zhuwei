import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { createAuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative";
import { NPC_PENDING_DECISION_TOOL_NAME } from "../../../app/_runtime/lib/kp/pending-decision-policy";
import { entitiesWithinRange } from "../../../app/_runtime/lib/rules/profiles/combat-geometry";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0012 §7.2 (user ruling 2026-10-04, "NPC 自己决定"): when the player's
// own map move leaves an NPC's reach, Room asks that NPC through its pending
// KP decision; the NPC's attack resolves and the walk then goes on.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:npc-oa:alice", sessionVersion: 1 } };
const ACTOR = "character:npc-oa:alice", NAES = "npc:black-oak-will:naes", HALL = "wake";
const OPPORTUNITY = { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: ACTOR };
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

/** The Room action with no proposal model; the NPC's pending decision runs the
 * production decision adapter over a stubbed model that answers from the
 * tool schema it was sent. */
async function run(stub: Stub, input: RoomActionInput, decisions: Data[]) {
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "npc-oa-room-test", limit: "9", emit() {} });
  const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action),
    commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value),
    observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
    publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
    deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
    beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
    failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
    resumePlayerRandomness: (...args: unknown[]) => target.resumePlayerRandomness(...args),
  } as RoomAuthorityCapability;
  const narrationAdapter = {
    async narrate() { return { body: "奈斯在你转身时出手。" }; },
    async propose() { throw new Error("unused"); },
    async decidePendingInput(request: Data) {
      // While the NPC decides, the player's own map still shows the actor
      // where the walk began, and the player is asked nothing.
      const seen = await target.observe(ALICE) as Data;
      const readModel = seen.readModel ?? seen;
      const decision: Data = { request: structuredClone(request), position: structuredClone(readModel.tacticalProjection.self.position) };
      decisions.push(decision);
      return createAuthoritativeKpAdapter({ ai: { async run(_model: string, modelInput: Data) {
        decision.modelInput = structuredClone(modelInput);
        const options = modelInput.tools[0].function.parameters.properties.answer.enum as Data[];
        return toolResult(NPC_PENDING_DECISION_TOOL_NAME, { answer: options.find(option => option.kind === "useReaction") });
      } } as never }).decidePendingInput(request as never);
    },
  } as unknown as AuthoritativeKpAdapter;
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run() { throw new Error("no proposal call"); } }) });
  return handleRoomAction({ principal: ALICE, authority, kp }, input);
}

/** Test precondition: an encounter the actor opens against Naes with the
 * actor first, through the public Rules input and stored as Room events. */
async function startEncounterWithNaes(stub: Stub) {
  await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    const replay = target.authoritativeReplay();
    const naes = replay.state.combatRuntime.entities[NAES], naesEntity = replay.state.entities[NAES];
    const social = naesEntity.socialMechanics ?? {};
    const scores = naesEntity.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    let result = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:npc-oa-fixture",
      proposalAttemptId: "proposal:npc-oa-fixture", encounterId: "encounter:npc-oa", sceneId: HALL, participantEntityIds: [ACTOR],
      dynamicEntities: [{ entityId: NAES, name: naesEntity.name, placement: { position: structuredClone(naes.position) },
        mechanics: { kind: "bespokeDefinition", definition: {
          definitionId: "npc-template:npc-oa:naes", revision: "1", definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014", causalBasisRefs: [naesEntity.semanticDefinitionRef], visibilityPolicyRef: "visibility:scene-observers",
          content: { schema: "zhuwei.npc-mechanical-template/v1", label: naesEntity.name, footprint: structuredClone(naes.footprint),
            stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
            proficiencyBonus: String(naesEntity.proficiencyBonus ?? social.proficiencyBonus ?? 2),
            armorClass: "11", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "11", shieldBonus: "0" },
            hitPointsMaximum: "9", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: "deadAtZero",
            intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
      battlefieldFactIds: [], initiativeGroups: [ACTOR, NAES].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
      hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NAES] }, { fromEntityIds: [NAES], toEntityIds: [ACTOR] }] });
    const events: unknown[] = [];
    let draw = 0;
    while (result.kind === "awaitingRandomness") {
      events.push(...result.events);
      const waiting = result;
      result = target.rulesRuntime.step(replay.profiles, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
        responseId: `authority:npc-oa:${draw}`, continuationCapability: waiting.continuationCapability,
        randomnessResults: waiting.randomnessRequests.map((request: Data) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
          draws: request.dice.map((term: Data) => ({ sides: Number(term.sides),
            faces: Array.from({ length: Number(term.count) }, () => ++draw === 1 ? 20 : 1) })) })) });
    }
    expect(result.kind, JSON.stringify(result).slice(0, 1500)).toBe("committed");
    events.push(...result.events);
    target.authorityStore.appendEvents(events); target.authorityStore.updateState(result.state); target.authorityStore.syncAuthorityIndex(result.state);
  });
}

it("the actor walking out of Naes's reach on the map gives Naes its own choice of an opportunity attack, then walks on", async () => {
  const stub = await initialize("npc-oa-room");
  const decisions: Data[] = [];
  const view = async () => { const observed = await (stub as unknown as Data).observe(ALICE) as Data; return observed.readModel ?? observed; };
  const approached = await run(stub, { kind: "mapMove", submissionId: "npc-oa-approach", spatialRevision: (await view()).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: NAES } } as RoomActionInput, decisions);
  expect(approached.kind, JSON.stringify(approached).slice(0, 800)).toBe("committed");
  await startEncounterWithNaes(stub);
  const start = await view();
  expect(start.tacticalProjection.encounter?.activeEntityId).toBe(ACTOR);
  // The actor stands west of Naes beside the ledger counter; fifteen feet
  // south takes it out of Naes's reach on open floor.
  const from = start.tacticalProjection.self.position;
  expect(from).toEqual({ x: "210", y: "270", elevation: "0" });
  const away = { x: "210", y: "90", elevation: "0" };
  const walked = await run(stub, { kind: "movement", submissionId: "npc-oa-walk-away", movementMode: "walk",
    spatialRevision: start.tacticalProjection.spatialRevision, path: [from, away] } as RoomActionInput, decisions);
  const after = await runInDurableObject(stub, (instance) => {
    const t = instance as unknown as Data, replay = t.authoritativeReplay();
    return { state: structuredClone(replay.state) as Data, events: structuredClone(t.authorityStore.events()) as Data[] };
  });
  const detail = JSON.stringify({ walked, events: after.events.map(event => event.eventType).slice(-14) }).slice(0, 2500);
  expect(walked.kind, detail).toBe("committed");

  // One NPC decision: Naes was offered the attack on the actor and a decline,
  // in the request Room sent and in the model's tool schema.
  expect(decisions, detail).toHaveLength(1);
  const [decision] = decisions;
  expect(decision.request.pending).toMatchObject({ npcId: NAES, choiceKind: "reaction" });
  expect(decision.request.pending.answerOptions.map((option: Data) => option.answer)).toEqual([OPPORTUNITY, { kind: "decline" }]);
  expect(decision.modelInput.tools[0].function.parameters.properties.answer.enum).toEqual([OPPORTUNITY, { kind: "decline" }]);
  expect(decision.position, "the walk waits on Naes's answer").toEqual(from);

  // Naes's attack resolved with its own roll, and the walk then went on.
  const answered = after.events.find(event => event.eventType === "ReactionAnswered");
  expect(answered?.payload, detail).toMatchObject({ controllerEntityId: NAES, answer: OPPORTUNITY });
  const attack = after.events.find(event => event.eventType === "AbilityInvoked" && event.payload.abilityRef === "action:opportunity-attack");
  expect(attack?.payload.sourceEntityId, detail).toBe(NAES);
  expect(typeof attack?.payload.mechanicalResult.attack.hit).toBe("boolean");
  const moved = after.events.filter(event => event.eventType === "MovementSegmentCommitted" && event.payload.sourceEntityId === ACTOR);
  expect(moved, detail).toHaveLength(1);
  expect(after.events.indexOf(attack!)).toBeLessThan(after.events.indexOf(moved[0]));
  const actor = after.state.combatRuntime.entities[ACTOR];
  expect(actor.position).toEqual(away);
  expect(entitiesWithinRange(actor, after.state.combatRuntime.entities[NAES], "60")).toBe(false);
  expect(after.state.combatRuntime.entities[NAES].turn.reaction).toBe("0");
  expect(Object.keys(after.state.combatRuntime.pendingInputs)).toEqual([]);
  expect((await view()).tacticalProjection.self.position).toEqual(away);
}, 60_000);
