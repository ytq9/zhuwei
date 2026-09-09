import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeKpAdapter } from '../app/_runtime/lib/kp/authoritative.ts';
import { deriveAuthorityClaims, projectRenderableClaims } from '../app/_runtime/lib/rules/v2/claims.ts';
import { canonicalSha256 } from '../app/_runtime/lib/rules/profiles/canonical.ts';
import { freezeNarrationContext, frozenNarrationContextConform } from '../app/_runtime/lib/kp/narration-context.ts';
import { roomNarrationContext } from '../app/_runtime/lib/room/narration-context.ts';
import { kpRequestDeclaresStrictTool } from '../app/_runtime/lib/kp/authoritative-policy.ts';
import { deepSeekRequestBody } from '../app/_runtime/lib/kp/deepseek.ts';
import { conservativeInputTokens } from '../app/_runtime/lib/kp/vnext/invocation/budget.ts';
import { frozenNarrationFacts, frozenNarrationReviewContext, naturalNarrationContext,
  narrationReviewModelInput, naturalNarrationModelInput, decodeNarrationReview, decodeNarrationReviewResponse, extractFrozenNarrationResponse, VNEXT_NARRATION_SCHEMA, NARRATION_REVIEW_SCHEMA } from '../app/_runtime/lib/kp/narration-vnext.ts';

const actor = 'character:zed', viewer = 'character:amy';
const basis = { authorityRefs: [], viewerRefs: [] };
function requestFor(materials, own = false, extraRefs = []) {
  const receipt = { rootActionId: 'root:narration', receiptId: 'receipt:narration', status: 'committed' };
  const viewerRef = own ? actor : viewer;
  const renderableClaims = projectRenderableClaims(deriveAuthorityClaims({ ...receipt,
    materials: materials.map((material, i) => ({ claimRef: `claim:${i}`, basis, visibility: { kind: 'public' }, ...material })),
  }), { viewerKey: `principal:reader\u001f${viewerRef}`, refs: [actor, viewer, 'item:mirror', 'item:bolts', 'feature:door', 'npc:a', 'npc:b', ...extraRefs],
    displayNames: { [actor]: '远行者', [viewer]: '药师', 'item:mirror': '玻璃镜', 'item:bolts': '弩矢', 'npc:a': '林', 'npc:b': '林' } });
  return { ...receipt, receipt, narrationInputMode: 'frozenRenderableClaims-vnext-1', viewerKey: renderableClaims.viewerKey, renderableClaims,
    narrationContext: freezeNarrationContext(renderableClaims, {
      viewer: { characterRef: viewerRef, name: own ? '远行者' : '药师' }, actor: { characterRef: actor, name: '远行者' },
      actorIntent: own ? '把两面镜子交给药师。' : null, scene: { name: '会客室', tone: '克制、悬疑' },
      characters: [{ characterRef: 'npc:a', name: '林', voice: '简短、直率', attitude: null },
        { characterRef: 'npc:b', name: '林', voice: '用词正式，称对方阁下', attitude: '礼貌地保持距离' }],
      establishedDetails: [], recentDialogue: [],
    }),
  };
}
function transfer() { return requestFor([{ kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'transferred',
  characterRefs: [viewer, actor], operation: { kind: 'transfer', actorRef: actor, recipientRef: viewer, quantity: 2 }, summary: '完成转交。' }]); }
function reviewFor(request, body) {
  const context = frozenNarrationReviewContext(request, body);
  return { reviewId: context.reviewId,
    checks: { results: 'pass', continuity: 'pass', attribution: 'pass', agency: 'pass', presentation: 'pass' },
    ...(context.mechanicalResults.length ? { resultChecks: Object.fromEntries(context.mechanicalResults.map(result => [result.key, 'complete'])) } : {}), issues: [] };
}
function problem(request, body, code, check, constraintRef, quote = body, verdict = 'fail') {
  const value = reviewFor(request, body); value.checks[check] = verdict;
  value.issues.push({ code, check, constraintRef, quote, occurrence: 0, reason: '具体原文与所指冻结约束不符。' });
  for (const result of frozenNarrationReviewContext(request, body).mechanicalResults) {
    if (check === 'results' && (result.constraintRef === constraintRef || result.factRefs.includes(constraintRef)))
      value.resultChecks[result.key] = code === 'RESULT_CHANGED' ? 'changed' : code === 'RESULT_OMITTED' ? 'omitted' : 'uncertain';
  }
  return value;
}
function response(name, value) { return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] }, finish_reason: 'tool_calls' }],
  usage: { prompt_tokens: 101, completion_tokens: 23, total_tokens: 124 } }; }
