import type { VNextRequiredContext } from "./required-context";
import { ITEM_DEFINITION_SCHEMA, ITEM_ENTRY_SCHEMA } from "../../rules/v2/items";
import { VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA } from "../../rules/v2/semantic-definitions";
import { isPlainRecord, compareCodeUnits } from "./canonical-json";
import { npcDecisionContext, npcDecisionEvidenceRef, NPC_DECISION_CONTEXT_SCHEMA } from "../../rules/v2/npc-decision-context";

// v6 separates world descriptions from adjudication data without changing the
// frozen authority records, their permission classes or their read bindings.
export const VNEXT_PROPOSAL_CONTEXT_SCHEMA = "zhuwei.proposal-context/vnext-7" as const;

export type ProposalNpcSourceChoices = readonly Readonly<{ npcRef: string; refs: readonly string[] }>[];

/** A choice surface over the same verified holder resolver used by lowering.
 * Wrapper records do not resolve as evidence. No live authority is consulted. */
export function proposalNpcSourceChoices(context: VNextRequiredContext): ProposalNpcSourceChoices {
  return Object.freeze(context.entries.flatMap(entry => {
    if (entry.kind !== "known" || !isPlainRecord(entry.value)
      || entry.value.schema !== NPC_DECISION_CONTEXT_SCHEMA || typeof entry.value.npcRef !== "string") return [];
    const snapshot = npcDecisionContext(context.entries, entry.value.npcRef);
    if (!snapshot) return [];
    const refs = [...new Set([...snapshot.records.map(record => record.ref),
      ...snapshot.knowledge.map(record => record.entryRef)]
      .flatMap(ref => { const resolved = npcDecisionEvidenceRef(snapshot, ref); return resolved === undefined ? [] : [resolved]; }))]
      .sort(compareCodeUnits);
    return [Object.freeze({ npcRef: snapshot.npcRef, refs: Object.freeze(refs) })];
  }).sort((left, right) => compareCodeUnits(left.npcRef, right.npcRef)));
}

/** A typed selection surface over already frozen, player-addressable records.
 * This is not an operation permission check; Rules still checks location,
 * ownership, quantity and the complete transition. Never scan hidden state. */
export function proposalItemEntryRefs(context: VNextRequiredContext): readonly string[] {
  const visible = new Set(context.references.citations.viewerEvidenceRefs);
  return Object.freeze(context.entries.flatMap(entry => entry.kind === "known"
    && visible.has(entry.entryRef) && isPlainRecord(entry.value)
    && entry.value.schema === ITEM_ENTRY_SCHEMA && entry.value.entryId === entry.entryRef
    ? [entry.entryRef] : []).sort(compareCodeUnits));
}

/** Definitions may include authority-only mechanics already authorized for
 * adjudication. They describe a type, never prove a physical instance exists.
 * Only exact read-bound definitions enter this surface; no live state scan. */
export function proposalItemDefinitionRefs(context: VNextRequiredContext): readonly string[] {
  const authorized = new Set([...context.references.citations.viewerEvidenceRefs,
    ...context.references.citations.authorityBasisRefs]);
  return Object.freeze(context.entries.flatMap(entry => entry.kind === "known"
    && authorized.has(entry.entryRef) && isPlainRecord(entry.value)
    && entry.value.schema === ITEM_DEFINITION_SCHEMA && entry.value.definitionId === entry.entryRef
    ? [entry.entryRef] : []).sort(compareCodeUnits));
}

/** The classes of world object a reference slot can accept. A slot names the
 * class it takes; it never enumerates individual refs of its own. */
export type ProposalSubjectClass = "physical" | "creature";

/** True when this frozen record *is* the named object, rather than a record
 * about it. Identity is matched against the entryRef so a definition, catalog,
 * knowledge record or private decision wrapper can never stand in for the
 * object it describes. */
function subjectOfClass(value: Record<string, unknown>, ref: string, subjectClass: ProposalSubjectClass): boolean {
  const creature = isPlainRecord(value.entity) && value.entity.id === ref
    && (value.entity.kind === "player" || value.entity.kind === "npc");
  if (subjectClass === "creature") return creature;
  return creature
    || (isPlainRecord(value.scene) && value.scene.id === ref)
    || (value.schema === ITEM_ENTRY_SCHEMA && value.entryId === ref)
    || (value.schema === "zhuwei.item-assembly/v1" && value.assemblyRef === ref)
    || (isPlainRecord(value.feature) && value.feature.featureId === ref)
    || (value.schema === VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA
      && (value.semanticKind === "sceneFeature" || value.semanticKind === "location" || value.semanticKind === "passage")
      && value.definitionId === ref);
}

/** Frozen, Viewer-visible world objects of one class, as a selection surface.
 * Viewer permission and spatial visibility were checked when these records were
 * frozen; this neither rereads authority nor grants permissions or transaction
 * bindings. Rules still checks the complete target predicate, so a slot's
 * accepting validator stays authoritative and may still reject a listed ref. */
export function proposalSubjectRefs(context: VNextRequiredContext,
  subjectClass: ProposalSubjectClass): readonly string[] {
  const visible = new Set(context.references.citations.viewerEvidenceRefs);
  return Object.freeze(context.entries.flatMap(entry => entry.kind === "known"
    && visible.has(entry.entryRef) && isPlainRecord(entry.value)
    && subjectOfClass(entry.value, entry.entryRef, subjectClass)
    ? [entry.entryRef] : []).sort(compareCodeUnits));
}

