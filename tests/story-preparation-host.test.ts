import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDeepSeekStrictToolBinding } from "../app/_runtime/lib/kp/deepseek";
import { AUTHORITATIVE_KP_PROFILE } from "../app/_runtime/lib/kp/authoritative-policy";
import { prepareRoomStory, storyTransportRef, type StoryTransportPolicy } from "../app/_runtime/lib/room/story-preparation-host";
import { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import type { StoryBudgetPolicy } from "../app/_runtime/lib/room/story-creation-invocation";
import { storyFixture, storyResponse, hashStory } from "./fixtures/story-creation.mjs";

const transport: StoryTransportPolicy = {
  modelId: AUTHORITATIVE_KP_PROFILE.modelId, modelRevision: AUTHORITATIVE_KP_PROFILE.modelRevision,
  maxInputTokens: 120_000, maxOutputTokens: 12_000, timeoutMs: 1_000,
  estimatedInputMicrosPerMillion: 1_000, estimatedOutputMicrosPerMillion: 2_000,
};
type Fixture = ReturnType<typeof storyFixture>;
function budget(fixture: Fixture): StoryBudgetPolicy {
  const job = { calls: 4, inputTokens: 480_000, outputTokens: 48_000, estimatedCostMicros: 1_000_000, elapsedMs: 10_000 };
  return { policyRef: fixture.request.budgetPolicyRef, roomAccountId: `room-budget:${fixture.request.source.roomId}`,
    job, source: { ...job, calls: 12 }, room: { ...job, calls: 24 } };
}
function input(fixture: Fixture) { return { request: fixture.request, context: fixture.context, budget: budget(fixture) }; }
function store(storage: DurableObjectStorage) {
  const value = new StoryCreationStore(storage, { hash: hashStory });
  value.ensureSchema();
  return value;
}

describe("Story Creation through the real SQLite host and strict transport codec", () => {
  for (const kind of ["conflict", "investigation"] as const) {
    it(`${kind}: persists full preparation and review; eviction and recipe removal reuse both with zero calls`, async () => {
      const fixture = storyFixture(kind);
      const stub = env.VNEXT_ROOMS.getByName(`story-host:${kind}`);
      const requests: Record<string, unknown>[] = [];
      const binding = createDeepSeekStrictToolBinding({ apiKey: "local-test-key", fetcher: async (_url, init) => {
        const sent = JSON.parse(String(init?.body));
        requests.push(sent);
        const review = sent.tools[0].function.name === "review_story_preparation";
        return Response.json({ ...storyResponse(review ? fixture.review : fixture.body, review ? "review" : "draft"),
          usage: { prompt_tokens: 100, completion_tokens: 200 } });
      } });
      let original: unknown;
      await runInDurableObject(stub as never, async (_instance, state) => {
        const journal = store(state.storage);
        original = await prepareRoomStory(input(fixture), { store: journal, binding, transport, recipes: fixture.recipes });
        expect(original).toMatchObject({ kind: "ready" });
        expect(requests).toHaveLength(2);
        expect(requests.map(request => (request.tools as Array<{ function: { name: string } }>)[0].function.name))
          .toEqual(["submit_story_preparation", "review_story_preparation"]);
        expect(journal.readJob(fixture.request.jobId)?.usage.spent.calls).toBe(2);
        expect(journal.readJob(fixture.request.jobId)?.usage.spent.inputTokens).toBe(200);
        // Provider token counts do not prove a paid amount of zero.
        expect(journal.readJob(fixture.request.jobId)?.usage.held.estimatedCostMicros).toBeGreaterThan(0);
      });
      await evictDurableObject(stub as never);
      await runInDurableObject(stub as never, async (_instance, state) => {
        const reopened = await prepareRoomStory(input(fixture), { store: store(state.storage), binding, transport, recipes: [] });
        expect(reopened).toEqual(original);
        expect(requests).toHaveLength(2);
      });
    });
  }

  it("a saved response survives interruption before the draft checkpoint without another draft call", async () => {
    const fixture = storyFixture("conflict"), stub = env.VNEXT_ROOMS.getByName("story-host:checkpoint-crash");
    let calls = 0;
    const binding = createDeepSeekStrictToolBinding({ apiKey: "local-test-key", fetcher: async () => {
      calls++;
      return Response.json(storyResponse(calls === 1 ? fixture.body : fixture.review, calls === 1 ? "draft" : "review"));
    } });
    await runInDurableObject(stub as never, async (_instance, state) => {
      const journal = store(state.storage);
      const checkpoint = journal.checkpoint.bind(journal);
      journal.checkpoint = change => {
        if (change.next.draft !== undefined) throw new Error("simulated host interruption after response persistence");
        return checkpoint(change);
      };
      expect(await prepareRoomStory(input(fixture), { store: journal, binding, transport, recipes: fixture.recipes }))
        .toMatchObject({ kind: "waiting", code: "STORY_CHECKPOINT_CONFLICT" });
      expect(calls).toBe(1);
    });
    await evictDurableObject(stub as never);
    await runInDurableObject(stub as never, async (_instance, state) => {
      const result = await prepareRoomStory(input(fixture), { store: store(state.storage), binding, transport, recipes: fixture.recipes });
      expect(result.kind).toBe("ready");
      expect(calls).toBe(2);
    });
  });

  it("an uncertain dispatched response stays unknown after eviction; an altered model cannot resume it", async () => {
    const fixture = storyFixture("conflict"), stub = env.VNEXT_ROOMS.getByName("story-host:unknown");
    let calls = 0;
    const binding = createDeepSeekStrictToolBinding({ apiKey: "local-test-key", fetcher: async () => {
      calls++;
      throw new Error("connection lost after send");
    } });
    await runInDurableObject(stub as never, async (_instance, state) => {
      const result = await prepareRoomStory(input(fixture), { store: store(state.storage), binding, transport, recipes: fixture.recipes });
      expect(result).toMatchObject({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
    });
    await evictDurableObject(stub as never);
    await runInDurableObject(stub as never, async (_instance, state) => {
      const journal = store(state.storage);
      expect(await prepareRoomStory(input(fixture), { store: journal, binding, transport, recipes: fixture.recipes }))
        .toMatchObject({ kind: "waiting", code: "STORY_INVOCATION_UNKNOWN" });
      expect(await prepareRoomStory(input(fixture), { store: journal, binding,
        transport: { ...transport, modelRevision: "different-model-revision" }, recipes: fixture.recipes }))
        .toMatchObject({ kind: "rejected", code: "STORY_IDENTITY_CONFLICT" });
      expect(calls).toBe(1);
      expect(journal.readJob(fixture.request.jobId)?.usage.spent.calls).toBe(1);
      expect(journal.readJob(fixture.request.jobId)?.usage.held.inputTokens).toBeGreaterThan(0);
    });
  });

  it("a definite provider rejection is saved once and releases the unused review allowance", async () => {
    const fixture = storyFixture("conflict"), stub = env.VNEXT_ROOMS.getByName("story-host:provider-rejection");
    let calls = 0;
    const binding = createDeepSeekStrictToolBinding({ apiKey: "local-test-key", fetcher: async () => {
      calls++;
      return new Response("PRIVATE-PROVIDER-REJECTION-CANARY", { status: 429 });
    } });
    await runInDurableObject(stub as never, async (_instance, state) => {
      const journal = store(state.storage);
      const result = await prepareRoomStory(input(fixture), { store: journal, binding, transport, recipes: fixture.recipes });
      expect(result).toMatchObject({ kind: "rejected", code: "STORY_PROVIDER_FAILED" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE-PROVIDER-REJECTION-CANARY");
      expect(await prepareRoomStory(input(fixture), { store: journal, binding, transport, recipes: fixture.recipes }))
        .toEqual(result);
      expect(calls).toBe(1);
      expect(journal.readJob(fixture.request.jobId)?.usage).toMatchObject({ spent: { calls: 1 }, held: { calls: 0 } });
    });
  });

  it("missing decisive context and insufficient review budget make zero provider calls", async () => {
    const fixture = storyFixture("conflict"), stub = env.VNEXT_ROOMS.getByName("story-host:budget");
    let calls = 0;
    const binding = { run: async () => { calls++; throw new Error("must not call"); } };
    await runInDurableObject(stub as never, async (_instance, state) => {
      const journal = store(state.storage), original = input(fixture);
      const context = { ...fixture.context, missingRequiredRefs: ["npc:missing-decisive-history"] };
      const { contextHash: _hash, ...body } = context;
      context.contextHash = hashStory(body);
      expect(await prepareRoomStory({ ...original, context }, { store: journal, binding, transport, recipes: fixture.recipes }))
        .toMatchObject({ kind: "rejected", code: "STORY_CONTEXT_INSUFFICIENT" });
      expect(await prepareRoomStory({ ...original, budget: { ...original.budget, source: { ...original.budget.source, calls: 1 } } },
        { store: journal, binding, transport, recipes: fixture.recipes }))
        .toMatchObject({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
      expect(await prepareRoomStory({ ...original, budget: { ...original.budget,
        source: { ...original.budget.source, inputTokens: 2 * transport.maxInputTokens - 1 } } },
      { store: journal, binding, transport, recipes: fixture.recipes }))
        .toMatchObject({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
      expect(calls).toBe(0);
    });
  });

  it("no-story decisions require neither unused story context nor another paid call after the common budget is spent", async () => {
    const fixture = storyFixture("conflict"), stub = env.VNEXT_ROOMS.getByName("story-host:no-story");
    let calls = 0;
    const binding = { run: async () => { calls++; throw new Error("must not call"); } };
    await runInDurableObject(stub as never, async (_instance, state) => {
      const journal = store(state.storage), original = input(fixture);
      const limited = { ...original.budget,
        source: { ...original.budget.source, calls: 1 }, room: { ...original.budget.room, calls: 1 } };
      expect(journal.openBudget({ source: fixture.request.source, budget: limited }).kind).toBe("opened");
      // A previously completed ordinary proposal has spent the source and room
      // call allowance. This local fixture does not dispatch an external call.
      const reserved = journal.reserveExternalInvocation({ source: fixture.request.source,
        roomAccountId: limited.roomAccountId, invocationKey: "already-completed-proposal", purpose: "proposal",
        modelRef: storyTransportRef(transport), providerRequest: { messages: [] },
        reservation: { inputTokens: 100, outputTokens: 100, estimatedCostMicros: 10, elapsedMs: 100 } });
      expect(reserved.kind).toBe("reserved");
      if (reserved.kind !== "reserved") throw new Error("fixture reservation failed");
      expect(journal.startInvocation(reserved).kind).toBe("ready");
      expect(journal.completeInvocation({ ...reserved, result: { kind: "completed", response: {},
        usage: { inputTokens: 10, outputTokens: 10, costMicros: 1 } } }).kind).toBe("saved");
      const context = { ...fixture.context, missingRequiredRefs: ["unused-story-context"] };
      const { contextHash: _hash, ...body } = context;
      context.contextHash = hashStory(body);
      const noStory = { ...original, context, budget: limited, request: { ...fixture.request,
        trigger: { kind: "ordinaryResponse" as const, goal: "仅回应这次询问，无需新故事", basisRefs: [] } } };
      const result = await prepareRoomStory(noStory, { store: journal, binding, transport, recipes: fixture.recipes });
      expect(result.kind).toBe("noStory");
      expect(await prepareRoomStory(noStory, { store: journal, binding, transport, recipes: [] })).toEqual(result);
      expect(journal.readBudget(limited.roomAccountId)?.spent.calls).toBe(1);
      expect(journal.readJob(fixture.request.jobId)?.usage.spent.calls).toBe(0);
      expect(calls).toBe(0);
    });
  });

  it("concurrent opportunities cannot spend the room allowance reserved for a mandatory review", async () => {
    const fixture = storyFixture("conflict"), stub = env.VNEXT_ROOMS.getByName("story-host:review-budget");
    let calls = 0, releaseDraft!: () => void, draftStarted!: () => void;
    const draftGate = new Promise<void>(resolve => { releaseDraft = resolve; });
    const started = new Promise<void>(resolve => { draftStarted = resolve; });
    const binding = createDeepSeekStrictToolBinding({ apiKey: "local-test-key", fetcher: async (_url, init) => {
      calls++;
      const sent = JSON.parse(String(init?.body));
      const review = sent.tools[0].function.name === "review_story_preparation";
      if (!review) { draftStarted(); await draftGate; }
      return Response.json(storyResponse(review ? fixture.review : fixture.body, review ? "review" : "draft"));
    } });
    await runInDurableObject(stub as never, async (_instance, state) => {
      const journal = store(state.storage), original = input(fixture);
      const first = { ...original, budget: { ...original.budget, room: { ...original.budget.room, calls: 2 } } };
      const competing = { ...first, request: { ...fixture.request,
        jobId: "other-job", opportunityId: "other-opportunity", source: { ...fixture.request.source,
          sourceId: "other-action", budgetAccountId: "other-source-budget" } } };
      const preparing = prepareRoomStory(first, { store: journal, binding, transport, recipes: fixture.recipes });
      await started;
      try {
        expect(await prepareRoomStory(competing, { store: journal, binding, transport, recipes: fixture.recipes }))
          .toMatchObject({ kind: "rejected", code: "STORY_BUDGET_EXHAUSTED" });
        expect(journal.readJob("other-job")).toBeUndefined();
        expect(calls).toBe(1);
      } finally { releaseDraft(); }
      expect((await preparing).kind).toBe("ready");
      expect(calls).toBe(2);
      expect(journal.readBudget(first.budget.roomAccountId)).toMatchObject({ spent: { calls: 2 }, held: { calls: 0 } });
    });
  });
});
