# DeepSeek 格式化输出官方文档与现役接入核查（2026-09-09）

本记录核查当日可访问的 DeepSeek 第一方文档与当前本地接入源码，并做一次无网络的请求分派检查；未调用推理 API、未读取密钥、未验证线上解码行为。文档声明、离线接入结果与实际遵循率分别判断。

后续发布准备修复（2026-09-09）：`kpRequestDeclaresStrictTool` 已改为按任一工具的 strict 声明选择严格传输，支持现役 submit/补选双工具；非法混合工具仍在发送前拒绝，不降级普通接口。实际 Provider 路由测试覆盖选择、单工具填写、双工具补选、普通旁白和非法混合，3/3 通过。下文表格保留修复前复现结果；该定向测试使用截获 fetch，不表示已完成生产部署或供应商遵循率验收。

## 结论：当前有三种不同入口

| 入口 | 请求方式 | 官方声明与边界 | 来源 |
| --- | --- | --- | --- |
| Chat Completions 的 JSON Output | `/chat/completions`；`response_format: {"type":"json_object"}` | 声明生成合法 JSON；参数枚举仅 `text`、`json_object`，没有 `json_schema`。文档另列空 `content` 和截断风险，没有声称按业务 Schema 验证字段。 | [JSON Output][json]、[Chat API][chat] |
| Chat Completions 的 strict Tool Calls（Beta） | `/beta/chat/completions`；每个 `tools[].function.strict: true`，Schema 放在 `function.parameters` | 声明工具调用输出严格遵循 Function JSON Schema；服务端校验请求 Schema，不规范或不支持的类型返回错误；仅支持文档列出的子集。 | [Tool Calls strict][strict]、[Chat API][chat] |
| Responses API 的 JSON Schema 输出 | `/responses`；`text.format: {"type":"json_schema","name":"...","schema":{...}}` | API 参考明确写“输出符合给定的 JSON Schema”；`name`、`schema` 在此类型下必填。指南兼容表写 `text.format` 完整支持。 | [Responses API 中文参考][responses-zh]、[英文参考][responses]、[兼容指南][responses-guide] |

因此，“Chat Completions 的 `response_format` 没有 `json_schema`”不能外推成“DeepSeek 全部 API 都不支持 JSON Schema 输出”。Responses API 已有独立的官方支持声明。

Responses API 使用正常 `https://api.deepseek.com` base URL。已读参考页未列出 `text.format.strict`，也未单独列出该入口的 Schema 关键字子集；不能直接把下面 Chat strict 的 `$def`、长度限制或对象要求外推到 Responses。参考页的支持声明仍不是本项目实测通过的证据。[来源：Responses API][responses-zh]、[指南][responses-guide]

## JSON Output 的明确注意事项

- 必须设置 `response_format: {"type":"json_object"}`；system 或 user prompt 必须含有 `json` 字样，并给出期望 JSON 格式样例。[来源][json]
- 合理设置 `max_tokens`，防止 JSON 被截断；Chat API 明确说明 `finish_reason="length"` 时内容可能不完整。[来源][json]、[Chat API][chat]
- 官方明确承认有概率返回空 `content`，建议调整 prompt 缓解；未承诺完全消除。[来源][json]
- Chat API 另提示：未在消息中指示输出 JSON 时，可能持续生成空白直至 token 上限。[来源][chat]

据此只能把 JSON Output 视为格式约束入口，不能据此省略字段、引用、权限或业务规则验证。

## Chat strict 的 Schema 支持范围

以下均限于 [Tool Calls strict 文档][strict]，不是 Responses JSON Schema 的已知限制。

