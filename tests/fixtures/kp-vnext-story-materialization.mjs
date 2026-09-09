import assert from 'node:assert/strict';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_SCENE as SCENE } from '../../tools/lib/vnext-authored-probe-fixture.mjs';
import { canonicalHash } from '../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { characterTimelineId } from '../../app/_runtime/lib/rules/v2/timeline.ts';
import { roomStoryRequest, roomStoryCapabilityDescriptions } from '../../app/_runtime/lib/room/story-action-request.ts';
import { buildRoomStoryContext } from '../../app/_runtime/lib/room/story-context.ts';
import { bindStoryPreparationContext } from '../../app/_runtime/lib/room/story-action-context.ts';
import { prepareStory, createStoryRecipes } from '../../app/_runtime/lib/room/story-creation/index.ts';
import { encodeVNextStrictToolBundle } from '../../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { vnextProposalCapabilityForEntry } from '../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts';
import { prepareStoryAdmissionBinding, storyAdmissionReceipt } from '../../app/_runtime/lib/room/story-admission.ts';
import { storyFixture, storyReviewBody, storyResponse } from './story-creation.mjs';

export { ACTOR, SCENE };
export const BOATMAN = 'npc:boatman', CLERK = 'npc:clerk', NEW_NPC = 'candidate:archivist', HANDLE = 'prospective:story-archivist';
export const FACT = 'candidate:registration-fact', KNOWLEDGE = 'candidate:witness-memory';
const hash = canonicalHash, clone = structuredClone;

export function npcStorySource() {
  const scores = { str: 10, dex: 12, con: 10, int: 14, wis: 14, cha: 12 };
  return { name: '许录', description: '带着防水卷宗盒的档案员。', background: '过去一年负责核查河港登记卷。',
    goals: ['保全原始登记卷'], behavioralConstraints: ['只陈述实际见过的内容'], voice: '措辞简洁，承认不知道的部分。',
    initialUnknowns: ['不知道登记遗漏的责任人'], rulesBasis: 'srd5.1-2014',
    mechanicalTemplate: { schema: 'zhuwei.npc-mechanical-template/v1', label: '档案员完整机制',
      stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
      proficiencyBonus: '2', armorClass: '11', armorClassModel: { kind: 'higherOfBaseAndEquipment', baseArmorClass: '11', shieldBonus: '0' },
      hitPointsMaximum: '16', footprint: { width: '60', depth: '60', height: '60' }, speedInches: { walk: '300' },
      resourceMaximums: {}, deathPolicy: 'defeatedAtZero', intrinsicAbilityRefs: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } },
    socialMechanics: { abilityScores: scores, proficiencyBonus: 2, skillModifiers: { history: 4 }, initialTrust: 0,
      authorityModifier: 0, stakesSensitivity: 0, maximumInfluenceDegree: 'limitedSuccess' }, position: { x: '400', y: '400', elevation: '0' } };
}
function replaceReferences(value, references) {
  if (typeof value === 'string') return references.get(value) ?? value;
  if (Array.isArray(value)) return value.map(entry => replaceReferences(entry, references));
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceReferences(entry, references)])) : value;
}
export function npcProducer(source = npcStorySource()) {
  return { kind: 'materializeNpc', basisRefs: ['anchor:requisition', SCENE],
    consumes: [{ kind: 'existing', ref: 'anchor:requisition' }, { kind: 'existing', ref: SCENE }],
    produces: [{ kind: 'entity', handle: HANDLE, outcomeBinding: 'always' }], outcomeBinding: 'always', sceneRef: SCENE,
    source, visibilityPolicyRef: 'visibility:scene-observers', summary: '档案员带着原卷来到登记处。' };
}
export function bundle(proposals) {
  return { mode: 'adjudication', basisRefs: [SCENE], terminal: null,
    adjudication: { kind: 'directSuccess', durationMicros: '0', risk: '只固化已经成立的背景事实。', successOutcome: '保存事实与有关人物的记忆。' }, proposals };
}

/** Synthetic draft/reviewer outcomes exercise the real preparation codec.
 * They are deterministic protocol evidence, never a model quality verdict.
 * All grants and contexts come from the real authority freezer/Room builders. */
