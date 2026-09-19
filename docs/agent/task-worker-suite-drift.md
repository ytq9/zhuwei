# 任务：未声明为门的 Worker 套件与现役合同的剩余偏差

写给接手的会话。这些文件不在任何 SPEC 的 `gates` 里，棘轮和 CI 都不跑；2026-09-19 首次运行时 37 个文件 114 个用例红，同日按簇修到 64 个。剩余失败已不是同一根因，下面按文件列出诊断与待裁定点。运行方式：`npm run test:worker -- --file <文件>`（zsh 下多文件用 `${=FILES}` 展开）。

## 已裁定的合同（修剩余用例时以此为准）

- SPEC 0003 §1：同一次行动在回复就绪前的自动时间推进与最终结算属于同一未提交候选。已在 `8b5a70c`、`470bd57`、`903a2bf` 落地：等待链在同一请求内继续到完成，行动的时间成本跨过的已排定 NPC 计划也在同一请求内结算。
- SPEC 0006 第 76 行、SPEC 0013 §7.2、铜钥交接门：玩家行动产生的 NPC 工作（承诺交付、故事事件、计划形成）在下一次提交时先结算，不在同一请求内执行。用户于 2026-09-19 确认保留此合同，涉及的 19 个用例应改为两次提交验收。
- ADR 0026：回复失败时世界不提交（`actionReplyPending` 可重试，`actionReplyFailed` 取消候选）；测试里直接调用 `commitDueActivity`/`stub.commit` 的地方要用 `settleAwaitingNarration` 发布回复。

## 剩余失败

| 文件 | 剩余 | 诊断 |
| --- | --- | --- |
| `tests/kp/npc/promise-lifecycle.room.test.ts` | 8 | 期望 NPC 工作在同一请求内执行；改为下一次提交验收 |
| `tests/kp/stories/story-world-event.room.test.ts` | 7 | 同上；另有一例读取不存在的调用行 |
| `tests/kp/npc/npc-plan-formation.room.test.ts` | 4 | 同上；两例是修稿合同（`revision:unchanged-draft` 属 `REPAIR_OUT_OF_SCOPE`） |
| `tests/kp/time/time-passage.room.test.ts` | 11 | 见下节 |
| `tests/kp/npc/actor-plan-due.room.test.ts` | 6 | 两例是 ADR 0026 前的旁白拒绝合同（期望 `committed` + `narration: rejected`，现为 `retryableFailure`）；其余是崩溃点恢复后的直接到期提交 |
| `tests/kp/combat/sustained-casting.room.test.ts` | 2 | 一例直接 `stub.commit` 未发布回复；一例期望自动伤害骰，现为玩家自掷 `awaitingPlayerRoll` |
| `tests/kp/combat/ability-operation.room.test.ts` | 4 | 修稿请求结构、仪式到期尾部、拒绝合同 |
| `tests/kp/world/dynamic-locations.room.test.ts` | 1 | 事件计数多一条 |
| `tests/kp/provider/provider.room.test.ts` | 20 | 未分析；另有 3 例只在负载下红 |
| `tests/platform/recovery/archive-do-resume.room.test.ts` | 1 | 只在整文件顺序下红，`STORY_ARCHIVE_WORLD_INVALID`，单跑通过 |

## time-passage 待裁定点

这些用例写于回复优先之前，编码的是「等待的开始先直接提交」：

- NPC 决定失败时，等待停在截止点、已推进的 2 秒保留、活动标 `cannotSafelyContinue`（该状态只存在于实现，没有 SPEC 条款）。按 SPEC 0003 §1 的字面，候选应整体取消。
- 崩溃点 `afterCauseCommitBeforeDueTail`、`afterDueSubmissionBeforeCommit` 的恢复用例假设开始已提交。
- 七次调用预算、死亡中断、私有到期能力、澄清后掷骰、非战斗活动的提醒与继续，各自依赖上述前提。

先裁定「链内内部失败时保留部分进度还是取消候选」，再逐个改。

## 不该做什么

- 不把这些文件登记进基线或声明为门来变绿。
- 不为让旧用例通过而恢复回复优先前的直接提交。
