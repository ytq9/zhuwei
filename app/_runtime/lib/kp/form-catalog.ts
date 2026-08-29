/**
 * Private KP proposal forms for new V3 rooms.
 *
 * The catalog is deliberately not exported. Callers can obtain only the IDs or
 * the descriptors selected for one proposal. This prevents an unfiltered
 * catalog from becoming part of a model, page, or public API contract.
 */

export const KP_FORM_IDS = Object.freeze([
  "clarification.v1",
  "observe.v1",
  "npc-exchange.v1",
  "ordinary-check.v1",
  "high-risk-action.v1",
  "in-world-refusal.v1",
  "materialization.v1",
  "combat-action.v1",
  "environmental-stunt.v1",
  "compound.v1",
] as const);

export type KpFormId = (typeof KP_FORM_IDS)[number];

export const KP_FORM_CATALOG_REGISTRATION = Object.freeze({
  catalogRef: "kp-private-form-catalog-v3",
  catalogVersion: "kp-private-form-catalog-v3.1",
  catalogHash: "sha256:edb812fe635ba4d77db59f36276d0e8c44847b64c0990f1758bca2e921a5a4bb",
  formCount: 10,
});

type CatalogForm = Readonly<{
  id: KpFormId;
  purpose: string;
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  fieldKinds: Readonly<Record<string, "text" | "text-list" | "stage-list">>;
}>;

export type ModelFormDescriptor = CatalogForm;

const FORM_CATALOG: Readonly<Record<KpFormId, CatalogForm>> = Object.freeze({
  "clarification.v1": form(
    "clarification.v1",
    "Ask for one missing fictional or player decision before adjudication.",
    ["goal", "question", "choices"],
    ["reason", "basisRefs"],
  ),
  "observe.v1": form(
    "observe.v1",
    "Resolve an attempt to perceive, inspect, recall, or investigate.",
    ["goal", "method", "focus", "desiredInformation"],
    ["basisRefs", "risk", "fictionTime"],
  ),
  "npc-exchange.v1": form(
    "npc-exchange.v1",
    "Resolve an in-world exchange with a projected NPC.",
    ["goal", "method", "utterance", "desiredResponse"],
    ["basisRefs", "risk", "fictionTime"],
  ),
  "ordinary-check.v1": form(
    "ordinary-check.v1",
    "Resolve a bounded ordinary action whose consequences fit one check.",
    ["goal", "method", "intendedOutcome", "risk"],
    ["basisRefs", "fictionTime", "alternatives"],
  ),
  "high-risk-action.v1": form(
    "high-risk-action.v1",
    "Resolve a dangerous action with meaningful success and failure stakes.",
    ["goal", "method", "intendedOutcome", "risk", "stakes"],
    ["basisRefs", "fictionTime", "alternatives"],
  ),
  "in-world-refusal.v1": form(
    "in-world-refusal.v1",
    "Resolve an impossible or premise-breaking attempt inside the fiction.",
    ["goal", "reason", "alternatives"],
    ["basisRefs", "fictionTime"],
  ),
  "materialization.v1": form(
    "materialization.v1",
    "Propose one bounded open-world fact before any random result is known.",
    ["goal", "method", "proposedFact", "basisRefs"],
    ["risk", "fictionTime", "alternatives"],
  ),
  "combat-action.v1": form(
    "combat-action.v1",
    "Resolve one combat intent without selecting authoritative entities.",
    ["goal", "method", "intendedOutcome", "combatApproach"],
    ["basisRefs", "risk", "fictionTime", "contingencies"],
  ),
  "environmental-stunt.v1": form(
    "environmental-stunt.v1",
    "Resolve an improvised interaction with a possible environment feature.",
    ["goal", "method", "featureDescription", "intendedOutcome"],
    ["basisRefs", "risk", "fictionTime", "contingencies"],
  ),
  "compound.v1": form(
    "compound.v1",
    "Describe a bounded causal sequence for an unforeseen or multi-stage action.",
    ["goal", "method", "stages", "intendedOutcome"],
    ["basisRefs", "risk", "fictionTime", "alternatives"],
  ),
});

function form(
  id: KpFormId,
  purpose: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
): CatalogForm {
  const fieldKinds: Record<string, "text" | "text-list" | "stage-list"> = {};
  for (const field of [...requiredFields, ...optionalFields]) fieldKinds[field] = fieldKind(field);
  return Object.freeze({
    id,
    purpose,
    requiredFields: Object.freeze([...requiredFields]),
    optionalFields: Object.freeze([...optionalFields]),
    fieldKinds: Object.freeze(fieldKinds),
  });
}

function fieldKind(field: string): "text" | "text-list" | "stage-list" {
  if (field === "stages") return "stage-list";
  if (["choices", "basisRefs", "alternatives", "contingencies"].includes(field)) return "text-list";
  return "text";
}

