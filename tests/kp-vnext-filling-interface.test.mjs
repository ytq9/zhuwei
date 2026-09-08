import { row, rowIndex, dropRow, nestedDecision } from './fixtures/vnext-wire-tables.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeVNextStrictToolBundle, decodeVNextStrictToolBundle, SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, createVNextProposalBundleSchema,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, invokeSubmitKpProposalBundleWithOneCorrection,
  assertRepairTicket } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { vnextEntryProducerContract } from '../app/_runtime/lib/kp/vnext/proposal-producer-contract.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { validateVNextProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-validator.ts';
import { deepSeekStrictToolSchemaIssues } from '../app/_runtime/lib/kp/deepseek-strict-tool.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from '../app/_runtime/lib/rules/profiles/semantic-templates.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
import { itemBundle, hazardBundle } from './fixtures/vnext-authored-bundles.mjs';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const parsed = wire => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
// Fixtures explicitly use the existing strict-tool null sentinel before encoding.
function strictWire(value) {
  if (value === null) return { kind: 'none' };
  if (Array.isArray(value)) return value.map(strictWire);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, strictWire(child)])) : value;
}
const wireFor = value => encodeVNextStrictToolBundle(strictWire(value));
const request = { modelId: 'scripted-local', message: '冻结原意图。', requiredContext: { entries: [],
  references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: 'sha256:filling-interface-test' } } };
function response(value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] } }] };
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
async function refusesBeforeRepair(wire) {
  const before = clone(wire); let calls = 0;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket() { assert.fail('unproven semantic changes must not receive a repair ticket'); },
    binding: { async run() { calls++; return response(wire); } } });
  assert.equal(calls, 1, JSON.stringify(result)); assert.equal(result.kind, 'rejected');
  assert.equal(result.repairUsed, false); assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.every(detail => detail.repair.allowed === false));
  assert.deepEqual(wire, before); return result;
}

const families = () => [sharedCheckBundle('observe'), sharedCheckBundle('worldInteraction'), itemBundle(), hazardBundle(),
  worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story' }),
  worldFactSocialBundle({ sceneRef: 'scene:other', npcRef: 'npc:second', check: true,
    description: '他曾经向乡里的木匠学习修理椅子。', response: '我以前帮木匠修理过椅子。' })];

test('one explicit result list assembles world and observation collections without changing their contents or ruling', () => {
  for (const kind of ['worldInteraction', 'observe']) {
    const original = sharedCheckBundle(kind), owner = original.proposals[1];
    if (kind === 'observe') {
      owner.branches.success.sensoryEvidence.push({ ...clone(owner.branches.success.sensoryEvidence[0]), evidence: '另一次声音变得断续。' });
      owner.branches.success.characterInferences.push({ conclusion: '压力可能尚未稳定。', confidence: '依据声音变化作有限推测。',
        evidence: [{ kind: 'sensoryEvidence', index: 1 }] });
    }
    const wire = wireFor(original), result = row(wire, 1, 'success');
    assert.deepEqual(Object.keys(result).sort(), ['branch', 'entries', 'kind', 'outcomeCode', 'step', 'summary']);
    assert.ok(result.entries.some(entry => entry.recordKind === 'sensoryEvidence'));
    if (kind === 'observe') {
      // Inference indices retain the sensory subsequence, even if an inference
      // is filled before those observations in the single presentation list.
      result.entries.unshift(result.entries.pop());
    }
    const decoded = parsed(wire); assert.equal(decoded.kind, 'accepted', JSON.stringify(decoded));
    assert.deepEqual(decoded.bundle.adjudication, original.adjudication);
    assert.deepEqual(decoded.bundle.proposals[1].branches.success, original.proposals[1].branches.success);
    assert.deepEqual(decoded.bundle.proposals[1].branches.failure, original.proposals[1].branches.failure);
    assert.deepEqual(decoded.bundle.proposals[0].branches.success.effects, original.proposals[0].branches.success.effects);
    const empty = clone(wire); row(empty, 1, 'success').entries = [];
    const explicitNone = parsed(empty); assert.equal(explicitNone.kind, 'accepted');
    assert.deepEqual(explicitNone.bundle.proposals[1].branches.success.sensoryEvidence, []);
    assert.deepEqual(explicitNone.bundle.proposals[1].branches.success[kind === 'observe' ? 'characterInferences' : 'effects'], []);
  }
});

