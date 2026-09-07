import { actDuration, withActDuration } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext,
  PROBE_ACTOR as ACTOR, PROBE_TARGET as TARGET, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE,
} from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { parseSubmitKpProposalBundleArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { narrativeBindingRef, narrativeMaterializedRef } from "../app/_runtime/lib/rules/v2/narrative-commitments.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";

const DEFINITION = "prospective:narrative-item-definition", ENTRY = "prospective:narrative-item-entry";
const examples = [
  { label: "蓝色陶杯", description: "窗边有一只蓝色陶杯，杯沿留着一道浅色缺口。", category: "object", durabilityMaximum: null, equipment: null },
  { label: "铜制折尺", description: "工具台上放着一把铜制折尺，铰接处有细密的刻线。", category: "tool", durabilityMaximum: 7,
    equipment: { allowedSlots: ["main"], twoHanded: false, armor: null, weapon: null } },
];
const common = (kind, basisRefs = [SOURCE], consumes = [], produces = []) => ({
  kind, basisRefs, consumes, produces, outcomeBinding: "always",
});
function bundle(proposals) {
  return withActDuration({ schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [SOURCE],
    adjudication: { kind: "directSuccess", durationMicros: actDuration(proposals), risk: "依据已经表达的场景细节继续。", successOutcome: "物品进入可持续的世界状态。" },
    terminal: null, proposals });
}
function wire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(wire);
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, wire(entry)])) : value;
}
function fixture(name) { return { ...createAuthoredProbeFixture(name), events: [], ordinal: 0 }; }
function player(f, characterId = ACTOR) {
  const role = characterId === ACTOR ? "actor" : "target";
  const result = f.runtime.project(f.profiles, f.state, { kind: "player", principalId: `principal:probe-${role}`,
    seatId: `seat:probe-${role}`, sessionVersion: 1, characterId });
  assert.equal(result.kind, "projected", JSON.stringify(result));
  return result;
}
function lower(f, value, focusRefs = [], actorCharacterId = ACTOR) {
  const rootActionId = `${f.rootActionId}:case:${++f.ordinal}`;
  const frozen = freezeAuthoredProbeContext({ ...f, actorCharacterId }, f.state, { rootActionId, focusRefs: [SOURCE, ACTOR, TARGET, ...focusRefs],
    intentText: "继续处理已经看见并描述过的物品。" });
  const { schema: _schema, kind: _kind, ...argumentsValue } = value;
  const decoded = parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle(wire(argumentsValue)));
  return lowerVNext2ProposalBundle({ value: decoded, rootActionId, actorCharacterId,
    requiredContext: frozen.context, state: f.state });
}
function execute(f, value, focusRefs = [], actorCharacterId = ACTOR) {
  const lowered = lower(f, value, focusRefs, actorCharacterId);
  assert.equal(lowered.kind, "accepted", JSON.stringify(lowered));
  const result = f.runtime.step(f.profiles, f.state, lowered.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  f.state = result.state;
  f.events.push(...result.events);
  return result;
}
function replay(f) {
  const restored = f.runtime.replay(f.genesis, f.events);
  assert.equal(restored.kind, "replayed", JSON.stringify(restored));
  assert.deepEqual(restored.state, f.state);
  return restored.state;
}
function commit(f, example, audience = "sceneObservers") {
  const itemCount = Object.keys(f.state.campaignRuntime.itemSystem.entries).length;
  const result = execute(f, bundle([{ ...common("commitNarrativeDetail"), sceneRef: SCENE,
    label: example.label, description: example.description, audience }]));
  const event = result.events.find((event) => event.eventType === "NarrativeDetailCommitted");
  assert.ok(event);
  const commitmentRef = event.payload.commitmentRef;
  assert.equal(f.state.canonicalFacts[commitmentRef].kind, "narrativeCommitment");
  assert.equal(narrativeMaterializedRef(f.state, commitmentRef), undefined);
  assert.equal(Object.keys(f.state.campaignRuntime.itemSystem.entries).length, itemCount);
  return commitmentRef;
}
function materialize(example, commitmentRef, { sourceMode = "basis" } = {}) {
  const basis = sourceMode === "basis" ? [commitmentRef] : [SOURCE];
  const sources = sourceMode === "consumes" ? [{ kind: "existing", ref: commitmentRef }] : [];
  return bundle([
    { ...common("materializeDefinition", basis, sources, [{ handle: DEFINITION, kind: "itemDefinition", outcomeBinding: "always" }]),
      source: { kind: "item", content: { schema: "zhuwei.item-definition-content/v1", ...example,
        aliases: [], tags: [], stackable: false, equippedAbilityRefs: [], use: null, chargesMaximum: null } },
      visibilityPolicyRef: "visibility:narrative-audience", summary: "按原描述固化物品定义。" },
    { ...common("materializeItem", basis, [...sources, { kind: "prospective", handle: DEFINITION }],
      [{ handle: ENTRY, kind: "itemEntry", outcomeBinding: "always" }]), definitionRef: DEFINITION,
      sceneRef: SCENE, quantity: 1, ownership: { kind: "unowned", ownerRef: null },
      visibilityPolicyRef: "visibility:narrative-audience", summary: "原场景物品成为可操作的同一实例。" },
    { ...common("inventoryOperation", [SOURCE], [{ kind: "prospective", handle: ENTRY }]),
      operation: { kind: "acquire", entryRef: ENTRY, quantity: 1 }, summary: "拿起已固化的物品。" },
  ]);
}
function rejection(f, value, focusRefs, mutateInput) {
  const before = canonicalSha256(f.state);
  const lowered = lower(f, value, focusRefs);
  let result = lowered;
  if (lowered.kind === "accepted") {
    const input = structuredClone(lowered.command.rulesInput);
    mutateInput?.(input);
    result = f.runtime.step(f.profiles, f.state, input);
  }
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  if (result.events !== undefined) assert.deepEqual(result.events, []);
  assert.equal(canonicalSha256(f.state), before);
  return result;
}

test("narrative commitments become durable Items through one shared path, then acquire, transfer, project and replay", () => {
  for (const [index, example] of examples.entries()) {
    const f = fixture(`narrative-item-${index}`);
    const commitmentRef = commit(f, example);
    for (const character of [ACTOR, TARGET]) assert.ok(JSON.stringify(player(f, character)).includes(example.description));
    replay(f);
    const created = execute(f, materialize(example, commitmentRef, { sourceMode: index === 0 ? "basis" : "consumes" }), [commitmentRef]);
    const entryRef = narrativeMaterializedRef(f.state, commitmentRef);
    assert.ok(entryRef);
    assert.equal(created.events.filter((event) => event.eventType === "ItemMaterialized").length, 1);
    assert.equal(created.events.filter((event) => event.eventType === "NarrativeDetailMaterialized").length, 1);
    const entry = f.state.campaignRuntime.itemSystem.entries[entryRef];
    assert.equal(entry.holderRef, ACTOR);
    assert.equal(f.state.campaignRuntime.itemSystem.definitions[entry.definitionRef].content.description, example.description);
    assert.equal(entry.durability?.maximum ?? null, example.durabilityMaximum);
    assert.ok(player(f).controlledCharacter.inventory.entries.some((item) => item.entryId === entryRef && item.name === example.label));
    execute(f, bundle([{ ...common("inventoryOperation", [entryRef]), operation: { kind: "transfer", entryRef,
      quantity: 1, targetCharacterRef: TARGET, ownershipDisposition: "transferToRecipient" }, summary: "把原物交给同伴。" }]), [entryRef]);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[entryRef].holderRef, TARGET);
    assert.equal(narrativeMaterializedRef(f.state, commitmentRef), entryRef);
    assert.ok(player(f, TARGET).controlledCharacter.inventory.entries.some((item) => item.entryId === entryRef && item.name === example.label));
    assert.equal(player(f).controlledCharacter.inventory.entries.some((item) => item.entryId === entryRef), false);
    replay(f);
  }
});

