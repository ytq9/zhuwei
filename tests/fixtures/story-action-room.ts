import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { encodeVNextStrictToolBundle } from "../../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeWorldState } from "../../app/_runtime/lib/rules";
import type { StoryRequest, StoryContext } from "../../app/_runtime/lib/room/story-creation/contracts";
import { characterTimelineId } from "../../app/_runtime/lib/rules/v2/timeline";
import { storyFixture } from "./story-creation.mjs";
import { npcStorySource } from "./kp-vnext-story-materialization.mjs";

export type Json = Record<string, unknown>;
export const ALICE = { principal: { id: "principal:story-room:alice", sessionVersion: 1 } };
export const ACTOR = "character:story-room:alice", SCENE = "wake";
export const LIAN = "npc:black-oak-will:lian", VARO = "npc:black-oak-will:varo";
export const FACT = "candidate:registration-fact", NEW_NPC = "candidate:archivist", HANDLE = "prospective:story-archivist";
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
