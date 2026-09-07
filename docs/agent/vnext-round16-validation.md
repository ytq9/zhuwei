# vNext round12–16：旁白模式、结构校验与真实 HTTP 再验证

日期：2026-09-06；分支 cloudflare，基线 `258caee404e0814405eb497653ee9f00d647b773`。保留既有未提交修改。本文是阶段证据，完整 vNext Goal 尚未完成。

## 实现与判断边界

- `deepseek.ts` 原先无条件关闭 thinking。现在尊重服务端显式的 enabled/disabled 与 low/high/max，非法配置在 I/O 前拒绝；未指定的消费者保留原绑定默认值。vNext Proposal 继续现役 strict tool / disabled 配置，没有换模型。
- vNext 旁白固定为一次 JSON body 生成、一次工具审核；两者启用 low thinking。generation 不依赖自动工具选择；review 仍严格要求唯一正确工具。每次 completion 含思考与正文，预留 4096 思考 tokens、总上限 8192；两阶段共用现役 45 秒期限。输出模式、预算、Prompt/schema 进入 Workflow hash；提示词版本记录为 `kp-vnext-narration-policy-v2`。
- vNext 独立响应提取器拒绝重复 JSON 成员（任意深度）、截断/错误结束原因、错误输出模式、额外 envelope。只读取最终 content 或工具参数，不解析/发布 reasoning_content，不清洗非法结果、不增加重生成。
- review/v3 分离逐断言依据与逐 fact 覆盖。所有 fact 恰有一条 covered/omitted 行；必需结果不能遗漏，optional actionCommitted 可遗漏。完整结果可由多个 grounded worldFact 合并表达，但须保留对应 claim 组依据；历史、普通动作实现、同名文案都不能替代结果/身份。
- 断言按原文单调对齐，仅允许白名单空白、逗号/分号/中文句号间隙；数字两侧逗号、问号、引号、括号、负号、省略号等不能被跳过。最终 body 原字节保留。

## 有界外部证据

每个诊断在调用前固定材料、目的、次数、输入/输出和 deadline；失败后不追加相同参数采样。所有调用均为 `deepseek-v4-flash`。原件仅在本机私有 `/tmp/zhuwei-vnext-round12-*` 至 `round16-*`，凭证与 reasoning 未入库。

| 批次 | 调用及结果 |
| --- | --- |
| round12 | 同 round11 冻结材料生成/审核两调用仍失败：新增“箭袋”，审核误放行且漏必需结果。随后各一次参数诊断：thinking+required 返回 400（该脚本未保存错误正文，用量未知，不能声称原因已证实）；auto+high 返回 200，但 4000 completion 全为 reasoning、length/无工具；auto+low 完成审核并识别“箭袋”越界，仍存在其他不正确的分类/证据。不能称完整审核通过。 |
| round13 | 显式 thinking+auto generation 一调用返回普通 content，无工具/JSON，固定 parser 拒绝；该批停止。 |
| round14 | 固定 JSON generation + tool review 经实际 Adapter 两调用通过，正文“你将一支弩矢放在脚边。”；共约16.44秒，4152输入/2163输出（已包含1817 reasoning）。这是旧 Room 冻结材料的非提交诊断，不是新 HTTP 游戏成功。 |
| round15 | 正常 Cookie HTTP 新房一次库存行动，3调用。Proposal 合法提交 inventoryOperation + narrative detail；正文有承诺依据，但审核漏原文逗号且漏两项必需覆盖，发布拒绝。首次失败后停止，没有提交第二个复杂动作。 |
| round16 | review/v3 用 round15 的同冻结材料/原正文作一次非提交审核。完整 coverage 行已出现，但模型为 payload.status 摘录了实际不存在的句子，又把 inventory fact 索引配上另一条 narrative detail 文本；结构校验拒绝。仍是明确未处理的寻址/审核可用性问题。 |

round15 实际 SQLite genesis + 3事件（InventoryOperationApplied、NarrativeDetailCommitted、AtomicWorldInteractionStepsResolved）重放精确等于存储，所有冻结 Narration contexts conform，脚本 exit0。库存弩矢20→19、场景实例1，HP28/28、职业资源不变、fictionTime0、Pending空、Receipt1。机械提交没有因旁白失败回滚。capture/server 已 Ctrl-C 停止（退出1/130）。没有生产修改、push、migration、部署或数据退役。

详见[脱敏调用与usage](vnext-round16-live-evidence.json)、[round15精确源码差量](vnext-round15-source-manifest.json)。JSON 中 requestCanonicalObjectSha256 是规范请求对象摘要，不能冒充原 HTTP wire 字节 hash。12次已尝试调用，其中11次有usage：42155输入/15177输出，空闲标价约¥0.1085146；另一次400用量未知，不能记为零。reasoning_tokens 已包含在 completion_tokens 内，不另加计费。

## 定向检查

- `npx tsx --test tests/kp-vnext-narration.test.mjs tests/table-server-outcome-v2.test.mjs tests/deepseek-strict-tool-provider.test.mjs`：44/44，exit0；`/tmp/zhuwei-vnext-round16-node.log`。
- `npx vitest run tests/kp-vnext-provider-room.test.ts`：10/10，exit0；`/tmp/zhuwei-vnext-round16-room.log`。
- `npm run typecheck`：exit0；`/tmp/zhuwei-vnext-round16-types.log`。diff-check通过。未执行全量测试/Lint/build。
- 以上证明模式/解析、依据出处、覆盖结构、公开错误、两调用/超时/恢复合同；模型是否正确拆分断言、证据是否真正蕴含正文仍是模型判断，不由手工审核 fixture 证明。

## 直接后续与其他独立差量

当前优先将审核证据改为从冻结材料生成的统一可寻址目录，避免模型重建多套 index/path/quote；不得修补旧非法响应为成功，也不得合并同名对象的事实。该方案在本记录时尚未实施。

到期 Activity 的独立只读审计也已复现：`startRest → 8小时经过 → vNext worldInteraction` 绕过 Rules 到期预检，长休仍 active/HP10；同状态旧输入先独立 activity-due 根结算、HP20。私有 `/tmp/zhuwei-due-audit.afSiHY/due-activity-red.mjs` exit1。完整修复需共用 Rules selector，保留每个 child 的历史及恢复、另一玩家短休骰的有限授权、同 timeline 异场景读写保护、canonical due 时间、逐项 drain 与父动作重新 prepare；不能仅交换调度行。该问题尚未修改源码。

非行动知识回顾、独立 observe/social/objective/story/combat、澄清/高风险冻结续行、动态人物/地点/通路、累计 RootAction 预算、A–O/20+双玩家链、构建/部署/旧房退役仍未完成。统计认证/SLO仍后置。

官方模式依据（2026-09-06 03:04–03:15核验）：[thinking](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)、[JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode)、[工具](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)、[completion参数](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion)。文档支持不替代上述具体运行结果。
