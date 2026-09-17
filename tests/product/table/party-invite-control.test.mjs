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

function twoPlayerSnap(places) {
  const snap = { ok: true, ...playTableSnapFixture(compileSheet) };
  snap.state.authoritative.inCombat = false;
  snap.state.authoritative.tacticalProjection = null;
  snap.members.push({ user_id: "principal:bob", nickname: "鲍勃", is_host: false });
  snap.characters.push({ userId: "principal:bob", locked: true, visibility: "identityOnly",
    sheet: { ...compileSheet({ ...playTableSnapFixtureDraft(), name: "鲍勃" }), observerSummary: true } });
  snap.state.places = places;
  snap.state.placeNames = Object.fromEntries(Object.keys(places).map(id => [id, "守灵厅"]));
  snap.state.squads = [];
  snap.state.squadInvite = null;
  return snap;
}
function playTableSnapFixtureDraft() {
  return { name: "阿莱莎", raceId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier",
    scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, extraSkillIds: [], cantrips: [], prepared: [], spellbook: [],
    equipmentChoice: 0, appearance: "提着旧灯。", trait: "谨慎", ideal: "真相", bond: "遗嘱", flaw: "多疑" };
}

async function renderTable(snap) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(["table", "TACTIC"], snap);
  globalThis.fetch = async () => Response.json(snap);
  let renderer;
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); };
  try {
    await act(async () => { renderer = create(createElement(QueryClientProvider, { client: queryClient },
      createElement(TableClient, { code: "TACTIC", userName: "爱丽丝" })), { onRecoverableError(error) { errors.push(String(error?.stack ?? error)); } }); });
  } catch (error) {
    throw new Error(`render failed: ${error?.stack ?? error}\n${errors.join("\n")}`);
  } finally { console.error = previousError; }
  if (errors.some(line => /error occurred|TypeError|ReferenceError/.test(line))) throw new Error(`render errors:\n${errors.join("\n").slice(0, 3000)}`);
  // The party panel lives in the journal drawer; open it the way a player does.
  const toggle = renderer.root.findAll(node => typeof node.type === "string" && node.props["aria-expanded"] !== undefined && typeof node.props.onClick === "function")[0];
  assert.ok(toggle, "journal toggle");
  await act(async () => { toggle.props.onClick(); });
  return renderer;
}
function buttonsLabelled(renderer, label) {
  return renderer.root.findAllByType("button").filter(button => {
    const text = [button.props.children].flat().filter(value => typeof value === "string").join("");
    return text.trim() === label;
  });
}

// SPEC 0007 §5: the party invitation is offered to a co-located player; the
// table learns co-location from the projected places of both members.
test("the party invite control appears for a co-located member and stays hidden when the other place is unknown", async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { location: new URL("https://zhuwei.test/table/TACTIC"), setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  try {
    const together = await renderTable(twoPlayerSnap({ "principal:alice": "scene:bell-yard", "principal:bob": "scene:bell-yard" }));
    assert.equal(buttonsLabelled(together, "组队").length, 1, "one invite control for the co-located member");
    await act(async () => { together.unmount(); });
    const unknown = await renderTable(twoPlayerSnap({ "principal:alice": "scene:bell-yard" }));
    assert.equal(buttonsLabelled(unknown, "组队").length, 0, "no invite control without the other member's place");
    await act(async () => { unknown.unmount(); });
    const apart = await renderTable(twoPlayerSnap({ "principal:alice": "scene:bell-yard", "principal:bob": "scene:cellar" }));
    assert.equal(buttonsLabelled(apart, "组队").length, 0, "no invite control across scenes");
    await act(async () => { apart.unmount(); });
  } finally {
    globalThis.fetch = previous.fetch; globalThis.window = previous.window; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
