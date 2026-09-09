import { PROPOSAL_PUBLIC_FAILURE_CODES, NARRATION_PUBLIC_FAILURE_CODES, narrationPublicFailureCode, type NarrationPublicFailureCode } from "../kp/public-failure-codes";
import { characterInferenceContentText } from "../rules/v2/character-inference";
import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import { classById } from "../dnd/catalog";
import { characterProficiencyProfileEnabled } from "../rules/profiles/character-proficiency";
import type { RuntimeProfileManifest } from "../rules/profiles/types";
import {
  isTacticalProjection,
  type TacticalProjection,
} from "../rules/tactical-projection";

type JsonRecord = Record<string, unknown>;

export const V3_PUBLIC_FAILURE_CODES = [
  ...PROPOSAL_PUBLIC_FAILURE_CODES,
  ...NARRATION_PUBLIC_FAILURE_CODES,
] as const;

export type V3PublicFailureCode = typeof V3_PUBLIC_FAILURE_CODES[number];

const V3_PUBLIC_FAILURE_CODE_SET = new Set<string>(V3_PUBLIC_FAILURE_CODES);

export function publicV3FailureCode(value: unknown): V3PublicFailureCode | undefined {
  if (value === "DUE_DECISION_INVALID" || value === "ACTOR_PLAN_DECISION_INVALID") return "FOLLOWUP_DECISION_INVALID";
  if (value === "ACTOR_PLAN_DECISION_OUTCOME_UNKNOWN") return "FOLLOWUP_DECISION_OUTCOME_UNKNOWN";
  return typeof value === "string" && V3_PUBLIC_FAILURE_CODE_SET.has(value)
    ? value as V3PublicFailureCode
    : undefined;
}

export function publicNarrationFailureReason(value: unknown): string {
  switch (publicV3FailureCode(value)) {
    case "NARRATION_PROVIDER_TIMEOUT":
      return "KP 服务暂时不可用，或本次响应超过时限";
    case "NARRATION_PROVIDER_REJECTED":
      return "KP 服务拒绝了生成或审核请求，回复检查尚未完成";
    case "NARRATION_BODY_INVALID":
      return "KP 返回的回复内容未通过格式检查";
    case "NARRATION_CONTEXT_BUDGET_EXCEEDED":
      return "本次回复所需内容超出处理容量，行动结果已保留";
    case "NARRATION_GROUNDING_REJECTED":
      return "KP 回复与已经结算的事实不一致";
    case "NARRATION_PUBLICATION_FAILED":
      return "KP 回复生成或传送过程中出现故障";
    default:
      return "KP 回复暂未完成，原因尚未确认";
  }
}

export function publicNarrationRecoveryReason(value: unknown, failure?: unknown): string {
  const failureCode = value === "pending" ? undefined : narrationPublicFailureCode(failure);
  if (failureCode !== undefined) {
    const recovery = failureCode === "NARRATION_CONTEXT_BUDGET_EXCEEDED"
      ? "请联系维护者检查回复容量；反复重试通常无法解决。"
      : failureCode === "NARRATION_PROVIDER_REJECTED"
        ? "可点击“重试 KP 回复”；持续被拒绝时，请联系维护者检查 KP 服务权限或请求限制。"
        : "请点击“重试 KP 回复”；若同样的错误持续出现，请联系维护者。";
    return `${publicNarrationFailureReason(failureCode)}。${recovery}`;
  }
  switch (value) {
    case "pending":
      return "KP 回复仍在处理中，请等待桌面更新。";
    case "rejected":
      return "KP 服务请求被拒绝，或回复未通过检查，具体原因尚未确认。可点击“重试 KP 回复”；持续失败时请联系维护者。";
    case "retryableFailure":
      return "KP 服务或回复发布失败，具体原因尚未确认。请点击“重试 KP 回复”；持续失败时请联系维护者。";
    default:
      return "KP 回复暂未完成，原因尚未确认。请刷新桌面查看当前状态。";
  }
}

// These explanations come from closed server-owned categories, never from
// model output, internal exception text, candidate details or another viewer.
const ACTION_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  FOLLOWUP_DECISION_INVALID: "后续世界行动的裁定未通过检查，相关执行已暂停；已经发生的事实仍保留。请联系维护者检查，反复提交新行动无法解决。",
  FOLLOWUP_DECISION_OUTCOME_UNKNOWN: "后续世界行动的模型响应未能可靠保存，系统已暂停相关执行，以免重复处理。已经发生的事实仍保留，请联系维护者检查。",
  PROPOSAL_PROVIDER_TIMEOUT: "KP 服务未能及时返回裁定，可能是连接中断、服务繁忙或响应超时。行动未提交；请稍后重试原行动。",
  PROPOSAL_PROVIDER_CONFIGURATION: "KP 服务配置不完整或当前模型无法使用，行动未提交。请联系房主或维护者检查模型配置；修改行动描述无法解决这个问题。",
  PROPOSAL_FORM_INVALID: "KP 返回的行动方案格式不符合规则要求，行动未提交。可以补充或修改具体做法后重新提交；若持续发生，请联系维护者检查。",
  PROPOSAL_REFERENCE_INVALID: "KP 方案中引用的对象或能力无法核对，行动未提交。请确认你指的是当前可见的哪个目标；目标已明确仍报错时，请联系维护者。",
  PROPOSAL_REPAIR_EXHAUSTED: "KP 没能把这项行动整理成可以裁定的形式，行动未提交。原样重试会得到同样的结果；请补充具体做法后再提交。描述已明确仍失败时，请联系维护者。",
  PROPOSAL_RULES_DIAGNOSTIC: "KP 提出的执行方案没有通过规则检查，行动未提交。请检查当前目标、条件和资源并调整做法；原样重试不会改变这份方案。若条件本来满足，请联系维护者。",
  CONTEXT_INSUFFICIENT: "系统未能取得裁定这项行动所需的信息，行动未提交。请刷新桌面并补充具体目标或做法；信息已明确仍失败时，请联系维护者。",
  CONTEXT_BUDGET_EXCEEDED: "本次裁定需要加载的资料超出处理容量，行动未提交。请联系维护者检查；这通常不能靠反复点击重试解决。",
  PROPOSAL_INPUT_BUDGET_EXCEEDED: "本次行动请求超出模型的处理容量，行动未提交。请缩短重复描述，保留目标和关键做法；仍失败时请联系维护者。",
  PROPOSAL_INVOCATION_IN_PROGRESS: "这条行动的裁定仍在处理中，当前尚未取得最终结果。请保留原行动并等待桌面更新，不要重复提交新行动。",
  modelTransient: "KP 服务暂时未返回有效响应，行动未提交。请稍后重试原行动；持续失败时请联系维护者。",
  modelPermanent: "当前 KP 模型无法使用，行动未提交。请联系房主或维护者检查模型配置与服务权限。",
  quotaExhausted: "KP 服务的可用额度不足，本次裁定没有完成。请联系房主或维护者检查额度，恢复后再重试原行动。",
  scopeConflict: "处理期间相关角色或场景状态已经变化，本次行动未提交。请刷新桌面，按最新状态重新确认目标和做法。",
  spatialStateChanged: "战术空间已经变化，本次移动未提交。请刷新地图并重新选择路径。",
  causalFrontierConflict: "相关角色的时间进度尚未对齐，本次行动未提交。请等待相关行动完成、刷新桌面后再试。",
  authorityTransient: "房间服务暂时没有确认处理结果。请先刷新桌面查看状态，再使用原操作的重试入口恢复，避免另发相同行动。",
  projectionFailure: "系统未能把处理结果核对为你可见的桌面信息，当前无法确认完整显示结果。请刷新桌面查看状态；持续出现时请联系维护者，勿反复发起相同行动。",
  projectionIntegrity: "桌面信息的完整性核对未通过，系统暂未展示这批结果。请刷新桌面重新读取；持续出现时请联系维护者。",
  referenceUnavailable: "本次操作指向的对象或待处理选项当前不可用。请刷新桌面，只选择当前展示且由你操作的目标；问题持续时请联系房主。",
  narrationRecoveryUnavailable: "这条 KP 回复已送达、已被后续回复替代，或当前账号无法恢复它。请刷新桌面查看最新回复。",
  viewerNarrationRecoveryRequired: "你还有一条已经结算、但尚未送达的 KP 回复。请先点击“重试 KP 回复”，再继续新行动。",
  unauthenticated: "登录会话已失效，本次操作未获授权。请重新登录，再打开这间房。",
  seatInactive: "你当前不在这间房的有效席位中。请回酒馆使用房间码重新加入。",
  viewerUnauthorized: "当前账号没有执行这项操作的权限。请刷新桌面确认角色控制权，或联系房主处理。",
  notController: "这项操作需要由该角色的控制者完成。请刷新桌面确认你当前控制的角色。",
  roomAdministrationUnauthorized: "这项房间管理操作需要房主权限。请联系房主处理。",
  insufficientResource: "当前可用资源不足，行动未提交。请检查人物卡中的法术位、次数或物品数量，再选择可用的行动。",
  missingPrerequisite: "当前尚未满足这项行动的必要条件，行动未提交。请检查目标、距离、装备和角色状态，再调整做法。",
  bonusActionSpellRestriction2014: "本回合的施法组合不符合附赠动作施法限制，行动未提交。使用附赠动作法术后，本回合其他法术只能是施法时间为一个动作的戏法。",
  pendingInputUnresolved: "还有一个需要先回答的选择，行动未提交。请先完成桌面当前显示的选择或掷骰。",
  unchangedRetry: "这项行动的相关条件没有变化，不能直接重复同一检定。请改变做法或先创造新的条件。",
  movementUnavailable: "当前状态下无法完成这条移动路径。请按地图中已知的道路、障碍和可用移动距离重新选择。",
  presentationUnavailable: "当前回复无法安全显示。请刷新桌面读取已确认的结果；持续出现时请联系维护者。",
  validation: "这次操作的输入有缺项或格式不正确，未被接受。请检查并重新选择必填选项；页面自动填写的操作仍报错时，请刷新后联系维护者。",
  invalidRulesInput: "这次操作的参数未通过规则检查，行动未提交。请重新选择当前可用的目标和选项；仍失败时请联系维护者。",
  invalidActionInput: "这次行动缺少有效参数或提交标识，服务端没有接受请求。请刷新页面并重新选择操作；仍失败时请联系维护者。",
  invalidPendingResolution: "这次选择的回答格式无效，服务端没有接受请求。请刷新桌面，使用当前显示的选项重新回答。",
  unsupportedPendingResolution: "当前选项不支持这种回答方式。请刷新桌面，使用页面显示的按钮或选项操作；仍失败时请联系维护者。",
  readSetConflict: "处理期间行动依据的状态已经更新。请刷新桌面，按当前信息重新确认目标和做法。",
  requiredContextUnavailable: "裁定所需的房间信息当前无法读取。请刷新桌面后再试；持续出现时请联系维护者。",
  profileIntegrityMismatch: "本桌的规则或模型配置未通过完整性检查，系统已停止本次处理。请联系维护者检查房间配置；反复提交行动无法解决。",
  invalidRulesResult: "规则服务没有返回可确认的结果。请刷新桌面查看当前状态；持续出现时请联系维护者，勿反复发起相同行动。",
  narrationPredecessorPending: "前一条 KP 回复还未送达，当前回复需按顺序恢复。请刷新桌面，先处理当前显示的回复。",
  idempotencyPayloadMismatch: "重试时的行动内容与原提交不一致。请用原操作的恢复入口重试；要改变做法，请先确认原行动结果。",
  roomDeleting: "这间房正在删除，已停止接受操作。请返回酒馆查看房间列表。",
  unsupportedOperation: "系统目前还不能执行这种操作，行动未提交。请尝试当前已支持的做法，并把这次操作反馈给维护者。",
  unsupportedMechanicPrimitive: "这项效果包含系统尚未支持的规则，行动未提交。请联系维护者确认支持范围。",
  correctionRequired: "系统发现需要更正的既有结果，无法直接继续这项行动。请联系房主或维护者核对相关行动记录后处理。",
};

