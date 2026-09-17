// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { healingPotionItemDefinition } from "../../../app/_runtime/lib/rules/v2/items.ts";
import { stepInventoryOperation } from "../../../app/_runtime/lib/rules/v2/inventory-operations.ts";
import { step, PLAYER, RECIPIENT, initialize, inventoryInput, materialize, assertReplay, withCombatFixture, authoredUseItem, resolveItemDice } from '../../support/fixtures/inventory-operations.mjs';


test("use executes the exact-entry healing Ability and consumes once after real dice", () => {
  const scenario = initialize();
  const initial = materialize(scenario, healingPotionItemDefinition());
  const entryRef = Object.keys(initial.state.campaignRuntime.itemSystem.entries)[0];
  const input = inventoryInput(initial.state, "root:inventory:use", { kind: "use", entryRef, targetRefs: [PLAYER] });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, input);
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.deepEqual(waiting.randomnessRequests[0].dice, [{ count: "2", sides: "4" }]);
  assert.equal(waiting.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 1);
  const resolved = step(scenario.profiles, waiting.state, {
    kind: "authoritativeRandomness", resolutionId: waiting.resolutionId, responseId: `authority-response:${waiting.resolutionId}`,
    continuationCapability: waiting.continuationCapability,
    randomnessResults: waiting.randomnessRequests.map((request) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(({ count, sides }) => ({ sides: Number(sides), faces: Array.from({ length: Number(count) }, () => 2) })) })),
  });
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.equal(resolved.state.entities[PLAYER].hitPoints.current, 18);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[entryRef].quantity, 0);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[entryRef].disposition, "consumed");
  assert.equal(stepInventoryOperation(scenario.profiles, resolved.state, input).rejection.code, "duplicateRootAction");
  assertReplay(scenario, [...initial.events, ...waiting.events, ...resolved.events], resolved.state);
});


test("authored area item delegates geometry and two independent saves while spending its item only once", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = authoredUseItem(scenario, "area", {
    target: { kind: "area", rangeInches: "900", shape: { kind: "sphere", radiusInches: "720", propagation: "straight" } },
    save: { ability: "dex", dc: "10", halfOnSuccess: true }, damage: [{ type: "force", formula: "1d4" }],
  });
  const operation = { kind: "use", entryRef: initial.entryRef, targetRefs: [],
    area: { origin: { x: "120", y: "180", elevation: "0" } } };
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:area-use", operation));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("save:")).length, 2);
  assert.equal(waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("damage:")).length, 1);
  const resolved = resolveItemDice(scenario, waiting);
  assert.equal(resolved.kind, "committed", JSON.stringify(resolved));
  assert.deepEqual(resolved.mechanicalResult.area.affectedEntityIds.sort(), [PLAYER, RECIPIENT].sort());
  assert.equal(resolved.state.entities[PLAYER].hitPoints.current, 9);
  assert.equal(resolved.state.entities[RECIPIENT].hitPoints.current, 5);
  assert.equal(resolved.events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.equal(resolved.state.campaignRuntime.itemSystem.entries[initial.entryRef].quantity, 0);
  assertReplay(scenario, [...initial.events, ...waiting.events, ...resolved.events], resolved.state);
  const forbidden = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:forged-area-targets", { ...operation, targetRefs: [PLAYER] }));
  assert.equal(forbidden.kind, "rejected");
  const remote = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:remote-area", {
    ...operation, area: { origin: { x: "9000", y: "180", elevation: "0" } } }));
  assert.equal(remote.kind, "rejected"); assert.deepEqual(remote.events, []);
});


test("effect-only Item applies and ends grants in frozen order for multiple creatures", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = authoredUseItem(scenario, "ordered-effects", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    effects: [
      { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
      { kind: "endEffect", condition: "blinded", sourceRef: null },
      { kind: "grantEffect", condition: "poisoned", duration: { kind: "timed", durationMicros: "60000000" } },
    ],
  });
  const used = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:ordered-effects", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.events.filter((event) => event.eventType === "EffectApplied").length, 4);
  assert.equal(used.events.filter((event) => event.eventType === "EffectEnded").length, 2);
  assert.deepEqual(Object.values(used.state.combatRuntime.effects).map((effect) => effect.condition), ["poisoned", "poisoned"]);
  assert.equal(used.state.campaignRuntime.itemSystem.entries[initial.entryRef].quantity, 0);
  assert.equal(used.events.filter((event) => event.eventType === "ActivityStarted").length, 1);
  assertReplay(scenario, [...initial.events, ...used.events], used.state);
});


