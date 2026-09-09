import assert from 'node:assert/strict';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_SCENE as SCENE } from '../../tools/lib/vnext-authored-probe-fixture.mjs';
import { authoritativeNpcDecisionContext } from '../../app/_runtime/lib/rules/v2/npc-decision-context.ts';
import { authorityRevisionOrHash } from '../../app/_runtime/lib/rules/v2/authority-bindings.ts';
import { socialThreadRef, socialListeners } from '../../app/_runtime/lib/rules/v2/social-interaction.ts';
import { canonicalSha256 } from '../../app/_runtime/lib/rules/profiles/canonical.ts';
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from '../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { promiseTermsRefs } from '../../app/_runtime/lib/rules/v2/promise-lifecycle.ts';

export { ACTOR, SCENE };
export const NPC = 'npc:promise-worker';
export function promiseFixture(name, options = {}) {
  return createAuthoredProbeFixture(`promise-lifecycle:${name}`, { npcCharacters: [{ id: NPC, name: options.name ?? '抄写员' }],
    initialKnowledge: [{ characterId: NPC, knowledgeRef: 'knowledge:secret', kind: 'sourceClaim', layer: 'full', content: '约定中的秘密内容。', visibility: 'private', provenanceChain: ['genesis:secret'] },
      { characterId: ACTOR, knowledgeRef: 'knowledge:private-player', kind: 'sourceClaim', layer: 'full', content: 'PLAYER_ONLY_PROMISE_CANARY', visibility: 'private', provenanceChain: ['genesis:player'] }], ...options });
}
export function makePromiseInput(f, state = f.state, options = {}) {
  const root = options.root ?? f.rootActionId, resolutionId = `resolution:${root}`;
  const npc = options.npc ?? NPC, context = authoritativeNpcDecisionContext(state, f.profiles, npc);
  assert.ok(context);
  const branch = { outcomeCode: 'promise:agreed', summary: 'NPC说出了约定。',
    response: { kind: 'speech', text: options.content ?? '我会在一小时内抄好一份交给你。', motive: '履行自己的约定。', basis: [{ kind: 'npcContext', ref: npc }] },
    consequences: [{ kind: 'promise', ...(options.promisor ? { promisor: options.promisor } : {}), ...(options.promisee ? { promiseeRef: options.promisee } : {}), content: options.content ?? '一小时内交付完整副本。', condition: options.condition ?? '即刻生效。', authorityRefs: [options.promisor === 'actor' ? ACTOR : npc], due: options.due ?? '1h',
      terms: options.terms ?? { kind: 'result', subjectRefs: [npc, ACTOR], delivery: { sourceRef: null, itemRef: null, quantity: 1, destinationKind: 'holder', destinationRef: ACTOR } },
      nextStep: options.nextStep === undefined ? '开始抄写并交付副本。' : options.nextStep }] };
  const social = { schema: 'zhuwei.social-interaction/vnext-1', npcRef: npc, threadRef: socialThreadRef(root, resolutionId), addressedThreadRef: null,
    playerExpression: options.expression ?? '请按这个约定办理。', goal: '达成约定。', communication: 'spokenConversation', audience: 'participants',
    listeners: socialListeners(state, ACTOR, npc, 'participants'), npcContext: context, retryChange: null, branches: { success: branch, failure: structuredClone(branch) } };
  const readRefs = [...new Set([ACTOR, `character-timeline:${ACTOR}`, ...context.records.map(r => r.ref), ...context.knowledge.map(r => r.entryRef),
    ...promiseTermsRefs(branch.consequences[0].terms)])].sort();
  return { kind: 'resolveWorldInteraction', rootActionId: root, actorCharacterId: ACTOR,
    plan: { schema: 'zhuwei.world-interaction-resolution-plan/v1', resolutionId, interactionRef: `interaction:${root}`, actorCharacterId: ACTOR,
      sceneRef: SCENE, abilityRef: null, contextHash: canonicalSha256({ root }), readSet: readRefs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
      targetRefs: [npc], directTargetRefs: [npc], instrumentRefs: [], basisRefs: [npc], intent: social.playerExpression, method: '当面商定。', ruling: { kind: 'directSuccess' }, costs: [], social,
      branches: Object.fromEntries(['success', 'failure'].map(key => [key, { outcomeCode: branch.outcomeCode, summary: branch.summary, effects: [], sensoryEvidence: [], pressures: [], opportunities: [] }])) } };
}
export function dueWork(f, state) {
  const value = f.runtime.project(f.profiles, state, { kind: 'kp', capability: 'internal:kp-spatial-evidence' }, { dueActivities: true });
  assert.equal(value.kind, 'projected', JSON.stringify(value)); return value.dueActivities;
}
export function objectBundle({ actor = NPC, scene = SCENE, destination = ACTOR, sourceRef = scene, label = '副本', duration = '1800000000', original = false } = {}) {
  const definition = 'prospective:document-definition', entry = 'prospective:document-entry';
  const common = { basisRefs: [sourceRef], consumes: [], produces: [], outcomeBinding: 'always' };
  const proposals = [
    { ...structuredClone(common), kind: 'materializeDefinition', consumes: [{ kind: 'existing', ref: sourceRef }],
      produces: [{ handle: definition, kind: 'itemDefinition', outcomeBinding: 'always' }], source: { kind: 'item', content: {
        schema: 'zhuwei.item-definition-content/v1', label, description: original ? '真实保存的原始文稿。' : '依据原件逐字抄写的完整副本。',
        category: 'object', aliases: [], tags: [], stackable: false, equipment: null, equippedAbilityRefs: [], use: null, chargesMaximum: null, durabilityMaximum: null,
      } }, visibilityPolicyRef: 'visibility:public', summary: '定义此次制成的物品。' },
    { ...structuredClone(common), kind: 'materializeItem', consumes: [{ kind: 'prospective', handle: definition }],
      produces: [{ handle: entry, kind: 'itemEntry', outcomeBinding: 'always' }], definitionRef: definition,
      sceneRef: scene, quantity: 1, ownership: { kind: 'unowned', ownerRef: null }, visibilityPolicyRef: 'visibility:public', summary: '形成一个真实物件。' },
  ];
  if (!original) proposals.push(
    { ...structuredClone(common), kind: 'inventoryOperation', consumes: [{ kind: 'prospective', handle: entry }], operation: { kind: 'acquire', entryRef: entry, quantity: 1 }, summary: '拿起制成的物件。' },
    { ...structuredClone(common), kind: 'inventoryOperation', consumes: [{ kind: 'prospective', handle: entry }],
      operation: destination === scene ? { kind: 'release', entryRef: entry, quantity: 1, sceneRef: scene, releaseKind: 'placement' }
        : { kind: 'transfer', entryRef: entry, quantity: 1, targetCharacterRef: destination, ownershipDisposition: 'transferToRecipient' }, summary: '放到约定位置。' },
  );
  return { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: 'proposalBundle', mode: 'adjudication', basisRefs: [sourceRef], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: original ? '0' : duration, risk: '按当前合法的材料和位置完成。', successOutcome: `${actor}完成制作和交付。` }, proposals };
}

