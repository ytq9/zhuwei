import { ABILITY_COMPILER_PROFILE } from "./manifests";
import { canonicalProfileBytes, canonicalSha256 } from "./canonical";
import type { ProfileRef, Sha256Ref } from "./types";
import type { JsonRecord } from "../v2/model";
import { isRecord } from "../v2/validation";

export type MechanicOpFamily =
  | "Guard"
  | "Choice"
  | "Cost"
  | "Grant"
  | "Random"
  | "Damage"
  | "Recovery"
  | "Effect"
  | "Spatial"
  | "Artifact"
  | "Resource"
  | "Entity"
  | "Encounter"
  | "Activity"
  | "Time"
  | "Evidence"
  | "Knowledge"
  | "Trigger";

export type MechanicOp = {
  opId: string;
  family: MechanicOpFamily;
  sourcePath: string;
  input: JsonRecord;
  next: string[];
};

export type CompiledAbilityArtifact = {
  definition: JsonRecord;
  definitionHash: Sha256Ref;
  compilerProfile: ProfileRef;
  mechanicGraph: {
    entryOpIds: string[];
    operations: MechanicOp[];
  };
  compiledHash: Sha256Ref;
  referenceClosure: string[];
};

export type DefinitionRegisteredAbilityPayload = CompiledAbilityArtifact;

export type AbilityCompileFailureCode =
  | "definitionComplexityExceeded"
  | "invalidAbilityDefinition"
  | "unsupportedMechanicPrimitive"
  | "unsupportedRulesBasis";

export type AbilityCompileResult =
  | { ok: true; artifact: CompiledAbilityArtifact }
  | {
      ok: false;
      code: AbilityCompileFailureCode;
      publicMessage: string;
      diagnostics: Array<{ path: string; reason: string }>;
    };

const SET_ARRAY_KEYS = new Set(["aliases", "tags"]);
const MECHANICAL_DEFINITION_KINDS = new Set([
  "ability",
  "classfeature",
  "environmenthazard",
  "hazard",
  "monsteraction",
  "objectability",
  "spell",
  "weapon",
]);
const FORBIDDEN_KEYS = new Set([
  "callback",
  "code",
  "compiledgraph",
  "compiledhash",
  "compilerprofile",
  "definitionhash",
  "emit",
  "eventpayload",
  "function",
  "javascript",
  "jsonpatch",
  "mechanicops",
  "mechanicgraph",
  "opid",
  "patch",
  "script",
  "setpath",
  "sourcepath",
  "sql",
  "statepatch",
  "referenceclosure",
]);
const FORBIDDEN_SEMANTICS = new Set([
  "2024",
  "5.5e",
  "d&d-2024",
  "dnd2024",
  "latest",
  "weapon-mastery",
  "weaponmastery",
]);
const MAX_CANONICAL_BYTES = 65_536;
const MAX_RESOLUTION_NODES = 256;
const MAX_CHOICE_BRANCHES = 32;
const MAX_EXPRESSION_NODES = 128;
const MAX_TRIGGER_EDGES = 64;
const MAX_DEPTH = 32;
const MAX_DICE_TERMS = 32;
const MAX_DICE_COUNT = 1_000;

function normalizedFieldName(key: string): string {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

function containsForbiddenMechanicField(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsForbiddenMechanicField(entry, seen));
  return Object.entries(value).some(([key, entry]) =>
    FORBIDDEN_KEYS.has(normalizedFieldName(key)) || containsForbiddenMechanicField(entry, seen));
}

const FAMILY_BY_KIND: Readonly<Record<string, MechanicOpFamily>> = Object.freeze({
  guard: "Guard",
  choice: "Choice",
  cost: "Cost",
  grant: "Grant",
  random: "Random",
  damage: "Damage",
  recovery: "Recovery",
  effect: "Effect",
  spatial: "Spatial",
  artifact: "Artifact",
  resource: "Resource",
  entity: "Entity",
  encounter: "Encounter",
  activity: "Activity",
  time: "Time",
  evidence: "Evidence",
  knowledge: "Knowledge",
  trigger: "Trigger",
});

