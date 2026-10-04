import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative.ts";
import { AUTHORITATIVE_KP_PROFILES } from "../../../app/_runtime/lib/kp/authoritative-policy.ts";
import { NPC_PENDING_DECISION_TOOL_NAME, npcPendingAnswerConforms, npcPendingDecisionModelInput } from "../../../app/_runtime/lib/kp/pending-decision-policy.ts";

test("NPC pending adapter gets only the finite NPC projection and restores server capability outside model output", async () => {
  const answer = { kind: "useReaction", abilityRef: "ability:dynamic-ward", slotLevel: "3" };
  const request = {
    preparedActionId: "prepared:npc", rootActionId: "root:npc", capability: "server:secret-capability",
    pending: { pendingInputId: "pending:npc", npcId: "npc:ward", choiceKind: "reaction",
      answerOptions: [{ label: "三环护盾", answer }, { label: "放弃", answer: { kind: "decline" } }] },
    projection: { viewer: { kind: "npc", subjectId: "npc:ward" }, knowledge: [{ content: "只知道门口有人" }] },
  };
  const calls = [];
  const adapter = createAuthoritativeKpAdapter({ profile: AUTHORITATIVE_KP_PROFILES[0], ai: {
    async run(_model, input) {
      calls.push(input);
      return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "choice:1", type: "function",
        function: { name: NPC_PENDING_DECISION_TOOL_NAME, arguments: JSON.stringify({ answer }) } }] }, finish_reason: "tool_calls" }] };
    },
  } });
  assert.deepEqual(await adapter.decidePendingInput(request), {
    kind: "npcPendingDecision", capability: request.capability, answer,
  });
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(calls).includes(request.capability));
  assert.ok(!JSON.stringify(calls).includes(request.rootActionId));
  await assert.rejects(adapter.decidePendingInput({ ...request,
    projection: { viewer: { kind: "player", subjectId: "npc:ward" } },
  }));
  assert.equal(calls.length, 1, "invalid viewer rejected before model");
});

test("target and trigger choices preserve complete structural choices without enumerating permutations", () => {
  const target = { choiceKind: "target", candidateEntityIds: ["a", "b", "c"], maximumTargetCount: "2" };
  assert.ok(npcPendingAnswerConforms(target, { kind: "selectTargets", targetEntityIds: ["c", "a"] }));
  assert.ok(!npcPendingAnswerConforms(target, { kind: "selectTargets", targetEntityIds: ["a", "a"] }));
  assert.ok(!npcPendingAnswerConforms(target, { kind: "selectTargets", targetEntityIds: ["secret"] }));
  const order = { choiceKind: "triggerOrder", orderedTriggerInstanceIds: ["one", "two", "three"] };
  assert.ok(npcPendingAnswerConforms(order, { orderedTriggerInstanceIds: ["three", "one", "two"] }));
  assert.ok(!npcPendingAnswerConforms(order, { orderedTriggerInstanceIds: ["one", "two"] }));
  assert.ok(!npcPendingAnswerConforms(order, { orderedTriggerInstanceIds: ["one", "one", "two"] }));
});

// SPEC 0012 §6.3 (ADR 0097 decision 4): with an enemy hidden from it, the NPC
// may name a point instead of a creature; only then is a point offered.
test("an NPC's target choice offers a point only when Rules allows aiming at one", () => {
  const aimed = { pendingInputId: "pending:aim", npcId: "npc:brute", choiceKind: "target", candidateEntityIds: ["pc:bob"],
    maximumTargetCount: 1, pointAimAllowed: true };
  assert.ok(npcPendingAnswerConforms(aimed, { kind: "selectPoint", point: { x: "0", y: "-60" } }));
  assert.ok(!npcPendingAnswerConforms(aimed, { kind: "selectPoint", point: { x: "0", y: "-60", elevation: "0" } }));
  assert.ok(!npcPendingAnswerConforms(aimed, { kind: "selectPoint", point: { x: 0, y: "-60" } }));
  assert.ok(!npcPendingAnswerConforms({ ...aimed, pointAimAllowed: undefined }, { kind: "selectPoint", point: { x: "0", y: "0" } }));
  const request = { preparedActionId: "prepared:aim", rootActionId: "root:aim", capability: "npc-decision:aim", pending: aimed,
    projection: { viewer: { kind: "npc", subjectId: "npc:brute" } } };
  const schema = JSON.stringify(npcPendingDecisionModelInput(request).tools[0].function.parameters);
  assert.match(schema, /"selectPoint"/);
  assert.doesNotMatch(JSON.stringify(npcPendingDecisionModelInput({ ...request,
    pending: { ...aimed, pointAimAllowed: undefined } }).tools[0].function.parameters), /selectPoint/);
});
