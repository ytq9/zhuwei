import { isItemAssemblyOperation } from "../../rules/v2/item-assembly-shapes";
import { GEAR_SLOTS } from "../../dnd/gear";
import {
  AUTHORED_ABILITY_SOURCE_SCHEMA, AUTHORED_HAZARD_CONTENT_SCHEMA, AUTHORED_ITEM_CONTENT_SCHEMA,
  AUTHORED_ITEM_OWNERSHIP_SCHEMA, matchesAuthoredSourceSchema, type AuthoredSourceSchema, type AuthoredSourceDiagnostic,
} from "../../rules/v2/authored-materialization";

// Put the variant discriminator before common fields on every authored surface.
// This is schema presentation only; duplicate output members remain invalid.
const object = (properties: Record<string, AuthoredSourceSchema>): AuthoredSourceSchema => ({
  type: "object", properties: Object.fromEntries(Object.entries(properties).sort(([a], [b]) => a === "kind" ? -1 : b === "kind" ? 1 : 0)),
  required: Object.keys(properties).sort(), additionalProperties: false,
});
const values = (...entries: string[]): AuthoredSourceSchema => ({ type: "string", enum: entries });
const ref: AuthoredSourceSchema = { type: "string", pattern: "^\\S+$" };
const prospectiveRef: AuthoredSourceSchema = { type: "string", pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
const itemEntryRef: AuthoredSourceSchema = { ...ref,
  description: "Exact physical ItemEntry entryId, or a consumed same-bundle prospective itemEntry handle. ItemDefinition IDs describe a type and cannot identify the item being operated on. For acquire select the source entry on the ground, not a destination stack already held." };
const quantity: AuthoredSourceSchema = { type: "integer", minimum: 1, maximum: 1_000_000 };
const slot = values(...GEAR_SLOTS.map(({ id }) => id));
const coordinate: AuthoredSourceSchema = { type: "string", pattern: "^(0|-?[1-9][0-9]*)$" };
const point = object({ x: coordinate, y: coordinate, elevation: coordinate });
export const AUTHORED_EXECUTION_AREA_SCHEMA: AuthoredSourceSchema = { description: "Coordinates are integer inches. If direction is supplied, its vector must be nonzero.", anyOf: [object({ origin: point }), object({ origin: point, direction: point })] };
export function isAuthoredExecutionArea(value: unknown): boolean {
  if (!matchesAuthoredSourceSchema(value, AUTHORED_EXECUTION_AREA_SCHEMA)) return false;
  const direction = (value as { direction?: Record<string, string> }).direction;
  return !direction || !Object.values(direction).every((coordinate) => coordinate === "0");
}
export const INVENTORY_OPERATION_SOURCE_SCHEMA: AuthoredSourceSchema = {
  description: "Every operation executes a real state transition. Submit only the transitions needed for the player's action; never add an operation as an intent marker, confirmation, or narrative preparation step.",
  anyOf: [
  { ...object({ kind: values("assemble"), label: { type: "string", pattern: "^[\\s\\S]{1,500}$" },
    description: { type: "string", pattern: "^[\\s\\S]{1,4000}$" }, components: { type: "array", description: "Two to sixteen distinct existing components.",
      items: object({ entryRef: itemEntryRef, quantity, recoverable: { type: "boolean" } }) } }),
    description: "Assemble 2–16 distinct existing unequipped held components in this scene; record quantities and recoverability. No new ItemDefinition or Ability. Outside active encounters only; combat handling needs its own legal action and costs. The enclosing Proposal decision freezes the action duration; this operation adds no separate time, damage, resource or trigger effect." },
  object({ kind: values("disassemble"), assemblyRef: { ...ref, description: "Existing active assemblyRef from frozen context; dismantling restores only the original recoverable components, with their current condition and counters." } }),
  object({ kind: values("acquire"), entryRef: itemEntryRef, quantity }),
  object({ kind: values("identify"), entryRef: itemEntryRef }),
  { ...object({ kind: values("release"), entryRef: itemEntryRef, quantity, sceneRef: ref, releaseKind: values("placement", "drop", "loss") }),
    description: "Move this quantity from the holder into the scene. This operation includes taking it from carried inventory and placing, dropping, or losing it; it preserves the physical items and does not execute their use Ability." },
  object({ kind: values("transfer"), entryRef: itemEntryRef, quantity, targetCharacterRef: ref, ownershipDisposition: values("preserve", "transferToRecipient") }),
  object({ kind: values("equip"), entryRef: itemEntryRef, action: values("wear", "stow"), slot }),
  { ...object({ kind: values("use"), entryRef: itemEntryRef, targetRefs: { type: "array", items: ref } }),
    description: "Execute this ItemDefinition's registered use Ability against actual targets and pay its declared costs. Requires a usable definition with a use Ability; handling, taking out, or relocating an item does not invoke use." },
  { ...object({ kind: values("use"), entryRef: itemEntryRef, targetRefs: { type: "array", items: ref }, area: AUTHORED_EXECUTION_AREA_SCHEMA }),
    description: "Execute this ItemDefinition's registered area use Ability and pay its declared costs. targetRefs must be []; Rules derives actual targets from the area. This is an actual Ability execution, never an intent marker or a step for moving an item." },
  object({ kind: values("lifecycle"), entryRef: itemEntryRef, action: values("break", "repair", "destroy") }),
] };

/** Refine the same operation schema with the frozen reference directory.
 * Prospective handles remain open for normal same-bundle creation; the existing
 * dependency graph proves their producer kind before execution. */
function inventoryOperationSchema(entryRefs?: readonly string[]): AuthoredSourceSchema {
  if (entryRefs === undefined) return INVENTORY_OPERATION_SOURCE_SCHEMA;
  const selectedRef: AuthoredSourceSchema = { description: itemEntryRef.description,
    anyOf: [...(entryRefs.length ? [{ type: "string" as const, enum: [...entryRefs] }] : []), prospectiveRef] };
  return { ...INVENTORY_OPERATION_SOURCE_SCHEMA,
    anyOf: INVENTORY_OPERATION_SOURCE_SCHEMA.anyOf!.map(variant => {
      const properties = { ...variant.properties };
      if (properties.entryRef) properties.entryRef = selectedRef;
      if (properties.components) properties.components = { ...properties.components,
        items: { ...properties.components.items, properties: { ...properties.components.items!.properties, entryRef: selectedRef } } };
      return { ...variant, properties };
    }) };
}
export function isInventoryOperationSource(value: unknown, diagnostics?: AuthoredSourceDiagnostic[]): boolean {
  if (!matchesAuthoredSourceSchema(value, INVENTORY_OPERATION_SOURCE_SCHEMA, diagnostics)) return false;
  const operation = value as { kind: string; targetRefs?: string[]; area?: { direction?: { x: string; y: string; elevation: string } } };
  if (operation.kind === "use" && operation.area) {
    if (operation.targetRefs?.length !== 0) return false;
    const direction = operation.area.direction;
    if (direction && Object.values(direction).every((coordinate) => coordinate === "0")) return false;
  }
  if (operation.kind === "assemble" || operation.kind === "disassemble") return isItemAssemblyOperation(value, diagnostics);
  return true;
}
/** The provider cannot use JSON null; its sentinel is decoded at the wire boundary. */
function strict(schema: AuthoredSourceSchema): AuthoredSourceSchema {
  if (schema.type === "null") return object({ kind: values("none") });
  return {
    ...schema,
    ...(schema.anyOf ? { anyOf: schema.anyOf.map(strict) } : {}),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, strict(child)])) } : {}),
    ...(schema.items ? { items: strict(schema.items) } : {}),
  };
}
export function authoredProposalVariants(input: Record<string, unknown>,
  produces: (kind: string, definitionKind?: string) => Record<string, unknown>,
  entryRefs?: readonly string[], definitionRefs?: readonly string[]): AuthoredSourceSchema[] {
  const common = input as Record<string, AuthoredSourceSchema>;
  const summary: AuthoredSourceSchema = { type: "string", pattern: "[\\s\\S]+" };
  const visibilityPolicyRef = values("visibility:public", "visibility:scene-observers", "visibility:hidden-until-evidence", "visibility:narrative-audience");
  const definitionRef: AuthoredSourceSchema = {
    ...(definitionRefs === undefined ? ref : { anyOf: [
      ...(definitionRefs.length ? [values(...definitionRefs)] : []), prospectiveRef,
    ] }),
    description: "Exact ItemDefinition ID from frozen itemDefinitionRefs, or the handle declared by a real same-bundle authorItem step. Never an object label, ItemEntry ID or knowledge ref. If no matching definition is listed, select authorItem and create its definition before materializing the item.",
  };
  return [
    ...([
      ["ability", AUTHORED_ABILITY_SOURCE_SCHEMA], ["hazard", AUTHORED_HAZARD_CONTENT_SCHEMA], ["item", AUTHORED_ITEM_CONTENT_SCHEMA],
    ] as const).map(([kind, content]) => strict(object({ ...common, kind: values("materializeDefinition"), produces: produces("materializeDefinition", kind) as AuthoredSourceSchema, source: object({ kind: values(kind), content }), visibilityPolicyRef, summary }))),
    strict(object({ ...common, kind: values("materializeItem"), produces: produces("materializeItem") as AuthoredSourceSchema, definitionRef, sceneRef: ref, quantity, ownership: AUTHORED_ITEM_OWNERSHIP_SCHEMA, visibilityPolicyRef, summary })),
    strict(object({ ...common, kind: values("materializeItem"), produces: produces("materializeItem") as AuthoredSourceSchema, definitionRef, sceneRef: ref, quantity, ownership: AUTHORED_ITEM_OWNERSHIP_SCHEMA, visibilityPolicyRef, summary, uniquenessBasisRef: ref })),
    strict(object({ ...common, produces: produces("inventoryOperation") as AuthoredSourceSchema, kind: values("inventoryOperation"), operation: inventoryOperationSchema(entryRefs), summary })),
  ];
}
/** Reference slots only: prose must never create a dependency. */
export function authoredReferenceSlots(value: unknown,
  onReference?: (value: string, parent: Record<string, unknown> | readonly unknown[], key: string | number) => void): string[] {
  const refs: string[] = [];
  const scalar = new Set(["uniquenessBasisRef", "sourceRef", "mechanicsRef", "abilityRef", "definitionRef", "entryRef", "assemblyRef", "sceneRef", "ownerRef", "targetCharacterRef", "ammunitionDefinitionRef", "resourceId"]);
  const arrays = new Set(["equippedAbilityRefs", "targetRefs"]);
  function collect(ref: string, parent: Record<string, unknown> | readonly unknown[], key: string | number): void {
    refs.push(ref);
    onReference?.(ref, parent, key);
  }
  function visit(node: unknown, parentKey = ""): void {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if ((scalar.has(key) || (key === "ref" && parentKey === "trigger")) && typeof child === "string") collect(child, node as Record<string, unknown>, key);
      else if (arrays.has(key) && Array.isArray(child)) child.forEach((item, index) => {
        if (typeof item === "string") collect(item, child, index);
      });
      else if (Array.isArray(child)) child.forEach((item) => visit(item, key));
      else visit(child, key);
    }
  }
  visit(value);
  return [...new Set(refs)].sort();
}
