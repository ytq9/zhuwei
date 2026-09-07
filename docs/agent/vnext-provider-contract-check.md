# DeepSeek strict 合同与价格复核

核验时间：2026-09-06 09:39 UTC（北京时间 17:39）。本次只读取官方公开文档、对照当前源码并运行本地传输替身测试，没有调用真实模型。

官方来源：

- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)：strict 支持思考与非思考模式；须使用 `https://api.deepseek.com/beta`，所有 function 设置 `strict:true`。对象字段全部 required，`additionalProperties:false`；支持 `anyOf`、`$ref` 与 `$def`。字符串不支持 minLength/maxLength，数组不支持 minItems/maxItems。源码保留这些限制，不用生成端约束替代本地领域校验。
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：`deepseek-v4-flash` 当前对应 Flash-0731。人民币每百万 token 的缓存命中/未命中/输出价格分别为空闲 **0.05/1.5/4.5**、高峰 **0.10/3.0/9.0**；高峰为北京时间工作日 09–12、14–18，其余空闲。当前周日为空闲时段；未来批次仍按实际调用时间及 usage 分项计费。

下载 HTML SHA-256：Tool Calls `41420d8609a15ff13afd5b82a66ea1b2a5440a59787718ade7f48230b660bcfa`；价格页 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`。原文件分别在 `/tmp/zhuwei-deepseek-tool-calls-current.html` 与 `/tmp/zhuwei-deepseek-pricing-current.html`。旧 `/guides/function_calling` 链接本次跳转到起始页，未将该页面当成 strict 合同；使用页面中的现役 Tool Calls 链接重新核验。

当前 `deepseek-strict-tool.ts` 的端点为 `/beta/chat/completions`；`createDeepSeekStrictToolBinding` 在网络前检查单一 strict function 与方言，随后使用该端点；`deepSeekRequestBody` 保留 strict tool 并规范 thinking、max_tokens 和非流式请求。v15 clarification 复用 `$def/proposals`，与上述官方方言相符。`tests/deepseek-strict-tool-provider.test.mjs` 已随本轮最终 61 项 Node 组通过，验证实际 fetch 参数、strict 方言、禁用无约束降级和已有握手接缝；该替身结果不证明远端约束本次已生效。

未发现能解释 [round30](vnext-round30-validation.md) 非法 JSON 的端点或文档参数差异。官方宣称 strict 遵守 schema，与该批已捕获的非法输出并不一致；此处只能记录观察到的 Provider 合同失效，不能断言服务端内部根因，更不能把原非法草稿改成成功。当前 v15 源码已不同于 round30 清单，后续真实批次应使用新房、新清单和独立预算；首个明确失败仍停批定位。

整桌 20–30 元继续是软目标，当前没有四到五小时真实整桌样本。计费公式仍为各阶段实际 hit/miss/output usage 乘对应单价，包含 schema、修订、旁白、审核、NPC 与重试；本次无新增模型费用，不将公开文档请求计入模型调用。
