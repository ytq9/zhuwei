import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, EventType, JsonRecord, StepResult } from "./model";
import type { Sha256Ref } from "../profiles/types";
import type { NpcDecisionContext } from "./npc-decision-context";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";
import { authorityReadSetMatches, authoritySpatialRefVisibleTo } from "./authority-bindings";
import { actorPlanNpcIsAvailable, actorPlanPremiseIsAvailable, actorPlanPremiseScope, actorPlanResourceScopes, actorPlanResourcesAreAvailable, actorPlanTriggerIsAvailable } from "./actor-plans";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isNonEmptyString, isProfileRef, isRecord } from "./validation";
import { rejected } from "./results";

type Draft = { eventType: EventType; payload: EventPayloadByType[EventType]; visibilityPolicyId?: string;
  secrecy?: EventEnvelope["secrecy"]; reads?: string[]; writes?: string[]; creates?: string[] };
function canonicalStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length ? [...value].sort() : undefined;
}

export const NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA = "zhuwei.npc-actor-plan-formation/vnext-1" as const;
/** Identity is fixed by the authority root and frozen proposal slot, never
 * by revised prose, resource selections or prospective model handles. */
export function npcActorPlanFormationIds(rootActionId: string, proposalRef: string) {
  const id = canonicalSha256({ kind: "npcActorPlanFormation", rootActionId, proposalRef }).slice("sha256:".length);
  return { planId: `npc-plan:${id}`, activityId: `activity:npc-plan:${id}`, traceFactRef: `fact:npc-plan-trace:${id}` };
}
export type NpcActorPlanFormationSource = Readonly<{
  npcRef: string; factionRef: string | null; goal: string; nextStep: string;
  premiseRefs: readonly string[]; resourceRefs: readonly string[]; durationMicros: string;
  traceDescription: string; alternateTargetRef: string; alternateReason: string;
}>;
export type NpcActorPlanFormationPlan = Readonly<{
  schema: typeof NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA; contextHash: Sha256Ref;
  readSet: readonly VersionedAuthorityBinding[]; planId: string; activityId: string; traceFactRef: string;
  source: NpcActorPlanFormationSource;
}>;
const sourceKeys = ["npcRef", "factionRef", "goal", "nextStep", "premiseRefs", "resourceRefs",
  "durationMicros", "traceDescription", "alternateTargetRef", "alternateReason"] as const;
const refSchema = Object.freeze({ type: "string", minLength: 1, maxLength: 240, pattern: "^\\S+$" });
const textSchema = Object.freeze({ type: "string", minLength: 1, maxLength: 480 });
export const NPC_ACTOR_PLAN_FORMATION_SOURCE_SCHEMA = Object.freeze({ type: "object", additionalProperties: false,
  required: [...sourceKeys], properties: {
    npcRef: refSchema, factionRef: { anyOf: [refSchema, { type: "null" }] },
    goal: textSchema, nextStep: textSchema,
    premiseRefs: { type: "array", minItems: 1, maxItems: 40, uniqueItems: true, items: refSchema },
    resourceRefs: { type: "array", maxItems: 40, uniqueItems: true, items: refSchema },
    durationMicros: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 16 },
    traceDescription: textSchema, alternateTargetRef: refSchema, alternateReason: textSchema,
  } });
export type NpcActorPlanFormationShapeDiagnostic = { path: readonly (string | number)[]; constraint: string;
  code: "FIELD_MISSING" | "TYPE_MISMATCH" | "VALUE_INVALID" | "CONSTRAINT_CONFLICT";
  expected: Readonly<Record<string, unknown>> };
const canonicalText = (value: unknown, max: number): value is string => isNonEmptyString(value)
  && value.trim().length > 0 && value.length <= max && value.normalize("NFC") === value;
const canonicalRef = (value: unknown): value is string => canonicalText(value, 240) && /^\S+$/u.test(value);
/** This predicate emits the same closed field contract consumed by KP. No
 * source decision is normalized or inferred during shape validation. */
