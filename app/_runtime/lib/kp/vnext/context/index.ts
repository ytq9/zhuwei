import type { RuntimeProfileManifest } from "../../../rules/profiles/types";
import type { AuthoritativeModuleProfile } from "../../../module/authoritative";
import { isEnvironmentHazardDefinition } from "../../../rules/v2/environment-hazards";
import { hazardTriggerRelationRef } from "../../../rules/v2/hazard-lifecycle";
import { itemEntryUseAbilityId } from "../../../rules/v2/items";
import {
  authorityRevisionOrHash,
  authorityEquippedItemWeaponAbilityRefs,
  type AuthoritativeWorldState,
  type KpSpatialReadModel,
} from "../../../rules/authority-read";
import {
  canonicalUnits,
  compareCodeUnits,
  isPlainRecord,
  type JsonValue, canonicalHash } from "../canonical-json";
import {
  buildRequiredContext,
  type ProfileBinding,
  type RequiredContextEntry,
  type RequiredContextReferenceDirectory,
  type VNextRequiredContext,
} from "../required-context";
import { resolveTargetAmbiguity } from "./ambiguity";
import {
  resolveAvailability,
  type AvailabilityRequirement,
  type OpenBlankAuthorization,
} from "./availability";
import {
  resolvePrecedentApplicability,
  type PrecedentApplicabilityQuery,
} from "./precedent-applicability";
import { authorityCompositeRecord, indexableRecord, indexedSpatialRefVisibleTo } from "./authority-records";
import { discoverCandidates, type DiscoveredCandidate } from "./candidate-discovery";
import {
  citationClass,
  contextCoverage,
  contextDomain,
  obligationsAreDecisive,
  type CitationClass,
  type ContextCoverage,
} from "./coverage";
import { VNEXT_RETRIEVAL_PROFILE, type RetrievalProfile } from "./extractors";
import {
  closeObligations,
  type ClosedReference,
  type ContextObligation,
  type ObligationSeed,
} from "./obligation-closure";
import { buildReferenceIndex, type ReferenceNode } from "./reference-index";
import { deriveRuntimeContextRequirements } from "./runtime-requirements";
import { createFactRelevance } from "./fact-relevance";
import { createKnowledgeSelector, type KnowledgeSelector, KNOWLEDGE_DIRECTORY_SCHEMA, knowledgeDirectoryEntryRef, knowledgeGist } from "./knowledge-relevance";
import { narrativeContextRequirements } from "./narrative-continuity";
import { freezeNpcDecisionEntry, NPC_DECISION_CONTEXT_SCHEMA, npcDecisionEntryRef } from "./npc-decision";
import {
  createContextWorkBudget,
  VNEXT_CONTEXT_WORK_BUDGET,
  type ContextWorkBudget,
  type ContextWorkBudgetProfile,
  type ContextWorkReceipt,
} from "./work-budget";

/**
 * Soft target for one frozen artifact, in canonical units (UTF-8 bytes / 4).
 * These are not model tokens and do not pretend to be: what a provider will
 * accept is measured on the assembled request instead. Exceeding this is a
 * telemetry signal, not a refusal -- the refusal is the caller's maxUnits.
 */
export const VNEXT_CONTEXT_UNITS_TARGET = 8_000;

/**
 * Continuity domains a single physical action can turn on. The rest of the
 * campaign record -- chapters, stories, epilogues, faction plans -- is
 * narrative continuity that no amount of shooting a chandelier depends on, and
 * loading it was most of what made the previous slice large.
 */
const ADJUDICATION_CONTINUITY_REFS = Object.freeze([
  "continuity:adjudicationPrecedents",
  "continuity:meaningfulFailures",
  "continuity:sourceClaims",
  "continuity:unresolvedThreats",
] as const);

export type AdjudicationContextBlockReason =
  | "criticalUnavailable"
  | "integrityConflict"
  | "preparationLimit"
  /** The frozen artifact itself exceeded its canonical-unit ceiling. Distinct
   * from preparationLimit, which is the deterministic work budget running out
   * before an artifact was ever produced. */
  | "contextBudgetExceeded"
  | "invalid";

export type AdjudicationContextResult =
  | Readonly<{
      kind: "ready";
      context: VNextRequiredContext;
      coverage: ContextCoverage;
      /** Server-private evidence of what preparation actually did. Never
       * crosses the Room public rejection boundary. */
      privateReceipt: ContextWorkReceipt;
    }>
  | Readonly<{
      kind: "blocked";
      reason: AdjudicationContextBlockReason;
      issues: readonly string[];
      privateReceipt: ContextWorkReceipt;
    }>;

export type AdjudicationContextInput = Readonly<{
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  kpProjection: KpSpatialReadModel;
  npcProjections?: Readonly<Record<string, unknown>>;
  replayHead: Readonly<{ eventSeq: string; stateHash: string }>;
  preparedActionId: string;
  rootActionId: string;
  submissionRef: string;
  actorCharacterId: string;
  intentText: string;
  /** Registered module snapshot supplied by the Room prepare path. Its full
   * content hash and Room binding are checked before deriving permissions. */
  moduleProfile?: AuthoritativeModuleProfile;
  /** Refs the player addressed through UI or map focus. */
  focusRefs?: readonly string[];
  /** Explicit questions about what a scope does or does not contain. Absence
   * is only ever answered in reply to one of these. */
  availabilityRequirements?: readonly AvailabilityRequirement[];
  /** Profile-issued grants permitting the KP to settle a blank. Produced
   * outside this module. */
  openBlankAuthorizations?: readonly OpenBlankAuthorization[];
  /** Optional vNext applicability lookup. The full authority state is the
   * collection; the caller only supplies the structured condition being
   * adjudicated and whether that collection is known complete. */
  precedentApplicability?: Readonly<{
    query: PrecedentApplicabilityQuery;
    collectionComplete?: boolean;
  }>;
  maxUnits: number;
  workProfile?: ContextWorkBudgetProfile;
  retrievalProfile?: RetrievalProfile;
}>;

