import type {
  ProfileRef,
  RuntimeProfileManifest,
  RuntimeProfileRejectionCode,
  Sha256Ref,
} from "../profiles/types";
import type { TacticalProjection } from "../tactical-projection";
import type {
  ItemDefinitionV1,
  ItemEntryV1,
  ItemOwnershipDisposition,
  ItemSystemStateV1,
} from "./items";

export type JsonRecord = Record<string, unknown>;

export type RuleDiagnostic = {
  code: string;
  message: string;
  path?: string;
  source: "SPEC 0003" | "SPEC 0004" | "SPEC 0005" | "SPEC 0008" | "SPEC 0010" | "SPEC 0013";
  visibility: "public";
};

export type RulesRejectionCode =
  | RuntimeProfileRejectionCode
  | "archiveIntegrityMismatch"
  | "bonusActionSpellRestriction2014"
  | "causalFrontierConflict"
  | "correctionConflict"
  | "correctionUnauthorized"
  | "definitionComplexityExceeded"
  | "duplicateRootAction"
  | "invalidEventEnvelope"
  | "invalidAbilityDefinition"
  | "invalidGenesis"
  | "invalidInitialization"
  | "invalidReplayInput"
  | "invalidRulesInput"
  | "invalidWorldState"
  | "inheritanceAuthorizationConsumed"
  | "inheritanceProvenanceRequired"
  | "insufficientResource"
  | "missingPrerequisite"
  | "npcKnowledgeInsufficient"
  | "presentationUnavailable"
  | "projectionIntegrity"
  | "privateOrUnknownReference"
  | "roomAdministrationUnauthorized"
  | "spatialCapacityUnavailable"
  | "targetSeatUnavailable"
  | "pendingInputUnresolved"
  | "unchangedRetry"
  | "unsupportedEventSchema"
  | "unsupportedMechanicPrimitive"
  | "unsupportedOperation"
  | "unsupportedRulesBasis"
  | "worldLawViolation"
  | "viewerUnauthorized";

export type RulesRejection = {
  code: RulesRejectionCode;
  message: string;
  diagnostics?: RuleDiagnostic[];
};

export type RejectedRulesResult = {
  kind: "rejected";
  rejection: RulesRejection;
  events: [];
};

export type NeedsKpRulesResult = {
  kind: "needsKp";
  diagnostics: RuleDiagnostic[];
  events: EventEnvelope[];
  state: AuthoritativeWorldState;
  cache: AuthoritativeWorldState;
  stateHash: Sha256Ref;
  scopeProof: ScopeProof;
  mechanicalResult?: JsonRecord;
};

export type SceneRecord = {
  id: string;
  name: string;
};

export type PrincipalRecord = {
  id: string;
  sessionVersion: number;
};

export type SeatRecord = {
  id: string;
  principalId: string;
  status: "active" | "inactive";
};

export type CharacterLoadoutRecord = {
  armorClass: number;
  speedFeet: number;
  equipped: Record<string, string>;
  backpack: Array<{ itemId: string; quantity: number }>;
};

export type SocialInfluenceDegree =
  | "strongFailure"
  | "failure"
  | "limitedSuccess"
  | "fullSuccess"
  | "strongSuccess";

export type SocialClaimSemantics = {
  schema: "zhuwei.social-claim-semantics/v1";
  targetNpcRef: string;
  /** Existing active topic this utterance is trying to de-escalate. This is
   * separate from the new offer/thread created for the current utterance. */
  addressedThreadRef: string | null;
  influenceGoal:
    | "beBelieved"
    | "deemphasize"
    | "cooperate"
    | "disclose"
    | "permit"
    | "deter"
    | "other";
  desiredBehavior: string;
  /** Evidence explicitly offered with this claim. Merely appearing in the KP
   * basis closure does not make a reference evidence for the social check. */
  evidenceRefs: string[];
  assertion: null | {
    subjectRef: string;
    predicate:
      | "isA"
      | "affiliatedWith"
      | "authorizedBy"
      | "possesses"
      | "knowsAbout"
      | "performed"
      | "intends"
      | "relatedTo"
      | "locatedAt";
    polarity: "affirm" | "deny" | "question";
    object: {
      referenceKind: "existing";
      ref: string;
    } | {
      referenceKind: "unresolvedLabel";
      label: string;
    };
  };
  topicFingerprint: Sha256Ref;
};

export type NpcSocialMechanicsRecord = {
  abilityScores: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  proficiencyBonus: number;
  skillModifiers: Record<string, number>;
  initialTrust: number;
  authorityModifier: number;
  stakesSensitivity: number;
  maximumInfluenceDegree: Extract<
    SocialInfluenceDegree,
    "limitedSuccess" | "fullSuccess" | "strongSuccess"
  >;
};

export type SocialNpcResponse = {
  mode: "reaction" | "sourceBacked" | "commitment";
  reactionKind: "acknowledge" | "decline" | "askClarification" | "redirect" | "silence" | null;
  minimumDegree: Extract<
    SocialInfluenceDegree,
    "limitedSuccess" | "fullSuccess" | "strongSuccess"
  >;
  speech: string;
  /** Facts supporting a factual answer, or stable scope refs bounding a
   * self-authored commitment. The response remains a SourceClaim either way. */
  sourceRefs: string[];
};

export type CharacterRecord = {
  id: string;
  kind: "player" | "npc";
  name: string;
  sceneId: string;
  tenureStatus: "active" | "dead" | "retired" | "missing" | "npcTransitioned";
  entityOrdinal: string;
  controllerPrincipalId?: string;
  lastControllerSeatId?: string;
  classId?: string;
  raceId?: string;
  subclassId?: string;
  level?: number;
  experiencePoints?: number;
  hitPoints?: { current: number; maximum: number };
  resources?: Record<string, number>;
  resourceMaximums?: Record<string, number>;
  abilityScores?: Record<string, number>;
  proficiencyBonus?: number;
  proficientSkills?: string[];
  expertiseSkills?: string[];
  proficientSaves?: string[];
  cantripIds?: string[];
  preparedSpellIds?: string[];
  featureIds?: string[];
  loadout?: CharacterLoadoutRecord;
  socialMechanics?: NpcSocialMechanicsRecord;
  lastLongRestCompletedAtMicros?: string;
};

export type CharacterControlRecord = {
  characterId: string;
  seatId: string;
};

export type CanonicalFactRecord = {
  id: string;
  kind: string;
  subjectRefs: string[];
  value: unknown;
  visibilityPolicyId: string;
  source:
    | "moduleAnchor"
    | "dynamicMaterialization"
    | "observedEvent"
    | "mechanicalResolution"
    | "characterAction"
    | "npcOrFactionAction"
    | "correction";
  branchId: string;
  validFromEventSeq: string;
  causalParentIds: string[];
};

export type KnowledgeRecord = {
  characterId: string;
  knowledgeRef: string;
  objectKind: "sensoryEvidence" | "sourceClaim" | "characterInference" | "canonicalFact";
  layer: "hint" | "partial" | "full";
  content: unknown;
  visibility: "private" | "shared" | "publiclyObservable";
  acquiredByEventId: string;
  acquiredAtFictionMicros: string;
  sourceCharacterId: string | null;
  provenanceChain: string[];
};

export type PublicReceipt = {
  receiptId: string;
  rootActionId: string;
  status: "committed" | "awaitingInput" | "awaitingRandomness" | "concluded" | "superseded";
  branchId: string;
  eventRange: {
    fromEventSeq: string;
    toEventSeq: string;
  };
  rulesetVersion: string;
  eventSchemaVersion: string;
  scopeProofHash: Sha256Ref;
};

export type StoredReceipt = PublicReceipt & {
  inputHash: Sha256Ref;
  subjectCharacterIds: string[];
};

