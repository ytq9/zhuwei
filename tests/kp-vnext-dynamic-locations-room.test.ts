import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, handleViewerNarrationRecovery, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions";
import { VNEXT_SEMANTIC_TEMPLATES } from "../app/_runtime/lib/rules/profiles/semantic-templates";
import { dynamicLocationSceneRef } from "../app/_runtime/lib/rules/v2/dynamic-location-shapes";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest, replay as rulesReplay } from "../app/_runtime/lib/rules";

type RecordValue = Record<string, unknown>;
type Principal = { principal: { id: string; sessionVersion: number } };
type Internals = RoomAuthorityCapability & {
  authorityRecoveryCheckpoint?: (name: string) => void;
  beginVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationCompletion): Promise<{ kind: string }>;
  authoritativeReplay(): { state: AuthoritativeWorldState; genesis: RuntimeGenesis; profiles: RuntimeProfileManifest };
  authorityStore: { events(): EventEnvelope[]; pendingDueWork(): RecordValue[] };
  rulesRuntime: { replay: typeof rulesReplay };
  commitDueActivity(root: string): Promise<unknown>;
};
const ALICE = { principal: { id: "principal:location-room:alice", sessionVersion: 1 } };
const BOB = { principal: { id: "principal:location-room:bob", sessionVersion: 1 } };
const ACTOR = "character:location-room:alice", OTHER = "character:location-room:bob", SCENE = "wake";
const SOURCE = "definition:location-room:wall", DESTINATION = "prospective:destination", PASSAGE = "prospective:passage";
const INTERIOR = "地下房间深处放着从外面无法看见的蓝色祭坛";
function record(value: unknown): RecordValue { return value as RecordValue; }
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Capture = { calls: number; prepared: RecordValue[]; narration: RecordValue[]; crashAt?: string };

async function initialize(): Promise<Stub> {
  const stub = env.VNEXT_ROOMS.getByName("vnext-dynamic-location-room");
  const source = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", createDefinitionSnapshot(SOURCE, "1", {
    sceneRef: SCENE, label: "壁龛", description: "旧墙上有一个可以检查的壁龛。", observableState: "present", affordances: ["inspect"], mechanicDefinitionRefs: [] }));
  const character = (id: string, principal: Principal) => ({ characterId: id, controllerPrincipalId: principal.principal.id,
    staticCard: { name: id, sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
      scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
      resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } });
  expect(await stub.initializeAuthoritative({ roomId: "vnext-dynamic-location-room", moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }, { principalId: BOB.principal.id, role: "player" }],
    characters: [character(ACTOR, ALICE), character(OTHER, BOB)],
    vNextSeed: { semanticDefinitions: [source], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never)).toMatchObject({ created: true });
  return stub;
}

// Creating a location or passage authors the world and takes no time; setting off through one is an act.
const actDuration = (proposals: unknown[]) => proposals.some((entry) => (entry as { kind?: string }).kind === "worldInteraction") ? "300000000" : "0";
function bundle(proposals: unknown[]) { return { mode: "adjudication", basisRefs: [SOURCE], terminal: null,
  adjudication: { kind: "directSuccess", durationMicros: actDuration(proposals), risk: "当前行为无需检定。", successOutcome: "按已声明的环境和行为固化。" }, proposals }; }