/**
 * Prepares one frozen adjudication context from one authority snapshot.
 *
 * The pipeline is: address the snapshot, find what the player's words could
 * mean, close the obligations that decide the outcome, read those bodies back
 * from the same snapshot, and report coverage. It resolves nothing about the
 * fiction -- not what the target is, not whether a chain can be shot through,
 * not what it should cost. Its whole contract is that the KP is looking at the
 * material the ruling depends on before it rules.
 */
export function freezeAdjudicationContext(
  input: AdjudicationContextInput,
): AdjudicationContextResult {
  const budget = createContextWorkBudget(input.workProfile ?? VNEXT_CONTEXT_WORK_BUDGET);
  const retrieval = input.retrievalProfile ?? VNEXT_RETRIEVAL_PROFILE;
  const actor = input.state.entities[input.actorCharacterId];
  if (actor === undefined || actor.tenureStatus !== "active") {
    return blocked("invalid", ["actor:active-authority-record-required"], budget);
  }
  // Two authority artifacts disagreeing about which state they describe is an
  // integrity conflict between them, not a malformed request.
  if (input.kpProjection.viewer.kind !== "kp"
    || input.kpProjection.stateVersion !== input.state.version
    || input.kpProjection.activeBranchId !== input.state.activeBranchId) {
    return blocked("integrityConflict", ["kpProjection:state-binding-mismatch"], budget);
  }
  const sceneRef = actor.sceneId;

  const indexed = buildReferenceIndex(input.state, budget);
  if (indexed.kind !== "indexed") {
    return blocked("preparationLimit", ["referenceIndex:work-budget-exhausted"], budget);
  }
  const index = indexed.index;

  const precedent = input.precedentApplicability === undefined
    ? undefined
    : resolvePrecedentApplicability({
        collection: input.state.campaignRuntime.adjudicationPrecedents,
        collectionComplete: input.precedentApplicability.collectionComplete !== false,
        query: input.precedentApplicability.query,
        collectionRef: "continuity:adjudicationPrecedents",
      });
  if (precedent?.kind === "integrityConflict") {
    return blocked("integrityConflict", [precedent.issue], budget);
  }
  if (precedent?.kind === "unresolved") {
    return blocked(
      precedent.reason === "queryInvalid" ? "invalid" : "criticalUnavailable",
      precedent.issues,
      budget,
    );
  }

  const discovered = discoverCandidates({
    state: input.state,
    index,
    subject: { kind: "kp", sceneRef, actorCharacterRef: input.actorCharacterId },
    focusRefs: input.focusRefs ?? [],
    intentText: input.intentText,
    profile: retrieval,
    budget,
  });
  if (discovered.kind !== "discovered") {
    return blocked("preparationLimit", ["candidateDiscovery:work-budget-exhausted"], budget);
  }
  // A generic request can refer to people already in view without naming them.
  // Freeze their exact records using the same visibility/spatial predicate as
  // Rules. This membership read is bounded and does not select action targets
  // or expand bystander relations. Every visible NPC keeps a finite decision
  // view with the bodies the topic reaches; the NPCs the words address (name,
  // alias, exact ref, description or UI focus) are sent with every model
  // request, the others only once the selection names them, so a sentence
  // never carries every visible NPC's memory by default (SPEC 0016 §4.2–4.3).
  const addressedNpcRefs = new Set([...discovered.candidates.map(({ ref }) => ref), ...(input.focusRefs ?? [])]
    .filter((ref) => input.state.entities[ref]?.kind === "npc"));
  // The actor and every addressed NPC freeze their complete memory: the
  // topic decides which bodies are sent, the rest wait behind the holder's
  // directory for the selection to name them, and none has to be read again.
  const completeMemoryHolders = new Set<string>([input.actorCharacterId, ...addressedNpcRefs]);
  const factRelevance = createFactRelevance({ index, actorCharacterId: input.actorCharacterId,
    candidates: discovered.candidates, focusRefs: input.focusRefs ?? [] });
  const selectKnowledge = createKnowledgeSelector({ state: input.state, index, actorCharacterId: input.actorCharacterId,
    intentText: input.intentText, candidates: discovered.candidates, focusRefs: input.focusRefs ?? [] });
  const observableSubjects: ObligationSeed[] = [];
  for (const ref of index.refsByScene.get(sceneRef) ?? []) {
    if (!budget.charge("postingVisits", 1)) {
      return blocked("preparationLimit", ["observableSubjects:work-budget-exhausted"], budget);
    }
    const node = index.nodes.get(ref);
    if (node?.kind === "entity" && indexedSpatialRefVisibleTo(input.state, node, sceneRef, input.actorCharacterId)) {
      observableSubjects.push({ ref, obligation: "observableSubject" });
      // Every visible NPC's decision view is frozen and verified; whether it
      // is sent is the selection's choice (references.npcRecall), so a
      // sentence that names one NPC can still reach another through it.
      if (input.state.entities[ref]?.kind === "npc") {
        observableSubjects.push({ ref, obligation: "npcDecision" });
      }
    }
  }

  const narrative = narrativeContextRequirements({
    state: input.state, index, actorRef: input.actorCharacterId, sceneRef,
    intentText: input.intentText, focusRefs: input.focusRefs ?? [], discovery: discovered, budget,
  });
  if (narrative.kind === "blocked") return blocked(narrative.reason, [narrative.issue], budget);

  const runtimeResult = input.moduleProfile === undefined ? undefined : deriveRuntimeContextRequirements({
    state: input.state,
    moduleProfile: input.moduleProfile,
    actorCharacterId: input.actorCharacterId,
    candidates: discovered.candidates,
    index,
    budget,
    factRelevance,
  });
  if (runtimeResult?.kind === "blocked") {
    return blocked(runtimeResult.reason, [runtimeResult.issue], budget);
  }
  const runtime = runtimeResult?.requirements;
  const runtimePrecedents = (runtime?.precedentQueries ?? []).map((query) => resolvePrecedentApplicability({
    collection: runtime!.precedentCollection,
    collectionComplete: true,
    query,
    collectionRef: "continuity:adjudicationPrecedents",
  }));
  for (const result of runtimePrecedents) {
    if (result.kind === "integrityConflict") return blocked("integrityConflict", [result.issue], budget);
    if (result.kind === "unresolved") return blocked("criticalUnavailable", result.issues, budget);
  }
  const selectedPrecedentRefs = runtimePrecedents.flatMap((result) =>
    result.kind === "integrityConflict" || result.kind === "unresolved" ? [] : precedentRefs(result));
  const requirements = [...(input.availabilityRequirements ?? []), ...(runtime?.availabilityRequirements ?? [])];
  const authorizations = [...(input.openBlankAuthorizations ?? []), ...(runtime?.openBlankAuthorizations ?? [])];
  const runtimeSeeds = runtime?.seeds ?? [];
  // Missing decisive bases must survive seed admission and fail closed. The
  // ordinary optional continuity seeds may legitimately be absent in fixtures.
  const missingRuntimeBasis = runtimeSeeds.filter(({ ref }) => !index.nodes.has(ref));
  if (missingRuntimeBasis.length > 0) {
    return blocked("criticalUnavailable", ["availability:authority-basis-unavailable"], budget);
  }

  const closed = closeObligations({
    index,
    seeds: [...seeds(input, sceneRef, discovered.candidates,
      [...precedentRefs(precedent), ...selectedPrecedentRefs]), ...runtimeSeeds, ...narrative.seeds, ...observableSubjects]
      .filter(({ ref }) => index.nodes.has(ref)),
    budget,
    admitFact: (factRef, viaRef) => {
      const subjectRefs = index.nodes.get(factRef)?.subjectRefs;
      return subjectRefs === undefined || factRelevance.admits({ subjectRefs }, viaRef);
    },
    // Ability refs and hazard dependencies address independent frozen records:
    // missing ones must remain critical gaps. Other schemas may also name
    // embedded resources or tactical obstacles carried by their parent body.
    dependencies: (ref, obligation, node) =>
      declaredDependencies(input.state, index, sceneRef, obligation, node, budget, selectKnowledge, completeMemoryHolders)
        .filter((seed) => index.nodes.has(seed.ref)
          || seed.obligation === "ability" || node?.kind === "campaignDefinition"),
  });
  if (closed.kind !== "closed") {
    return blocked("preparationLimit", ["obligationClosure:work-budget-exhausted"], budget);
  }

  const entries: RequiredContextEntry[] = [];
  const citations = new Map<string, CitationClass>();
  const domains = new Map<string, ReturnType<typeof contextDomain>>();
  const obligationCoverage = new Map<ContextObligation, { refCount: number; resolved: boolean }>();
  const caps = (input.workProfile ?? VNEXT_CONTEXT_WORK_BUDGET).caps;

  for (const closedRef of closed.refs) {
    const decisive = obligationsAreDecisive(closedRef.obligations);
    const node = index.nodes.get(closedRef.ref);
    const read = node === undefined
      ? undefined
      : rereadEntry(input.state, node, closedRef, decisive, caps.maxEntryRereadBytes, budget,
          node.ref === runtime?.profileContext.entryRef ? runtime.profileContext.value
            // Bind the complete collection's version while carrying only the
            // scope-selected records, whose full bodies are independently read.
            : runtime !== undefined && node.ref === "continuity:adjudicationPrecedents"
              ? { selectedRefs: selectedPrecedentRefs, scopeRef: sceneRef } : undefined);
    if (read === "preparationLimit") {
      return blocked("preparationLimit", ["authorityReread:work-budget-exhausted"], budget);
    }
    if (read === undefined) {
      entries.push(Object.freeze({
        kind: "unavailable",
        entryRef: closedRef.ref,
        reason: "notLoaded",
        critical: decisive,
      }));
      recordObligations(obligationCoverage, closedRef.obligations, false);
      continue;
    }
    if (read.kind === "unavailable") {
      entries.push(read.entry);
      recordObligations(obligationCoverage, closedRef.obligations, false);
      continue;
    }
    entries.push(read.entry);
    citations.set(closedRef.ref, citationClass(input.state, node!, input.actorCharacterId, sceneRef));
    domains.set(closedRef.ref, contextDomain(node!));
    recordObligations(obligationCoverage, closedRef.obligations, true);
  }

  const ambiguity = resolveTargetAmbiguity({
    state: input.state,
    index,
    candidates: discovered.candidates,
    actorCharacterId: input.actorCharacterId,
    sceneRef,
    frontierExhausted: discovered.droppedCandidateCount === 0,
  });
  if (ambiguity.kind === "ambiguous") entries.push(ambiguity.entry);

  const loadedRefs = new Set(entries.flatMap((entry) =>
    entry.kind === "known" ? [entry.entryRef] : []));
  const unresolvedRequirements: string[] = [];
  for (const requirement of requirements) {
    const outcome = resolveAvailability({
      state: input.state,
      index,
      requirement,
      authorizations,
      loadedRefs,
      frontierExhausted: discovered.droppedCandidateCount === 0,
    });
    if (outcome.kind === "integrityConflict") {
      return blocked("integrityConflict", [outcome.issue], budget);
    }
    if (outcome.kind === "entry") entries.push(outcome.entry);
    // An unanswered question stays unanswered. Reporting it as absent would
    // invent negative evidence; reporting it as unavailable would blame a
    // technical failure that did not happen.
    if (outcome.kind === "unresolved") {
      unresolvedRequirements.push(`${requirement.entryRef}:${outcome.reason}`);
      if (runtime !== undefined) {
        return blocked("criticalUnavailable", ["availability:decisive-role-unresolved"], budget);
      }
    }
  }
  if (precedent?.kind === "knownAbsent") entries.push(precedent.entry);
  for (const result of runtimePrecedents) if (result.kind === "knownAbsent") entries.push(result.entry);
  if (runtime?.noPrecedents !== undefined) entries.push(runtime.noPrecedents);
  if (runtime?.scopePermission !== undefined) {
    if (discovered.droppedCandidateCount > 0 || discovered.truncatedPaths.length > 0
      || discovered.droppedGenericTerms.length > 0) {
      // This optional permission is withheld, not turned into world absence.
      // Existing fully read targets remain actionable; materialization cannot
      // rely on this entry because it is not an openBlank authorization.
      entries.push({ kind: "unavailable", entryRef: runtime.scopePermission.entryRef,
        reason: "truncated", critical: false });
    } else {
      if (runtime.scopePermission.basisRefs.some((ref) => !loadedRefs.has(ref))) {
        return blocked("criticalUnavailable", ["availability:scope-constraints-incomplete"], budget);
      }
      entries.push(runtime.scopePermission);
    }
  }

  const npcDecisionRefs = new Set(closed.refs.filter(entry =>
    entry.obligations.some(obligation => obligation !== "observableSubject")).map(entry => entry.ref));
  for (const npcRef of [...new Set(entries.flatMap(entry => entry.kind === "known"
    && npcDecisionRefs.has(entry.entryRef)
    && input.state.entities[entry.entryRef]?.kind === "npc" ? [entry.entryRef] : []))]) {
    const projection = input.npcProjections?.[npcRef];
    if (projection !== undefined) {
      let projectionBytes = 0;
      try { projectionBytes = canonicalUnits(projection) * 4; } catch { /* The freezer records invalidProjection. */ }
      // Same-source projection checks scan the indexed authority again. Pay
      // for that work and its input before recomputing or cloning the view.
      if (!budget.charge("scannedRecords", index.nodes.size)
        || !budget.charge("authorityRereadBytes", projectionBytes)
        || !budget.charge("canonicalizeBytes", projectionBytes)) {
        return blocked("preparationLimit", ["npcDecision:work-budget-exhausted"], budget);
      }
    }
    const decision = freezeNpcDecisionEntry(input.state, input.profiles, npcRef, projection, entries);
    const bytes = canonicalUnits(decision) * 4;
    if (!budget.charge("authorityRereadBytes", bytes) || !budget.charge("canonicalizeBytes", bytes)) {
      return blocked("preparationLimit", ["npcDecision:work-budget-exhausted"], budget);
    }
    entries.push(bytes > budget.profile.caps.maxEntryRereadBytes
      ? { kind: "unavailable", entryRef: decision.entryRef, reason: "truncated", critical: false } : decision);
    citations.set(decision.entryRef, "nonCitable");
  }
  // The rest of each holder's memory stays on the server. The model receives
  // a short directory of what it was not sent (ref and a gist) so the KP can
  // tell whether the topic reaches more than it read; an unlisted body is
  // never citable, and reading one later takes a new freeze.
  const directoryHolders = [...new Set([input.actorCharacterId, ...entries.flatMap((entry) => entry.kind === "known"
    && isPlainRecord(entry.value) && entry.value.schema === NPC_DECISION_CONTEXT_SCHEMA && typeof entry.value.npcRef === "string"
    ? [entry.value.npcRef] : [])])].sort(compareCodeUnits);
  const knowledgeRecall: { holderRef: string; records: { handle: string; entryRef: string }[] }[] = [];
  let handleOrdinal = 0;
  for (const holderRef of directoryHolders) {
    const unloaded = selectKnowledge(holderRef).unloaded;
    if (unloaded.length === 0) continue;
    const frozenBodies = new Set(entries.flatMap((entry) => entry.kind === "known" && entry.entryRef.startsWith(`knowledge:${holderRef}:`) ? [entry.entryRef] : []));
    const records = unloaded.map((knowledgeRef) => {
      const entryRef = `knowledge:${holderRef}:${knowledgeRef}`;
      // A frozen body the topic did not reach gets a handle the selection can
      // name; a body that was never frozen is a bare directory line.
      const handle = completeMemoryHolders.has(holderRef) && frozenBodies.has(entryRef) ? `m${++handleOrdinal}` : undefined;
      return { knowledgeRef, entryRef, gist: knowledgeGist(input.state.knowledge[holderRef]?.[knowledgeRef]), ...(handle === undefined ? {} : { handle }) };
    });
    const value = { schema: KNOWLEDGE_DIRECTORY_SCHEMA, holderRef, unloaded: records };
    const entryRef = knowledgeDirectoryEntryRef(holderRef);
    entries.push(Object.freeze({ kind: "known", entryRef, revisionOrHash: canonicalHash(value), value }));
    citations.set(entryRef, "nonCitable");
    const recallRecords = records.flatMap((record) => record.handle === undefined ? [] : [{ handle: record.handle, entryRef: record.entryRef }]);
    if (recallRecords.length > 0) knowledgeRecall.push({ holderRef, records: recallRecords });
  }
  // Which frozen NPC views travel with every model request and which wait for
  // the selection stage to name them. An addressed NPC is decisive material
  // (SPEC 0016 §4.3) and is shown from the selection on; a bystander's view is
  // frozen and verified here but sent only once the selection asks for it, so
  // a sentence that names nobody no longer carries every visible NPC's memory.
  const addressedForRecall = addressedNpcRefs;
  const npcRecall = [...new Set(entries.flatMap((entry) => entry.kind === "known" && isPlainRecord(entry.value)
    && entry.value.schema === NPC_DECISION_CONTEXT_SCHEMA && typeof entry.value.npcRef === "string" ? [entry.value.npcRef] : []))]
    .sort(compareCodeUnits)
    .map((npcRef) => ({ npcRef, role: addressedForRecall.has(npcRef) ? "default" as const : "requestable" as const,
      entryRefs: entries.flatMap((entry) => entry.entryRef === npcDecisionEntryRef(npcRef)
        || entry.entryRef === knowledgeDirectoryEntryRef(npcRef)
        || entry.entryRef.startsWith(`knowledge:${npcRef}:`) ? [entry.entryRef] : []).sort(compareCodeUnits) }));
  const built = buildRequiredContext({
    intent: {
      submissionRef: input.submissionRef,
      actorRef: input.actorCharacterId,
      text: input.intentText,
      ...(narrative.materializationRefs.length === 0 ? {} : {
        narrativeMaterializationRefs: narrative.materializationRefs,
      }),
    },
    entries,
    references: { ...referenceDirectory(input.state, input.actorCharacterId, citations, domains), npcRecall, knowledgeRecall },
    binding: {
      roomEpochRef: input.state.runtimeEpochId,
      rootActionId: input.rootActionId,
      preparedActionId: input.preparedActionId,
      baseEventSeq: input.replayHead.eventSeq,
      stateHash: input.replayHead.stateHash,
      projectionHash: input.kpProjection.projectionHash,
      profiles: profileBindings(input.profiles),
      readSet: [],
    },
    maxUnits: input.maxUnits,
  });
  if (built.kind !== "accepted") {
    return blocked(
      built.code === "CONTEXT_CRITICAL_UNAVAILABLE"
        ? "criticalUnavailable"
        : built.code === "CONTEXT_BUDGET_EXCEEDED" ? "contextBudgetExceeded" : "invalid",
      built.issues,
      budget,
    );
  }

  return Object.freeze({
    kind: "ready",
    context: built.context,
    coverage: contextCoverage({
      obligations: obligationCoverage,
      entryStates: entryStates(entries),
      frontierExhausted: true,
      truncatedPaths: discovered.truncatedPaths,
      droppedGenericTerms: discovered.droppedGenericTerms,
      droppedCandidateCount: discovered.droppedCandidateCount,
      equivalentSelections: ambiguity.kind === "equivalent" ? [ambiguity.selection] : [],
      unresolvedRequirements,
      unitsUsed: built.usedUnits,
      unitsTarget: VNEXT_CONTEXT_UNITS_TARGET,
    }),
    privateReceipt: budget.receipt(),
  });
}

