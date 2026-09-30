import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it, vi, afterEach } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import { npcReplyRequestBody, NPC_REPLY_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/npc-reply";
import { vnextKpConfiguration } from "../../../app/_runtime/lib/kp/vnext/runtime-policy";
import { DEFAULT_KP_MODEL } from "../../../app/_runtime/lib/kp/models";
import { roomServiceCapabilities } from "../../../app/_runtime/lib/room/archive";
import { WORLD_STORY_SELECTION_TOOL_NAME } from "../../../app/_runtime/lib/room/story-world-event";
import { scriptedNpcReply, scriptedNpcReview } from "../../support/fixtures/vnext-npc-replies.mjs";
import { wrapScriptedRevision } from "../../support/fixtures/vnext-revision-response.mjs";

// SPEC 0001 §14, SPEC 0006 §7, SPEC 0016 §§7.2, 7.3, 9.2 (ADR 0073, ADR 0074): through
// the real Room Action and Durable Object boundary, with deterministic
// provider replies. What an NPC says is written by a call that reads only that
// NPC's own view; Room saves that call with the prepared action it answers and
// commits a conversation only with the reply it saved.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:reply:alice", sessionVersion: 1 } };
const ACTOR = "character:reply:alice", LIAN = "npc:black-oak-will:lian", SCENE = "wake";
const PLAYER_PRIVATE = "PLAYER_ONLY_REPLY_CANARY", SPEECH = "你父亲的第三份遗嘱在哪里？";
const INPUT: RoomActionInput = { kind: "intent", submissionId: "ask-third-will", text: `我想套她的话，就问莉安：“${SPEECH}”` };
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
const capture = () => ({ calls: [] as string[], replyRequests: [] as Data[], correctionRequests: [] as Data[], narrations: [] as Data[], loseReply: 0, loseReview: 0, reviewRequests: [] as Data[],
  review: undefined as undefined | ((body: Data) => Data), replyChange: undefined as undefined | ((args: Data, body: Data) => Data), callLimit: "8",
  selected: ["social"], tamper: undefined as undefined | ((proposal: Data) => Data), recover: false });
type Capture = ReturnType<typeof capture>;
afterEach(() => vi.restoreAllMocks());

function plan(text = "父亲提过有第三份，可他没告诉我放在哪里。") {
  return { mode: "adjudication", basisRefs: [LIAN], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "RULING_RISK_CANARY", successOutcome: "交谈进行。" },
    proposals: [{ kind: "social", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: LIAN,
      addressedThreadRef: null, actorSpeech: SPEECH, goal: "RULING_GOAL_CANARY", method: "RULING_METHOD_CANARY", communication: "spokenConversation",
      audience: "participants", retryChange: null,
      branches: { success: { outcomeCode: "outcome:answered", summary: "RULING_SUMMARY_CANARY", npcPerceives: null,
        response: { kind: "speech", text, motive: "REPLY_MOTIVE_CANARY", basis: [{ kind: "npcContext", ref: LIAN }] }, consequences: [] }, failure: null } }] };
}
async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "阿莱莎", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
    fixtureFacts: [{ knowledgeRef: "knowledge:reply:player", holderEntityId: ACTOR, content: PLAYER_PRIVATE }],
  } as never)).toMatchObject({ created: true });
  return stub;
}
/** `proposal` is the complete plan the scripted model holds. `corrected`, when
 * given, is the plan it holds once the ruling is asked to correct itself. */