export async function createStoryMaterializationFixture(name, { newNpc = false, definitions = [], worldOptions = {}, editDraft } = {}) {
  const f = createAuthoredProbeFixture(`story-materialization:${name}`, {
    npcCharacters: [{ id: BOATMAN, name: '林舟' }, { id: CLERK, name: '周吏' }],
    canonicalFacts: [
      ['anchor:requisition', '河港征用须登记，药品运输可提出有据申诉。'],
      ['record:ledger', '原始登记卷由地方文书处保管。'], ['record:receipt', '运输行保管独立的签收联。'],
      ['unknown:boatman-culprit', '林舟此前明确不知道谁造成登记遗漏。'], ['fact:calendar', '登记卷与抄件均存在。'],
    ].map(([id, value]) => ({ id, kind: 'historicalFact', subjectRefs: [SCENE, BOATMAN, CLERK], value,
      visibilityPolicyId: 'visibility:public', source: 'moduleAnchor' })),
    initialKnowledge: [[BOATMAN, 'knowledge:boatman-order', '船夫知道自己的船被暂扣。'],
      [CLERK, 'knowledge:clerk-register', '吏员知道征用登记的保管处。']].map(([characterId, knowledgeRef, content]) => ({
      characterId, knowledgeRef, content, kind: 'sourceClaim', layer: 'full', visibility: 'private', provenanceChain: ['genesis:held-information'] })),
    ...worldOptions,
  });
  f.events = [];
  f.run = input => {
    const result = f.runtime.step(f.profiles, f.state, input);
    assert.equal(result.kind, 'committed', JSON.stringify(result));
    f.events.push(...result.events);
    const replayed = f.runtime.replay(f.genesis, f.events);
    assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed));
    assert.deepEqual(replayed.state, result.state); f.state = replayed.state;
    return result;
  };
  f.run({ kind: 'resolveFreeAction', proposalId: `${f.rootActionId}:elapsed`, characterId: ACTOR,
    goal: '整理登记材料', method: '逐份核对', feasibility: { kind: 'directSuccess', publicBasis: '可以直接整理。' },
    outcome: { fictionTimeCostMicros: '100' } });
  f.selectionContext = freezeAuthoredProbeContext(f, f.state, { rootActionId: f.rootActionId, focusRefs: [BOATMAN, CLERK, 'record:ledger'],
    intentText: newNpc ? '我想追查登记副本差异，寻找能核验原卷的人。' : '我想帮助林舟核对征用登记，了解有哪些有根据的处理办法。' }).context;
  f.recipes = createStoryRecipes(hash);
  f.request = roomStoryRequest(f.selectionContext, f.state, { method: newNpc ? 'story.method.archive-investigation' : 'story.method.local-conflict',
    scale: 'short', connection: newNpc ? 'mainStory' : 'local' }, f.recipes);
  f.capabilityDescriptions = roomStoryCapabilityDescriptions();
  const built = buildRoomStoryContext({ ...f, request: f.request, requiredContext: f.selectionContext,
    capabilityDescriptions: f.capabilityDescriptions, maxUnits: 48_000 });
  assert.equal(built.kind, 'ready', JSON.stringify(built));
  f.storyContext = built.context;
  const references = new Map([['scene:harbor', SCENE], ['scene:archive', SCENE], ['open:local-history', `story-context:open:${SCENE}`],
    ['timeline:local', characterTimelineId(f.state, ACTOR)], ['knowledge:boatman-order', `knowledge:${BOATMAN}:knowledge:boatman-order`],
    ['knowledge:clerk-register', `knowledge:${CLERK}:knowledge:clerk-register`]]);
  f.body = replaceReferences(storyFixture(newNpc ? 'investigation' : 'conflict').body, references);
  const fact = f.body.facts[0]; fact.occurrence.start.micros = '20'; fact.occurrence.basisRefs = [SCENE];
  fact.knowledge[0].acquisition.start.micros = '80'; fact.knowledge[0].acquisition.basisRefs = [SCENE];
  fact.knowledge[0].sourceRef = FACT; fact.knowledge[0].content = 'NPC_PRIVATE_STORY_KNOWLEDGE：亲见原卷与抄件存在差异，但不知道遗漏原因。';
  if (newNpc) f.body.definitions[0] = { ref: NEW_NPC, kind: 'npc', capability: 'materializeNpc',
    payload: { steps: encodeVNextStrictToolBundle(bundle([npcProducer()])).steps }, dependsOn: [SCENE, 'anchor:requisition'] };
  f.body.definitions.push(...definitions.map(value => ({ ref: value.ref, kind: value.kind, capability: vnextProposalCapabilityForEntry(value.producer),
    payload: { steps: encodeVNextStrictToolBundle(bundle([value.producer])).steps }, dependsOn: value.dependsOn })));
  if (definitions.length) f.body.notApplicable = f.body.notApplicable.filter(value => value.path !== '/definitions');
  editDraft?.(f.body);
  f.reviewBody = storyReviewBody(f);
  f.invocations = []; let checkpoint = null;
  const prepared = await prepareStory(f.request, f.storyContext, null, {
    recipes: f.recipes, hash,
    async invoke(request) {
      f.invocations.push(clone(request));
      return { kind: 'completed', response: storyResponse(request.stage === 'review' ? f.reviewBody : f.body, request.stage) };
    },
    async saveCheckpoint(expected, next) {
      assert.equal(expected, checkpoint?.revision ?? 0); checkpoint = clone(next);
      return { ok: true, checkpoint: clone(checkpoint) };
    },
  });
  assert.equal(prepared.kind, 'ready', JSON.stringify(prepared));
  f.checkpoint = checkpoint;
  f.preparation = prepared.preparation; f.review = prepared.review; f.preparationHash = hash(f.preparation);
  const bound = bindStoryPreparationContext({ ...f, selectionContext: f.selectionContext, storyContext: f.storyContext, maxUnits: 48_000 });
  assert.equal(bound.kind, 'ready', JSON.stringify(bound));
  f.requiredContext = bound.context; f.storyBinding = bound.binding;
  return f;
}

