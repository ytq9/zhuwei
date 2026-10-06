import { canonicalHash, deepFreeze } from "./canonical-json";

/** Static descriptions locate a filling surface, never grant world authority.
 * Dependencies describe composable producer/consumer types, not action words. */
export const VNEXT_PROPOSAL_CAPABILITIES = deepFreeze([
  { id: "storyContinuity", proposalKind: "storyContinuity", description: "记录当前场景问题，按已成立事实回答问题或识别故事的胜利、不可逆失败、明确放弃。只更新主持记录，不代替移动、交付、NPC 决定或未结机械。", dependencies: [] },
  { id: "materializeStory", proposalKind: "materializeStory", description: "引用已评审故事准备中的一个定义候选，以原 handle 接入新 NPC、场景、物品或能力。只选择 preparationHash/candidateRef 和目录中的产物类型，宿主展开原有定义内容并验证；禁止重新抄写或改写候选。已接入人物用现有身份。", dependencies: [] },
  { id: "admitStoryFacts", proposalKind: "admitStoryFacts", description: "将已评审故事的实际选中事实及全部应同时成立的知情记录原子接入世界。只选 preparationHash 与事实候选 refs；同束先选择这些事实依赖的新人物/物件定义。草稿或未来计划不自动生效。", dependencies: ["materializeStory"] },
  { id: "abilityOperation", proposalKind: "abilityOperation", surface: "native", description: "调用本人已注册能力，选择实际目标与正常或仪式模式，或继续/取消本人正在施法的活动。能力目录提供真实成本与限制；Rules 执行攻击、豁免、资源、时间和最终效果。无需重新创作Ability或填写DC。遭遇中攻击生物用它或地图。", dependencies: [] },
  // SPEC 0012 §§3、5: turning on a creature outside an encounter starts one;
  // Rules rolls initiative and the attack waits for the attacker's turn.
  { id: "startCombat", proposalKind: "startCombat", surface: "native", description: "行动者尚未在战斗中，却要攻击或伤害在场的生物（拔武器砍、射击、施放伤害法术、偷袭）时选它开战：写参战者、敌对方向、逐个的突袭判断和开场描写。这一下不结算攻击；Rules掷先攻，各方按先攻轮流行动。对方已在进行中的遭遇里时，同一表单表示加入。擒抱、推撞、抱起仍是worldInteraction的常用动作。", dependencies: [] },
  // SPEC 0012 §§3.3、13 (ADR 0112): inside an encounter, the KP rules that
  // fighting stops; the players each accept or decline the end.
  { id: "endCombat", proposalKind: "endCombat", surface: "native", description: "行动者在遭遇中投降、脱离战斗，对手都已无力再战或冲突已不必按先攻进行时选它。NPC是否投降、接受投降或停战由它本人决定，要对方住手的话用social。是否结束战斗由每名活着的玩家决定。", dependencies: [] },
  { id: "materializeNpc", proposalKind: "materializeNpc", description: "在授权留白内创建有完整身份、目标、顾虑、声口和机械定义的 NPC；初始不自动取得任何知识。需要同束新 Ability 或新物品时，另选 authorAbility、authorItem。", dependencies: [] },
  { id: "materializeObject", proposalKind: "materializeObject", description: "固化开放留白中的场景对象、世界事实、地点与连接，或将已描述的环境承诺固化为可交互对象。创建地点与连接不会移动角色或支付通行成本。", dependencies: [] },
  { id: "completeObject", proposalKind: "completeObject", description: "由 KP 补全已有场景对象尚未确定的描述、状态或缺失的开关机械，保持原对象身份与既有事实。可与 observe 同束使用，不表示玩家触碰或改变对象。", dependencies: [] },
  { id: "observe", proposalKind: "observe", description: "获取实际感官证据，并依据角色已有知识或本次证据提出独立推断；保留来源、依据和不确定性，不替玩家决定信念。", dependencies: [] },
  { id: "formActorPlan", proposalKind: "formActorPlan", description: "依据某个NPC已有本人身份、知识和社会记录形成定时后续计划。形成只保存私有计划，不提前行动、推进时间、扣资源或发布未来痕迹。", dependencies: [] },
  { id: "social", proposalKind: "social", description: "与已知NPC当面对话：裁定对方听到什么、这番话是否起作用，在两张小表登记玩家明确表达的承诺及其对既有承诺的变更，各表无记录填[]。对方的回答、承诺、债务和关系变化由其本人另行作答。terms绑定主体、交付、条件及分项，due只表示期限，话语不代替履约。交谈用decision.duration，遭遇中填none；等待、通行或休整另走对应行动。", dependencies: [] },
  { id: "worldInteraction", proposalKind: "worldInteraction", description: "操作既有或同束新对象，执行检定、对地图物件（门、桌、绳索等场景要素）的攻击及已定义危险，以及擒抱、推撞等常用动作；表达操作附带的感官证据和实际世界后果。攻击生物不用它：战斗外开战用startCombat，战斗中用abilityOperation或地图。独立观察使用observe。", dependencies: [] },
  { id: "commitNarrativeDetail", proposalKind: "commitNarrativeDetail", description: "保存尚无因果或机械作用的环境描写及其受众，约束后续连续性。", dependencies: [] },
  { id: "authorAbility", proposalKind: "materializeDefinition", definitionKind: "ability", description: "创作可执行 Ability：攻击、豁免、范围、资源成本、伤害、治疗、状态和持续时间。调用已有 Ability 无需此定义 schema。", dependencies: [] },
  { id: "authorHazard", proposalKind: "materializeDefinition", definitionKind: "hazard", description: "创作危险的触发、可感知迹象、解除方法与环境后果，并以 Ability 表达其机械。危险实例所需的新场景对象或本次操作另选 materializeObject、worldInteraction。", dependencies: ["authorAbility"] },
  { id: "authorItem", proposalKind: "materializeDefinition", definitionKind: "item", description: "创作物品类别与属性定义；普通无机械效果的物件也先有定义，再物化和取得实物。所有权在实物上填写；使用或装备机械才需要 Ability，且须同束另选 authorAbility，未选时只能引用已有 Ability。", dependencies: ["materializeItem", "inventoryOperation"] },
  { id: "materializeItem", proposalKind: "materializeItem", description: "从冻结 itemDefinitionRefs 中已有定义或同束新物品定义创建实物实例；没有匹配定义时还须选择 authorItem，名称或知识描写不是定义ID。唯一性、数量和所有权由 Rules 验证。", dependencies: [] },
  { id: "inventoryOperation", proposalKind: "inventoryOperation", description: "取得、放下、转交、识别、装备、使用、损坏、修复或毁坏已存在的 ItemEntry；若对象只有描写、尚无实物实例，还需 materializeItem，缺少物品定义时再选 authorItem。由 Rules 执行资源和库存转换。", dependencies: [] },
] as const);

