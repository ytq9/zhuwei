import { GEAR_SLOTS, ITEM_STOCK_RESOURCE_IDS, type GearSlot } from "../../dnd/gear";
import { compileAbilityDefinition, isRegisteredAbilityRecord, registeredAbilityRecord } from "../profiles/ability-compiler";
import { canonicalSha256 } from "../profiles/canonical";
import { entityOccupanciesOverlap } from "../profiles/combat-geometry";
import { itemSystemProfileEnabled } from "../profiles/item-system";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import type { RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import { authorityReadSetMatches, authorityRevisionOrHash } from "./authority-bindings";
import { isItemDefinitionV1, type ItemSystemStateV1 } from "./items";
import type { AuthoritativeWorldState, CharacterRecord, EventEnvelope, JsonRecord, NpcSocialMechanicsRecord,
  RejectedRulesResult, ScopeProof, StepResult } from "./model";
import { npcItemSystemEquipmentMechanics, planNpcInitialItemImport } from "./npc-item-system";
import { canonicalNpcMechanicalPoint, instantiateNpcMechanicalEntity, isNpcMechanicalTemplateDefinition,
  npcCoreMechanicsCompatible, npcMechanicalDefinitionClosureValid, npcMechanicalEntityMatchesTemplate,
  synchronizeCombatItemResources } from "./npc-mechanics";
import { rejected } from "./results";
import { createDefinitionSnapshot, storedSemanticDefinition, type StoredSemanticDefinition } from "./semantic-definitions";
import { isNpcSocialMechanics } from "./social-model";
import { spatialVisibilityPolicyKind } from "./spatial-visibility";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isRecord } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";

export const NPC_MATERIALIZATION_PLAN_SCHEMA = "zhuwei.npc-materialization-plan/v1" as const;
type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
type DamageType = "acid" | "bludgeoning" | "cold" | "fire" | "force" | "lightning" | "necrotic"
  | "piercing" | "poison" | "psychic" | "radiant" | "slashing" | "thunder";
export type NpcMaterializationMechanicalTemplate = Readonly<{
  schema: "zhuwei.npc-mechanical-template/v1";
  label: string;
  stats: Readonly<Record<Ability, string>>;
  proficiencyBonus: string;
  armorClass: string;
  armorClassModel: Readonly<{ kind: "higherOfBaseAndEquipment"; baseArmorClass: string; shieldBonus: "0" | "2" }>;
  hitPointsMaximum: string;
  footprint: Readonly<{ width: string; depth: string; height: string }>;
  speedInches: Readonly<Partial<Record<"walk" | "climb" | "fly" | "swim" | "burrow", string>>>;
  resourceMaximums: Readonly<Record<string, string>>;
  deathPolicy: "deadAtZero" | "deathSaves" | "defeatedAtZero";
  intrinsicAbilityRefs: readonly string[];
  itemDefinitionRefs: readonly string[];
  initialLoadout: Readonly<{ entries: readonly Readonly<{ entryId: string; quantity: number; equippedSlot: GearSlot | null;
    source: Readonly<{ kind: "standardGear" | "itemDefinition"; ref: string }> }>[] }>;
  attacksPerAttackAction?: string;
  damageDefenses?: Readonly<Partial<Record<"immune" | "resistant" | "vulnerable", readonly DamageType[]>>>;
  sizeCategory?: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
  spellcasting?: Readonly<{ ability: Ability; spellAttackBonus: string; spellSaveDc: string }>;
}>;

/** An authored identity and its complete mechanics. Existing knowledge and
 * player control are separate authority operations, never creation fields. */
