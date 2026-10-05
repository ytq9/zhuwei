# ADR 0123：战斗经历与交接中的本人决定

- 状态：已接受
- 日期：2026-10-06
- 依据：用户在本轮逐项确认五个 handoff 问题：实际旁观的 NPC 与玩家角色保存本人战斗经历；包含目睹他人的事并保留来源、控制长度；交谈中明确投降记录玩家本人停手；目标 NPC 缺少战斗属性时先补齐合法定义。
- 规则所在：[SPEC 0012 §13](../specs/0012-part-b-abilities-damage-and-conclusion.md)、[SPEC 0006 §7](../specs/0006-module-npc-and-faction-protocol.md)。
- 取代范围：[ADR 0118](0118-npcs-remember-fights-and-may-start-new-ones.md) 的参战 NPC／只涉本人／玩家无记忆限制，以及目标 NPC 尚无战斗属性时不能发起的限制。[ADR 0117](0117-an-npc-yields-or-turns-from-its-own-view.md) 的本人决定与部分投降保持有效。

## 实现决定

1. 扩展同一个遭遇感知账本，不建立另一个战斗状态或记忆服务。每次事件折叠依据当时的身体状态、空间可见性、感官与实际知识取得决定谁感知了什么；视觉不能穿过完全遮挡、隐蔽或失明。听觉只读取该角色实际取得的话语/声音记录，不把声音变成未看见的命中或人物身份。按交手对、敌对变化与听觉来源聚合，保留首末事件引用，不逐回合复制日志。完整原话仍是原知识记录。
2. 结束时沿已有 CanonicalFact/SensoryEvidenceAcquired 渠道保存私有经历，继续使用 ADR 0111/0115 的近期窗口和分层检索。记忆保存不要求写手再复述整场战斗：当次遭遇结束事件承担即时旁白，知识供之后回顾。
3. social 提案用 `playerStopsFightingRefs` 表达玩家明确投降的对象，正文依据来自玩家原意图与实际说出的话。由服务器在同一立场结算中复用 `changeEncounterHostility`，顺序为交谈、玩家停手、NPC 本人立场；两个独立声明都落定后才判断能否提出结束，避免 NPC 同时重新敌对时提前问结束。是否接受不由该字段决定。接受与拒绝均可成立，是否结束遭遇仍走原玩家选择。
4. NPC 自己选择攻击目标后，缺少的目标机械由独立主持请求补齐。请求只带目标的既有属性、装备与机械锚点，不重新决定双方意图。请求和响应沿现有外部调用 journal 保存为该根的 ordinal 4，复用原调用预算；重试读取已保存响应，未知不重发。正式开战仍走现有 startCombat 编译、目标检查、先攻与事件路径。原 NPC 响应不能代写他人的数值，主持材料不回注它的视图。每次需要准备时额外调用一次；已有战斗定义则没有这次调用。
5. 实际说出口的 NPC 回合台词消耗原生 turn 上的标记。重新规划同一回合保留标记，真正 TurnStarted 重置；未执行的草稿不消耗发言。
6. NPC 非法计划的下一次既有重试带上保存的原计划及本人 options 导出的诊断，仍使用原最多尝试次数。主持人的秘密和其他人的私有诊断不进入此请求。
7. 承诺材料改为承诺者、对象、答应的事及其前提，去掉要求写手复述“尚未履行”等记账句的前缀。隐蔽库存操作的选择边界说明同时选择 worldInteraction 承载检定，库存步骤承担实际取放；没有增加另一套机械或额外重试。
8. 运行时更新到 `runtime-srd51-2014-authoritative-vnext-stage3-v4`，按 [ADR 0120](0120-a-new-runtime-version-retires-open-rooms.md) 处理旧 manifest。本地改动不等于已部署。

## 验证接缝与边界

- Rules 与回放：`tests/kp/combat/combat-aftermath.test.mjs`、`npc-combat-stance.test.mjs`。
- Room 与调用保存：`tests/kp/combat/npc-starts-combat.room.test.ts`、`npc-combat-turn.room.test.ts`。
- 承诺材料：`tests/kp/npc/social-commitments.test.mjs`、`tests/kp/narration/social-context.test.mjs`。

上述测试使用脚本模型。真实模型能否合理使用新增入口、实际费用以及部分投降/战后再行动的样本，仍须按获批批次取证；不把确定性通过改称真实验证。
