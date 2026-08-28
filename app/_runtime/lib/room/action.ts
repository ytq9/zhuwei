import { validateNarrationAgencyClaims } from "../kp/authoritative-helpers";
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
  | { kind: "acknowledge"; deliveryId: string };

export type RoomActionOutcome =
  | {
      kind: "committed";
      receipt: unknown;
      readModel: unknown;
      delivery?: unknown;
      deliveryPending?: true;
    }
  | {
      kind: "awaitingInput";
      receipt: unknown;
      readModel: unknown;
      pending: unknown;
    }
  | { kind: "needsKp"; receipt: unknown; code?: string; retryAfter?: number }
  | { kind: "retryableFailure"; receipt?: unknown; code: string; retryAfter?: number }
  | { kind: "rejected"; receipt?: unknown; code: string; explanation: string }
  | {
      kind: "concluded";
      receipt: unknown;
      readModel: unknown;
      delivery?: unknown;
      deliveryPending?: true;
    };

export type RoomAuthorityCapability = {
  prepare(principal: unknown, input: RoomActionInput): Promise<unknown>;
  observe(principal: unknown, query?: unknown): Promise<unknown>;
  commit(principal: unknown, preparedActionId: string, rulesInput: UnknownRecord): Promise<unknown>;
  acknowledge(principal: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus?(query: { publishCapability: unknown }): Promise<unknown>;
  publishDelivery?(authorization: unknown, publication: UnknownRecord): Promise<unknown>;
};

type DeliveryPublicationAuthority = Pick<
  RoomAuthorityCapability,
  "deliveryPublicationStatus" | "publishDelivery"
>;

export type KpAdapterCapability = {
  propose(request: UnknownRecord): Promise<unknown>;
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
    }
  | Extract<RoomActionOutcome, { kind: "retryableFailure" | "rejected" }>;

const MAX_PROPOSAL_ATTEMPTS = 2;
const MAX_NARRATION_CONCURRENCY = 4;
const MAX_ACTION_PHASE_TRANSITIONS = 2;

type DeliveryAudience = {
  audienceId: string;
  projection: unknown;
};

type DeliveryPlan = {
  publishCapability: unknown;
  audiences: DeliveryAudience[];
};

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

function rejectedValidation(explanation: string): RoomActionOutcome {
  return { kind: "rejected", code: "validation", explanation };
}

function rejectedDeferred(explanation: string): RoomActionOutcome {
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

function rebuildInput(input: unknown): RoomActionInput | RoomActionOutcome {
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

function isRejectedValidation(value: RoomActionInput | RoomActionOutcome): value is RoomActionOutcome {
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
): RoomActionOutcome | undefined {
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
      return result as RoomActionOutcome;
    }
    if (PROTECTED_REFERENCE_FAILURE_CODES.has(internalCode)) {
      const result: UnknownRecord = {
        kind: "rejected",
        code: "referenceUnavailable",
        explanation: "该对象当前不可用。",
      };
      copyOptionalReceipt(value, result);
      return result as RoomActionOutcome;
    }
    const result: UnknownRecord = {
      kind: "rejected",
      code: internalCode,
      explanation:
        typeof value.explanation === "string" ? value.explanation : "当前行动被拒绝。",
    };
    copyOptionalReceipt(value, result);
    return result as RoomActionOutcome;
  }

  if (value.kind === "retryableFailure") {
    const result: UnknownRecord = {
      kind: "retryableFailure",
      code: typeof value.code === "string" ? value.code : "authorityTransient",
    };
    copyOptionalReceipt(value, result);
    copyOptionalRetryAfter(value, result);
    return result as RoomActionOutcome;
  }

  if (value.kind === "needsKp" && !hasDiagnostics(value)) {
    const result: UnknownRecord = { kind: "needsKp", receipt: value.receipt };
    if (typeof value.code === "string") result.code = value.code;
    copyOptionalRetryAfter(value, result);
    return result as RoomActionOutcome;
  }

  return undefined;
}

function modelFailure(error: unknown, receipt?: unknown): RoomActionOutcome {
  const code = isRecord(error) ? error.code : undefined;
  if (code === "modelPermanent") {
    const result: UnknownRecord = {
      kind: "rejected",
      code: "modelPermanent",
      explanation: "权威 KP 模型配置或输出无效。",
    };
    if (receipt !== undefined) result.receipt = receipt;
    return result as RoomActionOutcome;
  }
  const result: UnknownRecord = {
    kind: "retryableFailure",
    code: code === "quotaExhausted" ? "quotaExhausted" : "modelTransient",
  };
  if (receipt !== undefined) result.receipt = receipt;
  if (isRecord(error) && typeof error.retryAfter === "number") {
    result.retryAfter = error.retryAfter;
  }
  return result as RoomActionOutcome;
}

function authorityFailure(error: unknown, receipt?: unknown): RoomActionOutcome {
  const result: UnknownRecord = { kind: "retryableFailure", code: "authorityTransient" };
  if (receipt !== undefined) result.receipt = receipt;
  if (isRecord(error) && typeof error.retryAfter === "number") {
    result.retryAfter = error.retryAfter;
  }
  return result as RoomActionOutcome;
}

function observedParts(observed: unknown): { readModel: unknown; delivery?: unknown } {
  if (isRecord(observed) && "readModel" in observed) {
    return {
      readModel: observed.readModel,
      ...(observed.delivery !== undefined ? { delivery: observed.delivery } : {}),
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
): Promise<RoomActionOutcome> {
  let observed: unknown;
  try {
    observed = await context.authority.observe(context.principal);
  } catch (error) {
    return authorityFailure(error, result.receipt);
  }
  const { readModel, delivery } = observedParts(observed);

  if (result.kind === "awaitingInput") {
    return {
      kind: "awaitingInput",
      receipt: result.receipt,
      readModel,
      pending: projectedPendingInput(readModel, result.pending),
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

function finalNeedsKp(result: UnknownRecord): RoomActionOutcome {
  const outcome: UnknownRecord = { kind: "needsKp", receipt: result.receipt };
  copyOptionalRetryAfter(result, outcome);
  return outcome as RoomActionOutcome;
}

function parseDeliveryPlan(value: unknown): DeliveryPlan | undefined {
  if (!isRecord(value) || !("publishCapability" in value) || value.publishCapability == null) {
    return undefined;
  }
  if (!Array.isArray(value.audiences)) return undefined;

  const audienceIds = new Set<string>();
  const audiences: DeliveryAudience[] = [];
  for (const candidate of value.audiences) {
    if (!isRecord(candidate)) return undefined;
    const audienceId = requiredString(candidate, "audienceId");
    const hasKpProjection = "kpProjection" in candidate;
    const hasProjection = "projection" in candidate;
    if (!audienceId || hasKpProjection === hasProjection || audienceIds.has(audienceId)) {
      return undefined;
    }
    const projection = hasKpProjection ? candidate.kpProjection : candidate.projection;
    if (projection === undefined) return undefined;
    audienceIds.add(audienceId);
    audiences.push({ audienceId, projection });
  }

  return { publishCapability: value.publishCapability, audiences };
}

function publicationNarration(value: unknown, projection: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error("KP narration is not publishable");
  const text = requiredString(value, "text") ?? requiredString(value, "body");
  if (!text) throw new Error("KP narration has no current-response text");
  const agencyClaims = validateNarrationAgencyClaims(value, projection);
  return { text, agencyClaims };
}

async function narrateDeliveryPlan(
  context: Pick<RoomActionContext, "authority" | "kp"> | RoomCorrectionContext,
  prepared: UnknownRecord,
  result: UnknownRecord,
  audiences: DeliveryAudience[],
): Promise<UnknownRecord[]> {
  const frames: Array<UnknownRecord | undefined> = new Array(audiences.length);
  let cursor = 0;
  let failed = false;

  const narrateNext = async () => {
    while (cursor < audiences.length) {
      const index = cursor;
      cursor += 1;
      const audience = audiences[index];
      try {
        const narration = await context.kp.narrate({
          rootActionId: prepared.rootActionId,
          receipt: result.receipt,
          audienceId: audience.audienceId,
          projection: audience.projection,
        });
        frames[index] = {
          audienceId: audience.audienceId,
          narration: publicationNarration(narration, audience.projection),
        };
      } catch {
        failed = true;
      }
    }
  };

  const workerCount = Math.min(MAX_NARRATION_CONCURRENCY, audiences.length);
  await Promise.all(Array.from({ length: workerCount }, narrateNext));
  if (failed || frames.some((frame) => frame === undefined)) {
    throw new Error("One or more audience narrations could not be generated");
  }
  return frames as UnknownRecord[];
}

async function publishDeliveryPlan(
  context: Pick<RoomActionContext, "authority" | "kp"> | RoomCorrectionContext,
  prepared: UnknownRecord,
  result: UnknownRecord,
): Promise<void> {
  const deliveryPlan = parseDeliveryPlan(result.deliveryPlan);
  if (!deliveryPlan) throw new Error("Room Authority returned an invalid delivery plan");
  if (context.authority.deliveryPublicationStatus) {
    const publicationStatus = await context.authority.deliveryPublicationStatus({
      publishCapability: deliveryPlan.publishCapability,
    });
    if (
      !isRecord(publicationStatus)
      || !["open", "published", "superseded"].includes(String(publicationStatus.kind))
    ) {
      throw new Error("Room Authority returned an invalid delivery publication status");
    }
    if (publicationStatus.kind === "published" || publicationStatus.kind === "superseded") {
      return;
    }
  }

  const frames = await narrateDeliveryPlan(
    context,
    prepared,
    result,
    deliveryPlan.audiences,
  );
  if (!context.authority.publishDelivery) {
    throw new Error("Room Authority delivery capability is unavailable");
  }
  const publicationResult = await context.authority.publishDelivery(
    { publishCapability: deliveryPlan.publishCapability },
    { frames },
  );
  if (
    !isRecord(publicationResult)
    || (publicationResult.kind !== "published" && publicationResult.kind !== "superseded")
  ) {
    throw new Error("Room Authority did not accept the delivery publication");
  }
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
    return authorityFailure(error) as Extract<
      RoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >;
  }
  if (!isRecord(committedValue)) {
    return authorityFailure(undefined) as Extract<
      RoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >;
  }
  const failure = publicFailure(committedValue);
  if (failure !== undefined) {
    return failure as Extract<
      RoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >;
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
    return authorityFailure(undefined, committedValue.receipt) as Extract<
      RoomActionOutcome,
      { kind: "retryableFailure" | "rejected" }
    >;
  }

  let deliveryPending = false;
  try {
    await publishDeliveryPlan(
      context,
      { rootActionId: committedValue.receipt.rootActionId },
      committedValue,
    );
  } catch {
    deliveryPending = true;
  }
  return {
    kind: "committed",
    correctionId,
    strategy,
    activeBranchId,
    supersededRootActionIds: [...committedValue.supersededRootActionIds] as string[],
    receipt: committedValue.receipt,
    ...(deliveryPending ? { deliveryPending: true as const } : {}),
  };
}

async function publishCommittedOutcome(
  context: RoomActionContext,
  prepared: UnknownRecord,
  result: UnknownRecord,
): Promise<RoomActionOutcome> {
  let deliveryPending = false;
  try {
    await publishDeliveryPlan(context, prepared, result);
  } catch {
    deliveryPending = true;
  }

  let observed: unknown;
  try {
    observed = await context.authority.observe(context.principal);
  } catch (error) {
    return authorityFailure(error, result.receipt);
  }
  const { readModel, delivery } = observedParts(observed);
  return {
    kind: result.kind as "committed" | "concluded",
    receipt: result.receipt,
    readModel,
    ...(!deliveryPending && delivery !== undefined ? { delivery } : {}),
    ...(deliveryPending ? { deliveryPending: true as const } : {}),
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

/**
 * Coordinates one authenticated room action. It owns no clock, randomness, or state;
 * those capabilities remain inside the Room Authority and KP adapter boundaries.
 */
export async function handleRoomAction(
  context: RoomActionContext,
  input: RoomActionInput,
): Promise<RoomActionOutcome> {
  const rebuilt = rebuildInput(input);
  if (isRejectedValidation(rebuilt)) return rebuilt;

  if (rebuilt.kind === "acknowledge") {
    try {
      return await context.authority.acknowledge(
        context.principal,
        rebuilt.deliveryId,
      ) as RoomActionOutcome;
    } catch (error) {
      return authorityFailure(error);
    }
  }

  let preparedResult: unknown;
  try {
    preparedResult = await context.authority.prepare(context.principal, rebuilt);
  } catch (error) {
    return authorityFailure(error);
  }
  if (!isRecord(preparedResult)) return authorityFailure(undefined);
  let preparedValue: UnknownRecord = preparedResult;

  const preparedFailure = publicFailure(preparedValue, rebuilt.kind);
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
      proposal = await context.kp.propose({
        phase: "dueActorPlan",
        preparedActionId: dueIdentifiers.preparedActionId,
        rootActionId: dueIdentifiers.rootActionId,
        dueActorPlan: preparedValue.dueActorPlan,
        projection: preparedValue.kpProjection,
        attempt: 1,
      });
    } catch (error) {
      return modelFailure(error, preparedValue.receipt);
    }
    if (!isRecord(proposal)) return modelFailure(undefined, preparedValue.receipt);

    let committed: unknown;
    try {
      committed = await context.authority.commit(
        context.principal,
        dueIdentifiers.preparedActionId,
        { ...proposal, rootActionId: dueIdentifiers.rootActionId },
      );
    } catch (error) {
      return authorityFailure(error, preparedValue.receipt);
    }
    if (!isRecord(committed)) return authorityFailure(undefined, preparedValue.receipt);
    const failure = publicFailure(committed, rebuilt.kind);
    if (failure) return failure;
    if (committed.kind !== "continue" || !isRecord(committed.prepared)) {
      return authorityFailure(undefined, committed.receipt ?? preparedValue.receipt);
    }
    preparedValue = committed.prepared;
  }

  const identifiers = preparedIdentifiers(preparedValue);
  if (!identifiers) return authorityFailure(undefined, preparedValue.receipt);

  if (
    (
      rebuilt.kind === "answer"
      || rebuilt.kind === "gear"
      || rebuilt.kind === "environmentInteract"
      || rebuilt.kind === "environmentAbility"
      || rebuilt.kind === "movement"
      || rebuilt.kind === "safetyPause"
      || rebuilt.kind === "safetyAdjust"
    )
    && preparedValue.resolutionMode === "authorityDirect"
  ) {
    let commitValue: unknown;
    try {
      commitValue = await context.authority.commit(
        context.principal,
        identifiers.preparedActionId,
        {
          kind: rebuilt.kind === "answer"
            ? "authenticatedPendingAnswer"
            : rebuilt.kind === "gear"
              ? "authenticatedGearAction"
              : rebuilt.kind === "environmentInteract"
                ? "authenticatedEnvironmentInteraction"
              : rebuilt.kind === "environmentAbility"
                ? "authenticatedEnvironmentAbility"
              : rebuilt.kind === "movement"
                ? "authenticatedMovement"
              : rebuilt.kind === "safetyPause"
                ? "authenticatedSafetyPause"
                : "authenticatedSafetyAdjustment",
          rootActionId: identifiers.rootActionId,
        },
      );
    } catch (error) {
      return authorityFailure(error, preparedValue.receipt);
    }
    if (!isRecord(commitValue)) return authorityFailure(undefined, preparedValue.receipt);
    const commitFailure = publicFailure(commitValue, rebuilt.kind);
    if (commitFailure) return commitFailure;
    if (commitValue.kind === "awaitingInput") return observeOutcome(context, commitValue);
    if (commitValue.kind === "committed" || commitValue.kind === "concluded") {
      return rebuilt.kind === "safetyPause" || rebuilt.kind === "safetyAdjust"
        ? observeOutcome(context, commitValue)
        : publishCommittedOutcome(context, preparedValue, commitValue);
    }
    return authorityFailure(undefined, commitValue.receipt ?? preparedValue.receipt);
  }

  let diagnostics: unknown;
  for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt += 1) {
    let proposal: unknown;
    try {
      proposal = await context.kp.propose({
        ...(preparedValue.phase === undefined ? {} : { phase: preparedValue.phase }),
        preparedActionId: identifiers.preparedActionId,
        rootActionId: identifiers.rootActionId,
        input: rebuilt,
        projection: preparedValue.kpProjection,
        attempt,
        ...(diagnostics !== undefined ? { diagnostics } : {}),
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
        context.principal,
        identifiers.preparedActionId,
        rulesInput,
      );
    } catch (error) {
      return authorityFailure(error, preparedValue.receipt);
    }
    if (!isRecord(commitValue)) return authorityFailure(undefined, preparedValue.receipt);

    if (isMechanicalDiagnostic(commitValue)) {
      if (attempt === MAX_PROPOSAL_ATTEMPTS) return finalNeedsKp(commitValue);
      diagnostics = commitValue.diagnostics;
      continue;
    }

    const commitFailure = publicFailure(commitValue, rebuilt.kind);
    if (commitFailure) return commitFailure;
    if (commitValue.kind === "awaitingInput") {
      return observeOutcome(context, commitValue);
    }
    if (commitValue.kind === "committed" || commitValue.kind === "concluded") {
      return publishCommittedOutcome(context, preparedValue, commitValue);
    }
    return authorityFailure(undefined, commitValue.receipt ?? preparedValue.receipt);
  }

  return authorityFailure(undefined, preparedValue.receipt);
}
