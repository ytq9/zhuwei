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
};

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
  | (TacticalPreviewKnownConsequences & {
      kind: "area";
      origin: TacticalPosition;
      direction: TacticalPosition;
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
  encounter: TacticalEncounterSummary | null;
  preview: TacticalPreview | null;
  textualReadout: {
    sceneId: string;
    summary: string;
    entities: string[];
    features: string[];
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
  if (!(exactKeys(value, keys) || exactKeys(value, [...keys, "durability"]))) return false;
  return (value.durability === undefined || (isRecord(value.durability)
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
    && exactKeys(value, [...commonKeys, "direction", "origin"])
    && isTacticalPosition(value.origin)
    && isTacticalPosition(value.direction);
}

export function isTacticalProjection(value: unknown): value is TacticalProjection {
  if (!isRecord(value) || !exactKeys(value, [
    "encounter",
    "knownFeatures",
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
    || !exactKeys(value.textualReadout, ["entities", "features", "sceneId", "summary"])
    || value.textualReadout.sceneId !== value.scene.id
    || !nonEmptyString(value.textualReadout.summary)
    || !uniqueStrings(value.textualReadout.entities, 100)
    || !uniqueStrings(value.textualReadout.features, 200)
    || !sha256Ref(value.spatialRevision)) return false;
  const entityIds = [value.self.id, ...value.visibleEntities.map((entity) => entity.id)];
  const featureIds = value.knownFeatures.map((feature) => feature.id);
  return entityIds.length === new Set(entityIds).size
    && featureIds.length === new Set(featureIds).size;
}
