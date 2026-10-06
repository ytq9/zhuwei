import { VNEXT_OBJECT_COMPLETION_CAPABILITIES, type VNextObjectCompletionKind } from "./proposal-capabilities";
import { isNpcSpatialShell } from "../../rules/shapes";
import type { VNextRequiredContext } from "./required-context";
import { ITEM_DEFINITION_SCHEMA, ITEM_ENTRY_SCHEMA, isVNextRulingPrecedent } from "../../rules/shapes";
import { VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA } from "../../rules/shapes";
import { isPlainRecord, compareCodeUnits, canonicalHash, canonicalUnits, sameCanonical } from "./canonical-json";
import { VNEXT_CONTEXT_WORK_BUDGET } from "./context/work-budget";
import { npcDecisionContext, npcDecisionEntryRef, npcDecisionEvidenceRef, npcDecisionListsReadKnowledge, npcDecisionLoadedKnowledge,
  isNpcDecisionContextSchema } from "../../rules/v2/npc-decision-context";
import { KNOWLEDGE_DIRECTORY_SCHEMAS, knowledgeDirectoryEntryRef, knowledgeGist, knowledgeGroupMembers, knowledgeGroupMembersHash, knowledgeGroups,
  knowledgeHeldAt, VNEXT_KNOWLEDGE_RELEVANCE_PROFILE } from "./context/knowledge-relevance";
import { authorityKnowledgeText, type AuthoritativeWorldState } from "../../rules/authority-read";
import { isRetryHistoryEntryRef } from "./retry-history";

// v6 separates world descriptions from adjudication data without changing the
// frozen authority records, their permission classes or their read bindings.
// v8 sends a bystander's decision view only after the selection names it and
// lists an NPC's knowledge by loaded bodies alone. v9 drops server hashes at
// any depth and lists by ref a definition, identity or geometry that another
// entry already carries; v10 leaves out the server's reference domain index.
// v11 sends the entries whose presentation depends on what the selection asked
// to load after all the others. v12 sends each line once: a memory drops the
// ids its entry already names and points at the fact it perceived, an NPC's
// claim and fact records point at the memory or fact entry, a directory line
// is a gist and a handle, and what an unread memory perceived or said leaves
// with it (ADR 0048). v13 reads a ruling precedent as who tried what on which
// refs and how it was ruled, without its server identities (ADR 0083). v14
// shows a long directory's older memories as group lines; a directory with
// groups depends on what the selection asked for and is sent last (ADR 0111).
export const VNEXT_PROPOSAL_CONTEXT_SCHEMA = "zhuwei.proposal-context/vnext-14" as const;

export type ProposalNpcRecall = Readonly<{ defaultRefs: readonly string[]; requestableRefs: readonly string[] }>;

/** Which frozen NPC views the selection stage may still ask for. */
export function proposalNpcRecall(context: VNextRequiredContext): ProposalNpcRecall {
  const recall = context.references.npcRecall ?? [];
  return Object.freeze({
    defaultRefs: Object.freeze(recall.filter(entry => entry.role === "default").map(entry => entry.npcRef)),
    requestableRefs: Object.freeze(recall.filter(entry => entry.role === "requestable").map(entry => entry.npcRef)),
  });
}

/** A handle the holder's directory shows. A memory's `entryRef` names its
 * body; a group's is its `groupRef`, which a request carries to ask for the
 * group (ADR 0111). */
export type ProposalKnowledgeHandle = Readonly<{ kind: "memory" | "group"; handle: string; entryRef: string; holderRef: string }>;

/** The frozen bodies the topic did not reach, by the handle the holder's
 * directory shows; the selection names handles, the context holds refs. Only
 * a holder whose view is sent (the actor, an addressed NPC, a requested one)
 * offers handles: a bystander's memory follows its view. A grouped memory
 * shows its handle only once `requestedKnowledgeRefs` asked for its group and
 * Room listed the group's members (SPEC 0016 §4.3, ADR 0111, ADR 0115). */
export function proposalKnowledgeRecall(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  requestedKnowledgeRefs: readonly string[] = []): readonly ProposalKnowledgeHandle[] {
  const hidden = new Set((context.references.npcRecall ?? [])
    .filter(entry => entry.role === "requestable" && !requestedNpcRefs.includes(entry.npcRef)).map(entry => entry.npcRef));
  return Object.freeze((context.references.knowledgeRecall ?? []).flatMap(entry => {
    if (hidden.has(entry.holderRef)) return [];
    const byHandle = new Map(entry.records.map(record => [record.handle, record]));
    const grouped = new Set((entry.groups ?? []).flatMap(group => (group.members ?? []).map(member => member.handle)));
    const memory = (record: { handle: string; entryRef: string }) => Object.freeze({ kind: "memory" as const,
      handle: record.handle, entryRef: record.entryRef, holderRef: entry.holderRef });
    return [...entry.records.filter(record => !grouped.has(record.handle)).map(memory),
      ...(entry.groups ?? []).flatMap(group => [Object.freeze({ kind: "group" as const, handle: group.handle, entryRef: group.groupRef, holderRef: entry.holderRef }),
        ...(requestedKnowledgeRefs.includes(group.groupRef) ? (group.members ?? []).flatMap(member => {
          const record = byHandle.get(member.handle);
          return record === undefined ? [] : [memory(record)];
        }) : [])])];
  }));
}

/** SPEC 0016 §4.3 (ADR 0111): the refs one stage's named handles ask for,
 * in the order the stage named them. A memory asks for its body; a group asks
 * for itself. Pure over the frozen context, so Room reaches the same refs
 * from the saved reply. Which of a group's members are read is Room's when it
 * lists them (`recallKnowledge`, ADR 0115). */
export function proposalKnowledgeRequest(context: VNextRequiredContext, named: readonly ProposalKnowledgeHandle[],
  prior: readonly string[] = []): readonly string[] {
  const asked = new Set(proposalReadKnowledgeRefs(context, prior)), added: string[] = [];
  for (const handle of named) if (!asked.has(handle.entryRef)) { asked.add(handle.entryRef); added.push(handle.entryRef); }
  return Object.freeze(added);
}

/** The refs a stage reads: those it asked for, and the members Room read for
 * each group among them (ADR 0115). */
export function proposalReadKnowledgeRefs(context: VNextRequiredContext, requested: readonly string[]): readonly string[] {
  const read = (context.references.knowledgeRecall ?? []).flatMap(entry => (entry.groups ?? []).flatMap(group =>
    group.read !== undefined && requested.includes(group.groupRef) ? group.read : []));
  return read.length === 0 ? requested : Object.freeze([...new Set([...requested, ...read])]);
}

/** The handles a stage may still name: those shown and not yet read. */
export function proposalRequestableKnowledgeHandles(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  requestedKnowledgeRefs: readonly string[] = []): readonly string[] {
  const read = proposalReadKnowledgeRefs(context, requestedKnowledgeRefs);
  return Object.freeze(proposalKnowledgeRecall(context, requestedNpcRefs, requestedKnowledgeRefs)
    .filter(record => !read.includes(record.entryRef)).map(record => record.handle));
}

