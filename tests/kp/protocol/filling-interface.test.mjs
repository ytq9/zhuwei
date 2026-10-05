import { replacementArguments } from "../../support/fixtures/vnext-revision-response.mjs";
import { stepOf, stepPath, decodedIndex, reordered, withAllGroups } from '../../support/fixtures/vnext-wire-tables.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeVNextStrictToolBundle, decodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, createVNextProposalBundleSchema,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, invokeSubmitKpProposalBundleWithOneCorrection,
  assertRepairTicket } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { vnextEntryProducerContract } from '../../../app/_runtime/lib/kp/vnext/proposal-producer-contract.ts';
import { canonicalHash } from '../../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { validateVNextProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-validator.ts';
import { deepSeekStrictToolSchemaIssues } from '../../../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { matchesAuthoredSourceSchema } from '../../../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from '../../../app/_runtime/lib/rules/profiles/semantic-templates.ts';
import { expandDeepSeekSchema, schemaVariants } from '../../support/fixtures/expand-deepseek-schema.mjs';
import { sharedCheckBundle } from '../../support/fixtures/vnext-shared-check.mjs';
import { itemBundle, hazardBundle } from '../../support/fixtures/vnext-authored-bundles.mjs';
import { worldFactSocialBundle } from '../../support/fixtures/vnext-world-facts.mjs';
import { socialResultArgumentDiagnostics, proposalFillingDiagnostics, VNEXT_FILLING_STEP_KEYS } from '../../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts';
import { VNEXT_PROPOSAL_CAPABILITIES } from '../../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts';
import { sentRevision, sentTurns } from '../../support/fixtures/vnext-request-layout.mjs';
import { npcReplyArguments, parseWithNpcReplies, toolCallResponse, UNBOUND } from '../../support/fixtures/vnext-npc-replies.mjs';
import { createNpcReplySchema } from '../../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { npcReplyDiagnostics, npcReplySteps, readNpcReply, NPC_REPLY_TOOL_NAME } from '../../../app/_runtime/lib/kp/vnext/npc-reply.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const parsed = wire => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
// Fixtures explicitly use the existing strict-tool null sentinel before encoding.
// Nullable text fields take the bare "none" string on the wire; nullable
// references and objects take {kind:'none'}.
const NULLABLE_TEXT = new Set(['npcPerceives', 'actionHint']);
function strictWire(value) {
  if (value === null) return { kind: 'none' };
  if (Array.isArray(value)) return value.map(strictWire);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, child === null && NULLABLE_TEXT.has(key) ? 'none' : strictWire(child)])) : value;
}
const wireFor = value => encodeVNextStrictToolBundle(strictWire(value));
const request = { modelId: 'scripted-local', message: '冻结原意图。', requiredContext: { intent: { actorRef: 'character:player', submissionRef: 'submission:filling-interface', text: '完成原定的行动。' }, entries: [],
  references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: 'sha256:filling-interface-test' } } };
function response(value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] } }] };
}
function clarification(value) {
  return { mode: 'terminal', basisRefs: [], adjudication: null, proposals: [], terminal: { kind: 'clarification',
    intent: '选择原定方案。', method: '先确认再行动。', question: '采用哪个方案？',
    choices: ['first', 'second'].map(choiceId => ({ choiceId, label: choiceId, publicRisk: '保留原风险。', basisRefs: [],
      continuation: { kind: 'adjudication', basisRefs: value.basisRefs, adjudication: value.adjudication, proposals: clone(value.proposals) } })) } };
}
function diagnostics(wire) {
  try { const result = parsed(wire); assert.equal(result.kind, 'locallyRejected', JSON.stringify(result)); return result.diagnostics; }
  catch (error) { if (Array.isArray(error.diagnostics)) return error.diagnostics; throw error; }
}
function diagnosticAt(wire, path, code, base = 'draft') {
  const values = diagnostics(wire);
  const detail = values.find(detail => JSON.stringify(detail.path) === JSON.stringify(path));
  assert.ok(detail, JSON.stringify(values));
  assert.equal(detail.code, code, JSON.stringify(detail));
  assert.equal(detail.pathBase ?? 'draft', base);
  assert.ok(detail.constraint);
  return detail;
}
async function rejectsUnchangedRevision(wire) {
  const before = clone(wire); let calls = 0;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket(ticket) { assert.equal(ticket.originalArguments, JSON.stringify(before)); },
    binding: { async run(_model, input) { return ++calls === 1 ? response(wire) : response(replacementArguments(input, wire), CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME); } } });
  // An unchanged draft ends the conversation at once; any other reply that is
  // no revision earns one more round, which the double answers the same way.
  assert.ok(calls === 2 || calls === 3, JSON.stringify(result)); assert.equal(result.kind, 'rejected');
  assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
  assert.equal(result.repairUsed, true); assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.every(detail => detail.repair.allowed === false));
  assert.deepEqual(wire, before); return result;
}

const families = () => [sharedCheckBundle('observe'), sharedCheckBundle('worldInteraction'), itemBundle(), hazardBundle(),
  worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story' }),
  worldFactSocialBundle({ sceneRef: 'scene:other', npcRef: 'npc:second', check: true,
    description: '他曾经向乡里的木匠学习修理椅子。', response: '我以前帮木匠修理过椅子。' })];

// SPEC 0016 §7.3, SPEC 0006 §7 (ADR 0073): the ruling's form holds the actor's
// two tables; the NPC's own reply holds its words and its four tables.
const socialTables = ['relationshipChanges', 'newPromises', 'promiseChanges', 'newDebts'];
const rulingTables = ['newPromises', 'promiseChanges'];
const socialKinds = ['relationship', 'promise', 'promiseChange', 'debt'];
const author = record => record.promisor === 'actor' || record.expressionSource === 'actor' ? 'actor' : 'npc';
function socialTableBundle(checked = false) {
  const source = worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story', check: checked });
  const terms = { kind: 'ongoing', subjectRefs: ['npc:story'], delivery: null, parts: [], activation: null };
  const social = source.proposals[1], change = { kind: 'amend', accepted: true, reason: '依据现有约定同意延期。',
    content: '继续保密。', condition: '立即生效。', terms, deadlineFictionMicros: '7200000000', releasedParts: [], remaining: true };
  // Deliberately interleaved internal fixtures of both authors; each table
  // preserves its author's subsequence, and the merged plan assembles kinds in
  // the one documented order with the actor's rows before the NPC's.
  social.branches.success.consequences = [
    { kind: 'debt', obligation: '归还借用的工具。', condition: '使用后归还。', basisFactRefs: ['fact:loan'] },
    { kind: 'promise', content: '我会保守这件事。', condition: '立即生效。', promisor: 'npc', promiseeRef: 'character:player',
      authorityRefs: ['npc:story'], due: '1h', terms, nextStep: null },
    { kind: 'promiseChange', promiseRef: 'continuity:promises:mine', revision: '1', expressionSource: 'actor',
      expressionQuote: social.actorSpeech, disclose: true, change },
    { kind: 'relationship', relationshipRef: null, change: '愿意继续听取解释。', basisFactRefs: [] },
    // The quote of an NPC's change is the reply's own text; the server writes it.
    { kind: 'promiseChange', promiseRef: 'continuity:promises:earlier', revision: '1', expressionSource: 'npc',
      expressionQuote: social.branches.success.response.text, disclose: true, change },
    { kind: 'promise', content: social.actorSpeech, condition: '立即生效。', promisor: 'actor', promiseeRef: 'npc:story',
      authorityRefs: ['character:player'], due: '1h', terms, nextStep: null },
    { kind: 'promise', content: '我会尊重这次约定。', condition: '立即生效。', promisor: 'npc', promiseeRef: 'character:player',
      authorityRefs: ['npc:story'], due: '1h', terms, nextStep: null },
  ];
  return source;
}
/** The complete plan: the ruling's wire with the replies the domain states,
 * written with the same sentinels as the ruling's wire. */
const complete = (domain, change = args => args) => parseWithNpcReplies(wireFor(domain), domain, undefined, { change: (args, step) => change(strictWire(args), step) });

