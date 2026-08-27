import { createHash, randomBytes, randomUUID } from "node:crypto";

export const LIVE_KP_EVAL_PRODUCTION_ORIGIN = "https://zhuwei.yinskyriver.workers.dev";
export const LIVE_KP_EVAL_RULESET = "dnd5e-2014-srd5.1-authoritative-v2";
export const LIVE_KP_EVAL_MODEL = "@cf/zai-org/glm-4.7-flash";
export const LIVE_KP_EVAL_REPORT_SCHEMA = "zhuwei-live-workers-ai-kp-eval-report-v1";

export const LIVE_KP_EVAL_THRESHOLDS = Object.freeze({
  minimumInteractions: 24,
  minimumDimension: 1,
  minimumTotal: 18,
  maximumSpotlightDifference: 3,
});

const ALLOWED_GAME_COMMANDS = new Set([
  "getRoomManagement",
  "sendAction",
  "fetchTable",
  "acknowledgeDelivery",
]);

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "worldState",
  "rawEvents",
  "events",
  "eventLog",
  "statePatch",
  "mechanicOps",
  "dieFaces",
  "faces",
  "prompt",
  "kpProjection",
  "publishCapability",
]);

const FORBIDDEN_AUTHORITY_INPUT_KEYS = new Set([
  "actorId",
  "principalId",
  "profiles",
  "profileId",
  "profileHash",
  "events",
  "eventLog",
  "worldState",
  "state",
  "statePatch",
  "faces",
  "dieFaces",
  "randomnessResults",
]);

const LEGACY_ACTIVE_STATE_KEYS = new Set([
  "gameState",
  "gameStates",
  "game_states",
  "legacyActiveState",
  "legacyCombat",
  "legacyPendingInputs",
  "npc_flags",
  "npcFlags",
]);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const FORBIDDEN_HISTORY_KEYS = new Set([
  "narrationHistory",
  "messageHistory",
  "voiceHistory",
  "transcriptHistory",
]);

const FAKE_CONCLUSION_PATTERN = /故事(?:已经|已)结束|进入尾声|当前冲突已经真实收束/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Evaluation target must be a credential-free origin.");
  }
  return url.origin;
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return String(value);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

function deepContains(value, needle) {
  return needle.length > 0 && canonicalJson(value).includes(needle);
}

function deepKeys(value, targets, hits = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) deepKeys(entry, targets, hits);
    return hits;
  }
  if (!isRecord(value)) return hits;
  for (const [key, nested] of Object.entries(value)) {
    if (targets.has(key)) hits.add(key);
    deepKeys(nested, targets, hits);
  }
  return hits;
}

function collectStringsAtKeys(value, keys, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectStringsAtKeys(entry, keys, output);
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key) && typeof nested === "string" && nested.trim()) output.push(nested);
    collectStringsAtKeys(nested, keys, output);
  }
  return output;
}

function outcomeOf(response) {
  return isRecord(response?.outcome) ? response.outcome : undefined;
}

function receiptOf(response) {
  const outcome = outcomeOf(response);
  return isRecord(outcome?.receipt) ? outcome.receipt : undefined;
}

function outcomeKind(response) {
  const outcome = outcomeOf(response);
  if (typeof outcome?.kind === "string") return outcome.kind;
  if (typeof response?.outcomeKind === "string") return response.outcomeKind;
  return response?.ok === false ? "rejected" : "unknown";
}

function pendingIdFrom(value) {
  if (isRecord(value)) {
    if (typeof value.pendingInputId === "string" && value.pendingInputId) {
      return value.pendingInputId;
    }
    if (Array.isArray(value.pendingInputs)) {
      for (const pending of value.pendingInputs) {
        const found = pendingIdFrom(pending);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value)) {
      const found = pendingIdFrom(nested);
      if (found) return found;
    }
  } else if (Array.isArray(value)) {
    for (const nested of value) {
      const found = pendingIdFrom(nested);
      if (found) return found;
    }
  }
  return undefined;
}

function currentDeliveryIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) currentDeliveryIds(entry, output);
    return output;
  }
  if (!isRecord(value)) return output;
  if (typeof value.currentDeliveryId === "string" && value.currentDeliveryId) {
    output.add(value.currentDeliveryId);
  }
  if (
    value.kind === "current"
    && isRecord(value.frame)
    && typeof value.frame.deliveryId === "string"
  ) {
    output.add(value.frame.deliveryId);
  }
  for (const nested of Object.values(value)) currentDeliveryIds(nested, output);
  return output;
}

function eventRange(receipt) {
  if (!isRecord(receipt?.eventRange)) return undefined;
  const range = receipt.eventRange;
  const from = Number(range.from ?? range.first ?? range.fromEventSeq);
  const to = Number(range.to ?? range.last ?? range.toEventSeq);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return undefined;
  return { from, to };
}

