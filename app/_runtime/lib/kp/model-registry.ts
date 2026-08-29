import { stableStructuralHash } from "./causal-action-program";
import {
  CONTEXT_PLANNER_DEFAULT_TIMEOUT_MS,
  CONTEXT_PLANNER_MAX_QUERY_TERMS,
  CONTEXT_PLANNER_MAX_STRUCTURAL_REFS,
  CONTEXT_PLANNER_MAX_TIMEOUT_MS,
  CONTEXT_PLANNER_POLICY_HASH,
  CONTEXT_PLANNER_POLICY_VERSION,
  CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
  CONTEXT_PLANNER_SCHEMA_HASH,
  CONTEXT_PLANNER_SCHEMA_VERSION,
  ContextPlannerPolicyError,
  classifyContextPlannerProviderError,
  contextPlannerModelRequest,
  parseContextPlannerModelResponse,
  type ContextPlannerModelRequest,
} from "./context-planner-policy";
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

export const CONTEXT_PLANNER_VALIDATION_GATES = Object.freeze([
  "chinese",
  "structuredOutput",
  "capabilityAllowlist",
  "secretCanary",
  "latency",
  "errorClassification",
  "faultInjection",
] as const);

export type ContextPlannerValidationGate =
  (typeof CONTEXT_PLANNER_VALIDATION_GATES)[number];

export type ContextPlannerRoleValidationEvidence = Readonly<{
  evidenceVersion: "kp-context-planner-role-evidence-v1";
  executionMode: "live-provider" | "offline-fixture";
  suiteVersion: typeof CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION;
  profileBindingHash: string;
  policyVersion: typeof CONTEXT_PLANNER_POLICY_VERSION;
  policyHash: string;
  schemaVersion: typeof CONTEXT_PLANNER_SCHEMA_VERSION;
  schemaHash: string;
  validatedAt: string;
  caseCount: number;
  liveProviderCalls: number;
  latencyMs: Readonly<{
    p50: number;
    p95: number;
    budget: number;
  }>;
  gates: Readonly<Record<ContextPlannerValidationGate, boolean>>;
  evidenceHash: string;
}>;

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
  roleValidation?: ContextPlannerRoleValidationEvidence;
  profileHash?: string;
}>;

export type ModelProfileRegistry = Readonly<{
  registryVersion: "kp-model-profile-registry-v1";
  registryHash: string;
  profiles: Readonly<Record<string, ModelProfileRegistration>>;
}>;

/**
 * A candidate registration is intentionally pending. A live role-validation
 * receipt and a passing G3 gain gate are both required before product wiring.
 */
export const DEEPSEEK_V4_FLASH_CONTEXT_PLANNER_CANDIDATE = Object.freeze({
  profileRef: "context-planner:deepseek-v4-flash:v1",
  provider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelRevision: "deepseek-v4-flash-0731",
  supportedRoles: Object.freeze(["context-planner"] as const),
  validationSuiteVersion: CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
  validationStatus: "pending" as const,
  structuredOutputMode: "strict-tool" as const,
  contextWindowTokens: 32_000,
  latencyTier: "low" as const,
  costTier: "low" as const,
}) satisfies ModelProfileRegistration;

type PlannerProfileBinding = Pick<
  ModelProfileRegistration,
  | "profileRef"
  | "provider"
  | "modelId"
  | "modelRevision"
  | "supportedRoles"
  | "validationSuiteVersion"
  | "structuredOutputMode"
>;

export function contextPlannerProfileBindingHash(
  profile: PlannerProfileBinding,
): string {
  return stableStructuralHash({
    profileRef: profile.profileRef,
    provider: profile.provider,
    modelId: profile.modelId,
    modelRevision: profile.modelRevision,
    supportedRoles: [...new Set(profile.supportedRoles)].sort(),
    validationSuiteVersion: profile.validationSuiteVersion,
    structuredOutputMode: profile.structuredOutputMode,
    policyVersion: CONTEXT_PLANNER_POLICY_VERSION,
    policyHash: CONTEXT_PLANNER_POLICY_HASH,
    schemaVersion: CONTEXT_PLANNER_SCHEMA_VERSION,
    schemaHash: CONTEXT_PLANNER_SCHEMA_HASH,
  });
}