test('the two forms preserve every typed record of their author, explicit empties and checked or clarification branches', () => {
  for (const checked of [false, true]) for (const nested of [false, true]) {
    const source = socialTableBundle(checked), domain = nested ? clarification(source) : source, wire = wireFor(domain);
    const plans = nested ? wire.decision.choices.map(choice => choice.continuation) : [wire];
    for (const plan of plans) {
      // The step a check decides writes both results in check; otherwise its
      // one result sits in steps, with no failure to write.
      const step = checked ? plan.check.social[0] : plan.steps.social[0], success = checked ? step.success : step.result;
      assert.deepEqual(Object.keys(success).sort(), ['newPromises', 'npcPerceives', 'outcomeCode', 'promiseChanges', 'summary']);
      assert.deepEqual(rulingTables.map(field => success[field].length), [1, 1]);
      // The actor's promise is its own words and its change quotes them: the
      // server writes both from actorSpeech, so the form asks for neither
      // (round 176's KP wrote half the sentence as the promise).
      for (const field of rulingTables) assert.ok(success[field].every(record =>
        !['kind', 'promisor', 'expressionSource', 'expressionQuote', 'content'].some(key => Object.hasOwn(record, key))));
      if (checked) for (const field of rulingTables) assert.deepEqual(step.failure[field], []);
      else assert.equal(Object.hasOwn(step, 'failure'), false);
      assert.equal(checked ? plan.steps.social : plan.check, undefined);
    }
    assert.equal(matchesAuthoredSourceSchema(withAllGroups(wire), expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA)), true);
    // A ruling alone is accepted with every reply still awaited.
    const ruling = parsed(wire); assert.equal(ruling.kind, 'accepted', JSON.stringify(ruling));
    // Each NPC answers once for what it hears: two choices that let it hear the same are one reply.
    const replies = npcReplyArguments(domain, UNBOUND);
    assert.equal(replies.length, nested ? 2 : 1);
    assert.equal(new Set(replies.map(reply => reply.step.hearingHash)).size, 1);
    for (const { step, arguments: reply } of replies) {
      assert.deepEqual(Object.keys(reply), checked ? ['success', 'failure'] : ['result']);
      const success = reply[checked ? 'success' : 'result'];
      // ADR 0076: the reply also lists what it newly brings up, here nothing.
      assert.deepEqual(Object.keys(success), ['kind', 'text', 'motive', 'basis', 'introducedContent', ...socialTables]);
      assert.deepEqual(success.introducedContent, []);
      assert.deepEqual(socialTables.map(field => success[field].length), [1, 2, 1, 1]);
      for (const field of socialTables) assert.ok(success[field].every(record =>
        !['kind', 'promisor', 'expressionSource', 'expressionQuote'].some(key => Object.hasOwn(record, key))));
      if (checked) for (const field of socialTables) assert.deepEqual(reply.failure[field], []);
      const form = expandDeepSeekSchema(createNpcReplySchema(Object.keys(step.hearing.outcomes), 'npc:story', { npcRef: 'npc:story', refs: [], factRefs: [] },
        { observationSubjectRefs: [], itemEntryRefs: [] }, step.hearing.newKnowledge.map(fact => fact.handle)));
      assert.deepEqual(Object.keys(form.properties).sort(), Object.keys(reply).sort());
      for (const result of Object.values(form.properties)) assert.deepEqual([...result.required].sort(), Object.keys(success).sort());
    }
    const result = complete(domain); assert.equal(result.kind, 'accepted', JSON.stringify(result));
    for (const plan of nested ? result.bundle.terminal.choices.map(choice => choice.continuation) : [result.bundle]) {
      const original = source.proposals[1].branches.success;
      assert.deepEqual(plan.proposals[1].branches.success.consequences, socialKinds.flatMap(kind =>
        ['actor', 'npc'].flatMap(side => original.consequences.filter(record => record.kind === kind && author(record) === side))));
      assert.deepEqual(plan.proposals[1].branches.success.response, original.response);
      if (checked) assert.deepEqual(plan.proposals[1].branches.failure.consequences, []);
      else assert.equal(plan.proposals[1].branches.failure, null);
    }
    for (const plan of nested ? ruling.bundle.terminal.choices.map(choice => choice.continuation) : [ruling.bundle]) {
      assert.deepEqual(plan.proposals[1].branches.success.consequences.map(record => [record.kind, author(record)]),
        [['promise', 'actor'], ['promiseChange', 'actor']]);
      assert.equal(plan.proposals[1].branches.success.response.motive, 'npc-reply:pending');
    }
  }
});

const SOCIAL = ['steps', 'social', 0, 'result'];
/** What a saved reply reads as, by the form it was asked with. */
function replyReading(domain, change = args => args) {
  const [{ step, arguments: reply }] = npcReplyArguments(domain, UNBOUND);
  return readNpcReply(toolCallResponse(NPC_REPLY_TOOL_NAME, change(strictWire(clone(reply)))), step.hearing);
}
function replyDiagnosticAt(domain, change, path, code) {
  const reading = replyReading(domain, change);
  assert.equal(reading.kind, 'unreadable', JSON.stringify(reading));
  const detail = reading.diagnostics.find(detail => JSON.stringify(detail.path) === JSON.stringify(path));
  assert.ok(detail, JSON.stringify(reading.diagnostics));
  assert.equal(detail.code, code); assert.equal(detail.pathBase, 'arguments'); assert.equal(detail.repair.allowed, true);
  return detail;
}

test('each social table must be explicit and typed; mixed legacy records never get silently dropped or repaired', async () => {
  const original = wireFor(socialTableBundle());
  // The reply's four tables obey the same rules in the reply's own coordinates.
  assert.equal(replyReading(socialTableBundle()).kind, 'read');
  for (const field of socialTables) {
    replyDiagnosticAt(socialTableBundle(), reply => { delete reply.result[field]; return reply; }, ['result', field], 'FIELD_MISSING');
    replyDiagnosticAt(socialTableBundle(), reply => { reply.result[field] = {}; return reply; }, ['result', field], 'TYPE_MISMATCH');
    replyDiagnosticAt(socialTableBundle(), reply => { reply.result[field] = [null]; return reply; }, ['result', field, 0], 'TYPE_MISMATCH');
    replyDiagnosticAt(socialTableBundle(), reply => { reply.result[field][0].kind = 'debt'; return reply; }, ['result', field, 0, 'kind'], 'CONSTRAINT_CONFLICT');
  }
  // The server says whose row it is and writes the quote of the NPC's own change.
  replyDiagnosticAt(socialTableBundle(), reply => { reply.result.newPromises[0].promisor = 'npc'; return reply; }, ['result', 'newPromises', 0, 'promisor'], 'CONSTRAINT_CONFLICT');
  replyDiagnosticAt(socialTableBundle(), reply => { reply.result.promiseChanges[0].expressionQuote = '原话'; return reply; }, ['result', 'promiseChanges', 0, 'expressionQuote'], 'CONSTRAINT_CONFLICT');
  replyDiagnosticAt(socialTableBundle(), reply => { reply.result.kind = 'silence'; reply.result.text = ''; return reply; }, ['result', 'promiseChanges'], 'CONSTRAINT_CONFLICT');
  for (const field of ['consequences', 'response', 'summary', 'outcomeCode', 'npcPerceives'])
    replyDiagnosticAt(socialTableBundle(), reply => { reply.result[field] = field === 'consequences' ? [] : '多余'; return reply; }, ['result', field], 'CONSTRAINT_CONFLICT');
  // What belongs to the reply has no place in the ruling's form.
  for (const field of ['response', 'relationshipChanges', 'newDebts']) {
    const misplaced = clone(original); misplaced.steps.social[0].result[field] = field === 'response' ? { kind: 'silence', text: '', motive: '无', basis: [] } : [];
    const detail = diagnosticAt(misplaced, [...SOCIAL, field], 'CONSTRAINT_CONFLICT', 'arguments');
    assert.equal(detail.constraint, 'social:reply-belongs-to-the-npc');
    await rejectsUnchangedRevision(misplaced);
  }
  for (const field of rulingTables) {
    const missing = clone(original); delete missing.steps.social[0].result[field];
    diagnosticAt(missing, [...SOCIAL, field], 'FIELD_MISSING', 'arguments');
    await rejectsUnchangedRevision(missing);
    const wrongType = clone(original); wrongType.steps.social[0].result[field] = {};
    diagnosticAt(wrongType, [...SOCIAL, field], 'TYPE_MISMATCH', 'arguments');
    const wrongRow = clone(original); wrongRow.steps.social[0].result[field] = [null];
    diagnosticAt(wrongRow, [...SOCIAL, field, 0], 'TYPE_MISMATCH', 'arguments');
    const tagged = clone(original); tagged.steps.social[0].result[field][0].kind = 'debt';
    diagnosticAt(tagged, [...SOCIAL, field, 0, 'kind'], 'CONSTRAINT_CONFLICT', 'arguments');
    await rejectsUnchangedRevision(tagged);
  }
  for (const [field, side] of [['newPromises', 'promisor'], ['promiseChanges', 'expressionSource']]) {
    const sided = clone(original); sided.steps.social[0].result[field][0][side] = 'actor';
    diagnosticAt(sided, [...SOCIAL, field, 0, side], 'CONSTRAINT_CONFLICT', 'arguments');
    await rejectsUnchangedRevision(sided);
  }
  const legacy = clone(original); legacy.steps.social[0].result.consequences = [];
  diagnosticAt(legacy, [...SOCIAL, 'consequences'], 'CONSTRAINT_CONFLICT', 'arguments');
  await rejectsUnchangedRevision(legacy);
  const crossed = clone(original); crossed.steps.social[0].result.newPromises = crossed.steps.social[0].result.promiseChanges;
  assert.ok(diagnostics(crossed).some(d => d.pathBase === 'arguments' && d.path[4] === 'newPromises'));
  await rejectsUnchangedRevision(crossed);
  const colliding = socialTableBundle(); colliding.proposals[1].branches.success.newPromises = [];
  assert.throws(() => wireFor(colliding), /PROPOSAL_RESULT_INTERNAL_FIELD_COLLISION/);
  const unknown = socialTableBundle(); unknown.proposals[1].branches.success.consequences[0].kind = 'unknown';
  assert.throws(() => wireFor(unknown), /PROPOSAL_SOCIAL_CONSEQUENCE_KIND_UNAVAILABLE/);
  const incomplete = socialTableBundle(); delete incomplete.proposals[1].branches.success.consequences;
  assert.ok(diagnostics(wireFor(incomplete)).length > 0);
});

