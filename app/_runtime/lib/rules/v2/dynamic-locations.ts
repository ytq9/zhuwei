import { dynamicLocationSceneRef, dynamicLocationContentConform, dynamicPassageConform, passageFactRef, passageTraversalBindingConform, type PassageTraversalBinding } from "./dynamic-location-shapes";
export * from "./dynamic-location-shapes";
import type { AuthoritativeWorldState, JsonRecord, EventPayloadByType } from "./model";
import type { StoredSemanticDefinition } from "./semantic-definitions";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { canonicalSha256 } from "../profiles/canonical";

export function resolvePassageTraversal(state: AuthoritativeWorldState, actorId: string, passageRef: string): PassageTraversalBinding | undefined {
  const actor = state.entities[actorId], definition = state.campaignRuntime.definitions[passageRef];
  if (actor?.tenureStatus !== "active" || definition?.semanticKind !== "passage" || !record(definition.content)
    || !dynamicPassageConform(definition.content.passage) || definition.content.observableState !== "open"
    || typeof definition.definitionHash !== "string"
    || !spatialRecordVisibleTo(state, { id: passageRef, visibilityPolicyId: definition.visibilityPolicyRef,
      ...(definition.content.visibilityFactId === undefined ? {} : { visibilityFactId: definition.content.visibilityFactId }) }, actorId)) return undefined;
  const passage = definition.content.passage;
  const from = locationSceneRef(state, passage.fromLocationRef), to = locationSceneRef(state, passage.toLocationRef);
  if (from === undefined || to === undefined || from === to) return undefined;
  const destination = from === actor.sceneId ? to : passage.bidirectional && to === actor.sceneId ? from : undefined;
  return destination === undefined ? undefined : { passageRef, passageHash: definition.definitionHash,
    sourceSceneRef: actor.sceneId, destinationSceneRef: destination, travelDurationMicros: passage.travelDurationMicros };
}

export function passageTraversalMatches(state: AuthoritativeWorldState, actorIds: readonly string[], binding: PassageTraversalBinding): boolean {
  return actorIds.length > 0 && actorIds.every(actorId => {
    const current = resolvePassageTraversal(state, actorId, binding.passageRef);
    return current !== undefined && canonicalSha256(current) === canonicalSha256(binding);
  });
}

export function isDynamicLocationScene(state: AuthoritativeWorldState, sceneRef: string): boolean {
  return Object.values(state.campaignRuntime.definitions).some(definition => definition.semanticKind === "location"
    && record(definition.content) && definition.content.sceneRef === sceneRef);
}

export function passageActivityPayload(state: AuthoritativeWorldState, actorId: string, activityId: string,
  passage: PassageTraversalBinding): EventPayloadByType["ActivityStarted"] {
  const definition = state.campaignRuntime.definitions[passage.passageRef];
  const fact = state.canonicalFacts[passageFactRef(passage.passageRef)];
  if (!passageTraversalMatches(state, [actorId], passage) || !record(definition?.content)
    || !dynamicPassageConform(definition.content.passage)
    || !record(fact?.value) || fact.value.passageRef !== passage.passageRef) throw new TypeError("passage:activity-basis-unavailable");
  return { activityId, characterId: actorId, activityKind: "passageTraversal", intendedDurationMicros: passage.travelDurationMicros,
    completion: { method: definition.content.passage.traversal, primaryFactRef: passageFactRef(passage.passageRef),
      sourceSceneId: passage.sourceSceneRef, success: [{ kind: "moveEntity", entityRef: actorId,
        sceneRef: passage.destinationSceneRef, passage }], failure: [] } };
}

export function passageActivityBinding(value: unknown): PassageTraversalBinding | undefined {
  if (!record(value) || value.activityKind !== "passageTraversal" || !record(value.completion)
    || !Array.isArray(value.completion.success) || value.completion.success.length !== 1) return undefined;
  const effect = value.completion.success[0];
  return record(effect) && effect.kind === "moveEntity" && passageTraversalBindingConform(effect.passage) ? effect.passage : undefined;
}

/** An endpoint names either an existing scene or a typed location definition.
 * The latter keeps a bundle producer's authority hash distinct from scene geometry. */
export function locationSceneRef(state: AuthoritativeWorldState, locationRef: string): string | undefined {
  if (state.scenes[locationRef] !== undefined) return locationRef;
  const definition = state.campaignRuntime.definitions[locationRef];
  return definition?.semanticKind === "location" && record(definition.content)
    && definition.content.sceneRef === dynamicLocationSceneRef(locationRef)
    && state.scenes[definition.content.sceneRef] !== undefined ? definition.content.sceneRef : undefined;
}

/** Reused by Rules preflight and event application. A creation scope is never
 * interpreted as the new location's physical position or Viewer permission. */
export function dynamicMaterializationIssue(state: AuthoritativeWorldState, actorId: string,
  semanticKind: string, content: Readonly<JsonRecord>, basisRefs: readonly string[], readRefs: readonly string[]): string | undefined {
  if (semanticKind !== "location" && semanticKind !== "passage") return undefined;
  const sceneRef = state.entities[actorId]?.sceneId;
  const scopeRef = semanticKind === "location" ? content.scopeRef : content.sceneRef;
  if (sceneRef === undefined || scopeRef !== sceneRef || !basisRefs.includes(sceneRef) || !readRefs.includes(sceneRef)
    || !basisRefs.some(ref => ref.startsWith("profile-context:") && readRefs.includes(ref))) return "location:current-frozen-scope-required";
  if (semanticKind === "location") return dynamicLocationContentConform(content) ? undefined : "location:geometry-required";
  if (!dynamicPassageConform(content.passage) || !["open", "closed", "blocked"].includes(String(content.observableState))) return "passage:canonical-state-required";
  const endpoints = [content.passage.fromLocationRef, content.passage.toLocationRef];
  const scenes = endpoints.map(ref => locationSceneRef(state, ref));
  if (scenes.some(scene => scene === undefined) || scenes[0] === scenes[1]
    || endpoints.some(ref => !readRefs.includes(ref))) return "passage:authorized-endpoints-required";
  if (!scenes.includes(sceneRef) && !endpoints.some(ref => {
    const definition = state.campaignRuntime.definitions[ref];
    return definition?.semanticKind === "location" && record(definition.content) && definition.content.scopeRef === sceneRef;
  })) return "passage:connection-outside-creation-scope";
  return undefined;
}

export function applyDynamicLocation(state: AuthoritativeWorldState, definition: StoredSemanticDefinition): void {
  if (definition.semanticKind !== "location") return;
  const sceneRef = dynamicLocationSceneRef(definition.definitionId);
  if (!dynamicLocationContentConform(definition.content) || definition.content.sceneRef !== sceneRef
    || state.scenes[sceneRef] !== undefined || state.combatRuntime.scenes[sceneRef] !== undefined) throw new TypeError("location:identity-or-geometry-conflict");
  state.scenes[sceneRef] = { id: sceneRef, name: String(definition.content.label) };
  state.combatRuntime.scenes[sceneRef] = { sceneId: sceneRef, geometry: structuredClone(definition.content.geometry) };
}

export function dynamicDefinitionInScene(state: AuthoritativeWorldState, definition: StoredSemanticDefinition, sceneRef: string): boolean {
  if (definition.semanticKind === "location") return definition.content.sceneRef === sceneRef;
  if (definition.semanticKind !== "passage" || !dynamicPassageConform(definition.content.passage)) return false;
  return [definition.content.passage.fromLocationRef, definition.content.passage.toLocationRef]
    .some(ref => locationSceneRef(state, ref) === sceneRef);
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
