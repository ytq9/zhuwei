import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubmitKpProposalBundleModelInput } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { isInventoryOperationSource } from '../../../app/_runtime/lib/kp/vnext/authored-proposal-contract.ts';
import { assertDeepSeekStrictToolModelInput } from '../../../app/_runtime/lib/kp/deepseek.ts';
import { expandDeepSeekSchema, schemaVariants } from '../../support/fixtures/expand-deepseek-schema.mjs';
import { VNEXT_PROPOSAL_GUIDANCE_POLICY, VNEXT_PROPOSAL_CONTEXT_GUIDE, vnextProposalTaskInstruction } from '../../../app/_runtime/lib/kp/vnext/proposal-guidance.ts';
import { promiseFixture, makePromiseInput, dueWork } from '../../support/fixtures/vnext-promise-lifecycle.mjs';
import { prepareNpcWorkRequest, npcWorkModelInput, npcWorkRulesInput } from '../../../app/_runtime/lib/kp/vnext/npc-work.ts';
import { proposalModelContext } from '../../../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { sentContext } from '../../support/fixtures/vnext-request-layout.mjs';
import { promiseReviewModelInput, parsePromiseReview } from '../../../app/_runtime/lib/kp/vnext/promise-review.ts';
import { createNpcReplySchema } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { deepSeekStrictToolSchemaIssues } from '../../../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { NPC_REPLY_POLICY, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';

function surface(capabilities) {
  const request = createSubmitKpProposalBundleModelInput('冻结上下文', capabilities, [], [], [], []);
  assertDeepSeekStrictToolModelInput(request);
  // Guidance is split across the two messages: the system message holds the
  // guide, the frozen context and the stage's rules, and what this call must
  // do comes last. This suite asks what the model is told, so it reads both.
  return { prompt: request.messages.map(message => message.content).join('\n'),
    schema: expandDeepSeekSchema(request.tools[0].function.parameters) };
}

// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): who writes which part of a
// conversation. The reply's prompt and form are what the NPC's own call is sent.
const replyPrompt = NPC_REPLY_POLICY.instruction;
function replyForm(worldFactHandles = []) {
  const schema = createNpcReplySchema(['success', 'failure'], 'npc:one', { npcRef: 'npc:one', refs: ['npc:one'], factRefs: [] },
    { observationSubjectRefs: [], itemEntryRefs: [] }, worldFactHandles);
  assert.deepEqual(deepSeekStrictToolSchemaIssues(schema), []);
  return expandDeepSeekSchema(schema);
}

test('the ruling writes no reply; the reply teaches its own fields and the string player-expression source offered by its tool', () => {
  const RULING = ['newPromises', 'npcPerceives', 'outcomeCode', 'promiseChanges', 'summary'];
  for (const capabilities of [['social'], ['social', 'materializeObject']]) {
    const { prompt, schema } = surface(capabilities);
    const step = schema.properties.steps.properties.social.items, result = step.properties.result;
    assert.deepEqual(Object.keys(result.properties).sort(), RULING);
    // The step a check decides writes the same ruling on both results.
    const checked = schema.properties.check.properties.social.items;
    for (const side of ['success', 'failure']) assert.deepEqual(checked.properties[side], result);
    assert.ok(prompt.includes('对方说什么、答应什么由其本人另行作答'), 'the ruling is told who writes the reply');
    assert.ok(prompt.includes('本表不写对方的台词、动机、承诺、债务或关系变化'), 'and what it therefore leaves out');
    assert.ok(prompt.includes('它只读本人的记录、记忆和在场所见来回答'), 'and what the NPC reads');
    assert.equal(/response对象|response\.text|response\.basis|responseKind|responseText|responseBasis|results行|relationshipChanges|newDebts/.test(prompt), false,
      'the ruling is given no instruction for a field it does not have');
    assert.equal(prompt.includes(replyPrompt), false, 'the reply\'s rules are not sent to the ruling');
  }
  for (const handles of [[], ['prospective:new-fact']]) {
    const form = replyForm(handles);
    assert.deepEqual(Object.keys(form.properties), ['success', 'failure']);
    for (const result of Object.values(form.properties)) {
      assert.deepEqual(Object.keys(result.properties), ['kind', 'text', 'motive', 'basis', 'introducedContent', 'relationshipChanges', 'newPromises', 'promiseChanges', 'newDebts']);
      const source = result.properties.basis.items;
      const existing = source.anyOf?.find(value => value.type === 'string') ?? source;
      assert.deepEqual(existing, { type: 'string', enum: ['npc:one', 'playerExpression'] });
      assert.equal(source.anyOf !== undefined, handles.length > 0, 'a new fact form is offered only for a fact this plan gives the NPC');
    }
  }
  assert.ok(replyPrompt.includes('每种情形填kind、text、motive、basis和四张表'), 'the reply\'s guidance identifies the offered fields');
  assert.ok(replyPrompt.includes('只凭刚听到的话回答时选"playerExpression"'));
  assert.ok(replyPrompt.includes(`调用${NPC_REPLY_TOOL_NAME}一次`));
  assert.equal(/\{kind:"playerExpression"\}|summary|outcomeCode|goal|method|DC|检定/.test(replyPrompt), false,
    'the reply is told nothing of the ruling\'s own vocabulary');
});