| 项目 | 官方明确内容 | 核查边界 |
| --- | --- | --- |
| 开启条件 | Beta base URL；传入 tools 中所有 function 都设 `strict: true` | strict 不是 `response_format` 的属性 |
| 类型清单 | `object`、`string`、`number`、`integer`、`boolean`、`array`、`enum`、`anyOf` | 没有文档化为完整 JSON Schema 实现 |
| 每个 object | 所有 `properties` 都须出现在 `required`；`additionalProperties` 必须为 `false` | 规则覆盖嵌套 object，不只最外层 |
| string | 支持 `pattern`；支持 `format` 为 `email`、`hostname`、`ipv4`、`ipv6`、`uuid` | 明确不支持 `minLength`、`maxLength`；未列 `date`、`date-time` |
| number / integer | 支持 `const`、`default`、`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、`multipleOf` | 这些条目写在数字类型段落，不证明其他类型同样支持全部关键字；英文将 exclusive 边界解释为严格大于/小于 |
| array | 展示 `items` Schema | 明确不支持 `minItems`、`maxItems` |
| enum | 将输出限制为给定选项之一 | 示例是字符串 enum；不据此推断全部混合类型枚举能力 |
| anyOf | 匹配所列 Schema 之一；示例是 object 属性内的邮箱/手机号两分支 | 文档支持声明不等于本项目复杂分支在实际模型上全部遵循 |
| `$ref` / `$def` | 中英文均明确写单数 `$def`，例为 `"$ref":"#/$def/author"`；另声明 `$ref` 可定义递归结构 | 不能把标准生态常用 `$defs` 与该文档写法无条件互换 |

详细原文：[object][object]、[string][string]、[number/integer][number]、[array][array]、[enum][enum]、[anyOf][anyof]、[$ref and $def][ref]。

已读 strict 文档没有明确规定以下兼容性，应保持“未文档化、未实测”，不能说已支持，也不能说已证实拒绝：

- 根 Schema 是否必须为 object；根 `anyOf` 是否允许。示例均用 object 包装，但没有明确根节点限制条款。
- `null` 类型、`nullable` 关键字、`type: ["string","null"]` 等可空联合；`null` 不在列出的类型清单中。
- `$defs`、`oneOf`、`allOf`、`not`、条件关键字、`uniqueItems`、嵌套深度和 Schema 大小上限。
- 是否禁止重复 JSON 成员名，以及对不支持关键字逐项采用何种错误行为。总则声明不符合规范/不支持类型返回错误，未给完整关键字错误矩阵。

官方若干字段示例省略 `required` 和 `additionalProperties`，但同页文字明确要求每个 object 补齐；不能把片段省略当成放宽规则。[来源][strict]

## 模型、思考模式与完成状态

- 当前模型表列 `deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`，三者均标注支持 JSON Output、Tool Calls、Responses API；Flash/Pro 的模型版本分别列为 `DeepSeek-V4-Flash-0731`、`DeepSeek-V4-Pro-0813`。这是核查时点的官方表，不是本项目当前配置或实时效果证明。[来源][models]
- strict Tool Calls 明确同时支持思考与非思考模式。Chat API 当前默认 `thinking.type="enabled"`，默认思考强度 `high`；可显式用 `disabled` 关闭。思考模式中 `temperature`、`top_p` 等采样参数即使传入也不生效。[来源][strict]、[思考模式][thinking]、[Chat API][chat]
- 携带 tools 的思考模式多轮请求须完整回传历史 `reasoning_content`，即使某轮没有实际调用工具；官方称回传不正确将返回 400。未携带 tools 时历史 `reasoning_content` 无需回传，传入也会被忽略。[来源][thinking]
- Chat 结构化结果所在字段不同：JSON Output 从 `message.content` 读取；Tool Calls 从 `message.tool_calls[].function.arguments` 读取，arguments 是字符串。工具调用本身不执行函数。`tool_choice="required"` 表示一个或多个调用，不保证恰好一个。[来源][chat]、[Tool Calls][strict]
- Chat 的 `finish_reason` 枚举为 `stop`、`length`、`content_filter`、`tool_calls`、`insufficient_system_resource`；后者表示推理系统资源不足导致请求中断。`length`、过滤和中断都不能当成完整业务输出。[来源][chat]
- Responses 使用 `status`（`in_progress`、`completed`、`incomplete`、`failed`）；`incomplete_details.reason` 列 `max_output_tokens`、`content_filter`。流式终点是 `response.completed` / `response.incomplete` / `response.failed`，没有 Chat 的 `data: [DONE]`；`max_output_tokens` 包括可见输出和思考 token。[来源][responses]、[指南][responses-guide]

## 现役接入比较与已复现的路由遗漏

当前本地 [DeepSeek adapter](../../app/_runtime/lib/kp/deepseek.ts) 只有 Chat 的普通与 Beta strict 两个端点，尚无 `/responses` 请求/响应处理。提案选择、填写和修订的 [请求构造器](../../app/_runtime/lib/kp/vnext/proposal-schema.ts) 为工具设置 `strict: true`；当前 [自然旁白生成](../../app/_runtime/lib/kp/narration-vnext.ts) 使用 `response_format: {type: "json_object"}`，旁白审核另用 strict tool。不能把所有阶段都描述为同一种格式化输出。

请求分派存在一个确定的本地遗漏：[provider.ts](../../app/_runtime/lib/kp/provider.ts) 根据 `kpRequestDeclaresStrictTool` 选择端点，但 [authoritative-policy.ts](../../app/_runtime/lib/kp/authoritative-policy.ts) 第 179 行要求 `tools.length === 1`。当前允许补选的填写请求同时携带 submit 与 offer 两个 strict 工具，因此会分派到普通 `/chat/completions`，不满足官方 strict 要求的 Beta 入口。严格 adapter 自己已经接受一到两个 strict 工具，错误发生在进入 adapter 之前。

本次以 `npx tsx --eval` 直接导入真实构造器、`assertDeepSeekStrictToolModelInput` 和路由谓词执行一次离线检查（exit 0），没有 fetch：

| 实际构造的阶段 | strict 工具数 | strict 请求配置校验 | 现有路由选择 Beta |
| --- | ---: | --- | --- |
| `createVNextProposalOfferModelInput` | 1 | accepted | true |
| `createSubmitKpProposalBundleModelInput(amendable=false)` | 1 | accepted | true |
| `createSubmitKpProposalBundleModelInput(amendable=true)` | 2 | accepted | **false** |

本次只记录该缺陷，没有修改业务代码。上一轮上下文检查的测试替身覆盖冻结、Room 保存和恢复，但没有覆盖上述实际供应商分派，不能据此宣称所有请求已正确启用 strict。

历史 [round87](vnext-round87-validation.md) / [round89](vnext-round89-validation.md) 还记录过缺少 required 字段的 `{}` 返回；[round84](vnext-round84-validation.md) / [round86](vnext-round86-validation.md) 记录了分支额外字段或引用 enum 违规。这些是旧批次记录，本次未重新调取其私有原始网络请求，也未新增真实调用；不能将本次路由缺陷直接定为每个旧失败的原因，也不能把所有失败统一归因于供应商。

后续建议先修复并验证 strict 请求分派，再用同一份最小 Schema、相同输入，对比 Chat strict 与 Responses JSON Schema。Responses 的完成状态、文本提取和 Schema 方言需要分别验证，现有 `$def` 压缩结果不能仅凭 Chat 支持就直接移用；冻结上下文、唯一 JSON 成员、本地字段/引用/权限校验仍保留。

## 对本项目的证据边界

文档足以证明 DeepSeek 存在上述格式约束接口，并指出接入时必须区分 API 形态；离线检查已证明当前双 strict 工具分派不符合 Beta 接入要求。本次没有证明复杂 Proposal Schema 的实际通过率，也未验证引用、权限或机械结算。若评估 Responses JSON Schema，应将其视为另一协议入口，先核对完成状态、输出提取和本地 Schema 校验，再以有界实测证明具体组合，不能由文档承诺替代验收。

检索入口核对：`/zh-cn/guides/function_calling` 本次虽返回 HTTP 200，正文实际是英文“Your First API Call”，不是当前 Tool Calls 指南；本记录使用导航所指 `/zh-cn/guides/tool_calls/` 及英文对应页。

[json]: https://api-docs.deepseek.com/zh-cn/guides/json_mode/
[chat]: https://api-docs.deepseek.com/api/create-chat-completion/
[strict]: https://api-docs.deepseek.com/zh-cn/guides/tool_calls/#strict-模式beta
[object]: https://api-docs.deepseek.com/guides/tool_calls/#object
[string]: https://api-docs.deepseek.com/guides/tool_calls/#string
[number]: https://api-docs.deepseek.com/guides/tool_calls/#numberinteger
[array]: https://api-docs.deepseek.com/guides/tool_calls/#array
[enum]: https://api-docs.deepseek.com/guides/tool_calls/#enum
[anyof]: https://api-docs.deepseek.com/guides/tool_calls/#anyof
[ref]: https://api-docs.deepseek.com/guides/tool_calls/#ref-and-def
[models]: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
[thinking]: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/
[responses]: https://api-docs.deepseek.com/api/create-response/
[responses-zh]: https://api-docs.deepseek.com/zh-cn/api/create-response/
[responses-guide]: https://api-docs.deepseek.com/zh-cn/guides/responses_api/
