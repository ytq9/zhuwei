# 战斗后续能力与分段剧情摘要：本地验证

日期：2026-10-06。分支：`cloudflare`。任务基线为 `8b14eaaf`，组合验证基于已独立提交的对象规则 `7ff92b37` 加本轮差量。范围见 [handoff §5.5](../handoff-tactical-map-combat.md#55-后续战斗与剧情摘要本地实现接续)、[实施矩阵](../proposals/handoff-combat-and-summary-completion-20261006.md)；决定见 [ADR 0126](../../adr/0126-combat-followups-use-shared-rules-and-real-exits.md)、[ADR 0127](../../adr/0127-segmented-summaries-are-private-retrieval-hints.md)。Worker 提交、文件所有权及冲突处置只记在[并行集成日志](../../refactor-log/2026-10.md#战斗后续与分段摘要并行集成2026-10-06)。

## 实际验证

| 命令／范围 | 结果与直接证据 |
| --- | --- |
| `npx tsx --test tests/kp/combat/combat-start.test.mjs tests/kp/combat/handoff-combat-continuations.test.mjs tests/kp/combat/opportunity-effects.test.mjs` | 20/20。首次 NPC 定义、多重攻击、本人对抗选择、NPC 急救；真实投掷、升环、离场与借机中断、死亡后收束、Ready 投掷；借机攻击效果豁免成败、落空不施加效果、麻痹先于移动续接。日志 `/tmp/handoff-final-continuations.log`。 |
| `npx tsx --test tests/kp/combat/npc-departure.test.mjs` | 2/2。单独先攻与共用先攻组均从 NPC 计划移动至出口，真实离场、保存本人片段、结束计划、结算残留 Ready，再返回唯一加入；原组员保留先攻骰值。每步事件重放等于当前状态。日志 `/tmp/handoff-npc-departure-final.log`。 |
| `npm run gates:check` | 退出 0；104 个声明的测试文件全部绿色，Node 与 Worker 均实际运行。包含 Room 的私人选择续接、摘要的行动／回答／掷骰完成入口、预算耗尽、未知／未发送恢复、DO 驱逐、归档篡改拒绝及归档恢复。日志 `/tmp/handoff-gates-verified.log`。 |
| `npm run typecheck` | 退出 0。日志 `/tmp/handoff-typecheck-verified.log`。 |
| 文档与静态边界 | 规格错误 0，断链 0，模块检查与既有基线持平；`git diff --check` 通过。没有增加非请求体积 allowlist 或失败基线。 |

摘要 Node 门实际使用本地 SQLite 执行旧宿主表升级，保留既有行，并完成摘要宿主写入—读取。新 CHECK 同时允许 `knowledgeSummary` 和 `narrationSettlement`；没有 D1 schema 变更或远端 migration。

最终规格门使用 `/tmp/handoff-gate-capture.cjs` 仅保留 Node 子进程失败时的原始输出，不改变命令、断言、并发或退出码。104 个文件是声明门的范围，不是整个仓库的 `npm test`；三个独立工具门不在此命令内运行。

## 排查中修复的直接问题

- 环境危险来源没有生物占位；只对非环境来源和受击生物要求合法占位，恢复战后落梁并保留近战范围拒绝。由同目录对象任务复现，最小修复随本轮战斗差量提交。
- 新 NPC 命中附带效果原先会被借机攻击路径遗漏。共用普通能力的豁免准备／结算和效果写入，仍只消耗一次反应；失败豁免不取消普通武器伤害。
- Ready 投掷原先没有释放实物，现在沿同一库存事件释放一次，不额外获得双武器资格。
- 离场者移出当前参战成员，历史身份单独保留；否则库存／装备等直接消费者仍把它当作正在战斗。相位残留任务保留正确的非零到期时间。
- 重新加入原先删除了包含该 NPC 的整个先攻组；只移除返回者的旧位置，保留其他组员。修复前探针错误为“the other member of the old shared initiative group must retain its entry”，修复后两种组结构均通过。
- 摘要归档绑定持有者、精确来源文本、协议和原调用；回答／掷骰完成后回到同一源行动。模型结果不可用不撤销已经发布的行动。

早期组合门曾有落梁与延迟回复失败；两文件定向复跑 87/87，落梁根因已定位，延迟回复未稳定复现。最终固定源码的 Node 门及完整组合门均通过，未放宽相应断言。一次中途门因新发现先攻组回归而主动终止，不计作验收通过。

## 请求体积与调用边界

最终组合基线中，普通选择因摘要提示增加约 33 token；`startCombat` 5,684 → 7,254，`endCombat` 4,690 → 4,716，`authorItem` 12,919 → 13,081。固定全能力组合为 50,317，低于 90,000 输入上限。新增对象规则的部分另由 `7ff92b37` 记录，不能把全部增量归给战斗或摘要。

这些是保守估算器的固定请求测量，不是某次真实长局的输入。动态摘要目录最多八段，每段 240 字，必要正文放不下时不附加提示；独立摘要请求最多 32 条／12,000 字原文，输出上限 1,000 token。成功行动必要旁白发布后至多一次可选摘要调用，同属原预算和调用账本，不为失败另开额度。它会增加当次请求的等待时间，真实耗时和费用未测量。

## 交付边界

- 已完成 handoff §5.5 中本轮明确的战斗与摘要实现；不是全 SRD 特殊法术执行器的补齐。升环只编译现役通用机械支持的法术，不把特殊机制或多射线伪装为一次命中。
- 摘要只是不可引用的本人知识检索提示，保留原文回读、来源版本、秘密和感知边界；没有证明真实模型的摘要质量或真实旁白效果。
- 旁观者可见的攻击名／职业特性机制名称仍待用户裁定，维持已有规则。先前剧本候选采纳与真实批次预算也没有因本任务获批。
- runtime 为 `runtime-srd51-2014-authoritative-vnext-stage3-v6`，事件 Profile 为 `room-world-events-vnext-stage3-v4`；沿 ADR 0120 的版本退役政策。本轮没有部署、Git push、远端 migration 或付费模型调用，未改变远端 `main`。
- 同目录对象规则独立提交；既有未跟踪的 `dynamic-object-completion-plan-20261006.md` 保留，不混入本轮提交。原 Claude worktree 和隔离 Worker 提交保留。
