import assert from "node:assert/strict";
import test from "node:test";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { authorityRevisionOrHash } from "../../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { step, project, initialize, inventoryInput, PLAYER, PRINCIPAL, SEAT, RECIPIENT, SCENE, assertReplay, withCombatFixture } from "../../support/fixtures/inventory-operations.mjs";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events.ts";
import { objectCompletionPlan } from "../../../app/_runtime/lib/rules/v2/object-mechanics.ts";
import { spendItemEntryCosts } from "../../../app/_runtime/lib/rules/v2/item-transitions.ts";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR } from "../../../tools/lib/vnext-authored-probe-fixture.mjs";
import { freezeAdjudicationContext } from "../../../app/_runtime/lib/kp/vnext/context/index.ts";
import { POSSESSION_RECALL_MAX_ROWS } from "../../../app/_runtime/lib/kp/vnext/context/possession-recall.ts";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { createInitialItemEntry } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { authorityItemComposite } from "../../../app/_runtime/lib/rules/v2/item-authority-vnext.ts";
import { proposalContextView, proposalInventoryEntryRefs, proposalKnowledgeRecallPending, proposalModelContext,
  recallKnowledge, withRecalledKnowledge } from "../../../app/_runtime/lib/kp/vnext/proposal-context.ts";
import { parseVNextProposalOfferResponse } from "../../../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";

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

// SPEC 0016 §8.3: one piece put back that joins the stack in the barrel is
// one move. Rules anchors it on both stacks so a Viewer who sees only one is
// still told; the actor, who sees both, is told it once.
test("a piece put back that joins a stack is told to a Viewer seeing both stacks once", () => {
  const f = fixture();
  f.act({ kind: "store", entryRef: CONTENTS, quantity: 3, containerRef: FIRST });
  const taken = f.act({ kind: "acquire", entryRef: CONTENTS, quantity: 1 });
  const prior = f.state;
  const result = step(f.profiles, f.state, f.input({ kind: "store", entryRef: taken, quantity: 1, containerRef: FIRST }));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 3, "the piece joined the stack in the barrel");
  const view = project(f.profiles, result.state, { kind: "player", characterId: PLAYER, principalId: PRINCIPAL, seatId: SEAT, sessionVersion: 1 },
    { channel: "realtime", committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: PLAYER, priorState: prior, events: result.events } });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  const told = view.renderableClaims.claims.filter(claim => claim.kind === "inventoryOutcome");
  assert.equal(told.length, 1, JSON.stringify(told));
  assert.deepEqual(told[0].narrationFacts.filter(fact => fact.includes("放入")), [`${told[0].displayNames[PLAYER] ?? "行动角色"}将 1 件布条放入木桶`]);
  assert.ok([taken, CONTENTS].every(ref => told[0].basisRefs.includes(ref)), "the told move rests on both stacks");
});

// SPEC 0016 §8.3: one piece set down from a held stack is one move too. The
// stack on the floor also carries its new state; told once, the move keeps
// it. A live put-back beside a set-down was told "放置在场景中" twice.
test("a piece set down from a held stack is told to a Viewer seeing both stacks once, with its state", () => {
  const f = fixture();
  const prior = f.state;
  const result = step(f.profiles, f.state, f.input({ kind: "release", entryRef: CONTENTS, quantity: 1, sceneRef: SCENE, releaseKind: "placement" }));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.campaignRuntime.itemSystem.entries[CONTENTS].quantity, 2, "the piece was split from the stack in hand");
  const view = project(f.profiles, result.state, { kind: "player", characterId: PLAYER, principalId: PRINCIPAL, seatId: SEAT, sessionVersion: 1 },
    { channel: "realtime", committedRange: { receiptId: result.receipt.receiptId, actorCharacterId: PLAYER, priorState: prior, events: result.events } });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  const told = view.renderableClaims.claims.filter(claim => claim.kind === "inventoryOutcome");
  assert.equal(told.length, 1, JSON.stringify(told));
  const actor = told[0].displayNames[PLAYER] ?? "行动角色";
  assert.deepEqual(told[0].narrationFacts, [`${actor}已将 1 件布条放置在场景中`, "布条的状态为 已放下"]);
  assert.equal(told[0].state, "已放下");
});