async function run(stub: Stub, c: Capture, proposal?: unknown, input: RoomActionInput = INPUT, corrected?: unknown) {
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "npc-reply-room-test", limit: c.callLimit, emit() {} });
  const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, request) {
    const name = (request as Data).tools[0].function.name;
    if (name === WORLD_STORY_SELECTION_TOOL_NAME) return result(name, { decision: { kind: "noStory", reason: "夹具不创建故事。" } });
    throw new Error(`unexpected world call ${name}`);
  } }));
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
  const adapter = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run(_model, request) {
    const names = ((request as Data).tools as Data[]).map(tool => tool.function.name as string);
    const correcting = names.includes("correct_kp_proposal_bundle"), name = correcting ? "correct_kp_proposal_bundle" : names[0];
    c.calls.push(name);
    if (proposal === undefined) throw new Error("every saved call must be reused");
    if (name === "offer_kp_proposal_bundle") return result(name, { requestedCapabilities: c.selected });
    if (name === "review_npc_replies") {
      c.reviewRequests.push(structuredClone(request as Data));
      if (c.loseReview > 0) { c.loseReview -= 1; throw new Error("the review response was lost after dispatch"); }
      return c.review === undefined ? scriptedNpcReview(request) : result(name, c.review(JSON.parse((request as Data).messages[1].content)));
    }
    const reply = scriptedNpcReply(request, proposal, c.replyChange);
    if (reply === undefined) {
      if (!correcting) return result(name, encodeVNextStrictToolBundle(proposal));
      if (corrected === undefined) throw new Error("the scripted model was not asked to hold a corrected plan");
      c.correctionRequests.push(structuredClone(request as Data));
      return wrapScriptedRevision(result(name, encodeVNextStrictToolBundle(corrected)), request);
    }
    c.replyRequests.push(structuredClone(request as Data));
    if (c.loseReply > 0) { c.loseReply -= 1; throw new Error("the NPC's reply was lost after dispatch"); }
    return reply;
  } }) });
  const kp = c.tamper === undefined ? adapter
    : { ...adapter, propose: async (request: never) => c.tamper!(structuredClone(await adapter.propose(request)) as Data) };
  return handleRoomAction({ principal: ALICE, authority, kp: kp as never }, c.recover ? { ...input, recoverProposal: true } as never : input);
}
async function snapshot(stub: Stub) { return runInDurableObject(stub, (instance, context) => {
  const t = instance as unknown as Data, replay = t.authoritativeReplay();
  const prepared = t.authorityStore.submission(INPUT.submissionId)?.prepared_action_id as string | undefined;
  const rows = (sql: string, ...bind: unknown[]) => context.storage.sql.exec(sql, ...bind).toArray() as Data[];
  return { state: structuredClone(replay.state) as Data, events: structuredClone(t.authorityStore.events()) as Data[], prepared,
    stages: prepared === undefined ? [] : t.authorityStore.vnextInvocationOrdinals(prepared).map((ordinal: number) => {
      const row = t.vnextInvocation(prepared, ordinal);
      return { ordinal, status: row.status, purpose: row.binding.purpose, key: row.binding.invocationKey, bindingHash: row.binding_hash,
        ticket: row.repair_ticket_json === null ? null : JSON.parse(row.repair_ticket_json), request: JSON.parse(row.request_json), response: row.invocation.response };
    }) as Data[],
    superseded: prepared === undefined ? [] : rows("SELECT round, ordinal FROM authority_vnext_superseded_stage_proofs WHERE prepared_action_id = ? ORDER BY round, ordinal", prepared),
  };
}); }
const spoken = (events: Data[]) => events.filter(event => event.eventType === "SourceClaimCreated").map(event => event.payload.semanticContent);

it("Lian answers in her own call, which reads her own view and none of the host's truth, the ruling or the player's records", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-reply-room-own-view"), before = await snapshot(stub);
  const outcome = await run(stub, c, plan());
  expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
  expect(c.calls).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME, "review_npc_replies"]);
  const committed = await snapshot(stub);
  expect(spoken(committed.events)).toEqual([SPEECH, "父亲提过有第三份，可他没告诉我放在哪里。"]);
  // The host's frozen context holds the truth of the module; her own call is sent none of it.
  const host = JSON.stringify(committed.stages[1].request), asked = JSON.stringify(c.replyRequests[0]);
  for (const truth of ["第三份藏在神龛石座夹层", "枯骨会"]) { expect(host).toContain(truth); expect(asked).not.toContain(truth); }
  // Her own records: who she is, what she wants, and what she remembers of the will.
  for (const own of ["保住父亲的房子", "父亲亲口说过还留有第三份遗嘱，但我没有见过原件，也不知道藏处和完整正文", "本地店里的口吻"]) expect(asked).toContain(own);
  // What the module lists as unknown to her names things she has never heard of; it is the host's to read.
  expect(host).toContain("initialUnknowns"); expect(asked).not.toContain("initialUnknowns"); expect(asked).not.toContain("奈斯的真实身份");
  for (const hidden of ["石座夹层", "奈斯卡尔，枯骨会祭师", "他改了第一份遗嘱最后三行", "开启神龛，唱完摇篮曲", PLAYER_PRIVATE, "我想套她的话",
    "RULING_GOAL_CANARY", "RULING_METHOD_CANARY", "RULING_SUMMARY_CANARY", "RULING_RISK_CANARY"]) expect(asked, hidden).not.toContain(hidden);
  const body = npcReplyRequestBody(c.replyRequests[0])!;
  expect(body.npcRef).toBe(LIAN);
  expect(body.hearing).toMatchObject({ speaker: { ref: ACTOR, name: "阿莱莎" }, speech: SPEECH, audience: "participants", newKnowledge: [],
    outcomes: { result: { swayed: "notAsked", perceived: [] } } });
  expect((body.view.entries as Data[]).every(entry => entry.entryRef === `npc-decision:${LIAN}` || entry.entryRef === `knowledge-directory:${LIAN}`
    || String(entry.entryRef).startsWith(`knowledge:${LIAN}:`))).toBe(true);
  // Room saved the reply's call with the prepared action, after the ruling's calls, as a call of that proposal.
  expect(committed.stages.map(stage => [stage.ordinal, stage.status, stage.purpose, stage.key])).toEqual([
    [1, "completed", "proposal", `proposal:${committed.prepared}:1`], [2, "completed", "proposal", `proposal:${committed.prepared}:2`],
    [11, "completed", "proposal", `proposal:${committed.prepared}:11`], [139, "completed", "proposal", `proposal:${committed.prepared}:139`]]);
  expect(committed.stages[2]).toMatchObject({ bindingHash: vnextKpConfiguration(DEFAULT_KP_MODEL).workflowHash,
    ticket: { schema: "zhuwei.npc-reply-ticket/vnext-1", attempt: 1, retry: null, hearing: { npcRef: LIAN, speech: SPEECH } } });
  // A repeated request and an evicted Room read the saved calls; nothing is asked again.
  const calls = [...c.calls];
  await evictDurableObject(stub);
  expect(await run(stub, c)).toMatchObject({ kind: "committed" });
  expect(c.calls).toEqual(calls); expect((await snapshot(stub)).events).toEqual(committed.events);
  // The archive carries the reply's stage with the others and restores it as recorded.
  const capabilities = roomServiceCapabilities();
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported, JSON.stringify(exported).slice(0, 400)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName("npc-reply-room-own-view-restored");
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  const copy = await snapshot(restored);
  expect(copy.state).toEqual(committed.state);
  expect(copy.stages.map(stage => [stage.ordinal, stage.status, stage.ticket, stage.response])).toEqual(
    committed.stages.map(stage => [stage.ordinal, stage.status, stage.ticket, stage.response]));
  expect(before.events.length).toBeLessThan(committed.events.length);
}, 60_000);

