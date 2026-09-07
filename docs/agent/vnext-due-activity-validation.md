# vNext 普通到期 Activity 的持久尾阶段

日期：2026-09-06。状态：玩家与 NPC 普通到期纵切已通过本地定向验收，尚未达到整个 V07 闭包；本批无真实 API、部署、push、远端 migration 或生产数据退役。

## 能力合同

真实权威提交使普通 Activity 到期时，同事务保存独立 due obligation；沿原 Rules `step/project/replay` 逐项完成，保存独立 canonical root、Receipt、随机 journal 和冻结 Viewer 旁白。驱逐和失响应不遗失任务，不把后续知识查询当成到期原因，不改写此前玩家行动的 Receipt。

后续真实动作在相关 timeline/scene 尚有 due 时明确冲突；已验证的随机恢复继续原冻结行动。`knowledgeReview` 只读取本人已持有知识，可在等待恢复骰时提交自己的私有回执，不推进时间、资源、随机或危险。已开始的短休恢复骰由当前合法角色控制者使用原请求继续；其他玩家不能代掷或取得秘密。

## 修改与直接消费者

- Rules 私有 `project(..., { dueActivities: true })` 是到期身份与排序的唯一读取入口；完成时间采用 start + duration。Room 使用 `authority_due_work` 保存多个 child 的历史、原因、状态和重试时间，不修改旧 ActorPlan 阶段表的主键。
- 所有现役 append/state 提交位置通过同一入队接缝，包括随机请求、后续随机波、NPC 待决、ActorPlan、管理与修正提交。每次 drain 有 32 项异常保护，剩余项持久保留；等待骰子不会反复唤醒，安全暂停屏蔽 due alarm，归档与删除调度仍保留各自职责。
- 完成、打断同步关闭对应 work。内部 due submission 绑定实际 Activity 与原因，普通客户端 proposal 不能借用；无骰 submission 保存后控制移交也重验当前角色控制者。
- NPC 普通 due 使用私有 `npcDueActivity` 执行授权，仍经过原 `commitAuthoritative`；入口及最终事务复核 pending work、完整 descriptor、cause 事件、submission、owner 类别。NPC 的 submission principal 为 null，不借房主或触发者身份；无控制者的玩家继续等待合法控制恢复。NPC 内部结果仅含机械摘要，玩家各自经过原 Viewer Claims 交付，零受众也可固化完成。
- SQLite submission 的 principal 约束允许 null 仅用于 dueActivity。旧 NOT NULL 表通过 PRAGMA 核验后在事务内重建、逐列保存14个字段并恢复索引；不是仅修改 CREATE IF NOT EXISTS，也不删除旧行或修改 D1。
- 到期交付逐 Viewer 保序，较早的冻结正文失败时，后续根保留待恢复。恢复使用原 Receipt、Claims 与叙述上下文；机械提交不因叙述失败回滚。
- 普通完成与休整的冻结 Claims 补齐公开完成、本人 HP/HitDice/法术位/职业资源恢复、知识、资源支出和移动。短休同步保留临时 HP，长休按既有 2014 结束规则清除；额外未解释同步变化拒绝，不能作为 ledger 吞掉。

### 验收中发现的直接缺口

`inWorldRefusal` 原先没有冻结读取集，真实 Room 一律在 read-set 门拒绝。vNext1/vNext2 lowering 与共享 feasibility plan 现保存 contextHash/readSet，Rules 在消耗前校验 actor、依据、前提、nextAction、物品与实际时间依赖。新增独立 `character-timeline:<actor>` 权威读取记录冻结时钟和归属；知识回顾不选择该记录。

等待骰子期间的合法知识查询会插入另一 root。原投影只接受连续同 root 的完整 Receipt，导致骰子恢复无法投影。现接通完整全局 journal 区间验证与逐事件因果投影：所有中间事件均验证 hash/reducer，只有本 Receipt 的事件产生 Claims；前后态与 Viewer 权限按实际事件位置解释，不把另一根的变化归入本次行动。真实 Room 另暴露 `StepResult.receipt` 仅含本次后缀；DO 现从 `resolved.state.receipts[root]` 读取完整权威范围并校验 Receipt 身份，保留原骰子请求和间隔事件，不放宽验证门或重写历史。

## 代表性矩阵与证据

`tests/kp-vnext-provider-room.test.ts` 17/17 通过：三项到期休整分别提交后下一提案只调用一次；另一玩家短休骰与查询/实际行动对偶；驱逐、失响应、重复按钮；原因提交后安全暂停与 alarm 恢复；无骰 child 保存后控制移交、失去控制后重新获得控制唤醒；前一条旁白失败后的逐 Viewer 顺序恢复。短休链还验证查询和安全操作插入期间保留原骰请求，恢复只掷一次、HP 7→12，重复按钮不再提交。

