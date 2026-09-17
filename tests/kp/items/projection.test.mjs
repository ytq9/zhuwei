// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { createInitialItemEntry, itemDefinitionFromStandardGear } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { itemById } from "../../../app/_runtime/lib/dnd/gear.ts";
import { project, PLAYER, PRINCIPAL, SEAT, RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT, SCENE, initialize, apply, assertReplay } from '../../support/fixtures/inventory-operations.mjs';


test("committed inventory outcomes reach authorized Viewer Claims without the internal event envelope", () => {
  for (const [gearId, quantity, policy] of [
    ['bolt', 20, 'visibility:scene-observers'],
    ['rope-50ft', 1, 'visibility:scene-observers'],
    ['bolt', 20, `visibility:character-controller:${PLAYER}`],
  ]) {
    const definition = itemDefinitionFromStandardGear(itemById(gearId));
    const entry = createInitialItemEntry(definition, { entryId: `item-entry:claims:${gearId}`, quantity,
      placement: { kind: 'held', holderRef: PLAYER, equippedSlot: null },
      visibilityPolicyRef: policy, ownership: { kind: 'character', ownerRef: PLAYER } });
    const scenario = initialize(undefined, { includeRecipient: true, vNextSeed: {
      semanticDefinitions: [], itemDefinitions: [definition], itemEntries: [{ definitionRef: definition.definitionId, entry: {
        entryId: entry.entryId, quantity, placement: { kind: "held", holderRef: PLAYER, equippedSlot: null },
        ownership: entry.ownership, visibilityPolicyRef: policy } }], entityDefinitionBindings: [],
    } });
    const result = apply(scenario, scenario, 'claims-release', {
      kind: 'release', entryRef: entry.entryId, quantity: 1, sceneRef: SCENE, releaseKind: 'placement',
    });
    const releasedRef = result.events.find(event => event.eventType === 'InventoryOperationApplied').payload.targetEntryId;
    const view = (characterId, principalId, seatId) => project(scenario.profiles, result.state,
      { kind: 'player', characterId, principalId, seatId, sessionVersion: 1 },
      { channel: 'realtime', committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: PLAYER,
        priorState: scenario.state, events: result.events } });
    const actorView = view(PLAYER, PRINCIPAL, SEAT);
    assert.equal(actorView.kind, 'projected', JSON.stringify(actorView));
    const claim = actorView.renderableClaims.claims.find(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === releasedRef);
    assert.ok(claim, 'the actual placement must be narrated, not only actionCommitted');
    assert.equal(claim.itemRef, releasedRef);
    assert.match(claim.summary, /1/);
    assert.ok(claim.narrationFacts.some(text => text.includes(definition.content.label)));
    assert.equal(claim.operation.actorRef, PLAYER);
    assert.ok(claim.narrationFacts.includes(`${claim.displayNames[PLAYER] ?? '行动角色'}已将 1 件${definition.content.label}放置在场景中`));
    assert.equal(JSON.stringify(claim).includes('room-authority-only'), false);
    assert.equal(JSON.stringify(claim).includes('contextHash'), false);
    const other = view(RECIPIENT, RECIPIENT_PRINCIPAL, RECIPIENT_SEAT);
    assert.equal(other.kind, 'projected', JSON.stringify(other));
    assert.ok(other.renderableClaims.claims.some(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === releasedRef));
    if (quantity > 1) {
      const source = actorView.renderableClaims.claims.find(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === entry.entryId);
      assert.ok(source);
      assert.equal(source.state, undefined, 'the remaining held stack was not put down');
      assert.equal(other.renderableClaims.claims.some(claim => claim.kind === 'inventoryOutcome' && claim.itemRef === entry.entryId), policy === 'visibility:scene-observers');
    }
    assertReplay(scenario, result.events, result.state);
  }
});