function jsonResponse(value) { return { choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 101, completion_tokens: 23, total_tokens: 124 } }; }

function binding(request, body, review, options = {}) {
  const calls = [], receipts = [];
  const ai = { async run(model, input, signal) {
    calls.push({ model, input, signal });
    assert.ok(calls.length <= 2, 'No repair or third invocation');
    if (calls.length === 1) return options.candidateResponse ?? jsonResponse(options.candidate ?? { body });
    if (options.reviewError) throw options.reviewError;
    if (options.hang) return new Promise(() => {});
    return options.reviewResponse ?? response('review_frozen_narration', review);
  } };
  return { calls, receipts, adapter: createAuthoritativeKpAdapter({ ai, onInvocationReceipt: r => receipts.push(r), ...options.adapter }) };
}

test('natural paraphrase is reviewed once, keeps actor identity, and returns the original body with two accurate receipts', async () => {
  const request = transfer(), body = '远行者把两面玻璃镜递给了药师。';
  const run = binding(request, body, reviewFor(request, body));
  const result = await run.adapter.narrate(request);
  assert.equal(result.body, body);
  assert.deepEqual(run.receipts.map(r => [r.invocationPurpose, r.schemaVersion, r.inputTokens, r.outputTokens]),
    [['initialNarration', VNEXT_NARRATION_SCHEMA, 101, 23], ['narrationReview', NARRATION_REVIEW_SCHEMA, 101, 23]]);
  assert.equal(naturalNarrationContext(request).expression.isActorViewer, false);
  assert.ok(!JSON.stringify(run.receipts).includes('玻璃镜'));
  assert.ok(!JSON.stringify(run.receipts).includes('segments'));
  assert.equal(JSON.parse(run.calls[1].input.messages[1].content).candidateBody, body);
  for (const [index, { input }] of run.calls.entries()) {
    assert.deepEqual(input.thinking, { type: index === 0 ? 'enabled' : 'disabled' });
    assert.equal(input.reasoning_effort, index === 0 ? 'low' : undefined);
    assert.equal(input.tool_choice, index === 0 ? undefined : 'required');
    assert.equal(kpRequestDeclaresStrictTool(input), index === 1);
    if (index === 1) { assert.equal(input.tools[0].function.strict, true); assert.equal(input.parallel_tool_calls, false); }
    if (index === 0) { assert.equal(input.tools, undefined); assert.deepEqual(input.response_format, { type: 'json_object' }); }
    assert.ok(input.max_completion_tokens > 4096 && input.max_completion_tokens <= 8192);
  }
});

test('ordinary action realization remains grounded without granting new mechanics or player intent', async () => {
  const request = requestFor([{ kind: 'inventoryOutcome', itemRef: 'item:bolts', change: 'updated',
    operation: { kind: 'release', actorRef: actor, quantity: 1, releaseKind: 'placement' }, summary: '放下一支弩矢。' }], true);
  const body = '你俯身将一支弩矢轻轻放下。';
  const run = binding(request, body, reviewFor(request, body));
  assert.equal((await run.adapter.narrate(request)).body, body);
  assert.equal(run.calls.length, 2);
});

test('invalid frozen binding and input capacity fail before provider without fabricated invocation receipt', async () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  for (const bad of ['binding', 'budget']) {
    const changed = structuredClone(request);
    if (bad === 'binding') changed.narrationContext.expression.actor.name = '另一人';
    else changed.narrationContext = freezeNarrationContext(changed.renderableClaims, { ...changed.narrationContext.expression,
      actorIntent: null, establishedDetails: [{ detailRef: 'detail:long', description: '历史'.repeat(16000) }] });
    const run = binding(changed, body, reviewFor(changed, body));
    await assert.rejects(run.adapter.narrate(changed), e => e.publicCode === (bad === 'binding' ? 'NARRATION_BODY_INVALID' : 'NARRATION_CONTEXT_BUDGET_EXCEEDED'));
    assert.equal(run.calls.length, 0); assert.equal(run.receipts.length, 0);
  }
});

test('malformed generated body and leaked internal reference stop after the only real invocation', async () => {
  const request = transfer();
  for (const candidate of [{ body: '正常', approved: true }, { body: 'item:mirror 在这里。' }, { body: '' }]) {
    const run = binding(request, '', {}, { candidate });
    await assert.rejects(run.adapter.narrate(request));
    assert.equal(run.calls.length, 1); assert.equal(run.receipts.length, 1);
  }
});