test('missing result lists and mixed form result kinds reject once without guessing effects or deleting inferences', async () => {
  for (const kind of ['worldInteraction', 'observe']) {
    const original = wireFor(sharedCheckBundle(kind));
    const missing = clone(original); delete row(missing, 1, 'success').entries;
    diagnosticAt(missing, ['results', 1, 'entries'], 'FIELD_MISSING', 'arguments');
    const mixed = clone(original); row(mixed, 1, 'success').entries.push({
      recordKind: kind === 'worldInteraction' ? 'characterInferences' : 'effects', conclusion: '不得在另一表单中删除或猜测这份结果。',
    });
    const index = row(mixed, 1, 'success').entries.length - 1;
    const detail = diagnosticAt(mixed, ['results', 1, 'entries', index, 'recordKind'], 'VALUE_INVALID', 'arguments');
    assert.equal(detail.expected.enum.includes(kind === 'worldInteraction' ? 'characterInferences' : 'effects'), false);
    const legacy = clone(original); row(legacy, 1, 'success').sensoryEvidence = [];
    diagnosticAt(legacy, ['results', 1, 'sensoryEvidence'], 'CONSTRAINT_CONFLICT', 'arguments');
    for (const wire of [missing, mixed, legacy]) await refusesBeforeRepair(wire);
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

test('the advertised decision interface is three flat tables: ruling, steps without results, one result row per branch', () => {
  assert.deepEqual(deepSeekStrictToolSchemaIssues(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA), []);
  const schema = expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA);
  assert.deepEqual(Object.keys(schema.properties), ['decision', 'steps', 'results']);
  for (const kind of ['directSuccess', 'check']) {
    const plan = schema.properties.decision.anyOf.find(value => value.properties.kind.enum.includes(kind));
    assert.ok(plan); assert.equal('steps' in plan.properties, false);
  }
  for (const step of schema.properties.steps.items.anyOf) {
    assert.equal(step.additionalProperties, false);
    assert.deepEqual(step.required, Object.keys(step.properties).sort());
    for (const name of ['consumes', 'produces', 'templateHash', 'communication', 'branches', 'result', 'success', 'failure']) assert.equal(name in step.properties, false);
    assert.ok('outcomeBinding' in step.properties);
    const contract = vnextEntryProducerContract({ kind: step.properties.kind.enum[0], source: { kind: step.properties.source?.properties.kind.enum[0] } });
    assert.ok(contract); assert.equal('handle' in step.properties, contract.count === 1);
    if (step.properties.kind.enum[0] === 'worldInteraction') {
      assert.ok('directTargetRefs' in step.properties); assert.ok('otherTargetRefs' in step.properties);
      assert.equal('targetRefs' in step.properties, false);
    }
  }
  const rows = schema.properties.results.items.anyOf;
  assert.deepEqual(rows.map(row => row.properties.kind.enum[0]).sort(), ['observe', 'social', 'worldInteraction']);
  for (const row of rows) {
    assert.equal(row.additionalProperties, false);
    assert.deepEqual(row.required, Object.keys(row.properties).sort());
    assert.equal(row.properties.step.type, 'integer');
    assert.deepEqual(row.properties.branch.enum, ['result', 'success', 'failure']);
    if (row.properties.kind.enum[0] === 'social') {
      for (const name of ['responseKind', 'responseText', 'responseMotive', 'responseBasis', 'consequences']) assert.ok(name in row.properties, name);
      assert.equal('response' in row.properties, false);
    } else {
      assert.ok('entries' in row.properties);
    }
  }
  // A selection without any result-producing step still carries the table, with a row shape no row can take.
  const timerOnly = expandDeepSeekSchema(createVNextProposalBundleSchema(['formActorPlan']));
  assert.deepEqual(Object.keys(timerOnly.properties), ['decision', 'steps', 'results']);
  assert.deepEqual(timerOnly.properties.results.items.anyOf.map(row => row.properties.kind.enum[0]), ['none']);
});

test('different item, hazard, knowledge and interaction families use the same codec and full validator including continuations', () => {
  for (const source of families()) for (const nested of [false, true]) {
    const original = nested ? clarification(source) : source, before = clone(original), wire = wireFor(original);
    assert.equal(matchesAuthoredSourceSchema(wire, expandDeepSeekSchema(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA)), true, JSON.stringify(wire));
    const result = parsed(wire);
    assert.equal(result.kind, 'accepted', JSON.stringify(result));
    assert.equal(validateVNextProposalBundle(result.bundle).kind, 'accepted');
    assert.equal(result.bundleHash, canonicalHash(result.bundle));
    const plans = nested ? result.bundle.terminal.choices.map(choice => choice.continuation) : [result.bundle];
    for (const plan of plans) {
      assert.deepEqual(plan.proposals.map(entry => clone(entry.produces)), source.proposals.map(entry => entry.produces));
      assert.deepEqual(plan.adjudication, source.adjudication);
    }
    assert.deepEqual(original, before);
  }
});

test('direct results acquire no failure while a check preserves its unique owner and both frozen outcomes', () => {
  const direct = parsed(wireFor(hazardBundle())); assert.equal(direct.kind, 'accepted');
  assert.equal(direct.bundle.proposals[2].branches.failure, null);
  assert.equal(direct.bundle.proposals[2].outcomeBinding, 'always');
  const checked = wireFor(sharedCheckBundle('worldInteraction'));
  assert.ok(row(checked, 0, 'result')); assert.ok(row(checked, 1, 'success')); assert.ok(row(checked, 1, 'failure'));
  assert.deepEqual(checked.results.map(entry => [entry.step, entry.branch]), [[0, 'result'], [1, 'success'], [1, 'failure'], [2, 'result']]);
  const accepted = parsed(checked); assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.bundle.proposals.map(entry => entry.outcomeBinding), ['onSuccess', 'always', 'onFailure']);
  assert.deepEqual(accepted.bundle.proposals[1].branches, sharedCheckBundle('worldInteraction').proposals[1].branches);
  const missing = clone(checked); dropRow(missing, 1, 'failure');
  diagnosticAt(missing, ['proposals', 1, 'branches', 'failure'], 'FIELD_MISSING');
  const noOwner = clone(checked); row(noOwner, 1, 'success').branch = 'result'; dropRow(noOwner, 1, 'failure');
  assert.ok(diagnostics(noOwner).some(value => value.code === 'CONSTRAINT_CONFLICT'));
  const duplicate = clone(checked); duplicate.steps[0] = clone(duplicate.steps[1]);
  dropRow(duplicate, 0, 'result'); duplicate.results.push(...duplicate.results.filter(entry => entry.step === 1).map(entry => ({ ...clone(entry), step: 0 })));
  assert.ok(diagnostics(duplicate).some(value => value.code === 'CONSTRAINT_CONFLICT'));
});

test('server derives typed producer declarations, prospective dependencies, public source union and exact catalog hashes', () => {
  const item = parsed(wireFor(itemBundle())); assert.equal(item.kind, 'accepted');
  assert.deepEqual(item.bundle.proposals.map(step => step.produces.map(item => item.kind)),
    [['abilityDefinition'], ['itemDefinition'], ['itemEntry'], [], []]);
  assert.deepEqual(item.bundle.proposals.map(step => step.consumes.filter(ref => ref.kind === 'prospective').map(ref => ref.handle)),
    [[], ['prospective:mechanics'], ['prospective:item-definition'], ['prospective:item-entry'], ['prospective:item-entry']]);
  const world = worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story' }), wire = wireFor(world);
  const accepted = parsed(wire); assert.equal(accepted.kind, 'accepted');
  const template = VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.find(item => item.templateRef === wire.steps[0].templateRef);
  assert.equal(accepted.bundle.proposals[0].templateHash, template.templateHash);
  assert.equal(accepted.bundle.proposals[1].communication, 'spokenConversation');
  assert.deepEqual(accepted.bundle.basisRefs, ['npc:story']);
  assert.deepEqual(accepted.bundle.proposals[1].consumes, [{ kind: 'existing', ref: 'npc:story' }, { kind: 'prospective', handle: 'prospective:new-experience' }]);
  const missingTemplate = clone(wire); delete missingTemplate.steps[0].templateRef;
  diagnosticAt(missingTemplate, ['steps', 0, 'templateRef'], 'FIELD_MISSING', 'arguments');
  const unknownTemplate = clone(wire); unknownTemplate.steps[0].templateRef = 'template:unknown';
  diagnosticAt(unknownTemplate, ['steps', 0, 'templateRef'], 'REFERENCE_UNAVAILABLE', 'arguments');
  const wrongTemplateType = clone(wire); wrongTemplateType.steps[0].templateRef = 17;
  diagnosticAt(wrongTemplateType, ['steps', 0, 'templateRef'], 'TYPE_MISMATCH', 'arguments');
});

test('explicit causal and knowledge sources stay attached to their step and are never inferred from targets', () => {
  const original = sharedCheckBundle('worldInteraction');
  original.proposals[1].consumes = [{ kind: 'existing', ref: 'evidence:chosen-source' }];
  original.proposals[1].targetRefs = ['definition:other-target']; original.proposals[1].directTargetRefs = ['definition:other-target'];
  const wire = wireFor(original), decoded = decodeVNextStrictToolBundle(wire);
  assert.deepEqual(wire.steps[1].basisRefs, ['definition:probe-valve', 'evidence:chosen-source']);
  assert.deepEqual(decoded.proposals[0].basisRefs, ['definition:probe-valve']);
  assert.deepEqual(clone(decoded.proposals[1].consumes), [{ kind: 'existing', ref: 'definition:probe-valve' }, { kind: 'existing', ref: 'evidence:chosen-source' }]);
  assert.equal(decoded.proposals[1].consumes.some(ref => ref.ref === 'definition:other-target'), false);
  const world = worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story', holders: ['npc:story', 'npc:companion'] });
  const accepted = parsed(wireFor(world)); assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.bundle.proposals[0].basisRefs, []);
  assert.deepEqual(accepted.bundle.proposals[0].definition.worldFact, world.proposals[0].definition.worldFact);
  assert.deepEqual(accepted.bundle.proposals[1].branches.success.response.basis, world.proposals[1].branches.success.response.basis);
});

