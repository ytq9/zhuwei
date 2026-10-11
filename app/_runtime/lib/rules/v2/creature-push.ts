import { RulesValidationError } from "../errors";
import { analyzeCombatMovement, canonicalCombatPoint, type CanonicalCombatPoint } from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { grappledBy, withoutGrapple } from "./contest";
import { footprintInsidePolygon, nextTo, sceneBoundary } from "./carry";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0004 §4 (ADR 0092): a won shove pushes the creature 5 feet straight
 * away from the one shoving it; when that spot is taken or cannot be reached,
 * it does not move. ADR 0149: a spell such as Thunderwave pushes farther,
 * `distanceInches`; the creature goes as far as it can of that, in 5-foot
 * steps. Without the field the push is 5 feet. */
export type CreaturePushedPayload = {
  characterId: string;
  sceneId: string;
  byCharacterId: string;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
  distanceInches?: string;
};

export type CreaturePushPlan =
  | Readonly<{ kind: "push"; from: CanonicalCombatPoint; to: CanonicalCombatPoint }>
  | Readonly<{ kind: "blocked" }>
  | Readonly<{ kind: "unplaced" }>;

const PUSH_INCHES = 60n;
const MAXIMUM_PUSH_INCHES = 1_200n;

/** A push distance a payload may carry: whole 5-foot steps, up to 100 feet. */
function pushDistance(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const inches = BigInt(value);
  return inches % PUSH_INCHES === 0n && inches <= MAXIMUM_PUSH_INCHES ? inches : undefined;
}

export function isCreaturePushedPayload(value: unknown): value is CreaturePushedPayload {
  return isRecord(value)
    && (hasExactKeys(value, ["byCharacterId", "characterId", "from", "sceneId", "to"])
      || (hasExactKeys(value, ["byCharacterId", "characterId", "distanceInches", "from", "sceneId", "to"])
        && pushDistance(value.distanceInches) !== undefined))
    && [value.byCharacterId, value.characterId, value.sceneId].every(isNonEmptyString) && value.byCharacterId !== value.characterId
    && [value.from, value.to].every(point => sameCanonical(canonicalCombatPoint(point) ?? null, point))
    && (value.from as CanonicalCombatPoint).elevation === (value.to as CanonicalCombatPoint).elevation
    && !sameCanonical(value.from, value.to);
}

/** The offset of a push along the floor from `pusher` through `target`: the
 * vector between their centres scaled to `distance` inches (5 feet unless
 * given), each axis rounded to the nearest inch, halves away from zero.
 * Undefined when the two centres coincide, so there is no direction to push in. */
export function pushOffset(pusher: CanonicalCombatPoint, target: CanonicalCombatPoint, distance: bigint = PUSH_INCHES): { x: bigint; y: bigint } | undefined {
  const dx = BigInt(target.x) - BigInt(pusher.x), dy = BigInt(target.y) - BigInt(pusher.y);
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0n) return undefined;
  // round(D·d/√L) without a square root: the largest n with
  // (2n − 1)²·L ≤ (2·D·d)², which is n − ½ ≤ |D·d/√L|.
  const axis = (d: bigint) => {
    const magnitude = d < 0n ? -d : d, bound = (2n * distance * magnitude) ** 2n;
    let n = distance;
    while (n > 0n && (2n * n - 1n) ** 2n * lengthSquared > bound) n -= 1n;
    return d < 0n ? -n : n;
  };
  return { x: axis(dx), y: axis(dy) };
}

/** Where a push of up to `distance` inches (a 5-foot shove unless given) by
 * `pusherId` moves `targetId` in `sceneRef`, judged on the authoritative
 * state: the spot must lie inside the scene, overlap no other creature, and
 * be reached in a straight line without crossing anything impassable. A
 * longer push stops at the farthest 5-foot step that is clear. Unplaced when
 * either body or the scene geometry is missing. */
