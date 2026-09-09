# Round98：空对象填写重发原请求后首句提交，等待句提交，第三句因批次时限未发

2026-09-09 晚（空闲时段），源码 `75ab7d6`（空对象填写改为重发原请求），场景同 round82–91，本地上限 10。**首句 7 次调用提交并发布（填写先回空对象，重发原填写请求后给出完整草稿），第二句 4 次调用提交并发布；第三句未发出——批次 20 分钟窗口在操作会话被限流暂停期间过期，runner 在任何 HTTP 之前抛 `BATCH_DEADLINE_RESERVE_EXCEEDED`，session 记录第三条 action 带 harness 错误、0 次模型调用。这是 harness 时限，不是产品故障。合计 11 次调用，204,015 / 1,869 tokens，¥0.628866（峰值计）。round99 在同一提交上重跑三句。**

## 首句（7 次调用，已提交）

| 调用 | 用途 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| 1 | offer（选 materializeObject + observe + social） | 32,294 | 28,292 | 55 |
| 2 | 填写 submit_kp_proposal_bundle → `{}` | 48,914 | 44,503 | 25 |
| 3 | 重发原填写请求 → 完整草稿（directSuccess，一步 social，无承诺） | 48,418 | 44,140 | 811 |
| 4 | 旁白：活动开始（对话耗时 5 分钟） | — | 1,920 | 104 |
| 5 | 审核 review_frozen_narration | — | 3,129 | 165 |
| 6 | 旁白：社交结果 | — | 2,986 | 165 |
| 7 | 审核 review_frozen_narration | — | 4,498 | 183 |

冻结上下文 39 条，仅 Varo 一份 NPC 决策快照。事件：ActivityStarted / FictionTimeAdvanced(300,000,000) / ActivityCompleted、SourceClaimCreated×2、KnowledgeAcquired×2、WorldInteractionResolved。公开结果：瓦罗确认所指盖印文书，追问替谁收、办什么用；没有承诺、没有计划。gate1：wait；`observed` 为 0 承诺 0 计划、时间 300,000,000 微秒，逐项对快照核过。

## 第二句（4 次调用，已提交）

| 调用 | 用途 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| 8 | offer（选 passTime） | 39,673 | 36,220 | 47 |
| 9 | 填写 → passTime | 35,159 | 33,112 | 58 |
| 10 | 旁白：timePassageCompleted 3600 秒 | — | 2,040 | 90 |
| 11 | 审核 | — | 3,175 | 166 |

这句没有点名任何 NPC，按相关性规则冻结了全部三位在场 NPC 的快照（lian、naes、varo），上下文 44 条；offer 比首句多约 7k，其中还含首句新增的两条知识与来源主张。时间 300,000,000 → 3,900,000,000 微秒，无活动、无到期工作。gate2：pending（首句没有计划可执行），coverage `waited-without-plan`。

## 第三句

未发。session `deadlineAt` 为 21:25:52（本地），第三次 `runner.mjs action` 于 23:28 在 `requireRemainingBudget` 抛 `BATCH_DEADLINE_RESERVE_EXCEEDED`，早于 `sendAction`；无 HTTP、无模型调用。原因是操作会话在 gate2 准备与第三句之间被限流暂停约两小时。按纪律保留原样，不改时限、不补发。

## 观察

1. **旁白矛盾（产品既有问题，与本轮改动无关）**：首句的活动开始旁白（公开消息 2，调用 4）写"瓦罗应下此事后，你便在厅中等待"，而它的材料只有"角色开始进行这项耗时活动；完成结果尚未结算"和 actorIntent；社交结果旁白（消息 3）是瓦罗反问、并未答应。审核（调用 5）五项全 pass 放行。权威状态没有任何承诺，矛盾只在已发布旁白里。按批次分类记一条 narrativeContradiction 观察，不改变本批"已提交"的结论。
2. 本轮最大请求是首句填写 48,914（三族 schema 30k 字节以上）；均在 58k 之内，真实/估算比 0.86–0.91。
3. 重发原请求这条路（round97 后加入）第一次在真实批次里走通：空对象后第二次填写直接给出可提交草稿。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`，stateVersion 11，11 事件。389 项源码起止 `allEqual=true`。[机器证据](vnext-round98-live-evidence.json)。私有证据在 `/tmp/zhuwei-round98-npc-preparation/evidence`。
