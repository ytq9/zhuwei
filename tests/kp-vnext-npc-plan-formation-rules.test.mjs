import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE} from '../tools/lib/vnext-authored-probe-fixture.mjs';
import {canonicalSha256} from '../app/_runtime/lib/rules/profiles/canonical.ts';
import {authorityRevisionOrHash} from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import {createDefinitionSnapshot, storedSemanticDefinition} from '../app/_runtime/lib/rules/v2/semantic-definitions.ts';
import {authoritativeNpcDecisionContext} from '../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import {NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA, npcActorPlanFormationIds, npcActorPlanFormationSourceConform,
  npcActorPlanFormationReadRefs, npcActorPlanFormationPremiseRef, npcActorPlanFormationResourceRefs} from '../app/_runtime/lib/rules/v2/npc-plan-formation.ts';
import {dueActorPlanChildRoot} from '../app/_runtime/lib/rules/v2/actor-plans.ts';
import {characterTimelineId} from '../app/_runtime/lib/rules/v2/timeline.ts';
import {TIME_PASSAGE_PLAN_SCHEMA,timePassageStartReadRefs} from '../app/_runtime/lib/rules/v2/time-passage.ts';
import {dueActivityDescriptors} from '../app/_runtime/lib/rules/v2/due-activities.ts';
import {socialThreadRef,socialListeners} from '../app/_runtime/lib/rules/v2/social-interaction.ts';
import {continueCompoundRoot} from '../app/_runtime/lib/rules/v2/internal-compound.ts';
import {NARRATIVE_DETAIL_PLAN_SCHEMA} from '../app/_runtime/lib/rules/v2/narrative-commitments.ts';
import {deriveAuthorityClaimsFromCommittedRange} from '../app/_runtime/lib/rules/v2/claims.ts';

