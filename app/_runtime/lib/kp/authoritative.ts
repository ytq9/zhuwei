import {
  AUTHORITATIVE_KP_PROFILE,
  NARRATION_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
  narrationModelInput,
  proposalModelInput,
} from "./authoritative-policy";
import {
  ModelInvocationTimeoutError,
  ModelOutputValidationError,
  assertProposalProjectionBound,
  assertKpProjection,
  audienceIdentity,
  classifyModelError,
  extractStructuredOutput,
  isRecord,
  responseHash,
  retryAfterFrom,
  usageFrom,
  validateNarration,
  validateProposal,
} from "./authoritative-helpers";
import type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  KpNarrationRequest,
  KpProposalRequest,
  ModelInvocationReceipt,
  ModelInvocationResult,
} from "./authoritative-types";

export { AUTHORITATIVE_KP_PROFILE } from "./authoritative-policy";
export type {
  AuthoritativeKpAdapter,
  AuthoritativeKpAdapterOptions,
  AuthoritativeKpProposal,
  CurrentNarration,
  KpNarrationRequest,
  KpProposalRequest,
  ModelInvocationReceipt,
  ModelInvocationResult,
  WorkersAiBinding,
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

function schemaVersion(task: InvocationTask): string {
  return task === "proposal"
    ? AUTHORITATIVE_KP_PROFILE.proposalSchemaVersion
    : AUTHORITATIVE_KP_PROFILE.narrationSchemaVersion;
}

function receipt(
  task: InvocationTask,
  rootActionId: string,
  attempt: number,
  startedAt: number,
  endedAt: number,
  result: ModelInvocationResult,
  additions: Partial<ModelInvocationReceipt> = {},
): ModelInvocationReceipt {
  return {
    provider: AUTHORITATIVE_KP_PROFILE.provider,
    modelId: AUTHORITATIVE_KP_PROFILE.modelId,
    modelRevision: AUTHORITATIVE_KP_PROFILE.modelRevision,
    modelProfileVersion: AUTHORITATIVE_KP_PROFILE.modelProfileVersion,
    promptPolicyVersion: AUTHORITATIVE_KP_PROFILE.promptPolicyVersion,
    schemaVersion: schemaVersion(task),
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
  task: InvocationTask,
  rootActionId: string,
  attempt: number,
  now: () => number,
): AuthoritativeKpModelError {
  const at = now();
  return new AuthoritativeKpModelError(
    "modelPermanent",
    receipt(task, rootActionId, attempt, at, at, "modelPermanent"),
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

/**
 * Creates the v2 KP boundary. It performs model I/O only; it owns no world state,
 * mechanics, randomness, delivery history, or authority to commit a proposal.
 */
export function createAuthoritativeKpAdapter(
  options: AuthoritativeKpAdapterOptions,
): AuthoritativeKpAdapter {
  if (!options?.ai || typeof options.ai.run !== "function") {
    throw new TypeError("Workers AI binding is required for the authoritative KP adapter.");
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
  ): Promise<InvocationSuccess> {
    const startedAt = now();
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new ModelInvocationTimeoutError());
        }, invocationTimeoutMs);
      });
      const modelCall = options.ai.run(
        AUTHORITATIVE_KP_PROFILE.modelId,
        input,
        { signal: abortController.signal },
      );
      const response = await Promise.race([modelCall, timeout]);
      const endedAt = now();
      return {
        response,
        receipt: receipt(task, rootActionId, attempt, startedAt, endedAt, "success", {
          ...usageFrom(response),
          responseHash: await responseHash(response),
        }),
      };
    } catch (error) {
      const endedAt = now();
      const result = classifyModelError(error);
      throw new AuthoritativeKpModelError(
        result,
        receipt(task, rootActionId, attempt, startedAt, endedAt, result),
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

  return {
    async propose(request) {
      return withInvocationReceipt(async () => {
        const rootActionId = typeof request?.rootActionId === "string"
          ? request.rootActionId
          : "invalid";
        const attempt = typeof request?.attempt === "number" ? request.attempt : 0;
        try {
          validateProposalRequest(request);
        } catch {
          throw permanentContractError("proposal", rootActionId, attempt, now);
        }

        let modelInput: Record<string, unknown>;
        try {
          modelInput = proposalModelInput(request);
        } catch {
          throw permanentContractError("proposal", request.rootActionId, request.attempt, now);
        }
        const invocation = await invoke(
          "proposal",
          request.rootActionId,
          request.attempt,
          modelInput,
        );
        try {
          const structured = extractStructuredOutput(invocation.response, PROPOSAL_TOOL_NAME);
          const proposal = validateProposal(structured);
          assertProposalProjectionBound(proposal, request.projection);
          return {
            ...proposal,
            proposalAttemptId: `${request.rootActionId}:kp:${request.attempt}`,
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

    async narrate(request) {
      return withInvocationReceipt(async () => {
        const rootActionId = typeof request?.rootActionId === "string"
          ? request.rootActionId
          : "invalid";
        const attempt = Number.isInteger(request?.attempt) ? request.attempt as number : 1;
        try {
          validateNarrationRequest(request);
        } catch {
          throw permanentContractError("narration", rootActionId, attempt, now);
        }
        const audience = audienceIdentity(request.projection);
        let modelInput: Record<string, unknown>;
        try {
          modelInput = narrationModelInput(request);
        } catch {
          throw permanentContractError("narration", request.rootActionId, attempt, now);
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
