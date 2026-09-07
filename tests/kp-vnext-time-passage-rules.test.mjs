import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { TIME_PASSAGE_PLAN_SCHEMA, isTimePassageDuration, timePassageStartReadRefs } from '../app/_runtime/lib/rules/v2/time-passage.ts';
import { dueActivityDescriptors, isSupersededTimePassageAdvance } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { createEventTransition, createScopeProof } from '../app/_runtime/lib/rules/v2/events.ts';
import { dueActorPlanChildRoot } from '../app/_runtime/lib/rules/v2/actor-plans.ts';
const NPC = 'npc:time-test', PLAN = 'plan:time-test', NPC_ACTIVITY = 'activity:npc-time';
const KP = { kind:'kp', capability:'internal:kp-spatial-evidence' };
function call(f,state,input,kind='committed') {
  const r=f.runtime.step(f.profiles,state,input); assert.equal(r.kind,kind,JSON.stringify(r)); return r;
}
function input(f,state, duration='60000000', actor=ACTOR, suffix='wait') {
  return { kind:'startTimePassage', rootActionId:`root:${suffix}`, actorCharacterId:actor, plan:{schema:TIME_PASSAGE_PLAN_SCHEMA,
    contextHash:canonicalSha256({suffix}), readSet:timePassageStartReadRefs(state,actor).map(ref=>({ref,revisionOrHash:authorityRevisionOrHash(state,ref)})),
    activityId:`activity:${suffix}`, intendedDurationMicros:duration, method:'PRIVATE_METHOD: stay here and watch without a promised observation.'} };
}
function start(f,duration='60000000', actor=ACTOR,suffix='wait') { const i=input(f,f.state,duration,actor,suffix); return {i,r:call(f,f.state,i)}; }
function due(state,id) { return dueActivityDescriptors(state).find(d=>d.activityId===id); }
function stage(f,state,id,kind='committed') {
  const d=due(state,id); assert.ok(d,`missing descriptor ${id}`);
  return call(f,state,{kind:d.timePassage?'advanceTimePassage':'completeActivity',proposalId:d.childRootActionId,activityId:id},kind);
}
function clock(state,actor=ACTOR) { return state.fictionTimelines[characterTimelineId(state,actor)].nowMicros; }
function npcFixture(name,at='2000000') {
  const f=createAuthoredProbeFixture(name,{npcCharacters:[{id:NPC,name:'Watcher'}],initialKnowledge:[{characterId:NPC,knowledgeRef:'knowledge:premise',content:'PRIVATE_PREMISE',kind:'sourceClaim',layer:'partial',visibility:'private',provenanceChain:['genesis:premise']}]});
  f.state.campaignRuntime.npcPlans[PLAN]={npcId:NPC,actorKind:'npc',actorRef:NPC,decisionNpcId:NPC,planId:PLAN,revision:'1',status:'scheduled',
    factionRef:null,goal:'PRIVATE_GOAL',premiseRefs:['knowledge:premise'],nextStep:'PRIVATE_FUTURE_STEP',resourceRefs:[],
    activity:{activityId:NPC_ACTIVITY,activityKind:'PRIVATE_ACTIVITY',intendedDurationMicros:'1'},due:{kind:'fictionTime',atFictionMicros:at},trigger:null,
    trace:{factRef:'fact:npc-time-trace',description:'A bell rings.',visibilityPolicyRef:'visibility:scene-observers'},alternateTarget:{targetRef:SCENE,reason:'PRIVATE_TARGET'}};
  f.state.campaignRuntime.activities[NPC_ACTIVITY]={activityId:NPC_ACTIVITY,characterId:NPC,activityKind:'PRIVATE_ACTIVITY',status:'active',startedAtFictionMicros:'0',intendedDurationMicros:'1',completion:{kind:'actorPlan',planId:PLAN}};
  return f;
}
function resolvePlan(f,state,decision='execute',extra={}) {
  return call(f,state,{kind:'resolveDueActorPlan',proposalId:dueActorPlanChildRoot(state.campaignRuntime.npcPlans[PLAN]),affectedCharacterId:NPC,
    causedByRootActionId:'root:wait',planId:PLAN,decision,mechanicalProposal:null,...extra});
}
function view(f,state,actor=ACTOR) {
  const r=f.runtime.project(f.profiles,state,actor===ACTOR?f.viewer:{...f.viewer,principalId:'principal:probe-target',seatId:'seat:probe-target',characterId:OTHER});
  assert.equal(r.kind,'projected',JSON.stringify(r));return r;
}

