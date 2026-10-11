import type { AuthoritativeWorldState, JsonRecord } from "./model";

/** Shared read-only encounter membership; does not invoke combat settlement. */
export function activeEncounter(state: AuthoritativeWorldState, sourceId: string): JsonRecord | undefined {
  return Object.values(state.combatRuntime.encounters).find(encounter => encounter.status !== "concluded"
    && Array.isArray(encounter.participantEntityIds) && encounter.participantEntityIds.includes(sourceId)
    && !(Array.isArray(encounter.departedEntityIds) && encounter.departedEntityIds.includes(sourceId)));
}

/** Historical participants remain for perception; only these still hold encounter membership. */
export function encounterActiveParticipants(encounter: JsonRecord): string[] {
  return (Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds : []).filter((id): id is string =>
    typeof id === "string" && !(Array.isArray(encounter.departedEntityIds) && encounter.departedEntityIds.includes(id)));
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Whom a participant is hostile to in this encounter (SPEC 0012 §3.3). */
export function encounterHostileTargets(encounter: JsonRecord, sourceId: string): string[] {
  if (!Array.isArray(encounter.hostilities)) return [];
  return [...new Set(encounter.hostilities.flatMap(relation =>
    relation !== null && typeof relation === "object" && !Array.isArray(relation)
      && Array.isArray((relation as JsonRecord).fromEntityIds) && ((relation as JsonRecord).fromEntityIds as unknown[]).includes(sourceId)
      && Array.isArray((relation as JsonRecord).toEntityIds)
      ? ((relation as JsonRecord).toEntityIds as unknown[]).filter(text) : []))].sort();
}

/** SPEC 0012 §13 (ADR 0112): a participant that can still fight -- in the
 * encounter's scene, alive, conscious and not at 0 hit points (an NPC body
 * without combat statistics yet has none to lose). A creature that is only
 * incapacitated for a while still counts; whether such a fight is over is
 * the KP's ruling. */
export function canStillFight(state: AuthoritativeWorldState, encounter: JsonRecord, entityId: string): boolean {
  if (Array.isArray(encounter.departedEntityIds) && encounter.departedEntityIds.includes(entityId)) return false;
  const body = state.combatRuntime.entities[entityId];
  if (body === undefined || body.lifeState === "dead" || body.lifeState === "unconscious") return false;
  if (text(encounter.sceneId) && body.sceneId !== encounter.sceneId) return false;
  const hitPoints = body.hitPoints;
  if (hitPoints === null || typeof hitPoints !== "object") return true;
  const current = Number((hitPoints as JsonRecord).current);
  return !Number.isFinite(current) || current > 0;
}

/** The participants that can still fight, in a stable order (ADR 0112: what
 * an automatic proposal compares against the last one put to the players). */
export function encounterParticipantsAbleToFight(state: AuthoritativeWorldState, encounter: JsonRecord): string[] {
  const participants = Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(text) : [];
  return participants.filter(id => canStillFight(state, encounter, id)).sort();
}

/** SPEC 0012 §13 (ADR 0112): what a player asked to end a fight reads: the
 * reason it is proposed, from a fixed set; the reply that tells the moment
 * comes after the answers. A native pending carries its proposal, an atomic
 * mirror only the reason. */
export function encounterConclusionQuestion(pending: JsonRecord): string {
  const proposal = pending.proposal;
  const reason = proposal !== null && typeof proposal === "object" && !Array.isArray(proposal)
    ? (proposal as JsonRecord).reason : pending.conclusionReason;
  switch (reason) {
    case "hostilesCannotContinue": return "与你们为敌的已经没有谁还能战斗。是否结束这场战斗？";
    case "hostilesDefeated": return "对手已经无力再战。是否结束这场战斗？";
    case "npcSurrendered": return "对手投降了。是否接受并结束这场战斗？";
    case "playersSurrendered": return "投降被对方接受了。是否结束这场战斗？";
    case "truceAgreed": return "对方同意停战。是否结束这场战斗？";
    case "playersEscaped": return "你已经脱离了战斗。是否结束这场战斗？";
    case "conflictNoLongerNeeded": return "这场冲突已经不必再按先攻轮流进行。是否结束这场战斗？";
    default: return "是否接受当前遭遇的收束方式？";
  }
}

/** The living player characters of an encounter, the ones who accept or
 * decline its end (SPEC 0012 §13). */
export function encounterLivingPlayers(state: AuthoritativeWorldState, encounter: JsonRecord): string[] {
  const participants = Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(text) : [];
  return participants.filter(id => !(Array.isArray(encounter.departedEntityIds) && encounter.departedEntityIds.includes(id))
    && state.combatRuntime.entities[id]?.kind === "player"
    && state.combatRuntime.entities[id]?.lifeState !== "dead");
}

/** SPEC 0012 §13 (ADR 0112): the encounter's ending candidate. It holds when
 * a player character is still alive and no other participant that can still
 * fight is hostile to a living player character, or to anyone else who can
 * still fight. Who is hostile to whom comes from the encounter's own
 * hostility record: a creature that surrendered or agreed to a truce is no
 * longer hostile. The players' own hostility does not count; whether they
 * stop is theirs to answer. */
export function encounterHostilesCannotContinue(state: AuthoritativeWorldState, encounter: JsonRecord): boolean {
  if (encounter.status === "concluded") return false;
  const players = new Set(encounterLivingPlayers(state, encounter));
  if (players.size === 0) return false;
  const participants = Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(text) : [];
  return participants.every(id => state.combatRuntime.entities[id]?.kind === "player"
    || !canStillFight(state, encounter, id)
    || encounterHostileTargets(encounter, id).every(target => target === id
      || !participants.includes(target)
      || (!players.has(target) && !canStillFight(state, encounter, target))));
}

/** SPEC 0012 §§3.3、13 (ADR 0117): whom a participant stopped fighting in this
 * encounter and has not turned on again, and the reason of its latest stop:
 * an NPC that yielded, accepted a surrender or agreed to a truce, or a player
 * character that surrendered. The HostilityChanged reducer keeps it. */
export type EncounterStandDown = Readonly<{ fromEntityIds: readonly string[]; reason: string }>;

export function encounterStandDown(encounter: JsonRecord, entityId: string): EncounterStandDown | undefined {
  const record = encounter.stoodDown;
  const entry = record !== null && typeof record === "object" && !Array.isArray(record) ? (record as JsonRecord)[entityId] : undefined;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const from = (entry as JsonRecord).fromEntityIds, reason = (entry as JsonRecord).reason;
  return Array.isArray(from) && from.every(text) && text(reason) ? { fromEntityIds: from as string[], reason } : undefined;
}

/** Folds one hostility change into `stoodDown`: those it stops fighting join
 * its entry, those it turns on leave it. A room that never saw a stand-down
 * keeps the encounter shape it had. */
export function recordEncounterStandDown(encounter: JsonRecord, sourceId: string, removed: readonly string[],
  added: readonly string[], reason: string): void {
  const record: JsonRecord = encounter.stoodDown !== null && typeof encounter.stoodDown === "object" && !Array.isArray(encounter.stoodDown)
    ? encounter.stoodDown as JsonRecord : {};
  const prior = encounterStandDown(encounter, sourceId);
  const from = [...new Set([...(prior?.fromEntityIds ?? []), ...removed])].filter(id => !added.includes(id)).sort();
  if (from.length === 0) delete record[sourceId];
  else record[sourceId] = { fromEntityIds: from, reason: removed.length > 0 ? reason : prior?.reason ?? reason };
  if (Object.keys(record).length === 0) delete encounter.stoodDown;
  else encounter.stoodDown = Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

/** Whether `entityId` stood down from `fromId` in this encounter. */
function stoodDownFrom(encounter: JsonRecord, entityId: string, fromId: string): boolean {
  return encounterStandDown(encounter, entityId)?.fromEntityIds.includes(fromId) === true;
}

/** SPEC 0012 §13 (ADR 0112, ADR 0117): the ending candidate Rules raises on
 * its own. On top of the above, someone other than a player character can no
 * longer fight (dead, unconscious, at 0 hit points or gone from the scene) or
 * has stood down from a living player character, and no living player
 * character is still hostile to a participant that can still fight, unless
 * that participant stood down from it: a player's anger at a foe that yielded
 * does not keep the question from being asked. An encounter of hazards alone,
 * or a player still attacking someone able to fight back who never fought
 * it, is not ended this way; the KP's ruling ends those. */
export function encounterFightIsOver(state: AuthoritativeWorldState, encounter: JsonRecord): boolean {
  if (!encounterHostilesCannotContinue(state, encounter)) return false;
  const participants = Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(text) : [];
  const players = encounterLivingPlayers(state, encounter);
  const departedFoes = Array.isArray(encounter.departedEntityIds) && encounter.departedEntityIds.some(id =>
    text(id) && state.combatRuntime.entities[id]?.kind !== "player");
  return (departedFoes || participants.some(id => state.combatRuntime.entities[id]?.kind !== "player"
      && (!canStillFight(state, encounter, id) || players.some(player => stoodDownFrom(encounter, id, player)))))
    && players.every(player => encounterHostileTargets(encounter, player)
      .every(target => target === player || !participants.includes(target) || !canStillFight(state, encounter, target)
        || stoodDownFrom(encounter, target, player)));
}

/** The reasons a stand-down gives the end of a fight (SPEC 0012 §13). */
const STAND_DOWN_REASONS = ["npcSurrendered", "playersSurrendered", "truceAgreed"];

/** SPEC 0012 §13 (ADR 0117): why Rules puts the end to the players on its
 * own. When foes still standing stood down from the players for one shared
 * reason (they yielded, accepted the players' surrender or agreed to a
 * truce), that reason; otherwise no one hostile can still fight. */
export function encounterConclusionReason(state: AuthoritativeWorldState, encounter: JsonRecord): string {
  const participants = Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(text) : [];
  const players = encounterLivingPlayers(state, encounter);
  const standing = participants.filter(id => state.combatRuntime.entities[id]?.kind !== "player"
    && canStillFight(state, encounter, id) && players.some(player => stoodDownFrom(encounter, id, player)));
  const reasons = [...new Set(standing.map(id => encounterStandDown(encounter, id)!.reason))];
  return reasons.length === 1 && STAND_DOWN_REASONS.includes(reasons[0]!) ? reasons[0]! : "hostilesCannotContinue";
}

/** SPEC 0012 §10.1: whether `actorId` is `sourceId` or one of its companions,
 * for an effect a harmful act by the source's side ends (SRD Charm Person).
 * In an encounter they share, a companion is a participant neither hostile
 * to the source nor its hostility target; outside one, player characters are
 * companions of each other. */
export function sourceSideIncludes(state: AuthoritativeWorldState, sourceId: string, actorId: string): boolean {
  if (actorId === sourceId) return true;
  const encounter = activeEncounter(state, sourceId);
  if (encounter !== undefined && encounterActiveParticipants(encounter).includes(actorId)) {
    return !encounterHostileTargets(encounter, sourceId).includes(actorId)
      && !encounterHostileTargets(encounter, actorId).includes(sourceId);
  }
  const kind = (id: string) => state.combatRuntime.entities[id]?.kind ?? state.entities[id]?.kind;
  return kind(sourceId) === "player" && kind(actorId) === "player";
}

/** SRD 5.1 Charm Person: whether the target is fighting the caster's side in
 * an encounter they share, which gives it advantage on the saving throw. */
export function fightingSourceSide(state: AuthoritativeWorldState, sourceId: string, targetId: string): boolean {
  const encounter = activeEncounter(state, sourceId);
  return encounter !== undefined && encounterActiveParticipants(encounter).includes(targetId)
    && (encounterHostileTargets(encounter, sourceId).includes(targetId)
      || encounterHostileTargets(encounter, targetId).includes(sourceId));
}
