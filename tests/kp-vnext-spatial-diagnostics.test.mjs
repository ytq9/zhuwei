import assert from 'node:assert/strict';
import test from 'node:test';
import { VNEXT_SEMANTIC_TEMPLATES } from '../app/_runtime/lib/rules/profiles/semantic-templates.ts';
import { isCanonicalTacticalGeometry } from '../app/_runtime/lib/rules/profiles/tactical-geometry.ts';
import { dynamicPassageConform } from '../app/_runtime/lib/rules/v2/dynamic-location-shapes.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA, encodeVNextStrictToolBundle,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments, invokeSubmitKpProposalBundleWithOneCorrection } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { validateVNextProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-validator.ts';
import { vnextProposalRepairPlan } from '../app/_runtime/lib/kp/vnext/proposal-correction.ts';
import { worldFactSocialBundle } from './fixtures/vnext-world-facts.mjs';

const SCENE = 'scene:current', DESTINATION = 'prospective:destination';
const rectangle = () => [{ x: '0', y: '0' }, { x: '240', y: '0' }, { x: '240', y: '240' }, { x: '0', y: '240' }];
function geometry() {
  return { schema: 'zhuwei.tactical-geometry/v1', unit: 'inch', boundary: { kind: 'polygon', points: rectangle() },
    spawnPoints: [{ x: '24', y: '24', elevation: '0' }], clearanceZones: [], obstacles: [{
      featureId: 'feature:wall', kind: 'barrier', label: '矮墙', state: 'standing', polygon: rectangle(),
      elevation: '0', height: '36', opaque: true, impassable: true, cover: 'half', propagation: 'blocks',
      visibilityPolicyId: 'visibility:scene-observers',
    }] };
}
function entry(semanticKind, handle, content) {
  const template = VNEXT_SEMANTIC_TEMPLATES[semanticKind];
  return { kind: 'materializeObject', basisRefs: [SCENE], consumes: [{ kind: 'existing', ref: SCENE }],
    produces: [{ handle, kind: 'semanticDefinition', outcomeBinding: 'always' }], outcomeBinding: 'always',
    semanticKind, templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: 'visibility:scene-observers', summary: '固化所发现的环境。', definition: {
      sceneRef: SCENE, visibilityFactId: null, label: '已发现环境', description: '环境中的一个新发现。',
      observableState: null, affordances: null, mechanicDefinitionRefs: [], ...content,
    } };
}
function spatialBundle() {
  const location = entry('location', DESTINATION, { geometry: geometry() });
  const passage = entry('passage', 'prospective:passage', { observableState: 'open', passage: {
    fromLocationRef: SCENE, toLocationRef: DESTINATION, bidirectional: true, traversal: '沿台阶行走', travelDurationMicros: '60000000',
  } });
  passage.consumes = [{ kind: 'existing', ref: SCENE }, { kind: 'prospective', handle: DESTINATION }];
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [SCENE],
    adjudication: { kind: 'directSuccess', durationMicros: '0', risk: '此刻只发现环境。', successOutcome: '发现环境及其入口。' },
    terminal: null, proposals: [location, passage] };
}
function clarification(inner) {
  const { basisRefs, adjudication, proposals } = inner;
  return { ...inner, mode: 'terminal', basisRefs: [], adjudication: null, proposals: [], terminal: {
    kind: 'clarification', intent: '确认路线。', method: '选择一条路线。', question: '继续探索吗？', choices: [
      { choiceId: 'explore', label: '探索', publicRisk: '先确认已发现环境。', basisRefs: [],
        continuation: { kind: 'adjudication', basisRefs, adjudication, proposals } },
      { choiceId: 'cancel', label: '取消', publicRisk: '不继续。', basisRefs: [], continuation: { kind: 'cancel' } },
    ],
  } };
}
function wireFor(bundle) {
  const { schema, kind, ...wire } = bundle;
  return encodeVNextStrictToolBundle(wire);
}
function parse(bundle) {
  return parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wireFor(bundle)));
}
function diagnostic(bundle, code, path, constraint) {
  const before = structuredClone(bundle), result = parse(bundle);
  assert.equal(result.kind, 'locallyRejected', JSON.stringify(result));
  assert.deepEqual(bundle, before);
  const detail = result.diagnostics.find(item => item.code === code && JSON.stringify(item.path) === JSON.stringify(path)
    && (constraint === undefined || item.constraint === constraint));
  assert.ok(detail, JSON.stringify(result));
  assert.ok(detail.expected !== undefined && detail.actual !== undefined);
  assert.equal(detail.repair.allowed, false);
  return detail;
}
const locationPath = ['proposals', 0, 'definition'], passagePath = ['proposals', 1, 'definition', 'passage'];

