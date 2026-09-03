import { canonicalSha256 } from "../profiles/canonical";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  JsonRecord,
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
  speakerRef: string;
  statement: string;
}>;

export type CharacterInferenceClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "characterInference";
  characterRef: string;
  inference: string;
}>;

export type SceneFeatureClaimMaterial = ClaimMaterialBase & Readonly<{
  kind: "sceneFeature";
  featureRef: string;
  description: string;
  state?: string;
  interactionHint?: string;
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
  definitionKind: "npc" | "item" | "worldFact" | "sceneFeature" | "worldRelation";
  summary: string;
}>;

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

export type ClaimMaterial =
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
}>;

export type RenderableClaim =
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
}>;

const VNEXT_CLAIMS_ROOT_EVENT_TYPES = new Set([
  "AtomicWorldInteractionStepsResolved",
  "SemanticDefinitionMaterialized",
  "SemanticDefinitionRevised",
  "WorldInteractionFeasibilityRuled",
  "WorldInteractionResolved",
]);

const VNEXT_DIRECT_CLAIM_EVENT_TYPES = new Set([
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
  "AtomicWorldInteractionStepsResolved",
  "CanonicalFactDeclared",
  "DiceRolled",
  "RandomnessRequested",
]);

/**
 * Stage-three is an isolated mixed manifest: its two new vertical slices use
 * FrozenRenderableClaims while inherited product-0.4 actions keep their
 * existing observer-projection contract. Routing is based on an explicit
 * committed event family, never on whether Claims happened to build or fail.
 */
