import { canonicalSha256 } from "../profiles/canonical";

export type SemanticJsonScalar = string | number | boolean | null;
export type SemanticJsonValue =
  | SemanticJsonScalar
  | readonly SemanticJsonValue[]
  | SemanticJsonRecord;
export interface SemanticJsonRecord {
  readonly [key: string]: SemanticJsonValue;
}

type JsonValue = SemanticJsonValue;
type JsonRecord = SemanticJsonRecord;

export const VNEXT_DEFINITION_SNAPSHOT_SCHEMA = "zhuwei.definition-snapshot/vnext-core-1" as const;
export const VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA =
  "zhuwei.semantic-definition/vnext-1" as const;
export const VNEXT_SEMANTIC_DEFINITION_MATERIALIZATION_PLAN_SCHEMA =
  "zhuwei.semantic-definition-materialization-plan/vnext-1" as const;

export type SemanticDefinitionKind =
  | "npc"
  | "item"
  | "worldFact"
  | "sceneFeature"
  | "worldRelation";

export type DefinitionSnapshot = Readonly<{
  schema: typeof VNEXT_DEFINITION_SNAPSHOT_SCHEMA;
  definitionRef: string;
  revision: string;
  definitionHash: string;
  definition: JsonRecord;
}>;

/** Current full semantic definition stored in the one authoritative catalog.
 * Mechanical state is deliberately absent and remains in its domain state. */
export type StoredSemanticDefinition = Readonly<{
  schema: typeof VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA;
  definitionKind: "semantic";
  semanticKind: SemanticDefinitionKind;
  definitionId: string;
  revision: string;
  definitionHash: string;
  templateRef: string;
  templateHash: string;
  visibilityPolicyRef: string;
  content: JsonRecord;
}>;

/**
 * Server-derived materialization input. The model may provide only a local
 * handle; it never supplies an authority definition id. Rules derives the
 * bundle-local prospective ref and the committed authority ref from the
 * frozen RootAction/bundle hash tuple.
 */
export type SemanticDefinitionMaterializationPlan = Readonly<{
  schema: typeof VNEXT_SEMANTIC_DEFINITION_MATERIALIZATION_PLAN_SCHEMA;
  bundleHash: string;
  handle: string;
  semanticKind: SemanticDefinitionKind;
  templateRef: string;
  templateHash: string;
  visibilityPolicyRef: string;
  contextHash: string;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  basisRefs: readonly string[];
  sourceRefs: readonly string[];
  content: JsonRecord;
  summary: string;
}>;

export type SemanticDefinitionMaterializedPayload = Readonly<{
  actorCharacterId: string;
  bundleHash: string;
  prospectiveRef: string;
  definitionRef: string;
  semanticKind: SemanticDefinitionKind;
  templateRef: string;
  templateHash: string;
  contextHash: string;
  basisRefs: readonly string[];
  sourceRefs: readonly string[];
  summary: string;
  definition: StoredSemanticDefinition;
}>;

const LOCAL_MATERIALIZATION_HANDLE = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SEMANTIC_KINDS = new Set<SemanticDefinitionKind>([
  "npc",
  "item",
  "worldFact",
  "sceneFeature",
  "worldRelation",
]);

/** Canonical server-side prospective ref. It is intentionally not an
 * authority ref and must never be inserted into epistemic/read-set refs. */
export function normalizedProspectiveRef(
  rootActionId: string,
  bundleHash: string,
  handle: string,
): string {
  assertRef(rootActionId, "rootActionId");
  assertSha256(bundleHash, "bundleHash");
  if (!LOCAL_MATERIALIZATION_HANDLE.test(handle)) {
    throw new TypeError("handle:prospective-local-required");
  }
  return `prospective:${canonicalSha256({
    schema: VNEXT_SEMANTIC_DEFINITION_MATERIALIZATION_PLAN_SCHEMA,
    rootActionId,
    bundleHash,
    handle,
  }).slice("sha256:".length, "sha256:".length + 32)}`;
}

