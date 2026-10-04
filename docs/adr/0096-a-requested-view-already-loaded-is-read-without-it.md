# ADR 0096：补选已加载的 NPC 视图按没选读

- 状态：已接受
- 日期：2026-10-04
- 依据：round165 重跑"把奈斯拦腰抱起，扛到炉边，再把他放下"时，KP 在补选里又列了奈斯；玩家点名的 NPC 已默认加载，不在补选工具的 enum 里，按 [ADR 0020](0020-flat-selection-and-one-supplementary-pick.md)"未知或重复 ID 一律拒绝"判为选表错误，整个行动失败，没有修订机会。用户确认改为略过该 NPC 继续。
- 当前规则：[SPEC 0016 §7.2](../specs/0016-part-c-compound-actions-and-claims.md)（补选只能新增）
- 取代范围：ADR 0020 中"未知 ID 一律拒绝"对已加载 NPC 视图的适用。

## 决定

选择或补选里出现一个已经默认加载的 NPC（玩家点名的 NPC）时，按没选读，同 [ADR 0064](0064-ruling-kinds-are-decision-values-and-a-selection-naming-one-is-read-without-it.md) 对决定类型的处理；补选因此没有新增时，按 [ADR 0065](0065-a-selection-repeated-without-addition-refills-the-form-instead-of-ending-the-action.md) 不带选择工具再发一次表单。既没有加载、也不可补选的 NPC 仍然拒绝。解析器契约升为 v82。

## 影响

- 这类补选不再让行动失败；该 NPC 的视图本来就在表单里。
