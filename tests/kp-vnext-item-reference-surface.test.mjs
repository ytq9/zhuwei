import assert from 'node:assert/strict';
import test from 'node:test';
import { proposalItemEntryRefs } from '../app/_runtime/lib/kp/vnext/proposal-context.ts';
import { invokeVNextProposalOffer, invokeSubmitKpProposalBundleFirstPass } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { createVNextProposalBundleSchema } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { matchesAuthoredSourceSchema } from '../app/_runtime/lib/rules/v2/authored-materialization.ts';
import { ITEM_ENTRY_SCHEMA } from '../app/_runtime/lib/rules/v2/items.ts';
import { assertDeepSeekStrictToolModelInput } from '../app/_runtime/lib/kp/deepseek.ts';
import { expandDeepSeekSchema } from './fixtures/expand-deepseek-schema.mjs';

function context(label) {
  const known = (entryRef, value) => ({ kind: 'known', entryRef, value, revisionOrHash: 'sha256:fixture' });
  const entry = entryId => ({ schema: ITEM_ENTRY_SCHEMA, entryId });
  return {
    binding: { contextHash: 'sha256:typed-entry-fixture' },
    entries: [known(`${label}:floor`, entry(`${label}:floor`)), known(`${label}:held`, entry(`${label}:held`)),
      known(`${label}:definition`, { schema: 'zhuwei.item-definition/v1', definitionId: `${label}:definition` }),
      known('hidden:other-holder', entry('hidden:other-holder')),
      { kind: 'unavailable', entryRef: 'unavailable:entry', reason: 'redacted', critical: false },
      known('wrong:identity', entry('different:identity'))],
    references: { citations: { viewerEvidenceRefs: [`${label}:floor`, `${label}:held`, `${label}:definition`,
      'unavailable:entry', 'wrong:identity'] } },
  };
}
function entryField(schema) {
  const expanded = expandDeepSeekSchema(schema);
  const decisions = expanded.properties.decision.anyOf;
  const clarification = decisions.find(variant => variant.properties.kind.enum.includes('clarification'));
  const frames = [...decisions, ...clarification.properties.choices.items.properties.continuation.anyOf];
  return frames.filter(variant => variant.properties.kind.enum.some(kind => ['directSuccess', 'check'].includes(kind)))
    .flatMap(variant => {
      const inventory = variant.properties.steps.items.anyOf
        .find(entry => entry.properties.kind.enum.includes('inventoryOperation'));
      assert.ok(inventory, 'each direct/check and clarification frame retains inventory operations');
      const fields = [];
      const collect = schema => {
        if (!schema || typeof schema !== 'object') return;
        if (schema.properties?.entryRef) fields.push(schema.properties.entryRef);
        for (const child of Object.values(schema)) if (child && typeof child === 'object') collect(child);
      };
      collect(inventory.properties.operation);
      assert.ok(fields.length > 0, 'inventory operations retain typed item references, including components');
      return fields;
    });
}

test('inventory reference selection uses frozen visible ItemEntry identity across different instances', () => {
  for (const label of ['stack-a', 'unique-object-b']) {
    const frozen = context(label), before = structuredClone(frozen);
    const refs = proposalItemEntryRefs(frozen);
    assert.deepEqual(refs, [`${label}:floor`, `${label}:held`]);
    const schema = createVNextProposalBundleSchema(['inventoryOperation'], refs);
    for (const field of entryField(schema)) {
      for (const valid of [...refs, 'prospective:new-instance']) assert.equal(matchesAuthoredSourceSchema(valid, field), true);
      for (const invalid of [`${label}:definition`, 'hidden:other-holder', 'unavailable:entry', 'wrong:identity']) {
        assert.equal(matchesAuthoredSourceSchema(invalid, field), false);
        assert.equal(JSON.stringify(schema).includes(invalid), false);
      }
    }
    assert.deepEqual(frozen, before);
    assert.ok(Object.isFrozen(refs));
  }
});

test('an empty known inventory still permits same-bundle item creation without inventing existing candidates', () => {
  for (const field of entryField(createVNextProposalBundleSchema(['inventoryOperation'], []))) {
    assert.equal(matchesAuthoredSourceSchema('prospective:created', field), true);
    assert.equal(matchesAuthoredSourceSchema('unknown:existing', field), false);
  }
});

test('selection advertises types only and the selected provider stage delivers the frozen item field', async () => {
  for (const stage of ['offer', 'expanded']) {
    const frozen = context(stage);
    let calls = 0;
    const result = await (stage === 'offer' ? invokeVNextProposalOffer : invokeSubmitKpProposalBundleFirstPass)({
      modelId: 'test-double', message: '读取冻结材料。', requiredContext: frozen,
      binding: { async run(_model, request) {
        calls++;
        assertDeepSeekStrictToolModelInput(request);
        const tool = request.tools[0].function;
        for (const field of stage === "offer" ? [] : entryField(tool.parameters)) {
          assert.equal(matchesAuthoredSourceSchema(`${stage}:floor`, field), true);
          assert.equal(matchesAuthoredSourceSchema(`${stage}:definition`, field), false);
        }
        const args = stage === 'offer' ? { requestedCapabilities: ['inventoryOperation', 'knowledgeReview'] }
          : { decision: { kind: 'knowledgeReview', inquiry: '我知道什么？', scope: 'allKnown', knowledgeRefs: [] } };
        return { choices: [{ message: { tool_calls: [{ type: 'function', function: {
          name: tool.name, arguments: JSON.stringify(args),
        } }] } }] };
      } },
    });
    assert.equal(result.kind, stage === 'offer' ? 'schemaRequested' : 'locallyAccepted', JSON.stringify(result));
    assert.equal(calls, 1);
  }
});
