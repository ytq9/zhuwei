import {
  isStoredSemanticDefinition,
  VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS,
  type AuthoritativeWorldState,
  type SemanticDefinitionKind,
  type StoredSemanticDefinition,
} from "../../../rules/authority-read";
import { compareCodeUnits, isPlainRecord } from "../canonical-json";
import type { ContextWorkBudget, ContextWorkReceipt } from "./work-budget";

/**
 * A lightweight directory over one frozen authority snapshot.
 *
 * The index holds addressing only — ref, closed kind, scope, typed relation
 * endpoints and the few keys needed to authorize a reread. Bodies stay in
 * authority state and are reread from that same snapshot, so the index can be
 * rebuilt at will and never becomes a second source of truth.
 *
 * `revisionOrHash` is deliberately absent. Resolving it eagerly would hash
 * every record in the campaign on every action, which is exactly the wide cost
 * this pipeline exists to remove; refs that actually enter the context resolve
 * their binding at reread time instead.
 */
export type AuthorityRefKind =
  | "scene"
  | "entity"
  | "itemEntry"
  | "itemDefinition"
  | "semanticDefinition"
  | "campaignDefinition"
  | "abilityDefinition"
  | "canonicalFact"
  | "knowledge"
  | "continuityCollection"
  | "continuityEntry"
  | "profileContext";

/**
 * A typed world relation read from its declared top-level content fields. The
 * previous collector recursively searched for the first nested `subjectRef`
 * anywhere in the definition, which could bind an edge to an incidental field
 * of an unrelated substructure.
 */
export type TypedRelationEdge = Readonly<{
  relationRef: string;
  relationKind: string;
  subjectRef: string;
  objectRef: string;
  state: string;
}>;

export type ReferenceNode = Readonly<{
  ref: string;
  kind: AuthorityRefKind;
  semanticKind?: SemanticDefinitionKind;
  visibilityPolicyRef?: string;
  templateRef?: string;
  templateHash?: string;
  /** Scene the record is bound to, when authority state binds it to one. */
  sceneRef?: string;
  /** Item entries only: the entity currently holding the entry. */
  holderRef?: string;
  /** Item entries only: the definition the entry instantiates. */
  definitionRef?: string;
  /** Canonical facts only: the refs the fact is asserted about. */
  subjectRefs?: readonly string[];
  /** Knowledge only: the character whose limited slice this belongs to. */
  knowledgeHolderRef?: string;
  /** Continuity entries only: the collection the entry belongs to. */
  continuityCollection?: string;
}>;

export type ReferenceIndex = Readonly<{
  nodes: ReadonlyMap<string, ReferenceNode>;
  /** subjectRef -> outgoing typed relations. */
  relationsBySubject: ReadonlyMap<string, readonly TypedRelationEdge[]>;
  /** objectRef -> incoming typed relations. `blocks`/`triggers` are only
   * reachable from the object end, so both directions are indexed. */
  relationsByObject: ReadonlyMap<string, readonly TypedRelationEdge[]>;
  /** subjectRef -> canonical fact refs asserted about it. */
  factsBySubject: ReadonlyMap<string, readonly string[]>;
  /** holder characterRef -> knowledge refs in that holder's slice. */
  knowledgeByHolder: ReadonlyMap<string, readonly string[]>;
  /** holder characterRef -> item entries that character is carrying. Bounded
   * by the holder, unlike a scene-wide inventory sweep. */
  itemEntriesByHolder: ReadonlyMap<string, readonly string[]>;
  /** itemDefinitionRef -> entries instantiating it. Lets a definition the
   * player named resolve to the instances actually present. */
  itemEntriesByDefinition: ReadonlyMap<string, readonly string[]>;
  /** sceneRef -> refs authority state binds to that scene. */
  refsByScene: ReadonlyMap<string, readonly string[]>;
}>;

export type ReferenceIndexResult =
  | Readonly<{ kind: "indexed"; index: ReferenceIndex }>
  | Readonly<{ kind: "preparationLimit"; receipt: ContextWorkReceipt }>;