export type FormSelectionSignals = Readonly<{
  interaction?: "free" | "observe" | "npc-exchange" | "combat" | "structured";
  risk?: "low" | "ordinary" | "high";
  mayNeedClarification?: boolean;
  mayNeedRefusal?: boolean;
  mayMaterialize?: boolean;
  mayUseEnvironment?: boolean;
  preferredCount?: 3 | 4 | 5 | 6;
  serverSelectedForm?: KpFormId;
}>;

const DEFAULT_FORM_ORDER: readonly KpFormId[] = Object.freeze([
  "ordinary-check.v1",
  "high-risk-action.v1",
  "observe.v1",
  "npc-exchange.v1",
  "materialization.v1",
  "environmental-stunt.v1",
  "combat-action.v1",
  "clarification.v1",
  "in-world-refusal.v1",
]);

/** Selects the complete model-visible form allowlist for one RootAction. */
export function selectAllowedKpForms(signals: FormSelectionSignals): readonly KpFormId[] {
  const desiredCount = signals.preferredCount ?? 5;
  if (!Number.isInteger(desiredCount) || desiredCount < 3 || desiredCount > 6) {
    throw new Error("KP_FORM_ALLOWLIST_SIZE_INVALID");
  }

  const ranked: KpFormId[] = [];
  const add = (id: KpFormId | undefined): void => {
    if (id !== undefined && id !== "compound.v1" && !ranked.includes(id)) ranked.push(id);
  };

  add(signals.serverSelectedForm);
  if (signals.interaction === "observe") add("observe.v1");
  if (signals.interaction === "npc-exchange") add("npc-exchange.v1");
  if (signals.interaction === "combat") add("combat-action.v1");
  if (signals.risk === "high") add("high-risk-action.v1");
  if (signals.risk === "ordinary" || signals.risk === "low") add("ordinary-check.v1");
  if (signals.mayUseEnvironment === true) add("environmental-stunt.v1");
  if (signals.mayMaterialize === true) add("materialization.v1");
  if (signals.mayNeedClarification === true) add("clarification.v1");
  if (signals.mayNeedRefusal === true) add("in-world-refusal.v1");
  for (const id of DEFAULT_FORM_ORDER) add(id);

  const selected = ranked.slice(0, desiredCount - 1);
  selected.push("compound.v1");
  return Object.freeze(selected);
}

/**
 * Returns only explicitly allowed descriptors. The private catalog and its
 * registration metadata never enter the model payload.
 */
export function modelFormDescriptors(allowedForms: readonly KpFormId[]): readonly ModelFormDescriptor[] {
  assertAllowedFormSet(allowedForms);
  return Object.freeze(allowedForms.map((id) => FORM_CATALOG[id]));
}

export type KpFormModelParameters = Readonly<{
  type: "object";
  oneOf: readonly Readonly<Record<string, unknown>>[];
}>;

/** Builds the strict tool parameters for only this RootAction's allowlist. */
export function buildKpFormModelParameters(
  allowedForms: readonly KpFormId[],
): KpFormModelParameters {
  assertAllowedFormSet(allowedForms);
  return Object.freeze({
    type: "object" as const,
    oneOf: Object.freeze(allowedForms.map((formId) => modelBranchSchema(FORM_CATALOG[formId]))),
  });
}

function modelBranchSchema(definition: CatalogForm): Readonly<Record<string, unknown>> {
  const draftProperties: Record<string, unknown> = {};
  for (const field of [...definition.requiredFields, ...definition.optionalFields]) {
    draftProperties[field] = modelFieldSchema(definition.fieldKinds[field]!);
  }
  return deepFreezeSchema({
    type: "object",
    additionalProperties: false,
    description: definition.purpose,
    properties: {
      formId: { type: "string", const: definition.id },
      draft: {
        type: "object",
        additionalProperties: false,
        properties: draftProperties,
        required: definition.requiredFields,
      },
    },
    required: ["formId", "draft"],
  }) as Readonly<Record<string, unknown>>;
}

function modelFieldSchema(kind: "text" | "text-list" | "stage-list"): Readonly<Record<string, unknown>> {
  if (kind === "text") return Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 });
  if (kind === "text-list") {
    return deepFreezeSchema({
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 500 },
    }) as Readonly<Record<string, unknown>>;
  }
  return deepFreezeSchema({
    type: "array",
    minItems: 1,
    maxItems: 7,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        goal: { type: "string", minLength: 1, maxLength: 1_000 },
        method: { type: "string", minLength: 1, maxLength: 1_000 },
        intendedOutcome: { type: "string", minLength: 1, maxLength: 1_000 },
        risk: { type: "string", minLength: 1, maxLength: 1_000 },
        basisRefs: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
      required: ["goal", "method", "intendedOutcome"],
    },
  }) as Readonly<Record<string, unknown>>;
}

function deepFreezeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeSchema));
  if (!isPlainRecord(value)) return value;
  const frozen: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) frozen[key] = deepFreezeSchema(child);
  return Object.freeze(frozen);
}

export function validateKpFormModelEnvelope(
  allowedForms: readonly KpFormId[],
  value: unknown,
): FormDraftValidation {
  assertAllowedFormSet(allowedForms);
  if (!isPlainRecord(value)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["envelope:object-required"]) });
  }
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (key !== "formId" && key !== "draft") errors.push(`${key}:unknown-field`);
  }
  if (typeof value.formId !== "string" || !allowedForms.includes(value.formId as KpFormId)) {
    errors.push("formId:not-allowed");
  } else {
    errors.push(...validateKpFormDraft(value.formId as KpFormId, value.draft).errors);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)].sort()) });
}

export function assertAllowedFormSet(allowedForms: readonly KpFormId[]): void {
  if (allowedForms.length < 3 || allowedForms.length > 6) {
    throw new Error("KP_FORM_ALLOWLIST_SIZE_INVALID");
  }
  if (!allowedForms.includes("compound.v1")) throw new Error("KP_FORM_COMPOUND_REQUIRED");
  if (new Set(allowedForms).size !== allowedForms.length) throw new Error("KP_FORM_ALLOWLIST_DUPLICATE");
  for (const id of allowedForms) {
    if (!Object.hasOwn(FORM_CATALOG, id)) throw new Error("KP_FORM_UNKNOWN");
  }
}

const FORBIDDEN_MODEL_KEY_PARTS = Object.freeze([
  "actor",
  "principal",
  "audience",
  "dice",
  "d20",
  "roll",
  "target",
  "state",
  "event",
  "patch",
  "profile",
  "scope",
]);

export function isForbiddenModelField(key: string): boolean {
  const tokens = keyTokens(key);
  if (tokens.some((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    return (FORBIDDEN_MODEL_KEY_PARTS as readonly string[]).includes(token)
      || (FORBIDDEN_MODEL_KEY_PARTS as readonly string[]).includes(singular);
  })) return true;
  const compact = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (FORBIDDEN_MODEL_KEY_PARTS as readonly string[])
    .filter((part) => part !== "script")
    .some((part) => compact.includes(part));
}

function keyTokens(key: string): string[] {
  return key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
}

export type FormDraftValidation = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

/** Validates the model-owned part only; authority fields are never accepted. */
export function validateKpFormDraft(formId: KpFormId, draft: unknown): FormDraftValidation {
  const definition = FORM_CATALOG[formId];
  const errors: string[] = [];
  if (!isPlainRecord(draft)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["draft:object-required"]) });
  }

  const allowedFields = new Set([...definition.requiredFields, ...definition.optionalFields]);
  for (const key of Object.keys(draft).sort()) {
    if (isForbiddenModelField(key)) errors.push(`${key}:authority-field-forbidden`);
    else if (!allowedFields.has(key)) errors.push(`${key}:unknown-field`);
  }
  for (const field of definition.requiredFields) {
    if (!Object.hasOwn(draft, field) || !hasContent(draft[field])) errors.push(`${field}:required`);
  }
  for (const field of [...definition.requiredFields, ...definition.optionalFields]) {
    if (Object.hasOwn(draft, field) && !matchesFieldKind(definition.fieldKinds[field]!, draft[field])) {
      errors.push(`${field}:type-invalid`);
    }
  }
  findNestedForbiddenFields(draft, "$", errors);

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)].sort()) });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function matchesFieldKind(kind: "text" | "text-list" | "stage-list", value: unknown): boolean {
  if (kind === "text") return typeof value === "string" && value.trim().length > 0;
  if (kind === "text-list") {
    return Array.isArray(value) && value.length > 0
      && value.every((item) => typeof item === "string" && item.trim().length > 0);
  }
  return Array.isArray(value) && value.length > 0 && value.every((stage) => {
    if (!isPlainRecord(stage)) return false;
    const allowed = new Set(["goal", "method", "intendedOutcome", "risk", "basisRefs"]);
    if (Object.keys(stage).some((key) => !allowed.has(key))) return false;
    if (["goal", "method", "intendedOutcome"].some((key) => typeof stage[key] !== "string"
      || (stage[key] as string).trim().length === 0)) return false;
    if (stage.risk !== undefined && (typeof stage.risk !== "string" || stage.risk.trim().length === 0)) return false;
    return stage.basisRefs === undefined || (Array.isArray(stage.basisRefs)
      && stage.basisRefs.length > 0
      && stage.basisRefs.every((ref) => typeof ref === "string" && ref.trim().length > 0));
  });
}

function findNestedForbiddenFields(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findNestedForbiddenFields(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenModelField(key)) errors.push(`${path}.${key}:authority-field-forbidden`);
    findNestedForbiddenFields(child, `${path}.${key}`, errors);
  }
}
