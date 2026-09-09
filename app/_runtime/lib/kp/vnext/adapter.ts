import { storyContextBindingMatches, type StoryPreparationBinding } from "../../room/story-action-context";
import { storyLibraryCatalog } from "../../room/story-library-catalog";
import { authorityProposalDiagnostics, proposalDiagnostic, type ProposalDiagnostic } from "./proposal-diagnostics";
import type { AuthoritativeModelBinding, AuthoritativeKpAdapter } from "../authoritative-types";
import { deepSeekRequestBody } from "../deepseek";
import type { KpAdapterCapability } from "../../room/action";
import type { VNextInvocationRequest, VNextInvocationCompletion, VNextInvocationStart } from "../../room/vnext-proposal-invocation";
import { vnextInvocationRetryAfter } from "../../room/vnext-proposal-invocation";
import { canonicalHash, isPlainRecord, type JsonRecord } from "./canonical-json";
import { assembleProviderInvocation, INITIAL_REPAIR_LEDGER } from "./invocation/assemble";
import { invokeVNextProposalOffer, invokeSubmitKpProposalBundleFirstPass, invokeCorrectKpProposalBundle,
  vnextProposalHasExecutionRepairBudget, vnextProposalHasThirdCallBudget, createVNextAuthorityRevisionTicket,
  type VNextProposalBundleRepairTicket, vnextProposalTicketIsEmptyDraft } from "./proposal-provider";
import type { VNextProposalBundle } from "./proposal-schema";
import { vnextProposalCapabilityForEntry, type VNextProposalCapabilityId } from "./proposal-capabilities";
import type { VNextRequiredContext } from "./required-context";
import { proposalModelContext, proposalNpcRecall } from "./proposal-context";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_HASH, VNEXT_PROVIDER_BUDGET, VNEXT_STORY_PROVIDER_BUDGET } from "./runtime-policy";

