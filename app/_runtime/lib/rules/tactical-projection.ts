export type TacticalPoint2d = {
  x: string;
  y: string;
};

export type TacticalPosition = TacticalPoint2d & {
  elevation: string;
};

export type TacticalFootprint = {
  width: string;
  depth: string;
  height: string;
};

export type TacticalEntity = {
  id: string;
  name: string;
  kind: "player" | "npc";
  position: TacticalPosition;
  footprint: TacticalFootprint;
  relation: "self" | "ally" | "enemy" | "neutral";
  publicStates: string[];
};

/** SPEC 0014 §4 (ADR 0098): what a feature is as ground. A ditch or water
 * goes `depth` inches down from its `elevation`, the rim; a step, low wall or
 * cliff rises its `height` above its `elevation`. */
export const TACTICAL_LANDFORMS = ["cliff", "ditch", "lowWall", "step", "water"] as const;
export type TacticalLandform = typeof TACTICAL_LANDFORMS[number];
/** The landforms that open below their rim; they carry a `depth`. */
export const TACTICAL_HOLLOW_LANDFORMS: readonly TacticalLandform[] = ["ditch", "water"];
/** SPEC 0014 §4 (ADR 0098): what a feature is made of, from which the KP sets
 * how hard it is to climb. */
export const TACTICAL_MATERIALS = ["brick", "earth", "metal", "mud", "rope", "stone", "wood"] as const;
export type TacticalMaterial = typeof TACTICAL_MATERIALS[number];
/** SPEC 0014 §4 (ADR 0098): still water, or rough water that takes an
 * Athletics check to swim. */
export const TACTICAL_WATER_CURRENTS = ["rough", "still"] as const;
export type TacticalWaterCurrent = typeof TACTICAL_WATER_CURRENTS[number];

/** SPEC 0014 §4 (ADR 0098): the terrain fields a map feature may carry. A
 * ditch or water has a depth, water a current; any feature may name its
 * material. Each is absent when the map does not say. */
export type TacticalTerrainFields = {
  landform?: TacticalLandform;
  depth?: string;
  current?: TacticalWaterCurrent;
  material?: TacticalMaterial;
};

const LANDFORM_LABEL: Readonly<Record<TacticalLandform, string>> = {
  cliff: "崖壁", ditch: "沟", lowWall: "矮墙", step: "台阶", water: "水域",
};
const MATERIAL_LABEL: Readonly<Record<TacticalMaterial, string>> = {
  brick: "砖砌", earth: "土质", metal: "金属", mud: "泥质", rope: "绳索", stone: "石质", wood: "木质",
};
const CURRENT_LABEL: Readonly<Record<TacticalWaterCurrent, string>> = { rough: "急流", still: "静水" };

/** The terrain a feature's readout and map card name, in that order:
 * landform, depth, current, material. Empty when the map says none. */
export function tacticalTerrainPhrases(feature: TacticalTerrainFields): string[] {
  return [
    ...(feature.landform === undefined ? [] : [LANDFORM_LABEL[feature.landform]]),
    ...(feature.depth === undefined ? [] : [`深 ${feature.depth} 英寸`]),
    ...(feature.current === undefined ? [] : [CURRENT_LABEL[feature.current]]),
    ...(feature.material === undefined ? [] : [MATERIAL_LABEL[feature.material]]),
  ];
}

/** SPEC 0014 §8 (ADR 0103 decision 4): the place a door or opening on the
 * viewer's own map leads to, and whether its doors can be passed now. */
export type TacticalFeatureDestination = {
  sceneId: string;
  name: string;
  passable: boolean;
};

export type TacticalKnownFeature = {
  id: string;
  kind: "barrier" | "terrain" | "interactable" | "destructible" | "portal";
  label: string;
  state: string;
  polygon: TacticalPoint2d[];
  elevation: string;
  height: string;
  opaque: boolean;
  impassable: boolean;
  cover: "none" | "half" | "threeQuarters" | "full";
  propagation: "passes" | "blocks";
  terrain: "normal" | "rubble";
  durability?: {
    current: string;
    maximum: string;
  };
  leadsTo?: TacticalFeatureDestination;
} & TacticalTerrainFields;

/** SPEC 0014 §8 (ADR 0103 decision 5): where a place's map origin lies on
 * the module's site plan, in inches; `level` 0 is the ground floor, -1 below
 * it and 1 above. */
