/**
 * Closed, model-owned composition protocol for compound.v1.
 *
 * The model may describe fictional references and bounded consequences, but it
 * never supplies the acting character, controller, audience, event/state
 * patches, visibility policy, or Root Action authority. Rules derives all of
 * those from the authenticated request and current authoritative state.
 */

export const COMPOUND_COMPOSITION_SCHEMA = "zhuwei.compound-composition-draft/v1" as const;
export const COMPOUND_ACTOR_PLAN_SCHEMA = "zhuwei.compound-actor-plan-draft/v1" as const;
const MAX_COMPOUND_COMPOSITION_JSON_LENGTH = 2_000_000;

type DynamicFactOperation = Readonly<{
  kind: "declareDynamicFact";
  factRef: string;
  factKind: string;
  subjectRefs: readonly string[];
  causalBasisRefs: readonly string[];
  summary: string;
  disclosure: "public" | "hiddenUntilEvidence";
}>;

export type CompoundActorPlanDraft = Readonly<{
  schema: typeof COMPOUND_ACTOR_PLAN_SCHEMA;
  npcRef: string;
  factionRef: string | null;
  planRef: string;
  goal: string;
  premiseRefs: readonly string[];
  nextStep: string;
  resourceRefs: readonly string[];
  activity: Readonly<{
    activityRef: string;
    activityKind: string;
    intendedDurationMicros: string;
  }>;
  schedule:
    | Readonly<{ kind: "activityCompletion" }>
    | Readonly<{ kind: "committedOccurrence"; occurrenceRef: string }>
    | Readonly<{ kind: "knowledgeAcquired"; knowledgeRef: string }>;
  trace: Readonly<{ factRef: string; description: string }>;
  alternate: Readonly<{ referenceRef: string; reason: string }>;
}>;

type ActorPlanOperation = Readonly<{
  kind: "formActorPlan";
  basisRefs: readonly string[];
  draft: CompoundActorPlanDraft;
}>;

type SceneQuestionOperation = Readonly<{
  kind: "openSceneQuestion";
  sceneQuestionRef: string;
  question: string;
}>;

type ActivityOperation = Readonly<{
  kind: "startActivity";
  activityRef: string;
  activityKind: string;
  intendedDurationMicros: string;
  primaryFactRef: string;
}>;

type EnvironmentTransitionOperation = Readonly<{
  kind: "transitionEnvironment";
  featureRef: string;
  intent: "open" | "close";
}>;

export type CompoundWorldConsequence =
  | Readonly<{ kind: "spendResource"; resourceRef: string; amount: number }>
  | Readonly<{ kind: "acquireKnowledge"; knowledgeRef: string; content: string }>
  | Readonly<{
      kind: "updateRelationship";
      relationshipRef: string;
      counterpartyRefs: readonly string[];
      change: string;
    }>
  | Readonly<{
      kind: "recordPromise";
      promiseRef: string;
      counterpartyRef: string;
      content: string;
      condition: string;
    }>
  | Readonly<{
      kind: "recordDebt";
      debtRef: string;
      counterpartyRef: string;
      obligation: string;
      condition: string;
    }>;

export type CompoundWorldConsequenceDraft = Readonly<{
  schema: "zhuwei.world-consequence-draft/v1";
  factRef: string;
  summary: string;
  consequences: readonly CompoundWorldConsequence[];
}>;

type WorldEffectsOperation = Readonly<{
  kind: "applyWorldEffects";
  basisRefs: readonly string[];
  draft: CompoundWorldConsequenceDraft;
}>;

export type CompoundCompositionOperation =
  | DynamicFactOperation
  | ActorPlanOperation
  | SceneQuestionOperation
  | ActivityOperation
  | EnvironmentTransitionOperation
  | WorldEffectsOperation;

export type CompoundCompositionDraft = Readonly<{
  schema: typeof COMPOUND_COMPOSITION_SCHEMA;
  before: readonly CompoundCompositionOperation[];
  onSuccess: readonly CompoundCompositionOperation[];
  onFailure: readonly CompoundCompositionOperation[];
}>;

export type CompoundCompositionValidation = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

const FORBIDDEN_KEY_PARTS = Object.freeze([
  "actor",
  "principal",
  "controller",
  "audience",
  "visibility",
  "dice",
  "d20",
  "roll",
  "target",
  "event",
  "state",
  "patch",
  "profile",
  "scope",
  "root",
]);

