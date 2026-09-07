import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { effectiveConditions, isWorldEffectRecord, type ConditionId } from "./world-effects";
import { isNonEmptyString, isRecord } from "./validation";
import { movementApproachesEntity, pathLengthMilliInches } from "../profiles/combat-geometry";

/** SRD 5.1, Appendix PH-A, pp. 358–359 (2014 conditions). These are
 * read-only consequences. The action/event owner commits HP, death, dropped
 * items, concentration ending, and source-specific EffectEnded separately. */
export type ConditionRollMode = "normal" | "advantage" | "disadvantage";
export type ConditionRoll = {
  mode: ConditionRollMode;
  advantageReasons: string[];
  disadvantageReasons: string[];
  automaticFailure: boolean;
  requiredContext: string[];
};
type RollContext = {
  advantageReasons?: readonly string[];
  disadvantageReasons?: readonly string[];
  /** Complete authoritative set of fear sources within line of sight.
   * Omission means unresolved; [] explicitly means none are in sight. */
  visibleFearSourceRefs?: readonly string[];
};
export type ConditionPermission = {
  allowed: boolean;
  reasons: string[];
  requiredContext: string[];
};
export const SRD_DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning",
  "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"] as const;

function distinct(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function active(conditions: JsonRecord, name: string): boolean { return conditions[name] === true; }

/** Source identity remains on effect records, never guessed from prose. */
export function conditionSourceRefs(
  state: AuthoritativeWorldState, entityId: string, condition: ConditionId,
): string[] {
  const native = state.combatRuntime.entities[entityId]?.conditions;
  const sources = Object.values(state.combatRuntime.effects)
    .filter((effect) => isWorldEffectRecord(effect)
      && effect.targetEntityId === entityId && effect.condition === condition)
    .map((effect) => String(effect.sourceRef));
  const nativeSource = isRecord(native) ? native[`${condition}By`] : undefined;
  if (isNonEmptyString(nativeSource)) sources.push(nativeSource);
  else if (Array.isArray(nativeSource)) sources.push(...nativeSource.filter(isNonEmptyString));
  return distinct(sources);
}

export function conditionMechanics(state: AuthoritativeWorldState, entityId: string) {
  const conditions = effectiveConditions(state, entityId);
  const exhaustion = Number(conditions.exhaustion ?? 0);
  if (!Number.isSafeInteger(exhaustion) || exhaustion < 0 || exhaustion > 6) {
    throw new TypeError("Exhaustion must be a canonical 2014 level from zero through six.");
  }
  const has = (name: string) => active(conditions, name);
  const dead = state.combatRuntime.entities[entityId]?.lifeState === "dead"
    || state.entities[entityId]?.tenureStatus === "dead" || exhaustion >= 6;
  const incapacitated = dead || ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"].some(has);
  const cannotMove = dead || ["paralyzed", "petrified", "stunned", "unconscious"].some(has);
  const grappled = has("grappled") || isNonEmptyString(conditions.grappledBy);
  const speedIsZero = exhaustion >= 5 || grappled || has("restrained");
  const petrified = has("petrified");
  return {
    conditions, exhaustion, dead, incapacitated, petrified,
    canAct: !incapacitated, canReact: !incapacitated,
    canMove: !cannotMove && !speedIsZero,
    canSpeak: !dead && !["paralyzed", "petrified", "unconscious"].some(has),
    speechFaltering: has("stunned"),
    unawareOfSurroundings: dead || petrified || has("unconscious"),
    canSee: !dead && !petrified && !has("unconscious") && !has("blinded"),
    canHear: !dead && !petrified && !has("unconscious") && !has("deafened"),
    speedIsZero, speedHalved: exhaustion >= 2,
    hitPointMaximumHalved: exhaustion >= 4,
    cannotBenefitFromSpeedBonus: grappled || has("restrained"),
    mustCrawl: has("prone"),
    weightMultiplier: petrified ? 10 : 1,
    agingSuspended: petrified,
    poisonAndDiseaseSuspended: petrified,
    conditionImmunities: petrified ? ["poisoned" as const] : [],
    diseaseImmune: petrified,
    dropHeldObjects: has("unconscious"),
    concentrationMustEnd: incapacitated,
    charmerRefs: conditionSourceRefs(state, entityId, "charmed"),
    fearSourceRefs: conditionSourceRefs(state, entityId, "frightened"),
  };
}

function rollResult(
  advantageReasons: string[], disadvantageReasons: string[], automaticFailure = false,
  requiredContext: string[] = [],
): ConditionRoll {
  const advantage = distinct(advantageReasons);
  const disadvantage = distinct(disadvantageReasons);
  return {
    mode: (advantage.length > 0) === (disadvantage.length > 0)
      ? "normal" : advantage.length > 0 ? "advantage" : "disadvantage",
    advantageReasons: advantage, disadvantageReasons: disadvantage,
    automaticFailure, requiredContext: distinct(requiredContext),
  };
}

function fearDisadvantage(
  facts: ReturnType<typeof conditionMechanics>, context: RollContext,
  reasons: string[], missing: string[],
): void {
  if (!active(facts.conditions, "frightened")) return;
  if (facts.fearSourceRefs.length === 0) { missing.push("frightened:source"); return; }
  if (context.visibleFearSourceRefs === undefined) {
    missing.push(...facts.fearSourceRefs.map((ref) => `lineOfSight:${ref}`));
  } else if (facts.fearSourceRefs.some((ref) => context.visibleFearSourceRefs!.includes(ref))) {
    reasons.push("frightenedSourceInSight2014");
  }
}

export function conditionAbilityCheck(
  state: AuthoritativeWorldState, actorId: string,
  context: RollContext & { requiresSight?: boolean; requiresHearing?: boolean; socialTargetId?: string } = {},
): ConditionRoll {
  const facts = conditionMechanics(state, actorId);
  const advantage = [...(context.advantageReasons ?? [])];
  const disadvantage = [...(context.disadvantageReasons ?? [])];
  const missing: string[] = [];
  if (facts.exhaustion >= 1) disadvantage.push("exhaustionAbilityCheck2014");
  if (active(facts.conditions, "poisoned") && !facts.poisonAndDiseaseSuspended) disadvantage.push("poisoned2014");
  fearDisadvantage(facts, context, disadvantage, missing);
  if (context.socialTargetId !== undefined) {
    const target = conditionMechanics(state, context.socialTargetId);
    if (active(target.conditions, "charmed") && target.charmerRefs.length === 0) missing.push("charmed:source");
    if (target.charmerRefs.includes(actorId)) advantage.push("charmerSocialCheck2014");
  }
  return rollResult(advantage, disadvantage,
    (context.requiresSight === true && !facts.canSee)
      || (context.requiresHearing === true && !facts.canHear), missing);
}

export function conditionSavingThrow(
  state: AuthoritativeWorldState, targetId: string, ability: string,
  context: Pick<RollContext, "advantageReasons" | "disadvantageReasons"> = {},
): ConditionRoll {
  const facts = conditionMechanics(state, targetId);
  const disadvantage = [...(context.disadvantageReasons ?? [])];
  if (facts.exhaustion >= 3) disadvantage.push("exhaustionSavingThrow2014");
  if (ability === "dex" && ["restrained", "squeezing"].some((name) => active(facts.conditions, name))) {
    disadvantage.push("restrainedOrSqueezingDexSave2014");
  }
  const automaticFailure = ["str", "dex"].includes(ability)
    && ["paralyzed", "petrified", "stunned", "unconscious"].some((name) => active(facts.conditions, name));
  return rollResult([...(context.advantageReasons ?? [])], disadvantage, automaticFailure);
}

export function conditionAttack(
  state: AuthoritativeWorldState, actorId: string, targetId: string,
  context: RollContext & { withinFiveFeet: boolean },
): ConditionRoll & ConditionPermission & { criticalIfHit: boolean } {
  const source = conditionMechanics(state, actorId);
  const target = conditionMechanics(state, targetId);
  const advantage = [...(context.advantageReasons ?? [])];
  const disadvantage = [...(context.disadvantageReasons ?? [])];
  const missing: string[] = [];
  if (["blinded", "paralyzed", "petrified", "restrained", "stunned", "unconscious", "squeezing"]
    .some((name) => active(target.conditions, name))) advantage.push("targetCondition2014");
  if (["blinded", "restrained", "prone", "squeezing"].some((name) => active(source.conditions, name))) {
    disadvantage.push("sourceCondition2014");
  }
  if (active(source.conditions, "poisoned") && !source.poisonAndDiseaseSuspended) disadvantage.push("poisoned2014");
  if (active(target.conditions, "prone")) (context.withinFiveFeet ? advantage : disadvantage).push("targetProne2014");
  if (active(source.conditions, "invisible")) advantage.push("sourceInvisible2014");
  if (active(target.conditions, "invisible")) disadvantage.push("targetInvisible2014");
  if (source.exhaustion >= 3) disadvantage.push("exhaustionAttack2014");
  fearDisadvantage(source, context, disadvantage, missing);
  const permission = conditionActionPermission(state, actorId, { kind: "action", attack: true, targetEntityIds: [targetId] });
  const roll = rollResult(advantage, disadvantage, false, [...missing, ...permission.requiredContext]);
  return { ...roll, allowed: permission.allowed && roll.requiredContext.length === 0,
    reasons: permission.reasons,
    criticalIfHit: context.withinFiveFeet && ["paralyzed", "unconscious"].some((name) => active(target.conditions, name)) };
}

export function conditionActionPermission(
  state: AuthoritativeWorldState, actorId: string, input: {
    kind: "action" | "bonusAction" | "reaction" | "movement" | "speech";
    targetEntityIds?: readonly string[];
    attack?: boolean; harmful?: boolean; voluntary?: boolean;
    /** Authoritative Geometry result for the whole piecewise-linear path. */
    fearSourceApproaches?: Readonly<Record<string, boolean>>;
  },
): ConditionPermission {
  const facts = conditionMechanics(state, actorId);
  const reasons: string[] = [];
  const missing: string[] = [];
  if (["action", "bonusAction", "reaction"].includes(input.kind) && facts.incapacitated) reasons.push("incapacitated2014");
  if (input.kind === "speech" && !facts.canSpeak) reasons.push("cannotSpeak2014");
  if (input.kind === "movement" && input.voluntary !== false) {
    if (!facts.canMove) reasons.push("cannotMove2014");
    if (active(facts.conditions, "frightened")) {
      if (facts.fearSourceRefs.length === 0) missing.push("frightened:source");
      for (const sourceRef of facts.fearSourceRefs) {
        const approaches = input.fearSourceApproaches?.[sourceRef];
        if (approaches === undefined) missing.push(`movementDistance:${sourceRef}`);
        else if (approaches) reasons.push("frightenedCannotApproach2014");
      }
    }
  }
  if ((input.attack === true || input.harmful === true) && active(facts.conditions, "charmed")) {
    if (facts.charmerRefs.length === 0) missing.push("charmed:source");
    if (input.targetEntityIds === undefined) missing.push("harmfulAction:targets");
    else if (facts.charmerRefs.some((ref) => input.targetEntityIds!.includes(ref))) reasons.push("charmedCannotHarmCharmer2014");
  }
  return { allowed: reasons.length === 0 && missing.length === 0,
    reasons: distinct(reasons), requiredContext: distinct(missing) };
}

/** Shared by movement planning and event validation. Every linear segment
 * is checked continuously, including paths whose equal endpoints conceal an
 * approach to the fear source in the middle. Forced motion is unrestricted. */
export function conditionMovementPermission(
  state: AuthoritativeWorldState, entityId: string, path: unknown, voluntary = true,
): ConditionPermission {
  const actor = state.combatRuntime.entities[entityId];
  const approaches: Record<string, boolean> = {};
  if (voluntary && actor !== undefined) for (const ref of conditionSourceRefs(state, entityId, "frightened")) {
    const source = state.combatRuntime.entities[ref];
    if (source === undefined || !isRecord(source.position) || !isRecord(source.footprint)) continue;
    if (source.sceneId !== actor.sceneId) continue;
    approaches[ref] = movementApproachesEntity(actor, source, path);
  }
  return conditionActionPermission(state, entityId, { kind: "movement", voluntary, fearSourceApproaches: approaches });
}

export function conditionSpeed(state: AuthoritativeWorldState, entityId: string, unconditionedSpeed: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(unconditionedSpeed)) throw new TypeError("Speed must be a canonical non-negative integer.");
  const facts = conditionMechanics(state, entityId);
  return { speed: facts.speedIsZero ? "0"
    : (BigInt(unconditionedSpeed) / (facts.speedHalved ? 2n : 1n)).toString(),
  canMove: facts.canMove, canBenefitFromSpeedBonus: !facts.cannotBenefitFromSpeedBonus,
  mustCrawl: facts.mustCrawl };
}

