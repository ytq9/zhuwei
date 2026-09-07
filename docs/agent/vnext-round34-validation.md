# vNext round34：固定缺陷样本的真实窄修订验证

2026-09-06，cloudflare / 258caee404e0814405eb497653ee9f00d647b773 未提交开发树。源码见[冻结manifest](vnext-round34-source-manifest.json)，parser hash为 `sha256:10d2a88992009d44680d1883e95a39b872b6afc5fe0da3e4eea60d4cba200aca`。主代理记录调用期间305个源码文件无差异，收尾重新核验亦为305/305一致；manifest不改写为后续源码。

## 样本与调用边界

这批使用三个固定合成首稿：先通过现役首遍入口冻结合法预期束，再人工加入可证明等义的填表缺陷，得到原校验器签发的repairTicket。真实DeepSeek API只执行correction，每样本一次，无重试；首遍是本地合成binding，不产生模型用量。三个结果中的 `invocationCount=2` 表示“合成首遍 + 真实修订”的协议阶段，不能计为六次真实调用。

预设最多3次模型调用、48,000输入、1,800输出、每次45秒、全批4分钟、开发费用上限¥0.17；首次明确失败即停止。使用 `deepseek-v4-flash`，沿现役 `invokeCorrectKpProposalBundle`、同源修订范围验证及完整提案重验；不执行Rules、Room、随机、资源、旁白或发布。

| 固定样本 | 提案形态 | 允许的固定修订 | 实际结果 |
| --- | --- | --- | --- |
| terminal-knowledge | terminal / knowledgeReview | 4处：非活动adjudication、proposals补齐；已有知识引用去重；inquiry首尾空白规范化 | 一次correction后完整束等于冻结预期 |
| shared-observation | 共享check，worldInteraction / observe / worldInteraction | 4处：basisRefs去重；非活动直接成功步骤failure补齐；consumes去重；method首尾空白规范化 | 一次correction后完整束等于冻结预期 |
| authored-item | directSuccess，定义创作、物品物化、库存操作 | 3处：非活动terminal补齐；basisRefs和prospective consumes去重 | 一次correction后完整束等于冻结预期 |

诊断来自原首遍校验器，样本覆盖 `FIELD_MISSING` 和 `VALUE_INVALID`；4/4/3指修订操作数，不是诊断条数。模型只能填写票据已确定的路径和值；不能换目标、DC、费用、后果或补造裁决。expected、ticket和request的hash均与预检记录一致；执行脚本在修订调用后断言ticket未变。收尾从每个原result重新比较完整bundle与对应expected，三个均逐字段相等，没有清洗响应或忽略字段制造通过。

## 已发生结果与费用

真实调用于2026-09-06 21:11:14.920–21:11:18.089（Asia/Shanghai）完成；主代理收取exec 63996 exit 0。三次均HTTP 200、`finish_reason=tool_calls`、`locallyAccepted`、`repairUsed=true`，未尝试的样本为空。

| 样本 | 输入 | 命中 | 未命中 | 输出 | 总耗时 | 周日空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| terminal-knowledge | 1,683 | 0 | 1,683 | 113 | 1,207ms | ¥0.003033 |
| shared-observation | 2,620 | 0 | 2,620 | 150 | 1,151ms | ¥0.004605 |
| authored-item | 2,301 | 1,024 | 1,277 | 114 | 810ms | ¥0.0024797 |
| 合计 | 6,604 | 1,024 | 5,580 | 377 | — | ¥0.0101177 |

三次均保存完整usage，无新增未知费用。按同日已核验[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)的空闲价，用Decimal逐调用复算：每百万hit/miss/output为¥0.05/1.5/4.5，价格snapshot SHA256 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`。费用全部记开发诊断，合成首遍没有模型调用费用。

本批证明三个固定输入上的真实模型修订可完成通用填表修复，并保持完整冻结提案束。它不是自然首稿的真实错误发生率、修复前后对照、统计成功率、完整Room链、真实掷骰/资源恢复或整桌游戏验收；不能据3/3声称成功率已经提高。越界拒绝和其他诊断类型仍以其直接本地行为测试为证据，不外推本批覆盖。

脱敏usage、修订路径/操作、精确比较及产物hash见[真实证据](vnext-round34-live-evidence.json)，累计见[成本账](vnext-cost-estimate.md)。私有产物位于 `/tmp/zhuwei-diagnostics-live-34-private/`，脚本 `/tmp/zhuwei-diagnostics-live-34.mts`；收尾未调用外部API、未更改产品源码、未部署或push。
