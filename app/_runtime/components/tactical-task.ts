import type {
  CombatControlAbility,
  NpcCombatTurnStatus,
  ReadyTriggerEvent,
} from "@/lib/table/authoritative";
import type {
  TacticalEntity,
  TacticalPosition,
  TacticalProjection,
} from "@/lib/rules/tactical-projection";

// SPEC 0014 §§4、5、8 (ADR 0091): what the player puts together before a map
// action, and the pure helpers the map, the action list and the bar above the
// composer share. Nothing here decides ranges, cover or who is affected.

/** A point the player picked on the map, in whole inches. */
export type MapPoint = { x: number; y: number };

/** SPEC 0012 §8.1 (ADR 0099 decision 3): the creature and event a Ready
 * waits for. A path, creature or area pick made with it becomes the readied
 * response instead of an act now. */
export type ReadyPick = { triggerRef: string; event: ReadyTriggerEvent };

/** SPEC 0014 §§4、5、8: what the player is putting together on the map. The
 * map only collects the player's picks; Rules decides paths, ranges, cover
 * and who an area affects. An attack may be aimed at a `point` instead of a
 * creature, for one the player cannot see (SPEC 0012 §6.3, ADR 0097). */
export type MapTask =
  | { kind: "idle" }
  | { kind: "destination"; point: MapPoint }
  | { kind: "path"; waypoints: MapPoint[]; ready?: ReadyPick }
  | { kind: "creatures"; ability: CombatControlAbility; refs: string[]; purpose: "combat" | "intent"; point?: MapPoint | null; ready?: ReadyPick }
  | { kind: "area"; ability: CombatControlAbility; origin: MapPoint | null; direction: MapPoint | null; ready?: ReadyPick }
  | { kind: "intent"; ability: CombatControlAbility; aimRef: string | null }
  | { kind: "help"; ability: CombatControlAbility; allyRef: string | null; mode: "check" | "attack"; enemyRef: string | null }
  | { kind: "ready"; ability: CombatControlAbility; triggerRef: string | null; event: ReadyTriggerEvent | null }
  /** SPEC 0014 §4 (ADR 0098): a climb or swim on the combat map, sent to the
   * KP as the player's sentence. */
  | { kind: "climb"; featureId: string; sentence: string }
  /** SPEC 0014 §8 (ADR 0103 decision 4): going through a door to the place it
   * leads to, sent to the KP as the player's sentence. */
  | { kind: "goTo"; featureId: string; sentence: string; passable: boolean };

export const READY_EVENT_LABEL: Record<ReadyTriggerEvent, string> = {
  turnStarted: "开始回合时",
  movementCommitted: "移动时",
  spellCastingStarted: "开始施法时",
};

/** Whether a combat attack pick may name a point on the map instead of a
 * creature. */
export function aimable(ability: CombatControlAbility): boolean {
  return ability.target.kind === "creatures" && ability.target.aimable === true;
}

export const IDLE_TASK: MapTask = { kind: "idle" };

/** At most 64 points per path, the first being where the actor stands. */
export const MAX_PATH_WAYPOINTS = 63;

export function inches(value: string): number {
  return Number(value);
}

/** Display-only snapping to the 5-foot grid (SPEC 0014 §2.1); the submitted
 * point is the snapped whole-inch point. */
export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/** A picked point snaps to a quarter cell: half a cell's side, 2.5 feet.
 * Only the display snaps; Rules take any whole inch (SPEC 0014 §2.1). */
export function pickStep(projection: TacticalProjection): number {
  return projection.scene.gridInches / 2;
}

export function sceneBounds(projection: TacticalProjection) {
  const xs = projection.scene.boundary.points.map((point) => inches(point.x));
  const ys = projection.scene.boundary.points.map((point) => inches(point.y));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function clampToScene(point: MapPoint, projection: TacticalProjection): MapPoint {
  const bounds = sceneBounds(projection);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
  };
}

