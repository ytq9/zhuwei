import assert from 'node:assert/strict';
import test from 'node:test';
import { promiseFixture, makePromiseInput, changePromiseInput, dueWork, objectBundle, ACTOR, NPC, SCENE } from './fixtures/vnext-promise-lifecycle.mjs';
import { prepareNpcWorkRequest, npcWorkModelInput, npcWorkRulesInput, npcWorkResponseIsEmpty, parseNpcWorkSelection } from '../app/_runtime/lib/kp/vnext/npc-work.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { encodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { freezeAuthoredProbeContext } from '../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';
import { characterTimelineId } from '../app/_runtime/lib/rules/v2/timeline.ts';
import { authorityRevisionOrHash } from '../app/_runtime/lib/rules/v2/authority-bindings.ts';

const toolResponse = value => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: {
  name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify(encodeVNextStrictToolBundle(value)),
} }] } }] });
test('only one known empty NPC tool response permits a bounded re-emission', () => {
  const response = (args, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) => ({ choices: [{ message: {
    tool_calls: [{ type: 'function', function: { name, arguments: args } }],
  } }] });
  assert.equal(npcWorkResponseIsEmpty(response('{}')), true);
  assert.equal(npcWorkResponseIsEmpty(response(' { } ', 'submit_npc_work_decision')), true);
  for (const invalid of [undefined, null, {}, response('{'), response('[]'), response('{"decision":{}}'),
    response('{"kind":"defer","kind":"cancel"}'), response('{}', 'unexpected_tool'),
    { choices: [{ message: { tool_calls: [response('{}').choices[0].message.tool_calls[0], response('{}').choices[0].message.tool_calls[0]] } }] }]) {
    assert.equal(npcWorkResponseIsEmpty(invalid), false);
  }
});
test('NPC schema selection isolates execution and plan decisions while rejecting unselected effects', () => {
  const response = (name, args) => ({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  const selection = requestedCapabilities => response('select_npc_work_schema', { requestedCapabilities });
  const f = promiseFixture('selection'), formed = f.runtime.step(f.profiles, f.state, makePromiseInput(f));
  const due = dueWork(f, formed.state).find(d => d.npcWork);
  const request = prepareNpcWorkRequest(formed.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcWork.planId);
  assert.equal(npcWorkModelInput(request).tools.length, 1);
  const execute = npcWorkModelInput(request, selection(['inventoryOperation']));
  assert.deepEqual(execute.tools.map(t => t.function.name), ['submit_kp_proposal_bundle']);
  const defer = npcWorkModelInput(request, selection(['defer']));
  assert.deepEqual(defer.tools.map(t => t.function.name), ['submit_npc_work_decision']);
  assert.deepEqual(defer.tools[0].function.parameters.properties.kind.enum, ['defer']);
  const decision = response('submit_npc_work_decision', { kind: 'defer', reason: '等到约定的准备时间。', nextStep: request.plan.nextStep, wakeAtFictionMicros: '60000000' });
  assert.equal(npcWorkRulesInput(decision, request, formed.state, f.profiles, selection(['defer'])).decision.kind, 'defer');
  assert.throws(() => npcWorkRulesInput(decision, request, formed.state, f.profiles, selection(['inventoryOperation'])), /SELECTION_INVALID/);
  assert.throws(() => npcWorkRulesInput(toolResponse(objectBundle()), request, formed.state, f.profiles, selection(['inventoryOperation'])), /SELECTION_INVALID/);
  for (const ids of [[], ['defer', 'inventoryOperation'], ['authorAbility'], ['defer', 'defer']]) assert.throws(() => parseNpcWorkSelection(selection(ids)), /SELECTION_INVALID/);
});
const commit = (f, state, input) => {
  // These Rules-only semantic cases choose to wait for more information when
  // no execution was requested by the case. Room cases cover real dispatch.
  const decisions = [];
  if (!['resolveNpcWork', 'applyServiceCorrection'].includes(input.kind)) for (const due of dueWork(f, state).filter(d => d.npcWork)) {
    const plan = state.campaignRuntime.npcPlans[due.npcWork.planId];
    const waiting = f.runtime.step(f.profiles, state, { kind: 'resolveNpcWork', proposalId: due.childRootActionId,
      planId: plan.planId, planHash: canonicalSha256(plan), decision: { kind: 'defer', reason: '等待进一步消息后再决定做法。',
        nextStep: plan.nextStep, wakeAtFictionMicros: null } });
    assert.equal(waiting.kind, 'committed', JSON.stringify(waiting)); state = waiting.state; decisions.push(...waiting.events);
  }
  if (typeof input === 'function') input = input(state);
  const result = f.runtime.step(f.profiles, state, input); assert.equal(result.kind, 'committed', JSON.stringify({ kind: result.kind, rejection: result.rejection }));
  return decisions.length ? { ...result, events: [...decisions, ...result.events] } : result;
};
const reviewFrame = (f, state) => {
  const due = dueWork(f, state).find(d => d.promiseReview); assert.ok(due);
  return { due, frame: f.runtime.project(f.profiles, state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' },
    { promiseReviewFor: due.promiseReview.promiseId }).promiseReview };
};
function reviewInput(f, state, judgment) {
  const { due, frame } = reviewFrame(f, state);
  return { kind: 'resolvePromiseReview', proposalId: due.childRootActionId, promiseId: frame.promiseId,
    frameHash: canonicalSha256(frame), judgment };
}
function historyInput(f, state, coverage) {
  const root = `${f.rootActionId}:history`, wire = worldFactSocialBundle({ sceneRef: state.entities[f.actorCharacterId].sceneId, npcRef: NPC,
    holders: coverage.subjectRefs, description: '在已经结算的这段期间，没有发生向外透露该秘密的行为。', occurrence: '此事实覆盖的已结算期间。' });
  wire.adjudication.durationMicros = '0'; wire.proposals = wire.proposals.slice(0, 1);
  wire.proposals[0].definition.worldFact.historyCoverage = coverage;
  wire.proposals[0].definition.worldFact.initialKnowledge = [];
  const context = freezeAuthoredProbeContext(f, state, { rootActionId: root, focusRefs: [NPC] }).context;
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(wire)));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const result = lowerVNext2ProposalBundle({ ...f, state, requiredContext: context, rootActionId: root, value: parsed.bundle });
  assert.equal(result.kind, 'accepted', JSON.stringify(result)); return result.command.rulesInput;
}

