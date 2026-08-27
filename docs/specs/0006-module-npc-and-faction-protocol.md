# SPEC 0006：模组、动态实体、NPC 与势力协议

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0005`
- 取代范围：`SPEC 0002` 第 8、14、17–18 节及 B04–B07、B23–B24、B29–B31、B41、B52 中的模组、动态实体与 NPC/势力条款

## 1. 模组是故事圣经，不是流程图

版本化 `ModuleBible` 至少包含：

- 模组 ID、版本、兼容 `ruleset_version`、内容边界与主题/基调；
- 核心真相、重要历史和不可任意改写的 Story Anchor；
- 已知地点、势力、关键 NPC、初始关系、资源和起始世界事实；
- 开放留白及其因果约束，而非穷举可执行场景；
- 初始冲突、承诺、威胁和潜在收束信号；
- 可选的目录定义与 Legacy Anchor；
- 章节入口和扩展点，不预定唯一场景顺序、路线或结局。

模组不得把 `Interaction`、Portal、NPC Plan、Scheduled Event 或 Ending 的封闭清单当成玩家行动白名单。未登记但合理的行动由 KP 按 SPEC 0001/0004 裁决。

## 2. 模组版本

房间 genesis 固定 `moduleId + moduleVersion + moduleContentHash`。动态事实属于房间事件，不回写静态模组。发布新版模组不会改变旧房间；显式章节升级必须使用获批迁移映射并产生事件，不能只改 D1 版本字段。

同一 Campaign 可以跨章节引用多个兼容模组版本；章节切换协议见 SPEC 0008。故事锚点冲突时，必须在新章节开始前显式选择兼容包、世界内改写或更正，不静默覆盖正史。

## 3. 开放留白与动态实体

KP 可依据现有事实动态提出地点、通路、NPC、敌人、盟友、物品、陷阱、危险、机会、支线和空白结果。提案至少包含：

- 叙事身份、因果依据、与 Story Anchor 的关系；
- 首次可见/机械生效时点和 Visibility Policy；
- 规则需要的完整定义、控制者和初始状态；
- 定义/Profile/编译器版本与引用；
- 若有多候选，未预选候选集和隐藏权重。

Rules Module 验证结构与机械可执行性，不以危险太高、奖励太强、队伍等级或戏剧偏好拒绝。非法项逐条返回 KP 修订；定义固化后持续存在。

## 4. NPC 领域模型

每个重要 NPC 至少保存：

- 稳定实体 ID、动态/预写来源和版本化机械定义；
- 目标、价值/性格约束、顾虑、恐惧和错误倾向；
- 当前地点、资源、伤势、装备、关系、承诺和债务；
- 已获得的感官证据、来源主张、推断与有限知识；
- 可用能力、死亡策略、控制权与当前计划；
- 声口只作为叙述提示，不替代结构化事实。

NPC 不能读取 KP 的全知投影。`project({kind: "npc", npcId})` 只提供该 NPC 知道、感知或合理记得的事实。相同模型处理多个 NPC 时也必须分别请求投影；不能共享隐形群体大脑。

## 5. 势力领域模型

`Faction` 至少包含目标、成员/代理、资源、控制区域、知识、关系、公开立场、秘密议程和计划。势力知识不是成员自动共享；必须由通信或组织能力传播。势力行动通过有权 NPC/代理或明确世界机制执行。

势力可以误判、内部不一致、资源不足或选择不行动。KP 不得因为知道玩家计划而让无信息势力提前反制。

## 6. NPC/势力计划

`ActorPlan` 是具有前提、下一步、资源、Activity、到期/触发、可察觉痕迹和备选目标的权威计划。它不是必然剧情脚本；世界事实变化后，KP 可依据该主体有限知识提出修订。

计划推进条件只来自虚构时间、已提交事件、已取得知识或明确触发；现实等待、模型延迟、掉线和 UX TTL 不推进。到期计划必须在处理受影响玩家意图前经同一 Room Action 事务提交，再重新投影。

计划执行可成功、失败、中断、取消或形成新问题；所有机械行动与玩家行动一样经 `step`。NPC 回合不能由协调器自动使用第一攻击、最近目标、最低 HP、固定仇恨或默认 `pass`。

## 7. NPC 决策协议

1. Room Action Module 向 Room Authority 请求指定 NPC Viewer。
2. KP 仅依据该投影、NPC 目标/性格/错误形成意图和提案。
3. 机械定义/目标/成本冻结后由 `step` 验证与结算。
4. 模型失败时保持最近稳定等待点；不自动行动或推进时间。
5. 提交后分别按每位观察者 `project`，再生成隔离叙述。

KP 可以选择攻击、保留反应、帮助、撤退、投降、谈判、误判、浪费机会或改变计划，只要与 NPC 知识和事实相容。Rules Module 只判断机械合法性，不优化战术。

## 8. 动态敌人与危险定义

动态生物至少包含：属性、AC、HP、速度/移动方式、感官、豁免、技能、攻击、伤害、法术、资源、免疫/抗性、动作/附赠/反应、特殊能力、体型/位置、控制者、死亡策略和初始有限知识。

动态危险至少包含触发、迹象、调查/解除、攻击或豁免、范围、伤害/状态、持续和环境后果。自创效果必须编译为版本化受限机械原语；不接受任意脚本、字段路径或状态补丁。

高数值不是非法理由。定义一旦产生证据或机械作用即成为 Canonical Fact，不能按角色 HP、骰面或剧情需要替换。

## 9. Legacy Adapter

现有封闭 DSL、预写 Interaction、旧 NPC Plan 和 D1 `game_states` 只用于：

- 旧 `ruleset_version` 房间的确定性回放/继续；
- 新房间 genesis 的 Story Anchor、初始事实或目录输入；
- 迁移审计和兼容性测试。

Legacy Adapter 必须位于明确版本分派后，不得在新规则中拒绝未登记行动、成为第二活跃状态、直接投影秘密或绕过 KP 标准循环。旧房间不会用新编译器重算；若无确定迁移映射则继续旧版本直至结束。

## 10. 故事推动与收束接缝

当玩家停滞时，KP 先重新定向，再依据 NPC/势力计划提供机会或代价，最后才在事实到期时兑现威胁。计划不能替玩家解决问题、传送回主线或制造无因果惩罚。

NPC 投降/撤退、势力目标达成/失败和冲突停止可以产生 `EndingCandidate`，但真正故事收束由 SPEC 0009 的 KP 协调，不由模组唯一谓词或战斗存活阵营自动决定。

## 11. 主要事件

- `ModuleBound` / `ModuleVersionMigrated`
- `DefinitionRegistered`
- `DynamicEntityMaterialized` / `DynamicLocationMaterialized`
- `NpcKnowledgeAcquired` / `NpcInferenceFormed`
- `NpcPlanFormed` / `NpcPlanRevised` / `NpcPlanCancelled`
- `FactionPlanFormed` / `FactionPlanAdvanced`
- `NpcActionCommitted` / `FactionActionCommitted`
- `HostilityChanged` / `NpcSurrendered` / `NpcEscaped`

## 12. 验收场景

1. 玩家走模组未登记路线，KP 在锚点内动态创建通路/场景并经同一事务固化。
2. 门后合法为空；系统不强制生成战斗、线索或奖励。
3. 动态强敌数值远超队伍但结构合法时被接受；非法能力逐项退回修订。
4. NPC 不知道玩家秘密计划时不作针对性反制；世界内获知后才可反应。
5. NPC 模型失败或玩家断线不会自动攻击、pass、结束回合或推进时间。
6. 到期势力计划先提交并改变情境；原玩家意图需要时重新澄清。
7. 旧 DSL 房间仍由 Legacy Adapter 回放；新房间接受未登记合理行动且不写 D1 活跃状态。
8. NPC 投降后玩家仍决定是否停止追击，系统不替玩家接受。

## 13. 实现映射

- 模组 schema/Adapter：`app/_runtime/lib/module/`
- 动态定义与编译：`app/_runtime/lib/rules/v2/model.ts`、`app/_runtime/lib/rules/v2/actions.ts`、`app/_runtime/lib/rules/v2/events.ts`
- NPC/势力 Implementation：`app/_runtime/lib/rules/v2/multiplayer-model.ts`、`app/_runtime/lib/rules/v2/multiplayer-actions.ts`、`app/_runtime/lib/rules/v2/multiplayer-events.ts`
- KP Adapter：`app/_runtime/lib/rules/ai-adapter.ts`
- Room Action：`app/_runtime/lib/room/action.ts`
- 验收：`tests/module-npc-v2.test.mjs`、`tests/kp-multiturn-eval.test.ts`

## 14. 交叉审查

- SPEC 0001：故事圣经、开放留白、动态创造、NPC 有限知识和非主线推动完整保留。
- 权限：玩家只控制玩家角色；KP 只为 NPC/世界提案，机械仍由 Rules Module。
- 秘密：KP/NPC Viewer 分离，计划、真相和未公开定义不进入客户端或日志。
- 版本：模组、动态定义、编译器与 Legacy Adapter 显式固定。
- 第二权威：DSL、Prompt、D1 flags、自动战术函数和目录不能成为独立裁决或状态路径。
