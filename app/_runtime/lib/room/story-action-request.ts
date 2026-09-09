import { canonicalHash, isPlainRecord } from "../kp/vnext/canonical-json";
import { createVNextProposalBundleSchema } from "../kp/vnext/proposal-schema";
import { compactDeepSeekStrictToolSchema } from "../kp/deepseek-strict-schema-compaction";
import { VNEXT_PROPOSAL_CAPABILITIES, type VNextProposalCapabilityId } from "../kp/vnext/proposal-capabilities";
import type { VNextRequiredContext } from "../kp/vnext/required-context";
import type { StoryCreationSelection, StorySelection } from "../kp/vnext/story-selection";
import type { AuthoritativeWorldState } from "../rules";
import { createStoryRecipes, STORY_CREATION_WORKFLOW_REF, type StoryCapabilityDescription } from "./story-creation";
import type { StoryHash, StoryRecipe, StoryRequest, StoryRecord } from "./story-creation/contracts";
import { ROOM_STORY_BUDGET_REF } from "./story-runtime-policy";

const hash = (value: unknown) => canonicalHash(value) as StoryHash;
export function roomStoryRequest(context: VNextRequiredContext, state: AuthoritativeWorldState,
  selection: StorySelection, recipes: readonly StoryRecipe[] = createStoryRecipes(hash)): StoryRequest {
  if ("libraryRef" in selection) throw new TypeError("STORY_SELECTION_INVALID");
  const actor = state.entities[context.intent.actorRef];
  if (actor?.tenureStatus !== "active" || context.binding.roomEpochRef !== state.runtimeEpochId) {
    throw new TypeError("STORY_CONTEXT_INSUFFICIENT");
  }
  const refs = new Set(context.entries.map(entry => entry.entryRef));
  const sceneIds = [...new Set([actor.sceneId, ...Object.keys(state.scenes).filter(ref => refs.has(ref))])].sort();
  const entityIds = [...new Set([actor.id, ...Object.keys(state.entities).filter(ref => refs.has(ref))])].sort();
  const scope = { sceneIds, entityIds };
  const goal = context.intent.text.trim();
  return createStoryRequest({ source: { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId,
    kind: "playerAction", sourceId: context.binding.rootActionId, budgetAccountId: `source-budget:${state.runtimeEpochId}:${context.binding.rootActionId}` },
    trigger: { kind: "developGoal", goal, basisRefs: [actor.id, actor.sceneId] }, scope, selection }, recipes);
}

export function createStoryRequest(input: Readonly<{ source: StoryRequest["source"]; trigger: StoryRequest["trigger"];
  scope: StoryRequest["scope"]; selection: StoryCreationSelection }>, recipes: readonly StoryRecipe[] = createStoryRecipes(hash)): StoryRequest {
  const { source, trigger, scope, selection } = input;
  // Scene scope and the expressing actor stay stable when another NPC is
  // materialized. A world event keeps its real causal identity instead.
  const opportunityId = `story-opportunity:${hash({ roomId: source.roomId, epoch: source.runtimeEpochId,
    branchId: source.branchId, kind: source.kind, cause: source.kind === "worldEvent" ? source.sourceId : trigger.basisRefs[0],
    goal: trigger.goal.trim().normalize("NFC"), sceneIds: [...scope.sceneIds].sort() })}`;
  const chosen = new Set([selection.method, ...(selection.scale === "long" ? ["story.scale.long"] : [])]);
  return {
    format: "zhuwei.story-request/v1", jobId: `story-job:${opportunityId}`, opportunityId,
    source, trigger,
    scale: selection.scale, connection: selection.connection, methods: [selection.method], scope,
    recipeRefs: recipes.filter(recipe => chosen.has(recipe.ref.id)).map(recipe => recipe.ref),
    workflowRef: STORY_CREATION_WORKFLOW_REF, budgetPolicyRef: ROOM_STORY_BUDGET_REF,
  };
}

/** Each payload contains one actual closed production producer step. A
 * preparation cannot advertise an NPC producer which the host cannot parse. */
export function roomStoryCapabilityDescriptions(): readonly StoryCapabilityDescription[] {
  const ids = VNEXT_PROPOSAL_CAPABILITIES.filter(entry =>
    ["materializeObject", "materializeNpc", "materializeDefinition", "materializeItem"].includes(entry.proposalKind)).map(entry => entry.id);
  return ids.map((capability: VNextProposalCapabilityId) => {
    const schema = createVNextProposalBundleSchema([capability]) as Record<string, unknown>;
    if (!isPlainRecord(schema.properties) || !isPlainRecord(schema.properties.steps)) throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    const steps = expandSchemaRefs(schema.properties.steps, schema);
    if (!isPlainRecord(steps) || !isPlainRecord(steps.items)) throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    const capabilityEntry = VNEXT_PROPOSAL_CAPABILITIES.find(entry => entry.id === capability)!;
    const variants = Array.isArray(steps.items.anyOf) ? steps.items.anyOf : [steps.items];
    const selected = variants.filter(value => isPlainRecord(value) && isPlainRecord(value.properties)
      && isPlainRecord(value.properties.kind) && Array.isArray(value.properties.kind.enum)
      && value.properties.kind.enum.includes(capabilityEntry.proposalKind)
      && (!("definitionKind" in capabilityEntry) || (isPlainRecord(value.properties.source)
        && isPlainRecord(value.properties.source.properties) && isPlainRecord(value.properties.source.properties.kind)
        && Array.isArray(value.properties.source.properties.kind.enum)
        && value.properties.source.properties.kind.enum.includes(capabilityEntry.definitionKind))));
    if (!selected.length) throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    // Selection needs expanded nodes, but the author can read the same
    // complete contract through shared definitions. Preserve every constraint
    // without repeatedly sending the expanded mechanical vocabulary.
    const payloadSchema = { type: "object", additionalProperties: false,
      properties: { steps: { type: "array", items: selected.length === 1 ? selected[0] : { anyOf: selected } } }, required: ["steps"] };
    const compact = compactDeepSeekStrictToolSchema(payloadSchema);
    if (!isPlainRecord(compact.properties) || !isPlainRecord(compact.properties.steps)
      || compact.properties.steps.type !== "array") throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    // This is an authored-payload contract in the context, not a Provider
    // tool. Its single-step cardinality is enforced by the host parser.
    compact.properties.steps.minItems = 1;
    compact.properties.steps.maxItems = 1;
    return { capability, schema: compact as StoryRecord,
      instructions: "payload.steps 精确包含一个所示正常定义/NPC/物件操作，outcomeBinding 必须 always。复合机械拆为相互依赖的 definitions；局部 handle 在整份故事中唯一且稳定，正文精确保存。不要写裁决、骰面、已执行结果或任意状态补丁。" };
  });
}

function expandSchemaRefs(value: unknown, root: Record<string, unknown>, active: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map(item => expandSchemaRefs(item, root, active));
  if (!isPlainRecord(value)) return value;
  if (typeof value.$ref === "string") {
    if (!value.$ref.startsWith("#/$def/") || active.includes(value.$ref) || !isPlainRecord(root.$def)) throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    const target = root.$def[value.$ref.slice("#/$def/".length)];
    if (!isPlainRecord(target)) throw new TypeError("STORY_CAPABILITY_UNSUPPORTED");
    const { $ref, ...rest } = value;
    return expandSchemaRefs({ ...target, ...rest }, root, [...active, $ref as string]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandSchemaRefs(item, root, active)]));
}
