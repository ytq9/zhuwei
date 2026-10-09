import { authorityItemContainer } from "./authority-bindings";
import { emptyVNextItemAuthority, identifiedItemDefinition, itemIdentifiedBy } from "./item-authority-vnext";
import { itemPolicyVisibleToViewer, projectInventoryEntry } from "./item-projection";
import { containedItemAccessible } from "./item-containment";
import { narrativeDetail } from "./narrative-commitments";
import type { AuthoritativeWorldState, EventEnvelope } from "./model";
import { CONTAINER_EVENT_PROFILE_ID } from "./container-defaults";

export type RememberedContainerItem = {
  entryId: string;
  quantity: number;
  condition: "usable" | "broken";
  name?: string;
  charges?: { current: number; maximum: number } | null;
  durability?: { current: number; maximum: number } | null;
  objectState?: "open" | "closed" | "locked";
};
export type ContainerMemory = {
  containerRef: string;
  observerRef: string;
  eventSeq: string;
  entries: RememberedContainerItem[];
};
export type ContainerOrigin = { sourceRef: string; eventSeq: string };
/** ADR 0134: what an actor remembers of an item it took out of a container
 * and still holds loose -- which container, how many, and when. */
export type TakenFromContainer = { observerRef: string; containerRef: string; quantity: number; eventSeq: string };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function rememberedItem(value: unknown): value is RememberedContainerItem {
  if (!record(value)) return false;
  const expected = ["entryId", "quantity", "condition", ...["name", "charges", "durability", "objectState"].filter(key => Object.hasOwn(value, key))].sort();
  const counter = (value: unknown) => value === null || (record(value) && Object.keys(value).sort().join() === "current,maximum"
    && Number.isSafeInteger(value.current) && Number.isSafeInteger(value.maximum) && Number(value.current) >= 0
    && Number(value.maximum) > 0 && Number(value.current) <= Number(value.maximum));
  return Object.keys(value).sort().join() === expected.join() && typeof value.entryId === "string"
    && /^\S+$/.test(value.entryId) && Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0
    && ["usable", "broken"].includes(String(value.condition))
    && (value.name === undefined || typeof value.name === "string" && value.name.length > 0 && value.name.length <= 4000)
    && (value.charges === undefined || counter(value.charges)) && (value.durability === undefined || counter(value.durability))
    && (value.objectState === undefined || ["open", "closed", "locked"].includes(String(value.objectState)));
}

export function isTakenFromContainer(value: unknown): value is TakenFromContainer {
  return record(value) && Object.keys(value).sort().join() === "containerRef,eventSeq,observerRef,quantity"
    && typeof value.observerRef === "string" && /^\S+$/.test(value.observerRef)
    && typeof value.containerRef === "string" && /^\S+$/.test(value.containerRef)
    && Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0
    && typeof value.eventSeq === "string" && /^\d+$/.test(value.eventSeq);
}

export function isContainerMemory(value: unknown): value is ContainerMemory {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join() === "containerRef,entries,eventSeq,observerRef"
    && typeof v.containerRef === "string" && typeof v.observerRef === "string"
    && typeof v.eventSeq === "string" && /^\d+$/.test(v.eventSeq)
    && Array.isArray(v.entries) && v.entries.every(rememberedItem)
    && new Set(v.entries.map(entry => entry.entryId)).size === v.entries.length;
}

function inspected(state: AuthoritativeWorldState, containerRef: string): boolean {
  return Object.values(state.vNextItemAuthority?.containerMemories ?? {}).some(memories => memories[containerRef] !== undefined);
}

/** SPEC 0001 §§7、16: a scene grant is not permission to replenish a bag.
 * A source binds this container and identity, not a claim of plausibility. */
