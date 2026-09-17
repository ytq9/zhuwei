---
kind: part
part_of: "0012"
title: "SPEC 0012 分册：能力、伤害、死亡与结束"
clauses: "8-19"
---
# SPEC 0012 分册：能力、伤害、死亡与结束

本文件是 [SPEC 0012](./0012-authoritative-combat-mechanics.md) 的 §8–§19，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 8. 预备、护盾术与反制法术

### 8.1 Ready

Ready 必须冻结一个可感知触发，以及一个动作或“移动至多自身速度”。触发完成后，控制者可以使用反应执行或明确放弃；未在自身下一回合开始前使用则失效。

只有施法时间为一个动作的法术可以预备。预备时法术已经施放并消耗法术位，以专注持有；触发后用反应释放。专注中断、未触发或选择放弃不会返还法术位。

### 8.2 Shield

Shield 窗口只在以下时点打开：

- 一次攻击已经判定命中该角色、伤害尚未请求或结算；
- 该角色成为 magic missile 的目标，法术效果尚未结算。

使用后获得定义中的 AC 加值，适用于触发攻击并持续到使用者下一回合开始；触发攻击按新有效 AC 重新确定是否命中。持续期内免疫 magic missile。窗口外不能追补使用，且只有有权控制者看到私人选项。

### 8.3 Counterspell

只有反应者看见 60 尺内生物正在施法，且目标法术尚未生效时才打开 Counterspell 窗口。只听见、看不见、超距或法术已生效均不打开。

目标法术等级不高于所用 counterspell 法术位等级时自动反制；否则进行使用者施法属性检定，DC 为 `10 + 目标法术等级`。它不是体质豁免。被反制法术已经承诺的动作、反应、法术位或其他成本不自动返还。

Counterspell 可以被另一个合法 Counterspell 反制；嵌套结算暂停并恢复原法术继续点，不能覆盖已提交资源或提前应用原效果。

## 9. Ability Definition 与施法生命周期

### 9.1 统一能力模型

武器、法术、职业特性、怪物动作、物件能力和环境危险都引用 `SPEC 0006` 已注册的版本化 AbilityDefinition，并通过同一个 `step` 结算。定义至少能够表达：

- 使用者、使用时点和 action/bonus action/reaction/movement 成本；
- 次数、充能、法术位、材料和其他资源；
- 目标、范围、区域、视线、清晰路径和封闭选择；
- 攻击、检定、豁免、派生值和优势/劣势；
- 伤害、治疗、临时 HP、移动、资源和效果；
- 持续、专注、重复豁免、触发和终止条件。

调用者只选择有权选择的目标、路径、区域原点/方向及定义允许的封闭选项。私有 MechanicOp、效果编译和 fold 仍是 Rules Module Implementation，不能从包入口导出，也不接受任意脚本、字段路径或状态补丁。

### 9.2 施法验证

施法必须验证：

- 已知/准备状态、法术来源和正确 Spellcasting Profile；
- 施法时间、动作授予和本回合施法账本；
- 法术位、次数、有价/消耗材料和成分；
- 当前状态是否允许言语、姿势和材料成分；
- 目标、射程、视线、清晰路径、区域和 Geometry Profile；
- 法术攻击、豁免 DC、持续和专注。

普通一动作、附赠动作或反应法术在合法开始施放时承诺动作和法术位；之后被 Counterspell 取消效果不返还。

### 9.3 2014 附赠动作法术限制

本回合一旦施放附赠动作法术，其他法术只能是施法时间为一个动作的戏法；先施放不符合该条件的法术也会阻止随后施放附赠动作法术。额外动作不能绕过该限制。

没有施放附赠动作法术时，2014 不存在“每回合只能消耗一个法术位”的通则；Action Surge 可以允许同回合施放两个施法时间为一个动作的非戏法法术，只要其他条件合法。

### 9.4 长施法、仪式和区域法术

施法时间长于一个动作的法术复用 `SPEC 0004` Activity：每回合投入动作并维持专注，完成时才消耗适用法术位；完成前中断使法术失败但不消耗该法术位。合法 ritual 在通常施法时间上增加十分钟，完成时不消耗法术位。

