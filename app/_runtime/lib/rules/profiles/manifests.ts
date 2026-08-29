import { canonicalSha256 } from "./canonical";
import type {
  CanonicalProfileDocument,
  ProfileRef,
  RuntimeProfileManifest,
} from "./types";
import {
  TRIGGER_ORDERING_PROFILE,
  TRIGGER_ORDERING_PROFILE_DOCUMENT,
} from "./trigger-ordering";
import {
  FICTION_COMBAT_TIME_PROFILE,
  FICTION_COMBAT_TIME_PROFILE_DOCUMENT,
} from "./fiction-time";
import {
  ENVIRONMENT_PROFILE,
  ENVIRONMENT_PROFILE_DOCUMENT,
} from "./environment";

export {
  TRIGGER_ORDERING_PROFILE,
  TRIGGER_ORDERING_PROFILE_DOCUMENT,
} from "./trigger-ordering";
export {
  FICTION_COMBAT_TIME_PROFILE,
  FICTION_COMBAT_TIME_PROFILE_DOCUMENT,
} from "./fiction-time";
export {
  ENVIRONMENT_PROFILE,
  ENVIRONMENT_PROFILE_DOCUMENT,
} from "./environment";

export const RULESET_PROFILE = {
  profileId: "dnd5e-2014-srd5.1-authoritative-v2",
  profileHash: "sha256:7651d58190da6bfb6241cabb41b07ef5cfee3266edf3c62b8af443d94daf4af0",
} as const satisfies ProfileRef;

export const EVENT_SCHEMA_PROFILE = {
  profileId: "room-world-events-v2",
  profileHash: "sha256:3f1d953752be8981f4f7862ba1a90d6f613d113ecfd2d18dfd983abf974a8a67",
} as const satisfies ProfileRef;

export const ABILITY_COMPILER_PROFILE = {
  profileId: "ability-srd51-2014-v1",
  profileHash: "sha256:561710d6ae32fc14f0ba22863e0d6cd92d12c6d32b8728a81608561a66b25ba3",
} as const satisfies ProfileRef;

export const GEOMETRY_PROFILE = {
  profileId: "geometry-2d-feet-2014-v1",
  profileHash: "sha256:59caa4e73c58dc20a92cd9b50370f2c9b275a9b57740c7dd1d519f78cb72611e",
} as const satisfies ProfileRef;

export const COMBAT_PROFILE = {
  profileId: "combat-srd51-2014-v1",
  profileHash: "sha256:b9e12294db25409844e1ecd63d048e404b315ecfcd8c493cd6af5cb593e4acc6",
} as const satisfies ProfileRef;

export const DAMAGE_DEATH_PROFILE = {
  profileId: "damage-death-srd51-2014-v1",
  profileHash: "sha256:37dbf131c6325f2f07e3693ee8c3420372c8d7f9154a757dfafdc6f853537d7a",
} as const satisfies ProfileRef;

export const PRESENTATION_POLICY_PROFILE = {
  profileId: "presentation-observer-specific-v1",
  profileHash: "sha256:86bfdfebe7062d90f87e4add65d1d109cb14dead7b3d758e452af76c13f7457c",
} as const satisfies ProfileRef;

export const PROJECTION_POLICY_PROFILE = {
  profileId: "projection-observer-safe-v1",
  profileHash: "sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91",
} as const satisfies ProfileRef;

export const DELIVERY_PROTOCOL_PROFILE = {
  profileId: "delivery-single-current-frame-v1",
  profileHash: "sha256:cd0d684841bd43f621665dc538db35b81c25421d8b345e444681054bbc894d7e",
} as const satisfies ProfileRef;

export const MANIFEST_PROFILE = {
  profileId: "runtime-srd51-2014-authoritative-v2",
  profileHash: "sha256:496da17f16d52cbe5dfa3e97facfa8ed7dcf3f4bbb7a882fc0e384d464898051",
} as const satisfies ProfileRef;

export const ENVIRONMENT_RUNTIME_MANIFEST_PROFILE = {
  profileId: "runtime-srd51-2014-authoritative-environment-v1",
  profileHash: "sha256:545e80e94c81222616e4e58d9c54cc3bf6c6e4ff5abae7a2fa130d5232064c1e",
} as const satisfies ProfileRef;

