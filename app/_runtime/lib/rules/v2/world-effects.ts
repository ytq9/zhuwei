import { canonicalSha256 } from "../profiles/canonical";
import { isRegisteredAbilityRecord } from "../profiles/ability-compiler";
import { COMBAT_ROUND_MICROS } from "../profiles/fiction-time";
import { combatPhaseExpiryAnchor, remainingCombatPhaseDuration } from "./effect-phase";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord } from "./model";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, hasOnlyKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { spatialRecordVisibleTo, spatialVisibilityPolicyKind } from "./spatial-visibility";

export const WORLD_EFFECT_SCHEMA = "zhuwei.condition-effect/v1" as const;
export const CONDITION_IDS = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
  "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
  "restrained", "stunned", "unconscious",
] as const;
export type ConditionId = typeof CONDITION_IDS[number];
export type WorldEffectDuration =
  | { kind: "timed"; durationMicros: string }
  | { kind: "untilEnded" }
  | { kind: "turnBoundary"; subject: "source" | "target"; edge: "turnStart" | "turnEnd" };
export type WorldEffectDefinition = {
  kind: "grantEffect";
  condition: ConditionId;
  duration: WorldEffectDuration;
  level?: number;
};
export type WorldEffectEndDefinition = {
  kind: "endEffect";
  condition: ConditionId;
  sourceRef: string | null;
};
type Expiry =
  | { kind: "fictionTime"; entityId: string; dueMicros: string }
  | { kind: "turnStart" | "turnEnd"; entityId: string; encounterId: string; targetRound: number;
      initiativeOrderHash: string; slotIndex: number; entryCount: number;
      createdAt: { rootActionId: string; roundIndex: number; initiativeOrderHash: string;
        slotIndex: number; edge: "turnStart" | "turnEnd" } }
  | null;
type Suspension = {
  startedAtFictionMicros: string;
  remainingMicros: string | null;
  remainingBoundaries: number | null;
} | null;
export type WorldEffectRecord = JsonRecord & {
  schema: typeof WORLD_EFFECT_SCHEMA;
  effectId: string;
  kind: "condition";
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  condition: ConditionId;
  level: number | null;
  duration: WorldEffectDuration;
  startedAtFictionMicros: string;
  pausedMicros: string;
  suspension: Suspension;
  expiresAt: Expiry;
  visibilityPolicyId: string;
  visibilityFactId: string | null;
};
export type WorldEffectEndDraft = {
  eventType: "EffectEnded";
  payload: { effectId: string; targetEntityId: string; reason: string };
  visibilityPolicyId: string;
  secrecy: "internal";
};

function unsignedMicros(value: unknown, positive = false): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
    && (!positive || value !== "0");
}

function conditionId(value: unknown): value is ConditionId {
  return typeof value === "string" && (CONDITION_IDS as readonly string[]).includes(value);
}

export function isConditionImmunities(value: unknown): value is ConditionId[] {
  return Array.isArray(value) && value.every(conditionId)
    && value.length === new Set(value).size
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

export function isWorldEffectDuration(value: unknown): value is WorldEffectDuration {
  if (!isRecord(value)) return false;
  if (value.kind === "untilEnded") return hasExactKeys(value, ["kind"]);
  if (value.kind === "timed") {
    return hasExactKeys(value, ["durationMicros", "kind"])
      && unsignedMicros(value.durationMicros, true);
  }
  return hasExactKeys(value, ["edge", "kind", "subject"])
    && value.kind === "turnBoundary"
    && (value.subject === "source" || value.subject === "target")
    && (value.edge === "turnStart" || value.edge === "turnEnd");
}

/** The Ability Effect family owns this shape; a hazard only references it. */
export function worldEffectDefinition(value: unknown): WorldEffectDefinition | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["condition", "duration", "kind"], ["level"])
    || value.kind !== "grantEffect" || !conditionId(value.condition)
    || !isWorldEffectDuration(value.duration)) return undefined;
  if (value.condition === "exhaustion"
    ? !Number.isSafeInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 6
    : value.level !== undefined) return undefined;
  return structuredClone(value) as WorldEffectDefinition;
}

