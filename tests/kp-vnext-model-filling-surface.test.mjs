import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubmitKpProposalBundleModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';
import { VNEXT_SEMANTIC_TEMPLATE_CATALOG } from '../app/_runtime/lib/rules/profiles/semantic-templates.ts';

const message = JSON.stringify({ requiredContext: { intent: { text: '对自己施放治愈伤口。' }, entries: [] } });
function surface(capabilities, terminals = []) {
  const request = createSubmitKpProposalBundleModelInput(message, capabilities, undefined, undefined, terminals);
  assert.equal(request.messages[1].content, message, 'Reading context must not be replaced with output fields.');
  return { prompt: request.messages[0].content, schema: expandDeepSeekSchema(request.tools[0].function.parameters) };
}
const decision = (schema, kind) => schema.properties.decision.anyOf.find(row => row.properties.kind.enum.includes(kind));
function declaredFields(row, expected) {
  assert.deepEqual(Object.keys(row.properties).sort(), [...expected].sort());
  assert.deepEqual(row.required, [...expected].sort());
  assert.equal(row.additionalProperties, false);
}

test('native filling request describes its own fields without a global instruction to restate server basis', () => {
  const { prompt, schema } = surface(['abilityOperation']);
  declaredFields(decision(schema, 'abilityOperation'), ['kind', 'operation']);
  assert.deepEqual(Object.keys(schema.properties), ['decision']);
  assert.doesNotMatch(schema.properties.decision.description, /steps|results|internal bundle/u);
  assert.doesNotMatch(prompt, /basisRefs使用实际支持记录|consumes|produces|templateHash|narrativeMaterializationRefs/u);
  const choice = decision(schema, 'clarification').properties.choices.items;
  const continuation = choice.properties.continuation.anyOf.find(row => row.properties.kind.enum.includes('abilityOperation'));
  declaredFields(continuation, ['kind', 'operation']);
  assert.doesNotMatch(decision(schema, 'clarification').properties.basisRefs.description, /terminal\.|must be \[\]/u);
});

test('server-assembled waiting and knowledge decisions expose only their actual choices', () => {
  const { prompt, schema } = surface([], ['passTime', 'knowledgeReview']);
  declaredFields(decision(schema, 'passTime'), ['kind', 'durationMicros']);
  declaredFields(decision(schema, 'knowledgeReview'), ['kind', 'inquiry', 'scope', 'knowledgeRefs']);
  assert.doesNotMatch(prompt, /basisRefs|consumes|produces|templateHash/u);
  assert.doesNotMatch(schema.properties.decision.description, /steps|results/u);
});

test('authored steps retain model evidence and choices while the template catalog hides server hashes', () => {
  const { prompt, schema } = surface(['materializeObject', 'observe']);
  const catalogLine = prompt.split('\n').find(line => line.startsWith('静态默认模板目录：'));
  const catalog = JSON.parse(catalogLine.slice('静态默认模板目录：'.length));
  assert.deepEqual(catalog.templates, VNEXT_SEMANTIC_TEMPLATE_CATALOG.templates.map(({ templateRef, semanticKind, defaults }) =>
    ({ templateRef, semanticKind, defaults })));
  assert.doesNotMatch(prompt, /consumes|produces|templateHash|嵌套写法/u);
  for (const row of schema.properties.steps.items.anyOf) {
    assert.ok(row.properties.basisRefs, 'Evidence genuinely chosen by the model stays editable.');
    for (const key of ['consumes', 'produces', 'templateHash']) assert.equal(Object.hasOwn(row.properties, key), false);
  }
});

test('minimal native input is assembled, while undeclared server metadata still fails closed', () => {
  const wire = { decision: { kind: 'abilityOperation', operation: { kind: 'invoke', abilityRef: 'ability:owned',
    castingMode: 'normal', target: { kind: 'creatures', refs: ['character:self'] } } } };
  const accepted = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
  assert.equal(accepted.kind, 'accepted');
  assert.deepEqual(accepted.bundle.basisRefs, []);
  assert.deepEqual(accepted.bundle.proposals, []);
  for (const basisRefs of [[], ['character:self']]) {
    assert.throws(() => parseSubmitKpProposalBundleCandidateArguments(JSON.stringify({ decision: { ...wire.decision, basisRefs } })),
      error => error.diagnostics?.some(row => row.constraint === 'filling:ability-basis-owned' && row.repair.allowed === false));
  }
});
