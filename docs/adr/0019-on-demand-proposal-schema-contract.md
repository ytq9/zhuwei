# 按需 Proposal schema：首轮可只请求能力标识

- 状态：已接受（用户于 2026-09-06 明确批准）
- 日期：2026-09-06
- 关联规格：SPEC 0015、SPEC 0016
- 取代范围：为绑定新合同的 vNext Profile 增加 Proposal 前的 schema 选择例外；不改变现役 V5 的两次调用上限
- 来源提案：[按需 Proposal schema 合同修订](../agent/schema-retrieval-contract-proposal.md)
- 规则所在：[SPEC 0015 §6.1](../specs/0015-private-form-context-rag-and-narration.md)、[SPEC 0016 §7.2](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)

## 背景

把全部 Form 类型一次性塞进单一 strict 工具的 schema，会让提示词随能力数量线性膨胀，而任何一次裁决只用得上其中一两种。

## 决策

首次单一 strict 工具可以直接提交 ProposalBundle，或仅请求能力标识；服务端从冻结注册表补齐类型依赖后，只允许最终 Proposal。补取最多一次，其间无草稿、无裁决、无副作用；首份 Proposal 之后仍然只有一次窄修订。

## 影响

普通路径最多 2 次调用、补取路径最多 3 次，所有实际调用与 Provider 重试均计入 token、费用、延迟和 RootAction 预算。schema 标识只选择已注册的填写面，不证明世界存在性、物化权限或机械合法性；未知标识、混合草稿与预算超限一律技术失败，不得改写成玩家 clarification 或世界内拒绝。