// SPEC 0016 §7.2 (ADR 0074): the reply's call is a stage of the proposal. When
// its outcome is unknown, an ordinary repeat only reads the saved state; the
// player's explicit recovery sends the same request once more, and that one
// replacement is the only one this source has, shared with the ruling's calls.
it("an unknown reply is sent once more only on the player's explicit recovery, with the same request", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-reply-room-recovery"), before = await snapshot(stub);
  c.loseReply = 1;
  const lost = await run(stub, c, plan());
  expect(lost, JSON.stringify(lost)).toMatchObject({ kind: "retryableFailure", code: "PROPOSAL_RECOVERY_REQUIRED", action: "notCommitted" });
  expect(c.calls).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME]);
  const waiting = await snapshot(stub);
  expect(waiting.events).toEqual(before.events);
  expect(waiting.stages.map(stage => [stage.ordinal, stage.status])).toEqual([[1, "completed"], [2, "completed"], [11, "unknown"]]);
  await evictDurableObject(stub);
  // An ordinary repeat asks nobody.
  expect(await run(stub, c, plan())).toMatchObject({ kind: "retryableFailure", code: "PROPOSAL_RECOVERY_REQUIRED" });
  expect(c.calls).toHaveLength(3);
  c.recover = true;
  const recovered = await run(stub, c, plan());
  expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");
  expect(c.calls).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME, NPC_REPLY_TOOL_NAME, "review_npc_replies"]);
  expect(c.replyRequests[1]).toEqual(c.replyRequests[0]);
  const committed = await snapshot(stub);
  expect(spoken(committed.events)).toEqual([SPEECH, "父亲提过有第三份，可他没告诉我放在哪里。"]);
  expect(committed.stages.map(stage => [stage.ordinal, stage.status, stage.key])).toEqual([
    [1, "completed", `proposal:${committed.prepared}:1`], [2, "completed", `proposal:${committed.prepared}:2`],
    [11, "completed", `proposal:${committed.prepared}:11:explicit-recovery:1`], [139, "completed", `proposal:${committed.prepared}:139`]]);
  const calls = [...c.calls];
  await evictDurableObject(stub);
  expect(await run(stub, c)).toMatchObject({ kind: "committed" });
  expect(c.calls).toEqual(calls); expect((await snapshot(stub)).events).toEqual(committed.events);
  // The archive keeps the unknown call and its replacement, and restores the result.
  const capabilities = roomServiceCapabilities();
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported, JSON.stringify(exported).slice(0, 400)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName("npc-reply-room-recovery-restored");
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  expect((await snapshot(restored)).state).toEqual(committed.state);
}, 60_000);

it("the replacement of an unknown reply is the only one: lost again, the action cannot be recovered a second time", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-reply-room-recovery-spent"), before = await snapshot(stub);
  c.loseReply = 2;
  expect(await run(stub, c, plan())).toMatchObject({ kind: "retryableFailure", code: "PROPOSAL_RECOVERY_REQUIRED" });
  c.recover = true;
  const again = await run(stub, c, plan());
  expect(again, JSON.stringify(again)).toMatchObject({ code: "PROPOSAL_RECOVERY_EXHAUSTED", action: "notCommitted" });
  expect(c.calls).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME, NPC_REPLY_TOOL_NAME]);
  for (const recover of [true, false]) {
    c.recover = recover;
    await evictDurableObject(stub);
    expect(await run(stub, c, plan())).toMatchObject({ code: "PROPOSAL_RECOVERY_EXHAUSTED", action: "notCommitted" });
    expect(c.calls).toHaveLength(4);
  }
  expect((await snapshot(stub)).events).toEqual(before.events); expect(c.narrations).toEqual([]);
}, 60_000);

