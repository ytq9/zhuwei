# ADR 0060：旁人的当场反应不另占时间，只用 worldInteraction，调用失败即作废

- 状态：已接受
- 日期：2026-09-26
- 依据：实现 [ADR 0059](0059-bystanders-notice-by-passive-perception-and-react-by-their-own-view.md) 第 3 条时遇到的约束，经本地测试确认。
- 当前规则：[SPEC 0006 §7](../specs/0006-module-npc-and-faction-protocol.md)（察觉后的当场反应）。
- 取代范围：无。本 ADR 只记录 SPEC 0006 §7 的实现方式。

## 决定

1. **反应不另占时间。** NPC 的 Activity 不会自己推进时钟（SPEC 0013），要等别人的行动把时间推过去才完成；若反应按 5 分钟档位执行，它要到下一次行动才结算，达不到「随本次行动在同一次回复里发布」。反应调用的时长字段只允许 `none`，降级时以 `onTheSpot` 放行不耗时的在场动作，Bundle 在反应自己的根里原子执行。
2. **反应只用 worldInteraction，另给一个拒绝工具。** social 表单要写对话对象的回应，而对方的回应不由正在反应的 NPC 决定。反应者说的话写成在场者能听见的感知证据。模型用 `decline_npc_reaction` 表示不反应，理由只记在该 NPC 名下。
3. **调用失败即作废。** 响应无效、结果未知、冻结前提已变或本次行动的调用额度用完时，Room 提交一条私有的 `lapsed` 结算，该 NPC 这次不反应，感知记录保留。调用仍在进行或缺少传输通道时不算失败，工作保持待办。
4. **只给能立即行动的 NPC 开反应。** 处在遭遇中的 NPC 按回合行动；已经在执行 Activity 的 NPC 不能再开始新动作（Rules 会拒绝）。这两种 NPC 只得到感知证据，不调用模型，结果与调用后作废相同，但不浪费调用。
5. **反应里不再引出反应。** 反应所在的根（及其完成根）里发生的隐蔽检定照常给察觉者感知证据，但不再开新的反应。
6. **持久化。** 反应记录放在可选集合 `campaignRuntime.npcReactions`，首次有人察觉时创建（与 `conversationThreads` 相同）。新增的私有事件 `NpcReactionOpened`、`NpcReactionSettled` 只登记到 Rules 的事件类型表，不修改事件 schema profile 文档（与 `ActivityCompletionInputRecorded` 相同），已有房间的 manifest 不变，照常回放。

## 后果

- 一次隐蔽动作最多为每个能行动的旁观 NPC 各多一次模型调用；探针夹具里一次反应调用约 13,700 估算 token（工具 7,100、NPC 本人上下文 2,100、指引与规则 4,200），实际房间随 NPC 的记忆增加。做出反应的 NPC 另有一份发布给在场者的叙述。
- 反应与所察觉的动作在同一次请求里结算和发布；Room 在回复提交后把待办的反应列入同一请求的续办。
- 处在遭遇中或正在执行 Activity 的 NPC 察觉后不会当场反应，只在记忆里保留所见。
