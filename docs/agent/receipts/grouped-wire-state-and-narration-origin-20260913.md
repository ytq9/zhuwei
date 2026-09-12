# 分组步骤执行依赖与旁白来源修复回执

2026-09-13。基线 `c101986feec7e3e7b6204a547db934598a6dd4ed`，代码定稿 `21c4c9d`。工作树为 `.claude/worktrees/local-preview-changes-8206cb`，分支 `claude/local-preview-changes-8206cb`，沿用用户已授权的隔离工作树。本次为开发期修复，未 push、未部署，未改主工作树中的其他在途工作。

## 验收边界

依据 SPEC 0016 §§7、7.1、7.2、8.3：同一粗粒度行动中的类型化步骤，由服务端依据引用、状态版本和条件推导执行依赖；模型无需写顺序。旁白沿已提交事件、Viewer Claims 和冻结表达材料讲述当前结果；原意图与历史发言不证明新的已完成动作。

代表性矩阵覆盖：读取旧 NPC 知识、明确消费新知识、其他持有者的无关知识、新的可见叙述记录、物件补全后操作、成功/失败互斥修改、循环和伪造依赖拒绝；旁白覆盖普通等待、NPC 插入工作、玩家显式掷骰、澄清后延时完成、主动停止、恢复及 Viewer 权限。蜡烛只是历史反例，生产实现没有名称判断、正文关键词过滤或专用步骤顺序。

## 根因及恢复的不变量

原 wire 把跨类型步骤从模型数组重排为类型分组，旧依赖图只有生产/消费、共享随机与部分既有前置义务，漏掉了执行时冻结快照与写入之间的关系。向同一 NPC 增加未被本次对话消费的知识，会使后执行的对话拿着旧完整快照面对新知识目录，报 `social:npc-context-changed-or-forged`。原症状通过真实 encode → parse → lowering → Rules 路径复现；把 social 手工放前面仅用于单变量诊断，该绕行已从正式测试移除。

`atomicSnapshotDependencies` 是 lowering、Rules 编译与持久化计划校验共享的纯推导：读取旧版本先于替换该版本的写入，读取被另一条命令产生的版本则在生产者之后；先分别分析可能共同执行的成功/失败分支，再合并为一份冻结顺序。普通 readSet 仍是事务来源的并发证明，不一概解释为执行期旧版本读取。已有库存前缀和显式物化知识扩展继续必须通过原来的精确证明。

分组顺序只保留表单展示与原稿坐标的意义。编译不改原稿和 proposal ordinal；循环一次返回相关原稿位置，Room 仍按 proposalRef 把 Rules 路径映射回组名及组内位置。不可形成合法依赖时交回原有修正链，不删步骤、不刷新整个 NPC 快照、不执行候选状态试顺序。

复核中发现并修掉新推导的两个边界：最初没有区分 definition 的旧/新 revision，误拒绝“先补全再操作”；最初把互斥分支的读写混在一起，误报不存在的循环。两者均先留红用例，再修共享推导，最终沿真实 grouped wire 和 Rules 验证通过。

旁白问题是此次批次暴露的既有断点：Activity 在 child root 完成，旧代码从当前调用取不到原始意图；历史玩家请求又被放进 recentDialogue，丢了消息和回执来源。round 122 的实际 Claims、库存和事件没有重复物品，重复出在正文及审核。`e50194c → c101986` 没有改动该旁白来源路径，因此不把它归因为分组 wire 新增的旁白分支。

新路径从持久化 due work 的 Activity 找到实际开始事件、发起 root 的唯一非 answer Submission，再取精确 Receipt/messageId 对应的原文。触发调度的人、后续澄清答案、最近聊天和归档插入顺序都不替代发起者。只向同 principal 且同 character 的 Viewer 提供私有原意图；NPC 与主动停止新 root 不继承旧请求。生成与独立审核使用同一份冻结来源材料，历史原始请求不再冒充已听发言，通用 committed/applied 标注只证明结算状态。

这条链还暴露两个直接消费者的旧单阶段假设：`storyAdmissionPreparation` 错把同 root 的 intent 和 answer 当身份冲突；Claims 只允许恰好一个 ActivityStarted，误把前面的选择协议记录算作结果异常。前者按发起 Submission 查准备包，保留权限/hash/绑定验证；后者复用冻结输入协议记录分类，排除记账后仍只允许单个未完成的 Activity 开始，其他真实结果照常产 Claims，只有执行 marker 而无结果仍拒绝。

