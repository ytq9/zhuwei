import {
  canonicalClone,
  canonicalHash,
  canonicalUnits,
  compareCodeUnits,
  deepFreeze,
  isNonEmptyString,
  issueMessage,
  isPlainRecord,
  sortedUniqueStrings,
  type JsonRecord,
  type JsonValue,
} from "./canonical-json";

export const VNEXT_REQUIRED_CONTEXT_SCHEMA = "zhuwei.adjudication-context/vnext-1" as const;

export type KnownContextEntry = Readonly<{
  kind: "known";
  entryRef: string;
  revisionOrHash: string;
  value: JsonValue;
}>;

/** Closed union: an absence claim that cannot say precisely what is absent is
 * not a claim the KP can rely on. */
export type AbsenceSelectorBinding =
  | Readonly<{ kind: "exactRef"; ref: string }>
  | Readonly<{ kind: "semanticKind"; semanticKind: string }>
  | Readonly<{ kind: "templateRef"; templateRef: string }>
  | Readonly<{ kind: "templateFamily"; templateFamily: string }>
  /** A structured condition, not an opaque fingerprint, is what a negative
   * applicability assertion denies. */
  | Readonly<{ kind: "conditionSignature"; conditionSignature: JsonRecord }>;

/**
 * Authoritative negative evidence, bound to the scope and selector it denies.
 * Never derived from retrieval finding nothing: a search that returned no hits
 * has not established that the world is empty.
 */
export type KnownAbsentContextEntry = Readonly<{
  kind: "knownAbsent";
  entryRef: string;
  scopeRef: string;
  selector: AbsenceSelectorBinding;
  basisRefs: readonly string[];
}>;

/**
 * Room the KP is permitted to settle, carrying the grant that permits it. The
 * authorization binding is recorded rather than trusted here; the integration
 * line validates it inside the transaction.
 */
export type OpenBlankContextEntry = Readonly<{
  kind: "openBlank";
  entryRef: string;
  scopeRef: string;
  allowedKinds: readonly string[];
  basisRefs: readonly string[];
  authorizationRef: string;
  authorizationHash: string;
}>;

export type AmbiguityCandidate = Readonly<{
  ref: string;
  matchKind: "exactRef" | "alias" | "lexical";
  score: number;
  basisRefs: readonly string[];
}>;

/**
 * An unresolved reading of the player's words, frozen with its evidence.
 *
 * Preparation reports ambiguity; it never resolves it and never opens a pending
 * input. Whether to ask the player, infer from fiction, or refuse is the KP's
 * judgement, and `viewerSafe` only records whether asking is even permissible
 * -- every candidate addressable by that player -- not that asking is right.
 */
export type AmbiguousContextEntry = Readonly<{
  kind: "ambiguous";
  entryRef: string;
  obligation: string;
  /** `kpMaySelect`: the readings differ, but not in what the player would care
   * about — the KP picks and records why. `clarificationRequired`: the choice
   * changes danger, a significant resource, what is attacked, what is
   * reachable, or something irreversible. Preparation states which applies; it
   * still resolves neither and opens no pending input. */
  resolution: "kpMaySelect" | "clarificationRequired";
  candidates: readonly AmbiguityCandidate[];
  /** False when the candidate set was cut short by a bound rather than by
   * running out of plausible readings. */
  frontierExhausted: boolean;
  viewerSafe: boolean;
}>;

export type UnavailableContextEntry = Readonly<{
  kind: "unavailable";
  entryRef: string;
  reason: "redacted" | "notLoaded" | "truncated" | "invalidProjection" | "stale";
  critical: boolean;
}>;

export type RequiredContextEntry =
  | KnownContextEntry
  | KnownAbsentContextEntry
  | OpenBlankContextEntry
  | AmbiguousContextEntry
  | UnavailableContextEntry;

export type ProfileBinding = Readonly<{
  profileRef: string;
  profileHash: string;
}>;

export type ReadSetEntry = Readonly<{
  ref: string;
  revisionOrHash: string;
}>;

export type FrozenPlayerIntent = Readonly<{
  submissionRef: string;
  actorRef: string;
  text: string;
}>;