function seeds(
  input: AdjudicationContextInput,
  sceneRef: string,
  candidates: readonly DiscoveredCandidate[],
  precedentRefsToRead: readonly string[] = [],
): readonly ObligationSeed[] {
  const collected: ObligationSeed[] = [
    { ref: input.actorCharacterId, obligation: "actor" },
    { ref: sceneRef, obligation: "geometry" },
    ...ADJUDICATION_CONTINUITY_REFS.map((ref) => ({
      ref,
      obligation: (ref === "continuity:adjudicationPrecedents"
        ? "precedent"
        : ref === "continuity:unresolvedThreats" ? "safety" : "continuity") as ContextObligation,
    })),
    ...(input.focusRefs ?? []).map((ref) => ({ ref, obligation: "target" as ContextObligation })),
    ...precedentRefsToRead.map((ref) => ({
      ref,
      obligation: "precedent" as ContextObligation,
    })),
  ];
  for (const candidate of candidates) {
    collected.push({
      ref: candidate.ref,
      // Discovery reports what the words could address; the obligation follows
      // from the purpose the term was registered under, not from a guess about
      // which one the player meant.
      obligation: candidate.purpose === "capability" ? "ability" : "target",
    });
  }
  return Object.freeze(collected);
}

function precedentRefs(
  result:
    | Extract<ReturnType<typeof resolvePrecedentApplicability>, { kind: "exact" }>
    | Extract<ReturnType<typeof resolvePrecedentApplicability>, { kind: "analogous" }>
    | Extract<ReturnType<typeof resolvePrecedentApplicability>, { kind: "knownAbsent" }>
    | undefined,
): readonly string[] {
  if (result === undefined) return [];
  const records = result.kind === "exact"
    ? [result.active, ...result.lineage]
    : result.kind === "analogous"
      ? [...result.candidates, ...result.lineage]
      : result.lineage;
  return [...new Set(records.map((record) =>
    `continuity:adjudicationPrecedents:${record.precedentId}`))].sort(compareCodeUnits);
}

