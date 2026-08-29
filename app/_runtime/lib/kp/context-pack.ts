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
  }>;
  npcViews: readonly Readonly<{
    npcRef: string;
    knowledgeRefs: readonly string[];
    planRefs: readonly string[];
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
  while (estimatePackPayloadUnits(input.required, retrieved, optional) > input.maxUnits && retrieved.length > 0) {
    const removed = retrieved.pop()!;
    droppedRetrievedRefs.push(removed.sourceRef);
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
  return Object.freeze({
    ...chunk,
    sourceSpan: Object.freeze({ ...chunk.sourceSpan }),
    dependencyRefs: Object.freeze([...chunk.dependencyRefs]),
  });
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
