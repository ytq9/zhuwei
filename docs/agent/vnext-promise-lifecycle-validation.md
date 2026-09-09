# 承诺与计划：第三至第五步回执（待裁定）

2026-09-09。本轮仅完成新的 vNext；用户已授权推进后续步骤直到功能闭合，新的实质产品选择才停下裁定。开发基线为 `bec5e28c44f3c815a341c2f1e425cfaaeb65acf9` 与共享工作树，初始 69 个在途文件清单保存在 `/tmp/zhuwei-promise-completion-baseline-20260909-020952/manifest.json`。其他任务的修改保留，本任务没有 commit、push、部署、远端 migration 或旧 V3 修复。

**当前状态：第三、第四步已有本地代表性证据；第五步真实模型验收尚未通过，功能不能报完成。** 下方保留第二步历史回执，其“尚未实现”只代表当时状态。最终结论须以本节后续补齐的实际交付、持续义务、公开结果与恢复证据为准。

## 本轮能力与变化

使用者包括玩家和 NPC；结果、尝试、条件与持续义务共用版本化承诺、实际证据、逐项进展和主持复核。玩家新增义务需本人明确表达，NPC 仅在其合法知识和资源内决定行动。Rules 验证权限、时序、物品与合法转换，Room 保存正史及完整调用日志；复核不自行创作期间事实，也不把秘密裁定广播给角色。

- E/F/G：玩家和 NPC 双向对象、条件成就/未成就、部分交付、延期接受/拒绝、方法变化、取消计划、拒绝履行、免除与失约后补交；保留原表达、适用版本、原因和既往违约。
- H/I：同时间线同前沿合并复核、期限前真实动作优先、另一时间线未来证据排除；驱逐恢复、响应未知不重发、发布代际保护、知情隔离、长休通知与继续/停止、战斗禁止、章节/授权继任/更正连续性。
- NPC 行动承诺即使未写具体 nextStep 也安排一次本人决定；待决定工作不能冒充已发生的动作，也不能挡住到期履约复核。纯持续义务不生成虚构 Activity。
- NPC 先选择本次类型，再填写唯一表单；选择、填写及仅针对已保存空 `{}` 的一次补发分别入 journal，复用冻结知识和七次 HTTP 预算。未发送的填写阶段可续办，已发送但响应未知不重发；第二次空响应最终拒绝。
- 公共桌面入口将后续决定错误映射为闭合的 `FOLLOWUP_DECISION_INVALID` / `FOLLOWUP_DECISION_OUTCOME_UNKNOWN`，不透出秘密理由。

直接实现位于 `rules/v2/promise-lifecycle.ts`、`rules/v2/npc-work.ts`、`kp/vnext/promise-review.ts`、`kp/vnext/npc-work.ts`，消费者包括 social/schema/filling、Room 队列与 invocation journal、库存、Knowledge/Claims/Viewer、更正/继任。没有新增 D1 业务表或独立任务服务。

## 本地定向证据

以下检查按各自源码状态记录，重叠组不相加。模型为确定性替身的本地检查不能替代下一节真实验收。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| 本轮最终源码的直接用例组 | `npx tsx --test tests/kp-vnext-promise-lifecycle.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-social-shape.test.mjs tests/kp-vnext-prompt-contract.test.mjs`：53/53；`npx vitest run tests/kp-vnext-promise-lifecycle-room.test.ts`：9/9；`npm run typecheck`：均 exit 0 | `/tmp/zhuwei-promise-final-local-{node,room,typecheck}.log` |
| 第三/第四步生命周期及直接消费者 | Node 43/43、Room 6/6、typecheck exit 0 | `/tmp/zhuwei-promise-completion-final-{node,room,typecheck}.log` |
| 待办/引用修复后直接消费者 | Node 58/58、Room 6/6、typecheck exit 0 | `/tmp/zhuwei-promise-post-live-{node,room,typecheck}.log` |
| 去除单一行类型的多余 anyOf 包装 | 8 个直接 schema 消费文件 85/85，exit 0 | `/tmp/zhuwei-promise-singleton-schema.log` |
| 空响应恢复与公共错误 | Room 7/7；Node 6/6；typecheck exit 0；供应商参数组装补充 1/1 | `/tmp/zhuwei-promise-empty-{room,node,typecheck}.log`、`/tmp/zhuwei-promise-empty-assembly-room.log` |
| NPC 两阶段选择与完整生命周期 | Node 22/22、Room 7/7、typecheck exit 0 | `/tmp/zhuwei-promise-selection-{node,room,typecheck}.log` |
| 选择恢复/预算/越界 | 选择隔离 Node 1/1；选择保存后驱逐 Room 1/1；HTTP 耗尽后续办 Room 1/1 | `/tmp/zhuwei-promise-selection-specific-{node,room}.log`、`/tmp/zhuwei-promise-selection-budget-room.log` |
| 真实失败的库存边界 | NPC 所有权不能代替持有或发现隐藏物件，Node 1/1；原非法稿仍拒绝 | `/tmp/zhuwei-promise-custody-node.log` |
| 后续填写说明 | 目标 social/prompt-contract 检查 exit 0；不是实际模型语义通过证据 | `/tmp/zhuwei-promise-term-guidance.log`、`/tmp/zhuwei-promise-custody-guidance.log`、`/tmp/zhuwei-promise-recording-guidance.log` |