function canonicalSequence(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function ownActiveCard(table) {
  if (!isRecord(table) || !isRecord(table.me) || !Array.isArray(table.characters)) return undefined;
  const own = table.characters.find((entry) =>
    isRecord(entry) && entry.userId === table.me.userId && isRecord(entry.sheet));
  if (!isRecord(own) || !isRecord(own.sheet)) return undefined;
  const sheet = own.sheet;
  return {
    hp: isRecord(sheet.hp)
      ? { current: sheet.hp.current, maximum: sheet.hp.max ?? sheet.hp.maximum }
      : undefined,
    inspiration: sheet.inspiration,
    resources: isRecord(sheet.resources) ? sheet.resources : undefined,
    armorClass: sheet.ac,
    speedFeet: sheet.speed,
    equipped: isRecord(sheet.equipped) ? sheet.equipped : undefined,
    backpack: Array.isArray(sheet.backpack)
      ? sheet.backpack.map((entry) => isRecord(entry)
        ? { itemId: entry.itemId, quantity: entry.qty ?? entry.quantity }
        : entry)
      : undefined,
  };
}

function activeCardResource(card, resourceId) {
  if (resourceId === "inspiration" && typeof card.inspiration === "boolean") {
    return card.inspiration ? 1 : 0;
  }
  const value = isRecord(card.resources) ? card.resources[resourceId] : undefined;
  if (Number.isFinite(value)) return Number(value);
  if (isRecord(value) && Number.isFinite(value.max) && Number.isFinite(value.used)) {
    return Number(value.max) - Number(value.used);
  }
  return undefined;
}

function activeCardMatchesProjection(card, controlledCharacter) {
  if (!isRecord(card) || !isRecord(controlledCharacter)) return false;
  if (isRecord(controlledCharacter.hitPoints)
    && canonicalJson(card.hp) !== canonicalJson(controlledCharacter.hitPoints)) return false;
  if (isRecord(controlledCharacter.resources)) {
    for (const [resourceId, current] of Object.entries(controlledCharacter.resources)) {
      if (!Number.isFinite(current) || activeCardResource(card, resourceId) !== Number(current)) {
        return false;
      }
    }
  }
  if (isRecord(controlledCharacter.loadout)) {
    const expected = {
      armorClass: controlledCharacter.loadout.armorClass,
      speedFeet: controlledCharacter.loadout.speedFeet,
      equipped: controlledCharacter.loadout.equipped,
      backpack: controlledCharacter.loadout.backpack,
    };
    const actual = {
      armorClass: card.armorClass,
      speedFeet: card.speedFeet,
      equipped: card.equipped,
      backpack: card.backpack,
    };
    if (canonicalJson(actual) !== canonicalJson(expected)) return false;
  }
  return true;
}

function tableAuthoritySnapshot(table) {
  if (!isRecord(table) || !isRecord(table.state) || !isRecord(table.state.authoritative)) {
    return undefined;
  }
  const authority = table.state.authoritative;
  const stateVersion = canonicalSequence(authority.stateVersion);
  if (stateVersion === undefined || typeof authority.projectionHash !== "string") return undefined;
  const card = ownActiveCard(table);
  const activeView = {
    controlledCharacter: authority.controlledCharacter,
    activities: authority.activities,
    inCombat: authority.inCombat,
    lifecycle: authority.lifecycle,
    sceneId: table.state.sceneId,
    places: table.state.places,
    fictionTime: table.state.fictionTime,
    pendingInputs: table.state.pendingInputs,
    clues: table.state.clues,
    npcs: table.state.npcs,
    receipts: table.state.receipts,
    ownActiveCard: card,
  };
  return {
    stateVersion,
    projectionHash: authority.projectionHash,
    activeViewHash: sha256(canonicalJson(activeView)),
    activeCardMatchesProjection: activeCardMatchesProjection(card, authority.controlledCharacter),
    receipts: Array.isArray(table.state.receipts) ? table.state.receipts.filter(isRecord) : [],
  };
}

function projectedReceiptContains(snapshot, receipt) {
  return snapshot.receipts.some((candidate) =>
    candidate.receiptId === receipt.receiptId
    && candidate.rootActionId === receipt.rootActionId
    && candidate.status === receipt.status);
}

export function assessPublicSingleAuthority(trace, initialTables) {
  const signals = new Set();
  let previous = {
    host: tableAuthoritySnapshot(initialTables?.host),
    player: tableAuthoritySnapshot(initialTables?.player),
  };
  let mutationCount = 0;
  let receiptCoveredMutationCount = 0;
  let projectionChecks = 0;
  let activeCardChecks = 0;

  for (const actor of ["host", "player"]) {
    const snapshot = previous[actor];
    if (snapshot === undefined) signals.add("missingAuthoritativeProjection");
    else {
      projectionChecks += 1;
      if (!SHA256_PATTERN.test(snapshot.projectionHash)) signals.add("invalidProjectionHash");
      activeCardChecks += 1;
      if (!snapshot.activeCardMatchesProjection) signals.add("activeCardDivergedFromProjection");
    }
  }

  for (const entry of trace) {
    if (entry.authorityInputKeys.size > 0) signals.add("authorityOwnedPlayerInput");
    if (entry.forbiddenResponseKeys.size > 0) signals.add("authorityPayloadInPublicResponse");
    if (entry.legacyActiveStateKeys.size > 0) signals.add("legacyActiveStatePayload");

    const current = {
      host: tableAuthoritySnapshot(entry.hostTable),
      player: tableAuthoritySnapshot(entry.playerTable),
    };
    for (const actor of ["host", "player"]) {
      const before = previous[actor];
      const after = current[actor];
      if (before === undefined || after === undefined) {
        signals.add("missingAuthoritativeProjection");
        continue;
      }
      projectionChecks += 1;
      if (!SHA256_PATTERN.test(after.projectionHash)) signals.add("invalidProjectionHash");
      activeCardChecks += 1;
      if (!after.activeCardMatchesProjection) signals.add("activeCardDivergedFromProjection");
      if (after.stateVersion < before.stateVersion) signals.add("authoritativeVersionRegressed");
      if (
        after.stateVersion === before.stateVersion
        && (after.projectionHash !== before.projectionHash
          || after.activeViewHash !== before.activeViewHash)
      ) signals.add("activeProjectionChangedWithoutEvent");
    }
    if (
      current.host !== undefined
      && current.player !== undefined
      && current.host.stateVersion !== current.player.stateVersion
    ) signals.add("viewerVersionDisagreement");

    const beforeVersion = previous.host?.stateVersion;
    const afterVersion = current.host?.stateVersion;
    if (beforeVersion !== undefined && afterVersion !== undefined && afterVersion > beforeVersion) {
      mutationCount += 1;
      const receipt = receiptOf(entry.response);
      const range = eventRange(receipt);
      const receiptCanonical = isRecord(receipt)
        && typeof receipt.receiptId === "string"
        && receipt.receiptId.length > 0
        && typeof receipt.rootActionId === "string"
        && receipt.rootActionId.length > 0
        && typeof receipt.status === "string"
        && isRecord(receipt.scopeVersions)
        && Object.values(receipt.scopeVersions).every((value) => canonicalSequence(value) !== undefined);
      if (!receiptCanonical || range === undefined) {
        signals.add("versionAdvancedWithoutDoReceipt");
      } else if (
        range.to !== afterVersion
        || range.to <= beforeVersion
        || range.from !== beforeVersion + 1
        || range.from > range.to
      ) {
        signals.add("receiptDoesNotCoverMutation");
      } else if (!projectedReceiptContains(current[entry.step.actor], receipt)) {
        signals.add("receiptMissingFromActorProjection");
      } else {
        receiptCoveredMutationCount += 1;
      }
    }
    previous = current;
  }

  return {
    secondAuthority: signals.size > 0,
    signals: [...signals].sort(),
    mutationCount,
    receiptCoveredMutationCount,
    projectionChecks,
    activeCardChecks,
  };
}

function randomnessCommitments(receipt) {
  return Array.isArray(receipt?.randomnessCommitments)
    ? receipt.randomnessCommitments.filter(isRecord)
    : [];
}

function ledgerDifference(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = ledgerDifference(entry);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (isRecord(value.spotlightLedger)) {
    const beats = Object.values(value.spotlightLedger)
      .filter(isRecord)
      .map((entry) => Number(entry.decisionBeats))
      .filter(Number.isFinite);
    if (beats.length >= 2) return Math.max(...beats) - Math.min(...beats);
  }
  for (const nested of Object.values(value)) {
    const result = ledgerDifference(nested);
    if (result !== undefined) return result;
  }
  return undefined;
}

function storyConcluded(value) {
  if (Array.isArray(value)) return value.some(storyConcluded);
  if (!isRecord(value)) return false;
  if (value.status === "concluded" && ("endingCandidateRef" in value || "epilogue" in value)) {
    return true;
  }
  return Object.values(value).some(storyConcluded);
}

function publicErrorCode(value) {
  if (!isRecord(value)) return undefined;
  if (typeof value.outcomeKind === "string") return value.outcomeKind;
  if (typeof value.code === "string") return value.code;
  if (isRecord(value.outcome) && typeof value.outcome.code === "string") return value.outcome.code;
  return undefined;
}

function score(full, partial) {
  return full ? 2 : partial ? 1 : 0;
}

function stableSubmission(runId, step) {
  const tags = step.tags.join(",");
  return `live-kp-eval:${sha256(runId).slice(7, 19)}:${step.id}:tag=${tags}`;
}

function intent(id, actor, text, tags = []) {
  return { id, actor, kind: "intent", text, tags, countsAsInteraction: true };
}

export function buildLiveKpScenario(input = {}) {
  const runId = input.runId || randomUUID();
  const secretCanary = input.secretCanary || `ZEVAL-${randomBytes(8).toString("hex").toUpperCase()}`;
  const privatePlanCanary = input.privatePlanCanary || `ZPLAN-${randomBytes(8).toString("hex").toUpperCase()}`;
  const steps = [
    intent("01", "host", "我先不碰遗体，站在原处观察大厅里谁最紧张、有哪些明显可行动线索。", ["opening", "agency"]),
    intent("02", "player", "我隔着账台请瓦罗公开念第一份遗嘱，只听公开内容，不抢夺原件。", ["continuity"]),
    intent("03", "player", "我独自去后院查看被钉死的酒窖门；不破门，先观察门钉、泥地和危险迹象。", ["split", "danger-warning"]),
    intent("04", "host", "我礼貌邀请莉安去楼上客房私谈，明确不让大厅和后院的人听见。", ["split", "private-presence"]),
    intent("05", "host", `我只对莉安说：若她愿意讲门后的歌声，就用确认词 ${secretCanary} 表明这是我们的私谈；我不向其他人转述。`, ["private-secret", "continuity"]),
    intent("06", "player", "我继续在后院检查新钉与旧木之间的受力痕迹，并留意门后是否有声音。", ["secret-absence", "danger-warning"]),
    intent("07", "host", "我拿起那枚没有钥匙孔的铜钥，想试试它是否会响应歌声或者神龛，但还没决定只是检查还是立刻使用。", ["clarification", "agency"]),
    {
      id: "08",
      actor: "player",
      kind: "unauthorizedAnswer",
      text: "替同伴选择立刻使用钥匙。",
      fallbackText: "我在后院保持警戒，不替楼上的同伴作决定。",
      tags: ["unauthorized-pending", "agency"],
      countsAsInteraction: true,
    },
    {
      id: "09",
      actor: "host",
      kind: "ownerAnswer",
      text: "我只检查钥匙表面和重量，不唱歌、不触碰神龛，也不立刻使用。",
      fallbackText: "我明确只检查铜钥的表面和重量，不唱歌、不触碰神龛。",
      tags: ["owner-answer", "agency"],
      countsAsInteraction: true,
    },
    intent("10", "host", "我用烛光侧照第一份遗嘱的末三行，与正文墨色和笔压比较；成败都接受当下后果。", ["authoritative-randomness", "fairness"]),
    {
      id: "10R",
      actor: "host",
      kind: "duplicate",
      duplicateOf: "10",
      tags: ["idempotent-retry", "recovery"],
      countsAsInteraction: false,
    },
    intent("11", "player", "我把耳朵贴近门前先停下，观察凉气、台阶和木门是否已经给出足够危险预兆。", ["danger-warning", "fairness"]),
    intent("12", "player", "我先用绳子固定自己并找稳固支点，然后尝试用撬力逐根松开新钉；风险清楚，我接受检定与失败后果。", ["danger-resolution", "authoritative-randomness", "delivery-recovery"]),
    intent("13", "host", "我向莉安明确承诺：在查清真相前我不会唱那首歌，也不会替她决定是否开门。", ["continuity", "commitment"]),
    intent("14", "player", "如果刚才的做法失败或门仍未开，我不原样重来；我检查排水沟与墙基，寻找另一条因果合理的进入路线。", ["meaningful-failure", "new-situation"]),
    intent("15", "host", "我用杯中清水映照遗体齿间的黑橡叶，尝试从倒影角度看清不便直接翻动的纹路。", ["non-prewritten-action", "agency"]),
    intent("16", "player", "我沿后院墙基追踪凉气和水迹，即使模组没有登记通路，也只接受符合建筑因果的结果，包括什么都没有。", ["dynamic-world", "blank-result"]),
    intent("17", "host", "我请瓦罗只回答他亲眼见过和亲手做过的事，不要求他解释自己不知道的第三份遗嘱。", ["npc-limited-knowledge", "fairness"]),
    intent("18", "player", `我独自在后院把计划 ${privatePlanCanary} 写在自己掌心并藏进手套，不告诉大厅或楼上的任何人。`, ["private-plan", "npc-limited-knowledge"]),
    intent("19", "host", "我回到大厅询问奈斯为何熟悉黑橡印章；他只能依据自己知道或感知的事实回应。", ["npc-limited-knowledge", "secret-absence"]),
    intent("20", "player", "我离开后院回到大厅与同伴会合，但不自动知道她在私谈中得到的内容。", ["regroup", "continuity"]),
    intent("21", "host", `我在世界内把刚才私谈中约定的确认词 ${secretCanary} 准确告诉当前在场的同伴；只分享这项内容和来源，不转发旧旁白。`, ["share-secret", "continuity"]),
    intent("22", "player", `我复述同伴刚分享的确认词 ${secretCanary}，并把它只当作她与莉安谈过的来源主张，继续寻找独立证据。`, ["use-shared-secret", "continuity"]),
    intent("23", "player", "我一时没有把握下一步，请 KP 只根据已经固化的处境、线索和逼近事件重新定向，不替我选择。", ["stall-reorientation", "agency"]),
    intent("24", "host", "我开始一项耗时活动：在不触发歌声的前提下准备木楔、绳索和灭火用水；效果只能在虚构时间完成后落地。", ["activity", "fiction-time"]),
    intent("25", "player", "我明确帮助同伴完成准备工作，愿意花费相应虚构时间，但不替她决定如何使用准备结果。", ["activity", "spotlight"]),
    intent("26", "host", "结合目前取得的证据，我寻找第三份遗嘱的合理藏处；若仍缺前提，请明确说明，不要把未发现写成发现。", ["dynamic-world", "meaningful-failure"]),
    intent("27", "player", "若已经取得足够证据，我当面要求奈斯停止开启神龛并离开；若不足，就让他的真实立场形成新的局面。", ["npc-action", "resolution"]),
    intent("28", "host", "我依据已经固化的第三份遗嘱和现场条件，选择毁掉石座；若当前做不到，就选择重新钉死酒窖门并承担后果。", ["resolution", "player-choice"]),
    intent("29", "player", "我只为自己的角色决定：在核心威胁确已停止时接受当前结果；若尚未停止，我继续面对真实未决冲突。", ["player-choice", "conclusion-candidate"]),
    intent("30", "host", "如果核心冲突已经真实解决、不可逆失败或被我们明确放弃，请展示长期后果并结束当前故事；不要追加幕后黑手延长内容。", ["conclusion", "true-ending"]),
    intent("31", "player", "若当前故事已经权威收束，我选择一个简短个人尾声；这不是自动开启续篇。", ["epilogue", "continuity"]),
  ];

  return steps.map((step) => ({
    ...step,
    submissionId: step.kind === "duplicate" ? undefined : stableSubmission(runId, step),
  }));
}

class SafeEvaluationHttpError extends Error {
  constructor(command, status, code = "httpFailure") {
    super(`Evaluation command ${command} failed with HTTP ${status} (${code}).`);
    this.name = "SafeEvaluationHttpError";
    this.command = command;
    this.status = status;
    this.code = code;
  }
}

function apiClient(baseUrl, cookie, fetchImpl, timeoutMs) {
  return {
    async command(command, data) {
      if (!ALLOWED_GAME_COMMANDS.has(command)) {
        throw new TypeError(`Evaluation command is outside the public Room Action adapter: ${command}`);
      }
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(new URL("/api/game", baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({ command, data }),
          redirect: "error",
          signal: abortController.signal,
        });
      } catch (error) {
        throw new SafeEvaluationHttpError(command, 0, error?.name === "AbortError" ? "timeout" : "network");
      } finally {
        clearTimeout(timer);
      }
      let parsed;
      try {
        parsed = await response.json();
      } catch {
        throw new SafeEvaluationHttpError(command, response.status, "invalidJson");
      }
      if (!response.ok) {
        throw new SafeEvaluationHttpError(command, response.status, publicErrorCode(parsed));
      }
      return parsed;
    },
  };
}

