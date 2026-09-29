# 9DCMQN 人物归属、玩家意图与纠错上下文排查

2026-09-29，用户要求检查截图中的前后矛盾，并授权读取对应烛帷页面。分支 `cloudflare`，本地 HEAD `5e67695e474ac8d21b61b0acd73ba6b0c65da52a`；原有未提交改动保持不动。本次只诊断，没有修复运行时代码或线上状态。

## 证据与操作范围

- 浏览器核对现有房间 `9DCMQN` 的连续对话，没有发送玩家行动。
- 对现有 D1 执行两次限定该房间的 SELECT：检查点及分片元数据、该检查点的 138 个分片；两次均 `rows_written=0`。
- 取得故事代次 `136`、世界事件序号 `84`、17 个 host binding、38 个已保存模型调用。138 个分片的索引、数量和哈希全部匹配，拼接 JSON 可解析；没有声称完成整份归档的恢复验收。
- 内容标识：`sha256:d21b47433ff2b35bf91a4cb58080981627a9823e0478a01947d54a08a44bb929`。下文使用该不可变副本中的数组索引。
- 房间绑定 `deepseek-v4-flash`。本次未新调用模型、未部署、未执行 migration 或 Git push。
- 私有副本与临时重放脚本存放在本机 `/private/tmp/zhuwei-9dcmqn-20260929/`，不纳入 Git。本回执只摘录已向该玩家显示的内容及诊断字段，不复制完整 Prompt 或隐藏剧情。

## 1. “什么纸”：正确材料已送达，生成写错，审核放行

北京时间 01:10:53 的旁白生成请求对应 `hostBindings[7]`。生成请求与随后审核请求均包含正确开场：瓦罗把盖印文件按在账台上，奈斯站在楼梯阴影里；原话 `actorIntent` 是“什么纸”。正确开场同时存在于模型输入的 `facts[0].text` 与 `payloads[0].records[0].content.description`。

生成调用 `7ebb262e-1874-453d-9d31-456610e3e376` 的原始响应已经写成“奈斯按在账台上的那份盖印文件”。审核调用 `ba083def-e482-4488-949f-47940289d2a4` 收到该正文和正确材料，却返回 `{"status":"pass","issues":[]}`。

离线重放调用真实 `createAuthoritativeKpAdapter().narrate()`，以保存的两份模型响应替代网络。adapter 产生的两份 provider 请求与归档逐字段完全相等；adapter 和共享发布校验均原样接受错误正文。最末的症状断言 `accepted narration contradicts the frozen record` 失败，约 0.16 秒，退出码 1。

```sh
node --import /Users/sanmu/Documents/zhuwei-cloudflare/node_modules/tsx/dist/loader.mjs /private/tmp/zhuwei-9dcmqn-20260929/replay-narration.mts
```

因此，首次人物归属偏离位于模型生成正文，独立语义审核漏检；不是前端或程序拼接时换了姓名，也不是本轮没有送达开场事实。现役 [审核结果解码](../../../app/_runtime/lib/kp/narration-text.ts)将合法 `pass` 转为 `publish`，[adapter](../../../app/_runtime/lib/kp/authoritative.ts)随后返回原候选。

这项重放证明当次保存响应如何被应用接受，不证明新模型调用的复发概率，也不是已修复的回归门。未重放完整 Room、前端或调用账本。适用合同为 [SPEC 0016 §8.3](../../specs/0016-part-c-compound-actions-and-claims.md)：人物与对象归属的实质改变须阻断；模型语义审核本身不是绝对正确性证明。

## 2. “第三份什么东西”：问题在提案阶段被改写，并进入记录

页面可见的更早一轮对应 `hostBindings[8]`（提案）和 `[0]`（旁白）。四次实际 proposal 请求均携带正确 `intent.text`：“第三份什么东西”。