区域法术的受影响实体由 Geometry Profile 计算。同一个法术同时对多个目标造成伤害时，共享一次伤害骰；每个目标独立豁免并分别应用防御。能力明文要求独立攻击或独立伤害时才分别请求骰面。普通豁免的自然 20 不自动成功。

## 10. Effect、有效值与专注

### 10.1 EffectInstance

每个持续效果必须保存来源能力、来源实体、目标/区域、Profile/定义版本、开始时点、相位/时间到期、专注者、叠加规则、可见性和机械标签。

效果不能只存在于旁白字符串。AC、速度、感官、优势/劣势、攻击、豁免、免疫、抗性、易伤和资源的投影与机械必须读取同一有效值派生来源；不存在“页面 AC”和“命中 AC”两份真相。

### 10.2 专注

一个实体同一时刻只能专注一个效果，并可随时、无需动作主动结束专注。开始施放新的专注法术时，旧专注立即结束；新法术随后被反制也不会恢复旧效果。

每个独立伤害来源分别触发一次专注体质豁免，DC 为 `max(10, floor(damageTaken / 2))`。`damageTaken` 是免疫、抗性、易伤和其他减免后、分配给临时 HP 或 HP 前的该来源伤害；完全降为 0 时不触发。临时 HP 吸收伤害不取消已经发生的专注豁免。

失能或死亡结束专注。浪涛等环境扰动由 KP 在骰前冻结，默认触发 DC 10 体质豁免；只有能力明文允许时才直接结束专注。

## 11. Damage Packet 与结算顺序

一个 DamagePacket 对应一次机械伤害来源，可以包含多个伤害类型分量。一次攻击的多种伤害位于同一包；两次箭击、独立射线或不同时点持续伤害分别形成多个包，以保留反应、专注和 0 HP 触发次数。

结算固定顺序：

1. 固定命中、豁免或其他成立条件；
2. 按 `SPEC 0003` 请求并提交该包需要的伤害骰和暴击附加骰；
3. 对每个伤害分量先应用其他加减修正；免疫归零，否则同类抗性无论来源只减半一次，再让同类易伤无论来源只加倍一次，每次除法向下取整；
4. 合计得到该来源的 `damageTaken`；
5. 先扣临时 HP，再扣真实 HP，得到暂定 0 HP 结果，但尚不提交死亡；
6. 若近战攻击会把目标从正 HP 降到 0，打开攻击者专属非致命选择；
7. 按选择提交临时 HP、HP、0 HP、巨量伤害、昏迷、稳定或死亡；
8. 对该来源结算专注、0 HP 受伤、状态及其他伤害后触发；
9. 打开仍合法的后续窗口，再恢复原结算。

临时 HP 不叠加、不是治疗，也不因为吸收全部伤害而抹除已经发生的伤害来源。攻击自然 1/20 和暴击语义不能用于普通检定或豁免；暴击只增加明文伤害骰，不把固定加值翻倍。

## 12. 0 HP、死亡与非致命击倒

### 12.1 玩家角色和 deathSaves 实体

Profile 必须表达：

- 降到 0 HP、昏迷、稳定、恢复 HP 和死亡；
- 0 HP 受伤造成一次死亡豁免失败，暴击造成两次；
- 降至 0 后单次剩余伤害达到最大 HP 时立即死亡；
- 自己回合开始进行死亡豁免；三次成功稳定，三次失败死亡；
- 自然 1 计两次失败；自然 20 立即恢复 1 HP；
- 恢复 HP 或稳定重置累计成功与失败；
- DC 10 Wisdom (Medicine) 动作稳定 0 HP 生物；
- 稳定后再次受伤失去稳定；未治疗稳定实体在权威 `1d4` 小时后恢复 1 HP；
- 临时 HP 不恢复意识、真实 HP 或稳定状态。

稳定、死亡和 Encounter 结束不会自动清除位置、物品、知识、关系、伤势或仍应存在的世界效果。