export function publicAuthoritativeOutcomeError(outcome: {
  kind: string;
  code?: unknown;
}): string {
  const publicCode = publicV3FailureCode(outcome.code);
  if (publicCode !== undefined && Object.hasOwn(ACTION_FAILURE_MESSAGES, publicCode)) return ACTION_FAILURE_MESSAGES[publicCode];
  if (typeof outcome.code === "string" && Object.hasOwn(ACTION_FAILURE_MESSAGES, outcome.code)) {
    return ACTION_FAILURE_MESSAGES[outcome.code];
  }
  if (outcome.kind === "needsKp") {
    return "KP 尚未完成这项行动的裁定，服务端没有提供可公开的具体原因。请先刷新桌面查看状态；问题持续时，请把本次操作反馈给维护者。";
  }
  return "这次操作未能完成，服务端没有提供可公开的具体原因。请先刷新桌面确认结果；如需重试，请使用原操作的重试入口，问题持续时联系维护者。";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function viewerNarrationRecovery(value: unknown): {
  kind: "available";
  capability: string;
  state: "pending" | "rejected" | "retryableFailure";
  failureCode?: NarrationPublicFailureCode;
} | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || value.kind !== "available"
    || Object.keys(value).some(key => !["kind", "capability", "state", "failureCode"].includes(key))
    || !["pending", "rejected", "retryableFailure"].includes(String(value.state))) {
    throw new TypeError("Authoritative narration recovery projection is invalid.");
  }
  const capability = nonEmptyString(value.capability);
  if (capability === undefined || capability.length > 200) {
    throw new TypeError("Authoritative narration recovery capability is invalid.");
  }
  const failureCode = narrationPublicFailureCode(value.failureCode);
  if (value.failureCode !== undefined && (failureCode === undefined || value.state === "pending")) {
    throw new TypeError("Authoritative narration recovery failure code is invalid.");
  }
  return {
    kind: "available",
    capability,
    state: value.state as "pending" | "rejected" | "retryableFailure",
    ...(failureCode === undefined ? {} : { failureCode }),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pendingPlayerRolls(
  value: unknown,
  userId: string,
  viewerCharacterId: string,
) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError("Authoritative pending-player-roll projection is invalid.");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new TypeError("Authoritative pending-player-roll projection is invalid.");
    }
    const allowed = new Set([
      "ability",
      "advantage",
      "characterId",
      "dc",
      "dice",
      "disadvantage",
      "id",
      "kind",
      "name",
      "reason",
      "skill",
    ]);
    const id = nonEmptyString(entry.id);
    const characterId = nonEmptyString(entry.characterId);
    const name = nonEmptyString(entry.name);
    const ability = nonEmptyString(entry.ability);
    const reason = nonEmptyString(entry.reason);
    const dice = nonEmptyString(entry.dice);
    const skill = entry.skill === undefined ? undefined : nonEmptyString(entry.skill);
    const dc = finiteNumber(entry.dc);
    const kind = ["check", "save", "attack", "init", "damage", "death", "heal"]
      .includes(String(entry.kind))
      ? entry.kind as "check" | "save" | "attack" | "init" | "damage" | "death" | "heal"
      : undefined;
    if (
      Object.keys(entry).some((key) => !allowed.has(key))
      || !id
      || seen.has(id)
      || characterId !== viewerCharacterId
      || !name
      || !ability
      || !reason
      || !dice
      || !kind
      || !Number.isSafeInteger(dc)
      || dc! < 0
      || dc! > 30
      || (entry.skill !== undefined && skill === undefined)
      || (entry.advantage !== undefined && typeof entry.advantage !== "boolean")
      || (entry.disadvantage !== undefined && typeof entry.disadvantage !== "boolean")
      || (entry.advantage === true && entry.disadvantage === true)
    ) throw new TypeError("Authoritative pending-player-roll projection is invalid.");
    seen.add(id);
    return {
      id,
      userId,
      name,
      ability,
      ...(skill === undefined ? {} : { skill }),
      kind,
      dc: dc!,
      reason,
      dice,
      ...(entry.advantage === true ? { advantage: true } : {}),
      ...(entry.disadvantage === true ? { disadvantage: true } : {}),
      authoritative: true as const,
    };
  });
}

type ExperiencedTableMessage = {
  id: string;
  user_id: string | null;
  kind: "say" | "narrate" | "roll";
  name: string;
  body: string;
  created_at: string;
  clues: Array<{ id: string; name: string; hint: string }>;
  sceneIds: string[];
};

function experiencedTableMessages(value: unknown, trustedUserId: string): ExperiencedTableMessage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = nonEmptyString(entry.messageId) ?? nonEmptyString(entry.id);
    const body = nonEmptyString(entry.body);
    const name = nonEmptyString(entry.speakerName) ?? nonEmptyString(entry.name);
    const speakerKind = entry.kind === "player" || entry.speakerKind === "player"
      ? "player"
      : entry.kind === "kp" || entry.speakerKind === "kp"
        ? "kp"
        : entry.kind === "roll" ? "roll" : undefined;
    const sceneIds = Array.isArray(entry.sceneIds)
      ? [...new Set(entry.sceneIds.map(nonEmptyString).filter((sceneId): sceneId is string => Boolean(sceneId)))]
      : [];
    if (!id || !body || !name || !speakerKind || sceneIds.length === 0 || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      user_id: speakerKind === "player" ? trustedUserId : null,
      kind: speakerKind === "player" ? ("say" as const) : speakerKind === "roll" ? ("roll" as const) : ("narrate" as const),
      name,
      body,
      created_at: "",
      clues: [],
      sceneIds,
    }];
  });
}

function safeSafetyPresentation(value: unknown) {
  if (!isRecord(value)) return undefined;
  const status = value.status === "paused" || value.status === "resumed"
    ? value.status
    : undefined;
  const presentationAdjustment = value.presentationAdjustment === null
    ? null
    : value.presentationAdjustment === "fadeToBlack"
      || value.presentationAdjustment === "reduceDetail"
      || value.presentationAdjustment === "skipSensitiveContent"
      ? value.presentationAdjustment
      : undefined;
  return status === undefined || presentationAdjustment === undefined
    ? undefined
    : { status, presentationAdjustment };
}

function closedTacticalProjectionV1(input: {
  value: unknown;
  viewerCharacterId: string;
  sceneId?: string;
}): TacticalProjection {
  if (
    !isTacticalProjection(input.value)
    || input.value.self.id !== input.viewerCharacterId
    || (input.sceneId !== undefined && input.value.scene.id !== input.sceneId)
  ) {
    throw new TypeError("Authoritative tactical projection is invalid.");
  }
  return structuredClone(input.value);
}

export type ArcaneRecoverySlotLevel = 1 | 2 | 3 | 4 | 5;

export type ArcaneRecoveryCharacter = {
  restRecoveryOptions?: {
    shortRest?: {
      hitDiceMaximumSpend?: number;
      hitDieSides?: number;
      arcaneRecovery?: {
        eligible?: boolean;
        spellLevelBudget?: number;
        maximumSlotsByLevel?: Partial<Record<ArcaneRecoverySlotLevel, number>>;
      };
    };
  };
};

export type ArcaneRecoveryAvailability = {
  eligible: boolean;
  budget: number;
  missingByLevel: Record<ArcaneRecoverySlotLevel, number>;
};

