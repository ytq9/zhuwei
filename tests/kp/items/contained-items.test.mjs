import assert from "node:assert/strict";
import test from "node:test";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { step, project, initialize, inventoryInput, PLAYER, PRINCIPAL, SEAT, RECIPIENT, SCENE, assertReplay, withCombatFixture } from "../../support/fixtures/inventory-operations.mjs";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";
import { objectCompletionPlan } from "../../../app/_runtime/lib/rules/v2/object-mechanics.ts";
import { spendItemEntryCosts } from "../../../app/_runtime/lib/rules/v2/item-transitions.ts";

const FIRST = "item-entry:container:first", SECOND = "item-entry:container:second", CONTENTS = "item-entry:container:cloth";
function fixture(initialState = "absent") {
  const container = healingPotionItemDefinition(), contents = healingPotionItemDefinition();
  container.definitionId = "item-definition:container:barrel";
  Object.assign(container.content, { label: "木桶", description: "敞口的木桶。", category: "object", stackable: false, use: null });
  contents.definitionId = "item-definition:container:cloth";
  Object.assign(contents.content, { label: "布条", description: "可用的布条。", category: "object", use: null });
  const itemEntries = [FIRST, SECOND].map(entryId => ({ definitionRef: container.definitionId,
    entry: { entryId, quantity: 1, initialState, placement: { kind: "scene", sceneRef: SCENE }, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:scene-observers" } }));
  itemEntries.push({ definitionRef: contents.definitionId, entry: { entryId: CONTENTS, quantity: 3,
    placement: { kind: "held", holderRef: PLAYER, equippedSlot: null }, ownership: { kind: "character", ownerRef: PLAYER } } });
  const f = { ...initialize(undefined, { includeRecipient: true, vNextSeed: { semanticDefinitions: [],
    itemDefinitions: [container, contents], entityDefinitionBindings: [], itemEntries } }), events: [], ordinal: 0 };
  f.input = (operation, actor = PLAYER) => {
    const input = inventoryInput(f.state, `root:container:${++f.ordinal}`, operation, actor);
    if (operation.containerRef) input.plan.readSet.push({ ref: operation.containerRef, revisionOrHash: authorityRevisionOrHash(f.state, operation.containerRef) });
    return input;
  };
  f.act = (operation, actor) => {
    const result = step(f.profiles, f.state, f.input(operation, actor));
    assert.equal(result.kind, "committed", JSON.stringify(result));
    f.state = result.state; f.events.push(...result.events);
    return result.events.find(e => e.eventType === "InventoryOperationApplied").payload.targetEntryId;
  };
  return f;
}

// SPEC 0001 §§3.3、16: taking one item never regenerates the original three.
test("container contents survive partial withdrawal, transfer and replay", () => {
  const f = fixture();
  f.act({ kind: "store", entryRef: CONTENTS, quantity: 3, containerRef: FIRST });
  const taken = f.act({ kind: "acquire", entryRef: CONTENTS, quantity: 1 });
  assert.notEqual(taken, CONTENTS);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 2);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].containerRef, FIRST);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[taken].containerRef, undefined);
  f.act({ kind: "transfer", entryRef: taken, quantity: 1, targetCharacterRef: RECIPIENT, ownershipDisposition: "transferToRecipient" });
  assert.equal(f.state.campaignRuntime.itemSystem.entries[taken].holderRef, RECIPIENT);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 2);
  assertReplay(f, f.events, f.state);
});

test("closed portable containers retain last inspected contents while blocking actual taking", () => {
  const f = fixture("open");
  f.act({ kind: "acquire", entryRef: FIRST, quantity: 1 });
  f.act({ kind: "store", entryRef: CONTENTS, quantity: 3, containerRef: FIRST });
  const stale = f.input({ kind: "acquire", entryRef: CONTENTS, quantity: 1 });
  const transition = (fromState, toState, intent) => {
    const changed = createEventTransition(f.state, f.profiles, { rootActionId: `root:container:${++f.ordinal}`,
      eventType: "ItemStateTransitioned", payload: { actorCharacterId: PLAYER, sceneId: SCENE, entryRef: FIRST, fromState, toState, intent },
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
    f.state = changed.state; f.events.push(changed.event);
  };
  transition("open", "closed", "close");
  assert.equal(step(f.profiles, f.state, stale).kind, "rejected", "container state participates in the child's read hash");
  for (const operation of [{ kind: "acquire", entryRef: CONTENTS, quantity: 1 },
    { kind: "lifecycle", entryRef: CONTENTS, action: "destroy" }]) {
    assert.equal(step(f.profiles, f.state, f.input(operation)).kind, "rejected");
  }
  assert.deepEqual(spendItemEntryCosts(f.state.campaignRuntime.itemSystem, { entryId: CONTENTS, holderRef: PLAYER,
    quantityCost: 1, chargeCost: 0, durabilityCost: 0 }), { error: "itemContainerClosed" });
  const read = () => project(f.profiles, f.state, { kind: "player", principalId: PRINCIPAL, sessionVersion: 1, seatId: SEAT, characterId: PLAYER });
  const closed = read();
  assert.equal(closed.kind, "projected");
  assert.ok(!closed.visibleItems.some(item => item.itemEntryId === CONTENTS));
  assert.ok(!closed.controlledCharacter.inventory.entries.some(item => item.entryId === CONTENTS));
  assert.equal(closed.controlledCharacter.inventory.containerMemories[0].entries[0].quantity, 3);
  transition("closed", "open", "open");
  assert.ok(JSON.stringify(read()).includes(CONTENTS));
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 3);
  assertReplay(f, f.events, f.state);
});

test("an explicitly absent mechanism cannot later be replaced with a lock", () => {
  const f = fixture();
  const result = objectCompletionPlan(f.state, PLAYER, FIRST, "locked", null, null, false);
  assert.equal(result.kind, "rejected");
  assert.equal(result.reason, "object:already-complete");
  assert.equal(f.state.campaignRuntime.itemSystem.entries[FIRST].stateMachine, null);
});

test("contents of a destroyed map container remain present and can be recovered", () => {
  const f = withCombatFixture(fixture(), state => {
    const vessel = state.combatRuntime.scenes[SCENE].geometry.obstacles[0];
    vessel.state = "destroyed";
  });
  const containerRef = f.state.combatRuntime.scenes[SCENE].geometry.obstacles[0].featureId;
  const input = inventoryInput(f.state, "root:container:put-in-remains", { kind: "store", entryRef: CONTENTS, quantity: 3, containerRef });
  input.plan.readSet.push({ ref: containerRef, revisionOrHash: authorityRevisionOrHash(f.state, containerRef) });
  const stored = step(f.profiles, f.state, input);
  assert.equal(stored.kind, "committed", JSON.stringify(stored.rejection));
  const result = step(f.profiles, stored.state, inventoryInput(stored.state, "root:container:recover-debris", { kind: "acquire", entryRef: CONTENTS, quantity: 1 }));
  assert.equal(result.kind, "committed", JSON.stringify(result.rejection));
  assert.equal(result.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 2);
  assertReplay(f, [...stored.events, ...result.events], result.state);
});

test("moving a container preserves original contents; destroying it does not erase them", () => {
  const f = fixture();
  f.act({ kind: "store", entryRef: CONTENTS, quantity: 3, containerRef: FIRST });
  f.act({ kind: "acquire", entryRef: FIRST, quantity: 1 });
  f.act({ kind: "transfer", entryRef: FIRST, quantity: 1, targetCharacterRef: RECIPIENT, ownershipDisposition: "transferToRecipient" });
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].holderRef, RECIPIENT);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].containerRef, FIRST);
  f.act({ kind: "lifecycle", entryRef: FIRST, action: "destroy" }, RECIPIENT);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].containerRef, undefined);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 3);
  assertReplay(f, f.events, f.state);
});

