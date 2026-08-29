import {
  KP_FORM_CATALOG_REGISTRATION,
  KP_FORM_IDS,
  type KpFormId,
  validateKpFormDraft,
} from "./form-catalog";

export const CAUSAL_PRIMITIVES = Object.freeze([
  "requestClarification",
  "inspectFiction",
  "exchangeWithNpc",
  "assessOrdinaryAction",
  "assessHighRiskAction",
  "refuseInWorld",
  "materializeOpenFact",
  "resolveCombatIntent",
  "resolveEnvironmentalStunt",
  "assessCausalStage",
  "joinCausalBranches",
] as const);

export type CausalPrimitive = (typeof CAUSAL_PRIMITIVES)[number];
export type CausalScalar = string | number | boolean | null;
export type CausalValue = CausalScalar | readonly CausalScalar[];

const CAUSAL_ACTION_LANGUAGE_REGISTRATION = Object.freeze({
  languageRef: "causal-action-program-v3",
  languageVersion: "causal-action-program-v3.4",
  primitiveArgumentSchemaVersion: "causal-primitive-arguments-v3.4",
  formCatalogRef: KP_FORM_CATALOG_REGISTRATION.catalogRef,
  formCatalogHash: KP_FORM_CATALOG_REGISTRATION.catalogHash,
  legacyActionPlanVersion: "authoritative-kp-action-plan-v1",
  maxNodes: 16,
  maxDepth: 8,
  primitiveVocabulary: CAUSAL_PRIMITIVES,
});

export const CAUSAL_ACTION_LANGUAGE_PROFILE = Object.freeze({
  ...CAUSAL_ACTION_LANGUAGE_REGISTRATION,
  languageHash: stableStructuralHash(CAUSAL_ACTION_LANGUAGE_REGISTRATION),
});

export type CausalNode = Readonly<{
  nodeId: string;
  primitive: CausalPrimitive;
  dependsOn: readonly string[];
  arguments: Readonly<Record<string, CausalValue>>;
}>;

export type CausalActionProgram = Readonly<{
  languageRef: string;
  languageHash: string;
  formRef: KpFormId;
  formHash: string;
  nodes: readonly CausalNode[];
  resultNodeIds: readonly string[];
  semanticHash: string;
}>;

export type CausalProgramValidation = Readonly<{
  ok: boolean;
  errors: readonly string[];
  maxDepth: number;
}>;

const PROGRAM_KEYS = Object.freeze([
  "languageRef",
  "languageHash",
  "formRef",
  "formHash",
  "nodes",
  "resultNodeIds",
  "semanticHash",
]);
const NODE_KEYS = Object.freeze(["nodeId", "primitive", "dependsOn", "arguments"]);

const RESOLUTION_ARGUMENTS = Object.freeze([
  "resolution", "ability", "skill", "dc", "mode", "durationUnit", "durationValue",
  "successConsequence", "failureConsequence", "resourceRef", "resourceAmount",
  "artifactRef", "artifactCount",
]);