export function buildReferenceIndex(
  state: AuthoritativeWorldState,
  budget: ContextWorkBudget,
): ReferenceIndexResult {
  const nodes = new Map<string, ReferenceNode>();
  const relationsBySubject = new Map<string, TypedRelationEdge[]>();
  const relationsByObject = new Map<string, TypedRelationEdge[]>();
  const factsBySubject = new Map<string, string[]>();
  const knowledgeByHolder = new Map<string, string[]>();
  const itemEntriesByHolder = new Map<string, string[]>();
  const itemEntriesByDefinition = new Map<string, string[]>();
  const refsByScene = new Map<string, string[]>();

  const limited = { hit: false };
  /** Charges one record before it is read. Returns false once spent. */
  const admit = (): boolean => {
    if (!budget.charge("scannedRecords", 1)) {
      limited.hit = true;
      return false;
    }
    return true;
  };
  const bindScene = (sceneRef: string, ref: string) => {
    push(refsByScene, sceneRef, ref);
  };

  for (const [ref, scene] of entries(state.scenes)) {
    if (!admit()) break;
    nodes.set(ref, freezeNode({ ref, kind: "scene", sceneRef: ref }));
    void scene;
  }

  if (!limited.hit) {
    for (const [ref, entity] of entries(state.entities)) {
      if (!admit()) break;
      nodes.set(ref, freezeNode({
        ref,
        kind: "entity",
        ...(typeof entity.sceneId === "string" ? { sceneRef: entity.sceneId } : {}),
      }));
      if (typeof entity.sceneId === "string") bindScene(entity.sceneId, ref);
    }
  }

  if (!limited.hit) {
    for (const [ref, entry] of entries(state.campaignRuntime.itemSystem.entries)) {
      if (!admit()) break;
      // An entry held by a character is spatially bound to that holder's scene,
      // matching how authority state resolves the same binding.
      const holderRef = entry.holderRef ?? undefined;
      const holderScene = holderRef === undefined
        ? undefined
        : state.entities[holderRef]?.sceneId;
      const sceneRef = entry.sceneRef ?? holderScene ?? undefined;
      nodes.set(ref, freezeNode({
        ref,
        kind: "itemEntry",
        ...(sceneRef === undefined ? {} : { sceneRef }),
        ...(holderRef === undefined ? {} : { holderRef }),
        ...(typeof entry.definitionRef === "string"
          ? { definitionRef: entry.definitionRef }
          : {}),
        ...(typeof entry.visibilityPolicyRef === "string"
          ? { visibilityPolicyRef: entry.visibilityPolicyRef }
          : {}),
      }));
      if (sceneRef !== undefined) bindScene(sceneRef, ref);
      if (holderRef !== undefined) push(itemEntriesByHolder, holderRef, ref);
      if (typeof entry.definitionRef === "string") {
        push(itemEntriesByDefinition, entry.definitionRef, ref);
      }
    }
  }

  if (!limited.hit) {
    for (const [ref] of entries(state.campaignRuntime.itemSystem.definitions)) {
      if (!admit()) break;
      nodes.set(ref, freezeNode({ ref, kind: "itemDefinition" }));
    }
  }

  if (!limited.hit) {
    for (const [ref, definition] of entries(state.campaignRuntime.definitions)) {
      if (!admit()) break;
      if (!isStoredSemanticDefinition(definition)) {
        nodes.set(ref, freezeNode({ ref, kind: "campaignDefinition" }));
        continue;
      }
      const sceneRef = definition.semanticKind === "sceneFeature"
        && typeof definition.content.sceneRef === "string"
        ? definition.content.sceneRef
        : undefined;
      nodes.set(ref, freezeNode({
        ref,
        kind: "semanticDefinition",
        semanticKind: definition.semanticKind,
        visibilityPolicyRef: definition.visibilityPolicyRef,
        templateRef: definition.templateRef,
        templateHash: definition.templateHash,
        ...(sceneRef === undefined ? {} : { sceneRef }),
      }));
      if (sceneRef !== undefined) bindScene(sceneRef, ref);

      const edge = typedRelationEdge(ref, definition);
      if (edge === undefined) continue;
      // Building adjacency is index construction, not traversal. Keeping the
      // two dimensions apart is what lets a receipt show that closure work
      // tracks the decisive chain rather than the size of the catalog.
      if (!budget.charge("postingWrites", 2)) {
        limited.hit = true;
        break;
      }
      push(relationsBySubject, edge.subjectRef, edge);
      push(relationsByObject, edge.objectRef, edge);
    }
  }

  if (!limited.hit) {
    for (const [ref] of entries(state.combatRuntime.definitions)) {
      if (!admit()) break;
      nodes.set(ref, freezeNode({ ref, kind: "abilityDefinition" }));
    }
  }

  if (!limited.hit) {
    for (const [ref, fact] of entries(state.canonicalFacts)) {
      if (!admit()) break;
      const subjectRefs = Array.isArray(fact.subjectRefs)
        ? fact.subjectRefs.filter((subject): subject is string => typeof subject === "string")
        : [];
      nodes.set(ref, freezeNode({
        ref,
        kind: "canonicalFact",
        subjectRefs: Object.freeze([...subjectRefs]),
      }));
      for (const subject of subjectRefs) push(factsBySubject, subject, ref);
    }
  }

  if (!limited.hit) {
    outer: for (const [holderRef, slice] of entries(state.knowledge)) {
      for (const [knowledgeRef] of entries(slice ?? {})) {
        if (!admit()) break outer;
        const ref = `knowledge:${holderRef}:${knowledgeRef}`;
        nodes.set(ref, freezeNode({ ref, kind: "knowledge", knowledgeHolderRef: holderRef }));
        push(knowledgeByHolder, holderRef, ref);
      }
    }
  }

  if (!limited.hit) {
    outer: for (const collection of VNEXT_CONTINUITY_AUTHORITY_COLLECTIONS) {
      if (!admit()) break;
      const collectionRef = `continuity:${collection}`;
      nodes.set(collectionRef, freezeNode({
        ref: collectionRef,
        kind: "continuityCollection",
        continuityCollection: collection,
      }));
      const value = state.campaignRuntime[collection];
      // Array-shaped collections are addressable only at collection level;
      // their members are not independently versioned authority records.
      if (!isPlainRecord(value)) continue;
      for (const [entryRef] of entries(value)) {
        if (!admit()) break outer;
        const ref = `${collectionRef}:${entryRef}`;
        nodes.set(ref, freezeNode({
          ref,
          kind: "continuityEntry",
          continuityCollection: collection,
        }));
      }
    }
  }

  if (!limited.hit && state.campaignRuntime.campaign !== null) {
    if (admit()) {
      nodes.set("continuity:campaign", freezeNode({
        ref: "continuity:campaign",
        kind: "continuityCollection",
        continuityCollection: "campaign",
      }));
      const moduleRef = state.campaignRuntime.campaign.moduleRef;
      if (isPlainRecord(moduleRef) && typeof moduleRef.profileId === "string") {
        const ref = `profile-context:${moduleRef.profileId}`;
        nodes.set(ref, freezeNode({ ref, kind: "profileContext" }));
      }
    }
  }

  if (limited.hit || budget.exhausted()) {
    return Object.freeze({ kind: "preparationLimit", receipt: budget.receipt() });
  }
  return Object.freeze({
    kind: "indexed",
    index: Object.freeze({
      nodes,
      relationsBySubject: frozenEdges(relationsBySubject),
      relationsByObject: frozenEdges(relationsByObject),
      factsBySubject: frozenRefs(factsBySubject),
      knowledgeByHolder: frozenRefs(knowledgeByHolder),
      itemEntriesByHolder: frozenRefs(itemEntriesByHolder),
      itemEntriesByDefinition: frozenRefs(itemEntriesByDefinition),
      refsByScene: frozenRefs(refsByScene),
    }),
  });
}

