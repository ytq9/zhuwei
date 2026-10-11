import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  tacticalLevelLabel,
  tacticalTerrainPhrases,
  type TacticalEntity,
  type TacticalFeatureDestination,
  type TacticalKnownFeature,
  type TacticalKnownPlace,
  type TacticalLandform,
  type TacticalMaterial,
  type TacticalPosition,
  type TacticalProjection,
  type TacticalZone,
} from "@/lib/rules/tactical-projection";
import type { CombatControlAbility, CombatControlTarget, CombatJumpChoice, NpcCombatTurnStatus } from "@/lib/table/authoritative";
import type { TacticalMapActions } from "@/components/tactical-map-actions";
import { ACTION_BUTTON } from "@/components/table-actions";
import {
  IDLE_TASK,
  NPC_TURN_LABEL,
  clampToScene,
  entitySelectionKey,
  inches,
  mapGestures,
  pickStep,
  playerEncounter,
  sceneBounds,
  selfPoint,
  snapToGrid,
  type MapPoint,
  type MapTask,
  type TacticalTaskControl,
} from "@/components/tactical-task";
import { CONDITION_LABEL } from "@/lib/dnd/condition-labels";
import { cn } from "@/lib/utils";

/** SPEC 0014 §8: each kind drawn as what it is -- a wall as solid masonry,
 * a door as a leaf in its opening, an object as a small solid piece, ground
 * as a tint over the floor. The material, when the map names it, sets the
 * colour of a wall, door or object. */
const FEATURE_STYLE: Record<TacticalKnownFeature["kind"], string> = {
  barrier: "fill-stone-500 stroke-stone-200",
  terrain: "fill-amber-200/10 stroke-amber-200/50",
  interactable: "fill-amber-300/80 stroke-amber-50",
  destructible: "fill-amber-800 stroke-amber-300",
  portal: "fill-amber-700 stroke-amber-200",
};

const MATERIAL_STYLE: Record<TacticalMaterial, string> = {
  brick: "fill-red-900 stroke-red-200",
  earth: "fill-amber-950 stroke-amber-500",
  metal: "fill-slate-500 stroke-slate-100",
  mud: "fill-yellow-950 stroke-yellow-600",
  rope: "fill-amber-600 stroke-amber-100",
  stone: "fill-stone-500 stroke-stone-200",
  wood: "fill-amber-800 stroke-amber-200",
};

/** Ground without a landform: rubble, mud, or a plain patch. */
function terrainStyle(feature: TacticalKnownFeature): string {
  if (feature.terrain === "rubble") return "fill-stone-600/40 stroke-stone-400/70";
  if (feature.material === "mud") return "fill-yellow-950/60 stroke-yellow-700/70";
  if (feature.material === "earth") return "fill-amber-950/50 stroke-amber-700/60";
  if (feature.material === "stone") return "fill-stone-500/25 stroke-stone-400/60";
  return FEATURE_STYLE.terrain;
}

function featureStyle(feature: TacticalKnownFeature): string {
  if (feature.landform !== undefined) return LANDFORM_STYLE[feature.landform];
  if (feature.kind === "terrain") return terrainStyle(feature);
  if (feature.kind === "portal" && feature.state === "open") return "fill-emerald-300/10 stroke-emerald-200";
  if (feature.state === "destroyed") return "fill-stone-700/40 stroke-stone-400";
  return feature.material === undefined ? FEATURE_STYLE[feature.kind] : MATERIAL_STYLE[feature.material];
}

/** The surface inside a feature: coursed stones on a wall, planks on wood,
 * bars on metal, scattered stones on rubble and ripples on mud. */
const FEATURE_TEXTURE = {
  masonry: { size: 20, path: "M 0 0.5 H 20 M 0 10.5 H 20 M 5 0 V 10 M 15 10 V 20", className: "stroke-black/30 stroke-[1.5]" },
  planks: { size: 14, path: "M 0 7 H 14", className: "stroke-black/30 stroke-[1.5]" },
  bars: { size: 12, path: "M 6 0 V 12", className: "stroke-black/40 stroke-[2]" },
  rubble: { size: 22, path: "M 3 4 l 4 1 -2 3 z M 13 12 l 5 2 -3 3 z M 6 16 l 3 0 -1 3 z", className: "fill-stone-300/50 stroke-none" },
  mud: { size: 24, path: "M 2 8 q 4 -3 8 0 M 13 18 q 4 -3 8 0", className: "stroke-yellow-600/50 stroke-[1.5]" },
} as const;
type FeatureTexture = keyof typeof FEATURE_TEXTURE;
const FEATURE_TEXTURES = Object.keys(FEATURE_TEXTURE) as FeatureTexture[];

function featureTexture(feature: TacticalKnownFeature): FeatureTexture | null {
  if (feature.landform !== undefined) return null;
  if (feature.terrain === "rubble" || feature.state === "destroyed") return "rubble";
  if (feature.kind === "terrain") return feature.material === "mud" ? "mud" : null;
  if (feature.kind === "portal" && feature.state === "open") return null;
  if (feature.material === "metal") return feature.kind === "interactable" ? null : "bars";
  if (feature.material === "wood") return "planks";
  if (feature.kind === "barrier") return "masonry";
  if (feature.kind === "portal" || feature.kind === "destructible") return "planks";
  return null;
}

/** The order features lie on the map, bottom to top: the ground (terrain,
 * ditches, water, steps), objects standing on it, then what walls a space
 * in (walls, doors, low walls, cliffs). Within a layer the larger shape lies
 * beneath, so a small object on a large patch stays in view. */
const FEATURE_LAYER = { ground: 0, object: 1, structure: 2 } as const;

type LayeredFeature = Pick<TacticalKnownFeature, "id" | "kind" | "landform" | "polygon">;

function featureLayer(feature: LayeredFeature): keyof typeof FEATURE_LAYER {
  if (feature.landform === "ditch" || feature.landform === "water" || feature.landform === "step") return "ground";
  if (feature.landform === "lowWall" || feature.landform === "cliff") return "structure";
  if (feature.kind === "terrain") return "ground";
  return feature.kind === "barrier" || feature.kind === "portal" ? "structure" : "object";
}

function polygonArea(points: Array<{ x: string; y: string }>): number {
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twice += inches(point.x) * inches(next.y) - inches(next.x) * inches(point.y);
  });
  return Math.abs(twice) / 2;
}

function layeredFeatures<Feature extends LayeredFeature>(features: Feature[]): Feature[] {
  return [...features].sort((left, right) => FEATURE_LAYER[featureLayer(left)] - FEATURE_LAYER[featureLayer(right)]
    || polygonArea(right.polygon) - polygonArea(left.polygon)
    || left.id.localeCompare(right.id));
}

const RELATION_STYLE: Record<TacticalEntity["relation"], string> = {
  self: "fill-brass/80 stroke-white",
  ally: "fill-moss/85 stroke-emerald-100",
  enemy: "fill-danger/75 stroke-red-100",
  neutral: "fill-stone-500/75 stroke-stone-100",
};

const ZONE_STYLE = "fill-violet-500/20 stroke-violet-200";

/** SPEC 0014 §4 (ADR 0098): a feature with a landform is drawn as that
 * ground -- each its own fill, edge and texture -- whatever its kind. */
const LANDFORM_STYLE: Record<TacticalLandform, string> = {
  ditch: "fill-amber-950/70 stroke-amber-600",
  water: "fill-sky-800/60 stroke-sky-300",
  lowWall: "fill-stone-400/55 stroke-stone-100",
  step: "fill-yellow-900/45 stroke-yellow-200",
  cliff: "fill-zinc-800/85 stroke-zinc-200",
};

/** The texture inside each landform: furrows in a ditch, waves on water,
 * coursed stones on a wall, treads on a step and a jagged face on a cliff. */
const LANDFORM_TEXTURE: Record<TacticalLandform, { size: number; path: string; className: string }> = {
  ditch: { size: 20, path: "M 2 6 H 18 M 2 14 H 18", className: "stroke-amber-300/45 stroke-[3]" },
  water: { size: 24, path: "M 0 12 Q 6 6 12 12 T 24 12", className: "stroke-sky-100/60 stroke-[3]" },
  lowWall: { size: 24, path: "M 0 0 H 24 M 0 12 H 24 M 6 0 V 12 M 18 12 V 24", className: "stroke-stone-50/55 stroke-[3]" },
  step: { size: 24, path: "M 0 4 H 24 M 0 16 H 24", className: "stroke-yellow-50/60 stroke-[5]" },
  cliff: { size: 24, path: "M 0 18 L 6 6 L 12 18 L 18 6 L 24 18", className: "stroke-zinc-50/60 stroke-[3]" },
};

const LANDFORMS = Object.keys(LANDFORM_STYLE) as TacticalLandform[];
const HOLLOW_LANDFORMS: ReadonlySet<string> = new Set(["ditch", "water"]);
const RAISED_LANDFORMS: ReadonlySet<string> = new Set(["step", "lowWall", "cliff"]);
const CLIMBABLE_LANDFORMS: ReadonlySet<string> = new Set(["ditch", "step", "lowWall", "cliff"]);

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