export type TacticalPlacePlacement = {
  x: string;
  y: string;
  level: number;
};

/** A feature of a known place the viewer is not in: where it is and what it
 * is, without its live state. */
export type TacticalPlaceFeature = {
  id: string;
  kind: TacticalKnownFeature["kind"];
  label: string;
  polygon: TacticalPoint2d[];
  elevation: string;
  height: string;
} & TacticalTerrainFields;

/** SPEC 0014 §8 (ADR 0103 decision 5): a place the viewer has been to or is
 * in, for a stitched map. The current place carries no features here; its
 * features are `knownFeatures`, with their state. */
export type TacticalKnownPlace = {
  sceneId: string;
  name: string;
  placement: TacticalPlacePlacement;
  boundary: {
    kind: "polygon";
    points: TacticalPoint2d[];
  };
  features: TacticalPlaceFeature[];
};

/** A site-plan level in words: the ground floor, a floor above or below. */
export function tacticalLevelLabel(level: number): string {
  if (level === 0) return "地面层";
  return level > 0 ? `楼上 ${level} 层` : `地下 ${-level} 层`;
}

export type TacticalEncounterSummary = {
  id: string;
  status: "starting" | "concluded";
  round: number;
  activeEntityId: string | null;
  participantEntityIds: string[];
};

export type TacticalZone = {
  id: string;
  label: string;
  sourceRef: string;
  state: string;
  geometry: {
    kind: "polygon";
    points: TacticalPoint2d[];
    elevation: string;
    height: string;
  };
  effectTags: string[];
  startsAtMicros: string;
  expiresAtMicros: string | null;
};

export type TacticalPreviewStop = {
  kind: "complete" | "knownBlocked";
  point: TacticalPosition;
  featureId: string | null;
};

export type TacticalPreviewCover = {
  subjectId: string;
  level: "none" | "half" | "threeQuarters" | "full";
};

type TacticalPreviewKnownConsequences = {
  knownSelfEffects: string[];
  knownFriendlyEntityIds: string[];
  knownBlockerFeatureIds: string[];
  knownCover: TacticalPreviewCover[];
  stop: TacticalPreviewStop | null;
  readout: string[];
  spatialRevision: string;
};

export type TacticalPreview =
  | (TacticalPreviewKnownConsequences & {
      kind: "movement";
      path: TacticalPosition[];
    })
  /** SPEC 0014 §7 (ADR 0148): an area from the picked origin, and the way
   * it points for a cube, cone or line. `knownAffectedEntityIds` are the
   * creatures on the viewer's map the area would reach, computed only from
   * what the viewer knows; the cast settles against the whole world. */
  | (TacticalPreviewKnownConsequences & {
      kind: "area";
      abilityRef: string;
      origin: TacticalPosition;
      direction?: TacticalPosition;
      knownAffectedEntityIds: string[];
    });

export type TacticalProjection = {
  schema: "zhuwei.tactical-projection/v1";
  scene: {
    id: string;
    name: string;
    boundary: {
      kind: "polygon";
      points: TacticalPoint2d[];
    };
    gridInches: 60;
  };
  self: TacticalEntity;
  visibleEntities: TacticalEntity[];
  knownFeatures: TacticalKnownFeature[];
  knownZones: TacticalZone[];
  /** SPEC 0014 §8 (ADR 0103 decision 5): absent when the room has no place
   * map or no site-plan placement for the current place. */
  knownPlaces?: TacticalKnownPlace[];
  encounter: TacticalEncounterSummary | null;
  preview: TacticalPreview | null;
  textualReadout: {
    sceneId: string;
    summary: string;
    entities: string[];
    features: string[];
    /** One line per known place, in the order of `knownPlaces`. */
    places?: string[];
  };
  spatialRevision: string;
};

type UnknownRecord = Record<string, unknown>;

const INTEGER_PATTERN = /^(0|-?[1-9][0-9]*)$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const INT32_MIN = -2_147_483_648n;
const INT32_MAX = 2_147_483_647n;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function canonicalInteger(value: unknown): value is string {
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= INT32_MIN && parsed <= INT32_MAX;
}

