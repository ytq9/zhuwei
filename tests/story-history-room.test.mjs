import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { RoomStoryHistory } from '../app/_runtime/lib/room/story-history-room.ts';
import { StoryHistorySessions } from '../app/_runtime/lib/room/story-history-sessions.ts';
import { AuthoritativeRoomStore } from '../app/_runtime/lib/room/authority-store.ts';
import { StoryCreationStore } from '../app/_runtime/lib/room/story-creation-store.ts';
import { buildAuthoritativeArchive } from '../app/_runtime/lib/room/archive.ts';
import { buildStoryArchive } from '../app/_runtime/lib/room/story-archive.ts';
import { authoritativeModuleProfile } from '../app/_runtime/lib/module/authoritative.ts';
import { canonicalHash } from '../app/_runtime/lib/kp/vnext/canonical-json.ts';
import { step, replay, project } from '../app/_runtime/lib/rules/index.ts';

const PRINCIPAL = 'principal:history-room:owner', FOREIGN = 'principal:history-room:other';
const ACTOR = 'character:history-room:owner', OTHER = 'character:history-room:other';
const SEAT = 'seat:history-room:owner', FOREIGN_SEAT = 'seat:history-room:other';
const denied = () => ({ kind: 'rejected', code: 'STORY_HISTORY_SOURCE_UNAVAILABLE' });
const sourceOf = archive => ({ roomId: archive.roomId, runtimeEpochId: archive.signedGenesis.runtimeEpochId,
  branchId: archive.head.activeBranchId, archiveHash: archive.archiveHash });

function database() {
  const db = new DatabaseSync(':memory:'); let tx = 0, id = 0;
  const storage = { sql: { exec(query, ...args) {
    let rows;
    if (args.length === 0 && /^(CREATE|ALTER|DELETE)\b/u.test(query.trim())) { db.exec(query); rows = []; }
    else rows = db.prepare(query).all(...args).map(row => ({ ...row }));
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; },
      rowsWritten: db.prepare('SELECT changes() AS count').get().count,
      [Symbol.iterator]: function* () { yield* rows; } };
  } }, transactionSync(callback) {
    const name = `history_room_${++tx}`; db.exec(`SAVEPOINT ${name}`);
    try { const value = callback(); db.exec(`RELEASE ${name}`); return value; }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error; }
  } };
  const authority = new AuthoritativeRoomStore(storage), sessions = new StoryHistorySessions(storage, { newId: () => `private-${++id}` });
  const story = new StoryCreationStore(storage, { hash: canonicalHash, now: () => 0, newId: () => `call-${++id}` });
  authority.ensureSchema(); sessions.ensureSchema(); story.ensureSchema();
  return { db, storage, authority, sessions, story };
}