### 12.2 NPC deathPolicy

每个 NPC/生物在死亡结果可知前已经固化 `deathPolicy`。普通 NPC 可以在 0 HP 死亡，重要 NPC 可以使用死亡豁免；KP 不能看见伤害、剧情价值或玩家选择后临时改变策略。

### 12.3 非致命击倒产品裁定

2014 允许近战攻击者在把目标降到 0 HP 的瞬间选择击昏。`damage-death-srd51-2014-v1` 明确采用以下版本化产品裁定：

- 只有近战攻击把目标从正 HP 降到 0 时提供选择；远程攻击和仅要求豁免的效果不提供；
- 选择窗口位于 0 HP/巨量伤害/NPC deathPolicy 提交前；
- 选择非致命后目标昏迷且稳定，即使剩余伤害达到其最大 HP，也不按本次伤害立即死亡；
- 选择、骰面和结果成为事件，重试和 replay 得到同一结果。

该优先级是对 SRD 未明确组合顺序的产品裁定，不是 2024 规则，也不能由 KP 在看见结果后改变。

## 13. 非歼灭结束与长期后果

“只剩一个存活阵营”只产生 Ending Candidate，不是唯一条件。Encounter 可以因以下事实停止使用先攻：

- 所有仍敌对实体死亡、失能、无法继续或已经离开；
- NPC 投降且每个相关玩家角色明确接受停止冲突；
- 玩家角色完成逃离；
- 各方接受停战、谈判或其他停止敌对结果；
- Encounter 目标完成且没有实体选择继续机械冲突；
- KP 依据已固化事实提议当前机械冲突已不需要先攻顺序。

玩家分别决定自己的角色是否投降、接受条件、停止追击或继续合法攻击；KP 决定 NPC/世界是否继续敌对。NPC 投降后玩家拒绝接受时，系统不能替玩家停手：未结束 Encounter 继续按新意图结算；已经合法结束后再次攻击则建立引用旧结果的新 Encounter。

结束提案只是一种战斗 Rules Input。`step` 必须验证：

- 没有未结清的伤害、移动、死亡、强制效果或自动继续；
- 没有尚待相应控制者回答的战斗选择；
- 退出者、俘虏、尸体、位置、装备、资源和持续效果已经成为事实；
- 结束不会清除或回滚任何合法后果；
- 未到期相位效果已经按 Combat Time Profile 转换。

Encounter 结束必须保留 HP、伤势、死亡/稳定、法术位、职业资源、弹药、物件、位置、俘虏、尸体、知识、关系、承诺、敌对关系、动态定义和持续效果，并按 `SPEC 0008` 跨场景/章节继续。

Encounter 结束不等于故事结束。它可以向 `SPEC 0009` 提供 Ending Candidate，但不能自动提交 Story/Chapter/Campaign conclusion。之后重新爆发敌对建立新的 Encounter，不能静默重新打开旧 Encounter。

## 14. 主要战斗事件

事件名称可以在实现中调整，但以下语义必须由 `step` 产生并可由 `replay` 重建：

- `EncounterStarted` / `CombatantJoined` / `CombatantDeparted` / `EncounterConcluded`；
- `HostilityChanged`；
- `SurpriseDetermined` / `InitiativeRequested` / `InitiativeEstablished` / `InitiativeTieOrdered`；
- `RoundStarted` / `TurnStarted` / `TurnEnded` / `RoundEnded`；
- `ActionGrantCreated` / `ActionGrantSpent` / `MovementSegmentCommitted`；
- `ReactionOpportunityOpened` / `ReactionAnswered` / `TriggerInvalidated`；
- `AbilityInvoked` / `SpellCastingStarted` / `SpellCountered` / `SpellResolved`；
- `EffectApplied` / `EffectEnded` / `ConcentrationStarted` / `ConcentrationEnded`；
- `DamagePacketResolved` / `TemporaryHpChanged` / `HitPointsChanged`；
- `KnockOutChoiceOpened` / `CreatureStabilized` / `DeathSaveResolved` / `CreatureDied`；
- `CombatPhaseAnchorScheduled` / `CombatPhaseAnchorExpired`。