export type NpcMaterializationSource = Readonly<{
  name: string;
  description: string;
  background: string;
  goals: readonly string[];
  behavioralConstraints: readonly string[];
  voice: string;
  initialUnknowns: readonly string[];
  rulesBasis: "srd5.1-2014" | "zhuwei-product-ruling";
  mechanicalTemplate: NpcMaterializationMechanicalTemplate;
  socialMechanics: NpcSocialMechanicsRecord;
  position: Readonly<{ x: string; y: string; elevation: string }>;
}>;
export type NpcMaterializationPlan = Readonly<{
  schema: typeof NPC_MATERIALIZATION_PLAN_SCHEMA;
  contextHash: Sha256Ref;
  prospectiveRef: string;
  sceneRef: string;
  source: NpcMaterializationSource;
  basisRefs: readonly string[];
  authorizationRefs: readonly string[];
  readSet: readonly VersionedAuthorityBinding[];
  visibilityPolicyRef: string;
}>;
export type NpcMaterializationInput = Readonly<{
  kind: "materializeNpc";
  rootActionId: string;
  actorCharacterId: string;
  plan: NpcMaterializationPlan;
}>;
export type NpcMaterializedPayload = Readonly<{ actorCharacterId: string; plan: NpcMaterializationPlan }>;

const abilities: readonly Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const damageTypes: readonly DamageType[] = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const refSchema = { type: "string", minLength: 1, maxLength: 240, pattern: "^\\S+$" };
const textSchema = (maxLength: number) => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const refsSchema = (maxItems: number) => ({ type: "array", maxItems, uniqueItems: true, items: refSchema });
const textListSchema = (minItems: number) => ({ type: "array", minItems, maxItems: 40,
  uniqueItems: true, items: textSchema(1_000) });
const closed = (properties: JsonRecord, required: readonly string[] = Object.keys(properties)) =>
  ({ type: "object", additionalProperties: false, required: [...required], properties });
const stringInteger = (pattern: string) => ({ type: "string", pattern: `^(?:${pattern})$` });
const million = "0|[1-9][0-9]{0,5}|1000000";
const positiveMillion = "[1-9][0-9]{0,5}|1000000";
const thirty = "[1-9]|[12][0-9]|30";
const coordinateSchema = stringInteger("0|-?(?:[1-9][0-9]{0,5}|1000000)");
const templateProperties = {
  schema: { const: "zhuwei.npc-mechanical-template/v1" }, label: textSchema(500),
  stats: closed(Object.fromEntries(abilities.map(key => [key, stringInteger(thirty)]))),
  proficiencyBonus: stringInteger("[2-9]"), armorClass: stringInteger(thirty),
  armorClassModel: closed({ kind: { const: "higherOfBaseAndEquipment" }, baseArmorClass: stringInteger(thirty),
    shieldBonus: { enum: ["0", "2"] } }),
  hitPointsMaximum: stringInteger(positiveMillion),
  footprint: closed(Object.fromEntries(["width", "depth", "height"].map(key => [key,
    stringInteger("[1-9][0-9]{0,4}|100000")]))),
  speedInches: { ...closed(Object.fromEntries(["walk", "climb", "fly", "swim", "burrow"]
    .map(key => [key, stringInteger(million)])), []), minProperties: 1 },
  resourceMaximums: { type: "object", maxProperties: 100, propertyNames: { ...refSchema,
    allOf: [{ not: { pattern: "^(?:item:|item-entry:)" } }, { not: { enum: [...ITEM_STOCK_RESOURCE_IDS] } }] },
    additionalProperties: stringInteger(million) },
  deathPolicy: { enum: ["deadAtZero", "deathSaves", "defeatedAtZero"] },
  intrinsicAbilityRefs: refsSchema(24), itemDefinitionRefs: refsSchema(24),
  initialLoadout: closed({ entries: { type: "array", maxItems: 48, items: closed({ entryId: refSchema,
    quantity: { type: "integer", minimum: 1, maximum: 1_000_000 },
    equippedSlot: { enum: [...GEAR_SLOTS.map(slot => slot.id), null] },
    source: closed({ kind: { enum: ["standardGear", "itemDefinition"] }, ref: refSchema }) }) } }),
  attacksPerAttackAction: stringInteger("[1-9]|[1-9][0-9]|100"),
  damageDefenses: closed(Object.fromEntries(["immune", "resistant", "vulnerable"].map(key => [key,
    { type: "array", maxItems: 13, uniqueItems: true, items: { enum: [...damageTypes] } }])), []),
  sizeCategory: { enum: ["tiny", "small", "medium", "large", "huge", "gargantuan"] },
  spellcasting: closed({ ability: { enum: [...abilities] }, spellAttackBonus: stringInteger(`0|-?(?:${thirty})`),
    spellSaveDc: stringInteger(`0|${thirty}`) }),
};
const templateRequired = Object.keys(templateProperties)
  .filter(key => !["attacksPerAttackAction", "damageDefenses", "sizeCategory", "spellcasting"].includes(key));
