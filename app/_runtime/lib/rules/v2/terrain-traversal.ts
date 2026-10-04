import { RulesValidationError } from "../errors";
import {
  analyzeCombatMovement,
  canonicalCombatPoint,
  pathLengthMilliInches,
  rectangularFeatureEntity,
  terrainFooting,
  type CanonicalCombatPoint,
  type TerrainFooting,
} from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { isCanonicalTacticalGeometry, isHollowTacticalFeature, type CanonicalTacticalFeature } from "../profiles/tactical-geometry";
import { besideTarget, footprintInsidePolygon, pointInPolygonInclusive } from "./carry";
import { footprintOverlapsPolygon, offsetAlong, towardEachEdge, towardNearestPoint, type Point } from "./character-jump";
import { activeEncounter } from "./combat-encounters";
import { conditionMechanics, conditionSpeed } from "./condition-mechanics";
import { grappledBy } from "./contest";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { abilityScoreFor } from "./proficiency";
import { planSceneApproach } from "./scene-approach";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

// SPEC 0014 §4 (ADR 0098): climbing, swimming, the high jump and falling
// outside encounters, on the terrain the map records.
//
// Heights. The floor beside a feature is its `elevation`. A creature in a
// ditch stands on the bottom, `depth` below the rim. A swimmer floats at the
// surface with half its height (at least an inch) under water, or stands on
// the bottom of water shallower than that. On a step, low wall or cliff it
// stands at the top, `height` above the floor, its centre strictly over it.
//
// Where it ends. As for the long jump (planJump): the footprint clear of every
// other impassable feature, inside the scene, on nobody, and reached without
// crossing anything else impassable. Moves from the floor go along the line
// from the actor through the nearest point of the feature: down into a
// hollow at the first spot its footprint fits inside, onto a top at the
// first spot its centre is over it, across at the first spot past the
// feature. Moves out of a hollow or off a top take the first spot clear of
// the feature toward its nearest edge, then the next nearest edge.
//
// Rules does not roll Athletics here; whether a move takes a check, its DC
// and what failure means are the KP's, which may put a fall on the failure.

export type TerrainWay = "climb" | "swim";
export type TerrainDirection = "down" | "up" | "across";
export type TerrainMove =
  | Readonly<{ kind: TerrainWay; direction: TerrainDirection }>
  | Readonly<{ kind: "jumpOnto" }>;

export type TerrainRejection =
  | "terrain:actor-not-placed" | "terrain:inside-encounter" | "terrain:feature-unavailable" | "terrain:cannot-move"
  | "terrain:while-holding" | "terrain:wrong-landform" | "terrain:not-on-floor" | "terrain:not-beside" | "terrain:not-inside"
  | "terrain:not-on-top" | "terrain:already-inside" | "terrain:already-on-top" | "terrain:strength-unknown" | "terrain:too-high"
  | "terrain:no-landing" | "terrain:no-route";

export type TerrainRejected = Readonly<{
  kind: "rejected";
  code: "missingPrerequisite" | "privateOrUnknownReference" | "worldLawViolation";
  reason: TerrainRejection;
}>;

/** A move from where the actor stands now. Climbing and swimming cost one
 * extra foot per foot, none with a climb or swim speed (SRD 5.1); outside an
 * encounter that cost is recorded, not spent. A high jump also says whether
 * it ran and how high it could reach. */
export type TerrainMovePlan =
  | Readonly<{
      kind: "accepted"; move: TerrainMove; featureId: string; from: CanonicalCombatPoint; to: CanonicalCombatPoint;
      distanceMilliInches: string; movementCostMilliInches: string; running?: boolean; maxHeightInches?: string;
    }>
  | TerrainRejected;

/** SPEC 0014 §4 (ADR 0098): where the actor stands first (`start`) and the
 * move from there. */
export type TerrainTraversal =
  | Readonly<Extract<TerrainMovePlan, { kind: "accepted" }> & { start: CanonicalCombatPoint }>
  | TerrainRejected;

/** SPEC 0014 §4 (ADR 0098): a fall, 1d6 bludgeoning per full 10 feet of
 * drop, at most 20d6; the actor lands prone, unless it fell into water. */