/** Whether Room has still to read something `requested` asks for: a body the
 * freeze left in a directory, or a group whose members it has not listed. */
export function proposalKnowledgeRecallPending(context: VNextRequiredContext, requested: readonly string[]): boolean {
  const present = new Set(context.entries.map(entry => entry.entryRef));
  return (context.references.knowledgeRecall ?? []).some(entry => entry.records.some(record =>
    record.revisionOrHash !== undefined && requested.includes(record.entryRef) && !present.has(record.entryRef))
    || (entry.groups ?? []).some(group => group.members === undefined && requested.includes(group.groupRef)));
}

/** The same frozen context with what the selection has not asked for left
 * out: the decision snapshots and bodies of bystanders it did not name, and
 * the frozen memory bodies of complete-memory holders the topic did not
 * reach. Those leave the entries and the citation directory, and a decision
 * snapshot lists them as unread, while presence records stay. What an unread
 * memory perceived or heard leaves with it: the perception fact its holder
 * observed, and the snapshot's claim, fact and conversation records of that
 * memory. A directory whose group was asked for lists that group's members
 * not read in place of the group's line (ADR 0111).
 * Nothing is added, and the binding is untouched, so Room and lowering keep
 * reading the complete frozen context; only what the model is sent, and what
 * its forms may cite, follows the selection. */
export function proposalContextView(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  asked: readonly string[] = []): VNextRequiredContext {
  const requestedKnowledgeRefs = proposalReadKnowledgeRefs(context, asked);
  const hiddenNpcs = (context.references.npcRecall ?? [])
    .filter(entry => entry.role === "requestable" && !requestedNpcRefs.includes(entry.npcRef));
  const hiddenBodies = new Set((context.references.knowledgeRecall ?? []).flatMap(entry => entry.records)
    .filter(record => !requestedKnowledgeRefs.includes(record.entryRef)).map(record => record.entryRef));
  // A group asked for whose members Room listed (ADR 0115).
  const opened = new Map((context.references.knowledgeRecall ?? []).flatMap(entry => {
    const groups = (entry.groups ?? []).filter(group => group.members !== undefined && requestedKnowledgeRefs.includes(group.groupRef));
    return groups.length === 0 ? [] : [[knowledgeDirectoryEntryRef(entry.holderRef), { entry, groups }] as const];
  }));
  if (hiddenNpcs.length === 0 && hiddenBodies.size === 0 && opened.size === 0) return context;
  const hidden = new Set([...hiddenNpcs.flatMap(entry => entry.entryRefs), ...hiddenBodies]);
  const hiddenNpcRefs = new Set(hiddenNpcs.map(entry => entry.npcRef));
  // A perception fact has one observer, whose memory of it carries the same
  // evidence; a world truth only some holder knows is not a perception and
  // stays for the KP whoever holds it.
  const observers = new Map(context.entries.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value)
    && entry.value.id === entry.entryRef && entry.value.kind === "worldInteractionSensoryEvidence"
    && isPlainRecord(entry.value.value) && typeof entry.value.value.observerRef === "string"
    ? [[entry.entryRef, entry.value.value.observerRef] as const] : []));
  const unreadPerceptions = new Set([...observers].flatMap(([factRef, observerRef]) =>
    hidden.has(`knowledge:${observerRef}:${factRef}`) ? [factRef] : []));
  const keep = (ref: string) => !hidden.has(ref) && !unreadPerceptions.has(ref);
  // The actor may also cite its own memory by the bare knowledge ref. An
  // unread one leaves the citation directory under that name too, unless an
  // entry of the same ref stays (a fact the actor can see on its own).
  const actorPrefix = `knowledge:${context.intent.actorRef}:`;
  const keptEntryRefs = new Set(context.entries.map(entry => entry.entryRef).filter(keep));
  const unreadActorRefs = new Set([...hiddenBodies].filter(ref => ref.startsWith(actorPrefix))
    .map(ref => ref.slice(actorPrefix.length)).filter(ref => !keptEntryRefs.has(ref)));
  const cite = (ref: string) => keep(ref) && !unreadActorRefs.has(ref);
  const citations = context.references.citations;
  return Object.freeze({ ...context,
    entries: Object.freeze(context.entries.flatMap(entry => {
      if (!keep(entry.entryRef)) return [];
      // A decision snapshot whose frozen bodies are withheld lists them as
      // unread, so the same reader that serves Rules serves this view.
      if (entry.kind === "known" && isPlainRecord(entry.value) && isNpcDecisionContextSchema(entry.value.schema)
        && typeof entry.value.npcRef === "string" && Array.isArray(entry.value.knowledge)) {
        const withheld = entry.value.knowledge.flatMap(record => isPlainRecord(record) && typeof record.entryRef === "string"
          && hiddenBodies.has(record.entryRef) ? [record.entryRef] : []);
        if (withheld.length === 0) return [entry];
        const unloaded = [...new Set([...(Array.isArray(entry.value.unloadedKnowledgeRefs) ? entry.value.unloadedKnowledgeRefs as string[] : []), ...withheld])];
        const unread = new Set(unloaded), npcRef = entry.value.npcRef;
        const memoryOf = (ref: unknown) => typeof ref === "string" && unread.has(`knowledge:${npcRef}:${ref}`);
        const records = Array.isArray(entry.value.records) ? entry.value.records.filter(record => {
          if (!isPlainRecord(record) || !isPlainRecord(record.value)) return true;
          if (record.kind === "sourceClaim") return !memoryOf(record.value.claimId);
          if (record.kind === "fact") return !memoryOf(record.ref);
          if (record.kind === "conversation") return !(memoryOf(record.value.claimRef)
            && (record.value.responseClaimRef === null || memoryOf(record.value.responseClaimRef)));
          return true;
        }) : entry.value.records;
        // The reader binds a snapshot to the hash of its value; this derived
        // view is read through the same reader, so it carries its own hash.
        const value = Object.freeze({ ...entry.value, records: Object.freeze(records),
          unloadedKnowledgeRefs: Object.freeze(unloaded.sort(compareCodeUnits)) });
        return [Object.freeze({ ...entry, value, revisionOrHash: canonicalHash(value) })];
      }
      // A group asked for gives up its line; its members not read follow the
      // listed lines as lines of their own, newest first.
      const groups = opened.get(entry.entryRef);
      if (groups !== undefined && entry.kind === "known" && isPlainRecord(entry.value) && Array.isArray(entry.value.unloaded)) {
        const refs = new Map(groups.entry.records.map(record => [record.handle, record.entryRef]));
        const handles = new Set(groups.groups.map(group => group.handle));
        const lines = groups.groups.flatMap(group => (group.members ?? []).filter(member => !requestedKnowledgeRefs.includes(refs.get(member.handle) ?? ""))
          .map(member => Object.freeze({ gist: member.gist, handle: member.handle })));
        const left = Array.isArray(entry.value.groups) ? entry.value.groups.filter(line => !(isPlainRecord(line) && handles.has(String(line.handle)))) : [];
        const { groups: _groups, ...rest } = entry.value;
        const value = Object.freeze({ ...rest, unloaded: Object.freeze([...entry.value.unloaded, ...lines]),
          ...(left.length === 0 ? {} : { groups: Object.freeze(left) }) });
        return [Object.freeze({ ...entry, value, revisionOrHash: canonicalHash(value) })];
      }
      return [entry];
    })),
    references: Object.freeze({ ...context.references,
      citations: Object.freeze({ ...citations,
        viewerEvidenceRefs: Object.freeze(citations.viewerEvidenceRefs.filter(cite)),
        authorityBasisRefs: Object.freeze(citations.authorityBasisRefs.filter(cite)),
        nonCitableRefs: Object.freeze(citations.nonCitableRefs.filter(cite)),
        npcKnowledge: Object.freeze(citations.npcKnowledge.flatMap(entry => hiddenNpcRefs.has(entry.npcRef) ? []
          : [Object.freeze({ ...entry, refs: Object.freeze(entry.refs.filter(keep)) })])) }) }) });
}

