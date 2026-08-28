import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "./fixtures/tactical-map-v2.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function installSessionStorage(storage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  };
}

function playableSnap(compileSheet) {
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;
  return snap;
}

test("a composer retry keeps its original id and pending input after the projection changes", async () => {
  const storage = memoryStorage();
  const restoreStorage = installSessionStorage(storage);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalFetch = globalThis.fetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    if (request.command !== "sendAction") {
      return new Response(JSON.stringify({ ok: false, error: "unexpected command" }));
    }
    calls.push(request.data);
    const response = calls.length === 1
      ? {
          ok: false,
          committed: true,
          retryable: true,
          outcomeKind: "committed",
          error: "行动已经提交，但 KP 回应尚未送达。请重试；不会重复执行行动。",
        }
      : { ok: true, outcome: { kind: "committed" } };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let renderer;
  let client;
  try {
    const [
      { QueryClient, QueryClientProvider },
      { compileSheet },
      { PlayTable },
      { act, create },
    ] = await Promise.all([
      import("@tanstack/react-query"),
      import("../app/_runtime/lib/dnd/compute.ts"),
      import("../app/_runtime/components/play-table.tsx"),
      import("react-test-renderer"),
    ]);
    const before = playableSnap(compileSheet);
    before.state.pendingInputs = [{
      pendingInputId: "pending:original-clarification",
      rootActionId: "root:clarification",
      question: "你具体怎么检查？",
      kind: "clarification",
    }];
    client = new QueryClient();
    const tree = (snap) => createElement(
      QueryClientProvider,
      { client },
      createElement(PlayTable, { code: "TACTIC", snap }),
    );
    await act(async () => {
      renderer = create(tree(before));
    });
    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({
        target: { value: "我俯身检查门缝。" },
      });
    });
    await act(async () => {
      renderer.root.findByType("form").findAllByType("button").at(-1).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pendingInputId, "pending:original-clarification");
    assert.equal(
      renderer.root.findAllByProps({ "data-action-recovery": "send-action" }).length,
      1,
    );

    const after = structuredClone(before);
    after.state.pendingInputs = [];
    await act(async () => {
      renderer.update(tree(after));
    });
    await act(async () => {
      renderer.root.findByProps({ "data-action-recovery-submit": true }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[1].submissionId, calls[0].submissionId);
    assert.equal(calls[1].pendingInputId, calls[0].pendingInputId);
    assert.equal(calls[1].text, calls[0].text);
    assert.equal(
      renderer.root.findAllByProps({ "data-action-recovery": "send-action" }).length,
      0,
    );
  } finally {
    if (renderer) {
      const { act } = await import("react-test-renderer");
      await act(async () => renderer.unmount());
    }
    client?.clear();
    globalThis.fetch = originalFetch;
    restoreStorage();
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("a typed pending answer survives remount and retries the complete original payload", async () => {
  const storage = memoryStorage();
  const restoreStorage = installSessionStorage(storage);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalFetch = globalThis.fetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    if (request.command !== "sendAction") {
      return new Response(JSON.stringify({ ok: false, error: "unexpected command" }));
    }
    calls.push(request.data);
    const response = calls.length === 1
      ? {
          ok: false,
          committed: true,
          retryable: true,
          outcomeKind: "committed",
          error: "行动已经提交，但 KP 回应尚未送达。请重试；不会重复执行行动。",
        }
      : { ok: true, outcome: { kind: "committed" } };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let renderer;
  let firstClient;
  let secondClient;
  try {
    const [
      { QueryClient, QueryClientProvider },
      { compileSheet },
      { PlayTable },
      { act, create },
    ] = await Promise.all([
      import("@tanstack/react-query"),
      import("../app/_runtime/lib/dnd/compute.ts"),
      import("../app/_runtime/components/play-table.tsx"),
      import("react-test-renderer"),
    ]);
    const before = playableSnap(compileSheet);
    before.state.pendingInputs = [{
      pendingInputId: "pending:original-choice",
      rootActionId: "root:choice",
      question: "你选哪一条路？",
      kind: "playerChoice",
      choices: [{ choiceId: "choice:left", label: "左侧石门", consequence: "接近钟楼" }],
    }];
    firstClient = new QueryClient();
    const tree = (client, snap) => createElement(
      QueryClientProvider,
      { client },
      createElement(PlayTable, { code: "TACTIC", snap }),
    );
    await act(async () => {
      renderer = create(tree(firstClient, before));
    });
    const choiceLabel = renderer.root.findAllByType("span").find((span) =>
      span.children.includes("左侧石门"));
    let choice = choiceLabel;
    while (choice && choice.type !== "button") choice = choice.parent;
    assert.ok(choice, "typed pending choice button is missing");
    await act(async () => {
      choice.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const originalPayload = structuredClone(calls[0]);
    assert.deepEqual(originalPayload.answer, { choiceId: "choice:left" });
    assert.equal(originalPayload.pendingInputId, "pending:original-choice");

    await act(async () => renderer.unmount());
    renderer = undefined;
    firstClient.clear();
    const after = structuredClone(before);
    after.state.pendingInputs = [];
    secondClient = new QueryClient();
    await act(async () => {
      renderer = create(tree(secondClient, after));
    });
    assert.equal(
      renderer.root.findAllByProps({ "data-action-recovery": "send-action" }).length,
      1,
      "recovery control must not depend on the original pending panel",
    );
    await act(async () => {
      renderer.root.findByProps({ "data-action-recovery-submit": true }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(calls[1], originalPayload);
    assert.equal(
      storage.getItem("zhuwei:v2-action-recovery:principal:alice:TACTIC"),
      null,
      "terminal success clears the durable browser recovery record",
    );
  } finally {
    if (renderer) {
      const { act } = await import("react-test-renderer");
      await act(async () => renderer.unmount());
    }
    firstClient?.clear();
    secondClient?.clear();
    globalThis.fetch = originalFetch;
    restoreStorage();
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("a transport exception retains the exact action until a terminal retry", async () => {
  const storage = memoryStorage();
  const restoreStorage = installSessionStorage(storage);
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalFetch = globalThis.fetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body ?? "{}"));
    calls.push(request.data);
    if (calls.length === 1) throw new TypeError("connection reset after commit");
    return new Response(JSON.stringify({ ok: true, outcome: { kind: "committed" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let renderer;
  let client;
  try {
    const [
      { QueryClient, QueryClientProvider },
      { compileSheet },
      { PlayTable },
      { act, create },
    ] = await Promise.all([
      import("@tanstack/react-query"),
      import("../app/_runtime/lib/dnd/compute.ts"),
      import("../app/_runtime/components/play-table.tsx"),
      import("react-test-renderer"),
    ]);
    client = new QueryClient();
    const snap = playableSnap(compileSheet);
    await act(async () => {
      renderer = create(createElement(
        QueryClientProvider,
        { client },
        createElement(PlayTable, { code: "TACTIC", snap }),
      ));
    });
    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({
        target: { value: "我检查壁炉后的暗门。" },
      });
    });
    await act(async () => {
      renderer.root.findByType("form").findAllByType("button").at(-1).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(storage.getItem("zhuwei:v2-action-recovery:principal:alice:TACTIC"));
    assert.equal(
      renderer.root.findAllByProps({ "data-action-recovery": "send-action" }).length,
      1,
    );
    await act(async () => {
      renderer.root.findByProps({ "data-action-recovery-submit": true }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(calls[1], calls[0]);
    assert.equal(storage.getItem("zhuwei:v2-action-recovery:principal:alice:TACTIC"), null);
  } finally {
    if (renderer) {
      const { act } = await import("react-test-renderer");
      await act(async () => renderer.unmount());
    }
    client?.clear();
    globalThis.fetch = originalFetch;
    restoreStorage();
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("stable transport cache wins over a freshly requested id until a terminal result", async () => {
  const { callWithStableSubmission } = await import(
    "../app/_runtime/lib/table/authoritative-client.ts"
  );
  const storage = memoryStorage();
  const ids = [];
  const invoke = (result) => async (payload) => {
    ids.push(payload.submissionId);
    return result;
  };
  const data = { code: "TACTIC", text: "我检查门缝。" };

  await callWithStableSubmission({
    command: "sendAction",
    data: { ...data, submissionId: "submission:first" },
    storage,
    invoke: invoke({ ok: false, retryable: true }),
  });
  await callWithStableSubmission({
    command: "sendAction",
    data: { ...data, submissionId: "submission:fresh-but-wrong" },
    storage,
    invoke: invoke({ ok: true }),
  });
  await callWithStableSubmission({
    command: "sendAction",
    data: { ...data, submissionId: "submission:after-terminal" },
    storage,
    invoke: invoke({ ok: true }),
  });

  assert.deepEqual(ids, [
    "submission:first",
    "submission:first",
    "submission:after-terminal",
  ]);
  const client = await readFile(
    new URL("../app/_runtime/lib/table/client.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    client,
    /export const sendAction[^]*callWithStableTableSubmission\("sendAction", data\)/,
  );
});
