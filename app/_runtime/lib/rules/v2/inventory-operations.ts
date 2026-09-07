import { isItemAssemblyOperation, type ItemAssemblyOperation } from "./item-assembly-shapes";
import { planItemAssemblyTransition, assemblySourceHash, itemAssemblyReadRefs, type ItemAssemblyChangedPayload } from "./item-assemblies";
import { itemIdentifiedBy } from "./item-authority-vnext";
import { narrativeItemBindingRefs, unmaterializedNarrativeRefs } from "./narrative-commitments";
import { conditionFollowupDrafts } from "./condition-consequences";
import { conditionActionPermission } from "./condition-mechanics";
import { GEAR_SLOTS, type GearSlot } from "../../dnd/gear";
import { canonicalCombatPoint, canonicalCombatDirection, type CanonicalCombatPoint } from "../profiles/combat-geometry";
import { canonicalSha256 } from "../profiles/canonical";
import { compileAbilityDefinition, isRegisteredAbilityRecord, registeredAbilityRecord } from "../profiles/ability-compiler";
import type { RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import { authorityReadSetMatches, authoritySpatialRefVisibleTo } from "./authority-bindings";
import { planPlayerAbilityCatalog } from "./character-abilities";
import { stepCombatWorld } from "./combat-actions";
import { createEventTransition, createScopeProof } from "./events";
import { continueCompoundRoot } from "./internal-compound";
import { acquireItemQuantity, changeItemEquipment, changeItemLifecycle, deriveCharacterLoadoutFromItems, itemEquipmentTransitionDurationMicros, releaseItemQuantity, transferItemQuantity } from "./item-transitions";
import { itemEntryUseAbilityId, type ItemOwnershipDisposition, type ItemSystemStateV1 } from "./items";
import { deriveNpcItemSystemLoadout, npcItemSystemEquipmentMechanics } from "./npc-item-system";
import { isNpcMechanicalTemplateDefinition } from "./npc-mechanics";
import { rejected } from "./results";
import { hasExactKeys, hasOnlyKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import type { AuthoritativeWorldState, CharacterRecord, EventEnvelope, EventPayloadByType, EventType, JsonRecord, RuleDiagnostic, StepResult } from "./model";
import type { VersionedAuthorityBinding, WorldInteractionResolvedPayload } from "./world-interaction-model";

export const INVENTORY_OPERATION_PLAN_SCHEMA = "zhuwei.inventory-operation-plan/vnext-1" as const;

export type InventoryUseArea = Readonly<{
  origin: CanonicalCombatPoint;
  direction?: CanonicalCombatPoint;
}>;

export type OrdinaryInventoryOperation =
  | Readonly<{ kind: "acquire"; entryRef: string; quantity: number }>
  | Readonly<{ kind: "identify"; entryRef: string }>
  | Readonly<{ kind: "release"; entryRef: string; quantity: number; sceneRef: string; releaseKind: "placement" | "drop" | "loss" }>
  | Readonly<{ kind: "transfer"; entryRef: string; quantity: number; targetCharacterRef: string; ownershipDisposition: ItemOwnershipDisposition }>
  | Readonly<{ kind: "equip"; entryRef: string; action: "wear" | "stow"; slot: GearSlot }>
  | Readonly<{ kind: "use"; entryRef: string; targetRefs: readonly string[]; area?: InventoryUseArea }>
  | Readonly<{ kind: "lifecycle"; entryRef: string; action: "break" | "repair" | "destroy" }>;

export type InventoryOperation = OrdinaryInventoryOperation | ItemAssemblyOperation;

export type InventoryOperationPlan = Readonly<{
  schema: typeof INVENTORY_OPERATION_PLAN_SCHEMA;
  contextHash: Sha256Ref;
  readSet: readonly VersionedAuthorityBinding[];
  basisRefs: readonly string[];
  summary: string;
  operation: InventoryOperation;
}>;

export type InventoryOperationInput = Readonly<{
  kind: "inventoryOperation";
  rootActionId: string;
  actorCharacterId: string;
  plan: InventoryOperationPlan;
}>;

type InventoryAuthority = Readonly<{ kind: "actor" }> | Readonly<{
  kind: "sharedCheckSuccess";
  resolutionId: string;
  sourceEventId: string;
  sourcePayload: WorldInteractionResolvedPayload;
}>;

export type InventoryOperationAppliedPayload = Readonly<{
  actorCharacterId: string;
  operation: Exclude<OrdinaryInventoryOperation, { kind: "use" }>;
  contextHash: Sha256Ref;
  entryHashBefore: Sha256Ref;
  itemSystemHashAfter: Sha256Ref;
  targetEntryId: string;
  authority: InventoryAuthority;
  summary: string;
}>;

const INVENTORY_ADJUDICATION_GRANT = Symbol("zhuwei.rules.inventory-adjudication-grant");
export type InventoryAdjudicationGrant = Readonly<{
  [INVENTORY_ADJUDICATION_GRANT]: Readonly<{
    rootActionId: string;
    actorCharacterId: string;
    contextHash: Sha256Ref;
    authority: Extract<InventoryAuthority, { kind: "sharedCheckSuccess" }>;
  }>;
}>;

function canonicalStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
}

export function isInventoryOperation(value: unknown): value is InventoryOperation {
  if (isItemAssemblyOperation(value)) return true;
  if (!isRecord(value) || !isNonEmptyString(value.entryRef)) return false;
  const quantity = Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0 && Number(value.quantity) <= 1_000_000;
  switch (value.kind) {
    case "identify": return hasExactKeys(value, ["kind", "entryRef"]);
    case "acquire": return hasExactKeys(value, ["kind", "entryRef", "quantity"]) && quantity;
    case "release": return hasExactKeys(value, ["kind", "entryRef", "quantity", "sceneRef", "releaseKind"])
      && quantity && isNonEmptyString(value.sceneRef) && ["placement", "drop", "loss"].includes(String(value.releaseKind));
    case "transfer": return hasExactKeys(value, ["kind", "entryRef", "quantity", "targetCharacterRef", "ownershipDisposition"])
      && quantity && isNonEmptyString(value.targetCharacterRef) && ["preserve", "transferToRecipient"].includes(String(value.ownershipDisposition));
    case "equip": return hasExactKeys(value, ["kind", "entryRef", "action", "slot"])
      && ["wear", "stow"].includes(String(value.action)) && GEAR_SLOTS.some(({ id }) => id === value.slot);
    case "use": return hasOnlyKeys(value, ["kind", "entryRef", "targetRefs"], ["area"])
      && canonicalStrings(value.targetRefs)
      && (value.area === undefined || (value.targetRefs.length === 0 && isRecord(value.area)
        && hasOnlyKeys(value.area, ["origin"], ["direction"])
        && canonicalCombatPoint(value.area.origin) !== undefined
        && (value.area.direction === undefined || canonicalCombatDirection(value.area.direction) !== undefined)));
    case "lifecycle": return hasExactKeys(value, ["kind", "entryRef", "action"]) && ["break", "repair", "destroy"].includes(String(value.action));
    default: return false;
  }
}

export function isInventoryOperationPlan(value: unknown): value is InventoryOperationPlan {
  return isRecord(value)
    && hasExactKeys(value, ["schema", "contextHash", "readSet", "basisRefs", "summary", "operation"])
    && value.schema === INVENTORY_OPERATION_PLAN_SCHEMA && isSha256(value.contextHash)
    && Array.isArray(value.readSet) && value.readSet.every((binding) => isRecord(binding)
      && hasExactKeys(binding, ["ref", "revisionOrHash"]) && isNonEmptyString(binding.ref) && isNonEmptyString(binding.revisionOrHash))
    && new Set(value.readSet.map((binding) => binding.ref)).size === value.readSet.length
    && canonicalStrings(value.basisRefs) && isNonEmptyString(value.summary) && isInventoryOperation(value.operation);
}

function validSharedCheckAuthority(
  state: AuthoritativeWorldState,
  authority: Extract<InventoryAuthority, { kind: "sharedCheckSuccess" }>,
  rootActionId: string,
  actorCharacterId: string,
  contextHash: Sha256Ref,
  entryRef?: string,
): boolean {
  const audit = state.correctionRuntime.audit[authority.sourceEventId];
  const source = authority.sourcePayload;
  return audit !== undefined && audit.eventType === "WorldInteractionResolved"
    && audit.rootActionId === rootActionId && audit.branchId === state.activeBranchId
    && audit.payloadHash === canonicalSha256(source)
    && source.resolutionId === authority.resolutionId && source.actorCharacterId === actorCharacterId
    && source.contextHash === contextHash && source.rulingKind === "check" && source.branch === "success"
    && source.check !== null && source.check.succeeded === true
    && (entryRef === undefined || source.directTargetRefs.includes(entryRef));
}

/** Called by the atomic executor only after its shared check and onSuccess
 * binding are verified. The Symbol is intentionally not a wire capability. */
export function createInventoryAdjudicationGrant(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
  binding: Readonly<{ rootActionId: string; actorCharacterId: string; contextHash: Sha256Ref; outcomeBinding: "onSuccess" }>,
): InventoryAdjudicationGrant | undefined {
  if (binding.outcomeBinding !== "onSuccess" || event.eventType !== "WorldInteractionResolved"
    || event.rootActionId !== binding.rootActionId || event.branchId !== state.activeBranchId) return undefined;
  const sourcePayload = event.payload as WorldInteractionResolvedPayload;
  const authority = { kind: "sharedCheckSuccess" as const, resolutionId: sourcePayload.resolutionId,
    sourceEventId: event.eventId, sourcePayload: structuredClone(sourcePayload) };
  if (!validSharedCheckAuthority(state, authority, binding.rootActionId, binding.actorCharacterId, binding.contextHash)) return undefined;
  return Object.freeze({ [INVENTORY_ADJUDICATION_GRANT]: Object.freeze({ ...binding, authority }) });
}

export function isInventoryOperationAppliedPayload(value: unknown): value is InventoryOperationAppliedPayload {
  if (!isRecord(value)
    || !hasExactKeys(value, ["actorCharacterId", "operation", "contextHash", "entryHashBefore", "itemSystemHashAfter", "targetEntryId", "authority", "summary"])
    || !isNonEmptyString(value.actorCharacterId) || !isInventoryOperation(value.operation) || isItemAssemblyOperation(value.operation) || value.operation.kind === "use"
    || !isSha256(value.contextHash) || !isSha256(value.entryHashBefore) || !isSha256(value.itemSystemHashAfter)
    || !isNonEmptyString(value.targetEntryId) || !isNonEmptyString(value.summary) || !isRecord(value.authority)) return false;
  const authority = value.authority;
  return authority.kind === "actor" ? hasExactKeys(authority, ["kind"])
    : authority.kind === "sharedCheckSuccess" && hasExactKeys(authority, ["kind", "resolutionId", "sourceEventId", "sourcePayload"])
      && isNonEmptyString(authority.resolutionId) && isNonEmptyString(authority.sourceEventId)
      && isRecord(authority.sourcePayload) && Array.isArray(authority.sourcePayload.directTargetRefs);
}

function itemLoadoutBasis(character: CharacterRecord) {
  return { holderRef: character.id, classId: character.classId,
    scores: { dex: character.abilityScores?.dex ?? 10, con: character.abilityScores?.con ?? 10 },
    speedFeet: character.loadout?.speedFeet ?? 30 };
}

export function inventoryHolderLoadout(state: AuthoritativeWorldState, character: CharacterRecord, itemSystem: ItemSystemStateV1) {
  const combat = state.combatRuntime.entities[character.id];
  const definition = isRecord(combat) && isNonEmptyString(combat.mechanicalDefinitionRef)
    ? state.combatRuntime.definitions[combat.mechanicalDefinitionRef] : undefined;
  if (character.kind === "npc" && isNpcMechanicalTemplateDefinition(definition)) {
    return deriveNpcItemSystemLoadout(itemSystem, character, definition);
  }
  return deriveCharacterLoadoutFromItems(itemSystem, itemLoadoutBasis(character));
}

export type InventoryTransition = Readonly<{
  itemSystem: ItemSystemStateV1;
  targetEntryId: string;
  affectedHolderRefs: readonly string[];
}>;

function unavailableInventoryEntry(): { error: string; diagnostics: RuleDiagnostic[] } {
  return { error: "inventoryReferenceUnavailable", diagnostics: [{
    code: "REFERENCE_UNAVAILABLE",
    path: "/plan/operation/entryRef",
    constraint: "inventory:entry-ref-must-resolve-to-item-entry",
    expected: { referenceKind: "itemEntry" },
    message: "The inventory operation entryRef must resolve to an ItemEntry instance.",
    source: "SPEC 0013", visibility: "public",
  }] };
}

/** Recomputed by both planning and event fold; payloads never carry an arbitrary
 * ItemEntry patch. Replay re-verifies the successful check against its audit. */
export function planInventoryTransition(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  operation: Exclude<OrdinaryInventoryOperation, { kind: "use" }>,
  rootActionId: string,
  contextHash: Sha256Ref,
  authority: InventoryAuthority,
  targetEntryId?: string,
): InventoryTransition | { error: string; diagnostics?: RuleDiagnostic[] } {
  const actor = state.entities[actorCharacterId];
  const itemSystem = state.campaignRuntime.itemSystem;
  const entry = itemSystem.entries[operation.entryRef];
  if (entry?.assemblyRef !== undefined) return { error: "itemComponentOccupied" };
  if (actor?.tenureStatus !== "active" || actor.loadout === undefined
    || state.scenes[actor.sceneId] === undefined) return { error: "inventoryReferenceUnavailable" };
  // Missing and unavailable ground entries expose the same contract metadata.
  // Check availability before actor/scene errors can reveal a hidden instance.
  if (entry === undefined || (entry.disposition === "scene"
    && !authoritySpatialRefVisibleTo(state, entry.entryId, actor.sceneId, actor.id))) {
    return unavailableInventoryEntry();
  }
  if(!conditionActionPermission(state,actor.id,{kind:"action"}).allowed) {
    return {error:"inventoryActorCannotAct"};
  }
  const holder = entry.holderRef === null ? undefined : state.entities[entry.holderRef];
  const entryScene = entry.disposition === "scene" ? entry.sceneRef : holder?.sceneId;
  if (entryScene !== actor.sceneId || (holder !== undefined && holder.tenureStatus !== "active")) {
    return { error: "inventorySceneMismatch" };
  }
  const foreignHeld = entry.disposition === "held" && entry.holderRef !== actor.id;
  if (foreignHeld && (authority.kind !== "sharedCheckSuccess"
    || !validSharedCheckAuthority(state, authority, rootActionId, actor.id, contextHash, entry.entryId)
    || operation.kind !== "transfer"
    || (operation.targetCharacterRef !== actor.id && !authority.sourcePayload.directTargetRefs.includes(operation.targetCharacterRef)))) return { error: "inventoryAdjudicationRequired" };
  if (!foreignHeld && authority.kind !== "actor") return { error: "inventoryAuthorityMismatch" };
  if (operation.kind === "equip" && Object.values(state.combatRuntime.encounters).some((encounter) =>
    encounter.status !== "concluded" && Array.isArray(encounter.participantEntityIds) && encounter.participantEntityIds.includes(actor.id))) {
    return { error: "inventoryEquipmentDuringEncounter" };
  }
  if (Object.values(state.campaignRuntime.activities).some((activity) => activity.status === "active"
    && activity.characterId === actor.id)) return { error: "inventoryActorBusy" };
  const affected = new Set<string>(holder === undefined ? [] : [holder.id]);
  let result: { itemSystem: ItemSystemStateV1; targetEntryId?: string } | { error: string };
  const move = (execute: (id?: string) => typeof result) => {
    // Existing homogeneous stacks choose their canonical identity before a
    // deterministic split id is allocated. A caller cannot force a second stack.
    const initial = execute(targetEntryId);
    return "error" in initial && initial.error === "targetEntryIdRequired" && targetEntryId === undefined
      ? execute(`item-entry:inventory:${canonicalSha256({ rootActionId, operation }).slice(7)}`) : initial;
  };
  switch (operation.kind) {
    case "identify":
      if (!authoritySpatialRefVisibleTo(state, entry.entryId, actor.sceneId, actor.id)) return unavailableInventoryEntry();
      result = { itemSystem, targetEntryId: entry.entryId };
      break;
    case "acquire":
      affected.add(actor.id);
      result = move((id) => acquireItemQuantity(itemSystem, { entryId: entry.entryId, holderRef: actor.id, quantity: operation.quantity, ...(id === undefined ? {} : { targetEntryId: id }) }));
      break;
    case "release":
      if (operation.sceneRef !== actor.sceneId) return { error: "inventorySceneMismatch" };
      result = move((id) => releaseItemQuantity(itemSystem, { entryId: entry.entryId, holderRef: actor.id, sceneRef: operation.sceneRef, quantity: operation.quantity, ...(id === undefined ? {} : { targetEntryId: id }) }));
      break;
    case "transfer": {
      const recipient = state.entities[operation.targetCharacterRef];
      if (recipient?.tenureStatus !== "active" || recipient.sceneId !== actor.sceneId || recipient.loadout === undefined || entry.holderRef === null) return { error: "inventoryRecipientUnavailable" };
      affected.add(recipient.id);
      result = move((id) => transferItemQuantity(itemSystem, { entryId: entry.entryId, fromHolderRef: entry.holderRef!, toHolderRef: recipient.id, quantity: operation.quantity, ownershipDisposition: operation.ownershipDisposition, ...(id === undefined ? {} : { targetEntryId: id }) }));
      break;
    }
    case "equip":
      if (operation.action === "stow" && entry.equippedSlot !== operation.slot) return { error: "inventoryEquipmentMismatch" };
      result = changeItemEquipment(itemSystem, itemLoadoutBasis(actor), operation.action === "wear"
        ? { action: "wear", entryId: entry.entryId, slot: operation.slot } : { action: "stow", slot: operation.slot });
      break;
    case "lifecycle":
      result = changeItemLifecycle(itemSystem, { entryId: entry.entryId, action: operation.action, ...(entry.disposition === "held" ? { holderRef: actor.id } : {}) });
      break;
  }
  if ("error" in result) return result;
  return { itemSystem: result.itemSystem, targetEntryId: result.targetEntryId ?? entry.entryId, affectedHolderRefs: [...affected].sort() };
}

/** The exact-entry frozen Ability is the only use authority. It owns targeting,
 * Activity duration, resources, costs, randomness and effects. */
export function planInventoryUse(
  state: AuthoritativeWorldState,
  input: InventoryOperationInput,
  options: Readonly<{ continuedRoot?: true }> = {},
): { rulesInput: JsonRecord } | { error: string } {
  const operation = input.plan.operation;
  if (operation.kind !== "use") return { error: "inventoryUseExpected" };
  const actor = state.entities[input.actorCharacterId];
  const entry = state.campaignRuntime.itemSystem.entries[operation.entryRef];
  const definition = entry === undefined ? undefined : state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
  if (actor?.tenureStatus !== "active" || entry?.disposition !== "held" || entry.holderRef !== actor.id
    || entry.condition !== "usable" || definition?.content.use === null || definition === undefined) return { error: "inventoryUseUnavailable" };
  const abilityRef = itemEntryUseAbilityId(definition.content.use.abilityRef, entry.entryId);
  const ability = state.combatRuntime.definitions[abilityRef];
  if (!isRegisteredAbilityRecord(ability)) return { error: "inventoryUseAbilityNotFrozen" };
  const areaTarget = isRecord(ability.target) && ability.target.kind === "area";
  if (areaTarget !== (operation.area !== undefined)) return { error: "inventoryUseTargetShapeMismatch" };
  const parameters: JsonRecord = operation.area !== undefined
    ? { areaOrigin: structuredClone(operation.area.origin),
        ...(operation.area.direction === undefined ? {} : { areaDirection: structuredClone(operation.area.direction) }) }
    : operation.targetRefs.length === 0 ? {}
    : operation.targetRefs.length === 1 ? operation.targetRefs.length === 1 ? { targetEntityId: operation.targetRefs[0] } : { targetEntityIds: [...operation.targetRefs] }
    : { targetEntityIds: [...operation.targetRefs] };
  const rulesInput = { kind: "invokeAbility", rootActionId: input.rootActionId, sourceEntityId: actor.id,
    abilityRef, parameters };
  return { rulesInput: options.continuedRoot ? continueCompoundRoot(rulesInput, input.rootActionId) : rulesInput };
}

type Draft = { eventType: EventType; payload: EventPayloadByType[EventType]; creates?: string[] };

export function stepInventoryOperation(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  options: Readonly<{ continuedRoot?: true; readSetAlreadyValidated?: true; adjudicationGrant?: InventoryAdjudicationGrant }> = {},
): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"]) || input.kind !== "inventoryOperation"
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId) || !isInventoryOperationPlan(input.plan)) {
    return rejected("invalidRulesInput", "The inventory operation is not canonical.");
  }
  const plan = input.plan;
  if (input.rootActionId in state.receipts && !options.continuedRoot) return rejected("duplicateRootAction", "The inventory root action is already used.");
  if (!options.readSetAlreadyValidated && !authorityReadSetMatches(state, plan.readSet)) return rejected("invalidRulesInput", "The inventory authority read set is stale.");
  if (unmaterializedNarrativeRefs(state, plan.basisRefs).length > 0) return rejected("invalidRulesInput", "Narrative commitments must be materialized before authorizing inventory mechanics.");
  if (isItemAssemblyOperation(plan.operation)) {
    if (!options.readSetAlreadyValidated && itemAssemblyReadRefs(state, input.actorCharacterId, plan.operation)
      .some(ref => !plan.readSet.some(binding => binding.ref === ref))) return rejected("invalidRulesInput", "The assembly authority read set is incomplete.");
    return stepAssemblyOperation(profiles, state, input as InventoryOperationInput, plan.operation);
  }
  if (plan.operation.kind === "use") {
    const use = planInventoryUse(state, input as InventoryOperationInput, options);
    return "error" in use ? rejected("invalidRulesInput", use.error)
      : stepCombatWorld(profiles, state, use.rulesInput) ?? rejected("unsupportedOperation", "The item Ability cannot execute.");
  }
  const entry = state.campaignRuntime.itemSystem.entries[plan.operation.entryRef];
  let authority: InventoryAuthority = { kind: "actor" };
  if (entry?.disposition === "held" && entry.holderRef !== input.actorCharacterId) {
    const grant = options.adjudicationGrant?.[INVENTORY_ADJUDICATION_GRANT];
    if (grant?.rootActionId !== input.rootActionId || grant.actorCharacterId !== input.actorCharacterId || grant.contextHash !== plan.contextHash) {
      return rejected("invalidRulesInput", "A verified shared check is required to take another holder's item.");
    }
    authority = grant.authority;
  }
  const transition = planInventoryTransition(state, input.actorCharacterId, plan.operation, input.rootActionId, plan.contextHash, authority);
  if ("error" in transition) return rejected("invalidRulesInput", transition.error, transition.diagnostics);
  const drafts: Draft[] = [];
  const catalog = structuredClone(state.combatRuntime.definitions);
  for (const holderRef of transition.affectedHolderRefs) {
    const holder = state.entities[holderRef];
    const derived = inventoryHolderLoadout(state, holder, transition.itemSystem);
    if ("error" in derived) return rejected("invalidWorldState", derived.error);
    const nextHolder = { ...structuredClone(holder), loadout: derived.loadout };
    if (holder.kind === "player") {
      const abilities = planPlayerAbilityCatalog({ character: nextHolder, itemSystem: transition.itemSystem, catalog });
      if ("error" in abilities) return rejected("invalidWorldState", abilities.error);
      for (const artifact of abilities.registrations) {
        const ref = String(artifact.definition.definitionId);
        drafts.push({ eventType: "DefinitionRegistered", payload: structuredClone(artifact), creates: [`definition:${ref}`] });
        catalog[ref] = registeredAbilityRecord(artifact);
      }
    } else {
      const equipment = npcItemSystemEquipmentMechanics(nextHolder, transition.itemSystem, catalog);
      for (const definition of equipment.definitions) {
        const compiled = compileAbilityDefinition(definition);
        if (!compiled.ok) return rejected("invalidWorldState", "The NPC inventory Ability cannot be frozen.");
        const ref = String(definition.definitionId);
        const prior = catalog[ref];
        if (prior !== undefined && (!isRegisteredAbilityRecord(prior) || prior.definitionHash !== canonicalSha256(definition))) return rejected("invalidWorldState", "The NPC inventory Ability conflicts with its frozen definition.");
        if (prior === undefined) {
          drafts.push({ eventType: "DefinitionRegistered", payload: structuredClone(compiled.artifact), creates: [`definition:${ref}`] });
          catalog[ref] = registeredAbilityRecord(compiled.artifact);
        }
      }
    }
  }
  if (plan.operation.kind === "equip" || (authority.kind === "actor" && (plan.operation.kind === "release" || plan.operation.kind === "transfer"))) {
    const durationMicros = itemEquipmentTransitionDurationMicros(state.campaignRuntime.itemSystem, transition.itemSystem, input.actorCharacterId);
    if (durationMicros !== undefined) {
      const activityId = `activity:inventory:${input.rootActionId}:${canonicalSha256(plan.operation).slice(7, 23)}`;
      drafts.unshift({ eventType: "ActivityStarted", payload: { activityId, characterId: input.actorCharacterId,
        activityKind: "inventoryEquipmentChange", intendedDurationMicros: durationMicros,
        completion: { kind: "inventoryOperation", operation: structuredClone(plan.operation) } }, creates: [`activity:${activityId}`] },
      { eventType: "FictionTimeAdvanced", payload: { durationMicros, reason: "角色调整物品装备" } },
      { eventType: "ActivityCompleted", payload: { activityId } });
    }
  }
  const payload: InventoryOperationAppliedPayload = { actorCharacterId: input.actorCharacterId, operation: plan.operation,
    contextHash: plan.contextHash, entryHashBefore: canonicalSha256(entry), itemSystemHashAfter: canonicalSha256(transition.itemSystem),
    targetEntryId: transition.targetEntryId, authority, summary: plan.summary };
  const createdEntryScopes = state.campaignRuntime.itemSystem.entries[transition.targetEntryId] === undefined
    ? [`item-entry:${transition.targetEntryId}`] : [];
  drafts.push({ eventType: "InventoryOperationApplied", payload, creates: createdEntryScopes });
  if (plan.operation.kind === "identify") {
    const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
    if (plan.basisRefs.length === 0 || itemIdentifiedBy(state, input.actorCharacterId, entry, definition)) {
      return rejected("invalidRulesInput", "Item identification requires a new causal knowledge grant.");
    }
    drafts.push({ eventType: "ItemIdentified", payload: { characterId: input.actorCharacterId,
      entryRef: entry.entryId, definitionRef: definition.definitionId, definitionHash: canonicalSha256(definition), basisRefs: [...plan.basisRefs] } });
  }
  const scopes = [...new Set([
    `receipt:${input.rootActionId}`,
    `item-entry:${plan.operation.entryRef}`,
    ...narrativeItemBindingRefs(state, plan.operation.entryRef),
    ...(createdEntryScopes.length === 0 ? [`item-entry:${transition.targetEntryId}`] : []),
    ...transition.affectedHolderRefs.flatMap((ref) => [`entity:${ref}`, `combat-entity:${ref}`]),
  ])];
  const creates = drafts.flatMap((draft) => draft.creates ?? []);
  const scopeProof = createScopeProof(state, scopes, scopes, creates);
  let next = state;
  const events: EventEnvelope[] = [];
  let receipt;
  for (let draftIndex=0;draftIndex<drafts.length;draftIndex++) {
    const draft=drafts[draftIndex]!;
    const result = createEventTransition(next, profiles, { rootActionId: input.rootActionId,
      eventType: draft.eventType, payload: draft.payload,
      scopeProof: createScopeProof(next, scopes, scopes, draft.creates ?? []),
      visibilityPolicyId: draft.eventType === "ItemIdentified" ? `visibility:character-controller:${input.actorCharacterId}` : "visibility:room-authority-only", secrecy: draft.eventType === "ItemIdentified" ? "private" : "internal" });
    next = result.state; events.push(result.event); receipt = result.receipt;
    drafts.splice(draftIndex+1,0,...conditionFollowupDrafts(next,result.event));
  }
  return { kind: "committed", state: next, cache: next, events, stateHash: events[events.length - 1].stateHashAfter,
    scopeProof, receipt: { ...receipt!, eventRange: { fromEventSeq: events[0].eventSeq, toEventSeq: events[events.length - 1].eventSeq }, scopeProofHash: scopeProof.proofHash } };
}

