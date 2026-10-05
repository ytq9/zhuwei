import { withPreparedNpcCombatStatistics, type PreparedNpcCombatStatistics } from "./npc-combat-preparation";
import { extractSingleToolCall } from "../authoritative-helpers";
import { canonicalHash, isPlainRecord, parseJsonWithUniqueMembers } from "./canonical-json";
import type { AuthoritativeModuleProfile } from "../../module/authoritative";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../../rules";
import { authoritySpatialRefVisibleTo } from "../../rules/authority-read";
import type { VNextRequiredContext } from "./required-context";
import { createSubmitKpProposalBundleModelInput, vnextProposalRequestMessages } from "./proposal-schema";
import { parseSubmitKpProposalBundleCandidateResponse } from "./proposal-provider";
import { lowerVNext2ProposalBundle } from "./proposal-bundle-lowering";
import { proposalModelContext, proposalItemEntryRefs, proposalItemDefinitionRefs, proposalObservationSubjectRefs,
  proposalNpcSourceChoices, proposalCreatureTargetRefs } from "./proposal-context";
import { requiredContextBasisReferences } from "./required-context-runtime";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH, vnextProposalReferenceRules } from "./proposal-guidance";
import { isNpcStartCombat, npcMoveChoices, npcOwnRequiredContext, NPC_START_COMBAT } from "./npc-work";

/** SPEC 0006 §7: one call, from the reacting NPC's own view only. `trigger`
 * is present only for a conversation the NPC heard as a bystander (ADR 0110). */
export type NpcReactionDecisionRequest = {
  schema: "zhuwei.npc-reaction-decision/vnext-1"; rootActionId: string; npcId: string;
  reactionId: string; reactionHash: string; context: VNextRequiredContext; trigger?: "heardConversation";
};
/** SPEC 0006 §7 (ADR 0118): besides acting through a world interaction, the
 * NPC may turn on someone it sees and start a fight. Its form is the start
 * form; the guidance for it is the NPC's own (`NPC_START_COMBAT`), not the
 * hosting KP's, which writes both sides' hostility. */
const capabilities = ["worldInteraction", "startCombat"] as const;
const declineTool = { type: "function", function: { name: "decline_npc_reaction", strict: true,
  description: "Do not react now. The reason stays private to this character.",
  parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string", pattern: "[\\s\\S]+" } },
    required: ["reason"] } } };
