# 能力合同：每个已提交的角色行动都有虚构时长

2026-09-07。状态：**用户已裁定（乙、共享裁决字段、KP 自定），本地已实现；round80 有执行半边的真实证据；2026-09-08 起时长改为档位，见 §10。** 源码基线 `a377544`；实现与四处偏差见 [验证回执](vnext-fiction-time-validation.md)。

起点是 round78 之后用户的一句话：这是虚构时间，不是现实时间；剧本里做的任何事都应该有一个合理的虚构时长。本文把这句话对照规格与源码，写成一份可以实现、可以验证的合同，并把它放回 NPC 计划那条链的正确位置。

## 1. 规格已经这样要求了

| 规格 | 原文 |
| --- | --- |
| SPEC 0007 §6 | 虚构时间只通过**行动**/Activity/轮结束等经 `step` 提交的事件推进；现实时间、网络/模型延迟、断线、TTL 不推进虚构时间。 |
| SPEC 0013 §7.1 | **普通动作、旅行、谈话、调查、施法和危险耗时由 KP/定义在结果前冻结，再由 Rules 验证。** |
| SPEC 0013 §7.2 | 处理一个开始时刻不早于 due 的新行动前，先把已经到期的 Activity/NPC 计划作为独立根行动提交，再重新投影原意图。 |
| SPEC 0001 §11 | NPC 在**虚构时间经过**、玩家制造动静、计划条件满足时依据自身条件行动。 |
| SPEC 0004 §85 | 所有耗时行为使用统一 `Activity`。 |

合同不发明原则，只把 §7.1 那句「由 KP 在结果前冻结」落到填写面上。

## 2. 现状：成功的普通行动没有时长入口

| 入口 | 谁填 | 状态 |
| --- | --- | --- |
| `passTime` 终结 `durationMicros` | KP | 可用，但只表示**显式等待** |
| 通行 / 长施法 Activity | 服务器从连接绑定或 Ability 派生 | 可用 |
| 因果物品程序 `activity:causal:` | 服务器 | 可用（[causal-actions.ts:600](../../app/_runtime/lib/rules/v2/causal-actions.ts:600)） |
| 拒绝的 `attemptCosts.fictionTime` | KP | 可用，但只表示**失败尝试** |
| `highRiskConfirmed.acceptedCosts` | KP | 休眠，无消费者 |
| 有意义失败 `fictionTimeCostMicros` | 服务器 | 可用 |
| **`social` / `observe` / `worldInteraction` / `inventoryOperation` 成功分支** | — | **没有任何字段** |

round78 首句是证据：玩家走到账台旁、自报家门、提出请求，瓦罗回了一整段话，`nowMicros` 从 `0` 到 `0`。第二句显式 `passTime` 才把时钟推到 `60000000`。

两处文字把这个缺口写成了规则本身：

- 能力目录 `social` 描述：「**当前表单支持即时口头交谈**，耗时活动和额外成本需独立可执行计划」（[proposal-capabilities.ts:10](../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts:10)）。模型被告知交谈不花时间。
- Rules 的束级成本类型显式排除虚构时间：`Exclude<WorldInteractionAttemptCost, { kind: "fictionTime" }>`，注释「Fictional duration belongs to an Activity, never an immediate spend」（[world-interaction-model.ts:263](../../app/_runtime/lib/rules/v2/world-interaction-model.ts:263)）。这条决定只出现在 `72201ea` 检查点提交里，没有单独记录理由。

而执行的另一半**已经存在**：

- `applyWorldInteractionAttemptCosts` 遇到 `fictionTime` 成本就发 `FictionTimeAdvanced`，`visibility:scene-observers`、public（[world-interactions.ts:2794](../../app/_runtime/lib/rules/v2/world-interactions.ts:2794)）。
- fold 把它加到事件所属时间线（[campaign-events.ts:1454](../../app/_runtime/lib/rules/v2/campaign-events.ts:1454)）。
- Claims 把它渲染成旁白材料「本次行动推进了 N 秒虚构时间。」（[claims.ts:722](../../app/_runtime/lib/rules/v2/claims.ts:722)），旁白审核已核对「时间」。
- Room 在提交之后、同一请求内清算新到期的工作（`withDueTail` → `drainDueActivities`，[durable-object.ts:6218](../../app/_runtime/lib/room/durable-object.ts:6218)），预算不足则延期到 alarm。