test('social table diagnostics locate the submitted step, branch and table row, with or without the original arguments', async () => {
  for (const nested of [false, true]) {
    const source = socialTableBundle(true), wire = wireFor(nested ? clarification(source) : source);
    const plan = nested ? wire.decision.choices[1].continuation : wire;
    const prefix = nested ? ['decision', 'choices', 1, 'continuation'] : [];
    plan.check.social[0].success.newPromises[0].authorityRefs = [];
    const detail = diagnosticAt(wire, [...prefix, 'check', 'social', 0, 'success', 'newPromises', 0, 'authorityRefs'], 'VALUE_INVALID', 'arguments');
    assert.equal(detail.repair.allowed, false);
    const replayed = parsed(JSON.parse(JSON.stringify(wire)));
    assert.deepEqual(replayed.diagnostics, parsed(wire).diagnostics);
    const canonical = validateVNextProposalBundle(replayed.draft).diagnostics;
    // A step's place on the wire follows from the draft alone: its group and
    // its order within the group are the decode order, so an internal
    // consumer without the original arguments reaches the same row.
    const consequenceDiagnostics = canonical.filter(d => d.path?.includes('consequences'));
    assert.ok(consequenceDiagnostics.length > 0);
    assert.deepEqual(socialResultArgumentDiagnostics(replayed.draft, consequenceDiagnostics), replayed.diagnostics);
    assert.deepEqual(socialResultArgumentDiagnostics(replayed.draft, consequenceDiagnostics, wire), replayed.diagnostics);
    await rejectsUnchangedRevision(wire);
    // A row of the NPC's is located in the reply that wrote it, whatever rows
    // of the actor's the merged plan puts before it; the ruling is sent none of it.
    const domain = nested ? clarification(source) : source;
    const merged = complete(domain, reply => { reply.success.newPromises[1].authorityRefs = []; return reply; });
    assert.equal(merged.kind, 'locallyRejected', JSON.stringify(merged));
    const frame = nested ? ['terminal', 'choices', 0, 'continuation'] : [];
    assert.deepEqual(merged.diagnostics.map(d => d.path).find(path => JSON.stringify(path.slice(0, frame.length)) === JSON.stringify(frame)),
      [...frame, 'proposals', 1, 'branches', 'success', 'consequences', 3, 'authorityRefs']);
    const steps = npcReplySteps(merged.ruling, UNBOUND);
    // Rebuild the refused plan to read the rows the diagnostics name.
    const refused = clone(merged.ruling);
    for (const plan of nested ? refused.terminal.choices.map(choice => choice.continuation) : [refused]) {
      const rows = clone(source.proposals[1].branches.success.consequences); rows[6].authorityRefs = [];
      plan.proposals[1].branches.success.consequences = socialKinds.flatMap(kind => ['actor', 'npc'].flatMap(side => rows.filter(record => record.kind === kind && author(record) === side)));
    }
    const split = npcReplyDiagnostics(refused, steps, merged.diagnostics);
    assert.deepEqual(split.ruling, []);
    assert.deepEqual([...split.replies.keys()], [steps[0].hearingHash]);
    for (const routed of split.replies.get(steps[0].hearingHash)) {
      assert.equal(routed.pathBase, 'arguments');
      assert.deepEqual(routed.path, ['success', 'newPromises', 1, 'authorityRefs']);
    }
  }
  const overloaded = wireFor(socialTableBundle());
  const result = overloaded.steps.social[0].result;
  result.newPromises = Array.from({ length: 17 }, () => clone(result.newPromises[0]));
  diagnosticAt(overloaded, SOCIAL, 'VALUE_INVALID', 'arguments');
  await rejectsUnchangedRevision(overloaded);
  // Sixteen rows a result: a ruling that fits alone can be overfilled by the
  // reply, and then it is the reply that is asked to shorten.
  const full = socialTableBundle(), rows = full.proposals[1].branches.success.consequences;
  rows.push(...Array.from({ length: 10 }, () => clone(rows[5])));
  const overfilled = complete(full); assert.equal(overfilled.kind, 'locallyRejected', JSON.stringify(overfilled).slice(0, 600));
  const tooLong = npcReplyDiagnostics(overfilled.ruling, npcReplySteps(overfilled.ruling, UNBOUND), overfilled.diagnostics);
  assert.deepEqual(tooLong.ruling, []);
  assert.deepEqual([...tooLong.replies.values()].flat().map(d => d.path), [['result']]);
});

test('one explicit result list assembles world and observation collections without changing their contents or ruling', () => {
  for (const kind of ['worldInteraction', 'observe']) {
    const original = sharedCheckBundle(kind), owner = original.proposals[1], at = decodedIndex(original, 1);
    if (kind === 'observe') {
      owner.branches.success.sensoryEvidence.push({ ...clone(owner.branches.success.sensoryEvidence[0]), evidence: '另一次声音变得断续。' });
      owner.branches.success.characterInferences.push({ conclusion: '压力可能尚未稳定。', confidence: '依据声音变化作有限推测。',
        evidence: [{ kind: 'sensoryEvidence', index: 1 }] });
    }
    const wire = wireFor(original), result = stepOf(wire, original, 1).success;
    assert.deepEqual(Object.keys(result).sort(), ['entries', 'outcomeCode', 'summary']);
    assert.ok(result.entries.some(entry => entry.recordKind === 'sensoryEvidence'));
    if (kind === 'observe') {
      // Inference indices retain the sensory subsequence, even if an inference
      // is filled before those observations in the single presentation list.
      result.entries.unshift(result.entries.pop());
    }
    const decoded = parsed(wire); assert.equal(decoded.kind, 'accepted', JSON.stringify(decoded));
    assert.deepEqual(decoded.bundle.adjudication, original.adjudication);
    assert.deepEqual(decoded.bundle.proposals[at].branches.success, original.proposals[1].branches.success);
    assert.deepEqual(decoded.bundle.proposals[at].branches.failure, original.proposals[1].branches.failure);
    assert.deepEqual(decoded.bundle.proposals[decodedIndex(original, 0)].branches.success.effects, original.proposals[0].branches.success.effects);
    const empty = clone(wire); stepOf(empty, original, 1).success.entries = [];
    const explicitNone = parsed(empty); assert.equal(explicitNone.kind, 'accepted');
    assert.deepEqual(explicitNone.bundle.proposals[at].branches.success.sensoryEvidence, []);
    assert.deepEqual(explicitNone.bundle.proposals[at].branches.success[kind === 'observe' ? 'characterInferences' : 'effects'], []);
  }
});

