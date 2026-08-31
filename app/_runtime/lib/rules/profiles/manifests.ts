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
import {
  CAUSAL_ACTION_INTERPRETER_PROFILE,
  CAUSAL_ACTION_INTERPRETER_PROFILE_DOCUMENT,
} from "./causal-action-interpreter";
import {
  CHARACTER_PROFICIENCY_PROFILE,
  CHARACTER_PROFICIENCY_PROFILE_DOCUMENT,
} from "./character-proficiency";
import {
  SOCIAL_RESOLUTION_PROFILE,
  SOCIAL_RESOLUTION_PROFILE_DOCUMENT,
} from "./social-resolution";
import {
  NPC_MECHANICS_PROFILE,
  NPC_MECHANICS_PROFILE_DOCUMENT,
} from "./npc-mechanics";
import {
  ITEM_SYSTEM_PROFILE,
  ITEM_SYSTEM_PROFILE_DOCUMENT,
} from "./item-system";
import {
  STANDARD_GEAR_PROFILE,
  STANDARD_GEAR_PROFILE_DOCUMENT,
} from "./standard-gear";

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
export {
  CAUSAL_ACTION_INTERPRETER_PROFILE,
  CAUSAL_ACTION_INTERPRETER_PROFILE_DOCUMENT,
} from "./causal-action-interpreter";
export {
  CHARACTER_PROFICIENCY_PROFILE,
  CHARACTER_PROFICIENCY_PROFILE_DOCUMENT,
} from "./character-proficiency";
export {
  SOCIAL_RESOLUTION_PROFILE,
  SOCIAL_RESOLUTION_PROFILE_DOCUMENT,
} from "./social-resolution";
export {
  NPC_MECHANICS_PROFILE,
  NPC_MECHANICS_PROFILE_DOCUMENT,
} from "./npc-mechanics";
export {
  ITEM_SYSTEM_PROFILE,
  ITEM_SYSTEM_PROFILE_DOCUMENT,
} from "./item-system";
export {
  STANDARD_GEAR_PROFILE,
  STANDARD_GEAR_PROFILE_DOCUMENT,
} from "./standard-gear";

export const RULESET_PROFILE = {
  profileId: "dnd5e-2014-srd5.1-authoritative-v2",
  profileHash: "sha256:bc22610d7a75d9f14ec5a0f2905f3bebcd080d6b66acb180179b50ec42018c78",
} as const satisfies ProfileRef;

export const V5_EVENT_SCHEMA_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "eventSchema",
  profileId: "room-world-events-v2-npc-items-v1",
  semanticVersion: "3.2.0",
  normativePayload: {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    authoritativeEnvelope: "zhuwei.room-world-event/v2",
    eventMutation: "typed-event-fold-only",
    profileBinding: "complete-runtime-manifest",
    moduleBinding: "single-pinned-module-without-migration-events-or-adapters",
    unknownEvent: "reject",
    defaultEventTypeVersion: "1",
    eventTypeVersionOverrides: {
      ItemUsed: "4",
      ResourceSpent: "2",
    },
    versionFourItemUse: "exact-entry-quantity-charge-and-durability-before-after-snapshots-update-the-global-item-authority-and-derived-character-and-combat-projections",
    versionTwoResourceSpend: "exact-item-entry-resource-spend-updates-the-global-item-authority-and-removes-zero-quantity-derived-caches",
    itemAbilityCausality: "every-item-derived-ability-definition-is-registered-before-the-state-event-that-can-activate-its-ref-and-fold-never-compiles-a-missing-definition",
    characterMaterializationAtomicity: "new-character-control-successor-combat-entity-and-frozen-definitions-are-established-by-one-event-before-public-projection",
    eventFamilies: [
      "global-item-definition-registration",
      "global-item-materialization-and-acquisition",
      "global-item-entry-transfer-and-resource-spend",
      "npc-mechanical-definition-registration",
      "npc-mechanical-entity-materialization",
      "npc-gear-change",
      "npc-mechanical-item-state-change",
      "item-transfer-involving-mechanical-npc",
    ],
    replay: "committed-events-only-with-exact-event-type-version-and-no-reroll-or-fallback",
    safetyEvents: "private-principal-owned-pause-and-minimized-presentation-adjustment",
    hiddenRealityEvents: "internal-complete-candidate-freeze-and-selected-only-materialization",
  },
};

