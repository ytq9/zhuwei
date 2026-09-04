import type { JsonRecord } from "./canonical-json";

/**
 * Model-facing ProposalBundle contract.
 *
 * This is intentionally a new contract rather than an envelope around the
 * old coarse-form draft.  The model submits one shared adjudication (or one
 * terminal answer) and typed operations; the server derives entry refs and
 * Form ids.  No model-authored node id, RootAction, authority id, or DAG is
 * part of this type.
 */
export const VNEXT2_PROPOSAL_BUNDLE_SCHEMA =
  "zhuwei.kp-proposal-bundle/vnext-2" as const;

export const VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA =
  "zhuwei.kp-proposal-bundle-plan/vnext-2" as const;

export const VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA =
  "zhuwei.kp-proposal-bundle-correction/vnext-1" as const;

export const SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME =
  "submit_kp_proposal_bundle" as const;

export const CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME =
  "correct_kp_proposal_bundle" as const;

export const VNEXT_CLARIFICATION_FORM_ID = "clarification.vnext-1" as const;
export const VNEXT_IN_WORLD_REFUSAL_FORM_ID = "in-world-refusal.vnext-1" as const;
export const VNEXT_MATERIALIZATION_FORM_ID = "materialization.vnext-1" as const;
export const VNEXT_WORLD_INTERACTION_FORM_ID = "world-interaction.vnext-1" as const;

export const VNEXT_BUNDLE_FORM_IDS = Object.freeze([
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
] as const);

export type VNextBundleFormId = (typeof VNEXT_BUNDLE_FORM_IDS)[number];
export type VNextOutcomeBinding = "always" | "onSuccess" | "onFailure";

export type VNextSemanticDefinitionOperation = Readonly<
  | {
      kind: "set";
      path: readonly string[];
      value: string | number | boolean | readonly string[];
    }
  | {
      kind: "upsertByRef";
      path: readonly string[];
      entry: Readonly<
        | { goalRef: string; description: string }
        | { planRef: string; description: string }
      >;
    }
  | { kind: "removeByRef"; path: readonly string[]; ref: string }
>;

export type VNextWorldSemanticEffect = Readonly<
  | { kind: "relationTransition"; relationRef: string; toState: "active" | "ended" }
  | {
      kind: "definitionRevision";
      definitionRef: string;
      operations: readonly VNextSemanticDefinitionOperation[];
      summary: string;
    }
  | {
      kind: "registeredHazard";
      sourceDefinitionRef: string;
      zoneRef: string;
      damageProfileRef: "world-damage:falling-object:moderate";
    }
>;

export type VNextWorldInteractionBranchProposal = Readonly<{
  outcomeCode: string;
  summary: string;
  effects: readonly VNextWorldSemanticEffect[];
  sensoryEvidence: readonly Readonly<{
    observerRef: string;
    subjectRef: string | null;
    sense: "sight" | "hearing" | "smell" | "touch" | "taste" | "special";
    evidence: string;
    basisRefs: readonly string[];
  }>[];
  pressures: readonly Readonly<{
    description: string;
    sourceRef: string | null;
    basisRefs: readonly string[];
  }>[];
  opportunities: readonly Readonly<{
    description: string;
    targetRef: string | null;
    actionHint: string | null;
    basisRefs: readonly string[];
  }>[];
}>;

export type VNextBundleReference = Readonly<
  | { kind: "existing"; ref: string }
  | { kind: "prospective"; handle: string }
>;

export type VNextBundleProducedReference = Readonly<{
  handle: string;
  kind: "semanticDefinition";
  outcomeBinding: VNextOutcomeBinding;
}>;

export type VNextAttemptCost = Readonly<
  | { kind: "fictionTime"; durationMicros: string }
  | {
      kind: "item";
      entryRef: string;
      quantity: number;
      charges: number;
      durability: number;
    }
  | { kind: "resource"; resourceId: string; amount: number }
>;

export type VNextCheckParameters = Readonly<{
  checkKind: "abilityCheck" | "attack";
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
  skill: string | null;
  dc: number;
  mode: "normal" | "advantage" | "disadvantage";
}>;

/** A direct ruling has no invented failure branch. */
export type VNextDirectSuccessRuling = Readonly<{
  kind: "directSuccess";
  risk: string;
  successOutcome: string;
}>;