缺的是**声明**这一半，以及把 `Exclude` 那一行反过来。

## 3. 这条在整个框架里的位置

round78 之后确认了三层，从下往上：

| 层 | 缺口 | 证据 |
| --- | --- | --- |
| 1 | 普通行动不消耗虚构时间 | round78 首句 `nowMicros` 0→0；填写面无字段 |
| 2 | NPC 的承诺不被记录 | round75/77/78 三批 `consequences: []`，槽位在而空着 |
| 3 | 承诺没有变成计划 | `formActorPlan` 只认行动前 `state` 里的依据 |

第 1 层不通，第 2、3 层做对了也没用：`formActorPlan` 的到期时刻是 NPC 时间线的 `nowMicros + durationMicros`（[npc-plan-formation.ts:174](../../app/_runtime/lib/rules/v2/npc-plan-formation.ts:174)），只有玩家显式等待才推进时钟，NPC 的计划就只在有人说「我等」时才可能到期。§11 的「无人干预时的下一步行动」在正常游玩里永远不会发生——不是计划没形成，是时间根本不走。

**本合同只做第 1 层。** 第 2、3 层各自另立合同，§9 给出它们在这之上的形状。

## 4. 能力合同

> KP 裁决一句玩家意图时，同时冻结这次行动消耗的虚构时长；Rules 验证其形式，在该行动者所在时间线上推进这段时间，并把它作为公开事实交给场景观察者与旁白。零时长必须是显式声明，不是缺省。等待仍是 `passTime`，不是时长。

### 4.1 声明面

字段落在**共享裁决**上，不落在 step 上：一句意图是一个行动，一个行动是一段时间；同束的 `social` 与 `observe` 是同一件事的两个侧面，不是先后两段。

```
decision.kind = directSuccess | check
decision.durationMicros: string, pattern ^(0|[1-9][0-9]*)$, maxLength 16
```

| 束内容 | 合法值 |
| --- | --- |
| 含任一 `social` / `observe` / `worldInteraction` / `inventoryOperation` | **必须 > 0** |
| 只含 `materialize*` / `commitNarrativeDetail`（世界创作，不是角色在做事） | **必须 = 0** |
| 终结型 | 不变：`passTime` 已有自己的 `durationMicros`；`knowledgeReview` / `clarification` 零耗时；`inWorldRefusal` 保留 `attemptCosts`；`abilityOperation` 取定义 |

`check` 裁决的时长在骰前冻结，成功与失败同长——SPEC 0004 §51 已把「耗时」列入骰前冻结项。

### 4.2 KP 怎么定

由 KP 判断，Rules 只验形式。指引给的是校准锚点，不是查表：

| 行为 | 锚点 |
| --- | --- |
| 一句问答 | 5–15 秒 |
| 一段来回交谈 | 1–5 分钟 |
| 环顾一眼 | 3–10 秒 |
| 仔细检查一件物品 | 约 1 分钟 |
| 搜查一个房间 | 约 10 分钟 |
| 取、放、递一件物品 | 6 秒（一轮） |

规则：时长是**这次行动本身**，不含之后的等待——等待另提 `passTime`。拿不准时取短。角色在做事就不能是 0。

### 4.3 执行

1. lowering 把 `decision.durationMicros` 带进束级 `AtomicWorldInteractionStepsPlan`（新字段；同时解除 `executionCosts` 对 `fictionTime` 的 `Exclude`）。
2. 原子执行器在所有 step 结果**之前**发一条 `FictionTimeAdvanced`：`reason` = 冻结意图原文，`visibility:scene-observers`，public；复用 `applyWorldInteractionAttemptCosts` 的 `fictionTime` 分支。「成本先于结果」是现有约定（因果程序、可行性裁决均如此）。所有结果盖在**结束时刻**。
3. Rules 在 step 校验中执行 §4.1 的表：束含角色行动而时长为 0，或纯创作束而时长非 0，`invalidRulesInput`。
4. read-set 必须包含 `character-timeline:${actor}`。`social` 已有（[proposal-bundle-lowering.ts:925](../../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts:925)），`observe` / `worldInteraction` / `inventoryOperation` 补齐。这是多人一致性的全部机制：别人推进了同一时间线，你冻结的上下文就过期，重新冻结，不会静默错位。

