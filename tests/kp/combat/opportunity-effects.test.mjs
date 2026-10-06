// SPEC 0012 §§7.2, 9, 11: an opportunity attack keeps the chosen NPC
// attack's on-hit effects and effect save, with one reaction and replay.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as PEER } from '../../../tools/lib/vnext-authored-probe-fixture.mjs';
import { lowerVNext2ProposalBundle } from '../../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts';
import { parseSubmitKpProposalBundleCandidateArguments } from '../../../app/_runtime/lib/kp/vnext/proposal-provider.ts';
import { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE as bridge, vnext2CommandToRoomLowering }
  from '../../../app/_runtime/lib/kp/vnext/room-bridge.ts';

const GUARD = 'npc:probe-guard';

for (const sample of [
  { label: 'failed poison save', condition: 'poisoned', attack: 15, save: 1, affected: true, moves: true },
  { label: 'successful poison save', condition: 'poisoned', attack: 15, save: 20, affected: false, moves: true },
  { label: 'missed poison attack', condition: 'poisoned', attack: 1, save: 1, affected: false, moves: true },
  { label: 'failed paralysis save', condition: 'paralyzed', attack: 15, save: 1, affected: true, moves: false },
]) test(`NPC opportunity effect: ${sample.label}`, () => {
  const f = createAuthoredProbeFixture('review-opportunity-effects', {
    npcCharacters: [{ id: GUARD, name: '守卫', mechanical: false,
      abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 11, cha: 10 },
      proficiencyBonus: 2, loadout: { armorClass: 12, speedFeet: 30, equipped: {}, backpack: [] } }],
  });
  f.events = [];
  f.requiredContext = freezeAuthoredProbeContext(f, f.state, {
    rootActionId: f.rootActionId, focusRefs: [ACTOR, GUARD, PEER],
    intentText: '我拔出长剑，冲向守卫并挥剑攻击他。',
  }).context;
  const asked = [];

  function apply(input) {
    const result = f.runtime.step(f.profiles, f.state, input);
    if (result.events?.length) {
      f.events.push(...result.events);
      const replayed = f.runtime.replay(f.genesis, f.events);
      assert.equal(replayed.kind, 'replayed', JSON.stringify(replayed).slice(0, 2000));
      assert.deepEqual(replayed.state, result.state);
      f.state = replayed.state;
    }
    return result;
  }

  function settle(result) {
    while (result.kind === 'awaitingRandomness') {
      if (result.randomnessRequests === undefined) {
        // The vNext opening plan wraps its native initiative requests.
        const rolls = result.randomnessRequest.hazardRolls.flatMap(spec =>
          spec.dice.flatMap(die => Array(Number(die.count)).fill(10)));
        result = apply({ kind: 'fulfillAuthoritativeRandomness', continuation: result.continuation, rolls });
        continue;
      }
      asked.push(...result.randomnessRequests.map(request => structuredClone(request)));
      result = apply({
        kind: 'authoritativeRandomness', resolutionId: result.resolutionId,
        responseId: `authority:${result.resolutionId}`, continuationCapability: result.continuationCapability,
        randomnessResults: result.randomnessRequests.map(request => ({
          randomnessId: request.randomnessId, requestHash: request.requestHash,
          draws: request.dice.map(term => ({ sides: Number(term.sides),
            faces: Array(Number(term.count)).fill(Math.min(Number(term.sides),
              request.purposeKey.startsWith('initiative:') ? 10 : request.purposeKey.startsWith('attack:') ? sample.attack
                : request.purposeKey.startsWith('save:') ? sample.save : 1)),
          })),
        })),
      });
    }
    return result;
  }

  const wire = { decision: { kind: 'startCombat',
    participants: [{ creatureRef: ACTOR, surprise: { kind: 'aware' } },
      { creatureRef: GUARD, surprise: { kind: 'aware' } }],
    hostilities: [{ fromRefs: [ACTOR], toRefs: [GUARD] }, { fromRefs: [GUARD], toRefs: [ACTOR] }],
    combatStatistics: [{ npcRef: GUARD,
      armorClass: f.state.entities[GUARD].loadout.armorClass,
      speedFeet: 30, hitPointsMaximum: 11, deathPolicy: 'deadAtZero',
      attacks: [{ kind: 'meleeAttack', label: '带毒牙', ability: 'str', reachFeet: 5,
        damage: '1d4', damageType: 'piercing', effects: [{ kind: 'grantEffect', condition: sample.condition,
          duration: { kind: 'turnBoundary', subject: 'target', edge: 'turnEnd' } }],
        effectSave: [{ ability: 'con', dc: 13 }] }],
    }],
    description: '守卫张开带毒的獠牙，逼住行动者。',
  } };
  const candidate = parseSubmitKpProposalBundleCandidateArguments(JSON.stringify(wire));
  assert.equal(candidate.kind, 'accepted', JSON.stringify(candidate));
  const lowered = lowerVNext2ProposalBundle({ value: candidate.bundle, rootActionId: f.rootActionId,
    actorCharacterId: ACTOR, profiles: f.profiles, requiredContext: f.requiredContext, state: f.state });
  assert.equal(lowered.kind, 'accepted', JSON.stringify(lowered).slice(0, 2000));
  const room = vnext2CommandToRoomLowering(lowered.command);
  assert.equal(room.kind, 'accepted');
  assert.equal(bridge.validateReadSet({ profiles: f.profiles, state: f.state,
    requiredContext: f.requiredContext, rulesInput: room.input }).kind, 'valid');
  assert.equal(settle(apply(room.input)).kind, 'committed');
  const encounterId = Object.keys(f.state.combatRuntime.encounters)[0];
  assert.equal(f.state.combatRuntime.encounters[encounterId].activeEntityId, GUARD);
  assert.equal(settle(apply({ kind: 'endTurn', rootActionId: 'review:guard-end',
    encounterId, sourceEntityId: GUARD })).kind, 'committed');
  assert.equal(f.state.combatRuntime.encounters[encounterId].activeEntityId, ACTOR);

  const destination = { x: '300', y: '40', elevation: '0' };
  const offered = apply({ kind: 'moveCombatant', rootActionId: 'review:leave-poisonous-reach',
    encounterId, sourceEntityId: ACTOR, movementMode: 'walk',
    path: [f.state.combatRuntime.entities[ACTOR].position,
      { x: '100', y: '40', elevation: '0' }, destination],
  });
  assert.equal(offered.kind, 'awaitingInput', JSON.stringify(offered).slice(0, 2000));
  assert.equal(offered.pending.controllerEntityId, GUARD);
  const stoppedAt = structuredClone(f.state.combatRuntime.entities[ACTOR].position);
  const beforeHp = Number(f.state.combatRuntime.entities[ACTOR].hitPoints.current);
  const beforeTurn = structuredClone(f.state.combatRuntime.entities[GUARD].turn);
  const beforeEvents = f.events.length;
  asked.length = 0;
  const done = settle(apply({ kind: 'answerPendingInput', pendingInputId: offered.pending.pendingInputId,
    responseId: 'review:accept-poisonous-opportunity',
    answer: { kind: 'useReaction', abilityRef: 'action:opportunity-attack', targetEntityId: ACTOR },
  }));
  assert.equal(done.kind, 'committed', JSON.stringify(done).slice(0, 2000));
  const effects = Object.values(f.state.combatRuntime.effects)
    .filter(effect => effect.condition === sample.condition && effect.targetEntityId === ACTOR);
  assert.equal(Number(f.state.combatRuntime.entities[ACTOR].hitPoints.current),
    beforeHp - (sample.attack === 1 ? 0 : 1), 'an effect save never cancels the weapon damage');
  assert.equal(f.state.combatRuntime.entities[GUARD].turn.reaction, '0');
  assert.equal(f.state.combatRuntime.entities[GUARD].turn.action, beforeTurn.action);
  assert.equal(f.events.slice(beforeEvents).filter(event => event.eventType === 'ReactionAnswered').length, 1);
  assert.ok(asked.some(request => request.purposeKey.startsWith('save:')
    && request.frozenParameters.ability === 'con'), 'the chosen attack must request its CON effect save');
  assert.equal(effects.length, sample.affected ? 1 : 0, 'only a hit with a failed save grants the effect once');
  assert.deepEqual(f.state.combatRuntime.entities[ACTOR].position, sample.moves ? destination : stoppedAt,
    'the movement continuation respects the actual on-hit condition');
});