export function containerMaterializationIssue(state: AuthoritativeWorldState, containerRef: string | undefined,
  definitionRef: string, quantity: number, sourceRefs: readonly string[], rootActionId: string,
  uniquenessBasisRef?: string): string | undefined {
  if (containerRef === undefined) return undefined;
  const fixedRoot = state.vNextItemAuthority?.containerAuthorship?.[containerRef];
  const definition = state.campaignRuntime.itemSystem.definitions[definitionRef];
  const committedSource = sourceRefs.some(ref => {
    const detail = narrativeDetail(state, ref);
    return detail?.basisRefs.includes(containerRef) && detail.label === definition?.content.label;
  }) || (quantity === 1 && uniquenessBasisRef !== undefined && sourceRefs.includes(uniquenessBasisRef)
    && state.canonicalFacts[uniquenessBasisRef]?.subjectRefs.includes(containerRef)
    && state.canonicalFacts[uniquenessBasisRef]?.subjectRefs.includes(definitionRef));
  // Once checked/fixed, later changes must move existing instances. A new
  // claim cannot authorize retroactively adding to an inspected empty box.
  if (inspected(state, containerRef) || (fixedRoot !== undefined && fixedRoot !== rootActionId))
    return "container:original-contents-already-fixed";
  const holder = state.campaignRuntime.itemSystem.entries[containerRef]?.holderRef;
  if (holder && state.entities[holder]?.kind === "player" && !committedSource
    && state.vNextItemAuthority?.containerOrigins?.[containerRef] === undefined)
    return "container:player-held-content-source-required";
  return undefined;
}

function remember(state: AuthoritativeWorldState, observerRef: string, containerRef: string, eventSeq: string,
  inspectedState: AuthoritativeWorldState = state): void {
  const actor = inspectedState.entities[observerRef];
  if (!actor || !authorityItemContainer(inspectedState, containerRef, actor.sceneId, observerRef)) return;
  const viewer = { kind: actor.kind, characterId: observerRef } as const;
  const entries = Object.values(inspectedState.campaignRuntime.itemSystem.entries).flatMap(entry => {
    const definition = inspectedState.campaignRuntime.itemSystem.definitions[entry.definitionRef];
    const known = identifiedItemDefinition(inspectedState, observerRef, entry);
    return entry.containerRef === containerRef && ["held", "scene"].includes(entry.disposition)
      && containedItemAccessible(inspectedState.campaignRuntime.itemSystem, entry) && definition
      && itemPolicyVisibleToViewer(entry.visibilityPolicyRef, viewer, entry)
      ? [projectInventoryEntry(definition, entry, { ...viewer,
          identifiedDefinitions: known ? { [entry.entryId]: known } : {},
          identifiedEntryRefs: itemIdentifiedBy(inspectedState, observerRef, entry, definition) ? [entry.entryId] : [] })] : [];
  }).sort((a, b) => a.entryId.localeCompare(b.entryId));
  const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
  const memories = (metadata.containerMemories ??= {})[observerRef] ??= {};
  // Keep only last-observed identity/counters, not another ItemDefinition or
  // executable activity list. Authority items remain the only physical state.
  memories[containerRef] = { containerRef, observerRef, eventSeq, entries: entries.map(entry => ({
    entryId: entry.entryId, quantity: entry.quantity, condition: entry.condition,
    ...(entry.kind === "identified" ? { name: entry.name, charges: entry.charges, durability: entry.durability,
      ...(entry.objectState ? { objectState: entry.objectState } : {}) } : {}),
  })) };
}

/** Derived from the same validated events on commit and replay. Closed
 * memories never follow hidden inventory changes, including failed taking.
 * Opening refreshes visible immediate contents; closed inner boxes stay opaque. */
