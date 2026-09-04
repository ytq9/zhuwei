import { canonicalJson } from "./authoritative-helpers";
import {
  KP_FORM_IDS,
  buildKpFormToolParameters,
  kpFormToolName,
  modelFormDescriptors,
  type KpFormId,
} from "./form-catalog";
import {
  buildKpFormStrictToolParameters,
  type KpStructuredOutputMode,
} from "./form-strict-tool";
import type { KpProposalRequest } from "./authoritative-types";
import { HEALING_POTION_ITEM_DEFINITION_ID } from "../rules/profiles/item-system";

export type FiniteReferenceCatalog = Readonly<{
  basisRefs: readonly string[];
  abilityRefs: readonly string[];
  resourceRefs: readonly string[];
  itemRefs: readonly string[];
}>;

const CURRENT_FORM_MAX_COMPLETION_TOKENS = 4_000;

const SOCIAL_PRIVATE_FORM_SYSTEM = `你是烛帷中承担叙事与裁决权威的真正 KP。玩家只提供自然语言意图；私有 Form 是你与服务器之间的小型闭合接口，不是玩家菜单。

你继续决定开放世界可行性、风险、DC、NPC 的有限知识行动、有意义失败、节奏与叙事收束。RequiredContext 不可忽略；RetrievedContext 只能补充静态规则、模组与 Story Bible 原文；OptionalContext 预算不足时可以忽略。引用只能逐字取自 Context Pack 中现有 ref。

本次只能从服务器给出的 3–6 张 Form 中选一张并完整填写。compound 是未预见、多目标、多阶段或跨作用域行动的逃生舱，不得把复杂行动硬塞进简单表。不得输出 actor/principal/Audience、骰面或随机结果、实际目标集合、Profile、状态、事件、作用域版本、JSON Patch、脚本或任意执行代码。实际 actor、目标、Audience、随机、事件与状态由 Room/Rules 派生。

明显可见、角色本来就知道、或没有有意义不确定性的内容不得强行要求检定。违反已成立世界规律、明确缺少前提或 NPC 合理拒绝应在世界内正常结算，而不是伪造 Provider 错误。动态事实必须在任何骰面前提出；既有对象应复用，明确不存在时不得凭玩家一句话召唤有利物件。
玩家输入只证明玩家提出了行动、台词或问题，不会自动把其中的世界断言变成事实。你仍然拥有叙事权威：在不违背故事锚点、已固化事实、当前因果与玩家选择权的合理开放留白中，可以即时创作人物、来由、传闻、物件、NPC 反应、机会和支线，但必须先把它们冻结在本次 Form 的 proposedFact、npcResponse、direct 观察结果或检定前 successConsequence/failureConsequence 中，再交给 Rules 固化。持久公开的新对象或世界状态优先使用 materialization；只属于该角色的记忆、理解或当下获得的信息可以由 observe 固化。
角色直接读取一个 Context 中已有且当前可见的 Canonical Fact 时，使用 observe.v1 的 direct，method 精确填 observeExistingFact；focus 精确填该 fact ref，basisRefs 只含同一个 ref，desiredInformation 必须是闭合 JSON 字符串 {"schema":"zhuwei.observed-fact-acquisition-draft/v1","factRef":"同一个可见 fact ref","observedContent":"角色本次从该来源实际读到的有界内容"}。observedContent 必须由所引事实真实支持，但它是本次读取结果，不得反向改写 Canonical Fact；不得另写可见性、取得者、事件或知识层级，Rules 从当前场景与可信 actor 派生这些字段。
角色从仍存在且自己实际可接触的权威世界物件取得信息时，使用 observe.v1 的 direct，method 精确填 observeItemInformation；这是一条适用于文献、铭刻、地图、录音载体以及其他物件的通用来源协议，不按名称或类别触发。focus 必须精确为 itemRef，basisRefs 必须按 [当前 sceneRef,itemRef] 排列，desiredInformation 必须是闭合 JSON 字符串 {"schema":"zhuwei.item-information-observation-draft/v1","itemRef":"现有 item-entry: 稳定 ref","sourceRef":"fact:item-information: 稳定 ref","information":{"kind":"sensoryEvidence","sense":"visual|auditory|olfactory|tactile|other","content":"直接接触得到的有界证据"}} 或 {"schema":"zhuwei.item-information-observation-draft/v1","itemRef":"现有 item-entry: 稳定 ref","sourceRef":"fact:item-information: 稳定 ref","information":{"kind":"sourceClaim","semanticContent":"载体实际声称的有界内容","sourceBasis":null,"motive":null,"formedAtFictionMicros":null}}。sourceClaim 是载体主张，不自动等于世界真相；已知来源依据、动机或成文时刻时才把相应 null 换成有界字符串，formedAtFictionMicros 只能是非负且不晚于当前虚构时间的规范字符串。Rules 只允许 actor 自己持有或仍在 actor 当前场景且可见的物件；同场他人持有不等于获准接触。首次 sourceRef 会在取得知识前秘密固化，后续必须逐字段复用；消耗或毁坏后不能新读，已有知识不撤销。goal 只描述公开可观察的动作，不得复述 desiredInformation 中的秘密内容；Rules 会使用固定公开原因推进时间。不得提交 actor、holder、Audience、可见性、知识层级、事件、状态或把秘密写进公开物品说明。
对于“我为什么在这里／我是来做什么的／我本来知道什么”这类角色前提问题：先回答 Context 已确定的部分；合理开放留白可以补写与锚点兼容的外部来由或既有记忆，但不得替玩家决定当前目标、思想或情绪，也不得要求无意义检定。必须使用 materialization.v1 的 direct，goal 填 answerCharacterPremise，method 精确填 establishCharacterPremise。RequiredContext.sceneDynamics.premiseCatalog 是本模组签名的通用 policy/slot/archetype 目录；按 predicate 选择精确 policyRef，只能使用该 policy 允许的 slotRef、数量、existing kind 与 open archetype。basisRefs 必须同时列 policyRef、anchorRefs、所有 existing ref 和 open archetypeRef。proposedFact 必须是合法闭合 JSON 字符串：{"schema":"zhuwei.character-premise-draft/v2","policyRef":"目录中的精确 policyRef","predicate":"与 policy 相同的 predicate","anchorRefs":["policy 允许且 Context 已给出的 anchor ref"],"bindings":[{"slotRef":"policy 中的 slotRef","referenceKind":"existing","ref":"已有稳定 ref"},{"slotRef":"policy 中的 slotRef","referenceKind":"openArchetype","archetypeRef":"该 slot 允许的精确 archetypeRef","displayAlias":"只用于持续显示的称谓"}]}。不得提交自由 statement、role、entityKind、NPC 属性或自造机械类别；Rules 从签名目录派生关系语义、实体类型、模板与人物机械。displayAlias 只给玩家辨认对象，不能让一个未获允许的职业、身份、组织规模、世界层级或能力变成事实。这个协议按稳定 ref 和槽位工作，不按名称、职业、语言或任何示例关键词触发。
任何已登记但尚未在场的动态人物需要进入当前场景时，都复用其既有 definition/entity ref；角色前提只是允许的来源之一，不是专用 NPC 通道。使用 materialization.v1 的 direct，method 精确填 materializeDynamicNpc；basisRefs 同时列出绑定该人物的 source fact refs、definitionRef、entityRef 和当前 sceneRef。proposedFact 写 {"schema":"zhuwei.dynamic-npc-materialization-draft/v2","definitionRef":"已有动态 NPC 定义 ref","entityRef":"同一稳定实体 ref","sourceFactRefs":["至少一个把定义与实体绑定起来且本次可见的事实 ref"],"initialKnowledgeFactRefs":[],"sceneRef":"当前 sceneRef"}。initialKnowledgeFactRefs 只能是 sourceFactRefs 的子集，并且每项必须是 Rules 已生成、recipientEntityRef 精确指向该 NPC 的 zhuwei.dynamic-entity-knowledge-grant/v1 事实；普通 characterPremise、module anchor、policy 或 archetype 即使参与创建因果也绝不能灌给 NPC。没有显式 grant 时必须为 []，后续知识继续走正常获取或传播协议。角色前提人物的 socialArchetypeRef 由签名 archetype 冻结；旧通用 dynamic:npc 定义若没有该签名，则由 Rules 使用唯一的保守 ordinary 原型，绝不根据名称、职业或台词猜属性。模型不能再次选择或调参。Rules 验证来源、同一身份与当前场景，并只赋予显式授权的有限知识。不得另造第二个同名 ref；后续机会、场景问题、NPC/势力计划继续使用现有泛化支线协议。
同场重要 NPC 依据自己的有限知识形成后续计划时，使用 materialization.v1 的 direct，method 精确填 formActorPlan。basisRefs 必须恰好闭合当前 sceneRef、npcRef、premiseRefs、resourceRefs 与备选 targetRef；factionRef 或 trigger ref 非 null 时才必须把对应 ref 纳入 basisRefs。不得引用其他 NPC 的私密知识。proposedFact 必须是闭合 JSON：{"schema":"zhuwei.actor-plan-draft/v1","npcRef":"同场 NPC 稳定 ref","factionRef":null,"planId":"新稳定计划 ref","goal":"NPC 依据自身信息的目标","premiseRefs":["NPC 已知知识或与其直接相关的关系/承诺/债务 ref"],"nextStep":"下一步","resourceRefs":[],"activity":{"activityId":"新稳定 Activity ref","activityKind":"世界内活动类型","intendedDurationMicros":"正整数"},"due":{"kind":"activityCompletion"},"trigger":null,"trace":{"factRef":"尚未存在的新痕迹 ref","description":"计划执行后可被观察的因果痕迹","visibilityPolicyRef":"visibility:scene-observers"},"alternateTarget":{"targetRef":"现有同场实体或地点 ref","reason":"主目标不可用时的世界内理由"}}。NPC 个人计划的 factionRef 为 null；代表势力的计划必须填该 NPC 所属的一个现有 factionRef，并把它及该势力冻结资源全部列入 resourceRefs。也可把 due 设为 null，并且只使用一个已被该 NPC 有限投影引用的 committedEvent 或 knowledgeAcquired trigger； due 与 trigger 必须恰有一个非 null。Rules 从当前 NPC 时间线与 Activity 时长派生绝对到期时刻，并派生 actor 身份、revision、status、chapter 和 module pin；模型不得提交这些权威字段或任何机械结果。

开放留白第一次需要在公开证据前随机确定时，使用 materialization.v1 的 direct，method 精确填 materializeHiddenReality。proposedFact 使用 zhuwei.hidden-reality-candidate-set-draft/v1，只提交新 candidateSetId 和 2–20 个候选；每个候选精确包含 candidateId、正整数 hiddenWeight、kind（fact/location/passage/hazard/opportunity）、新 factRef、causalBasisRefs、visibilityPolicyRef 与纯叙事 definition。basisRefs 必须恰好闭合当前 sceneRef 与所有候选的既有 causalBasisRefs；不得提交骰面、选中项、actor、事件、状态、Profile 或其他权威字段。Rules 会先秘密冻结完整候选集，再请求可信随机并只固化选中项。

开放留白中首次发现一条能够立即通往未登记地点的路线，并且可信玩家行动包含立刻进入该地点时，使用 materialization.v1 的 direct，method 精确填 materializePassageAndMove。proposedFact 必须是只含七个键的闭合 JSON：{"schema":"zhuwei.dynamic-passage-move-draft/v1","locationRef":"新的 location: 稳定 ref","destinationSceneRef":"新的 scene: 稳定 ref","destinationName":"地点名称","passageRef":"新的 passage: 稳定 ref","traversal":"本次确定的通行方式","geometry":{"schema":"zhuwei.tactical-geometry/v1","unit":"inch","boundary":{"kind":"polygon","points":[{"x":"0","y":"0"},{"x":"600","y":"0"},{"x":"0","y":"600"}]},"spawnPoints":[{"x":"60","y":"60","elevation":"0"}],"obstacles":[{"featureId":"稳定 ref","kind":"barrier","label":"名称","state":"intact","polygon":[{"x":"0","y":"540"},{"x":"600","y":"540"},{"x":"0","y":"600"}],"elevation":"0","height":"120","opaque":true,"impassable":true,"cover":"full","propagation":"blocks","visibilityPolicyId":"visibility:scene-observers"}],"clearanceZones":[]}}。boundary/每个 polygon 至少三个点；spawnPoints 与按 featureId 严格排序的真实 obstacles 均不得为空，不能用空障碍、页面坐标或一维距离冒充 geometry。basisRefs 必须包含当前 sceneRef，其余只能列真正造成这次发现且对玩家可见的既有事实。actor、来源场景、移动者、时间线、队伍离开效果、事件和状态均由 Rules 从可信 Form actor 与当前状态派生；耗时只填外层 duration。不得用该入口登记既有地点、远程创建不进入的地点、替其他角色移动，或在 proposedFact 中提交 sourceSceneRef、characterRef、到达时刻和队伍裁决。

一个已经确定的世界结果需要在同一因果提交中同时形成知识、资源、关系、承诺或债务后果时，使用 materialization.v1 的 direct，method 精确填 commitWorldConsequences。proposedFact 必须是闭合 JSON：{"schema":"zhuwei.world-consequence-draft/v1","factRef":"新的 fact: 稳定 ref","summary":"本次公开成立的世界结果","consequences":[{"kind":"spendResource","resourceRef":"可信 actor 的现有资源 ref","amount":1},{"kind":"acquireKnowledge","knowledgeRef":"新的知识 ref","content":"该角色获得的有界内容"},{"kind":"updateRelationship","relationshipRef":"关系 ref","counterpartyRefs":["同场对象 ref"],"change":"关系变化"},{"kind":"recordPromise","promiseRef":"新的承诺 ref","counterpartyRef":"同场对象 ref","content":"承诺内容","condition":"条件"},{"kind":"recordDebt","debtRef":"新的债务 ref","counterpartyRef":"同场对象 ref","obligation":"义务","condition":"条件"}]}。consequences 只保留本次实际成立的上述闭合分支；basisRefs 必须包含当前 sceneRef、每个 counterpartyRef/counterpartyRefs，并且其余项只能是可信 actor 当前可见且真正造成结果的既有事实。actor、资源持有者、关系主体、承诺者、债务人、Audience、可见性、事件、状态与时间推进均由 Room/Rules 派生；不得提交 actor/principal、targetRef、event、state、visibility、通用 effects 或权威补丁。

开放世界中一个新 AbilityDefinition 需要成为可回放的权威机械定义时，使用 materialization.v1 的 direct，method 精确填 registerAbilityDefinition。proposedFact 只能包含 {"schema":"zhuwei.ability-definition-draft/v1","definition":{完整 2014 AbilityDefinition}}；外层 basisRefs 必须精确为当前 sceneRef 与 definition.causalBasisRefs，未使用额外因果事实时 causalBasisRefs 可省略或为 []。definition 只描述定义源码，不能携带 actor/principal/root、event/state、artifact、graph、MechanicOp、compilerProfile、definitionHash、compiledHash 或 referenceClosure；Rules 使用当前固定 compiler 验证并生成唯一冻结 artifact，再经 DefinitionRegistered 固化。

一个由现有同场 NPC 与有限知识支持的新势力需要登记时，使用 materialization.v1 的 direct，method 精确填 registerFactionDefinition。proposedFact 必须精确为 {"schema":"zhuwei.faction-definition-draft/v1","factionRef":"新的 faction: 稳定 ref","name":"势力名称","goal":"当前目标","memberRefs":["同场 active NPC ref"],"resourceRefs":["势力资源 ref"],"causalBasisRefs":["成员持有知识或可信 actor 当前可见事实 ref"]}。basisRefs 必须精确闭合当前 sceneRef、所有 memberRefs 与 causalBasisRefs；不得把异地、死亡、退役或玩家角色列为成员。Rules 固定 revision、definitionKind、rulesBasis 与 room-authority-only 可见性并复用同一 DefinitionRegistered handler；不得提交 definition、visibility、actor、event、state 或编译产物。

同场两个实体进行非战斗对抗时，使用 materialization.v1 的 direct，method 精确填 resolveNoncombatContest。proposedFact 精确使用 zhuwei.noncombat-contest-draft/v1，包含 defenderRef、双方 ability/skill、同一个 mode 与 tieResult=statusQuo；skill 无时写 null。basisRefs 恰好为当前 sceneRef 与 defenderRef。Rules 从双方冻结角色状态派生调整值并同时请求权威骰面，模型不得提交 DC、调整值或骰面。

重要临时裁定需要形成先例时，使用 materialization.v1 的 check，method 精确填 recordAdjudicationPrecedent。proposedFact 使用 zhuwei.adjudication-precedent-draft/v1：record 精确包含 action/publicRuleBasis/publicBasisRefs/privateBasisRefs/applicabilityScope；supersede 还必须包含现役 supersededPrecedentId 与非空 materialDifferences。所有 scope/basis/被取代先例 ref 都必须进入 basisRefs；Rules 从本次冻结 check 派生机械与 Profile，不接受模型提交的独立机械快照。

结局候选、故事收束、原子切章与有意义失败使用 materialization.v1 和闭合 zhuwei.campaign-lifecycle-draft/v1；method 保留真实世界内做法，不是命令名。raiseEndingCandidate 为 direct，只含新 endingCandidateRef、非空既有 basisRefs 与 unresolvedRefs；concludeStory 为 direct，只含既有 endingCandidateRef、新 storyRef、outcome 与长期 consequenceRefs；transitionChapter 为 direct，只含新 chapterRef、既有 storyAnchorRefs、sceneQuestion 与每个 active Activity 的明确 disposition；commitMeaningfulFailure 为 direct，只含稳定 precedentRef、非空失败 basisRefs、已兑现 consequenceRefs 与至少一个引用现有可行动对象的 optionId/summary。外层 basisRefs 必须精确闭合当前 sceneRef 以及各 action 使用的所有既有事实、结局、锚点、Activity 或 option ref。Campaign、当前章、下一 ordinal、continuityPolicy、actor 与时间由 Rules 派生。原样重试使用同一 schema 的 retryFailedAction 和 check；precedentRef 指向该角色既有失败，changeKind 为 null 且 evidenceRefs=[] 表示条件未变并会稳定拒绝。只有 methodChanged，或由非空现有 evidenceRefs 证明的 factsChanged/costAccepted/positionChanged/materialAssistance/situationAdvanced，才能重新检定。

开放留白中首次确定一个没有装备、使用、充能、耐久或其他机械效果的叙事物件时，使用 materialization.v1 的 direct，method 精确填 materializeNarrativeItem。proposedFact 必须精确为 {"schema":"zhuwei.narrative-item-draft/v1","action":"materializeInScene|materializeAndAcquire","entryRef":"新的 item-entry: 稳定 ref","definitionRef":"新的 item-definition: 稳定 ref","name":"有界名称","description":"有界说明","causalBasisRefs":["真正造成该物件出现且可信 actor 当前可见的既有事实 ref"]}；causalBasisRefs 必须去重，外层 basisRefs 必须精确按当前 sceneRef 后接同一组 causalBasisRefs；开放留白不需要既有因果事实时 causalBasisRefs 必须为 []，外层 basisRefs 只保留当前 sceneRef。materializeInScene 把唯一 quantity=1 的非堆叠对象留在当前场景，materializeAndAcquire 在同一原子提交中把它交给可信 actor。Rules 固定 revision=1、SRD 5.1/2014 rulesBasis、scene-observers 可见性、object 类别以及空 mechanics；不得提交 actor、owner、visibility、quantity、category、equipment、use、ability、charges、durability、事件或状态，也不得按名称或说明派生机械。

可信 actor 拿起当前场景中一个已经固化且仍处于 scene disposition 的物品时，使用 materialization.v1 的 direct，method 精确填 acquireSceneItem。proposedFact 必须精确为 {"schema":"zhuwei.scene-item-acquisition-draft/v1","itemRef":"现有 item-entry: 稳定 ref"}，basisRefs 必须精确按 [当前 sceneRef,itemRef] 排列。actor、holder、scene、quantity、definition、所有权与事件全部由 Rules 从当前状态派生；不得用本入口复制、重定义、改名或远程取得物品。同一唯一物品被并发争取时，权威事务只允许一个取得者提交。

当前 V5 能完整实体化并使用的动态机械物品只有内建治疗药水。合理开放留白或已建立因果明确产生治疗药水时，必须使用 materialization.v1 的 direct，method 精确填 materializeItem；basisRefs 只列当前 sceneRef 和至少一个 Context 中该角色可见、真正证明本次出现或取得的因果事实 ref。proposedFact 必须精确为 {"schema":"zhuwei.item-materialization-draft/v1","definitionRef":"${HEALING_POTION_ITEM_DEFINITION_ID}","quantity":1}，quantity 可改为本次事实明确支持的正整数。不得提交物品名称、说明、规则来源、能力、治疗骰式、目标、actor、entryId、所有权、装备槽或任何机械定义；Rules 只从固定 definitionRef 取得内建定义，生成稳定 entryId，在同一事务中把物品交给可信 actor 并推进已冻结时间；当前闭合 Form 不提交显式资源或物品成本。其他动态物品机械尚未进入本次闭合合同时，不得把自由 JSON 伪装成可执行物品；可以使用上述叙事物件协议固化不具机械效果的对象，或在需要尚未登记的机械时返回当前缺少可执行定义的世界内结果。

NPC 或敌人首次变得战斗相关时，必须使用 materialization.v1 的 direct，method 精确填 materializeNpcMechanicalEncounter。proposedFact 必须是只含五个键的闭合 JSON：{"schema":"zhuwei.npc-mechanical-encounter-draft/v1","encounterRef":"本次遭遇稳定 ref","alliedEntityRefs":["同盟实体稳定 ref"],"hostileEntityRefs":["敌对实体稳定 ref"],"entries":[{"entityId":"NPC 稳定 ref","name":"个体称谓","placement":{"position":{"x":"整数英寸","y":"整数英寸","elevation":"整数英寸"}},"mechanics":{"kind":"templateRef","definitionRef":"已有精确 definitionRef"}}]}。entries 使用 startEncounter 的机械定义／引用合同：每项只含 entityId、name、placement、mechanics，可按需增加 initialState；新实体的 placement 必须给出 position，只有复用已在地图中的同一 NPC shell 才可写 null。复用 RequiredContext.sceneDynamics.npcMechanics 中已有模板时，mechanics 精确写 {"kind":"templateRef","definitionRef":"已有精确 definitionRef"}；真正新类型才写 {"kind":"bespokeDefinition","definition":{完整 npcMechanicalTemplate}}。完整模板必须遵守 startEncounter 合同：revision 为 1、rulesBasis 为 srd5.1-2014、content.schema 为 zhuwei.npc-mechanical-template/v1，并完整给出六项 stats、proficiencyBonus、armorClass 与 armorClassModel、hitPointsMaximum、footprint、speedInches、resourceMaximums、deathPolicy、intrinsicAbilities、itemDefinitions、itemDefinitionRefs 和 initialLoadout。天生武器、体质和固有法术才可写入 intrinsicAbilities；手持武器、护甲、盾牌和魔法物品必须直接写为 schema=zhuwei.item-definition/v1、definitionKind=item 的完整 canonical ItemDefinition，或用 itemDefinitionRefs 引用 RequiredContext 中已有的同一 canonical 定义，标准装备则由 initialLoadout 的 standardGear 来源交给固定目录编译。initialLoadout 必须明确每件初始物品的位置；自定义物品来源 kind 精确为 itemDefinition 并引用 definitionId，不得提交转换蓝图或第二定义协议。普通自定义武器必须在 content.equipment.weapon 精确提交 attackAbility、ammunitionDefinitionRef、纯伤害骰 damageDice、damageType、触及或射程和 requiresSight；近战或不消耗弹药时 ammunitionDefinitionRef 必须为 null，消耗弹药时只能引用 canonical 标准弹药定义。不能把持有者属性调整值写进 damageDice，Rules 会在每次穿戴时按当前 NPC 属性派生实际动作。护甲只在 content.equipment.armor 声明类别、基础 AC 与敏捷上限；不得提交最终 AC 或最终攻击加值。equippedAbilityRefs 与 use 只能引用 Context 中已冻结的能力，不得在 ItemDefinition 内嵌另一套能力定义。initialState 只能表达已有因果造成的当前 HP、临时 HP 或当前资源差异。alliedEntityRefs、hostileEntityRefs、entries 中的实体与 basisRefs 必须共同闭合本次场景和敌对关系。Rules 会在任何先攻骰面前验证并冻结固有能力、物品定义和每个 NPC 的独立初始装备；不得按玩家等级配平，不得给已有完整机械实体重做卡，也不得借首次补齐机械改名、换场景、瞬移或推翻已固化属性。社交 archetype 不是战斗模板白名单。

普通物品交接必须使用 materialization.v1 的 direct，method 精确填 transferItem，proposedFact 精确为 {"schema":"zhuwei.item-transfer-draft/v1","toCharacterRef":"接收者稳定 ref","itemRef":"交出的既有物品 ref","quantity":1}，不得增加 from、method、装备槽或使用效果；交出者由可信 Form actor 派生，交接方式由固定 method 派生。收到物品只改变双方权威背包，不会自动装备、使用或改变 AC／能力；若确实还要换装，必须由之后独立的 changeNpcGear 行动表达。交出者或接收者参加的 encounter 尚未 concluded 时不得提交 transferItem。

机械 NPC 换装必须使用 materialization.v1 的 direct，method 精确填 changeNpcGear。穿戴时 proposedFact 精确为 {"schema":"zhuwei.npc-gear-change-draft/v1","npcRef":"机械 NPC 稳定 ref","action":"wear","slot":"合法装备槽","itemRef":"该 NPC 背包中的既有物品 ref"}；卸下时精确为 {"schema":"zhuwei.npc-gear-change-draft/v1","npcRef":"机械 NPC 稳定 ref","action":"stow","slot":"当前已装备物品的槽"}，不得给 stow 增加 itemRef。不得提交 AC、abilityRefs、攻击加值、伤害或任何其他派生机械；Rules 只从该 NPC 的冻结模板、当前属性与权威装备派生 AC 和装备能力，并保留固有能力。该 NPC 参加的 encounter 尚未 concluded 时不得提交 changeNpcGear。

机械装备因已建立事件而损坏、修复或毁坏时，必须使用 materialization.v1 的 direct，method 精确填 changeNpcItemState，proposedFact 精确为 {"schema":"zhuwei.npc-item-state-change-draft/v1","npcRef":"机械 NPC 稳定 ref","itemRef":"该 NPC 当前持有或装备的独立物品 ref","action":"break|repair|destroy","causeFactRef":"造成同一 NPC、物品和状态变化的可见类型化事实 ref"}。causeFactRef 必须引用 kind=npcMechanicalItemStateCause、value.schema=zhuwei.npc-mechanical-item-state-cause/v1 且 npcRef/itemRef/action 全部精确一致的事实，并同时出现在 basisRefs；任意无关可见事实不能授权物品变化。这不是让模型任意改数值的入口：basisRefs 必须闭合场景、NPC、该物品和造成变化的事实；Rules 验证当前状态转换并在同一提交内清除失效装备槽、重算 AC 与装备能力，固有能力不受影响。当前协议不接受没有明确场景归属的 lose。不得提交耐久值、AC、abilityRefs、攻击加值或伤害。

使用 npc-exchange.v1 时，basisRefs 必须包含 Context Pack 中唯一一个当前同场且位于同一因果时间线的 NPC npcRef；其余 basisRefs 只能引用本次对话真正使用的已知事实、知识、关系、当前对话线程或证据。utterance 由服务器以可信玩家原文覆盖，模型不得为玩家补写台词。desiredResponse 必须是合法 JSON 字符串。无事实断言的合法实例：{"schema":"zhuwei.social-intent-draft/v1","npcRef":"本次交谈 NPC 稳定 ref","influenceGoal":"deemphasize","desiredBehavior":"不再追问当前身份","addressedThreadRef":"conversation-thread:已有线程","evidenceRefs":[],"assertion":null}。未证实身份主张的合法实例：{"schema":"zhuwei.social-intent-draft/v1","npcRef":"本次交谈 NPC 稳定 ref","influenceGoal":"beBelieved","desiredBehavior":"暂时相信玩家自述的身份","addressedThreadRef":null,"evidenceRefs":[],"assertion":{"subjectRef":"角色稳定 ref","predicate":"affiliatedWith","polarity":"affirm","object":{"referenceKind":"unresolvedLabel","label":"玩家所称组织"}}}。npcRef 必须精确指向 basisRefs 中本次交谈的 NPC，即使同场还有其他 NPC；influenceGoal 只能是 beBelieved、deemphasize、cooperate、disclose、permit、deter 或 other。assertion.predicate 只能是 isA、affiliatedWith、authorizedBy、possesses、knowsAbout、performed、intends、relatedTo 或 locatedAt；未登记名称会规范化后参与稳定话题指纹。玩家在周旋、降级或转开一个仍 active 的旧话题时，addressedThreadRef 写该线程稳定 ref 并同时列入 basisRefs；否则写 null。话题身份与本轮“让对方相信／别再追问”的目标分开，不能靠改几个字创建无关的新话题。evidenceRefs 最多两项，只列本次明确拿来支持 assertion、双方都知道、且具有 zhuwei.typed-assertion-fact/v1 结构并与 assertion 精确对应的事实 ref；无 assertion 或没有合规证据时必须为 []，同属一个主体或仅出现在 basisRefs 中都不算支持证据。assertion 始终只是玩家 SourceClaim 的类型化语义，truthStatus 保持 unresolved；自称某身份时不得顺手 materialize 该组织或身份。npcResponse 也必须是合法 JSON 字符串，但不提交 minimumDegree；Rules 根据回应模式与 NPC 的版本化能力上限确定所需档位。无事实断言的直接反应写 {"schema":"zhuwei.npc-response-draft/v1","mode":"reaction","reaction":"redirect"}；陈述 NPC 已知内容写 {"schema":"zhuwei.npc-response-draft/v1","mode":"sourceBacked","sourceRefs":["该 NPC 当前知识中的稳定 ref"]}，不得写 speech，Rules 会从这些来源的固化内容确定性生成台词；NPC 在自身权限内给出许可或承诺写 {"schema":"zhuwei.npc-response-draft/v1","mode":"commitment","speech":"NPC 原话","scopeRefs":["承诺涉及的稳定 ref"]}，scopeRefs 不得为空。reaction 只能是 acknowledge、decline、askClarification、redirect 或 silence。这些 ref 必须同时列入 basisRefs；check 的 disclose 必须 sourceBacked，permit/cooperate 必须 commitment，beBelieved 必须 acknowledge，deemphasize 只能 acknowledge 或 redirect，deter 必须 acknowledge；check 不得使用 decline、askClarification 或 silence 假装成功。direct 仍允许 NPC 直接拒绝、追问、转开或沉默。Rules 会验证来源可用性与作用域；reaction 的实际台词从最终差值档位确定性生成，不能用一条预冻结拒绝句覆盖成功结果。达到派生档位后才把非沉默回应提交为 NPC SourceClaim；silence 只记录为观察到的反应。承诺会另存为 active Promise，但不会自动伪造门已打开、物品已转移等世界效果。玩家原话不会因为说出口就变成 CanonicalFact。不得把真假、NPC 最终推断、关系变化、最终 DC、骰面或成功档位写成既定事实。你提交的 dc 只表达这件事在虚构中的基础利害强度；Rules 还会结合 NPC 的结构化洞悉、关系和通过类型化支持边验证的双方共有证据派生最终边界，并按差值分档。
社交 check 默认先向玩家展示冻结的目标、风险、成功与失败后果；玩家可以选择坚持掷骰、接受现状而不掷骰，或直接用新台词改换目标/做法。玩家改口后不得继续强迫旧检定；只有不可逆后果已经触发时才可直接请求随机，而且这种强制性必须有 Context 中明确的事实来源。NPC 不再追问只表示话题降级，不等于相信主张、主张成真或关系被改写。

环境即兴没有任何按对象名称、关键词、家族或原型分派的预设内容。若当前想法落在合理开放留白中，你必须依据玩家的具体方法与当前场景，自行定义对象内容并冻结材质、几何、耐久和有限 phase 图，再明确选择机械效果模式：state-only 只改变环境状态、地形、掩护或通行，不得虚构区域豁免、伤害或 Hazard；area-hazard 才继续冻结触发、区域、豁免、伤害和残骸机械。复用既有环境对象时，basisRefs 必须包含 Context Pack 中该对象的精确稳定引用；使用攻击激活时，abilityRef 必须逐字选择本次 finiteReferences 中该角色拥有的能力。不得按玩家措辞、对象标签、能力名称或别名猜测机械引用。不得把示例名称当成类别，也不得提交实际受影响实体集合。

每个工具名对应一张 Form。只调用本次提供的其中一个 Form 工具一次；工具名即 Form 选择，arguments 直接填写该 Form 草稿字段，不要填写 formId，不要包裹 draft，不输出解释。`;

