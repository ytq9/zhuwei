import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import type {
  StoryCheckpoint, StoryContext, StoryHash, StoryModelRequest, StoryPreparation,
  StoryReview, StoryStage, StoryVersionRef,
} from "../app/_runtime/lib/room/story-creation/contracts";
import type {
  OpenStoryJob, StoryBudgetAmount, StoryInvocationIdentity, StoryInvocationReservation,
  ReserveStoryInvocation, StoryAdmissionReceipt,
} from "../app/_runtime/lib/room/story-creation-invocation";

const hash = (value: unknown) => canonicalSha256(value) as StoryHash;
const ref = (id: string): StoryVersionRef => ({ id, version: "1", hash: hash(id) });
const reservation: StoryInvocationReservation = { inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300, elapsedMs: 1_000 };
const limits = (calls = 20): StoryBudgetAmount => ({ calls, inputTokens: 10_000, outputTokens: 10_000,
  estimatedCostMicros: 10_000, elapsedMs: 100_000 });
function fixture(id = "one", sourceId = "root-one"): OpenStoryJob {
  const contextBody: Omit<StoryContext, "contextHash"> = { format: "zhuwei.story-context/v1", runtimeRef: ref("runtime"),
    moduleRef: ref("module"), materials: [{ ref: "private-memory", kind: "fact", availability: "known",
      content: "PRIVATE_STORY_CANARY", subjectRefs: ["npc-one"], basisRefs: [] }], readSet: [],
    timelines: [{ timelineId: "timeline-one", micros: "0" }], supportedCapabilities: ["world-facts"], missingRequiredRefs: [] };
  return { request: { format: "zhuwei.story-request/v1", jobId: `job-${id}`, opportunityId: `opportunity-${id}`,
    source: { roomId: "room-one", runtimeEpochId: "epoch-one", branchId: "branch-one", kind: "playerAction",
      sourceId, budgetAccountId: `source-${sourceId}` },
    trigger: { kind: "developGoal", goal: "Investigate the delayed delivery", basisRefs: ["private-memory"] },
    scale: "short", connection: "local", methods: ["conflict"], scope: { sceneIds: ["harbor"], entityIds: ["npc-one"] },
    recipeRefs: [ref("conflict")], workflowRef: ref("story-workflow"), budgetPolicyRef: ref("budget") },
  context: { ...contextBody, contextHash: hash(contextBody) }, modelRef: ref("model"),
  budget: { policyRef: ref("budget"), roomAccountId: "room-budget", job: limits(4), source: limits(10), room: limits(20) } };
}
const stub = (name: string) => env.ROOMS.getByName(`story-store-${name}`);
type Stub = ReturnType<typeof stub>;
async function withStore<T>(room: Stub, callback: (store: StoryCreationStore, storage: DurableObjectStorage) => T, now = 1_000): Promise<T> {
  return runInDurableObject(room, (_instance, context) => {
    const store = new StoryCreationStore(context.storage, { hash, now: () => now });
    store.ensureSchema();
    return callback(store, context.storage);
  });
}
function modelInput(input: OpenStoryJob, stage: StoryStage = "draft"): ReserveStoryInvocation {
  const request: StoryModelRequest = { jobId: input.request.jobId, stage, requestHash: hash(input.request),
    contextHash: input.context.contextHash, toolName: `submit_${stage}`, schema: { type: "object" },
    messages: [{ role: "system", content: "PRIVATE_STORY_CANARY" }, { role: "user", content: stage }] };
  return { request, providerRequest: { model: input.modelRef.id, messages: [...request.messages], max_tokens: 200 }, reservation };
}
function reserve(store: StoryCreationStore, input: OpenStoryJob, stage: StoryStage = "draft"): StoryInvocationIdentity {
  const result = store.reserveInvocation(modelInput(input, stage));
  expect(result).toMatchObject({ kind: "reserved" });
  if (result.kind !== "reserved") throw new Error("expected reservation");
  return { invocationId: result.invocationId, capability: result.capability };
}
function stageComplete(store: StoryCreationStore, input: OpenStoryJob, stage: StoryStage, response: unknown) {
  const identity = reserve(store, input, stage);
  expect(store.startInvocation(identity)).toMatchObject({ kind: "ready" });
  expect(store.completeInvocation({ ...identity, result: { kind: "completed", response,
    usage: { inputTokens: 40, outputTokens: 50, costMicros: 60 } } })).toEqual({ kind: "saved", eligible: true });
  return identity;
}
function preparation(input: OpenStoryJob, version: "1" | "2" = "1"): StoryPreparation {
  return { format: "zhuwei.story-preparation/v1", jobId: input.request.jobId, version,
    requestHash: hash(input.request), contextHash: input.context.contextHash, recipeRefs: input.request.recipeRefs,
    title: "PRIVATE_STORY_CANARY", cause: "Local shortage", centralQuestion: "Who receives the delivery?",
    worldConnection: "Existing harbor dispute", existingFactRefs: ["private-memory"], facts: [], participants: [],
    definitions: [], opportunities: [], scenes: [], evidence: [], developments: [], resolutions: [], stages: [],
    notApplicable: [], hostingNotes: "Fixture for storage boundaries; quality is evaluated by Story Creation." };
}
function review(input: OpenStoryJob, draft: StoryPreparation, verdict: "pass" | "conflict" = "pass", repairable = false): StoryReview {
  return { format: "zhuwei.story-review/v1", preparationHash: hash(draft), contextHash: input.context.contextHash,
    findings: [{ category: "worldConsistency", verdict, candidatePaths: ["cause"], constraintRefs: ["private-memory"],
      explanation: "PRIVATE_STORY_CANARY", repairable }], recipeCriteria: [] };
}
function checkpoint(input: OpenStoryJob, revision: number, fields: Partial<StoryCheckpoint> = {}): StoryCheckpoint {
  return { format: "zhuwei.story-checkpoint/v1", jobId: input.request.jobId, revision,
    requestHash: hash(input.request), contextHash: input.context.contextHash, status: "preparing", ...fields };
}
function readyJob(store: StoryCreationStore, input: OpenStoryJob) {
  expect(store.openJob(input).kind).toBe("opened");
  const draft = preparation(input), reviewed = review(input, draft);
  stageComplete(store, input, "draft", { draft });
  expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { draft }) }).ok).toBe(true);
  stageComplete(store, input, "review", { reviewed });
  expect(store.checkpoint({ expectedRevision: 1, next: checkpoint(input, 2, { draft, review: reviewed, status: "ready" }) }).ok).toBe(true);
  return draft;
}

