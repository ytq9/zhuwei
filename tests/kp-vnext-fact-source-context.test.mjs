import { soleStep, soleInput } from './fixtures/vnext-action-duration.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthoredProbeFixture,freezeAuthoredProbeContext,PROBE_ACTOR as ACTOR,PROBE_SCENE as SCENE} from '../tools/lib/vnext-authored-probe-fixture.mjs';
import {canonicalSha256} from '../app/_runtime/lib/rules/profiles/canonical.ts';
import {authorityRevisionOrHash} from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import {NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA,npcActorPlanFormationIds,npcActorPlanFormationReadRefs} from '../app/_runtime/lib/rules/v2/npc-plan-formation.ts';
import {TIME_PASSAGE_PLAN_SCHEMA,timePassageStartReadRefs} from '../app/_runtime/lib/rules/v2/time-passage.ts';
import {dueActivityDescriptors} from '../app/_runtime/lib/rules/v2/due-activities.ts';
import {dueActorPlanChildRoot} from '../app/_runtime/lib/rules/v2/actor-plans.ts';
import {requiredContextReadBindings} from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import {proposalObservationSubjectRefs} from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import {npcDecisionEntryRef} from '../app/_runtime/lib/kp/vnext/context/npc-decision.ts';
import {freezeAdjudicationContext} from '../app/_runtime/lib/kp/vnext/context/index.ts';
import {encodeVNextStrictToolBundle} from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import {parseSubmitKpProposalBundleCandidateArguments} from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import {lowerVNext2ProposalBundle} from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';

const NPC='npc:independent-worker';
function fixture(label) {return {...createAuthoredProbeFixture(`fact-source:${label}`,{npcCharacters:[{id:NPC,name:'值班人'}],
  initialKnowledge:[{characterId:NPC,knowledgeRef:'knowledge:private',content:'PRIVATE_SOURCE_KNOWLEDGE',kind:'sourceClaim',layer:'partial',visibility:'private',provenanceChain:['genesis:private']}] }),prefix:[]};}
function commit(f,input) {const r=f.runtime.step(f.profiles,f.state,input);assert.equal(r.kind,'committed',JSON.stringify(r));f.state=r.state;f.prefix.push(...r.events);return r;}
function bindings(state,refs) {return [...new Set(refs)].sort().map(ref=>({ref,revisionOrHash:authorityRevisionOrHash(state,ref)}));}
function freeze(f,label='observe') {const rootActionId=`${f.rootActionId}:${label}`;
  return {...f,rootActionId,requiredContext:freezeAuthoredProbeContext(f,f.state,{rootActionId,focusRefs:[],intentText:'我看看周围现在的情况。'}).context};}
