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
  "acquireArtifact",
  "useArtifact",
  "transferArtifact",
  "advanceFactionPlan",
  "changeKnowledge",
  "changeParty",
  "advanceCampaignLifecycle",
] as const;

export const ACTION_PLAN_COST_KINDS = [
  "consumeArtifact",
  "artifactDurabilityRisk",
  "consumeResource",
  "spendAction",
  "spendBonusAction",
  "spendReaction",
  "spendMovement",
  "spendSpellSlot",
  "spendHitDie",
  "fictionTime",
] as const;

export const ACTION_PLAN_EFFECT_KINDS = [
  "moveArtifact",
  "sensoryEvidence",
  "acquireEvidence",
  "alertNpc",
  "changeResource",
  "changeHitPoints",
  "applyCondition",
  "removeCondition",
  "moveEntity",
  "startActivity",
  "interruptActivity",
  "advanceFictionTime",
  "startEncounter",
  "endEncounter",
  "openPendingInput",
  "acquireKnowledge",
  "shareKnowledge",
  "changeParty",
  "advanceCampaign",
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

export type ModelInvocationReceipt = {
  provider: "cloudflare-workers-ai";
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

export type ActionPlanCost = {
  kind: ActionPlanCostKind;
  artifactRef?: string;
  resourceRef?: string;
  amount?: number;
  distanceFeet?: number;
  slotLevel?: number;
  count?: number;
  duration?: FictionDuration;
};

export type ActionPlanEffect = {
  kind: ActionPlanEffectKind;
  artifactRef?: string;
  to?: string;
  observerRef?: string;
  evidence?: string;
  evidenceRef?: string;
  npcId?: string;
  entityRef?: string;
  targetRef?: string;
  resourceRef?: string;
  amount?: number;
  conditionRef?: string;
  sceneRef?: string;
  activityRef?: string;
  duration?: FictionDuration;
  encounterRef?: string;
  knowledgeRef?: string;
  recipientRefs?: string[];
  partyRef?: string;
  campaignRef?: string;
  chapterRef?: string;
  relationshipRef?: string;
  commitmentRef?: string;
  debtRef?: string;
  status?: string;
  value?: JsonPrimitive;
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

export type ResolveNoncombatCheckActionPlan = SemanticActionPlanFields & {
  operation: "resolveNoncombatCheck";
};

export type ReservedSemanticActionPlan = SemanticActionPlanFields & {
  operation: Exclude<ActionPlanOperation, "resolveNoncombatCheck">;
};

export type SemanticActionPlan =
  | ResolveNoncombatCheckActionPlan
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
  mechanicalProposal: SemanticActionPlan | null;
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

export type KpProposalRequest = {
  preparedActionId: string;
  rootActionId: string;
  input: unknown;
  projection: unknown;
  attempt: number;
  diagnostics?: unknown;
};

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

export type CurrentNarration = CurrentNarrationDraft & {
  audience: {
    viewerKey: string;
    projectionHash: string;
  };
  modelInvocationReceipt: ModelInvocationReceipt;
};

export type WorkersAiRunOptions = { signal?: AbortSignal };

export type AuthoritativeKpProfile = Readonly<{
  provider: "cloudflare-workers-ai";
  modelId: string;
  modelRevision: string;
  modelProfileVersion: string;
  promptPolicyVersion: string;
  proposalSchemaVersion: string;
  actionPlanSchemaVersion: string;
  narrationSchemaVersion: string;
}>;

export type WorkersAiBinding = {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: WorkersAiRunOptions,
  ): Promise<unknown>;
};

export type AuthoritativeKpAdapterOptions = {
  ai: WorkersAiBinding;
  profile?: AuthoritativeKpProfile;
  now?: () => number;
  invocationTimeoutMs?: number;
  onInvocationReceipt?: (receipt: ModelInvocationReceipt) => void;
};

export type AuthoritativeKpAdapter = {
  propose(request: KpProposalRequest): Promise<AuthoritativeKpProposal>;
  narrate(request: KpNarrationRequest): Promise<CurrentNarration>;
};