export function createContextPlannerRoleValidationEvidence(input: Readonly<{
  profile: PlannerProfileBinding;
  executionMode: ContextPlannerRoleValidationEvidence["executionMode"];
  validatedAt: string;
  caseCount: number;
  liveProviderCalls: number;
  latencyMs: ContextPlannerRoleValidationEvidence["latencyMs"];
  gates: ContextPlannerRoleValidationEvidence["gates"];
}>): ContextPlannerRoleValidationEvidence {
  const source = {
    evidenceVersion: "kp-context-planner-role-evidence-v1" as const,
    executionMode: input.executionMode,
    suiteVersion: CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
    profileBindingHash: contextPlannerProfileBindingHash(input.profile),
    policyVersion: CONTEXT_PLANNER_POLICY_VERSION,
    policyHash: CONTEXT_PLANNER_POLICY_HASH,
    schemaVersion: CONTEXT_PLANNER_SCHEMA_VERSION,
    schemaHash: CONTEXT_PLANNER_SCHEMA_HASH,
    validatedAt: input.validatedAt,
    caseCount: input.caseCount,
    liveProviderCalls: input.liveProviderCalls,
    latencyMs: Object.freeze({ ...input.latencyMs }),
    gates: Object.freeze({ ...input.gates }),
  };
  return Object.freeze({
    ...source,
    evidenceHash: stableStructuralHash(source),
  });
}