export type RequiredContextReferenceDirectory = Readonly<{
  citations: Readonly<{
    viewerEvidenceRefs: readonly string[];
    authorityBasisRefs: readonly string[];
    npcKnowledge: readonly Readonly<{
      npcRef: string;
      refs: readonly string[];
    }>[];
    nonCitableRefs: readonly string[];
  }>;
  domains: Readonly<{
    abilityRefs: readonly string[];
    itemRefs: readonly string[];
    semanticRefs: readonly string[];
  }>;
}>;

export type RequiredContextBindingInput = Readonly<{
  roomEpochRef: string;
  rootActionId: string;
  preparedActionId: string;
  baseEventSeq: string;
  stateHash: string;
  projectionHash: string;
  profiles: readonly ProfileBinding[];
  /** Empty while the KP is choosing a proposal. The actual transaction read
   * set is derived later into the server-private InteractionPlan. */
  readSet: readonly ReadSetEntry[];
}>;

export type RequiredContextBinding = RequiredContextBindingInput & Readonly<{
  contextHash: string;
}>;

export type VNextRequiredContext = Readonly<{
  schema: typeof VNEXT_REQUIRED_CONTEXT_SCHEMA;
  intent: FrozenPlayerIntent;
  entries: readonly RequiredContextEntry[];
  references: RequiredContextReferenceDirectory;
  binding: RequiredContextBinding;
}>;

export type RequiredContextInput = Readonly<{
  intent: FrozenPlayerIntent;
  entries: readonly RequiredContextEntry[];
  references: RequiredContextReferenceDirectory;
  binding: RequiredContextBindingInput;
  maxUnits: number;
}>;

export type RequiredContextBuildResult =
  | Readonly<{
      kind: "accepted";
      context: VNextRequiredContext;
      usedUnits: number;
      maxUnits: number;
    }>
  | Readonly<{
      kind: "rejected";
      code:
        | "CONTEXT_INVALID"
        | "CONTEXT_CRITICAL_UNAVAILABLE"
        | "CONTEXT_BUDGET_EXCEEDED";
      issues: readonly string[];
    }>;

export function buildRequiredContext(input: RequiredContextInput): RequiredContextBuildResult {
  try {
    if (!Number.isSafeInteger(input.maxUnits) || input.maxUnits <= 0) {
      return rejected("CONTEXT_INVALID", ["maxUnits:positive-safe-integer-required"]);
    }
    const intent = normalizeIntent(input.intent);
    const entries = normalizeEntries(input.entries);
    const references = normalizeReferenceDirectory(input.references);
    const binding = normalizeBinding(input.binding);
    assertEntriesHaveCitationClass(entries, references);

    const criticalUnavailable = entries
      .filter((entry): entry is UnavailableContextEntry =>
        entry.kind === "unavailable" && entry.critical)
      .map((entry) => `entry:${entry.entryRef}:${entry.reason}`);
    if (criticalUnavailable.length > 0) {
      return rejected("CONTEXT_CRITICAL_UNAVAILABLE", criticalUnavailable);
    }

    const hashPayload = {
      schema: VNEXT_REQUIRED_CONTEXT_SCHEMA,
      intent,
      entries,
      references,
      binding,
    };
    const contextHash = canonicalHash(hashPayload);
    const context = deepFreeze({
      schema: VNEXT_REQUIRED_CONTEXT_SCHEMA,
      intent,
      entries,
      references,
      binding: {
        ...binding,
        contextHash,
      },
    }) as VNextRequiredContext;
    const usedUnits = canonicalUnits(context);
    if (usedUnits > input.maxUnits) {
      return rejected("CONTEXT_BUDGET_EXCEEDED", [
        `requiredUnits:${usedUnits}`,
        `maxUnits:${input.maxUnits}`,
      ]);
    }
    return Object.freeze({
      kind: "accepted",
      context,
      usedUnits,
      maxUnits: input.maxUnits,
    });
  } catch (error) {
    return rejected("CONTEXT_INVALID", [issueMessage(error)]);
  }
}