### 4.4 跨过到期点：本合同的一个明确取舍

行动时长 D 之内可能落着一个已排程的到期点（NPC 计划 due、Activity 完成、世界效果结束）。两种做法：

| | 甲：行动即 Activity | 乙：即时推进，到期尾随 |
| --- | --- | --- |
| 做法 | 每个有时长的行动变成 Activity，冻结完成效果，按 `activityTimeSchedule` 分段推进，结果在完成时写入 | 一次推进 D，结果盖在结束时刻；新到期的工作由 `withDueTail` 在**同一请求**内、旁白发布前清算 |
| 虚构精度 | 到期点在行动**中途**发生，可打断行动 | 到期点在行动**之后**结算；这次行动的旁白无法反映中途打断 |
| 触及 | 新 `completion.kind`、执行器移到完成时、交谈的中断语义、每行动多一个阶段根 | schema 字段、指引、lowering、一条 Rules 校验、解除一处 `Exclude` |
| 模型调用 | 相同 | 相同 |
| 规格 | 严格符合 §7.2 与「时长属于 Activity」 | 符合 §7.2 字面（新行动开始时刻不早于 due） |

**裁定建议：先做乙，并让乙诚实。** 理由：round78 证明的问题是正常游玩**完全不走时钟**，乙以最小面解决它；甲的精度只在一个到期点恰好落在单次行动之内时才有意义，这种情形的频率现在是零证据。让乙诚实的两条硬约束：

- Rules 在推进前扫描该时间线 `(now, now+D]` 内的排程到期点（复用 `activityTimeSchedule` 对活动/NPC 计划/长施法的扫描，加 `scheduledWorldEffectDeadlines`），记入 Receipt 的 `crossedDeadlines`。不拒绝，只记录——它是日后决定要不要做甲的唯一数据。
- 跨过的到期点必须在同一请求内清算完毕、并在本次行动旁白之前发布；预算不足时按现有规则延期，下一次行动被 `dueActivityPending` 挡住，不静默吞掉。

「时长属于 Activity」这条注释不被推翻，只被收窄：束自己声明的时长可以即时推进；KP 称之为「活动」的东西（等待、通行、施法、休整）仍必须是 Activity。

### 4.5 多人

推进发生在行动者的 `characterTimelineId`——同场景同分支的角色共用一条（[timeline.ts:40](../../app/_runtime/lib/rules/v2/timeline.ts:40)）。因此同场景所有人的时钟一起走，这正是 SPEC 0007 §6「一个场景没有多个私人时钟」的意思；分头场景的时间线不受影响；因果前沿按现有 `recordCausalFrontier` 更新。同行者无需 pending input——这不是集体移动，是「你们在场时时间过去了」。

### 4.6 旁白

不加东西。`FictionTimeAdvanced` 的 Claim 已渲染为「本次行动推进了 N 秒虚构时间」，审核已核对时间。绝对时钟的显示是 Viewer 的事，不在本合同内。

## 5. 触及面

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 线上 schema | `proposal-schema.ts`（`decision` 对象，[:1270](../../app/_runtime/lib/kp/vnext/proposal-schema.ts:1270) 附近） | `directSuccess` / `check` 加 `durationMicros` |
| 类型与校验 | `proposal-bundle.ts`、`proposal-filling-interface.ts`、`proposal-validator.ts` | 字段、pattern、§4.1 束内容规则的 KP 侧预检 |
| 数字修复 | `proposal-repair-plan.ts` | 无改动：`durationMicros` 路径的原 token 规则已通用（[:241](../../app/_runtime/lib/kp/vnext/proposal-repair-plan.ts:241)） |
| 指引 | `proposal-guidance.ts`（`planRuling`）、`proposal-capabilities.ts`（`social` 描述） | 加 §4.2 锚点与规则；删「即时口头交谈」 |
| lowering | `proposal-bundle-lowering.ts` | 带入束级计划；三类 read-set 补 `character-timeline:` |
| Rules 类型 | `world-interaction-model.ts` | `AtomicWorldInteractionStepsPlan.durationMicros`；解除 `Exclude` |
| Rules 执行 | `atomic-world-input.ts` / `world-interactions.ts` | 推进先于 step；§4.1 校验；`crossedDeadlines` 扫描 |
| Room | — | 无改动：`withDueTail` 已在提交后清算 |
| 合同版本 | `proposal-provider.ts` | parser v42；新增 `actionDuration: "shared-ruling-positive-microseconds-for-in-world-acts-v1"`；workflow hash 随之变，Room 绑定同步 |

