import { encodeVNextStrictToolBundle } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { representationRepairPlan } from '../app/_runtime/lib/kp/vnext/proposal-repair-plan.ts';
import { validateVNextProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-validator.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA, decodeVNextStrictToolBundle } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { vnextProposalRepairPlan, vnextProposalRepairDiagnostics } from '../app/_runtime/lib/kp/vnext/proposal-correction.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { itemBundle } from './fixtures/vnext-authored-bundles.mjs';
import { sharedCheckBundle } from './fixtures/vnext-shared-check.mjs';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';

function interaction() {
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: ['sceneFeature:chain'],
    adjudication: { kind: 'directSuccess', risk: '没有显著风险。', successOutcome: '能够检查目标。' }, terminal: null,
    proposals: [{ kind: 'worldInteraction', basisRefs: [], consumes: [], produces: [], outcomeBinding: 'always', sceneRef: 'scene:atrium',
      targetRefs: ['sceneFeature:chain'], directTargetRefs: ['sceneFeature:chain'], instrumentRefs: [], abilityRef: null,
      intent: '检查链条。', method: '靠近观察。', branches: { success: { outcomeCode: 'outcome:inspected', summary: '检查完成。',
        effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }, failure: null } }],
  };
}
function apply(bundle, plan) {
  const result = structuredClone(bundle);
  for (const { path, operation, value } of plan) {
    const parent = path.slice(0, -1).reduce((node, key) => node[key], result);
    assert.equal(Object.hasOwn(parent, path.at(-1)), operation === 'replace');
    parent[path.at(-1)] = structuredClone(value);
  }
  return result;
}

test('fixed text, reference-set and inactive-branch changes recover the identical complete proposal', () => {
  const expected = interaction(), broken = structuredClone(expected);
  broken.proposals[0].method = ' 靠近观察。 ';
  broken.basisRefs.push(broken.basisRefs[0]);
  delete broken.terminal;
  delete broken.proposals[0].branches.failure;
  const snapshot = structuredClone(broken);
  assert.equal(validateVNextProposalBundle(broken).kind, 'rejected');
  const plan = representationRepairPlan(broken);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.find(change => change.path.at(-1) === 'method'), {
    path: ['proposals', 0, 'method'], operation: 'replace', value: '靠近观察。', reason: 'text-canonical-form',
  });
  assert.deepEqual(apply(broken, plan), expected);
  assert.equal(validateVNextProposalBundle(apply(broken, plan)).kind, 'accepted');
  assert.deepEqual(broken, snapshot);
  assert.ok(Object.isFrozen(plan) && plan.every(change => Object.isFrozen(change) && Object.isFrozen(change.path)));
  assert.deepEqual(representationRepairPlan(expected), []);
});

test('a terminal knowledge response uses the same proof with its distinct inactive structure', () => {
  const expected = { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'terminal', basisRefs: [],
    adjudication: null, proposals: [], terminal: { kind: 'knowledgeReview', inquiry: '我记得什么？', scope: 'relevantKnown', knowledgeRefs: ['fact:known'] } };
  const broken = structuredClone(expected);
  delete broken.adjudication;
  delete broken.proposals;
  broken.terminal.inquiry = '\n我记得什么？\t';
  broken.terminal.knowledgeRefs.push('fact:known');
  const plan = representationRepairPlan(broken);
  assert.equal(plan.length, 4);
  assert.deepEqual(apply(broken, plan), expected);
  assert.equal(validateVNextProposalBundle(apply(broken, plan)).kind, 'accepted');
});

