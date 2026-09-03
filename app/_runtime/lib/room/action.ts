import { INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE } from "../rules/profiles/manifests";
import type { ProfileRef } from "../rules/profiles/types";
import { frozenRenderableClaimsConform } from "../rules/authority-read";
import type { KpProposalRequestPurpose } from "../kp/authoritative-types";
import {
  isTacticalPosition,
  isTacticalSpatialRevision,
  type TacticalPosition,
} from "../rules/tactical-projection";

type UnknownRecord = Record<string, unknown>;

export type RoomActionInput =
  | {
      kind: "intent";
      submissionId: string;
      text: string;
      acknowledgementId?: string;
    }
  | {
      kind: "answer";
      submissionId: string;
      pendingInputId: string;
      answer: unknown;
      displayText?: string;
      acknowledgementId?: string;
    }
  | { kind: "retry"; submissionId: string; rootActionId: string }
  | {
      kind: "gear";
      submissionId: string;
      action: "wear" | "stow";
      slot: string;
      itemId?: string;
    }
  | {
      kind: "itemActivity";
      submissionId: string;
      itemEntryId: string;
    }
  | {
      kind: "environmentInteract";
      submissionId: string;
      featureId: string;
      intent: "open" | "close";
    }
  | {
      kind: "environmentAbility";
      submissionId: string;
      featureId: string;
      abilityRef: string;
    }
  | {
      kind: "movement";
      submissionId: string;
      movementMode: "walk";
      spatialRevision: `sha256:${string}`;
      path: TacticalPosition[];
    }
  | { kind: "combatEndTurn"; submissionId: string }
  | {
      kind: "restStart";
      submissionId: string;
      restKind: "short" | "long";
      mode: "personal" | "group";
      hitDiceToSpend: number;
      arcaneRecoverySlotLevels: number[];
    }
  | { kind: "restInterrupt"; submissionId: string }
  | { kind: "safetyPause"; submissionId: string }
  | {
      kind: "safetyAdjust";
      submissionId: string;
      presentationAdjustment: "fadeToBlack" | "reduceDetail" | "skipSensitiveContent";
    }
  | {
      kind: "errorReport";
      submissionId: string;
      receiptId: string;
      concern: "rules" | "facts";
      explanation: string;
    }
  | { kind: "roll"; submissionId: string; randomnessId: string }
  | { kind: "acknowledge"; deliveryId: string };

export const ROOM_ACTION_STATES = [
  "notCommitted",
  "awaitingInput",
  "committed",
  "resolvedInWorld",
  "concluded",
] as const;

export const ROOM_NARRATION_STATES = [
  "notApplicable",
  "pending",
  "published",
  "rejected",
  "retryableFailure",
] as const;

export type RoomActionState = typeof ROOM_ACTION_STATES[number];
export type RoomNarrationState = typeof ROOM_NARRATION_STATES[number];

type InternalRoomActionOutcome =
  | {
      kind: "committed";
      receipt: unknown;
      readModel: unknown;
      delivery?: unknown;
      deliveryPending?: true;
      audienceNarrations?: AudiencePublicationResult[];
      narrationFailureState?: "rejected" | "retryableFailure";
      narrationFailureCode?: NarrationPublicFailureCode;
    }
  | {
      kind: "awaitingInput";
      receipt: unknown;
      readModel: unknown;
      pending: unknown;
    }
  | {
      kind: "awaitingPlayerRoll";
      readModel: unknown;
      pendingPlayerRolls: unknown[];
    }
  | { kind: "needsKp"; receipt?: unknown; code?: string; retryAfter?: number }
  | { kind: "retryableFailure"; receipt?: unknown; code: string; retryAfter?: number }
  | { kind: "rejected"; receipt?: unknown; code: string; explanation: string }
  | {
      kind: "concluded";
      receipt: unknown;
      readModel: unknown;
      delivery?: unknown;
      deliveryPending?: true;
      audienceNarrations?: AudiencePublicationResult[];
      narrationFailureState?: "rejected" | "retryableFailure";
      narrationFailureCode?: NarrationPublicFailureCode;
    };

export type RoomActionOutcome = InternalRoomActionOutcome & {
  action: RoomActionState;
  narration: RoomNarrationState;
};

export type RoomAuthorityCapability = {
  prepare(principal: unknown, input: RoomActionInput): Promise<unknown>;
  observe(principal: unknown, query?: unknown): Promise<unknown>;
  commit(principal: unknown, preparedActionId: string, rulesInput: UnknownRecord): Promise<unknown>;
  resumePlayerRandomness?(principal: unknown, randomnessId: string): Promise<unknown>;
  acknowledge(principal: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus?(query: { publishCapability: unknown }): Promise<unknown>;
  beginDeliveryAudiencePublication?(query: {
    publishCapability: unknown;
    audienceId: string;
  }): Promise<unknown>;
  failDeliveryAudiencePublication?(
    authorization: unknown,
    failure: UnknownRecord,
  ): Promise<unknown>;
  beginViewerNarrationRecovery?(principal: unknown, capability: string): Promise<unknown>;
  publishViewerNarrationRecovery?(
    principal: unknown,
    capability: string,
    publication: UnknownRecord,
  ): Promise<unknown>;
  failViewerNarrationRecovery?(
    principal: unknown,
    capability: string,
    failure: UnknownRecord,
  ): Promise<unknown>;
  publishDelivery?(authorization: unknown, publication: UnknownRecord): Promise<unknown>;
};

type DeliveryPublicationAuthority = Pick<
  RoomAuthorityCapability,
  | "beginDeliveryAudiencePublication"
  | "deliveryPublicationStatus"
  | "failDeliveryAudiencePublication"
  | "publishDelivery"
>;

export type KpAdapterCapability = {
  propose(request: UnknownRecord): Promise<unknown>;
  decideDueActorPlan(request: UnknownRecord): Promise<unknown>;
  narrate(request: UnknownRecord): Promise<unknown>;
};

export type RoomActionContext = {
  principal: unknown;
  authority: RoomAuthorityCapability;
  kp: KpAdapterCapability;
};

export type RoomCorrectionContext = {
  authority: DeliveryPublicationAuthority & {
    commitCorrection(capability: unknown, request: unknown): Promise<unknown>;
  };
  kp: Pick<KpAdapterCapability, "narrate">;
};

export type RoomCorrectionOutcome =
  | {
      kind: "committed";
      correctionId: string;
      strategy: "forwardCompensation" | "causalBranch";
      activeBranchId: string;
      supersededRootActionIds: string[];
      receipt: unknown;
      deliveryPending?: true;
      action: "committed";
      narration: "published" | "rejected" | "retryableFailure";
    }
  | (Extract<InternalRoomActionOutcome, { kind: "retryableFailure" | "rejected" }> & {
      action: "notCommitted";
      narration: "notApplicable";
    });

const MAX_PROPOSAL_ATTEMPTS = 2;
const MAX_NARRATION_CONCURRENCY = 4;
const MAX_ACTION_PHASE_TRANSITIONS = 2;

type DeliveryAudience = {
  audienceId: string;
  projection: unknown;
  principalId: string;
  narrationInputMode: NarrationInputMode;
  viewerKey?: string;
  renderableClaims?: UnknownRecord;
};

type NarrationInputMode =
  | "observerProjection-v1"
  | "frozenRenderableClaims-vnext-1";

type DeliveryPlan = {
  deliveryProtocol: ProfileRef;
  publishCapability: unknown;
  rootActionId: string;
  receiptId: string;
  audiences: DeliveryAudience[];
};

const PROPOSAL_PUBLIC_FAILURE_CODES = [
  "PROPOSAL_PROVIDER_TIMEOUT",
  "PROPOSAL_FORM_INVALID",
  "PROPOSAL_REFERENCE_INVALID",
  "PROPOSAL_RULES_DIAGNOSTIC",
  "PROPOSAL_REPAIR_EXHAUSTED",
  "CONTEXT_INSUFFICIENT",
] as const;

const NARRATION_PUBLIC_FAILURE_CODES = [
  "NARRATION_PROVIDER_TIMEOUT",
  "NARRATION_BODY_INVALID",
  "NARRATION_GROUNDING_REJECTED",
  "NARRATION_PUBLICATION_FAILED",
] as const;

type ProposalPublicFailureCode = typeof PROPOSAL_PUBLIC_FAILURE_CODES[number];
type NarrationPublicFailureCode = typeof NARRATION_PUBLIC_FAILURE_CODES[number];

const PROPOSAL_PUBLIC_FAILURE_CODE_SET = new Set<string>(PROPOSAL_PUBLIC_FAILURE_CODES);
const NARRATION_PUBLIC_FAILURE_CODE_SET = new Set<string>(NARRATION_PUBLIC_FAILURE_CODES);

function proposalPublicFailureCode(value: unknown): ProposalPublicFailureCode | undefined {
  return typeof value === "string" && PROPOSAL_PUBLIC_FAILURE_CODE_SET.has(value)
    ? value as ProposalPublicFailureCode
    : undefined;
}

function narrationPublicFailureCode(value: unknown): NarrationPublicFailureCode | undefined {
  return typeof value === "string" && NARRATION_PUBLIC_FAILURE_CODE_SET.has(value)
    ? value as NarrationPublicFailureCode
    : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rejectedValidation(explanation: string): InternalRoomActionOutcome {
  return { kind: "rejected", code: "validation", explanation };
}

function rejectedDeferred(explanation: string): InternalRoomActionOutcome {
  return { kind: "rejected", code: "tacticalMapAbilityDeferred", explanation };
}

function hasOnlyKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in record)
    && Object.keys(record).every((key) => allowed.has(key));
}