class CompileDiagnostic extends Error {
  readonly code: AbilityCompileFailureCode;
  readonly path: string;

  constructor(code: AbilityCompileFailureCode, path: string, message: string) {
    super(message);
    this.code = code;
    this.path = path;
  }
}

function normalizeDefinitionValue(value: unknown, path: string, parentKey?: string, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    throw new CompileDiagnostic("definitionComplexityExceeded", path, "definition nesting exceeds the compiler profile");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.normalize("NFC") !== value) {
      throw new CompileDiagnostic("invalidAbilityDefinition", path, "strings must already use Unicode NFC");
    }
    if (FORBIDDEN_SEMANTICS.has(value.toLowerCase().replaceAll("_", "-"))) {
      throw new CompileDiagnostic("unsupportedRulesBasis", path, "unsupported 2024/latest semantics");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new CompileDiagnostic("invalidAbilityDefinition", path, "numbers must be finite and cannot be negative zero");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.some((_, index) => !(index in value))) {
      throw new CompileDiagnostic("invalidAbilityDefinition", path, "sparse arrays are not canonical");
    }
    const normalized = value.map((entry, index) => normalizeDefinitionValue(entry, `${path}/${index}`, undefined, depth + 1));
    if (parentKey !== undefined && SET_ARRAY_KEYS.has(parentKey)) {
      if (!normalized.every((entry) => typeof entry === "string")) {
        throw new CompileDiagnostic("invalidAbilityDefinition", path, `${parentKey} must be a string set`);
      }
      return [...new Set(normalized as string[])].sort();
    }
    return normalized;
  }
  if (!isRecord(value)) {
    throw new CompileDiagnostic("invalidAbilityDefinition", path, "definitions only accept canonical JSON records");
  }
  const result: JsonRecord = {};
  for (const key of Object.keys(value).sort()) {
    if (key.normalize("NFC") !== key) {
      throw new CompileDiagnostic("invalidAbilityDefinition", `${path}/${key}`, "keys must already use Unicode NFC");
    }
    const normalizedKey = normalizedFieldName(key);
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      throw new CompileDiagnostic("unsupportedMechanicPrimitive", `${path}/${key}`, "caller-supplied executable primitive is forbidden");
    }
    if (["mastery", "weaponmastery", "spellperturnlimit"].includes(normalizedKey)) {
      throw new CompileDiagnostic("unsupportedRulesBasis", `${path}/${key}`, "the field expresses unsupported 2024 semantics");
    }
    result[key] = normalizeDefinitionValue(value[key], `${path}/${key}`, key, depth + 1) as JsonRecord[string];
  }
  return result;
}

function validateRulesBasis(definition: JsonRecord): void {
  if (definition.rulesBasis === "srd5.1-2014") return;
  if (isRecord(definition.rulesBasis)
    && definition.rulesBasis.kind === "zhuwei-product-ruling"
    && isRecord(definition.rulesBasis.profileRef)
    && typeof definition.rulesBasis.profileRef.profileId === "string"
    && /^sha256:[0-9a-f]{64}$/.test(String(definition.rulesBasis.profileRef.profileHash))) return;
  throw new CompileDiagnostic("unsupportedRulesBasis", "/rulesBasis", "rulesBasis must pin SRD 5.1/2014 or a registered product ruling");
}

