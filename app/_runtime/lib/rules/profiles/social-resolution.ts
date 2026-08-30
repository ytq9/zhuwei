import type { CanonicalProfileDocument, ProfileRef } from "./types";

const PROFILE_ID = "social-resolution-srd51-2014-v1" as const;

/** Existing generic dynamic-NPC definitions predate typed premise archetypes.
 * V5 can activate them without interpreting their name or prose by applying
 * this one conservative Rules-owned fallback. */
export const DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF =
  "social-archetype:ordinary-v1" as const;

/** Finite new-NPC mechanical archetypes. The KP may select the fictional
 * archetype, but never supplies check modifiers or trust numbers directly. */
export const DYNAMIC_NPC_SOCIAL_ARCHETYPES = Object.freeze({
  "social-archetype:ordinary-v1": Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ insight: 0 }),
    initialTrust: 0,
    authorityModifier: 0,
    stakesSensitivity: 0,
    maximumInfluenceDegree: "limitedSuccess" as const,
  }),
  "social-archetype:practiced-v1": Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 10, con: 10, int: 12, wis: 12, cha: 12 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ insight: 3 }),
    initialTrust: 0,
    authorityModifier: 0,
    stakesSensitivity: 1,
    maximumInfluenceDegree: "fullSuccess" as const,
  }),
  "social-archetype:official-v1": Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 10, con: 10, int: 12, wis: 12, cha: 13 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ insight: 3 }),
    initialTrust: 0,
    authorityModifier: 2,
    stakesSensitivity: 2,
    maximumInfluenceDegree: "fullSuccess" as const,
  }),
  "social-archetype:expert-v1": Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 12, con: 12, int: 14, wis: 16, cha: 14 }),
    proficiencyBonus: 3,
    skillModifiers: Object.freeze({ insight: 5 }),
    initialTrust: 0,
    authorityModifier: 1,
    stakesSensitivity: 2,
    maximumInfluenceDegree: "strongSuccess" as const,
  }),
  "social-archetype:formidable-v1": Object.freeze({
    abilityScores: Object.freeze({ str: 12, dex: 12, con: 14, int: 16, wis: 18, cha: 16 }),
    proficiencyBonus: 4,
    skillModifiers: Object.freeze({ insight: 7 }),
    initialTrust: 0,
    authorityModifier: 3,
    stakesSensitivity: 3,
    maximumInfluenceDegree: "strongSuccess" as const,
  }),
});

/**
 * New-room-only social adjudication semantics.
 *
 * The KP still proposes the fictional goal, method, words, stakes, and
 * observer-safe branch text. Rules owns the target binding, resistance,
 * optional pre-roll choice, random result, margin band, belief change, and
 * durable conversation-thread disposition.
 */
export const SOCIAL_RESOLUTION_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "socialResolution",
  profileId: PROFILE_ID,
  semanticVersion: "1.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014-plus-versioned-product-ruling",
    spec: ["SPEC 0001", "SPEC 0004", "SPEC 0005", "SPEC 0006", "SPEC 0009", "SPEC 0015"],
    sourceClaim: "player-dialogue-is-a-source-claim-never-a-canonical-fact",
    targetBinding: "one-current-same-scene-and-causal-timeline-npc-ref-from-finite-context",
    resistance: "rules-derived-from-npc-insight-relationship-mutually-known-evidence-and-stakes",
    modelDc: "bounded-stakes-input-never-the-final-boundary",
    optionalCheck: "offer-before-randomness-with-press-accept-status-quo-or-free-text-reframe",
    noRollManeuver: "reframe-invalidates-old-roll-option-while-topic-state-changes-only-through-the-new-exchange",
    irreversibleCheck: "once-randomness-is-requested-the-check-cannot-be-withdrawn",
    degreeBands: {
      strongFailure: "margin<=-5",
      failure: "-4<=margin<=-1",
      limitedSuccess: "0<=margin<=4",
      fullSuccess: "5<=margin<=9",
      strongSuccess: "margin>=10",
    },
    naturalFaces: "no-automatic-success-or-failure",
    stateSeparation: [
      "claim-truth-status",
      "npc-inference",
      "immediate-behavior",
      "long-term-relationship",
      "conversation-topic-disposition",
    ],
    threadDispositions: ["active", "deemphasized", "dormant", "closed"],
    retryGate: "meaningful-method-fact-position-or-situation-change-required",
    successResponse: "rules-selects-margin-consistent-reaction-text-and-validates-source-or-commitment-capability",
    typedPremise: "module-signed-policy-slot-archetype-bindings-with-no-free-authoritative-statement",
    dynamicWorld: "reuse-stable-generic-definition-refs-with-no-name-profession-or-language-routing",
    genericNpcMechanics: "unsigned-legacy-dynamic-npc-uses-one-rules-owned-ordinary-archetype",
    dynamicNpcKnowledge: "explicit-recipient-bound-grants-only-never-copy-private-premise-wholesale",
    playerRollGesture: "v5-social-player-roll-only-with-journaled-candidate-recovery-and-control-transfer",
    narration: "typed-committed-delta-and-deterministically-attributed-source-claims-only",
    projection: "observer-safe-committed-fields-only",
    replay: "profile-pinned-events-and-frozen-social-plan-only-no-model-rerun",
    legacyIsolation: "absent-exact-profile-retains-v3-v4-npc-exchange-semantics",
  },
};

export const SOCIAL_RESOLUTION_PROFILE = Object.freeze({
  profileId: PROFILE_ID,
  profileHash: "sha256:9a879bc55127de79e88bfd6d62733e8d5fb329bdfa7d22fb0c87fbc5b5fe95e1",
}) satisfies ProfileRef;

export function socialResolutionProfileEnabled(extensions: readonly ProfileRef[]): boolean {
  return extensions.some((extension) =>
    extension.profileId === SOCIAL_RESOLUTION_PROFILE.profileId
    && extension.profileHash === SOCIAL_RESOLUTION_PROFILE.profileHash);
}
