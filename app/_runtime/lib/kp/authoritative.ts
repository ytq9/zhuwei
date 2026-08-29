import {
  AUTHORITATIVE_KP_PROFILE,
  authoritativeKpProfileByBinding,
  isV3AuthoritativeKpProfile,
  NARRATION_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
  narrationModelInput,
  narrationSchemaCorrectionModelInput,
  proposalModelInput,
  proposalSchemaCorrectionModelInput,
} from "./authoritative-policy";
import {
  compileKpFormDraft,
  lowerCausalActionProgram,
  stableStructuralHash,
} from "./causal-action-program";
import {
  KP_FORM_IDS,
  selectAllowedKpForms,
  validateKpFormDraft,
  validateKpFormModelEnvelope,
  type KpFormId,
} from "./form-catalog";
import {
  bodyOnlyNarrationModelInput,
  validateBodyOnlyNarrationOutput,
} from "./narration-v3";
import {
  PRIVATE_FORM_PROPOSAL_TOOL_NAME,
  privateFormProposalModelInput,
  privateFormRepairModelInput,
  type FiniteReferenceCatalog,
} from "./private-form-policy";
import {
  ACTOR_PLAN_DECISION_TOOL_NAME,
  actorPlanDecisionModelInput,
  validateActorPlanDecisionOutput,
} from "./actor-plan-policy";
import { buildV3ContextPack, v3FormSelectionSignals } from "./v3-context-runtime";
import {
  ModelInvocationTimeoutError,
  ModelOutputValidationError,
  NarrationGroundingValidationError,
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
  DueActorPlanDecisionRequest,
  V3AuthoritativeKpProposal,
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
  DueActorPlanDecision,
  DueActorPlanDecisionRequest,
  V3AuthoritativeKpProposal,
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

function validateV3ProposalRequest(request: KpProposalRequest): void {
  requiredString(request.preparedActionId);
  requiredString(request.rootActionId);
  if (!Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > 2) {
    throw new ModelOutputValidationError();
  }
  if (!isRecord(request.input) || !isRecord(request.projection)) {
    throw new ModelOutputValidationError();
  }
  if (request.attempt === 2 && (request.diagnostics === undefined || !isRecord(request.priorProposal))) {
    throw new ModelOutputValidationError();
  }
}

type PrivateFormEnvelope = {
  formId: KpFormId;
  draft: Record<string, unknown>;
};

class PrivateFormEnvelopeError extends Error {
  readonly candidate: unknown;
  readonly errors: readonly string[];

  constructor(candidate: unknown, errors: readonly string[]) {
    super("Private KP Form output is invalid.");
    this.name = "PrivateFormEnvelopeError";
    this.candidate = candidate;
    this.errors = errors;
  }
}

function unwrapSingleEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(value);
  const only = keys.length === 1 ? value[keys[0]] : undefined;
  return isRecord(only) ? only : value;
}

function privateFormEnvelope(
  response: unknown,
  allowedForms: readonly KpFormId[],
): PrivateFormEnvelope {
  let structured: Record<string, unknown>;
  try {
    structured = extractStructuredOutput(response, PRIVATE_FORM_PROPOSAL_TOOL_NAME);
  } catch {
    throw new PrivateFormEnvelopeError(null, ["structured-output:invalid"]);
  }
  const candidate = unwrapSingleEnvelope(structured);
  const validation = validateKpFormModelEnvelope(allowedForms, candidate);
  if (!validation.ok || typeof candidate.formId !== "string" || !isRecord(candidate.draft)) {
    throw new PrivateFormEnvelopeError(candidate, validation.errors);
  }
  return {
    formId: candidate.formId as KpFormId,
    draft: structuredClone(candidate.draft),
  };
}

