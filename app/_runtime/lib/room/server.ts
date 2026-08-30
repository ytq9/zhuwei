import { env } from "cloudflare:workers";

import { getSql } from "../db";
import type { CharacterSheet } from "../dnd/types";
import { createAuthoritativeKpAdapter } from "../kp/authoritative";
import {
  authoritativeKpProfileByBinding,
  isSocialResolutionKpProfile,
} from "../kp/authoritative-policy";
import {
  createDisabledPlannerAdapter,
  createModelProfileRegistry,
} from "../kp/model-registry";
import { authoritativeKpModelBinding } from "../kp/provider";
import { createV3ProductionContextPreparer } from "../kp/v3-production-context";
import type {
  KpNarrationRequest,
  KpProposalDraft,
  SemanticActionPlan,
} from "../kp/authoritative-types";
import { authoritativeModuleProfile } from "../module/authoritative";
import type { ProjectionQuery, RuntimeProfileManifest } from "../rules";
import {
  handleRoomAction,
  handleRoomCorrection,
  handleViewerNarrationRecovery,
  type KpAdapterCapability,
  type RoomActionInput,
} from "./action";
import { roomServiceCapabilities } from "./archive";
import type {
  AuthoritativeCharacterSeed,
  AuthoritativeInitializationOutcome,
  AuthoritativeMemberSeed,
  TrustedPrincipalContext,
} from "./authority-types";
import {
  buildModelInvocationTelemetryEvent,
  buildRoomTelemetryEvent,
} from "./telemetry";
import { withRoomAuthorityTelemetry } from "./authority-telemetry";
import {
  type PersistedRoomKpBinding,
  validateV3RoomBinding,
} from "./v3-binding";

function roomStub(roomId: string) {
  return env.ROOMS.getByName(roomId);
}

function telemetryRoomAuthority(input: {
  roomId: string;
  userId: string;
  requestId?: string;
  submissionId?: string;
}) {
  return withRoomAuthorityTelemetry(roomStub(input.roomId), {
    roomId: input.roomId,
    principalId: input.userId,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(input.submissionId === undefined ? {} : { submissionId: input.submissionId }),
    emit(event) {
      console.info(JSON.stringify(event));
    },
  });
}

/**
 * The API authenticates before reaching this adapter.  Keep the principal
 * construction here so no table request body, transcription, or model output
 * can supply the actor identity used by the authoritative Room RPCs.
 */
export function trustedRoomPrincipal(userId: string): TrustedPrincipalContext {
  if (!userId) throw new TypeError("A trusted authenticated user id is required.");
  return { principal: { id: userId, sessionVersion: 1 } };
}

export function authoritativeCharacterId(userId: string): string {
  if (!userId) throw new TypeError("A trusted authenticated user id is required.");
  return `character:${userId}`;
}

export async function initializeAuthoritativeRoom(input: {
  roomId: string;
  moduleId: string;
  moduleVersion?: string;
  members: AuthoritativeMemberSeed[];
  characters: AuthoritativeCharacterSeed[];
  fixtureFacts?: unknown[];
  runtimeProfiles?: RuntimeProfileManifest;
}): Promise<AuthoritativeInitializationOutcome> {
  return await roomStub(input.roomId).initializeAuthoritative({
    roomId: input.roomId,
    moduleId: input.moduleId,
    ...(input.moduleVersion === undefined ? {} : { moduleVersion: input.moduleVersion }),
    members: input.members,
    characters: input.characters,
    ...(input.fixtureFacts === undefined ? {} : { fixtureFacts: input.fixtureFacts }),
    ...(input.runtimeProfiles === undefined ? {} : { runtimeProfiles: input.runtimeProfiles }),
  }) as AuthoritativeInitializationOutcome;
}

