import { diagnoseFailure } from "../../../app/_runtime/lib/platform/failure-diagnostics";
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { handleRoomAction, handleViewerNarrationRecovery, type RoomAuthorityCapability, type KpAdapterCapability } from "../../../app/_runtime/lib/room/action";
import type { RoomDurableObject } from "../../../app/_runtime/lib/room/durable-object";
import { createJournaledNarrationAdapter } from "../../../app/_runtime/lib/room/story-narration";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NARRATION_PUBLICATION_LEASE_MS } from "../../../app/_runtime/lib/room/authority-store";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { parseSubmitKpProposalBundleArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider";
import { legacyCommittedNarrationAuthority } from "../../support/fixtures/legacy-narration-room";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";
import { publicAuthoritativeOutcomeError } from "../../../app/_runtime/lib/table/authoritative";

const ALICE = { principal: { id: "multiplayer:alice", sessionVersion: 1 } };
const OTHER = { principal: { id: "multiplayer:other", sessionVersion: 1 } };
const ACTOR = "character:multiplayer:alice";
const PRIVATE_RESULT = "你看清了私人记号。";
type ProviderMaterial = { mechanicalResults: { key: string }[]; reviewId: string };
type Target = RoomDurableObject;
const rooms: ReturnType<typeof env.VNEXT_ROOMS.getByName>[] = [];
afterEach(async () => { for (const stub of rooms.splice(0)) await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm(); }); });

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  rooms.push(stub);
  expect(await stub.initializeAuthoritative({
    roomId: name, moduleId: "black-oak-will",
    members: [ALICE].map((p, i) => ({ principalId: p.principal.id, role: i === 0 ? "host" : "player" })),
    characters: [ALICE].map(p => ({
      characterId: `character:${p.principal.id}`, controllerPrincipalId: p.principal.id,
      staticCard: {
        name: "调查员", sceneId: "wake",
        level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2,
        skills: ["perception"], hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [],
      },
    })),
  })).toMatchObject({ created: true });
  return stub;
}

async function propose() {
  return parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle({
    mode: "adjudication", basisRefs: ["wake"], terminal: { kind: "none" },
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "只查看眼前景象。", successOutcome: "看清眼前景象。" },
    proposals: [{
      kind: "observe", basisRefs: ["wake"], consumes: [], produces: [], outcomeBinding: "always", sceneRef: "wake",
      inquiry: "查看守灵厅。", method: "留在原地观察。", focusRefs: ["wake"], existingFactRefs: [],
      branches: { success: { outcomeCode: "outcome:observed", summary: "查看了守灵厅。",
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: "wake", sense: "sight", evidence: PRIVATE_RESULT, basisRefs: ["wake"] }],
        characterInferences: [],
      }, failure: { kind: "none" } },
    }],
  })));
}

function scriptedModel(calls: string[], unknown = false, presentation = false, repair = "") {
  return { async run(_model: string, input: Record<string, unknown>) {
    const tool = (input.tools as { function: { name: string } }[])[0]!.function.name;
    calls.push(tool);
    if (unknown || (repair === "repairUnknown" && calls.length === 3)) throw new Error("provider response connection lost");
    const materialFailure = !!repair && (calls.length <= 2 || repair === "repairRefused");
    const candidate = materialFailure ? "你决定永远留在这里。" : PRIVATE_RESULT;
    const material = sentBody(input) as ProviderMaterial;
    const body = tool === "submit_frozen_narration" ? { body: candidate } : {
      reviewId: material.reviewId,
      checks: { results: "pass", continuity: "pass", attribution: "pass", agency: materialFailure ? "fail" : "pass", presentation: presentation ? "fail" : "pass" },
      ...(material.mechanicalResults.length ? {
        resultChecks: Object.fromEntries(material.mechanicalResults.map(m => [m.key, "complete"])),
      } : {}), issues: presentation ? [{ code: "PRESENTATION", check: "presentation",
        quote: PRIVATE_RESULT, occurrence: 0, constraintRef: "policy:presentation", reason: "PRIVATE_REVIEW_REASON" }] : materialFailure ? [{ code: "PLAYER_AGENCY", check: "agency",
        quote: candidate, occurrence: 0, constraintRef: "policy:agency", reason: "PRIVATE_REPAIR_REASON" }] : [],
    };
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
      type: "function", function: { name: tool, arguments: JSON.stringify(repair === "repairSchema" && calls.length === 4 ? {} : body) },
    }] } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
  } };
}