test("same-name containers do not merge stacks; cycles and stale placement reject atomically", () => {
  const f = fixture();
  const firstRef = f.act({ kind: "store", entryRef: CONTENTS, quantity: 1, containerRef: FIRST });
  f.act({ kind: "store", entryRef: CONTENTS, quantity: 2, containerRef: SECOND });
  assert.equal(f.state.campaignRuntime.itemSystem.entries[firstRef].quantity, 1);
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 2);
  f.act({ kind: "store", entryRef: FIRST, quantity: 1, containerRef: SECOND });
  const before = structuredClone(f.state);
  for (const [entryRef, containerRef] of [[SECOND, FIRST], [FIRST, FIRST]]) {
    assert.equal(step(f.profiles, f.state, f.input({ kind: "store", entryRef, quantity: 1, containerRef })).kind, "rejected");
  }
  const stale = f.input({ kind: "store", entryRef: FIRST, quantity: 1, containerRef: SECOND });
  stale.plan.readSet.at(-1).revisionOrHash = `sha256:${"0".repeat(64)}`;
  assert.equal(step(f.profiles, f.state, stale).kind, "rejected");
  assert.deepEqual(f.state, before);
  assertReplay(f, f.events, f.state);
});

// SPEC 0001 §§9、16: the viewer's last inspection is not a live stock query.
test('closed memory survives another actor changing contents and refreshes only on the owner reopening', () => {
  const f = fixture('open');
  f.act({ kind: 'store', entryRef: CONTENTS, quantity: 3, containerRef: FIRST });
  const change = (actor, fromState, toState, intent) => {
    const next = createEventTransition(f.state, f.profiles, { rootActionId: `root:memory:${++f.ordinal}`,
      eventType: 'ItemStateTransitioned', payload: { actorCharacterId: actor, sceneId: SCENE, entryRef: FIRST, fromState, toState, intent },
      visibilityPolicyId: 'visibility:room-authority-only', secrecy: 'internal' });
    f.state = next.state; f.events.push(next.event);
  };
  change(PLAYER, 'open', 'closed', 'close');
  const original = structuredClone(f.state.vNextItemAuthority.containerMemories[PLAYER][FIRST]);
  change(RECIPIENT, 'closed', 'open', 'open');
  f.act({ kind: 'acquire', entryRef: CONTENTS, quantity: 1 }, RECIPIENT);
  change(RECIPIENT, 'open', 'closed', 'close');
  assert.equal(f.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 2);
  assert.deepEqual(f.state.vNextItemAuthority.containerMemories[PLAYER][FIRST], original);
  f.act({ kind: 'acquire', entryRef: FIRST, quantity: 1 });
  const viewed = project(f.profiles, f.state, { kind: 'player', principalId: PRINCIPAL, sessionVersion: 1, seatId: SEAT, characterId: PLAYER });
  assert.equal(viewed.controlledCharacter.inventory.containerMemories[0].entries[0].quantity, 3);
  const rejected = step(f.profiles, f.state, f.input({ kind: 'acquire', entryRef: CONTENTS, quantity: 1 }));
  assert.equal(rejected.kind, 'rejected');
  assert.deepEqual(f.state.vNextItemAuthority.containerMemories[PLAYER][FIRST], original);
  change(PLAYER, 'closed', 'open', 'open');
  assert.equal(f.state.vNextItemAuthority.containerMemories[PLAYER][FIRST].entries[0].quantity, 2);
  assert.equal(f.state.vNextItemAuthority.containerMemories[PLAYER][FIRST].entries[0].entryId, CONTENTS);
  assertReplay(f, f.events, f.state);
});
