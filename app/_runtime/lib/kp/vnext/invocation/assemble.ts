import {
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isNonEmptyString,
  type JsonRecord,
  type JsonValue,
} from "../canonical-json";
import type { VNextRequiredContext } from "../required-context";
import {
  evaluateInputBudget,
  VNEXT_PROPOSAL_BUDGET,
  type BudgetReceipt,
  type ProviderBudgetProfile,
} from "./budget";

/**
 * Why a request is being sent, not how many have been sent.
 *
 * SPEC 0015 §6.1 freezes the budget at one initial call plus at most one narrow
 * repair: `initial`, `initial → schemaRepair`, or `initial → mechanicalRepair`.
 * `initial → schemaRepair → mechanicalRepair` is not a longer path, it is a
 * third full prompt and is forbidden.
 */
export type InvocationKind = "initial" | "schemaRepair" | "mechanicalRepair";
export type InvocationOrdinal = 1 | 2;

/**
 * Server-held repair accounting.
 *
 * The V3 proposal carried `repairUsed` in the model's own output and Room
 * stopped on it. A vNext Proposal is an exact-key schema with no such field,
 * and it should not have one: how many calls remain is the server's fact about
 * its own budget, not a claim the model gets to make about itself.
 */
export type RepairLedger = Readonly<{
  repairConsumed: boolean;
}>;

export const INITIAL_REPAIR_LEDGER: RepairLedger = Object.freeze({ repairConsumed: false });

export function consumeRepair(ledger: RepairLedger): RepairLedger {
  if (ledger.repairConsumed) throw new TypeError("ledger:repair-already-consumed");
  return Object.freeze({ repairConsumed: true });
}

export type ProposalInvocationInput = Readonly<{
  context: VNextRequiredContext;
  systemPrompt: string;
  /** Tool/Form schemas exactly as the provider codec will carry them. */
  formSchemas: readonly JsonRecord[];
  /** Static module material selected for this request. */
  staticMaterial: readonly JsonRecord[];
  invocationKind: InvocationKind;
  ledger: RepairLedger;
  /** Repair calls only. Present on an initial call is a contract error. */
  diagnostics?: JsonValue;
  priorProposal?: JsonValue;
  budgetProfile?: ProviderBudgetProfile;
}>;

/**
 * Evidence about one assembled request. `providerRunCount` is stamped by
 * whoever actually calls the provider; a blocked assembly can never be turned
 * into a receipt claiming otherwise (see `proposalInvocationReceipt`).
 */
export type ProposalInvocationReceipt = Readonly<{
  invocationKind: InvocationKind;
  invocationOrdinal: InvocationOrdinal;
  contextHash: string;
  requestHash: string;
  budgetProfileHash: string;
  budgetDecision: BudgetReceipt["decision"];
  providerRunCount: 0 | 1;
  modelInvocationReceipt?: JsonValue;
}>;

export type ProposalInvocationResult =
  | Readonly<{
      kind: "ready";
      providerBody: JsonRecord;
      requestHash: string;
      budgetReceipt: BudgetReceipt;
      invocationKind: InvocationKind;
      invocationOrdinal: InvocationOrdinal;
    }>
  | Readonly<{
      kind: "blocked";
      code:
        | "PROPOSAL_INPUT_BUDGET_EXCEEDED"
        | "PROPOSAL_REPAIR_EXHAUSTED"
        | "PROPOSAL_FORM_INVALID";
      budgetReceipt?: BudgetReceipt;
      issues: readonly string[];
    }>;

/**
 * Assembles exactly the body that will be sent, then measures that body.
 *
 * Nothing here calls a provider, and nothing downstream may edit the body
 * afterwards: the request that was measured and the request that is sent are
 * the same object, identified by `requestHash`. Re-assembling identical inputs
 * reproduces that hash, which is what lets a transport retry resend the same
 * request rather than a newly built lookalike.
 */
