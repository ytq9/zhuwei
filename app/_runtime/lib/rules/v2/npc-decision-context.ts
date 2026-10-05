import type { RuntimeProfileManifest } from "../profiles/types";
import type { AuthoritativeWorldState } from "./model";
import { authorityKnowledgeCatalog, authorityKnowledgeCatalogHashWithout, authorityKnowledgeCatalogWitness, authorityRevisionOrHash,
  HELD_KNOWLEDGE_CATALOG_WITNESS_SCHEMA } from "./authority-bindings";
import { isPastRoundMemory, recentMemoryRounds } from "./knowledge-records";
export { RECENT_MEMORY_ROUNDS, acquiredInPlay, isRoundMemory, recentMemoryRounds } from "./knowledge-records";
import { projectWorld } from "./projector";
import { assertCanonical, canonicalSha256 as canonicalHash, sameCanonical } from "../profiles/canonical";

/** Structural input shared by the KP context adapter and Rules preflight. */
export type NpcDecisionSourceEntry = Readonly<{
  kind: string; entryRef: string; revisionOrHash?: string; value?: unknown;
}>;
export type NpcDecisionFrozenEntry =
  | Readonly<{ kind: "known"; entryRef: string; revisionOrHash: string; value: NpcDecisionContext }>
  | Readonly<{ kind: "unavailable"; entryRef: string; reason: "notLoaded" | "invalidProjection"; critical: false }>;

/** vnext-1 carried every claim, exchange and perception its NPC ever had.
 * Events that froze one are still checked against it on every replay. */
export const NPC_DECISION_CONTEXT_FULL_SCHEMA = "zhuwei.npc-decision-context/vnext-1" as const;
/** vnext-2 carries those of the NPC's latest rounds of play only; every
 * other record, and the complete directory of what it holds, is unchanged
 * (ADR 0050). */
export const NPC_DECISION_CONTEXT_RECENT_SCHEMA = "zhuwei.npc-decision-context/vnext-2" as const;
/** vnext-3 lists only the memories whose bodies the context holds; its
 * catalog record carries a count, and that record's version (the complete
 * catalog's hash) binds every memory the NPC holds. vnext-2 carried a line per
 * memory in its directory, its catalog and its unread list, about 650 bytes
 * each, and past about 380 memories outgrew its 256,000-byte cap (SPEC 0016
 * §4.3, ADR 0115). */
export const NPC_DECISION_CONTEXT_SCHEMA = "zhuwei.npc-decision-context/vnext-3" as const;
export type NpcDecisionContextSchema = typeof NPC_DECISION_CONTEXT_FULL_SCHEMA | typeof NPC_DECISION_CONTEXT_RECENT_SCHEMA
  | typeof NPC_DECISION_CONTEXT_SCHEMA;
export function isNpcDecisionContextSchema(value: unknown): value is NpcDecisionContextSchema {
  return value === NPC_DECISION_CONTEXT_SCHEMA || value === NPC_DECISION_CONTEXT_RECENT_SCHEMA || value === NPC_DECISION_CONTEXT_FULL_SCHEMA;
}
/** A snapshot whose `knowledge` lists the memories it read, not all it holds. */
export function npcDecisionListsReadKnowledge(schema: NpcDecisionContextSchema): boolean {
  return schema === NPC_DECISION_CONTEXT_SCHEMA;
}
export type NpcDecisionRecord = Readonly<{
  ref: string;
  revisionOrHash: string;
  kind: "self" | "identity" | "scene" | "timeline" | "knowledgeCatalog" | "fact"
    | "relationship" | "promise" | "debt" | "plan" | "conversation" | "sourceClaim" | "campaign" | "chapter" | "faction";
  value: unknown;
}>;
export type NpcDecisionContext = Readonly<{
  schema: NpcDecisionContextSchema;
  npcRef: string;
  projectionHash: string;
  knowledgeCatalogRef: string;
  /** vnext-1/2: the complete held-knowledge directory, every record's ref and
   * version. vnext-3: the records whose bodies the context holds; the catalog
   * record's version binds the rest. */
  knowledge: readonly Readonly<{ knowledgeRef: string; entryRef: string; revisionOrHash: string }>[];
  records: readonly NpcDecisionRecord[];
  /** Directory members whose bodies this snapshot did not freeze. The KP
   * read nothing of them and may cite nothing of them; Rules comparisons of
   * the decision domain exclude this field, because it describes what was
   * read, not what the NPC knows. Absent on snapshots frozen before bodies
   * were tiered, which loaded every body. */
  unloadedKnowledgeRefs?: readonly string[];
}>;

