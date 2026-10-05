import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { authorityReadSetMatches, authorityRevisionOrHash, authoritySpatialRefVisibleTo } from "./authority-bindings";
import type { AuthoredSourceSchema } from "./authored-materialization";
import { createEventTransition, scopeOf } from "./events";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord, StepResult } from "./model";
import { rejected } from "./results";
import { canonicalFactVisibleToCharacter, hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import { isCanonicalReadSet, type VersionedAuthorityBinding } from "./world-interaction-model";

/** SPEC 0009 §§1、8: hosting records describe a question and its actual end.
 * They do not move anyone or execute a manuscript's future. A conclusion
 * preserves each informed participant's account in the existing knowledge channel. */
export type StoryContinuityOperation =
  | Readonly<{ kind: "openScene"; storyRef: { kind: "new" } | { kind: "existing"; ref: string };
      title: string; question: string; participantRefs: readonly string[] }>
  | Readonly<{ kind: "answerScene"; questionRef: string; description: string }>
  | Readonly<{ kind: "concludeStory"; storyRef: string; outcome: "success" | "failure" | "abandoned";
      unresolvedRefs: readonly string[]; consequenceRefs: readonly string[]; description: string }>;
export const STORY_CONTINUITY_PLAN_SCHEMA = "zhuwei.story-continuity-plan/vnext-1" as const;
export type StoryContinuityPlan = Readonly<{ schema: typeof STORY_CONTINUITY_PLAN_SCHEMA; contextHash: string;
  readSet: readonly VersionedAuthorityBinding[]; basisRefs: readonly string[]; playerIntent: string; operation: StoryContinuityOperation }>;
const string: AuthoredSourceSchema = { type: "string", pattern: "[\\s\\S]+" };
const refs: AuthoredSourceSchema = { type: "array", items: string };
const object = (properties: Record<string, AuthoredSourceSchema>): AuthoredSourceSchema => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false });
const kind = (value: string): AuthoredSourceSchema => ({ type: "string", enum: [value] });
export const STORY_CONTINUITY_SOURCE_SCHEMA: AuthoredSourceSchema = { anyOf: [
  object({ kind: kind("openScene"), storyRef: { anyOf: [object({ kind: kind("new") }), object({ kind: kind("existing"), ref: string })] }, title: string, question: string, participantRefs: refs }),
  object({ kind: kind("answerScene"), questionRef: string, description: string }),
  object({ kind: kind("concludeStory"), storyRef: string, outcome: { type: "string", enum: ["success", "failure", "abandoned"] },
    unresolvedRefs: refs, consequenceRefs: refs, description: string }),
] };
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= 2_000 && value.normalize("NFC") === value;
const reference = (value: unknown): value is string => typeof value === "string" && /^\S+$/u.test(value) && value.length <= 512;
const references = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 40
  && value.every(reference) && new Set(value).size === value.length;
