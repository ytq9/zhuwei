# 自然语言旁白与未交付结果取消：开发验收

- 日期：2026-09-17
- 分支：`cloudflare`。以本轮开始时的工作区快照核对差量，保留已有未提交修改；没有提交、push、部署或远端 migration。
- 授权：用户要求无法回复时自动回滚，并批准“可以改，连带着前面那些修改内容一起改了”。裁定理由见 [ADR 0026](../../adr/0026-provisional-results-and-natural-narration.md)，规则见 [SPEC 0015 §7–8](../../specs/0015-part-b-proposal-and-narration.md)。

## 交付边界

vNext 冻结 Claims 的新回复使用自然语言正文和 `status/issues.reason` 实质审核，至多一次修稿与复审。候选机械结果、持续行动开始和自动时间推进保持私有，全部受众回复就绪后才与世界一起提交；无法恢复或截止仍未完成时取消未交付候选。已固定骰面、精确外部调用及用量证据保留。后台取消也在玩家桌面显示未生效和重新描述行动的提示。

旧已提交回复及原 observer-projection 兼容协议继续按既有恢复合同解释；本轮没有把旧物理请求改写为新协议。旧版中断用例以真实 Rules 候选构造历史已提交数据库边界，继续验证原阶段身份、响应丢失、未知结果、晚到响应和有界修稿。

## 本地持久化操作审计

Room SQLite 新增 `authority_provisional_replies`、`authority_provisional_mechanics`、`authority_provisional_roots`、`authority_provisional_inputs`，并纳入空库检查与删除清理。准备分支保存原事件及状态；同一候选的截止时间持久化，等待玩家明确掷骰或稳定选择不由现实时间代答。

`authority_story_host_contexts` 的 CHECK 增加 `narrationSettlement`。构造器在同一同步事务内重建旧表并复制原行；测试真实构造旧 CHECK、保存生成响应、驱逐 DO、重新加载并恢复发布，确认旧上下文保留且新结算记录可写读。没有新增 D1 migration，也未执行远端变更。

取消证据通过私有宿主归档保存，恢复重建终局 submission 身份和调用证据，不把候选事件或未交付正文恢复为世界事实。实测成功/取消归档往返、真实提案调用随取消归档、并发重排后的取消归档、零旁白调用的取消归档。

## 实际验证

- `npx vitest run tests/kp/narration/provisional-reply.room.test.ts tests/kp/narration/interrupted-publication.room.test.ts tests/kp/narration/multiplayer-publication.room.test.ts`：37 项通过；新增晚到响应用例因夹具误把 Proposal 请求作为布尔检定参数而进入待掷骰，修正夹具后定向重跑该项通过。合计 38 项 Room 行为验收通过。
- `npx tsx --test tests/kp/narration/text-protocol.test.mjs tests/kp/narration/publication-repair.test.mjs tests/kp/narration/delivery-confirmation.test.mjs`：16 项通过，包含自然语言输出、简化审核、有界修稿、旧工作流 hash 保持和玩家恢复/取消提示。
- `npm run typecheck`：通过。
- `npm run spec:check`：0 错误、8 个既有尺寸/门时间戳警告。
- `git diff --check`：通过。文档链接扫描的 7 条失效引用均已存在于本轮前快照，没有新增失效链接。

模型 I/O 使用脚本，Room、Rules、SQLite、调用账本、RPC、恢复与归档走真实本地接口。未执行全量测试、生产构建、真实付费模型探针或线上验收。真实模型的审核准确性、延迟和生产表现仍需发布后的有界验证。本次不自动更正历史故障已提交的数据；故障 `ZW-mu5gokct-0f4dfeb862314ce4908195dca024192f` 保持 [原事故记录](incident-mu5gokct-20260917.md) 的事实边界。
