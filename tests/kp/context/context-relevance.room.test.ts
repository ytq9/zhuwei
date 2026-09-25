import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { roomServiceCapabilities } from "../../../app/_runtime/lib/room/archive";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { conservativeInputTokens, allowedInputTokens } from "../../../app/_runtime/lib/kp/vnext/invocation/budget";
import { VNEXT_PROVIDER_BUDGET } from "../../../app/_runtime/lib/kp/vnext/runtime-policy";
import { npcDecisionEntryRef } from "../../../app/_runtime/lib/kp/vnext/context/npc-decision";
import { deepSeekRequestBody } from "../../../app/_runtime/lib/kp/deepseek";
import { sentContext as sentContextBody } from "../../support/fixtures/vnext-request-layout.mjs";

/**
 * The registered module room with its opening preparation is the real shape a
 * player meets. A plain question addressed to one NPC must produce requests
 * that fit the production input budget with room to spare, and the frozen
 * context must follow the words without mistaking a topic for an addressee:
 * visible NPCs keep their finite decision views,
 * item truths enter when the words reach the item, and server version hashes
 * never travel to the model.
 */
type R = Record<string, unknown>;
const ALICE = { principal: { id: "principal:relevance:alice", sessionVersion: 1 } };
const ACTOR = "character:relevance:alice", SCENE = "wake";
const VARO = "npc:black-oak-will:varo", LIAN = "npc:black-oak-will:lian", NAES = "npc:black-oak-will:naes";
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
async function measure(name: string, text: string, capabilities: readonly string[], npcRefs: readonly string[] = [], recallFirstHandle = false) {
  const stub = await initialize(name);
  const requests: R[] = [];
  let prepared: R | undefined, storedPrepared: R | undefined;
  const outcome = await runInDurableObject(stub, async instance => {
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
    const recaller = target as unknown as { recallKnowledgeForAction: (principal: unknown, id: string, refs: string[]) => Promise<never> };
    const kp = createVNextKpAdapter({ narrationAdapter, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
    }, recallKnowledge: (id, refs) => recaller.recallKnowledgeForAction(ALICE, id, [...refs]),
    proposalBinding: { async run(_model, request) {
      requests.push(structuredClone(request as R));
      const tool = String(((request.tools as R[])[0].function as R).name);
      if (tool === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
        const properties = (((request.tools as R[])[0].function as R).parameters as R).properties as R;
        const offersRecall = Object.hasOwn(properties, "requestedNpcRefs");
        const handles = ((properties.requestedKnowledgeRefs as R | undefined)?.items as R | undefined)?.enum as string[] | undefined;
        return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool,
          arguments: JSON.stringify({ requestedCapabilities: capabilities, ...(offersRecall ? { requestedNpcRefs: npcRefs } : {}),
            ...(handles === undefined ? {} : { requestedKnowledgeRefs: recallFirstHandle ? handles.slice(0, 1) : [] }) }) } }] } }] };
      }
      throw Object.assign(new Error("measured"), { status: 400 });
    } } });
    const outcome = await handleRoomAction({ principal: ALICE as never, authority, kp },
      { kind: "intent", submissionId: `submission:${name}`, text } satisfies RoomActionInput);
    const store = (instance as unknown as { authorityStore: { submissionByPrepared(id: string): { prepared_json: string } | undefined } }).authorityStore;
    const row = prepared === undefined ? undefined : store.submissionByPrepared(String(prepared.preparedActionId));
    storedPrepared = row === undefined ? undefined : JSON.parse(row.prepared_json) as R;
    return outcome;
  });
  const bodies = requests.map(request => deepSeekRequestBody("deepseek-v4-flash", request));
  const context = prepared === undefined ? undefined : (prepared.requiredContext as R | undefined);
  // Each request's system message carries the guide for reading a frozen
  // context, this action's context, then the stage's rules. Read it through
  // the shared layout fixture so a change to the layout reaches every reader
  // at once.
  const sentContext = (body: R): R => (sentContextBody(body) as R).requiredContext as R;
  const modelContext = bodies.length === 0 ? undefined : sentContext(bodies[0]!);
  const fillContext = bodies.length < 2 ? undefined : sentContext(bodies[1]!);
  return { stub, outcome: outcome as R, bodies, context, modelContext, fillContext, storedPrepared, totals: bodies.map(body => tokens(JSON.stringify(body))) };
}

const entryRefs = (context: R | undefined) => (context?.entries as R[] | undefined ?? []).map(entry => String(entry.entryRef));
/** The NPCs the freeze found in view: every one of them has a frozen decision view. */
const visibleNpcs = (context: R | undefined) => (context?.entries as R[] | undefined ?? [])
  .filter(entry => entry.kind === "known" && String(entry.entryRef).startsWith("npc:black-oak-will:") && ((entry.value as R).entity as R | undefined)?.kind === "npc")
  .map(entry => String(entry.entryRef)).sort();

