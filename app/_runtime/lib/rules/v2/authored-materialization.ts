import { uniqueItemEntryRef } from "./item-authority-vnext";
import { GEAR_SLOTS } from "../../dnd/gear";
import { compileAbilityDefinition, type AbilityCompileFailureCode, type CompiledAbilityArtifact } from "../profiles/ability-compiler";
import { canonicalSha256 } from "../profiles/canonical";
import { isEnvironmentHazardDefinition } from "./environment-hazards";
import { ENVIRONMENT_HAZARD_SCHEMA } from "./environment-hazard-schema";
import { createInitialItemEntry, isItemDefinitionV1, itemDefinitionContentDiagnostics, type ItemDefinitionContentV1, type ItemDefinitionV1, type ItemEntryV1, type ItemOwnership } from "./items";
import type { JsonRecord } from "./model";
import { normalizedProspectiveRef } from "./semantic-definitions";

/** Closed authored source grammar, shared by local validation and the provider schema.
 * No authority IDs, compiled nodes, state patches or executable payloads are authorable. */
export type AuthoredSourceSchema = {
  description?: string;
  type?: string; enum?: readonly unknown[]; pattern?: string; minimum?: number; maximum?: number;
  anyOf?: readonly AuthoredSourceSchema[]; properties?: Record<string, AuthoredSourceSchema>;
  required?: readonly string[]; additionalProperties?: false; items?: AuthoredSourceSchema;
};
const object = (properties: Record<string, AuthoredSourceSchema>): AuthoredSourceSchema => ({ type: "object", properties, required: Object.keys(properties).sort(), additionalProperties: false });
const str: AuthoredSourceSchema = { type: "string", pattern: "[\\s\\S]+" };
const ref: AuthoredSourceSchema = { type: "string", pattern: "^\\S+$" };
const bool: AuthoredSourceSchema = { type: "boolean" };
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): AuthoredSourceSchema => ({ type: "integer", minimum, maximum });
const values = (...entries: string[]): AuthoredSourceSchema => ({ type: "string", enum: entries });
const array = (items: AuthoredSourceSchema): AuthoredSourceSchema => ({ type: "array", items });
const nullable = (schema: AuthoredSourceSchema): AuthoredSourceSchema => ({ anyOf: [schema, { type: "null" }] });
const uint: AuthoredSourceSchema = { type: "string", pattern: "^(0|[1-9][0-9]*)$" };
const positive: AuthoredSourceSchema = { type: "string", pattern: "^[1-9][0-9]*$" };
const ability = values("str", "dex", "con", "int", "wis", "cha");
const damageType = values("acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder");
const slot = values(...GEAR_SLOTS.map(({ id }) => id));
const duration: AuthoredSourceSchema = { anyOf: [
  object({ kind: values("timed"), durationMicros: positive }),
  object({ kind: values("untilEnded") }),
  object({ kind: values("turnBoundary"), subject: values("source", "target"), edge: values("turnStart", "turnEnd") }),
] };
const effectVariants = [
  object({ kind: values("endEffect"), condition: values("blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"), sourceRef: nullable(ref) }),
  object({ kind: values("fixedDamage"), amount: integer(), damageType }),
  object({ kind: values("grantEffect"), condition: values("blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"), duration }),
  object({ kind: values("grantEffect"), condition: values("exhaustion"), duration, level: integer(1, 6) }),
  object({ kind: values("concentration"), durationMicros: nullable(positive) }),
  object({ kind: values("shield"), armorClassBonus: values("5"), duration: values("untilOwnNextTurnStart"), magicMissileImmunity: { type: "boolean", enum: [true] } }),
  object({ kind: values("counterspell"), rangeInches: values("720") }),
];
export const AUTHORED_ABILITY_SOURCE_SCHEMA = object({
  label: str, description: str, aliases: array(str), tags: array(str),
  activation: { anyOf: [
    object({ kind: values("action", "bonusAction", "reaction", "free", "nonCombatHazard") }),
    object({ kind: values("attack"), actionGrant: values("attack") }),
    object({ kind: values("useObject"), actionGrant: values("normalAction") }),
    object({ kind: values("actionSpell", "bonusActionSpell", "reactionSpell"), spellLevel: uint }),
  ] },
  target: { anyOf: [
    object({ kind: values("creature", "creatureOrEnvironmentFeature"), count: positive, rangeInches: uint, requiresSight: bool }),
    object({ kind: values("creature", "creatureOrEnvironmentFeature"), count: positive, reachInches: positive, requiresSight: bool }),
    object({ kind: values("area"), rangeInches: uint, shape: { anyOf: [
      object({ kind: values("sphere"), radiusInches: positive, propagation: values("straight") }),
      object({ kind: values("cube"), edgeInches: positive, propagation: values("straight") }),
      object({ kind: values("cone"), lengthInches: positive, propagation: values("straight") }),
      object({ kind: values("line"), lengthInches: positive, widthInches: positive, propagation: values("straight") }),
      object({ kind: values("cylinder"), radiusInches: positive, heightInches: positive, propagation: values("straight") }),
    ] } }),
  ] },
  attack: { anyOf: [
    object({ kind: values("fixed"), bonus: { type: "string", pattern: "^(0|-?[1-9][0-9]*)$" } }),
    object({ ability, proficiency: bool }), object({ kind: values("spellAttack") }), { type: "null" },
  ] },
  save: nullable(object({ ability, dc: integer(), halfOnSuccess: bool })),
  damage: array(object({ formula: str, type: damageType, sharedAcrossTargets: bool })),
  healing: nullable(object({ formula: str })), temporaryHitPoints: nullable(object({ formula: str })),
  effect: { anyOf: [...effectVariants, { type: "null" }] }, effects: array({ anyOf: effectVariants }),
  costs: array({ anyOf: [
    object({ kind: values("item", "classResource"), resourceId: ref, amount: positive }),
    object({ kind: values("spellSlot"), level: positive, amount: positive }),
  ] }),
  grants: array(object({ kind: values("normalAction"), count: positive })),
});
export const AUTHORED_HAZARD_CONTENT_SCHEMA = object({
  schema: values(ENVIRONMENT_HAZARD_SCHEMA), label: str,
  trigger: object({ kind: values("enterZone", "contactFeature", "disturbFeature"), ref }),
  perceptibleSigns: array(str), disableMethods: array(str), environmentalConsequences: array(str), mechanicsRef: ref,
});
export const AUTHORED_ITEM_CONTENT_SCHEMA = object({
  schema: values("zhuwei.item-definition-content/v1"), label: str, description: str,
  category: values("weapon", "armor", "shield", "ammunition", "consumable", "tool", "currency", "equipment", "object"),
  aliases: array(str), tags: array(str), stackable: bool,
  equipment: nullable(object({ allowedSlots: array(slot), twoHanded: bool,
    armor: nullable(object({ kind: values("light", "medium", "heavy", "shield"), acBase: nullable(integer()), acDexCap: nullable(integer()) })),
    weapon: nullable(object({ attackAbility: values("str", "dex", "finesse"), ammunitionDefinitionRef: nullable(ref), damageDice: str, damageType,
      reachInches: nullable(positive), rangeNormalInches: nullable(positive), rangeLongInches: nullable(positive), requiresSight: bool })),
  })),
  equippedAbilityRefs: array(ref),
  use: nullable(object({ kind: values("useObject"), abilityRef: ref, quantityCost: integer(), chargeCost: integer(), durabilityCost: integer() })),
  chargesMaximum: nullable(integer(1)), durabilityMaximum: nullable(integer(1)),
});
export const AUTHORED_ITEM_OWNERSHIP_SCHEMA: AuthoredSourceSchema = { anyOf: [
  object({ kind: values("unowned"), ownerRef: { type: "null" } }),
  object({ kind: values("character", "party", "faction"), ownerRef: ref }),
] };
export type AuthoredAbilitySource = JsonRecord;
export type EnvironmentHazardContent = JsonRecord;
export type AuthoredDefinitionSource =
  | { kind: "ability"; content: AuthoredAbilitySource }
  | { kind: "hazard"; content: EnvironmentHazardContent }
  | { kind: "item"; content: ItemDefinitionContentV1 };