export type TerrainFallPlan =
  | Readonly<{ kind: "accepted"; featureId: string; from: CanonicalCombatPoint; to: CanonicalCombatPoint; dropInches: string; damageDice: number;
      landedProne: boolean }>
  | TerrainRejected;

export type CharacterClimbedPayload = {
  characterId: string;
  sceneId: string;
  featureId: string;
  way: TerrainWay;
  direction: TerrainDirection;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
  distanceMilliInches: string;
  movementCostMilliInches: string;
};

export type CharacterJumpedOntoPayload = {
  characterId: string;
  sceneId: string;
  featureId: string;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
  running: boolean;
};

/** `damageRolls` are the d6 faces of the fall's damage, none below 10 feet;
 * `landedProne` is false only for a fall into water. */
export type CharacterFellPayload = {
  characterId: string;
  sceneId: string;
  featureId: string;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
  dropInches: string;
  damageRolls: number[];
  landedProne: boolean;
};

const RAISED_LANDFORMS: ReadonlySet<unknown> = new Set(["cliff", "lowWall", "step"]);
const CLIMBABLE_LANDFORMS: ReadonlySet<unknown> = new Set(["cliff", "ditch", "lowWall", "step"]);
/** SRD 5.1 high jump: after a 10-foot run-up, 3 + the Strength modifier feet. */
const RUN_UP_INCHES = 120n;
/** SRD 5.1: 1d6 per 10 feet fallen, to a maximum of 20d6. */
const FALL_INCHES_PER_DIE = 120n;
const MAX_FALL_DICE = 20n;
/** Next to a feature: within 5 feet of it across the floor. */
const BESIDE_INCHES = 60n;
/** How far past the first clear landing a move looks for a free one: far
 * enough to step past someone of its size standing there. */
const LANDING_SLACK_INCHES = 120n;
/** Start spots along an edge that is not part of an axis-aligned rectangle. */
const EDGE_STEP_INCHES = 30n;
const UNSIGNED = /^(0|[1-9][0-9]*)$/;

type Context = {
  kind: "context";
  actorId: string;
  sceneId: string;
  scene: JsonRecord;
  feature: CanonicalTacticalFeature;
  polygon: Point[];
  mover: JsonRecord;
  from: CanonicalCombatPoint;
  footing: TerrainFooting;
  others: JsonRecord[];
  boundary: Point[];
  /** The scene with this feature taken out: it does not block its own move. */
  cleared: JsonRecord;
  span: bigint;
};

type Landing = { to: CanonicalCombatPoint; path: CanonicalCombatPoint[] };

const reject = (code: TerrainRejected["code"], reason: TerrainRejection): TerrainRejected => ({ kind: "rejected", code, reason });

/** Who may move and on what, judged on the authoritative state as the long
 * jump is: placed, outside an encounter, a feature it can see, able to move
 * and holding nobody. */
function terrainContext(state: AuthoritativeWorldState, actorId: string, featureId: string): Context | TerrainRejected {
  const actor = state.entities[actorId], mover = state.combatRuntime.entities[actorId];
  const scene = actor === undefined ? undefined : state.combatRuntime.scenes[actor.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  const from = isRecord(mover) ? canonicalCombatPoint(mover.position) : undefined;
  if (actor?.tenureStatus !== "active" || !isRecord(mover) || mover.sceneId !== actor.sceneId || from === undefined
    || !isRecord(mover.footprint) || !isRecord(scene) || !isCanonicalTacticalGeometry(geometry)) {
    return reject("missingPrerequisite", "terrain:actor-not-placed");
  }
  if (activeEncounter(state, actorId) !== undefined) return reject("missingPrerequisite", "terrain:inside-encounter");
  const feature = geometry.obstacles.find(candidate => candidate.featureId === featureId);
  if (feature === undefined || !spatialRecordVisibleTo(state, { ...feature, id: feature.featureId }, actorId)) {
    return reject("privateOrUnknownReference", "terrain:feature-unavailable");
  }
  const walk = isRecord(mover.speedInches) ? mover.speedInches.walk : undefined;
  if (!conditionMechanics(state, actorId).canMove || typeof walk !== "string" || !UNSIGNED.test(walk)
    || conditionSpeed(state, actorId, walk).speed === "0") return reject("missingPrerequisite", "terrain:cannot-move");
  if (grappledBy(state, actorId).length > 0) return reject("missingPrerequisite", "terrain:while-holding");
  // What the geometry reads of the mover, as for a walk (planSceneApproach).
  const body: JsonRecord = { id: actorId, entityId: actorId, sceneId: actor.sceneId, footprint: structuredClone(mover.footprint),
    ...(typeof mover.sizeCategory === "string" ? { sizeCategory: mover.sizeCategory } : {}) };
  const boundary = geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
  const xs = boundary.map(point => point.x), ys = boundary.map(point => point.y);
  return {
    kind: "context", actorId, sceneId: actor.sceneId, scene, feature, mover: body, from,
    polygon: feature.polygon.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) })),
    footing: terrainFooting(scene, from),
    others: Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
      && entity.sceneId === actor.sceneId && String(entity.id ?? entity.entityId) !== actorId),
    boundary,
    cleared: { ...scene, geometry: { ...geometry, obstacles: geometry.obstacles.filter(candidate => candidate.featureId !== featureId) } },
    span: max(xs) - min(xs) + max(ys) - min(ys),
  };
}

