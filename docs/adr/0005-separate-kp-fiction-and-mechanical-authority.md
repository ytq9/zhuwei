# 分离 KP 叙事权威与规则机械权威

- 状态：已接受
- 取代：ADR-0001 中限制 AI 创作世界事实和要求封闭故事 DSL 的部分
- 产品规格：`docs/specs/0001-llm-kp-responsibility-contract.md`

烛帷选择让 LLM/KP 在故事锚点和已固化事实内拥有叙事权威，包括自由行动的可行性裁决、动态世界创造、NPC 行动、风险与故事推动；D&D 5e 2014 / SRD 5.1 规则内核保留骰子、数值、资源、行动和效果的机械权威，房间权威状态保留事实的最终提交与投影权。

因此模组提供故事圣经和核心真相，而不是封闭的场景、行动和结局流程。LLM 可以提出新的结构化叙事事实与机械方案；规则内核只验证并执行机械部分，Room Durable Object 在验证后原子提交叙事事实与机械结果。规则内核不能替故事选择危险程度，也不能因当前队伍过弱而自动缩放世界。现有 `step` / `project` 和 Room Durable Object 在新实现规格获批前继续作为单一裁决与状态路径，不得以开放叙事为由建立第二权威。

## 验收场景

1. 合理但未登记的自由行动进入 KP 提案—Rules 诊断—修订循环；KP 可以选择空结果、强敌、失败或旁路，但不能自报骰面或越过机械约束。
2. NPC 只能依据自己的有限知识和已固化事实提案；模型失败、超预算或断线不会触发自动攻击、自动选目标、自动 pass 或推进时间。
3. 非法机械字段逐项返回修订诊断；合法提案经同一 Room 事务固化动态事实、机械结果与观察者投递。

## 实现映射

- KP 合同与适配：`app/_runtime/lib/kp/authoritative.ts`、`app/_runtime/lib/room/proposal-adapter.ts`
- Room 编排：`app/_runtime/lib/room/action.ts`
- Rules 提案入口：`app/_runtime/lib/rules/ai-adapter.ts`、`app/_runtime/lib/rules/v2/actions.ts`
- 验收：`tests/authoritative-kp-adapter.test.mjs`、`tests/module-npc-v2.test.mjs`、`tests/kp-multiturn-eval.test.ts`