/** A body the selection brought back by handle, read from authority at the
 * version the frozen directory recorded; or the members of a group a stage
 * asked for, as Room listed them (ADR 0115). */
export type RecalledKnowledge = Readonly<{ entryRef: string; revisionOrHash: string; value: unknown }>;

/** The value of a recalled group: its members newest first, each with its
 * version, its directory line and its body's length, and the members whose
 * bodies the stage that asked for it read. */
export const KNOWLEDGE_GROUP_MEMBERS_SCHEMA = "zhuwei.knowledge-group-members/v1" as const;
type GroupMemberLine = Readonly<{ knowledgeRef: string; revisionOrHash: string; gist: string; characters: number }>;

/** The frozen context with the bodies the selection brought back by handle
 * (ADR 0051). Each must be a member of a holder's directory that this
 * context did not freeze, at exactly the version the directory recorded; it
 * then reads like a frozen body the topic did not reach -- hidden until a
 * stage requests it, citable once shown -- and an NPC's snapshot stops
 * listing it as unread (a vnext-3 snapshot lists it as read). A group Room
 * listed joins the recall references first, its members under the handles
 * the freeze reserved, once their pairs hash to the group's frozen hash
 * (ADR 0115). The binding is the frozen one: what the stages and lowering
 * read beyond it was fixed at the freeze. */
export function withRecalledKnowledge(frozenContext: VNextRequiredContext, recalled: readonly RecalledKnowledge[]): VNextRequiredContext {
  if (recalled.length === 0) return frozenContext;
  const groupLists = recalled.filter(record => isPlainRecord(record.value) && record.value.schema === KNOWLEDGE_GROUP_MEMBERS_SCHEMA);
  const context = groupLists.length === 0 ? frozenContext : withGroupMembers(frozenContext, groupLists);
  const bodies = recalled.filter(record => !groupLists.includes(record));
  if (bodies.length === 0) return context;
  const versions = new Map((context.references.knowledgeRecall ?? []).flatMap(entry => entry.records.flatMap(record =>
    record.revisionOrHash === undefined ? [] : [[record.entryRef, { holderRef: entry.holderRef, revisionOrHash: record.revisionOrHash }] as const])));
  const frozen = new Set(context.entries.map(entry => entry.entryRef));
  const added = [...new Map(bodies.map(record => [record.entryRef, record])).values()]
    .sort((left, right) => compareCodeUnits(left.entryRef, right.entryRef)).map(record => {
      const version = versions.get(record.entryRef);
      if (version === undefined || frozen.has(record.entryRef) || record.revisionOrHash !== version.revisionOrHash
        || !isPlainRecord(record.value) || canonicalHash(record.value) !== version.revisionOrHash
        || record.value.characterId !== version.holderRef || record.entryRef !== `knowledge:${version.holderRef}:${String(record.value.knowledgeRef)}`) {
        throw new TypeError(`knowledge-recall:body-invalid:${record.entryRef}`);
      }
      return { holderRef: version.holderRef, knowledgeRef: String(record.value.knowledgeRef),
        entry: Object.freeze({ kind: "known" as const, entryRef: record.entryRef, revisionOrHash: record.revisionOrHash, value: record.value as never }) };
    });
  const read = new Set(added.map(record => record.entry.entryRef));
  const entries = context.entries.map(entry => {
    if (entry.kind !== "known" || !isPlainRecord(entry.value) || !isNpcDecisionContextSchema(entry.value.schema)) return entry;
    // ADR 0115: a vnext-3 snapshot lists what the context read; a body brought
    // back joins that list at the version it was read at.
    const npcRef = String(entry.value.npcRef), listed = Array.isArray(entry.value.knowledge) ? entry.value.knowledge : [];
    const joined = npcDecisionListsReadKnowledge(entry.value.schema) ? added.filter(record => record.holderRef === npcRef
      && !listed.some(known => isPlainRecord(known) && known.entryRef === record.entry.entryRef))
      .map(record => Object.freeze({ knowledgeRef: record.knowledgeRef, entryRef: record.entry.entryRef, revisionOrHash: record.entry.revisionOrHash })) : [];
    const before = Array.isArray(entry.value.unloadedKnowledgeRefs) ? entry.value.unloadedKnowledgeRefs : [];
    const unloaded = before.filter(ref => !read.has(String(ref)));
    if (joined.length === 0 && unloaded.length === before.length) return entry;
    const { unloadedKnowledgeRefs: _unloaded, ...rest } = entry.value;
    // The reader binds a snapshot to the hash of its value.
    const value = Object.freeze({ ...rest, ...(joined.length === 0 ? {} : { knowledge: Object.freeze([...listed, ...joined]
      .sort((left, right) => compareCodeUnits(String((left as { entryRef: unknown }).entryRef), String((right as { entryRef: unknown }).entryRef)))) }),
      ...(unloaded.length === 0 ? {} : { unloadedKnowledgeRefs: Object.freeze(unloaded) }) });
    return Object.freeze({ ...entry, value, revisionOrHash: canonicalHash(value) });
  });
  const actor = context.intent.actorRef, citations = context.references.citations;
  const npcAdded = added.filter(record => record.holderRef !== actor);
  const npcHolders = [...new Set([...citations.npcKnowledge.map(entry => entry.npcRef), ...npcAdded.map(record => record.holderRef)])].sort(compareCodeUnits);
  const npcKnowledge = npcHolders.map(npcRef => {
    const existing = citations.npcKnowledge.find(entry => entry.npcRef === npcRef);
    const refs = [...new Set([...(existing?.refs ?? []), ...npcAdded.filter(record => record.holderRef === npcRef).map(record => record.entry.entryRef)])].sort(compareCodeUnits);
    return Object.freeze({ ...(existing ?? { npcRef }), npcRef, refs: Object.freeze(refs) });
  });
  const npcRecall = context.references.npcRecall?.map(entry => {
    const extra = npcAdded.filter(record => record.holderRef === entry.npcRef).map(record => record.entry.entryRef);
    return extra.length === 0 ? entry : Object.freeze({ ...entry, entryRefs: Object.freeze([...entry.entryRefs, ...extra].sort(compareCodeUnits)) });
  });
  return Object.freeze({ ...context, entries: Object.freeze([...entries, ...added.map(record => record.entry)]),
    references: Object.freeze({ ...context.references, ...(npcRecall === undefined ? {} : { npcRecall: Object.freeze(npcRecall) }),
      citations: Object.freeze({ ...citations, npcKnowledge: Object.freeze(npcKnowledge),
        viewerEvidenceRefs: Object.freeze([...new Set([...citations.viewerEvidenceRefs,
          ...added.filter(record => record.holderRef === actor).flatMap(record => [record.entry.entryRef, record.knowledgeRef])])]) }) }) });
}

