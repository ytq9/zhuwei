import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/authority-read";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json";
import type { historyHttpSource } from "./story-history-http";

type Data = Record<string, any>;
export const LIVE_CONTAINER = "item-entry:live-object:box";
export const LIVE_CONTENTS = "item-entry:live-object:cloth";
export const LIVE_BOX_DEFINITION = "item-definition:live-object:box";
export const LIVE_CLOTH_DEFINITION = "item-definition:live-object:cloth";

/** Declared initial objects, not generated KP output or sampled results. */
export function containerLiveSeed(actor: string) {
  const box = healingPotionItemDefinition(), cloth = healingPotionItemDefinition();
  box.definitionId = LIVE_BOX_DEFINITION;
  Object.assign(box.content, { label: "随身木盒", description: "一只可以正常掀开盒盖的木盒，没有锁。", category: "object", stackable: false, use: null });
  cloth.definitionId = LIVE_CLOTH_DEFINITION;
  Object.assign(cloth.content, { label: "干净布条", description: "可以取放的干净布条。", category: "object", use: null });
  return { semanticDefinitions: [], entityDefinitionBindings: [], itemDefinitions: [box, cloth], itemEntries: [
    { definitionRef: box.definitionId, entry: { entryId: LIVE_CONTAINER, quantity: 1, initialState: "open",
      placement: { kind: "scene", sceneRef: "wake" }, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public" } },
    { definitionRef: cloth.definitionId, entry: { entryId: LIVE_CONTENTS, quantity: 3,
      placement: { kind: "held", holderRef: actor, equippedSlot: null }, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public" } },
  ] };
}

/** Disclosed prehistory: the owner inspected three; another character took
 * one while the box was shut; the owner then picked up the box. Native Rules
 * and event folds establish this before sampling. No real-provider success
 * is claimed for these setup operations. */
export async function prepareContainerLiveHistory(source: Awaited<ReturnType<typeof historyHttpSource>>, withdrawBeforeSample = false) {
  const actor = source.characters[0].characterId, peer = source.characters[1]?.characterId;
  if (!peer) throw new Error("CONTAINER_LIVE_PEER_REQUIRED");
  await runInDurableObject(source.stub, instance => {
    const target = instance as unknown as Data, original = target.authoritativeReplay();
    let state = original.state, ordinal = 0;
    const events: Data[] = [];
    const inventory = (who: string, operation: Data) => {
      const refs = [...new Set([who, "wake", operation.entryRef, operation.containerRef].filter(Boolean))].sort();
      const result = target.rulesRuntime.step(original.profiles, state, { kind: "inventoryOperation",
        rootActionId: `root:live-container-prehistory:${++ordinal}`, actorCharacterId: who,
        plan: { schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: canonicalHash({ purpose: "declared-fixture-prehistory" }),
          readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
          basisRefs: ["wake"], summary: "预置公开说明的物品前史。", operation } });
      expect(result.kind, JSON.stringify(result.rejection)).toBe("committed");
      state = result.state; events.push(...result.events);
    };
    const lid = (who: string, fromState: string, toState: string, intent: string) => {
      const changed = createEventTransition(state, original.profiles, { rootActionId: `root:live-container-prehistory:${++ordinal}`,
        eventType: "ItemStateTransitioned", payload: { actorCharacterId: who, sceneId: "wake", entryRef: LIVE_CONTAINER,
          fromState, toState, intent } as never, visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
      state = changed.state; events.push(changed.event);
    };
    inventory(actor, { kind: "store", entryRef: LIVE_CONTENTS, quantity: 3, containerRef: LIVE_CONTAINER });
    lid(actor, "open", "closed", "close");
    lid(peer, "closed", "open", "open");
    inventory(peer, { kind: "acquire", entryRef: LIVE_CONTENTS, quantity: 1 });
    lid(peer, "open", "closed", "close");
    inventory(actor, { kind: "acquire", entryRef: LIVE_CONTAINER, quantity: 1 });
    if (withdrawBeforeSample) {
      // The distinguishing contrast starts at the failed put-back's mechanical
      // boundary. This withdrawal is disclosed native history, no model sample.
      lid(actor, "closed", "open", "open");
      inventory(actor, { kind: "acquire", entryRef: LIVE_CONTENTS, quantity: 1 });
      lid(actor, "open", "closed", "close");
    }
    expect(state.campaignRuntime.itemSystem.entries[LIVE_CONTENTS].quantity).toBe(withdrawBeforeSample ? 1 : 2);
    expect(state.vNextItemAuthority.containerMemories[actor][LIVE_CONTAINER].entries[0].quantity).toBe(withdrawBeforeSample ? 1 : 3);
    const replayed = target.rulesRuntime.replay(original.genesis, [...target.authorityStore.events(), ...events]);
    expect(replayed.kind).toBe("replayed"); expect(replayed.state).toEqual(state);
    target.authorityStore.appendEvents(events); target.authorityStore.updateState(state); target.authorityStore.syncAuthorityIndex(state);
  });
}

// SPEC 0001 §16: unchanged final counts alone cannot prove a real reopening.
export function assertContainerLiveStep(initial: Data, before: Data, after: Data, actor: string, index: number) {
  const system = after.state.campaignRuntime.itemSystem, box = system.entries[LIVE_CONTAINER];
  expect(box).toMatchObject({ entryId: LIVE_CONTAINER, holderRef: actor, definitionRef: LIVE_BOX_DEFINITION, stateMachine: { state: "closed" } });
  const remaining = index === 0 ? 1 : 2;
  const cloth = Object.values(system.entries).filter((entry: any) => entry.definitionRef === LIVE_CLOTH_DEFINITION) as Data[];
  // Returning a split instance moves that same instance. Storage does not
  // promise to merge stacks or replace the original contained identity.
  expect(system.entries[LIVE_CONTENTS]).toMatchObject({ entryId: LIVE_CONTENTS, containerRef: LIVE_CONTAINER, quantity: 1 });
  const inside = cloth.filter(entry => entry.containerRef === LIVE_CONTAINER && ["scene", "held"].includes(entry.disposition));
  expect(inside.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(remaining);
  const remembered = after.state.vNextItemAuthority.containerMemories[actor][LIVE_CONTAINER].entries;
  expect(remembered.map((entry: Data) => ({ entryId: entry.entryId, quantity: entry.quantity, name: entry.name })))
    .toEqual(inside.map(entry => ({ entryId: entry.entryId, quantity: entry.quantity, name: "干净布条" })).sort((a, b) => a.entryId.localeCompare(b.entryId)));
  expect(cloth.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(3);
  const outside = cloth.filter(entry => entry.holderRef === actor && entry.containerRef === undefined && entry.disposition === "held");
  expect(outside.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(index === 0 ? 1 : 0);
  const sampled = after.events.slice(initial.events.length);
  expect(sampled.filter((event: Data) => ["ItemMaterialized", "ItemDefinitionRegistered"].includes(event.eventType))).toHaveLength(0);
  const currentEvents = after.events.slice(before.events.length);
  const lidEvents = currentEvents.filter((event: Data) => event.eventType === "ItemStateTransitioned"
    && event.payload.actorCharacterId === actor && event.payload.entryRef === LIVE_CONTAINER);
  expect(lidEvents.map((event: Data) => [event.payload.fromState, event.payload.toState]), "the same box actually opens and closes")
    .toEqual([["closed", "open"], ["open", "closed"]]);
  const operations = currentEvents.filter((event: Data) => event.eventType === "InventoryOperationApplied");
  if (index === 2) {
    expect(system, "looking again changes no physical inventory").toEqual(before.state.campaignRuntime.itemSystem);
    expect(operations.filter((event: Data) => event.payload.operation.kind !== "identify"),
      "looking may identify an existing item but cannot move or consume it").toHaveLength(0);
    // SPEC 0001 §§12、16: this probe checks ordinary viewing, not acquisition
    // of a hidden definition. A public cloth control cannot certify secrets.
    for (const event of operations) {
      const original = before.state.campaignRuntime.itemSystem.entries[event.payload.operation.entryRef];
      expect(original?.containerRef, "identify belongs to the inspected container").toBe(LIVE_CONTAINER);
      expect(before.state.campaignRuntime.itemSystem.definitions[original.definitionRef]?.visibilityPolicyRef,
        "ordinary inspection may only identify an already public definition").toBe("visibility:public");
    }
    const rememberedAt = after.state.vNextItemAuthority.containerMemories[actor][LIVE_CONTAINER].eventSeq;
    expect([lidEvents[0], ...operations].map((event: Data) => event.eventSeq)).toContain(rememberedAt);
    expect(BigInt(rememberedAt)).toBeGreaterThan(BigInt(before.state.vNextItemAuthority.containerMemories[actor][LIVE_CONTAINER].eventSeq));
  } else {
    expect(operations.map((event: Data) => event.payload.operation.kind)).toEqual([index === 0 ? "acquire" : "store"]);
    if (index === 1) {
      const originalHeld = Object.values(before.state.campaignRuntime.itemSystem.entries).filter((entry: any) =>
        entry.definitionRef === LIVE_CLOTH_DEFINITION && entry.holderRef === actor && entry.containerRef === undefined && entry.disposition === "held") as Data[];
      expect(originalHeld).toHaveLength(1);
      expect(operations[0].payload.operation.entryRef).toBe(originalHeld[0].entryId);
      expect(system.entries[originalHeld[0].entryId]).toMatchObject({ entryId: originalHeld[0].entryId,
        containerRef: LIVE_CONTAINER, quantity: originalHeld[0].quantity });
    }
  }
  if (index > 0) expect(Object.keys(system.entries).sort()).toEqual(Object.keys(before.state.campaignRuntime.itemSystem.entries).sort());
}

// ---- Carried-item references (ADR 0136): how an item came to hand ----------

export const CARRIED = Object.freeze({ box: "item-entry:carried:box", barrel: "item-entry:carried:barrel", pouch: "item-entry:carried:pouch",
  cloth: "item-entry:carried:cloth", keyHeld: "item-entry:carried:key-held", keyFloor: "item-entry:carried:key-floor",
  ropeOwn: "item-entry:carried:rope-own", ropeGift: "item-entry:carried:rope-gift" });
const CARRIED_CLOTH = "item-definition:carried:cloth";
export type CarriedScenario = "boxTake" | "barrelTake" | "twoSources" | "pickUp" | "handedOver" | "afterOtherActs";

/** Declared initial objects for the carried-reference probes: the actor holds
 * an open box, an open pouch, five cloths, a key and a rope; an open barrel
 * and a second key lie in the hall; the other player holds a second rope.
 * Every alike pair shares its name, so only how an item came to hand tells
 * which one a sentence means. */
export function carriedReferenceSeed(actor: string, peer: string) {
  const definition = (id: string, label: string, stackable: boolean) => { const value = healingPotionItemDefinition();
    value.definitionId = `item-definition:carried:${id}`;
    Object.assign(value.content, { label, description: `一件${label}。`, category: "object", aliases: [label], tags: [], stackable, use: null });
    return value; };
  const definitions = { cloth: definition("cloth", "干净布条", true), box: definition("box", "随身木盒", false),
    barrel: definition("barrel", "敞口木桶", false), pouch: definition("pouch", "布袋", false), key: definition("key", "铜钥匙", false),
    rope: definition("rope", "麻绳", false) };
  const held = (entryId: string, definitionRef: string, holderRef: string, extra: Data = {}) => ({ definitionRef, entry: { entryId, quantity: 1, ...extra,
    placement: { kind: "held", holderRef, equippedSlot: null }, ownership: { kind: "character", ownerRef: holderRef }, visibilityPolicyRef: "visibility:public" } });
  const ground = (entryId: string, definitionRef: string, extra: Data = {}) => ({ definitionRef, entry: { entryId, quantity: 1, ...extra,
    placement: { kind: "scene", sceneRef: "wake" }, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public" } });
  return { semanticDefinitions: [], entityDefinitionBindings: [], itemDefinitions: Object.values(definitions), itemEntries: [
    held(CARRIED.box, definitions.box.definitionId, actor, { initialState: "open" }), held(CARRIED.pouch, definitions.pouch.definitionId, actor, { initialState: "absent" }),
    held(CARRIED.cloth, definitions.cloth.definitionId, actor, { quantity: 5 }), held(CARRIED.keyHeld, definitions.key.definitionId, actor),
    held(CARRIED.ropeOwn, definitions.rope.definitionId, actor), held(CARRIED.ropeGift, definitions.rope.definitionId, peer),
    ground(CARRIED.barrel, definitions.barrel.definitionId, { initialState: "absent" }), ground(CARRIED.keyFloor, definitions.key.definitionId)] };
}

/** Disclosed native-Rules prehistory, no model sample: three cloths go into
 * the box, which is closed, and two into the barrel. Each scenario then plays
 * how the item the sentence means came to hand. */
export async function prepareCarriedReferenceHistory(source: Awaited<ReturnType<typeof historyHttpSource>>, scenario: CarriedScenario) {
  const actor = source.characters[0].characterId, peer = source.characters[1]?.characterId;
  if (!peer) throw new Error("CARRIED_REFERENCE_PEER_REQUIRED");
  await runInDurableObject(source.stub, instance => {
    const target = instance as unknown as Data, original = target.authoritativeReplay();
    let state = original.state, ordinal = 0;
    const events: Data[] = [];
    const inventory = (who: string, operation: Data): string => {
      const refs = [...new Set([who, "wake", operation.entryRef, operation.containerRef, operation.targetCharacterRef].filter(Boolean))].sort();
      const result = target.rulesRuntime.step(original.profiles, state, { kind: "inventoryOperation",
        rootActionId: `root:carried-prehistory:${++ordinal}`, actorCharacterId: who,
        plan: { schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: canonicalHash({ purpose: "declared-fixture-prehistory" }),
          readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(state, ref) })),
          basisRefs: ["wake"], summary: "预置公开说明的物品前史。", operation } });
      expect(result.kind, JSON.stringify(result.rejection)).toBe("committed");
      state = result.state; events.push(...result.events);
      return result.events.find((event: Data) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
    };
    const lid = (fromState: string, toState: string) => {
      const changed = createEventTransition(state, original.profiles, { rootActionId: `root:carried-prehistory:${++ordinal}`,
        eventType: "ItemStateTransitioned", payload: { actorCharacterId: actor, sceneId: "wake", entryRef: CARRIED.box,
          fromState, toState, intent: toState === "open" ? "open" : "close" } as never, visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
      state = changed.state; events.push(changed.event);
    };
    const boxStack = inventory(actor, { kind: "store", entryRef: CARRIED.cloth, quantity: 3, containerRef: CARRIED.box });
    inventory(actor, { kind: "store", entryRef: CARRIED.cloth, quantity: 2, containerRef: CARRIED.barrel });
    lid("open", "closed");
    const fromBox = () => { lid("closed", "open"); inventory(actor, { kind: "acquire", entryRef: boxStack, quantity: 1 }); lid("open", "closed"); };
    const fromBarrel = () => inventory(actor, { kind: "acquire", entryRef: CARRIED.cloth, quantity: 1 });
    if (scenario === "boxTake") fromBox();
    else if (scenario === "barrelTake") fromBarrel();
    else if (scenario === "twoSources") { fromBox(); fromBarrel(); }
    else if (scenario === "pickUp") inventory(actor, { kind: "acquire", entryRef: CARRIED.keyFloor, quantity: 1 });
    else if (scenario === "handedOver") inventory(peer, { kind: "transfer", entryRef: CARRIED.ropeGift, quantity: 1, targetCharacterRef: actor,
      ownershipDisposition: "transferToRecipient" });
    else { fromBox(); inventory(actor, { kind: "store", entryRef: CARRIED.keyHeld, quantity: 1, containerRef: CARRIED.pouch });
      inventory(actor, { kind: "acquire", entryRef: CARRIED.keyFloor, quantity: 1 }); }
    const replayed = target.rulesRuntime.replay(original.genesis, [...target.authorityStore.events(), ...events]);
    expect(replayed.kind).toBe("replayed"); expect(replayed.state).toEqual(state);
    target.authorityStore.appendEvents(events); target.authorityStore.updateState(state); target.authorityStore.syncAuthorityIndex(state);
  });
}

/** SPEC 0001 §16, SPEC 0016 §4.3: what the sentence meant moved, and nothing
 * else did; no item was created. */
export function assertCarriedReferenceStep(scenario: CarriedScenario, before: Data, after: Data, actor: string) {
  const entries = (snapshot: Data) => Object.values(snapshot.state.campaignRuntime.itemSystem.entries) as Data[];
  const inside = (snapshot: Data, containerRef: string) => entries(snapshot).filter(entry => entry.containerRef === containerRef && entry.definitionRef === CARRIED_CLOTH)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const loose = (snapshot: Data) => entries(snapshot).filter(entry => entry.definitionRef === CARRIED_CLOTH && entry.holderRef === actor
    && entry.disposition === "held" && entry.containerRef === undefined).reduce((sum, entry) => sum + entry.quantity, 0);
  const at = (snapshot: Data, ref: string) => snapshot.state.campaignRuntime.itemSystem.entries[ref];
  expect(after.events.slice(before.events.length).filter((event: Data) => event.eventType === "ItemMaterialized"), "no item is created").toHaveLength(0);
  expect(entries(after).filter(entry => entry.definitionRef === CARRIED_CLOTH).reduce((sum, entry) => sum + entry.quantity, 0)).toBe(5);
  expect(at(after, CARRIED.box).stateMachine.state, "the box ends closed").toBe("closed");
  if (scenario === "boxTake" || scenario === "afterOtherActs") {
    expect([inside(after, CARRIED.box), inside(after, CARRIED.barrel), loose(after)], "the piece goes back into the box").toEqual([3, 2, 0]);
  } else if (scenario === "barrelTake") {
    expect([inside(after, CARRIED.box), inside(after, CARRIED.barrel), loose(after)], "the piece goes back into the barrel").toEqual([3, 2, 0]);
  } else if (scenario === "twoSources") {
    expect([inside(after, CARRIED.box), inside(after, CARRIED.barrel), loose(after)], "one piece goes back into the barrel, one stays").toEqual([2, 2, 1]);
  } else if (scenario === "pickUp") {
    expect(at(after, CARRIED.keyFloor), "the key just picked up goes into the pouch").toMatchObject({ holderRef: actor, containerRef: CARRIED.pouch });
    expect(at(after, CARRIED.keyHeld), "the other key stays in hand").toMatchObject({ holderRef: actor, disposition: "held" });
    expect(at(after, CARRIED.keyHeld).containerRef).toBeUndefined();
  } else {
    expect(at(after, CARRIED.ropeGift), "the rope just handed over goes into the pouch").toMatchObject({ holderRef: actor, containerRef: CARRIED.pouch });
    expect(at(after, CARRIED.ropeOwn), "the actor's own rope stays in hand").toMatchObject({ holderRef: actor, disposition: "held" });
    expect(at(after, CARRIED.ropeOwn).containerRef).toBeUndefined();
  }
}
