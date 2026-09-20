import { TEXT_NARRATION_POLICY } from "./narration-text";
import { narrationCandidate, narrationGenerationInput, narrationReviewInput, narrationReviewDecision, narrationRepairModelInput, NARRATION_PUBLICATION_POLICY } from "./narration-publication";
import { diagnoseFailure, fixedFailureDiagnostic } from "../platform/failure-diagnostics";
import { narrationGroundingPublicFailureCode } from "./public-failure-codes";
import { frozenNarrationContextConform } from "./narration-context";
import { NARRATION_TIMEOUT_MS } from "./timeouts";
import { VNEXT_NARRATION_POLICY, VNEXT_NARRATION_SCHEMA, NARRATION_REVIEW_SCHEMA } from "./narration-vnext";
import {
  AUTHORITATIVE_KP_PROFILE,
  authoritativeKpProfileByBinding,
  isSocialResolutionKpProfile,
  isV3AuthoritativeKpProfile,
  NARRATION_TOOL_NAME,
} from "./authoritative-policy";

import {
  bodyOnlyNarrationGroundingReplacementModelInput,
  bodyOnlyNarrationModelInput,
  validateBodyOnlyNarrationOutput,
} from "./narration-v3";

import {
  ACTOR_PLAN_DECISION_TOOL_NAME,
  actorPlanDecisionModelInput,
  validateActorPlanDecisionOutput,
} from "./actor-plan-policy";

import { NPC_PENDING_DECISION_TOOL_NAME, npcPendingDecisionModelInput, validateNpcPendingDecisionOutput } from "./pending-decision-policy";

import { frozenRenderableClaimsConform } from "../rules/authority-read";

import {
  ModelInvocationTimeoutError,
  ModelOutputValidationError,
  NarrationGroundingValidationError,
  audienceIdentity,
  classifyModelError,
  extractStructuredOutput,
  isRecord,
  responseHash,
  retryAfterFrom,
  usageFrom,
} from "./authoritative-helpers";
import {
  KP_NARRATION_REQUEST_PURPOSES,
} from "./authoritative-types";
import type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  DueActorPlanDecisionRequest,
  FrozenClaimsNarrationRequest,
  KpNarrationRequest,
  KpNarrationRequestPurpose,
  KpProposalRequest,
  KpProposalRequestPurpose,
  ModelInvocationFailureStage,
  ModelInvocationPurpose,
  ModelInvocationReceipt,
  ModelInvocationResult,
} from "./authoritative-types";

export { AUTHORITATIVE_KP_PROFILE } from "./authoritative-policy";
export type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  DueActorPlanDecision,
  DueActorPlanDecisionRequest,
  CurrentNarration,
  KpNarrationRequest,
  KpNarrationRequestPurpose,
  KpProposalRequest,
  KpProposalRequestPurpose,
  ModelInvocationPurpose,
  ModelInvocationReceipt,
  ModelInvocationResult,
  AuthoritativeModelBinding,
} from "./authoritative-types";

const DEFAULT_INVOCATION_TIMEOUT_MS = 45_000;

type InvocationTask = "proposal" | "narration";

const KP_NARRATION_REQUEST_PURPOSE_SET = new Set<string>(KP_NARRATION_REQUEST_PURPOSES);

function isKpNarrationRequestPurpose(value: unknown): value is KpNarrationRequestPurpose {
  return typeof value === "string" && KP_NARRATION_REQUEST_PURPOSE_SET.has(value);
}

function narrationInvocationPurpose(request: KpNarrationRequest): KpNarrationRequestPurpose {
  return isKpNarrationRequestPurpose(request?.narrationPurpose)
    ? request.narrationPurpose
    : "initialNarration";
}

function narrationGroundingRepairPurpose(
  purpose: KpNarrationRequestPurpose,
): ModelInvocationPurpose {
  return purpose === "narrationRecovery"
    ? "narrationRecoveryGroundingRepair"
    : "narrationGroundingRepair";
}

type InvocationSuccess = {
  response: unknown;
  receipt: ModelInvocationReceipt;
};

function stableErrorMessage(code: ModelInvocationResult): string {
  if (code === "modelPermanent") return "权威 KP 模型配置或输出无效。";
  if (code === "quotaExhausted") return "权威 KP 模型额度已用尽。";
  return "权威 KP 模型暂时不可用。";
}