for (const nextStep of ['准备按约制作副本。', null]) test(`a spoken promise with nextStep=${nextStep} records its deadline and queues a decision without inventing work or delivery`, () => {
  const f = promiseFixture('formation'), result = f.runtime.step(f.profiles, f.state, makePromiseInput(f, f.state, { nextStep }));
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  const promise = Object.values(result.state.campaignRuntime.promises)[0];
  assert.equal(promise.lifecycle.deadlineFictionMicros, '3600000000');
  assert.equal(promise.lifecycle.obligation, 'outstanding');
  assert.deepEqual(result.state.campaignRuntime.activities, f.state.campaignRuntime.activities);
  assert.deepEqual(result.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  const work = dueWork(f, result.state);
  assert.equal(work.length, 1); assert.equal(work[0].activityId, null); assert.ok(work[0].npcWork);
  const request = prepareNpcWorkRequest(result.state, f.profiles, f.moduleProfile, work[0].childRootActionId, work[0].npcWork.planId);
  assert.ok(request); assert.doesNotMatch(JSON.stringify(npcWorkModelInput(request)), /PLAYER_ONLY_PROMISE_CANARY/);
  assert.deepEqual(f.runtime.replay(f.genesis, result.events).state, result.state);
});

for (const destination of [ACTOR, SCENE]) test(`a real NPC bundle makes and delivers a new item to ${destination}, preserving the original and waiting for the independent work duration`, () => {
  const f = promiseFixture(`deliver:${destination}`), journal = [];
  const seedRoot = `${f.rootActionId}:original`;
  const context = freezeAuthoredProbeContext(f, f.state, { rootActionId: seedRoot, focusRefs: [SCENE] }).context;
  const seed = lowerVNext2ProposalBundle({ ...f, rootActionId: seedRoot, requiredContext: context, value: objectBundle({ original: true, label: '原件' }) });
  assert.equal(seed.kind, 'accepted', JSON.stringify(seed));
  const original = commit(f, f.state, seed.command.rulesInput); journal.push(...original.events);
  const originalItem = Object.values(original.state.campaignRuntime.itemSystem.entries)[0];
  const promised = commit(f, original.state, makePromiseInput(f, original.state, { terms: {
    kind: 'result', subjectRefs: [NPC, originalItem.entryId], delivery: { sourceRef: originalItem.entryId, itemRef: null, quantity: 1,
      destinationKind: destination === SCENE ? 'scene' : 'holder', destinationRef: destination },
  } })); journal.push(...promised.events);
  const work = dueWork(f, promised.state).find(d => d.npcWork);
  const request = prepareNpcWorkRequest(promised.state, f.profiles, f.moduleProfile, work.childRootActionId, work.npcWork.planId);
  assert.ok(request);
  const bundle = objectBundle({ destination, sourceRef: originalItem.entryId, label: destination === SCENE ? '图稿' : '副本' });
  const response = toolResponse(bundle);
  const input = npcWorkRulesInput(response, request, promised.state, f.profiles);
  assert.equal(input.command.kind, 'startActionActivity');
  const started = commit(f, promised.state, input); journal.push(...started.events);
  assert.equal(Object.keys(started.state.campaignRuntime.itemSystem.entries).length, 1, 'starting work cannot create the future copy');
  const npcActivity = Object.values(started.state.campaignRuntime.activities).find(a => a.characterId === NPC);
  assert.equal(npcActivity.intendedDurationMicros, '1800000000');
  const rest = commit(f, started.state, { kind: 'startRest', proposalId: `${f.rootActionId}:rest`, characterId: ACTOR, restKind: 'long' }); journal.push(...rest.events);
  const next = dueWork(f, rest.state).find(d => d.ownerEntityId === ACTOR && d.activityProgress?.phase === 'advance'); assert.ok(next);
  const elapsed = commit(f, rest.state, { kind: 'advanceActivity', proposalId: next.childRootActionId, activityId: next.activityId }); journal.push(...elapsed.events);
  assert.equal(elapsed.state.fictionTimelines[next.timelineId].nowMicros, '1800000000');
  const completion = dueWork(f, elapsed.state).find(d => d.ownerEntityId === NPC && d.activityProgress?.phase === 'complete'); assert.ok(completion);
  const delivered = commit(f, elapsed.state, { kind: 'completeActionActivity', proposalId: completion.childRootActionId, activityId: completion.activityId }); journal.push(...delivered.events);
  assert.equal(delivered.state.campaignRuntime.npcPlans[work.npcWork.planId].status, 'resolved');
  const items = Object.values(delivered.state.campaignRuntime.itemSystem.entries), copy = items.find(i => i.entryId !== originalItem.entryId);
  assert.ok(copy, JSON.stringify(delivered)); assert.equal(copy.quantity, 1);
  assert.equal(destination === SCENE ? copy.sceneRef : copy.holderRef, destination);
  assert.deepEqual(delivered.state.campaignRuntime.itemSystem.entries[originalItem.entryId], originalItem);
  const review = dueWork(f, delivered.state).find(d => d.promiseReview); assert.ok(review);
  const frame = f.runtime.project(f.profiles, delivered.state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' }, { promiseReviewFor: review.promiseReview.promiseId }).promiseReview;
  assert.deepEqual(frame.items.find(i => i.entryId === originalItem.entryId), originalItem, 'the review sees the actual source as well as the delivered item');
  assert.deepEqual(frame.definitions.find(d => d.definitionId === originalItem.definitionRef),
    original.state.campaignRuntime.itemSystem.definitions[originalItem.definitionRef]);
  const evidence = frame.evidence.filter(e => e.itemsAfter.some(i => i.entryId === copy.entryId && (destination === SCENE ? i.sceneRef : i.holderRef) === destination));
  const settled = commit(f, delivered.state, { kind: 'resolvePromiseReview', proposalId: review.childRootActionId, promiseId: frame.promiseId,
    frameHash: canonicalSha256(frame), judgment: { outcome: 'fulfilled', remaining: false, reason: '已按原约完成真实交付。', evidenceRefs: [copy.entryId, ...evidence.map(e => e.eventId)] } }); journal.push(...settled.events);
  assert.equal(settled.state.campaignRuntime.promises[frame.promiseId].status, 'fulfilled');
  const privateProjection = f.runtime.project(f.profiles, settled.state, f.viewer, { committedRange: {
    receiptId: settled.receipt.receiptId, actorCharacterId: NPC, priorState: delivered.state, events: settled.events,
  } });
  assert.equal(privateProjection.kind, 'projected', JSON.stringify({ privateProjection, receipt: settled.receipt }));
  assert.deepEqual(privateProjection.renderableClaims.claims, []);
  assert.equal(privateProjection.promises[0].status, 'active', 'secret host adjudication cannot grant knowledge to the resting recipient');
  if (destination === ACTOR) {
    const advance = dueWork(f, settled.state).find(d => d.activityProgress?.phase === 'advance'); assert.ok(advance);
    const elapsedRest = commit(f, settled.state, { kind: 'advanceActivity', proposalId: advance.childRootActionId, activityId: advance.activityId });
    const end = dueWork(f, elapsedRest.state).find(d => d.activityProgress?.phase === 'complete'); assert.ok(end);
    const rested = commit(f, elapsedRest.state, { kind: 'completeActivity', proposalId: end.childRootActionId, activityId: end.activityId });
    const notice = { kind: 'acquireSensoryEvidence', proposalId: `${f.rootActionId}:notice`, characterId: ACTOR,
      factId: `fact:${review.childRootActionId}`, sense: 'sight', clarity: 'obvious', publicEvidence: '已亲自核对收到的完整副本。' };
    const informed = commit(f, rested.state, notice);
    assert.equal(informed.receipt.rootActionId, notice.proposalId);
    assert.equal(f.runtime.project(f.profiles, informed.state, f.viewer).promises[0].status, 'fulfilled');
    const npc = f.runtime.project(f.profiles, informed.state, { kind: 'npc', npcId: NPC, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' });
    assert.equal(npc.promises[0].status, 'active', 'learning is holder-specific');
    const repeated = f.runtime.step(f.profiles, informed.state, notice);
    assert.equal(repeated.kind, 'rejected'); assert.deepEqual(repeated.events, []);
    assert.equal(Object.values(informed.state.knowledge[ACTOR]).filter(k => k.knowledgeRef === notice.factId).length, 1);
    assert.deepEqual(f.runtime.replay(f.genesis, [...journal, ...elapsedRest.events, ...rested.events, ...informed.events]).state, informed.state);
  }
  assert.deepEqual(f.runtime.replay(f.genesis, journal).state, settled.state);
});

test('NPC ownership is not custody and cannot reveal a hidden new item or substitute for acquisition', () => {
  for (const hidden of [false, true]) {
    const f = promiseFixture(`ownership-custody:${hidden}`), formed = f.runtime.step(f.profiles, f.state, makePromiseInput(f));
    const due = dueWork(f, formed.state).find(d => d.npcWork);
    const request = prepareNpcWorkRequest(formed.state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcWork.planId);
    const bundle = objectBundle();
    bundle.proposals[1].ownership = { kind: 'character', ownerRef: NPC };
    if (hidden) bundle.proposals[1].visibilityPolicyRef = 'visibility:hidden-until-evidence';
    else bundle.proposals.splice(2, 1);
    const input = npcWorkRulesInput(toolResponse(bundle), request, formed.state, f.profiles);
    const rejected = f.runtime.step(f.profiles, formed.state, input);
    assert.equal(rejected.kind, 'rejected');
    assert.equal(rejected.rejection.message, hidden ? 'inventoryReferenceUnavailable' : 'inventoryRecipientUnavailable');
    assert.deepEqual(rejected.events, []);
  }
});

test('an ongoing promise uses the same terms and needs no invented due activity', () => {
  const f = promiseFixture('ongoing'), result = f.runtime.step(f.profiles, f.state, makePromiseInput(f, f.state, {
    content: '今晚为我保密。', due: 'nextDawn', nextStep: null, terms: { kind: 'ongoing', subjectRefs: [NPC], delivery: null },
  }));
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.equal(Object.values(result.state.campaignRuntime.promises)[0].lifecycle.terms.kind, 'ongoing');
  assert.deepEqual(dueWork(f, result.state), []);
  const player = f.runtime.project(f.profiles, result.state, f.viewer);
  assert.equal(player.kind, 'projected'); assert.equal(player.promises[0].status, 'active');
  assert.deepEqual(f.runtime.replay(f.genesis, result.events).state, result.state);
});

test('ongoing secrecy reaches its independent deadline without an NPC activity and only explicit settled-period truth can fulfill it', () => {
  const f = promiseFixture('secrecy-period'), journal = [];
  const promised = commit(f, f.state, makePromiseInput(f, f.state, { content: '今晚为我保密。', due: 'nextDawn', nextStep: null,
    terms: { kind: 'ongoing', subjectRefs: [NPC], delivery: null } })); journal.push(...promised.events);
  const rest = commit(f, promised.state, { kind: 'startRest', proposalId: `${f.rootActionId}:rest`, characterId: ACTOR, restKind: 'long' }); journal.push(...rest.events);
  const advance = dueWork(f, rest.state).find(d => d.activityProgress?.phase === 'advance'); assert.ok(advance);
  const elapsed = commit(f, rest.state, { kind: 'advanceActivity', proposalId: advance.childRootActionId, activityId: advance.activityId }); journal.push(...elapsed.events);
  const { frame } = reviewFrame(f, elapsed.state);
  assert.equal(frame.throughFictionMicros, frame.deadlineFictionMicros);
  for (const outcome of ['fulfilled', 'breached']) {
    const rejected = f.runtime.step(f.profiles, elapsed.state, reviewInput(f, elapsed.state,
      { outcome, reason: '不能从空记录推导期间行为。', evidenceRefs: frame.evidence.map(e => e.eventId), remaining: outcome === 'breached' }));
    assert.equal(rejected.kind, 'rejected', JSON.stringify(rejected)); assert.deepEqual(rejected.events, []);
  }
  const pending = commit(f, elapsed.state, reviewInput(f, elapsed.state,
    { outcome: 'unchanged', reason: '缺少决定性期间事实，保留原义务。', evidenceRefs: [], remaining: true })); journal.push(...pending.events);
  assert.equal(dueWork(f, pending.state).filter(d => d.promiseReview).length, 0, 'unchanged cannot trigger itself');
  const continuation = dueWork(f, pending.state).find(d => d.activityProgress?.phase === 'advance'); assert.ok(continuation);
  const later = commit(f, pending.state, { kind: 'advanceActivity', proposalId: continuation.childRootActionId, activityId: continuation.activityId }); journal.push(...later.events);
  const completion = dueWork(f, later.state).find(d => d.activityProgress?.phase === 'complete'); assert.ok(completion);
  const rested = commit(f, later.state, { kind: 'completeActivity', proposalId: completion.childRootActionId, activityId: completion.activityId }); journal.push(...rested.events);
  const coverage = { timelineId: frame.timelineId, fromFictionMicros: frame.fromFictionMicros, throughFictionMicros: frame.deadlineFictionMicros, subjectRefs: [NPC] };
  const future = f.runtime.step(f.profiles, rested.state, historyInput(f, rested.state, { ...coverage, throughFictionMicros: String(BigInt(rested.state.fictionTimelines[frame.timelineId].nowMicros) + 1n) }));
  assert.equal(future.kind, 'rejected', JSON.stringify({ kind: future.kind, rejection: future.rejection })); assert.deepEqual(future.events, []);
  const history = commit(f, rested.state, historyInput(f, rested.state, coverage)); journal.push(...history.events);
  const { frame: complete } = reviewFrame(f, history.state);
  const fact = complete.facts.find(fact => fact.historyCoverage); assert.ok(fact);
  const settled = commit(f, history.state, reviewInput(f, history.state,
    { outcome: 'fulfilled', reason: '已固化的期间事实覆盖全程，按原约完成保密。', evidenceRefs: [fact.id], remaining: false })); journal.push(...settled.events);
  assert.equal(settled.state.campaignRuntime.promises[complete.promiseId].status, 'fulfilled');
  assert.deepEqual(f.runtime.replay(f.genesis, journal).state, settled.state);
});

test('a real early disclosure breaches the same ongoing promise while retaining the remaining obligation', () => {
  const f = promiseFixture('secrecy-disclosed');
  const promised = commit(f, f.state, makePromiseInput(f, f.state, { content: '今晚不对别人透露这个秘密。', due: 'nextDawn', nextStep: null,
    terms: { kind: 'ongoing', subjectRefs: [NPC, `knowledge:${NPC}:knowledge:secret`], delivery: null } }));
  const shared = commit(f, promised.state, { kind: 'shareKnowledge', proposalId: `${f.rootActionId}:disclose`, senderCharacterId: NPC,
    recipientEntityIds: ['character:probe-target'], knowledgeRefs: ['knowledge:secret'], medium: '当面告知', contentLayer: 'full' });
  const { frame } = reviewFrame(f, shared.state), evidence = frame.evidence.filter(e => e.eventType === 'KnowledgeAcquired');
  assert.ok(evidence.length); assert.ok(BigInt(frame.throughFictionMicros) < BigInt(frame.deadlineFictionMicros));
  const settled = commit(f, shared.state, reviewInput(f, shared.state, { outcome: 'breached', reason: '期限内已经向第三人实际透露秘密，仍应停止继续泄密。',
    evidenceRefs: evidence.map(e => e.eventId), remaining: true }));
  const promise = settled.state.campaignRuntime.promises[frame.promiseId];
  assert.equal(promise.status, 'breached'); assert.equal(promise.lifecycle.obligation, 'outstanding');
  assert.equal(f.runtime.project(f.profiles, settled.state, f.viewer).promises[0].status, 'active');
  assert.deepEqual(f.runtime.replay(f.genesis, [...promised.events, ...shared.events, ...settled.events]).state, settled.state);
});

test('NPC testimony, prewritten trace and a missing item cannot substitute for delivery or prove non-delivery', () => {
  for (const evidenceKind of ['testimony', 'trace']) for (const deliveryRequired of [true, false]) {
    const f = promiseFixture(`false-outcome:${evidenceKind}:${deliveryRequired}`), promised = commit(f, f.state, makePromiseInput(f, f.state, {
      nextStep: null, ...(deliveryRequired ? {} : { terms: { kind: 'result', subjectRefs: [NPC], delivery: null } }),
    }));
    const root = `${f.rootActionId}:claim`, stated = commit(f, promised.state, evidenceKind === 'testimony'
      ? { kind: 'createSourceClaim', proposalId: root, speakerId: NPC, claimId: 'claim:done', semanticContent: '副本已交付完毕。',
          sourceBasis: '自己的说法。', motive: '希望对方相信。', formedAtFictionMicros: '0' }
      : { kind: 'declareCanonicalFact', proposalId: root, fact: { factId: 'fact:trace', factKind: 'npcPlanTrace', subjectRefs: [NPC, SCENE],
          value: { description: '台面上留下了交付痕迹。' }, source: 'npcOrFactionAction', causalParentIds: [], visibilityPolicy: 'hiddenUntilEvidence' } });
    const { frame } = reviewFrame(f, stated.state), refs = [...frame.evidence.map(e => e.eventId), ...frame.facts.map(f => f.id)];
    for (const outcome of ['fulfilled', 'breached']) {
      const rejected = f.runtime.step(f.profiles, stated.state, reviewInput(f, stated.state,
        { outcome, reason: '仅有说法或痕迹。', evidenceRefs: refs, remaining: outcome === 'breached' }));
      assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
    }
    const unavailable = f.runtime.step(f.profiles, stated.state, reviewInput(f, stated.state,
      { outcome: 'fulfilled', reason: '试图引用不存在的副本。', evidenceRefs: ['item:missing'], remaining: false }));
    assert.equal(unavailable.kind, 'rejected'); assert.deepEqual(unavailable.events, []);
    assert.deepEqual(stated.state.campaignRuntime.itemSystem, f.state.campaignRuntime.itemSystem);
  }
  const f = promiseFixture('old-trace-shape'), command = makePromiseInput(f);
  command.plan.social.branches.success.consequences[0].trace = '已经完成的痕迹';
  const rejected = f.runtime.step(f.profiles, f.state, command);
  assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
  const promised = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null }));
  const promise = Object.values(promised.state.campaignRuntime.promises)[0];
  const forged = f.runtime.step(f.profiles, promised.state, { kind: 'declareCanonicalFact', proposalId: `${f.rootActionId}:forged-verdict`,
    fact: { factId: 'fact:forged-verdict', factKind: 'promiseReviewResult', subjectRefs: [NPC, ACTOR].sort(),
      value: { promiseId: promise.promiseId, outcome: 'fulfilled', remaining: false }, source: 'mechanicalResolution', causalParentIds: [], visibilityPolicy: 'public' } });
  assert.equal(forged.kind, 'rejected'); assert.deepEqual(forged.events, []);
});

test('another scene can reach its future without advancing or supplying decisive evidence for this promise', () => {
  const remoteActor = 'character:probe-target', remoteScene = 'scene:remote';
  const f = promiseFixture('separate-timeline', { additionalScenes: [{ id: remoteScene, name: '另一处地点' }], characterScenes: { [remoteActor]: remoteScene } });
  const promised = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null, terms: { kind: 'ongoing', subjectRefs: [NPC], delivery: null } }));
  const remote = commit(f, promised.state, { kind: 'resolveFreeAction', proposalId: `${f.rootActionId}:remote-time`, characterId: remoteActor,
    goal: '在远处整理资料。', method: '处理两小时的整理工作。', feasibility: { kind: 'directSuccess', publicBasis: '没有不确定性。' },
    outcome: { fictionTimeCostMicros: '7200000000' } });
  const ownTimeline = characterTimelineId(remote.state, NPC), otherTimeline = characterTimelineId(remote.state, remoteActor);
  assert.notEqual(ownTimeline, otherTimeline);
  assert.equal(remote.state.fictionTimelines[ownTimeline].nowMicros, '0');
  assert.equal(remote.state.fictionTimelines[otherTimeline].nowMicros, '7200000000');
  const history = commit(f, remote.state, historyInput({ ...f, actorCharacterId: remoteActor }, remote.state, {
    timelineId: otherTimeline, fromFictionMicros: '0', throughFictionMicros: '7200000000', subjectRefs: [remoteScene],
  }));
  const remoteFact = history.events.find(e => e.eventType === 'CanonicalFactDeclared'); assert.ok(remoteFact);
  assert.equal(remoteFact.fictionTimelineId, otherTimeline);
  assert.equal(dueWork(f, history.state).filter(d => d.promiseReview).length, 0);
  const claim = commit(f, history.state, { kind: 'createSourceClaim', proposalId: `${f.rootActionId}:local-claim`, speakerId: NPC,
    claimId: 'claim:local', semanticContent: '我会继续守约。', sourceBasis: '当前意愿。', motive: '回应对方。', formedAtFictionMicros: '0' });
  const { frame } = reviewFrame(f, claim.state);
  assert.equal(frame.throughFictionMicros, '0'); assert.equal(frame.facts.length, 0);
  for (const outcome of ['fulfilled', 'breached']) {
    const rejected = f.runtime.step(f.profiles, claim.state, reviewInput(f, claim.state, { outcome, reason: '试图借别处未来的记录提前裁定。',
      evidenceRefs: [remoteFact.eventId, remoteFact.payload.fact.id], remaining: outcome === 'breached' }));
    assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
  }
  const pending = commit(f, claim.state, reviewInput(f, claim.state, { outcome: 'unchanged', reason: '本地没有决定性证据。', evidenceRefs: [], remaining: true }));
  assert.ok(pending.events.every(e => e.fictionTimelineId === ownTimeline && e.fictionInstantMicros === '0'));
  assert.deepEqual(f.runtime.replay(f.genesis, [...promised.events, ...remote.events, ...history.events, ...claim.events, ...pending.events]).state, pending.state);
});

