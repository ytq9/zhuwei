import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  tacticalTerrainPhrases,
  type CombatAbilityTarget,
  type TacticalEntity,
  type TacticalKnownFeature,
  type TacticalPosition,
  type TacticalProjection,
  type TacticalZone,
} from "@/lib/rules/tactical-projection";
import type { CombatControlAbility } from "@/lib/table/authoritative";
import type { TacticalMapActions } from "@/components/tactical-map-actions";
import { cn } from "@/lib/utils";

const FEATURE_STYLE: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "fill-stone-500/45 stroke-stone-200",
  terrain: "fill-brass/20 stroke-amber-300",
  interactable: "fill-primary/15 stroke-primary/80",
  destructible: "fill-danger/35 stroke-red-200",
  portal: "fill-moss/45 stroke-emerald-100",
};

const RELATION_STYLE: Record<TacticalEntity["relation"], string> = {
  self: "fill-brass/80 stroke-white",
  ally: "fill-moss/85 stroke-emerald-100",
  enemy: "fill-danger/75 stroke-red-100",
  neutral: "fill-stone-500/75 stroke-stone-100",
};

const ZONE_STYLE = "fill-violet-600/25 stroke-violet-200";

const FEATURE_KIND_LABEL: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "屏障",
  terrain: "地形",
  interactable: "可互动物",
  destructible: "可破坏物",
  portal: "门或通路",
};

const RELATION_LABEL: Record<TacticalEntity["relation"], string> = {
  self: "自己",
  ally: "盟友",
  enemy: "敌对",
  neutral: "中立",
};

const COVER_LABEL: Record<TacticalKnownFeature["cover"], string> = {
  none: "无掩护",
  half: "半掩护",
  threeQuarters: "四分之三掩护",
  full: "全掩护",
};

const COVER_MARK: Record<TacticalKnownFeature["cover"], string | null> = {
  none: null,
  half: "½",
  threeQuarters: "¾",
  full: "全",
};

const TERRAIN_LABEL: Record<TacticalKnownFeature["terrain"], string> = {
  normal: "普通地面",
  rubble: "瓦砾地形",
};

const TACTICAL_STATE_LABEL: Record<string, string> = {
  active: "生效中",
  alive: "正常",
  closed: "关闭",
  dead: "死亡",
  destroyed: "已摧毁",
  difficult: "困难地形",
  disabled: "已失效",
  intact: "完整",
  open: "开启",
  triggered: "已触发",
  unconscious: "昏迷",
};

const CONDITION_LABEL: Record<string, string> = {
  blinded: "目盲",
  charmed: "魅惑",
  deafened: "耳聋",
  dodging: "闪避",
  frightened: "恐慌",
  grappled: "被擒抱",
  grappledBy: "被擒抱",
  hidden: "躲藏中",
  incapacitated: "失能",
  invisible: "隐形",
  paralyzed: "麻痹",
  petrified: "石化",
  poisoned: "中毒",
  prone: "倒地",
  restrained: "束缚",
  stable: "伤势稳定",
  stunned: "震慑",
  unconscious: "昏迷",
};

const EFFECT_LABEL: Record<string, string> = {
  "heavily-obscured": "重度遮蔽",
};

type TacticalView = "map" | "text";

type TacticalSelection =
  | { kind: "entity"; value: TacticalEntity }
  | { kind: "feature"; value: TacticalKnownFeature }
  | { kind: "zone"; value: TacticalZone };

/** A point the player picked on the map, in whole inches. */
type MapPoint = { x: number; y: number };

/** SPEC 0014 §§4、5、8: what the player is putting together on the map. The
 * map only collects the player's picks; Rules decides paths, ranges, cover
 * and who an area affects. */
type MapTask =
  | { kind: "idle" }
  | { kind: "destination"; point: MapPoint }
  | { kind: "path"; waypoints: MapPoint[] }
  | { kind: "creatures"; ability: CombatControlAbility; refs: string[]; purpose: "combat" | "intent" }
  | { kind: "area"; ability: CombatControlAbility; origin: MapPoint | null; direction: MapPoint | null }
  | { kind: "intent"; ability: CombatControlAbility; aimRef: string | null };

const IDLE_TASK: MapTask = { kind: "idle" };

/** At most 64 points per path, the first being where the actor stands. */
const MAX_PATH_WAYPOINTS = 63;

function inches(value: string): number {
  return Number(value);
}

/** Display-only snapping to the 5-foot grid (SPEC 0014 §2.1); the submitted
 * point is the snapped whole-inch point. */
function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function sceneBounds(projection: TacticalProjection) {
  const xs = projection.scene.boundary.points.map((point) => inches(point.x));
  const ys = projection.scene.boundary.points.map((point) => inches(point.y));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function clampToScene(point: MapPoint, projection: TacticalProjection): MapPoint {
  const bounds = sceneBounds(projection);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
  };
}

function selfPoint(projection: TacticalProjection): MapPoint {
  return { x: inches(projection.self.position.x), y: inches(projection.self.position.y) };
}

function mapPosition(point: MapPoint, elevation: string): TacticalPosition {
  return { x: String(point.x), y: String(point.y), elevation };
}

function playerEncounter(projection: TacticalProjection) {
  const encounter = projection.encounter;
  const inEncounter = encounter !== null
    && encounter.status !== "concluded"
    && encounter.participantEntityIds.includes(projection.self.id);
  return { inEncounter, myTurn: inEncounter && encounter?.activeEntityId === projection.self.id };
}

/** Whether a click on the map ground picks a point in this task. */
function taskPicksPoint(task: MapTask): boolean {
  return task.kind === "path"
    || (task.kind === "area"
      && (task.origin === null || (task.ability.target.kind === "area" && task.ability.target.needsDirection && task.direction === null)));
}

/** Whether the ability lets the player pick this creature at all. Grapple
 * and shove against a player need that player's own answer, so the map offers
 * them only against non-player creatures that are not allies. */
function creaturePickable(ability: CombatControlAbility, entity: TacticalEntity): boolean {
  // An attack is never aimed at the attacker.
  if (entity.relation === "self" && (ability.group === "attack" || ability.activation === "attack")) return false;
  return ability.target.kind !== "creatures" || ability.target.npcOpponentsOnly !== true
    || (entity.kind === "npc" && (entity.relation === "enemy" || entity.relation === "neutral"));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
}

/** ADR 0091 §3: outside an encounter an ability picked on the map is sent to
 * the KP as a plain player intent. */
function intentSentence(ability: CombatControlAbility, targetNames: string[]): string {
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

const ACTIVATION_LABEL: Record<CombatControlAbility["activation"], string> = {
  action: "动作",
  bonusAction: "附赠动作",
  attack: "攻击",
  free: "不占动作",
};

function abilityDetail(ability: CombatControlAbility): string {
  const spell = ability.spellLevel === 0 ? "戏法" : ability.slotLevel ? `${ability.slotLevel}环法术位` : null;
  return [ACTIVATION_LABEL[ability.activation], spell].filter(Boolean).join(" · ");
}

function targetHint(ability: CombatControlAbility): string {
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
    const origin = target.origin === "self" ? "从你所在处出发" : `在 ${target.rangeFeet ?? 0} 尺内点选位置`;
    return `${target.sizeFeet} 尺范围 · ${origin}${target.needsDirection ? "，再点方向" : ""}`;
  }
  return target.kind === "self" ? "作用于自己" : "无需目标";
}

function formatLength(value: string): string {
  const totalInches = BigInt(value);
  const absoluteInches = totalInches < 0n ? -totalInches : totalInches;
  const feet = absoluteInches / 12n;
  const remainingInches = absoluteInches % 12n;
  const sign = totalInches < 0n ? "-" : "";
  if (feet === 0n) return `${sign}${remainingInches} 英寸`;
  return remainingInches === 0n
    ? `${sign}${feet} 尺`
    : `${sign}${feet} 尺 ${remainingInches} 英寸`;
}