/** Directory members whose bodies were frozen with the snapshot. */
export function npcDecisionLoadedKnowledge(context: NpcDecisionContext): NpcDecisionContext["knowledge"] {
  const unloaded = new Set(context.unloadedKnowledgeRefs ?? []);
  return context.knowledge.filter(record => !unloaded.has(record.entryRef));
}

export function npcDecisionEntryRef(npcRef: string): string { return `npc-decision:${npcRef}`; }

/** Resolve only within an already verified NPC snapshot. A knowledgeRef is
 * local to its explicit npcRef; the complete holder body was checked when
 * npcDecisionContext accepted the snapshot. Never search another holder. */
export function npcDecisionEvidenceRef(context: NpcDecisionContext, ref: string): string | undefined {
  const loaded = npcDecisionLoadedKnowledge(context);
  if (context.records.some(record => record.ref === ref)
    || loaded.some(record => record.entryRef === ref)) return ref;
  return loaded.find(record => record.knowledgeRef === ref)?.entryRef;
}

/** Consumes the separately requested Rules NPC projection from this prepare.
 * Authority records version dependencies; only projected values tell the NPC
 * what it knows. Missing projection is never evidence of an empty mind. */
export function freezeNpcDecisionEntry(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  npcRef: string, projection: unknown, entries: readonly NpcDecisionSourceEntry[],
  schema: NpcDecisionContextSchema = NPC_DECISION_CONTEXT_SCHEMA): NpcDecisionFrozenEntry {
  const entryRef = npcDecisionEntryRef(npcRef);
  const unavailable = (reason: "notLoaded" | "invalidProjection"): NpcDecisionFrozenEntry => ({ kind: "unavailable", entryRef, reason, critical: false });
  if (projection === undefined) return unavailable("notLoaded");
  try {
    const npc = state.entities[npcRef];
    if (!npc || npc.kind !== "npc" || npc.tenureStatus !== "active" || !isPlainRecord(projection)
      || projection.kind !== "projected" || !isPlainRecord(projection.viewer)
      || projection.viewer.kind !== "npc" || projection.viewer.subjectId !== npcRef
      || projection.stateVersion !== state.version || projection.activeBranchId !== state.activeBranchId
      || !sameCanonical(projection.runtimeProfiles, profiles)
      || !isPlainRecord(projection.controlledCharacter) || projection.controlledCharacter.characterId !== npcRef
      || !Array.isArray(projection.knowledge) || !Array.isArray(projection.visibleFacts)) return unavailable("invalidProjection");
    if (typeof projection.projectionHash !== "string") return unavailable("invalidProjection");
    // The same authoritative interpreter used by Rules.project, with this
    // prepare's resolved manifest. A self-signed projection is not a visibility
    // grant: re-signing another NPC's facts must still fail this equality.
    const expected = projectWorld(profiles, state, { kind: "npc", npcId: npcRef,
      purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });
    if (expected.kind !== "projected" || !sameCanonical(expected, projection)) return unavailable("invalidProjection");
    const records: NpcDecisionRecord[] = [];
    const add = (ref: string, kind: NpcDecisionRecord["kind"], value: unknown): boolean => {
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      if (revisionOrHash === null || records.some(record => record.ref === ref)) return false;
      records.push({ ref, kind, revisionOrHash, value: structuredClone(value) });
      return true;
    };
    const knowledgeCatalogRef = `knowledge-catalog:${npcRef}`;
    const readOnly = npcDecisionListsReadKnowledge(schema);
    if (!add(npcRef, "self", projection.controlledCharacter)
      || !add(npc.sceneId, "scene", isPlainRecord(projection.publicExpression) ? projection.publicExpression.scene : { sceneRef: npc.sceneId })
      || !add(`character-timeline:${npcRef}`, "timeline", projection.fictionTime)
      || !add(knowledgeCatalogRef, "knowledgeCatalog", readOnly ? authorityKnowledgeCatalogWitness(state, npcRef)
        : authorityKnowledgeCatalog(state, npcRef))) return unavailable("invalidProjection");
    if (npc.semanticDefinitionRef !== undefined) {
      if (!isPlainRecord(projection.npcIdentity)
        || projection.npcIdentity.definitionRef !== npc.semanticDefinitionRef
        || !add(npc.semanticDefinitionRef, "identity", projection.npcIdentity)) return unavailable("invalidProjection");
    }
    // Administrative pins and own faction resources are already filtered by
    // this same NPC projection. They bind formation without becoming factual
    // premises or opening a fresh authority lookup on a candidate prefix.
    if (isPlainRecord(projection.campaign)) {
      if (!add("continuity:campaign", "campaign", projection.campaign)) return unavailable("invalidProjection");
      const chapterId = projection.campaign.currentChapterId;
      const chapter = Array.isArray(projection.chapters) ? projection.chapters.find(value =>
        isPlainRecord(value) && value.chapterId === chapterId) : undefined;
      if (typeof chapterId !== "string" || !chapter || !add(`continuity:chapters:${chapterId}`, "chapter", chapter)) return unavailable("invalidProjection");
    }
    if (Array.isArray(projection.factions)) for (const faction of projection.factions) {
      if (!isPlainRecord(faction) || typeof faction.factionId !== "string" || !Array.isArray(faction.memberRefs)
        || !faction.memberRefs.includes(npcRef) || !add(`continuity:factions:${faction.factionId}`, "faction", faction)) return unavailable("invalidProjection");
    }
    const knowledge: { knowledgeRef: string; entryRef: string; revisionOrHash: string }[] = [];
    const unloadedKnowledgeRefs: string[] = [];
    for (const record of projection.knowledge) {
      if (!isPlainRecord(record) || typeof record.knowledgeRef !== "string" || record.characterId !== npcRef
        || !Object.hasOwn(state.knowledge[npcRef] ?? {}, record.knowledgeRef)
        || !sameCanonical(record, state.knowledge[npcRef][record.knowledgeRef])) return unavailable("invalidProjection");
      const ref = `knowledge:${npcRef}:${record.knowledgeRef}`;
      const loaded = entries.find(entry => entry.entryRef === ref);
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      if (revisionOrHash === null) return unavailable("invalidProjection");
      // vnext-1/2: the directory binds every record's version. A body the
      // caller did not freeze -- because this action's relevance did not
      // select it, or the record exceeded the per-entry cap -- stays a
      // directory line the KP cannot cite; it never becomes an empty mind or
      // an unavailable snapshot. vnext-3 lists the frozen bodies only; the
      // catalog record's version binds the others (ADR 0115).
      if (loaded?.kind !== "known") { if (!readOnly) unloadedKnowledgeRefs.push(ref); else continue; }
      else if (loaded.revisionOrHash !== revisionOrHash
        || !sameCanonical(loaded.value, record)) return unavailable("invalidProjection");
      // The body already belongs to the holder-namespaced context entry. This
      // directory binds it without copying it into a second model-facing body.
      knowledge.push({ knowledgeRef: record.knowledgeRef, entryRef: ref, revisionOrHash });
    }
    if (projection.knowledge.length !== Object.keys(state.knowledge[npcRef] ?? {}).length
      || (!readOnly && knowledge.length !== projection.knowledge.length)) return unavailable("invalidProjection");
    // vnext-2 and vnext-3 leave out what the NPC perceived, heard or said in
    // an earlier round than its latest ones: the claim, the exchange and the
    // perceived fact of a memory it no longer carries in full. Its directory
    // still lists the memory, and a handle can bring one back.
    const heldByNpc = state.knowledge[npcRef] ?? {};
    const recent = recentMemoryRounds(Object.values(heldByNpc));
    const pastRound = (ref: unknown) => schema !== NPC_DECISION_CONTEXT_FULL_SCHEMA && typeof ref === "string"
      && Object.hasOwn(heldByNpc, ref) && isPastRoundMemory(heldByNpc[ref], recent);
    const dropped = (kind: NpcDecisionRecord["kind"], value: Record<string, unknown>): boolean => {
      if (kind === "sourceClaim") return pastRound(value.claimId);
      if (kind !== "conversation") return false;
      const ties = [value.claimRef, value.responseClaimRef].filter(ref => typeof ref === "string" && Object.hasOwn(heldByNpc, ref));
      return ties.length > 0 && ties.every(pastRound);
    };
    for (const fact of projection.visibleFacts) {
      if (!isPlainRecord(fact) || typeof fact.id !== "string") return unavailable("invalidProjection");
      if (!pastRound(fact.id) && !add(fact.id, "fact", fact)) return unavailable("invalidProjection");
    }
    for (const [collection, idKey, kind] of [
      ["relationships", "relationshipId", "relationship"], ["promises", "promiseId", "promise"],
      ["debts", "debtId", "debt"], ["npcPlans", "planId", "plan"],
      ["conversationThreads", "threadRef", "conversation"], ["sourceClaims", "claimId", "sourceClaim"],
    ] as const) {
      const values = projection[collection];
      if (values === undefined) continue;
      if (!Array.isArray(values)) return unavailable("invalidProjection");
      for (const value of values) {
        if (!isPlainRecord(value) || typeof value[idKey] !== "string") return unavailable("invalidProjection");
        if (!dropped(kind, value) && !add(`continuity:${collection}:${value[idKey]}`, kind, value)) return unavailable("invalidProjection");
      }
    }
    const value: NpcDecisionContext = freezeSnapshot({ schema, npcRef, projectionHash: projection.projectionHash,
      knowledgeCatalogRef, knowledge: knowledge.sort((a, b) => a.entryRef < b.entryRef ? -1 : 1),
      records: records.sort((a, b) => a.ref < b.ref ? -1 : 1),
      ...(unloadedKnowledgeRefs.length === 0 ? {} : { unloadedKnowledgeRefs: unloadedKnowledgeRefs.sort() }) });
    return freezeSnapshot({ kind: "known", entryRef, revisionOrHash: canonicalHash(value), value });
  } catch {
    // A malformed non-JSON projection is unavailable evidence, never an
    // exception that can escape Room preparation or imply an empty mind.
    return unavailable("invalidProjection");
  }
}

