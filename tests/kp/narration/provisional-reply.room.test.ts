import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { handleRoomAction, handleViewerNarrationRecovery, type RoomAuthorityCapability, type KpAdapterCapability } from "../../../app/_runtime/lib/room/action";
import type { RoomDurableObject } from "../../../app/_runtime/lib/room/durable-object";
import { createJournaledNarrationAdapter } from "../../../app/_runtime/lib/room/story-narration";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { parseSubmitKpProposalBundleArguments } from "../../../app/_runtime/lib/kp/vnext/proposal-provider";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";

const ALICE = { principal: { id: "multiplayer:alice", sessionVersion: 1 } };
const OTHER = { principal: { id: "multiplayer:other", sessionVersion: 1 } };
const ACTOR = "character:multiplayer:alice";
const PRIVATE_RESULT = "你看清了私人记号。";
type Target = RoomDurableObject;
const capabilities = new Map<string, any>();
const rooms: ReturnType<typeof env.VNEXT_ROOMS.getByName>[] = [];
afterEach(async () => {
  for (const stub of rooms.splice(0)) await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAlarm(); });
});

async function initialize(name: string, viewers = [ALICE]) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  rooms.push(stub);
  const initialized = await stub.initializeAuthoritative({
    roomId: name, moduleId: "black-oak-will",
    members: viewers.map((p, i) => ({ principalId: p.principal.id, role: i === 0 ? "host" : "player" })),
    characters: viewers.map((p, i) => ({
      characterId: `character:${p.principal.id}`, controllerPrincipalId: p.principal.id,
      staticCard: {
        name: "调查员", sceneId: viewers.length === 3 && i === 2 ? "yard" : "wake",
        level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2,
        resources: { hitDice: { max: 3, used: 0 } }, skills: ["perception"], hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [],
      },
    })),
  }) as any;
  expect(initialized).toMatchObject({ created: true });
  capabilities.set(name, initialized.serviceCapabilities);
  return stub;
}

async function propose(check = false, actor = ACTOR, scene = "wake", duration = "300000000") {
  return parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle({
    mode: "adjudication", basisRefs: [scene], terminal: { kind: "none" },
    adjudication: { ...(check ? { kind: "check", checkKind: "abilityCheck", ability: "wis", skill: "perception", dc: 10, mode: "normal", failureOutcome: "没看清。" } : { kind: "directSuccess" }), durationMicros: duration, risk: "只查看眼前景象。", successOutcome: "看清眼前景象。" },
    proposals: [{
      kind: "observe", basisRefs: [scene], consumes: [], produces: [], outcomeBinding: "always", sceneRef: scene,
      inquiry: "查看守灵厅。", method: "留在原地观察。", focusRefs: [scene], existingFactRefs: [],
      branches: { success: { outcomeCode: "outcome:observed", summary: "查看了守灵厅。",
        sensoryEvidence: [{ observerRef: actor, subjectRef: scene, sense: "sight", evidence: scene === "yard" ? "院子里留下脚印。" : PRIVATE_RESULT, basisRefs: [scene] }],
        characterInferences: [],
      }, failure: check ? { outcomeCode: "outcome:missed", summary: "没看清。", sensoryEvidence: [], characterInferences: [] } : { kind: "none" } },
    }],
  })));
}

