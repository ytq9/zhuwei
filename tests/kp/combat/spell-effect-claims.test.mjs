import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAuthorityClaimsFromCommittedRange } from '../../../app/_runtime/lib/rules/v2/claims.ts';
import { createAuthoredProbeFixture, PROBE_ACTOR as ACTOR, PROBE_TARGET as PEER, PROBE_SCENE as SCENE } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';

// SPEC 0016 §§7、8 with SPEC 0012 §10 (ADR 0150-0156): a map act's root is
// told only from claims, and every event in it must be told or listed as a
// record. The events the spell effects add -- conditions, modifiers, zones,
// a repeated save, a summon moving, hit points rising with Aid -- are derived
// from real roots without a gap.

const ENCOUNTER = 'encounter:spell-claims';
const SPELLS = ['aid', 'bless', 'fog', 'guiding-bolt', 'hold-person', 'spiritual'];
const CANTRIPS = ['fire-bolt'];

function apply(f, input) {
  const result = f.runtime.step(f.profiles, f.state, input);
  if (result.events?.length) {
    f.events.push(...result.events);
    f.state = result.state;
  }
  return result;
}
// One map act from its first step to its commit, then its claims.
function act(f, input, faces = {}) {
  const rootActionId = `combat-act:${f.acts += 1}`;
  const priorState = f.state;
  const events = [];
  const face = (request) => {
    if (request.purposeKey.startsWith('initiative:')) return request.purposeKey.includes(ACTOR) ? 20 : 2;
    const key = Object.keys(faces).find((prefix) => request.purposeKey.startsWith(prefix));
    return key === undefined ? 2 : faces[key];
  };
  let result = apply(f, { ...input, rootActionId });
  events.push(...(result.events ?? []));
  while (result.kind === 'awaitingRandomness') {
    result = apply(f, { kind: 'authoritativeRandomness', resolutionId: result.resolutionId, responseId: `authority:${result.resolutionId}`,
      continuationCapability: result.continuationCapability,
      randomnessResults: result.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
        draws: request.dice.map((term) => ({ sides: Number(term.sides), faces: Array(Number(term.count)).fill(Math.min(Number(term.sides), face(request))) })) })) });
    events.push(...(result.events ?? []));
  }
  assert.equal(result.kind, 'committed', JSON.stringify(result).slice(0, 800));
  // The root's receipt spans every step of it.
  const receipt = { ...result.receipt, eventRange: { fromEventSeq: events[0].eventSeq, toEventSeq: events.at(-1).eventSeq } };
  const claims = deriveAuthorityClaimsFromCommittedRange({ receipt, actorCharacterId: input.sourceEntityId ?? ACTOR,
    priorState, state: f.state, events });
  return { result, events, claims: claims.claims };
}
function fixture(name) {
  const caster = { classId: 'cleric', level: 3, cantripIds: CANTRIPS, preparedSpellIds: SPELLS,
    resources: { slot1: 4, slot2: 3 }, resourceMaximums: { slot1: 4, slot2: 3 },
    characterBuild: { classId: 'cleric', raceId: 'human', cantrips: CANTRIPS, prepared: SPELLS } };
  const f = createAuthoredProbeFixture(name, { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '280', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: caster } });
  f.events = [];
  f.acts = 0;
  const participants = [ACTOR, PEER];
  act(f, { kind: 'startEncounter', proposalAttemptId: `proposal:${name}:encounter`,
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: participants, dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: participants.map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] });
  return f;
}
const spell = (f, spellId, level) => Object.values(f.state.combatRuntime.definitions)
  .find((definition) => definition.sourceSpellId === spellId && definition.activation.spellLevel === String(level)).definitionId;
const cast = (f, spellId, level, parameters, faces) => act(f, { kind: 'invokeAbility', sourceEntityId: ACTOR,
  abilityRef: spell(f, spellId, level), parameters }, faces);
const endTurn = (f, id, faces) => act(f, { kind: 'endTurn', encounterId: ENCOUNTER, sourceEntityId: id }, faces);
const summaries = (claims) => claims.flatMap((claim) => claim.summary === undefined ? [] : [claim.summary]).join('\n');

test('the roots of condition, repeated-save and concentration spells are told in full from claims', () => {
  const f = fixture('claims-hold');
  const held = cast(f, 'hold-person', 2, { targetEntityId: PEER });
  assert.match(summaries(held.claims), /麻痹效果已生效/u);
  endTurn(f, ACTOR);
  const saved = endTurn(f, PEER, { 'save:repeat:': 20 });
  assert.match(summaries(saved.claims), /回合结束时再次豁免，成功了/u);
  assert.match(summaries(saved.claims), /麻痹效果已经结束/u);
});

