import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create } from "react-test-renderer";
import { compileSheet } from "../../../app/_runtime/lib/dnd/compute.ts";
import { playTableSnapFixture } from "../../support/fixtures/tactical-map-v2.mjs";

// Match the production framework's Next compatibility imports in Node tests.
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, next) {
    return next(specifier.startsWith("next/") ? specifier.replace("next/", "vinext/shims/") : specifier, context);
  }
`)}`, import.meta.url);
const { TableClient } = await import("../../../app/table/[code]/table-client.tsx");

// SPEC 0007 §2: a failed read must not discard the player's ongoing interaction.
test("a failed projection poll keeps the table and draft mounted, then recovers", async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { location: new URL("https://zhuwei.test/table/TACTIC"), setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  const snap = { ok: true, ...playTableSnapFixture(compileSheet) };
  snap.state.authoritative.inCombat = false;
  snap.state.authoritative.tacticalProjection = null;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(["table", "TACTIC"], snap);
  let response = snap;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json(response);
  };
  let renderer;
  try {
    await act(async () => { renderer = create(createElement(QueryClientProvider, { client: queryClient },
      createElement(TableClient, { code: "TACTIC", userName: "爱丽丝" }))); });
    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({ target: { value: "我检查钟绳的切口。" } });
    });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["table", "TACTIC"] });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(renderer.root.findByType("textarea").props.value, "我检查钟绳的切口。", "normal polls also keep the draft");
    response = { ok: false, retryable: true, error: "房间投影暂时不可用，请稍后刷新" };
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["table", "TACTIC"] });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const drafts = renderer.root.findAllByType("textarea");
    assert.equal(drafts.length, 1, "a failed projection poll must not unmount the entire table");
    assert.equal(drafts[0].props.value, "我检查钟绳的切口。");
    assert.equal(renderer.root.findAllByProps({ "data-table-sync-error": true }).length, 1);
    response = snap;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["table", "TACTIC"] });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(renderer.root.findByType("textarea").props.value, "我检查钟绳的切口。");
    assert.equal(renderer.root.findAllByProps({ "data-table-sync-error": true }).length, 0);
    for (const terminal of [
      { ok: false, left: true, error: "你已离开这一桌。" },
      { ok: false, error: "房间投影暂时不可用，请稍后刷新" },
    ]) {
      response = snap;
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ["table", "TACTIC"] });
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      response = terminal;
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ["table", "TACTIC"] });
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.equal(renderer.root.findAllByType("textarea").length, 0, "terminal or invalid projections cannot keep a stale table visible");
    }
    assert.ok(calls.every(call => call.command === "fetchTable"), "sync recovery must not submit any game action");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    queryClient.clear();
    globalThis.fetch = previous.fetch;
    globalThis.window = previous.window;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
