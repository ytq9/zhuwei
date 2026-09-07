import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as OTHER, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { compileAbilityDefinition, registeredAbilityRecord } from '../app/_runtime/lib/rules/profiles/ability-compiler.ts';
import { buildPlayerCombatEntity, planPlayerAbilityCatalog, synchronizePlayerCombatEntity } from '../app/_runtime/lib/rules/v2/character-abilities.ts';
import { dueActivityDescriptors, isSupersededLongSpellcastingAdvance } from '../app/_runtime/lib/rules/v2/due-activities.ts';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { committedRangeUsesFrozenRenderableClaims, frozenRenderableClaimsConform } from '../app/_runtime/lib/rules/v2/claims.ts';

function fixture(id, configure = () => {}) {
  const f = createAuthoredProbeFixture(`catalog-casting:${id}`), state = structuredClone(f.state), actor = state.entities[ACTOR];
  Object.assign(actor, { classId:'cleric',level:3,preparedSpellIds:['silence'],cantripIds:[],
    abilityScores:{str:10,dex:10,con:10,int:10,wis:14,cha:10},resources:{slot2:2},resourceMaximums:{slot2:2} });
  // Compile the real SRD catalog spell through the production registration path.
  const plan = planPlayerAbilityCatalog({character:actor,itemSystem:state.campaignRuntime.itemSystem,catalog:state.combatRuntime.definitions});
  assert.equal(plan.error,undefined,JSON.stringify(plan));
  for (const artifact of plan.registrations) state.combatRuntime.definitions[artifact.definition.definitionId] = registeredAbilityRecord(artifact);
  state.combatRuntime.entities[ACTOR] = synchronizePlayerCombatEntity(state.combatRuntime.entities[ACTOR],
    buildPlayerCombatEntity(f.profiles,actor,plan.compiled,'principal:probe-actor',undefined,state.campaignRuntime.itemSystem));
  delete state.combatRuntime.entities[ACTOR].turn;
  const abilityRef=plan.compiled.abilityRefs.find(ref=>plan.compiled.definitions[ref].sourceSpellId==='silence');assert.ok(abilityRef);
  const silenceRef=abilityRef;
  const executableRef=`ability:fixture:sustained:${id}`;
  const executable=compileAbilityDefinition({definitionId:executableRef,revision:'1',rulesBasis:'srd5.1-2014',
    activation:{kind:'actionSpell',spellLevel:'2',castingTimeMicros:'12000000',ritual:true},
    target:{kind:'creature',count:'1',rangeInches:'600'},costs:[{kind:'spellSlot',level:'2',amount:'1'}],
    effect:{kind:'grantEffect',condition:'blinded',duration:{kind:'timed',durationMicros:'60000000'}}});
  assert.equal(executable.ok,true,JSON.stringify(executable));state.combatRuntime.definitions[executableRef]=registeredAbilityRecord(executable.artifact);
  state.combatRuntime.entities[ACTOR].abilityRefs.push(executableRef);
  configure(state);
  const body={...state};delete body.eventHeadHash;delete body.lastEventId;const initialStateHash=canonicalSha256(body);state.eventHeadHash=initialStateHash;
  const genesis={...f.genesis,initialState:state,initialStateHash};delete genesis.genesisHash;genesis.genesisHash=canonicalSha256(genesis);
  const r=f.runtime.replay(genesis,[]);assert.equal(r.kind,'replayed',JSON.stringify(r));
  return {...f,genesis,state:r.state,abilityRef:executableRef,silenceRef,events:[]};
}
function apply(f,input,expected='committed') {
  const prior=f.state,r=f.runtime.step(f.profiles,f.state,input);assert.equal(r.kind,expected,JSON.stringify(r));
  if(r.events?.length){f.events.push(...r.events);const replay=f.runtime.replay(f.genesis,f.events);assert.equal(replay.kind,'replayed',JSON.stringify(replay));assert.deepEqual(replay.state,r.state);f.state=replay.state;}
  return {prior,r};
}
function begin(f) { return apply(f,{kind:'invokeAbility',rootActionId:`${f.rootActionId}:begin`,sourceEntityId:ACTOR,abilityRef:f.abilityRef,
  parameters:{ritual:true,targetEntityId:OTHER}}); }