const sourceProperties = {
  name: textSchema(160), description: textSchema(4_000), background: textSchema(4_000),
  goals: textListSchema(1), behavioralConstraints: textListSchema(1), voice: textSchema(1_000),
  initialUnknowns: textListSchema(0), rulesBasis: { enum: ["srd5.1-2014", "zhuwei-product-ruling"] },
  mechanicalTemplate: closed(templateProperties, templateRequired),
  socialMechanics: closed({
    abilityScores: closed(Object.fromEntries(abilities.map(key => [key, { type: "integer", minimum: 1, maximum: 30 }]))),
    proficiencyBonus: { type: "integer", minimum: 2, maximum: 9 },
    skillModifiers: { type: "object", maxProperties: 100, propertyNames: refSchema,
      additionalProperties: { type: "integer", minimum: -20, maximum: 30 } },
    initialTrust: { type: "integer", minimum: -5, maximum: 5 },
    authorityModifier: { type: "integer", minimum: -5, maximum: 5 },
    stakesSensitivity: { type: "integer", minimum: -5, maximum: 5 },
    maximumInfluenceDegree: { enum: ["limitedSuccess", "fullSuccess", "strongSuccess"] },
  }),
  position: closed({ x: coordinateSchema, y: coordinateSchema, elevation: coordinateSchema }),
};
export const NPC_MATERIALIZATION_SOURCE_SCHEMA = Object.freeze(closed(sourceProperties));

const canonicalText = (value: unknown, max: number): value is string => typeof value === "string"
  && value.trim().length > 0 && value.length <= max && value.normalize("NFC") === value;
const canonicalRef = (value: unknown): value is string => canonicalText(value, 240) && /^\S+$/u.test(value);
const canonicalRefs = (value: unknown, min: number): value is readonly string[] => Array.isArray(value)
  && value.length >= min && value.length <= 128 && value.every(canonicalRef)
  && value.every((entry, index) => index === 0 || value[index - 1] < entry);
const textList = (value: unknown, min: number): value is readonly string[] => Array.isArray(value)
  && value.length >= min && value.length <= 40 && value.every(entry => canonicalText(entry, 1_000))
  && value.length === new Set(value).size;