function kp(target: Target, calls: string[], mode = "pass", afterStage?: (ordinal: number) => void) {
  const ai = { async run(_model: string, input: Record<string, unknown>) {
    const tool = (input.tools as { function: { name: string } }[] | undefined)?.[0]?.function.name;
    calls.push(tool ?? "text");
    const material = sentBody(input) as any;
    const own = material.expression.viewer.characterRef === ACTOR;
    if (!own) expect(JSON.stringify(material)).not.toContain(PRIVATE_RESULT);
    if (!tool) return { choices: [{ finish_reason: "stop", message: { content: own ? PRIVATE_RESULT : "调查员结束了观察。" } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
    const fail = mode === "fail" || mode === "secondViewerFail" && !own;
    const report = fail && (mode === "secondViewerFail" || calls.length >= 4) ? { broken: true }
      : fail ? { status: "revise", issues: [{ reason: "遗漏本次观察的重要结果。" }] }
      : { status: "pass", issues: [] };
    return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name: tool, arguments: JSON.stringify(report) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
  } };
  const transport = new ActorPlanTransportCapability(ai);
  return { ...createJournaledNarrationAdapter({ ai }, async (authority, generation, ordinal, body, timeout) => {
    const response = await target.runNarrationInvocation(ALICE, authority, generation, ordinal, body, transport, timeout);
    afterStage?.(ordinal);
    return response;
  },
    async () => { throw new Error("unexpected pending"); }), propose: () => propose() };
}
const context = (target: Target, narrator: unknown) => ({ principal: ALICE,
  authority: target as unknown as RoomAuthorityCapability, kp: narrator as KpAdapterCapability });
const intent = { kind: "intent" as const, submissionId: "atomic:observe", text: "我留在原地查看守灵厅。" };

/** SPEC 0011 §7: the store assembles the persisted state from its chunk rows. */
const roomStateRow = (instance: unknown) => ({
  state_json: (instance as { authorityStore: { room(): { state_json: string } | undefined } }).authorityStore.room()!.state_json,
});

// SPEC 0015 §8.2 / SPEC 0016 §8.3: actual Room, Rules, action and physical-call journal.
it.each(["pass", "fail"])("provisional reply %s commits world and body together or cancels both", async mode => {
  const stub = await initialize(`atomic-reply-${mode}`);
  const calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    let before = roomStateRow(instance);
    let events = state.storage.sql.exec("SELECT event_json FROM authority_events").toArray();
    const narrator = kp(target, calls, mode);
    const original = narrator.narrate.bind(narrator);
    narrator.narrate = async request => {
      expect(roomStateRow(instance)).toEqual(before);
      expect(state.storage.sql.exec("SELECT event_json FROM authority_events").toArray()).toEqual(events);
      expect(JSON.stringify((target.observe(ALICE) as { delivery: unknown }).delivery)).not.toContain(PRIVATE_RESULT);
      return original(request);
    };
    const outcome = await handleRoomAction(context(target, narrator), intent);
    if (mode === "pass") {
      expect(outcome).toMatchObject({ kind: "committed", action: "committed", narration: "published" });
      expect(roomStateRow(instance)).not.toEqual(before);
      expect(target.observe(ALICE)).toMatchObject({ delivery: { kind: "current", frame: { text: PRIVATE_RESULT } } });
    } else {
      expect(outcome).toMatchObject({ kind: "rejected", action: "notCommitted", code: "actionReplyFailed" });
      const prior = JSON.parse(String(before.state_json));
      const after = JSON.parse(String(roomStateRow(instance).state_json));
      expect(after.entities).toEqual(prior.entities);
      expect(after.fictionTimelines).toEqual(prior.fictionTimelines);
      expect(after.knowledge).toEqual(prior.knowledge);
      expect(target.observe(ALICE)).toMatchObject({ narrationRecovery: { cancelled: true, action: "notCommitted", canRetry: false } });
      expect(Object.values(after.campaignRuntime.activities).every((activity: any) => activity.status !== "active")).toBe(true);
      const newEvents = state.storage.sql.exec<{ event_json: string }>("SELECT event_json FROM authority_events").toArray().slice(events.length).map(row => JSON.parse(row.event_json).eventType);
      expect(newEvents).toEqual([]);
    }
    expect(calls.length).toBe(mode === "pass" ? 2 : 4);
    const repeated = await handleRoomAction(context(target, narrator), intent);
    expect(repeated.kind).toBe(outcome.kind);
    expect(calls.length).toBe(mode === "pass" ? 2 : 4);
  });
});

// A lost publisher is recovered from the persisted physical responses, even
// after eviction. The durable deadline never permits a fifth model call.
it.each(["savedReview", "incomplete"])("deadline after eviction settles %s without calls", async mode => {
  const stub = await initialize(`atomic-deadline-${mode}`), calls: string[] = [];
  const before = await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const before = roomStateRow(instance);
    const narrator = kp(target, calls, "pass", ordinal => {
      if (ordinal === (mode === "savedReview" ? 2 : 1)) throw new Error("publisher lost after saved response");
    });
    expect(await handleRoomAction(context(target, narrator), intent)).toMatchObject({ action: "notCommitted", code: "actionReplyPending" });
    expect(roomStateRow(instance)).toEqual(before);
    return before;
  });
  await evictDurableObject(stub);
  const timer = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000);
  try {
    await runInDurableObject(stub, async (instance, state) => {
      const target = instance as unknown as Target;
      await target.alarm();
      if (mode === "savedReview") {
        expect(target.observe(ALICE)).toMatchObject({ delivery: { kind: "current", frame: { text: PRIVATE_RESULT } } });
        expect(roomStateRow(instance)).not.toEqual(before);
      } else {
        expect(roomStateRow(instance)).toEqual(before);
        expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ code: "actionReplyFailed" });
        expect(await handleRoomAction(context(target, kp(target, calls)), { ...intent, submissionId: "new-intent", text: "我重新观察。" })).toMatchObject({ kind: "committed" });
      }
    });
  } finally { timer.mockRestore(); }
  expect(calls.length).toBe(mode === "savedReview" ? 2 : 3);
});