export class AuthoritativeKpModelError extends Error {
  readonly code: Exclude<ModelInvocationResult, "success">;
  readonly modelInvocationReceipt: ModelInvocationReceipt;
  readonly retryAfter?: number;

  constructor(
    code: Exclude<ModelInvocationResult, "success">,
    modelInvocationReceipt: ModelInvocationReceipt,
    retryAfter?: number,
  ) {
    super(stableErrorMessage(code));
    this.name = "AuthoritativeKpModelError";
    this.code = code;
    this.modelInvocationReceipt = modelInvocationReceipt;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      modelInvocationReceipt: this.modelInvocationReceipt,
    };
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModelOutputValidationError();
  }
  return value;
}

function schemaVersion(profile: AuthoritativeKpProfile, task: InvocationTask): string {
  return task === "proposal"
    ? profile.proposalSchemaVersion
    : profile.narrationSchemaVersion;
}

function receipt(
  profile: AuthoritativeKpProfile,
  task: InvocationTask,
  rootActionId: string,
  attempt: number,
  invocationPurpose: ModelInvocationPurpose,
  startedAt: number,
  endedAt: number,
  result: ModelInvocationResult,
  additions: Partial<ModelInvocationReceipt> = {},
): ModelInvocationReceipt {
  return {
    provider: profile.provider,
    modelId: profile.modelId,
    modelRevision: profile.modelRevision,
    modelProfileVersion: profile.modelProfileVersion,
    promptPolicyVersion: profile.promptPolicyVersion,
    schemaVersion: schemaVersion(profile, task),
    task,
    invocationPurpose,
    rootActionId,
    attempt,
    startedAt,
    endedAt,
    result,
    ...additions,
  };
}

function permanentContractError(
  profile: AuthoritativeKpProfile,
  task: InvocationTask,
  rootActionId: string,
  attempt: number,
  invocationPurpose: ModelInvocationPurpose,
  now: () => number,
): AuthoritativeKpModelError {
  const at = now();
  return new AuthoritativeKpModelError(
    "modelPermanent",
    receipt(
      profile,
      task,
      rootActionId,
      attempt,
      invocationPurpose,
      at,
      at,
      "modelPermanent",
      { failureDiagnostic: fixedFailureDiagnostic("requestContractInvalid") },
    ),
  );
}

function unwrapSingleEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(value);
  const only = keys.length === 1 ? value[keys[0]] : undefined;
  return isRecord(only) ? only : value;
}

/**
 * Creates the current KP boundary. It performs model I/O only; it owns no world state,
 * mechanics, randomness, delivery history, or authority to commit a proposal.
 */