test('wait and passive watch use one Activity with actual elapsed time, no invented knowledge, and replay',()=>{
  for (const duration of ['12000000','60000000']) {
    const f=createAuthoredProbeFixture(`passive-${duration}`),{i,r}=start(f,duration);
    assert.deepEqual(r.events.map(e=>e.eventType),['ActivityStarted']);assert.equal(clock(r.state),'0');
    const advanced=stage(f,r.state,i.plan.activityId);assert.equal(clock(advanced.state),duration);
    assert.deepEqual(advanced.events.map(e=>e.eventType),['FictionTimeAdvanced']);
    assert.deepEqual(advanced.state.receipts[advanced.receipt.rootActionId].subjectCharacterIds,[ACTOR]);
    const done=stage(f,advanced.state,i.plan.activityId);assert.equal(done.state.campaignRuntime.activities[i.plan.activityId].endedAtFictionMicros,duration);
    assert.deepEqual(done.state.knowledge,f.state.knowledge);assert.deepEqual(done.state.entities,f.state.entities);
    const replay=f.runtime.replay(f.genesis,[...r.events,...advanced.events,...done.events]);assert.equal(replay.kind,'replayed',JSON.stringify(replay));assert.deepEqual(replay.state,done.state);
    assert.doesNotMatch(JSON.stringify(view(f,done.state)),/PRIVATE_METHOD|sourceTimelineId|sourcePositionHash/);
    assert.deepEqual(view(f,done.state,OTHER).activities,[]);
    assert.equal(view(f,done.state).activities[0].kind,'timePassage');
    call(f,done.state,{kind:'advanceTimePassage',proposalId:advanced.receipt.rootActionId,activityId:i.plan.activityId},'rejected');
    assert.equal(clock(done.state),duration);
  }
});

test('the next real NPC deadline precedes the remainder; defer/revise timing is selected from the shared plan predicate',()=>{
  for(const decision of ['defer','revise']) {
    const f=npcFixture(`deadline-${decision}`),{i,r}=start(f),first=stage(f,r.state,i.plan.activityId);
    assert.equal(clock(first.state),'2000000');assert.equal(due(first.state,i.plan.activityId),undefined);
    assert.ok(due(first.state,NPC_ACTIVITY));assert.equal(first.state.canonicalFacts['fact:npc-time-trace'],undefined);
    const stale=due(r.state,i.plan.activityId);call(f,first.state,{kind:'advanceTimePassage',proposalId:'root:skip-due',activityId:i.plan.activityId},'rejected');
    const extra=decision==='defer'?{reason:'PRIVATE_REASON',deferUntilFictionMicros:'5000000'}:{revision:{reason:'PRIVATE_REASON',premiseRefs:['knowledge:premise'],nextStep:'PRIVATE_NEXT',resourceRefs:[],due:{kind:'fictionTime',atFictionMicros:'5000000'},trigger:null,trace:f.state.campaignRuntime.npcPlans[PLAN].trace,alternateTarget:f.state.campaignRuntime.npcPlans[PLAN].alternateTarget}};
    const revised=resolvePlan(f,first.state,decision,extra);
    assert.equal(due(revised.state,i.plan.activityId).timePassage.toFictionMicros,'5000000');
    const second=stage(f,revised.state,i.plan.activityId);assert.equal(clock(second.state),'5000000');
    const acted=resolvePlan(f,second.state);assert.ok(acted.state.canonicalFacts['fact:npc-time-trace']);
    const remaining=stage(f,acted.state,i.plan.activityId);assert.equal(clock(remaining.state),'60000000');
    assert.equal(stage(f,remaining.state,i.plan.activityId).state.campaignRuntime.activities[i.plan.activityId].status,'completed');
    assert.equal(isSupersededTimePassageAdvance(first.state,stale),true);
    const kp=f.runtime.project(f.profiles,first.state,KP,{dueActivities:true});assert.equal(kp.kind,'projected');
    assert.doesNotMatch(JSON.stringify(view(f,first.state)),/PRIVATE_GOAL|PRIVATE_FUTURE|PRIVATE_TARGET/);
  }
});

