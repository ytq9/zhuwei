import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import { activeEncounter } from "./combat-encounters";
import { conditionMechanics } from "./condition-mechanics";
import { authoritySpatialRefVisibleTo } from "./authority-bindings";
import { perceptionCoverAdjustment } from "./hiding";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, JsonRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

/** SPEC 0012 §13: participants and bystanders retain only their own
 * perception, including events involving others. The event fold records
 * sight/touch and already-authorized hearing, never KP knowledge. A tally
 * keeps bounded first/last provenance; a long fight does not grow per turn. */
const LEDGER = "fightMemory";
/** Lines per kind in the told memory; the rest are counted. */
const MAX_LINES = 6;

type Provenance = { firstEventId: string; lastEventId: string };
type Tally = { times: number; landed: number; downed: boolean; uncertain?: number; provenance?: Provenance };
type HostilityNote = { change: "ceased" | "began"; reason: string; provenance: Provenance; previous?: { change: "ceased" | "began"; reason: string } };
type ObserverLedger = {
  witnessed: Record<string, { source: string; target: string; tally: Tally }>;
  witnessedHostility: Record<string, { source: string; target: string; note: HostilityNote }>;
  heard: { firstEventId: string; lastEventId: string; count: number } | null;
  present: boolean; beganEventId?: string;
  struck: Record<string, Tally>;
  struckBy: Record<string, Tally>;
  /** `self:<ref>` its own change toward ref; `other:<ref>` ref's toward it. */
  hostility: Record<string, HostilityNote>;
};
type Ledger = {
  /** The creature acting and its targets, for the resolution being consumed. */
  resolving?: { resolutionId: string; sourceEntityId: string; targetEntityIds: string[] };
  /** Who last landed on a creature, and with which ability. */
  lastLanded: Record<string, { sourceEntityId: string; abilityRef: string; rootActionId: string }>;
  observers: Record<string, ObserverLedger>;
};

function ledgerOf(encounter: JsonRecord): Ledger {
  if (!isRecord(encounter[LEDGER])) encounter[LEDGER] = { lastLanded: {}, observers: {} };
  return encounter[LEDGER] as unknown as Ledger;
}

function observerLedger(ledger: Ledger, npcId: string): ObserverLedger {
  return ledger.observers[npcId] ??= { struck: {}, struckBy: {}, hostility: {}, witnessed: {}, witnessedHostility: {}, heard: null, present: false };
}

/** Aware of the fight at this moment: in the encounter's scene, alive,
 * conscious and above 0 hit points. An incapacitated creature still is. */
export function awareInEncounter(state: AuthoritativeWorldState, encounter: JsonRecord, entityId: string): boolean {
  const body = state.combatRuntime.entities[entityId];
  if (state.entities[entityId]?.tenureStatus !== "active" || body === undefined || body.lifeState === "dead"
    || body.lifeState === "unconscious" || conditionMechanics(state, entityId).unawareOfSurroundings) return false;
  if (isRecord(body.conditions) && body.conditions.unconscious === true) return false;
  if (isNonEmptyString(encounter.sceneId) && body.sceneId !== encounter.sceneId) return false;
  const current = isRecord(body.hitPoints) ? Number(body.hitPoints.current) : Number.NaN;
  return !Number.isFinite(current) || current > 0;
}

function participants(encounter: JsonRecord): string[] {
  return Array.isArray(encounter.participantEntityIds) ? encounter.participantEntityIds.filter(isNonEmptyString) : [];
}

/** Sight respects the shared spatial policy, conditions and full cover.
 * Hearing alone never identifies who struck whom through an obstruction. */