/** Reads the bodies `requested` names that the frozen context left in a
 * directory, from `knowledge` (the holders' current records), at the
 * recorded versions. Bodies the context froze are not read again, and a body
 * over the per-record cap is refused as freezing would have refused it. */
export function recallKnowledgeBodies(context: VNextRequiredContext, requested: readonly string[],
  knowledge: Readonly<Record<string, Readonly<Record<string, unknown>>>>): readonly RecalledKnowledge[] {
  const frozen = new Set(context.entries.map(entry => entry.entryRef));
  return (context.references.knowledgeRecall ?? []).flatMap(entry => entry.records.flatMap(record => {
    if (record.revisionOrHash === undefined || frozen.has(record.entryRef) || !requested.includes(record.entryRef)) return [];
    const value = knowledge[entry.holderRef]?.[record.entryRef.slice(`knowledge:${entry.holderRef}:`.length)];
    if (value === undefined || canonicalHash(value) !== record.revisionOrHash) throw new TypeError(`knowledge-recall:body-changed:${record.entryRef}`);
    if (canonicalUnits(value) * 4 > VNEXT_CONTEXT_WORK_BUDGET.caps.maxEntryRereadBytes) throw new TypeError(`knowledge-recall:body-too-large:${record.entryRef}`);
    return [Object.freeze({ entryRef: record.entryRef, revisionOrHash: record.revisionOrHash, value })];
  }));
}

/** SPEC 0016 §4.3 (ADR 0115): Room's read for one stage's request, from
 * `state` (authority now). First the groups it asks for whose members are
 * not listed yet: the holder's records as of the freeze are grouped again,
 * the same way and leaving out the same records (bodies the freeze read and
 * lines it listed); the group's members must hash to the frozen
 * `membersHash`, or the read fails as stale. Their newest bodies are read
 * within the holder's loading limits, across this stage's new groups of
 * one holder in directory order, and the rest are listed by handle. Then
 * the bodies asked for by handle, as `recallKnowledgeBodies` reads them. */
export function recallKnowledge(context: VNextRequiredContext, requested: readonly string[],
  state: AuthoritativeWorldState): readonly RecalledKnowledge[] {
  const lists = knowledgeGroupLists(context, requested, state);
  const listed = withRecalledKnowledge(context, lists);
  return Object.freeze([...lists, ...recallKnowledgeBodies(listed, proposalReadKnowledgeRefs(listed, requested), state.knowledge)]);
}

function knowledgeGroupLists(context: VNextRequiredContext, requested: readonly string[],
  state: AuthoritativeWorldState): readonly RecalledKnowledge[] {
  const present = new Set(context.entries.map(entry => entry.entryRef));
  return (context.references.knowledgeRecall ?? []).flatMap(entry => {
    const asked = (entry.groups ?? []).filter(group => group.members === undefined && requested.includes(group.groupRef));
    if (asked.length === 0) return [];
    const holderRef = entry.holderRef, prefix = `knowledge:${holderRef}:`;
    // What the freeze left out of every group: the bodies it read (a body
    // brought back later carries a version in the recall references) and the
    // lines it listed (a member of a group Room listed is not one of them).
    const versioned = new Set(entry.records.flatMap(record => record.revisionOrHash === undefined ? [] : [record.entryRef]));
    const membersOfLists = new Set((entry.groups ?? []).flatMap(group => (group.members ?? []).map(member => member.handle)));
    const excluded = new Set([
      ...context.entries.flatMap(known => known.entryRef.startsWith(prefix) && !versioned.has(known.entryRef) ? [known.entryRef] : []),
      ...entry.records.flatMap(record => membersOfLists.has(record.handle) ? [] : [record.entryRef]),
    ].map(ref => ref.slice(prefix.length)));
    const records = knowledgeHeldAt(state, holderRef, context.binding.baseEventSeq);
    const groups = knowledgeGroups(state, holderRef, records, new Set(records.map(record => record.knowledgeRef).filter(ref => !excluded.has(ref))));
    const budget = { records: 0, characters: 0, full: false };
    return asked.map(group => {
      const found = groups.find(candidate => candidate.groupRef === group.groupRef);
      const members = found === undefined ? undefined : knowledgeGroupMembers(state, holderRef, found.members);
      if (members === undefined || members.length !== group.count || knowledgeGroupMembersHash(members) !== group.membersHash) {
        throw new TypeError(`knowledge-recall:group-changed:${group.groupRef}`);
      }
      const lines: GroupMemberLine[] = members.map(member => Object.freeze({ ...member,
        gist: knowledgeGist({ content: authorityKnowledgeText(state, holderRef, member.knowledgeRef) ?? "内容暂不可读取" }),
        characters: JSON.stringify(state.knowledge[holderRef]?.[member.knowledgeRef]?.content ?? null).length }));
      const read: string[] = [];
      for (const line of lines) {
        const entryRef = `${prefix}${line.knowledgeRef}`;
        if (budget.full || present.has(entryRef)) continue;
        if (budget.records + 1 > VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedRecords
          || budget.characters + line.characters > VNEXT_KNOWLEDGE_RELEVANCE_PROFILE.maxLoadedCharacters) { budget.full = true; continue; }
        budget.records += 1; budget.characters += line.characters;
        read.push(entryRef);
      }
      return Object.freeze({ entryRef: group.groupRef, revisionOrHash: group.membersHash,
        value: Object.freeze({ schema: KNOWLEDGE_GROUP_MEMBERS_SCHEMA, holderRef, members: Object.freeze(lines), read: Object.freeze(read) }) });
    });
  });
}