export function selfPoint(projection: TacticalProjection): MapPoint {
  return { x: inches(projection.self.position.x), y: inches(projection.self.position.y) };
}

export function mapPosition(point: MapPoint, elevation: string): TacticalPosition {
  return { x: String(point.x), y: String(point.y), elevation };
}

/** SPEC 0014 §5: the area a pick names -- its origin and, for a cube, cone
 * or line, the way from the origin to the second point -- as it is
 * submitted and previewed. Outside an encounter an area sits on the
 * creature it is aimed at, or on the player when it starts there. */
export function areaPick(
  projection: TacticalProjection,
  task: MapTask,
): { origin: TacticalPosition; direction?: TacticalPosition } | null {
  if (task.kind === "intent" && task.ability.target.kind === "area") {
    const target = task.ability.target;
    if (target.origin === "self" && !target.needsDirection) return { origin: structuredClone(projection.self.position) };
    const aimed = [projection.self, ...projection.visibleEntities].find((entity) => entity.id === task.aimRef);
    if (aimed === undefined) return null;
    if (!target.needsDirection) return { origin: structuredClone(aimed.position) };
    // A cube, cone or line cast from the player points at the creature it is
    // aimed at; one placed at a point is not previewed without its direction.
    if (target.origin !== "self" || aimed.id === projection.self.id) return null;
    const self = projection.self.position;
    return { origin: structuredClone(self),
      direction: { x: String(inches(aimed.position.x) - inches(self.x)), y: String(inches(aimed.position.y) - inches(self.y)), elevation: "0" } };
  }
  if (task.kind !== "area" || task.ability.target.kind !== "area" || task.origin === null) return null;
  const shape = task.ability.target;
  if (shape.needsDirection && task.direction === null) return null;
  const origin = shape.origin === "self"
    ? structuredClone(projection.self.position)
    : mapPosition(task.origin, projection.self.position.elevation);
  return {
    origin,
    ...(shape.needsDirection && task.direction !== null
      ? { direction: { x: String(task.direction.x - Number(origin.x)), y: String(task.direction.y - Number(origin.y)), elevation: "0" } }
      : {}),
  };
}

/** SPEC 0014 §7 (ADR 0148): how far a creature is for the ability being
 * aimed, as Rules listed it; null when Rules gave no list. */
export function reachOf(ability: CombatControlAbility, entityId: string): "within" | "long" | "out" | null {
  const target = ability.target;
  if (target.kind !== "creatures" || target.withinRefs === undefined) return null;
  return target.withinRefs.includes(entityId) ? "within"
    : target.longRangeRefs?.includes(entityId) ? "long" : "out";
}

export function playerEncounter(projection: TacticalProjection) {
  const encounter = projection.encounter;
  const inEncounter = encounter !== null
    && encounter.status !== "concluded"
    && encounter.participantEntityIds.includes(projection.self.id);
  return { inEncounter, myTurn: inEncounter && encounter?.activeEntityId === projection.self.id };
}

/** Whether a click on the map ground picks a point in this task. */
export function taskPicksPoint(task: MapTask): boolean {
  return task.kind === "path"
    || (task.kind === "area"
      && (task.origin === null || (task.ability.target.kind === "area" && task.ability.target.needsDirection && task.direction === null)));
}

/** Whether the ability lets the player pick this creature at all. Grapple
 * and shove against a player need that player's own answer, so the map offers
 * them only against non-player creatures that are not allies. */
export function creaturePickable(ability: CombatControlAbility, entity: TacticalEntity): boolean {
  // An attack is never aimed at the attacker.
  if (entity.relation === "self" && (ability.group === "attack" || ability.activation === "attack")) return false;
  // SPEC 0012 §12.1 (ADR 0113): first aid reaches only the dying creatures Rules listed.
  if (ability.target.kind === "creatures" && ability.target.onlyRefs !== undefined) return ability.target.onlyRefs.includes(entity.id);
  return ability.target.kind !== "creatures" || ability.target.npcOpponentsOnly !== true
    || (entity.kind === "npc" && (entity.relation === "enemy" || entity.relation === "neutral"));
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
}