export type CorrectionEffect =
  | { kind: "restoreFictionTime"; timelineId: string; beforeMicros: string }
  | { kind: "restoreScene"; sceneId: string; before: SceneRecord | null }
  | { kind: "restoreCanonicalFact"; factId: string; before: CanonicalFactRecord | null }
  | { kind: "restoreKnowledge"; characterId: string; knowledgeRef: string; before: KnowledgeRecord | null }
  | { kind: "restoreCharacter"; characterId: string; before: CharacterRecord | null; controlBefore: CharacterControlRecord | null }
  | { kind: "restoreCharacterTimeline"; characterId: string; beforeTimelineId: string }
  | { kind: "restoreCombatEntity"; entityId: string; before: JsonRecord | null }
  | { kind: "restoreCombatRuntime"; before: CombatRuntimeState }
  | { kind: "restoreDefinition"; definitionId: string; beforeCampaign: JsonRecord | null; beforeCombat: JsonRecord | null }
  | { kind: "restoreCampaignEntry"; collection: keyof CampaignRuntimeState; entryId: string; before: JsonRecord | null }
  | { kind: "restoreCampaignDescriptor"; before: JsonRecord | null }
  | { kind: "restorePendingInputs"; before: JsonRecord }
  | {
      kind: "restoreTenureRuntime";
      characterId: string;
      pendingInputsBefore: JsonRecord;
      suspendedPendingInputsBefore: JsonRecord;
      pendingReceiptsBefore: JsonRecord;
      partyGroupsBefore: JsonRecord;
      partyInvitationsBefore: JsonRecord;
      partyMoveProposalsBefore: JsonRecord;
      combatEntityBefore: JsonRecord | null;
    }
  | {
      kind: "restoreSuccessorRuntime";
      successorCharacterId: string;
      timelineId: string;
      characterTimelineBefore: string | null;
      timelineBefore: JsonRecord | null;
      causalFrontierBefore: JsonRecord | null;
      spotlightBefore: JsonRecord | null;
    };

export type CorrectionAuditRecord = {
  eventId: string;
  eventSeq: string;
  eventType: EventType;
  rootActionId: string;
  branchId: string;
  payloadHash: Sha256Ref;
  effects: CorrectionEffect[];
};

export type CorrectionRuntimeState = {
  authorityCapability: Sha256Ref;
  audit: Record<string, CorrectionAuditRecord>;
  corrections: Record<string, JsonRecord>;
  branches: Record<string, JsonRecord>;
};

export type RoomMemberRecord = {
  principalId: string;
  role: "host" | "player" | "observer";
  status: "active" | "departed" | "removed";
};

export type MultiplayerRuntimeState = {
  roomAdministrationCapability: Sha256Ref;
  members: Record<string, RoomMemberRecord>;
  hostPrincipalId: string;
  safetyPresentations: Record<string, SafetyPresentationRecord>;
  suspendedPendingInputs: Record<string, JsonRecord>;
  partyGroups: Record<string, JsonRecord>;
  partyInvitations: Record<string, JsonRecord>;
  partyMoveProposals: Record<string, JsonRecord>;
  characterTimelineIds: Record<string, string>;
  causalFrontiers: Record<string, JsonRecord>;
  spotlightLedger: Record<string, JsonRecord>;
};

export type SafetyPresentationAdjustment =
  | "fadeToBlack"
  | "reduceDetail"
  | "skipSensitiveContent";

export type SafetyPresentationRecord = {
  requesterPrincipalId: string;
  status: "paused" | "resumed";
  presentationAdjustment: SafetyPresentationAdjustment | null;
};

export type PendingInputRecord = {
  pendingInputId: string;
  kind: "clarification" | "playerChoice" | "advancementChoice" | "partyInvitation" | "partyMoveConsent"
    | "groupRestConsent" | "combatChoice" | "socialResolution";
  rootActionId: string;
  controllerCharacterId: string;
  question: string;
  campaignId?: string;
  sourceFactIds?: string[];
  options?: JsonRecord;
  openedByEventId: string;
  visibility: "private";
};

export type FrozenCheck = {
  kind: "ability" | "skill" | "tool" | "savingThrow";
  ability: "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
  skill: string | null;
  dc: string;
  modifier: string;
  mode: "normal" | "advantage" | "disadvantage";
  goal: string;
  method: string;
  risk: string;
  successOutcome: string;
  failureOutcome: string;
  costs: string[];
};

export type CheckRandomnessRequest = {
  randomnessId: string;
  resolutionId: string;
  actorCharacterId: string;
  purpose: "improvisedCheck" | "abilityCheck" | "contestCheck" | "savingThrow";
  diceExpression: "1d20" | "2d20kh1" | "2d20kl1";
  frozenCheck: FrozenCheck;
};

export type RestHitDiceRandomnessRequest = {
  randomnessId: string;
  resolutionId: string;
  actorCharacterId: string;
  purpose: "restHitDice";
  purposeKey: string;
  diceExpression: string;
  dice: Array<{ count: string; sides: string }>;
  frozenParameters: JsonRecord;
  requestHash: Sha256Ref;
};

export type RandomnessRequest = CheckRandomnessRequest | RestHitDiceRandomnessRequest | HiddenRealityRandomnessRequest;

export type HiddenRealityRandomnessRequest = {
  randomnessId: string;
  resolutionId: string;
  actorCharacterId: string;
  purpose: "hiddenRealitySelection";
  purposeKey: string;
  diceExpression: string;
  dice: Array<{ count: string; sides: string }>;
  frozenParameters: JsonRecord;
  requestHash: Sha256Ref;
};

export type HiddenRealityResolutionPlan = {
  kind: "hiddenRealitySelection";
  candidateSetId: string;
  candidates: JsonRecord[];
  actionPlan: JsonRecord;
};

export type CompoundActionCost =
  | { kind: "consumeResource"; resourceRef: string; amount: number }
  | { kind: "consumeItem"; itemRef: string; count: number }
  | { kind: "fictionTime"; durationMicros: string };

export type CompoundActionEffect =
  | {
      kind: "acquireEvidence";
      evidenceRef: string;
      evidence: string;
      definitionRef: string;
    }
  | {
      kind: "acquireKnowledge";
      knowledgeRef: string;
      value: string | number | boolean | null;
      definitionRef: string;
    }
  | {
      kind: "changeResource";
      targetRef: string;
      resourceRef: string;
      amount: number;
    }
  | {
      kind: "changeHitPoints";
      targetRef: string;
      amount: number;
    }
  | {
      kind: "alertNpc";
      npcId: string;
      status: string;
    }
  | {
      kind: "moveEntity";
      entityRef: string;
      sceneRef: string;
    }
  | {
      kind: "advanceFictionTime";
      durationMicros: string;
    }
  | {
      kind: "updateRelationship";
      relationshipRef: string;
      subjectRefs: string[];
      change: string;
      basisFactIds: string[];
    }
  | {
      kind: "recordCommitment";
      commitmentRef: string;
      promisorRef: string;
      promiseeRef: string;
      content: string;
      condition: string;
    }
  | {
      kind: "recordDebt";
      debtRef: string;
      debtorRef: string;
      creditorRef: string;
      obligation: string;
      condition: string;
      basisFactIds: string[];
    };

/**
 * Internal, event-backed continuation data. It is deliberately semantic rather
 * than an event/state patch so replay can resume the exact frozen outcome.
 */
export type CompoundResolutionPlan = {
  schema: "zhuwei.compound-resolution-plan/v1";
  actorCharacterId: string;
  goal: string;
  method: string;
  sourceSceneId: string;
  durationMicros: string;
  primaryFactRef: string;
  frozenCosts: CompoundActionCost[];
  successEffects: CompoundActionEffect[];
  failureEffects: CompoundActionEffect[];
};

