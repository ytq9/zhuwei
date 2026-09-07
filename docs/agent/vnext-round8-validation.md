# vNext round8：按需 schema 装配与有界真实对照

- 日期：2026-09-06；`cloudflare`，基线 `258caee404e0814405eb497653ee9f00d647b773`，未提交开发树。
- 用户明确批准 [schema 补取合同](schema-retrieval-contract-proposal.md)。SPEC 0015 §6.1、SPEC 0016 §§7.2/10/12 与规格索引已同步。
- 结果：通用装配、补取、严格解析及 Room 恢复闭环通过定向测试。**真实补取后提交与 V11 采用门仍未完成。**

## 能力合同与代表性矩阵

KP 可从轻量目录取得当前注册的完整能力 schema。普通库存、场景交互、叙述承诺直接提供；场景物化、物品实例和 Ability/Hazard/Item 创作可按需取回。注册表描述能力语义及类型依赖，不读取物品名或动词进行路由，不以已有对象存在推断无需创造内容。

| 变化维度 | 验证路径 | 结果 |
| --- | --- | --- |
| 普通行动 | 控制件交互首轮直接提交，真实 Room 状态转移；保存回复后驱逐恢复 | 通过，无补取或重复世界变化 |
| 复合物品 | 请求 authorItem，闭包补齐 Ability、实例及库存能力；同束定义、创建、获取和使用；最终摘要窄修订 | 通过，库存余量 1；三个阶段分别保存且最多一次 correction |
| 不同依赖结构 | authorHazard 闭包补齐 Ability、场景物化及 worldInteraction；实例任意更名 | 同一注册表、严格 schema 和领域解析通过 |
| 漏召回与越界 | 未加载 authoring、未知 ID、重复/无新增能力请求、混合草稿、二次补取 | 技术拒绝，不消耗窄修订，不产生世界/资源副作用 |
| 恢复及权限 | 补取与最终 Proposal 各自保存后中断/驱逐，外部 principal、并发重复、伪造票据及 completion | 通过；确切请求与回复复用，未重复调用或提交 |
| 预算及故障 | 429 截止时间、决定性上下文超限、完整 correction 请求超限 | 通过；技术错误不转世界内拒绝 |

## 实现与直接消费者

- `proposal-capabilities.ts` 是能力标识、描述、初始集合和传递依赖的唯一目录；schema 字段仍来自现有 `proposal-schema.ts` 与 authored contract，未复制机械 schema 或删除其约束。
- `offer_kp_proposal_bundle` 是单一 strict 工具，采用平坦根对象。`mode=schemaRequest` 时仅能力标识携带信息，basis/proposals 必须为空，两种裁决必须是 none；普通提案的 `requestedCapabilities` 必须为空。最终调用使用所选完整 `submit_kp_proposal_bundle`，不再提供补取。
- `proposal-provider.ts` 在现有 closed-domain 校验之外检查本轮能力范围；补取 schema 和返回校验使用同一个闭包结果。修订继续使用既有 summary-only ticket 和完整领域重验。
- `adapter.ts` 在每次预算测量前装配完整请求，通过同一 Provider binding 和 Room journal；遥测新增 `offer / expandedProposal / correction` 阶段，所有实际调用带 ordinal 和 usage。
- `vnext-proposal-invocation.ts` 根据已保存响应证明唯一合法后继，Room 不能仅凭调用者的 ordinal 或票据授予下一次调用。普通 1→2 correction；补取 1→2 Proposal→3 correction。修订后无第四阶段。
- workflow 纳入目录政策 hash、offer 工具 hash 和调用上限；确切请求 hash 冻结实际工具 schema。恢复不重新选择能力或版本。
- DO 本地开发 journal 的新建表允许第三阶段，未建设旧开发房兼容或迁移。该工作使用新建 vNext 测试房；不表示旧工作流房间可跨 manifest 恢复。生产 V3 Registry、部署和远端数据未改变。

## 验证证据

