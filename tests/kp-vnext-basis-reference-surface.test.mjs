import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { invokeSubmitKpProposalBundleFirstPass, parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { npcDecisionEntryRef } from '../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';

const NPC = 'npc:basis:archivist';
function fixture(name) {
  const f = createAuthoredProbeFixture(`basis-surface:${name}`, { npcCharacters: [{ id: NPC, name: '档案员' }] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: '我向对方说明来意。' }).context;
  return f;
}
function social(refs = [NPC]) {
  return { mode: 'adjudication', basisRefs: refs, terminal: null,
    adjudication: { kind: 'directSuccess', risk: '普通交谈。', successOutcome: '作出回应。' },
    proposals: [{ kind: 'social', basisRefs: refs, consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef: NPC, addressedThreadRef: null, goal: '说明来意。', method: '当面交谈。', communication: 'spokenConversation', audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'answered', summary: '对方作出回应。',
        response: { kind: 'speech', text: '我听到了。', motive: '回应本人刚听到的话。', basis: [{ kind: 'playerExpression' }] }, consequences: [] }, failure: null } }] };
}
const response = wire => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: {
  name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(wire),
} }] } }] });
const decision = (schema, kind = 'directSuccess') => expandDeepSeekSchema(schema).properties.decision.anyOf.find(value => value.properties.kind.enum.includes(kind));
const step = (schema, kind) => decision(schema).properties.steps.items.anyOf.find(value => value.properties.kind.enum.includes(kind));

test('the real Provider basis selector excludes a read-bound NPC wrapper; original draft still fails the original lowerer', async () => {
  const f = fixture('wrapper'), wrapper = npcDecisionEntryRef(NPC), wire = encodeVNextStrictToolBundle(social([NPC, wrapper]));
  const original = structuredClone(wire), before = structuredClone(f.state); let schema, calls = 0;
  const first = await invokeSubmitKpProposalBundleFirstPass({ modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext,
    capabilities: ['social'], terminalKinds: [], binding: { async run(_model, request) { calls++; schema = request.tools[0].function.parameters; return response(wire); } } });
  assert.equal(first.kind, 'locallyAccepted'); assert.equal(calls, 1);
  const rejected = lowerVNext2ProposalBundle({ ...f, value: first.bundle });
  assert.equal(rejected.kind, 'rejected'); assert.equal(rejected.code, 'PROPOSAL_REFERENCE_INVALID');
  assert.ok(rejected.diagnostics.some(d => d.constraint === 'proposal:basis-ref-not-authorized' && d.actual.value === wrapper && !d.repair.allowed));
  assert.deepEqual(wire, original); assert.deepEqual(f.state, before);
  const field = step(schema, 'social').properties.basisRefs;
  assert.equal(matchesAuthoredSourceSchema([NPC], field), true);
  assert.equal(matchesAuthoredSourceSchema([wrapper], field), false);
});