const NPC='npc:planner', SECOND='npc:other-planner', KNOWLEDGE='knowledge:order', IDENTITY='definition:planner', FACTION='faction:watch';
const NPC_VIEWER={kind:'npc',npcId:NPC,purpose:'kpDecision',capability:'internal:npc-limited-knowledge'};
const TEXT='门框上多了一条新系的蓝色布带。';
function call(f,state,input,kind='committed') {const result=f.runtime.step(f.profiles,state,input);assert.equal(result.kind,kind,JSON.stringify(result));return result;}
function fixture(label,{knowledge=false,identity=false,faction=false}={}) {
  const content={label:'值班人',description:'PRIVATE_BACKGROUND',links:{entityRef:NPC},semantics:{attitude:'谨慎',goals:[{goalRef:'goal:duty',description:'PRIVATE_EXISTING_GOAL'}],plans:[]},privateNotes:'AUTHORITY_CANARY'};
  const f=createAuthoredProbeFixture(`formation:${label}`,{npcCharacters:[{id:NPC,name:'值班人',resources:{supplies:3}},{id:SECOND,name:'抄写员'}],
    initialKnowledge:knowledge?[NPC,SECOND].map(characterId=>({characterId,knowledgeRef:KNOWLEDGE,content:characterId===NPC?'PRIVATE_ORDER':'OTHER_NPC_CANARY',kind:'sourceClaim',layer:'partial',visibility:'private',provenanceChain:[`genesis:${characterId}`]})):[],
    semanticDefinitions:identity?[storedSemanticDefinition('npc','visibility:scene-observers',createDefinitionSnapshot(IDENTITY,'1',content))]:[],
    entityDefinitionBindings:identity?[{entityRef:NPC,definitionRef:IDENTITY}]:[]});
  f.prefix=[];
  if(faction) {
    const r=call(f,f.state,{kind:'registerDynamicDefinition',proposalId:'root:existing-faction',definition:{definitionId:'definition:watch',definitionKind:'faction',revision:'1',rulesBasis:'zhuwei-product-ruling',visibilityPolicyRef:'visibility:scene-observers',content:{factionId:FACTION,name:'值班队',goal:'PRIVATE_FACTION_GOAL',memberRefs:[NPC],resourceRefs:['faction-resource:bell']}}});
    f.state=r.state;f.prefix.push(...r.events);
  }
  return f;
}
function source(overrides={}) {return {npcRef:NPC,factionRef:null,goal:'PRIVATE_NEW_GOAL',nextStep:'PRIVATE_NEXT_STEP',premiseRefs:[NPC],resourceRefs:[],durationMicros:'2000000',traceDescription:TEXT,alternateTargetRef:SCENE,alternateReason:'PRIVATE_ALTERNATE',...overrides};}
function bindings(state,refs) {return [...new Set(refs)].sort().map(ref=>({ref,revisionOrHash:authorityRevisionOrHash(state,ref)}));}
function actCosts(state) {return {costs:[{kind:'fictionTime',durationMicros:'6000000'}],readSet:bindings(state,[ACTOR,`character-timeline:${ACTOR}`])};}
function formation(f,src=source(),slot='proposal:form',root=f.rootActionId) {
  const refs=npcActorPlanFormationReadRefs(f.state,src);assert.ok(refs,'fixture source must be available');
  const plan={schema:NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA,contextHash:canonicalSha256({root}),...npcActorPlanFormationIds(root,slot),source:src,readSet:bindings(f.state,refs)};
  const rulesInput={kind:'formNpcActorPlan',rootActionId:root,actorCharacterId:ACTOR,plan};
  return {kind:'applyAtomicWorldInteractionSteps',rootActionId:root,actorCharacterId:ACTOR,bundleHash:canonicalSha256({root,slot}),contextHash:plan.contextHash,sharedRuling:'directSuccess',steps:[{formId:'objective-continuity.vnext-1',proposalRef:slot,ruling:'directSuccess',rulesInput,dependsOn:[],consumes:[],produces:[],outcomeBinding:'always'}]};
}
function claims(f,r,prior=f.state,viewer=f.viewer,actorCharacterId=ACTOR) {
  const p=f.runtime.project(f.profiles,r.state,viewer,{channel:'realtime',committedRange:{receiptId:r.receipt.receiptId,actorCharacterId,priorState:prior,events:r.events}});
  assert.equal(p.kind,'projected',JSON.stringify(p));assert.ok(p.renderableClaims);return p;
}
function replay(f,events,state) {const r=f.runtime.replay(f.genesis,[...f.prefix,...events]);assert.equal(r.kind,'replayed',JSON.stringify(r));assert.deepEqual(r.state,state);}
function finishDue(f,r,plan) {
  const root=`${f.rootActionId}:wait`,waitId=`activity:${root}`;
  const wait=call(f,r.state,{kind:'startTimePassage',rootActionId:root,actorCharacterId:ACTOR,plan:{schema:TIME_PASSAGE_PLAN_SCHEMA,contextHash:canonicalSha256({root}),readSet:bindings(r.state,timePassageStartReadRefs(r.state,ACTOR)),activityId:waitId,intendedDurationMicros:plan.source.durationMicros,method:'等候值班人。'}});
  const descriptor=dueActivityDescriptors(wait.state).find(d=>d.activityId===waitId);assert.ok(descriptor);
  const advance=call(f,wait.state,{kind:'advanceTimePassage',proposalId:descriptor.childRootActionId,activityId:waitId});
  const persisted=advance.state.campaignRuntime.npcPlans[plan.planId],rootActionId=dueActorPlanChildRoot(persisted);
  const dueInput={kind:'resolveDueActorPlan',proposalId:rootActionId,affectedCharacterId:NPC,causedByRootActionId:root,planId:plan.planId,decision:'execute',mechanicalProposal:null};
  const done=call(f,advance.state,dueInput);call(f,done.state,dueInput,'rejected');
  return {done,events:[...wait.events,...advance.events,...done.events]};
}