/** ADR 0091 §3: outside an encounter an ability picked on the map becomes the
 * player's own sentence, put in the composer for the player to send. */
export function intentSentence(ability: CombatControlAbility, targetNames: string[]): string {
  const targets = joinNames(targetNames);
  if (ability.group === "attack" || (ability.group === "basic" && ability.activation === "attack")) {
    const verb = ability.name.endsWith("攻击") ? `我${ability.name}` : `我用${ability.name}攻击`;
    return `${verb}${targets || "目标"}。`;
  }
  const act = ability.group === "spell" ? "施放" : "使用";
  if (ability.target.kind === "self") return `我对自己${act}${ability.name}。`;
  if (ability.target.kind === "area") return targets ? `我朝${targets}${act}${ability.name}。` : `我${act}${ability.name}。`;
  return targets ? `我对${targets}${act}${ability.name}。` : `我${act}${ability.name}。`;
}

export const ACTIVATION_LABEL: Record<CombatControlAbility["activation"], string> = {
  action: "动作",
  bonusAction: "附赠动作",
  attack: "攻击",
  free: "不占动作",
};

export function abilityDetail(ability: CombatControlAbility): string {
  const spell = ability.spellLevel === 0 ? "戏法" : ability.slotLevel ? `${ability.slotLevel}环法术位` : null;
  return [ACTIVATION_LABEL[ability.activation], spell].filter(Boolean).join(" · ");
}

/** An area's size and shape in words: a 20-foot-radius sphere, a 15-foot
 * cube or cone, a 100-foot line 5 feet wide. */
export function areaShapeLabel(target: Extract<CombatControlAbility["target"], { kind: "area" }>): string {
  switch (target.shape) {
    case "sphere": return `半径 ${target.sizeFeet} 尺的球形`;
    case "cylinder": return `半径 ${target.sizeFeet} 尺的圆柱`;
    case "cube": return `${target.sizeFeet} 尺立方`;
    case "cone": return `${target.sizeFeet} 尺锥形`;
    case "line": return `${target.sizeFeet} 尺长、${target.widthFeet ?? 5} 尺宽的线形`;
  }
}

export function targetHint(ability: CombatControlAbility): string {
  const target = ability.target;
  if (target.kind === "creatures") {
    const distance = target.reachFeet !== undefined
      ? `触及 ${target.reachFeet} 尺`
      : target.rangeFeet !== undefined
        ? `射程 ${target.rangeFeet}${target.longRangeFeet ? `/${target.longRangeFeet}` : ""} 尺`
        : null;
    return [`选 ${target.count === 1 ? "1 个" : `至多 ${target.count} 个`}目标`, distance].filter(Boolean).join(" · ");
  }
  if (target.kind === "area") {
    const origin = target.origin === "self"
      ? target.needsDirection ? "从你身边发出" : "以你为中心" : `在 ${target.rangeFeet ?? 0} 尺内点选位置`;
    return `${areaShapeLabel(target)} · ${origin}${target.needsDirection ? "，再点方向" : ""}`;
  }
  if (target.kind === "help") return "选一名同伴；攻击时再选你身边 5 尺内的敌人";
  if (target.kind === "ready") return "选触发的人和时机，再选那时要做的事";
  return target.kind === "self" ? "作用于自己" : "无需目标";
}

export function entitySelectionKey(entityId: string): string {
  return `entity:${entityId}`;
}

/** What the player is picking now, shared by the map, the action list and the
 * bar above the composer. */
export type TacticalTaskControl = {
  task: MapTask;
  setTask: (task: MapTask) => void;
  cursor: MapPoint | null;
  setCursor: (cursor: MapPoint | null) => void;
};

/** The map gestures of one task: which clicks pick a ground point and what a
 * picked point or an activated creature means for the task. */
