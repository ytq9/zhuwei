import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "../../support/fixtures/tactical-map-v2.mjs";

test("pending narration stays a quiet waiting state; only a confirmed failure shows recovery", async () => {
  const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
    import("@tanstack/react-query"), import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
  ]);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient();
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  snap.state.authoritative.tacticalProjection = null;
  snap.messages = [];
  let renderer;
  try {
    // SPEC 0015 §8.2: recovery is offered only where an unchanged attempt
    // can progress; a saved permanent rejection keeps its explanation only.
    for (const [state, failureCode, retryVisible, canRetry, action, cancelled] of [
      ["pending", undefined, false],
      ["retryableFailure", "NARRATION_PUBLICATION_FAILED", true],
      ["rejected", "NARRATION_GROUNDING_REJECTED", false],
      ["rejected", "NARRATION_PRESENTATION_REJECTED", false],
      ["rejected", "NARRATION_REVIEW_UNCERTAIN", false],
      ["rejected", "NARRATION_BODY_INVALID", false],
      ["retryableFailure", "NARRATION_CONTEXT_BUDGET_EXCEEDED", false],
      ["rejected", "NARRATION_PRESENTATION_REJECTED", true, true],
      ["rejected", "NARRATION_GROUNDING_REJECTED", true, true],
      ["rejected", "NARRATION_GROUNDING_REJECTED", false, false],
      ["retryableFailure", "NARRATION_PUBLICATION_FAILED", false, false],
      ["retryableFailure", "NARRATION_PUBLICATION_FAILED", true, true, "notCommitted"],
      ["rejected", "NARRATION_BODY_INVALID", false, false, "notCommitted"],
      ["rejected", undefined, false, false, "notCommitted", true],
      [undefined, undefined, false],
    ]) {
      snap.state.kpBusy = state === "pending";
      snap.state.authoritative.narrationRecovery = state === undefined ? undefined
        : { kind: "available", capability: "recovery:current", state, ...(action ? { action } : {}), ...(cancelled ? { cancelled } : {}),
          ...(failureCode === undefined ? {} : { failureCode }),
          ...(canRetry === undefined ? {} : { canRetry }) };
      const tree = createElement(QueryClientProvider, { client }, createElement(PlayTable, { code: "WAIT", snap: structuredClone(snap) }));
      await act(async () => { if (renderer) renderer.update(tree); else renderer = create(tree); });
      const panels = renderer.root.findAll(node => node.props["data-narration-recovery"] === "viewer");
      assert.equal(panels.length, state === "retryableFailure" || state === "rejected" ? 1 : 0,
        `${state}: an unfinished reply alone must never look like an error`);
      if (state === "pending") assert.equal(renderer.root.findByProps({ "data-table-conversation": true }).props["aria-busy"], true);
      assert.equal(renderer.root.findAll(node => node.type === "button" && node.props["data-narration-recovery-submit"]).length,
        retryVisible ? 1 : 0, `${failureCode}: an ineffective retry must not be offered`);
      if (panels.length) {
        const text = JSON.stringify(renderer.toJSON());
        if (action === "notCommitted") {
          assert.match(text, cancelled ? /本次行动已取消，没有生效/ : /本次行动还没有生效/);
          assert.doesNotMatch(text, /行动已经结算|结果已保留|联系维护者/);
          assert.match(text, retryVisible ? /回复就绪后才会结算资源/ : /重新描述行动/);
          continue;
        }
        assert.match(text, /行动已经结算/);
        if (!retryVisible) {
          assert.doesNotMatch(text, /重试 KP 回复|请点击|重试只恢复/);
          assert.match(text, /无法通过重试恢复|反复重试通常无法解决/);
        }
        assert.match(text, /联系维护者/);
        if (retryVisible) assert.match(text, /不会重新裁定、掷骰或消耗资源/);
      }
    }
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    client.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test("player dice require a click and committed NPC dice remain visible on the table", async () => {
  const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
    import("@tanstack/react-query"), import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
  ]);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT, previousFetch = globalThis.fetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")));
    return Response.json({ ok: true, action: "committed", narration: "notApplicable" });
  };
  const client = new QueryClient(), snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false; snap.state.authoritative.tacticalProjection = null;
  snap.state.pendingRolls = [{ id: "randomness:player", userId: snap.me.userId, name: "阿莱莎", authoritative: true,
    kind: "check", ability: "wis", skill: "perception", dc: 12, reason: "观察门闩", dice: "2d20kh1", advantage: true }];
  snap.messages = [{ id: "roll:npc", user_id: null, name: "莉安", kind: "roll", created_at: "", clues: [],
    body: "系统代骰 · 检定：d20 [12]，修正 +3，合计 15，成功" }];
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(PlayTable, { code: "DICE", snap }))); });
    assert.equal(calls.filter(call => call.command === "resolveRoll").length, 0);
    assert.match(JSON.stringify(renderer.toJSON()), /2d20kh1/);
    assert.match(JSON.stringify(renderer.toJSON()), /系统代骰.*合计 15，成功/);
    const button = renderer.root.findAll(node => node.type === "button" && node.children.some(child => typeof child === "string" && child.startsWith("掷 ")))[0];
    assert.ok(button, "the frozen player request must expose an explicit roll control");
    await act(async () => { await button.props.onClick(); });
    const rolls = calls.filter(call => call.command === "resolveRoll");
    assert.equal(rolls.length, 1);
    assert.equal(rolls[0].data.rollId, "randomness:player");
    assert.equal(rolls[0].data.code, "DICE");
    assert.equal("faces" in rolls[0].data, false, "the browser must never choose its own die result");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    client.clear(); globalThis.fetch = previousFetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test("a current Delivery stays visible across polling without a manual confirmation control", async () => {
  const [
    { QueryClient, QueryClientProvider },
    { compileSheet },
    { PlayTable },
    { act, create },
  ] = await Promise.all([
    import("@tanstack/react-query"),
    import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"),
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
    import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"),
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
      ? { action: "committed", narration: "published", outcome: { receipt: { receiptId: "receipt:reply" } } }
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
      receiptId: "receipt:reply",
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
    import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"),
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

// ZW-mucr2imt error type: reply assigned to the wrong action.
// SPEC 0010 §8.3: a delayed poll must not associate the previous reply with
// the next local action, even when that action was sent before the poll.
for (const secondBody of ["我转身查看走廊。", "我检查门锁。"])
test(`a delayed previous reply stays before the next in-flight action: ${secondBody}`, async () => {
  const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
    import("@tanstack/react-query"), import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
  ]);
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;
  snap.state.currentDeliveryId = "delivery:opening";
  snap.messages = [{ id: "delivery:opening", user_id: null, kind: "open", name: "KP", body: "你站在门前。", created_at: "" }];
  const previousFetch = globalThis.fetch, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const payloads = [];
  let releaseSecond;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (payload.command === "sendAction") {
      payloads.push(payload.data);
      if (payloads.length === 2) await new Promise(resolve => { releaseSecond = resolve; });
    }
    return Response.json({ action: "committed", narration: "published", outcome: { receipt: { receiptId: `receipt:${payloads.length}` } } });
  };
  const client = new QueryClient();
  const tree = value => createElement(QueryClientProvider, { client }, createElement(PlayTable, { code: "DELAY", snap: value }));
  let renderer;
  const send = async body => {
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: body } }); });
    await act(async () => {
      renderer.root.findByType("form").findAllByType("button").at(-1).props.onClick();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  };
  try {
    await act(async () => { renderer = create(tree(snap)); });
    await send("我检查门锁。");
    await send(secondBody);
    const polled = structuredClone(snap);
    polled.state.currentDeliveryId = "delivery:first";
    polled.state.kpBusy = true;
    polled.messages.push(
      { id: "action:first", user_id: snap.me.userId, kind: "say", name: "你", body: "我检查门锁。", created_at: "", receiptId: "receipt:1" },
      { id: "delivery:first", user_id: null, kind: "narrate", name: "KP", body: "门锁上留着黄铜屑。", created_at: "", receiptId: "receipt:1" },
    );
    await act(async () => { renderer.update(tree(polled)); });
    const ids = renderer.root.findAll(node => node.type === "article" && node.props["data-delivery-id"])
      .map(node => node.props["data-delivery-id"]);
    assert.deepEqual(ids, ["delivery:opening", "action:first", "delivery:first", `local-${payloads[1].submissionId}`]);
  } finally {
    await act(async () => { releaseSecond?.(); await new Promise(resolve => setTimeout(resolve, 0)); });
    if (renderer) await act(async () => renderer.unmount());
    client.clear();
    globalThis.fetch = previousFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});

