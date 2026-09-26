# round144–145：可补选轮的选择工具按补选呈现

2026-09-27。`tools/run-story-room-probe.mjs --live --case daily-hidden-act`，每次运行一个新房间，真实 HTTP 路径，`deepseek-v4-flash`。在主工作区运行，源码 `7a21758`（工作区里另一个会话未提交的 OpenAI 提供方改动不在 DeepSeek 路径上）。每批不超过 20 次调用，遇到第一个技术失败即停。用户要求本批通过后推送并快速部署，见当日发布日志。

## 这批验证什么

`4ea651c`：可补选的填写轮里，选择工具写明已加载的类型、只枚举还能新增的 ID，字段说明改为“要新增的类型 ID”。此前它与首轮选择工具一字不差，136 和 142 第 2 次把首轮选择原样重发。同一源码还带着 `d01bb59`（[ADR 0064](../../adr/0064-ruling-kinds-are-decision-values-and-a-selection-naming-one-is-read-without-it.md)：裁决种类写进补选时按未选处理，读不出的补选按表单失败结束）、`2933832`（隐蔽动作后同一提案里对察觉者说话仍能提交；effects 形状错误按下标报 `world-effect-contract`）和 `7a21758`（[ADR 0065](../../adr/0065-a-selection-repeated-without-addition-refills-the-form-instead-of-ending-the-action.md)，只改文档）。

## 结果

| 批 | 源码 | 行动 | 调用 | 输入（缓存命中）/ 输出 token | 结果 |
| --- | --- | --- | --- | --- | --- |
| 144 | `7a21758` | 用例原文（装作整理衣领取叶，同时问莉安） | 9 | 164,496（48,768）/ 4,061 | 通过。首轮选 worldInteraction、inventoryOperation、observe、social；第 2 次调用补选只写了 `materializeItem`——新增一项，没有重列已加载的四项，没有裁决种类，没有 NPC；第 3 次填写 concealedCheck（敏捷·巧手），主要对象莉安（分心，DC 6），奈斯未特别注意、瓦罗分心，各引用 2 条记录；骰 1+2=3，三人都察觉；瓦罗当场反应（上前半步要求当众说明），奈斯拒绝反应；旁白与反应旁白各一轮复核通过。补选加的 materializeItem 没用上 |
| 145 | `7a21758` | 135/142 的文本（「我知道奈斯一直站在楼梯阴影里盯着我……趁莉安低头添柴时把他嘴里那片黑橡叶顺进袖子里，同时问她：“你父亲生前常来守灵厅吗？”」） | 8 | 168,246（82,688）/ 2,438 | 通过。首轮一次选了 7 项（含没用上的 completeObject、materializeItem、commitNarrativeDetail），第 2 次直接提交，没有补选；concealedCheck，莉安分心（DC 6）、奈斯看着（引用场景、奈斯的记录和开场描写，不是玩家的话）、瓦罗按默认未特别注意；第一稿因 `passage:authorized-open-connection-required` 修订一轮（补丁改 success 分支）；骰 10+2=12，瞒过莉安和瓦罗，奈斯察觉并拒绝反应；旁白第一稿被复核打回（把玩家输入里“奈斯一直盯着我”写成事实，把叶子写进袖子），第二稿通过 |

两次运行合计 17 次调用，332,742 输入（缓存命中 131,456）/ 6,499 输出 token。

## 结论

- 本批唯一一次补选（144）只列了新增项。两次运行里都没有出现重列首轮选择或把裁决种类写进补选的情况。样本只有一次补选，不能说明稳定性。
- 补选和首轮多选用不上的类型仍在（144 的 materializeItem，145 的三项），属于多余补选任务。
- 145 的正确稿里没有 inventoryOperation 步骤，叶子没有作为物品转移；旁白第二稿仍写“收进了袖子”并通过了复核。“检定成功但缺库存操作”的旧问题仍在。
- 145 第一稿的诊断 `passage:authorized-open-connection-required` 没有路径（path 为空），模型这次一轮改对了；与 142 已修正的 `bundle:world-interaction-invalid` 同类，本次未处理。

## 没有覆盖的

- 只有一次补选样本。
- 没有出现只剩裁决种类的补选，ADR 0064 的再发表单路径只有本地测试。
- 没有出现正在执行活动的候选人，默认“分心”只有本地测试。

私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-{QqZYus,p4SkiD}`，重启即失。