async function fixture({ actionCount = 4, sessionVersion = 1 } = {}) {
  const s = database(), moduleProfile = await authoritativeModuleProfile('black-oak-will');
  const [first, second] = moduleProfile.storyBible.storyAnchors.locations;
  assert.ok(first && second && first.sceneId !== second.sceneId);
  const initialized = step(undefined, undefined, {
    kind: 'initializeAuthoritativeWorld', roomId: 'room:history-host:source', runtimeEpochId: 'epoch:history-host:source',
    activeBranchId: 'branch:history-host:source', moduleRef: moduleProfile.moduleRef,
    initialDefinitionCatalogRef: { profileId: 'catalog:history-host', profileHash: canonicalHash('history-host') }, fictionInstantMicros: '0',
    scenes: [first, second].map(location => ({ id: location.sceneId, name: location.name, geometry: location.tacticalGeometry })),
    principals: [{ id: PRINCIPAL, sessionVersion, role: 'host' }, { id: FOREIGN, sessionVersion: 1, role: 'player' }],
    seats: [{ id: SEAT, principalId: PRINCIPAL, status: 'active' }, { id: FOREIGN_SEAT, principalId: FOREIGN, status: 'active' }],
    characters: [{ id: ACTOR, kind: 'player', name: '旧角色', sceneId: first.sceneId, tenureStatus: 'active' },
      { id: OTHER, kind: 'player', name: '远方旧角色', sceneId: second.sceneId, tenureStatus: 'active' }],
    characterControls: [{ characterId: ACTOR, seatId: SEAT }, { characterId: OTHER, seatId: FOREIGN_SEAT }], canonicalFacts: [],
    initialKnowledge: [{ characterId: ACTOR, knowledgeRef: 'knowledge:owner', kind: 'sourceClaim', layer: 'full', content: 'OWNER-PRIVATE-KNOWLEDGE',
      visibility: 'private', provenanceChain: ['genesis:owner-private'] },
    { characterId: OTHER, knowledgeRef: 'knowledge:foreign', kind: 'sourceClaim', layer: 'full', content: 'FOREIGN-PRIVATE-KNOWLEDGE',
      visibility: 'private', provenanceChain: ['genesis:foreign-private'] }],
  });
  assert.equal(initialized.kind, 'initialized', JSON.stringify(initialized));
  const beginning = replay(initialized.genesis, []); assert.equal(beginning.kind, 'replayed');
  const f = { ...s, moduleProfile, first, second, genesis: initialized.genesis, profiles: initialized.profiles, state: beginning.state,
    events: [], authorizationVersion: 'authorization:1', metadataReads: 0, snapshotReads: 0, replays: 0, historicalSteps: 0 };
  f.context = { principal: { id: PRINCIPAL, sessionVersion } };
  f.run = input => {
    const result = step(f.profiles, f.state, input); assert.equal(result.kind, 'committed', JSON.stringify(result));
    f.events.push(...result.events);
    const restored = replay(f.genesis, f.events); assert.equal(restored.kind, 'replayed', JSON.stringify(restored));
    assert.deepEqual(restored.state, result.state); f.state = restored.state; return result;
  };
  for (let i = 0; i < actionCount; i += 1) f.run({ kind: 'resolveFreeAction', proposalId: `root:history-host:${i}`,
    characterId: i % 2 ? OTHER : ACTOR, goal: '整理已有记录', method: '安静地整理',
    feasibility: { kind: 'directSuccess', publicBasis: '没有有意义的不确定性。' }, outcome: { fictionTimeCostMicros: '1000000' } });
  f.refreshSnapshot = async () => {
    f.archive = await buildAuthoritativeArchive({ roomId: f.state.roomId, signedGenesis: f.genesis, events: f.events,
      receiptRefs: [], projectionAudits: [] }, replay);
    const captured = s.story.archiveSnapshot({ roomId: f.state.roomId, runtimeEpochId: f.state.runtimeEpochId });
    assert.equal(captured.kind, 'available', JSON.stringify(captured));
    const checked = await buildStoryArchive({ archive: f.archive, storySnapshot: captured.snapshot, hostBindings: [], generation: '0' },
      { replay, validateHostBinding: () => false, readAdmissionRulesInput: () => undefined });
    assert.equal(checked.kind, 'prepared', JSON.stringify(checked));
    f.snapshot = { envelope: checked.envelope, historyMaterials: checked.historyMaterials, moduleProfile };
  };
  await f.refreshSnapshot();
  f.ports = {
    authorize(context) {
      if (f.state.principals[context.principal.id]?.sessionVersion !== context.principal.sessionVersion
        || !Object.values(f.state.seats).some(seat => seat.principalId === context.principal.id && seat.status === 'active')) return denied();
      return { kind: 'authorized', state: f.state, profiles: f.profiles, principalId: context.principal.id,
        authorizationVersion: `${f.authorizationVersion}:${context.principal.id}:${context.principal.sessionVersion}` };
    },
    viewer(context, characterId) {
      const authorization = f.ports.authorize(context); if (authorization.kind !== 'authorized') return authorization;
      const seats = Object.values(f.state.seats).filter(seat => seat.principalId === context.principal.id && seat.status === 'active');
      const controls = Object.values(f.state.characterControls).filter(control => seats.some(seat => seat.id === control.seatId));
      const chosen = characterId ?? controls[0]?.characterId, control = controls.find(candidate => candidate.characterId === chosen);
      if (!control) return denied();
      const readModel = project(f.profiles, f.state, { kind: 'player', principalId: context.principal.id,
        sessionVersion: context.principal.sessionVersion, seatId: control.seatId, characterId: chosen });
      if (readModel.kind !== 'projected') return denied();
      return { kind: 'viewed', characterId: chosen, viewerKey: `${context.principal.id}\u001f${chosen}`,
        readModel, projectionHash: readModel.projectionHash };
    },
    async sourceMetadata() { f.metadataReads += 1; return sourceOf(f.archive); },
    async readSnapshot() { f.snapshotReads += 1; return structuredClone(f.snapshot); },
    experiencedMessagesUpperOrdinal: key => f.authority.experiencedMessagesUpperOrdinal(key),
    experiencedMessagesPage: (key, range) => f.authority.experiencedMessagesPage(key, range),
    rulesRuntime: { replay(genesis, events) { f.replays += 1; return replay(genesis, events); },
      step(profiles, state, input) { f.historicalSteps += 1; return step(profiles, state, input); } },
    buildCharacter(seed, sceneId) { return { id: seed.characterId, kind: 'player', name: seed.staticCard.name, sceneId,
      tenureStatus: 'active', ...(seed.staticCard.rules ?? {}) }; },
  };
  f.room = new RoomStoryHistory(s.sessions, f.ports);
  f.append = (index, { principal = PRINCIPAL, characterId = ACTOR, kind = 'kp' } = {}) => f.authority.appendExperiencedMessage({
    viewerKey: `${principal}\u001f${characterId}`, messageId: `message:${principal}:${index}`, sceneIds: [f.state.entities[characterId].sceneId],
    kind, speakerCharacterId: null, speakerName: kind === 'roll' ? '掷骰' : 'KP', body: `${principal === FOREIGN ? 'FOREIGN' : 'OWNER'}-MESSAGE-${index}`,
    sourceEventSeq: f.state.version, receiptId: `receipt:message:${index}` });
  f.branchInput = startToken => ({ startToken, character: { characterId: 'character:history-host:new', controllerPrincipalId: PRINCIPAL,
    staticCard: { name: '新的旅人', sceneId: 'browser-supplied-location-does-not-grant-origin' } },
    target: { roomId: 'room:history-host:new', runtimeEpochId: 'epoch:history-host:new', activeBranchId: 'branch:history-host:new', seatId: 'seat:history-host:new' } });
  return f;
}