function canonicalUnsignedInteger(value: unknown): value is string {
  return typeof value === "string"
    && UNSIGNED_INTEGER_PATTERN.test(value)
    && BigInt(value) <= INT32_MAX;
}

function sha256Ref(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function tacticalPoint(value: unknown): value is TacticalPoint2d {
  return isRecord(value)
    && exactKeys(value, ["x", "y"])
    && canonicalInteger(value.x)
    && canonicalInteger(value.y);
}

export function isTacticalPosition(value: unknown): value is TacticalPosition {
  return isRecord(value)
    && exactKeys(value, ["elevation", "x", "y"])
    && canonicalInteger(value.x)
    && canonicalInteger(value.y)
    && canonicalInteger(value.elevation);
}

export function isTacticalSpatialRevision(value: unknown): value is `sha256:${string}` {
  return sha256Ref(value);
}

/** SPEC 0014 §4 (ADR 0091): where a player's map move outside an encounter
 * goes: a point on the scene map, or beside someone or something on it. */
export type MapMoveDestination = Readonly<{ kind: "point"; x: string; y: string } | { kind: "nextTo"; ref: string }>;

/** SPEC 0014 §§3、5 (ADR 0091): what a player picks on the map for an ability
 * used on its own turn: no target, creatures it chose, or an area's origin and
 * direction. Rules decides who an area actually affects. SPEC 0012 §6.3 (ADR
 * 0097 decision 4): an attack may name a `point` where the player guesses an
 * unseen creature stands. */
export type CombatAbilityTarget = Readonly<
  | { kind: "none" }
  | { kind: "creatures"; refs: readonly string[] }
  | { kind: "area"; origin: TacticalPosition; direction?: TacticalPosition }
  | { kind: "point"; position: TacticalPosition }
  /** SPEC 0012 §6.3 (ADR 0099 decision 1): Help's ally, and for an attack
   * the enemy within 5 feet. */
  | { kind: "help"; allyRef: string; enemyRef?: string }
  /** SPEC 0012 §8.1 (ADR 0099 decision 3): Ready's trigger and response. */
  | { kind: "ready"; trigger: CombatReadyTrigger; response: CombatReadyResponse }
>;

export type CombatReadyTrigger = Readonly<{ ref: string; event: "turnStarted" | "movementCommitted" | "spellCastingStarted" }>;
export type CombatReadyResponse = Readonly<
  | { kind: "move"; path: readonly TacticalPosition[] }
  | { kind: "ability"; abilityRef: string; target: CombatAbilityTarget }
>;

function combatRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300 && /^\S+$/u.test(value);
}

export function isCombatAbilityTarget(value: unknown, depth = 0): value is CombatAbilityTarget {
  if (!isRecord(value)) return false;
  if (value.kind === "none") return exactKeys(value, ["kind"]);
  if (value.kind === "creatures") return exactKeys(value, ["kind", "refs"]) && Array.isArray(value.refs)
    && value.refs.length >= 1 && value.refs.length <= 16 && new Set(value.refs).size === value.refs.length
    && value.refs.every(combatRef);
  if (value.kind === "point") return exactKeys(value, ["kind", "position"]) && isTacticalPosition(value.position);
  if (value.kind === "help") return combatRef(value.allyRef)
    && (exactKeys(value, ["allyRef", "kind"]) || (exactKeys(value, ["allyRef", "enemyRef", "kind"]) && combatRef(value.enemyRef)));
  if (value.kind === "ready") {
    // A readied response is one ordinary pick; it never nests another Ready.
    const trigger = value.trigger, response = value.response;
    return depth === 0 && exactKeys(value, ["kind", "response", "trigger"])
      && isRecord(trigger) && exactKeys(trigger, ["event", "ref"]) && combatRef(trigger.ref)
      && ["turnStarted", "movementCommitted", "spellCastingStarted"].includes(String(trigger.event))
      && isRecord(response)
      && ((response.kind === "move" && exactKeys(response, ["kind", "path"]) && Array.isArray(response.path)
          && response.path.length >= 2 && response.path.length <= 64 && response.path.every(isTacticalPosition))
        || (response.kind === "ability" && exactKeys(response, ["abilityRef", "kind", "target"]) && combatRef(response.abilityRef)
          && isCombatAbilityTarget(response.target, depth + 1)
          && isRecord(response.target) && response.target.kind !== "help"));
  }
  return value.kind === "area" && isTacticalPosition(value.origin)
    && (exactKeys(value, ["kind", "origin"]) || (exactKeys(value, ["direction", "kind", "origin"]) && isTacticalPosition(value.direction)));
}