it("keeps one opportunity identity and fixed source/room accounts across job aliases and attempted resets", async () => {
  const room = stub("identity"), input = fixture();
  await withStore(room, store => {
    expect(store.openJob(input)).toMatchObject({ kind: "opened", reused: false });
    expect(store.openJob(input)).toMatchObject({ kind: "opened", reused: true });
    const alias = { ...input, request: { ...input.request, jobId: "job-alias" } };
    expect(store.openJob(alias)).toMatchObject({ kind: "opened", reused: true, job: { request: { jobId: input.request.jobId } } });
    expect(store.readJob("job-alias")).toBeUndefined();
    expect(store.openJob({ ...input, request: { ...input.request, trigger: { ...input.request.trigger, goal: "changed" } } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    const next = fixture("two");
    expect(store.openJob({ ...next, request: { ...next.request, source: { ...next.request.source, budgetAccountId: "fresh-source" } } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.openJob({ ...next, budget: { ...next.budget, roomAccountId: "fresh-room" } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.readBudget("fresh-source")).toBeUndefined();
    expect(store.readBudget("fresh-room")).toBeUndefined();
  });
  await evictDurableObject(room);
  expect(await withStore(room, store => store.openJob(input))).toMatchObject({ kind: "opened", reused: true });
});

it("refuses missing context and nonfinite budget policy before storing a job", async () => {
  const room = stub("invalid"), input = fixture();
  await withStore(room, store => {
    const { contextHash: _hash, ...body } = { ...input.context, missingRequiredRefs: ["required"] };
    expect(store.openJob({ ...input, context: { ...body, contextHash: hash(body) } }))
      .toEqual({ kind: "rejected", code: "STORY_CONTEXT_INSUFFICIENT" });
    for (const value of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(store.openJob({ ...input, budget: { ...input.budget, job: { ...input.budget.job, calls: value } } }).kind).toBe("rejected");
    }
    expect(store.isEmpty()).toBe(true);
  });
});

it("reuses a saved response after eviction before checkpoint CAS, with no second dispatch or budget charge", async () => {
  const room = stub("response-recovery"), input = fixture(), draft = preparation(input);
  const saved = await withStore(room, store => {
    store.openJob(input);
    const identity = stageComplete(store, input, "draft", { draft });
    return { identity, usage: store.readJob(input.request.jobId)!.usage };
  });
  await evictDurableObject(room);
  await withStore(room, store => {
    expect(store.reserveInvocation(modelInput(input))).toEqual({ kind: "completed", response: { draft } });
    expect(store.startInvocation(saved.identity)).toEqual({ kind: "completed", response: { draft } });
    expect(store.readJob(input.request.jobId)!.usage).toEqual(saved.usage);
    const next = checkpoint(input, 1, { draft });
    expect(store.checkpoint({ expectedRevision: 0, next })).toEqual({ ok: true, checkpoint: next });
    expect(store.checkpoint({ expectedRevision: 0, next })).toEqual({ ok: true, checkpoint: next });
    expect(store.checkpoint({ expectedRevision: 0, next: { ...next, failureCode: "STORY_PROVIDER_FAILED" } }))
      .toEqual({ ok: false, code: "STORY_CHECKPOINT_CONFLICT" });
    expect(store.reserveInvocation({ ...modelInput(input), providerRequest: { text: "different" } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
  });
});

it("atomically enforces source and room call budgets under concurrent reservations from different jobs", async () => {
  const room = stub("concurrent"), a = fixture("a", "root-a"), b = fixture("b", "root-b");
  const restrictedA = { ...a, budget: { ...a.budget, room: limits(2) } };
  const restrictedB = { ...b, budget: { ...b.budget, room: limits(2) } };
  await withStore(room, store => { expect(store.openJob(restrictedA).kind).toBe("opened"); expect(store.openJob(restrictedB).kind).toBe("opened"); });
  const results = await Promise.all([restrictedA, restrictedB].map(input => withStore(room, store => store.reserveInvocation(modelInput(input)))));
  expect(results.map(result => result.kind)).toEqual(["reserved", "reserved"]);
  await withStore(room, store => {
    const before = store.readBudget(a.request.source.budgetAccountId);
    expect(store.reserveExternalInvocation({ source: a.request.source, roomAccountId: a.budget.roomAccountId,
      invocationKey: "ordinary-call", purpose: "proposal", modelRef: a.modelRef, providerRequest: { message: "ordinary" }, reservation }))
      .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
    expect(store.readBudget(a.request.source.budgetAccountId)).toEqual(before);
    expect(store.readBudget(a.budget.roomAccountId)!.held.calls).toBe(2);
  });
});

it("ordinary proposal and narration reservations share the same persistent source budget with creation", async () => {
  const room = stub("external-source"), input = fixture();
  const budget = { ...input.budget, source: limits(2) };
  await withStore(room, store => {
    expect(store.openBudget({ source: input.request.source, budget }).kind).toBe("opened");
    for (const purpose of ["proposal", "narration"] as const) {
      const result = store.reserveExternalInvocation({ source: input.request.source, roomAccountId: budget.roomAccountId,
        invocationKey: purpose, purpose, modelRef: input.modelRef, providerRequest: { purpose }, reservation });
      expect(result.kind).toBe("reserved");
    }
    expect(store.openJob({ ...input, budget })).toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
    expect(store.readJob(input.request.jobId)).toBeUndefined();
    expect(store.readBudget(input.request.source.budgetAccountId)!.held.calls).toBe(2);
    expect(store.readBudget(`story-job:${input.request.jobId}`)).toBeUndefined();
  });
});

it("each token, estimated amount, and elapsed reservation limit is enforced without partial account writes", async () => {
  for (const field of ["inputTokens", "outputTokens", "estimatedCostMicros", "elapsedMs"] as const) {
    const input = fixture(), room = stub(`dimension-${field}`);
    const budget = { ...input.budget, source: { ...input.budget.source, [field]: reservation[field] } };
    await withStore(room, store => {
      store.openBudget({ source: input.request.source, budget });
      const external = { source: input.request.source, roomAccountId: budget.roomAccountId, purpose: "context" as const,
        modelRef: input.modelRef, providerRequest: { purpose: "context" }, reservation };
      expect(store.reserveExternalInvocation({ ...external, invocationKey: "one" }).kind).toBe("reserved");
      const before = store.readBudget(budget.roomAccountId);
      expect(store.reserveExternalInvocation({ ...external, invocationKey: "two" }))
        .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
      expect(store.readBudget(budget.roomAccountId)).toEqual(before);
    });
  }
});

it("issues a dispatch permit once and preserves unknown usage after lease expiry and eviction", async () => {
  const room = stub("unknown"), input = fixture();
  const identity = await withStore(room, store => { store.openJob(input); const id = reserve(store, input);
    expect(store.startInvocation(id).kind).toBe("ready");
    expect(store.startInvocation(id)).toEqual({ kind: "waiting", code: "STORY_INVOCATION_PENDING" }); return id; });
  await withStore(room, store => {
    expect(store.reserveInvocation(modelInput(input))).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
    expect(store.readInvocation(identity.invocationId)).toMatchObject({ status: "unknown", eligible: true });
    expect(store.readInvocation(identity.invocationId)!.usage).toBeUndefined();
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({ spent: { calls: 1, inputTokens: 0 },
      held: { inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300 } });
  }, 2_100);
  await evictDurableObject(room);
  expect(await withStore(room, store => store.startInvocation(identity), 2_500))
    .toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
});

it("releases only a proven unsent reservation, fences its old permit, and keeps absent completed usage unknown", async () => {
  const room = stub("not-sent"), input = fixture();
  await withStore(room, store => {
    store.openJob(input);
    const first = reserve(store, input);
    expect(store.startInvocation(first).kind).toBe("ready");
    expect(store.completeInvocation({ ...first, result: { kind: "notSent" } })).toEqual({ kind: "saved", eligible: true });
    expect(store.readBudget(input.request.source.budgetAccountId)).toMatchObject({ spent: { calls: 0 }, held: { calls: 0, inputTokens: 0 } });
    const second = reserve(store, input);
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.capability).not.toBe(first.capability);
    expect(store.completeInvocation({ ...first, result: { kind: "completed", response: {} } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.startInvocation(second).kind).toBe("ready");
    expect(store.completeInvocation({ ...second, result: { kind: "completed", response: { text: "original" } } }).kind).toBe("saved");
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({ spent: { calls: 1 }, held: { inputTokens: 100, estimatedCostMicros: 300 } });
    expect(store.completeInvocation({ ...second, result: { kind: "completed", response: { text: "changed" } } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
  });
});

it("a late completed response can settle unknown billing but cannot progress an abandoned checkpoint", async () => {
  const room = stub("late"), input = fixture();
  const identity = await withStore(room, store => { store.openJob(input); const id = reserve(store, input); store.startInvocation(id);
    store.completeInvocation({ ...id, result: { kind: "unknown" } });
    expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { status: "rejected", failureCode: "STORY_CONTEXT_STALE" }) }).ok).toBe(true);
    return id; });
  await evictDurableObject(room);
  await withStore(room, store => {
    expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: { late: true },
      usage: { inputTokens: 60, outputTokens: 70, costMicros: 80 } } })).toEqual({ kind: "saved", eligible: false });
    expect(store.readInvocation(identity.invocationId)).toMatchObject({ status: "completed", eligible: false, response: { late: true } });
    expect(store.reserveInvocation(modelInput(input))).toEqual({ kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" });
    expect(store.readJob(input.request.jobId)!.checkpoint!.status).toBe("rejected");
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({ spent: { calls: 1, inputTokens: 60, estimatedCostMicros: 80 },
      held: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 } });
  }, 1_500);
});

it("requires saved repairable findings for revision and accounts all four workflow calls", async () => {
  const room = stub("four-stages"), input = fixture();
  await withStore(room, store => {
    store.openJob(input);
    expect(store.reserveInvocation(modelInput(input, "revision")))
      .toEqual({ kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" });
    const draft = preparation(input), reviewResult = review(input, draft, "conflict", true);
    stageComplete(store, input, "draft", { draft });
    store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { draft }) });
    stageComplete(store, input, "review", { reviewResult });
    store.checkpoint({ expectedRevision: 1, next: checkpoint(input, 2, { draft, review: reviewResult }) });
    const revisedDraft = preparation(input, "2"), revisedReview = review(input, revisedDraft);
    stageComplete(store, input, "revision", { revisedDraft });
    store.checkpoint({ expectedRevision: 2, next: checkpoint(input, 3, { draft, review: reviewResult, revisedDraft }) });
    stageComplete(store, input, "revisionReview", { revisedReview });
    expect(store.checkpoint({ expectedRevision: 3, next: checkpoint(input, 4, {
      draft, review: reviewResult, revisedDraft, revisedReview, status: "ready" }) }).ok).toBe(true);
    expect(store.readJob(input.request.jobId)!.usage.spent.calls).toBe(4);
    expect(store.readBudget(input.request.source.budgetAccountId)!.spent.calls).toBe(4);
    expect(store.readBudget(input.budget.roomAccountId)!.spent.calls).toBe(4);
    expect(store.reserveInvocation(modelInput(input, "revision"))).toEqual({ kind: "completed", response: { revisedDraft } });
    expect(store.readJob(input.request.jobId)!.usage.spent.calls).toBe(4);
  });
});

it("merges late partial usage with preserved measurements and rejects conflicting billing evidence", async () => {
  const room = stub("partial-late-usage"), input = fixture();
  const identity = await withStore(room, store => {
    store.openJob(input); const id = reserve(store, input); store.startInvocation(id);
    expect(store.completeInvocation({ ...id, result: { kind: "unknown", usage: { inputTokens: 25, costMicros: 77 } } }).kind).toBe("saved");
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({
      spent: { inputTokens: 25, estimatedCostMicros: 77 }, held: { inputTokens: 0, outputTokens: 200, estimatedCostMicros: 0 },
    });
    return id;
  });
  await evictDurableObject(room);
  await withStore(room, store => {
    const before = store.readJob(input.request.jobId)!.usage;
    expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: { complete: true },
      usage: { inputTokens: 26, outputTokens: 40 } } })).toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.readJob(input.request.jobId)!.usage).toEqual(before);
    expect(store.readInvocation(identity.invocationId)!.status).toBe("unknown");
    expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: { complete: true },
      usage: { outputTokens: 40 } } })).toEqual({ kind: "saved", eligible: true });
    expect(store.readInvocation(identity.invocationId)!.usage).toEqual({ inputTokens: 25, outputTokens: 40, costMicros: 77 });
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({ spent: { calls: 1, inputTokens: 25,
      outputTokens: 40, estimatedCostMicros: 77 }, held: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 } });
  }, 1_500);
});

