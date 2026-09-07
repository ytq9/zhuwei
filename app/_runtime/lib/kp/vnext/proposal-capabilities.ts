import { canonicalHash, deepFreeze } from "./canonical-json";

/** Static descriptions locate a filling surface, never grant world authority.
 * Dependencies describe composable producer/consumer types, not action words. */
export const VNEXT_PROPOSAL_CAPABILITIES = deepFreeze([
  { id: "abilityOperation", proposalKind: "abilityOperation", surface: "native", description: "调用本人已注册能力，选择实际目标与正常或仪式模式，或继续/取消本人正在施法的活动。能力目录提供真实成本与限制；Rules 执行攻击、豁免、资源、时间和最终效果。无需重新创作Ability或填写DC。", dependencies: [] },
  { id: "materializeObject", proposalKind: "materializeObject", description: "固化开放留白中的场景对象、世界事实、地点与连接，或将已描述的环境承诺固化为可交互对象。创建地点与连接不会移动角色或支付通行成本。", dependencies: [] },
  { id: "observe", proposalKind: "observe", description: "获取实际感官证据，并依据角色已有知识或本次证据提出独立推断；保留来源、依据和不确定性，不替玩家决定信念。", dependencies: [] },
  { id: "formActorPlan", proposalKind: "formActorPlan", description: "依据某个NPC已有本人身份、知识和社会记录形成定时后续计划。形成只保存私有计划，不提前行动、推进时间、扣资源或发布未来痕迹。", dependencies: [] },
  { id: "social", proposalKind: "social", description: "与已知 NPC 当面对话：依据该 NPC 自身冻结知识作出回应或沉默、关系变化及 NPC 权限内承诺和债务；保留原玩家表达，承诺不提前执行物理效果。交谈本身消耗虚构时间，由decision.duration的档位冻结（遭遇进行中填none）；需要等待、通行或休整的后续动作另提相应计划。", dependencies: [] },
  { id: "worldInteraction", proposalKind: "worldInteraction", description: "操作既有或同束新对象，执行检定、攻击及已定义危险；表达操作附带的感官证据和实际世界后果。独立观察使用observe。", dependencies: [] },
  { id: "commitNarrativeDetail", proposalKind: "commitNarrativeDetail", description: "保存尚无因果或机械作用的环境描写及其受众，约束后续连续性。", dependencies: [] },
  { id: "authorAbility", proposalKind: "materializeDefinition", definitionKind: "ability", description: "创作可执行 Ability：攻击、豁免、范围、资源成本、伤害、治疗、状态和持续时间。调用已有 Ability 无需此定义 schema。", dependencies: [] },
  { id: "authorHazard", proposalKind: "materializeDefinition", definitionKind: "hazard", description: "创作危险的触发、可感知迹象、解除方法与环境后果，并以 Ability 表达其机械。", dependencies: ["authorAbility", "materializeObject", "worldInteraction"] },
  { id: "authorItem", proposalKind: "materializeDefinition", definitionKind: "item", description: "创作物品定义、所有权与生命周期语义，必要时创作使用或装备 Ability，并物化、取得或使用实物。", dependencies: ["authorAbility", "materializeItem", "inventoryOperation"] },
  { id: "materializeItem", proposalKind: "materializeItem", description: "从已有或同束新物品定义创建实物实例；唯一性、数量和所有权由 Rules 验证。", dependencies: [] },
  { id: "inventoryOperation", proposalKind: "inventoryOperation", description: "取得、放下、转交、识别、装备、使用、损坏、修复或毁坏实际物品；由 Rules 执行资源和库存转换。", dependencies: [] },
] as const);

export type VNextProposalCapabilityId = (typeof VNEXT_PROPOSAL_CAPABILITIES)[number]["id"];
export const VNEXT_PROPOSAL_CAPABILITY_IDS = Object.freeze(VNEXT_PROPOSAL_CAPABILITIES.map(entry => entry.id));
/** The selector exposes only catalog identifiers. Step families are
 * selected once before a complete proposal, including clarification plans. */
export const VNEXT_INITIAL_PROPOSAL_CAPABILITIES: readonly VNextProposalCapabilityId[] = Object.freeze([]);
export const VNEXT_PROPOSAL_CAPABILITY_POLICY = deepFreeze({
  version: "zhuwei.proposal-capabilities/v4",
  catalog: VNEXT_PROPOSAL_CAPABILITIES,
  initialCapabilities: VNEXT_INITIAL_PROPOSAL_CAPABILITIES,
  selection: "exact-registered-identities-with-transitive-type-dependencies",
  unavailable: "technical-error-never-world-refusal",
});
export const VNEXT_PROPOSAL_CAPABILITY_POLICY_HASH = canonicalHash(VNEXT_PROPOSAL_CAPABILITY_POLICY);

/** Preserve the failing registry identity for callers that can locate its
 * submitted field. This remains the same fail-closed capability lookup. */
export class UnknownVNextProposalCapabilityError extends TypeError {
  constructor(readonly capabilityId: string) {
    super("PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN");
    this.name = "UnknownVNextProposalCapabilityError";
  }
}

/** Canonical registry order makes reordering/duplicating query terms harmless.
 * Unknown IDs fail instead of silently falling back to a different surface. */
export function closeVNextProposalCapabilities(requested: readonly string[]): readonly VNextProposalCapabilityId[] {
  const selected = new Set<VNextProposalCapabilityId>();
  function include(id: string): void {
    const entry = VNEXT_PROPOSAL_CAPABILITIES.find(candidate => candidate.id === id);
    if (!entry) throw new UnknownVNextProposalCapabilityError(id);
    if (selected.has(entry.id)) return;
    selected.add(entry.id);
    entry.dependencies.forEach(include);
  }
  requested.forEach(include);
  return Object.freeze(VNEXT_PROPOSAL_CAPABILITY_IDS.filter(id => selected.has(id)));
}

/** Only the discriminant surface changes when schemas are selected. All field,
 * reference, semantic and Rules validation remains in the existing validators. */
export function vnextProposalCapabilityForEntry(value: unknown): VNextProposalCapabilityId | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  return VNEXT_PROPOSAL_CAPABILITIES.find(capability => {
    if (entry.kind !== capability.proposalKind) return false;
    if (!("definitionKind" in capability)) return true;
    const source = entry.source;
    return source !== null && typeof source === "object" && !Array.isArray(source)
      && (source as Record<string, unknown>).kind === capability.definitionKind;
  })?.id;
}
