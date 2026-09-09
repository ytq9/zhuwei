import assert from 'node:assert/strict';
import { canonicalHash } from '../../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { buildAuthoritativeArchive } from '../../app/_runtime/lib/room/archive.ts';
import { buildStoryArchive, validateStoryArchive } from '../../app/_runtime/lib/room/story-archive.ts';
import { prepareHistoricalBranch } from '../../app/_runtime/lib/room/story-history/index.ts';
import { extractHistoricalHostingArtifacts } from '../../app/_runtime/lib/room/story-library.ts';
import { SCENE } from './kp-vnext-story-materialization.mjs';

/** Pure branch planning runs the actual historical Rules initializer before
 * attesting the cut. This fixture does not replace the authenticated Room/SQL
 * integration exercised by the Room tests. */
export async function branchStoryLibrary(f, validated, suffix, { focusSceneId = SCENE } = {}) {
  const archive = validated.envelope.archive, sourceState = f.runtime.replay(archive.signedGenesis, archive.events).state;
  const actorId = `character:library:${suffix}`, principalId = `principal:library:${suffix}`, seatId = `seat:library:${suffix}`;
  const character = { id: actorId, kind: 'player', name: '新来的记录者', sceneId: focusSceneId, tenureStatus: 'active',
    classId: 'fighter', raceId: 'human', level: 1, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2, proficientSkills: [], resources: {}, resourceMaximums: {}, hitPoints: { current: 20, maximum: 20 },
    loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] },
    characterBuild: { classId: 'fighter', raceId: 'human', cantrips: [], prepared: [] } };
  const source = { roomId: archive.roomId, runtimeEpochId: archive.signedGenesis.runtimeEpochId, branchId: archive.head.activeBranchId,
    archiveHash: archive.archiveHash };
  const request = { access: { principalId, authorizationVersion: 'fixture-session-1' }, source,
    cut: { eventSeq: archive.head.eventSeq, focusSceneId }, identity: { kind: 'newCharacter', characterId: actorId,
      sceneId: focusSceneId, originBasisRefs: ['anchor:requisition'], character } };
  let initialized, verificationFailure;
  const verify = async input => {
    try {
      assert.deepEqual(input.value.request, request);
      if (!initialized) initialized = f.runtime.step(f.profiles, undefined, { kind: 'initializeHistoricalWorld',
        schema: 'zhuwei.historical-world-initialization/v1', roomId: `room:library:${suffix}`, runtimeEpochId: `epoch:library:${suffix}`,
        activeBranchId: `branch:library:${suffix}`, sourceArchive: input.value.sourceArchive, cut: request.cut,
        identity: { principal: { id: principalId, sessionVersion: 1 }, seatId, character, originBasisRefs: request.identity.originBasisRefs } });
      assert.equal(initialized.kind, 'initialized', JSON.stringify(initialized));
      return { kind: 'verified', authorizationBindingHash: input.authorizationBindingHash, verificationHash: input.verificationHash };
    } catch (error) { verificationFailure = error; throw error; }
  };
  const prepared = await prepareHistoricalBranch(request, { replay: f.runtime.replay,
    async readSource(input) {
      assert.deepEqual(input.request, request);
      return { kind: 'available', authorizationBindingHash: input.authorizationBindingHash,
        value: { archive, ...validated.historyMaterials } };
    }, async readViewerExport() { throw new Error('not used'); }, validateHistoricalCut: verify, validateNewIdentity: verify });
  if (verificationFailure) throw verificationFailure;
  assert.equal(prepared.kind, 'branchPrepared', JSON.stringify(prepared));
  const replayed = f.runtime.replay(initialized.genesis, []); assert.equal(replayed.kind, 'replayed');
  const state = replayed.state, room = { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId };
  const entries = extractHistoricalHostingArtifacts({ room, seed: prepared.seed, validated, targetGenesis: initialized.genesis });
  const target = { ...f, genesis: initialized.genesis, state, profiles: initialized.profiles, events: [], actorCharacterId: actorId,
    rootActionId: `root:library:${suffix}`, viewer: { kind: 'player', principalId, seatId, sessionVersion: 1, characterId: actorId },
    recipes: [], admission: undefined };
  target.run = input => {
    const result = target.runtime.step(target.profiles, target.state, input); assert.equal(result.kind, 'committed', JSON.stringify(result));
    target.events.push(...result.events);
    const rebuilt = target.runtime.replay(target.genesis, target.events); assert.equal(rebuilt.kind, 'replayed', JSON.stringify(rebuilt));
    assert.deepEqual(rebuilt.state, result.state); target.state = rebuilt.state; return result;
  };
  return { target, entries, room, seed: prepared.seed, sourceState };
}

export async function archiveHostingLibrary(target, entries) {
  const archive = await buildAuthoritativeArchive({ roomId: target.state.roomId, signedGenesis: target.genesis,
    events: target.events, receiptRefs: [], projectionAudits: [] }, target.runtime.replay);
  const body = { format: 'zhuwei.story-store-archive/v1', source: { roomId: target.state.roomId, runtimeEpochId: target.state.runtimeEpochId },
    hostingArtifacts: entries, accounts: [], jobs: [], invocations: [], admissionBindings: [], admissions: [], materialManifest: [] };
  const ports = { replay: target.runtime.replay, validateHostBinding() { return false; }, readAdmissionRulesInput() { return undefined; } };
  const built = await buildStoryArchive({ archive, storySnapshot: { ...body, snapshotHash: canonicalHash(body) }, hostBindings: [], generation: '1' }, ports);
  assert.equal(built.kind, 'prepared', JSON.stringify(built));
  const validated = await validateStoryArchive(built.envelope, ports);
  assert.equal(validated.kind, 'validated', JSON.stringify(validated));
  return validated;
}