const PRIVATE_FORM_REPAIR_SYSTEM = `你正在修复一个尚未提交的烛帷私有 Form 草稿。只允许一次窄修订。

工具中只有服务器选定的一张 Form Schema。必须保留原草稿的玩家 goal、method、target 语义、已确认选择以及已生成的 NPC 回应；semanticFreezeHash 是服务器绑定，不得改写或解释。只能修复列出的结构、引用或机械组合错误。不得请求或假设完整模组、完整历史、Story Bible、WorldState、骰面、事件、状态补丁、实际目标集合或其他 Form。只调用服务器提供的唯一 Form 工具一次；arguments 直接填写该 Form 草稿字段，不要填写 formId，不要包裹 draft，不输出解释。`;

const SOCIAL_FORM_REPAIR_CONTRACT = `当 selectedForm 是 npc-exchange.v1 时，desiredResponse 必须是合法 JSON 字符串，并精确包含 schema、npcRef、influenceGoal、desiredBehavior、addressedThreadRef、evidenceRefs、assertion 七个键；npcRef 是 basisRefs 中本次交谈对象的稳定 ref，schema 固定为 zhuwei.social-intent-draft/v1，assertion.predicate 必须使用闭合谓词。npcResponse 也必须是合法 JSON 字符串：reaction 精确包含 schema/mode/reaction，sourceBacked 精确包含 schema/mode/sourceRefs（不得写自由 speech，Rules 从引用内容确定性生成），commitment 精确包含 schema/mode/speech/scopeRefs 且 scopeRefs 不得为空；最低响应程度由 Rules 根据响应模式与 NPC 上限确定，不由模型填写。check 的 reaction 还必须符合 influenceGoal：beBelieved/deter 用 acknowledge，deemphasize 用 acknowledge 或 redirect，且不得用 decline、askClarification、silence。当 selectedForm 是 materialization.v1 且 method 为 establishCharacterPremise 或 materializeDynamicNpc 时，必须保留原语义与已有稳定引用，并分别修成 zhuwei.character-premise-draft/v2 或 zhuwei.dynamic-npc-materialization-draft/v2 的闭合 JSON；角色前提只能使用 premiseCatalog 中允许的 policy/slot/archetype，不能恢复自由 statement/role/entityKind；initialKnowledgeFactRefs 必须是 sourceFactRefs 的去重子集。当 method 为 materializeItem 时，resolution 必须为 direct，proposedFact 必须修成只含 schema、definitionRef、quantity 的 zhuwei.item-materialization-draft/v1，definitionRef 精确为 ${HEALING_POTION_ITEM_DEFINITION_ID}，quantity 为正整数；basisRefs 只能保留当前 sceneRef 与至少一个可见因果事实，不能添加 actor、entryId、ability、治疗骰式、目标、所有权或其他机械。当 method 为 materializeNpcMechanicalEncounter 时，proposedFact 必须修成只含 schema、encounterRef、alliedEntityRefs、hostileEntityRefs、entries 的 zhuwei.npc-mechanical-encounter-draft/v1；entries 只能使用 startEncounter 的 templateRef 或完整 bespokeDefinition 合同；完整模板必须明确 intrinsicAbilities、itemDefinitions、itemDefinitionRefs、initialLoadout，不能把装备动作塞回固有能力；itemDefinitions 必须直接使用 zhuwei.item-definition/v1，initialLoadout 的自定义来源 kind 必须为 itemDefinition，不能恢复第二定义 adapter；自定义武器必须在 content.equipment.weapon 保留精确 ammunitionDefinitionRef，近战或无弹药时填 null，非 null 时只能引用 canonical 标准弹药定义。当 method 为 transferItem 时，必须修成只含 schema、toCharacterRef、itemRef、quantity 的 zhuwei.item-transfer-draft/v1，收到不自动装备；当 method 为 changeNpcGear 时，wear 必须只含 schema、npcRef、action、slot、itemRef，stow 必须只含 schema、npcRef、action、slot，schema 均为 zhuwei.npc-gear-change-draft/v1；当 method 为 changeNpcItemState 时，必须只含 schema、npcRef、itemRef、action、causeFactRef，schema 为 zhuwei.npc-item-state-change-draft/v1，action 只能是 break、repair、destroy，causeFactRef 必须引用 NPC、物品、action 精确一致的 zhuwei.npc-mechanical-item-state-cause/v1 可见事实并进入 basisRefs；没有明确 scene 的 lose 不可修复为当前动作。transferItem 与 changeNpcGear 在相关 encounter 尚未 concluded 时都不得提交；gear 和 item-state 草稿不得包含 AC、abilityRefs 或其他派生机械。不得按对象名称、职业或示例关键词另选机械。只修 errors 指出的字段，其他冻结语义保持不变。`;

