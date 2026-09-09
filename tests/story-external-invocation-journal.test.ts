import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import { createStoryExternalInvocationJournal } from "../app/_runtime/lib/room/story-external-invocation-journal";
import type { StoryExternalInvocationBinding } from "../app/_runtime/lib/room/story-creation-invocation";
import type { StoryHash } from "../app/_runtime/lib/room/story-creation/contracts";

const hash = (value: unknown) => canonicalSha256(value) as StoryHash;
const ref = (id: string) => ({ id, version: "1", hash: hash(id) });
function binding(purpose: StoryExternalInvocationBinding["purpose"] = "proposal", calls = 12): StoryExternalInvocationBinding {
  const limits = { calls, inputTokens: 10_000, outputTokens: 10_000, estimatedCostMicros: 10_000, elapsedMs: 10_000 };
  return { source: { roomId: "room-one", runtimeEpochId: "epoch-one", branchId: "branch-one", kind: "playerAction",
    sourceId: "prepared-action:one", budgetAccountId: "source-one" }, roomAccountId: "room-budget",
  invocationKey: `semantic-stage:${purpose}`, purpose, modelRef: ref("model-one"),
  providerRequest: { messages: [{ role: "user", content: `PRIVATE:${purpose}` }], max_tokens: 200 },
  reservation: { inputTokens: 100, outputTokens: 200, estimatedCostMicros: 300, elapsedMs: 1_000 },
  budget: { policyRef: ref("budget-one"), roomAccountId: "room-budget", job: limits, source: limits, room: limits } };
}
const stub = (name: string) => env.ROOMS.getByName(`story-external-journal:${name}`);
async function withJournal<T>(room: ReturnType<typeof stub>, callback: (
  journal: ReturnType<typeof createStoryExternalInvocationJournal>, store: StoryCreationStore, storage: DurableObjectStorage,
) => T, now = 1_000): Promise<T> {
  return runInDurableObject(room, (_instance, context) => {
    const store = new StoryCreationStore(context.storage, { hash, now: () => now });
    store.ensureSchema();
    return callback(createStoryExternalInvocationJournal(store), store, context.storage);
  });
}

