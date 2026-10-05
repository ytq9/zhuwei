// Behavior assertions grouped by function; see README.md in this directory.
/**
 * Gate for SPEC 0016 §8.3: continuity review reports contradicting facts
 * instead of building a per-fragment evidence matrix.
 *
 * A passing review carries no per-fragment or per-fact proof; completeness is
 * checked once per committed mechanical group; a zero-mechanical review omits
 * resultChecks entirely, which is also the shape the real provider accepts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative.ts";
import { DEFAULT_KP_MODEL } from "../../../app/_runtime/lib/kp/models.ts";
import { narrationStageModelInput } from "../../../app/_runtime/lib/kp/narration-publication.ts";
import { frozenNarrationReviewContext, naturalNarrationContext, narrationGenerationContext, narrationReviewModelInput, naturalNarrationModelInput } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, requestFor, transfer, reviewFor, problem, binding, response } from '../../support/fixtures/narration.mjs';

const SCOPE = 'currentReceiptForViewer';
/** The frozen material a call was sent. */
const sent = input => JSON.parse(input.messages[1].content);
/** What the writer and the review are sent alike. */
const SHARED = ['currentResult', 'status', 'facts', 'expression'];
/** ADR 0108: the writer is sent the payloads the review is sent, less the
 * receipt and settlement-only outcomes not told beside concrete results. */
const toldPayloads = payloads => payloads.filter(payload => payload.evidenceRole === undefined || Object.hasOwn(payload, 'summary'));
const assertSharedMaterial = (written, reviewed) => {
  for (const key of SHARED) assert.deepEqual(written[key], reviewed[key]);
  assert.deepEqual(written.payloads, toldPayloads(reviewed.payloads));
};


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


test('SPEC 0016 §8.3: social groups that hold no record reach the review and are withheld from the writer', async () => {
  const request = requestFor([
    { kind: 'mechanicalOutcome', outcomeKind: 'social', actorRef: actor, outcomeCode: 'applied', summary: '这次交谈已完成。' },
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '请先说明你要写什么，我还没有答应。' },
  ], true);
  const before = structuredClone(request), body = '林说：“请先说明你要写什么，我还没有答应。”';
  const run = binding(request, body, reviewFor(request, body));
  assert.equal((await run.adapter.narrate(request)).body, body);
  assert.equal(run.calls.length, 2);
  const [written, reviewed] = run.calls.map(call => sent(call.input));
  assert.equal(Object.hasOwn(written, 'socialRecords'), false);
  assert.deepEqual(reviewed.socialRecords, { scope: SCOPE, newPromises: [], relationshipChanges: [], newDebts: [] });
  assertSharedMaterial(written, reviewed);
  assert.ok(frozenNarrationReviewContext(request, body).constraintRefs.includes('/socialRecords/newPromises'));
  assert.deepEqual(naturalNarrationContext(JSON.parse(JSON.stringify(request))), naturalNarrationContext(request));
  assert.deepEqual(request, before);
  for (const build of [naturalNarrationContext, narrationGenerationContext]) {
    assert.equal(Object.hasOwn(build(transfer()), 'socialRecords'), false);
  }
});


test('SPEC 0016 §8.3: a failed persuasion that changed a relationship is written from that record, with no empty group to read out', () => {
  // Round 153-2 published "交涉到此为止，没有欠下人情，也没有许下承诺。" No
  // Claim says so. The writer was sent newDebts and newPromises as empty
  // groups beside the one relationship change and told the player about them.
  const relationship = { kind: 'relationship', relationshipId: 'npc:a', subjectIds: [actor, 'npc:a'],
    change: '她把这名外乡人归进“今晚先观察”的一类，保持客气但不交底。' };
  const claims = [
    { kind: 'mechanicalOutcome', targetRefs: [actor], outcomeCode: 'activityCompleted', summary: '该角色的活动已完成。' },
    { kind: 'sourceClaim', speakerRef: actor, statement: '我是来守灵的外乡人。你父亲出事前后，你在这屋里听见过什么？说给我听，我不往外传。' },
    { kind: 'sourceClaim', speakerRef: 'npc:a', statement: '名字我记下了。今晚先听镇公所的，真有事等我知道你是谁带来的再说。' },
    { kind: 'socialCommitment', commitment: relationship },
    { kind: 'mechanicalOutcome', outcomeKind: 'social', actorRef: actor, targetRefs: ['npc:a'], outcomeCode: 'failure',
      summary: '这次交谈已完成。', check: { kind: 'abilityCheck', result: 'failure', total: 9, dc: 13 } },
    { kind: 'actionCommitted', actorRef: actor, status: 'committed', summary: '本次行动已经由权威状态提交。' },
  ];
  const draft = '林记下了你的名字，别的今晚不肯说。';
  // The policy new results are told by, and the one earlier frozen requests keep.
  for (const [narrationPolicy, drafted] of [
    ['plainText-v1', { choices: [{ finish_reason: 'stop', message: { content: draft } }] }],
    [undefined, response('submit_frozen_narration', { body: draft })],
  ]) {
    const request = { ...requestFor(claims, true), ...(narrationPolicy === undefined ? {} : { narrationPolicy }) };
    const [written, reviewed] = [1, 2].map(ordinal => sent(narrationStageModelInput(request, ordinal, () => drafted, DEFAULT_KP_MODEL)));
    assert.deepEqual(written.socialRecords, { scope: SCOPE, relationshipChanges: [{ claimIndex: 3 }] });
    assert.doesNotMatch(JSON.stringify(written), /newDebts|newPromises/);
    assert.deepEqual(written.payloads.find(payload => payload.claimIndex === 3).commitment, relationship);
    // The receipt and the settled persuasion reach the review only.
    assert.deepEqual(written.payloads.map(payload => payload.claimIndex), [1, 2, 3]);
    assert.ok(reviewed.payloads.some(payload => payload.kind === 'actionCommitted'));
    assert.deepEqual(written.facts.map(fact => fact.claimIndex), [1, 1, 1, 2, 2, 3]);
    assert.deepEqual(reviewed.socialRecords,
      { scope: SCOPE, newPromises: [], relationshipChanges: [{ claimIndex: 3 }], newDebts: [] });
    assert.equal(reviewed.candidateBody, draft);
    assertSharedMaterial(written, reviewed);
  }
});