test('own self without Knowledge and own identity form the same private timer plan, without costs or a premature trace; due once and replay',()=>{
  for(const identity of [false,true]) {
    const f=fixture(`self-${identity}`,{identity}),context=authoritativeNpcDecisionContext(f.state,f.profiles,NPC);
    assert.ok(context);assert.equal(context.knowledge.length,0);
    const premise=npcActorPlanFormationPremiseRef(context,identity?IDENTITY:NPC);assert.equal(premise,identity?IDENTITY:NPC);
    const input=formation(f,source({premiseRefs:[premise]})),plan=input.steps[0].rulesInput.plan;
    const r=call(f,f.state,input);
    assert.deepEqual(r.events.map(e=>e.eventType),['NpcPlanFormed','ActivityStarted','AtomicWorldInteractionStepsResolved']);
    assert.deepEqual(r.state.fictionTimelines,f.state.fictionTimelines);assert.deepEqual(r.state.entities,f.state.entities);
    assert.deepEqual(r.state.knowledge,f.state.knowledge);assert.equal(r.state.canonicalFacts[plan.traceFactRef],undefined);
    assert.equal(r.state.campaignRuntime.activities[plan.activityId].status,'active');
    const p=claims(f,r);assert.deepEqual(p.renderableClaims.claims,[]);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_|AUTHORITY_CANARY|npc-plan:/);
    const audit=deriveAuthorityClaimsFromCommittedRange({receipt:r.receipt,actorCharacterId:ACTOR,priorState:f.state,state:r.state,events:r.events});assert.deepEqual(audit.claims,[]);
    replay(f,r.events,r.state);
    const {done,events}=finishDue(f,r,plan);assert.equal(done.state.canonicalFacts[plan.traceFactRef].value.description,TEXT);
    assert.equal(done.state.campaignRuntime.activities[plan.activityId].status,'completed');
    replay(f,[...r.events,...events],done.state);
  }
});

test('held Knowledge, existing social obligations and legitimate faction resource domains use the same formation command',()=>{
  for(const basis of ['knowledge','promise','relationship','debt','faction']) {
    const f=fixture(basis,{knowledge:true,faction:basis==='faction'});let premise=KNOWLEDGE;
    if(basis==='debt') {
      const declared=call(f,f.state,{kind:'declareCanonicalFact',proposalId:'root:debt-basis',fact:{factId:'fact:debt-basis',factKind:'relationshipBasis',subjectRefs:[],source:'observedEvent',value:{description:'借用器材已发生'},causalParentIds:[],visibilityPolicy:'hiddenUntilEvidence'}});
      f.state=declared.state;f.prefix.push(...declared.events);
    }
    if(basis==='promise'||basis==='relationship'||basis==='debt') {
      const command=basis==='promise'?{kind:'makePromise',promiseId:'promise:duty',promisorId:NPC,promiseeId:ACTOR,content:'完成值班标记',condition:'交接后'}:
        basis==='relationship'?{kind:'changeRelationship',relationshipId:'relationship:duty',subjectIds:[NPC,ACTOR],change:'信任值班同伴',basisFactIds:[]}:
        {kind:'incurDebt',debtId:'debt:duty',debtorId:NPC,creditorId:ACTOR,obligation:'完成交接标记',condition:'交接时',basisFactIds:['fact:debt-basis']};
      const social=call(f,f.state,{proposalId:`root:existing-${basis}`,...command});f.state=social.state;f.prefix.push(...social.events);
      premise=command.promiseId??command.relationshipId??command.debtId;
    }
    const factionRef=basis==='faction'?FACTION:null,resourceRefs=npcActorPlanFormationResourceRefs(f.state,NPC,factionRef,['supplies']);assert.ok(resourceRefs);
    const context=authoritativeNpcDecisionContext(f.state,f.profiles,NPC);assert.ok(context);
    const recordRef=basis==='promise'?'continuity:promises:promise:duty':basis==='relationship'?'continuity:relationships:relationship:duty':basis==='debt'?'continuity:debts:debt:duty':`knowledge:${NPC}:${KNOWLEDGE}`;
    assert.equal(npcActorPlanFormationPremiseRef(context,recordRef),premise);
    assert.equal(npcActorPlanFormationPremiseRef(context,`knowledge:${SECOND}:${KNOWLEDGE}`),undefined);
    const input=formation(f,source({premiseRefs:[premise],factionRef,resourceRefs})),r=call(f,f.state,input),plan=input.steps[0].rulesInput.plan;
    assert.equal(r.state.entities[NPC].resources.supplies,3);
    if(factionRef) {assert.ok(r.state.campaignRuntime.factionPlans[plan.planId]);assert.deepEqual(resourceRefs,[FACTION,'faction-resource:bell','supplies'].sort());}
    assert.deepEqual(claims(f,r).renderableClaims.claims,[]);replay(f,r.events,r.state);
    if (factionRef) {
      const bad={receipt:r.receipt,actorCharacterId:ACTOR,priorState:f.state,state:r.state,events:r.events.filter(event=>event.eventType!=='FactionPlanFormed')};
      assert.throws(()=>deriveAuthorityClaimsFromCommittedRange(bad),/VNEXT_CLAIM_EVENT_UNKNOWN/);
    }
  }
});