export function worldEffectEndDefinition(value: unknown): WorldEffectEndDefinition | undefined {
  return isRecord(value) && hasExactKeys(value, ["condition", "kind", "sourceRef"])
    && value.kind === "endEffect" && conditionId(value.condition)
    && (value.sourceRef === null || isNonEmptyString(value.sourceRef))
    ? structuredClone(value) as WorldEffectEndDefinition : undefined;
}

export function isWorldEffectRecordCandidate(value: unknown): boolean {
  return isRecord(value) && value.schema === WORLD_EFFECT_SCHEMA;
}

function registeredEffectMatches(
  state: AuthoritativeWorldState, sourceDefinitionRef: string,
  definition: WorldEffectDefinition | WorldEffectEndDefinition,
): boolean {
  const source = state.campaignRuntime.definitions[sourceDefinitionRef]
    ?? state.combatRuntime.definitions[sourceDefinitionRef];
  if (!isRegisteredAbilityRecord(source) || !isRecord(source.mechanicGraph)
    || !Array.isArray(source.mechanicGraph.operations)) return false;
  return source.mechanicGraph.operations.some((operation) => {
    if (!isRecord(operation) || operation.family !== "Effect" || !isRecord(operation.input)) return false;
    const input = operation.input.effect ?? operation.input;
    const frozen = worldEffectDefinition(input) ?? worldEffectEndDefinition(input);
    return frozen !== undefined && canonicalSha256(frozen) === canonicalSha256(definition);
  });
}

function validExpiry(value: unknown): value is Expiry {
  if (value === null) return true;
  if (!isRecord(value) || !isNonEmptyString(value.entityId)) return false;
  if (value.kind === "fictionTime") {
    return hasExactKeys(value, ["dueMicros", "entityId", "kind"])
      && unsignedMicros(value.dueMicros);
  }
  return hasExactKeys(value, ["createdAt", "encounterId", "entityId", "entryCount", "initiativeOrderHash", "kind", "slotIndex", "targetRound"])
    && (value.kind === "turnStart" || value.kind === "turnEnd")
    && isNonEmptyString(value.encounterId)
    && Number.isSafeInteger(value.targetRound) && Number(value.targetRound) >= 1
    && isSha256(value.initiativeOrderHash)
    && Number.isSafeInteger(value.entryCount) && Number(value.entryCount) >= 1
    && Number.isSafeInteger(value.slotIndex) && Number(value.slotIndex) >= 0
    && Number(value.slotIndex) < Number(value.entryCount)
    && isRecord(value.createdAt)
    && hasExactKeys(value.createdAt, ["edge", "initiativeOrderHash", "rootActionId", "roundIndex", "slotIndex"])
    && isNonEmptyString(value.createdAt.rootActionId)
    && value.createdAt.initiativeOrderHash === value.initiativeOrderHash
    && Number.isSafeInteger(value.createdAt.roundIndex) && Number(value.createdAt.roundIndex) >= 1
    && Number.isSafeInteger(value.createdAt.slotIndex) && Number(value.createdAt.slotIndex) >= 0
    && Number(value.createdAt.slotIndex) < Number(value.entryCount)
    && (value.createdAt.edge === "turnStart" || value.createdAt.edge === "turnEnd");
}