function rebuildInput(input: unknown): RoomActionInput | InternalRoomActionOutcome {
  if (!isRecord(input)) return rejectedValidation("行动输入必须是对象。");

  if (input.kind === "intent") {
    const submissionId = requiredString(input, "submissionId");
    const text = requiredString(input, "text");
    if (!submissionId || !text) {
      return rejectedValidation("意图缺少 submissionId 或 text。");
    }
    const acknowledgementId = optionalString(input, "acknowledgementId");
    return {
      kind: "intent",
      submissionId,
      text,
      ...(acknowledgementId ? { acknowledgementId } : {}),
    };
  }

  if (input.kind === "answer") {
    const submissionId = requiredString(input, "submissionId");
    const pendingInputId = requiredString(input, "pendingInputId");
    if (!submissionId || !pendingInputId || !("answer" in input)) {
      return rejectedValidation("待决回答缺少 submissionId、pendingInputId 或 answer。");
    }
    const acknowledgementId = optionalString(input, "acknowledgementId");
    const displayText = optionalString(input, "displayText");
    return {
      kind: "answer",
      submissionId,
      pendingInputId,
      answer: input.answer,
      ...(displayText ? { displayText } : {}),
      ...(acknowledgementId ? { acknowledgementId } : {}),
    };
  }

  if (input.kind === "retry") {
    const submissionId = requiredString(input, "submissionId");
    const rootActionId = requiredString(input, "rootActionId");
    if (!submissionId || !rootActionId) {
      return rejectedValidation("重试缺少 submissionId 或 rootActionId。");
    }
    return { kind: "retry", submissionId, rootActionId };
  }

  if (input.kind === "roll") {
    const submissionId = requiredString(input, "submissionId");
    const randomnessId = requiredString(input, "randomnessId");
    if (!submissionId || !randomnessId
      || !hasOnlyKeys(input, ["kind", "randomnessId", "submissionId"], [])) {
      return rejectedValidation("掷骰请求缺少 submissionId 或 randomnessId。");
    }
    return { kind: "roll", submissionId, randomnessId };
  }

  if (input.kind === "gear") {
    const submissionId = requiredString(input, "submissionId");
    const slot = requiredString(input, "slot");
    const itemId = optionalString(input, "itemId");
    const wear = input.action === "wear";
    const stow = input.action === "stow";
    if (
      !submissionId
      || !slot
      || (!wear && !stow)
      || (wear && !itemId)
      || (stow && itemId !== undefined)
      || !hasOnlyKeys(
        input,
        ["action", "kind", "slot", "submissionId"],
        wear ? ["itemId"] : [],
      )
    ) return rejectedValidation("装备变更只接受 action、slot、itemId 与 submissionId。");
    return {
      kind: "gear",
      submissionId,
      action: input.action as "wear" | "stow",
      slot,
      ...(itemId === undefined ? {} : { itemId }),
    };
  }

  if (input.kind === "itemActivity") {
    const submissionId = requiredString(input, "submissionId");
    const itemEntryId = requiredString(input, "itemEntryId");
    if (
      !submissionId
      || !itemEntryId
      || !hasOnlyKeys(input, ["itemEntryId", "kind", "submissionId"], [])
    ) return rejectedValidation("物品使用只接受 itemEntryId 与 submissionId。");
    return { kind: "itemActivity", submissionId, itemEntryId };
  }

  if (input.kind === "environmentInteract") {
    const submissionId = requiredString(input, "submissionId");
    const featureId = requiredString(input, "featureId");
    const intent = input.intent;
    if (
      !submissionId
      || !featureId
      || (intent !== "open" && intent !== "close")
      || !hasOnlyKeys(
        input,
        ["featureId", "intent", "kind", "submissionId"],
        [],
      )
    ) return rejectedValidation("环境交互只接受 featureId、open/close intent 与 submissionId。");
    return { kind: "environmentInteract", submissionId, featureId, intent };
  }

  if (input.kind === "environmentAbility") {
    const submissionId = requiredString(input, "submissionId");
    const featureId = requiredString(input, "featureId");
    const abilityRef = requiredString(input, "abilityRef");
    if (
      !submissionId
      || !featureId
      || !abilityRef
      || !hasOnlyKeys(
        input,
        ["abilityRef", "featureId", "kind", "submissionId"],
        [],
      )
    ) return rejectedValidation("环境能力只接受 abilityRef、featureId 与 submissionId。");
    return { kind: "environmentAbility", submissionId, featureId, abilityRef };
  }

  if (input.kind === "ability") {
    const submissionId = requiredString(input, "submissionId");
    const abilityRef = requiredString(input, "abilityRef");
    const parameters = isRecord(input.parameters) ? input.parameters : undefined;
    const areaOrigin = parameters?.areaOrigin;
    const slotLevel = parameters && requiredString(parameters, "slotLevel");
    if (
      !submissionId
      || !abilityRef
      || !parameters
      || !isTacticalPosition(areaOrigin)
      || !slotLevel
      || !/^\d+$/.test(slotLevel)
      || Number(slotLevel) < 1
      || !hasOnlyKeys(input, ["abilityRef", "kind", "parameters", "submissionId"], [])
      || !hasOnlyKeys(parameters, ["areaOrigin", "slotLevel"], [])
    ) {
      return rejectedValidation("区域能力只接受 abilityRef、规范原点、法术环位与 submissionId。");
    }
    return rejectedDeferred("地图点选区域施法后续支持；请继续使用当前已有的战斗操作。");
  }

  if (input.kind === "movement") {
    const submissionId = requiredString(input, "submissionId");
    if (
      !submissionId
      || input.movementMode !== "walk"
      || !isTacticalSpatialRevision(input.spatialRevision)
      || !Array.isArray(input.path)
      || input.path.length < 2
      || input.path.length > 64
      || !input.path.every(isTacticalPosition)
      || !hasOnlyKeys(
        input,
        ["kind", "movementMode", "path", "spatialRevision", "submissionId"],
        [],
      )
    ) return rejectedValidation("移动只接受 walk、当前空间版本与规范路径。");
    return {
      kind: "movement",
      submissionId,
      movementMode: "walk",
      spatialRevision: input.spatialRevision,
      path: structuredClone(input.path),
    };
  }

  if (input.kind === "combatEndTurn") {
    const submissionId = requiredString(input, "submissionId");
    if (!submissionId || !hasOnlyKeys(input, ["kind", "submissionId"], [])) {
      return rejectedValidation("结束回合只接受 submissionId。");
    }
    return { kind: "combatEndTurn", submissionId };
  }

  if (input.kind === "restStart") {
    const submissionId = requiredString(input, "submissionId");
    const restKind = input.restKind;
    const mode = input.mode;
    const hitDiceToSpend = input.hitDiceToSpend;
    const arcaneRecoverySlotLevels = input.arcaneRecoverySlotLevels;
    if (
      !submissionId
      || (restKind !== "short" && restKind !== "long")
      || (mode !== "personal" && mode !== "group")
      || !Number.isSafeInteger(hitDiceToSpend)
      || Number(hitDiceToSpend) < 0
      || Number(hitDiceToSpend) > 20
      || !Array.isArray(arcaneRecoverySlotLevels)
      || arcaneRecoverySlotLevels.length > 20
      || !arcaneRecoverySlotLevels.every((level) =>
        Number.isSafeInteger(level) && Number(level) >= 1 && Number(level) <= 5)
      || (restKind === "long"
        && (Number(hitDiceToSpend) !== 0 || arcaneRecoverySlotLevels.length !== 0))
      || !hasOnlyKeys(input, [
        "arcaneRecoverySlotLevels",
        "hitDiceToSpend",
        "kind",
        "mode",
        "restKind",
        "submissionId",
      ], [])
    ) return rejectedValidation("休整只接受规范的类型、范围、恢复选择与 submissionId。");
    return {
      kind: "restStart",
      submissionId,
      restKind,
      mode,
      hitDiceToSpend: Number(hitDiceToSpend),
      arcaneRecoverySlotLevels: arcaneRecoverySlotLevels
        .map(Number)
        .sort((left, right) => left - right),
    };
  }

  if (input.kind === "restInterrupt") {
    const submissionId = requiredString(input, "submissionId");
    if (!submissionId || !hasOnlyKeys(input, ["kind", "submissionId"], [])) {
      return rejectedValidation("中断休整只接受 submissionId。");
    }
    return { kind: "restInterrupt", submissionId };
  }

  if (input.kind === "safetyPause") {
    const submissionId = requiredString(input, "submissionId");
    if (!submissionId || !hasOnlyKeys(input, ["kind", "submissionId"], [])) {
      return rejectedValidation("安全暂停只接受 submissionId，不接受原因或自由文本。");
    }
    return { kind: "safetyPause", submissionId };
  }

  if (input.kind === "safetyAdjust") {
    const submissionId = requiredString(input, "submissionId");
    const presentationAdjustment = input.presentationAdjustment;
    if (
      !submissionId
      || ![
        "fadeToBlack",
        "reduceDetail",
        "skipSensitiveContent",
      ].includes(String(presentationAdjustment))
      || !hasOnlyKeys(
        input,
        ["kind", "presentationAdjustment", "submissionId"],
        [],
      )
    ) {
      return rejectedValidation("安全调整只接受已注册的最小呈现选项。");
    }
    return {
      kind: "safetyAdjust",
      submissionId,
      presentationAdjustment: presentationAdjustment as Extract<RoomActionInput, {
        kind: "safetyAdjust";
      }>["presentationAdjustment"],
    };
  }

  if (input.kind === "errorReport") {
    const submissionId = requiredString(input, "submissionId");
    const receiptId = requiredString(input, "receiptId");
    const explanation = requiredString(input, "explanation")?.trim();
    const concern = input.concern;
    if (
      !submissionId
      || !receiptId
      || !explanation
      || explanation.length > 500
      || (concern !== "rules" && concern !== "facts")
      || !hasOnlyKeys(
        input,
        ["concern", "explanation", "kind", "receiptId", "submissionId"],
        [],
      )
    ) {
      return rejectedValidation("错误报告只接受可见 Receipt、规则/事实疑问与最小说明。");
    }
    return {
      kind: "errorReport",
      submissionId,
      receiptId,
      concern,
      explanation,
    };
  }

  if (input.kind === "acknowledge") {
    const deliveryId = requiredString(input, "deliveryId");
    if (!deliveryId) return rejectedValidation("确认缺少 deliveryId。");
    return { kind: "acknowledge", deliveryId };
  }

  return rejectedValidation("不支持的行动输入类型。");
}