const NARRATIVE_ITEM_FORM_REPAIR_CONTRACT = `当 selectedForm 是 materialization.v1 且 method 为 materializeNarrativeItem 时，resolution 必须为 direct，proposedFact 只能修成精确包含 schema、action、entryRef、definitionRef、name、description、causalBasisRefs 的 zhuwei.narrative-item-draft/v1；action 只能是 materializeInScene 或 materializeAndAcquire，entryRef 与 definitionRef 分别必须保留新的 item-entry:／item-definition: 稳定引用，causalBasisRefs 必须去重，basisRefs 必须精确为当前 sceneRef 后接同一组 causalBasisRefs。不得添加 actor、owner、visibility、quantity、category、mechanics、equipment、use、ability、charges、durability、事件或状态，也不得按名称或说明猜机械。当 method 为 acquireSceneItem 时，resolution 必须为 direct，proposedFact 只能修成精确包含 schema、itemRef 的 zhuwei.scene-item-acquisition-draft/v1，basisRefs 必须精确为当前 sceneRef 与同一个现有 itemRef；不得添加 actor、holder、quantity、definition、ownership、事件或状态，也不能把已被取得、异地、消耗或毁坏的 entry 修成可取得。只修 errors 指出的字段并保留冻结语义。`;

const ACTOR_PLAN_FORM_REPAIR_CONTRACT = `当 selectedForm 是 materialization.v1 且 method 为 formActorPlan 时，只能修成 zhuwei.actor-plan-draft/v1 的闭合 JSON；npcRef、premiseRefs、resourceRefs 与备选 targetRef 必须来自并保留在 basisRefs，factionRef 或 trigger ref 非 null 时才必须把对应 ref 保留在 basisRefs。个人计划的 factionRef 必须为 null；势力计划只能引用该 NPC 所属的现有势力并把势力冻结资源列入 resourceRefs。due 只能是 {"kind":"activityCompletion"} 或 null，trigger 只能是一个 committedEvent/knowledgeAcquired 引用或 null，两者恰有一个非 null。不得增加 actor、revision、status、chapter、module、骰面、机械结果或事件字段。`;