const PRIMITIVE_ARGUMENT_KEYS: Readonly<Record<CausalPrimitive, readonly string[]>> = Object.freeze({
  requestClarification: Object.freeze(["goal", "question", "choices", "reason", "basisRefs"]),
  inspectFiction: Object.freeze([
    "goal",
    "method",
    "focus",
    "desiredInformation",
    "basisRefs",
    "risk",
    ...RESOLUTION_ARGUMENTS,
  ]),
  exchangeWithNpc: Object.freeze([
    "goal",
    "method",
    "utterance",
    "desiredResponse",
    "npcResponse",
    "basisRefs",
    "risk",
    ...RESOLUTION_ARGUMENTS,
  ]),
  assessOrdinaryAction: Object.freeze([
    "goal",
    "method",
    "intendedOutcome",
    "risk",
    "basisRefs",
    "alternatives",
    ...RESOLUTION_ARGUMENTS,
  ]),
  assessHighRiskAction: Object.freeze([
    "goal",
    "method",
    "intendedOutcome",
    "risk",
    "stakes",
    "basisRefs",
    "alternatives",
    ...RESOLUTION_ARGUMENTS,
  ]),
  refuseInWorld: Object.freeze([
    "goal", "method", "reason", "alternatives", "basisRefs", "durationUnit", "durationValue",
  ]),
  materializeOpenFact: Object.freeze([
    "goal",
    "method",
    "proposedFact",
    "basisRefs",
    "risk",
    "alternatives",
    ...RESOLUTION_ARGUMENTS,
  ]),
  resolveCombatIntent: Object.freeze([
    "goal",
    "method",
    "intendedOutcome",
    "combatApproach",
    "abilityRef",
    "basisRefs",
    "risk",
    "contingencies",
  ]),
  resolveEnvironmentalStunt: Object.freeze([
    "goal",
    "method",
    "featureDescription",
    "intendedOutcome",
    "featureDisposition",
    "effectMode",
    "activation",
    "attackApproach",
    "abilityRef",
    "checkAbility",
    "checkSkill",
    "checkDc",
    "checkMode",
    "checkSuccessConsequence",
    "checkFailureConsequence",
    "material",
    "centerXInches",
    "centerYInches",
    "elevationInches",
    "widthInches",
    "depthInches",
    "heightInches",
    "objectAc",
    "objectHitPoints",
    "damageThreshold",
    "immuneDamageTypes",
    "initialPhase",
    "phaseNames",
    "phaseOpaque",
    "phaseImpassable",
    "phaseCover",
    "phaseEffectPropagation",
    "phaseTerrain",
    "damageFromPhases",
    "damageRemainingAtOrBelow",
    "damageToPhases",
    "stuntFromPhases",
    "stuntToPhases",
    "hazardFromPhases",
    "hazardToPhases",
    "hazardTriggerPhase",
    "hazardResolvedPhase",
    "trigger",
    "areaOriginElevationInches",
    "areaRadiusInches",
    "propagation",
    "spreadBudgetInches",
    "saveAbility",
    "saveDc",
    "halfOnSuccess",
    "damage",
    "damageType",
    "condition",
    "debrisOutcome",
    "basisRefs",
    "risk",
    "contingencies",
    "resourceRef",
    "resourceAmount",
  ]),
  assessCausalStage: Object.freeze([
    "goal", "method", "intendedOutcome", "risk", "basisRefs", "resolution", "ability",
    "skill", "dc", "mode", "successConsequence", "failureConsequence",
  ]),
  joinCausalBranches: Object.freeze([
    "intendedOutcome", "risk", "alternatives", ...RESOLUTION_ARGUMENTS,
  ]),
});

const PRIMITIVE_REQUIRED_ARGUMENT_KEYS: Readonly<Record<CausalPrimitive, readonly string[]>> = Object.freeze({
  requestClarification: Object.freeze(["goal", "question", "choices"]),
  inspectFiction: Object.freeze([
    "goal", "method", "focus", "desiredInformation", "resolution", "durationUnit", "durationValue",
  ]),
  exchangeWithNpc: Object.freeze([
    "goal", "method", "utterance", "desiredResponse", "npcResponse", "resolution",
    "durationUnit", "durationValue",
  ]),
  assessOrdinaryAction: Object.freeze([
    "goal", "method", "intendedOutcome", "risk", "ability", "skill", "dc", "mode",
    "durationUnit", "durationValue", "successConsequence", "failureConsequence",
  ]),
  assessHighRiskAction: Object.freeze([
    "goal", "method", "intendedOutcome", "risk", "stakes", "ability", "skill", "dc", "mode",
    "durationUnit", "durationValue", "successConsequence", "failureConsequence",
  ]),
  refuseInWorld: Object.freeze(["goal", "method", "reason", "alternatives", "durationUnit", "durationValue"]),
  materializeOpenFact: Object.freeze([
    "goal", "method", "proposedFact", "basisRefs", "resolution", "durationUnit", "durationValue",
  ]),
  resolveCombatIntent: Object.freeze(["goal", "method", "intendedOutcome", "combatApproach", "abilityRef"]),
  resolveEnvironmentalStunt: Object.freeze([
    "goal", "method", "featureDescription", "intendedOutcome", "featureDisposition",
  ]),
  assessCausalStage: Object.freeze(["goal", "method", "intendedOutcome", "resolution"]),
  joinCausalBranches: Object.freeze(["intendedOutcome", "resolution", "durationUnit", "durationValue"]),
});

