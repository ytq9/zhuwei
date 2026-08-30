import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "./fixtures/tactical-map-v2.mjs";

test("a current Delivery stays visible across polling without a manual confirmation control", async () => {
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
  const deliveryId = "delivery:opening:principal:alice";
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;
  snap.state.currentDeliveryId = deliveryId;
  snap.messages = [{
    id: deliveryId,
    user_id: null,
    kind: "open",
    name: "KP",
    body: "雨水沿黑橡木招牌滴落。你要怎么做？",
    created_at: "",
    clues: [],
  }];

  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    calls.push(payload);
    const body = payload.command === "acknowledgeDelivery"
      ? { ok: true, deliveryId }
      : { ok: false, error: "voice unavailable in component fixture" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    queueMicrotask(() => callback(performance.now()));
    return id;
  };
  globalThis.cancelAnimationFrame = () => {};

  const client = new QueryClient();
  const tree = (value) => createElement(
    QueryClientProvider,
    { client },
    createElement(PlayTable, { code: "TACTIC", snap: value }),
  );
  let renderer;
  try {
    await act(async () => {
      renderer = create(tree(snap));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.equal(
      calls.some((call) => call.command === "acknowledgeDelivery"),
      false,
      "rendering or attempting voice playback must not acknowledge the current Delivery",
    );
    const delivery = renderer.root.findByProps({ "data-delivery-id": deliveryId });
    assert.equal(
      delivery.findAll(
        (node) => node.type === "div"
          && node.children.includes("雨水沿黑橡木招牌滴落。你要怎么做？"),
      ).length,
      1,
    );
    const polled = structuredClone(snap);
    polled.state.authoritative.stateVersion = "18";
    await act(async () => {
      renderer.update(tree(polled));
      await Promise.resolve();
    });
    assert.equal(
      calls.some((call) => call.command === "acknowledgeDelivery"),
      false,
      "polling the same Delivery must not implicitly confirm it",
    );
    assert.equal(
      renderer.root.findAllByProps({ "data-delivery-id": deliveryId }).length,
      1,
    );

    assert.equal(
      renderer.root.findAllByProps({ "data-delivery-action": "acknowledge" }).length,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(renderer.toJSON()),
      /确认当前回应|确认后不可回看/,
    );
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    client.clear();
    globalThis.fetch = originalFetch;
    if (originalRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
    if (originalCancelAnimationFrame === undefined) {
      delete globalThis.cancelAnimationFrame;
    } else {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("a submitted local action renders before the Delivery it caused", async () => {
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
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;

  const originalFetch = globalThis.fetch;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const actionPayloads = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (payload.command === "sendAction") {
      actionPayloads.push(payload.data);
      if (actionPayloads.length === 1) {
        throw new Error("response lost after authoritative commit");
      }
    }
    const body = payload.command === "sendAction"
      ? { ok: true }
      : { ok: false, error: "voice unavailable in component fixture" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new QueryClient();
  const tree = (value) => createElement(
    QueryClientProvider,
    { client },
    createElement(PlayTable, { code: "TACTIC", snap: value }),
  );
  let renderer;
  try {
    await act(async () => {
      renderer = create(tree(snap));
    });
    const textarea = renderer.root.findByType("textarea");
    await act(async () => {
      textarea.props.onChange({ target: { value: "我检查门锁。" } });
    });
    const form = renderer.root.findByType("form");
    const sendButton = form.findAllByType("button").at(-1);
    assert.ok(sendButton, "send button is missing");
    await act(async () => {
      sendButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(actionPayloads.length, 1);
    assert.equal(renderer.root.findByType("textarea").props.value, "我检查门锁。");

    const replyId = "delivery:reply:principal:alice";
    const replied = structuredClone(snap);
    replied.state.currentDeliveryId = replyId;
    replied.messages = [{
      id: replyId,
      user_id: null,
      kind: "say",
      name: "KP",
      body: "门锁上留着刚刮出的黄铜屑。",
      created_at: "",
      clues: [],
    }];
    await act(async () => {
      renderer.update(tree(replied));
      await Promise.resolve();
    });
    const retryForm = renderer.root.findByType("form");
    const retryButton = retryForm.findAllByType("button").at(-1);
    assert.ok(retryButton, "retry button is missing");
    await act(async () => {
      retryButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(actionPayloads.length, 2);
    assert.equal(actionPayloads[0].submissionId, actionPayloads[1].submissionId);

    const messageOrder = renderer.root.findAll(
      (node) => node.type === "article" && typeof node.props["data-delivery-id"] === "string",
    ).map((node) => node.props["data-delivery-id"]);
    assert.equal(messageOrder.length, 2);
    assert.match(messageOrder[0], /^local-/);
    assert.equal(messageOrder[1], replyId);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    client.clear();
    globalThis.fetch = originalFetch;
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("a new local action stays after committed history when the failed Delivery did not advance", async () => {
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
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;
  const oldDeliveryId = "delivery:opening:principal:alice";
  const firstActionId = "action:receipt:first:character:alice";
  snap.state.currentDeliveryId = oldDeliveryId;
  snap.state.authoritative.narrationRecovery = {
    kind: "available",
    capability: "publish-capability:failed-delivery",
    state: "rejected",
  };
  snap.messages = [{
    id: oldDeliveryId,
    user_id: null,
    kind: "open",
    name: "KP",
    body: "你站在院子里。",
    created_at: "",
    clues: [],
  }, {
    id: firstActionId,
    user_id: snap.me.userId,
    kind: "say",
    name: "阿莱莎",
    body: "我先问候门边的人。",
    created_at: "",
    clues: [],
  }];

  const originalFetch = globalThis.fetch;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    const body = payload.command === "sendAction"
      ? {
          action: "committed",
          narration: "retryableFailure",
          retryable: true,
          error: "KP 回复尚未送达。",
        }
      : { ok: false, error: "voice unavailable in component fixture" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new QueryClient();
  const tree = createElement(
    QueryClientProvider,
    { client },
    createElement(PlayTable, { code: "TACTIC", snap }),
  );
  let renderer;
  try {
    await act(async () => {
      renderer = create(tree);
    });
    assert.equal(renderer.root.findAll(
      (node) => node.props["data-narration-recovery"] === "viewer",
    ).length, 1, "the unresolved previous delivery starts visible");
    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({
        target: { value: "我接着说明自己的来意。" },
      });
    });
    const sendButton = renderer.root.findByType("form").findAllByType("button").at(-1);
    assert.ok(sendButton, "send button is missing");
    await act(async () => {
      sendButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const messageOrder = renderer.root.findAll(
      (node) => node.type === "article" && typeof node.props["data-delivery-id"] === "string",
    ).map((node) => node.props["data-delivery-id"]);
    assert.equal(messageOrder.length, 3);
    assert.equal(messageOrder[0], oldDeliveryId);
    assert.equal(messageOrder[1], firstActionId);
    assert.match(messageOrder[2], /^local-/u);
    assert.equal(renderer.root.findAll(
      (node) => node.props["data-narration-recovery"] === "viewer",
    ).length, 0, "submitting a newer line clears the old delivery warning from view");
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    client.clear();
    globalThis.fetch = originalFetch;
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("a rejected action restores the draft and keeps a visible inline error", async () => {
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
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;

  const originalFetch = globalThis.fetch;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const publicError = "权威 KP 模型配置或输出无效。";
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    const body = payload.command === "sendAction"
      ? { ok: false, outcomeKind: "rejected", retryable: false, error: publicError }
      : { ok: false, error: "voice unavailable in component fixture" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new QueryClient();
  const tree = createElement(
    QueryClientProvider,
    { client },
    createElement(PlayTable, { code: "TACTIC", snap }),
  );
  let renderer;
  try {
    await act(async () => {
      renderer = create(tree);
    });
    const textarea = renderer.root.findByType("textarea");
    await act(async () => {
      textarea.props.onChange({ target: { value: "我站在原地环顾大厅。" } });
    });
    const sendButton = renderer.root.findByType("form").findAllByType("button").at(-1);
    assert.ok(sendButton, "send button is missing");
    await act(async () => {
      sendButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(renderer.root.findByType("textarea").props.value, "我站在原地环顾大厅。");
    const inlineError = renderer.root.findByProps({ "data-submission-error": true });
    assert.equal(inlineError.props.role, "alert");
    assert.match(JSON.stringify(inlineError.children), new RegExp(publicError));

    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({
        target: { value: "我换一种方式观察。" },
      });
    });
    assert.equal(
      renderer.root.findAllByProps({ "data-submission-error": true }).length,
      0,
      "editing the restored draft clears the stale error",
    );
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    client.clear();
    globalThis.fetch = originalFetch;
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
