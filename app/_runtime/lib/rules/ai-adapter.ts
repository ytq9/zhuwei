import type { KpModelId } from "../kp/models";
import { chatModelText } from "../kp/provider";
import type { ModuleDef } from "../module/schema";
import type { Command, Decision, PlayerProjection, WorldEvent } from "./model";
import { rollDie } from "./ruleset";
import type { TurnTicket } from "../room/types";

export type Narration = {
  speech: string;
  tts: string;
  referencedEventIds: string[];
  canonicalFacts: string[];
};

type CommandDraft = Command extends infer Candidate
  ? Candidate extends Command
    ? Omit<Candidate, "id" | "actorId" | "expectedVersion">
    : never
  : never;

function compact(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function jsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function combatAttackMode(
  projection: PlayerProjection,
  targetId: string,
  attack: PlayerProjection["viewer"]["attacks"][number],
) {
  if (!projection.combat) return "normal" as const;
  const attacker = projection.combat.order.find(
    (entry) => entry.entityId === projection.viewer.id,
  );
  const target = projection.combat.order.find((entry) => entry.entityId === targetId);
  if (!attacker || !target) return "normal" as const;
  const adjacentHostile = attack.kind === "ranged" && projection.combat.order.some((entry) => {
    return (
      entry.side !== attacker.side &&
      Math.abs(entry.positionFeet - attacker.positionFeet) <= 5
    );
  });
  const distance = Math.abs(target.positionFeet - attacker.positionFeet);
  const rangedDisadvantage =
    attack.kind === "ranged" &&
    (distance > (attack.normalRangeFeet ?? 80) || adjacentHostile);
  const downedAdvantage =
    distance <= 5 &&
    projection.visibleEntities.find((entity) => entity.id === targetId)?.condition === "down";
  if (rangedDisadvantage && downedAdvantage) return "normal" as const;
  if (rangedDisadvantage) return "disadvantage" as const;
  if (downedAdvantage) return "advantage" as const;
  return "normal" as const;
}

function deterministicDraft(
  module: ModuleDef,
  projection: PlayerProjection,
  rawText: string,
): CommandDraft | null {
  const text = compact(rawText);
  if (/短休|歇一小时|休息一小时/.test(text)) return { kind: "startRest", rest: "short" };
  if (/长休|睡到天亮|过夜休息/.test(text)) return { kind: "startRest", rest: "long" };
  if (/结束休息|打断休息|醒来|起身/.test(text)) return { kind: "interruptRest" };
  if (/离队|脱离队伍|我单独/.test(text)) return { kind: "leaveSquad" };
  if (
    projection.combat &&
    projection.viewer.hp?.current === 0 &&
    /死亡豁免|死豁|求生/.test(text)
  ) {
    return { kind: "rollDeathSave", d20Roll: randomDie(20) };
  }
  if (projection.combat && /撤离|脱离接战|疾走|逃跑|跑到远处/.test(text)) {
    const mine = projection.combat.order.find(
      (entry) => entry.entityId === projection.viewer.id,
    );
    if (mine) {
      const enemies = projection.combat.order.filter((entry) => entry.side !== mine.side);
      const average = enemies.length
        ? enemies.reduce((sum, entry) => sum + (entry.positionFeet ?? 0), 0) / enemies.length
        : mine.positionFeet;
      const direction = average >= mine.positionFeet ? -1 : 1;
      const mode = /撤离|脱离接战/.test(text) ? "disengage" as const : "dash" as const;
      const distance = projection.viewer.speedFeet * (mode === "dash" ? 2 : 1);
      return {
        kind: "combatMove",
        combatId: projection.combat.id,
        toPositionFeet: mine.positionFeet + direction * distance,
        mode,
        opportunityRolls: {},
      };
    }
  }
  if (projection.combat && /移动|走近|靠近|接近/.test(text)) {
    const mine = projection.combat.order.find(
      (entry) => entry.entityId === projection.viewer.id,
    );
    if (mine) {
      const namedTarget = projection.visibleEntities.find(
        (entity) =>
          entity.id !== projection.viewer.id &&
          (text.includes(compact(entity.name)) || text.includes(compact(entity.id))),
      );
      const target = namedTarget
        ? projection.combat.order.find((entry) => entry.entityId === namedTarget.id)
        : undefined;
      const stated = /(?:移动|走)(\d+)尺/.exec(text)?.[1];
      const distance = Math.min(
        projection.viewer.speedFeet,
        stated ? Number(stated) : projection.viewer.speedFeet,
      );
      const direction = target
        ? target.positionFeet >= mine.positionFeet ? 1 : -1
        : 1;
      return {
        kind: "combatMove",
        combatId: projection.combat.id,
        toPositionFeet: mine.positionFeet + direction * distance,
        mode: "normal",
        opportunityRolls: {},
      };
    }
  }
  if (/攻击|动手|砍|刺|射|揍|施袭/.test(text)) {
    const candidates = projection.visibleEntities.filter(
      (entity) => entity.id !== projection.viewer.id,
    );
    const named = candidates.filter(
      (entity) => text.includes(compact(entity.name)) || text.includes(compact(entity.id)),
    );
    const targets = named.length ? named : candidates.filter((entity) => entity.kind === "npc");
    if (targets.length === 1 && projection.combat) {
      const attack = projection.viewer.attacks[0];
      if (!attack) return null;
      const mode = combatAttackMode(projection, targets[0].id, attack);
      const d20Rolls = Array.from({ length: mode === "normal" ? 1 : 2 }, () => randomDie(20));
      const face = mode === "advantage"
        ? Math.max(...d20Rolls)
        : mode === "disadvantage"
          ? Math.min(...d20Rolls)
          : d20Rolls[0];
      const critical = face === 20;
      return {
        kind: "combatAttack",
        combatId: projection.combat.id,
        targetId: targets[0].id,
        attackId: attack.id,
        mode,
        d20Rolls,
        damageRolls: Array.from(
          { length: attack.damage.count * (critical ? 2 : 1) },
          () => randomDie(attack.damage.sides),
        ),
      };
    }
    if (targets.length === 1) {
      const ids = [projection.viewer.id, targets[0].id];
      return {
        kind: "startCombat",
        targetIds: [targets[0].id],
        initiativeRolls: Object.fromEntries(ids.map((id) => [id, randomD20()])),
      };
    }
  }
  if (/原地等|等一会|我等|等待/.test(text)) {
    return { kind: "advanceTime", duration: { unit: "minute", value: 1 }, spotlightBeats: 0 };
  }
  const interactions = module.world.interactions.filter(
    (interaction) => interaction.sceneId === projection.viewer.sceneId,
  );
  const interaction = interactions
    .map((candidate) => ({
      candidate,
      score: [candidate.name, ...(candidate.aliases ?? []), ...(candidate.verbs ?? [])].filter(
        (word) => word && text.includes(compact(word)),
      ).length,
    }))
    .sort((a, b) => b.score - a.score)[0];
  if (interaction && interaction.score >= 2) {
    return { kind: "interact", interactionId: interaction.candidate.id };
  }
  const allScenes = module.chapters.flatMap((chapter) => chapter.scenes);
  for (const portal of projection.portals) {
    const target = allScenes.find((scene) => scene.id === portal.to);
    if (
      text.includes(compact(portal.to)) ||
      (target && [target.name, target.location].some((label) => text.includes(compact(label))))
    ) {
      const mode = /全队|整队|大家一起|我们一起|带队|带着大家/.test(text)
        ? ("squad" as const)
        : ("personal" as const);
      return { kind: "move", portalId: portal.id, destinationId: portal.to, mode };
    }
  }
  return null;
}

function allowedCommands(module: ModuleDef, projection: PlayerProjection) {
  return {
    interactions: module.world.interactions
      .filter((interaction) => interaction.sceneId === projection.viewer.sceneId)
      .map((interaction) => ({
        id: interaction.id,
        name: interaction.name,
        aliases: interaction.aliases ?? [],
        verbs: interaction.verbs ?? [],
      })),
    portals: projection.portals.map((portal) => ({
      id: portal.id,
      to: portal.to,
      modes:
        projection.squad?.captainId === projection.viewer.id
          ? ["personal", "squad"]
          : ["personal"],
    })),
    organization: ["startRest", "interruptRest", "leaveSquad", "advanceTime", "rollDeathSave"],
    combatTargets: projection.visibleEntities
      .filter((entity) => entity.id !== projection.viewer.id)
      .map((entity) => ({ id: entity.id, name: entity.name })),
    combat: projection.combat,
    attacks: projection.viewer.attacks,
    combatMovement: projection.combat
      ? { speedFeet: projection.viewer.speedFeet, modes: ["normal", "dash", "disengage"] }
      : null,
  };
}

function randomD20() {
  return randomDie(20);
}

function randomDie(sides: number) {
  return rollDie(sides);
}

function parseDraft(
  raw: string,
  module: ModuleDef,
  projection: PlayerProjection,
): { ok: true; draft: CommandDraft } | { ok: false; error: string } {
  const value = jsonObject(raw);
  if (!value) return { ok: false, error: "没有返回 JSON 对象" };
  const kind = String(value.kind ?? "");
  if (kind === "interact") {
    const interactionId = String(value.interactionId ?? "");
    const allowed = module.world.interactions.some(
      (interaction) =>
        interaction.id === interactionId && interaction.sceneId === projection.viewer.sceneId,
    );
    return allowed
      ? { ok: true, draft: { kind, interactionId } }
      : { ok: false, error: `交互不在当前候选集：${interactionId}` };
  }
  if (kind === "move") {
    const portalId = String(value.portalId ?? "");
    const destinationId = String(value.destinationId ?? "");
    const mode = value.mode === "squad" ? "squad" : "personal";
    const allowed = projection.portals.some(
      (portal) => portal.id === portalId && portal.to === destinationId,
    );
    const canMoveSquad =
      mode === "personal" || projection.squad?.captainId === projection.viewer.id;
    return allowed && canMoveSquad
      ? { ok: true, draft: { kind, portalId, destinationId, mode } }
      : { ok: false, error: `移动不在当前候选集：${portalId}` };
  }
  if (kind === "startRest") {
    const rest = value.rest === "long" ? "long" : value.rest === "short" ? "short" : null;
    return rest
      ? { ok: true, draft: { kind, rest } }
      : { ok: false, error: "休息类型必须是 short 或 long" };
  }
  if (kind === "startCombat") {
    const targetIds = Array.isArray(value.targetIds) ? value.targetIds.map(String) : [];
    const allowed = new Set(
      projection.visibleEntities
        .filter((entity) => entity.id !== projection.viewer.id)
        .map((entity) => entity.id),
    );
    if (!targetIds.length || targetIds.some((id) => !allowed.has(id))) {
      return { ok: false, error: "战斗目标不在当前可见实体中" };
    }
    const participants = [projection.viewer.id, ...new Set(targetIds)];
    return {
      ok: true,
      draft: {
        kind,
        targetIds: [...new Set(targetIds)],
        initiativeRolls: Object.fromEntries(participants.map((id) => [id, randomD20()])),
      },
    };
  }
  if (kind === "combatAttack") {
    const targetId = String(value.targetId ?? "");
    const attackId = String(value.attackId ?? "");
    const combat = projection.combat;
    const attack = projection.viewer.attacks.find((entry) => entry.id === attackId);
    const attacker = combat?.order.find((entry) => entry.entityId === projection.viewer.id);
    const target = combat?.order.find((entry) => entry.entityId === targetId);
    if (
      !combat ||
      !attack ||
      !attacker ||
      !target
    ) {
      return { ok: false, error: "攻击方式或战斗目标不合法" };
    }
    const mode = combatAttackMode(projection, targetId, attack);
    const d20Rolls = Array.from({ length: mode === "normal" ? 1 : 2 }, () => randomDie(20));
    const face = mode === "advantage"
      ? Math.max(...d20Rolls)
      : mode === "disadvantage"
        ? Math.min(...d20Rolls)
        : d20Rolls[0];
    return {
      ok: true,
      draft: {
        kind,
        combatId: combat.id,
        targetId,
        attackId,
        mode,
        d20Rolls,
        damageRolls: Array.from(
          { length: attack.damage.count * (face === 20 ? 2 : 1) },
          () => randomDie(attack.damage.sides),
        ),
      },
    };
  }
  if (kind === "combatMove") {
    const combat = projection.combat;
    const mine = combat?.order.find((entry) => entry.entityId === projection.viewer.id);
    const mode =
      value.mode === "dash" || value.mode === "disengage" || value.mode === "normal"
        ? value.mode
        : null;
    if (!combat || !mine || !mode) return { ok: false, error: "战斗移动方式不合法" };
    const enemies = combat.order.filter((entry) => entry.side !== mine.side);
    const average = enemies.length
      ? enemies.reduce((sum, entry) => sum + (entry.positionFeet ?? 0), 0) / enemies.length
      : mine.positionFeet;
    const direction = average >= mine.positionFeet ? -1 : 1;
    const distance = projection.viewer.speedFeet * (mode === "dash" ? 2 : 1);
    return {
      ok: true,
      draft: {
        kind,
        combatId: combat.id,
        toPositionFeet: mine.positionFeet + direction * distance,
        mode,
        opportunityRolls: {},
      },
    };
  }
  if (kind === "rollDeathSave") {
    return projection.combat && projection.viewer.hp?.current === 0
      ? { ok: true, draft: { kind, d20Roll: randomDie(20) } }
      : { ok: false, error: "角色当前不需要死亡豁免" };
  }
  if (kind === "interruptRest" || kind === "leaveSquad") {
    return { ok: true, draft: { kind } };
  }
  if (kind === "advanceTime") {
    return {
      ok: true,
      draft: { kind, duration: { unit: "minute", value: 1 }, spotlightBeats: 1 },
    };
  }
  return { ok: false, error: `不允许的命令种类：${kind}` };
}

export async function interpretPlayerAction(input: {
  model: KpModelId;
  module: ModuleDef;
  ticket: TurnTicket;
  rawText: string;
}) {
  const deterministic = deterministicDraft(input.module, input.ticket.projection, input.rawText);
  if (deterministic) {
    return {
      ok: true as const,
      command: {
        ...deterministic,
        id: crypto.randomUUID(),
        actorId: input.ticket.actorId,
        expectedVersion: input.ticket.stateVersion,
      } as Command,
      source: "deterministic" as const,
    };
  }
  const system = `你是 D&D 5e 2014 跑团的行动解释器，不是 KP，不写旁白，不裁决结果。
只把玩家原话映射为候选命令。只能引用 allowed 中的 id。
输出一个 JSON：
{"kind":"interact","interactionId":"..."}
或 {"kind":"move","portalId":"...","destinationId":"...","mode":"personal|squad"}
或 {"kind":"startRest","rest":"short|long"}
或 {"kind":"interruptRest"}
或 {"kind":"leaveSquad"}
或 {"kind":"advanceTime"}
或 {"kind":"startCombat","targetIds":["可见实体 id"]}
或 {"kind":"combatAttack","targetId":"战斗内实体 id","attackId":"自己的攻击 id"}
或 {"kind":"combatMove","mode":"normal|dash|disengage"}
或 {"kind":"rollDeathSave"}
不得输出位置补丁、线索、物品、HP、资源、DC、骰子、时间数值或剧情结果。战斗先攻骰由程序补入，模型不得给骰点。普通交谈、观察和没有结构化效果的行动用 advanceTime。`;
  const user = JSON.stringify({
    action: input.rawText,
    projection: input.ticket.projection,
    allowed: allowedCommands(input.module, input.ticket.projection),
  });
  let validationError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await chatModelText(
      input.model,
      [
        { role: "system", content: system },
        {
          role: "user",
          content: attempt === 0 ? user : `${user}\n上次输出无效：${validationError}。只返回合法 JSON。`,
        },
      ],
      { temperature: 0, maxTokens: 240 },
    );
    if (!response.ok) return response;
    const parsed = parseDraft(response.text, input.module, input.ticket.projection);
    if (parsed.ok) {
      return {
        ok: true as const,
        command: {
          ...parsed.draft,
          id: crypto.randomUUID(),
          actorId: input.ticket.actorId,
          expectedVersion: input.ticket.stateVersion,
        } as Command,
        source: "model" as const,
      };
    }
    validationError = parsed.error;
  }
  return { ok: false as const, error: `行动解释失败：${validationError}` };
}

