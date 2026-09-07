import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_SCENE as SCENE } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  createSubmitKpProposalBundleModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { invokeSubmitKpProposalBundleFirstPass, vnextProposalAmendmentRequest } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { proposalModelContext, proposalItemEntryRefs, proposalObservationSubjectRefs,
  proposalCreatureTargetRefs, proposalNpcSourceChoices } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../app/_runtime/lib/kp/vnext/required-context-runtime.ts';

// Round 75 needed social + formActorPlan + passTime for one sentence and the
// selection carried only social. Capabilities are locked at selection, so the
// filling guidance that says a promised future act needs its own plan arrived
// after the model could act on it. Selection is now amendable once, by union.
const NPC = 'npc:amend:archivist';
function fixture(name) {
  const f = createAuthoredProbeFixture(`amend:${name}`, { npcCharacters: [{ id: NPC, name: '档案员' }] });
  f.requiredContext = freezeAuthoredProbeContext(f, f.state,
    { rootActionId: f.rootActionId, focusRefs: [NPC], intentText: '我请对方过半分钟提醒我。' }).context;
  return f;
}
function validSocialBundle() {
  return { mode: 'adjudication', basisRefs: [NPC], terminal: null,
    adjudication: { kind: 'directSuccess', risk: '普通交谈。', successOutcome: '作出回应。' },
    proposals: [{ kind: 'social', basisRefs: [NPC], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: SCENE,
      npcRef: NPC, addressedThreadRef: null, goal: '说明来意。', method: '当面交谈。', communication: 'spokenConversation',
      audience: 'participants', retryChange: null,
      branches: { success: { outcomeCode: 'answered', summary: '对方作出回应。',
        response: { kind: 'speech', text: '我听到了。', motive: '回应本人刚听到的话。', basis: [{ kind: 'playerExpression' }] },
        consequences: [] }, failure: null } }] };
}
const toolCall = (name, args) => ({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{
  type: 'function', function: { name, arguments: args } } ] } }] });
const amendmentResponse = ids => toolCall(OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, JSON.stringify({ requestedCapabilities: ids }));
const submitResponse = bundle => toolCall(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, JSON.stringify(encodeVNextStrictToolBundle(bundle)));