test('ordinary NPC inventory uses real entries for receipt and release, without creating combat equipment or allowing foreign-held taking', () => {
  const f = promiseFixture('ordinary-inventory', { npcCharacters: [{ id: NPC, name: '普通文书员', mechanical: false }] });
  const root = `${f.rootActionId}:item`, context = freezeAuthoredProbeContext(f, f.state, { rootActionId: root, focusRefs: [SCENE] }).context;
  const seeded = lowerVNext2ProposalBundle({ ...f, rootActionId: root, requiredContext: context, value: objectBundle({ original: true }) });
  assert.equal(seeded.kind, 'accepted');
  const original = commit(f, f.state, seeded.command.rulesInput), itemRef = Object.keys(original.state.campaignRuntime.itemSystem.entries)[0];
  const inventory = (state, suffix, actor, operation) => ({ kind: 'inventoryOperation', rootActionId: `${f.rootActionId}:${suffix}`, actorCharacterId: actor,
    plan: { schema: 'zhuwei.inventory-operation-plan/vnext-1', contextHash: canonicalSha256({ suffix }), basisRefs: [SCENE], summary: '实际拿取和交接文稿。', operation,
      readSet: [...new Set([actor, itemRef, SCENE, operation.targetCharacterRef].filter(Boolean))].map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })) } });
  const taken = commit(f, original.state, inventory(original.state, 'take', ACTOR, { kind: 'acquire', entryRef: itemRef, quantity: 1 }));
  const stolen = f.runtime.step(f.profiles, taken.state, inventory(taken.state, 'steal', NPC, { kind: 'acquire', entryRef: itemRef, quantity: 1 }));
  assert.equal(stolen.kind, 'rejected'); assert.deepEqual(stolen.events, []);
  const received = commit(f, taken.state, inventory(taken.state, 'receive', ACTOR, { kind: 'transfer', entryRef: itemRef, quantity: 1, targetCharacterRef: NPC, ownershipDisposition: 'preserve' }));
  assert.equal(received.state.entities[NPC].loadout, undefined);
  const equipped = f.runtime.step(f.profiles, received.state, inventory(received.state, 'equip', NPC, { kind: 'equip', entryRef: itemRef, action: 'wear', slot: 'main' }));
  assert.equal(equipped.kind, 'rejected'); assert.deepEqual(equipped.events, []);
  const placed = commit(f, received.state, inventory(received.state, 'release', NPC, { kind: 'release', entryRef: itemRef, quantity: 1, sceneRef: SCENE, releaseKind: 'placement' }));
  assert.equal(placed.state.campaignRuntime.itemSystem.entries[itemRef].sceneRef, SCENE);
  assert.equal(placed.state.entities[NPC].loadout, undefined);
  assert.deepEqual(f.runtime.replay(f.genesis, [...original.events, ...taken.events, ...received.events, ...placed.events]).state, placed.state);
});

