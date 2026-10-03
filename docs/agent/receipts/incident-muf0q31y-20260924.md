# ZW-muf0q31y：Luna 空列表约束兼容故障

- 日期：2026-09-24；状态：本地修复与定向验证完成，未部署、未 push。
- 故障：`ZW-muf0q31y-0e27bab5a63f436ebd2bcc100af2203f`，请求时间 `2026-09-24T04:14:49.846Z`。
- 依据：[SPEC 0011 §§1、3–4](../../specs/0011-reliability-correction-observability-and-evaluation.md)、[SPEC 0016 §9.2](../../specs/0016-part-d-staging-and-supersede.md)、[ADR 0040](../../adr/0040-gpt-6-luna-provider-and-room-binding.md)、[ADR 0038](../../adr/0038-reask-unfinished-work-after-a-version-change.md)。规格与产品规则未变。

## 证据与边界

只读诊断确认房间绑定 `gpt-6-luna`。第一阶段选择成功（输入 28,662、输出 36 tokens）；第二阶段 `expandedProposal` 在约 2.15 秒后返回 HTTP 400，被归类为 `PROPOSAL_PROVIDER_CONFIGURATION / providerRequestInvalid`，行动未提交。

线上没有保存第二阶段原请求或上游错误正文。现存归档停在行动前（`settledEventSeq: 0`，归档时间 `2026-09-24T04:12:18.959Z`）。用故障时源码 `22a010c`、该归档和用户纠正后的交谈行动重建 social 表单，其中一个共享数组定义使用 `items: { type: "string", pattern: "^$a" }`，被两处 `basisFactRefs` 引用。social 是重建时选择的能力，不是从原线上回复恢复的选择。

这个表达在内部 schema 中表示“只能是空列表”，但与 Luna 的 strict 工具生成不兼容。授权的最小对照只改变空列表表达，其余模型、输入指令、工具选择、strict 与 128-token 输出上限相同：

| 空列表表达 | 真实接口结果 |
| --- | --- |
| `items: { type: "string", pattern: "^$a" }` | HTTP 400：`Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens.` |
| `items: { type: "string" }, maxItems: 0` | HTTP 200，调用 `validate_refs`，参数 `{"refs":[]}`；输入 139、输出 16 tokens |

这证明了可复现的 provider 兼容缺陷，并为原故障提供强解释；不等于逐字重放了线上原请求，也不能排除原请求另有问题。OpenAI 的[官方 Structured Outputs 文档](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)明确支持数组 `maxItems`。

## 探针授权与消耗

1. 第一批用户授权最多 2 次调用，合计输入上限 50,000、输出上限 2 tokens。一次连接失败，另一次 HTTP 400；中间的本地 schema 校验失败没有发出请求。由于第二次输出上限只有 1 token，其长度错误不能证明原故障。失败请求没有 usage，不能按零成本记账。
2. 用户另行授权最多 2 次最小对照，合计输入上限 4,000、输出上限 256 tokens。两次实际请求分别预留输入 1,039 与 1,036 tokens，各限输出 128 tokens，结果如上表。失败请求没有 usage；成功请求报告输入 139、输出 16 tokens。该批已结束，没有追加模型调用。

两批均不写入房间。原始归档、重建请求及预算记录仅在 Git 忽略的私有诊断目录中保留，不纳入此回执或公共错误输出。

## 修复与直接影响

- [OpenAI 传输转换](../../../app/_runtime/lib/kp/openai.ts)把内部的精确空列表表达等价转换为 `maxItems: 0`。逆转换仅识别对应形状，用于既有 strict 校验；普通候选、领域文字、描述和 DeepSeek schema 保持原值，非法限制仍在网络发送前被拒绝。
- 请求保存、发送、Room 阶段检查与归档重建继续共用 `kpRequestBody`，重复转换保持相同字节。未更换模型、取消 strict 或放宽引用权限。
- [Luna 工作流](../../../app/_runtime/lib/kp/vnext/runtime-policy.ts)的 `proposalTransport` 升为 `openai-chat-completions-strict-v2`，使请求表达变化进入绑定 hash。未来部署后，未冻结的旧版本提案按既有 ADR 0038 机制重新询问，并保留旧轮审计；本次没有触发线上重问。DeepSeek 的传输标识未改。

## 验证

- 先运行新增回归测试，确认旧转换没有生成 `maxItems: 0` 而失败；修复后执行 `node --import tsx --test tests/kp/provider/openai-authoritative-provider.test.mjs`，17/17 通过。覆盖真实 social 表单、内联与共享空列表、正常非空候选、字节一致与幂等、DeepSeek 保持原表达、非法限制拒绝及既有错误分类。
- Luna 换版本回归先因旧、新 workflow hash 相同而失败；更新传输版本后，执行 `npx vitest run tests/kp/provider/provider.room.test.ts -t 'asks an unfrozen proposal again after a version change|gpt-6-luna explicitly recovers unknown proposal stage 2'`，2 项通过、60 项跳过。实际执行的是 Luna 和 DeepSeek 的换版本重问用例，包含旧轮留存、提交、归档导出与恢复；另一筛选分支未匹配到用例，不计入验证。
- 对行动前归档重建的完整请求做纯本地检查：1 个空列表定义全部转换，strict 校验通过、序列化幂等、原输入不变；外部调用为 0。

本次没有全量回归、构建、迁移、部署或 Git push。没有改动已批准 SPEC 或增加验收门。旧版本已完成历史的跨版本归档恢复属于 ADR 0038 已记录的未覆盖项，本次未验证或扩展该范围。工作区中其他任务的改动与提交不计入本回执。