/** Deterministic committed authority id. Only Rules calls this while
 * constructing the final event; the model and Bundle compiler cannot choose
 * this id. */
export function materializedSemanticDefinitionRef(
  rootActionId: string,
  bundleHash: string,
  prospectiveRef: string,
): string {
  assertRef(rootActionId, "rootActionId");
  assertSha256(bundleHash, "bundleHash");
  if (!/^prospective:[0-9a-f]{32}$/u.test(prospectiveRef)) {
    throw new TypeError("prospectiveRef:normalized-required");
  }
  return `definition:materialized:${canonicalSha256({
    schema: VNEXT_SEMANTIC_DEFINITION_MATERIALIZATION_PLAN_SCHEMA,
    rootActionId,
    bundleHash,
    prospectiveRef,
  }).slice("sha256:".length, "sha256:".length + 32)}`;
}

export type MaterializedSemanticDefinition = Readonly<{
  prospectiveRef: string;
  definitionRef: string;
  definition: StoredSemanticDefinition;
}>;

/** Build the complete immutable definition only after Rules has derived both
 * refs. The content is validated by createDefinitionSnapshot, so mechanical
 * state cannot enter a sparse semantic definition. */
export function materializedSemanticDefinition(
  rootActionId: string,
  plan: SemanticDefinitionMaterializationPlan,
): MaterializedSemanticDefinition {
  if (!isSemanticDefinitionMaterializationPlan(plan)) {
    throw new TypeError("semantic materialization plan is not canonical");
  }
  const prospectiveRef = normalizedProspectiveRef(rootActionId, plan.bundleHash, plan.handle);
  const definitionRef = materializedSemanticDefinitionRef(
    rootActionId,
    plan.bundleHash,
    prospectiveRef,
  );
  const snapshot = createDefinitionSnapshot(definitionRef, "1", plan.content);
  const definition = storedSemanticDefinition(
    plan.semanticKind,
    plan.visibilityPolicyRef,
    snapshot,
    { templateRef: plan.templateRef, templateHash: plan.templateHash },
  );
  return Object.freeze({ prospectiveRef, definitionRef, definition });
}

export function isSemanticDefinitionMaterializedPayload(
  value: unknown,
): value is SemanticDefinitionMaterializedPayload {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      "actorCharacterId", "basisRefs", "bundleHash", "contextHash", "definition", "definitionRef",
      "prospectiveRef", "semanticKind", "sourceRefs", "summary", "templateHash", "templateRef",
    ])
    || !isRef(value.actorCharacterId)
    || !isSha256(value.bundleHash)
    || typeof value.prospectiveRef !== "string"
    || !/^prospective:[0-9a-f]{32}$/u.test(value.prospectiveRef)
    || typeof value.definitionRef !== "string"
    || !/^definition:materialized:[0-9a-f]{32}$/u.test(value.definitionRef)
    || !SEMANTIC_KINDS.has(value.semanticKind as SemanticDefinitionKind)
    || !isRef(value.templateRef)
    || !isSha256(value.templateHash)
    || !isSha256(value.contextHash)
    || !isCanonicalRefSet(value.basisRefs)
    || !isCanonicalRefSet(value.sourceRefs)
    || !isText(value.summary)
    || !isStoredSemanticDefinition(value.definition)) return false;
  const definition = value.definition;
  return definition.definitionId === value.definitionRef
    && definition.semanticKind === value.semanticKind
    && definition.templateRef === value.templateRef
    && definition.templateHash === value.templateHash
    && definition.revision === "1";
}

