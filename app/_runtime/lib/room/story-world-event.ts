import { canonicalHash, deepFreeze, isPlainRecord, parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";
import { extractSingleToolCall } from "../kp/authoritative-helpers";
import { AUTHORITATIVE_KP_PROFILE } from "../kp/authoritative-policy";
import type { StoryCreationSelection } from "../kp/vnext/story-selection";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeProfileManifest } from "../rules";
import type { DueActivityDescriptor, StoredReceipt } from "../rules/v2/model";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import { dueActivityDescriptors } from "../rules/v2/due-activities";
import { hashWorldState } from "../rules/v2/validation";
import type { StoryFailureCode, StoryHash, StoryRecord, StoryRequest } from "./story-creation";
import type { StoryExternalInvocationBinding } from "./story-creation-invocation";
import type { StoryLibraryCatalog } from "./story-library-contracts";
import { roomModelInvocationBinding, roomStoryBudget, ROOM_STORY_TRANSPORT } from "./story-runtime-policy";

const hash = (value: unknown): StoryHash => canonicalHash(value) as StoryHash;
const same = (left: unknown, right: unknown): boolean => hash(left) === hash(right);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const sorted = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

/** Private Host evidence, captured around the existing atomic due commit.
 * Replaying the actual Rules input verifies it; a matching hash alone does not.
 * The persisted trigger below retains only the verified event evidence. */
export type RoomWorldStoryCommit = Readonly<{
  beforeState: AuthoritativeWorldState;
  due: DueActivityDescriptor;
  rulesInput: unknown;
  committedEvents: readonly EventEnvelope[];
  afterState: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  /** Preserve the complete source identity of an existing player/root chain.
   * Only autonomous world roots get a new worldEvent source/account. */
  budgetSource: StoryRequest["source"];
}>;
export type RoomWorldStoryTrigger = Readonly<{
  schema: "zhuwei.room-world-story-trigger/v1";
  triggerRef: string;
  source: StoryRequest["source"];
  actorRef: string;
  rootActionId: string;
  due: DueActivityDescriptor;
  scope: StoryRequest["scope"];
  goal: string;
  receipt: StoredReceipt;
  events: readonly EventEnvelope[];
  before: Readonly<{ stateHash: StoryHash; eventSeq: string }>;
  after: Readonly<{ stateHash: StoryHash; eventSeq: string }>;
  profilesHash: StoryHash;
  triggerHash: StoryHash;
}>;
export type RoomWorldStoryTriggerResult =
  | Readonly<{ kind: "verified"; trigger: RoomWorldStoryTrigger }>
  | Readonly<{ kind: "notApplicable"; reason: "notNpcWork" | "workNotCompleted" | "noCommittedEvents" }>
  | Readonly<{ kind: "blocked"; code: StoryFailureCode; issue: string }>;

/** Rules still owns eligibility, time, knowledge and every effect. This does
 * not commit, advance a clock, choose a story, or grant an NPC author knowledge. */