export async function runAuthoritativeRoomAction(input: {
  roomId: string;
  userId: string;
  modelId: string;
  modelProfileVersion: string;
  action: RoomActionInput;
}) {
  const sql = await getSql();
  const binding = (
    await sql<PersistedRoomKpBinding>`
      select ruleset_version, module_id, host_user_id, kp_model, kp_model_profile,
             kp_workflow_manifest, kp_context_planner_profile
      from rooms
      where id = ${input.roomId}
    `
  )[0];
  const profile = authoritativeKpProfileByBinding(
    binding?.kp_model,
    binding?.kp_model_profile,
  );
  const requestedProfile = authoritativeKpProfileByBinding(
    input.modelId,
    input.modelProfileVersion,
  );
  const bindingObservation = binding === undefined
    ? undefined
    : await roomStub(input.roomId).observe(trustedRoomPrincipal(input.userId));
  const boundModuleProfile = binding === undefined
    ? undefined
    : await projectedModuleProfile(binding.module_id, bindingObservation);
  const v3Binding = validateV3RoomBinding({
    binding,
    roomProfile: profile,
    requestedProfile,
    expectedModuleRef: boundModuleProfile?.moduleRef,
    observation: bindingObservation,
  });
  if (
    v3Binding.kind === "invalid"
    || binding === undefined
    || profile === undefined
    || boundModuleProfile === undefined
  ) {
    return v3BindingRejection();
  }
  const registry = createModelProfileRegistry([{
    profileRef: profile.modelProfileVersion,
    provider: profile.provider,
    modelId: profile.modelId,
    modelRevision: profile.modelRevision,
    supportedRoles: ["primary-kp", "narration"],
    validationSuiteVersion: "authoritative-kp-v3-role-validation-v1",
    validationStatus: "passed",
    structuredOutputMode: "strict-tool",
    contextWindowTokens: 64_000,
    latencyTier: "standard",
    costTier: "standard",
  }]);
  let productionContext = createV3ProductionContextPreparer({
    moduleProfile: boundModuleProfile,
    database: env.DB,
    registry,
    pinnedPrimaryKpProfileRef: profile.modelProfileVersion,
    plannerAdapter: createDisabledPlannerAdapter(),
    allowKpOnly: true,
    includeDynamicAuthoritativeFacts: isSocialResolutionKpProfile(profile),
  });
  const kp = createAuthoritativeKpAdapter({
    ai: authoritativeKpModelBinding(profile),
    profile,
    prepareV3Context: async (request, allowedFormIds) => {
      const exactModule = await projectedModuleProfile(binding.module_id, request.projection);
      if (exactModule === undefined) {
        throw new Error("CONTEXT_INSUFFICIENT");
      }
      if (productionContext.corpus.chunks.some((chunk) =>
        chunk.profileRef === exactModule.moduleRef.profileId) === false) {
        productionContext = createV3ProductionContextPreparer({
          moduleProfile: exactModule,
          database: env.DB,
          registry,
          pinnedPrimaryKpProfileRef: profile.modelProfileVersion,
          plannerAdapter: createDisabledPlannerAdapter(),
          allowKpOnly: true,
          includeDynamicAuthoritativeFacts: isSocialResolutionKpProfile(profile),
        });
      }
      const prepared = await productionContext.prepare(request, allowedFormIds);
      console.info(JSON.stringify(buildRoomTelemetryEvent({
        occurredAt: new Date().toISOString(),
        severity: "info",
        eventName: "kp.context.prepared",
        correlation: { roomId: input.roomId, principalId: input.userId },
        context: {
          profileRef: productionContext.profile.profileRef,
          planner: {
            mode: prepared.plannerReceipt.adapterMode,
            status: prepared.plannerReceipt.status,
            fallbackUsed: prepared.plannerReceipt.fallbackUsed,
          },
          retrieval: {
            mode: prepared.retrievalReceipt.retrievalMode,
            status: prepared.retrievalReceipt.status,
            fallbackUsed: prepared.retrievalReceipt.fallbackUsed,
            hitCountBucket: prepared.retrievalReceipt.hitCountBucket,
          },
        },
      })));
      return prepared;
    },
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: input.userId,
        receipt,
      })));
    },
  });
  return executeAuthoritativeRoomAction(input, kp);
}