export function mapGestures(
  projection: TacticalProjection,
  interaction: TacticalTaskControl | undefined,
  onSelect: (key: string) => void,
) {
  const task = interaction?.task ?? IDLE_TASK;
  const { inEncounter } = playerEncounter(projection);
  const groundPick = interaction !== undefined && !inEncounter && (task.kind === "idle" || task.kind === "destination");
  const pointPick = interaction !== undefined && taskPicksPoint(task);
  // SPEC 0012 §6.3 (ADR 0097 decision 4): an attack picks a creature from its
  // token, or a point on the ground where the player guesses an unseen one is.
  const aimPick = interaction !== undefined && task.kind === "creatures" && task.purpose === "combat" && aimable(task.ability);

  function pickPoint(raw: MapPoint) {
    if (interaction === undefined) return;
    const step = pickStep(projection);
    const point = clampToScene({ x: snapToGrid(raw.x, step), y: snapToGrid(raw.y, step) }, projection);
    if (task.kind === "creatures" && aimPick) {
      interaction.setTask({ ...task, refs: [], point });
      return;
    }
    if (task.kind === "path") {
      if (task.waypoints.length < MAX_PATH_WAYPOINTS) interaction.setTask({ ...task, waypoints: [...task.waypoints, point] });
      return;
    }
    if (task.kind === "area") {
      if (task.origin === null) interaction.setTask({ ...task, origin: point });
      // A direction is the way from the area's origin to a second point.
      else if (point.x !== task.origin.x || point.y !== task.origin.y) interaction.setTask({ ...task, direction: point });
      return;
    }
    if (groundPick) interaction.setTask({ kind: "destination", point });
  }

  function activateEntity(entity: TacticalEntity) {
    onSelect(entitySelectionKey(entity.id));
    if (interaction === undefined) return;
    if (task.kind === "creatures") {
      if (!creaturePickable(task.ability, entity)) return;
      // SPEC 0014 §7 (ADR 0148): on the player's turn a creature Rules
      // listed as out of reach is not picked.
      if (task.purpose === "combat" && reachOf(task.ability, entity.id) === "out") return;
      const count = task.ability.target.kind === "creatures" ? task.ability.target.count : 1;
      const refs = task.refs.includes(entity.id)
        ? task.refs.filter((ref) => ref !== entity.id)
        : count === 1 ? [entity.id] : task.refs.length < count ? [...task.refs, entity.id] : task.refs;
      interaction.setTask({ ...task, refs, point: null });
    } else if (task.kind === "help" && task.ability.target.kind === "help") {
      // SPEC 0012 §6.3 (ADR 0099 decision 1): the ally to help, then for an
      // attack the enemy within 5 feet.
      if (task.ability.target.allyRefs.includes(entity.id)) interaction.setTask({ ...task, allyRef: entity.id });
      else if (task.mode === "attack" && task.ability.target.enemyRefs.includes(entity.id)) interaction.setTask({ ...task, enemyRef: entity.id });
    } else if (task.kind === "ready" && task.ability.target.kind === "ready") {
      if (task.ability.target.triggerRefs.includes(entity.id)) interaction.setTask({ ...task, triggerRef: entity.id });
    } else if (task.kind === "intent" && task.ability.target.kind === "area"
      && (task.ability.target.origin === "point" || task.ability.target.needsDirection)) {
      // A cube, cone or line from the player is aimed at someone too (ADR 0149).
      interaction.setTask({ ...task, aimRef: entity.id });
    } else if (pointPick) {
      // Keyboard users pick a creature's spot from its token.
      pickPoint({ x: inches(entity.position.x), y: inches(entity.position.y) });
    }
  }

  return { groundPick, pointPick, aimPick, pickPoint, activateEntity };
}

/** SPEC 0006 §7 (ADR 0101): an NPC's combat turn in progress, or waiting. */
export const NPC_TURN_LABEL: Readonly<Record<NpcCombatTurnStatus["state"], string>> = {
  acting: "正在行动", waitingForAnswer: "等待回答", waitingForRetry: "没能完成，下次行动时重试",
};
