# 一次差量修订的开发期验收（2026-09-09）

本次目标是减少 KP 修补时重复输入和完整输出的开销，保留一次修订。用户批准的能力合同：KP 在同一完整冻结上下文、玩家目标/做法、授权与既成事实内，可以用字段/对象/数组/步骤补丁或完整替换修改尚未生效的方案；Room 以持久状态准入、保存并恢复，所有合成结果完整重验，确认、随机或执行前冻结。三轮、¥0.30、60 秒及总调用 5/6 次的草案预算未启用。

## 实现与代表性矩阵

| 变化或边界 | 证据 |
| --- | --- |
| 检定属性为空或缺失，同时修改已有 DC | JSON Patch 补齐 ability 并改 DC；真实 Room 路径最终使用修改后的裁决，等待玩家主动掷骰 |
| 修改整个对象/数组、插入步骤 | 与结果序号配套时通过；遗漏对应关系时拒绝，服务器不代排或猜配 |
| 原始 JSON 无法解析 | sourceDraft=null，只允许完整替换；原始字节留在私有 ticket，重复 JSON 成员拒绝 |
| 修补后暴露下一项错误或重复同稿 | 一次额度耗尽后返回具体原因，无第三次裁决；不以错误数量作进展判据 |
| 错误版本、越权路径、非法引用、不可应用操作 | 补丁在副本上原子应用；任一失败整份丢弃，完整替换也经过相同校验 |
| 重排后的结果与 Rules 执行顺序 | 诊断使用实际结果行与操作引用映射到填写路径，不把内部数组序号误当填写序号 |
| 保存响应后中断/驱逐/重复提交 | 复用精确请求和保存响应，不新增模型调用、骰子、资源或事件；已执行方案不能重新获准修订 |
| 运输重试与缺失 usage | 同一修订机会和请求，逐次尝试/时间/累计已知 tokens 私有记账；缺失 usage 或费用是未知值 |

主要实现：`proposal-revision.ts` 用 rfc6902 5.3.0 应用受限操作，额外拒绝宽松数组索引、危险指针及非模型内容路径；`proposal-provider.ts` 统一补丁和替换，再调用既有完整校验；`proposal-filling-interface.ts` 映射诊断；`adapter.ts`、Room transition guard 与 `authority-store.ts` 保存来源、响应、合成、预检及用量。所有调用者继续经过现役 lowering / Rules / Room 路径，无新增世界状态权威。

严格工具外层为 `sourceDraftVersion / revisionJson`，内层保留 mode=patch 或 mode=replaceDraft 文档。这样无需在每个 patch.value 下展开所有选中 schema。模型只收到一份填写草稿，原始字节及内部稿留作审计。系统公共说明和完整冻结上下文放在变化信息前；每次真实请求仍由完整输入预算检查，不通过裁剪上下文换取通过。

## 定向验证

- Node：13 个直接消费者文件，121/121 通过，exit 0。主用例为 `tests/kp-vnext-proposal-revision.test.mjs` 与 `tests/kp-vnext-unparsed-revision.test.mjs`；其余覆盖 schema、填写转换、NPC 计划、原生能力、时间、空间、来源、作者化对象及 probe 消费者。
- Worker：`kp-vnext-provider-room.test.ts`、`kp-vnext-ability-operation-room.test.ts`、`kp-vnext-npc-plan-formation-room.test.ts` 的目标用例 34/34 通过，24 个非目标用例未运行，exit 0。恢复测试主动注入的 `interrupted:afterRandomnessCandidateCommit` 是预期中断。
- `npm run typecheck`：exit 0。最终 `git diff --check`：exit 0。
- 定向日志：`/tmp/zhuwei-delta-revision-node-final.log`、`/tmp/zhuwei-delta-revision-room-final.log`、`/tmp/zhuwei-delta-revision-typecheck-final.log`。

## 两次真实 DeepSeek 对照

固定同一隔离场景、原稿和冻结上下文，模型 deepseek-v4-flash；最多两次调用，首个清晰失败停止。新入口自然返回补丁，仅把 `/decision/ability` 改为 `wis`；完整返回对照用同一选定表单返回全稿。两者均通过解析、完整本地校验、lowering 和纯 Rules 预检。

| 指标 | 差量入口 | 完整返回对照 |
| --- | ---: | ---: |
| 输入 tokens（Provider） | 13,384 | 14,154 |
| 输出 tokens（Provider） | 121 | 492 |
| 缓存命中 tokens（Provider） | 768 | 768 |
| 缓存未命中 tokens（Provider） | 12,616 | 13,386 |
| 完整请求字节 | 53,111 | 51,154 |
| 响应 arguments 字节 | 224 | 1,478 |
| 耗时 | 1.620 秒 | 3.359 秒 |
| 官方单价估算费用 | ¥0.0390138 | ¥0.0446628 |

两次合计费用估算 ¥0.0836766。价格在本次从 [DeepSeek 官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 核对：北京时间工作日高峰期，缓存命中/未命中输入/输出分别为每百万 tokens ¥0.10/¥3.00/¥9.00。这是实际 usage 配合公开单价的估算，不是账户账单。

差量请求字节数在这个样本中略多，而实际输入和输出 tokens 较少，不能用字节差代替 Provider 计量。两次调用不足以证明长期成功率、缓存稳定性或固定节省比例；完整返回对照重建旧响应形式，不等同于旧版本逐字 prompt 的随机对照实验。

第一次验证脚本把 lowering 的 `value` 参数误写成 `bundle`，产生 envelope-invalid，立即停批。修正脚本后复用已保存的第一份响应重验，通过后只调用一次完整返回对照；第一份补丁没有重新采样。原失败与更正报告均保留在 `/tmp/zhuwei-revision-comparison-20260909/`，审计脚本是 `/tmp/zhuwei-revision-live-compare.mts`。报告只记录纯预检结果；`committed` 表示 Rules 返回可丢弃的 Activity 开始候选，未写入活跃 Room，没有真实游戏提交或骰子。

## 未覆盖范围

- 多轮循环及新金额/等待/总调用数限制未获本次批准；保持现有一次额度与原 HTTP 限制，仅保存逐次/累计计量。成本字段在服务端缺少可确认账单时保留未知。
- 一个扩展到 NPC 来源的 Room 用例在 Proposal 填写前被 `PROPOSAL_INPUT_BUDGET_EXCEEDED` 拦截，未进入修补。定位证据为 `/tmp/zhuwei-revision-consumers3.log`；本次没有放宽预算、删除上下文或把它计入通过，也没有证明这是原基线问题。
- 此前大型 Item+Ability 上下文的前置预算缺口，本次没有重跑或声称解决。完整回归、连续真实游玩、线上发布与统计稳定性不在本次验证范围。
- 未提交、未 push、未部署、未运行远端 migration。
