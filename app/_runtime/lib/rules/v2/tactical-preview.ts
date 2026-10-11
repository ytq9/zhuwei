import {
  canonicalCombatDirection,
  canonicalCombatPoint,
  entitiesAffectedByArea,
  entitiesWithinRange,
  entityOccupiesSpace,
  entityWithinPointRange,
  freezeAreaOrigin,
  type FrozenCombatPoint,
} from "../profiles/combat-geometry";
import { RulesValidationError } from "../errors";
import type { JsonRecord } from "./model";
import type {
  TacticalAreaPreviewQuery,
  TacticalEntity,
  TacticalPosition,
  TacticalPreview,
  TacticalProjection,
} from "../tactical-projection";

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inchesValue(value: unknown): string | undefined {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,6})$/.test(value) ? value : undefined;
}

/** SPEC 0014 §7 (ADR 0148): the creatures the viewer sees within an
 * ability's reach or normal range, and those only within its long range
 * (attacked at disadvantage), measured as the attack measures them. Only
 * creatures the viewer sees are candidates, so one it does not see changes
 * nothing here. Undefined when the ability names no reach or range. */
export function creatureTargetsInRange(
  source: JsonRecord,
  seen: ReadonlyArray<readonly [string, JsonRecord]>,
  target: unknown,
): { withinRefs: string[]; longRangeRefs: string[] } | undefined {
  if (!isRecord(target) || (target.kind !== "creature" && target.kind !== "creatureOrEnvironmentFeature")
    || target.selfOnly === true || !entityOccupiesSpace(source)) return undefined;
  const normal = inchesValue(target.rangeNormalInches ?? target.rangeInches ?? target.reachInches);
  const long = inchesValue(target.rangeLongInches);
  if (normal === undefined && long === undefined) return undefined;
  const candidates = seen
    .filter(([, entity]) => entity.sceneId === source.sceneId && entity.lifeState !== "dead" && entityOccupiesSpace(entity))
    .sort(([left], [right]) => left.localeCompare(right));
  const withinRefs = normal === undefined ? []
    : candidates.filter(([, entity]) => entitiesWithinRange(source, entity, normal)).map(([id]) => id);
  const longRangeRefs = long === undefined ? []
    : candidates.filter(([id, entity]) => !withinRefs.includes(id) && entitiesWithinRange(source, entity, long)).map(([id]) => id);
  return { withinRefs, longRangeRefs };
}

/** A tactical entity as the geometry profile measures it. */
function measured(entity: TacticalEntity): JsonRecord {
  return {
    id: entity.id,
    position: structuredClone(entity.position),
    footprint: structuredClone(entity.footprint),
    ...(entity.publicStates.includes("life:dead") ? { lifeState: "dead" } : {}),
  };
}

function wholeInches(value: FrozenCombatPoint["x"]): string {
  if (typeof value === "string") return value;
  return String(Math.round(Number(value.numerator) / Number(value.denominator)));
}

function samePoint(left: FrozenCombatPoint, right: TacticalPosition): boolean {
  return left.x === right.x && left.y === right.y && left.elevation === right.elevation;
}

/** SPEC 0014 §7 (ADR 0148): what an area would reach, computed only from
 * what the viewer knows -- the creatures on its map and the features it
 * knows. The origin stops at the first known wall in the way, as the cast
 * would. A creature or wall the viewer does not know takes no part, so two
 * worlds that differ only in those give the same answer; the cast itself
 * settles against the whole world (SPEC 0014 §5). Undefined when the query
 * does not fit the ability: no area, a missing or extra direction. */
export function tacticalAreaPreview(
  tactical: TacticalProjection,
  definitionTarget: unknown,
  query: TacticalAreaPreviewQuery,
): TacticalPreview | undefined {
  if (!isRecord(definitionTarget) || definitionTarget.kind !== "area" || !isRecord(definitionTarget.shape)) return undefined;
  const shape = definitionTarget.shape;
  const directional = ["cube", "cone", "line"].includes(String(shape.kind));
  const direction = directional ? canonicalCombatDirection(query.direction) : undefined;
  if (directional !== (direction !== undefined) || (!directional && query.direction !== undefined)) return undefined;
  const origin = canonicalCombatPoint(query.origin)!;
  const self = measured(tactical.self);
  const base = {
    kind: "area" as const,
    abilityRef: query.abilityRef,
    origin,
    ...(direction === undefined ? {} : { direction }),
    knownCover: [],
    spatialRevision: tactical.spatialRevision,
  };
  const range = inchesValue(definitionTarget.rangeInches);
  const inRange = range === undefined
    ? origin.x === tactical.self.position.x && origin.y === tactical.self.position.y
      && origin.elevation === tactical.self.position.elevation
    : entityWithinPointRange(self, origin, range);
  if (!inRange) {
    return { ...base, knownAffectedEntityIds: [], knownSelfEffects: [], knownFriendlyEntityIds: [],
      knownBlockerFeatureIds: [], stop: null, readout: ["这一处超出射程。"] };
  }
  const known = tactical.knownFeatures.filter((feature) => feature.opaque);
  const scene = (features: typeof known) => ({ geometry: { obstacles: features } });
  const frozen = freezeAreaOrigin(scene(known), self, origin);
  if (frozen === undefined) return undefined;
  const blocked = !samePoint(frozen, origin);
  const blocker = blocked
    ? known.find((feature) => {
        const alone = freezeAreaOrigin(scene([feature]), self, origin);
        return alone !== undefined && JSON.stringify(alone) === JSON.stringify(frozen);
      })
    : undefined;
  const entities = [tactical.self, ...tactical.visibleEntities];
  let affected: string[];
  try {
    affected = entitiesAffectedByArea(
      entities.map(measured).filter(entityOccupiesSpace),
      scene(known),
      frozen,
      shape,
      direction,
    );
  } catch (error) {
    if (error instanceof RulesValidationError) return undefined;
    throw error;
  }
  const knownAffectedEntityIds = [...affected].sort((left, right) => left.localeCompare(right));
  const nameOf = (id: string) => entities.find((entity) => entity.id === id)?.name ?? id;
  const others = knownAffectedEntityIds.filter((id) => id !== tactical.self.id);
  const friendly = knownAffectedEntityIds.filter((id) =>
    entities.find((entity) => entity.id === id)?.relation === "ally");
  const readout = [
    others.length === 0 ? "范围内没有你看得见的人。" : `范围内你看得见的：${others.map(nameOf).join("、")}。`,
    ...(friendly.length === 0 ? [] : [`其中是同伴的：${friendly.map(nameOf).join("、")}。`]),
    ...(knownAffectedEntityIds.includes(tactical.self.id) ? ["你自己也在范围内。"] : []),
    ...(blocker === undefined ? [] : [`${blocker.label}挡在前面，范围从墙前展开。`]),
  ];
  return {
    ...base,
    knownAffectedEntityIds,
    knownSelfEffects: knownAffectedEntityIds.includes(tactical.self.id) ? ["inArea"] : [],
    knownFriendlyEntityIds: friendly,
    knownBlockerFeatureIds: blocker === undefined ? [] : [blocker.id],
    stop: blocked
      ? { kind: "knownBlocked", point: { x: wholeInches(frozen.x), y: wholeInches(frozen.y), elevation: wholeInches(frozen.elevation) },
          featureId: blocker?.id ?? null }
      : null,
    readout,
  };
}