无新模型调用，无 ordinal 变化，无预算重分。

## 6. 代表性矩阵

| # | 情形 | 期望 |
| --- | --- | --- |
| 1 | round78 首句原样，KP 填 `durationMicros:"20000000"` | `branch:main` 0 → 20000000；Claim 出现；replay `exactState` |
| 2 | 同场景另一玩家已冻结上下文，本行动推进 10 秒 | 对方提交时 `character-timeline:` 绑定过期 → 重新冻结；无静默错位 |
| 3 | 交谈 60 秒，NPC 计划 due 在第 30 秒 | 推进 60 秒；`crossedDeadlines=[plan]`；`withDueTail` 同请求内执行该计划，先于本行动旁白发布 |
| 4 | 纯创作束填 `"5000000"`；含 `observe` 的束填 `"0"` | 两者均 `invalidRulesInput`，诊断指向 `decision.durationMicros` |
| 5 | `passTime` / `knowledgeReview` / `inWorldRefusal` | 逐字节不变 |
| 6 | 模型把 `20000000` 写成数字 token | 现有一次同值转字符串修复，不新增路径 |
| 7 | 预算：行动 4 次调用 + 尾随 NPC 到期 | 尾随受现有每 HTTP 5 次预算约束；不足则延期、下一行动被挡；不提高上限 |
| 8 | 分头场景的玩家 | 其时间线 `nowMicros` 不变 |

## 7. 验收

本地：`tests/kp-vnext-action-duration.test.mjs`（线上 → lowering → 束级计划）、Rules 定向（推进先于结果、§4.1 两向拒绝、跨越扫描、双时间线）、Room 定向（提交后尾随到期）。stub 全部经 `assertDeepSeekStrictToolModelInput`。

真实：round79，同一三句。首句 `nowMicros > 0` 是本合同的直接证据；`consequences` 是否非空**不是**本合同的验收项（那是第 2 层）。场景 gate 每句记录 `nowMicros` 增量，与声明值核对。

## 8. 不做的事

- 不给普通行动建 Activity（甲），直到 `crossedDeadlines` 有真实频率。
- 不改承诺记录、不改计划形成、不碰 `formActorPlan` 的依据规则。
- 不显示绝对时钟。
- 不为 NPC 的行动定时长——NPC 行动仍走计划/Activity。

## 9. 这之上的两层（各自另立合同，此处只画形状）

**第 2 层，承诺记录**：`social.consequences` 的 promise 槽位与指引都在，模型三批留空。要改的是指引的语气——从「允许」改成「NPC 承诺未来行为时必须记录」——以及一次真实批次看它是否生效。

**第 3 层，承诺成计划**：`formActorPlan` 只认行动前 `state` 里的依据，同束刚创建的承诺引不到。最短的闭合不是让模型多选一个类型，而是让 promise 自带可选的 `dueMicros`，Rules 在同一根内、`PromiseMade` fold 之后从承诺派生定时计划——那时依据已在累加状态里。这样 round78 那句「过半刻，我敲一记账台」在第一句就能同时成为 promise 与 plan，到期时刻按本合同推进的时钟自然到来。

三层都通了，SPEC 0001 §11 那句「NPC 在无人干预时的下一步行动」才第一次有机械支撑。

## 10. 修订（2026-09-08）：时长是档位，不是微秒

round79 填 30 秒、round80 填 12 秒——同一句「半分钟」两次估计不同。用户裁定：这种精度不是 KP 值得做的判断，时间只需要一个大概。于是：

- **线上字段** `decision.duration`，枚举 `none | 5min | 10min | 30min | 1h | halfDay`。`none` 是纯创作束的显式零，仍然必须写。
- **域内字段**不变，仍是 `durationMicros`，但校验器只接受六个档位对应的微秒（0 / 300000000 / 600000000 / 1800000000 / 3600000000 / 43200000000）。codec 双向映射：解码把档位换成微秒，编码把微秒换回档位；未知档位原样透传给域校验器诊断。lowering、Rules、`executionCosts.fictionTime`、事件 payload 一概不动。
- **指引**把锚点表换成档位表：一句问答、一眼、取放物品、一段简短交谈 = 5min；仔细检查一处、搜查一个房间、较长交谈 = 10min；细致搜查、一场谈判 = 30min；长途走动、大范围搜索 = 1h；跨越大半天 = halfDay；拿不准取短。parser v44。
- **副产品**：半分钟的约定落在 5min 档内，行动结束时已过，KP 该在同一段回应里就地兑现——这是[等待旁白回执](vnext-wait-narration-validation.md)里上下文路线的前提之一。

