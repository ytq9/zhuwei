import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import {
  compileEnvironmentFeature,
  ENVIRONMENT_PROFILE,
  ENVIRONMENT_PROFILE_DOCUMENT,
  LEGACY_ENVIRONMENT_PROFILE,
  LEGACY_ENVIRONMENT_PROFILE_DOCUMENT,
  environmentBindingMatchesFeature,
  environmentProfileEnabled,
  isCompiledEnvironmentBinding,
} from "../app/_runtime/lib/rules/profiles/environment.ts";
import {
  CHARACTER_PROFICIENCY_PROFILE,
  CHARACTER_PROFICIENCY_PROFILE_DOCUMENT,
  characterProficiencyProfileEnabled,
} from "../app/_runtime/lib/rules/profiles/character-proficiency.ts";
import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_RUNTIME_MANIFEST_PROFILE,
  ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  ENVIRONMENT_V4_RUNTIME_MANIFEST_PROFILE,
  ENVIRONMENT_V4_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
  LEGACY_ENVIRONMENT_RUNTIME_MANIFEST_PROFILE,
  LEGACY_ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
  profileRegistryMatchesCanonicalDocuments,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  PRODUCTION_RUNTIME_PROFILE_REGISTRY,
  resolveRuntimeProfileManifest,
} from "../app/_runtime/lib/rules/profiles/registry.ts";
import { isCanonicalTacticalGeometry } from "../app/_runtime/lib/rules/profiles/tactical-geometry.ts";
import {
  buildPlayerCombatEntity,
  synchronizePlayerCombatEntity,
} from "../app/_runtime/lib/rules/v2/character-abilities.ts";
import {
  characterProficiencyFieldsMatchProfile,
  savingThrowModifier,
  skillCheckModifier,
} from "../app/_runtime/lib/rules/v2/proficiency.ts";
import {
  CHANDELIER_FEATURE_DEFINITION,
  chandelierGeometry,
} from "./fixtures/chandelier-environment-v3.mjs";

