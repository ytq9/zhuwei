import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, handleViewerNarrationRecovery, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import { CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions";
import { dueActorPlanChildRoot } from "../app/_runtime/lib/rules/v2/actor-plans";
import { characterTimelineId } from "../app/_runtime/lib/rules/v2/timeline";
import { frozenRenderableClaimsConform } from "../app/_runtime/lib/rules/v2/claims";
import { createVNextModelCallScope } from "../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../app/_runtime/lib/room/actor-plan-transport";
import type { ActorPlanTransport } from "../app/_runtime/lib/room/actor-plan-transport-types";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest, step as rulesStep, replay as rulesReplay } from "../app/_runtime/lib/rules";

type RecordValue = Record<string, unknown>;
type Principal = { principal: { id: string; sessionVersion: number } };
type Invocation = { ordinal: number; status: string; request_json: string; response_json: string | null; request_hash: string; repair_ticket_json: string | null; context_hash: string; binding_hash: string; lease_until: number };
type Internals = RoomAuthorityCapability & {
  authorityRecoveryCheckpoint?: (name: string) => void;
  authorityRoll(sides: number): number;
  prepare(context: Parameters<RoomAuthorityCapability["prepare"]>[0], input: Parameters<RoomAuthorityCapability["prepare"]>[1], transport?: ActorPlanTransport): ReturnType<RoomAuthorityCapability["prepare"]>;
  commit(context: Parameters<RoomAuthorityCapability["commit"]>[0], id: string, proposal: Parameters<RoomAuthorityCapability["commit"]>[2], transport?: ActorPlanTransport): ReturnType<RoomAuthorityCapability["commit"]>;
  resumePlayerRandomness(context: Parameters<NonNullable<RoomAuthorityCapability["resumePlayerRandomness"]>>[0], id: string, transport?: ActorPlanTransport): ReturnType<NonNullable<RoomAuthorityCapability["resumePlayerRandomness"]>>;
  beginVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(principal: Principal, id: string, input: VNextInvocationCompletion): Promise<{ kind: string }>;
  authoritativeReplay(): { state: AuthoritativeWorldState; genesis: RuntimeGenesis; profiles: RuntimeProfileManifest };
  appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void;
  authorityStore: { transaction<T>(fn: () => T): T; events(): EventEnvelope[]; pendingDueWork(): RecordValue[];
    dueWorkByRoot(root: string): RecordValue | undefined; vnextInvocation(root: string, ordinal: number): Invocation | undefined };
  rulesRuntime: { step: typeof rulesStep; replay: typeof rulesReplay };
  commitDueActivity(root: string, transport?: ActorPlanTransport): Promise<unknown>;
};
const ALICE: Principal = { principal: { id: "principal:vnext-plan:alice", sessionVersion: 1 } };
const BOB: Principal = { principal: { id: "principal:vnext-plan:bob", sessionVersion: 1 } };
const ACTOR = "character:vnext-plan:alice", NPC = "npc:vnext-plan:watcher", SCENE = "wake";
const SOURCE = "definition:vnext-plan:control", PREMISE = "knowledge:vnext-plan:npc-order";
const PRIVATE_REF = "knowledge:vnext-plan:player-private", PRIVATE = "PLAYER_PRIVATE_ROUTE_CANARY";
const DESCRIPTION = "门框上多了一条刚系好的蓝色布带。";
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Capture = { playerRequests: RecordValue[]; actorRequests: RecordValue[]; narration: RecordValue[];
  actorCalls: Record<string, number>; draws: number; crashAt?: string; decision?: RecordValue; failActor?: boolean;
  selectedCapabilities?: readonly string[]; callLimit?: string; countNarrationCalls?: boolean; httpCalls: string[][];
  proposalArguments?: (request: RecordValue) => unknown; preparedActionId?: string;
  invocationRequests: VNextInvocationRequest[]; invocationStarts: VNextInvocationStart[] };
const capture = (): Capture => ({ playerRequests: [], actorRequests: [], narration: [], actorCalls: {}, draws: 0, httpCalls: [], invocationRequests: [], invocationStarts: [] });
function record(value: unknown): RecordValue { return value as RecordValue; }

