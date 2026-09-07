# Round76：被我们自己的传输契约挡住，提案调用从未发出

2026-09-07，源码 `df864b0`（parser `kp-vnext2-proposal-parser-v41`）。正常注册建卡、初态核对通过（瓦罗在场，0 预置计划/活动/事件，stateVersion 0）。场景仍是 round70 的三意图逐字复制。

**只发送了第一句，且它在第 2 次调用处失败。这不是模型失败，是本次源码改动自身的缺陷。**

## 发生了什么

ordinal 1（类型选择）正常返回，21,215 输入 / 50 输出。ordinal 2（提案）**从未发出 HTTP**：

`assertDeepSeekStrictToolModelInput` 要求严格工具面**恰好一个工具**（`single-function-tool-required`），而本次改动让提案调用同时提供 `submit_kp_proposal_bundle` 与 `offer_kp_proposal_bundle` 两个工具。断言抛出 `DeepSeekStrictToolConfigurationError`。

**服务端日志里的 `providerStatus: 422` 会骗人**：422 是 `DeepSeekStrictToolConfigurationError.status` 的本地常量，不是 DeepSeek 的响应。请求根本没离开本机，ordinal 2 也没有任何 usage。

0 提交、0 事件、0 Receipt，stateVersion 保持 0。gate1 记 `transportFailure` 停批，第二三句未发送。

## 追加探针：那条契约是我们的，不是供应商的

停批后做了一次一调用的有界探针，直接问真实端点同一个问题：

```
POST https://api.deepseek.com/beta/chat/completions
deepseek-v4-flash，两个 strict:true 工具，tool_choice: "required"，parallel_tool_calls: false
```

结果 **HTTP 200**，模型选了第二个工具并正确填写（`finish_reason: tool_calls`，397 输入 / 44 输出）。

所以「恰好一个工具」是我们自己写的约束，供应商并不要求，而且它对这个用途是错的。`deepseek-strict-tool.ts` 声称校验的是「documented DeepSeek strict-tool beta dialect」，但这一条没有对应的供应商行为支撑。

## 一条走进死胡同的绕法，记下来免得重走

拿到探针结果之前，我曾把补选改成放进 submit 自己的 schema —— 作为一个只在可补选时出现的 terminal 变体。它撞上了架构：`proposalFillingSchema` 会按 `selectedTerminalKinds` 过滤 terminal 变体，而补选是**传输信号，不是被选中的终结表单**，所以被过滤掉了。要让它通过就得把信号硬塞进一个不为它设计的过滤器。

探针证明双工具可行后，这条绕法整体撤回（`git checkout` 回到 `df864b0` 的双工具设计），只改传输断言。

## 修改

`app/_runtime/lib/kp/deepseek.ts`：工具面允许 1 个或 2 个，并新增工具名唯一性检查（两个工具必须是两个可区分的选择，重名会让模型的选择不可读）。注释里写明这是 2026-09-07 对真实端点验证过的，再宽的形状仍然拒绝。

## 成本

2 次计数调用，实际只有 1 次到达 API（21,215 输入 / 50 输出）。ordinal 2 无 usage，按保守上限计费，所以 **¥0.311823** 反而高于 round75 四次真实调用的 ¥0.162933。上限 ¥5。探针另计 397 输入 / 44 输出。

## 两项本地改动的真实覆盖

- **完整填写边界前移**：未验到。ordinal 1 确实在新提示词下做了选择，但提案调用没到达 API，无法判断组合是否因此改善。
- **一次补选**：未验到，而且**按当时的形态根本不可能验到** —— 传输层拒绝了它需要的 surface。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，`lsof` 复核 4320/4321 无监听。replay `pinnedProfilesMatch=true`、`exactState=true`、stateVersion 0、事件 0。321 项源码起止 `allEqual=true`，分支与 HEAD 未变，初始 manifest `e809539eabbdde0ad1375f34d00bfdfc70c8f5a138d6d33491009df01fe5ccbc`。

准备包另有一处过时断言被更新：`budget-preflight.mjs` 钉着旧 callPolicy，已改为当前的 `selections1/selectionAmendments1/proposals1/terminalMaximumTotal3/stepCorrections1/stepMaximumTotal4`。同时记入一笔预算账：每 HTTP 上限仍是 5 次调用，无补选时一次行动用 4 次（选择+提案+旁白+审核），有补选正好 5 次；补选后若还需修订或重发就会要第 6 次并在绑定前被拒。这是本批的既定行为，上限不上调。

[机器证据](vnext-round76-live-evidence.json)。私有证据在 `/tmp/zhuwei-round76-npc-preparation/evidence`。

## 未覆盖

第二三句未发送；两项本地改动仍无真实模型证据；round70/72/73/74/75 的结论不因本批改变。传输断言放宽后需要另开批次重验。