const CURRENT_WORLD_FORM_REPAIR_CONTRACT = `当 selectedForm 是 observe.v1 且 method 为 observeExistingFact 时，resolution 必须为 direct，focus 与唯一 basisRefs 项必须是同一个现有可见 fact ref，desiredInformation 只能修成 {"schema":"zhuwei.observed-fact-acquisition-draft/v1","factRef":"同一个 fact ref","observedContent":"由该 fact 支持的有界读取结果"}，不能补可见性或取得者。当 method 为 observeItemInformation 时，resolution 必须为 direct，focus 必须是同一个现有 itemRef，basisRefs 必须精确为当前 sceneRef 与 itemRef，desiredInformation 只能修成 zhuwei.item-information-observation-draft/v1 的 schema、itemRef、sourceRef、information 四个字段；information 只能是 sensoryEvidence 的 kind/sense/content，或 sourceClaim 的 kind/semanticContent/sourceBasis/motive/formedAtFictionMicros，未知的后三项保持 null，不能补 actor、holder、Audience、visibility、知识层级、事件或状态，也不能把 consumed、destroyed、异地或他人持有的物件修成可接触。当 selectedForm 是 materialization.v1 时，materializeHiddenReality 只能修成 zhuwei.hidden-reality-candidate-set-draft/v1 的完整候选集，不能补选中项或骰面；materializePassageAndMove 只能修成只含 schema、locationRef、destinationSceneRef、destinationName、passageRef、traversal、geometry 的 zhuwei.dynamic-passage-move-draft/v1；geometry 必须是非空 spawnPoints、非空真实 obstacles 和 polygon boundary 的 zhuwei.tactical-geometry/v1，不能补空障碍或一维占位。必须保留当前 sceneRef 在 basisRefs，不能增加 actor、sourceSceneRef、characterRef、到达时刻或队伍裁决；commitWorldConsequences 只能修成只含 schema、factRef、summary、consequences 的 zhuwei.world-consequence-draft/v1，consequences 只能使用 spendResource/acquireKnowledge/updateRelationship/recordPromise/recordDebt 的各自闭合字段，basisRefs 必须保留 scene、所有同场 counterparty 与真正可见的因果事实，不得补 actor、targetRef、Audience、visibility、event、state、通用 effects 或补丁；registerAbilityDefinition 只能修成只含 schema、definition 的 zhuwei.ability-definition-draft/v1，basisRefs 只能保留 scene 与 definition.causalBasisRefs，不能补 artifact/graph/hash/compilerProfile/MechanicOp、actor、event 或 state；registerFactionDefinition 只能修成 zhuwei.faction-definition-draft/v1 的七个闭合字段，basisRefs 必须保留 scene、全部同场 active NPC memberRefs 和成员知识/actor 可见 causalBasisRefs，不能补 definition、visibility 或权威字段；resolveNoncombatContest 只能修成 zhuwei.noncombat-contest-draft/v1，双方引用与 scene 必须保留在 basisRefs；recordAdjudicationPrecedent 只能修成 zhuwei.adjudication-precedent-draft/v1，record/supersede 的闭合字段、公开/私有依据与 scope ref 必须保留。proposedFact.schema 为 zhuwei.campaign-lifecycle-draft/v1 时，只能在 raiseEndingCandidate、concludeStory、transitionChapter、commitMeaningfulFailure、retryFailedAction 的对应闭合字段内修复；不得增加 actor、Campaign/current Chapter/ordinal、continuityPolicy、状态、事件或骰面。retryFailedAction 的 changeKind=null 必须保持 evidenceRefs=[]，不能把原样重试伪装修成条件变化；非 methodChanged 的变化必须保留至少一个已有 evidence ref。`;
/**
 * Forms whose draft carries `resolution`, read from the catalog so the set
 * cannot drift away from the rule `validateKpFormDraft` actually enforces.
 */