旁白反例审核另产生“合法错误说明 + 非法 occurrence”的混合报告。新 decoder 汇总条目错误并保留独立合法的拒绝说明，整份非法报告仍按 narrationSchema 拒绝，不改编号、不删错后通过、不增加模型调用。

## 既有修正与 token 优化

- fillingLayout 仍为 v4：按已加载类型分组，结果挂在各自 step 内，没有新增 order、dependsOn 或独立 results 对照字段。
- 解码同阶段一次汇总错误、补选类型及其票据继承、lowering/Rules 拒绝进入修正均保留。
- JSON Patch / replaceDraft、精确 sourceDraftVersion、原稿位置、稳定对话前缀与最多三轮 correction 保留。
- 无效补丁保留同稿并消耗一轮；同错误重复停止；原稿重交当场停止。Provider 与 Room 仍取第一个完整工具调用。
- 新依赖诊断不发送整张图；表单描述只去掉误导性的“按发生顺序填写”。没有修改修正调用编排或增加修正调用。

本次未重新做 Proposal 修订缓存的真实性能测量，不能声称具体 token 数完全不变。旁白来源和结果归属材料有输入成本：对照原 round 122 capture 013/014 的 2,886/4,070 输入 token，新生成/审核为 3,419/4,791，分别增加 533/721。这些增加发生在旁白链；同一 Proposal 的稳定修订前缀机制不变。

## 定向验证

以下命令均从 `local-preview-changes-8206cb` 运行，子任务的独立验证详见[旁白回执](vnext-narration-origin-validation.md)。没有把不同时点或重叠用例相加成一个全量通过数。

| 证据 | 命令 / 日志 | 结果 |
| --- | --- | --- |
| 最终状态版本、互斥分支、物件与知识矩阵 | `npx tsx --test tests/kp-vnext-object-completion.test.mjs tests/kp-vnext-world-fact-memory.test.mjs`；`snapshot-versions-final.log` | 22/22，exit 0；包含原症状、不同结构样例、循环/伪造拒绝、两骰分支和 replay 相等 |
| 最终 Claims 开始/真实结果边界 | `npx tsx --test --test-name-pattern='action Activity starts\|item Activity, elapsed time\|definition registration' tests/kp-vnext-claims.test.mjs`；`claims-start-node.log` | 3/3，exit 0 |
| 最终集成 Room | `npx vitest run tests/kp-vnext-provider-room.test.ts tests/kp-vnext-time-passage-room.test.ts -t 'repairs an all-empty grouped ruling\|does not grant an empty execution draft\|retains a proved producer type\|an empty social draft retains\|a clarification answer and later player roll'`；`final-room-integration.log` | 5 passed / 61 skipped，exit 0；空组修正、终结预算、类型继承、意图保留、澄清后 Activity/玩家 roll/恢复 |
| 类型检查 | `npm run typecheck`；`final-typecheck.log` | exit 0 |
| 规格引用检查 | `npm run spec:check`；`final-spec-check.log` | exit 0，0 错误；6 个 oversize 和 1 个既有 stale-gate 警告，没有修改规格来消除它们 |
| 真实报告在最终集成代码的离线复验 | `npx tsx .wrangler/grouped-wire-validation/recheck-narration-review-offline.mjs` | exit 0，0 次 API；三份模型请求与原 live 逐对象相等；新正文报告可解码，旧坏正文报告仍拒绝且保留合法诊断 |
| 最终差异 | `git diff --check`，定向 diff 与直接消费者检索 | exit 0；原稿索引、proof、恢复与 Viewer 权限接缝已逐项查看 |

早期直接消费者检查：world-fact-memory、social-plan、proposal-revision、unparsed-revision 为 50/50（`snapshot-targeted-node.log`）；atomic-input、proposal-bundle、narrative-details 为 57/57（`snapshot-consumers-node.log`）。这些发生在最后的 definition 版本/互斥分支细化前；细化后的定向矩阵是上表 22 项，未为了凑数重跑全部文件。

另一组 structured-diagnostics、producer-completion、schema-retrieval、proposal-revision、world-fact-memory 为 59/63（`snapshot-final-node.log`）。在独立干净 `c101986` 工作树复跑 schema-retrieval 是 9/13（`snapshot-baseline-schema.log`），失败名字完全相同，未改基线：

- every advertised capability loads its complete filling guidance and only applicable template defaults
- final proposal rejects unloaded authoring or a second query without spending correction
- schema selection retains terminals and closes only selected step families, across distinct composites
- each terminal-only selection exposes exactly its form and rejects other terminals or another query