test('wrong prospective type, missing producer, duplicate producer and cross-outcome consumption fail in the existing validator', async () => {
  const wrongType = wireFor(itemBundle()); wrongType.steps[1].source.content.use.abilityRef = 'prospective:item-entry';
  const missingProducer = wireFor(itemBundle()); missingProducer.steps[1].source.content.use.abilityRef = 'prospective:missing';
  const duplicate = wireFor(itemBundle()); duplicate.steps[1].handle = duplicate.steps[0].handle;
  const crossOutcome = wireFor(worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:story', check: true }));
  crossOutcome.steps[0].outcomeBinding = 'onSuccess';
  for (const wire of [wrongType, missingProducer, duplicate, crossOutcome]) {
    const candidate = parsed(wire); assert.equal(candidate.kind, 'locallyRejected', JSON.stringify(candidate));
    assert.equal(validateVNextProposalBundle(candidate.draft).kind, 'rejected');
    assert.ok(candidate.diagnostics.some(detail => ['REFERENCE_UNAVAILABLE', 'CONSTRAINT_CONFLICT'].includes(detail.code)), JSON.stringify(candidate.diagnostics));
    await refusesBeforeRepair(wire);
  }
});

test('retired shells, mixed shapes and model-supplied derived fields are explicit one-call refusals', async () => {
  const valid = wireFor(itemBundle());
  for (const wire of [
    itemBundle(), { ...valid, proposals: [] }, { ...valid, mode: 'adjudication' },
    ...['adjudication', 'terminal', 'proposals', 'basisRefs'].map(key => ({ decision: { ...clone(valid.decision), [key]: [] } })),
    ...['produces', 'consumes', 'templateHash', 'communication', 'branches', 'outcomeBinding'].map(key => {
      const wire = clone(valid); wire.steps[0][key] = 'injected'; return wire;
    }),
    (() => { const wire = wireFor(hazardBundle()); wire.steps[2].targetRefs = []; return wire; })(),
    (() => { const wire = wireFor(hazardBundle()); wire.steps[2].handle = 'prospective:undeclared'; return wire; })(),
    (() => { const wire = wireFor(hazardBundle()); wire.results.push({ ...clone(row(wire, 2, 'result')), branch: 'success' }); return wire; })(),
    (() => { const wire = wireFor(sharedCheckBundle()); const failure = row(wire, 1, 'failure'); for (const key of Object.keys(failure)) if (!['kind', 'step', 'branch'].includes(key)) delete failure[key]; return wire; })(),
  ]) await refusesBeforeRepair(wire);
});

test('unknown fields survive decoding so the complete validator rejects them instead of silently dropping them', async () => {
  for (const change of [
    wire => { wire.decision.unexpected = 'preserve-to-reject'; },
    wire => { wire.steps[0].unexpected = 'preserve-to-reject'; },
    wire => { row(wire, 2, 'result').unexpected = 'preserve-to-reject'; },
  ]) {
    const wire = wireFor(hazardBundle()); change(wire);
    const candidate = parsed(wire); assert.equal(candidate.kind, 'locallyRejected');
    assert.ok(JSON.stringify(candidate.draft).includes('preserve-to-reject'));
    assert.ok(candidate.diagnostics.some(detail => detail.path?.at(-1) === 'unexpected'), JSON.stringify(candidate.diagnostics));
    await refusesBeforeRepair(wire);
  }
});

test('missing fields identify their actual arguments or decoded draft path and never invent a ruling', async () => {
  diagnosticAt({}, ['decision'], 'FIELD_MISSING', 'arguments');
  diagnosticAt({ decision: {} }, ['decision', 'kind'], 'FIELD_MISSING', 'arguments');
  diagnosticAt({ decision: { kind: 12 } }, ['decision', 'kind'], 'TYPE_MISMATCH', 'arguments');
  const injectedEnvelope = { ...wireFor(itemBundle()), kind: 'check' };
  diagnosticAt(injectedEnvelope, ['kind'], 'CONSTRAINT_CONFLICT', 'arguments');
  await refusesBeforeRepair(injectedEnvelope);
  const missingSteps = wireFor(itemBundle()); delete missingSteps.steps;
  diagnosticAt(missingSteps, ['steps'], 'FIELD_MISSING', 'arguments');
  const missingDc = wireFor(sharedCheckBundle()); delete missingDc.decision.dc;
  diagnosticAt(missingDc, ['adjudication', 'dc'], 'FIELD_MISSING');
  const missingHandle = wireFor(itemBundle()); delete missingHandle.steps[0].handle;
  diagnosticAt(missingHandle, ['proposals', 0, 'produces', 0, 'handle'], 'FIELD_MISSING');
  const missingResult = wireFor(hazardBundle()); dropRow(missingResult, 2, 'result');
  diagnosticAt(missingResult, ['proposals', 2, 'branches', 'success'], 'FIELD_MISSING');
  for (const wire of [missingSteps, missingDc, missingHandle, missingResult]) await refusesBeforeRepair(wire);
});

test('fixed whitespace repairs share one bounded confirmation across families and preserve exact original arguments', async () => {
  for (const original of families()) for (const nested of [false, true]) {
    const source = nested ? clarification(original) : original, wire = wireFor(source), expected = parsed(wire).bundle;
    const decision = nested ? wire.decision.choices[1].continuation : wire.decision;
    decision.risk = ` ${decision.risk} `;
    const originalArguments = JSON.stringify(wire); let calls = 0, ticket;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket(value) { ticket = value; }, binding: { async run(_model, input) {
        calls++; if (calls === 1) return response(wire);
        assertRepairTicket(ticket, request.requiredContext.binding.contextHash);
        const prompt = JSON.parse(input.messages[1].content);
        assert.equal(ticket.originalArguments, originalArguments); assert.equal(prompt.originalArguments, originalArguments);
        assert.deepEqual(prompt.diagnostics, clone(ticket.diagnostics)); assert.deepEqual(prompt.repairPlan, clone(ticket.repairPlan));
        assert.equal(ticket.repairPlan.length, 1);
        return response({ confirm: 'server-plan', summaries: [] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(calls, 2); assert.equal(result.invocationCount, 2);
    assert.deepEqual(clone(result.bundle), clone(expected)); assert.equal(JSON.stringify(wire), originalArguments);
  }
});

test('complete-root JSON syntax evidence uses the same one-confirmation path without refilling semantic fields', async () => {
  for (const source of [itemBundle(), sharedCheckBundle('worldInteraction'),
    { mode: 'terminal', basisRefs: [], adjudication: null, proposals: [],
      terminal: { kind: 'knowledgeReview', inquiry: '我知道什么？', scope: 'allKnown', knowledgeRefs: [] } }]) {
  const wire = wireFor(source), fullArguments = JSON.stringify(wire);
  for (const originalArguments of [fullArguments.slice(0, -1), fullArguments.slice(0, -1) + ']}}', fullArguments + ']}']) {
  let calls = 0, ticket;
  const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
    persistRepairTicket(value) { ticket = value; }, binding: { async run() {
      calls++;
      if (calls === 1) { const value = response(wire); value.choices[0].message.tool_calls[0].function.arguments = originalArguments; return value; }
      assert.equal(ticket.originalArguments, originalArguments); assert.equal(ticket.syntaxEvidence.originalArguments, originalArguments);
      assert.deepEqual(ticket.allowedPaths, []); assertRepairTicket(ticket, request.requiredContext.binding.contextHash);
      assert.ok(ticket.diagnostics.some(detail => detail.code === 'JSON_SYNTAX' && detail.pathBase === 'arguments' && detail.location));
      return response({ confirm: 'server-plan', summaries: [] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
    } } });
  assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result)); assert.equal(calls, 2);
  assert.deepEqual(clone(result.bundle), clone(parsed(wire).bundle));
  }
  }
});


test('direct and additional targets retain their distinct roles while the server derives their combined target set', async () => {
  const wire = wireFor(hazardBundle()), step = wire.steps[2];
  assert.deepEqual(step.otherTargetRefs, []); assert.equal('targetRefs' in step, false);
  const direct = step.directTargetRefs[0]; step.otherTargetRefs = ['definition:affected-neighbor'];
  const result = parsed(wire); assert.equal(result.kind, 'accepted', JSON.stringify(result));
  assert.deepEqual(result.bundle.proposals[2].directTargetRefs, [direct]);
  assert.deepEqual(result.bundle.proposals[2].targetRefs, [direct, 'definition:affected-neighbor']);
  assert.equal(result.bundle.proposals[2].consumes.some(ref => ref.ref === 'definition:affected-neighbor'), false);
  for (const value of [undefined, null, 'definition:wrong-shape']) {
    const malformed = clone(wire);
    if (value === undefined) delete malformed.steps[2].otherTargetRefs;
    else malformed.steps[2].otherTargetRefs = value;
    diagnosticAt(malformed, ['steps', 2, 'otherTargetRefs'], value === undefined ? 'FIELD_MISSING' : 'TYPE_MISMATCH', 'arguments');
    await refusesBeforeRepair(malformed);
  }
  const inventory = wireFor(itemBundle());
  assert.deepEqual(inventory.steps[4].operation.targetRefs, itemBundle().proposals[4].operation.targetRefs);
});

test('confirmation cannot rewrite actual item targets, quantity costs or authored resource costs', async () => {
  for (const change of [
    { path: ['proposals', 4, 'operation', 'targetRefs'], value: '["character:different"]' },
    { path: ['proposals', 1, 'source', 'content', 'use', 'quantityCost'], value: '0' },
    { path: ['proposals', 1, 'source', 'content', 'use', 'chargeCost'], value: '0' },
    { path: ['proposals', 0, 'source', 'content', 'costs'], value: '[]' },
  ]) {
    const wire = wireFor(itemBundle()); wire.decision.risk = ` ${wire.decision.risk} `;
    let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket() {}, binding: { async run() {
        calls++; return calls === 1 ? response(wire)
          : response({ confirm: 'server-plan', summaries: [change] }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(result.kind, 'rejected'); assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED'); assert.equal(calls, 2);
    assert.ok(result.diagnostics.some(detail => detail.code === 'REPAIR_OUT_OF_SCOPE'
      && JSON.stringify(detail.path) === JSON.stringify(change.path)), JSON.stringify(result.diagnostics));
  }
});
