import { sameCanonical } from "../profiles/canonical";
import { canonicalSha256 } from "../profiles/canonical";
import type { ProfileRef, Sha256Ref } from "../profiles/types";
import { RulesValidationError } from "../errors";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, FrozenCheck } from "./model";

// SPEC 0004 §§11、12 (ADR 0083): a KP's improvised ruling on an attempt -- a
// check outside a conversation, or a refusal -- is recorded once, by an
// AdjudicationPrecedentRecorded event that follows the ruling's own event in
// the same RootAction. The KP reads it in later relevant actions; a player
// does not. A conversation already has its record (conversationThreads) and
// is not copied here. Actions admitted before this records nothing, so
// replaying an existing room adds no records.

export const PRECEDENT_CONDITION_SIGNATURE_SCHEMA = "zhuwei.precedent-condition-signature/vnext-1" as const;
export const VNEXT_RULING_PRECEDENT_SCHEMA = "zhuwei.ruling-precedent/vnext-1" as const;
/** The form of a refusal record; a check keeps the form of the step it ruled. */
export const VNEXT_REFUSAL_PRECEDENT_FORM_ID = "in-world-refusal.vnext-1" as const;

export type VNextRulingPrecedentCheck = Readonly<{
  kind: "check";
  resolutionId: string;
  abilityRef: string | null;
  checkKind: FrozenCheck["kind"];
  ability: FrozenCheck["ability"];
  skill: string | null;
  /** Null on a contest, which names its opponent instead (SPEC 0004 §4). */
  dc: number | null;
  opposition?: Readonly<{ opponentRef: string; ability: FrozenCheck["ability"]; skill: string | null }>;
  /** The act's frozen duration; null when it froze none. */
  durationMicros: string | null;
  outcomeRange: Readonly<{ success: string; failure: string }>;
  outcome: "success" | "failure";
}>;
export type VNextRulingPrecedentRefusal = Readonly<{
  kind: "refusal";
  rulingKind: "missingPrerequisite" | "worldLawViolation";
  prerequisites: EventPayloadByType["WorldInteractionFeasibilityRuled"]["prerequisites"];
  nextActions: EventPayloadByType["WorldInteractionFeasibilityRuled"]["nextActions"];
}>;

/** The event's payload. Everything a later ruling needs to stay consistent:
 * the situation (scene, targets, tools, and the frozen context's hash), what
 * was tried, the public explanation, the KP-only basis, the mechanics and the
 * ruleset version. */
export type VNextRulingPrecedentPayload = Readonly<{
  schema: typeof VNEXT_RULING_PRECEDENT_SCHEMA;
  precedentId: string;
  rulingEventId: string;
  actorCharacterId: string;
  conditionSignature: Readonly<{
    schema: typeof PRECEDENT_CONDITION_SIGNATURE_SCHEMA;
    scope: Readonly<{ kind: "scene"; ref: string }>;
    formId: string;
    targetRefs: readonly string[];
    instrumentRefs: readonly string[];
  }>;
  canonicalContextFingerprint: Sha256Ref;
  intent: string;
  method: string;
  publicExplanation: string;
  privateBasisRefs: readonly string[];
  rulesetProfile: ProfileRef;
  ruling: VNextRulingPrecedentCheck | VNextRulingPrecedentRefusal;
}>;

/** The record Rules keeps: the payload, its status and where it was made. */
export type VNextRulingPrecedent = VNextRulingPrecedentPayload & Readonly<{
  status: "active";
  rootActionId: string;
  recordedEventSeq: string;
}>;

/** One identity per ruling: a check by its resolution, a refusal by its
 * attempt. Both are known before the events are appended. */
export function rulingPrecedentId(rootActionId: string, ruling: Readonly<{ resolutionId: string }>
  | Readonly<{ refusal: Readonly<{ intent: string; method: string }> }>): string {
  return `precedent:${canonicalSha256({ rootActionId, ...ruling }).slice("sha256:".length, "sha256:".length + 24)}`;
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 4_000 && value.trim() === value && value.normalize("NFC") === value;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const refs = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length <= 256 && value.every(text)
  && new Set(value).size === value.length && [...value].sort().every((ref, index) => ref === value[index]);
const CHECK_KINDS = new Set(["ability", "skill", "tool", "savingThrow"]);
const ABILITIES = new Set(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]);

