import type { VNextRequiredContext } from "./required-context";
import { ITEM_DEFINITION_SCHEMA, ITEM_ENTRY_SCHEMA } from "../../rules/v2/items";
import { VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA } from "../../rules/v2/semantic-definitions";
import { isPlainRecord, compareCodeUnits } from "./canonical-json";
import { npcDecisionContext, npcDecisionEvidenceRef, NPC_DECISION_CONTEXT_SCHEMA } from "../../rules/v2/npc-decision-context";

// v5 exposes typed item instance/definition choices for selection as well as
// filling. All choices derive from the same authorized frozen records.
export const VNEXT_PROPOSAL_CONTEXT_SCHEMA = "zhuwei.proposal-context/vnext-5" as const;

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

/** Model-facing representation of the same frozen context. Every fact,
 * availability state, entry version and permission directory is retained.
 * Room keeps the full binding and validates it when journaling and committing;
 * the model neither chooses nor reproduces those server-owned identities. */
export function proposalModelContext(context: VNextRequiredContext) {
  return Object.freeze({
    schema: VNEXT_PROPOSAL_CONTEXT_SCHEMA,
    contextHash: context.binding.contextHash,
    intent: context.intent,
    entries: context.entries,
    references: Object.freeze({ ...context.references, observationSubjectRefs: proposalObservationSubjectRefs(context),
      npcSourceChoices: proposalNpcSourceChoices(context), itemEntryRefs: proposalItemEntryRefs(context),
      itemDefinitionRefs: proposalItemDefinitionRefs(context) }),
  });
}
