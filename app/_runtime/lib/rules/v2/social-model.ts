import {
  lowerCausalActionProgram,
  validateCausalActionProgram,
  type CausalActionProgram,
  type CausalValue,
} from "../../kp/causal-action-program";
import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import {
  DYNAMIC_NPC_SOCIAL_ARCHETYPES,
  socialResolutionProfileEnabled,
} from "../profiles/social-resolution";
import {
  causalActionDurationMicros,
  causalProgramFactRef,
  causalProgramFactValue,
  validateExecutableCausalActionProgram,
} from "./causal-model";
import type {
  AuthoritativeWorldState,
  CharacterRecord,
  FrozenCheck,
  InternalContinuationRecord,
  NpcSocialMechanicsRecord,
  SocialClaimSemantics,
  SocialInfluenceDegree,
  SocialNpcResponse,
  SocialResolutionPlan,
} from "./model";
import { skillCheckModifier } from "./proficiency";
import { characterTimelineId } from "./timeline";
import {
  canonicalFactVisibleToCharacter,
  hasExactKeys,
  hashWorldState,
  isNonEmptyString,
  isRecord,
} from "./validation";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const MODES = ["normal", "advantage", "disadvantage"] as const;
const SOCIAL_SKILLS = ["deception", "insight", "intimidation", "performance", "persuasion"] as const;
const MAXIMUM_DEGREES = ["limitedSuccess", "fullSuccess", "strongSuccess"] as const;
const SUCCESS_DEGREE_RANK = {
  limitedSuccess: 0,
  fullSuccess: 1,
  strongSuccess: 2,
} as const;
const RETRY_GATE = [
  "methodChanged",
  "factsChanged",
  "positionChanged",
  "situationAdvanced",
] as const;
const INFLUENCE_GOALS = [
  "beBelieved",
  "deemphasize",
  "cooperate",
  "disclose",
  "permit",
  "deter",
  "other",
] as const;
const ASSERTION_PREDICATES = [
  "isA",
  "affiliatedWith",
  "authorizedBy",
  "possesses",
  "knowsAbout",
  "performed",
  "intends",
  "relatedTo",
  "locatedAt",
] as const;

function normalizedSocialUtterance(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\p{Z}]+/gu, "");
}

export function socialUtteranceFingerprint(value: string): string {
  return canonicalSha256({ utterance: normalizedSocialUtterance(value) });
}

/** Same place is insufficient while split-party causal timelines have not
 * explicitly rejoined. Social exchange and hearing require both conditions. */
export function socialParticipantsCoPresent(
  state: AuthoritativeWorldState,
  left: CharacterRecord,
  right: CharacterRecord,
): boolean {
  if (left.sceneId !== right.sceneId) return false;
  const leftTimelineId = characterTimelineId(state, left.id);
  const rightTimelineId = characterTimelineId(state, right.id);
  return leftTimelineId !== undefined && leftTimelineId === rightTimelineId;
}

/** A retry method is the mechanical approach plus the normalized fictional
 * method. Punctuation-only rewrites and restating the same speech do not open
 * another roll, while a genuinely different described approach can. */
export function socialMethodFingerprint(
  value: Pick<FrozenCheck, "ability" | "skill" | "method">,
): string {
  return canonicalSha256({
    ability: value.ability,
    skill: value.skill,
    method: normalizedSocialUtterance(value.method),
  });
}

function socialTopicFingerprint(
  npcCharacterId: string,
  assertion: SocialClaimSemantics["assertion"],
  utterance: string,
) {
  const normalizedAssertion = assertion === null ? null : {
    subjectRef: assertion.subjectRef,
    predicate: assertion.predicate,
    polarity: assertion.polarity,
    object: assertion.object.referenceKind === "existing"
      ? assertion.object
      : {
          referenceKind: "unresolvedLabel",
          label: normalizedSocialUtterance(assertion.object.label),
        },
  };
  return canonicalSha256({
    npcCharacterId,
    topic: normalizedAssertion ?? { normalizedUtterance: normalizedSocialUtterance(utterance) },
  });
}

export function isSocialClaimSemantics(value: unknown): value is SocialClaimSemantics {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "addressedThreadRef", "assertion", "desiredBehavior", "evidenceRefs", "influenceGoal",
      "schema", "targetNpcRef", "topicFingerprint",
    ])
    || value.schema !== "zhuwei.social-claim-semantics/v1"
    || !(INFLUENCE_GOALS as readonly unknown[]).includes(value.influenceGoal)
    || !isNonEmptyString(value.desiredBehavior)
    || value.desiredBehavior.length > 500
    || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length > 2
    || !value.evidenceRefs.every(isNonEmptyString)
    || value.evidenceRefs.length !== new Set(value.evidenceRefs).size
    || (value.addressedThreadRef !== null && !isNonEmptyString(value.addressedThreadRef))
    || !isNonEmptyString(value.targetNpcRef)
    || !/^sha256:[0-9a-f]{64}$/u.test(String(value.topicFingerprint))) return false;
  if (value.assertion === null) return true;
  if (!isRecord(value.assertion)
    || !hasExactKeys(value.assertion, ["object", "polarity", "predicate", "subjectRef"])
    || !isNonEmptyString(value.assertion.subjectRef)
    || !(ASSERTION_PREDICATES as readonly unknown[]).includes(value.assertion.predicate)
    || !["affirm", "deny", "question"].includes(String(value.assertion.polarity))
    || !isRecord(value.assertion.object)) return false;
  return value.assertion.object.referenceKind === "existing"
    ? hasExactKeys(value.assertion.object, ["ref", "referenceKind"])
      && isNonEmptyString(value.assertion.object.ref)
    : value.assertion.object.referenceKind === "unresolvedLabel"
      && hasExactKeys(value.assertion.object, ["label", "referenceKind"])
      && isNonEmptyString(value.assertion.object.label)
      && value.assertion.object.label.length <= 160;
}