test('nonempty social records refer to the exact visible payloads; only the review is sent the groups left empty', () => {
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
  const written = narrationGenerationContext(request);
  for (const [group, expected] of [['newPromises', promise], ['newDebts', debt]]) {
    assert.equal(context.socialRecords[group].length, 1);
    const [{ claimIndex }] = context.socialRecords[group];
    assert.deepEqual(context.payloads[claimIndex].commitment, expected);
    assert.deepEqual(written.socialRecords[group], context.socialRecords[group]);
  }
  assert.deepEqual(context.socialRecords.relationshipChanges, []);
  assert.deepEqual(Object.keys(written.socialRecords).sort(), ['newDebts', 'newPromises', 'scope']);
  assert.deepEqual(frozenNarrationReviewContext(request, '林作了承诺。').socialRecords, context.socialRecords);
  const relationship = { kind: 'relationship', relationshipId: 'relationship:trust', subjectIds: [actor, 'npc:b'], change: '愿意先听完解释。' };
  const changed = requestFor([{ kind: 'socialCommitment', commitment: relationship }], true, [relationship.relationshipId]);
  const other = naturalNarrationContext(changed);
  assert.deepEqual(other.socialRecords.newPromises, []);
  assert.deepEqual(other.payloads[other.socialRecords.relationshipChanges[0].claimIndex].commitment, relationship);
  assert.deepEqual(narrationGenerationContext(changed).socialRecords,
    { scope: SCOPE, relationshipChanges: other.socialRecords.relationshipChanges });
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
  const [written, reviewed] = run.calls.map(call => sent(call.input));
  assert.equal(Object.hasOwn(written, 'socialRecords'), false);
  assert.deepEqual(reviewed.socialRecords.newPromises, []);
  for (const material of [written, reviewed]) {
    assert.equal(material.payloads.find(p => p.kind === 'sourceClaim').statement, statement);
  }
  assert.equal(reviewed.candidateBody, body);
});


test('a refusal addressed to an empty group leads to one rewrite, written without the group and reviewed with it', async () => {
  const statement = '我会在一小时内写好交给你。';
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement }], true);
  const bad = '林从此欠你一份名签。', good = `林说：“${statement}”`;
  const responses = [response('submit_frozen_narration', { body: bad }),
    response('review_frozen_narration', problem(request, bad, 'SOURCE_ATTRIBUTION', 'attribution', '/socialRecords/newDebts')),
    response('submit_frozen_narration', { body: good }), response('review_frozen_narration', reviewFor(request, good))];
  const calls = [];
  const adapter = createAuthoritativeKpAdapter({ ai: { async run(_model, input) {
    calls.push(input); assert.ok(calls.length <= responses.length); return responses[calls.length - 1];
  } } });
  assert.equal((await adapter.narrate(request)).body, good);
  assert.equal(calls.length, 4);
  const [written, reviewed, rewritten, reviewedAgain] = calls.map(sent);
  // The rewrite is told which group the report addressed. Every record there
  // is sits in payloads, and that is what it checks the report against.
  assert.equal(JSON.parse(calls[2].messages[3].content).reviewIssues[0].constraintRef, '/socialRecords/newDebts');
  assert.deepEqual(rewritten, written);
  assert.equal(Object.hasOwn(written, 'socialRecords'), false);
  for (const material of [reviewed, reviewedAgain]) assert.deepEqual(material.socialRecords.newDebts, []);
});
