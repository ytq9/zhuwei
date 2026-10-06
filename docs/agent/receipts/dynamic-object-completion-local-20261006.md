# 动态对象补全与容器连续性：本地验收

日期：2026-10-06。分支 `cloudflare`；实施基线 `e750a397`。用户已明确批准扩展 [SPEC 0016 §7.2](../../specs/0016-part-c-compound-actions-and-claims.md)，决定见 [ADR 0128](../../adr/0128-existing-objects-complete-without-recreation.md)。此前 Claude 的场景状态和战斗交接已在基线中，本次没有重复整合。

## 已实现与直接证据

- **原对象补全**：NPC 的首次战斗数据，实物明确未定的使用／装备／资源上限及开关机制，地图物件缺失耐久和地形字段，沿 `completeObject` 进入原生记录。定义和实例不混淆；共享定义只对目标实物派生新定义，原身份、同类其他实例、已耗资源和伤势保留。明确不存在的机制不能补成有锁或新能力。
- **当前行动接续**：实际填写编解码、Lowering 和原子 Rules 已覆盖 NPC 补全后开战、原物品补使用能力后立即付费使用、便携物件补状态后打开，以及同束新容器／原内容的物化和拿取。NPC 先攻等待期间修改原稿不能更改冻结的 HP；补全自身不消耗玩家行动时间。
- **持久化与读取**：ItemEntry 的 `containerRef` 记录直接容器，原有持有人／场景字段随容器移动维护。不同容器不合并同类堆叠；部分取出只减少原条目数量；循环、陈旧读绑定和关闭容器取用被拒绝。破坏便携容器不自动抹掉独立内容，地图容器残骸中的物品仍能取用。读取本身不创建物品。
- **权限与恢复**：玩家已经识别的信息仍按原定义版本可读，补全不自动授予新增私有属性。新识别事件才更新知识。隐藏内容不出现在可见物品和持有物投影中。补全、数量变更与更正均可重放。

[通用补全测试](../../../tests/kp/world/native-object-completion.test.mjs)最终 9 项通过；[容器规则测试](../../../tests/kp/items/contained-items.test.mjs)最终 6 项通过。日志：`/tmp/zhuwei-native-completion-progress.log`、`/tmp/zhuwei-contained-boundaries.log`。既有门、装备、更正、转交与消耗的直接消费者组曾以 35 项通过，日志 `/tmp/zhuwei-object-completion-consumers.log`；后续新增的用例不重复累计到这个数字。

[容器 Room 测试](../../../tests/kp/items/contained-items.room.test.ts)和[场景物件 Room 测试](../../../tests/kp/world/object-mechanics.room.test.ts)共 2 项通过。它们使用真实本地 Room、SQLite、动作接口与归档接口，模型回复是脚本：三条布中拿走一条，铜灯补耐久后损坏，离开／返回、重复提交、DO 驱逐和新 DO 恢复后，原条目、剩余两条布及铜灯的 0/4 耐久保持。日志 `/tmp/zhuwei-object-completion-room-20261006.log`。这不是外部模型可靠性证据。

## 检查结果与未关闭波动

- `npm run typecheck` 最终通过，日志 `/tmp/zhuwei-object-completion-typecheck-20261006.log`。
- 新测试先定向通过再加入 SPEC 门；两轮 `npm run gates:check` 均实际运行 Node 与 Worker，107 个测试文件。本能力相关门和全部 Worker 门通过，没有扩大任何失败基线。
- 首轮 105 文件全绿：`selection-amendment` 还断言仅场景定义可补全，已按获批条款改为“原有可补对象才提供，无可补对象省略”，同时验证缺战斗数据的 NPC 可选；另有 `delivery-confirmation` 的重复原话迟到回复用例失败。后者未改源码，定向复跑通过。
- 第二轮 106 文件全绿：仅 `send-action-recovery` 的 “a confirmed terminal failure keeps its explanation while the player edits and submits a fresh action” 失败。随后该文件定向复跑全部通过。尚未捕获整组执行时的具体失败状态，不能确认其根因，也不能宣称最终整套门一次全绿。若要关闭此波动，下一项检查应只针对这两个 React 异步测试保留失败断言与调用／刷新时序，不扩成真实游戏探针。
- 第二轮门运行期间，最后纠正了补全说明里一个不存在的目录字段名，改为读取冻结对象的 `entryRef`；表单／选择的 33 项定向测试随后通过。该小修没有改变运行时存储与执行行为。最终 `node tools/gate.mjs --check` 静态棘轮通过，规格引用和文档断链均为 0，模块无新增违规；`git diff --check` 通过。日志 `/tmp/zhuwei-object-completion-static-final-20261006.log`。