未知响应用例中的 `ACTOR_PLAN_DECISION_TRANSPORT_FAILED` 是明确故障注入，不是吞掉真实失败。

## 真实模型批次（全部保留）

每批使用冻结源码、独立本地 SQLite、正常 Cookie 注册/开房/锁卡/startGame/游戏 HTTP，DeepSeek v4 Flash；没有注入承诺、实际交付、履约裁定或角色知识。目录 `/tmp/zhuwei-vnext-promise-live-20260909-<批次>`；每批保存源清单、计划、私有请求/响应、实际状态、调用用量、关闭与精确 replay 结果。

A–E 各限三根行动、12 次调用、¥3、20 分钟；F 起独立计划预留完整生命周期的 20 次/¥5，说明 NPC 选择/填写、休整、复核、公开与预算续办的构成；每 HTTP 仍最多七次/120 秒。首个明确失败即停。父行动 committed/published 不能代替后台工作成功，必须检查真实 due work、原响应和 Rules 结果。

| 批次 | 结论 | 调用 | 输入/输出 tokens | 官方空闲价估算 ¥ |
| --- | --- | ---: | ---: | ---: |
| A | 第一对话已发布但 NPC 追问、未承诺；第二句把 duration/successOutcome 放根层，拒绝，无新状态 | 8 | 171786 / 3479 | 0.2659105 |
| B | 时间线被当成 NPC 授权，另有初次重试/交付遗漏，Rules 拒绝，零事件 | 2 | 74693 / 1065 | 0.1121920 |
| C | 缺全部 NPC response 字段，格式拒绝，零事件 | 2 | 75097 / 837 | 0.1154840 |
| D | 承诺真实成立、期限独立；NPC 返回空对象，执行未开始，随后短休被阻塞 | 7 | 116171 / 1572 | 0.1705657 |
| E | 保存空响应后补发一次；延期响应把 wake 写成数字 0，仍非法。父旁白同时耗尽 HTTP 预算 | 7 | 139478 / 2380 | 0.1638758 |
| F | 未到 NPC 阶段；parts/activation 放在 terms 外，格式拒绝、零事件 | 2 | 74881 / 1263 | 0.1061266 |
| G | NPC 选择及空响应补发成功产出完整方案；隐藏新物品未取得即可转交，精确 Rules 离线重放拒绝，未生成物品 | 7 | 138297 / 2219 | 0.1727014 |
| H | 玩家旁白 published，但 NPC 台词承诺交付、consequences 却为空；无承诺/待办，是语义失败 | 6 | 86366 / 1808 | 0.1252498 |
| I | 强化登记提示后仍台词准诺、记录为空；再次无承诺/待办，是同类语义失败 | 6 | 86465 / 2103 | 0.1298810 |

A 第一根曾驱逐重启后重复：零新调用、完整响应和 state/events/delivery/randomness 相等。A–I 关闭时精确 replay 均与保存状态相等，源码始终未变；这只证明失败或局部成功可以重放，不证明实际交付完成。报价来自本轮已核对的 DeepSeek 官方 pricing，预算按高峰无缓存保守计，不把估算当账单。

