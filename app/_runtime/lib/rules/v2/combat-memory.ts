import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import { activeEncounter } from "./combat-encounters";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

/** SPEC 0012 §13 (ADR 0118): what each NPC taking part in a fight perceived
 * of it, kept on the encounter while it runs and told to that NPC as one
 * memory when the fight ends. A fight's events are perceived by the
 * creatures in it that are aware at the moment -- in the encounter's scene,
 * alive, conscious and above 0 hit points -- the way combat observers in the
 * scene see them (`visibility:combat-observers`); an NPC that is out or gone
 * perceives nothing more. Only what concerns the NPC itself is kept: who
 * attacked it and whom it attacked, how often and how often it landed, who
 * downed whom between them, and who stopped or started being hostile between
 * it and others. The ledger holds one entry per other creature, so a long
 * fight does not make it, or the memory, longer. */
const LEDGER = "fightMemory";
/** Lines per kind in the told memory; the rest are counted. */
const MAX_LINES = 6;

type Tally = { times: number; landed: number; downed: boolean };
type HostilityNote = { change: "ceased" | "began"; reason: string };
type NpcLedger = {
  struck: Record<string, Tally>;
  struckBy: Record<string, Tally>;
  /** `self:<ref>` its own change toward ref; `other:<ref>` ref's toward it. */
  hostility: Record<string, HostilityNote>;
};
type Ledger = {
  /** The creature acting and its targets, for the resolution being consumed. */
  resolving?: { resolutionId: string; sourceEntityId: string; targetEntityIds: string[] };
  /** Who last landed on a creature, and with which ability. */
  lastLanded: Record<string, { sourceEntityId: string; abilityRef: string }>;
  npcs: Record<string, NpcLedger>;
};

function ledgerOf(encounter: JsonRecord): Ledger {
  if (!isRecord(encounter[LEDGER])) encounter[LEDGER] = { lastLanded: {}, npcs: {} };
  return encounter[LEDGER] as unknown as Ledger;
}

function npcLedger(ledger: Ledger, npcId: string): NpcLedger {
  return ledger.npcs[npcId] ??= { struck: {}, struckBy: {}, hostility: {} };
}

/** Aware of the fight at this moment: in the encounter's scene, alive,
 * conscious and above 0 hit points. An incapacitated creature still is. */
export function awareInEncounter(state: AuthoritativeWorldState, encounter: JsonRecord, entityId: string): boolean {
  const body = state.combatRuntime.entities[entityId];
  if (body === undefined || body.lifeState === "dead" || body.lifeState === "unconscious") return false;
  if (isRecord(body.conditions) && body.conditions.unconscious === true) return false;
  if (isNonEmptyString(encounter.sceneId) && body.sceneId !== encounter.sceneId) return false;
  const current = isRecord(body.hitPoints) ? Number(body.hitPoints.current) : Number.NaN;
  return !Number.isFinite(current) || current > 0;
}

function participants(encounter: JsonRecord): string[] {
  return Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(isNonEmptyString) : [];
}

/** An NPC in this encounter that perceived the event: aware just before it. */
function perceivingNpc(before: AuthoritativeWorldState, after: AuthoritativeWorldState, encounter: JsonRecord, id: string): boolean {
  const beforeEncounter = before.combatRuntime.encounters[String(encounter.encounterId)];
  return after.entities[id]?.kind === "npc" && participants(encounter).includes(id)
    && beforeEncounter !== undefined && awareInEncounter(before, beforeEncounter, id);
}

function runningEncounter(state: AuthoritativeWorldState, encounterId: unknown): JsonRecord | undefined {
  const encounter = isNonEmptyString(encounterId) ? state.combatRuntime.encounters[encounterId] : undefined;
  return encounter !== undefined && encounter.status !== "concluded" ? encounter : undefined;
}

/** Each creature an ability reached and whether it landed: an attack that
 * hit, a save that failed. A single attack names its target in the frozen
 * resolution it consumes. */
