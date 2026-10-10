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
/** ADR 0136: how part of a carried stack came to its holder's hands, as the
 * holder remembers it -- out of a container, up from the ground, or from
 * another character -- how many and when. A stack keeps a part per arrival,
 * so pieces that joined one stack keep their sources. */
export type AcquiredPart = { from: "container" | "ground" | "character"; ref: string; quantity: number; eventSeq: string };
/** The newest arrivals kept per stack. */
export const ACQUIRED_PARTS_LIMIT = 8;

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

export function isAcquiredParts(value: unknown): value is AcquiredPart[] {
  return Array.isArray(value) && value.length > 0 && value.length <= ACQUIRED_PARTS_LIMIT && value.every(part => record(part)
    && Object.keys(part).sort().join() === "eventSeq,from,quantity,ref" && ["container", "ground", "character"].includes(String(part.from))
    && typeof part.ref === "string" && /^\S+$/.test(part.ref) && Number.isSafeInteger(part.quantity) && Number(part.quantity) > 0
    && typeof part.eventSeq === "string" && /^\d+$/.test(part.eventSeq));
}

/** The parts a stack of `quantity` can still hold, oldest given up first,
 * except that pieces put into `returnedTo` are taken from what came out of
 * it, newest first: putting "the one from the barrel" back gives up that
 * part. Pure, so the record and every read of it agree. */
export function acquiredPartsWithin(parts: readonly AcquiredPart[], quantity: number, returnedTo?: string): AcquiredPart[] {
  let excess = parts.reduce((sum, part) => sum + part.quantity, 0) - quantity;
  const kept = parts.map(part => ({ ...part }));
  const give = (indices: readonly number[]) => { for (const index of indices) {
    if (excess <= 0) return; const taken = Math.min(excess, kept[index]!.quantity); kept[index]!.quantity -= taken; excess -= taken; } };
  if (returnedTo !== undefined) give(kept.flatMap((part, index) => part.from === "container" && part.ref === returnedTo ? [index] : []).reverse());
  give(kept.map((_, index) => index));
  return kept.filter(part => part.quantity > 0);
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
    const p = event.payload as InventoryPayload;
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
    // ADR 0136: whoever an item reaches remembers how -- taken out of a
    // container, picked up, or handed over -- while it stays loose in that
    // character's hands. "The piece I just took out", "the key I picked up"
    // and "the rope he gave me" otherwise match every alike item.
    const arrival = arrivalOf(source, state, p, event.eventSeq);
    if (arrival !== undefined) {
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      const held = (metadata.acquiredFrom ??= {})[arrival.holderRef] ??= {};
      held[arrival.entryId] = [...(held[arrival.entryId] ?? []), arrival.part].slice(-ACQUIRED_PARTS_LIMIT);
    }
    for (const holderRef of new Set([p.actorCharacterId, prior?.holderRef, current?.holderRef, p.operation.targetCharacterRef]))
      if (typeof holderRef === "string") settleAcquiredParts(state, holderRef,
        p.operation.kind === "store" && holderRef === p.actorCharacterId ? { entryRef: p.operation.entryRef, containerRef: p.operation.containerRef } : undefined);
  } else if (event.eventType === "ItemMaterialized") {
    const p = event.payload as { entry: { containerRef?: string } };
    if (p.entry.containerRef) {
      const metadata = state.vNextItemAuthority ??= emptyVNextItemAuthority();
      (metadata.containerAuthorship ??= {})[p.entry.containerRef] ??= event.rootActionId;
    }
  }
}

type InventoryPayload = { actorCharacterId: string; operation: { kind: string; entryRef: string; containerRef?: string; quantity?: number;
  targetCharacterRef?: string }; targetEntryId: string };
/** The arrival an inventory operation makes in someone's hands: the item now
 * loose with the actor who took it, or with the character it was given to. */
function arrivalOf(source: AuthoritativeWorldState, state: AuthoritativeWorldState, p: InventoryPayload, eventSeq: string) {
  const prior = source.campaignRuntime.itemSystem.entries[p.operation.entryRef];
  const current = state.campaignRuntime.itemSystem.entries[p.targetEntryId];
  if (prior === undefined || current?.disposition !== "held" || current.holderRef === null || current.containerRef !== undefined) return undefined;
  const holderRef = current.holderRef, quantity = p.operation.quantity ?? current.quantity;
  const at = (from: AcquiredPart["from"], ref: string | null | undefined) => typeof ref !== "string" ? undefined
    : { holderRef, entryId: current.entryId, part: { from, ref, quantity, eventSeq } as AcquiredPart };
  let arrival: ReturnType<typeof at>;
  if (p.operation.kind === "acquire" && holderRef === p.actorCharacterId) {
    arrival = prior.containerRef !== undefined ? at("container", prior.containerRef)
      : prior.disposition === "scene" ? at("ground", prior.sceneRef)
      : prior.holderRef !== holderRef ? at("character", prior.holderRef) : undefined;
  } else if (p.operation.kind === "transfer" && holderRef === p.operation.targetCharacterRef && prior.holderRef !== holderRef) {
    arrival = at("character", prior.holderRef);
  }
  return arrival;
}

/** A holder keeps what it remembers of a stack only while it holds the stack
 * loose, and only as many pieces as the stack has: put away, handed over,
 * dropped or used up, the record goes or shrinks (`acquiredPartsWithin`). */
function settleAcquiredParts(state: AuthoritativeWorldState, holderRef: string, stored?: { entryRef: string; containerRef?: string }): void {
  const held = state.vNextItemAuthority?.acquiredFrom?.[holderRef];
  if (held === undefined) return;
  for (const [entryId, parts] of Object.entries(held)) {
    const entry = state.campaignRuntime.itemSystem.entries[entryId];
    const kept = entry?.disposition !== "held" || entry.holderRef !== holderRef || entry.containerRef !== undefined ? []
      : acquiredPartsWithin(parts, entry.quantity, stored?.entryRef === entryId ? stored.containerRef : undefined);
    if (kept.length === 0) delete held[entryId]; else held[entryId] = kept;
  }
  if (Object.keys(held).length === 0) delete state.vNextItemAuthority!.acquiredFrom![holderRef];
  if (Object.keys(state.vNextItemAuthority!.acquiredFrom!).length === 0) delete state.vNextItemAuthority!.acquiredFrom;
}

export function projectedClosedContainerMemories(state: AuthoritativeWorldState, characterId: string): ContainerMemory[] {
  return Object.values(state.vNextItemAuthority?.containerMemories?.[characterId] ?? {}).filter(memory => {
    const container = state.campaignRuntime.itemSystem.entries[memory.containerRef];
    return container?.holderRef === characterId && container.disposition === "held"
      && containedItemAccessible(state.campaignRuntime.itemSystem, container)
      && ["closed", "locked"].includes(container.stateMachine?.state ?? "");
  }).sort((a, b) => a.containerRef.localeCompare(b.containerRef)).map(memory => structuredClone(memory));
}
