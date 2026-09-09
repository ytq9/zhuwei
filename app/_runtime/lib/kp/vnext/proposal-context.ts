import type { VNextRequiredContext } from "./required-context";
import { ITEM_DEFINITION_SCHEMA, ITEM_ENTRY_SCHEMA } from "../../rules/v2/items";
import { VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA } from "../../rules/v2/semantic-definitions";
import { isPlainRecord, compareCodeUnits, canonicalHash } from "./canonical-json";
import { npcDecisionContext, npcDecisionEvidenceRef, npcDecisionLoadedKnowledge, NPC_DECISION_CONTEXT_SCHEMA } from "../../rules/v2/npc-decision-context";

// v6 separates world descriptions from adjudication data without changing the
// frozen authority records, their permission classes or their read bindings.
// v8 sends a bystander's decision view only after the selection names it and
// lists an NPC's knowledge by loaded bodies alone.
export const VNEXT_PROPOSAL_CONTEXT_SCHEMA = "zhuwei.proposal-context/vnext-8" as const;

export type ProposalNpcRecall = Readonly<{ defaultRefs: readonly string[]; requestableRefs: readonly string[] }>;

/** Which frozen NPC views the selection stage may still ask for. */
export function proposalNpcRecall(context: VNextRequiredContext): ProposalNpcRecall {
  const recall = context.references.npcRecall ?? [];
  return Object.freeze({
    defaultRefs: Object.freeze(recall.filter(entry => entry.role === "default").map(entry => entry.npcRef)),
    requestableRefs: Object.freeze(recall.filter(entry => entry.role === "requestable").map(entry => entry.npcRef)),
  });
}

export type ProposalKnowledgeHandle = Readonly<{ handle: string; entryRef: string; holderRef: string }>;

/** The frozen bodies the topic did not reach, by the handle the holder's
 * directory shows; the selection names handles, the context holds refs. Only
 * a holder whose view is sent (the actor, an addressed NPC, a requested one)
 * offers handles: a bystander's memory follows its view. */
export function proposalKnowledgeRecall(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = []): readonly ProposalKnowledgeHandle[] {
  const hidden = new Set((context.references.npcRecall ?? [])
    .filter(entry => entry.role === "requestable" && !requestedNpcRefs.includes(entry.npcRef)).map(entry => entry.npcRef));
  return Object.freeze((context.references.knowledgeRecall ?? []).flatMap(entry => hidden.has(entry.holderRef) ? []
    : entry.records.map(record => Object.freeze({ handle: record.handle, entryRef: record.entryRef, holderRef: entry.holderRef }))));
}

/** The same frozen context with what the selection has not asked for left
 * out: the decision snapshots and bodies of bystanders it did not name, and
 * the frozen memory bodies of complete-memory holders the topic did not
 * reach. Those leave the entries and the citation directory, and a decision
 * snapshot lists them as unread, while presence records stay. Nothing is
 * added, and the binding is untouched, so Room and lowering keep reading the
 * complete frozen context; only what the model is sent, and what its forms
 * may cite, follows the selection. */
export function proposalContextView(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  requestedKnowledgeRefs: readonly string[] = []): VNextRequiredContext {
  const hiddenNpcs = (context.references.npcRecall ?? [])
    .filter(entry => entry.role === "requestable" && !requestedNpcRefs.includes(entry.npcRef));
  const hiddenBodies = new Set((context.references.knowledgeRecall ?? []).flatMap(entry => entry.records)
    .filter(record => !requestedKnowledgeRefs.includes(record.entryRef)).map(record => record.entryRef));
  if (hiddenNpcs.length === 0 && hiddenBodies.size === 0) return context;
  const hidden = new Set([...hiddenNpcs.flatMap(entry => entry.entryRefs), ...hiddenBodies]);
  const hiddenNpcRefs = new Set(hiddenNpcs.map(entry => entry.npcRef));
  const actorPrefix = `knowledge:${context.intent.actorRef}:`;
  const hiddenActorKnowledgeRefs = new Set([...hiddenBodies].filter(ref => ref.startsWith(actorPrefix)).map(ref => ref.slice(actorPrefix.length)));
  const keep = (ref: string) => !hidden.has(ref) && !hiddenActorKnowledgeRefs.has(ref);
  const citations = context.references.citations;
  return Object.freeze({ ...context,
    entries: Object.freeze(context.entries.flatMap(entry => {
      if (!keep(entry.entryRef)) return [];
      // A decision snapshot whose frozen bodies are withheld lists them as
      // unread, so the same reader that serves Rules serves this view.
      if (entry.kind === "known" && isPlainRecord(entry.value) && entry.value.schema === NPC_DECISION_CONTEXT_SCHEMA
        && typeof entry.value.npcRef === "string" && Array.isArray(entry.value.knowledge)) {
        const withheld = entry.value.knowledge.flatMap(record => isPlainRecord(record) && typeof record.entryRef === "string"
          && hiddenBodies.has(record.entryRef) ? [record.entryRef] : []);
        if (withheld.length === 0) return [entry];
        const unloaded = Array.isArray(entry.value.unloadedKnowledgeRefs) ? entry.value.unloadedKnowledgeRefs as string[] : [];
        // The reader binds a snapshot to the hash of its value; this derived
        // view is read through the same reader, so it carries its own hash.
        const value = Object.freeze({ ...entry.value,
          unloadedKnowledgeRefs: Object.freeze([...new Set([...unloaded, ...withheld])].sort(compareCodeUnits)) });
        return [Object.freeze({ ...entry, value, revisionOrHash: canonicalHash(value) })];
      }
      return [entry];
    })),
    references: Object.freeze({ ...context.references,
      citations: Object.freeze({ ...citations,
        viewerEvidenceRefs: Object.freeze(citations.viewerEvidenceRefs.filter(keep)),
        authorityBasisRefs: Object.freeze(citations.authorityBasisRefs.filter(keep)),
        nonCitableRefs: Object.freeze(citations.nonCitableRefs.filter(keep)),
        npcKnowledge: Object.freeze(citations.npcKnowledge.flatMap(entry => hiddenNpcRefs.has(entry.npcRef) ? []
          : [Object.freeze({ ...entry, refs: Object.freeze(entry.refs.filter(keep)) })])) }) }) });
}