function profileFromManagement(value) {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.room)) return undefined;
  return {
    rulesetVersion: value.room.ruleset_version,
    modelId: value.room.kp_model,
    status: value.room.status,
  };
}

function tableDeliverySummary(table) {
  const bodies = collectStringsAtKeys(table, new Set(["body"]));
  const ids = [...currentDeliveryIds(table)];
  return { bodies, ids };
}

async function acknowledgeCurrent(client, roomCode, table, response) {
  const ids = new Set([
    ...currentDeliveryIds(table),
    ...currentDeliveryIds(response),
  ]);
  let verified = ids.size === 0;
  for (const deliveryId of ids) {
    const beforeBodies = [
      ...tableDeliverySummary(table).bodies,
      ...collectStringsAtKeys(response, new Set(["body"])),
    ];
    const ack = await client.command("acknowledgeDelivery", { code: roomCode, deliveryId });
    if (ack?.ok !== true) continue;
    const after = await client.command("fetchTable", roomCode);
    const afterSerialized = canonicalJson(after);
    const erased = !currentDeliveryIds(after).has(deliveryId)
      && beforeBodies.every((body) => !afterSerialized.includes(body));
    verified = verified || erased;
  }
  return verified;
}

function summarizedCommitments(receipt) {
  return randomnessCommitments(receipt).map((entry) => ({
    randomnessIdHash: sha256(entry.randomnessId ?? "missing"),
    requestHash: typeof entry.requestHash === "string" ? entry.requestHash : undefined,
    frozenParametersHash:
      typeof entry.frozenParametersHash === "string" ? entry.frozenParametersHash : undefined,
  }));
}