type CommonPlan = Readonly<{
  bundleHash: string; handle: string; contextHash: string;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  basisRefs: readonly string[]; sourceRefs: readonly string[]; visibilityPolicyRef: string; summary: string;
}>;
export type AuthoredDefinitionMaterializationPlan = CommonPlan & Readonly<{
  schema: "zhuwei.authored-definition-materialization-plan/vnext-1"; source: AuthoredDefinitionSource;
  /** Canonical facts selected by the trusted lowerer; spatial/actor provenance stays in basisRefs. */
  causalBasisRefs: readonly string[];
}>;
export type AuthoredItemMaterializationPlan = CommonPlan & Readonly<{
  schema: "zhuwei.authored-item-materialization-plan/vnext-1"; definitionRef: string; sceneRef: string;
  quantity: number; ownership: ItemOwnership; uniquenessBasisRef?: string;
}>;
export type MaterializedAuthoredDefinition = Readonly<{
  prospectiveRef: string; definitionRef: string; definitionHash: string;
  kind: "abilityDefinition" | "hazardDefinition" | "itemDefinition";
  definition: JsonRecord | ItemDefinitionV1; artifact?: CompiledAbilityArtifact;
}>;
export type MaterializedAuthoredItem = Readonly<{ prospectiveRef: string; entryRef: string; entryHash: string; entry: ItemEntryV1 }>;

