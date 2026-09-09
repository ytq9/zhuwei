import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../app/_runtime/lib/kp/vnext/proposal-schema";
import { createVNextKpAdapter } from "../../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../../app/_runtime/lib/kp/authoritative-types";
import { handleRoomAction, type RoomAuthorityCapability, type RoomActionInput } from "../../app/_runtime/lib/room/action";
import { ActorPlanTransportCapability } from "../../app/_runtime/lib/room/actor-plan-transport";
import type { StoryPreparationReady } from "../../app/_runtime/lib/room/story-action-context";
import type { StoryCreationStore } from "../../app/_runtime/lib/room/story-creation-store";
import type { StoryLibraryStore } from "../../app/_runtime/lib/room/story-library-store";
import type { VNextInvocationCompletion, VNextInvocationRequest, VNextInvocationStart } from "../../app/_runtime/lib/room/vnext-proposal-invocation";
import type { AuthoritativeWorldState, RuntimeProfileManifest, RuntimeGenesis } from "../../app/_runtime/lib/rules";
import type { StoryRequest, StoryContext } from "../../app/_runtime/lib/room/story-creation/contracts";
import { characterTimelineId } from "../../app/_runtime/lib/rules/v2/timeline";
import { storyFixture, storyReviewBody, storyResponse } from "./story-creation.mjs";
import { npcStorySource } from "./kp-vnext-story-materialization.mjs";

export type Json = Record<string, unknown>;
export const ALICE = { principal: { id: "principal:story-room:alice", sessionVersion: 1 } };
export const ACTOR = "character:story-room:alice", SCENE = "wake";
export const LIAN = "npc:black-oak-will:lian", VARO = "npc:black-oak-will:varo";
export const FACT = "candidate:registration-fact", NEW_NPC = "candidate:archivist", HANDLE = "prospective:story-archivist";
export const LATER_FACT = "candidate:later-audit", LATER_KNOWLEDGE = "candidate:later-audit-memory";
export const PRIVATE = "NPC_ONLY_STORY_MEMORY_船单豁免栏遗漏，但不知道遗漏原因";
export function record(value: unknown): Json {
  expect(value).not.toBeNull(); expect(typeof value).toBe("object"); expect(Array.isArray(value)).toBe(false);
  return value as Json;
}
function substitute<T>(value: T, refs: Map<string, string>): T {
  if (typeof value === "string") return (refs.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map(item => substitute(item, refs)) as T;
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key,item]) => [key,substitute(item,refs)])) as T : value;
}
export const response = (name: string, value: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
  type: "function", function: { name, arguments: JSON.stringify(value) },
}] } }], usage: { prompt_tokens: 100, completion_tokens: 200 } });

export async function initialize(suffix: string) {
  const roomId = `story-action-room:${suffix}`, stub = env.VNEXT_ROOMS.getByName(roomId);
  const result = await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }], characters: [{ characterId: ACTOR,
      controllerPrincipalId: ALICE.principal.id, staticCard: { name: "码头来客", sceneId: SCENE,
        level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str:12,dex:14,con:12,int:10,wis:12,cha:10 }, proficiency:2,skills:["perception"],
        resources:{hitDice:{max:3,used:0}},hp:{current:20,max:20,temp:0},ac:13,speed:30,equipped:{},backpack:[] } }],

  } as never);
  expect(result,JSON.stringify(result)).toMatchObject({created:true});
  return {stub,capabilities:record(record(result).serviceCapabilities)};
}

/** Scripted model outcomes test protocol/Room authority, not literary quality. */
export function draft(input: {request:StoryRequest;context:StoryContext}, state:AuthoritativeWorldState, newNpc:boolean, actorId = ACTOR) {
  const held = (npc:string) => `knowledge:${npc}:${Object.keys(state.knowledge[npc])[0]}`;
  const anchor = input.context.materials.find(value=>value.ref.startsWith("profile-context:"))!.ref;
  expect(input.context.materials.some(value=>value.ref===SCENE)).toBe(true);
  const refs = new Map([["anchor:requisition",anchor],["record:ledger",SCENE],
    ["record:receipt",VARO],["unknown:boatman-culprit",LIAN],["fact:calendar",SCENE],
    ["scene:harbor",SCENE],["scene:archive",SCENE],["npc:boatman",LIAN],["npc:clerk",VARO],
    ["open:local-history",`story-context:open:${SCENE}`],["timeline:local",characterTimelineId(state,actorId)],
    ["knowledge:boatman-order",held(LIAN)],["knowledge:clerk-register",held(VARO)]]);
  const body = substitute(storyFixture(newNpc ? "investigation" : "conflict").body,refs);
  body.existingFactRefs = [anchor];
  body.participants[0].label = newNpc ? "许录" : "莉安·黑橡";
  body.participants[1].label = "书记官瓦罗";
  const now = state.fictionTimelines[characterTimelineId(state,actorId)].nowMicros;
  body.facts[0].occurrence.start.micros = now;
  body.facts[0].occurrence.basisRefs = [SCENE];
  body.facts[0].knowledge[0].acquisition.start.micros = now;
  body.facts[0].knowledge[0].acquisition.basisRefs = [SCENE];
  body.facts[0].knowledge[0].sourceRef = FACT;
  body.facts[0].knowledge[0].content = PRIVATE;
  if (newNpc) {
    const source = npcStorySource();
    source.position = {x:"600",y:"480",elevation:"0"};
    const producer = {kind:"materializeNpc",basisRefs:[SCENE,anchor],
      consumes:[{kind:"existing",ref:SCENE},{kind:"existing",ref:anchor}],
      produces:[{kind:"entity",handle:HANDLE,outcomeBinding:"always"}],outcomeBinding:"always",sceneRef:SCENE,
      source,visibilityPolicyRef:"visibility:scene-observers",summary:"档案员带着原卷抵达。"};
    body.definitions[0] = {ref:NEW_NPC,kind:"npc",capability:"materializeNpc",
      payload:{steps:record(encodeVNextStrictToolBundle(bundle([producer]))).steps},dependsOn:[SCENE,anchor]} as never;
  }
  return body;
}
export function bundle(proposals:unknown[]) {
  return {mode:"adjudication",basisRefs:[SCENE],terminal:null,
    adjudication:{kind:"directSuccess",durationMicros:"0",risk:"只固化已经成立的背景与人物知情。",successOutcome:"保留实际依据。"},proposals};
}