async function evidenceRow(trace) {
  const receipt = receiptOf(trace.response);
  const actorBodies = collectStringsAtKeys(trace.actorView, new Set(["body", "text"]));
  const otherBodies = collectStringsAtKeys(trace.otherView, new Set(["body", "text"]));
  return {
    stepId: trace.step.id,
    actor: trace.step.actor,
    actionKind: trace.step.kind,
    tags: [...trace.step.tags],
    countsAsInteraction: trace.step.countsAsInteraction,
    submissionIdHash: sha256(trace.submissionId),
    responseOk: trace.response?.ok === true,
    outcomeKind: outcomeKind(trace.response),
    publicErrorCode: publicErrorCode(trace.response),
    receipt: receipt
      ? {
          receiptIdHash: sha256(receipt.receiptId ?? "missing"),
          rootActionIdHash: sha256(receipt.rootActionId ?? "missing"),
          status: receipt.status,
          eventRange: eventRange(receipt),
          meaningfulFailure: receipt.meaningfulFailure === true,
          newOptionCount: Array.isArray(receipt.newOptions) ? receipt.newOptions.length : 0,
          randomnessCommitments: summarizedCommitments(receipt),
        }
      : undefined,
    projections: {
      actorHash: sha256(canonicalJson(trace.actorView)),
      otherHash: sha256(canonicalJson(trace.otherView)),
    },
    deliveries: {
      actorCount: actorBodies.length,
      actorBodyHashes: actorBodies.map(sha256),
      actorBodyLengths: actorBodies.map((body) => body.length),
      otherCount: otherBodies.length,
      otherBodyHashes: otherBodies.map(sha256),
      otherBodyLengths: otherBodies.map((body) => body.length),
      repeatedReadStable: trace.repeatedReadStable,
      acknowledgedBodyErased: trace.ackErased,
    },
    forbiddenResponseKeys: [...trace.forbiddenResponseKeys].sort(),
    authorityInputKeys: [...trace.authorityInputKeys].sort(),
    legacyActiveStateKeys: [...trace.legacyActiveStateKeys].sort(),
  };
}

