import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubmitKpProposalBundleModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { isInventoryOperationSource } from '../app/_runtime/lib/kp/vnext/authored-proposal-contract.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { expandDeepSeekSchema, schemaVariants } from './fixtures/expand-deepseek-schema.mjs';
import { VNEXT_PROPOSAL_GUIDANCE_POLICY } from '../app/_runtime/lib/kp/vnext/proposal-guidance.ts';
import { promiseFixture, makePromiseInput, dueWork } from './fixtures/vnext-promise-lifecycle.mjs';
import { prepareNpcWorkRequest, npcWorkModelInput, npcWorkRulesInput } from '../app/_runtime/lib/kp/vnext/npc-work.ts';
import { proposalModelContext } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { promiseReviewModelInput, parsePromiseReview } from '../app/_runtime/lib/kp/vnext/promise-review.ts';

function surface(capabilities) {
  const request = createSubmitKpProposalBundleModelInput('冻结上下文', capabilities, [], [], [], []);
  assertDeepSeekStrictToolModelInput(request);
  return { prompt: request.messages[0].content, schema: expandDeepSeekSchema(request.tools[0].function.parameters) };
}

test('social guidance teaches the flat response fields and the string player-expression source offered by its tool', () => {
  for (const capabilities of [['social'], ['social', 'materializeObject']]) {
    const { prompt, schema } = surface(capabilities);
    const row = schemaVariants(schema.properties.results.items).find(value => value.properties.kind.enum.includes('social'));
    for (const key of Object.keys(row.properties).filter(key => key.startsWith('response'))) {
      assert.ok(prompt.includes(key), `guidance must identify the offered ${key} field`);
    }
    const source = row.properties.responseBasis.items;
    const existing = source.anyOf?.find(value => value.type === 'string') ?? source;
    assert.equal(existing.type, 'string');
    assert.ok(existing.enum.includes('playerExpression'));
    assert.equal(/response\.(basis|text)|\{kind:"playerExpression"\}/.test(prompt), false,
      'the prompt must not instruct the retired nested response or object playerExpression wire');
    assert.ok(prompt.includes('字符串"playerExpression"'));
  }
});

test('inventory handling instructions do not add the ItemDefinition use field to an inventory operation', () => {
  const { prompt, schema } = surface(['inventoryOperation']);
  const step = schemaVariants(schema.properties.steps.items).find(value => value.properties.kind.enum.includes('inventoryOperation'));
  const acquire = step.properties.operation.anyOf.find(value => value.properties.kind.enum.includes('acquire'));
  assert.equal(Object.hasOwn(acquire.properties, 'use'), false);
  assert.equal(/将use填none/.test(prompt), false, 'use is a definition field, not an acquisition field');
  const operation = { kind: 'acquire', entryRef: 'item:available', quantity: 1 };
  assert.equal(isInventoryOperationSource(operation), true);
  assert.equal(isInventoryOperationSource({ ...operation, use: { kind: 'none' } }), false);
  assert.equal(isInventoryOperationSource({ kind: 'use', entryRef: 'item:available', targetRefs: [] }), true);
});

test('clarification guidance preserves the selected native operation beside flat ruling continuations', () => {
  for (const capabilities of [['social'], ['social', 'abilityOperation']]) {
    const { prompt, schema } = surface(capabilities);
    const clarification = schema.properties.decision.anyOf.find(value => value.properties.kind.enum.includes('clarification'));
    const continuations = clarification.properties.choices.items.properties.continuation.anyOf;
    for (const kind of ['directSuccess', 'check']) {
      const fields = continuations.find(value => value.properties.kind.enum.includes(kind)).properties;
      assert.ok(fields.steps); assert.ok(fields.results);
    }
    const native = continuations.find(value => value.properties.kind.enum.includes('abilityOperation'));
    assert.equal(Boolean(native), capabilities.includes('abilityOperation'));
    if (native) {
      assert.ok(native.properties.operation);
      assert.equal(Object.hasOwn(native.properties, 'steps'), false);
      assert.equal(Object.hasOwn(native.properties, 'results'), false);
      assert.ok(prompt.includes('已选abilityOperation时也可用该kind及operation'));
    }
    for (const kind of ['inWorldRefusal', 'cancel']) {
      const fields = continuations.find(value => value.properties.kind.enum.includes(kind)).properties;
      assert.equal(Object.hasOwn(fields, 'steps'), false);
      assert.equal(Object.hasOwn(fields, 'results'), false);
    }
    assert.equal(prompt.includes('continuation直接填directSuccess/check及steps'), false,
      'continuations must follow their selected branch instead of being restricted to rulings');
  }
});