const COMPOSITION_KEYS = Object.freeze(["before", "onFailure", "onSuccess", "schema"]);
const OPERATION_KEYS = Object.freeze({
  declareDynamicFact: Object.freeze([
    "causalBasisRefs", "disclosure", "factKind", "factRef", "kind", "subjectRefs", "summary",
  ]),
  formActorPlan: Object.freeze(["basisRefs", "draft", "kind"]),
  openSceneQuestion: Object.freeze(["kind", "question", "sceneQuestionRef"]),
  startActivity: Object.freeze([
    "activityKind", "activityRef", "intendedDurationMicros", "kind", "primaryFactRef",
  ]),
  transitionEnvironment: Object.freeze(["featureRef", "intent", "kind"]),
  applyWorldEffects: Object.freeze(["basisRefs", "draft", "kind"]),
} as const);

/** Complete closed JSON Schema exposed only as the compound Form field. */
export function compoundCompositionModelSchema(): Readonly<Record<string, unknown>> {
  const ref = (maximum = 240): Record<string, unknown> => ({
    type: "string", minLength: 1, maxLength: maximum, pattern: "^(?=.*\\S).+$",
  });
  const text = (maximum: number): Record<string, unknown> => ({
    type: "string", minLength: 1, maxLength: maximum, pattern: "^(?=.*\\S)[\\s\\S]+$",
  });
  const refs = (minimum: number, maximum: number): Record<string, unknown> => ({
    type: "array",
    minItems: minimum,
    maxItems: maximum,
    uniqueItems: true,
    items: ref(),
  });
  const closed = (
    properties: Record<string, unknown>,
    required: readonly string[],
  ): Record<string, unknown> => ({
    type: "object",
    additionalProperties: false,
    properties,
    required: [...required],
  });
  const discriminatedUnion = (branches: readonly Readonly<{
    kind: string;
    properties: Record<string, unknown>;
    required: readonly string[];
  }>[]): Record<string, unknown> => {
    const allFieldNames = [...new Set(branches.flatMap(({ properties }) =>
      Object.keys(properties)))].sort();
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries([
        ["kind", { enum: branches.map(({ kind }) => kind) }],
        ...allFieldNames.filter((field) => field !== "kind").map((field) => [field, {}]),
      ]),
      required: ["kind"],
      allOf: branches.map((branch) => {
        const allowed = new Set(["kind", ...Object.keys(branch.properties)]);
        return {
          if: {
            properties: { kind: { const: branch.kind } },
            required: ["kind"],
          },
          then: {
            properties: { kind: { const: branch.kind }, ...branch.properties },
            required: [...new Set(["kind", ...branch.required])],
            allOf: allFieldNames
              .filter((field) => !allowed.has(field))
              .map((field) => ({ not: { required: [field] } })),
          },
        };
      }),
    };
  };

  const worldConsequence = discriminatedUnion([
    {
      kind: "spendResource",
      properties: {
        resourceRef: ref(),
        amount: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      },
      required: ["resourceRef", "amount"],
    },
    {
      kind: "acquireKnowledge",
      properties: {
        knowledgeRef: ref(),
        content: text(4_000),
      },
      required: ["knowledgeRef", "content"],
    },
    {
      kind: "updateRelationship",
      properties: {
        relationshipRef: ref(),
        counterpartyRefs: refs(1, 8),
        change: text(4_000),
      },
      required: ["relationshipRef", "counterpartyRefs", "change"],
    },
    {
      kind: "recordPromise",
      properties: {
        promiseRef: ref(),
        counterpartyRef: ref(),
        content: text(4_000),
        condition: text(4_000),
      },
      required: ["promiseRef", "counterpartyRef", "content", "condition"],
    },
    {
      kind: "recordDebt",
      properties: {
        debtRef: ref(),
        counterpartyRef: ref(),
        obligation: text(4_000),
        condition: text(4_000),
      },
      required: ["debtRef", "counterpartyRef", "obligation", "condition"],
    },
  ]);
  const schedule = discriminatedUnion([
    { kind: "activityCompletion", properties: {}, required: [] },
    {
      kind: "committedOccurrence",
      properties: { occurrenceRef: ref() },
      required: ["occurrenceRef"],
    },
    {
      kind: "knowledgeAcquired",
      properties: { knowledgeRef: ref() },
      required: ["knowledgeRef"],
    },
  ]);
  const actorPlanDraft = closed({
    schema: { const: COMPOUND_ACTOR_PLAN_SCHEMA },
    npcRef: ref(480),
    factionRef: { anyOf: [ref(), { type: "null" }] },
    planRef: ref(480),
    goal: text(480),
    premiseRefs: refs(1, 40),
    nextStep: text(480),
    resourceRefs: refs(0, 40),
    activity: closed({
      activityRef: ref(),
      activityKind: ref(),
      intendedDurationMicros: {
        type: "string", pattern: "^[1-9][0-9]{0,29}$",
      },
    }, ["activityRef", "activityKind", "intendedDurationMicros"]),
    schedule,
    trace: closed({ factRef: ref(480), description: text(480) }, ["factRef", "description"]),
    alternate: closed({ referenceRef: ref(480), reason: text(480) }, ["referenceRef", "reason"]),
  }, [
    "schema", "npcRef", "factionRef", "planRef", "goal", "premiseRefs", "nextStep",
    "resourceRefs", "activity", "schedule", "trace", "alternate",
  ]);
  const worldDraft = closed({
    schema: { const: "zhuwei.world-consequence-draft/v1" },
    factRef: { ...ref(), pattern: "^fact:" },
    summary: text(4_000),
    consequences: {
      type: "array", minItems: 1, maxItems: 12, items: worldConsequence,
    },
  }, ["schema", "factRef", "summary", "consequences"]);

  const operation = discriminatedUnion([
    {
      kind: "declareDynamicFact",
      properties: {
        factRef: ref(),
        factKind: ref(),
        subjectRefs: refs(1, 16),
        causalBasisRefs: refs(1, 16),
        summary: text(4_000),
        disclosure: { enum: ["public", "hiddenUntilEvidence"] },
      },
      required: OPERATION_KEYS.declareDynamicFact.filter((field) => field !== "kind"),
    },
    {
      kind: "formActorPlan",
      properties: {
        basisRefs: refs(1, 40),
        draft: actorPlanDraft,
      },
      required: OPERATION_KEYS.formActorPlan.filter((field) => field !== "kind"),
    },
    {
      kind: "openSceneQuestion",
      properties: {
        sceneQuestionRef: ref(),
        question: text(2_000),
      },
      required: OPERATION_KEYS.openSceneQuestion.filter((field) => field !== "kind"),
    },
    {
      kind: "startActivity",
      properties: {
        activityRef: ref(),
        activityKind: ref(),
        intendedDurationMicros: {
          type: "string", pattern: "^[1-9][0-9]{0,29}$",
        },
        primaryFactRef: ref(),
      },
      required: OPERATION_KEYS.startActivity.filter((field) => field !== "kind"),
    },
    {
      kind: "transitionEnvironment",
      properties: {
        featureRef: ref(),
        intent: { enum: ["open", "close"] },
      },
      required: OPERATION_KEYS.transitionEnvironment.filter((field) => field !== "kind"),
    },
    {
      kind: "applyWorldEffects",
      properties: {
        basisRefs: refs(1, 40),
        draft: worldDraft,
      },
      required: OPERATION_KEYS.applyWorldEffects.filter((field) => field !== "kind"),
    },
  ]);
  return deepFreeze({
    type: "object",
    additionalProperties: false,
    description: "Closed compound composition. Each phase has at most 8 operations; all phases together have at most 12 operations. All three arrays may be empty for a purely mechanical compound action.",
    properties: {
      schema: { const: COMPOUND_COMPOSITION_SCHEMA },
      before: { type: "array", minItems: 0, maxItems: 8, items: operation },
      onSuccess: { type: "array", minItems: 0, maxItems: 8, items: operation },
      onFailure: { type: "array", minItems: 0, maxItems: 8, items: operation },
    },
    required: [...COMPOSITION_KEYS],
  }) as Readonly<Record<string, unknown>>;
}