test('vNext narration enforces its declared response mode, complete finish and unique JSON members at every depth', async () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给了药师。';
  const duplicates = jsonResponse({ body });
  duplicates.choices[0].message.content = '{"body":"前文","body":"后文"}';
  const incomplete = jsonResponse({ body }); incomplete.choices[0].finish_reason = 'length';
  for (const candidateResponse of [duplicates, incomplete, response('submit_current_narration', { body }), jsonResponse({ result: { body } })]) {
    const run = binding(request, body, reviewFor(request, body), { candidateResponse });
    await assert.rejects(run.adapter.narrate(request), e => e.publicCode === 'NARRATION_BODY_INVALID');
    assert.equal(run.calls.length, 1); assert.equal(run.receipts.length, 1);
  }
  const review = response('review_frozen_narration', reviewFor(request, body));
  review.choices[0].message.tool_calls[0].function.arguments = '{"segments":[{"index":0,"index":1}]}';
  assert.throws(() => extractFrozenNarrationResponse(review, 'review'));
  assert.throws(() => extractFrozenNarrationResponse(jsonResponse(reviewFor(request, body)), 'review'));
});

test('recovery keeps the identical frozen inputs and records recoveryReview; rate limit and total timeout never repair', async () => {
  const request = { ...transfer(), narrationPurpose: 'narrationRecovery' }, body = '远行者把两面玻璃镜递给了药师。';
  const good = binding(request, body, reviewFor(request, body)); await good.adapter.narrate(request);
  assert.deepEqual(good.receipts.map(r => r.invocationPurpose), ['narrationRecovery', 'narrationRecoveryReview']);
  for (const options of [{ reviewError: Object.assign(new Error('limited'), { status: 429 }) }, { hang: true, adapter: { invocationTimeoutMs: 15 } }]) {
    const run = binding(request, body, {}, options); await assert.rejects(run.adapter.narrate(request));
    assert.equal(run.calls.length, 2); assert.equal(run.receipts.length, 2);
    assert.equal(run.receipts[1].schemaVersion, NARRATION_REVIEW_SCHEMA);
  }
});

test('compound same-kind facts retain typed item/quantity group bindings and same-name NPC identities', () => {
  const request = requestFor([
    { kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'updated', quantity: { before: 3, after: 1 }, summary: '镜子减少。' },
    { kind: 'inventoryOutcome', itemRef: 'item:bolts', change: 'updated', quantity: { before: 8, after: 7 }, summary: '弩矢减少。' },
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '门后没有人。' },
    { kind: 'sourceClaim', speakerRef: 'npc:b', statement: '我听见门后有人。' },
  ]);
  const input = naturalNarrationContext(request);
  assert.equal(input.payloads[0].itemRef, 'item:mirror'); assert.equal(input.payloads[1].itemRef, 'item:bolts');
  assert.ok(input.facts.some(f => f.claimIndex === 0 && f.text.includes('3') && f.text.includes('1')));
  assert.ok(input.facts.some(f => f.claimIndex === 1 && f.text.includes('8') && f.text.includes('7')));
  assert.equal(input.payloads[2].speakerRef, input.expression.characters[0].characterRef);
  assert.equal(input.payloads[3].speakerRef, input.expression.characters[1].characterRef);
  assert.notEqual(input.expression.characters[0].voice, input.expression.characters[1].voice);
});

test('empty social records reach generation and the existing review with the same frozen scope', async () => {
  const request = requestFor([
    { kind: 'mechanicalOutcome', outcomeKind: 'social', actorRef: actor, outcomeCode: 'applied', summary: '这次交谈已完成。' },
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '请先说明你要写什么，我还没有答应。' },
  ], true);
  const before = structuredClone(request), body = '林说：“请先说明你要写什么，我还没有答应。”';
  const run = binding(request, body, reviewFor(request, body));
  assert.equal((await run.adapter.narrate(request)).body, body);
  assert.equal(run.calls.length, 2);
  const expected = { scope: 'currentReceiptForViewer', newPromises: [], relationshipChanges: [], newDebts: [] };
  for (const { input } of run.calls) assert.deepEqual(JSON.parse(input.messages[1].content).socialRecords, expected);
  assert.ok(frozenNarrationReviewContext(request, body).constraintRefs.includes('/socialRecords/newPromises'));
  assert.deepEqual(naturalNarrationContext(JSON.parse(JSON.stringify(request))), naturalNarrationContext(request));
  assert.deepEqual(request, before);
  assert.equal(Object.hasOwn(naturalNarrationContext(transfer()), 'socialRecords'), false);
});

