import { RulesValidationError } from "../errors";
import { analyzeCombatMovement, canonicalCombatPoint, type CanonicalCombatPoint } from "../profiles/combat-geometry";
import { sameCanonical } from "../profiles/canonical";
import { activeEncounter } from "./combat-encounters";
import { grappledBy, withoutGrapple } from "./contest";
import { footprintInsidePolygon, nextTo, sceneBoundary } from "./carry";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

/** SPEC 0004 §4 (ADR 0092): a won shove pushes the creature 5 feet straight
 * away from the one shoving it; when that spot is taken or cannot be reached,
 * it does not move. */
export type CreaturePushedPayload = {
  characterId: string;
  sceneId: string;
  byCharacterId: string;
  from: CanonicalCombatPoint;
  to: CanonicalCombatPoint;
};

export type CreaturePushPlan =
  | Readonly<{ kind: "push"; from: CanonicalCombatPoint; to: CanonicalCombatPoint }>
  | Readonly<{ kind: "blocked" }>
  | Readonly<{ kind: "unplaced" }>;

const PUSH_INCHES = 60n;

export function isCreaturePushedPayload(value: unknown): value is CreaturePushedPayload {
  return isRecord(value) && hasExactKeys(value, ["byCharacterId", "characterId", "from", "sceneId", "to"])
    && [value.byCharacterId, value.characterId, value.sceneId].every(isNonEmptyString) && value.byCharacterId !== value.characterId
    && [value.from, value.to].every(point => sameCanonical(canonicalCombatPoint(point) ?? null, point))
    && (value.from as CanonicalCombatPoint).elevation === (value.to as CanonicalCombatPoint).elevation
    && !sameCanonical(value.from, value.to);
}

/** The offset of a 5-foot push along the floor from `pusher` through
 * `target`: the vector between their centres scaled to 60 inches, each axis
 * rounded to the nearest inch, halves away from zero. Undefined when the two
 * centres coincide, so there is no direction to push in. */
export function pushOffset(pusher: CanonicalCombatPoint, target: CanonicalCombatPoint): { x: bigint; y: bigint } | undefined {
  const dx = BigInt(target.x) - BigInt(pusher.x), dy = BigInt(target.y) - BigInt(pusher.y);
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0n) return undefined;
  // round(60·d/√L) without a square root: the largest n with
  // (2n − 1)²·L ≤ (2·60·d)², which is n − ½ ≤ |60·d/√L|.
  const axis = (d: bigint) => {
    const magnitude = d < 0n ? -d : d, bound = (2n * PUSH_INCHES * magnitude) ** 2n;
    let n = PUSH_INCHES;
    while (n > 0n && (2n * n - 1n) ** 2n * lengthSquared > bound) n -= 1n;
    return d < 0n ? -n : n;
  };
  return { x: axis(dx), y: axis(dy) };
}

/** Where a 5-foot shove by `pusherId` moves `targetId` in `sceneRef`, judged
 * on the authoritative state: the spot must lie inside the scene, overlap no
 * other creature, and be reached in a straight line without crossing anything
 * impassable. Unplaced when either body or the scene geometry is missing. */
export function planCreaturePush(state: AuthoritativeWorldState, pusherId: string, targetId: string, sceneRef: string): CreaturePushPlan {
  const pusher = state.combatRuntime.entities[pusherId], target = state.combatRuntime.entities[targetId];
  const scene = state.combatRuntime.scenes[sceneRef];
  const boundary = sceneBoundary(scene);
  const pusherAt = isRecord(pusher) && pusher.sceneId === sceneRef ? canonicalCombatPoint(pusher.position) : undefined;
  const from = isRecord(target) && target.sceneId === sceneRef ? canonicalCombatPoint(target.position) : undefined;
  if (pusherAt === undefined || from === undefined || boundary === undefined || !isRecord(target.footprint)) return { kind: "unplaced" };
  const offset = pushOffset(pusherAt, from);
  if (offset === undefined) return { kind: "blocked" };
  const to: CanonicalCombatPoint = { x: (BigInt(from.x) + offset.x).toString(), y: (BigInt(from.y) + offset.y).toString(), elevation: from.elevation };
  const others = Object.values(state.combatRuntime.entities).filter((entity): entity is JsonRecord => isRecord(entity)
    && entity.sceneId === sceneRef && String(entity.id ?? entity.entityId) !== targetId);
  // analyzeCombatMovement refuses an occupied endpoint and an impassable
  // crossing; creatures passed on the way only cost movement, which a push
  // does not spend.
  const clear = footprintInsidePolygon(to, target, boundary)
    && analyzeCombatMovement({ ...target, position: from }, others, scene as JsonRecord, [from, to], new Set()).ok;
  return clear ? { kind: "push", from, to } : { kind: "blocked" };
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

/** Replays a committed push: the creature still stands where it was pushed
 * from, and the same 5-foot push from the pusher's present spot still lands
 * exactly where the event says. */
export function applyCreaturePushedEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  if (event.eventType !== "CreaturePushed") return false;
  const payload = event.payload;
  if (!isCreaturePushedPayload(payload)) throw new RulesValidationError("push:payload-invalid");
  const pushed = state.entities[payload.characterId], pusher = state.entities[payload.byCharacterId];
  if (pushed?.tenureStatus !== "active" || pusher?.tenureStatus !== "active"
    || pushed.sceneId !== payload.sceneId || pusher.sceneId !== payload.sceneId) throw new RulesValidationError("push:creature-not-present");
  if (activeEncounter(state, payload.characterId) !== undefined || activeEncounter(state, payload.byCharacterId) !== undefined) {
    throw new RulesValidationError("push:inside-encounter");
  }
  const body = state.combatRuntime.entities[payload.characterId];
  if (!isRecord(body) || body.sceneId !== payload.sceneId || !sameCanonical(canonicalCombatPoint(body.position) ?? null, payload.from)) {
    throw new RulesValidationError("push:start-changed");
  }
  const planned = planCreaturePush(state, payload.byCharacterId, payload.characterId, payload.sceneId);
  if (planned.kind !== "push" || !sameCanonical(planned.to, payload.to)) throw new RulesValidationError("push:destination-invalid");
  state.combatRuntime.entities[payload.characterId]!.position = structuredClone(payload.to);
  return true;
}
