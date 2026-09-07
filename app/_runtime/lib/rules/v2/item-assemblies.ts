import { activeEncounter } from "./combat-actions";
import { canonicalSha256 } from "../profiles/canonical";
import { isItemSystemStateV1, itemStackIdentity, type ItemEntryV1, type ItemSystemStateV1 } from "./items";
import { conditionActionPermission } from "./condition-mechanics";
import { isItemAssemblyOperation, assemblyOperationRefs, type ItemAssemblyOperation, type ItemAssemblyRecord } from "./item-assembly-shapes";
import type { AuthoritativeWorldState } from "./model";
import { isRecord, isNonEmptyString, isSha256, hasExactKeys } from "./validation";

export type ItemAssemblyChangedPayload = Readonly<{ actorCharacterId: string; operation: ItemAssemblyOperation;
  contextHash: string; sourceHashBefore: string; itemSystemHashAfter: string; assemblyRef: string; summary: string }>;
export function isItemAssemblyChangedPayload(value: unknown): value is ItemAssemblyChangedPayload {
  return isRecord(value) && hasExactKeys(value, ["actorCharacterId", "operation", "contextHash", "sourceHashBefore", "itemSystemHashAfter", "assemblyRef", "summary"])
    && [value.actorCharacterId, value.assemblyRef, value.summary].every(isNonEmptyString)
    && [value.contextHash, value.sourceHashBefore, value.itemSystemHashAfter].every(isSha256) && isItemAssemblyOperation(value.operation);
}
export function assemblySourceHash(state: AuthoritativeWorldState, operation: ItemAssemblyOperation): string {
  const system = state.campaignRuntime.itemSystem;
  const assembly = operation.kind === "disassemble" ? system.assemblies?.[operation.assemblyRef] : undefined;
  const refs = assembly?.components.map(component => component.entryRef) ?? assemblyOperationRefs(operation);
  return canonicalSha256({ assembly: assembly ?? null, entries: refs.map(ref => ({ ref, entry: system.entries[ref] ?? null })) });
}
/** All addressed inputs to ordinary component handling. The same closure is
 * selected by the KP lowering seam and checked by Rules before execution. */
export function itemAssemblyReadRefs(state: AuthoritativeWorldState, actorRef: string, operation: ItemAssemblyOperation): string[] {
  const system = state.campaignRuntime.itemSystem;
  const assembly = operation.kind === "disassemble" ? system.assemblies?.[operation.assemblyRef] : undefined;
  const componentRefs = operation.kind === "assemble" ? operation.components.map(c => c.entryRef)
    : assembly?.components.map(c => c.entryRef) ?? [];
  return [...new Set([actorRef, state.entities[actorRef]?.sceneId,
    ...(operation.kind === "disassemble" ? [operation.assemblyRef] : []), ...componentRefs,
    ...componentRefs.map(ref => system.entries[ref]?.definitionRef),
  ].filter((ref): ref is string => typeof ref === "string"))].sort();
}
export type ItemAssemblyTransition = Readonly<{ itemSystem: ItemSystemStateV1; assemblyRef: string; affectedHolderRefs: readonly string[] }>;
/** One deterministic inventory transition used by both Rules planning and replay.
 * Inputs choose original entries, amounts and recovery. No material/physics model
 * or newly authored ItemDefinition/Ability participates in ordinary assembly. */
