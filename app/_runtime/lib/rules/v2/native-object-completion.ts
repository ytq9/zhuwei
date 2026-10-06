import { RulesValidationError } from "../errors";
import { isAuthoredDefinitionMaterializationPlan, materializedAuthoredDefinition } from "./authored-materialization";
import { canonicalSha256, sameCanonical } from "../profiles/canonical";
import { compileAbilityDefinition, isRegisteredAbilityRecord, registeredAbilityRecord } from "../profiles/ability-compiler";
import type { RuntimeProfileManifest } from "../profiles/types";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { authorityGeometryFeatureComposite, authorityRevisionOrHash, authoritySpatialRefVisibleTo } from "./authority-bindings";
import { prepareNpcMechanicalCombatants } from "./combat-actions";
import { npcCombatant } from "./combat-start";
import { isNpcSpatialShell } from "./npc-mechanics";
import { createEventTransition } from "./events";
import { planPlayerAbilityCatalog } from "./character-abilities";
import { inventoryHolderLoadout } from "./inventory-operations";
import { npcItemSystemEquipmentMechanics } from "./npc-item-system";
import { compileItemEntryUseAbility, itemUseBaseAbilityDefinition } from "./items";
import { completedFeatureDefinition, completedItemDefinition } from "./object-definition-completion";
import { isNativeObjectCompletion, type NativeObjectCompletion } from "./object-completion-shapes";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, EventType, JsonRecord } from "./model";

type Draft = { eventType: EventType; payload: EventPayloadByType[EventType]; visibilityPolicyId?: string; secrecy?: EventEnvelope["secrecy"] };
type Planned = { kind: "accepted"; drafts: Draft[]; afterHash: `sha256:${string}`; preview: AuthoritativeWorldState } | { kind: "rejected"; reason: string };

/** Preview only a real prior authoring step, using the native compiler and
 * identity derivation. Atomic Rules still resolves and validates its handle. */
export function previewAuthoredCompletionAbility(state: AuthoritativeWorldState, rootActionId: string, plan: unknown) {
  if (!isAuthoredDefinitionMaterializationPlan(plan) || plan.source.kind !== "ability") return undefined;
  const result = materializedAuthoredDefinition(rootActionId, plan);
  if (!result?.artifact) return undefined;
  const registered = registeredAbilityRecord(result.artifact);
  return { handle: plan.handle, definitionRef: result.definitionRef, preview: { ...state,
    campaignRuntime: { ...state.campaignRuntime, definitions: { ...state.campaignRuntime.definitions, [result.definitionRef]: registered } },
    combatRuntime: { ...state.combatRuntime, definitions: { ...state.combatRuntime.definitions, [result.definitionRef]: registered } } } };
}

/** Resolve only native definition reference slots in a private preflight
 * copy. The submitted plan keeps its handles for typed dependency checking. */
export function bindNativeCompletionReferences(completion: NativeObjectCompletion, refs: ReadonlyMap<string, string>): NativeObjectCompletion {
  if (completion.kind !== "itemDefinition") return completion;
  const content = structuredClone(completion.content);
  content.equippedAbilityRefs = content.equippedAbilityRefs.map(ref => refs.get(ref) ?? ref).sort();
  if (content.use) content.use.abilityRef = refs.get(content.use.abilityRef) ?? content.use.abilityRef;
  const weapon = content.equipment?.weapon;
  if (weapon?.ammunitionDefinitionRef) weapon.ammunitionDefinitionRef = refs.get(weapon.ammunitionDefinitionRef) ?? weapon.ammunitionDefinitionRef;
  return { kind: "itemDefinition", content };
}

/** One preflight over native definitions. Its preview is a new value; only
 * the ordinary Rules event executor can make these changes authoritative. */
