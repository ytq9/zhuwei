import type { CanonicalCombatPoint } from "../profiles/combat-geometry";
import { isCanonicalTacticalGeometry } from "../profiles/tactical-geometry";
import { planJump } from "./character-jump";
import { activeEncounter } from "./combat-encounters";
import type { AuthoritativeWorldState } from "./model";
import { onOwnCombatTurn } from "./terrain-movement";
import { planTerrainMove } from "./terrain-traversal";
import { isRecord } from "./validation";

// SPEC 0014 §4 (ADR 0098), SRD 5.1: jumping on the combat map. On its own
// turn a creature makes a long jump across, or a high jump onto, a feature of
// its scene, from where it stands, as part of its movement; the map sends it
// straight to Rules (ADR 0091). Rules plans the landing as outside encounters
// (planJump, planTerrainMove) and offers only the jumps it can make now.

export type CombatJumpKind = "long" | "high";

const COMBAT_JUMPS: Readonly<Record<string, CombatJumpKind>> = Object.freeze({
  "action:long-jump": "long",
  "action:high-jump": "high",
});

export function combatJumpKey(abilityRef: string): CombatJumpKind | undefined {
  return Object.hasOwn(COMBAT_JUMPS, abilityRef) ? COMBAT_JUMPS[abilityRef] : undefined;
}

/** One jump the creature can make now: across (`action:long-jump`) or onto
 * (`action:high-jump`) `featureId`, from where it stands to `to`, spending
 * `costMilliInches` of its movement. `clearCheck` is the Strength (Athletics)
 * DC 10 to clear a low obstacle, `landingCheck` the Dexterity (Acrobatics)
 * DC 10 to land in difficult terrain. */
export type CombatJumpOption = {
  abilityRef: "action:long-jump" | "action:high-jump";
  featureId: string;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
  running: boolean;
  costMilliInches: string;
  clearCheck: boolean;
  landingCheck: boolean;
};

const RAISED_LANDFORMS: ReadonlySet<unknown> = new Set(["cliff", "lowWall", "step"]);

/** SPEC 0014 §4 (ADR 0098): the jumps the creature can make now, on its own
 * turn in an encounter, over the features of its scene it can see, in the
 * map's feature order. None off its turn. */
export function combatJumpOptions(state: AuthoritativeWorldState, actorId: string): CombatJumpOption[] {
  const actor = state.entities[actorId];
  if (actor === undefined || activeEncounter(state, actorId) === undefined || !onOwnCombatTurn(state, actorId)) return [];
  const scene = state.combatRuntime.scenes[actor.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (!isCanonicalTacticalGeometry(geometry)) return [];
  return geometry.obstacles.flatMap((feature): CombatJumpOption[] => {
    const options: CombatJumpOption[] = [];
    const long = planJump(state, actorId, feature.featureId);
    if (long.kind === "accepted") {
      options.push({ abilityRef: "action:long-jump", featureId: feature.featureId, from: long.from, to: long.to, running: long.running,
        costMilliInches: long.distanceMilliInches, clearCheck: long.impassable, landingCheck: long.difficultLanding });
    }
    if (RAISED_LANDFORMS.has(feature.landform)) {
      const high = planTerrainMove(state, actorId, feature.featureId, { kind: "jumpOnto" });
      if (high.kind === "accepted") {
        options.push({ abilityRef: "action:high-jump", featureId: feature.featureId, from: high.from, to: high.to,
          running: high.running === true, costMilliInches: high.movementCostMilliInches, clearCheck: false, landingCheck: false });
      }
    }
    return options;
  });
}
