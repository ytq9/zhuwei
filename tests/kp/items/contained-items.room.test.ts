import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { initializeObjectRoom, withObjectRoomScenario, OBJECT_ROOM_PRINCIPAL as ALICE, OBJECT_ROOM_ACTOR as ACTOR } from "../../support/fixtures/object-mechanics-room";
import { VNEXT_SEMANTIC_TEMPLATES } from "../../../app/_runtime/lib/rules/profiles/semantic-templates";

type Data = Record<string, any>;
vi.spyOn(console, "info").mockImplementation(() => {});
const BARREL = "feature:continuity:barrel";
const points = (x0: string, y0: string, x1: string, y1: string) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const geometry = { schema: "zhuwei.tactical-geometry/v1", unit: "inch", boundary: { kind: "polygon", points: points("0", "0", "480", "480") },
  spawnPoints: [{ x: "100", y: "100", elevation: "0" }], clearanceZones: [], obstacles: [{ featureId: BARREL, kind: "interactable", label: "木桶", state: "open",
    polygon: points("145", "95", "155", "105"), elevation: "0", height: "24", opaque: true, impassable: true, cover: "half", propagation: "blocks", visibilityPolicyId: "visibility:scene-observers" }] };
const common = (sceneRef: string) => ({ basisRefs: [sceneRef], consumes: [], produces: [], outcomeBinding: "always" });
const outcome = { outcomeCode: "outcome:continuity", summary: "行动完成。", effects: [], sensoryEvidence: [], pressures: [], opportunities: [] };
const go = (sceneRef: string, targetRef: string) => ({ ...common(sceneRef), kind: "worldInteraction", sceneRef,
  intent: "沿原通路前往已知地点。", method: "沿连接通路步行。", targetRefs: [], directTargetRefs: [], instrumentRefs: [], abilityRef: null,
  commonAction: { kind: "goTo", targetRef, destinationRef: null, option: "none" }, branches: { success: outcome, failure: null } });
function newPlace(kind: "location" | "passage", handle: string, details: Data) {
  const template = VNEXT_SEMANTIC_TEMPLATES[kind];
  return { ...common("wake"), kind: "materializeObject", semanticKind: kind, templateRef: template.templateRef, templateHash: template.templateHash,
    visibilityPolicyRef: "visibility:scene-observers", produces: [{ handle, kind: "semanticDefinition", outcomeBinding: "always" }],
    definition: { sceneRef: "wake", label: kind === "location" ? "储物间" : "储物间通路", description: "大厅旁有一间储物间。", visibilityFactId: null,
      observableState: kind === "passage" ? "open" : null, affordances: null, mechanicDefinitionRefs: [], ...details }, summary: "确定储物间与通路。" };
}
function itemContent(label: string, stackable: boolean): Data {
  return { schema: "zhuwei.item-definition-content/v1", label, description: label === "布条" ? "干净的布条。" : "一盏小铜灯。",
    category: "object", aliases: [], tags: [], stackable, equipment: null, equippedAbilityRefs: [], use: null,
    chargesMaximum: null, durabilityMaximum: null, ...(stackable ? {} : { undeterminedFields: ["durabilityMaximum"] }) };
}
function defineContents(sceneRef: string, label: string, suffix: string, quantity: number, stackable: boolean) {
  const definitionRef = `prospective:definition-${suffix}`;
  return [{ ...common(sceneRef), kind: "materializeDefinition", source: { kind: "item", content: itemContent(label, stackable) },
    produces: [{ handle: definitionRef, kind: "itemDefinition", outcomeBinding: "always" }], visibilityPolicyRef: "visibility:public", summary: "确定原有物品定义。" },
  { ...common(sceneRef), kind: "materializeItem", definitionRef, sceneRef, containerRef: BARREL, quantity,
    ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:scene-observers",
    consumes: [{ kind: "prospective", handle: definitionRef }], produces: [{ handle: `prospective:entry-${suffix}`, kind: "itemEntry", outcomeBinding: "always" }], summary: "物品原本就在木桶内。" }];
}
const inventory = (sceneRef: string, operation: Data) => ({ ...common(sceneRef), kind: "inventoryOperation", operation, summary: "按玩家意图操作原物品。" });
const find = (state: Data, name: string, containerRef?: string): Data => Object.values(state.campaignRuntime.itemSystem.entries).find((entry: any) =>
  state.campaignRuntime.itemSystem.definitions[entry.definitionRef].content.label === name && (containerRef === undefined || entry.containerRef === containerRef)) as Data;