export const CURRENT_RUNTIME_PROFILE_MANIFEST = {
  manifest: MANIFEST_PROFILE,
  ruleset: RULESET_PROFILE,
  eventSchema: EVENT_SCHEMA_PROFILE,
  abilityCompiler: ABILITY_COMPILER_PROFILE,
  geometry: GEOMETRY_PROFILE,
  triggerOrdering: TRIGGER_ORDERING_PROFILE,
  fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
  extensions: [
    COMBAT_PROFILE,
    DAMAGE_DEATH_PROFILE,
    PRESENTATION_POLICY_PROFILE,
    PROJECTION_POLICY_PROFILE,
    DELIVERY_PROTOCOL_PROFILE,
  ],
} as const satisfies RuntimeProfileManifest;

/**
 * Explicit opt-in manifest for the dynamic environment primitive. The shipped
 * v2 manifest remains byte-for-byte addressable and stays the registry default
 * until Room wiring deliberately selects this generation for a new epoch.
 */
export const ENVIRONMENT_RUNTIME_PROFILE_MANIFEST = {
  manifest: ENVIRONMENT_RUNTIME_MANIFEST_PROFILE,
  ruleset: RULESET_PROFILE,
  eventSchema: EVENT_SCHEMA_PROFILE,
  abilityCompiler: ABILITY_COMPILER_PROFILE,
  geometry: GEOMETRY_PROFILE,
  triggerOrdering: TRIGGER_ORDERING_PROFILE,
  fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
  extensions: [
    COMBAT_PROFILE,
    DAMAGE_DEATH_PROFILE,
    PRESENTATION_POLICY_PROFILE,
    PROJECTION_POLICY_PROFILE,
    DELIVERY_PROTOCOL_PROFILE,
    ENVIRONMENT_PROFILE,
  ],
} as const satisfies RuntimeProfileManifest;

function profileDocument(
  profileKind: string,
  profileId: string,
  semanticVersion: string,
  normativePayload: Readonly<Record<string, unknown>>,
): CanonicalProfileDocument {
  return {
    schema: "zhuwei.runtime-profile/v1",
    profileKind,
    profileId,
    semanticVersion,
    normativePayload,
  };
}