export function isStoryContinuityOperation(value: unknown): value is StoryContinuityOperation {
  if (!isRecord(value)) return false;
  if (value.kind === "openScene") return hasExactKeys(value, ["kind", "storyRef", "title", "question", "participantRefs"])
    && text(value.title) && text(value.question) && references(value.participantRefs) && value.participantRefs.length > 0 && isRecord(value.storyRef)
    && (value.storyRef.kind === "new" && hasExactKeys(value.storyRef, ["kind"])
      || value.storyRef.kind === "existing" && hasExactKeys(value.storyRef, ["kind", "ref"]) && reference(value.storyRef.ref));
  if (value.kind === "answerScene") return hasExactKeys(value, ["kind", "questionRef", "description"])
    && reference(value.questionRef) && text(value.description);
  return value.kind === "concludeStory" && hasExactKeys(value, ["kind", "storyRef", "outcome", "unresolvedRefs", "consequenceRefs", "description"])
    && reference(value.storyRef) && ["success", "failure", "abandoned"].includes(String(value.outcome))
    && references(value.unresolvedRefs) && references(value.consequenceRefs) && text(value.description);
}
export function isStoryContinuityPlan(value: unknown): value is StoryContinuityPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "basisRefs", "playerIntent", "operation"])
    && value.schema === STORY_CONTINUITY_PLAN_SCHEMA && isSha256(value.contextHash) && isCanonicalReadSet(value.readSet)
    && typeof value.playerIntent === "string" && value.playerIntent.length > 0 && value.playerIntent.length <= 8_000
    && references(value.basisRefs) && value.basisRefs.length > 0 && isStoryContinuityOperation(value.operation);
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(isNonEmptyString) : [];
function storyFor(state: AuthoritativeWorldState, operation: StoryContinuityOperation): JsonRecord | undefined {
  const ref = operation.kind === "concludeStory" ? operation.storyRef
    : operation.kind === "openScene" ? operation.storyRef.kind === "existing" ? operation.storyRef.ref : undefined
    : state.campaignRuntime.sceneQuestions[operation.questionRef]?.storyId;
  return typeof ref === "string" ? state.campaignRuntime.stories[ref] : undefined;
}
export function storyConclusionFor(story: JsonRecord, characterId: string): JsonRecord | undefined {
  const conclusions = story.conclusions;
  return isRecord(conclusions) && isRecord(conclusions[characterId]) ? conclusions[characterId] : undefined;
}
function activeParticipants(story: JsonRecord): string[] {
  return strings(story.participantCharacterIds).filter(id => !storyConclusionFor(story, id));
}
function scopeParticipants(state: AuthoritativeWorldState, actorId: string, operation: StoryContinuityOperation): string[] {
  if (operation.kind === "openScene") return [...operation.participantRefs];
  const story = storyFor(state, operation);
  return operation.kind === "concludeStory" && operation.outcome === "abandoned" ? [actorId]
    : story ? activeParticipants(story) : [actorId];
}
export function storyContinuityReadRefs(state: AuthoritativeWorldState, actorId: string, basisRefs: readonly string[], operation: StoryContinuityOperation): readonly string[] | undefined {
  const actor = state.entities[actorId];
  if (!actor) return undefined;
  const story = storyFor(state, operation);
  return [...new Set([actorId, actor.sceneId, "continuity:sceneQuestions", "continuity:stories", ...basisRefs,
    ...scopeParticipants(state, actorId, operation),
    ...(story ? [`continuity:stories:${story.storyId}`] : []),
    ...(operation.kind === "answerScene" ? [`continuity:sceneQuestions:${operation.questionRef}`] : []),
    ...(operation.kind === "concludeStory" ? ["continuity:unresolvedThreats",
      ...operation.unresolvedRefs.filter(ref => !state.campaignRuntime.unresolvedThreats.includes(ref)), ...operation.consequenceRefs] : [])])].sort();
}
export type StoryContinuityIssue = Readonly<{ constraint: string; path: readonly (string | number)[] }>;
export function storyContinuityIssues(state: AuthoritativeWorldState, actorId: string, basisRefs: readonly string[], operation: StoryContinuityOperation, rootActionId?: string): readonly StoryContinuityIssue[] {
  const issues: StoryContinuityIssue[] = [], actor = state.entities[actorId];
  const add = (constraint: string, path: readonly (string | number)[] = []) => issues.push({ constraint: `story-continuity:${constraint}`, path });
  if (!actor || actor.kind !== "player" || actor.tenureStatus !== "active") add("active-player-required");
  if (!basisRefs.length || basisRefs.some(ref => authorityRevisionOrHash(state, ref) === null)) add("established-basis-required", ["basisRefs"]);
  const story = storyFor(state, operation), participants = scopeParticipants(state, actorId, operation);
  if (operation.kind !== "openScene" || operation.storyRef.kind === "existing") {
    if (!story || story.status !== "open" || storyConclusionFor(story, actorId)) add("open-story-required", ["operation", "storyRef"]);
    // A shared story is not owned by whoever first recorded it. Any current
    // participant may present its established outcome; leaving decides only
    // the current player's participation, never another player's intention.
    if (operation.kind !== "openScene" && !strings(story?.participantCharacterIds).includes(actorId)) add("story-participant-required");
  }
  if (operation.kind === "openScene") {
    if (!participants.includes(actorId) || participants.some(id => state.entities[id]?.kind !== "player"
      || state.entities[id]?.tenureStatus !== "active" || state.entities[id]?.sceneId !== actor?.sceneId)) add("present-participants-required", ["operation", "participantRefs"]);
    if (Object.values(state.campaignRuntime.sceneQuestions).some(question => question.status === "open"
      && question.sceneId === actor?.sceneId && question.storyId === story?.storyId)) add("scene-question-already-open");
  }
  if (operation.kind === "answerScene") {
    const question = state.campaignRuntime.sceneQuestions[operation.questionRef];
    if (question?.status !== "open" || question.sceneId !== actor?.sceneId) add("open-scene-question-required", ["operation", "questionRef"]);
  }
  if (operation.kind === "concludeStory") {
    if (operation.unresolvedRefs.some(ref => authorityRevisionOrHash(state, ref) === null && !state.campaignRuntime.unresolvedThreats.includes(ref))) add("unresolved-fact-required", ["operation", "unresolvedRefs"]);
    if (operation.consequenceRefs.some(ref => authorityRevisionOrHash(state, ref) === null)) add("consequence-fact-required", ["operation", "consequenceRefs"]);
    const affected = new Set([...participants, ...basisRefs.flatMap(ref => state.entities[ref] ? [ref]
      : (state.canonicalFacts[ref]?.subjectRefs ?? []).filter(subject => state.entities[subject]))]);
    // SPEC 0009 §8: use the actual Activity/continuation shapes. Only the
    // concluding act's own resolved continuation is excluded; other roots
    // and affected actors' private choices must settle first.
    const pending = [...Object.values(state.pendingInputs), ...Object.values(state.combatRuntime.pendingInputs)]
      .some(value => affected.has(String(value.controllerCharacterId))
        || affected.has(String("controllerEntityId" in value ? value.controllerEntityId : "")));
    const fighting = Object.values(state.combatRuntime.encounters).some(value => value.status !== "concluded"
      && strings(value.participantEntityIds).some(id => affected.has(id)));
    const activities = Object.values(state.campaignRuntime.activities).some(value => value.status === "active"
      && affected.has(String(value.characterId)) && !(isRecord(value.completion) && isRecord(value.completion.plan)
        && value.completion.plan.rootActionId === rootActionId));
    const continuing = Object.values(state.internalContinuations).some(value => value.rootActionId !== rootActionId
      && (strings(state.receipts[value.rootActionId]?.subjectCharacterIds).some(id => affected.has(id))
        || isRecord(value.resolutionPlan) && "actorCharacterId" in value.resolutionPlan && affected.has(String(value.resolutionPlan.actorCharacterId))));
    const unresolvedCombat = Object.values(state.combatRuntime.randomnessResolutions).some(value => isRecord(value.operation)
      && [value.operation.sourceEntityId, value.operation.targetEntityId, ...strings(value.operation.targetEntityIds)].some(id => typeof id === "string" && affected.has(id)));
    if (pending || fighting || activities || continuing || unresolvedCombat) add("pending-mechanics");
  }
  return issues;
}

