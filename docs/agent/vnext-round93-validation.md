# Round93：相关性冻结上下文的第一句真实提交，回复旁白撞到本地 7 次上限

2026-09-09 晚（空闲时段），源码 `d18288a`（848bf25：冻结上下文按措辞相关性构造、模型视图去 hash、单字别名停用词；d18288a：类型依赖改软、持有知识目录完整正文分层）。场景同 round82–91。**首句提交并发布玩家根旁白，7 次调用，¥0.331725（按峰值计）；回复根旁白已生成但审核被批次工具的本地 7 次上限拦下，未发布；未发第二、三句。** 此前 round92 在 setup 的快照步骤停在已退役的 `authority_vnext_invocations` 表名上，0 次模型调用。

## 首句

请求体（`/tmp/zhuwei-round93-npc-preparation/evidence/round93-private/`）：

| 调用 | 工具 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| offer | offer_kp_proposal_bundle | 32,289 | 27,811 | 46 |
| 填写 | submit_kp_proposal_bundle（选 social） | 39,007 | 34,383 | 983 |
| NPC 工作选择 | select_npc_work_schema | — | 10,578 | 57 |
| NPC 工作填写 | submit（authorItem+materializeItem+inventoryOperation） | — | 22,787 | 653 |
| 玩家根旁白 / 审核 | json_object / review_frozen_narration | — | 1,900 / 3,085 | 247 / 168 |
| 回复根旁白 | json_object | — | 3,245 | 108 |
| 回复根审核 | 未发出：`LOCAL_MODEL_PROBE_LIMIT_EXHAUSTED` | — | — | — |

offer 上下文 39 条目：只有瓦罗一个决策快照（莉安、奈斯只保留可观察记录），3 条实物事实，8 条知识正文，知识目录没有未加载项（新房间全部知识来自模组）。真实/估算比 0.86–0.88，与 round91 一致。对照 round91 同句 offer 24,560 估算：本轮角色卡带完整装备与能力目录，模组开场准备的实物与知识也在，仍比改动前本地复现的 44,825 低。

世界结果：`ActivityStarted → FictionTimeAdvanced(300000000) → ActivityCompleted → SourceClaimCreated ×2 → KnowledgeAcquired ×2 → PromiseMade → PromiseTermsEstablished → NpcWorkProposed → WorldInteractionResolved`，11 条事件，stateVersion 11。瓦罗答应一小时内誊抄副本；NPC 工作在同一 HTTP 内选择并填写了副本的物品定义与实例（planned）。玩家知识 4→5，瓦罗 5→7。已发布旁白只说明「开始进行这项耗时活动；完成结果尚未出炉」，瓦罗的答复正文停在未审核状态。

## 为什么停

批次工具通过 `ZHUWEI_VNEXT_LOCAL_CALL_LIMIT=7` 给每次 HTTP 加本地上限（`room/server.ts` 只在本地开发读取该变量，生产没有上限）。本句需要 8 次：瓦罗同意后 NPC 工作立刻执行（2 次），再加玩家根与回复根各一次旁白与审核。第 8 次审核被拦下后，Room 把该根标为可恢复（`narrationRecovery: available, NARRATION_PROVIDER_TIMEOUT`）。跑批脚本随后拒绝了它自己的一次恢复请求：它把被拦下的空审核事件算成「遥测不一致」，在发出任何 HTTP 前抛出 `BATCH_BUDGET_EXCEEDED`。恢复能力本身没有被真实验证。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`。389 项源码起止 `allEqual=true`。[机器证据](vnext-round93-live-evidence.json)。私有证据在 `/tmp/zhuwei-round93-npc-preparation/evidence`。继续见 round94：本地上限提到 10，跑批脚本单独计数被拦事件。