it("a plain question retains visible respondents and applies the input budget to the complete request", async () => {
  const run = await measure("relevance-addressed", "我环顾大厅，问瓦罗：这里到底发生了什么事？",
    ["social", "observe", "worldInteraction", "inventoryOperation"]);
  const allowed = allowedInputTokens(VNEXT_PROVIDER_BUDGET);
  expect(run.totals[0], `offer ${run.totals[0]}`).toBeLessThan(allowed);
  if (run.bodies.length === 2) {
    expect(run.totals[1], `fill ${run.totals[1]}`).toBeLessThan(allowed);
  } else {
    expect(run.bodies).toHaveLength(1);
    expect(run.outcome.code).toBe("PROPOSAL_INPUT_BUDGET_EXCEEDED");
  }
  const refs = entryRefs(run.context);
  const sent = (run.modelContext!.entries as R[]).map(entry => String(entry.entryRef));
  // Every visible view is frozen and verified; only the addressed one is sent.
  // Bystanders stay observable subjects with exact records, but their decision
  // views and knowledge bodies wait for the selection to ask for them.
  const bystanders = visibleNpcs(run.context).filter(npc => npc !== VARO);
  expect(bystanders).toEqual(expect.arrayContaining([LIAN, NAES]));
  for (const npc of visibleNpcs(run.context)) expect(refs).toContain(npcDecisionEntryRef(npc));
  expect(sent).toContain(npcDecisionEntryRef(VARO));
  for (const npc of bystanders) {
    expect(refs).toContain(npcDecisionEntryRef(npc));
    expect(refs).toContain(npc);
    expect(sent).toContain(npc);
    expect(sent).not.toContain(npcDecisionEntryRef(npc));
    expect(sent.some(ref => ref.startsWith(`knowledge:${npc}:`) || ref === `knowledge-directory:${npc}`)).toBe(false);
  }
  // Varo's directory binds every memory; the bodies the topic reaches are
  // frozen and sent, and the rest wait under their versions behind a handle
  // directory (ADR 0051).
  const varoView = ((run.context!.entries as R[]).find(entry => entry.entryRef === npcDecisionEntryRef(VARO))!.value as R);
  const hidden = new Set((((run.context!.references as R).knowledgeRecall as R[]).find(entry => entry.holderRef === VARO)?.records as R[] | undefined ?? []).map(record => String(record.entryRef)));
  expect(varoView.unloadedKnowledgeRefs ?? []).toEqual([...hidden].sort());
  for (const record of varoView.knowledge as R[]) {
    expect(refs.includes(String(record.entryRef))).toBe(!hidden.has(String(record.entryRef)));
    expect(sent.includes(String(record.entryRef))).toBe(!hidden.has(String(record.entryRef)));
  }
  const directory = (run.context!.entries as R[]).find(entry => entry.entryRef === `knowledge-directory:${VARO}`);
  expect(directory === undefined ? [] : ((directory.value as R).unloaded as R[]).map(line => Object.keys(line).sort().join())).toEqual([...hidden].map(() => "gist,handle"));
  expect((run.modelContext!.references as R).npcRecall).toEqual({ shown: [VARO], requestable: bystanders });
  expect(((((run.bodies[0].tools as R[])[0].function as R).parameters as R).properties as R).requestedNpcRefs).toMatchObject({ items: { enum: bystanders } });
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
  expect(JSON.stringify(run.modelContext!.entries)).not.toMatch(/sha256:[0-9a-f]{64}/);
  expect(sent.every(ref => refs.includes(ref))).toBe(true);
  // A body another sent entry already carries is listed by ref: the location
  // anchor's geometry is the scene entry's, a frame definition or an NPC's
  // identity with an entry of its own is read there, and the decision view's
  // knowledge catalog stays with Rules. The frozen context keeps them whole.
  const profileOf = (context: R) => (context.entries as R[]).find(entry => String(entry.entryRef).startsWith("profile-context:"))!.value as R;
  expect((profileOf(run.modelContext!).currentLocationAnchor as R).tacticalGeometry).toEqual({ sameAsEntryRef: SCENE });
  expect(((profileOf(run.context!).currentLocationAnchor as R).tacticalGeometry as R).schema).toBe("zhuwei.tactical-geometry/v1");
  const sentDefinitions = (profileOf(run.modelContext!).factConstraints as R).definitions as R[];
  expect(sentDefinitions.some(record => sent.includes(String(record.ref)))).toBe(true);
  for (const record of sentDefinitions) {
    expect(Object.keys(record).sort(), String(record.ref)).toEqual(sent.includes(String(record.ref)) ? ["ref"] : ["definition", "ref"]);
  }
  const varoRecords = ((run.modelContext!.entries as R[]).find(entry => entry.entryRef === npcDecisionEntryRef(VARO))!.value as R).records as R[];
  expect(varoRecords.map(record => record.kind)).toEqual(expect.arrayContaining(["identity", "knowledgeCatalog", "self"]));
  for (const record of varoRecords) {
    const byRef = record.kind === "knowledgeCatalog" || (record.kind === "identity" && sent.includes(String(record.ref)));
    expect(Object.hasOwn(record, "value"), String(record.kind)).toBe(!byRef);
  }
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
  expect((item.modelContext!.references as R).npcRecall).toEqual({ shown: [LIAN], requestable: visibleNpcs(item.context).filter(npc => npc !== LIAN) });
  const generic = await measure("relevance-generic", "我环顾大厅，看看这里都有谁，他们在做什么。", ["observe"]);
  const genericRefs = entryRefs(generic.context);
  // Every visible view is frozen and verified, none is sent until asked for.
  const everyone = visibleNpcs(generic.context);
  expect(everyone).toEqual(expect.arrayContaining([VARO, LIAN, NAES]));
  for (const npc of everyone) expect(genericRefs).toContain(npcDecisionEntryRef(npc));
  const sent = (generic.modelContext!.entries as R[]).map(entry => String(entry.entryRef));
  for (const npc of everyone) {
    expect(sent).not.toContain(npcDecisionEntryRef(npc));
    expect(sent.some(ref => ref.startsWith(`knowledge:${npc}:`))).toBe(false);
    expect(sent).toContain(npc);
  }
  expect((generic.modelContext!.references as R).npcRecall).toEqual({ shown: [], requestable: everyone });
  expect(((((generic.bodies[0].tools as R[])[0].function as R).parameters as R).properties as R).requestedNpcRefs).toMatchObject({ items: { enum: everyone } });
  expect(generic.totals[0], `generic offer ${generic.totals[0]}`).toBeLessThan(30_000);
  // The same sentence with the selection asking for Varo: his view and memory
  // travel to the filling request, the other two stay roster lines.
  const recall = await measure("relevance-recall", "我环顾大厅，看看这里都有谁，他们在做什么。", ["observe", "social"], [VARO]);
  const filled = (recall.fillContext!.entries as R[]).map(entry => String(entry.entryRef));
  expect(filled).toContain(npcDecisionEntryRef(VARO));
  expect(filled).not.toContain(npcDecisionEntryRef(LIAN));
  expect(filled).not.toContain(npcDecisionEntryRef(NAES));
  expect((recall.fillContext!.references as R).npcRecall).toEqual({ shown: [VARO], requestable: visibleNpcs(recall.context).filter(npc => npc !== VARO) });
  expect(((recall.fillContext!.references as R).npcSourceChoices as R[]).map(choice => choice.npcRef)).toEqual([VARO]);
  expect(recall.totals[1], `recall fill ${recall.totals[1]}`).toBeLessThan(allowedInputTokens(VNEXT_PROVIDER_BUDGET));
  console.info(JSON.stringify({ measure: "item", offerTokens: item.totals[0], fillTokens: item.totals[1] })
    + JSON.stringify({ measure: "generic", offerTokens: generic.totals[0], fillTokens: generic.totals[1] })
    + JSON.stringify({ measure: "recall", offerTokens: recall.totals[0], fillTokens: recall.totals[1] }));
}, 90_000);

