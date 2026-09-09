import type { AuthoritativeModuleProfile } from "../module/authoritative";
import { buildRequiredContext, type VNextRequiredContext } from "../kp/vnext/required-context";
import { canonicalHash, deepFreeze, type JsonValue } from "../kp/vnext/canonical-json";
import type { StoryPreparation, StoryReview, StoryHash } from "./story-creation/contracts";

export type StoryPreparationBinding = Readonly<{
  format: "zhuwei.story-preparation-ready/v1";
  jobId: string;
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
  maxUnits: number;
}>) {
  const preparationHash = canonicalHash(input.preparation) as StoryHash;
  if (input.review.preparationHash !== preparationHash
    || input.review.contextHash !== input.preparation.contextHash
    || input.review.findings.some(finding => finding.verdict !== "pass")
    || input.review.recipeCriteria.some(criterion => criterion.verdict !== "pass")) {
    return { kind: "rejected" as const, code: "STORY_REVIEW_REJECTED" as const };
  }
  const entryRef = `story-preparation:${preparationHash}`;
  const original = input.selectionContext;
  const { contextHash: _prior, ...binding } = original.binding;
  const value = { schema: "zhuwei.prepared-story-context/v1", nature: "reviewedCandidateOnly",
    preparation: input.preparation, preparationHash, review: input.review };
  const built = buildRequiredContext({ intent: original.intent, binding,
    entries: [...original.entries, { kind: "known", entryRef, revisionOrHash: canonicalHash(value), value: value as unknown as JsonValue }],
    references: { ...original.references, citations: { ...original.references.citations,
      nonCitableRefs: [...original.references.citations.nonCitableRefs, entryRef] } }, maxUnits: input.maxUnits });
  if (built.kind !== "accepted") return { kind: "rejected" as const, code: "STORY_CONTEXT_INSUFFICIENT" as const };
  return deepFreeze({ kind: "ready" as const, context: built.context, binding: {
    format: "zhuwei.story-preparation-ready/v1" as const, jobId: input.preparation.jobId, preparationHash,
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
