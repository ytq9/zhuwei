import { GEAR_SLOTS, type GearSlot } from "../dnd/gear";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const ACTION_PLAN_OPERATIONS = [
  "resolveNoncombatCheck",
  "resolveNoncombatContest",
  "resolveNoncombatSave",
  "resolveDirectConsequences",
  "commitMeaningfulFailure",
  "retryFailedAction",
  "rejectInfeasibleAction",
  "startActivity",
  "interruptActivity",
  "completeActivity",
  "startCombat",
  "invokeCombatAction",
  "moveCombatant",
  "endCombatTurn",
  "proposeEncounterConclusion",
  "resolveReaction",
  "resolveRest",
  "changeResource",
  "useItem",
  "transferItem",
  "changeNpcGear",
  "acquireArtifact",
  "useArtifact",
  "transferArtifact",
  "advanceFactionPlan",
  "changeKnowledge",
  "changeParty",
  "advanceCampaignLifecycle",
] as const;

export const ACTION_PLAN_GEAR_ACTIONS = ["wear", "stow"] as const;
export const ACTION_PLAN_GEAR_SLOTS: readonly GearSlot[] = Object.freeze(
  GEAR_SLOTS.map(({ id }) => id),
);

export const ACTION_PLAN_COST_KINDS = [
  "consumeResource",
  "consumeArtifact",
  "fictionTime",
] as const;

export const ACTION_PLAN_EFFECT_KINDS = [
  "acquireEvidence",
  "acquireKnowledge",
  "changeResource",
  "changeHitPoints",
  "alertNpc",
  "moveEntity",
  "advanceFictionTime",
  "updateRelationship",
  "recordCommitment",
  "recordDebt",
] as const;

export const ACTION_PLAN_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const ACTION_PLAN_CHECK_MODES = ["normal", "advantage", "disadvantage"] as const;
export const CAMPAIGN_LIFECYCLE_ACTIONS = [
  "grantMilestone",
  "awardExperience",
  "concludeChapter",
  "startChapter",
  "transitionChapter",
  "retireCharacter",
  "establishInheritanceSource",
  "transferInheritance",
  "raiseEndingCandidate",
  "concludeStory",
  "recordEpilogueChoice",
  "startSequel",
] as const;

export type ActionPlanOperation = typeof ACTION_PLAN_OPERATIONS[number];
export type ActionPlanCostKind = typeof ACTION_PLAN_COST_KINDS[number];
export type ActionPlanEffectKind = typeof ACTION_PLAN_EFFECT_KINDS[number];
export type ActionPlanAbility = typeof ACTION_PLAN_ABILITIES[number];
export type ActionPlanCheckMode = typeof ACTION_PLAN_CHECK_MODES[number];
export type CampaignLifecycleAction = typeof CAMPAIGN_LIFECYCLE_ACTIONS[number];

export type InheritanceAuthorizationProposal = {
  authorizationId: string;
  kind: "artifact" | "knowledge" | "relationship" | "debt" | "promise";
  sourceRef: string;
  targetRef: string;
  scope:
    | "transferPossession"
    | "acquireExactKnowledge"
    | "establishDerivedRelationship"
    | "assumeDebtObligation"
    | "assumePromiseObligation";
};

export type ModelInvocationResult =
  | "success"
  | "modelTransient"
  | "modelPermanent"
  | "quotaExhausted";

export const MODEL_INVOCATION_FAILURE_STAGES = [
  "structuredOutput",
  "proposalSchema",
  "proposalReference",
  "contextPack",
  "narrationSchema",
  "narrationGrounding",
  "projectionBinding",
] as const;

export type ModelInvocationFailureStage =
  typeof MODEL_INVOCATION_FAILURE_STAGES[number];

export type ModelInvocationReceipt = {
  provider: "cloudflare-workers-ai" | "deepseek";
  modelId: string;
  modelRevision: string;
  modelProfileVersion: string;
  promptPolicyVersion: string;
  schemaVersion: string;
  task: "proposal" | "narration";
  rootActionId: string;
  attempt: number;
  startedAt: number;
  endedAt: number;
  result: ModelInvocationResult;
  failureStage?: ModelInvocationFailureStage;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  responseHash?: string;
};