test('world interruptions preserve the actual partial time and original timeline, including former-owner lifecycle access',()=>{
  for(const reason of ['actorUnavailable','actorIncapacitated','encounterActive','locationChanged']) {
    const f=npcFixture(`stop-${reason}`),{i,r}=start(f),first=stage(f,r.state,i.plan.activityId);
    // These are authoritative post-due states; the time stage must re-read them.
    const state=structuredClone(first.state),original=characterTimelineId(state,ACTOR);
    if(reason==='actorUnavailable') { state.entities[ACTOR].tenureStatus='dead';state.entities[ACTOR].lastControllerSeatId=f.viewer.seatId;delete state.characterControls[ACTOR]; }
    if(reason==='actorIncapacitated') state.combatRuntime.entities[ACTOR].conditions.incapacitated=true;
    if(reason==='encounterActive') state.combatRuntime.encounters['encounter:stop']={encounterId:'encounter:stop',status:'starting',round:0,activeEntityId:null,participantEntityIds:[ACTOR],sceneId:SCENE};
    if(reason==='locationChanged') { state.scenes['scene:elsewhere']={id:'scene:elsewhere',name:'Elsewhere'};state.entities[ACTOR].sceneId='scene:elsewhere';state.combatRuntime.entities[ACTOR].sceneId='scene:elsewhere';state.combatRuntime.scenes['scene:elsewhere']={...structuredClone(state.combatRuntime.scenes[SCENE]),sceneId:'scene:elsewhere'};state.fictionTimelines['timeline:elsewhere']={...structuredClone(state.fictionTimelines[original]),nowMicros:'9000000'};state.multiplayerRuntime.characterTimelineIds[ACTOR]='timeline:elsewhere'; }
    if(reason==='locationChanged') {
      const beforeStop=view(f,state);assert.equal(beforeStop.fictionTime.nowMicros,'9000000');
      assert.equal(beforeStop.activities[0].status,'active');assert.equal(beforeStop.activities[0].progressFictionMicros,'2000000');
      assert.deepEqual(view(f,state,OTHER).activities,[]);
      assert.doesNotMatch(JSON.stringify(beforeStop.activities),/sourceTimelineId|sourcePositionHash|PRIVATE_METHOD/);
    }
    const stop=stage(f,state,i.plan.activityId);assert.equal(stop.events[0].eventType,'ActivityInterrupted');assert.equal(stop.events[0].fictionTimelineId,original);
    assert.equal(stop.state.campaignRuntime.activities[i.plan.activityId].endedAtFictionMicros,'2000000');
    assert.equal(stop.state.fictionTimelines[original].nowMicros,'2000000');
    const projection=reason==='actorUnavailable'?f.runtime.project(f.profiles,stop.state,{...f.viewer,purpose:'lifecycle'}):view(f,stop.state);
    assert.equal(projection.kind,'projected');assert.equal(projection.activities[0].interruptionReason,reason);assert.doesNotMatch(JSON.stringify(projection),/PRIVATE_METHOD|PRIVATE_GOAL/);
  }
});

test('malformed ordinary and long-spell deadlines stay active as technical pending; they never become fictional interruptions',()=>{
  for(const type of ['longSpellcasting','invalidSchedule']) {
    const f=createAuthoredProbeFixture(`blocked-${type}`);
    f.state.campaignRuntime.activities['activity:other']={activityId:'activity:other',characterId:OTHER,activityKind:type==='longSpellcasting'?type:'work',status:'active',startedAtFictionMicros:'0',intendedDurationMicros:type==='longSpellcasting'?'2000000':'bad',completion:{}};
    const {i,r}=start(f);let state=r.state;
    // The long-spell family is executable, but this incomplete frozen
    // completion must be diagnosed before advancing toward its deadline.
    assert.equal(due(state,i.plan.activityId).timePassage.phase,'blocked');
    const blocked=stage(f,state,i.plan.activityId,'rejected');assert.equal(blocked.rejection.code,'invalidWorldState');
    assert.equal(state.campaignRuntime.activities[i.plan.activityId].status,'active');assert.equal(state.campaignRuntime.activities[i.plan.activityId].endedAtFictionMicros,undefined);
    assert.equal(view(f,state).activities[0].processingState,'blocked');assert.equal(view(f,state).activities[0].interruptionReason,undefined);
  }
});

test('time passage leaves a party atomically, respects same-timeline pending randomness, and leaves other timelines untouched',()=>{
  const f=createAuthoredProbeFixture('timeline-and-party');
  f.state.multiplayerRuntime.partyGroups['party:existing']={groupId:'party:existing',leaderCharacterId:ACTOR,memberCharacterIds:[ACTOR,OTHER],status:'active'};
  const original=characterTimelineId(f.state,ACTOR);f.state.fictionTimelines['timeline:remote']={...structuredClone(f.state.fictionTimelines[original]),nowMicros:'31'};
  const {i,r}=start(f);assert.ok(r.events.some(e=>e.eventType==='PartyMemberLeft'));assert.equal(characterTimelineId(r.state,ACTOR),original);
  const pending=structuredClone(r.state);pending.pendingInputs['pending:test']={pendingInputId:'pending:test',kind:'groupRestConsent',rootActionId:'root:pending',controllerCharacterId:OTHER,question:'Wait for answer',openedByEventId:'event:test',visibility:'private'};
  assert.equal(due(pending,i.plan.activityId),undefined);call(f,pending,{kind:'advanceTimePassage',proposalId:due(r.state,i.plan.activityId).childRootActionId,activityId:i.plan.activityId},'rejected');
  const advanced=stage(f,r.state,i.plan.activityId);assert.equal(advanced.state.fictionTimelines['timeline:remote'].nowMicros,'31');
  assert.equal(clock(advanced.state,OTHER),'60000000');
});

