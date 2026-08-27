import type { JsonRecord } from "../v2/model";
import { isNonEmptyString, isRecord } from "../v2/validation";

export type CanonicalCombatPoint = {
  x: string;
  y: string;
  elevation: string;
};

type AxisInterval = { low: bigint; high: bigint };
type ScaledPoint = { x: bigint; y: bigint; z: bigint };
type Fraction = { numerator: bigint; denominator: bigint };
type PolygonPoint = { x: bigint; y: bigint };
type ObstaclePrism = {
  polygon: PolygonPoint[];
  elevation: bigint;
  height: bigint;
};
type RationalPoint = { x: Fraction; y: Fraction; z: Fraction };
type DirectionVector = { x: bigint; y: bigint; z: bigint };

const INTEGER_PATTERN = /^-?(0|[1-9][0-9]*)$/;
const INT32_MIN = -2_147_483_648n;
const INT32_MAX = 2_147_483_647n;

function canonicalInteger(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed >= INT32_MIN && parsed <= INT32_MAX ? parsed : undefined;
}

export function canonicalCombatPoint(value: unknown): CanonicalCombatPoint | undefined {
  if (!isRecord(value)) return undefined;
  const x = canonicalInteger(value.x);
  const y = canonicalInteger(value.y);
  const elevation = canonicalInteger(value.elevation);
  if (x === undefined || y === undefined || elevation === undefined) return undefined;
  if (Object.keys(value).sort().join(",") !== "elevation,x,y") return undefined;
  return { x: x.toString(), y: y.toString(), elevation: elevation.toString() };
}

function positiveDimension(entity: JsonRecord, key: "width" | "depth" | "height"): bigint {
  if (!isRecord(entity.footprint)) throw new TypeError("combat entity lacks a canonical footprint");
  const value = canonicalInteger(entity.footprint[key]);
  if (value === undefined || value <= 0n) throw new TypeError("combat footprint is malformed");
  return value;
}

function position(entity: JsonRecord): { x: bigint; y: bigint; elevation: bigint } {
  const parsed = canonicalCombatPoint(entity.position);
  if (parsed === undefined) throw new TypeError("combat entity lacks a canonical position");
  return { x: BigInt(parsed.x), y: BigInt(parsed.y), elevation: BigInt(parsed.elevation) };
}

/**
 * A measurement core uses doubled-inch coordinates so odd footprint sizes do
 * not require floating point.  Horizontal positions are entity centres;
 * elevation is the bottom of the occupied prism.
 */
function measurementCore(entity: JsonRecord): { x: AxisInterval; y: AxisInterval; z: AxisInterval } {
  const at = position(entity);
  const width = positiveDimension(entity, "width");
  const depth = positiveDimension(entity, "depth");
  const height = positiveDimension(entity, "height");
  const horizontal = (center: bigint, size: bigint): AxisInterval => size < 60n
    ? { low: center * 2n, high: center * 2n }
    : { low: center * 2n - size + 60n, high: center * 2n + size - 60n };
  const vertical = height < 60n
    ? { low: at.elevation * 2n + height, high: at.elevation * 2n + height }
    : { low: at.elevation * 2n + 60n, high: at.elevation * 2n + height * 2n - 60n };
  return {
    x: horizontal(at.x, width),
    y: horizontal(at.y, depth),
    z: vertical,
  };
}

function occupancy(entity: JsonRecord): { x: AxisInterval; y: AxisInterval; z: AxisInterval } {
  const at = position(entity);
  const width = positiveDimension(entity, "width");
  const depth = positiveDimension(entity, "depth");
  const height = positiveDimension(entity, "height");
  return {
    x: { low: at.x * 2n - width, high: at.x * 2n + width },
    y: { low: at.y * 2n - depth, high: at.y * 2n + depth },
    z: { low: at.elevation * 2n, high: at.elevation * 2n + height * 2n },
  };
}

export function entityOccupanciesOverlap(left: JsonRecord, right: JsonRecord): boolean {
  const a = occupancy(left);
  const b = occupancy(right);
  return (["x", "y", "z"] as const).every((axis) =>
    a[axis].low < b[axis].high && b[axis].low < a[axis].high);
}

function intervalGap(left: AxisInterval, right: AxisInterval): bigint {
  if (left.high < right.low) return right.low - left.high;
  if (right.high < left.low) return left.low - right.high;
  return 0n;
}

/** Exact range comparison; no square root or display rounding participates. */
export function entitiesWithinRange(
  left: JsonRecord,
  right: JsonRecord,
  rangeInches: string,
): boolean {
  const range = canonicalInteger(rangeInches);
  if (range === undefined || range < 0n) throw new TypeError("combat range is malformed");
  const a = measurementCore(left);
  const b = measurementCore(right);
  const dx = intervalGap(a.x, b.x);
  const dy = intervalGap(a.y, b.y);
  const dz = intervalGap(a.z, b.z);
  const doubledRange = range * 2n;
  return dx * dx + dy * dy + dz * dz <= doubledRange * doubledRange;
}

export function entityWithinPointRange(
  entity: JsonRecord,
  pointValue: unknown,
  rangeInches: string,
): boolean {
  const parsed = canonicalCombatPoint(pointValue);
  const range = canonicalInteger(rangeInches);
  if (parsed === undefined || range === undefined || range < 0n) {
    throw new TypeError("point range input is malformed");
  }
  const core = measurementCore(entity);
  const point = {
    x: { low: BigInt(parsed.x) * 2n, high: BigInt(parsed.x) * 2n },
    y: { low: BigInt(parsed.y) * 2n, high: BigInt(parsed.y) * 2n },
    z: { low: BigInt(parsed.elevation) * 2n, high: BigInt(parsed.elevation) * 2n },
  };
  const dx = intervalGap(core.x, point.x);
  const dy = intervalGap(core.y, point.y);
  const dz = intervalGap(core.z, point.z);
  const doubledRange = range * 2n;
  return dx * dx + dy * dy + dz * dz <= doubledRange * doubledRange;
}

function rectangularFeatureEntity(feature: JsonRecord, sceneId: string): JsonRecord | undefined {
  if (!Array.isArray(feature.polygon) || feature.polygon.length !== 4) return undefined;
  const points = feature.polygon.map((entry) => {
    if (!isRecord(entry)) return undefined;
    const x = canonicalInteger(entry.x);
    const y = canonicalInteger(entry.y);
    return x === undefined || y === undefined ? undefined : { x, y };
  });
  const elevation = canonicalInteger(feature.elevation);
  const height = canonicalInteger(feature.height);
  if (points.some((entry) => entry === undefined)
    || elevation === undefined
    || height === undefined
    || height <= 0n) return undefined;
  const canonicalPoints = points as Array<{ x: bigint; y: bigint }>;
  const xs = [...new Set(canonicalPoints.map(({ x }) => x.toString()))].map(BigInt).sort((left, right) => left < right ? -1 : 1);
  const ys = [...new Set(canonicalPoints.map(({ y }) => y.toString()))].map(BigInt).sort((left, right) => left < right ? -1 : 1);
  if (xs.length !== 2 || ys.length !== 2
    || canonicalPoints.some(({ x, y }) => !xs.includes(x) || !ys.includes(y))
    || (xs[0] + xs[1]) % 2n !== 0n
    || (ys[0] + ys[1]) % 2n !== 0n) return undefined;
  return {
    id: `environment-target:${String(feature.featureId)}`,
    entityId: `environment-target:${String(feature.featureId)}`,
    kind: "environment",
    sceneId,
    position: {
      x: ((xs[0] + xs[1]) / 2n).toString(),
      y: ((ys[0] + ys[1]) / 2n).toString(),
      elevation: elevation.toString(),
    },
    footprint: {
      width: (xs[1] - xs[0]).toString(),
      depth: (ys[1] - ys[0]).toString(),
      height: height.toString(),
    },
    lifeState: "alive",
  };
}

