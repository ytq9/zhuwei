export type ContextScalar = string | number | boolean | null;
export type ContextValue = ContextScalar | readonly ContextValue[] | Readonly<{ [key: string]: ContextValue }>;
export type ContextRecord = Readonly<Record<string, ContextValue>>;

export type ExperiencedDialogue = Readonly<{
  messageRef: string;
  speakerRef: string;
  body: string;
  fictionalTimeRef: string;
}>;

export type RequiredContext = Readonly<{
  kind: "required";
  intent: Readonly<{ submissionRef: string; text: string }>;
  trustedControl: Readonly<{
    characterRef: string;
    controllerRef: string;
    controlProofRef: string;
  }>;
  sceneDynamics: ContextRecord;
  mechanics: Readonly<{
    encounter: ContextValue;
    turn: ContextValue;
    actionEconomy: ContextValue;
    position: ContextValue;
    hp: ContextValue;
    resources: ContextValue;
    conditions: ContextValue;
    loadout?: ContextValue;
    inventory: ContextValue;
  }>;
  npcViews: readonly Readonly<{
    npcRef: string;
    knowledgeRefs: readonly string[];
    planRefs: readonly string[];
    socialCapabilities?: ContextRecord;
    loadout?: ContextRecord;
    inventory?: ContextRecord;
    /** Bounded content from that NPC's own Rules projection. This is not KP
     * omniscience and must never be filled from static Story Bible retrieval. */
    knowledge?: readonly ContextRecord[];
    plans?: readonly ContextRecord[];
  }>[];
  temporal: Readonly<{
    pendingRefs: readonly string[];
    activityRefs: readonly string[];
    fictionalTime: ContextValue;
  }>;
  established: Readonly<{
    factRefs: readonly string[];
    precedentRefs: readonly string[];
    dynamicDefinitionRefs: readonly string[];
  }>;
  bindings: Readonly<{
    rulesRef: string;
    geometryRef: string;
    moduleRef: string;
    eventRef: string;
  }>;
  truthConstraintRefs: readonly string[];
  contentBoundaries: readonly string[];
  recentDialogue: readonly ExperiencedDialogue[];
}>;

export type RequiredContextInput = Omit<RequiredContext, "kind" | "recentDialogue"> & Readonly<{
  recentDialogue: readonly ExperiencedDialogue[];
  recentDialogueLimit?: number;
}>;

export function createRequiredContext(input: RequiredContextInput): RequiredContext {
  assertRecentDialogueLimit(input.recentDialogueLimit ?? 10);
  assertNonEmpty(input.intent.submissionRef, "required.intent.submissionRef");
  assertNonEmpty(input.intent.text, "required.intent.text");
  assertNonEmpty(input.trustedControl.characterRef, "required.trustedControl.characterRef");
  assertNonEmpty(input.trustedControl.controllerRef, "required.trustedControl.controllerRef");
  assertNonEmpty(input.trustedControl.controlProofRef, "required.trustedControl.controlProofRef");

  return deepFreezeContext({
    kind: "required",
    intent: input.intent,
    trustedControl: input.trustedControl,
    sceneDynamics: input.sceneDynamics,
    mechanics: input.mechanics,
    npcViews: input.npcViews,
    temporal: input.temporal,
    established: input.established,
    bindings: input.bindings,
    truthConstraintRefs: input.truthConstraintRefs,
    contentBoundaries: input.contentBoundaries,
    recentDialogue: trimRecentDialogue(input.recentDialogue, input.recentDialogueLimit ?? 10),
  }) as RequiredContext;
}

export function trimRecentDialogue(
  dialogue: readonly ExperiencedDialogue[],
  limit = 10,
): readonly ExperiencedDialogue[] {
  assertRecentDialogueLimit(limit);
  return Object.freeze(dialogue.slice(-limit).map((entry) => Object.freeze({ ...entry })));
}

function assertRecentDialogueLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 8 || limit > 12) {
    throw new Error("CONTEXT_RECENT_DIALOGUE_LIMIT_INVALID");
  }
}

export type SourceSpan = Readonly<{
  start: number;
  end: number;
}>;

export type ContextSensitivity = "public" | "kp-only";
export type StaticContextPurpose =
  | "rules"
  | "module"
  | "story-bible"
  | "ability"
  | "enemy"
  | "environment";

export type RetrievedContextChunk = Readonly<{
  sourceRef: string;
  sourceHash: string;
  sourceSpan: SourceSpan;
  profileRef: string;
  sensitivity: ContextSensitivity;
  dependencyRefs: readonly string[];
  purpose: StaticContextPurpose;
  body: string;
  relevance: number;
}>;