test('missing result lists and mixed form result kinds reject once without guessing effects or deleting inferences', async () => {
  for (const kind of ['worldInteraction', 'observe']) {
    const source = sharedCheckBundle(kind), original = wireFor(source), owner = [...stepPath(source, 1), 'success'];
    const missing = clone(original); delete stepOf(missing, source, 1).success.entries;
    diagnosticAt(missing, [...owner, 'entries'], 'FIELD_MISSING', 'arguments');
    const mixed = clone(original); stepOf(mixed, source, 1).success.entries.push({
      recordKind: kind === 'worldInteraction' ? 'characterInferences' : 'effects', conclusion: '不得在另一表单中删除或猜测这份结果。',
    });
    const index = stepOf(mixed, source, 1).success.entries.length - 1;
    const detail = diagnosticAt(mixed, [...owner, 'entries', index, 'recordKind'], 'VALUE_INVALID', 'arguments');
    assert.equal(detail.expected.enum.includes(kind === 'worldInteraction' ? 'characterInferences' : 'effects'), false);
    const legacy = clone(original); stepOf(legacy, source, 1).success.sensoryEvidence = [];
    diagnosticAt(legacy, [...owner, 'sensoryEvidence'], 'CONSTRAINT_CONFLICT', 'arguments');
    for (const wire of [missing, mixed, legacy]) await rejectsUnchangedRevision(wire);
  }
});

test('the internal fixture encoder cannot erase a colliding field or turn a malformed collection into a complete result', () => {
  const envelope = sharedCheckBundle('worldInteraction');
  envelope.proposals[1].branches.success.entries = [];
  assert.throws(() => wireFor(envelope), /PROPOSAL_RESULT_INTERNAL_FIELD_COLLISION/);
  const entry = sharedCheckBundle('observe');
  entry.proposals[1].branches.success.sensoryEvidence[0].recordKind = 'characterInferences';
  assert.throws(() => wireFor(entry), /PROPOSAL_RESULT_INTERNAL_FIELD_COLLISION/);
  const incomplete = sharedCheckBundle('worldInteraction');
  delete incomplete.proposals[1].branches.success.effects;
  assert.ok(diagnostics(wireFor(incomplete)).length > 0);
});

test('the advertised interface is a ruling, the one step a check decides with both results, and every other step with at most one', () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const schema = expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA);
  assert.deepEqual(Object.keys(schema.properties), ['decision', 'check', 'steps']);
  for (const kind of ['directSuccess', 'check']) {
    const plan = schema.properties.decision.anyOf.find(value => value.properties.kind.enum.includes(kind));
    assert.ok(plan); assert.equal('steps' in plan.properties, false); assert.equal('check' in plan.properties, false);
  }
  const steps = schema.properties.steps;
  assert.equal(steps.type, 'object'); assert.equal(steps.additionalProperties, false);
  assert.deepEqual(steps.required, Object.keys(steps.properties).sort());
  // Every non-native capability is a group, in the fixed execution order.
  assert.deepEqual(Object.keys(steps.properties), VNEXT_FILLING_STEP_KEYS);
  assert.deepEqual([...VNEXT_FILLING_STEP_KEYS].sort(), VNEXT_PROPOSAL_CAPABILITIES.filter(entry => entry.surface !== 'native').map(entry => entry.id).sort());
  const resultKinds = ['worldInteraction', 'observe', 'social'];
  const without = ({ description: _description, ...rest }) => rest;
  const results = {};
  for (const [key, group] of Object.entries(steps.properties)) {
    assert.equal(group.type, 'array');
    const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === key);
    const branchKind = resultKinds.includes(key);
    for (const step of schemaVariants(group.items)) {
      assert.equal(step.additionalProperties, false);
      assert.deepEqual(step.required, Object.keys(step.properties).sort());
      for (const name of ['kind', 'consumes', 'produces', 'templateHash', 'communication', 'branches', 'success', 'failure']) assert.equal(name in step.properties, false, `${key}.${name}`);
      assert.ok('outcomeBinding' in step.properties);
      const contract = vnextEntryProducerContract({ kind: capability.proposalKind, source: { kind: step.properties.source?.properties?.kind?.enum?.[0] } });
      assert.ok(contract); assert.equal('handle' in step.properties, contract.count === 1);
      assert.equal('result' in step.properties, branchKind, key);
      if (key === 'worldInteraction') {
        assert.ok('directTargetRefs' in step.properties); assert.ok('otherTargetRefs' in step.properties);
        assert.equal('targetRefs' in step.properties, false);
      }
      if (!branchKind) continue;
      const result = step.properties.result;
      assert.equal(result.type, 'object'); assert.equal(result.additionalProperties, false);
      assert.deepEqual(result.required, Object.keys(result.properties).sort());
      for (const name of ['kind', 'step', 'branch']) assert.equal(name in result.properties, false, `${key}.result.${name}`);
      results[key] = result;
      if (key === 'social') {
        // The ruling writes no reply: neither the words nor what the NPC undertakes.
        assert.deepEqual(Object.keys(result.properties).sort(), ['newPromises', 'npcPerceives', 'outcomeCode', 'promiseChanges', 'summary']);
        for (const field of rulingTables) {
          const table = result.properties[field];
          assert.equal(table.type, 'array');
          assert.equal(table.items.type, 'object');
          assert.equal(table.items.additionalProperties, false);
          assert.deepEqual(table.items.required, Object.keys(table.items.properties).sort());
          assert.equal('kind' in table.items.properties, false);
        }
      } else assert.ok('entries' in result.properties);
    }
  }
  // check: one group per result type, each row the same step with two
  // required results of one form -- neither side is optional or lesser -- and
  // no binding, since the roll picks the result.
  const check = schema.properties.check;
  assert.equal(check.type, 'object'); assert.equal(check.additionalProperties, false);
  assert.deepEqual(Object.keys(check.properties), VNEXT_FILLING_STEP_KEYS.filter(key => resultKinds.includes(key)));
  assert.deepEqual(check.required, Object.keys(check.properties).sort());
  for (const [key, group] of Object.entries(check.properties)) {
    assert.equal(group.type, 'array');
    const [row] = schemaVariants(group.items), [plain] = schemaVariants(steps.properties[key].items);
    assert.equal(row.additionalProperties, false);
    assert.deepEqual(row.required, Object.keys(row.properties).sort());
    assert.equal('outcomeBinding' in row.properties, false); assert.equal('result' in row.properties, false);
    assert.deepEqual(Object.keys(row.properties).filter(name => !['success', 'failure'].includes(name)).sort(),
      Object.keys(plain.properties).filter(name => !['result', 'outcomeBinding'].includes(name)).sort());
    // Both results are the same form with no description of their own, and
    // the same form as a steps row's one result.
    assert.deepEqual(row.properties.success, row.properties.failure);
    assert.deepEqual(row.properties.success, results[key]);
    assert.equal(row.properties.success.description, undefined);
  }
  // A selection loads only its own groups, closed over dependencies, in the same order.
  const timerOnly = expandDeepSeekSchema(createVNextProposalBundleSchema(['formActorPlan']));
  assert.deepEqual(Object.keys(timerOnly.properties), ['decision', 'steps']);
  assert.deepEqual(Object.keys(timerOnly.properties.steps.properties), ['formActorPlan']);
  const itemOnly = expandDeepSeekSchema(createVNextProposalBundleSchema(['authorItem']));
  assert.deepEqual(Object.keys(itemOnly.properties.steps.properties), ['authorItem', 'materializeItem', 'inventoryOperation']);
  for (const selection of [['formActorPlan'], ['authorItem'], ['social', 'observe', 'worldInteraction']]) {
    assert.deepEqual(deepSeekStrictToolSchemaIssues(createVNextProposalBundleSchema(selection)), [], selection.join());
  }
});