function creation() {
  const template = (kind: "location" | "passage") => ({ templateRef: VNEXT_SEMANTIC_TEMPLATES[kind].templateRef,
    templateHash: VNEXT_SEMANTIC_TEMPLATES[kind].templateHash });
  const common = { kind: "materializeObject", basisRefs: [SOURCE], outcomeBinding: "always", visibilityPolicyRef: "visibility:scene-observers" };
  const definition = { sceneRef: SCENE, visibilityFactId: null, observableState: null, affordances: null, mechanicDefinitionRefs: [] };
  const geometry = { schema: "zhuwei.tactical-geometry/v1", unit: "inch", boundary: { kind: "polygon", points: [
    { x: "0", y: "0" }, { x: "600", y: "0" }, { x: "600", y: "600" }, { x: "0", y: "600" }] },
    spawnPoints: [{ x: "100", y: "100", elevation: "0" }, { x: "200", y: "100", elevation: "0" }],
    obstacles: [{ featureId: "feature:underground:altar", kind: "interactable", label: "石台", state: "present",
      polygon: [{ x: "400", y: "400" }, { x: "450", y: "400" }, { x: "450", y: "450" }, { x: "400", y: "450" }],
      elevation: "0", height: "20", opaque: false, impassable: true, cover: "none", propagation: "passes", visibilityPolicyId: "visibility:scene-observers" }], clearanceZones: [] };
  return bundle([
    { ...common, semanticKind: "location", ...template("location"), consumes: [],
      produces: [{ handle: DESTINATION, kind: "semanticDefinition", outcomeBinding: "always" }],
      definition: { ...definition, label: "地下房间", description: INTERIOR, geometry }, summary: "固化尚未进入的目的地。" },
    { ...common, semanticKind: "passage", ...template("passage"),
      consumes: [{ kind: "existing", ref: SCENE }, { kind: "prospective", handle: DESTINATION }],
      produces: [{ handle: PASSAGE, kind: "semanticDefinition", outcomeBinding: "always" }],
      definition: { ...definition, label: "石阶入口", description: "壁龛旁出现向下延伸的石阶。", observableState: "open",
        passage: { fromLocationRef: SCENE, toLocationRef: DESTINATION, bidirectional: true, traversal: "沿石阶步行", travelDurationMicros: "60000000" } },
      summary: "发现石阶入口，尚未沿入口移动。" },
  ]);
}
function traversal(passageRef: string) {
  return { ...bundle([{ kind: "worldInteraction", basisRefs: [passageRef], consumes: [{ kind: "existing", ref: passageRef }],
    produces: [], outcomeBinding: "always", sceneRef: SCENE, targetRefs: [passageRef], directTargetRefs: [passageRef], instrumentRefs: [], abilityRef: null,
    intent: "沿刚发现的石阶向下走。", method: "步行穿过开放的通道。", branches: { success: {
      outcomeCode: "outcome:travel-started", summary: "开始沿石阶行走，尚未到达目的地。",
      effects: [{ kind: "traversePassage", passageRef }], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } }]), basisRefs: [passageRef] };
}
function timedAttempt() { return { mode: "terminal", basisRefs: [SOURCE], adjudication: null, proposals: [], terminal: {
  kind: "inWorldRefusal", intent: "花一分钟尝试拆开壁龛上的固定外壳。", method: "检查固定件并尝试徒手拆卸。",
  ruling: { kind: "missingPrerequisite", publicBasis: "一分钟尝试后，确认需要合适的拆卸工具。",
    prerequisites: [{ kind: "tool", ref: "none", description: "拆卸固定件的工具" }], nextActions: [{ description: "准备工具", basisRefs: [SOURCE] }],
    attemptCosts: [{ kind: "fictionTime", durationMicros: "60000000" }] } } }; }

async function run(stub: Stub, principal: Principal, input: RoomActionInput, capture: Capture, response?: unknown, selectedCapabilities: readonly string[] = [], recoveryCapability?: string) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    if (capture.crashAt) target.authorityRecoveryCheckpoint = name => {
      if (capture.crashAt === name) { capture.crashAt = undefined; target.authorityRecoveryCheckpoint = undefined; throw new Error(`interrupted:${name}`); }
    };
    const authority: RoomAuthorityCapability = {
      async prepare(context, action) { const value = await target.prepare(context, action); if (record(value).kind === "prepared") capture.prepared.push(record(value)); return value; },
      commit: target.commit.bind(target), observe: target.observe.bind(target), acknowledge: target.acknowledge.bind(target),
      resumePlayerRandomness: target.resumePlayerRandomness!.bind(target),
      beginViewerNarrationRecovery: target.beginViewerNarrationRecovery!.bind(target),
      publishViewerNarrationRecovery: target.publishViewerNarrationRecovery!.bind(target),
      failViewerNarrationRecovery: target.failViewerNarrationRecovery!.bind(target),
      deliveryPublicationStatus: target.deliveryPublicationStatus!.bind(target),
      beginDeliveryAudiencePublication: target.beginDeliveryAudiencePublication!.bind(target),
      failDeliveryAudiencePublication: target.failDeliveryAudiencePublication!.bind(target), publishDelivery: target.publishDelivery!.bind(target),
    };
    const narrationAdapter = { async narrate(request: RecordValue) {
      capture.narration.push(structuredClone(request));
      const claims = record(request.renderableClaims ?? {}).claims as RecordValue[] | undefined;
      return { body: claims?.filter(claim => claim.kind === "sceneFeature")
        .flatMap(claim => Array.isArray(claim.narrationFacts) ? claim.narrationFacts : []).join("\n") || "当前行动已记录。" };
    },
      async propose() { throw new Error("use vNext strict tools"); }, async decideDueActorPlan() { throw new Error("no NPC plan in this scenario"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(principal, id, request),
      complete: (id, result) => target.completeVNextProposalInvocation(principal, id, result),
    }, proposalBinding: { async run(_model, request) {
      capture.calls++;
      if (response === undefined) throw new Error("a persisted action cannot ask for a second proposal");
      const name = String(record(record((request.tools as RecordValue[])[0]).function).name);
      const value = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME
        ? { requestedCapabilities: selectedCapabilities } : response;
      return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(encodeVNextStrictToolBundle(value)) } }] } }] };
    } } });
    return recoveryCapability === undefined ? handleRoomAction({ principal, authority, kp }, input)
      : handleViewerNarrationRecovery({ principal, authority, kp }, recoveryCapability);
  });
}
async function snapshot(stub: Stub) { return runInDurableObject(stub, instance => {
  const target = instance as unknown as Internals;
  return { state: structuredClone(target.authoritativeReplay().state), events: structuredClone(target.authorityStore.events()), due: structuredClone(target.authorityStore.pendingDueWork()) };
}); }