function isRejectedValidation(
  value: RoomActionInput | InternalRoomActionOutcome,
): value is InternalRoomActionOutcome {
  return value.kind === "rejected";
}

function copyOptionalReceipt(source: UnknownRecord, target: UnknownRecord) {
  if ("receipt" in source) target.receipt = source.receipt;
}

function copyOptionalRetryAfter(source: UnknownRecord, target: UnknownRecord) {
  if (typeof source.retryAfter === "number") target.retryAfter = source.retryAfter;
}

const PROTECTED_REFERENCE_FAILURE_CODES = new Set([
  "deliveryUnavailable",
  "invalidPreparedAction",
  "pendingInputUnauthorized",
  "pendingInputUnavailable",
  "preparedActionUnauthorized",
  "privateOrUnknownReference",
  "submissionUnauthorized",
]);

function publicFailure(
  value: UnknownRecord,
  actionKind?: RoomActionInput["kind"],
): InternalRoomActionOutcome | undefined {
  if (value.kind === "rejected") {
    const internalCode = typeof value.code === "string" ? value.code : "rejected";
    if (actionKind === "movement") {
      if (internalCode === "spatialStateChanged") {
        return {
          kind: "rejected",
          code: "spatialStateChanged",
          explanation: "战术空间已变化，请按当前视图重新选择路径。",
        };
      }
      if ([
        "invalidRulesInput",
        "privateOrUnknownReference",
        "scopeConflict",
      ].includes(internalCode)) {
        return {
          kind: "rejected",
          code: "movementUnavailable",
          explanation: "该移动当前不可用。",
        };
      }
    }
    if (internalCode === "presentationUnavailable") {
      const result: UnknownRecord = {
        kind: "rejected",
        code: "presentationUnavailable",
        explanation: "当前呈现不可用，请保持在已提交的稳定状态。",
      };
      copyOptionalReceipt(value, result);
      return result as InternalRoomActionOutcome;
    }
    if (PROTECTED_REFERENCE_FAILURE_CODES.has(internalCode)) {
      const result: UnknownRecord = {
        kind: "rejected",
        code: "referenceUnavailable",
        explanation: "该对象当前不可用。",
      };
      copyOptionalReceipt(value, result);
      return result as InternalRoomActionOutcome;
    }
    const result: UnknownRecord = {
      kind: "rejected",
      code: internalCode,
      explanation:
        typeof value.explanation === "string" ? value.explanation : "当前行动被拒绝。",
    };
    copyOptionalReceipt(value, result);
    return result as InternalRoomActionOutcome;
  }

  if (value.kind === "retryableFailure") {
    const result: UnknownRecord = {
      kind: "retryableFailure",
      code: typeof value.code === "string" ? value.code : "authorityTransient",
    };
    copyOptionalReceipt(value, result);
    copyOptionalRetryAfter(value, result);
    return result as InternalRoomActionOutcome;
  }

  if (value.kind === "needsKp" && !hasDiagnostics(value)) {
    const result: UnknownRecord = { kind: "needsKp", receipt: value.receipt };
    if (typeof value.code === "string") result.code = value.code;
    copyOptionalRetryAfter(value, result);
    return result as InternalRoomActionOutcome;
  }

  return undefined;
}

function modelFailure(error: unknown, receipt?: unknown): InternalRoomActionOutcome {
  const candidate = isRecord(error) ? error : undefined;
  const code = candidate?.code;
  const explicit = proposalPublicFailureCode(candidate?.publicCode);
  const invocationReceipt = isRecord(candidate?.modelInvocationReceipt)
    ? candidate.modelInvocationReceipt
    : undefined;
  const failureStage = invocationReceipt?.failureStage;
  const publicCode = explicit
    ?? (failureStage === "projectionBinding" || failureStage === "proposalReference"
      ? "PROPOSAL_REFERENCE_INVALID"
      : failureStage === "proposalSchema" || failureStage === "structuredOutput"
        ? "PROPOSAL_FORM_INVALID"
        : code === "modelPermanent"
          ? "PROPOSAL_FORM_INVALID"
          : "PROPOSAL_PROVIDER_TIMEOUT");
  if (
    publicCode === "PROPOSAL_RULES_DIAGNOSTIC"
    || publicCode === "PROPOSAL_REPAIR_EXHAUSTED"
  ) {
    const result: UnknownRecord = { kind: "needsKp", code: publicCode };
    if (receipt !== undefined) result.receipt = receipt;
    if (typeof candidate?.retryAfter === "number") result.retryAfter = candidate.retryAfter;
    return result as InternalRoomActionOutcome;
  }
  if (
    publicCode === "PROPOSAL_FORM_INVALID"
    || publicCode === "PROPOSAL_REFERENCE_INVALID"
    || publicCode === "CONTEXT_INSUFFICIENT"
  ) {
    const result: UnknownRecord = {
      kind: "rejected",
      code: publicCode,
      explanation: "权威 KP 模型配置或输出无效。",
    };
    if (receipt !== undefined) result.receipt = receipt;
    return result as InternalRoomActionOutcome;
  }
  const result: UnknownRecord = {
    kind: "retryableFailure",
    code: code === "quotaExhausted" ? "quotaExhausted" : publicCode,
  };
  if (receipt !== undefined) result.receipt = receipt;
  if (isRecord(error) && typeof error.retryAfter === "number") {
    result.retryAfter = error.retryAfter;
  }
  return result as InternalRoomActionOutcome;
}

function authorityFailure(error: unknown, receipt?: unknown): InternalRoomActionOutcome {
  const result: UnknownRecord = { kind: "retryableFailure", code: "authorityTransient" };
  if (receipt !== undefined) result.receipt = receipt;
  if (isRecord(error) && typeof error.retryAfter === "number") {
    result.retryAfter = error.retryAfter;
  }
  return result as InternalRoomActionOutcome;
}

function observedParts(observed: unknown): {
  readModel: unknown;
  delivery?: unknown;
  narrationRecovery?: unknown;
  pendingPlayerRolls?: unknown[];
} {
  if (isRecord(observed) && "readModel" in observed) {
    return {
      readModel: observed.readModel,
      ...(observed.delivery !== undefined ? { delivery: observed.delivery } : {}),
      ...(observed.narrationRecovery !== undefined
        ? { narrationRecovery: observed.narrationRecovery }
        : {}),
      ...(Array.isArray(observed.pendingPlayerRolls)
        ? { pendingPlayerRolls: observed.pendingPlayerRolls }
        : {}),
    };
  }
  return { readModel: observed };
}

function projectedPendingInput(readModel: unknown, authorityPending: unknown): unknown {
  const projected = isRecord(readModel) && Array.isArray(readModel.pendingInputs)
    ? readModel.pendingInputs
    : [];
  const pendingInputId = isRecord(authorityPending)
    ? requiredString(authorityPending, "pendingInputId")
    : undefined;
  if (pendingInputId === undefined) return { kind: "pending" };
  const match = projected.find((entry) =>
    isRecord(entry) && requiredString(entry, "pendingInputId") === pendingInputId
  );
  return match === undefined ? { kind: "pending" } : structuredClone(match);
}

