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
async function measure(name: string, text: string, capabilities: readonly string[]) {
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
        return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool,
          arguments: JSON.stringify({ requestedCapabilities: capabilities }) } }] } }] };
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
  return { outcome: outcome as R, bodies, context, modelContext, totals: bodies.map(body => tokens(JSON.stringify(body))) };
}

const entryRefs = (context: R | undefined) => (context?.entries as R[] | undefined ?? []).map(entry => String(entry.entryRef));

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
  expect(refs).toContain(npcDecisionEntryRef(VARO));
  // Lexical matches do not prove who the player is addressing.
  for (const npc of [LIAN, NAES]) {
    expect(refs).toContain(npcDecisionEntryRef(npc));
    expect(refs).toContain(npc);
    expect(refs.some(ref => ref.startsWith(`knowledge:${npc}:`))).toBe(true);
  }
  expect(refs.some(ref => ref.startsWith(`knowledge:${VARO}:`))).toBe(true);
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
  expect((run.modelContext!.entries as R[]).map(entry => entry.entryRef)).toEqual(refs);
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
  expect(itemRefs).toContain(npcDecisionEntryRef(LIAN));
  expect(itemRefs).toContain(npcDecisionEntryRef(VARO));
  expect(itemRefs).not.toContain("fact:module:black-oak-will:oak-leaf");
  const generic = await measure("relevance-generic", "我环顾大厅，看看这里都有谁，他们在做什么。", ["observe"]);
  const genericRefs = entryRefs(generic.context);
  for (const npc of [VARO, LIAN, NAES]) expect(genericRefs).toContain(npcDecisionEntryRef(npc));
  expect(generic.totals[0], `generic offer ${generic.totals[0]}`).toBeLessThan(allowedInputTokens(VNEXT_PROVIDER_BUDGET));
  console.info(JSON.stringify({ measure: "item", offerTokens: item.totals[0], fillTokens: item.totals[1] },
  ) + JSON.stringify({ measure: "generic", offerTokens: generic.totals[0], fillTokens: generic.totals[1] }));
}, 60_000);