it("a version change asks the ruling and the reply anew and keeps the earlier round, the unknown call with it", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-reply-room-unknown"), before = await snapshot(stub);
  c.loseReply = 1;
  expect(await run(stub, c, plan())).toMatchObject({ kind: "retryableFailure", code: "PROPOSAL_RECOVERY_REQUIRED" });
  const waiting = await snapshot(stub);
  expect(waiting.events).toEqual(before.events);
  expect(waiting.stages.map(stage => [stage.ordinal, stage.status])).toEqual([[1, "completed"], [2, "completed"], [11, "unknown"]]);
  // SPEC 0016 §9.2: a deploy changed the workflow while this proposal was unfinished.
  await runInDurableObject(stub, (_instance, context) => {
    context.storage.sql.exec("UPDATE authority_vnext_stage_proofs SET binding_hash = ? WHERE prepared_action_id = ?", `sha256:${"0".repeat(64)}`, waiting.prepared);
  });
  const asked = await run(stub, c, plan("我不知道。父亲只说过有这么一份。"));
  expect(asked.kind, JSON.stringify(asked)).toBe("committed");
  expect(c.calls.slice(3)).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME, "review_npc_replies"]);
  const committed = await snapshot(stub);
  expect(spoken(committed.events)).toEqual([SPEECH, "我不知道。父亲只说过有这么一份。"]);
  expect(committed.stages.map(stage => [stage.ordinal, stage.status, stage.key])).toEqual([
    [1, "completed", `proposal:${committed.prepared}:1@r1`], [2, "completed", `proposal:${committed.prepared}:2@r1`],
    [11, "completed", `proposal:${committed.prepared}:11@r1`], [139, "completed", `proposal:${committed.prepared}:139@r1`]]);
  expect(committed.superseded).toEqual([{ round: 0, ordinal: 1 }, { round: 0, ordinal: 2 }, { round: 0, ordinal: 11 }]);
  const capabilities = roomServiceCapabilities();
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported, JSON.stringify(exported).slice(0, 400)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName("npc-reply-room-unknown-restored");
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  expect((await snapshot(restored)).superseded).toEqual(committed.superseded);
}, 60_000);

// SPEC 0016 §7.2: what lowering holds against a complete plan is answered by
// the ruling's correction when its diagnostics name the field and allow a
// revision, whatever code the rejection carries. Round 153-4 ended here: the
// ruling wrote a relation change that named the oak leaf's item entry, the
// rejection carried DEFINITION_CONFLICT, and the action was refused with three
// corrections unspent. Lian hears the same after the correction, so the reply
// she gave is kept and she is not asked again.
it("a lowering rejection placed at an effect of the ruling is corrected, and the reply already given is kept", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-reply-room-effect-corrected"), before = await snapshot(stub);
  c.selected = ["worldInteraction", "social"];
  const leaf = (Object.values(before.state.campaignRuntime.itemSystem.entries) as Data[])
    .find(entry => entry.definitionRef === "item-definition:module:black-oak-will:oak-leaf")!.entryId as string;
  const withAct = (effects: Data[]) => { const talk = plan();
    return { ...talk, basisRefs: [LIAN, leaf], proposals: [{ kind: "worldInteraction", basisRefs: [leaf], consumes: [], produces: [], outcomeBinding: "always",
      sceneRef: SCENE, targetRefs: [leaf], directTargetRefs: [leaf], instrumentRefs: [], abilityRef: null,
      intent: "替赫斯整理衣领时碰一碰那片叶子。", method: "整理衣领，指尖顺势碰到叶梗。",
      branches: { success: { outcomeCode: "outcome:leaf-touched", summary: "指尖碰到了叶梗。", effects,
        sensoryEvidence: [{ observerRef: ACTOR, subjectRef: leaf, sense: "touch", evidence: "叶梗干而脆。", basisRefs: [leaf] }],
        pressures: [], opportunities: [] }, failure: null } }, ...talk.proposals] }; };
  const input = { ...INPUT, text: `我替赫斯整理衣领，指尖碰了碰他嘴里那片黑橡叶，同时问莉安：“${SPEECH}”` };
  const outcome = await run(stub, c, withAct([{ kind: "relationTransition", relationRef: leaf, toState: "active" }]), input, withAct([]));
  expect(outcome.kind, JSON.stringify(outcome).slice(0, 600)).toBe("committed");
  expect(c.calls).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME, "review_npc_replies", "correct_kp_proposal_bundle", "review_npc_replies"]);
  expect(c.replyRequests).toHaveLength(1);
  const committed = await snapshot(stub);
  expect(committed.stages.map(stage => [stage.ordinal, stage.status])).toEqual([[1, "completed"], [2, "completed"], [3, "completed"], [11, "completed"], [139, "completed"], [140, "completed"]]);
  // The correction was granted for what Room's own lowering holds against the
  // saved plan, placed at the field the ruling wrote.
  const ticket = committed.stages[2].ticket as Data;
  expect(ticket).toMatchObject({ validationCode: "PROPOSAL_RULES_DIAGNOSTIC", round: 1 });
  expect(ticket.diagnostics).toEqual([expect.objectContaining({ code: "CONSTRAINT_CONFLICT", constraint: "world-interaction:semantic-definition-unavailable" })]);
  expect((ticket.diagnostics[0].path as unknown[]).at(-1)).toBe("relationRef");
  expect(spoken(committed.events)).toEqual([SPEECH, "父亲提过有第三份，可他没告诉我放在哪里。"]);
  // The act and the conversation each resolved; the act carries no effect.
  const resolved = committed.events.filter(event => event.eventType === "WorldInteractionResolved");
  expect(resolved).toHaveLength(2);
  expect(resolved.flatMap(event => (event.payload.effects ?? []) as Data[])).toEqual([]);
  // A repeated request and an evicted Room read the saved calls.
  const calls = [...c.calls];
  await evictDurableObject(stub);
  expect(await run(stub, c, undefined, input)).toMatchObject({ kind: "committed" });
  expect(c.calls).toEqual(calls); expect((await snapshot(stub)).events).toEqual(committed.events);
}, 60_000);

