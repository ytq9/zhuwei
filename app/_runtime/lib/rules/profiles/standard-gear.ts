import {
  ITEMS,
  type GearItem,
  type GearItemResolver,
} from "../../dnd/gear";
import type {
  CanonicalProfileDocument,
  ProfileRef,
} from "./types";

const PROFILE_ID = "standard-gear-srd51-2014-v2" as const;

/**
 * The complete standard gear catalog and its weapon derivation contract are
 * hashed together. Display text is carried in the catalog, but executable
 * weapon mechanics come only from each item's closed `weapon` record.
 */
export const STANDARD_GEAR_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "standardGearCatalog",
  profileId: PROFILE_ID,
  semanticVersion: "2.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014",
    spec: ["SPEC 0001", "SPEC 0004", "SPEC 0006", "SPEC 0013"],
    catalogSchema: "zhuwei.standard-gear-catalog/v1",
    catalog: ITEMS,
    resolverDispatch: "exact-profile-id-and-hash-no-latest-fallback",
    weaponDerivation: {
      source: "closed-item-weapon-record-never-display-text-or-model-prose",
      attackAbility: "dex-for-dex-str-for-str-higher-modifier-for-finesse",
      attackProficiency: "bearer-proficiency-bonus-only-when-proficient-with-the-weapon-category-or-kind-npc-without-a-record-always",
      damage: "frozen-dice-and-type-plus-current-bearer-selected-ability-modifier",
      geometry: "frozen-reach-or-normal-and-long-range-in-integer-inches",
      ammunition: "frozen-standard-ammunition-id-becomes-one-item-resource-cost",
      identity: "bearer-item-slot-level-modifier-proficiency-bonus-and-whether-proficient",
      weaponClassification: "every-weapon-is-simple-or-martial-and-a-catalog-weapon-is-its-own-kind",
      hands: "main-and-off-hand-weapons-compile-as-distinct-attack-options",
    },
    armorDerivation: "armor-record-plus-current-dexterity-cap-shield-items-always-grant-two-ac",
    stockDerivation: "held-item-authority-only-viewer-authorized-display-counters-no-independent-resource-pools",
    bundleDerivation: "structured-contents-expand-before-initial-item-import-never-replenish-from-description",
    replay: "resolve-only-the-exact-profile-pinned-by-the-room-manifest",
  },
};

export const STANDARD_GEAR_PROFILE = Object.freeze({
  profileId: PROFILE_ID,
  profileHash: "sha256:67b80f3bd513a26eac57628eb49da456cec0262d72c4bbbbc662692f9b2eb815",
}) satisfies ProfileRef;

/** Future immutable catalogs must add a new exact branch; unknown or
 * same-id/different-hash refs never fall through to the current catalog. */
export function standardGearCatalogForProfile(
  profile: ProfileRef,
): readonly GearItem[] | undefined {
  if (profile.profileId === STANDARD_GEAR_PROFILE.profileId
    && profile.profileHash === STANDARD_GEAR_PROFILE.profileHash) return ITEMS;
  return undefined;
}

export function standardGearResolverForProfile(
  profile: ProfileRef,
): GearItemResolver | undefined {
  const catalog = standardGearCatalogForProfile(profile);
  if (catalog === undefined) return undefined;
  return (itemId) => itemId === undefined || itemId === null
    ? undefined
    : catalog.find((item) => item.id === itemId);
}

export function standardGearProfileEnabled(extensions: readonly ProfileRef[]): boolean {
  return extensions.some((extension) =>
    extension.profileId === STANDARD_GEAR_PROFILE.profileId
    && extension.profileHash === STANDARD_GEAR_PROFILE.profileHash);
}