function narrator(target: Target, calls: string[], interruption?: string) {
  const ai = scriptedModel(calls, interruption === "unknown", interruption === "presentation", interruption?.startsWith("repair") ? interruption : "");
  const transport = new ActorPlanTransportCapability(ai);
  return createJournaledNarrationAdapter({ ai }, async (authority, generation, ordinal, body) => {
    if (interruption === "beforeModel") throw new Error("publisher disconnected");
    const result = await target.runNarrationInvocation(ALICE, authority, generation, ordinal, body, transport);
    if ((interruption === "afterGeneration" && ordinal === 1)
      || ((interruption === "afterReview" || interruption === "oldSchema" || interruption === "repairAfterReview") && ordinal === 2)
      || (interruption === "repairAfterRewrite" && ordinal === 3)
      || (interruption === "repairAfterFinal" && ordinal === 4)) {
      throw new Error("publisher disconnected after response saved");
    }
    return result;
  }, async () => { throw new Error("unexpected pending NPC"); });
}

const context = (target: Target, kp: unknown) => ({ principal: ALICE,
  authority: legacyCommittedNarrationAuthority(target) as unknown as RoomAuthorityCapability, kp: kp as KpAdapterCapability });

it.each(["queued", "beforeModel", "afterGeneration", "afterReview", "unknown", "oldSchema"])(
  "recovers interrupted narration at %s without permanent pending, new actions, or duplicate calls", async interruption => {
  // SPEC 0011 §2 / SPEC 0015 §8 / SPEC 0016 §7.2: real Room/action/narration
  // journal; only model I/O and the lost publisher/failure RPC are injected.
  const stub = await initialize(`interrupted-${interruption}`);
  const calls: string[] = [];
  const initial = await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    const fail = vi.spyOn(target, "failDeliveryAudiencePublication").mockImplementation(() => {
      throw new Error("failure RPC disconnected");
    });
    const begin = interruption === "queued"
      ? vi.spyOn(target, "beginDeliveryAudiencePublication").mockImplementation(() => {
        throw new Error("publisher disconnected before begin");
      }) : undefined;
    try {
      return await handleRoomAction(context(target, { ...narrator(target, calls, interruption), propose }),
        { kind: "intent", submissionId: "interrupted:observe", text: "我留在原地查看守灵厅。" });
    } finally { fail.mockRestore(); begin?.mockRestore(); }
  });
  expect(initial).toMatchObject({ kind: "committed", narration: "retryableFailure" });
  const observed = await stub.observe(ALICE) as { narrationRecovery: { capability: string; state: string } };
  expect(observed.narrationRecovery.state).toBe("pending");
  const capability = observed.narrationRecovery.capability;
  const before = await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const audience = state.storage.sql.exec<{ audience_id: string; delivery_generation: number; publication_attempt: number }>(
      "SELECT audience_id, delivery_generation, publication_attempt FROM authority_delivery_audiences WHERE publish_capability = ?", capability).one();
    // An active publisher cannot be replaced by refresh or a concurrent retry.
    if (interruption !== "queued") {
      expect(target.beginViewerNarrationRecovery(ALICE, capability)).toMatchObject({ kind: "rejected" });
      expect(target.beginDeliveryAudiencePublication({ publishCapability: capability,
        audienceId: audience.audience_id })).toMatchObject({ kind: "rejected" });
    }
    expect(target.beginViewerNarrationRecovery(OTHER, capability)).toMatchObject({ kind: "rejected" });
    const events = state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray();
    if (interruption === "oldSchema") {
      // Exercise the actual constructor upgrade on an existing Room database.
      state.storage.sql.exec("ALTER TABLE authority_delivery_audiences DROP COLUMN publication_lease_until");
      state.storage.sql.exec("ALTER TABLE authority_delivery_audiences DROP COLUMN publication_attempt");
    }
    return { audience, events };
  });
  await evictDurableObject(stub);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20 * 60_000);
  try {
    expect(await stub.observe(ALICE)).toMatchObject({ narrationRecovery: {
      state: "retryableFailure", failureCode: "NARRATION_PUBLICATION_FAILED",
    } });
    const recovered = await runInDurableObject(stub, async (instance, state) => {
      const target = instance as unknown as Target;
      const kp = narrator(target, calls);
      const result = await handleViewerNarrationRecovery(context(target, kp), capability);
      if (interruption === "unknown") {
        expect(result).toMatchObject({ action: "committed", narration: "retryableFailure" });
        // Repeated explicit recovery also cannot resample an uncertain call.
        const logs = vi.spyOn(console, "info").mockImplementation(() => {});
        try {
          expect(await handleViewerNarrationRecovery(context(target, kp), capability))
            .toMatchObject({ action: "committed", narration: "retryableFailure" });
          // SPEC 0011 §5: a local journal block must remain distinguishable
          // from a slow Provider, without logging its private request/response.
          const events = logs.mock.calls.map(([line]) => JSON.parse(String(line)));
          expect(events).toContainEqual(expect.objectContaining({ eventName: "room.narration.invocation.blocked",
            outcomeKind: "callOutcomeUnknown", modelInvocationPurpose: "narrationRecovery",
            failureReason: "callOutcomeUnknown", failureStage: "invocationJournal", failureRetryability: "blocked" }));
          expect(JSON.stringify(events)).not.toContain(PRIVATE_RESULT);
          expect(JSON.stringify(events)).not.toContain(capability);
        } finally { logs.mockRestore(); }
      } else {
        expect(result).toMatchObject({ action: "committed", narration: "published" });
        if (before.audience.delivery_generation > 0) {
          const stale = { audienceId: before.audience.audience_id,
            ...(interruption === "oldSchema" ? {} : { publicationAttempt: before.audience.publication_attempt }),
            deliveryGeneration: before.audience.delivery_generation };
          expect(target.failDeliveryAudiencePublication({ publishCapability: capability }, {
            ...stale, state: "retryableFailure", errorCode: "NARRATION_PUBLICATION_FAILED",
          })).toMatchObject({ kind: "rejected", code: "narrationPublicationAttemptMismatch" });
          expect(await target.publishDelivery({ publishCapability: capability }, {
            frames: [{ ...stale, narration: { body: "stale publisher result" } }],
          })).toMatchObject({ kind: "rejected", code: "narrationPublicationAttemptMismatch" });
        }
      }
      expect(state.storage.sql.exec<{ delivery_generation: number }>(
        "SELECT delivery_generation FROM authority_delivery_audiences WHERE publish_capability = ?", capability).one()
        .delivery_generation).toBe(Math.max(before.audience.delivery_generation, 1));
      expect(state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray())
        .toEqual(before.events);
      return result;
    });
    expect(calls).toHaveLength(interruption === "unknown" ? 1 : 2);
    await evictDurableObject(stub);
    const after = await stub.observe(ALICE);
    if (interruption === "unknown") {
      expect(after).toMatchObject({ narrationRecovery: { state: "retryableFailure" } });
    } else {
      expect(after).not.toHaveProperty("narrationRecovery");
      expect(JSON.stringify(after)).toContain(PRIVATE_RESULT);
      expect(recovered).toMatchObject({ narration: "published" });
    }
  } finally { clock.mockRestore(); }
});

