import { extractSingleToolCall } from "../authoritative-helpers";
import { parseJsonWithUniqueMembers } from "./canonical-json";
import { npcWorkKnownPromise, npcWorkDecisionConform, npcWorkDescriptors } from "../../rules/v2/npc-work";
import type { JsonRecord } from "../../rules/v2/model";
import type { AuthoritativeModuleProfile } from "../../module/authoritative";
import type { AuthoritativeWorldState, RuntimeProfileManifest } from "../../rules";
import { authorityRevisionOrHash, authorityEntityComposite, authorityCharacterTimeline, authorityKnowledgeCatalog, authoritySpatialRefVisibleTo } from "../../rules/v2/authority-bindings";
import { authoritativeNpcDecisionContext } from "../../rules/v2/npc-decision-context";
import { itemIdentifiedBy } from "../../rules/v2/item-authority-vnext";
import { buildReferenceIndex } from "./context/reference-index";
import { createContextWorkBudget, VNEXT_CONTEXT_WORK_BUDGET } from "./context/work-budget";
import { deriveRuntimeContextRequirements } from "./context/runtime-requirements";
import { buildRequiredContext, type RequiredContextEntry, type VNextRequiredContext } from "./required-context";
import { canonicalHash, isPlainRecord, type JsonValue } from "./canonical-json";
import { createSubmitKpProposalBundleModelInput } from "./proposal-schema";
import { parseSubmitKpProposalBundleCandidateResponse } from "./proposal-provider";
import { lowerVNext2ProposalBundle } from "./proposal-bundle-lowering";
import { proposalModelContext, proposalItemEntryRefs, proposalItemDefinitionRefs, proposalObservationSubjectRefs,
  proposalNpcSourceChoices, proposalCreatureTargetRefs } from "./proposal-context";
import { requiredContextBasisReferences } from "./required-context-runtime";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH } from "./proposal-guidance";
import { VNEXT_PROPOSAL_CAPABILITIES, closeVNextProposalCapabilities, vnextProposalCapabilityForEntry, type VNextProposalCapabilityId } from "./proposal-capabilities";

export type NpcWorkDecisionRequest = {
  schema: "zhuwei.npc-work-decision/vnext-1"; rootActionId: string; npcId: string; plan: JsonRecord; knownPromise: JsonRecord; context: VNextRequiredContext;
};
const capabilities = ["authorItem", "materializeItem", "inventoryOperation", "worldInteraction"] as const;
const proposalKinds = ["materializeDefinition", "materializeItem", "inventoryOperation", "worldInteraction"];
const planKinds = ["defer", "revise", "cancel"];
const selectionTool = { type: "function", function: { name: "select_npc_work_schema", strict: true,
  description: "Choose the schemas for the NPC's next action, or exactly one internal plan decision. This selection performs no action.",
  parameters: { type: "object", additionalProperties: false, properties: {
    requestedCapabilities: { type: "array", items: { type: "string", enum: [...capabilities, ...planKinds] },
      description: "For execution choose all needed action types; otherwise choose exactly one of defer, revise, cancel. Never combine a plan decision with execution." },
  }, required: ["requestedCapabilities"] } } };
const decisionTool = { type: "function", function: { name: "submit_npc_work_decision", strict: true,
  description: "Defer, revise or cancel your internal method. This cannot amend, release or adjudicate the promise.",
  parameters: { type: "object", additionalProperties: false, properties: {
    kind: { type: "string", enum: ["defer", "revise", "cancel"] }, reason: { type: "string" },
    nextStep: { type: "string", description: "Keep the current nonempty nextStep for defer/cancel; revise must change it." },
    wakeAtFictionMicros: { anyOf: [{ type: "string", pattern: "^(0|[1-9][0-9]*)$" },
      { type: "object", properties: { kind: { type: "string", enum: ["none"] } }, required: ["kind"], additionalProperties: false }],
      description: "For defer, an absolute future microsecond instant on this actor's timeline, or {kind:'none'} to wait for new knowledge. revise/cancel require {kind:'none'}." },
  }, required: ["kind", "reason", "nextStep", "wakeAtFictionMicros"] } } };
