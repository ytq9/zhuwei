import { abilityOperationSourceSchema, type AbilityOperation } from "../../rules/v2/ability-operation";
import { NPC_ACTOR_PLAN_FORMATION_SOURCE_SCHEMA, type NpcActorPlanFormationSource } from "../../rules/v2/npc-plan-formation";
import { vnextProposalProducerContract, type VNextProposalProducerContract } from "./proposal-producer-contract";
import { proposalFillingSchema, encodeProposalFilling, decodeProposalFilling } from "./proposal-filling-interface";
import type { ProposalDiagnostic } from "./proposal-diagnostics";
import type { ProposalNpcSourceChoices } from "./proposal-context";
import type { VNextBasisReferenceChoices } from "./required-context-runtime";
import type { AuthoredWorldFact } from "../../rules/v2/world-facts";
import type { DynamicPassage } from "../../rules/v2/dynamic-locations";
import type { CanonicalTacticalGeometry } from "../../rules/profiles/tactical-geometry";
import { vnextProposalSystemPrompt } from "./proposal-guidance";
import type { PublicExpression } from "../../rules/v2/public-expression";
import { authoredProposalVariants, AUTHORED_EXECUTION_AREA_SCHEMA } from "./authored-proposal-contract";
import { compactDeepSeekStrictToolSchema } from "../deepseek-strict-schema-compaction";
import type { AuthoredDefinitionSource } from "../../rules/v2/authored-materialization";
import type { ItemOwnership } from "../../rules/v2/items";
import type { GearSlot } from "../../dnd/gear";
import { deepFreeze, type JsonRecord } from "./canonical-json";
import type { SocialInteractionBranch, SocialRetryChange } from "../../rules/v2/social-interaction";
import type { ObservationInference } from "../../rules/v2/character-inference";
import { closeVNextProposalCapabilities, VNEXT_PROPOSAL_CAPABILITIES, VNEXT_INITIAL_PROPOSAL_CAPABILITIES, VNEXT_PROPOSAL_CAPABILITY_IDS, type VNextProposalCapabilityId } from "./proposal-capabilities";

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
export const OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME = "offer_kp_proposal_bundle" as const;

export const VNEXT_CLARIFICATION_FORM_ID = "clarification.vnext-1" as const;
export const VNEXT_IN_WORLD_REFUSAL_FORM_ID = "in-world-refusal.vnext-1" as const;
export const VNEXT_MATERIALIZATION_FORM_ID = "materialization.vnext-1" as const;
export const VNEXT_INVENTORY_OPERATION_FORM_ID = "inventory-operation.vnext-1" as const;
export const VNEXT_WORLD_INTERACTION_FORM_ID = "world-interaction.vnext-1" as const;

export const VNEXT_SOCIAL_FORM_ID = "social.vnext-1" as const;
export const VNEXT_OBJECTIVE_CONTINUITY_FORM_ID = "objective-continuity.vnext-1" as const;
export const VNEXT_OBSERVE_FORM_ID = "observe.vnext-1" as const;

export const VNEXT_BUNDLE_FORM_IDS = Object.freeze([
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
  VNEXT_INVENTORY_OPERATION_FORM_ID,
  VNEXT_OBSERVE_FORM_ID,
  VNEXT_SOCIAL_FORM_ID,
  VNEXT_OBJECTIVE_CONTINUITY_FORM_ID,
] as const);

export type VNextBundleFormId = (typeof VNEXT_BUNDLE_FORM_IDS)[number];
export type VNextOutcomeBinding = "always" | "onSuccess" | "onFailure";

export type VNextSemanticDefinitionOperation = Readonly<
  | {
      kind: "set";
      path: readonly string[];
      value: string | number | boolean | readonly string[] | Readonly<PublicExpression>;
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
  | { kind: "traversePassage"; passageRef: string }
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
      damage:
        | { kind: "profile"; damageProfileRef: "world-damage:falling-object:moderate" }
        | { kind: "authored"; hazardDefinitionRef: string; area?: { origin: { x: string; y: string; elevation: string }; direction?: { x: string; y: string; elevation: string } } };
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
  kind: "semanticDefinition" | "abilityDefinition" | "hazardDefinition" | "itemDefinition" | "itemEntry";
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
  /** Fictional duration of the whole action, frozen before its result. "0"
   * only when the bundle merely authors world content. */
  durationMicros: string;
}>;

export type VNextCheckRuling = VNextCheckParameters & Readonly<{
  kind: "check";
  risk: string;
  successOutcome: string;
  failureOutcome: string;
  durationMicros: string;
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
  | { kind: "abilityOperation"; basisRefs: readonly []; operation: AbilityOperation }
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

export type VNextKnowledgeReviewTerminal = Readonly<{
  kind: "knowledgeReview";
  inquiry: string;
  scope: "allKnown" | "relevantKnown";
  knowledgeRefs: readonly string[];
}>;

export type VNextPassTimeTerminal = Readonly<{
  kind: "passTime";
  durationMicros: string;
}>;

export type VNextTerminalProposal =
  | VNextAbilityOperationTerminal
  | VNextPassTimeTerminal
  | VNextKnowledgeReviewTerminal
  | VNextClarificationTerminal
  | VNextInWorldRefusalTerminal;

export type VNextAbilityOperationTerminal = Readonly<{ kind: "abilityOperation"; operation: AbilityOperation }>;

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
  semanticKind: "sceneFeature" | "worldFact" | "location" | "passage";
  templateRef: string;
  templateHash: string;
  visibilityPolicyRef: string;
  definition: VNextMaterializedDefinition;
  summary: string;
}>;

