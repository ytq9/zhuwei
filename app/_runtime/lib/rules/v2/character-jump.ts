import { RulesValidationError } from "../errors";
import { analyzeCombatMovement, canonicalCombatPoint, pathLengthMilliInches, rectangularFeatureEntity, type CanonicalCombatPoint } from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { isCanonicalTacticalGeometry, isHollowTacticalFeature, type CanonicalTacticalFeature } from "../profiles/tactical-geometry";
import { besideTarget, footprintInsidePolygon, nextTo, pointInPolygonInclusive } from "./carry";
import { activeEncounter } from "./combat-encounters";
import { conditionMechanics, conditionSpeed } from "./condition-mechanics";
import { grappledBy } from "./contest";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { abilityScoreFor } from "./proficiency";
import { planSceneApproach } from "./scene-approach";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0014 §4 (ADR 0092): the actor jumped across a ditch or low obstacle
 * of its scene, outside an encounter, from where it stood to where it landed. */
export type CharacterJumpedPayload = {
  characterId: string;
  sceneId: string;
  featureId: string;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
  running: boolean;
};

export type JumpRejection =
  | "jump:actor-not-placed" | "jump:inside-encounter" | "jump:feature-unavailable" | "jump:cannot-move"
  | "jump:while-holding" | "jump:inside-feature" | "jump:strength-unknown" | "jump:obstacle-too-high" | "jump:beyond-reach";

/** `impassable` says whether there is an obstacle to clear (Athletics), never
 * so for a ditch or water (ADR 0098), and `difficultLanding` whether the
 * actor lands in difficult terrain (Acrobatics); the KP decides whether to
 * call for either roll. */
export type JumpPlan =
  | Readonly<{ kind: "accepted"; from: CanonicalCombatPoint; to: CanonicalCombatPoint; running: boolean;
      impassable: boolean; difficultLanding: boolean; maxInches: string; distanceMilliInches: string }>
  | Readonly<{ kind: "rejected"; code: "missingPrerequisite" | "privateOrUnknownReference" | "worldLawViolation"; reason: JumpRejection }>;

type Point = { x: bigint; y: bigint };

/** SRD 5.1 long jump: after moving at least 10 feet on foot, up to the
 * Strength score in feet; from a standing start, half that. */
const RUN_UP_INCHES = 120n;
const RUNNING_INCHES_PER_STRENGTH = 12n;
const STANDING_INCHES_PER_STRENGTH = 6n;

export function isCharacterJumpedPayload(value: unknown): value is CharacterJumpedPayload {
  return isRecord(value) && hasExactKeys(value, ["characterId", "featureId", "from", "running", "sceneId", "to"])
    && [value.characterId, value.featureId, value.sceneId].every(isNonEmptyString) && typeof value.running === "boolean"
    && [value.from, value.to].every(point => sameCanonical(canonicalCombatPoint(point) ?? null, point))
    && (value.from as CanonicalCombatPoint).elevation === (value.to as CanonicalCombatPoint).elevation
    && !sameCanonical(value.from, value.to);
}

/** `inches` along `direction` across the floor, each axis rounded to the
 * nearest inch, halves away from zero, as a push is (pushOffset). */
export function offsetAlong(direction: Point, inches: bigint): Point {
  const lengthSquared = direction.x * direction.x + direction.y * direction.y;
  // round(inches·|d|/√L) is the largest n with (2n − 1)²·L ≤ (2·inches·d)².
  const axis = (d: bigint) => {
    const magnitude = d < 0n ? -d : d;
    const n = (squareRootFloor((2n * inches * magnitude) ** 2n / lengthSquared) + 1n) / 2n;
    return d < 0n ? -n : n;
  };
  return { x: axis(direction.x), y: axis(direction.y) };
}

/** SPEC 0014 §4 (ADR 0092): where a jump across `featureId` takes the actor
 * from where it stands now, judged on the authoritative state. It leaps
 * toward the nearest point of the feature and lands at the first inch past
 * it where its footprint is clear of the feature, inside the scene, on
 * nobody, and reached without crossing anything else impassable. It runs
 * when the 10 feet straight behind it are a free walk. An impassable feature
 * may be no taller than a quarter of the reach; a ditch or water has no
 * height to clear, only its width. Who may act and why is the caller's to
 * check. */
