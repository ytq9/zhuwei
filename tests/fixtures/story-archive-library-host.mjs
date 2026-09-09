import assert from 'node:assert/strict';
import { canonicalHash } from '../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { authoritativeModuleProfile } from '../../app/_runtime/lib/module/authoritative.ts';
import { hashWorldState } from '../../app/_runtime/lib/rules/v2/validation.ts';
import { freezeAuthoredProbeContext } from '../../tools/lib/vnext-authored-probe-fixture.mjs';
import { createStoryMaterializationFixture, bundle, npcSelector, ACTOR, SCENE } from './kp-vnext-story-materialization.mjs';
import { storyResponse, storyReviewBody } from './story-creation.mjs';
import { prepareStory } from '../../app/_runtime/lib/room/story-creation/index.ts';
import { roomStoryRequest } from '../../app/_runtime/lib/room/story-action-request.ts';
import { buildRoomStoryContext } from '../../app/_runtime/lib/room/story-context.ts';
import { bindStoryPreparationContext } from '../../app/_runtime/lib/room/story-action-context.ts';
import { lowerVNext2ProposalBundle } from '../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { prepareStoryAdmissionBinding, storyAdmissionReceipt } from '../../app/_runtime/lib/room/story-admission.ts';
import { pendingStores, pendingSnapshot } from './story-npc-pending.mjs';
import { StoryLibraryStore } from '../../app/_runtime/lib/room/story-library-store.ts';
import { StoryCreationStore } from '../../app/_runtime/lib/room/story-creation-store.ts';
import { createStoryExternalInvocationJournal } from '../../app/_runtime/lib/room/story-external-invocation-journal.ts';
import { prepareRoomStory, storyProviderRequest } from '../../app/_runtime/lib/room/story-preparation-host.ts';
import { roomModelInvocationBinding, roomStoryBudget, ROOM_STORY_TRANSPORT } from '../../app/_runtime/lib/room/story-runtime-policy.ts';
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_HASH } from '../../app/_runtime/lib/kp/vnext/runtime-policy.ts';
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, encodeVNextStrictToolBundle,
  OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferResponse, parseSubmitKpProposalBundleCandidateArguments } from '../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { proposalModelContext, proposalItemEntryRefs, proposalObservationSubjectRefs, proposalNpcSourceChoices,
  proposalCreatureTargetRefs, proposalItemDefinitionRefs } from '../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { requiredContextBasisReferences } from '../../app/_runtime/lib/kp/vnext/required-context-runtime.ts';
import { deepSeekRequestBody } from '../../app/_runtime/lib/kp/deepseek.ts';
import { buildAuthoritativeArchive } from '../../app/_runtime/lib/room/archive.ts';
import { buildStoryArchive, validateStoryArchive } from '../../app/_runtime/lib/room/story-archive.ts';
import { exportStoryArchiveHostBindings, validateStoryArchiveHostBinding,
  readStoryArchiveAdmissionRulesInput } from '../../app/_runtime/lib/room/story-archive-host.ts';

