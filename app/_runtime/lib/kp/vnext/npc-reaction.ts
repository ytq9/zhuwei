import { extractSingleToolCall } from "../authoritative-helpers";
import { canonicalHash, isPlainRecord, parseJsonWithUniqueMembers } from "./canonical-json";
import type { AuthoritativeModuleProfile } from "../../module/authoritative";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../../rules";
import type { VNextRequiredContext } from "./required-context";
import { createSubmitKpProposalBundleModelInput, vnextProposalRequestMessages } from "./proposal-schema";
import { parseSubmitKpProposalBundleCandidateResponse } from "./proposal-provider";
import { lowerVNext2ProposalBundle } from "./proposal-bundle-lowering";
import { proposalModelContext, proposalItemEntryRefs, proposalItemDefinitionRefs, proposalObservationSubjectRefs,
  proposalNpcSourceChoices, proposalCreatureTargetRefs } from "./proposal-context";
import { requiredContextBasisReferences } from "./required-context-runtime";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH, vnextProposalReferenceRules } from "./proposal-guidance";
import { npcMoveChoices, npcOwnRequiredContext } from "./npc-work";

/** SPEC 0006 §7: one call, from the noticing NPC's own view only. */
export type NpcReactionDecisionRequest = {
  schema: "zhuwei.npc-reaction-decision/vnext-1"; rootActionId: string; npcId: string;
  reactionId: string; reactionHash: string; context: VNextRequiredContext;
};
const capabilities = ["worldInteraction"] as const;
const declineTool = { type: "function", function: { name: "decline_npc_reaction", strict: true,
  description: "Do not react now. The reason stays private to this character.",
  parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string", pattern: "[\\s\\S]+" } },
    required: ["reason"] } } };
const instruction = "本请求的行动者是npcId，requiredContext.intent是本人刚察觉的情况，做这件事的人不知道本人察觉了。只按本人身份、目标、性格和已知内容决定是否当场反应，不反应也可以：不反应就调用decline_npc_reaction，写本人的理由；反应就调用submit_kp_proposal_bundle，只用已加载的worldInteraction写本人当场做的事和说的话。反应发生在所察觉的动作当中，不另占时间，duration填none。当场离开或走到别处，在effects写moveNpc并把目的地列入directTargetRefs：去已登记场景填scene、sceneRef和travel，经已有连接填passage。";
const onTheSpot = { type: "string", enum: ["none"], description: "An on-the-spot reaction happens within the act it answers and takes no time of its own." };
export const NPC_REACTION_BINDING_HASH = canonicalHash({ schema: "npc-reaction-vnext-1", instruction, declineTool,
  guidanceHash: VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH, tool: onTheSpotTools(createSubmitKpProposalBundleModelInput("binding", capabilities, [], [], [],
    undefined, undefined, undefined, false, undefined, [], [], {}).tools) });

/** SPEC 0006 §7: the reaction is published with the act it answers. An NPC's
 * Activity never moves the clock itself, so a timed reaction would only
 * complete with someone else's later action; the ruling's duration is fixed
 * to none, which runs the bundle atomically in the reaction's own root. */
function onTheSpotTools(tools: readonly unknown[]): unknown[] {
  return tools.map(tool => {
    const copy = structuredClone(tool) as { function: { parameters: { $def?: Record<string, unknown> } } };
    const defs = copy.function.parameters.$def ?? {};
    for (const [key, value] of Object.entries(defs)) {
      const values = isPlainRecord(value) && Array.isArray(value.enum) ? value.enum : [];
      if (values.includes("none") && values.includes("halfDay")) defs[key] = structuredClone(onTheSpot);
    }
    return copy;
  });
}

type JsonRecord = Record<string, unknown>;

/** `reaction` is the identity of the open reaction the Room verified as due
 * work; the intent is what the NPC itself perceived. */
export function prepareNpcReactionRequest(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  moduleProfile: AuthoritativeModuleProfile, rootActionId: string,
  reaction: { reactionId: string; reactionHash: string }): NpcReactionDecisionRequest | undefined {
  const record = state.campaignRuntime.npcReactions?.[reaction.reactionId];
  const perceived = record === undefined ? undefined : state.knowledge[record.npcId]?.[record.factId]?.content;
  if (record?.status !== "open" || record.childRootActionId !== rootActionId || typeof perceived !== "string") return undefined;
  const context = npcOwnRequiredContext(state, profiles, moduleProfile, record.npcId, rootActionId,
    { submissionRef: `npc-reaction:${rootActionId}`, actorRef: record.npcId, text: perceived });
  return context === undefined ? undefined : { schema: "zhuwei.npc-reaction-decision/vnext-1", rootActionId, npcId: record.npcId,
    reactionId: reaction.reactionId, reactionHash: reaction.reactionHash, context };
}

export function npcReactionModelInput(request: NpcReactionDecisionRequest): Record<string, unknown> {
  const context = request.context;
  const message = JSON.stringify({ npcId: request.npcId, requiredContext: proposalModelContext(context) });
  const input = createSubmitKpProposalBundleModelInput(message, capabilities, proposalItemEntryRefs(context),
    proposalObservationSubjectRefs(context), [], proposalNpcSourceChoices(context), requiredContextBasisReferences(context),
    proposalCreatureTargetRefs(context), false, proposalItemDefinitionRefs(context), [], [], npcMoveChoices(context));
  return { ...input, messages: vnextProposalRequestMessages(message, vnextProposalReferenceRules("expandedProposal", capabilities, []), instruction),
    tools: [declineTool, ...onTheSpotTools(input.tools)] };
}

export function npcReactionRulesInput(response: unknown, request: NpcReactionDecisionRequest,
  state: AuthoritativeWorldState, profiles: RuntimeProfileManifest): JsonRecord {
  const call = extractSingleToolCall(response);
  const base = { kind: "resolveNpcReaction", proposalId: request.rootActionId, reactionId: request.reactionId, reactionHash: request.reactionHash };
  if (call.name === declineTool.function.name) {
    const wire = typeof call.arguments === "string" ? parseJsonWithUniqueMembers(call.arguments) : undefined;
    if (!isPlainRecord(wire) || Object.keys(wire).join() !== "reason" || typeof wire.reason !== "string" || wire.reason.trim().length === 0)
      throw new TypeError("NPC_REACTION_INVALID");
    return { ...base, decision: { kind: "decline", reason: wire.reason } };
  }
  const candidate = parseSubmitKpProposalBundleCandidateResponse(response);
  if (candidate.kind !== "accepted") throw new TypeError("NPC_REACTION_INVALID");
  const value = candidate.bundle;
  if (!isPlainRecord(value) || value.mode !== "adjudication" || !Array.isArray(value.proposals) || value.proposals.length === 0
    || value.proposals.some(p => !isPlainRecord(p) || p.kind !== "worldInteraction")) throw new TypeError("NPC_REACTION_INVALID");
  const result = lowerVNext2ProposalBundle({ value, requiredContext: request.context, state, profiles,
    rootActionId: request.rootActionId, actorCharacterId: request.npcId, onTheSpot: true });
  if (result.kind !== "accepted" || result.command.kind !== "rulesStep") throw new TypeError("NPC_REACTION_INVALID");
  return { ...base, command: result.command.rulesInput as JsonRecord };
}