function eventFacts(module: ModuleDef, events: WorldEvent[]): string[] {
  const facts: string[] = [];
  for (const event of events) {
    if (event.type === "ArtifactTransferred") {
      const artifact = module.world.artifacts.find((candidate) => candidate.id === event.artifactId);
      facts.push(`${artifact?.name ?? "物件"}已经由行动者持有，原处不再有第二份。`);
    } else if (event.type === "PortalStateChanged") {
      const labels = { open: "已经打开", closed: "已经关闭", locked: "已经锁住", destroyed: "已经被破开" };
      facts.push(`通道 ${event.portalId}${labels[event.state]}。`);
    } else if (event.type === "EntityMoved") {
      facts.push(`${event.entityId} 已从 ${event.from} 到达 ${event.to}。`);
    } else if (event.type === "ClueLearned") {
      const clue = module.clues.find((candidate) => candidate.id === event.clueId);
      if (clue) facts.push(event.layer === "full" ? clue.playerText : clue.talkText);
    } else if (event.type === "RestStarted") {
      facts.push(`${event.rest.actorId} 开始${event.rest.kind === "long" ? "长休" : "短休"}。`);
    } else if (event.type === "RestCompleted") {
      facts.push(`${event.actorId} 已满足${event.rest === "long" ? "长休" : "短休"}时长。`);
    } else if (event.type === "RestInterrupted") {
      facts.push(`${event.actorId} 的休息已经中断。`);
    } else if (event.type === "SquadLeft") {
      facts.push(`${event.actorId} 已选择个人行动并自动离开原队伍，无需队长批准。`);
    } else if (event.type === "SpellCast") {
      facts.push(`${event.entityId} 已按规则施放 ${event.spellId}${event.slotLevel ? `，消耗 ${event.slotLevel} 环法术位` : "（戏法，不消耗法术位）"}。`);
    } else if (event.type === "FeatureUsed") {
      facts.push(`${event.entityId} 已使用 ${event.featureId}${event.total === undefined ? "" : `，规则结果为 ${event.total}`}。`);
    } else if (event.type === "CombatStarted") {
      facts.push(`战斗已在 ${event.combat.sceneId} 开始，先攻顺序为 ${event.combat.order.map((entry) => `${entry.entityId}(${entry.initiative})`).join("、")}。`);
    } else if (event.type === "CombatEnded") {
      facts.push(`战斗已经结束：${event.reason}。`);
    } else if (event.type === "CombatantSideChanged") {
      facts.push(`${event.entityId} 已经主动转为与原阵营敌对。`);
    } else if (event.type === "CombatTurnAdvanced") {
      facts.push(`战斗进入第 ${event.round} 轮，现在轮到 ${event.toEntityId}。`);
    } else if (event.type === "CombatAttackResolved") {
      facts.push(`${event.attackerId} 对 ${event.targetId} 的攻击总值为 ${event.attackTotal}，${event.hit ? `命中并造成 ${event.damage} 点伤害${event.critical ? "（重击）" : ""}` : "未命中"}。`);
    } else if (event.type === "CombatantMoved") {
      facts.push(`${event.entityId} 以${event.mode === "disengage" ? "撤离" : event.mode === "dash" ? "疾走" : "移动"}方式移动 ${event.feet} 英尺，当前位置为 ${event.toPositionFeet} 英尺。`);
    } else if (event.type === "EntityDropped") {
      facts.push(`${event.entityId}${event.outcome === "dead" ? "已经死亡" : "降至 0 生命并失去意识"}。`);
    } else if (event.type === "DeathSaveResolved") {
      facts.push(`${event.entityId} 的死亡豁免 d20=${event.d20Roll}；当前成功 ${event.successes}、失败 ${event.failures}，结果为 ${event.outcome}。`);
    } else if (event.type === "ScheduledEventAttempted") {
      facts.push(`已到达定时事件 ${event.scheduledEventId}，NPC 开始尝试计划 ${event.npcPlanId}。`);
    } else if (event.type === "ActivityCompleted") {
      facts.push(`活动 ${event.activityId} 已在虚构时间中完成。`);
    } else if (event.type === "ActivityFailed") {
      facts.push(`活动 ${event.activityId} 未能完成：${event.reason}`);
    } else if (event.type === "ActivityInterrupted") {
      facts.push(`原活动在定时事件 ${event.scheduledEventId} 发生时被中断。`);
    }
  }
  return [...new Set(facts)];
}