test("materialization cannot change a committed label or description, and rejection leaves no partial definition or entry", () => {
  for (const field of ["label", "description"]) {
    const f = fixture(`narrative-item-conflict-${field}`);
    const example = examples[0], commitmentRef = commit(f, example);
    const value = materialize(example, commitmentRef);
    value.proposals[0].source.content[field] += "另添的特征";
    rejection(f, value, [commitmentRef]);
    assert.equal(narrativeMaterializedRef(f.state, commitmentRef), undefined);
    assert.deepEqual(f.state.campaignRuntime.itemSystem.entries, {});
    assert.deepEqual(f.state.campaignRuntime.itemSystem.definitions, {});
  }
});

test("a commitment cannot materialize a second Item under a fresh root or prospective identity", () => {
  const f = fixture("narrative-item-duplicate"), example = examples[0];
  const commitmentRef = commit(f, example);
  execute(f, materialize(example, commitmentRef), [commitmentRef]);
  const entryRef = narrativeMaterializedRef(f.state, commitmentRef);
  replay(f);
  rejection(f, materialize(example, commitmentRef), [commitmentRef, entryRef]);
  assert.equal(narrativeMaterializedRef(f.state, commitmentRef), entryRef);
  assert.equal(Object.keys(f.state.campaignRuntime.itemSystem.entries).length, 1);
});