test('steps decode group by group in the fixed order; a terminal decision sends empty groups; retired tables are refused', async () => {
  const source = sharedCheckBundle('observe'), wire = wireFor(source);
  // The step the check decides is written in check; the other steps in steps.
  assert.deepEqual(Object.keys(wire.check), ['observe']);
  assert.deepEqual(Object.keys(wire.steps), ['worldInteraction']);
  const accepted = parsed(wire); assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
  assert.deepEqual(accepted.bundle.proposals.map(entry => [entry.kind, entry.outcomeBinding]),
    [['worldInteraction', 'onSuccess'], ['worldInteraction', 'onFailure'], ['observe', 'always']]);
  assert.deepEqual(accepted.bundle.proposals[2].branches, source.proposals[1].branches);
  // The key order the model happened to write does not matter; the groups do.
  const shuffled = { steps: wire.steps, check: wire.check, decision: wire.decision };
  assert.equal(parsed(shuffled).bundleHash, accepted.bundleHash);
  // A restated kind that agrees with the group says nothing; one that disagrees is refused.
  const restated = clone(wire); restated.steps.worldInteraction[0].kind = 'worldInteraction';
  assert.equal(parsed(restated).bundleHash, accepted.bundleHash);
  const stray = clone(wire); stray.steps.worldInteraction[0].kind = 'observe';
  diagnosticAt(stray, ['steps', 'worldInteraction', 0, 'kind'], 'VALUE_INVALID', 'arguments');
  const terminal = { decision: { kind: 'knowledgeReview', inquiry: '我知道什么？', scope: 'allKnown', knowledgeRefs: [] },
    check: { observe: [], worldInteraction: [] }, steps: { observe: [], worldInteraction: [] } };
  assert.equal(parsed(terminal).kind, 'accepted', JSON.stringify(parsed(terminal)));
  const filledTerminal = { ...terminal, steps: { worldInteraction: wire.steps.worldInteraction } };
  diagnosticAt(filledTerminal, ['steps', 'worldInteraction'], 'CONSTRAINT_CONFLICT', 'arguments');
  const checkedTerminal = { ...terminal, check: { observe: wire.check.observe } };
  diagnosticAt(checkedTerminal, ['check', 'observe'], 'CONSTRAINT_CONFLICT', 'arguments');
  const results = { ...wire, results: [] };
  diagnosticAt(results, ['results'], 'VALUE_INVALID', 'arguments');
  const nestedSteps = { decision: { ...wire.decision, steps: wire.steps }, check: wire.check, steps: wire.steps };
  diagnosticAt(nestedSteps, ['decision', 'steps'], 'CONSTRAINT_CONFLICT', 'arguments');
  const nestedCheck = { decision: { ...wire.decision, check: wire.check }, check: wire.check, steps: wire.steps };
  diagnosticAt(nestedCheck, ['decision', 'check'], 'CONSTRAINT_CONFLICT', 'arguments');
  const listed = { ...wire, steps: [] };
  diagnosticAt(listed, ['steps'], 'TYPE_MISMATCH', 'arguments');
  const unknownGroup = clone(wire); unknownGroup.steps.bogus = [{}];
  diagnosticAt(unknownGroup, ['steps', 'bogus'], 'VALUE_INVALID', 'arguments');
  const notArray = clone(wire); notArray.steps.observe = {};
  diagnosticAt(notArray, ['steps', 'observe'], 'TYPE_MISMATCH', 'arguments');
  const unknownCheck = clone(wire); unknownCheck.check.inventoryOperation = [];
  diagnosticAt(unknownCheck, ['check', 'inventoryOperation'], 'VALUE_INVALID', 'arguments');
  const single = clone(wire); single.check.observe[0].result = single.check.observe[0].success;
  diagnosticAt(single, ['check', 'observe', 0, 'result'], 'CONSTRAINT_CONFLICT', 'arguments');
  // SPEC 0016 §7.3: a check has exactly one step with both results, and only a check has one.
  // A check names the key of the step it decides; an empty check is reported
  // at that key, and at check itself when the name is absent.
  assert.equal(wire.decision.checkStep, 'observe');
  const unchecked = clone(wire); unchecked.check.observe = [];
  assert.equal(diagnosticAt(unchecked, ['check', 'observe'], 'FIELD_MISSING', 'arguments').constraint, 'filling:check-step-required');
  const unnamed = clone(unchecked); delete unnamed.decision.checkStep;
  assert.equal(diagnosticAt(unnamed, ['check'], 'FIELD_MISSING', 'arguments').constraint, 'filling:check-step-required');
  // The row is what counts: a name that points at another key changes nothing.
  const misnamed = clone(wire); misnamed.decision.checkStep = 'worldInteraction';
  assert.equal(parsed(misnamed).bundleHash, accepted.bundleHash);
  const twice = clone(wire); twice.check.observe.push(clone(wire.check.observe[0]));
  assert.equal(diagnosticAt(twice, ['check'], 'CONSTRAINT_CONFLICT', 'arguments').constraint, 'filling:one-check-step');
  const direct = clone(wire); direct.decision = { kind: 'directSuccess', risk: '没有有意义的风险。', successOutcome: '阀门开启。', duration: '5min' };
  diagnosticAt(direct, ['check', 'observe', 0], 'CONSTRAINT_CONFLICT', 'arguments');
  const namedDirect = { ...clone(wire), check: { observe: [] }, steps: { ...clone(wire.steps), observe: [clone(wire.check.observe[0])] } };
  namedDirect.decision = { ...direct.decision, checkStep: 'observe' };
  assert.equal(diagnosticAt(namedDirect, ['decision', 'checkStep'], 'CONSTRAINT_CONFLICT', 'arguments').constraint, 'filling:check-step-needs-a-check');
  // A steps row has one result; two results belong to the check step only.
  const doubled = clone(wire); doubled.steps.worldInteraction[0].success = doubled.steps.worldInteraction[0].result;
  diagnosticAt(doubled, ['steps', 'worldInteraction', 0, 'success'], 'CONSTRAINT_CONFLICT', 'arguments');
  const bound = clone(wire); bound.check.observe[0].outcomeBinding = 'onSuccess';
  diagnosticAt(bound, ['check', 'observe', 0, 'outcomeBinding'], 'VALUE_INVALID', 'arguments');
  for (const bad of [stray, filledTerminal, checkedTerminal, results, nestedSteps, nestedCheck, unknownGroup, notArray, unknownCheck, single,
    unchecked, unnamed, twice, direct, namedDirect, doubled, bound]) await rejectsUnchangedRevision(bad);
});

test('different item, hazard, knowledge and interaction families use the same codec and full validator including continuations', () => {
  for (const source of families()) for (const nested of [false, true]) {
    const original = nested ? clarification(source) : source, before = clone(original), wire = wireFor(original);
    assert.equal(matchesAuthoredSourceSchema(withAllGroups(wire), expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA)), true, JSON.stringify(wire));
    const result = parsed(wire);
    assert.equal(result.kind, 'accepted', JSON.stringify(result));
    assert.equal(validateVNextProposalBundle(result.bundle).kind, 'accepted');
    assert.equal(result.bundleHash, canonicalHash(result.bundle));
    const plans = nested ? result.bundle.terminal.choices.map(choice => choice.continuation) : [result.bundle];
    for (const plan of plans) {
      assert.deepEqual(plan.proposals.map(entry => clone(entry.produces)), reordered(source).proposals.map(entry => entry.produces));
      assert.deepEqual(plan.adjudication, source.adjudication);
    }
    assert.deepEqual(original, before);
  }
});

test('direct results acquire no failure while a check preserves its unique owner and both frozen outcomes', () => {
  const direct = parsed(wireFor(hazardBundle())); assert.equal(direct.kind, 'accepted');
  assert.equal(direct.bundle.proposals[2].branches.failure, null);
  assert.equal(direct.bundle.proposals[2].outcomeBinding, 'always');
  const source = sharedCheckBundle('worldInteraction'), checked = wireFor(source);
  // The step the check decides carries both results in check; the others one
  // result each in steps, with the binding that says when it happens.
  assert.deepEqual(checked.steps.worldInteraction.map(step => [step.outcomeBinding, 'result' in step, 'failure' in step]),
    [['onSuccess', true, false], ['onFailure', true, false]]);
  assert.deepEqual(checked.check.worldInteraction.map(step => ['outcomeBinding' in step, 'success' in step, 'failure' in step]),
    [[false, true, true]]);
  const accepted = parsed(checked); assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.bundle.proposals.map(entry => entry.outcomeBinding), ['always', 'onSuccess', 'onFailure']);
  assert.deepEqual(accepted.bundle.proposals[decodedIndex(source, 1)].branches, source.proposals[1].branches);
  const missing = clone(checked); delete missing.check.worldInteraction[0].failure;
  diagnosticAt(missing, ['proposals', decodedIndex(source, 1), 'branches', 'failure'], 'FIELD_MISSING');
  const noOwner = clone(checked); noOwner.check.worldInteraction[0].failure = { kind: 'none' };
  assert.ok(diagnostics(noOwner).some(value => value.code === 'CONSTRAINT_CONFLICT'));
  const duplicate = clone(checked); duplicate.check.worldInteraction.push(clone(duplicate.check.worldInteraction[0]));
  assert.ok(diagnostics(duplicate).some(value => value.code === 'CONSTRAINT_CONFLICT'));
});