const ARCANE_RECOVERY_SLOT_LEVELS = [1, 2, 3, 4, 5] as const;

export function arcaneRecoveryAvailability(
  character: ArcaneRecoveryCharacter | null | undefined,
): ArcaneRecoveryAvailability {
  const projected = character?.restRecoveryOptions?.shortRest?.arcaneRecovery;
  const missingByLevel = Object.fromEntries(ARCANE_RECOVERY_SLOT_LEVELS.map((slotLevel) => [
    slotLevel,
    Number.isSafeInteger(projected?.maximumSlotsByLevel?.[slotLevel])
      ? Math.max(0, Number(projected?.maximumSlotsByLevel?.[slotLevel]))
      : 0,
  ])) as Record<ArcaneRecoverySlotLevel, number>;
  return {
    eligible: projected?.eligible === true,
    budget: Number.isSafeInteger(projected?.spellLevelBudget)
      ? Math.max(0, Number(projected?.spellLevelBudget))
      : 0,
    missingByLevel,
  };
}

function safeRestRecoveryOptions(value: unknown): ArcaneRecoveryCharacter["restRecoveryOptions"] {
  if (!isRecord(value) || !isRecord(value.shortRest)) return undefined;
  const shortRest = value.shortRest;
  const hitDiceMaximumSpend = finiteNumber(shortRest.hitDiceMaximumSpend);
  const hitDieSides = finiteNumber(shortRest.hitDieSides);
  const arcane = isRecord(shortRest.arcaneRecovery) ? shortRest.arcaneRecovery : undefined;
  const spellLevelBudget = finiteNumber(arcane?.spellLevelBudget);
  const rawMaximumSlotsByLevel = isRecord(arcane?.maximumSlotsByLevel)
    ? arcane.maximumSlotsByLevel
    : undefined;
  const maximumSlotsByLevel = rawMaximumSlotsByLevel !== undefined
    ? Object.fromEntries(ARCANE_RECOVERY_SLOT_LEVELS.map((level) => {
        const maximum = finiteNumber(rawMaximumSlotsByLevel[level]);
        return [level, maximum !== undefined && Number.isSafeInteger(maximum) && maximum >= 0
          ? maximum
          : 0];
      }))
    : undefined;
  if (hitDiceMaximumSpend === undefined
    || !Number.isSafeInteger(hitDiceMaximumSpend)
    || hitDiceMaximumSpend < 0
    || arcane === undefined
    || typeof arcane.eligible !== "boolean"
    || spellLevelBudget === undefined
    || !Number.isSafeInteger(spellLevelBudget)
    || spellLevelBudget < 0
    || maximumSlotsByLevel === undefined) return undefined;
  return {
    shortRest: {
      hitDiceMaximumSpend,
      ...(hitDieSides !== undefined && Number.isSafeInteger(hitDieSides) && hitDieSides > 0
        ? { hitDieSides }
        : {}),
      arcaneRecovery: {
        eligible: arcane.eligible,
        spellLevelBudget,
        maximumSlotsByLevel,
      },
    },
  };
}

export function changeArcaneRecoverySelection(
  character: ArcaneRecoveryCharacter | null | undefined,
  selection: number[],
  slotLevel: ArcaneRecoverySlotLevel,
  delta: -1 | 1,
): number[] {
  const current = selection.filter((level): level is ArcaneRecoverySlotLevel =>
    Number.isSafeInteger(level) && level >= 1 && level <= 5).sort((left, right) => left - right);
  if (delta === -1) {
    const removeAt = current.lastIndexOf(slotLevel);
    return removeAt === -1
      ? current
      : current.filter((_level, index) => index !== removeAt);
  }
  const availability = arcaneRecoveryAvailability(character);
  const selectedAtLevel = current.filter((level) => level === slotLevel).length;
  const spent = current.reduce((sum, level) => sum + level, 0);
  return !availability.eligible
    || selectedAtLevel >= availability.missingByLevel[slotLevel]
    || spent + slotLevel > availability.budget
    ? current
    : [...current, slotLevel].sort((left, right) => left - right);
}

function safeAbilityScores(value: unknown): Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number> | undefined {
  if (!isRecord(value)) return undefined;
  const abilities = ["str", "dex", "con", "int", "wis", "cha"] as const;
  if (Object.keys(value).length !== abilities.length) return undefined;
  const entries = abilities.flatMap((ability) => {
    const score = finiteNumber(value[ability]);
    return score !== undefined && Number.isSafeInteger(score) && score >= 1 && score <= 30
      ? [[ability, score] as const]
      : [];
  });
  return entries.length === abilities.length
    ? Object.fromEntries(entries) as Record<typeof abilities[number], number>
    : undefined;
}

const AUTHORITATIVE_GEAR_SLOTS = new Set([
  "head",
  "neck",
  "cloak",
  "armor",
  "hands",
  "belt",
  "boots",
  "ring1",
  "ring2",
  "main",
  "off",
  "ammo",
]);

const AUTHORITATIVE_GEAR_SLOT_ORDER = [
  "head",
  "neck",
  "cloak",
  "armor",
  "hands",
  "belt",
  "boots",
  "ring1",
  "ring2",
  "main",
  "off",
  "ammo",
] as const;

const AUTHORITATIVE_ITEM_CATEGORIES = new Set([
  "weapon",
  "armor",
  "shield",
  "ammunition",
  "consumable",
  "tool",
  "currency",
  "equipment",
  "object",
]);

const AUTHORITATIVE_ITEM_ACTIVITY_DISABLED_REASONS = new Set([
  "itemBroken",
  "insufficientQuantity",
  "insufficientCharges",
  "insufficientDurability",
]);

export type AuthoritativeInventoryActivity = {
  activityId: "use";
  label: "使用";
  enabled: boolean;
  disabledReason:
    | "itemBroken"
    | "insufficientQuantity"
    | "insufficientCharges"
    | "insufficientDurability"
    | null;
};

type AuthoritativeInventoryEntryState = {
  entryId: string;
  quantity: number;
  condition: "usable" | "broken";
  equippedSlot: typeof AUTHORITATIVE_GEAR_SLOT_ORDER[number] | null;
};

export type AuthoritativeOpaqueInventoryEntry = AuthoritativeInventoryEntryState & {
  kind: "opaque";
};

export type AuthoritativeIdentifiedInventoryEntry = AuthoritativeInventoryEntryState & {
  kind: "identified";
  name: string;
  description: string;
  category:
    | "weapon"
    | "armor"
    | "shield"
    | "ammunition"
    | "consumable"
    | "tool"
    | "currency"
    | "equipment"
    | "object";
  charges: { current: number; maximum: number } | null;
  durability: { current: number; maximum: number } | null;
  allowedSlots: Array<typeof AUTHORITATIVE_GEAR_SLOT_ORDER[number]>;
  twoHanded: boolean;
  publicDamageText: string | null;
  activities: AuthoritativeInventoryActivity[];
};

export type AuthoritativeInventoryEntry =
  | AuthoritativeOpaqueInventoryEntry
  | AuthoritativeIdentifiedInventoryEntry;

export type AuthoritativeInventory = {
  entries: AuthoritativeInventoryEntry[];
};

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function safeProjectedText(value: unknown, maximum: number): string | undefined {
  const text = nonEmptyString(value);
  return text !== undefined && text.length <= maximum && text.normalize("NFC") === text
    ? text
    : undefined;
}

function safeItemCounter(value: unknown): { current: number; maximum: number } | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["current", "maximum"])) return undefined;
  const current = finiteNumber(value.current);
  const maximum = finiteNumber(value.maximum);
  return Number.isSafeInteger(current)
    && current! >= 0
    && Number.isSafeInteger(maximum)
    && maximum! > 0
    && current! <= maximum!
    && maximum! <= 1_000_000
    ? { current: current!, maximum: maximum! }
    : undefined;
}

function safeInventoryActivity(value: unknown): AuthoritativeInventoryActivity | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, ["activityId", "disabledReason", "enabled", "label"])
    || value.activityId !== "use"
    || value.label !== "使用"
    || typeof value.enabled !== "boolean") return undefined;
  const disabledReason = value.disabledReason === null
    ? null
    : typeof value.disabledReason === "string"
      && AUTHORITATIVE_ITEM_ACTIVITY_DISABLED_REASONS.has(value.disabledReason)
      ? value.disabledReason as AuthoritativeInventoryActivity["disabledReason"]
      : undefined;
  if (disabledReason === undefined || value.enabled !== (disabledReason === null)) return undefined;
  return {
    activityId: "use",
    label: "使用",
    enabled: value.enabled,
    disabledReason,
  };
}

function safeInventoryEntryState(value: JsonRecord): AuthoritativeInventoryEntryState | undefined {
  const entryId = safeProjectedText(value.entryId, 300);
  const quantity = finiteNumber(value.quantity);
  const condition = value.condition === "usable" || value.condition === "broken"
    ? value.condition
    : undefined;
  const equippedSlot = value.equippedSlot === null
    ? null
    : typeof value.equippedSlot === "string" && AUTHORITATIVE_GEAR_SLOTS.has(value.equippedSlot)
      ? value.equippedSlot as AuthoritativeInventoryEntryState["equippedSlot"]
      : undefined;
  return entryId !== undefined
    && Number.isSafeInteger(quantity)
    && quantity! > 0
    && quantity! <= 1_000_000
    && condition !== undefined
    && equippedSlot !== undefined
    ? { entryId, quantity: quantity!, condition, equippedSlot }
    : undefined;
}