/**
 * Dependencies a record declares in its own body. Reading these needs the body
 * and therefore its schema, which is why the closure takes them through a hook
 * rather than inferring them from addressing.
 */
function declaredDependencies(
  state: AuthoritativeWorldState,
  index: Readonly<{
    nodes: ReadonlyMap<string, ReferenceNode>;
    itemEntriesByHolder: ReadonlyMap<string, readonly string[]>;
    itemEntriesByDefinition: ReadonlyMap<string, readonly string[]>;
    knowledgeByHolder: ReadonlyMap<string, readonly string[]>;
  }>,
  sceneRef: string,
  obligation: ContextObligation,
  node: ReferenceNode | undefined,
  budget: ContextWorkBudget,
  selectKnowledge: KnowledgeSelector,
  completeMemory: ReadonlySet<string>,
): readonly ObligationSeed[] {
  if (node === undefined || obligation === "observableSubject") return [];
  if (!budget.charge("postingVisits", 1)) return [];
  // Held knowledge is read by relevance: the holder's complete directory is
  // frozen inside its catalog and decision snapshot. A complete-memory holder
  // (the actor, an addressed NPC) freezes every body and the view sends the
  // topical ones; any other holder freezes only the bodies the topic reaches
  // (see `createKnowledgeSelector`).
  const knowledgeSeeds = (holderRef: string, seedObligation: ContextObligation): readonly ObligationSeed[] | undefined => {
    const refs = index.knowledgeByHolder.get(holderRef) ?? [];
    if (!budget.charge("postingVisits", refs.length)) return undefined;
    if (completeMemory.has(holderRef)) return refs.map((ref) => ({ ref, obligation: seedObligation }));
    const loaded = new Set(selectKnowledge(holderRef).loaded.map((knowledgeRef) => `knowledge:${holderRef}:${knowledgeRef}`));
    return refs.filter((ref) => loaded.has(ref)).map((ref) => ({ ref, obligation: seedObligation }));
  };
  // This optional, non-expanding slice supports any visible conversation
  // candidate. It loads holder-qualified knowledge bodies; the existing Rules
  // projection supplies and verifies the rest of that NPC's view. Bodies left
  // unloaded stay directory lines the KP cannot cite, without making a
  // physical observation depend on a bystander's complete private history.
  if (obligation === "npcDecision") {
    if (node.kind !== "entity" || state.entities[node.ref]?.kind !== "npc") return [];
    return knowledgeSeeds(node.ref, "npcDecision") ?? [];
  }

  // The actor body already freezes its complete attributes, defense, active
  // effects, resources and possession references. Possession does not make an
  // item this action's instrument, nor does knowing an active ability mean it
  // was selected. Those complete definitions enter through addressed targets,
  // registered capability discovery and typed causal dependencies instead.
  // Reactions are different: their possible response can matter without the
  // player naming them, so retain their complete mechanics by activation type.
  if (node.kind === "entity" && (obligation === "actor" || obligation === "target" || obligation === "relation")) {
    const combatEntity = state.combatRuntime.entities[node.ref];
    const abilityRefs = isPlainRecord(combatEntity)
      && Array.isArray(combatEntity.abilityRefs)
      ? combatEntity.abilityRefs
      : [];
    return [
      ...(obligation === "actor" ? [
        { ref: `knowledge-catalog:${node.ref}`, obligation: "actor" as ContextObligation },
        { ref: `ability-catalog:${node.ref}`, obligation: "actor" as ContextObligation },
        { ref: `character-timeline:${node.ref}`, obligation: "actor" as ContextObligation },
        ...(isPlainRecord(combatEntity?.concentration) && combatEntity.concentration.kind === "longSpellcasting"
          && typeof combatEntity.concentration.activityId === "string"
          ? [{ ref: `continuity:activities:${combatEntity.concentration.activityId}`, obligation: "actor" as ContextObligation }] : []),
      ] : []),
      ...abilityRefs.flatMap((abilityRef) => {
        const definition = typeof abilityRef === "string" ? state.combatRuntime.definitions[abilityRef] : undefined;
        const activation = isPlainRecord(definition?.activation) ? definition.activation.kind : undefined;
        return typeof abilityRef === "string" && (activation === "reaction" || activation === "reactionSpell")
          ? [{ ref: abilityRef, obligation: "reaction" as ContextObligation }] : [];
      }),
      ...(obligation === "relation" ? []
        : knowledgeSeeds(node.ref, (obligation === "actor" ? "actor" : "fact") as ContextObligation) ?? []),
    ];
  }

  // Naming a kind of thing is not naming one of them. A definition the player
  // referred to resolves to the instances actually standing in this scene, and
  // to no others; which one they meant stays the KP's to decide.
  if (node.kind === "itemDefinition") {
    const definition = state.campaignRuntime.itemSystem.definitions[node.ref];
    const use = definition?.content.use;
    const abilityRefs = [
      ...(definition?.content.equippedAbilityRefs ?? []),
      ...(use === null || use === undefined ? [] : [use.abilityRef]),
    ];
    return [
      ...abilityRefs.map((ref) => ({ ref, obligation: "ability" as ContextObligation })),
      ...(obligation === "target" || obligation === "instrument"
        ? (index.itemEntriesByDefinition.get(node.ref) ?? [])
          .filter((entryRef) => index.nodes.get(entryRef)?.sceneRef === sceneRef)
          .map((ref) => ({ ref, obligation: "instrument" as ContextObligation }))
        : []),
    ];
  }

  if (node.kind === "itemAssembly") {
    const assembly = state.campaignRuntime.itemSystem.assemblies?.[node.ref];
    return assembly?.state !== "active" ? [] : [
      { ref: assembly.sceneRef, obligation: "scene" as ContextObligation },
      ...assembly.components.map(component => ({ ref: component.entryRef, obligation: "instrument" as ContextObligation })),
    ];
  }
  if (node.kind === "itemEntry") {
    const entry = state.campaignRuntime.itemSystem.entries[node.ref];
    const definition = entry === undefined
      ? undefined : state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
    const use = definition?.content.use;
    // The source describes the item; the executable per-entry Ability also
    // freezes which exact instance pays its costs. Read both when available.
    return [
      ...(entry?.assemblyRef === undefined ? [] : [{ ref: entry.assemblyRef, obligation: "relation" as ContextObligation }]),
      ...authorityEquippedItemWeaponAbilityRefs(state, node.ref, count => budget.charge("postingVisits", count))
        .map(ref => ({ ref, obligation: "ability" as ContextObligation })),
      ...(use === null || use === undefined || entry === undefined ? []
        : [{ ref: itemEntryUseAbilityId(use.abilityRef, entry.entryId), obligation: "ability" as ContextObligation }]),
    ];
  }

  const record = indexableRecord(state, node);
  if (!isPlainRecord(record)) return [];

  if (node.kind === "campaignDefinition" && isEnvironmentHazardDefinition(record)) {
    const content = record.content as { mechanicsRef: string; trigger: { ref: string } };
    return [
      { ref: content.mechanicsRef, obligation: "ability" },
      { ref: content.trigger.ref, obligation: "relation" },
      { ref: hazardTriggerRelationRef(node.ref), obligation: "relation" },
    ];
  }

  // An NPC's semantics and the entity acting them out are one subject. Reaching
  // the definition without the character would let the KP revise a disposition
  // while blind to the state it is a disposition of.
  if (node.kind === "semanticDefinition" && node.semanticKind === "npc") {
    const links = isPlainRecord(record.content) && isPlainRecord(record.content.links)
      ? record.content.links
      : {};
    return typeof links.entityRef === "string"
      ? [{ ref: links.entityRef, obligation: "target" as ContextObligation }]
      : [];
  }

  if (node.kind === "abilityDefinition") {
    // An ability the actor cannot pay for is not an ability it has. The
    // resources it consumes are part of whether it can be used at all.
    const costs = Array.isArray(record.costs) ? record.costs : [];
    return costs.flatMap((cost) => isPlainRecord(cost) && typeof cost.resourceId === "string"
      ? [{ ref: cost.resourceId, obligation: "instrument" as ContextObligation }]
      : []);
  }
  if (node.kind === "semanticDefinition" && node.semanticKind === "sceneFeature") {
    const content = isPlainRecord(record.content) ? record.content : {};
    const mechanics = Array.isArray(content.mechanicDefinitionRefs)
      ? content.mechanicDefinitionRefs
      : [];
    return mechanics.flatMap((mechanicRef) => typeof mechanicRef === "string"
      ? [{ ref: mechanicRef, obligation: "relation" as ContextObligation }]
      : []);
  }
  return [];
}