async function initialize(name: string, mechanicalNpc = false, knowledgeNpc = NPC): Promise<Stub> {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const feature = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", createDefinitionSnapshot(SOURCE, "1", {
    sceneRef: SCENE, label: "固定外壳", description: "一件需要合适工具才能拆开的固定外壳。", observableState: "closed", affordances: ["inspect"], mechanicDefinitionRefs: [] }));
  const character = (characterId: string, principal: Principal) => ({ characterId, controllerPrincipalId: principal.principal.id,
      staticCard: { name: characterId === NPC ? "值班人" : "阿莱莎", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } });
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }, ...(mechanicalNpc ? [{ principalId: BOB.principal.id, role: "player" }] : [])],
    characters: [character(ACTOR, ALICE), ...(mechanicalNpc ? [character(NPC, BOB)] : [])],
    fixtureFacts: [{ knowledgeRef: PREMISE, holderEntityId: knowledgeNpc, holderName: "值班人", sceneId: SCENE, content: "NPC_PRIVATE_ORDER_CANARY：交接后系上蓝色布带。" },
      { knowledgeRef: PRIVATE_REF, holderEntityId: ACTOR, content: PRIVATE }],
    vNextSeed: { semanticDefinitions: [feature], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never)).toMatchObject({ created: true });
  if (mechanicalNpc) await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { profiles, state } = target.authoritativeReplay();
    const retired = target.rulesRuntime.step(profiles, state, { kind: "retireCharacter", proposalId: "root:fixture:retire-npc",
      characterId: NPC, reason: "交还角色控制权后留在世界中", continueAsNpc: true });
    expect(retired.kind, JSON.stringify(retired)).toBe("committed");
    if (retired.kind !== "committed") throw new Error("mechanical NPC fixture did not retire");
    target.authorityStore.transaction(() => target.appendAuthorityTransition(retired.state as AuthoritativeWorldState, retired.events));
  });
  return stub;
}

function install(target: Internals, c: Capture) {
  target.authorityRecoveryCheckpoint = name => {
    if (c.crashAt === name) { c.crashAt = undefined; throw new Error(`interrupted:${name}`); }
  };
  target.authorityRoll = () => { c.draws += 1; return 12; };
}
function actorBinding(c: Capture): AuthoritativeModelBinding { return { async run(_model, input) {
    const userMessage = (input.messages as RecordValue[]).find(message => message.role === "user")!;
    const plan = JSON.parse(String(userMessage.content)).actorPlan as RecordValue;
    const root = dueActorPlanChildRoot(plan)!;
    c.actorCalls[root] = (c.actorCalls[root] ?? 0) + 1;
    expect(c.actorCalls[root], "a saved ActorPlan response must never be sampled again").toBe(1);
    c.actorRequests.push(structuredClone(input));
    expect(JSON.stringify(input)).not.toContain(PRIVATE);
    expect(JSON.stringify(input)).not.toContain(PRIVATE_REF);
    if (c.failActor) throw new Error("the ActorPlan provider response was lost after dispatch");
    const name = String(record(record((input.tools as RecordValue[])[0]).function).name);
    return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify({ decision: c.decision ?? {
      decision: "execute", planId: plan.planId, mechanicalProposal: { kind: "none" }, targetRef: { kind: "none" },
    } }) } }] } }] };
  } }; }

