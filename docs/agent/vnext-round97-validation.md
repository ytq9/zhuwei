# Round97：又一次空对象填写，修订稿嵌套 JSON 再次出错

2026-09-09 晚（空闲时段），源码 `ff27c1d`（社交后果各引用格枚举与路径预检），场景同 round82–91，本地上限 10。**首句 3 次调用后 `PROPOSAL_REPAIR_EXHAUSTED / needsKp`，0 事件，¥0.301665（峰值计）；未发第二、三句。**

## 首句

| 调用 | 工具 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| offer | offer_kp_proposal_bundle（选 social） | 32,294 | 28,180 | 46 |
| 填写 | submit_kp_proposal_bundle → `{}` | 39,518 | 35,320 | 25 |
| 修订 | correct_kp_proposal_bundle（replaceDraft） | 40,789 | 34,802 | 680 |

## 为什么停

与 round95 同形：填写返回空对象，服务端按缺 decision 给出精确诊断，修订稿必须把整份草稿写进 `revisionJson` 这个 JSON 字符串里，模型在 results 数组收尾后又写了一组 `steps`/`results`，`json:object-delimiter-expected`，额度用尽。今晚同一句话的三次填写里两次以空对象开头，两次修订都在嵌套 JSON 上失手。空对象本身不含草稿，让模型去“修订”一份空稿，等于要求它用转义字符串重写全稿，这条路比重发原请求脆弱得多。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`，0 事件。389 项源码起止 `allEqual=true`。[机器证据](vnext-round97-live-evidence.json)。私有证据在 `/tmp/zhuwei-round97-npc-preparation/evidence`。
