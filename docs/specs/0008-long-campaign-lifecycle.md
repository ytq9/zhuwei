# SPEC 0008：长团成长、章节连续性与继任角色

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0005`、`SPEC 0007`
- 适用规则：D&D 5e 2014 / SRD 5.1

## 1. 产品范围

烛帷的房间可以承载多章节、无预设现实总时长的长团。一个故事收束不自动删除房间；玩家可以选择尾声、续篇、新章节或结束 Campaign。完整 TableContract/创作界面后置，但运行时模型不得锁死为单模组短团。

## 2. Campaign 与 Chapter

`Campaign` 是房间长期正史、参与者与版本链；`Chapter` 是具有起止因果边界、模组绑定、场景问题和结局状态的一段冒险。

Campaign genesis 固定：

- Campaign ID、初始规则/Profile/事件版本；
- 初始模组/世界锚点版本；
- 成长策略 `AdvancementProfile`；
- 内容边界与运行期默认政策版本；
- 初始角色任期和世界事实。

章节至少保存：ID、序号、模组版本、开始事件、场景/冲突、活动分支、收束候选、结束原因、尾声与下一章引用。章节可成功、失败、放弃或在角色更替后继续；这些状态不等于抹除后果。

## 3. 章节切换

章节切换是一笔权威事务：

1. KP 依据已固化事实提出当前章结论、长期后果和下一章锚点；
2. Rules Module 验证没有必须先回答的私人窗口或未结算机械；长期 Activity 可明确继续、概括、中断或完成；
3. 玩家决定是否进入尾声、续篇/下一章或结束 Campaign；
4. Room DO 原子提交 `ChapterConcluded`、连续性清单和 `ChapterStarted`（若继续）；
5. 每个 Viewer 只获得有权知道的尾声与下一章开场。

不能为赶切章自动补满资源、治愈伤势、传送角色、公开秘密或清除债务。若世界内经过 downtime，必须以冻结时长和 Activity/事件明确结算。

## 4. 跨章节连续性清单

以下事实默认持续，除非有明确世界事件改变：

- 当前/最大 HP、伤势、疾病、诅咒、死亡/稳定、长期状态；
- 法术位、生命骰、职业次数、弹药、充能和其他资源；
- 唯一物件、普通资源、装备、位置、所有权与损毁；
- 角色知识、证据、来源主张和推断；
- NPC/势力关系、声誉、债务、承诺、仇恨、帮助和背叛；
- 未完成 Activity、到期计划、未决威胁、期限与因果前沿；
- 裁定先例、动态定义、已毁环境与逃走敌人的伤势/资源；
- 活动分支、更正与审计历史。

章节开始 Read Model 可以概括这些内容，但不能把完整秘密或旧 KP 旁白作为回顾聊天记录提供。

## 5. 成长策略

Campaign genesis 必须选择版本化 `AdvancementProfile`；首个新规则版本支持：

- `srdXp2014`：权威事件授予 XP，阈值按 2014 Profile；
- `milestone`：KP 依据已经解决/失败/完成的重大目标提出里程碑，Rules Module 验证来源事件与 Profile 约束。

策略在 Campaign 中不可静默切换；切换需要显式迁移决定与事件。成长不是 KP 随意改人物卡，也不因现实游玩时长自动发生。

达到成长资格只产生 `AdvancementAvailable`，不会自动替玩家选择职业等级、子职、HP、法术、专长或属性。玩家控制所有可选成长；需要随机 HP 时由 DO 骰源产生，固定值与骰值按 2014 Profile 执行。

`CharacterAdvanced` 必须原子提交新等级、选择、资源上限、获得能力及定义版本。静态 D1 人物卡可以异步更新为可重建/目录副本，但 Room DO 是活跃权威；D1 失败不回滚成长。

产品首个版本支持既有职业/子职目录中可表达的等级；缺少定义时返回具体 `needsKp`/不可执行选择，不伪造能力。不能混入 2024/5.5e 成长语义。

## 6. 角色任期

`CharacterTenure` 绑定角色、控制 Seat、加入/离开章节、状态与原因：

- `active`
- `dead`
- `retired`
- `missing`
- `npcTransitioned`
- `supersededByCorrection`

死亡按机械事件确定；退役由控制玩家明确选择并经世界事实提交，KP/房主不能替玩家退休。角色可以在尾声后转为 NPC，但需要玩家同意并明确新的 KP 控制权；其知识和人格不会因此自动公开。

死亡或退役角色仍是世界实体/历史人物，保留遗体/位置、物件、知识、关系、债务、承诺、伤势和影响，不从事件流删除。

## 7. 继任角色

玩家可在其原角色死亡、退役、长期失踪或 Campaign 明确允许增加角色时创建新的 `CharacterTenure`。继任角色是新世界实体，不是旧角色状态重命名。

默认不自动继承：

- 私人知识、未分享线索、角色推断；
- 物件、金币、装备、法术、资源和 attunement；
- 关系、声誉、债务、承诺、职位和势力权限；
- 旧角色的思想、动机、秘密或控制中的 NPC；
- 未完成的个人 Activity 和反应窗口。

合法继承只能来自已提交世界内链路：遗嘱、明确赠与、遗体/藏宝地点的实际取得、公开档案、共同组织授予、NPC 介绍、已传播知识或可感知的公共声誉。每项为新角色产生独立 `ArtifactTransferred`、`KnowledgeAcquired`、`RelationshipEstablished`、`DebtAssumed` 或 `PromiseAssumed` 事件，并保留来源。

玩家层面的内容安全偏好、账户身份和桌内参与权不是角色知识，可以随 Seat 持续；它们不得被投影成继任角色“知道旧角色秘密”。

## 8. 死亡、退役后的未决事项

- 属于死亡/退役角色个人选择的 Pending Input 被关闭或暂停，不自动由继任者回答。
- 已承诺且世界已开始的 Activity 按其规则中断或由世界主体继续；效果不能凭空完成。
- 债权人、盟友和敌人对新角色的态度必须有世界内传播或关系依据，不自动复制。
- 旧角色的未决威胁继续影响世界；是否指向继任者取决于事实，不因同一玩家而自动转移。
- 更正使死亡失效时走因果分支；旧继任角色已经造成的后继选择属于更正闭包，不能简单删除。

## 9. Campaign 归档与恢复

Campaign 可从 genesis 与完整连续事件重建所有章节、任期、成长和连续性。D1 目录保存当前摘要与静态人物卡，`room_event_archive` 保存可重建副本；二者不参与活跃裁决。

归档/关闭 Campaign 前必须记录结束状态和恢复 Profile。恢复旧 Campaign 使用其固定解释器/Profile；部署新版不升级旧历史。

## 10. 主要事件

- `CampaignStarted` / `CampaignConcluded`
- `ChapterStarted` / `ChapterConcluded`
- `DowntimeStarted` / `DowntimeResolved`
- `ExperienceAwarded` / `MilestoneGranted`
- `AdvancementAvailable` / `AdvancementChoiceRecorded` / `CharacterAdvanced`
- `CharacterTenureStarted` / `CharacterDied` / `CharacterRetired`
- `CharacterBecameNpc`
- `SuccessorIntroduced`
- `InheritanceTransferred` / `InheritanceRejected`

## 11. 验收场景

1. 一个角色获得资格后由玩家选择成长，跨 Worker 重启只增长一次；D1 写失败不回滚 DO。
2. 章节切换保留物品、伤势、知识、关系、债务、承诺和未决威胁；合法 downtime 只结算已冻结效果。
3. 角色死亡后遗体/物件留在世界，玩家建立继任者；继任者默认不知道私人线索、没有旧装备和关系。
4. 继任者通过遗嘱、实际取得和 NPC 介绍合法获得部分物件/知识/关系，每项有独立来源事件。
5. 角色自愿退役并在玩家同意后转 NPC；后续行动由 KP 依据其有限知识控制。
6. 错误死亡导致继任者行动后被更正，系统打开因果分支而非删除旧事件。
7. 多章 Campaign 收束后玩家可选择尾声或明确新冒险；系统不暗加幕后黑手撤销胜利。

## 12. 实现映射

- Campaign/Chapter/任期模型：`app/_runtime/lib/rules/v2/campaign-actions.ts`、`campaign-events.ts`、`character-lifecycle.ts`
- 成长/Profile：`app/_runtime/lib/rules/v2/character-progression.ts` 与 `app/_runtime/lib/rules/profiles/`
- 生产生命周期 ActionPlan：`app/_runtime/lib/rules/v2/compound-model.ts`、`compound-actions.ts`
- Room Action：`app/_runtime/lib/room/action.ts`
- 静态卡同步：`app/_runtime/lib/table/server.ts`
- 验收：`tests/world-campaign-v2.test.mjs`、`tests/rules-compound-action-v2.test.mjs`、`tests/multiplayer-room-v2.test.ts`、`tests/observer-projection-v2.test.mjs`

### 12.1 当前实现证据（2026-08-26）

- `tests/world-campaign-v2.test.mjs` 9/9：成长待决、章节切换连续性、死亡/退役、转 NPC、继任与 provenance 继承均可回放；同一文件验证 `raiseEndingCandidate → concludeStory → recordEpilogueChoice → startSequel` 使用真实旧后果和新的 Story/Chapter 边界。`srdXp2014` 从累计 XP 事件跨越多级阈值后逐级打开玩家选择，里程碑与 XP 档案互斥，错误 XP 奖励的更正同时恢复累计值并关闭对应待决输入。
- `tests/rules-compound-action-v2.test.mjs` 19/19：`advanceCampaignLifecycle` 已注册为生产 typed ActionPlan；`awardExperience` 使用 1–1,000,000 的正整数边界，经 `ExperienceAwarded → AdvancementAvailable` 进入同一 Rules 事务并投影累计 XP；默认 genesis 固定 `milestone`，显式 genesis 可固定 `srdXp2014`。结局候选、故事收束、玩家尾声及各自 Root Action 仍保持原有证据。
- `tests/multiplayer-room-v2.test.ts` 8/8 与 `tests/observer-projection-v2.test.mjs` 5/5：成长/退休/继任从可信控制权进入 Room Authority；继任者不继承前任私人知识或旧投递。
- SRD 2014 累计阈值由 `character-progression.ts` 固定为 1–20 级表；大额奖励不自动升级，`CharacterAdvanced` 后若累计值仍达到下一阈值，会以新 `AdvancementAvailable` 继续等待该玩家，直到资格耗尽或到达 20 级。

## 13. 交叉审查

- SPEC 0001：连续性、长期回响、死亡、公平和真实收束完整保留。
- 权限：成长/退役/继任选择归玩家；NPC 转换需同意；房主不能代选。
- 秘密：继任按世界内传播取得知识，不按账户继承；章节回顾经 Viewer。
- 版本：Campaign、章节、成长和定义 Profile 固定；旧章不重算。
- 第二权威：D1 人物卡、章节 UI、消息回顾和模组版本字段不成为活跃状态。