/** SPEC 0014 §4 (ADR 0098): where `move` across, into, out of or onto
 * `featureId` takes the actor from where it stands now. Climbing works on a
 * ditch, step, low wall or cliff, swimming on water, the high jump onto a
 * step, low wall or cliff. A move from the floor starts beside the feature
 * at its level; climbing up out of a hollow starts inside it, and climbing
 * down a raised feature starts on top of it. Who may act and why is the
 * caller's to check. */
export function planTerrainMove(state: AuthoritativeWorldState, actorId: string, featureId: string, move: TerrainMove): TerrainMovePlan {
  const ctx = terrainContext(state, actorId, featureId);
  if (ctx.kind === "rejected") return ctx;
  const { feature } = ctx;
  if (move.kind === "swim" ? feature.landform !== "water"
    : move.kind === "climb" ? !CLIMBABLE_LANDFORMS.has(feature.landform) : !RAISED_LANDFORMS.has(feature.landform)) {
    return reject("worldLawViolation", "terrain:wrong-landform");
  }
  const hollow = isHollowTacticalFeature(feature);
  const direction = move.kind === "jumpOnto" ? "up" : move.direction;
  const insideThis = ctx.footing.kind === "inside" && ctx.footing.feature.featureId === featureId;
  const onTopThis = ctx.footing.kind === "onTop" && ctx.footing.feature.featureId === featureId;
  const floor = feature.elevation, top = (BigInt(feature.elevation) + BigInt(feature.height)).toString();
  let landing: Landing | undefined;
  let jump: { running: boolean; maxHeightInches: string } | undefined;
  if (hollow && direction === "up") {
    if (!insideThis) return reject("missingPrerequisite", "terrain:not-inside");
    landing = outOf(ctx, floor);
  } else if (!hollow && direction === "down") {
    if (!onTopThis) return reject("missingPrerequisite", "terrain:not-on-top");
    landing = outOf(ctx, floor);
  } else {
    if (insideThis) return reject("missingPrerequisite", "terrain:already-inside");
    if (onTopThis) return reject("missingPrerequisite", "terrain:already-on-top");
    const issue = fromFloorIssue(ctx);
    if (issue !== undefined) return issue;
    if (move.kind === "jumpOnto") {
      const planned = highJump(state, ctx);
      if (planned.kind === "rejected") return planned;
      jump = planned;
    }
    landing = direction === "across" ? across(ctx, floor)
      : hollow ? into(ctx, hollowStandingElevation(feature, ctx.mover).toString())
      : onto(ctx, top);
  }
  if (landing === undefined) return reject("worldLawViolation", "terrain:no-landing");
  const vertical = BigInt(hollow ? floor : top) - BigInt(hollow ? hollowStandingElevation(feature, ctx.mover) : floor);
  // Across goes down and up again, or up and over; the line itself is level.
  const distance = BigInt(pathLengthMilliInches(landing.path)) + (direction === "across" ? 2n * vertical * 1000n : 0n);
  const speeds = isRecord(state.combatRuntime.entities[actorId]?.speedInches) ? state.combatRuntime.entities[actorId]!.speedInches as JsonRecord : {};
  const ownSpeed = move.kind === "jumpOnto" ? undefined : speeds[move.kind];
  const extra = move.kind !== "jumpOnto" && !(typeof ownSpeed === "string" && UNSIGNED.test(ownSpeed) && ownSpeed !== "0");
  return { kind: "accepted", move, featureId, from: ctx.from, to: landing.to, distanceMilliInches: distance.toString(),
    movementCostMilliInches: (extra ? 2n * distance : distance).toString(), ...(jump ?? {}) };
}

