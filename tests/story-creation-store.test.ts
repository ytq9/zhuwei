import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import { createStoryAdmissionFixture, NEW_NPC, FACT, KNOWLEDGE } from "./fixtures/kp-vnext-story-materialization.mjs";
import type {
  StoryCheckpoint, StoryContext, StoryHash, StoryModelRequest, StoryPreparation,
  StoryReview, StoryStage, StoryVersionRef,
} from "../app/_runtime/lib/room/story-creation/contracts";
import type {
  OpenStoryJob, StoryBudgetAmount, StoryInvocationIdentity, StoryInvocationReservation,
  ReserveStoryInvocation, StoryAdmissionBindingInput, StoryAdmissionReceipt, StoryStoreArchiveSnapshot, StoryStoreDispatchQuarantine,
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
  context: { ...contextBody, contextHash: hash(contextBody) }, modelRef: ref("model"), stageReservation: reservation,
  budget: { policyRef: ref("budget"), roomAccountId: "room-budget", job: limits(4), source: limits(10), room: limits(20) } };
}
const stub = (name: string) => env.ROOMS.getByName(`story-store-${name}`);
function dispatchQuarantine(snapshot: StoryStoreArchiveSnapshot): StoryStoreDispatchQuarantine {
  return { enforcement: "hostRequiredBeforeRestoreExposure",
    invocationIds: snapshot.invocations.filter(row => ["reserved", "started", "unknown", "notSent"].includes(row.invocation.status))
      .map(row => row.invocation.invocationId), sourceBudgetAccountIds: snapshot.accounts.filter(row => row.kind === "source").map(row => row.accountId) };
}
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
function readyJob(store: StoryCreationStore, input: OpenStoryJob, draft = preparation(input)) {
  expect(store.openJob(input).kind).toBe("opened");
  const reviewed = review(input, draft);
  stageComplete(store, input, "draft", { draft });
  expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { draft }) }).ok).toBe(true);
  stageComplete(store, input, "review", { reviewed });
  expect(store.checkpoint({ expectedRevision: 1, next: checkpoint(input, 2, { draft, review: reviewed, status: "ready" }) }).ok).toBe(true);
  return draft;
}
function admissionDraft(input: OpenStoryJob): StoryPreparation {
  const time = { kind: "at" as const, start: { timelineId: "timeline-one", micros: "0" }, end: null, basisRefs: ["private-memory"] };
  return { ...preparation(input), facts: [{ ref: "candidate-fact", layer: "worldTruth", content: "The cargo was delayed",
    subjectRefs: ["npc-one"], occurrence: time, basisRefs: ["private-memory"], creationBasis: "existingEvidence",
    knowledge: [{ ref: "candidate-knowledge", holderRef: "npc-one", factRef: "candidate-fact", layer: "truth",
      content: "PRIVATE_STORY_CANARY", sourceRef: "private-memory", acquisition: time, explanation: "The witness was present" }] }] };
}
function admissionInput(input: OpenStoryJob, draft: StoryPreparation, selectedMaterialRefs = ["candidate-fact", "candidate-knowledge"]): StoryAdmissionBindingInput {
  return { jobId: input.request.jobId, preparationHash: hash(draft), materialScopeHash: hash(selectedMaterialRefs),
    preparedActionId: "prepared-one", contextHash: input.context.contextHash, selectedMaterialRefs,
    readSet: input.context.readSet, rulesInputHash: hash({ operation: "test-normal-rules-input" }) };
}
function admissionReceipt(binding: StoryAdmissionBindingInput): StoryAdmissionReceipt {
  return { jobId: binding.jobId, preparationHash: binding.preparationHash, materialScopeHash: binding.materialScopeHash,
    preparedActionId: binding.preparedActionId, receiptId: `receipt:${binding.preparedActionId}`, bindingHash: hash(binding),
    recordedAtEventSeq: "1", definitions: [], facts: [{ candidateRef: "candidate-fact", factRef: "fact:actual", recordedByEventId: "event:fact",
      definitionRefs: ["definition:existing-npc"], knowledge: binding.selectedMaterialRefs.includes("candidate-knowledge")
        ? [{ candidateRef: "candidate-knowledge", holderRef: "npc-one", knowledgeRef: "knowledge:actual", recordedByEventId: "event:knowledge" }] : [] }] };
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
    expect(store.openJob({ ...input, stageReservation: { ...reservation, inputTokens: 101 } }))
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

it("marks only successful SQL mutations inside the same transaction and keeps idempotent reads clean", async () => {
  const input = fixture();
  await runInDurableObject(stub("mutation-callback"), (_instance, context) => {
    const storage = context.storage;
    storage.sql.exec("CREATE TABLE story_dirty_test (changes INTEGER NOT NULL); INSERT INTO story_dirty_test VALUES (0)");
    const dirty = () => storage.sql.exec<{ changes: number }>("SELECT changes FROM story_dirty_test").one().changes;
    const onMutation = () => { storage.sql.exec("UPDATE story_dirty_test SET changes = changes + 1"); };
    const store = new StoryCreationStore(storage, { hash, now: () => 1_000, onMutation });
    store.ensureSchema(); store.ensureSchema(); store.clearForRoomDeletion();
    store.readJob(input.request.jobId); store.readBudget(input.budget.roomAccountId); store.exportHistoryMaterials();
    expect(dirty()).toBe(0);
    expect(store.openJob(input).kind).toBe("opened"); expect(dirty()).toBe(1);
    expect(store.openJob(input)).toMatchObject({ kind: "opened", reused: true });
    expect(store.openBudget({ source: input.request.source, budget: input.budget }).kind).toBe("opened");
    expect(dirty()).toBe(1);
    const identity = reserve(store, input); expect(dirty()).toBe(2);
    expect(store.reserveInvocation(modelInput(input))).toMatchObject({ kind: "reserved", ...identity });
    expect(dirty()).toBe(2);
    expect(store.startInvocation(identity).kind).toBe("ready"); expect(dirty()).toBe(3);
    expect(store.startInvocation(identity).kind).toBe("waiting"); expect(dirty()).toBe(3);
    const draft = preparation(input), completion = { ...identity, result: { kind: "completed" as const, response: { draft } } };
    expect(store.completeInvocation(completion).kind).toBe("saved"); expect(dirty()).toBe(4);
    expect(store.completeInvocation(completion).kind).toBe("saved");
    expect(store.reserveInvocation(modelInput(input))).toEqual({ kind: "completed", response: { draft } });
    const next = checkpoint(input, 1, { draft });
    expect(store.checkpoint({ expectedRevision: 0, next }).ok).toBe(true); expect(dirty()).toBe(5);
    expect(store.checkpoint({ expectedRevision: 0, next }).ok).toBe(true);
    expect(store.checkpoint({ expectedRevision: 1, next: { ...next, revision: 9 } }).ok).toBe(false);
    const source = { roomId: input.request.source.roomId, runtimeEpochId: input.request.source.runtimeEpochId };
    expect(store.archiveSnapshot(source).kind).toBe("available"); expect(dirty()).toBe(5);
    const other = fixture("rollback", "root-rollback");
    expect(() => storage.transactionSync(() => {
      expect(store.openJob(other).kind).toBe("opened"); expect(dirty()).toBe(6);
      throw new Error("host write failed after Store mutation");
    })).toThrow("host write failed after Store mutation");
    expect(dirty()).toBe(5); expect(store.readJob(other.request.jobId)).toBeUndefined();
    const failing = new StoryCreationStore(storage, { hash, onMutation() { onMutation(); throw new Error("dirty generation write failed"); } });
    expect(() => failing.openJob(other)).toThrow("dirty generation write failed");
    expect(dirty()).toBe(5); expect(store.readJob(other.request.jobId)).toBeUndefined();
    const archived = store.archiveSnapshot(source);
    if (archived.kind !== "available") throw new Error("expected archive");
    store.clearForRoomDeletion(); expect(dirty()).toBe(6);
    store.clearForRoomDeletion(); expect(dirty()).toBe(6);
    const quarantine = dispatchQuarantine(archived.snapshot);
    expect(store.restoreArchiveSnapshot({ source, snapshot: archived.snapshot, quarantine }).kind).toBe("restored");
    expect(dirty()).toBe(7);
    expect(store.restoreArchiveSnapshot({ source, snapshot: archived.snapshot, quarantine }).kind).toBe("rejected");
    expect(dirty()).toBe(7);
  });
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

it("protects a complete draft and review pair against concurrent jobs and ordinary calls", async () => {
  const room = stub("concurrent"), a = fixture("a", "root-a"), b = fixture("b", "root-b");
  const restrictedA = { ...a, budget: { ...a.budget, room: limits(2) } };
  const restrictedB = { ...b, budget: { ...b.budget, room: limits(2) } };
  const results = await Promise.all([restrictedA, restrictedB].map(input => withStore(room, store => store.openJob(input))));
  expect(results.filter(result => result.kind === "opened")).toHaveLength(1);
  expect(results.filter(result => result.kind === "rejected"))
    .toEqual([{ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" }]);
  const winner = results[0].kind === "opened" ? restrictedA : restrictedB;
  const loser = winner === restrictedA ? restrictedB : restrictedA;
  await evictDurableObject(room);
  await withStore(room, store => {
    const before = store.readBudget(winner.request.source.budgetAccountId);
    expect(store.reserveExternalInvocation({ source: winner.request.source, roomAccountId: winner.budget.roomAccountId,
      invocationKey: "ordinary-call", purpose: "proposal", modelRef: winner.modelRef, providerRequest: { message: "ordinary" }, reservation }))
      .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
    expect(store.readBudget(winner.request.source.budgetAccountId)).toEqual(before);
    expect(store.readBudget(winner.budget.roomAccountId)!.held.calls).toBe(2);
    expect(store.readJob(loser.request.jobId)).toBeUndefined();
    expect(store.readBudget(loser.request.source.budgetAccountId)).toBeUndefined();
    readyJob(store, winner);
    expect(store.readBudget(winner.budget.roomAccountId)).toMatchObject({ spent: { calls: 2 }, held: { calls: 0 } });
  });
});

it("protects both stages in every source and room dimension and releases only actual reservation slack", async () => {
  for (const scope of ["source", "room"] as const) for (const field of ["calls", "inputTokens", "outputTokens", "estimatedCostMicros", "elapsedMs"] as const) {
    const input = fixture("first"), other = fixture("second", scope === "source" ? "root-one" : "root-two");
    const amount = field === "calls" ? 2 : 2 * reservation[field];
    const budget = { ...input.budget, [scope]: { ...input.budget[scope], [field]: amount } };
    const constrained = { ...input, budget }, otherConstrained = { ...other, budget };
    await withStore(stub(`pair-${scope}-${field}`), store => {
      expect(store.openJob(constrained).kind).toBe("opened");
      const before = store.readBudget(budget.roomAccountId);
      expect(store.openJob(otherConstrained)).toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
      expect(store.readBudget(budget.roomAccountId)).toEqual(before);
      const smaller = { inputTokens: 50, outputTokens: 100, estimatedCostMicros: 150, elapsedMs: 500 };
      expect(store.reserveInvocation({ ...modelInput(constrained), reservation: smaller }).kind).toBe("reserved");
      expect(store.readJob(input.request.jobId)!.usage.held).toEqual({ calls: 2, inputTokens: 150,
        outputTokens: 300, estimatedCostMicros: 450, elapsedMs: 1_500 });
      expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(constrained, 1,
        { status: "rejected", failureCode: "STORY_CONTEXT_STALE" }) }).ok).toBe(true);
      expect(store.readBudget(budget.roomAccountId)!.held).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0,
        estimatedCostMicros: 0, elapsedMs: 0 });
      expect(store.openJob(otherConstrained).kind).toBe("opened");
    });
  }
});

it("rejects an unprotected stage upper bound or an unaffordable mandatory pair without partial writes", async () => {
  for (const field of ["inputTokens", "outputTokens", "estimatedCostMicros", "elapsedMs"] as const) {
    const input = fixture(), room = stub(`stage-upper-${field}`);
    await withStore(room, store => {
      const low = { ...input, budget: { ...input.budget, job: { ...input.budget.job, [field]: reservation[field] } } };
      expect(store.openJob(low)).toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
      expect(store.isEmpty()).toBe(true);
      expect(store.openJob(input).kind).toBe("opened");
      const before = store.readJob(input.request.jobId);
      expect(store.reserveInvocation({ ...modelInput(input), reservation: { ...reservation, [field]: reservation[field] + 1 } }))
        .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
      expect(store.readJob(input.request.jobId)).toEqual(before);
    });
  }
});

it("ordinary responses need no creative context or unused creative allowance", async () => {
  const initial = fixture(), room = stub("ordinary-no-story");
  const { contextHash: _hash, ...contextBody } = { ...initial.context, missingRequiredRefs: ["not-needed-for-an-ordinary-response"] };
  const input: OpenStoryJob = { ...initial, request: { ...initial.request,
    trigger: { ...initial.request.trigger, kind: "ordinaryResponse" } },
    context: { ...contextBody, contextHash: hash(contextBody) },
    budget: { ...initial.budget, job: limits(1), source: limits(1), room: limits(1) } };
  await withStore(room, store => {
    expect(store.openBudget({ source: input.request.source, budget: input.budget }).kind).toBe("opened");
    expect(store.reserveExternalInvocation({ source: input.request.source, roomAccountId: input.budget.roomAccountId,
      invocationKey: "ordinary-proposal", purpose: "proposal", modelRef: input.modelRef, providerRequest: {}, reservation }).kind).toBe("reserved");
    const before = store.readBudget(input.budget.roomAccountId);
    expect(store.openJob(input).kind).toBe("opened");
    expect(store.readBudget(input.budget.roomAccountId)).toEqual(before);
    expect(store.readJob(input.request.jobId)!.usage.held.calls).toBe(0);
    expect(store.reserveInvocation(modelInput(input))).toEqual({ kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" });
    expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { status: "noStory" }) }).ok).toBe(true);
    expect(store.readBudget(input.budget.roomAccountId)).toEqual(before);
  });
  await evictDurableObject(room);
  expect(await withStore(room, store => store.openJob(input))).toMatchObject({ kind: "opened", reused: true,
    job: { checkpoint: { status: "noStory" }, usage: { spent: { calls: 0 }, held: { calls: 0 } } } });
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
      held: { calls: 1, inputTokens: 200, outputTokens: 400, estimatedCostMicros: 600 } });
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
    expect(store.readBudget(input.request.source.budgetAccountId)).toMatchObject({ spent: { calls: 0 }, held: { calls: 1, inputTokens: 100 } });
    const second = reserve(store, input);
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.capability).not.toBe(first.capability);
    expect(store.completeInvocation({ ...first, result: { kind: "completed", response: {} } }))
      .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.startInvocation(second).kind).toBe("ready");
    expect(store.completeInvocation({ ...second, result: { kind: "completed", response: { text: "original" } } }).kind).toBe("saved");
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({ spent: { calls: 1 }, held: { inputTokens: 200, estimatedCostMicros: 600 } });
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
  const room = stub("four-stages"), initial = fixture(), input = { ...initial, budget: { ...initial.budget, room: limits(4) } };
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
    const revision = reserve(store, input, "revision");
    expect(store.readBudget(input.budget.roomAccountId)).toMatchObject({ spent: { calls: 2 }, held: { calls: 2 } });
    expect(store.reserveExternalInvocation({ source: input.request.source, roomAccountId: input.budget.roomAccountId,
      invocationKey: "steal-rereview", purpose: "narration", modelRef: input.modelRef, providerRequest: {}, reservation }))
      .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
    expect(store.startInvocation(revision).kind).toBe("ready");
    expect(store.completeInvocation({ ...revision, result: { kind: "completed", response: { revisedDraft },
      usage: { inputTokens: 40, outputTokens: 50, costMicros: 60 } } }).kind).toBe("saved");
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

