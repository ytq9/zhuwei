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
  semanticVersion: "1.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014",
    spec: ["SPEC 0001", "SPEC 0003", "SPEC 0006", "SPEC 0012", "SPEC 0013"],
    initialAuthority: "kp-may-propose-one-complete-bespoke-definition-before-mechanical-resolution",
    validation: "rules-validates-closed-2014-creature-and-ability-schemas-without-level-balancing",
    definitionClosure: "label-stats-proficiency-ac-model-hit-points-footprint-speed-resources-death-policy-intrinsic-abilities-frozen-item-definitions-and-explicit-initial-loadout",
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
    inventory: "template-loadout-blueprints-mint-canonical-hash-derived-nonstackable-item-identities-and-transfer-moves-the-identity-without-auto-equip",
    establishedInventory: "first-mechanical-materialization-normalizes-bounded-existing-standard-equipment-into-independent-instances-before-emitting-the-combat-entity",
    stackableInventory: "pinned-standard-ammunition-and-pack-items-remain-quantity-based-while-equipment-and-dynamic-items-are-one-instance-per-entry",
    ammunition: "weapon-ammo-refs-are-null-or-pinned-standard-ammunition-dynamic-ammunition-definitions-fail-closed-and-zero-quantity-clears-selector-and-runtime-pool",
    equipment: "wear-or-stow-derives-ac-and-equipment-abilities-from-pinned-standard-gear-or-closed-frozen-item-definitions",
    itemWeaponBinding: "custom-weapon-blueprints-freeze-dice-damage-type-ability-and-range-while-rules-binds-current-wearer-modifiers-into-a-bearer-specific-ability",
    abilityComposition: "active-ability-refs-are-frozen-template-intrinsic-refs-unioned-with-current-equipment-refs",
    itemLifecycle: "break-repair-destroy-or-lose-is-one-atomic-authority-transition-that-clears-disabled-slots-and-recomputes-ac-and-abilities",
    itemLifecycleCause: "private-kp-item-state-changes-require-one-visible-typed-cause-fact-bound-to-the-same-npc-item-and-transition",
    mechanicalTransfer: "standard-equipment-entering-a-mechanical-npc-mints-one-frozen-target-item-id-and-mechanical-instances-transfer-only-between-mechanical-npcs",
    itemSourceSeparation: "story-artifacts-never-serve-as-the-mechanical-item-definition-or-instance-authority",
    combatTiming: "this-profile-rejects-item-transfer-and-gear-change-for-active-encounter-participants",
    respec: "existing-mechanical-entity-cannot-submit-a-new-bespoke-definition",
    revision: "permanent-causal-transformation-requires-a-new-versioned-definition-not-an-in-place-overwrite",
    replay: "definition-and-instance-events-only-no-model-rerun-or-current-compiler-reinterpretation",
    legacyIsolation: "absent-exact-profile-retains-the-original-flat-dynamic-combatant-contract",
  },
};

export const NPC_MECHANICS_PROFILE = Object.freeze({
  profileId: PROFILE_ID,
  profileHash: "sha256:63233902fd617169f2fa798fae6fa96a57392a2c9a557ee72cd002b2e4e8002a",
}) satisfies ProfileRef;

export function npcMechanicsProfileEnabled(extensions: readonly ProfileRef[]): boolean {
  return extensions.some((extension) =>
    extension.profileId === NPC_MECHANICS_PROFILE.profileId
    && extension.profileHash === NPC_MECHANICS_PROFILE.profileHash);
}
