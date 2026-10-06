import { LOCKABLE_OBJECT_STATES, OBJECT_OPERATIONS, objectTransitionPath,
  type ObjectOperation, type ObjectStateGraph } from "../profiles/object-state";
import { authoritySpatialRefVisibleTo } from "./authority-bindings";
import { currentTacticalFeature, featureMechanicsCompletionPlan, stateWithCompletedFeature } from "./environment";
import type { AuthoritativeWorldState, EventPayloadByType, JsonRecord } from "./model";
import { activeEncounter } from "./combat-encounters";
import { nextTo } from "./scene-approach";
import { rectangularFeatureEntity } from "../profiles/combat-geometry";

type Rejected = { kind: "rejected"; code: "privateOrUnknownReference" | "causalFrontierConflict" | "invalidRulesInput" | "missingPrerequisite" | "worldLawViolation";
  reason: string; fromState?: string; intents?: readonly ObjectOperation[] };
const unavailable = (): Rejected => ({ kind: "rejected", code: "privateOrUnknownReference", reason: "object:unavailable" });

/** SPEC 0014 §2.3: the existing object's graph owns operations, regardless
 * of its label or geometry kind. Visibility and identity stay authoritative. */
export function objectMechanismTarget(state: AuthoritativeWorldState, actorId: string, ref: string) {
  const actor = state.entities[actorId];
  if (actor?.tenureStatus !== "active" || !authoritySpatialRefVisibleTo(state, ref, actor.sceneId, actorId)) return undefined;
  const feature = currentTacticalFeature(state, actorId, ref);
  return feature ? { feature, state: feature.state, graph: feature.stateGraph as ObjectStateGraph | undefined, approachRef: ref } : undefined;
}

export type ObjectCompletion = { kind: "accepted"; payload: EventPayloadByType["EnvironmentFeatureCompleted"] } | Rejected;
export function objectCompletionPlan(state: AuthoritativeWorldState, actorId: string, ref: string,
  initialState: string, armorClass: string | null, hitPoints: string | null, opensPassage: boolean): ObjectCompletion {
  const target = objectMechanismTarget(state, actorId, ref);
  if (!target) return unavailable();
  if (target.graph) return { kind: "rejected", code: "causalFrontierConflict", reason: "object:already-complete" };
  if (!(LOCKABLE_OBJECT_STATES as readonly string[]).includes(initialState)) return { kind: "rejected", code: "invalidRulesInput", reason: "object:initial-state-invalid" };
  if (armorClass === null || hitPoints === null) return { kind: "rejected", code: "invalidRulesInput", reason: "object:map-durability-required" };
  return featureMechanicsCompletionPlan(state, actorId, ref, initialState, armorClass, hitPoints, opensPassage);
}

export function stateWithCompletedObject(state: AuthoritativeWorldState, completion: Exclude<ObjectCompletion, Rejected>): AuthoritativeWorldState {
  return stateWithCompletedFeature(state, completion.payload);
}

export type ObjectOperationPlan = { kind: "accepted"; payloads: EventPayloadByType["EnvironmentFeatureStateChanged"][];
  fromState: string; toState: string; approachRef: string } | Rejected;

/** An explicit KP ruling may compose unlock + open. Plain map interaction
 * remains a single declared transition and cannot bypass a lock. */
export function objectOperationPlan(state: AuthoritativeWorldState, actorId: string, ref: string,
  operation: ObjectOperation, ruled = false, requireReach = false): ObjectOperationPlan {
  const target = objectMechanismTarget(state, actorId, ref);
  if (!target) return unavailable();
  if (!target.graph) return { kind: "rejected", code: "missingPrerequisite", reason: "object:incomplete" };
  if (activeEncounter(state, actorId)) return { kind: "rejected", code: "missingPrerequisite", reason: "object:combat-action-required" };
  if (requireReach) {
    const actor = state.combatRuntime.entities[actorId];
    const other = rectangularFeatureEntity(target.feature as unknown as JsonRecord, state.entities[actorId].sceneId);
    if (!actor || !other || !nextTo(actor, other)) return { kind: "rejected", code: "missingPrerequisite", reason: "object:out-of-reach" };
  }
  const path = objectTransitionPath(target.graph, target.state, operation, ruled);
  if (!path?.length) return { kind: "rejected", code: "worldLawViolation", reason: "object:transition-unavailable", fromState: target.state,
    intents: OBJECT_OPERATIONS.filter(intent => objectTransitionPath(target.graph!, target.state, intent, ruled) !== undefined) };
  return { kind: "accepted", fromState: target.state, toState: path.at(-1)!.toState, approachRef: target.approachRef,
    payloads: path.map(transition => ({ actorCharacterId: actorId, sceneId: state.entities[actorId].sceneId,
      featureId: ref, definitionId: target.graph!.definitionId, ...transition, intent: transition.intent as ObjectOperation })) };
}