export function createAuthoritativeKpAdapter(
  options: AuthoritativeKpAdapterOptions,
): AuthoritativeKpAdapter {
  if (!options?.ai || typeof options.ai.run !== "function") {
    throw new TypeError("A model binding is required for the authoritative KP adapter.");
  }
  const profile = options.profile ?? AUTHORITATIVE_KP_PROFILE;
  const registeredProfile = authoritativeKpProfileByBinding(
    profile.modelId,
    profile.modelProfileVersion,
  );
  if (
    registeredProfile === undefined
    || Object.keys(registeredProfile).length !== Object.keys(profile).length
    || Object.entries(registeredProfile).some(
      ([key, value]) => profile[key as keyof AuthoritativeKpProfile] !== value,
    )
  ) {
    throw new TypeError("A registered authoritative KP model profile is required.");
  }
  const now = options.now ?? Date.now;
  const invocationTimeoutMs = options.invocationTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS;
  const narrationTimeoutMs = options.invocationTimeoutMs ?? NARRATION_TIMEOUT_MS;
  if (
    !Number.isFinite(invocationTimeoutMs) ||
    invocationTimeoutMs < 1 ||
    invocationTimeoutMs > DEFAULT_INVOCATION_TIMEOUT_MS
  ) {
    throw new TypeError("Authoritative KP timeout must be between 1 and 45000 milliseconds.");
  }

  async function invoke(
    task: InvocationTask,
    rootActionId: string,
    attempt: number,
    invocationPurpose: ModelInvocationPurpose,
    input: Record<string, unknown>,
    timeoutBudgetMs = invocationTimeoutMs,
    metadata: Pick<Partial<ModelInvocationReceipt>, "schemaVersion" | "promptPolicyVersion"> = {},
  ): Promise<InvocationSuccess> {
    const startedAt = now();
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new ModelInvocationTimeoutError());
        }, timeoutBudgetMs);
      });
      const modelCall = options.ai.run(
        profile.modelId,
        input,
        { signal: abortController.signal, timeoutMs: timeoutBudgetMs },
      );
      const response = await Promise.race([modelCall, timeout]);
      const endedAt = now();
      return {
        response,
        receipt: receipt(
          profile,
          task,
          rootActionId,
          attempt,
          invocationPurpose,
          startedAt,
          endedAt,
          "success",
          {
            ...metadata,
            ...usageFrom(response),
            responseHash: await responseHash(response),
          },
        ),
      };
    } catch (error) {
      const endedAt = now();
      const result = classifyModelError(error);
      const failure = new AuthoritativeKpModelError(
        result,
        receipt(
          profile,
          task,
          rootActionId,
          attempt,
          invocationPurpose,
          startedAt,
          endedAt,
          result,
          { ...metadata, failureDiagnostic: diagnoseFailure(error, "modelRequest") },
        ),
        retryAfterFrom(error),
      );
      // The provider did not return a result to validate. Its permanent
      // rejection says nothing about the generated body or grounding report.
      if (task === "narration" && result === "modelPermanent") {
        Object.assign(failure, { publicCode: "NARRATION_PROVIDER_REJECTED" });
      }
      throw failure;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function emitInvocationReceipt(value: ModelInvocationReceipt): void {
    try {
      options.onInvocationReceipt?.(structuredClone(value));
    } catch {
      // Observability must never change the model task's product outcome.
    }
  }

  async function withInvocationReceipt<T extends { modelInvocationReceipt: ModelInvocationReceipt }>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await operation();
      emitInvocationReceipt(value.modelInvocationReceipt);
      return value;
    } catch (error) {
      if (error instanceof AuthoritativeKpModelError) {
        emitInvocationReceipt(error.modelInvocationReceipt);
      }
      throw error;
    }
  }

  function v3Failure(
    publicCode: string,
    invocationReceipt: ModelInvocationReceipt,
    failureStage: ModelInvocationFailureStage,
    groundingReason?: ModelInvocationReceipt["groundingReason"],
  ): AuthoritativeKpModelError {
    return Object.assign(new AuthoritativeKpModelError(
      "modelPermanent",
      { ...invocationReceipt, result: "modelPermanent", failureStage, ...(groundingReason ? { groundingReason } : {}) },
    ), { publicCode: publicCode === "NARRATION_GROUNDING_REJECTED"
      ? narrationGroundingPublicFailureCode(groundingReason) : publicCode });
  }

  async function narrateFrozen(request: FrozenClaimsNarrationRequest) {
    const startedAt = now();
    const policy = request.narrationPolicy === "plainText-v1" ? TEXT_NARRATION_POLICY : undefined;
    const attempt = request.attempt ?? 1;
    const purpose = narrationInvocationPurpose(request);
    // Preflight has no model receipt: no provider invocation occurred.
    let generationInput: Record<string, unknown>;
    try { generationInput = narrationGenerationInput(request, profile.modelId); } catch (error) {
      if (error instanceof NarrationGroundingValidationError) throw Object.assign(error, { publicCode: "NARRATION_CONTEXT_BUDGET_EXCEEDED" });
      throw error;
    }
    const generation = await invoke("narration", request.rootActionId, attempt, purpose,
      generationInput, narrationTimeoutMs, {
        schemaVersion: policy?.generationSchema ?? VNEXT_NARRATION_SCHEMA, promptPolicyVersion: policy?.version ?? VNEXT_NARRATION_POLICY.promptPolicyVersion,
      });
    let candidate: { body: string };
    let reviewInput: Record<string, unknown>;
    const rejected = (error: ModelOutputValidationError, evidence: ModelInvocationReceipt) => {
      const failure = v3Failure(
        error instanceof NarrationGroundingValidationError ? "NARRATION_GROUNDING_REJECTED" : "NARRATION_BODY_INVALID",
        evidence, error instanceof NarrationGroundingValidationError ? "narrationGrounding" : "narrationSchema",
        error instanceof NarrationGroundingValidationError ? error.reason : undefined,
      );
      if ("diagnostics" in error && Array.isArray(error.diagnostics)) {
        // Retain the verified report for the server-side caller. It must not
        // enter public error/receipt serialization or invocation telemetry.
        Object.defineProperty(failure, "narrationDiagnostics", { value: structuredClone(error.diagnostics) });
        if ("reportConflicts" in error) Object.defineProperty(failure, "narrationReportConflicts", { value: structuredClone(error.reportConflicts) });
      }
      return failure;
    };
    try {
      candidate = narrationCandidate(generation.response, request);
      reviewInput = narrationReviewInput(request, candidate.body, profile.modelId);
    } catch (error) {
      if (error instanceof NarrationGroundingValidationError && error.reason === "materialBudget") {
        // Generation succeeded; review has not called the provider. Preserve its
        // real receipt and report a capacity failure, not a factual rejection.
        emitInvocationReceipt(generation.receipt);
        throw Object.assign(error, { publicCode: "NARRATION_CONTEXT_BUDGET_EXCEEDED" });
      }
      if (error instanceof ModelOutputValidationError) throw rejected(error, generation.receipt);
      throw error;
    }
    const remainingMs = narrationTimeoutMs - Math.max(0, now() - startedAt);
    if (remainingMs < 1) {
      throw new AuthoritativeKpModelError("modelTransient", { ...generation.receipt, result: "modelTransient",
        failureDiagnostic: fixedFailureDiagnostic("narrationDeadlineExceeded") });
    }
    emitInvocationReceipt(generation.receipt);
    let review = await invoke("narration", request.rootActionId, attempt,
      purpose === "narrationRecovery" ? "narrationRecoveryReview" : "narrationReview",
      reviewInput, remainingMs, {
        schemaVersion: policy?.reviewSchema ?? NARRATION_REVIEW_SCHEMA, promptPolicyVersion: policy?.version ?? VNEXT_NARRATION_POLICY.promptPolicyVersion,
      });
    try {
      const decision = narrationReviewDecision(review.response, request, candidate.body);
      if (decision.kind === "repair") {
        // SPEC 0016 §8.3: one rewrite, then one independent review, on the
        // original receipt. All four stages share this attempt's deadline.
        const repairInput = narrationRepairModelInput(request, candidate.body, review.response, profile.modelId);
        const remaining = () => {
          const ms = narrationTimeoutMs - Math.max(0, now() - startedAt);
          if (ms < 1) throw new AuthoritativeKpModelError("modelTransient", {
            ...review.receipt, result: "modelTransient",
            failureDiagnostic: fixedFailureDiagnostic("narrationDeadlineExceeded"),
          });
          return ms;
        };
        const repairMs = remaining();
        emitInvocationReceipt(rejected(decision.rejection, review.receipt).modelInvocationReceipt);
        const repair = await invoke("narration", request.rootActionId, attempt,
          purpose === "narrationRecovery" ? "narrationRecoveryGroundingRepair" : "narrationGroundingRepair",
          repairInput, repairMs, { schemaVersion: policy?.generationSchema ?? VNEXT_NARRATION_SCHEMA,
            promptPolicyVersion: policy?.version ?? NARRATION_PUBLICATION_POLICY.version });
        // Attribute malformed repaired output to the actual generating call.
        review = repair;
        candidate = narrationCandidate(repair.response, request);
        const finalInput = narrationReviewInput(request, candidate.body, profile.modelId);
        const finalMs = remaining();
        emitInvocationReceipt(repair.receipt);
        review = await invoke("narration", request.rootActionId, attempt,
          purpose === "narrationRecovery" ? "narrationRecoveryRepairReview" : "narrationRepairReview",
          finalInput, finalMs, { schemaVersion: policy?.reviewSchema ?? NARRATION_REVIEW_SCHEMA,
            promptPolicyVersion: policy?.version ?? NARRATION_PUBLICATION_POLICY.version });
        const finalDecision = narrationReviewDecision(review.response, request, candidate.body);
        if (finalDecision.kind === "repair") throw finalDecision.rejection;
      }
    } catch (error) {
      if (error instanceof NarrationGroundingValidationError && error.reason === "materialBudget") {
        emitInvocationReceipt(review.receipt);
        throw Object.assign(error, { publicCode: "NARRATION_CONTEXT_BUDGET_EXCEEDED" });
      }
      if (error instanceof ModelOutputValidationError) throw rejected(error, review.receipt);
      throw error;
    }
    return { ...candidate, audience: { viewerKey: request.viewerKey, projectionHash: request.renderableClaims.projectionHash },
      modelInvocationReceipt: review.receipt };
  }

  if (!isV3AuthoritativeKpProfile(profile)) {
    throw new TypeError("The current product accepts only the private narrow-tools KP profile.");
  }
  return {

      async decidePendingInput(request) {
        try {
          let modelInput: Record<string, unknown>;
          try { modelInput = npcPendingDecisionModelInput(request); } catch {
            throw permanentContractError(profile, "proposal", request.rootActionId, 1, "actorPlan", now);
          }
          const invocation = await invoke("proposal", request.rootActionId, 1, "actorPlan", modelInput);
          try {
            const decision = validateNpcPendingDecisionOutput(extractStructuredOutput(
              invocation.response, NPC_PENDING_DECISION_TOOL_NAME,
            ), request);
            emitInvocationReceipt(invocation.receipt);
            return decision;
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error;
            throw v3Failure("NPC_PENDING_DECISION_INVALID", invocation.receipt, "proposalSchema");
          }
        } catch (error) {
          if (error instanceof AuthoritativeKpModelError) emitInvocationReceipt(error.modelInvocationReceipt);
          throw error;
        }
      },

      async decideDueActorPlan(request: DueActorPlanDecisionRequest) {
        const rootActionId = typeof request?.rootActionId === "string"
          ? request.rootActionId
          : "invalid";
        try {
          let modelInput: Record<string, unknown>;
          try {
            modelInput = actorPlanDecisionModelInput(request);
          } catch {
            throw permanentContractError(
              profile,
              "proposal",
              rootActionId,
              1,
              "actorPlan",
              now,
            );
          }
          const invocation = await invoke(
            "proposal",
            request.rootActionId,
            1,
            "actorPlan",
            modelInput,
          );
          try {
            const structured = extractStructuredOutput(
              invocation.response,
              ACTOR_PLAN_DECISION_TOOL_NAME,
            );
            const candidate = unwrapSingleEnvelope(structured);
            const decision = validateActorPlanDecisionOutput(candidate, request, {
              npcEquipment: isSocialResolutionKpProfile(profile),
            });
            emitInvocationReceipt(invocation.receipt);
            return decision;
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error;
            throw v3Failure(
              "ACTOR_PLAN_DECISION_INVALID",
              invocation.receipt,
              "proposalSchema",
            );
          }
        } catch (error) {
          if (error instanceof AuthoritativeKpModelError) {
            emitInvocationReceipt(error.modelInvocationReceipt);
          }
          throw error;
        }
      },

      async narrate(request) {
        return withInvocationReceipt(async () => {
          const rootActionId = typeof request?.rootActionId === "string"
            ? request.rootActionId
            : "invalid";
          const attempt = Number.isInteger(request?.attempt) ? request.attempt as number : 1;
          const initialPurpose = narrationInvocationPurpose(request);
          try {
            validateNarrationRequest(request);
          } catch {
            if (request?.narrationInputMode === "frozenRenderableClaims-vnext-1") {
              throw Object.assign(new ModelOutputValidationError(), { publicCode: "NARRATION_BODY_INVALID" });
            }
            throw permanentContractError(
              profile,
              "narration",
              rootActionId,
              attempt,
              initialPurpose,
              now,
            );
          }
          if (request.narrationInputMode === "frozenRenderableClaims-vnext-1") return narrateFrozen(structuredClone(request));
          let invocation = await invoke(
            "narration",
            request.rootActionId,
            attempt,
            initialPurpose,
            bodyOnlyNarrationModelInput(request, {
                  socialResolution: isSocialResolutionKpProfile(profile),
                }),
          );
          try {
            const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
            const candidate = unwrapSingleEnvelope(structured);
            const narration = validateBodyOnlyNarrationOutput(candidate, request.projection, {
                  socialResolution: isSocialResolutionKpProfile(profile),
                });
            return {
              ...narration,
              audience: audienceIdentity(request.projection),
              modelInvocationReceipt: invocation.receipt,
            };
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error;
            const failed = v3Failure(
              error instanceof NarrationGroundingValidationError
                ? "NARRATION_GROUNDING_REJECTED"
                : "NARRATION_BODY_INVALID",
              invocation.receipt,
              error instanceof NarrationGroundingValidationError
                ? "narrationGrounding"
                : "narrationSchema",
              error instanceof NarrationGroundingValidationError ? error.reason : undefined,
            );
            if (
              !(error instanceof NarrationGroundingValidationError)
              || !isSocialResolutionKpProfile(profile)
            ) throw failed;
            const remainingInvocationMs = invocationTimeoutMs - Math.max(
              0,
              now() - invocation.receipt.startedAt,
            );
            if (remainingInvocationMs < 1) throw failed;
            emitInvocationReceipt(failed.modelInvocationReceipt);
            invocation = await invoke(
              "narration",
              request.rootActionId,
              attempt,
              narrationGroundingRepairPurpose(initialPurpose),
              bodyOnlyNarrationGroundingReplacementModelInput(request, {
                    socialResolution: isSocialResolutionKpProfile(profile),
                  }),
              remainingInvocationMs,
            );
            try {
              const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
              const candidate = unwrapSingleEnvelope(structured);
              const narration = validateBodyOnlyNarrationOutput(candidate, request.projection, {
                    socialResolution: isSocialResolutionKpProfile(profile),
                  });
              return {
                ...narration,
                audience: audienceIdentity(request.projection),
                modelInvocationReceipt: invocation.receipt,
              };
            } catch (replacementError) {
              if (!(replacementError instanceof ModelOutputValidationError)) throw replacementError;
              throw v3Failure(
                replacementError instanceof NarrationGroundingValidationError
                  ? "NARRATION_GROUNDING_REJECTED"
                  : "NARRATION_BODY_INVALID",
                invocation.receipt,
                replacementError instanceof NarrationGroundingValidationError
                  ? "narrationGrounding"
                  : "narrationSchema",
                replacementError instanceof NarrationGroundingValidationError ? replacementError.reason : undefined,
              );
            }
          }
        });
      },
  };
}