export function validateCompoundCompositionDraft(value: unknown): CompoundCompositionValidation {
  const errors: string[] = [];
  findForbiddenKeys(value, "$", errors);
  if (!isRecord(value)) return result([...errors, "$:object-required"]);
  exactKeys(value, COMPOSITION_KEYS, "$", errors);
  if (value.schema !== COMPOUND_COMPOSITION_SCHEMA) errors.push("$.schema:mismatch");
  const phases = ["before", "onSuccess", "onFailure"] as const;
  let total = 0;
  for (const phase of phases) {
    const operations = value[phase];
    if (!Array.isArray(operations)) {
      errors.push(`$.${phase}:array-required`);
      continue;
    }
    total += operations.length;
    if (operations.length > 8) errors.push(`$.${phase}:limit-exceeded`);
    if (!isDenseArray(operations)) errors.push(`$.${phase}:sparse-array-forbidden`);
    for (let index = 0; index < operations.length; index += 1) {
      validateOperation(operations[index], `$.${phase}[${index}]`, errors);
    }
  }
  if (total > 12) errors.push("$:operation-limit-exceeded");
  return result(errors);
}

/** Canonical scalar carried by the terminal causal join node. */
export function canonicalCompoundCompositionJson(value: unknown): string {
  const validation = validateCompoundCompositionDraft(value);
  if (!validation.ok) {
    throw new Error(`COMPOUND_COMPOSITION_INVALID:${validation.errors.join(",")}`);
  }
  return canonicalJson(value);
}