const EFFECT_LABEL: Record<string, string> = {
  "heavily-obscured": "重度遮蔽",
};

type TacticalView = "map" | "text";

type TacticalSelection =
  | { kind: "entity"; value: TacticalEntity }
  | { kind: "feature"; value: TacticalKnownFeature }
  | { kind: "zone"; value: TacticalZone };

/** SPEC 0014 §8 (ADR 0103 decision 4): a door or opening on the map that
 * leads to another place. */
type DoorElsewhere = TacticalKnownFeature & { leadsTo: TacticalFeatureDestination };

function doorsElsewhere(projection: TacticalProjection): DoorElsewhere[] {
  return projection.knownFeatures.filter((feature): feature is DoorElsewhere => feature.leadsTo !== undefined);
}

/** The sentence a "前往" sends the KP, as the player would say it. Through a
 * closed door the player opens it first; the KP rules whether it opens. */
function goToSentence(door: DoorElsewhere): string {
  return door.leadsTo.passable
    ? `我穿过${door.label}去${door.leadsTo.name}。`
    : `我打开${door.label}，去${door.leadsTo.name}。`;
}

/** SPEC 0014 §8 (ADR 0103 decision 5): the places a player stitched onto its
 * map, remembered per viewer in this browser only. */
const STITCH_STORAGE_PREFIX = "zhuwei:tactical-map:stitched:";

function readStitchedSceneIds(viewerId: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(`${STITCH_STORAGE_PREFIX}${viewerId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 64)
      : [];
  } catch {
    return [];
  }
}

function writeStitchedSceneIds(viewerId: string, sceneIds: string[]) {
  try {
    globalThis.localStorage?.setItem(`${STITCH_STORAGE_PREFIX}${viewerId}`, JSON.stringify(sceneIds));
  } catch {
    // Storage may be blocked; the choice then lasts until the map closes.
  }
}

/** SPEC 0014 §8 (ADR 0103 decision 5): the stitched map as chosen: every
 * known place for the picker, the chosen ones (the current place always),
 * their levels from the top floor down, the level shown and the other
 * chosen places on it. Null when there is nothing to stitch. */
type StitchView = {
  places: TacticalKnownPlace[];
  current: TacticalKnownPlace;
  chosenIds: ReadonlySet<string>;
  levels: number[];
  level: number;
  shown: TacticalKnownPlace[];
};

function stitchView(
  projection: TacticalProjection,
  stitchedSceneIds: readonly string[],
  levelPick: number | null,
): StitchView | null {
  const places = projection.knownPlaces ?? [];
  const current = places.find((place) => place.sceneId === projection.scene.id);
  if (current === undefined || places.length < 2) return null;
  const chosen = places.filter((place) => place.sceneId === current.sceneId || stitchedSceneIds.includes(place.sceneId));
  const levels = [...new Set(chosen.map((place) => place.placement.level))].sort((left, right) => right - left);
  const level = levelPick !== null && levels.includes(levelPick) ? levelPick : current.placement.level;
  return {
    places,
    current,
    chosenIds: new Set(chosen.map((place) => place.sceneId)),
    levels,
    level,
    shown: chosen.filter((place) => place.sceneId !== current.sceneId && place.placement.level === level),
  };
}

/** Where a place sits relative to the current place's map, by the site plan. */
function placeOffset(place: TacticalKnownPlace, current: TacticalKnownPlace): MapPoint {
  return {
    x: inches(place.placement.x) - inches(current.placement.x),
    y: inches(place.placement.y) - inches(current.placement.y),
  };
}

function pointsBounds(points: Array<{ x: string; y: string }>, offset: MapPoint = { x: 0, y: 0 }) {
  const xs = points.map((point) => inches(point.x) + offset.x);
  const ys = points.map((point) => inches(point.y) + offset.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
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

/** A height on a token: "+3 尺", "−2 尺 6 寸", "−8 寸"; none at zero. */
function heightTag(inches: bigint): string | null {
  if (inches === 0n) return null;
  const sign = inches > 0n ? "+" : "−";
  const absolute = inches > 0n ? inches : -inches;
  const feet = absolute / 12n;
  const remainingInches = absolute % 12n;
  if (feet === 0n) return `${sign}${remainingInches} 寸`;
  return remainingInches === 0n ? `${sign}${feet} 尺` : `${sign}${feet} 尺 ${remainingInches} 寸`;
}

/** Whether (x, y) lies inside or on the edge of the polygon. */
function pointInPolygon(x: number, y: number, points: Array<{ x: string; y: string }>): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = { x: inches(points[index].x), y: inches(points[index].y) };
    const b = { x: inches(points[previous].x), y: inches(points[previous].y) };
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0 && Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= y && y <= Math.max(a.y, b.y)) return true;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** SPEC 0014 §4 (ADR 0098): the feature a creature stands in or on, read
 * from the map as Rules places it -- its centre inside a ditch or water and
 * below the rim, or over a step, low wall or cliff and above its foot. */
function terrainFootingOf(position: TacticalPosition, features: TacticalKnownFeature[]): TacticalKnownFeature | null {
  const x = inches(position.x), y = inches(position.y), elevation = BigInt(position.elevation);
  return features.find((feature) => feature.landform !== undefined && pointInPolygon(x, y, feature.polygon)
    && (HOLLOW_LANDFORMS.has(feature.landform) ? elevation < BigInt(feature.elevation)
      : RAISED_LANDFORMS.has(feature.landform) && elevation > BigInt(feature.elevation))) ?? null;
}

/** The height a token shows: inside a ditch or water, or on a top, how far
 * below or above the ground around that feature it stands; elsewhere its
 * elevation, nothing at ground level. */
function tokenElevationLabel(entity: TacticalEntity, features: TacticalKnownFeature[]): string | null {
  const footing = terrainFootingOf(entity.position, features);
  return heightTag(BigInt(entity.position.elevation) - BigInt(footing?.elevation ?? "0"));
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

function featureSelectionKey(featureId: string): string {
  return `feature:${featureId}`;
}

type FeatureCaption = { text: string; x: number; y: number; size: number };

/** How large map text is drawn, in scene inches, so names read at about
 * the same size on a small room and a wide yard. */
function mapTextScale(viewWidth: number, viewHeight: number): number {
  return Math.max(0.5, Math.max(viewWidth, viewHeight) / 1200);
}

/** The cover mark's radius at this text scale. */
function coverMarkRadius(scale: number): number {
  return 13 * scale;
}

/** Display-only label placement: every known feature is named where its
 * name fits clear of the creature tokens, the cover marks and the names
 * already placed; doors and objects are placed first and the selected
 * feature is always named. These rectangles never participate in movement. */
function featureCaptions(projection: TacticalProjection, selectedKey: string | null, scale: number): Map<string, FeatureCaption> {
  const bounds = sceneBounds(projection);
  const size = 26 * scale;
  const pad = 6 * scale;
  const occupied = [projection.self, ...projection.visibleEntities].map(entity => ({
    left: inches(entity.position.x) - inches(entity.footprint.width) / 2 - pad,
    right: inches(entity.position.x) + inches(entity.footprint.width) / 2 + pad,
    top: inches(entity.position.y) - inches(entity.footprint.depth) / 2 - pad,
    bottom: inches(entity.position.y) + inches(entity.footprint.depth) / 2 + pad,
  }));
  const mark = coverMarkRadius(scale);
  for (const feature of projection.knownFeatures) if (COVER_MARK[feature.cover]) {
    const center = polygonCenter(feature.polygon);
    occupied.push({ left: center.x - mark, right: center.x + mark, top: center.y - mark, bottom: center.y + mark });
  }
  const priority = (feature: TacticalKnownFeature) => featureSelectionKey(feature.id) === selectedKey ? 0
    : feature.kind === "portal" || feature.kind === "interactable" ? 1 : 2;
  const features = [...projection.knownFeatures].sort((left, right) => priority(left) - priority(right)
    || polygonArea(left.polygon) - polygonArea(right.polygon));
  const result = new Map<string, FeatureCaption>();
  for (const feature of features) {
    const chars = Array.from(feature.label);
    const text = chars.slice(0, 8).join("") + (chars.length > 8 ? "…" : "");
    const halfWidth = (Array.from(text).length * size) / 2 + pad;
    const center = polygonCenter(feature.polygon);
    const xs = feature.polygon.map(p => inches(p.x)), ys = feature.polygon.map(p => inches(p.y));
    const inside = Math.max(...xs) - Math.min(...xs) > halfWidth * 2 && Math.max(...ys) - Math.min(...ys) > size * 1.4;
    const points = [
      ...(inside ? [{ x: center.x, y: center.y + size * 0.35 }] : []),
      { x: center.x, y: Math.min(...ys) - pad },
      { x: center.x, y: Math.max(...ys) + size + pad },
      { x: Math.min(...xs) - halfWidth - pad, y: center.y + size * 0.35 },
      { x: Math.max(...xs) + halfWidth + pad, y: center.y + size * 0.35 },
    ].map(point => {
      const x = Math.max(bounds.minX + halfWidth, Math.min(bounds.maxX - halfWidth, point.x));
      const y = Math.max(bounds.minY + size + pad, Math.min(bounds.maxY - pad, point.y));
      const box = { left: x - halfWidth, right: x + halfWidth, top: y - size, bottom: y + pad };
      const collisions = occupied.filter(other => box.left < other.right && box.right > other.left
        && box.top < other.bottom && box.bottom > other.top).length;
      return { x, y, box, collisions, distance: Math.hypot(x - center.x, y - center.y) };
    });
    const best = points.sort((a, b) => a.collisions - b.collisions || a.distance - b.distance)[0];
    if (best.collisions > 0 && priority(feature) !== 0) continue;
    occupied.push(best.box);
    result.set(feature.id, { text, x: best.x, y: best.y, size });
  }
  return result;
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
  elevationLabel,
  textScale,
  targeted = false,
  passThrough = false,
  onSelect,
}: {
  entity: TacticalEntity;
  currentActor: boolean;
  selected: boolean;
  /** The height beside the token (tokenElevationLabel). */
  elevationLabel: string | null;
  textScale: number;
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
          className="pointer-events-none stroke-red-300 stroke-[2] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      <rect
        x={x - width / 2}
        y={y - depth / 2}
        width={width}
        height={depth}
        rx={Math.min(width, depth) / 5}
        className="stroke-[1.5] [vector-effect:non-scaling-stroke]"
      />
      {currentActor ? (
        <rect
          x={x - width / 2 - 10}
          y={y - depth / 2 - 10}
          width={width + 20}
          height={depth + 20}
          rx={Math.min(width, depth) / 4}
          fill="none"
          className="stroke-brass stroke-[2] [vector-effect:non-scaling-stroke]"
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
          className="stroke-white/90 stroke-[1.5] [stroke-dasharray:4_3] [vector-effect:non-scaling-stroke]"
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
          data-elevation-label
          x={x + width / 2 + 4 * textScale}
          y={y - depth / 2 - 4 * textScale}
          fontSize={20 * textScale}
          textAnchor="start"
          className="pointer-events-none fill-primary stroke-black/80 font-semibold [paint-order:stroke] [stroke-width:4px]"
        >
          {elevationLabel}
        </text>
      ) : null}
    </g>
  );
}

/** The long axis of a feature's bounding box: a door's leaf runs along it. */
function featureBox(points: Array<{ x: string; y: string }>) {
  const xs = points.map((point) => inches(point.x));
  const ys = points.map((point) => inches(point.y));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** What sits inside a door or a crate: a closed door's leaf down the middle
 * of its opening, a locked one's bolt across it, and a crate's brace. */
function FeatureFittings({ feature }: { feature: TacticalKnownFeature }) {
  const box = featureBox(feature.polygon);
  const wide = box.maxX - box.minX >= box.maxY - box.minY;
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  if (feature.kind === "portal" && feature.landform === undefined && feature.state !== "open" && feature.state !== "destroyed") {
    return (
      <g data-feature-fitting="door" className="pointer-events-none">
        <line
          x1={wide ? box.minX : midX} y1={wide ? midY : box.minY}
          x2={wide ? box.maxX : midX} y2={wide ? midY : box.maxY}
          className="stroke-black/60 stroke-[2] [vector-effect:non-scaling-stroke]"
        />
        {feature.state === "locked" ? (
          <line
            data-feature-fitting="bolt"
            x1={wide ? midX : box.minX} y1={wide ? box.minY : midY}
            x2={wide ? midX : box.maxX} y2={wide ? box.maxY : midY}
            className="stroke-black/70 stroke-[3] [vector-effect:non-scaling-stroke]"
          />
        ) : null}
      </g>
    );
  }
  if (feature.kind === "destructible" && feature.landform === undefined && feature.state !== "destroyed") {
    return (
      <path
        data-feature-fitting="brace"
        d={`M ${box.minX} ${box.minY} L ${box.maxX} ${box.maxY} M ${box.maxX} ${box.minY} L ${box.minX} ${box.maxY}`}
        className="pointer-events-none fill-none stroke-black/45 stroke-[1.5] [vector-effect:non-scaling-stroke]"
      />
    );
  }
  return null;
}

function TacticalFeatureShape({
  feature,
  selected,
  passThrough = false,
  onSelect,
  opaquePatternId,
  propagationPatternId,
  landformPatternId,
  texturePatternId,
}: {
  feature: TacticalKnownFeature;
  selected: boolean;
  passThrough?: boolean;
  onSelect: () => void;
  opaquePatternId: string;
  propagationPatternId: string;
  landformPatternId: (landform: TacticalLandform) => string;
  texturePatternId: (texture: FeatureTexture) => string;
}) {
  const mechanics = featureMechanics(feature);
  const texture = featureTexture(feature);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`查看${feature.label}的战术详情`}
      aria-pressed={selected}
      data-feature-id={feature.id}
      data-feature-kind={feature.kind}
      data-feature-state={feature.state}
      data-feature-layer={featureLayer(feature)}
      data-feature-material={feature.material}
      data-impassable={String(feature.impassable)}
      data-opaque={String(feature.opaque)}
      data-cover={feature.cover}
      data-propagation={feature.propagation}
      data-terrain={feature.terrain}
      data-landform={feature.landform}
      data-elevation-inches={feature.elevation}
      data-height-inches={feature.height}
      data-selected={String(selected)}
      className={cn(
        featureStyle(feature),
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
          "stroke-[1.5] [vector-effect:non-scaling-stroke]",
          !feature.impassable && "[stroke-dasharray:5_3]",
        )}
      />
      {texture !== null ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          data-texture-encoding={texture}
          fill={`url(#${texturePatternId(texture)})`}
          className="pointer-events-none stroke-none"
        />
      ) : null}
      {feature.landform !== undefined ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          data-landform-encoding={feature.landform}
          fill={`url(#${landformPatternId(feature.landform)})`}
          className="pointer-events-none stroke-none"
        />
      ) : null}
      <FeatureFittings feature={feature} />
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
      {selected ? (
        <polygon
          points={polygonPoints(feature.polygon)}
          fill="none"
          className="pointer-events-none stroke-white stroke-[2] [stroke-dasharray:5_3] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
    </g>
  );
}