function mechanicalDefinition(source: NpcMaterializationSource, definitionId: string, basisRefs: readonly string[]): JsonRecord {
  return { definitionId, definitionKind: "npcMechanicalTemplate", revision: "1", rulesBasis: source.rulesBasis,
    causalBasisRefs: [...basisRefs], visibilityPolicyRef: "visibility:room-authority-only",
    content: structuredClone(source.mechanicalTemplate) };
}
export function isNpcMaterializationSource(value: unknown): value is NpcMaterializationSource {
  if (!isRecord(value) || !hasExactKeys(value, Object.keys(sourceProperties))
    || !canonicalText(value.name, 160) || !canonicalText(value.description, 4_000)
    || !canonicalText(value.background, 4_000) || !textList(value.goals, 1)
    || !textList(value.behavioralConstraints, 1) || !textList(value.initialUnknowns, 0)
    || !canonicalText(value.voice, 1_000)
    || !["srd5.1-2014", "zhuwei-product-ruling"].includes(String(value.rulesBasis))
    || !canonicalNpcMechanicalPoint(value.position) || !isNpcSocialMechanics(value.socialMechanics)
    || Object.keys(value.socialMechanics.skillModifiers).length > 100
    || !Object.keys(value.socialMechanics.skillModifiers).every(canonicalRef)
    || !isRecord(value.mechanicalTemplate)) return false;
  const candidate = value as unknown as NpcMaterializationSource;
  if (!isNpcMechanicalTemplateDefinition(mechanicalDefinition(candidate, "definition:npc-source-validation", []))) return false;
  const template = candidate.mechanicalTemplate;
  return canonicalText(template.label, 500)
    && [...template.intrinsicAbilityRefs, ...template.itemDefinitionRefs, ...Object.keys(template.resourceMaximums)].every(canonicalRef)
    && template.initialLoadout.entries.every(entry => canonicalRef(entry.entryId) && canonicalRef(entry.source.ref))
    && abilities.every(ability => Number(template.stats[ability]) === candidate.socialMechanics.abilityScores[ability])
    && Number(template.proficiencyBonus) === candidate.socialMechanics.proficiencyBonus;
}
export function isNpcMaterializationPlan(value: unknown): value is NpcMaterializationPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "prospectiveRef", "sceneRef", "source",
    "basisRefs", "authorizationRefs", "readSet", "visibilityPolicyRef"])
    && value.schema === NPC_MATERIALIZATION_PLAN_SCHEMA && typeof value.contextHash === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value.contextHash)
    && canonicalRef(value.prospectiveRef) && canonicalRef(value.sceneRef) && isNpcMaterializationSource(value.source)
    && canonicalRefs(value.basisRefs, 1) && value.basisRefs.length <= 40 && canonicalRefs(value.authorizationRefs, 1)
    && isCanonicalReadSet(value.readSet) && value.readSet.every(entry => canonicalRef(entry.ref))
    && canonicalRef(value.visibilityPolicyRef) && spatialVisibilityPolicyKind(value.visibilityPolicyRef) !== undefined;
}
export function isNpcMaterializedPayload(value: unknown): value is NpcMaterializedPayload {
  return isRecord(value) && hasExactKeys(value, ["actorCharacterId", "plan"])
    && canonicalRef(value.actorCharacterId) && isNpcMaterializationPlan(value.plan);
}
function isInput(value: unknown): value is NpcMaterializationInput {
  return isRecord(value) && hasExactKeys(value, ["kind", "rootActionId", "actorCharacterId", "plan"])
    && value.kind === "materializeNpc" && canonicalRef(value.rootActionId)
    && canonicalRef(value.actorCharacterId) && isNpcMaterializationPlan(value.plan);
}
export function npcMaterializationDefinitionRefs(rootActionId: string, prospectiveRef: string) {
  const suffix = canonicalSha256({ schema: NPC_MATERIALIZATION_PLAN_SCHEMA, rootActionId, prospectiveRef }).slice(7);
  return { semanticDefinitionRef: `definition:npc-identity:${suffix}`, mechanicalDefinitionRef: `definition:npc-mechanics:${suffix}` };
}

export type DerivedNpcMaterialization = Readonly<{
  kind: "derived";
  character: CharacterRecord;
  combatEntity: JsonRecord;
  semanticDefinition: StoredSemanticDefinition;
  mechanicalDefinition: JsonRecord;
  equipmentDefinitions: readonly JsonRecord[];
  itemSystem: ItemSystemStateV1;
  sourceTimelineId: string;
  reads: readonly string[];
  createdAuthorityRefs: readonly string[];
  creates: readonly string[];
}>;
function identityExists(state: AuthoritativeWorldState, ref: string): boolean {
  return authorityRevisionOrHash(state, ref) !== null || Object.hasOwn(state.combatRuntime.entities, ref)
    || Object.hasOwn(state.knowledge, ref) || Object.hasOwn(state.characterControls, ref)
    || Object.hasOwn(state.multiplayerRuntime.characterTimelineIds, ref);
}
/** Existing Ability/Item definitions are never copied into the source as
 * authority. The same closed catalog and frozen reads prove their identity. */
