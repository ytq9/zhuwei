import { canonicalSha256 } from "../profiles/canonical";
import type { JsonRecord, FrozenCheck, WorldInteractionRandomnessRequest } from "./model";
import { hasExactKeys, isRecord, isNonEmptyString, isSha256 } from "./validation";

export type WorldInteractionDiceSpec = Readonly<{
  purposeKey: string;
  dice: readonly Readonly<{ count: string; sides: string }>[];
  frozenParameters: JsonRecord;
}>;

export function checkDice(check: FrozenCheck | null): Array<{ count: string; sides: string }> {
  return check === null ? [] : [{ count: check.mode === "normal" ? "1" : "2", sides: "20" }];
}

export function worldInteractionDiceExpression(check: FrozenCheck | null, specs: readonly WorldInteractionDiceSpec[]): string {
  const first = check === null ? [] : [check.mode === "normal" ? "1d20" : check.mode === "advantage" ? "2d20kh1" : "2d20kl1"];
  return [...first, ...specs.flatMap((spec) => spec.dice.map(({ count, sides }) => `${count}d${sides}`))].join("+");
}

export function createWorldInteractionRandomness(input: {
  actorCharacterId: string; resolutionId: string; randomnessId: string;
  check: FrozenCheck | null; specs: readonly WorldInteractionDiceSpec[];
}): WorldInteractionRandomnessRequest {
  const hazardRolls = input.specs.map((spec) => structuredClone(spec));
  const core = {
    actorCharacterId: input.actorCharacterId,
    resolutionId: input.resolutionId,
    randomnessId: input.randomnessId,
    purpose: "worldInteractionCheck" as const,
    purposeKey: `world-interaction:${input.resolutionId}`,
    frozenCheck: structuredClone(input.check),
    hazardRolls,
    dice: [...checkDice(input.check), ...hazardRolls.flatMap((spec) => spec.dice.map((die) => ({ ...die })))],
    diceExpression: worldInteractionDiceExpression(input.check, hazardRolls),
    frozenParameters: { check: structuredClone(input.check), hazardRolls: structuredClone(hazardRolls) } as JsonRecord,
  };
  return { ...core, requestHash: canonicalSha256(core) };
}

export function worldInteractionDiceValid(dice: readonly Readonly<{ count: string; sides: string }>[], rolls: readonly number[]): boolean {
  let offset = 0;
  for (const die of dice) {
    const count = Number(die.count), sides = Number(die.sides);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(sides) || sides < 2) return false;
    if (rolls.slice(offset, offset + count).length !== count
      || rolls.slice(offset, offset + count).some((face) => !Number.isSafeInteger(face) || face < 1 || face > sides)) return false;
    offset += count;
  }
  return offset === rolls.length;
}

export function worldInteractionFaces(request: WorldInteractionRandomnessRequest, rolls: readonly number[]): Map<string, readonly number[]> | undefined {
  if (!worldInteractionDiceValid(request.dice, rolls)) return undefined;
  let offset = request.frozenCheck === null ? 0 : request.frozenCheck.mode === "normal" ? 1 : 2;
  const faces = new Map<string, readonly number[]>();
  for (const spec of request.hazardRolls) {
    const count = spec.dice.reduce((sum, die) => sum + Number(die.count), 0);
    faces.set(spec.purposeKey, rolls.slice(offset, offset + count));
    offset += count;
  }
  return faces;
}

export function isWorldInteractionRandomnessRequest(value: unknown, validCheck: (v: unknown) => boolean): value is WorldInteractionRandomnessRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["actorCharacterId", "resolutionId", "randomnessId", "purpose", "purposeKey", "frozenCheck", "hazardRolls", "dice", "diceExpression", "frozenParameters", "requestHash"])
    || value.purpose !== "worldInteractionCheck"
    || ![value.actorCharacterId,value.resolutionId,value.randomnessId,value.purposeKey].every(isNonEmptyString)
    || (value.frozenCheck !== null && !validCheck(value.frozenCheck))
    || !Array.isArray(value.hazardRolls) || !isSha256(value.requestHash)) return false;
  const keys = new Set<string>();
  for (const spec of value.hazardRolls) {
    if (!isRecord(spec) || !hasExactKeys(spec, ["purposeKey", "dice", "frozenParameters"])
      || !isNonEmptyString(spec.purposeKey) || keys.has(spec.purposeKey) || !isRecord(spec.frozenParameters)
      || !Array.isArray(spec.dice)
      || spec.dice.some((die) => !isRecord(die) || !hasExactKeys(die,["count","sides"])
        || !/^[1-9][0-9]*$/.test(String(die.count)) || !/^[1-9][0-9]*$/.test(String(die.sides))
        || Number(die.sides) < 2 || !Number.isSafeInteger(Number(die.count)) || !Number.isSafeInteger(Number(die.sides)))) return false;
    keys.add(spec.purposeKey);
  }
  const expected = createWorldInteractionRandomness({ actorCharacterId: String(value.actorCharacterId), resolutionId: String(value.resolutionId), randomnessId: String(value.randomnessId), check: value.frozenCheck as FrozenCheck | null, specs: value.hazardRolls as WorldInteractionDiceSpec[] });
  return expected.dice.length > 0 && expected.dice.reduce((sum, die) => sum + Number(die.count), 0) <= 128
    && canonicalSha256(expected) === canonicalSha256(value);
}

/** DiceRolled is checked against its private request again during folding. */
export function worldInteractionDiceEventValid(value: JsonRecord): boolean {
  if (typeof value.formula !== "string" || !Array.isArray(value.faces)) return false;
  const terms = value.formula.split("+");
  const dice: Array<{count:string;sides:string}> = [];
  for (const [index, term] of terms.entries()) {
    const match = /^([1-9][0-9]*)d([1-9][0-9]*)(kh1|kl1)?$/.exec(term);
    if (match === null || (match[3] !== undefined && (index !== 0 || match[1] !== "2" || match[2] !== "20"))) return false;
    dice.push({count:match[1]!,sides:match[2]!});
  }
  return value.faces.length <= 128 && worldInteractionDiceValid(dice, value.faces as number[])
    && (value.selectedFace === null || value.faces.slice(0, terms[0]?.includes("k") ? 2 : 1).includes(value.selectedFace));
}
