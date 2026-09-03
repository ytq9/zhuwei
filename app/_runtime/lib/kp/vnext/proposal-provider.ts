import type { AuthoritativeModelBinding } from "../authoritative-types";
import {
  ModelOutputValidationError,
  extractSingleToolCall,
} from "../authoritative-helpers";
import {
  canonicalClone,
  canonicalHash,
  deepFreeze,
  isPlainRecord,
  parseJsonWithUniqueMembers,
  type JsonRecord,
} from "./canonical-json";
import {
  CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  VNEXT_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
  createCorrectKpProposalBundleModelInput,
  createSubmitKpProposalBundleModelInput,
  decodeVNextStrictToolBundle,
  type VNextBundleCorrection,
  type VNextProposalBundle,
} from "./proposal-schema";
import {
  applyVNextProposalBundleCorrection,
  repairableVNextProposalBundlePaths,
} from "./proposal-correction";
import type { VNextRequiredContext } from "./required-context";
import { validateVNextProposalBundle } from "./proposal-validator";

export const VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT = Object.freeze({
  version: "kp-vnext2-proposal-parser-v4",
  toolName: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  bundleSchema: VNEXT_PROPOSAL_BUNDLE_SCHEMA,
  correctionToolName: CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME,
  correctionSchema: CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA,
  sentinelVersion: "none-v1",
  requiresExactToolCall: true,
  allowsTextFallback: false,
  rejectsDuplicateJsonMembersAtEveryDepth: true,
  injectsBundleAndCorrectionEnvelopes: true,
  localValidation: "closed-domain-and-dependency-v1",
  correctionPolicy: "persisted-repair-ticket-summary-only-once-v2",
});

export const VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA =
  "zhuwei.kp-proposal-bundle-repair-ticket/vnext-1" as const;

export const VNEXT_PROPOSAL_BUNDLE_PARSER_HASH = canonicalHash(
  VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT,
);

export class VNextProposalBundleOutputError extends ModelOutputValidationError {
  constructor() {
    super();
    this.name = "VNextProposalBundleOutputError";
  }
}

export type VNextProposalBundleCandidate =
  | Readonly<{
      kind: "accepted";
      bundle: VNextProposalBundle;
      bundleHash: string;
    }>
  | Readonly<{
      kind: "locallyRejected";
      draft: Readonly<JsonRecord>;
      bundleHash: string;
      validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID";
      issues: readonly string[];
    }>;

export type VNextProposalBundleProviderResult =
  | Readonly<{
      /** The strict form and closed local domain checks passed. The Room-side
       * lowerer must still bind authority, preflight Rules and commit it. */
      kind: "locallyAccepted";
      bundle: VNextProposalBundle;
      bundleHash: string;
      repairUsed: boolean;
      invocationCount: 1 | 2;
    }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_FORM_INVALID" | "PROPOSAL_REPAIR_EXHAUSTED";
      issues: readonly string[];
      repairUsed: boolean;
      invocationCount: 1 | 2;
    }>;

export type VNextProposalBundleRepairTicket = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA;
  draft: Readonly<JsonRecord>;
  bundleHash: string;
  contextHash: string;
  validationCode: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID";
  issues: readonly string[];
  allowedPaths: readonly (readonly (string | number)[])[];
  ticketHash: string;
}>;

export type VNextProposalBundleFirstPassResult =
  | Extract<VNextProposalBundleProviderResult, { kind: "locallyAccepted" }>
  | Extract<VNextProposalBundleProviderResult, { kind: "rejected" }>
  | Readonly<{
      kind: "repairRequired";
      repairTicket: VNextProposalBundleRepairTicket;
      invocationCount: 1;
    }>;