test('location and passage preserve normal source acceptance through the real tool parser', () => {
  const basic = spatialBundle(), withGraph = spatialBundle();
  const obstacle = withGraph.proposals[0].definition.geometry.obstacles[0];
  Object.assign(obstacle, { kind: 'portal', state: 'closed', label: ' 门 ', stateGraph: {
    definitionId: 'graph:door', states: [
      { state: 'closed', opaque: true, impassable: true, cover: 'half', propagation: 'blocks' },
      { state: 'open', opaque: false, impassable: false, cover: 'none', propagation: 'passes' },
    ], transitions: [
      { fromState: 'closed', intent: 'open', toState: 'open' }, { fromState: 'open', intent: 'close', toState: 'closed' },
    ],
  } });
  withGraph.proposals[1].definition.passage.traversal = ' 沿门廊通行 ';
  withGraph.proposals[1].definition.passage.toLocationRef = 'scene:known';
  withGraph.proposals[1].consumes[1] = { kind: 'existing', ref: 'scene:known' };
  withGraph.proposals[1].basisRefs.push('scene:known');
  withGraph.basisRefs.push('scene:known');
  for (const bundle of [basic, withGraph, clarification(spatialBundle())]) {
    assert.equal(validateVNextProposalBundle(bundle).kind, 'accepted');
    const parsed = parse(bundle);
    assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
    assert.deepEqual(parsed.bundle, bundle);
    assert.deepEqual(vnextProposalRepairPlan(bundle), []);
  }
  for (const bundle of [basic, withGraph]) {
    const details = [];
    assert.equal(isCanonicalTacticalGeometry(bundle.proposals[0].definition.geometry, details), true);
    assert.equal(dynamicPassageConform(bundle.proposals[1].definition.passage, details), true);
    assert.deepEqual(details, []);
  }
});

test('passage failures report missing, type, value and actual endpoint conflict without inventing a destination', () => {
  for (const [mutate, code, suffix, constraint] of [
    [p => { delete p.travelDurationMicros; }, 'FIELD_MISSING', ['travelDurationMicros']],
    [p => { p.bidirectional = 'true'; }, 'TYPE_MISMATCH', ['bidirectional']],
    [p => { p.fromLocationRef = 12; }, 'TYPE_MISMATCH', ['fromLocationRef']],
    [p => { p.travelDurationMicros = 60000000; }, 'TYPE_MISMATCH', ['travelDurationMicros']],
    [p => { p.travelDurationMicros = '0'; }, 'VALUE_INVALID', ['travelDurationMicros']],
    [p => { p.toLocationRef = ` ${DESTINATION} `; }, 'VALUE_INVALID', ['toLocationRef']],
    [p => { p.traversal = '  '; }, 'VALUE_INVALID', ['traversal']],
    [p => { p.toLocationRef = p.fromLocationRef; }, 'CONSTRAINT_CONFLICT', ['toLocationRef'], 'passage:distinct-endpoints'],
    [p => { p['invented/key'] = true; }, 'VALUE_INVALID', ['invented/key']],
  ]) {
    const bundle = spatialBundle(); mutate(bundle.proposals[1].definition.passage);
    diagnostic(bundle, code, [...passagePath, ...suffix], constraint);
    assert.deepEqual(vnextProposalRepairPlan(bundle), []);
    const sourceDetails = [];
    assert.equal(dynamicPassageConform(bundle.proposals[1].definition.passage), false);
    assert.equal(dynamicPassageConform(bundle.proposals[1].definition.passage, sourceDetails), false);
    assert.ok(sourceDetails.some(detail => JSON.stringify(detail.path) === JSON.stringify(suffix)));
  }
  const bundle = spatialBundle(); bundle.proposals[1].definition.passage = [];
  diagnostic(bundle, 'TYPE_MISMATCH', passagePath);
});