/** SPEC 0014 §7 (ADR 0148): what the map's area pick asks Rules to preview:
 * the ability, its origin and, for a cube, cone or line, the way it points. */
export type TacticalAreaPreviewQuery = {
  abilityRef: string;
  origin: TacticalPosition;
  direction?: TacticalPosition;
};

export function isTacticalAreaPreviewQuery(value: unknown): value is TacticalAreaPreviewQuery {
  return isRecord(value) && combatRef(value.abilityRef) && isTacticalPosition(value.origin)
    && (exactKeys(value, ["abilityRef", "origin"])
      || (exactKeys(value, ["abilityRef", "direction", "origin"]) && isTacticalPosition(value.direction)
        && [value.direction.x, value.direction.y, value.direction.elevation].some((part) => part !== "0")));
}

export function isMapMoveDestination(value: unknown): value is MapMoveDestination {
  if (!isRecord(value)) return false;
  if (value.kind === "point") return exactKeys(value, ["kind", "x", "y"]) && canonicalInteger(value.x) && canonicalInteger(value.y);
  return value.kind === "nextTo" && exactKeys(value, ["kind", "ref"]) && typeof value.ref === "string"
    && value.ref.length > 0 && value.ref.length <= 300 && /^\S+$/u.test(value.ref);
}

function tacticalFootprint(value: unknown): value is TacticalFootprint {
  return isRecord(value)
    && exactKeys(value, ["depth", "height", "width"])
    && [value.width, value.depth, value.height].every((entry) =>
      canonicalInteger(entry) && BigInt(entry) > 0n);
}

function uniqueStrings(value: unknown, maximum = 100): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every(nonEmptyString)
    && value.length === new Set(value).size;
}

function sortedUniqueStrings(value: unknown, maximum = 100): value is string[] {
  return uniqueStrings(value, maximum)
    && value.every((entry, index) => index === 0 || value[index - 1].localeCompare(entry) < 0);
}

function tacticalEntity(value: unknown): value is TacticalEntity {
  return isRecord(value)
    && exactKeys(value, [
      "footprint",
      "id",
      "kind",
      "name",
      "position",
      "publicStates",
      "relation",
    ])
    && nonEmptyString(value.id)
    && nonEmptyString(value.name)
    && (value.kind === "player" || value.kind === "npc")
    && isTacticalPosition(value.position)
    && tacticalFootprint(value.footprint)
    && ["self", "ally", "enemy", "neutral"].includes(String(value.relation))
    && sortedUniqueStrings(value.publicStates, 64);
}

export const TERRAIN_FIELD_KEYS = ["current", "depth", "landform", "material"] as const;

/** SPEC 0014 §4 (ADR 0098): the terrain fields of a canonical feature or of
 * its projection, each optional: a depth exactly on a ditch or water, a
 * current exactly on water. */
export function tacticalTerrainFieldsValid(value: Readonly<Record<string, unknown>>): boolean {
  const hollow = TACTICAL_HOLLOW_LANDFORMS.some(landform => landform === value.landform);
  return (value.landform === undefined || TACTICAL_LANDFORMS.some(landform => landform === value.landform))
    && (value.material === undefined || TACTICAL_MATERIALS.some(material => material === value.material))
    && (hollow ? canonicalUnsignedInteger(value.depth) && BigInt(value.depth) > 0n : value.depth === undefined)
    && (value.landform === "water"
      ? TACTICAL_WATER_CURRENTS.some(current => current === value.current)
      : value.current === undefined);
}

function tacticalFeatureDestination(value: unknown): value is TacticalFeatureDestination {
  return isRecord(value)
    && exactKeys(value, ["name", "passable", "sceneId"])
    && nonEmptyString(value.sceneId)
    && nonEmptyString(value.name)
    && typeof value.passable === "boolean";
}

/** SPEC 0014 §8 (ADR 0103 decision 5): a site-plan placement, also the
 * shape the projector accepts from a room's place map. */