function tagged(trace, tag) {
  return trace.find((entry) => entry.step.tags.includes(tag));
}

function taggedAll(trace, tag) {
  return trace.filter((entry) => entry.step.tags.includes(tag));
}

function matchingReceipt(left, right) {
  const leftReceipt = receiptOf(left?.response);
  const rightReceipt = receiptOf(right?.response);
  return leftReceipt !== undefined
    && rightReceipt !== undefined
    && canonicalJson(leftReceipt) === canonicalJson(rightReceipt);
}

function scoreTrace(trace, context) {
  const privateSecret = tagged(trace, "private-secret");
  const shareSecret = tagged(trace, "share-secret");
  const privatePlan = tagged(trace, "private-plan");
  const preShare = trace.slice(0, Math.max(0, trace.indexOf(shareSecret)));
  const postShare = shareSecret ? trace.slice(trace.indexOf(shareSecret)) : [];
  const afterPrivatePlan = privatePlan ? trace.slice(trace.indexOf(privatePlan)) : [];
  const secretAcquired = privateSecret
    ? deepContains(privateSecret.hostView, context.secretCanary)
    : false;
  const unauthorizedSecretLeak = preShare.some((entry) =>
    deepContains(entry.playerView, context.secretCanary));
  const privatePlanLeak = afterPrivatePlan.some((entry) =>
    deepContains(entry.hostView, context.privatePlanCanary));
  const sharedSecretReceived = postShare.some((entry) =>
    deepContains(entry.playerView, context.secretCanary));
  const sharedSecretPersisted = postShare.slice(1).some((entry) =>
    deepContains(entry.playerView, context.secretCanary));
  const hostSecretPersisted = privateSecret
    ? trace.slice(trace.indexOf(privateSecret) + 2).some((entry) =>
        deepContains(entry.hostView, context.secretCanary))
    : false;

  const revisions = trace.flatMap((entry) => {
    const strings = collectStringsAtKeys(
      { actor: entry.actorView, other: entry.otherView },
      new Set(["worldRevision"]),
    );
    return strings.map(Number).filter(Number.isSafeInteger);
  });
  const revisionsMonotonic = revisions.every((revision, index) =>
    index === 0 || revision >= revisions[index - 1]);

  const warning = tagged(trace, "danger-warning");
  const danger = tagged(trace, "danger-resolution");
  const warningRange = eventRange(receiptOf(warning?.response));
  const dangerReceipt = receiptOf(danger?.response);
  const dangerRange = eventRange(dangerReceipt);
  const dangerOrdered = warningRange !== undefined
    && dangerRange !== undefined
    && warningRange.to < dangerRange.from;
  const dangerRandomness = randomnessCommitments(dangerReceipt).length > 0;

  const clarification = tagged(trace, "clarification");
  const unauthorized = tagged(trace, "unauthorized-pending");
  const ownerAnswer = tagged(trace, "owner-answer");
  const pendingOpened = outcomeKind(clarification?.response) === "awaitingInput";
  const unauthorizedRejected = unauthorized?.response?.ok === false
    || outcomeKind(unauthorized?.response) === "rejected";
  const pendingPersisted = unauthorized
    ? pendingIdFrom(unauthorized.hostView) === context.openedPendingInputId
    : false;
  const ownerCommitted = ["committed", "awaitingInput", "concluded"].includes(
    outcomeKind(ownerAnswer?.response),
  );

  const original = trace.find((entry) => entry.step.id === "10");
  const duplicate = trace.find((entry) => entry.step.kind === "duplicate");
  const idempotentReceipt = matchingReceipt(original, duplicate);
  const originalCommitments = randomnessCommitments(receiptOf(original?.response));
  const duplicateCommitments = randomnessCommitments(receiptOf(duplicate?.response));
  const commitmentsStable = canonicalJson(originalCommitments) === canonicalJson(duplicateCommitments);
  const randomnessObserved = originalCommitments.length > 0 || dangerRandomness;

  const meaningfulFailure = taggedAll(trace, "meaningful-failure").find((entry) =>
    receiptOf(entry.response)?.meaningfulFailure === true);
  const failureHasNewOptions = Array.isArray(receiptOf(meaningfulFailure?.response)?.newOptions)
    && receiptOf(meaningfulFailure.response).newOptions.length > 0;

  const ledgerDifferences = trace.map((entry) => ledgerDifference(entry.response))
    .filter((value) => value !== undefined);
  const maximumSpotlightDifference = ledgerDifferences.length
    ? Math.max(...ledgerDifferences)
    : undefined;
  const actorCounts = Object.fromEntries(["host", "player"].map((actor) => [
    actor,
    trace.filter((entry) => entry.step.actor === actor && entry.step.countsAsInteraction).length,
  ]));
  const interactionBalance = Math.abs(actorCounts.host - actorCounts.player);

  const concluded = trace.find((entry) => outcomeKind(entry.response) === "concluded");
  const conclusionStructured = concluded
    ? storyConcluded(concluded.response) || storyConcluded(concluded.hostView) || storyConcluded(concluded.playerView)
    : false;
  const narrationClaimsConclusionEarly = trace.some((entry) => {
    if (outcomeKind(entry.response) === "concluded") return false;
    return collectStringsAtKeys(
      { response: entry.response, host: entry.hostView, player: entry.playerView },
      new Set(["body", "text"]),
    ).some((body) => FAKE_CONCLUSION_PATTERN.test(body));
  });

  const allBodies = trace.flatMap((entry) => collectStringsAtKeys(
    entry.response,
    new Set(["body", "text"]),
  ));
  const narrationCount = allBodies.length;
  const narrationHistoryLeak = trace.some((entry) =>
    deepKeys({ response: entry.response, host: entry.hostView, player: entry.playerView }, FORBIDDEN_HISTORY_KEYS).size > 0);
  const ackErasure = trace
    .filter((entry) => collectStringsAtKeys(entry.response, new Set(["body", "text"])).length > 0)
    .every((entry) => entry.ackErased);
  const repeatedDelivery = trace.some((entry) => entry.repeatedReadStable === true);

  const forbiddenResponseKeys = new Set(trace.flatMap((entry) => [...entry.forbiddenResponseKeys]));
  const authorityEvidence = context.authorityEvidence;
  const postRollChange = duplicate !== undefined && original !== undefined && !idempotentReceipt;
  const duplicateRandomnessOrResource = postRollChange || !commitmentsStable;
  const substitutedPlayerChoice = pendingOpened && (!unauthorizedRejected || !pendingPersisted);
  const fakeConclusion = narrationClaimsConclusionEarly
    || (concluded !== undefined && !conclusionStructured);

  const scores = {
    secrets: score(
      secretAcquired && sharedSecretReceived && !unauthorizedSecretLeak && !privatePlanLeak,
      !unauthorizedSecretLeak && !privatePlanLeak,
    ),
    continuity: score(
      hostSecretPersisted && sharedSecretPersisted && revisionsMonotonic,
      revisionsMonotonic && (hostSecretPersisted || sharedSecretPersisted),
    ),
    fairness: score(dangerOrdered && dangerRandomness, dangerOrdered),
    agency: score(
      pendingOpened && unauthorizedRejected && pendingPersisted && ownerCommitted,
      pendingOpened && unauthorizedRejected,
    ),
    mechanicalHonesty: score(
      idempotentReceipt && commitmentsStable && randomnessObserved,
      idempotentReceipt && commitmentsStable,
    ),
    failure: score(Boolean(meaningfulFailure) && failureHasNewOptions, Boolean(meaningfulFailure)),
    spotlight: score(
      maximumSpotlightDifference !== undefined
        && maximumSpotlightDifference <= LIVE_KP_EVAL_THRESHOLDS.maximumSpotlightDifference,
      interactionBalance <= LIVE_KP_EVAL_THRESHOLDS.maximumSpotlightDifference,
    ),
    conclusion: score(Boolean(concluded) && conclusionStructured, Boolean(concluded)),
    recovery: score(idempotentReceipt && repeatedDelivery && ackErasure, idempotentReceipt),
    narration: score(
      narrationCount >= 20 && ackErasure && !narrationHistoryLeak,
      narrationCount >= 12 && !narrationHistoryLeak,
    ),
  };
  const hardGates = {
    secretLeak: unauthorizedSecretLeak || privatePlanLeak,
    substitutedPlayerChoice,
    postRollChange,
    duplicateRandomnessOrResource,
    secondAuthority: forbiddenResponseKeys.size > 0 || authorityEvidence.secondAuthority,
    fakeConclusion,
  };
  return {
    scores,
    hardGates,
    metrics: {
      secretAcquired,
      sharedSecretReceived,
      sharedSecretPersisted,
      hostSecretPersisted,
      dangerOrdered,
      dangerRandomness,
      pendingOpened,
      unauthorizedRejected,
      pendingPersisted,
      ownerCommitted,
      idempotentReceipt,
      randomnessObserved,
      meaningfulFailure: Boolean(meaningfulFailure),
      failureHasNewOptions,
      maximumSpotlightDifference,
      interactionBalance,
      structuredConclusion: conclusionStructured,
      narrationCount,
      repeatedDelivery,
      ackErasure,
      forbiddenResponseKeys: [...forbiddenResponseKeys].sort(),
      singleAuthoritySignals: authorityEvidence.signals,
      authorityMutationCount: authorityEvidence.mutationCount,
      authorityReceiptCoveredMutationCount: authorityEvidence.receiptCoveredMutationCount,
      authorityProjectionChecks: authorityEvidence.projectionChecks,
      authorityActiveCardChecks: authorityEvidence.activeCardChecks,
    },
    authorityEvidence,
  };
}