/** SPEC 0014 §4 (ADR 0098): where the actor first stands for `move` and the
 * move from there. Its own spot when the move works from it; else, for a
 * move from the floor, the spot beside the feature it can walk to from which
 * the move works, nearest first, then the shortest move. Climbing up out of
 * a hollow or down off a top starts where it is. The KP walks the actor to
 * `start` and commits the effect, which is judged again from there. */
export function planTerrainTraversal(state: AuthoritativeWorldState, actorId: string, featureId: string, move: TerrainMove): TerrainTraversal {
  const here = planTerrainMove(state, actorId, featureId, move);
  if (here.kind === "accepted") return { ...here, start: here.from };
  if (here.reason !== "terrain:not-beside" && here.code !== "worldLawViolation") return here;
  const ctx = terrainContext(state, actorId, featureId);
  if (ctx.kind === "rejected" || here.reason === "terrain:wrong-landform") return here;
  if ((isHollowTacticalFeature(ctx.feature) && move.kind !== "jumpOnto" && move.direction === "up")
    || (!isHollowTacticalFeature(ctx.feature) && move.kind !== "jumpOnto" && move.direction === "down")) return here;
  const body = rectangularFeatureEntity(ctx.feature as unknown as JsonRecord, ctx.sceneId);
  const mover = state.combatRuntime.entities[actorId]!;
  type Option = { near: bigint; plan: Extract<TerrainMovePlan, { kind: "accepted" }> };
  const options: Option[] = [];
  const reasons = new Set<TerrainRejection>([here.reason]);
  const spots = body === undefined ? besidePolygon(ctx.polygon, mover, ctx.feature.elevation) : besideTarget(body, mover, ctx.feature.elevation);
  for (const spot of spots) {
    const moved: AuthoritativeWorldState = { ...state, combatRuntime: { ...state.combatRuntime,
      entities: { ...state.combatRuntime.entities, [actorId]: { ...mover, position: structuredClone(spot) } } } };
    const plan = planTerrainMove(moved, actorId, featureId, move);
    if (plan.kind === "rejected") { reasons.add(plan.reason); continue; }
    const dx = BigInt(spot.x) - BigInt(ctx.from.x), dy = BigInt(spot.y) - BigInt(ctx.from.y);
    options.push({ near: dx * dx + dy * dy, plan });
  }
  options.sort((left, right) => compare(left.near, right.near)
    || compare(BigInt(left.plan.distanceMilliInches), BigInt(right.plan.distanceMilliInches))
    || `${left.plan.from.x},${left.plan.from.y}`.localeCompare(`${right.plan.from.x},${right.plan.from.y}`));
  for (const { plan } of options) {
    if (planSceneApproach(state, actorId, ctx.sceneId, { kind: "point", position: plan.from }).kind !== "rejected") {
      return { ...plan, start: plan.from };
    }
  }
  if (options.length > 0) return reject("worldLawViolation", "terrain:no-route");
  const physical = [...reasons].filter(reason => reason !== "terrain:not-beside");
  return physical.length > 0 && physical.every(reason => reason === "terrain:too-high")
    ? reject("worldLawViolation", "terrain:too-high") : reject("worldLawViolation", "terrain:no-landing");
}

/** SPEC 0014 §4 (ADR 0098): where a fall from `featureId` takes the actor and
 * how far it drops. From on top of a step, low wall or cliff it falls to the
 * floor beside it, the whole height. From the floor beside a ditch it falls
 * in, the whole depth. From the floor beside a raised feature, having failed
 * to climb it, it falls from half the height, rounded down, where it stands;
 * inside a ditch, from half the depth. From the bank it slips into water,
 * which lies level with the rim, so it drops nothing and floats there
 * rather than lying prone; a swimmer cannot fall further. */
