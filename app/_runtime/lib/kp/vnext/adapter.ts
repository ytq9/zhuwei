import { PROPOSAL_DIAGNOSTIC_CODES, proposalDiagnostic, type ProposalDiagnostic, type ProposalDiagnosticCode } from "./proposal-diagnostics";
import type { AuthoritativeModelBinding, AuthoritativeKpAdapter } from "../authoritative-types";
import { deepSeekRequestBody } from "../deepseek";
import type { KpAdapterCapability } from "../../room/action";
import type { VNextInvocationRequest, VNextInvocationCompletion, VNextInvocationStart } from "../../room/vnext-proposal-invocation";
import { vnextInvocationRetryAfter } from "../../room/vnext-proposal-invocation";
import { canonicalHash, isPlainRecord, type JsonRecord } from "./canonical-json";
import { assembleProviderInvocation, INITIAL_REPAIR_LEDGER } from "./invocation/assemble";
import { invokeVNextProposalOffer, invokeSubmitKpProposalBundleFirstPass, invokeCorrectKpProposalBundle, vnextProposalHasExecutionRepairBudget, type VNextProposalBundleRepairTicket } from "./proposal-provider";
import type { VNextRequiredContext } from "./required-context";
import { proposalModelContext } from "./proposal-context";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_HASH, VNEXT_PROVIDER_BUDGET } from "./runtime-policy";

type VNextProposalRequest = {
  preparedActionId: string;
  rootActionId: string;
  requiredContext?: unknown;
  attempt: number;
  diagnostics?: unknown;
};

export type VNextInvocationJournal = Readonly<{
  begin(preparedActionId: string, input: VNextInvocationRequest): Promise<VNextInvocationStart>;
  complete(preparedActionId: string, input: VNextInvocationCompletion): Promise<{ kind: string }>;
}>;

export function vnextProposalFailure(publicCode: string, retryable = false, retryAfter?: number,
  detail?: Readonly<{ issues: readonly string[]; diagnostics: readonly ProposalDiagnostic[];
    /** Original Rules evidence stays server-private; it is not a repair prompt. */
    authorityDiagnostics?: unknown }>): Error {
  return Object.assign(new Error(publicCode), { publicCode, code: retryable ? "modelTransient" : "modelPermanent",
    ...(retryAfter === undefined ? {} : { retryAfter }),
    ...(detail === undefined ? {} : { proposalDiagnostics: detail }) });
}

/** The normal Room orchestration supplies a durable journal; adapters never
 * own world state, random numbers, repair counters or committed results. */