function normalizeIntent(intent: FrozenPlayerIntent): FrozenPlayerIntent {
  if (intent === null || typeof intent !== "object" || Array.isArray(intent)) {
    throw new TypeError("intent:object-required");
  }
  assertRef(intent.submissionRef, "intent.submissionRef");
  assertRef(intent.actorRef, "intent.actorRef");
  if (!isNonEmptyString(intent.text) || intent.text.length > 8_000) {
    throw new TypeError("intent.text:non-empty-bounded-string-required");
  }
  return deepFreeze({
    submissionRef: intent.submissionRef,
    actorRef: intent.actorRef,
    text: intent.text.normalize("NFC"),
  });
}

function normalizeEntries(entries: readonly RequiredContextEntry[]): readonly RequiredContextEntry[] {
  const normalized = entries.map((entry) => {
    assertRef(entry.entryRef, "entry.entryRef");
    if (entry.kind === "known") {
      assertRef(entry.revisionOrHash, `${entry.entryRef}.revisionOrHash`);
      return deepFreeze({
        kind: entry.kind,
        entryRef: entry.entryRef,
        revisionOrHash: entry.revisionOrHash,
        value: canonicalClone(entry.value),
      }) as KnownContextEntry;
    }
    if (entry.kind === "knownAbsent") {
      assertRef(entry.scopeRef, `${entry.entryRef}.scopeRef`);
      const basisRefs = sortedUniqueStrings(entry.basisRefs, `${entry.entryRef}.basisRefs`);
      // A denial with no basis is an assertion, not evidence.
      if (basisRefs.length === 0) {
        throw new TypeError(`${entry.entryRef}.basisRefs:non-empty-required`);
      }
      return Object.freeze({
        kind: entry.kind,
        entryRef: entry.entryRef,
        scopeRef: entry.scopeRef,
        selector: normalizeSelector(entry.selector, entry.entryRef),
        basisRefs,
      });
    }
    if (entry.kind === "openBlank") {
      assertRef(entry.scopeRef, `${entry.entryRef}.scopeRef`);
      assertRef(entry.authorizationRef, `${entry.entryRef}.authorizationRef`);
      assertRef(entry.authorizationHash, `${entry.entryRef}.authorizationHash`);
      const allowedKinds = sortedUniqueStrings(entry.allowedKinds, `${entry.entryRef}.allowedKinds`);
      if (allowedKinds.length === 0) throw new TypeError(`${entry.entryRef}.allowedKinds:non-empty-required`);
      const basisRefs = sortedUniqueStrings(entry.basisRefs, `${entry.entryRef}.basisRefs`);
      if (basisRefs.length === 0) {
        throw new TypeError(`${entry.entryRef}.basisRefs:non-empty-required`);
      }
      return Object.freeze({
        kind: entry.kind,
        entryRef: entry.entryRef,
        scopeRef: entry.scopeRef,
        allowedKinds,
        basisRefs,
        authorizationRef: entry.authorizationRef,
        authorizationHash: entry.authorizationHash,
      });
    }
    if (entry.kind === "ambiguous") {
      if (!isNonEmptyString(entry.obligation)) {
        throw new TypeError(`${entry.entryRef}.obligation:non-empty-string-required`);
      }
      const candidates = [...entry.candidates]
        .map((candidate) => {
          assertRef(candidate.ref, `${entry.entryRef}.candidates.ref`);
          if (!["exactRef", "alias", "lexical"].includes(candidate.matchKind)) {
            throw new TypeError(`${entry.entryRef}.candidates.matchKind:invalid`);
          }
          if (!Number.isSafeInteger(candidate.score) || candidate.score < 0) {
            throw new TypeError(`${entry.entryRef}.candidates.score:non-negative-safe-integer-required`);
          }
          return Object.freeze({
            ref: candidate.ref,
            matchKind: candidate.matchKind,
            score: candidate.score,
            basisRefs: sortedUniqueStrings(
              candidate.basisRefs,
              `${entry.entryRef}.candidates.basisRefs`,
            ),
          });
        })
        .sort((left, right) => compareCodeUnits(left.ref, right.ref));
      if (candidates.length < 2) throw new TypeError(`${entry.entryRef}.candidates:two-required`);
      if (!["kpMaySelect", "clarificationRequired"].includes(entry.resolution)) {
        throw new TypeError(`${entry.entryRef}.resolution:invalid`);
      }
      // Asking about a reading the player cannot perceive would turn a secret
      // into an option.
      if (entry.resolution === "clarificationRequired" && entry.viewerSafe !== true) {
        throw new TypeError(`${entry.entryRef}.resolution:clarification-requires-viewer-safe`);
      }
      if (candidates.some((candidate, index) =>
        index > 0 && candidate.ref === candidates[index - 1]!.ref)) {
        throw new TypeError(`${entry.entryRef}.candidates:duplicate-ref`);
      }
      for (const [label, value] of Object.entries({
        frontierExhausted: entry.frontierExhausted,
        viewerSafe: entry.viewerSafe,
      })) {
        if (typeof value !== "boolean") throw new TypeError(`${entry.entryRef}.${label}:boolean-required`);
      }
      return Object.freeze({
        kind: entry.kind,
        entryRef: entry.entryRef,
        obligation: entry.obligation,
        resolution: entry.resolution,
        candidates: Object.freeze(candidates),
        frontierExhausted: entry.frontierExhausted,
        viewerSafe: entry.viewerSafe,
      });
    }
    if (entry.kind === "unavailable") {
      if (!["redacted", "notLoaded", "truncated", "invalidProjection", "stale"].includes(entry.reason)) {
        throw new TypeError(`${entry.entryRef}.reason:invalid`);
      }
      if (typeof entry.critical !== "boolean") throw new TypeError(`${entry.entryRef}.critical:boolean-required`);
      return Object.freeze({ ...entry });
    }
    return assertNever(entry);
  }).sort((left, right) => compareCodeUnits(left.entryRef, right.entryRef));
  if (normalized.some((entry, index) => index > 0 && entry.entryRef === normalized[index - 1]!.entryRef)) {
    throw new TypeError("entries:duplicate-entry-ref");
  }
  return Object.freeze(normalized);
}

