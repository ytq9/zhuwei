import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi, afterEach } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import type { AuthoritativeKpAdapter, AuthoritativeModelBinding } from "../../../app/_runtime/lib/kp/authoritative-types";
import { sentBody } from "../../support/fixtures/vnext-request-layout.mjs";
import { scriptedNpcReply, scriptedNpcReview } from "../../support/fixtures/vnext-npc-replies.mjs";
import { WORLD_STORY_SELECTION_TOOL_NAME } from "../../../app/_runtime/lib/room/story-world-event";

type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:reaction:alice", sessionVersion: 1 } };
const ACTOR = "character:reaction:alice", SCENE = "wake";
const LIAN = "npc:black-oak-will:lian", VARO = "npc:black-oak-will:varo", NAES = "npc:black-oak-will:naes";
const NAES_WORDS = "奈斯在楼梯阴影里轻声说：“手倒是挺快。”";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
afterEach(() => vi.restoreAllMocks());

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "爱丽丝", sceneId: SCENE, level: 3, classId: "rogue", raceId: "human", subclassId: "thief",
        scores: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["sleight"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

/** Alice slips a coin into Lian's apron, hidden from Lian; Varo and Naes
 * both watch, so a low roll lets both of them notice. */
function covertBundle() {
  const felt = (evidence: string) => ({ observerRef: ACTOR, subjectRef: LIAN, sense: "sight", evidence, basisRefs: [LIAN] });
  const branch = (code: string, summary: string) => ({ outcomeCode: code, summary, effects: [], sensoryEvidence: [felt(summary)], pressures: [], opportunities: [] });
  return { mode: "adjudication", basisRefs: [LIAN], terminal: null,
    adjudication: { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "dex", skill: "sleight", dc: null, mode: "normal",
      risk: "莉安会发现有人碰了她的围裙。", successOutcome: "铜币悄悄落进围裙口袋。", failureOutcome: "莉安察觉有人碰了她的围裙。",
      concealment: { primaryObserverRef: LIAN, sense: "sight", evidence: "看见爱丽丝把什么东西塞进莉安的围裙口袋。", observers: [
        { observerRef: LIAN, attention: "distracted", basisRefs: [LIAN] },
        { observerRef: VARO, attention: "watching", basisRefs: [LIAN] },
        { observerRef: NAES, attention: "watching", basisRefs: [LIAN] }] } },
    proposals: [{ kind: "worldInteraction", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
      intent: "不让莉安察觉，把一枚铜币塞进她的围裙口袋。", method: "借递汤的动作挡住手。",
      targetRefs: [LIAN], directTargetRefs: [LIAN], instrumentRefs: [], abilityRef: null,
      branches: { success: branch("coin-slipped", "铜币落进了莉安的围裙口袋。"), failure: branch("coin-noticed", "莉安低头看向自己的围裙。") } }] };
}

type Capture = { calls: string[]; reactionFrames: Data[]; narrations: Data[] };
/** Naes answers aloud, or with a DC check when `naes` is "check"; Varo
 * declines, or his call fails. */
function reactionBinding(c: Capture, varo: "decline" | "fail", naes: "say" | "check" = "say"): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data, frame = sentBody(request) as Data;
    const names: string[] = request.tools.map((tool: Data) => tool.function.name);
    expect(names).toEqual(["decline_npc_reaction", "submit_kp_proposal_bundle"]);
    c.calls.push(`reaction:${frame.npcId}`);
    c.reactionFrames.push(structuredClone(frame));
    if (frame.npcId === VARO) {
      if (varo === "fail") throw new Error("provider unavailable");
      return result("decline_npc_reaction", { reason: "瓦罗不想在守灵夜惹事。" });
    }
    const evidenceRef = frame.requiredContext.entries.map((entry: Data) => entry.entryRef)
      .find((ref: string) => typeof ref === "string" && ref.startsWith(`knowledge:${NAES}:fact:concealment:`));
    const heard = (observerRef: string) => ({ observerRef, subjectRef: NAES, sense: "hearing", evidence: NAES_WORDS, basisRefs: [evidenceRef] });
    const remark = { outcomeCode: "naes-remarks", summary: "奈斯轻声点破。", effects: [], sensoryEvidence: [heard(ACTOR), heard(LIAN)], pressures: [], opportunities: [] };
    const bundle = { mode: "adjudication", basisRefs: [evidenceRef], terminal: null,
      adjudication: naes === "say" ? { kind: "directSuccess", durationMicros: "0", risk: "爱丽丝知道被人看见了。", successOutcome: "奈斯点破了这个小动作。" }
        : { kind: "check", durationMicros: "0", checkKind: "abilityCheck", ability: "cha", skill: "deception", dc: 10, mode: "normal",
          risk: "爱丽丝知道被人看见了。", successOutcome: "奈斯若无其事地点破。", failureOutcome: "奈斯的语气露了底。" },
      proposals: [{ kind: "worldInteraction", basisRefs: [evidenceRef], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
        intent: "让对方知道自己看见了。", method: "轻声说一句。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: null,
        branches: { success: remark, failure: naes === "say" ? null : { ...remark, outcomeCode: "naes-remarks-tense", summary: "奈斯点破时语气发紧。" } } }] };
    return result("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(bundle as never));
  } };
}