test('correcting an actual disclosure removes its derived review evidence, and replay cannot revive that evidence', () => {
  const f = promiseFixture('corrected-evidence'), promised = commit(f, f.state, makePromiseInput(f, f.state, { due: 'nextDawn', nextStep: null,
    terms: { kind: 'ongoing', subjectRefs: [NPC], delivery: null } }));
  const shared = commit(f, promised.state, { kind: 'shareKnowledge', proposalId: `${f.rootActionId}:disclose`, senderCharacterId: NPC,
    recipientEntityIds: ['character:probe-target'], knowledgeRefs: ['knowledge:secret'], medium: '当面告知', contentLayer: 'full' });
  const stale = reviewInput(f, shared.state, { outcome: 'breached', reason: '曾据错误传播记录判断。',
    evidenceRefs: reviewFrame(f, shared.state).frame.evidence.map(e => e.eventId), remaining: true });
  const replay = f.runtime.replay(f.genesis, [...promised.events, ...shared.events]); assert.equal(replay.kind, 'replayed');
  const corrected = commit(f, shared.state, { kind: 'applyServiceCorrection',
    correctionAuthority: { kind: 'roomCorrectionAuthority', capability: shared.state.correctionRuntime.authorityCapability },
    correctionId: 'correction:disclosure', targetReceiptId: shared.receipt.receiptId, actorCharacterId: 'character:probe-target',
    errorKind: 'rulesMisapplication', publicExplanation: '撤销错误的传播记录。', basis: { stateHash: replay.head.stateHash, eventHash: replay.head.eventHash } });
  assert.deepEqual(Object.values(corrected.state.campaignRuntime.promises)[0].lifecycle.evidence, []);
  assert.equal(f.runtime.step(f.profiles, corrected.state, stale).kind, 'rejected');
  assert.deepEqual(f.runtime.replay(f.genesis, [...promised.events, ...shared.events, ...corrected.events]).state, corrected.state);
});