export function matchesAuthoredSourceSchema(value: unknown, schema: AuthoredSourceSchema,
  diagnostics?: AuthoredSourceDiagnostic[]): boolean {
  if (diagnostics !== undefined) {
    const matches = matchesAuthoredSourceSchema(value, schema);
    if (!matches) diagnostics.push(...sourceSchemaDiagnostics(value, schema, ""));
    return matches;
  }
  if (schema.anyOf) return schema.anyOf.some((branch) => matchesAuthoredSourceSchema(value, branch));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "string") return typeof value === "string" && value.length <= 4000 && value.normalize("NFC") === value && (!schema.pattern || new RegExp(schema.pattern, "u").test(value));
  if (schema.type === "integer") return Number.isSafeInteger(value) && Number(value) >= (schema.minimum ?? -Infinity) && Number(value) <= (schema.maximum ?? Infinity);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array") return Array.isArray(value) && value.length <= 64 && value.every((entry) => matchesAuthoredSourceSchema(entry, schema.items!));
  if (!record(value) || !schema.properties || !exact(value, Object.keys(schema.properties))) return false;
  return Object.entries(schema.properties).every(([key, child]) => matchesAuthoredSourceSchema(value[key], child));
}
export type AuthoredDefinitionSourceValidation =
  | { ok: true; source: AuthoredDefinitionSource }
  | { ok: false; code: AbilityCompileFailureCode; diagnostics: AuthoredSourceDiagnostic[] };

export type AuthoredSourceDiagnostic = {
  path: string;
  reason: string;
  code?: "FIELD_MISSING" | "TYPE_MISMATCH" | "VALUE_INVALID" | "CONSTRAINT_CONFLICT";
  expected?: Readonly<Record<string, unknown>>;
};

const authoredSourceSchema: AuthoredSourceSchema = { anyOf: [
  object({ kind: values("ability"), content: AUTHORED_ABILITY_SOURCE_SCHEMA }),
  object({ kind: values("hazard"), content: AUTHORED_HAZARD_CONTENT_SCHEMA }),
  object({ kind: values("item"), content: AUTHORED_ITEM_CONTENT_SCHEMA }),
] };
const pointerPart = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");