function sees(state: AuthoritativeWorldState, observer: string, target: string): boolean {
  if (observer === target) return true;
  const scene = state.entities[observer]?.sceneId;
  return scene !== undefined && state.entities[target]?.sceneId === scene
    && conditionMechanics(state, observer).canSee && conditionMechanics(state, target).conditions.invisible !== true
    && authoritySpatialRefVisibleTo(state, target, scene, observer)
    && perceptionCoverAdjustment(state, observer, target) !== undefined;
}
function observers(state: AuthoritativeWorldState, encounter: JsonRecord): string[] {
  return Object.keys(state.entities).filter(id => awareInEncounter(state, encounter, id)).sort();
}
function provenance(entry: { provenance?: Provenance }, event: EventEnvelope): void {
  entry.provenance = { firstEventId: entry.provenance?.firstEventId ?? event.eventId, lastEventId: event.eventId };
}
function note(previous: HostilityNote | undefined, change: HostilityNote["change"], reason: string, event: EventEnvelope): HostilityNote {
  return { change, reason, provenance: { firstEventId: previous?.provenance.firstEventId ?? event.eventId, lastEventId: event.eventId },
    ...(previous && previous.change !== change ? { previous: { change: previous.change, reason: previous.reason } }
      : previous?.previous ? { previous: previous.previous } : {}) };
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
  if (event.eventType === "EncounterStarted") {
    const encounter = runningEncounter(after, payload.encounterId);
    if (!encounter) return;
    for (const id of observers(before, encounter)) if (participants(encounter).includes(id)
      || participants(encounter).filter(target => sees(before, id, target)).length >= 2) {
      const own = observerLedger(ledgerOf(encounter), id); own.present = true; own.beganEventId = event.eventId;
    }
    return;
  }
  if (event.eventType === "AbilityInvoked" && isNonEmptyString(payload.sourceEntityId) && isNonEmptyString(payload.abilityRef)) {
    const source = payload.sourceEntityId, encounter = activeEncounter(after, source);
    if (encounter === undefined) return;
    const ledger = ledgerOf(encounter);
    for (const [target, landed] of abilityOutcomes(payload, ledger.resolving, event.resolutionId)) {
      if (target === source || !participants(encounter).includes(target)) continue;
      if (landed) ledger.lastLanded[target] = { sourceEntityId: source, abilityRef: payload.abilityRef, rootActionId: event.rootActionId };
      for (const observer of observers(before, encounter)) {
        const seesSource = sees(before, observer, source), seesTarget = sees(before, observer, target);
        if (observer === target && !seesSource && !landed) continue;
        if (observer !== source && observer !== target && !(seesSource && seesTarget)) continue;
        const own = observerLedger(ledger, observer);
        own.present ||= seesSource && seesTarget;
        const entry = observer === source ? tally(own.struck, seesTarget ? target : "unknown")
          : observer === target ? tally(own.struckBy, seesSource ? source : "unknown")
          : (own.witnessed[`${source}\u001f${target}`] ??= { source, target, tally: { times: 0, landed: 0, downed: false } }).tally;
        entry.times += 1;
        // A blinded attacker remembers the attempt, not an unseen success.
        if (observer === source && !seesTarget) entry.uncertain = (entry.uncertain ?? 0) + 1;
        else if (landed) entry.landed += 1;
        provenance(entry, event);
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
    if (last === undefined || last.abilityRef !== payload.sourceDefinitionId || last.rootActionId !== event.rootActionId) return;
    const source = last.sourceEntityId;
    for (const observer of observers(before, encounter)) {
      const seesSource = sees(before, observer, source), seesTarget = sees(before, observer, target);
      if (observer !== target && !(seesSource && seesTarget)) continue;
      const own = observerLedger(ledger, observer);
      const entry = observer === target ? tally(own.struckBy, seesSource ? source : "unknown")
        : observer === source ? tally(own.struck, target)
        : (own.witnessed[`${source}\u001f${target}`] ??= { source, target, tally: { times: 0, landed: 0, downed: false } }).tally;
      entry.downed = true; provenance(entry, event);
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
    for (const [target, change] of changes) for (const observer of observers(before, encounter)) {
      if (observer !== source && !(sees(before, observer, source) && sees(before, observer, target))) continue;
      const own = observerLedger(ledger, observer);
      if (observer === source || observer === target) {
        const key = observer === source ? `self:${target}` : `other:${source}`;
        own.hostility[key] = note(own.hostility[key], change, reason, event);
      } else {
        const key = `${source}\u001f${target}`;
        own.witnessedHostility[key] = { source, target, note: note(own.witnessedHostility[key]?.note, change, reason, event) };
      }
    }
    return;
  }
  // Keep provenance for words/sounds this holder actually acquired. The full
  // words are already in its own knowledge; this summary never copies a
  // private utterance from the source speaker or from the KP's context.
  const heard = event.eventType === "SensoryEvidenceAcquired" && payload.sense === "hearing"
    || event.eventType === "KnowledgeAcquired" && payload.medium === "spokenConversation";
  if (heard && isNonEmptyString(payload.characterId)) {
    const observer = payload.characterId;
    for (const encounter of Object.values(after.combatRuntime.encounters)) {
      if (encounter.status === "concluded" || !awareInEncounter(before, encounter, observer)) continue;
      const own = observerLedger(ledgerOf(encounter), observer);
      own.heard = { firstEventId: own.heard?.firstEventId ?? event.eventId, lastEventId: event.eventId, count: (own.heard?.count ?? 0) + 1 };
    }
  }
}

function nameOf(state: AuthoritativeWorldState, ref: string): string {
  const name = ref === "unknown" ? undefined : state.entities[ref]?.name?.split(" / ")[0]?.trim();
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

function priorStanceWords(note: HostilityNote, byPlayer: boolean): string {
  return note.previous?.change === "ceased" && note.change === "began"
    ? `${ceasedWords(note.previous.reason, byPlayer)}曾停手，后来又`
    : note.previous?.change === "began" && note.change === "ceased" ? "先重新动手，随后" : "";
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

/** One character's memory of the fight, in its own terms ("本人"), from its ledger
 * only. `aware` is whether it still perceived the fight when it ended. */
export function encounterMemoryText(state: AuthoritativeWorldState, encounter: JsonRecord, npcId: string,
  reason: string, proposal: JsonRecord): string {
  const ledger = isRecord(encounter[LEDGER]) ? (encounter[LEDGER] as unknown as Ledger).observers[npcId] : undefined;
  const own = ledger ?? { struck: {}, struckBy: {}, hostility: {}, witnessed: {}, witnessedHostility: {}, heard: null, present: false };
  const struckBy = byWeight(Object.entries(own.struckBy)), struck = byWeight(Object.entries(own.struck));
  const hostility = Object.entries(own.hostility).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const counterparts = [...new Set([...struckBy.map(([ref]) => ref), ...struck.map(([ref]) => ref),
    ...hostility.map(([key]) => key.slice(key.indexOf(":") + 1))])].sort();
  const scene = isNonEmptyString(encounter.sceneId) ? state.scenes[encounter.sceneId]?.name : undefined;
  const where = scene === undefined ? "" : `在${scene}`;
  const opponents = counterparts.slice(0, MAX_LINES).map(ref => nameOf(state, ref)).join("、")
    + (counterparts.length > MAX_LINES ? `等${counterparts.length}人` : "");
  const joined = participants(encounter).includes(npcId);
  const lines = [joined ? counterparts.length === 0 ? `${where}卷入一场战斗。` : `与${opponents}${where}交战。`
    : Object.keys(own.witnessed).length || Object.keys(own.witnessedHostility).length || own.present ? `${where}目睹一场战斗。` : `${where}听到战斗中的动静。`];
  lines.push(...limited(struckBy.map(([ref, entry]) => `${nameOf(state, ref)}对本人出手${entry.times}次，得手${entry.landed}次${entry.uncertain ? `，另有${entry.uncertain}次未能感知结果` : ""}${entry.downed ? "，把本人打倒了" : ""}。`),
    count => `另有${count}人对本人出过手。`));
  lines.push(...limited(struck.map(([ref, entry]) => `本人对${nameOf(state, ref)}出手${entry.times}次，得手${entry.landed}次${entry.uncertain ? `，另有${entry.uncertain}次未能感知结果` : ""}${entry.downed ? "，把对方打倒了" : ""}。`),
    count => `本人另对${count}人出过手。`));
  const selfChanges = new Map<string, string[]>();
  const otherLines: string[] = [];
  for (const [key, note] of hostility) {
    const ref = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("self:")) {
      const prior = priorStanceWords(note, state.entities[npcId]?.kind === "player");
      const words = note.change === "began" ? `${prior}开始与{}为敌。` : `${prior}` + `${ceasedWords(note.reason, state.entities[npcId]?.kind === "player")}不再与{}为敌。`;
      selfChanges.set(words, [...(selfChanges.get(words) ?? []), nameOf(state, ref)]);
    } else {
      const byPlayer = state.entities[ref]?.kind === "player";
      otherLines.push(note.change === "began" ? `${nameOf(state, ref)}${priorStanceWords(note, byPlayer)}开始与本人为敌。`
        : `${nameOf(state, ref)}${priorStanceWords(note, byPlayer)}${ceasedWords(note.reason, byPlayer)}不再与本人为敌。`);
    }
  }
  lines.push(...limited([...selfChanges].map(([words, names]) => `本人${words.replace("{}", names.join("、"))}`), count => `本人另有${count}处敌对变化。`));
  lines.push(...limited(otherLines, count => `另有${count}人对本人的敌对有变化。`));
  const witnessed = Object.values(own.witnessed).sort((a, b) => Number(b.tally.downed) - Number(a.tally.downed)
    || b.tally.landed - a.tally.landed || `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`));
  lines.push(...limited(witnessed.map(({ source, target, tally: entry }) => `看见${nameOf(state, source)}对${nameOf(state, target)}出手${entry.times}次，得手${entry.landed}次${entry.uncertain ? `，另有${entry.uncertain}次未能感知结果` : ""}${entry.downed ? "，把对方打倒了" : ""}。`),
    count => `另目睹${count}组交手，细节未展开。`));
  lines.push(...limited(Object.values(own.witnessedHostility).map(({ source, target, note: stance }) =>
    `看见${nameOf(state, source)}${priorStanceWords(stance, state.entities[source]?.kind === "player")}${stance.change === "began" ? "开始与" : ceasedWords(stance.reason, state.entities[source]?.kind === "player") + "不再与"}${nameOf(state, target)}为敌。`),
    count => `另目睹${count}处敌对变化，细节未展开。`));
  if (own.heard) lines.push(`期间实际听到${own.heard.count}段话语或声响，原话保留在本人听觉记录中。`);
  if (awareInEncounter(state, encounter, npcId) && participants(encounter).filter(ref => sees(state, npcId, ref)).length >= 2)
    lines.push(joined ? endWords(state, reason, proposal) : "眼前的交手停了下来。");
  else if (!awareInEncounter(state, encounter, npcId)) {
    const body = state.combatRuntime.entities[npcId];
    lines.push(isNonEmptyString(encounter.sceneId) && body?.sceneId !== encounter.sceneId ? "本人离开后的事不知道。" : "本人倒下后的事不知道。");
  }
  else lines.push("本人没有感知到战斗结束时的情况。");
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

/** SPEC 0012 §13 (ADR 0118): as the fight ends, each living participant or bystander
 * that perceived the fight gets its memory of it, privately, as a perception of its own: the
 * observed fact (authority only) and the NPC's acquisition of it. `state`
 * is authority just before the end; the ledger is complete by then. */
export function encounterMemoryDrafts(profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState, encounterId: string, rootActionId: string, reason: string, proposal: JsonRecord): EncounterMemoryDraft[] {
  if (!worldInteractionProfileEnabled(profiles.extensions)) return [];
  const encounter = state.combatRuntime.encounters[encounterId];
  if (encounter === undefined) return [];
  const sceneId = isNonEmptyString(encounter.sceneId) ? encounter.sceneId : undefined;
  const ledgers = isRecord(encounter[LEDGER]) ? (encounter[LEDGER] as unknown as Ledger).observers : {};
  return Object.keys(ledgers).filter(id => state.entities[id]?.tenureStatus === "active"
    && state.combatRuntime.entities[id]?.lifeState !== "dead").sort().flatMap((npcId): EncounterMemoryDraft[] => {
    const evidence = encounterMemoryText(state, encounter, npcId, reason, proposal);
    const factId = encounterMemoryFactId(encounterId, npcId);
    const ledger = isRecord(encounter[LEDGER]) ? (encounter[LEDGER] as unknown as Ledger).observers[npcId] : undefined;
    const others = ledger === undefined ? [] : [...Object.keys(ledger.struck), ...Object.keys(ledger.struckBy),
      ...Object.keys(ledger.hostility).map(key => key.slice(key.indexOf(":") + 1))];
    return [{ eventType: "CanonicalFactDeclared",
      payload: { fact: { id: factId, kind: "worldInteractionSensoryEvidence",
        subjectRefs: [...new Set([...(sceneId === undefined ? [] : [sceneId]), npcId, ...others.filter(ref => state.entities[ref])])].sort(),
        value: { schema: "zhuwei.world-interaction-sensory-fact/v1", observerRef: npcId, subjectRef: null, sense: "special", evidence },
        visibilityPolicyId: "visibility:hidden-until-evidence", source: "observedEvent", causalParentIds: memorySources(ledger) } },
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

function memorySources(ledger: ObserverLedger | undefined): string[] {
  if (!ledger) return [];
  const sources = [...Object.values(ledger.struck).map(t => t.provenance), ...Object.values(ledger.struckBy).map(t => t.provenance),
    ...Object.values(ledger.witnessed).map(v => v.tally.provenance), ...Object.values(ledger.hostility).map(v => v.provenance),
    ...Object.values(ledger.witnessedHostility).map(v => v.note.provenance), ledger.heard ?? undefined];
  return [...new Set([...(ledger.beganEventId ? [ledger.beganEventId] : []), ...sources.flatMap(value => value ? [value.firstEventId, value.lastEventId] : [])])].sort();
}