test('inventory operations use their own operation payload and never acquire a result of their own', async () => {
  const full = itemBundle(), wire = wireFor(full);
  assert.deepEqual(Object.keys(wire.steps), ['authorAbility', 'authorItem', 'materializeItem', 'inventoryOperation']);
  assert.equal(parsed(wire).kind, 'accepted');
  const invalid = clone(wire);
  invalid.steps.inventoryOperation[0].success = { outcomeCode: 'acquired', summary: 'The item is now held.', consequences: [] };
  const detail = diagnosticAt(invalid, ['steps', 'inventoryOperation', 0, 'success'], 'CONSTRAINT_CONFLICT', 'arguments');
  assert.equal(detail.constraint, 'filling:result-not-supported-by-type');
  await rejectsUnchangedRevision(invalid);
  // A step filed under another type's group is that type, never its own claim.
  const misfiled = clone(wire); misfiled.steps.worldInteraction = [{ ...misfiled.steps.inventoryOperation[0], kind: 'inventoryOperation' }];
  diagnosticAt(misfiled, ['steps', 'worldInteraction', 0, 'kind'], 'VALUE_INVALID', 'arguments');
  // Deleting the bad result alone must not bless the undeclared item handle
  // seen in the screenshot. A producer is still required in this bundle.
  const orphan = clone(wire);
  orphan.steps = { inventoryOperation: [orphan.steps.inventoryOperation[0]] };
  assert.equal(parsed(orphan).kind, 'locallyRejected');
});

test('server derives typed producer declarations, prospective dependencies, public source union and exact catalog hashes', () => {
  const item = parsed(wireFor(itemBundle())); assert.equal(item.kind, 'accepted');
  assert.deepEqual(item.bundle.proposals.map(step => step.produces.map(item => item.kind)),
    [['abilityDefinition'], ['itemDefinition'], ['itemEntry'], [], []]);
  assert.deepEqual(item.bundle.proposals.map(step => step.consumes.filter(ref => ref.kind === 'prospective').map(ref => ref.handle)),
    [[], ['prospective:mechanics'], ['prospective:item-definition'], ['prospective:item-entry'], ['prospective:item-entry']]);
  const world = worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story' }), wire = wireFor(world);
  const accepted = parsed(wire); assert.equal(accepted.kind, 'accepted');
  const template = VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.find(item => item.templateRef === wire.steps.materializeObject[0].templateRef);
  assert.equal(accepted.bundle.proposals[0].templateHash, template.templateHash);
  assert.equal(accepted.bundle.proposals[1].communication, 'spokenConversation');
  assert.deepEqual(accepted.bundle.basisRefs, ['npc:story']);
  // The ruling's own conversation step names no new fact. The reply cites the
  // fact the plan gave its NPC, and the merged step depends on its producer.
  assert.deepEqual(accepted.bundle.proposals[1].consumes, [{ kind: 'existing', ref: 'npc:story' }]);
  const merged = complete(world); assert.equal(merged.kind, 'accepted', JSON.stringify(merged));
  assert.deepEqual(merged.bundle.proposals[1].consumes, [{ kind: 'existing', ref: 'npc:story' }, { kind: 'prospective', handle: 'prospective:new-experience' }]);
  const missingTemplate = clone(wire); delete missingTemplate.steps.materializeObject[0].templateRef;
  diagnosticAt(missingTemplate, ['steps', 'materializeObject', 0, 'templateRef'], 'FIELD_MISSING', 'arguments');
  const unknownTemplate = clone(wire); unknownTemplate.steps.materializeObject[0].templateRef = 'template:unknown';
  diagnosticAt(unknownTemplate, ['steps', 'materializeObject', 0, 'templateRef'], 'REFERENCE_UNAVAILABLE', 'arguments');
  const wrongTemplateType = clone(wire); wrongTemplateType.steps.materializeObject[0].templateRef = 17;
  diagnosticAt(wrongTemplateType, ['steps', 'materializeObject', 0, 'templateRef'], 'TYPE_MISMATCH', 'arguments');
});

test('explicit causal and knowledge sources stay attached to their step and are never inferred from targets', () => {
  const original = sharedCheckBundle('worldInteraction');
  original.proposals[1].consumes = [{ kind: 'existing', ref: 'evidence:chosen-source' }];
  original.proposals[1].targetRefs = ['definition:other-target']; original.proposals[1].directTargetRefs = ['definition:other-target'];
  const wire = wireFor(original), decoded = decodeVNextStrictToolBundle(wire);
  assert.deepEqual(stepOf(wire, original, 1).basisRefs, ['definition:probe-valve', 'evidence:chosen-source']);
  assert.deepEqual(decoded.proposals[decodedIndex(original, 0)].basisRefs, ['definition:probe-valve']);
  const owner = decoded.proposals[decodedIndex(original, 1)];
  assert.deepEqual(clone(owner.consumes), [{ kind: 'existing', ref: 'definition:probe-valve' }, { kind: 'existing', ref: 'evidence:chosen-source' }]);
  assert.equal(owner.consumes.some(ref => ref.ref === 'definition:other-target'), false);
  const world = worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story', holders: ['npc:story', 'npc:companion'] });
  const accepted = complete(world); assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.bundle.proposals[0].basisRefs, []);
  assert.deepEqual(accepted.bundle.proposals[0].definition.worldFact, world.proposals[0].definition.worldFact);
  assert.deepEqual(accepted.bundle.proposals[1].branches.success.response.basis, world.proposals[1].branches.success.response.basis);
});

test('wrong prospective type, missing producer, duplicate producer and cross-outcome consumption fail in the existing validator', async () => {
  const wrongType = wireFor(itemBundle()); wrongType.steps.authorItem[0].source.content.use.abilityRef = 'prospective:item-entry';
  const missingProducer = wireFor(itemBundle()); missingProducer.steps.authorItem[0].source.content.use.abilityRef = 'prospective:missing';
  const duplicate = wireFor(itemBundle()); duplicate.steps.authorItem[0].handle = duplicate.steps.authorAbility[0].handle;
  // A fact made only on success is not given to the NPC, whose reply is
  // written for both outcomes; a reply that cites it anyway is refused.
  const conditional = worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story', check: true });
  conditional.proposals[0].outcomeBinding = 'onSuccess'; conditional.proposals[0].produces[0].outcomeBinding = 'onSuccess';
  const crossOutcome = complete(conditional);
  assert.equal(crossOutcome.kind, 'unreadable', JSON.stringify(crossOutcome).slice(0, 600));
  assert.deepEqual(npcReplySteps(crossOutcome.ruling, UNBOUND)[0].hearing.newKnowledge, []);
  assert.deepEqual(crossOutcome.diagnostics.map(detail => [detail.constraint, detail.path]), [
    ['npc-reply:new-fact-not-given', ['success', 'basis', 0, 'worldFactRef']], ['npc-reply:new-fact-not-given', ['failure', 'basis', 0, 'worldFactRef']]]);
  for (const wire of [wrongType, missingProducer, duplicate]) {
    const candidate = parsed(wire); assert.equal(candidate.kind, 'locallyRejected', JSON.stringify(candidate));
    assert.equal(validateVNextProposalBundle(candidate.draft).kind, 'rejected');
    assert.ok(candidate.diagnostics.some(detail => ['REFERENCE_UNAVAILABLE', 'CONSTRAINT_CONFLICT'].includes(detail.code)), JSON.stringify(candidate.diagnostics));
    await rejectsUnchangedRevision(wire);
  }
});

