# 任务：未声明为门的 Worker 套件与现役合同的剩余偏差

写给接手的会话。这些文件不在任何 SPEC 的 `gates` 里，棘轮和 CI 都不跑；2026-09-19 首次运行时 37 个文件 114 个用例红，同日按簇修到 64 个。剩余失败已不是同一根因，下面按文件列出诊断与待裁定点。运行方式：`npm run test:worker -- --file <文件>`（zsh 下多文件用 `${=FILES}` 展开）。

## 已裁定的合同（修剩余用例时以此为准）

- SPEC 0003 §1：同一次行动在回复就绪前的自动时间推进与最终结算属于同一未提交候选。已在 `8b5a70c`、`470bd57`、`903a2bf` 落地：等待链在同一请求内继续到完成，行动的时间成本跨过的已排定 NPC 计划也在同一请求内结算。
- SPEC 0006 第 76 行、SPEC 0013 §7.2、铜钥交接门：玩家行动产生的 NPC 工作（承诺交付、故事事件、计划形成）在下一次提交时先结算，不在同一请求内执行。用户于 2026-09-19 确认保留此合同，涉及的 19 个用例应改为两次提交验收。
- ADR 0026：回复失败时世界不提交（`actionReplyPending` 可重试，`actionReplyFailed` 取消候选）；测试里直接调用 `commitDueActivity`/`stub.commit` 的地方要用 `settleAwaitingNarration` 发布回复。

## 剩余失败

| 文件 | 剩余 | 诊断 |
| --- | --- | --- |
| `tests/kp/npc/promise-lifecycle.room.test.ts` | 0 | 2026-09-19 全绿；改动见「NPC 工作与承诺审核」节 |
| `tests/kp/stories/story-world-event.room.test.ts` | 0 | 2026-09-19 全绿；世界故事选路改在提交后同一请求内运行 |
| `tests/kp/npc/npc-plan-formation.room.test.ts` | 0 | 2026-09-19 全绿；修稿用例改为 SPEC 0015 §6.1 的同工具一次修订 |
| `tests/kp/time/time-passage.room.test.ts` | 0 | 2026-09-19 全绿并声明为 SPEC 0003 的门；改动与遗留缺口见下节 |
| `tests/kp/npc/actor-plan-due.room.test.ts` | 0 | 2026-09-19 全绿；改动见下节 |
| `tests/kp/combat/sustained-casting.room.test.ts` | 0 | 2026-09-19 全绿；答复经 `settleAwaitingNarration` 发布，伤害骰改为玩家自掷 |
| `tests/kp/combat/ability-operation.room.test.ts` | 0 | 2026-09-19 全绿；修稿票据、仪式完成的玩家骰、座位 id 取自房间 |
| `tests/kp/world/dynamic-locations.room.test.ts` | 0 | 2026-09-19 全绿；出发与旅程在同一请求内到达 |
| `tests/kp/provider/provider.room.test.ts` | 0 | 2026-09-20 全绿；改动见「provider.room」节 |
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

## NPC 工作与承诺审核（promise-lifecycle、story-world-event、copper-key）