async function covertActWithReactions(name: string, varo: "decline" | "fail", naes: "say" | "check" = "say") {
  const c: Capture = { calls: [], reactionFrames: [], narrations: [] };
  const telemetry: Data[] = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => { try { telemetry.push(JSON.parse(String(line))); } catch { /* not telemetry */ } });
  const stub = await initialize(name);
  const outcomes = await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    const rolls: number[] = [];
    target.authorityRoll = (sides: number) => { rolls.push(sides); return 1; };
    const scope = createVNextModelCallScope({ roomId: name, limit: "12", emit() {} });
    const transport = new ActorPlanTransportCapability(scope.bind(reactionBinding(c, varo, naes)));
    const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
      commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
      resumePlayerRandomness: (context: unknown, id: string) => target.resumePlayerRandomness(context, id, transport),
      observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
      publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
      deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
      beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
      failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
    } as RoomAuthorityCapability;
    const narrationAdapter = { async narrate(request: Data) { c.narrations.push(structuredClone(request)); return { body: "已记录当前可见的行动。" }; },
      async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: scope.bind({ async run(_model, request) {
      c.calls.push("playerProposal");
      const tool = (request as Data).tools[0].function.name;
      if (tool === "offer_kp_proposal_bundle") return result(tool, { requestedCapabilities: ["worldInteraction"] });
      return result(tool, encodeVNextStrictToolBundle(covertBundle() as never));
    } }) });
    const act = (input: RoomActionInput) => handleRoomAction({ principal: ALICE, authority, kp }, input);
    const first = await act({ kind: "intent", submissionId: "slip-coin", text: "趁莉安不注意，把一枚铜币塞进她的围裙口袋" }) as Data;
    const pending = (await target.observe(ALICE) as Data).pendingPlayerRolls ?? [];
    const rolled = pending.length === 0 ? undefined
      : await act({ kind: "roll", submissionId: "slip-coin:roll", randomnessId: String(pending[0].id) } as RoomActionInput) as Data;
    const replay = target.authoritativeReplay();
    const rows = (sql: string) => target.ctx.storage.sql.exec(sql).toArray() as Data[];
    return { first, rolled, rolls, state: structuredClone(replay.state) as Data, events: structuredClone(target.authorityStore.events()) as Data[],
      due: rows("SELECT child_root_action_id, work_kind, status FROM authority_due_work") };
  });
  return { ...outcomes, c, telemetry };
}

function describe(run: Awaited<ReturnType<typeof covertActWithReactions>>): string {
  const brief = (outcome: Data | undefined) => outcome === undefined ? undefined
    : { kind: outcome.kind, code: outcome.code, explanation: outcome.explanation, due: outcome.dueOutcomes?.map((d: Data) => [d.kind, d.code]) };
  return JSON.stringify({ first: brief(run.first), rolled: brief(run.rolled), rolls: run.rolls, calls: run.c.calls, due: run.due,
    telemetry: run.telemetry.filter(t => /dueWork/.test(String(t.eventName))).map(t => [t.eventName, t.outcome?.kind]),
    events: run.events.map(e => `${e.eventType}:${String(e.rootActionId).slice(0, 36)}`) });
}