test('foreign basis, stale or absent original reads, faction outsider, Activity overlap and forged IDs reject the entire Bundle',()=>{
  for(const variant of ['foreign','missingRead','staleRead','faction','activity','ids']) {
    const f=fixture(variant,{knowledge:true,faction:true}),input=formation(f),plan=input.steps[0].rulesInput.plan;
    if(variant==='foreign')plan.source.premiseRefs=[`knowledge:${SECOND}:${KNOWLEDGE}`];
    if(variant==='missingRead')plan.readSet=plan.readSet.filter(b=>b.ref!==`character-timeline:${NPC}`);
    if(variant==='staleRead')plan.readSet[0].revisionOrHash=canonicalSha256({stale:true});
    if(variant==='faction') {plan.source.factionRef=FACTION;plan.source.resourceRefs=[FACTION,'faction-resource:bell'];f.state.campaignRuntime.factions[FACTION].memberRefs=[SECOND];}
    if(variant==='activity')f.state.campaignRuntime.activities['activity:busy']={activityId:'activity:busy',characterId:NPC,activityKind:'work',status:'active',startedAtFictionMicros:'0',intendedDurationMicros:'5',completion:{}};
    if(variant==='ids')plan.planId='plan:forged';
    const before=structuredClone(f.state);call(f,f.state,input,'rejected');assert.deepEqual(f.state,before);assert.equal(f.state.receipts[input.rootActionId],undefined);
  }
});

function socialInput(f,check=false) {
  const root=f.rootActionId,context=authoritativeNpcDecisionContext(f.state,f.profiles,NPC),resolutionId=`resolution:${root}`;
  const branch=failure=>({outcomeCode:failure?'declined':'agreed',summary:failure?'拒绝请求。':'答应请求。',response:{kind:'speech',text:failure?'我现在不答应。':'我会完成交接标记。',motive:'PRIVATE_SOCIAL_MOTIVE',basis:[{kind:'npcContext',ref:`knowledge:${NPC}:${KNOWLEDGE}`}]},consequences:failure?[]:[{kind:'promise',content:'完成交接标记。',condition:'本次交接后。',authorityRefs:[NPC]}]});
  const social={schema:'zhuwei.social-interaction/vnext-1',npcRef:NPC,threadRef:socialThreadRef(root,resolutionId),addressedThreadRef:null,playerExpression:'请完成交接标记。',goal:'完成交接',communication:'spokenConversation',audience:'participants',listeners:socialListeners(f.state,ACTOR,NPC,'participants'),npcContext:context,retryChange:null,branches:{success:branch(false),failure:branch(true)}};
  return {kind:'resolveWorldInteraction',rootActionId:root,actorCharacterId:ACTOR,plan:{schema:'zhuwei.world-interaction-resolution-plan/v1',resolutionId,interactionRef:`interaction:${root}`,actorCharacterId:ACTOR,sceneRef:SCENE,abilityRef:null,contextHash:canonicalSha256({root}),readSet:bindings(f.state,[ACTOR,`character-timeline:${ACTOR}`,...context.records.map(r=>r.ref),...context.knowledge.map(r=>r.entryRef)]),targetRefs:[NPC],directTargetRefs:[NPC],instrumentRefs:[],basisRefs:[NPC],intent:social.playerExpression,method:'礼貌请求',ruling:check?{kind:'check',resolutionKind:'abilityCheck',randomnessId:`randomness:${resolutionId}`,check:{kind:'skill',ability:'charisma',skill:'persuasion',dc:'12',modifier:'0',mode:'normal',goal:'完成交接',method:'礼貌请求',risk:'可能拒绝',successOutcome:'同意',failureOutcome:'拒绝',costs:[]}}:{kind:'directSuccess'},costs:[],social,branches:Object.fromEntries(Object.entries(social.branches).map(([key,b])=>[key,{outcomeCode:b.outcomeCode,summary:b.summary,effects:[],sensoryEvidence:[],pressures:[],opportunities:[]}]))}};
}
function socialStep(command,check=false) {return {formId:'social.vnext-1',proposalRef:'proposal:social',ruling:check?'check':'directSuccess',rulesInput:command,dependsOn:[],consumes:[],produces:[],outcomeBinding:'always'};}

