# vNext round37–40：审核协议探针失败收尾

2026-09-06；四次均已结束，不重新调用。沿用 round33 同一冻结材料与候选正文，产品旁白仍为 v6，未采用实验配置。每批预设最多 1 请求、12,000 输入、8,192 输出、45 秒、¥0.11；不执行 Proposal、Rules、Room 提交或发布。

| 批次 | 唯一对照 | 真实结果 | 判定 |
| --- | --- | --- | --- |
| 37 | 重现 strict required + thinking，并保存错误正文 | 220ms，HTTP 400：`Thinking mode does not support this tool_choice` | 该组合不兼容；不解释原 auto 超时 |
| 38 | strict required + thinking disabled | 3,088ms，HTTP 200，429 输出 token；原完整 validator 拒绝 | 快速返回不代表审核通过 |
| 39 | strict auto + thinking enabled | 266ms 收到 HTTP 200；45,007ms 时仍 0 正文 bytes | 超时，原因未确定 |
| 40 | JSON review + thinking enabled | 246ms 收到 HTTP 200；45,008ms 时仍 0 正文 bytes | 超时，原因未确定 |

round38 对同一正文的审核存在三个具体问题：f2 属于另一 inventoryOutcome Claim，却只引用第一个 Claim 的证据；optional f3 既未覆盖也未明确省略；审核的statement把“没有点燃这个动作”加强为“这根火把没有被点燃”的物品状态，并仅引用“已放下”作为依据。原round33玩家意图明确含“不点燃”，不能将原句一概判为KP创造新动作；普通动作实现与独立物品状态必须分开判断。原句“脚边”的精确落点仍未有权威空间材料证明。不得删 Claim、合并不同 Claim、补引用后把旧响应改判为成功。脚本 exit 0 仅表示完成采集，其 validation.accepted=false。

四次新增 4 attempts / 1 known usage；只有 round38 保存完整 usage：4,462 输入全部未命中、429 输出，按当日已核验的官方空闲价 Decimal 复算 ¥0.0086235；另外三次费用未知，不记零。round6–40 累计 76 attempts / 65 known usage，761,225 输入 / 63,022 输出，已知 ¥1.12551415–1.2396509，另 11 次未知费用。全部计开发诊断，不用于成功行动均价。

证据与原始产物 SHA 见 [脱敏证据](vnext-round37-40-live-evidence.json)，费用见 [成本账](vnext-cost-estimate.md)。私有请求和响应保留在 `/tmp/zhuwei-review-{error-37,compatible-38,thinking-auto-39,json-40}*`，未写入公开 DTO。37 的请求 hash 与 round36 完全相同；37 得到的错误正文仅证明这次服务端拒绝原因，不补造 round36 未保存的正文。

本批调用发生在 social B 集成之前，继承记录的 305 源文件清单仍为 [round34 manifest](vnext-round34-source-manifest.json)。本次仅按原产物记账，未重跑模型、修改旁白产品源码、放宽审核、部署或 push。完整行动及连续游戏稳定性仍未通过。
