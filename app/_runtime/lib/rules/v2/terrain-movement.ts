import { turnMovementLimitMilliInches } from "./basic-actions";
import { activeEncounter } from "./combat-encounters";
import { conditionSpeed } from "./condition-mechanics";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isRecord } from "./validation";

// SPEC 0014 §4 (ADR 0098): jumping, climbing and swimming inside an
// encounter spend the mover's movement this turn, as a walk does. The movement
// record on the combat entity counts it: `spentMilliInches`, which TurnStarted
// resets, and `runUpFromMilliInches`, what had been spent when the creature
// last jumped, climbed, swam, fell or stood up this turn. What it spent since
// then it spent walking, so that difference is its running start (SRD 5.1:
// at least 10 feet moved on foot immediately before a jump).

/** SRD 5.1: a running start is at least 10 feet moved on foot. */
export const RUN_UP_MILLI_INCHES = 120_000n;

const UNSIGNED = /^(0|[1-9][0-9]*)$/;

function spentOf(movement: JsonRecord, key: "spentMilliInches" | "runUpFromMilliInches"): bigint {
  const value = movement[key];
  return typeof value === "string" && UNSIGNED.test(value) ? BigInt(value) : 0n;
}

/** SPEC 0014 §4 (ADR 0098): how far the creature has moved on foot this turn
 * since it last jumped, climbed, swam, fell or stood up. Difficult ground
 * counts at what it cost. */
export function runUpMilliInches(entity: JsonRecord): bigint {
  const movement = isRecord(entity.movement) ? entity.movement : {};
  const run = spentOf(movement, "spentMilliInches") - spentOf(movement, "runUpFromMilliInches");
  return run > 0n ? run : 0n;
}

/** SPEC 0014 §4 (ADR 0098): what is left of the creature's movement this
 * turn inside an encounter -- its walking speed after conditions, once more
 * for each Dash, less what it has spent -- or undefined outside one or
 * without a walking speed. */
export function movementLeftMilliInches(state: AuthoritativeWorldState, entityId: string): bigint | undefined {
  const entity = state.combatRuntime.entities[entityId];
  const walk = isRecord(entity?.speedInches) ? entity.speedInches.walk : undefined;
  if (entity === undefined || activeEncounter(state, entityId) === undefined || typeof walk !== "string" || !UNSIGNED.test(walk)) {
    return undefined;
  }
  const speed = conditionSpeed(state, entityId, walk);
  const movement = isRecord(entity.movement) ? entity.movement : {};
  const left = turnMovementLimitMilliInches(entity, speed.canMove ? speed.speed : "0") - spentOf(movement, "spentMilliInches");
  return left > 0n ? left : 0n;
}

/** The creature's own turn in its encounter: it holds the initiative now. */
export function onOwnCombatTurn(state: AuthoritativeWorldState, entityId: string): boolean {
  return activeEncounter(state, entityId)?.activeEntityId === entityId;
}

/** The movement record after a jump, climb, swim or fall that spent `cost`:
 * the spending is added and the running start begins again from there. */
export function movementAfterTerrainMove(entity: JsonRecord, costMilliInches: bigint): JsonRecord {
  const movement = isRecord(entity.movement) ? entity.movement : {};
  const spent = (spentOf(movement, "spentMilliInches") + costMilliInches).toString();
  return { ...structuredClone(movement), spentMilliInches: spent, runUpFromMilliInches: spent };
}