/** Frozen executable V3 program carried only inside authoritative randomness
 * continuations. The complete program is retained so replay/recovery never
 * recompiles a model draft or consults a current adapter. */
export type CausalActionResolutionPlan = {
  schema: "zhuwei.causal-action-resolution-plan/v4";
  rootActionId: string;
  actorCharacterId: string;
  sourceSceneId: string;
  languageRef: string;
  languageHash: string;
  programHash: string;
  program: JsonRecord;
  checkNodeRefs: string[];
  durationMicros: string;
  programFactRef: string;
};

export type SocialResolutionPlan = {
  schema: "zhuwei.social-resolution-plan/v1";
  rootActionId: string;
  actorCharacterId: string;
  npcCharacterId: string;
  sourceSceneId: string;
  programFactRef: string;
  programHash: string;
  program: JsonRecord;
  nodeRef: string;
  claimRef: string;
  threadRef: string;
  pendingInputId: string;
  claimSemantics: SocialClaimSemantics;
  successResponse: SocialNpcResponse;
  durationMicros: string;
  frozenCheck: FrozenCheck;
  frozenBoundary: {
    base: number;
    npcInsightModifier: number;
    authorityModifier: number;
    relationshipModifier: number;
    evidenceModifier: number;
    stakesModifier: number;
    finalDc: number;
    mutuallyKnownEvidenceRefs: string[];
  };
  maximumInfluenceDegree: Extract<
    SocialInfluenceDegree,
    "limitedSuccess" | "fullSuccess" | "strongSuccess"
  >;
  retryGate: Array<
    "methodChanged" | "factsChanged" | "positionChanged" | "situationAdvanced"
  >;
};

export type ContestResolutionPlan = {
  schema: "zhuwei.contest-resolution-plan/v1";
  initiatorId: string;
  defenderId: string;
  tieResult: string;
};

export type AdjudicationPrecedentScope = {
  kind: "scene" | "campaign" | "module" | "room";
  ref: string;
};

export type AdjudicationPrecedentMechanics = {
  operation: string;
  ability: string | null;
  skill: string | null;
  dc: number | null;
  duration: {
    unit: "round" | "second" | "minute" | "hour" | "day";
    value: number;
  } | null;
  outcomeRange: {
    success: string[];
    failure: string[];
  };
};

export type AdjudicationPrecedentPayload = {
  precedentId: string;
  canonicalContextFingerprint: Sha256Ref;
  publicExplanation: string;
  publicRuleBasis: string[];
  publicBasisRefs: string[];
  privateBasisRefs: string[];
  mechanics: AdjudicationPrecedentMechanics;
  applicabilityScope: AdjudicationPrecedentScope;
  rulesetProfile: ProfileRef;
  runtimeManifestProfile: ProfileRef;
};

export type ConversationThreadRecord = JsonRecord & {
  threadRef: string;
  actorCharacterId: string;
  npcCharacterId: string;
  claimRef: string;
  claimSemantics: SocialClaimSemantics;
  topicFingerprint: Sha256Ref;
  claimKind: "sourceClaim";
  claimTruthStatus: "unresolved";
  resolution: "direct" | "check";
  sourceSceneId: string;
  utterance: string;
  status: "active" | "deemphasized" | "dormant" | "closed";
  pendingInputId: string | null;
  updatedByEventId: string;
};

export type CampaignRuntimeState = {
  campaign: JsonRecord | null;
  chapters: Record<string, JsonRecord>;
  relationships: Record<string, JsonRecord>;
  promises: Record<string, JsonRecord>;
  debts: Record<string, JsonRecord>;
  factions: Record<string, JsonRecord>;
  activities: Record<string, JsonRecord>;
  unresolvedThreats: string[];
  definitions: Record<string, JsonRecord>;
  sourceClaims: Record<string, JsonRecord>;
  npcPlans: Record<string, JsonRecord>;
  factionPlans: Record<string, JsonRecord>;
  meaningfulFailures: Record<string, JsonRecord>;
  adjudicationPrecedents: Record<string, JsonRecord>;
  retryChanges: Record<string, JsonRecord>;
  sceneQuestions: Record<string, JsonRecord>;
  endingCandidates: Record<string, JsonRecord>;
  stories: Record<string, JsonRecord>;
  epilogues: Record<string, JsonRecord>;
  inheritanceSources: Record<string, JsonRecord>;
  conversationThreads?: Record<string, ConversationThreadRecord>;
  itemSystem: ItemSystemStateV1;
};

export type InheritanceAuthorization = {
  authorizationId: string;
  subjectCharacterId: string;
  kind: "item" | "knowledge" | "relationship" | "debt" | "promise";
  sourceRef: string;
  targetCharacterId: string;
  targetRef: string;
  scope:
    | "transferPossession"
    | "acquireExactKnowledge"
    | "establishDerivedRelationship"
    | "assumeDebtObligation"
    | "assumePromiseObligation";
};

/**
 * Version-pinned combat state. Values use canonical JSON records because the
 * AbilityDefinition compiler owns their closed per-kind schema; callers never
 * receive a mutable reference to this cache.
 */
export type CombatRuntimeState = {
  story: JsonRecord | null;
  scenes: Record<string, JsonRecord>;
  entities: Record<string, JsonRecord>;
  definitions: Record<string, JsonRecord>;
  encounters: Record<string, JsonRecord>;
  effects: Record<string, JsonRecord>;
  pendingInputs: Record<string, JsonRecord>;
  randomnessResolutions: Record<string, JsonRecord>;
};

export type AuthorityContinuation = {
  kind: "roomAuthorityRandomness";
  continuationId: string;
  capability: Sha256Ref;
};

export type InternalContinuationRecord = {
  continuation: AuthorityContinuation;
  rootActionId: string;
  request: RandomnessRequest;
  resolutionPlan?: CompoundResolutionPlan | CausalActionResolutionPlan | SocialResolutionPlan
    | ContestResolutionPlan | HiddenRealityResolutionPlan;
};

export type AuthoritativeWorldState = {
  schema: "zhuwei.authoritative-world-state/v2";
  version: string;
  roomId: string;
  runtimeEpochId: string;
  runtimeManifestRef: ProfileRef;
  activeBranchId: string;
  fictionTimelines: Record<string, { branchId: string; nowMicros: string }>;
  scenes: Record<string, SceneRecord>;
  principals: Record<string, PrincipalRecord>;
  seats: Record<string, SeatRecord>;
  entities: Record<string, CharacterRecord>;
  characterControls: Record<string, CharacterControlRecord>;
  canonicalFacts: Record<string, CanonicalFactRecord>;
  knowledge: Record<string, Record<string, KnowledgeRecord>>;
  receipts: Record<string, StoredReceipt>;
  pendingInputs: Record<string, PendingInputRecord>;
  internalContinuations: Record<string, InternalContinuationRecord>;
  campaignRuntime: CampaignRuntimeState;
  combatRuntime: CombatRuntimeState;
  correctionRuntime: CorrectionRuntimeState;
  multiplayerRuntime: MultiplayerRuntimeState;
  eventHeadHash: Sha256Ref;
  lastEventId: string | null;
};

export type RuntimeGenesis = {
  kind: "roomGenesis";
  roomId: string;
  runtimeEpochId: string;
  profiles: RuntimeProfileManifest;
  moduleRef: ProfileRef;
  initialDefinitionCatalogRef: ProfileRef;
  initialState: JsonRecord;
  initialStateHash: Sha256Ref;
  genesisHash: Sha256Ref;
};