export function createModelProfileRegistry(
  profiles: readonly ModelProfileRegistration[],
): ModelProfileRegistry {
  const byRef: Record<string, ModelProfileRegistration> = {};
  for (const profile of profiles) {
    validateModelProfile(profile);
    if (byRef[profile.profileRef] !== undefined) throw new Error("MODEL_PROFILE_DUPLICATE");
    const registeredSource = {
      ...profile,
      supportedRoles: Object.freeze([...new Set(profile.supportedRoles)].sort()),
      ...(profile.roleValidation === undefined
        ? {}
        : {
            roleValidation: Object.freeze({
              ...profile.roleValidation,
              latencyMs: Object.freeze({ ...profile.roleValidation.latencyMs }),
              gates: Object.freeze({ ...profile.roleValidation.gates }),
            }),
          }),
    };
    delete registeredSource.profileHash;
    byRef[profile.profileRef] = Object.freeze({
      ...registeredSource,
      profileHash: stableStructuralHash(registeredSource),
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
    .filter((profile) => modelProfilePassesRoleValidation(profile, role))
    .sort((left, right) => left.profileRef.localeCompare(right.profileRef)));
}

/** Only this subset may be surfaced as a model-backed Planner UI choice. */
export function productionSelectableProfilesForRole(
  registry: ModelProfileRegistry,
  role: ModelRole,
): readonly ModelProfileRegistration[] {
  return Object.freeze(validatedProfilesForRole(registry, role).filter((profile) =>
    role !== "context-planner"
    || profile.roleValidation?.executionMode === "live-provider"));
}

export function requireValidatedModelProfile(
  registry: ModelProfileRegistry,
  profileRef: string,
  role: ModelRole,
): ModelProfileRegistration {
  const profile = registry.profiles[profileRef];
  if (profile === undefined) throw new Error("MODEL_PROFILE_UNKNOWN");
  if (!profile.supportedRoles.includes(role)) throw new Error("MODEL_PROFILE_ROLE_FORBIDDEN");
  if (!modelProfilePassesRoleValidation(profile, role)) {
    throw new Error("MODEL_PROFILE_NOT_VALIDATED");
  }
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
  if (profile.profileHash !== undefined) throw new Error("MODEL_PROFILE_HASH_SERVER_DERIVED");
  if (profile.roleValidation !== undefined
    && !contextPlannerEvidenceIsBound(profile, profile.roleValidation)) {
    throw new Error("MODEL_PROFILE_VALIDATION_EVIDENCE_INVALID");
  }
  if (profile.validationStatus === "passed"
    && profile.supportedRoles.includes("context-planner")
    && !contextPlannerEvidencePasses(profile, profile.roleValidation)) {
    throw new Error("MODEL_PROFILE_VALIDATION_EVIDENCE_REQUIRED");
  }
}

function modelProfilePassesRoleValidation(
  profile: ModelProfileRegistration,
  role: ModelRole,
): boolean {
  if (profile.validationStatus !== "passed" || !profile.supportedRoles.includes(role)) {
    return false;
  }
  return role !== "context-planner"
    || contextPlannerEvidencePasses(profile, profile.roleValidation);
}

function contextPlannerEvidencePasses(
  profile: ModelProfileRegistration,
  evidence: ContextPlannerRoleValidationEvidence | undefined,
): boolean {
  if (evidence === undefined || !contextPlannerEvidenceIsBound(profile, evidence)) return false;
  if (!CONTEXT_PLANNER_VALIDATION_GATES.every((gate) => evidence.gates[gate] === true)) {
    return false;
  }
  if (!Number.isInteger(evidence.caseCount) || evidence.caseCount < 5) return false;
  if (evidence.executionMode === "live-provider") {
    if (!Number.isInteger(evidence.liveProviderCalls) || evidence.liveProviderCalls < 5) return false;
  } else if (evidence.liveProviderCalls !== 0 || !/^(offline|test)(?:$|[-:])/u.test(profile.provider)) {
    return false;
  }
  return Number.isFinite(evidence.latencyMs.p50)
    && Number.isFinite(evidence.latencyMs.p95)
    && Number.isFinite(evidence.latencyMs.budget)
    && evidence.latencyMs.p50 >= 0
    && evidence.latencyMs.p95 >= evidence.latencyMs.p50
    && evidence.latencyMs.budget > 0
    && evidence.latencyMs.budget <= CONTEXT_PLANNER_MAX_TIMEOUT_MS
    && evidence.latencyMs.p95 <= evidence.latencyMs.budget;
}

function contextPlannerEvidenceIsBound(
  profile: ModelProfileRegistration,
  evidence: ContextPlannerRoleValidationEvidence,
): boolean {
  const source = {
    evidenceVersion: evidence.evidenceVersion,
    executionMode: evidence.executionMode,
    suiteVersion: evidence.suiteVersion,
    profileBindingHash: evidence.profileBindingHash,
    policyVersion: evidence.policyVersion,
    policyHash: evidence.policyHash,
    schemaVersion: evidence.schemaVersion,
    schemaHash: evidence.schemaHash,
    validatedAt: evidence.validatedAt,
    caseCount: evidence.caseCount,
    liveProviderCalls: evidence.liveProviderCalls,
    latencyMs: evidence.latencyMs,
    gates: evidence.gates,
  };
  return evidence.evidenceVersion === "kp-context-planner-role-evidence-v1"
    && evidence.suiteVersion === CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION
    && profile.validationSuiteVersion === evidence.suiteVersion
    && evidence.profileBindingHash === contextPlannerProfileBindingHash(profile)
    && evidence.policyVersion === CONTEXT_PLANNER_POLICY_VERSION
    && evidence.policyHash === CONTEXT_PLANNER_POLICY_HASH
    && evidence.schemaVersion === CONTEXT_PLANNER_SCHEMA_VERSION
    && evidence.schemaHash === CONTEXT_PLANNER_SCHEMA_HASH
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(evidence.validatedAt)
    && CONTEXT_PLANNER_VALIDATION_GATES.every((gate) =>
      typeof evidence.gates[gate] === "boolean")
    && Object.keys(evidence.gates).length === CONTEXT_PLANNER_VALIDATION_GATES.length
    && evidence.evidenceHash === stableStructuralHash(source);
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

export const DETERMINISTIC_CONTEXT_PLANNER_PROFILE_REF =
  "context-planner-deterministic-v1" as const;
export const DISABLED_CONTEXT_PLANNER_PROFILE_REF =
  "context-planner-disabled-v1" as const;

export function createDisabledPlannerAdapter(): ContextPlannerAdapter {
  return Object.freeze({
    mode: "disabled" as const,
    profileRef: DISABLED_CONTEXT_PLANNER_PROFILE_REF,
    plan(input: ContextPlannerInput): ContextPlannerSuggestion {
      return Object.freeze({
        orderedFormIds: Object.freeze([...input.allowedFormIds]),
        queryTerms: Object.freeze([]),
      });
    },
  });
}

export function createDeterministicPlannerAdapter(): ContextPlannerAdapter {
  return Object.freeze({
    mode: "deterministic" as const,
    profileRef: DETERMINISTIC_CONTEXT_PLANNER_PROFILE_REF,
    plan: deterministicSuggestion,
  });
}

export type ModelPlannerInvoke = (
  request: ContextPlannerModelRequest,
  profile: ModelProfileRegistration,
  options: Readonly<{ signal: AbortSignal }>,
) => unknown | Promise<unknown>;

export function createModelPlannerAdapter(input: Readonly<{
  registry: ModelProfileRegistry;
  profileRef: string;
  invoke: ModelPlannerInvoke;
  timeoutMs?: number;
}>): ContextPlannerAdapter {
  const profile = requireValidatedModelProfile(input.registry, input.profileRef, "context-planner");
  const timeoutMs = input.timeoutMs ?? CONTEXT_PLANNER_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > CONTEXT_PLANNER_MAX_TIMEOUT_MS) {
    throw new Error("PLANNER_TIMEOUT_INVALID");
  }
  return Object.freeze({
    mode: "model" as const,
    profileRef: profile.profileRef,
    async plan(plannerInput: ContextPlannerInput): Promise<ContextPlannerSuggestion> {
      const request = contextPlannerModelRequest(plannerInput);
      const abortController = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            abortController.abort();
            reject(new ContextPlannerPolicyError("CONTEXT_PLANNER_TIMEOUT"));
          }, timeoutMs);
        });
        const response = await Promise.race([
          input.invoke(request, profile, { signal: abortController.signal }),
          timeout,
        ]);
        return parseContextPlannerModelResponse(response, plannerInput.allowedFormIds);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  });
}