export type FictionDuration = {
  unit: "round" | "second" | "minute" | "hour" | "day";
  value: number;
};

export type ProposalRisk = {
  warning: string;
  successConsequences: string[];
  failureConsequences: string[];
  retryGate: Array<
    | "methodChanged"
    | "factsChanged"
    | "costAccepted"
    | "positionChanged"
    | "materialAssistance"
    | "situationAdvanced"
  >;
};

export type ProposalPendingInput = {
  kind: "clarification" | "playerChoice";
  prompt: string;
  choices: Array<{ id: string; label: string; consequence: string }>;
};

export type AdjudicationPrecedentScope = {
  kind: "scene" | "campaign" | "module" | "room";
  ref: string;
};

export type AdjudicationPrecedentProposal =
  | {
      kind: "record";
      publicRuleBasis: string[];
      applicabilityScope: AdjudicationPrecedentScope;
    }
  | {
      kind: "supersede";
      supersededPrecedentId: string;
      materialDifferences: string[];
      publicRuleBasis: string[];
      applicabilityScope: AdjudicationPrecedentScope;
    };

export type DynamicMaterialization = {
  kind: "fact" | "location" | "passage" | "npc" | "enemy" | "item" | "faction" | "hazard" | "opportunity" | "ability";
  factRef: string;
  causalBasisRefs: string[];
  visibilityPolicyRef: string;
  definition: JsonObject;
};

export type ActionPlanCost =
  | { kind: "consumeArtifact"; artifactRef: string; count?: number }
  | { kind: "consumeResource"; resourceRef: string; amount: number }
  | { kind: "fictionTime"; duration: FictionDuration };

export type ActionPlanEffect =
  | { kind: "acquireEvidence"; evidenceRef: string; definitionRef?: string; evidence?: string }
  | {
      kind: "acquireKnowledge";
      knowledgeRef: string;
      definitionRef?: string;
      value?: Exclude<JsonPrimitive, null>;
    }
  | { kind: "changeResource"; resourceRef: string; amount: number; targetRef?: string }
  | { kind: "changeHitPoints"; amount: number; targetRef?: string }
  | { kind: "alertNpc"; npcId: string; status?: string }
  | { kind: "moveEntity"; sceneRef: string; entityRef?: string }
  | { kind: "advanceFictionTime"; duration: FictionDuration }
  | {
      kind: "updateRelationship";
      relationshipRef: string;
      recipientRefs: string[];
      value: string;
      definitionRef?: string;
    }
  | {
      kind: "recordCommitment";
      commitmentRef: string;
      targetRef: string;
      value: string;
      status: string;
    }
  | {
      kind: "recordDebt";
      debtRef: string;
      targetRef: string;
      value: string;
      status: string;
      definitionRef?: string;
    };

export type MeaningfulFailureOption = {
  id: string;
  summary: string;
};

export type ModuleMigrationProposal = {
  fromModuleRef: {
    profileId: string;
    profileHash: string;
  };
  toModuleRef: {
    profileId: string;
    profileHash: string;
  };
  migrationRef: {
    profileId: string;
    profileHash: string;
  };
};

