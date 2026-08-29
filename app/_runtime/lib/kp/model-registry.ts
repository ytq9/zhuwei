import { stableStructuralHash } from "./causal-action-program";
import { assertAllowedFormSet, type KpFormId } from "./form-catalog";

export const MODEL_ROLES = Object.freeze([
  "primary-kp",
  "context-planner",
  "narration",
  "chunk-reranker",
] as const);

export type ModelRole = (typeof MODEL_ROLES)[number];
export type StructuredOutputMode = "strict-tool" | "strict-json-schema" | "none";
export type ModelLatencyTier = "local" | "low" | "standard" | "high";
export type ModelCostTier = "free" | "low" | "standard" | "high";

export type ModelProfileRegistration = Readonly<{
  profileRef: string;
  provider: string;
  modelId: string;
  modelRevision: string;
  supportedRoles: readonly ModelRole[];
  validationSuiteVersion: string;
  validationStatus: "passed" | "pending" | "failed";
  structuredOutputMode: StructuredOutputMode;
  contextWindowTokens: number;
  latencyTier: ModelLatencyTier;
  costTier: ModelCostTier;
}>;

export type ModelProfileRegistry = Readonly<{
  registryVersion: "kp-model-profile-registry-v1";
  registryHash: string;
  profiles: Readonly<Record<string, ModelProfileRegistration>>;
}>;

export function createModelProfileRegistry(
  profiles: readonly ModelProfileRegistration[],
): ModelProfileRegistry {
  const byRef: Record<string, ModelProfileRegistration> = {};
  for (const profile of profiles) {
    validateModelProfile(profile);
    if (byRef[profile.profileRef] !== undefined) throw new Error("MODEL_PROFILE_DUPLICATE");
    byRef[profile.profileRef] = Object.freeze({
      ...profile,
      supportedRoles: Object.freeze([...new Set(profile.supportedRoles)].sort()),
    });
  }
  const frozenProfiles: Record<string, ModelProfileRegistration> = {};
  for (const profileRef of Object.keys(byRef).sort()) frozenProfiles[profileRef] = byRef[profileRef]!;
  const registrySource = {
    registryVersion: "kp-model-profile-registry-v1" as const,
    profiles: Object.freeze(frozenProfiles),
  };
  return Object.freeze({ ...registrySource, registryHash: stableStructuralHash(registrySource) });
}

export function validatedProfilesForRole(
  registry: ModelProfileRegistry,
  role: ModelRole,
): readonly ModelProfileRegistration[] {
  return Object.freeze(Object.values(registry.profiles)
    .filter((profile) => profile.validationStatus === "passed" && profile.supportedRoles.includes(role))
    .sort((left, right) => left.profileRef.localeCompare(right.profileRef)));
}

export function requireValidatedModelProfile(
  registry: ModelProfileRegistry,
  profileRef: string,
  role: ModelRole,
): ModelProfileRegistration {
  const profile = registry.profiles[profileRef];
  if (profile === undefined) throw new Error("MODEL_PROFILE_UNKNOWN");
  if (!profile.supportedRoles.includes(role)) throw new Error("MODEL_PROFILE_ROLE_FORBIDDEN");
  if (profile.validationStatus !== "passed") throw new Error("MODEL_PROFILE_NOT_VALIDATED");
  return profile;
}

function validateModelProfile(profile: ModelProfileRegistration): void {
  for (const value of [
    profile.profileRef,
    profile.provider,
    profile.modelId,
    profile.modelRevision,
    profile.validationSuiteVersion,
  ]) {
    if (value.trim().length === 0) throw new Error("MODEL_PROFILE_FIELD_REQUIRED");
  }
  if (profile.supportedRoles.length === 0 || profile.supportedRoles.some((role) => !MODEL_ROLES.includes(role))) {
    throw new Error("MODEL_PROFILE_ROLE_INVALID");
  }
  if (!Number.isInteger(profile.contextWindowTokens) || profile.contextWindowTokens <= 0) {
    throw new Error("MODEL_PROFILE_CONTEXT_INVALID");
  }
}

