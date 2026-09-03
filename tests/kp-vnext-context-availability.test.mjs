import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceIndex,
  createContextWorkBudget,
  resolveAvailability,
} from "../app/_runtime/lib/kp/vnext/index.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/authority-read.ts";
import {
  createDefinitionSnapshot,
  storedSemanticDefinition,
} from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const SCENE = "scene:hall";
const OTHER_SCENE = "scene:cellar";
const ALICE = "character:alice";
const EXISTING_FEATURE = "feature:existing-lamp";

function sceneFeature(definitionRef, content, visibilityPolicyRef = "visibility:scene-observers") {
  const snapshot = createDefinitionSnapshot(definitionRef, "1", content);
  return storedSemanticDefinition("sceneFeature", visibilityPolicyRef, snapshot, {
    templateRef: "template:sceneFeature",
    templateHash: snapshot.definitionHash,
  });
}

function worldState({ facts = {}, withExistingFeature = false } = {}) {
  const definitions = withExistingFeature
    ? { [EXISTING_FEATURE]: sceneFeature(EXISTING_FEATURE, { sceneRef: SCENE }) }
    : {};
  return {
    scenes: { [SCENE]: { id: SCENE }, [OTHER_SCENE]: { id: OTHER_SCENE } },
    entities: {
      [ALICE]: { id: ALICE, kind: "player", name: "艾丽丝", sceneId: SCENE },
    },
    canonicalFacts: facts,
    knowledge: {},
    campaignRuntime: {
      campaign: null,
      definitions,
      itemSystem: { entries: {}, definitions: {} },
    },
    combatRuntime: { entities: {}, scenes: {}, definitions: {} },
  };
}

function index(state) {
  const built = buildReferenceIndex(state, createContextWorkBudget());
  assert.equal(built.kind, "indexed");
  return built.index;
}

function requirement(overrides = {}) {
  return {
    entryRef: "slot:blank",
    obligation: "target",
    scopeRef: SCENE,
    selector: { kind: "exactRef", ref: "object:new-lamp" },
    allowedKinds: ["material-description"],
    ...overrides,
  };
}

function localAbsenceFact(state, overrides = {}) {
  const { value: valueOverrides, ...rest } = overrides;
  return {
    id: "fact:no-second-exit",
    kind: "localAbsence",
    subjectRefs: [SCENE],
    visibilityPolicyId: "visibility:scene-observers",
    ...rest,
    value: {
      scopeRef: SCENE,
      status: "active",
      scopeRevisionOrHash: authorityRevisionOrHash(state, SCENE),
      selector: { kind: "exactRef", ref: "object:new-lamp" },
      basisRefs: ["fact:searched-thoroughly"],
      ...valueOverrides,
    },
  };
}

function grant(state, overrides = {}) {
  return {
    grantRef: "authorization:kp-may-settle",
    grantHash: "sha256:grant-hash",
    scopeRef: SCENE,
    scopeRevisionOrHash: authorityRevisionOrHash(state, SCENE),
    allowedKinds: ["material-description"],
    basisRefs: ["profile:blank-grant-clause"],
    visibilityPolicyRef: "visibility:scene-observers",
    ...overrides,
  };
}

test("resolveAvailability reports present when a matching object already stands in scope", () => {
  const state = worldState({ withExistingFeature: true });
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement({ selector: { kind: "exactRef", ref: EXISTING_FEATURE } }),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.deepEqual(outcome, { kind: "present" });
});

test("resolveAvailability reports unresolved when the scope was never loaded", () => {
  const state = worldState();
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [],
    loadedRefs: new Set(),
    frontierExhausted: true,
  });
  assert.deepEqual(outcome, { kind: "unresolved", reason: "scope:not-loaded" });
});

test("resolveAvailability reports knownAbsent from an active localAbsence fact and never invents presence from a missing search", () => {
  const state = worldState();
  const fact = localAbsenceFact(state);
  state.canonicalFacts[fact.id] = fact;
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.equal(outcome.kind, "entry");
  assert.equal(outcome.entry.kind, "knownAbsent");
  assert.equal(outcome.entry.scopeRef, SCENE);
  assert.deepEqual(outcome.entry.selector, { kind: "exactRef", ref: "object:new-lamp" });
  assert.deepEqual([...outcome.entry.basisRefs], ["fact:no-second-exit", "fact:searched-thoroughly"]);
});