export function createVNextKpAdapter(options: Readonly<{
  proposalBinding: AuthoritativeModelBinding;
  narrationAdapter: AuthoritativeKpAdapter;
  journal: VNextInvocationJournal;
  onInvocation?: (event: Readonly<Record<string, unknown>>) => void;
}>): KpAdapterCapability {
  return {
    async propose(raw) {
      const request = raw as VNextProposalRequest;
      if (!isPlainRecord(request.requiredContext)
        || !isPlainRecord(request.requiredContext.binding)
        || request.requiredContext.binding.preparedActionId !== request.preparedActionId
        || request.requiredContext.binding.rootActionId !== request.rootActionId) {
        throw vnextProposalFailure("CONTEXT_INSUFFICIENT");
      }
      if (request.attempt !== 1) {
        // Authority diagnostics have no server-proven representation plan.
        // Refuse locally, without another provider call or a second ruling.
        throw vnextProposalFailure("PROPOSAL_RULES_DIAGNOSTIC", false, undefined, {
          ...(request.diagnostics === undefined ? {} : { authorityDiagnostics: structuredClone(request.diagnostics) }),
          issues: ["repair:authority-decision-change-not-proven"],
          diagnostics: [...authorityProposalDiagnostics(request.diagnostics), proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "repair:authority-decision-change-not-proven", {
            repair: { allowed: false, reason: "authority-diagnostic-does-not-prove-semantically-equivalent-edits" },
          })],
        });
      }
      const requiredContext = request.requiredContext as unknown as VNextRequiredContext;
      async function boundInvocation(ordinal: 1 | 2 | 3, repairTicket?: VNextProposalBundleRepairTicket): Promise<AuthoritativeModelBinding> {
        return {
          async run(model, input) {
            if (model !== VNEXT_KP_PROFILE.modelId) throw vnextProposalFailure("PROPOSAL_PROVIDER_CONFIGURATION");
            const invocationKind = repairTicket === undefined ? "initial" : "schemaRepair";
            const stage = ordinal === 1 ? "offer" : repairTicket === undefined ? "expandedProposal" : "correction";
            const assembled = assembleProviderInvocation({
              providerBody: deepSeekRequestBody(model, input) as JsonRecord,
              invocationKind, ledger: INITIAL_REPAIR_LEDGER, budgetProfile: VNEXT_PROVIDER_BUDGET,
            });
            if (assembled.kind === "blocked") throw vnextProposalFailure(assembled.code);
            const started = await options.journal.begin(request.preparedActionId, {
              ordinal, contextHash: requiredContext.binding.contextHash,
              bindingHash: VNEXT_KP_WORKFLOW_HASH, requestHash: assembled.requestHash,
              request: assembled.providerBody, ...(repairTicket === undefined ? {} : { repairTicket }),
            });
            if (started.kind === "completed") return started.response;
            if (started.kind !== "ready") throw vnextProposalFailure(started.code, started.kind === "retryableFailure", started.retryAfter);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 45_000);
            const at = Date.now();
            let response: unknown;
            try {
              response = await options.proposalBinding.run(model, assembled.providerBody, { signal: controller.signal });
            } catch (error) {
              const status = isPlainRecord(error) && typeof error.status === "number" ? error.status
                : error !== null && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
              const retryable = status === undefined || status === 429 || status >= 500;
              const code = retryable ? "PROPOSAL_PROVIDER_TIMEOUT" : "PROPOSAL_PROVIDER_CONFIGURATION";
              const retryAfter = retryable && error !== null && typeof error === "object" && "retryAfter" in error
                ? vnextInvocationRetryAfter(error.retryAfter) : undefined;
              await options.journal.complete(request.preparedActionId, {
                ordinal, capability: started.capability, requestHash: assembled.requestHash,
                result: { kind: retryable ? "retryable" : "rejected", code,
                  ...(retryAfter === undefined ? {} : { retryAfter }) },
              });
              emit(() => ({ result: code, durationMs: Date.now() - at,
                ...(status === undefined ? {} : { providerStatus: status }),
                ...(retryAfter === undefined ? {} : { retryAfter }) }));
              throw vnextProposalFailure(code, retryable, retryAfter);
            } finally { clearTimeout(timer); }
            const saved = await options.journal.complete(request.preparedActionId, {
              ordinal, capability: started.capability, requestHash: assembled.requestHash,
              result: { kind: "completed", response },
            });
            if (saved.kind !== "saved") throw vnextProposalFailure("PROPOSAL_INVOCATION_IN_PROGRESS", true);
            emit(() => ({ result: "success", durationMs: Date.now() - at,
              responseHash: canonicalHash(response),
              ...(isPlainRecord(response) && isPlainRecord(response.usage)
                ? { inputTokens: numericUsage(response.usage.prompt_tokens), outputTokens: numericUsage(response.usage.completion_tokens) } : {}) }));
            return response;

            function emit(result: () => Readonly<Record<string, unknown>>) {
              try { options.onInvocation?.({ eventName: "kp.vnext.invocation", ordinal, stage,
                preparedActionId: request.preparedActionId, rootActionId: request.rootActionId,
                requestHash: assembled.kind === "ready" ? assembled.requestHash : "",
                bindingHash: VNEXT_KP_WORKFLOW_HASH,
                ...(assembled.budgetReceipt === undefined ? {} : {
                  estimatedInputTokens: assembled.budgetReceipt.estimatedInputTokens,
                  allowedInputTokens: assembled.budgetReceipt.allowedInputTokens,
                  counterRef: assembled.budgetReceipt.counterRef,
                }),
                contextHash: requiredContext.binding.contextHash, ...result() }); } catch { /* telemetry construction and delivery cannot change validation or commit */ }
            }
          },
        };
      }
      const message = JSON.stringify({ requiredContext: proposalModelContext(requiredContext) });
      const offer = await invokeVNextProposalOffer({
        binding: await boundInvocation(1), modelId: VNEXT_KP_PROFILE.modelId,
        message, requiredContext,
      });
      // Selection and proposal reuse one frozen context. The first response
      // is durable and never becomes an alternative decision on retry.
      if (offer.kind === "rejected") throw vnextProposalFailure(offer.code, false, undefined,
        { issues: offer.issues, diagnostics: offer.diagnostics });
      const first = await invokeSubmitKpProposalBundleFirstPass({ binding: await boundInvocation(2),
        modelId: VNEXT_KP_PROFILE.modelId, message, requiredContext,
        capabilities: offer.capabilities, terminalKinds: offer.terminalKinds });
      if (first.kind === "repairRequired" && !vnextProposalHasExecutionRepairBudget(first.repairTicket.draft, offer.capabilities)) {
        const constraint = "repair:terminal-selection-call-budget-exhausted";
        throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED", false, undefined, {
          issues: [...first.repairTicket.issues, constraint],
          diagnostics: [...first.repairTicket.diagnostics, proposalDiagnostic("REPAIR_OUT_OF_SCOPE", constraint, {
            expected: { maximumCalls: 2, allowedPaths: [], allowedOperations: [] }, actual: { callsUsed: 2 },
            repair: { allowed: false, reason: "terminal-selection-and-proposal-use-the-two-call-budget" },
          })],
        });
      }
      const result = first.kind === "repairRequired"
        ? await invokeCorrectKpProposalBundle({ binding: await boundInvocation(3, first.repairTicket),
            modelId: VNEXT_KP_PROFILE.modelId, requiredContext, repairTicket: first.repairTicket })
        : first;
      if (result.kind === "rejected") throw vnextProposalFailure(result.code, false, undefined, { issues: result.issues, diagnostics: result.diagnostics });
      return result.bundle;
    },
    narrate: options.narrationAdapter.narrate,
    decideDueActorPlan: options.narrationAdapter.decideDueActorPlan,
    decidePendingInput: options.narrationAdapter.decidePendingInput,
  };
}

function numericUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Project existing Rules evidence; this performs no reference lookup, does not
 * propose replacement targets and does not grant another model invocation. */
function authorityProposalDiagnostics(value: unknown): readonly ProposalDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(diagnostic => {
    if (!isPlainRecord(diagnostic) || typeof diagnostic.code !== "string") return [];
    const code = (PROPOSAL_DIAGNOSTIC_CODES as readonly string[]).includes(diagnostic.code)
      ? diagnostic.code as ProposalDiagnosticCode : "CONSTRAINT_CONFLICT";
    const constraint = [diagnostic.constraint, diagnostic.message, diagnostic.rulesMessage,
      diagnostic.publicPath, diagnostic.code].find(value => typeof value === "string" && value.length > 0) as string;
    let position: Pick<ProposalDiagnostic, "path" | "pathBase"> = {};
    if (typeof diagnostic.path === "string" && diagnostic.path.startsWith("/")
      && !/~(?:[^01]|$)/u.test(diagnostic.path)) {
      position = { pathBase: "rulesInput", path: diagnostic.path.slice(1).split("/")
        .map(part => part.replaceAll("~1", "/").replaceAll("~0", "~")) };
    } else if (Array.isArray(diagnostic.path) && diagnostic.path.every(part => typeof part === "string"
      || (Number.isSafeInteger(part) && Number(part) >= 0))) {
      position = { path: [...diagnostic.path] as (string | number)[],
        ...(diagnostic.pathBase === "arguments" || diagnostic.pathBase === "rulesInput"
          ? { pathBase: diagnostic.pathBase } : { pathBase: "draft" }) };
    }
    return [proposalDiagnostic(code, constraint, { ...position,
      ...(diagnostic.expected === undefined ? {} : { expected: structuredClone(diagnostic.expected) }),
      ...(diagnostic.actual === undefined ? {} : { actual: structuredClone(diagnostic.actual) }),
      repair: { allowed: false, reason: "authority-diagnostic-does-not-prove-semantically-equivalent-edits" },
    })];
  });
}