export const factSelector = f => ({ kind: 'admitStoryFacts', preparationHash: f.preparationHash, candidateRefs: [FACT],
  basisRefs: [], consumes: [], produces: [], outcomeBinding: 'always', summary: '固化登记经历及指定知情者的记忆。' });
export const npcSelector = f => ({ kind: 'materializeStory', source: { kind: 'entity', preparationHash: f.preparationHash, candidateRef: NEW_NPC },
  basisRefs: [], consumes: [], produces: [{ handle: HANDLE, kind: 'entity', outcomeBinding: 'always' }], outcomeBinding: 'always', summary: '接入原准备包中的档案员。' });

export async function createStoryAdmissionFixture(name, { newNpc = false, definitionOnly = false, definitions = [], worldOptions = {} } = {}) {
  const f = await createStoryMaterializationFixture(name, { newNpc, definitions, worldOptions });
  const selectors = definitions.map(value => ({ kind: 'materializeStory', source: { kind: value.producer.produces[0].kind,
    preparationHash: f.preparationHash, candidateRef: value.ref }, basisRefs: [], consumes: [],
    produces: clone(value.producer.produces), outcomeBinding: 'always', summary: value.producer.summary }));
  const submitted = bundle([...(newNpc ? [npcSelector(f)] : []), ...selectors, ...(definitionOnly ? [] : [factSelector(f)])]);
  const parsed = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(encodeVNextStrictToolBundle(submitted)));
  assert.equal(parsed.kind, 'accepted', JSON.stringify(parsed));
  const lowered = lowerVNext2ProposalBundle({ ...f, value: parsed.bundle });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered));
  f.rulesInput = lowered.command.rulesInput;
  f.bindingInput = { ...f, job: { request: f.request, context: f.storyContext, checkpoint: f.checkpoint },
    proposal: parsed.bundle, preparedActionId: `prepared:${f.rootActionId}` };
  const body = prepareStoryAdmissionBinding(f.bindingInput);
  assert.ok(body); f.binding = { ...body, bindingHash: hash(body) };
  f.beforeAdmission = clone(f.state);
  f.result = f.run(f.rulesInput);
  f.receiptInput = { ...f, receiptId: f.result.receipt.receiptId, recordedAtEventSeq: f.result.receipt.eventRange.toEventSeq };
  f.admission = storyAdmissionReceipt(f.receiptInput);
  return f;
}