export function changePromiseInput(f, state, promise, options = {}) {
  const input = makePromiseInput(f, state, { root: options.root ?? `${f.rootActionId}:change`, expression: options.expression ?? '请按当前情况调整约定。', content: options.speech ?? '依这次情境处理我们的约定。' });
  const change = { kind: 'amend', accepted: true, reason: '根据当前表达与具体情境成立。',
    content: promise.content, condition: promise.condition, terms: structuredClone(promise.lifecycle.terms),
    deadlineFictionMicros: '7200000000', releasedParts: [], remaining: true, ...options.change };
  const consequence = { kind: 'promiseChange', promiseRef: `continuity:promises:${promise.promiseId}`, revision: promise.lifecycle.revision,
    expressionSource: options.source ?? 'npc', expressionQuote: options.source === 'actor' ? input.plan.social.playerExpression : input.plan.social.branches.success.response.text,
    change, disclose: options.disclose ?? true };
  for (const branch of Object.values(input.plan.social.branches)) branch.consequences = [structuredClone(consequence)];
  const refs = [...new Set([`continuity:promises:${promise.promiseId}`, ...(change.terms ? promiseTermsRefs(change.terms) : [])])];
  for (const ref of refs) if (!input.plan.readSet.some(binding => binding.ref === ref)) input.plan.readSet.push({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) });
  input.plan.readSet.sort((a, b) => a.ref.localeCompare(b.ref));
  return input;
}
