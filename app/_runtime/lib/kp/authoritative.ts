import {
  AUTHORITATIVE_KP_PROFILE,
  authoritativeKpProfileByBinding,
  NARRATION_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
  narrationModelInput,
  proposalModelInput,
  proposalProjectionRepairModelInput,
} from "./authoritative-policy";
import {
  ModelInvocationTimeoutError,
  ModelOutputValidationError,
  assertProposalProjectionBound,
  assertKpProjection,
  audienceIdentity,
  canonicalJson,
  classifyModelError,
  collectStrings,
  extractStructuredOutput,
  isRecord,
  projectionCanonicalFactRefs,
  projectionNpcKnowledgeRefs,
  responseHash,
  retryAfterFrom,
  usageFrom,
  validateNarration,
  validateProposal,
} from "./authoritative-helpers";
import type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  KpNarrationRequest,
  KpProposalDraft,
  KpProposalRequest,
  ModelInvocationFailureStage,
  ModelInvocationReceipt,
  ModelInvocationResult,
} from "./authoritative-types";

export { AUTHORITATIVE_KP_PROFILE } from "./authoritative-policy";
export type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProfile,
  AuthoritativeKpProposal,
  CurrentNarration,
  KpNarrationRequest,
  KpProposalRequest,
  ModelInvocationReceipt,
  ModelInvocationResult,
  AuthoritativeModelBinding,
} from "./authoritative-types";

const DEFAULT_INVOCATION_TIMEOUT_MS = 45_000;
const MAX_PROPOSAL_ATTEMPT = 3;

type InvocationTask = "proposal" | "narration";

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
  now: () => number,
): AuthoritativeKpModelError {
  const at = now();
  return new AuthoritativeKpModelError(
    "modelPermanent",
    receipt(profile, task, rootActionId, attempt, at, at, "modelPermanent"),
  );
}

function permanentOutputError(
  error: unknown,
  invocationReceipt: ModelInvocationReceipt,
  failureStage: ModelInvocationFailureStage,
): AuthoritativeKpModelError {
  if (!(error instanceof ModelOutputValidationError)) throw error;
  return new AuthoritativeKpModelError(
    "modelPermanent",
    {
      ...invocationReceipt,
      result: "modelPermanent",
      failureStage,
    },
  );
}

function validateProposalRequest(request: KpProposalRequest): void {
  requiredString(request.preparedActionId);
  requiredString(request.rootActionId);
  if (!Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > MAX_PROPOSAL_ATTEMPT) {
    throw new ModelOutputValidationError();
  }
  if (request.attempt > 1 && request.diagnostics === undefined) {
    throw new ModelOutputValidationError();
  }
  assertKpProjection(request.projection);
}