export const RULESET_PROFILE_DOCUMENT = profileDocument(
  "ruleset",
  RULESET_PROFILE.profileId,
  "2.2.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    rulesBasis: "srd5.1-2014",
    publicInterface: ["step", "project", "replay"],
    profileDispatch: "exact-id-and-hash",
    randomnessAuthority: "room-durable-object",
    legacyInterpretation: "explicit-adapter-only",
    contentSafety: "principal-owned-immediate-stable-pause-without-fiction-or-mechanical-advance",
    hiddenReality: "kp-complete-candidate-set-validated-before-do-weighted-selection-and-atomic-materialization",
  },
);
export const EVENT_SCHEMA_PROFILE_DOCUMENT = profileDocument(
  "eventSchema",
  EVENT_SCHEMA_PROFILE.profileId,
  "2.4.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    authoritativeEnvelope: "room-world-events-v2",
    eventMutation: "typed-event-fold-only",
    encounterConclusionPayload: "legacy-three-field-or-canonical-residual-phase-tasks",
    hostilityChangePayload: "encounter-source-outgoing-target-set-with-causal-predecessor",
    concentrationAuditPayload: "one-tested-event-per-authoritative-save-cause",
    temporaryHitPointsPayload: "higher-value-only-without-hit-point-healing",
    stableRecoveryLifecycle: "activity-start-interrupt-complete-before-one-hit-point-healing",
    residualPhaseTaskFold: "encounter-owned-idempotent-effect-expiry",
    profileBinding: "complete-runtime-manifest",
    replay: "committed-events-only-no-reroll",
    unknownEvent: "reject",
    safetyEvents: "private-principal-owned-pause-and-minimized-presentation-adjustment",
    hiddenRealityEvents: "internal-complete-candidate-freeze-and-selected-only-materialization",
  },
);
export const ABILITY_COMPILER_PROFILE_DOCUMENT = profileDocument(
  "abilityCompiler",
  ABILITY_COMPILER_PROFILE.profileId,
  "1.1.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    input: "AbilityDefinition",
    output: "private-bounded-MechanicOp-graph",
    derivedRecoveryOperations: ["healing", "temporary-hit-points-higher-value-only"],
    callerMechanicOps: "reject",
    acceptedRulesBasis: ["srd5.1-2014", "zhuwei-product-ruling-with-profile-ref"],
    forbiddenSemantics: ["dnd2024", "5.5e", "latest", "weapon-mastery"],
  },
);
export const GEOMETRY_PROFILE_DOCUMENT = profileDocument(
  "geometry",
  GEOMETRY_PROFILE.profileId,
  "1.0.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    spaceModel: "two-horizontal-dimensions-plus-independent-height",
    authorityUnit: "integer-inch",
    distance: "measurement-core-euclidean-squared",
    occupancy: "axis-aligned-prism",
    coverSampleCount: "64",
    areaSampleCount: "65",
  },
);
export const COMBAT_PROFILE_DOCUMENT = profileDocument(
  "combat",
  COMBAT_PROFILE.profileId,
  "1.2.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    rulesBasis: "srd5.1-2014",
    mechanics: ["encounter", "turn", "reaction", "spell", "damage", "death"],
    hostilityRelation: "directed-source-to-target-set-event-fold-only",
    concentration: "one-save-after-each-positive-applied-damage-source-or-frozen-environment-dc10",
    longSpellcasting: "activity-plus-round-action-investment-and-concentration-cost-on-completion",
    encounterConclusion: "all-living-player-consent-after-pending-randomness-and-phase-settlement",
    playerChoice: "never-default-target-or-option",
    randomness: "room-durable-object-only",
  },
);
export const DAMAGE_DEATH_PROFILE_DOCUMENT = profileDocument(
  "damageDeath",
  DAMAGE_DEATH_PROFILE.profileId,
  "1.1.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    rulesBasis: "srd5.1-2014",
    damageApplication: "immunity-resistance-vulnerability-round-down",
    temporaryHitPoints: "absorb-before-hit-points-never-heal-or-revive",
    zeroHp: "2014-unconscious-and-death-saves",
    instantDeath: "remaining-damage-at-least-max-hp",
    nonlethalMelee: "controller-choice-before-instant-death-commits-stable-unconscious",
    stableRecovery: "medicine-or-three-successes-start-authoritative-one-d4-hour-activity",
    npcDeathDecision: "kp-using-finite-knowledge",
  },
);
export const PRESENTATION_POLICY_PROFILE_DOCUMENT = profileDocument(
  "presentationPolicy",
  PRESENTATION_POLICY_PROFILE.profileId,
  "1.1.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    crossSpec: "SPEC 0010",
    narrativeSource: "committed-viewer-projection",
    kpAgency: "describe-results-and-return-decision",
    playerAgency: "never-invent-player-choice-speech-belief",
    historyPolicy: "no-complete-kp-narration-history",
    secretScope: "current-viewer-only",
    safetyPause: "withdraw-current-presentation-and-never-publish-late-sensitive-narration",
  },
);
export const PROJECTION_POLICY_PROFILE_DOCUMENT = profileDocument(
  "projectionPolicy",
  PROJECTION_POLICY_PROFILE.profileId,
  "1.3.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    crossSpec: "SPEC 0010",
    viewerIdentity: "trusted-principal-and-character-control",
    audience: "fictionally-present-and-authorized",
    readPaths: "single-projector",
    successorLifecycle: "trusted-active-seat-former-character-minimal-view",
    mechanicalCandidates: "rest-recovery-options-derived-by-rules-projector",
    controlledActivities: "visible-to-controller-even-without-campaign-metadata",
    kpSpatialEvidence: "service-capability-only-not-player-npc-or-public-error",
    unauthorizedResponse: "indistinguishable-safe-error",
    narrationHistory: "excluded",
    contentSafety: "principal-owned-private-across-character-control-and-successor-tenure",
  },
);
export const DELIVERY_PROTOCOL_PROFILE_DOCUMENT = profileDocument(
  "deliveryProtocol",
  DELIVERY_PROTOCOL_PROFILE.profileId,
  "1.1.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    crossSpec: "SPEC 0010",
    slot: "one-current-frame-per-viewer-key",
    retry: "same-delivery-id-before-ack-or-supersede",
    acknowledgement: "body-unavailable-after-ack",
    ordinaryRestart: "restore-current-durable-object-slot",
    archiveRebuild: "do-not-reconstruct-old-frame",
    realTimeEffect: "no-fiction-time-advance",
    safetyPause: "supersede-current-slots-and-open-publication-capabilities-before-observe",
  },
);
export const MANIFEST_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "runtimeManifest",
  profileId: MANIFEST_PROFILE.profileId,
  semanticVersion: "2.1.0",
  normativePayload: {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    crossSpec: "SPEC 0010 XR-06",
    profileDispatch: "exact-id-and-hash",
    observerPolicyClosure: "presentation-projection-delivery-required",
    ruleset: RULESET_PROFILE,
    eventSchema: EVENT_SCHEMA_PROFILE,
    abilityCompiler: ABILITY_COMPILER_PROFILE,
    geometry: GEOMETRY_PROFILE,
    triggerOrdering: TRIGGER_ORDERING_PROFILE,
    fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
    extensions: [
      COMBAT_PROFILE,
      DAMAGE_DEATH_PROFILE,
      PRESENTATION_POLICY_PROFILE,
      PROJECTION_POLICY_PROFILE,
      DELIVERY_PROTOCOL_PROFILE,
    ],
  },
};