export type KnowledgeAcquiredPayload = {
  characterId: string;
  knowledgeRef: string;
  objectKind: KnowledgeRecord["objectKind"];
  layer: KnowledgeRecord["layer"];
  content: unknown;
  causeFactId: string;
  acquisition: {
    sense: string;
    sceneId: string;
    method: string;
  };
  visibility: KnowledgeRecord["visibility"];
  sourceCharacterId?: string;
} | {
  characterId: string;
  sourceCharacterId: string;
  medium: string;
  contentLayer: KnowledgeRecord["layer"];
  items: Array<{
    knowledgeRef: string;
    objectKind: KnowledgeRecord["objectKind"];
    content: unknown;
    provenanceChain: string[];
  }>;
};

export type KnowledgeSharedPayload = {
  sourceCharacterId: string;
  sourceKnowledgeRef: string;
  recipientCharacterIds: string[];
  contentKind: "exact";
  sharedContent: unknown;
  medium: {
    kind: "establishedChannel";
    factId: string;
  };
};

export type ActorPlanFormedPayload = {
  npcId: string;
  planId: string;
  goal: string;
  actorKind: "npc";
  actorRef: string;
  decisionNpcId: string;
  revision: "1";
  status: "scheduled";
  premiseRefs: string[];
  nextStep: string;
  resourceRefs: string[];
  activity: {
    activityId: string;
    activityKind: string;
    intendedDurationMicros: string;
  };
  due: { kind: "fictionTime"; atFictionMicros: string } | null;
  trigger:
    | { kind: "committedEvent"; eventRef: string }
    | { kind: "knowledgeAcquired"; knowledgeRef: string }
    | null;
  trace: {
    factRef: string;
    description: string;
    visibilityPolicyRef: string;
  };
  alternateTarget: {
    targetRef: string;
    reason: string;
  };
  chapterId: string;
  moduleRef: ProfileRef;
};