/**
 * Closed tactical-feature targeting profile. Module-authored environment
 * targets are rectangles; range and the clear segment are derived from the
 * same entity/cover geometry used by creature abilities.
 */
export function entityCanTargetTacticalFeature(
  scene: JsonRecord | undefined,
  source: JsonRecord,
  feature: JsonRecord,
  rangeInches: string,
): boolean {
  if (!isRecord(scene) || !isRecord(scene.geometry) || !isNonEmptyString(source.sceneId)) return false;
  const target = rectangularFeatureEntity(feature, source.sceneId);
  if (target === undefined || !entitiesWithinRange(source, target, rangeInches)) return false;
  const geometry = structuredClone(scene.geometry);
  if (!Array.isArray(geometry.obstacles)) return false;
  geometry.obstacles = geometry.obstacles.filter((entry) =>
    !isRecord(entry) || entry.featureId !== feature.featureId);
  return coverLevel({ ...structuredClone(scene), geometry }, source, target, []) !== "full";
}

function occupancySamples(entity: JsonRecord): ScaledPoint[] {
  const at = position(entity);
  const width = positiveDimension(entity, "width");
  const depth = positiveDimension(entity, "depth");
  const height = positiveDimension(entity, "height");
  const fractions = [1n, 3n, 5n, 7n];
  const xs = fractions.map((part) => at.x * 8n - width * 4n + part * width);
  const ys = fractions.map((part) => at.y * 8n - depth * 4n + part * depth);
  const zs = fractions.map((part) => at.elevation * 8n + part * height);
  const samples: ScaledPoint[] = [];
  for (const x of xs) for (const y of ys) for (const z of zs) samples.push({ x, y, z });
  samples.push({
    x: at.x * 8n,
    y: at.y * 8n,
    z: at.elevation * 8n + height * 4n,
  });
  return samples;
}

function compareFractions(left: Fraction, right: Fraction): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === 0n) throw new TypeError("geometry fraction denominator is zero");
  const signedNumerator = denominator < 0n ? -numerator : numerator;
  const positiveDenominator = denominator < 0n ? -denominator : denominator;
  const divisor = greatestCommonDivisor(signedNumerator, positiveDenominator);
  return { numerator: signedNumerator / divisor, denominator: positiveDenominator / divisor };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function fractionEqual(left: Fraction, right: Fraction): boolean {
  return compareFractions(left, right) === 0;
}

function addFraction(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function divideFraction(value: Fraction, divisor: bigint): Fraction {
  return fraction(value.numerator, value.denominator * divisor);
}

function parameterOnSegment(
  start: ScaledPoint,
  end: ScaledPoint,
  point: { x: bigint; y: bigint },
): Fraction | undefined {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx !== 0n) {
    const parameter = fraction(point.x - start.x, dx);
    return (point.y - start.y) * parameter.denominator === dy * parameter.numerator
      ? parameter
      : undefined;
  }
  if (dy !== 0n) {
    const parameter = fraction(point.y - start.y, dy);
    return (point.x - start.x) * parameter.denominator === dx * parameter.numerator
      ? parameter
      : undefined;
  }
  return undefined;
}

function segmentEdgeIntersectionParameter(
  start: ScaledPoint,
  end: ScaledPoint,
  edgeStart: PolygonPoint,
  edgeEnd: PolygonPoint,
): Fraction[] {
  const rx = end.x - start.x;
  const ry = end.y - start.y;
  const sx = edgeEnd.x - edgeStart.x;
  const sy = edgeEnd.y - edgeStart.y;
  const denominator = rx * sy - ry * sx;
  const qx = edgeStart.x - start.x;
  const qy = edgeStart.y - start.y;
  if (denominator !== 0n) {
    const t = fraction(qx * sy - qy * sx, denominator);
    const u = fraction(qx * ry - qy * rx, denominator);
    return compareFractions(t, fraction(0n, 1n)) >= 0
      && compareFractions(t, fraction(1n, 1n)) <= 0
      && compareFractions(u, fraction(0n, 1n)) >= 0
      && compareFractions(u, fraction(1n, 1n)) <= 0
      ? [t]
      : [];
  }
  if (qx * ry - qy * rx !== 0n) return [];
  return [
    parameterOnSegment(start, end, edgeStart),
    parameterOnSegment(start, end, edgeEnd),
  ].filter((entry): entry is Fraction => entry !== undefined
    && compareFractions(entry, fraction(0n, 1n)) >= 0
    && compareFractions(entry, fraction(1n, 1n)) <= 0);
}

function rationalPointAt(
  start: ScaledPoint,
  end: ScaledPoint,
  parameter: Fraction,
): { x: Fraction; y: Fraction; z: Fraction } {
  return {
    x: fraction(
      start.x * parameter.denominator + (end.x - start.x) * parameter.numerator,
      parameter.denominator,
    ),
    y: fraction(
      start.y * parameter.denominator + (end.y - start.y) * parameter.numerator,
      parameter.denominator,
    ),
    z: fraction(
      start.z * parameter.denominator + (end.z - start.z) * parameter.numerator,
      parameter.denominator,
    ),
  };
}

function pointStrictlyInsidePolygon(point: { x: Fraction; y: Fraction }, polygon: readonly PolygonPoint[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (point.x.numerator - current.x * point.x.denominator)
        * (next.y - current.y) * point.y.denominator
      - (point.y.numerator - current.y * point.y.denominator)
        * (next.x - current.x) * point.x.denominator;
    const betweenX = point.x.numerator >= (current.x < next.x ? current.x : next.x) * point.x.denominator
      && point.x.numerator <= (current.x > next.x ? current.x : next.x) * point.x.denominator;
    const betweenY = point.y.numerator >= (current.y < next.y ? current.y : next.y) * point.y.denominator
      && point.y.numerator <= (current.y > next.y ? current.y : next.y) * point.y.denominator;
    if (cross === 0n && betweenX && betweenY) return false;

    const currentAbove = current.y * point.y.denominator > point.y.numerator;
    const nextAbove = next.y * point.y.denominator > point.y.numerator;
    if (currentAbove === nextAbove) continue;
    const edgeDy = next.y - current.y;
    const intersectionNumerator = current.x * edgeDy * point.y.denominator
      + (point.y.numerator - current.y * point.y.denominator) * (next.x - current.x);
    const intersectionDenominator = edgeDy * point.y.denominator;
    const intersection = fraction(intersectionNumerator, intersectionDenominator);
    if (compareFractions(intersection, point.x) > 0) inside = !inside;
  }
  return inside;
}