function clock(f){return f.state.fictionTimelines[characterTimelineId(f.state,ACTOR)].nowMicros;}
function due(f,id){return dueActivityDescriptors(f.state).find(d=>d.activityId===id);}
function stage(f,id,expected='committed') {const d=due(f,id);assert.ok(d);return apply(f,{kind:d.longSpellcasting?.phase==='complete'?'completeLongSpellcasting':d.longSpellcasting?'advanceLongSpellcasting':'completeActivity',proposalId:d.childRootActionId,activityId:id},expected);}
function claims(f,transition,viewer=f.viewer) {
  assert.equal(committedRangeUsesFrozenRenderableClaims(transition.r.events),true);
  const p=f.runtime.project(f.profiles,transition.r.state,viewer,{channel:'realtime',committedRange:{receiptId:transition.r.receipt.receiptId,actorCharacterId:ACTOR,priorState:transition.prior,events:transition.r.events}});
  assert.equal(p.kind,'projected',JSON.stringify(p));assert.ok(p.renderableClaims);assert.equal(frozenRenderableClaimsConform(p.renderableClaims),true);return p.renderableClaims;
}

test('registered executable ritual advances its own Activity and emits no premature spell-effect Claims',()=>{
  const f=fixture('ritual'),started=begin(f),id=started.r.mechanicalResult.activityId;
  assert.equal(f.state.campaignRuntime.activities[id].intendedDurationMicros,'612000000');assert.equal(clock(f),'0');
  const first=claims(f,started);assert.ok(first.claims.some(c=>c.outcomeCode==='longSpellcastingStarted'));
  assert.equal(first.claims.some(c=>c.kind==='abilityEffectApplied'),false);assert.doesNotMatch(JSON.stringify(first),/区域无声|耳聋|含言语成分/);
  const advanced=stage(f,id);assert.equal(clock(f),'612000000');assert.deepEqual(claims(f,advanced).claims,[]);
  assert.equal(Object.values(f.state.combatRuntime.effects).length,0);assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:2'].current,'2');
  const completed=stage(f,id);assert.equal(f.state.campaignRuntime.activities[id].status,'completed');
  assert.ok(completed.r.events.some(e=>e.eventType==='SpellResolved'));
  assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:2'].current,'2');
  assert.ok(Object.values(f.state.combatRuntime.effects).some(effect=>effect.kind==='condition' && effect.condition==='blinded'));
  assert.ok(claims(f,completed).claims.some(c=>c.outcomeCode==='SpellResolved'));
  assert.equal(due(f,id),undefined);
});

test('sustained casting shares real deadlines and cannot skip pending work or mutate a frozen segment',()=>{
  const f=fixture('deadline',state=>{
    state.canonicalFacts['fact:casting-deadline']={id:'fact:casting-deadline',kind:'feature',subjectRefs:[],value:'PRIVATE_SOURCE',visibilityPolicyId:'visibility:room-authority-only',source:'moduleAnchor',causalParentIds:[],branchId:state.activeBranchId,validFromEventSeq:'0'};
    state.campaignRuntime.activities['activity:other']={activityId:'activity:other',characterId:OTHER,activityKind:'inspection',status:'active',startedAtFictionMicros:'0',intendedDurationMicros:'2000000',completion:{method:'inspect',primaryFactRef:'fact:casting-deadline',sourceSceneId:SCENE,failure:[],success:[{kind:'acquireKnowledge',definitionRef:'fact:casting-deadline',knowledgeRef:'knowledge:due-secret',value:'PRIVATE_KNOWLEDGE'}]}};
  });
  const started=begin(f),id=started.r.mechanicalResult.activityId,first=due(f,id);assert.equal(first.longSpellcasting.toFictionMicros,'2000000');
  stage(f,id);assert.equal(clock(f),'2000000');assert.equal(due(f,id),undefined);assert.ok(due(f,'activity:other'));
  assert.equal(isSupersededLongSpellcastingAdvance(f.state,first),true);
  const rejected=apply(f,{kind:'advanceLongSpellcasting',proposalId:first.childRootActionId,activityId:id},'rejected');assert.deepEqual(rejected.r.events,[]);
  stage(f,'activity:other');assert.equal(f.state.knowledge[OTHER]['knowledge:due-secret'].content,'PRIVATE_KNOWLEDGE');
  assert.equal(due(f,id).longSpellcasting.toFictionMicros,'612000000');stage(f,id);stage(f,id);
  assert.equal(clock(f),'612000000');assert.equal(f.state.campaignRuntime.activities[id].status,'completed');
});

test('combat time is not advanced by background casting and cancellation invalidates queued work',()=>{
  const f=fixture('combat-stop'),started=begin(f),id=started.r.mechanicalResult.activityId,queued=due(f,id);
  // This represents the authoritative encounter boundary that preempts the next time segment.
  const changed=structuredClone(f.state);changed.combatRuntime.encounters['encounter:casting']={encounterId:'encounter:casting',status:'active',round:1,activeEntityId:ACTOR,participantEntityIds:[ACTOR,OTHER],sceneId:SCENE};
  assert.equal(dueActivityDescriptors(changed).some(d=>d.activityId===id),false);assert.equal(isSupersededLongSpellcastingAdvance(changed,queued),true);
  const blocked=f.runtime.step(f.profiles,changed,{kind:'advanceLongSpellcasting',proposalId:queued.childRootActionId,activityId:id});assert.equal(blocked.kind,'rejected');assert.deepEqual(blocked.events,[]);assert.equal(clock(f),'0');
  const cancelled=apply(f,{kind:'interruptActivity',proposalId:`${f.rootActionId}:cancel`,activityId:id,cause:{kind:'voluntary'}});
  assert.equal(due(f,id),undefined);assert.equal(f.state.combatRuntime.entities[ACTOR].resources['spellSlot:2'].current,'2');
  assert.equal(Object.values(f.state.combatRuntime.effects).length,0);assert.ok(claims(f,cancelled).claims.some(c=>c.outcomeCode==='longSpellcastingInterrupted'));
});