/** Reasons describe the contract, never a submitted value or resolved authority record. */
function sourceSchemaDiagnostics(value: unknown, schema: AuthoredSourceSchema, path: string): AuthoredSourceDiagnostic[] {
  if (matchesAuthoredSourceSchema(value, schema)) return [];
  const invalid = (reason: string): AuthoredSourceDiagnostic[] => [{ path, reason,
    code: sourceDiagnosticTypeMatches(value, schema) ? "VALUE_INVALID" : "TYPE_MISMATCH",
    expected: sourceDiagnosticExpected(schema) }];
  if (schema.anyOf) {
    const branches = schema.anyOf;
    if (record(value)) {
      const tagged = branches.filter(branch => branch.properties?.kind?.enum !== undefined);
      if (tagged.length > 0 && Object.hasOwn(value, "kind")) {
        const matching = tagged.filter(branch => branch.properties!.kind!.enum!.includes(value.kind));
        if (matching.length === 1) return sourceSchemaDiagnostics(value, matching[0]!, path);
        if (matching.length === 0) {
          const alternatives = tagged.map(branch => branch.properties!.kind!);
          return [{ path: `${path}/kind`, reason: "kind is not supported by this authored source field",
            code: alternatives.some(alternative => sourceDiagnosticTypeMatches(value.kind, alternative)) ? "VALUE_INVALID" : "TYPE_MISMATCH",
            expected: { anyOf: alternatives.map(sourceDiagnosticExpected) } }];
        }
        return matching.map(branch => sourceSchemaDiagnostics(value, branch, path)).sort((a, b) => a.length - b.length)[0]!;
      }
    }
    const matchingType = branches.filter(branch => branch.type === (value === null ? "null" : Array.isArray(value) ? "array" : typeof value));
    const candidates = matchingType.length > 0 ? matchingType : branches;
    const diagnostics = candidates.map(branch => sourceSchemaDiagnostics(value, branch, path)).sort((a, b) => a.length - b.length)[0]!;
    // A value matching none of the alternatives' types must not be told that
    // the selected diagnostic branch is the only allowed alternative.
    return branches.every(branch => branch.type !== undefined && !sourceDiagnosticTypeMatches(value, branch))
      ? diagnostics.map(diagnostic => diagnostic.path === path ? { ...diagnostic, code: "TYPE_MISMATCH" as const,
        expected: { anyOf: branches.map(sourceDiagnosticExpected) } } : diagnostic)
      : diagnostics;
  }
  if (schema.enum) return invalid("value is not one of the supported authored alternatives");
  if (schema.type === "string") return invalid("expected nonempty canonical NFC text within 4000 characters matching the field grammar");
  if (schema.type === "integer") return invalid("expected a safe integer within the field bounds");
  if (schema.type === "boolean" || schema.type === "null") return invalid(`expected ${schema.type}`);
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > 64) return invalid("expected an array with at most 64 entries");
    return value.flatMap((entry, index) => sourceSchemaDiagnostics(entry, schema.items!, `${path}/${index}`));
  }
  if (!record(value) || !schema.properties) return invalid("expected an authored source object");
  const diagnostics: AuthoredSourceDiagnostic[] = Object.keys(value).filter(key => !Object.hasOwn(schema.properties!, key))
    .map(key => ({ path: `${path}/${pointerPart(key)}`, reason: "field is not authorable in this source grammar",
      code: "VALUE_INVALID", expected: { allowedFields: Object.keys(schema.properties!).sort() } }));
  for (const [key, child] of Object.entries(schema.properties)) {
    const childPath = `${path}/${pointerPart(key)}`;
    diagnostics.push(...(Object.hasOwn(value, key) ? sourceSchemaDiagnostics(value[key], child, childPath)
      : [{ path: childPath, reason: "required authored source field is missing", code: "FIELD_MISSING" as const,
        expected: { required: true, ...sourceDiagnosticExpected(child) } }]));
  }
  return diagnostics;
}

/** Diagnostic metadata only, after the shared matcher has already rejected.
 * These helpers neither accept input nor infer types from human explanations. */
function sourceDiagnosticTypeMatches(value: unknown, schema: AuthoredSourceSchema): boolean {
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  return schema.type === undefined || actualType === schema.type || (schema.type === "integer" && actualType === "number");
}

function sourceDiagnosticExpected(schema: AuthoredSourceSchema): Readonly<Record<string, unknown>> {
  return {
    ...(schema.anyOf === undefined ? {} : { anyOf: schema.anyOf.map(sourceDiagnosticExpected) }),
    ...(schema.type === undefined ? {} : { type: schema.type }),
    ...(schema.enum === undefined ? {} : { enum: [...schema.enum] }),
    ...(schema.pattern === undefined ? {} : { pattern: schema.pattern }),
    ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
    ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
    ...(schema.type === "string" ? { maxLength: 4000, normalization: "NFC" } : {}),
    ...(schema.type === "integer" ? { safeInteger: true } : {}),
    ...(schema.type === "array" ? { maxItems: 64 } : {}),
    ...(schema.properties === undefined ? {} : { requiredFields: Object.keys(schema.properties).sort(), additionalProperties: false }),
  };
}

