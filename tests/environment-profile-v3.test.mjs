import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
  ENVIRONMENT_PROFILE_DOCUMENT,
  environmentBindingMatchesFeature,
  environmentProfileEnabled,
  isCompiledEnvironmentBinding,
} from "../app/_runtime/lib/rules/profiles/environment.ts";
import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_RUNTIME_MANIFEST_PROFILE,
  ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  profileRegistryMatchesCanonicalDocuments,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  PRODUCTION_RUNTIME_PROFILE_REGISTRY,
  resolveRuntimeProfileManifest,
} from "../app/_runtime/lib/rules/profiles/registry.ts";
import { isCanonicalTacticalGeometry } from "../app/_runtime/lib/rules/profiles/tactical-geometry.ts";
import {
  CHANDELIER_FEATURE_DEFINITION,
  chandelierGeometry,
} from "./fixtures/chandelier-environment-v3.mjs";

test("dynamic environment Profile and opt-in runtime manifest are hash pinned without renaming v2", () => {
  assert.equal(canonicalSha256(ENVIRONMENT_PROFILE_DOCUMENT), ENVIRONMENT_PROFILE.profileHash);
  assert.equal(
    canonicalSha256(ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    ENVIRONMENT_RUNTIME_MANIFEST_PROFILE.profileHash,
  );
  assert.equal(profileRegistryMatchesCanonicalDocuments(), true);
  assert.equal(
    PRODUCTION_RUNTIME_PROFILE_REGISTRY.defaultManifest.manifest.profileId,
    CURRENT_RUNTIME_PROFILE_MANIFEST.manifest.profileId,
  );
  assert.equal(
    PRODUCTION_RUNTIME_PROFILE_REGISTRY.defaultManifest.manifest.profileHash,
    CURRENT_RUNTIME_PROFILE_MANIFEST.manifest.profileHash,
  );
  assert.equal(
    resolveRuntimeProfileManifest(
      PRODUCTION_RUNTIME_PROFILE_REGISTRY,
      ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    ).ok,
    true,
  );
  assert.equal(environmentProfileEnabled(CURRENT_RUNTIME_PROFILE_MANIFEST.extensions), false);
  assert.equal(environmentProfileEnabled(ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.extensions), true);
});

test("EnvironmentFeature compiles five bounded definitions into one canonical geometry binding", () => {
  const compiled = compileEnvironmentFeature(CHANDELIER_FEATURE_DEFINITION);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (!compiled.ok) return;
  const { tacticalFeature } = compiled.artifact;
  assert.equal(tacticalFeature.state, "suspended");
  assert.equal(tacticalFeature.durability.current, "10");
  assert.deepEqual(tacticalFeature.stateGraph.damageTransitions, [{
    fromState: "suspended",
    remainingDurabilityAtOrBelow: "0",
    toState: "falling",
  }]);
  assert.deepEqual(tacticalFeature.stateGraph.transitions, [{
    fromState: "falling",
    intent: "resolveHazard",
    toState: "debris",
  }]);
  assert.equal(isCompiledEnvironmentBinding(tacticalFeature.environment), true);
  assert.equal(environmentBindingMatchesFeature(tacticalFeature.environment, tacticalFeature), true);
  assert.equal(isCanonicalTacticalGeometry(chandelierGeometry(tacticalFeature)), true);
  assert.equal(
    compiled.artifact.featureDefinitionHash,
    canonicalSha256(CHANDELIER_FEATURE_DEFINITION),
  );
  assert.equal(
    compiled.artifact.destructibleDefinitionHash,
    canonicalSha256(CHANDELIER_FEATURE_DEFINITION.destructible),
  );
  assert.equal(
    compiled.artifact.stateGraphHash,
    canonicalSha256(CHANDELIER_FEATURE_DEFINITION.stateGraph),
  );
  assert.equal(
    compiled.artifact.hazardDefinitionHash,
    canonicalSha256(CHANDELIER_FEATURE_DEFINITION.hazard),
  );
  assert.equal(
    compiled.artifact.areaEffectDefinitionHash,
    canonicalSha256(CHANDELIER_FEATURE_DEFINITION.areaEffect),
  );
});

test("compiler rejects unbounded authority, unsorted state graphs, and broken hazard references", () => {
  const withCallerTargets = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  withCallerTargets.targetEntityIds = ["character:forged"];
  assert.deepEqual(compileEnvironmentFeature(withCallerTargets), {
    ok: false,
    error: "EnvironmentFeature is not canonical.",
  });

  const unsorted = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  unsorted.stateGraph.states.reverse();
  assert.equal(compileEnvironmentFeature(unsorted).ok, false);

  const brokenReference = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  brokenReference.hazard.areaEffectRef = "area-effect:not-registered";
  assert.equal(compileEnvironmentFeature(brokenReference).ok, false);

  const tooManyStates = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  tooManyStates.stateGraph.states = Array.from({ length: 17 }, (_, index) => ({
    state: `state:${String(index).padStart(2, "0")}`,
    opaque: false,
    impassable: false,
    cover: "none",
    propagation: "passes",
    terrain: "normal",
  }));
  assert.equal(compileEnvironmentFeature(tooManyStates).ok, false);
});