const timeInput = (id: string): RoomActionInput => ({ kind: "intent", submissionId: id, text: "我等候两秒并留意值班人。" });
async function run(stub: Stub, input: RoomActionInput, c: Capture, response?: unknown, recoveryCapability?: string) {
  await runInDurableObject(stub, instance => install(instance as unknown as Internals, c));
  const execute = async (target: Internals) => {
    const scope = createVNextModelCallScope({ roomId: "actor-plan-room-test", limit: c.callLimit, emit() {} });
    const calls: string[] = []; c.httpCalls.push(calls);
    const bind = (stage: string, binding: AuthoritativeModelBinding) => scope.bind({
      async run(model, request, options) { calls.push(stage); return binding.run(model, request, options); },
    });
    const transport = new ActorPlanTransportCapability(bind("actorPlan", actorBinding(c)));
    const authority: RoomAuthorityCapability = { prepare: (context, action) => target.prepare(context, action, transport),
      commit: (context, id, proposal) => target.commit(context, id, proposal, transport),
      observe: (...args) => target.observe!(...args), acknowledge: (...args) => target.acknowledge!(...args),
      resumePlayerRandomness: (context, id) => target.resumePlayerRandomness(context, id, transport),
      beginViewerNarrationRecovery: (...args) => target.beginViewerNarrationRecovery!(...args), publishViewerNarrationRecovery: (...args) => target.publishViewerNarrationRecovery!(...args),
      failViewerNarrationRecovery: (...args) => target.failViewerNarrationRecovery!(...args), deliveryPublicationStatus: (...args) => target.deliveryPublicationStatus!(...args),
      beginDeliveryAudiencePublication: (...args) => target.beginDeliveryAudiencePublication!(...args), failDeliveryAudiencePublication: (...args) => target.failDeliveryAudiencePublication!(...args),
      publishDelivery: (...args) => target.publishDelivery!(...args) };
    const narrationAdapter = { async narrate(request: RecordValue) { c.narration.push(structuredClone(request));
      // Represent the existing two provider stages while exercising their real
      // shared HTTP budget and durable Room publication/recovery boundaries.
      if (c.countNarrationCalls) for (const stage of ["narration", "audit"]) {
        await bind(stage, { async run() { return {}; } }).run("test-narration", { rootActionId: request.rootActionId });
      }
      const claims = record(request.renderableClaims ?? {}).claims as RecordValue[] | undefined;
      return { body: claims?.flatMap(claim => Array.isArray(claim.narrationFacts) ? claim.narrationFacts : typeof claim.description === "string" ? [claim.description] : []).join("\n") || "当前行动已记录。" };
    }, async propose() { throw new Error("the vNext proposal transport owns player proposals"); },
      async decideDueActorPlan() { throw new Error("the durable ActorPlan invocation owns NPC decisions"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      async begin(id, request) {
        c.preparedActionId = id; c.invocationRequests.push(structuredClone(request));
        const result = await target.beginVNextProposalInvocation(ALICE, id, request);
        c.invocationStarts.push(structuredClone(result)); return result;
      },
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: bind("proposal", { async run(_model, request) {
      c.playerRequests.push(structuredClone(request));
      if (response === undefined && c.proposalArguments === undefined) throw new Error("a durable player proposal must be reused");
      const name = String(record(record((request.tools as RecordValue[])[0]).function).name);
      const argumentsValue = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME && c.selectedCapabilities
        ? JSON.stringify({ requestedCapabilities: c.selectedCapabilities })
        : c.proposalArguments === undefined ? JSON.stringify(encodeVNextStrictToolBundle(response)) : c.proposalArguments(request);
      return { choices: [{ message: { tool_calls: [{ type: "function", function: { name,
        arguments: argumentsValue } }] } }] };
    } }) });
    return recoveryCapability === undefined
      ? handleRoomAction({ principal: ALICE, authority, kp }, input)
      : handleViewerNarrationRecovery({ principal: ALICE, authority, kp }, recoveryCapability);
  };
  return execute(stub as unknown as Internals);
}
async function snapshot(stub: Stub, root?: string) { return runInDurableObject(stub, instance => {
  const target = instance as unknown as Internals;
  return { state: structuredClone(target.authoritativeReplay().state), events: structuredClone(target.authorityStore.events()),
    due: structuredClone(target.authorityStore.pendingDueWork()), work: root ? structuredClone(target.authorityStore.dueWorkByRoot(root)) : undefined,
    invocations: root ? [1, 2, 3].map(i => target.authorityStore.vnextInvocation(root, i)).filter(Boolean).map(row => structuredClone(row!)) : [] };
}); }

function formation(premiseRefs = [NPC]) { return { decision: { kind: "directSuccess", duration: "none",
  risk: "这一步只形成私有计划。", successOutcome: "记录计划，后续行为尚未执行。" }, steps: [{ kind: "formActorPlan", npcRef: NPC,
    factionRef: { kind: "none" }, goal: "NPC_PRIVATE_GOAL_CANARY", nextStep: "在门框系上蓝色布带。", premiseRefs,
    resourceRefs: [], durationMicros: "2000000", traceDescription: DESCRIPTION,
    alternateTargetRef: SCENE, alternateReason: "NPC_PRIVATE_ALTERNATE_CANARY", outcomeBinding: "always" }], results: [] }; }
const formationInput = (id: string): RoomActionInput => ({ kind: "intent", submissionId: id, text: "我与值班人做一次简短交接。" });

it("NPC source choices cross the real Room journal and replay once, while a wrapper reference has no effects or repair", async () => {
  const npc = "npc:black-oak-will:lian";
  for (const allowed of [true, false]) {
    const stub = await initialize(`social-source-room-${allowed}`, false, npc), c = capture();
    c.callLimit = "2"; c.selectedCapabilities = ["social"];
    const before = await snapshot(stub), input: RoomActionInput = { kind: "intent", submissionId: `submission:social-source:${allowed}`,
      text: "我问莉安：交接安排是什么？" };
    let frozenUserContent: string | undefined;
    let ownRefs: string[] | undefined;
    let contextDiagnostics: unknown;
    c.proposalArguments = request => {
      const content = String(record((request.messages as RecordValue[])[1]).content);
      frozenUserContent = content;
      const context = record(JSON.parse(content).requiredContext);
      const choices = record(context.references).npcSourceChoices as { npcRef: string; refs: string[] }[];
      contextDiagnostics = { choices, entries: (context.entries as RecordValue[]).filter(entry => String(entry.entryRef).includes("npc"))
        .map(entry => ({ entryRef: entry.entryRef, kind: entry.kind, reason: entry.reason })) };
      ownRefs = choices.find(value => value.npcRef === npc)?.refs;
      return JSON.stringify({ decision: { kind: "directSuccess", duration: "5min", risk: "这是普通交谈。", successOutcome: "值班人作出回答。" },
        steps: [{ kind: "social", basisRefs: [npc], sceneRef: SCENE, npcRef: npc, addressedThreadRef: { kind: "none" },
          goal: "说明目前的交接安排。", method: "当面回应。", audience: "participants", retryChange: { kind: "none" }, outcomeBinding: "always" }],
        results: [{ kind: "social", step: 0, branch: "result", outcomeCode: "outcome:answered", summary: "值班人给出了自己的说法。", responseKind: "speech",
          responseText: "我没听说过交接安排。", responseMotive: "明知安排但故意隐瞒。", responseBasis: [allowed ? ownRefs?.find(ref => ref === `knowledge:${npc}:${PREMISE}`) : `npc-decision:${npc}`],
          relationshipChanges: [], newPromises: [], promiseChanges: [], newDebts: [] }] });
    };
    const outcome = await run(stub, input, c), saved = await snapshot(stub, c.preparedActionId);
    expect(ownRefs, JSON.stringify(contextDiagnostics)).toContain(`knowledge:${npc}:${PREMISE}`);
    expect(ownRefs).not.toContain(`npc-decision:${npc}`);
    expect(ownRefs).not.toContain(`knowledge:${ACTOR}:${PRIVATE_REF}`);
    expect(c.playerRequests).toHaveLength(2); expect(c.httpCalls[0]).toEqual(["proposal", "proposal"]);
    expect(record((c.playerRequests[0].messages as RecordValue[])[1]).content).toBe(frozenUserContent);
    expect(c.draws).toBe(0); expect(saved.state.canonicalFacts).toEqual(before.state.canonicalFacts);
    if (allowed) {
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "committed" });
      const claims = saved.events.filter(event => event.eventType === "SourceClaimCreated");
      expect(claims).toHaveLength(2);
      expect(claims.filter(event => record(event.payload).speakerId === npc)).toHaveLength(1);
      expect(saved.state.knowledge[npc][PREMISE]).toEqual(before.state.knowledge[npc][PREMISE]);
      expect(saved.invocations?.map(row => row.status)).toEqual(["completed", "completed"]);
      c.proposalArguments = undefined;
      await evictDurableObject(stub);
      expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
      expect(c.playerRequests).toHaveLength(2); expect((await snapshot(stub)).events).toEqual(saved.events);
      await runInDurableObject(stub, instance => {
        const target = instance as unknown as Internals, { genesis, state } = target.authoritativeReplay();
        const replay = target.rulesRuntime.replay(genesis, target.authorityStore.events());
        expect(replay.kind).toBe("replayed"); if (replay.kind === "replayed") expect(replay.state).toEqual(state);
      });
    } else {
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID" });
      expect(saved.events).toEqual(before.events);
      expect(JSON.stringify(outcome)).not.toMatch(/NPC_PRIVATE_ORDER_CANARY|PLAYER_PRIVATE_ROUTE_CANARY/);
    }
  }
}, 30_000);

