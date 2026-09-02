import type {
  JsonRecord,
  JsonValue,
} from "./canonical-json";
import type {
  SemanticDefinitionOperation,
} from "../../rules/authority-read";
import type {
  VNextWorldInteractionBranchProposal,
} from "./proposals";

/**
 * Model-facing ProposalBundle contract.
 *
 * This is intentionally a new contract rather than an envelope around the
 * old coarse-form draft.  The model submits one shared adjudication (or one
 * terminal answer) and typed operations; the server derives entry refs and
 * Form ids.  No model-authored node id, RootAction, authority id, or DAG is
 * part of this type.
 */
export const VNEXT_PROPOSAL_BUNDLE_SCHEMA =
  "zhuwei.kp-proposal-bundle/vnext-2" as const;

export const VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA =
  "zhuwei.kp-proposal-bundle-plan/vnext-2" as const;

export const VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA =
  "zhuwei.kp-proposal-bundle-correction/vnext-1" as const;

export const SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME =
  "submit_kp_proposal_bundle" as const;

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

export type VNextBundleReference = Readonly<
  | { kind: "existing"; ref: string }
  | { kind: "prospective"; handle: string }
>;

export type VNextBundleProducedReference = Readonly<{
  handle: string;
  kind: "semanticDefinition" | "canonicalFact" | "relation" | "itemEntry";
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

export type VNextClarificationChoice = Readonly<{
  choiceId: string;
  label: string;
  publicRisk: string;
  basisRefs: readonly string[];
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
  semanticKind: "item" | "sceneFeature" | "worldFact";
  templateRef: string;
  templateHash: string;
  visibilityPolicyRef: string;
  definition: JsonRecord;
  summary: string;
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
  operations: readonly SemanticDefinitionOperation[];
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
    failure: VNextWorldInteractionBranchProposal;
  }>;
}>;

export type VNextProposalBundleEntry =
  | VNextMaterializeObjectEntry
  | VNextReviseSemanticDefinitionEntry
  | VNextWorldInteractionEntry;

export type VNextAdjudicationBundle = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_SCHEMA;
  kind: "proposalBundle";
  mode: "adjudication";
  basisRefs: readonly string[];
  adjudication: VNextFeasibilityRuling;
  terminal: null;
  /** Empty for a terminal shape; non-empty for this branch. */
  proposals: readonly VNextProposalBundleEntry[];
}>;

export type VNextTerminalBundle = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_SCHEMA;
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
  bundleHash: string;
  rootActionId: string;
  actorCharacterId: string;
  contextHash: string;
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
  entries: readonly VNextDerivedBundleEntry[];
  executionOrder: readonly string[];
  adjudication: VNextFeasibilityRuling;
}>;

export type VNextProposalBundleCommand =
  | Readonly<{
      kind: "rulesStep";
      rootActionId: string;
      actorCharacterId: string;
      formId: typeof VNEXT_MATERIALIZATION_FORM_ID | typeof VNEXT_WORLD_INTERACTION_FORM_ID | typeof VNEXT_PROPOSAL_BUNDLE_SCHEMA;
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
      formId: typeof VNEXT_PROPOSAL_BUNDLE_SCHEMA;
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
    value: JsonValue;
  }>[];
}>;

export type VNextProposalBundleCorrectionInput = Readonly<{
  bundle: unknown;
  correction: unknown;
  requiredContext: import("./required-context").VNextRequiredContext;
  state: import("../../rules/authority-read").AuthoritativeWorldState;
  rootActionId: string;
  actorCharacterId: string;
  allowedPaths: readonly VNextBundleCorrectionPath[];
  highRiskConfirmation?: VNextHighRiskConfirmation;
  candidatePreflight?: VNextBundleCandidatePreflight;
}>;

export type VNextProposalBundleCorrectionResult =
  | Readonly<{
      kind: "accepted";
      bundle: VNextProposalBundle;
      command: VNextProposalBundleCommand;
      bundleHash: string;
    }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_CORRECTION_INVALID" | "PROPOSAL_REPAIR_EXHAUSTED";
      issues: readonly string[];
    }>;

/**
 * DeepSeek's beta strict dialect accepts only closed objects, local `$def`
 * references, bounded `anyOf`, and all-properties-required objects.  The
 * schema uses the string sentinel `"none"` where the domain type is nullable;
 * `decodeVNextStrictToolBundle` normalizes those sentinels before validation.
 */
export const SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA = makeStrictBundleSchema();