已完成的独立定向证据：

- due Rules 9/9、真实 SQLite Store 5/5（承接前次执行）。
- refusal/nullable 最终 10/10 exit0（`/tmp/zhuwei-feasibility-final-tests.log`）、冻结上下文直接消费者 63/63 exit0（`/tmp/zhuwei-feasibility-context-consumers.log`）。初跑 61/62 exit1 的唯一旧文案断言已由最终 10 项覆盖，另四文件 58 项通过；初跑 Context 37/42 exit1 的五个缺少 timeline 的合成夹具已由最终 63 项覆盖，另四文件 36 项通过。各组有交集，不相加。
- Claims、交错投影、知识回顾目标组最终 38/38 exit0（`/tmp/zhuwei-due-claims-and-projection-final.log`）：另一根治疗 10→13 不被本次休整 13→19 冒领；后来入场 Viewer 不追收之前事实；缺前缀、删除旁根、重复或篡改事件均拒绝。早期普通完成 25/25 记录保留为历史证据。
- Room 与真实 SQLite Store 合跑 22/22 exit0（`/tmp/zhuwei-due-room-final.log`）。此前合跑 21/22 exit1 与 diagnostic2/3 的 `projectionFailure` 已由完整权威 Receipt 范围修复；diagnostic4 原失败单例 1/1 exit0，随后最终组覆盖。全部临时投影诊断已删除。

统一 typecheck 首跑 exit2（`/tmp/zhuwei-due-types.log`），唯一错误是本来必填的可信 sessionVersion 被 helper 返回类型标为可选；已精确收紧该 helper 返回类型，复跑 exit0（`/tmp/zhuwei-due-types-final.log`）。`git diff --check` exit0。未运行全量测试、Lint 或构建。

NPC 补充最终验收：Room19/19 + SQLiteStore6/6 合跑25/25 exit0（`/tmp/zhuwei-npc-due-room-final.log`），typecheck exit0（`/tmp/zhuwei-npc-due-types-final.log`），独立只读授权/投影/DDL审查无阻塞。新增矩阵为 NPC 调查获得私有知识、保存 submission 后驱逐恢复与公共 proposal 拒绝；NPC 移动后无人地点的完成、空 audiences、不同 timeline 的玩家耗时不错误推进 NPC；旧表 prepared/awaitingRandomness/committed 原值保留、NULL CHECK、唯一 prepared ID、重复 ensureSchema。测试首跑因新增 helper 漏右花括号未收集测试；第二跑2/3通过，剩余用例错误推进了另一 timeline，修正为先证明其不触发，再提交 NPC 自身时间并由 alarm 完成；第三跑3/3和最终25项覆盖。所有失败日志保留，未把测试夹具缺陷当成生产修复。

稳定后自然恢复的 Rules/Claims 接缝随后补齐：真实 Medicine 成功→权威1d4确定1–4小时→canonical due完成会同时恢复HP并解除实际昏迷；原HealingResolved Claims只表达HP，现通用构造器以该事件真实before/after和effectiveConditions生成状态变化，不按活动名称写死结果。PC/NPC两个实际稳定链、普通清醒治疗不虚构苏醒、受伤中断共4个新用例，与due/Claims/交错投影合跑41/41 exit0（`/tmp/zhuwei-stable-recovery-final.log`），最终typecheck exit0（`/tmp/zhuwei-stable-recovery-types.log`）。该证据通过Rules公共入口，不能外推自然语言选Medicine或Room专用恢复链。

## 未覆盖范围

ActorPlan/longSpellcasting 迁入通用尾阶段、stableRecovery自然语言/Room持久化与驱逐、DeathSaveResolved在严格Claims根的启动覆盖、未完成obligation的新协议归档恢复、后台主动旁白runner、更多并发timeline/scene边界均尚未闭合。当前归档拒绝未结due仅防止伪成功，不能视作恢复能力完成。[私有恢复合同提案](vnext-recovery-contract-proposal.md)已形成具体方案并请求用户确认与SPEC0011的窄冲突；等待答复期间不修改该规格或实现依赖批准的私人旁白归档。

其余动态人物/地点/通路、待决继续、独立 Form、RootAction 累计预算、20+ 双玩家真实链、A–O、review/v5 真实效果、构建/部署及旧房退役继续按总 TODO 推进；120 条金标与长期 SLO 仍后置。