function validateUnsupportedSemanticShape(definition: JsonRecord): void {
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}/${index}`));
      return;
    }
    if (!isRecord(value)) return;
    const normalizedKeys = new Set(Object.keys(value)
      .map((key) => key.toLowerCase().replaceAll("_", "").replaceAll("-", "")));
    const normalizedValues = Object.values(value)
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase().replaceAll("_", "").replaceAll("-", ""));
    const mentionsWeapon = normalizedKeys.has("weapon") || normalizedValues.includes("weapon");
    const mentionsMasteryProperty = normalizedKeys.has("masteryproperty")
      || normalizedValues.includes("masteryproperty");
    if (mentionsWeapon && mentionsMasteryProperty) {
      throw new CompileDiagnostic("unsupportedRulesBasis", path, "weapon mastery is not part of SRD 5.1/2014");
    }
    const mentionsSpellSlot = [...normalizedKeys, ...normalizedValues]
      .some((entry) => entry.includes("spellslot"));
    const mentionsPerTurn = [...normalizedKeys, ...normalizedValues]
      .some((entry) => entry.includes("perturn") || entry.includes("turnlimit"));
    const limit = [value.maximum, value.max, value.limit, value.ceiling]
      .find((entry) => typeof entry === "number" || typeof entry === "string");
    if (mentionsSpellSlot && mentionsPerTurn && String(limit) === "1") {
      throw new CompileDiagnostic("unsupportedRulesBasis", path, "per-turn spell-slot limits are not part of SRD 5.1/2014");
    }
    Object.entries(value).forEach(([key, entry]) => walk(entry, `${path}/${key}`));
  };
  walk(definition, "");
}

function walkComplexity(value: unknown, path = "", depth = 0): { expressionNodes: number; triggerEdges: number } {
  if (depth > MAX_DEPTH) {
    throw new CompileDiagnostic("definitionComplexityExceeded", path, "definition nesting exceeds the compiler profile");
  }
  if (Array.isArray(value)) {
    if ((path.endsWith("/choices") || path.endsWith("/branches")) && value.length > MAX_CHOICE_BRANCHES) {
      throw new CompileDiagnostic("definitionComplexityExceeded", path, "choice branch count exceeds the compiler profile");
    }
    if (path.endsWith("/triggers") && value.length > MAX_TRIGGER_EDGES) {
      throw new CompileDiagnostic("definitionComplexityExceeded", path, "trigger edge count exceeds the compiler profile");
    }
    return value.reduce((total, entry, index) => {
      const nested = walkComplexity(entry, `${path}/${index}`, depth + 1);
      return {
        expressionNodes: total.expressionNodes + nested.expressionNodes,
        triggerEdges: total.triggerEdges + nested.triggerEdges,
      };
    }, { expressionNodes: path.includes("expression") ? 1 : 0, triggerEdges: path.endsWith("/triggers") ? value.length : 0 });
  }
  if (!isRecord(value)) return { expressionNodes: path.includes("expression") ? 1 : 0, triggerEdges: 0 };
  let expressionNodes = path.includes("expression") ? 1 : 0;
  let triggerEdges = 0;
  for (const [key, entry] of Object.entries(value)) {
    const nested = walkComplexity(entry, `${path}/${key}`, depth + 1);
    expressionNodes += nested.expressionNodes;
    triggerEdges += nested.triggerEdges;
  }
  if (expressionNodes > MAX_EXPRESSION_NODES) {
    throw new CompileDiagnostic("definitionComplexityExceeded", path, "expression node count exceeds the compiler profile");
  }
  if (triggerEdges > MAX_TRIGGER_EDGES) {
    throw new CompileDiagnostic("definitionComplexityExceeded", path, "trigger edge count exceeds the compiler profile");
  }
  return { expressionNodes, triggerEdges };
}

function validateDice(value: unknown, path = ""): number {
  let terms = 0;
  const inspect = (entry: unknown, cursor: string): void => {
    if (typeof entry === "string") {
      const matches = [...entry.matchAll(/(?:^|[+-])(\d+)d(\d+)/g)];
      for (const match of matches) {
        terms += 1;
        if (Number(match[1]) > MAX_DICE_COUNT) {
          throw new CompileDiagnostic("definitionComplexityExceeded", cursor, "a dice term exceeds 1,000 dice");
        }
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((nested, index) => inspect(nested, `${cursor}/${index}`));
      return;
    }
    if (isRecord(entry)) {
      Object.entries(entry).forEach(([key, nested]) => inspect(nested, `${cursor}/${key}`));
    }
  };
  inspect(value, path);
  if (terms > MAX_DICE_TERMS) {
    throw new CompileDiagnostic("definitionComplexityExceeded", path, "dice term count exceeds the compiler profile");
  }
  return terms;
}

function stableOpId(definitionHash: Sha256Ref, path: string): string {
  return `op:${canonicalSha256({ definitionHash, path }).slice("sha256:".length)}`;
}

function op(
  definitionHash: Sha256Ref,
  family: MechanicOpFamily,
  path: string,
  input: JsonRecord,
): MechanicOp {
  return { opId: stableOpId(definitionHash, path), family, sourcePath: path, input: structuredClone(input), next: [] };
}

function derivedOperations(definition: JsonRecord, definitionHash: Sha256Ref): MechanicOp[] {
  const operations: MechanicOp[] = [];
  if (isRecord(definition.activation)) operations.push(op(definitionHash, "Guard", "/activation", definition.activation));
  if (isRecord(definition.target)) {
    operations.push(op(definitionHash, "Guard", "/target", definition.target));
    if (definition.target.kind === "area") operations.push(op(definitionHash, "Spatial", "/target/area", definition.target));
    if ((definition.target.kind === "creature"
      || definition.target.kind === "creatureOrEnvironmentFeature")
      && String(definition.target.count ?? "1") !== "0") {
      operations.push(op(definitionHash, "Choice", "/target/selection", { target: structuredClone(definition.target) }));
    }
  }
  if (Array.isArray(definition.costs)) {
    definition.costs.forEach((cost, index) => {
      if (isRecord(cost)) operations.push(op(definitionHash, "Cost", `/costs/${index}`, cost));
    });
  }
  if (Array.isArray(definition.grants)) {
    definition.grants.forEach((grant, index) => {
      if (isRecord(grant)) operations.push(op(definitionHash, "Grant", `/grants/${index}`, grant));
    });
  }
  if (isRecord(definition.attack)) operations.push(op(definitionHash, "Random", "/attack", definition.attack));
  if (isRecord(definition.save)) operations.push(op(definitionHash, "Random", "/save", definition.save));
  if (Array.isArray(definition.damage)) {
    operations.push(op(definitionHash, "Random", "/damage/randomness", { components: structuredClone(definition.damage) }));
    operations.push(op(definitionHash, "Damage", "/damage/application", { components: structuredClone(definition.damage) }));
  }
  if (isRecord(definition.healing)) {
    operations.push(op(definitionHash, "Random", "/healing/randomness", definition.healing));
    operations.push(op(definitionHash, "Recovery", "/healing/application", definition.healing));
  }
  if (isRecord(definition.temporaryHitPoints)) {
    operations.push(op(definitionHash, "Random", "/temporaryHitPoints/randomness", definition.temporaryHitPoints));
    operations.push(op(definitionHash, "Recovery", "/temporaryHitPoints/application", definition.temporaryHitPoints));
  }
  if (isRecord(definition.effect)) operations.push(op(definitionHash, "Effect", "/effect", definition.effect));
  if (Array.isArray(definition.effects)) {
    definition.effects.forEach((effect, index) => {
      if (isRecord(effect)) operations.push(op(definitionHash, "Effect", `/effects/${index}`, effect));
    });
  }
  if (isRecord(definition.trigger) || Array.isArray(definition.triggers)) {
    operations.push(op(definitionHash, "Trigger", "/triggers", {
      values: structuredClone(definition.triggers ?? [definition.trigger]),
    }));
  }
  return operations;
}

function explicitOperations(definition: JsonRecord, definitionHash: Sha256Ref): MechanicOp[] | undefined {
  if (definition.resolution === undefined) return undefined;
  const resolution = definition.resolution;
  if (!Array.isArray(resolution)
    || resolution.length === 0
    || resolution.length > MAX_RESOLUTION_NODES) {
    throw new CompileDiagnostic("definitionComplexityExceeded", "/resolution", "resolution node count is outside the compiler profile");
  }
  const nodeIds = resolution.map((node, index) => isRecord(node) && typeof node.nodeId === "string"
    ? node.nodeId
    : `node:${index}`);
  const ids = new Set(nodeIds);
  if (ids.size !== nodeIds.length) {
    throw new CompileDiagnostic("invalidAbilityDefinition", "/resolution", "resolution node id is duplicated");
  }
  const operations = resolution.map((node, index) => {
    if (!isRecord(node) || typeof node.kind !== "string") {
      throw new CompileDiagnostic("invalidAbilityDefinition", `/resolution/${index}`, "resolution node is malformed");
    }
    const family = FAMILY_BY_KIND[node.kind.toLowerCase()];
    if (family === undefined) {
      throw new CompileDiagnostic("unsupportedMechanicPrimitive", `/resolution/${index}/kind`, "resolution primitive is not registered");
    }
    if (family === "Choice"
      && ![node.controller, node.controllerRef].some((entry) => typeof entry === "string" && entry.length > 0)) {
      throw new CompileDiagnostic("invalidAbilityDefinition", `/resolution/${index}`, "choice node is not bound to a controller");
    }
    const nodeId = nodeIds[index];
    const next = node.next === undefined
      ? (index + 1 < resolution.length ? [nodeIds[index + 1]] : [])
      : Array.isArray(node.next) && node.next.every((entry) => typeof entry === "string")
        ? [...node.next]
        : undefined;
    if (next === undefined) {
      throw new CompileDiagnostic("invalidAbilityDefinition", `/resolution/${index}/next`, "resolution edges are malformed");
    }
    const input = Object.fromEntries(
      Object.entries(node).filter(([key]) => !["kind", "next", "nodeId"].includes(key)),
    );
    return {
      ...op(definitionHash, family, `/resolution/${index}`, input),
      opId: stableOpId(definitionHash, `/resolution/${nodeId}`),
      next,
    };
  });
  const opByNode = new Map<string, MechanicOp>();
  nodeIds.forEach((nodeId, index) => opByNode.set(nodeId, operations[index]));
  for (const operation of operations) {
    operation.next = operation.next.map((nodeId) => {
      const target = opByNode.get(nodeId);
      if (target === undefined) {
        throw new CompileDiagnostic("invalidAbilityDefinition", operation.sourcePath, "resolution edge references an unknown node");
      }
      return target.opId;
    });
  }
  assertAcyclic(operations);
  return operations;
}

function assertAcyclic(operations: MechanicOp[]): void {
  const byId = new Map(operations.map((operation) => [operation.opId, operation]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (opId: string): void => {
    if (visiting.has(opId)) {
      throw new CompileDiagnostic("invalidAbilityDefinition", "/resolution", "trigger/resolution graph contains a cycle");
    }
    if (visited.has(opId)) return;
    visiting.add(opId);
    const operation = byId.get(opId);
    operation?.next.forEach(visit);
    visiting.delete(opId);
    visited.add(opId);
  };
  operations.forEach(({ opId }) => visit(opId));
}

function linkLinearOperations(operations: MechanicOp[]): void {
  operations.forEach((operation, index) => {
    operation.next = index + 1 < operations.length ? [operations[index + 1].opId] : [];
  });
}

function referenceClosure(definition: JsonRecord): string[] {
  const references = new Set<string>();
  const walk = (value: unknown, key = ""): void => {
    if (typeof value === "string" && key !== "definitionId"
      && (key.endsWith("Ref") || key.endsWith("Id")) && value.includes(":")) references.add(value);
    else if (Array.isArray(value)) value.forEach((entry) => walk(entry, key));
    else if (isRecord(value)) Object.entries(value).forEach(([nestedKey, entry]) => walk(entry, nestedKey));
  };
  walk(definition);
  return [...references].sort();
}

function entryOperations(operations: MechanicOp[]): string[] {
  const inbound = new Set(operations.flatMap(({ next }) => next));
  return operations.filter(({ opId }) => !inbound.has(opId)).map(({ opId }) => opId).sort();
}

export function compileAbilityDefinition(value: unknown): AbilityCompileResult {
  try {
    if (!isRecord(value)
      || typeof value.definitionId !== "string"
      || value.definitionId.length === 0
      || typeof value.revision !== "string"
      || value.revision.length === 0) {
      throw new CompileDiagnostic("invalidAbilityDefinition", "/", "definition id and revision are required");
    }
    const definition = normalizeDefinitionValue(value, "/") as JsonRecord;
    validateRulesBasis(definition);
    validateUnsupportedSemanticShape(definition);
    const canonicalBytes = canonicalProfileBytes(definition);
    if (canonicalBytes.length > MAX_CANONICAL_BYTES) {
      throw new CompileDiagnostic("definitionComplexityExceeded", "/", "canonical definition exceeds 65,536 bytes");
    }
    walkComplexity(definition);
    validateDice(definition);
    const definitionHash = canonicalSha256(definition);
    const explicit = explicitOperations(definition, definitionHash);
    const operations = explicit ?? derivedOperations(definition, definitionHash);
    if (operations.length === 0) {
      throw new CompileDiagnostic("unsupportedMechanicPrimitive", "/", "definition has no executable mechanic");
    }
    if (operations.length > MAX_RESOLUTION_NODES) {
      throw new CompileDiagnostic("definitionComplexityExceeded", "/", "compiled graph exceeds 256 nodes");
    }
    if (explicit === undefined) linkLinearOperations(operations);
    assertAcyclic(operations);
    const mechanicGraph = { entryOpIds: entryOperations(operations), operations };
    const compiledHash = canonicalSha256({
      compilerProfile: ABILITY_COMPILER_PROFILE,
      definitionHash,
      mechanicGraph,
    });
    return {
      ok: true,
      artifact: {
        definition,
        definitionHash,
        compilerProfile: structuredClone(ABILITY_COMPILER_PROFILE),
        mechanicGraph,
        compiledHash,
        referenceClosure: referenceClosure(definition),
      },
    };
  } catch (error) {
    const diagnostic = error instanceof CompileDiagnostic
      ? error
      : new CompileDiagnostic("invalidAbilityDefinition", "/", "definition is not canonical");
    return {
      ok: false,
      code: diagnostic.code,
      publicMessage: "该能力定义无法由当前 2014 规则版本执行，请 KP 修订后重提。",
      diagnostics: [{ path: diagnostic.path, reason: diagnostic.message }],
    };
  }
}

function canonicalStringSet(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function sameProfile(left: unknown, right: ProfileRef): boolean {
  return isRecord(left)
    && Object.keys(left).length === 2
    && left.profileId === right.profileId
    && left.profileHash === right.profileHash;
}

function isMechanicOp(value: unknown): value is MechanicOp {
  return isRecord(value)
    && Object.keys(value).sort().join(",") === "family,input,next,opId,sourcePath"
    && typeof value.opId === "string"
    && value.opId.startsWith("op:")
    && typeof value.family === "string"
    && Object.values(FAMILY_BY_KIND).includes(value.family as MechanicOpFamily)
    && typeof value.sourcePath === "string"
    && isRecord(value.input)
    && Array.isArray(value.next)
    && value.next.every((entry) => typeof entry === "string" && entry.startsWith("op:"));
}

/** Replay validator for a frozen compiler artifact. It never invokes the compiler. */
export function isDefinitionRegisteredAbilityPayload(
  value: unknown,
): value is DefinitionRegisteredAbilityPayload {
  if (!isRecord(value)
    || Object.keys(value).sort().join(",")
      !== "compiledHash,compilerProfile,definition,definitionHash,mechanicGraph,referenceClosure"
    || !isRecord(value.definition)
    || typeof value.definitionHash !== "string"
    || value.definitionHash !== canonicalSha256(value.definition)
    || !sameProfile(value.compilerProfile, ABILITY_COMPILER_PROFILE)
    || !isRecord(value.mechanicGraph)
    || Object.keys(value.mechanicGraph).sort().join(",") !== "entryOpIds,operations"
    || !Array.isArray(value.mechanicGraph.operations)
    || value.mechanicGraph.operations.length === 0
    || value.mechanicGraph.operations.length > MAX_RESOLUTION_NODES
    || !value.mechanicGraph.operations.every(isMechanicOp)
    || !Array.isArray(value.mechanicGraph.entryOpIds)
    || !value.mechanicGraph.entryOpIds.every((entry) => typeof entry === "string")
    || !canonicalStringSet(value.referenceClosure)) return false;
  const operations = value.mechanicGraph.operations as MechanicOp[];
  const ids = new Set(operations.map(({ opId }) => opId));
  if (ids.size !== operations.length
    || !value.mechanicGraph.entryOpIds.every((opId) => ids.has(opId))
    || operations.some(({ next }) => next.some((opId) => !ids.has(opId)))) return false;
  try {
    assertAcyclic(operations);
  } catch {
    return false;
  }
  return value.compiledHash === canonicalSha256({
    compilerProfile: value.compilerProfile,
    definitionHash: value.definitionHash,
    mechanicGraph: value.mechanicGraph,
  });
}

/** Single frozen catalog record consumed by the interpreter; graph fields stay private. */
export function registeredAbilityRecord(payload: DefinitionRegisteredAbilityPayload): JsonRecord {
  return {
    ...structuredClone(payload.definition),
    definitionHash: payload.definitionHash,
    compilerProfile: structuredClone(payload.compilerProfile),
    mechanicGraph: structuredClone(payload.mechanicGraph),
    compiledHash: payload.compiledHash,
    referenceClosure: [...payload.referenceClosure],
  };
}

/** Validates the frozen catalog representation without invoking the compiler. */
export function isRegisteredAbilityRecord(value: unknown): value is JsonRecord {
  if (!isRecord(value)
    || !isRecord(value.mechanicGraph)
    || typeof value.definitionHash !== "string"
    || !isRecord(value.compilerProfile)
    || typeof value.compiledHash !== "string"
    || !Array.isArray(value.referenceClosure)) return false;
  const metadataKeys = new Set([
    "compiledHash",
    "compilerProfile",
    "definitionHash",
    "mechanicGraph",
    "referenceClosure",
  ]);
  const definition = Object.fromEntries(
    Object.entries(value).filter(([key]) => !metadataKeys.has(key)),
  );
  return isDefinitionRegisteredAbilityPayload({
    definition,
    definitionHash: value.definitionHash,
    compilerProfile: value.compilerProfile,
    mechanicGraph: value.mechanicGraph,
    compiledHash: value.compiledHash,
    referenceClosure: value.referenceClosure,
  });
}

/**
 * Reads one operation from the graph frozen in DefinitionRegistered. This
 * validates the complete artifact and never invokes the current compiler.
 */
export function frozenRegisteredAbilityOperation(
  value: unknown,
  family: MechanicOpFamily,
): MechanicOp | undefined {
  if (!isRegisteredAbilityRecord(value)) return undefined;
  const metadataKeys = new Set([
    "compiledHash",
    "compilerProfile",
    "definitionHash",
    "mechanicGraph",
    "referenceClosure",
  ]);
  const definition = Object.fromEntries(
    Object.entries(value).filter(([key]) => !metadataKeys.has(key)),
  );
  const payload = {
    definition,
    definitionHash: value.definitionHash,
    compilerProfile: value.compilerProfile,
    mechanicGraph: value.mechanicGraph,
    compiledHash: value.compiledHash,
    referenceClosure: value.referenceClosure,
  };
  if (!isDefinitionRegisteredAbilityPayload(payload)) return undefined;
  const operation = payload.mechanicGraph.operations.find((entry) => entry.family === family);
  return operation === undefined ? undefined : structuredClone(operation);
}

/** Safe summary for a viewer already authorized to know the definition. */
export function projectRegisteredAbility(value: JsonRecord): JsonRecord {
  const visibleKeys = [
    "activation",
    "aliases",
    "compiledHash",
    "compilerProfile",
    "definitionHash",
    "definitionId",
    "definitionKind",
    "parameterSchema",
    "publicDescription",
    "revision",
    "rulesBasis",
    "tags",
  ] as const;
  return Object.fromEntries(visibleKeys.flatMap((key) =>
    value[key] === undefined ? [] : [[key, structuredClone(value[key])]]));
}

export function isAbilityDefinitionCandidate(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.definitionId !== "string"
    || typeof value.revision !== "string") return false;
  const definitionKind = typeof value.definitionKind === "string"
    ? normalizedFieldName(value.definitionKind)
    : "";
  return MECHANICAL_DEFINITION_KINDS.has(definitionKind)
    || containsForbiddenMechanicField(value)
    || [
      "activation",
      "attack",
      "costs",
      "damage",
      "effect",
      "effects",
      "grants",
      "healing",
      "temporaryHitPoints",
      "resolution",
      "save",
      "target",
      "trigger",
      "triggers",
    ].some((key) => key in value);
}
