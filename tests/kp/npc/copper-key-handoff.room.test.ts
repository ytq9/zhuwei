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

type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:copper:alice", sessionVersion: 1 } };
const ACTOR = "character:copper:alice", NPC = "npc:black-oak-will:lian", SCENE = "wake";
const result = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });
const capture = () => ({ calls: [] as string[], npcFrames: [] as Data[], narrations: [] as Data[], telemetry: [] as Data[], copperEntryId: "" });
type Capture = ReturnType<typeof capture>;
afterEach(() => vi.restoreAllMocks());

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "1", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 12, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}
const LIAN_SPEECH = "帮忙？先告诉我你叫什么，是来守灵的，还是来办事的。……你既然来了，名字也报了，这枚铜钥你拿着。它开不了门，是给不唱歌的人留的信物。酒窖这几天钉上了，我不敢下去。要是你夜里听见有人在门后唱歌，把耳朵堵上，别答应，也别跟着哼。";
function socialBundle(withPromise: boolean) {
  return { mode: "adjudication", basisRefs: [NPC], terminal: null,
    adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "这句问话本身没有失败风险。", successOutcome: "莉安听清并回答这名外乡人。" },
    proposals: [{ kind: "social", basisRefs: [NPC], consumes: [], produces: [], outcomeBinding: "always", sceneRef: SCENE, npcRef: NPC,
      addressedThreadRef: null, goal: "接住这名外乡人的问话。", method: "先问清姓名和来意；听完对方回答后再决定交不交铜钥。", communication: "spokenConversation", audience: "participants", retryChange: null,
      branches: { success: { outcomeCode: withPromise ? "lian-answers-help-offer" : "lian-replies", summary: withPromise ? "莉安先问他是谁；听完后交出铜钥。" : "莉安回答了追问。",
        response: { kind: "speech", text: withPromise ? LIAN_SPEECH : "钥匙本来就是留给肯听话的人的。", motive: "她只想知道眼前这个外乡人是不是肯留下。", basis: [{ kind: "npcContext", ref: NPC }] },
        consequences: withPromise ? [
          { kind: "relationship", relationshipRef: null, change: "莉安对这名外乡人从「不认识」转为「报了名、肯留下问事的人」。", basisFactRefs: [] },
          { kind: "promise", content: "莉安把这枚铜钥交给这名外乡人，并请他在夜里听见门后歌声时堵住耳朵、别答应、别跟着哼。", condition: "对方先报上姓名并说清是来守灵还是办事。",
            promisor: "npc", promiseeRef: ACTOR, authorityRefs: [NPC], due: "none",
            terms: { kind: "result", subjectRefs: [NPC, ACTOR], delivery: { sourceRef: null, itemRef: null, quantity: 1, destinationKind: "holder", destinationRef: ACTOR }, parts: [], activation: null },
            nextStep: "先把铜钥从手里递出去，然后等这位外乡人接下来的问话。" },
        ] : [] }, failure: null } }],
  };
}
function decisionBinding(c: Capture): AuthoritativeModelBinding {
  return { async run(_model, input) {
    const request = input as Data, frame = sentBody(request) as Data;
    const name = request.tools[0].function.name;
    c.calls.push(name);
    if (name === "select_npc_work_schema") return result(name, { requestedCapabilities: ["inventoryOperation"] });
    if (name === "submit_kp_proposal_bundle") {
      c.npcFrames.push(structuredClone(frame));
      const refs: string[] = frame.requiredContext.entries.map((entry: Data) => entry.entryRef).filter(Boolean);
      const basisRefs = [c.copperEntryId, ...refs.filter(ref => ref.startsWith("continuity:promises:") || ref.startsWith("continuity:sourceClaims:")
        || ref.startsWith("definition:module-npc:") || ref.includes("lian-copper-key"))];
      const bundle = { mode: "adjudication", basisRefs, terminal: null,
        adjudication: { kind: "directSuccess", durationMicros: "300000000", risk: "莉安把铜钥交给已经报过姓名的外乡人，交付本身没有可预见的损失。", successOutcome: "莉安把铜钥从手里递到外乡人手中。" },
        proposals: [{ kind: "inventoryOperation", basisRefs, consumes: basisRefs.map(ref => ({ kind: "existing", ref })), produces: [], outcomeBinding: "always",
          operation: { kind: "transfer", entryRef: c.copperEntryId, quantity: 1, targetCharacterRef: ACTOR, ownershipDisposition: "preserve" },
          summary: "莉安将父亲留下的铜钥1枚从自己手里交给这名外乡人。" }] };
      return result(name, encodeVNextStrictToolBundle(bundle as never));
    }
    if (name.startsWith("submit_promise_review")) {
      const frames: Data[] = frame.schema === "zhuwei.promise-review-batch/vnext-1" ? frame.frames : [frame];
      const reviews = frames.map((f: Data) => {
        const delivery = f.evidence.flatMap((e: Data) => e.itemsAfter.filter((i: Data) => i.entryId === c.copperEntryId && i.holderRef === ACTOR).map((item: Data) => ({ event: e, item })))[0];
        return { promiseId: f.promiseId, judgment: delivery
          ? { outcome: "fulfilled", reason: "铜钥已经依原约转交。", evidenceRefs: [delivery.event.eventId, delivery.item.entryId], remaining: false }
          : { outcome: "unchanged", reason: "当前没有决定性结果。", evidenceRefs: [], remaining: true } };
      });
      return result(name, frame.schema === "zhuwei.promise-review-batch/vnext-1" ? { reviews } : reviews[0].judgment);
    }
    throw new Error(`unexpected tool ${name}`);
  } };
}
async function run(stub: Stub, input: RoomActionInput, c: Capture, proposal?: unknown) {
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "copper-room-test", limit: "9", emit() {} });
  const transport = new ActorPlanTransportCapability(scope.bind(decisionBinding(c)));
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
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run(_model, request) {
    c.calls.push("playerProposal"); if (proposal === undefined) throw new Error("saved player proposal must be reused");
    const name = (request as Data).tools[0].function.name;
    if (name === "offer_kp_proposal_bundle") return result(name, { requestedCapabilities: ["social"] });
    return result(name, encodeVNextStrictToolBundle(proposal as never));
  } }) });
  return handleRoomAction({ principal: ALICE, authority, kp }, input);
}
async function snapshot(stub: Stub) { return runInDurableObject(stub, (instance, context) => {
  const t = instance as unknown as Data, replay = t.authoritativeReplay();
  const rows = (sql: string) => context.storage.sql.exec(sql).toArray();
  return { state: structuredClone(replay.state) as Data, events: structuredClone(t.authorityStore.events()) as Data[],
    due: rows("SELECT child_root_action_id, work_kind, status, next_attempt_at FROM authority_due_work"),
    submissions: rows("SELECT submission_id, input_kind, character_id, status, result_json IS NOT NULL AS has_result FROM authority_submissions"),
    provisional: rows("SELECT prepared_action_id, expires_at FROM authority_provisional_mechanics"),
    invocations: rows("SELECT invocation_id, purpose, status FROM story_creation_invocations") };
}); }
function copperKey(state: Data) {
  return Object.values(state.campaignRuntime.itemSystem.entries).find((entry: any) => String(entry.definitionRef).includes("copper-key")) as Data | undefined;
}
const LINES: string[] = [];
function log(text: string) { LINES.push(text); console.log(text); }
function report(label: string, snap: Awaited<ReturnType<typeof snapshot>>, outcome?: unknown) {
  const key = copperKey(snap.state);
  log(`\n##### ${label}\noutcome=${JSON.stringify(outcome)}\nevents=${snap.events.map(e => `${e.eventSeq}:${e.eventType}(${e.rootActionId.slice(0, 40)})`).join(" | ")}\ncopper=${JSON.stringify({ holder: key?.holderRef, scene: key?.sceneRef })}\nnpcPlans=${JSON.stringify(Object.values(snap.state.campaignRuntime.npcPlans).map((p: any) => ({ status: p.status, nextStep: p.nextStep })))}\nactivities=${JSON.stringify(Object.values(snap.state.campaignRuntime.activities).map((a: any) => ({ id: a.activityId, who: a.characterId, status: a.status })))}\nclock=${JSON.stringify(snap.state.fictionTimelines)}\ndue=${JSON.stringify(snap.due)}\nsubmissions=${JSON.stringify(snap.submissions)}\nprovisional=${JSON.stringify(snap.provisional)}\ninvocations=${JSON.stringify(snap.invocations)}`);
}

