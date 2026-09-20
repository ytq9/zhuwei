# ADR 0035：vNext 提案请求体积进棘轮，只降不升

- 状态：已接受
- 日期：2026-09-20
- 依据：用户于 2026-09-20 在四个口径里裁定「进棘轮，只降不升」。
- 当前规则：[SPEC 0016 §7.2 Bundle 语义冻结与一次窄修复](../specs/0016-part-c-compound-actions-and-claims.md)
- 取代范围：不取代任何规则。[ADR 0034](./0034-remove-the-v5-private-form-proposal-path.md) 删除 V5 四道体积门后留下的离线缺口，由本决定补上。

## 背景

ADR 0034 删掉 `tools/run-kp-v3-eval.mjs` 时，连同删掉了它的四道体积门。那四道量的是 V5 提案请求的构成，在 vNext 上没有对应对象，删除本身没有问题。

运行时守卫仍在：`app/_runtime/lib/kp/vnext/invocation/assemble.ts` 对组装后的完整请求体执行 `VNEXT_PROPOSAL_BUDGET`，超出返回 `PROPOSAL_INPUT_BUDGET_EXCEEDED`，行动保持未提交。缺的是离线测量——没有任何东西在构建期报告 schema 又长了，只有真实玩家的请求撞到上限时才会发现。

2026-09-20 实测（固定开销 = 系统提示 + 该次选择加载的 tool schema，不含冻结 RequiredContext；预算 26,000 tokens）：

| 选择 | tokens | 占预算 | 剩给上下文 |
| --- | --- | --- | --- |
| social | 14,108 | 54.3% | 11,892 |
| social + formActorPlan | 15,175 | 58.4% | 10,825 |
| social + worldInteraction + materializeNpc | 22,426 | 86.3% | 3,574 |
| 全 16 能力 | 45,679 | 175.7% | 结构上不可能 |

## 决定

1. 每个选择一个数值条目进 `.gate-baseline.json` 的 `requestSize` 组，只降不升。**不设人定阈值**：按当前最差值定阈值等于把 54.3% 认证为可接受，按更低值定则是声明一道一出生就红的门。棘轮回答的是「这次改动有没有让它变差」，这正是需要的信号。
2. 条目按**选择**而不是总和记录，共 22 项：16 个单能力、5 个代表性补选并集、一个全量。总和会让成本在能力之间挪动而不被发现。
3. 测量工具 `tools/measure-vnext-proposal-request-size.mjs` 只打印和导出数值，不断言阈值。`tools/gate.mjs` 用子进程调用它（测量要 import TypeScript），无法测量时按既有约定对任何基线判红。
4. 不挂进任何 SPEC 的 `gates`：那个字段列的是测试文件，而这是棘轮指标。SPEC 0016 §7.2 是管调用额度与预算的条款，本指标守的是它。

## 后果

- `node tools/gate.mjs` 默认即测量，多约一秒。22 项全部持平时只打印一行汇总，只有变动的条目单独成行。
- 已验证的性质：单项增长使 `--check` 退出 1 并显示「✗ 变差」；`--update` 对数值取 `Math.min`，把基线人为调低后再 `--update` 不会被抬回实测值。
- 修掉一个既有显示缺陷：数值指标回归时套用了数组措辞「✗ 新增 ? 项」。`spec.errors` 与 `docs.brokenLinks` 回归时同样受影响，现在都显示「✗ 变差」。
- **不解决的问题**：`conservative-v1` 计数器从未对真实 provider 校准，`budget.ts` 自己写明这属于部署资格且尚未进行。棘轮锁住的是「按当前估算口径不再变差」，不是「26,000 这个数字是对的」。校准需要单独授权，不在本决定内。
- `social + worldInteraction + materializeNpc` 只剩 3,574 tokens 装冻结上下文这件事，本决定不修复，只让它此后不能再恶化。
