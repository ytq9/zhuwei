import type { StoryCheckpoint, StoryContext, StoryCreationPorts, StoryFailureCode, StoryPreparation,
  StoryPreparationResult, StoryRequest, StoryReview, StoryStage } from "./contracts";
import { isRecord, readStoryModelResponse, storyModelRequest, STORY_CREATION_WORKFLOW_REF,
  type StoryPreparationBody, type StoryReviewBody } from "./prompt";
import { selectStoryRecipes } from "./recipes";
import { inspectStoryPreparation, storyCapabilityDescription, storyReviewAllowsRevision, storyReviewPassed, validateStoryReview,
  STORY_REVIEW_CATEGORIES } from "./review";

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length;
const hashRef = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const versionRef = (value: unknown) => isRecord(value) && Object.keys(value).sort().join() === "hash,id,version"
  && nonempty(value.id) && nonempty(value.version) && hashRef(value.hash);
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** One request identity and one host-owned durable call ledger span every
 * resume. No clocks, model retries, world writes or per-plugin budget exist
 * here. A successful stage is CAS-saved before requesting the next one. */
export async function prepareStory(rawRequest: StoryRequest, rawContext: StoryContext,
  rawCheckpoint: StoryCheckpoint | null, ports: StoryCreationPorts): Promise<StoryPreparationResult> {
  let request: StoryRequest, context: StoryContext, checkpoint: StoryCheckpoint | null;
  try {
    request = frozen(structuredClone(rawRequest)); context = frozen(structuredClone(rawContext));
    checkpoint = rawCheckpoint === null ? null : frozen(structuredClone(rawCheckpoint));
    if (!validRequest(request) || !validContext(context, ports)) return { kind: "rejected", code: "STORY_CONTEXT_INSUFFICIENT", checkpoint: null };
  } catch { return { kind: "rejected", code: "STORY_CONTEXT_INSUFFICIENT", checkpoint: null }; }
  const requestHash = ports.hash(request);
  const outcome = (kind: "waiting" | "rejected", code: StoryFailureCode): StoryPreparationResult => ({ kind, code, checkpoint });
  if (checkpoint !== null) {
    if (checkpoint.format !== "zhuwei.story-checkpoint/v1" || checkpoint.jobId !== request.jobId
      || checkpoint.requestHash !== requestHash || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1) {
      return outcome("rejected", "STORY_CHECKPOINT_CONFLICT");
    }
    if (checkpoint.contextHash !== context.contextHash) return outcome("waiting", "STORY_CONTEXT_STALE");
    try { validateCheckpoint(checkpoint, request, context, ports); } catch { return outcome("rejected", "STORY_CHECKPOINT_CONFLICT"); }
    if (checkpoint.status === "ready") return ready(checkpoint);
    if (checkpoint.status === "noStory") return { kind: "noStory", checkpoint };
    if (checkpoint.status === "rejected") return outcome("rejected", checkpoint.failureCode!);
  }
  if (request.trigger.kind === "ordinaryResponse") {
    if (!await save({ status: "noStory" })) return outcome("waiting", "STORY_CHECKPOINT_CONFLICT");
    return { kind: "noStory", checkpoint: checkpoint! };
  }
  if (ports.hash(request.workflowRef) !== ports.hash(STORY_CREATION_WORKFLOW_REF)) return outcome("rejected", "STORY_CAPABILITY_UNSUPPORTED");
  const selection = selectStoryRecipes(request, ports);
  if (selection.kind === "rejected") return outcome("rejected", selection.code);
  const recipes = frozen(structuredClone(selection.recipes));
  const materialRefs = new Map(context.materials.map(material => [material.ref, material]));
  const requiredKinds = new Set(["anchor", "contentBoundary", ...recipes.flatMap(recipe => recipe.requiredMaterialKinds)]);
  const requiredRefs = [...request.trigger.basisRefs, ...request.scope.sceneIds, ...request.scope.entityIds];
  if (context.missingRequiredRefs.length > 0
    || requiredRefs.some(ref => !materialRefs.has(ref) || ["unavailable", "ambiguous"].includes(materialRefs.get(ref)!.availability))
    || [...requiredKinds].some(kind => !context.materials.some(material => material.kind === kind && ["known", "open"].includes(material.availability)))) {
    return outcome("waiting", "STORY_CONTEXT_INSUFFICIENT");
  }
  const capabilities = recipes.flatMap(recipe => recipe.requiredCapabilities);
  if (capabilities.some(capability => !context.supportedCapabilities.includes(capability)
    || context.materials.filter(material => storyCapabilityDescription(material)?.capability === capability).length !== 1)) {
    return outcome("rejected", "STORY_CAPABILITY_UNSUPPORTED");
  }
  if (checkpoint === null && !await save({ status: "preparing" })) return outcome("waiting", "STORY_CHECKPOINT_CONFLICT");

  // Four semantic stages, each spent at most once by the durable host. On a
  // waiting/unknown result we stop immediately; only that same saved stage can
  // be queried on resume. Transport uncertainty never requests a new sample.
  for (let transition = 0; transition < 4; transition += 1) {
    const current = checkpoint!;
    let stage: StoryStage;
    if (!current.draft) stage = "draft";
    else if (!current.review) stage = "review";
    else if (!current.revisedDraft) stage = "revision";
    else stage = "revisionReview";
    const candidate = current.revisedDraft ?? current.draft;
    let invocation;
    try {
      invocation = await ports.invoke(frozen(storyModelRequest({ request, context, requestHash, stage, recipes,
        ...(candidate === undefined ? {} : { preparation: candidate }),
        ...(stage === "revision" ? { review: current.review } : {}),
      })));
    } catch { return outcome("waiting", "STORY_INVOCATION_UNKNOWN"); }
    if (invocation.kind === "waiting") return outcome("waiting", invocation.code);
    if (invocation.kind === "rejected") return reject(invocation.code);
    if (invocation.kind !== "completed") return outcome("waiting", "STORY_INVOCATION_UNKNOWN");
    let body: StoryPreparationBody | StoryReviewBody;
    try { body = readStoryModelResponse(invocation.response, stage); } catch { return reject("STORY_OUTPUT_INVALID"); }
    if (stage === "draft" || stage === "revision") {
      const preparation = frozen({ ...(body as StoryPreparationBody), format: "zhuwei.story-preparation/v1" as const,
        jobId: request.jobId, version: stage === "draft" ? "1" as const : "2" as const,
        requestHash, contextHash: context.contextHash, recipeRefs: request.recipeRefs });
      const inspection = inspectStoryPreparation(preparation, request, context, ports.hash);
      if (inspection.kind === "invalid") return reject(inspection.code, { inspectionFailure: {
        stage, candidateHash: ports.hash(preparation), findings: inspection.findings,
      } });
      if (!await save(stage === "draft" ? { draft: preparation } : { revisedDraft: preparation })) return outcome("waiting", "STORY_CHECKPOINT_CONFLICT");
      continue;
    }
    const review = frozen({ ...(body as StoryReviewBody), format: "zhuwei.story-review/v1" as const,
      preparationHash: ports.hash(candidate!), contextHash: context.contextHash });
    try { validateStoryReview(review, candidate!, context, ports.hash, recipes); } catch { return reject("STORY_OUTPUT_INVALID"); }
    const patch = stage === "review" ? { review } : { revisedReview: review };
    if (storyReviewPassed(review)) {
      if (!await save({ ...patch, status: "ready" })) return outcome("waiting", "STORY_CHECKPOINT_CONFLICT");
      return ready(checkpoint!);
    }
    if (stage === "revisionReview") return reject("STORY_REVISION_EXHAUSTED", patch);
    if (!storyReviewAllowsRevision(review)) return reject("STORY_REVIEW_REJECTED", patch);
    if (!await save(patch)) return outcome("waiting", "STORY_CHECKPOINT_CONFLICT");
  }
  return reject("STORY_REVISION_EXHAUSTED");

  async function save(patch: Partial<StoryCheckpoint>): Promise<boolean> {
    const expectedRevision = checkpoint?.revision ?? 0;
    const next = frozen({ format: "zhuwei.story-checkpoint/v1" as const, jobId: request.jobId,
      requestHash, contextHash: context.contextHash, status: "preparing" as const,
      ...checkpoint, ...patch, revision: expectedRevision + 1 });
    try {
      const saved = await ports.saveCheckpoint(expectedRevision, next);
      if (!saved.ok || ports.hash(saved.checkpoint) !== ports.hash(next)) return false;
      checkpoint = frozen(structuredClone(saved.checkpoint)); return true;
    } catch { return false; }
  }
  async function reject(code: StoryFailureCode, patch: Partial<StoryCheckpoint> = {}): Promise<StoryPreparationResult> {
    if (!await save({ ...patch, status: "rejected", failureCode: code })) return outcome("waiting", "STORY_CHECKPOINT_CONFLICT");
    return outcome("rejected", code);
  }
}