function sourcePlan(f) {
  const source={npcRef:NPC,factionRef:null,goal:'PRIVATE_PLAN_GOAL',nextStep:'PRIVATE_PLAN_STEP',premiseRefs:[NPC],resourceRefs:[],durationMicros:'2000000',traceDescription:'门框上多了一条蓝色布带。',alternateTargetRef:SCENE,alternateReason:'PRIVATE_ALTERNATE'};
  const root=`${f.rootActionId}:form`,slot='proposal:formation';
  const plan={schema:NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA,contextHash:canonicalSha256({root}),...npcActorPlanFormationIds(root,slot),source,readSet:bindings(f.state,npcActorPlanFormationReadRefs(f.state,source))};
  commit(f,{kind:'applyAtomicWorldInteractionSteps',rootActionId:root,actorCharacterId:ACTOR,bundleHash:canonicalSha256({root,slot}),contextHash:plan.contextHash,sharedRuling:'directSuccess',steps:[{
    formId:'objective-continuity.vnext-1',proposalRef:slot,ruling:'directSuccess',rulesInput:{kind:'formNpcActorPlan',rootActionId:root,actorCharacterId:ACTOR,plan},dependsOn:[],consumes:[],produces:[],outcomeBinding:'always'}]});
  return plan;
}
function finishPlan(f,plan) {
  const root=`${f.rootActionId}:wait`,activityId=`activity:${root}`;
  commit(f,{kind:'startTimePassage',rootActionId:root,actorCharacterId:ACTOR,plan:{schema:TIME_PASSAGE_PLAN_SCHEMA,contextHash:canonicalSha256({root}),readSet:bindings(f.state,timePassageStartReadRefs(f.state,ACTOR)),activityId,intendedDurationMicros:'2000000',method:'等候。'}});
  const descriptor=dueActivityDescriptors(f.state).find(entry=>entry.activityId===activityId);
  commit(f,{kind:'advanceTimePassage',proposalId:descriptor.childRootActionId,activityId});
  commit(f,{kind:'resolveDueActorPlan',proposalId:dueActorPlanChildRoot(f.state.campaignRuntime.npcPlans[plan.planId]),affectedCharacterId:NPC,causedByRootActionId:root,planId:plan.planId,decision:'execute',mechanicalProposal:null});
  return plan.traceFactRef;
}
function declare(f,ref,{subjectRefs=[SCENE],hidden=false,parents=[]}={}) {
  commit(f,{kind:'declareCanonicalFact',proposalId:`${f.rootActionId}:${ref}`,fact:{factId:ref,factKind:'physicalMark',source:'characterAction',subjectRefs,value:{description:hidden?'HIDDEN_CANARY':'窗框留有已经刻下的记号。',condition:'present'},causalParentIds:parents,visibilityPolicy:hidden?'hiddenUntilEvidence':'public'}});return ref;
}
function observe(f,ref) {
  const raw={mode:'adjudication',basisRefs:[ref],adjudication:{kind:'directSuccess', durationMicros: '6000000',risk:'观察已有的明显痕迹。',successOutcome:'看清已存在的痕迹。'},terminal:{kind:'none'},proposals:[{
    kind:'observe',basisRefs:[ref],consumes:[],produces:[],outcomeBinding:'always',sceneRef:SCENE,inquiry:'现在能看到什么？',method:'留意眼前的痕迹。',focusRefs:[SCENE],existingFactRefs:[ref],branches:{success:{outcomeCode:'seen',summary:'看见已有痕迹。',sensoryEvidence:[{observerRef:ACTOR,subjectRef:SCENE,sense:'sight',evidence:'眼前留有此前出现的痕迹。',basisRefs:[ref]}],characterInferences:[]},failure:{kind:'none'}}}]};
  const parsed=parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(raw)));assert.equal(parsed.kind,'accepted',JSON.stringify(parsed));
  return lowerVNext2ProposalBundle({...f,value:parsed.bundle});
}

for(const source of ['npcTrace','physicalMark'])test(`an already committed ${source} gets exact source binding and uses the same freeze/observe/Rules/replay path`,()=>{
  const f=fixture(source),ref=source==='npcTrace'?finishPlan(f,sourcePlan(f)):declare(f,'fact:physical-mark');
  const next=freeze(f),context=next.requiredContext;
  const frame=context.entries.find(entry=>entry.entryRef.startsWith('profile-context:')).value.factConstraints;
  assert.ok(frame.facts.some(fact=>fact.id===ref),'the same source is already shown to KP');
  const known=context.entries.find(entry=>entry.entryRef===ref&&entry.kind==='known');
  assert.ok(known,'shown canonical facts must receive their own frozen entry');
  assert.deepEqual(known.value,f.state.canonicalFacts[ref]);
  assert.equal(known.revisionOrHash,authorityRevisionOrHash(f.state,ref));
  assert.deepEqual(requiredContextReadBindings(context).get(ref),{ref,revisionOrHash:known.revisionOrHash});
  assert.ok(context.references.citations.viewerEvidenceRefs.includes(ref));
  assert.ok(!proposalObservationSubjectRefs(context).includes(ref),'facts are sources, never physical observation subjects');
  assert.ok(!context.entries.some(entry=>entry.entryRef===npcDecisionEntryRef(NPC)));
  assert.ok(!context.entries.some(entry=>entry.entryRef===`knowledge:${NPC}:knowledge:private`));
  const lowered=observe(next,ref);assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));
  assert.ok(soleStep(lowered.command).plan.readSet.some(binding=>binding.ref===ref&&binding.revisionOrHash===known.revisionOrHash));
  const result=f.runtime.step(f.profiles,f.state,lowered.command.rulesInput);assert.equal(result.kind,'committed',JSON.stringify(result));
  const view=f.runtime.project(f.profiles,result.state,f.viewer,{channel:'realtime',committedRange:{receiptId:result.receipt.receiptId,actorCharacterId:ACTOR,priorState:f.state,events:result.events}});
  assert.equal(view.kind,'projected');assert.doesNotMatch(JSON.stringify(view),/PRIVATE_|HIDDEN_CANARY/);
  const replay=f.runtime.replay(f.genesis,[...f.prefix,...result.events]);assert.equal(replay.kind,'replayed',JSON.stringify(replay));assert.deepEqual(replay.state,result.state);
  assert.deepEqual(result.state.entities,f.state.entities);
  // Observing is an act: the actor's timeline moves by exactly what this root spent -- the declared duration when the
  // observe ran, nothing when Rules first settled a due Activity as its own root (SPEC 0013 F04) and the intent is retried.
  const tl=f.state.multiplayerRuntime.characterTimelineIds[ACTOR]??f.state.activeBranchId;
  const spent=result.events.filter(e=>e.eventType==='FictionTimeAdvanced').reduce((sum,e)=>sum+BigInt(e.payload.durationMicros),0n);
  assert.equal(BigInt(result.state.fictionTimelines[tl].nowMicros)-BigInt(f.state.fictionTimelines[tl].nowMicros),spent);
});

