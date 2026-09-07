/** Components refer to existing ItemEntry quantities. Recovery records whether
 * dismantling preserves that original component, never a recipe or new Ability. */
export type ItemAssemblyComponent = Readonly<{ entryRef: string; quantity: number; recoverable: boolean }>;
export type ItemAssemblyOperation = Readonly<{ kind: "assemble"; label: string; description: string; components: readonly ItemAssemblyComponent[] }>
  | Readonly<{ kind: "disassemble"; assemblyRef: string }>;
export type ItemAssemblyRecord = {
  schema: "zhuwei.item-assembly/v1"; assemblyRef: string; creatorRef: string; sceneRef: string;
  label: string; description: string; state: "active" | "disassembled";
  components: Array<{ entryRef: string; recoverable: boolean }>;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 4000): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && value.normalize("NFC") === value;
const ref = (value: unknown): value is string => text(value) && /^\S+$/u.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export type ItemAssemblyShapeDiagnostic = { path: string; reason: string;
  code?: "FIELD_MISSING" | "TYPE_MISMATCH" | "VALUE_INVALID" | "CONSTRAINT_CONFLICT";
  expected?: Readonly<Record<string, unknown>> };
/** Diagnostics and the accepting predicate share these checks; callers do not
 * reconstruct component constraints or normalize an invalid decision. */
export function isItemAssemblyOperation(value: unknown, diagnostics?: ItemAssemblyShapeDiagnostic[]): value is ItemAssemblyOperation {
  let valid = true;
  const check = (condition: boolean, path: string, reason: string, expected: Record<string, unknown>,
    code: ItemAssemblyShapeDiagnostic["code"] = "VALUE_INVALID") => {
    if (!condition) { valid = false; diagnostics?.push({ path, reason, expected, code }); }
  };
  if (!record(value)) { check(false, "", "expected an inventory operation object", { type: "object" }, "TYPE_MISMATCH"); return false; }
  const keys = value.kind === "disassemble" ? ["kind", "assemblyRef"] : ["kind", "label", "description", "components"];
  check(value.kind === "assemble" || value.kind === "disassemble", "/kind", "unsupported assembly operation", { enum: ["assemble", "disassemble"] });
  for (const key of keys) check(Object.hasOwn(value, key), `/${key}`, "required operation field is missing", { required: true }, "FIELD_MISSING");
  for (const key of Object.keys(value)) check(keys.includes(key), `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, "field is not part of this inventory operation", { authorable: false }, "CONSTRAINT_CONFLICT");
  if (value.kind === "disassemble") {
    check(ref(value.assemblyRef), "/assemblyRef", "expected a canonical assembly reference", { type: "string", pattern: "^\\S+$" });
    return valid;
  }
  check(text(value.label, 500), "/label", "expected canonical nonempty NFC label within 500 characters", { type: "string", maxLength: 500 });
  check(text(value.description), "/description", "expected canonical nonempty NFC description within 4000 characters", { type: "string", maxLength: 4000 });
  if (!Array.isArray(value.components)) { check(false, "/components", "expected an array of original components", { type: "array" }, "TYPE_MISMATCH"); return false; }
  check(value.components.length >= 2 && value.components.length <= 16, "/components", "assembly requires two to sixteen original components", { minItems: 2, maxItems: 16 });
  const seen = new Set<string>();
  for (const [index, component] of value.components.entries()) {
    const path = `/components/${index}`;
    if (!record(component)) { check(false, path, "expected an original component object", { type: "object" }, "TYPE_MISMATCH"); continue; }
    check(exact(component, ["entryRef", "quantity", "recoverable"]), path, "component requires only entryRef, quantity and recoverable", { required: ["entryRef", "quantity", "recoverable"], additionalProperties: false });
    check(ref(component.entryRef), `${path}/entryRef`, "expected a canonical original entry reference", { type: "string", pattern: "^\\S+$" });
    check(Number.isSafeInteger(component.quantity) && Number(component.quantity) > 0 && Number(component.quantity) <= 1_000_000,
      `${path}/quantity`, "expected an original component quantity within the inventory bounds", { type: "integer", minimum: 1, maximum: 1_000_000 });
    check(typeof component.recoverable === "boolean", `${path}/recoverable`, "original component recovery must be explicit", { type: "boolean" }, "TYPE_MISMATCH");
    if (typeof component.entryRef === "string") {
      check(!seen.has(component.entryRef), `${path}/entryRef`, "each original component entry must appear only once", { uniqueBy: "entryRef" }, "CONSTRAINT_CONFLICT");
      seen.add(component.entryRef);
    }
  }
  return valid;
}
export function isItemAssemblyRecord(value: unknown): value is ItemAssemblyRecord {
  return record(value) && exact(value, ["schema", "assemblyRef", "creatorRef", "sceneRef", "label", "description", "state", "components"])
    && value.schema === "zhuwei.item-assembly/v1" && [value.assemblyRef, value.creatorRef, value.sceneRef].every(ref)
    && text(value.label, 500) && text(value.description) && ["active", "disassembled"].includes(String(value.state))
    && Array.isArray(value.components) && value.components.length >= 2 && value.components.length <= 16
    && value.components.every(c => record(c) && exact(c, ["entryRef", "recoverable"]) && ref(c.entryRef) && typeof c.recoverable === "boolean")
    && new Set(value.components.map(c => c.entryRef)).size === value.components.length;
}
export function assemblyOperationRefs(operation: ItemAssemblyOperation): readonly string[] {
  return operation.kind === "assemble" ? operation.components.map(c => c.entryRef) : [operation.assemblyRef];
}