export function planCreaturePush(state: AuthoritativeWorldState, pusherId: string, targetId: string, sceneRef: string,
  distance: bigint = PUSH_INCHES): CreaturePushPlan {
  const pusher = state.combatRuntime.entities[pusherId], target = state.combatRuntime.entities[targetId];
  const scene = state.combatRuntime.scenes[sceneRef];
  const boundary = sceneBoundary(scene);
  const pusherAt = isRecord(pusher) && pusher.sceneId === sceneRef ? canonicalCombatPoint(pusher.position) : undefined;
  const from = isRecord(target) && target.sceneId === sceneRef ? canonicalCombatPoint(target.position) : undefined;
  if (pusherAt === undefined || from === undefined || boundary === undefined || !isRecord(target.footprint)) return { kind: "unplaced" };
  const others = Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
    && entity.sceneId === sceneRef && String(entity.id ?? entity.entityId) !== targetId);
  for (let reach = distance; reach >= PUSH_INCHES; reach -= PUSH_INCHES) {
    const offset = pushOffset(pusherAt, from, reach);
    if (offset === undefined) return { kind: "blocked" };
    const to: CanonicalCombatPoint = { x: (BigInt(from.x) + offset.x).toString(), y: (BigInt(from.y) + offset.y).toString(), elevation: from.elevation };
    // analyzeCombatMovement refuses an occupied endpoint and an impassable
    // crossing; creatures passed on the way only cost movement, which a push
    // does not spend.
    if (footprintInsidePolygon(to, target, boundary)
      && analyzeCombatMovement({ ...target, position: from }, others, scene as JsonRecord, [from, to], new Set()).ok) {
      return { kind: "push", from, to };
    }
  }
  return { kind: "blocked" };
}

/** SRD 5.1 Thunderwave (ADR 0149): a spell effect `push-N` pushes a creature
 * that fails the spell's save N feet straight away from the caster. The feet,
 * or undefined when the effect is not such a push. */
export function savePushFeet(effect: unknown): number | undefined {
  if (!isRecord(effect) || effect.kind !== "movement" || typeof effect.tag !== "string") return undefined;
  const feet = Number(effect.value);
  return Number.isSafeInteger(feet) && feet > 0 && feet % 5 === 0 && feet <= 100 && effect.tag === `push-${feet}` ? feet : undefined;
}

/** SRD 5.1: a grapple ends when an effect takes the grappled creature out of
 * the grappler's reach. A push moves only one body, so every grapple it is
 * part of -- whether it is held or holding -- is checked again at the new
 * spot, and those whose two creatures are no longer within 5 feet end. The
 * pushed creature is never dragged along with its grappler, nor does it drag
 * whoever it holds: that is the mover's choice when it moves itself (SPEC
 * 0014 §4, ADR 0090), not an outside force's. Returns the ConditionChanged
 * payloads, in code-unit order of the creature released. */
export function grapplesEndedByPush(state: AuthoritativeWorldState, targetId: string): { entityId: string; conditions: JsonRecord }[] {
  const body = (id: string) => state.combatRuntime.entities[id];
  const separated = (left: string, right: string) => {
    const a = body(left), b = body(right);
    return !isRecord(a) || !isRecord(b) || a.sceneId !== b.sceneId || !nextTo(a, b);
  };
  const released = new Set<string>();
  const target = body(targetId);
  const holder = isRecord(target) && isRecord(target.conditions) ? target.conditions.grappledBy : undefined;
  if (isNonEmptyString(holder) && separated(targetId, holder)) released.add(targetId);
  for (const heldId of grappledBy(state, targetId)) if (separated(heldId, targetId)) released.add(heldId);
  return [...released].sort().map(entityId => ({ entityId, conditions: withoutGrapple(body(entityId)!.conditions) }));
}

/** Replays a committed push, from a world interaction, a shove on the combat
 * map or a spell: the creature still stands where it was pushed from, and the
 * same push from the pusher's present spot still lands exactly where the
 * event says. */
export function applyCreaturePushedEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CreaturePushed") return false;
  const payload = event.payload;
  if (!isCreaturePushedPayload(payload)) throw new RulesValidationError("push:payload-invalid");
  // A character must be present in the scene; a creature that exists only in
  // the encounter (ADR 0092: shoved away from the combat map) is judged by its body.
  const present = (id: string) => {
    const character = state.entities[id], body = state.combatRuntime.entities[id];
    return character === undefined ? isRecord(body) && body.sceneId === payload.sceneId
      : character.tenureStatus === "active" && character.sceneId === payload.sceneId;
  };
  if (!present(payload.characterId) || !present(payload.byCharacterId)) throw new RulesValidationError("push:creature-not-present");
  const body = state.combatRuntime.entities[payload.characterId];
  if (!isRecord(body) || body.sceneId !== payload.sceneId || !sameCanonical(canonicalCombatPoint(body.position) ?? null, payload.from)) {
    throw new RulesValidationError("push:start-changed");
  }
  const planned = planCreaturePush(state, payload.byCharacterId, payload.characterId, payload.sceneId,
    payload.distanceInches === undefined ? PUSH_INCHES : pushDistance(payload.distanceInches)!);
  if (planned.kind !== "push" || !sameCanonical(planned.to, payload.to)) throw new RulesValidationError("push:destination-invalid");
  state.combatRuntime.entities[payload.characterId]!.position = structuredClone(payload.to);
  return true;
}