test('repair preserves already valid authored and social text without inventing whitespace errors', () => {
  const authored = itemBundle();
  for (const entry of authored.proposals) if (entry.kind === 'materializeDefinition') {
    entry.source.content.label = ` ${entry.source.content.label} `;
    if (typeof entry.source.content.description === 'string') entry.source.content.description = ` ${entry.source.content.description} `;
  }
  const social = { ...decodeVNextStrictToolBundle(encodeVNextStrictToolBundle(worldFactSocialBundle({ sceneRef: 'scene:shared', npcRef: 'npc:speaker' }))),
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle' };
  social.proposals[0].definition.worldFact.consistency.explanation = ' 原有经历没有冲突。 ';
  social.proposals[1].branches.success.summary = ' NPC 作出了回应。 ';
  social.proposals[1].retryChange = { kind: 'method', priorThreadRef: 'thread:prior', basisRefs: [], explanation: ' 换一种说法。 ' };
  const socialBlank = structuredClone(social);
  socialBlank.proposals[1].branches.success.summary = ' \n\t ';
  for (const expected of [authored, social, socialBlank]) {
    assert.equal(validateVNextProposalBundle(expected).kind, 'accepted');
    assert.deepEqual(vnextProposalRepairPlan(expected), []);
    const broken = structuredClone(expected); delete broken.terminal;
    const plan = vnextProposalRepairPlan(broken);
    assert.deepEqual(plan, [{ path: ['terminal'], operation: 'add', value: null, reason: 'inactive-bundle-branch' }]);
    assert.equal(canonicalHash(apply(broken, plan)), canonicalHash(expected));
    const diagnostic = validateVNextProposalBundle(broken);
    assert.deepEqual(vnextProposalRepairDiagnostics(broken, diagnostic.diagnostics).map(d => d.path), [['terminal']]);
  }
});

test('shared checks can restore inactive consequence leaves but cannot invent the owner failure', () => {
  for (const kind of ['observe', 'worldInteraction']) {
    const expected = { ...decodeVNextStrictToolBundle(encodeVNextStrictToolBundle(sharedCheckBundle(kind))), schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle' };
    const broken = structuredClone(expected);
    delete broken.proposals[0].branches.failure;
    delete broken.proposals[2].branches.failure;
    const plan = representationRepairPlan(broken);
    assert.deepEqual(plan.map(change => change.path), [
      ['proposals', 0, 'branches', 'failure'], ['proposals', 2, 'branches', 'failure'],
    ]);
    assert.deepEqual(apply(broken, plan), structuredClone(expected));
    delete broken.proposals[1].branches.failure;
    assert.deepEqual(representationRepairPlan(broken), []);
  }
});

test('noncanonical prose is refused and opaque identities never receive text normalization', () => {
  const broken = itemBundle();
  broken.proposals[0].source.content.description = ' Cafe\u0301 ';
  assert.deepEqual(representationRepairPlan(broken), []);
  const opaque = interaction();
  opaque.proposals[0].method = ' 靠近观察。 ';
  opaque.proposals[0].targetRefs[0] = ' sceneFeature:chain ';
  assert.deepEqual(representationRepairPlan(opaque), []);
});

test('summary placeholders coexist with fixed repairs but never appear in the returned plan', () => {
  const broken = interaction(), path = ['proposals', 0, 'branches', 'success', 'summary'];
  broken.proposals[0].method = ' 靠近观察。 ';
  delete broken.proposals[0].branches.success.summary;
  assert.deepEqual(representationRepairPlan(broken), []);
  const plan = representationRepairPlan(broken, [path]);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].path, ['proposals', 0, 'method']);
  const repaired = apply(broken, plan);
  assert.equal(Object.hasOwn(repaired.proposals[0].branches.success, 'summary'), false);
  repaired.proposals[0].branches.success.summary = '检查完成。';
  assert.equal(validateVNextProposalBundle(repaired).kind, 'accepted');
  assert.deepEqual(representationRepairPlan(broken, [path, path]), []);
  assert.deepEqual(representationRepairPlan(broken, [['adjudication', 'risk']]), []);
});