export function recordContainerKnowledge(source: AuthoritativeWorldState, state: AuthoritativeWorldState, event: EventEnvelope): void {
  // A new interpretation is pinned by the event profile; legacy event replay
  // must not silently acquire an inspection record it never saved.
  if (event.profiles.eventSchema.profileId !== CONTAINER_EVENT_PROFILE_ID) return;
  if (event.eventType === "ItemStateTransitioned") {
    const p = event.payload as { actorCharacterId: string; entryRef: string; toState: string; fromState: string };
    if (p.toState === "open") remember(state, p.actorCharacterId, p.entryRef, event.eventSeq);
    else if (p.fromState === "none") remember(state, p.actorCharacterId, p.entryRef, event.eventSeq, source);
  } else if (event.eventType === "EnvironmentFeatureStateChanged") {
    const p = event.payload as { actorCharacterId: string; featureId: string; toState: string };
    if (p.toState === "open") remember(state, p.actorCharacterId, p.featureId, event.eventSeq);
  } else if (event.eventType === "InventoryOperationApplied") {
    const p = event.payload as { actorCharacterId: string; operation: { kind: string; entryRef: string; containerRef?: string; quantity?: number }; targetEntryId: string };
    const prior = source.campaignRuntime.itemSystem.entries[p.operation.entryRef];
    const current = state.campaignRuntime.itemSystem.entries[p.targetEntryId];
    // Taking an unopened world/NPC container preserves its inspectable origin.
    if (["acquire", "transfer"].includes(p.operation.kind) && prior?.quantity === 1
      && current?.holderRef && state.entities[current.holderRef]?.kind === "player"
      && prior.holderRef !== current.holderRef && (prior.holderRef === null || source.entities[prior.holderRef]?.kind === "npc")) {
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      (metadata.containerOrigins ??= {})[current.entryId] ??= { sourceRef: prior.holderRef ?? prior.sceneRef!, eventSeq: event.eventSeq };
    }
    for (const containerRef of new Set([prior?.containerRef, p.operation.containerRef].filter((ref): ref is string => ref !== undefined)))
      remember(state, p.actorCharacterId, containerRef, event.eventSeq);
    // ADR 0134: taking an item out of a container is remembered by the one
    // who took it, while it stays loose in that character's hands. A later
    // "the piece I just took out" has nothing else to tell it apart from the
    // stack left inside.
    if (p.operation.kind === "acquire" && prior?.containerRef !== undefined && current?.disposition === "held"
      && current.holderRef === p.actorCharacterId && current.containerRef === undefined) {
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      ((metadata.takenFrom ??= {})[p.actorCharacterId] ??= {})[current.entryId] = { observerRef: p.actorCharacterId,
        containerRef: prior.containerRef, quantity: p.operation.quantity ?? current.quantity, eventSeq: event.eventSeq };
    }
    for (const holderRef of new Set([p.actorCharacterId, prior?.holderRef, current?.holderRef]))
      if (typeof holderRef === "string") forgetPutAwayItems(state, holderRef);
  } else if (event.eventType === "ItemMaterialized") {
    const p = event.payload as { entry: { containerRef?: string } };
    if (p.entry.containerRef) {
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      (metadata.containerAuthorship ??= {})[p.entry.containerRef] ??= event.rootActionId;
    }
  }
}

/** A taken item stays remembered only while its taker holds it loose: put
 * away, handed over, dropped or used up, the record goes. */
function forgetPutAwayItems(state: AuthoritativeWorldState, holderRef: string): void {
  const taken = state.vNextItemAuthority?.takenFrom?.[holderRef];
  if (taken === undefined) return;
  for (const entryId of Object.keys(taken)) {
    const entry = state.campaignRuntime.itemSystem.entries[entryId];
    if (entry?.disposition !== "held" || entry.holderRef !== holderRef || entry.containerRef !== undefined) delete taken[entryId];
  }
  if (Object.keys(taken).length === 0) delete state.vNextItemAuthority!.takenFrom![holderRef];
  if (Object.keys(state.vNextItemAuthority!.takenFrom!).length === 0) delete state.vNextItemAuthority!.takenFrom;
}

export function projectedClosedContainerMemories(state: AuthoritativeWorldState, characterId: string): ContainerMemory[] {
  return Object.values(state.vNextItemAuthority?.containerMemories?.[characterId] ?? {}).filter(memory => {
    const container = state.campaignRuntime.itemSystem.entries[memory.containerRef];
    return container?.holderRef === characterId && container.disposition === "held"
      && containedItemAccessible(state.campaignRuntime.itemSystem, container)
      && ["closed", "locked"].includes(container.stateMachine?.state ?? "");
  }).sort((a, b) => a.containerRef.localeCompare(b.containerRef)).map(memory => structuredClone(memory));
}