/** Parses only the compiler-owned canonical representation. */
export function parseCompoundCompositionJson(value: unknown): CompoundCompositionDraft | undefined {
  if (typeof value !== "string"
    || value.length < 2
    || value.length > MAX_COMPOUND_COMPOSITION_JSON_LENGTH) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const validation = validateCompoundCompositionDraft(parsed);
  if (!validation.ok || canonicalJson(parsed) !== value) return undefined;
  return deepFreeze(parsed) as CompoundCompositionDraft;
}

function validateOperation(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}:object-required`);
    return;
  }
  if (typeof value.kind !== "string" || !Object.hasOwn(OPERATION_KEYS, value.kind)) {
    errors.push(`${path}.kind:unknown`);
    return;
  }
  const kind = value.kind as keyof typeof OPERATION_KEYS;
  exactKeys(value, OPERATION_KEYS[kind], path, errors);
  switch (kind) {
    case "declareDynamicFact":
      requiredReference(value.factRef, `${path}.factRef`, errors);
      requiredReference(value.factKind, `${path}.factKind`, errors);
      referenceList(value.subjectRefs, 1, 16, `${path}.subjectRefs`, errors);
      referenceList(value.causalBasisRefs, 1, 16, `${path}.causalBasisRefs`, errors);
      requiredText(value.summary, 4_000, `${path}.summary`, errors);
      if (value.disclosure !== "public" && value.disclosure !== "hiddenUntilEvidence") {
        errors.push(`${path}.disclosure:invalid`);
      }
      return;
    case "formActorPlan":
      referenceList(value.basisRefs, 1, 40, `${path}.basisRefs`, errors);
      validateActorPlan(value.draft, `${path}.draft`, errors);
      return;
    case "openSceneQuestion":
      requiredReference(value.sceneQuestionRef, `${path}.sceneQuestionRef`, errors);
      requiredText(value.question, 2_000, `${path}.question`, errors);
      return;
    case "startActivity":
      requiredReference(value.activityRef, `${path}.activityRef`, errors);
      requiredReference(value.activityKind, `${path}.activityKind`, errors);
      durationMicros(value.intendedDurationMicros, `${path}.intendedDurationMicros`, errors);
      requiredReference(value.primaryFactRef, `${path}.primaryFactRef`, errors);
      return;
    case "transitionEnvironment":
      requiredReference(value.featureRef, `${path}.featureRef`, errors);
      if (value.intent !== "open" && value.intent !== "close") errors.push(`${path}.intent:invalid`);
      return;
    case "applyWorldEffects":
      referenceList(value.basisRefs, 1, 40, `${path}.basisRefs`, errors);
      validateWorldDraft(value.draft, `${path}.draft`, errors);
      return;
  }
}

function validateActorPlan(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}:object-required`);
    return;
  }
  const keys = [
    "activity", "alternate", "factionRef", "goal", "nextStep", "npcRef", "planRef",
    "premiseRefs", "resourceRefs", "schedule", "schema", "trace",
  ] as const;
  exactKeys(value, keys, path, errors);
  if (value.schema !== COMPOUND_ACTOR_PLAN_SCHEMA) errors.push(`${path}.schema:mismatch`);
  requiredReference(value.npcRef, `${path}.npcRef`, errors, 480);
  if (value.factionRef !== null) requiredReference(value.factionRef, `${path}.factionRef`, errors);
  requiredReference(value.planRef, `${path}.planRef`, errors, 480);
  requiredText(value.goal, 480, `${path}.goal`, errors);
  referenceList(value.premiseRefs, 1, 40, `${path}.premiseRefs`, errors);
  requiredText(value.nextStep, 480, `${path}.nextStep`, errors);
  referenceList(value.resourceRefs, 0, 40, `${path}.resourceRefs`, errors);

  if (!isRecord(value.activity)) {
    errors.push(`${path}.activity:object-required`);
  } else {
    exactKeys(value.activity, ["activityKind", "activityRef", "intendedDurationMicros"], `${path}.activity`, errors);
    requiredReference(value.activity.activityRef, `${path}.activity.activityRef`, errors);
    requiredReference(value.activity.activityKind, `${path}.activity.activityKind`, errors);
    durationMicros(value.activity.intendedDurationMicros, `${path}.activity.intendedDurationMicros`, errors);
  }
  validateSchedule(value.schedule, `${path}.schedule`, errors);
  if (!isRecord(value.trace)) {
    errors.push(`${path}.trace:object-required`);
  } else {
    exactKeys(value.trace, ["description", "factRef"], `${path}.trace`, errors);
    requiredReference(value.trace.factRef, `${path}.trace.factRef`, errors, 480);
    requiredText(value.trace.description, 480, `${path}.trace.description`, errors);
  }
  if (!isRecord(value.alternate)) {
    errors.push(`${path}.alternate:object-required`);
  } else {
    exactKeys(value.alternate, ["reason", "referenceRef"], `${path}.alternate`, errors);
    requiredReference(value.alternate.referenceRef, `${path}.alternate.referenceRef`, errors, 480);
    requiredText(value.alternate.reason, 480, `${path}.alternate.reason`, errors);
  }
}

