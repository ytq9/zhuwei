import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  playTableSnapFixture,
  tacticalProjectionFixture,
} from "./fixtures/tactical-map-v2.mjs";

function renderedText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || !Array.isArray(node.children)) return "";
  return node.children.map(renderedText).join("");
}

test("mounted tactical map keeps desktop disclosure, mobile dialog, view, and selection state honest", async () => {
  const [
    { QueryClient, QueryClientProvider },
    { compileSheet },
    { PlayTable },
    { TacticalMap },
    { act, create },
  ] = await Promise.all([
    import("@tanstack/react-query"),
    import("../app/_runtime/lib/dnd/compute.ts"),
    import("../app/_runtime/components/play-table.tsx"),
    import("../app/_runtime/components/tactical-map.tsx"),
    import("react-test-renderer"),
  ]);
  const client = new QueryClient();
  const exploration = playTableSnapFixture(compileSheet);
  exploration.state.authoritative.inCombat = false;
  exploration.state.authoritative.tacticalProjection.encounter = null;
  const tree = (snap) => createElement(
    QueryClientProvider,
    { client },
    createElement(PlayTable, { code: "TACTIC", snap }),
  );
  const tacticalMap = (renderer) => renderer.root.findByType(TacticalMap);
  const trigger = (renderer, kind) => tacticalMap(renderer).find(
    (node) => node.type === "button"
      && node.props["data-tactical-disclosure-trigger"] === kind,
  );
  const desktopRegion = (renderer) => {
    const button = trigger(renderer, "desktop");
    return tacticalMap(renderer).find(
      (node) => node.type === "div" && node.props.id === button.props["aria-controls"],
    );
  };
  const mobileDialogs = (renderer) => tacticalMap(renderer).findAll(
    (node) => node.props["data-tactical-map-mobile"] === "open",
  );
  const viewTrigger = (renderer, view) => tacticalMap(renderer).find(
    (node) => node.type === "button"
      && node.props["data-tactical-view-trigger"] === view,
  );

  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  try {
    await act(async () => {
      renderer = create(tree(exploration));
    });
    assert.equal(trigger(renderer, "desktop").props["aria-expanded"], false);
    assert.equal(desktopRegion(renderer).props.hidden, true);
    assert.equal(trigger(renderer, "mobile").props["aria-expanded"], false);
    assert.equal(mobileDialogs(renderer).length, 0);

    await act(async () => {
      trigger(renderer, "mobile").props.onClick();
    });
    assert.equal(trigger(renderer, "mobile").props["aria-expanded"], true);
    assert.equal(mobileDialogs(renderer).length, 1);
    assert.equal(
      tacticalMap(renderer).findByProps({ "data-tactical-layout": "mobile-dialog" })
        .props["data-tactical-view"],
      "map",
    );

    await act(async () => {
      tacticalMap(renderer).findByProps({ "data-feature-id": "feature:terrain" }).props.onClick();
    });
    const selectedTerrain = tacticalMap(renderer).findByProps({
      "data-tactical-selected": "feature:feature:terrain",
    });
    assert.match(renderedText(selectedTerrain), /瓦砾地形/);
    assert.equal(
      tacticalMap(renderer).findByProps({ "data-feature-id": "feature:terrain" })
        .props["aria-pressed"],
      true,
    );

    await act(async () => {
      viewTrigger(renderer, "text").props.onClick();
    });
    assert.equal(viewTrigger(renderer, "text").props["aria-selected"], true);
    const textReadout = tacticalMap(renderer).findByProps({ "data-tactical-readout": "v1" });
    assert.match(renderedText(textReadout), /庭院浓雾/);
    assert.match(renderedText(textReadout), /生效中/);
    assert.match(renderedText(textReadout), /重度遮蔽/);
    assert.equal(
      tacticalMap(renderer).findAll((node) => node.props["data-tactical-canvas"] === "v1").length,
      0,
      "the text alternative must replace rather than duplicate the map canvas",
    );
    assert.equal(
      tacticalMap(renderer).findByProps({ "data-tactical-layout": "mobile-dialog" })
        .props["data-tactical-view"],
      "text",
    );

    await act(async () => {
      viewTrigger(renderer, "map").props.onClick();
    });
    assert.equal(viewTrigger(renderer, "map").props["aria-selected"], true);
    assert.ok(tacticalMap(renderer).findByProps({ "data-tactical-canvas": "v1" }));
    assert.equal(
      tacticalMap(renderer).findAll((node) => node.props["data-tactical-readout"] === "v1").length,
      0,
      "switching back to the map must unmount the text panel",
    );

    await act(async () => {
      tacticalMap(renderer).findByProps({ "aria-label": "关闭战术地图" }).props.onClick();
    });
    assert.equal(trigger(renderer, "mobile").props["aria-expanded"], false);
    assert.equal(mobileDialogs(renderer).length, 0);

    await act(async () => {
      trigger(renderer, "desktop").props.onClick();
    });
    assert.equal(trigger(renderer, "desktop").props["aria-expanded"], true);
    assert.equal(desktopRegion(renderer).props.hidden, false);

    const explorationPoll = structuredClone(exploration);
    explorationPoll.state.authoritative.stateVersion = "18";
    explorationPoll.state.authoritative.tacticalProjection.self.position.x = "180";
    await act(async () => {
      renderer.update(tree(explorationPoll));
    });
    assert.equal(
      trigger(renderer, "desktop").props["aria-expanded"],
      true,
      "a same-scene exploration poll must preserve the player's desktop-open choice",
    );
    assert.equal(
      tacticalMap(renderer).findByProps({ "data-entity-id": "character:alice" })
        .props["data-position-x"],
      "180",
      "the open map must still consume the latest authoritative projection",
    );
    assert.ok(
      tacticalMap(renderer).findByProps({
        "data-tactical-selected": "feature:feature:terrain",
      }),
      "a same-scene poll must preserve a still-visible local selection",
    );

    await act(async () => {
      trigger(renderer, "desktop").props.onClick();
    });
    assert.equal(trigger(renderer, "desktop").props["aria-expanded"], false);

    const combat = structuredClone(explorationPoll);
    combat.state.authoritative.inCombat = true;
    combat.state.authoritative.tacticalProjection.encounter = tacticalProjectionFixture().encounter;
    await act(async () => {
      renderer.update(tree(combat));
    });
    assert.equal(
      trigger(renderer, "desktop").props["aria-expanded"],
      true,
      "entering combat must remount the desktop disclosure with its combat-open default",
    );
    assert.equal(
      trigger(renderer, "mobile").props["aria-expanded"],
      false,
      "entering combat must not force the compact mobile map into a full-screen dialog",
    );

    await act(async () => {
      trigger(renderer, "desktop").props.onClick();
    });
    const combatPoll = structuredClone(combat);
    combatPoll.state.authoritative.stateVersion = "19";
    await act(async () => {
      renderer.update(tree(combatPoll));
    });
    assert.equal(
      trigger(renderer, "desktop").props["aria-expanded"],
      false,
      "a same-scene combat poll must preserve the player's closed choice",
    );

    const returnedToExploration = structuredClone(combatPoll);
    returnedToExploration.state.authoritative.inCombat = false;
    returnedToExploration.state.authoritative.tacticalProjection.encounter = null;
    await act(async () => {
      renderer.update(tree(returnedToExploration));
    });
    assert.equal(
      trigger(renderer, "desktop").props["aria-expanded"],
      false,
      "leaving combat must remount the disclosure with the exploration-closed default",
    );

    const projectionUnavailable = structuredClone(returnedToExploration);
    projectionUnavailable.state.authoritative.tacticalProjection = null;
    await act(async () => {
      renderer.update(tree(projectionUnavailable));
    });
    assert.equal(trigger(renderer, "desktop").props["aria-expanded"], false);
    assert.equal(trigger(renderer, "mobile").props["aria-expanded"], false);
    assert.equal(mobileDialogs(renderer).length, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    if (previousActEnvironment === undefined) {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    } else {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
    client.clear();
  }
});