/** Reads the declared relation contract, never a nested lookalike field. */
function typedRelationEdge(
  ref: string,
  definition: StoredSemanticDefinition,
): TypedRelationEdge | undefined {
  if (definition.semanticKind !== "worldRelation") return undefined;
  const { kind, subjectRef, objectRef, state, relationRef } = definition.content;
  if (typeof kind !== "string"
    || typeof subjectRef !== "string"
    || typeof objectRef !== "string") return undefined;
  return Object.freeze({
    relationRef: typeof relationRef === "string" ? relationRef : ref,
    relationKind: kind,
    subjectRef,
    objectRef,
    state: typeof state === "string" ? state : "active",
  });
}

/** Deterministic iteration order regardless of insertion order in state. */
function entries<T>(record: Record<string, T>): readonly (readonly [string, T])[] {
  return Object.keys(record)
    .sort(compareCodeUnits)
    .map((key) => [key, record[key]!] as const);
}

function push<T>(target: Map<string, T[]>, key: string, value: T): void {
  const existing = target.get(key);
  if (existing === undefined) target.set(key, [value]);
  else existing.push(value);
}

function freezeNode(node: ReferenceNode): ReferenceNode {
  return Object.freeze(node);
}

function frozenEdges(
  source: Map<string, TypedRelationEdge[]>,
): ReadonlyMap<string, readonly TypedRelationEdge[]> {
  return new Map([...source].map(([key, value]) => [
    key,
    Object.freeze([...value].sort((left, right) =>
      compareCodeUnits(left.relationRef, right.relationRef))),
  ]));
}

function frozenRefs(source: Map<string, string[]>): ReadonlyMap<string, readonly string[]> {
  return new Map([...source].map(([key, value]) => [
    key,
    Object.freeze([...new Set(value)].sort(compareCodeUnits)),
  ]));
}