function validateNarrationRequest(request: KpNarrationRequest): void {
  requiredString(request.rootActionId);
  if (
    request.narrationPurpose !== undefined
    && !isKpNarrationRequestPurpose(request.narrationPurpose)
  ) throw new ModelOutputValidationError();
  if (!isRecord(request.receipt)) throw new ModelOutputValidationError();
  const status = request.receipt.status ?? request.receipt.kind;
  if (status !== "committed" && status !== "concluded") throw new ModelOutputValidationError();
  if (request.narrationInputMode === "frozenRenderableClaims-vnext-1") {
    const receiptId = requiredString(request.receipt.receiptId);
    if (
      !requiredString(request.viewerKey)
      || requiredString(request.receipt.rootActionId) !== request.rootActionId
      || !frozenRenderableClaimsConform(request.renderableClaims)
      || request.renderableClaims.claims.length === 0
      || request.renderableClaims.viewerKey !== request.viewerKey
      || request.renderableClaims.rootActionId !== request.rootActionId
      || request.renderableClaims.receiptId !== receiptId
      || !frozenNarrationContextConform(request.narrationContext, request.renderableClaims)
    ) throw new ModelOutputValidationError();
    return;
  }
  if (request.narrationInputMode !== "observerProjection-v1") {
    throw new ModelOutputValidationError();
  }
  const audience = audienceIdentity(request.projection);
  if (!isRecord(request.projection) || !isRecord(request.projection.committedDelta)) {
    throw new ModelOutputValidationError();
  }
  const delta = request.projection.committedDelta;
  if (
    delta.schema !== "zhuwei.observer-committed-delta/v1"
    || requiredString(delta.viewerCharacterId) !== audience.viewerKey
    || !requiredString(delta.actorCharacterId)
    || !Array.isArray(delta.changes)
    || delta.changes.length === 0
    || delta.changes.some((change) => !isRecord(change) || !requiredString(change.kind))
    || !isRecord(delta.receipt)
    || requiredString(delta.receipt.rootActionId) !== request.rootActionId
    || requiredString(delta.receipt.receiptId) !== requiredString(request.receipt.receiptId)
    || delta.receipt.status !== status
  ) throw new ModelOutputValidationError();
}
