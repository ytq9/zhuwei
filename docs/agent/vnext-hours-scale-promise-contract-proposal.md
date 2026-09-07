# 能力合同（待裁定）：几小时尺度的 NPC 承诺如何变成会到期的计划

2026-09-08。状态：**草案，等用户裁定。** 承接 [交接 §7 第 4 条](../../handoff.md)与[虚构时长合同 §9](vnext-fiction-time-contract-proposal.md)。这一份只管第 2、3 层——承诺进机械、机械到期执行；半分钟一档内的小约定按[等待旁白回执](vnext-wait-narration-validation.md)走上下文路线，不在这里。

## 1. 哪些承诺才进这里

用户已裁定的三条判据，满足任一条才进机械：

1. **独立于玩家注意力而发生**：玩家走开、睡觉、做别的事，它也会在某个时刻发生。
2. **被别处的人看到**：另一个场景、另一个玩家、或者时间线分开之后还要对得上。
3. **改变权威状态**：交付一件物品、打开一扇门、一个 NPC 移动到别处、一份文书被送达。

「明早卯时把文书送来」三条全占；「半分钟后敲一下账台」一条不占。round75–81 六批 `consequences: []` 是对的：那个场景里没有满足判据的承诺。

## 2. 现状：三层各自都在，中间断开

| 层 | 现在有什么 | 断在哪 |
| --- | --- | --- |
| 1 承诺记录 | social 的 `result.consequences[]` 里 `{kind:"promise", content, condition}` → `PromiseMade` → `campaignRuntime.promises` | 只是文本，没有时间点；没有人拿它派生任何未来动作 |
| 2 计划形成 | `formActorPlan` 步骤：goal / nextStep / premiseRefs / durationMicros / traceDescription / alternate → `NpcPlanFormed` + timer Activity | 依据只认**行动前**状态里的记录（`actor-plans.ts:20`）；同束新建的承诺不能作依据；模型也从未主动选它 |
| 3 到期执行 | due 队列 → `commitDueActorPlanWork` → 一次 actorPlan 决策调用（execute / revise / defer / cancel）→ 痕迹事实 + 旁白 | 完好，round61/77 有真实证据 |

第 1 层和第 2 层之间没有路：一句「我明早送来」被记成承诺后，世界不会自己在明早做任何事。

## 3. 三个闭合办法

**甲：让 KP 在同一束里再填一个 `formActorPlan`，用 prospective 句柄引用刚承诺的内容。** 需要放开「依据必须是行动前记录」——同束前向引用 promise 的 handle。改动在 lowering 的依赖图和 Rules 的前提校验；KP 要多填一整张表（目标、下一步、时长、痕迹、替代目标）。六批里模型一次都没选过 `formActorPlan`，再多一张表不会更常选。

**乙（推荐）：承诺自带时间，Rules 在同一根里由承诺派生计划。** social 的 promise 后果加一个 `due` 字段；`PromiseMade` fold 之后，Rules 在同根内追加 `NpcPlanFormed` + timer Activity，goal / nextStep / traceDescription 都从承诺文本和 `due` 派生（或让 KP 在 promise 里顺手填一句 `trace`）。第 2 层不再需要模型单独选表；`formActorPlan` 保留给「NPC 自己起意」的计划。改动集中在 Rules（社交后果 fold 之后的派生）和 schema（promise 多两个字段）。

**丙：服务器在下一次到期检查时才把承诺变成计划。** 最省 schema，但把「承诺什么时候变成机械」推到一个隐性时刻，replay 和审计都更难说清；不推荐。

## 4. 乙的合同

### 4.1 声明面（wire）

```
consequences: [{
  kind: "promise",
  content: "明早卯时把备案文书送到账台。",
  condition: "……",                 // 已有
  due: "nextDawn" | "1h" | "halfDay" | "day" | "none",   // 新增：什么时候必须发生
  trace: "账台上多了一份盖印的备案文书。"                   // 新增：到期执行后世界上留下什么可见痕迹
}]
```

- `due: "none"` 表示这个承诺不需要世界自己去做（留给上下文路线）；其余档位与时长档位同一口径（粗，不精确）。`nextDawn` 是唯一一个锚在日历上的档位，因为「明早」是这类承诺最常见的说法。
- `trace` 是第 3 层已有的 `traceDescription`，提前到承诺时填；没有痕迹的承诺不值得进机械。

### 4.2 执行

- Rules 在 `PromiseMade` fold 之后（同一根、同一 Receipt）追加 `NpcPlanFormed` + timer Activity：`npcId = promisorId`，`goal = content`，`nextStep = content`，`premiseRefs = [promiseId]`（本根内刚产生的记录，作为依据是合法的，因为它已在累加状态里），`durationMicros = due 的微秒`，`traceDescription = trace`，`alternate` 由服务器给默认（到期时 NPC 不在原场景 → revise）。
- 到期走现有第 3 层：一次决策调用，execute 落痕迹事实，revise / defer / cancel 各留记录；承诺状态随之变 fulfilled / broken。
- `crossedDeadlines`：玩家的一次行动跨过这个到期点时按现有规则记录，随后的到期结算执行它——这条链现在已经通了（[合同 §10.2](vnext-fiction-time-contract-proposal.md)）。

### 4.3 不做的事

- 不改 `consequences` 的选择指引强度：模型判断「没有承诺」就是没有。
- 不让承诺自带完整机械后果（交付物品、开门）：到期执行只落痕迹事实和知识，物品与门仍由第 3 层的决策调用按现有能力处理。
- 不做多 NPC 联合计划、不做势力计划。

## 5. 验收与场景

round70 的三句（半分钟）不能验这层。要换一个几小时尺度的场景，例如：玩家向瓦罗要备案文书副本，瓦罗答应「明早卯时送到」；玩家等到次日（或做别的事跨过卯时）；gate 看：`PromiseMade` 带 `due`、同根 `NpcPlanFormed` + Activity、到期 `NpcActionCommitted` + 痕迹事实、旁白提到文书已在账台上。

直接证据：
1. 承诺记录 → 计划派生（同一 Receipt）；
2. 跨过到期点后的结算执行；
3. 玩家不在场时（另一个场景）执行后的痕迹与知识归属。

## 6. 需要你定的

1. 乙 vs 甲。
2. `due` 的档位集合：上面这五个够不够；要不要 `nextDusk` / `nextDay`。
3. `trace` 由 KP 在承诺时填，还是到期执行时再由决策调用生成（前者一次调用，后者更贴近到期时的状态）。
