import { worldFactConstraints } from "../../../rules/v2/world-facts";
import type { AuthoritativeModuleProfile } from "../../../module/authoritative";
import { authorityRevisionOrHash, type AuthoritativeWorldState } from "../../../rules/authority-read";
import { canonicalHash, canonicalUnits, compareCodeUnits, isNonEmptyString, isPlainRecord, type JsonValue } from "../canonical-json";
import type { KnownContextEntry, KnownAbsentContextEntry, OpenBlankContextEntry } from "../required-context";
import { parseAbsenceSelector, type AvailabilityRequirement, type OpenBlankAuthorization } from "./availability";
import type { DiscoveredCandidate } from "./candidate-discovery";
import type { FactRelevance } from "./fact-relevance";
import type { ObligationSeed } from "./obligation-closure";
import {
  normalizePrecedentConditionSignature,
  VNEXT_PRECEDENT_CONDITION_SCHEMA,
  type PrecedentApplicabilityQuery,
  type PrecedentConditionScope,
} from "./precedent-applicability";
import type { ReferenceIndex } from "./reference-index";
import type { ContextWorkBudget } from "./work-budget";

/** This is the current authoring vocabulary, not a list of world instances.
 * The grant permits proposals of these kinds; Rules still validates every
 * definition, materialization and effect against the frozen runtime. */
const MATERIALIZATION_KINDS = Object.freeze([
  "npc",
  "sceneFeature", "worldFact", "worldRelation", "ability", "hazard", "item", "location", "passage",
].sort(compareCodeUnits));

export type RuntimeContextRequirements = Readonly<{
  availabilityRequirements: readonly AvailabilityRequirement[];
  openBlankAuthorizations: readonly OpenBlankAuthorization[];
  scopePermission?: OpenBlankContextEntry;
  profileContext: KnownContextEntry;
  seeds: readonly ObligationSeed[];
  precedentQueries: readonly PrecedentApplicabilityQuery[];
  precedentCollection: Readonly<Record<string, unknown>>;
  noPrecedents?: KnownAbsentContextEntry;
}>;

export type RuntimeContextRequirementsResult =
  | Readonly<{ kind: "ready"; requirements: RuntimeContextRequirements }>
  | Readonly<{ kind: "blocked"; reason: "integrityConflict" | "criticalUnavailable" | "preparationLimit"; issue: string }>;

/** Called only after discovery over the same authority snapshot. Natural
 * language chooses retrieval candidates, never world truth or an existence
 * selector. Explicit absence facts supply their own selectors. An independent
 * scope permission lets KP propose new content without pretending an unknown
 * noun was resolved or that a zero-hit search proved absence. */