test("Rules rejects a narrative source omitted from sourceRefs or its frozen readSet", () => {
  for (const missing of ["sourceRefs", "readSet"]) {
    const f = fixture(`narrative-item-unbound-${missing}`), example = examples[0];
    const commitmentRef = commit(f, example);
    const result = rejection(f, materialize(example, commitmentRef), [commitmentRef], (input) => {
      const item = input.steps.find((step) => step.rulesInput.kind === "materializeItem").rulesInput;
      if (missing === "sourceRefs") item.plan.sourceRefs = [];
      else item.plan.readSet = item.plan.readSet.filter((binding) => binding.ref !== commitmentRef);
    });
    assert.ok(result.rejection || result.issues);
    assert.equal(narrativeMaterializedRef(f.state, commitmentRef), undefined);
  }
});

test("an actor-only detail stays private through Item materialization and transfer without granting its description", () => {
  const f = fixture("narrative-item-private"), example = examples[1];
  const commitmentRef = commit(f, example, "actorOnly");
  assert.ok(JSON.stringify(player(f)).includes(example.description));
  assert.equal(JSON.stringify(player(f, TARGET)).includes(example.description), false);
  execute(f, materialize(example, commitmentRef), [commitmentRef]);
  const entryRef = narrativeMaterializedRef(f.state, commitmentRef);
  assert.equal(JSON.stringify(player(f, TARGET)).includes(example.description), false);
  execute(f, bundle([{ ...common("inventoryOperation", [entryRef]), operation: { kind: "transfer", entryRef,
    quantity: 1, targetCharacterRef: TARGET, ownershipDisposition: "transferToRecipient" }, summary: "把物品交给同伴。" }]), [entryRef]);
  assert.equal(JSON.stringify(player(f, TARGET)).includes(example.description), false);
  assert.ok(player(f, TARGET).controlledCharacter.inventory.entries.some((item) => item.entryId === entryRef && item.kind === "opaque"));
  replay(f);
});

test("private narrative audiences cannot be widened by either the Item definition or the placed entry", () => {
  for (const index of [0, 1]) {
    const f = fixture(`narrative-item-audience-${index}`), example = examples[0];
    const commitmentRef = commit(f, example, "actorOnly");
    const value = materialize(example, commitmentRef);
    value.proposals[index].visibilityPolicyRef = "visibility:public";
    rejection(f, value, [commitmentRef]);
    assert.equal(JSON.stringify(player(f, TARGET)).includes(example.description), false);
    assert.equal(narrativeMaterializedRef(f.state, commitmentRef), undefined);
  }
});