async function observeOutcome(
  context: RoomActionContext,
  result: UnknownRecord,
): Promise<InternalRoomActionOutcome> {
  let observed: unknown;
  try {
    observed = await context.authority.observe(context.principal);
  } catch (error) {
    // These outcomes were already established by Room Authority. A viewer
    // projection refresh cannot revoke them or expose the authority-only
    // Pending payload. Unlike publishCommittedOutcome, this path has no
    // narration task, so projection failure leaves Narration notApplicable.
    if (result.kind === "awaitingInput") {
      return {
        kind: "awaitingInput",
        receipt: result.receipt,
        readModel: undefined,
        pending: projectedPendingInput(undefined, result.pending),
      };
    }
    if (result.kind === "awaitingPlayerRoll") {
      return {
        kind: "awaitingPlayerRoll",
        readModel: undefined,
        pendingPlayerRolls: Array.isArray(result.pendingPlayerRolls)
          ? result.pendingPlayerRolls
          : [],
      };
    }
    if (result.kind === "committed" || result.kind === "concluded") {
      return {
        kind: result.kind,
        receipt: result.receipt,
        readModel: undefined,
      };
    }
    return authorityFailure(error, result.receipt);
  }
  const { readModel, delivery, pendingPlayerRolls } = observedParts(observed);

  if (result.kind === "awaitingInput") {
    return {
      kind: "awaitingInput",
      receipt: result.receipt,
      readModel,
      pending: projectedPendingInput(readModel, result.pending),
    };
  }

  if (result.kind === "awaitingPlayerRoll") {
    return {
      kind: "awaitingPlayerRoll",
      readModel,
      pendingPlayerRolls: pendingPlayerRolls ?? [],
    };
  }

  if (result.kind === "committed" || result.kind === "concluded") {
    return {
      kind: result.kind,
      receipt: result.receipt,
      readModel,
      ...(delivery !== undefined ? { delivery } : {}),
    };
  }

  return authorityFailure(undefined, result.receipt);
}

function hasDiagnostics(result: UnknownRecord): boolean {
  return Array.isArray(result.diagnostics) && result.diagnostics.length > 0;
}

function isMechanicalDiagnostic(result: UnknownRecord): boolean {
  return result.kind === "mechanicalDiagnostic" ||
    (result.kind === "needsKp" && hasDiagnostics(result));
}

function finalNeedsKp(result: UnknownRecord): InternalRoomActionOutcome {
  const outcome: UnknownRecord = {
    kind: "needsKp",
    receipt: result.receipt,
    code: "PROPOSAL_REPAIR_EXHAUSTED",
  };
  copyOptionalRetryAfter(result, outcome);
  return outcome as InternalRoomActionOutcome;
}

function parseDeliveryPlan(value: unknown): DeliveryPlan | undefined {
  if (!isRecord(value) || requiredString(value, "publishCapability") === undefined) {
    return undefined;
  }
  if (!Array.isArray(value.audiences)) return undefined;
  const requestedProtocol = value.deliveryProtocol;
  const deliveryProtocol = isRecord(requestedProtocol)
      && hasOnlyKeys(requestedProtocol, ["profileHash", "profileId"], [])
      && requestedProtocol.profileId === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId
      && requestedProtocol.profileHash === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileHash
    ? requestedProtocol as ProfileRef
    : undefined;
  if (deliveryProtocol === undefined) return undefined;

  const audienceIds = new Set<string>();
  const audiences: DeliveryAudience[] = [];
  const planRootActionId = requiredString(value, "rootActionId");
  const planReceiptId = requiredString(value, "receiptId");
  if (planRootActionId === undefined || planReceiptId === undefined) return undefined;
  for (const candidate of value.audiences) {
    if (!isRecord(candidate)) return undefined;
    const audienceId = requiredString(candidate, "audienceId");
    const principalId = requiredString(candidate, "principalId");
    if (!("kpProjection" in candidate) || candidate.kpProjection === undefined) {
      return undefined;
    }
    const projection = candidate.kpProjection;
    const requestedNarrationInputMode = candidate.narrationInputMode;
    const narrationInputMode: NarrationInputMode | undefined =
      requestedNarrationInputMode === "observerProjection-v1"
          || requestedNarrationInputMode === "frozenRenderableClaims-vnext-1"
        ? requestedNarrationInputMode
        : !("narrationInputMode" in candidate)
            && isRecord(projection)
            && !("renderableClaims" in projection)
          // Product-0.4 V5 outcomes persisted before the discriminator are
          // the only accepted implicit shape. New Room plans always name it.
          ? "observerProjection-v1"
          : undefined;
    if (
      !audienceId
      || !principalId
      || narrationInputMode === undefined
      || "projection" in candidate
      || audienceIds.has(audienceId)
    ) {
      return undefined;
    }
    let viewerKey: string | undefined;
    let renderableClaims: UnknownRecord | undefined;
    if (narrationInputMode === "frozenRenderableClaims-vnext-1") {
      const characterId = requiredString(candidate, "characterId");
      const projectionHash = requiredString(candidate, "projectionHash");
      const claims = isRecord(projection) ? projection.renderableClaims : undefined;
      viewerKey = characterId === undefined
        ? undefined
        : `${principalId}\u001f${characterId}`;
      if (
        viewerKey === undefined
        || !frozenRenderableClaimsConform(claims)
        || projectionHash !== claims.projectionHash
        || claims.viewerKey !== viewerKey
        || claims.rootActionId !== planRootActionId
        || claims.receiptId !== planReceiptId
      ) return undefined;
      renderableClaims = claims;
    }
    audienceIds.add(audienceId);
    audiences.push({
      audienceId,
      projection,
      principalId,
      narrationInputMode,
      ...(viewerKey === undefined ? {} : { viewerKey }),
      ...(renderableClaims === undefined ? {} : { renderableClaims }),
    });
  }

  return {
    deliveryProtocol,
    publishCapability: value.publishCapability,
    rootActionId: planRootActionId,
    receiptId: planReceiptId,
    audiences,
  };
}

function publicationNarration(
  value: unknown,
  protocol: ProfileRef,
): UnknownRecord {
  if (!isRecord(value)) {
    throw Object.assign(new Error("KP narration is not publishable"), {
      publicCode: "NARRATION_BODY_INVALID",
    });
  }
  if (protocol.profileId !== INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId
    || protocol.profileHash !== INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileHash) {
    throw Object.assign(new Error("KP narration protocol is not registered"), {
      publicCode: "NARRATION_BODY_INVALID",
    });
  }
  const directBody = hasOnlyKeys(value, ["body"], []);
  const v3ServerEnvelope = hasOnlyKeys(
    value,
    ["audience", "body", "modelInvocationReceipt"],
    [],
  ) && isRecord(value.audience) && isRecord(value.modelInvocationReceipt);
  if (!directBody && !v3ServerEnvelope) {
    throw Object.assign(new Error("KP narration envelope is not registered"), {
      publicCode: "NARRATION_BODY_INVALID",
    });
  }
  const body = requiredString(value, "body");
  if (!body) {
    throw Object.assign(new Error("KP narration has no current-response body"), {
      publicCode: "NARRATION_BODY_INVALID",
    });
  }
  return { body };
}

type AudiencePublicationResult = {
  audienceId: string;
  deliveryGeneration: number;
  state: "published" | "rejected" | "retryableFailure" | "superseded";
  errorCode?: string;
};

type DeliveryPublicationResult = {
  state: "published" | "rejected" | "retryableFailure";
  audiences: AudiencePublicationResult[];
};

function narrationFailure(error: unknown): {
  errorCode: NarrationPublicFailureCode;
  state: "rejected" | "retryableFailure";
} {
  const candidate = isRecord(error) ? error : undefined;
  const receipt = isRecord(candidate?.modelInvocationReceipt)
    ? candidate.modelInvocationReceipt
    : undefined;
  const explicit = narrationPublicFailureCode(candidate?.publicCode)
    ?? narrationPublicFailureCode(candidate?.code)
    ?? (candidate?.code === "modelPermanent" ? "NARRATION_BODY_INVALID" : undefined);
  if (explicit === "NARRATION_GROUNDING_REJECTED" || receipt?.failureStage === "narrationGrounding") {
    return { state: "rejected", errorCode: "NARRATION_GROUNDING_REJECTED" };
  }
  if (explicit === "NARRATION_BODY_INVALID" || receipt?.failureStage === "narrationSchema") {
    return { state: "rejected", errorCode: "NARRATION_BODY_INVALID" };
  }
  return {
    state: "retryableFailure",
    errorCode: explicit === "NARRATION_PROVIDER_TIMEOUT"
      || explicit === "NARRATION_PUBLICATION_FAILED"
      ? explicit
      : candidate?.code === "modelTransient" || candidate?.code === "quotaExhausted"
        ? "NARRATION_PROVIDER_TIMEOUT"
        : "NARRATION_PUBLICATION_FAILED",
  };
}