it("real flat proposal forms a private timer without time or effects, then passTime executes once across eviction", async () => {
  const stub = await initialize("formation-to-due-room"), c = capture(); c.callLimit = "5"; c.countNarrationCalls = true; c.selectedCapabilities = ["formActorPlan"];
  const before = await snapshot(stub), input = formationInput("submission:formation-to-due");
  const formed = await run(stub, input, c, formation());
  expect(formed, JSON.stringify(formed)).toMatchObject({ kind: "committed" });
  const saved = await snapshot(stub), plans = Object.values(saved.state.campaignRuntime.npcPlans);
  expect(plans).toHaveLength(1); const plan = plans[0];
  expect(plan).toMatchObject({ npcId: NPC, status: "scheduled", goal: "NPC_PRIVATE_GOAL_CANARY", premiseRefs: [NPC],
    activity: { intendedDurationMicros: "2000000" }, trigger: null });
  expect(saved.state.campaignRuntime.activities[plan.activity.activityId]).toMatchObject({ status: "active", characterId: NPC });
  expect(saved.state.fictionTimelines).toEqual(before.state.fictionTimelines);
  expect(saved.state.entities).toEqual(before.state.entities); expect(saved.state.canonicalFacts).toEqual(before.state.canonicalFacts);
  expect(saved.due).toEqual([]); expect(saved.state.canonicalFacts[plan.trace.factRef]).toBeUndefined();
  expect(c.httpCalls[0]).toEqual(["proposal", "proposal"]); expect(c.actorRequests).toHaveLength(0); expect(c.draws).toBe(0);
  expect(JSON.stringify(await stub.observe(ALICE as never))).not.toMatch(/NPC_PRIVATE_GOAL_CANARY|NPC_PRIVATE_ALTERNATE_CANARY/);
  expect(JSON.stringify(await stub.observe(ALICE as never))).not.toContain(DESCRIPTION);
  await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(saved.events); expect(c.playerRequests).toHaveLength(2);
  c.selectedCapabilities = ["passTime"];
  const wait = timeInput("submission:formation-time"), root = dueActorPlanChildRoot(plan)!;
  expect(await run(stub, wait, c, { decision: { kind: "passTime", durationMicros: "2000000" } })).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub, root);
  expect(after.state.campaignRuntime.npcPlans[plan.planId].status, JSON.stringify(after.work)).toBe("resolved");
  expect(after.state.campaignRuntime.activities[plan.activity.activityId].status).toBe("completed");
  expect(after.state.canonicalFacts[plan.trace.factRef].value).toMatchObject({ description: DESCRIPTION });
  expect(after.events.filter(event => event.eventType === "NpcActionCommitted")).toHaveLength(1);
  expect(after.events.filter(event => event.eventType === "CanonicalFactDeclared" && record(record(event.payload).fact).id === plan.trace.factRef)).toHaveLength(1);
  expect(c.actorRequests).toHaveLength(1); expect(c.draws).toBe(0); expect(c.httpCalls.at(-1)).toEqual(["proposal", "proposal", "actorPlan", "narration", "audit"]);
  expect(JSON.stringify(await stub.observe(ALICE as never))).toContain(DESCRIPTION);
  await evictDurableObject(stub);
  expect(await run(stub, wait, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events); expect(c.actorRequests).toHaveLength(1); expect(c.playerRequests).toHaveLength(4);
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { genesis, state } = target.authoritativeReplay();
    const replay = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replay.kind).toBe("replayed"); if (replay.kind === "replayed") expect(replay.state).toEqual(state);
  });
}, 30_000);

