import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  type KpFormId,
} from "./form-catalog";

/**
 * DeepSeek's strict dialect accepts only closed objects whose `required`
 * lists every property. A Form draft is not shaped that way: `resolution`
 * decides whether the check fields exist at all, and `validateKpFormDraft`
 * rejects a check field that is present on a `direct` draft
 * (`<field>:direct-forbidden`). Strict output therefore cannot be produced by
 * marking the optional fields required and letting them through — the model
 * would satisfy the provider and fail local validation on the same draft.
 *
 * The sentinel closes that gap. Every optional field accepts one extra
 * literal, and the decoder removes the keys carrying it before validation, so
 * a strict draft and an ordinary draft reach `validateKpFormDraft` in exactly
 * the same shape.
 *
 * The literal is `__none__` rather than vNext's `none` because `none` is a
 * real domain value here: it is a member of the `skill`, `failure-status` and
 * `cover-list` enums, and reusing it would make an omitted skill and a
 * deliberate "no skill" indistinguishable.
 */
export const KP_STRICT_TOOL_OMITTED_SENTINEL = "__none__" as const;

/**
 * How a KP request asks the provider to constrain its own output. `tool`
 * sends an ordinary function definition and enforces the schema locally
 * after generation; `strict-tool` sends the beta dialect with `strict: true`
 * and is enforced by the provider before a token is emitted. The mode belongs
 * to the profile, and the transport, tool definition and parameter schema all
 * have to agree with it — a request that declares one and sends the other is
 * the failure this type exists to prevent.
 */
export type KpStructuredOutputMode = "tool" | "strict-tool";

