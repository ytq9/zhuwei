import { assemblySourceHash, isItemAssemblyChangedPayload } from "./item-assemblies";
import { isWorldFactPointer, projectWorldFact } from "./world-facts";
import type { KnowledgeIdentity } from "./knowledge-identities";
import { CLASS_RESOURCE_CATALOG } from "../../dnd/class-resources";
import { GEAR_SLOTS, type GearSlot } from "../../dnd/gear";
import { combatResourceId } from "./character-abilities";
import { heldKnowledgeRecordConform, knowledgeReviewContentConform, type KnowledgeReviewedPayload } from "./knowledge-review";
import { acquiredKnowledgeNarrationFacts, heldKnowledgeDisplayRefs, heldKnowledgeNarrationFacts } from "./knowledge-expression";
import { heldKnowledgeRecord } from "./knowledge-records";
import { socialCommitmentConform, socialCommitmentFromPayload, socialCommitmentRefs, type SocialCommitment } from "./social-commitments";
import { effectiveConditions } from "./world-effects";
import { isItemEntryV1 } from "./items";
import { canonicalSha256 } from "../profiles/canonical";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  JsonRecord,
  KnowledgeRecord,
  PublicReceipt,
} from "./model";

export const AUTHORITY_CLAIMS_SCHEMA = "zhuwei.authority-claims/vnext-1" as const;
export const RENDERABLE_CLAIMS_SCHEMA = "zhuwei.renderable-claims/vnext-1" as const;

export type ClaimBasis = Readonly<{
  /** Complete grounding retained inside the authority projection only. */
  authorityRefs: readonly string[];
  /** Grounding references that may be disclosed when the Viewer has grants. */
  viewerRefs: readonly string[];
}>;

export type ClaimVisibility =
  | Readonly<{ kind: "public" }>
  | Readonly<{ kind: "grants"; allOf: readonly string[] }>;

type ClaimMaterialBase = Readonly<{
  claimRef: string;
  basis: ClaimBasis;
  visibility: ClaimVisibility;
}>;

export type MechanicalOutcomeClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "mechanicalOutcome";
  outcomeKind?: "worldInteraction" | "observe" | "social";
  summary: string;
  outcomeCode?: string;
  actorRef?: string;
  targetRefs?: readonly string[];
  check?: Readonly<{
    kind: "abilityCheck" | "attack" | "save";
    result: "success" | "failure";
    total?: number;
    dc?: number;
  }>;
}>;

export type AbilityEffectAppliedClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "abilityEffectApplied";
  abilityRef: string;
  abilityName: string;
  sourceRef: string;
  targetRefs: readonly string[];
  effect: Readonly<{
    summary: string;
    appliesTo?: string;
    bonusDice?: string;
    duration?: string;
    concentration?: boolean;
  }>;
}>;

export type SensoryEvidenceClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "sensoryEvidence";
  observerRef: string;
  sense: "sight" | "hearing" | "smell" | "touch" | "taste" | "special";
  evidence: string;
  subjectRef?: string;
}>;

export type SourceClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "sourceClaim";
  speakerRef?: string;
  statement: string;
  acquisition?: Readonly<{ recipientRef: string; layer: "hint" | "partial" | "full" }>;
}>;

export type CharacterInferenceClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "characterInference";
  characterRef: string;
  inference: string;
  confidence?: string;
}>;

export type SceneFeatureClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "sceneFeature";
  featureRef: string;
  description: string;
  state?: string;
  interactionHint?: string;
}>;

export type NarrativeDetailClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "narrativeDetail";
  commitmentRef: string;
  description: string;
}>;

export type RelationChangedClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "relationChanged";
  relationRef: string;
  relationKind: string;
  subjectRef: string;
  objectRef: string;
  change: "began" | "ended" | "updated";
  description: string;
}>;

export type DefinitionRevisedClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "definitionRevised";
  definitionRef: string;
  definitionKind: "npc" | "item" | "worldFact" | "sceneFeature" | "worldRelation" | "location" | "passage";
  summary: string;
}>;

type InventoryClaimOperation = Readonly<{ actorRef: string }> & (
  | Readonly<{ kind: "assemble" | "disassemble"; quantity: number; assemblyRef: string; recoverable: boolean }>
  | Readonly<{ kind: "acquire"; quantity: number }>
  | Readonly<{ kind: "release"; quantity: number; releaseKind: "placement" | "drop" | "loss" }>
  | Readonly<{ kind: "transfer"; quantity: number; recipientRef: string }>
  | Readonly<{ kind: "equip"; action: "wear" | "stow" }>
  | Readonly<{ kind: "identify" }>
  | Readonly<{ kind: "lifecycle"; action: "break" | "repair" | "destroy" }>
);

/** The exact source of this operation before it ran, not its current location.
 * An unequipped held item is a pack entry in the product; no physical container
 * or scene coordinates are inferred from that classification. */
export type InventorySourceBefore =
  | Readonly<{ disposition: "held"; holderRef: string; equippedSlot: GearSlot | null }>
  | Readonly<{ disposition: "scene"; sceneRef: string }>;

export type InventoryOutcomeClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "inventoryOutcome";
  itemRef: string;
  change:
    | "materialized"
    | "acquired"
    | "transferred"
    | "used"
    | "consumed"
    | "damaged"
    | "repaired"
    | "destroyed"
    | "updated";
  summary: string;
  /** Typed, witnessed operation. Participant lists do not encode actor roles. */
  operation?: InventoryClaimOperation;
  /** Optional expression evidence, disclosed only to the original holder or
   * the actor acquiring an item from an authorized scene. */
  sourceBefore?: InventorySourceBefore;
  characterRefs?: readonly string[];
  quantity?: Readonly<{ before: number; after: number }>;
  charges?: Readonly<{ before: number | null; after: number | null }>;
  durability?: Readonly<{ before: number | null; after: number | null }>;
  state?: string;
}>;

export type ObjectiveContinuityClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "objectiveContinuity";
  objectiveRef: string;
  transition: "opened" | "advanced" | "failed" | "abandoned" | "completed" | "updated";
  summary: string;
  participantRefs?: readonly string[];
}>;

export type StoryContinuityClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "storyContinuity";
  storyRef: string;
  transition: "candidate" | "concluded" | "epilogue" | "sequel" | "updated";
  summary: string;
  characterRefs?: readonly string[];
}>;

export type PressureClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "pressure";
  description: string;
  sourceRef?: string;
}>;

export type OpportunityClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "opportunity";
  description: string;
  targetRef?: string;
  actionHint?: string;
}>;

export type ActionCommittedClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "actionCommitted";
  actorRef: string;
  status: PublicReceipt["status"];
  summary: string;
}>;

export type KnowledgeReviewClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "knowledgeReview";
}> & Pick<KnowledgeReviewedPayload, "characterId" | "inquiry" | "scope" | "records">;

export type KnowledgeAcquisitionClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "knowledgeAcquisition"; characterId: string; record: KnowledgeRecord;
}>;

export type SocialCommitmentClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "socialCommitment"; commitment: SocialCommitment;
}>;

export type ClaimMaterial =
  | SocialCommitmentClaimMaterial
  | KnowledgeAcquisitionClaimMaterial
  | KnowledgeReviewClaimMaterial
  | NarrativeDetailClaimMaterial
  | MechanicalOutcomeClaimMaterial
  | AbilityEffectAppliedClaimMaterial
  | SensoryEvidenceClaimMaterial
  | SourceClaimMaterial
  | CharacterInferenceClaimMaterial
  | SceneFeatureClaimMaterial
  | RelationChangedClaimMaterial
  | DefinitionRevisedClaimMaterial
  | InventoryOutcomeClaimMaterial
  | ObjectiveContinuityClaimMaterial
  | StoryContinuityClaimMaterial
  | PressureClaimMaterial
  | OpportunityClaimMaterial
  | ActionCommittedClaimMaterial;

export type ClaimMaterialBatch = Readonly<{
  receiptId: string;
  rootActionId: string;
  materials: readonly ClaimMaterial[];
}>;

export type FrozenAuthorityClaims = Readonly<{
  schema: typeof AUTHORITY_CLAIMS_SCHEMA;
  receiptId: string;
  rootActionId: string;
  claims: readonly ClaimMaterial[];
  authorityClaimsHash: `sha256:${string}`;
}>;

export type ViewerClaimGrants = Readonly<{
  viewerKey: string;
  refs: readonly string[];
  /** Display labels copied only from the already-built Viewer projection.
   * Authority state labels must never be supplied here. */
  displayNames?: Readonly<Record<string, string>>;
  /** Name-only authorized identities, never added to general Viewer grants. */
  knowledgeIdentities?: readonly KnowledgeIdentity[];
  /** The Viewer-safe projection used to decide these grants. Production
   * callers must pass it; pure conformance callers receive a deterministic
   * synthetic binding derived only from the Viewer grant set. */
  projectionHash?: `sha256:${string}`;
}>;

type RenderableClaimBase = Readonly<{
  claimRef: string;
  basisRefs: readonly string[];
  /** Complete Viewer-safe atomic facts that Narration must render. They are
   * derived here, never accepted in an Authority Claim or from the model. */
  narrationFacts: readonly string[];
  displayNames?: Readonly<Record<string, string>>;
}>;

export type RenderableClaim =
  | (RenderableClaimBase & Omit<SocialCommitmentClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<KnowledgeAcquisitionClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<KnowledgeReviewClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<NarrativeDetailClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<MechanicalOutcomeClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<AbilityEffectAppliedClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<SensoryEvidenceClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<SourceClaimMaterial, keyof ClaimMaterialBase> & Readonly<{
      speakerName: string;
    }>)
  | (RenderableClaimBase & Omit<CharacterInferenceClaimMaterial, keyof ClaimMaterialBase> & Readonly<{
      characterName: string;
    }>)
  | (RenderableClaimBase & Omit<SceneFeatureClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<RelationChangedClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<DefinitionRevisedClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<InventoryOutcomeClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<ObjectiveContinuityClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<StoryContinuityClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<PressureClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<OpportunityClaimMaterial, keyof ClaimMaterialBase>)
  | (RenderableClaimBase & Omit<ActionCommittedClaimMaterial, keyof ClaimMaterialBase>);

export type FrozenRenderableClaims = Readonly<{
  schema: typeof RENDERABLE_CLAIMS_SCHEMA;
  receiptId: string;
  rootActionId: string;
  viewerKey: string;
  projectionHash: `sha256:${string}`;
  claims: readonly RenderableClaim[];
  claimsHash: `sha256:${string}`;
}>;

/** A committed event range after the Rules projector has verified its
 * envelope chain, Receipt binding and folded prior/current states. */
export type VerifiedClaimCommittedRange = Readonly<{
  receipt: PublicReceipt;
  actorCharacterId: string;
  priorState: AuthoritativeWorldState;
  state: AuthoritativeWorldState;
  events: readonly EventEnvelope[];
  /** Verified by the public projector while folding the complete journal.
   * These states surround each selected event, including any intervening
   * roots. They are never accepted directly from the projection request. */
  eventStates?: ReadonlyMap<string, Readonly<{
    priorState: AuthoritativeWorldState;
    state: AuthoritativeWorldState;
  }>>;
}>;

const VNEXT_CLAIMS_ROOT_EVENT_TYPES = new Set([
  "NpcMaterialized",
  "FrozenPlayerChoicePrepared",
  "RestCompleted",
  "KnowledgeReviewed",
  "NarrativeDetailCommitted",
  "AuthoredMaterializationResolved",
  "InventoryOperationApplied",
  "ItemAssemblyChanged",
  "AtomicWorldInteractionStepsResolved",
  "SemanticDefinitionMaterialized",
  "SemanticDefinitionRevised",
  "WorldInteractionFeasibilityRuled",
  "WorldInteractionResolved",
]);

const VNEXT_DIRECT_CLAIM_EVENT_TYPES = new Set([
  "NpcMaterialized",
  "ActivityAttentionRequested", "ActivityAttentionAcknowledged",
  "RelationshipChanged", "PromiseMade", "DebtIncurred",
  "PartyMemberLeft", "PartyLeaderTransferred", "PartyGroupDisbanded",
  "ActivityCompleted", "RestCompleted", "KnowledgeAcquired", "CharacterMoved",
  "KnowledgeReviewed",
  "NarrativeDetailCommitted",
  "ItemIdentified", "InventoryOperationApplied", "ItemAssemblyChanged", "EffectApplied", "EffectEnded", "ConditionChanged",
  "ConditionStateSynchronized", "HealingResolved", "TemporaryHitPointsGranted", "FictionTimeAdvanced",
  "ConcentrationStarted", "ConcentrationEnded", "ConcentrationTested",
  "SpellResolved", "SpellCountered",
  "SemanticDefinitionMaterialized",
  "SemanticDefinitionRevised",
  "WorldInteractionFeasibilityRuled",
  "WorldInteractionResolved",
  "AbilityInvoked",
  "ImprovisedCheckResolved",
  "ContestResolved",
  "DamagePacketResolved",
  "HitPointsChanged",
  "CreatureDied",
  "ResourceSpent",
  "ResourceReserved",
  "ResourceChanged",
  "ResourceUsed",
  "SensoryEvidenceAcquired",
  "SourceClaimCreated",
  "CharacterInferenceFormed",
  "ItemUsed",
  "ItemAcquired",
  "ItemTransferred",
  "ItemMaterialized",
  "SceneQuestionOpened",
  "SceneQuestionAnswered",
  "ChapterStarted",
  "ChapterConcluded",
  "StoryConcluded",
  "EpilogueChoiceRecorded",
  "SequelStarted",
]);

const VNEXT_NON_RENDERABLE_LEDGER_EVENT_TYPES = new Set([
  // Choice metadata is delivered through the private Pending projection.
  // The selected executor's child events own every mechanical/narrative fact.
  "FrozenPlayerChoicePrepared", "FrozenPlayerChoiceInputRecorded", "ActivityCompletionInputRecorded", "PlayerChoiceRequested", "PendingInputAnswered",
  "NarrativeDetailMaterialized",
  "AuthoredMaterializationResolved", "DefinitionRegistered", "ItemDefinitionRegistered", "ItemUniquenessBound",
  "ActivityStarted", "CharacterMechanicsSynchronized",
  "AtomicWorldInteractionStepsResolved",
  "AtomicWorldInteractionSuspended", "AtomicWorldInteractionResumed",
  "CombatPendingOpened", "CombatPendingClosed", "ReactionOpportunityOpened", "ReactionOffered", "ReactionAnswered",
  "SpellCastingStarted",
  "CanonicalFactDeclared",
  "DiceRolled",
  "RandomnessRequested",
]);

const ACTOR_PLAN_PRIVATE_LEDGER_EVENT_TYPES = new Set([
  "NpcActionCommitted", "NpcPlanRevised", "NpcPlanCancelled",
  "FactionActionCommitted", "FactionPlanAdvanced", "CheckFrozen",
]);

function isActorPlanDueRoot(rootActionId: unknown): boolean {
  return typeof rootActionId === "string" && rootActionId.startsWith("actor-plan-due:");
}

/** Lifecycle bookkeeping has no implied observer. Actual knowledge acquisition
 * remains the only route from a private verdict to Viewer claims. */
function isPrivatePromiseLedgerEvent(event: EventEnvelope, range: VerifiedClaimCommittedRange): boolean {
  const p = recordOrEmpty(event.payload);
  if (event.eventType === "PromiseChanged") {
    const life = recordOrEmpty(range.state.campaignRuntime.promises[String(p.promiseId)]?.lifecycle);
    return event.secrecy === "internal" && event.visibilityPolicyId === "visibility:room-authority-only"
      && Array.isArray(life.changes) && life.changes.some(change => recordOrEmpty(change).eventId === event.eventId);
  }
  if (event.eventType === "CanonicalFactDeclared" && recordOrEmpty(p.fact).kind === "promiseTermsResult")
    return event.secrecy === "internal" && event.visibilityPolicyId === "visibility:hidden-until-evidence"
      && range.events.some(candidate => candidate.eventType === "PromiseChanged" && candidate.rootActionId === event.rootActionId);
  if (event.eventType === "PromiseTermsEstablished" || event.eventType === "PromiseReviewed") {
    const life = recordOrEmpty(range.state.campaignRuntime.promises[String(p.promiseId)]?.lifecycle);
    return event.secrecy === "internal" && event.visibilityPolicyId === "visibility:room-authority-only"
      && (event.eventType === "PromiseTermsEstablished" ? life.formedByEventId === event.eventId
        : Array.isArray(life.history) && life.history.some(h => recordOrEmpty(h).committedByEventId === event.eventId));
  }
  if (event.eventType === "NpcWorkProposed" || event.eventType === "NpcWorkStarted" || event.eventType === "NpcWorkDecision") {
    const plan = range.state.campaignRuntime.npcPlans[String(p.planId)];
    return plan?.schema === "zhuwei.npc-work/vnext-1" && event.secrecy === "private"
      && event.visibilityPolicyId === `visibility:knowledge-holder:${plan.npcId}`;
  }
  return event.eventType === "CanonicalFactDeclared" && recordOrEmpty(p.fact).kind === "promiseReviewResult"
    && event.secrecy === "internal" && event.visibilityPolicyId === "visibility:hidden-until-evidence"
    && range.events.some(candidate => candidate.eventType === "PromiseReviewed" && candidate.rootActionId === event.rootActionId);
}

/** A plan's decision, Activity and optional faction record are one private
 * formation family. Their existence is never itself a public action claim. */
function isPrivateActorPlanFormationEvent(event: EventEnvelope, range: VerifiedClaimCommittedRange): boolean {
  if (event.secrecy !== "internal") return false;
  const formation = range.events.find(candidate => {
    if (candidate.rootActionId !== event.rootActionId || candidate.eventType !== "NpcPlanFormed" || candidate.secrecy !== "internal") return false;
    const plan = recordOrEmpty(candidate.payload), activity = recordOrEmpty(plan.activity);
    if (candidate.visibilityPolicyId !== `visibility:npc:${plan.npcId}`) return false;
    const started = range.events.some(start => {
      const payload = recordOrEmpty(start.payload), completion = recordOrEmpty(payload.completion);
      return start.eventType === "ActivityStarted" && start.rootActionId === candidate.rootActionId
        && start.secrecy === "internal" && start.visibilityPolicyId === candidate.visibilityPolicyId
        && payload.characterId === plan.npcId && payload.activityId === activity.activityId
        && payload.activityKind === activity.activityKind && payload.intendedDurationMicros === activity.intendedDurationMicros
        && completion.kind === "actorPlan" && completion.planId === plan.planId;
    });
    if (!started) return false;
    if (plan.factionRef !== null && !range.events.some(faction => {
      const payload = recordOrEmpty(faction.payload);
      return faction.eventType === "FactionPlanFormed" && faction.rootActionId === candidate.rootActionId
        && faction.secrecy === "internal" && faction.visibilityPolicyId === candidate.visibilityPolicyId
        && payload.planId === plan.planId && payload.factionId === plan.factionRef && payload.actingNpcId === plan.npcId
        && payload.revision === plan.revision && payload.status === plan.status
        && canonicalSha256(payload.premiseRefs) === canonicalSha256(plan.premiseRefs)
        && canonicalSha256(payload.resourceRefs) === canonicalSha256(plan.resourceRefs);
    })) return false;
    const payload = recordOrEmpty(event.payload);
    if (event.eventType === "NpcPlanFormed") return event.eventId === candidate.eventId;
    if (event.eventType === "ActivityStarted") return payload.activityId === activity.activityId;
    if (event.eventType === "FactionPlanFormed") return plan.factionRef !== null && payload.factionId === plan.factionRef
      && payload.planId === plan.planId && payload.actingNpcId === plan.npcId && event.visibilityPolicyId === candidate.visibilityPolicyId;
    return false;
  });
  return formation !== undefined;
}

/** A cancellation's Activity interruption is private lifecycle bookkeeping.
 * Other interruption effects must still acquire their own explicit mapping. */
function isPrivateActorPlanLedgerEvent(event: EventEnvelope, range: VerifiedClaimCommittedRange): boolean {
  if (!isActorPlanDueRoot(event.rootActionId)) return false;
  if (event.eventType === "MeaningfulFailureCommitted") return isActorPlanFailureLedger(event, range);
  if (event.secrecy !== "internal") return false;
  if (ACTOR_PLAN_PRIVATE_LEDGER_EVENT_TYPES.has(event.eventType)) return true;
  if (event.eventType !== "ActivityInterrupted") return false;
  const payload = recordOrEmpty(event.payload), cause = recordOrEmpty(payload.cause);
  const activityId = stringField(payload, "activityId");
  const activity = activityId === undefined ? undefined : completedActivity(range, activityId);
  const completion = recordOrEmpty(activity?.completion);
  return cause.kind === "actorPlanCancelled" && completion.kind === "actorPlan"
    && completion.planId === cause.planId && range.events.some(candidate => candidate.eventType === "NpcPlanCancelled"
      && recordOrEmpty(candidate.payload).planId === cause.planId);
}