function publicTraceViews(step, response, hostTable, playerTable) {
  const actorTable = step.actor === "host" ? hostTable : playerTable;
  const otherTable = step.actor === "host" ? playerTable : hostTable;
  return {
    actorView: { response, table: actorTable },
    otherView: { table: otherTable },
    hostView: step.actor === "host"
      ? { response, table: hostTable }
      : { table: hostTable },
    playerView: step.actor === "player"
      ? { response, table: playerTable }
      : { table: playerTable },
  };
}

export async function runLiveKpEvaluation(options) {
  if (!isRecord(options?.actors?.host) || !isRecord(options?.actors?.player)) {
    throw new TypeError("Two authenticated actors are required.");
  }
  const hostCookie = options.actors.host.cookie;
  const playerCookie = options.actors.player.cookie;
  if (
    typeof hostCookie !== "string"
    || !hostCookie.trim()
    || typeof playerCookie !== "string"
    || !playerCookie.trim()
    || hostCookie === playerCookie
  ) {
    throw new TypeError("Two distinct authenticated session cookies are required.");
  }
  if (typeof options.roomCode !== "string" || !options.roomCode.trim()) {
    throw new TypeError("An authoritative evaluation room code is required.");
  }

  const startedAt = new Date().toISOString();
  const baseUrl = normalizeOrigin(options.baseUrl ?? LIVE_KP_EVAL_PRODUCTION_ORIGIN);
  const productionTarget = baseUrl === LIVE_KP_EVAL_PRODUCTION_ORIGIN;
  if (!productionTarget && options.allowNonProductionTarget !== true) {
    throw new TypeError("Only the production Worker can produce a live Workers AI evaluation report.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch implementation is required.");
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1_000, Math.min(120_000, Math.floor(options.timeoutMs)))
    : 60_000;
  const roomCode = options.roomCode.trim().toUpperCase();
  const host = apiClient(baseUrl, hostCookie, fetchImpl, timeoutMs);
  const player = apiClient(baseUrl, playerCookie, fetchImpl, timeoutMs);
  const clients = { host, player };

  const management = await host.command("getRoomManagement", { code: roomCode });
  const profile = profileFromManagement(management);
  if (
    profile?.rulesetVersion !== LIVE_KP_EVAL_RULESET
    || profile.modelId !== LIVE_KP_EVAL_MODEL
    || profile.status !== "play"
  ) {
    throw new TypeError("The evaluation room is not an active authoritative-v2 room with the pinned Workers AI model.");
  }

  const runId = options.runId ?? randomUUID();
  const secretCanary = options.secretCanary
    ?? `ZEVAL-${randomBytes(8).toString("hex").toUpperCase()}`;
  const privatePlanCanary = options.privatePlanCanary
    ?? `ZPLAN-${randomBytes(8).toString("hex").toUpperCase()}`;
  const scenario = buildLiveKpScenario({ runId, secretCanary, privatePlanCanary });
  const trace = [];
  const sentInputs = new Map();
  const [initialHostTable, initialPlayerTable] = await Promise.all([
    host.command("fetchTable", roomCode),
    player.command("fetchTable", roomCode),
  ]);
  let pendingInputId;
  let openedPendingInputId;

  for (const step of scenario) {
    const client = clients[step.actor];
    let data;
    let submissionId = step.submissionId;
    if (step.kind === "duplicate") {
      const original = sentInputs.get(step.duplicateOf);
      if (!original) throw new TypeError(`Missing duplicate source ${step.duplicateOf}.`);
      data = structuredClone(original);
      submissionId = data.submissionId;
    } else if (step.kind === "unauthorizedAnswer" || step.kind === "ownerAnswer") {
      data = pendingInputId
        ? {
            code: roomCode,
            text: step.text,
            submissionId,
            pendingInputId,
          }
        : { code: roomCode, text: step.fallbackText, submissionId };
      sentInputs.set(step.id, structuredClone(data));
    } else {
      data = { code: roomCode, text: step.text, submissionId };
      sentInputs.set(step.id, structuredClone(data));
    }

    const response = await client.command("sendAction", data);
    const authorityInputKeys = deepKeys(data, FORBIDDEN_AUTHORITY_INPUT_KEYS);
    if (!pendingInputId) {
      pendingInputId = pendingIdFrom(response);
      if (pendingInputId && !openedPendingInputId) openedPendingInputId = pendingInputId;
    }
    if (step.kind === "ownerAnswer" && response?.ok === true) pendingInputId = undefined;

    const [hostTable, playerTable] = await Promise.all([
      host.command("fetchTable", roomCode),
      player.command("fetchTable", roomCode),
    ]);
    const views = publicTraceViews(step, response, hostTable, playerTable);
    let repeatedReadStable;
    if (step.tags.includes("delivery-recovery")) {
      const repeated = await client.command("fetchTable", roomCode);
      repeatedReadStable = canonicalJson(tableDeliverySummary(repeated))
        === canonicalJson(tableDeliverySummary(step.actor === "host" ? hostTable : playerTable));
    }
    const [hostAckErased, playerAckErased] = await Promise.all([
      acknowledgeCurrent(host, roomCode, hostTable, step.actor === "host" ? response : undefined),
      acknowledgeCurrent(player, roomCode, playerTable, step.actor === "player" ? response : undefined),
    ]);
    const forbiddenResponseKeys = deepKeys(
      { response, hostTable, playerTable },
      FORBIDDEN_RESPONSE_KEYS,
    );
    const legacyActiveStateKeys = deepKeys(
      { response, hostTable, playerTable },
      LEGACY_ACTIVE_STATE_KEYS,
    );
    trace.push({
      step,
      submissionId,
      response,
      ...views,
      repeatedReadStable,
      ackErased: hostAckErased && playerAckErased,
      forbiddenResponseKeys,
      authorityInputKeys,
      legacyActiveStateKeys,
      hostTable,
      playerTable,
    });
  }

  const authorityEvidence = assessPublicSingleAuthority(trace, {
    host: initialHostTable,
    player: initialPlayerTable,
  });
  const scored = scoreTrace(trace, {
    secretCanary,
    privatePlanCanary,
    openedPendingInputId,
    authorityEvidence,
  });
  const scoresWithTotal = {
    ...scored.scores,
    total: Object.values(scored.scores).reduce((sum, value) => sum + value, 0),
  };
  const interactionsCompleted = trace.filter((entry) =>
    entry.step.countsAsInteraction).length;
  const hardGateFailed = Object.values(scored.hardGates).some(Boolean);
  const thresholdFailed = Object.values(scored.scores).some((value) =>
    value < LIVE_KP_EVAL_THRESHOLDS.minimumDimension)
    || scoresWithTotal.total < LIVE_KP_EVAL_THRESHOLDS.minimumTotal;
  const incomplete = interactionsCompleted < LIVE_KP_EVAL_THRESHOLDS.minimumInteractions;
  const status = incomplete ? "inconclusive" : hardGateFailed || thresholdFailed ? "fail" : "pass";
  const evidence = [];
  for (const entry of trace) evidence.push(await evidenceRow(entry));

  const report = {
    schemaVersion: LIVE_KP_EVAL_REPORT_SCHEMA,
    status,
    startedAt,
    endedAt: new Date().toISOString(),
    target: {
      origin: baseUrl,
      roomCodeHash: sha256(roomCode),
      rulesetVersion: profile.rulesetVersion,
      modelId: profile.modelId,
      modelCatalog: "https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/",
    },
    execution: {
      mode: productionTarget ? "live" : "selfTest",
      liveWorkersAiVerified: productionTarget
        && trace.some((entry) => ["committed", "concluded", "awaitingInput"].includes(outcomeKind(entry.response))),
      externalInterface: "/api/game → authoritative Room Action → Room DO",
      commands: [...ALLOWED_GAME_COMMANDS],
      interactionMinimum: LIVE_KP_EVAL_THRESHOLDS.minimumInteractions,
      interactionsCompleted,
      totalActionRequests: trace.length,
      runIdHash: sha256(runId),
    },
    thresholds: LIVE_KP_EVAL_THRESHOLDS,
    scores: scoresWithTotal,
    hardGates: scored.hardGates,
    metrics: scored.metrics,
    authorityEvidence: scored.authorityEvidence,
    evidence,
    redaction: {
      rawIntentStored: false,
      narrationStored: false,
      credentialsStored: false,
      promptStored: false,
      canariesStored: false,
      identifiersStoredAsHashes: true,
    },
  };

  const serializedReport = canonicalJson(report);
  for (const forbidden of [hostCookie, playerCookie, secretCanary, privatePlanCanary]) {
    if (serializedReport.includes(forbidden)) {
      throw new Error("Evaluation report redaction invariant failed.");
    }
  }
  return report;
}