export const V5_EVENT_SCHEMA_PROFILE = Object.freeze({
  profileId: V5_EVENT_SCHEMA_PROFILE_DOCUMENT.profileId,
  profileHash: "sha256:1d1d82768da015c40fc15bf5303259ad8a64084aaa6c04637ba913be9d18686a",
}) satisfies ProfileRef;

export const ABILITY_COMPILER_PROFILE = {
  profileId: "ability-srd51-2014-v2",
  profileHash: "sha256:08d7d7e27f001d16543a7fa3edb4328af4fb38be506b35938da169a1ad07eff5",
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

/** Product 0.4's exact per-audience publication contract. */
export const INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE = {
  profileId: "delivery-independent-audience-body-v2",
  profileHash: "sha256:0139e0644e94c45140db12508c6fdd2ca7992cda29c73ee18fc15fa7efc2b703",
} as const satisfies ProfileRef;

const ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_ID =
  "runtime-srd51-2014-authoritative-environment-v5" as const;

export const ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "runtimeManifest",
  profileId: ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_ID,
  semanticVersion: "5.4.0",
  normativePayload: {
    conformanceVersion: "1",
    profileDispatch: "exact-id-and-hash",
    productGeneration: "zhuwei-0.4-v5-only",
    roomGeneration: "v5-only",
    publicInterface: ["step", "project", "replay"],
    ruleset: RULESET_PROFILE,
    eventSchema: V5_EVENT_SCHEMA_PROFILE,
    abilityCompiler: ABILITY_COMPILER_PROFILE,
    geometry: GEOMETRY_PROFILE,
    triggerOrdering: TRIGGER_ORDERING_PROFILE,
    fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
    extensions: [
      COMBAT_PROFILE,
      DAMAGE_DEATH_PROFILE,
      PRESENTATION_POLICY_PROFILE,
      PROJECTION_POLICY_PROFILE,
      INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
      CAUSAL_ACTION_INTERPRETER_PROFILE,
      ENVIRONMENT_PROFILE,
      CHARACTER_PROFICIENCY_PROFILE,
      SOCIAL_RESOLUTION_PROFILE,
      ITEM_SYSTEM_PROFILE,
      STANDARD_GEAR_PROFILE,
      NPC_MECHANICS_PROFILE,
    ],
  },
};

export const ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE = Object.freeze({
  profileId: ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_ID,
  profileHash: "sha256:31dee484a8dac893c87758ec5999aa65adbdd4fd571c8baea2e760bbba9fcbc9",
}) satisfies ProfileRef;

