import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { proposalObservationSubjectRefs, proposalItemEntryRefs, proposalCreatureTargetRefs, proposalNpcSourceChoices, proposalModelContext, proposalNpcRecall, proposalKnowledgeRecall, proposalContextView, proposalItemDefinitionRefs } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { invokeVNextProposalOffer, invokeSubmitKpProposalBundleFirstPass } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { createVNextProposalBundleSchema, createSubmitKpProposalBundleModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';

function fields(schema) {
  const result = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.properties?.focusRefs) result.push({ kind: 'focus', schema: value.properties.focusRefs.items });
    if (value.properties?.observerRef && value.properties?.evidence && value.properties?.subjectRef)
      result.push({ kind: 'subject', schema: value.properties.subjectRef });
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  }
  walk(expandDeepSeekSchema(schema));
  assert.ok(result.some(field => field.kind === 'focus'));
  assert.ok(result.some(field => field.kind === 'subject'));
  return result;
}
function fixture(label) {
  const ref = `knowledge:background-${label}`;
  const f = createAuthoredProbeFixture(`subject-wire-${label}`, { initialKnowledge: [{
    characterId: ACTOR, knowledgeRef: ref, kind: 'sensoryEvidence', layer: 'full',
    content: '曾见过这个地方。', visibility: 'private', provenanceChain: ['genesis:prior'],
  }] });
  return { ...f, knowledgeRef: ref };
}

test('the selected provider stage offers physical subjects independently of knowledge evidence and selection has no world references', async () => {
  for (const stage of ['offer', 'expanded']) {
    const f = fixture(stage), before = structuredClone(f.requiredContext), refs = proposalObservationSubjectRefs(f.requiredContext);
    assert.ok(refs.includes(SCENE)); assert.ok(refs.includes(ACTOR)); assert.ok(!refs.includes(f.knowledgeRef));
    let calls = 0;
    const result = await (stage === 'offer' ? invokeVNextProposalOffer : invokeSubmitKpProposalBundleFirstPass)({
      modelId: 'test-double', message: JSON.stringify({ requiredContext: proposalModelContext(f.requiredContext) }), requiredContext: f.requiredContext,
      binding: { async run(_model, request) {
        calls++; assertDeepSeekStrictToolModelInput(request);
        const context = JSON.parse(request.messages[1].content).requiredContext;
        const scene = context.entries.find(entry => entry.entryRef === SCENE).value;
        assert.deepEqual(scene.worldDescription, { scene: { name: '蒸汽廊道' } });
        assert.ok(scene.adjudication.combatScene.geometry);
        const tool = request.tools[0].function;
        for (const field of stage === "offer" ? [] : fields(tool.parameters)) {
          for (const valid of [SCENE, ACTOR, 'prospective:new-object']) assert.equal(matchesAuthoredSourceSchema(valid, field.schema), true);
          for (const invalid of [f.knowledgeRef, `knowledge:${ACTOR}:${f.knowledgeRef}`, 'unknown:world-object', 'profile:rules'])
            assert.equal(matchesAuthoredSourceSchema(invalid, field.schema), false);
          if (field.kind === 'subject') assert.equal(matchesAuthoredSourceSchema({ kind: 'none' }, field.schema), true);
        }
        return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: tool.name,
          arguments: JSON.stringify(stage === 'offer' ? { requestedCapabilities: ['observe', 'knowledgeReview'] }
            : { decision: { kind: 'knowledgeReview', inquiry: '已有知识。', scope: 'allKnown', knowledgeRefs: [] } }),
        } }] } }] };
      } },
    });
    assert.equal(result.kind, stage === 'offer' ? 'schemaRequested' : 'locallyAccepted'); assert.equal(calls, 1); assert.deepEqual(f.requiredContext, before);
  }
});

test('empty subjects allow explicit same-bundle objects and no-individual-subject evidence, without inventing existing targets', () => {
  for (const field of fields(createVNextProposalBundleSchema(['observe', 'worldInteraction'], [], []))) {
    assert.equal(matchesAuthoredSourceSchema('unknown:existing', field.schema), false);
    assert.equal(matchesAuthoredSourceSchema('prospective:new', field.schema), true);
    if (field.kind === 'subject') assert.equal(matchesAuthoredSourceSchema({ kind: 'none' }, field.schema), true);
  }
});

test('Room reconstructs the identical subject schema from frozen context and rejects widened target candidates', () => {
  const f = fixture('room-surface');
  const message = JSON.stringify({ requiredContext: proposalModelContext(f.requiredContext) });
  // Build the surface with exactly the arguments the production provider uses;
  // Room reconstructs from the same frozen context, so any omission here would
  // test a request the provider never sends.
  // Ordinal 2 offers the selection tool alongside the proposal, so the surface
  // Room reconstructs must be the amendable one the provider actually sends.
  // The provider builds the forms over the frozen context less the bystander
  // views and unread bodies the selection did not name; so does Room.
  const view = proposalContextView(f.requiredContext);
  const surface = (subjectRefs, creatureRefs) => createSubmitKpProposalBundleModelInput(message, ['observe'],
    proposalItemEntryRefs(view), subjectRefs, [],
    proposalNpcSourceChoices(view), requiredContextBasisReferences(view), creatureRefs, true, proposalItemDefinitionRefs(view),
    proposalNpcRecall(f.requiredContext).requestableRefs, proposalKnowledgeRecall(f.requiredContext, []).map(record => record.handle));
  const request = surface(proposalObservationSubjectRefs(view), proposalCreatureTargetRefs(view));
  const input = { ordinal: 2, contextHash: f.requiredContext.binding.contextHash,
    bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request };
  const prior = () => ({ status: 'completed', context_hash: input.contextHash, binding_hash: input.bindingHash,
    response_json: JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: {
      name: 'offer_kp_proposal_bundle', arguments: JSON.stringify({ requestedCapabilities: ['observe'] }),
    } }] } }] }) });
  assert.doesNotThrow(() => assertVNextInvocationTransition(input, prior, f.requiredContext));
  const changed = surface([...proposalObservationSubjectRefs(view), f.knowledgeRef], proposalCreatureTargetRefs(view));
  assert.throws(() => assertVNextInvocationTransition({ ...input, request: changed }, prior, f.requiredContext), /PROPOSAL_REPAIR_EXHAUSTED/);
  // An observe request carries no ability terminal, so the creature surface is
  // not part of this schema and cannot silently widen it. The ability terminal
  // owns that guard; see kp-vnext-ability-operation.test.mjs.
  assert.equal(JSON.stringify(surface(proposalObservationSubjectRefs(f.requiredContext),
    [...proposalCreatureTargetRefs(f.requiredContext), f.knowledgeRef]).tools), JSON.stringify(request.tools));
  for (const content of ['查看周围。', JSON.stringify({ requiredContext: { ...proposalModelContext(f.requiredContext), entries: [] } })]) {
    const altered = structuredClone(request); altered.messages[1].content = content;
    assert.throws(() => assertVNextInvocationTransition({ ...input, request: altered }, prior, f.requiredContext), /PROPOSAL_REPAIR_EXHAUSTED/);
  }
  const changedDescription = structuredClone(request);
  const body = JSON.parse(changedDescription.messages[1].content);
  body.requiredContext.entries.find(entry => entry.entryRef === SCENE).value.worldDescription.scene.name = '凭空新增的场景';
  changedDescription.messages[1].content = JSON.stringify(body);
  assert.throws(() => assertVNextInvocationTransition({ ...input, request: changedDescription }, prior, f.requiredContext), /PROPOSAL_REPAIR_EXHAUSTED/);
});