export function isTacticalPlacePlacement(value: unknown): value is TacticalPlacePlacement {
  return isRecord(value)
    && exactKeys(value, ["level", "x", "y"])
    && canonicalInteger(value.x)
    && canonicalInteger(value.y)
    && Number.isSafeInteger(value.level)
    && Math.abs(Number(value.level)) <= 100;
}

function tacticalBoundary(value: unknown): value is TacticalKnownPlace["boundary"] {
  return isRecord(value)
    && exactKeys(value, ["kind", "points"])
    && value.kind === "polygon"
    && Array.isArray(value.points)
    && value.points.length >= 3
    && value.points.length <= 64
    && value.points.every(tacticalPoint);
}

function tacticalPlaceFeature(value: unknown): value is TacticalPlaceFeature {
  if (!isRecord(value)) return false;
  const keys = ["elevation", "height", "id", "kind", "label", "polygon"];
  return keys.every(key => key in value)
    && Object.keys(value).every(key => keys.includes(key) || (TERRAIN_FIELD_KEYS as readonly string[]).includes(key))
    && tacticalTerrainFieldsValid(value)
    && nonEmptyString(value.id)
    && ["barrier", "terrain", "interactable", "destructible", "portal"].includes(String(value.kind))
    && nonEmptyString(value.label)
    && Array.isArray(value.polygon)
    && value.polygon.length >= 3
    && value.polygon.every(tacticalPoint)
    && canonicalInteger(value.elevation)
    && canonicalInteger(value.height)
    && BigInt(value.height) > 0n;
}

function tacticalKnownPlace(value: unknown): value is TacticalKnownPlace {
  return isRecord(value)
    && exactKeys(value, ["boundary", "features", "name", "placement", "sceneId"])
    && nonEmptyString(value.sceneId)
    && nonEmptyString(value.name)
    && isTacticalPlacePlacement(value.placement)
    && tacticalBoundary(value.boundary)
    && Array.isArray(value.features)
    && value.features.length <= 200
    && value.features.every(tacticalPlaceFeature)
    && value.features.every((feature, index) => index === 0
      || (value.features as TacticalPlaceFeature[])[index - 1].id.localeCompare(feature.id) < 0);
}

/** The known places of a projection: sorted by scene, the current place
 * once with its own name and no features, and one readout line each. */
function tacticalKnownPlaces(
  places: unknown,
  readout: unknown,
  scene: { id: string; name: string },
): boolean {
  if (places === undefined) return readout === undefined;
  return Array.isArray(places)
    && places.length >= 1
    && places.length <= 64
    && places.every(tacticalKnownPlace)
    && places.every((place, index) => index === 0
      || (places as TacticalKnownPlace[])[index - 1].sceneId.localeCompare(place.sceneId) < 0)
    && places.filter((place) => place.sceneId === scene.id
      && place.name === scene.name
      && place.features.length === 0).length === 1
    && Array.isArray(readout)
    && readout.length === places.length
    && readout.every(nonEmptyString);
}

function tacticalKnownFeature(value: unknown): value is TacticalKnownFeature {
  if (!isRecord(value)) return false;
  const keys = [
      "cover",
      "elevation",
      "height",
      "id",
      "impassable",
      "kind",
      "label",
      "opaque",
      "polygon",
      "propagation",
      "state",
      "terrain",
    ];
  const optionalKeys: readonly string[] = ["durability", "leadsTo", ...TERRAIN_FIELD_KEYS];
  if (!keys.every(key => key in value)
    || Object.keys(value).some(key => !keys.includes(key) && !optionalKeys.includes(key))
    || !tacticalTerrainFieldsValid(value)) return false;
  return (value.leadsTo === undefined || tacticalFeatureDestination(value.leadsTo))
    && (value.durability === undefined || (isRecord(value.durability)
      && exactKeys(value.durability, ["current", "maximum"])
      && canonicalUnsignedInteger(value.durability.current)
      && canonicalUnsignedInteger(value.durability.maximum)
      && BigInt(value.durability.current) <= BigInt(value.durability.maximum)))
    && nonEmptyString(value.id)
    && ["barrier", "terrain", "interactable", "destructible", "portal"]
      .includes(String(value.kind))
    && nonEmptyString(value.label)
    && nonEmptyString(value.state)
    && Array.isArray(value.polygon)
    && value.polygon.length >= 3
    && value.polygon.every(tacticalPoint)
    && canonicalInteger(value.elevation)
    && canonicalInteger(value.height)
    && BigInt(value.height) > 0n
    && typeof value.opaque === "boolean"
    && typeof value.impassable === "boolean"
    && ["none", "half", "threeQuarters", "full"].includes(String(value.cover))
    && (value.propagation === "passes" || value.propagation === "blocks")
    && (value.terrain === "normal" || value.terrain === "rubble");
}