test('new social fact source descriptions never request retired source wrappers or derived dependency fields', () => {
  const { schema } = surface(['social', 'materializeObject']);
  const row = schemaVariants(schema.properties.results.items).find(value => value.properties.kind.enum.includes('social'));
  const source = row.properties.responseBasis.items.anyOf.find(value => value.properties?.worldFactRef);
  assert.deepEqual(Object.keys(source.properties), ['worldFactRef']);
  assert.doesNotMatch(source.properties.worldFactRef.description, /consumes|kind=npcContext/);
});

test('observation field descriptions use result entries and do not promise a free in-world action', () => {
  const { schema } = surface(['observe']);
  const row = schemaVariants(schema.properties.results.items).find(value => value.properties.kind.enum.includes('observe'));
  const entries = row.properties.entries.items.anyOf;
  const sensory = entries.find(value => value.properties.recordKind.enum.includes('sensoryEvidence'));
  const inference = entries.find(value => value.properties.recordKind.enum.includes('characterInferences'));
  assert.ok(inference.properties.evidence);
  assert.doesNotMatch(sensory.properties.evidence.description, /observe\.characterInferences|commitNarrativeDetail entries/);
  assert.doesNotMatch(VNEXT_PROPOSAL_GUIDANCE_POLICY.filling.observe, /不伪造观察或自动推进时间/);
});

