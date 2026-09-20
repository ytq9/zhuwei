import { stableStructuralHash } from "./causal-action-program";

import {
  DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
  DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
} from "./deepseek-strict-tool";

export const MODEL_ROLES = Object.freeze([
  "primary-kp",
  "context-planner",
  "narration",
  "chunk-reranker",
] as const);

export type ModelRole = (typeof MODEL_ROLES)[number];
export type StructuredOutputMode = "tool" | "strict-tool" | "strict-json-schema" | "none";
export type ModelLatencyTier = "local" | "low" | "standard" | "high";
export type ModelCostTier = "free" | "low" | "standard" | "high";

export type StrictToolContractValidationEvidence = Readonly<{
  contractId: string;
  toolName: string;
  promptHash: string;
  schemaHash: string;
  parserHash: string;
  caseIds: readonly string[];
}>;

export type StrictToolProviderValidationEvidence = Readonly<{
  evidenceVersion: "kp-strict-tool-provider-evidence-v2";
  executionMode: "live-provider" | "offline-fixture";
  profileBindingHash: string;
  provider: string;
  modelId: string;
  modelRevision: string;
  endpointProtocol: string;
  schemaDialect: string;
  promptHash: string;
  schemaHash: string;
  parserHash: string;
  contracts: readonly StrictToolContractValidationEvidence[];
  validationSuiteHash: string;
  validatedAt: string;
  caseCount: number;
  liveProviderCalls: number;
  successfulStrictToolCalls: number;
  invalidSchemaRejections: number;
  invalidSchemaRejectedBeforeGeneration: boolean;
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
  strictToolValidation?: StrictToolProviderValidationEvidence;
  profileHash?: string;
}>;

export type ModelProfileRegistry = Readonly<{
  registryVersion: "kp-model-profile-registry-v1";
  registryHash: string;
  profiles: Readonly<Record<string, ModelProfileRegistration>>;
}>;

/** Candidate only: live strict-tool evidence is required before registration
 * or any Room ingress can select this Profile. */
export const DEEPSEEK_V4_FLASH_VNEXT2_STRICT_TOOL_CANDIDATE = Object.freeze({
  profileRef: "primary-kp:deepseek-v4-flash:vnext2-strict:v1",
  provider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelRevision: "deepseek-v4-flash-0731",
  supportedRoles: Object.freeze(["primary-kp"] as const),
  validationSuiteVersion: "kp-vnext2-strict-tool-handshake-v3",
  validationStatus: "pending" as const,
  structuredOutputMode: "strict-tool" as const,
  contextWindowTokens: 32_000,
  latencyTier: "low" as const,
  costTier: "low" as const,
}) satisfies ModelProfileRegistration;

type StrictToolProfileBinding = Pick<
  ModelProfileRegistration,
  | "profileRef"
  | "provider"
  | "modelId"
  | "modelRevision"
  | "supportedRoles"
  | "validationSuiteVersion"
  | "structuredOutputMode"
>;

type StrictToolContractBinding = Readonly<{
  endpointProtocol: string;
  schemaDialect: string;
  promptHash: string;
  schemaHash: string;
  parserHash: string;
  contracts: readonly StrictToolContractValidationEvidence[];
  validationSuiteHash: string;
}>;

export function strictToolProfileBindingHash(
  profile: StrictToolProfileBinding,
  contract: StrictToolContractBinding,
): string {
  return stableStructuralHash({
    profileRef: profile.profileRef,
    provider: profile.provider,
    modelId: profile.modelId,
    modelRevision: profile.modelRevision,
    supportedRoles: [...new Set(profile.supportedRoles)].sort(),
    validationSuiteVersion: profile.validationSuiteVersion,
    structuredOutputMode: profile.structuredOutputMode,
    ...contract,
  });
}