export type VNextCheckRuling = VNextCheckParameters & Readonly<{
  kind: "check";
  risk: string;
  successOutcome: string;
  failureOutcome: string;
}>;

/** High risk is pending until Room supplies a trusted confirmation. */
export type VNextHighRiskRuling = Readonly<{
  kind: "highRisk";
  risk: string;
  confirmationQuestion: string;
  successOutcome: string;
  failureOutcome: string;
  check: VNextCheckParameters | null;
  acceptedCosts: readonly VNextAttemptCost[];
}>;

export type VNextFeasibilityRuling =
  | VNextDirectSuccessRuling
  | VNextCheckRuling
  | VNextHighRiskRuling;

export type VNextPrerequisite = Readonly<{
  kind: "tool" | "knowledge" | "position" | "permission" | "condition";
  ref: string | null;
  description: string;
}>;

export type VNextNextAction = Readonly<{
  description: string;
  basisRefs: readonly string[];
}>;

export type VNextRefusalRuling = Readonly<{
  kind: "missingPrerequisite" | "worldLawViolation";
  publicBasis: string;
  prerequisites: readonly VNextPrerequisite[];
  nextActions: readonly VNextNextAction[];
  /** Costs that really occurred while trying, not hypothetical retry costs. */
  attemptCosts: readonly VNextAttemptCost[];
}>;

export type VNextClarificationContinuation = Readonly<
  | {
      kind: "adjudication";
      basisRefs: readonly string[];
      adjudication: VNextFeasibilityRuling;
      proposals: readonly VNextProposalBundleEntry[];
    }
  | {
      kind: "inWorldRefusal";
      basisRefs: readonly string[];
      intent: string;
      method: string;
      ruling: VNextRefusalRuling;
    }
  | { kind: "cancel" }
>;

export type VNextClarificationChoice = Readonly<{
  choiceId: string;
  label: string;
  publicRisk: string;
  basisRefs: readonly string[];
  /** Complete private continuation frozen by the first and only main KP call. */
  continuation: VNextClarificationContinuation;
}>;

export type VNextClarificationTerminal = Readonly<{
  kind: "clarification";
  intent: string;
  method: string;
  question: string;
  choices: readonly VNextClarificationChoice[];
}>;

export type VNextInWorldRefusalTerminal = Readonly<{
  kind: "inWorldRefusal";
  intent: string;
  method: string;
  ruling: VNextRefusalRuling;
}>;

export type VNextTerminalProposal =
  | VNextClarificationTerminal
  | VNextInWorldRefusalTerminal;

/**
 * The create form is deliberately a semantic definition, not an arbitrary
 * object/JSON patch.  Rules derives the authority definition id and any
 * mechanical ItemEntry from this sparse semantic source.
 */
export type VNextMaterializeObjectEntry = Readonly<{
  kind: "materializeObject";
  basisRefs: readonly string[];
  consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[];
  outcomeBinding: VNextOutcomeBinding;
  semanticKind: "sceneFeature" | "worldFact";
  templateRef: string;
  templateHash: string;
  visibilityPolicyRef: string;
  definition: VNextMaterializedDefinition;
  summary: string;
}>;

export type VNextMaterializedDefinition = Readonly<{
  /** Required for sceneFeature and null for the current worldFact slice. */
  sceneRef: string | null;
  /** Required only by hidden-until-evidence visibility. */
  visibilityFactId: string | null;
  label: string;
  description: string;
  observableState: string;
  affordances: readonly string[];
  mechanicDefinitionRefs: readonly string[];
}>;

/** Existing dynamic NPC/definition sparse revision remains available. */
export type VNextReviseSemanticDefinitionEntry = Readonly<{
  kind: "reviseSemanticDefinition";
  basisRefs: readonly string[];
  consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[];
  outcomeBinding: VNextOutcomeBinding;
  definitionRef: string;
  semanticKind: "npc";
  npcRef: string;
  baseRevision: string;
  baseHash: string;
  templateRef: string;
  templateHash: string;
  operations: readonly VNextSemanticDefinitionOperation[];
  summary: string;
}>;

export type VNextWorldInteractionEntry = Readonly<{
  kind: "worldInteraction";
  basisRefs: readonly string[];
  consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[];
  outcomeBinding: VNextOutcomeBinding;
  sceneRef: string;
  targetRefs: readonly string[];
  directTargetRefs: readonly string[];
  instrumentRefs: readonly string[];
  abilityRef: string | null;
  intent: string;
  method: string;
  branches: Readonly<{
    success: VNextWorldInteractionBranchProposal;
    /** Direct success has no model-authored failure branch. */
    failure: VNextWorldInteractionBranchProposal | null;
  }>;
}>;

