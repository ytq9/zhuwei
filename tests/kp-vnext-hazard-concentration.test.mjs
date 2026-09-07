import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR, PROBE_TARGET, PROBE_SOURCE, PROBE_ZONE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { hazardBundle } from './fixtures/vnext-authored-bundles.mjs';

for (const saveSucceeds of [false,true]) test(`hazard reserves concentration before damage and ${saveSucceeds?'skips it when damage is negated':'uses actual damage for its DC'}`,()=>{
  const fixture=createAuthoredProbeFixture(`concentration-${saveSucceeds}`);
  const state=structuredClone(fixture.state);
  state.entities[PROBE_TARGET].hitPoints={current:60,maximum:60};
  state.combatRuntime.entities[PROBE_TARGET].hitPoints={current:'60',maximum:'60',temporary:'0'};
  state.combatRuntime.entities[PROBE_TARGET].concentration={abilityRef:'spell:fixture-focus'};
  const {eventHeadHash,lastEventId,...domain}=state;
  const initialStateHash=canonicalSha256(domain);state.eventHeadHash=initialStateHash;
  const unsigned={...fixture.genesis,initialState:state,initialStateHash};delete unsigned.genesisHash;
  const genesis={...unsigned,genesisHash:canonicalSha256(unsigned)};
  const replayed=fixture.runtime.replay(genesis,[]);assert.equal(replayed.kind,'replayed');
  const context=freezeAuthoredProbeContext(fixture,replayed.state,{
    rootActionId:fixture.rootActionId,focusRefs:[PROBE_SOURCE,PROBE_ZONE,PROBE_TARGET],
  }).context;
  const value=hazardBundle();
  Object.assign(value.proposals[0].source.content,{
    damage:[{type:'fire',formula:'4d6',sharedAcrossTargets:true}],effects:[],
    save:{ability:'dex',dc:13,halfOnSuccess:false},
  });
  const lowered=lowerVNext2ProposalBundle({value,rootActionId:fixture.rootActionId,actorCharacterId:PROBE_ACTOR,
    requiredContext:context,state:replayed.state});assert.equal(lowered.kind,'accepted',JSON.stringify(lowered));
  const waiting=fixture.runtime.step(fixture.profiles,replayed.state,lowered.command.rulesInput);
  assert.equal(waiting.kind,'awaitingRandomness',JSON.stringify(waiting));
  const specs=waiting.randomnessRequest.hazardRolls;
  assert.equal(specs.filter(s=>s.purposeKey.includes(':concentration:')).length,1);
  const rolls=specs.flatMap(spec=>spec.dice.flatMap(die=>Array(Number(die.count)).fill(
    spec.purposeKey.includes(':concentration:')?1:spec.purposeKey.includes(':save:')?(saveSucceeds?20:1):6)));
  const done=fixture.runtime.step(fixture.profiles,waiting.state,{kind:'fulfillAuthoritativeRandomness',continuation:waiting.continuation,rolls});
  assert.equal(done.kind,'committed',JSON.stringify(done));
  const tests=done.events.filter(e=>e.eventType==='ConcentrationTested');
  assert.equal(tests.length,saveSucceeds?0:1);
  if(!saveSucceeds)assert.equal(tests[0].payload.dc,12);
  assert.equal(done.events.some(e=>e.eventType==='ConcentrationEnded'),!saveSucceeds);
  assert.equal(done.events.some(e=>e.eventType==='RandomnessRequested'),false);
  const restored=fixture.runtime.replay(genesis,[...waiting.events,...done.events]);
  assert.equal(restored.kind,'replayed',JSON.stringify(restored));assert.deepEqual(restored.state,done.state);
});