type RereadOutcome =
  | Readonly<{ kind: "known"; entry: RequiredContextEntry }>
  | Readonly<{ kind: "unavailable"; entry: RequiredContextEntry }>
  | "preparationLimit"
  | undefined;

function rereadEntry(
  state: AuthoritativeWorldState,
  node: ReferenceNode,
  closedRef: ClosedReference,
  decisive: boolean,
  maxEntryRereadBytes: number,
  budget: ContextWorkBudget,
  projectedValue?: JsonValue,
): RereadOutcome {
  const value = projectedValue ?? authorityCompositeRecord(state, node);
  const revisionOrHash = authorityRevisionOrHash(state, node.ref);
  if (value === undefined || revisionOrHash === null) return undefined;

  let units: number;
  try {
    units = canonicalUnits(value);
  } catch {
    return Object.freeze({
      kind: "unavailable",
      entry: Object.freeze({
        kind: "unavailable",
        entryRef: node.ref,
        reason: "invalidProjection",
        critical: decisive,
      }),
    });
  }
  const bytes = units * 4;
  if (bytes > maxEntryRereadBytes) {
    // Reported as not loaded rather than as absent. Claiming "no such record"
    // for something merely too large to carry would tell the KP a falsehood.
    return Object.freeze({
      kind: "unavailable",
      entry: Object.freeze({
        kind: "unavailable",
        entryRef: node.ref,
        reason: "truncated",
        critical: decisive,
      }),
    });
  }
  if (!budget.charge("authorityRereadBytes", bytes)) return "preparationLimit";
  if (!budget.charge("canonicalizeBytes", bytes)) return "preparationLimit";
  void closedRef;
  return Object.freeze({
    kind: "known",
    entry: Object.freeze({
      kind: "known",
      entryRef: node.ref,
      revisionOrHash,
      value: value as JsonValue,
    }),
  });
}