test('nonempty social records refer to the exact visible payloads while unused groups remain empty', () => {
  const promise = { kind: 'promise', promiseId: 'promise:delivery', promisorId: 'npc:a', promiseeId: actor,
    content: '一小时内把名签交到你手上。', condition: '立即生效。' };
  const debt = { kind: 'debt', debtId: 'debt:lamp', debtorId: actor, creditorId: 'npc:b',
    obligation: '归还借来的灯。', condition: '离开以后。' };
  const materials = [
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '我会在一小时内交给你。' },
    { kind: 'socialCommitment', commitment: debt },
    { kind: 'socialCommitment', commitment: promise },
  ];
  const request = requestFor(materials, true, [promise.promiseId, debt.debtId]), context = naturalNarrationContext(request);
  for (const [group, expected] of [['newPromises', promise], ['newDebts', debt]]) {
    assert.equal(context.socialRecords[group].length, 1);
    const [{ claimIndex }] = context.socialRecords[group];
    assert.deepEqual(context.payloads[claimIndex].commitment, expected);
  }
  assert.deepEqual(context.socialRecords.relationshipChanges, []);
  assert.deepEqual(frozenNarrationReviewContext(request, '林作了承诺。').socialRecords, context.socialRecords);
  const relationship = { kind: 'relationship', relationshipId: 'relationship:trust', subjectIds: [actor, 'npc:b'], change: '愿意先听完解释。' };
  const other = naturalNarrationContext(requestFor([{ kind: 'socialCommitment', commitment: relationship }], true, [relationship.relationshipId]));
  assert.deepEqual(other.socialRecords.newPromises, []);
  assert.deepEqual(other.payloads[other.socialRecords.relationshipChanges[0].claimIndex].commitment, relationship);
});

test('hidden commitments cannot change the visible empty-record input or disclose their existence', () => {
  const speech = { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '请稍等。' };
  const hidden = { kind: 'socialCommitment', visibility: { kind: 'grants', allOf: ['grant:private-promise'] },
    commitment: { kind: 'promise', promiseId: 'promise:PRIVATE_PROMISE_CANARY', promisorId: 'npc:a', promiseeId: actor,
      content: 'PRIVATE_PROMISE_CONTENT', condition: 'PRIVATE_PROMISE_CONDITION' } };
  const without = requestFor([speech]), withHidden = requestFor([speech, hidden]);
  assert.deepEqual(naturalNarrationContext(withHidden), naturalNarrationContext(without));
  assert.deepEqual(naturalNarrationModelInput(withHidden), naturalNarrationModelInput(without));
  assert.deepEqual(narrationReviewModelInput(withHidden, '林说：“请稍等。”'), narrationReviewModelInput(without, '林说：“请稍等。”'));
  assert.doesNotMatch(JSON.stringify(naturalNarrationContext(withHidden)), /PRIVATE_PROMISE|private-promise/);
});

test('empty records preserve an upstream spoken undertaking and reuse an uncertain review without rewriting or extra calls', async () => {
  const statement = '我会在一小时内写好交给你。';
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement }], true);
  const body = `林说：“${statement}”`;
  // A deterministic review double proves rejection/recovery plumbing, not
  // that the real model will detect a semantic omission in arbitrary speech.
  const report = problem(request, body, 'REVIEW_UNCERTAIN', 'continuity', '/socialRecords/newPromises', statement, 'uncertain');
  const run = binding(request, body, report);
  await assert.rejects(run.adapter.narrate(request));
  assert.equal(run.calls.length, 2);
  assert.equal(run.receipts.length, 2);
  for (const { input } of run.calls) {
    const material = JSON.parse(input.messages[1].content);
    assert.deepEqual(material.socialRecords.newPromises, []);
    assert.equal(material.payloads.find(p => p.kind === 'sourceClaim').statement, statement);
  }
  assert.equal(JSON.parse(run.calls[1].input.messages[1].content).candidateBody, body);
});