type Internals = RoomAuthorityCapability & {
  storyStore: StoryCreationStore;
  storyLibraryStore: StoryLibraryStore;
  authoritativeReplay(): { state: AuthoritativeWorldState; profiles: RuntimeProfileManifest; genesis: RuntimeGenesis };
  prepareStoryForAction(context: typeof ALICE, id: string, transport: ActorPlanTransportCapability): Promise<StoryPreparationReady>;
  beginVNextProposalInvocation(context: typeof ALICE, id: string, request: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(context: typeof ALICE, id: string, result: VNextInvocationCompletion): Promise<{kind:string}>;
};
export type Capture = { calls: string[]; newNpc: boolean; reuse?: string; failDraft?: boolean;
  definitionsOnly?: boolean; extraFact?: boolean; factRefs?: string[]; providerError?: string; preparationFailure?: unknown };

/** The only replaced boundary is the Provider's scripted result. Preparation,
 * context selection, invocation journals, Rules, SQL and Viewer delivery use
 * the actual Room implementations. Reuse must never request another draft. */
export async function run(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>, input: RoomActionInput, capture: Capture) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    const ai = { async run(_model: string, request: Json): Promise<unknown> {
      const tool = record(record((request.tools as Json[])[0]).function).name as string;
      capture.calls.push(tool);
      const message = JSON.parse(String(record((request.messages as Json[])[1]).content));
      if (tool === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return response(tool, { requestedCapabilities: capture.reuse
        ? [`storyReuse:${capture.reuse}`, "admitStoryFacts"]
        : ["storyPreparation", capture.newNpc ? "storyMethodInvestigation" : "storyMethodConflict", "storyShort",
          capture.newNpc ? "storyMain" : "storyLocal", "admitStoryFacts"] });
      if (tool === "submit_story_preparation") {
        if (capture.failDraft || capture.reuse) throw new Error("simulated unknown provider result");
        try {
          const body = draft(message, target.authoritativeReplay().state, capture.newNpc);
          if (capture.extraFact) {
            const fact = structuredClone(body.facts[0]);
            fact.ref = LATER_FACT;
            fact.content = "原卷的签署日期早于当前抄件，负责核验者能够从卷宗索引复查。";
            fact.knowledge[0] = { ...fact.knowledge[0], ref: LATER_KNOWLEDGE, factRef: LATER_FACT,
              sourceRef: LATER_FACT, content: `${PRIVATE}:后续核验` };
            body.facts.push(fact); body.participants[0].knowledgeRefs.push(LATER_KNOWLEDGE);
          }
          return storyResponse(body, "draft");
        } catch (error) { capture.providerError = error instanceof Error ? error.stack : String(error); throw error; }
      }
      if (tool === "review_story_preparation") {
        if (capture.reuse) throw new Error("A saved preparation must not be re-reviewed by its creation method.");
        const review = storyReviewBody(message);
        review.findings.forEach(finding => { finding.constraintRefs = [message.preparation.existingFactRefs[0], LIAN]; });
        return storyResponse(review, "review");
      }
      if (tool !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw new Error(`Unexpected paid stage: ${tool}`);
      const entries = message.requiredContext.entries as Json[];
      const prepared = record(entries.find(entry => String(entry.entryRef).startsWith("story-preparation:"))!.value);
      const preparationHash = String(prepared.preparationHash);
      const materialized = capture.newNpc && !capture.reuse ? [{ kind: "materializeStory", source: { kind: "entity", preparationHash, candidateRef: NEW_NPC },
        basisRefs: [], consumes: [], produces: [{ handle: HANDLE, kind: "entity", outcomeBinding: "always" }],
        outcomeBinding: "always", summary: "接入已评审档案员。" }] : [];
      const facts = capture.definitionsOnly ? [] : [{ kind: "admitStoryFacts", preparationHash, candidateRefs: capture.factRefs ?? [FACT],
        basisRefs: [], consumes: [], produces: [], outcomeBinding: "always", summary: "保存登记经历与指定人物知情。" }];
      return response(tool, encodeVNextStrictToolBundle(bundle([...materialized, ...facts])));
    } };
    const transport = new ActorPlanTransportCapability(ai);
    const kp = createVNextKpAdapter({ proposalBinding: ai,
      narrationAdapter: { async narrate() { return { body: "你现在可以继续核对登记资料。" }; } } as AuthoritativeKpAdapter,
      prepareStory: async id => {
        const result = await target.prepareStoryForAction(ALICE, id, transport);
        if (result.kind !== "ready") capture.preparationFailure = result;
        return result;
      },
      journal: { begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, result) => target.completeVNextProposalInvocation(ALICE, id, result) } });
    return handleRoomAction({ principal: ALICE, authority: target, kp }, input);
  });
}

export async function snapshot(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { state } = target.authoritativeReplay();
    return { state, jobs: target.storyStore.listCreationJobs(), library: target.storyLibraryStore.listEntries(),
      archive: target.storyStore.archiveSnapshot({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId }) };
  });
}