export function parseSubmitKpProposalBundleCandidateArguments(
  value: unknown,
): VNextProposalBundleCandidate {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = parseJsonWithUniqueMembers(raw);
    } catch {
      return invalidOutput();
    }
  }
  if (!isPlainRecord(raw) || "schema" in raw || "kind" in raw) return invalidOutput();
  const decoded = decodeVNextStrictToolBundle(raw);
  if (!isPlainRecord(decoded)) return invalidOutput();
  let draft: JsonRecord;
  try {
    draft = canonicalClone({
      ...decoded,
      schema: VNEXT_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
    }) as JsonRecord;
  } catch {
    return invalidOutput();
  }
  const validated = validateVNextProposalBundle(draft);
  if (validated.kind === "accepted") {
    return deepFreeze({
      kind: "accepted",
      bundle: validated.bundle,
      bundleHash: canonicalHash(validated.bundle),
    });
  }
  return deepFreeze({
    kind: "locallyRejected",
    draft,
    bundleHash: canonicalHash(draft),
    validationCode: validated.code,
    issues: [...validated.issues],
  });
}

export function parseSubmitKpProposalBundleCandidateResponse(
  response: unknown,
): VNextProposalBundleCandidate {
  let call: ReturnType<typeof extractSingleToolCall>;
  try {
    call = extractSingleToolCall(response);
  } catch {
    return invalidOutput();
  }
  if (call.name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return invalidOutput();
  return parseSubmitKpProposalBundleCandidateArguments(call.arguments);
}

/** Parses only the selected strict tool's arguments; no text/JSON fallback. */
export function parseSubmitKpProposalBundleArguments(
  value: unknown,
): VNextProposalBundle {
  const candidate = parseSubmitKpProposalBundleCandidateArguments(value);
  return candidate.kind === "accepted" ? candidate.bundle : invalidOutput();
}

export function parseSubmitKpProposalBundleResponse(
  response: unknown,
): VNextProposalBundle {
  const candidate = parseSubmitKpProposalBundleCandidateResponse(response);
  return candidate.kind === "accepted" ? candidate.bundle : invalidOutput();
}

export function parseCorrectKpProposalBundleResponse(
  response: unknown,
  binding: Readonly<{ baseBundleHash: string; contextHash: string }>,
): VNextBundleCorrection {
  let call: ReturnType<typeof extractSingleToolCall>;
  try {
    call = extractSingleToolCall(response);
  } catch {
    return invalidOutput();
  }
  if (call.name !== CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME) return invalidOutput();
  let raw: unknown = call.arguments;
  if (typeof raw === "string") {
    try {
      raw = parseJsonWithUniqueMembers(raw);
    } catch {
      return invalidOutput();
    }
  }
  if (!isPlainRecord(raw)
    || !hasExactKeys(raw, ["changes"])
    || !Array.isArray(raw.changes)
    || raw.changes.length < 1
    || raw.changes.length > 8
    || !raw.changes.every((change) => isPlainRecord(change)
      && hasExactKeys(change, ["path", "value"])
      && correctionPathConforms(change.path)
      && typeof change.value === "string")) return invalidOutput();
  try {
    return deepFreeze(canonicalClone({
      schema: VNEXT_PROPOSAL_BUNDLE_CORRECTION_SCHEMA,
      baseBundleHash: binding.baseBundleHash,
      contextHash: binding.contextHash,
      attempt: 1 as const,
      changes: raw.changes,
    }) as VNextBundleCorrection);
  } catch {
    return invalidOutput();
  }
}

export async function invokeSubmitKpProposalBundle(input: Readonly<{
  binding: AuthoritativeModelBinding;
  modelId: string;
  message: string;
  signal?: AbortSignal;
}>): Promise<VNextProposalBundle> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  const response = await input.binding.run(
    input.modelId,
    createSubmitKpProposalBundleModelInput(input.message),
    input.signal === undefined ? undefined : { signal: input.signal },
  );
  return parseSubmitKpProposalBundleResponse(response);
}

/** Runs only the main strict-tool invocation. A repairable rejection becomes
 * a self-validating ticket so the Room can persist it before any second call. */