const FORM_PRIMITIVE: Readonly<Partial<Record<KpFormId, CausalPrimitive>>> = Object.freeze({
  "clarification.v1": "requestClarification",
  "observe.v1": "inspectFiction",
  "npc-exchange.v1": "exchangeWithNpc",
  "ordinary-check.v1": "assessOrdinaryAction",
  "high-risk-action.v1": "assessHighRiskAction",
  "in-world-refusal.v1": "refuseInWorld",
  "materialization.v1": "materializeOpenFact",
  "combat-action.v1": "resolveCombatIntent",
  "environmental-stunt.v1": "resolveEnvironmentalStunt",
});

const FORBIDDEN_CAUSAL_KEYS = Object.freeze([
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
  "scope",
  "script",
]);

/** Compiles a validated model form into a server-owned, bounded causal graph. */
export function compileKpFormDraft(formRef: KpFormId, draft: unknown): CausalActionProgram {
  const draftValidation = validateKpFormDraft(formRef, draft);
  if (!draftValidation.ok) {
    throw new Error(`PROPOSAL_FORM_INVALID:${draftValidation.errors.join(",")}`);
  }
  const record = draft as Record<string, unknown>;
  const nodes = formRef === "compound.v1"
    ? compileCompoundNodes(record)
    : [compileSingleNode(FORM_PRIMITIVE[formRef], record)];
  const resultNodeIds = Object.freeze([nodes.at(-1)?.nodeId ?? ""]);
  const semanticSource = {
    languageRef: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
    languageHash: CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash,
    formRef,
    formHash: kpFormBindingHash(formRef),
    nodes,
    resultNodeIds,
  };
  const program: CausalActionProgram = Object.freeze({
    ...semanticSource,
    nodes: Object.freeze(nodes),
    semanticHash: stableStructuralHash(semanticSource),
  });
  const validation = validateCausalActionProgram(program);
  if (!validation.ok) throw new Error(`CAUSAL_ACTION_PROGRAM_INVALID:${validation.errors.join(",")}`);
  return program;
}

function compileSingleNode(primitive: CausalPrimitive | undefined, draft: Record<string, unknown>): CausalNode {
  if (primitive === undefined) throw new Error("CAUSAL_FORM_COMPILER_MISSING");
  return causalNode("n01", primitive, [], pickCausalArguments(draft, PRIMITIVE_ARGUMENT_KEYS[primitive]));
}

function compileCompoundNodes(draft: Record<string, unknown>): CausalNode[] {
  if (!Array.isArray(draft.stages) || draft.stages.length === 0) {
    throw new Error("PROPOSAL_FORM_INVALID:stages:required");
  }
  // Seven stages plus one join keeps both the node and depth contracts true.
  if (draft.stages.length > 7) throw new Error("CAUSAL_ACTION_PROGRAM_DEPTH_EXCEEDED");

  const nodes: CausalNode[] = [];
  for (const [index, rawStage] of draft.stages.entries()) {
    if (!isPlainRecord(rawStage)) throw new Error(`PROPOSAL_FORM_INVALID:stages[${index}]:object-required`);
    assertExactStage(rawStage, index);
    const nodeId = `n${String(index + 1).padStart(2, "0")}`;
    const dependency = nodes.at(-1)?.nodeId;
    nodes.push(causalNode(
      nodeId,
      "assessCausalStage",
      dependency === undefined ? [] : [dependency],
      pickCausalArguments(rawStage, PRIMITIVE_ARGUMENT_KEYS.assessCausalStage),
    ));
  }
  const joinId = `n${String(nodes.length + 1).padStart(2, "0")}`;
  nodes.push(causalNode(
    joinId,
    "joinCausalBranches",
    [nodes.at(-1)!.nodeId],
    pickCausalArguments(draft, PRIMITIVE_ARGUMENT_KEYS.joinCausalBranches),
  ));
  return nodes;
}