it("accepts a late physical response after lease recovery without dispatching a replacement call", async () => {
  // SPEC 0016 §7.2: an unknown response can later become known; recovery must
  // retain the exact invocation identity through every publication attempt.
  const stub = await initialize("interrupted-late-response");
  const calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const ai = scriptedModel(calls);
    const slow = new ActorPlanTransportCapability({ async run(model, input) {
      entered();
      await gate;
      return ai.run(model, input);
    } });
    let physical: Promise<unknown> | undefined;
    const interrupted = createJournaledNarrationAdapter({ ai }, async (authority, generation, ordinal, body) => {
      physical = target.runNarrationInvocation(ALICE, authority, generation, ordinal, body, slow);
      await started;
      throw new Error("publisher disconnected while physical call was in flight");
    }, async () => { throw new Error("unexpected pending NPC"); });
    const failedWrite = vi.spyOn(target, "failDeliveryAudiencePublication").mockImplementation(() => {
      throw new Error("failure RPC disconnected");
    });
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    try {
      expect(await handleRoomAction(context(target, { ...interrupted, propose }),
        { kind: "intent", submissionId: "late:observe", text: "我留在原地查看守灵厅。" }))
        .toMatchObject({ action: "committed", narration: "retryableFailure" });
      failedWrite.mockRestore();
      const observed = await target.observe(ALICE) as { narrationRecovery: { capability: string } };
      const capability = observed.narrationRecovery.capability;
      clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + NARRATION_PUBLICATION_LEASE_MS + 1);
      expect(await handleViewerNarrationRecovery(context(target, narrator(target, calls)), capability))
        .toMatchObject({ action: "committed", narration: "retryableFailure" });
      expect(calls).toHaveLength(0);
      release();
      await physical;
      expect(await handleViewerNarrationRecovery(context(target, narrator(target, calls)), capability))
        .toMatchObject({ action: "committed", narration: "published" });
      expect(calls).toEqual(["submit_frozen_narration", "review_frozen_narration"]);
    } finally {
      release();
      await physical;
      failedWrite.mockRestore();
      clock?.mockRestore();
    }
  });
});

