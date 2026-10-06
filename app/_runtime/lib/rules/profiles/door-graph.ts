import type {
  CanonicalTacticalFeatureDurability,
  CanonicalTacticalFeatureStateGraph,
} from "./tactical-geometry";
import { lockableObjectTransitions } from "./object-state";

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
    transitions: lockableObjectTransitions(),
    damageTransitions: [
      { fromState: "closed", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      { fromState: "locked", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      { fromState: "open", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
    ],
  };
}

/** SPEC 0014 §2.3: a map object's missing lockable mechanism, fixed before
 * use with explicit spatial consequences and initial durability. */
export function completedLockableFeature(featureId: string, armorClass: number, hitPoints: number,
  currentState: import("./tactical-geometry").CanonicalTacticalFeatureState, opensPassage: boolean): Readonly<{
  stateGraph: CanonicalTacticalFeatureStateGraph;
  durability: CanonicalTacticalFeatureDurability;
}> {
  const graph = lockablePortalStateGraph(featureId);
  // opensPassage explicitly chooses the passage preset. An initially open
  // passage must not copy its passable geometry into its closed state.
  // With no passage effect, every operating state retains the object's
  // existing geometry (e.g. opening a chest does not remove the chest).
  const closedState = opensPassage && currentState.state === "open"
    ? graph.states.find(state => state.state === "closed")! : currentState;
  const definition = { ...graph.durability!, maximum: String(hitPoints), armorClass: String(armorClass) };
  return {
    stateGraph: { ...graph, durability: definition, states: graph.states.map(state => state.state === "destroyed" ? state
      : state.state === "open" && opensPassage ? state : { ...closedState, state: state.state }) },
    durability: { current: definition.maximum, ...definition, immuneDamageTypes: [...definition.immuneDamageTypes] },
  };
}
