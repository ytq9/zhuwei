import type { AuthoredSourceSchema } from "./authored-materialization";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
import type { RuntimeProfileManifest } from "../profiles/types";
import { authorityReadSetMatches, authoritySpatialRefVisibleTo, characterTimelineAuthorityRef } from "./authority-bindings";
import { activeEncounter, stepCombatWorld, targetsCreature } from "./combat-actions";
import { stepCampaignWorld } from "./campaign-actions";
import { continueCompoundRoot } from "./internal-compound";
import type { AuthoritativeWorldState, JsonRecord, StepResult } from "./model";
import { rejected } from "./results";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";

export const ABILITY_OPERATION_PLAN_SCHEMA = "zhuwei.ability-operation-plan/vnext-1" as const;
export const ABILITY_OPERATION_FORM_ID = "combat.vnext-1" as const;
type Point = Readonly<{ x: string; y: string; elevation: string }>;
export type AbilityOperation = Readonly<
  | { kind: "invoke"; abilityRef: string; castingMode: "normal" | "ritual"; target:
      | { kind: "none" }
      | { kind: "creatures"; refs: readonly string[] }
      | { kind: "area"; origin: Point }
      | { kind: "directionalArea"; origin: Point; direction: Point } }
  | { kind: "continue" | "cancel"; activityRef: string }
>;
export type AbilityOperationPlan = Readonly<{
  schema: typeof ABILITY_OPERATION_PLAN_SCHEMA; contextHash: string;
  readSet: readonly VersionedAuthorityBinding[]; operation: AbilityOperation;
}>;

type OperationSchema = AuthoredSourceSchema & { minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; uniqueItems?: boolean };
const object = (properties: Record<string, OperationSchema>) => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false as const });
const ref = { type: "string", minLength: 1, maxLength: 512 };
const point = object(Object.fromEntries(["x", "y", "elevation"].map(key =>
  [key, { type: "string", pattern: "^-?(0|[1-9][0-9]*)$" }])));
export const ABILITY_OPERATION_SOURCE_SCHEMA = { anyOf: [
  object({ kind: { type: "string", enum: ["invoke"] }, abilityRef: ref,
    castingMode: { type: "string", enum: ["normal", "ritual"] }, target: { anyOf: [
      object({ kind: { type: "string", enum: ["none"] } }),
      object({ kind: { type: "string", enum: ["creatures"] }, refs: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: ref } }),
      object({ kind: { type: "string", enum: ["area"] }, origin: point }),
      object({ kind: { type: "string", enum: ["directionalArea"] }, origin: point, direction: point }),
    ] } }),
  object({ kind: { type: "string", enum: ["continue", "cancel"] }, activityRef: ref }),
] } as const;

export function isAbilityOperation(value: unknown): value is AbilityOperation {
  if (!isRecord(value)) return false;
  if (value.kind === "continue" || value.kind === "cancel") return hasExactKeys(value, ["kind", "activityRef"])
    && isNonEmptyString(value.activityRef);
  if (value.kind !== "invoke" || !hasExactKeys(value, ["kind", "abilityRef", "castingMode", "target"])
    || !isNonEmptyString(value.abilityRef) || !["normal", "ritual"].includes(String(value.castingMode)) || !isRecord(value.target)) return false;
  const target = value.target;
  if (target.kind === "none") return hasExactKeys(target, ["kind"]);
  if (target.kind === "creatures") return hasExactKeys(target, ["kind", "refs"]) && Array.isArray(target.refs)
    && target.refs.length > 0 && target.refs.length <= 64 && target.refs.every(isNonEmptyString)
    && new Set(target.refs).size === target.refs.length;
  const pointValid = (point: unknown) => isRecord(point) && hasExactKeys(point, ["x", "y", "elevation"])
    && Object.values(point).every(value => typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)));
  return (target.kind === "area" && hasExactKeys(target, ["kind", "origin"]) && pointValid(target.origin))
    || (target.kind === "directionalArea" && hasExactKeys(target, ["kind", "origin", "direction"])
      && pointValid(target.origin) && pointValid(target.direction));
}

export function isAbilityOperationPlan(value: unknown): value is AbilityOperationPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "operation"])
    && value.schema === ABILITY_OPERATION_PLAN_SCHEMA && isSha256(value.contextHash)
    && isCanonicalReadSet(value.readSet) && isAbilityOperation(value.operation);
}