// ADR 0051: a handle the selection names brings an unread memory into the
// filling. Room reads it at the version the frozen directory recorded, keeps
// it with the prepared action, and accepts the filling request built on the
// frozen context with it: the request would not have been sent otherwise.
it("a handle the selection names brings an unread memory into the filling through Room", async () => {
  const run = await measure("relevance-handle-recall", "我环顾大厅，问瓦罗：这里到底发生了什么事？", ["social"], [], true);
  expect(run.bodies.length, JSON.stringify(run.outcome).slice(0, 300)).toBe(2);
  const offered = ((((run.bodies[0].tools as R[])[0].function as R).parameters as R).properties as R).requestedKnowledgeRefs as R;
  const handle = ((offered.items as R).enum as string[])[0]!;
  const record = (((run.context!.references as R).knowledgeRecall as R[]).flatMap(entry => entry.records as R[]))
    .find(candidate => candidate.handle === handle)!;
  const entryRef = String(record.entryRef);
  expect(entryRefs(run.context)).not.toContain(entryRef);
  // ADR 0052: the stored action keeps the identity of the projection its
  // context was frozen from, not the projection.
  expect(Object.keys(run.storedPrepared!.kpProjection as R).sort()).toEqual(["activeBranchId", "kind", "projectionHash", "stateVersion", "viewer"]);
  const stored = (run.storedPrepared!.recalledKnowledge as R[]);
  expect(stored.map(body => body.entryRef)).toEqual([entryRef]);
  expect(stored[0]!.revisionOrHash).toBe(record.revisionOrHash);
  const filled = (run.fillContext!.entries as R[]).map(entry => String(entry.entryRef));
  expect(filled).toContain(entryRef);
  expect((run.fillContext!.references as R).knowledgeRecall).toMatchObject({ shown: [entryRef] });
  expect((run.modelContext!.entries as R[]).map(entry => String(entry.entryRef))).not.toContain(entryRef);
  // The archive checks the stored body against the frozen version and proves
  // the filling request over the frozen context with it.
  const capabilities = roomServiceCapabilities();
  const exported = await run.stub.exportAuthoritativeArchive(capabilities.archiveExport) as R;
  expect(exported, JSON.stringify(exported).slice(0, 300)).toMatchObject({ kind: "exported" });
  const restored = env.VNEXT_ROOMS.getByName("relevance-handle-recall-restored");
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive as never))
    .toMatchObject({ kind: "restored" });
}, 60_000);