function safeInventoryEntry(value: unknown): AuthoritativeInventoryEntry | undefined {
  if (!isRecord(value)) return undefined;
  const state = safeInventoryEntryState(value);
  if (state === undefined) return undefined;
  if (value.kind === "opaque") {
    return hasExactKeys(value, [
      "condition",
      "entryId",
      "equippedSlot",
      "kind",
      "quantity",
    ]) ? { kind: "opaque", ...state } : undefined;
  }
  if (value.kind !== "identified" || !hasExactKeys(value, [
    "activities",
    "allowedSlots",
    "category",
    "charges",
    "condition",
    "description",
    "durability",
    "entryId",
    "equippedSlot",
    "kind",
    "name",
    "publicDamageText",
    "quantity",
    "twoHanded",
  ])) return undefined;
  const name = safeProjectedText(value.name, 4_000);
  const description = safeProjectedText(value.description, 4_000);
  const category = typeof value.category === "string"
    && AUTHORITATIVE_ITEM_CATEGORIES.has(value.category)
    ? value.category as AuthoritativeIdentifiedInventoryEntry["category"]
    : undefined;
  const charges = safeItemCounter(value.charges);
  const durability = safeItemCounter(value.durability);
  const allowedSlots = Array.isArray(value.allowedSlots)
    && value.allowedSlots.length <= AUTHORITATIVE_GEAR_SLOT_ORDER.length
    && value.allowedSlots.every((slot) => typeof slot === "string" && AUTHORITATIVE_GEAR_SLOTS.has(slot))
    && new Set(value.allowedSlots).size === value.allowedSlots.length
    ? value.allowedSlots as AuthoritativeIdentifiedInventoryEntry["allowedSlots"]
    : undefined;
  const publicDamageText = value.publicDamageText === null
    ? null
    : safeProjectedText(value.publicDamageText, 4_000);
  const activities = Array.isArray(value.activities) && value.activities.length <= 1
    ? value.activities.map(safeInventoryActivity)
    : undefined;
  if (
    name === undefined
    || description === undefined
    || category === undefined
    || charges === undefined
    || durability === undefined
    || allowedSlots === undefined
    || typeof value.twoHanded !== "boolean"
    || publicDamageText === undefined
    || activities === undefined
    || activities.some((activity) => activity === undefined)
    || (state.equippedSlot !== null && !allowedSlots.includes(state.equippedSlot))
  ) return undefined;
  return {
    kind: "identified",
    ...state,
    name,
    description,
    category,
    charges,
    durability,
    allowedSlots,
    twoHanded: value.twoHanded,
    publicDamageText,
    activities: activities as AuthoritativeInventoryActivity[],
  };
}

function safeInventory(value: unknown): AuthoritativeInventory | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, ["entries"])
    || !Array.isArray(value.entries)
    || value.entries.length > 256) return undefined;
  const entries = value.entries.map(safeInventoryEntry);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const projectedEntries = entries as AuthoritativeInventoryEntry[];
  if (
    new Set(projectedEntries.map(({ entryId }) => entryId)).size !== projectedEntries.length
    || new Set(projectedEntries.flatMap(({ equippedSlot }) => equippedSlot === null ? [] : [equippedSlot])).size
      !== projectedEntries.filter(({ equippedSlot }) => equippedSlot !== null).length
  ) return undefined;
  return { entries: projectedEntries };
}

function safeCharacterLoadout(value: unknown) {
  if (!isRecord(value)) return undefined;
  const armorClass = finiteNumber(value.armorClass);
  const speedFeet = finiteNumber(value.speedFeet);
  if (
    !Number.isSafeInteger(armorClass)
    || armorClass! < 1
    || armorClass! > 99
    || !Number.isSafeInteger(speedFeet)
    || speedFeet! <= 0
    || !isRecord(value.equipped)
    || !Array.isArray(value.backpack)
    || value.backpack.length > 256
  ) return undefined;
  const equippedEntries = Object.entries(value.equipped)
    .sort(([left], [right]) => left.localeCompare(right));
  if (equippedEntries.some(([slot, itemId]) =>
    !AUTHORITATIVE_GEAR_SLOTS.has(slot) || nonEmptyString(itemId) === undefined)) return undefined;
  const backpack = value.backpack.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const itemId = nonEmptyString(entry.itemId);
    const quantity = finiteNumber(entry.quantity);
    return itemId && Number.isSafeInteger(quantity) && quantity! > 0
      ? [{ itemId, quantity: quantity! }]
      : [];
  });
  if (
    backpack.length !== value.backpack.length
    || new Set(backpack.map(({ itemId }) => itemId)).size !== backpack.length
  ) return undefined;
  return {
    armorClass: armorClass!,
    speedFeet: speedFeet!,
    equipped: Object.fromEntries(equippedEntries) as Record<string, string>,
    backpack: backpack.sort((left, right) => left.itemId.localeCompare(right.itemId)),
  };
}

function safeAdvancementOptions(value: unknown) {
  if (!isRecord(value)) return undefined;
  const classId = nonEmptyString(value.classId);
  const newLevel = finiteNumber(value.newLevel);
  const fixedHitPointGain = finiteNumber(value.fixedHitPointGain);
  const abilityScoreBudget = finiteNumber(value.abilityScoreBudget);
  const maximumAbilityScore = finiteNumber(value.maximumAbilityScore);
  const grantedFeatureIds = Array.isArray(value.grantedFeatureIds)
    ? value.grantedFeatureIds.map(nonEmptyString)
    : undefined;
  if (
    !classId
    || value.hitPointMethod !== "fixed2014"
    || !Number.isSafeInteger(newLevel)
    || newLevel! < 2
    || newLevel! > 20
    || !Number.isSafeInteger(fixedHitPointGain)
    || fixedHitPointGain! < 1
    || !Number.isSafeInteger(abilityScoreBudget)
    || ![0, 2].includes(abilityScoreBudget!)
    || !Number.isSafeInteger(maximumAbilityScore)
    || maximumAbilityScore! !== 20
    || grantedFeatureIds === undefined
    || grantedFeatureIds.some((featureId) => featureId === undefined)
    || new Set(grantedFeatureIds).size !== grantedFeatureIds.length
  ) return undefined;
  return {
    classId,
    newLevel: newLevel!,
    hitPointMethod: "fixed2014" as const,
    fixedHitPointGain: fixedHitPointGain!,
    abilityScoreBudget: abilityScoreBudget!,
    maximumAbilityScore: maximumAbilityScore!,
    grantedFeatureIds: grantedFeatureIds as string[],
  };
}

function safeGroupRestOptions(value: unknown) {
  if (!isRecord(value)) return undefined;
  const initiatorCharacterId = nonEmptyString(value.initiatorCharacterId);
  const intendedDurationMicros = nonEmptyString(value.intendedDurationMicros);
  const offeredAtFictionMicros = nonEmptyString(value.offeredAtFictionMicros);
  const restKind = value.restKind === "short" || value.restKind === "long"
    ? value.restKind
    : undefined;
  return initiatorCharacterId && intendedDurationMicros && offeredAtFictionMicros && restKind
    ? { initiatorCharacterId, intendedDurationMicros, offeredAtFictionMicros, restKind }
    : undefined;
}

function safeSocialResolutionOptions(value: unknown) {
  if (!isRecord(value)) return undefined;
  const npcCharacterId = nonEmptyString(value.npcCharacterId);
  const npcName = nonEmptyString(value.npcName);
  const goal = nonEmptyString(value.goal);
  const method = nonEmptyString(value.method);
  const risk = nonEmptyString(value.risk);
  const successOutcome = nonEmptyString(value.successOutcome);
  const failureOutcome = nonEmptyString(value.failureOutcome);
  const dc = finiteNumber(value.dc);
  const retryGate = Array.isArray(value.retryGate)
    ? value.retryGate.map(nonEmptyString)
    : undefined;
  return npcCharacterId && npcName && goal && method && risk && successOutcome && failureOutcome
    && Number.isSafeInteger(dc) && dc! >= 5 && dc! <= 30
    && retryGate !== undefined
    && retryGate.every((entry) => entry !== undefined)
    ? {
        npcCharacterId,
        npcName,
        goal,
        method,
        risk,
        successOutcome,
        failureOutcome,
        dc: dc!,
        retryGate: retryGate as string[],
      }
    : undefined;
}

function safePlayerChoices(value: unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) return undefined;
  const choices = value.flatMap((choice) => {
    if (!isRecord(choice)) return [];
    const choiceId = nonEmptyString(choice.choiceId);
    const label = nonEmptyString(choice.label);
    const consequence = nonEmptyString(choice.consequence);
    return choiceId && label && consequence ? [{ choiceId, label, consequence }] : [];
  });
  return choices.length === value.length
    && new Set(choices.map(({ choiceId }) => choiceId)).size === choices.length
    ? choices
    : undefined;
}

function safeIdentifierList(value: unknown, minimumLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < minimumLength || value.length > 64) return undefined;
  const identifiers = value.map(nonEmptyString);
  return identifiers.some((identifier) => identifier === undefined)
    || new Set(identifiers).size !== identifiers.length
    ? undefined
    : identifiers as string[];
}

function safeCombatChoice(value: JsonRecord) {
  if (value.choiceKind === "target") {
    const candidateEntityIds = safeIdentifierList(value.candidateEntityIds, 1);
    return candidateEntityIds
      ? { choiceKind: "target" as const, candidateEntityIds }
      : undefined;
  }
  if (value.choiceKind === "reaction") {
    const candidateAbilityRefs = safeIdentifierList(value.candidateAbilityRefs, 1);
    const targetEntityId = nonEmptyString(value.targetEntityId);
    return candidateAbilityRefs && targetEntityId
      ? { choiceKind: "reaction" as const, candidateAbilityRefs, targetEntityId }
      : undefined;
  }
  if (value.choiceKind === "initiativeTieOrder") {
    const orderedEntityIds = safeIdentifierList(value.orderedEntityIds, 2);
    return orderedEntityIds
      ? { choiceKind: "initiativeTieOrder" as const, orderedEntityIds }
      : undefined;
  }
  return value.choiceKind === "encounterConclusion"
    ? { choiceKind: "encounterConclusion" as const }
    : undefined;
}

