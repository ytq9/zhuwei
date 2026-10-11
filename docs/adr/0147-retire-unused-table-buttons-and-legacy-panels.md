# ADR 0147：删除无调用者的桌面按钮接口与旧面板

- 状态：已接受
- 日期：2026-10-11
- 依据：桌面统合（[方案](../agent/proposals/table-ui-consolidation-plan-20261011.md)）完成后，用户要求删除服务端的 `castSpell`、`useFeature`、`useHitDie` 接口，以及旧战斗条、小队排队条与休息投票，并同意按规格流程修改固定它们的验收门。
- 当前规则：条款不变。相关条款：[SPEC 0007 §5](../specs/0007-multiplayer-room-and-fiction-time.md)（队长只组织整队，不审批成员行动）、[SPEC 0012 §13](../specs/0012-part-b-abilities-damage-and-conclusion.md)（玩家通过交谈投降、通过移动逃离）、[SPEC 0014 §§4、8](../specs/0014-observer-tactical-map-and-environment.md)（能力经行动列表与地图，ADR 0146）。
- 取代范围：ADR 0146 "实现边界"一节中"`castSpell`、`useFeature`、`useHitDie` 入口仍被验收门固定"的保留。

## 原因

现役房间的 `fetchTable` 固定返回 `combat: null`、`restVote: null`、`restHold: null`、`squadQueue: []`，旧战斗条、小队排队条与休息投票从未在现役版本显示；小队排队接口在现役版本只返回"个人合法行动不再进入队长审批队列"。它们的能力都已有现役入口：

| 旧入口 | 现役入口 |
| --- | --- |
| 加入战斗 `joinCombat` | KP 开战，Rules 决定参战者（ADR 0102） |
| 战斗条结束回合 | 回合条，`endTurn` 直接交 Rules |
| 撤离、逃跑、退出、投降 `leaveFight` | 基础动作"撤离"、地图出口，投降由玩家在交谈中说出（SPEC 0012 §13） |
| 护盾术反应 `resolveReact` | 待决的反应选择（`combatChoice`） |
| 战争祭司再攻 `extraAttack`、施法 `castSpell`、职业能力 `useFeature` | 角色栏行动列表的 `combatAbility`；战斗外组成句子（ADR 0146） |
| 花费生命骰 `useHitDie` | 短休表单中冻结的生命骰选择（`restNow`） |
| 休息投票与保持 | 队伍休整的待决同意（`groupRestConsent`） |
| 小队排队审批 `approveSquadQueue` | 无：成员直接行动（SPEC 0007 §5） |

保留这些接口只会留下一条绕过现役入口、把原始编号拼成句子交 KP 的旁路。

## 决定

1. 删除上述八个服务端接口、客户端函数与路由命令，以及桌面快照的 `combat`、`restVote`、`restHold`、`squadQueue` 字段和它们的页面组件。
2. 表格按钮命令只剩结束回合、开始或回答休整、中断休整；其他命令一律拒绝，不再转成文字意图。
3. 旧战斗模块 `kp/combat.ts` 已无调用者，一并删除，并从模块检查的第二权威允许名单中移除。
4. 验收门改为检查现役入口：SPEC 0004 的按钮语义门检查保留的三个按钮、伪造字段不进入行动、退役命令被拒绝；SPEC 0011 的界面门检查队伍、休整、战斗回合、语音与公开投影的现役入口，并断言退役名称不再出现；模块检查的接口路由成对表随之更新。门所守的不变量不变。

## 影响

不改产品条款、持久化结构或 Room 事件。已打开的旧页面若调用被删接口，会收到未知命令错误；刷新后的页面不再调用它们。