function mechanicalReadRefs(state: AuthoritativeWorldState, template: NpcMaterializationMechanicalTemplate): string[] | undefined {
  const refs = new Set<string>();
  const pending = [...template.intrinsicAbilityRefs, ...template.itemDefinitionRefs];
  const catalog = { ...state.combatRuntime.definitions, ...state.campaignRuntime.itemSystem.definitions };
  while (pending.length > 0) {
    const ref = pending.pop()!;
    if (refs.has(ref)) continue;
    if (refs.size >= 128 || authorityRevisionOrHash(state, ref) === null) return undefined;
    refs.add(ref);
    const definition = catalog[ref];
    if (isItemDefinitionV1(definition)) {
      pending.push(...definition.content.equippedAbilityRefs);
      if (definition.content.use !== null) pending.push(definition.content.use.abilityRef);
      const ammo = definition.content.equipment?.weapon?.ammunitionDefinitionRef;
      if (ammo !== null && ammo !== undefined && catalog[ammo] !== undefined) pending.push(ammo);
    } else if (isRegisteredAbilityRecord(definition)) {
      // Executable definition dependencies have their own identity. Resource
      // pool names are validated by npcMechanicalDefinitionClosureValid.
      for (const dependency of definition.referenceClosure as string[]) {
        if (catalog[dependency] !== undefined) pending.push(dependency);
      }
    } else return undefined;
  }
  return [...refs].sort();
}
export function deriveNpcMaterialization(state: AuthoritativeWorldState, input: unknown): DerivedNpcMaterialization | RejectedRulesResult {
  if (!isInput(input)) return rejected("invalidRulesInput", "npc-materialization:noncanonical-source-or-plan");
  const { plan, actorCharacterId, rootActionId } = input;
  const actor = state.entities[actorCharacterId];
  const sourceTimelineId = characterTimelineId(state, actorCharacterId);
  if (actor?.tenureStatus !== "active" || actor.sceneId !== plan.sceneRef || state.scenes[plan.sceneRef] === undefined
    || sourceTimelineId === undefined || !isCanonicalTacticalGeometry(state.combatRuntime.scenes[plan.sceneRef]?.geometry)) {
    return rejected("privateOrUnknownReference", "npc-materialization:current-scene-and-timeline-required");
  }
  const pinRef = `profile-context:${String(state.campaignRuntime.campaign?.moduleRef.profileId)}`;
  if (!plan.authorizationRefs.includes(pinRef) || !plan.basisRefs.includes(plan.sceneRef)) {
    return rejected("privateOrUnknownReference", "npc-materialization:frozen-module-and-scene-authorization-required");
  }
  if (!authorityReadSetMatches(state, plan.readSet)) return rejected("causalFrontierConflict", "npc-materialization:frozen-reads-changed");
  const dependencies = mechanicalReadRefs(state, plan.source.mechanicalTemplate);
  if (dependencies === undefined) return rejected("privateOrUnknownReference", "npc-materialization:mechanical-definition-unavailable");
  const reads = [...new Set([actorCharacterId, plan.sceneRef, `character-timeline:${actorCharacterId}`,
    ...plan.basisRefs, ...plan.authorizationRefs, ...dependencies])].sort();
  if (reads.some(ref => authorityRevisionOrHash(state, ref) === null)) {
    return rejected("privateOrUnknownReference", "npc-materialization:source-or-authorization-unavailable");
  }
  if (reads.some(ref => !plan.readSet.some(binding => binding.ref === ref))) {
    return rejected("causalFrontierConflict", "npc-materialization:complete-frozen-source-bindings-required");
  }
  const refs = npcMaterializationDefinitionRefs(rootActionId, plan.prospectiveRef);
  if ([plan.prospectiveRef, refs.semanticDefinitionRef, refs.mechanicalDefinitionRef].some(ref => identityExists(state, ref))) {
    return rejected("invalidRulesInput", "npc-materialization:new-identity-required");
  }
  const source = plan.source;
  const definition = mechanicalDefinition(source, refs.mechanicalDefinitionRef, plan.basisRefs);
  const catalog = { ...state.combatRuntime.definitions, ...state.campaignRuntime.itemSystem.definitions };
  if (!npcMechanicalDefinitionClosureValid(definition, catalog)) {
    return rejected("privateOrUnknownReference", "npc-materialization:mechanical-loadout-or-resource-closure-invalid");
  }
  const ordinal = Object.values(state.entities).reduce((max, entity) => {
    const current = BigInt(entity.entityOrdinal); return current > max ? current : max;
  }, 0n) + 1n;
  const character: CharacterRecord = { id: plan.prospectiveRef, kind: "npc", name: source.name, sceneId: plan.sceneRef,
    tenureStatus: "active", entityOrdinal: ordinal.toString(),
    semanticDefinitionRef: refs.semanticDefinitionRef, semanticDefinitionRevision: "1",
    abilityScores: structuredClone(source.socialMechanics.abilityScores), proficiencyBonus: source.socialMechanics.proficiencyBonus,
    socialMechanics: structuredClone(source.socialMechanics),
    hitPoints: { current: Number(source.mechanicalTemplate.hitPointsMaximum), maximum: Number(source.mechanicalTemplate.hitPointsMaximum) },
    resources: Object.fromEntries(Object.entries(source.mechanicalTemplate.resourceMaximums).map(([ref, amount]) => [ref, Number(amount)])),
    resourceMaximums: Object.fromEntries(Object.entries(source.mechanicalTemplate.resourceMaximums).map(([ref, amount]) => [ref, Number(amount)])) };
  const itemPlan = planNpcInitialItemImport({ itemSystem: state.campaignRuntime.itemSystem, character, definition, catalog, sceneId: plan.sceneRef });
  if ("error" in itemPlan) return rejected("invalidRulesInput", `npc-materialization:${itemPlan.error}`);
  character.loadout = itemPlan.finalLoadout;
  const equipment = npcItemSystemEquipmentMechanics(character, itemPlan.finalItemSystem, catalog);
  const equipmentDefinitions: JsonRecord[] = [];
  for (const equipmentDefinition of equipment.definitions) {
    const compiled = compileAbilityDefinition(equipmentDefinition);
    if (!compiled.ok) return rejected(compiled.code, compiled.publicMessage);
    const registered = registeredAbilityRecord(compiled.artifact);
    const ref = String(equipmentDefinition.definitionId);
    const existing = catalog[ref];
    if (existing !== undefined || identityExists(state, ref)) return rejected("invalidRulesInput", "npc-materialization:equipment-definition-identity-conflict");
    catalog[ref] = registered;
    equipmentDefinitions.push(registered);
  }
  const entity = instantiateNpcMechanicalEntity({ definition, catalog, itemSystem: itemPlan.finalItemSystem,
    entityId: character.id, name: source.name, sceneId: plan.sceneRef, position: structuredClone(source.position), loadout: character.loadout });
  if (entity === undefined) return rejected("invalidRulesInput", "npc-materialization:mechanical-instantiation-failed");
  entity.entityOrdinal = character.entityOrdinal;
  entity.visibilityPolicyId = plan.visibilityPolicyRef;
  synchronizeCombatItemResources(entity, itemPlan.finalItemSystem);
  if (!npcCoreMechanicsCompatible(character, entity)
    || !npcMechanicalEntityMatchesTemplate(entity, definition, catalog, character, itemPlan.finalItemSystem)) {
    return rejected("invalidRulesInput", "npc-materialization:core-social-and-combat-mechanics-conflict");
  }
  if (Object.values(state.combatRuntime.entities).some(other => other.sceneId === plan.sceneRef
    && other.lifeState !== "dead" && entityOccupanciesOverlap(entity, other))) {
    return rejected("spatialCapacityUnavailable", "npc-materialization:occupied-placement");
  }
  const identity = storedSemanticDefinition("npc", `visibility:npc:${character.id}`,
    createDefinitionSnapshot(refs.semanticDefinitionRef, "1", {
      label: source.name, description: `${source.description}\n\n${source.background}`,
      links: { entityRef: character.id }, semantics: {
        goals: source.goals.map((description, index) => ({ goalRef: `goal:${character.id}:${index + 1}`, description })),
        behavioralConstraints: [...source.behavioralConstraints], initialUnknowns: [...source.initialUnknowns],
        voice: source.voice, plans: [],
      },
    }));
  const itemDefinitionRefs = Object.keys(itemPlan.finalItemSystem.definitions)
    .filter(ref => state.campaignRuntime.itemSystem.definitions[ref] === undefined).sort();
  const itemEntryRefs = Object.keys(itemPlan.finalItemSystem.entries)
    .filter(ref => state.campaignRuntime.itemSystem.entries[ref] === undefined).sort();
  if ([...itemDefinitionRefs, ...itemEntryRefs].some(ref => identityExists(state, ref))) {
    return rejected("invalidRulesInput", "npc-materialization:item-identity-conflict");
  }
  const abilityRefs = equipmentDefinitions.map(entry => String(entry.definitionId));
  return { kind: "derived", character, combatEntity: entity, semanticDefinition: identity, mechanicalDefinition: definition,
    equipmentDefinitions, itemSystem: itemPlan.finalItemSystem, sourceTimelineId, reads,
    createdAuthorityRefs: [character.id, refs.semanticDefinitionRef, refs.mechanicalDefinitionRef,
      ...itemDefinitionRefs, ...itemEntryRefs, ...abilityRefs].sort(),
    creates: [`entity:${character.id}`, `knowledge:${character.id}`, `character-timeline:${character.id}`,
      ...[refs.semanticDefinitionRef, refs.mechanicalDefinitionRef, ...abilityRefs].map(ref => `definition:${ref}`),
      ...itemDefinitionRefs.map(ref => `item-definition:${ref}`), ...itemEntryRefs.map(ref => `item-entry:${ref}`)].sort() };
}

