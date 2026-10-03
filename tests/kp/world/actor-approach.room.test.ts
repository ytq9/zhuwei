import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { entitiesWithinRange } from "../../../app/_runtime/lib/rules/profiles/combat-geometry";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0014 §4 (ADR 0087): a player's act that begins with walking across the
// room reaches Rules through the ordinary Room action; the actor's place on
// the map is committed with the act and every view of the room follows it.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:approach:alice", sessionVersion: 1 } };
const ACTOR = "character:approach:alice", NAES = "npc:black-oak-will:naes", HALL = "wake";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });

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

/** The KP's ruling: walk into the stair shadow and tap Naes on the shoulder. */
function tapNaes() {
  return { mode: "adjudication", basisRefs: [NAES], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "奈斯会注意到你。", successOutcome: "拍到了奈斯的肩膀。" },
    proposals: [{ kind: "worldInteraction", basisRefs: [NAES], consumes: [], produces: [], outcomeBinding: "always", sceneRef: HALL,
      intent: "走到楼梯阴影里，拍拍奈斯的肩膀。", method: "穿过大厅走到他身边，伸手拍他的肩。",
      targetRefs: [NAES], directTargetRefs: [NAES], instrumentRefs: [], abilityRef: { kind: "none" },
      approach: { kind: "nextTo", ref: NAES },
      branches: { success: { outcomeCode: "outcome:tapped", summary: "拍到了奈斯的肩膀。", effects: [],
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: NAES, sense: "touch", evidence: "他的肩膀很瘦，风帽下的人停了一下。", basisRefs: [NAES] }],
        pressures: [], opportunities: [] }, failure: null } }] };
}

async function run(stub: Stub, input: RoomActionInput, requests: Data[]) {
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "approach-room-test", limit: "9", emit() {} });
  const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action),
    commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value),
    observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
    publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
    deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
    beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
    failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
  } as RoomAuthorityCapability;
  const narrationAdapter = { async narrate() { return { body: "你穿过大厅，拍了拍奈斯的肩膀。" }; },
    async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run(_model, request) {
    requests.push(structuredClone(request as Data));
    const name = (request as Data).tools[0].function.name;
    if (name === "offer_kp_proposal_bundle") return result(name, { requestedCapabilities: ["worldInteraction"] });
    return result(name, encodeVNextStrictToolBundle(tapNaes() as never));
  } }) });
  return handleRoomAction({ principal: ALICE, authority, kp }, input);
}

it("walking into the stair shadow to tap Naes commits the actor's new place, which the room then shows", async () => {
  const stub = await initialize("approach-room");
  const requests: Data[] = [];
  const before = await runInDurableObject(stub, (instance) =>
    structuredClone((instance as unknown as Data).authoritativeReplay().state) as Data);
  expect(entitiesWithinRange(before.combatRuntime.entities[ACTOR], before.combatRuntime.entities[NAES], "60")).toBe(false);
  // A new room opens the wake as its text reads: Lian by the hearth, Naes in
  // the stairs' shadow, Varo at the counter; the player comes in at the west.
  expect(before.campaignRuntime.campaign.moduleRef.profileId).toBe("module:black-oak-will:social-resolution-v2");
  expect(before.combatRuntime.entities["npc:black-oak-will:lian"].position).toEqual({ x: "360", y: "0", elevation: "0" });
  expect(before.combatRuntime.entities[NAES].position).toEqual({ x: "270", y: "270", elevation: "0" });
  expect(before.combatRuntime.entities["npc:black-oak-will:varo"].position).toEqual({ x: "60", y: "240", elevation: "0" });
  expect(before.combatRuntime.entities[ACTOR].position).toEqual({ x: "-420", y: "60", elevation: "0" });

  const outcome = await run(stub, { kind: "intent", submissionId: "tap-naes", text: "我走到楼梯阴影里，拍拍奈斯的肩膀。" }, requests);
  const after = await runInDurableObject(stub, (instance) => {
    const t = instance as unknown as Data, replay = t.authoritativeReplay();
    return { state: structuredClone(replay.state) as Data, events: structuredClone(t.authorityStore.events()) as Data[] };
  });
  const detail = JSON.stringify({ outcome, events: after.events.map(event => event.eventType) }).slice(0, 2000);
  expect(outcome.kind, detail).toBe("committed");

  // The filling form the KP was sent offers the walk on the world step.
  const filling = requests.find(request => request.tools[0].function.name !== "offer_kp_proposal_bundle")!;
  expect(JSON.stringify(filling.tools[0].function.parameters), detail).toContain("\"approach\"");
  // The KP sees the stairs on the map and where people stand now; the
  // module's opening places are not repeated to it.
  const sent = JSON.stringify(filling.messages);
  expect(sent, detail).toContain("feature:wake:stairs");
  expect(sent, detail).not.toContain("openingPlacements");

  const walked = after.events.find(event => event.eventType === "CharacterRepositioned");
  expect(walked?.payload.toward, detail).toEqual({ kind: "nextTo", ref: NAES });
  const actor = after.state.combatRuntime.entities[ACTOR], naes = after.state.combatRuntime.entities[NAES];
  expect(entitiesWithinRange(actor, naes, "60"), JSON.stringify(actor.position)).toBe(true);
  expect(naes.position).toEqual(before.combatRuntime.entities[NAES].position);

  // The player's own map shows where the actor now stands.
  const view = await (stub as unknown as Data).observe(ALICE) as Data;
  const readModel = view.readModel ?? view;
  expect(readModel.tacticalProjection.self.position, detail).toEqual(actor.position);
}, 60_000);

