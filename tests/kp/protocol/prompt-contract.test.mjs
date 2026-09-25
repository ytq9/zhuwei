import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubmitKpProposalBundleModelInput } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { isInventoryOperationSource } from '../../../app/_runtime/lib/kp/vnext/authored-proposal-contract.ts';
import { assertDeepSeekStrictToolModelInput } from '../../../app/_runtime/lib/kp/deepseek.ts';
import { expandDeepSeekSchema, schemaVariants } from '../../support/fixtures/expand-deepseek-schema.mjs';
import { VNEXT_PROPOSAL_GUIDANCE_POLICY, VNEXT_PROPOSAL_CONTEXT_GUIDE } from '../../../app/_runtime/lib/kp/vnext/proposal-guidance.ts';
import { promiseFixture, makePromiseInput, dueWork } from '../../support/fixtures/vnext-promise-lifecycle.mjs';
import { prepareNpcWorkRequest, npcWorkModelInput, npcWorkRulesInput } from '../../../app/_runtime/lib/kp/vnext/npc-work.ts';
import { proposalModelContext } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { sentContext } from '../../support/fixtures/vnext-request-layout.mjs';
import { promiseReviewModelInput, parsePromiseReview } from '../../../app/_runtime/lib/kp/vnext/promise-review.ts';

function surface(capabilities) {
  const request = createSubmitKpProposalBundleModelInput('冻结上下文', capabilities, [], [], [], []);
  assertDeepSeekStrictToolModelInput(request);
  // Guidance is split across the two messages: the system message holds the
  // guide, the frozen context and the stage's rules, and what this call must
  // do comes last. This suite asks what the model is told, so it reads both.
  return { prompt: request.messages.map(message => message.content).join('\n'),
    schema: expandDeepSeekSchema(request.tools[0].function.parameters) };
}

test('social guidance teaches the response object on each result and the string player-expression source offered by its tool', () => {
  for (const capabilities of [['social'], ['social', 'materializeObject']]) {
    const { prompt, schema } = surface(capabilities);
    const step = schema.properties.steps.properties.social.items, response = step.properties.result.properties.response;
    assert.deepEqual(Object.keys(response.properties).sort(), ['basis', 'kind', 'motive', 'text']);
    // The step a check decides writes the same response on both results.
    const checked = schema.properties.check.properties.social.items;
    for (const side of ['success', 'failure']) assert.deepEqual(checked.properties[side].properties.response, response);
    assert.ok(prompt.includes('response对象填kind、text、motive、basis'), 'guidance must identify the offered response fields');
    const source = response.properties.basis.items;
    const existing = source.anyOf?.find(value => value.type === 'string') ?? source;
    assert.equal(existing.type, 'string');
    assert.ok(existing.enum.includes('playerExpression'));
    assert.equal(/responseKind|responseText|responseBasis|results行|\{kind:"playerExpression"\}/.test(prompt), false,
      'the prompt must not instruct the retired flat response fields, the results table or the object playerExpression wire');
    assert.ok(prompt.includes('字符串"playerExpression"'));
  }
});

// SPEC 0016 §7.3: only the check step varies with the roll, so a conversation
// whose listener reacts to the check's outcome is that step (round 120 kept
// it constant and the listener answered as if nothing happened).
test('social guidance makes the conversation the check step when the roll changes the listener reaction', () => {
  const { prompt } = surface(['social', 'inventoryOperation']);
  assert.ok(prompt.includes('检定结果会改变交谈对象的反应时'), 'the conversation is the check step');
  assert.ok(prompt.includes('取物等得手才发生的操作放steps绑onSuccess'), 'a take that only success brings is a bound step');
});

// SPEC 0001 §§5、6、14: a check needs a truly uncertain result and a
// meaningful failure, and an NPC answers from her own goals and knowledge.
// Guidance v46 made every request to "reveal" a check unless the listener
// would certainly agree; room 9DCMQN then rolled Charisma for all four
// questions it put to NPCs, including "什么信？". A question gets her answer
// without a roll; a roll is for changing what she would otherwise do.
test('social guidance rolls only to change what the listener would otherwise do, never for a plain question', () => {
  const { prompt } = surface(['social']);
  assert.ok(prompt.includes('问话和寻常交谈不掷骰，对方按本人目标、知识和态度回应'), 'a question is answered without a roll');
  assert.ok(prompt.includes('要对方做不愿做的事、说出想瞒的事或相信可疑的话（说服、欺瞒、威吓等），结果确实不定时才检定'),
    'persuasion, deception and intimidation roll when the result is truly uncertain');
  assert.equal(prompt.includes('透露或相信，而对方未必同意时'), false, 'a request she might refuse is no longer a roll by itself');
  assert.ok(prompt.includes('成败两边都按对方本人的目标和知识回应'), 'both reactions come from the listener');
});