/** This generated marker records the same failed check and child effects.
 * Its goal/method metadata is not a new public consequence. An unrelated
 * failure payload still requires a dedicated Claims mapping. */
function isActorPlanFailureLedger(event: EventEnvelope, range: VerifiedClaimCommittedRange): boolean {
  const payload = recordOrEmpty(event.payload), consequences = recordOrEmpty(payload.consequences);
  const requestEvent = range.events.find(candidate => candidate.eventType === "RandomnessRequested"
    && candidate.resolutionId === event.resolutionId);
  const plan = recordOrEmpty(recordOrEmpty(requestEvent?.payload).resolutionPlan);
  const checkEvent = range.events.find(candidate => candidate.eventType === "ImprovisedCheckResolved"
    && candidate.resolutionId === event.resolutionId);
  const checked = recordOrEmpty(checkEvent?.payload), request = recordOrEmpty(checked.request);
  return requestEvent !== undefined && checkEvent !== undefined && checked.succeeded === false
    && request.actorCharacterId === payload.characterId && plan.actorCharacterId === payload.characterId
    && payload.goalId === `goal:${event.rootActionId}`
    && payload.factualCause === `resolution:${event.resolutionId}:failed`
    && payload.methodFingerprint === plan.method && hasClosedKeys(consequences, ["effectKinds"])
    && Array.isArray(plan.failureEffects) && plan.failureEffects.every(isRecord)
    && canonicalSha256(consequences.effectKinds) === canonicalSha256(plan.failureEffects.map(effect => effect.kind));
}

/**
 * Stage-three is an isolated mixed manifest: its two new vertical slices use
 * FrozenRenderableClaims while inherited product-0.4 actions keep their
 * existing observer-projection contract. Routing is based on an explicit
 * committed event family, never on whether Claims happened to build or fail.
 */
export function committedRangeUsesFrozenRenderableClaims(
  events: readonly Readonly<{ eventType: unknown; rootActionId?: unknown; payload?: unknown }>[],
): boolean {
  return events.some(({ eventType, rootActionId, payload }) =>
    typeof eventType === "string" && (VNEXT_CLAIMS_ROOT_EVENT_TYPES.has(eventType)
      || ["PromiseTermsEstablished", "PromiseReviewed", "PromiseChanged", "NpcWorkProposed", "NpcWorkStarted", "NpcWorkDecision"].includes(eventType)
      || (eventType === "NpcPlanFormed" && events.some(event => event.eventType === "ActivityStarted"
        && event.rootActionId === rootActionId && recordOrEmpty(recordOrEmpty(event.payload).completion).kind === "actorPlan"
        && recordOrEmpty(recordOrEmpty(event.payload).completion).planId === recordOrEmpty(payload).planId))
      || (eventType === "ActivityStarted" && ["timePassage", "actionExecution"].includes(String(recordOrEmpty(recordOrEmpty(payload).completion).kind)))
      || ["ActivityAttentionRequested", "ActivityAttentionAcknowledged"].includes(eventType)
      || (eventType === "AbilityInvoked" && ["longSpellcastingStarted", "longSpellcastingContinued"].includes(String(recordOrEmpty(recordOrEmpty(payload).mechanicalResult).kind)))
      || (eventType === "ConcentrationEnded" && recordOrEmpty(payload).reason === "longSpellActivityInterrupted")
      || (typeof rootActionId === "string" && (rootActionId.startsWith("time-passage-advance:")
        || rootActionId.startsWith("time-passage-interrupt:") || rootActionId.startsWith("long-spell-advance:")
        || rootActionId.startsWith("long-spell-due:") || rootActionId.startsWith("activity-advance:") || rootActionId.startsWith("activity-result:")))
      || isActorPlanDueRoot(rootActionId)
      || (eventType === "ActivityCompleted" && typeof rootActionId === "string"
        && rootActionId.startsWith("activity-due:"))))
    || (events.length > 0 && events.every(({ eventType }) => typeof eventType === "string"
      && ["KnowledgeAcquired", "SourceClaimCreated", "RelationshipChanged", "PromiseMade", "DebtIncurred"].includes(eventType)));
}

/**
 * Pure event/projection-material seam. Callers provide already typed facts;
 * this function snapshots them before any Viewer-specific permission trimming.
 */
export function deriveAuthorityClaims(batch: ClaimMaterialBatch): FrozenAuthorityClaims {
  requireRef(batch.receiptId, "receiptId");
  requireRef(batch.rootActionId, "rootActionId");
  if (!Array.isArray(batch.materials)) throw new TypeError("CLAIM_MATERIALS_ARRAY_REQUIRED");
  const claims = batch.materials.map((material) => cloneAndValidateMaterial(material));
  const claimRefs = new Set<string>();
  for (const claim of claims) {
    if (claimRefs.has(claim.claimRef)) throw new TypeError("CLAIM_REF_DUPLICATE");
    claimRefs.add(claim.claimRef);
  }
  const core = {
    schema: AUTHORITY_CLAIMS_SCHEMA,
    receiptId: batch.receiptId,
    rootActionId: batch.rootActionId,
    claims,
  } as const;
  return deepFreeze({
    ...core,
    authorityClaimsHash: canonicalSha256(core),
  });
}

/**
 * The production Authority-claim builder. It interprets only an already
 * verified committed event range plus its exact prior/current states; callers
 * cannot supply narration material or a state diff as a second fact source.
 */
export function deriveAuthorityClaimsFromCommittedRange(
  range: VerifiedClaimCommittedRange,
): FrozenAuthorityClaims {
  validateClaimCommittedRange(range);
  const materials: ClaimMaterial[] = [];
  const requireClosedVNextCoverage = committedRangeUsesFrozenRenderableClaims(range.events);
  const hasDedicatedSensoryEvidence = range.events.some((event) =>
    event.eventType === "SensoryEvidenceAcquired");

  for (const event of range.events) {
    const eventState = range.eventStates?.get(event.eventId);
    if (range.eventStates !== undefined && eventState === undefined) throw new TypeError("CLAIM_EVENT_STATE_MISSING");
    const eventRange: VerifiedClaimCommittedRange = eventState === undefined ? range : { ...range, ...eventState };
    const payload = recordOrEmpty(event.payload);
    const eventType = String(event.eventType);
    const materialCountBeforeEvent = materials.length;
    switch (eventType) {
      case "ActivityStarted": {
        if (recordOrEmpty(payload.completion).kind !== "actionExecution") break;
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "activity-started", { authorityRefs: [String(payload.activityId)] }),
          kind: "mechanicalOutcome", targetRefs: [String(payload.characterId)], outcomeCode: "activityStarted",
          summary: "角色开始进行这项耗时活动；完成结果尚未结算。" });
        break;
      }
      case "ActivityAttentionRequested":
      case "ActivityAttentionAcknowledged": {
        const activity = eventRange.state.campaignRuntime.activities[String(payload.activityId)];
        if (activity === undefined) throw new TypeError("ACTIVITY_ATTENTION_CLAIM_INVALID");
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "activity-attention", { authorityRefs: [String(payload.activityId)] }),
          kind: "mechanicalOutcome", targetRefs: [String(activity.characterId)], outcomeCode: eventType,
          summary: eventType === "ActivityAttentionRequested" ? "角色获得了新信息，活动推进暂停，等待玩家决定。活动尚未取消，也未获得完成收益。"
            : "玩家选择继续当前活动；后续时间和结果仍待实际结算。" });
        break;
      }
      case "CanonicalFactDeclared": {
        const fact = recordOrEmpty(payload.fact);
        if (fact.kind === "npcPlanTrace") materials.push(actorPlanTraceClaim(event, fact, eventRange));
        break;
      }
      case "RelationshipChanged":
      case "PromiseMade":
      case "DebtIncurred": {
        const commitment = socialCommitmentFromPayload(eventType, payload);
        if (commitment === undefined) throw new TypeError("SOCIAL_COMMITMENT_CLAIM_INVALID");
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "social-commitment", {
          authorityRefs: [...socialCommitmentRefs(commitment), ...stringRefs(payload.basisFactIds)],
          viewerRefs: socialCommitmentRefs(commitment),
          // A grant for some other relationship or promise is insufficient.
          requiredViewerRefs: [event.eventId],
        }), kind: "socialCommitment", commitment });
        break;
      }
      case "PartyMemberLeft":
      case "PartyLeaderTransferred":
      case "PartyGroupDisbanded": {
        const actorRef = eventType === "PartyMemberLeft" ? stringField(payload, "characterId")
          : eventType === "PartyLeaderTransferred" ? stringField(payload, "toCharacterId") : range.actorCharacterId;
        if (actorRef === undefined || stringField(payload, "groupId") === undefined) break;
        materials.push({ ...eventClaimBase(event, "party-lifecycle"), kind: "mechanicalOutcome", targetRefs: [actorRef],
          outcomeCode: eventType, summary: eventType === "PartyMemberLeft" ? "该角色已离开原队伍，单独行动。"
            : eventType === "PartyLeaderTransferred" ? "该角色已接任原队伍的队长。" : "原队伍已解散。" });
        break;
      }
      case "ActivityInterrupted":
        if (timePassageActivity(eventRange, payload.activityId) !== undefined) materials.push(timePassageEndedClaim(event, payload, eventRange));
        else if (longSpellcastingActivity(eventRange, payload.activityId) !== undefined) materials.push(longSpellcastingEndedClaim(event, payload, eventRange));
        else if (["completionNoLongerLegal", "playerCancelledActivity"].includes(String(recordOrEmpty(payload.cause).kind))) materials.push(activityInterruptedClaim(event, payload, eventRange));
        break;
      case "ActivityCompleted":
        materials.push(timePassageActivity(eventRange, payload.activityId) !== undefined
          ? timePassageEndedClaim(event, payload, eventRange) : longSpellcastingActivity(eventRange, payload.activityId) !== undefined
            ? longSpellcastingEndedClaim(event, payload, eventRange) : activityCompletedClaim(event, payload, eventRange));
        break;
      case "RestCompleted":
        materials.push(...restCompletedClaims(event, payload, eventRange));
        break;
      case "CharacterMechanicsSynchronized":
        // Rest recovery owns the changes. This event mirrors that result into
        // the combat representation; an unrelated synchronization is not a
        // non-renderable ledger and must never silently hide its effects.
        if (requireClosedVNextCoverage) materials.push(...restMechanicsMirrorClaims(event, payload, eventRange));
        break;
      case "KnowledgeAcquired":
        materials.push(...knowledgeAcquiredClaims(event, payload, eventRange));
        break;
      case "CharacterMoved":
        materials.push(...characterMovedClaims(event, payload, eventRange));
        break;
      case "KnowledgeReviewed": {
        const reviewed = event.payload as KnowledgeReviewedPayload;
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "knowledge-review", {
          authorityRefs: [`knowledge-catalog:${reviewed.characterId}`, ...reviewed.records.map(record => `knowledge:${reviewed.characterId}:${record.knowledgeRef}`)],
          viewerRefs: reviewed.records.map(record => record.knowledgeRef),
        }), kind: "knowledgeReview", characterId: reviewed.characterId, inquiry: reviewed.inquiry,
          scope: reviewed.scope, records: structuredClone(reviewed.records) });
        break;
      }
      case "NarrativeDetailCommitted": {
        const detail = recordOrEmpty(payload.detail);
        const commitmentRef = stringField(payload, "commitmentRef");
        const description = stringField(detail, "description");
        if (commitmentRef === undefined || description === undefined) throw new TypeError("NARRATIVE_DETAIL_CLAIM_INVALID");
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "narrative-detail", {
          authorityRefs: stringRefs(detail.basisRefs), viewerRefs: [commitmentRef], requiredViewerRefs: [commitmentRef],
        }), kind: "narrativeDetail", commitmentRef, description });
        break;
      }
      case "SemanticDefinitionMaterialized":
        materials.push(...semanticDefinitionMaterializationClaims(event, payload));
        break;
      case "NpcMaterialized": {
        const plan = (event.payload as import("./npc-materialization").NpcMaterializedPayload).plan;
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "npc-identity", {
          authorityRefs: [plan.prospectiveRef, plan.contextHash], viewerRefs: [plan.prospectiveRef],
          requiredViewerRefs: [plan.prospectiveRef], materialVisibilityPolicyRef: plan.visibilityPolicyRef,
        }), kind: "sceneFeature", featureRef: plan.prospectiveRef, description: plan.source.description });
        break;
      }
      case "SemanticDefinitionRevised":
        materials.push(...semanticDefinitionRevisionClaims(
          event,
          payload,
          eventRange,
        ));
        break;
      case "WorldInteractionFeasibilityRuled":
        materials.push(...worldInteractionFeasibilityClaims(event, payload, eventRange));
        break;
      case "WorldInteractionResolved":
        materials.push(...worldInteractionClaims(
          event,
          payload,
          eventRange,
          !hasDedicatedSensoryEvidence,
        ));
        break;
      case "ItemIdentified": {
        const itemRef = stringField(payload, "entryRef"), characterRef = stringField(payload, "characterId");
        const definitionRef = stringField(payload, "definitionRef");
        const definition = definitionRef === undefined ? undefined : eventRange.state.campaignRuntime.itemSystem.definitions[definitionRef];
        if (itemRef && characterRef && definition && canonicalSha256(definition) === payload.definitionHash) materials.push({
          ...eventClaimBaseWithSeparatedBasis(event, "item-identified", { authorityRefs: [definitionRef], viewerRefs: [itemRef] }),
          kind: "inventoryOutcome", itemRef, change: "updated", characterRefs: [characterRef],
          summary: `${definition.content.label}：${definition.content.description}`, state: "已识别",
        });
        break;
      }
      case "ItemAssemblyChanged": {
        materials.push(...itemAssemblyClaims(event, payload, eventRange));
        break;
      }
      case "InventoryOperationApplied": {
        materials.push(...inventoryOperationClaims(event, payload, eventRange));
        break;
      }
      case "SpellResolved":
      case "SpellCountered": {
        const sourceRef = stringField(payload,"sourceEntityId");
        const abilityRef = stringField(payload,"abilityRef");
        if (sourceRef === undefined || abilityRef === undefined) break;
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event,"spell-outcome",{
          authorityRefs:[abilityRef,stringField(payload,"castId")],viewerRefs:[sourceRef],
        }),kind:"mechanicalOutcome",actorRef:sourceRef,outcomeCode:eventType,
          summary:eventType==="SpellCountered"?"该角色的施法被反制。":"该角色的施法已完成结算。" });
        break;
      }
      case "EffectApplied":
      case "EffectEnded": {
        const claim = conditionEffectClaim(event, payload, eventRange);
        if (claim !== undefined) materials.push(claim);
        break;
      }
      case "ConditionChanged": {
        materials.push(...nativeConditionClaims(event, payload, eventRange));
        break;
      }
      case "ConditionStateSynchronized": {
        const targetRef=stringField(payload,"characterId");
        const hp=isRecord(payload.hitPoints)&&isRecord(payload.hitPoints.after)?payload.hitPoints.after:undefined;
        if(targetRef===undefined||hp===undefined)break;
        materials.push({...eventClaimBase(event,"condition-consequences",[targetRef]),kind:"mechanicalOutcome",
          targetRefs:[targetRef],outcomeCode:"conditionConsequences",
          summary:`状态效果后生命值为 ${hp.current}/${hp.maximum}。${Array.isArray(payload.droppedEntryRefs)&&payload.droppedEntryRefs.length>0?`手持的 ${payload.droppedEntryRefs.length} 件物品掉落。`:""}`});
        break;
      }
      case "HealingResolved":
      case "TemporaryHitPointsGranted": {
        const targetRef = stringField(payload, "entityId");
        const before = finiteNumber(payload.before), after = finiteNumber(payload.after);
        if (targetRef === undefined || before === undefined || after === undefined) break;
        const consequences: string[] = [];
        // Only a verified event frame proves what this healing changed. A
        // whole-root before/after pair could include another event's waking.
        const frame = eventState ?? (range.events.length === 1 ? range : undefined);
        const priorEntity = frame?.priorState.combatRuntime?.entities[targetRef];
        const nextEntity = frame?.state.combatRuntime?.entities[targetRef];
        if (eventType === "HealingResolved" && frame !== undefined && priorEntity !== undefined && nextEntity !== undefined) {
          const priorConditions = effectiveConditions(frame.priorState, targetRef);
          const nextConditions = effectiveConditions(frame.state, targetRef);
          if (priorConditions.unconscious === true && nextConditions.unconscious !== true) consequences.push("目标的昏迷已结束。");
          if (priorEntity.lifeState !== nextEntity.lifeState) {
            const labels: Readonly<Record<string, string>> = { alive: "存活", conscious: "清醒", unconscious: "昏迷", dead: "死亡" };
            const prior = labels[String(priorEntity.lifeState)], next = labels[String(nextEntity.lifeState)];
            if (prior === undefined || next === undefined) throw new TypeError("HEALING_LIFE_STATE_CLAIM_UNMAPPED");
            consequences.push(`目标的生命状态由 ${prior} 变为 ${next}。`);
          }
        }
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "recovery", { authorityRefs: [stringField(payload, "sourceDefinitionId")] }),
          kind: "mechanicalOutcome", targetRefs: [targetRef], outcomeCode: eventType === "HealingResolved" ? "healed" : "temporaryHitPointsGranted",
          summary: `目标的${eventType === "HealingResolved" ? "生命值" : "临时生命值"}由 ${before} 变为 ${after}。${eventType === "HealingResolved" ? `本次实际恢复了 ${after - before} 点生命值。` : ""}${consequences.join("")}` });
        // An observed healing event does not authorize the target's private
        // maximum HP. Freeze its explanation from this event's frame only,
        // and expose it through the existing character-controller grant.
        const priorHp = recordOrEmpty(priorEntity?.hitPoints), nextHp = recordOrEmpty(nextEntity?.hitPoints);
        const priorMaximum = finiteNumber(priorHp.maximum);
        const nextMaximum = finiteNumber(nextHp.maximum);
        if (eventType === "HealingResolved" && priorMaximum !== undefined && nextMaximum !== undefined
          && finiteNumber(priorHp.current) === before && finiteNumber(nextHp.current) === after) {
          materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "healing-capacity", {
            materialVisibilityPolicyRef: `visibility:character-controller:${targetRef}`,
          }), kind: "mechanicalOutcome", targetRefs: [targetRef], outcomeCode: "healingCapacity",
          summary: `治疗前生命值为 ${before}/${priorMaximum}，治疗后生命值为 ${after}/${nextMaximum}。${before === priorMaximum ? "治疗前生命值已达到上限。" : ""}` });
        }
        break;
      }
      case "FictionTimeAdvanced": {
        // Pure passage progress remains in the authority journal and Viewer
        // activity clock. Its final lifecycle claim owns the total elapsed time.
        if (isTimePassageProgressEvent(event, eventRange) || isLongSpellcastingTimeProgressEvent(event, eventRange)) break;
        const duration = microsecondsText(payload.durationMicros);
        if (duration === undefined) break;
        materials.push({ ...eventClaimBase(event, "fiction-time"), kind: "mechanicalOutcome", actorRef: range.actorCharacterId,
          outcomeCode: "fictionTimeAdvanced", summary: `本次行动推进了 ${duration} 秒虚构时间。` });
        break;
      }
      case "ConcentrationStarted":
      case "ConcentrationEnded":
      case "ConcentrationTested": {
        const targetRef = stringField(payload, "entityId");
        if (targetRef === undefined || (eventType === "ConcentrationTested" && typeof payload.succeeded !== "boolean")) break;
        materials.push({ ...eventClaimBaseWithSeparatedBasis(event, "concentration", { authorityRefs: [stringField(payload, "causeFactId")] }),
          kind: "mechanicalOutcome", targetRefs: [targetRef], outcomeCode: eventType,
          summary: eventType === "ConcentrationStarted" ? "目标开始维持专注。" : eventType === "ConcentrationEnded" ? "目标的专注已经结束。"
            : payload.succeeded ? "目标通过专注豁免并保持专注。" : "目标未通过专注豁免。" });
        break;
      }
      case "AbilityInvoked": {
        const mechanicalKind = recordOrEmpty(payload.mechanicalResult).kind;
        const claim = mechanicalKind === "longSpellcastingStarted" || mechanicalKind === "longSpellcastingContinued"
          ? longSpellcastingInvestmentClaim(event, payload, eventRange) : abilityEffectClaim(event, payload, eventRange);
        if (claim !== undefined) materials.push(claim);
        break;
      }
      case "ImprovisedCheckResolved": {
        const request = isRecord(payload.request) ? payload.request : {};
        const frozenCheck = recordOrEmpty(request.frozenCheck);
        const actorRef = stringField(request, "actorCharacterId") ?? range.actorCharacterId;
        materials.push({
          ...eventClaimBase(event, "check", stringRefs(request.basisRefs)),
          kind: "mechanicalOutcome",
          actorRef,
          outcomeCode: stringField(payload, "outcome"),
          summary: stringField(payload, "outcome")
            ?? (payload.succeeded === true ? "检定成功。" : "检定失败。"),
          check: {
            kind: frozenCheck.kind === "savingThrow" ? "save" : "abilityCheck",
            result: payload.succeeded === true ? "success" : "failure",
            ...(finiteNumber(payload.total) === undefined ? {} : { total: finiteNumber(payload.total) }),
            ...(finiteNumber(frozenCheck.dc) === undefined ? {} : { dc: finiteNumber(frozenCheck.dc) }),
          },
        });
        break;
      }
      case "ContestResolved": {
        const initiatorRef = stringField(payload, "initiatorId");
        const defenderRef = stringField(payload, "defenderId");
        if (initiatorRef === undefined || defenderRef === undefined) break;
        materials.push({
          ...eventClaimBase(event, "contest"),
          kind: "mechanicalOutcome",
          actorRef: initiatorRef,
          targetRefs: [defenderRef],
          outcomeCode: stringField(payload, "outcome"),
          summary: stringField(payload, "outcome") ?? "对抗已经结算。",
        });
        break;
      }
      case "DamagePacketResolved": {
        const targetRef = stringField(payload, "targetId") ?? stringField(payload,"targetEntityId");
        if (targetRef === undefined) break;
        const amount = finiteNumber(payload.amount) ?? finiteNumber(payload.totalApplied);
        const damageType = stringField(payload, "damageType");
        materials.push({
          ...eventClaimBase(event, "damage", [stringField(payload, "sourceDefinitionId")]),
          kind: "mechanicalOutcome",
          targetRefs: [targetRef],
          outcomeCode: "damageApplied",
          summary: amount === undefined
            ? "目标承受了伤害。"
            : `目标承受了 ${amount}${damageType === undefined ? "" : ` 点 ${damageType}`}伤害。`,
        });
        break;
      }
      case "HitPointsChanged": {
        const targetRef = stringField(payload, "characterId");
        const before = finiteNumber(payload.before);
        const after = finiteNumber(payload.after);
        if (targetRef === undefined || before === undefined || after === undefined) break;
        materials.push({
          ...eventClaimBase(event, "hit-points", [stringField(payload, "causeId")]),
          kind: "mechanicalOutcome",
          targetRefs: [targetRef],
          outcomeCode: "hitPointsChanged",
          summary: `目标的生命值由 ${before} 变为 ${after}。`,
        });
        break;
      }
      case "CreatureDied": {
        const targetRef = stringField(payload, "characterId");
        if (targetRef === undefined) break;
        materials.push({
          ...eventClaimBase(event, "death", [stringField(payload, "causeId")]),
          kind: "mechanicalOutcome",
          targetRefs: [targetRef],
          outcomeCode: "died",
          summary: "目标已经死亡。",
        });
        break;
      }
      case "ResourceSpent":
      case "ResourceReserved":
      case "ResourceChanged":
      case "ResourceUsed": {
        const actorRef = stringField(payload, "entityId") ?? stringField(payload, "characterId");
        const resourceRef = stringField(payload, "resourceId");
        if (actorRef === undefined || resourceRef === undefined) break;
        const frame = eventState ?? (range.events.length === 1 ? range : undefined);
        const after = finiteNumber(payload.resourceAfter) ?? finiteNumber(payload.after)
          ?? finiteNumber(frame?.state.entities[actorRef]?.resources?.[resourceRef]);
        const amount = eventType === "ResourceChanged" ? undefined : finiteNumber(payload.amount);
        const label = resourceDisplayName(resourceRef) ?? "该资源";
        materials.push({
          ...eventClaimBase(event, `resource:${resourceRef}`),
          kind: "mechanicalOutcome",
          actorRef,
          outcomeCode: "resourceChanged",
          summary: amount !== undefined
            ? `${label}消耗了 ${amount}。${after === undefined ? "" : `${label}的剩余数量为 ${after}。`}`
            : after === undefined
            ? `${label}已经消耗。`
            : `${label}的剩余数量为 ${after}。`,
        });
        break;
      }
      case "SensoryEvidenceAcquired": {
        const observerRef = stringField(payload, "characterId");
        const evidence = stringField(payload, "publicEvidence");
        if (observerRef === undefined || evidence === undefined) break;
        materials.push({
          ...eventClaimBase(event, "sensory", [stringField(payload, "factId")]),
          kind: "sensoryEvidence",
          observerRef,
          sense: canonicalSense(payload.sense),
          evidence,
          ...(stringField(payload, "factId") === undefined
            ? {}
            : { subjectRef: stringField(payload, "factId") }),
        });
        break;
      }
      case "SourceClaimCreated": {
        const speakerRef = stringField(payload, "speakerId");
        const statement = stringField(payload, "semanticContent");
        if (speakerRef === undefined || statement === undefined) break;
        materials.push({
          ...eventClaimBase(event, "source-claim", [stringField(payload, "claimId")]),
          kind: "sourceClaim",
          speakerRef,
          statement,
        });
        break;
      }
      case "CharacterInferenceFormed": {
        const characterRef = stringField(payload, "characterId");
        const inference = stringField(payload, "conclusion");
        const confidence = stringField(payload, "confidence");
        if (characterRef === undefined || inference === undefined) break;
        materials.push({
          ...eventClaimBase(event, "inference", stringRefs(payload.evidenceRefs)),
          kind: "characterInference",
          characterRef,
          inference,
          ...(confidence === undefined ? {} : { confidence }),
        });
        break;
      }
      case "ItemUsed":
      case "ItemAcquired":
      case "ItemTransferred":
      case "ItemMaterialized": {
        const claim = inventoryEventClaim(event, payload, eventType);
        if (claim !== undefined) materials.push(claim);
        break;
      }
      case "SceneQuestionOpened":
      case "SceneQuestionAnswered":
      case "ChapterStarted":
      case "ChapterConcluded": {
        const claim = objectiveEventClaim(event, payload, eventType);
        if (claim !== undefined) materials.push(claim);
        break;
      }
      case "StoryConcluded":
      case "EpilogueChoiceRecorded":
      case "SequelStarted": {
        const claim = storyEventClaim(event, payload, eventType);
        if (claim !== undefined) materials.push(claim);
        break;
      }
      case "AtomicWorldInteractionStepsResolved":
        // The settlement ledger is authority-private. Its child events own
        // every fact that may become a Viewer claim.
        break;
    }
    if (requireClosedVNextCoverage) {
      if (VNEXT_DIRECT_CLAIM_EVENT_TYPES.has(eventType)
        && materials.length === materialCountBeforeEvent
        && !isTimePassageProgressEvent(event, eventRange) && !isLongSpellcastingTimeProgressEvent(event, eventRange)) {
        throw new TypeError(`VNEXT_CLAIM_EVENT_UNMAPPED:${eventType}`);
      }
      if (!VNEXT_DIRECT_CLAIM_EVENT_TYPES.has(eventType)
        && !VNEXT_NON_RENDERABLE_LEDGER_EVENT_TYPES.has(eventType)
        && !isPrivateActorPlanLedgerEvent(event, eventRange)
        && !isPrivateActorPlanFormationEvent(event, range)
        && !isPrivatePromiseLedgerEvent(event, eventRange)
        && !(eventType === "ActivityInterrupted" && materials.length > materialCountBeforeEvent)) {
        throw new TypeError(`VNEXT_CLAIM_EVENT_UNKNOWN:${eventType}`);
      }
    }
  }

  const definitionEvents = range.events.filter(event => !["FrozenPlayerChoicePrepared", "FrozenPlayerChoiceInputRecorded", "ActivityCompletionInputRecorded",
    "PlayerChoiceRequested", "PendingInputAnswered", "AtomicWorldInteractionStepsResolved"].includes(event.eventType));
  const privateDefinitionOnly = definitionEvents.some((event) => String(event.eventType) === "AuthoredMaterializationResolved"
    && ["abilityDefinition", "hazardDefinition", "itemDefinition"].includes(String(recordOrEmpty(event.payload).kind)))
    && definitionEvents.every((event) => ["AuthoredMaterializationResolved", "DefinitionRegistered", "ItemDefinitionRegistered"].includes(String(event.eventType)));
  const preparedChoice = range.events.find(event => event.eventType === "FrozenPlayerChoicePrepared")?.payload as
    EventPayloadByType["FrozenPlayerChoicePrepared"] | undefined;
  const answeredChoice = range.events.find(event => event.eventType === "PendingInputAnswered")?.payload as
    EventPayloadByType["PendingInputAnswered"] | undefined;
  const cancelledChoice = preparedChoice?.record.plan.choices.some(choice =>
    choice.choiceId === answeredChoice?.answer.choiceId && choice.continuation.kind === "cancel") === true;
  const privateChoiceOnly = preparedChoice !== undefined && range.events.every(event =>
    ["FrozenPlayerChoicePrepared", "PlayerChoiceRequested", "PendingInputAnswered"].includes(event.eventType))
    && (range.receipt.status === "awaitingInput" || cancelledChoice);
  const privateActorPlanOnly = range.events.every(event => isPrivateActorPlanLedgerEvent(event, range));
  const privatePromiseOnly = range.events.length > 0 && range.events.every(event => isPrivatePromiseLedgerEvent(event, range));
  const privateActorPlanFormationOnly = range.events.some(event => isPrivateActorPlanFormationEvent(event, range))
    && range.events.every(event => isPrivateActorPlanFormationEvent(event, range)
      || (event.eventType === "AtomicWorldInteractionStepsResolved" && event.secrecy === "internal"));
  const privateTimePassageProgressOnly = range.events.length > 0 && range.events.every(event =>
    isTimePassageProgressEvent(event, range.eventStates?.get(event.eventId) ? { ...range, ...range.eventStates.get(event.eventId)! } : range)
      || isLongSpellcastingTimeProgressEvent(event, range.eventStates?.get(event.eventId) ? { ...range, ...range.eventStates.get(event.eventId)! } : range));
  if (requireClosedVNextCoverage && materials.length === 0 && !privateDefinitionOnly && !privateChoiceOnly && !privateActorPlanOnly && !privateActorPlanFormationOnly && !privateTimePassageProgressOnly && !privatePromiseOnly) {
    throw new TypeError("VNEXT_CLAIMS_INSUFFICIENT");
  }

  // A due NPC child receipt is not a player action. Its observable child
  // events own all renderable facts, including the valid empty projection.
  const pureTimePassageEnding = range.events.length === 1
    && ["ActivityCompleted", "ActivityInterrupted"].includes(range.events[0].eventType)
    && timePassageActivity(range, recordOrEmpty(range.events[0].payload).activityId) !== undefined;
  if (!isActorPlanDueRoot(range.receipt.rootActionId) && !privateActorPlanFormationOnly && !privateTimePassageProgressOnly && !pureTimePassageEnding && !privatePromiseOnly) materials.push({
    claimRef: claimRefForRange(range.receipt.receiptId, "action-committed"),
    kind: "actionCommitted",
    actorRef: range.actorCharacterId,
    status: range.receipt.status,
    summary: privateChoiceOnly ? cancelledChoice ? "已取消这个方案，没有执行其效果。" : "等待你选择执行方案。"
      : "本次行动已经由权威状态提交。",
    basis: {
      authorityRefs: uniqueDefinedRefs([
        range.receipt.receiptId,
        ...range.events.map((event) => event.eventId),
      ]),
      viewerRefs: [range.receipt.receiptId],
    },
    visibility: {
      kind: "grants",
      allOf: [`visibility:character-controller:${range.actorCharacterId}`],
    },
  });

  return deriveAuthorityClaims({
    receiptId: range.receipt.receiptId,
    rootActionId: range.receipt.rootActionId,
    materials: deduplicateMaterials(materials),
  });
}