function scalarString(value: CausalValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function scalarNumber(value: CausalValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringList(value: CausalValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

export function isNpcSocialMechanics(value: unknown): value is NpcSocialMechanicsRecord {
  return isRecord(value)
    && hasExactKeys(value, [
      "abilityScores",
      "authorityModifier",
      "initialTrust",
      "maximumInfluenceDegree",
      "proficiencyBonus",
      "skillModifiers",
      "stakesSensitivity",
    ])
    && isRecord(value.abilityScores)
    && hasExactKeys(value.abilityScores, ["cha", "con", "dex", "int", "str", "wis"])
    && Object.values(value.abilityScores).every((score) =>
      Number.isSafeInteger(score) && Number(score) >= 1 && Number(score) <= 30)
    && Number.isSafeInteger(value.proficiencyBonus)
    && Number(value.proficiencyBonus) >= 0
    && Number(value.proficiencyBonus) <= 12
    && isRecord(value.skillModifiers)
    && Object.entries(value.skillModifiers).every(([skill, modifier]) =>
      isNonEmptyString(skill)
      && Number.isSafeInteger(modifier)
      && Number(modifier) >= -20
      && Number(modifier) <= 30)
    && [value.initialTrust, value.authorityModifier, value.stakesSensitivity]
      .every((entry) => Number.isSafeInteger(entry) && Number(entry) >= -5 && Number(entry) <= 5)
    && (MAXIMUM_DEGREES as readonly unknown[]).includes(value.maximumInfluenceDegree);
}

export function dynamicNpcSocialMechanics(
  archetypeRef: unknown,
): NpcSocialMechanicsRecord | undefined {
  if (!isNonEmptyString(archetypeRef)
    || !(archetypeRef in DYNAMIC_NPC_SOCIAL_ARCHETYPES)) return undefined;
  const value = DYNAMIC_NPC_SOCIAL_ARCHETYPES[
    archetypeRef as keyof typeof DYNAMIC_NPC_SOCIAL_ARCHETYPES
  ];
  return isNpcSocialMechanics(value)
    ? structuredClone(value) as NpcSocialMechanicsRecord
    : undefined;
}

function relationshipId(actorId: string, npcId: string): string {
  return `relationship:social:${[actorId, npcId].sort().join(":")}`;
}

function relationshipTrust(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  npc: CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord },
): number {
  const relationship = state.campaignRuntime.relationships[relationshipId(actor.id, npc.id)];
  const explicit = typeof relationship?.socialTrust === "number"
    && Number.isSafeInteger(relationship.socialTrust)
    ? Number(relationship.socialTrust)
    : typeof relationship?.value === "string"
      ? /^socialTrust:(-?[0-5])$/u.exec(relationship.value)?.[1]
      : undefined;
  return Math.max(-5, Math.min(5, explicit === undefined
    ? npc.socialMechanics.initialTrust
    : Number(explicit)));
}

function mutuallyKnownEvidenceRefs(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  npc: CharacterRecord,
  refs: readonly string[],
): string[] {
  return [...new Set(refs)].filter((reference) => {
    if (reference === npc.id || reference === actor.id) return false;
    const actorKnows = state.knowledge[actor.id]?.[reference] !== undefined
      || (state.canonicalFacts[reference] !== undefined
        && canonicalFactVisibleToCharacter(state, state.canonicalFacts[reference], actor));
    const npcKnows = state.knowledge[npc.id]?.[reference] !== undefined
      || (state.canonicalFacts[reference] !== undefined
        && canonicalFactVisibleToCharacter(state, state.canonicalFacts[reference], npc));
    return actorKnows && npcKnows;
  }).sort().slice(0, 2);
}

function evidenceStructurallySupportsClaim(
  state: AuthoritativeWorldState,
  assertion: SocialClaimSemantics["assertion"],
  reference: string,
): boolean {
  if (assertion === null) return false;
  const fact = state.canonicalFacts[reference];
  const value = isRecord(fact?.value) ? fact.value : undefined;
  const typed = value?.schema === "zhuwei.typed-assertion-fact/v1"
    && isRecord(value.assertion)
    ? value.assertion
    : undefined;
  if (typed === undefined
    || typed.subjectRef !== assertion.subjectRef
    || typed.predicate !== assertion.predicate
    || typed.polarity !== assertion.polarity
    || !isRecord(typed.object)) return false;
  return canonicalSha256(typed.object) === canonicalSha256(assertion.object);
}

function stakesModifier(modelDc: number, sensitivity: number): number {
  const proposed = modelDc <= 10 ? -1
    : modelDc <= 14 ? 0
      : modelDc <= 18 ? 2
        : modelDc <= 22 ? 4 : 6;
  return proposed + (modelDc >= 15 ? sensitivity : 0);
}

function fullAbilityName(value: typeof ABILITIES[number]): FrozenCheck["ability"] {
  return ({
    str: "strength",
    dex: "dexterity",
    con: "constitution",
    int: "intelligence",
    wis: "wisdom",
    cha: "charisma",
  } as const)[value];
}

function socialCheckPreview(goal: string): Pick<FrozenCheck, "successOutcome" | "failureOutcome"> {
  return {
    successOutcome: `若达到边界，对方会按差值对“${goal}”作出有限至充分的配合；这不会把任何主张变成世界事实。`,
    failureOutcome: `若未达到边界，对方不会接受“${goal}”这项影响；差值达到强失败时，可能强化当前怀疑并在高风险场景影响关系。`,
  };
}

export type DerivedSocialPlan = {
  plan: SocialResolutionPlan;
  actor: CharacterRecord;
  npc: CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord };
  directResponse?: SocialNpcResponse;
};

export type SocialPlanDerivation = DerivedSocialPlan | {
  rejection:
    | "unchangedRetry"
    | "targetUnavailable"
    | "invalidSocialIntent"
    | "evidenceUnavailable"
    | "invalidNpcResponse"
    | "invalidCheck";
};

const DIRECT_REACTIONS = {
  acknowledge: "我听见了，但这不表示我确认了你的说法。",
  decline: "我不回答这个问题。",
  askClarification: "把问题或来意说得更清楚些。",
  redirect: "先说眼前的事。",
  silence: "没有作答。",
} as const;

export function socialCheckResponseAllowed(
  influenceGoal: SocialClaimSemantics["influenceGoal"],
  response: Pick<SocialNpcResponse, "mode" | "reactionKind">,
): boolean {
  if (influenceGoal === "disclose") return response.mode === "sourceBacked";
  if (influenceGoal === "permit" || influenceGoal === "cooperate") {
    return response.mode === "commitment";
  }
  if (influenceGoal === "beBelieved"
    || influenceGoal === "deemphasize"
    || influenceGoal === "deter") {
    return response.mode === "reaction"
      && (response.reactionKind === "acknowledge"
        || (influenceGoal === "deemphasize" && response.reactionKind === "redirect"));
  }
  return response.mode !== "reaction"
    || response.reactionKind === "acknowledge"
    || response.reactionKind === "redirect";
}

/** A successful reaction is written from the resolved margin, not from one
 * pre-roll stock sentence that could contradict the NPC's actual inference. */
export function socialCheckReactionSpeech(
  degree: Extract<SocialInfluenceDegree, "limitedSuccess" | "fullSuccess" | "strongSuccess">,
  influenceGoal: SocialClaimSemantics["influenceGoal"],
): string {
  if (influenceGoal === "beBelieved") {
    return degree === "limitedSuccess"
      ? "我暂时不追问，但还没有把你的说法当成事实。"
      : degree === "fullSuccess"
        ? "我愿意先按你的说法采取有限行动。"
        : "我现在相信你的说法；这只是我当前的判断。";
  }
  if (influenceGoal === "deemphasize") {
    return degree === "limitedSuccess"
      ? "这件事先放一放，但我还没有完全释疑。"
      : degree === "fullSuccess"
        ? "好，我先不追究这件事，转到眼前的问题。"
        : "好，这件事到此为止，我们处理眼前的问题。";
  }
  if (influenceGoal === "deter") {
    return degree === "limitedSuccess"
      ? "我会暂时停手，但还在考虑下一步。"
      : degree === "fullSuccess"
        ? "我不会继续眼前的做法。"
        : "我会退让，并停止眼前的做法。";
  }
  return degree === "limitedSuccess"
    ? "我愿意暂时顺着这个方向考虑。"
    : degree === "fullSuccess"
      ? "我愿意在能力范围内作出有限回应。"
      : "我接受这次影响，并会在能力范围内充分回应。";
}

function npcKnowsReference(
  state: AuthoritativeWorldState,
  npc: CharacterRecord,
  reference: string,
): boolean {
  const fact = state.canonicalFacts[reference];
  return state.knowledge[npc.id]?.[reference] !== undefined
    || (fact !== undefined && canonicalFactVisibleToCharacter(state, fact, npc));
}

function finiteKnowledgeStatement(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 480);
  if (!isRecord(value)) return undefined;
  for (const key of ["statement", "description", "summary", "semanticContent", "content"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().slice(0, 480);
    }
  }
  return undefined;
}

