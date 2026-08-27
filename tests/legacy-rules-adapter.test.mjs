import assert from "node:assert/strict";
import test from "node:test";

import { BLACK_OAK_WILL } from "../app/_runtime/lib/module/black-oak-will.ts";
import { legacyRulesAdapterFor } from "../app/_runtime/lib/rules/legacy-adapter.ts";
import {
  AUTHORITATIVE_RULESET_VERSION,
  RULESET_VERSION,
} from "../app/_runtime/lib/rules/ruleset.ts";

const player = {
  id: "legacy-player",
  kind: "player",
  name: "旧版角色",
  sceneId: "wake",
};

test("the Legacy facade is available only for the exact Legacy ruleset", () => {
  assert.throws(
    () => legacyRulesAdapterFor(AUTHORITATIVE_RULESET_VERSION),
    /Legacy rules adapter is unavailable/,
  );
  assert.throws(
    () => legacyRulesAdapterFor("dnd5e-2014-srd5.1-unknown"),
    /Legacy rules adapter is unavailable/,
  );

  const legacy = legacyRulesAdapterFor(RULESET_VERSION);
  const state = legacy.initializeWorld(BLACK_OAK_WILL.world, [player]);
  assert.equal(state.rulesetVersion, RULESET_VERSION);
  assert.equal(legacy.projectViewer(BLACK_OAK_WILL.world, state, player.id).viewer.id, player.id);
});

test("the Legacy facade rejects non-Legacy state before folding or projection", () => {
  const legacy = legacyRulesAdapterFor(RULESET_VERSION);
  const state = legacy.initializeWorld(BLACK_OAK_WILL.world, [player]);
  state.rulesetVersion = AUTHORITATIVE_RULESET_VERSION;

  assert.throws(
    () => legacy.applyCommittedEvents(state, []),
    /Legacy rules adapter only accepts/,
  );
  assert.throws(
    () => legacy.projectViewer(BLACK_OAK_WILL.world, state, player.id),
    /Legacy rules adapter only accepts/,
  );
});