it("natural language vNext creates a passage, starts travel separately and resumes its due movement once after Room eviction", async () => {
  const stub = await initialize(), capture: Capture = { calls: 0, prepared: [], narration: [] }, before = await snapshot(stub);
  const discover: RoomActionInput = { kind: "intent", submissionId: "submission:location-room:discover", text: "我检查壁龛周围，寻找可以继续探索的入口。" };
  const found = await run(stub, ALICE, discover, capture, creation(), ["materializeObject"]);
  expect(found, JSON.stringify(found)).toMatchObject({ kind: "committed" });
  const created = await snapshot(stub);
  const materialized = created.events.filter(event => event.eventType === "SemanticDefinitionMaterialized").map(event => record(event.payload));
  expect(materialized).toHaveLength(2);
  const locationRef = String(materialized.find(value => value.semanticKind === "location")!.definitionRef);
  const passageRef = String(materialized.find(value => value.semanticKind === "passage")!.definitionRef), sceneId = dynamicLocationSceneRef(locationRef);
  expect(created.state.entities).toEqual(before.state.entities);
  expect(created.state.fictionTimelines).toEqual(before.state.fictionTimelines);
  expect(created.events.some(event => ["CharacterMoved", "ActivityStarted", "FictionTimeAdvanced"].includes(event.eventType))).toBe(false);
  expect(JSON.stringify(await stub.observe(ALICE as never))).not.toContain(INTERIOR);
  expect(capture.calls).toBe(2);
  await evictDurableObject(stub);
  expect(await snapshot(stub)).toEqual(created);
  const travel: RoomActionInput = { kind: "intent", submissionId: "submission:location-room:travel", text: "我沿刚发现的石阶入口向下走。" };
  expect(await run(stub, ALICE, travel, capture, traversal(passageRef), ["worldInteraction"])).toMatchObject({ kind: "committed" });
  const started = await snapshot(stub), activity = Object.values(started.state.campaignRuntime.activities).find(value => value.activityKind === "passageTraversal")!;
  expect(activity.status).toBe("active"); expect(started.state.entities[ACTOR].sceneId).toBe(SCENE);
  // Setting off is an act with its own frozen duration; the travel time itself stays in the Activity.
  const actorTimeline = created.state.multiplayerRuntime.characterTimelineIds[ACTOR] ?? created.state.activeBranchId;
  expect(BigInt(started.state.fictionTimelines[actorTimeline].nowMicros) - BigInt(created.state.fictionTimelines[actorTimeline].nowMicros)).toBe(300000000n);
  expect(JSON.stringify(await stub.observe(ALICE as never))).not.toContain(INTERIOR);
  await evictDurableObject(stub);
  expect(await snapshot(stub)).toEqual(started);
  expect(await run(stub, ALICE, travel, capture)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(started.events); expect(capture.calls).toBe(4);
  capture.crashAt = "afterDueSubmissionBeforeCommit";
  const elapsed: RoomActionInput = { kind: "intent", submissionId: "submission:location-room:elapsed", text: "我留在原地，花一分钟尝试徒手拆开壁龛外壳。" };
  expect(await run(stub, BOB, elapsed, capture, timedAttempt(), ["inWorldRefusal"])).toMatchObject({ kind: "committed" });
  const paused = await snapshot(stub);
  expect(paused.state.entities[ACTOR].sceneId).toBe(SCENE); expect(paused.due).toHaveLength(1);
  expect(paused.state.campaignRuntime.activities[String(activity.activityId)].status).toBe("active");
  await evictDurableObject(stub);
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    expect(await target.commitDueActivity(String(paused.due[0].child_root_action_id))).toMatchObject({ kind: "committed" });
    const { state, genesis } = target.authoritativeReplay();
    const replayed = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replayed.kind).toBe("replayed"); if (replayed.kind === "replayed") expect(replayed.state).toEqual(state);
  });
  const arrived = await snapshot(stub);
  expect(arrived.state.entities[ACTOR].sceneId).toBe(sceneId); expect(arrived.state.entities[OTHER].sceneId).toBe(SCENE);
  const aliceObservation = record(await stub.observe(ALICE as never));
  const recovery = record(aliceObservation.narrationRecovery);
  expect(recovery.kind).toBe("available");
  expect(await run(stub, ALICE, travel, capture, undefined, [], String(recovery.capability))).toMatchObject({ kind: "committed" });
  expect(JSON.stringify(capture.narration.at(-1))).toContain(INTERIOR);
  expect(JSON.stringify(await stub.observe(ALICE as never))).toContain(INTERIOR);
  expect(JSON.stringify(await stub.observe(BOB as never))).not.toContain(INTERIOR);
  const movements = arrived.events.filter(event => event.eventType === "CharacterMoved"); expect(movements).toHaveLength(1);
  expect(movements[0].payload).toMatchObject({ departureMicros: "360000000" /* six seconds to set off, then the minute of travel */, arrivalMicros: "360000000", activityId: activity.activityId });
  expect(arrived.state.campaignRuntime.activities[String(activity.activityId)].status).toBe("completed");
  expect(capture.calls).toBe(6);
  await evictDurableObject(stub);
  expect(await snapshot(stub)).toEqual(arrived);
  expect(await run(stub, BOB, elapsed, capture)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(arrived.events); expect(capture.calls).toBe(6);
}, 30_000);