export function assembleProposalInvocation(
  input: ProposalInvocationInput,
): ProposalInvocationResult {
  const ordinal: InvocationOrdinal = input.invocationKind === "initial" ? 1 : 2;
  const repair = input.invocationKind !== "initial";

  if (!isNonEmptyString(input.systemPrompt)) {
    return blocked("PROPOSAL_FORM_INVALID", ["systemPrompt:non-empty-string-required"]);
  }
  if (input.formSchemas.length === 0) {
    return blocked("PROPOSAL_FORM_INVALID", ["formSchemas:non-empty-required"]);
  }
  if (repair && (input.diagnostics === undefined || input.priorProposal === undefined)) {
    return blocked("PROPOSAL_FORM_INVALID", ["repair:diagnostics-and-prior-proposal-required"]);
  }
  if (!repair && (input.diagnostics !== undefined || input.priorProposal !== undefined)) {
    return blocked("PROPOSAL_FORM_INVALID", ["initial:repair-metadata-forbidden"]);
  }
  // The second call is the last one whatever its reason. A schema repair
  // followed by a mechanical repair is a third full prompt, not a longer
  // narrow one.
  if (repair && input.ledger.repairConsumed) {
    return blocked("PROPOSAL_REPAIR_EXHAUSTED", ["ledger:repair-already-consumed"]);
  }

  let providerBody: JsonRecord;
  try {
    providerBody = deepFreeze(canonicalClone({
      schema: VNEXT_PROPOSAL_REQUEST_SCHEMA,
      invocationKind: input.invocationKind,
      invocationOrdinal: ordinal,
      systemPrompt: input.systemPrompt.normalize("NFC"),
      formSchemas: [...input.formSchemas],
      staticMaterial: [...input.staticMaterial],
      requiredContext: input.context,
      ...(repair
        ? { repair: { diagnostics: input.diagnostics!, priorProposal: input.priorProposal! } }
        : {}),
    })) as JsonRecord;
  } catch {
    return blocked("PROPOSAL_FORM_INVALID", ["providerBody:not-canonical-json"]);
  }

  const profile = input.budgetProfile ?? VNEXT_PROPOSAL_BUDGET;
  // Measured against the serialized body a provider codec will carry, not
  // against the context alone.
  const budgetReceipt = evaluateInputBudget(JSON.stringify(providerBody), profile);
  if (budgetReceipt.decision === "blocked") {
    return Object.freeze({
      kind: "blocked",
      code: "PROPOSAL_INPUT_BUDGET_EXCEEDED",
      budgetReceipt,
      issues: Object.freeze([
        `estimatedInputTokens:${budgetReceipt.estimatedInputTokens}`,
        `allowedInputTokens:${budgetReceipt.allowedInputTokens}`,
      ]),
    });
  }

  return Object.freeze({
    kind: "ready",
    providerBody,
    requestHash: canonicalHash(providerBody),
    budgetReceipt,
    invocationKind: input.invocationKind,
    invocationOrdinal: ordinal,
  });
}

export const VNEXT_PROPOSAL_REQUEST_SCHEMA = "zhuwei.proposal-request/vnext-1" as const;

/**
 * Builds the receipt for one invocation. A blocked assembly yields
 * `providerRunCount: 0` and carries no `modelInvocationReceipt`: a request that
 * never reached a provider must not be able to present evidence of a call, or
 * a budget refusal would be indistinguishable from a provider timeout.
 */
export function proposalInvocationReceipt(input: Readonly<{
  contextHash: string;
  assembled: ProposalInvocationResult;
  invocationKind: InvocationKind;
  invocationOrdinal: InvocationOrdinal;
  budgetProfileHash: string;
  modelInvocationReceipt?: JsonValue;
}>): ProposalInvocationReceipt {
  if (input.assembled.kind === "blocked") {
    if (input.modelInvocationReceipt !== undefined) {
      throw new TypeError("receipt:blocked-invocation-cannot-carry-model-receipt");
    }
    return Object.freeze({
      invocationKind: input.invocationKind,
      invocationOrdinal: input.invocationOrdinal,
      contextHash: input.contextHash,
      requestHash: "",
      budgetProfileHash: input.budgetProfileHash,
      budgetDecision: input.assembled.budgetReceipt?.decision ?? "blocked",
      providerRunCount: 0,
    });
  }
  return Object.freeze({
    invocationKind: input.invocationKind,
    invocationOrdinal: input.invocationOrdinal,
    contextHash: input.contextHash,
    requestHash: input.assembled.requestHash,
    budgetProfileHash: input.budgetProfileHash,
    budgetDecision: input.assembled.budgetReceipt.decision,
    providerRunCount: input.modelInvocationReceipt === undefined ? 0 : 1,
    ...(input.modelInvocationReceipt === undefined
      ? {}
      : { modelInvocationReceipt: input.modelInvocationReceipt }),
  });
}

function blocked(
  code: Extract<ProposalInvocationResult, { kind: "blocked" }>["code"],
  issues: readonly string[],
): ProposalInvocationResult {
  return Object.freeze({
    kind: "blocked",
    code,
    issues: Object.freeze([...issues].sort(compareCodeUnits)),
  });
}