/** The boolean guards, Provider validation and Rules rejection use this one diagnostic source. */
export function validateAuthoredDefinitionSource(value: unknown): AuthoredDefinitionSourceValidation {
  const diagnostics = sourceSchemaDiagnostics(value, authoredSourceSchema, "/source");
  if (diagnostics.length > 0) return { ok: false, code: "invalidAbilityDefinition", diagnostics };
  const source = value as AuthoredDefinitionSource;
  const envelope = { definitionId: "definition:validation", revision: "1", rulesBasis: "srd5.1-2014", causalBasisRefs: [], visibilityPolicyRef: "visibility:public",
    content: source.kind === "item" ? canonicalAuthoredItemContent(source.content) : source.content };
  if (source.kind === "hazard") return isEnvironmentHazardDefinition({ ...envelope, definitionKind: "environmentHazard" })
    ? { ok: true, source }
    : { ok: false, code: "invalidAbilityDefinition", diagnostics: [{ path: "/source/content", reason: "hazards require bounded labels, perceptible signs, and disable methods" }] };
  if (source.kind === "item") {
    const itemDiagnostics = itemDefinitionContentDiagnostics(envelope.content);
    return itemDiagnostics.length === 0 ? { ok: true, source }
      : { ok: false, code: "invalidAbilityDefinition", diagnostics: itemDiagnostics.map(diagnostic => ({ ...diagnostic, path: `/source${diagnostic.path}` })) };
  }
  const content = source.content;
  if (![content.attack, content.save, content.healing, content.temporaryHitPoints, content.effect].some((entry) => entry !== null)
    && ![content.damage, content.effects, content.grants].some((entry) => Array.isArray(entry) && entry.length > 0)) return {
      ok: false, code: "unsupportedMechanicPrimitive", diagnostics: [{ path: "/source/content", reason: "an authored ability must contain an executable mechanic" }],
    };
  // Item costs can cite a same-bundle instance; the final compiler checks the resolved authority ref.
  const definition = abilityDefinition("definition:validation", content);
  const costs = definition.costs as JsonRecord[] | undefined;
  if (costs) definition.costs = costs.map((cost) => cost.kind === "item" && String(cost.resourceId).startsWith("prospective:") ? { ...cost, resourceId: "item-entry:validation" } : cost);
  const compiled = compileAbilityDefinition(definition);
  return compiled.ok ? { ok: true, source } : { ok: false, code: compiled.code,
    diagnostics: compiled.diagnostics.map(diagnostic => ({ reason: diagnostic.reason,
      path: `/source/content/${diagnostic.path.replace(/^\/+/, "")}`.replace(/\/$/, "") })) };
}
export function isAuthoredDefinitionSource(value: unknown): value is AuthoredDefinitionSource {
  return validateAuthoredDefinitionSource(value).ok;
}
export function isAuthoredDefinitionMaterializationPlan(value: unknown): value is AuthoredDefinitionMaterializationPlan {
  return common(value, ["source", "causalBasisRefs"]) && value.schema === "zhuwei.authored-definition-materialization-plan/vnext-1"
    && Array.isArray(value.causalBasisRefs) && matchesAuthoredSourceSchema(value.causalBasisRefs, array(ref))
    && value.causalBasisRefs.every((ref) => (value.basisRefs as string[]).includes(ref))
    && isAuthoredDefinitionSource(value.source);
}
export function isAuthoredItemMaterializationPlan(value: unknown): value is AuthoredItemMaterializationPlan {
  return common(value, ["definitionRef", "sceneRef", "quantity", "ownership", ...(record(value) && value.uniquenessBasisRef !== undefined ? ["uniquenessBasisRef"] : [])])
    && value.schema === "zhuwei.authored-item-materialization-plan/vnext-1"
    && (value.uniquenessBasisRef === undefined || (matchesAuthoredSourceSchema(value.uniquenessBasisRef, ref) && value.quantity === 1))
    && matchesAuthoredSourceSchema(value.definitionRef, ref) && matchesAuthoredSourceSchema(value.sceneRef, ref)
    && matchesAuthoredSourceSchema(value.quantity, integer(1)) && matchesAuthoredSourceSchema(value.ownership, AUTHORED_ITEM_OWNERSHIP_SCHEMA);
}
export function materializedAuthoredDefinition(rootActionId: string, plan: AuthoredDefinitionMaterializationPlan): MaterializedAuthoredDefinition | undefined {
  if (!isAuthoredDefinitionMaterializationPlan(plan)) return undefined;
  const prospectiveRef = normalizedProspectiveRef(rootActionId, plan.bundleHash, plan.handle);
  const definitionRef = `authored-definition:${plan.source.kind}:${canonicalSha256({ rootActionId, bundleHash: plan.bundleHash, prospectiveRef }).slice(7, 39)}`;
  if (plan.source.kind === "ability") {
    const compiled = compileAbilityDefinition({ ...abilityDefinition(definitionRef, plan.source.content), causalBasisRefs: [...plan.causalBasisRefs], visibilityPolicyRef: plan.visibilityPolicyRef });
    if (!compiled.ok) return undefined;
    return { prospectiveRef, definitionRef, definitionHash: compiled.artifact.definitionHash, definition: compiled.artifact.definition, artifact: compiled.artifact, kind: "abilityDefinition" };
  }
  const definition = { ...(plan.source.kind === "item" ? { schema: "zhuwei.item-definition/v1" as const } : {}), definitionId: definitionRef,
    definitionKind: plan.source.kind === "item" ? "item" : "environmentHazard", revision: "1", rulesBasis: "srd5.1-2014",
    causalBasisRefs: [...plan.causalBasisRefs], visibilityPolicyRef: plan.visibilityPolicyRef,
    content: plan.source.kind === "item" ? canonicalAuthoredItemContent(plan.source.content) : structuredClone(plan.source.content) };
  if (!(plan.source.kind === "item" ? isItemDefinitionV1(definition) : isEnvironmentHazardDefinition(definition))) return undefined;
  return { prospectiveRef, definitionRef, definitionHash: canonicalSha256(definition), definition: definition as JsonRecord,
    kind: plan.source.kind === "item" ? "itemDefinition" : "hazardDefinition" };
}

