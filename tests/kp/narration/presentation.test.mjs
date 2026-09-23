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
import { frozenNarrationFacts, frozenNarrationReviewContext, naturalNarrationContext, naturalNarrationModelInput, decodeNarrationReview } from "../../../app/_runtime/lib/kp/narration-vnext.ts";
import { actor, viewer, requestFor, reviewFor } from '../../support/fixtures/narration.mjs';


test('a settlement that only says the step succeeded is neither told nor reviewed beside a concrete result', () => {
  // 2026-09-12: the published candle narration ended "这次环境互动直接成功。" --
  // claims.ts:1648 read aloud, because its fact was required and its group
  // sat in the review table. The taking of the candle was the result.
  const settled = { kind: 'mechanicalOutcome', outcomeKind: 'worldInteraction', actorRef: actor, targetRefs: ['feature:door'],
    outcomeCode: 'success', summary: '这次环境互动已直接成功并提交。' };
  const inventory = { kind: 'inventoryOutcome', itemRef: 'item:mirror', change: 'transferred', characterRefs: [viewer, actor],
    operation: { kind: 'transfer', actorRef: actor, recipientRef: viewer, quantity: 2 }, summary: '完成转交。' };
  const request = requestFor([settled, inventory]);
  const facts = frozenNarrationFacts(request);
  assert.equal(facts.some(fact => fact.text.includes('直接成功')), false, JSON.stringify(facts));
  assert.ok(facts.length > 0 && facts.every(fact => fact.required));
  const material = naturalNarrationContext(request);
  assert.equal(material.payloads[0].summary, undefined);
  assert.equal(material.payloads[0].outcomeCode, 'success');
  assert.equal(material.payloads[1].summary, '完成转交。');
  const review = frozenNarrationReviewContext(request, '你把两面镜子交给了药师。');
  assert.deepEqual(review.mechanicalResults.map(group => group.key), ['m1']);

  // Alone, the settlement is still the only thing there is to tell.
  const alone = requestFor([settled]);
  assert.ok(frozenNarrationFacts(alone).some(fact => fact.text.includes('直接成功') && fact.required));
  assert.equal(naturalNarrationContext(alone).payloads[0].summary, '这次环境互动已直接成功并提交。');
  assert.deepEqual(frozenNarrationReviewContext(alone, '门开了。').mechanicalResults.map(group => group.key), ['m0']);

  // A world-interaction failure keeps its own fact and review group; an
  // unrelated inventory result cannot stand in for that failure.
  const failed = requestFor([{ ...settled, outcomeCode: 'failure', check: { kind: 'abilityCheck', result: 'failure', total: 9, dc: 15 } }, inventory]);
  const failedFacts = frozenNarrationFacts(failed);
  assert.ok(failedFacts.some(fact => fact.text.includes('检定失败') && fact.required), JSON.stringify(failedFacts));
  assert.deepEqual(frozenNarrationReviewContext(failed, '……').mechanicalResults.map(group => group.key), ['m0', 'm1']);
  // The committed-action receipt is likewise not told beside a result.
  const receipted = requestFor([{ kind: 'actionCommitted', actorRef: actor, status: 'committed', summary: '本次行动已经由权威状态提交。' }, inventory]);
  assert.equal(frozenNarrationFacts(receipted).some(fact => fact.text.includes('提交')), false);
});