// SPEC 0001 §16 (ADR 0136): whoever an item reaches remembers how -- out of a
// container, up from the ground, handed over -- while it holds it loose.
// Pieces that join one stack keep each source; putting one back where it came
// from gives up that part; putting away or handing over forgets it, and the
// recipient remembers the giver. Replay rebuilds every record.
test("a holder remembers how each loose stack came to hand, keeps every source when pieces join, and forgets what it puts away", () => {
  const f = fixture();
  const own = (holder, ref) => f.state.vNextItemAuthority?.acquiredFrom?.[holder]?.[ref]?.map(({ from, ref: source, quantity }) => [from, source, quantity]);
  f.act({ kind: "store", entryRef: CONTENTS, quantity: 3, containerRef: FIRST });
  assert.equal(f.state.vNextItemAuthority.acquiredFrom, undefined, "storing is not coming to hand");
  const parked = f.act({ kind: "acquire", entryRef: CONTENTS, quantity: 1 });
  assert.deepEqual(own(PLAYER, parked), [["container", FIRST, 1]]);
  f.act({ kind: "store", entryRef: parked, quantity: 1, containerRef: SECOND });
  assert.equal(f.state.vNextItemAuthority.acquiredFrom, undefined);
  const stack = f.act({ kind: "acquire", entryRef: CONTENTS, quantity: 1 });
  assert.equal(f.act({ kind: "acquire", entryRef: parked, quantity: 1 }), stack, "the second piece joins the first");
  assert.deepEqual(own(PLAYER, stack), [["container", FIRST, 1], ["container", SECOND, 1]]);
  assert.deepEqual(authorityItemComposite(f.state, stack).acquiredFrom.map(part => [part.observerRef, part.from, part.ref]),
    [[PLAYER, "container", FIRST], [PLAYER, "container", SECOND]]);
  assert.equal(authorityItemComposite(f.state, CONTENTS).acquiredFrom, undefined, "the stack left inside carries no record");
  f.act({ kind: "store", entryRef: stack, quantity: 1, containerRef: SECOND });
  assert.deepEqual(own(PLAYER, stack), [["container", FIRST, 1]], "the piece put back into the second container was the one from it");
  f.act({ kind: "release", entryRef: stack, quantity: 1, sceneRef: SCENE, releaseKind: "drop" });
  assert.equal(f.state.vNextItemAuthority.acquiredFrom, undefined, "dropped, it is no longer in hand");
  const picked = f.act({ kind: "acquire", entryRef: stack, quantity: 1 });
  assert.deepEqual(own(PLAYER, picked), [["ground", SCENE, 1]]);
  const given = f.act({ kind: "transfer", entryRef: picked, quantity: 1, targetCharacterRef: RECIPIENT, ownershipDisposition: "transferToRecipient" });
  assert.equal(own(PLAYER, picked), undefined);
  assert.deepEqual(own(RECIPIENT, given), [["character", PLAYER, 1]], "the recipient remembers who gave it");
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
    const denied = step(f.profiles, f.state, f.input(operation));
    assert.equal(denied.kind, "rejected");
    // SPEC 0001 §16: preserve the real inventory row; diagnose the opener,
    // not a missing instance, without refreshing the last inspection.
    assert.equal(denied.rejection.diagnostics[0].constraint, "inventory:open-container-before-accessing-known-entry");
    assert.deepEqual(denied.rejection.diagnostics[0].expected.precedingContainerOperation,
      { proposalKind: "worldInteraction", commonAction: { kind: "operateObject", option: "open" } });
  }
  const unseen = step(f.profiles, f.state, f.input({ kind: "acquire", entryRef: CONTENTS, quantity: 1 }, RECIPIENT));
  assert.equal(unseen.kind, "rejected");
  assert.ok(!(unseen.rejection.diagnostics ?? []).some(diagnostic => diagnostic.constraint === "inventory:open-container-before-accessing-known-entry"),
    "an actor without the inspection receives no container/content identity hint");
  const undisclosed = structuredClone(f.state);
  delete undisclosed.vNextItemAuthority.containerMemories[PLAYER][FIRST];
  const unknown = step(f.profiles, undisclosed, inventoryInput(undisclosed, "root:container:uninspected",
    { kind: "acquire", entryRef: CONTENTS, quantity: 1 }));
  assert.equal(unknown.kind, "rejected");
  assert.equal(unknown.rejection.diagnostics[0].constraint, "inventory:entry-ref-must-resolve-to-item-entry");
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

// SPEC 0016 §7.2: storing into a shut container the actor sees is refused at
// the container. A live revision was told the right piece did not resolve
// and put the wrong one back.
test("storing into a closed container names the container to open, not the item", () => {
  const f = fixture("closed");
  const denied = step(f.profiles, f.state, f.input({ kind: "store", entryRef: CONTENTS, quantity: 1, containerRef: FIRST }));
  assert.equal(denied.kind, "rejected");
  assert.deepEqual(denied.rejection.diagnostics.map(diagnostic => [diagnostic.constraint, diagnostic.path]),
    [["inventory:open-container-before-storing", "/plan/operation/containerRef"]]);
  const open = fixture("open");
  open.act({ kind: "store", entryRef: CONTENTS, quantity: 1, containerRef: FIRST });
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

// SPEC 0016 §4.3 (ADR 0132): a carried item nothing names is listed by
// name, count and place, not read; naming it reads it at the listed
// version. A changed or altered record is refused, a stage that did not
// name it does not see it, and what a closed bag holds is not listed.
test("carried items nothing names are listed, read at their version when named, and not listed from a closed bag", () => {
  const ROPE = "item-entry:recall:rope", BAG = "item-entry:recall:bag", LETTER = "item-entry:recall:letter";
  const definition = (id, label, extra = {}) => { const value = healingPotionItemDefinition(); value.definitionId = id;
    Object.assign(value.content, { label, description: `一件${label}。`, category: "object", use: null, ...extra }); return value; };
  const rope = definition("item-definition:recall:rope", "麻绳"), bag = definition("item-definition:recall:bag", "皮袋", { stackable: false });
  const letter = definition("item-definition:recall:letter", "信件");
  const held = (entryId, definitionRef, extra = {}) => ({ definitionRef, entry: { entryId, quantity: 1, ...extra,
    placement: { kind: "held", holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: "character", ownerRef: PROBE_ACTOR } } });
  const f = createAuthoredProbeFixture("possession-recall", { itemDefinitions: [rope, bag, letter],
    itemEntries: [held(ROPE, rope.definitionId), held(BAG, bag.definitionId, { initialState: "closed" }), held(LETTER, letter.definitionId)] });
  const state = structuredClone(f.state);
  state.campaignRuntime.itemSystem.entries[LETTER].containerRef = BAG;
  const context = freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR], intentText: "把刚才那个收好。" }).context;
  const rows = context.references.possessionRecall;
  assert.deepEqual(rows.map(row => row.entryRef), [BAG, ROPE]);
  const ropeRow = rows.find(row => row.entryRef === ROPE);
  assert.deepEqual([ropeRow.label, ropeRow.quantity, ropeRow.equippedSlot, ropeRow.containerRef], ["麻绳", 1, null, null]);
  assert.deepEqual(ropeRow.records.map(record => record.entryRef), [ROPE, rope.definitionId]);
  assert.ok(!proposalInventoryEntryRefs(context).includes(ROPE));
  const sent = JSON.stringify(proposalModelContext(context));
  assert.deepEqual(proposalModelContext(context).references.possessionRecall.requestable.map(row => [row.ref, row.label]), [[BAG, "皮袋"], [ROPE, "麻绳"]]);
  assert.ok(!sent.includes("valueHash"), "versions stay on the server");
  assert.equal(proposalKnowledgeRecallPending(context, [ROPE]), true);
  const recalled = recallKnowledge(context, [ROPE], state);
  assert.deepEqual(recalled.map(record => record.entryRef), [ROPE, rope.definitionId].sort());
  const read = withRecalledKnowledge(context, recalled);
  assert.equal(proposalKnowledgeRecallPending(read, [ROPE]), false);
  assert.ok(proposalInventoryEntryRefs(proposalContextView(read, [], [ROPE])).includes(ROPE));
  assert.ok(!proposalContextView(read, [], []).entries.some(entry => entry.entryRef === ROPE), "a stage that did not name it does not see it");
  const changed = structuredClone(state);
  changed.campaignRuntime.itemSystem.entries[ROPE].condition = "broken";
  assert.throws(() => recallKnowledge(context, [ROPE], changed), /possession-recall:record-changed/);
  assert.throws(() => withRecalledKnowledge(context, recalled.map(record => record.entryRef === ROPE
    ? { ...record, value: { ...record.value, quantity: 9 } } : record)), /possession-recall:record-invalid/);
  // As with an NPC view (ADR 0096), naming an item the freeze already read is
  // read without it; a live put-back named the box it targeted and the act
  // ended. A ref neither listed nor loaded is still refused.
  const named = freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR, BAG], intentText: "把刚才那个收进皮袋。" }).context;
  assert.ok(proposalInventoryEntryRefs(named).includes(BAG));
  assert.deepEqual(named.references.possessionRecall.map(row => row.entryRef), [ROPE]);
  const offer = requestedItemRefs => ({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function",
    function: { name: OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, arguments: JSON.stringify({ requestedCapabilities: ["inventoryOperation"], requestedItemRefs }) } }] } }] });
  assert.deepEqual(parseVNextProposalOfferResponse(offer([BAG]), named).knowledgeRefs, []);
  assert.deepEqual(parseVNextProposalOfferResponse(offer([BAG, ROPE]), named).knowledgeRefs, [ROPE]);
  assert.throws(() => parseVNextProposalOfferResponse(offer(["item-entry:recall:nothing"]), named),
    error => error.diagnostics?.some(diagnostic => diagnostic.constraint === "offer:requested-item-ref-not-requestable"));
});