it("publishes a slow response through Room and the saved call ledger without expiring its publication", async () => {
  // SPEC 0011 §2 / SPEC 0015 §8.2: a 130-second reply can finish on its original
  // world receipt, even though the ledger's frozen admission estimate is 50s.
  const stub = await initialize("slow-narration-publication");
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const calls: string[] = [], budgets: number[] = [];
    const ai = scriptedModel(calls);
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    let beforeEvents: unknown;
    const transport = new ActorPlanTransportCapability({ async run(model, input, options) {
      beforeEvents ??= state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray();
      now += calls.length === 0 ? 60_000 : 70_000;
      expect(options?.signal?.aborted).toBe(false);
      expect(await target.observe(ALICE)).toMatchObject({ narrationRecovery: { state: "pending" } });
      return ai.run(model, input);
    } });
    const kp = createJournaledNarrationAdapter({ ai }, (authority, generation, ordinal, body, timeoutMs) => {
      budgets.push(timeoutMs);
      return target.runNarrationInvocation(ALICE, authority, generation, ordinal, body, transport, timeoutMs);
    }, async () => { throw new Error("unexpected NPC call"); });
    try {
      expect(await handleRoomAction(context(target, { ...kp, propose }),
        { kind: "intent", submissionId: "slow:observe", text: "我留在原地查看守灵厅。" }))
        .toMatchObject({ action: "committed", narration: "published" });
      expect(budgets).toEqual([180_000, 120_000]);
      expect(calls).toEqual(["submit_frozen_narration", "review_frozen_narration"]);
      expect(state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray()).toEqual(beforeEvents);
      expect(JSON.stringify(await target.observe(ALICE))).toContain(PRIVATE_RESULT);
    } finally { clock.mockRestore(); }
  });
});

