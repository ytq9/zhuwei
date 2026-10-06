# ADR 0126：战斗后续能力沿同一规则与真实出口结算

- 状态：已接受
- 日期：2026-10-06
- 依据：用户要求完成 [handoff §5.5](../agent/handoff-tactical-map-combat.md)；产品边界已有 [SPEC 0012 §§3.4、6.3、7、9–13](../specs/0012-authoritative-combat-mechanics.md) 和 [SPEC 0001 §§8、14、16](../specs/0001-llm-kp-responsibility-contract.md) 裁定。
- 取代范围：ADR 0113 中因缺少玩家对抗选择而不向 NPC 提供玩家擒抱／推撞目标的实现限制；ADR 0112 的 `endCombat: escaped` 不能继续自行制造“逃离完成”事实。不修改产品条款。

## 决定与原因

NPC 首次战斗定义补充伤害防御、命中附带效果及效果豁免，继续编译成现有 AbilityDefinition。普通、预备和借机攻击共享豁免与效果结算；命中附带效果会先于被打断的移动续接生效。Multiattack 消耗一个普通动作，授予指定攻击各自的次数；这些次数不能替代擒抱／推撞，与 Extra Attack 的 Attack action 次数分别保存。回合计划预检与真正出手都消费同一授予语义。

玩家武器以实际装备的 ItemEntry 为来源，为普通攻击、投掷、临时武器和双轻武器附赠攻击编译不同定义。双持资格来自实际 Attack action；正伤害调整值不加入附赠攻击，负值保留。投掷在实际出手时释放原物品到冻结落点，即使未命中也不会保留一把副本。Ready 的投掷通过同一释放事件，不能获得双持资格。临时武器使用已拿在 main/off 手位的物件，不把整个背包展开成攻击目录。

升环使用原法术目录的结构化规则编译独立定义，成本、实际环数、伤害／治疗、目标数和范围一起冻结。调用不能另外覆盖 slotLevel。现役执行器没有支持的特殊机制或重复射线不被编成普通单次命中。

NPC 对玩家擒抱或推撞时，先打开目标本人控制的 `contestDefense`；回答之前不掷骰、不扣动作。原计划及 Ready 反应续接保留，回答后不重新询问 NPC。NPC 急救复用现有 DC 10 医药动作及稳定／恢复调度，调用次数不增加。

逃离要求先通过普通战术移动到真实、可通行的相邻出口，再跨出口消耗最后五尺移动。跨出口仍检查借机攻击；被打倒、不能移动或出口失效时不离开。`CombatantDeparted` 与真正的 `CharacterMoved` 记录成员离开和目的地，历史参战身份与感知账本保留；本人离开时保存当时已感知的片段。余下成员继续先攻，离开者不再获得回合。相位效果沿原有残余时间任务转换，回来参战时沿同一加入入口重新排入先攻。

“所有玩家倒下”不能冒充死亡、被俘或安全。未结死亡豁免继续处理；没有活着的玩家控制者、没有待决机械且余下生物不再继续冲突时，Rules 直接结束 Encounter，不伪造玩家接受，也不结束 Story。结算共用原有时间、效果与记忆收束，不另建战斗状态库。

标准装备与 NPC 机械 Profile 升为 v3；vNext runtime 升为 v6，事件 Profile 升为 v4。沿 [ADR 0120](0120-a-new-runtime-version-retires-open-rooms.md) 的已批准版本边界，本地开发不隐含部署或远端房间迁移授权。

## 验收接缝

`combat-start.test.mjs` 覆盖首次定义、多重攻击、附带状态、本人选择和 NPC 急救；`handoff-combat-continuations.test.mjs` 从真实 Rules 入口覆盖投掷、升环、撤离中断、全员死亡及每步重放；`npc-departure.test.mjs` 覆盖 NPC 计划撤离、残留效果到期与重新加入；`opportunity-effects.test.mjs` 覆盖借机攻击命中／落空、效果豁免成败和麻痹中断移动；`npc-combat-turn.room.test.ts` 覆盖私人选择的真实 Room 续接。验证结果与外部调用限制只记在本轮回执。