// SPEC 0006 §7: every noticing NPC other than the primary decides once, from
// its own view, in the same action; the reaction is settled and published
// with the act it noticed.
it("bystanders who notice a covert act each decide once in the same request, and a reaction is published with the act", async () => {
  const run = await covertActWithReactions("npc-reaction-room", "decline");
  const detail = describe(run);
  const final = run.rolled ?? run.first;
  expect(final.kind, detail).toBe("committed");
  const opened = run.events.filter(e => e.eventType === "NpcReactionOpened").map(e => e.payload.characterId).sort();
  expect(opened, detail).toEqual([NAES, VARO]);
  expect(run.c.calls.filter(call => call.startsWith("reaction:")).sort(), detail).toEqual([`reaction:${NAES}`, `reaction:${VARO}`]);
  const settled = Object.fromEntries(run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]));
  expect(settled, detail).toEqual({ [NAES]: "reacted", [VARO]: "declined" });
  expect(run.events.some(e => e.eventType === "SensoryEvidenceAcquired" && e.payload.characterId === ACTOR && e.payload.publicEvidence === NAES_WORDS), detail).toBe(true);
  expect(run.due.filter(row => row.status === "pending"), detail).toEqual([]);
  // Each reaction call saw only that NPC's own view.
  for (const frame of run.c.reactionFrames) {
    const refs: string[] = frame.requiredContext.entries.map((entry: Data) => entry.entryRef);
    expect(refs.filter(ref => typeof ref === "string" && ref.startsWith("knowledge:") && !ref.startsWith(`knowledge:${frame.npcId}:`)), detail).toEqual([]);
  }
  // The reaction reaches Alice in this reply: a narration of Naes's words.
  expect(run.c.narrations.some(n => JSON.stringify(n).includes("手倒是挺快")), detail).toBe(true);
}, 60_000);

it("a noticer whose call fails does not react this time; the others and the act are unaffected", async () => {
  const run = await covertActWithReactions("npc-reaction-room-lapse", "fail");
  const detail = describe(run);
  const final = run.rolled ?? run.first;
  expect(final.kind, detail).toBe("committed");
  const settled = Object.fromEntries(run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]));
  expect(settled, detail).toEqual({ [NAES]: "reacted", [VARO]: "lapsed" });
  expect(run.state.knowledge[VARO] && Object.keys(run.state.knowledge[VARO]).some((ref: string) => ref.startsWith("fact:concealment:")), detail).toBe(true);
  expect(run.due.filter(row => row.status === "pending"), detail).toEqual([]);
}, 60_000);

// SPEC 0006 §7 (with SPEC 0004 §4): a reaction whose act needs a roll is
// rolled by the Room and published in the same request. Before, its journaled
// dice moved the replay head past the reaction's frozen frame and the Room
// could not resume the reaction's act, so the reaction stayed pending.
it("a reaction whose act needs a roll is rolled and published in the same request", async () => {
  const run = await covertActWithReactions("npc-reaction-room-check", "decline", "check");
  const detail = describe(run);
  expect((run.rolled ?? run.first).kind, detail).toBe("committed");
  const naesActs = run.events.filter(e => e.eventType === "WorldInteractionResolved" && e.payload.actorCharacterId === NAES);
  expect(naesActs.map(e => [e.payload.rulingKind, e.payload.branch]), detail).toEqual([["check", "failure"]]);
  const settled = Object.fromEntries(run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]));
  expect(settled, detail).toEqual({ [NAES]: "reacted", [VARO]: "declined" });
  expect(run.due.filter(row => row.status === "pending"), detail).toEqual([]);
}, 60_000);