/** The recall references with the groups Room listed (ADR 0115). */
function withGroupMembers(context: VNextRequiredContext, lists: readonly RecalledKnowledge[]): VNextRequiredContext {
  const invalid = (ref: string): never => { throw new TypeError(`knowledge-recall:group-invalid:${ref}`); };
  const byGroup = new Map(lists.map(record => [record.entryRef, record]));
  if (byGroup.size !== lists.length) invalid("duplicate");
  let used = 0;
  const knowledgeRecall = (context.references.knowledgeRecall ?? []).map(entry => {
    const prefix = `knowledge:${entry.holderRef}:`, added: { handle: string; entryRef: string; revisionOrHash: string }[] = [];
    const groups = (entry.groups ?? []).map(group => {
      const record = byGroup.get(group.groupRef);
      if (record === undefined) return group;
      const value = record.value;
      if (group.members !== undefined || record.revisionOrHash !== group.membersHash || !isPlainRecord(value)
        || value.holderRef !== entry.holderRef || !Array.isArray(value.members) || value.members.length !== group.count
        || !Array.isArray(value.read)) return invalid(group.groupRef);
      const members = value.members.map(member => isPlainRecord(member) && typeof member.knowledgeRef === "string"
        && typeof member.revisionOrHash === "string" && /^sha256:[0-9a-f]{64}$/u.test(member.revisionOrHash)
        && typeof member.gist === "string" && Number.isSafeInteger(member.characters) && Number(member.characters) >= 0
        ? member as GroupMemberLine : invalid(group.groupRef));
      const entryRefs = members.map(member => `${prefix}${member.knowledgeRef}`);
      if (knowledgeGroupMembersHash(members) !== group.membersHash || new Set(value.read).size !== value.read.length
        || value.read.some(ref => typeof ref !== "string" || !entryRefs.includes(ref))
        || entryRefs.some(ref => entry.records.some(existing => existing.entryRef === ref))) return invalid(group.groupRef);
      used += 1;
      const handle = (index: number) => `m${group.firstMember + index}`;
      added.push(...members.map((member, index) => ({ handle: handle(index), entryRef: entryRefs[index]!, revisionOrHash: member.revisionOrHash })));
      return Object.freeze({ ...group, members: Object.freeze(members.map((member, index) => Object.freeze({ handle: handle(index),
        gist: member.gist, characters: member.characters }))), read: Object.freeze([...value.read as string[]]) });
    });
    return added.length === 0 ? entry : Object.freeze({ ...entry, records: Object.freeze([...entry.records, ...added.map(record => Object.freeze(record))]),
      groups: Object.freeze(groups) });
  });
  if (used !== lists.length) invalid("unknown-group");
  return Object.freeze({ ...context, references: Object.freeze({ ...context.references, knowledgeRecall: Object.freeze(knowledgeRecall) }) });
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
      || !isNpcDecisionContextSchema(entry.value.schema) || typeof entry.value.npcRef !== "string") return [];
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

/** Visible scene definitions and incomplete map objects in the actor's
 * scene. SPEC 0016 §7.2: native NPC, Item and terrain gaps share this surface. */
export function proposalCompletableObjectRefs(context: VNextRequiredContext, completionKind?: VNextObjectCompletionKind): readonly string[] {
  const visible = new Set(context.references.citations.viewerEvidenceRefs);
  const actor = context.entries.find(entry => entry.kind === "known" && entry.entryRef === context.intent.actorRef);
  const sceneRef = actor?.kind === "known" && isPlainRecord(actor.value) && isPlainRecord(actor.value.entity)
    ? actor.value.entity.sceneId : undefined;
  if (typeof sceneRef !== "string") return Object.freeze([]);
  const definitions = new Map(context.entries.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value) ? [[entry.entryRef, entry.value] as const] : []));
  return Object.freeze(context.entries.flatMap(entry => entry.kind === "known"
    && visible.has(entry.entryRef) && isPlainRecord(entry.value)
    && (((completionKind === undefined || completionKind === "object") && entry.value.schema === VNEXT_STORED_SEMANTIC_DEFINITION_SCHEMA && entry.value.definitionId === entry.entryRef
      && entry.value.semanticKind === "sceneFeature" && isPlainRecord(entry.value.content) && entry.value.content.sceneRef === sceneRef)
      || incompleteObjectRecord(entry.value, entry.entryRef, sceneRef, definitions, completionKind))
    ? [entry.entryRef] : []).sort(compareCodeUnits));
}

/** A frozen geometry record of an object in `sceneRef` with no state graph or durability yet. */
function incompleteObjectRecord(value: Record<string, unknown>, ref: string, sceneRef: string,
  definitions: ReadonlyMap<string, Record<string, unknown>>, completionKind?: VNextObjectCompletionKind): boolean {
  const wants = (kind: VNextObjectCompletionKind) => completionKind === undefined || completionKind === kind;
  if (isPlainRecord(value.entity) && value.entity.kind === "npc" && value.entity.id === ref && value.entity.sceneId === sceneRef
    && isNpcSpatialShell(value.combat)) return wants("npcCombat");
  if (value.schema === "zhuwei.item-entry/v1" && value.entryId === ref && ["held", "scene"].includes(String(value.disposition))
    && value.assemblyRef === undefined) {
    const definition = typeof value.definitionRef === "string" ? definitions.get(value.definitionRef) : undefined;
    const content = definition && isPlainRecord(definition.content) ? definition.content : undefined;
    if (wants("itemDefinition") && content && Array.isArray(content.undeterminedFields) && content.undeterminedFields.length > 0) return true;
    if (wants("object") && content?.stackable === false && value.quantity === 1 && value.stateMachine === undefined) return true;
  }
  const feature = value.feature;
  return value.sceneRef === sceneRef && isPlainRecord(feature) && feature.featureId === ref && feature.environment === undefined
    && ((wants("object") && feature.stateGraph === undefined) || (wants("durability") && feature.durability === undefined)
      || (wants("terrain") && (feature.kind === "terrain" || feature.landform !== undefined)
        && (feature.landform === undefined || feature.material === undefined
          || (["ditch", "water"].includes(String(feature.landform)) && feature.depth === undefined)
          || (feature.landform === "water" && feature.current === undefined))));
}

/** SPEC 0016 §7.2 (ADR 0128): omit completion where the frozen view
 * contains no existing object with a supported undecided dimension. */
export function proposalUnofferedCapabilities(context: VNextRequiredContext): readonly string[] {
  return Object.freeze([
    ...VNEXT_OBJECT_COMPLETION_CAPABILITIES.filter(capability => proposalCompletableObjectRefs(context, capability.completionKind).length === 0).map(capability => capability.id),
    // SPEC 0012 §13 (ADR 0112): ending a fight is offered only to an actor in
    // one; its frozen record carries the encounter marker.
    ...(proposalActorInEncounter(context) ? [] : ["endCombat"]),
  ]);
}

/** Whether the actor's frozen record shows it inside a running encounter
 * (the marker `authorityEntityComposite` adds). */
export function proposalActorInEncounter(context: VNextRequiredContext): boolean {
  const actor = context.entries.find(entry => entry.kind === "known" && entry.entryRef === context.intent.actorRef);
  return actor?.kind === "known" && isPlainRecord(actor.value) && isPlainRecord(actor.value.encounter)
    && actor.value.encounter.status !== "concluded";
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

const SERVER_HASH = /^sha256:[0-9a-f]{64}$/;

/** Presentation only: a server-owned hash leaves wherever it sits, as a field
 * value or an array member. The model neither chooses nor reproduces one, and
 * Room and lowering read them from the frozen context. */
function withoutServerHashes<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value
    .filter(item => !(typeof item === "string" && SERVER_HASH.test(item))).map(withoutServerHashes)) as T;
  if (!isPlainRecord(value)) return value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([, item]) => !(typeof item === "string" && SERVER_HASH.test(item)))
    .map(([key, item]) => [key, withoutServerHashes(item)]))) as T;
}