export function isWorldEffectRecord(value: unknown): value is WorldEffectRecord {
  if (!isRecord(value) || !hasExactKeys(value, [
    "condition", "duration", "effectId", "expiresAt", "kind", "level", "schema",
    "sourceDefinitionRef", "sourceRef", "startedAtFictionMicros", "targetEntityId", "pausedMicros", "suspension",
    "visibilityFactId", "visibilityPolicyId",
  ]) || value.schema !== WORLD_EFFECT_SCHEMA || value.kind !== "condition"
    || ![value.effectId, value.sourceRef, value.sourceDefinitionRef, value.targetEntityId]
      .every(isNonEmptyString)
    || !unsignedMicros(value.startedAtFictionMicros) || !unsignedMicros(value.pausedMicros)
    || !validExpiry(value.expiresAt)
    || spatialVisibilityPolicyKind(value.visibilityPolicyId) === undefined
    || !(value.visibilityFactId === null || isNonEmptyString(value.visibilityFactId))) return false;
  const definition = worldEffectDefinition({
    kind: "grantEffect", condition: value.condition, duration: value.duration,
    ...(value.level === null ? {} : { level: value.level }),
  });
  if (definition === undefined) return false;
  if (definition.condition !== "poisoned" && (value.pausedMicros !== "0" || value.suspension !== null)) return false;
  if (value.suspension !== null) {
    const suspended = value.suspension;
    if (!isRecord(suspended) || !hasExactKeys(suspended,
      ["remainingBoundaries", "remainingMicros", "startedAtFictionMicros"])
      || !unsignedMicros(suspended.startedAtFictionMicros)
      || BigInt(suspended.startedAtFictionMicros) < BigInt(value.startedAtFictionMicros)
      || (value.expiresAt === null
        ? suspended.remainingMicros !== null
        : !unsignedMicros(suspended.remainingMicros))
      || (value.expiresAt === null || value.expiresAt.kind === "fictionTime"
        ? suspended.remainingBoundaries !== null
        : !Number.isSafeInteger(suspended.remainingBoundaries) || Number(suspended.remainingBoundaries) < 0)) return false;
  }
  if (value.visibilityPolicyId === "visibility:hidden-until-evidence"
    && !isNonEmptyString(value.visibilityFactId)) return false;
  if (definition.duration.kind === "untilEnded") return value.expiresAt === null;
  if (value.expiresAt === null) return false;
  if (definition.duration.kind === "timed") {
    return value.expiresAt.kind === "fictionTime"
      && value.expiresAt.entityId === value.targetEntityId
      && BigInt(value.expiresAt.dueMicros)
        === BigInt(value.startedAtFictionMicros) + BigInt(definition.duration.durationMicros) + BigInt(value.pausedMicros);
  }
  const expectedSubject = definition.duration.subject === "target"
    ? value.targetEntityId : value.sourceRef;
  return value.expiresAt.entityId === expectedSubject
    && (value.expiresAt.kind === definition.duration.edge
      || value.expiresAt.kind === "fictionTime");
}

export function entityConditionImmune(
  state: AuthoritativeWorldState, entityId: string, condition: ConditionId,
): boolean {
  const core = state.entities[entityId] as unknown as JsonRecord | undefined;
  const combat = state.combatRuntime.entities[entityId];
  return (condition === "poisoned" && effectiveConditions(state, entityId).petrified === true)
    || [core?.conditionImmunities, combat?.conditionImmunities].some((value) =>
    Array.isArray(value) && value.includes(condition));
}

function entityInstant(state: AuthoritativeWorldState, entityId: string): string | undefined {
  const timelineId = characterTimelineId(state, entityId);
  return timelineId === undefined ? undefined : state.fictionTimelines[timelineId]?.nowMicros;
}

function expiryFor(
  state: AuthoritativeWorldState, targetEntityId: string, sourceRef: string,
  duration: WorldEffectDuration, startedAtFictionMicros: string, rootActionId: string,
): Expiry | undefined {
  if (duration.kind === "untilEnded") return null;
  if (duration.kind === "timed") return {
    kind: "fictionTime", entityId: targetEntityId,
    dueMicros: (BigInt(startedAtFictionMicros) + BigInt(duration.durationMicros)).toString(),
  };
  const entityId = duration.subject === "target" ? targetEntityId : sourceRef;
  if (state.entities[entityId] === undefined && state.combatRuntime.entities[entityId] === undefined) {
    return undefined;
  }
  const encounter = Object.values(state.combatRuntime.encounters).find((entry) =>
    entry.status !== "concluded" && Array.isArray(entry.participantEntityIds)
      && entry.participantEntityIds.includes(entityId));
  // Outside initiative, one turn is the registered six seconds of fiction.
  if (encounter === undefined) {
    const now = entityInstant(state, entityId);
    return now === undefined ? undefined : {
      kind: "fictionTime", entityId, dueMicros: (BigInt(now) + COMBAT_ROUND_MICROS).toString(),
    };
  }
  const anchor = { ...combatPhaseExpiryAnchor(state, entityId, duration.edge, rootActionId),
    encounterId: String(encounter.encounterId) };
  return validExpiry(anchor) ? anchor : undefined;
}