it("Room commits a conversation only with the reply it saved for what the plan lets the NPC hear", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const [name, tamper] of [
    ["words", (proposal: Data) => { proposal.proposals[0].branches.success.response.text = "第三份遗嘱在神龛石座的夹层里。"; return proposal; }],
    ["undertaking", (proposal: Data) => { proposal.proposals[0].branches.success.consequences.push({ kind: "debt", obligation: "欠对方一个人情。", condition: "无。", basisFactRefs: [] }); return proposal; }],
    ["heard", (proposal: Data) => { proposal.proposals[0].actorSpeech = "把铜钥交给我。"; return proposal; }],
  ] as const) {
    const c = capture(), stub = await initialize(`npc-reply-room-tamper-${name}`), before = await snapshot(stub);
    c.tamper = tamper;
    const refused = await run(stub, c, plan());
    expect(refused.kind, `${name}: ${JSON.stringify(refused).slice(0, 300)}`).not.toBe("committed");
    expect((await snapshot(stub)).events, name).toEqual(before.events);
    expect(c.narrations, name).toEqual([]);
  }
}, 60_000);

it("a Room created before NPC replies keeps its saved stages and takes the new ordinals after the constructor upgrade", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-reply-room-schema");
  const earlier: RoomActionInput = { kind: "intent", submissionId: "ask-before-upgrade", text: `我问莉安：“${SPEECH}”` };
  expect(await run(stub, c, plan(), earlier)).toMatchObject({ kind: "committed" });
  const tables = ["authority_vnext_stage_proofs", "authority_vnext_superseded_stage_proofs"];
  const saved = await runInDurableObject(stub, (_instance, context) => {
    // The Room as it was before this change: both tables admit the ruling's
    // six ordinals only, and hold what such a Room could hold.
    context.storage.sql.exec("DELETE FROM authority_vnext_stage_proofs WHERE ordinal > 6");
    const rows = tables.map(table => context.storage.sql.exec(`SELECT * FROM ${table} ORDER BY prepared_action_id, ordinal`).toArray());
    context.storage.transactionSync(() => { for (const table of tables) {
      const schema = context.storage.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = ?", table).one().sql;
      expect(schema).toContain("ordinal BETWEEN 1 AND 154");
      context.storage.sql.exec(`ALTER TABLE ${table} RENAME TO ${table}_new`);
      context.storage.sql.exec(schema.replace("ordinal BETWEEN 1 AND 154", "ordinal IN (1, 2, 3, 4, 5, 6)"));
      context.storage.sql.exec(`INSERT INTO ${table} SELECT * FROM ${table}_new`);
      context.storage.sql.exec(`DROP TABLE ${table}_new`);
    } });
    expect(() => context.storage.sql.exec(`INSERT INTO authority_vnext_stage_proofs VALUES ('prepared:old', 11, 'c', 'b', 'r', NULL, 'invocation:old', '{}')`)).toThrow();
    return rows;
  });
  expect(saved[0]).toHaveLength(2);
  await evictDurableObject(stub);
  await runInDurableObject(stub, (_instance, context) => {
    for (const [index, table] of tables.entries()) {
      expect(context.storage.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = ?", table).one().sql).toContain("ordinal BETWEEN 1 AND 154");
      expect(context.storage.sql.exec(`SELECT * FROM ${table} ORDER BY prepared_action_id, ordinal`).toArray()).toEqual(saved[index]);
      expect(context.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = ?", `${table}_six_ordinals`).toArray()).toEqual([]);
    }
  });
  // Write and read back through the upgraded tables: a new conversation saves its reply on ordinal 11.
  expect(await run(stub, c, plan("这件事我真的不清楚。"))).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  expect(after.stages.map(stage => [stage.ordinal, stage.status])).toEqual([[1, "completed"], [2, "completed"], [11, "completed"], [139, "completed"]]);
  await evictDurableObject(stub);
  expect((await snapshot(stub)).stages).toEqual(after.stages);
}, 60_000);

// SPEC 0006 §7, SPEC 0016 §§7.2, 7.3: phase A crosses the actual Room boundary.
const HISTORY = "父亲每周来守灵厅两次。", ORIGIN = "PRIVATE_REVIEW_ORIGIN_我经常与他一起来";
const introduced = { id: "visits", label: "父亲的习惯", content: HISTORY, occurrence: "父亲生前。", attitude: "believed", source: ORIGIN };
function passReview(body: Data, decision = "approve"): Data {
  return { status: "pass", privateReason: "PRIVATE_REVIEW_REASON_主持人审核通过", findings: [], verdicts: body.candidates.map((candidate: Data) => ({
    hearingHash: candidate.hearingHash, outcome: candidate.outcome, introductionId: candidate.introduction.id,
    decision, existingRef: null, explanation: "与已固定身份相容，属于有本人亲历依据的生活留白。" })) };
}

it("reviewed history, own knowledge and heard claims commit together, remain readable after six rounds and restore from the archive", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-review-history");
  c.replyChange = args => { args.result.introducedContent = [introduced]; return args; };
  c.review = body => passReview(body);
  const question = "你父亲生前常来守灵厅吗？", historyPlan = plan(HISTORY);
  historyPlan.proposals[0].actorSpeech = question;
  const first = await run(stub, c, historyPlan, { ...INPUT, text: `我问莉安：“${question}”` });
  expect(first, JSON.stringify(first)).toMatchObject({ kind: "committed" });
  const saved = await snapshot(stub);
  const history = Object.values(saved.state.campaignRuntime.definitions).find((d: any) => d.semanticKind === "worldFact" && d.content.description === HISTORY) as Data;
  expect(history).toBeDefined();
  expect(Object.values(saved.state.knowledge[LIAN]).some((k: any) => k.knowledgeRef === `fact:${history.definitionId}`)).toBe(true);
  expect(saved.state.knowledge[ACTOR][`fact:${history.definitionId}`]).toBeUndefined();
  expect(JSON.stringify(c.narrations)).not.toContain(ORIGIN);
  expect(JSON.stringify(c.narrations)).not.toContain("PRIVATE_REVIEW_REASON");
  c.replyChange = undefined;
  for (let i = 0; i < 7; i++) {
    const next = plan(`第${i}次闲聊，我听见了。`); next.proposals[0].actorSpeech = `这是第${i}个不同的问题。`;
    expect(await run(stub, c, next, { kind: "intent", submissionId: `history-later-${i}`, text: next.proposals[0].actorSpeech })).toMatchObject({ kind: "committed" });
  }
  const last = npcReplyRequestBody(c.replyRequests.at(-1))!;
  expect(JSON.stringify(last.view)).toContain(HISTORY);
  await evictDurableObject(stub);
  const capabilities = roomServiceCapabilities(), exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported).toMatchObject({ kind: "exported" });
  const copy = env.VNEXT_ROOMS.getByName("npc-review-history-copy");
  expect(await copy.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  expect((await snapshot(copy)).state).toEqual((await snapshot(stub)).state);
}, 60_000);