test('geometry records the original rejecting point, position, feature or cross-field branch', () => {
  for (const [mutate, code, suffix, constraint] of [
    [g => { delete g.boundary.points[2].x; }, 'FIELD_MISSING', ['boundary', 'points', 2, 'x']],
    [g => { g.boundary.points[1].x = 10; }, 'TYPE_MISMATCH', ['boundary', 'points', 1, 'x']],
    [g => { g.boundary.points[1].x = '2147483648'; }, 'VALUE_INVALID', ['boundary', 'points', 1, 'x']],
    [g => { g.spawnPoints[0].elevation = '01'; }, 'VALUE_INVALID', ['spawnPoints', 0, 'elevation']],
    [g => { g.spawnPoints.push(structuredClone(g.spawnPoints[0])); }, 'CONSTRAINT_CONFLICT', ['spawnPoints'], 'geometry:spawn-points-unique'],
    [g => { g.obstacles = []; }, 'VALUE_INVALID', ['obstacles']],
    [g => { delete g.obstacles[0].featureId; }, 'FIELD_MISSING', ['obstacles', 0, 'featureId']],
    [g => { g.obstacles[0].opaque = 'false'; }, 'TYPE_MISMATCH', ['obstacles', 0, 'opaque']],
    [g => { g.obstacles[0].height = '0'; }, 'VALUE_INVALID', ['obstacles', 0, 'height']],
    [g => { g.obstacles[0].polygon[1].y = false; }, 'TYPE_MISMATCH', ['obstacles', 0, 'polygon', 1, 'y']],
    [g => { g.obstacles.push(structuredClone(g.obstacles[0])); }, 'CONSTRAINT_CONFLICT', ['obstacles', 1, 'featureId'], 'geometry:feature-order'],
    [g => { g.obstacles[0].stateGraph = {}; }, 'CONSTRAINT_CONFLICT', ['obstacles', 0, 'stateGraph'], 'geometry:state-graph-feature-kind'],
    [g => { g.obstacles[0].kind = 'portal'; g.obstacles[0].stateGraph = {}; }, 'VALUE_INVALID', ['obstacles', 0, 'stateGraph']],
    [g => { g.clearanceZones.push({}); }, 'VALUE_INVALID', ['clearanceZones']],
  ]) {
    const bundle = spatialBundle(), source = bundle.proposals[0].definition.geometry; mutate(source);
    diagnostic(bundle, code, [...locationPath, 'geometry', ...suffix], constraint);
    assert.deepEqual(vnextProposalRepairPlan(bundle), []);
    const sourceDetails = [];
    assert.equal(isCanonicalTacticalGeometry(source), false);
    assert.equal(isCanonicalTacticalGeometry(source, sourceDetails), false);
    assert.ok(sourceDetails.some(detail => JSON.stringify(detail.path) === JSON.stringify(suffix)));
  }
  const bundle = spatialBundle(); bundle.proposals[0].definition.geometry = false;
  diagnostic(bundle, 'TYPE_MISMATCH', [...locationPath, 'geometry']);
});

test('materialization fixed-field constraints retain their actual owner and do not create defaults', () => {
  for (const [ordinal, key, value, path] of [
    [0, 'sceneRef', null, [...locationPath, 'sceneRef']],
    [0, 'visibilityFactId', 'fact:known', [...locationPath, 'visibilityFactId']],
    [0, 'observableState', 'open', [...locationPath, 'observableState']],
    [0, 'affordances', [], [...locationPath, 'affordances']],
    [0, 'mechanicDefinitionRefs', ['mechanic:known'], [...locationPath, 'mechanicDefinitionRefs']],
    [1, 'affordances', [], ['proposals', 1, 'definition', 'affordances']],
    [1, 'mechanicDefinitionRefs', ['mechanic:known'], ['proposals', 1, 'definition', 'mechanicDefinitionRefs']],
  ]) {
    const bundle = spatialBundle(); bundle.proposals[ordinal].definition[key] = value;
    diagnostic(bundle, 'CONSTRAINT_CONFLICT', path);
    assert.deepEqual(vnextProposalRepairPlan(bundle), []);
  }
  const policy = spatialBundle(); policy.proposals[0].visibilityPolicyRef = 'visibility:public';
  diagnostic(policy, 'CONSTRAINT_CONFLICT', ['proposals', 0, 'visibilityPolicyRef']);
  const definition = spatialBundle(); definition.proposals[0].definition = 'missing object';
  diagnostic(definition, 'TYPE_MISMATCH', locationPath);
});