export type VNextProposalBundleEntry =
  | VNextMaterializeObjectEntry
  | VNextReviseSemanticDefinitionEntry
  | VNextWorldInteractionEntry;

export type VNextAdjudicationBundle = Readonly<{
  schema: typeof VNEXT2_PROPOSAL_BUNDLE_SCHEMA;
  kind: "proposalBundle";
  mode: "adjudication";
  basisRefs: readonly string[];
  adjudication: VNextFeasibilityRuling;
  terminal: null;
  /** Empty for a terminal shape; non-empty for this branch. */
  proposals: readonly VNextProposalBundleEntry[];
}>;

export type VNextTerminalBundle = Readonly<{
  schema: typeof VNEXT2_PROPOSAL_BUNDLE_SCHEMA;
  kind: "proposalBundle";
  mode: "terminal";
  basisRefs: readonly string[];
  adjudication: null;
  terminal: VNextTerminalProposal;
  proposals: readonly [];
}>;

export type VNextProposalBundle = VNextAdjudicationBundle | VNextTerminalBundle;

export type VNextProposalBundleValidationResult =
  | Readonly<{ kind: "accepted"; bundle: VNextProposalBundle }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID";
      issues: readonly string[];
    }>;

export type VNextDerivedBundleEntry = Readonly<{
  entryRef: string;
  formId: Exclude<VNextBundleFormId, typeof VNEXT_CLARIFICATION_FORM_ID | typeof VNEXT_IN_WORLD_REFUSAL_FORM_ID>;
  kind: VNextProposalBundleEntry["kind"];
  ordinal: number;
  outcomeBinding: VNextOutcomeBinding;
  consumes: readonly VNextBundleReference[];
  produces: readonly Readonly<{
    handle: string;
    prospectiveRef: string;
    kind: VNextBundleProducedReference["kind"];
    outcomeBinding: VNextOutcomeBinding;
  }>[];
}>;

export type VNextDerivedBundlePlan = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA;
  /** Canonical hash of the adjudication Bundle itself. */
  bundleHash: string;
  /** Private branch identity when this plan belongs to a clarification choice. */
  derivationScope: string | null;
  /** Hash actually used to derive entry and prospective refs. */
  referenceNamespaceHash: string;
  rootActionId: string;
  actorCharacterId: string;
  contextHash: string;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  entries: readonly VNextDerivedBundleEntry[];
  executionOrder: readonly string[];
  /** Server-selected step that owns the one shared check, if any. */
  sharedCheckEntryRef: string | null;
  adjudication: VNextFeasibilityRuling;
}>;

export type VNextProposalBundleCommand =
  | Readonly<{
      kind: "rulesStep";
      rootActionId: string;
      actorCharacterId: string;
      formId: typeof VNEXT_MATERIALIZATION_FORM_ID | typeof VNEXT_WORLD_INTERACTION_FORM_ID | typeof VNEXT2_PROPOSAL_BUNDLE_SCHEMA;
      proposalRef: string;
      ruling: "directSuccess" | "check";
      rulesInput: JsonRecord;
      plan?: VNextDerivedBundlePlan;
    }>
  | Readonly<{
      kind: "pendingClarification";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      pendingInputId: string;
      question: string;
      choices: readonly Readonly<{
        choiceId: string;
        label: string;
        publicRisk: string;
        basisRefs: readonly string[];
      }>[];
    }>
  | Readonly<{
      kind: "inWorldRefusal";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      formId: typeof VNEXT_IN_WORLD_REFUSAL_FORM_ID;
      intent: string;
      method: string;
      ruling: VNextRefusalRuling;
      basisRefs: readonly string[];
    }>
  | Readonly<{
      kind: "highRiskConfirmed";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      formId: typeof VNEXT2_PROPOSAL_BUNDLE_SCHEMA;
      ruling: VNextHighRiskRuling;
      basisRefs: readonly string[];
      confirmationId: string;
      plan: VNextDerivedBundlePlan;
    }>;

