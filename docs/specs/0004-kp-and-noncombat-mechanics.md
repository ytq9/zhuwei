# SPEC 0004：KP 裁决与非战斗机械

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`
- 适用规则：D&D 5e 2014 / SRD 5.1
- 取代范围：`SPEC 0002` B01–B05、B28、B38、B42–B43 中的通用可行性、检定、Activity 与危险条款

## 1. 范围

本规格定义 KP 如何把自由意图裁定为可执行提案，以及 Rules Module 如何确定性结算非战斗检定、对抗、豁免、物品、资源、休整、Activity 和危险。战斗不是另一条路径，只是在同一行动事务中启用战斗 Profile。

## 2. 五类可行性裁决

KP 必须先理解目标与做法，再且仅能选择：

1. `directSuccess`：合理且没有有意义不确定性或失败后果；
2. `checkRequired`：成败均有意义且存在真实不确定性；
3. `highRiskFeasible`：勉强可行，需要更高 DC、工具、时间、资源、阶段或兑现既有严重风险；
4. `missingPrerequisite`：当前方式不成立，取得明确工具、情报、位置、权限或条件后可行；
5. `worldLawViolation`：当前做法违反已经成立的世界规律，直接拒绝，不用虚高 DC 假装可能。

提案必须记录公开事实依据、只给 KP 的秘密依据引用、做法、预期耗时和结果范围。缺少前提或不可能的尝试若已经真实消耗时间、暴露位置或产生其他后果，后果仍经 `step` 提交；机械拒绝本身不是角色失败。

重大危险、显著资源、友军伤害或不可逆结果存在多义时，先产生玩家专属 `clarification`。风险已清楚且意图明确后不得反复劝阻。

## 3. 检定提案与骰前冻结

`CheckProposal` 至少冻结：

- 行动目标、做法、行动者与受影响主体；
- 检定种类：能力、技能、工具、对抗或豁免；
- 使用的能力、熟练/专精、优势/劣势来源；
- DC 或对手公式及其公开/秘密依据；
- 时间、物品/资源成本、位置与协助条件；
- 成功、失败、部分信息、延迟和危险的有限候选范围；
- 失败后什么事实必须改变，何种实质变化才允许重试；
- 公开风险提示与秘密等级。

Rules Module 验证规则引用、数值类型、权限、资源、范围和优势/劣势是否合法；不评价 KP 希望故事走哪条路。冻结后任何目标、DC、成本、优势/劣势、候选结果或风险变化都需要废弃未掷骰提案并重新裁决；骰面出现后不得修改。

DC 只反映行动和当前情境。准备可以真实降低 DC、给予优势、改变能力/技能、减少失败后果、缩短耗时或令行动直接成功。不得按角色剩余 HP、等级、期望成功率或剧情需要秘密缩放。

## 4. 能力、技能、工具、对抗与豁免

- 普通能力/技能/工具检定按 D&D 5e 2014 计算，能力由做法决定，技能/工具熟练只在适用时加入。
- 同一来源的熟练不重复叠加；专精按 Profile 计算。
- 优势和劣势各存在至少一个来源时互相抵消；同类来源不叠加额外 d20。
- 对抗检定双方各有权威随机请求；平手维持现状，除非具体 2014 规则另有明文。
- 豁免由已经存在的效果或危险要求，不能以“玩家想尝试”为由替代能力检定；自然 1/20 不自动决定普通检定或豁免。
- 非战斗豁免与检定共用同一个版本化复合结算计划：骰前冻结能力、DC、优势/劣势、耗时、物品/资源成本与成功/失败 typed effects，骰后只应用命中的分支。豁免修正来自角色职业在当前 2014 Profile 中登记的 saving-throw proficiencies，不读取技能熟练，也不由 KP/客户端提交最终 modifier。
- 首个 authoritative Profile 对当前产品支持职业固定为：fighter/barbarian `str+con`、rogue `dex+int`、wizard `int+wis`、cleric `wis+cha`、ranger `str+dex`。新增职业或变更映射必须发布新 Profile/ruleset；届时是否保留当前解释器由仍在使用的数据合同和新的明确裁定决定，不能静默重算任何受支持房间的事件。
- 被动值用于持续、明显或无需主动掷骰的察觉/知识情境；已有明显证据直接提供，不为拖延而要求检定。
- 协助必须有具体做法、能力与位置依据；不满足者不能只喊“帮助”获得优势。

## 5. 信息检定

信息检定不能决定世界真相是否存在。隐藏事实先按 SPEC 0005 固化；检定决定角色能否察觉、理解得多深、用时多久或是否避免代价。

基础观察不因一次失败全部消失。核心结论不能只依赖唯一线索或一次骰点；不同来源的冗余证据进入各自知识事件。错误推断必须标为角色推断，不能覆盖 Canonical Fact。

## 6. 物品与资源

- 每个权威物品条目具有稳定 ID；不可堆叠物品每件使用独立条目，只有定义明确允许且状态同质的物品才能按数量堆叠。条目保存定义版本、位置/持有者、数量/耐久、所有权主张和可见性。
- 取得、使用、消耗、装备、交易、掉落、抢夺、毁坏和修复都通过 `step` 产生事件。
- 普通堆叠资源具有稳定资源种类和数量；扣除与效果同一原子提交，失败重试不重复扣除。
- 作为检定/豁免冻结成本的物品或资源在权威随机请求事务中只扣一次；随机 continuation 只提交骰面和对应后果，不重复发出消费事件。HP、位置、知识与状态后果继续复用同一 Rules 事件/状态管线。
- KP 可动态提出普通或魔法物品；机械定义先验证并固化。过强不是机械非法，系统不得自动降级、回收或按等级替换。
- 物品毁坏不撤销角色已经获得的知识；知识分享也不移动物品。
- 页面只展示 Room DO 的权威物品投影；D1 人物卡和 0.4 以前的旧库存不作为当前输入，不保留物品 Adapter、fallback 或第二持有权威。

## 7. 休整

休整是每个角色自己的可中断 Activity，不是现实计时器或全房间布尔锁。

- 短休至少连续一小时虚构时间；玩家决定是否花费及花费哪些生命骰和其他可选资源。
- 长休至少连续八小时，服从 D&D 5e 2014 的中断、恢复和每 24 小时限制。
- 个人合法休整不需要队长审批；加入整队休整是每人自愿响应，未响应者不被自动休整。
- 角色可以原子离队开始个人休整；这不替其他角色推进时间或选择行动。
- 中断事件只提交已经经过的时间和已经发生的成本；完成效果只在满足条件后提交。
- 掉线、现实超时或模型失败不完成休整、不推进虚构时间。

## 8. Activity

所有耗时行为使用统一 `Activity`：

```ts
type Activity = {
  id: string;
  actorId: string;
  kind: string;
  branchId: string;
  sceneId: string;
  startedAtFictionSeconds: number;
  earliestCompletionAt: number;
  requirements: FactRef[];
  reservedCosts: ResourceReservation[];
  completionProposal: FrozenOutcome;
  interruptionPolicy: string;
  status: "active" | "interrupted" | "completed" | "superseded";
};
```

长施法、旅行、制造、搜索、研究、治疗、休整、NPC/势力行动及章节间 downtime 复用此模型。开始事件可以保留资源或承诺，但未到完成点的最终效果不落地。中断原因、已用时间、可退还/不可退还成本和未发生效果必须可回放。

## 9. 非战斗危险

动态危险在首次证据、引用或机械影响前固化，至少包含：

- 因果来源与位置；
- 触发条件、可感知迹象、调查/解除方式；
- 攻击或豁免、DC、范围、伤害/状态/资源/环境后果；
- 持续、重复触发、失效和可见性；
- 定义/Profile/编译器版本与哈希。

致命危险必须走权威随机、伤害和死亡机械，不能直接叙述死亡。危险可远超当前角色承受能力，但不得根据剩余 HP 临时出现、消失或改数值。低风险失败不能凭空升级为致命后果。

## 10. 有意义失败与重试门

合法检定失败必须提交相称状态变化：路线关闭、时间、资源、暴露、伤害、关系、敌方进展、信息不完整或新的困难。不得回到完全相同状态并要求原样重掷。

只有 `methodChanged | factsChanged | costAccepted | positionChanged | materialAssistance | situationAdvanced` 至少一项有权威事件证明时，才能为同一目标建立新检定。KP 可选择不再可达、换路线或承担新代价，不保证原目标最终成功。

## 11. 裁定先例

重要即兴裁定产生 `AdjudicationPrecedentRecorded`，保存规范情境指纹、公开规则依据、秘密依据引用、能力/技能/DC/时间/结果范围、适用范围和版本。KP Viewer 会得到相关先例；玩家只能看到不泄密的公开说明。

先例用于一致性，不是不可修改的全局桌规。事实、做法或版本实质变化时可产生 `AdjudicationPrecedentSuperseded`，必须说明差异；不能在骰后为单次结果改先例。

## 12. 主要权威事件

- `FeasibilityRuled`
- `ClarificationRequested` / `ClarificationAnswered`
- `CheckFrozen` / `ContestFrozen` / `SaveFrozen`
- `RandomnessRequested` / `DiceRolled`
- `CheckResolved`
- `ItemDefinitionRegistered` / `ItemMaterialized` / `ItemAcquired` / `ItemTransferred` / `ItemUsed`
- `NpcMechanicalItemStateChanged`
- `ResourceReserved` / `ResourceSpent` / `ResourceReleased`
- `ActivityStarted` / `ActivityInterrupted` / `ActivityCompleted`
- `RestStarted` / `RestInterrupted` / `RestCompleted`
- `HazardDefined` / `HazardTriggered` / `HazardDisabled`
- `AdjudicationPrecedentRecorded` / `AdjudicationPrecedentSuperseded`

事件名称可在实现中调整，但语义和单一路径不得改变。

## 13. 验收场景

1. 普通未锁门直接成功，不请求骰子；必要位置变化经 `step` 提交。
2. 徒手破坏已知不可破坏结构返回违反规律，并提示可寻找工具/弱点，不制造 DC。
3. 同一目标在失败后原样重试被拒；换工具、接受时间或改变位置后产生有依据的新裁定。
4. 聪明准备真实降低 DC/给优势/直接成功，不能只改叙述。
5. 对抗、豁免和信息检定均使用权威骰面；自然 20 不把不可能行动变可能。
6. 两个并发取得同一不可堆叠物品的行动只有一个提交；另一方得到基于新投影的诚实结果。
7. 个人短休、整队休整、长休中断和 Worker 重启均保持正确 Activity 与资源。
8. 动态致命危险先固化迹象与机械，再结算可能死亡；不会按 HP 调整。

## 14. 实现映射

- 提案与事件模型：`app/_runtime/lib/kp/causal-action-program.ts`、`app/_runtime/lib/rules/v2/model.ts`、`compound-model.ts`、`campaign-events.ts`
- 规则 Interface：`app/_runtime/lib/rules/index.ts`
- 非战斗/失败 Implementation：`app/_runtime/lib/rules/v2/causal-actions.ts`、`campaign-actions.ts`、`compound-actions.ts`、`damage.ts`
- 物品权威：`app/_runtime/lib/rules/v2/items.ts`、`item-transitions.ts`、`campaign-events.ts`
- Activity/休整：`app/_runtime/lib/rules/v2/campaign-actions.ts`、`campaign-events.ts`、`character-rest.ts`
- Room Action 编排：`app/_runtime/lib/room/action.ts`
- 休整选择与 UI Adapter：`app/_runtime/lib/table/authoritative.ts`、`table/client.ts`、`table/server.ts`、`app/_runtime/components/play-table.tsx`
- 验收：`tests/causal-action-rules-v3.test.mjs`、`tests/world-campaign-v2.test.mjs`、`tests/item-use-costs-v5.test.mjs`、`tests/item-materialization-causal-v5.test.mjs`、`tests/rules-multiplayer-v2.test.mjs`、`tests/multiplayer-room-v2.test.ts`、`tests/authoritative-table-v2.test.mjs`、`tests/authoritative-action.test.mjs`

### 14.1 当前实现证据（2026-08-31）

- `tests/causal-action-rules-v3.test.mjs` 覆盖当前 `CausalActionProgram` 的直接/检定阶段、骰前冻结成本、成功/失败分支、同 Root continuation、语义 hash 篡改拒绝与 replay；它不注册或恢复旧 ActionPlan transport。
- `tests/world-campaign-v2.test.mjs` 覆盖五类可行性、非战斗豁免、资源、可中断 Activity、统一伤害/死亡、有意义失败与 2014 短/长休，均从公开 `step/replay/project` 建立状态；休整完成前不落地恢复。
- `tests/item-use-costs-v5.test.mjs` 与 `tests/item-materialization-causal-v5.test.mjs` 覆盖 canonical 物品定义/条目、显式堆叠、使用成本、物品固化与转移的权威主链及转换不变量。
- `tests/rules-multiplayer-v2.test.mjs` 与 `tests/multiplayer-room-v2.test.ts` 覆盖个人休整原子离队、整队休整逐控制者自愿同意、现实掉线不代答，以及 Room DO 拥有短休随机和恢复完成点。
- `tests/authoritative-table-v2.test.mjs` 覆盖 authoritative-v2 以 `arcaneRecoverySlotLevels` 冻结玩家选择。UI 按 `ceil(level / 2)`、每日资源与 1–5 环当前/最大缺口展示可重复的多槽选择；页面不结算。Rules/Room 测试证明非空选择只用于短休，且完成 Activity 后才恢复。精确通过数以同一冻结源码的 `refactor-log.md` 为准。

## 15. 交叉审查

- SPEC 0001：五类裁决、准备收益、不怜悯、公平和有意义失败全部保留。
- 权限：只有控制者回答澄清、资源与休整选择；NPC 选择由有限知识 KP 提案。
- 秘密：DC 可按桌规隐藏；秘密依据和危险定义只通过 Viewer 公开可感知部分。
- 版本：检定、休整、危险和先例绑定规则/Profile 版本；旧事件不按新公式重算。
- 第二权威：库存页面、旧 D1、AI、骰子 UI 和 Activity 调度器均不能独立写效果。