export function deriveRuntimeContextRequirements(input: Readonly<{
  state: AuthoritativeWorldState;
  moduleProfile: AuthoritativeModuleProfile;
  actorCharacterId: string;
  candidates: readonly DiscoveredCandidate[];
  index: ReferenceIndex;
  budget: ContextWorkBudget;
  /** Absent for frames that carry every scoped fact, such as an NPC's own
   * work frame. Player actions supply the action's relevance. */
  factRelevance?: FactRelevance;
}>): RuntimeContextRequirementsResult {
  const { state, moduleProfile: profile, index } = input;
  const scopeRef = state.entities[input.actorCharacterId]?.sceneId;
  const pinned = state.campaignRuntime.campaign?.moduleRef;
  if (!isPlainRecord(pinned)
    || pinned.profileId !== profile.moduleRef.profileId
    || pinned.profileHash !== profile.moduleRef.profileHash) {
    return blocked("integrityConflict", "moduleProfile:authority-binding-mismatch");
  }
  if (!isNonEmptyString(scopeRef) || authorityRevisionOrHash(state, scopeRef) === null) {
    return blocked("criticalUnavailable", "moduleProfile:current-scope-unavailable");
  }
  // The caller reads a registered profile. Check its complete payload here as
  // well, so matching identifiers cannot bless a mutated body or stale cache.
  const { moduleRef: _moduleRef, ...body } = profile;
  const payload = { ...body, moduleRef: { profileId: profile.moduleRef.profileId } };
  if (!input.budget.charge("canonicalizeBytes", canonicalUnits(payload) * 4)) {
    return blocked("preparationLimit", "moduleProfile:verification-work-budget-exhausted");
  }
  if (canonicalHash(payload) !== profile.moduleRef.profileHash) {
    return blocked("integrityConflict", "moduleProfile:content-hash-mismatch");
  }
  const profileRef = `profile-context:${profile.moduleRef.profileId}`;
  const scopeRevisionOrHash = authorityRevisionOrHash(state, scopeRef)!;
  const location = profile.storyBible.storyAnchors.locations.find((entry) => entry.sceneId === scopeRef);
  const chapter = location === undefined ? undefined : profile.storyBible.storyAnchors.chapters
    .find((entry) => entry.chapterId === location.chapterId);
  const completeFrame = worldFactConstraints(state, scopeRef);
  if (completeFrame === undefined) return blocked("criticalUnavailable", "moduleProfile:current-scope-unavailable");
  // The complete frame remains the versioned membership binding: its hash is
  // what lowering and Rules compare at commit. The KP reads the constraints
  // this action can touch; see `createFactRelevance` for what that admits.
  if (!input.budget.charge("postingVisits", completeFrame.facts.length)) {
    return blocked("preparationLimit", "factSources:work-budget-exhausted");
  }
  const factConstraints = { ...completeFrame,
    facts: completeFrame.facts.filter((fact) => input.factRelevance?.admits(fact) ?? true) };
  const profileContext: KnownContextEntry = {
    kind: "known",
    entryRef: profileRef,
    revisionOrHash: profile.moduleRef.profileHash,
    value: {
      moduleRef: profile.moduleRef,
      scopeRef,
      sourcePaths: ["storyBible.coreTruth", "storyBible.contentBoundary", "storyBible.openBlanks",
        ...(location === undefined ? [] : [`storyBible.storyAnchors.locations[sceneId=${scopeRef}]`]),
        ...(chapter === undefined ? [] : [`storyBible.storyAnchors.chapters[chapterId=${chapter.chapterId}]`])],
      factConstraints,
      factConstraintsHash: canonicalHash(completeFrame),
      relevantClueAnchors: profile.storyBible.storyAnchors.clues.filter(clue => location?.clueIds?.includes(clue.clueId)),
      coreTruth: profile.storyBible.coreTruth,
      contentBoundary: profile.storyBible.contentBoundary,
      openBlanks: profile.storyBible.openBlanks,
      currentLocationAnchor: location ?? null,
      currentChapterAnchor: chapter ?? null,
      materializationPermission: {
        meaning: "permission-to-propose-new-content-within-scope;not-evidence-of-existence-or-absence",
        allowedKinds: MATERIALIZATION_KINDS,
        constraints: "existing-facts-and-local-absence-continue-to-bind;commit-before-outcome-evidence",
      },
    } as unknown as JsonValue,
  };
  const basisRefs = [scopeRef, profileRef].sort(compareCodeUnits);
  const grants: OpenBlankAuthorization[] = profile.storyBible.openBlanks.length === 0 ? [] : [{
    grantRef: profileRef,
    grantHash: canonicalHash({ moduleRef: profile.moduleRef, scopeRef, scopeRevisionOrHash,
      allowedKinds: MATERIALIZATION_KINDS, basisRefs }),
    scopeRef,
    scopeRevisionOrHash,
    allowedKinds: MATERIALIZATION_KINDS,
    basisRefs,
    visibilityPolicyRef: "visibility:room-authority-only",
  }];
  const requirements: AvailabilityRequirement[] = [];
  const seeds: ObligationSeed[] = [{ ref: profileRef, obligation: "safety" }];
  // These exact facts are already shown inside the constraint frame. Their
  // own versions and Viewer citation classes must be frozen too: the static
  // Profile binding cannot stand in for a dynamic fact's authority record.
  // Only the typed collection admits sources; a future plan's traceRef or an
  // arbitrary string in prose never proves that a fact currently exists.
  for (const fact of factConstraints.facts) seeds.push({ ref: fact.id, obligation: "sourceRecord" });
  for (const candidate of input.candidates) {
    const node = index.nodes.get(candidate.ref);
    if (node?.kind === "narrativeCommitment" || node?.kind === "narrativeBinding") continue;
    if (node?.sceneRef !== scopeRef || node.kind === "scene") continue;
    const obligation = node.kind === "itemEntry" && node.holderRef === input.actorCharacterId
      ? "instrument" : "target";
    requirements.push({ entryRef: `availability:${candidate.ref}`, obligation, scopeRef,
      selector: { kind: "exactRef", ref: candidate.ref }, allowedKinds: [] });
  }
  // These are authority constraints for this scope, not a scan of arbitrary
  // scene objects or text fields. Each fact carries the question it settled.
  for (const ref of index.factsBySubject.get(scopeRef) ?? []) {
    const fact = state.canonicalFacts[ref];
    if (fact?.kind !== "localAbsence" || !isPlainRecord(fact.value)
      || fact.value.scopeRef !== scopeRef || fact.value.status !== "active"
      || fact.branchId !== state.activeBranchId) continue;
    const selector = parseAbsenceSelector(fact.value.selector);
    if (selector === undefined) return blocked("criticalUnavailable", "localAbsence:selector-invalid");
    // Stale records cannot establish a denial. Retain their bodies as context
    // but do not disguise expired evidence as an active availability result.
    if (fact.value.scopeRevisionOrHash !== scopeRevisionOrHash) continue;
    requirements.push({ entryRef: `availability:${ref}`, obligation: "target", scopeRef,
      selector, allowedKinds: [] });
    seeds.push({ ref, obligation: "target" });
    if (!Array.isArray(fact.value.basisRefs) || fact.value.basisRefs.length === 0
      || !fact.value.basisRefs.every(isNonEmptyString)) {
      return blocked("criticalUnavailable", "localAbsence:basis-required");
    }
    for (const basisRef of fact.value.basisRefs) seeds.push({ ref: basisRef, obligation: "target" });
  }

  const precedents = runtimePrecedents(state, input.actorCharacterId, scopeRef, input.candidates, index, input.budget);
  if (precedents.kind === "blocked") return precedents;
  const grant = grants[0];
  return { kind: "ready", requirements: {
    availabilityRequirements: requirements,
    openBlankAuthorizations: grants,
    ...(grant === undefined ? {} : { scopePermission: {
      kind: "openBlank", entryRef: `availability:materialization:${scopeRef}`,
      scopeRef, allowedKinds: grant.allowedKinds, basisRefs: grant.basisRefs,
      authorizationRef: grant.grantRef, authorizationHash: grant.grantHash,
    } as OpenBlankContextEntry }),
    profileContext,
    seeds,
    ...precedents.value,
  } };
}