// SPEC 0006 §7 (ADR 0110): Alice asks Lian in front of everyone. Varo and
// Naes, the bystanders who hear it, each decide once in the same request
// whether to interject. Outside an encounter a conversation takes time, so
// it is an Activity whose result root carries its reply; an interjection
// settled after that reply is still published in the same request.
const ASK = "莉安，第三份遗嘱到底在哪？", REPLY = "我不知道，父亲没告诉我。";
const NAES_INTERJECTS = "奈斯插话：“死人的东西，还是别当众翻。”";
function conversationPlan() {
  return { mode: "adjudication", basisRefs: [LIAN], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "在场的人都听得见。", successOutcome: "莉安作答。" },
    proposals: [{ kind: "social", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: LIAN,
      actorSpeech: ASK, goal: "问出遗嘱的下落。", method: "当众直接问。", communication: "spokenConversation", audience: "sceneListeners",
      branches: { success: { outcomeCode: "outcome:answered", summary: "莉安答了一句。", npcPerceives: null,
        response: { kind: "speech", text: REPLY, motive: "照实说。", basis: [{ kind: "npcContext", ref: LIAN }] }, consequences: [] }, failure: null } }] };
}

/** Naes interjects aloud; Varo declines, or his call fails. */
function interjectionBinding(c: Capture, varo: "decline" | "fail"): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data;
    const names: string[] = request.tools.map((tool: Data) => tool.function.name);
    if (names[0] === WORLD_STORY_SELECTION_TOOL_NAME) return result(names[0], { decision: { kind: "noStory", reason: "夹具不创建故事。" } });
    expect(names).toEqual(["decline_npc_reaction", "submit_kp_proposal_bundle"]);
    const frame = sentBody(request) as Data;
    c.calls.push(`reaction:${frame.npcId}`);
    c.reactionFrames.push({ ...structuredClone(frame), sent: JSON.stringify(request.messages) });
    if (frame.npcId === VARO) {
      if (varo === "fail") throw new Error("provider unavailable");
      return result("decline_npc_reaction", { reason: "瓦罗不想当众掺和遗嘱的事。" });
    }
    const heardRef = frame.requiredContext.entries.map((entry: Data) => entry.entryRef)
      .find((ref: string) => typeof ref === "string" && ref.startsWith(`knowledge:${NAES}:claim:social:`));
    const heard = (observerRef: string) => ({ observerRef, subjectRef: NAES, sense: "hearing", evidence: NAES_INTERJECTS, basisRefs: [heardRef] });
    const bundle = { mode: "adjudication", basisRefs: [heardRef], terminal: null,
      adjudication: { kind: "directSuccess", durationMicros: "0", risk: "莉安会不高兴。", successOutcome: "奈斯插了一句。" },
      proposals: [{ kind: "worldInteraction", basisRefs: [heardRef], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE,
        intent: "把话头压下去。", method: "插一句。", targetRefs: [ACTOR], directTargetRefs: [ACTOR], instrumentRefs: [], abilityRef: null,
        branches: { success: { outcomeCode: "naes-interjects", summary: "奈斯插话。", effects: [], sensoryEvidence: [heard(ACTOR), heard(LIAN)],
          pressures: [], opportunities: [] }, failure: null } }] };
    return result("submit_kp_proposal_bundle", encodeVNextStrictToolBundle(bundle as never));
  } };
}

