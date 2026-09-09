import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../app/_runtime/lib/kp/vnext/model-call-scope";
import { ACTOR_PLAN_DECISION_TOOL_NAME } from "../app/_runtime/lib/kp/actor-plan-policy";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative-types";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { ActorPlanTransportCapability } from "../app/_runtime/lib/room/actor-plan-transport";
import type { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import type { StoryLibraryStore } from "../app/_runtime/lib/room/story-library-store";
import type { AuthoritativeRoomStore } from "../app/_runtime/lib/room/authority-store";
import type { StoryPreparationReady } from "../app/_runtime/lib/room/story-action-context";
import type { StoryFrozenWorldContext } from "../app/_runtime/lib/room/story-world-event-host";
import { WORLD_STORY_SELECTION_TOOL_NAME } from "../app/_runtime/lib/room/story-world-event";
import type { VNextInvocationCompletion, VNextInvocationRequest, VNextInvocationStart } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest } from "../app/_runtime/lib/rules";
import type { VersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime";
import { continueCompoundRoot } from "../app/_runtime/lib/rules/v2/internal-compound";
import { dueActorPlanChildRoot } from "../app/_runtime/lib/rules/v2/actor-plans";
import { characterTimelineId } from "../app/_runtime/lib/rules/v2/timeline";
import { storyReviewBody, storyResponse } from "./fixtures/story-creation.mjs";
import { initialize, draft, bundle, response, record, ALICE, ACTOR, SCENE, LIAN, FACT, PRIVATE, type Json } from "./fixtures/story-action-room";

type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Internals = RoomAuthorityCapability & {
  rulesRuntime: VersionedRulesRuntime;
  authorityStore: AuthoritativeRoomStore;
  storyStore: StoryCreationStore;
  storyLibraryStore: StoryLibraryStore;
  authoritativeReplay(): { state: AuthoritativeWorldState; profiles: RuntimeProfileManifest; genesis: RuntimeGenesis };
  appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void;
  prepare(context: typeof ALICE, input: RoomActionInput, transport?: ActorPlanTransportCapability): ReturnType<RoomAuthorityCapability["prepare"]>;
  commit(context: typeof ALICE, id: string, proposal: Parameters<RoomAuthorityCapability["commit"]>[2], transport?: ActorPlanTransportCapability): ReturnType<RoomAuthorityCapability["commit"]>;
  preparePendingWorldStories(transport: ActorPlanTransportCapability): Promise<void>;
  prepareStoryForAction(context: typeof ALICE, id: string, transport: ActorPlanTransportCapability): Promise<StoryPreparationReady>;
  beginVNextProposalInvocation(context: typeof ALICE, id: string, request: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(context: typeof ALICE, id: string, result: VNextInvocationCompletion): Promise<{ kind: string }>;
};
const PLAN = "actor-plan:world-room:lian", ACTIVITY = "activity:world-room:lian", TRACE = "fact:world-room:lian-trace";
const TRACE_TEXT = "莉安核对后在登记纸边留下了待查的记号。";
const timeInput = (id: string): RoomActionInput => ({ kind: "intent", submissionId: id,
  text: "我花一分钟核对灵堂里现有的登记资料，确认还缺少哪些材料。" });
function timedAttempt() {
  return { mode: "terminal", basisRefs: [SCENE], adjudication: null, proposals: [], terminal: {
    kind: "inWorldRefusal", intent: "花一分钟核对手边登记。", method: "检查现有文件并核对缺项。",
    ruling: { kind: "missingPrerequisite", publicBasis: "一分钟核对后发现仍缺少可供对照的原卷。",
      prerequisites: [{ kind: "knowledge", ref: "none", description: "能够对照的原始记录" }],
      nextActions: [{ description: "寻找原卷", basisRefs: [SCENE] }], attemptCosts: [{ kind: "fictionTime", durationMicros: "60000000" }] },
  } };
}

/** The NPC and its finite knowledge come from the real registered module.
 * Only an already-existing plan is seeded through Rules and Room's append
 * seam; the test does not claim to exercise the creation of NPC plans. */
async function seedPlan(stub: Stub) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { state, profiles, genesis } = target.authoritativeReplay();
    expect(state.entities[LIAN].kind).toBe("npc");
    const premise = Object.keys(state.knowledge[LIAN])[0]; expect(premise).toBeDefined();
    const now = state.fictionTimelines[characterTimelineId(state, LIAN)!].nowMicros, root = "root:world-room:existing-plan";
    const result = target.rulesRuntime.step(profiles, state, continueCompoundRoot({ kind: "formNpcActorPlan", proposalId: root,
      npcId: LIAN, factionRef: null, planId: PLAN, goal: "核对与自己处境有关的登记记录", premiseRefs: [premise],
      nextStep: "核对完手边记录后留下可以继续查证的记号", resourceRefs: [],
      activity: { activityId: ACTIVITY, activityKind: "checkRecords", intendedDurationMicros: "2000000" },
      due: { kind: "fictionTime", atFictionMicros: (BigInt(now) + 2000000n).toString() }, trigger: null,
      trace: { factRef: TRACE, description: TRACE_TEXT, visibilityPolicyRef: "visibility:scene-observers" },
      alternateTarget: { targetRef: SCENE, reason: "现有记录就在该地点" },
    }, root));
    expect(result.kind, JSON.stringify(result)).toBe("committed");
    if (result.kind !== "committed") throw new Error("existing NPC plan did not commit");
    const next = result.state as AuthoritativeWorldState;
    target.authorityStore.transaction(() => target.appendAuthorityTransition(next, result.events));
    const replay = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replay.kind).toBe("replayed");
    if (replay.kind === "replayed") expect(replay.state).toEqual(next);
    return dueActorPlanChildRoot(next.campaignRuntime.npcPlans[PLAN])!;
  });
}