function assertExactStage(stage: Record<string, unknown>, index: number): void {
  const allowed = new Set(PRIMITIVE_ARGUMENT_KEYS.assessCausalStage);
  for (const key of Object.keys(stage)) {
    if (!allowed.has(key) || isForbiddenCausalKey(key)) {
      throw new Error(`PROPOSAL_FORM_INVALID:stages[${index}].${key}:forbidden`);
    }
  }
  for (const required of ["goal", "method", "intendedOutcome"]) {
    if (typeof stage[required] !== "string" || stage[required].trim().length === 0) {
      throw new Error(`PROPOSAL_FORM_INVALID:stages[${index}].${required}:required`);
    }
  }
}

function causalNode(
  nodeId: string,
  primitive: CausalPrimitive,
  dependsOn: readonly string[],
  args: Readonly<Record<string, CausalValue>>,
): CausalNode {
  return Object.freeze({
    nodeId,
    primitive,
    dependsOn: Object.freeze([...dependsOn]),
    arguments: args,
  });
}

function pickCausalArguments(
  source: Record<string, unknown>,
  keys: readonly string[],
): Readonly<Record<string, CausalValue>> {
  const result: Record<string, CausalValue> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = cloneCausalValue(source[key], key);
  }
  return Object.freeze(result);
}

function cloneCausalValue(value: unknown, path: string): CausalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (!value.every(isCausalScalar)) throw new Error(`CAUSAL_NESTED_VALUE_FORBIDDEN:${path}`);
    return Object.freeze([...value]);
  }
  throw new Error(`CAUSAL_VALUE_INVALID:${path}`);
}

