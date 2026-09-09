# 2026-09-10 撤销推送、隔离未完成工作与重审

## 范围与 Git 处置

用户要求撤销刚才推送、重新审查再推送，明确不接手 Claude 未完成的工作。

- 推送前远端：`6877a49`；原推送末端：`7a261d019fa3d9bf08bf04e4a7604c594db5b599`。根据 origin/cloudflare reflog，原推送包含整个 `6877a49..7a261d0`，不只是最后一个提交。
- 完整备份：本地分支 `codex/backup-push-20260910-7a261d0`。另外保存最后提交中未纳入候选的 17 个路径差量：`/Users/sanmu/.codex/archives/zhuwei-push-20260910-7a261d0/claude-unfinished.patch`，补丁基线 `9d6e4b1`。恢复到后续源码须重新审查冲突。
- 已非 force 推送回退提交 `ec66cc1`；其树与 `6877a49` 完全一致。历史提交保留，没有 reset 或清除工作区。
- 本地审查候选 `efe4d34`：恢复原推送中至 `9d6e4b1` 的已完成提交，另保留最后提交中的旧运行时房间删除修复、strict 传输测试及四份调查/交接文档与日志。最后提交中的动态召回代码及对应测试未恢复。
- 修正后的代码候选：`da1baad145471eba987b0de79630a9e6c40bc131`；后续提交只包含本报告和执行日志。待非 force 推送到 `origin/cloudflare`。
- 操作前实际远端 main 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，与发布文档旧记录不同；本任务不追溯或改写 main。最终推送后需读回 cloudflare 与 main。

## Standards

只读代理审查 `ec66cc1...efe4d34`，依据 AGENTS、ADR 0015 与直接消费者。发现 1 项 P1：已选知识在条数、字符量或完整记录重读字节上限处静默丢失，仍被当成普通未加载目录。违反决定性上下文不得被预算截断的要求。

已修正：选择器返回明确预算失败；冻结过程传播 `contextBudgetExceeded`；闭包内知识重读失败保持 critical，字节超限立即阻断。代理再次复核确认闭合，无额外标准或凭据泄漏发现。未要求主观重构。

## Spec

独立只读代理依据 SPEC 0001 与 SPEC 0016 审查，发现 2 项：

1. P1：与 Standards 相同的知识截断问题，违反 SPEC 0016 §4.3。修正覆盖 NPC 与玩家持有者，以及条数、字符、中文 UTF-8 字节三种边界。
2. P2：词面命中的 NPC 被当作唯一交谈对象，排除了实际回应者。真实 fixture 中“我问其他人，瓦罗昨晚去了哪里？”只冻结瓦罗，莉安的正确回答因缺少其决策上下文被拒绝。违反 SPEC 0001 §5 的目标/做法理解与 SPEC 0016 §4.2 的相关 NPC 上下文要求。

已撤回按词面命中排除其他可见 NPC 的逻辑，保留原有限决策视图；回归覆盖正确回应者知识进入冻结并通过 lowering。未开发动态召回或新的语义识别器。两项修正均经代理复核确认闭合。

## 验证与限制

- 最终 `npm run typecheck` exit 0：`/tmp/zhuwei-repush-typecheck-complete.log`。
- 最终知识/可观察上下文 2 个 Node 文件 17/17，exit 0：`/tmp/zhuwei-repush-byte-verified.log`。相关档案测试此前 8/8，同一组复核共 25/25，exit 0：`/tmp/zhuwei-repush-node-verified.log`。
- 承诺、社交、选择、修订等 12 个 Node 文件此前 96/98；两项失败来自本次更改失败边界后需同步的测试构造/旧截断预期，已在上述定向检查修正。未将最初失败隐去或宣称最后完整重跑该组。
- 最终真实 Room 定向检查 4/4，exit 0：普通提问、物品问题、过大决定性记录零 Provider/零效果、空社交草稿重发。`/tmp/zhuwei-repush-room-verified.log`。房间删除 6/6、strict 传输 4/4 已在初次候选通过，两者运行时代码之后未修改。
- 扩展检查保留失败：schema-retrieval 4 项；provider/promise Room 19 项。以 git archive 的完整 `6877a49` 源码隔离对照，分别有相同 4 项与 22 项失败；最终 19 项均在基线失败名单内。其中 6 项首个失败断言/阶段改变，不能称为错误完全相同，也不能证明全部后续路径正确。基线与候选日志 `/tmp/zhuwei-repush-{baseline-node,baseline-worker,worker-final}.log`。
- 未进行全量回归、build、真实模型调用、部署、远端 migration、数据删除或 Secrets 修改。仍有上下文预算及恢复等既有失败，不能宣称完整游玩、全部测试通过或角色知识长度问题已经解决。
- 规范审查 1 项、规格审查 2 项，共 2 个独立问题，均已修正；剩余测试缺口如上。