test('observation and physical interaction share explicit perception and adjudication guidance', () => {
  for (const kind of ['observe', 'worldInteraction']) {
    const { prompt, schema } = surface([kind]);
    const row = schemaVariants(schema.properties.results.items).find(value => value.properties.kind.enum.includes(kind));
    const sensory = row.properties.entries.items.anyOf.find(value => value.properties.recordKind.enum.includes('sensoryEvidence'));
    assert.ok(prompt.includes(VNEXT_PROPOSAL_GUIDANCE_POLICY.contextUse));
    assert.match(prompt, /允许忠实改述/);
    assert.match(prompt, /合理的小描写/);
    assert.doesNotMatch(prompt, /known须保留记录类型与状态|状态和以英寸计的Geometry/);
    assert.doesNotMatch(prompt, /不用常识补齐未给出的材质、外形、尺寸或安装方式/);
    assert.match(sensory.properties.evidence.description, /worldDescription/);
    assert.match(sensory.properties.evidence.description, /do not automatically establish/);
    assert.match(sensory.properties.evidence.description, /incidental, non-causal/);
    assert.doesNotMatch(sensory.properties.evidence.description, /do not add unsupported material, shape, size, mounting/);
  }
  const { schema } = surface(['materializeObject']);
  for (const variant of schemaVariants(schema.properties.steps.items).filter(value => value.properties.kind.enum.includes('materializeObject'))) {
    const kind = variant.properties.semanticKind.enum[0];
    assert.match(variant.properties.definition.properties.description.description,
      kind === 'worldFact' ? /fact's content/ : /appearance, sound/);
  }
});

test('assembly instructions distinguish a server-created assembly from a model producer handle and the action duration', () => {
  const { prompt, schema } = surface(['inventoryOperation']);
  const operation = schemaVariants(schema.properties.steps.items)[0].properties.operation;
  const assembly = operation.anyOf.find(value => value.properties.kind.enum.includes('assemble'));
  assert.ok(assembly.properties.components);
  assert.equal(Object.hasOwn(schemaVariants(schema.properties.steps.items)[0].properties, 'handle'), false);
  assert.doesNotMatch(prompt, /本类操作不创建新对象/);
  assert.doesNotMatch(assembly.description, /It does not advance time/);
});

test('the NPC caller supplies the same model context and typed references its Proposal instructions describe', () => {
  const f = promiseFixture('fixed-proposal-prompt');
  const result = f.runtime.step(f.profiles, f.state, makePromiseInput(f));
  assert.equal(result.kind, 'committed');
  const work = dueWork(f, result.state).find(value => value.npcWork);
  const request = prepareNpcWorkRequest(result.state, f.profiles, f.moduleProfile, work.childRootActionId, work.npcWork.planId);
  assert.ok(request);
  const input = npcWorkModelInput(request);
  assertDeepSeekStrictToolModelInput(input);
  const body = JSON.parse(input.messages.find(message => message.role === 'user').content);
  assert.deepEqual(body.requiredContext, proposalModelContext(request.context));
  assert.deepEqual(input.messages.map(message => message.role), ['system', 'user']);
  assert.doesNotMatch(JSON.stringify(input), /PLAYER_ONLY_PROMISE_CANARY/);
  const parseDecision = wakeAtFictionMicros => npcWorkRulesInput({ choices: [{ message: { tool_calls: [{ type: 'function',
    function: { name: 'submit_npc_work_decision', arguments: JSON.stringify({ kind: 'defer', reason: '等待新消息。',
      nextStep: request.plan.nextStep, wakeAtFictionMicros }) } }] } }] }, request, result.state, f.profiles);
  assert.deepEqual(parseDecision({ kind: 'none' }).decision, { kind: 'defer', reason: '等待新消息。',
    nextStep: request.plan.nextStep, wakeAtFictionMicros: null });
  assert.equal(parseDecision('600000000').decision.wakeAtFictionMicros, '600000000');
  for (const invalid of [null, { kind: 'none', ignored: '' }, '', '1.5']) {
    assert.throws(() => parseDecision(invalid), /NPC_WORK_INVALID/);
  }
});

test('social instructions distinguish an explicit player promise and a grounded change to an existing promise', () => {
  const { prompt, schema } = surface(['social']);
  const row = schemaVariants(schema.properties.results.items).find(value => value.properties.kind.enum.includes('social'));
  const promise = row.properties.newPromises.items;
  assert.deepEqual(promise.properties.promisor.enum, ['actor', 'npc']);
  assert.ok(promise.properties.terms.properties.parts);
  assert.ok(promise.properties.terms.properties.activation);
  const change = row.properties.promiseChanges.items;
  assert.ok(change.properties.expressionQuote);
  for (const field of ['promisor', 'promiseeRef', 'relationshipChanges', 'newPromises', 'promiseChanges', 'newDebts', 'expressionSource', 'expressionQuote']) {
    assert.ok(prompt.includes(field), `the fixed instructions must describe ${field}`);
  }
  assert.match(prompt, /actor仅记录玩家本次明确承诺/);
});

test('the review tool can express partial progress and condition judgments already accepted by its parser', () => {
  const input = promiseReviewModelInput({ schema: 'zhuwei.promise-review-context/vnext-1' });
  assertDeepSeekStrictToolModelInput(input);
  const tool = input.tools[0].function, fields = tool.parameters.properties;
  for (const outcome of ['progressed', 'conditionMet', 'conditionUnmet', 'released']) {
    const judgment = { outcome, reason: '依据已冻结原约与实际事件。', evidenceRefs: ['event:known'],
      remaining: ['progressed', 'conditionMet'].includes(outcome), completedParts: outcome === 'progressed' ? ['part:known'] : [] };
    const parsed = parsePromiseReview({ choices: [{ message: { tool_calls: [{ type: 'function',
      function: { name: tool.name, arguments: JSON.stringify(judgment) } }] } }] });
    assert.deepEqual({ ...parsed }, judgment);
    assert.ok(fields.outcome.enum.includes(outcome), `${outcome} must be writable in the model's actual tool`);
  }
  assert.equal(fields.completedParts.type, 'array');
});
