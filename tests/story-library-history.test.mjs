import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { buildStoryArchive, validateStoryArchive } from '../app/_runtime/lib/room/story-archive.ts';
import { validateStoryLibraryGenesis } from '../app/_runtime/lib/room/story-library.ts';
import { createStoryAdmissionFixture, CLERK, factSelector, FACT } from './fixtures/kp-vnext-story-materialization.mjs';
import { storyLibraryFixture, freezeStoryReuse, admitStoryReuse } from './fixtures/story-library.mjs';
import { storyArchiveFixture } from './fixtures/story-archive.mjs';
import { branchStoryLibrary, archiveHostingLibrary } from './fixtures/story-library-history.mjs';
import { geometry } from './fixtures/historical-world.mjs';

test('historical manuscript survives two real genesis branches and rearchives without source jobs, accounts or permits', async () => {
  const remote = 'scene:library:remote';
  const f = await createStoryAdmissionFixture('library-historical', { newNpc: true, definitionOnly: true,
    worldOptions: { additionalScenes: [{ id: remote, name: '异地档案馆', geometry: geometry() }], characterScenes: { [CLERK]: remote } } });
  const source = await storyArchiveFixture('library-history', true, f);
  const built = await buildStoryArchive(source.input, source.ports); assert.equal(built.kind, 'prepared', JSON.stringify(built));
  const validated = await validateStoryArchive(built.envelope, source.ports); assert.equal(validated.kind, 'validated', JSON.stringify(validated));
  const original = canonicalHash(built.envelope), first = await branchStoryLibrary(f, validated, 'first');
  assert.equal(first.entries.length, 1); assert.equal(first.entries[0].origin.timelineBindings.length, 2);
  const rearchived = await archiveHostingLibrary(first.target, first.entries);
  for (const field of ['jobs', 'accounts', 'invocations', 'admissions']) assert.deepEqual(rearchived.envelope.storySnapshot[field], []);
  assert.deepEqual(rearchived.historyMaterials.preparations[0].definitions, f.admission.definitions);
  const second = await branchStoryLibrary(first.target, rearchived, 'second', { focusSceneId: remote }), entry = second.entries[0];
  assert.equal(entry.origin.timelineGenesisChain.length, 3);
  validateStoryLibraryGenesis(entry, second.target.genesis);
  const changed = structuredClone(entry);
  [changed.origin.timelineBindings[0].targetTimelineId, changed.origin.timelineBindings[1].targetTimelineId] =
    [changed.origin.timelineBindings[1].targetTimelineId, changed.origin.timelineBindings[0].targetTimelineId];
  const { entryHash: _entryHash, ...body } = changed; changed.entryHash = canonicalHash(body);
  assert.throws(() => validateStoryLibraryGenesis(changed, second.target.genesis), /STORY_LIBRARY_BINDING_INVALID/);
  const library = storyLibraryFixture(second.target, second.entries), frozen = freezeStoryReuse(second.target, library);
  const admitted = admitStoryReuse(second.target, library, frozen, [factSelector(second.target)]);
  assert.equal(admitted.admission.owner.kind, 'hostingArtifact'); assert.deepEqual(admitted.admission.definitions, []);
  const fact = admitted.admission.facts.find(value => value.candidateRef === FACT);
  assert.equal(fact.knowledge[0].holderRef, f.admission.definitions[0].authorityRef);
  assert.equal(canonicalHash(entry.artifact.preparation), f.preparationHash);
  assert.equal(canonicalHash(built.envelope), original);
  assert.equal(second.target.recipes.length, 0, 'disabled creation method never prevents hosted reuse');
});

test('a historical genesis fact and private knowledge survive rearchive and a further branch without invented target events', async () => {
  const remote = 'scene:library:baseline-remote';
  const f = await createStoryAdmissionFixture('library-baseline-fact', { newNpc: true,
    worldOptions: { additionalScenes: [{ id: remote, name: '异地档案馆', geometry: geometry() }], characterScenes: { [CLERK]: remote } } });
  const source = await storyArchiveFixture('library-baseline-fact', true, f);
  const built = await buildStoryArchive(source.input, source.ports); assert.equal(built.kind, 'prepared', JSON.stringify(built));
  const validated = await validateStoryArchive(built.envelope, source.ports); assert.equal(validated.kind, 'validated', JSON.stringify(validated));
  const first = await branchStoryLibrary(f, validated, 'baseline-first', { focusSceneId: remote });
  const saved = await archiveHostingLibrary(first.target, first.entries);
  const second = await branchStoryLibrary(first.target, saved, 'baseline-second', { focusSceneId: remote });
  const material = saved.historyMaterials.preparations[0], entry = second.entries[0];
  assert.equal(material.recordedAtEventSeq, '0');
  assert.deepEqual(material.facts, f.admission.facts);
  assert.deepEqual(entry.origin.baseline.facts, f.admission.facts);
  assert.deepEqual(second.target.events, []);
  validateStoryLibraryGenesis(entry, second.target.genesis);
  const known = material.facts[0].knowledge[0];
  assert.equal(second.target.state.knowledge[known.holderRef][known.knowledgeRef].characterId, known.holderRef);
  assert.equal(second.target.state.knowledge[second.target.actorCharacterId]?.[known.knowledgeRef], undefined,
    'new identity does not inherit an NPC secret');
  const again = await archiveHostingLibrary(second.target, second.entries);
  assert.deepEqual(again.historyMaterials.preparations[0].facts, f.admission.facts);
});