九批合计 47 次物理调用、963234 输入 / 16726 输出 tokens，估算 ¥1.3619868；包含全部失败，不作为成功率。当前工作区初始 69 文件均仍存在，33 个字节未变、36 个随本任务及同期工作变化，差量审计在 `/tmp/zhuwei-promise-completion-workspace-audit.json`，没有将整树修改全部归为本任务。

## 当前未完成

H/I 的同类语义遗漏需要新的提交前一致性保障。具体调用、拒绝、恢复及不自动补造条款的边界已写入[待裁定方案](vnext-promise-spoken-consistency-decision.md)。该方案会改变对话调用成本及 SPEC 0016 §7.2 阶段额度，尚未实现或默改规格；本轮暂停于这一个确认点。全部 A–I 本地测试服务已关闭。

第五步 J：真实交付 → 履约复核 → 玩家实际取得与通知 → 幂等恢复，以及结构不同的持续义务真实链路，均仍须闭合。不能把上述模型失败改稿重放成真实通过，也不能把无知识/无待办的旁白成功算成功。模型对自然语言正文与条件的理解仍需实际验收。

---

# 第二步历史回执（2026-09-08）

2026-09-08。开发基线：`cloudflare` / `5d4c1512488da9e134314589344c613a60aaf26a`，加本工作区在途修改。范围来自[实施计划](vnext-promise-lifecycle-implementation-plan.md)第二步 A/B/C/D；产品依据是主 PRD、SPEC 0005 和[已裁定生命周期合同](vnext-promise-lifecycle-contract-proposal.md)。

收尾时，共享目录的另一任务已将 HEAD 推进至 `ce349be46f4e158ccac7855d34a932598213431e`。该提交包含新房默认与旁白/填写修复，本任务的生命周期实现仍在工作树中；本回执的开发基线不代表当前 HEAD，也不将其他任务提交计作本任务操作。

状态：**第二步的基本闭环已完成本地定向验收。** 模型响应均为确定性夹具，未进行本轮真实供应商调用；这不是完整生命周期、生产发布或第三至第五步的验收。

## 1. 目标与能力合同

NPC 在自己合法取得的知识和资源内实际履行承诺；需要耗时的制作、交付使用真实 Activity 和通用物化、库存操作。承诺保存独立条款及期限，由主持复核读取已提交事实，Rules 验证证据、转换和因果前沿，Room 原子保存；角色只看到依法取得的结果。持续性义务使用同一复核机制，不为了排程捏造一个活动。

例如“一小时内交到手里”可以在真实工作三十分钟后完成，期限不再强制充当工期。“一小时后”仍须按原约语义判断，不能用这个例子宣称所有时间条件已通过。

| 组 | 已运行的代表性矩阵 | 结果与边界 |
| --- | --- | --- |
| A | 从真实原件制作副本并转交角色；同一路径制作不同名称的图稿并放在约定场景 | 两例共用 Bundle、Activity、物化、库存和复核。原件不变；副本的来源、数量、持有人或场景可核验；复核同时获得原件及产物定义。开始工作时没有未来物件，实际完成后才产生结果 |
| B | 持续保密至期限；在期限前真实分享秘密 | 没有 NPC 到期 Activity 也能复核。具有明确全期间依据时履约；提前传播产生真实 Knowledge 事件后可记违约，并保留剩余义务及原因 |
| C | 自报成功、预写计划痕迹、空操作标记、缺物件、缺期间依据；另一场景的未来事实；直接伪造裁定结果 fact | 不能代替实际履行或制造违约。缺期间材料可记无变化，不能从空查询证明“没有泄密”；错误时间范围的期间事实被拒绝。秘密结果 fact 只能由对应私有复核产生 |
| D | NPC 响应保存后驱逐；复核响应保存后驱逐；稳定结果再次驱逐及重复请求；发送后响应未知；发布失败后恢复及迟到旧代响应 | 保存的响应复用；原件、副本、事件、裁定及知识不重复。稳定重复请求完整返回相等，含 audience 发布状态；不新增提案、NPC、复核或旁白调用。未知响应不重采，迟到旧代旁白不能覆盖新结果 |