export function planWorldEffect(state: AuthoritativeWorldState, input: {
  rootActionId: string;
  sourceRef: string;
  sourceDefinitionRef: string;
  targetEntityId: string;
  effect: unknown;
  index: number;
  occurrenceKey?: string;
  visibilityPolicyId?: string;
  visibilityFactId?: string;
}): { kind: "applied"; effectRecord: WorldEffectRecord }
  | { kind: "immune"; condition: ConditionId }
  | { kind: "rejected"; message: string } {
  const definition = worldEffectDefinition(input.effect);
  const now = entityInstant(state, input.targetEntityId);
  if (definition === undefined || now === undefined
    || ![input.rootActionId, input.sourceRef, input.sourceDefinitionRef, input.targetEntityId]
      .every(isNonEmptyString)
    || !Number.isSafeInteger(input.index) || input.index < 0
    || !registeredEffectMatches(state, input.sourceDefinitionRef, definition)
    || (state.entities[input.targetEntityId] === undefined
      && state.combatRuntime.entities[input.targetEntityId] === undefined)) {
    return { kind: "rejected", message: "The condition effect or its target is unavailable." };
  }
  if (entityConditionImmune(state, input.targetEntityId, definition.condition)) {
    return { kind: "immune", condition: definition.condition };
  }
  const expiresAt = expiryFor(state, input.targetEntityId, input.sourceRef, definition.duration, now, input.rootActionId);
  if (expiresAt === undefined) return { kind: "rejected", message: "The effect duration has no authoritative subject." };
  const effectRecord: WorldEffectRecord = {
    schema: WORLD_EFFECT_SCHEMA,
    effectId: `effect:${canonicalSha256({ rootActionId: input.rootActionId,
      sourceRef: input.sourceRef, sourceDefinitionRef: input.sourceDefinitionRef,
      targetEntityId: input.targetEntityId, index: input.index, ...(input.occurrenceKey===undefined?{}:{occurrenceKey:input.occurrenceKey}) }).slice("sha256:".length)}`,
    kind: "condition", sourceRef: input.sourceRef, sourceDefinitionRef: input.sourceDefinitionRef,
    targetEntityId: input.targetEntityId, condition: definition.condition,
    level: definition.level ?? null, duration: definition.duration, startedAtFictionMicros: now,
    pausedMicros: "0", suspension: null,
    expiresAt, visibilityPolicyId: input.visibilityPolicyId ?? "visibility:scene-observers",
    visibilityFactId: input.visibilityFactId ?? null,
  };
  if (!isWorldEffectRecord(effectRecord) || state.combatRuntime.effects[effectRecord.effectId] !== undefined) {
    return { kind: "rejected", message: "The condition effect identity or visibility is invalid." };
  }
  return { kind: "applied", effectRecord };
}

/** Effect records are the single source for granted conditions. Existing
 * native conditions remain independent: ending a grant never clears a fall,
 * injury, or another still-active source of the same condition. */
export function effectiveConditions(
  state: AuthoritativeWorldState, entityId: string, viewerCharacterId?: string,
): JsonRecord {
  const native = state.combatRuntime.entities[entityId]?.conditions;
  const result: JsonRecord = isRecord(native) ? structuredClone(native) : {};
  for (const effect of Object.values(state.combatRuntime.effects)) {
    if (!isWorldEffectRecord(effect) || effect.targetEntityId !== entityId
      || (viewerCharacterId !== undefined && !spatialRecordVisibleTo(state, effect, viewerCharacterId))) continue;
    if (effect.condition === "exhaustion") {
      result.exhaustion = String(Math.min(6, Number(result.exhaustion ?? 0) + effect.level!));
    } else result[effect.condition] = true;
    if (effect.condition === "grappled" && !isNonEmptyString(result.grappledBy)) {
      result.grappledBy = effect.sourceRef;
    }
  }
  if (result.paralyzed === true || result.stunned === true || result.unconscious === true
    || result.petrified === true) result.incapacitated = true;
  if (result.unconscious === true) result.prone = true;
  if (result.petrified === true) delete result.poisoned;
  return result;
}

