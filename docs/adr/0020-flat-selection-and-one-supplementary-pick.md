# 填写边界前移，并允许一次并集补选

- 状态：已接受（用户于 2026-09-07 明确批准，2026-09-09 再次确认）
- 日期：2026-09-07
- 关联规格：SPEC 0015、SPEC 0016
- 取代范围：窄取代 ADR 0019 中"首轮即可直接提交完整 Proposal"的形态
- 来源提案：[一次补选接口](../agent/vnext-selection-composition-validation.md)、[扁平选择接口](../agent/vnext-flat-selection-validation.md)
- 规则所在：[SPEC 0015 §6.1](../specs/0015-private-form-context-rag-and-narration.md)、[SPEC 0016 §§7.2、10、12](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)

## 背景

ADR 0019 允许首轮直接提交，但模型在还没看到类型细节时就要决定填什么，实践中会选错家族；而一旦选错就只能消耗那唯一一次窄修订。

## 决策

首轮只选类型（扁平 requestedCapabilities），第二轮才填写。填写时若缺少必要类型，可按并集补选一次；补选之后只准提交。2026-09-09 用户再次明确"可以补选"，阶段提示词按实际 amendable 状态互斥生成并纳入 prompt hash。

## 影响

类型及小表单来自同一实际 schema/注册表，原意图与完整冻结上下文不变。未知或重复 ID、混合草稿、无新增类型的再次补选、越界修订一律拒绝。Room 从已保存响应证明处于哪个阶段；恢复、重发与窄修订不得重新开放补选。闲置的类型选择不提高修订预算。真实模型验收独立记账。