export type RetrievedContext = Readonly<{
  kind: "retrieved";
  chunks: readonly RetrievedContextChunk[];
}>;

export type OptionalContextKind = "voice" | "theme" | "secondary-background" | "lightweight-index";

export type OptionalContextItem = Readonly<{
  ref: string;
  kind: OptionalContextKind;
  body: string;
  priority: number;
}>;

export type OptionalContext = Readonly<{
  kind: "optional";
  items: readonly OptionalContextItem[];
}>;

export type ContextPack = Readonly<{
  required: RequiredContext;
  retrieved: RetrievedContext;
  optional: OptionalContext;
  budget: Readonly<{
    maxUnits: number;
    usedUnits: number;
    droppedOptionalRefs: readonly string[];
    droppedRetrievedRefs: readonly string[];
  }>;
}>;

export type ContextPackInput = Readonly<{
  required: RequiredContext;
  retrieved: readonly RetrievedContextChunk[];
  optional: readonly OptionalContextItem[];
  maxUnits: number;
}>;

/**
 * Required context is immutable. Optional context is always removed before the
 * least-relevant retrieved chunk when a proposal budget is exceeded.
 */
export function buildContextPack(input: ContextPackInput): ContextPack {
  if (!Number.isInteger(input.maxUnits) || input.maxUnits <= 0) throw new Error("CONTEXT_BUDGET_INVALID");
  const retrieved = [...input.retrieved]
    .map(freezeRetrievedChunk)
    .sort((left, right) => right.relevance - left.relevance || left.sourceRef.localeCompare(right.sourceRef));
  const optional = [...input.optional]
    .map((item) => Object.freeze({ ...item }))
    .sort((left, right) => right.priority - left.priority || left.ref.localeCompare(right.ref));
  assertUniqueRefs(retrieved.map((chunk) => chunk.sourceRef), "CONTEXT_RETRIEVED_REF_DUPLICATE");
  assertUniqueRefs(optional.map((item) => item.ref), "CONTEXT_OPTIONAL_REF_DUPLICATE");

  if (estimatePackPayloadUnits(input.required, [], []) > input.maxUnits) {
    throw new Error("CONTEXT_REQUIRED_BUDGET_EXCEEDED");
  }

  const droppedOptionalRefs: string[] = [];
  const droppedRetrievedRefs: string[] = [];
  while (estimatePackPayloadUnits(input.required, retrieved, optional) > input.maxUnits && optional.length > 0) {
    const lowestPriority = optional
      .map((item, index) => ({ item, index }))
      .sort((left, right) => left.item.priority - right.item.priority || right.item.ref.localeCompare(left.item.ref))[0]!;
    optional.splice(lowestPriority.index, 1);
    droppedOptionalRefs.push(lowestPriority.item.ref);
  }
  const dependencyGroups = atomicRetrievedDependencyGroups(retrieved)
    .sort((left, right) => left.relevance - right.relevance || right.groupRef.localeCompare(left.groupRef));
  while (estimatePackPayloadUnits(input.required, retrieved, optional) > input.maxUnits && dependencyGroups.length > 0) {
    const removedGroup = dependencyGroups.shift()!;
    const removedRefs = new Set(removedGroup.sourceRefs);
    for (let index = retrieved.length - 1; index >= 0; index -= 1) {
      if (removedRefs.has(retrieved[index]!.sourceRef)) retrieved.splice(index, 1);
    }
    droppedRetrievedRefs.push(...removedGroup.sourceRefs);
  }

  const provisional = packShape(
    input.required,
    retrieved,
    optional,
    input.maxUnits,
    droppedOptionalRefs,
    droppedRetrievedRefs,
  );
  const usedUnits = estimatePackPayloadUnits(input.required, retrieved, optional);
  if (usedUnits > input.maxUnits) throw new Error("CONTEXT_REQUIRED_BUDGET_EXCEEDED");
  return Object.freeze({
    required: input.required,
    retrieved: Object.freeze({ kind: "retrieved" as const, chunks: Object.freeze(retrieved) }),
    optional: Object.freeze({ kind: "optional" as const, items: Object.freeze(optional) }),
    budget: Object.freeze({
      ...provisional.budget,
      usedUnits,
      droppedOptionalRefs: Object.freeze([...droppedOptionalRefs]),
      droppedRetrievedRefs: Object.freeze([...droppedRetrievedRefs]),
    }),
  });
}

