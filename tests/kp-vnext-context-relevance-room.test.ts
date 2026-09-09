import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative-types";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { conservativeInputTokens, allowedInputTokens } from "../app/_runtime/lib/kp/vnext/invocation/budget";
import { VNEXT_PROVIDER_BUDGET } from "../app/_runtime/lib/kp/vnext/runtime-policy";
import { npcDecisionEntryRef } from "../app/_runtime/lib/kp/vnext/context/npc-decision";
import { deepSeekRequestBody } from "../app/_runtime/lib/kp/deepseek";

/**
 * The registered module room with its opening preparation is the real shape a
 * player meets. A plain question addressed to one NPC must produce requests
 * that fit the production input budget with room to spare, and the frozen
 * context must follow the words: bystanders keep their observable records only,
 * item truths enter when the words reach the item, and server version hashes
 * never travel to the model.
 */
type R = Record<string, unknown>;
const ALICE = { principal: { id: "principal:relevance:alice", sessionVersion: 1 } };
const ACTOR = "character:relevance:alice", SCENE = "wake";
const VARO = "npc:black-oak-will:varo", LIAN = "npc:black-oak-will:lian", NAES = "npc:black-oak-will:naes", ECHO = "npc:black-oak-will:echo";
const COPPER_KEY_FACT = "fact:module:black-oak-will:copper-key", COPPER_KEY_DEFINITION = "item-definition:module:black-oak-will:copper-key";

function tokens(value: unknown) { return conservativeInputTokens(typeof value === "string" ? value : JSON.stringify(value)); }

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const card = { name: "阿莱莎", sceneId: SCENE, level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
    scores: { str: 14, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["perception", "investigation", "history"],
    resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 24, max: 24, temp: 0 }, ac: 15, speed: 30, equipped: {}, backpack: [] };
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id, staticCard: card }],
    fixtureFacts: [], vNextSeed: { semanticDefinitions: [], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never)).toMatchObject({ created: true });
  return stub;
}

/** Drives one intent through the real Room prepare and adapter, answering the
 * selection with the given families and stopping at the filling request. */
async function measure(name: string, text: string, capabilities: readonly string[], npcRefs: readonly string[] = []) {
  const stub = await initialize(name);
  const requests: R[] = [];
  let prepared: R | undefined;
  const outcome = await runInDurableObject(stub, instance => {
    const target = instance as unknown as RoomAuthorityCapability & R & {
      beginVNextProposalInvocation: (principal: unknown, id: string, request: unknown) => Promise<never>;
      completeVNextProposalInvocation: (principal: unknown, id: string, completion: unknown) => Promise<never>;
    };
    const authority: RoomAuthorityCapability = { ...target, prepare: async (context, input) => {
      const result = await target.prepare(context, input);
      prepared = result as unknown as R;
      return result;
    } } as RoomAuthorityCapability;
    const narrationAdapter = { async narrate() { return { body: "记录。" }; }, async propose() { throw new Error("unused"); },
      async decideDueActorPlan() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, proposalBinding: { async run(_model, request) {
      requests.push(structuredClone(request as R));
      const tool = String(((request.tools as R[])[0].function as R).name);
      if (tool === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
        const offersRecall = Object.hasOwn((((request.tools as R[])[0].function as R).parameters as R).properties as R, "requestedNpcRefs");
        return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool,
          arguments: JSON.stringify({ requestedCapabilities: capabilities, ...(offersRecall ? { requestedNpcRefs: npcRefs } : {}) }) } }] } }] };
      }
      throw Object.assign(new Error("measured"), { status: 400 });
    } } });
    return handleRoomAction({ principal: ALICE as never, authority, kp },
      { kind: "intent", submissionId: `submission:${name}`, text } satisfies RoomActionInput);
  });
  const bodies = requests.map(request => deepSeekRequestBody("deepseek-v4-flash", request));
  const context = prepared === undefined ? undefined : (prepared.requiredContext as R | undefined);
  const modelContext = bodies.length === 0 ? undefined
    : (JSON.parse(String(((bodies[0].messages as R[])[1]).content)) as R).requiredContext as R;
  const fillContext = bodies.length < 2 ? undefined
    : (JSON.parse(String(((bodies[1].messages as R[])[1]).content)) as R).requiredContext as R;
  return { outcome: outcome as R, bodies, context, modelContext, fillContext, totals: bodies.map(body => tokens(JSON.stringify(body))) };
}

const entryRefs = (context: R | undefined) => (context?.entries as R[] | undefined ?? []).map(entry => String(entry.entryRef));

