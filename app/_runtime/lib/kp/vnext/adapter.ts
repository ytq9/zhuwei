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
  vnextProposalCorrectionAdmitted, vnextProposalDraftReply, VNEXT_PROPOSAL_CORRECTION_ROUNDS,
  type VNextProposalBundleRepairTicket, vnextProposalTicketIsEmptyDraft } from "./proposal-provider";
import type { VNextProposalBundle } from "./proposal-schema";
import { vnextProposalCapabilityForEntry, type VNextProposalCapabilityId } from "./proposal-capabilities";
import type { VNextRequiredContext } from "./required-context";
import { proposalNpcRecall, vnextProposalContextBody } from "./proposal-context";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_HASH, VNEXT_PROVIDER_BUDGET, VNEXT_STORY_PROVIDER_BUDGET } from "./runtime-policy";

type VNextProposalRequest = {
  preparedActionId: string;
  rootActionId: string;
  requiredContext?: unknown;
  storyPreparation?: StoryPreparationBinding;
  attempt: number;
  diagnostics?: unknown;
  priorProposal?: unknown;
  rulesRejections?: readonly Readonly<{ priorProposal: unknown; diagnostics: unknown }>[];
};

/** The Rules rejections Room has returned for this action, in order, each
 * as the hash of the proposal it rejected and its diagnostics. An older Room
 * sends only the newest as `priorProposal` and `diagnostics`. */