/** Validate the self-contained snapshot before hashing or reading its fields.
 * Holder bodies are verified separately by the context adapter or authority. */
export function npcDecisionContextConform(value: unknown): value is NpcDecisionContext {
  try {
    if (!isPlainRecord(value) || !isNpcDecisionContextSchema(value.schema)
      || typeof value.npcRef !== "string" || value.npcRef.length === 0
      || !exactKeys(value, ["schema", "npcRef", "projectionHash", "knowledgeCatalogRef", "knowledge", "records",
        ...(Object.hasOwn(value, "unloadedKnowledgeRefs") ? ["unloadedKnowledgeRefs"] : [])])
      || !hash(value.projectionHash) || value.knowledgeCatalogRef !== `knowledge-catalog:${value.npcRef}`) return false;
    // Reject non-JSON and noncanonical embedded projected values as data errors.
    assertCanonical(value);
    const npcRef = value.npcRef;
    if (!Array.isArray(value.records) || !Array.isArray(value.knowledge)) return false;
    if (!value.records.every(record => isPlainRecord(record) && exactKeys(record, ["ref", "revisionOrHash", "kind", "value"])
      && typeof record.ref === "string" && record.ref.length > 0 && hash(record.revisionOrHash)
      && ["self", "identity", "scene", "timeline", "knowledgeCatalog", "fact", "relationship", "promise", "debt", "plan", "conversation", "sourceClaim", "campaign", "chapter", "faction"].includes(String(record.kind)))
      || new Set(value.records.map(record => (record as NpcDecisionRecord).ref)).size !== value.records.length) return false;
    const records = value.records as unknown as readonly NpcDecisionRecord[];
    const self = records.filter(record => record.kind === "self");
    const catalog = records.filter(record => record.kind === "knowledgeCatalog");
    const timeline = records.filter(record => record.kind === "timeline");
    const scene = records.filter(record => record.kind === "scene");
    if (self.length !== 1 || self[0].ref !== npcRef || !isPlainRecord(self[0].value) || self[0].value.characterId !== npcRef
      || scene.length !== 1 || scene[0].ref !== self[0].value.sceneId
      || timeline.length !== 1 || timeline[0].ref !== `character-timeline:${npcRef}`
      || catalog.length !== 1 || catalog[0].ref !== value.knowledgeCatalogRef || !isPlainRecord(catalog[0].value)
      || catalog[0].value.characterId !== npcRef) return false;
    const catalogValue = catalog[0].value;
    // vnext-3 (ADR 0115): the catalog counts the memories and its version
    // binds them; the listed ones are those the context read.
    const readOnly = npcDecisionListsReadKnowledge(value.schema);
    if (readOnly ? catalogValue.schema !== HELD_KNOWLEDGE_CATALOG_WITNESS_SCHEMA || !exactKeys(catalogValue, ["schema", "characterId", "count"])
        || !Number.isSafeInteger(catalogValue.count) || Number(catalogValue.count) < value.knowledge.length
      : catalogValue.schema !== "zhuwei.held-knowledge-catalog/v1" || !Array.isArray(catalogValue.records)
        || value.knowledge.length !== catalogValue.records.length) return false;
    const catalogRecords = readOnly ? [] : catalogValue.records as unknown[];
    if (!value.knowledge.every(record => isPlainRecord(record) && exactKeys(record, ["knowledgeRef", "entryRef", "revisionOrHash"])
      && typeof record.knowledgeRef === "string" && record.knowledgeRef.length > 0
      && record.entryRef === `knowledge:${npcRef}:${record.knowledgeRef}` && hash(record.revisionOrHash)
      && (readOnly || catalogRecords.some(member => isPlainRecord(member) && member.knowledgeRef === record.knowledgeRef
        && member.recordRef === record.entryRef && member.recordHash === record.revisionOrHash)))
      || new Set(value.knowledge.map(record => (record as { entryRef: string }).entryRef)).size !== value.knowledge.length) return false;
    if (Object.hasOwn(value, "unloadedKnowledgeRefs")) {
      const unloaded = value.unloadedKnowledgeRefs;
      const directory = new Set(value.knowledge.map(record => (record as { entryRef: string }).entryRef));
      if (!Array.isArray(unloaded) || unloaded.length === 0 || new Set(unloaded).size !== unloaded.length
        || unloaded.some((ref, index) => typeof ref !== "string" || !directory.has(ref) || (index > 0 && !(String(unloaded[index - 1]) < ref)))) return false;
    }
    return true;
  } catch { return false; }
}