export function createStrictToolProviderValidationEvidence(input: Readonly<{
  profile: StrictToolProfileBinding;
  executionMode: StrictToolProviderValidationEvidence["executionMode"];
  endpointProtocol?: string;
  schemaDialect?: string;
  contracts: readonly StrictToolContractValidationEvidence[];
  validationSuiteHash: string;
  validatedAt: string;
  caseCount: number;
  liveProviderCalls: number;
  successfulStrictToolCalls: number;
  invalidSchemaRejections: number;
  invalidSchemaRejectedBeforeGeneration: boolean;
}>): StrictToolProviderValidationEvidence {
  const contracts = normalizeStrictToolContracts(input.contracts);
  const contract = {
    endpointProtocol: input.endpointProtocol ?? DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL,
    schemaDialect: input.schemaDialect ?? DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT,
    promptHash: strictToolContractAggregateHash(contracts, "promptHash"),
    schemaHash: strictToolContractAggregateHash(contracts, "schemaHash"),
    parserHash: strictToolContractAggregateHash(contracts, "parserHash"),
    contracts,
    validationSuiteHash: input.validationSuiteHash,
  };
  const source = {
    evidenceVersion: "kp-strict-tool-provider-evidence-v2" as const,
    executionMode: input.executionMode,
    profileBindingHash: strictToolProfileBindingHash(input.profile, contract),
    provider: input.profile.provider,
    modelId: input.profile.modelId,
    modelRevision: input.profile.modelRevision,
    ...contract,
    validatedAt: input.validatedAt,
    caseCount: input.caseCount,
    liveProviderCalls: input.liveProviderCalls,
    successfulStrictToolCalls: input.successfulStrictToolCalls,
    invalidSchemaRejections: input.invalidSchemaRejections,
    invalidSchemaRejectedBeforeGeneration: input.invalidSchemaRejectedBeforeGeneration,
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
      ...(profile.strictToolValidation === undefined
        ? {}
        : {
            strictToolValidation: Object.freeze({
              ...profile.strictToolValidation,
              contracts: Object.freeze(profile.strictToolValidation.contracts.map((contract) =>
                Object.freeze({
                  ...contract,
                  caseIds: Object.freeze([...contract.caseIds]),
                }))),
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
  if (!["tool", "strict-tool", "strict-json-schema", "none"].includes(
    profile.structuredOutputMode,
  )) {
    throw new Error("MODEL_PROFILE_STRUCTURED_OUTPUT_MODE_INVALID");
  }
  if (profile.profileHash !== undefined) throw new Error("MODEL_PROFILE_HASH_SERVER_DERIVED");
  if (profile.structuredOutputMode === "strict-tool") {
    if (profile.strictToolValidation === undefined) {
      throw new Error("MODEL_PROFILE_STRICT_TOOL_EVIDENCE_REQUIRED");
    }
    if (!strictToolEvidenceIsBound(profile, profile.strictToolValidation)) {
      throw new Error("MODEL_PROFILE_STRICT_TOOL_EVIDENCE_INVALID");
    }
    if (!strictToolEvidencePasses(profile, profile.strictToolValidation)) {
      throw new Error("MODEL_PROFILE_STRICT_TOOL_LIVE_EVIDENCE_REQUIRED");
    }
  } else if (profile.strictToolValidation !== undefined) {
    throw new Error("MODEL_PROFILE_STRICT_TOOL_EVIDENCE_UNEXPECTED");
  }
}

function strictToolEvidencePasses(
  profile: ModelProfileRegistration,
  evidence: StrictToolProviderValidationEvidence,
): boolean {
  return strictToolEvidenceIsBound(profile, evidence)
    && evidence.executionMode === "live-provider"
    && Number.isInteger(evidence.caseCount)
    && evidence.caseCount >= 4
    && Number.isInteger(evidence.liveProviderCalls)
    && evidence.liveProviderCalls >= evidence.caseCount
    && Number.isInteger(evidence.successfulStrictToolCalls)
    && evidence.successfulStrictToolCalls >= 3
    && Number.isInteger(evidence.invalidSchemaRejections)
    && evidence.invalidSchemaRejections >= 1
    && evidence.successfulStrictToolCalls + evidence.invalidSchemaRejections <= evidence.caseCount
    && evidence.invalidSchemaRejectedBeforeGeneration === true;
}

function strictToolEvidenceIsBound(
  profile: ModelProfileRegistration,
  evidence: StrictToolProviderValidationEvidence,
): boolean {
  const contract = {
    endpointProtocol: evidence.endpointProtocol,
    schemaDialect: evidence.schemaDialect,
    promptHash: evidence.promptHash,
    schemaHash: evidence.schemaHash,
    parserHash: evidence.parserHash,
    contracts: evidence.contracts,
    validationSuiteHash: evidence.validationSuiteHash,
  };
  const source = {
    evidenceVersion: evidence.evidenceVersion,
    executionMode: evidence.executionMode,
    profileBindingHash: evidence.profileBindingHash,
    provider: evidence.provider,
    modelId: evidence.modelId,
    modelRevision: evidence.modelRevision,
    ...contract,
    validatedAt: evidence.validatedAt,
    caseCount: evidence.caseCount,
    liveProviderCalls: evidence.liveProviderCalls,
    successfulStrictToolCalls: evidence.successfulStrictToolCalls,
    invalidSchemaRejections: evidence.invalidSchemaRejections,
    invalidSchemaRejectedBeforeGeneration: evidence.invalidSchemaRejectedBeforeGeneration,
  };
  return evidence.evidenceVersion === "kp-strict-tool-provider-evidence-v2"
    && profile.structuredOutputMode === "strict-tool"
    && profile.provider === "deepseek"
    && evidence.provider === profile.provider
    && evidence.modelId === profile.modelId
    && evidence.modelRevision === profile.modelRevision
    && evidence.endpointProtocol === DEEPSEEK_STRICT_TOOL_ENDPOINT_PROTOCOL
    && evidence.schemaDialect === DEEPSEEK_STRICT_TOOL_SCHEMA_DIALECT
    && strictToolContractsConform(evidence.contracts)
    && evidence.promptHash === strictToolContractAggregateHash(evidence.contracts, "promptHash")
    && evidence.schemaHash === strictToolContractAggregateHash(evidence.contracts, "schemaHash")
    && evidence.parserHash === strictToolContractAggregateHash(evidence.contracts, "parserHash")
    && evidence.profileBindingHash === strictToolProfileBindingHash(profile, contract)
    && [
      evidence.promptHash,
      evidence.schemaHash,
      evidence.parserHash,
      evidence.validationSuiteHash,
    ].every(validEvidenceHash)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(evidence.validatedAt)
    && evidence.evidenceHash === stableStructuralHash(source);
}

function normalizeStrictToolContracts(
  contracts: readonly StrictToolContractValidationEvidence[],
): readonly StrictToolContractValidationEvidence[] {
  if (!strictToolContractsConform(contracts)) {
    throw new TypeError("STRICT_TOOL_CONTRACT_EVIDENCE_INVALID");
  }
  return Object.freeze([...contracts]
    .sort((left, right) => left.contractId.localeCompare(right.contractId))
    .map((contract) => Object.freeze({
      ...contract,
      caseIds: Object.freeze([...contract.caseIds].sort()),
    })));
}

function strictToolContractsConform(
  value: unknown,
): value is readonly StrictToolContractValidationEvidence[] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const contractIds = new Set<string>();
  const toolNames = new Set<string>();
  const allCaseIds = new Set<string>();
  return value.every((contract) => {
    if (contract === null || typeof contract !== "object" || Array.isArray(contract)) return false;
    const record = contract as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const expected = [
      "caseIds", "contractId", "parserHash", "promptHash", "schemaHash", "toolName",
    ];
    if (keys.length !== expected.length
      || !keys.every((key, index) => key === expected[index])
      || typeof record.contractId !== "string"
      || record.contractId.trim().length === 0
      || contractIds.has(record.contractId)
      || typeof record.toolName !== "string"
      || record.toolName.trim().length === 0
      || toolNames.has(record.toolName)
      || ![record.promptHash, record.schemaHash, record.parserHash]
        .every((hash) => typeof hash === "string" && validEvidenceHash(hash))
      || !Array.isArray(record.caseIds)
      || record.caseIds.length < 1) return false;
    const localCaseIds = new Set<string>();
    for (const caseId of record.caseIds) {
      if (typeof caseId !== "string"
        || caseId.trim().length === 0
        || localCaseIds.has(caseId)
        || allCaseIds.has(caseId)) return false;
      localCaseIds.add(caseId);
    }
    contractIds.add(record.contractId);
    toolNames.add(record.toolName);
    for (const caseId of localCaseIds) allCaseIds.add(caseId);
    return true;
  });
}

function strictToolContractAggregateHash(
  contracts: readonly StrictToolContractValidationEvidence[],
  field: "promptHash" | "schemaHash" | "parserHash",
): string {
  return stableStructuralHash([...contracts]
    .sort((left, right) => left.contractId.localeCompare(right.contractId))
    .map((contract) => ({ contractId: contract.contractId, [field]: contract[field] })));
}

function validEvidenceHash(value: string): boolean {
  return /^(?:fnv1a64:[0-9a-f]{16}|sha256:[0-9a-f]{64})$/u.test(value);
}

export const DISABLED_CONTEXT_PLANNER_PROFILE_REF =
  "context-planner-disabled-v1" as const;