export type EventPayloadByType = {
  EnvironmentFeatureMaterialized: {
    actorCharacterId: string;
    sceneId: string;
    featureId: string;
    environmentProfile: ProfileRef;
    featureDefinition: JsonRecord;
    featureDefinitionHash: Sha256Ref;
    compiledHash: Sha256Ref;
    feature: JsonRecord;
    causalProgramFactRef?: string;
    causalProgramHash?: string;
  };
  EnvironmentStuntRefused: {
    actorCharacterId: string;
    sceneId: string;
    featureId: string;
    reason: "featureAbsent";
  };
  EnvironmentFeatureDamaged: {
    actorCharacterId: string;
    sceneId: string;
    featureId: string;
    definitionId: string;
    environmentDefinition: JsonRecord;
    environmentDefinitionHash: Sha256Ref;
    abilityRef: string;
    abilityDefinition: JsonRecord;
    abilityDefinitionHash: Sha256Ref;
    compiledHash: Sha256Ref;
    armorClass: string;
    attackRolls: number[];
    selectedAttackRoll: number;
    attackBonus: string;
    attackTotal: string;
    hit: boolean;
    damageType: string;
    rangeInches: string;
    damageThreshold: string;
    immuneDamageTypes: string[];
    rolledDamage: string;
    appliedDamage: string;
    durabilityBefore: string;
    durabilityAfter: string;
    fromState: string;
    toState: string;
  };
  EnvironmentFeatureStateChanged: {
    actorCharacterId: string;
    sceneId: string;
    featureId: string;
    definitionId: string;
    intent: "open" | "close" | "applyStunt" | "triggerHazard" | "resolveHazard";
    fromState: string;
    toState: string;
  };
  EnvironmentHazardTriggered: {
    actorCharacterId: string;
    sceneId: string;
    featureId: string;
    environmentProfile: ProfileRef;
    featureDefinitionHash: Sha256Ref;
    hazardDefinition: JsonRecord;
    hazardDefinitionHash: Sha256Ref;
    areaEffectDefinition: JsonRecord;
    areaEffectDefinitionHash: Sha256Ref;
    origin: { x: string; y: string; elevation: string };
    entityTargetIds: string[];
    featureTargetIds: string[];
  };
  EnvironmentAreaTargetResolved: {
    actorCharacterId: string;
    sceneId: string;
    sourceFeatureId: string;
    targetEntityId: string;
    areaEffectDefinitionHash: Sha256Ref;
    saveAbility: "str" | "dex" | "con" | "int" | "wis" | "cha";
    saveDc: string;
    saveMode: "normal" | "advantage" | "disadvantage";
    saveRolls: number[];
    selectedSaveRoll: number;
    saveModifier: string;
    saveTotal: string;
    saveSucceeded: boolean;
    damageType: string;
    rolledDamage: string;
    appliedDamage: string;
    statusApplied: "none" | "prone";
    targetBeforeHash: Sha256Ref;
    targetPatch: JsonRecord;
  };
  EnvironmentAreaFeatureDamaged: {
    actorCharacterId: string;
    sceneId: string;
    sourceFeatureId: string;
    targetFeatureId: string;
    areaEffectDefinitionHash: Sha256Ref;
    damageType: string;
    rolledDamage: string;
    appliedDamage: string;
    durabilityBefore: string;
    durabilityAfter: string;
    fromState: string;
    toState: string;
  };
  SafetyPauseRequested: {
    requesterPrincipalId: string;
    actorCharacterId: string;
  };
  SafetyPresentationAdjusted: {
    requesterPrincipalId: string;
    actorCharacterId: string;
    presentationAdjustment: SafetyPresentationAdjustment;
  };
  ImprovisedActionResolved: {
    actorCharacterId: string;
    outcomeCode: string;
    fact: Omit<CanonicalFactRecord, "branchId" | "validFromEventSeq" | "causalParentIds"> | null;
  };
  ClarificationRequested: {
    actorCharacterId: string;
    pendingInputId: string;
    question: string;
  };
  PlayerChoiceRequested: {
    actorCharacterId: string;
    pendingInputId: string;
    question: string;
    choices: Array<{ choiceId: string; label: string; consequence: string }>;
  };
  SocialResolutionOffered: {
    actorCharacterId: string;
    npcCharacterId: string;
    pendingInputId: string;
    claimRef: string;
    threadRef: string;
    question: string;
    planHash: Sha256Ref;
    plan: SocialResolutionPlan;
  };
  SocialResolutionDeclined: {
    actorCharacterId: string;
    npcCharacterId: string;
    pendingInputId: string;
    claimRef: string;
    threadRef: string;
    reason: "acceptedStatusQuo" | "reframed" | "invalidated";
    disposition: "active" | "deemphasized" | "dormant" | "closed";
    outcome: string;
  };
  SocialDirectResolved: {
    actorCharacterId: string;
    npcCharacterId: string;
    claimRef: string;
    responseClaimRef: string | null;
    responseMode: SocialNpcResponse["mode"];
    responseReaction: SocialNpcResponse["reactionKind"];
    responseMinimumDegree: SocialNpcResponse["minimumDegree"];
    sourceRefs: string[];
    claimSemantics: SocialClaimSemantics;
    addressedThreadRef: string | null;
    threadRef: string;
    immediateBehavior: string;
    threadDisposition: "active" | "deemphasized" | "dormant" | "closed";
    outcome: string;
    planHash: Sha256Ref;
    plan: SocialResolutionPlan;
  };
  SocialCheckResolved: {
    actorCharacterId: string;
    npcCharacterId: string;
    claimRef: string;
    addressedThreadRef: string | null;
    addressedThreadDisposition: "active" | "deemphasized" | "dormant" | "closed" | null;
    responseClaimRef: string | null;
    responseReached: boolean;
    responseMode: SocialNpcResponse["mode"] | null;
    responseReaction: SocialNpcResponse["reactionKind"];
    responseMinimumDegree: SocialNpcResponse["minimumDegree"];
    responseSourceRefs: string[];
    threadRef: string;
    boundary: number;
    selectedRoll: number;
    total: number;
    margin: number;
    marginDegree: SocialInfluenceDegree;
    degree: SocialInfluenceDegree;
    succeeded: boolean;
    maximumInfluenceDegree: SocialResolutionPlan["maximumInfluenceDegree"];
    immediateBehavior: string;
    threadDisposition: "active" | "deemphasized" | "dormant" | "closed";
    relationshipBefore: number;
    relationshipDelta: number;
    relationshipScore: number;
    outcome: string;
  };
  DynamicEntityMaterialized: {
    definitionId: string;
    entityId: string;
    entityKind: "npc";
    sourceFactIds: string[];
    initialKnowledgeFactIds: string[];
    sceneId: string;
    sourceTimelineId: string;
    socialArchetypeRef: string;
    socialMechanicsHash: Sha256Ref;
  };
  PendingInputAnswered: {
    actorCharacterId: string;
    pendingInputId: string;
    openedByEventId: string;
    answer: JsonRecord;
  };
  CorrectionApplied: {
    actorCharacterId: string;
    correctionId: string;
    targetReceiptId: string;
    targetRootActionId: string;
    errorKind: string;
    publicExplanation: string;
    compensatedEventIds: string[];
    effects: CorrectionEffect[];
  };
  CorrectionBranchOpened: {
    actorCharacterId: string;
    correctionId: string;
    targetReceiptId: string;
    targetRootActionId: string;
    parentBranchId: string;
    branchId: string;
    cutoffEventSeq: string;
    errorKind: string;
    publicExplanation: string;
    supersededRootActionIds: string[];
  };
  BranchActivated: {
    correctionId: string;
    parentBranchId: string;
    branchId: string;
    effects: CorrectionEffect[];
    supersededRootActionIds: string[];
  };
  MemberJoined: { principal: PrincipalRecord; role: RoomMemberRecord["role"] };
  MemberDeparted: { principalId: string; reason: string };
  MemberRemoved: { principalId: string; reason: string };
  SeatGranted: { seat: SeatRecord };
  SeatReactivated: { seatId: string; principalId: string };
  SeatVacated: { seatId: string; principalId: string; reason: string };
  CharacterControlGranted:
    | { character: null; characterId: string; seatId: string }
    | {
        character: CharacterRecord;
        characterId: string;
        seatId: string;
        combatEntity: JsonRecord;
        definitions: JsonRecord[];
      };
  CharacterGearChanged: {
    characterId: string;
    action: "wear" | "stow";
    slot: string;
    itemId: string;
    armorClass: number;
  };
  NpcGearChanged: {
    characterId: string;
    action: "wear" | "stow";
    slot: string;
    itemId: string;
    armorClass: number;
    equipmentAbilityRefs: string[];
  };
  NpcMechanicalItemStateChanged: {
    actorCharacterId: string;
    characterId: string;
    itemId: string;
    action: "break" | "repair" | "destroy";
    causeFactRef: string;
    armorClass: number;
    equipmentAbilityRefs: string[];
  };
  CharacterMechanicsSynchronized: { characterId: string; combatEntity: JsonRecord; definitions: JsonRecord[] };
  CharacterControlRevoked: { characterId: string; seatId: string; reason: string };
  HostTransferred: { fromPrincipalId: string; toPrincipalId: string };
  PendingInputSuspended: { pendingInputId: string; controllerCharacterId: string; reason: string };
  PendingInputReassigned: {
    pendingInputId: string;
    controllerCharacterId: string;
    fromSeatId: string;
    toSeatId: string;
  };
  PendingInputResumed: {
    pendingInputId: string;
    controllerCharacterId: string;
    seatId: string;
  };
  PartyGroupCreated: { groupId: string; leaderCharacterId: string; memberCharacterIds: string[] };
  PartyMemberInvited: {
    groupId: string;
    inviterCharacterId: string;
    invitedCharacterId: string;
    pendingInputId: string;
  };
  PartyInvitationAnswered: {
    groupId: string;
    invitedCharacterId: string;
    pendingInputId: string;
    accepted: boolean;
  };
  PartyInvitationCancelled: {
    groupId: string;
    inviterCharacterId: string;
    invitedCharacterId: string;
    pendingInputId: string;
    invitationRootActionId: string;
  };
  PartyMemberJoined: { groupId: string; characterId: string };
  PartyMemberLeft: { groupId: string; characterId: string; reason: string };
  PartyLeaderTransferred: { groupId: string; fromCharacterId: string; toCharacterId: string };
  PartyGroupDisbanded: { groupId: string; reason: string };
  PartyMoveProposed: {
    proposalId: string;
    groupId: string;
    leaderCharacterId: string;
    memberCharacterIds: string[];
    destinationSceneId: string;
    fictionTimeCostMicros: string;
    sourceTimelineId: string;
    destinationTimelineId: string;
    departureMicros: string;
    arrivalMicros: string;
    pendingInputIds: string[];
  };
  PartyMoveConsentRecorded: {
    proposalId: string;
    groupId: string;
    characterId: string;
    pendingInputId: string;
    accepted: boolean;
  };
  PartyMoved: {
    proposalId: string;
    groupId: string;
    memberCharacterIds: string[];
    destinationSceneId: string;
    sourceTimelineId: string;
    destinationTimelineId: string;
    departureMicros: string;
    arrivalMicros: string;
  };
  CharacterMoved: {
    characterId: string;
    destinationSceneId: string;
    sourceTimelineId: string;
    destinationTimelineId: string;
    departureMicros: string;
    arrivalMicros: string;
  };
  FictionTimelinesMet: {
    characterIds: string[];
    sceneId: string;
    sourceTimelineIds: string[];
    meetingTimelineId: string;
    meetingMicros: string;
  };
  CausalFrontierPropagated: {
    sourceTimelineId: string;
    targetTimelineId: string;
    sourceEventHeadId: string;
    arrivalMicros: string;
    mediumFactId: string;
  };
  RandomnessRequested: {
    request: RandomnessRequest;
    continuation: AuthorityContinuation;
    purpose: RandomnessRequest["purpose"];
    formula: RandomnessRequest["diceExpression"];
  } | {
    request: RandomnessRequest;
    continuation: AuthorityContinuation;
    purpose: RandomnessRequest["purpose"];
    formula: RandomnessRequest["diceExpression"];
    resolutionPlan: CompoundResolutionPlan | CausalActionResolutionPlan | SocialResolutionPlan
      | ContestResolutionPlan | HiddenRealityResolutionPlan;
  } | { resolution: JsonRecord };
  DiceRolled: {
    randomnessId: string;
    resolutionId: string;
    formula: RandomnessRequest["diceExpression"];
    faces: number[];
    selectedFace: number | null;
    requestHash: Sha256Ref;
    frozenParametersHash: Sha256Ref;
  };
  HiddenRealityCandidatesFrozen: {
    candidateSetId: string;
    candidates: JsonRecord[];
  };
  HiddenRealityMaterialized: {
    candidateSetId: string;
    candidateId: string;
    factRef: string;
    selectedFace: number;
  };
  ImprovisedCheckResolved: {
    request: RandomnessRequest;
    rolls: number[];
    selectedRoll: number;
    total: number;
    succeeded: boolean;
    outcome: string;
  };
  ContestResolved: {
    initiatorId: string;
    defenderId: string;
    initiatorRolls: number[];
    defenderRolls: number[];
    initiatorTotal: number;
    defenderTotal: number;
    winnerId: string | null;
    outcome: string;
    continuationIds: string[];
  };
  KnowledgeAcquired: KnowledgeAcquiredPayload;
  KnowledgeShared: KnowledgeSharedPayload;
  CharacterControlTransferred: {
    characterId: string;
    fromSeatId: string;
    toSeatId: string;
  };
  CharacterRetired: {
    characterId: string;
    controllingSeatId: string;
    reason?: string;
    continueAsNpc?: boolean;
  };
  SuccessorIntroduced: {
    predecessorCharacterId: string;
    controllerSeatId: string;
    successor: CharacterRecord;
    combatEntity: JsonRecord;
    definitions: JsonRecord[];
    worldEntry?: string;
  };
  FeasibilityRuled: {
    characterId: string;
    goal: string;
    method: string;
    feasibilityKind: "directSuccess" | "checkRequired" | "highRiskFeasible";
    publicBasis: string;
  };
  AdjudicationPrecedentRecorded: AdjudicationPrecedentPayload;
  AdjudicationPrecedentSuperseded: AdjudicationPrecedentPayload & {
    supersededPrecedentId: string;
    materialDifferences: string[];
  };
  ResourceReserved: { characterId: string; resourceId: string; amount: number; purpose: string };
  CheckFrozen: {
    characterId: string;
    checkKind: "ability" | "skill" | "savingThrow";
    ability: string;
    skill: string | null;
    dc: number;
    mode: "normal" | "advantage" | "disadvantage";
    success: JsonRecord;
    failure: JsonRecord;
  };
  FictionTimeAdvanced: { durationMicros: string; reason: string };
  ContestFrozen: { initiatorId: string; defenderId: string; initiatorCheck: JsonRecord; defenderCheck: JsonRecord; tieResult: string };
  SaveFrozen: { targetId: string; sourceDefinitionId: string; ability: string; dc: number; success: JsonRecord; failure: JsonRecord };
  ResourceUsed: { characterId: string; resourceId: string; amount: number; purpose: string };
  ResourceChanged: {
    characterId: string;
    resourceId: string;
    before: number;
    after: number;
    delta: number;
    reason: string;
  };
  ItemUsed: {
    characterId: string;
    entryId: string;
    purpose: string;
    quantityBefore: number;
    quantityAfter: number;
    chargesBefore: number | null;
    chargesAfter: number | null;
    durabilityBefore: number | null;
    durabilityAfter: number | null;
  };
  ItemDefinitionRegistered: {
    definition: ItemDefinitionV1;
  };
  ItemMaterialized: {
    entry: ItemEntryV1;
  };
  ItemAcquired: {
    entryId: string;
    characterId: string;
    fromSceneId: string;
  };
  ItemTransferred: {
    fromCharacterId: string;
    toCharacterId: string;
    itemId: string;
    targetItemId: string;
    quantity: number;
    method: string;
    ownershipDisposition: ItemOwnershipDisposition;
  };
  ActivityStarted: {
    activityId: string;
    characterId: string;
    activityKind: string;
    intendedDurationMicros: string;
    completion: JsonRecord;
  };
  RestStarted: {
    activityId: string;
    characterId: string;
    restKind: "short" | "long";
    intendedDurationMicros: string;
    recoveryChoice: { hitDiceToSpend: number; arcaneRecoverySlotLevels: number[] };
  };
  GroupRestOffered: {
    initiatorCharacterId: string;
    invitedCharacterIds: string[];
    pendingInputIds: string[];
    restKind: "short" | "long";
    intendedDurationMicros: string;
  };
  GroupRestConsentRecorded: {
    invitedCharacterId: string;
    pendingInputId: string;
    accepted: boolean;
    recoveryChoice: { hitDiceToSpend: number; arcaneRecoverySlotLevels: number[] } | null;
    remainingPendingInputIds: string[];
  };
  ActivityInterrupted: { activityId: string; cause: JsonRecord };
  ActivityCompleted: { activityId: string };
  RestCompleted: {
    activityId: string;
    characterId: string;
    restKind: "short" | "long";
    completedAtFictionMicros: string;
    continuationId: string | null;
    resultingCharacter: CharacterRecord;
    recovery: JsonRecord;
  };
  DefinitionRegistered: {
    definition: JsonRecord;
    definitionHash?: Sha256Ref;
    compilerProfile?: ProfileRef;
    mechanicGraph?: {
      entryOpIds: string[];
      operations: Array<{
        opId: string;
        family: string;
        sourcePath: string;
        input: JsonRecord;
        next: string[];
      }>;
    };
    compiledHash?: Sha256Ref;
    referenceClosure?: string[];
  };
  HazardTriggered: { definitionId: string; triggeringEntityId: string; zoneId: string; causeFactIds: string[] };
  DamagePacketResolved: { targetId: string; amount: number; damageType: string; sourceDefinitionId: string } | JsonRecord;
  HitPointsChanged: { characterId: string; before: number; after: number; maximum: number; causeId: string };
  CreatureDied: { characterId: string; causeId: string };
  CanonicalFactDeclared: { fact: Omit<CanonicalFactRecord, "branchId" | "validFromEventSeq"> };
  SensoryEvidenceAcquired: { characterId: string; factId: string; sense: string; clarity: string; publicEvidence: string };
  SourceClaimCreated: { speakerId: string; claimId: string; semanticContent: string; sourceBasis: string; motive: string; formedAtFictionMicros: string };
  CharacterInferenceFormed: { characterId: string; inferenceId: string; evidenceRefs: string[]; conclusion: string; confidence: string };
  RelationshipChanged: { relationshipId: string; subjectIds: string[]; change: string; basisFactIds: string[] };
  RelationshipEstablished: { relationshipId: string; sourceRelationshipId: string; subjectIds: string[]; value: string; basisFactIds: string[]; sourceFactId: string; authorizationId: string };
  PromiseMade: { promiseId: string; promisorId: string; promiseeId: string; content: string; condition: string };
  PromiseAssumed: { promiseId: string; sourcePromiseId: string; promisorId: string; promiseeId: string; content: string; condition: string; sourceFactId: string; authorizationId: string };
  DebtIncurred: { debtId: string; debtorId: string; creditorId: string; obligation: string; condition: string; basisFactIds: string[] };
  DebtAssumed: { debtId: string; sourceDebtId: string; debtorId: string; creditorId: string; obligation: string; condition: string; basisFactIds: string[]; sourceFactId: string; authorizationId: string };
  NpcPlanFormed: ActorPlanFormedPayload;
  NpcActionCommitted: {
    npcId: string;
    planId: string;
    decision: "execute";
    causedByRootActionId: string;
    nextStep: string;
    traceFactRef: string;
    targetRef: string;
  };
  NpcPlanCancelled: {
    npcId: string;
    planId: string;
    priorRevision: string;
    reason: string;
    causedByRootActionId: string;
  };
  NpcPlanRevised: {
    npcId: string;
    planId: string;
    priorRevision: string;
    revision: string;
    decision: "revise" | "defer";
    reason: string;
    premiseRefs: string[];
    nextStep: string;
    resourceRefs: string[];
    due: { kind: "fictionTime"; atFictionMicros: string } | null;
    trigger:
      | { kind: "committedEvent"; eventRef: string }
      | { kind: "knowledgeAcquired"; knowledgeRef: string }
      | null;
    trace: ActorPlanFormedPayload["trace"];
    alternateTarget: ActorPlanFormedPayload["alternateTarget"];
    causedByRootActionId: string;
  };
  FactionPlanFormed: {
    factionId: string;
    planId: string;
    actingNpcId: string;
    premiseRefs: string[];
    resourceRefs: string[];
    revision: "1";
    status: "scheduled";
  };
  FactionActionCommitted: {
    factionId: string;
    planId: string;
    actingNpcId: string;
    decision: "execute";
    causedByRootActionId: string;
    nextStep: string;
    traceFactRef: string;
    targetRef: string;
    resourceRefs: string[];
  };
  FactionPlanAdvanced: { factionId: string; planId: string; actingNpcId: string; causeFactIds: string[]; action: string };
  SceneQuestionOpened: { sceneQuestionId: string; question: string };
  MeaningfulFailureCommitted: { characterId: string; goalId: string; methodFingerprint: string; factualCause: string; consequences: JsonRecord };
  RetryConditionChanged: { characterId: string; goalId: string; change: string; evidence: string };
  SceneQuestionAnswered: { sceneQuestionId: string; answerFactIds: string[] };
  EndingCandidateRaised: { endingCandidateId: string; basisFactIds: string[]; unresolvedConsequences: string[] };
  StoryConcluded: { storyId: string; endingCandidateId: string; outcome: string; longTermConsequences: string[] };
  EpilogueChoiceRecorded: { characterId: string; storyId: string; choice: string };
  SequelStarted: { priorStoryId: string; sequelStoryId: string; chapterId: string; anchorFactIds: string[]; sceneQuestion: string };
  AdvancementAvailable: {
    pendingInputId: string;
    campaignId: string;
    characterId: string;
    sourceFactIds: string[];
    options: JsonRecord;
  };
  ExperienceAwarded: {
    campaignId: string;
    characterId: string;
    amount: number;
    total: number;
    sourceFactIds: string[];
  };
  CharacterAdvanced: {
    pendingInputId: string;
    characterId: string;
    choice: JsonRecord;
    resultingCharacter: CharacterRecord;
  };
  ChapterConcluded: { campaignId: string; chapterId: string; reason: string; continuityPolicy: string };
  ChapterContinuityRecorded: { campaignId: string; fromChapterId: string; toChapterId: string; manifest: JsonRecord };
  ChapterStarted: {
    campaignId: string;
    chapterId: string;
    ordinal: string;
    storyAnchorRefs: string[];
    sceneQuestion: string;
    moduleRef: ProfileRef;
  };
  InheritanceSourceEstablished: { predecessorCharacterId: string; successorCharacterId: string; factId: string; source: JsonRecord };
  InheritanceTransferred: InheritanceAuthorization & {
    predecessorCharacterId: string;
    successorCharacterId: string;
    sourceFactId: string;
  };
  EntityMaterialized: JsonRecord;
  EncounterStarted: JsonRecord;
  HostilityChanged: JsonRecord;
  InitiativeRequested: JsonRecord;
  InitiativeEstablished: JsonRecord;
  InitiativeTieOrdered: JsonRecord;
  RoundStarted: JsonRecord;
  TurnStarted: JsonRecord;
  TurnEnded: JsonRecord;
  AbilityInvoked: JsonRecord;
  MovementSegmentCommitted: JsonRecord;
  ConditionChanged: JsonRecord;
  ResourceSpent: JsonRecord;
  HealingResolved: JsonRecord;
  TemporaryHitPointsGranted: JsonRecord;
  ConcentrationStarted: JsonRecord;
  ConcentrationTested: JsonRecord;
  ConcentrationEnded: JsonRecord;
  ReadiedActionCreated: JsonRecord;
  ReadiedActionTriggered: JsonRecord;
  ReadiedActionExpired: JsonRecord;
  ReactionOpportunityOpened: JsonRecord;
  ReactionOffered: JsonRecord;
  ReactionAnswered: JsonRecord;
  TriggerInvalidated: JsonRecord;
  SpellCastingStarted: JsonRecord;
  SpellCountered: JsonRecord;
  SpellResolved: JsonRecord;
  EffectApplied: JsonRecord;
  EffectEnded: JsonRecord;
  RoundEnded: JsonRecord;
  DeathSaveResolved: JsonRecord;
  EncounterConclusionProposed: JsonRecord;
  EncounterConcluded: JsonRecord;
  CombatPendingOpened: JsonRecord;
  CombatPendingClosed: JsonRecord;
};

