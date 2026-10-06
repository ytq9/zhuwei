import { RulesValidationError } from "../errors";
import { lockableObjectGraph, LOCKABLE_OBJECT_STATES, OBJECT_OPERATIONS, objectTransitionPath,
  type LockableObjectState, type ObjectOperation, type ObjectStateGraph } from "../profiles/object-state";
import { authoritySpatialRefVisibleTo } from "./authority-bindings";
import { currentTacticalFeature, featureMechanicsCompletionPlan, stateWithCompletedFeature } from "./environment";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, JsonRecord } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";
import { activeEncounter } from "./combat-encounters";
import { nextTo } from "./scene-approach";
import { rectangularFeatureEntity } from "../profiles/combat-geometry";

type Rejected = { kind: "rejected"; code: "privateOrUnknownReference" | "causalFrontierConflict" | "invalidRulesInput" | "missingPrerequisite" | "worldLawViolation";
  reason: string; fromState?: string; intents?: readonly ObjectOperation[] };
const unavailable = (): Rejected => ({ kind: "rejected", code: "privateOrUnknownReference", reason: "object:unavailable" });

/** Native storage stays with the object. A map feature owns geometry; an
 * ItemEntry owns its mechanism across transfer, equipment and recovery. */
export function objectMechanismTarget(state: AuthoritativeWorldState, actorId: string, ref: string) {
  const actor = state.entities[actorId];
  if (actor?.tenureStatus !== "active" || !authoritySpatialRefVisibleTo(state, ref, actor.sceneId, actorId)) return undefined;
  const feature = currentTacticalFeature(state, actorId, ref);
  if (feature) return { storage: "feature" as const, feature, state: feature.state,
    graph: feature.stateGraph as ObjectStateGraph | undefined, approachRef: ref };
  const item = state.campaignRuntime.itemSystem.entries[ref];
  const definition = item && state.campaignRuntime.itemSystem.definitions[item.definitionRef];
  if (!item || !definition || definition.content.stackable || item.quantity !== 1
    || !["held", "scene"].includes(item.disposition) || item.assemblyRef !== undefined) return undefined;
  return { storage: "item" as const, item, state: item.stateMachine?.state,
    graph: item.stateMachine ? lockableObjectGraph(ref) : undefined,
    approachRef: item.holderRef && item.holderRef !== actorId ? item.holderRef : null };
}

export type ObjectCompletion = { kind: "accepted"; storage: "feature"; payload: EventPayloadByType["EnvironmentFeatureCompleted"] }
  | { kind: "accepted"; storage: "item"; payload: EventPayloadByType["ItemMechanismCompleted"] } | Rejected;
export function objectCompletionPlan(state: AuthoritativeWorldState, actorId: string, ref: string,
  initialState: string, armorClass: string | null, hitPoints: string | null, opensPassage: boolean): ObjectCompletion {
  const target = objectMechanismTarget(state, actorId, ref);
  if (!target) return unavailable();
  if (target.graph || (target.storage === "item" && target.item.stateMachine === null)) return { kind: "rejected", code: "causalFrontierConflict", reason: "object:already-complete" };
  if (!(LOCKABLE_OBJECT_STATES as readonly string[]).includes(initialState) && !(target.storage === "item" && initialState === "none")) return { kind: "rejected", code: "invalidRulesInput", reason: "object:initial-state-invalid" };
  if (target.storage === "feature") {
    if (armorClass === null || hitPoints === null) return { kind: "rejected", code: "invalidRulesInput", reason: "object:map-durability-required" };
    const planned = featureMechanicsCompletionPlan(state, actorId, ref, initialState, armorClass, hitPoints, opensPassage);
    return planned.kind === "accepted" ? { kind: "accepted", storage: "feature", payload: planned.payload } : planned;
  }
  if (opensPassage || armorClass !== null || hitPoints !== null) return { kind: "rejected", code: "invalidRulesInput", reason: "object:item-keeps-its-existing-durability-and-placement" };
  return { kind: "accepted", storage: "item", payload: { actorCharacterId: actorId, sceneId: state.entities[actorId].sceneId,
    entryRef: ref, state: initialState as LockableObjectState } };
}

export function stateWithCompletedObject(state: AuthoritativeWorldState, completion: Exclude<ObjectCompletion, Rejected>): AuthoritativeWorldState {
  if (completion.storage === "feature") return stateWithCompletedFeature(state, completion.payload);
  const { entryRef, state: initialState } = completion.payload;
  return { ...state, campaignRuntime: { ...state.campaignRuntime, itemSystem: { ...state.campaignRuntime.itemSystem,
    entries: { ...state.campaignRuntime.itemSystem.entries, [entryRef]: { ...state.campaignRuntime.itemSystem.entries[entryRef],
      stateMachine: initialState === "none" ? null : { schema: "zhuwei.lockable-object-state/v1", state: initialState } } } } } };
}