export function npcActorPlanFormationSourceConform(value: unknown, diagnostics?: NpcActorPlanFormationShapeDiagnostic[]): value is NpcActorPlanFormationSource {
  let valid = true;
  const fail = (path: string, reason: string, expected: Record<string, unknown>, code: NpcActorPlanFormationShapeDiagnostic["code"] = "VALUE_INVALID") => {
    valid = false; diagnostics?.push({ path: path === "" ? [] : path.slice(1).split("/").map(part => /^[0-9]+$/u.test(part) ? Number(part) : part.replaceAll("~1", "/").replaceAll("~0", "~")), constraint: reason, expected, code });
  };
  if (!isRecord(value)) { fail("", "expected a timer plan source object", { type: "object" }, "TYPE_MISMATCH"); return false; }
  for (const key of sourceKeys) if (!Object.hasOwn(value, key)) fail(`/${key}`, "required plan decision is missing", { required: true }, "FIELD_MISSING");
  for (const key of Object.keys(value)) if (!(sourceKeys as readonly string[]).includes(key)) {
    fail(`/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, "field is outside the timer plan contract", { authorable: false }, "CONSTRAINT_CONFLICT");
  }
  for (const key of ["npcRef", "alternateTargetRef"] as const) if (Object.hasOwn(value, key) && !canonicalRef(value[key])) {
    fail(`/${key}`, "expected a canonical reference", refSchema, typeof value[key] === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH");
  }
  if (Object.hasOwn(value, "factionRef") && value.factionRef !== null && !canonicalRef(value.factionRef)) fail("/factionRef", "expected a faction reference or null", { anyOf: [refSchema, { type: "null" }] }, typeof value.factionRef === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH");
  for (const key of ["goal", "nextStep", "traceDescription", "alternateReason"] as const) if (Object.hasOwn(value, key) && !canonicalText(value[key], 480)) {
    fail(`/${key}`, "expected nonempty NFC text within 480 characters", textSchema, typeof value[key] === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH");
  }
  if (Object.hasOwn(value, "durationMicros") && !(typeof value.durationMicros === "string"
    && /^[1-9][0-9]*$/u.test(value.durationMicros) && value.durationMicros.length <= 16
    && BigInt(value.durationMicros) <= BigInt(Number.MAX_SAFE_INTEGER))) {
    fail("/durationMicros", "expected a positive safe integer microsecond string", { type: "string", pattern: "^[1-9][0-9]*$", maximum: String(Number.MAX_SAFE_INTEGER) }, typeof value.durationMicros === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH");
  }
  for (const key of ["premiseRefs", "resourceRefs"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const refs = value[key];
    if (!Array.isArray(refs)) { fail(`/${key}`, "expected a reference array", { type: "array" }, "TYPE_MISMATCH"); continue; }
    if (refs.length > 40 || (key === "premiseRefs" && refs.length === 0)) fail(`/${key}`, "reference count exceeds the plan contract", { minItems: key === "premiseRefs" ? 1 : 0, maxItems: 40 });
    for (const [index, ref] of refs.entries()) {
      if (!canonicalRef(ref)) fail(`/${key}/${index}`, "expected a canonical reference", refSchema, typeof ref === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH");
      if (refs.indexOf(ref) !== index) fail(`/${key}/${index}`, "each reference must occur once", { uniqueItems: true }, "CONSTRAINT_CONFLICT");
    }
  }
  return valid;
}
export function isNpcActorPlanFormationPlan(value: unknown): value is NpcActorPlanFormationPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "planId", "activityId", "traceFactRef", "source"])
    && value.schema === NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA
    && typeof value.contextHash === "string" && /^sha256:[0-9a-f]{64}$/u.test(value.contextHash)
    && isCanonicalReadSet(value.readSet) && [value.planId, value.activityId, value.traceFactRef].every(canonicalRef)
    && npcActorPlanFormationSourceConform(value.source);
}

/** Resolve only entries in the already verified own-NPC snapshot. Scene,
 * conversation and sourceClaim records are not first-version plan premises. */
export function npcActorPlanFormationPremiseRef(context: NpcDecisionContext, submittedRef: string): string | undefined {
  const knowledge = context.knowledge.find(entry => entry.entryRef === submittedRef || entry.knowledgeRef === submittedRef);
  if (knowledge) return knowledge.knowledgeRef;
  const record = context.records.find(entry => entry.ref === submittedRef);
  if (!record) return undefined;
  if (record.kind === "self") return record.ref === context.npcRef ? record.ref : undefined;
  if (record.kind === "identity") return record.ref;
  if (!isRecord(record.value)) return undefined;
  if (record.kind === "relationship" && Array.isArray(record.value.subjectIds) && record.value.subjectIds.includes(context.npcRef)
    && isNonEmptyString(record.value.relationshipId)) return record.value.relationshipId;
  if (record.kind === "promise" && record.value.status === "active"
    && [record.value.promisorId, record.value.promiseeId].includes(context.npcRef) && isNonEmptyString(record.value.promiseId)) return record.value.promiseId;
  if (record.kind === "debt" && record.value.status === "active"
    && [record.value.debtorId, record.value.creditorId].includes(context.npcRef) && isNonEmptyString(record.value.debtId)) return record.value.debtId;
  return undefined;
}
export function npcActorPlanFormationResourceRefs(state: AuthoritativeWorldState, npcRef: string,
  factionRef: string | null, selectedPersonalRefs: readonly string[]): readonly string[] | undefined {
  if (!actorPlanNpcIsAvailable(state.entities[npcRef]) || !Array.isArray(selectedPersonalRefs)
    || !selectedPersonalRefs.every(canonicalRef) || new Set(selectedPersonalRefs).size !== selectedPersonalRefs.length) return undefined;
  const factionResources = factionRef === null ? [] : state.campaignRuntime.factions[factionRef]?.resourceRefs;
  if (!Array.isArray(factionResources) || !factionResources.every(canonicalRef)) return undefined;
  const refs = [...new Set([...selectedPersonalRefs, ...(factionRef === null ? [] : [factionRef, ...factionResources])])].sort();
  return refs.length <= 40 && actorPlanResourcesAreAvailable(state, npcRef, factionRef, refs) ? refs : undefined;
}
/** Authority addresses only. The caller must bind every returned ref from its
 * frozen RequiredContext/NPC directory, never fetch a new revision here. */
export function npcActorPlanFormationReadRefs(state: AuthoritativeWorldState, source: NpcActorPlanFormationSource): string[] | undefined {
  const npc = state.entities[source.npcRef];
  const chapterId = state.campaignRuntime.campaign?.currentChapterId;
  if (!actorPlanNpcIsAvailable(npc) || !isNonEmptyString(chapterId)
    || !source.premiseRefs.every(ref => actorPlanPremiseIsAvailable(state, npc.id, ref))
    || !actorPlanResourcesAreAvailable(state, npc.id, source.factionRef, source.resourceRefs)) return undefined;
  const refs = [npc.id, npc.sceneId, `character-timeline:${npc.id}`, "continuity:campaign", `continuity:chapters:${chapterId}`, source.alternateTargetRef];
  for (const ref of source.premiseRefs) {
    if (ref === npc.id || ref === npc.semanticDefinitionRef) refs.push(ref);
    else if (ref in (state.knowledge[npc.id] ?? {})) refs.push(`knowledge:${npc.id}:${ref}`);
    else for (const collection of ["relationships", "promises", "debts"] as const) {
      if (ref in state.campaignRuntime[collection]) { refs.push(`continuity:${collection}:${ref}`); break; }
    }
  }
  if (source.factionRef !== null) refs.push(`continuity:factions:${source.factionRef}`);
  return [...new Set(refs)].sort();
}

/** Must run against the original transaction source before read-set rebinding.
 * Existing-source membership prevents a prior Bundle step from manufacturing
 * a social/knowledge basis or a previously unavailable plan actor. */
export function frozenNpcActorPlanFormationIssue(state: AuthoritativeWorldState, actorRef: string,
  plan: NpcActorPlanFormationPlan): string | undefined {
  const refs = npcActorPlanFormationReadRefs(state, plan.source);
  if (!refs || refs.some(ref => !plan.readSet.some(binding => binding.ref === ref))) return "actor-plan:required-own-premises-and-resources-must-be-frozen-before-the-bundle";
  if (!authorityReadSetMatches(state, plan.readSet)) return "actor-plan:frozen-source-binding-unavailable-or-changed";
  const actor = state.entities[actorRef], npc = state.entities[plan.source.npcRef];
  if (actor?.tenureStatus !== "active" || !npc || actor.sceneId !== npc.sceneId) return "actor-plan:selected-npc-must-be-in-the-acting-scene";
  if (plan.source.alternateTargetRef !== npc.sceneId && !authoritySpatialRefVisibleTo(state, plan.source.alternateTargetRef, npc.sceneId, npc.id)) {
    return "actor-plan:alternate-target-must-be-an-existing-perceptible-target-in-the-npc-scene";
  }
  return undefined;
}

/** Shared live state guard, also applied when folding formal replay events. */
export function npcActorPlanFormationStateIssue(state: AuthoritativeWorldState, payload: EventPayloadByType["NpcPlanFormed"]): string | undefined {
  const runtime = state.campaignRuntime, npc = state.entities[payload.npcId];
  if (!actorPlanNpcIsAvailable(npc)) return "ActorPlan NPC is unavailable.";
  const chapter = runtime.chapters[payload.chapterId], timelineId = characterTimelineId(state, npc.id);
  if (payload.planId in runtime.npcPlans || payload.trace.factRef in state.canonicalFacts || payload.trace.factRef in runtime.definitions
    || payload.activity.activityId in runtime.activities || payload.activity.activityKind === "stableRecovery2014"
    || Object.values(runtime.activities).some(activity => activity.status === "active" && activity.characterId === npc.id)) return "ActorPlan identity or active Activity conflicts.";
  if (runtime.campaign?.currentChapterId !== payload.chapterId || chapter?.status !== "active" || !isProfileRef(chapter.moduleRef)
    || chapter.moduleRef.profileId !== payload.moduleRef.profileId || chapter.moduleRef.profileHash !== payload.moduleRef.profileHash) return "ActorPlan active chapter pin is unavailable.";
  if (!actorPlanResourcesAreAvailable(state, npc.id, payload.factionRef, payload.resourceRefs)
    || payload.premiseRefs.some(ref => !actorPlanPremiseIsAvailable(state, npc.id, ref))) return "ActorPlan own premises or resources are unavailable.";
  if (!(payload.alternateTarget.targetRef in state.entities) && !(payload.alternateTarget.targetRef in state.scenes)) return "ActorPlan alternate target is unavailable.";
  if (timelineId === undefined || (payload.due !== null && (BigInt(state.fictionTimelines[timelineId].nowMicros)
    + BigInt(payload.activity.intendedDurationMicros)).toString() !== payload.due.atFictionMicros)
    || (payload.trigger !== null && !actorPlanTriggerIsAvailable(state, npc.id, payload.trigger))) return "ActorPlan timer or known trigger is unavailable.";
  return undefined;
}

export function prepareFrozenNpcActorPlanFormation(state: AuthoritativeWorldState, plan: NpcActorPlanFormationPlan) {
  const source = plan.source, timelineId = characterTimelineId(state, source.npcRef);
  if (timelineId === undefined) return rejected("invalidWorldState", "ActorPlan NPC timeline is unavailable.");
  return prepareNpcActorPlanFormation(state, {
    kind: "formNpcActorPlan", npcId: source.npcRef, factionRef: source.factionRef, planId: plan.planId,
    goal: source.goal, nextStep: source.nextStep, premiseRefs: [...source.premiseRefs], resourceRefs: [...source.resourceRefs],
    activity: { activityId: plan.activityId, activityKind: "npcActorPlan", intendedDurationMicros: source.durationMicros },
    due: { kind: "fictionTime", atFictionMicros: (BigInt(state.fictionTimelines[timelineId].nowMicros) + BigInt(source.durationMicros)).toString() }, trigger: null,
    trace: { factRef: plan.traceFactRef, description: source.traceDescription, visibilityPolicyRef: "visibility:scene-observers" },
    alternateTarget: { targetRef: source.alternateTargetRef, reason: source.alternateReason },
  });
}

/** Pure validation and event drafts shared by the continued legacy command
 * and the atomic executor. Only each caller's event interpreter commits. */
export function prepareNpcActorPlanFormation(state: AuthoritativeWorldState, input: JsonRecord):
  { kind: "accepted"; drafts: Draft[] } | Extract<StepResult, { kind: "rejected" }> {
  const npc = isNonEmptyString(input.npcId) ? state.entities[input.npcId] : undefined;
  const factionRef = input.factionRef === null
    ? null
    : isNonEmptyString(input.factionRef)
      ? input.factionRef
      : undefined;
  const planId = isNonEmptyString(input.planId) ? input.planId : undefined;
  const goal = isNonEmptyString(input.goal) ? input.goal : undefined;
  const nextStep = isNonEmptyString(input.nextStep) ? input.nextStep : undefined;
  const premiseRefs = canonicalStrings(input.premiseRefs);
  const resourceRefs = canonicalStrings(input.resourceRefs);
  const activity = isRecord(input.activity) ? input.activity : undefined;
  const trace = isRecord(input.trace) ? input.trace : undefined;
  const traceFactRef = isNonEmptyString(trace?.factRef) ? trace.factRef : undefined;
  const traceDescription = isNonEmptyString(trace?.description) ? trace.description : undefined;
  const traceVisibilityPolicyRef = isNonEmptyString(trace?.visibilityPolicyRef)
    ? trace.visibilityPolicyRef
    : undefined;
  const alternateTarget = isRecord(input.alternateTarget) ? input.alternateTarget : undefined;
  const alternateTargetRef = isNonEmptyString(alternateTarget?.targetRef)
    ? alternateTarget.targetRef
    : undefined;
  const alternateTargetReason = isNonEmptyString(alternateTarget?.reason)
    ? alternateTarget.reason
    : undefined;
  if (
    !actorPlanNpcIsAvailable(npc)
    || factionRef === undefined
    || planId === undefined
    || goal === undefined
    || nextStep === undefined
    || [planId, goal, nextStep].some((value) => value.length > 480)
    || premiseRefs === undefined
    || premiseRefs.length === 0
    || resourceRefs === undefined
    || [premiseRefs, resourceRefs].some((refs) =>
      refs.length > 40 || refs.some((reference) => reference.length > 240))
    || premiseRefs.some((reference) => !actorPlanPremiseIsAvailable(state, npc.id, reference))
    || planId in state.campaignRuntime.npcPlans
    || activity === undefined
    || !hasExactKeys(activity, ["activityId", "activityKind", "intendedDurationMicros"])
    || !isNonEmptyString(activity.activityId)
    || !isNonEmptyString(activity.activityKind)
    || activity.activityKind === "stableRecovery2014"
    || typeof activity.intendedDurationMicros !== "string"
    || !/^[1-9][0-9]*$/u.test(activity.intendedDurationMicros)
    || activity.activityId in state.campaignRuntime.activities
    || Object.values(state.campaignRuntime.activities)
      .some((entry) => entry.status === "active" && entry.characterId === npc.id)
    || trace === undefined
    || !hasExactKeys(trace, ["description", "factRef", "visibilityPolicyRef"])
    || traceFactRef === undefined
    || traceDescription === undefined
    || traceVisibilityPolicyRef === undefined
    || traceFactRef in state.canonicalFacts
    || traceFactRef in state.campaignRuntime.definitions
    || alternateTarget === undefined
    || !hasExactKeys(alternateTarget, ["reason", "targetRef"])
    || alternateTargetReason === undefined
    || alternateTargetRef === undefined
    || (!(alternateTargetRef in state.scenes)
      && !(alternateTargetRef in state.entities))
  ) return rejected("invalidRulesInput", "ActorPlan fields exceed the current finite plan contract.");

  if (!actorPlanResourcesAreAvailable(state, npc.id, factionRef, resourceRefs)) {
    return rejected("privateOrUnknownReference", "ActorPlan resources are unavailable to the finite NPC.");
  }

  const timelineId = characterTimelineId(state, npc.id);
  if (timelineId === undefined) {
    return rejected("invalidWorldState", "The ActorPlan NPC timeline is unavailable.");
  }
  let due: { kind: "fictionTime"; atFictionMicros: string } | null = null;
  if (input.due !== null) {
    if (
      !isRecord(input.due)
      || !hasExactKeys(input.due, ["atFictionMicros", "kind"])
      || input.due.kind !== "fictionTime"
      || typeof input.due.atFictionMicros !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(input.due.atFictionMicros)
      || (BigInt(state.fictionTimelines[timelineId].nowMicros)
        + BigInt(activity.intendedDurationMicros)).toString() !== input.due.atFictionMicros
    ) return rejected("invalidRulesInput", "ActorPlan due time is not bound to its Activity duration.");
    due = { kind: "fictionTime", atFictionMicros: input.due.atFictionMicros };
  }

  let trigger: { kind: "committedEvent"; eventRef: string }
    | { kind: "knowledgeAcquired"; knowledgeRef: string }
    | null = null;
  if (input.trigger !== null) {
    if (!isRecord(input.trigger)) {
      return rejected("invalidRulesInput", "ActorPlan trigger is not canonical.");
    }
    const triggerInput = input.trigger;
    const knowledgeRef = isNonEmptyString(triggerInput.knowledgeRef)
      ? triggerInput.knowledgeRef
      : undefined;
    const eventRef = isNonEmptyString(triggerInput.eventRef) ? triggerInput.eventRef : undefined;
    if (
      triggerInput.kind === "knowledgeAcquired"
      && hasExactKeys(triggerInput, ["kind", "knowledgeRef"])
      && knowledgeRef !== undefined
      && premiseRefs.includes(knowledgeRef)
      && knowledgeRef in (state.knowledge[npc.id] ?? {})
    ) {
      trigger = { kind: "knowledgeAcquired", knowledgeRef };
    } else if (
      triggerInput.kind === "committedEvent"
      && hasExactKeys(triggerInput, ["eventRef", "kind"])
      && eventRef !== undefined
      && Object.values(state.knowledge[npc.id] ?? {}).some((knowledge) =>
        knowledge.acquiredByEventId === eventRef
        || knowledge.provenanceChain.includes(eventRef))
    ) {
      trigger = { kind: "committedEvent", eventRef };
    } else {
      return rejected("privateOrUnknownReference", "ActorPlan trigger is unavailable to the finite NPC.");
    }
  }
  if ((due === null) === (trigger === null)) {
    return rejected("invalidRulesInput", "ActorPlan requires exactly one due time or frozen trigger.");
  }

  const chapterId = isNonEmptyString(state.campaignRuntime.campaign?.currentChapterId)
    ? state.campaignRuntime.campaign.currentChapterId
    : undefined;
  const chapter = chapterId === undefined ? undefined : state.campaignRuntime.chapters[chapterId];
  if (chapterId === undefined || chapter?.status !== "active" || !isProfileRef(chapter.moduleRef)) {
    return rejected("invalidWorldState", "ActorPlan requires the Room's active pinned chapter.");
  }

  const payload: EventPayloadByType["NpcPlanFormed"] = {
    npcId: npc.id,
    factionRef,
    planId,
    actorKind: "npc",
    actorRef: npc.id,
    decisionNpcId: npc.id,
    revision: "1",
    status: "scheduled",
    goal,
    premiseRefs,
    nextStep,
    resourceRefs,
    activity: {
      activityId: activity.activityId as string,
      activityKind: activity.activityKind as string,
      intendedDurationMicros: activity.intendedDurationMicros as string,
    },
    due,
    trigger,
    trace: {
      factRef: traceFactRef,
      description: traceDescription,
      visibilityPolicyRef: traceVisibilityPolicyRef,
    },
    alternateTarget: {
      targetRef: alternateTargetRef,
      reason: alternateTargetReason,
    },
    chapterId,
    moduleRef: structuredClone(chapter.moduleRef),
  };
  const stateIssue = npcActorPlanFormationStateIssue(state, payload);
  if (stateIssue) return rejected("invalidRulesInput", stateIssue);
  const premiseScopes = premiseRefs.flatMap((reference) => {
    const scope = actorPlanPremiseScope(state, npc.id, reference);
    return scope === undefined ? [] : [scope];
  });
  const resourceScopes = actorPlanResourceScopes(state, npc.id, factionRef, resourceRefs);
  const alternateTargetScope = alternateTargetRef in state.entities
    ? `entity:${alternateTargetRef}`
    : `scene:${alternateTargetRef}`;
  const drafts: Draft[] = [{
    eventType: "NpcPlanFormed",
    payload,
    visibilityPolicyId: `visibility:npc:${npc.id}`,
    secrecy: "internal",
    reads: [...new Set([
      ...premiseScopes,
      ...resourceScopes,
      `chapter:${chapterId}`,
      `timeline:${timelineId}`,
      `activity:${activity.activityId as string}`,
      `fact:${traceFactRef}`,
      `definition:${traceFactRef}`,
      alternateTargetScope,
    ])],
    creates: [`npc-plan:${planId}`],
  }];
  if (factionRef !== null) {
    drafts.push({
      eventType: "FactionPlanFormed",
      payload: {
        factionId: factionRef,
        planId,
        actingNpcId: npc.id,
        premiseRefs,
        resourceRefs,
        revision: "1",
        status: "scheduled",
      },
      visibilityPolicyId: `visibility:npc:${npc.id}`,
      secrecy: "internal",
      reads: [
        `npc-plan:${planId}`,
        ...premiseScopes,
        ...resourceScopes,
      ],
      creates: [`faction-plan:${planId}`],
    });
  }
  drafts.push({
    eventType: "ActivityStarted",
    payload: {
      activityId: activity.activityId as string,
      characterId: npc.id,
      activityKind: activity.activityKind as string,
      intendedDurationMicros: activity.intendedDurationMicros as string,
      completion: { kind: "actorPlan", planId },
    },
    visibilityPolicyId: `visibility:npc:${npc.id}`,
    secrecy: "internal",
    reads: [`npc-plan:${planId}`],
    creates: [`activity:${activity.activityId as string}`],
  });
  return { kind: "accepted", drafts };
}