// SPEC 0010 §8.3: dice pauses return no receipt; timed actions can return a
// child receipt. Their own transcript input still has the original submission.
for (const response of [
  { action: "awaitingInput", narration: "notApplicable", outcome: { kind: "awaitingPlayerRoll" } },
  { action: "committed", narration: "published", outcome: { receipt: { receiptId: "receipt:completion" } } },
]) test(`original submission reconciles the player line after ${response.action}`, async () => {
  const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
    import("@tanstack/react-query"), import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
  ]);
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;
  snap.messages = [];
  const previousFetch = globalThis.fetch, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let submitted;
  globalThis.fetch = async (_url, init) => {
    submitted = JSON.parse(String(init?.body ?? "{}")).data;
    return Response.json(response);
  };
  const client = new QueryClient();
  const tree = value => createElement(QueryClientProvider, { client }, createElement(PlayTable, { code: "ORIGIN", snap: value }));
  let renderer;
  try {
    await act(async () => { renderer = create(tree(snap)); });
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: "我检查门锁。" } }); });
    await act(async () => {
      renderer.root.findByType("form").findAllByType("button").at(-1).props.onClick();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const polled = structuredClone(snap);
    polled.state.currentDeliveryId = "reply:completed";
    polled.messages = [
      { id: "action:original", submissionId: submitted.submissionId, receiptId: "receipt:start", user_id: snap.me.userId,
        kind: "say", name: "你", body: submitted.text, created_at: "" },
      { id: "reply:completed", receiptId: "receipt:completion", user_id: null,
        kind: "narrate", name: "KP", body: "门锁已经打开。", created_at: "" },
    ];
    await act(async () => { renderer.update(tree(polled)); });
    assert.deepEqual(renderer.root.findAll(node => node.type === "article" && node.props["data-delivery-id"])
      .map(node => node.props["data-delivery-id"]), ["action:original", "reply:completed"]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    client.clear(); globalThis.fetch = previousFetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
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
    import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"),
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

// ZW-mucr2imt error type: an obsolete cancellation notice reappears on failure.
// SPEC 0011 §1: an older terminal cancellation cannot describe a newer
// request whose commit result is still unknown.
/** A click's fetch and its response handling take a varying number of event
 * loop turns when many test files run in parallel; one turn was not always
 * enough under gates:check. Wait turn by turn until the result shows, bounded. */
async function settleUntil(act, done, turns = 100) {
  for (let turn = 0; turn < turns && !done(); turn++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

test("a failed new submission does not revive an older cancellation notice", async () => {
  const [{ QueryClient, QueryClientProvider }, { compileSheet }, { PlayTable }, { act, create }] = await Promise.all([
    import("@tanstack/react-query"), import("../../../app/_runtime/lib/dnd/compute.ts"),
    import("../../../app/_runtime/components/play-table.tsx"), import("react-test-renderer"),
  ]);
  const snap = playTableSnapFixture(compileSheet);
  snap.state.authoritative.inCombat = false;
  delete snap.state.authoritative.tacticalProjection;
  snap.state.authoritative.narrationRecovery = { kind: "available", capability: "cancelled:previous",
    state: "rejected", action: "notCommitted", cancelled: true, canRetry: false };
  const previousFetch = globalThis.fetch, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { publicAuthoritativeOutcomeError } = await import("../../../app/_runtime/lib/table/authoritative.ts");
  const { failureCodeIsRetryable } = await import("../../../app/_runtime/lib/room/telemetry.ts");
  const failure = { kind: "retryableFailure", code: "authorityTransient" };
  globalThis.fetch = async () => Response.json({ action: "notCommitted", narration: "notApplicable",
    code: failure.code, retryable: failureCodeIsRetryable(failure.code), error: publicAuthoritativeOutcomeError(failure) });
  const client = new QueryClient();
  const tree = value => createElement(QueryClientProvider, { client }, createElement(PlayTable, { code: "NOTICE", snap: value }));
  let renderer;
  try {
    await act(async () => { renderer = create(tree(snap)); });
    await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: "我查看走廊。" } }); });
    await act(async () => {
      renderer.root.findByType("form").findAllByType("button").at(-1).props.onClick();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await settleUntil(act, () => /房间服务暂时没有确认处理结果/.test(JSON.stringify(renderer.toJSON())));
    assert.equal(renderer.root.findAllByProps({ "data-narration-recovery": "viewer" }).length, 0);
    assert.match(JSON.stringify(renderer.toJSON()), /房间服务暂时没有确认处理结果/);
    const cancelled = structuredClone(snap);
    cancelled.state.authoritative.narrationRecovery.capability = "cancelled:new";
    await act(async () => { renderer.update(tree(cancelled)); });
    assert.equal(renderer.root.findAllByProps({ "data-narration-recovery": "viewer" }).length, 1,
      "a cancellation of the new action must still be visible");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    client.clear();
    globalThis.fetch = previousFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