test('Room freezes only authorized relevant expression, linked heard dialogue, historical details and own intent', () => {
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '门后没有人。', basis: { authorityRefs: [], viewerRefs: ['source:current'] } }]);
  const claims = request.renderableClaims;
  const projection = { viewer: { kind: 'player', subjectId: viewer }, controlledCharacter: { name: '药师', sceneId: 'scene:hall' },
    entities: {}, publicExpression: { scene: { name: '厅堂', tone: '克制' }, characters: structuredClone(request.narrationContext.expression.characters) },
    visibleFacts: [{ id: 'detail:chair', kind: 'narrativeCommitment', value: { sceneRef: 'scene:hall', description: '椅子曾在窗边。' } }],
    sourceClaims: [{ claimId: 'source:current', speakerId: 'npc:a', semanticContent: '我先前没有见到人。', motive: 'PRIVATE_MOTIVE', sourceBasis: 'PRIVATE_BASIS' },
      { claimId: 'source:unrelated', speakerId: 'npc:a', semanticContent: 'UNRELATED_HISTORY' }], conversationThreads: [] };
  // Rebuild claims with the one explicit source grant.
  const granted = projectRenderableClaims(deriveAuthorityClaims({ receiptId: claims.receiptId, rootActionId: claims.rootActionId,
    materials: [{ claimRef: 'claim:source', kind: 'sourceClaim', speakerRef: 'npc:a', statement: '门后没有人。',
      basis: { authorityRefs: [], viewerRefs: ['source:current'] }, visibility: { kind: 'public' } }] }),
    { viewerKey: claims.viewerKey, refs: ['npc:a', 'source:current'], displayNames: { 'npc:a': '林' } });
  const frozen = roomNarrationContext({ claims: granted, projection, actorCharacterId: actor,
    actorMessage: { characterId: actor, body: 'OTHER_PLAYER_SECRET' }, experiencedTranscript: { messages: [{ kind: 'kp', body: 'UNRELATED_OPENING', speakerName: 'KP', speakerCharacterId: null }] } });
  assert.equal(frozen.expression.actor, null); assert.equal(frozen.expression.actorIntent, null);
  assert.deepEqual(frozen.expression.characters.map(c => c.characterRef), ['npc:a']);
  assert.equal(frozen.expression.recentDialogue[0].speakerRef, 'npc:a');
  assert.equal(frozen.expression.establishedDetails[0].description, '椅子曾在窗边。');
  assert.doesNotMatch(JSON.stringify(frozen), /PRIVATE_|UNRELATED_HISTORY|UNRELATED_OPENING|OTHER_PLAYER_SECRET/);
  const restored = JSON.parse(JSON.stringify(frozen)); assert.ok(frozenNarrationContextConform(restored, granted));
  projection.publicExpression.characters[0].voice = '后来改变';
  assert.equal(restored.expression.characters[0].voice, '简短、直率');
  restored.expression.recentDialogue[0].body = '篡改'; assert.equal(frozenNarrationContextConform(restored, granted), false);
});



// These responses are deliberate doubles. They verify contract enforcement,
// not that a real model detects semantic conflicts; live evidence is separate.
test('passing reviews carry no per-fragment or per-fact proof for distinct creation and result types', () => {
  const cases = [transfer(), requestFor([
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '我从没见过海。' },
  ]), requestFor([{ kind: 'sceneFeature', featureRef: 'feature:door', description: '门旁放着一把旧椅子。' }])];
  for (const request of cases) {
    const body = frozenNarrationFacts(request).map(f => f.text).join('。');
    const review = reviewFor(request, body);
    assert.deepEqual(decodeNarrationReview(review, request, body).issues, []);
    if (!request.renderableClaims.claims.some(c => ['mechanicalOutcome', 'inventoryOutcome', 'abilityEffectApplied'].includes(c.kind)))
      assert.equal(Object.hasOwn(review, 'resultChecks'), false);
    const input = narrationReviewModelInput(request, body);
    assert.equal(input.tools[0].function.parameters.properties.issues.items.type, 'object');
    assert.deepEqual(Object.keys(input.tools[0].function.parameters.properties),
      frozenNarrationReviewContext(request, body).mechanicalResults.length ? ['reviewId', 'checks', 'resultChecks', 'issues'] : ['reviewId', 'checks', 'issues']);
    assert.equal(input.tools[0].function.parameters.properties.segments, undefined);
    assert.equal(JSON.parse(input.messages[1].content).payloads.length, request.renderableClaims.claims.length);
  }
});

