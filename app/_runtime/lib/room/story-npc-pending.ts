import { canonicalHash, isPlainRecord, parseJsonWithUniqueMembers } from "../kp/vnext/canonical-json";
import { deepSeekRequestBody } from "../kp/deepseek";
import { NPC_PENDING_DECISION_TOOL_NAME, npcPendingDecisionModelInput, type NpcPendingDecisionRequest } from "../kp/pending-decision-policy";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../rules";
import type { VersionedRulesRuntime } from "../rules/v2-runtime";
import { combatPendingAnswerOptions } from "../rules/v2/combat-actions";
import type { AuthorityNpcDecisionRow } from "./authority-store";

export type StoryNpcPendingAuthority = Readonly<{
  preparedActionId: string;
  rootActionId: string;
  pendingInputId: string;
  capability: string;
}>;
export type StoryNpcPendingRunner = (
  authority: StoryNpcPendingAuthority,
  providerRequest: Record<string, unknown>,
) => Promise<unknown>;

/** The private decision capability is retained for same-room recovery only.
 * It is never evidence for a world fact, projection or provider dispatch. */
export type StoryFrozenNpcPendingContext = Readonly<{
  preparedActionId: string;
  baseEventSeq: string;
  request: NpcPendingDecisionRequest;
  decision: AuthorityNpcDecisionRow;
}>;

export const STORY_NPC_PENDING_BINDING_HASH = canonicalHash({
  format: "zhuwei.story-npc-pending-host/v1",
  tool: NPC_PENDING_DECISION_TOOL_NAME,
  projection: "rules-pendingNpcDecisionFor/v1",
  policy: "npc-limited-pending/v1",
  transport: "deepseek-strict-tool/v1",
});

export function storyNpcPendingPreparedActionId(ownerPreparedActionId: string, pendingInputId: string): string {
  if (!ownerPreparedActionId || !pendingInputId) throw new TypeError("NPC_PENDING_DECISION_CONTEXT_INVALID");
  return `npc-pending:${ownerPreparedActionId}:${pendingInputId}`;
}

/** Rebuild the complete model-visible choice from actual Rules state. This is
 * shared by the live Room boundary and the archive's historical-prefix check. */
export function storyNpcPendingRequest(input: StoryNpcPendingAuthority & {
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
}, runtime: Pick<VersionedRulesRuntime, "project">): NpcPendingDecisionRequest {
  const fail = (): never => { throw new TypeError("NPC_PENDING_DECISION_CONTEXT_INVALID"); };
  const pending = input.state.combatRuntime.pendingInputs[input.pendingInputId];
  if (!isPlainRecord(pending) || pending.kind !== "kpDecision"
    || pending.rootActionId !== input.rootActionId || typeof pending.controllerEntityId !== "string"
    || !pending.controllerEntityId || !input.preparedActionId || !input.capability) return fail();
  const projection = runtime.project(input.profiles, input.state, {
    kind: "npc", npcId: pending.controllerEntityId, purpose: "kpDecision",
    capability: "internal:npc-limited-knowledge",
  }, { pendingNpcDecisionFor: { pendingInputId: input.pendingInputId } });
  if (projection.kind === "rejected" || projection.viewer.kind !== "npc"
    || projection.viewer.subjectId !== pending.controllerEntityId) return fail();
  const safePending: Record<string, unknown> = { pendingInputId: input.pendingInputId,
    npcId: pending.controllerEntityId, choiceKind: pending.choiceKind };
  for (const key of ["reactionKind", "triggerKind", "candidateEntityIds", "maximumTargetCount",
    "orderedEntityIds", "orderedTriggerInstanceIds", "triggerBatchId", "triggerBatchHash"]) {
    if (pending[key] !== undefined) safePending[key] = structuredClone(pending[key]);
  }
  if (pending.choiceKind === "reaction" || pending.choiceKind === "knockOut") {
    safePending.answerOptions = Array.isArray(pending.answerOptions)
      ? structuredClone(pending.answerOptions) : combatPendingAnswerOptions(input.state, pending);
  }
  return { preparedActionId: input.preparedActionId, rootActionId: input.rootActionId,
    capability: input.capability, pending: safePending, projection };
}

export function storyNpcPendingProviderRequest(request: NpcPendingDecisionRequest, modelId: string): Record<string, unknown> {
  return deepSeekRequestBody(modelId, npcPendingDecisionModelInput(request));
}

export function freezeStoryNpcPendingContext(input: {
  state: AuthoritativeWorldState;
  profiles: RuntimeProfileManifest;
  baseEventSeq: string;
  rootActionId: string;
  decision: AuthorityNpcDecisionRow;
}, runtime: Pick<VersionedRulesRuntime, "project">): StoryFrozenNpcPendingContext {
  const row = input.decision;
  const request = storyNpcPendingRequest({ state: input.state, profiles: input.profiles,
    preparedActionId: row.prepared_action_id, rootActionId: input.rootActionId,
    pendingInputId: row.pending_input_id, capability: row.capability }, runtime);
  if (!/^(0|[1-9][0-9]*)$/u.test(input.baseEventSeq) || row.answer_json !== null
    || canonicalHash(parseJsonWithUniqueMembers(row.request_json)) !== canonicalHash({ pending: request.pending, projection: request.projection })) {
    throw new TypeError("NPC_PENDING_DECISION_CONTEXT_INVALID");
  }
  return { preparedActionId: storyNpcPendingPreparedActionId(row.prepared_action_id, row.pending_input_id),
    baseEventSeq: input.baseEventSeq, request, decision: structuredClone(row) };
}