function validateNarrationRequest(request: KpNarrationRequest): void {
  requiredString(request.rootActionId);
  if (!isRecord(request.receipt)) throw new ModelOutputValidationError();
  const status = request.receipt.status ?? request.receipt.kind;
  if (status !== "committed" && status !== "concluded") throw new ModelOutputValidationError();
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

function proposalWithoutRepairableProjectionRefs(
  proposal: KpProposalDraft,
): KpProposalDraft {
  const copy = structuredClone(proposal);
  copy.publicBasisRefs = [];
  copy.privateBasisRefs = [];
  for (const materialization of copy.dynamicMaterializations) {
    materialization.causalBasisRefs = [];
  }
  for (const candidate of copy.hiddenRealityCandidateSet?.candidates ?? []) {
    candidate.causalBasisRefs = [];
  }
  copy.npcActions = [];
  return copy;
}

function assertProjectionRepairPreservesProposal(
  rejectedProposal: KpProposalDraft,
  repairedProposal: KpProposalDraft,
  projection: unknown,
): void {
  if (
    canonicalJson(proposalWithoutRepairableProjectionRefs(rejectedProposal))
    !== canonicalJson(proposalWithoutRepairableProjectionRefs(repairedProposal))
  ) {
    throw new ModelOutputValidationError();
  }

  const available = collectStrings(projection);
  const expectedPublicBasisRefs = rejectedProposal.publicBasisRefs.filter(
    (reference) => available.has(reference),
  );
  const expectedPrivateBasisRefs = rejectedProposal.privateBasisRefs.filter(
    (reference) => available.has(reference),
  );
  if (
    canonicalJson(repairedProposal.publicBasisRefs) !== canonicalJson(expectedPublicBasisRefs)
    || canonicalJson(repairedProposal.privateBasisRefs) !== canonicalJson(expectedPrivateBasisRefs)
  ) {
    throw new ModelOutputValidationError();
  }

  const causalReferences = projectionCanonicalFactRefs(projection);
  for (let index = 0; index < rejectedProposal.dynamicMaterializations.length; index += 1) {
    const expected = rejectedProposal.dynamicMaterializations[index].causalBasisRefs.filter(
      (reference) => causalReferences.has(reference),
    );
    if (
      canonicalJson(repairedProposal.dynamicMaterializations[index].causalBasisRefs)
      !== canonicalJson(expected)
    ) {
      throw new ModelOutputValidationError();
    }
  }
  const rejectedCandidates = rejectedProposal.hiddenRealityCandidateSet?.candidates ?? [];
  const repairedCandidates = repairedProposal.hiddenRealityCandidateSet?.candidates ?? [];
  for (let index = 0; index < rejectedCandidates.length; index += 1) {
    const expected = rejectedCandidates[index].causalBasisRefs.filter(
      (reference) => causalReferences.has(reference),
    );
    if (canonicalJson(repairedCandidates[index].causalBasisRefs) !== canonicalJson(expected)) {
      throw new ModelOutputValidationError();
    }
  }

  const expectedNpcActions = rejectedProposal.npcActions.filter((action) => {
    const knowledgeRefs = projectionNpcKnowledgeRefs(projection, action.npcId);
    return knowledgeRefs !== undefined
      && action.knowledgeRefs.every((reference) => knowledgeRefs.has(reference));
  });
  if (canonicalJson(repairedProposal.npcActions) !== canonicalJson(expectedNpcActions)) {
    throw new ModelOutputValidationError();
  }
}

/**
 * Creates the v2 KP boundary. It performs model I/O only; it owns no world state,
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
    input: Record<string, unknown>,
    timeoutBudgetMs = invocationTimeoutMs,
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
        { signal: abortController.signal },
      );
      const response = await Promise.race([modelCall, timeout]);
      const endedAt = now();
      return {
        response,
        receipt: receipt(profile, task, rootActionId, attempt, startedAt, endedAt, "success", {
          ...usageFrom(response),
          responseHash: await responseHash(response),
        }),
      };
    } catch (error) {
      const endedAt = now();
      const result = classifyModelError(error);
      throw new AuthoritativeKpModelError(
        result,
        receipt(profile, task, rootActionId, attempt, startedAt, endedAt, result),
        retryAfterFrom(error),
      );
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

  function proposalDraftFromInvocation(invocation: InvocationSuccess): KpProposalDraft {
    let structured: Record<string, unknown>;
    try {
      structured = extractStructuredOutput(invocation.response, PROPOSAL_TOOL_NAME);
    } catch (error) {
      throw permanentOutputError(error, invocation.receipt, "structuredOutput");
    }
    try {
      return validateProposal(structured);
    } catch (error) {
      throw permanentOutputError(error, invocation.receipt, "proposalSchema");
    }
  }

  function assertProjectionBoundProposal(
    proposal: KpProposalDraft,
    projection: unknown,
    invocationReceipt: ModelInvocationReceipt,
  ): void {
    try {
      assertProposalProjectionBound(proposal, projection);
    } catch (error) {
      throw permanentOutputError(error, invocationReceipt, "projectionBinding");
    }
  }

  return {
    async propose(request) {
      return withInvocationReceipt(async () => {
        const proposalBudgetStartedAt = now();
        const rootActionId = typeof request?.rootActionId === "string"
          ? request.rootActionId
          : "invalid";
        const attempt = typeof request?.attempt === "number" ? request.attempt : 0;
        try {
          validateProposalRequest(request);
        } catch {
          throw permanentContractError(profile, "proposal", rootActionId, attempt, now);
        }

        let modelInput: Record<string, unknown>;
        try {
          modelInput = proposalModelInput(request);
        } catch {
          throw permanentContractError(profile, "proposal", request.rootActionId, request.attempt, now);
        }
        const invocation = await invoke(
          "proposal",
          request.rootActionId,
          request.attempt,
          modelInput,
        );
        const proposal = proposalDraftFromInvocation(invocation);
        try {
          assertProjectionBoundProposal(proposal, request.projection, invocation.receipt);
        } catch (error) {
          if (
            !(error instanceof AuthoritativeKpModelError)
            || error.modelInvocationReceipt.failureStage !== "projectionBinding"
            || request.attempt !== 1
          ) {
            throw error;
          }

          const elapsedMs = Math.max(0, now() - proposalBudgetStartedAt);
          const remainingBudgetMs = Math.floor(invocationTimeoutMs - elapsedMs);
          if (remainingBudgetMs < 1) throw error;

          const repairInput = proposalProjectionRepairModelInput(request, proposal);
          emitInvocationReceipt(error.modelInvocationReceipt);
          const repairInvocation = await invoke(
            "proposal",
            request.rootActionId,
            request.attempt,
            repairInput,
            remainingBudgetMs,
          );
          const repairedProposal = proposalDraftFromInvocation(repairInvocation);
          try {
            assertProjectionRepairPreservesProposal(
              proposal,
              repairedProposal,
              request.projection,
            );
          } catch (repairError) {
            throw permanentOutputError(
              repairError,
              repairInvocation.receipt,
              "projectionBinding",
            );
          }
          assertProjectionBoundProposal(
            repairedProposal,
            request.projection,
            repairInvocation.receipt,
          );
          return {
            ...repairedProposal,
            proposalAttemptId: `${request.rootActionId}:kp:${request.attempt}`,
            modelInvocationReceipt: repairInvocation.receipt,
          };
        }
        return {
          ...proposal,
          proposalAttemptId: `${request.rootActionId}:kp:${request.attempt}`,
          modelInvocationReceipt: invocation.receipt,
        };
      });
    },

    async narrate(request) {
      return withInvocationReceipt(async () => {
        const rootActionId = typeof request?.rootActionId === "string"
          ? request.rootActionId
          : "invalid";
        const attempt = Number.isInteger(request?.attempt) ? request.attempt as number : 1;
        try {
          validateNarrationRequest(request);
        } catch {
          throw permanentContractError(profile, "narration", rootActionId, attempt, now);
        }
        const audience = audienceIdentity(request.projection);
        let modelInput: Record<string, unknown>;
        try {
          modelInput = narrationModelInput(request);
        } catch {
          throw permanentContractError(profile, "narration", request.rootActionId, attempt, now);
        }
        const invocation = await invoke(
          "narration",
          request.rootActionId,
          attempt,
          modelInput,
        );
        try {
          const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
          const narration = validateNarration(structured, request.projection);
          return {
            ...narration,
            audience,
            modelInvocationReceipt: invocation.receipt,
          };
        } catch {
          throw new AuthoritativeKpModelError(
            "modelPermanent",
            { ...invocation.receipt, result: "modelPermanent" },
          );
        }
      });
    },
  };
}
