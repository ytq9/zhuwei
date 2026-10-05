import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../../../app/_runtime/lib/room/vnext-proposal-invocation";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest } from "../../../app/_runtime/lib/rules";

// SPEC 0014 §4 (ADR 0103): the player says "我从后门出去，到后院。"; the KP
// answers with one goTo step to the module's yard. Rules walks the actor to
// the hall's back door, takes the minute on the way and puts it at the yard
// door; those in the hall are told it left and those in the yard that it came.

type RecordValue = Record<string, unknown>;
type Principal = { principal: { id: string; sessionVersion: number } };
type Internals = RoomAuthorityCapability & {
  beginVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationCompletion): Promise<{ kind: string }>;
  authoritativeReplay(): { state: AuthoritativeWorldState; genesis: RuntimeGenesis; profiles: RuntimeProfileManifest };
  authorityStore: { events(): EventEnvelope[] };
};
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Capture = { calls: number; narration: RecordValue[] };
const ALICE = { principal: { id: "principal:place-room:alice", sessionVersion: 1 } };
const BOB = { principal: { id: "principal:place-room:bob", sessionVersion: 1 } };
const CAROL = { principal: { id: "principal:place-room:carol", sessionVersion: 1 } };
const ACTOR = "character:place-room:alice", HALL_WATCHER = "character:place-room:bob", YARD_WATCHER = "character:place-room:carol";
const HALL = "wake", YARD = "yard";
function record(value: unknown): RecordValue { return value as RecordValue; }

async function initialize(): Promise<Stub> {
  const stub = env.VNEXT_ROOMS.getByName("vnext-place-movement-room");
  const character = (id: string, principal: Principal, sceneId: string) => ({ characterId: id, controllerPrincipalId: principal.principal.id,
    staticCard: { name: id, sceneId, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
      scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
      resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } });
  expect(await stub.initializeAuthoritative({ roomId: "vnext-place-movement-room", moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }, { principalId: BOB.principal.id, role: "player" },
      { principalId: CAROL.principal.id, role: "player" }],
    characters: [character(ACTOR, ALICE, HALL), character(HALL_WATCHER, BOB, HALL), character(YARD_WATCHER, CAROL, YARD)],
  } as never)).toMatchObject({ created: true });
  return stub;
}

function goToYard() {
  return { mode: "adjudication", basisRefs: [HALL], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "0", risk: "后门开着，没有风险。", successOutcome: "从后门出去，到了后院。" },
    proposals: [{ kind: "worldInteraction", basisRefs: [HALL], consumes: [], produces: [], outcomeBinding: "always", sceneRef: HALL,
      targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: null, intent: "从后门出去，到后院。", method: "推开后门走出去。",
      commonAction: { kind: "goTo", targetRef: YARD, destinationRef: null, option: "none" },
      branches: { success: { outcomeCode: "outcome:went-to-yard", summary: "从后门走到了后院。", effects: [],
        sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } }] };
}