export async function invokeSubmitKpProposalBundleFirstPass(
  input: Readonly<{
    binding: AuthoritativeModelBinding;
    modelId: string;
    message: string;
    requiredContext: VNextRequiredContext;
    signal?: AbortSignal;
  }>,
): Promise<VNextProposalBundleFirstPassResult> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  if (typeof input.message !== "string" || input.message.trim().length === 0) {
    throw new TypeError("SUBMIT_KP_PROPOSAL_BUNDLE_MESSAGE_REQUIRED");
  }
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || contextHash.length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  }
  const runOptions = input.signal === undefined ? undefined : { signal: input.signal };
  const response = await input.binding.run(
    input.modelId,
    createSubmitKpProposalBundleModelInput(input.message),
    runOptions,
  );
  let candidate: VNextProposalBundleCandidate;
  try {
    candidate = parseSubmitKpProposalBundleCandidateResponse(response);
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      ["proposal:strict-tool-output-invalid"],
      false,
      1,
    );
  }
  if (candidate.kind === "accepted") {
    return deepFreeze({
      kind: "locallyAccepted",
      bundle: candidate.bundle,
      bundleHash: candidate.bundleHash,
      repairUsed: false,
      invocationCount: 1,
    });
  }
  const allowedPaths = repairableVNextProposalBundlePaths(candidate.draft);
  if (allowedPaths.length === 0) {
    return providerRejected(
      "PROPOSAL_FORM_INVALID",
      candidate.issues,
      false,
      1,
    );
  }
  return deepFreeze({
    kind: "repairRequired",
    repairTicket: createRepairTicket(candidate, contextHash, allowedPaths),
    invocationCount: 1,
  });
}

/** Runs the one permitted correction against an already-persisted ticket. */
export async function invokeCorrectKpProposalBundle(input: Readonly<{
  binding: AuthoritativeModelBinding;
  modelId: string;
  requiredContext: VNextRequiredContext;
  repairTicket: VNextProposalBundleRepairTicket;
  signal?: AbortSignal;
}>): Promise<VNextProposalBundleProviderResult> {
  if (typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_MODEL_ID_REQUIRED");
  }
  const contextHash = input.requiredContext?.binding?.contextHash;
  if (typeof contextHash !== "string" || contextHash.length === 0) {
    throw new TypeError("VNEXT_PROPOSAL_CONTEXT_HASH_REQUIRED");
  }
  assertRepairTicket(input.repairTicket, contextHash);
  const candidate = input.repairTicket;
  const correctionPrompt = JSON.stringify({
    instruction: "只修改 allowedPaths 列出的摘要。每个 change 必须使用原样 path 和非空 replacement value。",
    baseBundleHash: candidate.bundleHash,
    contextHash,
    issues: candidate.issues,
    allowedPaths: candidate.allowedPaths,
    rejectedBundle: candidate.draft,
  });
  const runOptions = input.signal === undefined ? undefined : { signal: input.signal };
  const correctionResponse = await input.binding.run(
    input.modelId,
    createCorrectKpProposalBundleModelInput(correctionPrompt),
    runOptions,
  );
  let correction: VNextBundleCorrection;
  try {
    correction = parseCorrectKpProposalBundleResponse(correctionResponse, {
      baseBundleHash: candidate.bundleHash,
      contextHash,
    });
  } catch (error) {
    if (!(error instanceof VNextProposalBundleOutputError)) throw error;
    return providerRejected(
      "PROPOSAL_REPAIR_EXHAUSTED",
      ["proposal:correction-tool-output-invalid"],
      true,
      2,
    );
  }
  const repaired = applyVNextProposalBundleCorrection({
    bundle: candidate.draft,
    correction,
    requiredContext: input.requiredContext,
    allowedPaths: candidate.allowedPaths,
  });
  if (repaired.kind === "rejected") {
    return providerRejected(
      "PROPOSAL_REPAIR_EXHAUSTED",
      repaired.issues,
      true,
      2,
    );
  }
  return deepFreeze({
    kind: "locallyAccepted",
    bundle: repaired.bundle,
    bundleHash: repaired.bundleHash,
    repairUsed: true,
    invocationCount: 2,
  });
}

/** Convenience orchestration that makes durable persistence an explicit gate
 * between the only main call and the optional correction call. */