/** These are sets in the Item contract. Their presentation order on the
 * model wire is immaterial; canonicalize before validation and hashing.
 * Duplicates are retained so the Item validator still rejects them. */
function canonicalAuthoredItemContent(source: JsonRecord): JsonRecord {
  const content=structuredClone(source);
  for(const key of ["aliases","tags","equippedAbilityRefs"]) {
    if(Array.isArray(content[key]))content[key]=[...content[key]].sort();
  }
  if(record(content.equipment)&&Array.isArray(content.equipment.allowedSlots)) {
    const slotOrder=GEAR_SLOTS.map(slot=>slot.id);
    content.equipment.allowedSlots=[...content.equipment.allowedSlots].sort((a,b)=>slotOrder.indexOf(a as never)-slotOrder.indexOf(b as never));
  }
  return content;
}
/** Pure identity derivation also used by atomic shape validation before a definition exists. */
export function authoredItemEntryRef(rootActionId: string, plan: Pick<AuthoredItemMaterializationPlan, "bundleHash" | "handle" | "uniquenessBasisRef">): string {
  if (plan.uniquenessBasisRef !== undefined) return uniqueItemEntryRef(plan.uniquenessBasisRef);
  const prospectiveRef = normalizedProspectiveRef(rootActionId, plan.bundleHash, plan.handle);
  return `item-entry:${canonicalSha256({ rootActionId, bundleHash: plan.bundleHash, prospectiveRef }).slice(7, 39)}`;
}
export function materializedAuthoredItem(rootActionId: string, plan: AuthoredItemMaterializationPlan, definition: ItemDefinitionV1): MaterializedAuthoredItem | undefined {
  if (!isAuthoredItemMaterializationPlan(plan) || definition.definitionId !== plan.definitionRef
    || (plan.uniquenessBasisRef !== undefined && definition.content.stackable)) return undefined;
  const prospectiveRef = normalizedProspectiveRef(rootActionId, plan.bundleHash, plan.handle);
  const entryRef = authoredItemEntryRef(rootActionId, plan);
  try {
    const entry = createInitialItemEntry(definition, { entryId: entryRef, quantity: plan.quantity,
      placement: { kind: "scene", sceneRef: plan.sceneRef }, ownership: plan.ownership, visibilityPolicyRef: plan.visibilityPolicyRef });
    return { prospectiveRef, entryRef, entryHash: canonicalSha256(entry), entry };
  } catch { return undefined; }
}
function abilityDefinition(definitionId: string, source: AuthoredAbilitySource): JsonRecord {
  return { definitionId, revision: "1", definitionKind: "ability", rulesBasis: "srd5.1-2014",
    ...Object.fromEntries(Object.entries(source).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))) };
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function common(value: unknown, extra: string[]): value is Record<string, unknown> {
  return record(value) && exact(value, ["schema", "bundleHash", "handle", "contextHash", "readSet", "basisRefs", "sourceRefs", "visibilityPolicyRef", "summary", ...extra])
    && /^sha256:[0-9a-f]{64}$/.test(String(value.bundleHash)) && /^sha256:[0-9a-f]{64}$/.test(String(value.contextHash))
    && /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value.handle))
    && matchesAuthoredSourceSchema(value.basisRefs, array(ref)) && matchesAuthoredSourceSchema(value.sourceRefs, array(ref))
    && matchesAuthoredSourceSchema(value.visibilityPolicyRef, ref) && matchesAuthoredSourceSchema(value.summary, str)
    && Array.isArray(value.readSet) && value.readSet.every((binding) => matchesAuthoredSourceSchema(binding, object({ ref, revisionOrHash: ref })));
}