// SPEC 0001 §16 (ADR 0136): how a stack came to the actor's hands reaches the
// KP as the actor's own record -- on the directory row of a carried item
// nothing named, and on the record of one the closure froze -- and a record
// kept for someone who does not hold the piece does not. Two alike pieces,
// one just taken out, are no longer one row.
test("a carried piece taken out of a container shows the actor which container, on its row and its record", () => {
  const ROPE = "item-entry:taken:rope", SPARE = "item-entry:taken:spare", BAG = "item-entry:taken:bag", OTHER = "character:taken:other";
  const definition = (id, label, extra = {}) => { const value = healingPotionItemDefinition(); value.definitionId = id;
    Object.assign(value.content, { label, description: `一件${label}。`, category: "object", use: null, ...extra }); return value; };
  const rope = definition("item-definition:taken:rope", "麻绳", { stackable: false }), bag = definition("item-definition:taken:bag", "皮袋", { stackable: false });
  const held = (entryId, definitionRef, extra = {}) => ({ definitionRef, entry: { entryId, quantity: 1, ...extra,
    placement: { kind: "held", holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: "character", ownerRef: PROBE_ACTOR } } });
  const f = createAuthoredProbeFixture("taken-from", { itemDefinitions: [rope, bag],
    itemEntries: [held(ROPE, rope.definitionId), held(SPARE, rope.definitionId), held(BAG, bag.definitionId, { initialState: "closed" })] });
  const state = structuredClone(f.state);
  const part = { from: "container", ref: BAG, quantity: 1, eventSeq: "7" }, taken = { observerRef: PROBE_ACTOR, ...part };
  state.vNextItemAuthority = { schema: "zhuwei.vnext-item-authority/v1", uniqueItems: {}, identifications: {},
    acquiredFrom: { [PROBE_ACTOR]: { [ROPE]: [part] }, [OTHER]: { [SPARE]: [part] } } };
  const listed = freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR], intentText: "把刚拿出的那段放回去。" }).context;
  const rows = listed.references.possessionRecall;
  assert.deepEqual(rows.find(row => row.entryRef === ROPE).acquiredFrom, [part]);
  assert.equal(rows.find(row => row.entryRef === SPARE).acquiredFrom, undefined, "a record kept for one who does not hold it is not read");
  assert.equal(rows.find(row => row.entryRef === SPARE).count, undefined, "the piece taken out is not grouped with the other");
  assert.deepEqual(proposalModelContext(listed).references.possessionRecall.requestable.find(row => row.ref === ROPE).acquiredFrom, [part]);
  const read = recallKnowledge(listed, [ROPE, SPARE], state);
  assert.deepEqual(read.find(record => record.entryRef === ROPE).value.acquiredFrom, [taken]);
  assert.equal(read.find(record => record.entryRef === SPARE).value.acquiredFrom, undefined);
  const frozen = freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR, ROPE, SPARE], intentText: "把刚拿出的那段麻绳放回去。" }).context;
  const value = ref => frozen.entries.find(entry => entry.entryRef === ref).value;
  assert.deepEqual(value(ROPE).acquiredFrom, [taken]);
  assert.equal(value(SPARE).acquiredFrom, undefined);
});