export function planNativeObjectCompletion(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  actorId: string, rootActionId: string, targetRef: string, completion: NativeObjectCompletion): Planned {
  const actor = state.entities[actorId];
  if (actor?.tenureStatus !== "active" || !isNativeObjectCompletion(completion)
    || !authoritySpatialRefVisibleTo(state, targetRef, actor.sceneId, actorId)) return { kind: "rejected", reason: "completion:visible-existing-object-required" };
  const drafts: Draft[] = [];
  if (completion.kind === "npcCombat") {
    const npc = state.entities[targetRef];
    if (npc?.kind !== "npc" || completion.statistics[0].npcRef !== targetRef || !isNpcSpatialShell(state.combatRuntime.entities[targetRef])
      || (npc.abilityScores ?? npc.socialMechanics?.abilityScores) === undefined
      || (npc.proficiencyBonus ?? npc.socialMechanics?.proficiencyBonus) === undefined) return { kind: "rejected", reason: "completion:npc-mechanics-not-undetermined" };
    const statistics = completion.statistics[0];
    if ((npc.loadout && (statistics.armorClass !== npc.loadout.armorClass || statistics.speedFeet !== npc.loadout.speedFeet))
      || (npc.hitPoints && statistics.hitPointsMaximum !== npc.hitPoints.maximum)
      || Object.keys(npc.resources ?? {}).some(ref => npc.resourceMaximums?.[ref] === undefined)) {
      return { kind: "rejected", reason: "completion:npc-established-mechanics" };
    }
    const prepared = prepareNpcMechanicalCombatants(profiles, state, [npcCombatant(state, rootActionId, completion.statistics[0])], actor.sceneId);
    if (!("drafts" in prepared)) return { kind: "rejected", reason: prepared.kind === "rejected" ? prepared.rejection.message : "completion:npc-preparation-failed" };
    drafts.push(...prepared.drafts);
  } else if (completion.kind === "itemDefinition") {
    const completed = completedItemDefinition(state, targetRef, completion.content);
    if ("error" in completed) return { kind: "rejected", reason: completed.error };
    const { definition, entry } = completed;
    const catalog = { ...state.combatRuntime.definitions };
    const register = (artifact: ReturnType<typeof compileItemEntryUseAbility>): boolean => {
      const ref = String(artifact.definition.definitionId), existing = catalog[ref];
      if (existing !== undefined) return isRegisteredAbilityRecord(existing) && existing.definitionHash === artifact.definitionHash;
      drafts.push({ eventType: "DefinitionRegistered", payload: artifact });
      catalog[ref] = registeredAbilityRecord(artifact);
      return true;
    };
    if (definition.content.equippedAbilityRefs.some(ref => !isRegisteredAbilityRecord(catalog[ref]))) return { kind: "rejected", reason: "completion:item-ability-unavailable" };
    if (definition.content.use !== null) {
      const base = itemUseBaseAbilityDefinition(definition, catalog);
      if (!base) return { kind: "rejected", reason: "completion:item-use-ability-unavailable" };
      if (!register(compileItemEntryUseAbility(definition, entry.entryId, base))) return { kind: "rejected", reason: "completion:item-use-definition-conflict" };
    }
    const system = { ...state.campaignRuntime.itemSystem, definitions: { ...state.campaignRuntime.itemSystem.definitions, [definition.definitionId]: definition },
      entries: { ...state.campaignRuntime.itemSystem.entries, [targetRef]: entry } };
    const holder = entry.holderRef === null ? undefined : state.entities[entry.holderRef];
    if (holder && (holder.kind === "player" || holder.loadout !== undefined)) {
      const derived = inventoryHolderLoadout(state, holder, system);
      if ("error" in derived) return { kind: "rejected", reason: derived.error };
      const character = { ...holder, loadout: derived.loadout };
      if (holder.kind === "player") {
        const planned = planPlayerAbilityCatalog({ character, itemSystem: system, catalog });
        if ("error" in planned) return { kind: "rejected", reason: planned.error };
        for (const artifact of planned.registrations) if (!register(artifact)) return { kind: "rejected", reason: "completion:item-equipment-definition-conflict" };
      } else {
        for (const source of npcItemSystemEquipmentMechanics(character, system, catalog).definitions) {
          const compiled = compileAbilityDefinition(source);
          if (!compiled.ok || !register(compiled.artifact)) return { kind: "rejected", reason: "completion:npc-equipment-definition-conflict" };
        }
      }
    }
    drafts.push({ eventType: "ItemDefinitionRegistered", payload: { definition } },
      { eventType: "ItemDefinitionCompleted", payload: { actorCharacterId: actorId,
        beforeHash: canonicalSha256(state.campaignRuntime.itemSystem.entries[targetRef]), definition, entry } });
  } else {
    const record = authorityGeometryFeatureComposite(state, targetRef);
    if (!record || record.sceneRef !== actor.sceneId) return { kind: "rejected", reason: "completion:feature-unavailable" };
    const feature = completedFeatureDefinition(state, actor.sceneId, targetRef, completion);
    if ("error" in feature) return { kind: "rejected", reason: feature.error };
    drafts.push({ eventType: "FeatureDefinitionCompleted", payload: { actorCharacterId: actorId, sceneId: actor.sceneId,
      beforeHash: canonicalSha256(record.feature), dimension: completion.kind, feature } });
  }
  try {
    let cursor = state;
    for (const draft of drafts) cursor = createEventTransition(cursor, profiles, { rootActionId, ...draft,
      visibilityPolicyId: draft.visibilityPolicyId ?? "visibility:room-authority-only", secrecy: draft.secrecy ?? "internal" }).state;
    const afterHash = authorityRevisionOrHash(cursor, targetRef);
    if (!afterHash || !isSha256(afterHash)) return { kind: "rejected", reason: "completion:result-identity-unavailable" };
    drafts.push({ eventType: "ObjectCompletionResolved", payload: { actorCharacterId: actorId, targetRef, afterHash } });
    return { kind: "accepted", drafts, afterHash, preview: { ...state, entities: cursor.entities,
      campaignRuntime: cursor.campaignRuntime, combatRuntime: cursor.combatRuntime } };
  } catch (error) {
    if (!(error instanceof RulesValidationError)) throw error;
    return { kind: "rejected", reason: `completion:${error.message}` };
  }
}

