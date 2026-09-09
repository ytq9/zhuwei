# Round95：空对象填写与修订稿嵌套 JSON 多一个闭合符

2026-09-09 晚（空闲时段），源码 `7fdfd98`（承诺主体枚举与 lowering 路径诊断），场景同 round82–91，跑批工具本地上限 10。**首句 3 次调用后 `PROPOSAL_REPAIR_EXHAUSTED / needsKp`，0 事件，¥0.299181（峰值计）；未发第二、三句。**

## 首句

| 调用 | 工具 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| offer | offer_kp_proposal_bundle（选 social） | 32,289 | 27,725 | 46 |
| 填写 | submit_kp_proposal_bundle → `{}` | 39,422 | 34,727 | 25 |
| 修订 | correct_kp_proposal_bundle（replaceDraft） | 40,689 | 34,215 | 949 |

上下文与 round93/94 同构（39 条目，只有瓦罗一个快照）。

## 为什么停

填写调用返回空对象 `{}`（round87、89 见过的 strict 模式现象）。服务端按现行策略把它当作缺 decision 的可修订稿，诊断精确：`FIELD_MISSING`、`path: ["decision"]`。修订稿把承诺主体写成了原件实例 `item-entry:…`（本次枚举与说明生效），但 `revisionJson` 这个嵌套 JSON 字符串在 results 数组收尾前多了一个 `}`，`json:array-delimiter-expected`，修订额度已用尽，行动以 needsKp 结束。两处都是模型侧格式失误，与本次源码改动无关；round96 在同一源码上再取一个样本。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`，0 事件。389 项源码起止 `allEqual=true`。[机器证据](vnext-round95-live-evidence.json)。私有证据在 `/tmp/zhuwei-round95-npc-preparation/evidence`。
