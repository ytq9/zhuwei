import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi, afterEach } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import { WORLD_STORY_SELECTION_TOOL_NAME } from "../../../app/_runtime/lib/room/story-world-event";
import { RETRY_DECLINE_TEXT, RETRY_QUESTION_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/retry-question";
import { scriptedNpcReply, scriptedNpcReview } from "../../support/fixtures/vnext-npc-replies.mjs";

// SPEC 0001 §19, SPEC 0016 §7.2 (ADR 0081): after a conversation failed, a
// player who presses again without saying what changed is asked once. The
// question waits with the unfrozen action; the answer, or a decline, continues
// the same action on its frozen context, and the conversation it then holds
// addresses the failure, so the same failure is never asked about again.
// Through the real Room Action and Durable Object boundary, with scripted
// provider replies.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:retry:alice", sessionVersion: 1 } };
const ACTOR = "character:retry:alice", LIAN = "npc:black-oak-will:lian", SCENE = "wake";
const QUESTION = "上次她没有松口，这次有什么不同？";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
const capture = () => ({ calls: [] as string[], offers: [] as Data[], fillings: [] as Data[], ask: undefined as string | undefined });
type Capture = ReturnType<typeof capture>;
afterEach(() => vi.restoreAllMocks());

/** A conversation with Lian: a persuasion check at `dc`, or none. */
function talk(speech: string, dc?: number, said = "我不会告诉你。") {
  const branch = (failure: boolean) => ({ outcomeCode: failure ? "outcome:unmoved" : "outcome:moved",
    summary: failure ? "这番话没有起作用。" : "这番话起了作用。", npcPerceives: null,
    response: { kind: "speech", text: failure ? said : "好吧，我告诉你。", motive: "REPLY_MOTIVE", basis: [{ kind: "npcContext", ref: LIAN }] },
    consequences: [] });
  return { mode: "adjudication", basisRefs: [LIAN], terminal: null,
    adjudication: dc === undefined
      ? { kind: "directSuccess", durationMicros: "300000000", risk: "普通交谈。", successOutcome: "交谈进行。" }
      : { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "cha", skill: "persuasion", dc, mode: "normal",
        risk: "她可能不松口。", successOutcome: "她愿意开口。", failureOutcome: "她不肯开口。" },
    proposals: [{ kind: "social", basisRefs: [LIAN], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: LIAN,
      actorSpeech: speech, goal: "让莉安说出父亲临终前的异常。", method: "当面劝说。", communication: "spokenConversation", audience: "participants",
      branches: { success: branch(false), failure: dc === undefined ? null : branch(true) } }] };
}
async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "阿莱莎", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}
/** `proposal` is the plan the scripted model holds; `c.ask` makes it ask
 * whenever the selection offers the question tool. */
async function run(stub: Stub, c: Capture, proposal: unknown, input: RoomActionInput) {
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "retry-question-room-test", limit: "8", emit() {} });
  const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, request) {
    const name = (request as Data).tools[0].function.name;
    if (name === WORLD_STORY_SELECTION_TOOL_NAME) return result(name, { decision: { kind: "noStory", reason: "夹具不创建故事。" } });
    throw new Error(`unexpected world call ${name}`);
  } }));
  const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action, transport),
    commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value, transport),
    resumePlayerRandomness: (context: unknown, randomnessId: string) => target.resumePlayerRandomness(context, randomnessId, transport),
    observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
    publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
    deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
    beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
    failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
  } as RoomAuthorityCapability;
  const narrationAdapter = { async narrate() { return { body: "已记录当前可见的行动。" }; },
    async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
  const adapter = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run(_model, request) {
    const tools = (request as Data).tools as Data[], names = tools.map(tool => tool.function.name as string);
    c.calls.push(names[0]);
    if (proposal === undefined) throw new Error("this step makes no model call");
    if (names[0] === "offer_kp_proposal_bundle") {
      c.offers.push(structuredClone(request as Data));
      const ask = tools.find(tool => tool.function.name === RETRY_QUESTION_TOOL_NAME);
      if (ask !== undefined && c.ask !== undefined) {
        c.calls[c.calls.length - 1] = RETRY_QUESTION_TOOL_NAME;
        return result(RETRY_QUESTION_TOOL_NAME, { threadRef: ask.function.parameters.properties.threadRef.enum[0], question: c.ask });
      }
      return result(names[0], { requestedCapabilities: ["social"] });
    }
    if (names[0] === "review_npc_replies") return scriptedNpcReview(request);
    const reply = scriptedNpcReply(request, proposal);
    if (reply !== undefined) return reply;
    c.fillings.push(structuredClone(request as Data));
    return result(names[0], encodeVNextStrictToolBundle(proposal));
  } }) });
  return handleRoomAction({ principal: ALICE, authority, kp: adapter as never }, input);
}
const observe = (stub: Stub) => runInDurableObject(stub, instance => (instance as unknown as Data).observe(ALICE)) as Promise<Data>;
const threads = (stub: Stub) => runInDurableObject(stub, instance =>
  structuredClone((instance as unknown as Data).authoritativeReplay().state.campaignRuntime.conversationThreads ?? {})) as Promise<Record<string, Data>>;
