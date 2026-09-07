# vNext round32：v20 普通与复杂真实主链

日期：2026-09-06。cloudflare / 258caee404e0814405eb497653ee9f00d647b773 的未提交开发树；源码冻结于 [manifest](vnext-round32-source-manifest.json)。本批运行时 parser v20，strict producer 对象合同、结构化诊断与一次表示确认均经定向验证；不复用上一批草稿或房间。该清单保留本批历史源码身份，不代表后续开发树。

预算预设为最多两个新行动、十次实际模型调用、580,000 输入和 81,920 输出 tokens、十分钟，单个可能调用模型的 HTTP 请求预留五次调用与120秒。未知 usage 按最大额度计预算；按高峰全未命中算最坏 ¥2.47728，批次费用上限 ¥2.50。全部为开发验收费用。当前官方价格已重新抓取：deepseek-v4-flash 周日空闲每百万 hit/miss/output 为 ¥0.05/1.5/4.5，高峰为双倍；[价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) HTML SHA256 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`，本地文件 `/tmp/zhuwei-deepseek-pricing-round32.html`。

通过正常注册/Cookie、建房、建卡/开团及 `/api/game` 测试。先依据实际场景作不接触物品的普通观察，完成提案、Rules/Room、Viewer、旁白与幂等，再根据已公开结果继续需要补取 schema 的复杂行动。没有触发 schema 补取时诚实记录未覆盖；不通过重复试词挑选成功。合法待决保留原 root，不作失败重抽；明确失败立即停批定位，不追加采样。产品源码在真实调用期间不修改。

私有 harness、Cookie、捕获和 SQLite 证据位于 `/tmp/zhuwei-vnext-round32*`，文件600/目录700。4320/4321启动前均无监听。已完成调用的结果与结账如下；预算、计划和旧版本测试不证明当前真实主链成功。

## 首次结果及单次审核对照预算

首个普通观察 Proposal 接受并提交9事件、1 Receipt；旁白生成成功，审核在剩余43,355ms内超时，返回 `NARRATION_PROVIDER_TIMEOUT`，未发布新旁白。实际3次调用，其中2次有usage，33,059输入/1,472输出（hit1,408/miss31,651），已知费用¥0.0541709，审核1次费用未知。批次停止，未发第二行动；两个本地服务已停止。SQLite replay精确等于当前状态，库存/资源/虚构时间未变、没有随机；冻结受众上下文conformance通过，不能因此声称叙述语义已通过。

代码证据：`narrateFrozen` 的生成和审核共用45秒，review使用enabled thinking/low、8192总completion预算。为区分当前审核延迟与思考模式的影响，仅追加一次不提交、不发布的表示对照：从同一持久冻结projection和已保存生成正文重建同源review输入，保持全部messages/schema/model/output限制，只将thinking改为disabled。45秒、12,000输入/8,192输出，仍计入本批10次调用、总token和¥2.50预算。无自动重试；无论结果如何不改判原行动完整成功，不重跑Proposal或机械，不以单样本证明稳定性。对照结果将决定是否调整审核配置，或保留配置并继续定位。

## 已完成审核对照与费用收尾

唯一对照已完成，私有记录为 `/tmp/zhuwei-vnext-round32-private/review-control.json`：2026-09-06 20:23:32.873–20:23:40.308（Asia/Shanghai），记录的 `durationMs=7434`、`status=completed`。实际请求为 `deepseek-v4-flash`、`thinking.type=disabled`、`max_tokens=8192`；输入估算10,662，实际9,067。响应 `finish_reason=tool_calls`，工具 `review_frozen_narration` 的 arguments 是合法JSON，但原本地校验结果为 `accepted=false`、`reason=ModelOutputValidationError`，未通过审核合同。捕获未保留更细错误位置，不能据此编造具体拒绝原因，也不能声称关闭思考模式已修复审核。

对照请求hash为 `e16b82d364ff73868a60a2f675c24e5e470d6abc004d3c54ed5c0d84f86ccdae`，记录的原请求hash为 `caa7d4a4221c7967bf695848665a919aa8441862e97012c71d0e2fb8ad8e114c`，候选正文hash为 `c71dd151d599b026b2fd29387b2c40dbc4a7c3437bd973caf8ff5e41ed2c9bf2`；私有对照capture SHA256为 `d9dd026f8788b3c898915ea62d3e970766dc3580e27bf3430676e1532db12980`。收尾仅核对既有记录；原超时请求没有单独响应capture，两个请求hash本身不能证明除thinking外的逐字段等价。

| 已发生调用 | 输入 | 命中 | 未命中 | 输出 | 周日空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Proposal | 29,973 | 896 | 29,077 | 1,343 | ¥0.0497038 |
| 旁白生成 | 3,086 | 512 | 2,574 | 129 | ¥0.0044671 |
| 原旁白审核超时 | 未返回usage | 未知 | 未知 | 未知 | 未知 |
| 唯一不提交的审核对照 | 9,067 | 896 | 8,171 | 1,691 | ¥0.0199108 |
| 本批已知合计 | 42,126 | 2,304 | 39,822 | 3,163 | ¥0.0740817 |

私有session的meter只统计正常HTTP的3次调用：已知33,059输入/1,472输出，另1次审核未知；对照capture是独立的第4次attempt。上表按3份已有响应usage重新复算，未改写session或预算账本。最终口径为4次尝试、3次已知usage、1次未知费用；旁白生成报告的6个reasoning tokens已含在129个输出中，不再重复计价。未知审核的预算占额不是实际usage，不能记为零费用。

对照没有提交或发布，也没有重跑Proposal、Rules、随机或资源；原行动仍为机械已提交、旁白未发布，普通完整主链和复杂schema补取未通过。独立只读审查另发现生成正文将“没有明显的窗”升级成“没有窗”等语义问题，本次记账不处理或改判这些问题，不把校验超时视为唯一剩余缺口。主代理已收取对照进程session 27771（exit 0），capture进程77588已退出143，并确认4320/4321无监听；本次收尾未启动服务或模型请求进程，也未新增外部调用。

本批费用全部计开发验收，累计同步[成本账](vnext-cost-estimate.md)。本次仅补完已发生调用的证据与费用，未部署或新增真实测试；后续行动范围以当前任务授权为准。