export type ObjectOperationPlan = { kind: "accepted"; storage: "feature";
  payloads: EventPayloadByType["EnvironmentFeatureStateChanged"][]; fromState: string; toState: string; approachRef: string | null }
  | { kind: "accepted"; storage: "item"; payloads: EventPayloadByType["ItemStateTransitioned"][];
    fromState: string; toState: string; approachRef: string | null } | Rejected;

export function objectOperationPlan(state: AuthoritativeWorldState, actorId: string, ref: string,
  operation: ObjectOperation, ruled = false, requireReach = false): ObjectOperationPlan {
  const target = objectMechanismTarget(state, actorId, ref);
  if (!target) return unavailable();
  if (target.storage === "item" && target.item.condition !== "usable") return { kind: "rejected", code: "worldLawViolation", reason: "object:broken" };
  if (target.storage === "item" && target.item.stateMachine === null) return { kind: "rejected", code: "worldLawViolation", reason: "object:no-state-mechanism" };
  if (!target.graph || target.state === undefined) return { kind: "rejected", code: "missingPrerequisite", reason: "object:incomplete" };
  if (activeEncounter(state, actorId)) return { kind: "rejected", code: "missingPrerequisite", reason: "object:combat-action-required" };
  if (requireReach && target.approachRef) {
    const actor = state.combatRuntime.entities[actorId];
    const other = target.storage === "feature" ? rectangularFeatureEntity(target.feature as unknown as JsonRecord, state.entities[actorId].sceneId)
      : state.combatRuntime.entities[target.approachRef];
    if (!actor || !other || !nextTo(actor, other)) return { kind: "rejected", code: "missingPrerequisite", reason: "object:out-of-reach" };
  }
  const path = objectTransitionPath(target.graph, target.state, operation, ruled);
  if (!path?.length) return { kind: "rejected", code: "worldLawViolation", reason: "object:transition-unavailable", fromState: target.state,
    intents: OBJECT_OPERATIONS.filter(intent => objectTransitionPath(target.graph!, target.state!, intent, ruled) !== undefined) };
  const actorCharacterId = actorId, sceneId = state.entities[actorId].sceneId, fromState = target.state, toState = path.at(-1)!.toState;
  const common = { kind: "accepted" as const, fromState, toState, approachRef: target.approachRef };
  return target.storage === "feature" ? { ...common, storage: "feature", payloads: path.map(transition => ({ actorCharacterId, sceneId,
    featureId: ref, definitionId: target.graph!.definitionId, ...transition, intent: transition.intent as ObjectOperation })) }
    : { ...common, storage: "item", payloads: path.map(transition => ({ actorCharacterId, sceneId, entryRef: ref,
      intent: transition.intent as ObjectOperation, fromState: transition.fromState as LockableObjectState, toState: transition.toState as LockableObjectState })) };
}

export function itemMechanismPayload(eventType: string, value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["actorCharacterId", "sceneId", "entryRef",
    ...(eventType === "ItemMechanismCompleted" ? ["state"] : ["fromState", "toState", "intent"])])
    || ![value.actorCharacterId, value.sceneId, value.entryRef].every(isNonEmptyString)) return false;
  return eventType === "ItemMechanismCompleted" ? (value.state === "none" || (LOCKABLE_OBJECT_STATES as readonly unknown[]).includes(value.state))
    : (LOCKABLE_OBJECT_STATES as readonly unknown[]).includes(value.fromState) && (LOCKABLE_OBJECT_STATES as readonly unknown[]).includes(value.toState)
      && (OBJECT_OPERATIONS as readonly unknown[]).includes(value.intent);
}

/** SPEC 0014 §2.3: replay validates the same graph, never accepts a raw
 * item-state patch or a transition from a different prior state. */
export function applyItemMechanismEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "ItemMechanismCompleted" && event.eventType !== "ItemStateTransitioned") return false;
  const p = event.payload as JsonRecord;
  if (!itemMechanismPayload(event.eventType, p) || event.visibilityPolicyId !== "visibility:room-authority-only" || event.secrecy !== "internal"
    || state.entities[String(p.actorCharacterId)]?.sceneId !== p.sceneId) throw new RulesValidationError("object:invalid-item-event");
  const target = objectMechanismTarget(state, String(p.actorCharacterId), String(p.entryRef));
  if (target?.storage !== "item") throw new RulesValidationError("object:item-unavailable");
  if (event.eventType === "ItemMechanismCompleted") {
    if (target.item.stateMachine !== undefined) throw new RulesValidationError("object:already-complete");
    target.item.stateMachine = p.state === "none" ? null : { schema: "zhuwei.lockable-object-state/v1", state: p.state as LockableObjectState };
  } else {
    const path = target.graph && typeof target.state === "string" && target.state === p.fromState ? objectTransitionPath(target.graph, target.state, p.intent as ObjectOperation, false) : undefined;
    if (path?.length !== 1 || path[0].toState !== p.toState) throw new RulesValidationError("object:invalid-item-transition");
    target.item.stateMachine = { schema: "zhuwei.lockable-object-state/v1", state: p.toState as LockableObjectState };
  }
  return true;
}