const transcript = (stub: Stub) => runInDurableObject(stub, instance =>
  (instance as unknown as Data).authorityStore.experiencedMessages(`${ALICE.principal.id}\u001f${ACTOR}`, 240)) as Promise<Data[]>;
const toolNames = (request: Data) => (request.tools as Data[]).map(tool => tool.function.name);
const task = (request: Data) => String((request.messages as Data[])[1].content);

/** The first conversation fails: no persuasion bonus reaches DC 30. */
async function failFirstTalk(stub: Stub, c: Capture) {
  const first: RoomActionInput = { kind: "intent", submissionId: "first-try", text: "我劝莉安说出她父亲死前的异常。" };
  const waiting = await run(stub, c, talk("请告诉我你父亲死前有什么异常。", 30), first);
  expect(waiting, JSON.stringify(waiting)).toMatchObject({ kind: "awaitingPlayerRoll" });
  // A first attempt has no failure to ask about: the selection offers only itself.
  expect(toolNames(c.offers[0])).toEqual(["offer_kp_proposal_bundle"]);
  const rolls = (await observe(stub)).pendingPlayerRolls as Data[];
  const rolled = await run(stub, c, undefined, { kind: "roll", submissionId: "first-try:roll", randomnessId: String(rolls[0].id) });
  expect(rolled, JSON.stringify({ rolled, calls: c.calls })).toMatchObject({ kind: "committed" });
  const failed = Object.values(await threads(stub)).filter(thread => thread.outcome === "failure");
  expect(failed).toHaveLength(1);
  // The first conversation with Lian follows none.
  expect(failed[0].addressedThreadRef).toBeNull();
  return failed[0].threadRef as string;
}

it("asks once after a failed conversation, continues the same action with the answer, and never asks about that failure again", async () => {
  const stub = await initialize("retry-question-answer"), c = capture();
  const failure = await failFirstTalk(stub, c);
  // Pressing again without saying what changed: the selection asks instead.
  c.ask = QUESTION;
  const press: RoomActionInput = { kind: "intent", submissionId: "press-again", text: "我再尝试说服莉安。" };
  const offers = c.offers.length, calls = c.calls.length;
  const asked = await run(stub, c, talk("我把你父亲留下的信带来了，你看看。"), press);
  expect(asked, JSON.stringify(asked)).toMatchObject({ kind: "awaitingInput",
    pending: { pendingInputId: "retry-question:press-again", kind: "clarification", question: QUESTION } });
  expect(c.calls.slice(calls)).toEqual([RETRY_QUESTION_TOOL_NAME]);
  expect(toolNames(c.offers[offers])).toEqual(["offer_kp_proposal_bundle", RETRY_QUESTION_TOOL_NAME]);
  expect(c.offers[offers].tools[1].function.parameters.properties.threadRef.enum).toEqual([failure]);
  // The question waits with the unfrozen action; nothing happened in the world.
  const waiting = await observe(stub);
  expect(waiting.readModel.pendingInputs).toContainEqual({ pendingInputId: "retry-question:press-again", kind: "clarification",
    rootActionId: "root-action:press-again", question: QUESTION });
  expect(Object.keys(await threads(stub))).toHaveLength(1);

  // The answer continues the same prepared action on its frozen context.
  const said = "我把她父亲留下的信拿给她看。";
  const answer: RoomActionInput = { kind: "answer", submissionId: "press-again:answer", pendingInputId: "retry-question:press-again",
    answer: { text: said }, displayText: said } as RoomActionInput;
  c.ask = QUESTION;
  const resumedOffers = c.offers.length, fillings = c.fillings.length;
  const done = await run(stub, c, talk("我把你父亲留下的信带来了，你看看。"), answer);
  expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed" });
  const resumed = c.offers[resumedOffers];
  expect(toolNames(resumed), "an answered question is not asked again").toEqual(["offer_kp_proposal_bundle"]);
  expect(task(resumed)).toContain(JSON.stringify({ threadRef: failure, question: QUESTION, answer: said }));
  expect(task(c.fillings[fillings])).toContain(JSON.stringify({ threadRef: failure, question: QUESTION, answer: said }));
  // The asking round's system message, the frozen context, is the resumed one's.
  expect(resumed.messages[0].content).toBe(c.offers[resumedOffers - 1].messages[0].content);
  const after = Object.values(await threads(stub));
  expect(after.find(thread => thread.threadRef !== failure)).toMatchObject({ addressedThreadRef: failure });
  // The line, the question and the answer, in that order, for this player.
  const lines = (await transcript(stub)).map(message => [message.kind, message.body]);
  const at = lines.findIndex(([, body]) => body === "我再尝试说服莉安。");
  expect(lines.slice(at, at + 3)).toEqual([["player", "我再尝试说服莉安。"], ["kp", QUESTION], ["player", said]]);
  // Sending the same answer again continues the same way: no new call.
  const total = c.calls.length;
  expect(await run(stub, c, talk("我把你父亲留下的信带来了，你看看。"), answer)).toMatchObject({ kind: "committed" });
  expect(c.calls).toHaveLength(total);

  // The failure is answered: pressing again is ruled without a question.
  const third = c.offers.length;
  expect(await run(stub, c, talk("我再请你想想。"), { kind: "intent", submissionId: "press-third", text: "我再劝劝她。" }))
    .toMatchObject({ kind: "committed" });
  expect(toolNames(c.offers[third])).toEqual(["offer_kp_proposal_bundle"]);
}, 60_000);