async function publishDeliveryPlan(
  context: Pick<RoomActionContext, "authority" | "kp"> | RoomCorrectionContext,
  prepared: UnknownRecord,
  result: UnknownRecord,
): Promise<DeliveryPublicationResult> {
  const deliveryPlan = parseDeliveryPlan(result.deliveryPlan);
  if (!deliveryPlan) throw new Error("Room Authority returned an invalid delivery plan");
  const resultReceiptId = isRecord(result.receipt)
    ? requiredString(result.receipt, "receiptId")
    : undefined;
  const resultRootActionId = isRecord(result.receipt)
    ? requiredString(result.receipt, "rootActionId")
    : undefined;
  const preparedRootActionId = requiredString(prepared, "rootActionId")
    ?? (prepared === result ? resultRootActionId : undefined);
  if (
    deliveryPlan.rootActionId !== preparedRootActionId
    || deliveryPlan.rootActionId !== resultRootActionId
    || deliveryPlan.receiptId !== resultReceiptId
  ) throw new Error("Room Authority returned a mismatched delivery plan");
  let publicationStatus: UnknownRecord | undefined;
  if (context.authority.deliveryPublicationStatus) {
    const observedStatus = await context.authority.deliveryPublicationStatus({
      publishCapability: deliveryPlan.publishCapability,
    });
    if (
      !isRecord(observedStatus)
      || !["open", "published", "superseded"].includes(String(observedStatus.kind))
    ) {
      throw new Error("Room Authority returned an invalid delivery publication status");
    }
    publicationStatus = observedStatus;
    const persistedAudiences = Array.isArray(observedStatus.audiences)
      ? observedStatus.audiences.filter(isRecord)
      : [];
    const persistedById = new Map(persistedAudiences.flatMap((audience) => {
      const audienceId = requiredString(audience, "audienceId");
      return audienceId === undefined ? [] : [[audienceId, audience] as const];
    }));
    const allPersisted = deliveryPlan.audiences.every((audience) => {
      const persisted = persistedById.get(audience.audienceId);
      return persisted?.state === "published" || persisted?.state === "superseded";
    });
    if ((observedStatus.kind === "published" || observedStatus.kind === "superseded")
      && (persistedAudiences.length === 0 || allPersisted)) {
      return {
        state: "published",
        audiences: deliveryPlan.audiences.map((audience) => {
          const persisted = persistedById.get(audience.audienceId);
          return {
            audienceId: audience.audienceId,
            deliveryGeneration: Number.isSafeInteger(persisted?.deliveryGeneration)
              ? Number(persisted?.deliveryGeneration)
              : 0,
            state: (persisted?.state ?? observedStatus.kind) as "published" | "superseded",
          };
        }),
      };
    }
    if (allPersisted) {
      return {
        state: "published",
        audiences: deliveryPlan.audiences.map((audience) => {
          const persisted = persistedById.get(audience.audienceId)!;
          return {
            audienceId: audience.audienceId,
            deliveryGeneration: Number.isSafeInteger(persisted.deliveryGeneration)
              ? Number(persisted.deliveryGeneration)
              : 0,
            state: persisted.state as "published" | "superseded",
          };
        }),
      };
    }
    if (!context.authority.beginDeliveryAudiencePublication
      && persistedAudiences.some((audience) =>
        audience.state === "published" || audience.state === "superseded")) {
      throw new Error("Independent audience publication recovery capability is unavailable");
    }
  }

  if (!context.authority.publishDelivery) {
    throw new Error("Room Authority delivery capability is unavailable");
  }

  if (!context.authority.beginDeliveryAudiencePublication) {
    throw new Error("Independent audience publication capability is unavailable");
  }

  const statusByAudience = new Map<string, UnknownRecord>();
  if (Array.isArray(publicationStatus?.audiences)) {
    for (const value of publicationStatus.audiences) {
      if (isRecord(value) && requiredString(value, "audienceId")) {
        statusByAudience.set(value.audienceId as string, value);
      }
    }
  }
  const outputs: Array<AudiencePublicationResult | undefined> = new Array(
    deliveryPlan.audiences.length,
  );
  let cursor = 0;
  const publishNext = async () => {
    while (cursor < deliveryPlan.audiences.length) {
      const index = cursor;
      cursor += 1;
      const audience = deliveryPlan.audiences[index];
      const known = statusByAudience.get(audience.audienceId);
      if (known?.state === "published" || known?.state === "superseded") {
        outputs[index] = {
          audienceId: audience.audienceId,
          deliveryGeneration: Number.isSafeInteger(known.deliveryGeneration)
            ? Number(known.deliveryGeneration)
            : 0,
          state: known.state,
        };
        continue;
      }
      let deliveryGeneration = 0;
      try {
        const begun = await context.authority.beginDeliveryAudiencePublication!({
          publishCapability: deliveryPlan.publishCapability,
          audienceId: audience.audienceId,
        });
        if (
          !isRecord(begun)
          || !["pending", "published", "superseded"].includes(String(begun.kind))
          || !Number.isSafeInteger(begun.deliveryGeneration)
        ) throw new Error("Room Authority did not begin the audience publication");
        deliveryGeneration = Number(begun.deliveryGeneration);
        if (begun.kind === "published" || begun.kind === "superseded") {
          outputs[index] = {
            audienceId: audience.audienceId,
            deliveryGeneration,
            state: begun.kind,
          };
          continue;
        }
        const narration = await context.kp.narrate(
          audience.narrationInputMode === "observerProjection-v1"
            ? {
              rootActionId: deliveryPlan.rootActionId,
              narrationInputMode: audience.narrationInputMode,
              receipt: result.receipt,
              audienceId: audience.audienceId,
              projection: audience.projection,
              deliveryGeneration,
            }
            : {
              rootActionId: deliveryPlan.rootActionId,
              narrationInputMode: audience.narrationInputMode,
              receipt: result.receipt,
              viewerKey: audience.viewerKey,
              renderableClaims: audience.renderableClaims,
              deliveryGeneration,
            },
        );
        const publicationResult = await context.authority.publishDelivery!(
          { publishCapability: deliveryPlan.publishCapability },
          {
            frames: [{
              audienceId: audience.audienceId,
              deliveryGeneration,
              narration: publicationNarration(
                narration,
                deliveryPlan.deliveryProtocol,
              ),
            }],
          },
        );
        if (
          !isRecord(publicationResult)
          || (publicationResult.kind !== "published" && publicationResult.kind !== "superseded")
        ) throw Object.assign(new Error("Room Authority did not accept the audience publication"), {
          publicCode: "NARRATION_PUBLICATION_FAILED",
        });
        outputs[index] = {
          audienceId: audience.audienceId,
          deliveryGeneration,
          state: publicationResult.kind,
        };
      } catch (error) {
        const failure = narrationFailure(error);
        if (context.authority.failDeliveryAudiencePublication && deliveryGeneration > 0) {
          try {
            await context.authority.failDeliveryAudiencePublication(
              { publishCapability: deliveryPlan.publishCapability },
              {
                audienceId: audience.audienceId,
                deliveryGeneration,
                errorCode: failure.errorCode,
                state: failure.state,
              },
            );
          } catch {
            // The frozen audience stays pending and the same RootAction can
            // retry; a failed status write never licenses a new proposal.
          }
        }
        outputs[index] = {
          audienceId: audience.audienceId,
          deliveryGeneration,
          state: failure.state,
          errorCode: failure.errorCode,
        };
      }
    }
  };
  const workers = Math.min(MAX_NARRATION_CONCURRENCY, deliveryPlan.audiences.length);
  await Promise.all(Array.from({ length: workers }, publishNext));
  const audiences = outputs.filter((entry): entry is AudiencePublicationResult => entry !== undefined);
  return {
    state: audiences.some((entry) => entry.state === "retryableFailure")
      ? "retryableFailure"
      : audiences.some((entry) => entry.state === "rejected")
        ? "rejected"
        : "published",
    audiences,
  };
}

function statefulOutcome(
  outcome: InternalRoomActionOutcome,
  overrides: Partial<Pick<RoomActionOutcome, "action" | "narration">> = {},
): RoomActionOutcome {
  const receipt = "receipt" in outcome && isRecord(outcome.receipt)
    ? outcome.receipt
    : undefined;
  const action: RoomActionState = outcome.kind === "awaitingInput"
    || outcome.kind === "awaitingPlayerRoll"
    ? "awaitingInput"
    : outcome.kind === "committed"
      ? receipt?.resolutionDisposition === "inWorldRefusal"
        ? "resolvedInWorld"
        : "committed"
      : outcome.kind === "concluded"
        ? "concluded"
        : "notCommitted";
  const delivery = "delivery" in outcome && isRecord(outcome.delivery)
    ? outcome.delivery
    : undefined;
  const deliveryFrame = isRecord(delivery?.frame) ? delivery.frame : undefined;
  const currentReceiptMatches = requiredString(deliveryFrame ?? {}, "receiptId") !== undefined
    && requiredString(deliveryFrame ?? {}, "receiptId") === requiredString(receipt ?? {}, "receiptId");
  const audienceNarrations = "audienceNarrations" in outcome
    && Array.isArray(outcome.audienceNarrations)
    ? outcome.audienceNarrations
    : [];
  const publicationCompleted = audienceNarrations.length > 0
    && audienceNarrations.every((entry) =>
      entry.state === "published" || entry.state === "superseded");
  const narration: RoomNarrationState = outcome.kind === "committed" || outcome.kind === "concluded"
    ? outcome.narrationFailureState
      ?? (publicationCompleted || (delivery?.kind === "current" && currentReceiptMatches)
        ? "published"
        : outcome.deliveryPending === true ? "retryableFailure" : "notApplicable")
    : "notApplicable";
  return {
    ...outcome,
    action: overrides.action ?? action,
    narration: overrides.narration ?? narration,
  } as RoomActionOutcome;
}

