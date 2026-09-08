# Round91：三句零修订全部提交，三张表第一次跑完整个场景

2026-09-08 下午，源码 `da36c87`（parser v51：裸 none 对 retryChange / trace 也生效；v50 的空对象重发）。场景同 round82–90。三句都提交并发布，**每句 4 次调用、零修订，共 12 次，¥0.520485**。

## 三句

**首句。** 瓦罗要求先报全名分、缘由与转呈对象，否则「没法落字」；原件今晚不离手。三张表干净，`addressedThreadRef` 与 `retryChange` 都是 `{kind:"none"}`，`responseBasis` 四个引用（含 `playerExpression`）全在枚举里。`consequences: []`——同一句话的第五种世界选择（还价、拒绝、承诺、当场抄、要名分）。时钟 0 → 300000000。

**第二句。** passTime 3600000000，旁白「你在大厅中等候了一个小时，此刻等待已经结束。」；observe 第七次与 passTime 同选后被丢弃。没有计划可到期。时钟 → 3900000000。

**第三句。** observe 单独成根，第一次真实提交：裁决 directSuccess、`duration: "5min"`（裁决上没有多余的 basisRefs）；步骤的 `basisRefs` 带行动者的 `module-opening` 引用，`existingFactRefs` 是玩家自己两条社交 claim 的 `knowledge:` 引用——两种在 round85 没走到校验的引用这次都合法；结果行两条：`sensoryEvidence`（账台上没有新纸，原件仍在）与 `characterInferences`（瓦罗没有为没报全名的外乡人誊抄）。事件：`FictionTimeAdvanced`、`CanonicalFactDeclared`、`SensoryEvidenceAcquired`、`CharacterInferenceFormed`、`WorldInteractionResolved`、`AtomicWorldInteractionStepsResolved`。旁白与首句的拒绝一致：台面上没有副本。时钟 → 4200000000。

## 这批证明了什么

- 三张平表 + 拆平的 continuation + 平枚举的 `responseBasis`，在社交、等待、观察三种根上都能被真实模型一次写对（round85 起 12 次完整草稿里，格式失败只剩 round86 的规则档案引用、round87/89 的空 `{}`、round90 的裸 none，各有修复）。
- observe 的 `knowledge:` 前缀引用与 `module-opening` 引用合法。

## 没碰到的

裸 none 泛化（v51）与空对象重发（v50）这批都没被需要；裁决 `basisRefs` 丢弃仍无真实触发；承诺链只有 round88 一例；等待根的 `crossedDeadlineCount` 仍是 null。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 16，16 条事件。323 项源码起止 `allEqual=true`。[机器证据](vnext-round91-live-evidence.json)。私有证据在 `/tmp/zhuwei-round91-npc-preparation/evidence`。