- `npx tsx --test tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/deepseek-strict-schema-compaction.test.mjs tests/vnext-local-room-binding.test.mjs`：**41/41，exit 0**。
- `npx vitest run tests/kp-vnext-provider-room.test.ts`：**8/8，exit 0**。
- `npm run typecheck`：**exit 0**。
- 最后修正重复 JSON 成员测试，使其使用当前平坦协议，并补新增直接入口的 modelId/message/contextHash 调用前检查及零 Provider 调用断言；单独重跑 schema-retrieval 文件 **4/4，exit 0**，与上述 41 项重叠，不累加。
- 首次检查发现 TS 分支收窄错误、成本断言未达及 Item fixture 未通过自然语言召回其真实来源。分别修正类型分支、将物化能力纳入可补取集合、使 fixture 明确引用其来源；未添加生产物品名或动词判断。
- `git diff --check`、目标文档直接链接及证据数字核对通过。未运行全量测试、Lint、build、migration、push 或部署。

## 真实请求与成本

本批上限：8 次调用、120k 输入、12k 输出；一次正常 Cookie HTTP 游戏请求，首个明确失败后停止游戏采样，仅追加一次不提交的结构对照。实际 **2 次，40,483 输入 / 1,028 输出 tokens**，无未知 usage，服务与捕获进程均已停止。

1. 正常 HTTP → 真实 DeepSeek → Room journal：首版嵌套 offer 收到非法 JSON，尽管 Provider 返回 `finish_reason=tool_calls`，仍在解析前拒绝。输入 **20,266**、输出 **446**；无 correction、Rules 提交或 Narration。前后完整公开 authority、时间、Pending 和 Receipt 比较相同，库存仍 20、HP 28/28。
2. 去除新增嵌套层，保留既有 Bundle 根字段，并添加严格的 schemaRequest 模式。使用**相同冻结上下文和系统 messages**作一次真实对照：输入 **20,217**、输出 **582**，本地解析及类型范围校验 accepted，用时约 **4.77 秒**。该对照**没有提交 Room，也没有 Narration**；单次成功不足以证明 Provider 稳定性或认定嵌套是唯一根因。

| 同一源码的装配对照 | 完整工具 | 当前首轮 offer | 降幅 |
| --- | ---: | ---: | ---: |
| schema UTF-8 字节 | 47,346 | 21,199 | 55.2% |
| 含描述/能力目录的工具字节 | 48,770 | 25,161 | 48.4% |
| 相同冻结上下文/system 的完整请求字节 | 91,050 | 67,441 | 25.9% |

完整工具列是同快照离线装配测量，没有为它额外调用模型；不得把这些字节降幅当成实际 token 降幅。真实 input 20,217 仍超过简单 8k / 全体 16k 门，schema 降幅也未到 60% 目标。历史 round7 的不同房间不能充当本轮同快照 token 基线。

脱敏详情见 [live evidence](vnext-round8-live-evidence.json)。原始请求、回复和会话仅留在本机 `/tmp/zhuwei-vnext-round8-*` 的私有测试文件中，未入库。

## 未覆盖范围

- 真实模型主动请求 schema 后的完整提交尚未验收；当前证据是受控 Room 纵切和真实普通提案格式对照。
- 当前实现有阶段上限、单次请求预算、逐调用遥测和外部批次计数；**没有持久的 RootAction 累计 token/费用/重试硬上限**。同 ordinal 的 Provider 重试覆盖 journal 行，但每次调用仍有日志及批次计数。此缺口不能标为 V11 已完成。
- 本批模型摘要仍写入未支持的箭袋、地面材质等细节，并出现不自然或相互抵触的措辞。严格 schema 不负责证明这些叙述为真；相关生成与 Grounding 质量仍待补齐。
- 不证明连续 V01–V03、完整 Narration、p95/平均调用门或生产替换完成。下一步先降低输入中的事实/填写面成本并改进模型文本质量，再开始新的有界真实验收批次。