it.each(["pass", "secondViewerFail"])("two viewers publish atomically: %s", async mode => {
  const stub = await initialize(`atomic-two-${mode}`, [ALICE, OTHER]), calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const before = roomStateRow(instance);
    const narrator = kp(target, calls, mode, () => {
      expect(roomStateRow(instance)).toEqual(before);
      expect(JSON.stringify(target.observe(ALICE))).not.toContain(PRIVATE_RESULT);
    });
    const result = await handleRoomAction(context(target, narrator), intent);
    if (mode === "pass") {
      expect(result).toMatchObject({ action: "committed", narration: "published" });
      expect(JSON.stringify(target.observe(ALICE))).toContain(PRIVATE_RESULT);
      expect(JSON.stringify(target.observe(OTHER))).toContain("调查员结束了观察。");
      expect(JSON.stringify(target.observe(OTHER))).not.toContain(PRIVATE_RESULT);
    } else {
      expect(result).toMatchObject({ action: "notCommitted", code: "actionReplyFailed" });
      expect(roomStateRow(instance)).toEqual(before);
      expect(JSON.stringify(target.observe(ALICE))).not.toContain(PRIVATE_RESULT);
    }
    expect(calls.length).toBe(4);
  });
});

it("player dice survive eviction and terminal reply cancellation without reroll or time loss", async () => {
  const stub = await initialize("atomic-dice-failure"), calls: string[] = [];
  const before = await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const before = roomStateRow(instance);
    const result = await handleRoomAction(context(target, { ...kp(target, calls), propose: () => propose(true) }), intent);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "awaitingPlayerRoll" });
    expect(calls).toHaveLength(0);
    expect(roomStateRow(instance)).toEqual(before);
    return before;
  });
  await evictDurableObject(stub);
  const observed = await stub.observe(ALICE) as any;
  expect(observed.pendingPlayerRolls).toHaveLength(1);
  const randomId = observed.pendingPlayerRolls[0].id;
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const roll = vi.spyOn(target as any, "authorityRoll").mockReturnValue(18);
    const input = { kind: "roll" as const, submissionId: "roll:atomic", randomnessId: randomId };
    try {
      const result = await handleRoomAction(context(target, kp(target, calls, "fail")), input);
      expect(result, JSON.stringify(result)).toMatchObject({ code: "actionReplyFailed", action: "notCommitted" });
      expect(roll).toHaveBeenCalledTimes(1);
      expect(roomStateRow(instance)).toEqual(before);
      expect(await handleRoomAction(context(target, kp(target, calls, "pass")), input)).toMatchObject({ code: "actionReplyFailed" });
      expect(roll).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(4);
    } finally { roll.mockRestore(); }
  });
});

