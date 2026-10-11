import { RulesValidationError } from "../errors";
import type { AuthoritativeWorldState, EventEnvelope } from "./model";
import { hasOnlyKeys, isNonEmptyString, isRecord } from "./validation";
import { isWorldEffectRecord } from "./world-effects";

/** SPEC 0012 §10.1: the saving throw a target repeats at the end of its turn
 * against a condition it is under. A success is followed by that effect's
 * EffectEnded; this event only records the roll. */
export type EffectSaveRepeatedPayload = Readonly<{
  effectId: string;
  targetEntityId: string;
  ability: string;
  dc: number;
  modifier: number;
  mode: "normal" | "advantage" | "disadvantage";
  rolls: readonly number[];
  roll: number | null;
  total: number | null;
  automaticFailure: boolean;
  succeeded: boolean;
  /** SRD Bless: the bonus die added to the total. */
  bonusDie?: number;
}>;

const integer = (value: unknown): value is number => Number.isSafeInteger(value);

export function isEffectSaveRepeatedPayload(value: unknown): value is EffectSaveRepeatedPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ["ability", "automaticFailure", "dc", "effectId", "mode", "modifier",
    "roll", "rolls", "succeeded", "targetEntityId", "total"], ["bonusDie"])
    || !(value.bonusDie === undefined || (integer(value.bonusDie) && value.bonusDie >= 1))) return false;
  if (![value.effectId, value.targetEntityId, value.ability].every(isNonEmptyString)
    || !integer(value.dc) || !integer(value.modifier)
    || !["normal", "advantage", "disadvantage"].includes(String(value.mode))
    || !Array.isArray(value.rolls) || !value.rolls.every((face) => integer(face) && face >= 1 && face <= 20)
    || typeof value.automaticFailure !== "boolean" || typeof value.succeeded !== "boolean") return false;
  if (value.automaticFailure) {
    return value.roll === null && value.total === null && value.rolls.length === 0 && value.succeeded === false;
  }
  return integer(value.roll) && integer(value.total) && value.total === value.roll + value.modifier + Number(value.bonusDie ?? 0)
    && value.rolls.includes(value.roll) && value.succeeded === (value.total >= value.dc);
}

/** The roll changes nothing by itself; replay only checks it names a live
 * repeated save of that target. */
export function applyEffectSaveRepeatedEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "EffectSaveRepeated") return false;
  const payload = event.payload;
  if (!isEffectSaveRepeatedPayload(payload)) throw new RulesValidationError("effect-repeat-save:payload-invalid");
  const effect = state.combatRuntime.effects[payload.effectId];
  if (!isWorldEffectRecord(effect) || effect.targetEntityId !== payload.targetEntityId
    || effect.lifecycle?.repeatSave === undefined || effect.lifecycle.repeatSave.ability !== payload.ability
    || effect.lifecycle.repeatSave.dc !== payload.dc) {
    throw new RulesValidationError("effect-repeat-save:effect-unavailable");
  }
  return true;
}