it("held Knowledge enters the same formation path while the player's private premise is refused without repair or effects", async () => {
  for (const allowed of [false, true]) {
    const stub = await initialize(`formation-holder-${allowed}`), c = capture(), before = await snapshot(stub);
    c.selectedCapabilities = ["formActorPlan"];
    const ref = allowed ? `knowledge:${NPC}:${PREMISE}` : `knowledge:${ACTOR}:${PRIVATE_REF}`;
    const outcome = await run(stub, formationInput(`submission:formation-holder:${allowed}`), c, formation([ref]));
    const after = await snapshot(stub);
    if (allowed) {
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "committed" });
      expect(Object.values(after.state.campaignRuntime.npcPlans)[0]).toMatchObject({ premiseRefs: [PREMISE], status: "scheduled" });
      expect(after.state.fictionTimelines).toEqual(before.state.fictionTimelines);
      expect(after.state.canonicalFacts).toEqual(before.state.canonicalFacts);
    } else {
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID" });
      expect(after.events).toEqual(before.events); expect(after.state.campaignRuntime.npcPlans).toEqual({});
      expect(JSON.stringify(outcome)).not.toContain(PRIVATE);
    }
    expect(c.playerRequests).toHaveLength(2); expect(c.actorRequests).toHaveLength(0); expect(c.draws).toBe(0);
  }
}, 30_000);