it.each(["pass", "fail"])("archive round trip preserves %s settlement and its physical calls", async mode => {
  const name = `atomic-archive-${mode}`, stub = await initialize(name), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    await handleRoomAction(context(target, kp(target, calls, mode)), intent);
  });
  const exported = await stub.exportAuthoritativeArchive(capabilities.get(name).archiveExport) as any;
  expect(exported, JSON.stringify(exported)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName(`${name}-restore`);
  rooms.push(restored);
  const result = await restored.restoreAuthoritativeArchive(capabilities.get(name).disasterRecovery, exported.storyArchive);
  expect(result, JSON.stringify(result)).toMatchObject({ kind: "restored" });
  const next = await restored.exportAuthoritativeArchive(capabilities.get(name).archiveExport) as any;
  expect(next, JSON.stringify(next)).toMatchObject({ kind: "exported" });
  expect(next.archive.events).toEqual(exported.archive.events);
  if (mode === "fail") await runInDurableObject(restored, async (instance, state) => {
    const target = instance as unknown as Target;
    expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ code: "actionReplyFailed" });
  });
  expect(calls.length).toBe(mode === "pass" ? 2 : 4);
});

it("an unrelated scene can commit while a reply is pending, without cancelling either action", async () => {
  const carol = { principal: { id: "multiplayer:carol", sessionVersion: 1 } };
  const stub = await initialize("atomic-unrelated", [ALICE, OTHER, carol]), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    const narrator = kp(target, calls), original = narrator.narrate.bind(narrator);
    let intervened = false;
    narrator.narrate = async request => {
      if (!intervened) {
        intervened = true;
        const other = kp(target, [], "pass");
        other.propose = () => propose(false, "character:multiplayer:carol", "yard", "300000000");
        const result = await handleRoomAction({ ...context(target, other), principal: carol }, { ...intent, submissionId: "unrelated", text: "查看院子。" });
        expect(result, JSON.stringify(result)).toMatchObject({ action: "committed" });
      }
      return original(request);
    };
    const result = await handleRoomAction(context(target, narrator), intent);
    expect(result, JSON.stringify(result)).toMatchObject({ action: "committed", narration: "published" });
    expect(JSON.stringify(target.observe(ALICE))).toContain(PRIVATE_RESULT);
  });
});

it.each(["pass", "fail"])("resource-bearing world refusal is atomic: %s", async mode => {
  const stub = await initialize(`atomic-resource-${mode}`), calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const before = roomStateRow(instance);
    const narrator = kp(target, calls, mode);
    narrator.propose = async () => parseSubmitKpProposalBundleArguments(JSON.stringify(encodeVNextStrictToolBundle({
      mode: "terminal", basisRefs: ["wake"], adjudication: { kind: "none" }, proposals: [], terminal: {
        kind: "inWorldRefusal", intent: "耗费力气徒手搬动石炉", method: "用力搬动", ruling: {
          kind: "missingPrerequisite", publicBasis: "缺少搬动重物的工具。", prerequisites: [], nextActions: [],
          attemptCosts: [{ kind: "resource", resourceId: "hitDice", amount: 1 }],
        },
      },
    })));
    const result = await handleRoomAction(context(target, narrator), { ...intent, text: "我愿意消耗一次生命骰，试着搬动石炉。" });
    if (mode === "fail") {
      expect(result, JSON.stringify(result)).toMatchObject({ action: "notCommitted", code: "actionReplyFailed" });
      expect(roomStateRow(instance)).toEqual(before);
    } else {
      expect(result, JSON.stringify(result)).toMatchObject({ narration: "published" });
      const world = JSON.parse(String(roomStateRow(instance).state_json));
      expect(world.entities[ACTOR].resources.hitDice).toBe(2);
    }
  });
});