function correctionFailure(
  outcome: Extract<InternalRoomActionOutcome, { kind: "retryableFailure" | "rejected" }>,
): Extract<RoomCorrectionOutcome, { kind: "retryableFailure" | "rejected" }> {
  return {
    ...outcome,
    action: "notCommitted",
    narration: "notApplicable",
  };
}

/** Executes the server-only correction capability and publishes its frozen
 * replacement plan outside the DO transaction. Repeating the same request
 * reuses both the correction events and publication stage. */
export async function handleRoomCorrection(
  context: RoomCorrectionContext,
  correctionCapability: unknown,
  request: unknown,
): Promise<RoomCorrectionOutcome> {
  let committedValue: unknown;
  try {
    committedValue = await context.authority.commitCorrection(
      correctionCapability,
      request,
    );
  } catch (error) {
    return correctionFailure(authorityFailure(error) as Extract<
      InternalRoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >);
  }
  if (!isRecord(committedValue)) {
    return correctionFailure(authorityFailure(undefined) as Extract<
      InternalRoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >);
  }
  const failure = publicFailure(committedValue);
  if (failure !== undefined) {
    return correctionFailure(failure as Extract<
      InternalRoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >);
  }
  const correctionId = requiredString(committedValue, "correctionId");
  const activeBranchId = requiredString(committedValue, "activeBranchId");
  const strategy = committedValue.strategy;
  if (
    committedValue.kind !== "committed"
    || correctionId === undefined
    || activeBranchId === undefined
    || (strategy !== "forwardCompensation" && strategy !== "causalBranch")
    || !Array.isArray(committedValue.supersededRootActionIds)
    || !committedValue.supersededRootActionIds.every((entry) =>
      typeof entry === "string" && entry.length > 0)
    || !isRecord(committedValue.receipt)
    || !isRecord(committedValue.deliveryPlan)
  ) {
    return correctionFailure(authorityFailure(undefined, committedValue.receipt) as Extract<
      InternalRoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >);
  }

  let deliveryPending = false;
  let narration: "published" | "rejected" | "retryableFailure" = "published";
  try {
    const publication = await publishDeliveryPlan(
      context,
      { rootActionId: committedValue.receipt.rootActionId },
      committedValue,
    );
    narration = publication.state;
    deliveryPending = publication.state !== "published";
  } catch {
    deliveryPending = true;
    narration = "retryableFailure";
  }
  return {
    kind: "committed",
    correctionId,
    strategy,
    activeBranchId,
    supersededRootActionIds: [...committedValue.supersededRootActionIds] as string[],
    receipt: committedValue.receipt,
    action: "committed",
    narration,
    ...(deliveryPending ? { deliveryPending: true as const } : {}),
  };
}

async function publishCommittedOutcome(
  context: RoomActionContext,
  prepared: UnknownRecord,
  result: UnknownRecord,
): Promise<InternalRoomActionOutcome> {
  let deliveryPending = false;
  let publication: DeliveryPublicationResult | undefined;
  let publicationFailureCode: NarrationPublicFailureCode | undefined;
  try {
    publication = await publishDeliveryPlan(context, prepared, result);
    deliveryPending = publication.state !== "published";
  } catch {
    deliveryPending = true;
    publicationFailureCode = "NARRATION_PUBLICATION_FAILED";
  }

  let observed: unknown;
  try {
    observed = await context.authority.observe(context.principal);
  } catch {
    // The world commit and Receipt already exist. Failure to refresh this
    // viewer's projection can only make Narration delivery retryable; it must
    // never turn the action back into notCommitted or invite a new Proposal.
    return {
      kind: result.kind as "committed" | "concluded",
      receipt: result.receipt,
      readModel: undefined,
      ...(publication === undefined ? {} : { audienceNarrations: publication.audiences }),
      narrationFailureState: "retryableFailure",
      narrationFailureCode: "NARRATION_PUBLICATION_FAILED",
      deliveryPending: true,
    };
  }
  const { readModel, delivery, narrationRecovery } = observedParts(observed);
  const plan = parseDeliveryPlan(result.deliveryPlan);
  const independent = plan?.deliveryProtocol.profileId
      === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId
    && plan.deliveryProtocol.profileHash
      === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileHash;
  const recovery = isRecord(narrationRecovery) ? narrationRecovery : undefined;
  const principal = isRecord(context.principal) && isRecord(context.principal.principal)
    ? context.principal.principal
    : isRecord(context.principal) ? context.principal : undefined;
  const viewerAudienceId = plan?.audiences.find((audience) =>
    audience.principalId !== undefined && audience.principalId === principal?.id
  )?.audienceId;
  const viewerPublication = viewerAudienceId === undefined
    ? publication?.audiences.length === 1 ? publication.audiences[0] : undefined
    : publication?.audiences.find((audience) => audience.audienceId === viewerAudienceId);
  const viewerNarrationFailureCode = narrationPublicFailureCode(viewerPublication?.errorCode)
    ?? publicationFailureCode;
  const viewerDeliveryPending = independent
    ? recovery?.kind === "available"
      && recovery.capability === plan?.publishCapability
    : deliveryPending;
  const viewerNarrationFailure = recovery?.state === "rejected"
    ? "rejected" as const
    : "retryableFailure" as const;
  return {
    kind: result.kind as "committed" | "concluded",
    receipt: result.receipt,
    readModel,
    ...(delivery !== undefined ? { delivery } : {}),
    ...(publication === undefined ? {} : { audienceNarrations: publication.audiences }),
    ...(independent && viewerDeliveryPending
      ? { narrationFailureState: viewerNarrationFailure }
      : !independent
      && (publication?.state === "rejected" || publication?.state === "retryableFailure")
      ? { narrationFailureState: publication.state }
      : {}),
    ...(viewerDeliveryPending && viewerNarrationFailureCode !== undefined
      ? { narrationFailureCode: viewerNarrationFailureCode }
      : {}),
    ...(viewerDeliveryPending ? { deliveryPending: true as const } : {}),
  };
}

function preparedIdentifiers(prepared: UnknownRecord): {
  preparedActionId: string;
  rootActionId: string;
} | undefined {
  const preparedActionId = requiredString(prepared, "preparedActionId");
  const rootActionId = requiredString(prepared, "rootActionId");
  return preparedActionId && rootActionId ? { preparedActionId, rootActionId } : undefined;
}

function resumedPrincipalContext(value: unknown): UnknownRecord | undefined {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["principal"], [])
    || !isRecord(value.principal)
    || !hasOnlyKeys(value.principal, ["id", "sessionVersion"], [])
    || requiredString(value.principal, "id") === undefined
    || !Number.isSafeInteger(value.principal.sessionVersion)
  ) return undefined;
  return {
    principal: {
      id: value.principal.id,
      sessionVersion: Number(value.principal.sessionVersion),
    },
  };
}

/**
 * Coordinates one authenticated room action. It owns no clock, randomness, or state;
 * those capabilities remain inside the Room Authority and KP adapter boundaries.
 */