/** What one call's presentation reads beside the entry it presents: the
 * refs the view sends, the memory and perception fact values among them, and
 * every perception fact the context froze as an entry. */
type ModelPresentation = Readonly<{
  known: ReadonlySet<string>;
  memories: ReadonlyMap<string, Record<string, unknown>>;
  perceptions: ReadonlyMap<string, Record<string, unknown>>;
  frozenPerceptions: ReadonlySet<string>;
  /** Scene entry ref to the geometry it carries. */
  sceneGeometries: ReadonlyMap<string, unknown>;
}>;

/** Presentation only: one memory without the ids its entry already names --
 * its holder and knowledge ref, the server events that delivered it -- and,
 * when it is its holder's perception of a fact the view sends, pointing at
 * that fact for the evidence both carry. */
function memoryModelValue(value: Record<string, unknown>, presentation: ModelPresentation): Record<string, unknown> {
  const { characterId, knowledgeRef, acquiredByEventId: _event, provenanceChain, content, ...rest } = value;
  const provenance = Array.isArray(provenanceChain)
    ? provenanceChain.filter(ref => typeof ref !== "string" || (ref !== knowledgeRef && !ref.startsWith("event:"))) : provenanceChain;
  const fact = presentation.perceptions.get(String(knowledgeRef))?.value;
  const perceived = isPlainRecord(fact) && fact.observerRef === characterId && typeof content === "string" && fact.evidence === content;
  return Object.freeze({ ...rest, ...(perceived ? { sameAsEntryRef: knowledgeRef } : { content }),
    ...(Array.isArray(provenance) && provenance.length === 0 ? {} : { provenanceChain: provenance }) });
}

function isMemoryEntry(entryRef: string, value: Record<string, unknown>): boolean {
  return typeof value.characterId === "string" && typeof value.knowledgeRef === "string"
    && entryRef === `knowledge:${value.characterId}:${value.knowledgeRef}`;
}

/** Presentation only: server-owned version hashes leave, and a body that
 * already has its own entry is listed by ref -- a fact or definition inside
 * the module constraint frame, an NPC's identity and the facts it sees inside
 * its decision view, the words of a claim it holds, and the location anchor's
 * geometry when the scene entry carries the same one. A directory line is its
 * gist and handle. Nothing here changes which facts, records or knowledge the
 * model may read or cite; Room and lowering keep reading the frozen context
 * itself. */