it("does not start a revision when its mandatory re-review cannot also fit", async () => {
  const room = stub("revision-pair-budget"), initial = fixture();
  const input = { ...initial, budget: { ...initial.budget, room: limits(3) } };
  await withStore(room, store => {
    store.openJob(input);
    const draft = preparation(input), reviewed = review(input, draft, "conflict", true);
    stageComplete(store, input, "draft", { draft });
    store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { draft }) });
    stageComplete(store, input, "review", { reviewed });
    store.checkpoint({ expectedRevision: 1, next: checkpoint(input, 2, { draft, review: reviewed }) });
    const before = store.readJob(input.request.jobId);
    expect(store.reserveInvocation(modelInput(input, "revision")))
      .toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
    expect(store.readJob(input.request.jobId)).toEqual(before);
    expect(store.readBudget(input.budget.roomAccountId)).toMatchObject({ spent: { calls: 2 }, held: { calls: 0 } });
  });
});

it("merges late partial usage with preserved measurements and rejects conflicting billing evidence", async () => {
  const room = stub("partial-late-usage"), input = fixture();
  const identity = await withStore(room, store => {
    store.openJob(input); const id = reserve(store, input); store.startInvocation(id);
    expect(store.completeInvocation({ ...id, result: { kind: "unknown", usage: { inputTokens: 25, costMicros: 77 } } }).kind).toBe("saved");
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({
      spent: { inputTokens: 25, estimatedCostMicros: 77 }, held: { inputTokens: 100, outputTokens: 400, estimatedCostMicros: 300 },
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
      outputTokens: 40, estimatedCostMicros: 77 }, held: { calls: 1, inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300 } });
  }, 1_500);
});

