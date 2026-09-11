# Narration 自然表达与人物一致性

- 状态：已接受（用户于 2026-09-05 明确批准）
- 日期：2026-09-05
- 关联规格：SPEC 0016、ADR 0015
- 取代范围：放开"普通动作不得润色"的限制，边界改为按后果判定
- 来源提案：[Narration 自然表达与人物一致性方案](../agent/proposals/narration-grounding-redesign.md)
- 规则所在：[SPEC 0016 §8.3](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)

## 背景

把 Narration 严格限制为机械结果的复述，会让每一次普通动作都读起来像日志。但一旦允许润色，就需要一条不靠文风判断的边界。

## 决策

普通动作润色可以保留，只要不新增意图、独立行动、持续规则状态或机械/因果后果。表达材料、同材料恢复及有界语义/质量审核由 SPEC 0016 §8.3 冻结。

## 影响

Rules Claims 保留原 hash，Room 不因此成为机械主张的写者。实现为 `kp/narration-context.ts`、`kp/narration-vnext.ts`、`room/narration-context.ts` 及其直接消费者。NPC 连续对话、环境固化链、成本多样性与模型采用门仍待验收。

原 README 索引把这条决定同时记为 `SPEC 0016 §§8.3/9.2`，但 §9 没有小节，§9.2 从不存在——那是一处悬空引用，本 ADR 只记 §8.3。