type Capture = { calls: string[]; steps: string[]; requests: { tool: string; input: Json }[];
  selection?: "noStory" | "unknown"; failDraft?: boolean; reuse?: string; error?: string; crashAfterWorldBegin?: boolean;
  callLimit?: string; npcUnknown?: boolean; crashAfterPriorDue?: boolean };
const capture = (): Capture => ({ calls: [], steps: [], requests: [] });
function binding(target: Internals, c: Capture) {
  return { async run(_model: string, input: Json): Promise<unknown> {
    const tool = String(record(record((input.tools as Json[])[0]).function).name);
    c.calls.push(tool); c.steps.push(`model:${tool}`); c.requests.push({ tool, input: structuredClone(input) });
    const message = JSON.parse(String((input.messages as Json[]).find(value => value.role === "user")!.content));
    if (tool === ACTOR_PLAN_DECISION_TOOL_NAME) {
      expect(JSON.stringify(input)).not.toContain(PRIVATE);
      expect(message.actorPlan.npcId).toBe(LIAN);
      if (c.npcUnknown) throw new Error("NPC response lost after dispatch");
      return response(tool, { decision: { decision: "execute", planId: message.actorPlan.planId,
        mechanicalProposal: { kind: "none" }, targetRef: { kind: "none" } } });
    }
    if (tool === WORLD_STORY_SELECTION_TOOL_NAME) {
      expect(message.committedEvents.some((event: Json) => event.eventType === "CanonicalFactDeclared")).toBe(true);
      if (c.selection === "unknown") throw new Error("world selector response lost after dispatch");
      return response(tool, { decision: c.selection === "noStory" ? { kind: "noStory", reason: "这次只是普通核对，现有局势足够。" }
        : { kind: "prepareStory", reason: "实际核对产生了可继续追查的具体差异。",
          selection: { method: "story.method.local-conflict", scale: "short", connection: "local" } } });
    }
    if (tool === "submit_story_preparation") {
      if (c.failDraft) throw new Error("world draft response lost after dispatch");
      try { return storyResponse(draft(message, target.authoritativeReplay().state, false, LIAN), "draft"); }
      catch (error) { c.error = error instanceof Error ? error.stack : String(error); throw error; }
    }
    if (tool === "review_story_preparation") {
      const review = storyReviewBody(message);
      review.findings.forEach(finding => { finding.constraintRefs = [message.preparation.existingFactRefs[0], LIAN]; });
      return storyResponse(review, "review");
    }
    if (tool === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return response(tool, { requestedCapabilities: c.reuse
      ? [`storyReuse:${c.reuse}`, "admitStoryFacts"] : ["inWorldRefusal"] });
    if (tool !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw new Error(`unexpected model stage: ${tool}`);
    if (!c.reuse) return response(tool, encodeVNextStrictToolBundle(timedAttempt()));
    const entries = message.requiredContext.entries as Json[];
    const prepared = record(entries.find(entry => String(entry.entryRef).startsWith("story-preparation:"))!.value);
    return response(tool, encodeVNextStrictToolBundle(bundle([{ kind: "admitStoryFacts", preparationHash: prepared.preparationHash,
      candidateRefs: [FACT], basisRefs: [], consumes: [], produces: [], outcomeBinding: "always", summary: "接入已评审的登记经历与指定人物知情。" }])));
  } };
}

async function run(stub: Stub, input: RoomActionInput, c: Capture) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    const scope = createVNextModelCallScope({ roomId: "story-world-room", limit: c.callLimit, emit() {} });
    const ai = scope.bind(binding(target, c)), transport = new ActorPlanTransportCapability(ai);
    const recovery = target as unknown as { authorityRecoveryCheckpoint?: (name: string) => void };
    recovery.authorityRecoveryCheckpoint = name => {
      if (c.crashAfterPriorDue && name === "afterPriorDueBeforePreparation") {
        c.crashAfterPriorDue = false; throw new Error("interrupted:priorDueCommitted");
      }
    };
    if (c.crashAfterWorldBegin) {
      // Interrupt after the actual durable send permit exists and before the
      // selector transport starts. The journal and its lease are not mocked.
      const host = target as unknown as { beginModelStage(...args: unknown[]): unknown }, begin = host.beginModelStage.bind(target);
      host.beginModelStage = (...args) => {
        const result = begin(...args), external = record(args[1]);
        if (c.crashAfterWorldBegin && external.purpose === "context" && record(result).kind === "ready") {
          c.crashAfterWorldBegin = false; throw new Error("interrupted:worldSelectorStarted");
        }
        return result;
      };
    }
    const authority: RoomAuthorityCapability = {
      prepare: (context, action) => target.prepare(context, action, transport),
      commit: (context, id, proposal) => target.commit(context, id, proposal, transport),
      observe: (...args) => target.observe!(...args), acknowledge: (...args) => target.acknowledge!(...args),
      publishDelivery: (...args) => target.publishDelivery!(...args), deliveryPublicationStatus: (...args) => target.deliveryPublicationStatus!(...args),
      beginDeliveryAudiencePublication: (...args) => target.beginDeliveryAudiencePublication!(...args),
      failDeliveryAudiencePublication: (...args) => target.failDeliveryAudiencePublication!(...args),
      beginViewerNarrationRecovery: (...args) => target.beginViewerNarrationRecovery!(...args),
      publishViewerNarrationRecovery: (...args) => target.publishViewerNarrationRecovery!(...args),
      failViewerNarrationRecovery: (...args) => target.failViewerNarrationRecovery!(...args),
    };
    const kp = createVNextKpAdapter({ proposalBinding: ai,
      narrationAdapter: { async narrate(request: Json) {
        c.steps.push(`narrate:${String(request.rootActionId)}`);
        return { body: "登记核对的结果已经留下，你可以继续选择自己的行动。" };
      } } as AuthoritativeKpAdapter,
      prepareStory: id => target.prepareStoryForAction(ALICE, id, transport),
      journal: { begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, result) => target.completeVNextProposalInvocation(ALICE, id, result) } });
    return handleRoomAction({ principal: ALICE, authority, kp }, input);
  });
}
async function snapshot(stub: Stub, root?: string, submissionId?: string) {
  return runInDurableObject(stub, (instance, context) => {
    const target = instance as unknown as Internals, { state } = target.authoritativeReplay();
    const archived = target.storyStore.archiveSnapshot({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId });
    expect(archived.kind, JSON.stringify(archived)).toBe("available");
    if (archived.kind !== "available") throw new Error("story snapshot unavailable");
    const rows = context.storage.sql.exec<{ context_kind: string; context_json: string }>(
      "SELECT context_kind, context_json FROM authority_story_host_contexts WHERE context_kind IN ('world', 'worldOutcome') ORDER BY prepared_action_id, context_kind").toArray();
    return { state, events: target.authorityStore.events(), due: target.authorityStore.pendingDueWork(),
      work: root ? target.authorityStore.dueWorkByRoot(root) : undefined,
      submission: submissionId ? target.authorityStore.submission(submissionId) : undefined,
      jobs: target.storyStore.listCreationJobs(), library: target.storyLibraryStore.listEntries(), story: archived.snapshot,
      worlds: rows.filter(row => row.context_kind === "world").map(row => JSON.parse(row.context_json) as StoryFrozenWorldContext),
      outcomes: rows.filter(row => row.context_kind === "worldOutcome").map(row => JSON.parse(row.context_json) as Json) };
  });
}
async function exportAndRestore(f: Awaited<ReturnType<typeof initialize>>, suffix: string) {
  const exported = record(await f.stub.exportAuthoritativeArchive(f.capabilities.archiveExport));
  expect(exported, JSON.stringify(exported)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName(`story-world-room:restored:${suffix}`);
  expect(await restored.restoreAuthoritativeArchive(f.capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  const next = record(await restored.exportAuthoritativeArchive(f.capabilities.archiveExport));
  expect(next, JSON.stringify(next)).toMatchObject({ kind: "exported" });
  expect(record(next.archive).events).toEqual(record(exported.archive).events);
  expect(record(next.archive).head).toEqual(record(exported.archive).head);
  expect(record(next.storyArchive).storySnapshot).toEqual(record(exported.storyArchive).storySnapshot);
  expect(record(next.storyArchive).hostBindings).toEqual(record(exported.storyArchive).hostBindings);
  return { restored, exported };
}
async function resumeWorldPreparation(stub: Stub, c: Capture) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    await target.preparePendingWorldStories(new ActorPlanTransportCapability(binding(target, c)));
  });
}

