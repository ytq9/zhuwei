import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE, PROBE_ZONE as ZONE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';

function fixture(name, conditions, configure = () => {}) {
  const f = createAuthoredProbeFixture(name), state = structuredClone(f.state);
  state.combatRuntime.entities[ACTOR].conditions = conditions;
  configure(state);
  const { eventHeadHash, lastEventId, ...domain } = state;
  const initialStateHash = canonicalSha256(domain); state.eventHeadHash = initialStateHash;
  const unsigned = { ...f.genesis, initialState: state, initialStateHash }; delete unsigned.genesisHash;
  f.genesis = { ...unsigned, genesisHash: canonicalSha256(unsigned) };
  const rebuilt = f.runtime.replay(f.genesis, []); assert.equal(rebuilt.kind, 'replayed'); f.state = rebuilt.state;
  return f;
}
function plan(f, mode = 'normal', effects = []) {
  return { schema: 'zhuwei.world-interaction-resolution-plan/v1', resolutionId: `resolution:${f.rootActionId}`, interactionRef: `interaction:${f.rootActionId}`,
    actorCharacterId: ACTOR, sceneRef: SCENE, abilityRef: null, contextHash: canonicalSha256({ case: f.rootActionId }),
    readSet: [ACTOR, TARGET, SCENE, SOURCE, ZONE, 'relation:probe-occupant'].sort().map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })),
    targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], basisRefs: [SOURCE], intent: '操作阀门', method: '推动手柄',
    ruling: { kind: 'check', resolutionKind: 'abilityCheck', randomnessId: `randomness:${f.rootActionId}`,
      check: { kind: 'ability', ability: 'strength', skill: null, dc: '10', modifier: '0', mode, costs: [],
        goal: '改变状态', method: '推动手柄', risk: '可能失败', successOutcome: '成功', failureOutcome: '失败' } },
    costs: [], branches: { success: { outcomeCode: 'outcome:success', summary: '成功', effects, sensoryEvidence: [], pressures: [], opportunities: [] },
      failure: { outcomeCode: 'outcome:failure', summary: '失败', effects: [], sensoryEvidence: [], pressures: [], opportunities: [] } } };
}
function step(f, p) { return f.runtime.step(f.profiles, f.state, { kind: 'resolveWorldInteraction', rootActionId: f.rootActionId, actorCharacterId: ACTOR, plan: p }); }
function settled(f, initial) {
  const result = f.runtime.step(f.profiles, initial.state, { kind: 'fulfillAuthoritativeRandomness', continuation: initial.continuation,
    rolls: initial.randomnessRequest.dice.flatMap(die => Array(Number(die.count)).fill(12)) });
  assert.equal(result.kind, 'committed', JSON.stringify(result.rejection));
  const rebuilt = f.runtime.replay(f.genesis, [...initial.events, ...result.events]);
  assert.equal(rebuilt.kind, 'replayed', JSON.stringify(rebuilt)); assert.deepEqual(rebuilt.state, result.state);
  return result;
}
test('poison and declared advantage cancel once in the frozen request and across resume/replay', () => {
  const f = fixture('poisoned-check', { poisoned: true });
  const p = plan(f, 'advantage'), waiting = step(f, p);
  assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting));
  assert.equal(p.ruling.check.mode, 'advantage');
  assert.equal(waiting.randomnessRequest.frozenCheck.mode, 'normal');
  assert.deepEqual(waiting.randomnessRequest.dice, [{ count: '1', sides: '20' }]);
  settled(f, waiting);
});
test('incapacitated interaction and refusal attempts stop before their cost and randomness', () => {
  const f = fixture('incapacitated-check', { unconscious: true });
  const rejected = step(f, plan(f)); assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
  const input = { kind: 'ruleWorldInteractionFeasibility', rootActionId: 'root:feasibility', actorCharacterId: ACTOR, plan: {
    schema: 'zhuwei.world-interaction-feasibility-ruling-plan/v1', actorCharacterId: ACTOR,
    contextHash: canonicalSha256({ case: f.rootActionId }),
    readSet: [ACTOR, SOURCE, `character-timeline:${ACTOR}`].sort().map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })),
    intent: '尝试', method: '推动', rulingKind: 'missingPrerequisite', publicBasis: '状态不允许', basisRefs: [SOURCE],
    prerequisites: [{ kind:'condition',ref:ACTOR,description:'恢复行动能力' }], nextActions: [{ description:'等待恢复' }], costs: [{ kind: 'fictionTime', durationMicros: '6000000' }],
  } };
  const refusal = f.runtime.step(f.profiles, f.state, input); assert.equal(refusal.kind, 'rejected'); assert.equal(refusal.rejection.code,'missingPrerequisite'); assert.deepEqual(refusal.events, []);
});
test('frightened sight uses current geometry and missing geometry is unresolved', () => {
  const blocked = fixture('fear-covered', { frightened: true, frightenedBy: TARGET }, state => {
    state.combatRuntime.scenes[SCENE].geometry.obstacles.push({ featureId: 'feature:opaque-wall', kind: 'barrier', label: '隔墙', state: 'intact',
      polygon: [{x:'160',y:'0'},{x:'170',y:'0'},{x:'170',y:'600'},{x:'160',y:'600'}], elevation:'0',height:'120',opaque:true,impassable:true,
      cover:'full',propagation:'blocked',terrain:'normal',visibilityPolicyId:'visibility:scene-observers' });
  });
  const waiting = step(blocked, plan(blocked)); assert.equal(waiting.kind, 'awaitingRandomness', JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequest.frozenCheck.mode, 'normal'); settled(blocked, waiting);
  const missing = fixture('fear-missing-geometry', { frightened:true,frightenedBy:TARGET }, state => { delete state.combatRuntime.scenes[SCENE].geometry; });
  const unresolved = step(missing, plan(missing)); assert.equal(unresolved.kind, 'rejected');
  assert.equal(unresolved.rejection.code, 'missingPrerequisite'); assert.match(unresolved.rejection.message, /Condition context/);
});
test('charm prevents an object interaction from using its registered hazard to harm the charmer', () => {
  const f = fixture('charmed-hazard', { charmed:true,charmedBy:TARGET });
  const p = plan(f, 'normal', [{ kind:'registeredHazard',sourceDefinitionRef:SOURCE,zoneRef:ZONE,
    damage:{kind:'profile',damageProfileRef:'world-damage:falling-object:moderate'} }]);
  const rejected = step(f,p); assert.equal(rejected.kind,'rejected'); assert.deepEqual(rejected.events,[]);
  assert.match(rejected.rejection.message,/charmedCannotHarmCharmer2014/);
});