export type EventType = keyof EventPayloadByType;

export type EventEnvelope<T extends EventType = EventType> = {
  schema: "zhuwei.room-world-event/v2";
  eventId: string;
  eventSeq: string;
  roomId: string;
  runtimeEpochId: string;
  profiles: RuntimeProfileManifest;
  branchId: string;
  parentEventId: string | null;
  causalParentEventIds: string[];
  rootActionId: string;
  resolutionId: string | null;
  eventType: T;
  eventTypeVersion: "1" | "2" | "3" | "4";
  fictionTimelineId: string;
  fictionInstantMicros: string;
  payload: EventPayloadByType[T];
  payloadHash: Sha256Ref;
  previousEventHash: Sha256Ref;
  stateBeforeHash: Sha256Ref;
  stateHashAfter: Sha256Ref;
  scopeProofHash: Sha256Ref;
  visibilityPolicyId: string;
  secrecy: "public" | "private" | "internal";
  eventHash: Sha256Ref;
};

export type ScopeProof = {
  basisStateVersion: string;
  basisStateHash: Sha256Ref;
  reads: string[];
  writes: string[];
  creates: string[];
  proofHash: Sha256Ref;
};

export type ReplayHead = {
  runtimeEpochId: string;
  eventSeq: string;
  stateHash: Sha256Ref;
  genesisHash: Sha256Ref;
  eventHash: Sha256Ref;
};