function openPrismParameterIntervals(
  start: ScaledPoint,
  end: ScaledPoint,
  prism: ObstaclePrism,
): Array<{ lower: Fraction; upper: Fraction }> {
  const breakpoints: Fraction[] = [fraction(0n, 1n), fraction(1n, 1n)];
  const dz = end.z - start.z;
  if (dz !== 0n) {
    for (const boundary of [prism.elevation, prism.elevation + prism.height]) {
      const parameter = fraction(boundary - start.z, dz);
      if (compareFractions(parameter, fraction(0n, 1n)) > 0
        && compareFractions(parameter, fraction(1n, 1n)) < 0) breakpoints.push(parameter);
    }
  }
  for (let index = 0; index < prism.polygon.length; index += 1) {
    breakpoints.push(...segmentEdgeIntersectionParameter(
      start,
      end,
      prism.polygon[index],
      prism.polygon[(index + 1) % prism.polygon.length],
    ));
  }
  breakpoints.sort(compareFractions);
  const unique = breakpoints.filter((entry, index) => index === 0 || !fractionEqual(entry, breakpoints[index - 1]));
  const intervals: Array<{ lower: Fraction; upper: Fraction }> = [];
  for (let index = 1; index < unique.length; index += 1) {
    if (fractionEqual(unique[index - 1], unique[index])) continue;
    const middle = divideFraction(addFraction(unique[index - 1], unique[index]), 2n);
    if (compareFractions(middle, fraction(0n, 1n)) <= 0
      || compareFractions(middle, fraction(1n, 1n)) >= 0) continue;
    const point = rationalPointAt(start, end, middle);
    const aboveBottom = compareFractions(point.z, fraction(prism.elevation, 1n)) > 0;
    const belowTop = compareFractions(point.z, fraction(prism.elevation + prism.height, 1n)) < 0;
    if (aboveBottom && belowTop && pointStrictlyInsidePolygon(point, prism.polygon)) {
      intervals.push({ lower: unique[index - 1], upper: unique[index] });
    }
  }
  return mergedIntervals(intervals);
}

function openPrismEntryParameter(
  start: ScaledPoint,
  end: ScaledPoint,
  prism: ObstaclePrism,
): Fraction | undefined {
  return openPrismParameterIntervals(start, end, prism)[0]?.lower;
}

/** Exact open-segment versus arbitrary simple-polygon prism intersection. */
function segmentIntersectsOpenPrism(
  start: ScaledPoint,
  end: ScaledPoint,
  prism: ObstaclePrism,
): boolean {
  return openPrismEntryParameter(start, end, prism) !== undefined;
}

function openBoxParameterInterval(
  start: ScaledPoint,
  end: ScaledPoint,
  box: { x: AxisInterval; y: AxisInterval; z: AxisInterval },
): { lower: Fraction; upper: Fraction } | undefined {
  let lower = fraction(0n, 1n);
  let upper = fraction(1n, 1n);
  for (const axis of ["x", "y", "z"] as const) {
    const origin = start[axis];
    const delta = end[axis] - origin;
    if (delta === 0n) {
      if (origin <= box[axis].low || origin >= box[axis].high) return undefined;
      continue;
    }
    let first = fraction(box[axis].low - origin, delta);
    let second = fraction(box[axis].high - origin, delta);
    if (compareFractions(first, second) > 0) [first, second] = [second, first];
    if (compareFractions(first, lower) > 0) lower = first;
    if (compareFractions(second, upper) < 0) upper = second;
    if (compareFractions(lower, upper) >= 0) return undefined;
  }
  return compareFractions(lower, fraction(1n, 1n)) < 0
    && compareFractions(upper, fraction(0n, 1n)) > 0
    && compareFractions(lower, upper) < 0
    ? { lower, upper }
    : undefined;
}

function segmentIntersectsOpenBox(
  start: ScaledPoint,
  end: ScaledPoint,
  box: { x: AxisInterval; y: AxisInterval; z: AxisInterval },
): boolean {
  return openBoxParameterInterval(start, end, box) !== undefined;
}

function scaledOccupancy(entity: JsonRecord, scale: bigint): {
  x: AxisInterval;
  y: AxisInterval;
  z: AxisInterval;
} {
  const at = position(entity);
  const width = positiveDimension(entity, "width");
  const depth = positiveDimension(entity, "depth");
  const height = positiveDimension(entity, "height");
  const halfScale = scale / 2n;
  return {
    x: { low: at.x * scale - width * halfScale, high: at.x * scale + width * halfScale },
    y: { low: at.y * scale - depth * halfScale, high: at.y * scale + depth * halfScale },
    z: { low: at.elevation * scale, high: (at.elevation + height) * scale },
  };
}

function obstaclePrism(obstacle: JsonRecord, scale: bigint): ObstaclePrism | undefined {
  if (!Array.isArray(obstacle.polygon) || obstacle.polygon.length < 3) return undefined;
  const points = obstacle.polygon.map((entry) => {
    if (!isRecord(entry)) return undefined;
    const x = canonicalInteger(entry.x);
    const y = canonicalInteger(entry.y);
    return x === undefined || y === undefined ? undefined : { x, y };
  });
  const elevation = canonicalInteger(obstacle.elevation);
  const height = canonicalInteger(obstacle.height);
  if (points.some((entry) => entry === undefined)
    || elevation === undefined || height === undefined || height <= 0n) return undefined;
  return {
    polygon: (points as Array<{ x: bigint; y: bigint }>).map(({ x, y }) => ({ x: x * scale, y: y * scale })),
    elevation: elevation * scale,
    height: height * scale,
  };
}

export type CoverLevel = "none" | "half" | "threeQuarters" | "full";

