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
import { proposalContextView, proposalInventoryEntryRefs, proposalKnowledgeRecallPending, proposalModelContext,
  recallKnowledge, withRecalledKnowledge } from "../../../app/_runtime/lib/kp/vnext/proposal-context.ts";

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