function abilityOutcomes(payload: JsonRecord, resolving: Ledger["resolving"], resolutionId: string | null): [string, boolean][] {
  const result = isRecord(payload.mechanicalResult) ? payload.mechanicalResult : {};
  const outcomes: [string, boolean][] = [];
  if (isRecord(result.attacks)) {
    for (const [target, attack] of Object.entries(result.attacks)) {
      if (isRecord(attack) && typeof attack.hit === "boolean") outcomes.push([target, attack.hit]);
    }
  } else if (isRecord(result.attack) && typeof result.attack.hit === "boolean" && !isRecord(result.attack.aimedPoint)
    && resolving !== undefined && resolving.resolutionId === resolutionId && resolving.targetEntityIds.length === 1) {
    outcomes.push([resolving.targetEntityIds[0], result.attack.hit]);
  }
  if (isRecord(result.saves)) {
    for (const [target, save] of Object.entries(result.saves)) {
      if (isRecord(save) && typeof save.success === "boolean") outcomes.push([target, !save.success]);
    }
  }
  return outcomes.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

const tally = (map: Record<string, Tally>, ref: string): Tally => map[ref] ??= { times: 0, landed: 0, downed: false };

/** Folds one committed event into the running encounter's ledger. `before`
 * is authority just before the event; `after` is the state it produced, which
 * this mutates. Replay runs the same fold, so the ledger is rebuilt exactly. */
export function recordEncounterPerception(before: AuthoritativeWorldState, after: AuthoritativeWorldState, event: EventEnvelope): void {
  if (!worldInteractionProfileEnabled(event.profiles.extensions)) return;
  const payload = event.payload as JsonRecord;
  // The resolution an act consumes names its acting creature and targets; the
  // first event that consumes it removes it from authority, so note it then.
  const consumed = event.resolutionId === null ? undefined : before.combatRuntime.randomnessResolutions[event.resolutionId];
  const operation = isRecord(consumed) && isRecord(consumed.operation) ? consumed.operation : undefined;
  if (operation !== undefined && isNonEmptyString(operation.sourceEntityId)) {
    const encounter = activeEncounter(after, operation.sourceEntityId);
    const targets = Array.isArray(operation.targetEntityIds) ? operation.targetEntityIds.filter(isNonEmptyString)
      : isNonEmptyString(operation.targetEntityId) ? [operation.targetEntityId] : [];
    if (encounter !== undefined) ledgerOf(encounter).resolving = { resolutionId: event.resolutionId!,
      sourceEntityId: operation.sourceEntityId, targetEntityIds: [...targets] };
  }
  if (event.eventType === "AbilityInvoked" && isNonEmptyString(payload.sourceEntityId) && isNonEmptyString(payload.abilityRef)) {
    const source = payload.sourceEntityId, encounter = activeEncounter(after, source);
    if (encounter === undefined) return;
    const ledger = ledgerOf(encounter);
    for (const [target, landed] of abilityOutcomes(payload, ledger.resolving, event.resolutionId)) {
      if (target === source || !participants(encounter).includes(target)) continue;
      if (landed) ledger.lastLanded[target] = { sourceEntityId: source, abilityRef: payload.abilityRef };
      if (perceivingNpc(before, after, encounter, source)) {
        const entry = tally(npcLedger(ledger, source).struck, target);
        entry.times += 1; if (landed) entry.landed += 1;
      }
      if (perceivingNpc(before, after, encounter, target)) {
        const entry = tally(npcLedger(ledger, target).struckBy, source);
        entry.times += 1; if (landed) entry.landed += 1;
      }
    }
    return;
  }
  if (event.eventType === "DamagePacketResolved") {
    const encounter = runningEncounter(after, payload.encounterId), target = payload.targetEntityId;
    if (encounter === undefined || !isNonEmptyString(target)) return;
    const was = before.combatRuntime.entities[target], now = after.combatRuntime.entities[target];
    const hp = (body: JsonRecord | undefined) => isRecord(body?.hitPoints) ? Number(body!.hitPoints.current) : Number.NaN;
    if (!(hp(was) > 0) || !(hp(now) === 0 || now?.lifeState === "dead")) return;
    const ledger = ledgerOf(encounter), last = ledger.lastLanded[target];
    // Only the blow that landed with this very ability downed it; a hazard
    // or a later effect is not put on whoever struck before.
    if (last === undefined || last.abilityRef !== payload.sourceDefinitionId) return;
    if (perceivingNpc(before, after, encounter, target)) tally(npcLedger(ledger, target).struckBy, last.sourceEntityId).downed = true;
    if (last.sourceEntityId !== target && perceivingNpc(before, after, encounter, last.sourceEntityId)) {
      tally(npcLedger(ledger, last.sourceEntityId).struck, target).downed = true;
    }
    return;
  }
  if (event.eventType === "HostilityChanged") {
    const encounter = runningEncounter(after, payload.encounterId), source = payload.sourceEntityId;
    if (encounter === undefined || !isNonEmptyString(source)) return;
    const previous = new Set(Array.isArray(payload.previousTargetEntityIds) ? payload.previousTargetEntityIds.filter(isNonEmptyString) : []);
    const next = new Set(Array.isArray(payload.targetEntityIds) ? payload.targetEntityIds.filter(isNonEmptyString) : []);
    const reason = isNonEmptyString(payload.reason) ? payload.reason : "";
    const changes: [string, HostilityNote["change"]][] = [...[...previous].filter(ref => !next.has(ref)).map(ref => [ref, "ceased"] as [string, HostilityNote["change"]]),
      ...[...next].filter(ref => !previous.has(ref)).map(ref => [ref, "began"] as [string, HostilityNote["change"]])];
    const ledger = ledgerOf(encounter);
    for (const [ref, change] of changes) {
      if (perceivingNpc(before, after, encounter, source)) npcLedger(ledger, source).hostility[`self:${ref}`] = { change, reason };
      if (perceivingNpc(before, after, encounter, ref)) npcLedger(ledger, ref).hostility[`other:${source}`] = { change, reason };
    }
  }
}

function nameOf(state: AuthoritativeWorldState, ref: string): string {
  const name = state.entities[ref]?.name?.split(" / ")[0]?.trim();
  return name !== undefined && name.length > 0 ? name : "某个生物";
}

const byWeight = (entries: [string, Tally][]) => entries.sort(([left, a], [right, b]) =>
  Number(b.downed) - Number(a.downed) || b.landed - a.landed || b.times - a.times || (left < right ? -1 : left > right ? 1 : 0));

/** The words of a hostility change, as the creature that changed made it. */
function ceasedWords(reason: string, byPlayer: boolean): string {
  if (reason === "npcSurrendered") return "投降，";
  if (reason === "playersSurrendered") return byPlayer ? "投降，" : "接受投降，";
  if (reason === "truceAgreed") return "同意停战，";
  return "";
}

function endWords(state: AuthoritativeWorldState, reason: string, proposal: JsonRecord): string {
  switch (reason) {
    case "hostilesCannotContinue": case "hostilesDefeated": return "一方已无力再战，战斗结束。";
    case "npcSurrendered": case "playersSurrendered": return "投降被接受，战斗结束。";
    case "truceAgreed": return "双方停战，战斗结束。";
    case "playersEscaped": {
      const escaped = Array.isArray(proposal.escapedEntityIds) ? proposal.escapedEntityIds.filter(isNonEmptyString) : [];
      return `${escaped.length === 0 ? "有人" : escaped.map(ref => nameOf(state, ref)).join("、")}脱离了战斗，战斗结束。`;
    }
    case "conflictNoLongerNeeded": return "冲突平息，战斗结束。";
    default: return "战斗结束。";
  }
}

function limited(lines: string[], rest: (count: number) => string): string[] {
  return lines.length <= MAX_LINES ? lines : [...lines.slice(0, MAX_LINES), rest(lines.length - MAX_LINES)];
}

/** One NPC's memory of the fight, in its own terms ("本人"), from its ledger
 * only. `aware` is whether it still perceived the fight when it ended. */
export function encounterMemoryText(state: AuthoritativeWorldState, encounter: JsonRecord, npcId: string,
  reason: string, proposal: JsonRecord): string {
  const ledger = isRecord(encounter[LEDGER]) ? (encounter[LEDGER] as unknown as Ledger).npcs[npcId] : undefined;
  const own = ledger ?? { struck: {}, struckBy: {}, hostility: {} };
  const struckBy = byWeight(Object.entries(own.struckBy)), struck = byWeight(Object.entries(own.struck));
  const hostility = Object.entries(own.hostility).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const counterparts = [...new Set([...struckBy.map(([ref]) => ref), ...struck.map(([ref]) => ref),
    ...hostility.map(([key]) => key.slice(key.indexOf(":") + 1))])].sort();
  const scene = isNonEmptyString(encounter.sceneId) ? state.scenes[encounter.sceneId]?.name : undefined;
  const where = scene === undefined ? "" : `在${scene}`;
  const opponents = counterparts.slice(0, MAX_LINES).map(ref => nameOf(state, ref)).join("、")
    + (counterparts.length > MAX_LINES ? `等${counterparts.length}人` : "");
  const lines = [counterparts.length === 0 ? `${where}卷入一场战斗。` : `与${opponents}${where}交战。`];
  lines.push(...limited(struckBy.map(([ref, entry]) => `${nameOf(state, ref)}对本人出手${entry.times}次，得手${entry.landed}次${entry.downed ? "，把本人打倒了" : ""}。`),
    count => `另有${count}人对本人出过手。`));
  lines.push(...limited(struck.map(([ref, entry]) => `本人对${nameOf(state, ref)}出手${entry.times}次，得手${entry.landed}次${entry.downed ? "，把对方打倒了" : ""}。`),
    count => `本人另对${count}人出过手。`));
  const selfChanges = new Map<string, string[]>();
  const otherLines: string[] = [];
  for (const [key, note] of hostility) {
    const ref = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("self:")) {
      const words = note.change === "began" ? "开始与{}为敌。" : `${ceasedWords(note.reason, false)}不再与{}为敌。`;
      selfChanges.set(words, [...(selfChanges.get(words) ?? []), nameOf(state, ref)]);
    } else {
      const byPlayer = state.entities[ref]?.kind === "player";
      otherLines.push(note.change === "began" ? `${nameOf(state, ref)}开始与本人为敌。`
        : `${nameOf(state, ref)}${ceasedWords(note.reason, byPlayer)}不再与本人为敌。`);
    }
  }
  lines.push(...limited([...selfChanges].map(([words, names]) => `本人${words.replace("{}", names.join("、"))}`), count => `本人另有${count}处敌对变化。`));
  lines.push(...limited(otherLines, count => `另有${count}人对本人的敌对有变化。`));
  if (awareInEncounter(state, encounter, npcId)) lines.push(endWords(state, reason, proposal));
  else {
    const body = state.combatRuntime.entities[npcId];
    lines.push(isNonEmptyString(encounter.sceneId) && body?.sceneId !== encounter.sceneId ? "本人离开后的事不知道。" : "本人倒下后的事不知道。");
  }
  return lines.join("");
}