it("passing or unrepairable reviews do not authorize another creative attempt", async () => {
  for (const verdict of ["pass", "conflict"] as const) {
    const input = fixture(), room = stub(`no-revision-${verdict}`);
    await withStore(room, store => {
      store.openJob(input); const draft = preparation(input), reviewed = review(input, draft, verdict, false);
      stageComplete(store, input, "draft", { draft }); store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { draft }) });
      stageComplete(store, input, "review", { reviewed });
      store.checkpoint({ expectedRevision: 1, next: checkpoint(input, 2, { draft, review: reviewed }) });
      const result = store.reserveInvocation(modelInput(input, "revision"));
      expect(result).toEqual({ kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_STORY_CANARY");
      expect(store.readJob(input.request.jobId)!.usage.spent.calls).toBe(2);
    });
  }
});

it("stores actual over-reservation usage honestly and blocks subsequent calls instead of clamping the invoice", async () => {
  const input = fixture(), room = stub("actual-usage");
  await withStore(room, store => {
    store.openJob(input); const identity = reserve(store, input); store.startInvocation(identity);
    expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: {},
      usage: { inputTokens: 20_000, outputTokens: 2, costMicros: 1 } } }).kind).toBe("saved");
    expect(store.readBudget(input.request.source.budgetAccountId)!.spent.inputTokens).toBe(20_000);
    expect(store.reserveExternalInvocation({ source: input.request.source, roomAccountId: input.budget.roomAccountId,
      invocationKey: "next", purpose: "proposal", modelRef: input.modelRef, providerRequest: {}, reservation }))
      .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
  });
});

