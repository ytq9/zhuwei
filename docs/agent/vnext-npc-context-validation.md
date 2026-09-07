# NPC 冻结上下文与单一共享检定的定向证据

日期：2026-09-06。`cloudflare / 258caee404e0814405eb497653ee9f00d647b773` 未提交工作树；既有 dirty/untracked 均保留。本次完成 social 所需的两处共享接缝，**尚未接通 social Form，不将 V06 或总 Goal 标为完成**。没有真实 API、构建、部署、push、远端 migration、Secrets 或旧房退役。

## 目标、合同与代表矩阵

NPC 决策必须消费指定 NPC 在同次 prepare 中的独立 Rules Viewer 快照，并完整绑定自身知识目录、持有正文、可见事实与经投影脱敏的身份/连续性记录。没有投影或没有加载正文时返回 unavailable，不解释为空知识，也不阻断无关物理行动。共享检定由唯一完整成功/失败分支指定，其他直接后果按 outcomeBinding 执行，不复制检定。

| 变化维度 | 实际证据 |
| --- | --- |
| NPC、玩家和另一 NPC 持有相同裸 knowledgeRef、不同正文 | 快照只引用 `knowledge:<npcRef>:<knowledgeRef>`，保留 partial 层级；不能命中玩家优先的裸 ref 查找；正文只存在于顶层已加载知识记录 |
| NPC 可信空知识与材料缺失 | 空 catalog 可读取；缺投影、缺一条已加载知识或非法元数据分别 unavailable；无投影的物理 prepare 仍 ready |
| 自报 hash 被重签、私有事实/身份/连续性被塞入投影 | 与同 state、同已解析 profiles 的 `projectWorld` 完整 canonical 等值核验；六类篡改全部拒绝；非 JSON 输入不抛出 prepare |
| 已有 conversation 与私有意图 | authority hash 绑定完整线程，快照正文仅用 NPC safe projection；不复制玩家 desiredBehavior 或 authority privateNotes |
| 实际 Room prepare | 现有 dynamic NPC sparse revision 纵切取得独立冻结目录；Rules、Claims、旁白和 stale 拒绝消费者继续通过；不称此用例已验证 social 回应 |
| 观察或环境互动作为唯一 owner，源数组 owner 不在第一位 | 两类 owner 各走成功/失败，graph 先执行 owner，后果修改同一已有对象为 opened/jammed，完整 replay 与 Viewer Claims 一致 |
| 首随机前预检 | 零 owner、多个真实失败分支、conditional owner 拒绝；未选中的失败后果引用非法或版本过时也不发随机请求 |
| Room 提交、驱逐、重复 submission | 成功/失败各一骰，实际两个 WorldInteractionResolved 中只有一个 check；驱逐恢复和重复提交无新增 Proposal、骰子或世界变化 |

## 实现与直接消费者

- `context/npc-decision.ts` 验证 Room 传来的 NPC projection 后，用同一 authoritative-v2 projector 和已解析 manifest 重投影核对；不是全局 Registry 重新选 Profile，也不另写 Viewer 策略。保存 self、scene、timeline、identity、完整 knowledge catalog、实际知识 entryRef/hash、可见事实与安全连续性记录。reader 核对闭合形状、必需记录、唯一引用和已加载知识的一一对应。此 snapshot 不是直接可引用的世界 authority ref。
- `context/index.ts` 仅为本次已载入 NPC 建片段，加入 contextHash/请求预算，标记 nonCitable；工作计费包括再次投影的扫描/输入与输出，超限明确停止或记录 oversized entry 未加载。`room-bridge.ts` 消费本次 `kpProjection.npcViewers`。`proposalModelContext` 通过既有 entries 路径携带它，未另建上下文通道。
- Rules `projector.ts` 仅在 NPC Viewer 下导出自身 definition 的 attitude/goals/plans/publicExpression 白名单；`SafeReadModel` 增加可选 npcIdentity。`authority-bindings.ts` 把 conversationThreads 加入既有 continuity 版本读取路径，安全正文继续由 projector 决定。
- `proposal-check-owner.ts` 是 validator 与 graph 共用的 owner 选择器。lowering 只给 owner 保留共享 check；直接 observe sibling 不继承 owner 的 attack 拒绝。schema 说明同步。
- `worldInteractionFormId` 统一初次单步 AtomicPlan、原始输入核对和持久计划 validator 的 Form 选择，修复单步构造时写死 worldInteraction 的接缝。现役 Rules 随机、候选、提交、投影与 replay 继续复用。
- 只读复核发现条件失败后果被内部 directSuccess 误述为行动直接成功。Claims 从已验证范围内同 root/branch 的后续原子 settlement，要求同范围真实 WorldInteractionResolved 检定的 root/branch/actor/resolutionId/结果/时序匹配，并以精确 applied proposalRef/interactionRef 识别后果，输出 `outcomeCode:applied` 和“环境变化已发生”；独立 directSuccess 保留原成功语义。没有新增持久字段或公开私有 ledger。