const FORM_SEMANTIC_FIELDS: Readonly<Record<KpFormId, readonly string[]>> = Object.freeze({
  "clarification.v1": Object.freeze(["goal", "question", "choices"]),
  "observe.v1": Object.freeze(["goal", "method", "focus", "desiredInformation"]),
  "npc-exchange.v1": Object.freeze([
    "goal", "method", "utterance", "desiredResponse", "npcResponse",
  ]),
  "ordinary-check.v1": Object.freeze(["goal", "method", "intendedOutcome"]),
  "high-risk-action.v1": Object.freeze(["goal", "method", "intendedOutcome", "stakes"]),
  "in-world-refusal.v1": Object.freeze(["goal", "method", "reason", "alternatives"]),
  "materialization.v1": Object.freeze(["goal", "method", "proposedFact"]),
  "combat-action.v1": Object.freeze([
    "goal", "method", "intendedOutcome", "combatApproach",
  ]),
  "environmental-stunt.v1": Object.freeze([
    "goal", "method", "featureDescription", "intendedOutcome", "featureDisposition",
  ]),
  "compound.v1": Object.freeze(["goal", "method", "intendedOutcome", "stages"]),
});

function semanticDraftSource(
  formId: KpFormId,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const source: Record<string, unknown> = {};
  for (const field of FORM_SEMANTIC_FIELDS[formId]) {
    if (!Object.hasOwn(draft, field)) continue;
    if (field !== "stages") {
      source[field] = structuredClone(draft[field]);
      continue;
    }
    if (!Array.isArray(draft.stages)) {
      source.stages = structuredClone(draft.stages);
      continue;
    }
    source.stages = draft.stages.map((stage) => {
      if (!isRecord(stage)) return structuredClone(stage);
      const semantics: Record<string, unknown> = {};
      for (const key of ["goal", "method", "intendedOutcome"] as const) {
        if (Object.hasOwn(stage, key)) semantics[key] = structuredClone(stage[key]);
      }
      return semantics;
    });
  }
  return source;
}

function semanticFreezeSource(
  request: KpProposalRequest,
  formId: KpFormId,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const input = isRecord(request.input) ? request.input : {};
  const projection = isRecord(request.projection) ? request.projection : {};
  const actorProjection = isRecord(projection.actorProjection)
    ? projection.actorProjection
    : projection;
  return {
    preparedActionId: request.preparedActionId,
    rootActionId: request.rootActionId,
    playerInput: structuredClone(input),
    authorityBinding: {
      stateVersion: actorProjection.stateVersion ?? projection.stateVersion ?? null,
      activeBranchId: actorProjection.activeBranchId ?? projection.activeBranchId ?? null,
      projectionHash: actorProjection.projectionHash ?? projection.projectionHash ?? null,
      runtimeProfiles: structuredClone(actorProjection.runtimeProfiles ?? projection.runtimeProfiles ?? null),
      moduleRef: structuredClone(projection.moduleRef ?? actorProjection.moduleRef ?? null),
    },
    formId,
    semanticIntent: semanticDraftSource(formId, draft),
  };
}

function assertRepairSemantics(
  request: KpProposalRequest,
  previousForm: KpFormId,
  previousDraft: Record<string, unknown>,
  repairedForm: KpFormId,
  repairedDraft: Record<string, unknown>,
  expectedHash: string,
): void {
  const previousSource = semanticFreezeSource(request, previousForm, previousDraft);
  if (stableStructuralHash(previousSource) !== expectedHash) {
    throw new PrivateFormEnvelopeError(repairedDraft, ["semantic-freeze:hash-mismatch"]);
  }
  const previousSemantics = semanticDraftSource(previousForm, previousDraft);
  const repairedSemantics = semanticDraftSource(repairedForm, repairedDraft);
  if (previousForm === repairedForm) {
    for (const [key, value] of Object.entries(previousSemantics)) {
      if (canonicalJson(value) !== canonicalJson(repairedSemantics[key])) {
        throw new PrivateFormEnvelopeError(repairedDraft, [`semantic-freeze:${key}:changed`]);
      }
    }
    return;
  }
  if (repairedForm !== "compound.v1"
    || !["ordinary-check.v1", "high-risk-action.v1"].includes(previousForm)) {
    throw new PrivateFormEnvelopeError(repairedDraft, ["semantic-freeze:form-upgrade-forbidden"]);
  }
  for (const key of ["goal", "method", "intendedOutcome"] as const) {
    if (Object.hasOwn(previousSemantics, key)
      && canonicalJson(previousSemantics[key]) !== canonicalJson(repairedSemantics[key])) {
      throw new PrivateFormEnvelopeError(repairedDraft, [`semantic-freeze:${key}:changed`]);
    }
  }
}