这些事件使用 `SPEC 0003` 的同一连续房间序列、Receipt、作用域证明和回放，不建立战斗事件库或独立日志。

## 15. B 条款处置与验收场景

所有测试必须在责任 Interface 上建立真实状态：玩家/NPC 选择经 Room Action，机械经 `step`，观察经 `project`，回放经 `replay`。不得直接修改 EncounterState、骰面、窗口、HP、位置或内部事件伪造成功。

| 原条款 | 处置 | 战斗验收场景 |
| --- | --- | --- |
| B07 | 保留 | 三个以上阵营以不同敌对关系开战，一方中途停战；关系变化可回放，非玩家实体不被合并为同一敌方。 |
| B08 | 保留并绑定 Geometry Profile | 区域调用者只给原点/方向/尺寸，Rules 计算全部受影响实体，不可漏选或额外选择。 |
| B09 | 保留 | 多段自主移动在实际离开触及前打开借机攻击；反应改变速度/位置后剩余路径不提交并交回控制者。 |
| B10 | 保留 | 传送或不使用目标自身移动/动作/反应的强制移动离开触及，不打开借机攻击。 |
| B11 | 保留 | Extra Attack 角色攻击、移动、换目标、再攻击；每段可暂停，不能把许可泛化给所有多射线法术。 |
| B12 | 保留 | Action Surge 与 haste 分别产生普通/受限 grant；haste Attack 只有一次武器攻击，且不刷新附赠/反应/免费互动。 |
| B13 | 保留 | Shield 在命中后伤害前或成为 magic missile 目标时打开私人窗口，重新判断触发攻击并正确持续。 |
| B14 | 保留 | 看见 60 尺内施法才可 Counterspell；等级比较、属性检定、嵌套和不返还资源均符合 2014。 |
| B15 | 保留 | Ready 冻结可感知触发；触发后可用反应或放弃；预备法术在预备时耗位并专注。 |
| B16 | 拆出 | 断线与窗口恢复完全由 SPEC 0003/0010/0011 验收，本规格不复制。 |
| B17 | 保留 | 不同施法顺序都服从 2014 bonus-action spell 限制；无附赠动作法术时 Action Surge 可施放两个一动作非戏法。 |
| B18 | 保留 | Shield 等 AC 效果让投影和全部攻击路径读取同一有效 AC。 |
| B19 | 保留 | 一个/多个伤害来源、临时 HP、专注替换、主动结束及环境 DC 10 分别产生正确专注次数和结果。 |
| B20 | 保留 | 混合类型先处理其他修正，再单次抗性/易伤、临时 HP 和 HP；取整与 replay 一致。 |
| B21 | 保留 | 覆盖巨量伤害、0 HP 受伤、死亡豁免、自然 1/20、Medicine、稳定后受伤、1d4 小时恢复、治疗和临时 HP。 |
| B22 | 修订后保留 | 近战非致命窗口在死亡提交前；选择后即使满足巨量伤害也稳定昏迷；NPC deathPolicy 事前固化。 |
| B29 | 保留战斗段 | 投降接受或完成逃离后，在所有帧/窗口结清才结束；相位锚点转换且长期后果保留。 |
| B30 | 保留战斗段 | 玩家拒绝接受投降时系统不代停；按新意图继续旧 Encounter 或建立后续 Encounter。 |
| B35 | 保留 | 同一隐藏者可只突袭一个角色；首回合限制、反应恢复、Dex 先攻、共享组和平手权符合 2014。 |
| B36 | 保留 | Extra Attack 可分别 Grapple/Shove；目标选 Athletics/Acrobatics 对抗，不生成 2024 豁免。 |
| B37 | 保留 | 同一法术多目标共享明文伤害骰，各目标独立豁免/防御；自然 20 豁免不自动成功。 |
| B38 | 保留战斗段 | 长施法逐回合投入动作并专注，中断不耗位、完成才耗位；ritual 加十分钟不耗位，普通反制不返还。 |
| B39 | 保留并绑定 Geometry Profile | 精确范围边界、掩护、挤入、墙前区域原点、普通区域阻挡和绕角特例全部通过 conformance table。 |
| B40 | 保留 | 突袭、bonus-action spell、Grapple/Shove、Hide、疲乏和自愿失败豁免均拒绝 2024 污染。 |
| B49 | 修订后保留 | 两个控制者同因果点触发；排序不依赖网络/遍历，前项使后项失效时无成本关闭，重连/replay 顺序一致。 |
| B53 | 保留战斗垂直段 | 自然语言意图经 Room Action 进入多人 Encounter，覆盖动态环境引用、移动中断、玩家反应、NPC 提案、伤害/专注、非歼灭结束和长期后果；通用秘密/恢复由上位规格断言。 |