// SPEC 0001 §14: the NPC knows what it knows. Asked about something its own
// view does not hold, it says so; round 152 had Lian point to a shrine that
// only the host's material knew.
test('the reply is bound to the NPC\'s own view and says what it does not know', () => {
  assert.ok(replyPrompt.includes('view是你本人知道的全部'));
  assert.ok(replyPrompt.includes('明确不知道的事仍不知道；资料未加载不等于留白'));
  assert.ok(replyPrompt.includes('自己的感受、态度和日常寒暄照常回答'), 'not knowing a fact does not silence the person');
  assert.ok(replyPrompt.includes('听到对方的说法不等于这个说法是真的'));
  assert.ok(replyPrompt.includes('你可以按自己的目标和顾虑如实回答、隐瞒、夸张、误信或说谎'));
});

// SPEC 0016 §7.3: a social check decides persuasion/deception itself;
// noticing a separate concealed act does not make its distracting talk the check.
test('social guidance assigns the check to persuasion, deception or intimidation itself', () => {
  const { prompt } = surface(['social', 'inventoryOperation']);
  assert.ok(prompt.includes('检定决定这次交谈能否说服、欺瞒或威吓对方时'), 'the conversation is the check step');
  assert.equal(prompt.includes('是否察觉隐蔽举动'), false);
  assert.ok(prompt.includes('另写对他的social绑onFailure；不写则只留察觉记录，不新增反应调用'));
  // What the observer then says is the observer's own: it answers what it noticed.
  assert.ok(replyPrompt.includes('perceived是这种情形下你亲眼看到、亲耳听到对方做的事'));
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
  assert.ok(prompt.includes('问话和寻常交谈不掷骰；'), 'a question is answered without a roll');
  assert.ok(prompt.includes('要对方做不愿做的事、说出想瞒的事或相信可疑的话（说服、欺瞒、威吓等），结果确实不定时才检定'),
    'persuasion, deception and intimidation roll when the result is truly uncertain');
  assert.equal(prompt.includes('透露或相信，而对方未必同意时'), false, 'a request she might refuse is no longer a roll by itself');
  assert.ok(prompt.includes('success表示这番话起了作用，failure表示没有起作用，对方在两种结果下各自作答'), 'both reactions come from the listener');
  // The listener is told only whether the words took effect, and answers as itself.
  assert.ok(replyPrompt.includes('swayed=yes表示这番话对你起了作用，你被说动、相信了或被镇住了；no表示没有起作用；notAsked表示这只是平常交谈'));
});