it("aborts the actual transport at the remaining narration deadline and preserves the default NPC deadline", async () => {
  // SPEC 0011 §2: the inner timer must not keep cancelling narration at 45s.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    for (const timeoutMs of [120_000, undefined]) {
      let signal: AbortSignal | undefined;
      const transport = new ActorPlanTransportCapability({ async run(_model, _input, options) {
        signal = options?.signal;
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      } });
      const result = transport.run("test:model", {}, timeoutMs).catch(error => error);
      await vi.advanceTimersByTimeAsync((timeoutMs ?? 45_000) - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(diagnoseFailure(await result)).toMatchObject({ reason: "providerTimeout", stage: "modelRequest" });
    }
  } finally { vi.useRealTimers(); }
});

// SPEC 0011 §§1、4、5: real Worker RPC must retain the fixed reason after the
// provider error is wrapped by the transport, Room and narration Adapter.
it("retains failure diagnostics across actual narration RPC without another physical call", async () => {
  const stub = await initialize("diagnostic-rpc");
  const calls: string[] = [], receipts: import("../../../app/_runtime/lib/kp/authoritative-types").ModelInvocationReceipt[] = [];
  const target = stub as unknown as Target;
  const transport = new ActorPlanTransportCapability({ async run() {
    calls.push("sent");
    throw Object.assign(new Error("PRIVATE_PROVIDER_MESSAGE"), { status: 429 });
  } });
  const adapter = createJournaledNarrationAdapter({ ai: { async run() { throw new Error("unused"); } },
    onInvocationReceipt: receipt => receipts.push(receipt) },
    (authority, generation, ordinal, body, timeoutMs) => stub.runNarrationInvocation(ALICE, authority, generation, ordinal, body, transport, timeoutMs),
    async () => { throw new Error("unexpected pending NPC"); });
  const authority = new Proxy(target, { get(instance, key) {
    if (key === "commit") return (...args: Parameters<Target["commit"]>) => runInDurableObject(stub,
      room => legacyCommittedNarrationAuthority(room as unknown as Target).commit(...args));
    const value = Reflect.get(instance, key);
    return typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, instance, args) : value;
  } });
  const result = await handleRoomAction({ ...context(target, { ...adapter, propose }), authority: authority as unknown as RoomAuthorityCapability },
    { kind: "intent", submissionId: "diagnostic:rpc", text: "我留在原地查看守灵厅。" });
  expect(result).toMatchObject({ action: "committed", narration: "retryableFailure" });
  expect(receipts.at(-1)?.failureDiagnostic).toMatchObject({ reason: "providerRateLimited", stage: "modelRequest", providerStatus: 429, retryability: "blocked" });
  const observed = await stub.observe(ALICE) as { narrationRecovery: { capability: string } };
  await handleViewerNarrationRecovery(context(target, adapter), observed.narrationRecovery.capability);
  expect(receipts.at(-1)?.failureDiagnostic).toMatchObject({ reason: "callOutcomeUnknown", stage: "invocationJournal", retryability: "blocked" });
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(receipts)).not.toContain("PRIVATE_PROVIDER_MESSAGE");
});

// SPEC 0016 §8.3: old completed style refusals can now publish the same body.
it("recovers a saved presentation rejection without a new physical call", async () => {
  const stub = await initialize("presentation-rejection-rpc");
  const target = stub as unknown as Target, calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    const publish = vi.spyOn(target, "publishDelivery").mockImplementation(async () => { throw new Error("lost publication"); });
    try {
      await handleRoomAction(context(target, { ...narrator(target, calls, "presentation"), propose }),
        { kind: "intent", submissionId: "presentation:observe", text: "我留在原地查看守灵厅。" });
    } finally { publish.mockRestore(); }
  });
  const before = await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec("UPDATE authority_delivery_audiences SET status = 'rejected', error_code = 'NARRATION_PRESENTATION_REJECTED'");
    return state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray();
  });
  await evictDurableObject(stub);
  const observed = await stub.observe(ALICE) as { narrationRecovery: { capability: string } };
  expect(observed).toMatchObject({ narrationRecovery: { state: "rejected", canRetry: true } });
  const recovered = await handleViewerNarrationRecovery(context(target, narrator(target, calls)), observed.narrationRecovery.capability);
  expect(recovered).toMatchObject({ action: "committed", narration: "published" });
  expect(calls).toEqual(["submit_frozen_narration", "review_frozen_narration"]);
  expect(await runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray())).toEqual(before);
  expect(JSON.stringify({ observed, recovered })).not.toContain("PRIVATE_REVIEW_REASON");
});