/** Fixed 64-sample cover classification from the pinned Geometry profile. */
export function coverLevel(
  scene: JsonRecord | undefined,
  source: JsonRecord,
  target: JsonRecord,
  possibleSoftCover: readonly JsonRecord[],
): CoverLevel {
  const scale = 40n;
  const at = position(source);
  const bodyHeight = positiveDimension(source, "height");
  const sightOrigin: ScaledPoint = {
    x: at.x * scale,
    y: at.y * scale,
    z: at.elevation * scale + bodyHeight * 32n,
  };
  const targetSamples = occupancySamples(target).slice(0, 64).map((sample) => ({
    x: sample.x * 5n,
    y: sample.y * 5n,
    z: sample.z * 5n,
  }));
  const obstacles = isRecord(scene?.geometry) && Array.isArray(scene.geometry.obstacles)
    ? scene.geometry.obstacles.filter((entry): entry is JsonRecord => isRecord(entry) && entry.opaque === true)
    : [];
  const hardPrisms = obstacles
    .map((entry) => obstaclePrism(entry, scale))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const sourceId = String(source.id ?? source.entityId);
  const targetId = String(target.id ?? target.entityId);
  const softBoxes = possibleSoftCover
    .filter((entry) => {
      const id = String(entry.id ?? entry.entityId);
      return id !== sourceId && id !== targetId
        && entry.lifeState !== "dead"
        && entry.sceneId === source.sceneId
        && isRecord(entry.position)
        && isRecord(entry.footprint);
    })
    .map((entry) => scaledOccupancy(entry, scale));
  let hardBlocked = 0;
  let hardOrSoftBlocked = 0;
  for (const sample of targetSamples) {
    const hard = hardPrisms.some((prism) => segmentIntersectsOpenPrism(sightOrigin, sample, prism));
    const soft = !hard && softBoxes.some((box) => segmentIntersectsOpenBox(sightOrigin, sample, box));
    if (hard) hardBlocked += 1;
    if (hard || soft) hardOrSoftBlocked += 1;
  }
  if (hardBlocked === 64) return "full";
  if (hardBlocked >= 48) return "threeQuarters";
  if (hardOrSoftBlocked >= 32) return "half";
  return "none";
}

function parseFractionComponent(value: unknown): Fraction | undefined {
  if (typeof value === "string") {
    const parsed = canonicalInteger(value);
    return parsed === undefined ? undefined : fraction(parsed, 1n);
  }
  if (!isRecord(value)
    || Object.keys(value).sort().join(",") !== "denominator,numerator"
    || typeof value.numerator !== "string"
    || typeof value.denominator !== "string"
    || !INTEGER_PATTERN.test(value.numerator)
    || !/^(0*[1-9][0-9]*)$/.test(value.denominator)) return undefined;
  const parsed = fraction(BigInt(value.numerator), BigInt(value.denominator));
  return parsed.numerator.toString() === value.numerator
      && parsed.denominator.toString() === value.denominator
    ? parsed
    : undefined;
}

function parseRationalPoint(value: unknown): RationalPoint | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "elevation,x,y") return undefined;
  const x = parseFractionComponent(value.x);
  const y = parseFractionComponent(value.y);
  const z = parseFractionComponent(value.elevation);
  return x === undefined || y === undefined || z === undefined ? undefined : { x, y, z };
}

function areaSourcePoint(value: unknown): RationalPoint | undefined {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.footprint)) {
    return parseRationalPoint(value);
  }
  const at = canonicalCombatPoint(value.position);
  if (at === undefined) return undefined;
  const height = positiveDimension(value, "height");
  return {
    x: fraction(BigInt(at.x), 1n),
    y: fraction(BigInt(at.y), 1n),
    z: addFraction(fraction(BigInt(at.elevation), 1n), fraction(height * 4n, 5n)),
  };
}

