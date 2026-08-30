export type ModuleNpcSocialMechanics = Readonly<{
  /** Complete SRD ability block used by Rules; no request-time prose parsing. */
  abilityScores: Readonly<{
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  }>;
  proficiencyBonus: number;
  /** NPC stat blocks may have an explicit skill bonus not derivable from a
   * player-class proficiency model. */
  skillModifiers: Readonly<Record<string, number>>;
  initialTrust: number;
  authorityModifier: number;
  stakesSensitivity: number;
  maximumInfluenceDegree: "limitedSuccess" | "fullSuccess" | "strongSuccess";
}>;

export type ModulePremiseEntityKind =
  | "person"
  | "organization"
  | "place"
  | "object"
  | "event"
  | "task";

export type ModulePremiseArchetype = Readonly<{
  archetypeRef: string;
  entityKind: ModulePremiseEntityKind;
  semanticCategory: string;
  displayTemplateRef: string;
  socialArchetypeRef?: string;
}>;

export type ModulePremisePolicySlot = Readonly<{
  slotRef: string;
  relationKind: string;
  minimum: number;
  maximum: number;
  allowedExistingKinds: readonly ModulePremiseEntityKind[];
  allowedOpenArchetypeRefs: readonly string[];
}>;

export type ModulePremiseBlankPolicy = Readonly<{
  policyRef: string;
  predicate:
    | "arrivalPurpose"
    | "priorKnowledge"
    | "priorRelationship"
    | "obligation"
    | "affiliation"
    | "identityBackground";
  scope: "characterBackstory";
  minimumBindings: number;
  maximumBindings: number;
  allowedAnchorRefs: readonly string[];
  slots: readonly ModulePremisePolicySlot[];
  statementTemplateRef: string;
}>;

export type ModulePremiseCatalog = Readonly<{
  schema: "zhuwei.module-premise-catalog/v1";
  moduleProfileId: string;
  anchorRefs: readonly string[];
  archetypes: readonly ModulePremiseArchetype[];
  policies: readonly ModulePremiseBlankPolicy[];
}>;

const SOCIAL_MODULE_PROFILE_ID = "module:black-oak-will:social-resolution-v1";
const STORY_ANCHORS_REF = `${SOCIAL_MODULE_PROFILE_ID}:story-anchors`;
const ARCHETYPE_PREFIX = `${SOCIAL_MODULE_PROFILE_ID}:premise-archetype`;
const POLICY_PREFIX = `${SOCIAL_MODULE_PROFILE_ID}:premise-policy`;

const PREMISE_ARCHETYPE_REFS = Object.freeze({
  localContact: `${ARCHETYPE_PREFIX}:person:local-contact`,
  localProfessional: `${ARCHETYPE_PREFIX}:person:local-professional`,
  localOfficial: `${ARCHETYPE_PREFIX}:person:local-official`,
  itinerantSpecialist: `${ARCHETYPE_PREFIX}:person:itinerant-specialist`,
  localNetwork: `${ARCHETYPE_PREFIX}:organization:local-network`,
  regionalInstitution: `${ARCHETYPE_PREFIX}:organization:regional-institution`,
  localSite: `${ARCHETYPE_PREFIX}:place:local-site`,
  regionalOrigin: `${ARCHETYPE_PREFIX}:place:regional-origin`,
  personalToken: `${ARCHETYPE_PREFIX}:object:personal-token`,
  missionObject: `${ARCHETYPE_PREFIX}:object:mission-object`,
  localIncident: `${ARCHETYPE_PREFIX}:event:local-incident`,
  priorEvent: `${ARCHETYPE_PREFIX}:event:prior-event`,
  localService: `${ARCHETYPE_PREFIX}:task:local-service`,
  investigation: `${ARCHETYPE_PREFIX}:task:investigation`,
});

const PERSON_ARCHETYPES = Object.freeze([
  PREMISE_ARCHETYPE_REFS.localContact,
  PREMISE_ARCHETYPE_REFS.localProfessional,
  PREMISE_ARCHETYPE_REFS.localOfficial,
  PREMISE_ARCHETYPE_REFS.itinerantSpecialist,
]);
const ORGANIZATION_ARCHETYPES = Object.freeze([
  PREMISE_ARCHETYPE_REFS.localNetwork,
  PREMISE_ARCHETYPE_REFS.regionalInstitution,
]);
const PLACE_ARCHETYPES = Object.freeze([
  PREMISE_ARCHETYPE_REFS.localSite,
  PREMISE_ARCHETYPE_REFS.regionalOrigin,
]);
const OBJECT_ARCHETYPES = Object.freeze([
  PREMISE_ARCHETYPE_REFS.personalToken,
  PREMISE_ARCHETYPE_REFS.missionObject,
]);
const EVENT_ARCHETYPES = Object.freeze([
  PREMISE_ARCHETYPE_REFS.localIncident,
  PREMISE_ARCHETYPE_REFS.priorEvent,
]);
const TASK_ARCHETYPES = Object.freeze([
  PREMISE_ARCHETYPE_REFS.localService,
  PREMISE_ARCHETYPE_REFS.investigation,
]);
const SUBJECT_ARCHETYPES = Object.freeze([
  ...PERSON_ARCHETYPES,
  ...ORGANIZATION_ARCHETYPES,
  ...PLACE_ARCHETYPES,
  ...OBJECT_ARCHETYPES,
  ...EVENT_ARCHETYPES,
  ...TASK_ARCHETYPES,
]);
const SUBJECT_KINDS = Object.freeze([
  "person", "organization", "place", "object", "event", "task",
] as const);

