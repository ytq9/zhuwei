# 冻结输入回填的一次窄修订

2026-09-07，cloudflare 开发期。[round72](vnext-round72-validation.md) 第二次真实施法的 operation 完整，但多填 decision.intent；三个字段与本次服务器冻结输入逐值相同。原校验器准确拒绝额外字段，修订计划却无删除证明，提前以 PROPOSAL_FORM_INVALID 结束，未进入已有第三调用预算；诊断仍显示内部 terminal.intent。

现在由原 representationRepairPlan 消费同一校验器的 additional-field 诊断：只有 codec 可准确映回决策字段、且对象恰好包含与冻结输入相同的 actorRef/submissionRef/text 时，才证明固定 remove。其余决策不变，完整提案必须通过原校验器。模型仍只确认服务器计划；不开放删除路径或任意 JSON Patch。原稿、原始 arguments、冻结 context、计划、票据和允许范围在创建、调用准入、恢复及应用时重新核对；两次 Provider 入口均在 await 前固定 context。一次修订、最多八处修改及原执行家族三调用预算不变。

支持原生能力、直接成功、完整检定与澄清 continuation 中同类冗余输入，也可与已有表示修复合并。合法澄清/拒绝的 intent 不删除；错值、缺字段、多字段、其他未知字段、缺目标/DC/成败后果、不明确的嵌套 JSON 及篡改计划继续拒绝。knowledgeReview/passTime 即使表示可证明，也不能借此扩大原两调用上限。诊断、修订计划和允许路径映回真实 decision.intent，包括原校验器被前置错误遮挡后发现的 continuation 错误；不编造解析偏移。

6个生产文件及2个测试直接更新；parser v37、correction policy v9、ticket vnext5，现有 workflow/handshake 从 parserHash 派生绑定，没有改机械 Profile 或事件协议。Node最终36/36；Room先6/6，最后类型与路径小修后仅重跑恢复目标1/1；typecheck、diff-check exit0。第三响应持久化后断线与驱逐恢复共3次调用，最终一次掷骰、一次资源扣除；再次驱逐和重复 submission 不增加事件。初次精准 red 及类型检查失败日志保留，详见[集成记录](vnext-frozen-intent-repair-integration.json)。

root 用 round72 原真实响应和原 Room 冻结上下文离线重放，新入口产生恰好一个固定 remove 票据，保留原 arguments，允许路径为 decision.intent；此检查0 API、0提交，不改判原失败。独立差量审查未发现可复现阻断。round73 已另开正常 Cookie HTTP 真实复验，结果另记；本地通过不证明真实修订发生或成功率提高。

剩余缺口：round70 的不可引用目录不能安全删换，需单独改善同源依据候选；完整多人20+、任意自然语言一致性、更正容量和生产替换仍未闭合。本次未部署、push、commit、远端 migration 或退役数据，Goal active。