type VNextProposalRequest = {
  preparedActionId: string;
  rootActionId: string;
  requiredContext?: unknown;
  storyPreparation?: StoryPreparationBinding;
  attempt: number;
  diagnostics?: unknown;
  priorProposal?: unknown;
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
  prepareStory?: (preparedActionId: string) => Promise<
    { kind: "ready"; context: VNextRequiredContext; binding: StoryPreparationBinding }
    | { kind: "rejected" | "waiting"; code: string }>;
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
      if (request.attempt !== 1 && request.attempt !== 2) throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED");
      let requiredContext = request.requiredContext as unknown as VNextRequiredContext;
      const responses = new Map<number, unknown>();
      if (request.storyPreparation !== undefined && !storyContextBindingMatches(requiredContext, request.storyPreparation)) {
        throw vnextProposalFailure("STORY_IDENTITY_CONFLICT");
      }
      const selectionContext = request.storyPreparation?.selectionContext ?? requiredContext;
      const hasPreparedLibrary = storyLibraryCatalog(selectionContext)?.offers.some(offer => offer.status === "ready") === true;
      let storyPreparation = request.storyPreparation;
      async function boundInvocation(ordinal: 1 | 2 | 3 | 4, repairTicket?: VNextProposalBundleRepairTicket): Promise<AuthoritativeModelBinding> {
        return {
          async run(model, input) {
            if (model !== VNEXT_KP_PROFILE.modelId) throw vnextProposalFailure("PROPOSAL_PROVIDER_CONFIGURATION");
            const invocationKind = repairTicket === undefined ? "initial"
              : repairTicket.validationCode === "PROPOSAL_RULES_DIAGNOSTIC" ? "mechanicalRepair" : "schemaRepair";
            const stage = ordinal === 1 ? "offer" : repairTicket === undefined ? "expandedProposal"
              : vnextProposalTicketIsEmptyDraft(repairTicket) ? "reemit" : "correction";
            const assembled = assembleProviderInvocation({
              providerBody: deepSeekRequestBody(model, input) as JsonRecord,
              invocationKind, ledger: INITIAL_REPAIR_LEDGER,
              budgetProfile: hasPreparedLibrary || ordinal > 1 && storyPreparation !== undefined
                ? VNEXT_STORY_PROVIDER_BUDGET : VNEXT_PROVIDER_BUDGET,
            });
            if (assembled.kind === "blocked") throw vnextProposalFailure(assembled.code);
            const started = await options.journal.begin(request.preparedActionId, {
              ordinal, contextHash: (ordinal === 1 ? selectionContext : requiredContext).binding.contextHash,
              bindingHash: VNEXT_KP_WORKFLOW_HASH, requestHash: assembled.requestHash,
              request: assembled.providerBody, ...(repairTicket === undefined ? {} : { repairTicket }),
            });
            if (started.kind === "completed") { responses.set(ordinal, started.response); return started.response; }
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
            responses.set(ordinal, response);
            emit(() => ({ result: "success", durationMs: Date.now() - at,
              responseHash: canonicalHash(response),
              ...(isPlainRecord(response) && isPlainRecord(response.usage)
                ? { inputTokens: numericUsage(response.usage.prompt_tokens), outputTokens: numericUsage(response.usage.completion_tokens),
                  cacheHitTokens: numericUsage(response.usage.prompt_cache_hit_tokens),
                  cacheMissTokens: numericUsage(response.usage.prompt_cache_miss_tokens) } : {}) }));
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
      let message = JSON.stringify({ requiredContext: proposalModelContext(selectionContext) });
      const offer = await invokeVNextProposalOffer({
        binding: await boundInvocation(1), modelId: VNEXT_KP_PROFILE.modelId,
        message, requiredContext: selectionContext,
      });
      // Selection and proposal reuse one frozen context. The first response
      // is durable and never becomes an alternative decision on retry.
      if (offer.kind === "rejected") throw vnextProposalFailure(offer.code, false, undefined,
        { issues: offer.issues, diagnostics: offer.diagnostics });
      if (offer.story !== undefined) {
        if (options.prepareStory === undefined) throw vnextProposalFailure("STORY_CAPABILITY_UNSUPPORTED");
        const prepared = await options.prepareStory(request.preparedActionId);
        if (prepared.kind !== "ready") throw vnextProposalFailure(prepared.code, prepared.kind === "waiting");
        if (!storyContextBindingMatches(prepared.context, prepared.binding)
          || canonicalHash(prepared.binding.selectionContext) !== canonicalHash(selectionContext)) {
          throw vnextProposalFailure("STORY_IDENTITY_CONFLICT");
        }
        requiredContext = prepared.context;
        storyPreparation = prepared.binding;
      } else if (request.storyPreparation !== undefined) throw vnextProposalFailure("STORY_IDENTITY_CONFLICT");
      // The filling rounds are sent the frozen context less the bystander views
      // the selection did not name; Room and lowering keep the whole context.
      const npcRefs = offer.npcRefs, knowledgeRefs = offer.knowledgeRefs;
      message = JSON.stringify({ requiredContext: proposalModelContext(requiredContext, npcRefs, knowledgeRefs) });
      const submit = async (ordinal: 2 | 3, capabilities: readonly VNextProposalCapabilityId[],
        terminalKinds: readonly string[], amendable: boolean, selectedNpcRefs: readonly string[], selectedKnowledgeRefs: readonly string[]) =>
        invokeSubmitKpProposalBundleFirstPass({ binding: await boundInvocation(ordinal),
          modelId: VNEXT_KP_PROFILE.modelId, message, requiredContext, capabilities, terminalKinds, amendable,
          npcRefs: selectedNpcRefs, knowledgeRefs: selectedKnowledgeRefs });
      const budgetExhausted = (constraint: string, code: string,
        issues: readonly string[], diagnostics: readonly ProposalDiagnostic[], calls: number): never => {
        throw vnextProposalFailure(code, false, undefined, {
          issues: [...issues, constraint],
          diagnostics: [...diagnostics, proposalDiagnostic("REPAIR_OUT_OF_SCOPE", constraint, {
            expected: { maximumCalls: calls }, actual: { callsUsed: calls },
            repair: { allowed: false, reason: "terminal-selection-and-proposal-use-the-two-call-budget" },
          })],
        });
      };
      // One settlement path for the ordinary proposal and for the amended one.
      // `last` is the call this selection may still spend; a terminal-only
      // selection has none, so an unparsed or repairable draft fails closed.
      const settle = async (result: Awaited<ReturnType<typeof submit>>,
        capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[],
        last: 3 | 4, selectedNpcRefs: readonly string[], selectedKnowledgeRefs: readonly string[]): Promise<VNextProposalBundle> => {
        if (request.attempt === 2 && result.kind !== "locallyAccepted") {
          // A local revision or re-emit already spent this selection's one
          // remaining call. Rules cannot open another revision afterwards.
          const diagnostics = authorityProposalDiagnostics(request.diagnostics);
          throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED", false, undefined,
            { issues: diagnostics.map(detail => detail.constraint), diagnostics });
        }
        if (result.kind === "amendmentRequested") throw vnextProposalFailure("PROPOSAL_FORM_INVALID", false, undefined, {
          issues: ["selection:amendment-already-used"],
          diagnostics: [proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "selection:amendment-already-used", {
            repair: { allowed: false, reason: "selection-is-amendable-once" } })] });
        if (result.kind === "repairRequired") {
          if (!(result.repairTicket.sourceDraft === null || Object.keys(result.repairTicket.sourceDraft).length === 0
            ? vnextProposalHasThirdCallBudget(capabilities) : vnextProposalHasExecutionRepairBudget(result.repairTicket.draft, capabilities))) {
            budgetExhausted("repair:terminal-selection-call-budget-exhausted", "PROPOSAL_REPAIR_EXHAUSTED",
              result.repairTicket.issues, result.repairTicket.diagnostics, last - 1);
          }
          const corrected = await invokeCorrectKpProposalBundle({ binding: await boundInvocation(last, result.repairTicket),
            modelId: VNEXT_KP_PROFILE.modelId, requiredContext, repairTicket: result.repairTicket });
          if (corrected.kind === "rejected") throw vnextProposalFailure(corrected.code, false, undefined,
            { issues: corrected.issues, diagnostics: corrected.diagnostics });
          return corrected.bundle;
        }
        if (result.kind === "rejected") throw vnextProposalFailure(result.code, false, undefined,
          { issues: result.issues, diagnostics: result.diagnostics });
        if (request.attempt === 2) {
          const diagnostics = authorityProposalDiagnostics(request.diagnostics);
          if (request.priorProposal === undefined || canonicalHash(request.priorProposal) !== result.bundleHash
            || diagnostics.length === 0) throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED");
          if (!vnextProposalHasExecutionRepairBudget(result.bundle as unknown as JsonRecord, capabilities)) {
            budgetExhausted("repair:terminal-selection-call-budget-exhausted", "PROPOSAL_REPAIR_EXHAUSTED",
              diagnostics.map(detail => detail.constraint), diagnostics, last - 1);
          }
          const repairTicket = createVNextAuthorityRevisionTicket(responses.get(last - 1), requiredContext,
            capabilities, terminalKinds, diagnostics, selectedNpcRefs, selectedKnowledgeRefs);
          const corrected = await invokeCorrectKpProposalBundle({ binding: await boundInvocation(last, repairTicket),
            modelId: VNEXT_KP_PROFILE.modelId, requiredContext, repairTicket });
          if (corrected.kind === "rejected") throw vnextProposalFailure(corrected.code, false, undefined,
            { issues: corrected.issues, diagnostics: corrected.diagnostics });
          return corrected.bundle;
        }
        return result.bundle;
      };
      // What the selection asked for and what the filled Bundle actually used
      // are recorded side by side: a capability selected and then dropped at
      // filling (round78/80/81 lost "observe" this way) must leave a trace.
      const traced = (bundle: VNextProposalBundle, capabilities: readonly VNextProposalCapabilityId[],
        terminalKinds: readonly string[], selectedNpcRefs: readonly string[], selectedKnowledgeRefs: readonly string[]): VNextProposalBundle => {
        try {
          const used = new Set<string>();
          for (const entry of bundle.proposals) { const id = vnextProposalCapabilityForEntry(entry); if (id !== undefined) used.add(id); }
          if (bundle.terminal !== null) used.add(bundle.terminal.kind);
          const selected = [...capabilities, ...terminalKinds];
          options.onInvocation?.({ eventName: "kp.vnext.selection", preparedActionId: request.preparedActionId,
            rootActionId: request.rootActionId, contextHash: requiredContext.binding.contextHash,
            selected, used: selected.filter(id => used.has(id)), unused: selected.filter(id => !used.has(id)),
            npcRefs: selectedNpcRefs, knowledgeRefs: selectedKnowledgeRefs, npcRecall: proposalNpcRecall(requiredContext) });
        } catch { /* telemetry cannot change the accepted Bundle */ }
        return bundle;
      };
      const first = await submit(2, offer.capabilities, offer.terminalKinds, true, npcRefs, knowledgeRefs);
      if (first.kind !== "amendmentRequested") return traced(await settle(first, offer.capabilities, offer.terminalKinds, 3, npcRefs, knowledgeRefs), offer.capabilities, offer.terminalKinds, npcRefs, knowledgeRefs);
      // Selection is amended by union once: operations, terminals, bystander
      // views and unread memories together. The frozen context is unchanged;
      // the amended round is sent the enlarged view and cannot amend again.
      const { amendedCapabilities, amendedTerminalKinds, amendedNpcRefs, amendedKnowledgeRefs } = first.amendment;
      message = JSON.stringify({ requiredContext: proposalModelContext(requiredContext, amendedNpcRefs, amendedKnowledgeRefs) });
      return traced(await settle(await submit(3, amendedCapabilities, amendedTerminalKinds, false, amendedNpcRefs, amendedKnowledgeRefs),
        amendedCapabilities, amendedTerminalKinds, 4, amendedNpcRefs, amendedKnowledgeRefs), amendedCapabilities, amendedTerminalKinds, amendedNpcRefs, amendedKnowledgeRefs);
    },
    narrate: options.narrationAdapter.narrate,
    decideDueActorPlan: options.narrationAdapter.decideDueActorPlan,
    decidePendingInput: options.narrationAdapter.decidePendingInput,
  };
}

function numericUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
