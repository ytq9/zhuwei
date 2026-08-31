import type { CanonicalProfileDocument, ProfileRef } from "./types";

const PROFILE_ID = "item-system-srd51-2014-v1" as const;

export const HEALING_POTION_ITEM_DEFINITION_ID =
  "item-definition:srd51:healing-potion:1" as const;
export const HEALING_POTION_USE_ABILITY_REF =
  "ability:item:potion-of-healing:drink" as const;

/**
 * V5-only contract for one versioned item catalog and one global inventory.
 *
 * Definitions describe immutable mechanics. Item entries own mutable
 * possession, placement, quantity, condition, charges, and durability. Neither
 * character loadouts nor story artifacts are an item authority in this
 * profile.
 */
export const ITEM_SYSTEM_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "itemSystem",
  profileId: PROFILE_ID,
  semanticVersion: "1.2.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014-plus-versioned-product-ruling",
    spec: ["SPEC 0001", "SPEC 0004", "SPEC 0006", "SPEC 0013"],
    roomGeneration: "v5-new-rooms-only",
    definitionSchema: "zhuwei.item-definition/v1",
    entrySchema: "zhuwei.item-entry/v1",
    stateSchema: "zhuwei.item-system-state/v1",
    definitionAuthority: "one-immutable-versioned-catalog-for-standard-and-dynamic-items",
    weaponMechanics: "definition-freezes-closed-2014-attack-ability-dice-damage-range-sight-and-ammunition-ref-then-binds-current-holder-stats",
    entryAuthority: "one-global-entry-map-never-character-loadout-or-story-artifact-sidecars",
    placement: ["held", "scene", "consumed", "destroyed"],
    mutableState: [
      "holder",
      "scene",
      "equipped-slot",
      "quantity",
      "condition",
      "charges",
      "durability",
      "visibility",
      "ownership",
    ],
    holderVisibility: "entry-visibility-independently-controls-whether-the-current-holder-may-see-the-possession-shell-and-transfer-retargets-only-that-entry-policy-to-the-new-holder",
    definitionVisibility: "definition-visibility-independently-controls-item-identity-and-mechanics-and-is-never-broadened-or-rewritten-by-acquisition-transfer-or-equipment",
    projection: "entry-visible-definition-hidden-projects-the-exact-opaque-variant-while-entry-visible-definition-visible-projects-the-exact-identified-variant",
    standardGear: "pinned-gear-records-explicitly-declare-category-and-stackability-and-compile-purely-into-the-same-item-definition-schema",
    stackability: "only-explicitly-homogeneous-items-are-stackable-and-no-stackable-definition-may-carry-charges-or-durability",
    acquisitionOwnership: "acquisition-establishes-character-ownership-only-for-an-unowned-entry-and-never-overwrites-an-existing-owner",
    transfer: "all-held-items-use-one-co-located-entry-transfer-with-an-explicit-preserve-or-transfer-to-recipient-ownership-disposition",
    equipmentTiming: "2014-don-doff-table-for-armor-and-shields-six-seconds-per-other-equipment-operation",
    useActivity: "one-exact-entry-wrapper-freezes-definition-use-quantity-charge-and-durability-costs-and-commits-them-atomically-with-the-versioned-ability-effect",
    itemCostResourceIdentity: "the-canonical-item-entry-id-is-the-ability-resource-id-with-no-prefixed-alias",
    breakage: "durability-reaching-zero-marks-the-entry-broken-and-atomically-clears-its-equipped-slot",
    abilityRegistration: "every-use-or-equipment-ability-must-be-emitted-as-DefinitionRegistered-before-the-acquisition-transfer-or-equipment-state-event-that-can-activate-its-ref",
    equippedAbilityRefs: "item-definitions-freeze-portable-equipment-ability-refs-and-fold-requires-each-active-ref-to-already-resolve-to-the-frozen-room-catalog",
    healingPotion: "normal-action-self-use-consumes-one-entry-unit-and-resolves-2d4-plus-2-healing",
    replay: "definitions-and-entry-events-only-with-prior-explicit-ability-registration-and-no-model-rerun-current-definition-reinterpretation-or-missing-ability-compilation",
  },
};

export const ITEM_SYSTEM_PROFILE = Object.freeze({
  profileId: PROFILE_ID,
  // Kept literal so a registry can verify the document without executing I/O.
  profileHash: "sha256:3617527d10a13c6df79475756851c8de72498307574ff2b1fa8be833e59bfb71",
}) satisfies ProfileRef;

export function itemSystemProfileEnabled(extensions: readonly ProfileRef[]): boolean {
  return extensions.some((extension) =>
    extension.profileId === ITEM_SYSTEM_PROFILE.profileId
    && extension.profileHash === ITEM_SYSTEM_PROFILE.profileHash);
}