function modelEntryValue(value: Record<string, unknown>, presentation: ModelPresentation): Record<string, unknown> {
  const { known, memories, frozenPerceptions, sceneGeometries } = presentation;
  // ADR 0083: who tried what on which refs and how it was ruled. The frozen
  // context's hash, the KP-only basis, the ruleset and the outcome range stay
  // in the record for Rules and audit.
  if (isVNextRulingPrecedent(value)) {
    const { precedentId, actorCharacterId, recordedEventSeq, intent, method, conditionSignature, publicExplanation, ruling } = value;
    return Object.freeze({ precedentId, actorCharacterId, recordedEventSeq, intent, method,
      targetRefs: conditionSignature.targetRefs, instrumentRefs: conditionSignature.instrumentRefs, publicExplanation,
      ruling: ruling.kind === "check"
        ? Object.freeze({ kind: ruling.kind, ...(ruling.abilityRef === null ? {} : { abilityRef: ruling.abilityRef }), checkKind: ruling.checkKind,
          ability: ruling.ability, skill: ruling.skill, ...(ruling.opposition === undefined ? { dc: ruling.dc } : { opposition: ruling.opposition }),
          outcome: ruling.outcome })
        : Object.freeze({ kind: ruling.kind, rulingKind: ruling.rulingKind, prerequisites: ruling.prerequisites }) });
  }
  if (isNpcDecisionContextSchema(value.schema)) {
    const { projectionHash: _projection, unloadedKnowledgeRefs, ...rest } = value;
    const unloaded = new Set(Array.isArray(unloadedKnowledgeRefs) ? unloadedKnowledgeRefs : []);
    const npcRef = String(value.npcRef);
    const shownKnowledge = Array.isArray(value.knowledge) ? value.knowledge.flatMap(record => isPlainRecord(record)
      ? (unloaded.has(String(record.entryRef)) ? [] : [record.entryRef]) : [record]) : [];
    // vnext-3 lists only what was read; its catalog record counts the rest
    // (ADR 0115). Earlier views list every memory and mark the unread ones.
    const catalog = Array.isArray(value.records) ? value.records.find(record => isPlainRecord(record) && record.kind === "knowledgeCatalog") : undefined;
    const held = isPlainRecord(catalog) && isPlainRecord(catalog.value) && typeof catalog.value.count === "number" ? catalog.value.count : undefined;
    return Object.freeze({ ...rest,
      // Only memories whose bodies this action read are listed; the NPC holds
      // `unloadedKnowledgeCount` more that cannot be cited or paraphrased. The
      // catalog's version stays in the frozen entry for Rules to verify.
      knowledge: Array.isArray(value.knowledge) ? Object.freeze(shownKnowledge) : value.knowledge,
      unloadedKnowledgeCount: held === undefined ? unloaded.size : held - shownKnowledge.length,
      records: Array.isArray(value.records) ? Object.freeze(value.records.map(record => {
        if (!isPlainRecord(record)) return record;
        const { revisionOrHash: _revision, ...presented } = record;
        // The catalog binds versions for Rules, as a holder's own catalog
        // entry does, and would list memories this action did not read. An
        // identity or a fact that is an entry of its own is read there.
        if (record.kind === "knowledgeCatalog" || ((record.kind === "identity" || record.kind === "fact")
          && typeof record.ref === "string" && known.has(record.ref))) {
          return Object.freeze({ ref: record.ref, kind: record.kind });
        }
        if (record.kind === "sourceClaim" && isPlainRecord(record.value)) {
          // The words, layer, source and moment are the NPC's memory of the
          // claim; what stays is who said it and, for its own, why.
          const memoryRef = `knowledge:${npcRef}:${String(record.value.claimId)}`;
          const { claimId: _claim, semanticContent, layer: _layer, sourceCharacterId: _source, acquiredAtFictionMicros: _at, ...claim } = record.value;
          const memory = memories.get(memoryRef);
          if (memory !== undefined && sameCanonical(memory.content ?? null, semanticContent ?? null)) {
            return Object.freeze({ ...presented, value: Object.freeze({ sameAsEntryRef: memoryRef, ...claim }) });
          }
        }
        if (record.kind === "conversation" && isPlainRecord(record.value)) {
          // Server identities of the exchange leave; the player's words stay
          // unless a sent memory of the claim they made carries them.
          const { rootActionId: _root, resolutionId: _resolution, updatedByEventId: _event, playerExpression, ...conversation } = record.value;
          const claimRef = String(record.value.claimRef);
          const said = typeof playerExpression === "string" && [npcRef, String(record.value.actorCharacterId)].some(holder =>
            memories.get(`knowledge:${holder}:${claimRef}`)?.content === playerExpression);
          return Object.freeze({ ...presented, value: Object.freeze(said ? conversation : { ...conversation, playerExpression }) });
        }
        return Object.freeze({ ...presented,
          value: isPlainRecord(record.value) ? modelEntryValue(record.value, presentation) : record.value });
      })) : value.records });
  }
  if (KNOWLEDGE_DIRECTORY_SCHEMAS.includes(String(value.schema)) && Array.isArray(value.unloaded)) {
    // The refs of an unread body cannot be cited; the selection names a
    // handle, and a line without one only says the memory exists. A group
    // line is its label, its count and its handle (ADR 0111).
    return Object.freeze({ ...value, unloaded: Object.freeze(value.unloaded.map(line => isPlainRecord(line)
      ? Object.freeze({ gist: line.gist, ...(line.handle === undefined ? {} : { handle: line.handle }) }) : line)),
      ...(Array.isArray(value.groups) ? { groups: Object.freeze(value.groups.map(line => isPlainRecord(line)
        ? Object.freeze({ label: line.label, count: line.count, ...(line.handle === undefined ? {} : { handle: line.handle }),
          ...(Array.isArray(line.summaries) ? { summaries: line.summaries.flatMap(hint => isPlainRecord(hint)
            ? [{ summary: hint.summary, sourceCount: hint.sourceCount }] : []) } : {}) }) : line)) } : {}) });
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
    const definitions = value.factConstraints.definitions;
    const anchor = isPlainRecord(value.currentLocationAnchor) ? value.currentLocationAnchor : undefined;
    const sceneGeometry = anchor !== undefined && typeof anchor.sceneId === "string" ? sceneGeometries.get(anchor.sceneId) : undefined;
    const sameGeometry = anchor !== undefined && sceneGeometry !== undefined && isPlainRecord(anchor.tacticalGeometry)
      && sameCanonical(sceneGeometry, anchor.tacticalGeometry) ? anchor.sceneId as string : undefined;
    return Object.freeze({ ...rest,
      ...(anchor === undefined || sameGeometry === undefined ? {} : { currentLocationAnchor: Object.freeze({ ...anchor,
        tacticalGeometry: Object.freeze({ sameAsEntryRef: sameGeometry }) }) }),
      factConstraints: Object.freeze({ ...value.factConstraints,
        // A perception is read in its own entry, which travels exactly when
        // its observer's memory does. Listing it here would make this frame
        // differ between the selection and the filling whenever a handle
        // brings one back, and end the shared cache prefix at this entry.
        facts: Object.freeze(value.factConstraints.facts.flatMap(fact =>
          isPlainRecord(fact) && typeof fact.id === "string" && frozenPerceptions.has(fact.id) ? []
            : isPlainRecord(fact) && typeof fact.id === "string" && known.has(fact.id)
              ? [Object.freeze({ id: fact.id, kind: fact.kind, subjectRefs: fact.subjectRefs, entryRef: fact.id })] : [fact])),
        ...(Array.isArray(definitions) ? { definitions: Object.freeze(definitions.map(record =>
          isPlainRecord(record) && typeof record.ref === "string" && known.has(record.ref)
            ? Object.freeze({ ref: record.ref }) : record)) } : {}) }) });
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
/** The view's entries with those whose presentation depends on what the
 * selection asked to load -- a bystander's view, a memory body, a decision
 * snapshot that lists withheld memories -- after all the others, each group in
 * frozen order. The others print the same in every call of one action, so the
 * filling's context repeats the selection's up to the first entry the
 * selection loaded or changed: a longer provider cache prefix (ADR 0044). */
function selectionIndependentEntriesFirst(context: VNextRequiredContext, entries: VNextRequiredContext["entries"]): VNextRequiredContext["entries"] {
  const frozen = new Set(context.entries);
  // A directory with group lines changes when a group is asked for (ADR 0111),
  // and an NPC's snapshot when one of its memories is brought back: a vnext-3
  // snapshot lists the memories read (ADR 0115).
  const changing = new Set((context.references.knowledgeRecall ?? []).flatMap(entry =>
    [npcDecisionEntryRef(entry.holderRef), ...((entry.groups ?? []).length === 0 ? [] : [knowledgeDirectoryEntryRef(entry.holderRef)])]));
  const independent = new Set(proposalContextView(context).entries.filter(entry => frozen.has(entry) && !changing.has(entry.entryRef))
    .map(entry => entry.entryRef));
  return [...entries.filter(entry => independent.has(entry.entryRef)), ...entries.filter(entry => !independent.has(entry.entryRef))];
}

export function proposalModelContext(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  requestedKnowledgeRefs: readonly string[] = []) {
  const view = proposalContextView(context, requestedNpcRefs, requestedKnowledgeRefs);
  const recall = context.references.npcRecall ?? [];
  const shown = recall.filter(entry => entry.role === "default" || requestedNpcRefs.includes(entry.npcRef)).map(entry => entry.npcRef);
  const requestable = recall.filter(entry => entry.role === "requestable" && !requestedNpcRefs.includes(entry.npcRef)).map(entry => entry.npcRef);
  const handles = proposalKnowledgeRecall(context, requestedNpcRefs, requestedKnowledgeRefs);
  const read = proposalReadKnowledgeRefs(context, requestedKnowledgeRefs);
  const subjects = new Set(proposalObservationSubjectRefs(view));
  const known = new Set(view.entries.flatMap(entry => entry.kind === "known" ? [entry.entryRef] : []));
  const { domains: _domains, ...directory } = view.references;
  const values = view.entries.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value) ? [[entry.entryRef, entry.value] as const] : []);
  const presentation: ModelPresentation = Object.freeze({ known,
    memories: new Map(values.filter(([entryRef, value]) => isMemoryEntry(entryRef, value))),
    perceptions: new Map(values.filter(([entryRef, value]) => value.id === entryRef && value.kind === "worldInteractionSensoryEvidence")),
    frozenPerceptions: new Set(context.entries.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value)
      && entry.value.id === entry.entryRef && entry.value.kind === "worldInteractionSensoryEvidence" ? [entry.entryRef] : [])),
    sceneGeometries: new Map(values.flatMap(([entryRef, value]) => isPlainRecord(value.combatScene) && isPlainRecord(value.combatScene.geometry)
      ? [[entryRef, value.combatScene.geometry] as const] : [])) });
  return Object.freeze({
    schema: VNEXT_PROPOSAL_CONTEXT_SCHEMA,
    contextHash: view.binding.contextHash,
    intent: view.intent,
    // A holder's knowledge catalog binds versions for Rules; the model reads
    // the loaded bodies and the gist directory instead. The question history
    // is the server's (ADR 0083).
    entries: Object.freeze(selectionIndependentEntriesFirst(context, view.entries).filter(entry => !(entry.kind === "known" && entry.entryRef.startsWith("knowledge-catalog:"))
      && !isRetryHistoryEntryRef(entry.entryRef)).map(entry => {
      if (entry.kind !== "known") return withoutServerHashes(entry);
      const { revisionOrHash: _revision, ...presented } = entry;
      const value = !isPlainRecord(entry.value) ? entry.value
        : subjects.has(entry.entryRef) ? worldSubjectModelValue(entry.value)
          : isMemoryEntry(entry.entryRef, entry.value) ? memoryModelValue(entry.value, presentation)
            : modelEntryValue(entry.value, presentation);
      return Object.freeze({ ...presented, value: withoutServerHashes(value) });
    })),
    // The domain index sorts the same refs by type for the server; the model
    // reads the entries themselves.
    references: Object.freeze({ ...directory, npcRecall: Object.freeze({ shown: Object.freeze(shown), requestable: Object.freeze(requestable) }),
      knowledgeRecall: Object.freeze({ shown: Object.freeze(handles.filter(record => record.kind === "memory" && read.includes(record.entryRef)).map(record => record.entryRef)),
        requestable: Object.freeze(handles.filter(record => !read.includes(record.entryRef)).map(record => record.handle)) }),
      observationSubjectRefs: proposalObservationSubjectRefs(view),
      npcSourceChoices: proposalNpcSourceChoices(view), itemEntryRefs: proposalItemEntryRefs(view),
      itemDefinitionRefs: proposalItemDefinitionRefs(view) }),
  });
}