门日志：`/tmp/zhuwei-object-completion-gates-20261006.log`、`/tmp/zhuwei-object-completion-gates-final-20261006.log`。复核日志：`/tmp/zhuwei-object-completion-gate-followup.log`、`/tmp/zhuwei-object-completion-recovery-followup.log`、`/tmp/zhuwei-object-completion-guidance-final.log`。

## 请求体积

以下是本地保守估算器测得的固定提示词和表单输入，**不含当局上下文，也不是实际账单**。基线为 `e750a397`；调用次数、输出限制和输入上限未增加。新增内容只描述本次补全／容器能力，按 ADR 0057 告知用户并接受实测请求体积，其他基线未放宽。完整组合共享物品和 NPC schema，未提高 DeepSeek 的 schema 节点上限。

| 选择 | 原 token | 当前 token | 增量 |
| --- | ---: | ---: | ---: |
| `storyContinuity` | 8,314 | 8,347 | +33 |
| `materializeStory` | 8,844 | 8,876 | +32 |
| `admitStoryFacts` | 9,081 | 9,114 | +33 |
| `abilityOperation` | 5,681 | 5,681 | +0 |
| `startCombat` | 7,254 | 7,254 | +0 |
| `endCombat` | 4,716 | 4,716 | +0 |
| `materializeNpc` | 11,659 | 11,691 | +32 |
| `materializeObject` | 12,621 | 12,654 | +33 |
| `completeObject` | 8,567 | 13,252 | +4,685 |
| `observe` | 10,664 | 10,697 | +33 |
| `formActorPlan` | 8,437 | 8,470 | +33 |
| `social` | 12,563 | 12,595 | +32 |
| `worldInteraction` | 14,109 | 14,145 | +36 |
| `commitNarrativeDetail` | 7,911 | 7,944 | +33 |
| `authorAbility` | 12,116 | 12,149 | +33 |
| `authorHazard` | 12,687 | 12,720 | +33 |
| `authorItem` | 13,081 | 13,652 | +571 |
| `materializeItem` | 8,772 | 9,044 | +272 |
| `inventoryOperation` | 9,879 | 10,081 | +202 |
| `social+formActorPlan` | 13,598 | 13,630 | +32 |
| `social+formActorPlan+commitNarrativeDetail` | 14,108 | 14,140 | +32 |
| `worldInteraction+materializeObject` | 19,253 | 19,289 | +36 |
| `authorItem+materializeItem+inventoryOperation` | 13,081 | 13,652 | +571 |
| `social+worldInteraction+materializeNpc` | 23,086 | 23,121 | +35 |
| `*all` | 50,317 | 51,761 | +1,444 |

测量文件：`/tmp/zhuwei-object-completion-size-20261006.json`。图形界面仍沿用原文字、背包和地图，仅现有背包显示可知的开关状态。

## 交付边界

没有真实模型调用、浏览器 QA、production build、远端 migration、push 或部署。真实模型是否会准确复用引用、正确选择补全及实际费用仍需有界实测；现有支线真实路线预算和 NPC 接续额外调用问题未被本次批准代替。未增加类型化任务板或新图形对象面板；未扩展模组开场 JSON 的嵌套容器格式。

本地事件与运行时版本更新为 `room-world-events-vnext-stage3-v5` / `runtime-srd51-2014-authoritative-vnext-stage3-v7`。依 [ADR 0120](../../adr/0120-a-new-runtime-version-retires-open-rooms.md)，将来部署后旧 manifest 的开放房间会退役；本轮没有部署，也没有跨版本迁移。
