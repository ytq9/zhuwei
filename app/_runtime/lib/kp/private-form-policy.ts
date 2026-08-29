import { canonicalJson } from "./authoritative-helpers";
import {
  buildKpFormModelParameters,
  buildKpFormRepairParameters,
  modelFormDescriptors,
  type KpFormId,
} from "./form-catalog";
import type { KpProposalRequest } from "./authoritative-types";

export type FiniteReferenceCatalog = Readonly<{
  basisRefs: readonly string[];
  abilityRefs: readonly string[];
  resourceRefs: readonly string[];
  artifactRefs: readonly string[];
}>;

export const PRIVATE_FORM_PROPOSAL_TOOL_NAME = "submit_private_kp_form" as const;

const PRIVATE_FORM_SYSTEM = `你是烛帷中承担叙事与裁决权威的真正 KP。玩家只提供自然语言意图；私有 Form 是你与服务器之间的小型闭合接口，不是玩家菜单。

你继续决定开放世界可行性、风险、DC、NPC 的有限知识行动、有意义失败、节奏与叙事收束。RequiredContext 不可忽略；RetrievedContext 只能补充静态规则、模组与 Story Bible 原文；OptionalContext 预算不足时可以忽略。引用只能逐字取自 Context Pack 中现有 ref。

本次只能从服务器给出的 3–6 张 Form 中选一张并完整填写。compound 是未预见、多目标、多阶段或跨作用域行动的逃生舱，不得把复杂行动硬塞进简单表。不得输出 actor/principal/Audience、骰面或随机结果、实际目标集合、Profile、状态、事件、作用域版本、JSON Patch、脚本或任意执行代码。实际 actor、目标、Audience、随机、事件与状态由 Room/Rules 派生。

明显可见且没有有意义不确定性的观察不得强行要求检定。违反已成立世界规律、明确缺少前提或 NPC 合理拒绝应在世界内正常结算，而不是伪造 Provider 错误。动态事实必须在任何骰面前提出；既有对象应复用，明确不存在时不得凭玩家一句话召唤有利物件。

环境即兴没有任何按对象名称、关键词、家族或原型分派的预设内容。若当前想法落在合理开放留白中，你必须依据玩家的具体方法与当前场景，自行定义对象内容并冻结材质、几何、耐久和有限 phase 图，再明确选择机械效果模式：state-only 只改变环境状态、地形、掩护或通行，不得虚构区域豁免、伤害或 Hazard；area-hazard 才继续冻结触发、区域、豁免、伤害和残骸机械。复用既有环境对象时，basisRefs 必须包含 Context Pack 中该对象的精确稳定引用；使用攻击激活时，abilityRef 必须逐字选择本次 finiteReferences 中该角色拥有的能力。不得按玩家措辞、对象标签、能力名称或别名猜测机械引用。不得把示例名称当成类别，也不得提交实际受影响实体集合。

只调用 submit_private_kp_form 一次，不输出解释文字。`;

const PRIVATE_FORM_REPAIR_SYSTEM = `你正在修复一个尚未提交的烛帷私有 Form 草稿。只允许一次窄修订。

工具中只有服务器选定的一张 Form Schema。必须保留原草稿的玩家 goal、method、target 语义、已确认选择以及已生成的 NPC 回应；semanticFreezeHash 是服务器绑定，不得改写或解释。只能修复列出的结构、引用或机械组合错误。不得请求或假设完整模组、完整历史、Story Bible、WorldState、骰面、事件、状态补丁、实际目标集合或其他 Form。只调用 submit_private_kp_form 一次，不输出解释文字。`;

function proposalTool(parameters: Readonly<Record<string, unknown>>) {
  return Object.freeze({
    type: "function",
    function: {
      name: PRIVATE_FORM_PROPOSAL_TOOL_NAME,
      description: "Choose and fill one private KP proposal form.",
      parameters,
    },
  });
}

export function privateFormProposalModelInput(input: Readonly<{
  request: KpProposalRequest;
  allowedForms: readonly KpFormId[];
  contextPack: unknown;
}>): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: PRIVATE_FORM_SYSTEM },
      {
        role: "user",
        content: canonicalJson({
          rootActionRef: input.request.rootActionId,
          proposalAttempt: input.request.attempt,
          allowedForms: modelFormDescriptors(input.allowedForms),
          contextPack: input.contextPack,
        }),
      },
    ],
    tools: [proposalTool(buildKpFormModelParameters(input.allowedForms))],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0.2,
    max_completion_tokens: 1_400,
  };
}

export function privateFormRepairModelInput(input: Readonly<{
  rootActionRef: string;
  originalForm: KpFormId;
  selectedForm: KpFormId;
  rejectedDraft: unknown;
  errors: readonly string[];
  finiteReferences: FiniteReferenceCatalog;
  semanticFreezeHash: string;
}>): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: PRIVATE_FORM_REPAIR_SYSTEM },
      {
        role: "user",
        content: canonicalJson({
          rootActionRef: input.rootActionRef,
          originalForm: input.originalForm,
          selectedForm: input.selectedForm,
          rejectedDraft: input.rejectedDraft,
          errors: [...new Set(input.errors)].sort().slice(0, 40),
          finiteReferences: {
            basisRefs: [...new Set(input.finiteReferences.basisRefs)].sort().slice(0, 192),
            abilityRefs: [...new Set(input.finiteReferences.abilityRefs)].sort().slice(0, 96),
            resourceRefs: [...new Set(input.finiteReferences.resourceRefs)].sort().slice(0, 96),
            artifactRefs: [...new Set(input.finiteReferences.artifactRefs)].sort().slice(0, 96),
          },
          semanticFreezeHash: input.semanticFreezeHash,
        }),
      },
    ],
    tools: [proposalTool(buildKpFormRepairParameters(input.selectedForm))],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: 1_200,
  };
}