async function handleRoomActionInternal(
  context: RoomActionContext,
  input: RoomActionInput,
): Promise<InternalRoomActionOutcome> {
  const rebuilt = rebuildInput(input);
  if (isRejectedValidation(rebuilt)) return rebuilt;
  let activeInput = rebuilt;
  let commitPrincipal = context.principal;
  let proposalPurpose: KpProposalRequestPurpose = "initialProposal";

  if (rebuilt.kind === "acknowledge") {
    try {
      return await context.authority.acknowledge(
        context.principal,
        rebuilt.deliveryId,
      ) as InternalRoomActionOutcome;
    } catch (error) {
      return authorityFailure(error);
    }
  }


  let preparedValue: UnknownRecord | undefined;
  if (rebuilt.kind === "roll") {
    if (!context.authority.resumePlayerRandomness) {
      return authorityFailure(undefined);
    }
    let resumed: unknown;
    try {
      resumed = await context.authority.resumePlayerRandomness(
        context.principal,
        rebuilt.randomnessId,
      );
    } catch (error) {
      return authorityFailure(error);
    }
    if (!isRecord(resumed)) return authorityFailure(undefined);
    const failure = publicFailure(resumed, rebuilt.kind);
    if (failure !== undefined) return failure;
    if (resumed.kind === "awaitingPlayerRoll" || resumed.kind === "awaitingInput") {
      return observeOutcome(context, resumed);
    }
    if (resumed.kind === "committed" || resumed.kind === "concluded") {
      const rootActionId = isRecord(resumed.receipt)
        ? requiredString(resumed.receipt, "rootActionId")
        : undefined;
      if (rootActionId === undefined) return authorityFailure(undefined, resumed.receipt);
      return resumed.deliveryPlan === undefined
        ? observeOutcome(context, resumed)
        : publishCommittedOutcome(
            context,
            { rootActionId },
            resumed,
          );
    }
    if (resumed.kind !== "continue" || !isRecord(resumed.prepared)) {
      return authorityFailure(undefined, resumed.receipt);
    }
    const restored = rebuildInput(resumed.prepared.resumedActionInput);
    if (
      isRejectedValidation(restored)
      || restored.kind !== "intent"
    ) {
      return authorityFailure(undefined, resumed.receipt);
    }
    activeInput = restored;
    const restoredPrincipal = resumedPrincipalContext(
      resumed.prepared.resumedPrincipalContext,
    );
    if (restoredPrincipal === undefined) {
      return authorityFailure(undefined, resumed.receipt);
    }
    commitPrincipal = restoredPrincipal;
    proposalPurpose = "randomnessContinuation";
  }

  if (preparedValue === undefined) {
    let preparedResult: unknown;
    try {
      preparedResult = await context.authority.prepare(commitPrincipal, activeInput);
    } catch (error) {
      return authorityFailure(error);
    }
    if (!isRecord(preparedResult)) return authorityFailure(undefined);
    preparedValue = preparedResult;
  }

  const resumedPrepared = preparedValue.kind === "continue" && isRecord(preparedValue.prepared)
    ? preparedValue.prepared
    : preparedValue.kind === "prepared"
        && activeInput.kind === "retry"
        && "resumedActionInput" in preparedValue
        && "resumedPrincipalContext" in preparedValue
      ? preparedValue
      : undefined;
  if (resumedPrepared !== undefined) {
    const resumedInputKind = activeInput.kind;
    const restored = rebuildInput(resumedPrepared.resumedActionInput);
    const restoredPrincipal = resumedPrincipalContext(
      resumedPrepared.resumedPrincipalContext,
    );
    if (
      isRejectedValidation(restored)
      || restored.kind !== "intent"
      || restoredPrincipal === undefined
    ) {
      return authorityFailure(undefined, resumedPrepared.receipt);
    }
    activeInput = restored;
    commitPrincipal = restoredPrincipal;
    if (resumedInputKind === "answer") {
      proposalPurpose = "clarificationContinuation";
    } else if (resumedInputKind === "retry") {
      proposalPurpose = "proposalRetry";
    }
    let refreshed: unknown;
    try {
      refreshed = await context.authority.prepare(commitPrincipal, activeInput);
    } catch (error) {
      return authorityFailure(error, resumedPrepared.receipt);
    }
    if (!isRecord(refreshed)) {
      return authorityFailure(undefined, resumedPrepared.receipt);
    }
    preparedValue = refreshed;
  }

  const preparedFailure = publicFailure(preparedValue, activeInput.kind);
  if (preparedFailure) return preparedFailure;
  if (preparedValue.kind === "awaitingInput") {
    return observeOutcome(context, preparedValue);
  }
  if (preparedValue.kind === "committed" || preparedValue.kind === "concluded") {
    return preparedValue.deliveryPlan === undefined
      ? observeOutcome(context, preparedValue)
      : publishCommittedOutcome(context, preparedValue, preparedValue);
  }

  for (
    let transition = 0;
    preparedValue.phase === "dueActorPlan";
    transition += 1
  ) {
    if (transition >= MAX_ACTION_PHASE_TRANSITIONS) {
      return authorityFailure(undefined, preparedValue.receipt);
    }
    const dueIdentifiers = preparedIdentifiers(preparedValue);
    if (!dueIdentifiers || !isRecord(preparedValue.dueActorPlan)) {
      return authorityFailure(undefined, preparedValue.receipt);
    }
    let proposal: unknown;
    try {
      const dueRequest = {
        preparedActionId: dueIdentifiers.preparedActionId,
        rootActionId: dueIdentifiers.rootActionId,
        dueActorPlan: preparedValue.dueActorPlan,
        projection: preparedValue.kpProjection,
        attempt: 1 as const,
      };
      proposal = await context.kp.decideDueActorPlan(dueRequest);
    } catch (error) {
      return modelFailure(error, preparedValue.receipt);
    }
    if (!isRecord(proposal)) return modelFailure(undefined, preparedValue.receipt);

    let committed: unknown;
    try {
      committed = await context.authority.commit(
        commitPrincipal,
        dueIdentifiers.preparedActionId,
        { ...proposal, rootActionId: dueIdentifiers.rootActionId },
      );
    } catch (error) {
      return authorityFailure(error, preparedValue.receipt);
    }
    if (!isRecord(committed)) return authorityFailure(undefined, preparedValue.receipt);
    const failure = publicFailure(committed, activeInput.kind);
    if (failure) return failure;
    if (committed.kind === "awaitingPlayerRoll" || committed.kind === "awaitingInput") {
      return observeOutcome(context, committed);
    }
    if (committed.kind !== "continue" || !isRecord(committed.prepared)) {
      return authorityFailure(undefined, committed.receipt ?? preparedValue.receipt);
    }
    const restored = rebuildInput(committed.prepared.resumedActionInput);
    const restoredPrincipal = resumedPrincipalContext(
      committed.prepared.resumedPrincipalContext,
    );
    if (
      isRejectedValidation(restored)
      || restored.kind !== "intent"
      || restoredPrincipal === undefined
    ) {
      return authorityFailure(undefined, committed.prepared.receipt ?? preparedValue.receipt);
    }
    activeInput = restored;
    commitPrincipal = restoredPrincipal;
    let refreshed: unknown;
    try {
      refreshed = await context.authority.prepare(commitPrincipal, activeInput);
    } catch (error) {
      return authorityFailure(error, committed.prepared.receipt ?? preparedValue.receipt);
    }
    if (!isRecord(refreshed)) {
      return authorityFailure(undefined, committed.prepared.receipt ?? preparedValue.receipt);
    }
    const refreshedFailure = publicFailure(refreshed, activeInput.kind);
    if (refreshedFailure) return refreshedFailure;
    if (refreshed.kind === "awaitingInput" || refreshed.kind === "awaitingPlayerRoll") {
      return observeOutcome(context, refreshed);
    }
    if (refreshed.kind === "committed" || refreshed.kind === "concluded") {
      return refreshed.deliveryPlan === undefined
        ? observeOutcome(context, refreshed)
        : publishCommittedOutcome(context, refreshed, refreshed);
    }
    preparedValue = refreshed;
  }

  let identifiers = preparedIdentifiers(preparedValue);
  if (!identifiers) return authorityFailure(undefined, preparedValue.receipt);

  if (
    (
      activeInput.kind === "answer"
      || activeInput.kind === "gear"
      || activeInput.kind === "itemActivity"
      || activeInput.kind === "environmentInteract"
      || activeInput.kind === "environmentAbility"
      || activeInput.kind === "movement"
      || activeInput.kind === "combatEndTurn"
      || activeInput.kind === "restStart"
      || activeInput.kind === "restInterrupt"
      || activeInput.kind === "safetyPause"
      || activeInput.kind === "safetyAdjust"
    )
    && preparedValue.resolutionMode === "authorityDirect"
  ) {
    let commitValue: unknown;
    try {
      commitValue = await context.authority.commit(
        commitPrincipal,
        identifiers.preparedActionId,
        {
          kind: activeInput.kind === "answer"
            ? "authenticatedPendingAnswer"
            : activeInput.kind === "gear"
              ? "authenticatedGearAction"
              : activeInput.kind === "itemActivity"
                ? "authenticatedItemActivity"
              : activeInput.kind === "environmentInteract"
                ? "authenticatedEnvironmentInteraction"
              : activeInput.kind === "environmentAbility"
                ? "authenticatedEnvironmentAbility"
              : activeInput.kind === "movement"
                ? "authenticatedMovement"
              : activeInput.kind === "combatEndTurn"
                ? "authenticatedCombatEndTurn"
              : activeInput.kind === "restStart"
                ? "authenticatedRestStart"
              : activeInput.kind === "restInterrupt"
                ? "authenticatedRestInterrupt"
              : activeInput.kind === "safetyPause"
                ? "authenticatedSafetyPause"
                : "authenticatedSafetyAdjustment",
          rootActionId: identifiers.rootActionId,
        },
      );
    } catch (error) {
      return authorityFailure(error, preparedValue.receipt);
    }
    if (!isRecord(commitValue)) return authorityFailure(undefined, preparedValue.receipt);
    const commitFailure = publicFailure(commitValue, activeInput.kind);
    if (commitFailure) return commitFailure;
    if (commitValue.kind === "awaitingInput" || commitValue.kind === "awaitingPlayerRoll") {
      return observeOutcome(context, commitValue);
    }
    if (commitValue.kind === "committed" || commitValue.kind === "concluded") {
      return activeInput.kind === "safetyPause" || activeInput.kind === "safetyAdjust"
        ? observeOutcome(context, commitValue)
        : publishCommittedOutcome(context, preparedValue, commitValue);
    }
    if (commitValue.kind !== "continue" || !isRecord(commitValue.prepared)) {
      return authorityFailure(undefined, commitValue.receipt ?? preparedValue.receipt);
    }
    const continuedInputKind = activeInput.kind;
    const restored = rebuildInput(commitValue.prepared.resumedActionInput);
    const restoredPrincipal = resumedPrincipalContext(
      commitValue.prepared.resumedPrincipalContext,
    );
    if (
      isRejectedValidation(restored)
      || restored.kind !== "intent"
      || restoredPrincipal === undefined
    ) {
      return authorityFailure(undefined, commitValue.prepared.receipt ?? preparedValue.receipt);
    }
    activeInput = restored;
    commitPrincipal = restoredPrincipal;
    if (continuedInputKind === "answer") {
      proposalPurpose = "clarificationContinuation";
    }
    let refreshed: unknown;
    try {
      refreshed = await context.authority.prepare(commitPrincipal, activeInput);
    } catch (error) {
      return authorityFailure(error, commitValue.prepared.receipt ?? preparedValue.receipt);
    }
    if (!isRecord(refreshed)) {
      return authorityFailure(undefined, commitValue.prepared.receipt ?? preparedValue.receipt);
    }
    const refreshedFailure = publicFailure(refreshed, activeInput.kind);
    if (refreshedFailure) return refreshedFailure;
    if (refreshed.kind === "awaitingInput" || refreshed.kind === "awaitingPlayerRoll") {
      return observeOutcome(context, refreshed);
    }
    if (refreshed.kind === "committed" || refreshed.kind === "concluded") {
      return refreshed.deliveryPlan === undefined
        ? observeOutcome(context, refreshed)
        : publishCommittedOutcome(context, refreshed, refreshed);
    }
    preparedValue = refreshed;
    identifiers = preparedIdentifiers(preparedValue);
    if (!identifiers) {
      return authorityFailure(undefined, commitValue.prepared.receipt ?? preparedValue.receipt);
    }
  }

  let diagnostics: unknown;
  let priorProposal: unknown;
  for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt += 1) {
    let proposal: unknown;
    try {
      const retryMetadata = {
        attempt,
        proposalPurpose,
        ...(diagnostics !== undefined ? { diagnostics } : {}),
        ...(priorProposal === undefined ? {} : { priorProposal }),
      };
      proposal = await context.kp.propose(preparedValue.requiredContext === undefined
        ? {
            ...(preparedValue.phase === undefined ? {} : { phase: preparedValue.phase }),
            preparedActionId: identifiers.preparedActionId,
            rootActionId: identifiers.rootActionId,
            input: activeInput,
            projection: preparedValue.kpProjection,
            ...retryMetadata,
          }
        : {
            ...(preparedValue.phase === undefined ? {} : { phase: preparedValue.phase }),
            preparedActionId: identifiers.preparedActionId,
            rootActionId: identifiers.rootActionId,
            requiredContext: preparedValue.requiredContext,
            ...retryMetadata,
          });
    } catch (error) {
      return modelFailure(error, preparedValue.receipt);
    }
    if (!isRecord(proposal)) return modelFailure(undefined, preparedValue.receipt);

    const rulesInput: UnknownRecord = {
      ...proposal,
      rootActionId: identifiers.rootActionId,
    };

    let commitValue: unknown;
    try {
      commitValue = await context.authority.commit(
        commitPrincipal,
        identifiers.preparedActionId,
        rulesInput,
      );
    } catch (error) {
      return authorityFailure(error, preparedValue.receipt);
    }
    if (!isRecord(commitValue)) return authorityFailure(undefined, preparedValue.receipt);

    if (isMechanicalDiagnostic(commitValue)) {
      if (
        attempt === MAX_PROPOSAL_ATTEMPTS
        || proposal.repairUsed === true
      ) return finalNeedsKp(commitValue);
      diagnostics = commitValue.diagnostics;
      priorProposal = structuredClone(proposal);
      continue;
    }

    const commitFailure = publicFailure(commitValue, activeInput.kind);
    if (commitFailure) return commitFailure;
    if (commitValue.kind === "awaitingInput" || commitValue.kind === "awaitingPlayerRoll") {
      return observeOutcome(context, commitValue);
    }
    if (commitValue.kind === "committed" || commitValue.kind === "concluded") {
      return publishCommittedOutcome(context, preparedValue, commitValue);
    }
    return authorityFailure(undefined, commitValue.receipt ?? preparedValue.receipt);
  }

  return authorityFailure(undefined, preparedValue.receipt);
}

