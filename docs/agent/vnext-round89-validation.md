# Round89：前两句零修订，第三句又是空的 `{}`

2026-09-08 下午，源码 `8183fad`（运行时与 `b7c682f` 相同；批次脚本每 HTTP 上限改回 7）。场景同 round82–88。三句都发了：前两句提交并发布，第三句在填写调用上拿到空对象。**10 次调用，¥0.479583。**

## 首句与第二句

各 4 次调用，零修订。`responseBasis` 四个引用全在平枚举里，其中 `"playerExpression"` 第一次以枚举成员的字符串形式被模型用上——round86 之后的形状在真实模型上成立。瓦罗这次没有承诺送到账台：原件不离手，「你若肯等一盏茶的工夫，我当场替你抄好」——同一句话，KP 的第三种世界选择（round85 带条件还价、round86 直接拒绝、round88 承诺、round89 当场抄）。`consequences: []`，没有计划。第二句等待一个半小时：passTime 5400000000，旁白「你在厅里等待了整整一个半小时，时间已经过去。」，observe 第六次被丢弃。

## 第三句：第二个空 `{}`

offer 选了 `observe`；填写调用返回 `submit_kp_proposal_bundle` 的 arguments `{}`，25 个输出 token，`finish_reason: tool_calls`。与 round87 一模一样，但这次是 observe 单选的 schema（17242 字节）——里面根本没有 `responseBasis` 槽位。所以空 `{}` 与 round86 之后的平枚举无关。

今天 round85 起 11 次填写调用里 2 次是空的（round87 社交、round89 观察），其余 9 次都是完整草稿；两次的 prompt cache 命中分别是 5120 和 1536，schema 大小正常，`max_tokens` 4000，thinking 关闭。看不出请求侧的共同点；这是模型侧在严格模式下仍会发生的一种输出——根上 `required` 三个字段一个都没有。

`{}` 是合法 JSON，按现在的规则是「解析成功的草稿」，走 `FIELD_MISSING`，不能未解析重发，于是整批停在这里。空对象里没有任何裁决内容，服务器不需要猜也不可能折叠什么——它和「不是 JSON」是同一类：没有草稿。修复：空对象 arguments 走一次未解析重发（同一份冻结上下文、只说「上一次是空的」、模型自己完整重述），见 refactor-log。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 14。323 项源码起止 `allEqual=true`。[机器证据](vnext-round89-live-evidence.json)。私有证据在 `/tmp/zhuwei-round89-npc-preparation/evidence`。

## 未覆盖

第三句的真实草稿（observe 单独成根、裁决 `basisRefs` 丢弃）；承诺链只有 round88 一例。
