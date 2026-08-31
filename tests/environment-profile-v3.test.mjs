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
  CHARACTER_PROFICIENCY_PROFILE,
  CHARACTER_PROFICIENCY_PROFILE_DOCUMENT,
  characterProficiencyProfileEnabled,
} from "../app/_runtime/lib/rules/profiles/character-proficiency.ts";
import {
  ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE,
  ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
  profileRegistryMatchesCanonicalDocuments,
  V5_EVENT_SCHEMA_PROFILE,
  V5_EVENT_SCHEMA_PROFILE_DOCUMENT,
} from "../app/_runtime/lib/rules/profiles/manifests.ts";
import {
  STANDARD_GEAR_PROFILE,
  STANDARD_GEAR_PROFILE_DOCUMENT,
  standardGearCatalogForProfile,
  standardGearResolverForProfile,
} from "../app/_runtime/lib/rules/profiles/standard-gear.ts";
import {
  ITEM_SYSTEM_PROFILE,
  ITEM_SYSTEM_PROFILE_DOCUMENT,
} from "../app/_runtime/lib/rules/profiles/item-system.ts";
import {
  PRODUCTION_RUNTIME_PROFILE_REGISTRY,
  resolveRuntimeProfileManifest,
} from "../app/_runtime/lib/rules/profiles/registry.ts";
import { isCanonicalTacticalGeometry } from "../app/_runtime/lib/rules/profiles/tactical-geometry.ts";
import {
  buildPlayerCombatEntity,
  synchronizePlayerCombatEntity,
} from "../app/_runtime/lib/rules/v2/character-abilities.ts";
import { emptyItemSystemState } from "../app/_runtime/lib/rules/v2/items.ts";
import {
  characterProficiencyFieldsMatchProfile,
  savingThrowModifier,
  skillCheckModifier,
} from "../app/_runtime/lib/rules/v2/proficiency.ts";
import {
  CHANDELIER_FEATURE_DEFINITION,
  chandelierGeometry,
} from "./fixtures/chandelier-environment-v3.mjs";

const RETIRED_ENVIRONMENT_PROFILE = Object.freeze({
  profileId: "environment-feature-fsm-2014-retired",
  profileHash: `sha256:${"0".repeat(64)}`,
});

test("product 0.4 pins one exact V5 runtime closure", () => {
  assert.equal(canonicalSha256(ENVIRONMENT_PROFILE_DOCUMENT), ENVIRONMENT_PROFILE.profileHash);
  assert.equal(
    canonicalSha256(CHARACTER_PROFICIENCY_PROFILE_DOCUMENT),
    CHARACTER_PROFICIENCY_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE.profileHash,
  );
  assert.equal(profileRegistryMatchesCanonicalDocuments(), true);
  assert.equal(
    PRODUCTION_RUNTIME_PROFILE_REGISTRY.defaultManifest.manifest.profileId,
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.manifest.profileId,
  );
  assert.equal(
    PRODUCTION_RUNTIME_PROFILE_REGISTRY.defaultManifest.manifest.profileHash,
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.manifest.profileHash,
  );
  assert.equal(
    resolveRuntimeProfileManifest(
      PRODUCTION_RUNTIME_PROFILE_REGISTRY,
      ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    ).ok,
    true,
  );
  assert.equal(environmentProfileEnabled(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.extensions), true);
  assert.equal(characterProficiencyProfileEnabled(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.extensions), true);
  const retired = structuredClone(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST);
  retired.manifest = {
    profileId: "runtime-srd51-2014-authoritative-retired",
    profileHash: `sha256:${"0".repeat(64)}`,
  };
  assert.equal(resolveRuntimeProfileManifest(PRODUCTION_RUNTIME_PROFILE_REGISTRY, retired).ok, false);
});

test("V5 pins exact event and standard-gear profiles with canonical version semantics", () => {
  assert.equal(
    canonicalSha256(V5_EVENT_SCHEMA_PROFILE_DOCUMENT),
    V5_EVENT_SCHEMA_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(STANDARD_GEAR_PROFILE_DOCUMENT),
    STANDARD_GEAR_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(ITEM_SYSTEM_PROFILE_DOCUMENT),
    ITEM_SYSTEM_PROFILE.profileHash,
  );
  assert.equal(
    canonicalSha256(ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT),
    ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE.profileHash,
  );
  assert.deepEqual(
    V5_EVENT_SCHEMA_PROFILE_DOCUMENT.normativePayload.eventTypeVersionOverrides,
    { ItemUsed: "4", ResourceSpent: "2" },
  );
  assert.deepEqual(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.eventSchema,
    V5_EVENT_SCHEMA_PROFILE,
  );
  assert.ok(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.extensions.some((profile) =>
      profile.profileId === STANDARD_GEAR_PROFILE.profileId
      && profile.profileHash === STANDARD_GEAR_PROFILE.profileHash),
  );
  assert.ok(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST.extensions.some((profile) =>
      profile.profileId === ITEM_SYSTEM_PROFILE.profileId
      && profile.profileHash === ITEM_SYSTEM_PROFILE.profileHash),
  );
  assert.equal(standardGearCatalogForProfile(STANDARD_GEAR_PROFILE)?.length, 58);
  assert.deepEqual(standardGearResolverForProfile(STANDARD_GEAR_PROFILE)?.("longbow")?.weapon, {
    attackAbility: "dex",
    damageDice: "1d8",
    damageType: "piercing",
    rangeNormalInches: "1800",
    rangeLongInches: "7200",
    ammunitionId: "arrow",
  });
  assert.equal(standardGearCatalogForProfile({
    profileId: STANDARD_GEAR_PROFILE.profileId,
    profileHash: `sha256:${"0".repeat(64)}`,
  }), undefined);
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
  forgedBinding.profile = structuredClone(RETIRED_ENVIRONMENT_PROFILE);
  assert.equal(isCompiledEnvironmentBinding(forgedBinding), false);
  const forgedGeometry = chandelierGeometry(tacticalFeature);
  forgedGeometry.obstacles.find((feature) =>
    feature.featureId === tacticalFeature.featureId).environment.profile =
      structuredClone(RETIRED_ENVIRONMENT_PROFILE);
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

test("the exact V5 extension carries Expertise and saves without field-presence dispatch", () => {
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
  const current = buildPlayerCombatEntity(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    character,
    compiled,
    undefined,
    undefined,
    emptyItemSystemState(),
  );
  assert.deepEqual(current.expertiseSkills, ["investigation"]);
  assert.deepEqual(current.proficientSaves, ["con"]);
  assert.equal(skillCheckModifier(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    current,
    "int",
    "investigation",
  ), 6);
  assert.equal(savingThrowModifier(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    current,
    "con",
  ), 3);
  assert.deepEqual(
    synchronizePlayerCombatEntity({ ...current, expertiseSkills: ["forged"] }, current)
      .expertiseSkills,
    ["investigation"],
  );

  const forged = structuredClone(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST);
  forged.extensions.find(({ profileId }) =>
    profileId === CHARACTER_PROFICIENCY_PROFILE.profileId).profileHash = `sha256:${"0".repeat(64)}`;
  assert.equal(characterProficiencyFieldsMatchProfile(forged, character), false);
  assert.equal(characterProficiencyFieldsMatchProfile(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    { ...character, expertiseSkills: ["perception"] },
  ), false);
  assert.equal(characterProficiencyFieldsMatchProfile(
    ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
    { ...character, proficientSaves: ["luck"] },
  ), false);
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

test("V3 environment selectors reject ambiguous transitions deterministically", () => {
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

});
