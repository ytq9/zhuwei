import type { RuntimeProfileManifest } from "../profiles/types";
import type { AuthoritativeWorldState } from "./model";
import { authorityKnowledgeCatalog, authorityRevisionOrHash } from "./authority-bindings";
import { projectWorld } from "./projector";
import { canonicalSha256 as canonicalHash } from "../profiles/canonical";

/** Structural input shared by the KP context adapter and Rules preflight. */
export type NpcDecisionSourceEntry = Readonly<{
  kind: string; entryRef: string; revisionOrHash?: string; value?: unknown;
}>;
export type NpcDecisionFrozenEntry =
  | Readonly<{ kind: "known"; entryRef: string; revisionOrHash: string; value: NpcDecisionContext }>
  | Readonly<{ kind: "unavailable"; entryRef: string; reason: "notLoaded" | "invalidProjection"; critical: false }>;

export const NPC_DECISION_CONTEXT_SCHEMA = "zhuwei.npc-decision-context/vnext-1" as const;
export type NpcDecisionRecord = Readonly<{
  ref: string;
  revisionOrHash: string;
  kind: "self" | "identity" | "scene" | "timeline" | "knowledgeCatalog" | "fact"
    | "relationship" | "promise" | "debt" | "plan" | "conversation" | "sourceClaim" | "campaign" | "chapter" | "faction";
  value: unknown;
}>;
export type NpcDecisionContext = Readonly<{
  schema: typeof NPC_DECISION_CONTEXT_SCHEMA;
  npcRef: string;
  projectionHash: string;
  knowledgeCatalogRef: string;
  knowledge: readonly Readonly<{ knowledgeRef: string; entryRef: string; revisionOrHash: string }>[];
  records: readonly NpcDecisionRecord[];
}>;

export function npcDecisionEntryRef(npcRef: string): string { return `npc-decision:${npcRef}`; }

/** Resolve only within an already verified NPC snapshot. A knowledgeRef is
 * local to its explicit npcRef; the complete holder body was checked when
 * npcDecisionContext accepted the snapshot. Never search another holder. */
export function npcDecisionEvidenceRef(context: NpcDecisionContext, ref: string): string | undefined {
  if (context.records.some(record => record.ref === ref)
    || context.knowledge.some(record => record.entryRef === ref)) return ref;
  return context.knowledge.find(record => record.knowledgeRef === ref)?.entryRef;
}

/** Consumes the separately requested Rules NPC projection from this prepare.
 * Authority records version dependencies; only projected values tell the NPC
 * what it knows. Missing projection is never evidence of an empty mind. */