// Round 173: Varo answered aloud with no target written; the form needs one
// and a reaction has no revision (ADR 0060), so his words lapsed.
const instruction = "本请求的行动者是npcId，requiredContext.intent是本人刚察觉的情况，做这件事的人不知道本人察觉了。只按本人身份、目标、性格和已知内容决定是否当场反应，不反应也可以：不反应就调用decline_npc_reaction，写本人的理由；反应就调用submit_kp_proposal_bundle，用已加载的worldInteraction写本人当场做的事和说的话，或用startCombat开战。反应发生在所察觉的动作当中，不另占时间，duration填none。只开口说话、不碰别的东西时，targetRefs和directTargetRefs填你说话的对象。当场离开或走到别处，在effects写moveNpc并把目的地列入directTargetRefs：去已登记场景填scene、sceneRef和travel，经已有连接填passage。";
/** ADR 0110: the speakers know the bystander is there; it may stay out. */
const heardInstruction = "本请求的行动者是npcId，requiredContext.intent是本人在场听到的一段交谈，说话的两人知道本人在场。只按本人身份、目标、性格和已知内容决定是否当场插话或做点什么，不插话也可以：不反应就调用decline_npc_reaction，写本人的理由；反应就调用submit_kp_proposal_bundle，用已加载的worldInteraction写本人当场做的事和说的话，可以插话、回答、反对或离开，或用startCombat开战。反应发生在这段交谈当中，不另占时间，duration填none。只开口说话、不碰别的东西时，targetRefs和directTargetRefs填你说话的对象。当场离开或走到别处，在effects写moveNpc并把目的地列入directTargetRefs：去已登记场景填scene、sceneRef和travel，经已有连接填passage。";
const onTheSpot = { type: "string", enum: ["none"], description: "An on-the-spot reaction happens within the act it answers and takes no time of its own." };
export const NPC_REACTION_BINDING_HASH = canonicalHash({ schema: "npc-reaction-vnext-5", instruction, heardInstruction, declineTool,
  startCombat: NPC_START_COMBAT,
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
  if (record?.status !== "open" || record.childRootActionId !== rootActionId) return undefined;
  const heard = record.trigger === "heardConversation";
  const perceived = heard ? heardConversationText(state, record) : state.knowledge[record.npcId]?.[record.factId]?.content;
  if (typeof perceived !== "string") return undefined;
  // What the NPC perceived or heard travels in full whatever else it holds
  // (ADR 0115): the perceived act, or both lines of the conversation.
  const response = heard ? Object.values(state.campaignRuntime.conversationThreads ?? {})
    .find(entry => entry.claimRef === record.factId) as { responseClaimRef?: unknown } | undefined : undefined;
  const context = npcOwnRequiredContext(state, profiles, moduleProfile, record.npcId, rootActionId,
    { submissionRef: `npc-reaction:${rootActionId}`, actorRef: record.npcId, text: perceived },
    [record.factId, ...(typeof response?.responseClaimRef === "string" ? [response.responseClaimRef] : [])]);
  return context === undefined ? undefined : { schema: "zhuwei.npc-reaction-decision/vnext-1", rootActionId, npcId: record.npcId,
    reactionId: reaction.reactionId, reactionHash: reaction.reactionHash, context, ...(heard ? { trigger: "heardConversation" as const } : {}) };
}

type NpcReactionRecord = NonNullable<AuthoritativeWorldState["campaignRuntime"]["npcReactions"]>[string];

/** ADR 0110: what a bystander heard, both lines with their speakers as it
 * knows them: the speaker's words and the addressee's reply, or that the
 * addressee did not answer. Each line is the NPC's own heard record; the
 * conversation is the one whose speaker's words the reaction answers. */
function heardConversationText(state: AuthoritativeWorldState, record: NpcReactionRecord): string | undefined {
  const thread = Object.values(state.campaignRuntime.conversationThreads ?? {}).find(entry => entry.claimRef === record.factId);
  const held = state.knowledge[record.npcId] ?? {};
  if (thread === undefined || typeof thread.actorCharacterId !== "string" || typeof thread.npcCharacterId !== "string") return undefined;
  const words = held[record.factId]?.content;
  const responseRef = (thread as { responseClaimRef?: unknown }).responseClaimRef;
  const reply = typeof responseRef === "string" ? held[responseRef]?.content : null;
  if (typeof words !== "string" || (reply !== null && typeof reply !== "string")) return undefined;
  const speaker = knownName(state, record.npcId, thread.actorCharacterId) ?? "有人";
  const addressee = knownName(state, record.npcId, thread.npcCharacterId) ?? "对方";
  return `本人在场听到${speaker}对${addressee}说：“${words}”\n${reply === null ? `${addressee}没有回答。` : `${addressee}回答：“${reply}”`}`;
}

/** The name this NPC's own context shows for someone it can see, without
 * a module alias after " / " ("奈斯 / 奈斯卡尔" is 奈斯). */
function knownName(state: AuthoritativeWorldState, npcId: string, ref: string): string | undefined {
  const viewer = state.entities[npcId], entity = state.entities[ref];
  if (viewer === undefined || entity === undefined || !authoritySpatialRefVisibleTo(state, ref, viewer.sceneId, npcId)) return undefined;
  const name = entity.name.split(" / ")[0].trim();
  return name.length > 0 ? name : undefined;
}

export function npcReactionModelInput(request: NpcReactionDecisionRequest): Record<string, unknown> {
  const context = request.context;
  const message = JSON.stringify({ npcId: request.npcId, requiredContext: proposalModelContext(context) });
  const input = createSubmitKpProposalBundleModelInput(message, capabilities, proposalItemEntryRefs(context),
    proposalObservationSubjectRefs(context), [], proposalNpcSourceChoices(context), requiredContextBasisReferences(context),
    proposalCreatureTargetRefs(context), false, proposalItemDefinitionRefs(context), [], [], npcMoveChoices(context));
  return { ...input, messages: vnextProposalRequestMessages(message,
    vnextProposalReferenceRules("expandedProposal", capabilities, [], [], { startCombat: NPC_START_COMBAT }),
    request.trigger === "heardConversation" ? heardInstruction : instruction),
    tools: [declineTool, ...onTheSpotTools(input.tools)] };
}

export function npcReactionRulesInput(response: unknown, request: NpcReactionDecisionRequest,
  state: AuthoritativeWorldState, profiles: RuntimeProfileManifest, combatPreparation?: PreparedNpcCombatStatistics): JsonRecord {
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
  const value = withPreparedNpcCombatStatistics(candidate.bundle, request.npcId, combatPreparation);
  if (!isPlainRecord(value) || !(isNpcStartCombat(value) || value.mode === "adjudication" && Array.isArray(value.proposals)
    && value.proposals.length > 0 && value.proposals.every(p => isPlainRecord(p) && p.kind === "worldInteraction"))) throw new TypeError("NPC_REACTION_INVALID");
  const result = lowerVNext2ProposalBundle({ value, requiredContext: request.context, state, profiles,
    rootActionId: request.rootActionId, actorCharacterId: request.npcId, onTheSpot: true });
  if (result.kind !== "accepted" || result.command.kind !== "rulesStep") throw new TypeError("NPC_REACTION_INVALID");
  return { ...base, command: result.command.rulesInput as JsonRecord };
}
