import type { CanonicalProfileDocument, ProfileRef } from "./types";

/** New-room-only SRD 5.1 character proficiency semantics. Historical runtime
 * manifests keep their frozen one-proficiency-bonus skill interpretation and
 * their existing per-operation saving-throw behavior. */
export const CHARACTER_PROFICIENCY_PROFILE = {
  profileId: "character-proficiency-srd51-2014-v2",
  profileHash: "sha256:d15b632005121a4231bdb221e820d9f962656d5c94b9a0cc1417787fcd5d2c21",
} as const satisfies ProfileRef;

export const CHARACTER_PROFICIENCY_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "characterProficiency",
  profileId: CHARACTER_PROFICIENCY_PROFILE.profileId,
  semanticVersion: "2.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014",
    profileDispatch: "exact-id-and-hash",
    stateFields: ["proficientSaves", "proficientSkills", "expertiseSkills", "proficientWeapons", "proficientArmor"],
    toolProficiency: "tool-ids-listed-with-skills-a-check-naming-one-adds-the-bonus-as-a-skill-does",
    weaponProficiency: "category-simple-or-martial-or-the-weapon-kind-adds-the-bonus-to-its-attack-rolls",
    armorProficiency: "worn-armor-or-shield-without-its-kind-gives-disadvantage-on-strength-or-dexterity-checks-saves-and-attacks-and-no-spellcasting",
    proficiencySources: "class-race-subclass-background-and-the-builder-choices-they-offer",
    skillProficiency: "ability-modifier-plus-one-proficiency-bonus",
    skillExpertise: "ability-modifier-plus-two-proficiency-bonuses",
    savingThrowProficiency: "ability-modifier-plus-one-proficiency-bonus",
    expertiseConstraint: "expertise-skill-must-also-be-proficient",
    savingThrowAbilities: ["str", "dex", "con", "int", "wis", "cha"],
    legacyIsolation: "absent-exact-profile-never-enables-expertise-or-new-save-semantics",
    replay: "profile-pinned-fields-and-frozen-modifiers-no-current-helper-fallback",
  },
};

export function characterProficiencyProfileEnabled(extensions: readonly ProfileRef[]): boolean {
  return extensions.some((extension) =>
    extension.profileId === CHARACTER_PROFICIENCY_PROFILE.profileId
    && extension.profileHash === CHARACTER_PROFICIENCY_PROFILE.profileHash);
}