it("supplements completed and failed billing monotonically without moving completion time or replay eligibility", async () => {
  for (const status of ["completed", "failed"] as const) {
    const room = stub(`supplement-${status}`), input = fixture(), response = { text: "exact original response" };
    const identity = await withStore(room, store => {
      store.openJob(input); const id = reserve(store, input); store.startInvocation(id); return id;
    });
    const initialResult = status === "completed" ? { kind: status, response, usage: { inputTokens: 25 } }
      : { kind: status, usage: { inputTokens: 25 } };
    await withStore(room, store => {
      expect(store.completeInvocation({ ...identity, result: initialResult })).toEqual({ kind: "saved", eligible: true });
      if (status === "failed") expect(store.readJob(input.request.jobId)!.usage.held.calls).toBe(0);
      else {
        const draft = preparation(input);
        expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1, { draft }) }).ok).toBe(true);
      }
      expect(store.readJob(input.request.jobId)!.usage.spent.elapsedMs).toBe(50);
    }, 1_050);
    await evictDurableObject(room);
    await withStore(room, store => {
      const outcome = status === "completed" ? { kind: status, response } : { kind: status };
      const before = store.readJob(input.request.jobId), original = store.readInvocation(identity.invocationId);
      expect(store.completeInvocation({ ...identity, result: { ...outcome, usage: { inputTokens: 26, outputTokens: 40 } } }))
        .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
      expect(store.readJob(input.request.jobId)).toEqual(before);
      expect(store.readInvocation(identity.invocationId)).toEqual(original);
      if (status === "completed") {
        expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: { text: "changed" }, usage: { outputTokens: 40 } } }))
          .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
        expect(store.readJob(input.request.jobId)).toEqual(before);
      }
      expect(store.completeInvocation({ ...identity, result: { ...outcome, usage: { outputTokens: 40 } } }))
        .toEqual({ kind: "saved", eligible: true });
      expect(store.completeInvocation({ ...identity, result: { ...outcome, usage: { costMicros: 70 } } }))
        .toEqual({ kind: "saved", eligible: true });
      expect(store.readInvocation(identity.invocationId)).toMatchObject({ eligible: true, completedAt: 1_050,
        usage: { inputTokens: 25, outputTokens: 40, costMicros: 70 } });
      const final = store.readJob(input.request.jobId);
      expect(final!.usage.spent).toEqual({ calls: 1, inputTokens: 25, outputTokens: 40, estimatedCostMicros: 70, elapsedMs: 50 });
      expect(store.completeInvocation({ ...identity, result: initialResult })).toEqual({ kind: "saved", eligible: true });
      expect(store.completeInvocation({ ...identity, result: outcome })).toEqual({ kind: "saved", eligible: true });
      expect(store.readJob(input.request.jobId)).toEqual(final);
    }, 500_000);
  }
});