function actorPlanTraceClaim(event: EventEnvelope, fact: JsonRecord, range: VerifiedClaimCommittedRange): SceneFeatureClaimMaterial {
  const factRef = stringField(fact, "id"), description = stringField(recordOrEmpty(fact.value), "description");
  const policyRef = stringField(fact, "visibilityPolicyId");
  const committed = factRef === undefined ? undefined : range.state.canonicalFacts[factRef];
  if (factRef === undefined || description === undefined || policyRef === undefined || committed === undefined
    || fact.source !== "npcOrFactionAction"
    || canonicalSha256(committed) !== canonicalSha256({ ...fact, branchId: event.branchId, validFromEventSeq: event.eventSeq })) {
    throw new TypeError("ACTOR_PLAN_TRACE_CLAIM_INVALID");
  }
  return { ...eventClaimBaseWithSeparatedBasis(event, "actor-plan-trace", {
    authorityRefs: [factRef], viewerRefs: [factRef], requiredViewerRefs: [factRef], materialVisibilityPolicyRef: policyRef,
  }), kind: "sceneFeature", featureRef: factRef, description };
}

function completedActivity(range: VerifiedClaimCommittedRange, activityId: string): JsonRecord | undefined {
  const stored = range.priorState.campaignRuntime.activities?.[activityId]
    ?? range.state.campaignRuntime.activities?.[activityId];
  if (stored !== undefined) return stored;
  const started = range.events.find(event => event.eventType === "ActivityStarted"
    && recordOrEmpty(event.payload).activityId === activityId);
  return started === undefined ? undefined : recordOrEmpty(started.payload);
}

function timePassageActivity(range: VerifiedClaimCommittedRange, activityId: unknown): JsonRecord | undefined {
  if (typeof activityId !== "string") return undefined;
  const activity = range.state.campaignRuntime.activities[activityId] ?? range.priorState.campaignRuntime.activities[activityId];
  return recordOrEmpty(activity?.completion).kind === "timePassage" ? activity : undefined;
}

function longSpellcastingActivity(range: VerifiedClaimCommittedRange, activityId: unknown): JsonRecord | undefined {
  if (typeof activityId !== "string") return undefined;
  const activity = range.state.campaignRuntime.activities[activityId] ?? range.priorState.campaignRuntime.activities[activityId];
  return recordOrEmpty(activity?.completion).kind === "longSpellcasting" ? activity : undefined;
}

function isLongSpellcastingTimeProgressEvent(event: EventEnvelope, range: VerifiedClaimCommittedRange): boolean {
  const payload = recordOrEmpty(event.payload);
  if (event.eventType !== "FictionTimeAdvanced" || payload.reason !== "longSpellcasting" || typeof payload.activityId !== "string") return false;
  const activity = range.priorState.campaignRuntime.activities[payload.activityId], completion = recordOrEmpty(activity?.completion);
  if (activity?.status !== "active" || completion.kind !== "longSpellcasting" || completion.sourceTimelineId !== event.fictionTimelineId) return false;
  const prefix = `long-spell-advance:${activity.activityId}:`;
  if (!event.rootActionId.startsWith(prefix)) return false;
  const span = event.rootActionId.slice(prefix.length).split(":");
  return span.length === 2 && span.every(value => /^(0|[1-9][0-9]*)$/.test(value))
    && BigInt(span[1]) > BigInt(span[0]) && (BigInt(span[1]) - BigInt(span[0])).toString() === payload.durationMicros;
}

function longSpellcastingInvestmentClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial {
  const mechanical = recordOrEmpty(payload.mechanicalResult), activity = longSpellcastingActivity(range, mechanical.activityId);
  const completion = recordOrEmpty(activity?.completion), sourceRef = stringField(payload, "sourceEntityId");
  const started = mechanical.kind === "longSpellcastingStarted", invested = finiteNumber(mechanical.investedActionRounds);
  if (activity?.status !== "active" || sourceRef === undefined || activity.characterId !== sourceRef
    || completion.abilityRef !== payload.abilityRef || completion.requiredActionRounds !== mechanical.requiredActionRounds
    || invested === undefined || !Number.isSafeInteger(invested) || invested < 1
    || (started && (invested !== 1 || mechanical.intendedDurationMicros !== activity.intendedDurationMicros))
    || (!started && recordOrEmpty(range.state.combatRuntime.entities[sourceRef]?.concentration).investedActionRounds !== invested)) {
    throw new TypeError("LONG_SPELL_INVESTMENT_CLAIM_INVALID");
  }
  const duration = microsecondsText(activity.intendedDurationMicros);
  if (duration === undefined) throw new TypeError("LONG_SPELL_DURATION_CLAIM_INVALID");
  return { ...eventClaimBaseWithSeparatedBasis(event, "long-spell-investment", { authorityRefs: [String(activity.activityId), String(payload.abilityRef)], viewerRefs: [sourceRef] }),
    kind: "mechanicalOutcome", actorRef: sourceRef, outcomeCode: String(mechanical.kind),
    summary: started ? `该角色已开始持续施法，需持续 ${duration} 秒并维持专注；法术效果尚未结算。`
      : `该角色本轮已投入动作继续施法，目前已投入 ${invested} 轮动作；法术效果尚未结算。` };
}

function longSpellcastingEndedClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial {
  const activity = longSpellcastingActivity(range, payload.activityId), interrupted = event.eventType === "ActivityInterrupted";
  if (activity === undefined || activity.status !== (interrupted ? "interrupted" : "completed")
    || typeof activity.characterId !== "string") throw new TypeError("LONG_SPELL_END_CLAIM_INVALID");
  return { ...eventClaimBaseWithSeparatedBasis(event, "long-spell-ended", { authorityRefs: [String(activity.activityId)] }),
    kind: "mechanicalOutcome", targetRefs: [activity.characterId],
    outcomeCode: interrupted ? "longSpellcastingInterrupted" : "longSpellcastingDurationCompleted",
    summary: interrupted ? "持续施法已中断，该次法术没有产生效果。"
      : "持续施法所需的时间与动作投入已完成；法术效果仍以实际结算事件为准。" };
}

function isTimePassageProgressEvent(event: EventEnvelope, range: VerifiedClaimCommittedRange): boolean {
  const payload = recordOrEmpty(event.payload);
  if (event.eventType === "FictionTimeAdvanced" && payload.reason === "activityProgress" && typeof payload.activityId === "string") {
    const activity = range.priorState.campaignRuntime.activities[payload.activityId];
    return activity?.status === "active" && recordOrEmpty(activity.progression).timelineId === event.fictionTimelineId
      && event.rootActionId === `activity-advance:${payload.activityId}:${event.fictionInstantMicros}:${BigInt(event.fictionInstantMicros) + BigInt(String(payload.durationMicros))}:${canonicalSha256(recordOrEmpty(activity.progression).acknowledgedKnowledgeRefs).slice(7, 23)}`;
  }
  if (event.eventType === "ActivityStarted") return recordOrEmpty(payload.completion).kind === "timePassage"
    && timePassageActivity(range, payload.activityId)?.characterId === payload.characterId;
  if (event.eventType !== "FictionTimeAdvanced" || payload.reason !== "timePassage" || typeof payload.activityId !== "string") return false;
  const activity = range.priorState.campaignRuntime.activities[payload.activityId];
  if (!activity || recordOrEmpty(activity.completion).kind !== "timePassage" || activity.status !== "active") return false;
  const prefix = `time-passage-advance:${String(activity.activityId)}:`;
  if (!event.rootActionId.startsWith(prefix)) return false;
  const span = event.rootActionId.slice(prefix.length).split(":");
  return span.length === 2 && span.every(value => /^(0|[1-9][0-9]*)$/.test(value))
    && BigInt(span[1]) > BigInt(span[0]) && (BigInt(span[1]) - BigInt(span[0])).toString() === payload.durationMicros
    && recordOrEmpty(activity.completion).sourceTimelineId === event.fictionTimelineId;
}

const TIME_PASSAGE_INTERRUPTION_TEXT: Readonly<Record<string, string>> = {
  actorUnavailable: "该角色已无法继续等待。", actorIncapacitated: "该角色已失去继续等待的行动能力。",
  encounterActive: "遭遇已开始，需要先处理当前局面。", locationChanged: "地点或时间线已经改变。",
  externalInterruption: "这次等待已被中断。",
};

function timePassageEndedClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial {
  const activity = timePassageActivity(range, payload.activityId);
  const actorRef = activity && stringField(activity, "characterId"), start = activity && stringField(activity, "startedAtFictionMicros");
  const ended = activity && stringField(activity, "endedAtFictionMicros"), intended = activity && stringField(activity, "intendedDurationMicros");
  const interrupted = event.eventType === "ActivityInterrupted";
  if (!activity || !actorRef || start === undefined || ended === undefined || intended === undefined
    || [start, ended, intended].some(value => !/^(0|[1-9][0-9]*)$/.test(value))
    || ended !== event.fictionInstantMicros || BigInt(ended) < BigInt(start)
    || activity.status !== (interrupted ? "interrupted" : "completed")) throw new TypeError("TIME_PASSAGE_END_CLAIM_INVALID");
  const duration = microsecondsText((BigInt(ended) - BigInt(start)).toString())!;
  const planned = microsecondsText(intended)!;
  const cause = recordOrEmpty(activity.interruptionCause);
  const reason = cause.kind === "timePassageInterrupted" ? TIME_PASSAGE_INTERRUPTION_TEXT[String(cause.reason)] : TIME_PASSAGE_INTERRUPTION_TEXT.externalInterruption;
  if (interrupted && reason === undefined) throw new TypeError("TIME_PASSAGE_INTERRUPTION_CLAIM_UNMAPPED");
  return { ...eventClaimBaseWithSeparatedBasis(event, "time-passage-ended", { authorityRefs: [String(activity.activityId)] }),
    kind: "mechanicalOutcome", targetRefs: [actorRef], outcomeCode: interrupted ? "timePassageInterrupted" : "timePassageCompleted",
    summary: interrupted ? `等待已中断，实际经过 ${duration} 秒，原计划为 ${planned} 秒。${reason}`
      : `等待已结束，实际经过 ${duration} 秒，原计划为 ${planned} 秒。` };
}

/** An ordinary Activity settled at its deadline because the world moved on
 * under it: the frozen completion could not apply, so it was interrupted. */
function activityInterruptedClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial {
  const activityId = stringField(payload, "activityId");
  const activity = activityId === undefined ? undefined : completedActivity(range, activityId);
  const actorRef = activity === undefined ? undefined : stringField(activity, "characterId");
  if (actorRef === undefined) throw new TypeError("ACTIVITY_INTERRUPTED_CLAIM_BINDING_INVALID");
  const summary = recordOrEmpty(payload.cause).kind === "playerCancelledActivity" ? "玩家已结束当前活动，已经过的时间与发生的成本保留。"
    : activity?.activityKind === "passageTraversal" ? "该角色的通行已中断：原定路线已经无法走完。"
    : "该角色的活动已中断：原定的完成条件已不成立。";
  return { ...eventClaimBaseWithSeparatedBasis(event, "activity-interrupted", { authorityRefs: [activityId] }),
    kind: "mechanicalOutcome", targetRefs: [actorRef], outcomeCode: "activityInterrupted", summary };
}

function activityCompletedClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial {
  const activityId = stringField(payload, "activityId");
  const activity = activityId === undefined ? undefined : completedActivity(range, activityId);
  const actorRef = activity === undefined ? undefined : stringField(activity, "characterId");
  if (actorRef === undefined) throw new TypeError("ACTIVITY_COMPLETED_CLAIM_BINDING_INVALID");
  const rest = activity?.restKind === "short" ? "短休" : activity?.restKind === "long" ? "长休" : "活动";
  return { ...eventClaimBaseWithSeparatedBasis(event, "activity-completed", { authorityRefs: [activityId] }),
    kind: "mechanicalOutcome", targetRefs: [actorRef], outcomeCode: "activityCompleted", summary: `该角色的${rest}已完成。` };
}

function resourceDisplayName(resourceId: string): string | undefined {
  const slot = /^(?:slot|spellSlot:)([1-9])$/u.exec(resourceId);
  if (slot !== null) return `${slot[1]} 环法术位`;
  if (resourceId === "hitDice") return "生命骰";
  if (resourceId === "arcaneRecovery") return "奥术回想";
  if (resourceId === "indomitable") return "不屈";
  const aliases: Readonly<Record<string, string>> = {
    actionSurge: "surge", breathWeapon: "breath", channelDivinity: "channel", superiorityDice: "superiority",
  };
  return CLASS_RESOURCE_CATALOG[aliases[resourceId] ?? resourceId]?.label
    ?? Object.values(CLASS_RESOURCE_CATALOG).find(resource => resource.resourceId === resourceId)?.label;
}

function restCompletedClaims(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial[] {
  const characterId = stringField(payload, "characterId");
  const before = characterId === undefined ? undefined : range.priorState.entities[characterId];
  const after = recordOrEmpty(payload.resultingCharacter);
  const recovery = recordOrEmpty(payload.recovery);
  if (before === undefined || characterId === undefined || after.id !== characterId
    || (payload.restKind !== "short" && payload.restKind !== "long")) throw new TypeError("REST_COMPLETED_CLAIM_BINDING_INVALID");
  const base = (suffix: string) => eventClaimBaseWithSeparatedBasis(event, suffix, {
    authorityRefs: [stringField(payload, "activityId")],
    materialVisibilityPolicyRef: `visibility:character-controller:${characterId}`,
  });
  const claims: MechanicalOutcomeClaimMaterial[] = [{ ...base("rest-completed"), kind: "mechanicalOutcome",
    targetRefs: [characterId], outcomeCode: "restCompleted", summary: `${payload.restKind === "short" ? "短休" : "长休"}的恢复已结算。` }];
  const previousHp = before.hitPoints;
  const nextHp = recordOrEmpty(after.hitPoints);
  if (previousHp !== undefined && finiteNumber(nextHp.current) !== undefined && finiteNumber(nextHp.maximum) !== undefined
    && (previousHp.current !== nextHp.current || previousHp.maximum !== nextHp.maximum)) {
    claims.push({ ...base("rest-hit-points"), kind: "mechanicalOutcome", targetRefs: [characterId], outcomeCode: "hitPointsChanged",
      summary: `生命值由 ${previousHp.current}/${previousHp.maximum} 变为 ${nextHp.current}/${nextHp.maximum}。` });
  }
  const nextResources = recordOrEmpty(after.resources);
  const nextMaximums = recordOrEmpty(after.resourceMaximums);
  const resourceIds = [...new Set([...Object.keys(before.resources ?? {}), ...Object.keys(nextResources)])].sort();
  for (const resourceId of resourceIds) {
    const prior = before.resources?.[resourceId], next = finiteNumber(nextResources[resourceId]);
    const priorMaximum = before.resourceMaximums?.[resourceId], maximum = finiteNumber(nextMaximums[resourceId]);
    if (prior === next && priorMaximum === maximum) continue;
    const label = resourceDisplayName(resourceId);
    if (label === undefined || next === undefined) throw new TypeError("REST_RESOURCE_CLAIM_UNMAPPED");
    claims.push({ ...base(`rest-resource:${resourceId}`), kind: "mechanicalOutcome", targetRefs: [characterId], outcomeCode: "resourceChanged",
      summary: `${label}的可用数量${prior === undefined ? `为 ${next}` : `由 ${prior} 变为 ${next}`}。${maximum === undefined ? "" : `${label}的数量上限为 ${maximum}。`}` });
  }
  const spent = finiteNumber(recovery.hitDiceSpent);
  if (spent !== undefined && spent > 0) {
    const sides = finiteNumber(recovery.hitDieSides);
    const faces = recovery.hitDieFaces;
    if (sides === undefined || !Array.isArray(faces) || faces.length !== spent
      || !faces.every(face => Number.isInteger(face) && Number(face) >= 1 && Number(face) <= sides)) throw new TypeError("REST_DICE_CLAIM_INVALID");
    claims.push({ ...base("rest-hit-dice"), kind: "mechanicalOutcome", targetRefs: [characterId], outcomeCode: "restHitDiceSpent",
      summary: `本次休整消耗 ${spent} 枚 d${sides} 生命骰，骰面为 ${faces.join("、")}。` });
  }
  return claims;
}

function restMechanicsMirrorClaims(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial[] {
  const rest = range.events.find(candidate => candidate.eventType === "RestCompleted"
    && BigInt(candidate.eventSeq) < BigInt(event.eventSeq)
    && recordOrEmpty(candidate.payload).characterId === payload.characterId);
  const recovered = recordOrEmpty(recordOrEmpty(rest?.payload).resultingCharacter);
  const characterId = stringField(payload, "characterId");
  const combatEntity = recordOrEmpty(payload.combatEntity);
  const hp = recordOrEmpty(combatEntity.hitPoints), recoveredHp = recordOrEmpty(recovered.hitPoints);
  if (rest === undefined || characterId === undefined || recovered.id !== characterId
    || canonicalSha256(payload.combatEntity) !== canonicalSha256(range.state.combatRuntime.entities[characterId])
    || finiteNumber(hp.current) !== finiteNumber(recoveredHp.current)
    || finiteNumber(hp.maximum) !== finiteNumber(recoveredHp.maximum)) throw new TypeError("CHARACTER_MECHANICS_CLAIM_UNMAPPED");
  const prior = range.priorState.combatRuntime.entities[characterId];
  if (prior === undefined) throw new TypeError("CHARACTER_MECHANICS_CLAIM_UNMAPPED");
  const { hitPoints: priorHp, resources: priorResources, ...priorOther } = prior;
  const { hitPoints: _nextHp, resources: nextResources, ...nextOther } = combatEntity;
  if (canonicalSha256(priorOther) !== canonicalSha256(nextOther)) throw new TypeError("CHARACTER_MECHANICS_CLAIM_UNMAPPED");
  const recoveredResources = recordOrEmpty(recovered.resources), maximums = recordOrEmpty(recovered.resourceMaximums);
  for (const resourceId of new Set([...Object.keys(recordOrEmpty(priorResources)), ...Object.keys(recordOrEmpty(nextResources))])) {
    const previous = recordOrEmpty(priorResources)[resourceId], next = recordOrEmpty(nextResources)[resourceId];
    if (canonicalSha256({ value: previous ?? null }) === canonicalSha256({ value: next ?? null })) continue;
    const sourceId = Object.keys(recoveredResources).find(id => combatResourceId(id) === resourceId);
    if (sourceId === undefined || !isRecord(next)
      || finiteNumber(next.current) !== finiteNumber(recoveredResources[sourceId])
      || finiteNumber(next.maximum) !== (finiteNumber(maximums[sourceId]) ?? finiteNumber(recoveredResources[sourceId]))) {
      throw new TypeError("CHARACTER_MECHANICS_RESOURCE_CLAIM_UNMAPPED");
    }
  }
  const temporaryBefore = finiteNumber(recordOrEmpty(priorHp).temporary), temporaryAfter = finiteNumber(hp.temporary);
  if (temporaryBefore === temporaryAfter) return [];
  if (temporaryBefore === undefined || temporaryAfter === undefined) throw new TypeError("CHARACTER_MECHANICS_HP_CLAIM_UNMAPPED");
  return [{ ...eventClaimBaseWithSeparatedBasis(event, "rest-temporary-hit-points", {
    materialVisibilityPolicyRef: `visibility:character-controller:${characterId}`,
  }), kind: "mechanicalOutcome", targetRefs: [characterId], outcomeCode: "temporaryHitPointsChanged",
    summary: `临时生命值由 ${temporaryBefore} 变为 ${temporaryAfter}。` }];
}

function knowledgeAcquiredClaims(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): ClaimMaterial[] {
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  return items.map((item, index) => {
    if (!isRecord(item)) throw new TypeError("KNOWLEDGE_ACQUIRED_CLAIM_UNMAPPED");
    return knowledgeAcquiredClaim(event, { ...payload, ...item }, range, index, Array.isArray(payload.items));
  });
}

function knowledgeAcquiredClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange,
  index: number, shared: boolean): ClaimMaterial {
  const characterId = stringField(payload, "characterId"), knowledgeRef = stringField(payload, "knowledgeRef");
  if (characterId === undefined || knowledgeRef === undefined) throw new TypeError("KNOWLEDGE_ACQUIRED_CLAIM_UNMAPPED");
  const record = heldKnowledgeRecord(range.state, characterId, knowledgeRef);
  if (record === undefined || record.acquiredByEventId !== event.eventId || record.objectKind !== payload.objectKind
    || canonicalSha256(record.content) !== canonicalSha256(payload.content)) throw new TypeError("KNOWLEDGE_ACQUIRED_RECORD_MISMATCH");
  const content = record.content;
  const base = eventClaimBaseWithSeparatedBasis(event, `knowledge-acquired:${index}`, {
    authorityRefs: [knowledgeRef, stringField(payload, "causeFactId")],
    materialVisibilityPolicyRef: `visibility:knowledge-holder:${characterId}`,
  });
  if (record.objectKind !== "sourceClaim" && (shared || record.objectKind === "characterInference"
    || (content !== null && typeof content === "object"))) {
    const projected = structuredClone(record);
    if (isWorldFactPointer(record.content)) {
      const fact = range.state.canonicalFacts[knowledgeRef];
      if (!fact) throw new TypeError("world-fact:knowledge-fact-unavailable");
      projected.content = projectWorldFact(range.state, fact).value;
    }
    return { ...base, kind: "knowledgeAcquisition", characterId, record: projected };
  }
  let description: string;
  if (typeof content === "string" && content.length > 0) description = content;
  else if (content === null || typeof content === "boolean" || typeof content === "number") description = JSON.stringify(content);
  else throw new TypeError("KNOWLEDGE_ACQUIRED_CONTENT_UNMAPPED");
  if (record.objectKind === "sourceClaim") {
    return { ...base, kind: "sourceClaim", ...(record.sourceCharacterId === null ? {} : { speakerRef: record.sourceCharacterId }),
      statement: description, acquisition: { recipientRef: characterId, layer: record.layer } };
  }
  if (record.objectKind === "sensoryEvidence") return { ...base, kind: "sensoryEvidence", observerRef: characterId,
    sense: canonicalSense(recordOrEmpty(payload.acquisition).sense), evidence: description };
  if (payload.objectKind === "canonicalFact") return { ...base, kind: "mechanicalOutcome", targetRefs: [characterId],
    outcomeCode: "knowledgeAcquired", summary: `本次获得的事实记录：${description}` };
  throw new TypeError("KNOWLEDGE_ACQUIRED_KIND_UNMAPPED");
}

function characterMovedClaims(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): ClaimMaterial[] {
  const characterId = stringField(payload, "characterId"), destination = stringField(payload, "destinationSceneId");
  const source = characterId === undefined ? undefined : range.priorState.entities[characterId]?.sceneId;
  if (characterId === undefined || destination === undefined || source === undefined) throw new TypeError("CHARACTER_MOVED_CLAIM_INVALID");
  const claims: ClaimMaterial[] = [
    { ...eventClaimBaseWithSeparatedBasis(event, "departed", { requiredViewerRefs: [source] }), kind: "mechanicalOutcome",
      actorRef: characterId, targetRefs: [source], outcomeCode: "departed", summary: "该角色离开了这个地点。" },
    { ...eventClaimBaseWithSeparatedBasis(event, "arrived", { requiredViewerRefs: [destination] }), kind: "mechanicalOutcome",
      actorRef: characterId, targetRefs: [destination], outcomeCode: "arrived", summary: "该角色到达了这个地点。" },
  ];
  for (const [definitionRef, definition] of Object.entries(range.state.campaignRuntime.definitions)) {
    const content = recordOrEmpty(definition.content);
    if (definition.semanticKind !== "location" || content.sceneRef !== destination) continue;
    const description = semanticSceneDescription(content);
    if (description === undefined) continue;
    claims.push({ ...eventClaimBaseWithSeparatedBasis(event, `location-entered:${definitionRef}`, {
      authorityRefs: [definitionRef, stringField(definition, "definitionHash")],
      requiredViewerRefs: [destination, definitionRef], materialVisibilityPolicyRef: "visibility:scene-observers",
    }), kind: "sceneFeature", featureRef: definitionRef, description });
  }
  return claims;
}

function semanticDefinitionMaterializationClaims(
  event: EventEnvelope,
  payload: JsonRecord,
): ClaimMaterial[] {
  const definitionRef = stringField(payload, "definitionRef");
  const semanticKind = stringField(payload, "semanticKind");
  const definition = isRecord(payload.definition) ? payload.definition : undefined;
  const content = definition !== undefined && isRecord(definition.content)
    ? definition.content
    : undefined;
  const visibilityPolicyRef = definition === undefined
    ? event.visibilityPolicyId
    : stringField(definition, "visibilityPolicyRef") ?? event.visibilityPolicyId;
  if (definitionRef === undefined
    || !isSemanticDefinitionKind(semanticKind)
    || definition === undefined
    || content === undefined
    || stringField(definition, "definitionId") !== definitionRef
    || stringField(definition, "semanticKind") !== semanticKind) return [];

  const base = eventClaimBaseWithSeparatedBasis(event, `definition:${definitionRef}`, {
    authorityRefs: [
      definitionRef,
      stringField(definition, "definitionHash"),
      stringField(payload, "bundleHash"),
      stringField(payload, "prospectiveRef"),
      stringField(payload, "contextHash"),
      stringField(payload, "templateRef"),
      stringField(payload, "templateHash"),
      ...stringRefs(payload.basisRefs),
      ...stringRefs(payload.sourceRefs),
    ],
    viewerRefs: [definitionRef],
    materialVisibilityPolicyRef: visibilityPolicyRef,
  });
  const summary = semanticMaterializationSummary(semanticKind, definitionRef, content);
  const claims: ClaimMaterial[] = [{
    ...base,
    kind: "definitionRevised",
    definitionRef,
    definitionKind: semanticKind,
    summary,
  }];
  if (semanticKind !== "sceneFeature" && semanticKind !== "passage") return claims;
  const description = semanticSceneDescription(content) ?? summary;
  const state = semanticSceneState(content);
  const interactionHint = semanticInteractionHint(content);
  claims.push({
    ...eventClaimBaseWithSeparatedBasis(event, `scene-feature:${definitionRef}`, {
      authorityRefs: [
        definitionRef,
        stringField(definition, "definitionHash"),
        stringField(payload, "bundleHash"),
        stringField(payload, "prospectiveRef"),
        stringField(payload, "contextHash"),
        stringField(payload, "templateRef"),
        stringField(payload, "templateHash"),
        ...stringRefs(payload.basisRefs),
        ...stringRefs(payload.sourceRefs),
      ],
      viewerRefs: [definitionRef],
      materialVisibilityPolicyRef: visibilityPolicyRef,
    }),
    kind: "sceneFeature",
    featureRef: definitionRef,
    description,
    ...(state === undefined ? {} : { state }),
    ...(interactionHint === undefined ? {} : { interactionHint }),
  });
  return claims;
}

function worldInteractionFeasibilityClaims(
  event: EventEnvelope,
  payload: JsonRecord,
  range: VerifiedClaimCommittedRange,
): ClaimMaterial[] {
  const actorRef = stringField(payload, "actorCharacterId") ?? range.actorCharacterId;
  const rulingKind = stringField(payload, "rulingKind");
  const publicBasis = stringField(payload, "publicBasis");
  if (publicBasis === undefined
    || (rulingKind !== "missingPrerequisite" && rulingKind !== "worldLawViolation")) {
    return [];
  }
  const prerequisiteDescriptions = Array.isArray(payload.prerequisites)
    ? payload.prerequisites.flatMap((entry) => isRecord(entry)
      ? [stringField(entry, "description")].filter(isNonEmptyString)
      : [])
    : [];
  const summary = uniqueText([publicBasis, ...prerequisiteDescriptions]).join("；");
  const claims: ClaimMaterial[] = [{
    ...eventClaimBaseWithSeparatedBasis(event, "feasibility", {
      viewerRefs: [],
    }),
    kind: "mechanicalOutcome",
    actorRef,
    outcomeCode: rulingKind,
    summary,
  }];
  const nextActions = Array.isArray(payload.nextActions) ? payload.nextActions : [];
  nextActions.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const description = stringField(entry, "description");
    if (description === undefined) return;
    claims.push({
      ...eventClaimBaseWithSeparatedBasis(event, `feasibility-opportunity:${index}`, {
        viewerRefs: [],
      }),
      kind: "opportunity",
      description,
    });
  });
  return claims;
}

