import { socialUtteranceFingerprint, socialMethodFingerprint, socialParticipantsCoPresent } from "./social-primitives";
export { socialUtteranceFingerprint, socialMethodFingerprint, socialParticipantsCoPresent } from "./social-primitives";

import { canonicalSha256 } from "../profiles/canonical";

import {
  AuthoritativeWorldState,
  CharacterRecord,
  ConversationThreadRecord,
  NpcSocialMechanicsRecord,
  SocialClaimSemantics,
  SocialInfluenceDegree,
  SocialNpcResponse,
  SocialResolutionPlan,
} from "./model";
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";
const MAXIMUM_DEGREES = ["limitedSuccess", "fullSuccess", "strongSuccess"] as const;
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

export function currentSocialTrust(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  npc: CharacterRecord & { socialMechanics: NpcSocialMechanicsRecord },
): number {
  return relationshipTrust(state, actor, npc);
}

/** Legacy events cannot consume the structurally different vNext thread. */
export function legacySocialThread(state: AuthoritativeWorldState, ref: string): ConversationThreadRecord | undefined {
  const thread = state.campaignRuntime.conversationThreads?.[ref];
  return thread && thread.schema !== "zhuwei.social-conversation/vnext-1" && isSocialClaimSemantics(thread.claimSemantics)
    ? thread as ConversationThreadRecord : undefined;
}