export async function retryAuthoritativeViewerNarration(input: {
  roomId: string;
  userId: string;
  capability: string;
  modelId: string;
  modelProfileVersion: string;
}) {
  const sql = await getSql();
  const binding = (
    await sql<PersistedRoomKpBinding>`
      select ruleset_version, module_id, host_user_id, kp_model, kp_model_profile,
             kp_workflow_manifest, kp_context_planner_profile
      from rooms where id = ${input.roomId}
    `
  )[0];
  const roomProfile = authoritativeKpProfileByBinding(
    binding?.kp_model,
    binding?.kp_model_profile,
  );
  const requestedProfile = authoritativeKpProfileByBinding(
    input.modelId,
    input.modelProfileVersion,
  );
  const observation = binding === undefined
    ? undefined
    : await roomStub(input.roomId).observe(trustedRoomPrincipal(input.userId));
  const v3Binding = validateV3RoomBinding({
    binding,
    roomProfile,
    requestedProfile,
    expectedModuleRef: binding === undefined
      ? undefined
      : await expectedModuleRef(binding.module_id, observation),
    observation,
  });
  if (
    v3Binding.kind === "invalid"
    || roomProfile === undefined
  ) {
    return v3BindingRejection();
  }
  const kp = createAuthoritativeKpAdapter({
    ai: authoritativeKpModelBinding(roomProfile),
    profile: roomProfile,
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: input.userId,
        receipt,
      })));
    },
  });
  const outcome = await handleViewerNarrationRecovery({
    principal: trustedRoomPrincipal(input.userId),
    authority: telemetryRoomAuthority({
      roomId: input.roomId,
      userId: input.userId,
      requestId: input.capability,
    }),
    kp,
  }, input.capability);
  console.info(JSON.stringify(buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(),
    severity: outcome.narration === "published" ? "info" : "warn",
    eventName: "room.viewerNarrationRecovery.completed",
    requestId: input.capability,
    correlation: { roomId: input.roomId, principalId: input.userId },
    outcome: { kind: outcome.kind },
    failure: outcome.narration === "published"
      ? undefined
      : { code: "NARRATION_RECOVERY_PENDING" },
    measurements: { operationKind: "viewerNarrationRecovery" },
  })));
  return outcome;
}

export type AuthoritativeRoomCorrectionInput = {
  roomId: string;
  correctionId: string;
  receiptId: string;
  errorKind: string;
  explanation: string;
};

function v3BindingRejection() {
  return {
    kind: "rejected" as const,
    code: "v3BindingUnavailable",
    explanation: "The room's frozen V3 workflow and runtime profile binding is unavailable.",
    action: "notCommitted" as const,
    narration: "notApplicable" as const,
  };
}

function moduleRefFromProjection(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const readModel = record.readModel !== null
    && typeof record.readModel === "object"
    && !Array.isArray(record.readModel)
    ? record.readModel as Record<string, unknown>
    : record;
  const campaign = readModel.campaign !== null
    && typeof readModel.campaign === "object"
    && !Array.isArray(readModel.campaign)
    ? readModel.campaign as Record<string, unknown>
    : undefined;
  const candidate = campaign?.moduleRef ?? readModel.moduleRef;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const ref = candidate as Record<string, unknown>;
  return typeof ref.profileId === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(String(ref.profileHash))
    ? { profileId: ref.profileId, profileHash: String(ref.profileHash) }
    : undefined;
}

async function projectedModuleProfile(moduleId: string, projection: unknown) {
  const ref = moduleRefFromProjection(projection);
  const prefix = `module:${moduleId}:`;
  if (ref === undefined || !ref.profileId.startsWith(prefix)) return undefined;
  try {
    const profile = await authoritativeModuleProfile(moduleId, ref.profileId.slice(prefix.length));
    return profile.moduleRef.profileHash === ref.profileHash ? profile : undefined;
  } catch {
    return undefined;
  }
}

async function expectedModuleRef(moduleId: string, projection: unknown) {
  return (await projectedModuleProfile(moduleId, projection))?.moduleRef;
}

/**
 * Server-only entrypoint for applying an audited Receipt-bound correction.
 * No player route receives the opaque correction capability.
 */