test('a real earlier social step cannot donate its newly made promise as a formation premise in the same Bundle',()=>{
  const f=fixture('social-prefix',{knowledge:true}),command=socialInput(f),social=call(f,f.state,command);
  const promise=Object.keys(social.state.campaignRuntime.promises)[0];assert.ok(promise);
  const candidate={...f,state:social.state},input=formation(candidate,source({premiseRefs:[promise]}));
  input.steps.unshift(socialStep(command));input.executionCosts=actCosts(f.state);
  const before=structuredClone(f.state),rejected=call(f,f.state,input,'rejected');
  assert.match(rejected.rejection.message,/before-the-bundle|source-binding/);assert.deepEqual(f.state,before);
  assert.equal(f.state.campaignRuntime.promises[promise],undefined);assert.equal(f.state.receipts[f.rootActionId],undefined);
});

test('one shared check selects an already frozen formation branch; invalid formation rejects before a dice request',()=>{
  for(const roll of [1,20]) {
    const f=fixture(`shared-check-${roll}`,{knowledge:true}),input=formation(f),command=socialInput(f,true),formationStep=input.steps[0];
    input.sharedRuling='check';formationStep.ruling='check';formationStep.outcomeBinding='onSuccess';formationStep.dependsOn=['proposal:social'];input.steps.unshift(socialStep(command,true));input.executionCosts=actCosts(f.state);
    const pending=call(f,f.state,input,'awaitingRandomness');assert.equal(Object.keys(pending.state.campaignRuntime.npcPlans).length,0);
    const restored=f.runtime.replay(f.genesis,pending.events);assert.equal(restored.kind,'replayed');
    const resumed=call(f,restored.state,{kind:'fulfillAuthoritativeRandomness',continuation:pending.continuation,rolls:[roll]});
    assert.equal(Object.keys(resumed.state.campaignRuntime.npcPlans).length,roll===20?1:0);
    assert.equal(resumed.state.entities[NPC].resources.supplies,3);replay(f,[...pending.events,...resumed.events],resumed.state);
    const invalid=structuredClone(input);invalid.steps[1].rulesInput.plan.source.premiseRefs=['knowledge:missing'];
    const rejected=call(f,f.state,invalid,'rejected');assert.equal(rejected.randomnessRequest,undefined);assert.deepEqual(rejected.events,[]);
  }
});

test('same-Bundle prospective sources and future trigger subscriptions are refused rather than treated as existing knowledge',()=>{
  const f=fixture('new-basis'),input=formation(f),plan=input.steps[0].rulesInput.plan;
  plan.source.premiseRefs=['knowledge:new-social'];plan.readSet.push({ref:`knowledge:${NPC}:knowledge:new-social`,revisionOrHash:canonicalSha256({new:true})});plan.readSet.sort((a,b)=>a.ref.localeCompare(b.ref));
  call(f,f.state,input,'rejected');
  const prospective=formation(f);prospective.steps[0].consumes=[{kind:'prospective',handle:'prospective:new-plan-basis'}];call(f,f.state,prospective,'rejected');
  const trigger=formation(f);trigger.steps[0].rulesInput.plan.source.trigger={kind:'knowledgeAcquired',knowledgeRef:KNOWLEDGE};call(f,f.state,trigger,'rejected');
});