function inventory(f, operation, actorCharacterId = ACTOR) {
  return execute(f, bundle([{ ...common("inventoryOperation", [operation.entryRef]), operation,
    summary: "依照当前物品状态处理数量与持有关系。" }]), [operation.entryRef], actorCharacterId);
}
function direct(f, input) {
  const result = f.runtime.step(f.profiles, f.state, { ...input, proposalId: `${f.rootActionId}:direct:${++f.ordinal}` });
  assert.equal(result.kind, "committed", JSON.stringify(result));
  f.state = result.state; f.events.push(...result.events);
  return result;
}
function assertContinuity(f, commitmentRef, entryRef, originalDetail) {
  assert.equal(narrativeMaterializedRef(f.state, commitmentRef), entryRef);
  assert.deepEqual(f.state.canonicalFacts[commitmentRef], originalDetail);
  for (const actorCharacterId of [ACTOR, TARGET]) {
    const frozen = freezeAuthoredProbeContext({ ...f, actorCharacterId }, f.state, { focusRefs: [commitmentRef] });
    const known = (ref) => frozen.context.entries.find((entry) => entry.kind === "known" && entry.entryRef === ref);
    assert.deepEqual(known(commitmentRef).value, originalDetail);
    assert.deepEqual(known(narrativeBindingRef(commitmentRef)).value, f.state.canonicalFacts[narrativeBindingRef(commitmentRef)]);
    assert.deepEqual(known(entryRef).value, f.state.campaignRuntime.itemSystem.entries[entryRef]);
    assert.equal(frozen.context.intent.narrativeMaterializationRefs, undefined);
  }
  replay(f);
}
function assertBindingScope(result, bindingRef) {
  assert.ok(result.scopeProof.reads.includes(bindingRef));
  assert.ok(result.scopeProof.writes.includes(bindingRef));
}

test("narrative Item bindings follow only verified surviving stacks across partial and full transfer, release and acquisition", () => {
  for (const directConsumers of [false, true]) {
    const f = fixture(`narrative-item-merge-${directConsumers}`), example = examples[0];
    const commitmentRef = commit(f, example), bindingRef = narrativeBindingRef(commitmentRef);
    const originalDetail = structuredClone(f.state.canonicalFacts[commitmentRef]);
    const value = materialize(example, commitmentRef);
    value.proposals[0].source.content.stackable = true;
    value.proposals[1].quantity = 4; value.proposals[2].operation.quantity = 4;
    execute(f, value, [commitmentRef]);
    const origin = narrativeMaterializedRef(f.state, commitmentRef);
    assertContinuity(f, commitmentRef, origin, originalDetail);

    const partialTransfer = inventory(f, { kind: "transfer", entryRef: origin, quantity: 1,
      targetCharacterRef: TARGET, ownershipDisposition: "transferToRecipient" });
    const transferred = partialTransfer.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
    assert.notEqual(transferred, origin);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[origin].quantity, 3);
    assertContinuity(f, commitmentRef, origin, originalDetail);

    const fullTransfer = directConsumers
      ? direct(f, { kind: "transferItem", itemId: origin, fromCharacterId: ACTOR, toCharacterId: TARGET,
        quantity: 3, ownershipDisposition: "transferToRecipient", method: "交付剩余同类物品" })
      : inventory(f, { kind: "transfer", entryRef: origin, quantity: 3,
        targetCharacterRef: TARGET, ownershipDisposition: "transferToRecipient" });
    assertBindingScope(fullTransfer, bindingRef);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[origin], undefined);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[transferred].quantity, 4);
    assertContinuity(f, commitmentRef, transferred, originalDetail);
    assert.equal(f.state.canonicalFacts[bindingRef].value.originMaterializedRef, origin);
    rejection(f, materialize(example, commitmentRef), [commitmentRef]);

    const partialRelease = inventory(f, { kind: "release", entryRef: transferred, quantity: 1,
      sceneRef: SCENE, releaseKind: "placement" }, TARGET);
    const released = partialRelease.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
    assert.equal(f.state.campaignRuntime.itemSystem.entries[transferred].quantity, 3);
    assertContinuity(f, commitmentRef, transferred, originalDetail);
    const fullRelease = inventory(f, { kind: "release", entryRef: transferred, quantity: 3,
      sceneRef: SCENE, releaseKind: "drop" }, TARGET);
    assertBindingScope(fullRelease, bindingRef);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[transferred], undefined);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[released].quantity, 4);
    assertContinuity(f, commitmentRef, released, originalDetail);
    assert.equal(f.state.canonicalFacts[bindingRef].value.originMaterializedRef, origin);
    assert.equal(f.state.canonicalFacts[bindingRef].value.predecessorMaterializedRef, transferred);

    const partialAcquire = inventory(f, { kind: "acquire", entryRef: released, quantity: 1 }, TARGET);
    const acquired = partialAcquire.events.find((event) => event.eventType === "InventoryOperationApplied").payload.targetEntryId;
    assert.equal(f.state.campaignRuntime.itemSystem.entries[released].quantity, 3);
    assertContinuity(f, commitmentRef, released, originalDetail);
    const fullAcquire = directConsumers
      ? direct(f, { kind: "acquireItem", itemId: released, characterId: TARGET })
      : inventory(f, { kind: "acquire", entryRef: released, quantity: 3 }, TARGET);
    assertBindingScope(fullAcquire, bindingRef);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[released], undefined);
    assert.equal(f.state.campaignRuntime.itemSystem.entries[acquired].quantity, 4);
    assertContinuity(f, commitmentRef, acquired, originalDetail);
    assert.equal(f.state.canonicalFacts[bindingRef].value.originMaterializedRef, origin);
    assert.equal(f.state.canonicalFacts[bindingRef].value.predecessorMaterializedRef, released);
    const mergeEvent = fullAcquire.events.find((event) => ["ItemAcquired", "InventoryOperationApplied"].includes(event.eventType));
    assert.deepEqual(f.state.canonicalFacts[bindingRef].causalParentIds, [mergeEvent.eventId]);
    assert.equal(f.state.canonicalFacts[bindingRef].validFromEventSeq, mergeEvent.eventSeq);
    assert.equal(f.state.canonicalFacts[bindingRef].source, "observedEvent");
    const projected = player(f, TARGET).controlledCharacter.inventory.entries;
    assert.ok(projected.some((entry) => entry.entryId === acquired && entry.quantity === 4 && entry.name === example.label));
    rejection(f, materialize(example, commitmentRef), [commitmentRef]);
  }
});