**档位暴露的一个缺口**（另立合同）：一次行动至少 5 分钟，比很多 Activity（例如 60 秒的通行）都长。行动跨过到期点时 Rules 只记录 `crossedDeadlines`、放行动提交；若跨过期间那条 Activity 的冻结完成变得不合法（通行途中通道被关），下一次输入会被到期优先结算以「完成不再合法」拒绝，之后这条时间线上每一次输入都同样被拒。结算应当中断这条 Activity，而不是堵住时间线。`tests/kp-vnext-dynamic-locations.test.mjs` 里留了一条 todo 用例记它。

### 10.1 遭遇内外（2026-09-08）

用户指出档位可能让法术持续时间和轮次对不上。核对结果：**战斗外没有问题**——每次 `FictionTimeAdvanced` 之后序列器同步结算已到期的定时效果，结算用效果自己的到期瞬间；**战斗内有**——遭遇里时钟只由 `RoundEnded` 每轮推进 6 秒，定时效果按微秒到期、战斗效果按轮次锚点到期，而 vnext-2 的 social / observe / worldInteraction 在遭遇中可达且原本会照样花档位：场景时钟跳 300 秒，定时效果提前约 50 轮到期，轮次锚点的效果不动。档位之前模型可填 6 秒碰巧对齐，再之前角色行动不花时间，所以这是档位把潜在问题变成了必然。

规则：**遭遇进行中，行动的时间归回合经济管，不归档位。**

- KP 在遭遇中填 `none`（指引与 schema 描述都写明）。`none` 的含义因此扩为：纯创作束，或行动者在活动的遭遇里。
- lowering：`activeEncounter(state, actor)` 时任何非零档位被拒，`bundle2:duration-forbidden-in-encounter`（与同族诊断一样不可窄修订）；`none` 正常走原子路径，不生成 `fictionTime` 成本。
- Rules：`applyCompiledAtomicWorldInteractionPlan` 在遭遇中拒绝任何 `fictionTime` 执行成本（"An act inside an Encounter spends turns, not a frozen duration."），不管计划是谁产出的。
- parser v45。

已知未闭合：冻结上下文里没有显式的「你正在遭遇中」标记——KP 只能从行动者记录里的战斗回合预算和场景记录的 `combatScene` 推断。填错只能硬拒，不能修订。给上下文加一个显式遭遇标记是另一条小合同。

### 10.2 跨过到期点后：完成不再合法的 Activity 结算为中断（2026-09-08）

§10 记的那个缺口关掉了。规则：**到期的普通 Activity 若其冻结完成已不合法，就在到期结算时中断，而不是堵住时间线。**

- `prepareActivityCompletion` 对「完成草稿无法生成」的情况不再返回拒绝，而是返回 `illegal` 及一条 `ActivityInterrupted`（cause `{ kind: "completionNoLongerLegal" }`，`scene-observers` 可见）。
- `completeActivity`（Room 到期子根的规范输入）和 `settleDueActivityBeforeInput`（下一次输入前的到期优先结算）都把它提交为中断；后者的 `mechanicalResult` 多一个 `settledAs: "interrupted"`，`retryOriginalIntent` 照旧为 true，原输入随后重试即可提交。
- 章节转换里显式要求「完成」的分支保持拒绝——那是明确要完成，不是到期结算。
- Claims：普通 Activity 的这种中断有自己的 `mechanicalOutcome`（`activityInterrupted`；通行：「原定路线已经无法走完」），否则闭合覆盖会把这条事件判成未映射。

验证：`kp-vnext-dynamic-locations` 的 todo 变成真用例——60 秒通行，5 分钟的关门行动跨过到期点（`crossedDeadlines` 记录到该 Activity），随后的等待触发结算：中断、行动者留在原地、事件挂在 `activity-due:` 子根下、原输入无 Receipt，同一等待再发即提交，replay 一致。