const instruction = "本请求的行动者是npcId，原意图是requiredContext.intent中的本人计划下一步。按本人有限知识及已知条款决定做法，不替玩家选择或索取澄清。条件未满足或尚需消息时，可选择defer，wakeAtFictionMicros填未来绝对时刻字符串或{kind:'none'}等待新知识；数字0不是无值，不能回到过去。revise须改变nextStep，cancel只取消执行计划，不解除承诺或自动判违约。新消息表明仍欠义务时可再计划，不重复已完成效果。提交Proposal时只接受directSuccess/check及物品定义（source.kind=item）、materializeItem、inventoryOperation、worldInteraction；附带Ability表单不授予新创能力的权限。decision.duration填实际工期，承诺期限不是工期；新制物品须有真实来源，取放转交须有实际操作。不用trace/summary冒充完成。每阶段只提交当前唯一工具一次，不补选。";
const emptyResponseInstruction = "上次工具arguments是空对象{}，没有形成决定。只允许这一次完整重发，仍使用同一冻结的本人知识、条款和原计划；不得借重发改变原意图或补入新知识。要执行则完整填写decision、steps、results；要推迟、改计划或取消则完整填写submit_npc_work_decision。";
export const NPC_WORK_BINDING_HASH = canonicalHash({ schema: "npc-work-vnext-3", instruction, selectionTool,
  guidanceHash: VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH,
  emptyResponseInstruction, decisionTool, tool: createSubmitKpProposalBundleModelInput("binding", capabilities).tools });

/** Only a saved, known-empty response has no decision to preserve. A lost
 * response, missing fields, duplicate members or a real decision cannot retry. */
export function npcWorkResponseIsEmpty(response: unknown): boolean {
  try {
    const call = extractSingleToolCall(response);
    if (!["submit_kp_proposal_bundle", decisionTool.function.name].includes(call.name) || typeof call.arguments !== "string") return false;
    const value = parseJsonWithUniqueMembers(call.arguments);
    return isPlainRecord(value) && Object.keys(value).length === 0;
  } catch { return false; }
}
export function parseNpcWorkSelection(response: unknown): string[] {
  const call = extractSingleToolCall(response);
  if (call.name !== selectionTool.function.name || typeof call.arguments !== "string") throw new TypeError("NPC_WORK_SELECTION_INVALID");
  const value = parseJsonWithUniqueMembers(call.arguments);
  if (!isPlainRecord(value) || Object.keys(value).join() !== "requestedCapabilities" || !Array.isArray(value.requestedCapabilities)) throw new TypeError("NPC_WORK_SELECTION_INVALID");
  const selected = value.requestedCapabilities;
  if (selected.length === 0 || new Set(selected).size !== selected.length
    || selected.some(id => typeof id !== "string" || ![...capabilities, ...planKinds].includes(id))
    || selected.some(id => planKinds.includes(String(id))) && selected.length !== 1) throw new TypeError("NPC_WORK_SELECTION_INVALID");
  return selected as string[];
}

/** A separate finite-knowledge frame. The module's private truth and other
 * characters' knowledge never enter this request or its reference directory. */