基本知情检查：正史履约不直接改变未获知角色所见的 `active` 状态，私有裁定原因不进入玩家返回或旁白；玩家秘密不进入 NPC 请求。通过真实 Rules 知识取得后，仅该 holder 看到新结果。长休样例验证交付及私有复核的基本连续性，不代表合法通知与继续/停止活动的全部组合已经验收。

## 2. 实现与直接消费者

| 接缝 | 实际实现及直接消费者 |
| --- | --- |
| 成立与执行分离 | `PromiseMade` 原五字段保持；同根新增私有 `PromiseTermsEstablished`，保存初始条款、所属时间线和独立期限。social 用 `terms` 与可空 `nextStep` 替代承诺的未来 `trace`。有下一步才形成 `NpcWorkProposed`；无下一步仅保存义务 |
| 通用 NPC 执行 | 新增 [NPC 请求与转换](../../app/_runtime/lib/kp/vnext/npc-work.ts)、[计划折叠](../../app/_runtime/lib/rules/v2/npc-work.ts)。复用完整 ProposalBundle parser/lowerer、物化、库存与 action Activity；计划开始、真实完成及中断分别保存，不把 Activity 完成当成履约裁定。普通 NPC 可持有/转交物品，不合成装备或战斗缓存 |
| 主持复核 | 新增 [生命周期规则](../../app/_runtime/lib/rules/v2/promise-lifecycle.ts)、[专用模型请求](../../app/_runtime/lib/kp/vnext/promise-review.ts)。事件折叠维护证据，事件/期限触发冻结 frame；私有 `resolvePromiseReview` 仍穿过 `step`。`PromiseReviewed` 保存有依据的 fulfilled/breached/unchanged 及剩余义务，不提供任意事件或状态覆写 |
| 物件与期间依据 | `AuthoredMaterializationResolved.sourceRefs` 保留真实绑定，来源纳入 read set；库存快照保留发生时的交付位置/持有人。普通 worldFact 可保存明确的 `WorldHistoryCoverage`，验证主体、时间线、分支和已结算时段；复核不能自己创作否定事实 |
| 工作与恢复 | [Room](../../app/_runtime/lib/room/durable-object.ts) 和 [原工作存储](../../app/_runtime/lib/room/authority-store.ts) 接入 activity/npcWork/promiseReview 联合类型，后两者 `activityId=null`。沿原 invocation journal 保存精确请求/响应，复用 HTTP 计数和物理调用捕获。旧 Activity-only SQLite 队列表事务升级保留原根、原因、描述、待办及重试状态；没有 D1 schema 变化 |
| Viewer 与更正 | `safePromiseFor` 按 holder 的合法知识选择结果，主持结论保存为隐藏的 `promiseReviewResult` fact；Claims 可合法为空。事件主体推导包含承诺/计划当事人，避免私有复核投影失败。更正撤回派生证据及计划状态，replay 不复活已撤回的泄密依据 |
| 同源协议消费者 | social schema、填写 codec、reference slots、lowering/guidance、world-interaction Profile、事件载体及 projection query 同步；parser 为 v52。旧承诺期限→假工期/未来痕迹的派生删除，已有独立 ActorPlan 执行继续保留并定向验证 |

运输层已按 `purpose` 区分 NPC 工作、承诺复核和既有 ActorPlan；部分内部错误码/故障注入 checkpoint 仍沿用 `ACTOR_PLAN` 命名。每 HTTP 七次物理调用上限未提高，没有增加审核模型或失败后的自动换模型。

完整重复响应验收还修复了两个相邻缺口：`withDueTail` 现在沿既存原因链重读已提交子结果，重试不会忘掉前一个 HTTP 已完成的交付；发布状态查询只将未完成 audience 判为过时，不再改写已发布记录或把内部 `staleOpen` 作为结果返回。复用原工作及发布日志，未新增第二份结果账本；父行动的 Receipt 保持。

## 3. 验证证据

以下按逻辑用例计数，修复后的重跑不重复累加。测试通过 Rules `step/project/replay`，跨层组使用真实本地 Room Action / Durable Object 接口和本地 SQLite；Provider transport 与旁白为确定性替身，不是 DeepSeek 实测。