/** Product 0.4's only registered runtime manifest. */
export const ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST = {
  manifest: ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE,
  ruleset: RULESET_PROFILE,
  eventSchema: V5_EVENT_SCHEMA_PROFILE,
  abilityCompiler: ABILITY_COMPILER_PROFILE,
  geometry: GEOMETRY_PROFILE,
  triggerOrdering: TRIGGER_ORDERING_PROFILE,
  fictionCombatTime: FICTION_COMBAT_TIME_PROFILE,
  extensions: [
    COMBAT_PROFILE,
    DAMAGE_DEATH_PROFILE,
    PRESENTATION_POLICY_PROFILE,
    PROJECTION_POLICY_PROFILE,
    INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    CAUSAL_ACTION_INTERPRETER_PROFILE,
    ENVIRONMENT_PROFILE,
    CHARACTER_PROFICIENCY_PROFILE,
    SOCIAL_RESOLUTION_PROFILE,
    ITEM_SYSTEM_PROFILE,
    STANDARD_GEAR_PROFILE,
    NPC_MECHANICS_PROFILE,
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
  "2.3.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    rulesBasis: "srd5.1-2014",
    publicInterface: ["step", "project", "replay"],
    profileDispatch: "exact-id-and-hash",
    randomnessAuthority: "room-durable-object",
    retiredInputPolicy: "pre-0.4-inputs-reject-without-adapter-migration-or-fallback",
    contentSafety: "principal-owned-immediate-stable-pause-without-fiction-or-mechanical-advance",
    hiddenReality: "kp-complete-candidate-set-validated-before-do-weighted-selection-and-atomic-materialization",
  },
);
export const ABILITY_COMPILER_PROFILE_DOCUMENT = profileDocument(
  "abilityCompiler",
  ABILITY_COMPILER_PROFILE.profileId,
  "2.0.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    input: "AbilityDefinition",
    output: "private-bounded-MechanicOp-graph",
    mechanicOpFamilies: [
      "Guard",
      "Choice",
      "Cost",
      "Grant",
      "Random",
      "Damage",
      "Recovery",
      "Effect",
      "Spatial",
      "Item",
      "Resource",
      "Entity",
      "Encounter",
      "Activity",
      "Time",
      "Evidence",
      "Knowledge",
      "Trigger",
    ],
    itemCostAuthority: {
      kind: "item",
      resourceId: "item-entry:<non-empty-entry-id>",
      amountAndOptionalCounters: "canonical-non-negative-integer-strings",
      optionalCounters: ["chargeCost", "durabilityCost"],
      duplicateExactEntrySpend: "reject",
      genericItemResource: "reject",
      retiredItemChargeKind: "reject",
    },
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
export const INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE_DOCUMENT = profileDocument(
  "deliveryProtocol",
  INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE.profileId,
  "2.0.0",
  {
    conformanceVersion: "1",
    spec: "SPEC 0015",
    crossSpec: "SPEC 0010",
    narrationInput: "exact-non-empty-body-only",
    audiencePublication: "independent-persisted-generation-per-frozen-audience",
    retry: "unfinished-audiences-only-without-proposal-commit-or-randomness-repeat",
    metadataAuthority: "server-derived-from-frozen-projection-and-committed-delta",
    slot: "one-current-frame-per-viewer-key",
    acknowledgement: "body-unavailable-after-ack",
    ordinaryRestart: "restore-current-slot-and-audience-publication-journal",
    archiveRebuild: "do-not-reconstruct-old-frame",
    realTimeEffect: "no-fiction-time-advance",
    safetyPause: "supersede-current-slots-and-open-publication-capabilities-before-observe",
  },
);
export const CANONICAL_PROFILE_DOCUMENTS = [
  {
    ref: ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE,
    document: ENVIRONMENT_V5_RUNTIME_MANIFEST_PROFILE_DOCUMENT,
  },
  { ref: RULESET_PROFILE, document: RULESET_PROFILE_DOCUMENT },
  { ref: V5_EVENT_SCHEMA_PROFILE, document: V5_EVENT_SCHEMA_PROFILE_DOCUMENT },
  { ref: ABILITY_COMPILER_PROFILE, document: ABILITY_COMPILER_PROFILE_DOCUMENT },
  { ref: GEOMETRY_PROFILE, document: GEOMETRY_PROFILE_DOCUMENT },
  { ref: TRIGGER_ORDERING_PROFILE, document: TRIGGER_ORDERING_PROFILE_DOCUMENT },
  { ref: FICTION_COMBAT_TIME_PROFILE, document: FICTION_COMBAT_TIME_PROFILE_DOCUMENT },
  { ref: COMBAT_PROFILE, document: COMBAT_PROFILE_DOCUMENT },
  { ref: DAMAGE_DEATH_PROFILE, document: DAMAGE_DEATH_PROFILE_DOCUMENT },
  { ref: PRESENTATION_POLICY_PROFILE, document: PRESENTATION_POLICY_PROFILE_DOCUMENT },
  { ref: PROJECTION_POLICY_PROFILE, document: PROJECTION_POLICY_PROFILE_DOCUMENT },
  {
    ref: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    document: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE_DOCUMENT,
  },
  {
    ref: CAUSAL_ACTION_INTERPRETER_PROFILE,
    document: CAUSAL_ACTION_INTERPRETER_PROFILE_DOCUMENT,
  },
  {
    ref: CHARACTER_PROFICIENCY_PROFILE,
    document: CHARACTER_PROFICIENCY_PROFILE_DOCUMENT,
  },
  {
    ref: SOCIAL_RESOLUTION_PROFILE,
    document: SOCIAL_RESOLUTION_PROFILE_DOCUMENT,
  },
  {
    ref: ITEM_SYSTEM_PROFILE,
    document: ITEM_SYSTEM_PROFILE_DOCUMENT,
  },
  {
    ref: STANDARD_GEAR_PROFILE,
    document: STANDARD_GEAR_PROFILE_DOCUMENT,
  },
  {
    ref: NPC_MECHANICS_PROFILE,
    document: NPC_MECHANICS_PROFILE_DOCUMENT,
  },
  { ref: ENVIRONMENT_PROFILE, document: ENVIRONMENT_PROFILE_DOCUMENT },
] as const;

/** Golden seam: every Registry ref must be the hash of its canonical Profile bytes. */
export function profileRegistryMatchesCanonicalDocuments(): boolean {
  return CANONICAL_PROFILE_DOCUMENTS.every(
    ({ ref, document }) => canonicalSha256(document) === ref.profileHash,
  );
}
