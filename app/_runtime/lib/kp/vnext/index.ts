export {
  buildRequiredContext,
  VNEXT_REQUIRED_CONTEXT_SCHEMA,
  type AbsenceSelectorBinding,
  type AmbiguityCandidate,
  type AmbiguousContextEntry,
  type FrozenPlayerIntent,
  type KnownAbsentContextEntry,
  type KnownContextEntry,
  type OpenBlankContextEntry,
  type ProfileBinding,
  type ReadSetEntry,
  type RequiredContextBinding,
  type RequiredContextBindingInput,
  type RequiredContextBuildResult,
  type RequiredContextEntry,
  type RequiredContextInput,
  type RequiredContextReferenceDirectory,
  type UnavailableContextEntry,
  type VNextRequiredContext,
} from "./required-context";

export type { JsonRecord, JsonValue } from "./canonical-json";

export {
  CONTEXT_WORK_DIMENSIONS,
  contextWorkBudgetProfile,
  createContextWorkBudget,
  VNEXT_CONTEXT_WORK_BUDGET,
  type ContextWorkBudget,
  type ContextWorkBudgetProfile,
  type ContextWorkDimension,
  type ContextWorkLimits,
  type ContextWorkReceipt,
} from "./context/work-budget";

export {
  discoverCandidates,
  type CandidateDiscoveryInput,
  type CandidateDiscoveryResult,
  type CandidateMatchKind,
  type DiscoveredCandidate,
  type EpistemicSubject,
} from "./context/candidate-discovery";

export {
  nodeDescriptor,
  profileIndexesDescriptor,
  retrievalProfile,
  tokenize,
  VNEXT_RETRIEVAL_PROFILE,
  type ExtractedTerm,
  type ExtractorTermKind,
  type FieldExtractor,
  type RecordDescriptor,
  type RetrievalProfile,
  type RetrievalPurpose,
  type TokenizerProfile,
} from "./context/extractors";

export {
  closeObligations,
  CONTEXT_OBLIGATIONS,
  type ClosedReference,
  type ContextObligation,
  type DependencyResolver,
  type ObligationClosureInput,
  type ObligationClosureResult,
  type ObligationSeed,
} from "./context/obligation-closure";

export {
  buildReferenceIndex,
  type AuthorityRefKind,
  type ReferenceIndex,
  type ReferenceIndexResult,
  type ReferenceNode,
  type TypedRelationEdge,
} from "./context/reference-index";

export {
  requiredContextAuthorityRefs,
  requiredContextReadRefs,
  requiredContextViewerRefs,
  validateVNextTransactionReadSet,
  type VNextContextReplayHead,
  type VNextReadSetValidation,
} from "./required-context-runtime";

export {
  assembleProposalInvocation,
  consumeRepair,
  INITIAL_REPAIR_LEDGER,
  proposalInvocationReceipt,
  VNEXT_PROPOSAL_REQUEST_SCHEMA,
  type InvocationKind,
  type InvocationOrdinal,
  type ProposalInvocationInput,
  type ProposalInvocationReceipt,
  type ProposalInvocationResult,
  type RepairLedger,
} from "./invocation/assemble";

export {
  allowedInputTokens,
  conservativeInputTokens,
  evaluateInputBudget,
  providerBudgetProfile,
  VNEXT_PROPOSAL_BUDGET,
  type BudgetReceipt,
  type ProviderBudgetProfile,
  type TokenCounterRef,
} from "./invocation/budget";

export {
  freezeAdjudicationContext,
  VNEXT_CONTEXT_UNITS_TARGET,
  type AdjudicationContextBlockReason,
  type AdjudicationContextInput,
  type AdjudicationContextResult,
} from "./context";

export {
  resolveAvailability,
  type AbsenceSelector,
  type AvailabilityInput,
  type AvailabilityOutcome,
  type AvailabilityRequirement,
  type OpenBlankAuthorization,
} from "./context/availability";

export {
  conditionSignatureEqual,
  normalizePrecedentConditionSignature,
  resolvePrecedentApplicability,
  VNEXT_PRECEDENT_CONDITION_SCHEMA,
  type PrecedentApplicabilityInput,
  type PrecedentApplicabilityQuery,
  type PrecedentApplicabilityResult,
  type PrecedentConditionScope,
  type PrecedentConditionSignature,
  type PrecedentScopeKind,
  type VNextPrecedentRecord,
} from "./context/precedent-applicability";

export {
  resolveTargetAmbiguity,
  type AmbiguityInput,
  type AmbiguityOutcome,
  type AmbiguityResolution,
  type EquivalentSelection,
} from "./context/ambiguity";

export {
  type CitationClass,
  type ContextCoverage,
  type ContextDomain,
  type ObligationCoverage,
} from "./context/coverage";

export {
  lowerVNextCoarseFormProposal,
  validateVNextCoarseFormProposal,
  VNEXT_KP_PROPOSAL_SCHEMA,
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
  type VNextCoarseFormProposal,
  type VNextProposalLoweringResult,
  type VNextProposalValidationResult,
  type VNextSemanticRevisionProposal,
  type VNextWorldInteractionBranchProposal,
  type VNextWorldInteractionProposal,
  type VNextWorldSemanticEffect,
  type WorldInteractionAdjudication,
} from "./proposals";

export { VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE } from "./room-bridge";

export {
  lowerVNextProposalBundle,
  validateVNextProposalBundle,
  VNEXT_BUNDLE_FORM_IDS,
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT_PROPOSAL_BUNDLE_INTEGRATION_SEAMS,
  VNEXT_PROPOSAL_BUNDLE_SCHEMA,
  type VNextAtomicRulesStep,
  type VNextAttemptCost,
  type VNextBundleFormId,
  type VNextBundleFormProposal,
  type VNextBundleProducedReference,
  type VNextBundleReference,
  type VNextCheckParameters,
  type VNextCheckRuling,
  type VNextDirectSuccessRuling,
  type VNextFeasibilityRuling,
  type VNextHighRiskConfirmation,
  type VNextHighRiskRuling,
  type VNextInWorldRefusalProposal,
  type VNextProposalBundle,
  type VNextProposalBundleCommand,
  type VNextProposalBundleEntry,
  type VNextProposalBundleLoweringInput,
  type VNextProposalBundleLoweringResult,
  type VNextProposalBundleValidationResult,
  type VNextRefusalRuling,
} from "./proposal-bundle";