it("a lost commit response recovers the saved reply and never cancels or repeats costs", async () => {
  const stub = await initialize("atomic-lost-commit"), calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target, publish = target.publishDelivery.bind(target);
    const broken = vi.spyOn(target, "publishDelivery").mockImplementation(async (...args) => {
      const result = await publish(...args);
      expect(result.kind).toBe("published");
      throw new Error("response lost after durable commit");
    });
    try {
      expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ action: "committed", narration: "published" });
    } finally { broken.mockRestore(); }
    const events = state.storage.sql.exec("SELECT event_json FROM authority_events").toArray();
    expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ action: "committed" });
    expect(state.storage.sql.exec("SELECT event_json FROM authority_events").toArray()).toEqual(events);
    expect(calls).toHaveLength(2);
  });
});

it("a conflicting same-scene result cancels only the older candidate", async () => {
  const stub = await initialize("atomic-conflict"), calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target, narrator = kp(target, calls), original = narrator.narrate.bind(narrator);
    let second: unknown;
    narrator.narrate = async request => {
      const other = kp(target, []);
      expect(await handleRoomAction(context(target, other), { ...intent, submissionId: "conflict", text: "再查看房间。" })).toMatchObject({ action: "committed" });
      second = roomStateRow(instance);
      return original(request);
    };
    const result = await handleRoomAction(context(target, narrator), intent);
    expect(result, JSON.stringify(result)).toMatchObject({ action: "notCommitted", code: "actionReplyFailed" });
    expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ code: "actionReplyFailed" });
    // Cancelling the old candidate cannot reverse another committed action.
    expect(roomStateRow(instance)).toEqual(second);
  });
});

it("explicit recovery reuses a saved generation within the original deadline", async () => {
  const stub = await initialize("atomic-explicit-recovery"), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    const interrupted = kp(target, calls, "pass", ordinal => { if (ordinal === 1) throw new Error("lost publisher"); });
    expect(await handleRoomAction(context(target, interrupted), intent)).toMatchObject({ action: "notCommitted", code: "actionReplyPending" });
    const observed = target.observe(ALICE) as any;
    expect(observed.narrationRecovery).toBeDefined();
    const result = await handleViewerNarrationRecovery(context(target, kp(target, calls)), observed.narrationRecovery.capability);
    expect(result, JSON.stringify(result)).toMatchObject({ action: "committed", narration: "published" });
    expect(calls).toHaveLength(2);
  });
});

it("a publisher lost before the first call cancels durably and survives archive restore", async () => {
  const name = "atomic-before-model", stub = await initialize(name), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target, narrator = kp(target, calls);
    narrator.narrate = async () => { throw new Error("publisher lost"); };
    expect(await handleRoomAction(context(target, narrator), intent)).toMatchObject({ code: "actionReplyPending" });
  });
  const timer = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000);
  try { await runInDurableObject(stub, async instance => { await (instance as unknown as Target).alarm(); }); }
  finally { timer.mockRestore(); }
  const exported = await stub.exportAuthoritativeArchive(capabilities.get(name).archiveExport) as any;
  expect(exported, JSON.stringify(exported)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName(`${name}-restore`); rooms.push(restored);
  expect(await restored.restoreAuthoritativeArchive(capabilities.get(name).disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  await runInDurableObject(restored, async instance => {
    const target = instance as unknown as Target;
    expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ code: "actionReplyFailed" });
  });
  expect(calls).toHaveLength(0);
});