test('the actual silence catalog preserves ritual metadata but unsupported descriptive area effects reject before Activity creation',()=>{
  const f=fixture('catalog-gap');
  const r=f.runtime.step(f.profiles,f.state,{kind:'invokeAbility',rootActionId:`${f.rootActionId}:catalog`,sourceEntityId:ACTOR,abilityRef:f.silenceRef,
    parameters:{ritual:true,areaOrigin:{x:'300',y:'300',elevation:'0'}}});
  assert.equal(r.kind,'rejected');assert.equal(r.rejection.code,'unsupportedOperation');assert.deepEqual(r.events,[]);
  assert.equal(Object.keys(f.state.campaignRuntime.activities).length,0);assert.equal(clock(f),'0');
});

test('simultaneous long spell completions retain a canonical winner and malformed schedules stay bounded',()=>{
  const f=fixture('same-time'),started=begin(f),id=started.r.mechanicalResult.activityId;
  const state=structuredClone(f.state),otherId=`${id}:second`,copy=structuredClone(state.campaignRuntime.activities[id]);
  Object.assign(copy,{activityId:otherId,characterId:OTHER});Object.assign(copy.completion,{activityId:otherId,sourceEntityId:OTHER});
  state.campaignRuntime.activities[otherId]=copy;state.combatRuntime.entities[OTHER].concentration={...state.combatRuntime.entities[ACTOR].concentration,activityId:otherId};
  state.fictionTimelines[characterTimelineId(state,ACTOR)].nowMicros='612000000';
  assert.deepEqual(dueActivityDescriptors(state).filter(d=>d.longSpellcasting?.phase==='complete').map(d=>d.activityId),[id]);
  state.campaignRuntime.activities[id].status='completed';state.combatRuntime.entities[ACTOR].concentration=null;
  assert.deepEqual(dueActivityDescriptors(state).filter(d=>d.longSpellcasting?.phase==='complete').map(d=>d.activityId),[otherId]);
  const malformed=structuredClone(f.state);malformed.campaignRuntime.activities[id].completion.parameters=null;
  const first=dueActivityDescriptors(malformed).find(d=>d.activityId===id);assert.equal(first.longSpellcasting.phase,'blocked');
  assert.deepEqual(dueActivityDescriptors(malformed).find(d=>d.activityId===id),first);
  const rejected=f.runtime.step(f.profiles,malformed,{kind:'advanceLongSpellcasting',proposalId:first.childRootActionId,activityId:id});
  assert.equal(rejected.kind,'rejected');assert.deepEqual(rejected.events,[]);assert.equal(malformed.campaignRuntime.activities[id].status,'active');
});


test('an already pending combat root prevents due completion without moving the clock or creating another spell frame',()=>{
  const f=fixture('pending-combat'),started=begin(f),id=started.r.mechanicalResult.activityId;
  const state=structuredClone(f.state),timelineId=characterTimelineId(state,ACTOR);
  state.fictionTimelines[timelineId].nowMicros='612000000';
  state.combatRuntime.encounters['encounter:pending']={encounterId:'encounter:pending',status:'active',round:103,activeEntityId:OTHER,participantEntityIds:[ACTOR,OTHER],sceneId:SCENE};
  state.pendingInputs['pending:existing']={pendingInputId:'pending:existing',kind:'combatChoice',rootActionId:'root:existing',controllerCharacterId:OTHER,question:'Existing frozen choice',openedByEventId:'event:existing',visibility:'private'};
  assert.equal(dueActivityDescriptors(state).some(d=>d.activityId===id),false);
  const result=f.runtime.step(f.profiles,state,{kind:'completeLongSpellcasting',proposalId:`long-spell-due:${id}:612000000`,activityId:id});
  assert.equal(result.kind,'rejected');assert.equal(result.rejection.code,'pendingInputUnresolved');assert.deepEqual(result.events,[]);
  assert.equal(state.campaignRuntime.activities[id].status,'active');assert.equal(state.combatRuntime.entities[ACTOR].resources['spellSlot:2'].current,'2');
});