test('semantic, authority and unknown-field errors prevent every otherwise safe partial repair', () => {
  for (const mutate of [
    bundle => delete bundle.adjudication,
    bundle => delete bundle.proposals[0].targetRefs,
    bundle => delete bundle.proposals[0].branches.success.effects,
    bundle => bundle.proposals[0].targetRefs = ['none'],
    bundle => bundle.proposals[0].outcomeBinding = 'onFailure',
    bundle => bundle.proposals[0].branches.failure = structuredClone(bundle.proposals[0].branches.success),
    bundle => bundle.proposals[0].extra = 'do not discard this member',
    bundle => { bundle.adjudication = { kind: 'check', checkKind: 'abilityCheck', ability: 'wis', skill: null, dc: '12', mode: 'normal', risk: '失败风险。', successOutcome: '成功。', failureOutcome: '失败。' }; },
  ]) {
    const broken = interaction();
    broken.proposals[0].method = ' 靠近观察。 ';
    mutate(broken);
    assert.deepEqual(representationRepairPlan(broken), []);
  }
  const check = interaction();
  check.adjudication = { kind: 'check', checkKind: 'abilityCheck', ability: 'wis', skill: null, dc: 12, mode: 'normal', risk: '失败风险。', successOutcome: '成功。', failureOutcome: '失败。' };
  delete check.proposals[0].branches.failure;
  assert.deepEqual(representationRepairPlan(check), []);
});

test('a complete shared check retains its DC, risk and both consequences during prose normalization', () => {
  const expected = interaction();
  expected.adjudication = { kind: 'check', checkKind: 'abilityCheck', ability: 'wis', skill: null, dc: 12, mode: 'normal',
    risk: '失败会触发已知后果。', successOutcome: '操作成功。', failureOutcome: '操作失败。' };
  expected.proposals[0].branches.failure = { ...structuredClone(expected.proposals[0].branches.success),
    outcomeCode: 'outcome:failed', summary: '操作失败。', effects: [{ kind: 'relationTransition', relationRef: 'relation:support', toState: 'ended' }] };
  const broken = structuredClone(expected);
  broken.proposals[0].method = ' 靠近观察。 ';
  const plan = representationRepairPlan(broken);
  assert.equal(plan.length, 1);
  assert.deepEqual(apply(broken, plan), expected);
  assert.equal(validateVNextProposalBundle(apply(broken, plan)).kind, 'accepted');
});

test('only explicitly set-valued references are deduplicated, never an inventory target list', () => {
  const broken = interaction();
  broken.proposals[0].targetRefs.push('sceneFeature:chain');
  const plan = representationRepairPlan(broken);
  assert.deepEqual(plan, [{ path: ['proposals', 0, 'targetRefs'], operation: 'replace', value: ['sceneFeature:chain'], reason: 'reference-set-duplicates' }]);
  assert.equal(validateVNextProposalBundle(apply(broken, plan)).kind, 'accepted');
  const inventory = itemBundle();
  inventory.proposals[0].source.content.description = ' A frozen Ability. ';
  inventory.proposals.at(-1).operation.targetRefs.push(inventory.proposals.at(-1).operation.targetRefs[0]);
  const inventoryPlan = representationRepairPlan(inventory);
  assert.ok(inventoryPlan.every(change => change.path.at(-1) !== 'targetRefs'));
  assert.deepEqual(apply(inventory, inventoryPlan).proposals.at(-1).operation.targetRefs, inventory.proposals.at(-1).operation.targetRefs);
});

test('the complete plan is bounded to eight changes without truncation', () => {
  const broken = interaction();
  const branch = broken.proposals[0].branches.success;
  branch.sensoryEvidence = Array.from({ length: 8 }, (_, i) => ({ observerRef: 'character:reader', subjectRef: null, sense: 'sight', evidence: ` 现象${i}。 `, basisRefs: [] }));
  assert.equal(representationRepairPlan(broken).length, 8);
  branch.pressures.push({ description: ' 已知压力。 ', sourceRef: null, basisRefs: [] });
  assert.deepEqual(representationRepairPlan(broken), []);
  delete branch.pressures[0];
  assert.deepEqual(representationRepairPlan(broken), []);
});

test('cyclic and non-JSON inputs cannot create a repair proof', () => {
  const cyclic = interaction(); cyclic.extra = cyclic;
  for (const value of [null, 1, [], cyclic, { ...interaction(), extra: undefined }]) {
    assert.deepEqual(representationRepairPlan(value), []);
  }
});