function semanticDefinitionRevisionClaims(
  event: EventEnvelope,
  payload: JsonRecord,
  range: VerifiedClaimCommittedRange,
): ClaimMaterial[] {
  const definitionRef = stringField(payload, "definitionRef");
  const semanticKind = stringField(payload, "semanticKind");
  const nextDefinition = isRecord(payload.nextDefinition) ? payload.nextDefinition : undefined;
  const nextContent = isRecord(nextDefinition?.content) ? nextDefinition.content : undefined;
  const visibilityPolicyRef = stringField(nextDefinition ?? {}, "visibilityPolicyRef")
    ?? event.visibilityPolicyId;
  if (definitionRef === undefined
    || !isSemanticDefinitionKind(semanticKind)
    || nextDefinition === undefined
    || nextContent === undefined) return [];
  const priorDefinition = range.priorState.campaignRuntime.definitions[definitionRef];
  const priorContent = isRecord(priorDefinition) && isRecord(priorDefinition.content)
    ? priorDefinition.content
    : undefined;
  // Proposal/event summaries are KP-authored free text and may have been
  // grounded in authority-only facts. Viewer material is instead derived from
  // the visible, committed definition revision itself.
  const summary = semanticRevisionSummary(
    semanticKind,
    definitionRef,
    priorContent,
    nextContent,
  );
  const basisRefs = stringRefs(payload.basisRefs);
  const base = eventClaimBase(
    event,
    `definition:${definitionRef}`,
    basisRefs,
    visibilityPolicyRef,
  );

  if (semanticKind === "worldRelation") {
    const relationRef = stringField(nextContent, "relationRef") ?? definitionRef;
    const relationKind = stringField(nextContent, "kind");
    const subjectRef = stringField(nextContent, "subjectRef");
    const objectRef = stringField(nextContent, "objectRef");
    const nextState = stringField(nextContent, "state");
    if (relationKind === undefined || subjectRef === undefined || objectRef === undefined) return [];
    const priorState = priorContent === undefined ? undefined : stringField(priorContent, "state");
    const change: RelationChangedClaimMaterial["change"] = priorState !== "active"
      && nextState === "active"
      ? "began"
      : priorState === "active" && nextState === "ended"
        ? "ended"
        : "updated";
    return [{
      ...base,
      kind: "relationChanged",
      relationRef,
      relationKind,
      subjectRef,
      objectRef,
      change,
      description: relationTransitionSummary(relationKind, change),
    }];
  }

  const claims: ClaimMaterial[] = payload.completion === true ? [] : [{
    ...base,
    kind: "definitionRevised",
    definitionRef,
    definitionKind: semanticKind,
    summary,
  }];
  if (semanticKind === "sceneFeature") {
    const state = semanticSceneState(nextContent);
    const interactionHint = semanticInteractionHint(nextContent);
    claims.push({
      ...eventClaimBase(
        event,
        `scene-feature:${definitionRef}`,
        basisRefs,
        visibilityPolicyRef,
      ),
      kind: "sceneFeature",
      featureRef: definitionRef,
      description: semanticSceneDescription(nextContent) ?? summary,
      ...(state === undefined ? {} : { state }),
      ...(interactionHint === undefined ? {} : { interactionHint }),
    });
  }
  return claims;
}

function worldInteractionClaims(
  event: EventEnvelope,
  payload: JsonRecord,
  range: VerifiedClaimCommittedRange,
  includeEmbeddedSensoryEvidence: boolean,
): ClaimMaterial[] {
  const actorRef = stringField(payload, "actorCharacterId");
  if (actorRef === undefined || stringField(payload, "summary") === undefined) return [];
  const basisRefs = stringRefs(payload.basisRefs);
  const claims: ClaimMaterial[] = [];
  const check = isRecord(payload.check) ? payload.check : undefined;
  // These events have already passed replay verification. Bind to this root's
  // actual applied ledger entry, never infer a consequence from directSuccess
  // alone: a standalone direct action still has its own success outcome.
  const directConsequence = check === undefined && range.events.some(settlement => {
    if (settlement.eventType !== "AtomicWorldInteractionStepsResolved"
      || settlement.rootActionId !== event.rootActionId || settlement.branchId !== event.branchId
      || BigInt(settlement.eventSeq) <= BigInt(event.eventSeq)) return false;
    const body = recordOrEmpty(settlement.payload);
    const owner = range.events.find(candidate => {
      if (candidate.eventType !== "WorldInteractionResolved" || candidate.rootActionId !== event.rootActionId
        || candidate.branchId !== event.branchId || BigInt(candidate.eventSeq) >= BigInt(settlement.eventSeq)) return false;
      const result = recordOrEmpty(candidate.payload);
      return result.resolutionId === body.checkResolutionId && result.actorCharacterId === actorRef
        && result.rulingKind === "check" && isRecord(result.check) && result.branch === body.branch
        && result.check.succeeded === (body.branch === "success");
    });
    return owner !== undefined && body.actorCharacterId === actorRef
      && typeof body.checkResolutionId === "string" && body.checkResolutionId !== payload.resolutionId
      && Array.isArray(body.steps) && body.steps.some(step => isRecord(step)
        && step.proposalRef === payload.interactionRef && step.status === "applied"
        && (step.outcomeBinding === "always" || (body.branch === "success"
          ? step.outcomeBinding === "onSuccess" : body.branch === "failure" && step.outcomeBinding === "onFailure")));
  });
  const succeeded = check === undefined
    ? stringField(payload, "branch") !== "failure"
    : check.succeeded === true;
  const targetRefs = stringRefs(payload.targetRefs);
  const social = isRecord(payload.social) && isRecord(payload.social.plan) && isRecord(payload.social.plan.social)
    ? payload.social.plan.social : undefined;
  const socialBranch = social && isRecord(social.branches) ? recordOrEmpty(social.branches[String(payload.branch)]) : undefined;
  const traversalStarted = Array.isArray(payload.appliedEffects) && payload.appliedEffects.some(effect => isRecord(effect) && effect.kind === "passageTraversalStarted");
  const outcomeCode = traversalStarted ? "activityStarted" : directConsequence || (social && check === undefined) ? "applied" : succeeded ? "success" : "failure";
  const checkKind = interactionCheckKind(payload);
  claims.push({
    ...eventClaimBase(
      event,
      "interaction",
      basisRefs,
      social ? `visibility:knowledge-holder:${actorRef}` : "visibility:scene-observers",
      false,
    ),
    kind: "mechanicalOutcome",
    actorRef,
    ...(targetRefs.length === 0 ? {} : { targetRefs }),
    ...(traversalStarted ? {} : { outcomeKind: social ? "social" as const : payload.observation === true ? "observe" as const : "worldInteraction" as const }),
    outcomeCode,
    // The branch summary is KP-authored and may contain authority-only context.
    // The Viewer claim uses only closed ruling/branch values; concrete visible
    // consequences are emitted below from typed effects/evidence/transitions.
    summary: traversalStarted ? "通行活动已经开始，完成所需时间后才能到达目的地。"
      : social ? `这次交谈已完成。${isRecord(socialBranch?.response) && socialBranch.response.kind === "silence" ? "对方保持沉默。" : ""}` : directConsequence
      ? payload.observation === true ? "这次行动产生的观察或推断结果已提交。" : "这次行动产生的环境后果已提交。"
      : payload.observation === true
      ? check === undefined ? "这次观察或推断已完成。"
        : succeeded ? "这次观察或推断的检定成功。" : "这次观察或推断的检定失败。"
      : check === undefined
      ? "这次环境互动已直接成功并提交。"
      : checkKind === "attack"
        ? succeeded
          ? "这次环境互动的攻击命中并已提交。"
          : "这次环境互动的攻击未命中并已提交。"
        : succeeded
          ? "这次环境互动的检定成功并已提交。"
          : "这次环境互动的检定失败并已提交。",
    ...(check === undefined
      ? {}
      : {
          check: {
            kind: checkKind,
            result: succeeded ? "success" : "failure",
            ...(finiteNumber(check.total) === undefined ? {} : { total: finiteNumber(check.total) }),
            ...(finiteNumber(check.dc) === undefined ? {} : { dc: finiteNumber(check.dc) }),
          },
        }),
  });

  for (const targetRef of targetRefs) {
    const definition = range.state.campaignRuntime.definitions[targetRef]
      ?? range.priorState.campaignRuntime.definitions[targetRef];
    if (!isRecord(definition)
      || definition.schema !== "zhuwei.semantic-definition/vnext-1"
      || !["item", "worldFact", "sceneFeature", "passage"].includes(String(definition.semanticKind))
      || !isRecord(definition.content)
      || !isNonEmptyString(definition.visibilityPolicyRef)) continue;
    const description = semanticSceneDescription(definition.content);
    if (description === undefined) continue;
    const state = semanticSceneState(definition.content);
    const interactionHint = semanticInteractionHint(definition.content);
    claims.push({
      ...eventClaimBase(
        event,
        `scene-feature:${targetRef}`,
        [targetRef, stringField(definition, "definitionHash")],
        definition.visibilityPolicyRef,
        false,
      ),
      kind: "sceneFeature",
      featureRef: targetRef,
      description,
      ...(state === undefined ? {} : { state }),
      ...(interactionHint === undefined ? {} : { interactionHint }),
    });
  }

  const effects = Array.isArray(payload.appliedEffects) ? payload.appliedEffects : [];
  effects.forEach((value, index) => {
    if (!isRecord(value)) return;
    const kind = stringField(value, "kind");
    // itemCost is rendered from the separately committed ItemUsed event, which
    // owns the ItemEntry visibility policy and complete quantity/charge/
    // durability transition.
    if (kind === "itemCost") return;
    if (kind === "damage") {
      const targetRef = stringField(value, "targetRef");
      const amount = finiteNumber(value.amount);
      const damageType = stringField(value, "damageType");
      if (targetRef === undefined || amount === undefined || damageType === undefined) return;
      const damageName = viewerSafeDisplayText(damageType, "未标注类型的");
      claims.push({
        ...eventClaimBase(
          event,
          `damage:${index}`,
          [...basisRefs, stringField(value, "sourceDefinitionRef")],
          "visibility:scene-observers",
          false,
        ),
        kind: "mechanicalOutcome",
        actorRef,
        targetRefs: [targetRef],
        outcomeCode: value.died === true ? "died" : "damageApplied",
        summary: value.died === true
          ? `目标承受 ${amount} 点 ${damageName}伤害并死亡。`
          : `目标承受 ${amount} 点 ${damageName}伤害。`,
      });
    }
    // relationTransition and definitionRevision are summaries of the exact
    // SemanticDefinitionRevised events. Emitting them here would double-count
    // one authoritative transition.
  });

  const sensory = includeEmbeddedSensoryEvidence && Array.isArray(payload.sensoryEvidence)
    ? payload.sensoryEvidence
    : [];
  sensory.forEach((value, index) => {
    if (!isRecord(value)) return;
    const observerRef = stringField(value, "observerRef");
    const evidence = stringField(value, "evidence");
    if (observerRef === undefined || evidence === undefined) return;
    claims.push({
      ...eventClaimBase(
        event,
        `sensory:${index}`,
        [...basisRefs, ...stringRefs(value.basisRefs)],
        stringField(value, "visibilityPolicyRef"),
        false,
      ),
      kind: "sensoryEvidence",
      observerRef,
      sense: canonicalSense(value.sense),
      evidence,
      ...(stringField(value, "subjectRef") === undefined
        ? {}
        : { subjectRef: stringField(value, "subjectRef") }),
    });
  });

  const pressures = Array.isArray(payload.pressures) ? payload.pressures : [];
  pressures.forEach((value, index) => {
    if (!isRecord(value) || stringField(value, "description") === undefined) return;
    claims.push({
      ...eventClaimBase(
        event,
        `pressure:${index}`,
        stringRefs(value.basisRefs),
        stringField(value, "visibilityPolicyRef"),
        false,
        true,
      ),
      kind: "pressure",
      description: stringField(value, "description")!,
      ...(stringField(value, "sourceRef") === undefined
        ? {}
        : { sourceRef: stringField(value, "sourceRef") }),
    });
  });

  const opportunities = Array.isArray(payload.opportunities) ? payload.opportunities : [];
  opportunities.forEach((value, index) => {
    if (!isRecord(value) || stringField(value, "description") === undefined) return;
    claims.push({
      ...eventClaimBase(
        event,
        `opportunity:${index}`,
        stringRefs(value.basisRefs),
        stringField(value, "visibilityPolicyRef"),
        false,
        true,
      ),
      kind: "opportunity",
      description: stringField(value, "description")!,
      ...(stringField(value, "targetRef") === undefined
        ? {}
        : { targetRef: stringField(value, "targetRef") }),
      ...(stringField(value, "actionHint") === undefined
        ? {}
        : { actionHint: stringField(value, "actionHint") }),
    });
  });
  return claims;
}

function abilityEffectClaim(
  event: EventEnvelope,
  payload: JsonRecord,
  range: VerifiedClaimCommittedRange,
): AbilityEffectAppliedClaimMaterial | undefined {
  const abilityRef = stringField(payload, "abilityRef");
  const sourceRef = stringField(payload, "sourceEntityId");
  const mechanicalResult = isRecord(payload.mechanicalResult) ? payload.mechanicalResult : {};
  if (abilityRef === undefined || sourceRef === undefined) return undefined;
  const definition = abilityDefinition(range, abilityRef);
  const concentration = range.events.some((candidate) => {
    if (String(candidate.eventType) !== "ConcentrationStarted" || !isRecord(candidate.payload)) {
      return false;
    }
    const payloadValue = recordOrEmpty(candidate.payload);
    return payloadValue.entityId === sourceRef
      && isRecord(payloadValue.concentration)
      && payloadValue.concentration.abilityRef === abilityRef;
  });
  const targetRefs = abilityTargetRefs(mechanicalResult, sourceRef);
  const effect = abilityEffectDescription(definition, mechanicalResult, concentration);
  return {
    ...eventClaimBase(event, `ability:${abilityRef}`, [abilityRef]),
    kind: "abilityEffectApplied",
    abilityRef,
    abilityName: abilityDisplayName(definition, abilityRef),
    sourceRef,
    targetRefs,
    effect,
  };
}