export type VNextHighRiskConfirmation = Readonly<{
  kind: "highRiskConfirmation";
  confirmationId: string;
  rootActionId: string;
  contextHash: string;
  rulingHash: string;
}>;

export type VNextBundleCandidatePreflightInput = Readonly<{
  state: unknown;
  rootActionId: string;
  actorCharacterId: string;
  requiredContext: unknown;
  plan: VNextDerivedBundlePlan;
  bundle: VNextProposalBundle;
}>;

export type VNextBundleCandidatePreflightResult =
  | Readonly<{ kind: "accepted"; rulesInput: JsonRecord }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_REFERENCE_INVALID" | "DEFINITION_CONFLICT" | "BUNDLE_DEPENDENCY_INVALID" | "PROPOSAL_FORM_INVALID";
      issues: readonly string[];
    }>;

export type VNextBundleCandidatePreflight = (
  input: VNextBundleCandidatePreflightInput,
) => VNextBundleCandidatePreflightResult;

export type VNextProposalBundleLoweringInput = Readonly<{
  value: unknown;
  requiredContext: import("./required-context").VNextRequiredContext;
  state: import("../../rules/authority-read").AuthoritativeWorldState;
  rootActionId: string;
  actorCharacterId: string;
  highRiskConfirmation?: VNextHighRiskConfirmation;
  /** Rules-owned no-random candidate reducer/preflight. */
  candidatePreflight?: VNextBundleCandidatePreflight;
}>;

export type VNextProposalBundleLoweringResult =
  | Readonly<{ kind: "accepted"; command: VNextProposalBundleCommand }>
  | Readonly<{
      kind: "rejected";
      code:
        | "PROPOSAL_BUNDLE_INVALID"
        | "PROPOSAL_FORM_INVALID"
        | "PROPOSAL_REFERENCE_INVALID"
        | "DEFINITION_CONFLICT"
        | "BUNDLE_DEPENDENCY_INVALID"
        | "BUNDLE_LOWERING_UNSUPPORTED"
        | "CONTEXT_INSUFFICIENT"
        | "COST_INVALID";
      issues: readonly string[];
    }>;

export type VNextBundleCorrectionPath = readonly (string | number)[];

export type VNextBundleCorrection = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA;
  baseBundleHash: string;
  contextHash: string;
  attempt: 1;
  changes: readonly Readonly<{
    path: VNextBundleCorrectionPath;
    value: string;
  }>[];
}>;

export type VNextProposalBundleCorrectionInput = Readonly<{
  bundle: unknown;
  correction: unknown;
  requiredContext: import("./required-context").VNextRequiredContext;
  allowedPaths: readonly VNextBundleCorrectionPath[];
}>;

export type VNextProposalBundleCorrectionResult =
  | Readonly<{
      kind: "accepted";
      bundle: VNextProposalBundle;
      bundleHash: string;
    }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_CORRECTION_INVALID" | "PROPOSAL_REPAIR_EXHAUSTED";
      issues: readonly string[];
    }>;

/**
 * The live-gated stage-three transport exposes the direct-success and
 * shared-ability-check world-interaction and materialize-then-interact
 * slices. Under a check the Bundle's entries may bind to an outcome
 * (`onSuccess` / `onFailure`), so one roll decides the whole Bundle.
 *
 * The domain parser and validator remain broader than this transport, and a
 * later expansion must earn new Provider evidence before a Room can select
 * it: `attack` checks and `highRisk` rulings stay off the wire, the first
 * because it needs an abilityRef this transport pins to `none`, the second
 * because it is pending until Room supplies a trusted confirmation.
 *
 * Every `anyOf` branch declares a literal type because DeepSeek's strict beta
 * rejects a `$ref` used directly as a branch. The string sentinel `"none"`
 * represents nullable domain values and is normalized before local
 * validation.
 */
export const SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA = makeStrictBundleSchema();

export const CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    changes: Object.freeze({
      type: "array",
      items: Object.freeze({
        type: "object",
        properties: Object.freeze({
          path: Object.freeze({
            type: "array",
            items: Object.freeze({
              anyOf: Object.freeze([
                Object.freeze({ type: "string" }),
                Object.freeze({ type: "integer" }),
              ]),
            }),
          }),
          value: Object.freeze({ type: "string" }),
        }),
        required: Object.freeze(["path", "value"]),
        additionalProperties: false,
      }),
    }),
  }),
  required: Object.freeze(["changes"]),
  additionalProperties: false,
});