const BASIS_REFERENCE_KEYS = new Set([
  "ref", "sourceRef", "profileRef", "dependencyRefs", "structuralRefs",
  "submissionRef", "characterRef", "controllerRef", "controlProofRef", "sceneRef",
  "sceneId", "entityId", "characterId", "encounterId", "definitionId", "factRef",
  "factRefs", "precedentId", "precedentRefs", "dynamicDefinitionRefs", "rulesRef",
  "geometryRef", "moduleRef", "eventRef", "truthConstraintRefs", "npcRef",
  "knowledgeRef", "knowledgeRefs", "planId", "planRefs", "pendingRefs", "activityRefs",
  "messageRef", "speakerRef", "fictionalTimeRef", "chapterId", "clueId", "receiptId",
]);
const ABILITY_REFERENCE_KEYS = new Set(["abilityRef", "abilityRefs", "dynamicDefinitionRefs"]);
const RESOURCE_REFERENCE_KEYS = new Set(["resourceRef", "resourceRefs"]);
const ARTIFACT_REFERENCE_KEYS = new Set(["artifactRef", "artifactRefs", "itemRef", "itemRefs"]);

function finiteReferenceCatalog(contextPack: unknown): FiniteReferenceCatalog {
  const basisRefs = new Set<string>();
  const abilityRefs = new Set<string>();
  const resourceRefs = new Set<string>();
  const artifactRefs = new Set<string>();
  const add = (target: Set<string>, value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0 && value.length <= 300) {
      target.add(value);
    }
  };
  const visit = (value: unknown, key = "", path = "", depth = 0): void => {
    if (depth > 14 || basisRefs.size >= 256) return;
    if (typeof value === "string") {
      if (BASIS_REFERENCE_KEYS.has(key)) add(basisRefs, value);
      if (ABILITY_REFERENCE_KEYS.has(key)
        || (/^(?:ability|spell|action|item):/u.test(value) && BASIS_REFERENCE_KEYS.has(key))) {
        add(abilityRefs, value);
      }
      if (RESOURCE_REFERENCE_KEYS.has(key)) add(resourceRefs, value);
      if (ARTIFACT_REFERENCE_KEYS.has(key)) add(artifactRefs, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key, path, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    if (path === "required.mechanics.resources") {
      for (const resourceRef of Object.keys(value)) add(resourceRefs, resourceRef);
    }
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, childKey, path.length === 0 ? childKey : `${path}.${childKey}`, depth + 1);
    }
  };
  visit(contextPack);
  for (const ref of [...abilityRefs, ...resourceRefs, ...artifactRefs]) basisRefs.add(ref);
  return Object.freeze({
    basisRefs: Object.freeze([...basisRefs].sort().slice(0, 192)),
    abilityRefs: Object.freeze([...abilityRefs].sort().slice(0, 96)),
    resourceRefs: Object.freeze([...resourceRefs].sort().slice(0, 96)),
    artifactRefs: Object.freeze([...artifactRefs].sort().slice(0, 96)),
  });
}

