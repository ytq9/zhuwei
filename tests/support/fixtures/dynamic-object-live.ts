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
export async function prepareContainerLiveHistory(source: Awaited<ReturnType<typeof historyHttpSource>>) {
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
    expect(state.campaignRuntime.itemSystem.entries[LIVE_CONTENTS].quantity).toBe(2);
    expect(state.vNextItemAuthority.containerMemories[actor][LIVE_CONTAINER].entries[0].quantity).toBe(3);
    const replayed = target.rulesRuntime.replay(original.genesis, [...target.authorityStore.events(), ...events]);
    expect(replayed.kind).toBe("replayed"); expect(replayed.state).toEqual(state);
    target.authorityStore.appendEvents(events); target.authorityStore.updateState(state); target.authorityStore.syncAuthorityIndex(state);
  });
}

export function assertContainerLiveStep(initial: Data, after: Data, actor: string, index: number) {
  const system = after.state.campaignRuntime.itemSystem, box = system.entries[LIVE_CONTAINER];
  expect(box).toMatchObject({ entryId: LIVE_CONTAINER, holderRef: actor, definitionRef: LIVE_BOX_DEFINITION, stateMachine: { state: "closed" } });
  const remaining = index === 0 ? 1 : 2;
  expect(system.entries[LIVE_CONTENTS]).toMatchObject({ entryId: LIVE_CONTENTS, containerRef: LIVE_CONTAINER, quantity: remaining });
  expect(after.state.vNextItemAuthority.containerMemories[actor][LIVE_CONTAINER].entries).toEqual([
    expect.objectContaining({ entryId: LIVE_CONTENTS, quantity: remaining, name: "干净布条" }),
  ]);
  const cloth = Object.values(system.entries).filter((entry: any) => entry.definitionRef === LIVE_CLOTH_DEFINITION) as Data[];
  expect(cloth.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(3);
  const outside = cloth.filter(entry => entry.holderRef === actor && entry.containerRef === undefined && entry.disposition === "held");
  expect(outside.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(index === 0 ? 1 : 0);
  const sampled = after.events.slice(initial.events.length);
  expect(sampled.filter((event: Data) => ["ItemMaterialized", "ItemDefinitionRegistered"].includes(event.eventType))).toHaveLength(0);
  if (index === 2) expect(Object.keys(system.entries).sort()).toEqual(Object.keys(initial.state.campaignRuntime.itemSystem.entries).sort());
}
