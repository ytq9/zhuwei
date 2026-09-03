import { canonicalSha256 } from "./canonical";
import {
  ABILITY_COMPILER_PROFILE,
  CHARACTER_PROFICIENCY_PROFILE,
  COMBAT_PROFILE,
  DAMAGE_DEATH_PROFILE,
  FICTION_COMBAT_TIME_PROFILE,
  GEOMETRY_PROFILE,
  INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
  ITEM_SYSTEM_PROFILE,
  NPC_MECHANICS_PROFILE,
  PRESENTATION_POLICY_PROFILE,
  PROJECTION_POLICY_PROFILE,
  RULESET_PROFILE,
  STANDARD_GEAR_PROFILE,
  TRIGGER_ORDERING_PROFILE,
} from "./manifests";
import { SOCIAL_RESOLUTION_PROFILE } from "./social-resolution";
import { WORLD_DAMAGE_PROFILE_REGISTRY } from "./world-interaction-registry";
import type {
  CanonicalProfileDocument,
  ProfileRef,
  RuntimeProfileManifest,
  Sha256Ref,
} from "./types";

function profileRef(document: CanonicalProfileDocument): ProfileRef {
  return Object.freeze({
    profileId: document.profileId,
    profileHash: canonicalSha256(document) as Sha256Ref,
  });
}

export const WORLD_INTERACTION_PROFILE_DOCUMENT: CanonicalProfileDocument = Object.freeze({
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "worldInteraction",
  profileId: "world-interaction-kp-ruling-v1",
  semanticVersion: "1.0.0",
  normativePayload: Object.freeze({
    spec: "SPEC 0016",
    formBoundary: "world-interaction.vnext-1",
    narrativeAuthority: "kp-decides-feasibility-dc-risk-and-causal-branches-from-required-context",
    mechanicalAuthority: "rules-validates-permission-resources-range-randomness-and-finite-effects",
    semanticDefinitionMutation: "sparse-operations-compose-one-complete-next-definition-before-step",
    materialModel: "simple-dnd5e-2014-material-description-without-engineering-thresholds",
    relationKinds: Object.freeze(["supports", "attachedTo", "contains", "blocks", "triggers"]),
    registeredHazards: Object.freeze(Object.entries(WORLD_DAMAGE_PROFILE_REGISTRY)
      .map(([profileRef, profile]) => Object.freeze({
        profileRef,
        targetResolver: profile.targetResolver,
        effect: Object.freeze({
          kind: "fixedDamage",
          amount: profile.amount,
          damageType: profile.damageType,
        }),
      }))),
    forbidden: Object.freeze([
      "model-supplied-dice",
      "model-supplied-json-patch",
      "rules-material-name-physics-ruling",
      "parallel-v5-fallback",
    ]),
  }),
});

export const WORLD_INTERACTION_PROFILE = profileRef(WORLD_INTERACTION_PROFILE_DOCUMENT);

export const VNEXT_STAGE3_EVENT_SCHEMA_PROFILE_DOCUMENT: CanonicalProfileDocument = Object.freeze({
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "eventSchema",
  profileId: "room-world-events-vnext-stage3-v1",
  semanticVersion: "1.0.0",
  normativePayload: Object.freeze({
    spec: "SPEC 0016",
    authoritativeEnvelope: "zhuwei.room-world-event/v2",
    defaultEventTypeVersion: "1",
    additions: Object.freeze([
      "AtomicWorldInteractionStepsResolved",
      "SemanticDefinitionMaterialized",
      "SemanticDefinitionRevised",
      "WorldInteractionFeasibilityRuled",
      "WorldInteractionResolved",
    ]),
    replay: "complete-next-definitions-and-typed-results-only",
  }),
});

export const VNEXT_STAGE3_EVENT_SCHEMA_PROFILE = profileRef(
  VNEXT_STAGE3_EVENT_SCHEMA_PROFILE_DOCUMENT,
);

const VNEXT_STAGE3_EXTENSIONS = Object.freeze([
  COMBAT_PROFILE,
  DAMAGE_DEATH_PROFILE,
  PRESENTATION_POLICY_PROFILE,
  PROJECTION_POLICY_PROFILE,
  INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
  CHARACTER_PROFICIENCY_PROFILE,
  ITEM_SYSTEM_PROFILE,
  STANDARD_GEAR_PROFILE,
  NPC_MECHANICS_PROFILE,
  SOCIAL_RESOLUTION_PROFILE,
  WORLD_INTERACTION_PROFILE,
]);

export const VNEXT_STAGE3_RUNTIME_MANIFEST_PROFILE_DOCUMENT: CanonicalProfileDocument =
  Object.freeze({
    schema: "zhuwei.runtime-profile/v1",
    profileKind: "runtimeManifest",
    profileId: "runtime-srd51-2014-authoritative-vnext-stage3",
    semanticVersion: "1.0.0",
    normativePayload: Object.freeze({
      spec: "SPEC 0016",
      productGeneration: "zhuwei-0.4-vnext-isolated-stage3",
      productionDefault: false,
      publicInterface: Object.freeze(["step", "project", "replay"]),
      ruleset: RULESET_PROFILE,
      eventSchema: VNEXT_STAGE3_EVENT_SCHEMA_PROFILE,
      abilityCompiler: ABILITY_COMPILER_PROFILE,
      geometry: GEOMETRY_PROFILE,
      triggerOrdering: TRIGGER_ORDERING_PROFILE,
      fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
      extensions: VNEXT_STAGE3_EXTENSIONS,
    }),
  });

export const VNEXT_STAGE3_RUNTIME_MANIFEST_PROFILE = profileRef(
  VNEXT_STAGE3_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
);

export const VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST: RuntimeProfileManifest = Object.freeze({
  manifest: VNEXT_STAGE3_RUNTIME_MANIFEST_PROFILE,
  ruleset: RULESET_PROFILE,
  eventSchema: VNEXT_STAGE3_EVENT_SCHEMA_PROFILE,
  abilityCompiler: ABILITY_COMPILER_PROFILE,
  geometry: GEOMETRY_PROFILE,
  triggerOrdering: TRIGGER_ORDERING_PROFILE,
  fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
  extensions: [...VNEXT_STAGE3_EXTENSIONS],
});

export function worldInteractionProfileEnabled(
  extensions: readonly ProfileRef[],
): boolean {
  return extensions.some((extension) =>
    extension.profileId === WORLD_INTERACTION_PROFILE.profileId
    && extension.profileHash === WORLD_INTERACTION_PROFILE.profileHash);
}