function publicKnowledgeText(content: unknown): {
  name?: string;
  text?: string;
} {
  if (typeof content === "string") return { text: content };
  const inference = characterInferenceContentText(content);
  if (inference !== undefined) return { text: inference };
  if (!isRecord(content)) return {};
  return {
    name: nonEmptyString(content.title) ?? nonEmptyString(content.name),
    text:
      nonEmptyString(content.text) ??
      nonEmptyString(content.publicText) ??
      nonEmptyString(content.summary),
  };
}

function knowledgeHint(objectKind: string) {
  switch (objectKind) {
    case "sensoryEvidence":
      return "感官证据";
    case "sourceClaim":
      return "来源主张";
    case "characterInference":
      return "角色推断";
    case "canonicalFact":
      return "已知事实";
    default:
      return "已知信息";
  }
}

function isOrdinarySocialTranscriptClaim(knowledgeRef: string, objectKind: string): boolean {
  // Spoken turns remain authoritative character knowledge and transcript
  // history; they are not automatically promoted into persistent clue cards.
  return objectKind === "sourceClaim"
    && (knowledgeRef.startsWith("claim:social:")
      || knowledgeRef.startsWith("claim:social-npc:"));
}

export function buildAuthoritativeCharacterSeed(input: {
  characterId: string;
  controllerPrincipalId: string;
  sheet: unknown;
  sceneId: string;
  runtimeProfiles?: RuntimeProfileManifest;
}) {
  if (!isRecord(input.sheet)) {
    throw new TypeError("An authoritative character seed requires a structured sheet.");
  }
  const name = typeof input.sheet.name === "string" ? input.sheet.name.trim() : "";
  if (!name || !input.sceneId) {
    throw new TypeError("An authoritative character seed requires a name and scene.");
  }
  const includeCharacterProficiency = input.runtimeProfiles !== undefined
    && characterProficiencyProfileEnabled(input.runtimeProfiles.extensions);
  const canonicalStrings = (value: unknown) => Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && value.length === new Set(value).size
    ? [...value].sort()
    : undefined;
  const proficientSkills = includeCharacterProficiency
    ? canonicalStrings(input.sheet.proficientSkills ?? input.sheet.skills)
    : undefined;
  const expertiseSkills = includeCharacterProficiency
    ? canonicalStrings(input.sheet.expertiseSkills ?? input.sheet.expertise)
    : undefined;
  const proficientSaves = !includeCharacterProficiency
    ? undefined
    : input.sheet.proficientSaves === undefined
      ? typeof input.sheet.classId === "string"
        ? classById(input.sheet.classId)?.saves
        : undefined
      : canonicalStrings(input.sheet.proficientSaves);
  return {
    characterId: input.characterId,
    controllerPrincipalId: input.controllerPrincipalId,
    staticCard: {
      ...structuredClone(input.sheet),
      name,
      sceneId: input.sceneId,
      ...(proficientSkills === undefined ? {} : { proficientSkills }),
      ...(expertiseSkills === undefined ? {} : { expertiseSkills }),
      ...(proficientSaves === undefined ? {} : { proficientSaves: [...proficientSaves].sort() }),
    },
  };
}

export function buildAuthoritativeRoomSeeds(input: {
  members: Array<{ userId: string; nickname: string; isHost: boolean }>;
  lockedCharacters: Array<{ userId: string; sheet: unknown }>;
  openingSceneId: string;
  characterIdFor(userId: string): string;
  runtimeProfiles?: RuntimeProfileManifest;
}) {
  if (!input.openingSceneId) throw new TypeError("An opening scene is required.");
  const members = input.members.map((member) => ({
    principalId: member.userId,
    role: member.isHost ? ("host" as const) : ("player" as const),
  }));
  const memberIds = new Set(members.map((member) => member.principalId));
  const characters = input.lockedCharacters.map((character) => {
    if (!memberIds.has(character.userId) || !isRecord(character.sheet)) {
      throw new TypeError("Every locked character must belong to a current room member.");
    }
    return buildAuthoritativeCharacterSeed({
      characterId: input.characterIdFor(character.userId),
      controllerPrincipalId: character.userId,
      sheet: character.sheet,
      sceneId: input.openingSceneId,
      ...(input.runtimeProfiles === undefined
        ? {}
        : { runtimeProfiles: input.runtimeProfiles }),
    });
  });
  return { members, characters };
}

export function buildAuthoritativeActionInput(input: {
  submissionId: string;
  text: string;
  pendingInputId?: string;
  answer?: unknown;
  [key: string]: unknown;
}) {
  const submissionId = nonEmptyString(input.submissionId);
  const text = nonEmptyString(input.text);
  if (!submissionId || !text) {
    throw new TypeError("Authoritative actions require trusted transport identity.");
  }
  const pendingInputId = nonEmptyString(input.pendingInputId);
  return pendingInputId
      ? {
        kind: "answer" as const,
        submissionId,
        pendingInputId,
        answer: "answer" in input ? input.answer : { text },
        displayText: text,
      }
    : {
        kind: "intent" as const,
        submissionId,
        text,
      };
}

export type AuthoritativeButtonCommand =
  | { kind: "joinCombat" }
  | { kind: "extraAttack"; targetId: string }
  | { kind: "endTurn" }
  | { kind: "leaveFight"; leaveKind: "disengage" | "flee" | "withdraw" | "surrender" }
  | { kind: "resolveReact"; reactionId: string; use: boolean }
  | {
      kind: "restNow";
      restKind: "short" | "long";
      mode?: "personal" | "group";
      hitDice?: number;
      arcaneRecoverySlotLevels?: number[];
    }
  | { kind: "cancelRest" }
  | {
      kind: "castSpell";
      spellId: string;
      slot?: number;
      targetIds?: string[];
      choice?: string;
      destinationFeet?: number;
      originFeet?: number;
      ritual?: boolean;
    }
  | { kind: "useFeature"; featureId: string }
  | { kind: "useHitDie" };

function safeButtonCommand(command: AuthoritativeButtonCommand): AuthoritativeButtonCommand {
  switch (command.kind) {
    case "joinCombat":
    case "endTurn":
    case "cancelRest":
    case "useHitDie":
      return { kind: command.kind };
    case "extraAttack": {
      const targetId = nonEmptyString(command.targetId);
      if (!targetId) throw new TypeError("An explicit attack target is required.");
      return { kind: command.kind, targetId };
    }
    case "leaveFight":
      if (!["disengage", "flee", "withdraw", "surrender"].includes(command.leaveKind)) {
        throw new TypeError("The selected way to leave combat is invalid.");
      }
      return { kind: command.kind, leaveKind: command.leaveKind };
    case "resolveReact": {
      const reactionId = nonEmptyString(command.reactionId);
      if (!reactionId || typeof command.use !== "boolean") {
        throw new TypeError("A reaction decision must identify the pending reaction.");
      }
      return { kind: command.kind, reactionId, use: command.use };
    }
    case "restNow": {
      if (!["short", "long"].includes(command.restKind)) {
        throw new TypeError("The selected rest kind is invalid.");
      }
      if (
        command.arcaneRecoverySlotLevels !== undefined
        && (
          !Array.isArray(command.arcaneRecoverySlotLevels)
          || command.arcaneRecoverySlotLevels.length > 20
          || !command.arcaneRecoverySlotLevels.every((level) =>
            Number.isSafeInteger(level) && level >= 1 && level <= 5)
        )
      ) {
        throw new TypeError("Arcane Recovery slot levels must be canonical 1-5 integers.");
      }
      const arcaneRecoverySlotLevels = command.arcaneRecoverySlotLevels === undefined
        ? undefined
        : [...command.arcaneRecoverySlotLevels].sort((left, right) => left - right);
      if (command.hitDice !== undefined
        && (!Number.isSafeInteger(command.hitDice)
          || command.hitDice < 0
          || command.hitDice > 20)) {
        throw new TypeError("Hit-die spending must be a canonical 0-20 integer.");
      }
      if (command.restKind === "long" && arcaneRecoverySlotLevels?.length) {
        throw new TypeError("Arcane Recovery choices are available only during a short rest.");
      }
      if (command.restKind === "long" && command.hitDice !== undefined && command.hitDice !== 0) {
        throw new TypeError("Hit dice cannot be spent during a long rest.");
      }
      return {
        kind: command.kind,
        restKind: command.restKind,
        ...(command.mode === "personal" || command.mode === "group"
          ? { mode: command.mode }
          : {}),
        ...(command.hitDice !== undefined
          ? { hitDice: command.hitDice }
          : {}),
        ...(arcaneRecoverySlotLevels === undefined
          ? {}
          : { arcaneRecoverySlotLevels }),
      };
    }
    case "castSpell": {
      const spellId = nonEmptyString(command.spellId);
      if (!spellId) throw new TypeError("A spell selection is required.");
      const targetIds = Array.isArray(command.targetIds)
        ? command.targetIds.map(nonEmptyString)
        : undefined;
      if (targetIds?.some((targetId) => targetId === undefined)) {
        throw new TypeError("Spell targets must be explicit visible identifiers.");
      }
      return {
        kind: command.kind,
        spellId,
        ...(finiteNumber(command.slot) !== undefined ? { slot: command.slot } : {}),
        ...(targetIds ? { targetIds: targetIds as string[] } : {}),
        ...(nonEmptyString(command.choice) ? { choice: nonEmptyString(command.choice)! } : {}),
        ...(finiteNumber(command.destinationFeet) !== undefined
          ? { destinationFeet: command.destinationFeet }
          : {}),
        ...(finiteNumber(command.originFeet) !== undefined ? { originFeet: command.originFeet } : {}),
        ...(typeof command.ritual === "boolean" ? { ritual: command.ritual } : {}),
      };
    }
    case "useFeature": {
      const featureId = nonEmptyString(command.featureId);
      if (!featureId) throw new TypeError("A feature selection is required.");
      return { kind: command.kind, featureId };
    }
  }
}