export function isSemanticDefinitionMaterializationPlan(
  value: unknown,
): value is SemanticDefinitionMaterializationPlan {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, [
      "basisRefs", "bundleHash", "content", "contextHash", "handle", "readSet",
      "schema", "semanticKind", "sourceRefs", "summary", "templateHash", "templateRef",
      "visibilityPolicyRef",
    ])
    || value.schema !== VNEXT_SEMANTIC_DEFINITION_MATERIALIZATION_PLAN_SCHEMA
    || !isSha256(value.bundleHash)
    || !isLocalMaterializationHandle(value.handle)
    || !SEMANTIC_KINDS.has(value.semanticKind as SemanticDefinitionKind)
    || !isRef(value.templateRef)
    || !isSha256(value.templateHash)
    || !isRef(value.visibilityPolicyRef)
    || !isSha256(value.contextHash)
    || !isCanonicalReadSet(value.readSet)
    || !isCanonicalRefSet(value.basisRefs)
    || !isCanonicalRefSet(value.sourceRefs)
    || !isPlainRecord(value.content)
    || !isText(value.summary)) return false;
  try {
    // Validate the complete sparse definition without requiring a live state.
    assertDefinitionContainsNoMechanicalFields(value.content as JsonRecord);
  } catch {
    return false;
  }
  return true;
}

export type SemanticTemplateBinding = Readonly<{
  templateRef: string;
  templateHash: string;
}>;

export type SemanticFieldPolicy =
  | Readonly<{
      kind: "value";
      path: readonly string[];
      allowRemove?: boolean;
    }>
  | Readonly<{
      kind: "referenceArray";
      path: readonly string[];
      referenceField: string;
    }>;

export type SemanticDefinitionOperation =
  | Readonly<{
      kind: "set";
      path: readonly string[];
      value: JsonValue;
    }>
  | Readonly<{
      kind: "remove";
      path: readonly string[];
    }>
  | Readonly<{
      kind: "upsertByRef";
      path: readonly string[];
      entry: JsonRecord;
    }>
  | Readonly<{
      kind: "removeByRef";
      path: readonly string[];
      ref: string;
    }>;

export type DefinitionCompositionInput = Readonly<{
  base: DefinitionSnapshot;
  expectedRevision: string;
  expectedHash: string;
  allowlist: readonly SemanticFieldPolicy[];
  operations: readonly SemanticDefinitionOperation[];
}>;

export type DefinitionCompositionResult =
  | Readonly<{
      kind: "accepted";
      nextDefinition: JsonRecord;
      nextRevision: string;
      nextHash: string;
      snapshot: DefinitionSnapshot;
    }>
  | Readonly<{
      kind: "rejected";
      code:
        | "DEFINITION_INVALID"
        | "DEFINITION_CONFLICT"
        | "SEMANTIC_OPERATION_INVALID"
        | "MECHANICAL_FIELD_FORBIDDEN";
      issues: readonly string[];
    }>;

const MECHANICAL_FIELD_KEYS = new Set([
  "ac",
  "armorclass",
  "charges",
  "condition",
  "conditions",
  "currenthp",
  "durability",
  "equipped",
  "equippedslot",
  "equipment",
  "hitpoint",
  "hitpoints",
  "holderref",
  "hp",
  "inventory",
  "loadout",
  "mechanics",
  "owner",
  "ownerref",
  "ownership",
  "position",
  "quantity",
  "resource",
  "resources",
  "resourcestate",
]);

export function createDefinitionSnapshot(
  definitionRef: string,
  revision: string,
  definition: JsonRecord,
): DefinitionSnapshot {
  assertRef(definitionRef, "definitionRef");
  assertRevision(revision, "revision");
  assertDefinitionContainsNoMechanicalFields(definition);
  const cloned = deepFreeze(canonicalClone(definition));
  const definitionHash = definitionSnapshotHash(definitionRef, revision, cloned);
  return deepFreeze({
    schema: VNEXT_DEFINITION_SNAPSHOT_SCHEMA,
    definitionRef,
    revision,
    definitionHash,
    definition: cloned,
  });
}