export type ContextPlannerInput = Readonly<{
  rootActionRef: string;
  allowedFormIds: readonly KpFormId[];
  structuralRefs: readonly string[];
  baseQueryTerms: readonly string[];
}>;

/** The exact Planner output surface: ranking plus static query suggestions. */
export type ContextPlannerSuggestion = Readonly<{
  orderedFormIds: readonly KpFormId[];
  queryTerms: readonly string[];
}>;

export interface ContextPlannerAdapter {
  readonly mode: "disabled" | "deterministic" | "model";
  readonly profileRef: string | null;
  plan(input: ContextPlannerInput): ContextPlannerSuggestion | Promise<ContextPlannerSuggestion>;
}

export function createDisabledPlannerAdapter(): ContextPlannerAdapter {
  return Object.freeze({
    mode: "disabled" as const,
    profileRef: null,
    plan: deterministicSuggestion,
  });
}

export function createDeterministicPlannerAdapter(): ContextPlannerAdapter {
  return Object.freeze({
    mode: "deterministic" as const,
    profileRef: "context-planner-deterministic-v1",
    plan: deterministicSuggestion,
  });
}

export type ModelPlannerInvoke = (
  input: ContextPlannerInput,
  profile: ModelProfileRegistration,
) => ContextPlannerSuggestion | Promise<ContextPlannerSuggestion>;

export function createModelPlannerAdapter(input: Readonly<{
  registry: ModelProfileRegistry;
  profileRef: string;
  invoke: ModelPlannerInvoke;
}>): ContextPlannerAdapter {
  const profile = requireValidatedModelProfile(input.registry, input.profileRef, "context-planner");
  return Object.freeze({
    mode: "model" as const,
    profileRef: profile.profileRef,
    plan(plannerInput: ContextPlannerInput): ContextPlannerSuggestion | Promise<ContextPlannerSuggestion> {
      return input.invoke(plannerInput, profile);
    },
  });
}

export type ContextPlannerReceipt = Readonly<{
  adapterMode: ContextPlannerAdapter["mode"];
  plannerProfileRef: string | null;
  status: "disabled" | "suggested" | "fallback";
  fallbackUsed: boolean;
  failureCode: "PLANNER_FAILED" | "PLANNER_OUTPUT_INVALID" | null;
  suggestionHash: string;
}>;

export type ContextPlannerRunResult = Readonly<{
  pinnedPrimaryKpProfileRef: string;
  suggestion: ContextPlannerSuggestion;
  receipt: ContextPlannerReceipt;
}>;

/**
 * Planner failure can only fall back to deterministic ranking/query terms. The
 * pinned primary KP binding is carried through byte-for-byte and never looked
 * up as a fallback candidate.
 */
export async function runContextPlanner(input: Readonly<{
  registry: ModelProfileRegistry;
  pinnedPrimaryKpProfileRef: string;
  adapter: ContextPlannerAdapter;
  plannerInput: ContextPlannerInput;
  deterministicFallback?: ContextPlannerAdapter;
}>): Promise<ContextPlannerRunResult> {
  requireValidatedModelProfile(input.registry, input.pinnedPrimaryKpProfileRef, "primary-kp");
  validatePlannerInput(input.plannerInput);
  const fallback = input.deterministicFallback ?? createDeterministicPlannerAdapter();
  if (fallback.mode !== "deterministic") throw new Error("PLANNER_FALLBACK_MUST_BE_DETERMINISTIC");

  try {
    const suggestion = await input.adapter.plan(input.plannerInput);
    const outputErrors = validatePlannerSuggestion(suggestion, input.plannerInput.allowedFormIds);
    if (outputErrors.length > 0) {
      return plannerFallback(input, fallback, "PLANNER_OUTPUT_INVALID");
    }
    const frozen = freezeSuggestion(suggestion);
    return Object.freeze({
      pinnedPrimaryKpProfileRef: input.pinnedPrimaryKpProfileRef,
      suggestion: frozen,
      receipt: Object.freeze({
        adapterMode: input.adapter.mode,
        plannerProfileRef: input.adapter.profileRef,
        status: input.adapter.mode === "disabled" ? "disabled" : "suggested",
        fallbackUsed: false,
        failureCode: null,
        suggestionHash: stableStructuralHash(frozen),
      }),
    });
  } catch {
    return plannerFallback(input, fallback, "PLANNER_FAILED");
  }
}