it("a plain question addressed to one NPC fits the input budget and freezes only that NPC's decision view", async () => {
  const run = await measure("relevance-addressed", "我环顾大厅，问瓦罗：这里到底发生了什么事？",
    ["social", "observe", "worldInteraction", "inventoryOperation"]);
  const allowed = allowedInputTokens(VNEXT_PROVIDER_BUDGET);
  // Both the selection request and a four-family filling request stay well
  // inside the ceiling; before relevance the four-family request was blocked.
  expect(run.bodies).toHaveLength(2);
  expect(run.outcome.code).not.toBe("PROPOSAL_INPUT_BUDGET_EXCEEDED");
  expect(run.totals[0], `offer ${run.totals[0]}`).toBeLessThan(30_000);
  expect(run.totals[1], `fill ${run.totals[1]}`).toBeLessThan(allowed);
  const refs = entryRefs(run.context);
  const sent = (run.modelContext!.entries as R[]).map(entry => String(entry.entryRef));
  // Every visible view is frozen and verified; only the addressed one is sent.
  // Bystanders stay observable subjects with exact records, but their decision
  // views and knowledge bodies wait for the selection to ask for them.
  for (const npc of [VARO, LIAN, NAES]) expect(refs).toContain(npcDecisionEntryRef(npc));
  expect(sent).toContain(npcDecisionEntryRef(VARO));
  for (const npc of [LIAN, NAES]) {
    expect(refs).toContain(npc);
    expect(sent).toContain(npc);
    expect(sent).not.toContain(npcDecisionEntryRef(npc));
    expect(sent.some(ref => ref.startsWith(`knowledge:${npc}:`) || ref === `knowledge-directory:${npc}`)).toBe(false);
  }
  // Varo's complete memory is frozen once; the model is sent the bodies the
  // topic reaches, and the rest wait behind a handle directory.
  const varoView = ((run.context!.entries as R[]).find(entry => entry.entryRef === npcDecisionEntryRef(VARO))!.value as R);
  expect(varoView.unloadedKnowledgeRefs).toBeUndefined();
  const hidden = new Set((((run.context!.references as R).knowledgeRecall as R[]).find(entry => entry.holderRef === VARO)?.records as R[] | undefined ?? []).map(record => String(record.entryRef)));
  for (const record of varoView.knowledge as R[]) {
    expect(refs).toContain(String(record.entryRef));
    expect(sent.includes(String(record.entryRef))).toBe(!hidden.has(String(record.entryRef)));
  }
  const directory = (run.context!.entries as R[]).find(entry => entry.entryRef === `knowledge-directory:${VARO}`);
  expect(directory === undefined ? [] : ((directory.value as R).unloaded as R[]).map(record => record.entryRef)).toEqual([...hidden].sort());
  expect((run.modelContext!.references as R).npcRecall).toEqual({ shown: [VARO], requestable: [ECHO, LIAN, NAES] });
  expect(((((run.bodies[0].tools as R[])[0].function as R).parameters as R).properties as R).requestedNpcRefs).toMatchObject({ items: { enum: [ECHO, LIAN, NAES] } });
  const handles = (((run.modelContext!.references as R).knowledgeRecall as R).requestable as string[]);
  expect(handles.length).toBeGreaterThanOrEqual(hidden.size);
  if (handles.length > 0) expect(((((run.bodies[0].tools as R[])[0].function as R).parameters as R).properties as R).requestedKnowledgeRefs).toMatchObject({ items: { enum: handles } });
  // Opening item truths stay out until the words reach the item.
  expect(refs).not.toContain(COPPER_KEY_FACT);
  expect(refs).not.toContain(COPPER_KEY_DEFINITION);
  const frame = ((run.context!.entries as R[]).find(entry => String(entry.entryRef).startsWith("profile-context:"))!.value as R).factConstraints as R;
  expect((frame.facts as R[]).some(fact => fact.id === COPPER_KEY_FACT)).toBe(false);
  expect(typeof ((run.context!.entries as R[]).find(entry => String(entry.entryRef).startsWith("profile-context:"))!.value as R).factConstraintsHash).toBe("string");
  // The model view carries no server version hashes and lists frame facts by id.
  const presented = JSON.stringify(run.modelContext);
  expect(presented).not.toContain('"revisionOrHash"');
  expect(presented).not.toContain('"projectionHash"');
  expect(presented).not.toContain('"recordHash"');
  expect(presented).not.toContain('"factConstraintsHash"');
  expect(sent.every(ref => refs.includes(ref))).toBe(true);
  const bySchema = new Map<string, { count: number; tokens: number }>();
  for (const entry of run.modelContext!.entries as R[]) {
    const value = entry.value as R | undefined;
    const key = typeof value?.schema === "string" ? value.schema : String(entry.entryRef).split(":")[0];
    const agg = bySchema.get(key) ?? { count: 0, tokens: 0 }; agg.count += 1; agg.tokens += tokens(entry); bySchema.set(key, agg);
  }
  console.info(JSON.stringify({ measure: "addressed", offerTokens: run.totals[0], fillTokens: run.totals[1], entries: refs.length,
    system: tokens(String(((run.bodies[0].messages as R[])[0]).content)), tools: tokens(run.bodies[0].tools),
    references: tokens(run.modelContext!.references), bySchema: [...bySchema].sort((a, b) => b[1].tokens - a[1].tokens).map(([k, v]) => `${k} x${v.count}=${v.tokens}`) }));
}, 60_000);

