import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative.ts";
import { AUTHORITATIVE_KP_PROFILES } from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { NPC_PENDING_DECISION_TOOL_NAME, npcPendingAnswerConforms } from "../app/_runtime/lib/kp/pending-decision-policy.ts";

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