export function storedSemanticDefinition(
  semanticKind: SemanticDefinitionKind,
  visibilityPolicyRef: string,
  snapshot: DefinitionSnapshot,
  template: SemanticTemplateBinding = {
    templateRef: snapshot.definitionRef,
    templateHash: snapshot.definitionHash,
  },
): StoredSemanticDefinition {
  validateBase(snapshot);
  if (!["npc", "item", "worldFact", "sceneFeature", "worldRelation"].includes(semanticKind)) {
    throw new TypeError("semanticKind:unsupported");
  }
  assertRef(visibilityPolicyRef, "visibilityPolicyRef");
  assertRef(template.templateRef, "templateRef");
  assertSha256(template.templateHash, "templateHash");
  return deepFreeze({
    schema: VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA,
    definitionKind: "semantic",
    semanticKind,
    definitionId: snapshot.definitionRef,
    revision: snapshot.revision,
    definitionHash: snapshot.definitionHash,
    templateRef: template.templateRef,
    templateHash: template.templateHash,
    visibilityPolicyRef,
    content: canonicalClone(snapshot.definition),
  });
}

export function semanticDefinitionSnapshot(
  value: unknown,
): DefinitionSnapshot | undefined {
  if (!isPlainRecord(value)
    || value.schema !== VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA
    || value.definitionKind !== "semantic"
    || !["npc", "item", "worldFact", "sceneFeature", "worldRelation"].includes(
      String(value.semanticKind),
    )
    || !isNonEmptyString(value.definitionId)
    || !isNonEmptyString(value.revision)
    || !isNonEmptyString(value.definitionHash)
    || !isNonEmptyString(value.templateRef)
    || !isSha256(value.templateHash)
    || !isNonEmptyString(value.visibilityPolicyRef)
    || !isPlainRecord(value.content)) return undefined;
  try {
    const snapshot = createDefinitionSnapshot(
      value.definitionId,
      value.revision,
      value.content as JsonRecord,
    );
    return snapshot.definitionHash === value.definitionHash ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

export function isStoredSemanticDefinition(
  value: unknown,
): value is StoredSemanticDefinition {
  return semanticDefinitionSnapshot(value) !== undefined;
}

export function composeDefinition(input: DefinitionCompositionInput): DefinitionCompositionResult {
  try {
    validateBase(input.base);
    assertRevision(input.expectedRevision, "expectedRevision");
    assertRef(input.expectedHash, "expectedHash");
    if (input.expectedRevision !== input.base.revision || input.expectedHash !== input.base.definitionHash) {
      return rejected("DEFINITION_CONFLICT", ["expected-base-binding:mismatch"]);
    }
    const policies = normalizePolicies(input.allowlist);
    const operations = normalizeOperations(input.operations, policies);
    const next = canonicalClone(input.base.definition) as Record<string, JsonValue>;
    for (const operation of operations) applyOperation(next, operation, policies);
    const nextRevision = (BigInt(input.base.revision) + 1n).toString();
    const snapshot = createDefinitionSnapshot(input.base.definitionRef, nextRevision, next);
    return Object.freeze({
      kind: "accepted",
      nextDefinition: snapshot.definition,
      nextRevision,
      nextHash: snapshot.definitionHash,
      snapshot,
    });
  } catch (error) {
    const message = issueMessage(error);
    const code = message.startsWith("mechanical-field:")
      ? "MECHANICAL_FIELD_FORBIDDEN"
      : message.startsWith("base:")
        ? "DEFINITION_INVALID"
        : "SEMANTIC_OPERATION_INVALID";
    return rejected(code, [message]);
  }
}

function validateBase(base: DefinitionSnapshot): void {
  if (base.schema !== VNEXT_DEFINITION_SNAPSHOT_SCHEMA) throw new TypeError("base:schema-mismatch");
  assertRef(base.definitionRef, "base:definitionRef");
  assertRevision(base.revision, "base:revision");
  assertRef(base.definitionHash, "base:definitionHash");
  canonicalHash(base.definition);
  assertDefinitionContainsNoMechanicalFields(base.definition);
  if (base.definitionHash !== definitionSnapshotHash(base.definitionRef, base.revision, base.definition)) {
    throw new TypeError("base:definition-hash-invalid");
  }
}

function definitionSnapshotHash(
  definitionRef: string,
  revision: string,
  definition: JsonRecord,
): string {
  return canonicalHash({
    schema: VNEXT_DEFINITION_SNAPSHOT_SCHEMA,
    definitionRef,
    revision,
    definition,
  });
}

function normalizePolicies(
  allowlist: readonly SemanticFieldPolicy[],
): ReadonlyMap<string, SemanticFieldPolicy> {
  const policies = new Map<string, SemanticFieldPolicy>();
  for (const policy of allowlist) {
    const path = normalizePath(policy.path);
    assertNoMechanicalPath(path);
    const key = pathKey(path);
    if (policies.has(key)) throw new TypeError(`allowlist:${key}:duplicate-path`);
    if (policy.kind === "value") {
      policies.set(key, Object.freeze({
        kind: policy.kind,
        path,
        ...(policy.allowRemove === undefined ? {} : { allowRemove: policy.allowRemove }),
      }));
      continue;
    }
    if (policy.kind === "referenceArray") {
      assertSafeKey(policy.referenceField, `allowlist:${key}.referenceField`);
      assertNoMechanicalPath([policy.referenceField]);
      policies.set(key, Object.freeze({
        kind: policy.kind,
        path,
        referenceField: policy.referenceField,
      }));
      continue;
    }
    throw new TypeError(`allowlist:${key}:unsupported-kind`);
  }
  if (policies.size === 0) throw new TypeError("allowlist:non-empty-required");
  return policies;
}

function normalizeOperations(
  operations: readonly SemanticDefinitionOperation[],
  policies: ReadonlyMap<string, SemanticFieldPolicy>,
): readonly SemanticDefinitionOperation[] {
  if (operations.length === 0) throw new TypeError("operations:non-empty-required");
  const normalized = operations.map((operation) => {
    const path = normalizePath(operation.path);
    assertNoMechanicalPath(path);
    const policy = policies.get(pathKey(path));
    if (policy === undefined) throw new TypeError(`operation:${pathKey(path)}:not-allowlisted`);
    if (operation.kind === "set") {
      if (policy.kind !== "value") throw new TypeError(`operation:${pathKey(path)}:value-policy-required`);
      assertNoMechanicalValue(operation.value, pathKey(path));
      return deepFreeze({ kind: operation.kind, path, value: canonicalClone(operation.value) });
    }
    if (operation.kind === "remove") {
      if (policy.kind !== "value" || policy.allowRemove !== true) {
        throw new TypeError(`operation:${pathKey(path)}:remove-not-allowed`);
      }
      return Object.freeze({ kind: operation.kind, path });
    }
    if (operation.kind === "upsertByRef") {
      if (policy.kind !== "referenceArray") {
        throw new TypeError(`operation:${pathKey(path)}:reference-array-policy-required`);
      }
      assertNoMechanicalValue(operation.entry, pathKey(path));
      const ref = operation.entry[policy.referenceField];
      assertRef(ref, `operation:${pathKey(path)}.${policy.referenceField}`);
      return deepFreeze({ kind: operation.kind, path, entry: canonicalClone(operation.entry) });
    }
    if (operation.kind === "removeByRef") {
      if (policy.kind !== "referenceArray") {
        throw new TypeError(`operation:${pathKey(path)}:reference-array-policy-required`);
      }
      assertRef(operation.ref, `operation:${pathKey(path)}.ref`);
      return Object.freeze({ kind: operation.kind, path, ref: operation.ref });
    }
    return assertNever(operation);
  });
  assertOperationsDoNotConflict(normalized, policies);
  return Object.freeze([...normalized].sort((left, right) =>
    compareCodeUnits(operationIdentity(left, policies), operationIdentity(right, policies))));
}

function assertOperationsDoNotConflict(
  operations: readonly SemanticDefinitionOperation[],
  policies: ReadonlyMap<string, SemanticFieldPolicy>,
): void {
  const identities = new Set<string>();
  const paths = operations.map((operation) => pathKey(operation.path));
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (paths[left] !== paths[right]
        && (paths[left]!.startsWith(`${paths[right]}.`) || paths[right]!.startsWith(`${paths[left]}.`))) {
        throw new TypeError(`operations:${paths[left]}:${paths[right]}:overlapping-paths`);
      }
    }
  }
  for (const operation of operations) {
    const identity = operationIdentity(operation, policies);
    if (identities.has(identity)) throw new TypeError(`operations:${identity}:conflict`);
    identities.add(identity);
  }
}

