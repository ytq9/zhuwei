# Round90：一份带承诺的完整草稿，倒在 `retryChange: "none"`

2026-09-08 下午，源码 `5f557f3`（parser v50：空对象 arguments 走一次重发）。场景同 round82–89。只发了第一句，**2 次调用后停批**，¥0.148854。要验的空对象重发没有被碰到。

## 发生了什么

填写是一份完整的三张表：directSuccess、`duration: "5min"`；social 步骤一行；结果一行带 `promise`——`due: "1h"`，`trace: "账台上摆着一份新抄的备案副本，墨迹已经干透。"`，`authorityRefs: [瓦罗]`；`responseBasis` 三个引用全在枚举里。瓦罗本来会承诺一小时内送副本到账台——round88 那条链的第二个样本。

倒在一个拼写：`retryChange: "none"`（裸字符串），schema 要的是 `{kind:"none"}`。同一份草稿里 `addressedThreadRef` 也写成裸 `"none"`，那一个被 round79 之后的规则解码成了哨兵——因为它是可空**引用**字段；`retryChange` 是可空**对象**字段，同样的 `{kind:"none"}` 写法，却不在那张名单上。`TYPE_MISMATCH`，不可修订，`PROPOSAL_FORM_INVALID`。

## 判断

round79 的论证对 `retryChange` 同样成立：引用语法保留了 `none` 这个词，一个可空字段上的裸 `"none"` 只能是哨兵。规则应当是「任何线上以 `{kind:"none"}` 表示空的字段，都接受裸 `"none"`」，而不是按字段名列名单。修复见 refactor-log。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 0。323 项源码起止 `allEqual=true`。[机器证据](vnext-round90-live-evidence.json)。私有证据在 `/tmp/zhuwei-round90-npc-preparation/evidence`。
