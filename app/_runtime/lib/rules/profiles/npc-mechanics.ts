import {
  STANDARD_GEAR_PROFILE,
  standardGearProfileEnabled,
} from "./standard-gear";
import type { CanonicalProfileDocument, ProfileRef } from "./types";

const PROFILE_ID = "npc-mechanical-definition-srd51-2014-v1" as const;

/**
 * New-room-only contract for persistent NPC mechanics.
 *
 * A KP may propose one complete bespoke creature definition before that
 * creature is mechanically resolved. Rules validates and freezes it. Later
 * entities may reference the frozen definition, while per-entity hit points,
 * resources, position, conditions, and equipment remain runtime state.
 */
export const NPC_MECHANICS_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "npcMechanicalDefinition",
  profileId: PROFILE_ID,
  semanticVersion: "1.1.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014",
    spec: ["SPEC 0001", "SPEC 0003", "SPEC 0006", "SPEC 0012", "SPEC 0013"],
    initialAuthority: "kp-may-propose-one-complete-bespoke-definition-before-mechanical-resolution",
    validation: "rules-validates-closed-2014-creature-and-ability-schemas-without-level-balancing",
    standardGearProfile: STANDARD_GEAR_PROFILE,
    definitionClosure: "label-stats-proficiency-ac-model-hit-points-footprint-speed-resources-death-policy-intrinsic-abilities-canonical-item-definition-refs-and-explicit-initial-loadout",
    persistence: "definition-registered-once-and-event-chain-frozen-before-initiative-randomness",
    proposalIngress: "v5-private-materialization-direct-uses-closed-encounter-transfer-and-gear-drafts-with-trusted-actor-binding",
    kpContext: "exact-profile-exposes-authoritative-actor-and-same-scene-npc-loadouts-only-to-the-private-kp-context",
    sharing: "many-entity-runtime-records-may-reference-one-versioned-mechanical-definition",
    instanceState: [
      "hit-points",
      "resources",
      "position",
      "conditions",
      "equipment",
      "concentration",
      "death-state",
    ],
    promotion: "one-time-spatial-npc-shell-to-complete-combat-entity-with-authoritative-placement-preserved",
    existingState: "promotion-preserves-established-hit-points-and-overlapping-resource-current-values-within-template-bounds",
    consistency: "previously-frozen-identity-ability-scores-proficiency-scene-visible-geometry-and-runtime-pools-cannot-drift",
    inventory: "template-loadout-uses-the-one-canonical-item-definition-and-entry-authority-without-an-npc-item-adapter-and-transfer-moves-the-entry-without-auto-equip",
    establishedInventory: "first-mechanical-materialization-normalizes-bounded-existing-standard-equipment-into-independent-instances-before-emitting-the-combat-entity",
    stackableInventory: "stacking-is-declared-only-by-the-canonical-item-definition-and-never-inferred-from-an-npc-loadout-source",
    ammunition: "weapon-ammunition-definition-refs-are-null-or-resolve-to-canonical-ammunition-and-zero-quantity-clears-selector-and-runtime-pool",
    equipment: "wear-or-stow-derives-ac-equipment-abilities-and-2014-don-doff-duration-from-the-canonical-item-authority",
    itemWeaponBinding: "custom-weapon-blueprints-freeze-dice-damage-type-ability-and-range-while-each-bearer-specific-ability-is-emitted-as-DefinitionRegistered-before-the-item-or-gear-state-event-that-binds-it",
    abilityComposition: "every-active-intrinsic-or-item-derived-ability-ref-must-resolve-to-a-prior-DefinitionRegistered-record-before-the-event-that-establishes-the-active-ability-closure",
    itemLifecycle: "break-repair-or-destroy-is-one-atomic-authority-transition-that-clears-disabled-slots-and-recomputes-ac-and-abilities-while-locationless-lose-is-unavailable",
    itemLifecycleCause: "private-kp-item-state-changes-require-one-visible-typed-cause-fact-bound-to-the-same-npc-item-and-transition",
    mechanicalTransfer: "unified-item-entries-transfer-between-co-located-characters-retargets-only-holder-entry-visibility-never-definition-visibility-and-projects-an-opaque-entry-when-the-new-holder-cannot-identify-the-definition",
    itemSourceSeparation: "story-artifacts-never-serve-as-the-mechanical-item-definition-or-instance-authority",
    combatTiming: "this-profile-rejects-item-transfer-and-gear-change-for-active-encounter-participants-and-gear-change-runs-as-the-target-npc-activity-with-rules-derived-duration",
    respec: "existing-mechanical-entity-cannot-submit-a-new-bespoke-definition",
    revision: "permanent-causal-transformation-requires-a-new-versioned-definition-not-an-in-place-overwrite",
    replay: "definition-and-instance-events-only-fold-requires-all-active-ability-refs-to-be-preregistered-and-never-compiles-a-missing-ability",
  },
};

export const NPC_MECHANICS_PROFILE = Object.freeze({
  profileId: PROFILE_ID,
  profileHash: "sha256:6e3ebb6456b8db2e909648378131a249050cfc33da31f2d3ed7f24a654693b88",
}) satisfies ProfileRef;

export function npcMechanicsProfileEnabled(extensions: readonly ProfileRef[]): boolean {
  return standardGearProfileEnabled(extensions) && extensions.some((extension) =>
    extension.profileId === NPC_MECHANICS_PROFILE.profileId
    && extension.profileHash === NPC_MECHANICS_PROFILE.profileHash);
}
