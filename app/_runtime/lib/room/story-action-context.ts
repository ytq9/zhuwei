import type { AuthoritativeModuleProfile } from "../module/authoritative";
import { buildRequiredContext, type VNextRequiredContext, type KnownContextEntry } from "../kp/vnext/required-context";
import { canonicalHash, deepFreeze, isPlainRecord, type JsonValue } from "../kp/vnext/canonical-json";
import { authorityRevisionOrHash, type AuthoritativeWorldState } from "../rules/authority-read";
import type { StoryContext, StoryPreparation, StoryReview, StoryHash } from "./story-creation/contracts";
import type { StoryAdmissionOwner, StoryLibraryBinding } from "./story-library-contracts";
import { validateStoredReview } from "./story-creation/prompt";
import { storyReviewPassed } from "./story-creation/review";

export type StoryPreparationBinding = Readonly<{
  format: "zhuwei.story-preparation-ready/v1";
  jobId: string;
  admissionOwner: StoryAdmissionOwner;
  /** Present only when selected through the frozen library directory. */
  library?: StoryLibraryBinding;
  preparationHash: StoryHash;
  reviewHash: StoryHash;
  moduleProfile: AuthoritativeModuleProfile;
  /** The initial selection remains pinned to this exact earlier context. */
  selectionContext: VNextRequiredContext;
  contextHash: string;
}>;

export type StoryPreparationReady =
  | { kind: "ready"; context: VNextRequiredContext; binding: StoryPreparationBinding }
  | { kind: "waiting" | "rejected"; code: string };

/** A proved preparation boundary can add private hosting material before the
 * first ruling. Ordinary selection/filling never changes its frozen context. */
export function bindStoryPreparationContext(input: Readonly<{
  selectionContext: VNextRequiredContext;
  moduleProfile: AuthoritativeModuleProfile;
  preparation: StoryPreparation;
  review: StoryReview;
  storyContext: StoryContext;
  state: AuthoritativeWorldState;
  maxUnits: number;
  library?: StoryLibraryBinding;
}>) {
  const preparationHash = canonicalHash(input.preparation) as StoryHash;
  try { validateStoredReview(input.review); } catch { return { kind: "rejected" as const, code: "STORY_REVIEW_REJECTED" as const }; }
  if (input.review.preparationHash !== preparationHash
    || input.review.contextHash !== input.preparation.contextHash
    || !storyReviewPassed(input.review)) {
    return { kind: "rejected" as const, code: "STORY_REVIEW_REJECTED" as const };
  }
  const entryRef = `story-preparation:${preparationHash}`;
  const original = input.selectionContext;
  if (!input.library && input.storyContext.contextHash !== input.preparation.contextHash) return { kind: "rejected" as const, code: "STORY_CONTEXT_STALE" as const };
  const entries = new Map(original.entries.map(entry => [entry.entryRef, entry]));
  const authorityRefs = new Set(original.references.citations.authorityBasisRefs);
  const nonCitableRefs = new Set(original.references.citations.nonCitableRefs);
  const npcKnowledge = new Map(original.references.citations.npcKnowledge.map(value => [value.npcRef, new Set(value.refs)]));
  const materials = new Map(input.storyContext.materials.map(material => [material.ref, material]));
  for (const dependency of input.storyContext.readSet) {
    const revision = authorityRevisionOrHash(input.state, dependency.ref);
    // Story-only query witnesses are rechecked by Room, not offered as
    // invented canonical facts or mechanical read bindings.
    if (revision === null) continue;
    const existing = entries.get(dependency.ref);
    if (existing !== undefined) {
      if (existing.kind !== "known" || existing.revisionOrHash !== revision) return { kind: "rejected" as const, code: "STORY_CONTEXT_STALE" as const };
      continue;
    }
    const material = materials.get(dependency.ref);
    const knowledge = material?.kind === "knowledge" && isPlainRecord(material.content)
      && typeof material.content.holderRef === "string" && isPlainRecord(material.content.record) ? material.content : undefined;
    const value = knowledge?.record ?? material?.content ?? { ref: dependency.ref, authorityRevision: revision };
    entries.set(dependency.ref, { kind: "known", entryRef: dependency.ref, revisionOrHash: revision,
      value: value as JsonValue } satisfies KnownContextEntry);
    if (knowledge !== undefined && input.state.entities[String(knowledge.holderRef)]?.kind === "npc") {
      const refs = npcKnowledge.get(String(knowledge.holderRef)) ?? new Set<string>();
      refs.add(dependency.ref); npcKnowledge.set(String(knowledge.holderRef), refs);
    } else if (material?.availability === "known") authorityRefs.add(dependency.ref);
    else nonCitableRefs.add(dependency.ref);
  }
  const { contextHash: _prior, ...binding } = original.binding;
  const value = { schema: "zhuwei.prepared-story-context/v1", nature: "reviewedCandidateOnly",
    preparation: input.preparation, preparationHash, review: input.review,
    ...(input.library ? { admitted: input.library.mappings, blockedCandidateRefs: input.library.blockedCandidateRefs,
      revalidationHash: input.library.validationHash, currentContextHash: input.library.currentContext.contextHash } : {}) };
  const built = buildRequiredContext({ intent: original.intent, binding,
    entries: [...entries.values(), { kind: "known", entryRef, revisionOrHash: canonicalHash(value), value: value as unknown as JsonValue }],
    references: { ...original.references, citations: { ...original.references.citations,
      authorityBasisRefs: [...authorityRefs], npcKnowledge: [...npcKnowledge].map(([npcRef, refs]) => ({ npcRef, refs: [...refs] })),
      nonCitableRefs: [...nonCitableRefs, entryRef] } }, maxUnits: input.maxUnits });
  if (built.kind !== "accepted") return { kind: "rejected" as const, code: "STORY_CONTEXT_INSUFFICIENT" as const };
  return deepFreeze({ kind: "ready" as const, context: built.context, binding: {
    format: "zhuwei.story-preparation-ready/v1" as const, jobId: input.preparation.jobId, preparationHash,
    admissionOwner: input.library?.owner ?? { kind: "creationJob", jobId: input.preparation.jobId },
    ...(input.library ? { library: input.library } : {}),
    reviewHash: canonicalHash(input.review) as StoryHash, moduleProfile: structuredClone(input.moduleProfile), selectionContext: original,
    contextHash: built.context.binding.contextHash,
  } satisfies StoryPreparationBinding });
}

export function storyContextBindingMatches(context: VNextRequiredContext, binding: StoryPreparationBinding): boolean {
  if (binding.format !== "zhuwei.story-preparation-ready/v1" || context.binding.contextHash !== binding.contextHash) return false;
  const original = binding.selectionContext;
  return original.intent.submissionRef === context.intent.submissionRef
    && canonicalHash(original.intent) === canonicalHash(context.intent)
    && original.binding.preparedActionId === context.binding.preparedActionId
    && original.binding.rootActionId === context.binding.rootActionId
    && original.binding.roomEpochRef === context.binding.roomEpochRef;
}