export function planJump(state: AuthoritativeWorldState, actorId: string, featureId: string): JumpPlan {
  const reject = (code: Extract<JumpPlan, { kind: "rejected" }>["code"], reason: JumpRejection): JumpPlan => ({ kind: "rejected", code, reason });
  const actor = state.entities[actorId], mover = state.combatRuntime.entities[actorId];
  const scene = actor === undefined ? undefined : state.combatRuntime.scenes[actor.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  const from = isRecord(mover) ? canonicalCombatPoint(mover.position) : undefined;
  if (actor?.tenureStatus !== "active" || !isRecord(mover) || mover.sceneId !== actor.sceneId || from === undefined
    || !isRecord(mover.footprint) || !isCanonicalTacticalGeometry(geometry)) return reject("missingPrerequisite", "jump:actor-not-placed");
  if (activeEncounter(state, actorId) !== undefined) return reject("missingPrerequisite", "jump:inside-encounter");
  const visible = (feature: CanonicalTacticalFeature) => spatialRecordVisibleTo(state, { ...feature, id: feature.featureId }, actorId);
  const feature = geometry.obstacles.find(candidate => candidate.featureId === featureId);
  if (feature === undefined || !visible(feature)) return reject("privateOrUnknownReference", "jump:feature-unavailable");
  const walk = isRecord(mover.speedInches) ? mover.speedInches.walk : undefined;
  if (!conditionMechanics(state, actorId).canMove || typeof walk !== "string" || !/^(0|[1-9][0-9]*)$/.test(walk)
    || conditionSpeed(state, actorId, walk).speed === "0") return reject("missingPrerequisite", "jump:cannot-move");
  if (grappledBy(state, actorId).length > 0) return reject("missingPrerequisite", "jump:while-holding");
  const polygon = polygonOf(feature), center = { x: BigInt(from.x), y: BigInt(from.y) };
  if (pointInPolygonInclusive(center.x, center.y, polygon)) return reject("missingPrerequisite", "jump:inside-feature");
  const strength = abilityScoreFor(actor, "str");
  if (strength === undefined || strength < 0) return reject("missingPrerequisite", "jump:strength-unknown");

  const direction = towardNearestPoint(center, polygon);
  const along = (inches: bigint, sign = 1n): CanonicalCombatPoint => {
    const offset = offsetAlong(direction, inches);
    return { x: (center.x + sign * offset.x).toString(), y: (center.y + sign * offset.y).toString(), elevation: from.elevation };
  };
  // What the geometry reads of the jumper, as for a walk (planSceneApproach).
  const body: JsonRecord = { id: actorId, entityId: actorId, sceneId: actor.sceneId, footprint: structuredClone(mover.footprint),
    ...(typeof mover.sizeCategory === "string" ? { sizeCategory: mover.sizeCategory } : {}) };
  const at = (point: CanonicalCombatPoint): JsonRecord => ({ ...body, position: point });
  const others = Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
    && entity.sceneId === actor.sceneId && String(entity.id ?? entity.entityId) !== actorId);
  const boundary = geometry.boundary.points.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
  const runUp = along(RUN_UP_INCHES, -1n);
  const running = footprintInsidePolygon(runUp, mover, boundary)
    && analyzeCombatMovement(at(runUp), others, scene as JsonRecord, [runUp, from], new Set()).ok;
  const max = BigInt(strength) * (running ? RUNNING_INCHES_PER_STRENGTH : STANDING_INCHES_PER_STRENGTH);
  // SPEC 0014 §4 (ADR 0098): a ditch or water opens below the floor; there is
  // nothing to clear, so it has no height limit and asks for no Athletics.
  const obstacle = feature.impassable && !isHollowTacticalFeature(feature);
  if (obstacle && BigInt(feature.height) * 4n > max) return reject("worldLawViolation", "jump:obstacle-too-high");

  // The jumped feature does not block its own jump; anything else impassable does.
  const cleared: JsonRecord = { ...(scene as JsonRecord), geometry: { ...geometry,
    obstacles: geometry.obstacles.filter(candidate => candidate.featureId !== featureId) } };
  let entered = footprintOverlapsPolygon(from, mover.footprint, polygon), to: CanonicalCombatPoint | undefined;
  for (let inches = 1n; inches <= max && to === undefined; inches++) {
    const point = along(inches);
    const dx = BigInt(point.x) - center.x, dy = BigInt(point.y) - center.y;
    // Each axis grows with the distance, so nothing further is within reach either.
    if (dx * dx + dy * dy > max * max) break;
    if (footprintOverlapsPolygon(point, mover.footprint, polygon)) { entered = true; continue; }
    if (entered && footprintInsidePolygon(point, mover, boundary)
      && analyzeCombatMovement(at(from), others, cleared, [from, point], new Set()).ok) to = point;
  }
  if (to === undefined) return reject("worldLawViolation", "jump:beyond-reach");
  const landing = to;
  // SRD 5.1: landing in difficult terrain. A rubble patch the actor cannot
  // see is not named, so a refusal never tells of it.
  const difficultLanding = geometry.obstacles.some(candidate => candidate.terrain === "rubble" && visible(candidate)
    && footprintOverlapsPolygon(landing, mover.footprint as JsonRecord, polygonOf(candidate)));
  return { kind: "accepted", from, to, running, impassable: obstacle, difficultLanding,
    maxInches: max.toString(), distanceMilliInches: pathLengthMilliInches([from, to]) };
}