async function plannerFallback(
  input: Readonly<{
    pinnedPrimaryKpProfileRef: string;
    adapter: ContextPlannerAdapter;
    plannerInput: ContextPlannerInput;
  }>,
  fallback: ContextPlannerAdapter,
  failureCode: "PLANNER_FAILED" | "PLANNER_OUTPUT_INVALID",
): Promise<ContextPlannerRunResult> {
  const suggestion = freezeSuggestion(await fallback.plan(input.plannerInput));
  const errors = validatePlannerSuggestion(suggestion, input.plannerInput.allowedFormIds);
  if (errors.length > 0) throw new Error("PLANNER_DETERMINISTIC_FALLBACK_INVALID");
  return Object.freeze({
    pinnedPrimaryKpProfileRef: input.pinnedPrimaryKpProfileRef,
    suggestion,
    receipt: Object.freeze({
      adapterMode: input.adapter.mode,
      plannerProfileRef: input.adapter.profileRef,
      status: "fallback",
      fallbackUsed: true,
      failureCode,
      suggestionHash: stableStructuralHash(suggestion),
    }),
  });
}

function deterministicSuggestion(input: ContextPlannerInput): ContextPlannerSuggestion {
  const ordered = [...input.allowedFormIds].sort((left, right) => {
    if (left === "compound.v1") return 1;
    if (right === "compound.v1") return -1;
    return left.localeCompare(right);
  });
  return Object.freeze({
    orderedFormIds: Object.freeze(ordered),
    queryTerms: Object.freeze(uniqueNormalizedTerms([...input.baseQueryTerms, ...input.structuralRefs])),
  });
}

function validatePlannerInput(input: ContextPlannerInput): void {
  if (input.rootActionRef.trim().length === 0) throw new Error("PLANNER_ROOT_ACTION_REQUIRED");
  assertAllowedFormSet(input.allowedFormIds);
  if (input.baseQueryTerms.length > 12) throw new Error("PLANNER_QUERY_LIMIT_EXCEEDED");
}

export function validatePlannerSuggestion(
  suggestion: unknown,
  allowedFormIds: readonly KpFormId[],
): readonly string[] {
  const errors: string[] = [];
  if (!isPlainRecord(suggestion)) return Object.freeze(["suggestion:object-required"]);
  for (const key of Object.keys(suggestion)) {
    if (key !== "orderedFormIds" && key !== "queryTerms") errors.push(`${key}:forbidden`);
  }
  if (!Array.isArray(suggestion.orderedFormIds)) errors.push("orderedFormIds:array-required");
  else {
    const order = suggestion.orderedFormIds;
    if (order.length !== allowedFormIds.length || new Set(order).size !== order.length
      || order.some((formId) => typeof formId !== "string" || !allowedFormIds.includes(formId as KpFormId))) {
      errors.push("orderedFormIds:not-exact-permutation");
    }
    if (!order.includes("compound.v1")) errors.push("orderedFormIds:compound-required");
  }
  if (!Array.isArray(suggestion.queryTerms)
    || suggestion.queryTerms.length > 12
    || suggestion.queryTerms.some((term) => typeof term !== "string" || term.trim().length === 0 || term.length > 120)) {
    errors.push("queryTerms:invalid");
  }
  return Object.freeze([...new Set(errors)].sort());
}

function freezeSuggestion(suggestion: ContextPlannerSuggestion): ContextPlannerSuggestion {
  return Object.freeze({
    orderedFormIds: Object.freeze([...suggestion.orderedFormIds]),
    queryTerms: Object.freeze(uniqueNormalizedTerms(suggestion.queryTerms)),
  });
}

function uniqueNormalizedTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((term) => term.normalize("NFKC").trim().toLowerCase()).filter(Boolean))]
    .sort()
    .slice(0, 12);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