/** SPEC 0006 §7 (ADR 0073): what one NPC's own call reads of a frozen context.
 * `entries` are that NPC's decision snapshot, the memory bodies frozen with it
 * and its directory of unread memories, presented as the proposal view presents
 * them. `present` names what stands in the scene, by the same surface the
 * ruling's forms choose from. The host's frame, the definitions and facts only
 * the host reads, another holder's memory and the actor's intent are no part
 * of it. Neither is the identity's list of what the NPC does not know: it is
 * written for the host, and its entries name the very things the NPC has
 * never heard of. Undefined when the context froze no verified snapshot of
 * this NPC. */
export type NpcOwnModelView = Readonly<{
  npcRef: string;
  entries: readonly Readonly<{ kind: "known"; entryRef: string; value: unknown }>[];
  present: readonly Readonly<{ ref: string; name: string }>[];
  /** What this NPC's words may cite, and the facts it can see. */
  sources: Readonly<{ refs: readonly string[]; factRefs: readonly string[] }>;
}>;
export function npcOwnModelView(context: VNextRequiredContext, npcRef: string): NpcOwnModelView | undefined {
  const snapshot = npcDecisionContext(context.entries, npcRef);
  const sources = proposalNpcSourceChoices(context).find(choice => choice.npcRef === npcRef);
  if (!snapshot || !sources) return undefined;
  const loaded = new Set(npcDecisionLoadedKnowledge(snapshot).map(record => record.entryRef));
  const own = context.entries.filter(entry => entry.kind === "known" && (entry.entryRef === npcDecisionEntryRef(npcRef)
    || loaded.has(entry.entryRef) || entry.entryRef === `knowledge-directory:${npcRef}`));
  const values = own.flatMap(entry => entry.kind === "known" && isPlainRecord(entry.value) ? [[entry.entryRef, entry.value] as const] : []);
  // Only this holder's own entries are "known": a record of the snapshot whose
  // body the host reads in an entry of its own is presented here in full.
  const presentation: ModelPresentation = Object.freeze({ known: new Set(own.map(entry => entry.entryRef)),
    memories: new Map(values.filter(([entryRef, value]) => isMemoryEntry(entryRef, value))),
    perceptions: new Map(), frozenPerceptions: new Set<string>(), sceneGeometries: new Map() });
  const label = (ref: string): string | undefined => {
    const entry = context.entries.find(candidate => candidate.kind === "known" && candidate.entryRef === ref);
    const value = entry?.kind === "known" && isPlainRecord(entry.value) ? entry.value : undefined;
    if (value === undefined) return undefined;
    for (const [group, field] of [["entity", "name"], ["scene", "name"], ["feature", "label"], ["content", "label"]] as const) {
      const holder = value[group];
      if (isPlainRecord(holder) && typeof holder[field] === "string") return holder[field] as string;
    }
    // A thing is named by its kind of thing; its description is not the NPC's.
    return typeof value.definitionRef === "string" ? label(value.definitionRef) : undefined;
  };
  const ownRecords = (value: unknown): unknown => !isPlainRecord(value) || !Array.isArray(value.records) ? value
    : { ...value, records: value.records.map(record => {
      if (!isPlainRecord(record) || record.kind !== "identity" || !isPlainRecord(record.value)) return record;
      const { initialUnknowns: _unknowns, ...identity } = record.value;
      return { ...record, value: identity };
    }) };
  return Object.freeze({ npcRef,
    entries: Object.freeze(own.flatMap(entry => entry.kind !== "known" ? [] : [Object.freeze({ kind: "known" as const, entryRef: entry.entryRef,
      value: withoutServerHashes(!isPlainRecord(entry.value) ? entry.value
        : isMemoryEntry(entry.entryRef, entry.value) ? memoryModelValue(entry.value, presentation)
          : ownRecords(modelEntryValue(entry.value, presentation))) })])),
    present: Object.freeze(proposalObservationSubjectRefs(context).flatMap(ref => {
      const name = label(ref);
      return name === undefined ? [] : [Object.freeze({ ref, name })];
    })),
    sources: Object.freeze({ refs: sources.refs, factRefs: sources.factRefs }) });
}

/** SPEC 0016 §7.2 (ADR 0081): the conversation records the NPC decision
 * views hold as the selection is sent them; a context without entries has
 * none. */
export function proposalConversationRecords(context: VNextRequiredContext): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(context.entries)) return [];
  return proposalContextView(context).entries.flatMap(entry =>
    entry.kind === "known" && isPlainRecord(entry.value) && isNpcDecisionContextSchema(entry.value.schema) && Array.isArray(entry.value.records)
      ? entry.value.records.flatMap(record => isPlainRecord(record) && record.kind === "conversation" && isPlainRecord(record.value) ? [record.value] : [])
      : []);
}

/** The exact bytes every call of one action sends for its frozen context.
 * A selection, its filling round and a repair round that load the same views
 * must produce the identical string: it follows the reading guide in the
 * system message, and a provider prefix cache can only reuse it while it
 * stays byte-identical. */
export function vnextProposalContextBody(context: VNextRequiredContext, requestedNpcRefs: readonly string[] = [],
  requestedKnowledgeRefs: readonly string[] = []): string {
  return JSON.stringify({ requiredContext: proposalModelContext(context, requestedNpcRefs, requestedKnowledgeRefs) });
}