export const SUBMIT_KP_PROPOSAL_BUNDLE_TOOL = Object.freeze({
  type: "function" as const,
  function: Object.freeze({
    name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
    description: "提交一份共享裁决下的类型化行动提案束。",
    strict: true as const,
    parameters: SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA,
  }),
});

export const CORRECT_KP_PROPOSAL_BUNDLE_TOOL = Object.freeze({
  type: "function" as const,
  function: Object.freeze({
    name: CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
    description: "只修正服务器明确列出的提案束摘要字段。",
    strict: true as const,
    parameters: CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  }),
});

export type StrictToolBundleModelInput = Readonly<{
  messages: readonly Readonly<{ role: "user" | "system" | "assistant"; content: string }>[];
  tools: readonly [typeof SUBMIT_KP_PROPOSAL_BUNDLE_TOOL];
  tool_choice: "required";
  parallel_tool_calls: false;
  max_completion_tokens: number;
}>;

export function createSubmitKpProposalBundleModelInput(
  message: string,
): StrictToolBundleModelInput {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new TypeError("SUBMIT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  }
  return Object.freeze({
    messages: Object.freeze([{ role: "user" as const, content: message }]),
    tools: Object.freeze([SUBMIT_KP_PROPOSAL_BUNDLE_TOOL] as const),
    tool_choice: "required",
    parallel_tool_calls: false,
    max_completion_tokens: 4_000,
  });
}

export function createCorrectKpProposalBundleModelInput(
  message: string,
): Readonly<{
  messages: readonly Readonly<{ role: "user"; content: string }>[];
  tools: readonly [typeof CORRECT_KP_PROPOSAL_BUNDLE_TOOL];
  tool_choice: "required";
  parallel_tool_calls: false;
  max_completion_tokens: number;
}> {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new TypeError("CORRECT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  }
  return Object.freeze({
    messages: Object.freeze([{ role: "user" as const, content: message }]),
    tools: Object.freeze([CORRECT_KP_PROPOSAL_BUNDLE_TOOL] as const),
    tool_choice: "required",
    parallel_tool_calls: false,
    max_completion_tokens: 600,
  });
}

function makeStrictBundleSchema(): Record<string, unknown> {
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    properties,
    required: Object.keys(properties).sort(),
    additionalProperties: false,
  });
  const text = { type: "string", pattern: "[\\s\\S]+" };
  const refText = { type: "string", pattern: "^\\S+$" };
  const refArray = { type: "array", items: refText };
  const noneText = { type: "string", enum: ["none"] };
  const nullableRef = { ...refText };
  const nullableText = { ...text };
  const outcome = { type: "string", enum: ["always", "onSuccess", "onFailure"] };
  const reference = object({
    kind: { type: "string", enum: ["prospective"] },
    handle: refText,
  });
  const produced = object({
    handle: text,
    kind: { type: "string", enum: ["semanticDefinition"] },
    outcomeBinding: outcome,
  });
  const semanticOperation = {
    anyOf: [
      object({
        kind: { type: "string", enum: ["set"] },
        path: refArray,
        value: {
          anyOf: [
            text,
            { type: "number" },
            { type: "boolean" },
            { type: "array", items: text },
          ],
        },
      }),
      object({
        kind: { type: "string", enum: ["upsertByRef"] },
        path: refArray,
        entry: object({ goalRef: refText, description: text }),
      }),
      object({
        kind: { type: "string", enum: ["upsertByRef"] },
        path: refArray,
        entry: object({ planRef: refText, description: text }),
      }),
      object({
        kind: { type: "string", enum: ["removeByRef"] },
        path: refArray,
        ref: refText,
      }),
    ],
  };
  const effects = {
    type: "array",
    items: {
      anyOf: [
        object({
          kind: { type: "string", enum: ["relationTransition"] },
          relationRef: refText,
          toState: { type: "string", enum: ["active", "ended"] },
        }),
        object({
          kind: { type: "string", enum: ["definitionRevision"] },
          definitionRef: refText,
          operations: { type: "array", items: semanticOperation },
          summary: text,
        }),
        object({
          kind: { type: "string", enum: ["registeredHazard"] },
          sourceDefinitionRef: refText,
          zoneRef: refText,
          damageProfileRef: {
            type: "string",
            enum: ["world-damage:falling-object:moderate"],
          },
        }),
      ],
    },
  };
  const sensoryEvidence = object({
    observerRef: refText,
    subjectRef: nullableRef,
    sense: {
      type: "string",
      enum: ["sight", "hearing", "smell", "touch", "taste", "special"],
    },
    evidence: text,
    basisRefs: refArray,
  });
  const pressure = object({
    description: text,
    sourceRef: nullableRef,
    basisRefs: refArray,
  });
  const opportunity = object({
    description: text,
    targetRef: nullableRef,
    actionHint: nullableText,
    basisRefs: refArray,
  });
  const branch = object({
    outcomeCode: refText,
    summary: text,
    effects,
    sensoryEvidence: { type: "array", items: sensoryEvidence },
    pressures: { type: "array", items: pressure },
    opportunities: { type: "array", items: opportunity },
  });
  const noneBranch = object({ kind: { type: "string", enum: ["none"] } });
  const materializedDefinition = object({
    sceneRef: refText,
    visibilityFactId: noneText,
    label: text,
    description: text,
    observableState: text,
    affordances: { type: "array", items: text },
    mechanicDefinitionRefs: refArray,
  });
  const materializeObject = object({
    kind: { type: "string", enum: ["materializeObject"] },
    basisRefs: refArray,
    consumes: { type: "array", items: reference },
    produces: { type: "array", items: produced },
    outcomeBinding: outcome,
    semanticKind: { type: "string", enum: ["sceneFeature"] },
    templateRef: refText,
    templateHash: { type: "string" },
    visibilityPolicyRef: {
      type: "string",
      enum: ["visibility:scene-observers"],
    },
    definition: materializedDefinition,
    summary: text,
  });
  const worldInteraction = object({
    kind: { type: "string", enum: ["worldInteraction"] },
    basisRefs: refArray,
    consumes: { type: "array", items: reference },
    produces: { type: "array", items: produced },
    outcomeBinding: outcome,
    sceneRef: refText,
    targetRefs: refArray,
    directTargetRefs: refArray,
    instrumentRefs: refArray,
    abilityRef: noneText,
    intent: text,
    method: text,
    branches: object({
      success: branch,
      failure: { anyOf: [branch, noneBranch] },
    }),
  });
  return object({
    mode: { type: "string", enum: ["adjudication"] },
    basisRefs: refArray,
    adjudication: {
      anyOf: [
        object({
          kind: { type: "string", enum: ["directSuccess"] },
          risk: text,
          successOutcome: text,
        }),
        object({
          kind: { type: "string", enum: ["check"] },
          // Only `abilityCheck` is offered on the wire. An `attack` check
          // requires a non-null abilityRef (proposals.ts rejects the pair with
          // `world-interaction:attack-ability-required`), and this transport
          // pins abilityRef to the `none` sentinel, so an `attack` branch here
          // would be a shape the model could emit and the server could only
          // ever refuse.
          checkKind: { type: "string", enum: ["abilityCheck"] },
          ability: {
            type: "string",
            enum: ["str", "dex", "con", "int", "wis", "cha"],
          },
          skill: nullableRef,
          dc: { type: "integer", minimum: 1, maximum: 40 },
          mode: {
            type: "string",
            enum: ["normal", "advantage", "disadvantage"],
          },
          risk: text,
          successOutcome: text,
          failureOutcome: text,
        }),
      ],
    },
    terminal: object({ kind: { type: "string", enum: ["none"] } }),
    proposals: {
      type: "array",
      items: { anyOf: [materializeObject, worldInteraction] },
    },
  });
}

/** Convert strict-tool `none` sentinels to domain nulls. */
export function decodeVNextStrictToolBundle(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeVNextStrictToolBundle);
  const record = value as Record<string, unknown>;
  if (hasExactKeys(record, ["kind"]) && record.kind === "none") return null;
  if (hasExactKeys(record, ["ability", "checkKind", "dc", "mode", "skill"])
    && record.checkKind === "none"
    && record.ability === "none"
    && record.skill === "none"
    && record.dc === 0
    && record.mode === "normal") return null;
  const decoded = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) decoded[key] = decodeVNextStrictToolBundle(child);
  for (const key of [
    "abilityRef", "skill", "subjectRef", "sourceRef", "targetRef", "actionHint", "ref",
    "sceneRef", "visibilityFactId",
  ]) {
    if (decoded[key] === "none") decoded[key] = null;
  }
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}
