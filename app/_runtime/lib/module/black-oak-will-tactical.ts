import type {
  CanonicalTacticalFeature,
  CanonicalTacticalGeometry,
  CanonicalTacticalFeatureStateGraph,
} from "../rules/profiles/tactical-geometry";
import type { TacticalPoint2d, TacticalPosition } from "../rules/tactical-projection";

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
    "durability" | "stateGraph" | "terrain" | "visibilityPolicyId"
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

function portalStateGraph(featureId: string): CanonicalTacticalFeatureStateGraph {
  return {
    definitionId: `environment-definition:${featureId}:open-closed-destroyed-v1`,
    states: [
      {
        state: "closed",
        opaque: true,
        impassable: true,
        cover: "full",
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
        state: "open",
        opaque: false,
        impassable: false,
        cover: "none",
        propagation: "passes",
        terrain: "normal",
      },
    ],
    transitions: [
      { fromState: "closed", intent: "open", toState: "open" },
      { fromState: "open", intent: "close", toState: "closed" },
    ],
    durability: {
      maximum: "4",
      armorClass: "11",
      damageThreshold: "0",
      immuneDamageTypes: ["poison", "psychic"],
    },
    damageTransitions: [
      { fromState: "closed", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      { fromState: "open", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
    ],
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