function ready(checkpoint: StoryCheckpoint): StoryPreparationResult {
  return { kind: "ready", preparation: checkpoint.revisedDraft ?? checkpoint.draft!,
    review: checkpoint.revisedReview ?? checkpoint.review!, checkpoint };
}

function validateCheckpoint(checkpoint: StoryCheckpoint, request: StoryRequest, context: StoryContext, ports: StoryCreationPorts): void {
  const invalid = () => { throw new TypeError("STORY_CHECKPOINT_CONFLICT"); };
  if (!["preparing", "ready", "noStory", "rejected"].includes(checkpoint.status)
    || Object.keys(checkpoint).some(key => !["format", "jobId", "revision", "requestHash", "contextHash", "status", "draft", "review", "revisedDraft", "revisedReview", "failureCode", "inspectionFailure"].includes(key))) invalid();
  if (checkpoint.status === "noStory" && (request.trigger.kind !== "ordinaryResponse" || checkpoint.draft || checkpoint.review
    || checkpoint.revisedDraft || checkpoint.revisedReview || checkpoint.failureCode)) invalid();
  if ((checkpoint.status === "rejected") !== (checkpoint.failureCode !== undefined)) invalid();
  if (checkpoint.review && !checkpoint.draft || checkpoint.revisedDraft && !checkpoint.review
    || checkpoint.revisedReview && !checkpoint.revisedDraft) invalid();
  for (const [candidate, version] of [[checkpoint.draft, "1"], [checkpoint.revisedDraft, "2"]] as const) {
    if (candidate && (candidate.version !== version || inspectStoryPreparation(candidate, request, context, ports.hash).kind !== "valid")) invalid();
  }
  if (checkpoint.review) validateStoryReview(checkpoint.review, checkpoint.draft!, context, ports.hash);
  if (checkpoint.revisedReview) validateStoryReview(checkpoint.revisedReview, checkpoint.revisedDraft!, context, ports.hash);
  if (checkpoint.revisedDraft && (!checkpoint.review || !storyReviewAllowsRevision(checkpoint.review))) invalid();
  if (Object.hasOwn(checkpoint, "inspectionFailure")) {
    const failure = checkpoint.inspectionFailure;
    if (checkpoint.status !== "rejected"
      || !["STORY_OUTPUT_INVALID", "STORY_CHECKPOINT_CONFLICT", "STORY_IDENTITY_CONFLICT", "STORY_CONTEXT_INSUFFICIENT", "STORY_CAPABILITY_UNSUPPORTED"].includes(checkpoint.failureCode!)
      || !isRecord(failure) || Object.keys(failure).sort().join() !== "candidateHash,findings,stage"
      || !hashRef(failure.candidateHash) || !Array.isArray(failure.findings) || failure.findings.length === 0
      || !["draft", "revision"].includes(failure.stage)) invalid();
    if (failure!.stage === "draft"
      ? checkpoint.draft !== undefined || checkpoint.review !== undefined || checkpoint.revisedDraft !== undefined || checkpoint.revisedReview !== undefined
      : !checkpoint.draft || !checkpoint.review || storyReviewPassed(checkpoint.review) || !storyReviewAllowsRevision(checkpoint.review)
        || checkpoint.revisedDraft !== undefined || checkpoint.revisedReview !== undefined) invalid();
    for (const finding of failure!.findings) {
      if (!isRecord(finding) || Object.keys(finding).sort().join() !== "candidatePaths,category,constraintRefs,explanation,repairable,verdict"
        || !STORY_REVIEW_CATEGORIES.includes(finding.category) || finding.verdict !== "conflict" || finding.repairable !== false
        || !nonempty(finding.explanation) || !Array.isArray(finding.candidatePaths) || finding.candidatePaths.length === 0
        || finding.candidatePaths.some(path => !nonempty(path) || !path.startsWith("/") || /~(?:[^01]|$)/u.test(path))
        || !Array.isArray(finding.constraintRefs) || finding.constraintRefs.some(ref => !nonempty(ref))) invalid();
    }
  }
  const final = checkpoint.revisedReview ?? checkpoint.review;
  if (checkpoint.status === "ready" && (!final || !storyReviewPassed(final))) invalid();
  if (checkpoint.status === "preparing" && final && (storyReviewPassed(final)
    || checkpoint.revisedReview || !storyReviewAllowsRevision(final))) invalid();
}