export const clone = structuredClone;
export const roomOf = state => ({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId });
export const creationOfferIds = ['worldInteraction', 'storyPreparation', 'storyMethodInvestigation', 'storyShort', 'storyMain'];
const tool = (name, value) => ({ choices: [{ message: { tool_calls: [{ type: 'function',
  function: { name, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }] });

/** Production-pinned module on the fixture's explicit initial world. Rebuild
 * the real codec and Rules actions from this genesis; never relabel a ready
 * draft or weaken the archive host's pinned-module check. */
export async function pinnedStoryFixture(name) {
  const f = await createStoryMaterializationFixture(`archive-library:${name}`, { newNpc: true });
  f.moduleProfile = await authoritativeModuleProfile('black-oak-will');
  const initialState = clone(f.genesis.initialState);
  initialState.campaignRuntime.campaign.moduleRef = clone(f.moduleProfile.moduleRef);
  for (const chapter of Object.values(initialState.campaignRuntime.chapters)) chapter.moduleRef = clone(f.moduleProfile.moduleRef);
  initialState.combatRuntime.scenes[SCENE].geometry.spawnPoints.push({ x: '500', y: '100', elevation: '0' });
  const initialStateHash = hashWorldState(initialState); initialState.eventHeadHash = initialStateHash;
  const { genesisHash: _old, ...unsigned } = { ...f.genesis, moduleRef: clone(f.moduleProfile.moduleRef), initialState, initialStateHash };
  f.genesis = { ...unsigned, genesisHash: canonicalHash(unsigned) };
  const replayed = f.runtime.replay(f.genesis, []); assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
  f.state = replayed.state; f.events = [];
  f.run({ kind: 'resolveFreeAction', proposalId: `${f.rootActionId}:elapsed`, characterId: ACTOR,
    goal: '整理登记材料', method: '逐份核对', feasibility: { kind: 'directSuccess', publicBasis: '可以直接整理。' },
    outcome: { fictionTimeCostMicros: '100' } });
  f.selectionContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId,
    focusRefs: ['npc:boatman', 'npc:clerk', 'record:ledger'], intentText: f.selectionContext.intent.text }).context;
  f.request = roomStoryRequest(f.selectionContext, f.state, { method: 'story.method.archive-investigation', scale: 'short', connection: 'mainStory' });
  const built = buildRoomStoryContext({ ...f, request: f.request, requiredContext: f.selectionContext, maxUnits: 48_000 });
  assert.equal(built.kind, 'ready', JSON.stringify(built)); f.storyContext = built.context;
  f.reviewBody = storyReviewBody(f); f.invocations = []; let checkpoint = null;
  const prepared = await prepareStory(f.request, f.storyContext, null, { recipes: f.recipes, hash: canonicalHash,
    async invoke(request) { f.invocations.push(clone(request)); return { kind: 'completed',
      response: storyResponse(request.stage === 'review' ? f.reviewBody : f.body, request.stage) }; },
    async saveCheckpoint(expected, next) { assert.equal(expected, checkpoint?.revision ?? 0); checkpoint = clone(next); return { ok: true, checkpoint }; } });
  assert.equal(prepared.kind, 'ready', JSON.stringify(prepared));
  f.checkpoint = checkpoint; f.preparation = prepared.preparation; f.review = prepared.review; f.preparationHash = canonicalHash(f.preparation);
  const bound = bindStoryPreparationContext({ ...f, maxUnits: 48_000 });
  assert.equal(bound.kind, 'ready', JSON.stringify(bound)); f.requiredContext = bound.context; f.storyBinding = bound.binding;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(bundle([npcSelector(f)]))));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed)); f.proposal = parsed.bundle;
  const lowered = lowerVNext2ProposalBundle({ ...f, value: f.proposal });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered)); f.rulesInput = lowered.command.rulesInput;
  const input = prepareStoryAdmissionBinding({ ...f, job: { request: f.request, context: f.storyContext, checkpoint: f.checkpoint },
    preparedActionId: f.selectionContext.binding.preparedActionId });
  assert.ok(input); f.binding = { ...input, bindingHash: canonicalHash(input) };
  f.beforeAdmission = clone(f.state); f.result = f.run(f.rulesInput);
  f.admission = storyAdmissionReceipt({ ...f, receiptId: f.result.receipt.receiptId, recordedAtEventSeq: f.result.receipt.eventRange.toEventSeq });
  return f;
}

export function libraryStores(room) {
  const base = pendingStores(), library = new StoryLibraryStore(base.storage, room); library.ensureSchema(); let id = 0;
  const story = new StoryCreationStore(base.storage, { hash: canonicalHash, now: () => 1_000, newId: () => `library-invocation:${++id}`, library });
  return { ...base, story, library, journal: createStoryExternalInvocationJournal(story) };
}