test('Viewer export pages all retained messages with frozen projection and range through SQLite eviction', async () => {
  const f = await fixture();
  for (let i = 1; i <= 305; i += 1) { f.append(i); f.append(i, { principal: FOREIGN, characterId: OTHER }); }
  f.ports.readSnapshot = async () => { throw new Error('Viewer must not read a private snapshot'); };
  const first = await f.room.readViewerPage(f.context, { cursor: null });
  assert.equal(first.kind, 'exported', JSON.stringify(first)); assert.equal(first.export.transcript.length, 200);
  assert.equal(first.export.transcript[0].body, 'OWNER-MESSAGE-1'); assert.ok(first.export.nextCursor);
  const frozenProjection = structuredClone(first.export.readModel), cursor = first.export.nextCursor;
  for (let i = 306; i <= 310; i += 1) f.append(i);
  f.run({ kind: 'resolveFreeAction', proposalId: 'root:history-host:after-export', characterId: ACTOR, goal: '继续整理', method: '安静整理',
    feasibility: { kind: 'directSuccess', publicBasis: '可直接完成。' }, outcome: { fictionTimeCostMicros: '1000000' } });
  const restored = new StoryHistorySessions(f.storage); restored.ensureSchema();
  const room = new RoomStoryHistory(restored, f.ports);
  const second = await room.readViewerPage(f.context, { cursor });
  assert.equal(second.kind, 'exported', JSON.stringify(second)); assert.equal(second.export.transcript.length, 105);
  assert.equal(second.export.transcript.at(-1).body, 'OWNER-MESSAGE-305'); assert.equal(second.export.nextCursor, null);
  assert.deepEqual(second.export.readModel, frozenProjection); assert.equal(second.export.projectionHash, first.export.projectionHash);
  assert.deepEqual(await room.readViewerPage(f.context, { cursor }), second, 'same frozen page is idempotent');
  const exportBytes = JSON.stringify([first, second]);
  assert.equal(exportBytes.includes('FOREIGN-PRIVATE-KNOWLEDGE'), false); assert.equal(exportBytes.includes('FOREIGN-MESSAGE'), false);
  assert.equal(f.snapshotReads, 0); assert.equal(f.metadataReads, 1); assert.equal(f.historicalSteps, 0);
});

test('missing, foreign, changed-character and revoked-version cursors never read another Viewer', async () => {
  const f = await fixture(); for (let i = 1; i <= 205; i += 1) f.append(i);
  const first = await f.room.readViewerPage(f.context, { cursor: null }); assert.equal(first.kind, 'exported');
  const cursor = first.export.nextCursor;
  for (const [context, input] of [
    [f.context, { cursor: 'foreign-or-lost-token' }],
    [{ principal: { id: FOREIGN, sessionVersion: 1 } }, { cursor }],
    [f.context, { cursor, characterId: OTHER }],
  ]) assert.deepEqual(await f.room.readViewerPage(context, input), { kind: 'rejected', code: 'STORY_HISTORY_CURSOR_UNAVAILABLE' });
  f.authorizationVersion = 'authorization:changed';
  assert.equal((await f.room.readViewerPage(f.context, { cursor })).kind, 'rejected');
  assert.equal(f.metadataReads, 1); assert.equal(f.snapshotReads, 0);
});