test("generic inventory identification cannot treat an unmaterialized narrative commitment as mechanical knowledge", () => {
  const f = fixture("narrative-item-identification-authority");
  const item = materialize(examples[0], SOURCE);
  item.proposals[0].visibilityPolicyRef = "visibility:hidden-until-evidence";
  item.proposals[1].visibilityPolicyRef = "visibility:scene-observers";
  execute(f, item);
  const entryRef = Object.keys(f.state.campaignRuntime.itemSystem.entries)[0];
  const commitmentRef = commit(f, examples[1]);
  assert.equal(player(f).controlledCharacter.inventory.entries.find((entry) => entry.entryId === entryRef).kind, "opaque");
  const before = canonicalSha256(f.state);
  const refs = [ACTOR, SCENE, entryRef, commitmentRef];
  const input = { kind: "inventoryOperation", rootActionId: `${f.rootActionId}:identify`, actorCharacterId: ACTOR,
    plan: { schema: "zhuwei.inventory-operation-plan/vnext-1", contextHash: canonicalSha256(refs),
      readSet: refs.map((ref) => ({ ref, revisionOrHash: authorityRevisionOrHash(f.state, ref) })),
      basisRefs: [commitmentRef], summary: "未经实例化的场景叙述不能揭示物品机械信息。", operation: { kind: "identify", entryRef } } };
  assert.ok(input.plan.readSet.every((binding) => typeof binding.revisionOrHash === "string"));
  const result = f.runtime.step(f.profiles, f.state, input);
  assert.equal(result.kind, "rejected", JSON.stringify(result));
  assert.match(result.rejection.message, /Narrative commitments must be materialized/);
  assert.deepEqual(result.events, []);
  assert.equal(canonicalSha256(f.state), before);
  assert.equal(f.state.vNextItemAuthority?.identifications[ACTOR]?.[entryRef], undefined);
  assert.equal(player(f).controlledCharacter.inventory.entries.find((entry) => entry.entryId === entryRef).kind, "opaque");
  const accepted = f.runtime.step(f.profiles, f.state, { ...input, plan: { ...input.plan, basisRefs: [entryRef] } });
  assert.equal(accepted.kind, "committed", JSON.stringify(accepted));
  assert.ok(accepted.state.vNextItemAuthority.identifications[ACTOR][entryRef]);
});