async function run(stub: Stub, principal: Principal, input: RoomActionInput, capture: Capture, response?: unknown) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    const authority: RoomAuthorityCapability = {
      prepare: target.prepare.bind(target), commit: target.commit.bind(target), observe: target.observe.bind(target),
      acknowledge: target.acknowledge.bind(target), resumePlayerRandomness: target.resumePlayerRandomness!.bind(target),
      beginViewerNarrationRecovery: target.beginViewerNarrationRecovery!.bind(target),
      publishViewerNarrationRecovery: target.publishViewerNarrationRecovery!.bind(target),
      failViewerNarrationRecovery: target.failViewerNarrationRecovery!.bind(target),
      deliveryPublicationStatus: target.deliveryPublicationStatus!.bind(target),
      beginDeliveryAudiencePublication: target.beginDeliveryAudiencePublication!.bind(target),
      failDeliveryAudiencePublication: target.failDeliveryAudiencePublication!.bind(target), publishDelivery: target.publishDelivery!.bind(target),
    };
    const narrationAdapter = { async narrate(request: RecordValue) {
      capture.narration.push(structuredClone(request));
      return { body: "当前行动已记录。" };
    }, async propose() { throw new Error("use vNext strict tools"); }, async decideDueActorPlan() { throw new Error("no NPC plan in this scenario"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(principal, id, request),
      complete: (id, result) => target.completeVNextProposalInvocation(principal, id, result),
    }, proposalBinding: { async run(_model, request) {
      capture.calls++;
      if (response === undefined) throw new Error("a persisted action cannot ask for a second proposal");
      const name = String(record(record((request.tools as RecordValue[])[0]).function).name);
      const value = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: ["worldInteraction"] } : response;
      return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(encodeVNextStrictToolBundle(value as never)) } }] } }] };
    } } });
    return handleRoomAction({ principal, authority, kp }, input);
  });
}
async function snapshot(stub: Stub) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals;
    return { state: structuredClone(target.authoritativeReplay().state), events: structuredClone(target.authorityStore.events()) };
  });
}
const toldTo = (capture: Capture, characterId: string, outcomeCode: string) => capture.narration.some(request =>
  String(request.viewerKey ?? "").endsWith(`\u001f${characterId}`)
  && (record(request.renderableClaims).claims as RecordValue[] | undefined ?? []).some(claim => claim.outcomeCode === outcomeCode && claim.actorRef === ACTOR));

it("\"我从后门出去，到后院。\" goes to the module's yard through the back door; the hall sees the actor leave and the yard sees it come", async () => {
  const stub = await initialize(), capture: Capture = { calls: 0, narration: [] };
  const before = await snapshot(stub);
  expect(before.state.campaignRuntime.placeMap?.connections.map(connection => connection.id))
    .toEqual(["cellar-shrine", "wake-private-lian", "wake-wills", "wake-yard", "yard-cellar"]);
  const input: RoomActionInput = { kind: "intent", submissionId: "submission:place-room:yard", text: "我从后门出去，到后院。" };
  const went = await run(stub, ALICE, input, capture, goToYard());
  expect(went, JSON.stringify(went).slice(0, 600)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  const actor = after.state.entities[ACTOR];
  expect(actor.sceneId).toBe(YARD);
  expect(actor.visitedSceneIds).toEqual([HALL, YARD]);
  expect(after.state.combatRuntime.entities[ACTOR]).toMatchObject({ sceneId: YARD, position: { x: "-180", y: "360", elevation: "0" } });
  expect(after.state.entities[HALL_WATCHER].sceneId).toBe(HALL);
  // The walk to the back door, then the move with its minute on the way.
  const types = after.events.slice(before.events.length).map(event => event.eventType);
  expect(types.indexOf("CharacterRepositioned"), types.join(",")).toBeGreaterThanOrEqual(0);
  expect(types.indexOf("CharacterRepositioned")).toBeLessThan(types.indexOf("CharacterMoved"));
  const moved = after.events.find(event => event.eventType === "CharacterMoved")!.payload as RecordValue;
  expect(moved).toMatchObject({ characterId: ACTOR, destinationSceneId: YARD, travel: { connectionIds: ["wake-yard"] } });
  expect(BigInt(String(moved.arrivalMicros)) - BigInt(String(moved.departureMicros))).toBe(60_000_000n);
  // SPEC 0006 §7: each place's observers are told.
  const summary = JSON.stringify(capture.narration.map(request => [request.viewerKey,
    (record(request.renderableClaims).claims as RecordValue[] | undefined ?? []).map(claim => `${claim.kind}:${claim.outcomeCode ?? ""}`)]));
  expect(toldTo(capture, HALL_WATCHER, "departed"), summary).toBe(true);
  expect(toldTo(capture, YARD_WATCHER, "arrived"), summary).toBe(true);
  expect(capture.calls).toBe(2);
  // The same submission after eviction commits nothing new.
  await evictDurableObject(stub);
  expect(await snapshot(stub)).toEqual(after);
  expect(await run(stub, ALICE, input, capture)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events);
  expect(capture.calls).toBe(2);
}, 60_000);
