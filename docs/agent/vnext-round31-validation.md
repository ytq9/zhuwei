# vNext round31：当前模型普通行动与后续主链

日期：2026-09-06，cloudflare / 258caee404e0814405eb497653ee9f00d647b773 的未提交开发树。源码冻结清单见 [manifest](vnext-round31-source-manifest.json)，包含本批运行时的 v16 诊断和共享执行器冻结身份修复；该清单保留历史源码身份，不代表后续开发树。

## 预设预算与验收

最多 2 个新行动、10 次实际模型调用、580,000 输入与 81,920 输出 tokens、10 分钟；每次可能调用模型的 HTTP 写入预留最多 5 次和 120 秒，未知 usage 按最大额度扣预算。按官方高峰全部未命中价格算最坏 ¥2.47728，上限 ¥2.50；当天周日实际用空闲单价。价格证据见 [Provider 合同复核](vnext-provider-contract-check.md)。全部为开发验收费用。

新 Cookie 注册、新房、正常建卡/开团；不清理或复用前批 session/草稿。第一条意图为普通非接触观察，验证 Proposal→Rules/Room→Viewer→旁白审核→发布及原 submission 幂等；第一条完整通过后，依据实际公开场景选择需要新物品/危险定义的复杂后续行动，由模型自主补取 schema。未触发补取则诚实记录未覆盖，不反复尝试命中。

首个明确失败立即停批并保存原始响应、准确原因、提交边界与 usage。合法待决保持原 root，不能视为模型失败重抽；当前 HTTP harness 的等待状态必须核验后再决定是否继续。成功批使用增量与完整 replay 核对，不照搬失败批的资源/时间不变断言。

私有 harness/capture/session 位于 `/tmp/zhuwei-vnext-round31*`；capture 目录 700，文件 600。4320/4321 在启动前均未监听。本轮不改变模型、清洗非法响应或增加语义修订次数。首失败停批与唯一传输对照结果如下。

## 首次结果与一次传输对照

首次 Proposal 失败停批：`JSON_SYNTAX / json:object-delimiter-expected`，path `proposals[0]`、UTF-16 offset 3595（line 1、column 3596）。标准 `JSON.parse` 同位置拒绝；finish_reason 为 tool_calls，输出 1,779 tokens，未达到 4,000 上限。仅一次调用，29,866 输入全部未命中，成本 ¥0.0528045。没有 correction 或旁白。SQLite 证据为 0 事件、0 Receipt、0 Delivery；同源码 replay 精确等于 state/genesis，库存、资源、时间未变。原始模型响应不修改，见[脱敏证据](vnext-round31-live-evidence.json)。两个本地服务已退出 130，监听已消失。

实际 strict 工具请求和 beta 入口与当天官方文档一致，尚不能定位远端约束未生效的内部原因。为判断自动生成的细粒度 `$def` 间接引用是否影响约束遵守，只追加一次**不提交 Room 的传输对照**：沿用同一冻结 messages、模型、thinking、max_tokens 与全部 schema 字段/约束，展开自动生成的定义引用，仅保留原 `proposals` 公共定义。通过完整展开后的 canonical 对比证明两份 schema 等价；请求估算 44,206，小于 58,000，完全展开的 61,908 超限方案不发送。

对照上限 1 调用、45 秒、58,000 输入/4,000 输出，计入本批原 10 调用及总 token/¥2.50 预算。无网络自动重试；无论结果如何均不重采样或作为原行动成功，不使用对照草稿继续游戏。该对照只能为输入表示选择提供单样本证据，不能证明成功率或远端内部根因。

## 唯一传输对照结果与结账

私有 `inline-control.json` 记录调用于 2026-09-06 18:40:22.277–18:40:30.021（Asia/Shanghai），耗时 7.744 秒。响应 `finish_reason=tool_calls`，工具为 `offer_kp_proposal_bundle`；JSON 语法合法，但原域校验以 `bundle:observe-invalid` 拒绝。本次原诊断仅为无 path 的 `CONSTRAINT_CONFLICT`，不得将后续细化诊断写成当时已经返回。

对照的 `proposals[0]` 为 observe，却声明了一个 producer。捕获的原始 strict schema 对该字段广告普通 producer 数组，未限制 observe 的数组长度为 0，所以这次域拒绝不能归因为 Provider 违反已广告的 schema。后续 v17 对同一未修改响应的离线定位为 `proposals[0].produces`、`proposal-producer-count`、expected 长度 0、actual 长度 1，见[诊断报告](vnext-proposal-diagnostics-validation.md#v17同源深层诊断与修订准入拒绝原因)。该定位没有新增真实调用，不将旧失败改判为成功。

收尾时重新比较两份捕获：messages、model、thinking、max_tokens、tool_choice、stream 完全相同，工具名称、strict 与描述相同。原 schema 的 26 个 `$def` 与对照仅保留 `proposals` 的 schema 全部展开后，以 UTF-8、递归键排序、紧凑 JSON 复算 canonical 完全相等，SHA256 为 `a1a4fce84f9b1b1a50a720c56382d23c66d59f58fe66cac06a5e4c3baae94364`。这证明本次表示变换保留已广告字段与约束，不证明原 schema 已覆盖全部域规则。

| 调用 | 输入 | 命中 | 未命中 | 输出 | 周日空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 正常 HTTP 首次 Proposal | 29,866 | 0 | 29,866 | 1,779 | ¥0.0528045 |
| 不提交 Room 的传输对照 | 38,229 | 896 | 37,333 | 895 | ¥0.0600718 |
| 本批合计 | 68,095 | 896 | 67,199 | 2,674 | ¥0.1128763 |

两次 usage 均从各自原始响应重新核验，使用本批当日已核验的官方空闲价复算；收尾未新增模型请求、服务或价格抓取。两次都不构成可用行动：首次未进入 Rules/Room 提交，对照只在本地校验且拒绝，没有提交 Room、correction、旁白或后续游戏。正常 HTTP 首调用的 0 事件/Receipt/Delivery 与精确 replay 证据只对应原房间，不能外推为对照经过 Room 的证据。

普通行动完整主链及复杂 schema 补取仍未通过；未做当前后续源码的真实模型对照，不宣称修复成功率提升。脱敏记录保留原稿哈希、请求哈希、历史诊断、对照等价核验与两次 usage，见[真实证据](vnext-round31-live-evidence.json)；累计费用已同步[成本账](vnext-cost-estimate.md)。本批到此关闭，新源码的验证需另开有预算的新批次。
