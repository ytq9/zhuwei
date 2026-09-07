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
import { VNEXT_SEMANTIC_MATERIALIZATION_FIELDS, VNEXT_SEMANTIC_TEMPLATE_CATALOG_HASH } from "./semantic-templates";
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
  semanticVersion: "1.1.0",
  normativePayload: Object.freeze({
    spec: "SPEC 0016",
    formBoundary: "world-interaction.vnext-1",
    narrativeAuthority: "kp-decides-feasibility-dc-risk-and-causal-branches-from-required-context",
    observation: Object.freeze({
      form: "observe.vnext-1", knowledge: "separate-sensory-and-inference-events-through-shared-rules",
      inferenceSources: "held-knowledge-record-hash-or-same-outcome-sensory-index-for-actor",
      preflight: "all-branches-before-randomness-including-atomic-paused-paths",
      persistence: "zhuwei.character-inference/v1-conclusion-and-confidence-preserved",
      outcome: "WorldInteractionResolved-observation-true-with-typed-observe-claim-never-physical-interaction",
      scope: "private-holder-no-world-truth-no-forced-belief-no-automatic-time-cost",
    }),
    timePassage: Object.freeze({
      terminal: "passTime-positive-safe-integer-microseconds-with-original-frozen-player-method",
      activity: "frozen-readset-and-source-timeline-no-precreated-sensory-evidence-or-completion-effects",
      advance: "independent-authoritative-roots-to-earliest-live-activity-actor-plan-or-effect-deadline-before-resuming",
      interruption: "actual-death-incapacitation-encounter-or-location-change-with-authoritative-ended-time",
      blocking: "unsupported-or-invalid-deadlines-retain-active-activity-as-technical-pending-with-no-fictional-interruption",
      replay: "same-live-descriptor-and-deadline-validation-on-fold-with-no-duplicate-time",
      projection: "owner-lifecycle-only-no-method-readset-or-future-plan",
    }),
    npcActorPlanFormation: Object.freeze({
      form: "objective-continuity.vnext-1",
      source: "timer-only-own-self-identity-held-knowledge-and-existing-relationships-promises-debts",
      authority: "original-frozen-premises-and-resource-domains-validated-before-atomic-prefix-rebinding",
      faction: "acting-member-and-complete-existing-faction-resource-domain",
      commit: "same-formation-drafts-and-replay-state-guard-for-atomic-and-continued-command",
      effects: "private-plan-plus-activity-no-immediate-time-resource-or-future-trace",
      execution: "existing-due-queue-with-scene-perceptible-trace-and-explicit-alternate-target-no-automatic-fallback",
      claims: "verified-private-formation-family-yields-zero-public-claims-mixed-real-events-preserved",
      deferred: "no-same-bundle-new-social-basis-or-future-trigger-subscription-or-complete-autonomous-loop",
    }),
    knowledgeReview: Object.freeze({
      operation: "knowledgeReview", event: "KnowledgeReviewed",
      selection: "complete-frozen-holder-catalog-with-versioned-records-all-or-kp-selected",
      authority: "held-record-content-only-never-dereference-hidden-source",
      effects: "private-receipt-and-claims-no-knowledge-time-resource-randomness-danger-or-spotlight-change",
    }),
    knowledgeAcquisition: Object.freeze({
      sourceClaims: "origin-private-recipient-content-only-no-authority-text-or-identity-refill",
      exactSharing: "held-record-content-layer-kind-and-provenance-with-private-recipient-replay-validation",
      claims: "pure-acquisition-roots-and-vnext-branches-use-recipient-event-with-attributed-unverified-source",
      identities: "source-attribution-never-grants-targets-hidden-properties-or-mechanics",
    }),
    socialCommitments: Object.freeze({
      events: "RelationshipChanged-PromiseMade-DebtIncurred-with-closed-payload-and-real-participants",
      identity: "stable-relationship-participant-set-and-unique-promise-debt-identity",
      authority: "basis-facts-and-provenance-remain-private-no-physical-effect-from-promising",
      receipt: "subjects-derived-from-the-typed-participants-for-projection-and-correction",
      claims: "pure-domain-roots-or-existing-vnext-root-with-precise-event-grant-and-participant-refs",
      expression: "typed-relationship-change-or-directed-unfulfilled-obligation-and-condition",
    }),
    worldFactMemory: Object.freeze({
      truth: "immutable-definition-body-with-pinned-canonical-instance-and-holder-acquisition-links",
      consistency: "kp-same-call-semantic-judgment-over-frozen-scope-membership-identity-facts-and-anchors-not-hash-as-semantic-proof",
      timing: "unconditional-history-frozen-before-randomness-checked-through-final-settlement-no-listener-truth-from-speech",
      social: "explicit-producer-consumption-only-authorized-npc-memory-extension-with-source-plan-replay-validation",
    }),
    socialInteraction: Object.freeze({
      form: "social.vnext-1", plan: "zhuwei.social-interaction/vnext-1",
      decision: "exact-rules-npc-projection-with-holder-namespaced-knowledge-and-frozen-record-bindings",
      evidenceRefs: "selected-npc-knowledge-id-or-qualified-record-resolves-to-the-same-fully-loaded-holder-entry",
      initialization: "pinned-module-npcs-bound-to-genesis-semantic-identities-with-own-label-background-goals-behavioral-constraints-and-initial-unknowns",
      expression: "original-player-expression-and-frozen-npc-speech-or-silence-with-private-motive",
      scope: "immediate-spoken-conversation-with-server-derived-hearing-participants-or-scene-listeners",
      preflight: "both-response-and-consequence-branches-before-shared-randomness",
      settlement: "private-self-contained-plan-and-resolution-bound-ordered-child-audit-with-actual-source-event-provenance-no-marker-omission-or-outcome-downgrade",
      check: "frozen-modifier-and-actual-committed-dice-bound-to-the-same-continuation-root-and-branch",
      continuity: "versioned-private-conversation-retry-baseline-and-domain-correction",
      ownClaimMemory: "npc-decision-viewer-receives-own-frozen-source-basis-motive-and-time-never-other-speakers-or-public-listeners",
      projection: "typed-social-outcome-and-actual-source-claims-no-private-rationale-or-npc-access-to-unspoken-player-goal",
    }),
    narrativeCommitments: Object.freeze({
      schema: "zhuwei.narrative-detail/vnext-1",
      operation: "commitNarrativeDetail",
      authority: "immutable-nonmechanical-room-commitment-before-viewer-publication",
      grounding: "narrativeDetail-claim-carries-original-description-no-free-text-mechanical-effects",
      materialization: "frozen-intent-obligations-bind-original-scene-description-and-audience-before-use",
      persistence: "canonical-fact-with-separate-materialization-binding-and-replay",
      visibility: "frozen-scene-observers-or-actor-only-server-derived-materialization-policy",
    }),
    mechanicalAuthority: "rules-validates-permission-resources-range-randomness-and-finite-effects",
    semanticDefinitionMutation: "sparse-operations-compose-one-complete-next-definition-before-step",
    npcRevisionBasis: "exact-holder-knowledge-record-or-npc-known-authority-fact-never-another-holders-same-raw-id",
    activityProjection: "holder-lifecycle-fields-only-no-completion-recovery-choice-interruption-cause-or-uncommitted-knowledge",
    semanticMaterialization: Object.freeze({
      templateCatalogHash: VNEXT_SEMANTIC_TEMPLATE_CATALOG_HASH,
      overrideFieldsByKind: VNEXT_SEMANTIC_MATERIALIZATION_FIELDS,
      authority: "exact-static-template-plus-allowed-overrides-never-existence-or-permission",
    }),
    materialModel: "simple-dnd5e-2014-material-description-without-engineering-thresholds",
    itemAuthority: Object.freeze({
      metadataSchema: "zhuwei.vnext-item-authority/v1",
      uniqueness: "existing-authorized-canonical-source-binds-one-nonstackable-entry-and-permanent-tombstone",
      identification: "exact-definition-hash-knowledge-per-character-independent-of-possession",
      itemWire: "optional-uniquenessBasisRef-and-inventory-identify",
      viewer: "opaque-item-shell-until-definition-policy-or-typed-identification-grants-mechanics",
    }),
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
  semanticVersion: "1.1.0",
  normativePayload: Object.freeze({
    spec: "SPEC 0016",
    authoritativeEnvelope: "zhuwei.room-world-event/v2",
    defaultEventTypeVersion: "1",
    additions: Object.freeze([
      "KnowledgeReviewed",
      "NarrativeDetailCommitted",
      "NarrativeDetailMaterialized",
      "ItemUniquenessBound",
      "ItemIdentified",
      "AuthoredMaterializationResolved",
      "InventoryOperationApplied",
      "AtomicWorldInteractionStepsResolved",
      "AtomicWorldInteractionSuspended",
      "AtomicWorldInteractionResumed",
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