test("resolveAvailability matches an active absence even when the requirement selector's keys are written in a different order", () => {
  const state = worldState();
  const fact = localAbsenceFact(state);
  state.canonicalFacts[fact.id] = fact;
  // Same selector as the fact records, but with `ref` written before `kind`.
  // A JSON.stringify-based comparison is property-order sensitive and would
  // wrongly call this a mismatch, silently dropping a valid absence record.
  const reorderedSelector = { ref: "object:new-lamp", kind: "exactRef" };
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement({ selector: reorderedSelector }),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.equal(outcome.kind, "entry");
  assert.equal(outcome.entry.kind, "knownAbsent");
});

test("resolveAvailability ignores an absence record whose basisRefs is empty", () => {
  const state = worldState();
  const fact = localAbsenceFact(state, { value: { basisRefs: [] } });
  state.canonicalFacts[fact.id] = fact;
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  // No usable absence and no grant: the question stays open, never a
  // fabricated presence and never a licence to invent.
  assert.deepEqual(outcome, { kind: "unresolved", reason: "authorization:absent-or-stale" });
});

test("resolveAvailability treats a stale scopeRevisionOrHash on the absence record as no longer active", () => {
  const state = worldState();
  const fact = localAbsenceFact(state, { value: { scopeRevisionOrHash: "stale-revision" } });
  state.canonicalFacts[fact.id] = fact;
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.deepEqual(outcome, { kind: "unresolved", reason: "authorization:absent-or-stale" });
});

test("resolveAvailability never opens a blank while the discovery frontier was truncated, even with a valid grant", () => {
  const state = worldState();
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [grant(state)],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: false,
  });
  assert.deepEqual(outcome, { kind: "unresolved", reason: "frontier:truncated" });
});

test("resolveAvailability stays unresolved without an authorization even when nothing is found and nothing is denied", () => {
  const state = worldState();
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.deepEqual(outcome, { kind: "unresolved", reason: "authorization:absent-or-stale" });
});

test("resolveAvailability rejects a grant issued against a scope revision that is no longer current", () => {
  const state = worldState();
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [grant(state, { scopeRevisionOrHash: "stale-grant-revision" })],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.deepEqual(outcome, { kind: "unresolved", reason: "authorization:absent-or-stale" });
});

test("resolveAvailability opens a blank only with a current, matching grant, carrying its authorization binding", () => {
  const state = worldState();
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement(),
    authorizations: [grant(state)],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.equal(outcome.kind, "entry");
  assert.equal(outcome.entry.kind, "openBlank");
  assert.equal(outcome.entry.scopeRef, SCENE);
  assert.deepEqual([...outcome.entry.allowedKinds], ["material-description"]);
  assert.deepEqual([...outcome.entry.basisRefs], ["profile:blank-grant-clause"]);
  assert.equal(outcome.entry.authorizationRef, "authorization:kp-may-settle");
  assert.equal(outcome.entry.authorizationHash, "sha256:grant-hash");
});

test("resolveAvailability rejects a grant that does not cover every kind the requirement asks for", () => {
  const state = worldState();
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement({ allowedKinds: ["material-description", "structural-description"] }),
    authorizations: [grant(state, { allowedKinds: ["material-description"] })],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.deepEqual(outcome, { kind: "unresolved", reason: "authorization:absent-or-stale" });
});

test("resolveAvailability reports integrityConflict when a positive match and an active absence disagree, and never picks silently between them", () => {
  const state = worldState({ withExistingFeature: true });
  const fact = localAbsenceFact(state, { value: { selector: { kind: "exactRef", ref: EXISTING_FEATURE } } });
  state.canonicalFacts[fact.id] = fact;
  const outcome = resolveAvailability({
    state,
    index: index(state),
    requirement: requirement({ selector: { kind: "exactRef", ref: EXISTING_FEATURE } }),
    authorizations: [],
    loadedRefs: new Set([SCENE]),
    frontierExhausted: true,
  });
  assert.equal(outcome.kind, "integrityConflict");
  assert.equal(outcome.issue, `availability:${requirement().entryRef}:positive-and-active-absence`);
});
