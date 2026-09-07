import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "./fixtures/tactical-map-v2.mjs";

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.children?.map(text).join("") ?? "";
}

async function withTable(run, responseFor = () => ({ ok: true, action: "awaitingInput" })) {
  const originalFetch = globalThis.fetch;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const { command, data } = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(command, "sendAction");
    calls.push(data);
    return new Response(JSON.stringify(responseFor(calls.length)), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  let renderer;
  let queryClient;
  try {
    const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
      import("@tanstack/react-query"), import("../app/_runtime/lib/dnd/compute.ts"),
      import("../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
    ]);
    const snap = playTableSnapFixture(compileSheet);
    snap.state.authoritative.inCombat = false;
    snap.state.authoritative.tacticalProjection = null;
    queryClient = new QueryClient();
    const update = async (pending) => {
      const value = structuredClone(snap);
      value.state.pendingInputs = pending === undefined ? [] : [pending];
      const tree = createElement(QueryClientProvider, { client: queryClient }, createElement(PlayTable, { code: "CHOICES", snap: value }));
      await act(async () => { if (renderer) renderer.update(tree); else renderer = create(tree); });
    };
    const choose = async (label) => {
      const button = renderer.root.findAllByType("button").find((entry) => text(entry) === label);
      assert.ok(button, `The authoritative option ${label} must be available.`);
      await act(async () => { button.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    };
    await run({ calls, update, choose, act, renderer: () => renderer });
  } finally {
    if (renderer) { const { act } = await import("react-test-renderer"); await act(async () => renderer.unmount()); }
    queryClient?.clear();
    globalThis.fetch = originalFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
}

function pending(choiceKind, id, answerOptions) {
  return { kind: "combatChoice", choiceKind, pendingInputId: `pending:opaque:${id}`, rootActionId: "root:choice",
    question: "请选择这次行动的处理方式。", candidateAbilityRefs: ["ability:custom:reaction"], answerOptions };
}

test("spell reactions submit the exact server-frozen slot level without adding a target or assuming a spell ID", async () => {
  await withTable(async ({ calls, update, choose, renderer }) => {
    for (const [index, name, slotLevel] of [[0, "护盾术", "1"], [1, "反制法术", "5"]]) {
      const answer = { kind: "useReaction", abilityRef: `ability:authored:reaction-${index}`, slotLevel };
      const label = `${name}（${slotLevel}环法术位）`;
      await update(pending("reaction", String(index), [
        { label, answer }, { label: "不使用反应", answer: { kind: "decline" } },
      ]));
      assert.equal(renderer().root.findAllByType("button").some((button) => text(button) === `${name}（2环法术位）`), false);
      await choose(label);
      assert.deepEqual(calls[index].answer, answer);
      assert.equal(calls[index].pendingInputId, `pending:opaque:${index}`);
      assert.equal(calls[index].answer.targetEntityId, undefined);
    }
  });
});

test("both knock-out outcomes are real buttons and send only their frozen decision", async () => {
  await withTable(async ({ calls, update, choose }) => {
    const options = [
      { label: "非致命击昏", answer: { kind: "knockOut" } },
      { label: "按原伤害结算", answer: { kind: "dealLethalDamage" } },
    ];
    for (const [index, option] of options.entries()) {
      await update(pending("knockOut", String(index), options));
      await choose(option.label);
      assert.deepEqual(calls[index].answer, option.answer);
      assert.equal(calls[index].pendingInputId, `pending:opaque:${index}`);
    }
  });
});

test("an ordinary reaction preserves its target and retries the same payload after options change", async () => {
  await withTable(async ({ calls, update, choose, renderer, act }) => {
    const answer = { kind: "useReaction", abilityRef: "action:opportunity-attack", targetEntityId: "npc:warden" };
    await update(pending("reaction", "original", [{ label: "执行借机攻击", answer }]));
    await choose("执行借机攻击");
    assert.deepEqual(calls[0].answer, answer);
    const original = structuredClone(calls[0]);
    await update(undefined);
    await act(async () => {
      renderer().root.findByProps({ "data-action-recovery-submit": true }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(calls[1], original);
  }, (count) => count === 1
    ? { ok: false, committed: true, retryable: true, error: "行动已收到，正在恢复响应。" }
    : { ok: true, action: "committed" });
});
