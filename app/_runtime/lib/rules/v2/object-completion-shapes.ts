import { AUTHORED_ITEM_WITH_GAPS_SCHEMA, matchesAuthoredSourceSchema, type AuthoredSourceSchema } from "./authored-materialization";
import { isCombatStartStatistics, type CombatStartStatistics } from "./combat-start";
import { COMBAT_START_SOURCE_SCHEMA } from "./combat-start-shapes";
import { itemDefinitionContentDiagnostics, type ItemDefinitionContentV1 } from "./items";
import { TACTICAL_LANDFORMS, TACTICAL_MATERIALS, TACTICAL_WATER_CURRENTS, type TacticalTerrainFields } from "../tactical-projection";
import { isRecord } from "./validation";

export type NativeObjectCompletion =
  | { kind: "itemDefinition"; content: ItemDefinitionContentV1 }
  | { kind: "npcCombat"; statistics: readonly [CombatStartStatistics] }
  | { kind: "terrain"; landform: TacticalTerrainFields["landform"] | null;
      material: TacticalTerrainFields["material"] | null; depth: string | null; current: TacticalTerrainFields["current"] | null }
  | { kind: "durability"; armorClass: number; hitPoints: number; damageThreshold: number; immuneDamageTypes: string[];
      destroyed: { opaque: boolean; impassable: boolean; cover: "none" | "half" | "threeQuarters" | "full";
        propagation: "passes" | "blocks"; terrain: "normal" | "rubble" } };

const object = (properties: Record<string, AuthoredSourceSchema>): AuthoredSourceSchema => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const values = (...entries: readonly string[]): AuthoredSourceSchema => ({ type: "string", enum: entries });
const integer = (minimum: number, maximum = 1_000_000): AuthoredSourceSchema => ({ type: "integer", minimum, maximum });
const nullable = (schema: AuthoredSourceSchema): AuthoredSourceSchema => ({ anyOf: [{ type: "null" }, schema] });

/** Lazily built because combat and authored definitions share Rules shapes. */
function nativeObjectCompletionSourceSchema(): AuthoredSourceSchema {
  return { anyOf: [
    object({ kind: values("itemDefinition"), content: AUTHORED_ITEM_WITH_GAPS_SCHEMA }),
    object({ kind: values("npcCombat"), statistics: COMBAT_START_SOURCE_SCHEMA.properties!.combatStatistics }),
    object({ kind: values("terrain"), landform: nullable(values(...TACTICAL_LANDFORMS)),
      material: nullable(values(...TACTICAL_MATERIALS)), depth: nullable({ type: "string", pattern: "^[1-9][0-9]*$" }),
      current: nullable(values(...TACTICAL_WATER_CURRENTS)) }),
    object({ kind: values("durability"), armorClass: integer(1, 30), hitPoints: integer(1), damageThreshold: integer(0),
      immuneDamageTypes: { type: "array", items: values("acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder") },
      destroyed: object({ opaque: { type: "boolean" }, impassable: { type: "boolean" }, cover: values("none", "half", "threeQuarters", "full"),
        propagation: values("passes", "blocks"), terrain: values("normal", "rubble") }) }),
  ] };
}

// Authored Item and NPC vocabularies are also imported by Rules execution.
// Resolve their immutable branches on read, after module initialization.
export const NATIVE_OBJECT_COMPLETION_SOURCE_SCHEMA: AuthoredSourceSchema = Object.freeze({
  get anyOf() { return nativeObjectCompletionSourceSchema().anyOf; },
});

export function isNativeObjectCompletion(value: unknown): value is NativeObjectCompletion {
  if (!isRecord(value) || !matchesAuthoredSourceSchema(value, NATIVE_OBJECT_COMPLETION_SOURCE_SCHEMA)) return false;
  return value.kind === "npcCombat" ? Array.isArray(value.statistics) && value.statistics.length === 1 && isCombatStartStatistics(value.statistics[0])
    : value.kind === "itemDefinition" ? itemDefinitionContentDiagnostics(value.content).length === 0
    : value.kind !== "terrain" || [value.landform, value.material, value.depth, value.current].some(field => field !== null);
}
