# ADR 0105：选择目录不再列出"做不到"

- 状态：已接受
- 日期：2026-10-05
- 依据：第 167 批真实验证的翻墙用例（167-5）。玩家说"我翻过院子东边那道矮石墙"。KP 在选择阶段只选了 inWorldRefusal 和 knowledgeReview，填写时手里没有世界互动表单，于是以"要先走到墙边、墙外没看过"为由拒绝。按填写说明，走近这类前置步骤不算缺少前提；KP 本可补选，但没有补选。冻结上下文里这道 3 尺石墙对该角色不需要检定。
- 当前规则：[SPEC 0016 §7.2](../specs/0016-part-c-compound-actions-and-claims.md)（做不到是一种裁决，不由选择决定；填写与修订表单总提供它，选择里出现时照常读取）。条款不变。
- 取代范围：[ADR 0085](0085-a-refusal-is-always-offered-at-filling.md) 决定 1 的最后一句"选择目录里拒绝的说明加一句'填写时总会提供，选择时仍按行动本身选类型'"。

## 原因

ADR 0085 让填写表单总带"做不到"，选择目录却仍把它列为可选类型，只加了一句提醒。选择阶段不收到裁决规则，KP 在这里选了"做不到"，等于在选择时就做了裁决。这正是 SPEC 0016 §7.2 排除的情况。

## 决定

1. 选择目录不再列出 inWorldRefusal，只列 knowledgeReview 和 passTime 两个终结类型。选择工具的 enum 仍含 inWorldRefusal，选了照常读取，与 SPEC 一致。
2. 选择说明中"下一阶段提供所选完整表单"改为"下一阶段提供所选完整表单，并总带inWorldRefusal：能不能做到在填写时裁决，这里只按行动本身选类型"。
3. 指引升为 `zhuwei.proposal-guidance/v91`，选择约定升为 `flat-type-selection-refusal-ruled-at-filling-and-step-surface/v6`。尚未冻结的方案按 [ADR 0038](0038-reask-unfinished-work-after-a-version-change.md) 重问。

## 影响

- 选择请求少了拒绝的一行说明，多了约 25 个字。请求体积门只计量填写请求，数值不变。
- 判断确实做不到的行动时，KP 要先选出这个行动本身的表单，所以填写请求会带上该表单，比只带拒绝表单的填写请求大。
- 改后需要一批编号的真实探针（翻墙用例重跑）。