it("late billing cannot re-enable an abandoned invocation and failure releases the unsent review only", async () => {
  const room = stub("abandoned-billing"), input = fixture();
  const identity = await withStore(room, store => {
    store.openJob(input); const id = reserve(store, input); store.startInvocation(id);
    expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(input, 1,
      { status: "rejected", failureCode: "STORY_CONTEXT_STALE" }) }).ok).toBe(true);
    expect(store.readJob(input.request.jobId)!.usage.held).toEqual({ calls: 0, ...reservation });
    return id;
  });
  await withStore(room, store => {
    expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: { saved: true } } }))
      .toEqual({ kind: "saved", eligible: false });
  }, 1_100);
  await withStore(room, store => {
    expect(store.completeInvocation({ ...identity, result: { kind: "completed", response: { saved: true },
      usage: { inputTokens: 20, outputTokens: 30, costMicros: 40 } } })).toEqual({ kind: "saved", eligible: false });
    expect(store.readInvocation(identity.invocationId)).toMatchObject({ eligible: false, completedAt: 1_100 });
    expect(store.readJob(input.request.jobId)!.usage).toMatchObject({ spent: { calls: 1, elapsedMs: 100 },
      held: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, elapsedMs: 0 } });
    expect(store.startInvocation(identity)).toEqual({ kind: "rejected", code: "STORY_CHECKPOINT_CONFLICT" });
  }, 900_000);
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
    const draft = readyJob(store, input, admissionDraft(input));
    const binding = admissionInput(input, draft), admission = admissionReceipt(binding);
    expect(store.recordAdmission(admission)).toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.prepareAdmission(binding)).toEqual({ kind: "saved", binding: { ...binding, bindingHash: hash(binding) } });
    expect(() => storage.transactionSync(() => {
      expect(store.recordAdmission(admission).kind).toBe("saved");
      throw new Error("injected outer commit failure");
    })).toThrow("injected outer commit failure");
    expect(store.readAdmissions(input.request.jobId)).toEqual([]);
    expect(store.exportHistoryMaterials()).toEqual({ kind: "available", preparations: [], requiredPreparationHashes: [] });
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