export const SUBMIT_KP_PROPOSAL_BUNDLE_TOOL = Object.freeze({
  type: "function" as const,
  function: Object.freeze({
    name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
    description: "提交一份共享裁决下的类型化行动提案束。",
    strict: true as const,
    parameters: SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA,
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
    max_completion_tokens: 1_200,
  });
}

function makeStrictBundleSchema(): Record<string, unknown> {
  const ref = (name: string) => ({ $ref: `#/$def/${name}` });
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    properties,
    required: Object.keys(properties).sort(),
    additionalProperties: false,
  });
  const text = { type: "string" };
  const refText = { type: "string", pattern: "^[^\\s]+$" };
  const refArray = { type: "array", items: refText };
  const noneText = { type: "string", enum: ["none"] };
  const outcome = { type: "string", enum: ["always", "onSuccess", "onFailure"] };
  const reference = {
    anyOf: [ref("existingReference"), ref("prospectiveReference")],
  };
  const produced = object({ handle: text, kind: {
    type: "string",
    enum: ["semanticDefinition", "canonicalFact", "relation", "itemEntry"],
  }, outcomeBinding: outcome });
  const cost = {
    anyOf: [ref("fictionTimeCost"), ref("itemCost"), ref("resourceCost")],
  };
  const check = object({
    checkKind: { type: "string", enum: ["abilityCheck", "attack"] },
    ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
    skill: refText,
    dc: { type: "integer" },
    mode: { type: "string", enum: ["normal", "advantage", "disadvantage"] },
  });
  const ruling = {
    anyOf: [ref("directSuccessRuling"), ref("checkRuling"), ref("highRiskRuling")],
  };
  const effects = { type: "array", items: { anyOf: [
    ref("relationEffect"), ref("definitionEffect"), ref("hazardEffect"),
  ] } };
  const branch = object({
    outcomeCode: refText,
    summary: text,
    effects,
    sensoryEvidence: { type: "array", items: ref("sensoryEvidence") },
    pressures: { type: "array", items: ref("pressure") },
    opportunities: { type: "array", items: ref("opportunity") },
  });
  const operation = { anyOf: [ref("materializeObject"), ref("reviseSemanticDefinition"), ref("worldInteraction")] };
  const schema: Record<string, unknown> = object({
    mode: { type: "string", enum: ["adjudication", "terminal"] },
    basisRefs: refArray,
    adjudication: { anyOf: [ruling, ref("noneRuling")] },
    terminal: { anyOf: [ref("clarificationTerminal"), ref("refusalTerminal"), ref("noneTerminal")] },
    proposals: { type: "array", items: operation },
  });
  schema.$def = {
    existingReference: object({ kind: { type: "string", enum: ["existing"] }, ref: refText }),
    prospectiveReference: object({ kind: { type: "string", enum: ["prospective"] }, handle: text }),
    fictionTimeCost: object({ kind: { type: "string", enum: ["fictionTime"] }, durationMicros: { type: "string", pattern: "^[1-9][0-9]*$" } }),
    itemCost: object({ kind: { type: "string", enum: ["item"] }, entryRef: refText, quantity: { type: "integer" }, charges: { type: "integer" }, durability: { type: "integer" } }),
    resourceCost: object({ kind: { type: "string", enum: ["resource"] }, resourceId: refText, amount: { type: "integer" } }),
    directSuccessRuling: object({ kind: { type: "string", enum: ["directSuccess"] }, risk: text, successOutcome: text }),
    checkRuling: object({ kind: { type: "string", enum: ["check"] }, ...check.properties, risk: text, successOutcome: text, failureOutcome: text }),
    highRiskRuling: object({ kind: { type: "string", enum: ["highRisk"] }, risk: text, confirmationQuestion: text, successOutcome: text, failureOutcome: text, check: { anyOf: [check, ref("noneCheck")] }, acceptedCosts: { type: "array", items: cost } }),
    noneRuling: object({ kind: { type: "string", enum: ["none"] } }),
    noneCheck: object({ checkKind: { type: "string", enum: ["none"] }, ability: noneText, skill: noneText, dc: { type: "integer" }, mode: { type: "string", enum: ["normal"] } }),
    relationEffect: object({ kind: { type: "string", enum: ["relationTransition"] }, relationRef: refText, toState: { type: "string", enum: ["active", "ended"] } }),
    definitionEffect: object({ kind: { type: "string", enum: ["definitionRevision"] }, definitionRef: refText, operations: { type: "array", items: ref("semanticOperation") }, summary: text }),
    hazardEffect: object({ kind: { type: "string", enum: ["registeredHazard"] }, sourceDefinitionRef: refText, zoneRef: refText, damageProfileRef: { type: "string", enum: ["world-damage:falling-object:moderate"] } }),
    sensoryEvidence: object({ observerRef: refText, subjectRef: refText, sense: { type: "string", enum: ["sight", "hearing", "smell", "touch", "taste", "special"] }, evidence: text, basisRefs: refArray }),
    pressure: object({ description: text, sourceRef: refText, basisRefs: refArray }),
    opportunity: object({ description: text, targetRef: refText, actionHint: refText, basisRefs: refArray }),
    semanticOperation: { anyOf: [ref("setOperation"), ref("removeOperation"), ref("upsertOperation"), ref("removeByRefOperation")] },
    setOperation: object({ kind: { type: "string", enum: ["set"] }, path: refArray, value: text }),
    removeOperation: object({ kind: { type: "string", enum: ["remove"] }, path: refArray }),
    upsertOperation: object({ kind: { type: "string", enum: ["upsertByRef"] }, path: refArray, entry: object({ ref: refText, label: text, description: text }) }),
    removeByRefOperation: object({ kind: { type: "string", enum: ["removeByRef"] }, path: refArray, ref: refText }),
    clarificationTerminal: object({ kind: { type: "string", enum: ["clarification"] }, intent: text, method: text, question: text, choices: { type: "array", items: ref("choice") } }),
    refusalTerminal: object({ kind: { type: "string", enum: ["inWorldRefusal"] }, intent: text, method: text, ruling: ref("refusalRuling") }),
    noneTerminal: object({ kind: { type: "string", enum: ["none"] } }),
    refusalRuling: { anyOf: [ref("missingPrerequisite"), ref("worldLawViolation")] },
    missingPrerequisite: object({ kind: { type: "string", enum: ["missingPrerequisite"] }, publicBasis: text, prerequisites: { type: "array", items: ref("prerequisite") }, nextActions: { type: "array", items: ref("nextAction") }, attemptCosts: { type: "array", items: cost } }),
    worldLawViolation: object({ kind: { type: "string", enum: ["worldLawViolation"] }, publicBasis: text, prerequisites: { type: "array", items: ref("prerequisite") }, nextActions: { type: "array", items: ref("nextAction") }, attemptCosts: { type: "array", items: cost } }),
    prerequisite: object({ kind: { type: "string", enum: ["tool", "knowledge", "position", "permission", "condition"] }, ref: refText, description: text }),
    nextAction: object({ description: text, basisRefs: refArray }),
    choice: object({ choiceId: text, label: text, publicRisk: text, basisRefs: refArray }),
    materializeObject: object({ kind: { type: "string", enum: ["materializeObject"] }, basisRefs: refArray, consumes: { type: "array", items: reference }, produces: { type: "array", items: produced }, outcomeBinding: outcome, semanticKind: { type: "string", enum: ["item", "sceneFeature", "worldFact"] }, templateRef: refText, templateHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, visibilityPolicyRef: refText, definition: ref("materializedDefinition"), summary: text }),
    materializedDefinition: object({ label: text, description: text, observableState: text, affordances: { type: "array", items: text }, mechanicDefinitionRefs: refArray }),
    reviseSemanticDefinition: object({ kind: { type: "string", enum: ["reviseSemanticDefinition"] }, basisRefs: refArray, consumes: { type: "array", items: reference }, produces: { type: "array", items: produced }, outcomeBinding: outcome, definitionRef: refText, semanticKind: { type: "string", enum: ["npc"] }, npcRef: refText, baseRevision: refText, baseHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, templateRef: refText, templateHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, operations: { type: "array", items: ref("semanticOperation") }, summary: text }),
    worldInteraction: object({ kind: { type: "string", enum: ["worldInteraction"] }, basisRefs: refArray, consumes: { type: "array", items: reference }, produces: { type: "array", items: produced }, outcomeBinding: outcome, sceneRef: refText, targetRefs: refArray, directTargetRefs: refArray, instrumentRefs: refArray, abilityRef: refText, intent: text, method: text, branches: object({ success: branch, failure: branch }) }),
  };
  return schema;
}

/** Convert strict-tool `none` sentinels to domain nulls. */
export function decodeVNextStrictToolBundle(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeVNextStrictToolBundle);
  const record = value as Record<string, unknown>;
  const decoded: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) decoded[key] = decodeVNextStrictToolBundle(child);
  for (const key of ["abilityRef", "skill", "subjectRef", "sourceRef", "targetRef", "actionHint", "ref"]) {
    if (decoded[key] === "none") decoded[key] = null;
  }
  if (decoded.kind === "none") return null;
  if (isRecord(decoded.check) && decoded.check.checkKind === "none") decoded.check = null;
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