export type JumpTakeoff =
  | Readonly<{ kind: "accepted"; takeoff: CanonicalCombatPoint; jump: Extract<JumpPlan, { kind: "accepted" }> }>
  | Extract<JumpPlan, { kind: "rejected" }>;

/** SPEC 0014 §4 (ADR 0092): where the actor walks first to jump `featureId`.
 * Of the spots beside the feature it can walk to, one from which the jump
 * succeeds: the nearest, then the shortest jump. Its own spot counts
 * when it already stands beside the feature. Round 163 walked to the nearest
 * spot, the end of a long table, and the jump ran along the table out of
 * reach. When no spot works the refusal is the jump's own: too high from
 * everywhere, else beyond reach. */
export function planJumpTakeoff(state: AuthoritativeWorldState, actorId: string, featureId: string): JumpTakeoff {
  const here = planJump(state, actorId, featureId);
  const actor = state.entities[actorId], mover = state.combatRuntime.entities[actorId];
  const geometry = actor === undefined ? undefined : (state.combatRuntime.scenes[actor.sceneId] as JsonRecord | undefined)?.geometry;
  const feature = isCanonicalTacticalGeometry(geometry) ? geometry.obstacles.find(candidate => candidate.featureId === featureId) : undefined;
  const body = feature === undefined || actor === undefined ? undefined : rectangularFeatureEntity(feature as unknown as JsonRecord, actor.sceneId);
  const from = isRecord(mover) ? canonicalCombatPoint(mover.position) : undefined;
  if (here.kind === "rejected" && here.code !== "worldLawViolation" && here.reason !== "jump:inside-feature") return here;
  if (body === undefined || from === undefined || !isRecord(mover)) return here.kind === "accepted" ? { kind: "accepted", takeoff: here.from, jump: here } : here;
  // Jumps are judged from every spot first; walks are planned only in order
  // of distance, until one is reachable.
  type Option = { near: bigint; jump: Extract<JumpPlan, { kind: "accepted" }>; spot: CanonicalCombatPoint };
  const options: Option[] = [];
  const reasons = new Set<JumpRejection>();
  if (here.kind === "accepted" && nextTo(mover, body)) return { kind: "accepted", takeoff: from, jump: here };
  if (here.kind === "rejected") reasons.add(here.reason);
  for (const spot of besideTarget(body, mover, from.elevation)) {
    const moved: AuthoritativeWorldState = { ...state, combatRuntime: { ...state.combatRuntime,
      entities: { ...state.combatRuntime.entities, [actorId]: { ...mover, position: structuredClone(spot) } } } };
    const jump = planJump(moved, actorId, featureId);
    if (jump.kind === "rejected") { reasons.add(jump.reason); continue; }
    const dx = BigInt(spot.x) - BigInt(from.x), dy = BigInt(spot.y) - BigInt(from.y);
    options.push({ near: dx * dx + dy * dy, jump, spot });
  }
  options.sort((left, right) => left.near !== right.near ? (left.near < right.near ? -1 : 1)
    : BigInt(left.jump.distanceMilliInches) !== BigInt(right.jump.distanceMilliInches)
      ? (BigInt(left.jump.distanceMilliInches) < BigInt(right.jump.distanceMilliInches) ? -1 : 1)
      : `${left.spot.x},${left.spot.y}`.localeCompare(`${right.spot.x},${right.spot.y}`));
  for (const option of options) {
    const walk = planSceneApproach(state, actorId, actor!.sceneId, { kind: "point", position: option.spot });
    if (walk.kind !== "rejected") return { kind: "accepted", takeoff: option.spot, jump: option.jump };
  }
  return { kind: "rejected", code: "worldLawViolation",
    reason: reasons.size > 0 && [...reasons].every(reason => reason === "jump:obstacle-too-high") ? "jump:obstacle-too-high" : "jump:beyond-reach" };
}

/** Replays a committed jump: the actor still stands where it jumped from,
 * and the same jump from there still lands exactly where the event says. */