## 已运行验证

1. NPC Node 目标：`npx tsx --test tests/kp-vnext-npc-decision-context.test.mjs tests/kp-vnext-context-freeze.test.mjs tests/kp-vnext-context-closure.test.mjs tests/kp-vnext-source-claims.test.mjs`，**28/28，exit 0**；`/tmp/zhuwei-npc-context-node-final.log`。
2. NPC Room 目标：`npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'existing dynamic NPC sparse revision'`，**1/1，exit 0**；`/tmp/zhuwei-npc-context-room.log`。NPC 类型检查首次因局部别名丢失 array 收窄 exit 2；将同一 guard 移到实际使用的别名后 **exit 0**，`/tmp/zhuwei-npc-context-types-final.log`。
3. 共享检定 Node 目标：`npx tsx --test tests/kp-vnext-shared-check.test.mjs tests/kp-vnext-observe.test.mjs tests/kp-vnext-proposal-bundle.test.mjs tests/kp-vnext-proposal-schema.test.mjs`，**54/54，exit 0**；`/tmp/zhuwei-shared-check-node-final.log`。
4. 共享检定 Room 目标：`npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'direct sibling consequences'`，**2/2，exit 0**；`/tmp/zhuwei-shared-check-room.log`。本阶段 public helper 修改后 `npm run typecheck` **exit 0**，`/tmp/zhuwei-shared-check-types.log`。
5. Claims 直接连带修复后：`npx tsx --test tests/kp-vnext-shared-check.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-interleaved-projection.test.mjs`，**27/27，exit 0**；`/tmp/zhuwei-shared-consequence-node-final.log`。上述 Room 两分支加旁白输入断言后 **2/2，exit 0**，`/tmp/zhuwei-shared-consequence-room-final.log`。初次修复遗漏 Claims conformance 的 outcomeCode 枚举，Node/Room明确失败；同步校验后通过。追加11类伪造/错配 ledger-owner 的纯 Claims 边界用例，确认不能借未发生或其他 actor/branch 的检定给直接结果改义。此阶段没有改变公开签名，未重复类型检查。

上述各阶段验证对应串行修改的不同源码状态，均只选择 Node、Room 和类型三类直接证据；没有把前一批 JSON 修订的绿色结果当作本批验证。NPC fixture 初次增加实体未增加场景 spawnPoints，初始化拒绝；修正测试几何后进入真实 Rules 初始化/投影，不放宽生产校验。

## 尚未覆盖与下一步

新增 social Form、typed 私有 social plan、实际回应/沉默、权限内关系/承诺/债务、领域 fold 权限与本根事件核对、social Claims、conversation retry/correction 仍需实施，详见[社交实施承接](vnext-social-implementation-plan.md)。消费 snapshot 的 social read-set 必须取实际目录/记录，不能锁 synthetic npc-decision ref 或退回裸知识引用；Rules 复用其领域类型时应放入 Rules 共享领域模块，避免反向依赖 KP。

本批没有真实模型语义、HTTP social、新社交待决驱逐、对话改判恢复或长团 CPU/SLO 证明。严格投影核对不证明自然语言中的回应蕴含或意图保真。round25 原失败和累计费用保持；恢复归档合同仍待用户答复，独立工作继续，120 金标/SLO 后置，总 Goal active。