export function worldEffectIds(state: AuthoritativeWorldState, input: {
  targetEntityId: string; condition?: ConditionId; sourceRef?: string;
}): string[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect) => isWorldEffectRecord(effect)
      && effect.targetEntityId === input.targetEntityId
      && (input.condition === undefined || effect.condition === input.condition)
      && (input.sourceRef === undefined || effect.sourceRef === input.sourceRef))
    .map((effect) => String(effect.effectId)).sort();
}

/** Read-only mechanical/projection view. Never persist this derived record as
 * an entity patch; native conditions and granted sources must stay separate. */
export function effectiveConditionEntity(
  state: AuthoritativeWorldState, entityId: string, entity: JsonRecord, viewerCharacterId?: string,
): JsonRecord {
  return { ...entity, conditions: effectiveConditions(state, entityId, viewerCharacterId) };
}

export function worldEffectEndDrafts(
  state: AuthoritativeWorldState, effectIds: readonly string[], reason: string,
): WorldEffectEndDraft[] {
  if (!isNonEmptyString(reason)) throw new TypeError("Effect ending requires a reason.");
  return [...new Set(effectIds)].sort().flatMap((effectId) => {
    const effect = state.combatRuntime.effects[effectId];
    return !isWorldEffectRecord(effect) ? [] : [{
      eventType: "EffectEnded" as const,
      payload: { effectId, targetEntityId: effect.targetEntityId, reason },
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" as const,
    }];
  });
}

/** A frozen Ability may end grants only within its selected target and the
 * condition/source selector in its Effect operation. Native conditions are
 * independent facts and are never erased as a side effect of ending a grant. */
export function planWorldEffectEnd(state: AuthoritativeWorldState, input: {
  sourceDefinitionRef: string;
  targetEntityId: string;
  effect: unknown;
}): { kind: "ended"; effectIds: string[]; drafts: WorldEffectEndDraft[] }
  | { kind: "rejected"; message: string } {
  const definition = worldEffectEndDefinition(input.effect);
  if (definition === undefined
    || !isNonEmptyString(input.targetEntityId)
    || (state.entities[input.targetEntityId] === undefined
      && state.combatRuntime.entities[input.targetEntityId] === undefined)
    || !registeredEffectMatches(state, input.sourceDefinitionRef, definition)) {
    return { kind: "rejected", message: "The ending effect does not match its frozen Ability and target." };
  }
  const effectIds = worldEffectIds(state, { targetEntityId: input.targetEntityId,
    condition: definition.condition,
    ...(definition.sourceRef === null ? {} : { sourceRef: definition.sourceRef }),
  });
  return { kind: "ended", effectIds, drafts: worldEffectEndDrafts(state, effectIds, "abilityEffectEnded") };
}

function residualExpiryMicros(state: AuthoritativeWorldState, effect: WorldEffectRecord): string | undefined {
  if (effect.expiresAt === null || effect.expiresAt.kind === "fictionTime") return undefined;
  const tasks = state.combatRuntime.encounters[effect.expiresAt.encounterId]?.residualPhaseTasks;
  const task = Array.isArray(tasks) ? tasks.find((entry) => isRecord(entry) && entry.effectId === effect.effectId) : undefined;
  return isRecord(task) && unsignedMicros(task.dueMicros) ? task.dueMicros : undefined;
}

/** A deterministic consequence of changing the petrified condition. Native
 * ConditionChanged/HP folds call this too; EffectApplied/Ended call it below.
 * No new poison can enter while stone, and existing sources are never erased. */