it("a false claim remains a claim with the speaker's private origin, and forged reviewed facts cannot commit", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-review-false-claim"), before = await snapshot(stub);
  c.replyChange = args => { args.result.introducedContent = [{ ...introduced, attitude: "deception" }]; return args; };
  c.review = body => passReview(body, "claim");
  expect(await run(stub, c, plan(HISTORY))).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  expect(after.state.canonicalFacts).toEqual(before.state.canonicalFacts);
  expect(Object.values(after.state.campaignRuntime.sourceClaims).some((claim: any) => claim.speakerId === LIAN && claim.motive.includes(ORIGIN))).toBe(true);
  expect(JSON.stringify(c.narrations)).not.toContain(ORIGIN);
  const bad = capture(), target = await initialize("npc-review-tampered-fact");
  bad.replyChange = args => { args.result.introducedContent = [introduced]; return args; };
  bad.review = body => passReview(body);
  bad.tamper = proposal => { const fact = proposal.proposals.find((p: Data) => p.semanticKind === "worldFact"); fact.definition.description = "替换后的往事"; return proposal; };
  const original = await snapshot(target), rejected = await run(target, bad, plan(HISTORY));
  expect(rejected.kind).not.toBe("committed"); expect((await snapshot(target)).events).toEqual(original.events);
}, 60_000);

it("whole-reply review catches an empty-table omission, only the NPC corrects its words, and private review reasons never reach it", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-review-reask"); let reviews = 0, replies = 0;
  c.replyChange = args => { if (++replies === 2) args.result.text = "这件事我不知道。"; return args; };
  c.review = body => ++reviews === 1 ? { ...passReview(body), status: "revise", privateReason: "HOST_ONLY_真正藏处在神龛石座夹层",
    findings: [{ hearingHash: body.replies[0].hearingHash, outcome: "result", field: "text", reason: "undeclaredContent", ownRefs: [] }] } : passReview(body);
  expect(await run(stub, c, plan("没有登记的无依据说法。"))).toMatchObject({ kind: "committed" });
  expect(c.replyRequests).toHaveLength(2); expect(c.reviewRequests).toHaveLength(2);
  expect(JSON.stringify(c.replyRequests[1])).toContain("npc-review:undeclaredContent");
  expect(JSON.stringify(c.replyRequests[1])).not.toContain("石座夹层");
  expect(spoken((await snapshot(stub)).events)).toEqual([SPEECH, "这件事我不知道。"]);
  const exhausted = capture(), bad = await initialize("npc-review-exhausted");
  exhausted.replyChange = args => { args.result.text += exhausted.replyRequests.length; return args; };
  exhausted.review = body => ({ ...passReview(body), status: "revise", findings: [{ hearingHash: body.replies[0].hearingHash,
    outcome: "result", field: "text", reason: "unsupportedKnowledge", ownRefs: [] }] });
  const before = await snapshot(bad);
  expect((await run(bad, exhausted, plan())).kind).not.toBe("committed");
  expect((await snapshot(bad)).events).toEqual(before.events); expect(exhausted.replyRequests).toHaveLength(2);
}, 60_000);