test("new state-or-hazard Profile is pinned while the hazard-only v2 generation remains addressable", () => {
  assert.equal(canonicalSha256(ENVIRONMENT_PROFILE_DOCUMENT), ENVIRONMENT_PROFILE.profileHash);
  assert.equal(
    canonicalSha256(LEGACY_ENVIRONMENT_PROFILE_DOCUMENT),
    LEGACY_ENVIRONMENT_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    ENVIRONMENT_RUNTIME_MANIFEST_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(LEGACY_ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    LEGACY_ENVIRONMENT_RUNTIME_MANIFEST_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(CHARACTER_PROFICIENCY_PROFILE_DOCUMENT),
    CHARACTER_PROFICIENCY_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(ENVIRONMENT_V4_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    ENVIRONMENT_V4_RUNTIME_MANIFEST_PROFILE.profileHash,
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
  assert.equal(
    resolveRuntimeProfileManifest(
      PRODUCTION_RUNTIME_PROFILE_REGISTRY,
      LEGACY_ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    ).ok,
    true,
  );
  assert.equal(
    resolveRuntimeProfileManifest(
      PRODUCTION_RUNTIME_PROFILE_REGISTRY,
      ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    ).ok,
    true,
  );
  assert.equal(environmentProfileEnabled(CURRENT_RUNTIME_PROFILE_MANIFEST.extensions), false);
  assert.equal(environmentProfileEnabled(ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.extensions), true);
  assert.equal(characterProficiencyProfileEnabled(CURRENT_RUNTIME_PROFILE_MANIFEST.extensions), false);
  assert.equal(characterProficiencyProfileEnabled(ENVIRONMENT_RUNTIME_PROFILE_MANIFEST.extensions), false);
  assert.equal(characterProficiencyProfileEnabled(ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST.extensions), true);
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
  const forgedBinding = structuredClone(tacticalFeature.environment);
  forgedBinding.profile = structuredClone(LEGACY_ENVIRONMENT_PROFILE);
  assert.equal(isCompiledEnvironmentBinding(forgedBinding), false);
  const forgedGeometry = chandelierGeometry(tacticalFeature);
  forgedGeometry.obstacles.find((feature) =>
    feature.featureId === tacticalFeature.featureId).environment.profile =
      structuredClone(LEGACY_ENVIRONMENT_PROFILE);
  assert.equal(isCanonicalTacticalGeometry(forgedGeometry), false);
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

test("the exact v4 extension carries Expertise and saves into combat without field-presence dispatch", () => {
  const character = {
    id: "character:profile-v4",
    kind: "player",
    name: "专精者",
    sceneId: "scene:profile-v4",
    tenureStatus: "active",
    entityOrdinal: "1",
    abilityScores: { str: 10, dex: 10, con: 12, int: 14, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    proficientSkills: ["investigation"],
    expertiseSkills: ["investigation"],
    proficientSaves: ["con"],
  };
  const compiled = { abilityRefs: [], definitions: {} };
  const historical = buildPlayerCombatEntity(
    ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    character,
    compiled,
  );
  assert.equal(historical.expertiseSkills, undefined);
  assert.equal(historical.proficientSaves, undefined);
  assert.equal(skillCheckModifier(
    ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    historical,
    "int",
    "investigation",
  ), 4);
  assert.equal(savingThrowModifier(
    ENVIRONMENT_RUNTIME_PROFILE_MANIFEST,
    historical,
    "con",
  ), 1);

  const current = buildPlayerCombatEntity(
    ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    character,
    compiled,
  );
  assert.deepEqual(current.expertiseSkills, ["investigation"]);
  assert.deepEqual(current.proficientSaves, ["con"]);
  assert.equal(skillCheckModifier(
    ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    current,
    "int",
    "investigation",
  ), 6);
  assert.equal(savingThrowModifier(
    ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    current,
    "con",
  ), 3);
  assert.deepEqual(
    synchronizePlayerCombatEntity({ ...current, expertiseSkills: ["forged"] }, current)
      .expertiseSkills,
    ["investigation"],
  );

  const forged = structuredClone(ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST);
  forged.extensions.find(({ profileId }) =>
    profileId === CHARACTER_PROFICIENCY_PROFILE.profileId).profileHash = `sha256:${"0".repeat(64)}`;
  assert.equal(characterProficiencyFieldsMatchProfile(forged, character), false);
  assert.equal(characterProficiencyFieldsMatchProfile(
    ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    { ...character, expertiseSkills: ["perception"] },
  ), false);
  assert.equal(characterProficiencyFieldsMatchProfile(
    ENVIRONMENT_V4_RUNTIME_PROFILE_MANIFEST,
    { ...character, proficientSaves: ["luck"] },
  ), false);
});

test("hazard-only v2 definitions still compile under their exact immutable Profile", () => {
  const legacy = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  legacy.schema = "zhuwei.environment-feature/v1";
  legacy.environmentProfile = structuredClone(LEGACY_ENVIRONMENT_PROFILE);
  delete legacy.effectMode;
  const compiled = compileEnvironmentFeature(legacy);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  if (!compiled.ok) return;
  assert.deepEqual(compiled.artifact.tacticalFeature.environment.profile, LEGACY_ENVIRONMENT_PROFILE);
  const forgedBinding = structuredClone(compiled.artifact.tacticalFeature.environment);
  forgedBinding.profile = structuredClone(ENVIRONMENT_PROFILE);
  assert.equal(isCompiledEnvironmentBinding(forgedBinding), false);
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

test("V3 selectors are deterministic while the frozen legacy compiler remains byte-compatible", () => {
  const ambiguous = structuredClone(CHANDELIER_FEATURE_DEFINITION);
  ambiguous.stateGraph.transitions.push({
    fromState: "falling",
    trigger: "hazardResolved",
    toState: "suspended",
  });
  ambiguous.stateGraph.transitions.sort((left, right) =>
    `${left.fromState}\u0000${left.trigger}\u0000${left.remainingDurabilityAtOrBelow ?? ""}\u0000${left.toState}`
      .localeCompare(`${right.fromState}\u0000${right.trigger}\u0000${right.remainingDurabilityAtOrBelow ?? ""}\u0000${right.toState}`));
  assert.equal(compileEnvironmentFeature(ambiguous).ok, false);

  const legacy = structuredClone(ambiguous);
  legacy.schema = "zhuwei.environment-feature/v1";
  legacy.environmentProfile = structuredClone(LEGACY_ENVIRONMENT_PROFILE);
  delete legacy.effectMode;
  assert.equal(compileEnvironmentFeature(legacy).ok, true);
});