function validRequest(request: StoryRequest): boolean {
  const source: unknown = request?.source;
  return isRecord(request) && request.format === "zhuwei.story-request/v1"
    && nonempty(request.jobId) && nonempty(request.opportunityId) && isRecord(source)
    && ["roomId", "runtimeEpochId", "branchId", "sourceId", "budgetAccountId"].every(key => nonempty(source[key]))
    && typeof source.kind === "string" && ["playerAction", "worldEvent"].includes(source.kind) && isRecord(request.trigger)
    && ["developGoal", "causalDevelopment", "continuePreparation", "ordinaryResponse"].includes(request.trigger.kind)
    && nonempty(request.trigger.goal) && strings(request.trigger.basisRefs)
    && ["vignette", "short", "long"].includes(request.scale) && ["mainStory", "local", "personal"].includes(request.connection)
    && strings(request.methods) && request.methods.length > 0 && isRecord(request.scope)
    && strings(request.scope.sceneIds) && strings(request.scope.entityIds)
    && Array.isArray(request.recipeRefs) && request.recipeRefs.length > 0 && request.recipeRefs.every(versionRef)
    && versionRef(request.workflowRef) && versionRef(request.budgetPolicyRef);
}

function validContext(context: StoryContext, ports: StoryCreationPorts): boolean {
  if (!isRecord(context) || context.format !== "zhuwei.story-context/v1" || !versionRef(context.runtimeRef) || !versionRef(context.moduleRef)
    || !Array.isArray(context.materials) || !Array.isArray(context.readSet) || !Array.isArray(context.timelines)
    || !strings(context.missingRequiredRefs) || !strings(context.supportedCapabilities) || !hashRef(context.contextHash)) return false;
  if (context.materials.some(material => !isRecord(material) || !nonempty(material.ref)
    || typeof material.kind !== "string" || !["anchor", "fact", "npc", "location", "knowledge", "relationship", "plan", "promise", "narrativeCommitment", "definition", "contentBoundary"].includes(material.kind)
    || typeof material.availability !== "string" || !["known", "scopedAbsent", "open", "explicitlyUnknown", "ambiguous", "unavailable"].includes(material.availability)
    || !strings(material.subjectRefs) || !strings(material.basisRefs) || material.content === undefined)
    || new Set(context.materials.map(material => material.ref)).size !== context.materials.length) return false;
  if (context.readSet.some(dependency => !isRecord(dependency) || !nonempty(dependency.ref) || !nonempty(dependency.revision)
    || typeof dependency.kind !== "string" || !["entity", "collection", "fact", "knowledge", "narrativeCommitment", "timeline"].includes(dependency.kind) || !hashRef(dependency.hash))
    || new Set(context.readSet.map(dependency => dependency.ref)).size !== context.readSet.length) return false;
  if (context.timelines.length === 0 || context.timelines.some(point => !isRecord(point) || !nonempty(point.timelineId)
    || typeof point.micros !== "string" || !/^(0|[1-9][0-9]*)$/u.test(point.micros))
    || new Set(context.timelines.map(point => point.timelineId)).size !== context.timelines.length) return false;
  const { contextHash, ...body } = context;
  return ports.hash(body) === contextHash;
}