it("persists real new-NPC candidate identities and their knowledge holders through eviction without accepting incomplete DTOs", async () => {
  const f = await createStoryAdmissionFixture("store-new-npc", { newNpc: true });
  const defaults = fixture(), input: OpenStoryJob = { ...defaults, request: f.request, context: f.storyContext,
    budget: { ...defaults.budget, policyRef: f.request.budgetPolicyRef } };
  const { bindingHash: _bindingHash, ...binding } = f.binding, room = stub("new-npc-identity");
  await withStore(room, store => {
    readyJob(store, input, f.preparation);
    expect(store.prepareAdmission(binding).kind).toBe("saved");
    for (const mutate of [
      (value: Record<string, unknown>) => { delete value.definitions; },
      (value: Record<string, unknown>) => { value.definitions = []; },
      (value: Record<string, unknown>) => { value.definitions = [...f.admission.definitions, ...f.admission.definitions]; },
      (value: Record<string, unknown>) => { value.facts = f.admission.facts.map(fact => ({ ...fact,
        knowledge: fact.knowledge.map(known => ({ ...known, holderRef: NEW_NPC })) })); },
    ]) {
      const invalid = structuredClone(f.admission); mutate(invalid);
      expect(store.recordAdmission(invalid).kind).toBe("rejected");
      expect(store.readAdmissions(input.request.jobId)).toEqual([]);
    }
    expect(store.recordAdmission(f.admission)).toEqual({ kind: "saved", admission: f.admission });
    expect(store.recordAdmission(f.admission)).toEqual({ kind: "saved", admission: f.admission });
  });
  await evictDurableObject(room);
  await withStore(room, store => {
    expect(store.readAdmissions(input.request.jobId)).toEqual([f.admission]);
    expect(store.exportHistoryMaterials()).toEqual({ kind: "available", requiredPreparationHashes: [f.preparationHash],
      preparations: [{ preparation: f.preparation, preparationHash: f.preparationHash, recordedAtEventSeq: f.admission.recordedAtEventSeq,
        definitions: f.admission.definitions, facts: f.admission.facts }] });
  });
});