export function conditionMovementCost(
  state: AuthoritativeWorldState, entityId: string,
  movementCostMilliInches: string, path: Parameters<typeof pathLengthMilliInches>[0],
): string {
  return (BigInt(movementCostMilliInches)
    + (conditionMechanics(state, entityId).mustCrawl ? BigInt(pathLengthMilliInches(path)) : 0n)).toString();
}

export function conditionHitPointLimits(
  state: AuthoritativeWorldState, entityId: string, unconditionedMaximum: number, current: number,
) {
  if (!Number.isSafeInteger(unconditionedMaximum) || unconditionedMaximum < 1
    || !Number.isSafeInteger(current) || current < 0) throw new TypeError("HP inputs must be canonical non-negative integers.");
  const facts = conditionMechanics(state, entityId);
  const maximum = facts.hitPointMaximumHalved ? Math.floor(unconditionedMaximum / 2) : unconditionedMaximum;
  return { maximum, current: Math.min(current, maximum), diesFromExhaustion: facts.exhaustion >= 6 };
}

/** Resistance never stacks. Resistance and vulnerability can coexist and
 * apply in that order after other modifiers; an enum cannot express both. */
export function conditionDamageDefense(state: AuthoritativeWorldState, entityId: string, damageType: string) {
  const facts = conditionMechanics(state, entityId);
  const base = state.combatRuntime.entities[entityId]?.damageDefenses;
  const contains = (key: string) => isRecord(base) && Array.isArray(base[key]) && base[key].includes(damageType);
  return { immune: contains("immune") || (facts.petrified && damageType === "poison"),
    resistant: contains("resistant") || facts.petrified,
    vulnerable: contains("vulnerable") };
}

export function applyConditionDamageDefense(
  amount: number, defense: ReturnType<typeof conditionDamageDefense>,
): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError("Damage must be a canonical non-negative integer.");
  if (defense.immune) return 0;
  return (defense.resistant ? Math.floor(amount / 2) : amount) * (defense.vulnerable ? 2 : 1);
}