export type VNextMaterializedDefinition = Readonly<{
  worldFact?: AuthoredWorldFact;
  geometry?: CanonicalTacticalGeometry;
  passage?: DynamicPassage;
  /** Required for sceneFeature and null for the current worldFact slice. */
  sceneRef: string | null;
  /** Required only by hidden-until-evidence visibility. */
  visibilityFactId: string | null;
  label: string;
  description: string;
  /** Null inherits the exact template default; wire uses the none sentinel. */
  observableState: string | null;
  affordances: readonly string[] | null;
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

export type VNextObserveBranch = Readonly<{
  outcomeCode: string; summary: string;
  sensoryEvidence: VNextWorldInteractionBranchProposal["sensoryEvidence"];
  characterInferences: readonly ObservationInference[];
}>;
export type VNextObserveEntry = Readonly<{
  kind: "observe"; basisRefs: readonly string[]; consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[]; outcomeBinding: VNextOutcomeBinding;
  sceneRef: string; focusRefs: readonly string[]; existingFactRefs: readonly string[];
  inquiry: string; method: string;
  branches: Readonly<{ success: VNextObserveBranch; failure: VNextObserveBranch | null }>;
}>;

export type VNextFormActorPlanEntry = NpcActorPlanFormationSource & Readonly<{
  kind: "formActorPlan"; basisRefs: readonly string[]; consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[]; outcomeBinding: VNextOutcomeBinding;
}>;

export type VNextSocialEntry = Readonly<{
  kind: "social"; basisRefs: readonly string[]; consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[]; outcomeBinding: VNextOutcomeBinding;
  sceneRef: string; npcRef: string; addressedThreadRef: string | null;
  goal: string; method: string; communication: "spokenConversation";
  audience: "participants" | "sceneListeners"; retryChange: SocialRetryChange | null;
  branches: Readonly<{ success: SocialInteractionBranch; failure: SocialInteractionBranch | null }>;
}>;

type VNextAuthoringCommon = Readonly<{
  basisRefs: readonly string[]; consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[]; outcomeBinding: VNextOutcomeBinding; summary: string;
}>;
export type VNextMaterializeDefinitionEntry = VNextAuthoringCommon & Readonly<{
  kind: "materializeDefinition"; source: AuthoredDefinitionSource; visibilityPolicyRef: string;
}>;
export type VNextMaterializeItemEntry = VNextAuthoringCommon & Readonly<{
  kind: "materializeItem"; definitionRef: string; sceneRef: string; quantity: number;
  ownership: ItemOwnership; visibilityPolicyRef: string; uniquenessBasisRef?: string;
}>;
export type VNextInventoryOperation =
  | import("../../rules/v2/item-assembly-shapes").ItemAssemblyOperation
  | { kind: "acquire"; entryRef: string; quantity: number }
  | { kind: "identify"; entryRef: string }
  | { kind: "release"; entryRef: string; quantity: number; sceneRef: string; releaseKind: "placement" | "drop" | "loss" }
  | { kind: "transfer"; entryRef: string; quantity: number; targetCharacterRef: string; ownershipDisposition: "preserve" | "transferToRecipient" }
  | { kind: "equip"; entryRef: string; action: "wear" | "stow"; slot: GearSlot }
  | { kind: "use"; entryRef: string; targetRefs: string[]; area?: { origin: { x: string; y: string; elevation: string }; direction?: { x: string; y: string; elevation: string } } }
  | { kind: "lifecycle"; entryRef: string; action: "break" | "repair" | "destroy" };
export type VNextInventoryOperationEntry = VNextAuthoringCommon & Readonly<{
  kind: "inventoryOperation"; operation: VNextInventoryOperation;
}>;

export type VNextProposalBundleEntry =
  | VNextNarrativeDetailEntry
  | VNextMaterializeObjectEntry
  | VNextMaterializeDefinitionEntry
  | VNextMaterializeItemEntry
  | VNextInventoryOperationEntry
  | VNextReviseSemanticDefinitionEntry
  | VNextWorldInteractionEntry
  | VNextObserveEntry
  | VNextSocialEntry
  | VNextFormActorPlanEntry;

export type VNextNarrativeDetailEntry = Readonly<{
  kind: "commitNarrativeDetail";
  basisRefs: readonly string[];
  consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[];
  outcomeBinding: VNextOutcomeBinding;
  sceneRef: string;
  label: string;
  description: string;
  audience: "sceneObservers" | "actorOnly";
}>;

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
      diagnostics?: readonly ProposalDiagnostic[];
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
      diagnostics?: readonly ProposalDiagnostic[];
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
      diagnostics?: readonly ProposalDiagnostic[];
    }>;

export type VNextBundleCorrectionPath = readonly (string | number)[];

export type VNextBundleCorrection = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA;
  baseBundleHash: string;
  contextHash: string;
  attempt: 1;
  changes: readonly Readonly<{
    path: VNextBundleCorrectionPath;
    value: string | null | readonly string[] | readonly VNextBundleReference[];
  }>[];
}>;

export type VNextProposalBundleCorrectionInput = Readonly<{
  bundle: unknown;
  correction: unknown;
  requiredContext: import("./required-context").VNextRequiredContext;
  allowedPaths: readonly VNextBundleCorrectionPath[];
  /** Exact original provider string; absent for already-decoded arguments. */
  originalArguments?: string;
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
      diagnostics?: readonly ProposalDiagnostic[];
    }>;

/**
 * The live-gated stage-three transport exposes the direct-success and
 * shared-ability-check world-interaction and materialize-then-interact
 * slices, plus the in-world refusal terminal. Under a check the Bundle's
 * entries may bind to an outcome (`onSuccess` / `onFailure`), so one roll
 * decides the whole Bundle.
 *
 * A refusal is a terminal bundle: the world declining an action is a
 * mechanical outcome the player is owed, not an error, and SPEC 0001
 * acceptance scenario B requires it to be stated plainly rather than hidden
 * behind an unreachable DC. Clarification carries complete, nonrecursive
 * continuations using the same selected variants as ordinary proposals.
 *
 * The domain parser and validator remain broader than this transport, and a
 * later expansion must earn new Provider evidence before a Room can select
 * it: `highRisk` rulings stay off the wire because they are pending until
 * Room supplies a trusted confirmation, and `reviseSemanticDefinition` has no
 * lowering yet.
 *
 * Every `anyOf` branch declares a literal type because DeepSeek's strict beta
 * rejects a `$ref` used directly as a branch. Nullable references explicitly
 * offer `{kind:"none"}` and normalize it before local validation. The existing
 * string sentinel `"none"` remains accepted by the same decoder.
 */
export function createVNextProposalBundleSchema(capabilities: readonly string[] = VNEXT_PROPOSAL_CAPABILITY_IDS,
  itemEntryRefs?: readonly string[], observationSubjectRefs?: readonly string[], terminalKinds?: readonly string[], npcSources?: ProposalNpcSourceChoices,
  basisChoices?: VNextBasisReferenceChoices, creatureRefs?: readonly string[]) {
  return Object.freeze(compactDeepSeekStrictToolSchema(proposalFillingSchema(makeStrictBundleSchema(closeVNextProposalCapabilities(capabilities), itemEntryRefs, observationSubjectRefs, basisChoices, creatureRefs), terminalKinds, npcSources)));
}

/** Selection admission reads the exact same derived wire discriminants. */
export function vnextSelectedProposalDecisionKinds(capabilities: readonly VNextProposalCapabilityId[], terminalKinds?: readonly string[]): readonly string[] {
  return proposalFillingSchema(makeStrictBundleSchema(capabilities), terminalKinds)
    .properties.decision.anyOf.flatMap((variant: { properties: { kind: { enum: string[] } } }) => variant.properties.kind.enum);
}

// All proposal consumers share the same closed existing/prospective references.
const CONSUMED_REFERENCE_SCHEMAS = deepFreeze([
  { type: "object", properties: {
    kind: { type: "string", enum: ["prospective"] },
    handle: { type: "string", pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      description: "A bundle-local handle beginning with prospective:, reused exactly by its consumers." },
  }, required: ["handle", "kind"], additionalProperties: false },
  { type: "object", properties: {
    kind: { type: "string", enum: ["existing"] }, ref: { type: "string", pattern: "^\\S+$" },
  }, required: ["kind", "ref"], additionalProperties: false },
]);

/** Closed producer declarations use the registered zero-or-one contract. */
function producerReferenceSchema(contract: VNextProposalProducerContract) {
  return contract.count === 0
    ? { type: "object", properties: { kind: { type: "string", enum: ["none"] } }, required: ["kind"], additionalProperties: false }
    : { type: "object", properties: {
      handle: { type: "string", pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
        description: "A bundle-local handle beginning with prospective:, reused exactly by its consumers." },
      kind: { type: "string", enum: [contract.kind] },
      outcomeBinding: { type: "string", enum: ["always", "onSuccess", "onFailure"],
        description: "Must exactly match this proposal's outcomeBinding." },
    }, required: ["handle", "kind", "outcomeBinding"], additionalProperties: false };
}

