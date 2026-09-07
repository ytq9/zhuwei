# Round79：模型第一次填了时长，草稿却倒在一个与时长无关的引用拼写上

2026-09-07，源码 `759393d`（parser `kp-vnext2-proposal-parser-v42`，即[虚构时长合同](vnext-fiction-time-contract-proposal.md)的实现）。正常注册建卡，初态核对通过。场景仍是 round70 三意图；gate 在 round78 的基础上再加一项：复核者必须声明本次行动在行动者时间线上花了多少虚构时间，与快照双向核对。只发送了第一句。

## 结果

首句 **2 次调用后停批**：选择 `["social"]`，填写返回后被本地候选校验拒绝，`PROPOSAL_FORM_INVALID`，Room 记 `modelPermanent`，未提交、未发布，stateVersion 0。费用 ¥0.14826（无未知 usage）。

## 本合同的证据：一半有了

同一份被拒的草稿里，模型写的是：

```
"decision": { "kind": "directSuccess", "durationMicros": "30000000", … }
```

玩家的原话是「我想先用半分钟整理一下思路」。**模型第一次就把共享裁决的时长填成了 30 秒，不多不少。** 这是「KP 会填、且填得合理」这一半的第一份真实证据——只填在选择阶段看到过一次锚点的情况下。

另一半没有证据：草稿没有进 Rules，`nowMicros` 仍是 0。`crossedDeadlines` 也没有机会出现。

## 停批的真正原因

```
proposals[0].addressedThreadRef = "none"
```

模型写了裸字符串 `"none"`，而 wire 要求的是精确的 `{kind:"none"}`（schema 描述原文：「When absent, use exactly {kind:'none'}; never an empty string and never omit the field」）。本地候选校验以 `reference-field-grammar` 拒绝，修订不被允许（`semantic-equivalence-unproven`），于是一次调用都没有再花。

这与本批要验的东西无关，也不是 v42 引入的：round78 同一位置模型写的是 `{"kind":"none"}`。但它值得单独记一笔——`nullableRef` 是 `anyOf: [refText, {kind:"none"}]`，自由字符串那一支让 `"none"` 在 strict 端点上是合法形状，到了域校验才发现不是引用。**79 批里第一次撞上**，撞上就是整批作废。把裸 `"none"` 视为 `{kind:"none"}` 的语义等价（或者让修订票据允许这一种精确替换）是一个小合同，另立。

瓦罗的台词与 round75/77/78 一脉相承：「半分钟——不难等。账台给你听着，到点我敲一声」，`consequences: []` 依旧。第 2 层的问题没有任何变化。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口复核无监听。replay `exactState=true`，0 事件。321 项源码起止 `allEqual=true`，分支与 HEAD 未变。

[机器证据](vnext-round79-live-evidence.json)。私有证据在 `/tmp/zhuwei-round79-npc-preparation/evidence`。

## 未覆盖

推进本身未提交；第二三句未发送；`crossedDeadlines` 无数据；补选仍零证据。合同的执行半边仍然只有本地证据。