it("a declined question continues the action as it was, and the transcript says so", async () => {
  const stub = await initialize("retry-question-decline"), c = capture();
  const failure = await failFirstTalk(stub, c);
  c.ask = QUESTION;
  const press: RoomActionInput = { kind: "intent", submissionId: "press-declined", text: "我再试一次。" };
  expect(await run(stub, c, talk("请再考虑一下。"), press)).toMatchObject({ kind: "awaitingInput" });
  const decline: RoomActionInput = { kind: "answer", submissionId: "press-declined:decline", pendingInputId: "retry-question:press-declined",
    answer: { decline: true }, displayText: RETRY_DECLINE_TEXT } as RoomActionInput;
  const resumedOffers = c.offers.length;
  // With nothing new, the ruling is the unchanged retry ADR 0079 describes.
  const done = await run(stub, c, talk("请再考虑一下。", undefined, "我说过了。"), decline);
  expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed" });
  expect(task(c.offers[resumedOffers])).toContain(JSON.stringify({ threadRef: failure, question: QUESTION, answer: null }));
  expect(Object.values(await threads(stub)).find(thread => thread.threadRef !== failure)).toMatchObject({ addressedThreadRef: failure });
  const lines = (await transcript(stub)).map(message => [message.kind, message.body]);
  const at = lines.findIndex(([, body]) => body === "我再试一次。");
  expect(lines.slice(at, at + 3)).toEqual([["player", "我再试一次。"], ["kp", QUESTION], ["player", RETRY_DECLINE_TEXT]]);
}, 60_000);

it("refuses an answer that is neither words nor a decline, and another player's answer", async () => {
  const stub = await initialize("retry-question-refusals"), c = capture();
  await failFirstTalk(stub, c);
  c.ask = QUESTION;
  expect(await run(stub, c, talk("请再考虑一下。"), { kind: "intent", submissionId: "press-refused", text: "我再试一次。" }))
    .toMatchObject({ kind: "awaitingInput" });
  const calls = c.calls.length;
  for (const answer of [{ text: "   " }, { decline: false }, { choiceId: "x" }, { text: "好", extra: 1 }]) {
    const refused = await run(stub, c, talk("请再考虑一下。"), { kind: "answer", submissionId: `press-refused:${JSON.stringify(answer)}`,
      pendingInputId: "retry-question:press-refused", answer, displayText: "x" } as RoomActionInput);
    expect(refused, JSON.stringify(answer)).toMatchObject({ kind: "rejected" });
  }
  expect(c.calls).toHaveLength(calls);
  // The question still waits.
  expect((await observe(stub)).readModel.pendingInputs).toContainEqual(expect.objectContaining({ pendingInputId: "retry-question:press-refused" }));
}, 60_000);

it("every conversation follows the previous one, so a failure a later talk answered is never asked about", async () => {
  const stub = await initialize("retry-question-chain"), c = capture();
  const failure = await failFirstTalk(stub, c);
  // The player brings a reason. The question is offered, and the scripted KP,
  // like the guidance, does not ask when a reason is given.
  const offers = c.offers.length;
  expect(await run(stub, c, talk("这是你父亲留下的信。"), { kind: "intent", submissionId: "with-reason", text: "我把她父亲的信拿给她看，再劝她一次。" }))
    .toMatchObject({ kind: "committed" });
  expect(toolNames(c.offers[offers])).toEqual(["offer_kp_proposal_bundle", RETRY_QUESTION_TOOL_NAME]);
  const followed = Object.values(await threads(stub)).find(thread => thread.threadRef !== failure);
  expect(followed).toMatchObject({ addressedThreadRef: failure, outcome: "success" });
  // Nothing is open: a bare press is ruled without a question.
  c.ask = QUESTION;
  const next = c.offers.length;
  expect(await run(stub, c, talk("请再说说。"), { kind: "intent", submissionId: "bare-press", text: "我再劝劝她。" }))
    .toMatchObject({ kind: "committed" });
  expect(toolNames(c.offers[next])).toEqual(["offer_kp_proposal_bundle"]);
}, 60_000);
