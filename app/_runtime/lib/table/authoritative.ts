import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import {
  isTacticalProjection,
  type TacticalProjection,
} from "../rules/tactical-projection";

type JsonRecord = Record<string, unknown>;

export function publicAuthoritativeOutcomeError(outcome: {
  kind: string;
  code?: unknown;
}): string {
  if (outcome.kind === "needsKp") {
    return "KP 需要重新裁定这项行动，请稍后用同一行动重试";
  }
  if (outcome.code === "modelTransient") {
    return "KP 模型暂时不可用或响应超时，行动未提交；可用同一行动重试";
  }
  if (outcome.code === "quotaExhausted") {
    return "KP 模型额度暂不可用，行动未提交；请在额度恢复后用同一行动重试";
  }
  if (outcome.code === "authorityTransient") {
    return "房间权威暂时不可用，行动未提交；可用同一行动重试";
  }
  return "这项行动暂时没有提交，请稍后重试";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type ExperiencedTableMessage = {
  id: string;
  user_id: string | null;
  kind: "say" | "narrate";
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
        : undefined;
    const sceneIds = Array.isArray(entry.sceneIds)
      ? [...new Set(entry.sceneIds.map(nonEmptyString).filter((sceneId): sceneId is string => Boolean(sceneId)))]
      : [];
    if (!id || !body || !name || !speakerKind || sceneIds.length === 0 || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      user_id: speakerKind === "player" ? trustedUserId : null,
      kind: speakerKind === "player" ? ("say" as const) : ("narrate" as const),
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

export function buildAuthoritativeRoomSeeds(input: {
  members: Array<{ userId: string; nickname: string; isHost: boolean }>;
  lockedCharacters: Array<{ userId: string; sheet: unknown }>;
  openingSceneId: string;
  characterIdFor(userId: string): string;
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
    const name = typeof character.sheet.name === "string"
      ? character.sheet.name.trim()
      : "";
    if (!name) throw new TypeError("Every locked character must have a name.");
    return {
      characterId: input.characterIdFor(character.userId),
      controllerPrincipalId: character.userId,
      staticCard: {
        ...structuredClone(character.sheet),
        name,
        sceneId: input.openingSceneId,
      },
    };
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
      if (command.restKind === "long" && arcaneRecoverySlotLevels?.length) {
        throw new TypeError("Arcane Recovery choices are available only during a short rest.");
      }
      return {
        kind: command.kind,
        restKind: command.restKind,
        ...(command.mode === "personal" || command.mode === "group"
          ? { mode: command.mode }
          : {}),
        ...(finiteNumber(command.hitDice) !== undefined
          ? { hitDice: Math.max(0, Math.floor(command.hitDice!)) }
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
  return buildAuthoritativeActionInput({
    submissionId: input.submissionId,
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
  const safetyPresentation = isRecord(readModel)
    ? safeSafetyPresentation(readModel.safetyPresentation)
    : undefined;
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
      activities: [],
      inCombat: false,
      lifecycle: {
        kind: "successorRequired" as const,
        defaultPredecessorCharacterId,
        eligiblePredecessors,
      },
      pendingInputs: [],
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
  const level = finiteNumber(readModel.controlledCharacter.level);
  const experiencePoints = finiteNumber(readModel.controlledCharacter.experiencePoints);
  const restRecoveryOptions = safeRestRecoveryOptions(
    readModel.controlledCharacter.restRecoveryOptions,
  );
  const activities = Array.isArray(readModel.activities)
    ? readModel.activities.flatMap((activity) => {
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
              ...(restKind === undefined ? {} : { restKind }),
            }]
          : [];
      })
    : [];
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
        if (!id || !objectKind || !content.text) return [];
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
          ? pending.kind
          : undefined;
        const options = kind === "advancementChoice"
          ? safeAdvancementOptions(pending.options)
          : kind === "groupRestConsent"
            ? safeGroupRestOptions(pending.options)
            : undefined;
        const choices = kind === "playerChoice"
          ? safePlayerChoices(pending.choices)
          : undefined;
        return pendingInputId && rootActionId && question && kind
          && (!["advancementChoice", "groupRestConsent"].includes(kind) || options !== undefined)
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
      ...(restRecoveryOptions ? { restRecoveryOptions } : {}),
    },
    ...(safetyPresentation === undefined ? {} : { safetyPresentation }),
    ...(tacticalProjection === undefined ? {} : { tacticalProjection }),
    activities,
    inCombat,
    ...(safeFictionTime ? { fictionTime: safeFictionTime } : {}),
    pendingInputs,
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
  return {
    stateVersion: projected.stateVersion,
    projectionHash: projected.projectionHash,
    controlledCharacter: projected.controlledCharacter,
    activities: projected.activities,
    inCombat: projected.inCombat,
    ...(safetyPresentation === undefined ? {} : { safetyPresentation }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(tacticalProjection === undefined ? {} : { tacticalProjection }),
  };
}