export type EncounterMemoryDraft =
  | Readonly<{ eventType: "CanonicalFactDeclared"; payload: EventPayloadByType["CanonicalFactDeclared"];
    reads: string[]; writes: string[]; creates: string[]; visibilityPolicyId: string; secrecy: "internal" }>
  | Readonly<{ eventType: "SensoryEvidenceAcquired"; payload: EventPayloadByType["SensoryEvidenceAcquired"];
    reads: string[]; writes: string[]; creates: string[]; visibilityPolicyId: string; secrecy: "private" }>;

export function encounterMemoryFactId(encounterId: string, npcId: string): string {
  return `fact:encounter-memory:${canonicalSha256({ encounterId, npcId }).slice("sha256:".length, "sha256:".length + 32)}`;
}

/** SPEC 0012 §13 (ADR 0118): as the fight ends, each living NPC that took
 * part gets its memory of it, privately, as a perception of its own: the
 * observed fact (authority only) and the NPC's acquisition of it. `state`
 * is authority just before the end; the ledger is complete by then. */
export function encounterMemoryDrafts(profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState, encounterId: string, rootActionId: string, reason: string, proposal: JsonRecord): EncounterMemoryDraft[] {
  if (!worldInteractionProfileEnabled(profiles.extensions)) return [];
  const encounter = state.combatRuntime.encounters[encounterId];
  if (encounter === undefined) return [];
  const sceneId = isNonEmptyString(encounter.sceneId) ? encounter.sceneId : undefined;
  return participants(encounter).filter(id => state.entities[id]?.kind === "npc" && state.entities[id]?.tenureStatus === "active"
    && state.combatRuntime.entities[id]?.lifeState !== "dead").sort().flatMap((npcId): EncounterMemoryDraft[] => {
    const evidence = encounterMemoryText(state, encounter, npcId, reason, proposal);
    const factId = encounterMemoryFactId(encounterId, npcId);
    const ledger = isRecord(encounter[LEDGER]) ? (encounter[LEDGER] as unknown as Ledger).npcs[npcId] : undefined;
    const others = ledger === undefined ? [] : [...Object.keys(ledger.struck), ...Object.keys(ledger.struckBy),
      ...Object.keys(ledger.hostility).map(key => key.slice(key.indexOf(":") + 1))];
    return [{ eventType: "CanonicalFactDeclared",
      payload: { fact: { id: factId, kind: "worldInteractionSensoryEvidence",
        subjectRefs: [...new Set([...(sceneId === undefined ? [] : [sceneId]), npcId, ...others])].sort(),
        value: { schema: "zhuwei.world-interaction-sensory-fact/v1", observerRef: npcId, subjectRef: null, sense: "special", evidence },
        visibilityPolicyId: "visibility:hidden-until-evidence", source: "observedEvent", causalParentIds: [] } },
      reads: [`entity:${npcId}`, ...(sceneId === undefined ? [] : [`scene:${sceneId}`])],
      writes: [`fact:${factId}`, `receipt:${rootActionId}`], creates: [`fact:${factId}`],
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" }, {
      eventType: "SensoryEvidenceAcquired",
      payload: { characterId: npcId, factId, sense: "special", clarity: "full", publicEvidence: evidence },
      reads: [`entity:${npcId}`, `fact:${factId}`], writes: [`knowledge:${npcId}`, `receipt:${rootActionId}`],
      creates: [`knowledge:${npcId}:${factId}`],
      visibilityPolicyId: `visibility:knowledge-holder:${npcId}`, secrecy: "private" }];
  });
}
