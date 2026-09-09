import { storyModelRequest } from "../app/_runtime/lib/room/story-creation/prompt";
import { storyProviderRequest } from "../app/_runtime/lib/room/story-preparation-host";
import { createStoryRecipes } from "../app/_runtime/lib/room/story-creation";
import { ROOM_STORY_TRANSPORT } from "../app/_runtime/lib/room/story-runtime-policy";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json";
import { conservativeInputTokens } from "../app/_runtime/lib/kp/vnext/invocation/budget";
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative-types";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { handleRoomAction, type RoomAuthorityCapability, type RoomActionInput } from "../app/_runtime/lib/room/action";
import { ActorPlanTransportCapability } from "../app/_runtime/lib/room/actor-plan-transport";
import type { StoryPreparationReady } from "../app/_runtime/lib/room/story-action-context";
import type { StoryCreationStore } from "../app/_runtime/lib/room/story-creation-store";
import type { StoryLibraryStore } from "../app/_runtime/lib/room/story-library-store";
import type { StoryRequest, StoryContext, StoryPreparation } from "../app/_runtime/lib/room/story-creation/contracts";
import type { VNextInvocationCompletion, VNextInvocationRequest, VNextInvocationStart } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import type { AuthoritativeWorldState, RuntimeProfileManifest, RuntimeGenesis } from "../app/_runtime/lib/rules";
import { characterTimelineId } from "../app/_runtime/lib/rules/v2/timeline";
import { storyFixture, storyReviewBody, storyResponse } from "./fixtures/story-creation.mjs";
import { npcStorySource } from "./fixtures/kp-vnext-story-materialization.mjs";
import { inspectStoryPreparation } from "../app/_runtime/lib/room/story-creation/review";
import { compileAtomicWorldInteractionPlan } from "../app/_runtime/lib/rules/v2/world-interactions";
import { isStoryFactsAdmissionPlan } from "../app/_runtime/lib/rules/v2/story-facts-admission";
import { isCanonicalReadSet } from "../app/_runtime/lib/rules/v2/world-interaction-model";

type Json = Record<string, unknown>;
const ALICE = { principal: { id: "principal:story-room:alice", sessionVersion: 1 } };
const ACTOR = "character:story-room:alice", SCENE = "wake";
const LIAN = "npc:black-oak-will:lian", VARO = "npc:black-oak-will:varo";
const FACT = "candidate:registration-fact", NEW_NPC = "candidate:archivist", HANDLE = "prospective:story-archivist";
const PRIVATE = "NPC_ONLY_STORY_MEMORY_船单豁免栏遗漏，但不知道遗漏原因";
type Internals = RoomAuthorityCapability & {
  storyStore: StoryCreationStore;
  storyLibraryStore: StoryLibraryStore;
  authoritativeReplay(): { state: AuthoritativeWorldState; profiles: RuntimeProfileManifest; genesis: RuntimeGenesis };
  prepareStoryForAction(context: typeof ALICE, id: string, transport: ActorPlanTransportCapability): Promise<StoryPreparationReady>;
  beginVNextProposalInvocation(context: typeof ALICE, id: string, request: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(context: typeof ALICE, id: string, result: VNextInvocationCompletion): Promise<{kind:string}>;
};
function record(value: unknown): Json {
  expect(value).not.toBeNull(); expect(typeof value).toBe("object"); expect(Array.isArray(value)).toBe(false);
  return value as Json;
}
function substitute<T>(value: T, refs: Map<string, string>): T {
  if (typeof value === "string") return (refs.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map(item => substitute(item, refs)) as T;
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key,item]) => [key,substitute(item,refs)])) as T : value;
}
const response = (name: string, value: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{
  type: "function", function: { name, arguments: JSON.stringify(value) },
}] } }], usage: { prompt_tokens: 100, completion_tokens: 200 } });