首次偏离出现在第 3 次调用 `d3c356cf-a686-4553-9bc1-1b767e2ab8d2` 的 `submit_kp_proposal_bundle`：模型把 `actorSpeech` 写成“第三份东西我大概知道在哪儿。那封信呢——你父亲提过那封信是什么没有？”，并将目标改为询问信。这既换了问题，也添加了玩家未表达的“知道下落”。第 4 次修订只改 `/check/social/0/basisRefs`，没有更正意图或台词。

错误台词进入事件 `47 SourceClaimCreated`、`48 KnowledgeAcquired`，并进入事件 `53 WorldInteractionResolved`。旁白和审核请求仍保留正确原意图，但旁白沿错误提案写成“你问莉安，那封信是什么、她父亲有没有提过”，审核再次返回 `pass`。

因此，这一轮不是仅有显示层措辞错误，而是提案语义偏离后被接受并保存。证据能定位首次偏离，不能仅据此确定哪一段提示词诱发了模型误读。适用合同为 [SPEC 0001 §2](../../specs/0001-llm-kp-responsibility-contract.md)：玩家拥有角色意图。

## 3. 用户纠正时，刚发布的错误回复没有进入下一轮请求

北京时间 01:15:13 起的纠正轮对应 `hostBindings[11]`（提案）和 `[6]`（旁白）。三次 proposal 请求及两次 narration/review 请求都不含上一轮“什么纸”，也不含上一轮错误正文中的“奈斯按在账台上的那份盖印文件”。当轮用户纠正原话和正确开场仍在请求中。

Proposal 的接缝也没有消费聊天正文：Room 虽在 KP projection 放入 `experiencedTranscript`，[冻结上下文构造器](../../../app/_runtime/lib/kp/vnext/context/index.ts)只从该 projection 读取身份、状态绑定和 hash，内容另从权威状态及角色记忆构建。归档的 `hostBindings[11].payload.submission.prepared.requiredContext` 已经缺少前一轮问答，遗漏不只是最终 provider 格式化时发生。两次 `KnowledgeReviewed` 的知识目录 hash 相同，回顾并未新增角色记忆来承载这段问答。

现役旁白上下文接缝存在可复现的过滤：[Room](../../../app/_runtime/lib/room/durable-object.ts)为 KP delivery 设置 `speakerCharacterId:null`；[roomNarrationContext](../../../app/_runtime/lib/room/narration-context.ts)只保留具备角色说话者、且该角色属于本次相关 sourceClaim 的最近消息。KP 自身回复会被该条件排除。

最小接缝实验显式传入归档中的前一条错误 KP 回复，仍被滤掉。单变量对照中，空说话者仍被丢弃，改为符合筛选条件的 NPC 才被保留。保留 KP 原文的预期断言退出 1：

```sh
node --import tsx /private/tmp/zhuwei-9dcmqn-20260929/check-missing-kp-context.mjs --expect-retained
```

实验使用纠正轮真实 claims、前一条真实正文及最小重建 projection，证明该接缝的过滤行为；没有重建线上当时传入的完整 transcript。归档中的五份实际请求另行证明这次确有遗漏。遗漏使下一轮缺少直接核对前次错误正文的材料；不据此声称它是模型未承认错误的唯一原因。

[ADR 0048](../../adr/0048-each-character-carries-its-latest-six-rounds.md)中的“最近六轮全文”指角色获得的记忆，不能等同于六轮聊天气泡，也不能据此宣称所有公开回复都已进入连续性输入。

## 状态影响与未覆盖范围

“什么纸”与随后的纠正分别只产生事件 `83`、`84`，类型均为 `KnowledgeReviewed`；没有人物移动、物品转移或更正事务。截图中的人物换位发生在叙述文本，不能解释成底层把奈斯搬到账台。较早被改写的玩家台词则确实已经进入来源主张和知识记录，影响范围不同。

本次未更改产品合同、Prompt、验收基线或房间数据。没有通过重采样制造同错，没有运行全量测试，也没有验证任何修复。后续修复需要分别处理玩家原意图被改写、人物归属审核漏检、与当前纠错有关的已发布回复无法取回三个边界；不能以替换人物名字或只修最后一句作为全部问题的闭环。