/**
 * Retries only the current authenticated viewer's frozen narration. The Room
 * resolves the audience, projection, Receipt, and delivery generation; this
 * path never prepares or commits an action and therefore cannot re-propose,
 * reroll, or consume a mechanical resource.
 */
export async function handleViewerNarrationRecovery(
  context: RoomActionContext,
  capability: string,
): Promise<RoomActionOutcome> {
  if (
    !capability
    || !context.authority.beginViewerNarrationRecovery
    || !context.authority.publishViewerNarrationRecovery
    || !context.authority.failViewerNarrationRecovery
  ) {
    return statefulOutcome(rejectedValidation("当前没有可恢复的 KP 回复。"));
  }

  let begunValue: unknown;
  try {
    begunValue = await context.authority.beginViewerNarrationRecovery(
      context.principal,
      capability,
    );
  } catch (error) {
    return statefulOutcome(authorityFailure(error));
  }
  if (!isRecord(begunValue)) return statefulOutcome(authorityFailure(undefined));
  const beginFailure = publicFailure(begunValue);
  if (beginFailure !== undefined) return statefulOutcome(beginFailure);
  if (begunValue.kind === "published" || begunValue.kind === "superseded") {
    return statefulOutcome({
      kind: "committed",
      receipt: begunValue.receipt,
      readModel: {},
    }, { action: "committed", narration: "published" });
  }

  const rootActionId = requiredString(begunValue, "rootActionId");
  const deliveryGeneration = Number.isSafeInteger(begunValue.deliveryGeneration)
    ? Number(begunValue.deliveryGeneration)
    : 0;
  const protocol = isRecord(begunValue.deliveryProtocol)
    && begunValue.deliveryProtocol.profileId
      === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId
    && begunValue.deliveryProtocol.profileHash
      === INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileHash
    ? INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE
    : undefined;
  const requestedNarrationInputMode = begunValue.narrationInputMode;
  const narrationInputMode: NarrationInputMode | undefined =
    requestedNarrationInputMode === "observerProjection-v1"
        || requestedNarrationInputMode === "frozenRenderableClaims-vnext-1"
      ? requestedNarrationInputMode
      : undefined;
  const receiptId = isRecord(begunValue.receipt)
    ? requiredString(begunValue.receipt, "receiptId")
    : undefined;
  const recoveryClaims = begunValue.renderableClaims;
  const recoveryViewerKey = requiredString(begunValue, "viewerKey");
  const legacyProjectionValid = narrationInputMode === "observerProjection-v1"
    && begunValue.projection !== undefined;
  const vNextClaimsValid = narrationInputMode === "frozenRenderableClaims-vnext-1"
    && recoveryViewerKey !== undefined
    && frozenRenderableClaimsConform(recoveryClaims)
    && recoveryClaims.viewerKey === recoveryViewerKey
    && recoveryClaims.rootActionId === rootActionId
    && recoveryClaims.receiptId === receiptId;
  if (
    begunValue.kind !== "pending"
    || rootActionId === undefined
    || deliveryGeneration < 1
    || !isRecord(begunValue.receipt)
    || narrationInputMode === undefined
    || (!legacyProjectionValid && !vNextClaimsValid)
    || protocol === undefined
  ) return statefulOutcome(authorityFailure(undefined, begunValue.receipt));

  let failure: ReturnType<typeof narrationFailure> | undefined;
  try {
    const narration = await context.kp.narrate(
      narrationInputMode === "observerProjection-v1"
        ? {
          rootActionId,
          narrationInputMode,
          narrationPurpose: "narrationRecovery",
          receipt: begunValue.receipt,
          projection: begunValue.projection,
          deliveryGeneration,
        }
        : {
          rootActionId,
          narrationInputMode,
          narrationPurpose: "narrationRecovery",
          receipt: begunValue.receipt,
          viewerKey: recoveryViewerKey,
          renderableClaims: recoveryClaims,
          deliveryGeneration,
        },
    );
    const body = publicationNarration(narration, protocol).body;
    const published = await context.authority.publishViewerNarrationRecovery(
      context.principal,
      capability,
      { body, deliveryGeneration },
    );
    if (
      !isRecord(published)
      || (published.kind !== "published" && published.kind !== "superseded")
    ) {
      throw Object.assign(new Error("Room rejected viewer narration recovery"), {
        publicCode: "NARRATION_PUBLICATION_FAILED",
      });
    }
    return statefulOutcome({
      kind: "committed",
      receipt: published.receipt ?? begunValue.receipt,
      readModel: {},
    }, { action: "committed", narration: "published" });
  } catch (error) {
    failure = narrationFailure(error);
  }

  try {
    const failed = await context.authority.failViewerNarrationRecovery(
      context.principal,
      capability,
      {
        deliveryGeneration,
        errorCode: failure.errorCode,
        state: failure.state,
      },
    );
    if (isRecord(failed) && (failed.kind === "published" || failed.kind === "superseded")) {
      return statefulOutcome({
        kind: "committed",
        receipt: failed.receipt ?? begunValue.receipt,
        readModel: {},
      }, { action: "committed", narration: "published" });
    }
  } catch {
    // The persisted viewer journal remains the sole recovery source. A lost
    // failure response does not license a new action or mechanical retry.
  }
  return statefulOutcome({
    kind: "committed",
    receipt: begunValue.receipt,
    readModel: {},
    deliveryPending: true,
    narrationFailureCode: failure.errorCode,
  }, { action: "committed", narration: failure.state });
}

/** Public action result keeps mechanical commitment and narration delivery on
 * orthogonal axes. `kind` is an internal phase discriminant; callers use
 * `action` and `narration` for product behavior. */
export async function handleRoomAction(
  context: RoomActionContext,
  input: RoomActionInput,
): Promise<RoomActionOutcome> {
  return statefulOutcome(await handleRoomActionInternal(context, input));
}