export async function invokeSubmitKpProposalBundleWithOneCorrection(
  input: Readonly<{
    binding: AuthoritativeModelBinding;
    modelId: string;
    message: string;
    requiredContext: VNextRequiredContext;
    persistRepairTicket: (ticket: VNextProposalBundleRepairTicket) => void | Promise<void>;
    signal?: AbortSignal;
  }>,
): Promise<VNextProposalBundleProviderResult> {
  if (typeof input.persistRepairTicket !== "function") {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_PERSISTENCE_REQUIRED");
  }
  const firstPass = await invokeSubmitKpProposalBundleFirstPass(input);
  if (firstPass.kind !== "repairRequired") return firstPass;
  await input.persistRepairTicket(firstPass.repairTicket);
  return invokeCorrectKpProposalBundle({
    binding: input.binding,
    modelId: input.modelId,
    requiredContext: input.requiredContext,
    repairTicket: firstPass.repairTicket,
    signal: input.signal,
  });
}

function createRepairTicket(
  candidate: Extract<VNextProposalBundleCandidate, { kind: "locallyRejected" }>,
  contextHash: string,
  allowedPaths: readonly (readonly (string | number)[])[],
): VNextProposalBundleRepairTicket {
  const body = canonicalClone({
    schema: VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA,
    draft: candidate.draft,
    bundleHash: candidate.bundleHash,
    contextHash,
    validationCode: candidate.validationCode,
    issues: candidate.issues,
    allowedPaths,
  }) as Omit<VNextProposalBundleRepairTicket, "ticketHash">;
  return deepFreeze({ ...body, ticketHash: canonicalHash(body) });
}

function assertRepairTicket(ticket: unknown, contextHash: string): asserts ticket is VNextProposalBundleRepairTicket {
  if (!isPlainRecord(ticket)
    || !hasExactKeys(ticket, [
      "allowedPaths", "bundleHash", "contextHash", "draft", "issues", "schema",
      "ticketHash", "validationCode",
    ])
    || ticket.schema !== VNEXT_PROPOSAL_BUNDLE_REPAIR_TICKET_SCHEMA
    || ticket.contextHash !== contextHash
    || !isPlainRecord(ticket.draft)
    || ticket.bundleHash !== canonicalHash(ticket.draft)
    || (ticket.validationCode !== "PROPOSAL_BUNDLE_INVALID"
      && ticket.validationCode !== "BUNDLE_DEPENDENCY_INVALID")
    || !Array.isArray(ticket.issues)
    || !ticket.issues.every((issue) => typeof issue === "string" && issue.length > 0)
    || !Array.isArray(ticket.allowedPaths)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  const allowedPaths = repairableVNextProposalBundlePaths(ticket.draft);
  if (canonicalHash(allowedPaths) !== canonicalHash(ticket.allowedPaths)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  const validation = validateVNextProposalBundle(ticket.draft);
  if (validation.kind !== "rejected"
    || validation.code !== ticket.validationCode
    || canonicalHash(validation.issues) !== canonicalHash(ticket.issues)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
  const { ticketHash, ...body } = ticket;
  if (typeof ticketHash !== "string" || ticketHash !== canonicalHash(body)) {
    throw new TypeError("VNEXT_PROPOSAL_REPAIR_TICKET_INVALID");
  }
}

function correctionPathConforms(value: unknown): boolean {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 16
    && value.every((segment) => (typeof segment === "string"
      && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(segment))
      || (Number.isSafeInteger(segment) && Number(segment) >= 0));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}

function providerRejected(
  code: Extract<VNextProposalBundleProviderResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
  repairUsed: boolean,
  invocationCount: 1 | 2,
): Extract<VNextProposalBundleProviderResult, { kind: "rejected" }> {
  return deepFreeze({
    kind: "rejected",
    code,
    issues: [...new Set(issues)].sort(),
    repairUsed,
    invocationCount,
  });
}

function invalidOutput(): never {
  throw new VNextProposalBundleOutputError();
}