// SPEC 0001 §§3.3、16; SPEC 0016 §7.2. Real Room/SQLite/recovery interfaces;
// KP outputs are scripted and do not establish real-provider reliability.
it("keeps discovered barrel contents through partial taking, native completion, travel, retry, eviction and archive restore", async () => {
  const { stub, capabilities } = await initializeObjectRoom("contained-items-room-source");
  const saved = await withObjectRoomScenario(stub, async (act, target, calls) => {
    await act("discover", "我查看大厅旁的储物间入口。", [newPlace("location", "prospective:store-room", { geometry }),
      newPlace("passage", "prospective:store-way", { passage: { fromLocationRef: "wake", toLocationRef: "prospective:store-room", bidirectional: true,
        traversal: "沿通路走进储物间", travelDurationMicros: "60000000" } })], "0");
    const location = Object.values(target.authoritativeReplay().state.campaignRuntime.definitions).find((value: any) => value.semanticKind === "location") as Data;
    await act("enter", "我沿通路进入储物间。", [go("wake", location.definitionId)], "0");
    const sceneRef = target.authoritativeReplay().state.entities[ACTOR].sceneId;
    await act("contents", "我查看敞口木桶里有什么。", [...defineContents(sceneRef, "布条", "cloth", 3, true), ...defineContents(sceneRef, "铜灯", "lamp", 1, false)], "0");
    let state = target.authoritativeReplay().state;
    const clothRef = find(state, "布条", BARREL).entryId, lampRef = find(state, "铜灯", BARREL).entryId;
    const take = [inventory(sceneRef, { kind: "acquire", entryRef: clothRef, quantity: 1 })];
    const first = await act("take-one", "我从木桶里拿出一块布条。", take, "300000000");
    const eventCount = target.authorityStore.events().length, invocationCount = calls.length;
    const retried = await act("take-one", "我从木桶里拿出一块布条。", take, "300000000");
    expect(retried.receipt).toEqual(first.receipt); expect(target.authorityStore.events()).toHaveLength(eventCount); expect(calls).toHaveLength(invocationCount);
    await act("take-lamp", "我拿出木桶里的铜灯。", [inventory(sceneRef, { kind: "acquire", entryRef: lampRef, quantity: 1 })], "300000000");
    state = target.authoritativeReplay().state;
    const content = structuredClone(state.campaignRuntime.itemSystem.definitions[state.campaignRuntime.itemSystem.entries[lampRef].definitionRef].content);
    content.durabilityMaximum = 4; delete content.undeterminedFields;
    const callsBeforeCompletion = calls.length;
    await act("break-lamp", "我用力把铜灯敲坏。", [{ ...common(sceneRef), kind: "completeObject", definitionRef: lampRef,
      description: "none", observableState: "none", mechanics: { kind: "itemDefinition", content }, summary: "在动作前确定铜灯尚缺的耐久。" },
      inventory(sceneRef, { kind: "lifecycle", entryRef: lampRef, action: "break" })], "300000000");
    // SPEC 0016 §7.2: one selection and one filling; only the selected item
    // completion grammar is sent. The real Room still commits the same lamp.
    expect(calls.length - callsBeforeCompletion).toBe(2);
    const completionForm = JSON.stringify(calls.at(-1)?.tools[0].function.parameters);
    expect(completionForm).toContain('"itemDefinition"');
    expect(completionForm).not.toContain('"npcCombat"');
    expect(completionForm).not.toContain('"destroyed"');
    state = target.authoritativeReplay().state;
    expect(state.campaignRuntime.itemSystem.entries[clothRef]).toMatchObject({ quantity: 2, containerRef: BARREL, sceneRef });
    expect(state.campaignRuntime.itemSystem.entries[lampRef]).toMatchObject({ entryId: lampRef, holderRef: ACTOR, condition: "broken", durability: { current: 0, maximum: 4 } });
    await act("leave", "我沿通路返回大厅。", [go(sceneRef, "wake")], "0");
    return { sceneRef, locationRef: location.definitionId, clothRef, lampRef };
  });
  await evictDurableObject(stub);
  const beforeArchive = await withObjectRoomScenario(stub, async (act, target) => {
    await act("return", "我回储物间查看之前那个木桶。", [go("wake", saved.locationRef)], "0");
    const system = target.authoritativeReplay().state.campaignRuntime.itemSystem;
    expect(system.entries[saved.clothRef]).toMatchObject({ quantity: 2, containerRef: BARREL });
    expect(system.entries[saved.lampRef]).toMatchObject({ holderRef: ACTOR, condition: "broken", durability: { current: 0, maximum: 4 } });
    return system;
  });
  const observed = await stub.observe(ALICE) as Data;
  expect(observed.readModel.visibleItems).toEqual(expect.arrayContaining([expect.objectContaining({ itemEntryId: saved.clothRef, containerRef: BARREL, quantity: 2 })]));
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported.kind).toBe("exported");
  const restored = env.VNEXT_ROOMS.getByName("contained-items-room-restored");
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  const recovered = await restored.observe(ALICE) as Data;
  expect(recovered.readModel.visibleItems).toEqual(observed.readModel.visibleItems);
  await withObjectRoomScenario(restored, async (_act, target) => expect(target.authoritativeReplay().state.campaignRuntime.itemSystem).toEqual(beforeArchive));
}, 30_000);