it("retains a definition-only admission and rejects a later scope trying to remap that candidate identity", async () => {
  const f = await createStoryAdmissionFixture("store-definition-only", { newNpc: true, definitionOnly: true });
  const defaults = fixture(), input: OpenStoryJob = { ...defaults, request: f.request, context: f.storyContext,
    budget: { ...defaults.budget, policyRef: f.request.budgetPolicyRef } };
  await withStore(stub("definition-only-identity"), store => {
    readyJob(store, input, f.preparation);
    const { bindingHash: _bindingHash, ...binding } = f.binding;
    expect(store.prepareAdmission(binding).kind).toBe("saved");
    expect(store.recordAdmission(f.admission).kind).toBe("saved");
    const original = store.exportHistoryMaterials();
    expect(original).toMatchObject({ kind: "available", preparations: [{ definitions: f.admission.definitions, facts: [] }] });
    const selectedMaterialRefs = [NEW_NPC, FACT, KNOWLEDGE].sort();
    const next = { ...binding, selectedMaterialRefs, materialScopeHash: hash(selectedMaterialRefs),
      preparedActionId: "prepared:forged-remapping", rulesInputHash: hash("forged-new-scope") };
    expect(store.prepareAdmission(next).kind).toBe("saved");
    // This is deliberately fabricated external evidence. Store validates the
    // merged identity closure; only the host can certify actual Rules events.
    const rebound: StoryAdmissionReceipt = { ...f.admission, materialScopeHash: next.materialScopeHash,
      preparedActionId: next.preparedActionId, bindingHash: hash(next), receiptId: "receipt:forged-remapping",
      recordedAtEventSeq: "999", definitions: f.admission.definitions.map(value => ({ ...value,
        authorityRef: "npc:forged-new-identity", recordedByEventId: "event:forged-npc" })),
      facts: [{ candidateRef: FACT, factRef: "fact:forged", recordedByEventId: "event:forged-fact", definitionRefs: [],
        knowledge: [{ candidateRef: KNOWLEDGE, holderRef: "npc:forged-new-identity", knowledgeRef: "knowledge:forged", recordedByEventId: "event:forged-knowledge" }] }] };
    expect(store.recordAdmission(rebound)).toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(store.readAdmissions(input.request.jobId)).toEqual([f.admission]);
    expect(store.exportHistoryMaterials()).toEqual(original);
  });
});

it("freezes the selected material closure, final Rules input and full context dependencies before admission", async () => {
  const initial = fixture(), { contextHash: _hash, ...body } = initial.context;
  const contextBody = { ...body, readSet: [{ kind: "entity" as const, ref: "npc-one", revision: "7", hash: hash("npc-revision-7") }] };
  const input = { ...initial, context: { ...contextBody, contextHash: hash(contextBody) } };
  await withStore(stub("admission-selection"), store => {
    const draft = readyJob(store, input, admissionDraft(input)), first = admissionInput(input, draft, ["candidate-fact"]);
    for (const changed of [
      { ...first, readSet: [] },
      { ...first, selectedMaterialRefs: ["candidate-knowledge"], materialScopeHash: hash(["candidate-knowledge"]) },
      { ...first, selectedMaterialRefs: ["missing"], materialScopeHash: hash(["missing"]) },
      { ...first, selectedMaterialRefs: ["candidate-fact", "candidate-fact"], materialScopeHash: hash(["candidate-fact", "candidate-fact"]) },
    ]) expect(store.prepareAdmission(changed).kind).toBe("rejected");
    expect(store.readAdmissionBinding(first.preparedActionId)).toBeUndefined();
    expect(store.prepareAdmission(first).kind).toBe("saved");
    expect(store.prepareAdmission(first)).toEqual({ kind: "saved", binding: { ...first, bindingHash: hash(first) } });
    expect(store.prepareAdmission({ ...first, rulesInputHash: hash("different-rules") }).kind).toBe("rejected");
    expect(store.prepareAdmission(admissionInput(input, draft)).kind).toBe("rejected");
    const receipt = admissionReceipt(first);
    expect(store.recordAdmission({ ...receipt, facts: [] }).kind).toBe("rejected");
    expect(store.recordAdmission({ ...receipt, bindingHash: hash("different-binding") }).kind).toBe("rejected");
    expect(store.recordAdmission({ ...receipt, facts: admissionReceipt(admissionInput(input, draft)).facts }).kind).toBe("rejected");
    expect(store.recordAdmission(receipt).kind).toBe("saved");
    const exported = store.exportHistoryMaterials();
    expect(exported).toMatchObject({ kind: "available", requiredPreparationHashes: [hash(draft)],
      preparations: [{ preparation: draft, facts: [{ candidateRef: "candidate-fact", knowledge: [] }] }] });
    const second = { ...admissionInput(input, draft), preparedActionId: "prepared-knowledge", rulesInputHash: hash("new-input") };
    expect(store.prepareAdmission(second).kind).toBe("saved");
    const secondReceipt = { ...admissionReceipt(second), recordedAtEventSeq: "3" };
    const wrongHolder = { ...secondReceipt, facts: secondReceipt.facts.map(fact => ({ ...fact,
      knowledge: fact.knowledge.map(knowledge => ({ ...knowledge, holderRef: "unrelated-npc" })) })) };
    expect(store.recordAdmission(wrongHolder).kind).toBe("rejected");
    expect(store.recordAdmission(secondReceipt).kind).toBe("saved");
    expect(store.exportHistoryMaterials()).toMatchObject({ kind: "available", preparations: [{ recordedAtEventSeq: "1",
      facts: [{ candidateRef: "candidate-fact", knowledge: secondReceipt.facts[0].knowledge }] }] });
  });
});