export function recordLibraryAction(s, f, { state = f.state, context, binding, offerIds, proposal }) {
  const original = binding.selectionContext, preparedId = original.binding.preparedActionId, root = original.binding.rootActionId;
  const originalInput = { kind: 'intent', submissionId: original.intent.submissionRef, text: original.intent.text };
  const prepared = { kind: 'prepared', preparedActionId: preparedId, rootActionId: root, requiredContext: context, storyPreparation: binding,
    kpProjection: f.runtime.project(f.profiles, state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' }), resolutionMode: 'kpProposal', phase: 'playerIntent' };
  const control = state.characterControls[original.intent.actorRef], principalId = state.seats[control.seatId].principalId;
  s.authority.insertSubmission({ submissionId: original.intent.submissionRef, principalId, payloadHash: canonicalHash(originalInput), inputKind: 'intent',
    rootActionId: root, preparedActionId: preparedId, characterId: original.intent.actorRef,
    sceneScope: `scene:${state.entities[original.intent.actorRef].sceneId}`, preparedScopeVersion: 0, prepared, continuation: { originalInput } });
  s.authority.saveStoryPreparationModule(preparedId, f.moduleProfile);
  const offer = tool(OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, { requestedCapabilities: offerIds });
  const selected = parseVNextProposalOfferResponse(offer, original), message = ctx => JSON.stringify({ requiredContext: proposalModelContext(ctx) });
  const inputs = [createVNextProposalOfferModelInput(message(original), original), createSubmitKpProposalBundleModelInput(message(context), selected.capabilities,
    proposalItemEntryRefs(context), proposalObservationSubjectRefs(context), selected.terminalKinds, proposalNpcSourceChoices(context),
    requiredContextBasisReferences(context), proposalCreatureTargetRefs(context), true, proposalItemDefinitionRefs(context))];
  const responses = [offer, proposal ? tool(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, encodeVNextStrictToolBundle(proposal)) : undefined];
  const calls = inputs.map((input, index) => {
    const ordinal = index + 1, request = deepSeekRequestBody(VNEXT_KP_PROFILE.modelId, input);
    const external = roomModelInvocationBinding(state, root, `proposal:${preparedId}:${ordinal}`, 'proposal', request);
    const begun = s.storage.transactionSync(() => {
      const begun = s.journal.begin(external); assert.equal(begun.kind, 'ready', JSON.stringify(begun));
      s.authority.saveVnextInvocationProof({ prepared_action_id: preparedId, ordinal, context_hash: (index ? context : original).binding.contextHash,
        binding_hash: VNEXT_KP_WORKFLOW_HASH, request_hash: canonicalHash(request), repair_ticket_json: null,
        invocation_id: begun.invocationId, external_binding_json: JSON.stringify(external) }); return begun;
    });
    if (responses[index]) assert.equal(s.journal.complete(external, { ...begun, result: { kind: 'completed', response: responses[index],
      usage: { inputTokens: 10, outputTokens: 10, costMicros: 1 } } }).kind, 'saved');
    return { external, begun };
  });
  return { prepared, calls };
}

export async function recordSourceStory(s, f, entry) {
  let physicalCalls = 0;
  const result = await prepareRoomStory({ request: f.request, context: f.storyContext, budget: roomStoryBudget(f.request.source) }, {
    store: s.story, transport: ROOM_STORY_TRANSPORT, recipes: f.recipes, binding: { async run(model, body) {
      assert.equal(model, ROOM_STORY_TRANSPORT.modelId);
      const invocation = f.invocations[physicalCalls++];
      assert.deepEqual(body, storyProviderRequest(invocation, ROOM_STORY_TRANSPORT));
      return { ...storyResponse(invocation.stage === 'review' ? f.reviewBody : f.body, invocation.stage),
        usage: { prompt_tokens: 10, completion_tokens: 10 } };
    } } });
  assert.equal(result.kind, 'ready', JSON.stringify(result)); assert.equal(physicalCalls, 2);
  assert.deepEqual(s.story.readJob(f.request.jobId).checkpoint, f.checkpoint); s.library.save(entry);
  recordLibraryAction(s, f, { state: f.beforeAdmission, context: f.requiredContext, binding: f.storyBinding,
    offerIds: creationOfferIds, proposal: f.proposal });
  const { bindingHash: _hash, ...admissionInput } = f.binding;
  assert.equal(s.story.prepareAdmission(admissionInput).kind, 'saved');
  s.authority.saveStoryAdmissionInput(f.binding.preparedActionId, f.rulesInput);
  assert.equal(s.story.recordAdmission(f.admission).kind, 'saved');
  s.authority.finishSubmission(f.binding.preparedActionId, 'committed', canonicalHash(f.rulesInput), { kind: 'committed', receipt: f.result.receipt });
}

export async function captureLibraryArchive(s, f) {
  const receiptRefs = Object.values(f.state.receipts).map(receipt => ({ receiptId: receipt.receiptId, rootActionId: receipt.rootActionId,
    status: receipt.status, activeBranchId: receipt.branchId, eventRange: { first: receipt.eventRange.fromEventSeq, last: receipt.eventRange.toEventSeq },
    scopeVersions: {}, randomnessCommitmentHash: canonicalHash([]) }));
  const archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis, events: f.events, receiptRefs, projectionAudits: [] }, f.runtime.replay);
  const context = { archive, storySnapshot: pendingSnapshot(s, f.state) };
  const bindings = exportStoryArchiveHostBindings(s.authority, context.storySnapshot);
  return { context, bindings, ports: { replay: f.runtime.replay, validateHostBinding: validateStoryArchiveHostBinding,
    readAdmissionRulesInput: readStoryArchiveAdmissionRulesInput }, async envelope() {
    const built = await buildStoryArchive({ ...context, hostBindings: bindings, generation: '1' }, this.ports);
    assert.equal(built.kind, 'prepared', JSON.stringify(built));
    const checked = await validateStoryArchive(built.envelope, this.ports);
    assert.equal(checked.kind, 'validated', JSON.stringify(checked)); return checked;
  } };
}