export const SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA = createVNextProposalBundleSchema();

/** Diagnostic vocabulary of the one internal validator draft. This is never
 * offered to the model; telemetry needs both wire and assembled field names. */
export const VNEXT_PROPOSAL_DOMAIN_DIAGNOSTIC_SCHEMA = deepFreeze(makeStrictBundleSchema(VNEXT_PROPOSAL_CAPABILITY_IDS));

/** Model confirms this request's frozen server plan; only presentation text is supplied. */
export const VNEXT_PROPOSAL_PLAN_CONFIRMATION_PROTOCOL = "zhuwei.kp-proposal-plan-confirmation/v1" as const;
export const CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA = deepFreeze({
  type: "object",
  properties: {
    confirm: { type: "string", enum: ["server-plan"],
      description: "Explicitly confirm all fixed repairs and representation evidence in this frozen request." },
    summaries: { type: "array", items: {
      type: "object", properties: {
        path: { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer" }] } },
        value: { type: "string", description: "Presentation summary of existing frozen operations; no new fact, ruling, cost or consequence." },
      }, required: ["path", "value"], additionalProperties: false,
    } },
  }, required: ["confirm", "summaries"], additionalProperties: false,
});

export const SUBMIT_KP_PROPOSAL_BUNDLE_TOOL = Object.freeze({
  type: "function" as const,
  function: Object.freeze({
    name: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
    description: "提交一份共享裁决下完整的类型化行动提案束；按字段schema、实际依据和已加载填写指导组合操作。",
    strict: true as const,
    parameters: SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA,
  }),
});

/** Terminal identities come from the same executable domain-to-wire transform.
 * The selector advertises types only; it has no draft or world-state effect. */
export const VNEXT_INITIAL_PROPOSAL_DECISION_KINDS: readonly string[] = Object.freeze(
  (proposalFillingSchema(makeStrictBundleSchema(VNEXT_INITIAL_PROPOSAL_CAPABILITIES)) as {
    properties: { decision: { anyOf: readonly { properties: { kind: { enum: readonly string[] } } }[] } };
  }).properties.decision.anyOf.flatMap(variant => variant.properties.kind.enum),
);

export const VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS: readonly string[] = Object.freeze([
  ...VNEXT_INITIAL_PROPOSAL_DECISION_KINDS, ...VNEXT_PROPOSAL_CAPABILITY_IDS,
]);
export type VNextProposalSchemaSelection = Readonly<{
  capabilities: readonly VNextProposalCapabilityId[];
  terminalKinds: readonly string[];
}>;

/** Retain selected terminal identities; only step families acquire dependencies.
 * The caller validates unique submitted values before this canonical closure. */
export function closeVNextProposalSchemaRequest(requested: readonly string[]): VNextProposalSchemaSelection {
  return Object.freeze({
    terminalKinds: Object.freeze(VNEXT_INITIAL_PROPOSAL_DECISION_KINDS.filter(id => requested.includes(id))),
    capabilities: closeVNextProposalCapabilities(requested.filter(id => !VNEXT_INITIAL_PROPOSAL_DECISION_KINDS.includes(id))),
  });
}

export const OFFER_KP_PROPOSAL_BUNDLE_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  properties: { requestedCapabilities: { type: "array", items: { type: "string", enum: [...VNEXT_PROPOSAL_SCHEMA_REQUEST_IDS] },
    description: "Select all required catalog types once. This selects filling schemas only and contains no draft, ruling, target, cost or outcome." } },
  required: ["requestedCapabilities"],
});
export const OFFER_KP_PROPOSAL_BUNDLE_TOOL = Object.freeze({
  type: "function" as const,
  function: Object.freeze({ name: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, strict: true as const,
    description: "只选择本次完整行动需要的类型目录 ID；唯一字段 requestedCapabilities，不填写任何提案内容。",
    parameters: OFFER_KP_PROPOSAL_BUNDLE_SCHEMA }),
});

export function createVNextProposalOfferModelInput(message: string) {
  if (typeof message !== "string" || !message.trim()) throw new TypeError("SUBMIT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  return Object.freeze({ messages: Object.freeze([{ role: "system" as const,
    content: vnextProposalSystemPrompt("offer", [], VNEXT_INITIAL_PROPOSAL_DECISION_KINDS) }, { role: "user" as const, content: message }]),
    tools: Object.freeze([OFFER_KP_PROPOSAL_BUNDLE_TOOL] as const),
    tool_choice: "required" as const, parallel_tool_calls: false as const, max_completion_tokens: 4_000 });
}

export const CORRECT_KP_PROPOSAL_BUNDLE_TOOL = Object.freeze({
  type: "function" as const,
  function: Object.freeze({
    name: CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
    description: "明确确认当前冻结请求的全部服务端固定修复计划，confirm必须为server-plan；只在summaries逐项填写summaryPaths的自由摘要，没有自由摘要时填[]。不复制固定patch，不改变原裁决、引用或结果。",
    strict: true as const,
    parameters: CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  }),
});

export type StrictToolBundleModelInput = Readonly<{
  messages: readonly Readonly<{ role: "user" | "system" | "assistant"; content: string }>[];
  tools:
    | readonly [typeof SUBMIT_KP_PROPOSAL_BUNDLE_TOOL]
    | readonly [typeof SUBMIT_KP_PROPOSAL_BUNDLE_TOOL, typeof OFFER_KP_PROPOSAL_BUNDLE_TOOL];
  tool_choice: "required";
  parallel_tool_calls: false;
  max_completion_tokens: number;
}>;