function stepAssemblyOperation(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  input: InventoryOperationInput, operation: ItemAssemblyOperation): StepResult {
  const transition = planItemAssemblyTransition(state, input.actorCharacterId, operation, input.rootActionId);
  if ("error" in transition) return rejected("invalidRulesInput", transition.error);
  const payload: ItemAssemblyChangedPayload = { actorCharacterId: input.actorCharacterId, operation,
    contextHash: input.plan.contextHash, sourceHashBefore: assemblySourceHash(state, operation),
    itemSystemHashAfter: canonicalSha256(transition.itemSystem), assemblyRef: transition.assemblyRef, summary: input.plan.summary };
  const entries = Object.keys(transition.itemSystem.entries);
  const creates = [...(operation.kind === "assemble" ? [`item-assembly:${transition.assemblyRef}`] : []), ...entries.filter(ref => !state.campaignRuntime.itemSystem.entries[ref]).map(ref => `item-entry:${ref}`)];
  const changedEntryRefs = [...new Set([...Object.keys(state.campaignRuntime.itemSystem.entries), ...entries])]
    .filter(ref => canonicalSha256(state.campaignRuntime.itemSystem.entries[ref] ?? null) !== canonicalSha256(transition.itemSystem.entries[ref] ?? null));
  const scopes = [`receipt:${input.rootActionId}`, `entity:${input.actorCharacterId}`, `combat-entity:${input.actorCharacterId}`,
    `item-assembly:${transition.assemblyRef}`, ...changedEntryRefs.map(ref => `item-entry:${ref}`),
    ...input.plan.readSet.map(read => read.ref)];
  const derived = inventoryHolderLoadout(state, state.entities[input.actorCharacterId], transition.itemSystem);
  if ("error" in derived) return rejected("invalidWorldState", derived.error);
  const holder = { ...structuredClone(state.entities[input.actorCharacterId]), loadout: derived.loadout };
  const drafts: Draft[] = [];
  if (holder.kind === "player") {
    const catalog = planPlayerAbilityCatalog({ character: holder, itemSystem: transition.itemSystem, catalog: state.combatRuntime.definitions });
    if ("error" in catalog) return rejected("invalidWorldState", catalog.error);
    for (const artifact of catalog.registrations) drafts.push({ eventType: "DefinitionRegistered", payload: structuredClone(artifact), creates: [`definition:${String(artifact.definition.definitionId)}`] });
  }
  if (holder.kind === "npc") {
    const equipment = npcItemSystemEquipmentMechanics(holder, transition.itemSystem, state.combatRuntime.definitions);
    for (const definition of equipment.definitions) {
      const compiled = compileAbilityDefinition(definition);
      if (!compiled.ok) return rejected("invalidWorldState", "The NPC inventory Ability cannot be frozen.");
      const ref = String(definition.definitionId), prior = state.combatRuntime.definitions[ref];
      if (prior !== undefined && (!isRegisteredAbilityRecord(prior) || prior.definitionHash !== canonicalSha256(definition))) return rejected("invalidWorldState", "The NPC inventory Ability conflicts with its frozen definition.");
      if (prior === undefined) drafts.push({ eventType: "DefinitionRegistered", payload: structuredClone(compiled.artifact), creates: [`definition:${ref}`] });
    }
  }
  drafts.push({ eventType: "ItemAssemblyChanged", payload, creates });
  const scopeProof = createScopeProof(state, scopes, scopes, drafts.flatMap(draft => draft.creates ?? []));
  let next = state;
  const events: EventEnvelope[] = [];
  let receipt;
  for (const draft of drafts) {
    const result = createEventTransition(next, profiles, { rootActionId: input.rootActionId, eventType: draft.eventType,
      payload: draft.payload, scopeProof: createScopeProof(next, scopes, scopes, draft.creates ?? []),
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
    next = result.state; events.push(result.event); receipt = result.receipt;
  }
  return { kind: "committed", state: next, cache: next, events, stateHash: events.at(-1)!.stateHashAfter, scopeProof,
    receipt: { ...receipt!, eventRange: { fromEventSeq: events[0].eventSeq, toEventSeq: events.at(-1)!.eventSeq }, scopeProofHash: scopeProof.proofHash } };
}
