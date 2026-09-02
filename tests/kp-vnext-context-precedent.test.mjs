import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePrecedentApplicability,
  VNEXT_PRECEDENT_CONDITION_SCHEMA,
} from "../app/_runtime/lib/kp/vnext/index.ts";

const SCOPE = Object.freeze({ kind: "scene", ref: "scene:hall" });
const FORM = "world-interaction.vnext-1";

function condition(overrides = {}) {
  return {
    schema: VNEXT_PRECEDENT_CONDITION_SCHEMA,
    scope: SCOPE,
    formId: FORM,
    targetRefs: ["feature:chain"],
    relationRefs: ["relation:beam-supports-chain"],
    instrumentRefs: ["item:stone"],
    ...overrides,
  };
}

function precedent(precedentId, status, conditionSignature, overrides = {}) {
  return {
    precedentId,
    status,
    conditionSignature,
    mechanics: {
      operation: "resolveNoncombatCheck",
      ability: "str",
      dc: 15,
      outcomeRange: { success: ["opened"], failure: ["still closed"] },
    },
    publicExplanation: "A ruling for this physical situation.",
    ...overrides,
  };
}

function resolve(records, queryCondition = condition(), collectionComplete = true) {
  return resolvePrecedentApplicability({
    collection: records,
    collectionComplete,
    query: {
      entryRef: "precedent:current",
      conditionSignature: queryCondition,
    },
  });
}

test("active exact precedent wins and superseded records remain lineage only", () => {
  const old = precedent("precedent:old", "superseded", condition(), {
    supersededByPrecedentId: "precedent:current",
    mechanics: {
      operation: "resolveNoncombatCheck",
      ability: "str",
      dc: 20,
      outcomeRange: { success: ["opened"], failure: ["still closed"] },
    },
  });
  const current = precedent("precedent:current", "active", condition(), {
    supersededPrecedentId: "precedent:old",
    mechanics: {
      operation: "resolveNoncombatCheck",
      ability: "str",
      dc: 10,
      outcomeRange: { success: ["opened"], failure: ["still closed"] },
    },
  });
  const result = resolve([current, old]);

  assert.equal(result.kind, "exact", JSON.stringify(result));
  assert.equal(result.active.precedentId, "precedent:current");
  assert.deepEqual(result.lineage.map(({ precedentId }) => precedentId), ["precedent:old"]);
});

test("a superseded exact record cannot supply current applicability", () => {
  const result = resolve([
    precedent("precedent:old", "superseded", condition()),
  ]);

  assert.equal(result.kind, "knownAbsent", JSON.stringify(result));
  assert.equal(result.applicability, "notApplicable");
  assert.equal(result.entry.selector.kind, "conditionSignature");
  assert.deepEqual(result.lineage.map(({ precedentId }) => precedentId), ["precedent:old"]);
});

test("a changed condition is analogous, never an exact ruling", () => {
  const result = resolve([
    precedent("precedent:other-target", "active", condition({
      targetRefs: ["feature:chandelier"],
    })),
  ]);

  assert.equal(result.kind, "analogous", JSON.stringify(result));
  assert.deepEqual(result.candidates.map(({ precedentId }) => precedentId), [
    "precedent:other-target",
  ]);
});

test("an incomplete collection stays unresolved instead of producing knownAbsent", () => {
  const result = resolve([], condition(), false);

  assert.equal(result.kind, "unresolved", JSON.stringify(result));
  assert.equal(result.reason, "collectionIncomplete");
  assert.notEqual(result.kind, "knownAbsent");
});

test("two active records for one structured condition fail closed as an integrity conflict", () => {
  const result = resolve([
    precedent("precedent:one", "active", condition(), { mechanics: { dc: 10 } }),
    precedent("precedent:two", "active", condition(), { mechanics: { dc: 20 } }),
  ]);

  assert.equal(result.kind, "integrityConflict", JSON.stringify(result));
  assert.match(result.issue, /active-condition-conflict/u);
});

test("the condition signature rejects mechanics, DC, and outcome range fields", () => {
  const result = resolve([], condition({
    mechanics: { operation: "resolveNoncombatCheck" },
  }));

  assert.equal(result.kind, "unresolved", JSON.stringify(result));
  assert.equal(result.reason, "queryInvalid");
});