export function npcDecisionContext(entries: readonly NpcDecisionSourceEntry[], npcRef: string): NpcDecisionContext | undefined {
  try {
    const entry = entries.find(candidate => candidate.kind === "known" && candidate.entryRef === npcDecisionEntryRef(npcRef));
    if (!entry || !npcDecisionContextConform(entry.value) || entry.value.npcRef !== npcRef) return undefined;
    const value = entry.value;
    if (!npcDecisionLoadedKnowledge(value).every(record => entries.some(loaded => loaded.kind === "known" && loaded.entryRef === record.entryRef
      && loaded.revisionOrHash === record.revisionOrHash && isPlainRecord(loaded.value)
      && loaded.value.characterId === npcRef && loaded.value.knowledgeRef === record.knowledgeRef))) return undefined;
    // A vnext-3 snapshot lists every body of its NPC the context holds; one it
    // left out would be read by the KP and never bound (ADR 0115).
    if (npcDecisionListsReadKnowledge(value.schema) && entries.some(held => held.kind === "known" && held.entryRef.startsWith(`knowledge:${npcRef}:`)
      && !value.knowledge.some(record => record.entryRef === held.entryRef))) return undefined;
    return value;
  } catch { return undefined; }
}

function hash(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Rebuild exactly the same NPC snapshot from current authority for Rules,
 * under the schema of the snapshot being checked. Only the context adapter
 * accepts a separately supplied projection. A vnext-3 snapshot lists the
 * memories it read: `read` names them (holder-local refs, those of the
 * snapshot being checked); a ref the NPC no longer holds drops out, so the
 * rebuilt snapshot differs. Without `read` it lists every memory, as a
 * snapshot that read them all. */
export function authoritativeNpcDecisionContext(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  npcRef: string, schema: NpcDecisionContextSchema = NPC_DECISION_CONTEXT_SCHEMA,
  read?: readonly string[]): NpcDecisionContext | undefined {
  const projection = projectWorld(profiles, state, { kind: "npc", npcId: npcRef,
    purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });
  const listed = npcDecisionListsReadKnowledge(schema) && read !== undefined ? new Set(read) : undefined;
  const entries = Object.entries(state.knowledge[npcRef] ?? {}).filter(([ref]) => listed === undefined || listed.has(ref)).map(([ref, value]) => ({
    kind: "known", entryRef: `knowledge:${npcRef}:${ref}`, revisionOrHash: canonicalHash(value), value,
  }));
  const frozen = freezeNpcDecisionEntry(state, profiles, npcRef, projection, entries, schema);
  return frozen.kind === "known" ? frozen.value : undefined;
}

/** The holder-local refs of the memories a snapshot lists. */
export function npcDecisionKnowledgeRefs(context: Pick<NpcDecisionContext, "knowledge">): readonly string[] {
  return context.knowledge.map(record => record.knowledgeRef);
}

/** SPEC 0016 §4.3 (ADR 0115): whether, beside `added` (holder-local refs),
 * the NPC holds exactly what the snapshot's catalog record bound when it was
 * frozen. A vnext-3 snapshot lists only what it read, so a change to any
 * other memory shows only in the catalog's hash. */
export function npcDecisionCatalogUnchangedBesides(state: AuthoritativeWorldState, context: NpcDecisionContext,
  added: ReadonlySet<string>): boolean {
  const catalog = context.records.find(record => record.kind === "knowledgeCatalog");
  return catalog !== undefined && authorityKnowledgeCatalogHashWithout(state, context.npcRef, added) === catalog.revisionOrHash;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function freezeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeSnapshot(child);
  return value;
}
