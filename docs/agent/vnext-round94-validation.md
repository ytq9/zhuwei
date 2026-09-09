# Round94：模型把物品定义写进承诺主体，一次修订后 needsKp

2026-09-09 晚（空闲时段），源码 `d18288a`，场景同 round82–91。跑批工具本地每次 HTTP 上限提到 10（生产无上限），跑批脚本把被上限拦下的空审核事件单独计数。**首句 3 次调用后 `PROPOSAL_REPAIR_EXHAUSTED / needsKp`，未提交，0 事件，¥0.315663（按峰值计）；未发第二、三句。**

## 首句

| 调用 | 工具 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| offer | offer_kp_proposal_bundle（选 social） | 32,289 | 27,941 | 46 |
| 填写 | submit_kp_proposal_bundle | 39,007 | 34,528 | 1,263 |
| 修订 | correct_kp_proposal_bundle（replaceDraft） | 41,627 | 35,132 | 1,231 |

offer 与填写的上下文构成和 round93 完全相同（39 条目，只有瓦罗一个决策快照，含第一份遗嘱的定义、实例与事实）。

## 为什么停

填写稿里瓦罗承诺抄副本，`newPromises[0].terms.subjectRefs` 写成 `["item-definition:module:black-oak-will:first-will", "npc:black-oak-will:varo"]`，`parts[0]` 同样引用该定义。Rules 预检 `social-interaction.ts` 的 `social:promise-terms-context-unavailable` 只接受 NPC 快照记录、已加载知识、对该 NPC 空间可见的引用或当前场景作为承诺主体，物品定义不在其中。round93 同一句的稿子用 `[瓦罗, 玩家]` 作主体，因此通过。

交给模型的诊断只有 `CONSTRAINT_CONFLICT social:promise-terms-context-unavailable`，`path: []`，没有 expected 集合；模型的完整替换稿改了措辞却原样保留了两处定义引用，第二次同样被拒。这是既有诊断精度与填写面宽度的缺口：`terms.subjectRefs` 的 schema 允许任意依据引用，而 Rules 的可接受集合更窄，且预检拒绝没有带回字段位置。与本次上下文相关性、依赖改软、知识分层无关。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`，0 事件。389 项源码起止 `allEqual=true`。[机器证据](vnext-round94-live-evidence.json)。私有证据在 `/tmp/zhuwei-round94-npc-preparation/evidence`。