// Persist the real proposal offer/draft as well as narration, so cancellation
// archive validation cannot accidentally depend on a mocked proposal journal.
it("cancelled action archives its real proposal calls and remains terminal after restore", async () => {
  const name = "atomic-real-proposal", stub = await initialize(name), calls: string[] = [];
  await runInDurableObject(stub, async instance => {
    const target = instance as unknown as Target;
    const adapter = createVNextKpAdapter({ narrationAdapter: kp(target, calls, "fail") as any,
      journal: { begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion) },
      proposalBinding: { async run(_model, request) {
        const name = (request.tools as any[])[0].function.name;
        const body = name === "offer_kp_proposal_bundle" ? { requestedCapabilities: ["observe"] } : encodeVNextStrictToolBundle(await propose() as any);
        return { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(body) } }] } }] };
      } } });
    expect(await handleRoomAction(context(target, adapter), intent)).toMatchObject({ code: "actionReplyFailed" });
  });
  const exported = await stub.exportAuthoritativeArchive(capabilities.get(name).archiveExport) as any;
  expect(exported, JSON.stringify(exported)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName(`${name}-restore`); rooms.push(restored);
  expect(await restored.restoreAuthoritativeArchive(capabilities.get(name).disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  expect(await restored.exportAuthoritativeArchive(capabilities.get(name).archiveExport)).toMatchObject({ kind: "exported" });
  await runInDurableObject(restored, async instance => {
    const target = instance as unknown as Target;
    expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ code: "actionReplyFailed" });
  });
  expect(calls).toHaveLength(4);
});

it("a lost silent Activity stage expires without clock effects and archives its cancellation", async () => {
  const name = "atomic-silent-stage", stub = await initialize(name), calls: string[] = [];
  const before = await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target, original = roomStateRow(instance);
    (target as any).authorityRecoveryCheckpoint = (name: string) => { if (name === "afterCauseCommitBeforeDueTail") throw new Error("lost before due tail"); };
    try { await handleRoomAction(context(target, kp(target, calls)), intent); } catch { /* actual lost request */ }
    delete (target as any).authorityRecoveryCheckpoint;
    expect(state.storage.sql.exec("SELECT * FROM authority_provisional_mechanics").toArray()).toHaveLength(1);
    expect(state.storage.sql.exec("SELECT * FROM authority_provisional_replies").toArray()).toHaveLength(0);
    return original;
  });
  await evictDurableObject(stub);
  const timer = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000);
  try { await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    await target.alarm();
    expect(roomStateRow(instance)).toEqual(before);
    expect(await handleRoomAction(context(target, kp(target, calls)), intent)).toMatchObject({ code: "actionReplyFailed" });
  }); } finally { timer.mockRestore(); }
  const exported = await stub.exportAuthoritativeArchive(capabilities.get(name).archiveExport) as any;
  expect(exported, JSON.stringify(exported)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName(`${name}-restore`); rooms.push(restored);
  expect(await restored.restoreAuthoritativeArchive(capabilities.get(name).disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  expect(calls).toHaveLength(0);
});

it("a cancelled branch remains archivable after an unrelated append rebased its operational work", async () => {
  const name = "atomic-rebase-cancel", carol = { principal: { id: "multiplayer:carol", sessionVersion: 1 } };
  const stub = await initialize(name, [ALICE, OTHER, carol]), calls: string[] = [];
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target, narrator = kp(target, calls), original = narrator.narrate.bind(narrator);
    let injected = false;
    narrator.narrate = async request => {
      if (!injected) {
        injected = true;
        const other = kp(target, []); other.propose = () => propose(false, "character:multiplayer:carol", "yard");
        expect(await handleRoomAction({ ...context(target, other), principal: carol }, { ...intent, submissionId: "unrelated" })).toMatchObject({ action: "committed" });
        const row = state.storage.sql.exec<{ prepared_action_id: string }>("SELECT prepared_action_id FROM authority_provisional_replies WHERE status = 'pending'").one();
        (target as any).provisionalMechanicsReplay(row.prepared_action_id);
      }
      return original(request);
    };
    const originalPublish = target.publishDelivery.bind(target);
    const publish = vi.spyOn(target, "publishDelivery").mockImplementation(async (...args) => {
      if (calls.length) throw new Error("lost publisher after rebase");
      return originalPublish(...args);
    });
    try { expect(await handleRoomAction(context(target, narrator), intent)).toMatchObject({ action: "notCommitted" }); }
    finally { publish.mockRestore(); }
    const row = state.storage.sql.exec<{ prepared_action_id: string }>("SELECT prepared_action_id FROM authority_provisional_replies WHERE status = 'pending'").one();
    (target as any).cancelProvisionalReply(row.prepared_action_id);
  });
  const exported = await stub.exportAuthoritativeArchive(capabilities.get(name).archiveExport) as any;
  expect(exported, JSON.stringify(exported)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName(`${name}-restore`); rooms.push(restored);
  expect(await restored.restoreAuthoritativeArchive(capabilities.get(name).disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  expect(await restored.exportAuthoritativeArchive(capabilities.get(name).archiveExport)).toMatchObject({ kind: "exported" });
}, 20_000);

it("migrates existing host contexts without losing a saved reply during constructor upgrade", async () => {
  const name = "atomic-host-schema", stub = await initialize(name), calls: string[] = [];
  const saved = await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    const interrupted = kp(target, calls, "pass", ordinal => { if (ordinal === 1) throw new Error("lost publisher"); });
    await handleRoomAction(context(target, interrupted), intent);
    const rows = state.storage.sql.exec("SELECT * FROM authority_story_host_contexts").toArray();
    const schema = state.storage.sql.exec<{sql: string}>("SELECT sql FROM sqlite_master WHERE name = 'authority_story_host_contexts'").one().sql;
    state.storage.transactionSync(() => {
      state.storage.sql.exec("ALTER TABLE authority_story_host_contexts RENAME TO old_contexts");
      state.storage.sql.exec(schema.replace("'narrationSettlement', ", ""));
      state.storage.sql.exec("INSERT INTO authority_story_host_contexts SELECT * FROM old_contexts");
      state.storage.sql.exec("DROP TABLE old_contexts");
    });
    return rows;
  });
  await evictDurableObject(stub);
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target;
    expect(state.storage.sql.exec("SELECT * FROM authority_story_host_contexts").toArray()).toEqual(saved);
    const observed = target.observe(ALICE) as any;
    expect(await handleViewerNarrationRecovery(context(target, kp(target, calls)), observed.narrationRecovery.capability)).toMatchObject({ narration: "published" });
    expect(state.storage.sql.exec("SELECT * FROM authority_story_host_contexts WHERE context_kind = 'narrationSettlement'").toArray().length).toBeGreaterThan(0);
  });
  expect(calls).toHaveLength(2);
});