export function nativeObjectCompletionEventPayload(type: string, value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.actorCharacterId)) return false;
  if (type === "ObjectCompletionResolved") return hasExactKeys(value, ["actorCharacterId", "targetRef", "afterHash"])
    && isNonEmptyString(value.targetRef) && isSha256(value.afterHash);
  return type === "FeatureDefinitionCompleted" && hasExactKeys(value, ["actorCharacterId", "sceneId", "beforeHash", "dimension", "feature"])
    && isNonEmptyString(value.sceneId) && isSha256(value.beforeHash) && ["terrain", "durability"].includes(String(value.dimension))
    && isRecord(value.feature) && isNonEmptyString(value.feature.featureId);
}

export function applyNativeObjectCompletionEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "FeatureDefinitionCompleted" && event.eventType !== "ObjectCompletionResolved") return false;
  if (!nativeObjectCompletionEventPayload(event.eventType, event.payload) || event.visibilityPolicyId !== "visibility:room-authority-only" || event.secrecy !== "internal") throw new RulesValidationError("completion:event-invalid");
  if (event.eventType === "ObjectCompletionResolved") {
    const p = event.payload as EventPayloadByType["ObjectCompletionResolved"];
    if (authorityRevisionOrHash(state, p.targetRef) !== p.afterHash) throw new RulesValidationError("completion:result-hash-mismatch");
    return true;
  }
  const p = event.payload as EventPayloadByType["FeatureDefinitionCompleted"];
  const actor = state.entities[p.actorCharacterId], record = authorityGeometryFeatureComposite(state, p.feature.featureId);
  if (actor?.sceneId !== p.sceneId || !record || record.sceneRef !== p.sceneId || canonicalSha256(record.feature) !== p.beforeHash
    || !authoritySpatialRefVisibleTo(state, p.feature.featureId, p.sceneId, p.actorCharacterId)) throw new RulesValidationError("completion:feature-base-changed");
  let completion: NativeObjectCompletion;
  if (p.dimension === "terrain") completion = { kind: "terrain", landform: p.feature.landform ?? null, material: p.feature.material ?? null,
    depth: p.feature.depth ?? null, current: p.feature.current ?? null };
  else {
    const durability = p.feature.durability, destroyed = p.feature.stateGraph?.states.find(candidate => candidate.state === "destroyed");
    if (!durability || !destroyed) throw new RulesValidationError("completion:damage-result-incomplete");
    completion = { kind: "durability", armorClass: Number(durability.armorClass), hitPoints: Number(durability.maximum),
      damageThreshold: Number(durability.damageThreshold), immuneDamageTypes: durability.immuneDamageTypes,
      destroyed: { opaque: destroyed.opaque, impassable: destroyed.impassable, cover: destroyed.cover,
        propagation: destroyed.propagation, terrain: destroyed.terrain ?? "normal" } };
  }
  if (!isNativeObjectCompletion(completion)) throw new RulesValidationError("completion:feature-mechanics-invalid");
  const expected = completedFeatureDefinition(state, p.sceneId, p.feature.featureId, completion);
  if ("error" in expected || !sameCanonical(expected, p.feature)) throw new RulesValidationError("completion:feature-established-facts-changed");
  const geometry = state.combatRuntime.scenes[p.sceneId].geometry;
  if (!isCanonicalTacticalGeometry(geometry)) throw new RulesValidationError("completion:geometry-unavailable");
  geometry.obstacles = geometry.obstacles.map(feature => feature.featureId === p.feature.featureId ? structuredClone(p.feature) : feature);
  return true;
}