test('the roots of modifier, bonus-die, zone and summon spells are told in full from claims', () => {
  const f = fixture('claims-effects');
  const blessed = cast(f, 'bless', 1, { targetEntityIds: [ACTOR, PEER] });
  assert.match(summaries(blessed.claims), /攻击检定、豁免检定 \+1d4/u);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 7 });
  cast(f, 'spiritual', 2, { targetEntityId: PEER }, { 'attack:': 15 });
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const strike = act(f, { kind: 'invokeAbility', sourceEntityId: ACTOR, abilityRef: `${spell(f, 'spiritual', 2)}:strike`,
    parameters: { targetEntityId: PEER } }, { 'attack:': 15 });
  assert.ok(strike.events.some((event) => event.eventType === 'EffectZoneMoved'));
  const fog = cast(f, 'fog', 1, { areaOrigin: { x: '280', y: '100', elevation: '0' } });
  assert.match(summaries(fog.claims), /半径 20 尺的浓雾（重度遮蔽）已经形成/u);
  const cleared = act(f, { kind: 'endConcentration', sourceEntityId: ACTOR });
  assert.match(summaries(cleared.claims), /那片浓雾（重度遮蔽）已经消失/u);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  cast(f, 'guiding-bolt', 1, { targetEntityId: PEER }, { 'attack:': 15 });
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const used = cast(f, 'fire-bolt', 0, { targetEntityId: PEER }, { 'attack:': 15 });
  assert.match(summaries(used.claims), /下一次针对它的攻击具有优势」效果已经结束/u);
  endTurn(f, ACTOR);
  endTurn(f, PEER);
  const aided = cast(f, 'aid', 2, { targetEntityIds: [ACTOR] });
  assert.match(summaries(aided.claims), /生命值上限与当前生命值 \+5/u);
});

test('the roots of a weapon-hit rider, turn-start damage and breaking free are told in full from claims', () => {
  const ranger = { classId: 'ranger', level: 3, cantripIds: [], preparedSpellIds: ['ensnaring'],
    resources: { slot1: 3 }, resourceMaximums: { slot1: 3 },
    characterBuild: { classId: 'ranger', raceId: 'human', cantrips: [], prepared: ['ensnaring'] },
    loadout: { equipped: { main: 'dagger' }, backpack: [], armorClass: 10, speedFeet: 30 } };
  const f = createAuthoredProbeFixture('claims-rider', { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '160', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: ranger } });
  f.events = [];
  f.acts = 0;
  act(f, { kind: 'startEncounter', proposalAttemptId: 'proposal:claims-rider:encounter',
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: [ACTOR, PEER], dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: [ACTOR, PEER].map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] });
  const ensnared = act(f, { kind: 'invokeAbility', sourceEntityId: ACTOR,
    abilityRef: Object.values(f.state.combatRuntime.definitions).find((definition) => definition.sourceSpellId === 'ensnaring').definitionId,
    parameters: { targetEntityId: ACTOR } });
  assert.match(summaries(ensnared.claims), /下一次武器命中时让对方进行豁免/u);
  const dagger = Object.values(f.state.combatRuntime.definitions).find((definition) => definition.weaponUse?.slot === 'main'
    && definition.weaponUse?.mode === 'melee' && !definition.weaponUse?.bonusAttack).definitionId;
  const caught = act(f, { kind: 'invokeAbility', sourceEntityId: ACTOR, abilityRef: dagger, parameters: { targetEntityId: PEER } },
    { 'attack:': 15, 'save:rider:': 2 });
  assert.match(summaries(caught.claims), /束缚效果已生效/u);
  const hurt = endTurn(f, ACTOR);
  assert.ok(hurt.events.some((event) => event.eventType === 'DamagePacketResolved'));
  const freed = act(f, { kind: 'invokeAbility', sourceEntityId: PEER, abilityRef: 'action:break-free',
    parameters: { targetEntityId: PEER } }, { 'check:break-free:': 15 });
  assert.match(summaries(freed.claims), /挣开了束缚/u);
});

test('the roots of a command and the commanded turn Rules carries out are told in full from claims', () => {
  const cleric = { classId: 'cleric', level: 3, cantripIds: [], preparedSpellIds: ['command'],
    resources: { slot1: 4 }, resourceMaximums: { slot1: 4 },
    characterBuild: { classId: 'cleric', raceId: 'human', cantrips: [], prepared: ['command'] } };
  const f = createAuthoredProbeFixture('claims-command', { spawnPoints: [{ x: '100', y: '100', elevation: '0' }, { x: '280', y: '100', elevation: '0' }],
    characterOverrides: { [ACTOR]: cleric } });
  f.events = [];
  f.acts = 0;
  act(f, { kind: 'startEncounter', proposalAttemptId: 'proposal:claims-command:encounter',
    encounterId: ENCOUNTER, sceneId: SCENE, participantEntityIds: [ACTOR, PEER], dynamicEntities: [], battlefieldFactIds: [],
    initiativeGroups: [ACTOR, PEER].map((id) => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [PEER] }, { fromEntityIds: [PEER], toEntityIds: [ACTOR] }] });
  const commanded = cast(f, 'command', 1, { targetEntityId: PEER, command: 'approach' });
  assert.match(summaries(commanded.claims), /下个回合服从命令「靠近」/u);
  const obeyed = endTurn(f, ACTOR);
  assert.match(summaries(obeyed.claims), /服从命令「靠近」/u);
  assert.ok(obeyed.events.filter((event) => event.eventType === 'TurnEnded').length === 2);
});