function buttonIntentText(command: AuthoritativeButtonCommand): string {
  switch (command.kind) {
    case "joinCombat":
      return "我明确加入当前遭遇；先攻及其他随机结果由房间权威生成。";
    case "extraAttack":
      return `我使用战争祭司的附赠攻击，目标为 ${command.targetId}。`;
    case "endTurn":
      return "我明确结束自己当前的战斗回合。";
    case "leaveFight":
      return command.leaveKind === "disengage"
        ? "我明确采取撤离动作，并按规则处理随后移动。"
        : command.leaveKind === "flee"
          ? "我尝试从当前遭遇中逃离。"
          : command.leaveKind === "withdraw"
            ? "我尝试离开当前战场，但不投降。"
            : "我明确放下抵抗并投降。";
    case "resolveReact":
      return `我明确${command.use ? "使用" : "放弃"}这次反应。`;
    case "restNow": {
      const mode = command.mode === "group" ? "队伍" : "个人";
      const kind = command.restKind === "long" ? "长休" : "短休";
      const options = [
        command.hitDice === undefined ? undefined : `花费 ${command.hitDice} 枚生命骰`,
        command.arcaneRecoverySlotLevels === undefined
          || command.arcaneRecoverySlotLevels.length === 0
          ? undefined
          : `以奥术恢复取回 ${command.arcaneRecoverySlotLevels
              .map((level) => `${level} 环`)
              .join("、")}法术位`,
      ].filter((option): option is string => option !== undefined);
      return options.length
        ? `我进行${mode}${kind}，并选择在合法结算时${options.join("、")}。`
        : `我进行${mode}${kind}。`;
    }
    case "cancelRest":
      return "我中断自己的休整；若当前是休整表决，则我明确拒绝。";
    case "castSpell": {
      const details = [
        command.slot === undefined ? undefined : `使用 ${command.slot} 环法术位`,
        command.targetIds === undefined || command.targetIds.length === 0
          ? "尚未选择目标"
          : `明确目标为 ${command.targetIds.join("、")}`,
        command.choice === undefined ? undefined : `选择为 ${command.choice}`,
        command.destinationFeet === undefined ? undefined : `目标位置为 ${command.destinationFeet} 尺`,
        command.originFeet === undefined ? undefined : `区域中心为 ${command.originFeet} 尺`,
        command.ritual === undefined ? undefined : command.ritual ? "以仪式施法" : "不是仪式施法",
      ].filter((detail): detail is string => detail !== undefined);
      return `我施放法术 ${command.spellId}${details.length ? `，${details.join("；")}` : ""}。`;
    }
    case "useFeature":
      return `我使用特性 ${command.featureId}。`;
    case "useHitDie":
      return "我在当前合法的短休结算中选择花费一枚生命骰。";
  }
}

export function buildAuthoritativeButtonAction(input: {
  submissionId: string;
  command: AuthoritativeButtonCommand;
  pendingInputId?: string;
  [key: string]: unknown;
}) {
  const command = safeButtonCommand(input.command);
  const submissionId = nonEmptyString(input.submissionId);
  if (!submissionId) {
    throw new TypeError("Authoritative actions require trusted transport identity.");
  }
  if (!input.pendingInputId) {
    if (command.kind === "endTurn") {
      return {
        kind: "combatEndTurn" as const,
        submissionId,
      };
    }
    if (command.kind === "restNow") {
      return {
        kind: "restStart" as const,
        submissionId,
        restKind: command.restKind,
        mode: command.mode ?? "personal",
        hitDiceToSpend: command.hitDice ?? 0,
        arcaneRecoverySlotLevels: command.arcaneRecoverySlotLevels ?? [],
      };
    }
    if (command.kind === "cancelRest") {
      return {
        kind: "restInterrupt" as const,
        submissionId,
      };
    }
  }
  return buildAuthoritativeActionInput({
    submissionId,
    text: buttonIntentText(command),
    ...(input.pendingInputId
      ? { pendingInputId: input.pendingInputId, answer: command }
      : {}),
  });
}

/**
 * Convert the Room Authority's already viewer-filtered result into the narrow
 * legacy-shaped table snapshot consumed by the current UI.  This is an
 * allow-listing adapter: internal facts, entity records, delivery metadata and
 * narration history never cross this boundary.
 */
function safeProjectedActivities(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((activity) => {
        if (!isRecord(activity)) return [];
        const activityId = nonEmptyString(activity.activityId);
        const characterId = nonEmptyString(activity.characterId);
        const status = activity.status === "active"
          || activity.status === "completed"
          || activity.status === "interrupted"
          ? activity.status
          : undefined;
        const startedAtFictionMicros = nonEmptyString(activity.startedAtFictionMicros);
        const intendedDurationMicros = nonEmptyString(activity.intendedDurationMicros);
        const restKind = activity.restKind === "short" || activity.restKind === "long"
          ? activity.restKind
          : undefined;
        return activityId && characterId && status && startedAtFictionMicros && intendedDurationMicros
          ? [{
              activityId,
              characterId,
              status,
              startedAtFictionMicros,
              intendedDurationMicros,
              ...(activity.kind === "activity" ? { kind: "activity" as const,
                ...(typeof activity.progressFictionMicros === "string" ? { progressFictionMicros: activity.progressFictionMicros } : {}),
                ...(isRecord(activity.attention) && nonEmptyString(activity.attention.rootActionId)
                  && typeof activity.attention.atFictionMicros === "string" && Array.isArray(activity.attention.messages)
                  && activity.attention.messages.every(message => typeof message === "string") ? { attention: {
                    rootActionId: String(activity.attention.rootActionId), atFictionMicros: activity.attention.atFictionMicros,
                    messages: activity.attention.messages as string[],
                  } } : {}),
              } : {}),
              ...(activity.kind !== "timePassage" ? {} : {
                kind: "timePassage" as const,
                ...(typeof activity.progressFictionMicros === "string" && /^(0|[1-9][0-9]*)$/.test(activity.progressFictionMicros)
                  ? { progressFictionMicros: activity.progressFictionMicros } : {}),
                ...(["processing", "blocked", "cannotSafelyContinue"].includes(String(activity.processingState))
                  ? { processingState: activity.processingState as "processing" | "blocked" | "cannotSafelyContinue" } : {}),
                ...(typeof activity.endedAtFictionMicros === "string" && /^(0|[1-9][0-9]*)$/.test(activity.endedAtFictionMicros)
                  ? { endedAtFictionMicros: activity.endedAtFictionMicros } : {}),
                ...(typeof activity.interruptionReason === "string" && ["actorUnavailable", "actorIncapacitated", "encounterActive", "locationChanged",
                  "externalInterruption"].includes(activity.interruptionReason)
                  ? { interruptionReason: activity.interruptionReason } : {}),
              }),
              ...(restKind === undefined ? {} : { restKind }),
            }]
          : [];
      })
    : [];
}