it.each(["repairAfterReview", "repairAfterRewrite", "repairAfterFinal", "repairUnknown", "repairRefused"])(
  "resumes %s on the original receipt without repeating completed or unknown calls", async mode => {
  const stub = await initialize(`bounded-${mode}`), calls: string[] = [];
  const target = stub as unknown as Target;
  await runInDurableObject(stub, async instance => {
    const room = instance as unknown as Target;
    await handleRoomAction(context(room, { ...narrator(room, calls, mode), propose }),
      { kind: "intent", submissionId: "repair:observe", text: "我留在原地查看守灵厅。" });
  });
  const before = await runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray());
  await evictDurableObject(stub);
  const observed = await stub.observe(ALICE) as { narrationRecovery: { capability: string } };
  const blocked = mode === "repairUnknown" || mode === "repairRefused";
  expect(observed).toMatchObject({ narrationRecovery: { canRetry: !blocked } });
  const capability = observed.narrationRecovery.capability;
  await runInDurableObject(stub, async (instance, state) => {
    const room = instance as unknown as Target;
    const audience = state.storage.sql.exec<{ audience_id: string; delivery_generation: number; publication_attempt: number }>(
      "SELECT audience_id, delivery_generation, publication_attempt FROM authority_delivery_audiences WHERE publish_capability = ?", capability).one();
    expect(await room.publishDelivery({ publishCapability: capability }, { frames: [{
      audienceId: audience.audience_id, deliveryGeneration: audience.delivery_generation,
      publicationAttempt: audience.publication_attempt, narration: { body: "你决定永远留在这里。" },
    }] })).toMatchObject({ kind: "rejected", code: "invalidPublication" });
  });
  const recovered = await handleViewerNarrationRecovery(context(target, narrator(target, calls)), capability);
  expect(recovered).toMatchObject({ action: "committed", narration: blocked
    ? mode === "repairUnknown" ? "retryableFailure" : "rejected" : "published" });
  // Explicit repeat cannot create a fifth call or resample unknown stage 3.
  await handleViewerNarrationRecovery(context(target, narrator(target, calls)), capability);
  expect(calls).toHaveLength(mode === "repairUnknown" ? 3 : 4);
  expect(await runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray())).toEqual(before);
  expect(JSON.stringify({ observed, recovered })).not.toContain("PRIVATE_REPAIR_REASON");
  if (!blocked) expect(JSON.stringify(await stub.observe(ALICE))).toContain(PRIVATE_RESULT);
});