it("an unknown review is not repeated; explicit recovery reuses its exact request and shares the only root replacement", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-review-recovery"), before = await snapshot(stub);
  c.loseReview = 1;
  expect(await run(stub, c, plan())).toMatchObject({ kind: "retryableFailure", code: "PROPOSAL_RECOVERY_REQUIRED" });
  const waiting = await snapshot(stub); expect(waiting.events).toEqual(before.events);
  expect(waiting.stages.at(-1)).toMatchObject({ ordinal: 139, status: "unknown" });
  await evictDurableObject(stub);
  const calls = c.calls.length;
  expect(await run(stub, c, plan())).toMatchObject({ code: "PROPOSAL_RECOVERY_REQUIRED" }); expect(c.calls).toHaveLength(calls);
  c.recover = true;
  expect(await run(stub, c, plan())).toMatchObject({ kind: "committed" });
  expect(c.replyRequests).toHaveLength(1); expect(c.reviewRequests).toHaveLength(2); expect(c.reviewRequests[1]).toEqual(c.reviewRequests[0]);
  const shared = capture(), limited = await initialize("npc-review-shared-recovery"); shared.loseReply = 1; shared.loseReview = 1;
  expect(await run(limited, shared, plan())).toMatchObject({ code: "PROPOSAL_RECOVERY_REQUIRED" });
  shared.recover = true;
  expect(await run(limited, shared, plan())).toMatchObject({ code: "PROPOSAL_RECOVERY_EXHAUSTED" });
  const used = shared.calls.length;
  expect(await run(limited, shared, plan())).toMatchObject({ code: "PROPOSAL_RECOVERY_EXHAUSTED" }); expect(shared.calls).toHaveLength(used);
}, 60_000);

// SPEC 0016 §7.2 (ADR 0077), ZW-munycxry: the review sent Lian's reply back,
// and her second reply named several members twice. That reply is sent once
// more with the same request; a readable resend goes on to the second review.
it("an unreadable second reply is sent once more with the same request, and the action commits", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-review-unreadable-second-reply"), before = await snapshot(stub);
  let reviews = 0, replies = 0;
  c.review = body => ++reviews === 1 ? { ...passReview(body), status: "revise",
    findings: [{ hearingHash: body.replies[0].hearingHash, outcome: "result", field: "text", reason: "inconsistentConsequence", ownRefs: [] }] } : passReview(body);
  c.replyChange = args => { replies += 1; if (replies === 2) return JSON.stringify(args).replace('"kind":', '"kind":"speech","kind":') as never;
    if (replies === 3) args.result.text = "这件事我真的不清楚。"; return args; };
  const outcome = await run(stub, c, plan());
  expect(outcome.kind, JSON.stringify(outcome).slice(0, 400)).toBe("committed");
  expect(c.calls).toEqual(["offer_kp_proposal_bundle", "submit_kp_proposal_bundle", NPC_REPLY_TOOL_NAME, "review_npc_replies",
    NPC_REPLY_TOOL_NAME, NPC_REPLY_TOOL_NAME, "review_npc_replies"]);
  expect(c.replyRequests[2]).toEqual(c.replyRequests[1]);
  const committed = await snapshot(stub);
  expect(committed.stages.map(stage => [stage.ordinal, stage.ticket?.attempt ?? null, stage.ticket?.resend ?? null])).toEqual([
    [1, null, null], [2, null, null], [11, 1, null], [12, 2, null], [13, 2, true], [139, 1, null], [140, 2, null]]);
  expect(spoken(committed.events)).toEqual([SPEECH, "这件事我真的不清楚。"]);
  expect(before.events.length).toBeLessThan(committed.events.length);
  const calls = [...c.calls];
  await evictDurableObject(stub);
  expect(await run(stub, c)).toMatchObject({ kind: "committed" });
  expect(c.calls).toEqual(calls);
  // Sent again and unreadable again, the action ends without a fourth reply.
  const twice = capture(), ended = await initialize("npc-review-unreadable-twice"), start = await snapshot(ended);
  let asked = 0;
  twice.review = body => ({ ...passReview(body), status: "revise",
    findings: [{ hearingHash: body.replies[0].hearingHash, outcome: "result", field: "text", reason: "inconsistentConsequence", ownRefs: [] }] });
  twice.replyChange = args => ++asked === 1 ? args : JSON.stringify(args).replace('"kind":', '"kind":"speech","kind":') as never;
  expect((await run(ended, twice, plan())).kind).not.toBe("committed");
  expect(twice.replyRequests).toHaveLength(3); expect(twice.reviewRequests).toHaveLength(1);
  expect((await snapshot(ended)).events).toEqual(start.events);
}, 60_000);