test('zero-mechanical reviews omit resultChecks across schema, response and bounded adapter calls', async () => {
  for (const request of [requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: '我从没见过海。' }]),
    requestFor([{ kind: 'sceneFeature', featureRef: 'feature:door', description: '门旁放着一把旧椅子。' }])]) {
    const body = frozenNarrationFacts(request).map(f => f.text).join('。');
    const input = narrationReviewModelInput(request, body), schema = input.tools[0].function.parameters;
    assert.equal(Object.hasOwn(schema.properties, 'resultChecks'), false);
    assert.equal(schema.required.includes('resultChecks'), false);
    assert.equal(input.messages[0].content.includes('resultChecks'), false);
    const valid = reviewFor(request, body), decoded = decodeNarrationReview(valid, request, body);
    assert.equal(Object.hasOwn(decoded, 'resultChecks'), false);
    for (const resultChecks of [{}, { m0: 'complete' }])
      assert.throws(() => decodeNarrationReview({ ...valid, resultChecks }, request, body));
    const run = binding(request, body, valid);
    assert.equal((await run.adapter.narrate(request)).body, body);
    assert.equal(run.calls.length, 2);
  }
});

test('exact candidate body, frozen context, identity and receipt bind each review', () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  const review = reviewFor(request, body);
  assert.throws(() => decodeNarrationReview(review, request, body.replace('两', '三')));
  for (const mutate of [r => r.receipt.receiptId = 'other', r => r.viewerKey = 'other',
    r => r.narrationContext.expression.scene.tone = 'other']) {
    const changed = structuredClone(request); mutate(changed);
    assert.throws(() => decodeNarrationReview(review, changed, body));
  }
  const copy = JSON.parse(JSON.stringify(request));
  assert.deepEqual(frozenNarrationReviewContext(copy, body), frozenNarrationReviewContext(request, body));
});

for (const [code, check, ref, reason] of [
  ['RESULT_CHANGED', 'results', '/payloads/0', 'unsupportedClause'],
  ['RESULT_OMITTED', 'results', '/facts/0', 'missingClaimFacts'],
  ['FACT_CONFLICT', 'continuity', '/facts/0', 'continuityMismatch'],
  ['UNRECORDED_CREATION', 'continuity', 'policy:persist-before-publish', 'unsupportedClause'],
  ['SOURCE_ATTRIBUTION', 'attribution', 'policy:attribution', 'unsupportedClause'],
  ['SECRET_DISCLOSURE', 'attribution', 'policy:attribution', 'unsupportedClause'],
  ['KNOWLEDGE_UPGRADE', 'attribution', 'policy:attribution', 'unsupportedClause'],
  ['PLAYER_AGENCY', 'agency', 'policy:agency', 'playerAgency'],
  ['VIEWER_ROLE', 'agency', '/expression', 'roleMismatch'],
  ['PRESENTATION', 'presentation', 'policy:presentation', 'unnaturalNarration'],
  ['REVIEW_UNCERTAIN', 'continuity', '/facts/0', 'reviewUncertain'],
]) test(`concrete ${code} rejects original body without a third model call`, async () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  const review = problem(request, body, code, check, ref, code === 'RESULT_OMITTED' ? '' : body,
    code === 'REVIEW_UNCERTAIN' ? 'uncertain' : 'fail');
  assert.throws(() => decodeNarrationReview(review, request, body), error => {
    assert.equal(error.reason, reason);
    assert.equal(error.diagnostics[0].constraintRef, ref);
    assert.equal(error.diagnostics[0].start, code === 'RESULT_OMITTED' ? null : 0);
    return true;
  });
  const run = binding(request, body, review);
  await assert.rejects(run.adapter.narrate(request), error => {
    assert.equal(error.modelInvocationReceipt.groundingReason, reason);
    assert.equal(error.narrationDiagnostics[0].constraintRef, ref);
    assert.equal(error.narrationDiagnostics[0].reason, review.issues[0].reason);
    assert.doesNotMatch(JSON.stringify(error), /narrationDiagnostics|具体原文/);
    return true;
  });
  assert.equal(run.calls.length, 2);
});

test('diagnostics reject fabricated quotes, references, assessments and conflicting or incomplete reports', () => {
  const request = transfer(), body = '远行者把两面玻璃镜交给药师。';
  const badReports = [
    r => r.issues.push({ code: 'RESULT_CHANGED', check: 'results', quote: body, occurrence: 0, constraintRef: '/facts/0', reason: '错误' }),
    r => r.checks.results = 'fail', r => delete r.checks.attribution, r => r.checks.newCheck = 'pass',
    r => r.reviewId = 'different', r => r.segments = [],
  ];
  for (const mutate of badReports) { const r = reviewFor(request, body); mutate(r); assert.throws(() => decodeNarrationReview(r, request, body)); }
  for (const mutate of [r => r.issues[0].quote = '不存在于原文', r => r.issues[0].constraintRef = '/facts/999',
    r => r.issues[0].constraintRef = 'secret:canary', r => r.issues[0].reason = '',
    r => r.issues[0].code = 'NAME_SPECIFIC_ERROR', r => r.issues[0].check = 'agency',
    r => r.issues[0].occurrence = 1, r => r.issues[0].quote = '',
    r => r.issues[0].constraintRef = 'policy:persist-before-publish']) {
    const r = problem(request, body, 'FACT_CONFLICT', 'continuity', '/facts/0'); mutate(r);
    assert.throws(() => decodeNarrationReview(r, request, body));
  }
  const repeated = body + body, r = problem(request, repeated, 'RESULT_CHANGED', 'results', '/facts/0', body);
  r.issues[0].occurrence = 1;
  assert.throws(() => decodeNarrationReview(r, request, repeated), e => e.diagnostics[0].start === body.length);
});