export function planTerrainFall(state: AuthoritativeWorldState, actorId: string, featureId: string): TerrainFallPlan {
  const ctx = terrainContext(state, actorId, featureId);
  if (ctx.kind === "rejected") return ctx;
  const { feature } = ctx;
  const water = feature.landform === "water";
  if (!water && !CLIMBABLE_LANDFORMS.has(feature.landform)) return reject("worldLawViolation", "terrain:wrong-landform");
  const hollow = isHollowTacticalFeature(feature);
  const height = hollow ? BigInt(feature.depth!) : BigInt(feature.height);
  const thisFeature = ctx.footing.kind !== "floor" && ctx.footing.feature.featureId === featureId;
  let drop: bigint, to: CanonicalCombatPoint | undefined;
  if (water) {
    if (thisFeature) return reject("missingPrerequisite", "terrain:already-inside");
    const issue = fromFloorIssue(ctx);
    if (issue !== undefined) return issue;
    drop = 0n;
    to = into(ctx, hollowStandingElevation(feature, ctx.mover).toString())?.to;
  } else if (thisFeature && ctx.footing.kind === "onTop") {
    drop = height;
    to = outOf(ctx, feature.elevation)?.to;
  } else if (thisFeature) {
    drop = height / 2n;
    to = ctx.from;
  } else {
    const issue = fromFloorIssue(ctx);
    if (issue !== undefined) return issue;
    drop = hollow ? height : height / 2n;
    to = hollow ? into(ctx, hollowStandingElevation(feature, ctx.mover).toString())?.to : ctx.from;
  }
  if (to === undefined) return reject("worldLawViolation", "terrain:no-landing");
  return { kind: "accepted", featureId, from: ctx.from, to, dropInches: drop.toString(), damageDice: fallDamageDice(drop), landedProne: !water };
}

/** SRD 5.1: 1d6 per full 10 feet fallen, at most 20d6. */
export function fallDamageDice(dropInches: bigint): number {
  const dice = dropInches / FALL_INCHES_PER_DIE;
  return Number(dice > MAX_FALL_DICE ? MAX_FALL_DICE : dice);
}

/** A creature in a ditch stands on its bottom; a swimmer floats with half
 * its height under water, or stands on the bottom of shallower water. */
function hollowStandingElevation(feature: CanonicalTacticalFeature, mover: JsonRecord): bigint {
  const rim = BigInt(feature.elevation), depth = BigInt(feature.depth!);
  if (feature.landform !== "water") return rim - depth;
  const half = BigInt(String((mover.footprint as JsonRecord).height)) / 2n;
  const under = half < 1n ? 1n : half;
  return rim - (under < depth ? under : depth);
}

/** Spots just outside each edge of a feature that is not an axis-aligned
 * rectangle, a grid step apart along the edge, far enough out that the
 * walker's footprint clears the edge and near enough to stand beside it. */
function besidePolygon(polygon: readonly Point[], walker: JsonRecord, elevation: string): CanonicalCombatPoint[] {
  if (!isRecord(walker.footprint)) return [];
  // Half the width plus half the depth clears the edge whatever its slant.
  const out = (BigInt(String(walker.footprint.width)) + BigInt(String(walker.footprint.depth))) / 2n + 1n;
  // Outward is to the right of each edge when the polygon winds anticlockwise.
  const area = polygon.reduce((sum, a, index) => { const b = polygon[(index + 1) % polygon.length]!; return sum + a.x * b.y - b.x * a.y; }, 0n);
  const spots = new Map<string, CanonicalCombatPoint>();
  for (const [index, a] of polygon.entries()) {
    const b = polygon[(index + 1) % polygon.length]!;
    const edge = { x: b.x - a.x, y: b.y - a.y };
    if (edge.x === 0n && edge.y === 0n) continue;
    const normal = offsetAlong(area > 0n ? { x: edge.y, y: -edge.x } : { x: -edge.y, y: edge.x }, out);
    const length = squareRootFloor(edge.x * edge.x + edge.y * edge.y);
    for (let travelled = 0n; travelled <= length; travelled += EDGE_STEP_INCHES) {
      const step = offsetAlong(edge, travelled);
      const spot = { x: (a.x + step.x + normal.x).toString(), y: (a.y + step.y + normal.y).toString(), elevation };
      spots.set(`${spot.x},${spot.y}`, spot);
    }
  }
  return [...spots.values()];
}

