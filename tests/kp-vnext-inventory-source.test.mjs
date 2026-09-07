import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR as ACTOR,
  PROBE_TARGET as OTHER, PROBE_SCENE as SCENE, PROBE_SOURCE as SOURCE } from "../tools/lib/vnext-authored-probe-fixture.mjs";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { deriveAuthorityClaims, deriveAuthorityClaimsFromCommittedRange, frozenRenderableClaimsConform,
  projectRenderableClaims } from "../app/_runtime/lib/rules/v2/claims.ts";
import { itemBundle } from "./fixtures/vnext-authored-bundles.mjs";

function execute(f, bundle) {
  const rootActionId = `${f.rootActionId}:${++f.counter}`;
  const refs = Object.keys(f.state.campaignRuntime.itemSystem.entries);
  const requiredContext = freezeAuthoredProbeContext(f, f.state,
    { rootActionId, focusRefs: [ACTOR, OTHER, SOURCE, ...refs] }).context;
  const lower = lowerVNext2ProposalBundle({ value: bundle, rootActionId,
    actorCharacterId: ACTOR, requiredContext, state: f.state });
  assert.equal(lower.kind, "accepted", JSON.stringify(lower));
  const priorState = f.state;
  const result = f.runtime.step(f.profiles, priorState, lower.command.rulesInput);
  assert.equal(result.kind, "committed", JSON.stringify(result));
  f.state = result.state;
  f.events.push(...result.events);
  return { priorState, result };
}

function inventory(f, operation) {
  const bundle = itemBundle();
  bundle.proposals = [{ kind: "inventoryOperation", basisRefs: [SOURCE], consumes: [],
    produces: [], outcomeBinding: "always", operation, summary: "物品操作完成。" }];
  return execute(f, bundle);
}

function fixture(name, equipped) {
  const f = { ...createAuthoredProbeFixture(name), counter: 0, events: [] };
  const bundle = itemBundle();
  Object.assign(bundle.proposals[1].source.content, {
    label: "铜制工具", category: "tool", stackable: false,
    equipment: { allowedSlots: ["main"], twoHanded: false, armor: null, weapon: null },
  });
  bundle.proposals[2].quantity = 1;
  bundle.proposals[3].operation.quantity = 1;
  bundle.proposals.pop();
  f.created = execute(f, bundle);
  f.entryRef = Object.keys(f.state.campaignRuntime.itemSystem.entries)[0];
  if (equipped) inventory(f, { kind: "equip", entryRef: f.entryRef, action: "wear", slot: "main" });
  return f;
}

function project(f, action, viewer = f.viewer) {
  const { result, priorState } = action;
  const view = f.runtime.project(f.profiles, result.state, viewer, { channel: "realtime", committedRange: {
    receiptId: result.receipt.receiptId, actorCharacterId: ACTOR, priorState, events: result.events,
  } });
  assert.equal(view.kind, "projected", JSON.stringify(view));
  assert.ok(view.renderableClaims);
  assert.equal(frozenRenderableClaimsConform(view.renderableClaims), true);
  return view.renderableClaims;
}

const otherViewer = { kind: "player", principalId: "principal:probe-target", seatId: "seat:probe-target",
  sessionVersion: 1, characterId: OTHER };

test("committed inventory operations retain the exact equipped or unequipped source only for its authorized holder", () => {
  for (const equipped of [false, true]) for (const kind of ["release", "transfer"]) {
    const f = fixture(`inventory-source-${kind}-${equipped}`, equipped);
    const acquisition = project(f, f.created).claims.find(claim => claim.kind === "inventoryOutcome"
      && claim.operation?.kind === "acquire");
    assert.deepEqual(acquisition.sourceBefore, { disposition: "scene", sceneRef: SCENE },
      "a source created earlier in the same committed range uses its actual per-event before state");
    const action = inventory(f, kind === "release"
      ? { kind, entryRef: f.entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "placement" }
      : { kind, entryRef: f.entryRef, quantity: 1, targetCharacterRef: OTHER, ownershipDisposition: "transferToRecipient" });
    const own = project(f, action), other = project(f, action, otherViewer);
    const ownOperations = own.claims.filter(claim => claim.kind === "inventoryOutcome" && claim.operation?.kind === kind);
    const otherOperations = other.claims.filter(claim => claim.kind === "inventoryOutcome" && claim.operation?.kind === kind);
    assert.ok(ownOperations.length > 0);
    assert.ok(otherOperations.length > 0, "the ordinary item outcome must remain visible");
    for (const claim of ownOperations) {
      assert.deepEqual(claim.sourceBefore, { disposition: "held", holderRef: ACTOR, equippedSlot: equipped ? "main" : null });
      assert.equal(claim.narrationFacts.some(fact => /操作前|背包|主手/.test(fact)), false,
        "the optional source evidence must not force redundant narration facts");
    }
    assert.ok(otherOperations.every(claim => !Object.hasOwn(claim, "sourceBefore")),
      "seeing the moved item or its former holder does not disclose private source equipment");
    assert.equal(action.result.state.campaignRuntime.itemSystem.entries[f.entryRef].equippedSlot, null);
    const restored = f.runtime.replay(f.genesis, f.events);
    assert.equal(restored.kind, "replayed", JSON.stringify(restored));
    assert.deepEqual(restored.state, action.result.state);
    assert.deepEqual(project(f, { ...action, result: { ...action.result, state: restored.state } }), own);
  }
});

test("source evidence is bound to the exact pre-event entry hash and never guessed from the current item", () => {
  const f = fixture("inventory-source-hash", true);
  const action = inventory(f, { kind: "release", entryRef: f.entryRef, quantity: 1, sceneRef: SCENE, releaseKind: "placement" });
  const range = { receipt: action.result.receipt, actorCharacterId: ACTOR,
    priorState: action.priorState, state: action.result.state, events: action.result.events };
  const authority = deriveAuthorityClaimsFromCommittedRange(range);
  const material = authority.claims.find(claim => claim.kind === "inventoryOutcome");
  assert.equal(material.sourceBefore.equippedSlot, "main");
  const wrongPrior = structuredClone(range.priorState);
  wrongPrior.campaignRuntime.itemSystem.entries[f.entryRef].equippedSlot = null;
  assert.throws(() => deriveAuthorityClaimsFromCommittedRange({ ...range, priorState: wrongPrior }),
    /INVENTORY_CLAIM_SOURCE_MISMATCH/);

  const privateVariants = ["main", null].map(equippedSlot => {
    const materials = authority.claims.map(claim => claim.kind === "inventoryOutcome"
      ? { ...claim, sourceBefore: { ...claim.sourceBefore, equippedSlot } } : claim);
    return projectRenderableClaims(deriveAuthorityClaims({ receiptId: authority.receiptId,
      rootActionId: authority.rootActionId, materials }), {
      viewerKey: "viewer:other", refs: [ACTOR, OTHER, f.entryRef, "visibility:scene-observers",
        `visibility:character-controller:${OTHER}`],
    });
  });
  assert.ok(privateVariants[0].claims.some(claim => claim.kind === "inventoryOutcome"));
  assert.deepEqual(privateVariants[0], privateVariants[1],
    "hidden source equipment must not affect the public facts or Claims hash");
});