test('retired shells, mixed shapes and model-supplied derived fields still fail when repeated in a revision', async () => {
  const valid = wireFor(itemBundle());
  for (const wire of [
    itemBundle(), { ...valid, proposals: [] }, { ...valid, mode: 'adjudication' }, { ...valid, results: [] },
    ...['adjudication', 'terminal', 'proposals', 'basisRefs'].map(key => ({ decision: { ...clone(valid.decision), [key]: [] } })),
    ...['produces', 'consumes', 'templateHash', 'communication', 'branches', 'outcomeBinding'].map(key => {
      const wire = clone(valid); wire.steps.authorAbility[0][key] = 'injected'; return wire;
    }),
    (() => { const wire = clone(valid); wire.steps.authorAbility[0].kind = 'worldInteraction'; return wire; })(),
    (() => { const wire = clone(valid); wire.steps.authorAbility[0].source.kind = 'item'; return wire; })(),
    (() => { const wire = clone(valid); wire.steps.retired = [clone(wire.steps.authorAbility[0])]; return wire; })(),
    (() => { const wire = wireFor(hazardBundle()); wire.steps.worldInteraction[0].targetRefs = []; return wire; })(),
    (() => { const wire = wireFor(hazardBundle()); wire.steps.worldInteraction[0].handle = 'prospective:undeclared'; return wire; })(),
    (() => { const wire = wireFor(hazardBundle()); wire.steps.worldInteraction[0].success = clone(wire.steps.worldInteraction[0].result); return wire; })(),
    (() => { const wire = wireFor(sharedCheckBundle()); stepOf(wire, sharedCheckBundle(), 1).failure = {}; return wire; })(),
  ]) await rejectsUnchangedRevision(wire);
});

test('unknown fields survive decoding so the complete validator rejects them instead of silently dropping them', async () => {
  for (const change of [
    wire => { wire.decision.unexpected = 'preserve-to-reject'; },
    wire => { wire.steps.authorAbility[0].unexpected = 'preserve-to-reject'; },
    wire => { wire.steps.worldInteraction[0].result.unexpected = 'preserve-to-reject'; },
  ]) {
    const wire = wireFor(hazardBundle()); change(wire);
    const candidate = parsed(wire); assert.equal(candidate.kind, 'locallyRejected');
    assert.ok(JSON.stringify(candidate.draft).includes('preserve-to-reject'));
    assert.ok(candidate.diagnostics.some(detail => detail.path?.at(-1) === 'unexpected'), JSON.stringify(candidate.diagnostics));
    await rejectsUnchangedRevision(wire);
  }
});

test('missing fields identify their actual arguments or decoded draft path and never invent a ruling', async () => {
  diagnosticAt({}, ['decision'], 'FIELD_MISSING', 'arguments');
  diagnosticAt({ decision: {} }, ['decision', 'kind'], 'FIELD_MISSING', 'arguments');
  diagnosticAt({ decision: { kind: 12 } }, ['decision', 'kind'], 'TYPE_MISMATCH', 'arguments');
  const injectedEnvelope = { ...wireFor(itemBundle()), kind: 'check' };
  diagnosticAt(injectedEnvelope, ['kind'], 'CONSTRAINT_CONFLICT', 'arguments');
  await rejectsUnchangedRevision(injectedEnvelope);
  const missingSteps = wireFor(itemBundle()); delete missingSteps.steps;
  diagnosticAt(missingSteps, ['steps'], 'FIELD_MISSING', 'arguments');
  const missingDc = wireFor(sharedCheckBundle()); delete missingDc.decision.dc;
  diagnosticAt(missingDc, ['adjudication', 'dc'], 'FIELD_MISSING');
  const missingHandle = wireFor(itemBundle()); delete missingHandle.steps.authorAbility[0].handle;
  diagnosticAt(missingHandle, ['proposals', 0, 'produces', 0, 'handle'], 'FIELD_MISSING');
  const missingResult = wireFor(hazardBundle()); delete missingResult.steps.worldInteraction[0].result;
  diagnosticAt(missingResult, ['proposals', 2, 'branches', 'success'], 'FIELD_MISSING');
  // Either result of the check step missing is the same missing field.
  const checked = sharedCheckBundle('observe'), owner = decodedIndex(checked, 1);
  const missingSuccess = wireFor(checked); delete missingSuccess.check.observe[0].success;
  diagnosticAt(missingSuccess, ['proposals', owner, 'branches', 'success'], 'FIELD_MISSING');
  const missingFailure = wireFor(checked); delete missingFailure.check.observe[0].failure;
  diagnosticAt(missingFailure, ['proposals', owner, 'branches', 'failure'], 'FIELD_MISSING');
  for (const wire of [missingSteps, missingDc, missingHandle, missingResult, missingSuccess, missingFailure]) await rejectsUnchangedRevision(wire);
});

test('complete revisions correct whitespace across families and preserve exact original arguments', async () => {
  for (const original of families()) for (const nested of [false, true]) {
    const source = nested ? clarification(original) : original, wire = wireFor(source), expected = parsed(wire).bundle;
    const decision = nested ? wire.decision.choices[1].continuation : wire.decision;
    decision.risk = ` ${decision.risk} `;
    const originalArguments = JSON.stringify(wire); let calls = 0, ticket;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, input) {
        calls++; if (calls === 1) return response(wire);
        assertRepairTicket(ticket, request.requiredContext.binding.contextHash);
        const prompt = sentRevision(input);
        assert.equal(ticket.originalArguments, originalArguments); assert.equal(prompt.sourceDraft, 'asReplied');
        assert.equal(sentTurns(input).at(-1).call.function.arguments, originalArguments);
        assert.ok(prompt.diagnostics.every(detail => detail.pathBase === "arguments"));
        assert.ok(prompt.diagnostics.some(detail => detail.path?.at(-1) === 'risk'));
        return response(replacementArguments(input, wireFor(source)), CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(calls, 2); assert.equal(result.invocationCount, 2);
    assert.deepEqual(clone(result.bundle), clone(expected)); assert.equal(JSON.stringify(wire), originalArguments);
  }
});

test('unparsed JSON admits one complete revised proposal with its original source preserved; closers after the complete root decode without a call', async () => {
  for (const source of [itemBundle(), sharedCheckBundle('worldInteraction'),
    { mode: 'terminal', basisRefs: [], adjudication: null, proposals: [],
      terminal: { kind: 'knowledgeReview', inquiry: '我知道什么？', scope: 'allKnown', knowledgeRefs: [] } }]) {
  const wire = wireFor(source), fullArguments = JSON.stringify(wire);
  // A complete root object followed only by closing delimiters is that object:
  // no ticket, no second call.
  let direct = 0;
  const decoded = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request, persistRepairTicket() { assert.fail('no ticket'); },
    binding: { async run() { direct++; const value = response(wire); value.choices[0].message.tool_calls[0].function.arguments = fullArguments + ']}'; return value; } } });
  assert.equal(decoded.kind, 'locallyAccepted', JSON.stringify(decoded)); assert.equal(direct, 1);
  assert.deepEqual(clone(decoded.bundle), clone(parsed(wire).bundle));
  for (const originalArguments of [fullArguments.slice(0, -1), fullArguments.slice(0, -1) + ']}}']) {
  let calls = 0, ticket;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, input) {
      calls++;
      if (calls === 1) { const value = response(wire); value.choices[0].message.tool_calls[0].function.arguments = originalArguments; return value; }
      assert.equal(ticket.originalArguments, originalArguments); assert.equal(ticket.sourceDraft, null);
      assertRepairTicket(ticket, request.requiredContext.binding.contextHash);
      assert.ok(ticket.diagnostics.some(detail => detail.code === 'JSON_SYNTAX' && detail.pathBase === 'arguments' && detail.location));
      return response(replacementArguments(input, wire), CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    } } });
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(calls, 2);
  assert.deepEqual(clone(result.bundle), clone(parsed(wire).bundle));
  }
  }
});


test('direct and additional targets retain their distinct roles while the server derives their combined target set', async () => {
  const wire = wireFor(hazardBundle()), step = wire.steps.worldInteraction[0];
  assert.deepEqual(step.otherTargetRefs, []); assert.equal('targetRefs' in step, false);
  const direct = step.directTargetRefs[0]; step.otherTargetRefs = ['definition:affected-neighbor'];
  const result = parsed(wire); assert.equal(result.kind, 'accepted', JSON.stringify(result));
  assert.deepEqual(result.bundle.proposals[2].directTargetRefs, [direct]);
  assert.deepEqual(result.bundle.proposals[2].targetRefs, [direct, 'definition:affected-neighbor']);
  assert.equal(result.bundle.proposals[2].consumes.some(ref => ref.ref === 'definition:affected-neighbor'), false);
  for (const value of [undefined, null, 'definition:wrong-shape']) {
    const malformed = clone(wire);
    if (value === undefined) delete malformed.steps.worldInteraction[0].otherTargetRefs;
    else malformed.steps.worldInteraction[0].otherTargetRefs = value;
    diagnosticAt(malformed, ['steps', 'worldInteraction', 0, 'otherTargetRefs'], value === undefined ? 'FIELD_MISSING' : 'TYPE_MISMATCH', 'arguments');
    await rejectsUnchangedRevision(malformed);
  }
  const inventory = wireFor(itemBundle());
  assert.deepEqual(inventory.steps.inventoryOperation[1].operation.targetRefs, itemBundle().proposals[4].operation.targetRefs);
});