function squareRootFloor(value: bigint): bigint {
  if (value < 2n) return value;
  let root = BigInt(Math.floor(Math.sqrt(Number(value))));
  while (root * root > value) root--;
  while ((root + 1n) * (root + 1n) <= value) root++;
  return root;
}

/** A move from the floor: the actor stands on the floor, at the feature's
 * level, within 5 feet of it. */
function fromFloorIssue(ctx: Context): TerrainRejected | undefined {
  if (ctx.footing.kind !== "floor" || ctx.from.elevation !== ctx.feature.elevation) return reject("missingPrerequisite", "terrain:not-on-floor");
  const reach = { ...(ctx.mover.footprint as JsonRecord),
    width: (BigInt(String((ctx.mover.footprint as JsonRecord).width)) + 2n * BESIDE_INCHES).toString(),
    depth: (BigInt(String((ctx.mover.footprint as JsonRecord).depth)) + 2n * BESIDE_INCHES).toString() };
  return footprintOverlapsPolygon(ctx.from, reach, ctx.polygon) ? undefined : reject("missingPrerequisite", "terrain:not-beside");
}

/** SRD 5.1 high jump: it runs when the 10 feet straight behind it, away
 * from the feature, are a free walk; then up to 3 + its Strength modifier
 * feet, at least none, and half that from a standing start. */
function highJump(state: AuthoritativeWorldState, ctx: Context): Readonly<{ kind: "accepted"; running: boolean; maxHeightInches: string }> | TerrainRejected {
  const strength = abilityScoreFor(state.entities[ctx.actorId]!, "str");
  if (strength === undefined || strength < 0) return reject("missingPrerequisite", "terrain:strength-unknown");
  const center = pointOf(ctx.from), direction = towardNearestPoint(center, ctx.polygon);
  const runUp = along(center, direction, RUN_UP_INCHES, ctx.from.elevation, -1n);
  const running = footprintInsidePolygon(runUp, ctx.mover, ctx.boundary)
    && analyzeCombatMovement({ ...ctx.mover, position: runUp }, ctx.others, ctx.scene, [runUp, ctx.from], new Set()).ok;
  const feet = 3n + floorDivide(BigInt(strength) - 10n, 2n);
  const max = (feet < 0n ? 0n : feet) * (running ? 12n : 6n);
  if (BigInt(ctx.feature.height) > max) return reject("worldLawViolation", "terrain:too-high");
  return { kind: "accepted", running, maxHeightInches: max.toString() };
}

/** Down into a hollow: along the line toward its nearest point, the first
 * spot where the footprint fits inside it, at `bottom`. */
function into(ctx: Context, bottom: string): Landing | undefined {
  const center = pointOf(ctx.from), direction = towardNearestPoint(center, ctx.polygon);
  let entered = false;
  for (let inches = 1n; inches <= ctx.span; inches++) {
    const point = along(center, direction, inches, ctx.from.elevation);
    if (pointInPolygonInclusive(BigInt(point.x), BigInt(point.y), ctx.polygon)) entered = true;
    else if (entered) break;
    if (!footprintInsidePolygon(point, ctx.mover, ctx.polygon)) continue;
    const to = { ...point, elevation: bottom };
    if (footingOn(ctx, to, "inside") && landed(ctx, [ctx.from, point, to])) return { to, path: [ctx.from, point, to] };
  }
  return undefined;
}

/** Onto a top: along the line toward its nearest point, the first spot where
 * the centre is over it, at `top`. */
function onto(ctx: Context, top: string): Landing | undefined {
  const center = pointOf(ctx.from), direction = towardNearestPoint(center, ctx.polygon);
  let entered = false;
  for (let inches = 1n; inches <= ctx.span; inches++) {
    const point = along(center, direction, inches, ctx.from.elevation), to = { ...point, elevation: top };
    if (!footingOn(ctx, to, "onTop")) {
      if (entered) break;
      continue;
    }
    entered = true;
    if (landed(ctx, [ctx.from, point, to])) return { to, path: [ctx.from, point, to] };
  }
  return undefined;
}

/** Across: along the line toward its nearest point, the first spot past the
 * feature where the footprint is clear of it, on the floor; when someone
 * stands there, the next free spot within 10 feet further on. */