function operationIdentity(
  operation: SemanticDefinitionOperation,
  policies: ReadonlyMap<string, SemanticFieldPolicy>,
): string {
  const key = pathKey(operation.path);
  if (operation.kind === "set" || operation.kind === "remove") return `value:${key}`;
  const policy = policies.get(key);
  if (policy?.kind !== "referenceArray") throw new TypeError(`operation:${key}:policy-missing`);
  const ref = operation.kind === "removeByRef"
    ? operation.ref
    : operation.entry[policy.referenceField];
  return `array:${key}:${String(ref)}`;
}

function applyOperation(
  root: Record<string, JsonValue>,
  operation: SemanticDefinitionOperation,
  policies: ReadonlyMap<string, SemanticFieldPolicy>,
): void {
  const { parent, key } = parentAtPath(root, operation.path, operation.kind === "set" || operation.kind === "upsertByRef");
  if (operation.kind === "set") {
    parent[key] = canonicalClone(operation.value);
    return;
  }
  if (operation.kind === "remove") {
    if (!Object.hasOwn(parent, key)) throw new TypeError(`operation:${pathKey(operation.path)}:target-missing`);
    delete parent[key];
    return;
  }
  const policy = policies.get(pathKey(operation.path));
  if (policy?.kind !== "referenceArray") throw new TypeError(`operation:${pathKey(operation.path)}:policy-missing`);
  const existing = parent[key];
  const array = existing === undefined && operation.kind === "upsertByRef"
    ? []
    : validateReferenceArray(existing, policy.referenceField, pathKey(operation.path));
  const byRef = new Map(array.map((entry) => [String(entry[policy.referenceField]), entry]));
  if (operation.kind === "upsertByRef") {
    byRef.set(String(operation.entry[policy.referenceField]), canonicalClone(operation.entry));
  } else if (!byRef.delete(operation.ref)) {
    throw new TypeError(`operation:${pathKey(operation.path)}:${operation.ref}:target-missing`);
  }
  parent[key] = [...byRef.values()].sort((left, right) =>
    compareCodeUnits(String(left[policy.referenceField]), String(right[policy.referenceField]))) as JsonValue[];
}