export type ReplayedRulesResult = {
  kind: "replayed";
  interpreterKind: "authoritative";
  profiles: RuntimeProfileManifest;
  state: JsonRecord;
  cache: JsonRecord;
  head: ReplayHead;
};

export type ReplayResult = ReplayedRulesResult | RejectedRulesResult;

export type PlayerViewer = {
  kind: "player";
  principalId: string;
  sessionVersion?: number;
  seatId?: string;
  characterId: string;
  /** Internal Room-to-Rules view for a trusted Seat whose active character tenure ended. */
  purpose?: "lifecycle";
};

export type NpcViewer = {
  kind: "npc";
  npcId: string;
  purpose?: "kpDecision";
  capability?: "internal:npc-limited-knowledge";
};

export type KpViewer = {
  kind: "kp";
  capability: "internal:kp-spatial-evidence";
};

export type ObserverDeltaChange = JsonRecord & {
  kind: string;
};

export type ObserverCommittedDelta = {
  schema: "zhuwei.observer-committed-delta/v1";
  actorCharacterId: string;
  viewerCharacterId: string;
  receipt: PublicReceipt;
  changes: ObserverDeltaChange[];
};

export type ObserverProjectionAnchor = {
  eventSeq: string;
  stateHash: Sha256Ref;
  eventHash: Sha256Ref;
  projectionHash: Sha256Ref;
};

export type ObserverIncrementalDelta = {
  schema: "zhuwei.observer-incremental-delta/v1";
  from: ObserverProjectionAnchor;
  to: ObserverProjectionAnchor;
  changes: ObserverDeltaChange[];
};

export type ProjectionQuery = {
  channel?: "realtime" | "history" | "reconnect" | "error" | "candidates" | "voice" | "transcript";
  referenceId?: string;
  observedAtUnixMs?: string;
  /** Public cursor. Room resolves it to incrementalRange before project. */
  sinceEventSeq?: string | number;
  sinceStateHash?: Sha256Ref;
  sinceEventHash?: Sha256Ref;
  sinceProjectionHash?: Sha256Ref;
  /** Internal Room-to-Rules input for one verified committed event range. */
  committedRange?: {
    receiptId: string;
    actorCharacterId: string;
    priorState: AuthoritativeWorldState;
    events: EventEnvelope[];
  };
  /** Internal Room-to-Rules input for one continuous observer increment. */
  incrementalRange?: {
    priorState: AuthoritativeWorldState;
    events: EventEnvelope[];
    expectedFrom: {
      eventSeq: string;
      stateHash?: Sha256Ref;
      eventHash?: Sha256Ref;
      projectionHash?: Sha256Ref;
    };
  };
  /** Internal Rules-owned selection for the next due finite-knowledge ActorPlan. */
  dueActorPlanFor?: {
    affectedCharacterId: string;
  };
};

