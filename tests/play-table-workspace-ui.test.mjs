import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";

import { playTableSnapFixture } from "./fixtures/tactical-map-v2.mjs";

const projectRoot = new URL("../", import.meta.url);

function renderedText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || !Array.isArray(node.children)) return "";
  return node.children.map(renderedText).join("");
}

test("the table exposes honest initial and delayed sync loading states", async () => {
  const client = await readFile(
    new URL("app/table/[code]/table-client.tsx", projectRoot),
    "utf8",
  );
  assert.match(client, /data-table-initial-loading/);
  assert.match(client, /正在点亮桌面/);
  assert.match(client, /你有权看到的内容/);
  assert.match(client, /useDelayedFlag\(q\.isFetching && !q\.isLoading, 700\)/);
  assert.match(client, /<PlayTable code=\{code\} snap=\{data\} syncing=\{showSlowSync\}/);
});

test("the play surface shows useful context, loads in place, and opens four details on demand", async () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalFetch = globalThis.fetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let releaseAction;
  globalThis.fetch = async () => new Promise((resolve) => {
    releaseAction = resolve;
  });

  let renderer;
  let queryClient;
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
    const snap = playTableSnapFixture(compileSheet);
    snap.state.authoritative.inCombat = false;
    snap.state.authoritative.tacticalProjection = null;
    snap.state.npcs = [{ id: "npc:warden", name: "守夜人", intro: "守在旧钟楼下。" }];
    snap.state.clues = [{
      id: "clue:bell",
      name: "断裂的钟绳",
      text: "切口很新。",
      hint: "可以检查切口。",
      layer: "talk",
    }];
    snap.logs = [{ id: "log:one", entry: "阿莱莎走进庭院。", created_at: "" }];
    queryClient = new QueryClient();
    const tree = (value, syncing = false) => createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(PlayTable, { code: "TACTIC", snap: value, syncing }),
    );

    await act(async () => {
      renderer = create(tree(snap));
    });
    const context = renderer.root.findByProps({ "data-table-context-bar": true });
    assert.match(renderedText(context), /等待你的行动/);
    assert.match(renderedText(context), /钟楼庭院/);
    assert.match(renderedText(context), /生命 \d+\/\d+/);
    assert.match(renderedText(context), /护甲 \d+/);

    const journalTrigger = renderer.root.findByProps({ "data-table-journal-trigger": true });
    assert.equal(journalTrigger.props["aria-expanded"], false);
    assert.equal(renderer.root.findAllByProps({ "data-table-journal": true }).length, 0);

    await act(async () => {
      journalTrigger.props.onClick();
    });
    assert.equal(
      renderer.root.findByProps({ "data-table-journal-trigger": true }).props["aria-expanded"],
      true,
    );
    const journal = renderer.root.findByProps({ "data-table-journal": true });
    assert.equal(journal.props.role, "dialog");
    const tabs = journal.findAll((node) => node.props.role === "tab");
    assert.deepEqual(tabs.map(renderedText), ["人物1", "在场1", "线索1", "日志1"]);

    await act(async () => {
      tabs[2].props.onClick();
    });
    const cluePanel = renderer.root.findByProps({ role: "tabpanel" });
    assert.match(renderedText(cluePanel), /断裂的钟绳/);
    await act(async () => {
      renderer.root.findByProps({ "aria-label": "收起桌边册" }).props.onClick();
    });
    assert.equal(renderer.root.findAllByProps({ "data-table-journal": true }).length, 0);

    const textarea = renderer.root.findByType("textarea");
    await act(async () => {
      textarea.props.onChange({ target: { value: "我检查钟绳的切口。" } });
    });
    await act(async () => {
      renderer.root.findByProps({ "aria-label": "发送行动" }).props.onClick();
      await Promise.resolve();
    });
    const actionLoading = renderer.root.findByProps({ "data-table-loading": "action" });
    assert.match(renderedText(actionLoading), /行动已送出，正在等待 KP/);
    assert.equal(
      renderer.root.findByProps({ "data-table-conversation": true }).props["aria-busy"],
      true,
    );

    releaseAction(new Response(JSON.stringify({ ok: true, action: "committed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(renderer.root.findAllByProps({ "data-table-loading": "action" }).length, 0);

    await act(async () => {
      renderer.update(tree(snap, true));
    });
    const syncLoading = renderer.root.findByProps({ "data-table-loading": "sync" });
    assert.match(renderedText(syncLoading), /正在同步桌面/);
  } finally {
    if (renderer) {
      const { act } = await import("react-test-renderer");
      await act(async () => renderer.unmount());
    }
    queryClient?.clear();
    globalThis.fetch = originalFetch;
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