type NpcMaterializedEvent = Pick<EventEnvelope, "roomId" | "runtimeEpochId" | "branchId" | "rootActionId" | "profiles"
  | "fictionTimelineId" | "fictionInstantMicros" | "visibilityPolicyId" | "secrecy"> & {
  eventType: "NpcMaterialized";
  payload: NpcMaterializedPayload;
};
function enabled(profiles: RuntimeProfileManifest): boolean {
  return worldInteractionProfileEnabled(profiles.extensions) && npcMechanicsProfileEnabled(profiles.extensions)
    && itemSystemProfileEnabled(profiles.extensions) && socialResolutionProfileEnabled(profiles.extensions);
}
/** Replay receives only the sealed authoring decision and derives the exact
 * same additions. No materialized entity, gear or knowledge patch is trusted. */
export function applyNpcMaterializedEvent(state: AuthoritativeWorldState, event: NpcMaterializedEvent): void {
  if (event.eventType !== "NpcMaterialized" || !isNpcMaterializedPayload(event.payload) || !enabled(event.profiles)
    || event.roomId !== state.roomId || event.runtimeEpochId !== state.runtimeEpochId || event.branchId !== state.activeBranchId
    || event.visibilityPolicyId !== "visibility:room-authority-only" || event.secrecy !== "internal") {
    throw new TypeError("npc-materialization:event-source-or-authority-invalid");
  }
  const result = deriveNpcMaterialization(state, { kind: "materializeNpc", rootActionId: event.rootActionId, ...event.payload });
  if (result.kind === "rejected") throw new TypeError(result.rejection.message);
  if (event.fictionTimelineId !== result.sourceTimelineId
    || event.fictionInstantMicros !== state.fictionTimelines[result.sourceTimelineId].nowMicros) {
    throw new TypeError("npc-materialization:event-timeline-conflict");
  }
  state.entities[result.character.id] = structuredClone(result.character);
  state.combatRuntime.entities[result.character.id] = structuredClone(result.combatEntity);
  state.knowledge[result.character.id] = {};
  state.multiplayerRuntime.characterTimelineIds[result.character.id] = result.sourceTimelineId;
  state.campaignRuntime.itemSystem = structuredClone(result.itemSystem);
  state.campaignRuntime.definitions[result.semanticDefinition.definitionId] = structuredClone(result.semanticDefinition);
  for (const definition of [result.mechanicalDefinition, ...result.equipmentDefinitions]) {
    const id = String(definition.definitionId);
    state.campaignRuntime.definitions[id] = structuredClone(definition);
    state.combatRuntime.definitions[id] = structuredClone(definition);
  }
}

