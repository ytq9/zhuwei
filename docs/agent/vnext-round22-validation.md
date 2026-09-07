# vNext round21/22：知识回顾实测与破折号审核边界

日期：2026-09-06；分支 `cloudflare`，基线 `258caee404e0814405eb497653ee9f00d647b773`。保留既有未提交工作。本记录只覆盖知识回顾 terminal、review/v4 和标点间隙修复，不代表完整 vNext、旁白稳定性或生产替换验收通过。

## 目标、合同与代表性矩阵

获认证玩家通过原自然语言 HTTP 入口回顾本人已持有知识；模型选择 `knowledgeReview`，服务器按完整目录全选或核对所选记录，Rules 产生私有回执与 Claims。知识、世界事实、角色、资源、虚构时间、危险与聚光灯不因回顾改变，审计事件链可以更新。完整本地矩阵见[知识回顾验收](vnext-knowledge-validation.md)。

两批各预设最多 1 个根请求、3 次 Provider 调用、174,000 输入/24,576 输出 tokens，首个明确失败即停止。均为新建本地房间、正常认证 Cookie HTTP 与真实 `deepseek-v4-flash`；没有增加不提交的 Provider 对照。机械与 replay 检查直接使用各批实际保存的状态和事件。

## 实测结果与根因

| 批次 | 真实结果 | 提交与停止边界 |
| --- | --- | --- |
| round21 | 模型选择正确的 `knowledgeReview/allKnown`，但根 `basisRefs` 多填 1 项，违反既有闭合 validator，返回 `PROPOSAL_FORM_INVALID` | 1 次调用后停止；0 事件、0 回执，世界与时间不变；实际 genesis/空事件 replay 与保存状态精确一致 |
| round22 | 补充 wire 字段描述及共用指导后，模型根 `basisRefs=[]`、`knowledgeRefs=[]`，Proposal 合法，Rules/Room 提交 1 条私有 `KnowledgeReviewed`；生成返回 JSON，review 返回工具但原文对齐失败 | 3 次调用后停止；1 回执，Delivery rejected，公开错误 `NARRATION_BODY_INVALID`；实际 replay 精确等于存储，冻结 Context conform。机械提交未因旁白失败回滚 |

round21 的修复只把已经执行的约束明确写入 `proposal-schema.ts` 与 `proposal-guidance.ts`：知识引用放在 `terminal.knowledgeRefs`，根 `basisRefs` 必须为空。未放宽 validator，也未按旧响应补删字段后重判成功。

round22 的确定失败点为候选第 6 段（`segmentIndex=5`）第 3 个断言前（`assertionIndex=2`），原文 offset `[23,25)` 是两个 U+2014，即完整中文破折号。原 validator 只接受空白、逗号、句号与分号作为断言间隙，在该处抛出 `ModelOutputValidationError`。其余间隙是中文逗号；6 个 segment 与 2 个 coverage 身份齐全，必需 fact 0 covered、可选 fact 1 omitted，目录 hash 一致。这里只报告结构定位，不以引用存在证明语义蕴涵或旁白质量。

两批原始机械证据均确认 knowledge、canonicalFacts、entities、campaignRuntime、combatRuntime、fictionTimelines、spotlight 与 frontier 时间不变。round22 审计事件序号、回执、hash 与 frontier.eventHeadId 正常更新。机械证据里的 `modelInvocations=1` 仅指持久化 Proposal journal，round22 的真实总调用数仍为 3。

## 后续修复与定向检查

`narration-vnext.ts` 将逐字符分隔判断改为完整 span 的 `reviewSeparatorLength`：仅允许恰好两个 U+2014，且两侧最近非空白均为非数字文字。单破折号、三个以上、ASCII 横线、漏实质字、问号/引号及数值范围仍拒绝；数字检查覆盖空白邻接、Unicode 数字与中文数词。正文与断言均不清洗，目录、事实覆盖、Viewer 权限、45 秒共享期限和旁白最多两调用不变。Prompt 与 Policy 记录 `complete-separator-spans/v2`。

