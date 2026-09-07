# vNext round17–20：冻结证据目录与审核边界

日期：2026-09-06；分支 `cloudflare`，基线 `258caee404e0814405eb497653ee9f00d647b773`。保留既有未提交工作。完整 Goal 仍在执行，本记录不是旁白或生产替换验收通过。

## 症状、修改与直接消费者

round16 模型把 source/index/path/quote 配错。本次 review/v4 从同一冻结 Viewer 的 facts、payloads 和 establishedDetails 纯生成证据目录，模型只返回 evidenceIds。短编号绑定完整 catalog hash；引用不存在、重复、跨目录、历史冒充当前结果均拒绝。目录保留标量类型与完整值、原 source/index/path/claimIndex，原数组、对象、空容器与 null 通过引用形状保留，正文标量只出现一次。actorIntent、tone、recentDialogue 不进入事实证据目录；生成材料仍保持原合同。

逐断言审核与 factCoverage 保留。只读审查另发现：原校验把 fact 依据压成 claimIndex，允许同组的名称事实借给数量结果。现在 fact 依据必须匹配精确 fact.index；payload 依据仍按原 claim 组检查。这个检查只证明引用与覆盖结构，不能形式证明模型判断的语义蕴涵。

输入预算改在 `deepSeekRequestBody` 封装后的最终请求上检查，覆盖实际 model、stream、max_tokens 等字段；原边界探针的 12000 会变成 12011/12002。Adapter 传入实际绑定模型。review 在估算完整输出仍可容纳的前提下使用既有 8192 completion 总上限，避免短正文把审核思考截在约 4.8k；两阶段仍最多两调用、共用 45 秒，不加重写、清洗或自动换模型。Policy、目录/schema、Prompt、工具与预算方式进入 Workflow hash。

修改：`kp/narration-vnext.ts`、`kp/authoritative.ts` 与 `tests/kp-vnext-narration.test.mjs`。直接消费者为 Adapter 的初始/恢复旁白、公共错误 DTO、DeepSeek transport 与正常 Room Provider 纵切。

## 有界真实证据

每次诊断预先限制为一次不提交 Room 的审核，最多 12k 输入/8192 输出/45秒；round19 正常 HTTP 批次最多2动作/12调用、480k输入/96k输出，首个明确失败即停止。均使用 `deepseek-v4-flash`。

| 批次 | 结果 |
| --- | --- |
| round17 | round15 原冻结材料/原正文，1调用。正确目录 hash 和引用出现，但同文案、不同 claim 组的库存结果漏了一组依据，校验拒绝。 |
| round18 | 明确逐覆盖行补齐自己的 fact 依据后，对同材料1调用审核通过；2断言、5 coverage 行。只证明此次不提交诊断，未发布到 Room。 |
| round19 | 正常 Cookie 新房，普通库存动作3调用。Proposal 经 Rules/Room 提交，正文生成返回 JSON；review 的4837 completion全部为reasoning，finish=length、无工具，严格提取器拒绝。该批停止，未运行重复提交/ACK/复杂动作。 |
| round20 | 修复输入边界、精确 fact 覆盖和审核输出额度后，对 round19 原材料/原正文1调用。8192上限下实际用了4642输出（含4200 reasoning），正常返回工具；但只输出3条coverage，实际应有4条，并把必需的fact2当作optional遗漏，校验拒绝。没有修补响应或继续采样。 |

round19 实际停服 SQLite 副本的 genesis + 1条 `InventoryOperationApplied` 重放精确等于存储，全部冻结 Narration context conform；脚本 exit0。库存弩矢20→19、地面实例1；HP28/28、职业资源不变、fictionTime0、Pending空、Receipt1。机械提交未因旁白失败回滚。

6次调用均有usage：37109输入（hit12416/miss24693）、14362输出，空闲标价约¥0.1022893；reasoning已包含在输出内。详见[脱敏证据](vnext-round20-live-evidence.json)。费用均计开发，不是玩家完整游戏成本。

[round19源码清单](vnext-round19-source-manifest.json) 的174文件/hash `8bde2b3579bc979f301dd406b6b802acaf2ac68f277eef175befff6e5274692c` 绑定该HTTP批次；之后三个文件又有本节所列边界修复，其最终单文件hash在脱敏证据中。不能将round19清单冒称当前最终源码。

## 定向检查与未覆盖

- `npx tsx --test tests/kp-vnext-narration.test.mjs tests/table-server-outcome-v2.test.mjs tests/deepseek-strict-tool-provider.test.mjs`：48/48，exit0，`/tmp/zhuwei-vnext-round20-node.log`。
- `npx vitest run tests/kp-vnext-provider-room.test.ts`：10/10，exit0，`/tmp/zhuwei-vnext-round20-room.log`。
- `npm run typecheck`：exit0，`/tmp/zhuwei-vnext-round20-types.log`。未执行全量测试/Lint/build。

目录往返/稳定顺序、typed scalar、跨目录/历史边界、精确fact覆盖、最终请求边界、两调用/超时/冻结恢复都有确定性证据。真实审核仍会遗漏完整coverage，存在持续游玩阻断；不能把手工审核fixture、round18单次通过或增加上限当作模型稳定性证明。

本轮服务已停止（server与capture均Ctrl-C/exit130）。原件在私有 `/tmp/zhuwei-vnext-round17-*` 至 `round20-*`；round19 SQLite 副本目录为 `/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-round19-sqlite-g4u6uhp7`。未commit/push/deploy/migration/删除生产数据。三个子代理仅只读审查，没有并行写入或集成冲突。

下一步转向[非行动知识回顾与到期阶段](vnext-knowledge-and-due-plan.md)的独立能力，保留审核完整coverage问题为开放阻断项。其他 Form 家族、20+双玩家链、A–O、构建、部署、生产验证与旧房退役仍未完成；120条统计认证与长期SLO后置。
