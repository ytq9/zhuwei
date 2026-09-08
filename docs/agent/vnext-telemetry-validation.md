# ActorPlan 调用与等待推进遥测修复

2026-09-08。源码起点：`cloudflare` / `e657162883b6cde129c405b4d0a2374dfce22094`。本地 Bug 修复与非战斗活动实现一同纳入本次提交；本遥测修复本身不改变提案、Rules、等待或观察的产品行为。

## 症状与根因

1. round88 的 NPC 到期决策实际调用了模型，但没有 invocation 遥测行，批次 meter 无法取得这次调用的 usage。`commitDueActorPlanWork` 保存调用 journal 并通过 `ActorPlanTransportCapability` 出站，却没有调用现有遥测构造器。
2. 等待实际推进了虚构时间，但公共 `room.authority.commit.completed` 只覆盖“开始等待”。实际分段推进由持久化 due-work 子根提交，不经过该公共日志包装，因此等待增量与到期数未记录。

## 修复与直接消费者

- `app/_runtime/lib/room/durable-object.ts`：NPC 决策的实际调用分支复用 `usageFrom` 与 `buildModelInvocationTelemetryEvent`，发出 `room.model.invocation.completed`，`modelInvocationPurpose=actorPlan`。响应带 usage 时记录实际 tokens；已派发但结果未知时记录 `modelTransient`，不补造 usage。调用前预算拒绝不计一次调用，已保存响应恢复不重复记录。
- 同一文件：时间推进子根的事务提交成功后，按本次 `FictionTimeAdvanced` 事件汇总实际增量，复用 Rules 的 `scheduledDeadlinesWithin` 统计本段到达的既有期限，发出 `room.time-passage.advanced`。普通等待也记录正增量；零增量、缓存回执、恢复与重复请求不新增推进记录。故障停在到期点时只记录已过去的部分。
- 两种记录都经过已有字段白名单，身份与根关联使用 hash，不带 Prompt、响应原文、NPC 私有知识或到期对象引用。遥测异常不会改变调用结果或已提交状态；日志不是权威事件，也不参与 replay。
- 等待采用独立事件名，公共提交日志仍表示原公共操作，避免把内部推进计入公共操作 SLO 样本。此处的 `crossedDeadlineCount` 是本段 `(now, now + duration]` 内期限数，不证明 NPC 决策执行成功，也不表示普通行动发生了中途打断。
- 直接消费者：两份修改的 Room 测试与既有结构化遥测白名单/脱敏测试。round91 准备包的 meter 已识别 `room.model.invocation.completed` 和 `modelInputTokens/modelOutputTokens`，无需为第一处修复改变计量格式。

## 实际验证

ActorPlan：修复前 exit 1，3 项均缺日志；修复后 exit 0，3 通过、12 跳过。覆盖成功 usage、保存响应后驱逐恢复、派发后失联、预算拦截及后续实际派发。

```sh
npx vitest run tests/kp-vnext-actor-plan-due-room.test.ts -t 'ActorPlan telemetry'
```

既有遥测格式、白名单与脱敏消费者：exit 0，11/11。

```sh
npx tsx --test tests/structured-telemetry-v2.test.mjs tests/structured-telemetry-v3.test.mjs
```

等待：修复前 exit 1，3 项均缺日志；修复后 exit 0，3 通过、6 跳过。覆盖普通 17 秒等待、60 秒跨 NPC 到期分成 2 秒/58 秒、故障停在第 2 秒及重复请求。预期故障注入会打印 `ACTOR_PLAN_DECISION_TRANSPORT_FAILED`，该用例和 Vitest 均通过。

```sh
npx vitest run tests/kp-vnext-time-passage-room.test.ts -t 'a plain wait|a one minute wait|a failed due NPC decision'
```

首次尝试运行 ActorPlan 文件中的 `a real time commit|a dispatched NPC request|a shared one-call HTTP budget` 三项时，均在 NPC 调用前的玩家提案路径失败（exit 1），未复现遥测症状。随后改为从已持久化的到期队列，经真实 DO/RPC 路径定位 NPC 调用；没有修改原三项的预期来制造通过。本次没有重做 `81c3b1e` 全组基线对比，也不宣称这份 ActorPlan 文件全绿。

没有改变共享类型、公共签名或 DTO，未运行 typecheck；未运行全套测试、全项目 Lint、构建或真实模型批次。

## 后续验证与未覆盖范围

- 下一批从已关闭批次克隆新包，保留历史包不变。ActorPlan usage 以新批次实际响应和日志核对；缺 usage 的响应仍保持未知，不回填或改判 round88 的费用。
- 新批次提取 `room.time-passage.advanced` 的 `rootActionHash`、`receiptHash`、`eventRange`、`fictionTimeMicros` 与 `crossedDeadlineCount`，逐段对照权威事件和本次行动增量；不要将“开始等待”的公共日志空值解释为未推进。
- 本次仅有受控模型的本地证据；尚无修复后真实 DeepSeek usage 或非零到期数的日志样本。日志为尽力记录，不承诺进程硬崩溃时零丢失；权威 journal、事件及回执仍用于精确核验。
- 此遥测补丁不实现活动通知或控制权行为。后续用户批准的非战斗活动能力已另行实现并定向验证，见[活动回执](vnext-activity-attention-validation.md)，不合并两组证据；承诺 fulfilled/broken 生命周期差异仍独立保留。