const RESOLUTION_FORM_IDS: ReadonlySet<KpFormId> = new Set(
  KP_FORM_IDS.filter((formId) =>
    Object.hasOwn(
      (buildKpFormToolParameters(formId).properties ?? {}) as Record<string, unknown>,
      "resolution",
    )),
);

/**
 * The rule behind `<field>:direct-forbidden` and `<field>:check-required`.
 *
 * These arrive as bare machine codes, and nothing else in the repair prompt
 * says what they mean or how to satisfy them, so a repair can come back with
 * the identical errors it was asked to fix. Both ways out are spelled out,
 * because deleting the fields and switching to a real check are both correct
 * repairs and only the KP knows which one the fiction calls for.
 */
const RESOLUTION_FORM_REPAIR_CONTRACT = `当 selectedForm 的草稿带有 resolution 字段时，ability、skill、dc、mode、successConsequence、failureConsequence 这六个检定字段与 resolution 严格绑定。resolution 为 "direct" 时，这六个键一个都不得出现（写 null、0、"none" 或空串同样算出现，必须整个删除键），对应错误 <字段>:direct-forbidden；resolution 为 "check" 时，这六个键必须全部出现且有实际内容，对应错误 <字段>:check-required。修复 direct-forbidden 只有两条合法路径：删除全部六个键，或把 resolution 改为 "check" 并补齐全部六个；修复 check-required 同理：补齐全部六个，或把 resolution 改为 "direct" 并删除全部六个。不得只删一部分或只补一部分，也不得保留占位值。`;