function validateSchedule(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value) || typeof value.kind !== "string") {
    errors.push(`${path}:object-required`);
    return;
  }
  if (value.kind === "activityCompletion") {
    exactKeys(value, ["kind"], path, errors);
    return;
  }
  if (value.kind === "committedOccurrence") {
    exactKeys(value, ["kind", "occurrenceRef"], path, errors);
    requiredReference(value.occurrenceRef, `${path}.occurrenceRef`, errors);
    return;
  }
  if (value.kind === "knowledgeAcquired") {
    exactKeys(value, ["kind", "knowledgeRef"], path, errors);
    requiredReference(value.knowledgeRef, `${path}.knowledgeRef`, errors);
    return;
  }
  errors.push(`${path}.kind:unknown`);
}

function validateWorldDraft(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}:object-required`);
    return;
  }
  exactKeys(value, ["consequences", "factRef", "schema", "summary"], path, errors);
  if (value.schema !== "zhuwei.world-consequence-draft/v1") errors.push(`${path}.schema:mismatch`);
  requiredReference(value.factRef, `${path}.factRef`, errors);
  if (typeof value.factRef === "string" && !value.factRef.startsWith("fact:")) {
    errors.push(`${path}.factRef:prefix-invalid`);
  }
  requiredText(value.summary, 4_000, `${path}.summary`, errors);
  if (!Array.isArray(value.consequences)) {
    errors.push(`${path}.consequences:array-required`);
    return;
  }
  if (!isDenseArray(value.consequences)) errors.push(`${path}.consequences:sparse-array-forbidden`);
  if (value.consequences.length < 1 || value.consequences.length > 12) {
    errors.push(`${path}.consequences:cardinality-invalid`);
  }
  const identities = new Set<string>();
  value.consequences.forEach((consequence, index) => {
    const consequencePath = `${path}.consequences[${index}]`;
    const identity = validateWorldConsequence(consequence, consequencePath, errors);
    if (identity !== undefined) {
      if (identities.has(identity)) errors.push(`${consequencePath}:duplicate-identity`);
      identities.add(identity);
    }
  });
}

function validateWorldConsequence(
  value: unknown,
  path: string,
  errors: string[],
): string | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    errors.push(`${path}:object-required`);
    return undefined;
  }
  switch (value.kind) {
    case "spendResource":
      exactKeys(value, ["amount", "kind", "resourceRef"], path, errors);
      requiredReference(value.resourceRef, `${path}.resourceRef`, errors);
      if (!Number.isSafeInteger(value.amount) || Number(value.amount) < 1) errors.push(`${path}.amount:invalid`);
      return typeof value.resourceRef === "string" ? `resource:${value.resourceRef}` : undefined;
    case "acquireKnowledge":
      exactKeys(value, ["content", "kind", "knowledgeRef"], path, errors);
      requiredReference(value.knowledgeRef, `${path}.knowledgeRef`, errors);
      requiredText(value.content, 4_000, `${path}.content`, errors);
      return typeof value.knowledgeRef === "string" ? `knowledge:${value.knowledgeRef}` : undefined;
    case "updateRelationship":
      exactKeys(value, ["change", "counterpartyRefs", "kind", "relationshipRef"], path, errors);
      requiredReference(value.relationshipRef, `${path}.relationshipRef`, errors);
      referenceList(value.counterpartyRefs, 1, 8, `${path}.counterpartyRefs`, errors);
      requiredText(value.change, 4_000, `${path}.change`, errors);
      return typeof value.relationshipRef === "string" ? `relationship:${value.relationshipRef}` : undefined;
    case "recordPromise":
      exactKeys(value, ["condition", "content", "counterpartyRef", "kind", "promiseRef"], path, errors);
      requiredReference(value.promiseRef, `${path}.promiseRef`, errors);
      requiredReference(value.counterpartyRef, `${path}.counterpartyRef`, errors);
      requiredText(value.content, 4_000, `${path}.content`, errors);
      requiredText(value.condition, 4_000, `${path}.condition`, errors);
      return typeof value.promiseRef === "string" ? `promise:${value.promiseRef}` : undefined;
    case "recordDebt":
      exactKeys(value, ["condition", "counterpartyRef", "debtRef", "kind", "obligation"], path, errors);
      requiredReference(value.debtRef, `${path}.debtRef`, errors);
      requiredReference(value.counterpartyRef, `${path}.counterpartyRef`, errors);
      requiredText(value.obligation, 4_000, `${path}.obligation`, errors);
      requiredText(value.condition, 4_000, `${path}.condition`, errors);
      return typeof value.debtRef === "string" ? `debt:${value.debtRef}` : undefined;
    default:
      errors.push(`${path}.kind:unknown`);
      return undefined;
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  errors: string[],
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) errors.push(`${path}.${key}:unknown`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}:required`);
  }
}