export type SafeReadModel = {
  kind: "projected";
  runtimeProfiles: RuntimeProfileManifest;
  stateVersion: string;
  activeBranchId: string;
  projectionHash: Sha256Ref;
  incrementalDelta?: ObserverIncrementalDelta;
  viewer: {
    kind: "player" | "npc";
    subjectId: string;
  };
  controlledCharacter: {
    characterId: string;
    name?: string;
    sceneId?: string;
    tenureStatus?: CharacterRecord["tenureStatus"];
    level?: number;
    experiencePoints?: number;
    hitPoints?: { current: number; maximum: number };
    resources?: Record<string, number>;
    restRecoveryOptions?: {
      shortRest: {
        hitDiceMaximumSpend: number;
        hitDieSides?: number;
        arcaneRecovery: {
          eligible: boolean;
          spellLevelBudget: number;
          maximumSlotsByLevel: Record<1 | 2 | 3 | 4 | 5, number>;
        };
      };
    };
  };
  abilityDefinitions?: Record<string, JsonRecord>;
  fictionTime: {
    branchId: string;
    nowMicros: string;
  };
  visibleFacts: CanonicalFactRecord[];
  knowledge: KnowledgeRecord[];
  receipts: PublicReceipt[];
  pendingInputs: Array<{
    pendingInputId: string;
    kind: PendingInputRecord["kind"];
    rootActionId: string;
    question: string;
    access?: "controller" | "initiator";
    inviterCharacterId?: string;
    invitedCharacterId?: string;
    choiceKind?: string;
    choices?: Array<{ choiceId: string; label: string; consequence: string }>;
    options?: JsonRecord;
    candidateEntityIds?: string[];
    candidateAbilityRefs?: string[];
    orderedEntityIds?: string[];
    reactionKind?: string;
    triggerKind?: string;
    targetEntityId?: string;
  }>;
  safetyPresentation?: {
    status: SafetyPresentationRecord["status"];
    presentationAdjustment: SafetyPresentationAdjustment | null;
  };
  roomMembers?: Array<{
    principalId: string;
    role: RoomMemberRecord["role"];
    seatStatus: SeatRecord["status"];
  }>;
  partyGroups?: JsonRecord[];
  causalFrontier?: JsonRecord;
  spotlightLedger?: Record<string, JsonRecord>;
  campaign?: JsonRecord | null;
  chapters?: JsonRecord[];
  visibleItems?: JsonRecord[];
  factions?: JsonRecord[];
  factionPlans?: JsonRecord[];
  relationships?: JsonRecord[];
  promises?: JsonRecord[];
  debts?: JsonRecord[];
  activities?: JsonRecord[];
  unresolvedThreats?: string[];
  sourceClaims?: JsonRecord[];
  conversationThreads?: JsonRecord[];
  npcPlans?: JsonRecord[];
  adjudicationPrecedents?: JsonRecord[];
  stories?: JsonRecord[];
  epilogues?: JsonRecord[];
  entities?: Record<string, JsonRecord>;
  encounters?: Record<string, JsonRecord>;
  story?: JsonRecord;
  tacticalProjection?: TacticalProjection;
  committedDelta?: ObserverCommittedDelta;
};

export type LifecycleReadModel = {
  kind: "projected";
  runtimeProfiles: RuntimeProfileManifest;
  stateVersion: string;
  worldRevision: string;
  activeBranchId: string;
  projectionHash: Sha256Ref;
  incrementalDelta?: ObserverIncrementalDelta;
  viewer: {
    kind: "player";
    principalId: string;
  };
  controlledCharacter: null;
  safetyPresentation?: {
    status: SafetyPresentationRecord["status"];
    presentationAdjustment: SafetyPresentationAdjustment | null;
  };
  lifecycle: {
    kind: "successorRequired";
    defaultPredecessorCharacterId: string;
    eligiblePredecessors: Array<{
      characterId: string;
      name: string;
      tenureStatus: Extract<
        CharacterRecord["tenureStatus"],
        "dead" | "retired" | "missing" | "npcTransitioned"
      >;
    }>;
  };
};

export type KpSpatialReadModel = {
  kind: "projected";
  runtimeProfiles: RuntimeProfileManifest;
  stateVersion: string;
  activeBranchId: string;
  projectionHash: Sha256Ref;
  viewer: {
    kind: "kp";
    subjectId: "kp";
  };
  adjudicationPrecedents?: JsonRecord[];
  /** Complete KP-only dynamic fact authority. Room narrows this to the current
   * scene/entity causal frontier before placing it in a model Context Pack. */
  dynamicAuthoritativeFacts?: Record<string, CanonicalFactRecord>;
  npcMechanicalDefinitions?: Record<string, JsonRecord>;
  itemDefinitions?: Record<string, JsonRecord>;
  spatialEvidence: {
    scenes: Record<string, {
      sceneId: string;
      geometry: JsonRecord;
    }>;
    entities: Record<string, {
      id: string;
      name?: string;
      sceneId: string;
      mechanicalDefinitionRef?: string;
      position?: unknown;
      footprint?: unknown;
      visibilityPolicyId?: string;
      visibilityFactId?: string;
    }>;
  };
};

export type DueActorPlanReadModel =
  | (SafeReadModel & {
      dueActorPlan: JsonRecord;
      dueActorPlanChildRootActionId: string;
    })
  | {
      kind: "projected";
      runtimeProfiles: RuntimeProfileManifest;
      stateVersion: string;
      activeBranchId: string;
      projectionHash: Sha256Ref;
      viewer: { kind: "kp"; subjectId: "kp" };
      dueActorPlan: null;
      dueActorPlanChildRootActionId: null;
    };

export type ProjectionResult =
  | SafeReadModel
  | LifecycleReadModel
  | KpSpatialReadModel
  | DueActorPlanReadModel
  | RejectedRulesResult;

export type InitializedRulesResult = {
  kind: "initialized";
  profiles: RuntimeProfileManifest;
  genesis: RuntimeGenesis;
};

export type StateTransitionResult = {
  events: EventEnvelope[];
  state: AuthoritativeWorldState;
  cache: AuthoritativeWorldState;
  stateHash: Sha256Ref;
  scopeProof: ScopeProof;
  receipt: PublicReceipt;
  mechanicalResult?: JsonRecord;
};

export type CommittedRulesResult = StateTransitionResult & {
  kind: "committed";
  correctionId?: string;
  strategy?: "forwardCompensation" | "causalBranch";
  activeBranchId?: string;
  supersededRootActionIds?: string[];
};

export type ConcludedRulesResult = StateTransitionResult & {
  kind: "concluded";
};

export type AwaitingInputRulesResult = StateTransitionResult & {
  kind: "awaitingInput";
  pending: {
    pendingInputId: string;
    kind: string;
    question?: string;
    choiceKind?: string;
    choices?: Array<{ choiceId: string; label: string; consequence: string }>;
    controllerEntityId?: string;
    controllerEntityIds?: string[];
    orderedEntityIds?: string[];
    candidateEntityIds?: string[];
    candidateAbilityRefs?: string[];
    controller?: { kind: "character"; characterId: string };
  };
};

export type CombatRandomnessRequest = {
  randomnessId: string;
  resolutionId: string;
  requestHash: Sha256Ref;
  purposeKey: string;
  diceExpression: string;
  dice: Array<{ count: string; sides: string }>;
  frozenParameters: JsonRecord;
};

export type AwaitingRandomnessRulesResult = StateTransitionResult & {
  kind: "awaitingRandomness";
  randomnessRequest?: RandomnessRequest;
  continuation?: AuthorityContinuation;
  resolutionId?: string;
  continuationCapability?: string;
  randomnessRequests?: Array<RandomnessRequest | CombatRandomnessRequest>;
  continuations?: AuthorityContinuation[];
};

export type StepResult =
  | InitializedRulesResult
  | CommittedRulesResult
  | ConcludedRulesResult
  | AwaitingInputRulesResult
  | AwaitingRandomnessRulesResult
  | NeedsKpRulesResult
  | RejectedRulesResult;