/** Actual observation subjects, never knowledge records about those subjects.
 * Definitions of people/items, facts, narratives and private decision records
 * cannot stand in for an observed creature, item instance or scene feature. */
export function proposalObservationSubjectRefs(context: VNextRequiredContext): readonly string[] {
  return proposalSubjectRefs(context, "physical");
}

/** Creature targets only. A scene, item, feature or place is a physical object
 * but never a creature, so an ability that targets creatures cannot reach one. */
export function proposalCreatureTargetRefs(context: VNextRequiredContext): readonly string[] {
  return proposalSubjectRefs(context, "creature");
}

/** Presentation only: move existing descriptive text, never translate a state
 * code into a perceived appearance. The remaining record stays complete for
 * adjudication. In particular observableState can contain opaque codes and
 * must not acquire sensory meaning just from its field name. */
function worldSubjectModelValue(value: Record<string, unknown>) {
  const group = value.schema === VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA ? "content"
    : isPlainRecord(value.entity) ? "entity" : isPlainRecord(value.scene) ? "scene"
    : isPlainRecord(value.feature) ? "feature" : undefined;
  const source = group === undefined ? value : value[group];
  const description: Record<string, string> = {};
  const remainder = { ...(isPlainRecord(source) ? source : {}) };
  const fields = group === "entity" || group === "scene" ? ["name"]
    : group === "feature" ? ["label"] : ["label", "description", "materialDescription"];
  for (const key of fields) {
    if (typeof remainder[key] !== "string") continue;
    description[key] = remainder[key];
    delete remainder[key];
  }
  Object.freeze(description);
  Object.freeze(remainder);
  return Object.freeze({
    worldDescription: group === undefined ? description : Object.freeze({ [group]: description }),
    adjudication: group === undefined ? remainder : Object.freeze({ ...value, [group]: remainder }),
  });
}

/** Presentation only: server-owned version hashes leave, and a fact body that
 * already has its own entry is not repeated inside the module constraint
 * frame. Nothing here changes which facts, records or knowledge the model may
 * read or cite; Room and lowering keep reading the frozen context itself. */
function modelEntryValue(value: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  if (value.schema === NPC_DECISION_CONTEXT_SCHEMA) {
    const { projectionHash: _projection, ...rest } = value;
    return Object.freeze({ ...rest,
      knowledge: Array.isArray(value.knowledge) ? Object.freeze(value.knowledge.map(record => isPlainRecord(record)
        ? Object.freeze({ knowledgeRef: record.knowledgeRef, entryRef: record.entryRef }) : record)) : value.knowledge,
      records: Array.isArray(value.records) ? Object.freeze(value.records.map(record => {
        if (!isPlainRecord(record)) return record;
        const { revisionOrHash: _revision, ...presented } = record;
        return Object.freeze({ ...presented,
          value: isPlainRecord(record.value) ? modelEntryValue(record.value, known) : record.value });
      })) : value.records });
  }
  if (value.schema === "zhuwei.held-knowledge-catalog/v1" && Array.isArray(value.records)) {
    return Object.freeze({ ...value, records: Object.freeze(value.records.map(record => {
      if (!isPlainRecord(record)) return record;
      const { recordHash: _hash, ...presented } = record;
      return Object.freeze(presented);
    })) });
  }
  if (isPlainRecord(value.factConstraints) && Array.isArray(value.factConstraints.facts)) {
    const { factConstraintsHash: _frame, ...rest } = value;
    return Object.freeze({ ...rest, factConstraints: Object.freeze({ ...value.factConstraints,
      facts: Object.freeze(value.factConstraints.facts.map(fact =>
        isPlainRecord(fact) && typeof fact.id === "string" && known.has(fact.id)
          ? Object.freeze({ id: fact.id, kind: fact.kind, subjectRefs: fact.subjectRefs, entryRef: fact.id }) : fact)) }) });
  }
  return value;
}

/** Model-facing representation of the same frozen context. Every fact,
 * availability state and permission directory is retained; server-owned
 * version hashes are not, and a fact body carried by its own entry is listed
 * by id inside the constraint frame. Room keeps the full binding and validates
 * it when journaling and committing; the model neither chooses nor reproduces
 * those server-owned identities. */
export function proposalModelContext(context: VNextRequiredContext) {
  const subjects = new Set(proposalObservationSubjectRefs(context));
  const known = new Set(context.entries.flatMap(entry => entry.kind === "known" ? [entry.entryRef] : []));
  return Object.freeze({
    schema: VNEXT_PROPOSAL_CONTEXT_SCHEMA,
    contextHash: context.binding.contextHash,
    intent: context.intent,
    entries: Object.freeze(context.entries.map(entry => {
      if (entry.kind !== "known") return entry;
      const { revisionOrHash: _revision, ...presented } = entry;
      const value = !isPlainRecord(entry.value) ? entry.value
        : subjects.has(entry.entryRef) ? worldSubjectModelValue(entry.value) : modelEntryValue(entry.value, known);
      return Object.freeze({ ...presented, value });
    })),
    references: Object.freeze({ ...context.references, observationSubjectRefs: proposalObservationSubjectRefs(context),
      npcSourceChoices: proposalNpcSourceChoices(context), itemEntryRefs: proposalItemEntryRefs(context),
      itemDefinitionRefs: proposalItemDefinitionRefs(context) }),
  });
}