const CONDITION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  blinded: "目盲", charmed: "魅惑", deafened: "耳聋", exhaustion: "力竭", frightened: "恐慌",
  grappled: "擒抱", incapacitated: "失能", invisible: "隐形", paralyzed: "麻痹", petrified: "石化",
  poisoned: "中毒", prone: "倒地", restrained: "束缚", stunned: "震慑", unconscious: "昏迷",
});
function microsecondsText(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const micros = BigInt(value), seconds = micros / 1_000_000n, fraction = String(micros % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${seconds}.${fraction}` : String(seconds);
}
function effectBeforeEvent(range: VerifiedClaimCommittedRange, event: EventEnvelope, effectId: string): JsonRecord | undefined {
  if (range.eventStates !== undefined) return range.priorState.combatRuntime.effects?.[effectId];
  const prior = range.events.slice(0, range.events.indexOf(event)).reverse()
    .filter((candidate) => String(candidate.eventType) === "EffectApplied")
    .map((candidate) => recordOrEmpty(candidate.payload))
    .find((payload) => isRecord(payload.effect) && payload.effect.effectId === effectId);
  return prior && isRecord(prior.effect) ? prior.effect : range.priorState.combatRuntime.effects?.[effectId];
}
function conditionEffectClaim(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial | undefined {
  const ended = String(event.eventType) === "EffectEnded";
  const effectId = stringField(payload, "effectId") ?? (isRecord(payload.effect) ? stringField(payload.effect, "effectId") : undefined);
  const effect = ended && effectId ? effectBeforeEvent(range, event, effectId) : isRecord(payload.effect) ? payload.effect : undefined;
  if (!effect) return undefined;
  const targetRef = stringField(effect, "targetEntityId");
  if (!targetRef) return undefined;
  let description: string;
  if (effect.kind === "condition" && typeof effect.condition === "string" && CONDITION_LABELS[effect.condition]) {
    const level = effect.condition === "exhaustion" && finiteNumber(effect.level) !== undefined ? ` ${finiteNumber(effect.level)} 级` : "";
    description = `目标的${CONDITION_LABELS[effect.condition]}${level}效果${ended ? "已经结束" : "已生效"}。`;
    if (!ended && isRecord(effect.duration)) {
      if (effect.duration.kind === "timed") {
        const seconds = microsecondsText(effect.duration.durationMicros);
        if (seconds === undefined) return undefined;
        description += `持续 ${seconds} 秒。`;
      } else if (effect.duration.kind === "untilEnded") description += "持续至效果被解除。";
      else if (effect.duration.kind === "turnBoundary") description += `持续至${effect.duration.subject === "target" ? "目标" : "效果来源"}的下次回合${effect.duration.edge === "turnStart" ? "开始" : "结束"}。`;
      else return undefined;
    }
  } else if (effect.kind === "shield" && finiteNumber(effect.armorClassBonus) !== undefined) {
    description = ended ? "目标的护盾效果已经结束。" : `目标护甲等级增加 ${finiteNumber(effect.armorClassBonus)}，并免疫魔法飞弹，持续至其下一回合开始。`;
  } else return undefined;
  return { ...eventClaimBaseWithSeparatedBasis(event, "condition-effect", {
    authorityRefs: [effectId, stringField(effect, "sourceDefinitionRef"), stringField(effect, "sourceAbilityRef"), stringField(effect, "sourceRef")],
    viewerRefs: [targetRef], materialVisibilityPolicyRef: stringField(effect, "visibilityPolicyId"),
  }), kind: "mechanicalOutcome", targetRefs: [targetRef], outcomeCode: ended ? "effectEnded" : "effectApplied", summary: description };
}
function nativeConditionClaims(event: EventEnvelope, payload: JsonRecord, range: VerifiedClaimCommittedRange): MechanicalOutcomeClaimMaterial[] {
  const targetRef = stringField(payload, "entityId");
  if (!targetRef || !isRecord(payload.conditions)) return [];
  const earlier = (range.eventStates === undefined ? range.events.slice(0, range.events.indexOf(event)) : []).reverse()
    .filter((candidate) => String(candidate.eventType) === "ConditionChanged")
    .map((candidate) => recordOrEmpty(candidate.payload))
    .find((payload) => payload.entityId === targetRef && isRecord(payload.conditions));
  const before = earlier ? earlier.conditions : range.priorState.combatRuntime.entities?.[targetRef]?.conditions;
  const prior = isRecord(before) ? before : {};
  const conditions = payload.conditions as JsonRecord;
  const changes = Object.keys(CONDITION_LABELS).filter((condition) => conditions[condition] !== prior[condition]);
  const summary = changes.map((condition) => {
    const active = conditions[condition];
    return `${CONDITION_LABELS[condition]}${condition === "exhaustion" && finiteNumber(active) !== undefined ? `变为 ${finiteNumber(active)} 级` : active ? "已生效" : "已结束"}`;
  }).join("；");
  return summary ? [{ ...eventClaimBase(event, "conditions"), kind: "mechanicalOutcome", targetRefs: [targetRef], outcomeCode: "conditionsChanged", summary: `目标的${summary}。` }] : [];
}
function itemAssemblyClaims(event: EventEnvelope, payload: JsonRecord,
  range: VerifiedClaimCommittedRange): ClaimMaterial[] {
  if (!isItemAssemblyChangedPayload(payload)
    || assemblySourceHash(range.priorState, payload.operation) !== payload.sourceHashBefore
    || canonicalSha256(range.state.campaignRuntime.itemSystem) !== payload.itemSystemHashAfter) throw new TypeError("ASSEMBLY_CLAIM_STATE_MISMATCH");
  const operation = payload.operation;
  const assembly = range.state.campaignRuntime.itemSystem.assemblies?.[payload.assemblyRef];
  if (!assembly) throw new TypeError("ASSEMBLY_CLAIM_MISSING_RECORD");
  const claims: ClaimMaterial[] = [{ ...eventClaimBaseWithSeparatedBasis(event, "assembly", {
    authorityRefs: [payload.contextHash], viewerRefs: [assembly.assemblyRef],
    requiredViewerRefs: [assembly.assemblyRef], inheritEnvelopeVisibility: false,
  }), kind: "sceneFeature", featureRef: assembly.assemblyRef, description: `${assembly.label}：${assembly.description}`,
    state: operation.kind === "assemble" ? "已组装" : "已拆解" }];
  for (const [index, component] of assembly.components.entries()) {
    const quantity = operation.kind === "assemble" ? operation.components[index].quantity
      : range.priorState.campaignRuntime.itemSystem.entries[component.entryRef]?.quantity;
    if (!Number.isSafeInteger(quantity) || quantity! <= 0) throw new TypeError("ASSEMBLY_CLAIM_COMPONENT_MISMATCH");
    claims.push({ ...eventClaimBaseWithSeparatedBasis(event, `assembly-component:${component.entryRef}`, {
      authorityRefs: [payload.contextHash], viewerRefs: [component.entryRef, assembly.assemblyRef],
      requiredViewerRefs: [component.entryRef, assembly.assemblyRef], inheritEnvelopeVisibility: false,
    }), kind: "inventoryOutcome", itemRef: component.entryRef,
      change: operation.kind === "assemble" ? "updated" : component.recoverable ? "acquired" : "consumed",
      summary: operation.kind === "assemble" ? "原组件已用于组装，不能再作为独立库存使用。"
        : component.recoverable ? "可恢复的原组件已归还库存，保留现有状态。" : "不可恢复的原组件未归还库存。",
      operation: { kind: operation.kind, actorRef: payload.actorCharacterId, assemblyRef: assembly.assemblyRef, quantity: quantity!, recoverable: component.recoverable },
      characterRefs: [payload.actorCharacterId],
    });
  }
  return claims;
}

function inventoryOperationClaims(event: EventEnvelope, payload: JsonRecord,
  range: VerifiedClaimCommittedRange): InventoryOutcomeClaimMaterial[] {
  const operation = isRecord(payload.operation) ? payload.operation : undefined;
  const targetRef = stringField(payload, "targetEntryId");
  const actorRef = stringField(payload, "actorCharacterId");
  if (!operation || !targetRef || !actorRef) return [];
  const kind = stringField(operation, "kind");
  let change: InventoryOutcomeClaimMaterial["change"] = "updated", summary: string, state: string | undefined;
  if (kind === "acquire") { change = "acquired"; summary = `角色取得了 ${finiteNumber(operation.quantity)} 件该物品。`; }
  else if (kind === "release") { summary = `角色已将 ${finiteNumber(operation.quantity)} 件该物品${operation.releaseKind === "loss" ? "遗失在场景中" : operation.releaseKind === "drop" ? "丢在场景中" : "放置在场景中"}。`; state = operation.releaseKind === "loss" ? "已遗失" : operation.releaseKind === "drop" ? "已丢下" : "已放下"; }
  else if (kind === "transfer") { change = "transferred"; summary = `角色已将 ${finiteNumber(operation.quantity)} 件该物品交给接收者。`; }
  else if (kind === "equip") { summary = operation.action === "wear" ? "角色已将该物品装备到指定部位。" : "角色已将该物品从装备部位收起。"; state = operation.action === "wear" ? "已装备" : "已收起"; }
  else if (kind === "identify") { summary = "角色已辨识该物品。"; state = "已识别"; }
  else if (kind === "lifecycle") {
    if (operation.action === "break") { change = "damaged"; summary = "该物品已损坏，当前不可正常使用。"; state = "损坏"; }
    else if (operation.action === "repair") { change = "repaired"; summary = "该物品已修复，可以正常使用。"; state = "可用"; }
    else if (operation.action === "destroy") { change = "destroyed"; summary = "该物品已被销毁。"; state = "销毁"; }
    else return [];
  } else return [];
  const witnessed = inventoryClaimOperation(operation, actorRef);
  const sourceBefore = inventorySourceBefore(operation, payload, range);
  // The transaction envelope is internal. Its witnessed Item outcome has its
  // own Viewer boundary; payload refs still require grants for the Item and
  // participating characters, while private context stays authority-only.
  // Splits and merges can leave each participant with a different visible
  // stack. Anchor the same moved quantity independently, without disclosing
  // the other stack's identity or its remaining/merged stock.
  return uniqueDefinedRefs([targetRef, stringField(operation, "entryRef")]).map(itemRef => ({
    ...eventClaimBaseWithSeparatedBasis(event, `inventory:${itemRef}`, {
    authorityRefs: [stringField(operation, "entryRef"), stringField(payload, "contextHash")],
    viewerRefs: [itemRef], requiredViewerRefs: [itemRef], inheritEnvelopeVisibility: false,
  }),
    kind: "inventoryOutcome", itemRef, change, summary, operation: witnessed,
    ...(sourceBefore === undefined ? {} : { sourceBefore }),
    characterRefs: uniqueDefinedRefs([actorRef, stringField(operation, "targetCharacterRef")]),
    ...(state && itemRef === targetRef ? { state } : {}),
  }));
}

function inventorySourceBefore(operation: JsonRecord, payload: JsonRecord,
  range: VerifiedClaimCommittedRange): InventorySourceBefore | undefined {
  const sourceRef = stringField(operation, "entryRef"), entryHashBefore = stringField(payload, "entryHashBefore");
  // Legacy material-only callers may not carry the verified source witness.
  // They gain no historical evidence; never substitute the current world.
  if (sourceRef === undefined || entryHashBefore === undefined) return undefined;
  const source = range.priorState.campaignRuntime.itemSystem?.entries[sourceRef];
  if (!isItemEntryV1(source) || source.entryId !== sourceRef || canonicalSha256(source) !== entryHashBefore) {
    throw new TypeError("INVENTORY_CLAIM_SOURCE_MISMATCH");
  }
  if (source.disposition === "held" && source.holderRef !== null) return {
    disposition: "held", holderRef: source.holderRef, equippedSlot: source.equippedSlot,
  };
  if (source.disposition === "scene" && source.sceneRef !== null) return { disposition: "scene", sceneRef: source.sceneRef };
  return undefined;
}

function inventorySourceBeforeConform(value: unknown): value is InventorySourceBefore {
  if (!isRecord(value)) return false;
  if (value.disposition === "held") return hasClosedKeys(value, ["disposition", "holderRef", "equippedSlot"])
    && isNonEmptyString(value.holderRef)
    && (value.equippedSlot === null || GEAR_SLOTS.some(slot => slot.id === value.equippedSlot));
  return value.disposition === "scene" && hasClosedKeys(value, ["disposition", "sceneRef"])
    && isNonEmptyString(value.sceneRef);
}

function inventoryClaimOperation(operation: JsonRecord, actorRef: string): InventoryClaimOperation {
  const kind = operation.kind;
  const value = kind === "acquire" ? { kind, actorRef, quantity: operation.quantity }
    : kind === "release" ? { kind, actorRef, quantity: operation.quantity, releaseKind: operation.releaseKind }
    : kind === "transfer" ? { kind, actorRef, quantity: operation.quantity, recipientRef: operation.targetCharacterRef }
    : kind === "identify" ? { kind, actorRef }
    : { kind, actorRef, action: operation.action };
  if (!inventoryClaimOperationConform(value)) throw new TypeError("INVENTORY_CLAIM_OPERATION_INVALID");
  return value;
}

function inventoryClaimOperationConform(value: unknown): value is InventoryClaimOperation {
  if (!isRecord(value) || !isNonEmptyString(value.actorRef)) return false;
  const quantity = Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0;
  switch (value.kind) {
    case "assemble": case "disassemble": return hasClosedKeys(value, ["kind", "actorRef", "quantity", "assemblyRef", "recoverable"])
      && quantity && isNonEmptyString(value.assemblyRef) && typeof value.recoverable === "boolean";
    case "acquire": return hasClosedKeys(value, ["kind", "actorRef", "quantity"]) && quantity;
    case "release": return hasClosedKeys(value, ["kind", "actorRef", "quantity", "releaseKind"])
      && quantity && ["placement", "drop", "loss"].includes(String(value.releaseKind));
    case "transfer": return hasClosedKeys(value, ["kind", "actorRef", "quantity", "recipientRef"])
      && quantity && isNonEmptyString(value.recipientRef);
    case "identify": return hasClosedKeys(value, ["kind", "actorRef"]);
    case "equip": return hasClosedKeys(value, ["kind", "actorRef", "action"])
      && ["wear", "stow"].includes(String(value.action));
    case "lifecycle": return hasClosedKeys(value, ["kind", "actorRef", "action"])
      && ["break", "repair", "destroy"].includes(String(value.action));
    default: return false;
  }
}

function inventoryOperationFact(
  operation: InventoryClaimOperation,
  itemName: string,
  displayNames: ReadonlyMap<string, string>,
): string {
  const actor = displayNames.get(operation.actorRef) ?? "行动角色";
  switch (operation.kind) {
    case "assemble": return `${actor}已将 ${operation.quantity} 件${itemName}用于${displayNames.get(operation.assemblyRef) ?? "该组装物"}；组件占用中，拆解时${operation.recoverable ? "可以恢复原组件" : "不能恢复原组件"}`;
    case "disassemble": return operation.recoverable ? `${actor}拆解后取回了 ${operation.quantity} 件${itemName}，保持原组件的现有状态` : `拆解后 ${operation.quantity} 件${itemName}不可恢复，未返还库存`;
    case "acquire": return `${actor}取得了 ${operation.quantity} 件${itemName}`;
    case "release": return `${actor}已将 ${operation.quantity} 件${itemName}${operation.releaseKind === "loss"
      ? "遗失在场景中" : operation.releaseKind === "drop" ? "丢在场景中" : "放置在场景中"}`;
    case "transfer": return `${actor}已将 ${operation.quantity} 件${itemName}交给${displayNames.get(operation.recipientRef) ?? "接收角色"}`;
    case "equip": return operation.action === "wear"
      ? `${actor}已将${itemName}装备到指定部位` : `${actor}已将${itemName}从装备部位收起`;
    case "identify": return `${actor}已辨识${itemName}`;
    case "lifecycle": return operation.action === "break"
      ? `${itemName}已损坏，当前不可正常使用`
      : operation.action === "repair" ? `${itemName}已修复，可以正常使用` : `${itemName}已被销毁`;
  }
}

function inventoryEventClaim(
  event: EventEnvelope,
  payload: JsonRecord,
  eventType: string,
): InventoryOutcomeClaimMaterial | undefined {
  const entry = isRecord(payload.entry) ? payload.entry : undefined;
  const itemRef = stringField(payload, "entryId")
    ?? stringField(payload, "targetItemId")
    ?? stringField(payload, "itemId")
    ?? (entry === undefined ? undefined : stringField(entry, "entryId"));
  if (itemRef === undefined) return undefined;
  const change: InventoryOutcomeClaimMaterial["change"] = eventType === "ItemMaterialized"
    ? "materialized"
    : eventType === "ItemAcquired"
      ? "acquired"
      : eventType === "ItemTransferred"
        ? "transferred"
        : finiteNumber(payload.quantityAfter) === 0 ? "consumed" : "used";
  const characterRefs = uniqueDefinedRefs([
    stringField(payload, "characterId"),
    stringField(payload, "fromCharacterId"),
    stringField(payload, "toCharacterId"),
    ...(entry === undefined
      ? []
      : [stringField(entry, "holderRef"), stringField(entry, "ownerRef")]),
  ]);
  const quantityBefore = finiteNumber(payload.quantityBefore) ?? (eventType === "ItemMaterialized" ? 0 : undefined);
  const quantityAfter = finiteNumber(payload.quantityAfter) ?? (eventType === "ItemMaterialized" && entry ? finiteNumber(entry.quantity) : undefined);
  const chargesBefore = nullableNumber(payload.chargesBefore);
  const chargesAfter = nullableNumber(payload.chargesAfter);
  const durabilityBefore = nullableNumber(payload.durabilityBefore);
  const durabilityAfter = nullableNumber(payload.durabilityAfter);
  return {
    ...eventClaimBase(event, `inventory:${itemRef}`),
    kind: "inventoryOutcome",
    itemRef,
    change,
    summary: inventorySummary(eventType, payload),
    ...(characterRefs.length === 0 ? {} : { characterRefs }),
    ...(quantityBefore === undefined || quantityAfter === undefined
      ? {}
      : { quantity: { before: quantityBefore, after: quantityAfter } }),
    ...(chargesBefore === undefined || chargesAfter === undefined
      ? {}
      : { charges: { before: chargesBefore, after: chargesAfter } }),
    ...(durabilityBefore === undefined || durabilityAfter === undefined
      ? {}
      : { durability: { before: durabilityBefore, after: durabilityAfter } }),
  };
}

function objectiveEventClaim(
  event: EventEnvelope,
  payload: JsonRecord,
  eventType: string,
): ObjectiveContinuityClaimMaterial | undefined {
  const objectiveRef = stringField(payload, "sceneQuestionId")
    ?? stringField(payload, "chapterId");
  if (objectiveRef === undefined) return undefined;
  const transition: ObjectiveContinuityClaimMaterial["transition"] = eventType === "SceneQuestionOpened"
    || eventType === "ChapterStarted"
    ? "opened"
    : "completed";
  const summary = stringField(payload, "question")
    ?? stringField(payload, "reason")
    ?? stringField(payload, "sceneQuestion")
    ?? `该目标已${transition === "opened" ? "开启" : "完成"}。`;
  return {
    ...eventClaimBase(event, `objective:${objectiveRef}`, stringRefs(payload.answerFactIds)),
    kind: "objectiveContinuity",
    objectiveRef,
    transition,
    summary,
  };
}

function storyEventClaim(
  event: EventEnvelope,
  payload: JsonRecord,
  eventType: string,
): StoryContinuityClaimMaterial | undefined {
  const storyRef = stringField(payload, "storyId")
    ?? stringField(payload, "sequelStoryId")
    ?? stringField(payload, "priorStoryId");
  if (storyRef === undefined) return undefined;
  const transition: StoryContinuityClaimMaterial["transition"] = eventType === "StoryConcluded"
    ? "concluded"
    : eventType === "EpilogueChoiceRecorded" ? "epilogue" : "sequel";
  const summary = stringField(payload, "outcome")
    ?? stringField(payload, "choice")
    ?? stringField(payload, "sceneQuestion")
    ?? "该故事的连续性已经更新。";
  const characterRef = stringField(payload, "characterId");
  return {
    ...eventClaimBase(event, `story:${storyRef}`, stringRefs(payload.anchorFactIds)),
    kind: "storyContinuity",
    storyRef,
    transition,
    summary,
    ...(characterRef === undefined ? {} : { characterRefs: [characterRef] }),
  };
}

function eventClaimBase(
  event: EventEnvelope,
  suffix: string,
  basisRefs: readonly (string | undefined)[] = [],
  materialVisibilityPolicyRef?: string,
  inheritEnvelopeVisibility = true,
  requireBasisGrants = false,
): ClaimMaterialBase {
  return eventClaimBaseWithSeparatedBasis(event, suffix, {
    authorityRefs: basisRefs,
    viewerRefs: basisRefs,
    materialVisibilityPolicyRef,
    inheritEnvelopeVisibility,
    requiredViewerRefs: requireBasisGrants ? basisRefs : [],
  });
}

function eventClaimBaseWithSeparatedBasis(
  event: EventEnvelope,
  suffix: string,
  options: Readonly<{
    authorityRefs?: readonly (string | undefined)[];
    viewerRefs?: readonly (string | undefined)[];
    materialVisibilityPolicyRef?: string;
    inheritEnvelopeVisibility?: boolean;
    requiredViewerRefs?: readonly (string | undefined)[];
  }>,
): ClaimMaterialBase {
  const authorityRefs = uniqueDefinedRefs([
    event.eventId,
    event.rootActionId,
    event.scopeProofHash,
    ...(options.authorityRefs ?? []),
  ]);
  const viewerRefs = uniqueDefinedRefs([event.eventId, ...(options.viewerRefs ?? [])]);
  return {
    claimRef: claimRefForEvent(event, suffix),
    basis: { authorityRefs, viewerRefs },
    visibility: visibilityForEvent(
      event,
      options.materialVisibilityPolicyRef,
      options.inheritEnvelopeVisibility ?? true,
      options.requiredViewerRefs ?? [],
    ),
  };
}

function visibilityForEvent(
  event: EventEnvelope,
  materialVisibilityPolicyRef?: string,
  inheritEnvelopeVisibility = true,
  requiredViewerRefs: readonly (string | undefined)[] = [],
): ClaimVisibility {
  const policies = uniqueDefinedRefs([
    !inheritEnvelopeVisibility
      || (isPublicVisibility(event.visibilityPolicyId) && event.secrecy === "public")
      ? undefined
      : event.visibilityPolicyId,
    materialVisibilityPolicyRef === undefined || isPublicVisibility(materialVisibilityPolicyRef)
      ? undefined
      : materialVisibilityPolicyRef,
    ...requiredViewerRefs,
  ]);
  return policies.length === 0
    ? { kind: "public" }
    : { kind: "grants", allOf: policies };
}

function abilityDefinition(
  range: VerifiedClaimCommittedRange,
  abilityRef: string,
): JsonRecord | undefined {
  const candidates = [
    range.state.combatRuntime.definitions[abilityRef],
    range.state.campaignRuntime.definitions[abilityRef],
    range.priorState.combatRuntime.definitions[abilityRef],
    range.priorState.campaignRuntime.definitions[abilityRef],
  ];
  return candidates.find(isRecord);
}

function abilityDisplayName(definition: JsonRecord | undefined, _abilityRef: string): string {
  if (definition !== undefined) {
    const content = isRecord(definition.content) ? definition.content : undefined;
    const direct = firstStringField(definition, ["name", "label", "displayName"])
      ?? (content === undefined
        ? undefined
        : firstStringField(content, ["name", "label", "displayName"]));
    if (direct !== undefined) return viewerSafeDisplayText(direct, "该能力");
    const sourceName = firstStringField(definition, ["sourceSpellId", "mechanicalKey"]);
    if (sourceName !== undefined) return viewerSafeDisplayText(sourceName, "该能力");
  }
  return "该能力";
}

function abilityEffectDescription(
  definition: JsonRecord | undefined,
  mechanicalResult: JsonRecord,
  concentration: boolean,
): AbilityEffectAppliedClaimMaterial["effect"] {
  const effects = definition !== undefined && Array.isArray(definition.effects)
    ? definition.effects.filter(isRecord)
    : [];
  const labels = effects.flatMap((effect) => {
    const label = stringField(effect, "label");
    return label === undefined ? [] : [label];
  });
  const content = definition !== undefined && isRecord(definition.content)
    ? definition.content
    : undefined;
  const summary = labels.length > 0
    ? labels.join("；")
    : firstStringField(mechanicalResult, ["summary", "outcome", "description"])
      ?? (content === undefined
        ? undefined
        : firstStringField(content, ["summary", "effect", "description"]))
      ?? "该能力的已提交效果已经生效。";
  const dice = /\b([1-9][0-9]*d[1-9][0-9]*)\b/iu.exec(summary)?.[1];
  const firstEffect = effects[0];
  const definitionEffect = definition !== undefined && isRecord(definition.effect)
    ? definition.effect
    : undefined;
  const duration = definitionEffect === undefined
    ? undefined
    : stringField(definitionEffect, "durationMicros");
  return {
    summary,
    ...(firstEffect === undefined || stringField(firstEffect, "tag") === undefined
      ? {}
      : { appliesTo: stringField(firstEffect, "tag") }),
    ...(dice === undefined ? {} : { bonusDice: dice }),
    ...(duration === undefined ? {} : { duration }),
    ...(concentration || definitionEffect?.kind === "concentration"
      ? { concentration: true }
      : {}),
  };
}

function abilityTargetRefs(mechanicalResult: JsonRecord, sourceRef: string): string[] {
  const direct = uniqueDefinedRefs([
    stringField(mechanicalResult, "targetEntityId"),
    stringField(mechanicalResult, "targetRef"),
    ...stringRefs(mechanicalResult.targetEntityIds),
    ...stringRefs(mechanicalResult.targetRefs),
  ]);
  if (direct.length > 0) return direct;
  for (const value of Object.values(mechanicalResult)) {
    if (!isRecord(value)) continue;
    const nested = uniqueDefinedRefs([
      stringField(value, "targetEntityId"),
      stringField(value, "targetRef"),
      ...stringRefs(value.targetEntityIds),
      ...stringRefs(value.targetRefs),
    ]);
    if (nested.length > 0) return nested;
  }
  return [sourceRef];
}

function interactionCheckKind(
  payload: JsonRecord,
): "abilityCheck" | "attack" | "save" {
  const check = isRecord(payload.check) ? payload.check : undefined;
  return check?.resolutionKind === "attack" ? "attack" : "abilityCheck";
}

function semanticSceneDescription(content: JsonRecord): string | undefined {
  const semantics = isRecord(content.semantics) ? content.semantics : undefined;
  const values = uniqueText([
    firstStringField(content, ["name", "label"]),
    stringField(content, "description"),
    stringField(content, "materialDescription"),
    semantics === undefined ? undefined : firstStringField(semantics, ["name", "label"]),
    semantics === undefined ? undefined : stringField(semantics, "description"),
    semantics === undefined ? undefined : stringField(semantics, "materialDescription"),
  ]);
  return values.length === 0 ? undefined : values.join("；");
}

function semanticRevisionSummary(
  semanticKind: DefinitionRevisedClaimMaterial["definitionKind"],
  _definitionRef: string,
  priorContent: JsonRecord | undefined,
  nextContent: JsonRecord,
): string {
  const priorSemantics = priorContent === undefined
    ? undefined
    : isRecord(priorContent.semantics) ? priorContent.semantics : priorContent;
  const nextSemantics = isRecord(nextContent.semantics) ? nextContent.semantics : nextContent;
  const label = viewerSafeDisplayText(firstStringField(nextSemantics, ["name", "label"])
    ?? firstStringField(nextContent, ["name", "label"])
    ?? "该定义", "该定义");
  const scalarFields = [
    ["attitude", "态度"],
    ["description", "描述"],
    ["voice", "说话方式"],
    ["materialDescription", "材质描述"],
    ["observableState", "可见状态"],
    ["state", "状态"],
    ["interactionHint", "可互动方式"],
  ] as const;
  for (const [field, labelText] of scalarFields) {
    const before = priorSemantics === undefined ? undefined : stringField(priorSemantics, field);
    const after = stringField(nextSemantics, field);
    if (after !== undefined && after !== before) {
      const safeAfter = viewerSafeDisplayText(after, "");
      return safeAfter.length === 0
        ? `${label}的${labelText}已更新。`
        : `${label}的${labelText}变为：${safeAfter}。`;
    }
  }
  for (const [field, labelText] of [
    ["goals", "目标"],
    ["relationships", "关系"],
    ["affordances", "可互动方式"],
  ] as const) {
    const before = priorSemantics?.[field];
    const after = nextSemantics[field];
    if (after !== undefined && canonicalSha256(after) !== canonicalSha256(before ?? null)) {
      return `${label}的${labelText}已更新。`;
    }
  }
  return semanticKind === "npc"
    ? `${label}的可见人物定义已更新。`
    : `${label}的可见定义已更新。`;
}

function semanticMaterializationSummary(
  semanticKind: DefinitionRevisedClaimMaterial["definitionKind"],
  _definitionRef: string,
  content: JsonRecord,
): string {
  const semantics = isRecord(content.semantics) ? content.semantics : undefined;
  const label = viewerSafeDisplayText(firstStringField(content, ["name", "label"])
    ?? (semantics === undefined ? undefined : firstStringField(semantics, ["name", "label"]))
    ?? "该定义", "该定义");
  return semanticKind === "sceneFeature"
    ? `${label}已成为可引用的场景事物。`
    : semanticKind === "worldFact"
      ? `${label}已成为已固化的世界事实。`
      : `${label}已成为已固化的世界定义。`;
}

function relationTransitionSummary(
  relationKind: string,
  change: RelationChangedClaimMaterial["change"],
): string {
  const transition = change === "began" ? "建立" : change === "ended" ? "结束" : "更新";
  return `两个相关对象的 ${relationKind} 关系已${transition}。`;
}

function semanticSceneState(content: JsonRecord): string | undefined {
  const semantics = isRecord(content.semantics) ? content.semantics : undefined;
  return firstStringField(content, ["observableState", "state"])
    ?? (semantics === undefined
      ? undefined
      : firstStringField(semantics, ["observableState", "state"]));
}

function semanticInteractionHint(content: JsonRecord): string | undefined {
  const semantics = isRecord(content.semantics) ? content.semantics : undefined;
  const direct = firstStringField(content, ["interactionHint", "affordance", "interactivity"])
    ?? (semantics === undefined
      ? undefined
      : firstStringField(semantics, ["interactionHint", "affordance", "interactivity"]));
  if (direct !== undefined) return direct;
  const affordances = Array.isArray(content.affordances)
    ? content.affordances.filter(isNonEmptyString)
    : semantics !== undefined && Array.isArray(semantics.affordances)
      ? semantics.affordances.filter(isNonEmptyString)
      : [];
  return affordances.length === 0 ? undefined : [...new Set(affordances)].join("；");
}

function inventorySummary(
  eventType: string,
  payload: JsonRecord,
): string {
  if (eventType === "ItemMaterialized") return "该物品已实例化。";
  if (eventType === "ItemAcquired") {
    return "角色获得了该物品。";
  }
  if (eventType === "ItemTransferred") {
    return "该物品已从原持有者转交给新持有者。";
  }
  const after = finiteNumber(payload.quantityAfter);
  return after === undefined ? "该物品已使用。" : `该物品已使用，剩余 ${after}。`;
}

function validateClaimCommittedRange(range: VerifiedClaimCommittedRange): void {
  if (!isRecord(range)
    || !isRecord(range.receipt)
    || !isNonEmptyString(range.receipt.receiptId)
    || !isNonEmptyString(range.receipt.rootActionId)
    || !isNonEmptyString(range.actorCharacterId)
    || !isRecord(range.priorState)
    || !isRecord(range.state)
    || !Array.isArray(range.events)
    || range.events.length === 0) {
    throw new TypeError("CLAIM_COMMITTED_RANGE_INVALID");
  }
  if (range.events.some((event) => !isRecord(event)
    || event.rootActionId !== range.receipt.rootActionId
    || event.roomId !== range.state.roomId
    || event.runtimeEpochId !== range.state.runtimeEpochId)) {
    throw new TypeError("CLAIM_COMMITTED_RANGE_BINDING_MISMATCH");
  }
  const first = range.events[0];
  const last = range.events[range.events.length - 1];
  if (first.eventSeq !== range.receipt.eventRange.fromEventSeq
    || last.eventSeq !== range.receipt.eventRange.toEventSeq) {
    throw new TypeError("CLAIM_COMMITTED_RANGE_RECEIPT_MISMATCH");
  }
}

function deduplicateMaterials(materials: readonly ClaimMaterial[]): ClaimMaterial[] {
  const byRef = new Map<string, ClaimMaterial>();
  for (const material of materials) {
    if (!byRef.has(material.claimRef)) byRef.set(material.claimRef, material);
  }
  return [...byRef.values()];
}

function claimRefForEvent(event: EventEnvelope, suffix: string): string {
  return `claim:${event.eventId}:${suffix.replace(/[^a-zA-Z0-9:_-]+/gu, "-")}`;
}

function claimRefForRange(receiptId: string, suffix: string): string {
  return `claim:${receiptId}:${suffix}`;
}

function stringField(value: JsonRecord, key: string): string | undefined {
  return isNonEmptyString(value[key]) ? value[key] as string : undefined;
}

function firstStringField(value: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const candidate = stringField(value, key);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function stringRefs(value: unknown): string[] {
  return Array.isArray(value) ? uniqueDefinedRefs(value.filter(isNonEmptyString)) : [];
}

function uniqueDefinedRefs(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))].sort(compareRefs);
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : finiteNumber(value);
}

function canonicalSense(value: unknown): SensoryEvidenceClaimMaterial["sense"] {
  return value === "sight"
    || value === "hearing"
    || value === "smell"
    || value === "touch"
    || value === "taste"
    || value === "special"
    ? value
    : "special";
}

const AUTHORITY_REFERENCE_IN_TEXT = /[a-z][a-z0-9-]{1,63}:[a-z0-9][a-z0-9._:/-]*/iu;

function viewerSafeDisplayText(value: unknown, fallback: string): string {
  return isNonEmptyString(value) && !AUTHORITY_REFERENCE_IN_TEXT.test(value)
    ? value
    : fallback;
}

function isSemanticDefinitionKind(
  value: unknown,
): value is DefinitionRevisedClaimMaterial["definitionKind"] {
  return value === "npc"
    || value === "item"
    || value === "worldFact"
    || value === "sceneFeature"
    || value === "worldRelation"
    || value === "location"
    || value === "passage";
}

function isPublicVisibility(value: string): boolean {
  return value === "visibility:public" || value.startsWith("visibility:public:");
}

function normalizedViewerDisplayNames(
  value: ViewerClaimGrants["displayNames"],
  visibleRefs: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (!isRecord(value)) throw new TypeError("VIEWER_DISPLAY_NAMES_INVALID");
  const entries = Object.entries(value).sort(([left], [right]) => compareRefs(left, right));
  const result = new Map<string, string>();
  for (const [ref, name] of entries) {
    requireRef(ref, "viewerDisplayName");
    if (!visibleRefs.has(ref)
      || !isNonEmptyString(name)
      || name.trim() !== name
      || AUTHORITY_REFERENCE_IN_TEXT.test(name)) {
      throw new TypeError("VIEWER_DISPLAY_NAME_INVALID");
    }
    result.set(ref, name);
  }
  return result;
}

/**
 * Projects one authority-only batch to one Viewer. Authority basis refs never
 * cross this seam, and its hash is intentionally excluded so hidden changes
 * cannot perturb an otherwise identical Viewer payload.
 */
export function projectRenderableClaims(
  authorityClaims: FrozenAuthorityClaims,
  grants: ViewerClaimGrants,
): FrozenRenderableClaims {
  validateFrozenAuthorityClaims(authorityClaims);
  requireRef(grants.viewerKey, "viewerKey");
  if (!Array.isArray(grants.refs)) throw new TypeError("VIEWER_GRANTS_ARRAY_REQUIRED");
  const normalizedGrantRefs = uniqueSortedRefs(grants.refs, "viewerGrant");
  const visibleRefs = new Set(normalizedGrantRefs);
  const displayNames = normalizedViewerDisplayNames(grants.displayNames, visibleRefs);
  const projectionHash = grants.projectionHash ?? canonicalSha256({
    schema: "zhuwei.synthetic-viewer-claim-grants/vnext-1",
    viewerKey: grants.viewerKey,
    refs: normalizedGrantRefs,
    displayNames: Object.fromEntries(displayNames),
    ...(grants.knowledgeIdentities === undefined ? {} : { knowledgeIdentities: grants.knowledgeIdentities }),
  });
  if (!isSha256(projectionHash)) throw new TypeError("VIEWER_PROJECTION_HASH_INVALID");
  const claims = authorityClaims.claims.flatMap((claim) => {
    if (!claimIsVisible(claim, visibleRefs) || !payloadRefsAreVisible(claim, visibleRefs)) return [];
    if (claim.kind === "knowledgeReview" || claim.kind === "knowledgeAcquisition") {
      const names = new Map(displayNames);
      const records = claim.kind === "knowledgeReview" ? claim.records : [claim.record];
      const selected = new Set(records.map(record => record.knowledgeRef));
      const allowed = new Set(heldKnowledgeDisplayRefs(records));
      for (const identity of grants.knowledgeIdentities ?? []) {
        if (!selected.has(identity.knowledgeRef) || !allowed.has(identity.ref)) continue;
        const validated = normalizedViewerDisplayNames({ [identity.ref]: identity.name }, allowed);
        for (const [ref, name] of validated) names.set(ref, name);
      }
      return [renderableClaim(claim, visibleRefs, names)];
    }
    return [renderableClaim(claim, visibleRefs, displayNames)];
  });
  const core = {
    schema: RENDERABLE_CLAIMS_SCHEMA,
    receiptId: authorityClaims.receiptId,
    rootActionId: authorityClaims.rootActionId,
    viewerKey: grants.viewerKey,
    projectionHash,
    claims,
  } as const;
  return deepFreeze({
    ...core,
    claimsHash: canonicalSha256(core),
  });
}

export function frozenRenderableClaimsConform(value: unknown): value is FrozenRenderableClaims {
  if (!isRecord(value)
    || !hasClosedKeys(value, [
      "schema",
      "receiptId",
      "rootActionId",
      "viewerKey",
      "projectionHash",
      "claims",
      "claimsHash",
    ])
    || value.schema !== RENDERABLE_CLAIMS_SCHEMA
    || !isNonEmptyString(value.receiptId)
    || !isNonEmptyString(value.rootActionId)
    || !isNonEmptyString(value.viewerKey)
    || !isSha256(value.projectionHash)
    || !Array.isArray(value.claims)
    || !isSha256(value.claimsHash)
    || !value.claims.every(renderableClaimConform)
    || value.claims.length !== new Set(value.claims.map((claim) =>
      isRecord(claim) ? claim.claimRef : undefined)).size) return false;
  const core = {
    schema: value.schema,
    receiptId: value.receiptId,
    rootActionId: value.rootActionId,
    viewerKey: value.viewerKey,
    projectionHash: value.projectionHash,
    claims: value.claims,
  };
  return value.claimsHash === canonicalSha256(core);
}

function hasClosedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

function claimPayloadHasClosedShape(
  value: Record<string, unknown>,
  baseKeys: readonly string[],
  renderable = false,
): boolean {
  const required = (...keys: string[]) => [...baseKeys, ...keys];
  switch (value.kind) {
    case "socialCommitment": return hasClosedKeys(value, required("commitment")) && socialCommitmentConform(value.commitment);
    case "knowledgeReview": return hasClosedKeys(value, required("characterId", "inquiry", "scope", "records"));
    case "knowledgeAcquisition": return hasClosedKeys(value, required("characterId", "record"));
    case "narrativeDetail": return hasClosedKeys(value, required("commitmentRef", "description"));
    case "mechanicalOutcome":
      return hasClosedKeys(value, required("summary"), [
        "outcomeCode", "outcomeKind", "actorRef", "targetRefs", "check",
      ]) && (value.check === undefined || (isRecord(value.check)
        && hasClosedKeys(value.check, ["kind", "result"], ["total", "dc"])));
    case "abilityEffectApplied":
      return hasClosedKeys(value, required(
        "abilityRef", "abilityName", "sourceRef", "targetRefs", "effect",
      )) && isRecord(value.effect)
        && hasClosedKeys(value.effect, ["summary"], [
          "appliesTo", "bonusDice", "duration", "concentration",
        ]);
    case "sensoryEvidence":
      return hasClosedKeys(value, required("observerRef", "sense", "evidence"), ["subjectRef"]);
    case "sourceClaim":
      return hasClosedKeys(value, required(
        "statement",
        ...(renderable ? ["speakerName"] : []),
      ), ["speakerRef", "acquisition"]) && (value.acquisition === undefined || (isRecord(value.acquisition)
        && hasClosedKeys(value.acquisition, ["recipientRef", "layer"])));
    case "characterInference":
      return hasClosedKeys(value, required(
        "characterRef",
        "inference",
        ...(renderable ? ["characterName"] : []),
      ), ["confidence"]);
    case "sceneFeature":
      return hasClosedKeys(value, required("featureRef", "description"), [
        "state", "interactionHint",
      ]);
    case "relationChanged":
      return hasClosedKeys(value, required(
        "relationRef", "relationKind", "subjectRef", "objectRef", "change", "description",
      ));
    case "definitionRevised":
      return hasClosedKeys(value, required("definitionRef", "definitionKind", "summary"));
    case "inventoryOutcome":
      return hasClosedKeys(value, required("itemRef", "change", "summary"), [
        "characterRefs", "operation", "sourceBefore", "quantity", "charges", "durability", "state",
      ]) && ["quantity", "charges", "durability"].every((field) =>
        value[field] === undefined
        || (isRecord(value[field]) && hasClosedKeys(value[field], ["before", "after"])));
    case "objectiveContinuity":
      return hasClosedKeys(value, required("objectiveRef", "transition", "summary"), [
        "participantRefs",
      ]);
    case "storyContinuity":
      return hasClosedKeys(value, required("storyRef", "transition", "summary"), [
        "characterRefs",
      ]);
    case "pressure":
      return hasClosedKeys(value, required("description"), ["sourceRef"]);
    case "opportunity":
      return hasClosedKeys(value, required("description"), ["targetRef", "actionHint"]);
    case "actionCommitted":
      return hasClosedKeys(value, required("actorRef", "status", "summary"));
    default:
      return false;
  }
}

function cloneAndValidateMaterial(material: ClaimMaterial): ClaimMaterial {
  if (!isRecord(material)
    || !claimPayloadHasClosedShape(material, ["claimRef", "kind", "basis", "visibility"])) {
    throw new TypeError("CLAIM_MATERIAL_OBJECT_REQUIRED");
  }
  requireRef(material.claimRef, "claimRef");
  if (!isRecord(material.basis)
    || !hasClosedKeys(material.basis, ["authorityRefs", "viewerRefs"])
    || !Array.isArray(material.basis.authorityRefs)
    || !Array.isArray(material.basis.viewerRefs)) {
    throw new TypeError("CLAIM_BASIS_INVALID");
  }
  uniqueSortedRefs(material.basis.authorityRefs, "authorityBasis");
  uniqueSortedRefs(material.basis.viewerRefs, "viewerBasis");
  if (!isRecord(material.visibility)
    || !hasClosedKeys(
      material.visibility,
      ["kind"],
      material.visibility.kind === "grants" ? ["allOf"] : [],
    )
    || (material.visibility.kind !== "public" && material.visibility.kind !== "grants")) {
    throw new TypeError("CLAIM_VISIBILITY_INVALID");
  }
  if (material.visibility.kind === "grants") {
    if (!Array.isArray(material.visibility.allOf)) throw new TypeError("CLAIM_GRANTS_INVALID");
    uniqueSortedRefs(material.visibility.allOf, "visibilityGrant");
  }
  if (!CLAIM_KINDS.has(material.kind)) throw new TypeError("CLAIM_KIND_UNKNOWN");
  validateMaterialPayload(material);
  const cloned = structuredClone(material) as unknown as Record<string, unknown>;
  cloned.basis = {
    authorityRefs: uniqueSortedRefs(material.basis.authorityRefs, "authorityBasis"),
    viewerRefs: uniqueSortedRefs(material.basis.viewerRefs, "viewerBasis"),
  };
  if (material.visibility.kind === "grants") {
    cloned.visibility = {
      kind: "grants",
      allOf: uniqueSortedRefs(material.visibility.allOf, "visibilityGrant"),
    };
  }
  return cloned as ClaimMaterial;
}

function validateMaterialPayload(material: ClaimMaterial): void {
  switch (material.kind) {
    case "socialCommitment":
      if (!socialCommitmentConform(material.commitment)) throw new TypeError("SOCIAL_COMMITMENT_CLAIM_INVALID");
      return;
    case "knowledgeReview":
      if (!knowledgeReviewContentConform(material)) throw new TypeError("KNOWLEDGE_REVIEW_CLAIM_INVALID");
      return;
    case "knowledgeAcquisition":
      if (!heldKnowledgeRecordConform(material.record) || material.record.characterId !== material.characterId) {
        throw new TypeError("KNOWLEDGE_ACQUISITION_CLAIM_INVALID");
      }
      return;
    case "narrativeDetail":
      requireRef(material.commitmentRef, "narrativeCommitment");
      requireText(material.description, "narrativeDescription");
      return;
    case "mechanicalOutcome":
      requireText(material.summary, "mechanicalSummary");
      if (material.outcomeCode !== undefined) requireText(material.outcomeCode, "outcomeCode");
      optionalRef(material.actorRef, "mechanicalActor");
      optionalRefs(material.targetRefs, "mechanicalTarget");
      if (material.outcomeKind !== undefined
        && (!["worldInteraction", "observe", "social"].includes(material.outcomeKind)
          || !isNonEmptyString(material.actorRef)
          || !["success", "failure", "applied"].includes(String(material.outcomeCode))
          || (material.check === undefined && material.outcomeCode !== "success" && material.outcomeCode !== "applied")
          || (material.check !== undefined && material.check.result !== material.outcomeCode))) {
        throw new TypeError("MECHANICAL_OUTCOME_KIND_INVALID");
      }
      if (material.check !== undefined
        && (!isRecord(material.check)
          || !["abilityCheck", "attack", "save"].includes(String(material.check.kind))
          || !["success", "failure"].includes(String(material.check.result))
          || (material.check.total !== undefined && !Number.isFinite(material.check.total))
          || (material.check.dc !== undefined && !Number.isFinite(material.check.dc)))) {
        throw new TypeError("MECHANICAL_CHECK_INVALID");
      }
      return;
    case "abilityEffectApplied":
      requireRef(material.abilityRef, "ability");
      requireText(material.abilityName, "abilityName");
      requireRef(material.sourceRef, "abilitySource");
      optionalRefs(material.targetRefs, "abilityTarget", true);
      if (!isRecord(material.effect)) throw new TypeError("ABILITY_EFFECT_INVALID");
      requireText(material.effect.summary, "abilityEffectSummary");
      for (const [field, value] of [
        ["abilityEffectAppliesTo", material.effect.appliesTo],
        ["abilityEffectBonusDice", material.effect.bonusDice],
        ["abilityEffectDuration", material.effect.duration],
      ] as const) {
        if (value !== undefined) requireText(value, field);
      }
      if (material.effect.concentration !== undefined
        && typeof material.effect.concentration !== "boolean") {
        throw new TypeError("ABILITY_EFFECT_CONCENTRATION_INVALID");
      }
      return;
    case "sensoryEvidence":
      requireRef(material.observerRef, "sensoryObserver");
      optionalRef(material.subjectRef, "sensorySubject");
      if (!["sight", "hearing", "smell", "touch", "taste", "special"]
        .includes(material.sense)) throw new TypeError("SENSORY_SENSE_INVALID");
      requireText(material.evidence, "sensoryEvidence");
      return;
    case "sourceClaim":
      optionalRef(material.speakerRef, "sourceSpeaker");
      requireText(material.statement, "sourceStatement");
      if (material.acquisition !== undefined) {
        requireRef(material.acquisition.recipientRef, "sourceRecipient");
        if (!["hint", "partial", "full"].includes(material.acquisition.layer)) throw new TypeError("SOURCE_CLAIM_LAYER_INVALID");
      }
      return;
    case "characterInference":
      requireRef(material.characterRef, "inferenceCharacter");
      requireText(material.inference, "inference");
      if (material.confidence !== undefined) requireText(material.confidence, "inferenceConfidence");
      return;
    case "sceneFeature":
      requireRef(material.featureRef, "sceneFeature");
      requireText(material.description, "sceneFeatureDescription");
      if (material.state !== undefined) requireText(material.state, "sceneFeatureState");
      if (material.interactionHint !== undefined) {
        requireText(material.interactionHint, "sceneFeatureInteractionHint");
      }
      return;
    case "relationChanged":
      [material.relationRef, material.subjectRef, material.objectRef]
        .forEach((ref) => requireRef(ref, "relation"));
      requireText(material.relationKind, "relationKind");
      if (!["began", "ended", "updated"].includes(material.change)) {
        throw new TypeError("RELATION_CHANGE_INVALID");
      }
      requireText(material.description, "relationDescription");
      return;
    case "definitionRevised":
      requireRef(material.definitionRef, "definition");
      if (!["npc", "item", "worldFact", "sceneFeature", "worldRelation", "location", "passage"]
        .includes(material.definitionKind)) throw new TypeError("DEFINITION_KIND_INVALID");
      requireText(material.summary, "definitionSummary");
      return;
    case "inventoryOutcome":
      requireRef(material.itemRef, "inventoryItem");
      if (![
        "materialized", "acquired", "transferred", "used", "consumed", "damaged",
        "repaired", "destroyed", "updated",
      ].includes(material.change)) throw new TypeError("INVENTORY_CHANGE_INVALID");
      optionalRefs(material.characterRefs, "inventoryCharacter");
      requireText(material.summary, "inventorySummary");
      if (material.operation !== undefined && !inventoryClaimOperationConform(material.operation)) {
        throw new TypeError("INVENTORY_CLAIM_OPERATION_INVALID");
      }
      if (material.sourceBefore !== undefined
        && (material.operation === undefined || !inventorySourceBeforeConform(material.sourceBefore))) {
        throw new TypeError("INVENTORY_CLAIM_SOURCE_INVALID");
      }
      if (material.quantity !== undefined
        && (!Number.isFinite(material.quantity.before)
          || !Number.isFinite(material.quantity.after))) {
        throw new TypeError("INVENTORY_QUANTITY_INVALID");
      }
      for (const transition of [material.charges, material.durability]) {
        if (transition !== undefined
          && (![transition.before, transition.after]
            .every((entry) => entry === null || Number.isFinite(entry)))) {
          throw new TypeError("INVENTORY_TRANSITION_INVALID");
        }
      }
      if (material.state !== undefined) requireText(material.state, "inventoryState");
      return;
    case "objectiveContinuity":
      requireRef(material.objectiveRef, "objective");
      if (!["opened", "advanced", "failed", "abandoned", "completed", "updated"]
        .includes(material.transition)) throw new TypeError("OBJECTIVE_TRANSITION_INVALID");
      optionalRefs(material.participantRefs, "objectiveParticipant");
      requireText(material.summary, "objectiveSummary");
      return;
    case "storyContinuity":
      requireRef(material.storyRef, "story");
      if (!["candidate", "concluded", "epilogue", "sequel", "updated"]
        .includes(material.transition)) throw new TypeError("STORY_TRANSITION_INVALID");
      optionalRefs(material.characterRefs, "storyCharacter");
      requireText(material.summary, "storySummary");
      return;
    case "pressure":
      optionalRef(material.sourceRef, "pressureSource");
      requireText(material.description, "pressureDescription");
      return;
    case "opportunity":
      optionalRef(material.targetRef, "opportunityTarget");
      requireText(material.description, "opportunityDescription");
      if (material.actionHint !== undefined) requireText(material.actionHint, "opportunityActionHint");
      return;
    case "actionCommitted":
      requireRef(material.actorRef, "actionActor");
      if (!["committed", "awaitingInput", "awaitingRandomness", "concluded", "superseded"]
        .includes(material.status)) throw new TypeError("ACTION_STATUS_INVALID");
      requireText(material.summary, "actionSummary");
      return;
  }
}

function renderableClaimConform(value: unknown): boolean {
  if (!isRecord(value)
    || !claimPayloadHasClosedShape(
      value,
      ["claimRef", "kind", "basisRefs", "narrationFacts", ...(value.displayNames === undefined ? [] : ["displayNames"])],
      true,
    )
    || !isNonEmptyString(value.claimRef)
    || !Array.isArray(value.basisRefs)
    || !value.basisRefs.every(isNonEmptyString)
    || !Array.isArray(value.narrationFacts)
    || value.narrationFacts.length === 0
    || !value.narrationFacts.every(isNonEmptyString)
    || value.narrationFacts.length !== new Set(value.narrationFacts).size
    || value.basis !== undefined
    || value.visibility !== undefined
    || value.authorityRefs !== undefined
    || !CLAIM_KINDS.has(value.kind as ClaimMaterial["kind"])) return false;
  try {
    const { basisRefs: _basisRefs, narrationFacts: _narrationFacts, displayNames: frozenNames, ...content } = value;
    const displayNames = new Map<string, string>();
    if(frozenNames!==undefined) {
      if(!isRecord(frozenNames))return false;
      const refs=claimDisplayRefs(content as unknown as ClaimMaterial);
      for(const [ref,name] of Object.entries(frozenNames)) {
        if(!refs.includes(ref)||!isNonEmptyString(name)||AUTHORITY_REFERENCE_IN_TEXT.test(name))return false;
        displayNames.set(ref,name);
      }
    }
    if (value.kind === "abilityEffectApplied") {
      if (!isNonEmptyString(value.abilityRef)
        || !isNonEmptyString(value.abilityName)
        || AUTHORITY_REFERENCE_IN_TEXT.test(value.abilityName)) return false;
      displayNames.set(value.abilityRef, value.abilityName);
    } else if (value.kind === "sourceClaim") {
      if ((value.speakerRef !== undefined && !isNonEmptyString(value.speakerRef))
        || !isNonEmptyString(value.speakerName)
        || AUTHORITY_REFERENCE_IN_TEXT.test(value.speakerName)) return false;
      if (value.speakerRef === undefined && value.speakerName !== "该消息来源") return false;
      if (typeof value.speakerRef === "string") displayNames.set(value.speakerRef, value.speakerName);
      delete content.speakerName;
    } else if (value.kind === "characterInference") {
      if (!isNonEmptyString(value.characterRef)
        || !isNonEmptyString(value.characterName)
        || AUTHORITY_REFERENCE_IN_TEXT.test(value.characterName)) return false;
      displayNames.set(value.characterRef, value.characterName);
      delete content.characterName;
    }
    const material = cloneAndValidateMaterial({
      ...content,
      basis: { authorityRefs: [], viewerRefs: [] },
      visibility: { kind: "public" },
    } as unknown as ClaimMaterial);
    return JSON.stringify(value.narrationFacts)
      === JSON.stringify(narrationFactsForClaim(material, displayNames));
  } catch {
    return false;
  }
}

function validateFrozenAuthorityClaims(value: FrozenAuthorityClaims): void {
  if (!isRecord(value)
    || value.schema !== AUTHORITY_CLAIMS_SCHEMA
    || typeof value.receiptId !== "string"
    || typeof value.rootActionId !== "string"
    || !Array.isArray(value.claims)
    || typeof value.authorityClaimsHash !== "string") {
    throw new TypeError("AUTHORITY_CLAIMS_INVALID");
  }
  const core = {
    schema: value.schema,
    receiptId: value.receiptId,
    rootActionId: value.rootActionId,
    claims: value.claims,
  };
  if (value.authorityClaimsHash !== canonicalSha256(core)) {
    throw new TypeError("AUTHORITY_CLAIMS_HASH_MISMATCH");
  }
}

function claimIsVisible(claim: ClaimMaterial, grants: ReadonlySet<string>): boolean {
  return claim.visibility.kind === "public"
    || claim.visibility.allOf.every((ref) => grants.has(ref));
}

function payloadRefsAreVisible(claim: ClaimMaterial, grants: ReadonlySet<string>): boolean {
  const refs = requiredPayloadRefs(claim);
  return refs.every((ref) => grants.has(ref));
}

function requiredPayloadRefs(claim: ClaimMaterial): readonly string[] {
  switch (claim.kind) {
    case "socialCommitment": return socialCommitmentRefs(claim.commitment);
    case "knowledgeReview": return [claim.characterId, ...claim.records.map(record => record.knowledgeRef)];
    case "knowledgeAcquisition": return [claim.characterId, claim.record.knowledgeRef];
    case "narrativeDetail": return [claim.commitmentRef];
    case "mechanicalOutcome":
      return [...(claim.actorRef === undefined ? [] : [claim.actorRef]), ...(claim.targetRefs ?? [])];
    case "abilityEffectApplied":
      return [claim.abilityRef, claim.sourceRef, ...claim.targetRefs];
    case "sensoryEvidence":
      return [claim.observerRef, ...(claim.subjectRef === undefined ? [] : [claim.subjectRef])];
    case "sourceClaim":
      // Source attribution is not permission to target or reveal that entity.
      return claim.acquisition === undefined ? [] : [claim.acquisition.recipientRef];
    case "characterInference":
      return [claim.characterRef];
    case "sceneFeature":
      return [claim.featureRef];
    case "relationChanged":
      return [claim.relationRef, claim.subjectRef, claim.objectRef];
    case "definitionRevised":
      return [claim.definitionRef];
    case "inventoryOutcome":
      return [claim.itemRef, ...(claim.operation && "assemblyRef" in claim.operation ? [claim.operation.assemblyRef] : []), ...(claim.characterRefs ?? []),
        ...(claim.operation === undefined ? [] : [claim.operation.actorRef,
          ...(claim.operation.kind === "transfer" ? [claim.operation.recipientRef] : [])])];
    case "objectiveContinuity":
      return [claim.objectiveRef, ...(claim.participantRefs ?? [])];
    case "storyContinuity":
      return [claim.storyRef, ...(claim.characterRefs ?? [])];
    case "pressure":
      return claim.sourceRef === undefined ? [] : [claim.sourceRef];
    case "opportunity":
      return claim.targetRef === undefined ? [] : [claim.targetRef];
    case "actionCommitted":
      return [claim.actorRef];
  }
}

function claimDisplayRefs(claim: ClaimMaterial): readonly string[] {
  return claim.kind === "knowledgeReview" ? [...requiredPayloadRefs(claim), ...heldKnowledgeDisplayRefs(claim.records)]
    : claim.kind === "knowledgeAcquisition" ? [...requiredPayloadRefs(claim), ...heldKnowledgeDisplayRefs([claim.record])]
    : claim.kind === "inventoryOutcome" && claim.sourceBefore !== undefined
      ? [...requiredPayloadRefs(claim), claim.sourceBefore.disposition === "held" ? claim.sourceBefore.holderRef : claim.sourceBefore.sceneRef]
    : claim.kind === "sourceClaim" ? [...requiredPayloadRefs(claim), ...(claim.speakerRef === undefined ? [] : [claim.speakerRef])] : requiredPayloadRefs(claim);
}

function renderableClaim(
  claim: ClaimMaterial,
  grants: ReadonlySet<string>,
  displayNames: ReadonlyMap<string, string>,
): RenderableClaim {
  if (claim.kind === "inventoryOutcome" && claim.sourceBefore !== undefined) {
    const source = claim.sourceBefore;
    const controller = source.disposition === "held" ? source.holderRef : claim.operation?.actorRef;
    const sourceRef = source.disposition === "held" ? source.holderRef : source.sceneRef;
    // Current visibility of a released/transferred item does not grant access
    // to its former holder's private equipment or carrying state.
    if (controller === undefined || !grants.has(`visibility:character-controller:${controller}`)
      || !grants.has(sourceRef)) {
      const { sourceBefore: _privateSource, ...visible } = claim;
      claim = visible;
    }
  }
  const basisRefs = uniqueSortedRefs(
    claim.basis.viewerRefs.filter((ref) => grants.has(ref)),
    "renderableBasis",
  );
  const { basis: _basis, visibility: _visibility, ...content } = claim;
  const projectedContent = claim.kind === "abilityEffectApplied"
    ? {
        ...content,
        abilityName: displayNames.get(claim.abilityRef) ?? "该能力",
      }
    : claim.kind === "sourceClaim"
    ? {
        ...content,
        speakerName: (claim.speakerRef === undefined ? undefined : displayNames.get(claim.speakerRef)) ?? "该消息来源",
      }
    : claim.kind === "characterInference"
      ? {
          ...content,
          characterName: displayNames.get(claim.characterRef) ?? "该角色",
        }
      : content;
  return deepFreeze({
    ...structuredClone(projectedContent),
    basisRefs,
    ...(["mechanicalOutcome","inventoryOutcome","knowledgeReview","knowledgeAcquisition","socialCommitment"].includes(claim.kind) ? {
      displayNames:Object.fromEntries(claimDisplayRefs(claim).filter(ref=>displayNames.has(ref))
        .sort().map(ref=>[ref,displayNames.get(ref)!])),
    } : {}),
    narrationFacts: narrationFactsForClaim(claim, displayNames),
  }) as RenderableClaim;
}

function narrationFactsForClaim(
  claim: ClaimMaterial,
  displayNames: ReadonlyMap<string, string> = new Map(),
): readonly string[] {
  const facts: string[] = [];
  const add = (value: string | undefined, prefix = ""): void => {
    if (!isNonEmptyString(value)) return;
    for (const segment of value.split(/[。！？!?；;\n]+/u).map((entry) => entry.trim())) {
      if (segment.length > 0) facts.push(`${prefix}${segment}`);
    }
  };
  switch (claim.kind) {
    case "socialCommitment": {
      const commitment = claim.commitment;
      const name = (ref: string) => displayNames.get(ref) ?? "该角色";
      if (commitment.kind === "relationship") {
        add(commitment.change, `${commitment.subjectIds.map(name).join("与")}的关系变化：`);
      } else if (commitment.kind === "promise") {
        add(commitment.content, `${name(commitment.promisorId)}向${name(commitment.promiseeId)}作出的承诺（尚未履行）：`);
        add(commitment.condition, "该承诺的履行条件：");
      } else {
        add(commitment.obligation, `${name(commitment.debtorId)}欠${name(commitment.creditorId)}的义务（尚未履行）：`);
        add(commitment.condition, "该债务的履行条件：");
      }
      break;
    }
    case "knowledgeReview":
      facts.push(...heldKnowledgeNarrationFacts(claim.scope, claim.records, displayNames));
      break;
    case "knowledgeAcquisition":
      facts.push(...acquiredKnowledgeNarrationFacts(claim.record, displayNames));
      break;
    case "narrativeDetail":
      add(claim.description);
      break;
    case "mechanicalOutcome":
      if (claim.outcomeKind === "social") {
        add(claim.summary);
        if (claim.check) {
          add(claim.check.result === "success" ? "交谈检定成功" : "交谈检定失败");
          if (claim.check.total !== undefined) add(`检定总值为 ${claim.check.total}`);
          if (claim.check.dc !== undefined) add(`难度为 ${claim.check.dc}`);
        }
        break;
      }
      if (claim.outcomeKind === "observe") {
        const actor = displayNames.get(claim.actorRef!) ?? "行动角色";
        add(`${actor}${claim.summary}`);
        if (claim.check?.total !== undefined) add(`检定总值为 ${claim.check.total}`);
        if (claim.check?.dc !== undefined) add(`难度为 ${claim.check.dc}`);
        break;
      }
      if (claim.outcomeKind === "worldInteraction") {
        const actor = displayNames.get(claim.actorRef!) ?? "行动角色";
        const target = claim.targetRefs?.length
          ? `对${claim.targetRefs.map((ref) => displayNames.get(ref) ?? "该目标").join("、")}` : "";
        const interaction = `${actor}${target}的环境互动`;
        if (claim.outcomeCode === "applied" && claim.check === undefined) {
          const subjects = claim.targetRefs?.map(ref => displayNames.get(ref) ?? "该目标").join("、");
          add(subjects ? `${subjects}的环境变化已发生` : "本次行动的环境后果已发生");
          break;
        }
        const result = claim.check === undefined ? "直接成功"
          : claim.check.kind === "attack" ? claim.check.result === "success" ? "攻击命中" : "攻击未命中"
          : claim.check.result === "success" ? "检定成功" : "检定失败";
        add(`${interaction}${result}`);
        if (claim.check?.total !== undefined) add(`${interaction}检定总值为 ${claim.check.total}`);
        if (claim.check?.dc !== undefined) add(`${interaction}难度为 ${claim.check.dc}`);
        break;
      }
      if (claim.targetRefs?.length) add(`作用目标：${claim.targetRefs.map((ref) => displayNames.get(ref) ?? "该目标").join("、")}`);
      add(claim.summary);
      if (claim.check !== undefined) {
        add(claim.check.kind === "attack"
          ? claim.check.result === "success" ? "攻击命中" : "攻击未命中"
          : claim.check.result === "success" ? "检定成功" : "检定失败");
        if (claim.check.total !== undefined) add(`检定总值为 ${claim.check.total}`);
        if (claim.check.dc !== undefined) add(`难度为 ${claim.check.dc}`);
      }
      break;
    case "abilityEffectApplied":
      add(`能力 ${displayNames.get(claim.abilityRef) ?? "该能力"}`);
      add(claim.effect.summary);
      if (claim.effect.appliesTo !== undefined) add(`作用对象为 ${claim.effect.appliesTo}`);
      if (claim.effect.bonusDice !== undefined) add(`额外骰为 ${claim.effect.bonusDice}`);
      if (claim.effect.duration !== undefined) add(`持续时间为 ${claim.effect.duration}`);
      if (claim.effect.concentration === true) add("需要专注");
      break;
    case "sensoryEvidence":
      add(claim.evidence);
      break;
    case "sourceClaim":
      add(claim.statement, `${(claim.speakerRef === undefined ? undefined : displayNames.get(claim.speakerRef)) ?? "该消息来源"}${claim.acquisition === undefined ? "声称" : "传达的主张"}（尚未由这条记录证实${claim.acquisition?.layer === "hint" ? "，仅有提示" : claim.acquisition?.layer === "partial" ? "，仅掌握部分内容" : ""}）：`);
      break;
    case "characterInference":
      add(claim.inference, `${displayNames.get(claim.characterRef) ?? "该角色"}可据已有证据推断（并非已证实的客观事实）：`);
      if (claim.confidence !== undefined) add(claim.confidence, "该推断的置信说明：");
      break;
    case "sceneFeature":
      add(claim.description);
      if (claim.state !== undefined) add(`状态为 ${claim.state}`);
      if (claim.interactionHint !== undefined) add(`可互动方式为 ${claim.interactionHint}`);
      break;
    case "relationChanged":
      add(claim.description);
      break;
    case "definitionRevised":
    case "objectiveContinuity":
    case "storyContinuity":
    case "actionCommitted":
      add(claim.summary);
      break;
    case "inventoryOutcome":
      if (claim.operation !== undefined) {
        add(inventoryOperationFact(claim.operation, displayNames.get(claim.itemRef) ?? "该物品", displayNames));
      } else {
        add(`物品：${displayNames.get(claim.itemRef) ?? "该物品"}`);
        add(claim.summary);
      }
      for (const [field, label] of [
        ["quantity", "数量"],
        ["charges", "充能次数"],
        ["durability", "耐久"],
      ] as const) {
        const transition = claim[field];
        if (transition !== undefined) {
          add(`${label}由 ${String(transition.before)} 变为 ${String(transition.after)}`);
        }
      }
      if (claim.state !== undefined) add(claim.operation === undefined ? `物品状态为 ${claim.state}`
        : `${displayNames.get(claim.itemRef) ?? "该物品"}的状态为 ${claim.state}`);
      break;
    case "pressure":
      add(claim.description);
      break;
    case "opportunity":
      add(claim.description);
      if (claim.actionHint !== undefined) add(`可采取的行动为 ${claim.actionHint}`);
      break;
  }
  const canonical = uniqueText(facts);
  if (canonical.length === 0 || canonical.some((fact) => AUTHORITY_REFERENCE_IN_TEXT.test(fact))) {
    throw new TypeError("VIEWER_NARRATION_FACT_INVALID");
  }
  return Object.freeze(canonical);
}

function uniqueSortedRefs(values: readonly unknown[], label: string): string[] {
  const refs = values.map((value) => requireRef(value, label));
  return [...new Set(refs)].sort(compareRefs);
}

function requireRef(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label.toUpperCase()}_REF_INVALID`);
  }
  return value;
}

function optionalRef(value: unknown, label: string): void {
  if (value !== undefined) requireRef(value, label);
}

function optionalRefs(
  value: readonly unknown[] | undefined,
  label: string,
  required = false,
): void {
  if (value === undefined) {
    if (required) throw new TypeError(`${label.toUpperCase()}_REFS_REQUIRED`);
    return;
  }
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new TypeError(`${label.toUpperCase()}_REFS_INVALID`);
  }
  uniqueSortedRefs(value, label);
}

function requireText(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) throw new TypeError(`${label.toUpperCase()}_TEXT_INVALID`);
  return value;
}

function compareRefs(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

const CLAIM_KINDS = new Set<ClaimMaterial["kind"]>([
  "socialCommitment",
  "knowledgeAcquisition",
  "knowledgeReview",
  "narrativeDetail",
  "mechanicalOutcome",
  "abilityEffectApplied",
  "sensoryEvidence",
  "sourceClaim",
  "characterInference",
  "sceneFeature",
  "relationChanged",
  "definitionRevised",
  "inventoryOutcome",
  "objectiveContinuity",
  "storyContinuity",
  "pressure",
  "opportunity",
  "actionCommitted",
]);