export type VNextProposalCapabilityId = (typeof VNEXT_PROPOSAL_CAPABILITIES)[number]["id"];
export const VNEXT_PROPOSAL_CAPABILITY_IDS = Object.freeze(VNEXT_PROPOSAL_CAPABILITIES.map(entry => entry.id));
/** The selector exposes only catalog identifiers. Step families are
 * selected once before a complete proposal, including clarification plans. */
export const VNEXT_INITIAL_PROPOSAL_CAPABILITIES: readonly VNextProposalCapabilityId[] = Object.freeze([]);
export const VNEXT_PROPOSAL_CAPABILITY_POLICY = deepFreeze({
  version: "zhuwei.proposal-capabilities/v11",
  catalog: VNEXT_PROPOSAL_CAPABILITIES,
  initialCapabilities: VNEXT_INITIAL_PROPOSAL_CAPABILITIES,
  // Dependencies are the families a type cannot be filled without. A family
  // that is only sometimes needed (an Ability for an item with mechanics, the
  // physical objects around a hazard) is selected explicitly, or added by the
  // one permitted selection amendment; loading it on every selection cost a
  // third of the filling request for nothing.
  selection: "exact-registered-identities-with-required-type-dependencies-only",
  // SPEC 0016 §7.2 (ADR 0089): completeObject only rewrites a scene feature
  // definition; with none the actor can see in its scene it is not offered.
  // SPEC 0014 §4, SPEC 0016 §7.2: unfinished doors may be completed; combat may end only in an encounter.
  offered: "completeObject-only-with-a-visible-scene-feature-definition-or-incomplete-map-object-in-the-actor-scene;endCombat-only-in-an-encounter",
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