export async function runAuthoritativeRoomCorrection(
  input: AuthoritativeRoomCorrectionInput,
) {
  const servicePrincipalId = "service:room-correction";
  const startedAt = Date.now();
  const sql = await getSql();
  const binding = (
    await sql<PersistedRoomKpBinding>`
      select ruleset_version, module_id, host_user_id, kp_model, kp_model_profile,
             kp_workflow_manifest, kp_context_planner_profile
      from rooms
      where id = ${input.roomId}
    `
  )[0];
  const profile = authoritativeKpProfileByBinding(
    binding?.kp_model,
    binding?.kp_model_profile,
  );
  const correctionObservation = binding === undefined
    ? undefined
    : await roomStub(input.roomId).observe(trustedRoomPrincipal(binding.host_user_id));
  const v3Binding = validateV3RoomBinding({
    binding,
    roomProfile: profile,
    expectedModuleRef: binding === undefined
      ? undefined
      : await expectedModuleRef(binding.module_id, correctionObservation),
    observation: correctionObservation,
  });
  if (v3Binding.kind === "invalid" || profile === undefined) return v3BindingRejection();
  const kp = createAuthoritativeKpAdapter({
    ai: authoritativeKpModelBinding(profile),
    profile,
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: servicePrincipalId,
        receipt,
      })));
    },
  });
  const stub = roomStub(input.roomId);
  const outcome = await handleRoomCorrection({
    authority: {
      commitCorrection(capability, request) {
        return stub.commitCorrection(capability, request);
      },
      deliveryPublicationStatus(query) {
        return stub.deliveryPublicationStatus(query);
      },
      beginDeliveryAudiencePublication(query) {
        return stub.beginDeliveryAudiencePublication(query);
      },
      failDeliveryAudiencePublication(authorization, failure) {
        return stub.failDeliveryAudiencePublication(authorization, failure);
      },
      publishDelivery(authorization, publication) {
        return stub.publishDelivery(authorization, publication);
      },
    },
    kp,
  }, roomServiceCapabilities().correction, {
    correctionId: input.correctionId,
    receiptId: input.receiptId,
    errorKind: input.errorKind,
    explanation: input.explanation,
  });
  const receipt = "receipt" in outcome
    && outcome.receipt !== null
    && typeof outcome.receipt === "object"
    ? outcome.receipt as Record<string, unknown>
    : undefined;
  console.info(JSON.stringify(buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(),
    severity: outcome.kind === "committed" ? "info" : "warn",
    eventName: "room.correction.completed",
    requestId: input.correctionId,
    correlation: {
      roomId: input.roomId,
      principalId: servicePrincipalId,
      rootActionId: receipt?.rootActionId,
      receiptId: receipt?.receiptId,
    },
    outcome: { kind: outcome.kind },
    failure: "code" in outcome ? { code: outcome.code } : undefined,
    measurements: {
      operationKind: "roomCorrection",
      durationMs: Date.now() - startedAt,
    },
    archive: {
      correctionIntegrity: outcome.kind === "committed"
        ? outcome.deliveryPending === true ? "deliveryPending" : "published"
        : "rejected",
    },
  })));
  return outcome;
}

async function executeAuthoritativeRoomAction(input: {
  roomId: string;
  userId: string;
  action: RoomActionInput;
}, kp: KpAdapterCapability) {
  const startedAt = Date.now();
  const principal = trustedRoomPrincipal(input.userId);
  const authority = telemetryRoomAuthority({
    roomId: input.roomId,
    userId: input.userId,
    requestId: input.action.kind === "acknowledge"
      ? input.action.deliveryId
      : input.action.submissionId,
    ...(input.action.kind === "acknowledge"
      ? {}
      : { submissionId: input.action.submissionId }),
  });
  const outcome = await handleRoomAction({ principal, authority, kp }, input.action);
  const receipt = "receipt" in outcome
    && outcome.receipt !== null
    && typeof outcome.receipt === "object"
    ? outcome.receipt as Record<string, unknown>
    : undefined;
  console.info(JSON.stringify(buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(),
    severity: outcome.kind === "retryableFailure" || outcome.kind === "needsKp"
      ? "warn"
      : outcome.kind === "rejected" ? "info" : "info",
    eventName: "room.action.completed",
    requestId: input.action.kind === "acknowledge"
      ? input.action.deliveryId
      : input.action.submissionId,
    correlation: {
      roomId: input.roomId,
      principalId: input.userId,
      submissionId: input.action.kind === "acknowledge"
        ? undefined
        : input.action.submissionId,
      rootActionId: receipt?.rootActionId,
      receiptId: receipt?.receiptId,
    },
    outcome: { kind: outcome.kind },
    failure: "code" in outcome
      ? { code: outcome.code }
      : outcome.kind === "needsKp"
        ? { code: "mechanicalDiagnostic" }
        : undefined,
    measurements: {
      operationKind: "roomAuthority",
      durationMs: Date.now() - startedAt,
    },
  })));
  return outcome;
}