it('opens, takes and closes a portable box in one action and preserves last inspection through eviction and archive', async () => {
  const { stub, capabilities } = await initializeObjectRoom('closed-container-inspection-source');
  await withObjectRoomScenario(stub, async (act, target) => {
    const sceneRef = 'wake';
    const define = (label: string, handle: string, stackable: boolean) => ({ ...common(sceneRef), kind: 'materializeDefinition',
      source: { kind: 'item', content: itemContent(label, stackable) }, produces: [{ handle, kind: 'itemDefinition', outcomeBinding: 'always' }],
      visibilityPolicyRef: 'visibility:public', summary: '按场景来源确定原物品定义。' });
    const create = (definitionRef: string, handle: string, quantity: number, extra: Data = {}) => ({ ...common(sceneRef), kind: 'materializeItem',
      definitionRef, sceneRef, quantity, ownership: { kind: 'unowned', ownerRef: null }, visibilityPolicyRef: 'visibility:scene-observers',
      produces: [{ handle, kind: 'itemEntry', outcomeBinding: 'always' }], summary: '固化箱子原有内容。', ...extra });
    await act('create-closed-box', '我拿起这个合着的小箱。', [define('小箱', 'prospective:box-def', false),
      create('prospective:box-def', 'prospective:box', 1, { initialState: 'closed' }), define('布条', 'prospective:cloth-def', true),
      create('prospective:cloth-def', 'prospective:cloth', 3, { containerRef: 'prospective:box' }),
      inventory(sceneRef, { kind: 'acquire', entryRef: 'prospective:box', quantity: 1 })]);
    const box = find(target.authoritativeReplay().state, '小箱').entryId;
    const cloth = find(target.authoritativeReplay().state, '布条', box).entryId;
    const operate = (option: string) => ({ ...common(sceneRef), kind: 'worldInteraction', sceneRef, targetRefs: [box], directTargetRefs: [box], instrumentRefs: [], abilityRef: null,
      intent: '打开或合上原箱盖。', method: '操作箱盖。', commonAction: { kind: 'operateObject', targetRef: box, destinationRef: null, option },
      branches: { success: outcome, failure: null } });
    // The grouped filling has no interleaving order. The server proves it.
    await act('open-take-close', '我打开小箱，拿出一块布条，再把箱盖合上。', [operate('close'),
      inventory(sceneRef, { kind: 'acquire', entryRef: cloth, quantity: 1 }), operate('open')]);
    const state = target.authoritativeReplay().state;
    expect(state.campaignRuntime.itemSystem.entries[box].stateMachine.state).toBe('closed');
    expect(state.campaignRuntime.itemSystem.entries[cloth]).toMatchObject({ quantity: 2, containerRef: box });
    expect(state.vNextItemAuthority.containerMemories[ACTOR][box].entries).toEqual([expect.objectContaining({ entryId: cloth, quantity: 2, name: '布条' })]);
  });
  const before = (await stub.observe(ALICE) as Data).readModel.controlledCharacter.inventory;
  expect(before.containerMemories).toHaveLength(1);
  await evictDurableObject(stub);
  expect((await stub.observe(ALICE) as Data).readModel.controlledCharacter.inventory).toEqual(before);
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported.kind).toBe('exported');
  const restored = env.VNEXT_ROOMS.getByName('closed-container-inspection-restored');
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: 'restored' });
  expect((await restored.observe(ALICE) as Data).readModel.controlledCharacter.inventory).toEqual(before);
}, 30_000);

