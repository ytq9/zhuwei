import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  playTableSnapFixture,
  tacticalProjectionFixture,
} from "./fixtures/tactical-map-v2.mjs";

test("mounted tactical map toggles and resets only when PlayTable changes its mode key", async () => {
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
  const disclosure = (renderer) => {
    const map = renderer.root.findByType(TacticalMap);
    const button = map.findByType("button");
    const region = map.find(
      (node) => node.type === "div" && node.props.id === button.props["aria-controls"],
    );
    return { button, region };
  };

  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  try {
    await act(async () => {
      renderer = create(tree(exploration));
    });
    assert.equal(disclosure(renderer).button.props["aria-expanded"], false);
    assert.equal(disclosure(renderer).region.props.hidden, true);

    await act(async () => {
      disclosure(renderer).button.props.onClick();
    });
    assert.equal(disclosure(renderer).button.props["aria-expanded"], true);
    assert.equal(disclosure(renderer).region.props.hidden, false);

    const explorationPoll = structuredClone(exploration);
    explorationPoll.state.authoritative.stateVersion = "18";
    explorationPoll.state.authoritative.tacticalProjection.self.position.x = "180";
    await act(async () => {
      renderer.update(tree(explorationPoll));
    });
    assert.equal(
      disclosure(renderer).button.props["aria-expanded"],
      true,
      "a same-scene exploration poll must preserve the player's open choice",
    );
    assert.equal(
      renderer.root.findByProps({ "data-entity-id": "character:alice" }).props["data-position-x"],
      "180",
      "the open map must still consume the latest authoritative projection",
    );

    await act(async () => {
      disclosure(renderer).button.props.onClick();
    });
    assert.equal(disclosure(renderer).button.props["aria-expanded"], false);

    const combat = structuredClone(explorationPoll);
    combat.state.authoritative.inCombat = true;
    combat.state.authoritative.tacticalProjection.encounter = tacticalProjectionFixture().encounter;
    await act(async () => {
      renderer.update(tree(combat));
    });
    assert.equal(
      disclosure(renderer).button.props["aria-expanded"],
      true,
      "entering combat must remount the disclosure with the combat-open default",
    );

    await act(async () => {
      disclosure(renderer).button.props.onClick();
    });
    const combatPoll = structuredClone(combat);
    combatPoll.state.authoritative.stateVersion = "19";
    await act(async () => {
      renderer.update(tree(combatPoll));
    });
    assert.equal(
      disclosure(renderer).button.props["aria-expanded"],
      false,
      "a same-scene combat poll must preserve the player's closed choice",
    );

    await act(async () => {
      disclosure(renderer).button.props.onClick();
    });
    const returnedToExploration = structuredClone(combatPoll);
    returnedToExploration.state.authoritative.inCombat = false;
    returnedToExploration.state.authoritative.tacticalProjection.encounter = null;
    await act(async () => {
      renderer.update(tree(returnedToExploration));
    });
    assert.equal(
      disclosure(renderer).button.props["aria-expanded"],
      false,
      "leaving combat must remount the disclosure with the exploration-closed default",
    );
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
