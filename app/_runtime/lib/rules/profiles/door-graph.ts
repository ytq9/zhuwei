import type {
  CanonicalTacticalFeatureDurability,
  CanonicalTacticalFeatureStateGraph,
} from "./tactical-geometry";

/** The module doors' durability: a wooden door, AC 11 and 4 hit points. */
export const DOOR_DURABILITY = Object.freeze({
  current: "4", maximum: "4", armorClass: "11", damageThreshold: "0", immuneDamageTypes: Object.freeze(["poison", "psychic"]),
});

/** SPEC 0014 §2.1 (ADR 0098): a door that opens and closes, and is
 * destroyed at 0 durability. */
export function portalStateGraph(featureId: string): CanonicalTacticalFeatureStateGraph {
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

/** SPEC 0014 §2.1 (ADR 0098): a door that can also be nailed shut. The
 * map's open does not move it; SPEC 0004 §4: a step the KP rules opens it by
 * unlock -- the module's key, or picking or forcing it on the KP's check --
 * and breaking it destroys it. */
export function lockablePortalStateGraph(featureId: string): CanonicalTacticalFeatureStateGraph {
  const doorGraph = portalStateGraph(featureId);
  const closed = doorGraph.states.find((entry) => entry.state === "closed")!;
  return {
    ...doorGraph,
    definitionId: `environment-definition:${featureId}:open-closed-locked-destroyed-v2`,
    states: [...doorGraph.states, { ...closed, state: "locked" }].sort((left, right) => left.state.localeCompare(right.state)),
    transitions: [
      { fromState: "closed", intent: "open", toState: "open" },
      { fromState: "locked", intent: "unlock", toState: "open" },
      { fromState: "open", intent: "close", toState: "closed" },
    ],
    damageTransitions: [
      { fromState: "closed", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      { fromState: "locked", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      { fromState: "open", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
    ],
  };
}

/** The states a door of a new place may be completed in (SPEC 0015 §11.1). */
export const COMPLETED_DOOR_STATES = Object.freeze(["closed", "locked", "open"] as const);
export type CompletedDoorState = (typeof COMPLETED_DOOR_STATES)[number];

/** SPEC 0015 §11.1: a door of a place the KP created, completed on first
 * use. It is the module's lockable door with the AC and hit points the KP
 * fixed; it starts undamaged. */
export function completedDoor(featureId: string, armorClass: number, hitPoints: number): Readonly<{
  stateGraph: CanonicalTacticalFeatureStateGraph;
  durability: CanonicalTacticalFeatureDurability;
}> {
  const graph = lockablePortalStateGraph(featureId);
  const definition = { ...graph.durability!, maximum: String(hitPoints), armorClass: String(armorClass) };
  return {
    stateGraph: { ...graph, durability: definition },
    durability: { current: definition.maximum, ...definition, immuneDamageTypes: [...definition.immuneDamageTypes] },
  };
}