// SPEC 0006 §6: a due NPC plan commits through the same Room Action transaction
// before the affected player intent is processed. SPEC 0004 §6: the promised
// item changes hands only through a step event, in the NPC's completion range.
it("an NPC's promised transfer starts as a silent Activity, never blocks the player's next action, and delivers when the clock reaches it", async () => {
  const c = capture();
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    try { c.telemetry.push(JSON.parse(String(line))); } catch { /* not telemetry */ }
  });
  const stub = await initialize("copper-key-handoff");
  const initial = await snapshot(stub);
  const key = copperKey(initial.state);
  expect(key, JSON.stringify(Object.keys(initial.state.campaignRuntime.itemSystem.entries))).toMatchObject({ holderRef: NPC });
  c.copperEntryId = String(key!.entryId);

  const first = await run(stub, { kind: "intent", submissionId: "ask-lian", text: "去问一下lian，有什么可以帮忙的吗" }, c, socialBundle(true));
  const afterFirst = await snapshot(stub);
  report("after first player action", afterFirst, first);
  expect(first.kind, LINES.join("\n")).toBe("committed");
  const planId = Object.keys(afterFirst.state.campaignRuntime.npcPlans)[0];
  expect(planId, LINES.join("\n")).toBeTruthy();
  expect(afterFirst.state.campaignRuntime.npcPlans[planId].status).toBe("planned");
  expect(afterFirst.due.some(row => row.work_kind === "npcWork" && row.status === "pending")).toBe(true);
  expect(copperKey(afterFirst.state)?.holderRef).toBe(NPC);

  const second = await run(stub, { kind: "intent", submissionId: "follow-up", text: "这么简单就给我了吗" }, c, socialBundle(false));
  const afterSecond = await snapshot(stub);
  report("after second player action", afterSecond, second);
  log("calls: " + JSON.stringify(c.calls));
  log("narration claims: " + JSON.stringify(c.narrations.map(n => n.renderableClaims?.claims?.map((p: Data) => p.kind + ":" + (p.outcomeCode ?? p.statement?.slice(0, 20) ?? "")))));
  log("telemetry: " + JSON.stringify(c.telemetry.filter(t => /dueWork|failure|reject/i.test(JSON.stringify(t))).map(t => ({ e: t.eventName, o: t.outcome ?? t.outcomeKind, fr: t.failureReason, code: t.errorCode }))));
  const detail = LINES.join("\n");
  expect(second.kind, detail).toBe("committed");
  expect(c.calls.filter(name => name === "select_npc_work_schema"), detail).toHaveLength(1);
  expect(c.calls.filter(name => name === "submit_kp_proposal_bundle"), detail).toHaveLength(1);
  const eventTypes = afterSecond.events.map(event => event.eventType);
  expect(eventTypes, detail).toContain("NpcWorkStarted");
  expect(afterSecond.state.fictionTimelines["branch:main"].nowMicros, detail).toBe("600000000");
  expect(copperKey(afterSecond.state)?.holderRef, detail).toBe(ACTOR);
  expect(afterSecond.state.campaignRuntime.npcPlans[planId].status, detail).toBe("resolved");
  expect(afterSecond.due.filter(row => row.status === "pending" && row.work_kind === "npcWork"), detail).toEqual([]);
  expect(afterSecond.provisional, detail).toEqual([]);
  const transferNarrated = c.narrations.some(n => n.renderableClaims?.claims?.some((p: Data) => JSON.stringify(p).includes(c.copperEntryId)));
  expect(transferNarrated, detail).toBe(true);
}, 60_000);
