import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, CanonicalFactRecord } from "./model";
import type { StoredSemanticDefinition } from "./semantic-definitions";
function isRecord(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function isNonEmptyString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
}

/** Authored truth and the reason someone knows it are frozen together. The
 * semantic judgment is KP's, not a claim that hashes prove prose consistent. */
export type AuthoredWorldFact = Readonly<{
  subjectRefs: readonly string[];
  occurrence: string;
  initialKnowledge: readonly Readonly<{
    holderRef: string; acquisitionBasisRefs: readonly string[]; acquisitionExplanation: string;
  }>[];
  consistency: Readonly<{ judgment: "compatible" | "conflict" | "uncertain"; explanation: string }>;
}>;
const text = (v: unknown): v is string => isNonEmptyString(v) && v.length <= 4_000;
const refs = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 128
  && v.every(isNonEmptyString) && new Set(v).size === v.length;
export function authoredWorldFactConform(v: unknown): v is AuthoredWorldFact {
  return isRecord(v) && hasExactKeys(v, ["subjectRefs", "occurrence", "initialKnowledge", "consistency"])
    && refs(v.subjectRefs) && v.subjectRefs.length > 0 && text(v.occurrence)
    && Array.isArray(v.initialKnowledge) && v.initialKnowledge.length <= 16
    && v.initialKnowledge.every(k => isRecord(k) && hasExactKeys(k, ["holderRef", "acquisitionBasisRefs", "acquisitionExplanation"])
      && isNonEmptyString(k.holderRef) && refs(k.acquisitionBasisRefs) && k.acquisitionBasisRefs.length > 0 && text(k.acquisitionExplanation))
    && new Set(v.initialKnowledge.map(k => k.holderRef)).size === v.initialKnowledge.length
    && isRecord(v.consistency) && hasExactKeys(v.consistency, ["judgment", "explanation"])
    && ["compatible", "conflict", "uncertain"].includes(String(v.consistency.judgment)) && text(v.consistency.explanation);
}

export const WORLD_FACT_POINTER_SCHEMA = "zhuwei.materialized-world-fact/v1";
export const worldFactRef = (definitionRef: string) => `fact:${definitionRef}`;
export function worldFactPointer(definition: StoredSemanticDefinition) {
  return { schema: WORLD_FACT_POINTER_SCHEMA, definitionRef: definition.definitionId,
    definitionRevision: definition.revision, definitionHash: definition.definitionHash };
}
export function isWorldFactPointer(value: unknown): boolean {
  return isRecord(value) && value.schema === WORLD_FACT_POINTER_SCHEMA;
}
/** There is one immutable prose body; facts and knowledge store pinned links. */
export function worldFactDefinition(state: AuthoritativeWorldState, fact: Pick<CanonicalFactRecord, "id" | "value" | "subjectRefs">): StoredSemanticDefinition | undefined {
  const p = fact.value;
  if (!isRecord(p) || !hasExactKeys(p, ["schema", "definitionRef", "definitionRevision", "definitionHash"])
    || p.schema !== WORLD_FACT_POINTER_SCHEMA || typeof p.definitionRef !== "string") return undefined;
  const d = state.campaignRuntime.definitions[p.definitionRef] as StoredSemanticDefinition | undefined;
  return d?.semanticKind === "worldFact" && d.definitionId === p.definitionRef
    && fact.id === worldFactRef(d.definitionId) && d.revision === p.definitionRevision && d.definitionHash === p.definitionHash
    && authoredWorldFactConform(d.content.worldFact)
    && canonicalSha256(fact.subjectRefs) === canonicalSha256(d.content.worldFact.subjectRefs) ? d : undefined;
}
/** Call only after Viewer authorization. Do not project acquisition reasons or
 * the private consistency review alongside publicly available fact content. */
export function projectWorldFact(state: AuthoritativeWorldState, fact: CanonicalFactRecord): CanonicalFactRecord {
  if (!isWorldFactPointer(fact.value)) return structuredClone(fact);
  const definition = worldFactDefinition(state, fact);
  if (!definition) throw new TypeError("world-fact:pinned-definition-unavailable");
  return { ...structuredClone(fact), value: { ...worldFactPointer(definition), label: definition.content.label,
    description: definition.content.description, occurrence: (definition.content.worldFact as unknown as AuthoredWorldFact).occurrence } };
}

export const worldFactConstraintsRef = (sceneRef: string) => `world-fact-constraints:${sceneRef}`;
/** Membership is part of the binding: adding a relevant fact after prepare
 * invalidates the decision even when every previously read object is intact.
 * This authority-only frame must never be used as an NPC knowledge grant. */
export function worldFactConstraints(state: AuthoritativeWorldState, sceneRef: string) {
  if (!state.scenes[sceneRef]) return undefined;
  const entities = Object.values(state.entities).filter(e => e.sceneId === sceneRef && e.tenureStatus === "active")
    .sort((a, b) => a.id.localeCompare(b.id));
  const scopedDefinitions = Object.entries(state.campaignRuntime.definitions).filter(([, d]) => isRecord(d.content) && d.content.sceneRef === sceneRef);
  const subjects = new Set([sceneRef, ...entities.map(e => e.id), ...scopedDefinitions.map(([ref]) => ref)]);
  const selectedFacts = new Map(Object.values(state.canonicalFacts).filter(f => f.subjectRefs.some(ref => subjects.has(ref))).map(f => [f.id, f]));
  for (const fact of selectedFacts.values()) for (const ref of fact.causalParentIds) {
    const parent = state.canonicalFacts[ref]; if (parent) selectedFacts.set(ref, parent);
  }
  const missingParentRefs = [...new Set([...selectedFacts.values()].flatMap(f => f.causalParentIds).filter(ref => !state.canonicalFacts[ref]))].sort();
  const facts = [...selectedFacts.values()].sort((a, b) => a.id.localeCompare(b.id));
  const definitionRefs = new Set([...scopedDefinitions.map(([ref]) => ref), ...entities.flatMap(e => e.semanticDefinitionRef ? [e.semanticDefinitionRef] : [])]);
  for (const fact of facts) if (isRecord(fact.value) && typeof fact.value.definitionRef === "string") definitionRefs.add(fact.value.definitionRef);
  const participantKeys = ["subjectIds", "subjectRefs", "characterId", "npcId", "npcCharacterId", "promisorId", "promiseeId", "debtorId", "creditorId"];
  const continuity = ["relationships", "promises", "debts", "npcPlans"].flatMap(collection =>
    Object.entries((state.campaignRuntime as unknown as Record<string, Record<string, unknown>>)[collection] ?? {})
      .filter(([, value]) => isRecord(value) && participantKeys.some(key => {
        const refs = value[key]; return typeof refs === "string" ? subjects.has(refs) : Array.isArray(refs) && refs.some(ref => typeof ref === "string" && subjects.has(ref));
      })).map(([id, value]) => ({ ref: `continuity:${collection}:${id}`, value }))).sort((a,b) => a.ref.localeCompare(b.ref));
  return { schema: "zhuwei.world-fact-constraints/v1", sceneRef, missingParentRefs, continuity, subjectRefs: [...subjects].sort(),
    identities: entities.map(e => ({ id: e.id, kind: e.kind, name: e.name, semanticDefinitionRef: e.semanticDefinitionRef ?? null })),
    facts, definitions: [...definitionRefs].sort().map(ref => ({ ref, definition: state.campaignRuntime.definitions[ref] ?? null })) };
}