export function isVNextRulingPrecedentPayload(value: unknown): value is VNextRulingPrecedentPayload {
  if (!record(value) || !keys(value, ["schema", "precedentId", "rulingEventId", "actorCharacterId", "conditionSignature",
    "canonicalContextFingerprint", "intent", "method", "publicExplanation", "privateBasisRefs", "rulesetProfile", "ruling"])
    || value.schema !== VNEXT_RULING_PRECEDENT_SCHEMA || ![value.precedentId, value.rulingEventId, value.actorCharacterId,
      value.intent, value.method, value.publicExplanation].every(text)
    || typeof value.canonicalContextFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.canonicalContextFingerprint)
    || !refs(value.privateBasisRefs) || !record(value.rulesetProfile) || !keys(value.rulesetProfile, ["profileHash", "profileId"])
    || !text(value.rulesetProfile.profileId) || !text(value.rulesetProfile.profileHash)) return false;
  const condition = value.conditionSignature, ruling = value.ruling;
  if (!record(condition) || !keys(condition, ["schema", "scope", "formId", "targetRefs", "instrumentRefs"])
    || condition.schema !== PRECEDENT_CONDITION_SIGNATURE_SCHEMA || !record(condition.scope) || !keys(condition.scope, ["kind", "ref"])
    || condition.scope.kind !== "scene" || !text(condition.scope.ref) || !text(condition.formId)
    || !refs(condition.targetRefs) || !refs(condition.instrumentRefs) || !record(ruling)) return false;
  if (ruling.kind === "refusal") {
    return condition.formId === VNEXT_REFUSAL_PRECEDENT_FORM_ID
      && keys(ruling, ["kind", "rulingKind", "prerequisites", "nextActions"])
      && (ruling.rulingKind === "missingPrerequisite" || ruling.rulingKind === "worldLawViolation")
      && Array.isArray(ruling.prerequisites) && ruling.prerequisites.length <= 8 && Array.isArray(ruling.nextActions) && ruling.nextActions.length <= 8;
  }
  const opposition = ruling.opposition;
  return ruling.kind === "check" && (condition.formId === "world-interaction.vnext-1" || condition.formId === "observe.vnext-1")
    && keys(ruling, ["kind", "resolutionId", "abilityRef", "checkKind", "ability", "skill", "dc", "durationMicros", "outcomeRange", "outcome",
      ...(opposition === undefined ? [] : ["opposition"])])
    && (opposition === undefined ? Number.isSafeInteger(ruling.dc) : ruling.dc === null && record(opposition)
      && keys(opposition, ["opponentRef", "ability", "skill"]) && text(opposition.opponentRef) && ABILITIES.has(String(opposition.ability))
      && (opposition.skill === null || (typeof opposition.skill === "string" && opposition.skill.length > 0 && opposition.skill.length <= 200)))
    && text(ruling.resolutionId) && (ruling.abilityRef === null || text(ruling.abilityRef))
    && CHECK_KINDS.has(String(ruling.checkKind)) && ABILITIES.has(String(ruling.ability))
    && (ruling.skill === null || (typeof ruling.skill === "string" && ruling.skill.length > 0 && ruling.skill.length <= 200))
    && (ruling.durationMicros === null || (typeof ruling.durationMicros === "string" && /^[1-9][0-9]*$/u.test(ruling.durationMicros)))
    // The frozen check's own wording, as its validator admitted it.
    && record(ruling.outcomeRange) && keys(ruling.outcomeRange, ["success", "failure"])
    && [ruling.outcomeRange.success, ruling.outcomeRange.failure].every(value => typeof value === "string" && value.length <= 8_000)
    && (ruling.outcome === "success" || ruling.outcome === "failure");
}