旁白子任务另观察到未修改的旧 `timed checks and frozen choices recover` 用例期待自动完成，而接口返回 awaitingPlayerRoll。它没有在干净基线独立复跑，旧断言与现役玩家显式掷骰不符的归因属于源码分析；不能当作全量基线比较。新增真实 Room 用例走显式玩家 roll，完成/恢复/幂等均通过。主动 stop 的边界见子回执，未把其旁白路由迁移列为本次交付。

## 有界真实模型结果

使用历史 round 122 的真实事件、Claims 和精确持久化来源重建表达材料，默认 `deepseek-v4-flash`，共三次调用后停止；这是一个旁白生成/审核对加一个坏正文反例审核，不是重开三个完整游戏批次。

| 调用 | 输入 | 输出 | 缓存命中 | 缓存未命中 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 新正文生成 | 3,419 | 797 | 256 | 3,163 | 没有重复上一轮拿蜡烛 |
| 新正文审核 | 4,791 | 141 | 128 | 4,663 | 五项 pass，issues=[] |
| 原坏正文审核 | 4,783 | 381 | 1,408 | 3,375 | 抓到额外拿物品；第二条引用的 occurrence=1 越界，报告格式未通过 |

合计输入 12,993、输出 1,319、命中输入 1,792、未命中输入 11,201；生成输出含 665 reasoning token，不重复加计。没有重试或再采样。原始 `narration-origin-live/report.json` 保持 `status=failed`，不能把修后离线重解伪装成模型真实返回了合法报告。

最终 decoder 对同份保存回复仍抛 `ModelOutputValidationError`，保留 `RESULT_CHANGED /payloads/4`、occurrence=0 和准确 quote；报告问题为 `issues[1].occurrence` 与 `checks.continuity`。`offline-recheck.json` 分别记录 live 状态和本地修复证据。

## 集成与未覆盖范围

隔离子任务 `narration_origin` 也从 `c101986` 开始，所有权限定于 Room/旁白及其直接测试。主任务负责 Rules、lowering、分组表单和 Claims。收回前已审阅两份代码 diff，集成没有冲突：

| 子任务提交 | 主工作树提交 | 内容 |
| --- | --- | --- |
| `78ad6bf` | `4ce6f06` | 旁白来源与历史边界 |
| `d1a3aec` | `a1bb159` | 非法审核报告保留合法诊断 |
| `e573c5b` | `46c9960` | 子任务独立回执 |

主任务提交 `b9fc6df` 为 Claims 的选择记录前缀修复，`21c4c9d` 为执行依赖及其矩阵。子工作树为验证临时应用的 Claims 补丁由主任务收回后清理；它没有作为子提交重复集成。临时干净基线工作树已正常移除。依用户之前的决定，本次没有补写 refactor-log，排查与集成过程仅记在新回执，不改历史回执。

直接消费者：依赖推导被 lowering、Rules 编译和持久化形状校验共同使用；Room 的 Rules 路径映射按 proposalRef 返回原稿；旁白 schema 被权威 Adapter、冻结 Delivery 与故事归档校验消费。管理员事后纠错的 audience 调用没有玩家发起文本，保持 actorIntent=null。没有新增第二套状态写入、迁移或公共裁决路径。

Parser 为 v67，fillingLayout 仍 v4；冻结表达为 v2，生成 v2、审核/policy v13。runtime-policy 与 Proposal workflow hash 的直接消费者已核对；版本变化进入新 workflow，旧冻结上下文没有 fallback。本次没有解释、迁移或部署到旧房间。

may-write 描述覆盖当前 Atomic 命令类型；动态区域目标和没有地点绑定的 ActorPlan trace 使用保守影响范围，实际效果仍由原 Rules 预检裁决。循环、缺乏已证明前缀的组合和超出原语闭包的行动继续明确拒绝；本次不宣称获得任意行动图的完备调度器，也不以一次真实旁白证明长期零重复。

所有原始证据在本工作树忽略目录 `.wrangler/grouped-wire-validation/`；旁白重建原件在子工作树 `.wrangler/narration-origin/`。这些本地文件未加入 Git，跨机器需要另行移交。会话 cookie/密钥未输出或提交。

未运行全量 Node/Vitest、gate、production build、全项目 lint、远端 migration、push、部署或长期可靠性采样。真实旁白复验没有从新房重跑完整 Proposal → Rules → Room；该接口链的改动由上面的确定性 Room 回归验证。