export type ContextPlannerReceipt = Readonly<{
  adapterMode: ContextPlannerAdapter["mode"];
  plannerProfileRef: string | null;
  status: "disabled" | "suggested" | "fallback";
  fallbackUsed: boolean;
  failureCode:
    | "PLANNER_FAILED"
    | "PLANNER_TIMEOUT"
    | "PLANNER_OUTPUT_INVALID"
    | null;
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
  if (input.adapter.mode === "model") {
    if (input.adapter.profileRef === null) throw new Error("PLANNER_PROFILE_REQUIRED");
    requireValidatedModelProfile(input.registry, input.adapter.profileRef, "context-planner");
  }
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
  } catch (error) {
    const failureCode = error instanceof ContextPlannerPolicyError
      && error.code === "CONTEXT_PLANNER_OUTPUT_INVALID"
      ? "PLANNER_OUTPUT_INVALID"
      : classifyContextPlannerProviderError(error) === "timeout"
        ? "PLANNER_TIMEOUT"
        : "PLANNER_FAILED";
    return plannerFallback(input, fallback, failureCode);
  }
}

async function plannerFallback(
  input: Readonly<{
    pinnedPrimaryKpProfileRef: string;
    adapter: ContextPlannerAdapter;
    plannerInput: ContextPlannerInput;
  }>,
  fallback: ContextPlannerAdapter,
  failureCode: Exclude<ContextPlannerReceipt["failureCode"], null>,
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
  if (input.structuralRefs.length > CONTEXT_PLANNER_MAX_STRUCTURAL_REFS) {
    throw new Error("PLANNER_STRUCTURAL_REF_LIMIT_EXCEEDED");
  }
  if (input.baseQueryTerms.length > CONTEXT_PLANNER_MAX_QUERY_TERMS) {
    throw new Error("PLANNER_QUERY_LIMIT_EXCEEDED");
  }
  if (input.structuralRefs.some((reference) => !boundedPlannerString(reference, 160))) {
    throw new Error("PLANNER_STRUCTURAL_REF_INVALID");
  }
  if (input.baseQueryTerms.some((term) => !boundedPlannerString(term, 120))) {
    throw new Error("PLANNER_QUERY_INVALID");
  }
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
    || suggestion.queryTerms.length > CONTEXT_PLANNER_MAX_QUERY_TERMS
    || new Set(suggestion.queryTerms).size !== suggestion.queryTerms.length
    || suggestion.queryTerms.some((term) => !boundedPlannerString(term, 120))) {
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

function boundedPlannerString(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