function across(ctx: Context, floor: string): Landing | undefined {
  const center = pointOf(ctx.from), direction = towardNearestPoint(center, ctx.polygon);
  let entered = footprintOverlapsPolygon(ctx.from, ctx.mover.footprint as JsonRecord, ctx.polygon);
  let clearAt: bigint | undefined;
  for (let inches = 1n; inches <= ctx.span; inches++) {
    const point = along(center, direction, inches, floor);
    if (clearAt === undefined) {
      if (footprintOverlapsPolygon(point, ctx.mover.footprint as JsonRecord, ctx.polygon)) { entered = true; continue; }
      if (!entered) continue;
      clearAt = inches;
    }
    if (inches - clearAt > LANDING_SLACK_INCHES) break;
    if (landed(ctx, [ctx.from, point])) return { to: point, path: [ctx.from, point] };
  }
  return undefined;
}

/** Out of a hollow or off a top, to the floor: toward each edge in turn,
 * nearest first, the first spot where the footprint is clear of the feature,
 * or the next free one within 10 feet further on. Out of a hollow it climbs
 * straight up, then steps out; off a top it steps to the edge, then climbs
 * down. */
function outOf(ctx: Context, floor: string): Landing | undefined {
  const center = pointOf(ctx.from), level = ctx.from.elevation;
  for (const direction of towardEachEdge(center, ctx.polygon)) {
    let clearAt: bigint | undefined;
    for (let inches = 1n; inches <= ctx.span; inches++) {
      const point = along(center, direction, inches, floor);
      if (clearAt === undefined) {
        if (footprintOverlapsPolygon(point, ctx.mover.footprint as JsonRecord, ctx.polygon)) continue;
        clearAt = inches;
      }
      if (inches - clearAt > LANDING_SLACK_INCHES) break;
      const path = ctx.footing.kind === "inside" ? [ctx.from, { ...ctx.from, elevation: floor }, point]
        : [ctx.from, { ...point, elevation: level }, point];
      if (landed(ctx, path)) return { to: point, path };
    }
  }
  return undefined;
}

/** The move ends inside the scene, on nobody, having crossed nothing
 * impassable but the feature itself. */
function landed(ctx: Context, path: CanonicalCombatPoint[]): boolean {
  return footprintInsidePolygon(path.at(-1)!, ctx.mover, ctx.boundary)
    && analyzeCombatMovement({ ...ctx.mover, position: path[0] }, ctx.others, ctx.cleared, path, new Set()).ok;
}

/** At `point` the actor stands inside, or on top of, this feature. */
function footingOn(ctx: Context, point: CanonicalCombatPoint, kind: "inside" | "onTop"): boolean {
  const footing = terrainFooting(ctx.scene, point);
  return footing.kind === kind && footing.feature.featureId === ctx.feature.featureId;
}

function along(center: Point, direction: Point, inches: bigint, elevation: string, sign = 1n): CanonicalCombatPoint {
  const offset = offsetAlong(direction, inches);
  return { x: (center.x + sign * offset.x).toString(), y: (center.y + sign * offset.y).toString(), elevation };
}

function pointOf(point: CanonicalCombatPoint): Point {
  return { x: BigInt(point.x), y: BigInt(point.y) };
}

const POINT = (value: unknown) => sameCanonical(canonicalCombatPoint(value) ?? null, value);
const WAYS: ReadonlySet<unknown> = new Set(["climb", "swim"]);
const DIRECTIONS: ReadonlySet<unknown> = new Set(["down", "up", "across"]);

export function isCharacterClimbedPayload(value: unknown): value is CharacterClimbedPayload {
  return isRecord(value) && hasExactKeys(value, ["characterId", "direction", "distanceMilliInches", "featureId", "from",
    "movementCostMilliInches", "sceneId", "to", "way"])
    && [value.characterId, value.featureId, value.sceneId].every(isNonEmptyString)
    && WAYS.has(value.way) && DIRECTIONS.has(value.direction) && [value.from, value.to].every(POINT) && !sameCanonical(value.from, value.to)
    && [value.distanceMilliInches, value.movementCostMilliInches].every(entry => typeof entry === "string" && UNSIGNED.test(entry));
}

