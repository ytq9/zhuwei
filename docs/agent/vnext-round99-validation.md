# Round99：承诺 delivery 多写 kind，诊断只指到 terms，修订猜错

2026-09-09 深夜（空闲时段），源码 `75ab7d6`（与 round98 相同；为补 round98 未发的第三句而开），场景同 round82–91，本地上限 10。**首句 3 次调用后 `PROPOSAL_REPAIR_EXHAUSTED / needsKp`，0 事件，¥0.309249（峰值计）；未发第二、三句。**

## 首句

| 调用 | 用途 | 估算输入 | 真实 prompt tokens | 输出 |
| --- | --- | --- | --- | --- |
| 1 | offer（选 social） | 32,294 | 28,083 | 46 |
| 2 | 填写 → 完整草稿（directSuccess，一步 social，一条承诺） | 39,518 | 35,206 | 1,136 |
| 3 | 修订 correct_kp_proposal_bundle（patch 一处） | 42,180 | 35,846 | 134 |

## 为什么停

草稿里瓦罗答应誊抄副本，承诺 `terms.delivery` 写成 `{kind:"scene", destinationKind:"scene", sourceRef:<文书条目>, itemRef:"none", quantity:1, destinationRef:"wake"}`：工具 schema 的已填 delivery 分支恰有五个字段（additionalProperties=false），模型多写了 `kind`，DeepSeek 严格模式没有强制 anyOf。服务端 `socialConsequenceConform` 用裸谓词调 `promiseTermsConform`，嵌套失败被压成一条 `VALUE_INVALID social:field-contract`，路径只到 `results/0/newPromises/0/terms`，actual 是整个 terms 对象。模型据此把 `delivery.kind` 改成 `"none"`（仍是多余字段），第二次评估同一诊断，额度用尽。

草稿其余部分都合法：主体 [瓦罗、文书条目、玩家]、交付 sourceRef/destinationRef、承诺对象、授权都在准入集合内；`itemRef:"none"` 字符串解码时已按 `{kind:'none'}` 哨兵读成 null。若诊断写到 `terms/delivery/kind` 并列出允许字段，一条 `remove` 补丁即可。

这正是 round94 时定下的原则：诊断必须带字段路径。修复见 refactor-log 同日条目（`promiseTermsShapeConform` 逐字段定位；schema 描述明确 `{kind:'none'}` 与五字段），由 round100 验证。

## 收尾

stop 闸门记为 `formatFailure`。`services.py shutdown` 两角色 `verifiedAbsent=true`。replay `exactState=true`，0 事件。389 项源码起止 `allEqual=true`。[机器证据](vnext-round99-live-evidence.json)。私有证据在 `/tmp/zhuwei-round99-npc-preparation/evidence`。