| 检查 | 命令与结果 | 本地日志 |
| --- | --- | --- |
| 生命周期、social 直接消费者 | `npx tsx --test tests/kp-vnext-promise-lifecycle.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-social-shape.test.mjs`：29/29，exit 0 | `/tmp/zhuwei-promise-step2-final-node.log` |
| 原件进入复核材料 | 上一组最后补充原件/定义闭包后，`npx tsx --test --test-name-pattern='a real NPC bundle' tests/kp-vnext-promise-lifecycle.test.mjs`：同组两例 2/2，exit 0 | `/tmp/zhuwei-promise-step2-source-review.log` |
| 库存直接正常及越权路径 | `npx tsx --test --test-name-pattern='Rules release\|equipment removal\|foreign holder\|partial Rules transfer' tests/inventory-operations-vnext.test.mjs`：4/4，exit 0 | `/tmp/zhuwei-promise-step2-inventory.log` |
| NPC/复核恢复主纵切 | `npx vitest run tests/kp-vnext-promise-lifecycle-room.test.ts -t 'Room resumes saved NPC'`：1/1，exit 0，完整返回/状态/事件/调用相等 | `/tmp/zhuwei-promise-step2-recovery-final.log` |
| 其余 Room 生命周期与既有 ActorPlan | `npx vitest run tests/kp-vnext-promise-lifecycle-room.test.ts tests/kp-vnext-actor-plan-due-room.test.ts -t '^(?!.*Room resumes saved NPC)'`：18/18，exit 0；包括生命周期三例及既有 ActorPlan 十五例 | `/tmp/zhuwei-promise-step2-room-remaining.log` |
| 普通等待直接消费者 | `tests/kp-vnext-time-passage-room.test.ts` 的 `a plain wait`：1/1，完整重复返回相等且无新调用 | `/tmp/zhuwei-promise-step2-delivery-fix.log`；该文件也保存下述不适用的旧夹具失败，不能把整条命令标成通过 |
| 共享类型 | `npm run typecheck`：exit 0 | `/tmp/zhuwei-promise-step2-typecheck-final.log` |

合计为 **33 个 Node 逻辑用例、20 个当前 Room 逻辑用例通过**。未知响应测试产生的两条 `ACTOR_PLAN_DECISION_TRANSPORT_FAILED` 是明确的故障注入，结果仍为测试通过。

失败与处置：首次强化重复响应断言暴露旁白从 published 变为 notApplicable，补回子结果后又暴露已发布 audience 被过时判断丢弃；两个根因均已修复，未放松完整相等断言。补查的 `delivery-publication-retry-v2.test.ts` 旧 V3 privateFormProposal 夹具与当前 vNext 默认入口不匹配，在发布前返回 `authorityTransient`，没有取得该旧用例的通过证据；未改动该文件或扩大为旧协议迁移。当前 vNext 用例另行验证发布失败保持待恢复、恢复使用新代、迟到旧代响应严格拒绝及最终重试一致。

## 4. 未覆盖范围与下一步

- 第三步：玩家主动承诺及授权变化、完整条件/尝试语义、部分义务、延期/改约/取消、补交历史等变体尚未实现闭包；当前有初始 revision 和复核历史，不能称为完整版本化条款系统。
- 第四步：同一前沿多承诺合并复核、跨时间线全部因果组合、所有恢复点、长期待决调度、合法通知/继续/停止、战斗边界完整矩阵、章节与继任连续性尚待实施验收。当前按单承诺 frame 复核；首次 drain 可能包含其他到期工作，跨根/多时间线返回归属还未全面验收。
- 第五步：真实模型对条款、来源正文完整性、期间事实、复核措辞的理解，以及调用/费用、稳定性、真实游玩验收尚未开始。程序核验引用、时间和机械关系，不以 hash 声称已经证明任意文本“完整抄写”。
- 本任务未运行全量测试、全项目 Lint、production build、浏览器 QA、远端 migration、部署、Git push 或 commit。共享工作区其他任务的在途改动保留；它们的发布操作不属于本回执。

下一阶段按计划第三步推进；本轮未自动启动。