function normalizeBinding(binding: RequiredContextBindingInput): RequiredContextBindingInput {
  for (const [label, value] of Object.entries({
    roomEpochRef: binding.roomEpochRef,
    rootActionId: binding.rootActionId,
    preparedActionId: binding.preparedActionId,
    stateHash: binding.stateHash,
    projectionHash: binding.projectionHash,
  })) assertRef(value, `binding.${label}`);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(binding.baseEventSeq)) {
    throw new TypeError("binding.baseEventSeq:canonical-nonnegative-integer-required");
  }
  const profiles = normalizeKeyedValues(
    binding.profiles,
    "profileRef",
    "profileHash",
    "binding.profiles",
  ) as readonly ProfileBinding[];
  if (profiles.length === 0) throw new TypeError("binding.profiles:non-empty-required");
  const readSet = normalizeKeyedValues(
    binding.readSet,
    "ref",
    "revisionOrHash",
    "binding.readSet",
  ) as readonly ReadSetEntry[];
  if (readSet.length !== 0) {
    throw new TypeError("binding.readSet:must-be-empty-before-proposal-lowering");
  }
  return deepFreeze({
    roomEpochRef: binding.roomEpochRef,
    rootActionId: binding.rootActionId,
    preparedActionId: binding.preparedActionId,
    baseEventSeq: binding.baseEventSeq,
    stateHash: binding.stateHash,
    projectionHash: binding.projectionHash,
    profiles,
    readSet,
  });
}

function normalizeKeyedValues<T extends Record<K | V, string>, K extends string, V extends string>(
  values: readonly T[],
  keyField: K,
  valueField: V,
  label: string,
): readonly T[] {
  const normalized = values.map((entry) => {
    assertRef(entry[keyField], `${label}.${keyField}`);
    assertRef(entry[valueField], `${label}.${valueField}`);
    return Object.freeze({ ...entry });
  }).sort((left, right) => compareCodeUnits(left[keyField], right[keyField]));
  if (normalized.some((entry, index) => index > 0 && entry[keyField] === normalized[index - 1]![keyField])) {
    throw new TypeError(`${label}:duplicate-${keyField}`);
  }
  return Object.freeze(normalized);
}