export function projectAuthoritativeTableObservation(input: {
  userId: string;
  members: string[];
  locationLabels: Record<string, string>;
  observation: unknown;
}) {
  if (!input.members.includes(input.userId) || !isRecord(input.observation)) {
    throw new TypeError("Authoritative projection viewer is not a current room member.");
  }
  const readModel = input.observation.readModel;
  const narrationRecovery = viewerNarrationRecovery(
    input.observation.narrationRecovery,
  );
  const presentationHold = isRecord(input.observation.presentationHold)
    ? input.observation.presentationHold
    : undefined;
  const withheldKnowledgeRefs = new Set(
    Array.isArray(presentationHold?.knowledgeRefs)
      ? presentationHold.knowledgeRefs.filter(nonEmptyString)
      : [],
  );
  const safetyPresentation = isRecord(readModel)
    ? safeSafetyPresentation(readModel.safetyPresentation)
    : undefined;
  if (readModel === null && narrationRecovery !== undefined) {
    const transcriptMessages = experiencedTableMessages(
      input.observation.transcript,
      input.userId,
    );
    const delivery = isRecord(input.observation.delivery)
      ? input.observation.delivery
      : undefined;
    const frame = delivery?.kind === "current" && isRecord(delivery.frame)
      ? delivery.frame
      : undefined;
    const deliveryId = nonEmptyString(frame?.deliveryId);
    const deliveryText = nonEmptyString(frame?.text);
    const currentDeliveryMessage: ExperiencedTableMessage | undefined = deliveryId && deliveryText
      ? {
          id: deliveryId,
          user_id: null,
          kind: "narrate",
          name: "KP",
          body: deliveryText,
          created_at: "",
          clues: [],
          sceneIds: Array.isArray(frame?.sceneIds)
            ? [...new Set(frame.sceneIds
                .map(nonEmptyString)
                .filter((sceneId): sceneId is string => Boolean(sceneId)))]
            : [],
        }
      : undefined;
    const experienced = currentDeliveryMessage === undefined
      || transcriptMessages.some((message) => message.id === currentDeliveryMessage.id)
      ? transcriptMessages
      : [...transcriptMessages, currentDeliveryMessage];
    const publicMessage = ({ sceneIds: _sceneIds, ...message }: ExperiencedTableMessage) => message;
    return {
      stateVersion: undefined,
      projectionHash: undefined,
      controlledCharacter: null,
      activities: [],
      inCombat: false,
      pendingInputs: [],
      pendingRolls: [],
      receipts: [],
      clues: [],
      npcs: [],
      squads: [],
      squadInvite: null,
      places: {},
      placeNames: {},
      messages: experienced.map(publicMessage),
      locationThreads: [] as never[],
      logs: [] as never[],
      ...(deliveryId ? { currentDeliveryId: deliveryId } : {}),
      narrationRecovery,
    };
  }
  if (
    isRecord(readModel)
    && readModel.kind === "projected"
    && isRecord(readModel.viewer)
    && readModel.viewer.kind === "player"
    && readModel.viewer.principalId === input.userId
    && readModel.controlledCharacter === null
    && isRecord(readModel.lifecycle)
    && readModel.lifecycle.kind === "successorRequired"
  ) {
    const eligiblePredecessors = Array.isArray(readModel.lifecycle.eligiblePredecessors)
      ? readModel.lifecycle.eligiblePredecessors.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const characterId = nonEmptyString(entry.characterId);
          const name = nonEmptyString(entry.name);
          const tenureStatus = nonEmptyString(entry.tenureStatus);
          return characterId && name && tenureStatus
            ? [{ characterId, name, tenureStatus }]
            : [];
        })
      : [];
    const defaultPredecessorCharacterId = nonEmptyString(
      readModel.lifecycle.defaultPredecessorCharacterId,
    );
    if (eligiblePredecessors.length === 0 || defaultPredecessorCharacterId === undefined
      || !eligiblePredecessors.some((entry) =>
        entry.characterId === defaultPredecessorCharacterId)) {
      throw new TypeError("Authoritative lifecycle projection is incomplete.");
    }
    const delivery = isRecord(input.observation.delivery)
      ? input.observation.delivery
      : undefined;
    const frame = delivery?.kind === "current" && isRecord(delivery.frame)
      ? delivery.frame
      : undefined;
    const deliveryId = nonEmptyString(frame?.deliveryId);
    const deliveryText = nonEmptyString(frame?.text);
    return {
      stateVersion: nonEmptyString(readModel.stateVersion),
      projectionHash: nonEmptyString(readModel.projectionHash),
      controlledCharacter: null,
      ...(safetyPresentation === undefined ? {} : { safetyPresentation }),
      activities: safeProjectedActivities(readModel.activities),
      inCombat: false,
      lifecycle: {
        kind: "successorRequired" as const,
        defaultPredecessorCharacterId,
        eligiblePredecessors,
      },
      pendingInputs: [],
      pendingRolls: [],
      receipts: [],
      clues: [],
      npcs: [],
      squads: [],
      squadInvite: null,
      places: {},
      placeNames: {},
      messages: deliveryId && deliveryText
        ? [{
            id: deliveryId,
            user_id: null,
            kind: "narrate",
            name: "KP",
            body: deliveryText,
            created_at: "",
            clues: [] as Array<{ id: string; name: string; hint: string }>,
          }]
        : [],
      locationThreads: [] as never[],
      logs: [] as never[],
      ...(deliveryId ? { currentDeliveryId: deliveryId } : {}),
      ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
    };
  }
  const viewerCharacterId = isRecord(readModel) && isRecord(readModel.viewer)
    ? nonEmptyString(readModel.viewer.subjectId) ?? nonEmptyString(readModel.viewer.characterId)
    : undefined;
  if (
    !isRecord(readModel) ||
    readModel.kind !== "projected" ||
    !isRecord(readModel.viewer) ||
    readModel.viewer.kind !== "player" ||
    readModel.viewer.principalId !== input.userId ||
    !viewerCharacterId ||
    !isRecord(readModel.controlledCharacter) ||
    readModel.controlledCharacter.characterId !== viewerCharacterId
  ) {
    throw new TypeError("Authoritative projection does not belong to the trusted viewer.");
  }
  const projectedPendingPlayerRolls = pendingPlayerRolls(
    input.observation.pendingPlayerRolls,
    input.userId,
    viewerCharacterId,
  );

  const sceneId = nonEmptyString(readModel.controlledCharacter.sceneId);
  const tacticalProjection = readModel.tacticalProjection === undefined
    ? undefined
    : closedTacticalProjectionV1({
        value: readModel.tacticalProjection,
        viewerCharacterId,
        ...(sceneId === undefined ? {} : { sceneId }),
      });
  const characterName = nonEmptyString(readModel.controlledCharacter.name);
  const hitPoints = isRecord(readModel.controlledCharacter.hitPoints)
    ? {
        current: finiteNumber(readModel.controlledCharacter.hitPoints.current),
        maximum: finiteNumber(readModel.controlledCharacter.hitPoints.maximum),
      }
    : undefined;
  const safeHitPoints = hitPoints?.current !== undefined && hitPoints.maximum !== undefined
    ? { current: hitPoints.current, maximum: hitPoints.maximum }
    : undefined;
  const resources = isRecord(readModel.controlledCharacter.resources)
    ? Object.fromEntries(
        Object.entries(readModel.controlledCharacter.resources)
          .flatMap(([resourceId, value]) => {
            const count = finiteNumber(value);
            return count === undefined ? [] : [[resourceId, count] as const];
          }),
      )
    : undefined;
  const resourceMaximums = isRecord(readModel.controlledCharacter.resourceMaximums)
    ? Object.fromEntries(
        Object.entries(readModel.controlledCharacter.resourceMaximums)
          .flatMap(([resourceId, value]) => {
            const count = finiteNumber(value);
            return count === undefined ? [] : [[resourceId, count] as const];
          }),
      )
    : undefined;
  const classId = nonEmptyString(readModel.controlledCharacter.classId);
  const abilityScores = safeAbilityScores(readModel.controlledCharacter.abilityScores);
  const loadout = safeCharacterLoadout(readModel.controlledCharacter.loadout);
  const inventory = readModel.controlledCharacter.inventory === undefined
    ? undefined
    : safeInventory(readModel.controlledCharacter.inventory);
  if (readModel.controlledCharacter.inventory !== undefined && inventory === undefined) {
    throw new TypeError("Authoritative inventory projection is invalid.");
  }
  const level = finiteNumber(readModel.controlledCharacter.level);
  const experiencePoints = finiteNumber(readModel.controlledCharacter.experiencePoints);
  const restRecoveryOptions = safeRestRecoveryOptions(
    readModel.controlledCharacter.restRecoveryOptions,
  );
  const activities = safeProjectedActivities(readModel.activities);
  const inCombat = Array.isArray(readModel.encounters)
    && readModel.encounters.some((encounter) => isRecord(encounter)
      && encounter.status !== "concluded"
      && Array.isArray(encounter.participantEntityIds)
      && encounter.participantEntityIds.includes(viewerCharacterId));

  const fictionTime = isRecord(readModel.fictionTime)
    ? {
        branchId: nonEmptyString(readModel.fictionTime.branchId),
        nowMicros: nonEmptyString(readModel.fictionTime.nowMicros),
      }
    : undefined;
  const safeFictionTime = fictionTime?.branchId && fictionTime.nowMicros
    ? { branchId: fictionTime.branchId, nowMicros: fictionTime.nowMicros }
    : undefined;

  const clues = Array.isArray(readModel.knowledge)
    ? readModel.knowledge.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const id = nonEmptyString(entry.knowledgeRef);
        const objectKind = nonEmptyString(entry.objectKind);
        const content = publicKnowledgeText(entry.content);
        if (!id
          || withheldKnowledgeRefs.has(id)
          || !objectKind
          || !content.text
          || isOrdinarySocialTranscriptClaim(id, objectKind)) return [];
        const layer = entry.layer === "full" ? ("full" as const) : ("talk" as const);
        return [{
          id,
          name: content.name ?? id,
          text: content.text,
          hint: knowledgeHint(objectKind),
          layer,
        }];
      })
    : [];

  const pendingInputs = Array.isArray(readModel.pendingInputs)
    ? readModel.pendingInputs.flatMap<JsonRecord>((pending): JsonRecord[] => {
        if (!isRecord(pending)) return [];
        const pendingInputId = nonEmptyString(pending.pendingInputId);
        const rootActionId = nonEmptyString(pending.rootActionId);
        const question = nonEmptyString(pending.question);
        if (pending.kind === "combatChoice") {
          const combatChoice = safeCombatChoice(pending);
          return pendingInputId && rootActionId && question && combatChoice
            ? [{
                pendingInputId,
                kind: "combatChoice" as const,
                rootActionId,
                question,
                ...combatChoice,
              }]
            : [];
        }
        const kind = pending.kind === "clarification"
          || pending.kind === "playerChoice"
          || pending.kind === "advancementChoice"
          || pending.kind === "groupRestConsent"
          || pending.kind === "partyMoveConsent"
          || pending.kind === "socialResolution"
          ? pending.kind
          : undefined;
        const options = kind === "advancementChoice"
          ? safeAdvancementOptions(pending.options)
          : kind === "groupRestConsent"
            ? safeGroupRestOptions(pending.options)
            : kind === "socialResolution"
              ? safeSocialResolutionOptions(pending.options)
            : undefined;
        const choices = kind === "playerChoice"
          ? safePlayerChoices(pending.choices)
          : undefined;
        return pendingInputId && rootActionId && question && kind
          && (!["advancementChoice", "groupRestConsent", "socialResolution"].includes(kind)
            || options !== undefined)
          && (kind !== "playerChoice" || choices !== undefined)
          ? [{
              pendingInputId,
              kind,
              rootActionId,
              question,
              ...(options === undefined ? {} : { options }),
              ...(choices === undefined ? {} : { choices }),
            }]
          : [];
      })
    : [];

  const principalByCharacterId = new Map<string, string>();
  if (Array.isArray(readModel.roomMembers)) {
    for (const member of readModel.roomMembers) {
      if (!isRecord(member) || member.seatStatus !== "active") continue;
      const principalId = nonEmptyString(member.principalId);
      if (!principalId) continue;
      const characterIds = Array.isArray(member.characterIds)
        ? member.characterIds.map(nonEmptyString).filter((value): value is string => Boolean(value))
        : [];
      for (const characterId of characterIds) {
        principalByCharacterId.set(characterId, principalId);
      }
      // Legacy projector fixtures predate explicit CharacterControl mapping.
      if (characterIds.length === 0) principalByCharacterId.set(`character:${principalId}`, principalId);
    }
  }
  const squads = Array.isArray(readModel.partyGroups)
    ? readModel.partyGroups.flatMap((partyGroup) => {
        if (!isRecord(partyGroup) || !Array.isArray(partyGroup.memberCharacterIds)) return [];
        const id = nonEmptyString(partyGroup.groupId);
        const leaderCharacterId = nonEmptyString(partyGroup.leaderCharacterId);
        const rawMembers = partyGroup.memberCharacterIds.map(nonEmptyString);
        if (
          !id
          || !leaderCharacterId
          || !rawMembers.includes(viewerCharacterId)
        ) return [];
        const captain = principalByCharacterId.get(leaderCharacterId);
        const ids = rawMembers.flatMap((characterId) => {
          if (!characterId) return [];
          const principalId = principalByCharacterId.get(characterId);
          return principalId ? [principalId] : [];
        });
        return captain && ids.includes(input.userId)
          ? [{ id, ids: [...new Set(ids)], captain }]
          : [];
      })
    : [];

  const projectedPartyInvitation = Array.isArray(readModel.pendingInputs)
    ? readModel.pendingInputs.find((pending) =>
        isRecord(pending)
        && pending.kind === "partyInvitation"
        && (pending.access === "controller" || pending.access === "initiator")
      )
    : undefined;
  const inviterCharacterId = isRecord(projectedPartyInvitation)
    ? nonEmptyString(projectedPartyInvitation.inviterCharacterId)
    : undefined;
  const invitedCharacterId = isRecord(projectedPartyInvitation)
    ? nonEmptyString(projectedPartyInvitation.invitedCharacterId)
    : undefined;
  const inviterPrincipalId = inviterCharacterId
    ? principalByCharacterId.get(inviterCharacterId)
    : undefined;
  const invitedPrincipalId = invitedCharacterId
    ? principalByCharacterId.get(invitedCharacterId)
    : undefined;
  const inviterEntity = inviterCharacterId && isRecord(readModel.entities)
    ? readModel.entities[inviterCharacterId]
    : undefined;
  const inviterName = inviterCharacterId === viewerCharacterId
    ? characterName
    : isRecord(inviterEntity)
      ? nonEmptyString(inviterEntity.name)
      : undefined;
  const squadInvite = inviterPrincipalId && invitedPrincipalId
    ? {
        from: inviterPrincipalId,
        to: invitedPrincipalId,
        fromName: inviterName ?? "同伴",
      }
    : null;

  const receipts = Array.isArray(readModel.receipts)
    ? readModel.receipts.flatMap((receipt) => {
        if (!isRecord(receipt)) return [];
        const receiptId = nonEmptyString(receipt.receiptId);
        const rootActionId = nonEmptyString(receipt.rootActionId);
        const status = nonEmptyString(receipt.status);
        return receiptId && rootActionId && status
          ? [{ receiptId, rootActionId, status }]
          : [];
      })
    : [];

  const npcs = isRecord(readModel.entities) && sceneId
    ? Object.values(readModel.entities).flatMap((entity) => {
        if (!isRecord(entity) || entity.kind !== "npc" || entity.sceneId !== sceneId) return [];
        const id = nonEmptyString(entity.id);
        const name = nonEmptyString(entity.name);
        const intro =
          nonEmptyString(entity.intro) ??
          nonEmptyString(entity.publicText) ??
          nonEmptyString(entity.description);
        return id && name ? [{ id, name, intro: intro ?? "" }] : [];
      })
    : [];

  const delivery = isRecord(input.observation.delivery)
    ? input.observation.delivery
    : undefined;
  const frame = delivery?.kind === "current" && isRecord(delivery.frame)
    ? delivery.frame
    : undefined;
  const deliveryId = nonEmptyString(frame?.deliveryId);
  const deliveryText = nonEmptyString(frame?.text);
  const transcriptMessages = experiencedTableMessages(
    input.observation.transcript,
    input.userId,
  );
  const currentDeliverySceneIds = Array.isArray(frame?.sceneIds)
    ? [...new Set(frame.sceneIds.map(nonEmptyString).filter((id): id is string => Boolean(id)))]
    : sceneId ? [sceneId] : [];
  const currentDeliveryMessage: ExperiencedTableMessage | undefined = deliveryId && deliveryText
    ? {
        id: deliveryId,
        user_id: null,
        kind: "narrate",
        name: "KP",
        body: deliveryText,
        created_at: "",
        clues: [],
        sceneIds: currentDeliverySceneIds,
      }
    : undefined;
  const experienced = currentDeliveryMessage === undefined
    || transcriptMessages.some((message) => message.id === currentDeliveryMessage.id)
    ? transcriptMessages
    : [...transcriptMessages, currentDeliveryMessage];
  const publicMessage = ({ sceneIds: _sceneIds, ...message }: ExperiencedTableMessage) => message;
  const messages = sceneId === undefined
    ? experienced.map(publicMessage)
    : experienced
        .filter((message) => message.sceneIds.includes(sceneId))
        .map(publicMessage);
  const experiencedSceneIds = [...new Set(experienced.flatMap((message) => message.sceneIds))];
  const locationThreads = experiencedSceneIds
    .filter((experiencedSceneId) => experiencedSceneId !== sceneId)
    .map((experiencedSceneId) => ({
      placeId: experiencedSceneId,
      name: input.locationLabels[experiencedSceneId] ?? experiencedSceneId,
      messages: experienced
        .filter((message) => message.sceneIds.includes(experiencedSceneId))
        .map(publicMessage),
    }))
    .filter((thread) => thread.messages.length > 0);

  return {
    stateVersion: nonEmptyString(readModel.stateVersion),
    projectionHash: nonEmptyString(readModel.projectionHash),
    controlledCharacter: {
      characterId: viewerCharacterId,
      ...(characterName ? { name: characterName } : {}),
      ...(sceneId ? { sceneId } : {}),
      ...(classId ? { classId } : {}),
      ...(level !== undefined && Number.isSafeInteger(level) ? { level } : {}),
      ...(experiencePoints !== undefined
        && Number.isSafeInteger(experiencePoints)
        && experiencePoints >= 0
        ? { experiencePoints }
        : {}),
      ...(safeHitPoints ? { hitPoints: safeHitPoints } : {}),
      ...(resources ? { resources } : {}),
      ...(resourceMaximums ? { resourceMaximums } : {}),
      ...(abilityScores ? { abilityScores } : {}),
      ...(loadout ? { loadout } : {}),
      ...(inventory ? { inventory } : {}),
      ...(restRecoveryOptions ? { restRecoveryOptions } : {}),
    },
    ...(safetyPresentation === undefined ? {} : { safetyPresentation }),
    ...(tacticalProjection === undefined ? {} : { tacticalProjection }),
    visibleAssemblies: (Array.isArray(readModel.visibleAssemblies) ? readModel.visibleAssemblies : []).flatMap(value => {
      if (!isRecord(value) || value.state !== "active" || value.sceneRef !== sceneId) return [];
      const assemblyRef = nonEmptyString(value.assemblyRef), label = safeProjectedText(value.label, 500), description = safeProjectedText(value.description, 4000);
      return assemblyRef && label && description && sceneId ? [{ assemblyRef, label, description, sceneRef: sceneId, state: "active" as const }] : [];
    }),
    activities,
    inCombat,
    ...(safeFictionTime ? { fictionTime: safeFictionTime } : {}),
    pendingInputs,
    pendingRolls: projectedPendingPlayerRolls,
    receipts,
    clues,
    npcs,
    squads,
    squadInvite,
    places: sceneId ? { [input.userId]: sceneId } : {},
    placeNames: sceneId
      ? { [input.userId]: input.locationLabels[sceneId] ?? sceneId }
      : {},
    messages,
    locationThreads,
    logs: [] as never[],
    ...(deliveryId ? { currentDeliveryId: deliveryId } : {}),
    ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
  };
}