const firstPromise = state => Object.values(state.campaignRuntime.promises)[0];
function actualFact(f, state, suffix, content, subjects = [NPC]) {
  return commit(f, state, { kind: 'declareCanonicalFact', proposalId: `${f.rootActionId}:${suffix}`, fact: {
    factId: `fact:${suffix}`, factKind: 'committedConduct', subjectRefs: subjects.sort(), value: { description: content },
    source: 'observedEvent', causalParentIds: [], visibilityPolicy: 'hiddenUntilEvidence' } });
}

test('player-authored undertakings and NPC-to-NPC undertakings use the same source-bound social path; acceptance cannot fabricate the player guarantee', () => {
  for (const promisor of ['actor', 'npc']) {
    const f = promiseFixture(`direction:${promisor}`), expression = '我会试着把消息带到。';
    const input = makePromiseInput(f, f.state, { promisor, expression, content: expression, nextStep: null,
      terms: { kind: 'attempt', subjectRefs: [NPC, ACTOR], delivery: null } });
    const formed = commit(f, f.state, input);
    assert.equal(firstPromise(formed.state).promisorId, promisor === 'actor' ? ACTOR : NPC);
    assert.deepEqual(f.runtime.replay(f.genesis, formed.events).state, formed.state);
    if (promisor === 'actor') {
      const forged = structuredClone(input); forged.plan.social.playerExpression = '好，我知道你的条件了。'; forged.plan.intent = forged.plan.social.playerExpression;
      const rejected = f.runtime.step(f.profiles, f.state, forged); assert.equal(rejected.kind, 'rejected'); assert.deepEqual(rejected.events, []);
    }
  }
});

test('an NPC can make its own promise to another real NPC listener without binding the player', () => {
  const otherNpc = 'npc:promise-recipient', f = promiseFixture('npc-to-npc', { npcCharacters: [{ id: NPC, name: '甲' }, { id: otherNpc, name: '乙' }] });
  const input = makePromiseInput(f, f.state, { promisee: otherNpc, nextStep: null, terms: { kind: 'attempt', subjectRefs: [NPC, otherNpc], delivery: null } });
  input.plan.social.audience = 'sceneListeners';
  input.plan.social.listeners = Object.keys(f.state.entities).sort();
  const result = commit(f, f.state, input), p = firstPromise(result.state);
  assert.equal(p.promisorId, NPC); assert.equal(p.promiseeId, otherNpc);
  assert.equal(f.runtime.project(f.profiles, result.state, f.viewer).promises.length, 0);
  assert.equal(f.runtime.project(f.profiles, result.state, { kind: 'npc', npcId: otherNpc, purpose: 'kpDecision', capability: 'internal:npc-limited-knowledge' }).promises[0].promiseId, p.promiseId);
  assert.deepEqual(f.runtime.replay(f.genesis, result.events).state, result.state);
});

test('accepted and declined extensions, method changes and secret amendments retain their exact versions and holder-specific knowledge', () => {
  for (const accepted of [true, false]) for (const disclose of [true, false]) {
    const f = promiseFixture(`amend:${accepted}:${disclose}`), formed = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null }));
    const old = firstPromise(formed.state), changed = commit(f, formed.state, next => changePromiseInput(f, next, old, { disclose,
      change: { accepted, content: 'SECRET_NEW_DELIVERY_TERMS', deadlineFictionMicros: '7200000000' } }));
    const p = firstPromise(changed.state);
    assert.equal(p.lifecycle.revision, accepted ? '2' : '1'); assert.equal(p.lifecycle.changes.length, 1);
    assert.equal(p.lifecycle.versions[0].content, old.content);
    const view = f.runtime.project(f.profiles, changed.state, f.viewer);
    assert.equal(view.promises[0].content, accepted && disclose ? 'SECRET_NEW_DELIVERY_TERMS' : old.content);
    if (!disclose) assert.doesNotMatch(JSON.stringify(view.promises), /SECRET_NEW_DELIVERY_TERMS/);
    assert.deepEqual(f.runtime.replay(f.genesis, [...formed.events, ...changed.events]).state, changed.state);
  }
  const f = promiseFixture('method'), formed = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null })), p = firstPromise(formed.state);
  const changed = commit(f, formed.state, next => changePromiseInput(f, next, p, { change: { kind: 'method', terms: null, deadlineFictionMicros: p.lifecycle.deadlineFictionMicros } }));
  assert.equal(firstPromise(changed.state).lifecycle.revision, '1');
  const forged = f.runtime.step(f.profiles, formed.state, changePromiseInput(f, formed.state, p, { change: { remaining: false } }));
  assert.equal(forged.kind, 'rejected'); assert.deepEqual(forged.events, []);
});