for (const kind of ["formation", "passTime"] as const) it(`${kind} numeric duration retains the bounded Room repair policy`, async () => {
  const stub = await initialize(`numeric-ticket-${kind}`), c = capture();
  const expectedCalls = kind === "formation" ? 3 : 2;
  c.callLimit = String(expectedCalls); c.selectedCapabilities = kind === "formation" ? ["formActorPlan"] : ["passTime"];
  const before = await snapshot(stub), input = kind === "formation" ? formationInput(`submission:numeric:${kind}`) : timeInput(`submission:numeric:${kind}`);
  const originalArguments = JSON.stringify(kind === "formation" ? formation() : { decision: { kind: "passTime", durationMicros: "2000000" } })
    .replace('"durationMicros":"2000000"', '"durationMicros":2000000');
  const path = kind === "formation" ? ["proposals", 0, "durationMicros"] : ["terminal", "durationMicros"];
  c.proposalArguments = request => {
    const tool = record(record((request.tools as RecordValue[])[0]).function).name;
    if (tool !== CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return originalArguments;
    const prompt = JSON.parse(String(record((request.messages as RecordValue[])[1]).content));
    expect(prompt.originalArguments).toBe(originalArguments); expect(prompt.argumentSource).toBe("rawString");
    expect(prompt.summaryPaths).toEqual([]); expect(prompt.allowedPaths).toEqual([path]);
    expect(prompt.repairPlan).toEqual([{ path, operation: "replace", value: "2000000", reason: "exact-integer-token-to-string" }]);
    expect(prompt.diagnostics.some((detail: RecordValue) => detail.code === "TYPE_MISMATCH" && record(detail.repair).allowed === true)).toBe(true);
    return JSON.stringify({ confirm: "server-plan", summaries: [] });
  };
  const result = await run(stub, input, c);
  if (kind === "passTime") {
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "needsKp", code: "PROPOSAL_REPAIR_EXHAUSTED", action: "notCommitted" });
    const saved = await snapshot(stub, c.preparedActionId);
    expect(c.playerRequests).toHaveLength(2); expect(c.httpCalls[0]).toEqual(["proposal", "proposal"]);
    expect(saved.events).toEqual(before.events); expect(saved.state).toEqual(before.state);
    expect(saved.invocations.every(row => row.repair_ticket_json === null)).toBe(true);
    await evictDurableObject(stub);
    c.proposalArguments = () => { throw new Error("the saved terminal budget failure must not resample"); };
    expect(await run(stub, input, c)).toEqual(result); expect(c.playerRequests).toHaveLength(2);
    return;
  }
  expect(result, JSON.stringify({ result, starts: c.invocationStarts.map(start => ({ kind: start.kind, ...("code" in start ? { code: start.code } : {}) })) })).toMatchObject({ kind: "committed" });
  expect(c.invocationStarts).toMatchObject(Array.from({ length: expectedCalls }, () => ({ kind: "ready" })));
  expect(c.playerRequests).toHaveLength(expectedCalls); expect(c.httpCalls[0]).toEqual(Array(expectedCalls).fill("proposal"));
  const saved = await snapshot(stub, c.preparedActionId);
  expect(saved.invocations).toHaveLength(expectedCalls); expect(saved.invocations.every(row => row.status === "completed")).toBe(true);
  const ticket = JSON.parse(saved.invocations[expectedCalls - 1].repair_ticket_json!);
  expect(ticket.argumentSource).toBe("rawString"); expect(ticket.originalArguments).toBe(originalArguments);
  expect(ticket.diagnostics).toEqual(c.invocationRequests[expectedCalls - 1].repairTicket!.diagnostics);
  expect(ticket.allowedPaths).toEqual([path]);
  expect(ticket.draft.proposals[0].durationMicros).toBe(2000000);
  const plan = Object.values(saved.state.campaignRuntime.npcPlans)[0];
  expect(plan.activity.intendedDurationMicros).toBe("2000000");
  expect(saved.state.fictionTimelines).toEqual(before.state.fictionTimelines);
  expect(saved.state.canonicalFacts).toEqual(before.state.canonicalFacts);
  expect(saved.state.entities).toEqual(before.state.entities); expect(c.actorRequests).toHaveLength(0); expect(c.draws).toBe(0);
  await evictDurableObject(stub);
  c.proposalArguments = () => { throw new Error("both completed provider stages must be replayed after eviction"); };
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(saved.events); expect(c.playerRequests).toHaveLength(expectedCalls);
}, 30_000);

