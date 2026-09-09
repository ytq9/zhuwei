import type { StoryCheckpoint, StoryContext, StoryCreationPorts, StoryPreparation, StoryRequest } from "./contracts";
import { isRecord, readStoryModelResponse, type StoryPreparationBody } from "./prompt";
import { inspectStoryPreparation, storyReviewAllowsRevision, storyReviewPassed, STORY_REVIEW_CATEGORIES,
  validateStoryReview } from "./review";

/** Minimal immutable evidence from the host's existing invocation journal.
 * This reader has no ability to invoke, settle usage or authorize a draft. */
type InspectionEvidence = Readonly<{
  request: StoryRequest;
  context: StoryContext;
  hash: StoryCreationPorts["hash"];
  invocations: readonly Readonly<{
    jobId: string | null;
    stage: string | null;
    status: string;
    eligible: boolean;
    response?: unknown;
  }>[];
}>;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const hashRef = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
function invalid(): never { throw new TypeError("STORY_CHECKPOINT_CONFLICT"); }

/** Local resume validates the private diagnostic's shape and failed stage.
 * Persistence/export/import must also supply the saved invocation evidence:
 * a matching hash alone never proves that inspection found these failures.
 * A checkpoint without this diagnostic keeps its existing behavior. */
export function validateStoryInspectionFailure(checkpoint: StoryCheckpoint | null, evidence?: InspectionEvidence): void {
  if (checkpoint === null || !Object.hasOwn(checkpoint, "inspectionFailure")) return;
  const failure = checkpoint.inspectionFailure;
  if (checkpoint.status !== "rejected" || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1
    || !["STORY_OUTPUT_INVALID", "STORY_CHECKPOINT_CONFLICT", "STORY_IDENTITY_CONFLICT", "STORY_CONTEXT_INSUFFICIENT", "STORY_CAPABILITY_UNSUPPORTED"].includes(checkpoint.failureCode!)
    || !isRecord(failure) || Object.keys(failure).sort().join() !== "candidateHash,findings,stage"
    || !hashRef(failure.candidateHash) || !Array.isArray(failure.findings) || failure.findings.length === 0
    || !["draft", "revision"].includes(failure.stage)) invalid();
  if (failure.stage === "draft"
    ? checkpoint.draft !== undefined || checkpoint.review !== undefined || checkpoint.revisedDraft !== undefined || checkpoint.revisedReview !== undefined
    : !checkpoint.draft || !checkpoint.review || storyReviewPassed(checkpoint.review) || !storyReviewAllowsRevision(checkpoint.review)
      || checkpoint.revisedDraft !== undefined || checkpoint.revisedReview !== undefined) invalid();
  for (const finding of failure.findings) {
    if (!isRecord(finding) || Object.keys(finding).sort().join() !== "candidatePaths,category,constraintRefs,explanation,repairable,verdict"
      || !STORY_REVIEW_CATEGORIES.some(category => category === finding.category) || finding.verdict !== "conflict" || finding.repairable !== false
      || !nonempty(finding.explanation) || !Array.isArray(finding.candidatePaths) || finding.candidatePaths.length === 0
      || finding.candidatePaths.some(path => !nonempty(path) || !path.startsWith("/") || /~(?:[^01]|$)/u.test(path))
      || !Array.isArray(finding.constraintRefs) || finding.constraintRefs.some(ref => !nonempty(ref))) invalid();
  }
  if (!evidence) return;
  const { request, context, hash, invocations } = evidence;
  const { contextHash, ...contextBody } = context;
  if (checkpoint.format !== "zhuwei.story-checkpoint/v1" || checkpoint.jobId !== request.jobId
    || checkpoint.requestHash !== hash(request) || checkpoint.contextHash !== contextHash || hash(contextBody) !== contextHash) invalid();
  if (failure.stage === "revision") {
    if (checkpoint.draft!.version !== "1" || inspectStoryPreparation(checkpoint.draft!, request, context, hash).kind !== "valid") invalid();
    validateStoryReview(checkpoint.review!, checkpoint.draft!, context, hash);
  }
  const calls = invocations.filter(call => call.jobId === request.jobId && call.stage === failure.stage);
  if (calls.length !== 1 || calls[0].status !== "completed" || calls[0].eligible !== true || !Object.hasOwn(calls[0], "response")) invalid();
  const body = readStoryModelResponse(calls[0].response, failure.stage) as StoryPreparationBody;
  const candidate: StoryPreparation = { ...body, format: "zhuwei.story-preparation/v1", jobId: request.jobId,
    version: failure.stage === "draft" ? "1" : "2", requestHash: checkpoint.requestHash,
    contextHash, recipeRefs: request.recipeRefs };
  const inspection = inspectStoryPreparation(candidate, request, context, hash);
  if (inspection.kind !== "invalid" || inspection.code !== checkpoint.failureCode
    || hash(candidate) !== failure.candidateHash || hash(inspection.findings) !== hash(failure.findings)) invalid();
}
