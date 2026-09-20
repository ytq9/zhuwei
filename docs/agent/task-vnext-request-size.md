# 任务：vNext 提案请求体积没有离线门

**2026-09-20 已裁定并实施**：用户选「进棘轮，只降不升」，见 [ADR 0035](../adr/0035-ratchet-the-vnext-proposal-request-size.md)。22 项选择的固定开销已记入 `.gate-baseline.json` 的 `requestSize`，`node tools/gate.mjs` 默认测量。

本文件保留为那批实测数字和未决的校准问题的记录。

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

## 已裁定

用户选了棘轮而不是人定阈值。理由记在 ADR 0035：按当前最差值定阈值等于把 social 的 54.3% 认证为可接受，按更低值定则是声明一道一出生就红的门。

条目按**选择**记录（16 单能力 + 5 个补选并集 + 全量 = 22 项），不是总和——否则成本在能力之间挪动不会被发现。

已验证：单项增长让 `--check` 退出 1；把基线人为调低后 `--update` 不会抬回实测值。

## 仍未裁定：计数器校准

`conservative-v1` 从未对真实 provider 校准过，`budget.ts` 自己写明这属于部署资格且尚未进行。棘轮锁住的是「按当前估算口径不再变差」，不是「26,000 这个数字是对的」。校准要真实 provider 调用，按 `AGENTS.md` 需要单独授权。

`social + worldInteraction + materializeNpc` 只剩 3,574 tokens 装冻结上下文，这件事棘轮不修复，只保证不再恶化。要不要主动缩 schema 是另一个决定。

## 不要做的事

- 不要为了让棘轮变绿而抬高 `VNEXT_PROPOSAL_BUDGET`。用户的既有指示是**只降不升**：遇到 `PROPOSAL_INPUT_BUDGET_EXCEEDED` 时按相关性缩上下文，不是放宽预算。
- 不要手改 `.gate-baseline.json` 的 `requestSize` 来容纳增长。`--update` 取 `Math.min`，本来就不接受抬高。
- 不要把本文件的数字当成当前事实——它们是 2026-09-20 那个源码状态的快照，以 `node tools/gate.mjs` 的实测为准。
