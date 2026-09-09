import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { closeVNextProposalSchemaRequest, createVNextProposalOfferModelInput } from '../app/_runtime/lib/kp/vnext/proposal-schema.ts';
import { parseVNextProposalOfferResponse } from '../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { lowerVNext2ProposalBundle } from '../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { resolveStoryLibrarySelection, storyLibraryMappings, storyLibraryOwner } from '../app/_runtime/lib/room/story-library.ts';
import { storyLibraryBlockedCandidates } from '../app/_runtime/lib/room/story-library-context.ts';
import { roomStoryRequest } from '../app/_runtime/lib/room/story-action-request.ts';
import { createStoryMaterializationFixture, createStoryAdmissionFixture, ACTOR, BOATMAN, FACT, KNOWLEDGE,
  NEW_NPC, SCENE, factSelector, npcSelector, bundle } from './fixtures/kp-vnext-story-materialization.mjs';
import { storyLibraryFixture, freezeStoryReuse, admitStoryReuse } from './fixtures/story-library.mjs';
import { itemBundle } from './fixtures/vnext-authored-bundles.mjs';

for (const investigation of [false, true]) test(`${investigation ? 'investigation' : 'conflict'}: later action selects the saved reviewed story without author calls or forced progress`, async () => {
  const f = investigation ? await createStoryAdmissionFixture('library-investigation', { newNpc: true, definitionOnly: true })
    : await createStoryMaterializationFixture('library-conflict');
  const library = storyLibraryFixture(f), before = canonicalHash(library.entry.artifact), calls = f.invocations.length;
  f.run({ kind: 'resolveFreeAction', proposalId: `${f.rootActionId}:decline-for-now`, characterId: ACTOR,
    goal: '暂时不承诺任何工作，整理自己的记录', method: '独自整理', feasibility: { kind: 'directSuccess', publicBasis: '只是整理自己的记录。' },
    outcome: { fictionTimeCostMicros: '10' } });
  const frozen = freezeStoryReuse(f, library), selected = resolveStoryLibrarySelection({ ...library, libraryRef: library.entry.libraryRef, catalog: frozen.catalog });
  assert.equal(selected.kind, 'ready', JSON.stringify(selected));
  const selectionId = `storyReuse:${library.entry.libraryRef}`;
  const schema = createVNextProposalOfferModelInput('choose', frozen.selectionContext);
  assert.ok(schema.tools[0].function.parameters.properties.requestedCapabilities.items.enum.includes(selectionId));
  const response = { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: schema.tools[0].function.name,
    arguments: JSON.stringify({ requestedCapabilities: [selectionId] }) } }] } }] };
  const parsed = parseVNextProposalOfferResponse(response, frozen.selectionContext);
  assert.equal(parsed.kind, 'schemaRequested', JSON.stringify(parsed));
  assert.deepEqual(parsed.story, { kind: 'existing', libraryRef: library.entry.libraryRef });
  assert.throws(() => closeVNextProposalSchemaRequest([selectionId], f.selectionContext));
  assert.throws(() => closeVNextProposalSchemaRequest([selectionId, 'storyPreparation'], frozen.selectionContext));
  const saved = admitStoryReuse(f, library, frozen, [factSelector(f)]);
  assert.equal(saved.admission.definitions.length, 0);
  assert.deepEqual(saved.binding.priorMappings.definitions, investigation ? f.admission.definitions : []);
  const holder = investigation ? f.admission.definitions[0].authorityRef : BOATMAN;
  const known = saved.admission.facts[0].knowledge[0];
  assert.equal(known.candidateRef, KNOWLEDGE); assert.equal(known.holderRef, holder);
  assert.ok(f.state.knowledge[holder][known.knowledgeRef]);
  assert.equal(Object.values(f.state.entities).filter(value => value.name === '许录').length, investigation ? 1 : 0);
  assert.equal(canonicalHash(library.entry.artifact), before);
  assert.equal(f.invocations.length, calls, 'no re-authoring, review or recipe lookup on reuse');
  const next = freezeStoryReuse(f, library, { rootActionId: `${f.rootActionId}:after-facts` });
  const duplicate = lowerVNext2ProposalBundle({ ...f, value: saved.proposal, requiredContext: next.context,
    rootActionId: next.context.binding.rootActionId });
  assert.equal(duplicate.kind, 'rejected');
});

test('unknown library selection fails closed and a pending opportunity keeps its original job/source budget', async () => {
  const f = await createStoryMaterializationFixture('library-pending'), library = storyLibraryFixture(f);
  const pending = { ...library.job, checkpoint: null }, journal = { ...library.journal, readCreationJob: () => pending };
  const frozen = freezeStoryReuse(f, library);
  const resolution = resolveStoryLibrarySelection({ ...library, journal, catalog: frozen.catalog, libraryRef: library.entry.libraryRef });
  assert.equal(resolution.kind, 'resume'); assert.deepEqual(resolution.job, pending);
  assert.equal(resolution.job.request.source.budgetAccountId, f.request.source.budgetAccountId);
  assert.equal(resolveStoryLibrarySelection({ ...library, catalog: frozen.catalog, libraryRef: 'sha256:' + '0'.repeat(64) }).kind, 'rejected');
  const repeated = roomStoryRequest({ ...f.selectionContext, binding: { ...f.selectionContext.binding, rootActionId: 'another-action' } }, f.state,
    { method: 'story.method.local-conflict', scale: 'short', connection: 'local' }, []);
  assert.equal(repeated.opportunityId, f.request.opportunityId, 'a new outer action cannot alias the opportunity to reset its generation budget');
});