function requiredReference(
  value: unknown,
  path: string,
  errors: string[],
  maximum = 240,
): void {
  if (!canonicalText(value, maximum)) errors.push(`${path}:reference-invalid`);
}

function requiredText(value: unknown, maximum: number, path: string, errors: string[]): void {
  if (!canonicalText(value, maximum)) errors.push(`${path}:text-invalid`);
}

function canonicalText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length <= maximum
    && value.trim().length > 0
    && value.trim() === value
    && value.normalize("NFC") === value;
}

function referenceList(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  errors: string[],
): void {
  if (!Array.isArray(value)
    || !isDenseArray(value)
    || value.length < minimum
    || value.length > maximum
    || value.some((reference) => !canonicalText(reference, 240))
    || new Set(value).size !== value.length) {
    errors.push(`${path}:reference-list-invalid`);
  }
}

function durationMicros(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/u.test(value)) {
    errors.push(`${path}:duration-invalid`);
  }
}

function findForbiddenKeys(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => findForbiddenKeys(child, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenKey(key)) errors.push(`${path}.${key}:authority-field-forbidden`);
    findForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

function isForbiddenKey(key: string): boolean {
  const tokens = key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
  if (tokens.some((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    return FORBIDDEN_KEY_PARTS.includes(token) || FORBIDDEN_KEY_PARTS.includes(singular);
  })) return true;
  const compact = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return FORBIDDEN_KEY_PARTS.some((part) => compact.includes(part));
}

function result(errors: readonly string[]): CompoundCompositionValidation {
  const unique = Object.freeze([...new Set(errors)].sort());
  return Object.freeze({ ok: unique.length === 0, errors: unique });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("COMPOUND_COMPOSITION_CANONICAL_VALUE_INVALID");
}

function deepFreeze(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (!isRecord(value)) return value;
  const frozen: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) frozen[key] = deepFreeze(child);
  return Object.freeze(frozen);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}