export function isCharacterJumpedOntoPayload(value: unknown): value is CharacterJumpedOntoPayload {
  return isRecord(value) && hasExactKeys(value, ["characterId", "featureId", "from", "running", "sceneId", "to"])
    && [value.characterId, value.featureId, value.sceneId].every(isNonEmptyString) && typeof value.running === "boolean"
    && [value.from, value.to].every(POINT) && !sameCanonical(value.from, value.to);
}

export function isCharacterFellPayload(value: unknown): value is CharacterFellPayload {
  return isRecord(value) && hasExactKeys(value, ["characterId", "damageRolls", "dropInches", "featureId", "from", "landedProne", "sceneId", "to"])
    && [value.characterId, value.featureId, value.sceneId].every(isNonEmptyString) && [value.from, value.to].every(POINT)
    && typeof value.landedProne === "boolean"
    && typeof value.dropInches === "string" && UNSIGNED.test(value.dropInches)
    && Array.isArray(value.damageRolls) && value.damageRolls.length === fallDamageDice(BigInt(value.dropInches))
    && value.damageRolls.every(face => Number.isSafeInteger(face) && Number(face) >= 1 && Number(face) <= 6);
}

/** Replays a committed climb or swim: the actor still stands where it
 * started, and the same move from there ends exactly where the event says. */
export function applyCharacterClimbedEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CharacterClimbed") return false;
  const payload = event.payload;
  if (!isCharacterClimbedPayload(payload)) throw new RulesValidationError("terrain:payload-invalid");
  const body = startingBody(state, payload);
  const planned = planTerrainMove(state, payload.characterId, payload.featureId, { kind: payload.way, direction: payload.direction });
  if (planned.kind !== "accepted" || !sameCanonical(planned.to, payload.to) || planned.distanceMilliInches !== payload.distanceMilliInches
    || planned.movementCostMilliInches !== payload.movementCostMilliInches) throw new RulesValidationError("terrain:destination-invalid");
  body.position = structuredClone(payload.to);
  return true;
}

/** Replays a committed high jump the same way. */
export function applyCharacterJumpedOntoEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CharacterJumpedOnto") return false;
  const payload = event.payload;
  if (!isCharacterJumpedOntoPayload(payload)) throw new RulesValidationError("terrain:payload-invalid");
  const body = startingBody(state, payload);
  const planned = planTerrainMove(state, payload.characterId, payload.featureId, { kind: "jumpOnto" });
  if (planned.kind !== "accepted" || !sameCanonical(planned.to, payload.to) || planned.running !== payload.running) {
    throw new RulesValidationError("terrain:destination-invalid");
  }
  body.position = structuredClone(payload.to);
  return true;
}

/** Replays a committed fall: the same fall from where the actor stood lands
 * where the event says, from the same drop, with a die for each full 10 feet.
 * The damage and the prone flag are their own events. */
export function applyCharacterFellEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CharacterFell") return false;
  const payload = event.payload;
  if (!isCharacterFellPayload(payload)) throw new RulesValidationError("terrain:payload-invalid");
  const body = startingBody(state, payload);
  const planned = planTerrainFall(state, payload.characterId, payload.featureId);
  if (planned.kind !== "accepted" || !sameCanonical(planned.to, payload.to) || planned.dropInches !== payload.dropInches
    || planned.landedProne !== payload.landedProne) {
    throw new RulesValidationError("terrain:destination-invalid");
  }
  body.position = structuredClone(payload.to);
  return true;
}

function startingBody(state: AuthoritativeWorldState, payload: { characterId: string; sceneId: string; from: CanonicalCombatPoint }): JsonRecord {
  const actor = state.entities[payload.characterId], body = state.combatRuntime.entities[payload.characterId];
  if (actor?.tenureStatus !== "active" || actor.sceneId !== payload.sceneId) throw new RulesValidationError("terrain:actor-not-present");
  if (!isRecord(body) || body.sceneId !== payload.sceneId || !sameCanonical(canonicalCombatPoint(body.position) ?? null, payload.from)) {
    throw new RulesValidationError("terrain:start-changed");
  }
  return body;
}

function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value % divisor < 0n ? quotient - 1n : quotient;
}

function compare(left: bigint, right: bigint): number { return left < right ? -1 : left > right ? 1 : 0; }
function min(values: readonly bigint[]): bigint { return values.reduce((low, value) => value < low ? value : low); }
function max(values: readonly bigint[]): bigint { return values.reduce((high, value) => value > high ? value : high); }