function packShape(
  required: RequiredContext,
  retrieved: readonly RetrievedContextChunk[],
  optional: readonly OptionalContextItem[],
  maxUnits: number,
  droppedOptionalRefs: readonly string[],
  droppedRetrievedRefs: readonly string[],
): ContextPack {
  return {
    required,
    retrieved: { kind: "retrieved", chunks: retrieved },
    optional: { kind: "optional", items: optional },
    budget: {
      maxUnits,
      usedUnits: 0,
      droppedOptionalRefs,
      droppedRetrievedRefs,
    },
  };
}

/** Stable approximation used only to enforce the configured context budget. */
export function estimateContextUnits(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function estimatePackPayloadUnits(
  required: RequiredContext,
  retrieved: readonly RetrievedContextChunk[],
  optional: readonly OptionalContextItem[],
): number {
  return estimateContextUnits({
    required,
    retrieved: { kind: "retrieved", chunks: retrieved },
    optional: { kind: "optional", items: optional },
  });
}

function freezeRetrievedChunk(chunk: RetrievedContextChunk): RetrievedContextChunk {
  if (!Number.isFinite(chunk.relevance)) throw new Error("CONTEXT_RELEVANCE_INVALID");
  if (!Number.isInteger(chunk.sourceSpan.start) || !Number.isInteger(chunk.sourceSpan.end)
    || chunk.sourceSpan.start < 0 || chunk.sourceSpan.end <= chunk.sourceSpan.start) {
    throw new Error("CONTEXT_SOURCE_SPAN_INVALID");
  }
  if (!Array.isArray(chunk.dependencyRefs)
    || chunk.dependencyRefs.length > 16
    || chunk.dependencyRefs.some((reference) =>
      typeof reference !== "string" || reference.trim().length === 0)
    || new Set(chunk.dependencyRefs).size !== chunk.dependencyRefs.length) {
    throw new Error("CONTEXT_DEPENDENCY_REFS_INVALID");
  }
  return Object.freeze({
    ...chunk,
    sourceSpan: Object.freeze({ ...chunk.sourceSpan }),
    dependencyRefs: Object.freeze([...chunk.dependencyRefs]),
  });
}

type RetrievedDependencyGroup = Readonly<{
  groupRef: string;
  sourceRefs: readonly string[];
  relevance: number;
}>;

/** Dependency-connected chunks are one budget unit. Profile-binding refs have
 * no matching chunk and were already authorized during rehydration, so they do
 * not create a synthetic group member here. */
function atomicRetrievedDependencyGroups(
  chunks: readonly RetrievedContextChunk[],
): RetrievedDependencyGroup[] {
  const indexByRef = new Map(chunks.map((chunk, index) => [chunk.sourceRef, index]));
  const refsBySource = new Map<string, number[]>();
  for (const [index, chunk] of chunks.entries()) {
    const parentRef = parentStaticSourceRef(chunk.sourceRef);
    const indexes = refsBySource.get(parentRef) ?? [];
    indexes.push(index);
    refsBySource.set(parentRef, indexes);
  }
  const parents = chunks.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parents[current] !== current) current = parents[current]!;
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = current;
      index = next;
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  for (const [index, chunk] of chunks.entries()) {
    for (const dependencyRef of chunk.dependencyRefs) {
      const exact = indexByRef.get(dependencyRef);
      const dependencyIndexes = exact === undefined ? refsBySource.get(dependencyRef) ?? [] : [exact];
      for (const dependencyIndex of dependencyIndexes) union(index, dependencyIndex);
    }
  }
  const members = new Map<number, RetrievedContextChunk[]>();
  for (const [index, chunk] of chunks.entries()) {
    const root = find(index);
    const group = members.get(root) ?? [];
    group.push(chunk);
    members.set(root, group);
  }
  return [...members.values()].map((group) => {
    if (group.length > 64) throw new Error("CONTEXT_DEPENDENCY_GROUP_LIMIT_EXCEEDED");
    const sourceRefs = Object.freeze(group.map((chunk) => chunk.sourceRef).sort());
    return Object.freeze({
      groupRef: sourceRefs[0]!,
      sourceRefs,
      relevance: Math.max(...group.map((chunk) => chunk.relevance)),
    });
  });
}

function parentStaticSourceRef(sourceRef: string): string {
  const marker = sourceRef.lastIndexOf("#span:");
  return marker < 0 ? sourceRef : sourceRef.slice(0, marker);
}

function assertUniqueRefs(refs: readonly string[], code: string): void {
  if (new Set(refs).size !== refs.length) throw new Error(code);
}

function assertNonEmpty(value: string, path: string): void {
  if (value.trim().length === 0) throw new Error(`${path}:required`);
}

function deepFreezeContext(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeContext));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) result[key] = deepFreezeContext(child);
  return Object.freeze(result);
}