// SPEC 0014 §§3、4 (ADR 0091): outside an encounter a player moves on the map
// directly: Room hands the move to Rules with no model call and no time.
it("a map move outside an encounter walks the actor next to Lian with no model call, and a stale map is refused", async () => {
  const stub = await initialize("map-move-room");
  const requests: Data[] = [];
  const view = async () => { const observed = await (stub as unknown as Data).observe(ALICE) as Data; return observed.readModel ?? observed; };
  const before = await view();
  const revision = before.tacticalProjection.spatialRevision;
  const moved = await run(stub, { kind: "mapMove", submissionId: "map-move-lian", spatialRevision: revision,
    destination: { kind: "nextTo", ref: "npc:black-oak-will:lian" } } as RoomActionInput, requests);
  expect(moved.kind, JSON.stringify(moved).slice(0, 1500)).toBe("committed");
  expect(requests, "no model call").toHaveLength(0);
  const after = await runInDurableObject(stub, (instance) => {
    const t = instance as unknown as Data;
    return { state: structuredClone(t.authoritativeReplay().state) as Data, events: structuredClone(t.authorityStore.events()) as Data[] };
  });
  const walked = after.events.filter(event => event.eventType === "CharacterRepositioned");
  expect(walked).toHaveLength(1);
  const actor = after.state.combatRuntime.entities[ACTOR], lian = after.state.combatRuntime.entities["npc:black-oak-will:lian"];
  expect(entitiesWithinRange(actor, lian, "60"), JSON.stringify(actor.position)).toBe(true);
  const seen = await view();
  expect(seen.tacticalProjection.self.position).toEqual(actor.position);
  expect(seen.tacticalProjection.spatialRevision).not.toBe(revision);

  // The map the player chose from is no longer current.
  const stale = await run(stub, { kind: "mapMove", submissionId: "map-move-stale", spatialRevision: revision,
    destination: { kind: "point", x: "-420", y: "60" } } as RoomActionInput, requests);
  expect(stale.kind).toBe("rejected");
  expect((stale as Data).code).toBe("spatialStateChanged");
  // A point off the map cannot be reached, and nothing says why.
  const outside = await run(stub, { kind: "mapMove", submissionId: "map-move-outside",
    spatialRevision: seen.tacticalProjection.spatialRevision, destination: { kind: "point", x: "9000", y: "0" } } as RoomActionInput, requests);
  expect(outside.kind).toBe("rejected");
  expect((outside as Data).code).toBe("movementUnavailable");
  expect(requests).toHaveLength(0);
}, 60_000);