describe("committed world events through the actual Room host", () => {
  it("a new submission resumes an unsent due decision before judging the next local action", async () => {
    const f = await initialize("world-budget-new-action"), root = await seedPlan(f.stub), c = capture();
    c.callLimit = "2"; c.selection = "noStory";
    const first = await run(f.stub, timeInput("submission:world-room:budget-first"), c);
    const paused = await snapshot(f.stub, root);
    expect(first).toMatchObject({ kind: "committed", action: "committed" });
    expect(paused.due).toMatchObject([{ child_root_action_id: root, next_attempt_at: null }]);
    expect(paused.story.invocations.filter(row => row.invocation.purpose === "npc"))
      .toMatchObject([{ invocation: { status: "notSent" } }]);
    expect(c.calls).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
    await evictDurableObject(f.stub);
    c.callLimit = undefined;
    const next = await run(f.stub, timeInput("submission:world-room:budget-next"), c);
    const after = await snapshot(f.stub, root, "submission:world-room:budget-next");
    const evidence = { first: { kind: first.kind, action: record(first).action, deliveryPending: record(first).deliveryPending },
      next: { kind: next.kind, code: record(next).code }, calls: c.calls,
      due: after.due.map(row => ({ root: row.child_root_action_id, next: row.next_attempt_at })),
      npcInvocations: after.story.invocations.filter(row => row.invocation.purpose === "npc").map(row => row.invocation.status),
      planStatus: after.state.campaignRuntime.npcPlans[PLAN].status,
      traceExists: TRACE in after.state.canonicalFacts };
    expect(next, JSON.stringify(evidence)).toMatchObject({ kind: "committed" });
    expect(after.due).toEqual([]);
    expect(after.events.filter(event => event.rootActionId === root && event.eventType === "NpcActionCommitted")).toHaveLength(1);
    expect(after.state.canonicalFacts[TRACE].value).toMatchObject({ description: TRACE_TEXT });
    expect(record(record(next).receipt).rootActionId).toBe("root-action:submission:world-room:budget-next");
    expect(after.work?.cause_root_action_id).toBe(paused.work?.cause_root_action_id);
    expect(after.work?.cause_event_id).toBe(paused.work?.cause_event_id);
    const oldInvocation = paused.story.invocations.find(row => row.invocation.purpose === "npc")!;
    const resumedInvocation = after.story.invocations.find(row => row.invocation.purpose === "npc")!;
    expect(resumedInvocation.invocation.invocationId).toBe(oldInvocation.invocation.invocationId);
    expect(resumedInvocation.externalBinding).toEqual(oldInvocation.externalBinding);
    expect(resumedInvocation.accountIds).toEqual(oldInvocation.accountIds);
    expect(resumedInvocation.invocation.status).toBe("completed");
    expect(c.calls.filter(tool => tool === ACTOR_PLAN_DECISION_TOOL_NAME)).toHaveLength(1);
    expect(c.steps.indexOf(`narrate:${root}`)).toBeGreaterThan(-1);
    expect(c.steps.indexOf(`narrate:${root}`)).toBeLessThan(c.steps.lastIndexOf(`model:${OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME}`));
    const prepared = JSON.parse(after.submission!.prepared_json);
    expect(prepared.requiredContext.binding.rootActionId).toBe("root-action:submission:world-room:budget-next");
    expect(prepared.requiredContext.binding.baseEventSeq).toBe(after.events.filter(event => event.rootActionId === root).at(-1)!.eventSeq);
    expect(after.state.knowledge[LIAN]).toEqual(paused.state.knowledge[LIAN]);
    expect(JSON.stringify(next)).not.toContain(PRIVATE);
  }, 30_000);

  it("the original submission still resumes its unsent due with no second player proposal or clock advance", async () => {
    const f = await initialize("world-budget-original"), root = await seedPlan(f.stub), c = capture();
    c.callLimit = "2"; c.selection = "noStory";
    const input = timeInput("submission:world-room:budget-original"), first = await run(f.stub, input, c);
    const paused = await snapshot(f.stub, root);
    await evictDurableObject(f.stub); c.callLimit = undefined;
    const next = await run(f.stub, input, c), after = await snapshot(f.stub, root);
    expect(next).toMatchObject({ kind: "committed", receipt: record(first).receipt });
    expect(c.calls.filter(tool => tool === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME)).toHaveLength(1);
    expect(c.calls.filter(tool => tool === SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME)).toHaveLength(1);
    expect(c.calls.filter(tool => tool === ACTOR_PLAN_DECISION_TOOL_NAME)).toHaveLength(1);
    expect(after.state.fictionTimelines).toEqual(paused.state.fictionTimelines);
    expect(after.due).toEqual([]);
    expect(after.work?.cause_root_action_id).toBe(paused.work?.cause_root_action_id);
  }, 30_000);

  it("an unknown NPC response blocks a new submission before its model calls and never samples again", async () => {
    const f = await initialize("world-npc-unknown"), root = await seedPlan(f.stub), c = capture();
    c.npcUnknown = true;
    expect(await run(f.stub, timeInput("submission:world-room:unknown-cause"), c)).toMatchObject({ kind: "committed" });
    const saved = await snapshot(f.stub, root), count = c.calls.length;
    expect(saved.story.invocations.find(row => row.invocation.purpose === "npc")!.invocation.status).toBe("unknown");
    await evictDurableObject(f.stub); c.npcUnknown = false;
    const input = timeInput("submission:world-room:unknown-next");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await run(f.stub, input, c);
      expect(result).toMatchObject({ kind: "rejected", action: "notCommitted", code: "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN" });
      expect(record(result).receipt).toBeUndefined();
    }
    const after = await snapshot(f.stub, root);
    expect(c.calls).toHaveLength(count); expect(after.events).toEqual(saved.events);
    expect(after.story.invocations).toEqual(saved.story.invocations);
    expect(after.state.canonicalFacts[TRACE]).toBeUndefined();
  }, 30_000);

  it("eviction after the prior due commits recovers its frozen narration before preparing the untouched new input", async () => {
    const f = await initialize("world-prior-due-crash"), root = await seedPlan(f.stub), c = capture();
    c.callLimit = "2"; c.selection = "noStory";
    await run(f.stub, timeInput("submission:world-room:crash-cause"), c);
    c.callLimit = undefined; c.crashAfterPriorDue = true;
    const nextInput = timeInput("submission:world-room:crash-next");
    expect(await run(f.stub, nextInput, c)).toMatchObject({ action: "notCommitted" });
    const interrupted = await snapshot(f.stub, root);
    expect(interrupted.work?.status).toBe("committed");
    expect(c.steps).not.toContain(`narrate:${root}`);
    expect(interrupted.state.receipts["root-action:submission:world-room:crash-next"]).toBeUndefined();
    await evictDurableObject(f.stub);
    const resumed = await run(f.stub, nextInput, c), after = await snapshot(f.stub, root);
    expect(resumed).toMatchObject({ kind: "committed", receipt: { rootActionId: "root-action:submission:world-room:crash-next" } });
    expect(c.calls.filter(tool => tool === ACTOR_PLAN_DECISION_TOOL_NAME)).toHaveLength(1);
    expect(c.steps.indexOf(`narrate:${root}`)).toBeLessThan(c.steps.lastIndexOf(`model:${OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME}`));
    expect(after.events.filter(event => event.rootActionId === root)).toEqual(interrupted.events.filter(event => event.rootActionId === root));
    expect(after.story.invocations.find(row => row.invocation.purpose === "npc"))
      .toEqual(interrupted.story.invocations.find(row => row.invocation.purpose === "npc"));
  }, 30_000);

  it("a real NPC due prepares a ready library story and the later player reuses it without more author calls", async () => {
    const f = await initialize("world-ready"), root = await seedPlan(f.stub), before = await snapshot(f.stub), c = capture();
    const input = timeInput("submission:world-room:ready"), result = await run(f.stub, input, c), saved = await snapshot(f.stub);
    expect(result, JSON.stringify({ result, calls: c.calls, error: c.error, outcomes: saved.outcomes, due: saved.due })).toMatchObject({ kind: "committed" });
    expect(saved.state.campaignRuntime.npcPlans[PLAN].status).toBe("resolved");
    expect(saved.state.canonicalFacts[TRACE].value).toMatchObject({ description: TRACE_TEXT });
    expect(saved.events.filter(event => event.rootActionId === root && event.eventType === "NpcActionCommitted")).toHaveLength(1);
    expect(saved.worlds).toHaveLength(1); expect(saved.outcomes).toMatchObject([{ kind: "ready" }]);
    expect(saved.worlds[0].trigger).toMatchObject({ actorRef: LIAN, rootActionId: root, source: { kind: "playerAction" } });
    expect(saved.jobs).toHaveLength(1); expect(saved.jobs[0].checkpoint?.status).toBe("ready"); expect(saved.library).toHaveLength(1);
    expect(saved.jobs[0].request.source).toEqual(saved.worlds[0].trigger.source);
    expect(saved.state.knowledge[LIAN]).toEqual(before.state.knowledge[LIAN]);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(c.calls).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
      ACTOR_PLAN_DECISION_TOOL_NAME, WORLD_STORY_SELECTION_TOOL_NAME, "submit_story_preparation", "review_story_preparation"]);
    await evictDurableObject(f.stub);
    expect(await run(f.stub, input, c)).toMatchObject({ kind: "committed" });
    expect((await snapshot(f.stub)).story).toEqual(saved.story); expect(c.calls).toHaveLength(6);
    const { restored } = await exportAndRestore(f, "ready");
    expect((await snapshot(restored)).library).toEqual(saved.library);
    c.reuse = saved.library[0].libraryRef;
    const reused = await run(restored, { kind: "intent", submissionId: "submission:world-room:reuse",
      text: "我想与莉安 lian、瓦罗 varo 一起继续核查已经准备好的登记差异。" }, c);
    expect(reused, JSON.stringify({ reused, calls: c.calls, error: c.error })).toMatchObject({ kind: "committed" });
    expect(c.calls.slice(6)).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
    const admitted = await snapshot(restored);
    expect(admitted.jobs).toHaveLength(1); expect(admitted.library).toEqual(saved.library);
    expect(JSON.stringify(admitted.state.knowledge[LIAN])).toContain(PRIVATE);
    expect(JSON.stringify(admitted.state.knowledge[ACTOR])).not.toContain(PRIVATE);
    expect(JSON.stringify(reused)).not.toContain(PRIVATE);
  }, 45_000);

  for (const mode of ["noStory", "selectorUnknown", "draftUnknown"] as const) {
    it(`${mode} survives eviction and full archive recovery without a second model sample`, async () => {
      const f = await initialize(`world-${mode}`), root = await seedPlan(f.stub), c = capture();
      if (mode === "draftUnknown") c.failDraft = true;
      else c.selection = mode === "noStory" ? "noStory" : "unknown";
      const input = timeInput(`submission:world-room:${mode}`), result = await run(f.stub, input, c), saved = await snapshot(f.stub);
      expect(result, JSON.stringify({ result, calls: c.calls, outcomes: saved.outcomes, due: saved.due })).toMatchObject({ kind: "committed" });
      expect(saved.state.campaignRuntime.npcPlans[PLAN].status).toBe("resolved");
      expect(saved.worlds).toHaveLength(1); expect(saved.worlds[0].trigger.rootActionId).toBe(root);
      expect(saved.library).toHaveLength(0); expect(saved.jobs).toHaveLength(mode === "draftUnknown" ? 1 : 0);
      expect(c.calls).toHaveLength(mode === "draftUnknown" ? 5 : 4);
      expect(saved.outcomes).toMatchObject([mode === "noStory" ? { kind: "noStory" } : { kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" }]);
      const count = c.calls.length;
      await evictDurableObject(f.stub);
      await run(f.stub, input, c);
      expect(c.calls).toHaveLength(count);
      const retried = await snapshot(f.stub); expect(retried.events).toEqual(saved.events); expect(retried.story).toEqual(saved.story);
      const { restored } = await exportAndRestore(f, mode);
      await resumeWorldPreparation(restored, c);
      expect(c.calls).toHaveLength(count);
      const recovered = await snapshot(restored);
      expect(recovered.events).toEqual(saved.events); expect(recovered.library).toHaveLength(0);
      expect(recovered.story).toEqual(saved.story);
    }, 45_000);
  }

  it("an interrupted selector send permit becomes terminal unknown after lease expiry and never resamples", async () => {
    const f = await initialize("world-started-expiry"), root = await seedPlan(f.stub), c = capture();
    c.crashAfterWorldBegin = true;
    await run(f.stub, timeInput("submission:world-room:started-expiry"), c).catch(error => {
      expect(String(error)).toContain("interrupted:worldSelectorStarted");
    });
    const started = await snapshot(f.stub), selector = started.story.invocations.find(row => row.invocation.purpose === "context")!;
    expect(started.worlds).toHaveLength(1); expect(started.worlds[0].trigger.rootActionId).toBe(root);
    expect(started.outcomes).toEqual([]); expect(started.jobs).toEqual([]); expect(started.library).toEqual([]);
    expect(selector.invocation.status).toBe("started"); expect(selector.invocation.response).toBeUndefined();
    expect(c.calls).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, ACTOR_PLAN_DECISION_TOOL_NAME]);
    await evictDurableObject(f.stub);
    await resumeWorldPreparation(f.stub, c);
    expect((await snapshot(f.stub)).story).toEqual(started.story);
    await runInDurableObject(f.stub, (_instance, context) => {
      const now = Date.now();
      context.storage.sql.exec("UPDATE story_creation_invocations SET started_at = ?, lease_until = ? WHERE invocation_id = ?",
        now - 51_000, now - 1_000, selector.invocation.invocationId);
    });
    await evictDurableObject(f.stub);
    await resumeWorldPreparation(f.stub, c);
    const expired = await snapshot(f.stub);
    expect(expired.outcomes).toEqual([{ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" }]);
    expect(expired.story.invocations.find(row => row.invocation.invocationId === selector.invocation.invocationId)!.invocation.status).toBe("unknown");
    expect(expired.story.accounts.some(account => account.kind === "source" && account.held.inputTokens > 0)).toBe(true);
    expect(expired.events).toEqual(started.events); expect(c.calls).toHaveLength(3);
    const { restored } = await exportAndRestore(f, "started-expiry");
    await resumeWorldPreparation(restored, c);
    const recovered = await snapshot(restored);
    expect(recovered.outcomes).toEqual(expired.outcomes); expect(recovered.story).toEqual(expired.story);
    expect(recovered.events).toEqual(expired.events); expect(c.calls).toHaveLength(3);
  }, 45_000);
});