type SemanticActionPlanFields = {
  ability?: ActionPlanAbility;
  skill?: string | null;
  opposedAbility?: ActionPlanAbility;
  opposedSkill?: string | null;
  saveAbility?: ActionPlanAbility;
  dc?: number;
  mode?: ActionPlanCheckMode;
  duration?: FictionDuration;
  frozenCosts?: ActionPlanCost[];
  success?: ActionPlanEffect[];
  failure?: ActionPlanEffect[];
  sourceEntityRef?: string;
  targetEntityRef?: string;
  targetEntityRefs?: string[];
  encounterRef?: string;
  activityRef?: string;
  activityTransitions?: Array<{
    activityId: string;
    disposition: "continue" | "summarize" | "interrupt" | "complete";
  }>;
  moduleMigration?: ModuleMigrationProposal;
  abilityRef?: string;
  reactionRef?: string;
  destinationRef?: string;
  destinationFeet?: number;
  restKind?: "short" | "long";
  hitDiceToSpend?: number;
  arcaneRecoverySlotLevels?: number[];
  resourceRef?: string;
  amount?: number;
  itemRef?: string;
  artifactRef?: string;
  artifactUse?: "retain" | "consume" | "destroy";
  factionRef?: string;
  planRef?: string;
  knowledgeRef?: string;
  mediumFactRef?: string;
  recipientRefs?: string[];
  partyRef?: string;
  partyAction?:
    | "inviteMember"
    | "cancelInvitation"
    | "leave"
    | "transferLeadership"
    | "proposeMove"
    | "moveIndividually";
  pendingInputRef?: string;
  memberRefs?: string[];
  campaignRef?: string;
  chapterRef?: string;
  lifecycleAction?: CampaignLifecycleAction;
  inheritanceSourceKind?:
    | "will"
    | "explicitGift"
    | "recovery"
    | "publicRecord"
    | "organizationGrant"
    | "npcIntroduction"
    | "knowledgePropagation";
  inheritanceSourceFactRef?: string;
  inheritanceAuthorizationRef?: string;
  inheritanceAuthorization?: InheritanceAuthorizationProposal;
  publicClause?: string;
  experienceAmount?: number;
  continueAsNpc?: boolean;
  endingCandidateRef?: string;
  storyRef?: string;
  sequelStoryRef?: string;
  outcome?: string;
  choice?: string;
  precedentRef?: string;
  newOptions?: MeaningfulFailureOption[];
  basisRefs?: string[];
  unresolvedRefs?: string[];
  consequenceRefs?: string[];
};

type FrozenCheckActionPlanFields = {
  ability: ActionPlanAbility;
  skill: string | null;
  dc: number;
  mode: ActionPlanCheckMode;
  duration: FictionDuration;
  frozenCosts: ActionPlanCost[];
  success: ActionPlanEffect[];
  failure: ActionPlanEffect[];
};

export type ResolveDirectConsequencesActionPlan = {
  operation: "resolveDirectConsequences";
  duration: FictionDuration;
  frozenCosts: [];
  success: ActionPlanEffect[];
  failure: [];
};

export type ResolveNoncombatCheckActionPlan = FrozenCheckActionPlanFields & {
  operation: "resolveNoncombatCheck";
};

export type ResolveNoncombatSaveActionPlan = Omit<FrozenCheckActionPlanFields, "ability" | "skill"> & {
  operation: "resolveNoncombatSave";
  saveAbility: ActionPlanAbility;
  targetEntityRef?: string;
};

export type RetryFailedActionPlan =
  | {
      operation: "retryFailedAction";
      precedentRef: string;
    }
  | (FrozenCheckActionPlanFields & {
      operation: "retryFailedAction";
      precedentRef: string;
    });

export type TransferItemActionPlan = {
  operation: "transferItem";
  targetEntityRef: string;
  itemRef: string;
  amount: number;
};

export type ChangeNpcGearActionPlan =
  | {
      operation: "changeNpcGear";
      gearAction: "wear";
      slot: GearSlot;
      itemRef: string;
    }
  | {
      operation: "changeNpcGear";
      gearAction: "stow";
      slot: GearSlot;
    };

export type ReservedSemanticActionPlan = SemanticActionPlanFields & {
  operation: Exclude<
    ActionPlanOperation,
    | "resolveDirectConsequences"
    | "resolveNoncombatCheck"
    | "resolveNoncombatSave"
    | "retryFailedAction"
    | "advanceFactionPlan"
    | "transferItem"
    | "changeNpcGear"
  >;
};

export type NpcReservedSemanticActionPlan = SemanticActionPlanFields & {
  operation: Exclude<
    ActionPlanOperation,
    | "resolveDirectConsequences"
    | "resolveNoncombatCheck"
    | "resolveNoncombatSave"
    | "retryFailedAction"
    | "resolveNoncombatContest"
    | "transferItem"
    | "changeNpcGear"
  >;
};

export type NpcSemanticActionPlan =
  | ResolveDirectConsequencesActionPlan
  | ResolveNoncombatCheckActionPlan
  | Omit<ResolveNoncombatSaveActionPlan, "targetEntityRef">
  | TransferItemActionPlan
  | ChangeNpcGearActionPlan
  | NpcReservedSemanticActionPlan;

export type SemanticActionPlan =
  | ResolveDirectConsequencesActionPlan
  | ResolveNoncombatCheckActionPlan
  | ResolveNoncombatSaveActionPlan
  | RetryFailedActionPlan
  | TransferItemActionPlan
  | ReservedSemanticActionPlan;