test('the proposal call can amend its own selection once, by union', async () => {
  const f = fixture('union'), requests = [];
  const first = await invokeSubmitKpProposalBundleFirstPass({
    modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext,
    capabilities: ['social'], terminalKinds: [], amendable: true,
    binding: { async run(_model, request) { requests.push(request); return amendmentResponse(['formActorPlan', 'passTime']); } },
  });
  assert.equal(first.kind, 'amendmentRequested', JSON.stringify(first));
  // passTime is a terminal, not an operation. An amendment that only unioned
  // operations would silently drop the very half round 75 needed, so both are
  // carried and the split stays the catalogue's own.
  assert.deepEqual(first.amendment.requestedCapabilities, ['formActorPlan']);
  assert.deepEqual(first.amendment.requestedTerminalKinds, ['passTime']);
  // A union: the original selection survives, so an amendment can never drop a
  // type the selection already accepted.
  const amended = [...first.amendment.amendedCapabilities].sort();
  for (const id of ['social', 'formActorPlan']) assert.ok(amended.includes(id), id);
  assert.ok(first.amendment.amendedTerminalKinds.includes('passTime'));

  // The amendable round offers both tools; the amended round offers only submit.
  assert.deepEqual(requests[0].tools.map(t => t.function.name),
    [SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
  const second = await invokeSubmitKpProposalBundleFirstPass({
    modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext,
    capabilities: first.amendment.amendedCapabilities, terminalKinds: first.amendment.amendedTerminalKinds, amendable: false,
    binding: { async run(_model, request) { requests.push(request); return submitResponse(validSocialBundle()); } },
  });
  assert.deepEqual(requests[1].tools.map(t => t.function.name), [SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME]);
  assert.equal(second.kind, 'locallyAccepted', JSON.stringify(second));
});

test('an amendment that adds nothing is not a continuation, and a non-amendable round has no selection tool', async () => {
  const f = fixture('noop');
  // Requesting only what is already loaded buys nothing and must not spend a call.
  assert.equal(vnextProposalAmendmentRequest(amendmentResponse(['social']), ['social']), undefined);
  assert.ok(vnextProposalAmendmentRequest(amendmentResponse(['passTime']), ['social']));
  // Without the flag the selection tool is absent, so the same response is just
  // the wrong tool and fails as one.
  const rejected = await invokeSubmitKpProposalBundleFirstPass({
    modelId: 'test', message: '冻结上下文', requiredContext: f.requiredContext,
    capabilities: ['social'], terminalKinds: [],
    binding: { async run() { return amendmentResponse(['passTime']); } },
  });
  assert.equal(rejected.kind, 'rejected');
});

test('Room proves the amended round and the fourth call from the saved responses', () => {
  const f = fixture('room'), ctx = f.requiredContext;
  const message = JSON.stringify({ requiredContext: proposalModelContext(ctx) });
  const surface = (capabilities, amendable) => createSubmitKpProposalBundleModelInput(message, capabilities,
    proposalItemEntryRefs(ctx), proposalObservationSubjectRefs(ctx), [],
    proposalNpcSourceChoices(ctx), requiredContextBasisReferences(ctx), proposalCreatureTargetRefs(ctx), amendable);
  const saved = response => ({ status: 'completed', context_hash: ctx.binding.contextHash,
    binding_hash: 'sha256:fixture', response_json: JSON.stringify(response) });
  const offer = saved(amendmentResponse(['social']));
  const amendmentAt2 = saved(amendmentResponse(['formActorPlan']));
  const amended = vnextProposalAmendmentRequest(amendmentResponse(['formActorPlan']), ['social']);
  assert.ok(amended);

  const prior = second => ordinal => ordinal === 1 ? offer : ordinal === 2 ? second : undefined;
  const input = (ordinal, request) => ({ ordinal, contextHash: ctx.binding.contextHash,
    bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request });

  // Ordinal 3 after an amendment must be the amended, non-amendable surface.
  assert.doesNotThrow(() => assertVNextInvocationTransition(
    input(3, surface(amended.amendedCapabilities, false)), prior(amendmentAt2), ctx));
  // The original selection is no longer the right surface, and the amended
  // round may not offer another amendment.
  for (const wrong of [surface(['social'], false), surface(amended.amendedCapabilities, true)]) {
    assert.throws(() => assertVNextInvocationTransition(input(3, wrong), prior(amendmentAt2), ctx), /PROPOSAL_REPAIR_EXHAUSTED/);
  }
  // No draft exists, so no ticket may accompany the amended round.
  assert.throws(() => assertVNextInvocationTransition(
    { ...input(3, surface(amended.amendedCapabilities, false)), repairTicket: { schema: 'x' } },
    prior(amendmentAt2), ctx), /PROPOSAL_REPAIR_EXHAUSTED/);

  // A fourth call exists only after an amendment actually happened.
  const plainDraft = saved(submitResponse(validSocialBundle()));
  assert.throws(() => assertVNextInvocationTransition(
    input(4, surface(['social'], false)), prior(plainDraft), ctx), /PROPOSAL_REPAIR_EXHAUSTED/);
  assert.throws(() => assertVNextInvocationTransition(
    input(5, surface(amended.amendedCapabilities, false)), prior(amendmentAt2), ctx), /PROPOSAL_REPAIR_EXHAUSTED/);
});

test('the amendable proposal surface is what Room reconstructs at ordinal 2', () => {
  const f = fixture('ordinal2'), ctx = f.requiredContext;
  const message = JSON.stringify({ requiredContext: proposalModelContext(ctx) });
  const surface = amendable => createSubmitKpProposalBundleModelInput(message, ['social'],
    proposalItemEntryRefs(ctx), proposalObservationSubjectRefs(ctx), [],
    proposalNpcSourceChoices(ctx), requiredContextBasisReferences(ctx), proposalCreatureTargetRefs(ctx), amendable);
  const prior = () => ({ status: 'completed', context_hash: ctx.binding.contextHash,
    binding_hash: 'sha256:fixture', response_json: JSON.stringify(amendmentResponse(['social'])) });
  const at2 = request => ({ ordinal: 2, contextHash: ctx.binding.contextHash,
    bindingHash: 'sha256:fixture', requestHash: 'sha256:fixture', request });
  assert.doesNotThrow(() => assertVNextInvocationTransition(at2(surface(true)), prior, ctx));
  assert.throws(() => assertVNextInvocationTransition(at2(surface(false)), prior, ctx), /PROPOSAL_REPAIR_EXHAUSTED/);
});
