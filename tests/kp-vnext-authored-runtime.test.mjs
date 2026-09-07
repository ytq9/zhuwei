import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthoredProbeFixture,PROBE_ACTOR as ACTOR,PROBE_TARGET as TARGET,PROBE_SCENE as SCENE,PROBE_SOURCE as SOURCE,PROBE_ZONE as ZONE} from '../tools/lib/vnext-authored-probe-fixture.mjs';
import {lowerVNext2ProposalBundle} from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import {VNEXT2_PROPOSAL_BUNDLE_SCHEMA} from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { itemBundle, hazardBundle } from './fixtures/vnext-authored-bundles.mjs';
function begin(name,value){const f=createAuthoredProbeFixture(name);const lowered=lowerVNext2ProposalBundle({value,rootActionId:f.rootActionId,actorCharacterId:ACTOR,requiredContext:f.requiredContext,state:f.state});assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));const r=f.runtime.step(f.profiles,f.state,lowered.command.rulesInput);return {f,r,input:lowered.command.rulesInput};}
function settle(f,r,face=2){assert.equal(r.kind,'awaitingRandomness',JSON.stringify(r));assert.equal(r.events.length,1,'no tentative authored effects published');const done=f.runtime.step(f.profiles,r.state,{kind:'fulfillAuthoritativeRandomness',continuation:r.continuation,rolls:r.randomnessRequest.dice.flatMap(d=>Array(Number(d.count)).fill(Math.min(face,Number(d.sides))))});assert.equal(done.kind,'committed',JSON.stringify(done));const replay=f.runtime.replay(f.genesis,[...r.events,...done.events]);assert.equal(replay.kind,'replayed',JSON.stringify(replay));assert.deepEqual(replay.state,done.state);return done;}
test('one atomic authored hazard freezes mixed dice before publication and replays condition plus damage',()=>{const {f,r}=begin('hazard',hazardBundle());const done=settle(f,r);assert.equal(done.state.entities[TARGET].hitPoints.current,15);assert.ok(Object.values(done.state.combatRuntime.effects).some(e=>e.condition==='blinded'));});
test('one atomic Item definition, instance, acquire and genuine Ability use share one root and consume once',()=>{const {f,r}=begin('item',itemBundle());const done=settle(f,r);assert.equal(done.state.entities[ACTOR].hitPoints.current,16);assert.ok(Object.values(done.state.campaignRuntime.itemSystem.entries).some(e=>e.holderRef===ACTOR&&e.quantity===1));assert.equal(done.events.filter(e=>e.eventType==='ItemUsed').length,1);const duplicate=f.runtime.step(f.profiles,done.state,{kind:'fulfillAuthoritativeRandomness',continuation:r.continuation,rolls:[2,2]});assert.equal(duplicate.kind,'rejected');});
test('invalid later inventory step rejects the entire proposed creation before requesting dice',()=>{const value=itemBundle();value.proposals[3].operation.quantity=3;const {r}=begin('item-invalid',value);assert.equal(r.kind,'rejected');assert.deepEqual(r.events,[]);});
test('two legal Item uses in one Bundle retain distinct Activities and frozen dice',()=>{
 const value=itemBundle();value.proposals.push(structuredClone(value.proposals[4]));
 const {f,r}=begin('item-two-uses',value),done=settle(f,r);
 assert.equal(done.events.filter(e=>e.eventType==='ItemUsed').length,2);
 const activities=done.events.filter(e=>e.eventType==='ActivityStarted').map(e=>e.payload.activityId);
 assert.equal(activities.length,2);assert.equal(new Set(activities).size,2);
 assert.equal(done.state.entities[ACTOR].hitPoints.current,20);
 assert.equal(r.randomnessRequest.dice.reduce((n,d)=>n+Number(d.count),0),4);
});

test('authored exhaustion clamps the authoritative maximum once and records condition death through replay',()=>{
 for(const level of [4,6]) {
  const value=hazardBundle();
  value.proposals[0].source.content.effects=[{kind:'grantEffect',condition:'exhaustion',level,duration:{kind:'untilEnded'}}];
  const {f,r}=begin(`exhaustion-${level}`,value),done=settle(f,r);
  assert.equal(done.state.entities[TARGET].hitPoints.maximum,10);
  assert.equal(done.state.entities[TARGET].hitPoints.current,level===6?0:10);
  assert.equal(done.events.filter(e=>e.eventType==='ConditionStateSynchronized').length,1);
  assert.equal(done.events.filter(e=>e.eventType==='CreatureDied').length,level===6?1:0);
 }
});

test('authored areas resolve geometry for every creature rather than filtering to a hostile target list',()=>{
 const value=hazardBundle();
 Object.assign(value.proposals[0].source.content,{target:{kind:'area',rangeInches:'120',shape:{kind:'sphere',radiusInches:'120',propagation:'straight'}},save:null,damage:[{formula:'1d6',type:'fire',sharedAcrossTargets:true}],effects:[]});
 value.proposals[2].branches.success.effects[0].damage.area={origin:{x:'150',y:'100',elevation:'0'}};
 const {f,r}=begin('area',value),done=settle(f,r);
 assert.equal(done.state.entities[ACTOR].hitPoints.current,8);
 assert.equal(done.state.entities[TARGET].hitPoints.current,18);
 const outOfRange=structuredClone(value);
 outOfRange.proposals[2].branches.success.effects[0].damage.area.origin.x='500';
 assert.equal(begin('area-out-of-range',outOfRange).r.kind,'rejected');
});

test('a frozen hazard cannot be rebound to a different trigger even in the same scene',()=>{
 const value=hazardBundle();
 value.proposals[1].source.content.trigger.ref=ZONE;
 assert.equal(begin('unrelated-trigger',value).r.kind,'rejected');
});