const NUMBER_KEYWORDS = [
  "const",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A bare `{ enum: [...] }` is idiomatic in the catalog but the strict dialect
 * requires a declared type on every scalar node, so the type is recovered from
 * the members. A mixed-type enum has no strict representation.
 */
function enumType(members: readonly unknown[]): "string" | "number" | "integer" | "boolean" {
  const kinds = new Set(members.map((member) => {
    if (typeof member === "string") return "string";
    if (typeof member === "boolean") return "boolean";
    if (typeof member === "number") return Number.isInteger(member) ? "integer" : "number";
    return "unsupported";
  }));
  if (kinds.size !== 1) throw new Error("KP_STRICT_TOOL_ENUM_TYPE_AMBIGUOUS");
  const [only] = [...kinds];
  if (only === "unsupported") throw new Error("KP_STRICT_TOOL_ENUM_TYPE_UNSUPPORTED");
  return only as "string" | "number" | "integer" | "boolean";
}

function omittedSentinelSchema(): SchemaRecord {
  return {
    type: "string",
    enum: [KP_STRICT_TOOL_OMITTED_SENTINEL],
    description:
      `字段不适用于本次草稿时精确填写 "${KP_STRICT_TOOL_OMITTED_SENTINEL}"，不要留空或编造内容。`,
  };
}

/**
 * Wraps an optional field so the model can always emit the key. The wrapper
 * carries only `anyOf` and `description`; the dialect rejects any sibling.
 */
function optionalSchema(schema: SchemaRecord): SchemaRecord {
  const description = typeof schema.description === "string" ? schema.description : undefined;
  return {
    anyOf: [schema, omittedSentinelSchema()],
    ...(description === undefined ? {} : { description }),
  };
}

function convertNode(node: unknown, path: string): SchemaRecord {
  if (!isRecord(node)) throw new Error(`KP_STRICT_TOOL_NODE_INVALID:${path}`);

  const result: SchemaRecord = {};
  if (typeof node.description === "string") result.description = node.description;

  const declaredType = typeof node.type === "string" ? node.type : undefined;
  const members = Array.isArray(node.enum) ? node.enum : undefined;
  const type = declaredType ?? (members === undefined ? undefined : enumType(members));
  if (type === undefined) throw new Error(`KP_STRICT_TOOL_TYPE_UNKNOWN:${path}`);
  result.type = type;

  if (members !== undefined) result.enum = [...members];

  if (type === "object") {
    const properties = isRecord(node.properties) ? node.properties : {};
    const required = new Set(
      Array.isArray(node.required)
        ? node.required.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
    const converted: SchemaRecord = {};
    for (const [key, child] of Object.entries(properties)) {
      const childSchema = convertNode(child, `${path}.${key}`);
      converted[key] = required.has(key) ? childSchema : optionalSchema(childSchema);
    }
    result.properties = converted;
    // The dialect's own rule: `required` must name every property. The
    // conditional `allOf` the catalog uses to require the check fields is
    // dropped here and stays enforced by `validateKpFormDraft`.
    result.required = Object.keys(converted);
    result.additionalProperties = false;
    return result;
  }

  if (type === "array") {
    if (!("items" in node)) throw new Error(`KP_STRICT_TOOL_ITEMS_MISSING:${path}`);
    result.items = convertNode(node.items, `${path}[]`);
    return result;
  }

  if (type === "string") {
    if (typeof node.pattern === "string") result.pattern = node.pattern;
    if (typeof node.format === "string") result.format = node.format;
    return result;
  }

  if (type === "integer" || type === "number") {
    for (const key of NUMBER_KEYWORDS) {
      if (typeof node[key] === "number" && Number.isFinite(node[key])) result[key] = node[key];
    }
    return result;
  }

  if (type === "boolean") return result;

  throw new Error(`KP_STRICT_TOOL_TYPE_UNSUPPORTED:${path}:${type}`);
}

/**
 * `compound.v1` composes a discriminated union whose non-discriminant fields
 * are declared as the empty schema, with every real constraint carried in
 * `allOf` + `if`/`then` per branch. The strict dialect has no conditional
 * keyword, so the only faithful strict encoding is an `anyOf` over closed
 * branch objects, which has to be built from the branch table rather than
 * recovered from the flattened output. Until that exists, the Form is
 * excluded by name: emitting it with untyped properties would hand the model
 * a *looser* contract while claiming to be strict.
 */
export const KP_STRICT_TOOL_UNSUPPORTED_FORMS: readonly KpFormId[] = Object.freeze([
  "compound.v1",
]);

export const KP_STRICT_TOOL_CAPABLE_FORMS: readonly KpFormId[] = Object.freeze(
  KP_FORM_IDS.filter((formId) => !KP_STRICT_TOOL_UNSUPPORTED_FORMS.includes(formId)),
);

export function kpFormSupportsStrictTool(formId: KpFormId): boolean {
  return !KP_STRICT_TOOL_UNSUPPORTED_FORMS.includes(formId);
}

/**
 * The strict-dialect twin of `buildKpFormToolParameters`. The ordinary builder
 * is left untouched so the registered catalog hash and the current production
 * request stay byte-identical while strict output is rolled out per profile.
 */
export function buildKpFormStrictToolParameters(
  formId: KpFormId,
): Readonly<Record<string, unknown>> {
  if (!kpFormSupportsStrictTool(formId)) {
    throw new Error(`KP_STRICT_TOOL_FORM_UNSUPPORTED:${formId}`);
  }
  return convertNode(buildKpFormToolParameters(formId), "$");
}

/** True for a value the model used to say "this field does not apply". */
function isOmitted(value: unknown): boolean {
  return value === KP_STRICT_TOOL_OMITTED_SENTINEL;
}

/**
 * Removes the sentinel keys so a strict draft reaches `validateKpFormDraft`,
 * the semantic freeze and the Rules boundary in exactly the shape an ordinary
 * draft has. Anything that is not a sentinel is passed through untouched: this
 * decoder never repairs, coerces or fills a field.
 */
export function decodeKpFormStrictDraft(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => decodeKpFormStrictDraft(entry));
  if (!isRecord(value)) return value;
  const decoded: SchemaRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (isOmitted(child)) continue;
    decoded[key] = decodeKpFormStrictDraft(child);
  }
  return decoded;
}

/**
 * Reports sentinels the decoder cannot remove because they sit where a value,
 * not a field, was expected. An array element or a required scalar carrying
 * the sentinel is a model contract error, not an omitted field.
 */
export function strictDraftSentinelMisuse(value: unknown, path = "$"): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => (
      isOmitted(entry)
        ? [`${path}[${index}]:sentinel-not-a-field`]
        : strictDraftSentinelMisuse(entry, `${path}[${index}]`)
    ));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => (
    isOmitted(child) ? [] : strictDraftSentinelMisuse(child, `${path}.${key}`)
  ));
}