export function createSubmitKpProposalBundleModelInput(
  message: string,
  capabilities: readonly VNextProposalCapabilityId[] = VNEXT_PROPOSAL_CAPABILITY_IDS,
  itemEntryRefs?: readonly string[],
  observationSubjectRefs?: readonly string[],
  terminalKinds: readonly string[] = VNEXT_INITIAL_PROPOSAL_DECISION_KINDS,
  npcSources?: ProposalNpcSourceChoices,
  basisChoices?: VNextBasisReferenceChoices,
  creatureRefs?: readonly string[],
  /** Offers the selection tool alongside the proposal so one intent that needs
   * a type this selection lacks can still say so. The amended round drops it:
   * selection is amendable once, and never a way to reopen a decision. */
  amendable = false,
): StrictToolBundleModelInput {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new TypeError("SUBMIT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  }
  const submitTool = { ...SUBMIT_KP_PROPOSAL_BUNDLE_TOOL,
    function: Object.freeze({ ...SUBMIT_KP_PROPOSAL_BUNDLE_TOOL.function,
      parameters: createVNextProposalBundleSchema(capabilities, itemEntryRefs, observationSubjectRefs, terminalKinds, npcSources, basisChoices, creatureRefs) }),
  };
  return Object.freeze({
    messages: Object.freeze([{ role: "system" as const, content: vnextProposalSystemPrompt("expandedProposal", capabilities, terminalKinds, amendable) }, { role: "user" as const, content: message }]),
    tools: Object.freeze(amendable ? [submitTool, OFFER_KP_PROPOSAL_BUNDLE_TOOL] as const : [submitTool] as const),
    tool_choice: "required",
    parallel_tool_calls: false,
    max_completion_tokens: 4_000,
  });
}

export function createCorrectKpProposalBundleModelInput(
  message: string,
): Readonly<{
  messages: readonly Readonly<{ role: "system" | "user"; content: string }>[];
  tools: readonly [typeof CORRECT_KP_PROPOSAL_BUNDLE_TOOL];
  tool_choice: "required";
  parallel_tool_calls: false;
  max_completion_tokens: number;
}> {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new TypeError("CORRECT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  }
  return Object.freeze({
    messages: Object.freeze([{ role: "system" as const, content: vnextProposalSystemPrompt("correction") }, { role: "user" as const, content: message }]),
    tools: Object.freeze([CORRECT_KP_PROPOSAL_BUNDLE_TOOL] as const),
    tool_choice: "required",
    parallel_tool_calls: false,
    max_completion_tokens: 600,
  });
}

function makeStrictBundleSchema(capabilities: readonly VNextProposalCapabilityId[], itemEntryRefs?: readonly string[],
  observationSubjectRefs?: readonly string[], basisChoices?: VNextBasisReferenceChoices,
  creatureRefs?: readonly string[]): Record<string, unknown> {
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    properties,
    required: Object.keys(properties).sort(),
    additionalProperties: false,
  });
  const text = { type: "string", pattern: "[\\s\\S]+" };
  const refText = { type: "string", pattern: "^\\S+$" };
  const refArray = { type: "array", items: refText };
  const hasProducer = capabilities.some(id => {
    const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id)!;
    return vnextProposalProducerContract(capability.proposalKind,
      "definitionKind" in capability ? capability.definitionKind : undefined)?.count === 1;
  });
  const basisArray = (refs: readonly string[] | undefined, prospective = false) => {
    if (refs === undefined) return refArray; // Unbound domain vocabulary, never the production request's choices.
    const variants: Record<string, unknown>[] = refs.length ? [{ type: "string", enum: [...refs] }] : [];
    if (prospective) variants.push({ type: "string", pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" });
    // The strict subset has no empty enum or maxItems. ^$a matches no
    // string: the empty reference language permits [] but no array member.
    // This does not invent a reference or reject otherwise legal empty lists.
    return { type: "array", items: variants.length === 0 ? { type: "string", pattern: "^$a" }
      : variants.length === 1 ? variants[0] : { anyOf: variants } };
  };
  const existingBasisDescription = "Exact supporting authority references from RequiredContext.references.citations or an entry's listed basisRefs. An openBlank or knownAbsent entryRef is context metadata, not a citable world record; use its authorized supporting references instead.";
  const existingBasisRefs = { ...basisArray(basisChoices?.existingRefs), description: existingBasisDescription };
  const basisRefs = { ...basisArray(basisChoices?.existingRefs, hasProducer), description: `${existingBasisDescription}${hasProducer
    ? " A proposal may also cite an exact handle declared by a supported same-bundle producer through its typed reference slots; the server derives and validates the matching dependency." : " No same-bundle producer type was selected; use existing choices only."}` };
  const noneText = { type: "string", enum: ["none"] };
  const noneReference = object({ kind: noneText });
  const nullableRef = {
    anyOf: [refText, noneReference],
    description: "Use an exact bound reference when present. When absent, use exactly {kind:'none'}; never an empty string and never omit the field.",
  };
  // A wire selection aid over frozen, Viewer-visible world subjects. The
  // accepting validator and Rules target authority remain unchanged.
  const subjectVariants = observationSubjectRefs === undefined ? [refText] : [
    ...(observationSubjectRefs.length ? [{ type: "string", enum: [...observationSubjectRefs] }] : []),
    { type: "string", pattern: "^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
  ];
  const subjectRef = { anyOf: subjectVariants };
  const nullableSubjectRef = { anyOf: [...subjectVariants, noneReference] };
  const nullableText = { ...text };
  const outcome = { type: "string", enum: ["always", "onSuccess", "onFailure"] };
  // The two reference kinds carry different fields, so this is a union and
  // not a flat shape with a discriminator: a prospective consume names a
  // bundle-local handle, an existing one names a frozen authority ref, and
  // neither can carry the other's field.
  const references = CONSUMED_REFERENCE_SCHEMAS;
  const produced = (kind: string, definitionKind?: string) => {
    const contract = vnextProposalProducerContract(kind, definitionKind);
    if (!contract) throw new TypeError("PROPOSAL_PRODUCER_CONTRACT_UNAVAILABLE");
    return producerReferenceSchema(contract);
  };
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
          kind: { type: "string", enum: ["traversePassage"] },
          passageRef: refText,
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
          // The danger the runtime ships, or one the KP froze this session
          // under SPEC 0001 section 8. Two closed variants rather than one
          // shape with both fields optional, so an effect can never name a
          // profile and a definition at once.
          damage: {
            anyOf: [
              object({
                kind: { type: "string", enum: ["profile"] },
                damageProfileRef: {
                  type: "string",
                  enum: ["world-damage:falling-object:moderate"],
                },
              }),
              object({
                kind: { type: "string", enum: ["authored"] },
                hazardDefinitionRef: refText,
              }),
              object({
                kind: { type: "string", enum: ["authored"] },
                hazardDefinitionRef: refText,
                area: AUTHORED_EXECUTION_AREA_SCHEMA,
              }),
            ],
          },
        }),
      ],
    },
  };
  const sensoryEvidence = object({
    observerRef: { ...refText, description: "The character who perceives this evidence; this is the observer, not the object being observed." },
    subjectRef: { ...nullableSubjectRef, description: "The actual perceived world subject from observationSubjectRefs, or an explicit same-bundle prospective object. Knowledge IDs, catalogs and rule profiles are supporting records, never subjects. Use exactly {kind:'none'} for evidence without an individual subject." },
    sense: {
      type: "string",
      enum: ["sight", "hearing", "smell", "touch", "taste", "special"],
    },
    evidence: { ...text, description: "Only information directly perceived by this observer and supported by these basis records. Interpretations of past events, causes, timing or motives belong in observe.characterInferences with evidence and confidence, not sensoryEvidence. Preserve established positions, dimensions, quantities, and properties. Propose new nonmechanical environmental descriptions as separate commitNarrativeDetail entries so their original wording is saved before publication. New consequential objects or facts must first be explicitly materialized within an open-blank grant; this field does not create either authority records or narrative commitments." },
    basisRefs: { ...basisRefs, description: `${basisRefs.description} Cite records supporting the contents of this evidence, not merely a nearby scene. A known absence requires an actual scoped absence record; an open blank does not prove presence or absence.` },
  });
  const inference = object({
    conclusion: { ...text, description: "An interpretation, not a new objective world fact or a player belief/decision." },
    confidence: { ...text, description: "State uncertainty and limits justified by the evidence; do not upgrade an interpretation into observed truth." },
    evidence: { type: "array", items: { anyOf: [
      object({ kind: { type: "string", enum: ["heldKnowledge"] }, ref: { ...refText, description: "Exact raw knowledgeRef held by the acting character in the frozen knowledge catalog, never a world object ID or another character's private record." } }),
      object({ kind: { type: "string", enum: ["sensoryEvidence"] }, index: { type: "integer", minimum: 0, description: "Zero-based index into THIS outcome branch's sensoryEvidence; its observer must be the acting character." } }),
    ] } },
  });
  const observeBranch = object({ outcomeCode: refText, summary: text,
    sensoryEvidence: { type: "array", items: sensoryEvidence },
    characterInferences: { type: "array", items: inference },
  });
  const observe = object({ kind: { type: "string", enum: ["observe"] }, basisRefs,
    consumes: { type: "array", items: { anyOf: references } }, produces: produced("observe"), outcomeBinding: outcome,
    sceneRef: refText, inquiry: text, method: text,
    focusRefs: { type: "array", items: subjectRef, description: "Actual visible observation subjects from observationSubjectRefs or same-bundle prospective objects. Held knowledge, catalogs and rule profiles belong in existingFactRefs/basisRefs, never focusRefs. Use [] for reasoning from held knowledge without new perception." },
    existingFactRefs: { ...refArray, description: "Existing frozen authority records supporting the observation; these do not grant holder knowledge." },
    branches: object({ success: observeBranch, failure: { anyOf: [observeBranch, object({ kind: { type: "string", enum: ["none"] } })] } }),
  });
  const socialEvidence = { anyOf: [
    object({ kind: { type: "string", enum: ["npcContext"] }, ref: { ...refText, description: "Exact ref from the selected NPC's npc-decision records, or its knowledge entryRef/knowledgeRef. A local knowledgeRef resolves only within this NPC's fully loaded holder snapshot; another holder's entryRef is never accepted." } }),
    object({ kind: { type: "string", enum: ["playerExpression"] } }),
    object({ kind: { type: "string", enum: ["materializedKnowledge"] },
      definitionRef: { ...refText, description: "Only the prospective handle of an always-bound worldFact producer in this same bundle, also declared in consumes. Never an existing knowledgeRef, knowledge entryRef or older definition ID. For already-held knowledge choose kind=npcContext and its ref field. This variant requires actual canonical creation and initial knowledge for the holder before speech." },
      holderRef: { ...refText, description: "The responding npcRef; this same NPC must be an explicit initialKnowledge holder of the new worldFact." } }),
  ] };
  const socialConsequence = { anyOf: [
    object({ kind: { type: "string", enum: ["relationship"] }, relationshipRef: nullableRef, change: text, basisFactRefs: refArray }),
    object({ kind: { type: "string", enum: ["promise"] }, content: text, condition: text, authorityRefs: refArray }),
    object({ kind: { type: "string", enum: ["debt"] }, obligation: text, condition: text, basisFactRefs: refArray }),
  ] };
  const socialBranch = object({ outcomeCode: refText, summary: text,
    response: object({ kind: { type: "string", enum: ["speech", "silence"] },
      text: { type: "string", description: "Only words actually spoken by this NPC, without stage directions or physical actions; use an empty string only for silence. KP may author unrecorded personal history consistent with established background and canon; newly authored content does not require a pre-existing citation proving that same content. Existing references identify relevant constraints or held knowledge. Record new true history through canonical creation; speech alone remains an attributed source claim. Statements may be true, mistaken, exaggerated, outdated or deliberately deceptive; conflict with world truth alone does not invalidate attributed speech. Freeze the NPC's information basis and private motive or mistaken belief before execution; do not retrofit a lie to excuse an inconsistent draft. Preserve uncertainty, explicit unknowns and access limits. Neither private motives nor the player's unspoken goal become spoken or known facts." },
      motive: { ...text, description: "Private NPC decision rationale consistent with this NPC's knowledge, character, established background and authority; not public narration. An unrecorded background detail is open to KP authorship, while an explicit lack of knowledge is a constraint." },
      basis: { type: "array", items: socialEvidence } }),
    consequences: { type: "array", items: socialConsequence, description: "Only relations between actor and NPC, or this NPC's own promise/debt to the actor. A promise records future conduct; it does not open a door, transfer an item, create world truth or commit the player to conduct. Physical fulfillment requires its own legal operation." },
  });
  const social = object({ kind: { type: "string", enum: ["social"] }, basisRefs,
    consumes: { type: "array", items: { anyOf: references } }, produces: produced("social"), outcomeBinding: outcome,
    sceneRef: refText, npcRef: { ...refText, description: "An existing NPC with a complete, server-frozen npc-decision context. The server derives listeners and preserves the original player expression." },
    addressedThreadRef: nullableRef, goal: text, method: text, communication: { type: "string", enum: ["spokenConversation"] },
    audience: { type: "string", enum: ["participants", "sceneListeners"] },
    retryChange: { anyOf: [object({ kind: { type: "string", enum: ["none"] } }),
      object({ kind: { type: "string", enum: ["method", "conditions", "situation"] }, priorThreadRef: refText,
        basisRefs, explanation: { ...text, description: "Explain a substantive change from the addressed failed attempt. Rephrasing the same request is not a new attempt. Cite changed concrete conditions for conditions/situation; method requires an actually different approach." } })] },
    branches: object({ success: socialBranch, failure: { anyOf: [socialBranch, object({ kind: { type: "string", enum: ["none"] } })] } }),
  });
  const pressure = object({
    description: text,
    sourceRef: nullableRef,
    basisRefs,
  });
  const opportunity = object({
    description: text,
    targetRef: nullableRef,
    actionHint: nullableText,
    basisRefs,
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
  /**
   * `materializeObject` as a union of closed variants rather than one flat
   * shape plus conditional rules.
   *
   * A sceneFeature names a scene and, when hidden-until-evidence, an existing
   * visibility fact. A worldFact names neither: Rules derives its own fact
   * identity and grants initial holder knowledge atomically. World facts
   * cannot use scene-observers. Closed variants encode these combinations in
   * the strict dialect instead of relying on conditional prose.
   */
  const materializeVariant = (
    semanticKind: string,
    sceneRef: Record<string, unknown>,
    policies: readonly string[],
    visibilityFactId: Record<string, unknown>,
  ) => object({
    kind: { type: "string", enum: ["materializeObject"] },
    basisRefs,
    consumes: { type: "array", items: { anyOf: references } },
    produces: produced("materializeObject"),
    outcomeBinding: outcome,
    semanticKind: { type: "string", enum: [semanticKind] },
    templateRef: refText,
    templateHash: { type: "string" },
    visibilityPolicyRef: { type: "string", enum: [...policies] },
    definition: object({
      sceneRef,
      visibilityFactId,
      label: text,
      description: text,
      observableState: semanticKind === "passage" ? { type: "string", enum: ["open", "closed", "blocked"] }
        : semanticKind === "location" ? noneText
        : { ...text, description: "Use none to inherit the exact template default, or provide the instance's observable state." },
      affordances: semanticKind === "location" || semanticKind === "passage" ? noneText : { anyOf: [{ type: "array", items: text }, noneText],
        description: "Use none to inherit the template defaults; an array explicitly replaces them." },
      mechanicDefinitionRefs: refArray,
      ...(semanticKind === "location" ? { geometry: dynamicLocationGeometrySchema() } : {}),
      ...(semanticKind === "passage" ? { passage: object({ fromLocationRef: refText, toLocationRef: refText,
        bidirectional: { type: "boolean" }, traversal: text, travelDurationMicros: text }) } : {}),
      ...(semanticKind === "worldFact" ? { worldFact: object({
        subjectRefs: refArray, occurrence: { ...text, description: "When the actual event or experience happened, distinct from this turn when it is committed." },
        initialKnowledge: { type: "array", items: object({ holderRef: refText, acquisitionBasisRefs: refArray,
          acquisitionExplanation: { ...text, description: "Why this NPC knows this new fact. Cite its own context as constraints, not a prior copy of the new proposition. Hearing a claim establishes hearing it, not that its content is true." } }) },
        consistency: object({ judgment: { type: "string", enum: ["compatible", "conflict", "uncertain"] },
          explanation: { ...text, description: "Check frozen factConstraints, core truth, relevant anchors, NPC identity, explicit unknowns and knowledge. Only compatible new truth can commit. NPC speech may lie; never repair conflicting truth by retroactively inventing deception." } }),
      }) } : {}),
    }),
    summary: text,
  });
  // Flattened into the proposals union below rather than nested: the dialect
  // requires every `anyOf` branch to declare a literal type, so an `anyOf`
  // cannot itself be a branch.
  const materializeObjectVariants = [
      // A scene feature everyone present can see, or one only the room's
      // observers can: either way there is no separate visibility fact.
      materializeVariant("sceneFeature", refText,
        ["visibility:public", "visibility:scene-observers"], noneText),
      materializeVariant("sceneFeature", refText, ["visibility:narrative-audience"], noneText),
      // A scene feature that stays hidden until evidence exists. SPEC 0001
      // section 7 is the reason this variant exists: an open blank made
      // relevant must be frozen before it is revealed, and the fact that
      // gates the reveal is named here rather than invented later.
      materializeVariant("sceneFeature", refText,
        ["visibility:hidden-until-evidence"], refText),
      // A world fact belongs to no scene, and scene-observers is meaningless
      // for it, so that policy is simply not offered on these two variants.
      materializeVariant("worldFact", noneText, ["visibility:public"], noneText),
      materializeVariant("worldFact", noneText,
        ["visibility:hidden-until-evidence"], noneText),
      materializeVariant("location", refText, ["visibility:scene-observers"], noneText),
      materializeVariant("passage", refText, ["visibility:scene-observers"], noneText),
      materializeVariant("passage", refText, ["visibility:hidden-until-evidence"], refText),
  ];
  const narrativeDetail = object({
    kind: { type: "string", enum: ["commitNarrativeDetail"] },
    basisRefs: { ...basisArray(basisChoices?.viewerRefs), description: "Actual audience-visible refs from viewerEvidenceRefs only. Use the visible scene or other published evidence. The server adds profile/open-blank authorization separately; never copy authority-only authorization refs into this public narrative basis." },
    consumes: { type: "array", items: { anyOf: references }, description: "No prospective consumers: use [] for a newly narrated detail." },
    produces: produced("commitNarrativeDetail"),
    outcomeBinding: { type: "string", enum: ["always"] },
    sceneRef: refText, label: text,
    description: { ...text, description: "Exact non-causal environmental description to publish and durably retain. Respect all frozen anchors, authority and prior commitments. Do not insert action results, hidden causes, threats, resources or player decisions. Existing or player-addressed details must instead use their original commitment and materialize before adjudication." },
    audience: { type: "string", enum: ["sceneObservers", "actorOnly"] },
  });
  const worldInteraction = object({
    kind: { type: "string", enum: ["worldInteraction"] },
    basisRefs,
    consumes: { type: "array", items: { anyOf: references } },
    produces: produced("worldInteraction"),
    outcomeBinding: outcome,
    sceneRef: refText,
    targetRefs: { type: "array", items: subjectRef, description: "Nonempty set of actual physical interaction targets; must include every directTargetRef. Use observe for independent perception or reasoning. Include the acting character only when their own body is a real target." },
    directTargetRefs: { type: "array", items: subjectRef, description: "Nonempty set of intentionally manipulated targets, selected from the listed frozen world objects or same-bundle prospective objects. Include each in targetRefs. Use observe.focusRefs for an inquiry that only acquires information." },
    instrumentRefs: { ...refArray, description: "Actual tools used in the method, or [] for an unaided interaction. Do not substitute tools for the manipulated direct targets." },
    // `none` when the interaction is unarmed or resolved by a bare ability
    // check; a frozen Ability ref when an attack or an ability-backed action
    // draws that Ability's costs. Rules binds the frozen check parameters and
    // costs to that Ability's authority.
    abilityRef: { ...nullableRef, description: "The exact frozen Ability used by this interaction. For checkKind=attack this must be an exact frozen Ability owned by the actor; checkKind=abilityCheck requires none. For an interaction without an Ability, use exactly {kind:'none'}, never an empty string." },
    intent: text,
    method: text,
    branches: object({
      success: branch,
      failure: { description: "directSuccess requires exactly {kind:'none'}; a shared check requires a complete failure branch, even when its effects are empty.", anyOf: [branch, noneBranch] },
    }),
  });
  // An in-world refusal: the world declining an action is a first-class
  // mechanical outcome, not an error. Everything below the wire already
  // supports it -- the domain validator (`isTerminalProposal`), the lowering
  // (`lowerTerminal`) and the Rules feasibility seam -- so this only unpins
  // the transport.
  //
  /**
   * All three attempt-cost kinds, as closed variants rather than one shape
   * with optional fields.
   *
   * A refusal that costs nothing is the cheap answer, and the wire used to
   * make it the only answer: `item` was the sole kind offered, so a KP that
   * wanted to charge the ten minutes the attempt burned had no way to say so.
   * Rules now has a transition for each kind, and each variant lists exactly
   * the fields its kind uses, so an item cost can never arrive carrying a
   * duration and a time cost can never arrive carrying an entry.
   */
  const attemptCostVariants = [
    object({
      kind: { type: "string", enum: ["item"] },
      entryRef: refText,
      quantity: { type: "integer", minimum: 0 },
      charges: { type: "integer", minimum: 0 },
      durability: { type: "integer", minimum: 0 },
    }),
    object({
      kind: { type: "string", enum: ["fictionTime"] },
      durationMicros: { type: "string", pattern: "^[1-9][0-9]*$" },
    }),
    object({
      kind: { type: "string", enum: ["resource"] },
      resourceId: refText,
      amount: { type: "integer", minimum: 1 },
    }),
  ];
  const attemptCost = { anyOf: attemptCostVariants };
  const prerequisite = object({
    kind: {
      type: "string",
      enum: ["tool", "knowledge", "position", "permission", "condition"],
    },
    ref: nullableRef,
    description: text,
  });
  const nextAction = object({ description: text, basisRefs: existingBasisRefs });
  const inWorldRefusalTerminal = object({
    kind: { type: "string", enum: ["inWorldRefusal"] },
    intent: text,
    method: text,
    ruling: object({
      kind: { type: "string", enum: ["missingPrerequisite", "worldLawViolation"] },
      publicBasis: text,
      prerequisites: { type: "array", items: prerequisite },
      nextActions: { type: "array", items: nextAction },
      attemptCosts: { type: "array", items: attemptCost },
    }),
  });
  const knowledgeReviewTerminal = object({
    kind: { type: "string", enum: ["knowledgeReview"] },
    inquiry: text,
    scope: { type: "string", enum: ["allKnown", "relevantKnown"] },
    knowledgeRefs: { type: "array", items: refText, description: "Existing raw knowledgeRef values from the actor held-knowledge catalog. allKnown requires []: the server selects all records. relevantKnown selects matching records, or [] when none are relevant after reading the complete catalog." },
  });
  const passTimeTerminal = object({
    kind: { type: "string", enum: ["passTime"] },
    durationMicros: { type: "string", pattern: "^[1-9][0-9]*$",
      description: "Explicit positive duration in microseconds for passive waiting or watching. This starts an Activity and advances actual time through due events. No future sensory evidence, check, resource effect, movement, crafting or rest result may be included; they need their own executable action. The server supplies the actor, original intent, Activity identity and all timing boundaries." },
  });
  const noneTerminal = object({ kind: { type: "string", enum: ["none"] } });

  const authored = authoredProposalVariants({
    basisRefs, consumes: { type: "array", items: { anyOf: references } },
    outcomeBinding: outcome,
  }, produced, itemEntryRefs);
  const formation = formationToolSchema(NPC_ACTOR_PLAN_FORMATION_SOURCE_SCHEMA).properties as Record<string, Record<string, unknown>>;
  const formActorPlan = object({ kind: { type: "string", enum: ["formActorPlan"] }, basisRefs,
    consumes: { type: "array", items: { anyOf: references } }, produces: produced("formActorPlan"), outcomeBinding: outcome,
    ...formation,
    factionRef: { anyOf: [formation.npcRef, noneReference], description: "Existing authorized faction identity, or exactly {kind:'none'}. The server assembles its frozen resource closure." },
    premiseRefs: { ...formation.premiseRefs, description: `${formation.premiseRefs.description} Exact refs from this NPC's frozen self, identity, held Knowledge or relationship/promise/debt records. Never another holder, prospective source, same-bundle new conversation or future trigger.` },
    resourceRefs: { ...formation.resourceRefs, description: `${formation.resourceRefs.description} Actual existing personal resources relied on, or []. Formation does not spend resources. A selected faction's exact authorized resource closure is assembled by the server.` },
    durationMicros: { ...formation.durationMicros, description: `${formation.durationMicros.description} Positive exact microseconds until this timer plan becomes due; no current fictional time passes during formation.` },
    traceDescription: { ...formation.traceDescription, description: `${formation.traceDescription.description} The perceptible scene trace left only if the future step actually executes; this text is private at formation.` },
    alternateTargetRef: { ...formation.alternateTargetRef, description: `${formation.alternateTargetRef.description} The explicitly chosen existing known alternative target in the NPC's current scene; never a server-selected fallback.` },
  });
  const allVariants = [...materializeObjectVariants, worldInteraction, observe, social, formActorPlan, narrativeDetail, ...authored];
  const abilityTerminal = object({ kind: { type: "string", enum: ["abilityOperation"] },
    operation: { ...formationToolSchema(abilityOperationSourceSchema(creatureRefs)),
      description: "Choose an owned registered Ability and its exact target/mode, or this actor's frozen casting Activity. Use the owned-ability-catalog and current actor resources. No DC, duration, effect, dice, slot override or additional cost fields. Missing choices cannot be inferred or added by narrow repair." } });
  const nativeVariants = capabilities.flatMap(id => {
    const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id)!;
    return "surface" in capability && capability.surface === "native" && capability.proposalKind === "abilityOperation" ? [abilityTerminal] : [];
  });
  const selectedVariants = capabilities.flatMap(id => {
    const capability = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === id)!;
    if ("surface" in capability && capability.surface === "native") return [];
    const selected = allVariants.filter(raw => {
      const variant = raw as { properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }> };
      return variant.properties.kind.enum?.includes(capability.proposalKind)
        && (!("definitionKind" in capability)
          || variant.properties.source.properties?.kind.enum?.includes(capability.definitionKind));
    });
    if (!selected.length) throw new TypeError("PROPOSAL_SCHEMA_CAPABILITY_DEFINITION_MISSING");
    return selected;
  });

  // SPEC 0013 §7.1: an ordinary act's fictional duration is frozen by the KP
  // before its result and verified by Rules. One value for the whole action;
  // its steps are facets of the same act, not a sequence.
  // The strict subset has no maxLength; the validator bounds the digits.
  const actionDuration = { type: "string", pattern: "^(0|[1-9][0-9]*)$",
    description: "Fictional time this whole action takes, in exact microseconds as a string. Positive whenever the character performs an act (talking, looking, handling, operating); exactly \"0\" only when the bundle merely authors world content. This is the act itself, not any waiting afterwards -- waiting is passTime. Anchors: a one-line reply 5-15 s, a back-and-forth conversation 1-5 min, a glance 3-10 s, examining one object about 1 min, searching a room about 10 min, handling an item 6 s. When unsure, shorter. The server advances this actor's timeline before the results and shows it to scene observers." };
  const sharedAdjudication = {
      description: "The one shared ruling for all proposals. Required as directSuccess or check when mode=adjudication, including bundles containing only authoring or inventory operations. directSuccess requires every outcomeBinding=always and every observe/social/worldInteraction failure={kind:'none'}. check requires exactly one observe, social or worldInteraction with outcomeBinding=always and complete success/failure branches; additional observe/social/worldInteraction consequences have failure={kind:'none'} and run according to their outcomeBinding without another check.",
      anyOf: [
        noneTerminal,
        object({
          kind: { type: "string", enum: ["directSuccess"] },
          risk: text,
          successOutcome: text,
          durationMicros: actionDuration,
        }),
        object({
          kind: { type: "string", enum: ["check"] },
          // Both check kinds are offered, and each is paired with the
          // ability reference the entry must carry: an `attack` needs a
          // non-null abilityRef and an `abilityCheck` needs none.
          //
          // That pairing is deliberately left to the domain rather than
          // encoded as a union. It spans two objects -- the Bundle's one
          // shared adjudication and each entry's abilityRef -- and a union can
          // only bind fields inside a single object. This is not the shape
          // that made `resolution: "direct"` unsatisfiable on the v3 Forms:
          // there one value had no legal draft at all, whereas here both
          // values are reachable and a mismatch is a named, actionable
          // rejection (`world-interaction:attack-ability-required` /
          // `world-interaction:ability-attack-required`).
          checkKind: { type: "string", enum: ["abilityCheck", "attack"], description: "attack requires the interaction to reference an exact frozen Ability owned by the actor; abilityCheck requires its abilityRef={kind:'none'}." },
          ability: {
            type: "string",
            enum: ["str", "dex", "con", "int", "wis", "cha"],
          },
          skill: { ...nullableRef, description: "The skill used for this check, if any. Use exactly {kind:'none'} for a check without a skill; never an empty string." },
          dc: { type: "integer", minimum: 1, maximum: 40 },
          mode: {
            type: "string",
            enum: ["normal", "advantage", "disadvantage"],
          },
          risk: text,
          successOutcome: text,
          failureOutcome: text,
          durationMicros: actionDuration,
        }),
      ],
    };
  const branchProposals = { type: "array", items: { anyOf: selectedVariants } };
  const proposalsReference = { $ref: "#/$def/proposals" };
  const clarificationTerminal = object({
    kind: { type: "string", enum: ["clarification"] }, intent: text, method: text,
    question: { ...text, description: "Ask only about a material ambiguity; use information the actor may know." },
    choices: { type: "array", description: "Provide 2–6 choices, at least one executable; all choices together have at most 16 proposals.", items: object({
      choiceId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$" }, label: text,
      publicRisk: { ...text, description: "Visible consequences of this option, without hidden facts or private plan details." },
      basisRefs: existingBasisRefs,
      continuation: { description: "Complete nonrecursive plan frozen now. Answering selects this exact plan; no new KP proposal.", anyOf: [
        ...nativeVariants.map(variant => object({ ...variant.properties, basisRefs: { type: "array", items: refText, description: "Server-derived; must be empty." } })),
        object({ kind: { type: "string", enum: ["adjudication"] }, basisRefs: existingBasisRefs,
          adjudication: { ...sharedAdjudication, anyOf: sharedAdjudication.anyOf.slice(1) }, proposals: proposalsReference }),
        object({ ...inWorldRefusalTerminal.properties, basisRefs: existingBasisRefs }),
        object({ kind: { type: "string", enum: ["cancel"] } }),
      ] },
    }) },
  });

  return { ...object({
    // A bundle is either an adjudication or a terminal. The unused half
    // carries the `none` sentinel, which `decodeVNextStrictToolBundle`
    // resolves to null before the domain validator sees it; the validator's
    // own cross-field rule then enforces that exactly one half is present.
    mode: { type: "string", enum: ["adjudication", "terminal"], description: "adjudication requires a full shared adjudication and exactly {kind:'none'} for terminal. terminal requires adjudication={kind:'none'} and no proposals." },
    basisRefs: { ...existingBasisRefs, description: "For terminal knowledgeReview or passTime this must be []. knowledgeReview selects held records only in terminal.knowledgeRefs; passTime uses the server-bound actor and timeline. For other bundles, use exact supporting references from RequiredContext." },
    adjudication: sharedAdjudication,
    terminal: { description: "When mode=adjudication this is exactly {kind:'none'} with no intent, method, ruling, or other fields.", anyOf: [noneTerminal, inWorldRefusalTerminal, knowledgeReviewTerminal, passTimeTerminal, clarificationTerminal, ...nativeVariants] },
    proposals: proposalsReference,
  }), $def: { proposals: branchProposals } };
}