function validateReferenceArray(
  value: JsonValue | undefined,
  referenceField: string,
  label: string,
): Record<string, JsonValue>[] {
  if (!Array.isArray(value)) throw new TypeError(`operation:${label}:array-required`);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isPlainRecord(entry)) throw new TypeError(`operation:${label}:record-entry-required`);
    const ref = entry[referenceField];
    assertRef(ref, `operation:${label}.${referenceField}`);
    if (seen.has(ref)) throw new TypeError(`operation:${label}:${ref}:duplicate-ref`);
    seen.add(ref);
    return entry as Record<string, JsonValue>;
  });
}

function parentAtPath(
  root: Record<string, JsonValue>,
  path: readonly string[],
  create: boolean,
): { parent: Record<string, JsonValue>; key: string } {
  let cursor = root;
  for (const segment of path.slice(0, -1)) {
    const child = cursor[segment];
    if (child === undefined && create) {
      const created: Record<string, JsonValue> = {};
      cursor[segment] = created;
      cursor = created;
      continue;
    }
    if (!isPlainRecord(child)) throw new TypeError(`operation:${pathKey(path)}:parent-record-required`);
    cursor = child as Record<string, JsonValue>;
  }
  return { parent: cursor, key: path.at(-1)! };
}

function normalizePath(path: readonly string[]): readonly string[] {
  if (!Array.isArray(path) || path.length === 0 || path.length > 12) {
    throw new TypeError("path:bounded-non-empty-required");
  }
  for (const [index, segment] of path.entries()) assertSafeKey(segment, `path[${index}]`);
  return Object.freeze([...path]);
}