test('frozen start, canonical stage root, replay deadline and stale replacement reject tampering',()=>{
  const f=createAuthoredProbeFixture('tamper'),i=input(f,f.state);
  for(const duration of ['0','01','-1','9007199254740992','1.5']) {assert.equal(isTimePassageDuration(duration),false);call(f,f.state,{...i,plan:{...i.plan,intendedDurationMicros:duration}},'rejected');}
  for(const plan of [{...i.plan,readSet:i.plan.readSet.slice(1)},{...i.plan,readSet:i.plan.readSet.map(b=>({...b,revisionOrHash:canonicalSha256('changed')}))}]) call(f,f.state,{...i,plan},'rejected');
  const started=call(f,f.state,i),d=due(started.state,i.plan.activityId);
  call(f,started.state,{kind:'advanceTimePassage',proposalId:d.childRootActionId,activityId:i.plan.activityId,toFictionMicros:'999'},'rejected');
  assert.throws(()=>createEventTransition(started.state,f.profiles,{rootActionId:d.childRootActionId,eventType:'FictionTimeAdvanced',payload:{reason:'timePassage',activityId:i.plan.activityId,durationMicros:'60000001'},scopeProof:createScopeProof(started.state,[],[],[]),visibilityPolicyId:`visibility:knowledge-holder:${ACTOR}`,secrecy:'private'}),/deadline/);
  assert.equal(isSupersededTimePassageAdvance(started.state,d),false);
  const incapacitated=structuredClone(started.state);incapacitated.combatRuntime.entities[ACTOR].conditions.incapacitated=true;
  assert.equal(isSupersededTimePassageAdvance(incapacitated,d),true);assert.equal(due(incapacitated,i.plan.activityId).timePassage.phase,'interrupt');
  assert.equal(isSupersededTimePassageAdvance(incapacitated,{...d,activityHash:canonicalSha256('forged')}),false);
});

test('a timed effect is settled at its own deadline before the remainder; another timeline is not processed',()=>{
  const f=createAuthoredProbeFixture('effect-deadline'),original=characterTimelineId(f.state,ACTOR);
  f.state.fictionTimelines['timeline:remote']={...structuredClone(f.state.fictionTimelines[original]),nowMicros:'3000000'};
  f.state.multiplayerRuntime.characterTimelineIds[OTHER]='timeline:remote';
  for(const [id,target,at] of [['effect:local',ACTOR,'2000000'],['effect:remote',OTHER,'1000000']]) {
    f.state.combatRuntime.effects[id]={schema:'zhuwei.condition-effect/v1',effectId:id,kind:'condition',sourceRef:target,sourceDefinitionRef:'definition:effect',targetEntityId:target,
      condition:'deafened',level:null,duration:{kind:'timed',durationMicros:at},startedAtFictionMicros:'0',pausedMicros:'0',suspension:null,
      expiresAt:{kind:'fictionTime',entityId:target,dueMicros:at},visibilityPolicyId:'visibility:scene-observers',visibilityFactId:null};
  }
  const {i,r}=start(f),first=stage(f,r.state,i.plan.activityId);
  assert.equal(clock(first.state),'2000000');assert.deepEqual(first.events.map(e=>e.eventType),['FictionTimeAdvanced','EffectEnded']);
  assert.equal(first.events[1].fictionInstantMicros,'2000000');assert.equal(first.state.combatRuntime.effects['effect:local'],undefined);
  assert.deepEqual(first.state.combatRuntime.effects['effect:remote'],f.state.combatRuntime.effects['effect:remote']);
  assert.equal(stage(f,first.state,i.plan.activityId).state.fictionTimelines[original].nowMicros,'60000000');
});

test('simultaneous passive Activities share the real clock and drain due completions before another advance',()=>{
  const f=createAuthoredProbeFixture('two-waits'),{i,r}=start(f,'2000000',ACTOR,'a');
  const otherInput=input(f,r.state,'4000000',OTHER,'b'),other=call(f,r.state,otherInput);
  const advance=stage(f,other.state,i.plan.activityId);assert.equal(clock(advance.state),'2000000');
  assert.equal(due(advance.state,otherInput.plan.activityId),undefined);
  const completed=stage(f,advance.state,i.plan.activityId);
  const later=stage(f,completed.state,otherInput.plan.activityId);assert.equal(clock(later.state),'4000000');
  assert.equal(stage(f,later.state,otherInput.plan.activityId).state.campaignRuntime.activities[otherInput.plan.activityId].status,'completed');
});
