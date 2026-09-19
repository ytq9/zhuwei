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
| `tests/kp/time/time-passage.room.test.ts` | 0 | 2026-09-19 全绿并声明为 SPEC 0003 的门；改动与遗留缺口见下节 |
| `tests/kp/npc/actor-plan-due.room.test.ts` | 0 | 2026-09-19 全绿；改动见下节 |
| `tests/kp/combat/sustained-casting.room.test.ts` | 2 | 一例直接 `stub.commit` 未发布回复；一例期望自动伤害骰，现为玩家自掷 `awaitingPlayerRoll` |
| `tests/kp/combat/ability-operation.room.test.ts` | 4 | 修稿请求结构、仪式到期尾部、拒绝合同 |
| `tests/kp/world/dynamic-locations.room.test.ts` | 1 | 事件计数多一条 |
| `tests/kp/provider/provider.room.test.ts` | 20 | 未分析；另有 3 例只在负载下红 |
| `tests/platform/recovery/archive-do-resume.room.test.ts` | 1 | 只在整文件顺序下红，`STORY_ARCHIVE_WORLD_INVALID`，单跑通过 |

## time-passage：已落地的修复与遗留缺口

用户于 2026-09-19 裁定「保留部分进度」（ADR 0033，SPEC 0003 §1）。此后按现役合同逐个修完剩余用例，其中产品修复四处：

- `action.ts` 的先行到期工作：新行动前先提交的已到期 NPC 决定（SPEC 0003 §4）在回复优先下返回 `awaitingNarration`，原先落到 `dueActivityPending`。现在先发布该决定的回复，再从新头部重新准备原意图。
- `withDueTail`：到期尾部里候选的相关作用域被外部提交改动（`PROVISIONAL_MECHANICS_SCOPE_CHANGED`）时，按 SPEC 0003 §1、§9 取消整个候选并返回 `actionReplyFailed`；原先异常外泄为 `authorityTransient`，过期候选留在库里让同一提交永远可重试。
- `provisionalMechanicsReplay`：没有暂存事件的后继候选只是为已提交 Activity 预留续段，随头部前进；外部提交（送达的消息、别的角色的行动）由 Activity 自己的下一阶段处理，不再取消续段。
- `drainDueActivities`：`dueActivitySuperseded` 是账目更新而不是候选失败；同一 Activity 由外部提交入队的提醒行会挂到持有该 Activity 的候选上，否则候选停在 `actionReplyPending`。

用例重写对照的合同：知识回顾前先提交已到期 NPC 计划（SPEC 0003 §4）；同瞬间死亡取消未提交的等待（§1、§9）；澄清后的检定等玩家掷骰（`awaitingPlayerRoll`）；骰点崩溃点改为玩家骰恢复矩阵；私有到期能力从到期行取 Activity；预算用例改为八次调用，因为已提交的 NPC 行动会通过同一传输发一次世界故事选路调用（ADR 0022 共享来源预算）；三条提醒用例改由 NPC 截止时刻切开链，NPC 回复发布后再送达消息（`armAfterPlan`）。

遗留缺口（未裁定，勿在测试里当作合同）：

- 同一瞬间同时到期的 Activity 完成与已排定 NPC 计划没有裁定顺序，当前按根 id 字典序，完成先跑。「完成边界的提醒」用例因此把 NPC 截止放在完成前一微秒。
- 世界故事选路调用在玩家回复发布之前执行并占用同一请求预算；预算紧时玩家回复退为可恢复的 `actionReplyPending`。是否让可选作者作业排在必需回复之后，需要用户决定。
- 回复优先之后，候选中途的世界状态不再是公开状态；`afterCauseCommitBeforeDueTail` 一类崩溃点只能观察到期行和头部，不能观察未提交的 Activity。

## actor-plan-due：已落地的修复

- 玩家回复被拒（`NARRATION_GROUNDING_REJECTED`）时按 ADR 0026 不提交世界：首次返回 `actionReplyPending`，`observe().narrationRecovery` 带 `action: "notCommitted"`、公开失败码与 `canRetry`；恢复成功时才提交。控制权转移后候选按 SPEC 0003 §9 取消，前控制者的恢复只得到 `notCommitted`。私有诊断持久化后对外只显示 `NARRATION_PUBLICATION_FAILED`。
- `handleRoomActionInternal`：行动本身已提交并发布回复后，续段里到期子根的回复失败只把本次结果标为 `deliveryPending`（可通过恢复能力发布），不再把已提交的行动报成 `notCommitted`。六次调用预算用例据此改写：尝试先发布，越过的 NPC 计划后结算、其机械等它自己的回复。
- `worldStoryContinuationProof`：随机数续段的前半段可能还留在同一临时候选里，证明改为连同暂存事件构造；此前 `freezeWorldStoryHostContext` 报 `trigger:due-not-authoritative` 并让 NPC 检定的回复永远发布不了。
- 知识回顾用例改为 SPEC 0003 §4：越过的已到期计划先从已保存响应提交（不新发调用），再提交回顾。

## 不该做什么

- 不把这些文件登记进基线或声明为门来变绿。
- 不为让旧用例通过而恢复回复优先前的直接提交。