export function validateCausalActionProgram(program: unknown): CausalProgramValidation {
  const errors: string[] = [];
  if (!isPlainRecord(program)) return validationResult(["program:object-required"], 0);
  assertExactKeys(program, PROGRAM_KEYS, "program", errors);
  if (program.languageRef !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef) errors.push("languageRef:mismatch");
  if (program.languageHash !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash) errors.push("languageHash:mismatch");
  const formRefKnown = typeof program.formRef === "string"
    && (KP_FORM_IDS as readonly string[]).includes(program.formRef);
  if (!formRefKnown) {
    errors.push("formRef:unknown");
  } else if (program.formHash !== kpFormBindingHash(program.formRef as KpFormId)) {
    errors.push("formHash:mismatch");
  }
  if (!Array.isArray(program.nodes)) errors.push("nodes:array-required");
  if (!Array.isArray(program.resultNodeIds)) errors.push("resultNodeIds:array-required");
  if (!Array.isArray(program.nodes) || !Array.isArray(program.resultNodeIds)) {
    return validationResult(errors, 0);
  }
  if (program.nodes.length === 0) errors.push("nodes:empty");
  if (program.nodes.length > CAUSAL_ACTION_LANGUAGE_PROFILE.maxNodes) errors.push("nodes:limit-exceeded");

  const byId = new Map<string, Record<string, unknown>>();
  for (const [index, rawNode] of program.nodes.entries()) {
    if (!isPlainRecord(rawNode)) {
      errors.push(`nodes[${index}]:object-required`);
      continue;
    }
    assertExactKeys(rawNode, NODE_KEYS, `nodes[${index}]`, errors);
    if (typeof rawNode.nodeId !== "string" || !/^n[0-9]{2}$/u.test(rawNode.nodeId)) {
      errors.push(`nodes[${index}].nodeId:invalid`);
      continue;
    }
    if (byId.has(rawNode.nodeId)) errors.push(`nodes[${index}].nodeId:duplicate`);
    else byId.set(rawNode.nodeId, rawNode);
    if (!isCausalPrimitive(rawNode.primitive)) errors.push(`nodes[${index}].primitive:unknown`);
    if (!Array.isArray(rawNode.dependsOn) || rawNode.dependsOn.some((ref) => typeof ref !== "string")) {
      errors.push(`nodes[${index}].dependsOn:invalid`);
    }
    if (!isPlainRecord(rawNode.arguments)) {
      errors.push(`nodes[${index}].arguments:object-required`);
    } else if (isCausalPrimitive(rawNode.primitive)) {
      const allowed = new Set(PRIMITIVE_ARGUMENT_KEYS[rawNode.primitive]);
      for (const key of Object.keys(rawNode.arguments)) {
        if (!allowed.has(key)) errors.push(`nodes[${index}].arguments.${key}:unknown`);
        if (isForbiddenCausalKey(key)) errors.push(`nodes[${index}].arguments.${key}:authority-field-forbidden`);
        if (!isCausalValue(rawNode.arguments[key])) errors.push(`nodes[${index}].arguments.${key}:value-invalid`);
      }
      for (const requiredKey of PRIMITIVE_REQUIRED_ARGUMENT_KEYS[rawNode.primitive]) {
        if (!hasCausalContent(rawNode.arguments[requiredKey])) {
          errors.push(`nodes[${index}].arguments.${requiredKey}:required`);
        }
      }
      findForbiddenNestedKeys(rawNode.arguments, `nodes[${index}].arguments`, errors);
    }
  }

  for (const [nodeId, node] of byId) {
    if (!Array.isArray(node.dependsOn)) continue;
    if (new Set(node.dependsOn).size !== node.dependsOn.length) errors.push(`${nodeId}.dependsOn:duplicate`);
    for (const dependency of node.dependsOn) {
      if (typeof dependency === "string" && !byId.has(dependency)) errors.push(`${nodeId}.dependsOn:missing:${dependency}`);
    }
  }
  for (const resultNodeId of program.resultNodeIds) {
    if (typeof resultNodeId !== "string" || !byId.has(resultNodeId)) errors.push("resultNodeIds:missing-node");
  }

  const depth = computeGraphDepth(byId, errors);
  if (depth > CAUSAL_ACTION_LANGUAGE_PROFILE.maxDepth) errors.push("graph:depth-exceeded");

  const semanticSource = {
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    formRef: program.formRef,
    formHash: program.formHash,
    nodes: program.nodes,
    resultNodeIds: program.resultNodeIds,
  };
  if (program.semanticHash !== stableStructuralHash(semanticSource)) errors.push("semanticHash:mismatch");
  return validationResult(errors, depth);
}

function computeGraphDepth(byId: Map<string, Record<string, unknown>>, errors: string[]): number {
  const visiting = new Set<string>();
  const depths = new Map<string, number>();
  let cycleReported = false;
  const visit = (nodeId: string): number => {
    const cached = depths.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) {
      if (!cycleReported) errors.push("graph:cycle");
      cycleReported = true;
      return CAUSAL_ACTION_LANGUAGE_PROFILE.maxDepth + 1;
    }
    visiting.add(nodeId);
    const rawDependencies = byId.get(nodeId)?.dependsOn;
    const dependencies = Array.isArray(rawDependencies)
      ? rawDependencies.filter((ref): ref is string => typeof ref === "string" && byId.has(ref))
      : [];
    const depth = dependencies.length === 0 ? 1 : 1 + Math.max(...dependencies.map(visit));
    visiting.delete(nodeId);
    depths.set(nodeId, depth);
    return depth;
  };
  let maximum = 0;
  for (const nodeId of byId.keys()) maximum = Math.max(maximum, visit(nodeId));
  return maximum;
}

function validationResult(errors: readonly string[], maxDepth: number): CausalProgramValidation {
  const unique = Object.freeze([...new Set(errors)].sort());
  return Object.freeze({ ok: unique.length === 0, errors: unique, maxDepth });
}

export type LoweredCausalStep = Readonly<{
  sequence: number;
  nodeRef: string;
  primitive: CausalPrimitive;
  prerequisiteSequences: readonly number[];
  arguments: Readonly<Record<string, CausalValue>>;
}>;