/** DeepSeek's existing strict subset omits array/string size keywords. Keep
 * their exact values visible while the shared Rules source validator enforces
 * them. This changes transport presentation only, never the accepting rules. */
function formationToolSchema(source: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { minLength, maxLength, minItems, maxItems, uniqueItems, ...schema } = source;
  const limits = Object.fromEntries(Object.entries({ minLength, maxLength, minItems, maxItems, uniqueItems })
    .filter(([, value]) => value !== undefined));
  return { ...schema,
    ...(Object.keys(limits).length ? { description: [schema.description, `Required limits: ${JSON.stringify(limits)}.`].filter(Boolean).join(" ") } : {}),
    ...(isRecord(schema.properties) ? { properties: Object.fromEntries(Object.entries(schema.properties)
      .map(([key, value]) => [key, formationToolSchema(value as Record<string, unknown>)])) } : {}),
    ...(Array.isArray(schema.anyOf) ? { anyOf: schema.anyOf.map(value => formationToolSchema(value as Record<string, unknown>)) } : {}),
    ...(isRecord(schema.items) ? { items: formationToolSchema(schema.items) } : {}),
  };
}

/** Internal consumers explicitly encode the current model filling interface. */
export function encodeVNextStrictToolBundle(value: unknown): unknown {
  return encodeProposalFilling(value, VNEXT_PROPOSAL_DOMAIN_DIAGNOSTIC_SCHEMA);
}