test('future plan trace refs, unrelated facts and hidden facts retain their actual existence and Viewer boundaries',()=>{
  const f=fixture('boundaries'),plan=sourcePlan(f),hidden=declare(f,'fact:hidden',{hidden:true}),remote=declare(f,'fact:remote',{subjectRefs:['place:remote']});
  const next=freeze(f),refs=next.requiredContext.references.citations;
  assert.equal(f.state.canonicalFacts[plan.traceFactRef],undefined);
  assert.ok(!next.requiredContext.entries.some(entry=>entry.entryRef===plan.traceFactRef));
  assert.ok(!next.requiredContext.entries.some(entry=>entry.entryRef===remote));
  assert.ok(next.requiredContext.entries.some(entry=>entry.entryRef===hidden&&entry.kind==='known'));
  assert.ok(refs.authorityBasisRefs.includes(hidden));assert.ok(!refs.viewerEvidenceRefs.includes(hidden));
  for(const ref of [plan.traceFactRef,remote])assert.equal(observe(next,ref).kind,'rejected',ref);
  assert.ok(!proposalObservationSubjectRefs(next.requiredContext).includes(hidden));
  // KP may use hidden causal authority to adjudicate visible evidence. Merely
  // freezing that source must not disclose its body or grant it to the player.
  const lowered=observe(next,hidden);assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));
  const result=f.runtime.step(f.profiles,f.state,lowered.command.rulesInput);assert.equal(result.kind,'committed',JSON.stringify(result));
  const view=f.runtime.project(f.profiles,result.state,f.viewer);assert.equal(view.kind,'projected');
  assert.doesNotMatch(JSON.stringify(view),/HIDDEN_CANARY|PRIVATE_/);
});

test('missing or changed source records cannot be replaced by a Profile binding or committed without their exact read',()=>{
  const f=fixture('binding'),ref=declare(f,'fact:source'),next=freeze(f),lowered=observe(next,ref);assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));
  const missing=structuredClone(next.requiredContext);missing.entries=missing.entries.filter(entry=>entry.entryRef!==ref);
  assert.equal(observe({...next,requiredContext:missing},ref).kind,'rejected');
  for(const mutate of [state=>{delete state.canonicalFacts[ref];},state=>{state.canonicalFacts[ref].value.condition='changed';}]) {
    const state=structuredClone(f.state);mutate(state);const result=f.runtime.step(f.profiles,state,lowered.command.rulesInput);assert.equal(result.kind,'rejected');assert.deepEqual(result.events,[]);
  }
  const input=structuredClone(lowered.command.rulesInput),plan=soleInput(input).plan;plan.readSet=plan.readSet.filter(binding=>binding.ref!==ref);
  const result=f.runtime.step(f.profiles,f.state,input);assert.equal(result.kind,'rejected');assert.deepEqual(result.events,[]);
});

test('already displayed source records over the existing per-entry budget fail closed instead of becoming partial citation candidates',()=>{
  const f=fixture('budget'),ref=declare(f,'fact:oversized');f.state.canonicalFacts[ref].value.description='x'.repeat(70_000);
  const kpProjection=f.runtime.project(f.profiles,f.state,{kind:'kp',capability:'internal:kp-spatial-evidence'});
  const result=freezeAdjudicationContext({state:f.state,profiles:f.profiles,moduleProfile:f.moduleProfile,kpProjection,
    replayHead:{eventSeq:f.state.version,stateHash:canonicalSha256(f.state)},preparedActionId:'prepared:budget',rootActionId:f.rootActionId,submissionRef:'submission:budget',actorCharacterId:ACTOR,intentText:'看看周围。',focusRefs:[],maxUnits:160_000});
  assert.equal(result.kind,'blocked');assert.equal(result.reason,'criticalUnavailable');assert.equal(result.context,undefined);
});