function formReferenceErrors(
  draft: Record<string, unknown>,
  finiteReferences: FiniteReferenceCatalog,
): readonly string[] {
  const allowedByField: Readonly<Record<string, Set<string>>> = {
    basisRefs: new Set(finiteReferences.basisRefs),
    abilityRef: new Set(finiteReferences.abilityRefs),
    resourceRef: new Set(finiteReferences.resourceRefs),
    artifactRef: new Set(finiteReferences.artifactRefs),
  };
  const errors: string[] = [];
  const visit = (value: unknown, key = "", path = "draft"): void => {
    if (key === "basisRefs") {
      if (!Array.isArray(value)) {
        errors.push(`${path}:array-required`);
        return;
      }
      for (const ref of value) {
        if (typeof ref !== "string" || !allowedByField.basisRefs.has(ref)) {
          errors.push(`${path}:${typeof ref === "string" ? ref : "invalid"}:not-authoritative`);
        }
      }
      return;
    }
    if (key === "abilityRef" || key === "resourceRef" || key === "artifactRef") {
      if (typeof value !== "string" || !allowedByField[key].has(value)) {
        errors.push(`${path}:${typeof value === "string" ? value : "invalid"}:not-authoritative`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, "", `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [childKey, child] of Object.entries(value)) {
      visit(child, childKey, `${path}.${childKey}`);
    }
  };
  visit(draft);
  return Object.freeze([...new Set(errors)].sort());
}

function validateRepairEnvelope(formId: KpFormId, value: unknown): PrivateFormEnvelope {
  if (!isRecord(value)) throw new PrivateFormEnvelopeError(value, ["envelope:object-required"]);
  const candidate = unwrapSingleEnvelope(value);
  const errors: string[] = [];
  for (const key of Object.keys(candidate)) {
    if (key !== "formId" && key !== "draft") errors.push(`${key}:unknown-field`);
  }
  if (candidate.formId !== formId) errors.push("formId:repair-selection-changed");
  const validation = validateKpFormDraft(formId, candidate.draft);
  errors.push(...validation.errors);
  if (errors.length > 0 || !isRecord(candidate.draft)) {
    throw new PrivateFormEnvelopeError(candidate, errors);
  }
  return { formId, draft: structuredClone(candidate.draft) };
}

function mechanicalDiagnosticErrors(value: unknown): readonly string[] {
  const diagnostics = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const diagnostic of diagnostics) {
    if (typeof diagnostic === "string" && diagnostic.trim().length > 0) {
      result.push(diagnostic.slice(0, 480));
      continue;
    }
    if (!isRecord(diagnostic)) continue;
    const fields = ["code", "path", "message", "expected", "actual"]
      .flatMap((key) => {
        const field = diagnostic[key];
        return typeof field === "string" || typeof field === "number" || typeof field === "boolean"
          ? [`${key}:${String(field).slice(0, 360)}`]
          : [];
      });
    if (fields.length > 0) result.push(fields.join("|"));
  }
  return Object.freeze([...new Set(result)].sort().slice(0, 40));
}

function shouldUpgradeRepairToCompound(errors: readonly string[]): boolean {
  return errors.some((error) => /(FORM_TOO_NARROW|formTooNarrow|requiresCompound)/u.test(error));
}

function priorPrivateProposal(value: unknown): V3AuthoritativeKpProposal | undefined {
  if (!isRecord(value)
    || value.kind !== "privateFormProposal"
    || typeof value.formId !== "string"
    || !(KP_FORM_IDS as readonly string[]).includes(value.formId)
    || !isRecord(value.draft)
    || typeof value.semanticFreezeHash !== "string"
    || typeof value.repairUsed !== "boolean") return undefined;
  return value as unknown as V3AuthoritativeKpProposal;
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

function normalizeProposalProjectionReferences(
  proposal: KpProposalDraft,
  projection: unknown,
): KpProposalDraft {
  const normalized = structuredClone(proposal);
  const available = collectStrings(projection);
  normalized.publicBasisRefs = proposal.publicBasisRefs.filter((reference) =>
    available.has(reference));
  normalized.privateBasisRefs = proposal.privateBasisRefs.filter((reference) =>
    available.has(reference));

  const causalReferences = projectionCanonicalFactRefs(projection);
  for (const materialization of normalized.dynamicMaterializations) {
    materialization.causalBasisRefs = materialization.causalBasisRefs.filter((reference) =>
      causalReferences.has(reference));
  }
  for (const candidate of normalized.hiddenRealityCandidateSet?.candidates ?? []) {
    candidate.causalBasisRefs = candidate.causalBasisRefs.filter((reference) =>
      causalReferences.has(reference));
  }

  normalized.npcActions = proposal.npcActions.filter((action) => {
    const knowledgeRefs = projectionNpcKnowledgeRefs(projection, action.npcId);
    return knowledgeRefs !== undefined
      && action.knowledgeRefs.every((reference) => knowledgeRefs.has(reference));
  });

  assertProjectionRepairPreservesProposal(proposal, normalized, projection);
  return normalized;
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
      const structuredKeys = Object.keys(structured);
      const onlyValue = structuredKeys.length === 1
        ? structured[structuredKeys[0]]
        : undefined;
      // Some Workers AI tool-call responses add one redundant provider
      // envelope around otherwise valid arguments. The envelope name is not
      // authoritative; the inner object still has to pass the exact same
      // closed Proposal validator. Sibling fields and invalid inner objects
      // therefore remain fail-closed.
      const proposalCandidate = isRecord(onlyValue) ? onlyValue : structured;
      return validateProposal(proposalCandidate);
    } catch (error) {
      throw permanentOutputError(error, invocation.receipt, "proposalSchema");
    }
  }

  function narrationDraftFromInvocation(
    invocation: InvocationSuccess,
    projection: unknown,
  ): ReturnType<typeof validateNarration> {
    try {
      const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
      const structuredKeys = Object.keys(structured);
      const onlyValue = structuredKeys.length === 1
        ? structured[structuredKeys[0]]
        : undefined;
      const narrationCandidate = isRecord(onlyValue) ? onlyValue : structured;
      return validateNarration(narrationCandidate, projection);
    } catch (error) {
      if (!(error instanceof ModelOutputValidationError)) throw error;
      throw permanentOutputError(
        error,
        invocation.receipt,
        error instanceof NarrationGroundingValidationError
          ? "narrationGrounding"
          : "narrationSchema",
      );
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

  function v3Failure(
    publicCode: string,
    invocationReceipt: ModelInvocationReceipt,
    failureStage: ModelInvocationFailureStage,
  ): AuthoritativeKpModelError {
    return Object.assign(new AuthoritativeKpModelError(
      "modelPermanent",
      { ...invocationReceipt, result: "modelPermanent", failureStage },
    ), { publicCode });
  }

  async function prepareV3Context(
    request: KpProposalRequest,
    allowedForms: readonly KpFormId[],
  ): Promise<{
    contextPack: unknown;
    orderedForms: readonly KpFormId[];
    plannerReceipt?: unknown;
    retrievalReceipt?: unknown;
  }> {
    try {
      const prepared = options.prepareV3Context === undefined
        ? { contextPack: buildV3ContextPack(request) }
        : await options.prepareV3Context(request, allowedForms);
      const ordered = prepared.orderedFormIds;
      const exactOrder = Array.isArray(ordered)
        && ordered.length === allowedForms.length
        && new Set(ordered).size === ordered.length
        && ordered.every((formId): formId is KpFormId =>
          typeof formId === "string" && allowedForms.includes(formId as KpFormId));
      return {
        contextPack: prepared.contextPack,
        orderedForms: exactOrder ? Object.freeze([...ordered]) : allowedForms,
        ...(prepared.plannerReceipt === undefined
          ? {}
          : { plannerReceipt: prepared.plannerReceipt }),
        ...(prepared.retrievalReceipt === undefined
          ? {}
          : { retrievalReceipt: prepared.retrievalReceipt }),
      };
    } catch (error) {
      const at = now();
      throw v3Failure(
        "CONTEXT_INSUFFICIENT",
        receipt(profile, "proposal", request.rootActionId, request.attempt, at, at, "modelPermanent"),
        "contextPack",
      );
    }
  }

  function buildV3Proposal(
    request: KpProposalRequest,
    envelope: PrivateFormEnvelope,
    invocationReceipt: ModelInvocationReceipt,
    repairUsed: boolean,
    semanticFreezeHash?: string,
  ): V3AuthoritativeKpProposal {
    let causalActionProgram;
    try {
      causalActionProgram = compileKpFormDraft(envelope.formId, envelope.draft);
    } catch {
      throw v3Failure("PROPOSAL_FORM_INVALID", invocationReceipt, "proposalSchema");
    }
    const freezeHash = semanticFreezeHash
      ?? stableStructuralHash(semanticFreezeSource(request, envelope.formId, envelope.draft));
    return {
      kind: "privateFormProposal",
      formId: envelope.formId,
      draft: structuredClone(envelope.draft),
      causalActionProgram,
      loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
      semanticFreezeHash: freezeHash,
      repairUsed,
      proposalAttemptId: `${request.rootActionId}:kp:${request.attempt}`,
      modelInvocationReceipt: invocationReceipt,
    };
  }

  async function invokeV3Repair(input: Readonly<{
    request: KpProposalRequest;
    originalForm: KpFormId;
    selectedForm: KpFormId;
    rejectedDraft: Record<string, unknown>;
    errors: readonly string[];
    finiteReferences: FiniteReferenceCatalog;
    semanticFreezeHash: string;
    startedAt: number;
  }>): Promise<V3AuthoritativeKpProposal> {
    if (stableStructuralHash(semanticFreezeSource(
      input.request,
      input.originalForm,
      input.rejectedDraft,
    )) !== input.semanticFreezeHash) {
      const at = now();
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        receipt(profile, "proposal", input.request.rootActionId, 2, at, at, "modelPermanent"),
        "proposalSchema",
      );
    }
    const remainingInvocationMs = invocationTimeoutMs - Math.max(0, now() - input.startedAt);
    if (remainingInvocationMs < 1) {
      const at = now();
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        receipt(profile, "proposal", input.request.rootActionId, 2, at, at, "modelPermanent"),
        "proposalSchema",
      );
    }
    const repairInvocation = await invoke(
      "proposal",
      input.request.rootActionId,
      2,
      privateFormRepairModelInput({
        rootActionRef: input.request.rootActionId,
        originalForm: input.originalForm,
        selectedForm: input.selectedForm,
        rejectedDraft: input.rejectedDraft,
        errors: input.errors,
        finiteReferences: input.finiteReferences,
        semanticFreezeHash: input.semanticFreezeHash,
      }),
      remainingInvocationMs,
    );
    let repaired: PrivateFormEnvelope;
    try {
      const structured = extractStructuredOutput(
        repairInvocation.response,
        PRIVATE_FORM_PROPOSAL_TOOL_NAME,
      );
      repaired = validateRepairEnvelope(input.selectedForm, structured);
      const referenceErrors = formReferenceErrors(repaired.draft, input.finiteReferences);
      if (referenceErrors.length > 0) {
        throw new PrivateFormEnvelopeError(repaired, referenceErrors);
      }
      assertRepairSemantics(
        input.request,
        input.originalForm,
        input.rejectedDraft,
        input.selectedForm,
        repaired.draft,
        input.semanticFreezeHash,
      );
    } catch {
      throw v3Failure(
        "PROPOSAL_REPAIR_EXHAUSTED",
        repairInvocation.receipt,
        "proposalSchema",
      );
    }
    return buildV3Proposal(
      input.request,
      repaired,
      repairInvocation.receipt,
      true,
      input.semanticFreezeHash,
    );
  }

  if (isV3AuthoritativeKpProfile(profile)) {
    return {
      async propose(request) {
        return withInvocationReceipt(async () => {
          const rootActionId = typeof request?.rootActionId === "string"
            ? request.rootActionId
            : "invalid";
          const attempt = typeof request?.attempt === "number" ? request.attempt : 0;
          try {
            validateV3ProposalRequest(request);
          } catch {
            throw permanentContractError(profile, "proposal", rootActionId, attempt, now);
          }

          const selected = selectAllowedKpForms(v3FormSelectionSignals(request));
          const preparedContext = await prepareV3Context(request, selected);
          const finiteReferences = finiteReferenceCatalog(preparedContext.contextPack);

          if (request.attempt === 2) {
            const prior = priorPrivateProposal(request.priorProposal);
            if (prior === undefined || prior.repairUsed) {
              const at = now();
              throw v3Failure(
                "PROPOSAL_REPAIR_EXHAUSTED",
                receipt(profile, "proposal", request.rootActionId, 2, at, at, "modelPermanent"),
                "proposalSchema",
              );
            }
            const errors = mechanicalDiagnosticErrors(request.diagnostics);
            const upgrade = shouldUpgradeRepairToCompound(errors)
              && ["ordinary-check.v1", "high-risk-action.v1"].includes(prior.formId);
            const selectedForm = upgrade ? "compound.v1" : prior.formId as KpFormId;
            return invokeV3Repair({
              request,
              originalForm: prior.formId as KpFormId,
              selectedForm,
              rejectedDraft: prior.draft,
              errors: errors.length > 0 ? errors : ["PROPOSAL_RULES_DIAGNOSTIC"],
              finiteReferences,
              semanticFreezeHash: prior.semanticFreezeHash,
              startedAt: now(),
            });
          }

          const invocation = await invoke(
            "proposal",
            request.rootActionId,
            1,
            privateFormProposalModelInput({
              request,
              allowedForms: preparedContext.orderedForms,
              contextPack: preparedContext.contextPack,
            }),
          );
          try {
            const envelope = privateFormEnvelope(
              invocation.response,
              preparedContext.orderedForms,
            );
            const referenceErrors = formReferenceErrors(envelope.draft, finiteReferences);
            if (referenceErrors.length > 0) {
              throw new PrivateFormEnvelopeError(envelope, referenceErrors);
            }
            return buildV3Proposal(request, envelope, invocation.receipt, false);
          } catch (error) {
            if (!(error instanceof PrivateFormEnvelopeError)) throw error;
            const failedReceipt: ModelInvocationReceipt = {
              ...invocation.receipt,
              result: "modelPermanent",
              failureStage: error.errors.some((entry) => entry.includes("not-authoritative"))
                ? "proposalReference"
                : "proposalSchema",
            };
            const candidate = isRecord(error.candidate) ? error.candidate : {};
            if (typeof candidate.formId !== "string"
              || !preparedContext.orderedForms.includes(candidate.formId as KpFormId)) {
              throw v3Failure("PROPOSAL_FORM_INVALID", failedReceipt, "proposalSchema");
            }
            emitInvocationReceipt(failedReceipt);
            const rejectedDraft = isRecord(candidate.draft) ? candidate.draft : {};
            const candidateForm = candidate.formId as KpFormId;
            const semanticFreezeHash = stableStructuralHash(
              semanticFreezeSource(request, candidateForm, rejectedDraft),
            );
            return invokeV3Repair({
              request,
              originalForm: candidateForm,
              selectedForm: candidateForm,
              rejectedDraft,
              errors: error.errors,
              finiteReferences,
              semanticFreezeHash,
              startedAt: invocation.receipt.startedAt,
            });
          }
        });
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
            throw permanentContractError(profile, "proposal", rootActionId, 1, now);
          }
          const invocation = await invoke(
            "proposal",
            request.rootActionId,
            1,
            modelInput,
          );
          try {
            const structured = extractStructuredOutput(
              invocation.response,
              ACTOR_PLAN_DECISION_TOOL_NAME,
            );
            const candidate = unwrapSingleEnvelope(structured);
            const decision = validateActorPlanDecisionOutput(candidate, request);
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
          try {
            validateNarrationRequest(request);
          } catch {
            throw permanentContractError(profile, "narration", rootActionId, attempt, now);
          }
          const invocation = await invoke(
            "narration",
            request.rootActionId,
            attempt,
            bodyOnlyNarrationModelInput(request),
          );
          try {
            const structured = extractStructuredOutput(invocation.response, NARRATION_TOOL_NAME);
            const candidate = unwrapSingleEnvelope(structured);
            const narration = validateBodyOnlyNarrationOutput(candidate, request.projection);
            return {
              ...narration,
              audience: audienceIdentity(request.projection),
              modelInvocationReceipt: invocation.receipt,
            };
          } catch (error) {
            if (!(error instanceof ModelOutputValidationError)) throw error;
            throw v3Failure(
              error instanceof NarrationGroundingValidationError
                ? "NARRATION_GROUNDING_REJECTED"
                : "NARRATION_BODY_INVALID",
              invocation.receipt,
              error instanceof NarrationGroundingValidationError
                ? "narrationGrounding"
                : "narrationSchema",
            );
          }
        });
      },
    };
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
          throw permanentContractError(profile, "proposal", rootActionId, attempt, now);
        }

        let modelInput: Record<string, unknown>;
        try {
          modelInput = proposalModelInput(request);
        } catch {
          throw permanentContractError(profile, "proposal", request.rootActionId, request.attempt, now);
        }
        let invocation = await invoke(
          "proposal",
          request.rootActionId,
          request.attempt,
          modelInput,
        );
        let proposal: KpProposalDraft;
        try {
          proposal = proposalDraftFromInvocation(invocation);
        } catch (error) {
          if (
            !(error instanceof AuthoritativeKpModelError)
            || error.modelInvocationReceipt.failureStage !== "proposalSchema"
          ) {
            throw error;
          }
          let correctionInput: Record<string, unknown>;
          try {
            correctionInput = proposalSchemaCorrectionModelInput(request);
          } catch {
            throw permanentContractError(
              profile,
              "proposal",
              request.rootActionId,
              request.attempt,
              now,
            );
          }
          const remainingInvocationMs = invocationTimeoutMs - Math.max(
            0,
            now() - invocation.receipt.startedAt,
          );
          if (remainingInvocationMs < 1) throw error;
          emitInvocationReceipt(error.modelInvocationReceipt);
          invocation = await invoke(
            "proposal",
            request.rootActionId,
            request.attempt,
            correctionInput,
            remainingInvocationMs,
          );
          proposal = proposalDraftFromInvocation(invocation);
        }
        let projectionBoundProposal: KpProposalDraft;
        try {
          projectionBoundProposal = normalizeProposalProjectionReferences(
            proposal,
            request.projection,
          );
        } catch (error) {
          throw permanentOutputError(error, invocation.receipt, "projectionBinding");
        }
        assertProjectionBoundProposal(
          projectionBoundProposal,
          request.projection,
          invocation.receipt,
        );
        return {
          ...projectionBoundProposal,
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
        let invocation = await invoke(
          "narration",
          request.rootActionId,
          attempt,
          modelInput,
        );
        let narration: ReturnType<typeof validateNarration>;
        let finalInvocationReceipt = invocation.receipt;
        try {
          narration = narrationDraftFromInvocation(invocation, request.projection);
        } catch (error) {
          if (!(error instanceof AuthoritativeKpModelError) || error.code !== "modelPermanent") {
            throw error;
          }
          let correctionInput: Record<string, unknown>;
          try {
            correctionInput = narrationSchemaCorrectionModelInput(request);
          } catch {
            throw permanentContractError(
              profile,
              "narration",
              request.rootActionId,
              attempt,
              now,
            );
          }
          const remainingInvocationMs = invocationTimeoutMs - Math.max(
            0,
            now() - invocation.receipt.startedAt,
          );
          if (remainingInvocationMs < 1) throw error;
          emitInvocationReceipt(error.modelInvocationReceipt);
          invocation = await invoke(
            "narration",
            request.rootActionId,
            attempt,
            correctionInput,
            remainingInvocationMs,
          );
          finalInvocationReceipt = invocation.receipt;
          try {
            narration = narrationDraftFromInvocation(invocation, request.projection);
          } catch (replacementError) {
            // Invalid narration is an explicit delivery failure. A fabricated
            // success would sever the body from the committed projection and
            // hide the audience-specific retry state.
            throw replacementError;
          }
        }
        return {
          ...narration,
          audience,
          modelInvocationReceipt: finalInvocationReceipt,
        };
      });
    },
  };
}