it("admission references roll back with the outer Room SQLite transaction and remain idempotent", async () => {
  const room = stub("admission"), input = fixture();
  await withStore(room, (store, storage) => {
    const draft = readyJob(store, input);
    const admission: StoryAdmissionReceipt = { jobId: input.request.jobId, preparationHash: hash(draft),
      materialScopeHash: hash(["one-fact"]), preparedActionId: "prepared-one", receiptId: "receipt-one" };
    expect(() => storage.transactionSync(() => {
      expect(store.recordAdmission(admission).kind).toBe("saved");
      throw new Error("injected outer commit failure");
    })).toThrow("injected outer commit failure");
    expect(store.readAdmissions(input.request.jobId)).toEqual([]);
    expect(store.recordAdmission(admission)).toEqual({ kind: "saved", admission });
    expect(store.recordAdmission(admission)).toEqual({ kind: "saved", admission });
    expect(store.recordAdmission({ ...admission, receiptId: "different-receipt" }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM authority_events").one().count).toBe(0);
  });
  await evictDurableObject(room);
  await withStore(room, store => {
    expect(store.readAdmissions(input.request.jobId)).toHaveLength(1);
    expect(store.isEmpty()).toBe(false);
    store.clearForRoomDeletion();
    expect(store.isEmpty()).toBe(true);
  });
});