export function committedRangeUsesFrozenRenderableClaims(
  events: readonly Readonly<{ eventType: unknown }>[],
): boolean {
  return events.some(({ eventType }) =>
    typeof eventType === "string" && VNEXT_CLAIMS_ROOT_EVENT_TYPES.has(eventType));
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
    const payload = recordOrEmpty(event.payload);
    const eventType = String(event.eventType);
    const materialCountBeforeEvent = materials.length;
    switch (eventType) {
      case "SemanticDefinitionMaterialized":
        materials.push(...semanticDefinitionMaterializationClaims(event, payload));
        break;
      case "SemanticDefinitionRevised":
        materials.push(...semanticDefinitionRevisionClaims(
          event,
          payload,
          range,
        ));
        break;
      case "WorldInteractionFeasibilityRuled":
        materials.push(...worldInteractionFeasibilityClaims(event, payload, range));
        break;
      case "WorldInteractionResolved":
        materials.push(...worldInteractionClaims(
          event,
          payload,
          range,
          !hasDedicatedSensoryEvidence,
        ));
        break;
      case "AbilityInvoked": {
        const claim = abilityEffectClaim(event, payload, range);
        if (claim !== undefined) materials.push(claim);
        break;
      }
      case "ImprovisedCheckResolved": {
        const request = isRecord(payload.request) ? payload.request : {};
        const actorRef = stringField(request, "actorCharacterId") ?? range.actorCharacterId;
        materials.push({
          ...eventClaimBase(event, "check", stringRefs(request.basisRefs)),
          kind: "mechanicalOutcome",
          actorRef,
          outcomeCode: stringField(payload, "outcome"),
          summary: stringField(payload, "outcome")
            ?? (payload.succeeded === true ? "检定成功。" : "检定失败。"),
          check: {
            kind: "abilityCheck",
            result: payload.succeeded === true ? "success" : "failure",
            ...(finiteNumber(payload.total) === undefined ? {} : { total: finiteNumber(payload.total) }),
            ...(finiteNumber(request.dc) === undefined ? {} : { dc: finiteNumber(request.dc) }),
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
        const targetRef = stringField(payload, "targetId");
        if (targetRef === undefined) break;
        const amount = finiteNumber(payload.amount);
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
      case "ResourceChanged":
      case "ResourceUsed": {
        const actorRef = stringField(payload, "entityId") ?? stringField(payload, "characterId");
        const resourceRef = stringField(payload, "resourceId");
        if (actorRef === undefined || resourceRef === undefined) break;
        const after = finiteNumber(payload.resourceAfter) ?? finiteNumber(payload.after);
        materials.push({
          ...eventClaimBase(event, `resource:${resourceRef}`),
          kind: "mechanicalOutcome",
          actorRef,
          outcomeCode: "resourceChanged",
          summary: after === undefined
            ? "该资源已经消耗。"
            : `该资源的剩余数量为 ${after}。`,
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
        if (characterRef === undefined || inference === undefined) break;
        materials.push({
          ...eventClaimBase(event, "inference", stringRefs(payload.evidenceRefs)),
          kind: "characterInference",
          characterRef,
          inference,
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
        && materials.length === materialCountBeforeEvent) {
        throw new TypeError(`VNEXT_CLAIM_EVENT_UNMAPPED:${eventType}`);
      }
      if (!VNEXT_DIRECT_CLAIM_EVENT_TYPES.has(eventType)
        && !VNEXT_NON_RENDERABLE_LEDGER_EVENT_TYPES.has(eventType)) {
        throw new TypeError(`VNEXT_CLAIM_EVENT_UNKNOWN:${eventType}`);
      }
    }
  }

  if (requireClosedVNextCoverage && materials.length === 0) {
    throw new TypeError("VNEXT_CLAIMS_INSUFFICIENT");
  }

  materials.push({
    claimRef: claimRefForRange(range.receipt.receiptId, "action-committed"),
    kind: "actionCommitted",
    actorRef: range.actorCharacterId,
    status: range.receipt.status,
    summary: "本次行动已经由权威状态提交。",
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
  if (semanticKind !== "sceneFeature") return claims;
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

  const claims: ClaimMaterial[] = [{
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
  const succeeded = check === undefined
    ? stringField(payload, "branch") !== "failure"
    : check.succeeded === true;
  const targetRefs = stringRefs(payload.targetRefs);
  const outcomeCode = succeeded ? "success" : "failure";
  const checkKind = interactionCheckKind(payload);
  claims.push({
    ...eventClaimBase(
      event,
      "interaction",
      basisRefs,
      "visibility:scene-observers",
      false,
    ),
    kind: "mechanicalOutcome",
    actorRef,
    ...(targetRefs.length === 0 ? {} : { targetRefs }),
    outcomeCode,
    // The branch summary is KP-authored and may contain authority-only context.
    // The Viewer claim uses only closed ruling/branch values; concrete visible
    // consequences are emitted below from typed effects/evidence/transitions.
    summary: check === undefined
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
      || !["item", "worldFact", "sceneFeature"].includes(String(definition.semanticKind))
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
  const quantityBefore = finiteNumber(payload.quantityBefore);
  const quantityAfter = finiteNumber(payload.quantityAfter);
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
    || value === "worldRelation";
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
  });
  if (!isSha256(projectionHash)) throw new TypeError("VIEWER_PROJECTION_HASH_INVALID");
  const claims = authorityClaims.claims.flatMap((claim) => {
    if (!claimIsVisible(claim, visibleRefs) || !payloadRefsAreVisible(claim, visibleRefs)) return [];
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
    case "mechanicalOutcome":
      return hasClosedKeys(value, required("summary"), [
        "outcomeCode", "actorRef", "targetRefs", "check",
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
        "speakerRef",
        "statement",
        ...(renderable ? ["speakerName"] : []),
      ));
    case "characterInference":
      return hasClosedKeys(value, required(
        "characterRef",
        "inference",
        ...(renderable ? ["characterName"] : []),
      ));
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
        "characterRefs", "quantity", "charges", "durability", "state",
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
    case "mechanicalOutcome":
      requireText(material.summary, "mechanicalSummary");
      if (material.outcomeCode !== undefined) requireText(material.outcomeCode, "outcomeCode");
      optionalRef(material.actorRef, "mechanicalActor");
      optionalRefs(material.targetRefs, "mechanicalTarget");
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
      requireRef(material.speakerRef, "sourceSpeaker");
      requireText(material.statement, "sourceStatement");
      return;
    case "characterInference":
      requireRef(material.characterRef, "inferenceCharacter");
      requireText(material.inference, "inference");
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
      if (!["npc", "item", "worldFact", "sceneFeature", "worldRelation"]
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
      ["claimRef", "kind", "basisRefs", "narrationFacts"],
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
    const { basisRefs: _basisRefs, narrationFacts: _narrationFacts, ...content } = value;
    const displayNames = new Map<string, string>();
    if (value.kind === "abilityEffectApplied") {
      if (!isNonEmptyString(value.abilityRef)
        || !isNonEmptyString(value.abilityName)
        || AUTHORITY_REFERENCE_IN_TEXT.test(value.abilityName)) return false;
      displayNames.set(value.abilityRef, value.abilityName);
    } else if (value.kind === "sourceClaim") {
      if (!isNonEmptyString(value.speakerRef)
        || !isNonEmptyString(value.speakerName)
        || AUTHORITY_REFERENCE_IN_TEXT.test(value.speakerName)) return false;
      displayNames.set(value.speakerRef, value.speakerName);
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
    case "mechanicalOutcome":
      return [...(claim.actorRef === undefined ? [] : [claim.actorRef]), ...(claim.targetRefs ?? [])];
    case "abilityEffectApplied":
      return [claim.abilityRef, claim.sourceRef, ...claim.targetRefs];
    case "sensoryEvidence":
      return [claim.observerRef, ...(claim.subjectRef === undefined ? [] : [claim.subjectRef])];
    case "sourceClaim":
      return [claim.speakerRef];
    case "characterInference":
      return [claim.characterRef];
    case "sceneFeature":
      return [claim.featureRef];
    case "relationChanged":
      return [claim.relationRef, claim.subjectRef, claim.objectRef];
    case "definitionRevised":
      return [claim.definitionRef];
    case "inventoryOutcome":
      return [claim.itemRef, ...(claim.characterRefs ?? [])];
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

function renderableClaim(
  claim: ClaimMaterial,
  grants: ReadonlySet<string>,
  displayNames: ReadonlyMap<string, string>,
): RenderableClaim {
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
        speakerName: displayNames.get(claim.speakerRef) ?? "该消息来源",
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
    case "mechanicalOutcome":
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
      add(claim.statement, `${displayNames.get(claim.speakerRef) ?? "该消息来源"}声称：`);
      break;
    case "characterInference":
      add(claim.inference, `${displayNames.get(claim.characterRef) ?? "该角色"}判断：`);
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
      add(claim.summary);
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
      if (claim.state !== undefined) add(`物品状态为 ${claim.state}`);
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
