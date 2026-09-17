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
import { frozenNarrationReviewContext, naturalNarrationContext, narrationReviewModelInput, naturalNarrationModelInput } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, requestFor, transfer, reviewFor, problem, binding } from '../../support/fixtures/narration.mjs';


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