/** `refs`: what this NPC's speech may cite. `factRefs`: the canonical facts
 * the NPC itself can see, the only admissible basis for a relationship or
 * debt it forms; a host-only truth cannot ground what the NPC does. */
export type ProposalNpcSourceChoices = readonly Readonly<{ npcRef: string; refs: readonly string[]; factRefs: readonly string[] }>[];

/** A choice surface over the same verified holder resolver used by lowering.
 * Wrapper records do not resolve as evidence. No live authority is consulted. */
export function proposalNpcSourceChoices(context: VNextRequiredContext): ProposalNpcSourceChoices {
  return Object.freeze(context.entries.flatMap(entry => {
    if (entry.kind !== "known" || !isPlainRecord(entry.value)
      || entry.value.schema !== NPC_DECISION_CONTEXT_SCHEMA || typeof entry.value.npcRef !== "string") return [];
    const snapshot = npcDecisionContext(context.entries, entry.value.npcRef);
    if (!snapshot) return [];
    const refs = [...new Set([...snapshot.records.map(record => record.ref),
      ...npcDecisionLoadedKnowledge(snapshot).map(record => record.entryRef)]
      .flatMap(ref => { const resolved = npcDecisionEvidenceRef(snapshot, ref); return resolved === undefined ? [] : [resolved]; }))]
      .sort(compareCodeUnits);
    const factRefs = snapshot.records.filter(record => record.kind === "fact").map(record => record.ref).sort(compareCodeUnits);
    return [Object.freeze({ npcRef: snapshot.npcRef, refs: Object.freeze(refs), factRefs: Object.freeze(factRefs) })];
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
    const { projectionHash: _projection, unloadedKnowledgeRefs, ...rest } = value;
    const unloaded = new Set(Array.isArray(unloadedKnowledgeRefs) ? unloadedKnowledgeRefs : []);
    return Object.freeze({ ...rest,
      // Only memories whose bodies this action read are listed; the NPC holds
      // `unloadedKnowledgeCount` more that cannot be cited or paraphrased. The
      // complete directory stays in the frozen entry for Rules to verify.
      knowledge: Array.isArray(value.knowledge) ? Object.freeze(value.knowledge.flatMap(record => isPlainRecord(record)
        ? (unloaded.has(String(record.entryRef)) ? [] : [Object.freeze({ knowledgeRef: record.knowledgeRef, entryRef: record.entryRef })]) : [record])) : value.knowledge,
      unloadedKnowledgeCount: unloaded.size,
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
 * those server-owned identities. `requestedNpcRefs` are the bystander views
 * the selection named; the rest keep only their observable presence record,
 * and references.npcRecall lists who can still be asked for. */
export function proposalModelContext(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  requestedKnowledgeRefs: readonly string[] = []) {
  const view = proposalContextView(context, requestedNpcRefs, requestedKnowledgeRefs);
  const recall = context.references.npcRecall ?? [];
  const shown = recall.filter(entry => entry.role === "default" || requestedNpcRefs.includes(entry.npcRef)).map(entry => entry.npcRef);
  const requestable = recall.filter(entry => entry.role === "requestable" && !requestedNpcRefs.includes(entry.npcRef)).map(entry => entry.npcRef);
  const handles = proposalKnowledgeRecall(context, requestedNpcRefs);
  const subjects = new Set(proposalObservationSubjectRefs(view));
  const known = new Set(view.entries.flatMap(entry => entry.kind === "known" ? [entry.entryRef] : []));
  return Object.freeze({
    schema: VNEXT_PROPOSAL_CONTEXT_SCHEMA,
    contextHash: view.binding.contextHash,
    intent: view.intent,
    // A holder's knowledge catalog binds versions for Rules; the model reads
    // the loaded bodies and the gist directory instead.
    entries: Object.freeze(view.entries.filter(entry => !(entry.kind === "known" && entry.entryRef.startsWith("knowledge-catalog:"))).map(entry => {
      if (entry.kind !== "known") return entry;
      const { revisionOrHash: _revision, ...presented } = entry;
      const value = !isPlainRecord(entry.value) ? entry.value
        : subjects.has(entry.entryRef) ? worldSubjectModelValue(entry.value) : modelEntryValue(entry.value, known);
      return Object.freeze({ ...presented, value });
    })),
    references: Object.freeze({ ...view.references, npcRecall: Object.freeze({ shown: Object.freeze(shown), requestable: Object.freeze(requestable) }),
      knowledgeRecall: Object.freeze({ shown: Object.freeze(handles.filter(record => requestedKnowledgeRefs.includes(record.entryRef)).map(record => record.entryRef)),
        requestable: Object.freeze(handles.filter(record => !requestedKnowledgeRefs.includes(record.entryRef)).map(record => record.handle)) }),
      observationSubjectRefs: proposalObservationSubjectRefs(view),
      npcSourceChoices: proposalNpcSourceChoices(view), itemEntryRefs: proposalItemEntryRefs(view),
      itemDefinitionRefs: proposalItemDefinitionRefs(view) }),
  });
}