// SPEC 0016 §4.3 (ADR 0137): what came to the actor's hands is listed
// together, newest first, from the records of frozen items and of directory
// rows alike, at most six; another holder's record and a context with none
// add nothing.
test("what recently came to the actor's hands is listed newest first beside the items", () => {
  const ROPE = "item-entry:recent:rope", SPARE = "item-entry:recent:spare", KEY = "item-entry:recent:key", CLOTH = "item-entry:recent:cloth";
  const BAG = "item-entry:recent:bag", OTHER = "character:recent:other", HALL = "scene:recent:hall";
  const definition = (id, label, extra = {}) => { const value = healingPotionItemDefinition(); value.definitionId = id;
    Object.assign(value.content, { label, description: `一件${label}。`, category: "object", use: null, ...extra }); return value; };
  const rope = definition("item-definition:recent:rope", "麻绳", { stackable: false }), key = definition("item-definition:recent:key", "钥匙", { stackable: false });
  const cloth = definition("item-definition:recent:cloth", "布条"), bag = definition("item-definition:recent:bag", "皮袋", { stackable: false });
  const held = (entryId, definitionRef, quantity = 1) => ({ definitionRef, entry: { entryId, quantity,
    placement: { kind: "held", holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: "character", ownerRef: PROBE_ACTOR } } });
  const f = createAuthoredProbeFixture("recently-in-hand", { itemDefinitions: [rope, key, cloth, bag],
    itemEntries: [held(ROPE, rope.definitionId), held(SPARE, rope.definitionId), held(KEY, key.definitionId), held(CLOTH, cloth.definitionId, 8),
      held(BAG, bag.definitionId)] });
  const state = structuredClone(f.state);
  assert.equal(proposalModelContext(freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR], intentText: "把麻绳收好。" }).context)
    .references.recentlyInHand, undefined, "nothing came to hand, nothing is listed");
  const part = (from, ref, eventSeq) => ({ from, ref, quantity: 1, eventSeq });
  state.vNextItemAuthority = { schema: "zhuwei.vnext-item-authority/v1", uniqueItems: {}, identifications: {}, acquiredFrom: {
    [PROBE_ACTOR]: { [ROPE]: [part("container", BAG, "17")], [SPARE]: [part("character", OTHER, "19")], [KEY]: [part("ground", HALL, "3")] },
    [OTHER]: { [KEY]: [part("container", BAG, "30")] } } };
  const context = freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR, SPARE], intentText: "把他刚给我的那捆麻绳收进皮袋。" }).context;
  assert.ok(context.entries.some(entry => entry.entryRef === SPARE), "one piece is frozen, the rest are directory rows");
  const recent = proposalModelContext(context).references.recentlyInHand;
  assert.deepEqual(recent.map(row => [row.ref, row.label, row.from, row.fromRef, row.quantity, row.eventSeq]), [
    [SPARE, "麻绳", "character", OTHER, 1, "19"], [ROPE, "麻绳", "container", BAG, 1, "17"], [KEY, "钥匙", "ground", HALL, 1, "3"]]);
  // A stack of eight pieces from eight takings: the newest six are listed.
  state.vNextItemAuthority.acquiredFrom[PROBE_ACTOR][CLOTH] = Array.from({ length: 8 }, (_, index) => part("container", BAG, String(20 + index)));
  const many = proposalModelContext(freezeAuthoredProbeContext(f, state, { focusRefs: [PROBE_ACTOR], intentText: "把布条放回皮袋。" }).context).references.recentlyInHand;
  assert.deepEqual(many.map(row => [row.ref, row.eventSeq]), [27, 26, 25, 24, 23, 22].map(seq => [CLOTH, String(seq)]));
});