export type LoweredCausalActionProgram = Readonly<{
  languageRef: string;
  languageHash: string;
  formRef: KpFormId;
  programHash: string;
  steps: readonly LoweredCausalStep[];
  resultSequences: readonly number[];
}>;

/** Produces a stable, data-only order for a later Rules adapter. */
export function lowerCausalActionProgram(program: CausalActionProgram): LoweredCausalActionProgram {
  const validation = validateCausalActionProgram(program);
  if (!validation.ok) throw new Error(`CAUSAL_ACTION_PROGRAM_INVALID:${validation.errors.join(",")}`);

  const remaining = new Map(program.nodes.map((node) => [node.nodeId, node]));
  const sequenceById = new Map<string, number>();
  const steps: LoweredCausalStep[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependency) => sequenceById.has(dependency)))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    if (ready.length === 0) throw new Error("CAUSAL_ACTION_PROGRAM_CYCLE");
    for (const node of ready) {
      const sequence = steps.length + 1;
      const prerequisiteSequences = Object.freeze(node.dependsOn.map((ref) => sequenceById.get(ref)!));
      steps.push(Object.freeze({
        sequence,
        nodeRef: node.nodeId,
        primitive: node.primitive,
        prerequisiteSequences,
        arguments: node.arguments,
      }));
      sequenceById.set(node.nodeId, sequence);
      remaining.delete(node.nodeId);
    }
  }
  return Object.freeze({
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    formRef: program.formRef,
    programHash: program.semanticHash,
    steps: Object.freeze(steps),
    resultSequences: Object.freeze(program.resultNodeIds.map((nodeId) => sequenceById.get(nodeId)!)),
  });
}

export function stableStructuralHash(value: unknown): string {
  const canonical = canonicalJson(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    const codePoint = canonical.codePointAt(index)!;
    if (codePoint > 0xffff) index += 1;
    const encoded = utf8Bytes(codePoint);
    for (const byte of encoded) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export function kpFormBindingHash(formRef: KpFormId): string {
  if (!(KP_FORM_IDS as readonly string[]).includes(formRef)) throw new Error("KP_FORM_UNKNOWN");
  return stableStructuralHash({
    catalogRef: KP_FORM_CATALOG_REGISTRATION.catalogRef,
    catalogVersion: KP_FORM_CATALOG_REGISTRATION.catalogVersion,
    catalogHash: KP_FORM_CATALOG_REGISTRATION.catalogHash,
    formRef,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("STRUCTURAL_HASH_VALUE_INVALID");
}

function utf8Bytes(codePoint: number): readonly number[] {
  if (codePoint <= 0x7f) return [codePoint];
  if (codePoint <= 0x7ff) return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  if (codePoint <= 0xffff) {
    return [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)];
  }
  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ];
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}:unknown`);
  }
}

function isCausalPrimitive(value: unknown): value is CausalPrimitive {
  return typeof value === "string" && (CAUSAL_PRIMITIVES as readonly string[]).includes(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isForbiddenCausalKey(key: string): boolean {
  const tokens = key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
  if (tokens.some((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    return (FORBIDDEN_CAUSAL_KEYS as readonly string[]).includes(token)
      || (FORBIDDEN_CAUSAL_KEYS as readonly string[]).includes(singular);
  })) return true;
  const compact = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (FORBIDDEN_CAUSAL_KEYS as readonly string[])
    .filter((part) => part !== "script")
    .some((part) => compact.includes(part));
}

function isCausalScalar(value: unknown): value is CausalScalar {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function isCausalValue(value: unknown): value is CausalValue {
  return isCausalScalar(value) || (Array.isArray(value) && value.every(isCausalScalar));
}

function hasCausalContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function findForbiddenNestedKeys(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenNestedKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenCausalKey(key)) errors.push(`${path}.${key}:authority-field-forbidden`);
    findForbiddenNestedKeys(child, `${path}.${key}`, errors);
  }
}