export function verifyWorldStoryTrigger(input: RoomWorldStoryCommit,
  rules: Pick<VersionedRulesRuntime, "step">): RoomWorldStoryTriggerResult {
  const blocked = (issue: string): RoomWorldStoryTriggerResult => ({ kind: "blocked", code: "STORY_CONTEXT_STALE", issue });
  try {
    const { beforeState: before, afterState: after, due, budgetSource: source } = input;
    const actor = before.entities[due.ownerEntityId];
    if (actor?.kind !== "npc" || !["active", "npcTransitioned"].includes(actor.tenureStatus)
      || due.promiseReview !== undefined || due.timePassage !== undefined) return { kind: "notApplicable", reason: "notNpcWork" };
    if (source.roomId !== before.roomId || source.runtimeEpochId !== before.runtimeEpochId || source.branchId !== before.activeBranchId
      || !["playerAction", "worldEvent"].includes(source.kind) || !text(source.sourceId) || !text(source.budgetAccountId)
      || before.roomId !== after.roomId || before.runtimeEpochId !== after.runtimeEpochId || before.activeBranchId !== after.activeBranchId
      || !same(before.runtimeManifestRef, input.profiles.manifest)) return blocked("trigger:source-binding-mismatch");
    if (!dueActivityDescriptors(before).some(candidate => same(candidate, due))) return blocked("trigger:due-not-authoritative");
    if (input.committedEvents.length === 0) return { kind: "notApplicable", reason: "noCommittedEvents" };
    const result = rules.step(input.profiles, before, input.rulesInput);
    if (result.kind === "awaitingInput" || result.kind === "awaitingRandomness" || result.kind === "needsKp") {
      return { kind: "notApplicable", reason: "workNotCompleted" };
    }
    if (result.kind !== "committed" || result.receipt.status !== "committed") return blocked("trigger:rules-commit-mismatch");
    if (result.receipt.rootActionId !== due.childRootActionId || !same(result.state, after)
      || !same(result.events, input.committedEvents) || input.committedEvents.some(event => event.rootActionId !== due.childRootActionId)) {
      return blocked("trigger:rules-commit-mismatch");
    }
    if (due.activityId !== null && after.campaignRuntime.activities[due.activityId]?.status === "active"
      || due.npcWork !== undefined && after.campaignRuntime.npcPlans[due.npcWork.planId]?.status === "started") {
      return { kind: "notApplicable", reason: "workNotCompleted" };
    }
    const receipt = after.receipts[due.childRootActionId];
    if (!receipt || receipt.status !== "committed") return blocked("trigger:receipt-unavailable");
    const scenes = sorted([...due.sceneIds, actor.sceneId, ...(after.entities[actor.id] ? [after.entities[actor.id].sceneId] : [])]);
    if (scenes.some(ref => after.scenes[ref] === undefined)) return blocked("trigger:scene-unavailable");
    const plan = due.actorPlan ? before.campaignRuntime.npcPlans[due.actorPlan.planId]
      : due.npcWork ? before.campaignRuntime.npcPlans[due.npcWork.planId]
        : before.campaignRuntime.npcPlans[Object.keys(before.campaignRuntime.npcPlans)
          .find(ref => before.campaignRuntime.npcPlans[ref].activityId === due.activityId) ?? ""];
    const goal = text(plan?.goal) ? `根据已提交事件，发展与“${plan.goal}”有关的后续局势。`
      : `根据 ${actor.name} 在 ${scenes.map(ref => after.scenes[ref].name).join("、")} 已提交的行动事件，判断后续局势是否值得完整故事准备。`;
    const body = { schema: "zhuwei.room-world-story-trigger/v1" as const,
      triggerRef: `story-world-trigger:${hash({ roomId: before.roomId, epoch: before.runtimeEpochId,
        branch: before.activeBranchId, rootActionId: due.childRootActionId })}`,
      source: structuredClone(source), actorRef: actor.id, rootActionId: due.childRootActionId, due: structuredClone(due),
      scope: { sceneIds: scenes, entityIds: sorted([actor.id, ...receipt.subjectCharacterIds.filter(ref => after.entities[ref] !== undefined)]) },
      goal, receipt: structuredClone(receipt), events: structuredClone(input.committedEvents),
      before: { stateHash: hashWorldState(before) as StoryHash, eventSeq: before.version },
      after: { stateHash: hashWorldState(after) as StoryHash, eventSeq: after.version }, profilesHash: hash(input.profiles) };
    return { kind: "verified", trigger: deepFreeze({ ...body, triggerHash: hash(body) }) };
  } catch { return blocked("trigger:invalid-authority-evidence"); }
}

/** Called with the trusted persisted DTO, including after Room recovery.
 * Admission rechecks the immutable receipt and the context's concrete reads;
 * an unrelated later Room event is not by itself a context conflict. */