test('nested clarification paths are rebased from the original submitted objects', () => {
  for (const [ordinal, field, mutate, suffix] of [
    [0, 'geometry', g => { g.spawnPoints[0].elevation = true; }, ['spawnPoints', 0, 'elevation']],
    [1, 'passage', p => { p.bidirectional = 'yes'; }, ['bidirectional']],
  ]) {
    const bundle = clarification(spatialBundle());
    mutate(bundle.terminal.choices[0].continuation.proposals[ordinal].definition[field]);
    diagnostic(bundle, 'TYPE_MISMATCH', ['terminal', 'choices', 0, 'continuation', 'proposals', ordinal, 'definition', field, ...suffix]);
  }
});

test('the shared Rules diagnostic adapter retains its existing social consumer', () => {
  const original = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(
    worldFactSocialBundle({ sceneRef: SCENE, npcRef: 'npc:participant' }))));
  assert.equal(original.kind, 'accepted', JSON.stringify(original));
  const broken = structuredClone(original.bundle);
  broken.proposals[1].branches.success.response.motive = 12;
  diagnostic(broken, 'TYPE_MISMATCH', ['proposals', 1, 'branches', 'success', 'response', 'motive']);
});

const request = { modelId: 'scripted-spatial-diagnostics', message: '校验已冻结提案。',
  requiredContext: { entries: [], references: { citations: { authorityBasisRefs: [], viewerEvidenceRefs: [], npcKnowledge: [] } }, binding: { contextHash: 'sha256:spatial-diagnostics-context' } } };
function response(value, name = SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
  return { choices: [{ message: { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] } }] };
}

test('a missing mechanical field blocks the second call even behind a repairable summary', async () => {
  for (const [ordinal, field] of [[0, 'geometry'], [1, 'passage']]) {
    const bundle = spatialBundle(); bundle.proposals[ordinal].summary = '';
    if (field === 'geometry') delete bundle.proposals[ordinal].definition.geometry.spawnPoints[0].elevation;
    else delete bundle.proposals[ordinal].definition.passage.travelDurationMicros;
    let calls = 0;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket() { assert.fail('missing mechanics must be rejected before repair persistence'); },
      binding: { async run() { calls++; return response(wireFor(bundle)); } } });
    assert.equal(result.kind, 'rejected', JSON.stringify(result));
    assert.equal(calls, 1); assert.equal(result.repairUsed, false);
    assert.ok(result.diagnostics.some(detail => detail.code === 'FIELD_MISSING' && detail.path?.includes(field)));
    assert.ok(result.diagnostics.every(detail => !detail.repair.allowed));
  }
});

test('summary repair stays bounded and cannot rewrite endpoints, direction, duration or geometry', async () => {
  const allowedPath = ['proposals', 1, 'summary'];
  for (const forbidden of [null, [...passagePath, 'fromLocationRef'], [...passagePath, 'toLocationRef'],
    [...passagePath, 'bidirectional'], [...passagePath, 'travelDurationMicros'], [...locationPath, 'geometry'], ['adjudication', 'dc']]) {
    const original = spatialBundle(), broken = structuredClone(original); broken.proposals[1].summary = '';
    const wire = wireFor(broken), before = structuredClone(wire);
    let calls = 0, ticket;
    const result = await invokeSubmitKpProposalBundleWithOneCorrection({ ...request,
      persistRepairTicket(value) { ticket = value; },
      binding: { async run(_model, input) {
        calls++;
        if (calls === 1) return response(wire);
        const prompt = JSON.parse(input.messages[1].content);
        assert.deepEqual(prompt.allowedPaths, [allowedPath]);
        assert.deepEqual(prompt.rejectedBundle, broken);
        assert.deepEqual(prompt.rejectedBundle, ticket.draft);
        assert.equal(prompt.contextHash, request.requiredContext.binding.contextHash);
        const summaries = [{ path: allowedPath, value: original.proposals[1].summary }];
        if (forbidden) summaries.push({ path: forbidden, value: 'unauthorized change' });
        return response({ confirm: 'server-plan', summaries }, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
      } } });
    assert.equal(calls, 2); assert.deepEqual(wire, before);
    if (forbidden) {
      assert.equal(result.kind, 'rejected', JSON.stringify(result));
      assert.equal(result.code, 'PROPOSAL_REPAIR_EXHAUSTED');
      assert.ok(result.diagnostics.some(detail => detail.code === 'REPAIR_OUT_OF_SCOPE'
        && JSON.stringify(detail.path) === JSON.stringify(forbidden)), JSON.stringify(result));
    } else {
      assert.equal(result.kind, 'locallyAccepted', JSON.stringify(result));
      assert.deepEqual(result.bundle, original);
      assert.equal(validateVNextProposalBundle(result.bundle).kind, 'accepted');
    }
  }
});