function npcSourceStatements(
  state: AuthoritativeWorldState,
  npc: CharacterRecord,
  refs: readonly string[],
): string[] | undefined {
  const statements = refs.map((reference) => finiteKnowledgeStatement(
    state.knowledge[npc.id]?.[reference]?.content
      ?? state.canonicalFacts[reference]?.value,
  ));
  return statements.every(isNonEmptyString) ? statements : undefined;
}

function directNpcResponse(
  state: AuthoritativeWorldState,
  npc: CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord },
  refs: readonly string[],
  value: CausalValue | undefined,
): SocialNpcResponse | undefined {
  if (typeof value !== "string" || value.length > 2_000) return undefined;
  let draft: unknown;
  try {
    draft = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(draft)
    || draft.schema !== "zhuwei.npc-response-draft/v1"
    || !isNonEmptyString(draft.mode)) return undefined;
  const preferredMinimum = draft.mode === "reaction" ? "limitedSuccess" : "fullSuccess";
  const minimumDegree = preferredMinimum;
  const nonTargetRefs = [...new Set(refs.filter((reference) => reference !== npc.id))].sort();
  if (draft.mode === "reaction") {
    if (!hasExactKeys(draft, ["mode", "reaction", "schema"])
      || !isNonEmptyString(draft.reaction)
      || !(draft.reaction in DIRECT_REACTIONS)) return undefined;
    return {
      mode: "reaction",
      reactionKind: draft.reaction as NonNullable<SocialNpcResponse["reactionKind"]>,
      minimumDegree,
      speech: DIRECT_REACTIONS[draft.reaction as keyof typeof DIRECT_REACTIONS],
      sourceRefs: [],
    };
  }
  if (draft.mode === "commitment") {
    if (!hasExactKeys(draft, ["mode", "schema", "scopeRefs", "speech"])
      || !isNonEmptyString(draft.speech)
      || draft.speech.length > 800
      || !Array.isArray(draft.scopeRefs)
      || draft.scopeRefs.length < 1
      || draft.scopeRefs.length > 4
      || !draft.scopeRefs.every(isNonEmptyString)) return undefined;
    const scopeRefs = [...new Set(draft.scopeRefs)].sort();
    return scopeRefs.length === draft.scopeRefs.length
      && scopeRefs.every((reference) =>
        nonTargetRefs.includes(reference)
        && claimReferenceAvailable(state, npc, reference))
      ? {
          mode: "commitment",
          reactionKind: null,
          minimumDegree,
          speech: draft.speech,
          sourceRefs: scopeRefs,
        }
      : undefined;
  }
  if (draft.mode !== "sourceBacked"
    || !hasExactKeys(draft, ["mode", "schema", "sourceRefs"])
    || !Array.isArray(draft.sourceRefs)
    || draft.sourceRefs.length < 1
    || draft.sourceRefs.length > 4
    || !draft.sourceRefs.every(isNonEmptyString)) return undefined;
  const sourceRefs = [...new Set(draft.sourceRefs)].sort();
  const statements = npcSourceStatements(state, npc, sourceRefs);
  return sourceRefs.length === draft.sourceRefs.length
    && sourceRefs.every((reference) => nonTargetRefs.includes(reference))
    && sourceRefs.every((reference) => npcKnowsReference(state, npc, reference))
    && statements !== undefined
    ? {
        mode: "sourceBacked",
        reactionKind: null,
        minimumDegree,
        speech: statements!.join("；"),
        sourceRefs,
      }
    : undefined;
}

function claimReferenceAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  reference: string,
): boolean {
  const entity = state.entities[reference];
  const fact = state.canonicalFacts[reference];
  return reference === actor.id
    || state.knowledge[actor.id]?.[reference] !== undefined
    || (entity !== undefined && socialParticipantsCoPresent(state, actor, entity))
    || (fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor))
    || state.campaignRuntime.definitions[reference] !== undefined;
}

function deriveSocialClaimSemantics(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  npc: CharacterRecord,
  refs: readonly string[],
  utterance: string,
  value: CausalValue | undefined,
): SocialClaimSemantics | undefined {
  if (typeof value !== "string" || value.length > 3_000) return undefined;
  let draft: unknown;
  try {
    draft = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(draft)
    || !hasExactKeys(draft, [
      "addressedThreadRef", "assertion", "desiredBehavior", "evidenceRefs", "influenceGoal",
      "npcRef", "schema",
    ])
    || draft.schema !== "zhuwei.social-intent-draft/v1"
    || draft.npcRef !== npc.id
    || !(INFLUENCE_GOALS as readonly unknown[]).includes(draft.influenceGoal)
    || !isNonEmptyString(draft.desiredBehavior)
    || draft.desiredBehavior.length > 500
    || !Array.isArray(draft.evidenceRefs)
    || draft.evidenceRefs.length > 2
    || !draft.evidenceRefs.every(isNonEmptyString)
    || draft.evidenceRefs.length !== new Set(draft.evidenceRefs).size
    || (draft.addressedThreadRef !== null && !isNonEmptyString(draft.addressedThreadRef))
    || draft.evidenceRefs.some((reference) =>
      !refs.includes(reference)
      || reference === actor.id
      || reference === npc.id
      || !claimReferenceAvailable(state, actor, reference))) return undefined;
  let assertion: SocialClaimSemantics["assertion"] = null;
  if (draft.assertion !== null) {
    if (!isRecord(draft.assertion)
      || !hasExactKeys(draft.assertion, ["object", "polarity", "predicate", "subjectRef"])
      || !isNonEmptyString(draft.assertion.subjectRef)
      || !(ASSERTION_PREDICATES as readonly unknown[]).includes(draft.assertion.predicate)
      || !["affirm", "deny", "question"].includes(String(draft.assertion.polarity))
      || (!refs.includes(draft.assertion.subjectRef)
        && draft.assertion.subjectRef !== actor.id)
      || !claimReferenceAvailable(state, actor, draft.assertion.subjectRef)
      || !isRecord(draft.assertion.object)) return undefined;
    if (draft.assertion.object.referenceKind === "existing") {
      if (!hasExactKeys(draft.assertion.object, ["ref", "referenceKind"])
        || !isNonEmptyString(draft.assertion.object.ref)
        || !refs.includes(draft.assertion.object.ref)
        || !claimReferenceAvailable(state, actor, draft.assertion.object.ref)) return undefined;
      assertion = {
        subjectRef: draft.assertion.subjectRef,
        predicate: draft.assertion.predicate as NonNullable<SocialClaimSemantics["assertion"]>["predicate"],
        polarity: draft.assertion.polarity as "affirm" | "deny" | "question",
        object: { referenceKind: "existing", ref: draft.assertion.object.ref },
      };
    } else {
      if (draft.assertion.object.referenceKind !== "unresolvedLabel"
        || !hasExactKeys(draft.assertion.object, ["label", "referenceKind"])
        || !isNonEmptyString(draft.assertion.object.label)
        || draft.assertion.object.label.length > 160) return undefined;
      assertion = {
        subjectRef: draft.assertion.subjectRef,
        predicate: draft.assertion.predicate as NonNullable<SocialClaimSemantics["assertion"]>["predicate"],
        polarity: draft.assertion.polarity as "affirm" | "deny" | "question",
        object: {
          referenceKind: "unresolvedLabel",
          label: draft.assertion.object.label,
        },
      };
    }
  }
  const influenceGoal = draft.influenceGoal as SocialClaimSemantics["influenceGoal"];
  const addressedThread = draft.addressedThreadRef === null
    ? undefined
    : state.campaignRuntime.conversationThreads?.[draft.addressedThreadRef];
  if (draft.addressedThreadRef !== null
    && (!refs.includes(draft.addressedThreadRef)
      || addressedThread?.actorCharacterId !== actor.id
      || addressedThread.npcCharacterId !== npc.id
      || addressedThread.status !== "active"
      || influenceGoal !== "deemphasize"
      || !isNonEmptyString(addressedThread.topicFingerprint))) return undefined;
  if (influenceGoal === "beBelieved" && assertion === null) return undefined;
  return {
    schema: "zhuwei.social-claim-semantics/v1",
    targetNpcRef: npc.id,
    addressedThreadRef: draft.addressedThreadRef,
    influenceGoal,
    desiredBehavior: draft.desiredBehavior,
    evidenceRefs: [...draft.evidenceRefs].sort(),
    assertion,
    topicFingerprint: addressedThread === undefined
      ? socialTopicFingerprint(npc.id, assertion, utterance)
      : addressedThread.topicFingerprint,
  };
}

function socialIntentTargetNpcRef(value: CausalValue | undefined): string | undefined {
  if (typeof value !== "string" || value.length > 3_000) return undefined;
  try {
    const draft: unknown = JSON.parse(value);
    return isRecord(draft) && isNonEmptyString(draft.npcRef) ? draft.npcRef : undefined;
  } catch {
    return undefined;
  }
}

function eventOrdinal(value: unknown): bigint {
  if (!isNonEmptyString(value)) return -1n;
  const match = /:([0-9]+)$/u.exec(value);
  return match === null ? -1n : BigInt(match[1]);
}

function fictionNowMicros(state: AuthoritativeWorldState, actorId: string): bigint {
  const timelineId = characterTimelineId(state, actorId);
  const value = timelineId === undefined
    ? undefined
    : state.fictionTimelines[timelineId]?.nowMicros;
  return isNonEmptyString(value) && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : 0n;
}