export function applyCharacterJumpedEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CharacterJumped") return false;
  const payload = event.payload;
  if (!isCharacterJumpedPayload(payload)) throw new RulesValidationError("jump:payload-invalid");
  const actor = state.entities[payload.characterId], body = state.combatRuntime.entities[payload.characterId];
  if (actor?.tenureStatus !== "active" || actor.sceneId !== payload.sceneId) throw new RulesValidationError("jump:actor-not-present");
  if (!isRecord(body) || body.sceneId !== payload.sceneId || !sameCanonical(canonicalCombatPoint(body.position) ?? null, payload.from)) {
    throw new RulesValidationError("jump:start-changed");
  }
  const planned = planJump(state, payload.characterId, payload.featureId);
  if (planned.kind !== "accepted" || !sameCanonical(planned.to, payload.to) || planned.running !== payload.running) {
    throw new RulesValidationError("jump:destination-invalid");
  }
  body.position = structuredClone(payload.to);
  return true;
}

function polygonOf(feature: CanonicalTacticalFeature): Point[] {
  return feature.polygon.map(point => ({ x: BigInt(point.x), y: BigInt(point.y) }));
}

/** The vector from `center` to the nearest point of the polygon's edges, in
 * lowest terms. The centre lies outside the polygon, so it is never zero. */
function towardNearestPoint(center: Point, polygon: readonly Point[]): Point {
  // Each candidate is (x, y) / scale; distances compare without division.
  let best: { x: bigint; y: bigint; scale: bigint } | undefined;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const length = abx * abx + aby * aby, dot = (center.x - a.x) * abx + (center.y - a.y) * aby;
    const candidate = length === 0n || dot <= 0n ? { x: a.x - center.x, y: a.y - center.y, scale: 1n }
      : dot >= length ? { x: b.x - center.x, y: b.y - center.y, scale: 1n }
      : { x: a.x * length + dot * abx - center.x * length, y: a.y * length + dot * aby - center.y * length, scale: length };
    if (best === undefined || (candidate.x ** 2n + candidate.y ** 2n) * best.scale ** 2n
      < (best.x ** 2n + best.y ** 2n) * candidate.scale ** 2n) best = candidate;
  }
  const divisor = greatestCommonDivisor(best!.x, best!.y);
  return { x: best!.x / divisor, y: best!.y / divisor };
}

/** The footprint at `point` and the polygon share some of their insides,
 * across the floor. Doubled coordinates keep a footprint's edges whole. */
function footprintOverlapsPolygon(point: CanonicalCombatPoint, footprint: JsonRecord, polygon: readonly Point[]): boolean {
  const cx = BigInt(point.x) * 2n, cy = BigInt(point.y) * 2n;
  const width = BigInt(String(footprint.width)), depth = BigInt(String(footprint.depth));
  const box = { x0: cx - width, x1: cx + width, y0: cy - depth, y1: cy + depth };
  const doubled = polygon.map(vertex => ({ x: vertex.x * 2n, y: vertex.y * 2n }));
  // An edge through the open box brings the polygon's inside into it; with no
  // such edge the box lies wholly inside the polygon or wholly outside it, as
  // its centre does.
  return doubled.some((a, index) => segmentCrossesOpenBox(a, doubled[(index + 1) % doubled.length], box))
    || pointInPolygonInclusive(cx, cy, doubled);
}

type Fraction = { n: bigint; d: bigint };
const lessThan = (left: Fraction, right: Fraction) => left.n * right.d < right.n * left.d;

/** Some point of the closed segment lies strictly inside the box. */
function segmentCrossesOpenBox(a: Point, b: Point, box: { x0: bigint; x1: bigint; y0: bigint; y1: bigint }): boolean {
  // The parameters t in [0, 1] strictly inside on both axes form one interval.
  let lower: Fraction = { n: 0n, d: 1n }, upper: Fraction = { n: 1n, d: 1n };
  for (const [start, delta, low, high] of [[a.x, b.x - a.x, box.x0, box.x1], [a.y, b.y - a.y, box.y0, box.y1]] as const) {
    if (delta === 0n) {
      if (start <= low || start >= high) return false;
      continue;
    }
    const enter = delta > 0n ? { n: low - start, d: delta } : { n: start - high, d: -delta };
    const leave = delta > 0n ? { n: high - start, d: delta } : { n: start - low, d: -delta };
    if (lessThan(lower, enter)) lower = enter;
    if (lessThan(leave, upper)) upper = leave;
  }
  return lessThan(lower, upper);
}

function squareRootFloor(value: bigint): bigint {
  if (value < 2n) return value;
  let root = value, next = (root + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2n;
  }
  return root;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left, b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