// SPEC 0001 §16, SPEC 0016 §7.3: the same finite filling expands for a
// carried box and a map container, through the actual Room journal and Rules.
it('containerTransfer fills only inventory and commits existing identities for held and mapped containers', async () => {
  const { stub } = await initializeObjectRoom('container-transfer-wire-room');
  await withObjectRoomScenario(stub, async (act, target, calls) => {
    await act('discover', '我查看储物间入口。', [newPlace('location', 'prospective:store-room', { geometry }),
      newPlace('passage', 'prospective:store-way', { passage: { fromLocationRef: 'wake', toLocationRef: 'prospective:store-room', bidirectional: true,
        traversal: '沿通路走进储物间', travelDurationMicros: '60000000' } })], '0');
    const location = Object.values(target.authoritativeReplay().state.campaignRuntime.definitions).find((value: any) => value.semanticKind === 'location') as Data;
    await act('enter', '我沿通路进入储物间。', [go('wake', location.definitionId)], '0');
    const sceneRef = target.authoritativeReplay().state.entities[ACTOR].sceneId;
    const createDefinition = (label: string, handle: string, stackable: boolean) => ({ ...common(sceneRef), kind: 'materializeDefinition',
      source: { kind: 'item', content: itemContent(label, stackable) }, produces: [{ handle, kind: 'itemDefinition', outcomeBinding: 'always' }],
      visibilityPolicyRef: 'visibility:public', summary: '确定原物品定义。' });
    const create = (definitionRef: string, handle: string, quantity: number, extra: Data = {}) => ({ ...common(sceneRef), kind: 'materializeItem',
      definitionRef, sceneRef, quantity, ownership: { kind: 'unowned', ownerRef: null }, visibilityPolicyRef: 'visibility:scene-observers',
      produces: [{ handle, kind: 'itemEntry', outcomeBinding: 'always' }], summary: '固化原实物。', ...extra });
    await act('create', '我拿起小箱，把布条带在身上。', [createDefinition('测试小箱', 'prospective:boxdef', false),
      create('prospective:boxdef', 'prospective:box', 1, { initialState: 'closed' }),
      inventory(sceneRef, { kind: 'acquire', entryRef: 'prospective:box', quantity: 1 }),
      createDefinition('测试布条', 'prospective:clothdef', true), create('prospective:clothdef', 'prospective:cloth', 3),
      inventory(sceneRef, { kind: 'acquire', entryRef: 'prospective:cloth', quantity: 3 })]);
    const box = find(target.authoritativeReplay().state, '测试小箱').entryId;
    let cloth = find(target.authoritativeReplay().state, '测试布条').entryId;
    const script = (direction: string, containerRef: string, entryRef: string, quantity: number, access: string, after: string) => (wire: Data) => {
      wire.steps.inventoryOperation[0].operation = { kind: 'containerTransfer', direction, containerRef, entryRef, quantity, access, after };
      return wire;
    };
    const beforeDenied = structuredClone(target.authoritativeReplay().state), deniedEvents = structuredClone(target.authorityStore.events());
    await act('overdraw', '我打开小箱，放进四块布条，再合盖。', [inventory(sceneRef,
      { kind: 'store', entryRef: cloth, quantity: 4, containerRef: box })], '300000000', script('putIn', box, cloth, 4, 'openNormally', 'close'), 'needsKp');
    expect(target.authoritativeReplay().state).toEqual(beforeDenied);
    expect(target.authorityStore.events()).toEqual(deniedEvents);
    const countBefore = calls.length;
    await act('store-box', '我打开随身小箱，放进两块布条，合盖。', [inventory(sceneRef,
      { kind: 'store', entryRef: cloth, quantity: 2, containerRef: box })], '300000000', script('putIn', box, cloth, 2, 'openNormally', 'close'));
    expect(calls.length - countBefore).toBe(2);
    expect(JSON.stringify(calls.at(-1)?.tools)).toContain('containerTransfer');
    expect(JSON.stringify(calls.at(-1)?.tools)).not.toContain('"commonAction"');
    let state = target.authoritativeReplay().state;
    const boxed = find(state, '测试布条', box).entryId;
    expect(state.campaignRuntime.itemSystem.entries[box].stateMachine.state).toBe('closed');
    await act('take-box', '我打开原小箱，取出其中一块，再合盖。', [inventory(sceneRef,
      { kind: 'acquire', entryRef: boxed, quantity: 1 })], '300000000', script('takeOut', box, boxed, 1, 'openNormally', 'close'));
    state = target.authoritativeReplay().state;
    expect(state.campaignRuntime.itemSystem.entries[boxed]).toMatchObject({ entryId: boxed, quantity: 1, containerRef: box });
    cloth = (Object.values(state.campaignRuntime.itemSystem.entries).find((entry: any) => entry.holderRef === ACTOR
      && entry.containerRef === undefined && entry.definitionRef === state.campaignRuntime.itemSystem.entries[boxed].definitionRef) as Data).entryId;
    await act('store-map', '我把手里这块布条放进原木桶。', [inventory(sceneRef,
      { kind: 'store', entryRef: cloth, quantity: 1, containerRef: BARREL })], '300000000', script('putIn', BARREL, cloth, 1, 'alreadyOpen', 'leaveAsIs'));
    state = target.authoritativeReplay().state;
    expect(find(state, '测试布条', BARREL)).toMatchObject({ containerRef: BARREL, quantity: 1 });
    expect(Object.values(state.campaignRuntime.itemSystem.entries).filter((entry: any) => entry.definitionRef === state.campaignRuntime.itemSystem.entries[boxed].definitionRef)
      .reduce((sum: number, entry: any) => sum + entry.quantity, 0)).toBe(3);
  });
}, 30_000);