export function freezeNpcDecisionEntry(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  npcRef: string, projection: unknown, entries: readonly NpcDecisionSourceEntry[]): NpcDecisionFrozenEntry {
  const entryRef = npcDecisionEntryRef(npcRef);
  const unavailable = (reason: "notLoaded" | "invalidProjection"): NpcDecisionFrozenEntry => ({ kind: "unavailable", entryRef, reason, critical: false });
  if (projection === undefined) return unavailable("notLoaded");
  try {
    const npc = state.entities[npcRef];
    if (!npc || npc.kind !== "npc" || npc.tenureStatus !== "active" || !isPlainRecord(projection)
      || projection.kind !== "projected" || !isPlainRecord(projection.viewer)
      || projection.viewer.kind !== "npc" || projection.viewer.subjectId !== npcRef
      || projection.stateVersion !== state.version || projection.activeBranchId !== state.activeBranchId
      || canonicalHash(projection.runtimeProfiles) !== canonicalHash(profiles)
      || !isPlainRecord(projection.controlledCharacter) || projection.controlledCharacter.characterId !== npcRef
      || !Array.isArray(projection.knowledge) || !Array.isArray(projection.visibleFacts)) return unavailable("invalidProjection");
    const { projectionHash, ...body } = projection;
    if (typeof projectionHash !== "string" || projectionHash !== canonicalHash(body)) return unavailable("invalidProjection");
    // The same authoritative interpreter used by Rules.project, with this
    // prepare's resolved manifest. A self-signed projection is not a visibility
    // grant: re-signing another NPC's facts must still fail this equality.
    const expected = projectWorld(profiles, state, { kind: "npc", npcId: npcRef,
      purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });
    if (expected.kind !== "projected" || canonicalHash(expected) !== canonicalHash(projection)) return unavailable("invalidProjection");
    const records: NpcDecisionRecord[] = [];
    const add = (ref: string, kind: NpcDecisionRecord["kind"], value: unknown): boolean => {
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      if (revisionOrHash === null || records.some(record => record.ref === ref)) return false;
      records.push({ ref, kind, revisionOrHash, value: structuredClone(value) });
      return true;
    };
    const knowledgeCatalogRef = `knowledge-catalog:${npcRef}`;
    if (!add(npcRef, "self", projection.controlledCharacter)
      || !add(npc.sceneId, "scene", isPlainRecord(projection.publicExpression) ? projection.publicExpression.scene : { sceneRef: npc.sceneId })
      || !add(`character-timeline:${npcRef}`, "timeline", projection.fictionTime)
      || !add(knowledgeCatalogRef, "knowledgeCatalog", authorityKnowledgeCatalog(state, npcRef))) return unavailable("invalidProjection");
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
    for (const record of projection.knowledge) {
      if (!isPlainRecord(record) || typeof record.knowledgeRef !== "string" || record.characterId !== npcRef
        || !Object.hasOwn(state.knowledge[npcRef] ?? {}, record.knowledgeRef)
        || canonicalHash(record) !== canonicalHash(state.knowledge[npcRef][record.knowledgeRef])) return unavailable("invalidProjection");
      const ref = `knowledge:${npcRef}:${record.knowledgeRef}`;
      const loaded = entries.find(entry => entry.entryRef === ref);
      const revisionOrHash = authorityRevisionOrHash(state, ref);
      if (loaded?.kind !== "known") return unavailable("notLoaded");
      if (revisionOrHash === null || loaded.revisionOrHash !== revisionOrHash
        || canonicalHash(loaded.value) !== canonicalHash(record)) return unavailable("invalidProjection");
      // The body already belongs to the holder-namespaced context entry. This
      // directory binds it without copying it into a second model-facing body.
      knowledge.push({ knowledgeRef: record.knowledgeRef, entryRef: ref, revisionOrHash });
    }
    if (knowledge.length !== Object.keys(state.knowledge[npcRef] ?? {}).length) return unavailable("invalidProjection");
    for (const fact of projection.visibleFacts) {
      if (!isPlainRecord(fact) || typeof fact.id !== "string" || !add(fact.id, "fact", fact)) return unavailable("invalidProjection");
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
        if (!isPlainRecord(value) || typeof value[idKey] !== "string"
          || !add(`continuity:${collection}:${value[idKey]}`, kind, value)) return unavailable("invalidProjection");
      }
    }
    const value: NpcDecisionContext = freezeSnapshot({ schema: NPC_DECISION_CONTEXT_SCHEMA, npcRef, projectionHash,
      knowledgeCatalogRef, knowledge: knowledge.sort((a, b) => a.entryRef < b.entryRef ? -1 : 1),
      records: records.sort((a, b) => a.ref < b.ref ? -1 : 1) });
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
    if (!isPlainRecord(value) || value.schema !== NPC_DECISION_CONTEXT_SCHEMA
      || typeof value.npcRef !== "string" || value.npcRef.length === 0
      || !exactKeys(value, ["schema", "npcRef", "projectionHash", "knowledgeCatalogRef", "knowledge", "records"])
      || !hash(value.projectionHash) || value.knowledgeCatalogRef !== `knowledge-catalog:${value.npcRef}`) return false;
    // Reject non-JSON and noncanonical embedded projected values as data errors.
    canonicalHash(value);
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
      || catalog[0].value.schema !== "zhuwei.held-knowledge-catalog/v1" || catalog[0].value.characterId !== npcRef
      || catalog[0].revisionOrHash !== canonicalHash(catalog[0].value) || !Array.isArray(catalog[0].value.records)
      || value.knowledge.length !== catalog[0].value.records.length) return false;
    const catalogRecords = catalog[0].value.records;
    if (!value.knowledge.every(record => isPlainRecord(record) && exactKeys(record, ["knowledgeRef", "entryRef", "revisionOrHash"])
      && typeof record.knowledgeRef === "string" && record.knowledgeRef.length > 0
      && record.entryRef === `knowledge:${npcRef}:${record.knowledgeRef}` && hash(record.revisionOrHash)
      && catalogRecords.some(member => isPlainRecord(member) && member.knowledgeRef === record.knowledgeRef
        && member.recordRef === record.entryRef && member.recordHash === record.revisionOrHash))
      || new Set(value.knowledge.map(record => (record as { entryRef: string }).entryRef)).size !== value.knowledge.length) return false;
    return true;
  } catch { return false; }
}

export function npcDecisionContext(entries: readonly NpcDecisionSourceEntry[], npcRef: string): NpcDecisionContext | undefined {
  try {
    const entry = entries.find(candidate => candidate.kind === "known" && candidate.entryRef === npcDecisionEntryRef(npcRef));
    if (!entry || !npcDecisionContextConform(entry.value) || entry.value.npcRef !== npcRef
      || entry.revisionOrHash !== canonicalHash(entry.value)) return undefined;
    const value = entry.value;
    if (!value.knowledge.every(record => entries.some(loaded => loaded.kind === "known" && loaded.entryRef === record.entryRef
      && loaded.revisionOrHash === record.revisionOrHash && isPlainRecord(loaded.value)
      && loaded.value.characterId === npcRef && loaded.value.knowledgeRef === record.knowledgeRef
      && canonicalHash(loaded.value) === record.revisionOrHash))) return undefined;
    return value;
  } catch { return undefined; }
}

function hash(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Rebuild exactly the same NPC snapshot from current authority for Rules.
 * Only the context adapter accepts a separately supplied projection. */
export function authoritativeNpcDecisionContext(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  npcRef: string): NpcDecisionContext | undefined {
  const projection = projectWorld(profiles, state, { kind: "npc", npcId: npcRef,
    purpose: "kpDecision", capability: "internal:npc-limited-knowledge" });
  const entries = Object.entries(state.knowledge[npcRef] ?? {}).map(([ref, value]) => ({
    kind: "known", entryRef: `knowledge:${npcRef}:${ref}`, revisionOrHash: canonicalHash(value), value,
  }));
  const frozen = freezeNpcDecisionEntry(state, profiles, npcRef, projection, entries);
  return frozen.kind === "known" ? frozen.value : undefined;
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