export function socialPositionFingerprint(
  state: AuthoritativeWorldState,
  actorId: string,
): string {
  const actor = state.entities[actorId];
  const combat = state.combatRuntime.entities[actorId];
  return canonicalSha256({
    sceneId: actor?.sceneId ?? null,
    position: isRecord(combat) && isRecord(combat.position)
      ? combat.position
      : null,
  });
}

export function socialResistanceFingerprint(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  npc: CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord },
  evidenceRefs: readonly string[],
): string {
  const npcInsightModifier = Number(npc.socialMechanics.skillModifiers.insight
    ?? Math.floor((npc.socialMechanics.abilityScores.wis - 10) / 2));
  const trust = relationshipTrust(state, actor, npc);
  return canonicalSha256({
    npcInsightModifier,
    authorityModifier: npc.socialMechanics.authorityModifier,
    relationshipModifier: trust === 0 ? 0 : -2 * trust,
    evidenceRefs: [...evidenceRefs],
  });
}

function hasMeaningfulSocialRetryChange(
  state: AuthoritativeWorldState,
  actorId: string,
  npcId: string,
  topicFingerprint: string,
  methodFingerprint: string,
  utteranceFingerprint: string,
  sourceSceneId: string,
  evidenceRefs: readonly string[],
  resistanceFingerprint: string,
  influenceGoal: SocialClaimSemantics["influenceGoal"],
  addressedThreadRef: string | null,
): boolean | undefined {
  const prior = Object.values(state.campaignRuntime.conversationThreads ?? {})
    .filter((thread) => thread.resolution === "check"
      && thread.actorCharacterId === actorId
      && thread.npcCharacterId === npcId
      && (thread.topicFingerprint === topicFingerprint
        || thread.utteranceFingerprint === utteranceFingerprint)
      && thread.status === "active"
      && (thread.degree === "failure" || thread.degree === "strongFailure"))
    .sort((left, right) => {
      const leftOrdinal = eventOrdinal(left.updatedByEventId);
      const rightOrdinal = eventOrdinal(right.updatedByEventId);
      return leftOrdinal === rightOrdinal ? 0 : leftOrdinal < rightOrdinal ? 1 : -1;
    })[0];
  if (prior === undefined) return undefined;
  const priorEvidenceRefs = Array.isArray(prior.evidenceRefs)
    && prior.evidenceRefs.every(isNonEmptyString)
    ? prior.evidenceRefs
    : [];
  const priorFictionMicros = isNonEmptyString(prior.retryBaselineFictionMicros)
    && /^(?:0|[1-9][0-9]*)$/u.test(prior.retryBaselineFictionMicros)
    ? BigInt(prior.retryBaselineFictionMicros)
    : fictionNowMicros(state, actorId);
  const priorInfluenceGoal = isRecord(prior.claimSemantics)
    ? prior.claimSemantics.influenceGoal
    : undefined;
  const addressedGoalChanged = addressedThreadRef === prior.threadRef
    && priorInfluenceGoal !== influenceGoal
    && prior.utteranceFingerprint !== utteranceFingerprint;
  return addressedGoalChanged
    || prior.methodFingerprint !== methodFingerprint
    || prior.sourceSceneId !== sourceSceneId
    || prior.positionFingerprint !== socialPositionFingerprint(state, actorId)
    || fictionNowMicros(state, actorId) > priorFictionMicros
    || canonicalSha256(priorEvidenceRefs) !== canonicalSha256([...evidenceRefs])
    || prior.resistanceFingerprint !== resistanceFingerprint
    || state.campaignRuntime.retryChanges[prior.threadRef] !== undefined;
}

/** Derives a complete pre-roll offer. A model-supplied DC contributes only a
 * bounded stakes component; the final boundary is owned by Rules. */