function referenceDirectory(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  citations: ReadonlyMap<string, CitationClass>,
  domains: ReadonlyMap<string, ReturnType<typeof contextDomain>>,
): RequiredContextReferenceDirectory {
  const byClass = (target: CitationClass) => [...citations]
    .filter(([, value]) => value === target)
    .map(([ref]) => ref)
    .sort(compareCodeUnits);
  const npcKnowledge = [...new Set([...citations.keys()]
    .filter((ref) => ref.startsWith("knowledge:")))]
    .flatMap((ref) => {
      const holderRef = [...Object.keys(state.knowledge)]
        .filter((holder) => ref.startsWith(`knowledge:${holder}:`))
        .sort((left, right) => right.length - left.length)[0];
      return holderRef === undefined || state.entities[holderRef]?.kind !== "npc"
        ? []
        : [{ npcRef: holderRef, entryRef: ref }];
    })
    .reduce<{ npcRef: string; refs: string[] }[]>((accumulated, entry) => {
      const existing = accumulated.find(({ npcRef }) => npcRef === entry.npcRef);
      if (existing === undefined) accumulated.push({ npcRef: entry.npcRef, refs: [entry.entryRef] });
      else existing.refs.push(entry.entryRef);
      return accumulated;
    }, [])
    .map(({ npcRef, refs }) => ({ npcRef, refs: [...refs].sort(compareCodeUnits) }))
    .sort((left, right) => compareCodeUnits(left.npcRef, right.npcRef));

  const actorKnowledgeRefs = [...citations.keys()]
    .filter((ref) => ref.startsWith(`knowledge:${actorCharacterId}:`))
    .map((ref) => ref.slice(`knowledge:${actorCharacterId}:`.length));
  const nonCitable = byClass("nonCitable")
    .filter((ref) => !npcKnowledge.some(({ refs }) => refs.includes(ref)));

  return {
    citations: {
      viewerEvidenceRefs: [...new Set([...byClass("viewer"), ...actorKnowledgeRefs])],
      authorityBasisRefs: byClass("authority"),
      npcKnowledge,
      nonCitableRefs: nonCitable,
    },
    domains: {
      abilityRefs: refsWithDomain(domains, "ability"),
      itemRefs: refsWithDomain(domains, "item"),
      semanticRefs: refsWithDomain(domains, "semantic"),
    },
  };
}