// SPEC 0001 §12: the KP never answers for a player. The social guidance must
// stop an NPC line from presuming the player's reply, and route reply-dependent
// commitments through terms.activation so the promise stays pending.
test('social guidance forbids presuming the player reply and routes reply-dependent promises through activation', () => {
  const { prompt } = surface(['social']);
  assert.ok(prompt.includes('不能假定、转述或代替玩家尚未说出的回答'), 'NPC lines must not answer for the player');
  assert.ok(prompt.includes('把问题问出来就结束这句台词'), 'a question to the player ends the NPC line');
  assert.ok(prompt.includes('该条件必须写进terms.activation'), 'reply-dependent promises must use activation');
});

// SPEC 0009 §2: each check branch keeps its outcome text, NPC line and
// consequences inside its own summary, so a failed roll cannot hand over a
// clue that only the NPC line or failureOutcome mentions.
test('check branches keep their NPC line and consequences within that branch summary', () => {
  for (const capabilities of [['social'], ['observe'], ['worldInteraction']]) {
    const { prompt } = surface(capabilities);
    assert.ok(prompt.includes('同分支台词与后果不超出其summary'), `${capabilities}: branch content stays within its summary`);
    assert.ok(prompt.includes('失败给的线索须写进失败summary'), `${capabilities}: a failure lead is declared in the failure summary`);
  }
});

// SPEC 0006 §4, SPEC 0010 O02: people present who plainly see or hear an act
// each get their own sensory evidence, so an NPC knows what just happened in
// front of it -- without the actor's intent or private findings.
test('observation and world interaction guidance record what present NPCs plainly perceive, as their own evidence of the actor', () => {
  for (const capabilities of [['worldInteraction'], ['worldInteraction', 'social'], ['observe'], ['observe', 'inventoryOperation']]) {
    const { prompt } = surface(capabilities);
    assert.ok(prompt.includes('在场NPC或他人能察觉行动者的举动时，各写一条其所见所闻'), `${capabilities}: witnesses get evidence`);
    assert.ok(prompt.includes('subjectRef填行动者，不含行动者意图或独得发现'), `${capabilities}: evidence is of the act, not the intent`);
    assert.ok(prompt.includes('隐蔽举动被察觉时，见证与失手写在检定步骤的failure或绑onFailure的步骤里'), `${capabilities}: a noticed hidden act is recorded on the failing side`);
    assert.ok(prompt.includes('得手才发生的取物等操作绑onSuccess'), `${capabilities}: what only a success brings is bound to success`);
  }
});

// SPEC 0001 §§12, 14: the social step names what the listeners hear. Quoted
// words stay the player's; thoughts and plans never become the NPC's memory.
test('social asks for what the actor says aloud as the only thing the listeners hear', () => {
  const { prompt, schema } = surface(['social']);
  const speech = schema.properties.steps.properties.social.items.properties.actorSpeech;
  assert.equal(speech.type, 'string');
  assert.ok(speech.description.includes('引号内文字逐字保留'), 'quoted words are kept verbatim');
  assert.ok(speech.description.includes('不编措辞'), 'described speech is not given invented wording');
  assert.ok(speech.description.includes('不含心理、计划和动作'), 'thoughts, plans and actions are left out');
  assert.ok(prompt.includes('听者只听到actorSpeech'));
  assert.equal(prompt.includes('服务器保留玩家原话'), false, 'the raw input is no longer what listeners hear');
});

// SPEC 0009 §2: a changed relationship or situation is a meaningful failure.
// Round110 ruled a hidden theft in front of its owner a direct success
// because being caught was "only social friction". SPEC 0001 §§5、6: the roll
// also needs a truly uncertain result; without one the act simply succeeds.
// The user ruled in round109 that an act hidden from people present is
// always checked. Guidance v49 left that to the uncertainty judgement, and
// round128's draft ruled the hidden leaf theft a direct success.
test('a check needs a truly uncertain result and a meaningful failure; an act hidden from people present is always checked', () => {
  for (const capabilities of [['social'], ['inventoryOperation', 'observe'], ['worldInteraction']]) {
    const { prompt } = surface(capabilities);
    assert.ok(prompt.includes('结果确实不定且失败有意义才检定，否则直接成功'), `${capabilities}`);
    assert.ok(prompt.includes('瞒着旁人的举动或话要检定，会改变关系或处境的失败算有意义'), `${capabilities}`);
  }
});

// SPEC 0001 §6: the DC reflects the act and the situation. With no scale in
// the prompt, the same request to Lian got DC 15, 7 and 15 in rounds 123-125.
// With one number per tier (guidance v50-v52) every DC in rounds 128-130 was
// the shown 15, so the user asked for ranges: the band follows the difficulty
// and the number within it follows the act and the situation. Stated once,
// beside the other DC rules; v50 put it between "fill the DC in decision" and
// "the step it decides goes in check", and round129's draft then nested the
// check inside decision, so that structural sentence stays unbroken.
test('the DC falls in a 5e difficulty range, stated once beside the other DC rules', () => {
  const ranges = '不伪造DC；DC按难度落在5e区间：很容易1-5、容易6-10、中等11-15、困难16-20、很难21-25、几乎不可能26-30，具体数值只看行动本身和当前情境；检定前冻结DC';
  for (const capabilities of [['social'], ['observe'], ['worldInteraction']]) {
    const { prompt } = surface(capabilities);
    assert.equal(prompt.split('DC按难度落在5e区间').length - 1, 1, `${capabilities}`);
    assert.ok(prompt.includes(ranges), `${capabilities}`);
    assert.equal(prompt.includes('中等15'), false, `${capabilities}: no single number stands for a tier`);
    assert.ok(prompt.includes('在decision填写一次；检定决定其结果的那一个observe/social/worldInteraction步骤写进check'),
      `${capabilities}: the check step sentence is not interrupted`);
  }
});