function formatElevation(value: string): string {
  if (value === "0") return "地面";
  return BigInt(value) > 0n ? `+${formatLength(value)}` : formatLength(value);
}

function mapElevationLabel(value: string): string | null {
  if (value === "0") return null;
  const elevation = BigInt(value);
  const sign = elevation > 0n ? "+" : "-";
  const absolute = elevation > 0n ? elevation : -elevation;
  const feet = absolute / 12n;
  const remainingInches = absolute % 12n;
  if (feet === 0n) return `${sign}${remainingInches}寸`;
  return remainingInches === 0n
    ? `${sign}${feet}尺`
    : `${sign}${feet}尺${remainingInches}寸`;
}

function formatTacticalState(value: string): string {
  return TACTICAL_STATE_LABEL[value] ?? value;
}

function formatPublicState(value: string): string {
  const separator = value.indexOf(":");
  if (separator === -1) return CONDITION_LABEL[value] ?? value;
  const kind = value.slice(0, separator);
  const state = value.slice(separator + 1);
  if (kind === "life") return TACTICAL_STATE_LABEL[state] ?? state;
  if (kind === "condition") return CONDITION_LABEL[state] ?? state;
  return value;
}

function formatEffectTag(value: string): string {
  return EFFECT_LABEL[value] ?? value;
}