export function synchronizeWorldEffectSuspensions(
  state: AuthoritativeWorldState, targetEntityId: string, transitionInstantMicros?: string,
): void {
  const petrified = effectiveConditions(state, targetEntityId).petrified === true;
  for (const effect of Object.values(state.combatRuntime.effects)) {
    if (!isWorldEffectRecord(effect) || effect.targetEntityId !== targetEntityId || effect.condition !== "poisoned") continue;
    const clockEntity = effect.expiresAt?.entityId ?? targetEntityId;
    const observedNow = entityInstant(state, clockEntity);
    const sameTimeline = characterTimelineId(state, clockEntity) === characterTimelineId(state, targetEntityId);
    const now = transitionInstantMicros !== undefined && sameTimeline ? transitionInstantMicros : observedNow;
    if (now === undefined || !unsignedMicros(now)) throw new TypeError("A suspended poison needs its authoritative fiction clock.");
    if (petrified && effect.suspension === null) {
      let remainingMicros: string | null = null;
      let remainingBoundaries: number | null = null;
      if (effect.expiresAt !== null) {
        if (effect.expiresAt.kind === "fictionTime") {
          const remaining = BigInt(effect.expiresAt.dueMicros) - BigInt(now);
          remainingMicros = (remaining > 0n ? remaining : 0n).toString();
        } else {
          const residual = residualExpiryMicros(state, effect);
          if (residual !== undefined) {
            const remaining = BigInt(residual) - BigInt(now);
            remainingMicros = (remaining > 0n ? remaining : 0n).toString();
            // The Encounter already mapped this phase to fiction time.
            effect.expiresAt = { kind: "fictionTime", entityId: clockEntity, dueMicros: residual };
          } else {
            const remaining = remainingCombatPhaseDuration(state, effect.expiresAt);
            if (remaining === undefined) throw new TypeError("A suspended poison lost its frozen phase anchor.");
            ({ remainingMicros, remainingBoundaries } = remaining);
          }
        }
      }
      effect.suspension = { startedAtFictionMicros: now, remainingMicros, remainingBoundaries };
      for (const encounter of Object.values(state.combatRuntime.encounters)) {
        if (Array.isArray(encounter.residualPhaseTasks)) encounter.residualPhaseTasks =
          encounter.residualPhaseTasks.filter((task) => !isRecord(task) || task.effectId !== effect.effectId);
      }
    } else if (!petrified && effect.suspension !== null) {
      const suspended = effect.suspension;
      const elapsed = BigInt(now) - BigInt(suspended.startedAtFictionMicros);
      if (elapsed < 0n) throw new TypeError("A poison suspension cannot resume before it began.");
      effect.pausedMicros = (BigInt(effect.pausedMicros) + elapsed).toString();
      if (effect.expiresAt !== null && suspended.remainingMicros !== null) {
        const expiry = effect.expiresAt;
        if (expiry.kind === "fictionTime") {
          effect.expiresAt = { ...expiry, dueMicros: (BigInt(expiry.dueMicros) + elapsed).toString() };
        } else {
          const encounter = state.combatRuntime.encounters[expiry.encounterId];
          if (encounter?.status !== "concluded" && (suspended.remainingBoundaries ?? 0) > 0) {
            const anchor = { ...combatPhaseExpiryAnchor(state, expiry.entityId, expiry.kind,
              expiry.createdAt.rootActionId), encounterId: expiry.encounterId };
            if (!validExpiry(anchor) || anchor === null) {
              throw new TypeError("A resumed poison lost its authoritative phase subject.");
            }
            // Preserve the original creation cause and frozen ordering. Only
            // the remaining number of subject boundaries is rescheduled.
            effect.expiresAt = { ...expiry, targetRound: anchor.targetRound + suspended.remainingBoundaries! - 1 };
          } else {
            effect.expiresAt = { kind: "fictionTime", entityId: expiry.entityId,
              dueMicros: (BigInt(now) + BigInt(suspended.remainingMicros)).toString() };
          }
        }
      }
      effect.suspension = null;
    }
  }
}

export function scheduledWorldEffectDeadlines(state: AuthoritativeWorldState, input: {
  timelineId?: string;
  turn?: { entityId: string; edge: "turnStart" | "turnEnd"; round: number; encounterId: string };
} = {}): { effectId: string; timelineId: string; dueMicros: string }[] {
  return Object.values(state.combatRuntime.effects).flatMap((effect) => {
    if (!isWorldEffectRecord(effect) || effect.expiresAt === null || effect.suspension !== null) return [];
    const expiry = effect.expiresAt;
    const timelineId = characterTimelineId(state, expiry.entityId);
    const now = timelineId === undefined ? undefined : state.fictionTimelines[timelineId]?.nowMicros;
    if (now === undefined || (input.timelineId !== undefined && input.timelineId !== timelineId)) return [];
    let dueMicros: string | undefined;
    if (expiry.kind === "fictionTime") dueMicros = expiry.dueMicros;
    else {
      const remaining = remainingCombatPhaseDuration(state, expiry);
      const explicitBoundary = input.turn !== undefined && expiry.entityId === input.turn.entityId
        && expiry.kind === input.turn.edge && expiry.encounterId === input.turn.encounterId
        && expiry.targetRound <= input.turn.round;
      dueMicros = explicitBoundary || remaining?.remainingBoundaries === 0
        ? now : residualExpiryMicros(state, effect);
    }
    return dueMicros !== undefined && timelineId !== undefined
      ? [{ effectId: effect.effectId, timelineId, dueMicros }] : [];
  }).sort((left, right) => BigInt(left.dueMicros) < BigInt(right.dueMicros) ? -1
    : BigInt(left.dueMicros) > BigInt(right.dueMicros) ? 1 : left.effectId.localeCompare(right.effectId));
}