export const ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "runtimeManifest",
  profileId: ENVIRONMENT_RUNTIME_MANIFEST_PROFILE.profileId,
  semanticVersion: "1.0.0",
  normativePayload: {
    conformanceVersion: "1",
    profileDispatch: "exact-id-and-hash",
    compatibility: "authoritative-v2-plus-explicit-environment-feature-fsm-v1",
    publicInterface: ["step", "project", "replay"],
    ruleset: RULESET_PROFILE,
    eventSchema: EVENT_SCHEMA_PROFILE,
    abilityCompiler: ABILITY_COMPILER_PROFILE,
    geometry: GEOMETRY_PROFILE,
    triggerOrdering: TRIGGER_ORDERING_PROFILE,
    fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
    extensions: [
      COMBAT_PROFILE,
      DAMAGE_DEATH_PROFILE,
      PRESENTATION_POLICY_PROFILE,
      PROJECTION_POLICY_PROFILE,
      DELIVERY_PROTOCOL_PROFILE,
      ENVIRONMENT_PROFILE,
    ],
  },
};

export const CANONICAL_PROFILE_DOCUMENTS = [
  { ref: MANIFEST_PROFILE, document: MANIFEST_PROFILE_DOCUMENT },
  {
    ref: ENVIRONMENT_RUNTIME_MANIFEST_PROFILE,
    document: ENVIRONMENT_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  },
  { ref: RULESET_PROFILE, document: RULESET_PROFILE_DOCUMENT },
  { ref: EVENT_SCHEMA_PROFILE, document: EVENT_SCHEMA_PROFILE_DOCUMENT },
  { ref: ABILITY_COMPILER_PROFILE, document: ABILITY_COMPILER_PROFILE_DOCUMENT },
  { ref: GEOMETRY_PROFILE, document: GEOMETRY_PROFILE_DOCUMENT },
  { ref: TRIGGER_ORDERING_PROFILE, document: TRIGGER_ORDERING_PROFILE_DOCUMENT },
  { ref: FICTION_COMBAT_TIME_PROFILE, document: FICTION_COMBAT_TIME_PROFILE_DOCUMENT },
  { ref: COMBAT_PROFILE, document: COMBAT_PROFILE_DOCUMENT },
  { ref: DAMAGE_DEATH_PROFILE, document: DAMAGE_DEATH_PROFILE_DOCUMENT },
  { ref: PRESENTATION_POLICY_PROFILE, document: PRESENTATION_POLICY_PROFILE_DOCUMENT },
  { ref: PROJECTION_POLICY_PROFILE, document: PROJECTION_POLICY_PROFILE_DOCUMENT },
  { ref: DELIVERY_PROTOCOL_PROFILE, document: DELIVERY_PROTOCOL_PROFILE_DOCUMENT },
  { ref: ENVIRONMENT_PROFILE, document: ENVIRONMENT_PROFILE_DOCUMENT },
] as const;

/** Golden seam: every Registry ref must be the hash of its canonical Profile bytes. */
export function profileRegistryMatchesCanonicalDocuments(): boolean {
  return CANONICAL_PROFILE_DOCUMENTS.every(
    ({ ref, document }) => canonicalSha256(document) === ref.profileHash,
  );
}
