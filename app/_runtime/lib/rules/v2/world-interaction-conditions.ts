import { coverLevel, entitiesWithinRange, rectangularFeatureEntity } from '../profiles/combat-geometry';
import { conditionActionPermission, conditionAbilityCheck, conditionAttack, conditionMechanics, conditionSourceRefs } from './condition-mechanics';
import { currentTacticalFeature } from './environment';
import { hazardMechanics, registeredHazardTargets } from './world-interaction-hazards';
import { worldInteractionAbilityAuthority } from './world-interaction-mechanics';
import type { AuthoritativeWorldState, FrozenCheck, JsonRecord } from './model';
import type { WorldInteractionResolutionPlan } from './world-interaction-model';
import { rejected } from './results';
import { isRecord, isNonEmptyString } from './validation';

const HARMFUL_CONDITIONS = new Set(['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated',
  'paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious']);

export function worldInteractionConditionPermission(state: AuthoritativeWorldState, plan: WorldInteractionResolutionPlan) {
  const targets = new Set(plan.directTargetRefs.filter(ref => state.entities[ref] !== undefined));
  let harmful = plan.ruling.kind === 'check' && plan.ruling.resolutionKind === 'attack';
  for (const branch of [plan.branches.success, plan.branches.failure]) for (const effect of branch.effects) {
    if (effect.kind !== 'registeredHazard') continue;
    const mechanics = hazardMechanics(state, effect);
    const danger = effect.damage.kind !== 'authored'
      || (Array.isArray(mechanics?.definition.damage) && mechanics.definition.damage.length > 0)
      || mechanics?.effects.some(value => value.kind === 'grantEffect' && HARMFUL_CONDITIONS.has(String(value.condition)));
    if (!danger) continue;
    harmful = true;
    const hazardTargets = registeredHazardTargets(state, plan.sceneRef, effect);
    if (hazardTargets === undefined) return rejected('missingPrerequisite', 'The harmful interaction lacks its authoritative affected targets.');
    hazardTargets.forEach(({ targetRef }) => targets.add(targetRef));
  }
  const permission = conditionActionPermission(state, plan.actorCharacterId, { kind: plan.social ? 'speech' : 'action', harmful,
    attack: plan.ruling.kind === 'check' && plan.ruling.resolutionKind === 'attack', targetEntityIds: [...targets] });
  return permission.allowed ? undefined : rejected('missingPrerequisite',
    permission.requiredContext.length > 0 ? `Condition context is required: ${permission.requiredContext.join(', ')}.`
      : `The actor cannot perform this interaction: ${permission.reasons.join(', ')}.`);
}

function fearSourcesInSight(state: AuthoritativeWorldState, actorId: string): string[] | undefined {
  const refs = conditionSourceRefs(state, actorId, 'frightened');
  if (refs.length === 0) return [];
  const source = state.combatRuntime.entities[actorId];
  if (source === undefined || !isRecord(source.position) || !isRecord(source.footprint)) return undefined;
  if (!conditionMechanics(state, actorId).canSee) return [];
  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  if (!isRecord(scene?.geometry)) return undefined;
  const result: string[] = [];
  for (const ref of refs) {
    const target = state.combatRuntime.entities[ref]
      ?? (() => { const feature = currentTacticalFeature(state, actorId, ref);
        return feature === undefined ? undefined : rectangularFeatureEntity(feature, String(source.sceneId)); })();
    if (target === undefined) return undefined;
    if (target.sceneId !== source.sceneId) continue;
    if (!isRecord(target.position) || !isRecord(target.footprint)) return undefined;
    if (conditionMechanics(state, ref).conditions.invisible === true) continue;
    if (coverLevel(scene, source, target, []) !== 'full') result.push(ref);
  }
  return result;
}

export function worldInteractionEffectiveCheck(state: AuthoritativeWorldState, plan: WorldInteractionResolutionPlan):
  { kind: 'accepted'; check: FrozenCheck | null } | ReturnType<typeof rejected> {
  if (plan.ruling.kind !== 'check') return { kind: 'accepted', check: null };
  const base = plan.ruling.check;
  const context = { advantageReasons: base.mode === 'advantage' ? ['declaredCheckAdvantage'] : [],
    disadvantageReasons: base.mode === 'disadvantage' ? ['declaredCheckDisadvantage'] : [],
    visibleFearSourceRefs: fearSourcesInSight(state, plan.actorCharacterId) };
  let roll;
  if (plan.ruling.resolutionKind === 'attack') {
    if (plan.abilityRef === null) return rejected('missingPrerequisite', 'An interaction attack requires an Ability.');
    const resolved = worldInteractionAbilityAuthority({ state, actorCharacterId: plan.actorCharacterId, sceneRef: plan.sceneRef,
      abilityRef: plan.abilityRef, directTargetRefs: plan.directTargetRefs });
    if (resolved.kind === 'rejected') return rejected(resolved.code, resolved.message);
    const source = state.combatRuntime.entities[plan.actorCharacterId];
    const targetRef = resolved.authority.tacticalFeatureRefs[0];
    const feature = currentTacticalFeature(state, plan.actorCharacterId, targetRef);
    const target: JsonRecord | undefined = feature === undefined ? undefined : rectangularFeatureEntity(feature, plan.sceneRef);
    if (source === undefined || target === undefined || !isRecord(source.position) || !isRecord(source.footprint))
      return rejected('missingPrerequisite', 'The attack lacks authoritative source and target geometry.');
    roll = conditionAttack(state, plan.actorCharacterId, targetRef, { ...context,
      disadvantageReasons: [...context.disadvantageReasons, ...resolved.authority.checkDisadvantageReasons],
      withinFiveFeet: entitiesWithinRange(source, target, '60') });
    if (!roll.allowed) return rejected('missingPrerequisite',
      `The attack is unavailable: ${[...roll.reasons, ...roll.requiredContext].join(', ')}.`);
  } else {
    roll = conditionAbilityCheck(state, plan.actorCharacterId, { ...context,
      ...(plan.social ? { socialTargetId: plan.social.npcRef } : {}) });
  }
  if (roll.requiredContext.length > 0) return rejected('missingPrerequisite', `Condition context is required: ${roll.requiredContext.join(', ')}.`);
  return { kind: 'accepted', check: { ...base, mode: roll.mode } };
}
