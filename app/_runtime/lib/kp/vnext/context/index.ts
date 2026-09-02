import type { RuntimeProfileManifest } from "../../../rules/profiles/types";
import {
  authorityRevisionOrHash,
  type AuthoritativeWorldState,
  type KpSpatialReadModel,
} from "../../../rules/authority-read";
import {
  canonicalUnits,
  compareCodeUnits,
  isPlainRecord,
  type JsonValue,
} from "../canonical-json";
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
import { authorityCompositeRecord, indexableRecord } from "./authority-records";
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
  replayHead: Readonly<{ eventSeq: string; stateHash: string }>;
  preparedActionId: string;
  rootActionId: string;
  submissionRef: string;
  actorCharacterId: string;
  intentText: string;
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
    subject: { kind: "kp", sceneRef },
    focusRefs: input.focusRefs ?? [],
    intentText: input.intentText,
    profile: retrieval,
    budget,
  });
  if (discovered.kind !== "discovered") {
    return blocked("preparationLimit", ["candidateDiscovery:work-budget-exhausted"], budget);
  }

  const closed = closeObligations({
    index,
    seeds: seeds(input, sceneRef, discovered.candidates, precedentRefs(precedent))
      .filter(({ ref }) => index.nodes.has(ref)),
    budget,
    // A declared ref that authority cannot address is not a missing record: it
    // names something resolved inside another record, such as a tactical
    // obstacle carried by its scene's geometry. Reporting it as unreadable
    // would block on a gap that does not exist.
    dependencies: (ref, obligation, node) =>
      declaredDependencies(input.state, index, sceneRef, obligation, node, budget)
        .filter((seed) => index.nodes.has(seed.ref)),
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
      : rereadEntry(input.state, node, closedRef, decisive, caps.maxEntryRereadBytes, budget);
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
  for (const requirement of input.availabilityRequirements ?? []) {
    const outcome = resolveAvailability({
      state: input.state,
      index,
      requirement,
      authorizations: input.openBlankAuthorizations ?? [],
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
    }
  }
  if (precedent?.kind === "knownAbsent") entries.push(precedent.entry);

  const built = buildRequiredContext({
    intent: {
      submissionRef: input.submissionRef,
      actorRef: input.actorCharacterId,
      text: input.intentText,
    },
    entries,
    references: referenceDirectory(input.state, input.actorCharacterId, citations, domains),
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
): readonly ObligationSeed[] {
  if (node === undefined) return [];
  if (!budget.charge("postingVisits", 1)) return [];

  // What a character can do, carries and knows is bounded by that character.
  // The replaced collector reached the same material by sweeping every entity
  // in the scene; here it arrives only for characters the action actually
  // turns on, and each character's knowledge stays its own slice.
  if (node.kind === "entity" && (obligation === "actor" || obligation === "target")) {
    const combatEntity = state.combatRuntime.entities[node.ref];
    const abilityRefs = obligation === "actor"
      && isPlainRecord(combatEntity)
      && Array.isArray(combatEntity.abilityRefs)
      ? combatEntity.abilityRefs
      : [];
    return [
      ...abilityRefs.flatMap((abilityRef) => typeof abilityRef === "string"
        ? [{ ref: abilityRef, obligation: "ability" as ContextObligation }]
        : []),
      ...(index.itemEntriesByHolder.get(node.ref) ?? []).map((entryRef) => ({
        ref: entryRef,
        obligation: "instrument" as ContextObligation,
      })),
      ...(index.knowledgeByHolder.get(node.ref) ?? []).map((knowledgeRef) => ({
        ref: knowledgeRef,
        obligation: "fact" as ContextObligation,
      })),
    ];
  }

  // Naming a kind of thing is not naming one of them. A definition the player
  // referred to resolves to the instances actually standing in this scene, and
  // to no others; which one they meant stays the KP's to decide.
  if (node.kind === "itemDefinition" && (obligation === "target" || obligation === "instrument")) {
    return (index.itemEntriesByDefinition.get(node.ref) ?? [])
      .filter((entryRef) => index.nodes.get(entryRef)?.sceneRef === sceneRef)
      .map((entryRef) => ({ ref: entryRef, obligation: "instrument" as ContextObligation }));
  }

  const record = indexableRecord(state, node);
  if (!isPlainRecord(record)) return [];

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
): RereadOutcome {
  const value = authorityCompositeRecord(state, node);
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
        : [{ npcRef: holderRef, knowledgeRef: ref.slice(`knowledge:${holderRef}:`.length) }];
    })
    .reduce<{ npcRef: string; refs: string[] }[]>((accumulated, entry) => {
      const existing = accumulated.find(({ npcRef }) => npcRef === entry.npcRef);
      if (existing === undefined) accumulated.push({ npcRef: entry.npcRef, refs: [entry.knowledgeRef] });
      else existing.refs.push(entry.knowledgeRef);
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