test('historical starts freeze the validated source, page bounded complete cuts, and expose only public locations', async () => {
  const f = await fixture({ actionCount: 8 });
  const oldArchiveHash = f.archive.archiveHash; let cursor = null, starts = [], pages = 0;
  do {
    const before = f.replays, page = await f.room.listStarts(f.context, { cursor });
    assert.equal(page.kind, 'listed', JSON.stringify(page)); assert.ok(f.replays - before <= 2, 'only the current bounded page replays cuts');
    assert.ok(page.starts.length <= 12); starts.push(...page.starts); pages += 1;
    if (pages === 1) {
      f.run({ kind: 'resolveFreeAction', proposalId: 'root:history-host:after-list', characterId: ACTOR, goal: '继续整理', method: '继续整理',
        feasibility: { kind: 'directSuccess', publicBasis: '可直接完成。' }, outcome: { fictionTimeCostMicros: '1000000' } });
      await f.refreshSnapshot();
    }
    cursor = page.nextCursor;
  } while (cursor !== null && pages < 100);
  assert.equal(cursor, null); assert.ok(pages > 1); assert.equal(f.snapshotReads, 1);
  assert.ok(starts.some(start => start.sceneName === f.first.name)); assert.ok(starts.some(start => start.sceneName === f.second.name));
  for (const entry of starts) {
    assert.deepEqual(Object.keys(entry).sort(), ['fictionTimeLabel', 'label', 'sceneName', 'startToken']);
    const saved = f.sessions.readStart(entry.startToken); assert.ok(saved);
    assert.equal(saved.session.snapshot.envelope.archive.archiveHash, oldArchiveHash);
    const events = saved.session.snapshot.envelope.archive.events, n = Number(saved.eventSeq);
    const roots = new Set(events.slice(0, n).map(event => event.rootActionId));
    assert.equal(events.slice(n).some(event => roots.has(event.rootActionId)), false, 'no resumed root is split');
  }
  const bytes = JSON.stringify(starts);
  for (const secret of ['FOREIGN-PRIVATE-KNOWLEDGE', 'OWNER-PRIVATE-KNOWLEDGE', 'npcIds', 'clueIds', 'conflictAnchor', 'signedGenesis', 'storySnapshot']) {
    assert.equal(bytes.includes(secret), false, secret);
  }
});