/** The same domain validator accepts the decoded complete proposal. */
export function decodeVNextStrictToolBundle(value: unknown): unknown {
  return decodeVNextSentinels(decodeProposalFilling(value, VNEXT_PROPOSAL_DOMAIN_DIAGNOSTIC_SCHEMA));
}

/** Convert strict-tool `none` sentinels to domain nulls. */
function decodeVNextSentinels(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeVNextSentinels);
  const record = value as Record<string, unknown>;
  if (hasExactKeys(record, ["kind"]) && record.kind === "none") return null;
  if (hasExactKeys(record, ["ability", "checkKind", "dc", "mode", "skill"])
    && record.checkKind === "none"
    && record.ability === "none"
    && record.skill === "none"
    && record.dc === 0
    && record.mode === "normal") return null;
  const decoded = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    // Native operation fields have no nullable values. Their target {kind:
    // "none"} is an explicit untargeted operation, not the null wire sentinel.
    decoded[key] = record.kind === "abilityOperation" && key === "operation"
      ? structuredClone(child) : decodeVNextSentinels(child);
  }
  for (const key of [
    "abilityRef", "skill", "subjectRef", "sourceRef", "targetRef", "actionHint", "ref",
    "sceneRef", "visibilityFactId",
  ]) {
    if (decoded[key] === "none") decoded[key] = null;
  }
  if (record.kind === "materializeObject" && isRecord(decoded.definition)) {
    for (const key of ["observableState", "affordances"]) {
      if (decoded.definition[key] === "none") decoded.definition[key] = null;
    }
  }
  return decoded;
}