export function worldStoryTriggerMatchesAuthority(trigger: RoomWorldStoryTrigger, state: AuthoritativeWorldState,
  profiles: RuntimeProfileManifest, exactSnapshot = false): boolean {
  try {
    const { triggerHash, ...body } = trigger;
    return trigger.schema === "zhuwei.room-world-story-trigger/v1" && hash(body) === triggerHash
      && trigger.source.roomId === state.roomId && trigger.source.runtimeEpochId === state.runtimeEpochId
      && trigger.source.branchId === state.activeBranchId && trigger.profilesHash === hash(profiles)
      && trigger.rootActionId === trigger.due.childRootActionId && trigger.events.length > 0
      && trigger.events.every(event => event.rootActionId === trigger.rootActionId && event.roomId === state.roomId
        && event.runtimeEpochId === state.runtimeEpochId && event.branchId === state.activeBranchId)
      && same(state.receipts[trigger.rootActionId] ?? null, trigger.receipt)
      && (!exactSnapshot || trigger.after.stateHash === hashWorldState(state) && trigger.after.eventSeq === state.version);
  } catch { return false; }
}

export type RoomWorldStorySelection = Readonly<{ kind: "noStory"; reason: string }>
  | Readonly<{ kind: "prepareStory"; reason: string; selection: StoryCreationSelection }>;
const str = { type: "string" };
const enumeration = (values: readonly string[]) => ({ type: "string", enum: values });
const closed = (properties: Record<string, unknown>) => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false });
export const WORLD_STORY_SELECTION_TOOL_NAME = "select_world_story_preparation";
export const WORLD_STORY_SELECTION_TOOL = deepFreeze({ type: "function", function: {
  name: WORLD_STORY_SELECTION_TOOL_NAME, strict: true,
  description: "仅判断真实幕后事件是否需要完整故事准备，并选择方法、规模和联系；不创作剧本、不评审、不裁决、不使计划或候选生效。",
  parameters: closed({ decision: { anyOf: [closed({ kind: enumeration(["noStory"]), reason: str }),
    closed({ kind: enumeration(["prepareStory"]), reason: str, selection: closed({
      method: enumeration(["story.method.local-conflict", "story.method.archive-investigation"]),
      scale: enumeration(["vignette", "short", "long"]), connection: enumeration(["local", "mainStory", "personal"]),
    }) })] } }),
} });
export const WORLD_STORY_SELECTION_BINDING_HASH = hash({ tool: WORLD_STORY_SELECTION_TOOL,
  policy: "committed-world-event-routing-only/v1", parser: "single-tool-unique-json/v1" });

export function worldStoryLibraryCatalogValid(trigger: RoomWorldStoryTrigger, catalog: StoryLibraryCatalog): boolean {
  try {
    const { catalogHash, ...body } = catalog;
    return catalog.format === "zhuwei.story-library-catalog/v1" && hash(body) === catalogHash && Array.isArray(catalog.offers)
      && same(catalog.room, { roomId: trigger.source.roomId, runtimeEpochId: trigger.source.runtimeEpochId, branchId: trigger.source.branchId })
      && new Set(catalog.offers.map(offer => offer.libraryRef)).size === catalog.offers.length;
  } catch { return false; }
}