function tacticalEncounter(value: unknown): value is TacticalEncounterSummary {
  return isRecord(value)
    && exactKeys(value, [
      "activeEntityId",
      "id",
      "participantEntityIds",
      "round",
      "status",
    ])
    && nonEmptyString(value.id)
    && (value.status === "starting" || value.status === "concluded")
    && Number.isSafeInteger(value.round)
    && Number(value.round) >= 0
    && (value.activeEntityId === null || nonEmptyString(value.activeEntityId))
    && sortedUniqueStrings(value.participantEntityIds, 100)
    && (value.activeEntityId === null || value.participantEntityIds.includes(value.activeEntityId));
}

function tacticalZone(value: unknown): value is TacticalZone {
  return isRecord(value)
    && exactKeys(value, [
      "effectTags",
      "expiresAtMicros",
      "geometry",
      "id",
      "label",
      "sourceRef",
      "startsAtMicros",
      "state",
    ])
    && nonEmptyString(value.id)
    && nonEmptyString(value.label)
    && nonEmptyString(value.sourceRef)
    && nonEmptyString(value.state)
    && isRecord(value.geometry)
    && exactKeys(value.geometry, ["elevation", "height", "kind", "points"])
    && value.geometry.kind === "polygon"
    && Array.isArray(value.geometry.points)
    && value.geometry.points.length >= 3
    && value.geometry.points.length <= 64
    && value.geometry.points.every(tacticalPoint)
    && canonicalInteger(value.geometry.elevation)
    && canonicalInteger(value.geometry.height)
    && BigInt(value.geometry.height) > 0n
    && sortedUniqueStrings(value.effectTags, 64)
    && typeof value.startsAtMicros === "string"
    && UNSIGNED_INTEGER_PATTERN.test(value.startsAtMicros)
    && (value.expiresAtMicros === null
      || (typeof value.expiresAtMicros === "string"
        && UNSIGNED_INTEGER_PATTERN.test(value.expiresAtMicros)
        && BigInt(value.expiresAtMicros) >= BigInt(value.startsAtMicros)));
}

function tacticalPreviewCover(value: unknown): value is TacticalPreviewCover {
  return isRecord(value)
    && exactKeys(value, ["level", "subjectId"])
    && nonEmptyString(value.subjectId)
    && ["none", "half", "threeQuarters", "full"].includes(String(value.level));
}

function tacticalPreviewStop(value: unknown): value is TacticalPreviewStop {
  return isRecord(value)
    && exactKeys(value, ["featureId", "kind", "point"])
    && (value.kind === "complete" || value.kind === "knownBlocked")
    && isTacticalPosition(value.point)
    && (value.featureId === null || nonEmptyString(value.featureId));
}

function tacticalPreview(value: unknown): value is TacticalPreview {
  if (!isRecord(value)
    || !sha256Ref(value.spatialRevision)
    || !sortedUniqueStrings(value.knownSelfEffects, 64)
    || !sortedUniqueStrings(value.knownFriendlyEntityIds, 100)
    || !sortedUniqueStrings(value.knownBlockerFeatureIds, 100)
    || !Array.isArray(value.knownCover)
    || value.knownCover.length > 100
    || !value.knownCover.every(tacticalPreviewCover)
    || !value.knownCover.every((entry, index) => index === 0
      || String((value.knownCover as TacticalPreviewCover[])[index - 1].subjectId)
        .localeCompare(String(entry.subjectId)) < 0)
    || !(value.stop === null || tacticalPreviewStop(value.stop))
    || !uniqueStrings(value.readout, 100)) return false;
  const commonKeys = [
    "kind",
    "knownBlockerFeatureIds",
    "knownCover",
    "knownFriendlyEntityIds",
    "knownSelfEffects",
    "readout",
    "spatialRevision",
    "stop",
  ];
  if (value.kind === "movement") {
    return exactKeys(value, [...commonKeys, "path"])
      && Array.isArray(value.path)
      && value.path.length >= 1
      && value.path.length <= 256
      && value.path.every(isTacticalPosition);
  }
  return value.kind === "area"
    && exactKeys(value, [...commonKeys, "abilityRef", ...(value.direction === undefined ? [] : ["direction"]),
      "knownAffectedEntityIds", "origin"])
    && nonEmptyString(value.abilityRef)
    && isTacticalPosition(value.origin)
    && (value.direction === undefined || isTacticalPosition(value.direction))
    && sortedUniqueStrings(value.knownAffectedEntityIds, 100);
}

