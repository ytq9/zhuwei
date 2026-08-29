import type { CanonicalProfileDocument, ProfileRef } from "./types";

/** New-room-only SRD 5.1 character proficiency semantics. Historical runtime
 * manifests keep their frozen one-proficiency-bonus skill interpretation and
 * their existing per-operation saving-throw behavior. */
export const CHARACTER_PROFICIENCY_PROFILE = {
  profileId: "character-proficiency-srd51-2014-v1",
  profileHash: "sha256:718bf64554e4b032f3bea564797edf67b1695c2335879db4bd3e5332069a1001",
} as const satisfies ProfileRef;

export const CHARACTER_PROFICIENCY_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "characterProficiency",
  profileId: CHARACTER_PROFICIENCY_PROFILE.profileId,
  semanticVersion: "1.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014",
    profileDispatch: "exact-id-and-hash",
    stateFields: ["proficientSaves", "proficientSkills", "expertiseSkills"],
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