export function worldStorySelectionModelInput(trigger: RoomWorldStoryTrigger, catalog: StoryLibraryCatalog): StoryRecord {
  if (!worldStoryLibraryCatalogValid(trigger, catalog)) throw new TypeError("STORY_CONTEXT_INSUFFICIENT");
  return { model: AUTHORITATIVE_KP_PROFILE.modelId, stream: false, temperature: 0.2,
    max_completion_tokens: 1_000, tool_choice: { type: "function", function: { name: WORLD_STORY_SELECTION_TOOL_NAME } },
    tools: [WORLD_STORY_SELECTION_TOOL], messages: [
      { role: "system", content: "你是幕后事件的故事准备分流器。只选择 noStory 或准备要求，不写故事，不承担创作或评审阶段。依据真实已提交事件：计划、延期、修改或取消只说明该决策成立，绝不说明原目标已完成。普通事务、没有实质新局势或已有准备已足够时选择 noStory。确需新玩法空间时再选方法、规模和联系。准备完成后仅入库，未来仍须合法 KP 行动和 Rules 提交；不得替玩家接受任务、承诺或受罚。此私有作者视图不会成为 NPC 的知识。" },
      { role: "user", content: JSON.stringify({ schema: trigger.schema, triggerRef: trigger.triggerRef,
        goal: trigger.goal, scope: trigger.scope, due: trigger.due, receipt: trigger.receipt, committedEvents: trigger.events,
        existingPreparations: catalog }) },
    ] } as StoryRecord;
}

export function parseWorldStorySelection(response: unknown): RoomWorldStorySelection {
  const invalid = (): never => { throw new TypeError("STORY_SELECTION_INVALID"); };
  const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isPlainRecord(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const call = extractSingleToolCall(response);
  if (call.name !== WORLD_STORY_SELECTION_TOOL_NAME || typeof call.arguments !== "string") return invalid();
  const envelope = parseJsonWithUniqueMembers(call.arguments);
  if (!exact(envelope, ["decision"]) || !isPlainRecord(envelope.decision)) return invalid();
  const value = envelope.decision;
  if (!text(value.reason) || value.reason.length > 2_000) return invalid();
  if (value.kind === "noStory" && exact(value, ["kind", "reason"])) return deepFreeze({ kind: "noStory", reason: value.reason });
  if (value.kind !== "prepareStory" || !exact(value, ["kind", "reason", "selection"])
    || !exact(value.selection, ["method", "scale", "connection"])
    || !["story.method.local-conflict", "story.method.archive-investigation"].includes(String(value.selection.method))
    || !["vignette", "short", "long"].includes(String(value.selection.scale))
    || !["local", "mainStory", "personal"].includes(String(value.selection.connection))) return invalid();
  return deepFreeze({ kind: "prepareStory", reason: value.reason, selection: { ...value.selection } as StoryCreationSelection });
}

export function worldStoryRequestInput(trigger: RoomWorldStoryTrigger, selection: StoryCreationSelection): Readonly<{
  source: StoryRequest["source"]; trigger: StoryRequest["trigger"]; scope: StoryRequest["scope"]; selection: StoryCreationSelection;
}> {
  return { source: trigger.source, trigger: { kind: "causalDevelopment", goal: trigger.goal,
    basisRefs: [trigger.triggerRef, trigger.actorRef, ...trigger.scope.sceneIds] }, scope: trigger.scope, selection };
}

/** The routing call shares the existing source/Room ledgers. It is context
 * selection, not a fifth author/reviewer stage. Unknown results stay held in
 * StoryCreationStore and the same deterministic key cannot resample them. */
export function worldStorySelectionInvocationBinding(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  trigger: RoomWorldStoryTrigger, catalog: StoryLibraryCatalog): StoryExternalInvocationBinding {
  if (!worldStoryTriggerMatchesAuthority(trigger, state, profiles)) throw new TypeError("STORY_CONTEXT_STALE");
  const providerRequest = worldStorySelectionModelInput(trigger, catalog), budget = roomStoryBudget(trigger.source);
  const ordinary = roomModelInvocationBinding(state, trigger.source.sourceId, `world-story-context:${trigger.triggerRef}`, "context", providerRequest);
  if (ordinary.reservation.inputTokens > ROOM_STORY_TRANSPORT.maxInputTokens) throw new TypeError("STORY_BUDGET_EXHAUSTED");
  return { ...ordinary, source: trigger.source, budget, roomAccountId: budget.roomAccountId };
}