it("numeric repair refuses decoded objects, exponent and rounded tokens at the real Room before another invocation or effects", async () => {
  for (const kind of ["formation", "passTime"] as const) for (const token of ["decodedObject", "2e6", "60000000.000000001"]) {
    const stub = await initialize(`unsafe-numeric-ticket-${kind}-${token}`), c = capture(); c.callLimit = "2";
    const expectedCalls = 2;
    c.selectedCapabilities = kind === "formation" ? ["formActorPlan"] : ["passTime"];
    const before = await snapshot(stub), input = kind === "formation" ? formationInput(`submission:unsafe-numeric:${kind}:${token}`) : timeInput(`submission:unsafe-numeric:${kind}:${token}`);
    const source = JSON.stringify(kind === "formation" ? formation() : { decision: { kind: "passTime", durationMicros: "2000000" } })
      .replace('"durationMicros":"2000000"', `"durationMicros":${token === "decodedObject" ? "2000000" : token}`);
    c.proposalArguments = () => token === "decodedObject" ? JSON.parse(source) : source;
    const result = await run(stub, input, c);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "rejected", code: "PROPOSAL_FORM_INVALID", action: "notCommitted" });
    expect(c.playerRequests).toHaveLength(expectedCalls); expect(c.invocationRequests).toHaveLength(expectedCalls);
    const saved = await snapshot(stub, c.preparedActionId); expect(saved.invocations).toHaveLength(expectedCalls);
    expect(saved.invocations[expectedCalls - 1].repair_ticket_json).toBeNull();
    const stored = JSON.parse(saved.invocations[expectedCalls - 1].response_json!).choices[0].message.tool_calls[0].function.arguments;
    expect(typeof stored).toBe(token === "decodedObject" ? "object" : "string");
    expect(saved.events).toEqual(before.events); expect(saved.state).toEqual(before.state);
    expect(c.actorRequests).toHaveLength(0); expect(c.draws).toBe(0);
  }
}, 30_000);