/** Only open records and the current participant's latest conclusion are
 * default context. Explicit focus refs can retrieve an older record. */
export function storyContinuityContextRefs(state: AuthoritativeWorldState, actorId: string): readonly string[] {
  const sceneRef = state.entities[actorId]?.sceneId;
  const stories = Object.values(state.campaignRuntime.stories).filter(story => strings(story.participantCharacterIds).includes(actorId));
  const open = stories.filter(story => story.status === "open" && !storyConclusionFor(story, actorId));
  const latest = stories.filter(story => storyConclusionFor(story, actorId)).sort((a, b) =>
    Number(BigInt(String(storyConclusionFor(b, actorId)?.concludedAtEventSeq ?? "0")) - BigInt(String(storyConclusionFor(a, actorId)?.concludedAtEventSeq ?? "0"))))[0];
  return [...new Set([
    ...open.map(story => `continuity:stories:${story.storyId}`),
    ...(latest ? [`continuity:stories:${latest.storyId}`] : []),
    ...Object.entries(state.campaignRuntime.sceneQuestions).filter(([, question]) => question.status === "open"
      && question.sceneId === sceneRef && open.some(story => story.storyId === question.storyId))
      .map(([id]) => `continuity:sceneQuestions:${id}`),
  ])].sort();
}
function basisVisible(state: AuthoritativeWorldState, ref: string, viewer: string): boolean {
  const actor = state.entities[viewer];
  if (!actor) return false;
  const fact = state.canonicalFacts[ref];
  if (fact) return canonicalFactVisibleToCharacter(state, fact, actor);
  if (state.knowledge[viewer]?.[ref]) return true;
  if (ref === viewer || ref === actor.sceneId) return true;
  return authoritySpatialRefVisibleTo(state, ref, actor.sceneId, viewer);
}
export function storyRecordVisibleTo(state: AuthoritativeWorldState, record: JsonRecord, viewer: string): boolean {
  if (Array.isArray(record.audienceCharacterIds)) return record.audienceCharacterIds.includes(viewer);
  return strings(record.participantCharacterIds).includes(viewer)
    && [...strings(record.basisRefs), ...strings(record.longTermConsequences)].every(ref => basisVisible(state, ref, viewer));
}
export function storyVisibilityPolicyVisibleTo(state: AuthoritativeWorldState, policy: string, viewer: string): boolean {
  if (policy.startsWith("visibility:scene-question:")) {
    const record = state.campaignRuntime.sceneQuestions[policy.slice("visibility:scene-question:".length)];
    return Boolean(record && storyRecordVisibleTo(state, record, viewer));
  }
  if (policy.startsWith("visibility:story-outcome:")) {
    const candidate = policy.slice("visibility:story-outcome:".length);
    return Object.values(state.campaignRuntime.stories).some(story => {
      const conclusion = storyConclusionFor(story, viewer);
      return conclusion?.endingCandidateId === candidate && storyRecordVisibleTo(state, conclusion, viewer);
    });
  }
  return false;
}
export function projectedContinuityStories(state: AuthoritativeWorldState, viewer: string): JsonRecord[] {
  return Object.values(state.campaignRuntime.stories).flatMap(story => {
    // Historical records predate scoped questions and retain their shape.
    if (!Array.isArray(story.participantCharacterIds)) return [structuredClone(story)];
    const conclusion = storyConclusionFor(story, viewer);
    if (conclusion && storyRecordVisibleTo(state, conclusion, viewer)) return [{ storyId: story.storyId,
      title: story.title, status: "concluded", endingCandidateId: conclusion.endingCandidateId,
      outcome: conclusion.outcome, resolution: conclusion.resolution, longTermConsequences: conclusion.longTermConsequences }];
    if (!storyRecordVisibleTo(state, story, viewer)) return [];
    return [{ storyId: story.storyId, title: story.title, status: "open" }];
  });
}