export type ActorPlanActivityProposal = {
  activityId: string;
  activityKind: string;
  intendedDurationMicros: string;
};

export type ActorPlanDueProposal = {
  kind: "fictionTime";
  atFictionMicros: string;
};

export type ActorPlanTriggerProposal =
  | { kind: "committedEvent"; eventRef: string }
  | { kind: "knowledgeAcquired"; knowledgeRef: string };

export type ActorPlanTraceProposal = {
  factRef: string;
  description: string;
  visibilityPolicyRef: string;
};

export type ActorPlanAlternateTargetProposal = {
  targetRef: string;
  reason: string;
};

/**
 * One finite-knowledge NPC/Faction plan proposed by KP. Module/chapter pins,
 * actor identity, revision, and lifecycle status are deliberately absent:
 * Rules derives those authority fields from the committed Room state.
 */
export type ActorPlanProposal = {
  factionRef?: string;
  planId: string;
  premiseRefs: string[];
  nextStep: string;
  resourceRefs: string[];
  activity: ActorPlanActivityProposal;
  due: ActorPlanDueProposal | null;
  trigger: ActorPlanTriggerProposal | null;
  trace: ActorPlanTraceProposal;
  alternateTarget: ActorPlanAlternateTargetProposal;
};

export type NpcActionProposal = {
  npcId: string;
  goal: string;
  method: string;
  knowledgeRefs: string[];
  actorPlan?: ActorPlanProposal;
  mechanicalProposal: NpcSemanticActionPlan | null;
};

export type SceneProposal = {
  question: string;
  pressure: string;
  opportunities: string[];
  conclusionCandidate: string | null;
};

export type KpProposalDraft = {
  kind:
    | "directSuccess"
    | "checkRequired"
    | "highRiskFeasible"
    | "missingPrerequisite"
    | "worldLawViolation";
  goal: string;
  method: string;
  publicBasisRefs: string[];
  privateBasisRefs: string[];
  adjudicationPrecedent: AdjudicationPrecedentProposal | null;
  estimatedFictionTime?: FictionDuration;
  risk: ProposalRisk | null;
  pendingInput: ProposalPendingInput | null;
  dynamicMaterializations: DynamicMaterialization[];
  hiddenRealityCandidateSet?: {
    candidateSetId: string;
    candidates: Array<DynamicMaterialization & { candidateId: string; hiddenWeight: number }>;
  } | null;
  npcActions: NpcActionProposal[];
  mechanicalProposal: SemanticActionPlan | null;
  scene: SceneProposal;
};

export type AuthoritativeKpProposal = KpProposalDraft & {
  proposalAttemptId: string;
  modelInvocationReceipt: ModelInvocationReceipt;
};

/** New-room-only private Form envelope. It is server-side data and is never a
 * player/API input surface. Room normalization verifies and lowers it before
 * the existing Rules `step` boundary. */
export type V3AuthoritativeKpProposal = {
  kind: "privateFormProposal";
  formId: string;
  draft: Record<string, unknown>;
  causalActionProgram: unknown;
  loweredCausalProgram: unknown;
  semanticFreezeHash: string;
  repairUsed: boolean;
  proposalAttemptId: string;
  modelInvocationReceipt: ModelInvocationReceipt;
};

export type KpProposalRequest = {
  preparedActionId: string;
  rootActionId: string;
  input: unknown;
  projection: unknown;
  attempt: number;
  diagnostics?: unknown;
  /** Server-local prior envelope for the sole narrow repair. Never accepted
   * from a page or public API. */
  priorProposal?: unknown;
};

/** Server-private decision input for one already-due NPC/Faction ActorPlan.
 * It is deliberately separate from player intent and V3 private Forms. */
export type DueActorPlanDecisionRequest = {
  preparedActionId: string;
  rootActionId: string;
  dueActorPlan: unknown;
  projection: unknown;
  attempt: 1;
};

export type DueActorPlanRevision = {
  reason: string;
  premiseRefs: string[];
  nextStep: string;
  resourceRefs: string[];
  due: ActorPlanDueProposal | null;
  trigger: ActorPlanTriggerProposal | null;
  trace: ActorPlanTraceProposal;
  alternateTarget: ActorPlanAlternateTargetProposal;
};

