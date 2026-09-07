import assert from "node:assert/strict";
import test from "node:test";

import { authorityPendingBindings, authorityPendingBindingSeeds } from "../app/_runtime/lib/room/pending-bindings.ts";

const PLAYER = "character:pending:player";
const VISIBLE = "character:pending:visible";
const HIDDEN = "character:pending:hidden";
const REMOTE = "character:pending:remote";
const ROOT = "root:pending:one";
const SECRET = "private-candidate-dice-and-state";

function stateWithPending(pending) {
  return {
    pendingInputs: {},
    entities: { [PLAYER]: { id: PLAYER, sceneId: "scene:one" } },
    knowledge: { [PLAYER]: {} },
    combatRuntime: {
      effects: {}, definitions: {},
      entities: {
        [PLAYER]: { id: PLAYER, sceneId: "scene:one" },
        [VISIBLE]: { id: VISIBLE, sceneId: "scene:one", visibilityPolicyId: "visibility:scene-observers" },
        [HIDDEN]: { id: HIDDEN, sceneId: "scene:one", visibilityPolicyId: "visibility:hidden-until-evidence", visibilityFactId: "fact:hidden" },
        [REMOTE]: { id: REMOTE, sceneId: "scene:elsewhere" },
      },
      pendingInputs: { [pending.pendingInputId]: pending },
    },
    characterControls: { [PLAYER]: { characterId: PLAYER, seatId: "seat:player" } },
    seats: { "seat:player": { id: "seat:player", principalId: "principal:trusted", status: "active" } },
    principals: { "principal:trusted": { id: "principal:trusted" } },
  };
}

function pending(choiceKind, fields = {}) {
  return {
    pendingInputId: `pending:${choiceKind}`, rootActionId: ROOT, kind: "playerChoice", choiceKind,
    controllerEntityId: PLAYER,
    ownerFrame: { secret: SECRET }, continuation: { frozenDamageFaces: [20, 6], secret: SECRET },
    sourcePatch: { secret: SECRET }, mechanicalResult: { secret: SECRET },
    lethalDamagePayload: { secret: SECRET }, knockOutDamagePayload: { secret: SECRET },
    abilityOperation: { secret: SECRET }, frozenRecoveryFaces: { secret: SECRET },
    remainingKnockOuts: [{ secret: SECRET }], futurePrivateField: SECRET,
    controllerPrincipalId: "principal:forged", question: SECRET,
    ...fields,
  };
}

test("Room exposes only actionable Shield fields and derives identity from the trusted Seat", () => {
  const source = pending("reaction", {
    reactionKind: "shield", triggerKind: "attackHit", targetEntityId: PLAYER,
    candidateAbilityRefs: ["spell:shield"],
  });
  const state = stateWithPending(source);
  const [binding] = authorityPendingBindings(state);
  assert.deepEqual(binding.pending, {
    pendingInputId: "pending:reaction", rootActionId: ROOT, kind: "combatChoice",
    question: "是否施放护盾术？", choiceKind: "reaction", reactionKind: "shield", triggerKind: "attackHit",
    targetEntityId: PLAYER, candidateAbilityRefs: ["spell:shield"],
    answerOptions: [{ label: "放弃反应", answer: { kind: "decline" } }],
    controller: { kind: "character", characterId: PLAYER }, controllerCharacterId: PLAYER,
    controllerPrincipalId: "principal:trusted",
  });
  assert.equal(JSON.stringify(binding).includes(SECRET), false);
  assert.equal(JSON.stringify(binding).includes("frozenDamageFaces"), false);
  binding.pending.candidateAbilityRefs.push("spell:other");
  assert.deepEqual(source.candidateAbilityRefs, ["spell:shield"]);
  assert.equal(source.continuation.secret, SECRET);
});

test("Room keeps knock-out and counterspell choices while hiding resolution snapshots", () => {
  for (const source of [
    pending("knockOut", { targetEntityId: HIDDEN }),
    pending("reaction", { reactionKind: "counterspell", triggerKind: "spellCast", targetEntityId: HIDDEN,
      candidateAbilityRefs: ["spell:counterspell"] }),
  ]) {
    const [binding] = authorityPendingBindings(stateWithPending(source));
    assert.equal(binding.pending.choiceKind, source.choiceKind);
    assert.equal(binding.pending.targetEntityId, undefined);
    assert.equal(binding.pending.question, source.choiceKind === "knockOut"
      ? "是否将这次近战攻击改为非致命击昏？" : "是否施放反制法术？");
    assert.equal(JSON.stringify(binding.pending).includes(SECRET), false);
    assert.equal(JSON.stringify(binding.pending).includes(HIDDEN), false);
  }
});

test("target and initiative choices share the Rules spatial visibility policy", () => {
  const source = pending("target", { candidateEntityIds: [PLAYER, VISIBLE, HIDDEN, REMOTE, "entity:tentative"],
    maximumTargetCount: 2, orderedEntityIds: [HIDDEN, VISIBLE, REMOTE],
    orderedTriggerInstanceIds: ["trigger:own:2", "trigger:own:1"], triggerBatchId: "batch:own", triggerBatchHash: "sha256:batch" });
  const state = stateWithPending(source);
  const [before] = authorityPendingBindings(state);
  assert.deepEqual(before.pending.candidateEntityIds, [PLAYER, VISIBLE]);
  assert.deepEqual(before.pending.orderedEntityIds, [VISIBLE]);
  assert.equal(before.pending.maximumTargetCount, 2);
  assert.deepEqual(before.pending.orderedTriggerInstanceIds, ["trigger:own:2", "trigger:own:1"]);
  state.knowledge[PLAYER]["fact:hidden"] = { knowledgeRef: "fact:hidden" };
  const [after] = authorityPendingBindings(state);
  assert.deepEqual(after.pending.candidateEntityIds, [PLAYER, VISIBLE, HIDDEN]);
});

test("restore seeds use the same safe shape and inactive or NPC controllers cannot gain player bindings", () => {
  const state = stateWithPending(pending("reaction", { reactionKind: "shield", candidateAbilityRefs: ["spell:shield"] }));
  state.combatRuntime.pendingInputs["pending:npc"] = pending("reaction", { pendingInputId: "pending:npc", kind: "kpDecision" });
  assert.equal(authorityPendingBindingSeeds(state).length, 1);
  assert.equal(authorityPendingBindingSeeds(state, "root:other").length, 0);
  assert.equal(JSON.stringify(authorityPendingBindingSeeds(state)).includes(SECRET), false);
  state.seats["seat:player"].status = "disconnected";
  assert.deepEqual(authorityPendingBindings(state), []);
  assert.equal(authorityPendingBindingSeeds(state).length, 1);
});