export function deriveSocialResolutionPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  program: CausalActionProgram,
  rootActionId: string,
  options: { skipRetryGate?: boolean } = {},
): SocialPlanDerivation | undefined {
  if (!socialResolutionProfileEnabled(profiles.extensions)
    || program.formRef !== "npc-exchange.v1") return undefined;
  const lowered = lowerCausalActionProgram(program);
  const step = lowered.steps[0];
  if (step === undefined || step.primitive !== "exchangeWithNpc") {
    return { rejection: "invalidSocialIntent" };
  }
  const refs = stringList(step.arguments.basisRefs);
  const targetNpcRef = socialIntentTargetNpcRef(step.arguments.desiredResponse);
  const target = targetNpcRef === undefined ? undefined : state.entities[targetNpcRef];
  if (targetNpcRef === undefined
    || !refs.includes(targetNpcRef)
    || target?.kind !== "npc"
    || target.tenureStatus !== "active"
    || !socialParticipantsCoPresent(state, actor, target)
    || !isNpcSocialMechanics(target.socialMechanics)) {
    return { rejection: "targetUnavailable" };
  }
  const npc = target as CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord };
  const durationMicros = causalActionDurationMicros(step);
  if (durationMicros === undefined) return { rejection: "invalidSocialIntent" };
  const suffix = program.semanticHash.slice("fnv1a64:".length);
  const claimRef = `claim:social:${rootActionId}:${suffix}`;
  const threadRef = `conversation-thread:${rootActionId}:${suffix}`;
  const pendingInputId = `pending-input:social:${rootActionId}:${suffix}`;
  const programFactRef = causalProgramFactRef(rootActionId, program.semanticHash);
  const utterance = scalarString(step.arguments.utterance);
  if (utterance === undefined) return { rejection: "invalidSocialIntent" };
  const claimSemantics = deriveSocialClaimSemantics(
    state,
    actor,
    npc,
    refs,
    utterance,
    step.arguments.desiredResponse,
  );
  if (claimSemantics === undefined) return { rejection: "invalidSocialIntent" };
  const evidenceRefs = mutuallyKnownEvidenceRefs(
    state,
    actor,
    npc,
    claimSemantics.evidenceRefs,
  );
  if (evidenceRefs.length !== claimSemantics.evidenceRefs.length
    || evidenceRefs.some((reference) =>
      !evidenceStructurallySupportsClaim(state, claimSemantics.assertion, reference))) {
    return { rejection: "evidenceUnavailable" };
  }
  const successResponse = directNpcResponse(state, npc, refs, step.arguments.npcResponse);
  if (successResponse === undefined) return { rejection: "invalidNpcResponse" };
  if (step.arguments.resolution !== "direct"
    && SUCCESS_DEGREE_RANK[successResponse.minimumDegree]
      > SUCCESS_DEGREE_RANK[npc.socialMechanics.maximumInfluenceDegree]) {
    return { rejection: "invalidNpcResponse" };
  }
  if (step.arguments.resolution !== "direct"
    && !socialCheckResponseAllowed(claimSemantics.influenceGoal, successResponse)) {
    return { rejection: "invalidNpcResponse" };
  }

  if (step.arguments.resolution === "direct") {
    const response = successResponse;
    const directGoal = scalarString(step.arguments.goal) ?? "完成这次交谈";
    const directCheck: FrozenCheck = {
      kind: "ability",
      ability: "charisma",
      skill: null,
      dc: "0",
      modifier: "0",
      mode: "normal",
      goal: directGoal,
      method: scalarString(step.arguments.method) ?? "直接交谈",
      risk: scalarString(step.arguments.risk) ?? "这次交谈没有需要随机决定的不确定性。",
      successOutcome: "对方回话了；那只是口头说法，不会自动变成已经确认的事实。",
      failureOutcome: "对方回话了；那只是口头说法，不会自动变成已经确认的事实。",
      costs: [],
    };
    return {
      actor,
      npc,
      plan: {
        schema: "zhuwei.social-resolution-plan/v1",
        rootActionId,
        actorCharacterId: actor.id,
        npcCharacterId: npc.id,
        sourceSceneId: actor.sceneId,
        programFactRef,
        programHash: program.semanticHash,
        program: structuredClone(program) as unknown as Record<string, unknown>,
        nodeRef: step.nodeRef,
        claimRef,
        threadRef,
        pendingInputId,
        claimSemantics,
        successResponse: structuredClone(successResponse),
        durationMicros,
        frozenCheck: directCheck,
        frozenBoundary: {
          base: 0,
          npcInsightModifier: 0,
          authorityModifier: 0,
          relationshipModifier: 0,
          evidenceModifier: 0,
          stakesModifier: 0,
          finalDc: 0,
          mutuallyKnownEvidenceRefs: evidenceRefs,
        },
        maximumInfluenceDegree: npc.socialMechanics.maximumInfluenceDegree,
        retryGate: [...RETRY_GATE],
      },
      directResponse: response,
    };
  }

  const ability = step.arguments.ability;
  const skill = scalarString(step.arguments.skill);
  const mode = step.arguments.mode;
  const proposedDc = scalarNumber(step.arguments.dc);
  if (!(ABILITIES as readonly unknown[]).includes(ability)
    || !(SOCIAL_SKILLS as readonly unknown[]).includes(skill)
    || !(MODES as readonly unknown[]).includes(mode)
    || proposedDc === undefined) return { rejection: "invalidCheck" };
  const modifier = skillCheckModifier(
    profiles,
    actor,
    ability as typeof ABILITIES[number],
    skill!,
  );
  if (modifier === undefined) return { rejection: "invalidCheck" };
  const trust = relationshipTrust(state, actor, npc);
  const npcInsightModifier = Number(npc.socialMechanics.skillModifiers.insight
    ?? Math.floor((npc.socialMechanics.abilityScores.wis - 10) / 2));
  const relationshipModifier = trust === 0 ? 0 : -2 * trust;
  const evidenceModifier = evidenceRefs.length === 0 ? 0 : -2 * evidenceRefs.length;
  const frozenStakesModifier = stakesModifier(proposedDc, npc.socialMechanics.stakesSensitivity);
  const finalDc = Math.max(5, Math.min(30,
    10
    + npcInsightModifier
    + npc.socialMechanics.authorityModifier
    + relationshipModifier
    + evidenceModifier
    + frozenStakesModifier));
  const goal = scalarString(step.arguments.goal) ?? claimSemantics.desiredBehavior;
  const method = scalarString(step.arguments.method) ?? "按已说出口的话继续交涉";
  const methodFingerprint = socialMethodFingerprint({
    ability: fullAbilityName(ability as typeof ABILITIES[number]),
    skill: skill!,
    method,
  });
  const utteranceFingerprint = socialUtteranceFingerprint(utterance);
  const resistanceFingerprint = socialResistanceFingerprint(
    state,
    actor,
    npc,
    evidenceRefs,
  );
  if (!options.skipRetryGate && hasMeaningfulSocialRetryChange(
    state,
    actor.id,
    npc.id,
    claimSemantics.topicFingerprint,
    methodFingerprint,
    utteranceFingerprint,
    actor.sceneId,
    evidenceRefs,
    resistanceFingerprint,
    claimSemantics.influenceGoal,
    claimSemantics.addressedThreadRef,
  ) === false) {
    return { rejection: "unchangedRetry" };
  }
  const preview = socialCheckPreview(goal);
  const frozenCheck: FrozenCheck = {
    kind: "skill",
    ability: fullAbilityName(ability as typeof ABILITIES[number]),
    skill: skill!,
    dc: String(finalDc),
    modifier: String(modifier),
    mode: mode as FrozenCheck["mode"],
    goal,
    method,
    risk: scalarString(step.arguments.risk)
      ?? "失败可能强化对方的当前怀疑，但不会自动改写真相或长期关系。",
    successOutcome: preview.successOutcome,
    failureOutcome: preview.failureOutcome,
    costs: [],
  };
  return {
    actor,
    npc,
    plan: {
      schema: "zhuwei.social-resolution-plan/v1",
      rootActionId,
      actorCharacterId: actor.id,
      npcCharacterId: npc.id,
      sourceSceneId: actor.sceneId,
      programFactRef,
      programHash: program.semanticHash,
      program: structuredClone(program) as unknown as Record<string, unknown>,
      nodeRef: step.nodeRef,
      claimRef,
      threadRef,
      pendingInputId,
      claimSemantics,
      successResponse: structuredClone(successResponse),
      durationMicros,
      frozenCheck,
      frozenBoundary: {
        base: 10,
        npcInsightModifier,
        authorityModifier: npc.socialMechanics.authorityModifier,
        relationshipModifier,
        evidenceModifier,
        stakesModifier: frozenStakesModifier,
        finalDc,
        mutuallyKnownEvidenceRefs: evidenceRefs,
      },
      maximumInfluenceDegree: npc.socialMechanics.maximumInfluenceDegree,
      retryGate: [...RETRY_GATE],
    },
  };
}