test('the ruling and every failing step are diagnosed together, so one correction can fix them all', () => {
  // Round 106 fixed the one error it was told about and then failed on the
  // next one the validator had not reached.
  const wire = wireFor(itemBundle({ acquire: true, use: true }));
  wire.decision.risk = ` ${wire.decision.risk} `; wire.steps.authorItem[0].summary = ''; wire.steps.materializeItem[0].summary = '';
  const values = diagnostics(wire), paths = values.map(detail => detail.path.join('/'));
  assert.ok(paths.includes('adjudication/risk'), JSON.stringify(values));
  assert.ok(paths.some(path => path.startsWith('proposals/1/')), JSON.stringify(values));
  assert.ok(paths.some(path => path.startsWith('proposals/2/')), JSON.stringify(values));
  assert.equal(parsed(wire).kind, 'locallyRejected');
});

test('every problem of a step, of its results and of the entries the form cannot take is reported together', () => {
  // Rounds 109, 113 and 114 were told one field of one step per round.
  const source = sharedCheckBundle('worldInteraction'), wire = wireFor(source), owner = stepPath(source, 1).join('/');
  const step = stepOf(wire, source, 1);
  step.success.entries = [{ recordKind: 'characterInferences' }, { recordKind: 'bogus' }, ...step.success.entries];
  delete step.directTargetRefs; delete step.otherTargetRefs;
  step.handle = 'prospective:not-a-producer';
  step.outcomeBinding = 'never';
  const paths = diagnostics(wire).map(detail => detail.path.join('/'));
  for (const tail of ['success/entries/0/recordKind', 'success/entries/1/recordKind', 'directTargetRefs', 'otherTargetRefs', 'handle']) {
    assert.ok(paths.includes(`${owner}/${tail}`), `${tail}: ${JSON.stringify(paths)}`);
  }
});

test('problems across several groups and steps are reported in one pass', () => {
  const wire = wireFor(hazardBundle());
  wire.steps.worldInteraction[0].handle = 'prospective:not-a-producer';
  delete wire.steps.worldInteraction[0].directTargetRefs;
  wire.steps.authorHazard[0].success = { kind: 'none' };
  wire.steps.bogus = [{}];
  const paths = diagnostics(wire).map(detail => detail.path.join('/'));
  for (const path of ['steps/worldInteraction/0/handle', 'steps/worldInteraction/0/directTargetRefs', 'steps/authorHazard/0/success', 'steps/bogus']) {
    assert.ok(paths.includes(path), `${path}: ${JSON.stringify(paths)}`);
  }
});

test('a step of a type the selection did not load is named beside the filling\'s other problems', async () => {
  const { vnextProposalRevisionCandidate } = await import('../../../app/_runtime/lib/kp/vnext/proposal-provider.ts');
  // Round 115: three rounds fixed the rows, then the unloaded worldInteraction was reported.
  const source = sharedCheckBundle('worldInteraction'), wire = wireFor(source);
  delete stepOf(wire, source, 1).success.entries;
  const candidate = vnextProposalRevisionCandidate(response(wire), ['observe'], []);
  assert.equal(candidate.kind, 'locallyRejected'); assert.equal(candidate.validationCode, 'PROPOSAL_WIRE_INVALID');
  const paths = candidate.diagnostics.map(detail => `${detail.constraint}@${detail.path.join('/')}`);
  assert.ok(paths.includes('filling:complete-result-entries-required@check/worldInteraction/0/success/entries'), JSON.stringify(paths));
  for (const container of ['check', 'steps']) assert.ok(paths.includes(`proposal:capability-not-loaded@${container}/worldInteraction`), JSON.stringify(paths));
  // The same unloaded group on a filling that otherwise decodes is named at the group as well.
  const decodable = vnextProposalRevisionCandidate(response(wireFor(source)), ['observe'], []);
  assert.equal(decodable.kind, 'locallyRejected');
  const mapped = proposalFillingDiagnostics(decodable.draft, decodable.diagnostics, wireFor(source));
  assert.ok(mapped.some(detail => detail.constraint === 'proposal:capability-not-loaded'
    && ['check/worldInteraction', 'steps/worldInteraction'].includes(detail.path.join('/'))), JSON.stringify(mapped));
});

// SPEC 0016 §7.2: recoverable representation errors remain rejected, while
// independent domain errors are returned against the untouched original draft.
test('recoverable filling errors and domain errors share one correction without losing content or coordinates', async () => {
  const wire = wireFor(sharedCheckBundle('worldInteraction'));
  wire.steps.npcRecall = [{ evidence: '保留这段内容并迁到合法步骤。' }];
  const result = wire.check.worldInteraction[0].success;
  result.opportunities = [{ description: '现在可以继续检查阀门。', targetRef: 'definition:probe-valve', actionHint: '继续检查。', basisRefs: ['definition:probe-valve'] }];
  result.entries[0].recordKind = 'effects';
  wire.steps.worldInteraction[1].method = '  ';
  const original = JSON.stringify(wire), candidate = parsed(wire);
  assert.equal(candidate.kind, 'locallyRejected');
  assert.equal(candidate.validationCode, 'PROPOSAL_WIRE_INVALID');
  assert.equal(candidate.originalArguments, original);
  const paths = proposalFillingDiagnostics(candidate.draft, candidate.diagnostics, wire).map(d => d.path.join('.'));
  for (const path of ['steps.npcRecall', 'check.worldInteraction.0.success.opportunities',
    'check.worldInteraction.0.success.entries.0', 'steps.worldInteraction.1.method']) {
    assert.ok(paths.some(p => p === path || p.startsWith(path + '.')), JSON.stringify(candidate.diagnostics));
  }
  const misplaced = candidate.diagnostics.find(d => d.path.at(-1) === 'opportunities');
  assert.equal(misplaced.expected.recordKind, 'opportunities');
  assert.match(misplaced.expected.repair, /preserv/);
  assert.throws(() => decodeVNextStrictToolBundle(wire));
  const corrected = wireFor(sharedCheckBundle('worldInteraction'));
  corrected.check.worldInteraction[0].success.entries.push({ recordKind: 'opportunities', ...result.opportunities[0] });
  let calls = 0;
  const repaired = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket(ticket) { assert.equal(ticket.originalArguments, original); assertRepairTicket(ticket, ticket.contextHash); },
    binding: { async run() { return response(++calls === 1 ? wire : corrected); } } });
  assert.equal(repaired.kind, 'locallyAccepted', JSON.stringify(repaired));
  assert.equal(calls, 2);
  assert.deepEqual(repaired.bundle.proposals[0].branches.success.opportunities, result.opportunities);
  assert.equal(JSON.stringify(wire), original);
});

test('empty unknown groups still reject and fatal filling errors never expose a partial domain draft', () => {
  const wire = wireFor(sharedCheckBundle('worldInteraction'));
  wire.steps.npcRecall = [];
  const candidate = parsed(wire);
  assert.equal(candidate.kind, 'locallyRejected');
  assert.equal(candidate.validationCode, 'PROPOSAL_WIRE_INVALID');
  assert.equal(candidate.diagnostics.length, 1);
  assert.deepEqual(candidate.issues, ['filling:step-group-unknown']);
  wire.check.worldInteraction[0].success.entries = 'broken';
  assert.throws(() => parsed(wire), error => error.diagnostics.some(d => d.constraint === 'filling:complete-result-entries-required'));
});

test('isolated filling fields still obey canonical source requirements before a repair ticket', async () => {
  const wire = wireFor(sharedCheckBundle('worldInteraction'));
  wire.extra = 'Cafe\u0301';
  let persisted = false;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket() { persisted = true; }, binding: { async run() { return response(wire); } } });
  assert.equal(result.kind, 'rejected');
  assert.equal(persisted, false);
});