function refsWithDomain(
  domains: ReadonlyMap<string, ReturnType<typeof contextDomain>>,
  target: ReturnType<typeof contextDomain>,
): string[] {
  return [...domains]
    .filter(([, value]) => value === target)
    .map(([ref]) => ref)
    .sort(compareCodeUnits);
}

function recordObligations(
  target: Map<ContextObligation, { refCount: number; resolved: boolean }>,
  obligations: readonly ContextObligation[],
  resolved: boolean,
): void {
  for (const obligation of obligations) {
    const existing = target.get(obligation) ?? { refCount: 0, resolved: true };
    target.set(obligation, {
      refCount: existing.refCount + 1,
      resolved: existing.resolved && resolved,
    });
  }
}

function entryStates(entries: readonly RequiredContextEntry[]): ContextCoverage["entryStates"] {
  const counts = { known: 0, knownAbsent: 0, openBlank: 0, ambiguous: 0, unavailable: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

function profileBindings(profiles: RuntimeProfileManifest): readonly ProfileBinding[] {
  return [
    profiles.manifest,
    profiles.ruleset,
    profiles.eventSchema,
    profiles.abilityCompiler,
    profiles.geometry,
    profiles.triggerOrdering,
    profiles.fictionCombatTime,
    ...profiles.extensions,
  ].map((profile) => ({ profileRef: profile.profileId, profileHash: profile.profileHash }));
}

function blocked(
  reason: AdjudicationContextBlockReason,
  issues: readonly string[],
  budget: ContextWorkBudget,
): AdjudicationContextResult {
  return Object.freeze({
    kind: "blocked",
    reason,
    issues: Object.freeze([...issues].sort(compareCodeUnits)),
    privateReceipt: budget.receipt(),
  });
}