// ADR 0132: the directory stays bounded by what differs, not by how much is
// carried. Ninety identical tubes are one row read through one instance;
// past the row limit the rest are counted, equipped and loose items first.
test("alike carried items share one row and a long directory lists its limit and counts the rest", () => {
  const f = createAuthoredProbeFixture("possession-groups");
  const freeze = state => freezeAdjudicationContext({ state, profiles: f.profiles, moduleProfile: f.moduleProfile, actorCharacterId: PROBE_ACTOR,
    kpProjection: { kind: "projected", viewer: { kind: "kp" }, stateVersion: state.version, activeBranchId: state.activeBranchId, projectionHash: canonicalHash(state), spatialEvidence: {} },
    replayHead: { eventSeq: state.version, stateHash: canonicalHash(state) }, preparedActionId: "prepared:possession-groups", rootActionId: "root:possession-groups",
    submissionRef: "submission:possession-groups", intentText: "把那个收起来。", focusRefs: [], maxUnits: 160_000 });
  const add = (state, definitionId, label, count, prefix) => {
    const definition = { ...healingPotionItemDefinition(), definitionId };
    definition.content = { ...definition.content, label, description: `一件${label}。`, stackable: false, use: null };
    state.campaignRuntime.itemSystem.definitions[definitionId] = definition;
    for (let i = 0; i < count; i++) {
      const entryId = `item-entry:${prefix}:${String(i).padStart(2, "0")}`;
      state.campaignRuntime.itemSystem.entries[entryId] = createInitialItemEntry(definition, { entryId, quantity: 1,
        placement: { kind: "held", holderRef: PROBE_ACTOR, equippedSlot: null }, ownership: { kind: "character", ownerRef: PROBE_ACTOR } });
    }
  };
  const tubes = structuredClone(f.state);
  add(tubes, "item-definition:group:tube", "标本管", 90, "group-tube");
  const one = freeze(tubes);
  assert.equal(one.kind, "ready", JSON.stringify(one.issues));
  assert.deepEqual(one.context.references.possessionRecall.map(row => [row.entryRef, row.label, row.count]), [["item-entry:group-tube:00", "标本管", 90]]);
  const many = structuredClone(f.state);
  for (let i = 0; i < 30; i++) add(many, `item-definition:group:${i}`, `杂物${i}`, 1, `group-${String(i).padStart(2, "0")}`);
  const capped = freeze(many);
  assert.equal(capped.kind, "ready", JSON.stringify(capped.issues));
  assert.equal(capped.context.references.possessionRecall.length, POSSESSION_RECALL_MAX_ROWS);
  assert.equal(capped.context.references.possessionRecallOmitted, 30 - POSSESSION_RECALL_MAX_ROWS);
  assert.equal(proposalModelContext(capped.context).references.possessionRecall.notListed, 30 - POSSESSION_RECALL_MAX_ROWS);
});