// Rounds 115 and 117: asking selection to add observe for possible
// noticers made the model load every bystander and exceed the input budget.
// The conversation partner's noticing lives in its own branch instead.
test('selection does not ask for extra forms to record who may notice an act', () => {
  assert.equal(VNEXT_PROPOSAL_GUIDANCE_POLICY.selectionAuthority.includes('察觉'), false);
});

test('inventory handling instructions do not add the ItemDefinition use field to an inventory operation', () => {
  const { prompt, schema } = surface(['inventoryOperation']);
  const step = schema.properties.steps.properties.inventoryOperation.items;
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
      assert.ok(fields.steps); assert.equal(Object.hasOwn(fields, 'results'), false);
    }
    const native = continuations.find(value => value.properties.kind.enum.includes('abilityOperation'));
    assert.equal(Boolean(native), capabilities.includes('abilityOperation'));
    if (native) {
      assert.ok(native.properties.operation);
      assert.equal(Object.hasOwn(native.properties, 'steps'), false);
      assert.ok(prompt.includes('已选abilityOperation时也可用该kind及operation'));
    }
    for (const kind of ['inWorldRefusal', 'cancel']) {
      const fields = continuations.find(value => value.properties.kind.enum.includes(kind)).properties;
      assert.equal(Object.hasOwn(fields, 'steps'), false);
    }
    assert.equal(prompt.includes('continuation直接填directSuccess/check及steps'), false,
      'continuations must follow their selected branch instead of being restricted to rulings');
  }
});

test('new social fact source descriptions never request retired source wrappers or derived dependency fields', () => {
  const { schema } = surface(['social', 'materializeObject']);
  const row = schema.properties.steps.properties.social.items.properties.result;
  const source = row.properties.response.properties.basis.items.anyOf.find(value => value.properties?.worldFactRef);
  assert.deepEqual(Object.keys(source.properties), ['worldFactRef']);
  assert.doesNotMatch(source.properties.worldFactRef.description, /consumes|kind=npcContext/);
});

test('observation field descriptions use result entries and do not promise a free in-world action', () => {
  const { schema } = surface(['observe']);
  const row = schema.properties.steps.properties.observe.items.properties.result;
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
    const row = schema.properties.steps.properties[kind].items.properties.result;
    const sensory = row.properties.entries.items.anyOf.find(value => value.properties.recordKind.enum.includes('sensoryEvidence'));
    assert.ok(prompt.includes(VNEXT_PROPOSAL_GUIDANCE_POLICY.contextUse));
    assert.match(prompt, /允许忠实改述/);
    assert.match(prompt, /合理的小描写/);
    assert.doesNotMatch(prompt, /known须保留记录类型与状态|状态和以英寸计的Geometry/);
    assert.doesNotMatch(prompt, /不用常识补齐未给出的材质、外形、尺寸或安装方式/);
    assert.match(sensory.properties.evidence.description, /worldDescription/);
    // Technical codes are not sensory facts; the context guide states it once.
    assert.match(prompt, /不能自动作为感官依据/);
    assert.doesNotMatch(sensory.properties.evidence.description, /do not add unsupported material, shape, size, mounting/);
  }
  const { schema } = surface(['materializeObject']);
  for (const variant of schemaVariants(schema.properties.steps.properties.materializeObject.items)) {
    const kind = variant.properties.semanticKind.enum[0];
    assert.match(variant.properties.definition.properties.description.description,
      kind === 'worldFact' ? /fact's content/ : /appearance, sound/);
  }
});

test('assembly instructions distinguish a server-created assembly from a model producer handle and the action duration', () => {
  const { prompt, schema } = surface(['inventoryOperation']);
  const operation = schema.properties.steps.properties.inventoryOperation.items.properties.operation;
  const assembly = operation.anyOf.find(value => value.properties.kind.enum.includes('assemble'));
  assert.ok(assembly.properties.components);
  assert.equal(Object.hasOwn(schema.properties.steps.properties.inventoryOperation.items.properties, 'handle'), false);
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
  const body = sentContext(input);
  assert.deepEqual(body.requiredContext, proposalModelContext(request.context));
  assert.deepEqual(input.messages.map(message => message.role), ['system', 'user']);
  // The system message opens with the guide for reading a frozen context, and
  // the context follows it, so the stages of one plan share both as a prefix.
  assert.ok(input.messages[0].content.startsWith(`${VNEXT_PROPOSAL_CONTEXT_GUIDE}{"npcId":`));
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
  const row = schema.properties.steps.properties.social.items.properties.result;
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