| 检查阶段与目标 | 结果 | 日志 |
| --- | --- | --- |
| round21 后 Proposal wire 目标组 `tests/kp-vnext-proposal-schema.test.mjs` | 28/28，exit 0 | `/tmp/zhuwei-knowledge-wire-final.log` |
| round22 后新增合成破折号用例，修复前 | 0/1，exit 1，重现同类对齐拒绝 | `/tmp/zhuwei-round22-dash-red.log` |
| 修复后 `tests/kp-vnext-knowledge-review.test.mjs` 与 `tests/kp-vnext-narration.test.mjs` | 39/39，exit 0 | `/tmp/zhuwei-round22-final-node.log` |

测试总数已从原日志核对，退出码与 replay exit 0 来自执行交接回执。前序知识纵切的 Room 11/11 与 typecheck 是前序源码状态的证据，见[原验收](vnext-knowledge-validation.md)；未把它们写成破折号修复后的重新验证。

**round22 的真实审核失败保持不变。** 后续 39/39 只验证新合成样例及直接回归，没有用新算法重判旧响应，没有发布旧正文，也没有追加第三批真实调用。它不能证明真实模型修复后通过，或解除[round20 的完整 factCoverage 阻断](vnext-round20-validation.md)。

## 用量与证据

| 调用 | 输入 | 命中 | 未命中 | 输出（含思考） | 空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: |
| round21 Proposal | 17,771 | 0 | 17,771 | 197 | ¥0.027543 |
| round22 Proposal | 17,830 | 256 | 17,574 | 168 | ¥0.0271298 |
| round22 generation | 1,696 | 512 | 1,184 | 463 | ¥0.0038851 |
| round22 review | 4,257 | 0 | 4,257 | 5,400 | ¥0.0306855 |
| 合计 | 41,554 | 768 | 40,786 | 6,228 | ¥0.0892434 |

generation/review 分别报告 322/4,182 reasoning tokens，已包含在输出中，不重复计费。4 次调用均有 usage，全部计开发验收。按既有 round6–22 成本账范围，从原脱敏批次文件与本次捕获 usage 重算为 44 次尝试、43 次已知用量、399,115 输入/44,263 输出，已知空闲标价 ¥0.54136405–0.6555008，另加 round12 一次 HTTP 400 的未知费用；round8/9 缓存拆分缺失保留区间。详见[脱敏证据](vnext-round22-live-evidence.json)与[成本账](vnext-cost-estimate.md)。此累计不包含既有成本表范围之外的更早批次。

新证据只保存调用用途、usage、结果、hash 与数值诊断；不保存私密正文、reasoning、身份、会话秘密或完整投影。hash 绑定捕获文件/序列化对象，不冒称 HTTP wire hash。各批 Workflow hash 取自原调用日志；下列清单均在对应真实调用前保存，各含 288 个文件，原文件保持不变，并非事后重构：

| 调用前源码证据 | 清单保存时间（UTC） | 原 manifestSha256 |
| --- | --- | --- |
| [round21 source manifest](vnext-round21-source-manifest.json) | 2026-09-05 20:35:24 | `b6acf3dc347dcdda8b61beeed5e52ab26bc5c55fb1ff97ce6e0ce303fbf78b0e` |
| [round22 source manifest](vnext-round22-source-manifest.json) | 2026-09-05 20:38:17 | `5acabf75df18387d24bb768f13c79c7acd548d4024fbb8e938a4ac0e917201c0` |

清单绑定各批调用时的源码，不能把后续标点修复或其他实现冒称为该批已实测的源码。

## 处置与未覆盖

据执行交接，两批本地 server/capture 均已 Ctrl-C、exit 130，主代理另核验无对应后台进程。没有 commit、push、部署、远端 migration 或生产数据退役。原件只保留在本机私有 `/tmp/zhuwei-vnext-round21-*`、`round22-*`。

真实知识回顾现已证明 Proposal → Rules/Room → 私有事件/Claims → replay 的机械纵切；完整可用旁白仍未通过。本批未执行实际旁白恢复、重复 submission、复杂行动或连续多人链；其受控 fixture 证据不能替代真实调用。到期 Activity、其他 Form、累计 RootAction 预算、20+ 双玩家链、A–O、部署与退役继续按[总 TODO](vnext-production-todo.md)推进。