test('refusal, partial release and extension after breach preserve remaining duties and the actual breach history', () => {
  const f = promiseFixture('history-changes'), terms = { kind: 'result', subjectRefs: [NPC], delivery: null,
    parts: ['first', 'second'].map(partId => ({ partId, kind: 'attempt', content: `尝试${partId}`, subjectRefs: [NPC], delivery: null })) };
  const formed = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null, terms })); let p = firstPromise(formed.state);
  const refused = commit(f, formed.state, next => changePromiseInput(f, next, p, { root: `${f.rootActionId}:refusal`, speech: '我拒绝继续。',
    change: { kind: 'refusal', terms: null, deadlineFictionMicros: p.lifecycle.deadlineFictionMicros, reason: '明确拒绝，原义务仍适用。' } })); p = firstPromise(refused.state);
  assert.equal(p.status, 'breached'); assert.equal(p.lifecycle.obligation, 'outstanding');
  const quietRefused = settleUnchanged(f, refused);
  const extended = commit(f, quietRefused.state, next => changePromiseInput(f, next, p, { root: `${f.rootActionId}:extension` })); p = firstPromise(extended.state);
  assert.equal(p.lifecycle.history.filter(h => h.outcome === 'breached').length, 1);
  const quietExtended = settleUnchanged(f, extended);
  const released = commit(f, quietExtended.state, next => changePromiseInput(f, next, p, { root: `${f.rootActionId}:release`, source: 'actor',
    change: { kind: 'release', terms: null, deadlineFictionMicros: p.lifecycle.deadlineFictionMicros, releasedParts: ['first'] } })); p = firstPromise(released.state);
  assert.deepEqual(p.lifecycle.releasedParts, ['first']); assert.equal(p.lifecycle.obligation, 'outstanding');
  const quietReleased = settleUnchanged(f, released);
  const attempt = actualFact(f, quietReleased.state, 'attempt', '已经按生效条款真实尝试剩余一项。');
  const fulfilled = commit(f, attempt.state, reviewInput(f, attempt.state, { outcome: 'fulfilled', completedParts: ['second'], remaining: false,
    reason: '第一项已免除，第二项真实尝试已完成。', evidenceRefs: ['fact:attempt'] })); p = firstPromise(fulfilled.state);
  assert.equal(p.status, 'fulfilled'); assert.ok(p.lifecycle.history.some(h => h.outcome === 'breached'));
  assert.deepEqual(f.runtime.replay(f.genesis, [formed, quietRefused, quietExtended, quietReleased, attempt, fulfilled].flatMap(r => r.events)).state, fulfilled.state);
});

test('conditional obligations require actual activation and, when stated, the promisor knowledge; a closed unmet window is not a breach', () => {
  const f = promiseFixture('conditions'), formed = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null, terms: {
    kind: 'attempt', subjectRefs: [NPC], delivery: null, activation: { content: '收到并知道介绍信已提交后。', subjectRefs: [NPC], requiresKnowledge: true, windowEndFictionMicros: '3600000000' } } }));
  const submitted = actualFact(f, formed.state, 'condition', '介绍信已真实提交。');
  const judge = { outcome: 'conditionMet', reason: '条件发生。', evidenceRefs: ['fact:condition'], remaining: true };
  assert.equal(f.runtime.step(f.profiles, submitted.state, reviewInput(f, submitted.state, judge)).kind, 'rejected');
  const quietSubmitted = settleUnchanged(f, submitted);
  const learned = commit(f, quietSubmitted.state, { kind: 'acquireSensoryEvidence', proposalId: `${f.rootActionId}:learn`, characterId: NPC,
    factId: 'fact:condition', sense: 'sight', clarity: 'obvious', publicEvidence: '亲眼核对介绍信。' });
  const activated = commit(f, learned.state, reviewInput(f, learned.state, judge));
  assert.equal(firstPromise(activated.state).lifecycle.conditionStatus, 'met');
  assert.deepEqual(f.runtime.replay(f.genesis, [formed, quietSubmitted, learned, activated].flatMap(r => r.events)).state, activated.state);
  const g = promiseFixture('unmet-window'), pending = commit(g, g.state, makePromiseInput(g, g.state, { nextStep: null, terms: {
    kind: 'result', subjectRefs: [NPC], delivery: null, activation: { content: '提交介绍信才生效。', subjectRefs: [NPC], requiresKnowledge: false, windowEndFictionMicros: '3600000000' } } }));
  const elapsed = commit(g, pending.state, { kind: 'resolveFreeAction', proposalId: `${g.rootActionId}:elapsed`, characterId: ACTOR, goal: '处理其他事情。', method: '整理资料。',
    feasibility: { kind: 'directSuccess', publicBasis: '没有不确定性。' }, outcome: { fictionTimeCostMicros: '3600000000' } });
  const { frame } = reviewFrame(g, elapsed.state);
  const quietElapsed = settleUnchanged(g, elapsed);
  const covered = commit(g, quietElapsed.state, historyInput(g, quietElapsed.state, { timelineId: frame.timelineId, fromFictionMicros: '0', throughFictionMicros: '3600000000', subjectRefs: [NPC] }));
  const fact = reviewFrame(g, covered.state).frame.facts.find(f => f.historyCoverage);
  const ended = commit(g, covered.state, reviewInput(g, covered.state, { outcome: 'conditionUnmet', reason: '窗口内约定条件未成就。', evidenceRefs: [fact.id], remaining: false }));
  assert.equal(firstPromise(ended.state).status, 'conditionUnmet');
  assert.ok(!firstPromise(ended.state).lifecycle.history.some(h => h.outcome === 'breached'));
});

function settleUnchanged(f, result) {
  let state = result.state; const events = [...result.events];
  while (dueWork(f, state).some(d => d.promiseReview)) {
    const next = commit(f, state, reviewInput(f, state, { outcome: 'unchanged', reason: '当前事实没有另行结清义务。', evidenceRefs: [], remaining: true }));
    state = next.state; events.push(...next.events);
  }
  return { ...result, state, events };
}