it("a question about an opening item freezes that item's truth, and an unaddressed question keeps every visible NPC", async () => {
  const item = await measure("relevance-item", "我看向莉安手里的铜钥，问她那是什么。", ["social", "observe"]);
  const itemRefs = entryRefs(item.context);
  expect(itemRefs).toContain(COPPER_KEY_FACT);
  expect(itemRefs).toContain(COPPER_KEY_DEFINITION);
  expect(itemRefs).not.toContain("fact:module:black-oak-will:oak-leaf");
  const itemSent = (item.modelContext!.entries as R[]).map(entry => String(entry.entryRef));
  expect(itemSent).toContain(npcDecisionEntryRef(LIAN));
  expect(itemSent).not.toContain(npcDecisionEntryRef(VARO));
  expect((item.modelContext!.references as R).npcRecall).toEqual({ shown: [LIAN], requestable: [ECHO, NAES, VARO] });
  const generic = await measure("relevance-generic", "我环顾大厅，看看这里都有谁，他们在做什么。", ["observe"]);
  const genericRefs = entryRefs(generic.context);
  // Every visible view is frozen and verified, none is sent until asked for.
  for (const npc of [VARO, LIAN, NAES, ECHO]) expect(genericRefs).toContain(npcDecisionEntryRef(npc));
  const sent = (generic.modelContext!.entries as R[]).map(entry => String(entry.entryRef));
  for (const npc of [VARO, LIAN, NAES, ECHO]) {
    expect(sent).not.toContain(npcDecisionEntryRef(npc));
    expect(sent.some(ref => ref.startsWith(`knowledge:${npc}:`))).toBe(false);
    expect(((generic.modelContext!.entries as R[]).find(entry => entry.entryRef === npc)!.value as R).recall).toBe("requestable");
  }
  expect((generic.modelContext!.references as R).npcRecall).toEqual({ shown: [], requestable: [ECHO, LIAN, NAES, VARO] });
  expect(((((generic.bodies[0].tools as R[])[0].function as R).parameters as R).properties as R).requestedNpcRefs).toMatchObject({ items: { enum: [ECHO, LIAN, NAES, VARO] } });
  expect(generic.totals[0], `generic offer ${generic.totals[0]}`).toBeLessThan(30_000);
  // The same sentence with the selection asking for Varo: his view and memory
  // travel to the filling request, the other two stay roster lines.
  const recall = await measure("relevance-recall", "我环顾大厅，看看这里都有谁，他们在做什么。", ["observe", "social"], [VARO]);
  const filled = (recall.fillContext!.entries as R[]).map(entry => String(entry.entryRef));
  expect(filled).toContain(npcDecisionEntryRef(VARO));
  expect(filled).not.toContain(npcDecisionEntryRef(LIAN));
  expect(filled).not.toContain(npcDecisionEntryRef(NAES));
  expect((recall.fillContext!.references as R).npcRecall).toEqual({ shown: [VARO], requestable: [ECHO, LIAN, NAES] });
  expect(((recall.fillContext!.references as R).npcSourceChoices as R[]).map(choice => choice.npcRef)).toEqual([VARO]);
  expect(recall.totals[1], `recall fill ${recall.totals[1]}`).toBeLessThan(allowedInputTokens(VNEXT_PROVIDER_BUDGET));
  console.info(JSON.stringify({ measure: "item", offerTokens: item.totals[0], fillTokens: item.totals[1] })
    + JSON.stringify({ measure: "generic", offerTokens: generic.totals[0], fillTokens: generic.totals[1] })
    + JSON.stringify({ measure: "recall", offerTokens: recall.totals[0], fillTokens: recall.totals[1] }));
}, 90_000);
