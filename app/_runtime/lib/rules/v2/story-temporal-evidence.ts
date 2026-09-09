import type { AuthoritativeWorldState, KnowledgeRecord } from "./model";
import type { Sha256Ref } from "../profiles/types";

/** Frozen occurrence/acquisition evidence. This protocol belongs to Rules;
 * Story proposals and archive preparation records do not grant it authority. */
export type StoryTemporalBasis = Readonly<{
  kind: "at" | "between" | "before";
  start: Readonly<{ timelineId: string; micros: string }>;
  end: Readonly<{ timelineId: string; micros: string }> | null;
  basisRefs: readonly string[];
}>;

export type StoryTemporalKnowledge = Readonly<{
  candidateRef: string;
  holderRef: string;
  knowledgeRef: string;
  sourceRef: string;
  layer: "truth" | "sensoryEvidence" | "sourceClaim" | "inference";
  acquisition: StoryTemporalBasis;
}>;

export type StoryTemporalEvidence = Readonly<{
  schema: "zhuwei.story-temporal-evidence/v1";
  preparationHash: Sha256Ref;
  candidateRef: string;
  factRef: string;
  occurrence: StoryTemporalBasis;
  knowledge: readonly StoryTemporalKnowledge[];
}>;

const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.normalize("NFC") === value;
const micros = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const refs = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0 && value.every(text) && new Set(value).size === value.length;
const point = (value: unknown): value is StoryTemporalBasis["start"] => record(value)
  && exact(value, ["timelineId", "micros"]) && text(value.timelineId) && micros(value.micros);

export function isStoryTemporalBasis(value: unknown): value is StoryTemporalBasis {
  if (!record(value) || !exact(value, ["kind", "start", "end", "basisRefs"])
    || !["at", "between", "before"].includes(String(value.kind)) || !point(value.start)
    || !refs(value.basisRefs)) return false;
  return value.kind === "between"
    ? point(value.end) && value.end.timelineId === value.start.timelineId
      && BigInt(value.start.micros) <= BigInt(value.end.micros)
    : value.end === null && (value.kind !== "before" || value.start.micros !== "0");
}

export function isStoryTemporalEvidence(value: unknown): value is StoryTemporalEvidence {
  if (!record(value) || !exact(value, ["schema", "preparationHash", "candidateRef", "factRef", "occurrence", "knowledge"])
    || value.schema !== "zhuwei.story-temporal-evidence/v1"
    || typeof value.preparationHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.preparationHash)
    || !text(value.candidateRef) || !text(value.factRef) || !isStoryTemporalBasis(value.occurrence)
    || !Array.isArray(value.knowledge)) return false;
  const candidates = new Set<string>(), bindings = new Set<string>();
  return value.knowledge.every(entry => {
    if (!record(entry) || !exact(entry, ["candidateRef", "holderRef", "knowledgeRef", "sourceRef", "layer", "acquisition"])
      || !text(entry.candidateRef) || !text(entry.holderRef) || !text(entry.knowledgeRef) || !text(entry.sourceRef)
      || !["truth", "sensoryEvidence", "sourceClaim", "inference"].includes(String(entry.layer))
      || !isStoryTemporalBasis(entry.acquisition)) return false;
    const key = `${entry.holderRef}\u0000${entry.knowledgeRef}`;
    if (candidates.has(entry.candidateRef) || bindings.has(key)) return false;
    candidates.add(entry.candidateRef); bindings.add(key);
    return true;
  });
}

export function storyTemporalEvidenceRef(preparationHash: string, candidateRef: string): string {
  return `story-time:${preparationHash}:${candidateRef}`;
}

export function storyTemporalKnowledgeKind(layer: StoryTemporalKnowledge["layer"]): KnowledgeRecord["objectKind"] {
  return ({ truth: "canonicalFact", sensoryEvidence: "sensoryEvidence", sourceClaim: "sourceClaim", inference: "characterInference" } as const)[layer];
}

/** A range straddling the cut does not prove either historical membership or
 * absence. Callers must preserve this distinction instead of rounding time. */
export function storyTemporalPosition(basis: StoryTemporalBasis, state: AuthoritativeWorldState): "established" | "after" | "unresolved" {
  const timeline = state.fictionTimelines[basis.start.timelineId];
  if (!timeline || timeline.branchId !== state.activeBranchId) return "unresolved";
  const now = BigInt(timeline.nowMicros), start = BigInt(basis.start.micros);
  if (basis.kind === "at") return start <= now ? "established" : "after";
  if (basis.kind === "before") return start <= now ? "established" : "unresolved";
  if (basis.end !== null && BigInt(basis.end.micros) <= now) return "established";
  return start > now ? "after" : "unresolved";
}

function basisAvailable(state: AuthoritativeWorldState, ref: string): boolean {
  return Object.hasOwn(state.canonicalFacts, ref) || Object.hasOwn(state.entities, ref)
    || Object.hasOwn(state.scenes, ref) || Object.hasOwn(state.campaignRuntime.definitions, ref)
    || Object.hasOwn(state.campaignRuntime.sourceClaims, ref)
    || Object.entries(state.knowledge).some(([holder, entries]) => Object.hasOwn(entries, ref)
      || Object.keys(entries).some(key => ref === `knowledge:${holder}:${key}`));
}

export function storyTemporalKnowledgeMatches(state: AuthoritativeWorldState, value: StoryTemporalEvidence,
  binding: StoryTemporalKnowledge): boolean {
  const held = state.knowledge[binding.holderRef]?.[binding.knowledgeRef];
  return state.entities[binding.holderRef] !== undefined && held !== undefined
    && held.characterId === binding.holderRef && held.knowledgeRef === binding.knowledgeRef
    && held.objectKind === storyTemporalKnowledgeKind(binding.layer)
    && held.provenanceChain.includes(value.factRef)
    && (held.provenanceChain.includes(binding.sourceRef) || held.knowledgeRef === binding.sourceRef
      || held.sourceCharacterId === binding.sourceRef
      || held.sourceCharacterId === null && held.characterId === binding.sourceRef);
}

/** Called after the fact and real knowledge records have been materialized in
 * the same Rules action. The host separately checks exact reviewed-package
 * equality; this validator owns state, reference and temporal causality. */
export function storyTemporalEvidenceIssue(state: AuthoritativeWorldState, value: unknown): string | undefined {
  if (!isStoryTemporalEvidence(value)) return "story-time:invalid-evidence";
  const fact = state.canonicalFacts[value.factRef];
  if (!fact || fact.kind === "storyTemporalEvidence" || fact.branchId !== state.activeBranchId) return "story-time:fact-unavailable";
  if (storyTemporalPosition(value.occurrence, state) !== "established"
    || !value.occurrence.basisRefs.every(ref => basisAvailable(state, ref))) return "story-time:occurrence-unavailable";
  for (const binding of value.knowledge) {
    if (!storyTemporalKnowledgeMatches(state, value, binding)) return "story-time:knowledge-binding-invalid";
    if (storyTemporalPosition(binding.acquisition, state) !== "established"
      || !binding.acquisition.basisRefs.every(ref => basisAvailable(state, ref))) return "story-time:acquisition-unavailable";
    // Require a provable ordering for retrospective knowledge. Prose claiming
    // a cause cannot resolve overlapping or unspecified acquisition bounds.
    const occurrenceThrough = value.occurrence.end?.micros ?? value.occurrence.start.micros;
    if (binding.acquisition.kind === "before"
      || BigInt(occurrenceThrough) > BigInt(binding.acquisition.start.micros)) return "story-time:acquisition-causality-unresolved";
  }
  return undefined;
}