export function planItemAssemblyTransition(state: AuthoritativeWorldState, actorRef: string,
  operation: ItemAssemblyOperation, rootActionId: string): ItemAssemblyTransition | { error: string } {
  const actor = state.entities[actorRef], system = state.campaignRuntime.itemSystem;
  if (!actor || actor.tenureStatus !== "active" || !actor.loadout || !state.scenes[actor.sceneId]
    || !isItemAssemblyOperation(operation) || !isItemSystemStateV1(system)) return { error: "assemblyReferenceUnavailable" };
  if (activeEncounter(state, actor.id) !== undefined) return { error: "assemblyRequiresCombatAdjudication" };
  if (!conditionActionPermission(state, actor.id, { kind: "action" }).allowed) return { error: "assemblyActorCannotAct" };
  if (Object.values(state.campaignRuntime.activities).some(activity => activity.status === "active" && activity.characterId === actor.id)) return { error: "assemblyActorBusy" };
  const next = structuredClone(system);
  next.assemblies ??= {};
  let assemblyRef: string;
  if (operation.kind === "assemble") {
    assemblyRef = `assembly:${canonicalSha256({ rootActionId, actorRef, operation }).slice(7, 39)}`;
    if (next.assemblies[assemblyRef]) return { error: "assemblyAlreadyExists" };
    const components: ItemAssemblyRecord["components"] = [];
    for (const [index, component] of operation.components.entries()) {
      const source = next.entries[component.entryRef];
      if (!source || source.disposition !== "held" || source.holderRef !== actorRef || source.assemblyRef !== undefined
        || source.condition !== "usable" || source.equippedSlot !== null) return { error: "assemblyComponentUnavailable" };
      if (component.quantity > source.quantity) return { error: "assemblyQuantityUnavailable" };
      const partial = component.quantity < source.quantity;
      const entryRef = partial ? `item-entry:assembly:${canonicalSha256({ assemblyRef, index, source: source.entryId }).slice(7, 39)}` : source.entryId;
      if (partial && next.entries[entryRef]) return { error: "assemblyComponentIdentityConflict" };
      const selected: ItemEntryV1 = { ...structuredClone(source), entryId: entryRef, quantity: component.quantity,
        disposition: "scene", holderRef: null, sceneRef: actor.sceneId, equippedSlot: null,
        visibilityPolicyRef: "visibility:scene-observers", assemblyRef };
      if (partial) source.quantity -= component.quantity;
      next.entries[entryRef] = selected;
      components.push({ entryRef, recoverable: component.recoverable });
    }
    next.assemblies[assemblyRef] = { schema: "zhuwei.item-assembly/v1", assemblyRef, creatorRef: actorRef,
      sceneRef: actor.sceneId, label: operation.label, description: operation.description, state: "active", components };
  } else {
    assemblyRef = operation.assemblyRef;
    const assembly = next.assemblies[assemblyRef];
    // Other holders require their own separately adjudicated acquisition.
    if (!assembly || assembly.state !== "active" || assembly.sceneRef !== actor.sceneId || assembly.creatorRef !== actorRef) return { error: "assemblyReferenceUnavailable" };
    for (const component of assembly.components) {
      const original = next.entries[component.entryRef];
      if (!original || original.assemblyRef !== assemblyRef || original.disposition !== "scene" || original.sceneRef !== assembly.sceneRef) return { error: "assemblyComponentChanged" };
      if (!component.recoverable) {
        delete original.assemblyRef;
        original.quantity = 0; original.disposition = "consumed"; original.sceneRef = null; original.holderRef = null;
        original.equippedSlot = null;
        continue;
      }
      const recovered = { ...original, disposition: "held" as const, holderRef: actorRef, sceneRef: null,
        visibilityPolicyRef: `visibility:character-controller:${actorRef}` };
      delete recovered.assemblyRef;
      // Use the ordinary complete homogeneous stack identity. Recovered
      // quantities merge only into an actual compatible original inventory.
      const target = Object.values(next.entries).find(entry => entry.entryId !== recovered.entryId
        && entry.assemblyRef === undefined && itemStackIdentity(entry) === itemStackIdentity(recovered));
      if (target && next.definitions[recovered.definitionRef].content.stackable) {
        if (target.quantity + recovered.quantity > 1_000_000) return { error: "assemblyRecoveryQuantityExceeded" };
        target.quantity += recovered.quantity; delete next.entries[original.entryId];
      } else next.entries[original.entryId] = recovered;
    }
    assembly.state = "disassembled";
  }
  if (!isItemSystemStateV1(next)) return { error: "assemblyWouldInvalidateInventory" };
  return { itemSystem: next, assemblyRef, affectedHolderRefs: [actorRef] };
}