type AuthoritativeAdministrationResult =
  | { ok: true; receipt?: unknown }
  | { ok: false; code: string; error: string };

function administrationResult(value: unknown): AuthoritativeAdministrationResult {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "committed") {
      return {
        ok: true,
        ...(record.receipt === undefined ? {} : { receipt: record.receipt }),
      };
    }
    return {
      ok: false,
      code: typeof record.code === "string" ? record.code : "roomAdministrationRejected",
      error: typeof record.explanation === "string"
        ? record.explanation
        : "房间权威没有接受这项席位变更。",
    };
  }
  return {
    ok: false,
    code: "roomAdministrationUnavailable",
    error: "房间权威暂时没有回应。",
  };
}

async function applyAuthoritativeRoomAdministration(
  roomId: string,
  command: Record<string, unknown>,
): Promise<AuthoritativeAdministrationResult> {
  const value = await roomStub(roomId).applyRoomAdministration(
    roomServiceCapabilities().roomAdministration,
    command,
  );
  return administrationResult(value);
}

export async function prepareAuthoritativeRoomDeletion(input: {
  roomId: string;
  userId: string;
}) {
  return await roomStub(input.roomId).prepareDeletion(
    roomServiceCapabilities().roomDeletion,
    trustedRoomPrincipal(input.userId),
  ) as unknown;
}

export async function cancelAuthoritativeRoomDeletion(input: {
  roomId: string;
  userId: string;
}) {
  return await roomStub(input.roomId).cancelDeletion(
    roomServiceCapabilities().roomDeletion,
    trustedRoomPrincipal(input.userId),
  ) as unknown;
}

export async function finalizeAuthoritativeRoomDeletion(input: {
  roomId: string;
}) {
  return await roomStub(input.roomId).finalizeDeletion(
    roomServiceCapabilities().roomDeletion,
  ) as unknown;
}

export async function activateAuthoritativeMember(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  role: "player" | "observer";
  characterId?: string;
}): Promise<AuthoritativeAdministrationResult> {
  const seat = await applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: `${input.commandId}:seat`,
    kind: "grantSeat",
    principal: { id: input.principalId, sessionVersion: 1 },
    role: input.role,
  });
  if (!seat.ok || input.characterId === undefined) return seat;

  const control = await applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: `${input.commandId}:control`,
    kind: "grantControl",
    characterId: input.characterId,
    seatId: `seat:${input.principalId}`,
  });
  if (control.ok) return control;

  await applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: `${input.commandId}:rollback`,
    kind: "departMember",
    principalId: input.principalId,
    reason: "characterControlRestoreRejected",
  });
  return control;
}

export function removeAuthoritativeMember(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  reason: string;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "removeMember",
    principalId: input.principalId,
    reason: input.reason,
  });
}

export function departAuthoritativeMember(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  reason: string;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "departMember",
    principalId: input.principalId,
    reason: input.reason,
  });
}

export async function transferAndDepartAuthoritativeHost(input: {
  roomId: string;
  commandId: string;
  fromPrincipalId: string;
  toPrincipalId: string;
  reason: string;
}): Promise<AuthoritativeAdministrationResult> {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "transferHostAndDepart",
    fromPrincipalId: input.fromPrincipalId,
    toPrincipalId: input.toPrincipalId,
    reason: input.reason,
  });
}

export function materializeAuthoritativeCharacter(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  character: AuthoritativeCharacterSeed;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "materializeCharacter",
    principalId: input.principalId,
    seatId: `seat:${input.principalId}`,
    character: input.character,
  });
}

export function introduceAuthoritativeSuccessor(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  predecessorCharacterId: string;
  character: AuthoritativeCharacterSeed;
  worldEntry: string;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "introduceSuccessor",
    principalId: input.principalId,
    predecessorCharacterId: input.predecessorCharacterId,
    character: input.character,
    worldEntry: input.worldEntry,
  });
}

export type AuthoritativePartyAction =
  | { kind: "invite"; targetPrincipalId: string }
  | { kind: "cancelInvitation" }
  | { kind: "answerInvitation"; accept: boolean }
  | { kind: "leave" }
  | { kind: "transferLeadership"; targetPrincipalId: string };