async function conversationWithInterjections(name: string, varo: "decline" | "fail") {
  const c: Capture = { calls: [], reactionFrames: [], narrations: [] };
  const telemetry: Data[] = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => { try { telemetry.push(JSON.parse(String(line))); } catch { /* not telemetry */ } });
  const stub = await initialize(name);
  const outcomes = await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    const scope = createVNextModelCallScope({ roomId: name, limit: "12", emit() {} });
    const transport = new ActorPlanTransportCapability(scope.bind(interjectionBinding(c, varo)));
    const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
      commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
      observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
      publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
      deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
      beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
      failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
    } as RoomAuthorityCapability;
    const narrationAdapter = { async narrate(request: Data) { c.narrations.push(structuredClone(request)); return { body: "已记录当前可见的行动。" }; },
      async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
    const plan = conversationPlan();
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: scope.bind({ async run(_model, request) {
      const tool = (request as Data).tools[0].function.name as string;
      c.calls.push(tool);
      if (tool === "offer_kp_proposal_bundle") return result(tool, { requestedCapabilities: ["social"] });
      if (tool === "review_npc_replies") return scriptedNpcReview(request);
      return scriptedNpcReply(request, plan) ?? result(tool, encodeVNextStrictToolBundle(plan as never));
    } }) });
    const first = await handleRoomAction({ principal: ALICE, authority, kp }, { kind: "intent", submissionId: "ask-lian-openly", text: `我当众问莉安：“${ASK}”` }) as Data;
    const replay = target.authoritativeReplay();
    const rows = (sql: string) => target.ctx.storage.sql.exec(sql).toArray() as Data[];
    return { first, rolled: undefined, rolls: [] as number[], state: structuredClone(replay.state) as Data,
      events: structuredClone(target.authorityStore.events()) as Data[],
      due: rows("SELECT child_root_action_id, work_kind, status FROM authority_due_work") };
  });
  return { ...outcomes, c, telemetry };
}

it("bystanders who hear a conversation each decide once in the same request; an interjection is published with it", async () => {
  const run = await conversationWithInterjections("npc-reaction-room-heard", "decline");
  const detail = describe(run);
  expect(run.first.kind, detail).toBe("committed");
  const opened = run.events.filter(e => e.eventType === "NpcReactionOpened");
  expect(opened.map(e => [e.payload.characterId, e.payload.trigger]).sort(), detail).toEqual([[NAES, "heardConversation"], [VARO, "heardConversation"]]);
  const settled = Object.fromEntries(run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]));
  expect(settled, detail).toEqual({ [NAES]: "reacted", [VARO]: "declined" });
  // Naes's words are heard by Alice and Lian.
  for (const listener of [ACTOR, LIAN]) expect(run.events.some(e => e.eventType === "SensoryEvidenceAcquired"
    && e.payload.characterId === listener && e.payload.publicEvidence === NAES_INTERJECTS), `${listener} ${detail}`).toBe(true);
  expect(run.due.filter(row => row.status === "pending"), detail).toEqual([]);
  // Each call holds both lines with their speakers, the heard instruction and only that NPC's own view.
  for (const frame of run.c.reactionFrames) {
    expect(frame.requiredContext.intent.text, detail).toBe(`本人在场听到爱丽丝对莉安·黑橡说：“${ASK}”\n莉安·黑橡回答：“${REPLY}”`);
    expect(frame.sent, detail).toContain("本人在场听到的一段交谈");
    const refs: string[] = frame.requiredContext.entries.map((entry: Data) => entry.entryRef);
    expect(refs.filter(ref => typeof ref === "string" && ref.startsWith("knowledge:") && !ref.startsWith(`knowledge:${frame.npcId}:`)), detail).toEqual([]);
  }
  expect(run.c.narrations.some(n => JSON.stringify(n).includes("别当众翻")), detail).toBe(true);
}, 60_000);

it("a bystander whose call fails does not interject this time; the conversation and the other bystander are unaffected", async () => {
  const run = await conversationWithInterjections("npc-reaction-room-heard-lapse", "fail");
  const detail = describe(run);
  expect(run.first.kind, detail).toBe("committed");
  const settled = Object.fromEntries(run.events.filter(e => e.eventType === "NpcReactionSettled").map(e => [e.payload.characterId, e.payload.outcome]));
  expect(settled, detail).toEqual({ [NAES]: "reacted", [VARO]: "lapsed" });
  expect(run.events.filter(e => e.eventType === "SourceClaimCreated").map(e => e.payload.semanticContent), detail).toEqual([ASK, REPLY]);
  expect(run.due.filter(row => row.status === "pending"), detail).toEqual([]);
  expect(run.c.narrations.some(n => JSON.stringify(n).includes("别当众翻")), detail).toBe(true);
}, 60_000);