test('current semantics include newly related collection members and keep unrelated evidence reusable', async () => {
  const f = await createStoryMaterializationFixture('library-new-facts'), library = storyLibraryFixture(f);
  for (const [related, expected] of [[true, true], [false, false]]) {
    const current = structuredClone(f.storyContext);
    current.materials.push({ ref: 'fact:new-independent-proof', kind: 'fact', availability: 'known',
      content: { value: '后来取得的新证据改变了原卷目前的保管情况。' }, subjectRefs: [related ? SCENE : 'scene:elsewhere'], basisRefs: [] });
    const blocked = storyLibraryBlockedCandidates(library.entry, { definitions: [], facts: [] }, current);
    assert.equal(blocked.includes(FACT), expected);
  }
  const frozen = freezeStoryReuse(f, library), tampered = structuredClone(frozen.binding.library);
  tampered.mappings.definitions = [{ candidateRef: NEW_NPC, authorityRef: BOATMAN, recordedByEventId: 'fabricated', definitionRefs: [] }];
  assert.throws(() => storyLibraryMappings(library.entry, [{ ...f.admission, owner: storyLibraryOwner(library.entry),
    preparationHash: f.preparationHash, jobId: f.preparation.jobId, definitions: tampered.mappings.definitions, facts: [] }]));
});

test('a manuscript can admit its remaining facts after its own temporal evidence was committed', async () => {
  const laterRef = 'candidate:later-proof', laterKnowledge = 'candidate:later-memory';
  const f = await createStoryMaterializationFixture('library-own-temporal-evidence', { editDraft(body) {
    const later = structuredClone(body.facts[0]);
    later.ref = laterRef; later.content = '另一次核验确认卷宗的签署日期早于抄件。';
    later.knowledge[0] = { ...later.knowledge[0], ref: laterKnowledge, factRef: laterRef, sourceRef: laterRef };
    body.facts.push(later); body.participants[0].knowledgeRefs.push(laterKnowledge);
  } });
  const library = storyLibraryFixture(f), manuscriptHash = canonicalHash(library.entry.artifact);
  admitStoryReuse(f, library, freezeStoryReuse(f, library), [factSelector(f)]);
  const later = freezeStoryReuse(f, library, { rootActionId: `${f.rootActionId}:remaining` });
  assert.deepEqual(later.binding.library.blockedCandidateRefs, []);
  const unrelatedDraftEvidence = structuredClone(later.binding.library.currentContext);
  const ownEvidence = unrelatedDraftEvidence.materials.find(value => value.content?.kind === 'storyTemporalEvidence');
  assert.ok(ownEvidence);
  unrelatedDraftEvidence.materials.push({ ...structuredClone(ownEvidence), ref: `${ownEvidence.ref}:another-manuscript` });
  assert.ok(storyLibraryBlockedCandidates(library.entry, later.binding.library.mappings, unrelatedDraftEvidence).includes(laterRef),
    'only the exact committed candidate evidence is excluded from new related material');
  const admitted = admitStoryReuse(f, library, later, [{ ...factSelector(f), candidateRefs: [laterRef] }]);
  assert.equal(admitted.admission.facts[0].knowledge[0].candidateRef, laterKnowledge);
  assert.equal(library.admissions.length, 2);
  assert.equal(canonicalHash(library.entry.artifact), manuscriptHash);
  assert.equal(f.invocations.length, 2);
});

test('saved ability, item definition and item instance resolve declared reference slots across separate real actions', async () => {
  const producers = itemBundle().proposals.slice(0, 3);
  const refs = ['candidate:ability', 'candidate:item', 'candidate:doses'];
  const definitions = producers.map((producer, index) => ({ ref: refs[index], kind: index === 0 ? 'ability' : 'item', producer,
    dependsOn: index ? [refs[index - 1], SCENE] : [SCENE] }));
  const f = await createStoryMaterializationFixture('library-staged-items', { definitions }), library = storyLibraryFixture(f);
  for (let index = 0; index < producers.length; index++) {
    const frozen = freezeStoryReuse(f, library, { rootActionId: `${f.rootActionId}:part:${index}` });
    const selector = { kind: 'materializeStory', source: { kind: producers[index].produces[0].kind,
      preparationHash: f.preparationHash, candidateRef: refs[index] }, basisRefs: [], consumes: [],
      produces: producers[index].produces, outcomeBinding: 'always', summary: producers[index].summary };
    const saved = admitStoryReuse(f, library, frozen, [selector]);
    assert.equal(saved.admission.definitions.length, 1);
  }
  const maps = storyLibraryMappings(library.entry, library.admissions), [ability, item, doses] = refs.map(ref => maps.definitions.find(value => value.candidateRef === ref));
  assert.equal(f.state.campaignRuntime.itemSystem.definitions[item.authorityRef].content.use.abilityRef, ability.authorityRef);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[doses.authorityRef].definitionRef, item.authorityRef);
  assert.equal(f.invocations.length, 2);
});