function directPartyActionPlan(
  goal: string,
  method: string,
  mechanicalProposal: SemanticActionPlan,
): KpProposalDraft {
  return {
    kind: "directSuccess",
    goal,
    method,
    publicBasisRefs: [],
    privateBasisRefs: [],
    adjudicationPrecedent: null,
    risk: null,
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [],
    mechanicalProposal,
    scene: {
      question: goal,
      pressure: "",
      opportunities: [],
      conclusionCandidate: null,
    },
  };
}

function projectedPendingInput(
  observation: unknown,
  kind: "partyInvitation" | "partyMoveConsent",
  access?: "controller" | "initiator",
): string | undefined {
  if (!observation || typeof observation !== "object") return undefined;
  const readModel = (observation as { readModel?: unknown }).readModel;
  if (!readModel || typeof readModel !== "object") return undefined;
  const pending = (readModel as { pendingInputs?: unknown }).pendingInputs;
  if (!Array.isArray(pending)) return undefined;
  const match = pending.find((entry) =>
    entry
    && typeof entry === "object"
    && (entry as { kind?: unknown }).kind === kind
    && (access === undefined || (entry as { access?: unknown }).access === access)
    && typeof (entry as { pendingInputId?: unknown }).pendingInputId === "string"
  ) as { pendingInputId: string } | undefined;
  return match?.pendingInputId;
}

function projectedActiveCharacterId(observation: unknown, principalId: string): string | undefined {
  if (!observation || typeof observation !== "object") return undefined;
  const readModel = (observation as { readModel?: unknown }).readModel;
  if (!readModel || typeof readModel !== "object") return undefined;
  const roomMembers = (readModel as { roomMembers?: unknown }).roomMembers;
  if (!Array.isArray(roomMembers)) return undefined;
  const member = roomMembers.find((entry) => entry && typeof entry === "object"
    && (entry as { principalId?: unknown }).principalId === principalId) as {
      characterIds?: unknown;
    } | undefined;
  if (!Array.isArray(member?.characterIds) || member.characterIds.length !== 1
    || typeof member.characterIds[0] !== "string") return undefined;
  return member.characterIds[0];
}

