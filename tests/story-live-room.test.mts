/// <reference path="../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { runInDurableObject } from "cloudflare:test";
import { afterEach, expect, inject, it, vi } from "vitest";
import type { AuthoritativeModelBinding } from "../app/_runtime/lib/kp/authoritative-types";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json";
import { AuthoritativeRoomStore } from "../app/_runtime/lib/room/authority-store";
import type { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import type { StoryLibraryStore } from "../app/_runtime/lib/room/story-library-store";
import type { AuthoritativeWorldState, RuntimeGenesis } from "../app/_runtime/lib/rules";
import { historyHttpAccount, historyHttpDb, historyHttpPost, historyHttpSource, httpRecord } from "./fixtures/story-history-http";
import { STORY_ROOM_PROBE_CASES } from "./fixtures/story-live-room-cases.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    storyRoomProbe: { bridgeUrl: string; token: string; caseId: string; actionText: string; mode: "live" | "preflight" };
  }
}

// Only the provider dependency seam is replaced. The production server still
// chooses strict versus JSON transport, and its normal Room journal, author,
// review, Proposal, Rules and narration consumers see actual model responses.
vi.mock("../app/_runtime/lib/kp/deepseek", async importOriginal => {
  const actual = await importOriginal<typeof import("../app/_runtime/lib/kp/deepseek")>();
  const { inject: readProvided } = await import("vitest");
  const config = readProvided("storyRoomProbe");
  function binding(transportKind: "strict" | "ordinary-json"): AuthoritativeModelBinding {
    return { async run(model, input, options) {
      if (transportKind === "strict") actual.assertDeepSeekStrictToolModelInput(input);
      const response = await fetch(`${config.bridgeUrl}/invoke`, { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ transportKind, model, input }), signal: options?.signal });
      const result: unknown = await response.json();
      if (result === null || typeof result !== "object" || Array.isArray(result)) throw new Error("PROBE_BRIDGE_RESPONSE_INVALID");
      const value = result as Record<string, unknown>;
      if (!response.ok) throw Object.assign(new Error("PROBE_TRANSPORT_STOPPED"), {
        code: value.code, probeCode: value.probeCode,
        status: typeof value.status === "number" ? value.status : response.status,
        name: typeof value.name === "string" ? value.name : "Error",
        ...(typeof value.retryAfter === "number" ? { retryAfter: value.retryAfter } : {}),
      });
      if (!Object.hasOwn(value, "response")) throw new Error("PROBE_BRIDGE_RESPONSE_INVALID");
      return value.response;
    } };
  }
  return { ...actual, createDeepSeekStrictToolBinding: () => binding("strict"),
    createDeepSeekAuthoritativeBinding: () => binding("ordinary-json") };
});