/**
 * Versioned, module-owned character-premise grammar. Rules dispatches only by
 * these stable refs and slot cardinalities; display aliases are never parsed
 * for names, professions, languages, or example keywords.
 */
export const BLACK_OAK_WILL_PREMISE_CATALOG_V1 = Object.freeze({
  schema: "zhuwei.module-premise-catalog/v1",
  moduleProfileId: SOCIAL_MODULE_PROFILE_ID,
  anchorRefs: Object.freeze([STORY_ANCHORS_REF]),
  archetypes: Object.freeze([
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localContact, entityKind: "person", semanticCategory: "localContact", displayTemplateRef: "premise-display:person:v1", socialArchetypeRef: "social-archetype:ordinary-v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localProfessional, entityKind: "person", semanticCategory: "localProfessional", displayTemplateRef: "premise-display:person:v1", socialArchetypeRef: "social-archetype:practiced-v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localOfficial, entityKind: "person", semanticCategory: "localOfficial", displayTemplateRef: "premise-display:person:v1", socialArchetypeRef: "social-archetype:official-v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.itinerantSpecialist, entityKind: "person", semanticCategory: "itinerantSpecialist", displayTemplateRef: "premise-display:person:v1", socialArchetypeRef: "social-archetype:expert-v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localNetwork, entityKind: "organization", semanticCategory: "localNetwork", displayTemplateRef: "premise-display:organization:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.regionalInstitution, entityKind: "organization", semanticCategory: "regionalInstitution", displayTemplateRef: "premise-display:organization:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localSite, entityKind: "place", semanticCategory: "localSite", displayTemplateRef: "premise-display:place:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.regionalOrigin, entityKind: "place", semanticCategory: "regionalOrigin", displayTemplateRef: "premise-display:place:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.personalToken, entityKind: "object", semanticCategory: "personalToken", displayTemplateRef: "premise-display:object:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.missionObject, entityKind: "object", semanticCategory: "missionObject", displayTemplateRef: "premise-display:object:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localIncident, entityKind: "event", semanticCategory: "localIncident", displayTemplateRef: "premise-display:event:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.priorEvent, entityKind: "event", semanticCategory: "priorEvent", displayTemplateRef: "premise-display:event:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.localService, entityKind: "task", semanticCategory: "localService", displayTemplateRef: "premise-display:task:v1" },
    { archetypeRef: PREMISE_ARCHETYPE_REFS.investigation, entityKind: "task", semanticCategory: "investigation", displayTemplateRef: "premise-display:task:v1" },
  ]),
  policies: Object.freeze([
    {
      policyRef: `${POLICY_PREFIX}:arrival-purpose`, predicate: "arrivalPurpose", scope: "characterBackstory",
      minimumBindings: 1, maximumBindings: 4, allowedAnchorRefs: Object.freeze([STORY_ANCHORS_REF]),
      statementTemplateRef: "premise-statement:arrival-purpose:v1",
      slots: Object.freeze([
        { slotRef: "requester", relationKind: "requestedBy", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
        { slotRef: "objective", relationKind: "seeksOrAssists", minimum: 0, maximum: 2, allowedExistingKinds: SUBJECT_KINDS, allowedOpenArchetypeRefs: SUBJECT_ARCHETYPES },
        { slotRef: "destination", relationKind: "boundFor", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["place"] as const), allowedOpenArchetypeRefs: PLACE_ARCHETYPES },
        { slotRef: "beneficiary", relationKind: "actsFor", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
      ]),
    },
    {
      policyRef: `${POLICY_PREFIX}:prior-knowledge`, predicate: "priorKnowledge", scope: "characterBackstory",
      minimumBindings: 1, maximumBindings: 4, allowedAnchorRefs: Object.freeze([STORY_ANCHORS_REF]),
      statementTemplateRef: "premise-statement:prior-knowledge:v1",
      slots: Object.freeze([{ slotRef: "knownSubject", relationKind: "previouslyKnewAbout", minimum: 1, maximum: 4, allowedExistingKinds: SUBJECT_KINDS, allowedOpenArchetypeRefs: SUBJECT_ARCHETYPES }]),
    },
    {
      policyRef: `${POLICY_PREFIX}:prior-relationship`, predicate: "priorRelationship", scope: "characterBackstory",
      minimumBindings: 1, maximumBindings: 2, allowedAnchorRefs: Object.freeze([STORY_ANCHORS_REF]),
      statementTemplateRef: "premise-statement:prior-relationship:v1",
      slots: Object.freeze([{ slotRef: "counterparty", relationKind: "previouslyConnectedTo", minimum: 1, maximum: 2, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) }]),
    },
    {
      policyRef: `${POLICY_PREFIX}:obligation`, predicate: "obligation", scope: "characterBackstory",
      minimumBindings: 1, maximumBindings: 3, allowedAnchorRefs: Object.freeze([STORY_ANCHORS_REF]),
      statementTemplateRef: "premise-statement:obligation:v1",
      slots: Object.freeze([
        { slotRef: "obligee", relationKind: "owesOrPromised", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
        { slotRef: "subject", relationKind: "obligationConcerns", minimum: 0, maximum: 2, allowedExistingKinds: Object.freeze(["object", "event", "task"] as const), allowedOpenArchetypeRefs: Object.freeze([...OBJECT_ARCHETYPES, ...EVENT_ARCHETYPES, ...TASK_ARCHETYPES]) },
      ]),
    },
    {
      policyRef: `${POLICY_PREFIX}:affiliation`, predicate: "affiliation", scope: "characterBackstory",
      minimumBindings: 1, maximumBindings: 2, allowedAnchorRefs: Object.freeze([STORY_ANCHORS_REF]),
      statementTemplateRef: "premise-statement:affiliation:v1",
      slots: Object.freeze([
        { slotRef: "organization", relationKind: "affiliatedWith", minimum: 1, maximum: 1, allowedExistingKinds: Object.freeze(["organization"] as const), allowedOpenArchetypeRefs: ORGANIZATION_ARCHETYPES },
        { slotRef: "sponsor", relationKind: "sponsoredBy", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
      ]),
    },
    {
      policyRef: `${POLICY_PREFIX}:identity-background`, predicate: "identityBackground", scope: "characterBackstory",
      minimumBindings: 1, maximumBindings: 3, allowedAnchorRefs: Object.freeze([STORY_ANCHORS_REF]),
      statementTemplateRef: "premise-statement:identity-background:v1",
      slots: Object.freeze([
        { slotRef: "origin", relationKind: "originatedFrom", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["place", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PLACE_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
        { slotRef: "mentor", relationKind: "trainedBy", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
        { slotRef: "formerAssociate", relationKind: "formerlyConnectedTo", minimum: 0, maximum: 1, allowedExistingKinds: Object.freeze(["person", "organization"] as const), allowedOpenArchetypeRefs: Object.freeze([...PERSON_ARCHETYPES, ...ORGANIZATION_ARCHETYPES]) },
      ]),
    },
  ]),
} satisfies ModulePremiseCatalog);

/**
 * Versioned structured mechanics for the Black Oak Module adapter. Keys are
 * stable module NPC ids, not names or player-text keywords. The legacy module
 * source remains untouched and historical Module Profile hashes remain exact.
 */
export const BLACK_OAK_WILL_SOCIAL_MECHANICS_V1:
Readonly<Record<string, ModuleNpcSocialMechanics>> = Object.freeze({
  lian: Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 12, con: 10, int: 11, wis: 12, cha: 11 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ insight: 3 }),
    initialTrust: 0,
    authorityModifier: 1,
    stakesSensitivity: 1,
    maximumInfluenceDegree: "strongSuccess",
  }),
  varo: Object.freeze({
    abilityScores: Object.freeze({ str: 9, dex: 12, con: 10, int: 14, wis: 12, cha: 12 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ deception: 4, insight: 1, persuasion: 3 }),
    initialTrust: 0,
    authorityModifier: 2,
    stakesSensitivity: 1,
    maximumInfluenceDegree: "strongSuccess",
  }),
  naes: Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 14 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ insight: 3, persuasion: 4, religion: 3 }),
    initialTrust: 1,
    authorityModifier: 0,
    stakesSensitivity: 2,
    maximumInfluenceDegree: "strongSuccess",
  }),
  echo: Object.freeze({
    abilityScores: Object.freeze({ str: 10, dex: 10, con: 10, int: 8, wis: 14, cha: 16 }),
    proficiencyBonus: 2,
    skillModifiers: Object.freeze({ insight: 2 }),
    initialTrust: 0,
    authorityModifier: 3,
    stakesSensitivity: 2,
    maximumInfluenceDegree: "limitedSuccess",
  }),
});