function frozenCheckShape(value: unknown): value is FrozenCheck {
  return isRecord(value)
    && hasExactKeys(value, [
      "ability", "costs", "dc", "failureOutcome", "goal", "kind", "method",
      "mode", "modifier", "risk", "skill", "successOutcome",
    ])
    && ["ability", "skill", "tool", "savingThrow"].includes(String(value.kind))
    && ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
      .includes(String(value.ability))
    && (value.skill === null || isNonEmptyString(value.skill))
    && ["normal", "advantage", "disadvantage"].includes(String(value.mode))
    && [value.dc, value.modifier, value.goal, value.method, value.risk,
      value.successOutcome, value.failureOutcome].every(isNonEmptyString)
    && Array.isArray(value.costs)
    && value.costs.every(isNonEmptyString);
}

export function isSocialResolutionPlan(value: unknown): value is SocialResolutionPlan {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "actorCharacterId", "claimRef", "durationMicros", "frozenBoundary", "frozenCheck",
      "claimSemantics", "maximumInfluenceDegree", "nodeRef", "npcCharacterId", "pendingInputId", "program",
      "programFactRef", "programHash", "retryGate", "rootActionId", "schema", "sourceSceneId",
      "successResponse", "threadRef",
    ])
    || value.schema !== "zhuwei.social-resolution-plan/v1"
    || ![
      value.rootActionId, value.actorCharacterId, value.npcCharacterId, value.sourceSceneId,
      value.programFactRef, value.programHash, value.nodeRef, value.claimRef, value.threadRef,
      value.pendingInputId, value.durationMicros,
    ].every(isNonEmptyString)
    || !/^fnv1a64:[0-9a-f]{16}$/u.test(String(value.programHash))
    || !/^[1-9][0-9]*$/u.test(String(value.durationMicros))
    || !isRecord(value.program)
    || !isSocialClaimSemantics(value.claimSemantics)
    || value.claimSemantics.targetNpcRef !== value.npcCharacterId
    || !isRecord(value.successResponse)
    || !hasExactKeys(value.successResponse, [
      "minimumDegree", "mode", "reactionKind", "sourceRefs", "speech",
    ])
    || !["reaction", "sourceBacked", "commitment"].includes(String(value.successResponse.mode))
    || !(MAXIMUM_DEGREES as readonly unknown[]).includes(value.successResponse.minimumDegree)
    || (value.successResponse.mode === "reaction"
      ? !["acknowledge", "decline", "askClarification", "redirect", "silence"]
        .includes(String(value.successResponse.reactionKind))
      : value.successResponse.reactionKind !== null)
    || !isNonEmptyString(value.successResponse.speech)
    || value.successResponse.speech.length > 800
    || !Array.isArray(value.successResponse.sourceRefs)
    || value.successResponse.sourceRefs.length > 4
    || !value.successResponse.sourceRefs.every(isNonEmptyString)
    || value.successResponse.sourceRefs.length !== new Set(value.successResponse.sourceRefs).size
    || (value.successResponse.mode === "reaction"
      ? value.successResponse.sourceRefs.length !== 0
      : value.successResponse.sourceRefs.length < 1)
    || !frozenCheckShape(value.frozenCheck)
    || !isRecord(value.frozenBoundary)
    || !hasExactKeys(value.frozenBoundary, [
      "authorityModifier", "base", "evidenceModifier", "finalDc", "mutuallyKnownEvidenceRefs",
      "npcInsightModifier", "relationshipModifier", "stakesModifier",
    ])
    || ![
      value.frozenBoundary.authorityModifier,
      value.frozenBoundary.base,
      value.frozenBoundary.evidenceModifier,
      value.frozenBoundary.finalDc,
      value.frozenBoundary.npcInsightModifier,
      value.frozenBoundary.relationshipModifier,
      value.frozenBoundary.stakesModifier,
    ].every(Number.isSafeInteger)
    || !Array.isArray(value.frozenBoundary.mutuallyKnownEvidenceRefs)
    || !value.frozenBoundary.mutuallyKnownEvidenceRefs.every(isNonEmptyString)
    || !(MAXIMUM_DEGREES as readonly unknown[]).includes(value.maximumInfluenceDegree)
    || !Array.isArray(value.retryGate)
    || value.retryGate.length !== RETRY_GATE.length
    || !value.retryGate.every((entry, index) => entry === RETRY_GATE[index])) return false;
  const validation = validateCausalActionProgram(value.program);
  if (!validation.ok) return false;
  const program = value.program as unknown as CausalActionProgram;
  if (program.formRef !== "npc-exchange.v1"
    || program.semanticHash !== value.programHash
    || !validateExecutableCausalActionProgram(program)
    || value.programFactRef !== causalProgramFactRef(
      String(value.rootActionId),
      String(value.programHash),
    )) return false;
  const step = lowerCausalActionProgram(program).steps[0];
  const utterance = step === undefined ? undefined : scalarString(step.arguments.utterance);
  const responseMinimum = value.successResponse.minimumDegree as keyof typeof SUCCESS_DEGREE_RANK;
  const maximumDegree = value.maximumInfluenceDegree as keyof typeof SUCCESS_DEGREE_RANK;
  return step?.nodeRef === value.nodeRef
    && (step.arguments.resolution === "direct"
      || SUCCESS_DEGREE_RANK[responseMinimum] <= SUCCESS_DEGREE_RANK[maximumDegree])
    && (step.arguments.resolution === "direct"
      || socialCheckResponseAllowed(value.claimSemantics.influenceGoal, {
        mode: value.successResponse.mode as SocialNpcResponse["mode"],
        reactionKind: value.successResponse.reactionKind as SocialNpcResponse["reactionKind"],
      }))
    && utterance !== undefined
    && (value.claimSemantics.addressedThreadRef !== null
      || value.claimSemantics.topicFingerprint === socialTopicFingerprint(
        String(value.npcCharacterId),
        value.claimSemantics.assertion,
        utterance,
      ))
    && causalActionDurationMicros(step) === value.durationMicros
    && value.claimRef === `claim:social:${value.rootActionId}:${value.programHash.slice("fnv1a64:".length)}`
    && value.threadRef === `conversation-thread:${value.rootActionId}:${value.programHash.slice("fnv1a64:".length)}`
    && value.pendingInputId === `pending-input:social:${value.rootActionId}:${value.programHash.slice("fnv1a64:".length)}`;
}