export function dueWorldEffectDrafts(state: AuthoritativeWorldState, input: {
  timelineId?: string;
  turn?: { entityId: string; edge: "turnStart" | "turnEnd"; round: number; encounterId: string };
} = {}): WorldEffectEndDraft[] {
  const due = scheduledWorldEffectDeadlines(state, input)
    .filter(deadline => BigInt(state.fictionTimelines[deadline.timelineId].nowMicros) >= BigInt(deadline.dueMicros));
  // The authoritative sequencer asks again after EffectEnded. One deadline at
  // a time lets petrification resume poison before later deadlines are chosen.
  return worldEffectEndDrafts(state, due.length === 0 ? [] : [due[0].effectId], "durationExpired");
}

/** Called before the combat-story guard, since effects can predate an Encounter. */
export function applyWorldEffectEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  const payload = event.payload as JsonRecord;
  if (event.eventType === "EffectApplied" && isWorldEffectRecordCandidate(payload.effect)) {
    const effect = payload.effect;
    if (!isWorldEffectRecord(effect) || state.combatRuntime.effects[effect.effectId] !== undefined
      || effect.pausedMicros !== "0" || effect.suspension !== null
      || (state.entities[effect.targetEntityId] === undefined
        && state.combatRuntime.entities[effect.targetEntityId] === undefined)
      || entityConditionImmune(state, effect.targetEntityId, effect.condition)
      || entityInstant(state, effect.targetEntityId) !== effect.startedAtFictionMicros
      || canonicalSha256(effect.expiresAt) !== canonicalSha256(expiryFor(state,
        effect.targetEntityId, effect.sourceRef, effect.duration, effect.startedAtFictionMicros, event.rootActionId))
      || !registeredEffectMatches(state, effect.sourceDefinitionRef, {
        kind: "grantEffect", condition: effect.condition, duration: effect.duration,
        ...(effect.level === null ? {} : { level: effect.level }),
      })) {
      throw new TypeError("Condition effect does not match its frozen authoritative target.");
    }
    state.combatRuntime.effects[effect.effectId] = structuredClone(effect);
    synchronizeWorldEffectSuspensions(state, effect.targetEntityId);
    return true;
  }
  if (event.eventType === "EffectEnded") {
    const effect = state.combatRuntime.effects[String(payload.effectId)];
    if (!isWorldEffectRecord(effect)) return false;
    if (payload.targetEntityId !== effect.targetEntityId || !isNonEmptyString(payload.reason)) {
      throw new TypeError("Condition effect ending has a different target.");
    }
    if (effect.suspension !== null && ["durationExpired", "encounterPhaseDue"].includes(String(payload.reason))) {
      throw new TypeError("A suspended poison cannot expire before it resumes.");
    }
    const dueInstant = ["durationExpired", "encounterPhaseDue"].includes(String(payload.reason))
      ? effect.expiresAt?.kind === "fictionTime" ? effect.expiresAt.dueMicros : residualExpiryMicros(state, effect)
      : undefined;
    delete state.combatRuntime.effects[effect.effectId];
    for (const encounter of Object.values(state.combatRuntime.encounters)) {
      if (Array.isArray(encounter.residualPhaseTasks)) encounter.residualPhaseTasks =
        encounter.residualPhaseTasks.filter((task) => !isRecord(task) || task.effectId !== effect.effectId);
    }
    synchronizeWorldEffectSuspensions(state, effect.targetEntityId, dueInstant);
    return true;
  }
  return false;
}