// SPEC 0001 §12: the KP never answers for a player. The social guidance must
// stop an NPC line from presuming the player's reply, and route reply-dependent
// commitments through terms.activation so the promise stays pending.
test('social guidance forbids presuming the player reply and routes reply-dependent promises through activation', () => {
  const { prompt } = surface(['social']);
  assert.ok(prompt.includes('玩家没有说过的话不能写进actorSpeech或summary'), 'the ruling puts no words in the player\'s mouth');
  assert.ok(replyPrompt.includes('不替对方回答，不假定对方说过hearing.speech以外的话'), 'NPC lines must not answer for the player');
  assert.ok(replyPrompt.includes('把问题问出来就结束这句话'), 'a question to the player ends the NPC line');
  assert.ok(replyPrompt.includes('条件必须写进terms.activation'), 'reply-dependent promises must use activation');
});

// SPEC 0009 §2: each check branch keeps its outcome text, NPC line and
// consequences inside its own summary, so a failed roll cannot hand over a
// clue that only the NPC line or failureOutcome mentions.
test('check branches keep their consequences within that branch summary, and a conversation summary states no reply', () => {
  for (const capabilities of [['social'], ['observe'], ['worldInteraction']]) {
    const { prompt } = surface(capabilities);
    assert.ok(prompt.includes('同分支后果不超出其summary'), `${capabilities}: branch content stays within its summary`);
    assert.ok(prompt.includes('失败给的线索须写进失败summary'), `${capabilities}: a failure lead is declared in the failure summary`);
  }
  // The reply is written after the ruling, by a call that does not read the
  // summary; a summary that stated a reply could contradict the words spoken.
  assert.ok(surface(['social']).prompt.includes('summary只写裁决层面的结果（这番话是否起作用、交谈是否进行），不写对方说了什么、答应了什么或透露了什么'));
});

// SPEC 0006 §4, SPEC 0010 O02: people present who plainly see or hear an act
// each get their own sensory evidence, so an NPC knows what just happened in
// front of it -- without the actor's intent or private findings.
test('observation and world interaction guidance record what present NPCs plainly perceive, as their own evidence of the actor', () => {
  for (const capabilities of [['worldInteraction'], ['worldInteraction', 'social'], ['observe'], ['observe', 'inventoryOperation']]) {
    const { prompt } = surface(capabilities);
    assert.ok(prompt.includes('在场NPC或他人能察觉行动者的举动时，各写一条其所见所闻'), `${capabilities}: witnesses get evidence`);
    assert.ok(prompt.includes('subjectRef填行动者，不含行动者意图或独得发现'), `${capabilities}: evidence is of the act, not the intent`);
    assert.ok(prompt.includes('另写对他的social绑onFailure；不写则只留察觉记录'), `${capabilities}: a noticed hidden act is answered on the failing side`);
    assert.ok(prompt.includes('得手才发生的取物等操作绑onSuccess'), `${capabilities}: what only a success brings is bound to success`);
    assert.ok(prompt.includes('隐蔽举动由Rules按察觉结果给每名察觉者noticedEvidence，不另写见证'), `${capabilities}: bystanders of a covert act are Rules' to decide`);
  }
});

