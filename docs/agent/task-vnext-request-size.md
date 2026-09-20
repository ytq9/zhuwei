# 任务：vNext 提案请求体积没有离线门

写给接手的会话。**需要用户先裁定要不要建门、按什么口径建**，然后才动手。

## 背景

[ADR 0034](../adr/0034-remove-the-v5-private-form-proposal-path.md) 删掉了 `tools/run-kp-v3-eval.mjs`，连同它的四道体积门。那四道量的是 V5 提案请求的构成，在 vNext 上没有对应对象，所以删除是对的。但 vNext 的请求体积从此没有任何离线测量。

## 运行时有守卫，离线没有

先说清楚现状，避免把问题说大：

`app/_runtime/lib/kp/vnext/invocation/assemble.ts` 对**组装后的完整请求体**（不只是上下文）执行预算门，超了返回 `PROPOSAL_INPUT_BUDGET_EXCEEDED`，行动保持未提交。`tests/kp/context/context-relevance.room.test.ts`、`tests/kp/provider/invocation.test.mjs` 和 `tests/kp/provider/provider.room.test.ts` 覆盖这条路径。

`VNEXT_PROPOSAL_BUDGET`（`invocation/budget.ts`）：

```
contextWindowTokens      32,000
completionReserveTokens   4,000
safetyMarginTokens        2,000
允许输入                 26,000 tokens
```

计数器 `conservative-v1` 刻意高估：CJK 每字 1 token，其余每 3 字符 1 token，外加 64 token 信封。该文件自己写明：「Calibrating it against a real provider — and revising both the counter ref and this profile hash when that happens — is deploy qualification and has not been done.」

**缺的是离线门**：没有任何东西在构建期告诉你 schema 又长了。只有真实玩家的请求撞到 26,000 上限时才会发现。

## 2026-09-20 的实测

固定开销 = 系统提示 + 该次选择加载的 tool schema，**不含**冻结 RequiredContext。

```
全量 SUBMIT schema   108,618 bytes
全量 OFFER  schema       807 bytes
```

单能力选择（共 16 个能力）：

| 能力 | 固定 tokens | 占 26,000 | 剩给上下文 |
| --- | --- | --- | --- |
| social | 14,108 | 54.3% | 11,892 |
| authorItem | 12,879 | 49.5% | 13,121 |
| authorHazard | 11,973 | 46.0% | 14,027 |
| materializeObject | 11,587 | 44.6% | 14,413 |
| authorAbility | 11,375 | 43.8% | 14,625 |
| materializeNpc | 10,918 | 42.0% | 15,082 |
| worldInteraction | 10,850 | 41.7% | 15,150 |
| inventoryOperation | 9,890 | 38.0% | 16,110 |
| observe | 9,518 | 36.6% | 16,482 |
| admitStoryFacts | 8,370 | 32.2% | 17,630 |
| materializeStory | 8,104 | 31.2% | 17,896 |
| materializeItem | 8,032 | 30.9% | 17,968 |
| formActorPlan | 7,694 | 29.6% | 18,306 |
| completeObject | 7,548 | 29.0% | 18,452 |
| commitNarrativeDetail | 7,173 | 27.6% | 18,827 |
| abilityOperation | 5,807 | 22.3% | 20,193 |

补选是**并集**（SPEC 0016 §7.2），所以真实成本要按组合看：

| 组合 | 固定 tokens | 占预算 | 剩给上下文 |
| --- | --- | --- | --- |
| social | 14,108 | 54.3% | 11,892 |
| social + formActorPlan | 15,175 | 58.4% | 10,825 |
| social + formActorPlan + commitNarrativeDetail | 15,767 | 60.6% | 10,233 |
| worldInteraction + materializeObject | 15,729 | 60.5% | 10,271 |
| **social + worldInteraction + materializeNpc** | **22,426** | **86.3%** | **3,574** |
| 全 16 能力 | 45,679 | 175.7% | — 结构上不可能 |

最后两行是要点。一次「和 NPC 说话、顺手物化一个人、碰一下世界」的行动，固定开销吃掉 86.3% 的预算，整个冻结 RequiredContext 只剩 3,574 tokens。按 `conservative-v1` 的 CJK 口径，那大约是三千多个汉字——要装下相关机械、动态定义、continuity 和先例。

复现：

```bash
npx tsx tools/measure-vnext-proposal-request-size.mjs
```

那个工具只打印，不断言任何阈值——口径未裁定之前不该有门。

## 需要裁定的

1. **要不要建离线门。** 不建也是一个选项：运行时守卫在，玩家撞上了会被挡住且行动不提交。代价是 schema 增长无人预警，等发现时已经在生产上。
2. **门量什么。** 三种口径：
   - (i) 每能力固定开销的绝对上限（例如 social 不得超过 15,000 tokens）——直接、但阈值要人定；
   - (ii) 固定开销占预算的比例上限（例如任何单能力不得超过 50%）——自动跟随预算调整；
   - (iii) 只记录不设阈值，把每次测量写进回执，靠 diff 发现增长——最弱，但不会误伤。
测量脚本已在 `tools/measure-vnext-proposal-request-size.mjs`，三种口径都能直接建在它上面。
3. **要不要一并处理校准。** `conservative-v1` 从未对真实 provider 校准过，预算数字本身的可信度有限。这属于部署资格，按 `AGENTS.md` 需要单独授权。

裁定后按「规格工作流」新建 ADR，并决定门挂在哪个 SPEC（0016 §7.2 管调用额度与预算，是最近的位置）。

## 不要做的事

- 不要为了让门变绿而抬高 `VNEXT_PROPOSAL_BUDGET`。用户的既有指示是**只降不升**：遇到 `PROPOSAL_INPUT_BUDGET_EXCEEDED` 时按相关性缩上下文，不是放宽预算。
- 不要把本文件的数字当成当前事实——它们是 2026-09-20 那个源码状态的快照。建门之前先重测。