export function prepareNpcWorkRequest(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  moduleProfile: AuthoritativeModuleProfile, rootActionId: string, planId: string): NpcWorkDecisionRequest | undefined {
  const plan = state.campaignRuntime.npcPlans[planId], npcId = String(plan?.npcId), npc = state.entities[npcId];
  if (plan?.schema !== "zhuwei.npc-work/vnext-1" || !npcWorkDescriptors(state).some(d => d.npcWork?.planId === planId && d.childRootActionId === rootActionId) || npc?.kind !== "npc") return undefined;
  const own = authoritativeNpcDecisionContext(state, profiles, npcId);
  if (!own) return undefined;
  const budget = createContextWorkBudget(VNEXT_CONTEXT_WORK_BUDGET), indexed = buildReferenceIndex(state, budget);
  if (indexed.kind !== "indexed") return undefined;
  const runtime = deriveRuntimeContextRequirements({ state, moduleProfile, actorCharacterId: npcId, candidates: [], index: indexed.index, budget });
  if (runtime.kind !== "ready") return undefined;
  const entries: RequiredContextEntry[] = [];
  const known = (ref: string, value: unknown) => {
    const hash = authorityRevisionOrHash(state, ref);
    if (hash !== null && value !== undefined && !entries.some(e => e.entryRef === ref))
      entries.push({ kind: "known", entryRef: ref, revisionOrHash: hash, value: structuredClone(value) as JsonValue });
  };
  known(npcId, authorityEntityComposite(state, npcId));
  known(`character-timeline:${npcId}`, authorityCharacterTimeline(state, npcId));
  known(`knowledge-catalog:${npcId}`, authorityKnowledgeCatalog(state, npcId));
  known(npc.sceneId, { scene: { id: npc.sceneId, name: state.scenes[npc.sceneId].name } });
  for (const entity of Object.values(state.entities)) if (entity.id !== npcId && authoritySpatialRefVisibleTo(state, entity.id, npc.sceneId, npcId))
    known(entity.id, { entity: { id: entity.id, name: entity.name, kind: entity.kind, sceneId: entity.sceneId, tenureStatus: entity.tenureStatus } });
  for (const knowledge of Object.values(state.knowledge[npcId] ?? {})) known(`knowledge:${npcId}:${knowledge.knowledgeRef}`, knowledge);
  for (const record of own.records) known(record.ref, record.value);
  for (const entry of Object.values(state.campaignRuntime.itemSystem.entries)) {
    if (!authoritySpatialRefVisibleTo(state, entry.entryId, npc.sceneId, npcId)) continue;
    known(entry.entryId, entry);
    const definition = state.campaignRuntime.itemSystem.definitions[entry.definitionRef];
    if (definition && (definition.visibilityPolicyRef === "visibility:public" || itemIdentifiedBy(state, npcId, entry, definition))) known(definition.definitionId, definition);
  }
  // Keep only the actual creation permission, not the story bible or the
  // private consistency frame used by the hosting KP.
  const source = runtime.requirements.profileContext;
  if (!isPlainRecord(source.value)) return undefined;
  entries.push({ ...source, value: { moduleRef: source.value.moduleRef, scopeRef: source.value.scopeRef,
    openBlanks: runtime.requirements.scopePermission ? ["Creation is permitted within this frozen scope."] : [],
    materializationPermission: source.value.materializationPermission } });
  if (runtime.requirements.scopePermission) entries.push(runtime.requirements.scopePermission);
  const refs = entries.filter(e => e.kind === "known").map(e => e.entryRef);
  const context = buildRequiredContext({ intent: { submissionRef: `npc-work:${rootActionId}`, actorRef: npcId, text: String(plan.nextStep) }, entries,
    references: { citations: { viewerEvidenceRefs: refs.filter(ref => !ref.startsWith("profile-context:")), authorityBasisRefs: refs,
      npcKnowledge: [{ npcRef: npcId, refs: refs.filter(ref => ref.startsWith(`knowledge:${npcId}:`)) }], nonCitableRefs: [] },
      domains: { abilityRefs: [], itemRefs: refs.filter(ref => Object.hasOwn(state.campaignRuntime.itemSystem.entries, ref)),
        semanticRefs: refs.filter(ref => Object.hasOwn(state.campaignRuntime.itemSystem.definitions, ref)) } },
    binding: { roomEpochRef: state.runtimeEpochId, rootActionId, preparedActionId: rootActionId, baseEventSeq: state.version,
      stateHash: canonicalHash(state), projectionHash: own.projectionHash,
      profiles: [{ profileRef: profiles.manifest.profileId, profileHash: profiles.manifest.profileHash }], readSet: [] }, maxUnits: 160_000 });
  return context.kind === "accepted" ? { schema: "zhuwei.npc-work-decision/vnext-1", rootActionId, npcId, plan: structuredClone(plan), knownPromise: npcWorkKnownPromise(state, plan), context: context.context } : undefined;
}
export function npcWorkModelInput(request: NpcWorkDecisionRequest, selectionResponse?: unknown, reemit = false): Record<string, unknown> {
  const context = request.context;
  const message = JSON.stringify({ npcId: request.npcId, plan: { ...request.plan, knownPromise: request.knownPromise }, requiredContext: proposalModelContext(context) });
  if (selectionResponse === undefined) return { messages: [{ role: "system", content: `${instruction}\n本阶段只选择填写类型，不填写决定或结果。类型目录：${JSON.stringify(VNEXT_PROPOSAL_CAPABILITIES.filter(c => (capabilities as readonly string[]).includes(c.id)))}；defer推迟，revise修改做法，cancel取消计划。` }, { role: "user", content: message }],
    tools: [selectionTool], tool_choice: "required", parallel_tool_calls: false, max_completion_tokens: 1000 };
  const selected = parseNpcWorkSelection(selectionResponse), planKind = selected.find(id => planKinds.includes(id));
  if (planKind) return { messages: [{ role: "system", content: `${instruction}\n已选择${planKind}，完整填写本次决定，不能改成另一种决定。${reemit ? emptyResponseInstruction : ""}` }, { role: "user", content: message }],
    tools: [{ ...decisionTool, function: { ...decisionTool.function, parameters: { ...decisionTool.function.parameters,
      properties: { ...decisionTool.function.parameters.properties, kind: { type: "string", enum: [planKind] } } } } }],
    tool_choice: "required", parallel_tool_calls: false, max_completion_tokens: 2000 };
  const input = createSubmitKpProposalBundleModelInput(message, selected as VNextProposalCapabilityId[], proposalItemEntryRefs(context),
    proposalObservationSubjectRefs(context), [], proposalNpcSourceChoices(context), requiredContextBasisReferences(context),
    proposalCreatureTargetRefs(context), false, proposalItemDefinitionRefs(context));
  return { ...input, messages: [{ role: "system", content: `${input.messages[0].content}\n${instruction}` }, input.messages[1],
    ...(reemit ? [{ role: "user", content: emptyResponseInstruction }] : [])] };
}
export function npcWorkRulesInput(response: unknown, request: NpcWorkDecisionRequest, state: AuthoritativeWorldState, profiles: RuntimeProfileManifest, selectionResponse?: unknown): JsonRecord {
  const call = extractSingleToolCall(response);
  const selected = selectionResponse === undefined ? undefined : parseNpcWorkSelection(selectionResponse);
  if (call.name === decisionTool.function.name) {
    if (typeof call.arguments !== "string") throw new TypeError("NPC_WORK_INVALID");
    const wire = parseJsonWithUniqueMembers(call.arguments);
    if (!isPlainRecord(wire)) throw new TypeError("NPC_WORK_INVALID");
    const wake = wire.wakeAtFictionMicros;
    const noWake = isPlainRecord(wake) && Object.keys(wake).length === 1 && wake.kind === "none";
    if (!noWake && typeof wake !== "string") throw new TypeError("NPC_WORK_INVALID");
    const decision = { ...wire, wakeAtFictionMicros: noWake ? null : wake };
    if (!npcWorkDecisionConform(decision)) throw new TypeError("NPC_WORK_INVALID");
    if (selected && (selected.length !== 1 || selected[0] !== decision.kind)) throw new TypeError("NPC_WORK_SELECTION_INVALID");
    return { kind: "resolveNpcWork", proposalId: request.rootActionId, planId: request.plan.planId,
      planHash: canonicalHash(request.plan), decision };
  }
  const candidate = parseSubmitKpProposalBundleCandidateResponse(response);
  if (candidate.kind !== "accepted") throw new TypeError("NPC_WORK_INVALID");
  const value = candidate.bundle;
  if (selected) {
    if (selected.some(id => planKinds.includes(id))) throw new TypeError("NPC_WORK_SELECTION_INVALID");
    const closed = closeVNextProposalCapabilities(selected);
    if (!isPlainRecord(value) || !Array.isArray(value.proposals) || value.proposals.some(p => !closed.includes(vnextProposalCapabilityForEntry(p)!))) throw new TypeError("NPC_WORK_SELECTION_INVALID");
  }
  if (!isPlainRecord(value) || value.mode !== "adjudication" || !Array.isArray(value.proposals)
    || value.proposals.some(p => !isPlainRecord(p) || !proposalKinds.includes(String(p.kind))
      || (p.kind === "materializeDefinition" && (!isPlainRecord(p.source) || p.source.kind !== "item")))) throw new TypeError("NPC_WORK_INVALID");
  const result = lowerVNext2ProposalBundle({ value, requiredContext: request.context, state, profiles,
    rootActionId: request.rootActionId, actorCharacterId: request.npcId });
  if (result.kind !== "accepted" || result.command.kind !== "rulesStep") throw new TypeError("NPC_WORK_INVALID");
  return { kind: "resolveNpcWork", proposalId: request.rootActionId, planId: request.plan.planId,
    planHash: canonicalHash(request.plan), command: result.command.rulesInput as JsonRecord };
}