test('mixed Bundle retains committed public narrative while private formation alone has no action placeholder',()=>{
  const f=fixture('mixed'),input=formation(f),auth=`profile-context:${f.moduleProfile.moduleRef.profileId}`;
  const narrative={kind:'commitNarrativeDetail',rootActionId:input.rootActionId,actorCharacterId:ACTOR,plan:{schema:NARRATIVE_DETAIL_PLAN_SCHEMA,proposalRef:'proposal:narrative',contextHash:input.contextHash,sceneRef:SCENE,label:'风声',description:'微风吹过走廊。',audience:'sceneObservers',basisRefs:[SCENE],authorizationRefs:[auth],readSet:bindings(f.state,[ACTOR,SCENE,auth])}};
  input.steps.unshift({formId:'materialization.vnext-1',proposalRef:'proposal:narrative',ruling:'directSuccess',rulesInput:narrative,dependsOn:[],consumes:[],produces:[],outcomeBinding:'always'});
  const r=call(f,f.state,input),p=claims(f,r);assert.ok(p.renderableClaims.claims.some(c=>c.kind==='narrativeDetail'));
  assert.doesNotMatch(JSON.stringify(p),/PRIVATE_|npc-plan:/);replay(f,r.events,r.state);
});

test('shared source diagnostics identify exact fields, types, missing decisions, duplicate refs and closed timer scope',()=>{
  const cases=[{change:s=>{delete s.goal;},path:['goal'],code:'FIELD_MISSING'},
    {change:s=>s.durationMicros=2,path:['durationMicros'],code:'TYPE_MISMATCH'},
    {change:s=>s.resourceRefs=[3],path:['resourceRefs',0],code:'TYPE_MISMATCH'},
    {change:s=>s.factionRef=false,path:['factionRef'],code:'TYPE_MISMATCH'},
    {change:s=>s.durationMicros='0',path:['durationMicros'],code:'VALUE_INVALID'},
    {change:s=>s.premiseRefs=[NPC,NPC],path:['premiseRefs',1],code:'CONSTRAINT_CONFLICT'},
    {change:s=>s.trigger={kind:'future'},path:['trigger'],code:'CONSTRAINT_CONFLICT'}];
  for(const c of cases){const value=source();c.change(value);const diagnostics=[];assert.equal(npcActorPlanFormationSourceConform(value,diagnostics),false);assert.ok(diagnostics.some(d=>d.code===c.code&&JSON.stringify(d.path)===JSON.stringify(c.path)),JSON.stringify(diagnostics));}
});

test('continued legacy formation keeps known triggers and shares self premise and replay; direct bypass is rejected',()=>{
  const f=fixture('legacy',{knowledge:true}),root='root:legacy-plan',ids=npcActorPlanFormationIds(root,'proposal:legacy');
  const raw={kind:'formNpcActorPlan',proposalId:root,npcId:NPC,factionRef:null,planId:ids.planId,goal:'PRIVATE_LEGACY_GOAL',nextStep:'PRIVATE_LEGACY_NEXT',premiseRefs:[NPC,KNOWLEDGE].sort(),resourceRefs:[],activity:{activityId:ids.activityId,activityKind:'watch',intendedDurationMicros:'1'},due:null,trigger:{kind:'knowledgeAcquired',knowledgeRef:KNOWLEDGE},trace:{factRef:ids.traceFactRef,description:TEXT,visibilityPolicyRef:'visibility:scene-observers'},alternateTarget:{targetRef:SCENE,reason:'PRIVATE_ALTERNATE'}};
  call(f,f.state,raw,'rejected');const r=call(f,f.state,continueCompoundRoot(raw,root));replay(f,r.events,r.state);assert.deepEqual(claims(f,r,f.state,f.viewer,NPC).renderableClaims.claims,[]);
});