it("ordinary proposal, NPC, context and each narration stage use one persistent source budget and saved responses", async () => {
  const room = stub("ordinary"), requests = [binding("proposal", 4), binding("npc", 4), binding("context", 4), binding("narration", 4)];
  let sends = 0;
  const before = await withJournal(room, (journal, store) => {
    for (const input of requests) {
      const begun = journal.begin(input);
      expect(begun.kind).toBe("ready");
      if (begun.kind !== "ready") throw new Error("expected dispatch permit");
      sends++;
      expect(journal.complete(input, { ...begun, result: { kind: "completed", response: { purpose: input.purpose },
        usage: { inputTokens: 10, outputTokens: 20, costMicros: 1 } } })).toEqual({ kind: "saved", eligible: true });
      expect(journal.begin(input)).toEqual({ kind: "completed", invocationId: begun.invocationId, response: { purpose: input.purpose } });
      const read = journal.read(input, begun.invocationId);
      expect(read).toMatchObject({ kind: "found", invocation: { invocationId: begun.invocationId, status: "completed" } });
      expect(JSON.stringify(read)).not.toContain(begun.capability);
    }
    const overBudget = { ...requests[3], invocationKey: "semantic-stage:narration-review" };
    expect(journal.begin(overBudget)).toEqual({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
    expect(store.readBudget("source-one")).toMatchObject({ spent: { calls: 4, inputTokens: 40 }, held: { calls: 0 } });
    return store.readBudget("source-one");
  });
  await evictDurableObject(room);
  await withJournal(room, (journal, store) => {
    for (const input of requests) expect(journal.begin(input)).toMatchObject({ kind: "completed", response: { purpose: input.purpose } });
    expect(store.readBudget("source-one")).toEqual(before);
  });
  expect(sends).toBe(4);
});

it("validates the complete mapped external identity before a read, completion or repeated begin", async () => {
  const input = binding();
  await withJournal(stub("identity"), (journal, store) => {
    const begun = journal.begin(input);
    if (begun.kind !== "ready") throw new Error("expected permit");
    const before = store.readInvocation(begun.invocationId), budget = store.readBudget("source-one");
    const changed: StoryExternalInvocationBinding[] = [
      { ...input, purpose: "npc" }, { ...input, modelRef: ref("different-model") },
      { ...input, providerRequest: { secret: "MUST_NOT_LEAK" } },
      { ...input, source: { ...input.source, sourceId: "different-action" } },
      { ...input, source: { ...input.source, branchId: "different-branch" } },
      { ...input, roomAccountId: "different-room-account" },
      { ...input, invocationKey: "different-semantic-stage" },
      { ...input, reservation: { ...input.reservation, outputTokens: 999 } },
    ];
    for (const bad of changed) {
      expect(journal.read(bad, begun.invocationId)).toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
      expect(journal.complete(bad, { ...begun, result: { kind: "completed", response: { incorrect: true } } }))
        .toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    }
    expect(journal.begin({ ...input, providerRequest: {} })).toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(journal.read(input, "missing-mapped-invocation")).toEqual({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
    expect(journal.complete(input, { ...begun, capability: "wrong-permit", result: { kind: "notSent" } }).kind).toBe("rejected");
    expect(store.readInvocation(begun.invocationId)).toEqual(before);
    expect(store.readBudget("source-one")).toEqual(budget);
  });
});

it("started and unknown calls never gain a second permit after timeout, eviction, or another request", async () => {
  const input = binding(), room = stub("uncertain");
  const begun = await withJournal(room, (journal, store) => {
    const first = journal.begin(input);
    if (first.kind !== "ready") throw new Error("expected permit");
    expect(journal.begin(input)).toEqual({ kind: "waiting", invocationId: first.invocationId, code: "STORY_INVOCATION_PENDING" });
    expect(store.readBudget("source-one")).toMatchObject({ spent: { calls: 1 }, held: { inputTokens: 100 } });
    return first;
  });
  await evictDurableObject(room);
  await withJournal(room, (journal, store) => {
    expect(journal.read(input, begun.invocationId)).toMatchObject({ kind: "found", invocation: { status: "started" } });
    expect(journal.begin(input)).toEqual({ kind: "waiting", invocationId: begun.invocationId, code: "STORY_INVOCATION_UNKNOWN" });
    const before = store.readBudget("source-one");
    expect(journal.begin(input)).toEqual({ kind: "waiting", invocationId: begun.invocationId, code: "STORY_INVOCATION_UNKNOWN" });
    expect(store.readBudget("source-one")).toEqual(before);
    expect(journal.complete(input, { ...begun, result: { kind: "completed", response: { late: "original response" } } }).kind).toBe("saved");
    expect(journal.begin(input)).toEqual({ kind: "completed", invocationId: begun.invocationId, response: { late: "original response" } });
    expect(store.readBudget("source-one")?.spent.calls).toBe(1);
  }, 8_000);
});

it("only proven notSent rotates the permit, while a failed call stays terminal", async () => {
  const input = binding();
  await withJournal(stub("not-sent"), (journal, store) => {
    const first = journal.begin(input);
    if (first.kind !== "ready") throw new Error("expected permit");
    expect(journal.complete(input, { ...first, result: { kind: "notSent" } }).kind).toBe("saved");
    const second = journal.begin(input);
    if (second.kind !== "ready") throw new Error("expected replacement permit");
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.capability).not.toBe(first.capability);
    expect(journal.complete(input, { ...first, result: { kind: "completed", response: {} } }).kind).toBe("rejected");
    expect(journal.complete(input, { ...second, result: { kind: "failed" } }).kind).toBe("saved");
    expect(journal.begin(input)).toEqual({ kind: "rejected", code: "STORY_PROVIDER_FAILED" });
    expect(store.readBudget("source-one")?.spent.calls).toBe(1);
  });
});

it("begin and the host protocol mapping roll back in one outer Room transaction", async () => {
  const input = binding();
  await withJournal(stub("outer-transaction"), (journal, store, storage) => {
    expect(() => storage.transactionSync(() => {
      expect(journal.begin(input).kind).toBe("ready");
      throw new Error("protocol proof could not be saved");
    })).toThrow("protocol proof could not be saved");
    expect(store.isEmpty()).toBe(true);
    expect(journal.begin(input).kind).toBe("ready");
  });
});

it("retains rejected raw response text through completion, eviction and archive recovery without normalizing it", async () => {
  const room = stub("raw-response"), input = binding();
  const response = { choices: [{ message: { tool_calls: [{ function: {
    arguments: '{"text":"Cafe\u0301","value":1,"value":2}',
  } }] } }] };
  const saved = await withJournal(room, (journal, store) => {
    const begun = journal.begin(input);
    if (begun.kind !== "ready") throw new Error("expected dispatch permit");
    const result = { kind: "completed" as const, response };
    expect(journal.complete(input, { ...begun, result }).kind).toBe("saved");
    expect(journal.complete(input, { ...begun, result }).kind).toBe("saved");
    expect(journal.complete(input, { ...begun, result: { ...result,
      response: JSON.parse(JSON.stringify(response).normalize("NFC")) } }).kind).toBe("rejected");
    const source = { roomId: input.source.roomId, runtimeEpochId: input.source.runtimeEpochId };
    const archive = store.archiveSnapshot(source);
    if (archive.kind !== "available") throw new Error("expected raw response archive");
    return { source, snapshot: archive.snapshot, budget: store.readBudget(input.source.budgetAccountId) };
  });
  await evictDurableObject(room);
  await withJournal(room, (journal, store) => {
    expect(journal.begin(input)).toMatchObject({ kind: "completed", response });
    expect(store.readBudget(input.source.budgetAccountId)).toEqual(saved.budget);
    store.clearForRoomDeletion();
    expect(store.restoreArchiveSnapshot({ source: saved.source, snapshot: saved.snapshot,
      quarantine: { invocationIds: [], sourceBudgetAccountIds: [input.source.budgetAccountId] } }).kind).toBe("restored");
    expect(journal.begin(input)).toMatchObject({ kind: "completed", response });
    expect(store.readBudget(input.source.budgetAccountId)).toEqual(saved.budget);
  });
});

it("restored external calls preserve completed data and quarantine every pending status and changed semantic key", async () => {
  const room = stub("archive-quarantine"), completedInput = binding();
  let permits = 0;
  const saved = await withJournal(room, (journal, store) => {
    const completed = journal.begin(completedInput);
    if (completed.kind !== "ready") throw new Error("expected initial permit");
    permits++;
    journal.complete(completedInput, { ...completed, result: { kind: "completed", response: { original: true },
      usage: { inputTokens: 10, outputTokens: 20, costMicros: 30 } } });
    const pending = ["reserved", "started", "unknown", "notSent"].map(status => {
      const input = { ...binding(), invocationKey: `pending:${status}` };
      const { budget: _budget, ...request } = input;
      const identity = status === "reserved" ? store.reserveExternalInvocation(request) : journal.begin(input);
      if (identity.kind !== "ready" && identity.kind !== "reserved") throw new Error("expected initial reservation or permit");
      if (identity.kind === "ready") permits++;
      if (status === "unknown" || status === "notSent") {
        expect(journal.complete(input, { ...identity, result: { kind: status } }).kind).toBe("saved");
      }
      return { input, identity, status };
    });
    const source = { roomId: completedInput.source.roomId, runtimeEpochId: completedInput.source.runtimeEpochId };
    const archived = store.archiveSnapshot(source);
    if (archived.kind !== "available") throw new Error("expected archive");
    store.clearForRoomDeletion();
    return { source, snapshot: archived.snapshot, completed, pending, quarantine: {
      invocationIds: pending.map(value => value.identity.invocationId), sourceBudgetAccountIds: [completedInput.source.budgetAccountId],
    } };
  });
  const originalPermits = permits;
  await withJournal(room, (_journal, _store, storage) => {
    let mutations = 0;
    const store = new StoryCreationStore(storage, { hash, now: () => 90_000, onMutation: () => { mutations++; } });
    expect(store.restoreArchiveSnapshot({ source: saved.source, snapshot: saved.snapshot, quarantine: saved.quarantine }).kind).toBe("restored");
    expect(mutations).toBe(1);
    const journal = createStoryExternalInvocationJournal(store);
    expect(journal.begin(completedInput)).toEqual({ kind: "completed", invocationId: saved.completed.invocationId, response: { original: true } });
    for (const { input, identity, status } of saved.pending) {
      const result = journal.begin(input);
      if (result.kind === "ready") permits++;
      expect(result).toEqual({ kind: "waiting", invocationId: identity.invocationId, code: "STORY_INVOCATION_UNKNOWN" });
      expect(store.startInvocation(identity)).toEqual({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
      expect(journal.read(input, identity.invocationId)).toMatchObject({ kind: "found", invocation: { status } });
    }
    for (const purpose of ["proposal", "narration", "npc", "context"] as const) {
      const input = { ...binding(purpose), invocationKey: `unseen-after-restore:${purpose}` };
      const result = journal.begin(input);
      if (result.kind === "ready") permits++;
      expect(result).toEqual({ kind: "rejected", code: "STORY_INVOCATION_UNKNOWN" });
      expect(journal.read(input)).toEqual({ kind: "missing" });
    }
    expect(permits).toBe(originalPermits); expect(mutations).toBe(1);
    expect(store.archiveSnapshot(saved.source)).toEqual({ kind: "available", snapshot: saved.snapshot });
    const unknown = saved.pending.find(value => value.status === "unknown")!;
    expect(journal.complete(unknown.input, { ...unknown.identity, result: { kind: "completed", response: { late: true } } }).kind).toBe("saved");
    expect(mutations).toBe(2);
    expect(journal.begin(unknown.input)).toEqual({ kind: "completed", invocationId: unknown.identity.invocationId, response: { late: true } });
    expect(journal.begin({ ...completedInput, invocationKey: "still-fenced-after-late-result" }))
      .toEqual({ kind: "rejected", code: "STORY_INVOCATION_UNKNOWN" });
    expect(mutations).toBe(2); expect(permits).toBe(originalPermits);
  });
  await evictDurableObject(room);
  await withJournal(room, (journal, store) => {
    const before = store.readBudget(completedInput.source.budgetAccountId);
    expect(journal.begin({ ...completedInput, invocationKey: "unseen-after-eviction" }))
      .toEqual({ kind: "rejected", code: "STORY_INVOCATION_UNKNOWN" });
    expect(journal.begin(completedInput)).toMatchObject({ kind: "completed", response: { original: true } });
    expect(store.readBudget(completedInput.source.budgetAccountId)).toEqual(before);
  }, 900_000);
});