function assertSafeKey(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value)
    || value.length > 120
    || ["__proto__", "constructor", "prototype"].includes(value)) {
    throw new TypeError(`${label}:unsafe-key`);
  }
}

function assertNoMechanicalPath(path: readonly string[]): void {
  for (const segment of path) {
    if (MECHANICAL_FIELD_KEYS.has(normalizedFieldKey(segment))) {
      throw new TypeError(`mechanical-field:${pathKey(path)}`);
    }
  }
}

function assertNoMechanicalValue(value: unknown, label: string, depth = 0): void {
  if (depth > 20) throw new TypeError(`operation:${label}:value-depth-exceeded`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoMechanicalValue(entry, `${label}[${index}]`, depth + 1));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (MECHANICAL_FIELD_KEYS.has(normalizedFieldKey(key))) {
      throw new TypeError(`mechanical-field:${label}.${key}`);
    }
    assertNoMechanicalValue(child, `${label}.${key}`, depth + 1);
  }
}

function assertDefinitionContainsNoMechanicalFields(definition: JsonRecord): void {
  try {
    assertNoMechanicalValue(definition, "base.definition");
  } catch (error) {
    const message = issueMessage(error);
    if (message.startsWith("mechanical-field:")) throw new TypeError(`base:${message}`);
    throw error;
  }
}

function normalizedFieldKey(value: string): string {
  return value.replace(/[-_\s]/gu, "").toLowerCase();
}

function pathKey(path: readonly string[]): string {
  return path.join(".");
}

function assertRevision(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${label}:canonical-nonnegative-integer-required`);
  }
}

function assertRef(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value) || value.length > 300) throw new TypeError(`${label}:invalid-ref`);
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (!isSha256(value)) throw new TypeError(`${label}:invalid-sha256`);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isLocalMaterializationHandle(value: unknown): value is string {
  return typeof value === "string" && LOCAL_MATERIALIZATION_HANDLE.test(value);
}

function isRef(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 300;
}

function isText(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 4_000;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isCanonicalReadSet(
  value: unknown,
): value is readonly Readonly<{ ref: string; revisionOrHash: string }>[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 128
    && value.every((entry) => isPlainRecord(entry)
      && hasExactKeys(entry, ["ref", "revisionOrHash"])
      && isRef(entry.ref)
      && isRef(entry.revisionOrHash))
    && value.every((entry, index) => index === 0
      || String(value[index - 1].ref) < String(entry.ref));
}

function isCanonicalRefSet(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= 128
    && value.every(isRef)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function rejected(
  code: Extract<DefinitionCompositionResult, { kind: "rejected" }>['code'],
  issues: readonly string[],
): Extract<DefinitionCompositionResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...issues].sort(compareCodeUnits)),
  });
}

function assertNever(value: never): never {
  throw new TypeError(`operation.kind:unsupported:${String((value as { kind?: unknown }).kind)}`);
}

function canonicalHash(value: unknown): string {
  return canonicalSha256(value);
}

function canonicalClone<T>(value: T): T {
  canonicalHash(value);
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function issueMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown-error";
}