function parseNarration(
  raw: string,
  eventIds: Set<string>,
  canonicalFacts: string[],
): { ok: true; narration: Narration } | { ok: false; error: string } {
  const value = jsonObject(raw);
  if (!value) return { ok: false, error: "没有返回 JSON 对象" };
  const speech = String(value.speech ?? "").trim().slice(0, 560);
  const tts = String(value.tts ?? speech).trim().slice(0, 320);
  const refs = Array.isArray(value.referencedEventIds)
    ? value.referencedEventIds.map(String)
    : [];
  if (!speech) return { ok: false, error: "speech 为空" };
  if (refs.some((id) => !eventIds.has(id))) return { ok: false, error: "引用了未提交事件" };
  if (/wherePatch|scenePatch|secretPatch|characterUpdates|revealClues/.test(speech + tts)) {
    return { ok: false, error: "旁白包含内部状态协议" };
  }
  return {
    ok: true,
    narration: { speech, tts: tts || speech, referencedEventIds: refs, canonicalFacts },
  };
}

export async function narrateDecision(input: {
  model: KpModelId;
  module: ModuleDef;
  rawText: string;
  decision: Decision;
  projection: PlayerProjection;
}): Promise<Narration> {
  if (input.decision.kind === "rejected") {
    return {
      speech: input.decision.rejection.message,
      tts: input.decision.rejection.message,
      referencedEventIds: [],
      canonicalFacts: [input.decision.rejection.message],
    };
  }
  if (input.decision.kind === "awaitingRoll") {
    const text = `需要进行${input.decision.roll.skill ? ` ${input.decision.roll.skill}` : "属性"}检定：${input.decision.roll.reason}`;
    return {
      speech: text,
      tts: text,
      referencedEventIds: input.decision.events.map((event) => event.id),
      canonicalFacts: [text],
    };
  }
  const facts = eventFacts(input.module, input.decision.events);
  const fallback = facts.join("") || "行动已经按规则结算，世界时间向前推进。";
  const eventIds = new Set(input.decision.events.map((event) => event.id));
  const system = `你是 D&D 5e 2014 跑团的结果叙述器。规则结果已经提交，你只能把 canonicalFacts 写成清楚的现代中文现场旁白。
不得增加、删除或反转事实；不得生成物品、位置、线索、伤害、资源、NPC 知识、成功或失败。canonicalFacts 为空时只描写不改变状态的短暂动作。
输出 JSON：{"speech":"不超过260字","tts":"更短的完整句","referencedEventIds":["只能引用给定 id"]}。`;
  const user = JSON.stringify({
    action: input.rawText,
    tone: input.module.tone,
    canonicalFacts: facts,
    eventIds: [...eventIds],
    visible: input.projection,
  });
  let validationError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await chatModelText(
      input.model,
      [
        { role: "system", content: system },
        {
          role: "user",
          content: attempt === 0 ? user : `${user}\n上次输出无效：${validationError}。只返回合法 JSON。`,
        },
      ],
      { temperature: 0.5, maxTokens: 520 },
    );
    if (!response.ok) break;
    const parsed = parseNarration(response.text, eventIds, facts);
    if (parsed.ok) return parsed.narration;
    validationError = parsed.error;
  }
  return {
    speech: fallback,
    tts: fallback.slice(0, 260),
    referencedEventIds: [...eventIds],
    canonicalFacts: facts,
  };
}