/** Advertise the canonical geometry's basic feature shape; the existing
 * tactical geometry validator remains the accepting authority. */
function dynamicLocationGeometrySchema(): Record<string, unknown> {
  const string = { type: "string" }, boolean = { type: "boolean" };
  const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false,
    properties, required: Object.keys(properties) });
  const enumeration = (values: string[]) => ({ type: "string", enum: values });
  const point = object({ x: string, y: string });
  return object({ schema: enumeration(["zhuwei.tactical-geometry/v1"]), unit: enumeration(["inch"]),
    boundary: object({ kind: enumeration(["polygon"]), points: { type: "array", items: point } }),
    spawnPoints: { type: "array", items: object({ x: string, y: string, elevation: string }) },
    obstacles: { type: "array", items: object({ featureId: string,
      kind: enumeration(["barrier", "terrain", "interactable", "destructible", "portal"]), label: string, state: string,
      polygon: { type: "array", items: point }, elevation: string, height: string, opaque: boolean, impassable: boolean,
      cover: enumeration(["none", "half", "threeQuarters", "full"]), propagation: enumeration(["passes", "blocks"]),
      visibilityPolicyId: enumeration(["visibility:public", "visibility:scene-observers", "visibility:hidden-until-evidence"]) }) },
    clearanceZones: { type: "array", items: string },
  });
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
