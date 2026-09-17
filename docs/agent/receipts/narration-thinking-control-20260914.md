# 旁白关闭思考的单变量对照

日期：2026-09-14。承接用户“该怎么解决”和[真实验收失败](live-functional-acceptance-20260914.md)，使用原批次预留的一次诊断对照。**关闭思考后不再出现思考耗尽导致的空回复，但仍返回非法 JSON，尚不能作为完整修复。** 没有修改业务源码、发布文本或重跑玩家行动。

## 对照设计与结果

使用原第 5 次旁白调用保存的输入，通过 `createDeepSeekAuthoritativeBinding` 调用相同 `deepseek-v4-flash` 别名、相同 endpoint、冻结 messages、JSON 模式和 5,047 输出 token 上限。仅把 `thinking.type` 改为 `disabled`，移除在现役 Adapter 中仅适用于思考模式的 `reasoning_effort`。对象深比较确认不存在其他请求变化。

对照前记录预算：只调用一次，45 秒超时、最多 20,000 估算输入 / 5,047 输出 tokens，按当日高峰标价最高估算 ¥0.080376；任何结果均停止，不重采。该次不提交、不发布、不调用内容审核。

| 指标 | 原旁白请求 | 本次关闭思考 |
| --- | --- | --- |
| 请求思考模式 | enabled / low | disabled |
| 模型响应名 | deepseek-flash | deepseek-flash |
| Provider HTTP | 200 | 200 |
| 耗时 | 26.227 秒 | 1.832 秒 |
| 输入 / 输出 tokens | 4,917 / 5,047 | 4,892 / 196 |
| 正文原始内容 | 空 | 283 个字符，包含正文 JSON 及非法尾部 |
| finish_reason | length | stop |
| 本地格式检查 | 失败，空正文且截断 | 失败，完整 JSON 后多出两个字符 |

本次于北京时间 16:49:30 开始。模型写出了包含玩家来意与 NPC 回答的文本，但 JSON 结尾之后还附加了 `'}`。Node 的 `JSON.parse` 报 `Unexpected non-whitespace character after JSON at position 281 (line 1 column 282)`，现役 `extractFrozenNarrationResponse` 抛出 `ModelOutputValidationError`。保留原始响应，没有裁掉尾部或把处理后的副本算作成功。

这份生成内容未经独立审核，也未通过合法格式检查，不能判定自然度、事实准确性、玩家决定权或发布恢复通过。单次对照只证明此次没有思考耗尽症状；不证明长期稳定性。

## 方案判断

建议将旁白生成明确配置为非思考模式，并把当前普通 `response_format: json_object` 改为只允许 `{ body: string }` 的严格工具输出；同一阶段只接受已声明的传输方式。保留一次独立语义审核及严格的本地解析，生成失败不自动清洗输出、不增加无界重试。严格工具约束是否能解决本次格式问题仍需下一轮有界真实验证，不能仅凭文档保证。

这保持 SPEC 0015 §7 的 body-only 合同和 SPEC 0016 §8.3 的生成、审核与冻结恢复边界。实施时须同步生成请求、输出提取器、传输/工作流版本绑定及直接测试；验证正常正文、截断/非法 JSON 的拒绝、审核失败和原回执恢复。已有机械已提交的行动只能通过原旁白恢复入口继续，不能重跑 Proposal 或资源/时间结算。

当前[官方思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)支持 disabled；[Chat Completion 文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion)说明 max_tokens 限制 completion 总量。low 为思考强度设置，文档没有给它提供可单独配置的正文额度保证。增加 max_tokens 能给思考更多空间，但本次证据不足以支持某个更高数值能可靠完成。

## 证据与记账

- 本地私有证据：`.wrangler/live-acceptance-20260914/disabled-thinking-control/`，包含调用前 plan、请求、原始响应、report 与 audit；没有保存凭据。
- 请求 SHA256：`d6b805dad084758eb15cf8bf1d582be5496744c478fb6b361062ab1310404f5e`。
- 源码清单仍为 381 个文件，hash `sha256:ef4111b34055b14636df4e90515dc295ec7f683b77453a8ba368b6f9823d18be`，与原真实验收一致。
- 本次 1 次调用，4,892 输入（命中 0、未命中 4,892）、196 输出 tokens；按已核验高峰价估算 ¥0.011352。
- 原验收加此次对照合计 **6 次调用、163,322 输入 / 6,491 输出 tokens，官方标价估算 ¥0.20596656**；不是账户扣费凭证，不把两阶段累计为一个通过率。
- 文档页面 SHA256：thinking_mode `74648d1f52d0ec6e09fdee7b56c78b44c6ecc8033d18bc39e0bf8b668b313b92`；create-chat-completion `66fa4d7cdb0f0a81ecd2b4aeb4f958b94c05746adb54cc2b0a6ea51b60d7d195`。

原真实行动仍为完整体验失败，生成/审核/发布/恢复的修复尚未实施。本次一次对照结束后未再调用模型。