test('review keeps duplicate required material without requiring duplicated coverage attestations', () => {
  const request = requestFor([
    { kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'updated', operation: { kind: 'release', actorRef: actor, quantity: 1, releaseKind: 'placement' }, summary: '已放下。' },
    { kind: 'inventoryOutcome', itemRef: 'item:bolts', change: 'updated', operation: { kind: 'release', actorRef: actor, quantity: 1, releaseKind: 'placement' }, summary: '已放下。' },
    { kind: 'actionCommitted', actorRef: actor, status: 'committed', summary: '已提交。' },
  ], true);
  const body = '你把一面玻璃镜和一支弩矢放下。', context = frozenNarrationReviewContext(request, body);
  assert.equal(context.payloads.length, 3); // no same-text or name-based deduplication
  assert.deepEqual(context.facts, frozenNarrationFacts(request));
  decodeNarrationReview(reviewFor(request, body), request, body);
  const optional = context.facts.find(f => !f.required);
  const bad = problem(request, body, 'RESULT_OMITTED', 'results', `/facts/${optional.index}`, '');
  assert.throws(() => decodeNarrationReview(bad, request, body), e => !e.reason);
});

test('typed Claim corruption is rejected and required material never truncates to fit input', () => {
  const request = transfer(), body = '结果。';
  const broken = structuredClone(request); broken.renderableClaims.claims[0].kind = 'fabricated';
  assert.throws(() => frozenNarrationReviewContext(broken, body), e => e.reason === 'invalidClaimFacts');
  const large = { ...request, narrationContext: freezeNarrationContext(request.renderableClaims, {
    ...request.narrationContext.expression, establishedDetails: [{ detailRef: 'detail:long', description: '历史'.repeat(16000) }],
  }) };
  for (const build of [r => naturalNarrationModelInput(r), r => narrationReviewModelInput(r, body)]) {
    assert.throws(() => build(large), e => e.reason === 'materialBudget');
  }
  assert.ok(conservativeInputTokens(JSON.stringify(deepSeekRequestBody('deepseek-v4-flash', narrationReviewModelInput(request, body)))) < 12000);
});

test('the adapter snapshots the reviewed material before either asynchronous provider call', async () => {
  const request = transfer(), original = structuredClone(request), body = '远行者把两面玻璃镜交给药师。';
  const ai = { async run(_model, input) {
    if (!input.tools) {
      request.narrationContext = freezeNarrationContext(request.renderableClaims, {
        ...request.narrationContext.expression, actor: { characterRef: actor, name: '外部异步篡改' },
      });
      return jsonResponse({ body });
    }
    assert.equal(JSON.parse(input.messages[1].content).expression.actor.name, original.narrationContext.expression.actor.name);
    return response('review_frozen_narration', reviewFor(original, body));
  } };
  assert.equal((await createAuthoritativeKpAdapter({ ai }).narrate(request)).body, body);
});

// Real round50 accepted a cost omission under a single global result check.
// The bounded follow-up tests the model judgment; this test locks its report contract.
test('mechanical results require one explicit completeness decision per group, with concrete omission diagnostics', () => {
  const request = transfer(), body = '结束了。', value = reviewFor(request, body);
  for (const mutate of [r => r.resultChecks = {}, r => r.resultChecks.m0 = 'omitted',
    r => r.resultChecks.m999 = 'complete']) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => decodeNarrationReview(bad, request, body));
  }
  const omitted = problem(request, body, 'RESULT_OMITTED', 'results', '/facts/0', '');
  assert.throws(() => decodeNarrationReview(omitted, request, body), e => e.reason === 'missingClaimFacts');
});