test("healing Item retains its additional frozen condition effects", () => {
  const scenario = initialize();
  const initial = authoredUseItem(scenario, "recovery-effect", {
    target: { kind: "creature", count: "1", rangeInches: "900" },
    healing: { formula: "1d4" },
    effect: { kind: "grantEffect", condition: "invisible", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:recovery-effect", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const used = resolveItemDice(scenario, waiting, 2);
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.state.entities[PLAYER].hitPoints.current, 14);
  assert.ok(Object.values(used.state.combatRuntime.effects).some((effect) => effect.condition === "invisible"));
  assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
});


test("multiple attacks freeze critical reserve before hit results and apply only each target's dice", () => {
  const scenario = initialize(undefined, { includeRecipient: true });
  const initial = authoredUseItem(scenario, "multi-attack", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    attack: { ability: "str", proficient: true },
    damage: [{ type: "force", formula: "1d4+1" }, { type: "fire", formula: "1d4" }],
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:multi-attack", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("attack:")).length, 2);
  for (const request of waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("damage:"))) {
    assert.deepEqual(request.dice, [{ count: "2", sides: "4" }, { count: "2", sides: "4" }]);
  }
  for (const attackRoll of [1, 15, 20]) {
    const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? attackRoll : 1);
    assert.equal(used.kind, "committed", JSON.stringify(used));
    assert.equal(used.state.entities[PLAYER].hitPoints.current, 12 - (attackRoll === 1 ? 0 : attackRoll === 20 ? 5 : 3));
    assert.equal(used.state.entities[RECIPIENT].hitPoints.current, 8 - (attackRoll === 1 ? 0 : attackRoll === 20 ? 5 : 3));
    assert.equal(used.state.campaignRuntime.itemSystem.entries[initial.entryRef].quantity, 0);
    assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
  }
});


test("automatic Dexterity save failure requests no die and only failed targets receive the effect", () => {
  const scenario = withCombatFixture(initialize(undefined, { includeRecipient: true }), (state) => {
    state.combatRuntime.entities[RECIPIENT].conditions = { paralyzed: true };
  });
  const initial = authoredUseItem(scenario, "condition-save", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    save: { ability: "dex", dc: "10", halfOnSuccess: false },
    damage: [{ type: "force", formula: "1d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:condition-save", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const saves = waiting.randomnessRequests.filter((request) => request.purposeKey.startsWith("save:"));
  assert.equal(saves.length, 1); assert.equal(saves[0].frozenParameters.targetEntityId, PLAYER);
  const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("save:") ? 20 : 2);
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.mechanicalResult.saves[RECIPIENT].automaticFailure, true);
  assert.equal(used.mechanicalResult.saves[RECIPIENT].roll, null);
  assert.equal(used.mechanicalResult.saves[RECIPIENT].total, null);
  assert.equal(used.state.entities[PLAYER].hitPoints.current, 12);
  assert.equal(used.state.entities[RECIPIENT].hitPoints.current, 6);
  assert.deepEqual(Object.values(used.state.combatRuntime.effects).map((effect) => effect.targetEntityId), [RECIPIENT]);
  assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
});


test("concentration reserves keep the initial batch fixed across miss, damage and critical DCs", () => {
  const scenario = withCombatFixture(initialize(undefined, { includeRecipient: true }), (state) => {
    state.combatRuntime.entities[RECIPIENT].concentration = { abilityRef: "spell:fixture-concentration" };
    state.combatRuntime.entities[RECIPIENT].hitPoints = { current: "60", maximum: "60", temporary: "0" };
    state.entities[RECIPIENT].hitPoints = { current: 60, maximum: 60 };
  });
  const initial = authoredUseItem(scenario, "concentration-reserve", {
    target: { kind: "creature", count: "1", rangeInches: "900" },
    attack: { ability: "str", proficiency: true },
    damage: [{ type: "force", formula: "4d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:concentration-reserve", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  assert.equal(waiting.randomnessRequests.filter((request) => request.frozenParameters.potentialDamage === true).length, 1);
  for (const attackRoll of [1, 15, 20]) {
    const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? attackRoll
      : request.purposeKey.startsWith("damage:") ? 4 : 11);
    assert.equal(used.kind, "committed", JSON.stringify(used));
    assert.equal(used.events.filter((event) => event.eventType === "RandomnessRequested").length, 0);
    const tested = used.events.find((event) => event.eventType === "ConcentrationTested");
    if (attackRoll === 1) assert.equal(tested, undefined);
    else {
      assert.equal(tested.payload.dc, attackRoll === 20 ? 16 : 10);
      assert.equal(tested.payload.succeeded, attackRoll !== 20);
      assert.ok(used.events.indexOf(tested) < used.events.findIndex((event) => event.eventType === "EffectApplied"));
    }
    assertReplay(scenario, [...initial.events, ...waiting.events, ...used.events], used.state);
  }
});


test("ordinary spell Ability retains critical reserves and applies its condition after damage", () => {
  const initialized = initialize(undefined, { includeRecipient: true });
  const abilityRef = "ability:inventory:ordinary-spell";
  const registered = step(initialized.profiles, initialized.state, { kind: "registerDynamicDefinition", proposalId: "root:inventory:ordinary-spell-definition", definition: {
    definitionId: abilityRef, definitionKind: "ability", revision: "1", rulesBasis: "srd5.1-2014",
    activation: { kind: "actionSpell", spellLevel: "0" },
    target: { kind: "creature", count: "1", rangeInches: "900" },
    attack: { kind: "spellAttack" },
    damage: [{ type: "force", formula: "1d4+1" }, { type: "fire", formula: "1d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  } });
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  const scenario = withCombatFixture(initialized, (state) => {
    state.combatRuntime.definitions[abilityRef] = registered.state.combatRuntime.definitions[abilityRef];
    state.campaignRuntime.definitions[abilityRef] = registered.state.campaignRuntime.definitions[abilityRef];
    state.combatRuntime.entities[PLAYER].abilityRefs.push(abilityRef);
    state.combatRuntime.entities[PLAYER].spellcasting = { ability: "int", spellAttackBonus: "3", spellSaveDc: "11" };
  });
  const waiting = step(scenario.profiles, scenario.state, { kind: "invokeAbility", rootActionId: "root:inventory:ordinary-spell",
    sourceEntityId: PLAYER, abilityRef, parameters: { targetEntityId: RECIPIENT } });
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  const used = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? 20 : 1);
  assert.equal(used.kind, "committed", JSON.stringify(used));
  assert.equal(used.state.entities[RECIPIENT].hitPoints.current, 3);
  assert.equal(used.events.filter((event) => event.eventType === "SpellResolved").length, 1);
  assert.ok(Object.values(used.state.combatRuntime.effects).some((effect) => effect.condition === "blinded"));
  assertReplay(scenario, [...waiting.events, ...used.events], used.state);
});


test("multiple Shield decisions reuse the original damage reserve without repeating Item costs", () => {
  const initialized = initialize(undefined, { includeRecipient: true });
  const abilityRef = "spell:shield";
  const otherTarget = "character:item-materialization-v5:second-mage";
  const registered = step(initialized.profiles, initialized.state, { kind: "registerDynamicDefinition", proposalId: "root:inventory:shield-definition", definition: {
    definitionId: abilityRef, definitionKind: "ability", revision: "1", rulesBasis: "srd5.1-2014",
    mechanicalKey: "shield", activation: { kind: "reactionSpell", spellLevel: "1" },
    costs: [{ kind: "spellSlot", level: "1", amount: "1" }],
    effect: { kind: "shield", duration: "untilOwnNextTurnStart", armorClassBonus: "5", magicMissileImmunity: true },
  } });
  assert.equal(registered.kind, "committed", JSON.stringify(registered));
  const scenario = withCombatFixture(initialized, (state) => {
    state.combatRuntime.definitions[abilityRef] = registered.state.combatRuntime.definitions[abilityRef];
    state.campaignRuntime.definitions[abilityRef] = registered.state.campaignRuntime.definitions[abilityRef];
    state.entities[otherTarget] = { ...structuredClone(state.entities[RECIPIENT]), id: otherTarget, name: "第二位法师" };
    state.combatRuntime.entities[otherTarget] = { ...structuredClone(state.combatRuntime.entities[RECIPIENT]), id: otherTarget, entityId: otherTarget, entityOrdinal: "3" };
    for (const target of [RECIPIENT, otherTarget]) {
      state.combatRuntime.entities[target].abilityRefs.push(abilityRef);
      state.combatRuntime.entities[target].resources["spellSlot:1"] = { current: "2", maximum: "2" };
      state.entities[target].resources["spellSlot:1"] = 2;
      state.entities[target].resourceMaximums["spellSlot:1"] = 2;
    }
  });
  const initial = authoredUseItem(scenario, "multi-shield", {
    target: { kind: "creature", count: "2", rangeInches: "900" },
    attack: { ability: "str", proficiency: true }, damage: [{ type: "force", formula: "1d4" }],
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:multi-shield", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [RECIPIENT, otherTarget],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  let result = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? 10 : 2);
  const events = [...initial.events, ...waiting.events, ...result.events];
  for (const target of [RECIPIENT, otherTarget]) {
    assert.equal(result.kind, "awaitingInput", JSON.stringify(result));
    assert.equal(result.pending.targetEntityId, target);
    result = step(scenario.profiles, result.state, { kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId,
      responseId: `response:inventory:shield:${target}`, answer: { kind: "useReaction", abilityRef: result.pending.candidateAbilityRefs[0], slotLevel: "1" } });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.entities[otherTarget].hitPoints.current, 8);
  assert.equal(result.state.entities[RECIPIENT].hitPoints.current, 8);
  assert.equal(events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.equal(events.filter((event) => event.eventType === "RandomnessRequested").length, waiting.events.filter((event) => event.eventType === "RandomnessRequested").length);
  assertReplay(scenario, events, result.state);
});


test("every melee target reduced to zero gets its own knock-out choice before damage commits", () => {
  const scenario = withCombatFixture(initialize(undefined, { includeRecipient: true }), (state) => {
    for (const id of [PLAYER, RECIPIENT]) {
      state.entities[id].hitPoints = { current: 1, maximum: 20 };
      state.combatRuntime.entities[id].hitPoints = { current: "1", maximum: "20", temporary: "0" };
    }
  });
  const initial = authoredUseItem(scenario, "multi-knockout", {
    target: { kind: "creature", count: "2", reachInches: "900" },
    attack: { ability: "str", proficiency: true }, damage: [{ type: "force", formula: "1d4" }],
    effect: { kind: "grantEffect", condition: "blinded", duration: { kind: "untilEnded" } },
  });
  const waiting = stepInventoryOperation(scenario.profiles, initial.state, inventoryInput(initial.state, "root:inventory:multi-knockout", {
    kind: "use", entryRef: initial.entryRef, targetRefs: [PLAYER, RECIPIENT],
  }));
  assert.equal(waiting.kind, "awaitingRandomness", JSON.stringify(waiting));
  let result = resolveItemDice(scenario, waiting, (request) => request.purposeKey.startsWith("attack:") ? 15 : 2);
  const events = [...initial.events, ...waiting.events, ...result.events];
  assert.equal(result.kind, "awaitingInput", JSON.stringify(result));
  assert.equal(result.state.entities[PLAYER].hitPoints.current, 1);
  assert.equal(result.state.entities[RECIPIENT].hitPoints.current, 1);
  for (const target of [PLAYER, RECIPIENT]) {
    assert.equal(result.kind, "awaitingInput", JSON.stringify(result));
    assert.equal(result.pending.targetEntityId, target);
    result = step(scenario.profiles, result.state, { kind: "answerPendingInput", pendingInputId: result.pending.pendingInputId,
      responseId: `response:inventory:knockout:${target}`, answer: { kind: "dealLethalDamage" } });
    events.push(...result.events);
  }
  assert.equal(result.kind, "committed", JSON.stringify(result));
  assert.equal(result.state.entities[PLAYER].hitPoints.current, 0);
  assert.equal(result.state.entities[RECIPIENT].hitPoints.current, 0);
  assert.equal(events.filter((event) => event.eventType === "ItemUsed").length, 1);
  assert.equal(events.filter((event) => event.eventType === "EffectApplied").length, 2);
  assertReplay(scenario, events, result.state);
});