/** SPEC 0014 §7 (ADR 0148): a preview answered on its own, outside a projection. */
export function isTacticalPreview(value: unknown): value is TacticalPreview {
  return tacticalPreview(value);
}

export function isTacticalProjection(value: unknown): value is TacticalProjection {
  if (!isRecord(value) || !exactKeys(value, [
    "encounter",
    "knownFeatures",
    ...(value.knownPlaces === undefined ? [] : ["knownPlaces"]),
    "knownZones",
    "preview",
    "scene",
    "schema",
    "self",
    "spatialRevision",
    "textualReadout",
    "visibleEntities",
  ])) return false;
  if (value.schema !== "zhuwei.tactical-projection/v1"
    || !isRecord(value.scene)
    || !exactKeys(value.scene, ["boundary", "gridInches", "id", "name"])
    || !nonEmptyString(value.scene.id)
    || !nonEmptyString(value.scene.name)
    || value.scene.gridInches !== 60
    || !isRecord(value.scene.boundary)
    || !exactKeys(value.scene.boundary, ["kind", "points"])
    || value.scene.boundary.kind !== "polygon"
    || !Array.isArray(value.scene.boundary.points)
    || value.scene.boundary.points.length < 3
    || value.scene.boundary.points.length > 64
    || !value.scene.boundary.points.every(tacticalPoint)
    || !tacticalEntity(value.self)
    || value.self.relation !== "self"
    || !Array.isArray(value.visibleEntities)
    || value.visibleEntities.length > 100
    || !value.visibleEntities.every(tacticalEntity)
    || !value.visibleEntities.every((entity, index) => index === 0
      || (value.visibleEntities as TacticalEntity[])[index - 1].id.localeCompare(entity.id) < 0)
    || value.visibleEntities.some((entity) => entity.relation === "self")
    || !Array.isArray(value.knownFeatures)
    || value.knownFeatures.length > 200
    || !value.knownFeatures.every(tacticalKnownFeature)
    || !value.knownFeatures.every((feature, index) => index === 0
      || (value.knownFeatures as TacticalKnownFeature[])[index - 1].id.localeCompare(feature.id) < 0)
    || !Array.isArray(value.knownZones)
    || value.knownZones.length > 100
    || !value.knownZones.every(tacticalZone)
    || !value.knownZones.every((zone, index) => index === 0
      || (value.knownZones as TacticalZone[])[index - 1].id.localeCompare(zone.id) < 0)
    || !(value.encounter === null || tacticalEncounter(value.encounter))
    || !(value.preview === null || tacticalPreview(value.preview))
    || !isRecord(value.textualReadout)
    || !exactKeys(value.textualReadout, ["entities", "features", "sceneId", "summary",
      ...(value.textualReadout.places === undefined ? [] : ["places"])])
    || value.textualReadout.sceneId !== value.scene.id
    || !nonEmptyString(value.textualReadout.summary)
    || !uniqueStrings(value.textualReadout.entities, 100)
    || !uniqueStrings(value.textualReadout.features, 200)
    || !tacticalKnownPlaces(value.knownPlaces, value.textualReadout.places, value.scene as { id: string; name: string })
    // A door never leads into the place it stands in.
    || value.knownFeatures.some((feature) => feature.leadsTo?.sceneId === (value.scene as { id: string }).id)
    || !sha256Ref(value.spatialRevision)) return false;
  const entityIds = [value.self.id, ...value.visibleEntities.map((entity) => entity.id)];
  const featureIds = value.knownFeatures.map((feature) => feature.id);
  return entityIds.length === new Set(entityIds).size
    && featureIds.length === new Set(featureIds).size;
}
