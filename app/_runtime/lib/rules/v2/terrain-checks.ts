import { isCanonicalTacticalGeometry, isHollowTacticalFeature } from "../profiles/tactical-geometry";
import type { TacticalMaterial, TacticalWaterCurrent } from "../tactical-projection";
import type { AuthoritativeWorldState } from "./model";
import { isRecord } from "./validation";

// SPEC 0014 §4 (ADR 0100): whether climbing or swimming a feature takes an
// Athletics check, and at what DC. A climb no higher (or deeper) than the
// creature's own height takes none. Above that, a feature whose material
// (water: current) the map records takes the table's DC, which the KP uses;
// one the map says nothing about is the KP's to rule. The KP writes both
// outcomes before the roll either way.

export type TerrainCheckRequirement =
  | Readonly<{ kind: "none"; reason: "within-height" | "material" | "current"; bodyHeightInches: string }>
  | Readonly<{ kind: "athletics"; dc: number; basis: "material" | "current"; bodyHeightInches: string }>
  | Readonly<{ kind: "kp"; bodyHeightInches: string }>;

/** SRD 5.1 typical heights by race, used only for this judgement (ADR 0100). */
const RACE_HEIGHT_INCHES: Readonly<Record<string, bigint>> = Object.freeze({
  lightfoot: 36n, "rock-gnome": 42n, "hill-dwarf": 54n, "mountain-dwarf": 54n,
  human: 66n, "high-elf": 66n, "wood-elf": 66n, "half-elf": 66n, tiefling: 66n, "half-orc": 72n, dragonborn: 78n,
});
/** No check for rope; Athletics DC by what the surface is made of. */
const CLIMB_DC: Readonly<Record<TacticalMaterial, number | null>> = Object.freeze({
  rope: null, stone: 10, brick: 10, wood: 10, earth: 10, mud: 15, metal: 20,
});
const SWIM_DC: Readonly<Record<TacticalWaterCurrent, number | null>> = Object.freeze({ still: null, rough: 15 });

/** The check a climb (or swim) of `featureId` asks of the actor, or undefined
 * when the actor or the feature is not on the map of its scene. */
export function terrainCheckRequirement(state: AuthoritativeWorldState, actorId: string, featureId: string,
  way: "climb" | "swim"): TerrainCheckRequirement | undefined {
  const actor = state.entities[actorId], body = state.combatRuntime.entities[actorId];
  const scene = actor === undefined ? undefined : state.combatRuntime.scenes[actor.sceneId];
  const geometry = isRecord(scene) ? scene.geometry : undefined;
  if (actor === undefined || !isRecord(body) || !isCanonicalTacticalGeometry(geometry)) return undefined;
  const feature = geometry.obstacles.find(candidate => candidate.featureId === featureId);
  if (feature === undefined) return undefined;
  const footprint = isRecord(body.footprint) ? body.footprint : undefined;
  const ownHeight = (actor.kind === "player" && actor.raceId !== undefined ? RACE_HEIGHT_INCHES[actor.raceId] : undefined)
    ?? (typeof footprint?.height === "string" && /^[1-9][0-9]*$/u.test(footprint.height) ? BigInt(footprint.height) : undefined);
  if (ownHeight === undefined) return undefined;
  const bodyHeightInches = ownHeight.toString();
  const span = isHollowTacticalFeature(feature) ? BigInt(feature.depth ?? "0") : BigInt(feature.height);
  if (span <= ownHeight) return { kind: "none", reason: "within-height", bodyHeightInches };
  if (way === "swim") {
    if (feature.current === undefined) return { kind: "kp", bodyHeightInches };
    const dc = SWIM_DC[feature.current];
    return dc === null ? { kind: "none", reason: "current", bodyHeightInches } : { kind: "athletics", dc, basis: "current", bodyHeightInches };
  }
  if (feature.material === undefined) return { kind: "kp", bodyHeightInches };
  const dc = CLIMB_DC[feature.material];
  return dc === null ? { kind: "none", reason: "material", bodyHeightInches } : { kind: "athletics", dc, basis: "material", bodyHeightInches };
}