/** Structural subset of the existing atomic accumulator, so the owning
 * interpreter keeps its candidate folding, Receipt and scope accounting. */
export type NpcMaterializationAccumulator = {
  state: AuthoritativeWorldState;
  events: EventEnvelope[];
  scopeProof?: ScopeProof;
  source?: AuthoritativeWorldState;
  candidate?: boolean;
  transactionReads?: Set<string>;
  transactionWrites?: Set<string>;
  transactionCreates?: Set<string>;
  transactionCreatedAuthorityRefs?: Set<string>;
};
export type NpcMaterializationDraft = {
  eventType: "NpcMaterialized";
  payload: NpcMaterializedPayload;
  reads: string[];
  writes: string[];
  creates: string[];
  visibilityPolicyId: string;
  secrecy: "internal";
};
export type NpcMaterializationStepOptions = Readonly<{
  accumulator?: NpcMaterializationAccumulator;
  skipDuplicateCheck?: boolean;
  appendTransition?: (accumulator: NpcMaterializationAccumulator, profiles: RuntimeProfileManifest,
    rootActionId: string, draft: NpcMaterializationDraft) => void;
}>;
export function stepMaterializeNpc(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  input: unknown, options?: NpcMaterializationStepOptions): StepResult {
  if (!enabled(profiles)) return rejected("unsupportedOperation", "npc-materialization:required-runtime-profiles-unavailable");
  if (!isInput(input)) return rejected("invalidRulesInput", "npc-materialization:noncanonical-source-or-plan");
  const accumulator: NpcMaterializationAccumulator = options?.accumulator ?? { state, events: [] };
  if (!options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) {
    return rejected("duplicateRootAction", "npc-materialization:root-already-committed");
  }
  const derived = deriveNpcMaterialization(accumulator.state, input);
  if (derived.kind === "rejected") return derived;
  if (options?.appendTransition === undefined) return rejected("unsupportedOperation", "npc-materialization:authority-transition-port-required");
  options.appendTransition(accumulator, profiles, input.rootActionId, { eventType: "NpcMaterialized",
    payload: { actorCharacterId: input.actorCharacterId, plan: structuredClone(input.plan) },
    reads: [...derived.reads], writes: [`receipt:${input.rootActionId}`], creates: [...derived.creates],
    visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
  derived.createdAuthorityRefs.forEach(ref => accumulator.transactionCreatedAuthorityRefs?.add(ref));
  return { kind: "committed", events: accumulator.events, state: accumulator.state, cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter, scopeProof: accumulator.scopeProof!,
    receipt: accumulator.state.receipts[input.rootActionId]!,
    mechanicalResult: { kind: "materializeNpc", entityRef: input.plan.prospectiveRef } };
}