function polygonPoints(points: Array<{ x: string; y: string }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function polygonCenter(points: Array<{ x: string; y: string }>): { x: number; y: number } {
  const sum = points.reduce(
    (current, point) => ({
      x: current.x + inches(point.x),
      y: current.y + inches(point.y),
    }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function featureMechanics(feature: TacticalKnownFeature): string[] {
  return [
    feature.impassable ? "阻挡移动" : "不阻挡移动",
    feature.opaque ? "阻挡视线" : "不阻挡视线",
    COVER_LABEL[feature.cover],
    feature.propagation === "blocks" ? "阻断区域传播" : "允许区域传播",
    TERRAIN_LABEL[feature.terrain],
    // SPEC 0014 §4 (ADR 0098): what the ground is and what it is made of.
    ...tacticalTerrainPhrases(feature),
  ];
}

function entityMapLabel(entity: TacticalEntity): string {
  return entity.relation === "self" ? "我" : Array.from(entity.name).slice(0, 2).join("");
}

function entitySelectionKey(entityId: string): string {
  return `entity:${entityId}`;
}

function featureSelectionKey(featureId: string): string {
  return `feature:${featureId}`;
}

function zoneSelectionKey(zoneId: string): string {
  return `zone:${zoneId}`;
}

function resolveSelection(
  projection: TacticalProjection,
  selectedKey: string | null,
): TacticalSelection | null {
  if (!selectedKey) return null;
  if (selectedKey.startsWith("entity:")) {
    const entityId = selectedKey.slice("entity:".length);
    const entity = [projection.self, ...projection.visibleEntities]
      .find((candidate) => candidate.id === entityId);
    return entity ? { kind: "entity", value: entity } : null;
  }
  if (selectedKey.startsWith("feature:")) {
    const featureId = selectedKey.slice("feature:".length);
    const feature = projection.knownFeatures.find((candidate) => candidate.id === featureId);
    return feature ? { kind: "feature", value: feature } : null;
  }
  if (selectedKey.startsWith("zone:")) {
    const zoneId = selectedKey.slice("zone:".length);
    const zone = projection.knownZones.find((candidate) => candidate.id === zoneId);
    return zone ? { kind: "zone", value: zone } : null;
  }
  return null;
}

function initialSelectionKey(projection: TacticalProjection): string {
  const activeEntityId = projection.encounter?.activeEntityId;
  const activeEntity = activeEntityId
    ? [projection.self, ...projection.visibleEntities]
      .find((candidate) => candidate.id === activeEntityId)
    : undefined;
  return entitySelectionKey(activeEntity?.id ?? projection.self.id);
}

function activateOnKeyboard(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function TacticalEntityMark({
  entity,
  currentActor,
  selected,
  targeted = false,
  passThrough = false,
  onSelect,
}: {
  entity: TacticalEntity;
  currentActor: boolean;
  selected: boolean;
  targeted?: boolean;
  /** While the player picks a point, a pointer click reaches the ground. */
  passThrough?: boolean;
  onSelect: () => void;
}) {
  const x = inches(entity.position.x);
  const y = inches(entity.position.y);
  const width = inches(entity.footprint.width);
  const depth = inches(entity.footprint.depth);
  const mapLabel = entityMapLabel(entity);
  const elevationLabel = mapElevationLabel(entity.position.elevation);
  const title = `${entity.name}${currentActor ? "；当前行动" : ""}；占位 ${entity.footprint.width}×${entity.footprint.depth} 英寸；高程 ${formatElevation(entity.position.elevation)}；高度 ${formatLength(entity.footprint.height)}`;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${entity.name}的战术详情`}
      aria-pressed={selected}
      data-entity-id={entity.id}
      data-relation={entity.relation}
      data-position-x={entity.position.x}
      data-position-y={entity.position.y}
      data-footprint-width={entity.footprint.width}
      data-footprint-depth={entity.footprint.depth}
      data-elevation-inches={entity.position.elevation}
      data-height-inches={entity.footprint.height}
      data-current-actor={String(currentActor)}
      data-map-label={mapLabel}
      data-selected={String(selected)}
      data-targeted={String(targeted)}
      className={cn(
        RELATION_STYLE[entity.relation],
        "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass",
        passThrough && "pointer-events-none",
      )}
      onClick={onSelect}
      onKeyDown={(event) => activateOnKeyboard(event, onSelect)}
    >
      <title>{title}</title>
      {targeted ? (
        <circle
          cx={x}
          cy={y}
          r={Math.max(width, depth) / 2 + 26}
          fill="none"
          className="pointer-events-none stroke-red-300 stroke-[6] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      <rect
        x={x - width / 2}
        y={y - depth / 2}
        width={width}
        height={depth}
        rx={Math.min(width, depth) / 5}
        className="stroke-[8] [vector-effect:non-scaling-stroke]"
      />
      {currentActor ? (
        <rect
          x={x - width / 2 - 10}
          y={y - depth / 2 - 10}
          width={width + 20}
          height={depth + 20}
          rx={Math.min(width, depth) / 4}
          fill="none"
          className="stroke-brass stroke-[6] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      {selected ? (
        <rect
          x={x - width / 2 - 18}
          y={y - depth / 2 - 18}
          width={width + 36}
          height={depth + 36}
          rx={Math.min(width, depth) / 3}
          fill="none"
          className="stroke-white/90 stroke-[5] [stroke-dasharray:12_8] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="pointer-events-none fill-white stroke-black/70 text-[28px] font-semibold [paint-order:stroke] [stroke-width:6px]"
      >
        {mapLabel}
      </text>
      {elevationLabel ? (
        <text
          x={x + width / 2 + 10}
          y={y - depth / 2 - 8}
          textAnchor="start"
          className="pointer-events-none fill-primary stroke-black/80 text-[20px] font-semibold [paint-order:stroke] [stroke-width:5px]"
        >
          {elevationLabel}
        </text>
      ) : null}
    </g>
  );
}

function TacticalFeatureShape({
  feature,
  selected,
  passThrough = false,
  onSelect,
  opaquePatternId,
  propagationPatternId,
}: {
  feature: TacticalKnownFeature;
  selected: boolean;
  passThrough?: boolean;
  onSelect: () => void;
  opaquePatternId: string;
  propagationPatternId: string;
}) {
  const mechanics = featureMechanics(feature);
  const center = polygonCenter(feature.polygon);
  const coverMark = COVER_MARK[feature.cover];
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${feature.label}的战术详情`}
      aria-pressed={selected}
      data-feature-id={feature.id}
      data-feature-kind={feature.kind}
      data-feature-state={feature.state}
      data-impassable={String(feature.impassable)}
      data-opaque={String(feature.opaque)}
      data-cover={feature.cover}
      data-propagation={feature.propagation}
      data-terrain={feature.terrain}
      data-elevation-inches={feature.elevation}
      data-height-inches={feature.height}
      data-selected={String(selected)}
      className={cn(
        FEATURE_STYLE[feature.kind],
        "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass",
        passThrough && "pointer-events-none",
      )}
      onClick={onSelect}
      onKeyDown={(event) => activateOnKeyboard(event, onSelect)}
    >
      <title>{`${feature.label}；状态 ${formatTacticalState(feature.state)}；${mechanics.join("；")}；高程 ${formatElevation(feature.elevation)}；高度 ${formatLength(feature.height)}`}</title>
      <polygon
        points={polygonPoints(feature.polygon)}
        data-movement-encoding={feature.impassable ? "solid" : "dashed"}
        className={cn(
          "stroke-[8] [vector-effect:non-scaling-stroke]",
          !feature.impassable && "[stroke-dasharray:24_14]",
        )}
      />
      {feature.opaque ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          data-vision-encoding="diagonal-hatch"
          fill={`url(#${opaquePatternId})`}
          className="pointer-events-none stroke-none"
        />
      ) : null}
      {feature.propagation === "blocks" ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          data-propagation-encoding="dot-hatch"
          fill={`url(#${propagationPatternId})`}
          className="pointer-events-none stroke-none"
        />
      ) : null}
      {coverMark ? (
        <g
          data-cover-encoding={feature.cover}
          className="pointer-events-none"
        >
          <circle
            cx={center.x}
            cy={center.y}
            r={20}
            className="fill-[#0d0b0a] stroke-white/80 stroke-[3] [vector-effect:non-scaling-stroke]"
          />
          <text
            x={center.x}
            y={center.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-white text-[22px] font-semibold"
          >
            {coverMark}
          </text>
        </g>
      ) : null}
      {selected ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          fill="none"
          className="pointer-events-none stroke-white stroke-[14] [stroke-dasharray:18_10] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
    </g>
  );
}

function TacticalZoneShape({
  zone,
  selected,
  passThrough = false,
  onSelect,
}: {
  zone: TacticalZone;
  selected: boolean;
  passThrough?: boolean;
  onSelect: () => void;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${zone.label}的战术详情`}
      aria-pressed={selected}
      data-zone-id={zone.id}
      data-zone-state={zone.state}
      data-elevation-inches={zone.geometry.elevation}
      data-height-inches={zone.geometry.height}
      data-selected={String(selected)}
      className={cn(
        ZONE_STYLE,
        "cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass",
        passThrough && "pointer-events-none",
      )}
      onClick={onSelect}
      onKeyDown={(event) => activateOnKeyboard(event, onSelect)}
    >
      <title>{`${zone.label}；状态 ${formatTacticalState(zone.state)}；高程 ${formatElevation(zone.geometry.elevation)}；高度 ${formatLength(zone.geometry.height)}`}</title>
      <polygon
        points={polygonPoints(zone.geometry.points)}
        className={cn(
          "stroke-[6] [stroke-dasharray:18_12] [vector-effect:non-scaling-stroke]",
          selected && "stroke-white stroke-[12]",
        )}
      />
    </g>
  );
}

function encounterReadout(projection: TacticalProjection): string {
  if (projection.encounter === null) return "当前遭遇信息未知";
  if (projection.encounter.status === "concluded") return "遭遇已收束";
  const entities = [projection.self, ...projection.visibleEntities];
  const activeEntity = projection.encounter.activeEntityId
    ? entities.find((entity) => entity.id === projection.encounter?.activeEntityId)
    : undefined;
  if (!activeEntity) return `第 ${projection.encounter.round} 轮 · 当前行动者未知`;
  return activeEntity.id === projection.self.id
    ? `第 ${projection.encounter.round} 轮 · 轮到你`
    : `第 ${projection.encounter.round} 轮 · 当前行动：${activeEntity.name}`;
}

export function TacticalMap({
  projection,
  defaultExpanded = false,
  actions,
}: {
  projection: TacticalProjection | null | undefined;
  defaultExpanded?: boolean;
  /** Without actions the map only shows the projection. */
  actions?: TacticalMapActions;
}) {
  const baseId = useId().replace(/:/g, "");
  const desktopContentId = `tactical-map-${baseId}-desktop`;
  const mobileDialogId = `tactical-map-${baseId}-mobile`;
  const mobileTitleId = `${mobileDialogId}-title`;
  const desktopTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileReturnFocusRef = useRef<"mobile" | "desktop">("mobile");
  const [desktopExpanded, setDesktopExpanded] = useState(
    Boolean(projection) && defaultExpanded,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [view, setView] = useState<TacticalView>("map");
  const [selectedKey, setSelectedKey] = useState<string | null>(
    projection ? initialSelectionKey(projection) : null,
  );
  const isDesktopExpanded = Boolean(projection) && desktopExpanded;
  const isMobileOpen = Boolean(projection) && mobileOpen;
  const status = projection
    ? encounterReadout(projection)
    : "尚无观察者可见的战术地图数据";
  // A pick started on one turn never carries into the next one.
  const turnKey = projection?.encounter
    ? `${projection.encounter.id}:${projection.encounter.round}:${projection.encounter.activeEntityId ?? ""}`
    : "exploration";
  const [taskState, setTaskState] = useState<{ key: string; task: MapTask }>({ key: turnKey, task: IDLE_TASK });
  const task = taskState.key === turnKey ? taskState.task : IDLE_TASK;
  const [cursor, setCursor] = useState<MapPoint | null>(null);
  const setTask = (next: MapTask) => {
    setTaskState({ key: turnKey, task: next });
    // The keyboard cursor starts again from the player for a new kind of pick.
    const family = (candidate: MapTask) => candidate.kind === "destination" ? "idle" : candidate.kind;
    if (family(next) !== family(task)) setCursor(null);
  };
  const interaction: TacticalInteraction | undefined = actions
    ? { actions, task, setTask, cursor, setCursor }
    : undefined;

  useEffect(() => {
    if (!isMobileOpen || typeof window === "undefined") return;
    const dialog = mobileDialogRef.current;
    if (!dialog) return;
    const desktopViewport = window.matchMedia("(min-width: 64rem)");
    const desktopTrigger = desktopTriggerRef.current;
    const mobileTrigger = mobileTriggerRef.current;
    if (desktopViewport.matches) {
      const closeFrame = window.requestAnimationFrame(() => {
        setMobileOpen(false);
        desktopTrigger?.focus();
      });
      return () => window.cancelAnimationFrame(closeFrame);
    }
    const previouslyFocused = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileCloseRef.current?.focus();

    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )).filter((element) => element.getClientRects().length > 0);
    const containKeyboardFocus = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const closeAtDesktopBreakpoint = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      mobileReturnFocusRef.current = "desktop";
      setMobileOpen(false);
    };
    window.addEventListener("keydown", containKeyboardFocus);
    desktopViewport.addEventListener("change", closeAtDesktopBreakpoint);
    return () => {
      window.removeEventListener("keydown", containKeyboardFocus);
      desktopViewport.removeEventListener("change", closeAtDesktopBreakpoint);
      document.body.style.overflow = previousBodyOverflow;
      const preferredFocus = mobileReturnFocusRef.current === "desktop"
        ? desktopTrigger
        : mobileTrigger;
      if (
        preferredFocus?.isConnected
        && preferredFocus.getClientRects().length > 0
      ) {
        preferredFocus.focus();
      } else if (
        previouslyFocused instanceof HTMLElement
        && previouslyFocused.isConnected
        && previouslyFocused.getClientRects().length > 0
      ) {
        previouslyFocused.focus();
      }
      mobileReturnFocusRef.current = "mobile";
    };
  }, [isMobileOpen]);

  return (
    <section
      data-tactical-map-disclosure={projection ? "ready" : "unknown"}
      aria-label="战术地图"
      className="min-w-0 max-w-full shrink-0 border-b border-border bg-bg/45"
    >
      <div className="px-4 py-2.5">
        <button
          ref={desktopTriggerRef}
          type="button"
          data-tactical-disclosure-trigger="desktop"
          aria-expanded={isDesktopExpanded}
          aria-controls={desktopContentId}
          disabled={!projection}
          onClick={() => setDesktopExpanded((current) => !current)}
          className="hidden min-w-0 w-full items-center justify-between gap-4 rounded-[12px] border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70 lg:flex"
        >
          <span className="min-w-0">
            <span className="block truncate font-display text-sm">
              战术地图{projection ? ` · ${projection.scene.name}` : "暂不可用"}
            </span>
            <span className="block truncate text-[11px] text-subtle">{status}</span>
          </span>
          <span className="shrink-0 text-xs text-brass">
            {projection ? (isDesktopExpanded ? "收起" : "展开") : "暂不可用"}
          </span>
        </button>

        <button
          ref={mobileTriggerRef}
          type="button"
          data-tactical-disclosure-trigger="mobile"
          aria-expanded={isMobileOpen}
          aria-controls={mobileDialogId}
          aria-haspopup="dialog"
          disabled={!projection}
          onClick={() => {
            mobileReturnFocusRef.current = "mobile";
            setMobileOpen(true);
          }}
          className="flex min-w-0 w-full items-center justify-between gap-3 rounded-[12px] border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70 lg:hidden"
        >
          <span className="min-w-0">
            <span className="block truncate font-display text-sm">
              地图{projection ? ` · ${projection.scene.name}` : "暂不可用"}
            </span>
            <span className="block truncate text-[11px] text-subtle">{status}</span>
          </span>
          <span className="shrink-0 text-xs text-brass">
            {projection ? "打开" : "暂不可用"}
          </span>
        </button>
      </div>

      <div
        id={desktopContentId}
        hidden={!isDesktopExpanded}
        className="hidden lg:block"
      >
        {isDesktopExpanded && projection ? (
          <TacticalMapExpanded
            projection={projection}
            instanceId={`${baseId}-desktop`}
            view={view}
            selectedKey={selectedKey}
            onViewChange={setView}
            onSelect={setSelectedKey}
            interaction={interaction}
          />
        ) : null}
      </div>

      {isMobileOpen && projection ? (
        <div
          ref={mobileDialogRef}
          id={mobileDialogId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={mobileTitleId}
          tabIndex={-1}
          data-tactical-map-mobile="open"
          className="fixed inset-0 z-[70] flex min-h-0 flex-col bg-bg lg:hidden"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p id={mobileTitleId} className="truncate font-display text-base">
                {projection.scene.name}战术地图
              </p>
              <p className="truncate text-xs text-brass">{status}</p>
            </div>
            <button
              ref={mobileCloseRef}
              type="button"
              aria-label="关闭战术地图"
              onClick={() => setMobileOpen(false)}
              className="shrink-0 rounded-[10px] border border-border px-3 py-2 text-sm text-fg hover:bg-elevated"
            >
              关闭
            </button>
          </header>
          <TacticalMapExpanded
            projection={projection}
            instanceId={`${baseId}-mobile`}
            view={view}
            selectedKey={selectedKey}
            onViewChange={setView}
            onSelect={setSelectedKey}
            interaction={interaction}
            mobile
          />
        </div>
      ) : null}
    </section>
  );
}

type TacticalInteraction = {
  actions: TacticalMapActions;
  task: MapTask;
  setTask: (task: MapTask) => void;
  cursor: MapPoint | null;
  setCursor: (cursor: MapPoint | null) => void;
};

/** The map gestures of one task: which clicks pick a ground point and what a
 * picked point or an activated creature means for the task. */
function mapGestures(
  projection: TacticalProjection,
  interaction: TacticalInteraction | undefined,
  onSelect: (key: string) => void,
) {
  const task = interaction?.task ?? IDLE_TASK;
  const { inEncounter } = playerEncounter(projection);
  const groundPick = interaction !== undefined && !inEncounter && (task.kind === "idle" || task.kind === "destination");
  const pointPick = interaction !== undefined && taskPicksPoint(task);

  function pickPoint(raw: MapPoint) {
    if (interaction === undefined) return;
    const grid = projection.scene.gridInches;
    const point = clampToScene({ x: snapToGrid(raw.x, grid), y: snapToGrid(raw.y, grid) }, projection);
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
      const count = task.ability.target.kind === "creatures" ? task.ability.target.count : 1;
      const refs = task.refs.includes(entity.id)
        ? task.refs.filter((ref) => ref !== entity.id)
        : count === 1 ? [entity.id] : task.refs.length < count ? [...task.refs, entity.id] : task.refs;
      interaction.setTask({ ...task, refs });
    } else if (task.kind === "intent" && task.ability.target.kind === "area" && task.ability.target.origin === "point") {
      interaction.setTask({ ...task, aimRef: entity.id });
    } else if (pointPick) {
      // Keyboard users pick a creature's spot from its token.
      pickPoint({ x: inches(entity.position.x), y: inches(entity.position.y) });
    }
  }

  return { groundPick, pointPick, pickPoint, activateEntity };
}

function TacticalMapExpanded({
  projection,
  instanceId,
  view,
  selectedKey,
  onViewChange,
  onSelect,
  interaction,
  mobile = false,
}: {
  projection: TacticalProjection;
  instanceId: string;
  view: TacticalView;
  selectedKey: string | null;
  onViewChange: (view: TacticalView) => void;
  onSelect: (key: string) => void;
  interaction?: TacticalInteraction;
  mobile?: boolean;
}) {
  const selected = resolveSelection(projection, selectedKey)
    ?? { kind: "entity" as const, value: projection.self };
  const effectiveSelectedKey = selected.kind === "entity"
    ? entitySelectionKey(selected.value.id)
    : selected.kind === "feature"
      ? featureSelectionKey(selected.value.id)
      : zoneSelectionKey(selected.value.id);
  const gestures = mapGestures(projection, interaction, onSelect);

  return (
    <section
      data-tactical-map="v1"
      data-tactical-layout={mobile ? "mobile-dialog" : "desktop-inline"}
      data-tactical-view={view}
      className={cn(
        "min-w-0 max-w-full",
        mobile ? "min-h-0 flex-1 overflow-y-auto p-3" : "px-4 pb-3",
      )}
    >
      <div className="mx-auto grid w-full max-w-[58rem] gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex items-center justify-between gap-3 lg:col-span-2">
          <div
            role="tablist"
            aria-label="战术地图显示方式"
            className="inline-flex rounded-[10px] border border-border bg-surface p-1"
          >
            {(["map", "text"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                data-tactical-view-trigger={candidate}
                aria-selected={view === candidate}
                onClick={() => onViewChange(candidate)}
                className={cn(
                  "rounded-[7px] px-3 py-1.5 text-xs transition-colors",
                  view === candidate
                    ? "bg-elevated text-fg"
                    : "text-subtle hover:text-fg",
                )}
              >
                {candidate === "map" ? "地图" : "文字版"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-subtle">
            观察者投影 · 每格 {formatLength(String(projection.scene.gridInches))}
          </p>
        </div>

        {view === "map" ? (
          <>
            <TacticalMapCanvas
              projection={projection}
              instanceId={instanceId}
              selectedKey={effectiveSelectedKey}
              onSelect={onSelect}
              interaction={interaction}
              gestures={gestures}
            />
            <aside
              data-tactical-detail="v1"
              className="flex min-w-0 flex-col gap-3 rounded-[16px] border border-border bg-surface p-3 lg:h-[min(28dvh,17rem)] lg:overflow-y-auto"
            >
              <SelectedTacticalDetail
                projection={projection}
                selected={selected}
              />
              <TacticalLegend />
              <div className="mt-auto space-y-1 border-t border-border pt-2 text-[11px] text-subtle">
                <p data-tactical-features={projection.knownFeatures.length > 0 ? "known" : "unknown"}>
                  {projection.knownFeatures.length > 0
                    ? `已知环境要素 ${projection.knownFeatures.length} 项`
                    : "尚无已知环境要素；未投影内容保持未知。"}
                </p>
                <p data-tactical-zones={projection.knownZones.length > 0 ? "known" : "unknown"}>
                  {projection.knownZones.length > 0
                    ? `已知区域效果 ${projection.knownZones.length} 项`
                    : "尚无已知区域效果；未投影内容保持未知。"}
                </p>
                <p data-tactical-interactions={interaction ? "enabled" : "view-only"}>
                  {interaction
                    ? "点选人物或物件查看详情；走动和行动在地图下方完成。"
                    : "当前可点选查看详情。"}
                </p>
              </div>
            </aside>
          </>
        ) : (
          <TacticalTextReadout projection={projection} />
        )}
        {interaction ? (
          <TacticalActionPanel
            projection={projection}
            interaction={interaction}
            selected={selected}
            onSelect={onSelect}
            gestures={gestures}
            mapVisible={view === "map"}
          />
        ) : null}
      </div>
    </section>
  );
}

/** The map point under a pointer, in scene inches. */
function svgPointFromEvent(event: MouseEvent<SVGElement>): MapPoint | null {
  const svg = event.currentTarget.ownerSVGElement;
  const matrix = svg?.getScreenCTM();
  if (!svg || !matrix || typeof DOMPoint === "undefined") return null;
  const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? { x: local.x, y: local.y } : null;
}

const CURSOR_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function TacticalMapCanvas({
  projection,
  instanceId,
  selectedKey,
  onSelect,
  interaction,
  gestures,
}: {
  projection: TacticalProjection;
  instanceId: string;
  selectedKey: string;
  onSelect: (key: string) => void;
  interaction?: TacticalInteraction;
  gestures: ReturnType<typeof mapGestures>;
}) {
  const xs = projection.scene.boundary.points.map((point) => inches(point.x));
  const ys = projection.scene.boundary.points.map((point) => inches(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(projection.scene.gridInches, Math.max(...xs) - minX);
  const height = Math.max(projection.scene.gridInches, Math.max(...ys) - minY);
  const gridId = `tactical-grid-${instanceId}-${projection.scene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const opaquePatternId = `${gridId}-opaque`;
  const propagationPatternId = `${gridId}-propagation`;
  const entities = [projection.self, ...projection.visibleEntities];
  const task = interaction?.task ?? IDLE_TASK;
  const picking = gestures.groundPick || gestures.pointPick;
  const targetedIds = new Set(task.kind === "creatures" ? task.refs : task.kind === "intent" && task.aimRef ? [task.aimRef] : []);
  const cursor = picking ? interaction?.cursor ?? null : null;
  const start = selfPoint(projection);
  const grid = projection.scene.gridInches;

  function onCanvasKey(event: KeyboardEvent<SVGSVGElement>) {
    // Tokens and shapes handle their own keys.
    if (!picking || interaction === undefined || event.target !== event.currentTarget) return;
    const delta = CURSOR_KEYS[event.key];
    const base = interaction.cursor ?? { x: snapToGrid(start.x, grid), y: snapToGrid(start.y, grid) };
    if (delta) {
      event.preventDefault();
      interaction.setCursor(clampToScene({ x: base.x + delta[0] * grid, y: base.y + delta[1] * grid }, projection));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      gestures.pickPoint(base);
    }
  }

  return (
    <div
      data-tactical-canvas="v1"
      data-tactical-picking={gestures.pointPick ? task.kind : gestures.groundPick ? "destination" : "none"}
      className="aspect-[4/3] min-w-0 overflow-hidden rounded-[16px] border border-border bg-[#0d0b0a] p-2 lg:h-[min(28dvh,17rem)] lg:aspect-auto"
    >
      <svg
        role="group"
        aria-label={picking
          ? `${projection.scene.name}战术地图；点地图或用方向键移动选点框、按回车选定位置`
          : `${projection.scene.name}战术地图`}
        tabIndex={picking ? 0 : undefined}
        onKeyDown={onCanvasKey}
        width={width}
        height={height}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full max-w-full touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <defs>
          <pattern
            id={gridId}
            data-grid-inches={projection.scene.gridInches}
            width={projection.scene.gridInches}
            height={projection.scene.gridInches}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${projection.scene.gridInches} 0 L 0 0 0 ${projection.scene.gridInches}`}
              fill="none"
              className="stroke-white/12 stroke-[2]"
            />
          </pattern>
          <pattern
            id={opaquePatternId}
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M -7 7 L 7 -7 M 0 28 L 28 0 M 21 35 L 35 21"
              fill="none"
              className="stroke-white/55 stroke-[4]"
            />
          </pattern>
          <pattern
            id={propagationPatternId}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="6" cy="6" r="3" className="fill-white/75" />
            <circle cx="18" cy="18" r="3" className="fill-white/75" />
          </pattern>
        </defs>
        <polygon
          data-scene-boundary={projection.scene.id}
          points={polygonPoints(projection.scene.boundary.points)}
          fill={`url(#${gridId})`}
          className="stroke-brass/80 stroke-[8] [vector-effect:non-scaling-stroke]"
        />
        {interaction ? (
          <rect
            data-tactical-ground
            x={minX}
            y={minY}
            width={width}
            height={height}
            fill="transparent"
            className={picking ? "cursor-crosshair" : "pointer-events-none"}
            onClick={(event) => {
              const point = svgPointFromEvent(event);
              if (point && picking) gestures.pickPoint(point);
            }}
          />
        ) : null}
        {projection.knownZones.map((zone) => {
          const key = zoneSelectionKey(zone.id);
          return (
            <TacticalZoneShape
              key={zone.id}
              zone={zone}
              selected={selectedKey === key}
              passThrough={picking}
              onSelect={() => onSelect(key)}
            />
          );
        })}
        {projection.knownFeatures.map((feature) => {
          const key = featureSelectionKey(feature.id);
          return (
            <TacticalFeatureShape
              key={feature.id}
              feature={feature}
              selected={selectedKey === key}
              // Ground terrain does not stop a click from picking where to go.
              passThrough={gestures.pointPick || (gestures.groundPick && feature.kind === "terrain")}
              onSelect={() => onSelect(key)}
              opaquePatternId={opaquePatternId}
              propagationPatternId={propagationPatternId}
            />
          );
        })}
        {entities.map((entity) => {
          const key = entitySelectionKey(entity.id);
          return (
            <TacticalEntityMark
              key={entity.id}
              entity={entity}
              currentActor={entity.id === projection.encounter?.activeEntityId}
              selected={selectedKey === key}
              targeted={targetedIds.has(entity.id)}
              passThrough={gestures.pointPick}
              onSelect={() => gestures.activateEntity(entity)}
            />
          );
        })}
        {interaction ? <TacticalTaskMarks projection={projection} task={task} cursor={cursor} /> : null}
      </svg>
    </div>
  );
}

/** Where the player's picks are: the destination, the waypoints in order, an
 * area's origin and direction, and the keyboard cursor. These are the
 * player's own picks, not a preview of the result. */
function TacticalTaskMarks({
  projection,
  task,
  cursor,
}: {
  projection: TacticalProjection;
  task: MapTask;
  cursor: MapPoint | null;
}) {
  const grid = projection.scene.gridInches;
  const start = selfPoint(projection);
  return (
    <g data-tactical-task-marks={task.kind} className="pointer-events-none">
      {task.kind === "destination" ? (
        <rect
          data-tactical-destination={`${task.point.x},${task.point.y}`}
          x={task.point.x - grid / 2}
          y={task.point.y - grid / 2}
          width={grid}
          height={grid}
          rx={grid / 6}
          fill="none"
          className="stroke-brass stroke-[6] [stroke-dasharray:14_8] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      {task.kind === "path" && task.waypoints.length > 0 ? (
        <>
          <polyline
            data-tactical-path={[start, ...task.waypoints].map((point) => `${point.x},${point.y}`).join(" ")}
            points={[start, ...task.waypoints].map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            className="stroke-brass stroke-[5] [stroke-dasharray:16_10] [vector-effect:non-scaling-stroke]"
          />
          {task.waypoints.map((point, index) => (
            <g key={`${point.x},${point.y},${index}`}>
              <circle cx={point.x} cy={point.y} r={14} className="fill-brass stroke-black/70 stroke-[3] [vector-effect:non-scaling-stroke]" />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-black text-[16px] font-semibold"
              >
                {index + 1}
              </text>
            </g>
          ))}
        </>
      ) : null}
      {task.kind === "area" && task.origin ? (
        <>
          <circle
            data-tactical-area-origin={`${task.origin.x},${task.origin.y}`}
            cx={task.origin.x}
            cy={task.origin.y}
            r={16}
            className="fill-violet-300/80 stroke-white stroke-[3] [vector-effect:non-scaling-stroke]"
          />
          {task.direction ? (
            <line
              data-tactical-area-direction={`${task.direction.x},${task.direction.y}`}
              x1={task.origin.x}
              y1={task.origin.y}
              x2={task.direction.x}
              y2={task.direction.y}
              className="stroke-violet-200 stroke-[5] [stroke-dasharray:12_8] [vector-effect:non-scaling-stroke]"
            />
          ) : null}
        </>
      ) : null}
      {cursor ? (
        <rect
          data-tactical-cursor={`${cursor.x},${cursor.y}`}
          x={cursor.x - grid / 2}
          y={cursor.y - grid / 2}
          width={grid}
          height={grid}
          fill="none"
          className="stroke-white stroke-[4] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
    </g>
  );
}
function SelectedTacticalDetail({
  projection,
  selected,
}: {
  projection: TacticalProjection;
  selected: TacticalSelection;
}) {
  if (selected.kind === "entity") {
    const entity = selected.value;
    return (
      <section data-tactical-selected={`entity:${entity.id}`} className="min-w-0">
        <p className="text-[11px] text-subtle">当前选中 · {RELATION_LABEL[entity.relation]}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base">{entity.name}</h3>
          {entity.id === projection.encounter?.activeEntityId ? (
            <span className="rounded-full border border-brass/50 px-2 py-0.5 text-[10px] text-brass">
              当前行动
            </span>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-subtle">占位</dt>
            <dd className="mt-0.5 text-fg">
              {formatLength(entity.footprint.width)} × {formatLength(entity.footprint.depth)}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">高程</dt>
            <dd className="mt-0.5 text-fg">{formatElevation(entity.position.elevation)}</dd>
          </div>
          <div>
            <dt className="text-subtle">高度</dt>
            <dd className="mt-0.5 text-fg">{formatLength(entity.footprint.height)}</dd>
          </div>
          <div>
            <dt className="text-subtle">公开状态</dt>
            <dd className="mt-0.5 break-words text-fg">
              {entity.publicStates.length > 0
                ? entity.publicStates.map(formatPublicState).join("、")
                : "无额外状态"}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  if (selected.kind === "feature") {
    const feature = selected.value;
    return (
      <section data-tactical-selected={`feature:${feature.id}`} className="min-w-0">
        <p className="text-[11px] text-subtle">当前选中 · {FEATURE_KIND_LABEL[feature.kind]}</p>
        <h3 className="mt-1 font-display text-base">{feature.label}</h3>
        <p className="mt-1 text-xs text-brass">状态：{formatTacticalState(feature.state)}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {featureMechanics(feature).map((mechanic) => (
            <li key={mechanic} className="rounded-full border border-border px-2 py-1">
              {mechanic}
            </li>
          ))}
        </ul>
        {feature.durability ? (
          <p className="mt-3 text-xs text-muted">
            耐久 {feature.durability.current}/{feature.durability.maximum}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          高程 {formatElevation(feature.elevation)} · 高度 {formatLength(feature.height)}
        </p>
      </section>
    );
  }

  const zone = selected.value;
  return (
    <section data-tactical-selected={`zone:${zone.id}`} className="min-w-0">
      <p className="text-[11px] text-subtle">当前选中 · 区域效果</p>
      <h3 className="mt-1 font-display text-base">{zone.label}</h3>
      <p className="mt-1 text-xs text-brass">状态：{formatTacticalState(zone.state)}</p>
      <p className="mt-3 break-words text-xs text-muted">
        {zone.effectTags.length > 0
          ? zone.effectTags.map(formatEffectTag).join(" · ")
          : "无额外公开效果标签"}
      </p>
      <p className="mt-2 text-xs text-muted">
        高程 {formatElevation(zone.geometry.elevation)} · 高度 {formatLength(zone.geometry.height)}
      </p>
    </section>
  );
}

function TacticalLegend() {
  return (
    <details className="rounded-[12px] border border-border px-3 py-2 text-xs">
      <summary className="text-muted">查看图例</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
        <p><span className="mr-1 text-brass">■</span>自己</p>
        <p><span className="mr-1 text-moss">■</span>盟友</p>
        <p><span className="mr-1 text-danger">■</span>敌对</p>
        <p><span className="mr-1 text-stone-400">■</span>中立</p>
        <p><span className="mr-1 text-primary">□</span>可互动物</p>
        <p><span className="mr-1 text-violet-300">▧</span>区域效果</p>
      </div>
      <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11px] text-subtle">
        <p>实线边阻挡移动；虚线边可通过。</p>
        <p>斜纹阻挡视线；点纹阻断区域传播。</p>
        <p>图形内 ½ / ¾ / 全 表示掩护等级。</p>
      </div>
    </details>
  );
}

function TacticalTextReadout({ projection }: { projection: TacticalProjection }) {
  return (
    <section
      data-tactical-readout="v1"
      role="tabpanel"
      aria-label={`${projection.scene.name}文字战术读数`}
      tabIndex={0}
      className="min-w-0 max-h-[min(50dvh,22rem)] overflow-y-auto break-words rounded-[16px] border border-border bg-surface px-4 py-3 text-sm outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-brass lg:col-span-2"
    >
      <p className="font-display text-base">{projection.scene.name} · 文字战术读数</p>
      <p className="mt-2 text-muted">{projection.textualReadout.summary}</p>
      {projection.textualReadout.entities.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
          {projection.textualReadout.entities.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-subtle">当前没有其他可见单位。</p>
      )}
      {projection.textualReadout.features.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
          {projection.textualReadout.features.map((entry) => <li key={entry}>{entry}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-subtle">尚无已知环境要素；未投影内容保持未知。</p>
      )}
      {projection.knownZones.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="font-display text-sm">已知区域效果</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            {projection.knownZones.map((zone) => (
              <li key={zone.id}>
                {zone.label}；状态 {formatTacticalState(zone.state)}；
                {zone.effectTags.length > 0
                  ? zone.effectTags.map(formatEffectTag).join("、")
                  : "无额外公开效果"}；
                高程 {formatElevation(zone.geometry.elevation)}，
                高度 {formatLength(zone.geometry.height)}。
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-subtle">尚无已知区域效果；未投影内容保持未知。</p>
      )}
    </section>
  );
}

const ACTION_BUTTON = "min-h-9 rounded-[10px] border border-border bg-bg/40 px-3 py-1.5 text-xs text-fg transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-brass aria-pressed:bg-brass/15 aria-pressed:text-brass";
const PRIMARY_BUTTON = "min-h-9 rounded-[10px] border border-brass/60 bg-brass/15 px-3 py-1.5 text-xs text-brass transition-colors hover:bg-brass/25 disabled:cursor-not-allowed disabled:opacity-50";

const ABILITY_GROUP_LABEL: Record<CombatControlAbility["group"], string> = {
  attack: "攻击",
  spell: "法术",
  feature: "职业能力",
  item: "物品",
  basic: "基础动作",
};

function AbilityButtons({
  abilities,
  armedRef,
  disabled,
  onChoose,
}: {
  abilities: CombatControlAbility[];
  armedRef: string | null;
  disabled: boolean;
  onChoose: (ability: CombatControlAbility) => void;
}) {
  const groups = (Object.keys(ABILITY_GROUP_LABEL) as CombatControlAbility["group"][])
    .map((group) => ({ group, entries: abilities.filter((ability) => ability.group === group) }))
    .filter((entry) => entry.entries.length > 0);
  return (
    <div className="space-y-2">
      {groups.map(({ group, entries }) => (
        <div key={group} role="group" aria-label={ABILITY_GROUP_LABEL[group]} data-tactical-ability-group={group}>
          <p className="mb-1 text-[11px] text-subtle">{ABILITY_GROUP_LABEL[group]}</p>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {entries.map((ability) => (
              <button
                key={ability.abilityRef}
                type="button"
                data-tactical-ability={ability.abilityRef}
                aria-pressed={armedRef === ability.abilityRef}
                aria-label={`${ability.name}，${abilityDetail(ability)}`}
                title={targetHint(ability)}
                disabled={disabled}
                onClick={() => onChoose(ability)}
                className={cn(ACTION_BUTTON, "max-w-full break-words text-left")}
              >
                {ability.name}
                <span className="ml-1 text-[10px] text-subtle">{abilityDetail(ability)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** SPEC 0014 §8 (ADR 0091): the controls under the map. Outside an encounter
 * the player walks to a picked point or beside someone or something, and an
 * ability aimed at someone becomes an intent sentence for the KP. On the
 * player's own turn the move, its abilities, the basic actions and the end
 * of the turn go straight to Rules. Every pick can also be made from the
 * name lists here, so the text readout keeps a full way to act. */
function TacticalActionPanel({
  projection,
  interaction,
  selected,
  onSelect,
  gestures,
  mapVisible,
}: {
  projection: TacticalProjection;
  interaction: TacticalInteraction;
  selected: TacticalSelection;
  onSelect: (key: string) => void;
  gestures: ReturnType<typeof mapGestures>;
  /** In the text readout a point can only be picked by a name list. */
  mapVisible: boolean;
}) {
  const { actions, task, setTask } = interaction;
  const { inEncounter, myTurn } = playerEncounter(projection);
  const controls = actions.controls;
  const entities = [projection.self, ...projection.visibleEntities];
  const elevation = projection.self.position.elevation;
  const busy = actions.busy;
  const nameOf = (id: string) => id === projection.self.id
    ? "自己"
    : entities.find((entity) => entity.id === id)?.name ?? "目标";
  const armedRef = task.kind === "creatures" || task.kind === "area" || task.kind === "intent"
    ? task.ability.abilityRef
    : null;

  async function finish(result: Promise<boolean>) {
    if (await result) setTask(IDLE_TASK);
  }

  function chooseCombatAbility(ability: CombatControlAbility) {
    if (armedRef === ability.abilityRef) {
      setTask(IDLE_TASK);
      return;
    }
    const target = ability.target;
    const ref = ability.abilityRef;
    if (target.kind === "none") void finish(actions.useAbility(ref, { kind: "none" }));
    else if (target.kind === "self") void finish(actions.useAbility(ref, { kind: "creatures", refs: [projection.self.id] }));
    else if (target.kind === "creatures") setTask({ kind: "creatures", ability, refs: [], purpose: "combat" });
    else if (target.origin === "self" && !target.needsDirection) {
      void finish(actions.useAbility(ref, { kind: "area", origin: structuredClone(projection.self.position) }));
    } else {
      setTask({ kind: "area", ability, origin: target.origin === "self" ? selfPoint(projection) : null, direction: null });
    }
  }

  function chooseIntentAbility(ability: CombatControlAbility) {
    if (armedRef === ability.abilityRef) setTask(IDLE_TASK);
    else if (ability.target.kind === "creatures") setTask({ kind: "creatures", ability, refs: [], purpose: "intent" });
    else setTask({ kind: "intent", ability, aimRef: null });
  }

  function areaTarget(): CombatAbilityTarget | null {
    if (task.kind !== "area" || task.ability.target.kind !== "area" || task.origin === null) return null;
    const shape = task.ability.target;
    if (shape.needsDirection && task.direction === null) return null;
    const origin = shape.origin === "self"
      ? structuredClone(projection.self.position)
      : mapPosition(task.origin, elevation);
    // SPEC 0014 §5: the page submits only the origin and a direction (the way
    // from the origin to the second point); Rules finds who is inside.
    return {
      kind: "area",
      origin,
      ...(shape.needsDirection && task.direction !== null
        ? {
            direction: {
              x: String(task.direction.x - Number(origin.x)),
              y: String(task.direction.y - Number(origin.y)),
              elevation: "0",
            },
          }
        : {}),
    };
  }

  const intent = task.kind === "creatures" && task.purpose === "intent"
    ? { sentence: intentSentence(task.ability, task.refs.map(nameOf)), ready: task.refs.length > 0 }
    : task.kind === "intent"
      ? { sentence: intentSentence(task.ability, task.aimRef ? [nameOf(task.aimRef)] : []), ready: true }
      : null;

  const besideKey = selected.kind === "entity" && selected.value.id !== projection.self.id
    ? entitySelectionKey(selected.value.id)
    : selected.kind === "feature" ? featureSelectionKey(selected.value.id) : "";
  const besideRef = besideKey.slice(besideKey.indexOf(":") + 1);
  const activeEntityId = projection.encounter?.activeEntityId ?? null;
  const activeName = activeEntityId === null
    ? "尚未确定"
    : entities.find((entity) => entity.id === activeEntityId)?.name ?? "看不见的行动者";
  const turn = controls?.turn ?? null;
  const movement = controls?.movement ?? null;
  const turnSummary = [
    ...(turn ? [`动作 ${turn.action}`, `附赠动作 ${turn.bonusAction}`, `反应 ${turn.reaction}`] : []),
    ...(turn && turn.attacksRemaining > 0 ? [`本次攻击动作还能攻击 ${turn.attacksRemaining} 次`] : []),
    ...(movement ? [`剩余移动 ${movement.remainingFeet} 尺（速度 ${movement.speedFeet} 尺）`] : []),
  ];
  const combatDisabled = busy || !myTurn;
  const area = areaTarget();

  return (
    <section
      aria-label="地图行动"
      data-tactical-actions={inEncounter ? "combat" : "exploration"}
      data-tactical-my-turn={String(myTurn)}
      className="min-w-0 space-y-3 break-words rounded-[16px] border border-border bg-surface p-3 text-xs [overflow-wrap:anywhere] lg:col-span-2"
    >
      {inEncounter ? (
        <>
          <div role="status" aria-live="polite" className="space-y-1">
            <p className="font-display text-sm text-fg">
              {myTurn
                ? `第 ${projection.encounter?.round ?? 0} 轮 · 轮到你`
                : `当前行动：${activeName}。轮到你时再行动。`}
            </p>
            {turnSummary.length > 0 ? (
              <p data-tactical-turn-grants className="text-muted">{turnSummary.join(" · ")}</p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-move-mode
              aria-pressed={task.kind === "path"}
              disabled={combatDisabled}
              onClick={() => setTask(task.kind === "path" ? IDLE_TASK : { kind: "path", waypoints: [] })}
              className={ACTION_BUTTON}
            >
              移动
            </button>
            <button
              type="button"
              data-tactical-end-turn
              disabled={combatDisabled}
              onClick={() => void finish(actions.endTurn())}
              className={PRIMARY_BUTTON}
            >
              结束回合
            </button>
          </div>
          {task.kind === "path" ? (
            <div data-tactical-path-picker className="space-y-2 rounded-[12px] border border-brass/40 p-2">
              <p className="text-muted">
                {mapVisible
                  ? `从你所在处出发，依次点地图放下路径点（已放 ${task.waypoints.length} 个）。也可用方向键移动选点框，按回车放点。`
                  : `路径点要在地图上放（已放 ${task.waypoints.length} 个），请切换到“地图”。`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-tactical-path-submit
                  disabled={combatDisabled || task.waypoints.length === 0}
                  onClick={() => void finish(actions.walkPath([
                    structuredClone(projection.self.position),
                    ...task.waypoints.map((point) => mapPosition(point, elevation)),
                  ]))}
                  className={PRIMARY_BUTTON}
                >
                  确认移动
                </button>
                <button
                  type="button"
                  disabled={task.waypoints.length === 0}
                  onClick={() => setTask({ ...task, waypoints: task.waypoints.slice(0, -1) })}
                  className={ACTION_BUTTON}
                >
                  撤回一点
                </button>
                <button
                  type="button"
                  data-tactical-path-clear
                  onClick={() => setTask({ kind: "path", waypoints: [] })}
                  className={ACTION_BUTTON}
                >
                  清除
                </button>
              </div>
            </div>
          ) : null}
          <AbilityButtons
            abilities={[...(controls?.abilities ?? []), ...(controls?.basicActions ?? [])]}
            armedRef={armedRef}
            disabled={combatDisabled}
            onChoose={chooseCombatAbility}
          />
        </>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-muted">走动不经 KP，也不花时间。</p>
            {task.kind === "destination" ? (
              <div data-tactical-destination-picker className="flex flex-wrap items-center gap-1.5">
                <span className="text-fg">目的地已在地图上用虚线方框标出。</span>
                <button
                  type="button"
                  data-tactical-destination-submit
                  disabled={busy}
                  onClick={() => void finish(actions.moveTo({
                    kind: "point",
                    x: String(task.point.x),
                    y: String(task.point.y),
                  }))}
                  className={PRIMARY_BUTTON}
                >
                  走到这里
                </button>
                <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>
                  取消
                </button>
              </div>
            ) : (
              <p className="text-subtle">
                {mapVisible
                  ? "点地图上的空地选目的地；也可用方向键移动选点框，按回车选定。"
                  : "要走到某个空地，请切换到“地图”点选；也可以在下面选人或物，走到旁边。"}
              </p>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <label className="flex min-w-0 max-w-full items-center gap-1.5 text-muted">
                <span className="shrink-0">走到</span>
                <select
                  data-tactical-beside-select
                  value={besideKey}
                  onChange={(event) => {
                    if (event.target.value) onSelect(event.target.value);
                  }}
                  className="min-h-9 min-w-0 max-w-[14rem] rounded-[10px] border border-border bg-bg px-2 text-xs text-fg"
                >
                  <option value="" disabled>选择人或物</option>
                  {projection.visibleEntities.map((entity) => (
                    <option key={entity.id} value={entitySelectionKey(entity.id)}>{entity.name}</option>
                  ))}
                  {projection.knownFeatures.map((feature) => (
                    <option key={feature.id} value={featureSelectionKey(feature.id)}>{feature.label}</option>
                  ))}
                </select>
                <span className="shrink-0">旁边</span>
              </label>
              <button
                type="button"
                data-tactical-beside-submit={besideRef || undefined}
                disabled={busy || besideKey === ""}
                onClick={() => void finish(actions.moveTo({ kind: "nextTo", ref: besideRef }))}
                className={PRIMARY_BUTTON}
              >
                走到旁边
              </button>
            </div>
          </div>
          {controls && controls.abilities.length > 0 ? (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="text-muted">对人使用能力：选好能力和目标后，作为你的行动交给 KP 裁定。</p>
              <AbilityButtons
                abilities={controls.abilities}
                armedRef={armedRef}
                disabled={busy}
                onChoose={chooseIntentAbility}
              />
            </div>
          ) : null}
        </>
      )}

      {task.kind === "creatures" ? (
        <div data-tactical-target-picker={task.purpose} className="space-y-2 rounded-[12px] border border-brass/40 p-2">
          <p className="text-muted">
            {task.ability.name}：{targetHint(task.ability)}。在地图上点选，或从下面选择。
            {task.ability.target.kind === "creatures" && task.ability.target.npcOpponentsOnly
              ? "只能对非玩家角色使用；对其他玩家请用文字说明你的行动。"
              : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entities.filter((entity) => creaturePickable(task.ability, entity)).map((entity) => (
              <button
                key={entity.id}
                type="button"
                data-tactical-target-option={entity.id}
                aria-pressed={task.refs.includes(entity.id)}
                onClick={() => gestures.activateEntity(entity)}
                className={ACTION_BUTTON}
              >
                {nameOf(entity.id)}
              </button>
            ))}
          </div>
          <p className="text-fg">已选：{task.refs.length > 0 ? joinNames(task.refs.map(nameOf)) : "尚未选择"}</p>
          {task.purpose === "combat" ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-tactical-target-submit
                disabled={combatDisabled || task.refs.length === 0}
                onClick={() => void finish(actions.useAbility(task.ability.abilityRef, { kind: "creatures", refs: [...task.refs] }))}
                className={PRIMARY_BUTTON}
              >
                确认
              </button>
              <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {task.kind === "area" ? (
        <div data-tactical-area-picker className="space-y-2 rounded-[12px] border border-brass/40 p-2">
          <p className="text-muted">{task.ability.name}：{targetHint(task.ability)}。</p>
          <p className="text-fg">
            {task.origin === null
              ? "在地图上点选位置，或从下面选一个人所在处。"
              : task.ability.target.kind === "area" && task.ability.target.needsDirection && task.direction === null
                ? "再点地图上一处，或从下面选一个人，定出朝向。"
                : "已选好。范围内有谁由规则结算。"}
          </p>
          {taskPicksPoint(task) ? (
            <div className="flex flex-wrap gap-1.5">
              {entities.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  data-tactical-area-option={entity.id}
                  onClick={() => gestures.pickPoint({ x: inches(entity.position.x), y: inches(entity.position.y) })}
                  className={ACTION_BUTTON}
                >
                  {nameOf(entity.id)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-area-submit
              disabled={combatDisabled || area === null}
              onClick={() => {
                if (area !== null) void finish(actions.useAbility(task.ability.abilityRef, area));
              }}
              className={PRIMARY_BUTTON}
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => setTask({
                ...task,
                origin: task.ability.target.kind === "area" && task.ability.target.origin === "self" ? selfPoint(projection) : null,
                direction: null,
              })}
              className={ACTION_BUTTON}
            >
              重选
            </button>
            <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
          </div>
        </div>
      ) : null}

      {task.kind === "intent" && task.ability.target.kind === "area" && task.ability.target.origin === "point" ? (
        <div data-tactical-aim-picker className="space-y-2 rounded-[12px] border border-brass/40 p-2">
          <p className="text-muted">{task.ability.name}：可以在地图上或下面选一个人，说明朝谁施放。</p>
          <div className="flex flex-wrap gap-1.5">
            {projection.visibleEntities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                data-tactical-aim-option={entity.id}
                aria-pressed={task.aimRef === entity.id}
                onClick={() => gestures.activateEntity(entity)}
                className={ACTION_BUTTON}
              >
                {entity.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {intent ? (
        <div data-tactical-intent-preview className="space-y-2 rounded-[12px] border border-brass/40 p-2">
          <p className="text-fg">将作为你的行动发送：{intent.ready ? intent.sentence : "请先选择目标。"}</p>
          {actions.intentUnavailable ? <p className="text-subtle">{actions.intentUnavailable}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-tactical-intent-submit
              disabled={busy || !intent.ready || actions.intentUnavailable !== undefined}
              onClick={() => {
                setTask(IDLE_TASK);
                void actions.sendIntent(intent.sentence);
              }}
              className={PRIMARY_BUTTON}
            >
              发送给 KP
            </button>
            <button type="button" onClick={() => setTask(IDLE_TASK)} className={ACTION_BUTTON}>取消</button>
          </div>
        </div>
      ) : null}

      {busy ? <p role="status" className="text-brass">正在提交……</p> : null}
      {actions.error ? (
        <div role="alert" data-tactical-action-error className="flex flex-wrap items-start gap-2 rounded-[12px] border border-danger/40 bg-danger/10 p-2">
          <p className="min-w-0 flex-1 text-fg">{actions.error}</p>
          <button type="button" onClick={actions.dismissError} className={ACTION_BUTTON}>知道了</button>
        </div>
      ) : null}
    </section>
  );
}