截至 2026-08-27，B 表责任已经由下列公开 Interface 测试建立定向映射；这里记录的是当前工作树已经运行通过的切片，不替代冻结源码上的全量门：

| 条款 | 责任测试映射 | 当前定向证据 |
| --- | --- | --- |
| B07 | `tests/kp/combat/combat-hostility.test.mjs` | 2/2；三阵营敌对候选、事件化停战及 `project/replay`。 |
| B08–B10、B39 | `tests/kp/combat/combat-mechanics.test.mjs`、`tests/kp/world/chandelier-environment-rules.test.mjs`、`tests/product/privacy/privacy-bypass.test.mjs` | Geometry 的范围/区域/移动/中断与隐藏空间安全错误已通过公开 `step/project/replay` 定向场景。 |
| B11、B12、B17、B35–B37、B40 | `tests/kp/combat/combat-mechanics.test.mjs` | grant、逐实体突袭、2014 Grapple/Shove、多目标结算与 2024 护栏纳入当前 45/45 组合。 |
| B13–B15、B18–B22、B29–B30 | `tests/kp/combat/combat-mechanics.test.mjs` | 私人反应、伤害/专注/死亡、非致命和全体存活玩家结束同意纳入同一 45/45 组合。 |
| B38 | `tests/kp/combat/combat-long-casting.test.mjs` | 8/8；长施法逐轮投入、中断、仪式与完成后反制。 |
| B49 | `tests/kp/time/runtime-trigger-time.test.mjs` | 同因果触发排序、失效、掉线保持与 replay 的定向组合已通过。 |
| B16（以及上位规格中的 B27/B50 恢复责任） | `tests/platform/recovery/randomness-recovery.room.test.ts`、`tests/kp/adjudication/contest-room-randomness.room.test.ts`、`tests/platform/recovery/archive-do-resume.room.test.ts`、`tests/kp/knowledge/observer-projection.test.mjs`、`tests/kp/narration/observer-delivery.room.test.ts`、`tests/platform/recovery/room-retry.room.test.ts` | 恢复、观察者专属投影、增量归档和幂等重试走通用 Room Authority，没有战斗副本；最终随机/恢复/对抗组合 24/24、retry 3/3、archive resume 2/2 已记录通过。 |
| B53 | `tests/kp/combat/combat-vertical.room.test.ts`、`tests/kp/combat/combat-room-randomness.room.test.ts`、`tests/platform/recovery/combat-archive-correction.room.test.ts` | 1/1 垂直段、11/11 Room 战斗随机/恢复和 3/3 战斗归档/更正切片已记录通过；与通用随机/对抗组合合计 24/24。 |

## 16. 自主裁定记录

本节为非规范附录，已移至 [SPEC 0012 附录](./0012-appendix-decisions-mapping-and-review.md#16)。

## 17. 实现映射

本节为非规范附录，已移至 [SPEC 0012 附录](./0012-appendix-decisions-mapping-and-review.md#17)。

## 18. 五项交叉审查

本节为非规范附录，已移至 [SPEC 0012 附录](./0012-appendix-decisions-mapping-and-review.md#18)。

## 19. 实施完成门

本节为非规范附录，已移至 [SPEC 0012 附录](./0012-appendix-decisions-mapping-and-review.md#19)。
