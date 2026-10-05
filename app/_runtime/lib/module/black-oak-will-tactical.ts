import type {
  CanonicalTacticalFeature,
  CanonicalTacticalGeometry,
  CanonicalTacticalFeatureStateGraph,
} from "../rules/profiles/tactical-geometry";
import type { TacticalMaterial, TacticalPoint2d, TacticalPosition } from "../rules/tactical-projection";
import { DOOR_DURABILITY, lockablePortalStateGraph, portalStateGraph } from "../rules/profiles/door-graph";

function rectangle(left: string, top: string, right: string, bottom: string): TacticalPoint2d[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function at(x: string, y: string, elevation = "0"): TacticalPosition {
  return { x, y, elevation };
}

function feature(
  featureId: string,
  kind: CanonicalTacticalFeature["kind"],
  label: string,
  state: string,
  polygon: TacticalPoint2d[],
  options: Pick<
    CanonicalTacticalFeature,
    "height" | "opaque" | "impassable" | "cover" | "propagation"
  > & Partial<Pick<
    CanonicalTacticalFeature,
    "durability" | "stateGraph" | "terrain" | "visibilityPolicyId" | "landform" | "depth" | "current" | "material"
  >>,
): CanonicalTacticalFeature {
  return {
    featureId,
    kind,
    label,
    state,
    polygon,
    elevation: "0",
    ...options,
    visibilityPolicyId: options.visibilityPolicyId ?? "visibility:public",
  };
}

function destructibleStateGraph(featureId: string): CanonicalTacticalFeatureStateGraph {
  return {
    definitionId: `environment-definition:${featureId}:durability-v1`,
    states: [
      {
        state: "damaged",
        opaque: true,
        impassable: true,
        cover: "half",
        propagation: "blocks",
        terrain: "normal",
      },
      {
        state: "destroyed",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
        terrain: "rubble",
      },
      {
        state: "intact",
        opaque: true,
        impassable: true,
        cover: "threeQuarters",
        propagation: "blocks",
        terrain: "normal",
      },
    ],
    transitions: [],
    durability: {
      maximum: "12",
      armorClass: "11",
      damageThreshold: "0",
      immuneDamageTypes: ["poison", "psychic"],
    },
    damageTransitions: [
      { fromState: "damaged", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      { fromState: "intact", remainingDurabilityAtOrBelow: "8", toState: "damaged" },
    ],
  };
}

function geometry(
  boundaryPoints: TacticalPoint2d[],
  spawnPoints: TacticalPosition[],
  obstacles: CanonicalTacticalFeature[],
): CanonicalTacticalGeometry {
  return {
    schema: "zhuwei.tactical-geometry/v1",
    unit: "inch",
    boundary: { kind: "polygon", points: boundaryPoints },
    spawnPoints,
    obstacles: [...obstacles].sort((left, right) => left.featureId.localeCompare(right.featureId)),
    clearanceZones: [],
  };
}

/**
 * Hand-authored, module-pinned tactical layouts for the Black Oak Will. They
 * describe story-anchor locations rather than a fallback room rectangle; a
 * missing scene is an authoring error and is never synthesized by Room.
 */
export const BLACK_OAK_TACTICAL_GEOMETRY_V1: Readonly<
  Record<string, CanonicalTacticalGeometry>
> = Object.freeze({
  wake: geometry(
    rectangle("-480", "-360", "480", "360"),
    [
      at("-300", "-240"), at("-180", "-240"), at("-60", "-240"), at("60", "-240"),
      at("180", "-240"), at("300", "-240"), at("-360", "240"), at("360", "240"),
    ],
    [
      feature(
        "feature:wake:joined-tables",
        "interactable",
        "拼起的长桌",
        "intact",
        rectangle("-240", "-30", "240", "30"),
        { height: "36", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
      feature(
        "feature:wake:wet-floor",
        "terrain",
        "带泥湿地",
        "wet",
        rectangle("-420", "120", "-120", "300"),
        { height: "1", opaque: false, impassable: false, cover: "none", propagation: "passes" },
      ),
      feature(
        "feature:wake:hearth",
        "barrier",
        "石砌炉台",
        "intact",
        rectangle("390", "-150", "450", "150"),
        { height: "60", opaque: true, impassable: true, cover: "full", propagation: "blocks" },
      ),
      feature(
        "feature:wake:hidden-side-wall-left",
        "barrier",
        "未显露的南侧塌陷",
        "hidden",
        rectangle("-330", "-360", "-270", "-300"),
        {
          height: "60",
          opaque: true,
          impassable: true,
          cover: "full",
          propagation: "blocks",
          visibilityPolicyId: "visibility:hidden-until-evidence",
        },
      ),
      feature(
        "feature:wake:hidden-side-wall-right",
        "barrier",
        "未显露的南侧塌陷",
        "hidden",
        rectangle("-210", "-360", "-150", "-300"),
        {
          height: "60",
          opaque: true,
          impassable: true,
          cover: "full",
          propagation: "blocks",
          visibilityPolicyId: "visibility:hidden-until-evidence",
        },
      ),
    ],
  ),
  wills: geometry(
    rectangle("-360", "-300", "360", "300"),
    [
      at("-240", "-180"), at("-120", "-180"), at("0", "-180"), at("120", "-180"),
      at("240", "-180"), at("-240", "180"), at("0", "180"), at("240", "180"),
    ],
    [
      feature(
        "feature:wills:ledger-counter",
        "interactable",
        "账台",
        "intact",
        rectangle("-300", "90", "60", "150"),
        { height: "42", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
      feature(
        "feature:wills:hearth",
        "barrier",
        "炉边石墙",
        "intact",
        rectangle("270", "-120", "330", "120"),
        { height: "60", opaque: true, impassable: true, cover: "full", propagation: "blocks" },
      ),
    ],
  ),
  yard: geometry(
    rectangle("-540", "-420", "540", "420"),
    [
      at("-120", "360"), at("-180", "-240"), at("-60", "-240"), at("60", "-240"),
      at("180", "-240"), at("300", "-240"), at("-300", "180"), at("300", "180"),
    ],
    [
      feature(
        "feature:yard:cellar-door",
        "portal",
        "腐朽且钉封的橡木门",
        "closed",
        rectangle("-90", "330", "90", "390"),
        {
          height: "96",
          opaque: true,
          impassable: true,
          cover: "full",
          propagation: "blocks",
          terrain: "normal",
          durability: {
            current: "4",
            maximum: "4",
            armorClass: "11",
            damageThreshold: "0",
            immuneDamageTypes: ["poison", "psychic"],
          },
          stateGraph: portalStateGraph("feature:yard:cellar-door"),
        },
      ),
      feature(
        "feature:yard:hidden-passage",
        "portal",
        "覆土暗门",
        "closed",
        rectangle("450", "120", "510", "300"),
        {
          height: "72",
          opaque: true,
          impassable: true,
          cover: "full",
          propagation: "blocks",
          terrain: "normal",
          durability: {
            current: "4",
            maximum: "4",
            armorClass: "11",
            damageThreshold: "0",
            immuneDamageTypes: ["poison", "psychic"],
          },
          stateGraph: portalStateGraph("feature:yard:hidden-passage"),
          visibilityPolicyId: "visibility:hidden-until-evidence",
        },
      ),
      feature(
        "feature:yard:mud",
        "terrain",
        "后院泥泞",
        "muddy",
        rectangle("-420", "-60", "180", "240"),
        { height: "1", opaque: false, impassable: false, cover: "none", propagation: "passes" },
      ),
      feature(
        "feature:yard:stone-steps",
        "interactable",
        "下行石阶",
        "intact",
        rectangle("180", "240", "420", "360"),
        { height: "18", opaque: false, impassable: false, cover: "none", propagation: "passes" },
      ),
    ],
  ),
  "private-lian": geometry(
    rectangle("-300", "-240", "300", "240"),
    [
      at("-180", "-120"), at("-60", "-120"), at("60", "-120"), at("180", "-120"),
      at("-240", "-180"), at("-60", "120"), at("60", "120"), at("180", "120"),
    ],
    [
      feature(
        "feature:private-lian:guest-bed",
        "interactable",
        "客床",
        "intact",
        rectangle("-270", "30", "-90", "210"),
        { height: "30", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
      feature(
        "feature:private-lian:wardrobe",
        "barrier",
        "木衣柜",
        "intact",
        rectangle("210", "60", "270", "210"),
        { height: "84", opaque: true, impassable: true, cover: "full", propagation: "blocks" },
      ),
    ],
  ),
  cellar: geometry(
    rectangle("-420", "-600", "420", "600"),
    [
      at("-240", "-420"), at("-120", "-420"), at("0", "-420"), at("120", "-420"),
      at("240", "-420"), at("-240", "360"), at("0", "360"), at("240", "360"),
    ],
    [
      feature(
        "feature:cellar:barrel-rack-west",
        "interactable",
        "西侧酒桶架",
        "intact",
        rectangle("-390", "-180", "-270", "300"),
        { height: "54", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
      feature(
        "feature:cellar:salt-frost",
        "terrain",
        "盐霜地面",
        "frozen",
        rectangle("-180", "30", "240", "390"),
        { height: "1", opaque: false, impassable: false, cover: "none", propagation: "passes" },
      ),
      feature(
        "feature:cellar:deep-stairs",
        "interactable",
        "通往深处的陡阶",
        "intact",
        rectangle("-120", "480", "120", "570"),
        { height: "24", opaque: false, impassable: false, cover: "none", propagation: "passes" },
      ),
    ],
  ),
  shrine: geometry(
    rectangle("-360", "-360", "360", "360"),
    [
      at("-150", "150"), at("150", "150"), at("0", "-240"), at("120", "-240"),
      at("240", "-240"), at("-240", "180"), at("-240", "-120"), at("240", "180"),
    ],
    [
      feature(
        "feature:shrine:stone-seat",
        "destructible",
        "遍布裂纹的神龛石座",
        "intact",
        rectangle("-120", "90", "120", "210"),
        {
          height: "60",
          opaque: true,
          impassable: true,
          cover: "threeQuarters",
          propagation: "blocks",
          terrain: "normal",
          durability: {
            current: "12",
            maximum: "12",
            armorClass: "11",
            damageThreshold: "0",
            immuneDamageTypes: ["poison", "psychic"],
          },
          stateGraph: destructibleStateGraph("feature:shrine:stone-seat"),
        },
      ),
      feature(
        "feature:shrine:rear-bones",
        "interactable",
        "石座后的完整骸骨",
        "intact",
        rectangle("-60", "240", "60", "300"),
        { height: "30", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
    ],
  ),
  reveal: geometry(
    rectangle("-480", "-360", "480", "360"),
    [
      at("-300", "-240"), at("-180", "-240"), at("-60", "-240"), at("60", "-240"),
      at("180", "-240"), at("300", "-240"), at("-300", "180"), at("300", "180"),
    ],
    [
      feature(
        "feature:reveal:testament-table",
        "interactable",
        "宣读遗嘱的长桌",
        "intact",
        rectangle("-240", "-30", "240", "30"),
        { height: "36", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
      feature(
        "feature:reveal:stone-wall",
        "barrier",
        "神龛侧墙",
        "intact",
        rectangle("390", "-210", "450", "210"),
        { height: "120", opaque: true, impassable: true, cover: "full", propagation: "blocks" },
      ),
    ],
  ),
  confrontation: geometry(
    rectangle("-480", "-480", "480", "480"),
    [
      at("-300", "-300"), at("-180", "-300"), at("-60", "-300"), at("60", "-300"),
      at("180", "-300"), at("300", "-300"), at("-300", "240"), at("300", "240"),
    ],
    [
      feature(
        "feature:confrontation:broken-pillar-west",
        "barrier",
        "西侧断柱",
        "damaged",
        rectangle("-330", "-30", "-210", "90"),
        { height: "72", opaque: true, impassable: true, cover: "full", propagation: "blocks" },
      ),
      feature(
        "feature:confrontation:broken-pillar-east",
        "barrier",
        "东侧断柱",
        "damaged",
        rectangle("210", "-30", "330", "90"),
        { height: "72", opaque: true, impassable: true, cover: "full", propagation: "blocks" },
      ),
      feature(
        "feature:confrontation:bone-circle",
        "terrain",
        "骨纹圆阵",
        "dormant",
        rectangle("-120", "150", "120", "330"),
        { height: "1", opaque: false, impassable: false, cover: "none", propagation: "passes" },
      ),
    ],
  ),
});

/**
 * ADR 0087: the hall of the wake as its boxed text sets it out. The stairs and
 * the ledger counter are on the map, Lian sits by the hearth, Naes stands in
 * the stairs' shadow and Varo keeps his paper on the counter; the players come
 * in at the west end. Every other scene keeps its first layout.
 */
export const BLACK_OAK_TACTICAL_GEOMETRY_V2: Readonly<
  Record<string, CanonicalTacticalGeometry>
> = Object.freeze({
  ...BLACK_OAK_TACTICAL_GEOMETRY_V1,
  wake: geometry(
    rectangle("-480", "-360", "480", "360"),
    [
      at("-420", "60"), at("-360", "60"), at("-300", "60"), at("-420", "-60"),
      at("-360", "-60"), at("-300", "-60"), at("-420", "-180"), at("-360", "-180"),
    ],
    [
      ...BLACK_OAK_TACTICAL_GEOMETRY_V1.wake.obstacles,
      feature(
        "feature:wake:ledger-counter",
        "interactable",
        "账台",
        "intact",
        rectangle("-60", "270", "180", "330"),
        { height: "42", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
      feature(
        "feature:wake:stairs",
        "interactable",
        "通往楼上的木楼梯",
        "intact",
        rectangle("300", "210", "450", "330"),
        { height: "120", opaque: false, impassable: true, cover: "half", propagation: "passes" },
      ),
    ],
  ),
});

/** SPEC 0014 §4 (ADR 0098): what the existing features plainly are made of. */
const BLACK_OAK_MATERIALS_V3: Readonly<Record<string, TacticalMaterial>> = Object.freeze({
  "feature:cellar:barrel-rack-west": "wood",
  "feature:confrontation:broken-pillar-east": "stone",
  "feature:confrontation:broken-pillar-west": "stone",
  "feature:private-lian:guest-bed": "wood",
  "feature:private-lian:wardrobe": "wood",
  "feature:reveal:stone-wall": "stone",
  "feature:reveal:testament-table": "wood",
  "feature:shrine:stone-seat": "stone",
  "feature:wake:hearth": "stone",
  "feature:wake:joined-tables": "wood",
  "feature:wake:ledger-counter": "wood",
  "feature:wake:stairs": "wood",
  "feature:wake:wet-floor": "mud",
  "feature:wills:hearth": "stone",
  "feature:wills:ledger-counter": "wood",
  "feature:yard:cellar-door": "wood",
  "feature:yard:mud": "mud",
  "feature:yard:stone-steps": "stone",
});

function withMaterials(scene: CanonicalTacticalGeometry): CanonicalTacticalGeometry {
  return {
    ...scene,
    obstacles: scene.obstacles.map((entry) => BLACK_OAK_MATERIALS_V3[entry.featureId] === undefined
      ? entry : { ...entry, material: BLACK_OAK_MATERIALS_V3[entry.featureId] }),
  };
}

const MATERIAL_SCENES_V3 = Object.fromEntries(Object.entries(BLACK_OAK_TACTICAL_GEOMETRY_V2)
  .map(([sceneId, scene]) => [sceneId, withMaterials(scene)]));

/**
 * SPEC 0014 §4 (ADR 0098): the V2 layouts with the terrain the map records.
 * Existing features name their material, and the back yard gets a muddy
 * drainage ditch, 3 feet deep and 5 wide, in its west half from near the
 * north wall down to the mud, and a 3-foot stone wall the same length in its
 * east half. Walkers go round the south end of each to reach the strips
 * behind them; every spawn point, the cellar door, the steps and the hidden
 * passage stay reachable as before.
 */
export const BLACK_OAK_TACTICAL_GEOMETRY_V3: Readonly<
  Record<string, CanonicalTacticalGeometry>
> = Object.freeze({
  ...MATERIAL_SCENES_V3,
  yard: geometry(
    MATERIAL_SCENES_V3.yard.boundary.points,
    MATERIAL_SCENES_V3.yard.spawnPoints,
    [
      ...MATERIAL_SCENES_V3.yard.obstacles,
      feature(
        "feature:yard:drainage-ditch",
        "terrain",
        "排水沟",
        "muddy",
        rectangle("-420", "-360", "-360", "-60"),
        {
          height: "1", opaque: false, impassable: true, cover: "none", propagation: "passes",
          landform: "ditch", depth: "36", material: "mud",
        },
      ),
      feature(
        "feature:yard:low-stone-wall",
        "barrier",
        "矮石墙",
        "intact",
        rectangle("360", "-360", "372", "-60"),
        {
          height: "36", opaque: true, impassable: true, cover: "half", propagation: "blocks",
          landform: "lowWall", material: "stone",
        },
      ),
    ],
  ),
});

/** A door to a module connection: the same door graph as the yard's, its
 * flags those of the state it starts in. */
function door(
  featureId: string,
  label: string,
  state: "open" | "closed" | "locked",
  polygon: TacticalPoint2d[],
  stateGraph: CanonicalTacticalFeatureStateGraph,
  height = "84",
): CanonicalTacticalFeature {
  const { state: _state, ...flags } = stateGraph.states.find((entry) => entry.state === state)!;
  return feature(featureId, "portal", label, state, polygon, {
    height, ...flags, durability: { ...DOOR_DURABILITY, immuneDamageTypes: [...DOOR_DURABILITY.immuneDamageTypes] },
    stateGraph, material: "wood",
  });
}

/** SPEC 0014 §2.1 (ADR 0098): an opening or a stair, which has no door to
 * shut and can only be wrecked. Walkers pass it unless it is a railed
 * stairwell on the upper floor. */
function passageStateGraph(featureId: string, railed: boolean): CanonicalTacticalFeatureStateGraph {
  const flags = { opaque: false, impassable: railed, cover: "none", propagation: "passes" } as const;
  return {
    definitionId: `environment-definition:${featureId}:open-destroyed-v1`,
    states: [
      { state: "destroyed", ...flags, terrain: railed ? "normal" : "rubble" },
      { state: "open", ...flags, terrain: "normal" },
    ],
    transitions: [],
    durability: { maximum: "12", armorClass: "11", damageThreshold: "0", immuneDamageTypes: ["poison", "psychic"] },
    damageTransitions: [{ fromState: "open", remainingDurabilityAtOrBelow: "0", toState: "destroyed" }],
  };
}

function passage(
  featureId: string,
  label: string,
  polygon: TacticalPoint2d[],
  options: { height: string; railed?: boolean; material?: TacticalMaterial },
): CanonicalTacticalFeature {
  const stateGraph = passageStateGraph(featureId, options.railed === true);
  const { state: _state, ...flags } = stateGraph.states.find((entry) => entry.state === "open")!;
  return feature(featureId, "portal", label, "open", polygon, {
    height: options.height, ...flags, durability: { current: "12", maximum: "12", armorClass: "11", damageThreshold: "0",
      immuneDamageTypes: ["poison", "psychic"] }, stateGraph,
    ...(options.material === undefined ? {} : { material: options.material }),
  });
}

/** V3 with some features replaced by id and others added. */
function completed(
  scene: CanonicalTacticalGeometry,
  replaced: Readonly<Record<string, (feature: CanonicalTacticalFeature) => CanonicalTacticalFeature>>,
  added: CanonicalTacticalFeature[],
): CanonicalTacticalGeometry {
  return geometry(scene.boundary.points, scene.spawnPoints,
    [...scene.obstacles.map((entry) => replaced[entry.featureId]?.(entry) ?? entry), ...added]);
}

const V3 = BLACK_OAK_TACTICAL_GEOMETRY_V3;

/**
 * SPEC 0014 §§2.1, 4 (ADR 0098): every scene map completed from the module
 * text, with a door on both sides of every module connection
 * (black-oak-will-connections.ts). Every V3 feature keeps its id and place.
 *
 * - wake: the candlestick on the bier ("烛台" hazard); the street door the
 *   players came in by, on the west wall by their spawn points (ADR 0087);
 *   the back door to the yard; the opening to the counter-and-fireside room
 *   of the wills; the foot of the stairs up to Lian's room, where Naes
 *   stands in its shadow.
 * - wills: the opening back to the hall.
 * - yard: the back door to the hall; the cellar door "被新钉封死" starts
 *   locked, as the module's yard-cellar portal does; the steps are steps.
 * - private-lian: the stairwell coming up from the hall, railed.
 * - cellar: the inside of the nailed door; the mouth of the steps down to
 *   the shrine, which are stone ("深处有石阶"); the junk pile the crowbar is
 *   found in ("从杂物堆找出旧撬棍"); the tally scratched along the base of the
 *   left-hand wall as one comes in ("左侧墙根有一排刮痕").
 * - shrine: the foot of the steps from the cellar; the wooden box by the
 *   shrine that holds the journal ("翻神龛旁木盒"); the stone seat takes the
 *   AC and hit points the module gives it ("砍石座可以：AC 15 HP 25").
 * - reveal and confrontation: the text names nothing more to place.
 */
export const BLACK_OAK_TACTICAL_GEOMETRY_V4: Readonly<
  Record<string, CanonicalTacticalGeometry>
> = Object.freeze({
  ...V3,
  wake: completed(V3.wake, {}, [
    // On the joined tables, 36 inches up, by the body's head.
    { ...feature(
      "feature:wake:candlestick",
      "interactable",
      "灵前烛台",
      "lit",
      rectangle("-240", "-15", "-210", "15"),
      { height: "18", opaque: false, impassable: false, cover: "none", propagation: "passes", material: "metal" },
    ), elevation: "36" },
    door("feature:wake:street-door", "前门", "closed", rectangle("-480", "-60", "-450", "60"),
      portalStateGraph("feature:wake:street-door")),
    door("feature:wake:yard-door", "通往后院的后门", "open", rectangle("0", "-360", "120", "-330"),
      portalStateGraph("feature:wake:yard-door")),
    passage("feature:wake:wills-opening", "通往账台与炉边的开口", rectangle("-330", "330", "-210", "360"), { height: "96" }),
    // The 5 feet in front of the bottom step, where Naes stands in the stairs' shadow.
    passage("feature:wake:stair-foot", "楼梯口", rectangle("240", "210", "300", "330"), { height: "96", material: "wood" }),
  ]),
  wills: completed(V3.wills, {}, [
    passage("feature:wills:hall-opening", "通往守灵大厅的开口", rectangle("-180", "-300", "-60", "-270"), { height: "96" }),
  ]),
  yard: completed(V3.yard, {
    "feature:yard:cellar-door": (entry) => {
      const stateGraph = lockablePortalStateGraph(entry.featureId);
      return { ...entry, state: "locked", stateGraph };
    },
    "feature:yard:hidden-passage": (entry) => ({ ...entry, material: "earth" }),
    "feature:yard:stone-steps": (entry) => ({ ...entry, landform: "step" }),
  }, [
    door("feature:yard:hall-door", "通往大厅的后门", "open", rectangle("-240", "390", "-120", "420"),
      portalStateGraph("feature:yard:hall-door")),
  ]),
  "private-lian": completed(V3["private-lian"], {}, [
    passage("feature:private-lian:stairwell", "楼梯口", rectangle("150", "-90", "300", "30"),
      { height: "36", railed: true, material: "wood" }),
  ]),
  cellar: completed(V3.cellar, {
    "feature:cellar:deep-stairs": (entry) => ({ ...entry, landform: "step", material: "stone" }),
  }, [
    // The same door as the yard's, as tall.
    door("feature:cellar:yard-door", "通往后院的钉封橡木门", "locked", rectangle("-90", "-600", "90", "-570"),
      lockablePortalStateGraph("feature:cellar:yard-door"), "96"),
    passage("feature:cellar:shrine-steps", "通往神龛的石阶口", rectangle("-120", "570", "120", "600"),
      { height: "84", material: "stone" }),
    feature(
      "feature:cellar:junk-pile",
      "interactable",
      "杂物堆",
      "intact",
      rectangle("270", "120", "390", "240"),
      { height: "36", opaque: false, impassable: true, cover: "half", propagation: "passes", material: "wood" },
    ),
    feature(
      "feature:cellar:tally-marks",
      "interactable",
      "墙根的刮痕",
      "intact",
      rectangle("408", "-300", "420", "-60"),
      { height: "24", opaque: false, impassable: false, cover: "none", propagation: "passes", material: "stone" },
    ),
  ]),
  shrine: completed(V3.shrine, {
    "feature:shrine:stone-seat": (entry) => ({
      ...entry,
      durability: { current: "25", maximum: "25", armorClass: "15", damageThreshold: "0", immuneDamageTypes: ["poison", "psychic"] },
      stateGraph: {
        ...entry.stateGraph!,
        definitionId: "environment-definition:feature:shrine:stone-seat:durability-v2",
        durability: { maximum: "25", armorClass: "15", damageThreshold: "0", immuneDamageTypes: ["poison", "psychic"] },
        damageTransitions: [
          { fromState: "damaged", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
          { fromState: "intact", remainingDurabilityAtOrBelow: "16", toState: "damaged" },
        ],
      },
    }),
  }, [
    passage("feature:shrine:cellar-steps", "通往酒窖的石阶", rectangle("-120", "-360", "120", "-330"),
      { height: "84", material: "stone" }),
    feature(
      "feature:shrine:wooden-box",
      "interactable",
      "神龛旁的木盒",
      "closed",
      rectangle("-150", "180", "-120", "210"),
      { height: "12", opaque: false, impassable: false, cover: "none", propagation: "passes", material: "wood" },
    ),
  ]),
});

/** Where the module's people stand when the wake opens (ADR 0087). */
export const BLACK_OAK_OPENING_PLACEMENTS_V2: Readonly<Record<string, Readonly<Record<string, TacticalPosition>>>> = Object.freeze({
  wake: Object.freeze({
    "npc:black-oak-will:lian": at("360", "0"),
    "npc:black-oak-will:naes": at("270", "270"),
    "npc:black-oak-will:varo": at("60", "240"),
  }),
});
