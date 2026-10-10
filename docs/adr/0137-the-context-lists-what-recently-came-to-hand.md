# ADR 0137：上下文把最近到手的物品列在一处

- 状态：已接受
- 日期：2026-10-10
- 依据：[ADR 0136](0136-a-holder-remembers-how-each-loose-stack-came-to-hand.md) 之后，冻结上下文里已有每叠物品怎么到手的记录，但[真实矩阵](../agent/receipts/carried-reference-matrix-20261010.md)和[说明句 A/B](../agent/receipts/acquired-from-guidance-ab-20261010.md)显示，模型首稿在同名物品中只选对一半左右；加一句说明不显著（53% → 63%，p = 0.30）。把同样的记录汇成一份从新到旧的短清单后，[A/B](../agent/receipts/recently-in-hand-ab-20261010.md)首稿选对率从 52% 升到 89%（p < 0.0001）。用户要求"是否值得做要看测试结果"，结果支持采用。
- 当前规则：[SPEC 0016 §4.3](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)、[SPEC 0001 §16](../specs/0001-llm-kp-responsibility-contract.md)；条款不变。

## 决定

1. **清单只汇总已有记录。** 发给模型的上下文 `references.recentlyInHand` 列出行动者本人的到手记录，来源是冻结物品记录的 `acquiredFrom` 和随身物清单行的 `acquiredFrom`。每条写物品引用、物品名、来源类别、来源引用、数量和事件序号。不新增权威数据，也不改变哪些记录能进上下文。
2. **从新到旧，最多 6 条。** 按事件序号从大到小排列，同一序号按物品引用排列。更早的记录仍留在各自物品上。
3. **没有记录就不出现。** 行动者手上没有带到手记录的物品时，不加这一项。
4. **引用与物品处一致。** 冻结物品记录里的来源引用加入短引用表，清单和物品记录用同一个短引用。
5. 模型上下文升为 vnext-20。规则解释不变，运行版本和事件格式不变，不退役已开房间。

## 后果

- 只有带到手记录的请求会变长，每条约几十个 token；固定请求体积不变。
- 清单不进入玩家视图，也不影响 Rules 判定；选错物品仍由修订诊断处理。
- A/B 用的是保存下来的首稿请求，不经过 Room 和旁白。整条流程里的效果还要靠后续真实批次确认。