/** All writes remain ordinary Rules events inside the caller's atomic act. */
export function stepStoryContinuity(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"]) || input.kind !== "storyContinuity"
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId) || !isStoryContinuityPlan(input.plan)) {
    return rejected("invalidRulesInput", "The story continuity plan is not canonical.");
  }
  const plan = input.plan, actorId = input.actorCharacterId, operation = plan.operation;
  const required = storyContinuityReadRefs(state, actorId, plan.basisRefs, operation);
  if (!required || required.some(ref => !plan.readSet.some(value => value.ref === ref)) || !authorityReadSetMatches(state, plan.readSet)) {
    return rejected("causalFrontierConflict", "The story continuity dependencies changed.");
  }
  const issues = storyContinuityIssues(state, actorId, plan.basisRefs, operation, input.rootActionId);
  if (issues.length) return rejected("invalidRulesInput", issues.map(issue => issue.constraint).join(", "));
  const rootActionId = input.rootActionId, sceneId = state.entities[actorId]!.sceneId;
  let current = state;
  const events: EventEnvelope[] = [];
  const writes: string[] = [];
  const append = <K extends "SceneQuestionOpened" | "SceneQuestionAnswered" | "EndingCandidateRaised" | "StoryConcluded" | "CanonicalFactDeclared" | "KnowledgeAcquired">(
    eventType: K, payload: import("./model").EventPayloadByType[K], ref: string, policy: string = `visibility:knowledge-holder:${actorId}`,
  ) => {
    const next = createEventTransition(current, profiles, { rootActionId, eventType, payload,
      visibilityPolicyId: policy, secrecy: "private" });
    current = next.state; events.push(next.event); writes.push(ref); return next.receipt;
  };
  let receipt;
  const participants = scopeParticipants(state, actorId, operation);
  if (operation.kind === "openScene") {
    const id = canonicalSha256({ rootActionId, operation }).slice(7, 39);
    const storyId = operation.storyRef.kind === "new" ? `story:${id}` : operation.storyRef.ref;
    receipt = append("SceneQuestionOpened", { sceneQuestionId: `scene-question:${id}`, question: operation.question,
      storyId, sceneId, title: operation.title, participantCharacterIds: participants, basisRefs: [...plan.basisRefs] }, `continuity:sceneQuestions:scene-question:${id}`, `visibility:scene-question:scene-question:${id}`);
    writes.push(`continuity:stories:${storyId}`);
  } else if (operation.kind === "answerScene") {
    receipt = append("SceneQuestionAnswered", { sceneQuestionId: operation.questionRef, answerFactIds: [...plan.basisRefs], description: operation.description }, `continuity:sceneQuestions:${operation.questionRef}`, `visibility:scene-question:${operation.questionRef}`);
  } else {
    const candidateId = `ending:${canonicalSha256({ rootActionId, storyId: operation.storyRef }).slice(7, 39)}`;
    append("EndingCandidateRaised", { endingCandidateId: candidateId, basisFactIds: [...plan.basisRefs], unresolvedConsequences: [...operation.unresolvedRefs] }, `continuity:endingCandidates:${candidateId}`);
    for (const [id, question] of Object.entries(current.campaignRuntime.sceneQuestions)) {
      if (question.storyId === operation.storyRef && question.status === "open"
        && activeParticipants(storyFor(state, operation)!).every(id => participants.includes(id))) append("SceneQuestionAnswered", {
        sceneQuestionId: id, answerFactIds: [...plan.basisRefs], description: operation.description }, `continuity:sceneQuestions:${id}`, `visibility:scene-question:${id}`);
    }
    receipt = append("StoryConcluded", { storyId: operation.storyRef, endingCandidateId: candidateId, outcome: operation.description,
      resolution: operation.outcome, longTermConsequences: [...operation.consequenceRefs], basisRefs: [...plan.basisRefs],
      participantCharacterIds: participants, playerIntent: plan.playerIntent, actorCharacterId: actorId }, `continuity:stories:${operation.storyRef}`, `visibility:story-outcome:${candidateId}`);
    const endingEvent = events.at(-1)!;
    for (const characterId of participants) {
      const conclusion = storyConclusionFor(current.campaignRuntime.stories[operation.storyRef], characterId)!;
      if (!storyRecordVisibleTo(current, conclusion, characterId)) continue;
      const factId = `fact:story-conclusion:${canonicalSha256({ candidateId, characterId }).slice(7, 39)}`;
      const content = { schema: "zhuwei.story-conclusion-memory/v1", storyRef: operation.storyRef,
        endingCandidateRef: candidateId, title: current.campaignRuntime.stories[operation.storyRef].title,
        resolution: operation.outcome, description: operation.description };
      receipt = append("CanonicalFactDeclared", { fact: { id: factId, kind: "storyConclusion",
        subjectRefs: [characterId, sceneId], value: content, source: "observedEvent",
        causalParentIds: [endingEvent.eventId], visibilityPolicyId: `visibility:knowledge-holder:${characterId}` } },
        factId, `visibility:knowledge-holder:${characterId}`);
      receipt = append("KnowledgeAcquired", { characterId, knowledgeRef: factId, objectKind: "canonicalFact",
        layer: "full", content: `${content.title}：${operation.description}`, causeFactId: factId, visibility: "private",
        acquisition: { sense: "recollection", sceneId, method: "本人已知事实所支持的剧情收束" } },
        `knowledge:${characterId}:${factId}`, `visibility:knowledge-holder:${characterId}`);
    }
  }
  return { kind: "committed", events, state: current, cache: current, receipt: { ...receipt,
    eventRange: { fromEventSeq: events[0]!.eventSeq, toEventSeq: events.at(-1)!.eventSeq } },
    scope: scopeOf([...required], writes, writes.filter(ref => authorityRevisionOrHash(state, ref) === null)) };
}