const migrations = import.meta.glob<string>("../drizzle/*.sql", { eager: true, query: "?raw", import: "default" });
const config = inject("storyRoomProbe");
async function bridge(path: string, value?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.bridgeUrl}${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${config.token}`, ...(value === undefined ? {} : { "content-type": "application/json" }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const body = httpRecord(await response.json());
  if (!response.ok) throw new Error(typeof body.probeCode === "string" ? body.probeCode : "PROBE_BRIDGE_STOPPED");
  return body;
}
const evidence = (name: string, value: unknown) => bridge("/evidence", { name, value });
type Internals = { storyStore: StoryCreationStore; storyLibraryStore: StoryLibraryStore };
async function authoritySnapshot(source: Awaited<ReturnType<typeof historyHttpSource>>) {
  return runInDurableObject(source.stub, (instance, ctx) => {
    const authority = new AuthoritativeRoomStore(ctx.storage), row = authority.room();
    if (!row) throw new Error("PROBE_ROOM_AUTHORITY_MISSING");
    const state = JSON.parse(row.state_json) as AuthoritativeWorldState;
    const target = instance as unknown as Internals;
    return { genesis: JSON.parse(row.genesis_json) as RuntimeGenesis, state, events: authority.events(),
      jobs: target.storyStore.listCreationJobs(), library: target.storyLibraryStore.listEntries(),
      storyArchive: target.storyStore.archiveSnapshot({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId }),
      privateHost: authority.storyArchiveHostSnapshot(),
      privateReceipts: ctx.storage.sql.exec("SELECT * FROM authority_receipts ORDER BY receipt_id").toArray(),
      privateSubmissions: ctx.storage.sql.exec("SELECT * FROM authority_submissions ORDER BY submission_id, principal_id").toArray(),
      randomness: ctx.storage.sql.exec("SELECT * FROM authority_randomness_batches ORDER BY prepared_action_id").toArray(),
      deliveryPlans: ctx.storage.sql.exec("SELECT * FROM authority_delivery_plans ORDER BY publish_capability").toArray(),
      deliveryAudiences: ctx.storage.sql.exec("SELECT * FROM authority_delivery_audiences ORDER BY publish_capability, audience_id").toArray(),
      deliverySlots: ctx.storage.sql.exec("SELECT * FROM authority_delivery_slots ORDER BY viewer_key").toArray(),
      experiencedMessages: ctx.storage.sql.exec("SELECT * FROM authority_experienced_messages ORDER BY ordinal").toArray(),
    };
  });
}
afterEach(() => { vi.restoreAllMocks(); });

it("one real HTTP short local conflict: creation, review, admission, narration and exact retry", async () => {
  const selected = STORY_ROOM_PROBE_CASES.find(value => value.caseId === config.caseId);
  if (!selected?.implemented || typeof selected.text !== "string") throw new Error("PROBE_CASE_NOT_IMPLEMENTED");
  const originalFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== config.bridgeUrl) throw new Error("PROBE_WORKER_DIRECT_NETWORK_FORBIDDEN");
    return originalFetch(input, init);
  });
  let phase = "setup";
  try {
    for (const [, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
      for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
        await historyHttpDb.prepare(statement).run();
      }
    }
    const owner = await historyHttpAccount("真实故事链路验收"), source = await historyHttpSource(owner);
    const initialTable = await historyHttpPost("fetchTable", source.code, owner);
    const initial = await authoritySnapshot(source);
    await evidence("initial", { roomId: source.roomId, characterId: source.characters[0].characterId,
      table: initialTable.body, authority: initial });
    expect(initialTable.response.status).toBe(200); expect(initialTable.body.ok).toBe(true);
    expect(initial.jobs).toHaveLength(0); expect(initial.library).toHaveLength(0);
    expect((await bridge("/status")).realProviderCalls).toBe(0);
    if (config.mode === "preflight") {
      await evidence("acceptance", { status: "passed", mode: "preflight", caseId: selected.caseId,
        phases: ["real registration and session", "real Room initialization", "authenticated fetchTable", "full private authority snapshot"],
        providerCalls: 0, stateSha: canonicalHash(initial.state),
        notCovered: ["Provider request or output", "story creation", "action admission", "narration", "retry"] });
      return;
    }

    phase = "first-action";
    const action = { code: source.code, submissionId: crypto.randomUUID(), text: config.actionText };
    const first = await historyHttpPost("sendAction", action, owner);
    await evidence("first-action", { request: action, httpStatus: first.response.status, body: first.body });
    const firstTable = await historyHttpPost("fetchTable", source.code, owner);
    await evidence("first-table", { httpStatus: firstTable.response.status, body: firstTable.body });
    const after = await authoritySnapshot(source);
    await evidence("first-authority", after);
    const firstUsage = await bridge("/status");
    expect(first.response.status).toBe(200); expect(first.body.action, JSON.stringify(first.body)).toBe("committed");
    expect(first.body.narration, JSON.stringify(first.body)).toBe("published");
    expect(firstTable.response.status).toBe(200); expect(firstTable.body.ok).toBe(true);
    expect(firstUsage.stopCode).toBeNull(); expect(firstUsage.usageComplete).toBe(true);
    expect(firstUsage.realProviderCalls).toBeGreaterThan(0);
    expect(after.events.length).toBeGreaterThan(initial.events.length);
    expect(after.storyArchive.kind).toBe("available");
    if (after.storyArchive.kind !== "available") throw new Error("PROBE_STORY_ARCHIVE_UNAVAILABLE");
    expect(after.privateReceipts.length).toBeGreaterThan(initial.privateReceipts.length);
    expect(after.deliverySlots.length).toBeGreaterThan(0);
    expect(after.experiencedMessages.some(row => row.kind === "kp" && typeof row.body === "string" && row.body.trim().length > 0)).toBe(true);
    // Ground the assertion in actual existing NPC identities, not a fabricated
    // holder. Review the private snapshots to judge the specific knowledge.
    const changedNpcKnowledge = Object.entries(initial.state.entities).filter(([, entity]) => entity.kind === "npc")
      .filter(([id]) => canonicalHash(initial.state.knowledge[id] ?? null) !== canonicalHash(after.state.knowledge[id] ?? null))
      .map(([id]) => id);
    const storyDisposition = after.jobs.length === 0 ? "ordinary-response"
      : after.jobs.length === 1 && after.jobs[0].checkpoint?.status === "noStory" ? "no-story" : "story-created";
    if (storyDisposition === "story-created") {
      expect(after.jobs).toHaveLength(1); expect(after.jobs[0].checkpoint?.status).toBe("ready");
      expect(after.jobs[0].request.scale).toBe(selected.expectedScale);
      expect(after.jobs[0].request.connection).toBe(selected.expectedConnection);
      expect(after.library).toHaveLength(1); expect(after.storyArchive.snapshot.admissions.length).toBeGreaterThan(0);
      expect(changedNpcKnowledge.length, "No existing NPC acquired an admitted story fact").toBeGreaterThan(0);
    } else {
      // A legitimate ordinary response or noStory is not a failed story sample.
      // Preserve its evidence and leave the creative judgement to the reviewer.
      expect(after.library).toHaveLength(0); expect(after.storyArchive.snapshot.admissions).toHaveLength(0);
    }

    phase = "same-submission-retry";
    // The bridge refuses any attempted model call in this phase and marks the
    // batch failed. Zero actual calls alone would otherwise mask a bad retry.
    await bridge("/seal-retry", {});
    const retry = await historyHttpPost("sendAction", action, owner);
    await evidence("retry-action", { httpStatus: retry.response.status, body: retry.body });
    const retryTable = await historyHttpPost("fetchTable", source.code, owner);
    await evidence("retry-table", { httpStatus: retryTable.response.status, body: retryTable.body });
    const repeated = await authoritySnapshot(source);
    await evidence("retry-authority", repeated);
    const retryUsage = await bridge("/status");
    expect(retry.response.status).toBe(first.response.status); expect(retry.body).toEqual(first.body);
    expect(retryUsage.stopCode).toBeNull(); expect(retryUsage.realProviderCalls).toBe(firstUsage.realProviderCalls);
    expect(retryUsage.calls).toEqual(firstUsage.calls);
    expect(repeated).toEqual(after);
    // Persisted slots include the actual Delivery frame; receipts, all world
    // resources, randomness and StoryStore accounts are in this exact equality.
    await evidence("acceptance", { status: storyDisposition === "story-created" ? "passed" : "needs-review",
      storyDisposition, caseId: selected.caseId, phase,
      mechanicalAction: first.body.action, narration: first.body.narration,
      receipt: httpRecord(first.body.outcome).receipt,
      providerCalls: firstUsage.realProviderCalls, retryNewProviderCalls: 0,
      stateSha: canonicalHash(after.state), deliverySha: canonicalHash(after.deliverySlots),
      receiptSha: canonicalHash(after.privateReceipts), storyArchiveSha: after.storyArchive.snapshot.snapshotHash,
      changedNpcKnowledge, retryExactPrivateState: true,
      manualReviewRequired: "Assess story quality, world coherence, NPC knowledge provenance and the saved actual player presentation." });
  } catch (error) {
    await bridge("/stop", {});
    await evidence("failure", { phase, name: error instanceof Error ? error.name : "UnknownFailure",
      // Only the private artifact receives assertion detail. The CLI prints
      // counts and safe failure codes, never a request or response body.
      message: error instanceof Error ? error.message : "PROBE_HTTP_ACCEPTANCE_FAILED" });
    throw error;
  }
});