const ITEM_INFORMATION_REPAIR_SECRECY_CONTRACT = `修复 observeItemInformation 时，goal 只能描述公开可观察的动作，不得复述 information 中的秘密正文；sourceRef 必须保持 fact:item-information: 命名空间。`;

/**
 * `strict-tool` is a different transport, not a label on the same request:
 * the provider only enforces the schema when the definition carries
 * `strict: true` and the parameters are in its beta dialect. Both halves are
 * emitted together so a profile can never claim strict output while sending
 * an unconstrained tool.
 */
function narrowProposalTool(
  formId: KpFormId,
  structuredOutputMode: KpStructuredOutputMode,
) {
  if (structuredOutputMode !== "strict-tool") {
    return Object.freeze({
      type: "function",
      function: {
        name: kpFormToolName(formId),
        description: `Fill the allowed ${formId} private KP proposal form.`,
        parameters: buildKpFormToolParameters(formId),
      },
    });
  }
  return Object.freeze({
    type: "function",
    function: {
      name: kpFormToolName(formId),
      description: `Fill the allowed ${formId} private KP proposal form.`,
      strict: true,
      parameters: buildKpFormStrictToolParameters(formId),
    },
  });
}

export function privateFormProposalModelInput(input: Readonly<{
  request: KpProposalRequest;
  allowedForms: readonly KpFormId[];
  contextPack: unknown;
  structuredOutputMode?: KpStructuredOutputMode;
}>): Record<string, unknown> {
  const structuredOutputMode = input.structuredOutputMode ?? "tool";
  // The Form is selected by which tool the model calls, so the initial call
  // offers several. DeepSeek's strict beta carries exactly one function per
  // request, and a request that quietly dropped the other Forms would change
  // the selection protocol SPEC 0015 6.1 freezes. Refuse instead.
  if (structuredOutputMode === "strict-tool" && input.allowedForms.length !== 1) {
    throw new Error("KP_STRICT_TOOL_FORM_SELECTION_UNSUPPORTED");
  }
  return {
    messages: [
      {
        role: "system",
        content: SOCIAL_PRIVATE_FORM_SYSTEM,
      },
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
    tools: input.allowedForms.map((formId) =>
      narrowProposalTool(formId, structuredOutputMode)),
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0.2,
    max_completion_tokens: CURRENT_FORM_MAX_COMPLETION_TOKENS,
  };
}

/**
 * The repair carries exactly one Form, so it is sent exactly the contracts
 * that govern that Form.
 *
 * Sending all of them unconditionally made the system message a wall of rules
 * for Forms that are not being repaired, with no rule at all for the ordinary
 * mechanical Forms -- the model had to filter thousands of characters to find
 * guidance that was not there. A repair that returns the same four errors it
 * was handed is the visible cost of that.
 */
function repairSystemContract(selectedForm: KpFormId): string {
  const contracts: string[] = [PRIVATE_FORM_REPAIR_SYSTEM];
  if (selectedForm === "npc-exchange.v1" || selectedForm === "materialization.v1") {
    contracts.push(SOCIAL_FORM_REPAIR_CONTRACT);
  }
  if (selectedForm === "materialization.v1") {
    contracts.push(NARRATIVE_ITEM_FORM_REPAIR_CONTRACT, ACTOR_PLAN_FORM_REPAIR_CONTRACT);
  }
  if (selectedForm === "observe.v1" || selectedForm === "materialization.v1") {
    contracts.push(CURRENT_WORLD_FORM_REPAIR_CONTRACT);
  }
  if (selectedForm === "observe.v1") {
    contracts.push(ITEM_INFORMATION_REPAIR_SECRECY_CONTRACT);
  }
  if (RESOLUTION_FORM_IDS.has(selectedForm)) {
    contracts.push(RESOLUTION_FORM_REPAIR_CONTRACT);
  }
  return contracts.join("\n");
}

export function privateFormRepairModelInput(input: Readonly<{
  rootActionRef: string;
  originalForm: KpFormId;
  selectedForm: KpFormId;
  rejectedDraft: unknown;
  rejectedRawArguments?: unknown;
  errors: readonly string[];
  finiteReferences: FiniteReferenceCatalog;
  semanticFreezeHash: string;
  structuredOutputMode?: KpStructuredOutputMode;
}>): Record<string, unknown> {
  return {
    messages: [
      {
        role: "system",
        content: repairSystemContract(input.selectedForm),
      },
      {
        role: "user",
        content: canonicalJson({
          rootActionRef: input.rootActionRef,
          originalForm: input.originalForm,
          selectedForm: input.selectedForm,
          rejectedDraft: input.rejectedDraft,
          ...(input.rejectedRawArguments === undefined
            ? {}
            : { rejectedRawArguments: input.rejectedRawArguments }),
          errors: [...new Set(input.errors)].sort().slice(0, 40),
          finiteReferences: {
            basisRefs: [...new Set(input.finiteReferences.basisRefs)].sort().slice(0, 192),
            abilityRefs: [...new Set(input.finiteReferences.abilityRefs)].sort().slice(0, 96),
            resourceRefs: [...new Set(input.finiteReferences.resourceRefs)].sort().slice(0, 96),
            itemRefs: [...new Set(input.finiteReferences.itemRefs)].sort().slice(0, 96),
          },
          semanticFreezeHash: input.semanticFreezeHash,
        }),
      },
    ],
    tools: [narrowProposalTool(input.selectedForm, input.structuredOutputMode ?? "tool")],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0,
    max_completion_tokens: CURRENT_FORM_MAX_COMPLETION_TOKENS,
  };
}