it.each(["repairRefused", "repairSchema", "repairUnknown", "failsDuringRecovery"])(
  "stops a new action behind the terminal legacy predecessor %s without offering refresh/retry", async mode => {
  // SPEC 0015 §8.2: a known unrecoverable predecessor must not become a
  // retryable new submission. Preserve the old events and physical calls.
  const stub = await initialize(`terminal-predecessor-${mode}`), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const room = instance as unknown as Target;
    await handleRoomAction(context(room, { ...narrator(room, calls, mode === "failsDuringRecovery" ? "beforeModel" : mode), propose }),
      { kind: "intent", submissionId: "terminal:old", text: "我留在原地查看守灵厅。" });
  });
  await evictDurableObject(stub);
  expect(await stub.observe(ALICE)).toMatchObject({ narrationRecovery: { canRetry: mode === "failsDuringRecovery" } });
  const before = await runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray());
  const callsBefore = [...calls];
  let attemptedNarration = 0, attemptedProposal = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runInDurableObject(stub, async instance => {
      const room = instance as unknown as Target, adapter = narrator(room, calls, mode === "failsDuringRecovery" ? "repairSchema" : undefined);
      return handleRoomAction(context(room, { ...adapter,
        async narrate(request: Parameters<typeof adapter.narrate>[0]) { attemptedNarration += 1; return adapter.narrate(request); },
        async propose() { attemptedProposal += 1; return propose(); },
      }), { kind: "intent", submissionId: "terminal:new", text: "还有没走的客人？" });
    });
    expect(result).toMatchObject({ kind: "rejected", code: "narrationPredecessorBlocked", action: "notCommitted" });
    expect(publicAuthoritativeOutcomeError(result)).not.toMatch(/请刷新|重试 KP 回复/);
    expect(publicAuthoritativeOutcomeError(result)).toMatch(/前一条.*无法.*恢复/);
  }
  expect(attemptedNarration).toBe(mode === "failsDuringRecovery" ? 1 : 0);
  expect(attemptedProposal).toBe(0);
  if (mode === "failsDuringRecovery") expect(calls).toHaveLength(4);
  else expect(calls).toEqual(callsBefore);
  expect(await runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql.exec("SELECT event_json FROM authority_events ORDER BY event_seq").toArray())).toEqual(before);
});

it("recovers a ready legacy predecessor before preparing the new action", async () => {
  // SPEC 0015 §8.2: the terminal guard must preserve real recoverability.
  const stub = await initialize("recoverable-predecessor"), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const room = instance as unknown as Target;
    await handleRoomAction(context(room, { ...narrator(room, calls, "beforeModel"), propose }),
      { kind: "intent", submissionId: "ready:old", text: "我留在原地查看守灵厅。" });
  });
  expect(await stub.observe(ALICE)).toMatchObject({ narrationRecovery: { canRetry: true } });
  let proposals = 0;
  const result = await runInDurableObject(stub, async instance => {
    const room = instance as unknown as Target;
    return handleRoomAction(context(room, { ...narrator(room, calls),
      async propose() { proposals += 1; return propose(); },
    }), { kind: "intent", submissionId: "ready:new", text: "我继续查看守灵厅。" });
  });
  expect(result).toMatchObject({ action: "committed", narration: "published" });
  expect(proposals).toBe(1);
  expect(calls).toHaveLength(4);
});

it("keeps an active predecessor publisher pending instead of declaring terminal failure", async () => {
  // SPEC 0015 §8.2: canRetry=false while a publisher holds the lease does
  // not establish that the reply is terminal; it only fences replacement.
  const stub = await initialize("active-predecessor"), calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const room = instance as unknown as Target;
    await handleRoomAction(context(room, { ...narrator(room, calls, "repairUnknown"), propose }),
      { kind: "intent", submissionId: "active:old", text: "我留在原地查看守灵厅。" });
    state.storage.sql.exec("UPDATE authority_delivery_audiences SET status = 'pending', publication_lease_until = ?",
      Date.now() + NARRATION_PUBLICATION_LEASE_MS);
  });
  expect(await stub.observe(ALICE)).toMatchObject({ narrationRecovery: { state: "pending", canRetry: false } });
  const before = [...calls];
  const result = await runInDurableObject(stub, async instance => {
    const room = instance as unknown as Target;
    return handleRoomAction(context(room, { ...narrator(room, calls),
      async propose() { throw new Error("New proposal cannot overtake active publication"); },
    }), { kind: "intent", submissionId: "active:new", text: "我继续查看守灵厅。" });
  });
  expect(result).toMatchObject({ kind: "retryableFailure", code: "narrationPredecessorPending", action: "notCommitted" });
  expect(calls).toEqual(before);
});