it("a physical reply arriving past the shared deadline is recorded but cannot revive the action", async () => {
  const stub = await initialize("atomic-late-deadline");
  await runInDurableObject(stub, async (instance, state) => {
    const target = instance as unknown as Target, before = roomStateRow(instance);
    let now = Date.now(), calls = 0;
    const timer = vi.spyOn(Date, "now").mockImplementation(() => now);
    const transport = new ActorPlanTransportCapability({ async run() {
      calls++; now += 181_000;
      return { choices: [{ finish_reason: "stop", message: { content: PRIVATE_RESULT } }] };
    } });
    const narrator = createJournaledNarrationAdapter({ ai: { async run() { throw new Error("unused"); } } },
      (authority, generation, ordinal, body, timeout) => target.runNarrationInvocation(ALICE, authority, generation, ordinal, body, transport, timeout),
      async () => { throw new Error("unused"); });
    try {
      expect(await handleRoomAction(context(target, { ...narrator, propose: () => propose() }), intent)).toMatchObject({ code: "actionReplyFailed", action: "notCommitted" });
      expect(roomStateRow(instance)).toEqual(before);
      expect(state.storage.sql.exec("SELECT status FROM story_creation_invocations").toArray()).toEqual([{ status: "completed" }]);
      expect(target.observe(ALICE)).toMatchObject({ narrationRecovery: { cancelled: true, canRetry: false } });
      expect(calls).toBe(1);
    } finally { timer.mockRestore(); }
  });
});