// ZW-munycxry, the action before it: the review approved an item the NPC had
// marked as heard from others. The unusable review is sent once more with the
// same request, and a usable one lets the action commit.
it("an unusable review is sent once more with the same request and spends no review stage", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize("npc-review-unusable-resent");
  c.replyChange = args => { args.result.introducedContent = [{ ...introduced, attitude: "reported" }]; return args; };
  let reviews = 0;
  c.review = body => { reviews += 1;
    expect(body.candidates.map((candidate: Data) => candidate.allowedDecisions)).toEqual([["claim", "existing", "revise"]]);
    return passReview(body, reviews === 1 ? "approve" : "claim"); };
  const outcome = await run(stub, c, plan(HISTORY));
  expect(outcome.kind, JSON.stringify(outcome).slice(0, 400)).toBe("committed");
  expect(c.reviewRequests).toHaveLength(2); expect(c.reviewRequests[1]).toEqual(c.reviewRequests[0]);
  const committed = await snapshot(stub);
  expect(committed.stages.filter(stage => stage.ordinal >= 139).map(stage => [stage.ordinal, stage.ticket.attempt, stage.ticket.resend ?? null]))
    .toEqual([[139, 1, null], [140, 1, true]]);
  // Heard from others, the item stays Lian's claim and becomes no fact.
  expect(Object.values(committed.state.campaignRuntime.definitions).some((d: any) => d.semanticKind === "worldFact" && d.content.description === HISTORY)).toBe(false);
  // Unusable twice, the action ends.
  const twice = capture(), ended = await initialize("npc-review-unusable-twice"), start = await snapshot(ended);
  twice.replyChange = c.replyChange; twice.review = body => passReview(body, "approve");
  expect((await run(ended, twice, plan(HISTORY))).kind).not.toBe("committed");
  expect(twice.reviewRequests).toHaveLength(2); expect((await snapshot(ended)).events).toEqual(start.events);
}, 60_000);

// ADR 0077: review stages may be sent twice, so reviews take 139–154. Tables
// built for 1–138 (ADR 0073) or for the unreleased 1–146 are rebuilt in place.
it.each([138, 146])("the %i-ordinal store upgrades without losing reply proofs, then writes and reads a review on 139", async legacy => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const c = capture(), stub = await initialize(`npc-review-schema-${legacy}`);
  expect(await run(stub, c, plan())).toMatchObject({ kind: "committed" });
  const tables = ["authority_vnext_stage_proofs", "authority_vnext_superseded_stage_proofs"];
  const saved = await runInDurableObject(stub, (_instance, context) => {
    context.storage.sql.exec("DELETE FROM authority_vnext_stage_proofs WHERE ordinal > ?", legacy);
    const rows = tables.map(table => context.storage.sql.exec(`SELECT * FROM ${table} ORDER BY prepared_action_id, ordinal`).toArray());
    context.storage.transactionSync(() => { for (const table of tables) {
      const schema = context.storage.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = ?", table).one().sql;
      expect(schema).toContain("ordinal BETWEEN 1 AND 154");
      context.storage.sql.exec(`ALTER TABLE ${table} RENAME TO ${table}_current`);
      context.storage.sql.exec(schema.replace("ordinal BETWEEN 1 AND 154", `ordinal BETWEEN 1 AND ${legacy}`));
      context.storage.sql.exec(`INSERT INTO ${table} SELECT * FROM ${table}_current`); context.storage.sql.exec(`DROP TABLE ${table}_current`);
    } });
    expect(() => context.storage.sql.exec("INSERT INTO authority_vnext_stage_proofs VALUES ('probe',?,'c','b','r',NULL,'i','{}')", legacy + 1)).toThrow();
    return rows;
  });
  expect(saved[0].length).toBeGreaterThanOrEqual(3);
  await evictDurableObject(stub);
  await runInDurableObject(stub, (_instance, context) => {
    for (const [index, table] of tables.entries()) {
      expect(context.storage.sql.exec(`SELECT * FROM ${table} ORDER BY prepared_action_id, ordinal`).toArray()).toEqual(saved[index]);
      expect(context.storage.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = ?", table).one().sql).toContain("ordinal BETWEEN 1 AND 154");
      expect(context.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = ?", `${table}_before_reply_review`).toArray()).toEqual([]);
    }
    // The new bounds hold: 154 is a review's ordinal, 155 is none.
    context.storage.sql.exec("INSERT INTO authority_vnext_stage_proofs VALUES ('probe',154,'c','b','r',NULL,'i-154','{}')");
    expect(() => context.storage.sql.exec("INSERT INTO authority_vnext_stage_proofs VALUES ('probe',155,'c','b','r',NULL,'i-155','{}')")).toThrow();
    context.storage.sql.exec("DELETE FROM authority_vnext_stage_proofs WHERE prepared_action_id = 'probe'");
  });
  expect(await run(stub, c, plan("你问的事我还不知道。"), { ...INPUT, submissionId: "after-review-schema", text: "请再说一遍。" })).toMatchObject({ kind: "committed" });
  const count = await runInDurableObject(stub, (_instance, context) => context.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM authority_vnext_stage_proofs WHERE ordinal = 139").one().n);
  // A 1–146 table kept the first action's review on 139; a 1–138 table could not hold it.
  expect(count).toBe(legacy === 138 ? 1 : 2);
}, 60_000);