function serializeFraction(value: Fraction): string | { numerator: string; denominator: string } {
  return value.denominator === 1n
    ? value.numerator.toString()
    : { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
}

export type FrozenCombatPoint = {
  x: string | { numerator: string; denominator: string };
  y: string | { numerator: string; denominator: string };
  elevation: string | { numerator: string; denominator: string };
};

function serializePoint(value: RationalPoint): FrozenCombatPoint {
  return {
    x: serializeFraction(value.x),
    y: serializeFraction(value.y),
    elevation: serializeFraction(value.z),
  };
}

function scaledVectorFromOrigin(sample: ScaledPoint, origin: RationalPoint, scale: bigint): DirectionVector {
  const commonDenominator = origin.x.denominator * origin.y.denominator * origin.z.denominator;
  return {
    x: sample.x * commonDenominator
      - origin.x.numerator * scale * (commonDenominator / origin.x.denominator),
    y: sample.y * commonDenominator
      - origin.y.numerator * scale * (commonDenominator / origin.y.denominator),
    z: sample.z * commonDenominator
      - origin.z.numerator * scale * (commonDenominator / origin.z.denominator),
  };
}

function rationalScale(origin: RationalPoint): bigint {
  return origin.x.denominator * origin.y.denominator * origin.z.denominator;
}

function dot(left: DirectionVector, right: DirectionVector): bigint {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function squaredLength(value: DirectionVector): bigint {
  return dot(value, value);
}

function cross(left: DirectionVector, right: DirectionVector): DirectionVector {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function reduceDirection(value: DirectionVector): DirectionVector | undefined {
  const divisor = greatestCommonDivisor(
    greatestCommonDivisor(value.x, value.y),
    value.z,
  );
  if (value.x === 0n && value.y === 0n && value.z === 0n) return undefined;
  return { x: value.x / divisor, y: value.y / divisor, z: value.z / divisor };
}

export function canonicalCombatDirection(value: unknown): { x: string; y: string; elevation: string } | undefined {
  const parsed = canonicalCombatPoint(value);
  if (parsed === undefined) return undefined;
  const reduced = reduceDirection({
    x: BigInt(parsed.x),
    y: BigInt(parsed.y),
    z: BigInt(parsed.elevation),
  });
  return reduced === undefined ? undefined : {
    x: reduced.x.toString(),
    y: reduced.y.toString(),
    elevation: reduced.z.toString(),
  };
}

function parsedDirection(value: unknown): DirectionVector | undefined {
  const parsed = canonicalCombatDirection(value);
  return parsed === undefined ? undefined : {
    x: BigInt(parsed.x),
    y: BigInt(parsed.y),
    z: BigInt(parsed.elevation),
  };
}

function canonicalPositiveInches(value: unknown): bigint | undefined {
  const parsed = canonicalInteger(value);
  return parsed !== undefined && parsed > 0n ? parsed : undefined;
}

export function canonicalAreaShape(value: unknown): JsonRecord | undefined {
  if (!isRecord(value) || !isNonEmptyAreaKind(value.kind)
    || !["straight", "aroundCorners"].includes(String(value.propagation))) return undefined;
  const commonKeys = value.propagation === "aroundCorners" ? ["kind", "propagation", "spreadBudgetInches"] : ["kind", "propagation"];
  if (value.propagation === "aroundCorners" && canonicalPositiveInches(value.spreadBudgetInches) === undefined) return undefined;
  let dimensionKeys: string[];
  switch (value.kind) {
    case "sphere": dimensionKeys = ["radiusInches"]; break;
    case "cylinder": dimensionKeys = ["heightInches", "radiusInches"]; break;
    case "cube": dimensionKeys = ["edgeInches"]; break;
    case "cone": dimensionKeys = ["lengthInches"]; break;
    case "line": dimensionKeys = ["lengthInches", "widthInches"]; break;
    default: return undefined;
  }
  if (Object.keys(value).sort().join(",") !== [...commonKeys, ...dimensionKeys].sort().join(",")
    || dimensionKeys.some((key) => canonicalPositiveInches(value[key]) === undefined)) return undefined;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function isNonEmptyAreaKind(value: unknown): value is "sphere" | "cylinder" | "cube" | "cone" | "line" {
  return ["sphere", "cylinder", "cube", "cone", "line"].includes(String(value));
}

function orientedBasis(direction: DirectionVector): { forward: DirectionVector; side: DirectionVector; vertical: DirectionVector } {
  const side = reduceDirection(direction.x === 0n && direction.y === 0n
    ? { x: 1n, y: 0n, z: 0n }
    : cross({ x: 0n, y: 0n, z: 1n }, direction));
  if (side === undefined) throw new TypeError("area side basis is unavailable");
  const vertical = reduceDirection(cross(direction, side));
  if (vertical === undefined) throw new TypeError("area vertical basis is unavailable");
  return { forward: direction, side, vertical };
}

function insideOrientedPrism(
  vector: DirectionVector,
  direction: DirectionVector,
  length: bigint,
  width: bigint,
  height: bigint,
  unitScale: bigint,
): boolean {
  const { forward, side, vertical } = orientedBasis(direction);
  const forwardDot = dot(vector, forward);
  const forwardSquared = squaredLength(forward);
  if (forwardDot < 0n || forwardDot * forwardDot > length * length * unitScale * unitScale * forwardSquared) return false;
  const sideDot = dot(vector, side);
  const verticalDot = dot(vector, vertical);
  return 4n * sideDot * sideDot <= width * width * unitScale * unitScale * squaredLength(side)
    && 4n * verticalDot * verticalDot <= height * height * unitScale * unitScale * squaredLength(vertical);
}

function sampleInsideArea(
  sample: ScaledPoint,
  sampleScale: bigint,
  origin: RationalPoint,
  shape: JsonRecord,
  direction: DirectionVector | undefined,
): boolean {
  const denominatorScale = rationalScale(origin);
  const vector = scaledVectorFromOrigin(sample, origin, sampleScale);
  const unitScale = sampleScale * denominatorScale;
  switch (shape.kind) {
    case "sphere": {
      const radius = BigInt(String(shape.radiusInches));
      return squaredLength(vector) <= radius * radius * unitScale * unitScale;
    }
    case "cylinder": {
      const radius = BigInt(String(shape.radiusInches));
      const height = BigInt(String(shape.heightInches));
      return vector.z >= 0n && vector.z <= height * unitScale
        && vector.x * vector.x + vector.y * vector.y <= radius * radius * unitScale * unitScale;
    }
    case "cube": {
      if (direction === undefined) return false;
      const edge = BigInt(String(shape.edgeInches));
      return insideOrientedPrism(vector, direction, edge, edge, edge, unitScale);
    }
    case "line": {
      if (direction === undefined) return false;
      return insideOrientedPrism(
        vector,
        direction,
        BigInt(String(shape.lengthInches)),
        BigInt(String(shape.widthInches)),
        BigInt(String(shape.widthInches)),
        unitScale,
      );
    }
    case "cone": {
      if (direction === undefined) return false;
      const forwardDot = dot(vector, direction);
      const directionSquared = squaredLength(direction);
      const length = BigInt(String(shape.lengthInches));
      if (forwardDot < 0n
        || forwardDot * forwardDot > length * length * unitScale * unitScale * directionSquared) return false;
      const radialNumerator = squaredLength(vector) * directionSquared - forwardDot * forwardDot;
      return 4n * radialNumerator <= forwardDot * forwardDot;
    }
    default:
      return false;
  }
}

function sceneObstaclePrisms(scene: JsonRecord | undefined, scale: bigint): ObstaclePrism[] {
  const obstacles = isRecord(scene?.geometry) && Array.isArray(scene.geometry.obstacles)
    ? scene.geometry.obstacles.filter((entry): entry is JsonRecord => isRecord(entry) && entry.opaque === true)
    : [];
  return obstacles
    .map((entry) => obstaclePrism(entry, scale))
    .filter((entry): entry is ObstaclePrism => entry !== undefined);
}

function pointOnClosedSegment2d(point: PolygonPoint, start: PolygonPoint, end: PolygonPoint): boolean {
  const crossProduct = (point.x - start.x) * (end.y - start.y)
    - (point.y - start.y) * (end.x - start.x);
  if (crossProduct !== 0n) return false;
  return point.x >= (start.x < end.x ? start.x : end.x)
    && point.x <= (start.x > end.x ? start.x : end.x)
    && point.y >= (start.y < end.y ? start.y : end.y)
    && point.y <= (start.y > end.y ? start.y : end.y);
}

function pointInOrOnPolygon(point: PolygonPoint, polygon: readonly PolygonPoint[]): boolean {
  return pointStrictlyInsidePolygon(
    { x: fraction(point.x, 1n), y: fraction(point.y, 1n) },
    polygon,
  ) || polygon.some((start, index) =>
    pointOnClosedSegment2d(point, start, polygon[(index + 1) % polygon.length]));
}

function closedSegmentsIntersect2d(
  firstStart: PolygonPoint,
  firstEnd: PolygonPoint,
  secondStart: PolygonPoint,
  secondEnd: PolygonPoint,
): boolean {
  const orientation = (start: PolygonPoint, end: PolygonPoint, point: PolygonPoint) =>
    (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  const firstSecond = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirst = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  if (((firstSecond < 0n && firstSecondEnd > 0n) || (firstSecond > 0n && firstSecondEnd < 0n))
    && ((secondFirst < 0n && secondFirstEnd > 0n) || (secondFirst > 0n && secondFirstEnd < 0n))) return true;
  return (firstSecond === 0n && pointOnClosedSegment2d(secondStart, firstStart, firstEnd))
    || (firstSecondEnd === 0n && pointOnClosedSegment2d(secondEnd, firstStart, firstEnd))
    || (secondFirst === 0n && pointOnClosedSegment2d(firstStart, secondStart, secondEnd))
    || (secondFirstEnd === 0n && pointOnClosedSegment2d(firstEnd, secondStart, secondEnd));
}

function convexHull(points: readonly PolygonPoint[]): PolygonPoint[] {
  const sorted = [...points]
    .sort((left, right) => left.x < right.x ? -1 : left.x > right.x ? 1 : left.y < right.y ? -1 : left.y > right.y ? 1 : 0)
    .filter((point, index, values) => index === 0
      || point.x !== values[index - 1].x
      || point.y !== values[index - 1].y);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: PolygonPoint, left: PolygonPoint, right: PolygonPoint) =>
    (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
  const half = (values: readonly PolygonPoint[]) => {
    const result: PolygonPoint[] = [];
    for (const point of values) {
      while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0n) {
        result.pop();
      }
      result.push(point);
    }
    return result;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A wall touching any part of a 12-inch voxel makes that voxel unavailable. */
function voxelIntersectsObstacle(center: ScaledPoint, voxel: bigint, prism: ObstaclePrism): boolean {
  const half = voxel / 2n;
  const bottom = center.z - half;
  const top = center.z + half;
  if (top < prism.elevation || prism.elevation + prism.height < bottom) return false;
  const lowX = center.x - half;
  const highX = center.x + half;
  const lowY = center.y - half;
  const highY = center.y + half;
  const square: PolygonPoint[] = [
    { x: lowX, y: lowY },
    { x: highX, y: lowY },
    { x: highX, y: highY },
    { x: lowX, y: highY },
  ];
  if (prism.polygon.some(({ x, y }) => x >= lowX && x <= highX && y >= lowY && y <= highY)) return true;
  if (square.some((corner) => pointInOrOnPolygon(corner, prism.polygon))) return true;
  return square.some((start, squareIndex) => {
    const end = square[(squareIndex + 1) % square.length];
    return prism.polygon.some((wallStart, wallIndex) =>
      closedSegmentsIntersect2d(start, end, wallStart, prism.polygon[(wallIndex + 1) % prism.polygon.length]));
  });
}

function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function aroundCornersReachable(
  origin: RationalPoint,
  sample: ScaledPoint,
  shape: JsonRecord,
  direction: DirectionVector | undefined,
  prisms: ObstaclePrism[],
): boolean {
  const scale = 8n;
  const voxel = 12n * scale;
  const cellFor = (point: ScaledPoint) => ({
    x: floorDivide(point.x, voxel),
    y: floorDivide(point.y, voxel),
    z: floorDivide(point.z, voxel),
  });
  const cellForRational = (point: RationalPoint) => ({
    x: floorDivide(point.x.numerator, point.x.denominator * 12n),
    y: floorDivide(point.y.numerator, point.y.denominator * 12n),
    z: floorDivide(point.z.numerator, point.z.denominator * 12n),
  });
  const centerFor = (cell: DirectionVector): ScaledPoint => ({
    x: cell.x * voxel + voxel / 2n,
    y: cell.y * voxel + voxel / 2n,
    z: cell.z * voxel + voxel / 2n,
  });
  const keyFor = (cell: DirectionVector) => `${cell.x}:${cell.y}:${cell.z}`;
  const start = cellForRational(origin);
  const goal = cellFor(sample);
  const budget = BigInt(String(shape.spreadBudgetInches)) / 12n;
  const queue: Array<{ cell: DirectionVector; distance: bigint }> = [{ cell: start, distance: 0n }];
  const visited = new Set([keyFor(start)]);
  const directions: DirectionVector[] = [
    { x: -1n, y: 0n, z: 0n }, { x: 0n, y: -1n, z: 0n }, { x: 0n, y: 0n, z: -1n },
    { x: 0n, y: 0n, z: 1n }, { x: 0n, y: 1n, z: 0n }, { x: 1n, y: 0n, z: 0n },
  ];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (keyFor(current.cell) === keyFor(goal)) return true;
    if (current.distance >= budget) continue;
    for (const offset of directions) {
      const next = {
        x: current.cell.x + offset.x,
        y: current.cell.y + offset.y,
        z: current.cell.z + offset.z,
      };
      const key = keyFor(next);
      if (visited.has(key)) continue;
      const center = centerFor(next);
      if (!sampleInsideArea(center, scale, origin, shape, direction)
        || prisms.some((prism) => voxelIntersectsObstacle(center, voxel, prism))) continue;
      visited.add(key);
      queue.push({ cell: next, distance: current.distance + 1n });
      if (queue.length > 100_000) throw new TypeError("geometryContinuationRequired");
    }
  }
  return false;
}

function propagationAllows(
  origin: RationalPoint,
  sample: ScaledPoint,
  shape: JsonRecord,
  direction: DirectionVector | undefined,
  prisms: ObstaclePrism[],
): boolean {
  if (shape.propagation === "aroundCorners") {
    return aroundCornersReachable(origin, sample, shape, direction, prisms);
  }
  const denominator = rationalScale(origin);
  const start = {
    x: origin.x.numerator * 8n * (denominator / origin.x.denominator),
    y: origin.y.numerator * 8n * (denominator / origin.y.denominator),
    z: origin.z.numerator * 8n * (denominator / origin.z.denominator),
  };
  const end = { x: sample.x * denominator, y: sample.y * denominator, z: sample.z * denominator };
  const scaledPrisms = prisms.map((prism) => ({
    polygon: prism.polygon.map(({ x, y }) => ({ x: x * denominator, y: y * denominator })),
    elevation: prism.elevation * denominator,
    height: prism.height * denominator,
  }));
  return !scaledPrisms.some((prism) => segmentIntersectsOpenPrism(start, end, prism));
}

/**
 * Computes every affected entity from the authoritative state. The optional
 * caller target list never participates in this function.
 */
export function entitiesAffectedByArea(
  entities: readonly JsonRecord[],
  scene: JsonRecord | undefined,
  originValue: unknown,
  shapeValue: unknown,
  directionValue?: unknown,
): string[] {
  const origin = parseRationalPoint(originValue);
  const shape = canonicalAreaShape(shapeValue);
  const direction = directionValue === undefined ? undefined : parsedDirection(directionValue);
  if (origin === undefined || shape === undefined
    || (["cube", "cone", "line"].includes(String(shape.kind)) && direction === undefined)) {
    throw new TypeError("area geometry is malformed");
  }
  const prisms = sceneObstaclePrisms(scene, 8n);
  return entities
    .filter((entity) => entity.lifeState !== "dead"
      && occupancySamples(entity).some((sample) => sampleInsideArea(sample, 8n, origin, shape, direction)
        && propagationAllows(origin, sample, shape, direction, prisms)))
    .sort((left, right) => {
      const ordinal = BigInt(String(left.entityOrdinal ?? "0")) - BigInt(String(right.entityOrdinal ?? "0"));
      if (ordinal !== 0n) return ordinal < 0n ? -1 : 1;
      return String(left.id ?? left.entityId).localeCompare(String(right.id ?? right.entityId));
    })
    .map((entity) => String(entity.id ?? entity.entityId));
}

/** Freezes a requested area origin at the first opaque obstacle boundary. */
export function freezeAreaOrigin(
  scene: JsonRecord | undefined,
  sourceValue: unknown,
  requestedValue: unknown,
): FrozenCombatPoint | undefined {
  const source = areaSourcePoint(sourceValue);
  const requested = parseRationalPoint(requestedValue);
  if (source === undefined || requested === undefined) return undefined;
  const scale = source.x.denominator * source.y.denominator * source.z.denominator
    * requested.x.denominator * requested.y.denominator * requested.z.denominator;
  const scaledPoint = (point: RationalPoint): ScaledPoint => ({
    x: point.x.numerator * (scale / point.x.denominator),
    y: point.y.numerator * (scale / point.y.denominator),
    z: point.z.numerator * (scale / point.z.denominator),
  });
  const start = scaledPoint(source);
  const end = scaledPoint(requested);
  let first: Fraction | undefined;
  for (const prism of sceneObstaclePrisms(scene, scale)) {
    const entry = openPrismEntryParameter(start, end, prism);
    if (entry !== undefined && (first === undefined || compareFractions(entry, first) < 0)) first = entry;
  }
  if (first === undefined) return serializePoint(requested);
  const frozen = rationalPointAt(start, end, first);
  return serializePoint({
    x: divideFraction(frozen.x, scale),
    y: divideFraction(frozen.y, scale),
    z: divideFraction(frozen.z, scale),
  });
}

/**
 * Determines the authoritative target set from entity occupancy.  The caller
 * supplies candidates, never the result set, and stable ordinals decide order.
 */
export function entitiesAffectedBySphere(
  entities: readonly JsonRecord[],
  originValue: unknown,
  radiusInches: string,
): string[] {
  return entitiesAffectedByArea(entities, undefined, originValue, {
    kind: "sphere",
    propagation: "straight",
    radiusInches,
  });
}

function ceilSquareRoot(value: bigint): bigint {
  if (value < 0n) throw new TypeError("square-root input must be non-negative");
  if (value < 2n) return value;
  let low = 1n;
  let high = value;
  while (low < high) {
    const middle = (low + high) >> 1n;
    if (middle * middle >= value) high = middle;
    else low = middle + 1n;
  }
  return low;
}

export function canonicalizeCombatPath(value: unknown): CanonicalCombatPoint[] | undefined {
  if (!Array.isArray(value) || value.length < 2 || value.length > 256) return undefined;
  const parsed = value.map(canonicalCombatPoint);
  if (parsed.some((entry) => entry === undefined)) return undefined;
  const points = parsed as CanonicalCombatPoint[];
  const deduplicated = points.filter((entry, index) => index === 0
    || entry.x !== points[index - 1].x
    || entry.y !== points[index - 1].y
    || entry.elevation !== points[index - 1].elevation);
  if (deduplicated.length < 2) return undefined;
  const result: CanonicalCombatPoint[] = [];
  for (const current of deduplicated) {
    while (result.length >= 2) {
      const before = result[result.length - 2];
      const middle = result[result.length - 1];
      const first = [BigInt(middle.x) - BigInt(before.x), BigInt(middle.y) - BigInt(before.y), BigInt(middle.elevation) - BigInt(before.elevation)];
      const second = [BigInt(current.x) - BigInt(middle.x), BigInt(current.y) - BigInt(middle.y), BigInt(current.elevation) - BigInt(middle.elevation)];
      const cross = [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
      ];
      const sameDirection = first[0] * second[0] + first[1] * second[1] + first[2] * second[2] >= 0n;
      if (cross.some((component) => component !== 0n) || !sameDirection) break;
      result.pop();
    }
    result.push(current);
  }
  return result.length >= 2 ? result : undefined;
}

export function pathLengthMilliInches(path: readonly CanonicalCombatPoint[]): string {
  let total = 0n;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const dx = BigInt(current.x) - BigInt(previous.x);
    const dy = BigInt(current.y) - BigInt(previous.y);
    const dz = BigInt(current.elevation) - BigInt(previous.elevation);
    total += ceilSquareRoot((dx * dx + dy * dy + dz * dz) * 1_000_000n);
  }
  return total.toString();
}

export type CombatMovementAnalysis =
  | {
      ok: true;
      path: CanonicalCombatPoint[];
      baseMilliInches: string;
      difficultMilliInches: string;
      squeezeMilliInches: string;
      totalMilliInches: string;
      traversedCreatureIds: string[];
      squeezingAtEndpoint: boolean;
    }
  | {
      ok: false;
      code: "blockedPath" | "occupiedEndpoint";
    };

function entitySizeRank(entity: JsonRecord): number {
  const explicit = typeof entity.sizeCategory === "string"
    ? ["tiny", "small", "medium", "large", "huge", "gargantuan"].indexOf(entity.sizeCategory)
    : -1;
  if (explicit >= 0) return explicit;
  const largest = positiveDimension(entity, "width") > positiveDimension(entity, "depth")
    ? positiveDimension(entity, "width")
    : positiveDimension(entity, "depth");
  if (largest <= 30n) return 0;
  if (largest <= 60n) return 2;
  if (largest <= 120n) return 3;
  if (largest <= 180n) return 4;
  return 5;
}

type ClearanceZone = {
  zoneId: string;
  capacitySizeRank: number;
  prism: ObstaclePrism;
};

function clearanceZones(scene: JsonRecord | undefined, scale: bigint): ClearanceZone[] {
  const values = isRecord(scene?.geometry) && Array.isArray(scene.geometry.clearanceZones)
    ? scene.geometry.clearanceZones
    : [];
  return values.flatMap((value): ClearanceZone[] => {
    if (!isRecord(value) || !isNonEmptyString(value.zoneId) || typeof value.capacitySize !== "string") return [];
    const capacitySizeRank = ["tiny", "small", "medium", "large", "huge", "gargantuan"]
      .indexOf(value.capacitySize);
    const prism = obstaclePrism(value, scale);
    return capacitySizeRank < 0 || prism === undefined
      ? []
      : [{ zoneId: value.zoneId, capacitySizeRank, prism }];
  }).sort((left, right) => left.zoneId.localeCompare(right.zoneId));
}

function pointStrictlyInsidePrism(point: ScaledPoint, prism: ObstaclePrism): boolean {
  return point.z > prism.elevation
    && point.z < prism.elevation + prism.height
    && pointStrictlyInsidePolygon(
      { x: fraction(point.x, 1n), y: fraction(point.y, 1n) },
      prism.polygon,
    );
}

function traversedEntitySpaceBox(target: JsonRecord, mover: JsonRecord): {
  x: AxisInterval;
  y: AxisInterval;
  z: AxisInterval;
} {
  const at = position(target);
  const targetWidth = positiveDimension(target, "width");
  const targetDepth = positiveDimension(target, "depth");
  const targetHeight = positiveDimension(target, "height");
  const moverWidth = positiveDimension(mover, "width");
  const moverDepth = positiveDimension(mover, "depth");
  const moverHeight = positiveDimension(mover, "height");
  return {
    x: {
      low: at.x * 2n - targetWidth - moverWidth,
      high: at.x * 2n + targetWidth + moverWidth,
    },
    y: {
      low: at.y * 2n - targetDepth - moverDepth,
      high: at.y * 2n + targetDepth + moverDepth,
    },
    z: { low: (at.elevation - moverHeight) * 2n, high: (at.elevation + targetHeight) * 2n },
  };
}

function pathPointAtScale(point: CanonicalCombatPoint, scale: bigint): ScaledPoint {
  return {
    x: BigInt(point.x) * scale,
    y: BigInt(point.y) * scale,
    z: BigInt(point.elevation) * scale,
  };
}

function clippedInterval(value: { lower: Fraction; upper: Fraction }): { lower: Fraction; upper: Fraction } | undefined {
  const lower = compareFractions(value.lower, fraction(0n, 1n)) < 0 ? fraction(0n, 1n) : value.lower;
  const upper = compareFractions(value.upper, fraction(1n, 1n)) > 0 ? fraction(1n, 1n) : value.upper;
  return compareFractions(lower, upper) < 0 ? { lower, upper } : undefined;
}

function mergedIntervals(values: Array<{ lower: Fraction; upper: Fraction }>): Array<{ lower: Fraction; upper: Fraction }> {
  const sorted = values
    .map(clippedInterval)
    .filter((entry): entry is { lower: Fraction; upper: Fraction } => entry !== undefined)
    .sort((left, right) => compareFractions(left.lower, right.lower));
  const result: Array<{ lower: Fraction; upper: Fraction }> = [];
  for (const current of sorted) {
    const previous = result[result.length - 1];
    if (previous === undefined || compareFractions(current.lower, previous.upper) > 0) {
      result.push(current);
      continue;
    }
    if (compareFractions(current.upper, previous.upper) > 0) previous.upper = current.upper;
  }
  return result;
}

function intervalLengthMilliInches(
  start: CanonicalCombatPoint,
  end: CanonicalCombatPoint,
  interval: { lower: Fraction; upper: Fraction },
): bigint {
  const dx = BigInt(end.x) - BigInt(start.x);
  const dy = BigInt(end.y) - BigInt(start.y);
  const dz = BigInt(end.elevation) - BigInt(start.elevation);
  const length = addFraction(interval.upper, fraction(-interval.lower.numerator, interval.lower.denominator));
  const numerator = (dx * dx + dy * dy + dz * dz)
    * 1_000_000n * length.numerator * length.numerator;
  const denominator = length.denominator;
  return (ceilSquareRoot(numerator) + denominator - 1n) / denominator;
}

function impassableObstaclePrisms(scene: JsonRecord | undefined, scale: bigint): ObstaclePrism[] {
  const obstacles = isRecord(scene?.geometry) && Array.isArray(scene.geometry.obstacles)
    ? scene.geometry.obstacles.filter((entry): entry is JsonRecord => isRecord(entry) && entry.impassable === true)
    : [];
  return obstacles
    .map((entry) => obstaclePrism(entry, scale))
    .filter((entry): entry is ObstaclePrism => entry !== undefined);
}

function movementSegmentHitsObstacle(
  mover: JsonRecord,
  start: CanonicalCombatPoint,
  end: CanonicalCombatPoint,
  prism: ObstaclePrism,
): boolean {
  const scale = 2n;
  const halfWidth = positiveDimension(mover, "width");
  const halfDepth = positiveDimension(mover, "depth");
  const height = positiveDimension(mover, "height") * scale;
  const bottomStart = pathPointAtScale(start, scale);
  const bottomEnd = pathPointAtScale(end, scale);
  const expandedElevation = prism.elevation - height;
  const expandedHeight = prism.height + height;
  if (segmentIntersectsOpenPrism(bottomStart, bottomEnd, {
    polygon: prism.polygon,
    elevation: expandedElevation,
    height: expandedHeight,
  })) return true;
  const offsets = [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ];
  return prism.polygon.some((edgeStart, index) => {
    const edgeEnd = prism.polygon[(index + 1) % prism.polygon.length];
    const expandedEdge = convexHull(offsets.flatMap((offset) => [
      { x: edgeStart.x + offset.x, y: edgeStart.y + offset.y },
      { x: edgeEnd.x + offset.x, y: edgeEnd.y + offset.y },
    ]));
    return segmentIntersectsOpenPrism(bottomStart, bottomEnd, {
      polygon: expandedEdge,
      elevation: expandedElevation,
      height: expandedHeight,
    });
  });
}

/**
 * Validates continuous creature/terrain occupancy and computes the one-time
 * difficult-terrain surcharge for traversable creature spaces.
 */
export function analyzeCombatMovement(
  mover: JsonRecord,
  entities: readonly JsonRecord[],
  scene: JsonRecord | undefined,
  pathValue: unknown,
  hostileEntityIds: ReadonlySet<string>,
): CombatMovementAnalysis {
  const path = canonicalizeCombatPath(pathValue);
  if (path === undefined) return { ok: false, code: "blockedPath" };
  const moverId = String(mover.id ?? mover.entityId);
  const others = entities.filter((entry) => String(entry.id ?? entry.entityId) !== moverId
    && entry.lifeState !== "dead"
    && entry.sceneId === mover.sceneId
    && isRecord(entry.position)
    && isRecord(entry.footprint));
  const endpoint = { ...structuredClone(mover), position: structuredClone(path[path.length - 1]) } as JsonRecord;
  if (others.some((entry) => entityOccupanciesOverlap(endpoint, entry))) {
    return { ok: false, code: "occupiedEndpoint" };
  }

  const obstaclePrisms = impassableObstaclePrisms(scene, 2n);
  const passageZones = clearanceZones(scene, 2n);
  const moverSizeRank = entitySizeRank(mover);
  const difficultBySegment: Array<Array<{ lower: Fraction; upper: Fraction }>> = path
    .slice(1)
    .map(() => []);
  const squeezeBySegment: Array<Array<{ lower: Fraction; upper: Fraction }>> = path
    .slice(1)
    .map(() => []);
  const traversed = new Set<string>();
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    if (obstaclePrisms.some((prism) => movementSegmentHitsObstacle(mover, start, end, prism))) {
      return { ok: false, code: "blockedPath" };
    }
    const scaledStart = pathPointAtScale(start, 2n);
    const scaledEnd = pathPointAtScale(end, 2n);
    for (const zone of passageZones) {
      const intervals = openPrismParameterIntervals(scaledStart, scaledEnd, zone.prism);
      if (intervals.length === 0) continue;
      if (moverSizeRank > zone.capacitySizeRank + 1) {
        return { ok: false, code: "blockedPath" };
      }
      if (moverSizeRank === zone.capacitySizeRank + 1) {
        squeezeBySegment[index - 1].push(...intervals);
      }
    }
    for (const other of others) {
      const interval = openBoxParameterInterval(
        scaledStart,
        scaledEnd,
        traversedEntitySpaceBox(other, mover),
      );
      if (interval === undefined) continue;
      const otherId = String(other.id ?? other.entityId);
      if (hostileEntityIds.has(otherId)
        && Math.abs(entitySizeRank(mover) - entitySizeRank(other)) < 2) {
        return { ok: false, code: "blockedPath" };
      }
      difficultBySegment[index - 1].push(interval);
      traversed.add(otherId);
    }
  }

  const base = BigInt(pathLengthMilliInches(path));
  let difficult = 0n;
  let squeeze = 0n;
  for (let index = 0; index < difficultBySegment.length; index += 1) {
    for (const interval of mergedIntervals(difficultBySegment[index])) {
      difficult += intervalLengthMilliInches(path[index], path[index + 1], interval);
    }
    for (const interval of mergedIntervals(squeezeBySegment[index])) {
      squeeze += intervalLengthMilliInches(path[index], path[index + 1], interval);
    }
  }
  const endpointPoint = pathPointAtScale(path[path.length - 1], 2n);
  const squeezingAtEndpoint = passageZones.some((zone) =>
    moverSizeRank === zone.capacitySizeRank + 1
      && pointStrictlyInsidePrism(endpointPoint, zone.prism));
  return {
    ok: true,
    path,
    baseMilliInches: base.toString(),
    difficultMilliInches: difficult.toString(),
    squeezeMilliInches: squeeze.toString(),
    totalMilliInches: (base + difficult + squeeze).toString(),
    traversedCreatureIds: [...traversed].sort(),
    squeezingAtEndpoint,
  };
}
