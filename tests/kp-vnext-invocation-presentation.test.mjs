import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { createVNextProposalOfferModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { assertVNextInvocationTransition } from '../app/_runtime/lib/room/vnext-proposal-invocation.ts';
import { canonicalJson } from '../app/_runtime/lib/room/archive.ts';

// D1 stores the story archive canonically, so a request proved from it comes
// back with the store's member order, not the provider request's. The Room
// still proves a request it is about to send by its exact printing.
const NPC = 'npc:presentation:steward';
function fixture() {
  const f = createAuthoredProbeFixture('invocation-presentation', { npcCharacters: [{ id: NPC, name: '管事' }] });
  return freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [], intentText: '我看向门口。' }).context;
}
const canonical = value => JSON.parse(canonicalJson(value));
const offerRequest = context => createVNextProposalOfferModelInput(
  JSON.stringify({ requiredContext: proposalModelContext(context, [], []) }), context);

test('a canonically re-serialized offer request is refused as sent and accepted as archived', () => {
  const context = fixture();
  const request = offerRequest(context);
  const stage = extra => ({ ordinal: 1, contextHash: context.binding.contextHash, bindingHash: 'sha256:fixture',
    requestHash: 'sha256:fixture', ...extra });
  const none = () => undefined;
  assert.doesNotThrow(() => assertVNextInvocationTransition(stage({ request }), none, context));
  assert.notEqual(JSON.stringify(request.tools), JSON.stringify(canonical(request).tools),
    'the fixture request must actually change presentation when canonicalized');
  assert.throws(() => assertVNextInvocationTransition(stage({ request: canonical(request) }), none, context),
    /PROPOSAL_REPAIR_EXHAUSTED/);
  assert.doesNotThrow(() => assertVNextInvocationTransition(
    stage({ request: canonical(request) }), none, context, undefined, undefined, 'canonical'));
});

test('an archived context proves the body it was sent, and a changed value is still refused', () => {
  const context = fixture();
  const request = offerRequest(context);
  const stage = { ordinal: 1, contextHash: context.binding.contextHash, bindingHash: 'sha256:fixture',
    requestHash: 'sha256:fixture', request };
  const none = () => undefined;
  // The archive hands the frozen context back canonically too, so the rebuilt
  // body prints differently from the saved one while meaning the same.
  const archived = canonical(context);
  assert.throws(() => assertVNextInvocationTransition(stage, none, archived), /PROPOSAL_REPAIR_EXHAUSTED/);
  assert.doesNotThrow(() => assertVNextInvocationTransition(stage, none, archived, undefined, undefined, 'canonical'));
  const altered = structuredClone(request);
  altered.messages[1].content = JSON.stringify({ ...JSON.parse(altered.messages[1].content), extra: 1 });
  assert.throws(() => assertVNextInvocationTransition({ ...stage, request: altered }, none, archived,
    undefined, undefined, 'canonical'), /PROPOSAL_REPAIR_EXHAUSTED/);
});