export async function runAuthoritativePartyAction(input: {
  roomId: string;
  userId: string;
  modelId: string;
  modelProfileVersion: string;
  submissionId: string;
  action: AuthoritativePartyAction;
}) {
  const requestedProfile = authoritativeKpProfileByBinding(
    input.modelId,
    input.modelProfileVersion,
  );
  const sql = await getSql();
  const binding = (
    await sql<PersistedRoomKpBinding>`
      select ruleset_version, module_id, host_user_id, kp_model, kp_model_profile,
             kp_workflow_manifest, kp_context_planner_profile
      from rooms
      where id = ${input.roomId}
    `
  )[0];
  const roomProfile = authoritativeKpProfileByBinding(
    binding?.kp_model,
    binding?.kp_model_profile,
  );
  if (requestedProfile === undefined) {
    return v3BindingRejection();
  }
  const partyObservation = binding === undefined
    ? undefined
    : await roomStub(input.roomId).observe(trustedRoomPrincipal(input.userId));
  const v3Binding = validateV3RoomBinding({
    binding,
    roomProfile,
    requestedProfile,
    expectedModuleRef: binding === undefined
      ? undefined
      : await expectedModuleRef(binding.module_id, partyObservation),
    observation: partyObservation,
  });
  if (v3Binding.kind === "invalid" || roomProfile === undefined) {
    return v3BindingRejection();
  }
  const profile = roomProfile;
  let action: RoomActionInput;
  let proposal: KpProposalDraft | undefined;
  switch (input.action.kind) {
    case "invite": {
      const targetCharacterId = projectedActiveCharacterId(
        partyObservation,
        input.action.targetPrincipalId,
      );
      if (targetCharacterId === undefined) {
        return {
          kind: "rejected" as const,
          code: "targetSeatUnavailable",
          explanation: "目标席位当前没有唯一的活跃角色。",
        };
      }
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: `我邀请 ${targetCharacterId} 同行。`,
      };
      proposal = directPartyActionPlan(
        `邀请 ${targetCharacterId} 同行`,
        "由当前角色发出明确的同行邀请",
        {
          operation: "changeParty",
          partyAction: "inviteMember",
          memberRefs: [targetCharacterId],
        },
      );
      break;
    }
    case "cancelInvitation": {
      const pendingInputId = projectedPendingInput(
        partyObservation,
        "partyInvitation",
        "initiator",
      );
      if (pendingInputId === undefined) {
        return {
          kind: "rejected" as const,
          code: "partyInvitationUnavailable",
          explanation: "当前没有由你发出且仍在等待回应的同行邀请。",
        };
      }
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: "我取消自己尚未得到回应的同行邀请。",
      };
      proposal = directPartyActionPlan(
        "取消尚未得到回应的同行邀请",
        "撤回由当前角色发出的待决邀请",
        {
          operation: "changeParty",
          partyAction: "cancelInvitation",
          pendingInputRef: pendingInputId,
        },
      );
      break;
    }
    case "answerInvitation": {
      const pendingInputId = projectedPendingInput(
        partyObservation,
        "partyInvitation",
        "controller",
      );
      if (pendingInputId === undefined) {
        return {
          kind: "rejected" as const,
          code: "partyInvitationUnavailable",
          explanation: "当前没有等待你回答的同行邀请。",
        };
      }
      action = {
        kind: "answer",
        submissionId: input.submissionId,
        pendingInputId,
        answer: { accept: input.action.accept },
      };
      proposal = undefined;
      break;
    }
    case "leave":
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: "我明确离开当前同行队伍，之后独自行动。",
      };
      proposal = directPartyActionPlan(
        "离开当前同行队伍",
        "当前角色明确选择独自行动",
        { operation: "changeParty", partyAction: "leave" },
      );
      break;
    case "transferLeadership": {
      const targetCharacterId = projectedActiveCharacterId(
        partyObservation,
        input.action.targetPrincipalId,
      );
      if (targetCharacterId === undefined) {
        return {
          kind: "rejected" as const,
          code: "targetSeatUnavailable",
          explanation: "目标席位当前没有唯一的活跃角色。",
        };
      }
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: `我把同行队伍的组织权交给 ${targetCharacterId}。`,
      };
      proposal = directPartyActionPlan(
        `把同行队伍的组织权交给 ${targetCharacterId}`,
        "当前队长明确转交组织权",
        {
          operation: "changeParty",
          partyAction: "transferLeadership",
          memberRefs: [targetCharacterId],
        },
      );
      break;
    }
  }
  const narration = createAuthoritativeKpAdapter({
    ai: authoritativeKpModelBinding(profile),
    profile,
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: input.userId,
        receipt,
      })));
    },
  });
  return executeAuthoritativeRoomAction({
    roomId: input.roomId,
    userId: input.userId,
    action,
  }, {
    propose: async () => {
      if (proposal === undefined) {
        throw new Error("Authenticated party answers must resolve without a KP proposal.");
      }
      return structuredClone(proposal);
    },
    narrate: (request) => narration.narrate(request as unknown as KpNarrationRequest),
  });
}

export function observeAuthoritativeRoom(
  roomId: string,
  userId: string,
  query?: ProjectionQuery,
) {
  return telemetryRoomAuthority({ roomId, userId }).observe(
    trustedRoomPrincipal(userId),
    query,
  );
}

export function acknowledgeAuthoritativeDelivery(
  roomId: string,
  userId: string,
  deliveryId: string,
) {
  return telemetryRoomAuthority({ roomId, userId, requestId: deliveryId }).acknowledge(
    trustedRoomPrincipal(userId),
    deliveryId,
  );
}

function resourceCounts(sheet: CharacterSheet) {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(sheet.resources ?? {})) {
    if (typeof value === "number") values[key] = value;
    else if (value && typeof value === "object") {
      const record = value as { max?: unknown; used?: unknown };
      if (typeof record.max === "number") {
        values[key] = Math.max(0, record.max - (typeof record.used === "number" ? record.used : 0));
      }
    }
  }
  if (sheet.classId === "wizard") {
    values.arcaneRecovery = sheet.resources?.arcaneRecovery ? 0 : 1;
  }
  values.inspiration = sheet.inspiration ? 1 : 0;
  return values;
}