async function initialize(suffix: string) {
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
function draft(input: {request:StoryRequest;context:StoryContext}, state:AuthoritativeWorldState, newNpc:boolean) {
  const held = (npc:string) => `knowledge:${npc}:${Object.keys(state.knowledge[npc])[0]}`;
  const anchor = input.context.materials.find(value=>value.ref.startsWith("profile-context:"))!.ref;
  expect(input.context.materials.some(value=>value.ref===SCENE)).toBe(true);
  const refs = new Map([["anchor:requisition",anchor],["record:ledger",SCENE],
    ["record:receipt",VARO],["unknown:boatman-culprit",LIAN],["fact:calendar",SCENE],
    ["scene:harbor",SCENE],["scene:archive",SCENE],["npc:boatman",LIAN],["npc:clerk",VARO],
    ["open:local-history",`story-context:open:${SCENE}`],["timeline:local",characterTimelineId(state,ACTOR)],
    ["knowledge:boatman-order",held(LIAN)],["knowledge:clerk-register",held(VARO)]]);
  const body = substitute(storyFixture(newNpc ? "investigation" : "conflict").body,refs);
  body.existingFactRefs = [anchor];
  body.participants[0].label = newNpc ? "许录" : "莉安·黑橡";
  body.participants[1].label = "书记官瓦罗";
  const now = state.fictionTimelines[characterTimelineId(state,ACTOR)].nowMicros;
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
function bundle(proposals:unknown[]) {
  return {mode:"adjudication",basisRefs:[SCENE],terminal:null,
    adjudication:{kind:"directSuccess",durationMicros:"0",risk:"只固化已经成立的背景与人物知情。",successOutcome:"保留实际依据。"},proposals};
}
type Capture={calls:string[];newNpc:boolean;reuse?:string;failDraft?:boolean;diagnostics?:unknown;providerError?:string;inspection?:unknown;admissionError?:string;projectionError?:unknown};
async function run(stub:ReturnType<typeof env.VNEXT_ROOMS.getByName>, input:RoomActionInput, capture:Capture) {
  return runInDurableObject(stub,async instance=>{
    const target=instance as unknown as Internals;
    const projectionHooks = instance as unknown as { authorityAudienceBindings: (...args:unknown[])=>Json;
      authorityViewerForCharacter:(state:unknown,id:unknown)=>unknown; rulesRuntime:{project:(...args:unknown[])=>unknown} };
    const audiences = projectionHooks.authorityAudienceBindings.bind(instance);
    projectionHooks.authorityAudienceBindings = (...args) => {
      const result = audiences(...args);
      if (result.kind === "rejected") {
        const [profiles,state,actorCharacterId,receiptId,,priorState,events] = args;
        capture.projectionError = projectionHooks.rulesRuntime.project(profiles,state,projectionHooks.authorityViewerForCharacter(state,actorCharacterId),
          {committedRange:{receiptId,actorCharacterId,priorState,events}});
      }
      return result;
    };
    const hooks=instance as unknown as {storyAdmissionPreparation:(...args:unknown[])=>unknown};
    const admit=hooks.storyAdmissionPreparation.bind(instance);
    hooks.storyAdmissionPreparation=(...args)=>{try{return admit(...args);}catch(error){
      const raw = args[1] as Json;
      const atomic = raw.kind === "startActionActivity" ? raw.completionInput as Json : raw;
      const plans = (atomic.steps as Json[]).filter(step=>(step.rulesInput as Json).kind === "admitStoryFacts").map(step=>(step.rulesInput as Json).plan as Json);
      capture.admissionError=`${error instanceof Error?error.stack:String(error)}; compiler:${JSON.stringify(compileAtomicWorldInteractionPlan(args[1] as never))}; plans:${JSON.stringify(plans.map(plan=>({
        ...plan, readSet:(plan.readSet as Json[]).filter(read=>!isCanonicalReadSet([read])), canonicalReads:isCanonicalReadSet(plan.readSet), validPlan:isStoryFactsAdmissionPlan(plan)})))}`;throw error;}};
    const ai={async run(_model:string,request:Json):Promise<unknown>{
      const tool=record(record((request.tools as Json[])[0]).function).name as string;
      capture.calls.push(tool);
      const message=JSON.parse(String(record((request.messages as Json[])[1]).content));
      if(tool===OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return response(tool,{requestedCapabilities:capture.reuse
        ?[`storyReuse:${capture.reuse}`,"admitStoryFacts"]
        :["storyPreparation",capture.newNpc?"storyMethodInvestigation":"storyMethodConflict","storyShort",capture.newNpc?"storyMain":"storyLocal","admitStoryFacts"]});
      if(tool==="submit_story_preparation") {
        if(capture.failDraft) throw new Error("simulated unknown provider result");
        try {
          const body=draft(message,target.authoritativeReplay().state,capture.newNpc);
          capture.inspection=inspectStoryPreparation({...body,format:"zhuwei.story-preparation/v1",jobId:message.request.jobId,version:"1",
            requestHash:canonicalHash(message.request),contextHash:message.context.contextHash,recipeRefs:message.request.recipeRefs},
          message.request,message.context,canonicalHash);
          return storyResponse(body,"draft");
        }
        catch (error) { capture.providerError=error instanceof Error?error.stack:String(error); throw error; }
      }
      if(tool==="review_story_preparation") {
        const review=storyReviewBody(message);
        review.findings.forEach(finding=>{finding.constraintRefs=[message.preparation.existingFactRefs[0],LIAN];});
        return storyResponse(review,"review");
      }
      if(tool!==SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw new Error(`Unexpected paid stage: ${tool}`);
      const entries=message.requiredContext.entries as Json[];
      const prepared=record(entries.find(entry=>String(entry.entryRef).startsWith("story-preparation:"))!.value);
      const preparationHash=String(prepared.preparationHash);
      const materialized=capture.newNpc?[{kind:"materializeStory",source:{kind:"entity",preparationHash,candidateRef:NEW_NPC},
        basisRefs:[],consumes:[],produces:[{handle:HANDLE,kind:"entity",outcomeBinding:"always"}],outcomeBinding:"always",summary:"接入已评审档案员。"}]:[];
      return response(tool,encodeVNextStrictToolBundle(bundle([...materialized,{kind:"admitStoryFacts",preparationHash,candidateRefs:[FACT],
        basisRefs:[],consumes:[],produces:[],outcomeBinding:"always",summary:"保存登记经历与指定人物知情。"}])));
    }};
    const transport=new ActorPlanTransportCapability(ai);
    const kp=createVNextKpAdapter({proposalBinding:ai,
      narrationAdapter:{async narrate(){return {body:"你现在可以继续核对登记资料。"};}} as AuthoritativeKpAdapter,
      prepareStory:async id=>{
        const outcome=await target.prepareStoryForAction(ALICE,id,transport);
        if(outcome.kind!=="ready") {
          const job=target.storyStore.listCreationJobs()[0];
          const body=job?storyProviderRequest(storyModelRequest({request:job.request,context:job.context,stage:"draft",
            requestHash:canonicalHash(job.request) as never,recipes:createStoryRecipes(canonicalHash as never)}),ROOM_STORY_TRANSPORT):null;
          capture.diagnostics={outcome,hasJob:!!job,usage:job?.usage,bytes:body?new TextEncoder().encode(JSON.stringify(body)).byteLength:0,
            estimatedTokens:body?conservativeInputTokens(JSON.stringify(body)):0,
            contextSizes:job?Object.fromEntries(Object.entries(job.context).map(([key,value])=>[key,JSON.stringify(value).length])):null,
            materials:job?.context.materials.map(value=>[value.ref,JSON.stringify(value).length]).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,12)};
        }
        return outcome;
      },
      journal:{begin:(id,request)=>target.beginVNextProposalInvocation(ALICE,id,request),
        complete:(id,result)=>target.completeVNextProposalInvocation(ALICE,id,result)}});
    return handleRoomAction({principal:ALICE,authority:target,kp},input);
  });
}
async function snapshot(stub:ReturnType<typeof env.VNEXT_ROOMS.getByName>){
  return runInDurableObject(stub,instance=>{
    const target=instance as unknown as Internals,{state}=target.authoritativeReplay();
    return {state,jobs:target.storyStore.listCreationJobs(),library:target.storyLibraryStore.listEntries(),
      archive:target.storyStore.archiveSnapshot({roomId:state.roomId,runtimeEpochId:state.runtimeEpochId})};
  });
}

describe("story creation through the actual vNext Room boundary",()=>{
  for(const newNpc of [false,true]) it(`${newNpc?"new NPC investigation":"existing NPC conflict"}: selection, review, atomic admission, Viewer isolation and exact retry`,async()=>{
    const f=await initialize(newNpc?"new-npc":"existing-npc"),before=await snapshot(f.stub);
    const capture:Capture={calls:[],newNpc};
    const input:RoomActionInput={kind:"intent",submissionId:"submission:story:initial",
      text:"我想与莉安 lian、瓦罗 varo 一起核对临时征船登记和运输签收资料，主动调查目前的差异。"};
    const result=await run(f.stub,input,capture);
    expect(result,JSON.stringify({result,calls:capture.calls,providerError:capture.providerError,projectionError:capture.projectionError,admissionError:capture.admissionError,inspection:capture.inspection,diagnostics:capture.diagnostics})).toMatchObject({kind:"committed"});
    expect(capture.calls).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,"submit_story_preparation","review_story_preparation",SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
    const saved=await snapshot(f.stub);
    expect(saved.jobs).toHaveLength(1);expect(saved.library).toHaveLength(1);
    expect(saved.jobs[0].checkpoint?.status).toBe("ready");
    const holder=newNpc?Object.keys(saved.state.entities).find(id=>!before.state.entities[id]&&saved.state.entities[id].kind==="npc")!:LIAN;
    expect(JSON.stringify(saved.state.knowledge[holder])).toContain(PRIVATE);
    expect(JSON.stringify(saved.state.knowledge[ACTOR])).not.toContain(PRIVATE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    if(!newNpc) expect(saved.state.entities[LIAN]).toEqual(before.state.entities[LIAN]);
    await evictDurableObject(f.stub);
    expect(await run(f.stub,input,capture)).toEqual(result);
    expect((await snapshot(f.stub)).state).toEqual(saved.state);
    expect(capture.calls).toHaveLength(4);
  });

  it("a draft with unknown provider outcome cannot create facts or resample on retry",async()=>{
    const f=await initialize("unknown"),before=await snapshot(f.stub),capture:Capture={calls:[],newNpc:false,failDraft:true};
    const input:RoomActionInput={kind:"intent",submissionId:"submission:story:unknown",text:"我想和莉安 lian、瓦罗 varo 深入调查征船登记差异。"};
    const first=await run(f.stub,input,capture);
    expect(record(first).kind).not.toBe("committed");
    expect(capture.calls).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,"submit_story_preparation"]);
    await evictDurableObject(f.stub);
    await run(f.stub,input,capture);
    expect(capture.calls).toHaveLength(2);
    expect((await snapshot(f.stub)).state).toEqual(before.state);
  });
});