test('social and observation check bookkeeping does not become required dialogue or a review obligation', () => {
  // SPEC 0016 §8.3: the current response expresses the actual consequence;
  // the check remains frozen authority data, not a second spoken result.
  for (const result of ['success', 'failure']) {
    const spoken = result === 'success' ? '我在仓库见过这样的叶子。' : '我不会告诉你叶子的来历。';
    const check = { kind: 'abilityCheck', result, total: result === 'success' ? 13 : 9, dc: 11 };
    for (const outcomeKind of ['social', 'observe']) {
      const consequence = outcomeKind === 'social'
        ? { kind: 'sourceClaim', speakerRef: 'npc:a', statement: spoken }
        : { kind: 'sensoryEvidence', observerRef: actor, sense: 'hearing',
          evidence: result === 'success' ? '门后传来两个人的脚步声。' : '雨声盖过了门后的动静，你没有听清。' };
      const settled = { kind: 'mechanicalOutcome', outcomeKind, actorRef: actor, targetRefs: ['npc:a'],
        outcomeCode: result, summary: '这次交谈已完成。', check };
      const request = requestFor([settled, consequence]);
      const original = structuredClone(request);
      const material = naturalNarrationContext(request);
      assert.equal(material.facts.some(fact => fact.claimIndex === 0), false,
        'the settlement, check verdict, total and DC must not be required prose');
      assert.ok(material.facts.some(fact => fact.claimIndex === 1 && fact.required));
      assert.equal(material.payloads[0].summary, undefined);
      assert.equal(material.payloads[0].check, undefined, 'do not feed dice statistics back as narration content');
      assert.equal(material.payloads[0].evidenceRole, 'stepSettlement');
      assert.deepEqual(frozenNarrationReviewContext(request, spoken).mechanicalResults, []);
      const reviewed = decodeNarrationReview(reviewFor(request, spoken), request, spoken);
      assert.equal(reviewed.checks.results, 'pass');
      assert.deepEqual(request, original);
      assert.deepEqual(request.renderableClaims.claims[0].check, check, 'the authoritative roll stays intact');
    }
  }
});

// SPEC 0009 §6: an NPC's spoken line reaches the player as a direct quote,
// with narration around it, not as a list of reported statements.
test('an NPC line is written as a direct quote framed by narration, not as reported speech', () => {
  const spoken = '叶子啊，含着它下葬，说是跟黑橡有关的物件。';
  const request = requestFor([{ kind: 'sourceClaim', speakerRef: 'npc:a', statement: spoken }]);
  const input = naturalNarrationModelInput(request);
  const task = input.messages.at(-1).content;
  assert.ok(task.includes('NPC本次说出的话用引号写成直接引语'), 'the line is quoted');
  assert.ok(task.includes('不改写成“某人说……她还说……”式的间接转述'), 'reported-speech lists are ruled out');
  assert.ok(task.includes('引语前后可以用旁白交代'), 'narration may frame the quote');
  assert.ok(task.includes('旁白不新增事实'), 'the framing adds no facts');
  assert.equal(task.includes('不要把台词或内部字段逐字拼起来'), false, 'the old rule steered lines into paraphrase');
  assert.ok(input.messages[1].content.includes(spoken), 'the frozen line is the material being quoted');
});

test('a bystander whose only visible result is an observation receives a narratable outcome, never a forbidden settlement', () => {
  // SPEC 0010 §1.1、SPEC 0016 §8.3: MBDE3S's bystander had one required
  // observation outcome but the same payload was marked stepSettlement.
  // The real reviewer repeatedly rejected it as both required and untellable.
  const outcome = { kind: 'mechanicalOutcome', outcomeKind: 'observe', actorRef: actor,
    targetRefs: ['feature:door'], outcomeCode: 'success', summary: '这次观察或推断已完成。' };
  const request = requestFor([outcome]);
  const material = naturalNarrationContext(request);
  assert.equal(material.expression.actorIntent, null, 'the bystander does not get the private input');
  assert.ok(material.facts.length > 0 && material.facts.every(fact => fact.required));
  assert.equal(material.payloads[0].evidenceRole, undefined,
    'a required standalone outcome cannot simultaneously forbid narration as stepSettlement');
  const review = frozenNarrationReviewContext(request, '远行者结束了对门的观察。');
  assert.deepEqual(review.payloads, material.payloads, 'generation and review must receive the same permissions');
  assert.deepEqual(review.mechanicalResults.map(group => group.key), ['m0']);
  assert.equal(decodeNarrationReview(reviewFor(request, '远行者结束了对门的观察。'), request,
    '远行者结束了对门的观察。').checks.results, 'pass');

  // The actor has the actual private consequence, so the identical outcome
  // remains bookkeeping in that viewer's response. Do not make it mandatory.
  const own = requestFor([outcome, {kind: 'sensoryEvidence', observerRef: actor,
    sense: 'sight', evidence: 'PRIVATE_OBSERVATION_CANARY'}], true);
  const ownMaterial = naturalNarrationContext(own);
  assert.equal(ownMaterial.payloads[0].evidenceRole, 'stepSettlement');
  assert.equal(ownMaterial.facts.some(fact => fact.claimIndex === 0), false);
  assert.equal(JSON.stringify(material).includes('PRIVATE_OBSERVATION_CANARY'), false);
});
