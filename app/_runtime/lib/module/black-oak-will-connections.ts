import { durationSeconds } from "../rules/ruleset";
import { BLACK_OAK_WILL } from "./black-oak-will";

/** One end of a module connection: the door, opening or stair feature on
 * that scene's map, and where a creature coming through stands on it. */
export type ModuleConnectionSide = Readonly<{ sceneId: string; featureId: string; arrival: Readonly<{ x: string; y: string; elevation: string }> }>;
/** SPEC 0014 §2.1 (ADR 0098): a module portal on the maps. `sides` are the
 * portal's `from` and `to`; its state starts as the portal's does, and
 * crossing it takes the portal's traversal time, in microseconds. */
export type ModuleSceneConnection = Readonly<{ id: string; sides: readonly [ModuleConnectionSide, ModuleConnectionSide];
  initialState: "open" | "closed" | "locked"; bidirectional: boolean; travelMicros: string }>;
/** Where a scene map's origin lies in the one site plan, in inches; `level`
 * 0 is the ground floor, -1 below it and 1 above. */
export type ModuleSitePlacement = Readonly<{ x: string; y: string; level: number }>;

function side(sceneId: string, featureId: string, x: string, y: string): ModuleConnectionSide {
  return Object.freeze({ sceneId, featureId, arrival: Object.freeze({ x, y, elevation: "0" }) });
}

/** The portal's state and time come from the module text; only the map ends are written here. */
function connection(id: string, from: ModuleConnectionSide, to: ModuleConnectionSide): ModuleSceneConnection {
  const portal = BLACK_OAK_WILL.world.portals.find((entry) => entry.id === id);
  if (portal === undefined || portal.from !== from.sceneId || portal.to !== to.sceneId || portal.initialState === "destroyed") {
    throw new TypeError(`Module connection does not match its portal: ${id}`);
  }
  return Object.freeze({
    id,
    sides: Object.freeze([from, to] as const),
    initialState: portal.initialState,
    bidirectional: true,
    travelMicros: (BigInt(durationSeconds(portal.traversalTime)) * 1_000_000n).toString(),
  });
}

/**
 * SPEC 0014 §2.1 (ADR 0098): the Black Oak's five portals on the
 * social-resolution-v4 maps (BLACK_OAK_TACTICAL_GEOMETRY_V4). Each arrival
 * is clear of anything solid, inside the map, beside its door and on the
 * 30-inch walking lattice, and walks to every spawn point.
 */
export const BLACK_OAK_SCENE_CONNECTIONS_V4: readonly ModuleSceneConnection[] = Object.freeze([
  // The hall opens into the counter-and-fireside room where the wills are read.
  connection("wake-wills",
    side("wake", "feature:wake:wills-opening", "-270", "300"),
    side("wills", "feature:wills:hall-opening", "-120", "-240")),
  // The back door of the hall and the house door of the back yard.
  connection("wake-yard",
    side("wake", "feature:wake:yard-door", "60", "-300"),
    side("yard", "feature:yard:hall-door", "-180", "360")),
  // The stairs from the hall come up into the upper floor by Lian's room.
  connection("wake-private-lian",
    side("wake", "feature:wake:stair-foot", "270", "180"),
    side("private-lian", "feature:private-lian:stairwell", "270", "-120")),
  // The nailed oak door at the foot of the yard's steps, from each side.
  connection("yard-cellar",
    side("yard", "feature:yard:cellar-door", "0", "300"),
    side("cellar", "feature:cellar:yard-door", "0", "-540")),
  // The stone steps from the back of the cellar down to the shrine; coming
  // up, one stands at the top of them.
  connection("cellar-shrine",
    side("cellar", "feature:cellar:shrine-steps", "0", "540"),
    side("shrine", "feature:shrine:cellar-steps", "0", "-300")),
]);

/**
 * SPEC 0014 §2.1 (ADR 0098): every v4 scene map placed in one site plan,
 * +x east and +y south. The hall is the origin; the back yard lies north of
 * it, sharing the hall's back wall, and the wills room south of it; the
 * doors of each meet on the shared wall. The upper floor sits over the
 * hall's south-east corner, its stairwell over the hall's stairs. The cellar
 * runs south under the house from its door in the yard, and the shrine lies
 * beyond the cellar's far end, at its steps.
 *
 * The reveal and the confrontation are the hall later in the night: the
 * reveal's map is the hall's own floor with the bier table where the joined
 * tables stand, the will is read out "当众" to Naes, Lian and Varo, who are
 * in the hall, and the confrontation happens "当场". Both take the hall's
 * placement.
 */
export const BLACK_OAK_SITE_PLAN_V4: Readonly<Record<string, ModuleSitePlacement>> = Object.freeze({
  wake: Object.freeze({ x: "0", y: "0", level: 0 }),
  wills: Object.freeze({ x: "-150", y: "660", level: 0 }),
  yard: Object.freeze({ x: "240", y: "-780", level: 0 }),
  "private-lian": Object.freeze({ x: "150", y: "300", level: 1 }),
  cellar: Object.freeze({ x: "240", y: "150", level: -1 }),
  shrine: Object.freeze({ x: "240", y: "1110", level: -1 }),
  reveal: Object.freeze({ x: "0", y: "0", level: 0 }),
  confrontation: Object.freeze({ x: "0", y: "0", level: 0 }),
});