/** Records the precedent once, after proving it says what the ruling event it
 * follows says: the same RootAction, actor, situation and result. The fields
 * the ruling event does not carry come from the same frozen plan. */
export function recordRulingPrecedent(state: AuthoritativeWorldState, event: EventEnvelope<"AdjudicationPrecedentRecorded">): void {
  const payload = event.payload as unknown as VNextRulingPrecedentPayload;
  const precedents = state.campaignRuntime.adjudicationPrecedents;
  const ruled = state.correctionRuntime.audit[payload.rulingEventId];
  const ruling = ruled?.payload as Record<string, unknown> | undefined;
  if (precedents[payload.precedentId] !== undefined || ruled === undefined || ruling === undefined
    || ruled.rootActionId !== event.rootActionId || ruled.branchId !== event.branchId || BigInt(ruled.eventSeq) >= BigInt(event.eventSeq)
    || ruling.actorCharacterId !== payload.actorCharacterId || !rulingMatches(event.rootActionId, ruled.eventType, ruling, payload)) {
    throw new RulesValidationError("precedent:ruling-event-mismatch");
  }
  precedents[payload.precedentId] = structuredClone({ ...payload, status: "active", rootActionId: event.rootActionId,
    recordedEventSeq: event.eventSeq }) as unknown as typeof precedents[string];
}

function rulingMatches(rootActionId: string, eventType: string, ruling: Record<string, unknown>, payload: VNextRulingPrecedentPayload): boolean {
  const condition = payload.conditionSignature, mechanics = payload.ruling;
  if (eventType === "WorldInteractionResolved") {
    const check = ruling.check as Record<string, unknown> | null;
    return mechanics.kind === "check" && ruling.social === undefined && ruling.rulingKind === "check" && record(check)
      && payload.precedentId === rulingPrecedentId(rootActionId, { resolutionId: mechanics.resolutionId })
      && ruling.resolutionId === mechanics.resolutionId && ruling.sceneRef === condition.scope.ref
      && condition.formId === (ruling.observation === true ? "observe.vnext-1" : "world-interaction.vnext-1")
      && sameCanonical(ruling.targetRefs, condition.targetRefs) && sameCanonical(ruling.instrumentRefs, condition.instrumentRefs)
      && ruling.contextHash === payload.canonicalContextFingerprint && sameCanonical(ruling.basisRefs, payload.privateBasisRefs)
      && ruling.abilityRef === mechanics.abilityRef && (check.dc ?? null) === mechanics.dc && ruling.branch === mechanics.outcome
      && sameCanonical(record(check.opposition) ? { opponentRef: check.opposition.opponentRef, ability: check.opposition.ability,
        skill: check.opposition.skill } : null, mechanics.opposition ?? null)
      && ruling.summary === payload.publicExplanation;
  }
  return eventType === "WorldInteractionFeasibilityRuled" && mechanics.kind === "refusal"
    && payload.precedentId === rulingPrecedentId(rootActionId, { refusal: { intent: payload.intent, method: payload.method } })
    && ruling.intent === payload.intent && ruling.method === payload.method && ruling.rulingKind === mechanics.rulingKind
    && ruling.publicBasis === payload.publicExplanation && sameCanonical(ruling.prerequisites, mechanics.prerequisites)
    && sameCanonical(ruling.nextActions, mechanics.nextActions)
    && sameCanonical(condition.targetRefs, [...new Set(mechanics.prerequisites.flatMap(({ ref }) => ref === null ? [] : [ref]))].sort())
    && condition.instrumentRefs.length === 0;
}

export function isVNextRulingPrecedent(value: unknown): value is VNextRulingPrecedent {
  if (!record(value)) return false;
  const { status, rootActionId, recordedEventSeq, ...payload } = value;
  return status === "active" && text(rootActionId) && typeof recordedEventSeq === "string" && /^[1-9][0-9]*$/u.test(recordedEventSeq)
    && isVNextRulingPrecedentPayload(payload);
}