test('NPC defer, revise and cancel keep the same durable work identity and never rewrite the obligation', () => {
  const f = promiseFixture('work-decisions'), formed = commit(f, f.state, makePromiseInput(f));
  const choose = (state, decision) => {
    const due = dueWork(f, state).find(d => d.npcWork); assert.ok(due);
    const request = prepareNpcWorkRequest(state, f.profiles, f.moduleProfile, due.childRootActionId, due.npcWork.planId);
    const response = { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_npc_work_decision', arguments: JSON.stringify({ ...decision, wakeAtFictionMicros: decision.wakeAtFictionMicros ?? { kind: 'none' } }) } }] } }] };
    return commit(f, state, npcWorkRulesInput(response, request, state, f.profiles));
  };
  const deferred = choose(formed.state, { kind: 'defer', reason: '等待材料送来。', nextStep: '材料到来后开始抄写。', wakeAtFictionMicros: '1800000000' });
  assert.equal(dueWork(f, deferred.state).filter(d => d.npcWork).length, 0);
  const rest = commit(f, deferred.state, { kind: 'startRest', proposalId: `${f.rootActionId}:rest`, characterId: ACTOR, restKind: 'long' });
  const due = dueWork(f, rest.state).find(d => d.activityProgress?.phase === 'advance');
  const advanced = commit(f, rest.state, { kind: 'advanceActivity', proposalId: due.childRootActionId, activityId: due.activityId });
  assert.equal(advanced.state.fictionTimelines[due.timelineId].nowMicros, '1800000000');
  const revised = choose(advanced.state, { kind: 'revise', reason: '可以先整理原件。', nextStep: '先按页次整理原件再抄写。', wakeAtFictionMicros: null });
  const cancelled = choose(revised.state, { kind: 'cancel', reason: '取消这条方法，义务另行处理。', nextStep: '暂不执行。', wakeAtFictionMicros: null });
  assert.equal(dueWork(f, cancelled.state).filter(d => d.npcWork).length, 0);
  assert.deepEqual(firstPromise(cancelled.state).lifecycle, firstPromise(formed.state).lifecycle);
  assert.equal(firstPromise(cancelled.state).status, 'active');
  assert.deepEqual(f.runtime.replay(f.genesis, [formed, deferred, rest, advanced, revised, cancelled].flatMap(r => r.events)).state, cancelled.state);
});

test('two delivery parts share actual inventory evidence, preserve partial progress and cannot claim the remaining part early', () => {
  const f = promiseFixture('partial-delivery'), targets = [NPC, 'character:probe-target'];
  const formed = commit(f, f.state, makePromiseInput(f, f.state, { due: 'none', nextStep: null,
    terms: { kind: 'result', subjectRefs: targets, delivery: null, parts: targets.map((destinationRef, i) => ({
      partId: `copy-${i}`, content: '给这位接收人一份副本。', kind: 'result', subjectRefs: [destinationRef],
      delivery: { sourceRef: null, itemRef: null, quantity: 1, destinationKind: 'holder', destinationRef } })) } }));
  let state = formed.state; const journal = [...formed.events];
  for (let i = 0; i < targets.length; i++) {
    const root = `${f.rootActionId}:deliver-${i}`;
    const context = freezeAuthoredProbeContext(f, state, { rootActionId: root, focusRefs: [targets[i], SCENE] }).context;
    const lowered = lowerVNext2ProposalBundle({ ...f, state, rootActionId: root, requiredContext: context,
      value: objectBundle({ actor: ACTOR, destination: targets[i], duration: '300000000' }) });
    assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
    let delivered = commit(f, state, lowered.command.rulesInput); journal.push(...delivered.events); state = delivered.state;
    const activityId = `activity:${root}`;
    for (let step = 0; state.campaignRuntime.activities[activityId]?.status === 'active' && step < 3; step++) {
      const due = dueWork(f, state).find(d => d.activityId === activityId); assert.ok(due);
      delivered = commit(f, state, { kind: due.activityProgress?.phase === 'complete' ? 'completeActionActivity' : 'advanceActivity', proposalId: due.childRootActionId, activityId });
      journal.push(...delivered.events); state = delivered.state;
    }
    const { frame } = reviewFrame(f, state), evidence = frame.evidence.filter(e => e.itemsAfter.some(item => item.holderRef === targets[i]));
    const refs = [...evidence.map(e => e.eventId), ...evidence.flatMap(e => e.itemsAfter.map(i => i.entryId))];
    if (i === 0) assert.equal(f.runtime.step(f.profiles, state, reviewInput(f, state, { outcome: 'fulfilled', completedParts: ['copy-0'], remaining: false,
      reason: '错误地声称两份都交了。', evidenceRefs: [...new Set(refs)] })).kind, 'rejected');
    const reviewed = commit(f, state, reviewInput(f, state, { outcome: i === 0 ? 'progressed' : 'fulfilled', completedParts: [`copy-${i}`], remaining: i === 0,
      reason: '依据实际接收者逐项核对。', evidenceRefs: [...new Set(refs)] })); journal.push(...reviewed.events); state = reviewed.state;
    assert.equal(firstPromise(state).lifecycle.completedParts.length, i + 1);
    assert.equal(firstPromise(state).lifecycle.obligation, i === 0 ? 'outstanding' : 'satisfied');
  }
  assert.deepEqual(f.runtime.replay(f.genesis, journal).state, state);
});

test('multiple obligations at the same frontier produce one bounded, all-or-nothing review and no unchanged hot loop', () => {
  const f = promiseFixture('review-batch'), input = makePromiseInput(f, f.state, { nextStep: null, terms: { kind: 'ongoing', subjectRefs: [NPC], delivery: null } });
  for (const branch of Object.values(input.plan.social.branches)) branch.consequences.push({ ...structuredClone(branch.consequences[0]), content: '另一项保密义务。' });
  const formed = commit(f, f.state, input);
  const claim = commit(f, formed.state, { kind: 'createSourceClaim', proposalId: `${f.rootActionId}:claim`, speakerId: NPC, claimId: 'claim:batch', semanticContent: '我仍然记得约定。',
    sourceBasis: '当前意愿。', motive: '说明。', formedAtFictionMicros: '0' });
  const due = dueWork(f, claim.state).filter(d => d.promiseReview); assert.equal(due.length, 1); assert.equal(due[0].promiseReview.promiseIds.length, 2);
  const projected = f.runtime.project(f.profiles, claim.state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' }, { promiseReviewBatchFor: due[0].promiseReview.promiseIds });
  assert.equal(projected.promiseReview.schema, 'zhuwei.promise-review-batch/vnext-1');
  const reviews = projected.promiseReview.frames.map(frame => ({ promiseId: frame.promiseId,
    judgment: { outcome: 'unchanged', reason: '没有结果依据。', evidenceRefs: [], remaining: true } }));
  const command = { kind: 'resolvePromiseReview', proposalId: due[0].childRootActionId, promiseId: due[0].promiseReview.promiseId,
    frameHash: projected.projectionHash, judgment: reviews };
  assert.equal(f.runtime.step(f.profiles, claim.state, { ...command, judgment: [reviews[0], reviews[0]] }).kind, 'rejected');
  const reviewed = commit(f, claim.state, command);
  assert.equal(reviewed.events.filter(e => e.eventType === 'PromiseReviewed').length, 2);
  assert.equal(dueWork(f, reviewed.state).filter(d => d.promiseReview).length, 0);
  assert.deepEqual(f.runtime.replay(f.genesis, [formed, claim, reviewed].flatMap(r => r.events)).state, reviewed.state);
});

test('chapter continuity, explicitly scoped succession and correction preserve obligations and never revive released parts', () => {
  for (const released of [false, true]) {
    const f = promiseFixture(`succession:${released}`), expression = '我承诺尽力完成这件事。';
    const formed = commit(f, f.state, makePromiseInput(f, f.state, { promisor: 'actor', expression, content: expression, nextStep: null, due: 'none',
      terms: { kind: 'attempt', subjectRefs: [ACTOR, NPC], delivery: null } }));
    let state = formed.state; const journal = [...formed.events];
    if (released) {
      const changed = settleUnchanged(f, commit(f, state, next => changePromiseInput(f, next, firstPromise(next), { change: { kind: 'release', terms: null, deadlineFictionMicros: null, remaining: false } })));
      state = changed.state; journal.push(...changed.events);
    }
    const p = firstPromise(state), campaign = state.campaignRuntime.campaign, chapter = state.campaignRuntime.chapters[campaign.currentChapterId];
    const transitioned = commit(f, state, { kind: 'transitionChapter', proposalId: `${f.rootActionId}:chapter`, campaignId: campaign.campaignId,
      fromChapterId: campaign.currentChapterId, toChapterId: 'chapter:next', ordinal: String(BigInt(chapter.ordinal) + 1n), reason: '阶段目标结束。',
      continuityPolicy: 'preserveAuthoritativeFacts', storyAnchorRefs: [], sceneQuestion: '接下来怎样处理约定？', activityTransitions: [] });
    assert.deepEqual(firstPromise(transitioned.state).lifecycle, p.lifecycle); journal.push(...transitioned.events);
    const retired = commit(f, transitioned.state, { kind: 'retireCharacter', proposalId: `${f.rootActionId}:retire`, characterId: ACTOR, reason: '主动退场。', continueAsNpc: false }); journal.push(...retired.events);
    const next = 'character:probe-target';
    const automatic = f.runtime.step(f.profiles, retired.state, { kind: 'transferInheritance', proposalId: `${f.rootActionId}:automatic`, predecessorCharacterId: ACTOR,
      successorCharacterId: next, sourceFactId: 'fact:not-authorized', authorizationId: 'authorization:not-authorized' });
    assert.equal(automatic.kind, 'rejected'); assert.deepEqual(automatic.events, []);
    const source = commit(f, retired.state, { kind: 'establishInheritanceSource', proposalId: `${f.rootActionId}:scope`, predecessorCharacterId: ACTOR, successorCharacterId: next,
      source: { kind: 'explicitGift', publicClause: '明确由接任者承接这项约定实际仍存在的义务。', authorizations: [{ authorizationId: 'authorization:promise', subjectCharacterId: ACTOR,
        kind: 'promise', sourceRef: p.promiseId, targetCharacterId: next, targetRef: 'promise:successor', scope: 'assumePromiseObligation' }] } }); journal.push(...source.events);
    const sourceFactId = source.events.find(e => e.eventType === 'InheritanceSourceEstablished').payload.factId;
    const inherited = commit(f, source.state, { kind: 'transferInheritance', proposalId: `${f.rootActionId}:inherit`, predecessorCharacterId: ACTOR, successorCharacterId: next,
      sourceFactId, authorizationId: 'authorization:promise' }); journal.push(...inherited.events);
    assert.deepEqual(inherited.state.campaignRuntime.promises['promise:successor'].lifecycle, p.lifecycle);
    assert.equal(inherited.state.campaignRuntime.promises['promise:successor'].status, p.status);
    assert.equal(inherited.state.campaignRuntime.promises['promise:successor'].lifecycle.obligation, released ? 'satisfied' : 'outstanding');
    assert.deepEqual(f.runtime.replay(f.genesis, journal).state, inherited.state);
  }
  const f = promiseFixture('amendment-correction'), formed = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null }));
  const changed = commit(f, formed.state, next => changePromiseInput(f, next, firstPromise(next)));
  const replay = f.runtime.replay(f.genesis, [...formed.events, ...changed.events]);
  const corrected = commit(f, changed.state, { kind: 'applyServiceCorrection', correctionAuthority: { kind: 'roomCorrectionAuthority', capability: changed.state.correctionRuntime.authorityCapability },
    correctionId: 'correction:amendment', targetReceiptId: changed.receipt.receiptId, actorCharacterId: ACTOR, errorKind: 'rulesMisapplication', publicExplanation: '撤销错误登记的改约。',
    basis: { stateHash: replay.head.stateHash, eventHash: replay.head.eventHash } });
  assert.deepEqual(firstPromise(corrected.state).lifecycle, firstPromise(formed.state).lifecycle);
  assert.equal(f.runtime.project(f.profiles, corrected.state, f.viewer).promises[0].revision, '1');
  assert.deepEqual(f.runtime.replay(f.genesis, [...formed.events, ...changed.events, ...corrected.events]).state, corrected.state);
});

