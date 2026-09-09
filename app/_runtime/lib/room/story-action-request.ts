import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { createVNextProposalBundleSchema } from "../kp/vnext/proposal-schema";
import { VNEXT_PROPOSAL_CAPABILITIES, type VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import type { StorySelection } from "../kp/vnext/story-selection";
import type { AuthoritativeWorldState } from "../rules";
import { createStoryRecipes, STORY_CREATION_WORKFLOW_REF, type StoryCapabilityDescription } from "./story-creation";
import type { StoryHash, StoryRecipe, StoryRequest, StoryRecord } from "./story-creation/contracts";
import { ROOM_STORY_BUDGET_REF } from "./story-runtime-policy";

const hash = (value: unknown) => canonicalHash(value) as StoryHash;
export function roomStoryRequest(context: VNextRequiredContext, state: AuthoritativeWorldState,
  selection: StorySelection, recipes: readonly StoryRecipe[] = createStoryRecipes(hash)): StoryRequest {
  const actor = state.entities[context.intent.actorRef];
  if (actor?.tenureStatus !== "active" || context.binding.roomEpochRef !== state.runtimeEpochId) {
    throw new TypeError("STORY_CONTEXT_INSUFFICIENT");
  }
  const refs = new Set(context.entries.map(entry => entry.entryRef));
  const sceneIds = [...new Set([actor.sceneId, ...Object.keys(state.scenes).filter(ref => refs.has(ref))])].sort();
  const entityIds = [...new Set([actor.id, ...Object.keys(state.entities).filter(ref => refs.has(ref))])].sort();
  const scope = { sceneIds, entityIds };
  const goal = context.intent.text.trim();
  const opportunityId = `story-opportunity:${hash({ roomId: state.roomId, epoch: state.runtimeEpochId,
    branchId: state.activeBranchId, goal: goal.normalize("NFC"), scope })}`;
  const chosen = new Set([selection.method, ...(selection.scale === "long" ? ["story.scale.long"] : [])]);
  return {
    format: "zhuwei.story-request/v1", jobId: `story-job:${opportunityId}`, opportunityId,
    source: { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId,
      kind: "playerAction", sourceId: context.binding.rootActionId,
      budgetAccountId: `source-budget:${state.runtimeEpochId}:${context.binding.rootActionId}` },
    trigger: { kind: "developGoal", goal, basisRefs: [actor.id, actor.sceneId] },
    scale: selection.scale, connection: selection.connection, methods: [selection.method], scope,
    recipeRefs: recipes.filter(recipe => chosen.has(recipe.ref.id)).map(recipe => recipe.ref),
    workflowRef: STORY_CREATION_WORKFLOW_REF, budgetPolicyRef: ROOM_STORY_BUDGET_REF,
  };
}

/** Each payload is an array of actual closed production step shapes. A
 * preparation cannot advertise an NPC producer which the host cannot parse. */
export function roomStoryCapabilityDescriptions(): readonly StoryCapabilityDescription[] {
  const ids = VNEXT_PROPOSAL_CAPABILITIES.filter(entry =>
    ["materializeObject", "materializeNpc", "materializeDefinition", "materializeItem"].includes(entry.proposalKind)).map(entry => entry.id);
  return ids.map((capability: VNextProposalCapabilityId) => {
    const schema = createVNextProposalBundleSchema([capability]) as Record<string, unknown>;
    if (!isPlainRecord(schema.properties) || !isPlainRecord(schema.properties.steps)) throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    return { capability, schema: { type: "object", additionalProperties: false,
      properties: { steps: schema.properties.steps }, required: ["steps"] } as StoryRecord,
      instructions: "payload.steps 使用所示正常 Proposal 操作；定义的局部 handle 在整份故事中稳定，正文精确保存。不要写裁决、骰面、已执行结果或任意状态补丁。" };
  });
}