/** Above the tokens: a feature's cover mark and its name, so neither hides
 * under a creature or a larger feature. */
function FeatureAnnotation({
  feature,
  caption,
  scale,
}: {
  feature: TacticalKnownFeature;
  caption?: FeatureCaption;
  scale: number;
}) {
  const coverMark = COVER_MARK[feature.cover];
  const center = polygonCenter(feature.polygon);
  const radius = coverMarkRadius(scale);
  return (
    <g data-feature-annotation={feature.id} className="pointer-events-none">
      {coverMark ? (
        <g data-cover-encoding={feature.cover}>
          <circle
            cx={center.x}
            cy={center.y}
            r={radius}
            className="fill-[#0d0b0a]/85 stroke-white/70 stroke-[1] [vector-effect:non-scaling-stroke]"
          />
          <text
            x={center.x}
            y={center.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={radius * 1.1}
            className="fill-white font-semibold"
          >
            {coverMark}
          </text>
        </g>
      ) : null}
      {caption ? (
        <text x={caption.x} y={caption.y} fontSize={caption.size}
          textAnchor="middle" data-feature-caption={feature.id}
          className="fill-stone-100 stroke-[#151411] [paint-order:stroke] [stroke-width:4px]">
          {caption.text}
        </text>
      ) : null}
    </g>
  );
}

function TacticalZoneShape({
  zone,
  selected,
  passThrough = false,
  textScale,
  onSelect,
}: {
  zone: TacticalZone;
  selected: boolean;
  passThrough?: boolean;
  textScale: number;
  onSelect: () => void;
}) {
  const center = polygonCenter(zone.geometry.points);
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
      {/* The zone lies over the features in it; only its edge and name take
          a click, so a door inside a fog stays selectable. */}
      <polygon
        points={polygonPoints(zone.geometry.points)}
        className={cn(
          "[pointer-events:visibleStroke] stroke-[3] [stroke-dasharray:10_6] [vector-effect:non-scaling-stroke]",
          selected && "stroke-white stroke-[4]",
        )}
      />
      <text
        data-zone-caption={zone.id}
        x={center.x}
        y={center.y}
        fontSize={24 * textScale}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-violet-100 stroke-[#151411] [paint-order:stroke] [stroke-width:4px]"
      >
        {zone.label}
      </text>
    </g>
  );
}

/** SPEC 0006 §7 (ADR 0101): what the NPC whose turn it is is doing. */
function encounterReadout(projection: TacticalProjection, npcTurn?: NpcCombatTurnStatus): string {
  if (projection.encounter === null) return "当前遭遇信息未知";
  if (projection.encounter.status === "concluded") return "遭遇已收束";
  const entities = [projection.self, ...projection.visibleEntities];
  const activeEntity = projection.encounter.activeEntityId
    ? entities.find((entity) => entity.id === projection.encounter?.activeEntityId)
    : undefined;
  if (!activeEntity) return `第 ${projection.encounter.round} 轮 · 当前行动者未知`;
  return activeEntity.id === projection.self.id
    ? `第 ${projection.encounter.round} 轮 · 轮到你`
    : `第 ${projection.encounter.round} 轮 · 当前行动：${activeEntity.name}${npcTurn?.npcRef === activeEntity.id ? `（${NPC_TURN_LABEL[npcTurn.state]}）` : ""}`;
}

export function TacticalMap({
  projection,
  defaultExpanded = false,
  actions,
  npcTurn,
  mobileOpen: controlledMobileOpen,
  onMobileOpenChange,
  mobileFooter,
}: {
  projection: TacticalProjection | null | undefined;
  defaultExpanded?: boolean;
  /** Without actions the map only shows the projection. */
  actions?: TacticalMapActions;
  npcTurn?: NpcCombatTurnStatus;
  /** The narrow-screen map dialog, when the table opens it for a pick. */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  /** Shown under the narrow-screen map, so a pick is confirmed in place. */
  mobileFooter?: ReactNode;
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
  const [ownMobileOpen, setOwnMobileOpen] = useState(false);
  const mobileOpen = controlledMobileOpen ?? ownMobileOpen;
  const setMobileOpen = (open: boolean) => {
    if (onMobileOpenChange) onMobileOpenChange(open);
    else setOwnMobileOpen(open);
  };
  const [view, setView] = useState<TacticalView>("map");
  const [selectedKey, setSelectedKey] = useState<string | null>(
    projection ? initialSelectionKey(projection) : null,
  );
  // SPEC 0014 §8 (ADR 0103 decision 5): the places stitched onto this
  // viewer's map. The remembered choice is read after mount, so the first
  // render matches the server's.
  const viewerId = projection?.self.id;
  const [stitched, setStitched] = useState<{ viewerId?: string; sceneIds: string[] }>({ sceneIds: [] });
  const [levelPick, setLevelPick] = useState<number | null>(null);
  useEffect(() => {
    if (viewerId === undefined) return;
    setStitched({ viewerId, sceneIds: readStitchedSceneIds(viewerId) });
  }, [viewerId]);
  const stitch = projection
    ? stitchView(projection, stitched.viewerId === viewerId ? stitched.sceneIds : [], levelPick)
    : null;
  const stitching: TacticalStitching | undefined = stitch === null || viewerId === undefined
    ? undefined
    : {
        view: stitch,
        setSceneIds: (sceneIds) => {
          setStitched({ viewerId, sceneIds });
          writeStitchedSceneIds(viewerId, sceneIds);
        },
        setLevel: setLevelPick,
      };
  const isDesktopExpanded = Boolean(projection) && desktopExpanded;
  const isMobileOpen = Boolean(projection) && mobileOpen;
  const status = projection
    ? encounterReadout(projection, npcTurn)
    : "尚无观察者可见的战术地图数据";
  // The pick in progress belongs to the table, so the action list and the bar
  // above the composer can start and confirm it.
  const interaction: TacticalInteraction | undefined = actions
    ? { actions, task: actions.task, setTask: actions.setTask, cursor: actions.cursor, setCursor: actions.setCursor }
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
      className={cn("min-w-0 max-w-full shrink-0 border-b border-border bg-bg/45",
        isDesktopExpanded && "lg:flex lg:min-h-0 lg:max-h-[50dvh] lg:shrink lg:flex-col")}
    >
      <div className="shrink-0 px-4 py-2.5">
        <button
          ref={desktopTriggerRef}
          type="button"
          data-tactical-disclosure-trigger="desktop"
          aria-expanded={isDesktopExpanded}
          aria-controls={desktopContentId}
          disabled={!projection}
          onClick={() => setDesktopExpanded((current) => !current)}
          className="hidden min-w-0 w-full items-center justify-between gap-4 rounded-control border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70 lg:flex"
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
          className="flex min-w-0 w-full items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70 lg:hidden"
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
        data-tactical-scroll="desktop"
        className="hidden min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] lg:block lg:flex-1"
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
            stitching={stitching}
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
              className="shrink-0 rounded-control border border-border px-3 py-2 text-sm text-fg hover:bg-elevated"
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
            stitching={stitching}
            mobile
          />
          {mobileFooter ? (
            <div data-tactical-mobile-footer className="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-border bg-surface p-3">
              {mobileFooter}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type TacticalInteraction = TacticalTaskControl & { actions: TacticalMapActions };

/** SPEC 0014 §8 (ADR 0103 decision 5): the stitched map and how the player
 * changes it. Display only; nothing here reaches the table. */
type TacticalStitching = {
  view: StitchView;
  setSceneIds: (sceneIds: string[]) => void;
  setLevel: (level: number) => void;
};

function TacticalMapExpanded({
  projection,
  instanceId,
  view,
  selectedKey,
  onViewChange,
  onSelect,
  interaction,
  stitching,
  mobile = false,
}: {
  projection: TacticalProjection;
  instanceId: string;
  view: TacticalView;
  selectedKey: string | null;
  onViewChange: (view: TacticalView) => void;
  onSelect: (key: string) => void;
  interaction?: TacticalInteraction;
  stitching?: TacticalStitching;
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
        mobile ? "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3" : "px-4 pb-4",
      )}
    >
      <div className="mx-auto grid w-full gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex items-center justify-between gap-3 lg:col-span-2">
          <div
            role="tablist"
            aria-label="战术地图显示方式"
            className="inline-flex rounded-control border border-border bg-surface p-1"
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
                  "rounded-sm px-3 py-1.5 text-xs transition-colors",
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
            每格 {formatLength(String(projection.scene.gridInches))} · 点选查看
          </p>
        </div>

        {view === "map" ? (
          <>
            {stitching ? <TacticalStitchControls stitching={stitching} /> : null}
            <TacticalMapCanvas
              projection={projection}
              instanceId={instanceId}
              selectedKey={effectiveSelectedKey}
              onSelect={onSelect}
              interaction={interaction}
              gestures={gestures}
              stitch={stitching?.view ?? null}
            />
            <aside
              data-tactical-detail="v1"
              className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface p-3"
            >
              <SelectedTacticalDetail
                projection={projection}
                selected={selected}
              />
              <TacticalLegend />
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted">此处可见</p>
                <div className="flex flex-wrap gap-1.5">
                  {[projection.self, ...projection.visibleEntities].map(entity => (
                    <button key={entity.id} type="button" onClick={() => onSelect(entitySelectionKey(entity.id))}
                      aria-pressed={effectiveSelectedKey === entitySelectionKey(entity.id)}
                      className="rounded-control border border-border px-2 py-1.5 text-xs text-fg hover:bg-elevated aria-pressed:border-brass">
                      {entity.relation === "self" ? "我" : entity.name.split(" / ")[0]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-auto space-y-1 border-t border-border pt-2 text-[11px] text-subtle">
                <p data-tactical-features={projection.knownFeatures.length > 0 ? "known" : "unknown"}>
                  {projection.knownFeatures.length > 0
                    ? `可查看 ${projection.knownFeatures.length} 处环境`
                    : "暂未发现可查看的环境。"}
                </p>
                <p data-tactical-zones={projection.knownZones.length > 0 ? "known" : "unknown"}>
                  {projection.knownZones.length > 0
                    ? `区域效果 ${projection.knownZones.length} 项`
                    : "暂无区域效果。"}
                </p>
                <p data-tactical-interactions={interaction ? "enabled" : "view-only"}>
                  {interaction
                    ? "点选人物或物件查看详情；选目标时在地图上点选。"
                    : "当前可点选查看详情。"}
                </p>
              </div>
            </aside>
          </>
        ) : (
          <TacticalTextReadout projection={projection} />
        )}
        {interaction ? (
          <TacticalPlacePanel
            projection={projection}
            interaction={interaction}
            selected={selected}
            onSelect={onSelect}
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

/** SPEC 0014 §8 (ADR 0103 decision 5): which known places to stitch onto
 * the map, listed by level, and which level to show when the chosen places
 * lie on several. The current place is always on the map. */
function TacticalStitchControls({ stitching }: { stitching: TacticalStitching }) {
  const { view } = stitching;
  const placeLevels = [...new Set(view.places.map((place) => place.placement.level))].sort((left, right) => right - left);
  const toggle = (sceneId: string, chosen: boolean) => stitching.setSceneIds(view.places
    .filter((place) => place.sceneId !== view.current.sceneId
      && (place.sceneId === sceneId ? chosen : view.chosenIds.has(place.sceneId)))
    .map((place) => place.sceneId));
  return (
    <div data-tactical-stitch-controls className="flex min-w-0 flex-col gap-2 lg:col-span-2">
      <details data-tactical-stitch className="min-w-0 rounded-control border border-border bg-surface px-3 py-2 text-xs">
        <summary className="cursor-pointer text-muted">拼合地图 · 已拼 {view.chosenIds.size} 处</summary>
        <p className="mt-2 text-subtle">选你到过的地点，按总图拼在一起看；拼合只改变显示。</p>
        {placeLevels.map((level) => (
          <fieldset key={level} data-tactical-stitch-level={level} className="mt-2 min-w-0">
            <legend className="text-[11px] text-subtle">{tacticalLevelLabel(level)}</legend>
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              {view.places.filter((place) => place.placement.level === level).map((place) => {
                const current = place.sceneId === view.current.sceneId;
                return (
                  <label key={place.sceneId} className="flex min-h-9 min-w-0 max-w-full items-center gap-1.5 text-fg">
                    <input
                      type="checkbox"
                      data-tactical-stitch-place={place.sceneId}
                      checked={view.chosenIds.has(place.sceneId)}
                      disabled={current}
                      onChange={(event) => toggle(place.sceneId, event.target.checked)}
                    />
                    <span className="min-w-0 break-words">{place.name}{current ? "（你在这里）" : ""}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </details>
      {view.levels.length > 1 ? (
        <div role="radiogroup" aria-label="显示楼层" data-tactical-level-switch className="flex min-w-0 flex-wrap gap-1.5">
          {view.levels.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              data-tactical-level={level}
              aria-checked={level === view.level}
              onClick={() => stitching.setLevel(level)}
              className={cn(ACTION_BUTTON, "aria-checked:border-brass aria-checked:bg-brass/15 aria-checked:text-brass")}
            >
              {tacticalLevelLabel(level)}{level === view.current.placement.level ? "（你在这层）" : ""}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A known place on a stitched map that the player is not in: its outline,
 * name and features, drawn dimmed and read-only where the site plan puts it. */
function StitchedPlaceShape({
  place,
  offset,
  gridId,
  labelSize,
  landformPatternId,
}: {
  place: TacticalKnownPlace;
  offset: MapPoint;
  gridId: string;
  labelSize: number;
  landformPatternId: (landform: TacticalLandform) => string;
}) {
  const bounds = pointsBounds(place.boundary.points);
  return (
    <g
      data-tactical-stitched-place={place.sceneId}
      data-tactical-place-level={place.placement.level}
      transform={`translate(${offset.x} ${offset.y})`}
      aria-hidden="true"
      className="pointer-events-none opacity-50"
    >
      <polygon
        points={polygonPoints(place.boundary.points)}
        fill={`url(#${gridId})`}
        className="stroke-stone-300 stroke-[6] [stroke-dasharray:20_12] [vector-effect:non-scaling-stroke]"
      />
      {layeredFeatures(place.features).map((feature) => (
        <g key={feature.id} data-tactical-stitched-feature={feature.id}
          className={feature.landform !== undefined ? LANDFORM_STYLE[feature.landform]
            : feature.kind === "terrain" || feature.material === undefined ? FEATURE_STYLE[feature.kind] : MATERIAL_STYLE[feature.material]}>
          <polygon points={polygonPoints(feature.polygon)} className="stroke-[2] [vector-effect:non-scaling-stroke]" />
          {feature.landform !== undefined ? (
            <polygon points={polygonPoints(feature.polygon)} fill={`url(#${landformPatternId(feature.landform)})`} className="stroke-none" />
          ) : null}
        </g>
      ))}
      <PlaceNameLabel name={place.name} x={bounds.minX} y={bounds.minY} size={labelSize} />
    </g>
  );
}

/** A place's name inside its outline, by the top-left corner, or by the
 * bottom-left one given the outline's bottom edge. */
function PlaceNameLabel({ name, x, y, size, bottom }: { name: string; x: number; y: number; size: number; bottom?: number }) {
  return (
    <text
      data-tactical-place-label={name}
      x={x + size / 2}
      y={bottom === undefined ? y + size * 1.2 : bottom - size * 0.5}
      fontSize={size}
      className="pointer-events-none fill-white stroke-black/80 font-semibold [paint-order:stroke] [stroke-width:6px]"
    >
      {name}
    </text>
  );
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
  stitch,
}: {
  projection: TacticalProjection;
  instanceId: string;
  selectedKey: string;
  onSelect: (key: string) => void;
  interaction?: TacticalInteraction;
  gestures: ReturnType<typeof mapGestures>;
  stitch: StitchView | null;
}) {
  const xs = projection.scene.boundary.points.map((point) => inches(point.x));
  const ys = projection.scene.boundary.points.map((point) => inches(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(projection.scene.gridInches, Math.max(...xs) - minX);
  const height = Math.max(projection.scene.gridInches, Math.max(...ys) - minY);
  // SPEC 0014 §8 (ADR 0103 decision 5): a stitched map keeps the current
  // place's own coordinates and widens the view to the other chosen places
  // on the level shown, each where the site plan puts it. On another level
  // the current place is only an outline and nothing on the map is picked.
  const onCurrentLevel = stitch === null || stitch.level === stitch.current.placement.level;
  const stitched = stitch === null ? [] : stitch.shown.map((place) => ({ place, offset: placeOffset(place, stitch.current) }));
  const stitchedView = stitch !== null && (stitched.length > 0 || !onCurrentLevel);
  const viewBox = stitched.reduce((box, { place, offset }) => {
    const bounds = pointsBounds(place.boundary.points, offset);
    return {
      minX: Math.min(box.minX, bounds.minX),
      minY: Math.min(box.minY, bounds.minY),
      maxX: Math.max(box.maxX, bounds.maxX),
      maxY: Math.max(box.maxY, bounds.maxY),
    };
  }, { minX, minY, maxX: minX + width, maxY: minY + height });
  const viewWidth = viewBox.maxX - viewBox.minX;
  const viewHeight = viewBox.maxY - viewBox.minY;
  const labelSize = Math.max(28, Math.round(Math.max(viewWidth, viewHeight) / 24));
  const textScale = mapTextScale(viewWidth, viewHeight);
  const captions = featureCaptions(projection, selectedKey, textScale);
  const gridId = `tactical-grid-${instanceId}-${projection.scene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const opaquePatternId = `${gridId}-opaque`;
  const propagationPatternId = `${gridId}-propagation`;
  const landformPatternId = (landform: TacticalLandform) => `${gridId}-landform-${landform}`;
  const texturePatternId = (texture: FeatureTexture) => `${gridId}-texture-${texture}`;
  const quarterGridId = `${gridId}-quarter`;
  const features = layeredFeatures(projection.knownFeatures);
  const entities = [projection.self, ...projection.visibleEntities];
  const task = interaction?.task ?? IDLE_TASK;
  const picking = onCurrentLevel && (gestures.groundPick || gestures.pointPick || gestures.aimPick);
  const targetedIds = new Set(task.kind === "creatures" ? task.refs
    : task.kind === "intent" && task.aimRef ? [task.aimRef]
      : task.kind === "help" ? [task.allyRef, task.enemyRef].filter((ref): ref is string => ref !== null)
        : task.kind === "ready" && task.triggerRef ? [task.triggerRef] : []);
  const cursor = picking ? interaction?.cursor ?? null : null;
  const start = selfPoint(projection);
  const grid = projection.scene.gridInches;
  const step = pickStep(projection);
  // A local hover point, only to show where a tentative area would sit; the
  // pick itself is still the click or the keyboard cursor (SPEC 0014 §8).
  const [hover, setHover] = useState<MapPoint | null>(null);
  const followsPointer = picking && task.kind === "area";

  function onCanvasKey(event: KeyboardEvent<SVGSVGElement>) {
    // Tokens and shapes handle their own keys.
    if (!picking || interaction === undefined || event.target !== event.currentTarget) return;
    const delta = CURSOR_KEYS[event.key];
    const base = interaction.cursor ?? { x: snapToGrid(start.x, step), y: snapToGrid(start.y, step) };
    if (delta) {
      event.preventDefault();
      // An arrow moves a cell; with Shift, a quarter cell.
      const distance = event.shiftKey ? step : grid;
      interaction.setCursor(clampToScene({ x: base.x + delta[0] * distance, y: base.y + delta[1] * distance }, projection));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      gestures.pickPoint(base);
    }
  }

  return (
    <div
      data-tactical-canvas="v1"
      data-tactical-picking={!onCurrentLevel ? "none" : gestures.pointPick ? task.kind : gestures.aimPick ? "aim" : gestures.groundPick ? "destination" : "none"}
      data-tactical-stitched-view={stitch === null ? undefined : stitchedView ? String(stitch.level) : "none"}
      className="aspect-[4/3] min-w-0 overflow-hidden rounded-panel border border-border bg-[#151411] p-3 lg:h-[clamp(16rem,34dvh,24rem)] lg:aspect-auto"
    >
      <svg
        role="group"
        aria-label={`${projection.scene.name}战术地图${stitch !== null && stitchedView
          ? `；拼合显示${tacticalLevelLabel(stitch.level)}${stitched.length > 0 ? `的${stitched.map(({ place }) => place.name).join("、")}` : ""}，只读`
          : ""}${picking ? "；点地图或用方向键移动选点框（按住 Shift 每次移动四分之一格）、按回车选定位置" : ""}`}
        tabIndex={picking ? 0 : undefined}
        onKeyDown={onCanvasKey}
        width={viewWidth}
        height={viewHeight}
        viewBox={`${viewBox.minX} ${viewBox.minY} ${viewWidth} ${viewHeight}`}
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
              className="stroke-white/15 stroke-[1.5]"
            />
          </pattern>
          <pattern
            id={quarterGridId}
            width={step}
            height={step}
            patternUnits="userSpaceOnUse"
          >
            <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" className="stroke-white/10 stroke-[1] [stroke-dasharray:2_4]" />
          </pattern>
          {FEATURE_TEXTURES.map((texture) => (
            <pattern
              key={texture}
              id={texturePatternId(texture)}
              data-texture-pattern={texture}
              width={FEATURE_TEXTURE[texture].size}
              height={FEATURE_TEXTURE[texture].size}
              patternUnits="userSpaceOnUse"
            >
              <path d={FEATURE_TEXTURE[texture].path} fill="none" className={FEATURE_TEXTURE[texture].className} />
            </pattern>
          ))}
          <pattern
            id={opaquePatternId}
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M -7 7 L 7 -7 M 0 28 L 28 0 M 21 35 L 35 21"
              fill="none"
              className="stroke-white/30 stroke-[2.5]"
            />
          </pattern>
          <pattern
            id={propagationPatternId}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="6" cy="6" r="2.5" className="fill-white/55" />
            <circle cx="18" cy="18" r="2.5" className="fill-white/55" />
          </pattern>
          {LANDFORMS.map((landform) => (
            <pattern
              key={landform}
              id={landformPatternId(landform)}
              data-landform-pattern={landform}
              width={LANDFORM_TEXTURE[landform].size}
              height={LANDFORM_TEXTURE[landform].size}
              patternUnits="userSpaceOnUse"
            >
              <path d={LANDFORM_TEXTURE[landform].path} fill="none" className={LANDFORM_TEXTURE[landform].className} />
            </pattern>
          ))}
        </defs>
        {stitched.map(({ place, offset }) => (
          <StitchedPlaceShape
            key={place.sceneId}
            place={place}
            offset={offset}
            gridId={gridId}
            labelSize={labelSize}
            landformPatternId={landformPatternId}
          />
        ))}
        {stitch === null || onCurrentLevel ? null : (
          <g data-tactical-current-outline={projection.scene.id} aria-hidden="true" className="pointer-events-none">
            <polygon
              points={polygonPoints(projection.scene.boundary.points)}
              fill="none"
              className="stroke-brass/80 stroke-[6] [stroke-dasharray:10_10] [vector-effect:non-scaling-stroke]"
            />
            {/* By the bottom edge, clear of the names of the places on this level. */}
            <PlaceNameLabel name={`${projection.scene.name}（你在${tacticalLevelLabel(stitch.current.placement.level)}）`}
              x={minX} y={minY} bottom={minY + height} size={labelSize} />
          </g>
        )}
        {onCurrentLevel ? (
          <>
            <polygon
              data-scene-floor
              points={polygonPoints(projection.scene.boundary.points)}
              className="fill-[#211d18] stroke-none"
            />
            <polygon
              data-scene-boundary={projection.scene.id}
              points={polygonPoints(projection.scene.boundary.points)}
              fill={`url(#${gridId})`}
              className="stroke-brass/80 stroke-[1.5] [vector-effect:non-scaling-stroke]"
            />
            {picking ? (
              <polygon
                data-tactical-pick-grid={step}
                points={polygonPoints(projection.scene.boundary.points)}
                fill={`url(#${quarterGridId})`}
                className="pointer-events-none stroke-none"
              />
            ) : null}
            {stitchedView ? <PlaceNameLabel name={projection.scene.name} x={minX} y={minY} size={labelSize} /> : null}
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
                onMouseMove={(event) => {
                  if (!followsPointer) return;
                  const point = svgPointFromEvent(event);
                  setHover(point === null ? null
                    : clampToScene({ x: snapToGrid(point.x, step), y: snapToGrid(point.y, step) }, projection));
                }}
                onMouseLeave={() => setHover(null)}
              />
            ) : null}
            {features.map((feature) => {
              const key = featureSelectionKey(feature.id);
              return (
                <TacticalFeatureShape
                  key={feature.id}
                  feature={feature}
                  selected={selectedKey === key}
                  // Ground terrain does not stop a click from picking where to go;
                  // an aimed attack can guess a point behind any feature.
                  passThrough={gestures.pointPick || gestures.aimPick || (gestures.groundPick && feature.kind === "terrain")}
                  onSelect={() => onSelect(key)}
                  opaquePatternId={opaquePatternId}
                  propagationPatternId={propagationPatternId}
                  landformPatternId={landformPatternId}
                  texturePatternId={texturePatternId}
                />
              );
            })}
            {projection.knownZones.map((zone) => {
              const key = zoneSelectionKey(zone.id);
              return (
                <TacticalZoneShape
                  key={zone.id}
                  zone={zone}
                  selected={selectedKey === key}
                  passThrough={picking}
                  textScale={textScale}
                  onSelect={() => onSelect(key)}
                />
              );
            })}
            {interaction ? (
              <TacticalTaskHints projection={projection} task={task} cursor={cursor} hover={followsPointer ? hover : null} textScale={textScale} />
            ) : null}
            {entities.map((entity) => {
              const key = entitySelectionKey(entity.id);
              return (
                <TacticalEntityMark
                  key={entity.id}
                  entity={entity}
                  currentActor={entity.id === projection.encounter?.activeEntityId}
                  selected={selectedKey === key}
                  elevationLabel={tokenElevationLabel(entity, projection.knownFeatures)}
                  textScale={textScale}
                  targeted={targetedIds.has(entity.id)}
                  passThrough={gestures.pointPick}
                  onSelect={() => gestures.activateEntity(entity)}
                />
              );
            })}
            <g data-tactical-annotations>
              {features.map((feature) => (
                <FeatureAnnotation key={feature.id} feature={feature} caption={captions.get(feature.id)} scale={textScale} />
              ))}
            </g>
            {interaction ? (
              <TacticalTaskMarks projection={projection} task={task} cursor={cursor} textScale={textScale} />
            ) : null}
          </>
        ) : null}
      </svg>
    </div>
  );
}

/** Where the player's picks are: the destination, the waypoints in order, an
 * area's origin and direction, and the keyboard cursor. These are the
 * player's own picks, not a preview of the result. */
/** SPEC 0014 §8: the reach or range an ability names, for the hint ring. */
function rangeOf(ability: CombatControlAbility): { feet: number; longFeet?: number; reach: boolean } | null {
  const target = ability.target;
  if (target.kind === "creatures") {
    if (target.reachFeet !== undefined) return { feet: target.reachFeet, reach: true };
    if (target.rangeFeet !== undefined) {
      return { feet: target.rangeFeet, ...(target.longRangeFeet ? { longFeet: target.longRangeFeet } : {}), reach: false };
    }
    return null;
  }
  return target.kind === "area" && target.origin === "point" && target.rangeFeet !== undefined
    ? { feet: target.rangeFeet, reach: false }
    : null;
}

/** A hint only: a ring at the stated reach or range from the edge of the
 * actor's own space. It neither decides nor marks who is within; cover,
 * height and sight are Rules' (SPEC 0014 §8). */
function RangeRings({
  projection,
  range,
  textScale,
}: {
  projection: TacticalProjection;
  range: { feet: number; longFeet?: number; reach: boolean };
  textScale: number;
}) {
  const center = selfPoint(projection);
  const half = Math.max(inches(projection.self.footprint.width), inches(projection.self.footprint.depth)) / 2;
  const radius = half + range.feet * 12;
  // The label sits on the ring where the ring crosses the map, so a long
  // range still shows its number.
  const bounds = sceneBounds(projection);
  const margin = 30 * textScale;
  const middle = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const label = Array.from({ length: 72 }, (_, step) => step * 5 * Math.PI / 180)
    .map((angle) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }))
    .filter((point) => point.x > bounds.minX + margin && point.x < bounds.maxX - margin
      && point.y > bounds.minY + margin && point.y < bounds.maxY - margin)
    .sort((left, right) => Math.hypot(left.x - middle.x, left.y - middle.y) - Math.hypot(right.x - middle.x, right.y - middle.y))[0];
  return (
    <g data-tactical-range-ring={range.feet}>
      {range.longFeet ? (
        <circle
          data-tactical-long-range-ring={range.longFeet}
          cx={center.x}
          cy={center.y}
          r={half + range.longFeet * 12}
          fill="none"
          className="stroke-brass/35 stroke-[1] [stroke-dasharray:2_4] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      <circle
        cx={center.x}
        cy={center.y}
        r={radius}
        className="fill-brass/[0.06] stroke-brass/70 stroke-[1.5] [stroke-dasharray:6_4] [vector-effect:non-scaling-stroke]"
      />
      {label ? (
        <text
          data-tactical-range-label
          x={label.x}
          y={label.y - 8 * textScale}
          fontSize={22 * textScale}
          textAnchor="middle"
          className="fill-brass [paint-order:stroke] stroke-[#151411] [stroke-width:4px]"
        >
          {range.reach ? "触及" : "射程"} {range.feet} 尺
        </text>
      ) : null}
    </g>
  );
}

type AreaTarget = Extract<CombatControlTarget, { kind: "area" }>;

/** Where to sketch an area: at the picked origin, or tentatively at the
 * pointer while the origin or direction is still open; outside an encounter
 * on the creature it is aimed at. */
function areaShapeHint(projection: TacticalProjection, task: MapTask, pointer: MapPoint | null):
  { target: AreaTarget; origin: MapPoint; toward: MapPoint | null; tentative: boolean } | null {
  if (task.kind === "area" && task.ability.target.kind === "area") {
    const target = task.ability.target;
    if (task.origin === null) {
      return pointer === null ? null : { target, origin: pointer, toward: null, tentative: true };
    }
    const toward = task.direction ?? (target.needsDirection ? pointer : null);
    return { target, origin: task.origin, toward, tentative: target.needsDirection && task.direction === null };
  }
  if (task.kind === "intent" && task.ability.target.kind === "area" && task.aimRef !== null) {
    const aimed = [projection.self, ...projection.visibleEntities].find((entity) => entity.id === task.aimRef);
    return aimed === undefined ? null
      : { target: task.ability.target, origin: { x: inches(aimed.position.x), y: inches(aimed.position.y) }, toward: null, tentative: true };
  }
  return null;
}

/** A sketch of an area's size and shape at its origin, pointing the way the
 * player chose: a circle for a sphere or cylinder, a square for a cube, a
 * triangle as wide as it is long for a cone, a 5-foot strip for a line.
 * Without a direction yet, a pointed shape shows only how far it reaches.
 * Who is inside is Rules' to settle (SPEC 0014 §§5、8). */
function AreaShape({
  target,
  origin,
  toward,
  tentative,
}: {
  target: AreaTarget;
  origin: MapPoint;
  toward: MapPoint | null;
  tentative: boolean;
}) {
  const size = target.sizeFeet * 12;
  const className = cn(
    "stroke-violet-200 stroke-[1.5] [vector-effect:non-scaling-stroke]",
    tentative ? "fill-violet-400/10 [stroke-dasharray:4_4]" : "fill-violet-400/20",
  );
  const common = { "data-tactical-area-shape": target.shape, "data-tactical-area-tentative": String(tentative) };
  if (target.shape === "sphere" || target.shape === "cylinder") {
    return <circle {...common} cx={origin.x} cy={origin.y} r={size} className={className} />;
  }
  const dx = toward === null ? 0 : toward.x - origin.x;
  const dy = toward === null ? 0 : toward.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return target.shape === "cube" && !target.needsDirection
      ? <rect {...common} x={origin.x - size / 2} y={origin.y - size / 2} width={size} height={size} className={className} />
      : <circle {...common} cx={origin.x} cy={origin.y} r={size} className={cn(className, "fill-none [stroke-dasharray:2_6]")} />;
  }
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const halfWidth = target.shape === "line" ? 30 : size / 2;
  const far = { x: origin.x + ux * size, y: origin.y + uy * size };
  const points = target.shape === "cone"
    ? [origin, { x: far.x + px * halfWidth, y: far.y + py * halfWidth }, { x: far.x - px * halfWidth, y: far.y - py * halfWidth }]
    : [
        { x: origin.x + px * halfWidth, y: origin.y + py * halfWidth },
        { x: far.x + px * halfWidth, y: far.y + py * halfWidth },
        { x: far.x - px * halfWidth, y: far.y - py * halfWidth },
        { x: origin.x - px * halfWidth, y: origin.y - py * halfWidth },
      ];
  return <polygon {...common} points={points.map((point) => `${point.x},${point.y}`).join(" ")} className={className} />;
}

/** Under the tokens: the reach or range ring of the ability being aimed and
 * the sketch of its area. */
function TacticalTaskHints({
  projection,
  task,
  cursor,
  hover,
  textScale,
}: {
  projection: TacticalProjection;
  task: MapTask;
  cursor: MapPoint | null;
  /** Where the pointer is, for a tentative area. */
  hover: MapPoint | null;
  textScale: number;
}) {
  const ability = task.kind === "creatures" || task.kind === "area" || task.kind === "intent" ? task.ability : null;
  const range = ability === null ? null : rangeOf(ability);
  const area = areaShapeHint(projection, task, cursor ?? hover);
  if (range === null && area === null) return null;
  return (
    <g data-tactical-task-hints={task.kind} className="pointer-events-none">
      {range ? <RangeRings projection={projection} range={range} textScale={textScale} /> : null}
      {area ? (
        <AreaShape target={area.target} origin={area.origin} toward={area.toward} tentative={area.tentative} />
      ) : null}
    </g>
  );
}

/** Above the tokens: where the player's picks are -- the destination, the
 * waypoints in order, an area's origin and direction, and the keyboard
 * cursor. A destination or the cursor is drawn the size of the player's own
 * space. These are the player's own picks, not a preview of the result. */
function TacticalTaskMarks({
  projection,
  task,
  cursor,
  textScale,
}: {
  projection: TacticalProjection;
  task: MapTask;
  cursor: MapPoint | null;
  textScale: number;
}) {
  const grid = projection.scene.gridInches;
  const start = selfPoint(projection);
  const width = inches(projection.self.footprint.width);
  const depth = inches(projection.self.footprint.depth);
  const marker = 12 * textScale;
  return (
    <g data-tactical-task-marks={task.kind} className="pointer-events-none">
      {task.kind === "destination" ? (
        <rect
          data-tactical-destination={`${task.point.x},${task.point.y}`}
          x={task.point.x - width / 2}
          y={task.point.y - depth / 2}
          width={width}
          height={depth}
          rx={Math.min(width, depth) / 5}
          fill="none"
          className="stroke-brass stroke-[2.5] [stroke-dasharray:6_4] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      {task.kind === "path" && task.waypoints.length > 0 ? (
        <>
          <polyline
            data-tactical-path={[start, ...task.waypoints].map((point) => `${point.x},${point.y}`).join(" ")}
            points={[start, ...task.waypoints].map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            className="stroke-brass stroke-[2.5] [stroke-dasharray:6_4] [vector-effect:non-scaling-stroke]"
          />
          {task.waypoints.map((point, index) => (
            <g key={`${point.x},${point.y},${index}`}>
              <circle cx={point.x} cy={point.y} r={marker} className="fill-brass stroke-black/70 stroke-[1] [vector-effect:non-scaling-stroke]" />
              <text
                x={point.x}
                y={point.y}
                fontSize={marker * 1.2}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-black font-semibold"
              >
                {index + 1}
              </text>
            </g>
          ))}
        </>
      ) : null}
      {task.kind === "creatures" && task.point ? (
        <circle
          data-tactical-aimed-point={`${task.point.x},${task.point.y}`}
          cx={task.point.x}
          cy={task.point.y}
          r={grid / 3}
          fill="none"
          className="stroke-danger stroke-[2.5] [stroke-dasharray:6_4] [vector-effect:non-scaling-stroke]"
        />
      ) : null}
      {task.kind === "area" && task.origin ? (
        <>
          <circle
            data-tactical-area-origin={`${task.origin.x},${task.origin.y}`}
            cx={task.origin.x}
            cy={task.origin.y}
            r={marker}
            className="fill-violet-300/80 stroke-white stroke-[1] [vector-effect:non-scaling-stroke]"
          />
          {task.direction ? (
            <line
              data-tactical-area-direction={`${task.direction.x},${task.direction.y}`}
              x1={task.origin.x}
              y1={task.origin.y}
              x2={task.direction.x}
              y2={task.direction.y}
              className="stroke-violet-200 stroke-[1.5] [stroke-dasharray:4_3] [vector-effect:non-scaling-stroke]"
            />
          ) : null}
        </>
      ) : null}
      {cursor ? (
        <rect
          data-tactical-cursor={`${cursor.x},${cursor.y}`}
          x={cursor.x - width / 2}
          y={cursor.y - depth / 2}
          width={width}
          height={depth}
          fill="none"
          className="stroke-white stroke-[2] [vector-effect:non-scaling-stroke]"
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
        {feature.leadsTo ? (
          <p data-tactical-leads-to={feature.leadsTo.sceneId} className="mt-1 text-xs text-fg">
            通往{feature.leadsTo.name} · {feature.leadsTo.passable ? "现在可以通过" : "现在过不去"}
          </p>
        ) : null}
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
    <details className="rounded-control border border-border px-3 py-2 text-xs">
      <summary className="text-muted">查看图例</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
        <p><span className="mr-1 text-brass">■</span>自己</p>
        <p><span className="mr-1 text-moss">■</span>盟友</p>
        <p><span className="mr-1 text-danger">■</span>敌对</p>
        <p><span className="mr-1 text-stone-400">■</span>中立</p>
        <p><span className="mr-1 text-stone-400">▤</span>墙（石纹）</p>
        <p><span className="mr-1 text-amber-600">▥</span>门（关着有门板，开着是虚框）</p>
        <p><span className="mr-1 text-amber-300">■</span>可互动物</p>
        <p><span className="mr-1 text-amber-700">⊠</span>可破坏物</p>
        <p><span className="mr-1 text-yellow-700">▒</span>地面（泥地、碎石）</p>
        <p><span className="mr-1 text-violet-300">▧</span>区域效果</p>
        <p><span className="mr-1 text-brass">◌</span>射程或触及（示意）</p>
        <p><span className="mr-1 text-violet-200">◇</span>法术范围（示意）</p>
      </div>
      <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11px] text-subtle">
        <p>实线边阻挡移动；虚线边可通过。</p>
        <p>斜纹阻挡视线；点纹阻断区域传播。</p>
        <p>圆标里的 ½ / ¾ / 全 表示掩护等级。</p>
        <p>沟、水域、矮墙、台阶、崖壁各有底色和纹理。</p>
        <p>人物旁的 −/+ 尺：在沟里、水里或高处时，是相对旁边地面的高差。</p>
        <p>选点时按四分之一格（2.5 尺）吸附；方向键每次移动一格，按住 Shift 移动四分之一格。</p>
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
      className="min-w-0 max-h-[min(50dvh,22rem)] overflow-y-auto break-words rounded-panel border border-border bg-surface px-4 py-3 text-sm outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-brass lg:col-span-2"
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
      {projection.textualReadout.places ? (
        <div data-tactical-readout-places className="mt-4 border-t border-border pt-3">
          <p className="font-display text-sm">已知地点</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            {projection.textualReadout.places.map((entry, index) => (
              <li key={projection.knownPlaces?.[index]?.sceneId ?? index}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type ClimbChoice = { direction: "down" | "up" | "across"; label: string; sentence: string };

/** SPEC 0014 §4 (ADR 0098): the climbs or swims the combat map offers on a
 * ditch, step, low wall, cliff or water, by where the player stands now,
 * each the plain sentence the KP adjudicates. */
function climbChoices(feature: TacticalKnownFeature, self: TacticalEntity): ClimbChoice[] {
  const landform = feature.landform;
  if (landform === undefined || (landform !== "water" && !CLIMBABLE_LANDFORMS.has(landform))) return [];
  const name = feature.label;
  const standing = terrainFootingOf(self.position, [feature]) !== null;
  if (landform === "water") {
    return standing ? [{ direction: "up", label: "游上岸", sentence: `我从${name}里游上岸。` }]
      : [{ direction: "down", label: "下水", sentence: `我下到${name}里。` },
        { direction: "across", label: "游过去", sentence: `我游过${name}。` }];
  }
  if (HOLLOW_LANDFORMS.has(landform)) {
    return standing ? [{ direction: "up", label: "爬出来", sentence: `我从${name}里爬出来。` }]
      : [{ direction: "down", label: "爬下去", sentence: `我爬下${name}。` },
        { direction: "across", label: "爬过去", sentence: `我爬过${name}。` }];
  }
  return standing ? [{ direction: "down", label: "爬下来", sentence: `我从${name}上爬下来。` }]
    : [{ direction: "up", label: "爬上去", sentence: `我爬上${name}。` },
      { direction: "across", label: "爬过去", sentence: `我爬过${name}。` }];
}

/** A jump's button text: what it does and what it takes. */
function jumpLabel(jump: CombatJumpChoice, feature: TacticalKnownFeature): string {
  const checks = [...(jump.clearCheck ? ["运动 DC 10"] : []), ...(jump.landingCheck ? ["落地特技 DC 10"] : [])];
  return `${jump.abilityRef === "action:long-jump" ? "跳过" : "跳上"}${feature.label}（${jump.running ? "助跑" : "原地"}，花 ${jump.costFeet} 尺${
    checks.length > 0 ? `，${checks.join("，")}` : ""}）`;
}

/** SPEC 0014 §§4、8 (ADR 0091, 0098, 0103): what the map itself offers from
 * its ground and features: outside an encounter, walking to a picked point
 * and the doors that lead elsewhere; on the combat map, the terrain to jump,
 * climb or swim. Abilities, the turn and the confirmation of every pick are
 * in the character panel's action list and the bar above the composer. */
function TacticalPlacePanel({
  projection,
  interaction,
  selected,
  onSelect,
  mapVisible,
}: {
  projection: TacticalProjection;
  interaction: TacticalInteraction;
  selected: TacticalSelection;
  onSelect: (key: string) => void;
  /** In the text readout a point can only be picked from the map view. */
  mapVisible: boolean;
}) {
  const { actions, task, setTask } = interaction;
  const { inEncounter, myTurn } = playerEncounter(projection);
  const busy = actions.busy;
  const combatDisabled = busy || !myTurn;
  // SPEC 0014 §8 (ADR 0103 decision 4): outside an encounter each door or
  // opening that leads elsewhere offers going there, as the player's sentence.
  const doors = inEncounter ? [] : doorsElsewhere(projection);
  // SPEC 0014 §4 (ADR 0098): on the combat map a jump goes straight to
  // Rules; a climb or swim is the player's sentence. Either starts from a
  // feature picked on the map or from the list.
  const jumps = actions.controls?.jumps ?? [];
  const terrainFeatures = inEncounter
    ? projection.knownFeatures.filter((feature) => jumps.some((jump) => jump.featureId === feature.id)
      || climbChoices(feature, projection.self).length > 0)
    : [];
  const terrainFeature = selected.kind === "feature" && terrainFeatures.some((feature) => feature.id === selected.value.id)
    ? selected.value : null;

  return (
    <section
      aria-label="地图上的移动与地形"
      data-tactical-actions={inEncounter ? "combat" : "exploration"}
      data-tactical-my-turn={String(myTurn)}
      className="min-w-0 space-y-3 break-words rounded-panel border border-border bg-surface p-3 text-xs [overflow-wrap:anywhere] lg:col-span-2"
    >
      {inEncounter ? (
        terrainFeatures.length === 0 ? (
          <p className="text-subtle">能力在角色栏的“行动”里；移动和结束回合在输入框上方。</p>
        ) : null
      ) : (
        <div className="space-y-1">
          <p className="text-muted">场内移动</p>
          <p className="text-subtle">
            {task.kind === "destination"
              ? "目的地已在地图上用虚线方框标出，在输入框上方确认。"
              : mapVisible
                ? "点地图上的空地选目的地；也可用方向键移动选点框，按回车选定。"
                : "要移动位置，请切换到“地图”点选空地；也可以直接用文字描述你的行动。"}
          </p>
        </div>
      )}
      {doors.length > 0 ? (
        <div data-tactical-go-to-list className="space-y-2 border-t border-border pt-2">
          <p className="text-muted">出口与通路</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {doors.map((door) => (
              <button
                key={door.id}
                type="button"
                data-tactical-go-to={door.id}
                data-tactical-go-to-passable={String(door.leadsTo.passable)}
                aria-pressed={task.kind === "goTo" && task.featureId === door.id}
                disabled={busy}
                onClick={() => {
                  onSelect(featureSelectionKey(door.id));
                  setTask({ kind: "goTo", featureId: door.id, sentence: goToSentence(door), passable: door.leadsTo.passable });
                }}
                className={cn(ACTION_BUTTON, "flex max-w-full flex-col items-start gap-1 whitespace-normal break-words px-3 py-2.5 text-left")}
              >
                <span className="text-fg">{door.label}</span>
                <span className="text-xs text-muted">
                  → {door.leadsTo.name}{door.leadsTo.passable ? "" : " · 暂时无法通过"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {terrainFeatures.length > 0 ? (
        <div data-tactical-terrain className="space-y-2">
          <label className="flex min-w-0 max-w-full items-center gap-1.5 text-muted">
            <span className="shrink-0">地形</span>
            <select
              data-tactical-terrain-select
              value={terrainFeature === null ? "" : featureSelectionKey(terrainFeature.id)}
              onChange={(event) => {
                if (event.target.value) onSelect(event.target.value);
              }}
              className="min-h-9 min-w-0 max-w-[14rem] rounded-control border border-border bg-bg px-2 text-xs text-fg"
            >
              <option value="" disabled>在地图上点选，或从这里选</option>
              {terrainFeatures.map((feature) => (
                <option key={feature.id} value={featureSelectionKey(feature.id)}>{feature.label}</option>
              ))}
            </select>
          </label>
          {terrainFeature === null ? (
            <p className="text-subtle">选一处地形，看能怎样跳过、跳上、攀爬或游过去。</p>
          ) : (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {jumps.filter((jump) => jump.featureId === terrainFeature.id).map((jump) => (
                <button
                  key={jump.abilityRef}
                  type="button"
                  data-tactical-jump={jump.abilityRef}
                  data-tactical-jump-feature={jump.featureId}
                  disabled={combatDisabled}
                  onClick={() => {
                    void actions.useAbility(jump.abilityRef, { kind: "point", position: structuredClone(jump.landing) })
                      .then((done) => { if (done) setTask(IDLE_TASK); });
                  }}
                  className={cn(ACTION_BUTTON, "max-w-full whitespace-normal break-words text-left")}
                >
                  {jumpLabel(jump, terrainFeature)}
                </button>
              ))}
              {climbChoices(terrainFeature, projection.self).map((choice) => (
                <button
                  key={choice.direction}
                  type="button"
                  data-tactical-climb={choice.direction}
                  aria-pressed={task.kind === "climb" && task.sentence === choice.sentence}
                  disabled={combatDisabled}
                  title="交给 KP 裁定：是否需要运动检定，失败会怎样"
                  onClick={() => setTask({ kind: "climb", featureId: terrainFeature.id, sentence: choice.sentence })}
                  className={ACTION_BUTTON}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