test('a new identity can enter another historical location only after actual Rules initialization', async () => {
  const f = await fixture(); const sourceBefore = canonicalHash({ state: f.state, events: f.events, archive: f.archive });
  const page = await f.room.listStarts(f.context, { cursor: null }); assert.equal(page.kind, 'listed');
  const chosen = page.starts.find(start => start.sceneName === f.second.name); assert.ok(chosen, JSON.stringify(page));
  const prepared = await f.room.prepareBranch(f.context, f.branchInput(chosen.startToken));
  assert.equal(prepared.kind, 'prepared', JSON.stringify(prepared)); assert.equal(f.historicalSteps, 1);
  assert.equal(prepared.character.staticCard.sceneId, f.second.sceneId); assert.equal(prepared.seed.identity.sceneId, f.second.sceneId);
  const target = f.branchInput(chosen.startToken).target;
  const actual = step(undefined, undefined, { kind: 'initializeHistoricalWorld', schema: 'zhuwei.historical-world-initialization/v1',
    roomId: target.roomId, runtimeEpochId: target.runtimeEpochId, activeBranchId: target.activeBranchId,
    sourceArchive: prepared.sourceArchive, cut: { eventSeq: prepared.seed.cut.eventSeq, focusSceneId: prepared.seed.cut.focusSceneId },
    identity: { principal: f.context.principal, seatId: target.seatId, character: prepared.seed.identity.character,
      originBasisRefs: prepared.seed.identity.originBasisRefs } });
  assert.equal(actual.kind, 'initialized', JSON.stringify(actual));
  assert.deepEqual(actual.genesis.initialState.knowledge[prepared.character.characterId], {});
  assert.deepEqual(Object.keys(actual.genesis.initialState.characterControls), [prepared.character.characterId]);
  const restored = replay(actual.genesis, []); assert.equal(restored.kind, 'replayed');
  assert.deepEqual(restored.state, actual.genesis.initialState);
  assert.equal(canonicalHash({ state: f.state, events: f.events, archive: f.archive }), sourceBefore);

  const invalid = f.branchInput(chosen.startToken);
  invalid.character.staticCard.rules = { abilityScores: { str: -1, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
  const rejectedBuild = await f.room.prepareBranch(f.context, invalid);
  assert.equal(rejectedBuild.kind, 'rejected'); assert.equal(f.historicalSteps, 2, 'bad normal build was rejected by Rules, not merely rehashed');
  const duplicate = f.branchInput(chosen.startToken); duplicate.character.characterId = OTHER;
  assert.equal((await f.room.prepareBranch(f.context, duplicate)).kind, 'rejected');
});

test('history handles require live access, survive ordinary eviction, and disappear on recovery-session clearing', async () => {
  const f = await fixture(); const first = await f.room.listStarts(f.context, { cursor: null }); assert.equal(first.kind, 'listed');
  const token = first.starts[0].startToken, cursor = first.nextCursor; assert.ok(cursor);
  const restored = new StoryHistorySessions(f.storage); restored.ensureSchema();
  const room = new RoomStoryHistory(restored, f.ports);
  assert.equal((await room.listStarts(f.context, { cursor })).kind, 'listed');
  assert.equal((await room.prepareBranch({ principal: { id: FOREIGN, sessionVersion: 1 } }, f.branchInput(token))).kind, 'rejected');
  assert.equal((await room.prepareBranch(f.context, f.branchInput('missing-start-token'))).kind, 'rejected');
  assert.equal(restored.isEmpty(), false); restored.clear(); assert.equal(restored.isEmpty(), true);
  assert.equal((await room.listStarts(f.context, { cursor })).code, 'STORY_HISTORY_CURSOR_UNAVAILABLE');
  assert.equal((await room.prepareBranch(f.context, f.branchInput(token))).code, 'STORY_HISTORY_START_UNAVAILABLE');
  assert.equal((await room.listStarts(f.context, { cursor: null })).kind, 'listed');
});

test('Room creation mirrors the exact active seat and current principal version before any write', async () => {
  const f = await fixture({ sessionVersion: 2 });
  const input = { roomId: f.state.roomId, moduleId: f.moduleProfile.moduleId, profiles: f.profiles, genesis: f.genesis, state: f.state,
    members: [{ principalId: PRINCIPAL, role: 'host' }, { principalId: FOREIGN, role: 'player' }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: PRINCIPAL, staticCard: { name: '旧角色', sceneId: f.first.sceneId } }] };
  f.storage.transactionSync(() => f.authority.createRoom(input));
  assert.deepEqual({ ...f.db.prepare('SELECT principal_id, seat_id, session_version FROM authority_members WHERE principal_id = ?').get(PRINCIPAL) },
    { principal_id: PRINCIPAL, seat_id: SEAT, session_version: 2 });
  for (const change of [
    value => { delete value.state.seats[SEAT]; },
    value => { value.state.seats['seat:duplicated'] = { id: 'seat:duplicated', principalId: PRINCIPAL, status: 'active' }; },
  ]) {
    const other = database(), malformed = structuredClone(input); change(malformed);
    assert.throws(() => other.authority.createRoom(malformed), /AUTHORITATIVE_MEMBER_IDENTITY_INVALID/);
    assert.equal(other.db.prepare('SELECT COUNT(*) AS n FROM authority_rooms').get().n, 0);
  }
});

test('authorization lost across asynchronous metadata preparation prevents export exposure', async () => {
  const f = await fixture(); f.append(1);
  f.ports.sourceMetadata = async () => { f.authorizationVersion = 'authorization:revoked'; return sourceOf(f.archive); };
  assert.deepEqual(await f.room.readViewerPage(f.context, { cursor: null }), denied());
  assert.equal(f.sessions.isEmpty(), true);
});

test('ordinary stored roll messages are part of the same authorized Viewer export', async () => {
  const f = await fixture(); f.append(1, { kind: 'roll' });
  const result = await f.room.readViewerPage(f.context, { cursor: null });
  assert.equal(result.kind, 'exported', JSON.stringify(result)); assert.equal(result.export.transcript[0].kind, 'roll');
});
