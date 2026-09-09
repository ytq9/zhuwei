# 其他功能填写能力：有界真实测试

日期：2026-09-08。用户要求“再测试一下其他功能的填表能力”。本轮只测试、定位和保存证据，没有修改生产代码或修复本轮发现的返回状态问题。

## 结果

| 功能 | 模型填写 | 首次执行与公开结果 | 重复提交 |
| --- | --- | --- | --- |
| 知识回顾 | 通过。`knowledgeReview` 仅填 `kind/inquiry/scope/knowledgeRefs`，无修订 | `committed/published`；只产生 `KnowledgeReviewed`，时间、HP、资源和物品不变 | 0 新调用；状态、事件、随机日志、Receipt、Delivery 和返回状态一致 |
| 等待一分钟 | 通过。`passTime` 仅填 `kind/durationMicros`，值为 `60000000`，无修订 | `committed/published`；活动开始、准确推进 60 秒、活动完成，正文说明一分钟过去 | 0 新调用，状态/事件/随机日志/Receipt/Delivery 一致；但 `narration` 从 `published` 变成 `notApplicable`，此项失败 |
| 放置一份口粮 | 未执行 | 触发首个异常停批 | 未执行 |
| 环顾大厅 | 未执行 | 触发首个异常停批 | 未执行 |
| 向莉安询问铜钥来源 | 未执行 | 触发首个异常停批 | 未执行 |

两类已测表单均一次填写通过，没有再多填 `basisRefs/intent/method` 等不属于所选分支的字段。等待的异常发生在服务器重复请求结果汇总处，不是填写失败。不得把本批写成五类通过、完整游玩通过或稳定性提升。

## 冻结与执行

基线为 `cloudflare / 5d4c1512488da9e134314589344c613a60aaf26a` 加当时在途修改。343 个源码/配置/工具文件冻结至 `/tmp/zhuwei-other-filling-live-20260908/source`，清单 SHA256：`bcda78cd4a08c8c3ed4d3536321126987475e347276255ff196f746fdaeb74d4`。运行时代码起止不变；不将主目录随后并行修改计作本批验收。

预定五类，每类使用正常注册、建卡、开局的新房间和真实默认 `deepseek-v4-flash`；先校验前一例结果才允许创建后一例。上限为每例 5 次、全批 25 次调用/¥6.25；首次明确异常后停止剩余案例，不改模型、不重采样、不改原始响应、不额外回答待决或恢复旁白。本批实际创建并测试两个房间。

实际请求：

1. “我只回顾自己已经掌握的全部信息，帮我整理一下，不进行新的观察或调查。”
2. “我留在原地安静等待一分钟，不做其他事情。”

两个请求均实际经历选择、填写、Rules/Room 提交、旁白生成、审核和公开。每例 4 次物理调用，其中两次提案调用的请求/响应与 Room 保存日志逐值一致；两次旁白调用的原始 `body`、审核正文及发布正文逐字一致，审核项通过，人工核对未发现超出本次已有知识/等待结果的实质变化。

知识回顾生成 1 个事件/Receipt，重放 `exactState=true`。等待生成 3 个独立阶段的事件/Receipt：`ActivityStarted / FictionTimeAdvanced / ActivityCompleted`；完整状态重放同样 `exactState=true`。玩家原请求的 Receipt 没有被活动完成的 Receipt 替换。

## 等待重复返回的定位

首次与重复请求使用同一 submission，实际回执对比为：

```json
{
  "first": { "action": "committed", "narration": "published" },
  "duplicate": { "action": "committed", "narration": "notApplicable" },
  "newModelCalls": 0,
  "sameAuthorityState": true,
  "sameEvents": true,
  "sameRandomnessJournal": true,
  "sameReceipt": true,
  "sameDelivery": true
}
```

原始正文仍是“一分钟过去了，你留在原地安静等待，没有其他事情发生。”；本批没有消息丢失、再次推进时间或重复扣资源的证据。

冻结源码和真实持久化记录定位出完整路径：

- 原等待的 `result_json` 只保存父结果，字段为 `kind/receipt/kpProjection/deliveryPlan`，没有 `dueOutcomes`；父计划没有旁白受众。推进时间的计划也没有受众，活动完成计划有一个受众及实际旁白。
- `room/durable-object.ts` 的 `withDueTail` 首次处理待完成工作后临时附加 `dueOutcomes`；重复 `prepare` 读取原保存结果，此时无待完成工作，提前返回父结果。
- `room/action.ts` 的 `publishCommittedOutcome` 首次把子活动发布状态合入 `audienceNarrations`；重复请求缺少子结果，且当前 Delivery 属于子 Receipt。`statefulOutcome` 因而推导为 `notApplicable`。

修复点是让首次与重复请求都从已保存的因果关联和已发布子活动记录生成同一份 Viewer 状态汇总，保留原玩家 Receipt。不能硬编码 `published`、借其他行动的最新 Delivery 判断，也不能重新执行等待或重新生成旁白。本轮未实施此修复。

## 检查、用量与边界

测试目录内 `cases/<id>/runner.mjs` 的 `preflight/setup/action/duplicate/decide` 驱动正常本地接口与独立核验，`replay.mjs` 经实际 Rules 公共重放；`closeout/inspect.py`、`wait-duplicate-diagnosis.json`、`narration-verification.json` 保存精确差异与正文绑定。所有真实原稿保存在 `evidence/precision-private/`，凭据只在本机私有文件中。

离线测试器先后修正了共享捕获目录的访问、终止表单在 `terminalKinds` 中的分类、公开资源包含库存派生余额的核对方式。旧脚本/清单哈希与变更理由保存于 `closeout/harness-adjustments.json` 及对应旧副本。修正不涉及模型请求、响应、运行时代码或新调用；未通过核验时后续 setup/action 被挡在 HTTP 前。不能把这些测试器问题算成模型填表失败。

正常 setup/action、本地 migration、知识回顾 duplicate、两例最终分类、两例重放、正文核对及最终源码检查均 exit 0；等待 duplicate 命令明确 exit 1，并保存 `sameOutcome=false`。知识回顾分类为 passed，等待分类为 failed，其填写与首次执行的通过证据单独保留。没有运行全量测试、构建、远端 migration、部署、push 或数据退役。

实际 8 次物理调用与服务端计数一致，91,714 输入/815 输出 tokens，缓存命中 9,984；按保存的当晚官方价格和完整 usage 估算 ¥0.1267617，非账单实扣证明。诊断与核验新增调用为 0。game/capture 两个自有服务及 4330/4331 端口已关闭。

结构化结果见[本批真实证据](vnext-other-filling-live-evidence.json)。前一轮施法填写修复见[填写边界验收](vnext-model-filling-surface-validation.md)。未测三类、多 Viewer、错误修订恢复、统计可靠性及生产使用继续保留为未覆盖范围。