test('legally hearing a promise update during long rest creates one attention choice; silence stays private and combat cannot use it', () => {
  for (const decision of ['continue', 'stop']) {
    const f = promiseFixture(`notice:${decision}`), formed = commit(f, f.state, makePromiseInput(f, f.state, { nextStep: null }));
    const rest = commit(f, formed.state, { kind: 'startRest', proposalId: `${f.rootActionId}:rest`, characterId: ACTOR, restKind: 'long' });
    const due = dueWork(f, rest.state).find(d => d.activityProgress?.phase === 'advance');
    const elapsed = settleUnchanged(f, commit(f, rest.state, { kind: 'advanceActivity', proposalId: due.childRootActionId, activityId: due.activityId }));
    const report = settleUnchanged(f, commit(f, elapsed.state, { kind: 'createSourceClaim', proposalId: `${f.rootActionId}:report`, speakerId: NPC, claimId: 'claim:work-report',
      semanticContent: '约定的事情已有消息，请来核对。', sourceBasis: '本人工作的情况。', motive: '报告进度。', formedAtFictionMicros: elapsed.state.fictionTimelines[due.timelineId].nowMicros }));
    assert.notEqual(dueWork(f, report.state).find(d => d.activityId === due.activityId)?.activityProgress?.phase, 'attention');
    const heard = commit(f, report.state, { kind: 'shareKnowledge', proposalId: `${f.rootActionId}:heard`, senderCharacterId: NPC, recipientEntityIds: [ACTOR],
      knowledgeRefs: ['claim:work-report'], medium: '在本人能听到的距离清楚告知。', contentLayer: 'full' });
    const notice = dueWork(f, heard.state).find(d => d.activityId === due.activityId); assert.equal(notice.activityProgress.phase, 'attention');
    const paused = commit(f, heard.state, { kind: 'advanceActivity', proposalId: notice.childRootActionId, activityId: notice.activityId });
    assert.equal(paused.state.campaignRuntime.activities[due.activityId].status, 'active');
    assert.equal(f.runtime.project(f.profiles, paused.state, f.viewer).promises[0].status, 'active', 'the NPC report is not a host verdict');
    assert.deepEqual(paused.state.entities[ACTOR].hitPoints, f.state.entities[ACTOR].hitPoints);
    const controlled = commit(f, paused.state, { kind: 'controlActivity', proposalId: `${f.rootActionId}:${decision}`, actorCharacterId: ACTOR, activityId: due.activityId,
      attentionRootActionId: notice.childRootActionId, decision });
    assert.equal(controlled.state.campaignRuntime.activities[due.activityId].status, decision === 'stop' ? 'interrupted' : 'active');
    assert.deepEqual(f.runtime.replay(f.genesis, [formed, rest, elapsed, report, heard, paused, controlled].flatMap(r => r.events)).state, controlled.state);
    const encounter = f.runtime.step(f.profiles, paused.state, { kind: 'startEncounter', rootActionId: `${f.rootActionId}:combat`, proposalAttemptId: `${f.rootActionId}:combat-attempt`,
      encounterId: 'encounter:notice', sceneId: SCENE, participantEntityIds: [ACTOR, NPC], battlefieldFactIds: [], dynamicEntities: [],
      initiativeGroups: [{ entryId: 'initiative:actor', combatantEntityIds: [ACTOR] }, { entryId: 'initiative:npc', combatantEntityIds: [NPC] }],
      hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NPC] }, { fromEntityIds: [NPC], toEntityIds: [ACTOR] }] });
    assert.notEqual(encounter.kind, 'rejected', JSON.stringify({ rejection: encounter.rejection }));
    assert.equal(dueWork(f, encounter.state).length, 0);
    const inCombat = f.runtime.step(f.profiles, encounter.state, { kind: 'controlActivity', proposalId: `${f.rootActionId}:combat-control`, actorCharacterId: ACTOR,
      activityId: due.activityId, attentionRootActionId: notice.childRootActionId, decision: 'continue' });
    assert.equal(inCombat.kind, 'rejected'); assert.deepEqual(inCombat.events, []);
  }
});