type DueActorPlanDecisionBase = {
  kind: "actorPlanDecision";
  planId: string;
  proposalAttemptId: string;
  rootActionId: string;
};

/** Exact envelope accepted by RoomDO.commitDueActorPlan. Model receipts stay
 * outside this value because the DO contract is closed. */
export type DueActorPlanDecision = DueActorPlanDecisionBase & (
  | {
      decision: "execute";
      mechanicalProposal: NpcSemanticActionPlan | null;
      targetRef?: string;
    }
  | {
      decision: "revise";
      mechanicalProposal: null;
      revision: DueActorPlanRevision;
    }
  | {
      decision: "defer";
      mechanicalProposal: null;
      reason: string;
      deferUntilFictionMicros: string;
    }
  | {
      decision: "cancel";
      mechanicalProposal: null;
      reason: string;
    }
);

export type KpNarrationRequest = {
  rootActionId: string;
  receipt: unknown;
  projection: unknown;
  attempt?: number;
};

export const NARRATION_AGENCY_SUBJECT_KINDS = [
  "playerCharacter",
  "npc",
  "world",
] as const;

export const NARRATION_AGENCY_CLAIM_KINDS = [
  "committedObservableAction",
  "sensoryConsequence",
  "thought",
  "emotion",
  "dialogue",
  "nextAction",
] as const;

export type NarrationAgencyClaim = {
  subjectKind: (typeof NARRATION_AGENCY_SUBJECT_KINDS)[number];
  subjectRef: string | null;
  claimKind: (typeof NARRATION_AGENCY_CLAIM_KINDS)[number];
  basisRefs: string[];
};

export type CurrentNarrationDraft = {
  body: string;
  tts: string;
  decisionPrompt: string;
  referencedProjectionRefs: string[];
  agencyClaims: NarrationAgencyClaim[];
};

/** SPEC-0015 model output. All publication metadata is derived server-side. */
export type BodyOnlyNarrationDraft = {
  body: string;
};

export type BodyOnlyCurrentNarration = BodyOnlyNarrationDraft & {
  audience: {
    viewerKey: string;
    projectionHash: string;
  };
  modelInvocationReceipt: ModelInvocationReceipt;
};

export type CurrentNarration = CurrentNarrationDraft & {
  audience: {
    viewerKey: string;
    projectionHash: string;
  };
  modelInvocationReceipt: ModelInvocationReceipt;
};

export type AuthoritativeModelRunOptions = { signal?: AbortSignal };

export type AuthoritativeKpProfile = Readonly<{
  provider: ModelInvocationReceipt["provider"];
  modelId: string;
  modelRevision: string;
  modelProfileVersion: string;
  promptPolicyVersion: string;
  proposalSchemaVersion: string;
  actionPlanSchemaVersion: string;
  narrationSchemaVersion: string;
}>;

export type AuthoritativeModelBinding = {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: AuthoritativeModelRunOptions,
  ): Promise<unknown>;
};

export type AuthoritativeKpAdapterOptions = {
  ai: AuthoritativeModelBinding;
  profile?: AuthoritativeKpProfile;
  now?: () => number;
  invocationTimeoutMs?: number;
  onInvocationReceipt?: (receipt: ModelInvocationReceipt) => void;
  /** Optional production seam for D1/static retrieval and Planner. Required
   * context is still rebuilt and checked inside the adapter. */
  prepareV3Context?: (
    request: KpProposalRequest,
    allowedFormIds: readonly string[],
  ) => Promise<{
    contextPack: unknown;
    orderedFormIds?: readonly string[];
    plannerReceipt?: unknown;
    retrievalReceipt?: unknown;
  }>;
};

export type AuthoritativeKpAdapter = {
  propose(request: KpProposalRequest): Promise<AuthoritativeKpProposal | V3AuthoritativeKpProposal>;
  /** Present on V3 production adapters. Optional so historical/test adapters
   * keep their exact generic-proposal behavior. */
  decideDueActorPlan?(request: DueActorPlanDecisionRequest): Promise<DueActorPlanDecision>;
  narrate(request: KpNarrationRequest): Promise<CurrentNarration | BodyOnlyCurrentNarration>;
};