// SPEC 0016 §7.3, SPEC 0005 §6.2: a covert act's check carries no model DC;
// the model names the primary observer and rates the present characters'
// attention from the frozen context.
test('a covert act is ruled with concealedCheck: primary observer and attention tiers, no DC', () => {
  for (const capabilities of [['worldInteraction'], ['social'], ['observe']]) {
    const { prompt } = surface(capabilities);
    assert.ok(prompt.includes('瞒着在场者的举动或话，decision.kind用concealedCheck代替check，不填DC，由Rules按主要对象的被动察觉定DC'), `${capabilities}: covert acts use concealedCheck`);
    assert.ok(prompt.includes('primaryObserverRef填主要瞒着的在场者（通常是交谈对象），检定步骤的success只写动作本身的结果，不写此人是否察觉，failure写察觉后的本步结果'), `${capabilities}: failure describes its own result; the observer reply has its own step`);
    assert.ok(prompt.includes('observers只列要改档的在场NPC：Rules默认正在做事的人distracted、其余unfocused，改档须引用冻结上下文里关于此人的记录'), `${capabilities}: Rules gives the default, the model changes it only on a record`);
    assert.ok(prompt.includes('行动者对他人注意力的说法不是依据：watching看着行动者或有戒心，distracted分心'), `${capabilities}: the actor's claims are no basis; the tiers`);
    assert.ok(prompt.includes('noticedEvidence从察觉者的角度写其会看到或听到的行动者举动，以名字或外貌称呼行动者'), `${capabilities}: a noticer's memory is in the noticer's own view`);
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

// SPEC 0016 §7.2: an amendment adds only the types the intent needs.
// Rounds 128 and 130 amended the hidden leaf theft with materializeObject,
// completeObject or commitNarrativeDetail and Naes's decision view, and the
// amended request rebuilt at 60,687 estimated tokens. A type is needed when a
// step of the intent must be filled with it; an NPC is loaded to talk with it
// or when its reaction or knowledge bears on the ruling, not to record what
// it noticed.
test('the amendable round adds only types a step must be filled with, and loads an NPC only to talk with or to rule on', () => {
  const amendable = vnextProposalTaskInstruction('expandedProposal', true);
  assert.ok(amendable.includes('只有原意图中某一步必须用未加载的类型填写时，才改为调用选择工具一次性补齐这些类型ID'));
  assert.ok(amendable.includes('要与在场NPC交谈、或其反应与知识影响裁决时才填requestedNpcRefs，只记录其察觉不必加载'));
  assert.equal(vnextProposalTaskInstruction('expandedProposal', false).includes('requestedNpcRefs'), false,
    'the submit-only round offers no amendment');
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
  const basis = replyForm(['prospective:new-fact']).properties.success.properties.basis;
  const source = basis.items.anyOf.find(value => value.properties?.worldFactRef);
  assert.deepEqual(Object.keys(source.properties), ['worldFactRef']);
  assert.deepEqual(source.properties.worldFactRef.enum, ['prospective:new-fact']);
  assert.doesNotMatch(basis.description, /consumes|kind=npcContext|holderRef/);
  // The ruling is told how a new fact reaches the NPC.
  assert.ok(surface(['social', 'materializeObject']).prompt.includes('须在同束显式固化always的worldFact并把该npcRef列入initialKnowledge，对方作答时才知道它'));
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
  // The table says whose promise a row is; the ruling's two are the actor's.
  assert.ok(!Object.hasOwn(promise.properties, 'promisor'));
  assert.ok(promise.properties.terms.properties.parts);
  assert.ok(promise.properties.terms.properties.activation);
  const change = row.properties.promiseChanges.items;
  assert.ok(!Object.hasOwn(change.properties, 'expressionSource'));
  assert.ok(change.properties.expressionQuote);
  for (const field of ['promiseeRef', 'newPromises', 'promiseChanges', 'expressionQuote']) {
    assert.ok(prompt.includes(field), `the fixed instructions must describe ${field}`);
  }
  assert.match(prompt, /newPromises只记录玩家本次明确承诺：content精确复用actorSpeech/);
  assert.match(prompt, /promiseChanges绑定原promiseRef\/revision，expressionQuote精确复用actorSpeech/);
  // The NPC's own tables, in the NPC's own form and prompt. The quote of its
  // change is its reply's text, which the server writes.
  const reply = replyForm().properties.success.properties;
  assert.ok(!Object.hasOwn(reply.newPromises.items.properties, 'promisor'));
  for (const field of ['expressionSource', 'expressionQuote']) assert.ok(!Object.hasOwn(reply.promiseChanges.items.properties, field), field);
  for (const field of ['promiseeRef', 'relationshipChanges', 'newPromises', 'promiseChanges', 'newDebts', 'authorityRefs', 'nextStep']) {
    assert.ok(replyPrompt.includes(field), `the reply's instructions must describe ${field}`);
  }
  assert.ok(replyPrompt.includes('你在text里答应将来做事或持续遵守约束时，newPromises必须有对应记录'));
  assert.ok(replyPrompt.includes('promiseChanges绑定原promiseRef和revision，只登记text里真实说出口的变更'));
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