function normalizeReferenceDirectory(
  references: RequiredContextReferenceDirectory,
): RequiredContextReferenceDirectory {
  const npcKnowledge = references.citations.npcKnowledge.map((entry) => {
    assertRef(entry.npcRef, "references.npcKnowledge.npcRef");
    return Object.freeze({
      npcRef: entry.npcRef,
      refs: sortedUniqueStrings(entry.refs, `${entry.npcRef}.knowledgeRefs`),
    });
  }).sort((left, right) => compareCodeUnits(left.npcRef, right.npcRef));
  if (npcKnowledge.some((entry, index) => index > 0 && entry.npcRef === npcKnowledge[index - 1]!.npcRef)) {
    throw new TypeError("references.npcKnowledge:duplicate-npc-ref");
  }
  const normalized = deepFreeze({
    citations: {
      viewerEvidenceRefs: sortedUniqueStrings(
        references.citations.viewerEvidenceRefs,
        "references.viewerEvidenceRefs",
      ),
      authorityBasisRefs: sortedUniqueStrings(
        references.citations.authorityBasisRefs,
        "references.authorityBasisRefs",
      ),
      npcKnowledge: Object.freeze(npcKnowledge),
      nonCitableRefs: sortedUniqueStrings(
        references.citations.nonCitableRefs,
        "references.nonCitableRefs",
      ),
    },
    domains: {
      abilityRefs: sortedUniqueStrings(references.domains.abilityRefs, "references.abilityRefs"),
      itemRefs: sortedUniqueStrings(references.domains.itemRefs, "references.itemRefs"),
      semanticRefs: sortedUniqueStrings(references.domains.semanticRefs, "references.semanticRefs"),
    },
  }) as RequiredContextReferenceDirectory;
  return normalized;
}

function assertEntriesHaveCitationClass(
  entries: readonly RequiredContextEntry[],
  references: RequiredContextReferenceDirectory,
): void {
  const classified = new Set<string>([
    ...references.citations.viewerEvidenceRefs,
    ...references.citations.authorityBasisRefs,
    ...references.citations.nonCitableRefs,
    ...references.citations.npcKnowledge.flatMap((entry) => [...entry.refs]),
  ]);
  for (const entry of entries) {
    if (entry.kind === "known" && !classified.has(entry.entryRef)) {
      throw new TypeError(`entry:${entry.entryRef}:citation-class-missing`);
    }
  }
}

function normalizeSelector(value: unknown, label: string): AbsenceSelectorBinding {
  if (isPlainSelector(value)) {
    if (value.kind === "exactRef") {
      assertRef(value.ref, `${label}.selector.ref`);
      return Object.freeze({ kind: "exactRef", ref: value.ref });
    }
    if (value.kind === "semanticKind") {
      assertRef(value.semanticKind, `${label}.selector.semanticKind`);
      return Object.freeze({ kind: "semanticKind", semanticKind: value.semanticKind });
    }
    if (value.kind === "templateRef") {
      assertRef(value.templateRef, `${label}.selector.templateRef`);
      return Object.freeze({ kind: "templateRef", templateRef: value.templateRef });
    }
    if (value.kind === "templateFamily") {
      assertRef(value.templateFamily, `${label}.selector.templateFamily`);
      return Object.freeze({ kind: "templateFamily", templateFamily: value.templateFamily });
    }
    if (value.kind === "conditionSignature") {
      if (!isPlainRecord(value.conditionSignature)) {
        throw new TypeError(`${label}.selector.conditionSignature:object-required`);
      }
      return Object.freeze({
        kind: "conditionSignature",
        conditionSignature: canonicalClone(value.conditionSignature) as JsonRecord,
      });
    }
  }
  throw new TypeError(`${label}.selector:closed-union-required`);
}

function isPlainSelector(value: unknown): value is Record<string, unknown> & { kind: string } {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { kind?: unknown }).kind === "string";
}

function assertRef(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value) || value.length > 300) throw new TypeError(`${label}:invalid-ref`);
}

function rejected(
  code: Extract<RequiredContextBuildResult, { kind: "rejected" }>['code'],
  issues: readonly string[],
): Extract<RequiredContextBuildResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...issues].sort(compareCodeUnits)),
  });
}

function assertNever(value: never): never {
  throw new TypeError(`entry.kind:unsupported:${String((value as { kind?: unknown }).kind)}`);
}