function rulesRejectionsOf(request: VNextProposalRequest): readonly Readonly<{ bundleHash: string; diagnostics: readonly ProposalDiagnostic[] }>[] {
  const entries = Array.isArray(request.rulesRejections) ? request.rulesRejections
    : request.priorProposal === undefined ? [] : [{ priorProposal: request.priorProposal, diagnostics: request.diagnostics }];
  return entries.map(entry => ({ bundleHash: canonicalHash(entry.priorProposal), diagnostics: authorityProposalDiagnostics(entry.diagnostics) }));
}

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
      const rulesRejections = rulesRejectionsOf(request);
      if (!Number.isInteger(request.attempt) || request.attempt !== 1 + rulesRejections.length
        || request.attempt > 1 + VNEXT_PROPOSAL_CORRECTION_ROUNDS) throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED");
      let requiredContext = request.requiredContext as unknown as VNextRequiredContext;
      const responses = new Map<number, unknown>();
      if (request.storyPreparation !== undefined && !storyContextBindingMatches(requiredContext, request.storyPreparation)) {
        throw vnextProposalFailure("STORY_IDENTITY_CONFLICT");
      }
      const selectionContext = request.storyPreparation?.selectionContext ?? requiredContext;
      const hasPreparedLibrary = storyLibraryCatalog(selectionContext)?.offers.some(offer => offer.status === "ready") === true;
      let storyPreparation = request.storyPreparation;
      async function boundInvocation(ordinal: VNextInvocationRequest["ordinal"], repairTicket?: VNextProposalBundleRepairTicket): Promise<AuthoritativeModelBinding> {
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
                ...(repairTicket === undefined ? {} : { correctionRound: repairTicket.round }),
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
      let message = vnextProposalContextBody(selectionContext);
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
      message = vnextProposalContextBody(requiredContext, npcRefs, knowledgeRefs);
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
      // `first` is the ordinal the first correction would take; the rounds of
      // one conversation follow it, each proved by Room from the saved bytes.
      // A terminal-only selection has no correction call at all, so an
      // unparsed or repairable draft fails closed there.
      const settle = async (result: Awaited<ReturnType<typeof submit>>,
        capabilities: readonly VNextProposalCapabilityId[], terminalKinds: readonly string[],
        first: 3 | 4, selectedNpcRefs: readonly string[], selectedKnowledgeRefs: readonly string[]): Promise<VNextProposalBundle> => {
        // Both are unreachable here: every round that reaches settle was sent
        // without the selection tool, so it cannot be amended or repeated.
        if (result.kind === "amendmentRequested" || result.kind === "selectionRepeated") throw vnextProposalFailure("PROPOSAL_FORM_INVALID", false, undefined, {
          issues: ["selection:amendment-already-used"],
          diagnostics: [proposalDiagnostic("REPAIR_OUT_OF_SCOPE", "selection:amendment-already-used", {
            repair: { allowed: false, reason: "selection-is-amendable-once" } })] });
        if (result.kind === "rejected") throw vnextProposalFailure(result.code, false, undefined,
          { issues: result.issues, diagnostics: result.diagnostics });
        const exhausted = (diagnostics: readonly ProposalDiagnostic[]): never => { throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED", false, undefined,
          { issues: diagnostics.map(detail => detail.constraint), diagnostics }); };
        const invocationOrdinal = (value: number): VNextInvocationRequest["ordinal"] => {
          if (![1, 2, 3, 4, 5, 6].includes(value)) throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED");
          return value as VNextInvocationRequest["ordinal"];
        };
        const chain: VNextProposalBundleRepairTicket[] = [];
        let pending: VNextProposalBundleRepairTicket | undefined = result.kind === "repairRequired" ? result.repairTicket : undefined;
        let accepted: { bundle: VNextProposalBundle; bundleHash: string; reply: unknown } | undefined =
          result.kind === "locallyAccepted" ? { bundle: result.bundle, bundleHash: result.bundleHash, reply: responses.get(first - 1) } : undefined;
        // Each accepted draft the chain reaches must be the next one Rules
        // rejected, and is answered by one more round; the first draft past
        // the rejections is the one that goes to Rules now.
        let answered = 0;
        let ordinal = first;
        for (;;) {
          if (pending !== undefined) {
            if (chain.length === 0 && !(pending.sourceDraft === null || Object.keys(pending.sourceDraft).length === 0
              ? vnextProposalHasThirdCallBudget(capabilities) : vnextProposalHasExecutionRepairBudget(pending.draft, capabilities))) {
              budgetExhausted("repair:terminal-selection-call-budget-exhausted", "PROPOSAL_REPAIR_EXHAUSTED",
                pending.issues, pending.diagnostics, first - 1);
            }
            chain.push(pending);
            const at = invocationOrdinal(ordinal);
            const corrected = await invokeCorrectKpProposalBundle({ binding: await boundInvocation(at, pending),
              modelId: VNEXT_KP_PROFILE.modelId, requiredContext, chain });
            ordinal += 1;
            if (corrected.result.kind === "rejected") throw vnextProposalFailure(corrected.result.code, false, undefined,
              { issues: corrected.result.issues, diagnostics: corrected.result.diagnostics });
            if (corrected.result.kind === "repairRequired") { pending = corrected.result.repairTicket; continue; }
            pending = undefined;
            accepted = { bundle: corrected.result.bundle, bundleHash: corrected.result.bundleHash,
              reply: corrected.synthesis === undefined ? responses.get(at) : vnextProposalDraftReply(corrected.synthesis.draft) };
          }
          if (accepted === undefined) throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED");
          if (answered === rulesRejections.length) return accepted.bundle;
          const rejection = rulesRejections[answered]!;
          const diagnostics = rejection.diagnostics;
          if (rejection.bundleHash !== accepted.bundleHash || diagnostics.length === 0) throw vnextProposalFailure("PROPOSAL_REPAIR_EXHAUSTED");
          if (!vnextProposalHasExecutionRepairBudget(accepted.bundle as unknown as JsonRecord, capabilities)) {
            budgetExhausted("repair:terminal-selection-call-budget-exhausted", "PROPOSAL_REPAIR_EXHAUSTED",
              diagnostics.map(detail => detail.constraint), diagnostics, first - 1);
          }
          if (chain.length >= VNEXT_PROPOSAL_CORRECTION_ROUNDS) exhausted(diagnostics);
          const repairTicket = createVNextAuthorityRevisionTicket(accepted.reply, requiredContext,
            capabilities, terminalKinds, diagnostics, selectedNpcRefs, selectedKnowledgeRefs, chain.length + 1);
          if (!vnextProposalCorrectionAdmitted([...chain, repairTicket])) exhausted(diagnostics);
          answered += 1;
          pending = repairTicket;
          accepted = undefined;
        }
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
      // Calling the selection tool while adding nothing has neither amended nor
      // filled. The selection it repeated is the one this round already held,
      // so the call an amendment would have spent re-sends the same request
      // without that tool, where the reply can only be the form.
      if (first.kind === "selectionRepeated") {
        return traced(await settle(await submit(3, offer.capabilities, offer.terminalKinds, false, npcRefs, knowledgeRefs),
          offer.capabilities, offer.terminalKinds, 4, npcRefs, knowledgeRefs), offer.capabilities, offer.terminalKinds, npcRefs, knowledgeRefs);
      }
      if (first.kind !== "amendmentRequested") return traced(await settle(first, offer.capabilities, offer.terminalKinds, 3, npcRefs, knowledgeRefs), offer.capabilities, offer.terminalKinds, npcRefs, knowledgeRefs);
      // Selection is amended by union once: operations, terminals, bystander
      // views and unread memories together. The frozen context is unchanged;
      // the amended round is sent the enlarged view and cannot amend again.
      const { amendedCapabilities, amendedTerminalKinds, amendedNpcRefs, amendedKnowledgeRefs } = first.amendment;
      message = vnextProposalContextBody(requiredContext, amendedNpcRefs, amendedKnowledgeRefs);
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