/** Re-derives every Rules-owned field from the authoritative state. Shape and
 * hashes alone are insufficient because a forged archive could keep those
 * internally consistent while changing the target, modifier, or boundary. */
export function socialResolutionPlanMatchesState(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  value: unknown,
): value is SocialResolutionPlan {
  if (!isSocialResolutionPlan(value) || value.rootActionId !== rootActionId) return false;
  const actor = state.entities[value.actorCharacterId];
  if (actor?.kind !== "player" || actor.tenureStatus !== "active") return false;
  const derived = deriveSocialResolutionPlan(
    profiles,
    state,
    actor,
    value.program as unknown as CausalActionProgram,
    rootActionId,
    { skipRetryGate: true },
  );
  return derived !== undefined
    && !("rejection" in derived)
    && canonicalSha256(derived.plan) === canonicalSha256(value);
}

export function socialDegreeForMargin(margin: number): SocialInfluenceDegree {
  if (margin <= -5) return "strongFailure";
  if (margin < 0) return "failure";
  if (margin < 5) return "limitedSuccess";
  if (margin < 10) return "fullSuccess";
  return "strongSuccess";
}

export function capSocialDegree(
  degree: SocialInfluenceDegree,
  maximum: SocialResolutionPlan["maximumInfluenceDegree"],
): SocialInfluenceDegree {
  if (degree === "strongFailure" || degree === "failure") return degree;
  const ranks = { limitedSuccess: 0, fullSuccess: 1, strongSuccess: 2 } as const;
  return ranks[degree] > ranks[maximum] ? maximum : degree;
}

export function socialRelationshipId(actorId: string, npcId: string): string {
  return relationshipId(actorId, npcId);
}

export function currentSocialTrust(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  npc: CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord },
): number {
  return relationshipTrust(state, actor, npc);
}

export function isSocialRandomnessEventBinding(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  payload: unknown,
): boolean {
  if (!isRecord(payload)
    || !socialContinuationBindingCore(
      profiles,
      state,
      rootActionId,
      payload.request,
      payload.continuation,
      payload.resolutionPlan,
    )
    || !isRecord(payload.continuation)
    || !isSocialResolutionPlan(payload.resolutionPlan)) return false;
  const plan = payload.resolutionPlan;
  return payload.continuation.capability === canonicalSha256({
    kind: "roomAuthorityRandomness",
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    stateHash: hashWorldState(state),
    rootActionId,
    request: payload.request,
    resolutionPlan: plan,
  });
}

function socialContinuationBindingCore(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  requestValue: unknown,
  continuationValue: unknown,
  planValue: unknown,
): boolean {
  if (!socialResolutionProfileEnabled(profiles.extensions)
    || !isRecord(requestValue)
    || !isRecord(continuationValue)
    || !isSocialResolutionPlan(planValue)
    || planValue.rootActionId !== rootActionId) return false;
  const plan = planValue;
  const actor = state.entities[plan.actorCharacterId];
  const npc = state.entities[plan.npcCharacterId];
  const fact = state.canonicalFacts[plan.programFactRef];
  const thread = state.campaignRuntime.conversationThreads?.[plan.threadRef];
  const program = plan.program as unknown as CausalActionProgram;
  const expectedRequest = {
    randomnessId: `randomness:${rootActionId}:social:${plan.nodeRef}`,
    resolutionId: `resolution:${rootActionId}:social:${plan.nodeRef}`,
    actorCharacterId: plan.actorCharacterId,
    purpose: "improvisedCheck",
    diceExpression: plan.frozenCheck.mode === "normal" ? "1d20"
      : plan.frozenCheck.mode === "advantage" ? "2d20kh1" : "2d20kl1",
    frozenCheck: plan.frozenCheck,
  };
  const expectedContinuationId = `continuation:${expectedRequest.resolutionId}`;
  return actor?.kind === "player"
    && actor.tenureStatus === "active"
    && npc?.kind === "npc"
    && npc.tenureStatus === "active"
    && isNpcSocialMechanics(npc.socialMechanics)
    && actor.sceneId === plan.sourceSceneId
    && npc.sceneId === plan.sourceSceneId
    && socialParticipantsCoPresent(state, actor, npc)
    && fact?.kind === "causalActionProgram"
    && thread?.planHash === canonicalSha256(plan)
    && fact.source === "characterAction"
    && fact.subjectRefs.length === 1
    && fact.subjectRefs[0] === actor.id
    && isRecord(fact.value)
    && canonicalSha256(fact.value) === canonicalSha256(causalProgramFactValue(program))
    && continuationValue.kind === "roomAuthorityRandomness"
    && continuationValue.continuationId === expectedContinuationId
    && canonicalSha256(requestValue) === canonicalSha256(expectedRequest);
}

/** Rechecks all derivable fields retained after RandomnessRequested. The
 * historical pre-event state hash remains protected by the event capability
 * during creation and replay. */
export function isSocialContinuationStateBinding(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  stored: InternalContinuationRecord,
): boolean {
  return stored.continuation.continuationId === continuationId
    && socialContinuationBindingCore(
      profiles,
      state,
      stored.rootActionId,
      stored.request,
      stored.continuation,
      stored.resolutionPlan,
    );
}