function runtimePrecedents(
  state: AuthoritativeWorldState,
  actorRef: string,
  scopeRef: string,
  candidates: readonly DiscoveredCandidate[],
  index: ReferenceIndex,
  budget: ContextWorkBudget,
): Readonly<{ kind: "ready"; value: Pick<RuntimeContextRequirements,
  "precedentQueries" | "precedentCollection" | "noPrecedents"> }>
  | Extract<RuntimeContextRequirementsResult, { kind: "blocked" }> {
  const source = state.campaignRuntime.adjudicationPrecedents;
  if (!isPlainRecord(source)) return blocked("criticalUnavailable", "precedents:authority-collection-unavailable");
  const scopes = new Map<string, string>([["scene", scopeRef], ["room", state.roomId]]);
  const campaign = state.campaignRuntime.campaign;
  if (isPlainRecord(campaign)) {
    if (isNonEmptyString(campaign.campaignId)) scopes.set("campaign", campaign.campaignId);
    if (isPlainRecord(campaign.moduleRef) && isNonEmptyString(campaign.moduleRef.profileId)) {
      scopes.set("module", campaign.moduleRef.profileId);
    }
  }
  const targetRefs: string[] = [];
  const instrumentRefs: string[] = [];
  for (const { ref } of candidates) {
    const node = index.nodes.get(ref);
    (node?.kind === "abilityDefinition" || node?.holderRef === actorRef ? instrumentRefs : targetRefs).push(ref);
  }
  const addressed = new Set([...targetRefs, ...instrumentRefs]);
  const relationRefs = [...new Set([...addressed].flatMap((ref) => [
    ...(index.relationsBySubject.get(ref) ?? []), ...(index.relationsByObject.get(ref) ?? []),
  ]).map((edge) => edge.relationRef))].sort(compareCodeUnits);
  const collection: Record<string, unknown> = {};
  const queryScopes = new Map<string, { scope: PrecedentConditionScope; formId: string }>();
  for (const [ref, record] of Object.entries(source)) {
    if (!budget.charge("scannedRecords", 1)) {
      return blocked("preparationLimit", "precedents:selection-work-budget-exhausted");
    }
    if (!isPlainRecord(record)) return blocked("criticalUnavailable", "precedents:record-invalid");
    const rawScope = isPlainRecord(record.conditionSignature) && isPlainRecord(record.conditionSignature.scope)
      ? record.conditionSignature.scope : record.applicabilityScope;
    if (!isPlainRecord(rawScope) || !isNonEmptyString(rawScope.kind) || !isNonEmptyString(rawScope.ref)) {
      return blocked("criticalUnavailable", "precedents:scope-unavailable");
    }
    if (scopes.get(rawScope.kind) !== rawScope.ref) continue;
    const condition = normalizePrecedentConditionSignature(record.conditionSignature);
    if (condition === undefined) return blocked("criticalUnavailable", "precedents:structured-condition-required");
    collection[ref] = record;
    queryScopes.set(`${condition.scope.kind}:${condition.scope.ref}:${condition.formId}`,
      { scope: condition.scope, formId: condition.formId });
  }
  const precedentQueries = [...queryScopes.values()].map(({ scope, formId }) => ({
    entryRef: `availability:precedent:${canonicalHash({ scope, formId })}`,
    conditionSignature: {
      schema: VNEXT_PRECEDENT_CONDITION_SCHEMA,
      scope,
      formId,
      targetRefs: [...new Set(targetRefs)].sort(compareCodeUnits),
      instrumentRefs: [...new Set(instrumentRefs)].sort(compareCodeUnits),
      relationRefs,
    },
    basisRefs: [scopeRef, "continuity:adjudicationPrecedents"],
  }));
  return { kind: "ready", value: { precedentQueries, precedentCollection: collection,
    ...(Object.keys(collection).length > 0 ? {} : { noPrecedents: {
      kind: "knownAbsent", entryRef: `availability:precedent:${scopeRef}`, scopeRef,
      // This denies membership in the complete relevant collection. It makes
      // no claim about a Form that KP has not selected yet.
      selector: { kind: "templateFamily", templateFamily: "adjudicationPrecedent" },
      basisRefs: [scopeRef, "continuity:adjudicationPrecedents"],
    } as KnownAbsentContextEntry }),
  } };
}

function blocked(reason: "integrityConflict" | "criticalUnavailable" | "preparationLimit", issue: string) {
  return { kind: "blocked" as const, reason, issue };
}