/**
 * The single authoritative-v2 state envelope consumed by fetchTable.
 * Legacy and unknown rulesets fail closed before any Viewer tactical payload
 * can enter their table shape.
 */
export function buildAuthoritativeTableState(input: {
  rulesetVersion: string;
  projected: ReturnType<typeof projectAuthoritativeTableObservation> | null;
}) {
  if (
    input.rulesetVersion !== AUTHORITATIVE_RULESET_VERSION
    || input.projected === null
  ) return null;
  const projected = input.projected;
  const safetyPresentation = "safetyPresentation" in projected
    ? projected.safetyPresentation
    : undefined;
  const lifecycle = "lifecycle" in projected ? projected.lifecycle : undefined;
  const tacticalProjection = "tacticalProjection" in projected
    ? projected.tacticalProjection
    : undefined;
  const narrationRecovery = "narrationRecovery" in projected
    ? projected.narrationRecovery
    : undefined;
  return {
    stateVersion: projected.stateVersion,
    projectionHash: projected.projectionHash,
    controlledCharacter: projected.controlledCharacter,
    activities: projected.activities,
    inCombat: projected.inCombat,
    visibleAssemblies: "visibleAssemblies" in projected ? projected.visibleAssemblies : [],
    ...(safetyPresentation === undefined ? {} : { safetyPresentation }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(tacticalProjection === undefined ? {} : { tacticalProjection }),
    ...(narrationRecovery === undefined ? {} : { narrationRecovery }),
  };
}