it("does not reinterpret lost admitted preparation or receipt material as an empty history", async () => {
  for (const missing of ["job", "admission"] as const) {
    const input = fixture();
    await withStore(stub(`missing-${missing}`), (store, storage) => {
      const draft = readyJob(store, input, admissionDraft(input)), binding = admissionInput(input, draft);
      expect(store.prepareAdmission(binding).kind).toBe("saved");
      expect(store.recordAdmission(admissionReceipt(binding)).kind).toBe("saved");
      storage.sql.exec(missing === "job" ? "DELETE FROM story_creation_jobs" : "DELETE FROM story_creation_admissions");
      expect(store.exportHistoryMaterials()).toEqual({ kind: "rejected", code: "STORY_CONTEXT_INSUFFICIENT" });
      expect(store.archiveSnapshot({ roomId: input.request.source.roomId, runtimeEpochId: input.request.source.runtimeEpochId }).kind).toBe("rejected");
      store.clearForRoomDeletion();
      expect(store.isEmpty()).toBe(true);
    });
  }
});

it("archives and restores exact same-room operational state without replenishing budgets or making pending sends ready", async () => {
  const input = fixture(), pending = fixture("pending", "root-pending"), room = stub("archive-roundtrip");
  const source = { roomId: input.request.source.roomId, runtimeEpochId: input.request.source.runtimeEpochId };
  const saved = await withStore(room, store => {
    const draft = readyJob(store, input, admissionDraft(input)), binding = admissionInput(input, draft);
    expect(store.prepareAdmission(binding).kind).toBe("saved");
    expect(store.recordAdmission(admissionReceipt(binding)).kind).toBe("saved");
    expect(store.openJob(pending).kind).toBe("opened");
    const started = reserve(store, pending);
    expect(store.startInvocation(started).kind).toBe("ready");
    const unknown = store.reserveExternalInvocation({ source: pending.request.source, roomAccountId: pending.budget.roomAccountId,
      invocationKey: "unknown-npc", purpose: "npc", modelRef: pending.modelRef, providerRequest: { private: "npc-decision" }, reservation });
    if (unknown.kind !== "reserved") throw new Error("expected external reservation");
    store.startInvocation(unknown); store.completeInvocation({ ...unknown, result: { kind: "unknown" } });
    const archived = store.archiveSnapshot(source);
    expect(archived.kind).toBe("available");
    if (archived.kind !== "available") throw new Error("expected archive");
    const quarantine = dispatchQuarantine(archived.snapshot);
    expect(store.restoreArchiveSnapshot({ source, snapshot: archived.snapshot, quarantine }).kind).toBe("rejected");
    return { snapshot: archived.snapshot, quarantine, started, unknown, materials: store.exportHistoryMaterials() };
  });
  await evictDurableObject(room);
  await withStore(room, (store, storage) => {
    expect(store.archiveSnapshot(source)).toEqual({ kind: "available", snapshot: saved.snapshot });
    store.clearForRoomDeletion();
    for (const other of [{ ...source, roomId: "other-room" }, { ...source, runtimeEpochId: "other-epoch" }]) {
      expect(store.restoreArchiveSnapshot({ source: other, snapshot: saved.snapshot, quarantine: saved.quarantine }).kind).toBe("rejected");
      expect(store.isEmpty()).toBe(true);
    }
    const { snapshotHash: _hash, ...body } = saved.snapshot;
    const missing = { ...body, jobs: body.jobs.filter(job => job.input.request.jobId !== input.request.jobId) };
    expect(store.restoreArchiveSnapshot({ source, snapshot: { ...missing, snapshotHash: hash(missing) }, quarantine: saved.quarantine }).kind).toBe("rejected");
    expect(store.isEmpty()).toBe(true);
    const materialMissing = { ...body, admissions: [] };
    expect(store.restoreArchiveSnapshot({ source, snapshot: { ...materialMissing, snapshotHash: hash(materialMissing) }, quarantine: saved.quarantine }))
      .toEqual({ kind: "rejected", code: "STORY_CONTEXT_INSUFFICIENT" });
    expect(store.isEmpty()).toBe(true);
    expect(() => storage.transactionSync(() => {
      expect(store.restoreArchiveSnapshot({ source, snapshot: saved.snapshot, quarantine: saved.quarantine }).kind).toBe("restored");
      throw new Error("outer archive restore interrupted");
    })).toThrow("outer archive restore interrupted");
    expect(store.isEmpty()).toBe(true);
    expect(store.restoreArchiveSnapshot({ source, snapshot: saved.snapshot, quarantine: saved.quarantine }))
      .toEqual({ kind: "restored", snapshotHash: saved.snapshot.snapshotHash });
    expect(store.archiveSnapshot(source)).toEqual({ kind: "available", snapshot: saved.snapshot });
    expect(store.exportHistoryMaterials()).toEqual(saved.materials);
    expect(store.readInvocation(saved.started.invocationId)?.status).toBe("started");
    expect(store.readInvocation(saved.unknown.invocationId)?.status).toBe("unknown");
    expect(store.startInvocation(saved.unknown)).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
    expect(store.startInvocation(saved.started)).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
    expect(store.readBudget(pending.budget.roomAccountId)?.spent.calls).toBe(4);
    expect(storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM authority_events").one().count).toBe(0);
    store.clearForRoomDeletion();
    expect(store.isEmpty()).toBe(true);
  }, 9_000);
});

it("same-room restore fences every pending story stage and its next stage while retaining completed responses", async () => {
  const room = stub("quarantined-story-stages"), finished = fixture("finished", "root-finished");
  const source = { roomId: finished.request.source.roomId, runtimeEpochId: finished.request.source.runtimeEpochId };
  const saved = await withStore(room, store => {
    const draft = preparation(finished);
    store.openJob(finished); const completed = stageComplete(store, finished, "draft", { draft });
    store.checkpoint({ expectedRevision: 0, next: checkpoint(finished, 1, { draft }) });
    const stages = ["reserved", "started", "unknown", "notSent"].map(status => {
      const input = fixture(status, `root-${status}`); store.openJob(input); const identity = reserve(store, input);
      if (status !== "reserved") store.startInvocation(identity);
      if (status === "unknown" || status === "notSent") store.completeInvocation({ ...identity, result: { kind: status } });
      return { input, identity, status };
    });
    const archived = store.archiveSnapshot(source);
    if (archived.kind !== "available") throw new Error("expected archive");
    store.clearForRoomDeletion();
    return { snapshot: archived.snapshot, quarantine: dispatchQuarantine(archived.snapshot), stages, completed, draft };
  });
  await withStore(room, (store, storage) => {
    for (const quarantine of [
      { ...saved.quarantine, invocationIds: saved.quarantine.invocationIds.slice(1) },
      { ...saved.quarantine, sourceBudgetAccountIds: saved.quarantine.sourceBudgetAccountIds.filter(id => id !== finished.request.source.budgetAccountId) },
      { ...saved.quarantine, sourceBudgetAccountIds: [...saved.quarantine.sourceBudgetAccountIds, "unknown-source-account"] },
    ]) {
      expect(store.restoreArchiveSnapshot({ source, snapshot: saved.snapshot, quarantine }).kind).toBe("rejected");
      expect(store.isEmpty()).toBe(true);
    }
    const { snapshotHash: _hash, ...forged } = structuredClone(saved.snapshot);
    const call = forged.invocations.find(row => row.invocation.status === "unknown")!;
    const manipulated = { ...call.held, inputTokens: call.held.inputTokens - 1 };
    Object.assign(call, { held: manipulated });
    for (const account of forged.accounts.filter(row => call.accountIds.includes(row.accountId))) {
      Object.assign(account, { held: { ...account.held, inputTokens: account.held.inputTokens - 1 } });
    }
    expect(store.restoreArchiveSnapshot({ source, snapshot: { ...forged, snapshotHash: hash(forged) }, quarantine: saved.quarantine }).kind).toBe("rejected");
    expect(store.isEmpty()).toBe(true);
    expect(store.restoreArchiveSnapshot({ source, snapshot: saved.snapshot, quarantine: saved.quarantine }).kind).toBe("restored");
    const before = store.archiveSnapshot(source);
    expect(store.startInvocation(saved.completed)).toEqual({ kind: "completed", response: { draft: saved.draft } });
    expect(store.reserveInvocation(modelInput(finished))).toEqual({ kind: "completed", response: { draft: saved.draft } });
    expect(store.reserveInvocation(modelInput(finished, "review"))).toEqual({ kind: "rejected", code: "STORY_INVOCATION_UNKNOWN" });
    const alternate = { ...finished, request: { ...finished.request, jobId: "job-new-key", opportunityId: "opportunity-new-key" } };
    expect(store.openJob(alternate)).toEqual({ kind: "rejected", code: "STORY_INVOCATION_UNKNOWN" });
    expect(store.readJob(alternate.request.jobId)).toBeUndefined();
    for (const stage of saved.stages) {
      expect(store.reserveInvocation(modelInput(stage.input))).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
      expect(store.startInvocation(stage.identity)).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
      expect(store.readInvocation(stage.identity.invocationId)?.status).toBe(stage.status);
    }
    expect(store.archiveSnapshot(source)).toEqual(before);
    expect(storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM authority_events").one().count).toBe(0);
  }, 9_000);
  await evictDurableObject(room);
  await withStore(room, (store, storage) => {
    const pending = saved.stages.find(stage => stage.status === "reserved")!, before = store.readInvocation(pending.identity.invocationId);
    expect(store.startInvocation(pending.identity)).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
    expect(store.archiveSnapshot(source)).toEqual({ kind: "available", snapshot: saved.snapshot });
    expect(store.checkpoint({ expectedRevision: 0, next: checkpoint(pending.input, 1, { status: "rejected", failureCode: "STORY_CONTEXT_STALE" }) }).ok).toBe(true);
    expect(store.readInvocation(pending.identity.invocationId)).toMatchObject({ ...before, eligible: false });
    expect(store.readJob(pending.input.request.jobId)?.usage.held).toEqual({ ...reservation, calls: 1 });
    storage.sql.exec(`DELETE FROM story_creation_accounts; DELETE FROM story_creation_jobs; DELETE FROM story_creation_invocations;
      DELETE FROM story_creation_admissions; DELETE FROM story_creation_admission_bindings; DELETE FROM story_creation_material_manifest;`);
    expect(store.isEmpty()).toBe(false);
    store.clearForRoomDeletion(); expect(store.isEmpty()).toBe(true);
  }, 90_000);
});