/** Selection and lifecycle bindings contain no caller-authored mechanics. */
export function abilityOperationReadRefs(state: AuthoritativeWorldState, actorId: string, operation: AbilityOperation): readonly string[] | undefined {
  const actor = state.entities[actorId], combat = state.combatRuntime.entities[actorId];
  if (actor?.tenureStatus !== "active" || combat === undefined || state.scenes[actor.sceneId] === undefined) return undefined;
  const refs = [actorId, actor.sceneId, characterTimelineAuthorityRef(actorId), `ability-catalog:${actorId}`];
  if (operation.kind === "invoke") {
    if (!Array.isArray(combat.abilityRefs) || !combat.abilityRefs.includes(operation.abilityRef)) return undefined;
    if (operation.target.kind === "creatures") {
      if (operation.target.refs.some(ref => !authoritySpatialRefVisibleTo(state, ref, actor.sceneId, actorId))) return undefined;
      refs.push(...operation.target.refs);
    } else if (operation.target.kind === "area" || operation.target.kind === "directionalArea") {
      // Rules derives affected creatures from geometry, including unseen ones.
      // Bind the candidate scene occupants without asking KP to enumerate or
      // disclose them; a missing authority entry fails context selection.
      refs.push(...Object.keys(state.combatRuntime.entities).filter(ref => state.entities[ref]?.sceneId === actor.sceneId));
    }
  } else {
    const activity = state.campaignRuntime.activities[operation.activityRef], concentration = combat.concentration;
    if (activity?.status !== "active" || activity.activityKind !== "longSpellcasting" || activity.characterId !== actorId
      || !isRecord(activity.completion) || activity.completion.sourceEntityId !== actorId
      || !isRecord(concentration) || concentration.kind !== "longSpellcasting" || concentration.activityId !== operation.activityRef) return undefined;
    refs.push(`continuity:activities:${operation.activityRef}`);
  }
  return [...new Set(refs)].sort();
}

/** Preserve the existing interruptActivity preflight exception through its
 * frozen atomic wrapper. Full plan, authority and cost validation still runs. */
export function isFrozenAbilityCancellation(state: AuthoritativeWorldState, input: JsonRecord): boolean {
  if (input.kind !== "applyAtomicWorldInteractionSteps" || !isNonEmptyString(input.actorCharacterId)
    || input.sharedRuling !== "directSuccess" || input.executionCosts !== undefined
    || !Array.isArray(input.steps) || input.steps.length !== 1) return false;
  const step = input.steps[0];
  if (!isRecord(step) || !isRecord(step.rulesInput) || step.rulesInput.kind !== "performAbilityOperation"
    || step.rulesInput.actorCharacterId !== input.actorCharacterId || !isAbilityOperationPlan(step.rulesInput.plan)
    || step.rulesInput.plan.operation.kind !== "cancel") return false;
  return abilityOperationReadRefs(state, input.actorCharacterId, step.rulesInput.plan.operation) !== undefined;
}

/** Authority binding only. The existing combat/campaign executor owns every
 * legal target, action, cost, duration, effect, random request and event. */
export function stepAbilityOperation(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord,
  options: Readonly<{ continuedRoot?: true }> = {}): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"])
    || input.kind !== "performAbilityOperation" || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId) || !isAbilityOperationPlan(input.plan)) return rejected("invalidRulesInput", "The frozen Ability operation is not canonical.");
  const { operation, readSet } = input.plan, actorId = input.actorCharacterId;
  const refs = abilityOperationReadRefs(state, actorId, operation);
  if (refs === undefined) return rejected("privateOrUnknownReference", "The selected Ability or casting Activity is unavailable to this actor.");
  if (!refs.every(ref => readSet.some(binding => binding.ref === ref)) || !authorityReadSetMatches(state, readSet))
    return rejected("causalFrontierConflict", "The frozen Ability operation dependencies changed.");
  let command: JsonRecord;
  if (operation.kind === "invoke") {
    const definition = state.combatRuntime.definitions[operation.abilityRef];
    if (!isRegisteredAbilityRecord(definition)) return rejected("unsupportedOperation", "The selected Ability has no valid registered compiled artifact.");
    const activation = definition.activation, target = definition.target;
    if (!isRecord(activation)) return rejected("unsupportedOperation", "The selected Ability activation is unavailable.");
    if (operation.castingMode === "ritual" && (activation.kind !== "actionSpell" || activation.ritual !== true))
      return rejected("invalidRulesInput", "The registered Ability does not permit ritual casting.");
    const targetKind = isRecord(target) ? target.kind : "none";
    if (targetsCreature(definition) !== (operation.target.kind === "creatures")
      || (targetKind === "area") !== ["area", "directionalArea"].includes(operation.target.kind))
      return rejected("invalidRulesInput", "The selected target representation must match the registered Ability; required targets cannot be inferred.");
    const parameters: JsonRecord = operation.target.kind === "creatures" ? { targetEntityIds: [...operation.target.refs] }
      : operation.target.kind === "area" ? { areaOrigin: { ...operation.target.origin } }
      : operation.target.kind === "directionalArea" ? { areaOrigin: { ...operation.target.origin }, areaDirection: { ...operation.target.direction } } : {};
    if (operation.castingMode === "ritual") parameters.ritual = true;
    command = { kind: "invokeAbility", rootActionId: input.rootActionId, sourceEntityId: actorId, abilityRef: operation.abilityRef, parameters };
  } else if (operation.kind === "continue") {
    const encounter = activeEncounter(state, actorId);
    if (encounter === undefined) return rejected("invalidRulesInput", "Noncombat casting progresses through its existing due Activity; continuation invests a combat action only.");
    command = { kind: "continueLongSpellcasting", rootActionId: input.rootActionId, sourceEntityId: actorId,
      encounterId: encounter.encounterId, activityId: operation.activityRef };
  } else {
    command = { kind: "interruptActivity", proposalId: input.rootActionId, activityId: operation.activityRef, cause: { kind: "voluntary" } };
  }
  if (options.continuedRoot) command = continueCompoundRoot(command, input.rootActionId);
  return operation.kind === "cancel" ? stepCampaignWorld(profiles, state, command)!
    : stepCombatWorld(profiles, state, command)!;
}
