import type {
  Predicate,
  RuleEffect,
  WorldDefinition,
  WorldPredicate,
} from "./model";
import { RULESET_VERSION } from "./ruleset";

export type WorldCompileContext = {
  sceneIds: string[];
  clueIds: string[];
  npcIds: string[];
  sceneClues?: Record<string, string[]>;
};

function collectPredicateRefs(predicate: Predicate) {
  if (predicate.kind === "not") return collectPredicateRefs(predicate.predicate);
  return predicate;
}

function effectRefs(effect: RuleEffect) {
  return effect;
}

export function worldDefinitionErrors(
  world: WorldDefinition,
  context: WorldCompileContext,
): string[] {
  const errors: string[] = [];
  const scenes = new Set(context.sceneIds);
  const locations = new Set(world.locationSceneIds);
  const clues = new Set(context.clueIds);
  const npcs = new Set(context.npcIds);
  const portals = new Map(world.portals.map((portal) => [portal.id, portal]));
  const artifacts = new Map(world.artifacts.map((artifact) => [artifact.id, artifact]));
  const plans = new Map(world.npcPlans.map((plan) => [plan.id, plan]));
  const revealedClues = new Set<string>();

  if (world.rulesetVersion !== RULESET_VERSION) {
    errors.push(`rulesetVersion 必须为 ${RULESET_VERSION}`);
  }
  if (!locations.has(world.initialSceneId)) {
    errors.push(`初始地点不存在：${world.initialSceneId}`);
  }
  for (const sceneId of locations) {
    if (!scenes.has(sceneId)) errors.push(`地点未在场景表登记：${sceneId}`);
  }

  const unique = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.trim()) errors.push(`${label} id 不能为空`);
      if (seen.has(id)) errors.push(`${label} id 重复：${id}`);
      seen.add(id);
    }
  };
  unique("Portal", world.portals.map((value) => value.id));
  unique("Artifact", world.artifacts.map((value) => value.id));
  unique("Interaction", world.interactions.map((value) => value.id));
  unique("NPC Plan", world.npcPlans.map((value) => value.id));
  unique("ScheduledEvent", world.scheduledEvents.map((value) => value.id));
  unique("Ending", (world.endings ?? []).map((value) => value.id));

  for (const portal of world.portals) {
    if (!locations.has(portal.from)) errors.push(`${portal.id}: from 不是地点 ${portal.from}`);
    if (!locations.has(portal.to)) errors.push(`${portal.id}: to 不是地点 ${portal.to}`);
    if (portal.from === portal.to) errors.push(`${portal.id}: 通道两端不能相同`);
  }
  for (const artifact of world.artifacts) {
    if (!locations.has(artifact.initialSceneId)) {
      errors.push(`${artifact.id}: 初始地点不存在 ${artifact.initialSceneId}`);
    }
    if (artifact.initialHolderId && !npcs.has(artifact.initialHolderId)) {
      errors.push(`${artifact.id}: 初始持有 NPC 不存在 ${artifact.initialHolderId}`);
    }
  }
  for (const [npcId, knowledge] of Object.entries(world.npcInitialKnowledge ?? {})) {
    if (!npcs.has(npcId)) errors.push(`NPC 初始知识的实体不存在：${npcId}`);
    for (const [clueId, layer] of Object.entries(knowledge)) {
      if (!clues.has(clueId)) errors.push(`${npcId}: 初始知识线索不存在 ${clueId}`);
      if (!["hint", "partial", "full"].includes(layer)) {
        errors.push(`${npcId}: 初始知识层级不合法 ${clueId}/${layer}`);
      }
    }
  }
  for (const [npcId, capabilities] of Object.entries(world.npcCapabilities ?? {})) {
    if (!npcs.has(npcId)) errors.push(`NPC 能力表的实体不存在：${npcId}`);
    if (capabilities.some((capability) => !capability.trim())) {
      errors.push(`${npcId}: NPC 能力标识不能为空`);
    }
  }

  const validatePredicate = (owner: string, raw: Predicate) => {
    const predicate = collectPredicateRefs(raw);
    if (predicate.kind === "actorAt" && !locations.has(predicate.sceneId)) {
      errors.push(`${owner}: predicate 地点不存在 ${predicate.sceneId}`);
    }
    if (predicate.kind === "entityAt") {
      if (!npcs.has(predicate.entityId)) {
        errors.push(`${owner}: predicate 固定实体不存在 ${predicate.entityId}`);
      }
      if (!locations.has(predicate.sceneId)) {
        errors.push(`${owner}: predicate 地点不存在 ${predicate.sceneId}`);
      }
    }
    if (
      (predicate.kind === "artifactAt" ||
        predicate.kind === "artifactHeldByActor" ||
        predicate.kind === "artifactHeldByEntity") &&
      !artifacts.has(predicate.artifactId)
    ) {
      errors.push(`${owner}: predicate 物件不存在 ${predicate.artifactId}`);
    }
    if (predicate.kind === "portalState" && !portals.has(predicate.portalId)) {
      errors.push(`${owner}: predicate 通道不存在 ${predicate.portalId}`);
    }
    if (predicate.kind === "actorKnows" && !clues.has(predicate.clueId)) {
      errors.push(`${owner}: predicate 线索不存在 ${predicate.clueId}`);
    }
  };
  const validateEffect = (owner: string, raw: RuleEffect) => {
    const effect = effectRefs(raw);
    if (
      ![
        "transferArtifact",
        "moveActor",
        "setPortalState",
        "revealClue",
        "setFlag",
        "damage",
        "heal",
        "spendResource",
      ].includes(effect.kind)
    ) {
      errors.push(`${owner}: 不允许的 5e effect ${(effect as { kind?: unknown }).kind ?? "unknown"}`);
      return;
    }
    if (effect.kind === "transferArtifact" && !artifacts.has(effect.artifactId)) {
      errors.push(`${owner}: effect 物件不存在 ${effect.artifactId}`);
    }
    if (effect.kind === "setPortalState" && !portals.has(effect.portalId)) {
      errors.push(`${owner}: effect 通道不存在 ${effect.portalId}`);
    }
    if (effect.kind === "moveActor") {
      const portal = portals.get(effect.portalId);
      if (!portal) errors.push(`${owner}: NPC 移动通道不存在 ${effect.portalId}`);
      if (!locations.has(effect.to)) errors.push(`${owner}: NPC 移动地点不存在 ${effect.to}`);
      if (portal && effect.to !== portal.from && effect.to !== portal.to) {
        errors.push(`${owner}: NPC 移动终点不在通道 ${effect.portalId} 上`);
      }
    }
    if (effect.kind === "revealClue" && !clues.has(effect.clueId)) {
      errors.push(`${owner}: effect 线索不存在 ${effect.clueId}`);
    }
    if (effect.kind === "revealClue" && clues.has(effect.clueId)) {
      revealedClues.add(effect.clueId);
    }
    if (
      (effect.kind === "damage" || effect.kind === "heal" || effect.kind === "spendResource") &&
      effect.amount <= 0
    ) {
      errors.push(`${owner}: effect 数量必须大于 0`);
    }
  };

  for (const interaction of world.interactions) {
    if (!locations.has(interaction.sceneId)) {
      errors.push(`${interaction.id}: 交互地点不存在 ${interaction.sceneId}`);
    }
    if (interaction.resolution.kind === "check") {
      if (interaction.resolution.dc < 5 || interaction.resolution.dc > 30) {
        errors.push(`${interaction.id}: 5e DC 应在 5–30`);
      }
      if (!interaction.resolution.reason.trim()) {
        errors.push(`${interaction.id}: 检定需要公开 reason`);
      }
    }
    for (const predicate of interaction.prerequisites ?? []) {
      validatePredicate(interaction.id, predicate);
    }
    for (const effect of [...interaction.success, ...(interaction.failure ?? [])]) {
      validateEffect(interaction.id, effect);
      if (effect.kind === "moveActor") {
        errors.push(`${interaction.id}: moveActor 只允许用于 NPC Plan`);
      }
    }
    for (const effect of interaction.success) {
      if (effect.kind === "transferArtifact") {
        const guarded = (interaction.prerequisites ?? []).some((predicate) => {
          const current = predicate.kind === "not" ? predicate.predicate : predicate;
          return (
            (current.kind === "artifactAt" || current.kind === "artifactHeldByEntity") &&
            current.artifactId === effect.artifactId
          );
        });
        if (!guarded) {
          errors.push(`${interaction.id}: 唯一物品 ${effect.artifactId} 的转移缺少 artifactAt 生命周期前置条件`);
        }
      }
    }
  }
  for (const clueId of clues) {
    if (!revealedClues.has(clueId)) errors.push(`线索没有任何结构化 revealClue 入口：${clueId}`);
  }
  for (const [sceneId, clueIds] of Object.entries(context.sceneClues ?? {})) {
    if (!locations.has(sceneId)) continue;
    for (const clueId of clueIds) {
      const local = world.interactions.some(
        (interaction) =>
          interaction.sceneId === sceneId &&
          [...interaction.success, ...(interaction.failure ?? [])].some(
            (effect) => effect.kind === "revealClue" && effect.clueId === clueId,
          ),
      );
      if (!local) errors.push(`${sceneId}: 场景线索 ${clueId} 没有同地点结构化交互`);
    }
  }

  for (const plan of world.npcPlans) {
    if (!npcs.has(plan.actorId)) errors.push(`${plan.id}: NPC 不存在 ${plan.actorId}`);
    for (const clueId of plan.requiredKnowledge ?? []) {
      if (!clues.has(clueId)) errors.push(`${plan.id}: 所需知识不存在 ${clueId}`);
    }
    for (const capability of plan.requiredCapabilities ?? []) {
      if (!(world.npcCapabilities?.[plan.actorId] ?? []).includes(capability)) {
        errors.push(`${plan.id}: NPC 未声明所需能力 ${capability}`);
      }
    }
    for (const predicate of plan.prerequisites ?? []) validatePredicate(plan.id, predicate);
    for (const effect of plan.effects) {
      validateEffect(plan.id, effect);
      if (effect.kind === "moveActor") {
        const portal = portals.get(effect.portalId);
        const from = portal
          ? effect.to === portal.from
            ? portal.to
            : portal.from
          : undefined;
        const guarded = from && (plan.prerequisites ?? []).some(
          (predicate) => predicate.kind === "actorAt" && predicate.sceneId === from,
        );
        if (!guarded) {
          errors.push(`${plan.id}: NPC 移动必须以通道另一端的 actorAt 为前置条件`);
        }
      }
    }
  }
  for (const event of world.scheduledEvents) {
    if (!plans.has(event.npcPlanId)) errors.push(`${event.id}: NPC Plan 不存在 ${event.npcPlanId}`);
    if (event.atSeconds < 0) errors.push(`${event.id}: atSeconds 不能为负`);
    if (event.scope.kind === "location" && !locations.has(event.scope.sceneId)) {
      errors.push(`${event.id}: scope 地点不存在 ${event.scope.sceneId}`);
    }
    if (event.scope.kind === "entity" && !npcs.has(event.scope.entityId)) {
      errors.push(`${event.id}: scope 实体不存在 ${event.scope.entityId}`);
    }
    for (const predicate of [...(event.conditions ?? []), ...(event.cancelIf ?? [])]) {
      validatePredicate(event.id, predicate);
    }
  }
  const validateWorldPredicate = (owner: string, predicate: WorldPredicate): void => {
    if (predicate.kind === "not") {
      validateWorldPredicate(owner, predicate.predicate);
      return;
    }
    if (predicate.kind === "portalState" && !portals.has(predicate.portalId)) {
      errors.push(`${owner}: ending 通道不存在 ${predicate.portalId}`);
    }
    if (predicate.kind === "artifactStatus" && !artifacts.has(predicate.artifactId)) {
      errors.push(`${owner}: ending 物件不存在 ${predicate.artifactId}`);
    }
    if (predicate.kind === "entityAt") {
      if (!npcs.has(predicate.entityId)) {
        errors.push(`${owner}: ending 固定实体不存在 ${predicate.entityId}`);
      }
      if (!locations.has(predicate.sceneId)) {
        errors.push(`${owner}: ending 地点不存在 ${predicate.sceneId}`);
      }
    }
    if (predicate.kind === "entityKnows") {
      if (!npcs.has(predicate.entityId)) {
        errors.push(`${owner}: ending 固定实体不存在 ${predicate.entityId}`);
      }
      if (!clues.has(predicate.clueId)) {
        errors.push(`${owner}: ending 线索不存在 ${predicate.clueId}`);
      }
    }
    if (predicate.kind === "allPlayersKnow" && !clues.has(predicate.clueId)) {
      errors.push(`${owner}: ending 线索不存在 ${predicate.clueId}`);
    }
  };
  if (!(world.endings ?? []).length) errors.push("结构化世界至少需要一个结局谓词");
  for (const ending of world.endings ?? []) {
    if (!ending.name.trim() || !ending.publicText.trim()) {
      errors.push(`${ending.id}: 结局需要名称和达成后公开文本`);
    }
    if (!ending.when.length) errors.push(`${ending.id}: 结局至少需要一个 when 谓词`);
    for (const predicate of ending.when) validateWorldPredicate(ending.id, predicate);
  }

  if (locations.size) {
    const reached = new Set<string>([world.initialSceneId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const portal of world.portals) {
        if (reached.has(portal.from) && !reached.has(portal.to)) {
          reached.add(portal.to);
          changed = true;
        }
        if (reached.has(portal.to) && !reached.has(portal.from)) {
          reached.add(portal.from);
          changed = true;
        }
      }
    }
    for (const sceneId of locations) {
      if (!reached.has(sceneId)) errors.push(`地点从初始场景不可达：${sceneId}`);
    }
  }
  return errors;
}

export function assertWorldDefinition(
  world: WorldDefinition,
  context: WorldCompileContext,
): WorldDefinition {
  const errors = worldDefinitionErrors(world, context);
  if (errors.length) throw new Error(`结构化世界未通过：\n- ${errors.join("\n- ")}`);
  return world;
}
