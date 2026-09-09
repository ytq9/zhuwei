import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, createVNextProposalBundleSchema } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';

import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';

const NPC = 'npc:planner', SECOND = 'npc:other-planner', KNOWLEDGE = 'knowledge:held-premise';
const PRIVATE = 'PLAYER_PRIVATE_FORMATION_CANARY';
const source = (npcRef = NPC) => ({ kind: 'formActorPlan', npcRef, factionRef: { kind: 'none' },
  goal: '设法让下一次交接更有条理。', nextStep: '交接以后在门框上系一条布带。', premiseRefs: [npcRef],
  resourceRefs: [], durationMicros: '2000000', traceDescription: '门框上多了一条新系的布带。',
  alternateTargetRef: SCENE, alternateReason: '需要改换行动对象时仍留意当前场景。' });
const wire = (entry = source()) => ({ decision: { kind: 'directSuccess', duration: 'none', risk: '形成私有计划尚未执行行动。',
  successOutcome: '保存计划并开始对应的Activity。' }, steps: [{ ...entry, outcomeBinding: 'always' }], results: [] });
function parsed(value) { return parseSubmitKpProposalBundleCandidateArguments(typeof value === 'string' ? value : JSON.stringify(value)); }

test('the selected shared schema exposes one flat timer form for distinct NPCs without model-owned identities or repeated evidence', () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const schema = expandDeepSeekSchema(createVNextProposalBundleSchema(["formActorPlan"], undefined, undefined, []));
  for (const npcRef of [NPC, SECOND]) {
    const input = wire(source(npcRef));
    assert.equal(matchesAuthoredSourceSchema(input, schema), true);
    const accepted = parsed(input); assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
    const entry = accepted.bundle.proposals[0];
    assert.equal(entry.kind, 'formActorPlan'); assert.equal(entry.npcRef, npcRef); assert.equal(entry.factionRef, null);
    assert.deepEqual(entry.basisRefs, []); assert.deepEqual(entry.consumes, []); assert.deepEqual(entry.produces, []);
    assert.equal(entry.outcomeBinding, 'always');
    for (const key of ['basisRefs', 'consumes', 'produces', 'planId', 'activityId', 'due', 'trigger', 'trace', 'alternateTarget', 'readSet']) {
      assert.equal(Object.hasOwn(input.steps[0], key), false);
    }
  }
});

test('same Rules shape diagnostics locate missing decisions and wrong numeric representation, while future sources are explicitly refused', () => {
  const missing = wire(); delete missing.steps[0].goal;
  const numeric = wire(); numeric.steps[0].durationMicros = 2000000;
  const future = wire(); future.steps[0].premiseRefs = ['prospective:future-knowledge'];
  for (const [input, field, code] of [[missing, 'goal', 'FIELD_MISSING'], [numeric, 'durationMicros', 'TYPE_MISMATCH'], [future, 'premiseRefs', 'REFERENCE_UNAVAILABLE']]) {
    const result = parsed(input); assert.equal(result.kind, 'locallyRejected', JSON.stringify(result));
    const diagnostic = result.diagnostics.find(detail => detail.path?.[0] === 'proposals' && detail.path?.[2] === field);
    assert.ok(diagnostic, JSON.stringify(result)); assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.repair.allowed, false);
  }
});

function fixture(name) {
  const f = createAuthoredProbeFixture(`formation-kp:${name}`, { npcCharacters: [{ id: NPC, name: '排班人', resources: { supplies: 3 } }, { id: SECOND, name: '巡夜人' }],
    initialKnowledge: [{ characterId: SECOND, knowledgeRef: KNOWLEDGE, content: '交接以后整理巡夜标记。', kind: 'sourceClaim', layer: 'partial', visibility: 'private', provenanceChain: ['genesis:npc'] },
      { characterId: ACTOR, knowledgeRef: 'knowledge:player-private', content: PRIVATE, kind: 'sourceClaim', layer: 'partial', visibility: 'private', provenanceChain: ['genesis:player'] }] });
  return f;
}
function lower(f, input, context) {
  const accepted = parsed(input); assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
  return lowerVNext2ProposalBundle({ value: accepted.bundle, requiredContext: context, state: f.state, profiles: f.profiles,
    rootActionId: context.binding.rootActionId, actorCharacterId: ACTOR });
}