- 尾部排除只针对行动自己的效果创造的决定工作（`decisionWorkCreatedBy`：`cause_root_action_id` 是该行动的根或其 `activity-result:` 根）：承诺产生的 NPC 工作、修约产生的审核等在下一次提交由 `priorWorkBeforePreparation` 先结算。被行动时间跨过的截止（长休跨过承诺期限）和 NPC 交付触发的审核由其他根创造，仍在同一请求的尾部结算（SPEC 0003 §1）。铜钥门以此为准。
- `publishDelivery` 的续段判定改由行动层传入正在处理的提交根（`continuationRoot`）：中途发布的 NPC 回复之后，同一提交尾部欠下的到期工作（休息余下的阶段）在同一请求内继续；没有传入根时才沿因果链回溯。
- 提交冻结了世界故事上下文时也触发续段（`storyContextFrozen`），同一请求内跑一次选路作者作业；夹具须回答 `select_world_story_preparation`（`noStory`）。
- `handleRoomActionInternal`：续段失败只有 `actionReplyPending` 才标 `deliveryPending`；内部决定崩溃等其他失败保留已提交的行动结果，尾部由下一次请求继续。
- 同一瞬间的到期顺序（`pendingDueWork` 排序）：已排定的 NPC 计划先于玩家自己的阶段或完成，承诺审核最后。这是实现选择，不是规格条款；`formation numeric`/`passTime` 用例与提醒边界用例依赖它。
- 静默候选只在 `ActivityStarted` 属于行动者本人时建立；NPC 计划形成附带启动的 NPC 活动直接提交，否则形成行动停在 `actionReplyPending`。
- 重放一致性（SPEC 0003 §8）：`withDueTail` 在候选已提交后用自己的 `activity-result:` 根结果回答，与首次响应一致。
- 修稿夹具：一次窄修订用同一工具请求、以 `correct_kp_proposal_bundle` 回复，票据 `sourceDraft` 为 `"asReplied"`；脚本供应者以 `replaceDraft` 信封回复，原始字节保留以免数值被四舍五入。
- 随机数日志随候选变基：候选按头部变基时，挂在候选自身 prepared id 上的骰点日志（另一控制者的反应答复引出的施法者骰）也重映射事件序号，否则 `randomnessJournalIntegrityMismatch`。

## provider.room（2026-09-20）

对照基线 `c767195` 确认这 20 个失败都早于本轮改动（其中 5 个已随前面几批修好），没有新回归。按现役合同逐个修复后全绿，产品侧改动四处：

- 另一名**玩家**的到期 Activity 不再挂进行动者的候选（`enqueueNewDueActivities`）：它是独立根，有自己控制者的回复，不与该行动共命运（SPEC 0003 §1、SPEC 0013 §7.2）。行动者自己的阶段、NPC 拥有的活动以及内部决定（NPC 工作、承诺审核、计划）仍属同一候选——铜钥交接依赖这一点：NPC 工作产生的交付活动必须随玩家这次提交一起结算，闹钟没有旁白通道。
- `dueContinuation` 对别人的 Activity 按「谁造成这份义务」区分（`activityBeganWithin`）：已经在进行、被本次时间成本跨过完成瞬间的活动（别人的休息、NPC 的旅行）在同一请求的到期尾部结算；本次行动自己新创造的别人的义务（被打倒目标的恢复）等该角色自己的请求。stage3 的 `knockOut` 门与陈旧冻结选择用例依赖后者，provider.room 的三份休息依赖前者。
- 独立到期根的回复失败只让本次交付标记为 `deliveryPending`（可经 Viewer 恢复能力发布），不再把已提交并已发布的行动翻成 `notCommitted`。
- 候选里既没有待发布的回复，也没有已就绪的链内到期工作时，`withDueTail` 按 ADR 0033 的机制把已完成的静默阶段原样提交，Activity 之后再随时钟推进；此前这种候选会永远返回 `actionReplyPending`（没有受众就没有人能发布它）。
- 完成阶段若已冻结玩家骰日志（`randomnessBatch`），不再被无关提交重新唤醒（回复优先下它还没有 Receipt，`hasPendingAuthorityRoot` 看不到）。

夹具与用例改动：休息类夹具改为经 Rules 直接播种（玩家提交的休息会在自己那次请求内走完，不再留下待办）；直接 `commitDueActivity` 的地方经 `settleAwaitingNarration` 发布回复；闹钟无旁白通道，唤醒的完成停在原地并由控制者的恢复能力发布；攻击、检定、治疗等骰点改为玩家自掷并按 SPEC 0016 §8.3 逐个落地；澄清延续须选齐其家族（SPEC 0015 §6.1）；修订轮以请求里的修订工单识别，脚本供应者以 `replaceDraft` 信封回复；陈旧冻结选择改用灾害夹具改变基准（玩家行动的效果要到自身完成阶段才落地）。

遗留缺口（未裁定）：行动开始的 Activity 若其推进阶段不可用（例如进行中的遭遇或缺少 progression 绑定），该行动的时间成本不会自动推进，效果停在完成阶段等待时钟；provider.room 的 `frozen-stale:bob` 就是这种情况。

## 不该做什么

- 不把这些文件登记进基线或声明为门来变绿。
- 不为让旧用例通过而恢复回复优先前的直接提交。