test('an inconsistent rejection retains the concrete error and its conflicting summary without publishing', async () => {
  const request = transfer(), body = '结束了。';
  const report = problem(request, body, 'RESULT_OMITTED', 'results', '/facts/0', '');
  report.checks.results = 'pass'; report.resultChecks.m0 = 'changed';
  const run = binding(request, body, report);
  await assert.rejects(run.adapter.narrate(request), error => {
    assert.equal(error.modelInvocationReceipt.groundingReason, 'missingClaimFacts');
    assert.equal(error.narrationDiagnostics[0].code, 'RESULT_OMITTED');
    assert.deepEqual(error.narrationReportConflicts, ['checks.results', 'resultChecks.m0']);
    assert.doesNotMatch(JSON.stringify(error), /narrationReportConflicts|具体原文/); return true;
  });
  assert.equal(run.calls.length, 2);
});

test('a wait freezes the same-scene dialogue heard within one tier before it, in fiction order, plus the viewer\'s own recent lines', () => {
  const request = requestFor([{ kind: 'mechanicalOutcome', targetRefs: [viewer], outcomeCode: 'timePassageCompleted', summary: '等待已结束，实际经过 60 秒，原计划为 60 秒。' }]);
  const projection = { viewer: { kind: 'player', subjectId: viewer }, controlledCharacter: { name: '药师', sceneId: 'scene:hall' }, entities: {},
    publicExpression: { scene: { name: '厅堂', tone: '克制' }, characters: [] }, visibleFacts: [],
    activities: [{ kind: 'timePassage', activityId: 'activity:wait', characterId: viewer, status: 'completed', startedAtFictionMicros: '2000000000', endedAtFictionMicros: '2060000000' }],
    conversationThreads: [
      { threadRef: 'thread:hall', sourceSceneId: 'scene:hall', claimRef: 'source:ask', responseClaimRef: 'source:reply' },
      { threadRef: 'thread:old', sourceSceneId: 'scene:hall', claimRef: 'source:old', responseClaimRef: null },
      { threadRef: 'thread:later', sourceSceneId: 'scene:hall', claimRef: 'source:after', responseClaimRef: null },
      { threadRef: 'thread:elsewhere', sourceSceneId: 'scene:gate', claimRef: 'source:gate', responseClaimRef: null }],
    sourceClaims: [
      { claimId: 'source:reply', speakerId: 'npc:a', semanticContent: '半分钟到了我敲两下。', acquiredAtFictionMicros: '1999000000', motive: 'PRIVATE_MOTIVE' },
      { claimId: 'source:ask', speakerId: viewer, semanticContent: '给我半分钟。', acquiredAtFictionMicros: '1999000000' },
      { claimId: 'source:old', speakerId: 'npc:a', semanticContent: 'STALE_LINE', acquiredAtFictionMicros: '100000000' },
      { claimId: 'source:gate', speakerId: 'npc:a', semanticContent: 'OTHER_SCENE_LINE', acquiredAtFictionMicros: '2000000000' },
      { claimId: 'source:after', speakerId: 'npc:a', semanticContent: 'FUTURE_LINE', acquiredAtFictionMicros: '2070000000' }] };
  const frozen = roomNarrationContext({ claims: request.renderableClaims, projection, actorCharacterId: viewer, experiencedTranscript: { messages: [
    { kind: 'player', body: '我等半分钟。', speakerName: '药师', speakerCharacterId: viewer },
    { kind: 'kp', body: 'UNRELATED_OPENING', speakerName: 'KP', speakerCharacterId: null },
    { kind: 'player', body: 'OTHER_PLAYER_LINE', speakerName: '远行者', speakerCharacterId: actor }] } });
  assert.deepEqual(frozen.expression.recentDialogue.map(entry => [entry.kind, entry.body]),
    [['player', '给我半分钟。'], ['npc', '半分钟到了我敲两下。'], ['player', '我等半分钟。']]);
  assert.doesNotMatch(JSON.stringify(frozen), /STALE_LINE|OTHER_SCENE_LINE|FUTURE_LINE|UNRELATED_OPENING|OTHER_PLAYER_LINE|PRIVATE_/);
  assert.ok(frozenNarrationContextConform(JSON.parse(JSON.stringify(frozen)), request.renderableClaims));
  // Without a wait, the same projection lends no dialogue to an unrelated result.
  const plain = roomNarrationContext({ claims: transfer().renderableClaims, projection, actorCharacterId: actor, experiencedTranscript: { messages: [] } });
  assert.deepEqual(plain.expression.recentDialogue, []);
});