test('empty self and holder-scoped knowledge lower through the same atomic plan with frozen authority versions', () => {
  const f = fixture('sources');
  for (const entry of [source(), { ...source(SECOND), premiseRefs: [`knowledge:${SECOND}:${KNOWLEDGE}`] }]) {
    const context = freezeAuthoredProbeContext(f, f.state, { focusRefs: [entry.npcRef] }).context;
    const result = lower(f, wire(entry), context); assert.equal(result.kind, 'accepted', JSON.stringify(result));
    assert.equal(result.command.rulesInput.kind, 'applyAtomicWorldInteractionSteps');
    const step = result.command.rulesInput.steps[0]; assert.equal(step.formId, 'objective-continuity.vnext-1');
    assert.equal(step.rulesInput.kind, 'formNpcActorPlan'); assert.deepEqual(step.produces, []);
    assert.deepEqual(step.rulesInput.plan.source.premiseRefs, [entry.npcRef === NPC ? NPC : KNOWLEDGE]);
    assert.ok(step.rulesInput.plan.readSet.some(binding => binding.ref === `character-timeline:${entry.npcRef}`));
    assert.equal(step.rulesInput.plan.source.goal, entry.goal);
  }
});

test('plan diagnostics list only the selected NPC own frozen premises even if another holder was loaded', () => {
  const f = fixture('private'), context = freezeAuthoredProbeContext(f, f.state, { focusRefs: [NPC, SECOND] }).context;
  for (const ref of [`knowledge:${ACTOR}:knowledge:player-private`, `knowledge:${SECOND}:${KNOWLEDGE}`]) {
    const input = wire({ ...source(), premiseRefs: [ref] });
    const result = lower(f, input, context); assert.equal(result.kind, 'rejected');
    assert.equal(result.code, 'PROPOSAL_REFERENCE_INVALID');
    const diagnostic = result.diagnostics[0]; assert.deepEqual(diagnostic.expected.refs, [NPC]);
    assert.equal(JSON.stringify(diagnostic).includes(PRIVATE), false);
    assert.equal(diagnostic.repair.allowed, false);
  }
});

test('a legitimate faction freezes its own resource closure without asking the model to repeat it or spending anything', () => {
  const f = fixture('faction'), factionRef = 'faction:watch';
  const registered = f.runtime.step(f.profiles, f.state, { kind: 'registerDynamicDefinition', proposalId: `${f.rootActionId}:faction`,
    definition: { definitionId: 'definition:watch', definitionKind: 'faction', revision: '1', rulesBasis: 'zhuwei-product-ruling',
      visibilityPolicyRef: 'visibility:scene-observers', content: { factionId: factionRef, name: '值班队', goal: '安排值班标记。',
        memberRefs: [NPC], resourceRefs: ['faction-resource:bell'] } } });
  assert.equal(registered.kind, 'committed', JSON.stringify(registered)); f.state = registered.state;
  const context = freezeAuthoredProbeContext(f, f.state, { focusRefs: [NPC, SECOND] }).context;
  const result = lower(f, wire({ ...source(), factionRef, resourceRefs: ['supplies'] }), context);
  assert.equal(result.kind, 'accepted', JSON.stringify(result));
  const plan = result.command.rulesInput.steps[0].rulesInput.plan;
  assert.deepEqual(plan.source.resourceRefs, [factionRef, 'faction-resource:bell', 'supplies'].sort());
  assert.ok(plan.readSet.some(binding => binding.ref === `continuity:factions:${factionRef}`));
  const committed = f.runtime.step(f.profiles, f.state, result.command.rulesInput);
  assert.equal(committed.kind, 'committed', JSON.stringify(committed));
  assert.equal(committed.state.entities[NPC].resources.supplies, 3);
  assert.ok(committed.state.campaignRuntime.factionPlans[plan.planId]);
  assert.equal(committed.state.canonicalFacts[plan.traceFactRef], undefined);
  const outsider = lower(f, wire({ ...source(SECOND), factionRef }), context);
  assert.equal(outsider.kind, 'rejected'); assert.equal(outsider.code, 'CONTEXT_INSUFFICIENT');
  assert.equal(outsider.diagnostics[0].constraint, 'npc-plan:frozen-faction-required');
});
