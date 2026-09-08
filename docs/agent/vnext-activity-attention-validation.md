# 非战斗活动通知：本地实现与定向验证

2026-09-08。起点 `cloudflare` / `e657162883b6cde129c405b4d0a2374dfce22094`，实现、直接消费者测试及本回执纳入其后的本次本地提交。用户明确裁定：“非战斗状态可以，战斗不可以”。本回执只覆盖本地机制与接口，不代表真实 DeepSeek 连续游玩或生产采用。

## 目标与能力合同

角色在非战斗耗时活动中，无需另发等待指令即可推进到下一个因果期限。外部事件先按原 Rules/Room 路径落地；角色已经合法获得的新信息进入活动决定点，原控制者选择继续或结束。通知不等于醒来、取消长休或领取完成收益。继续先检查原活动前提，活动完成前再次检查，已经过去的时间与已提交事实保留。战斗遭遇状态由权威数据判断，活动继续不能跳过回合。

玩家普通 vNext-2 adjudication 的非零时长现在先开始 Activity，冻结整个完成计划；最终效果在活动完成根结算。同束内部仍是一个原子执行计划，中途独立发生的事件拥有自己的提交；没有把尚未发生的同束效果伪装为部分完成。

`due:1h` 的含义未改为“可能二十分钟完成”。NPC 计时仍由实际形成计划时的虚构时间加一小时得到；玩家活动只推进真实时钟，不改写约定期限。

## 代表性矩阵与结果

| 变化维度 | 本地证据 |
| --- | --- |
| 长休中获知新消息 | 真实一小时期限先到；无长休收益，通知后仍为 active；继续后八小时完成 |
| 普通调查中获知新消息 | 同一调度、通知和控制路径；未完成时没有调查结果；继续到十二小时档位后才结算 |
| 无消息的正常活动 | 长休与通过 vNext 提案进入 Room 的五分钟调查均无需 passTime，完成与效果各一次 |
| NPC 私有计划到期，角色未获知 | 计划执行本身不赋予玩家知识或通知；受控 fixture 随后通过既有 shareKnowledge 合法传递，才暂停活动 |
| 决定点恰好等于完成期限 | 已排队完成根保留，通知优先；驱逐后继续当次请求即可完成，无额外耗时或重复效果 |
| 原控制者、停止与前提变化 | 外人不能操作；停止保留已用时间；继续时目标被删除或事实已改变，立即中断，不额外消耗剩余时长 |
| 随机与澄清继续 | 直接耗时检定、先澄清再开始的检定，均覆盖保存随机请求/骰面后的驱逐恢复；只掷一次，保存骰面前不提交最终效果 |
| 原子计划的其他消费者 | 同束创建物品后使用、创建危险后触发保留 producer 身份、原生机械与精确 replay；不能直接调用带时长原子输入绕过 Activity |
| 战斗与原生施法 | 遭遇中不能用活动继续；既有长施法、反制/放弃反制及后续伤害恢复通过定向验证 |
| Viewer 与时间记录 | 通知只给知识持有者，完成计划/readSet 不出现在 Table 投影；结束时刻固定，不随后来的世界时钟继续增长 |

Room 的消息传递是受控世界 fixture，通过既有 Rules 操作和 Room journal 提交；它不是“真实 NPC 模型自主决定传话”的证据。感知信息复用已存在的知识取得通道，通知选择器本身不执行 observe、不创造知识、不判断角色是否醒来。普通装饰旁白和未获传递的幕后事实不进入该通道。本轮没有新增通用的重要性分类器或世界事件生成器。

## 实现与直接消费者

- `rules/v2/activity-progress.ts` 保存时间线/地点绑定和已确认信息，提供唯一通知标识及冻结依赖比较。`campaign-events.ts` 在开始时从权威状态派生记录，通知/确认/完成/中断均为可重放事件；澄清的外层依据也随选择转交给活动。
- `rules/v2/due-activities.ts` 复用等待/长施法的下一期限选择。推进、通知、完成共用持久 due 队列，已有骰子或玩家待决阻止越过；完成根不因消息确认而变化。
- `kp/vnext/proposal-bundle-lowering.ts` 在 lowering 子步骤前分配完成根，保留冻结上下文与 producer 身份。`room-bridge.ts` 从冻结完成输入读取相同的 authority bindings。零时长创作、显式等待和原生能力入口保持各自的规则合同。
- `rules/v2/world-interactions.ts` 先预检再开始；完成时只排除自身活动和合法时钟变化进行比较，其他变化/删除仍失败关闭。复用原子执行器、骰子与 native pending。`campaign-actions.ts` 提供推进及受控继续/结束，并保持原输入需重试的 due 结算语义。
- `room/action.ts`、`authority-types.ts`、`durable-object.ts` 接入可信角色的 `activityControl`；恢复输入闭合校验、持久队列、结果发布和幂等路径共用现有 Room 权威。取消过的推进根不能被误复用；恰好完成时暂停的旧完成根可在确认后重新调度。
- `events.ts`、`timeline.ts`、`claims.ts`、`projector.ts`、`correction.ts` 同步事件主体、时间与 Viewer 事实范围。`table/authoritative.ts`、`table/client.ts`、`table/server.ts`、`app/api/game/route.ts`、`play-table.tsx` 传递并展示通知与继续/结束按钮；遭遇中禁用，服务端再次拒绝越权或过期待决。
- 恢复与校验的直接影响：完成根使用 `ActivityCompletionInputRecorded` 保存真实骰面/原生回答，Rules replay 重新推导整个后缀并精确核对暂存候选；通知未代答。社交完成只同步已经提交的时间记录，知识与来源仍冻结；原生内部 Activity 的派生字段不冒充原始事件载荷。完成根被纠错时撤销其原开始/选择及后续阶段，清理随机继续与活动外壳。
- 直接调用用例通过 `tests/fixtures/vnext-action-lifecycle.mjs` 明确运行开始、推进、完成，保留所有真实事件及各阶段回执；投影使用目标回执对应的真实事件范围。没有全局替换 runtime、滤掉活动事件或把原子计划剥掉时长后伪装成正常玩家路径。通行失效的反例使用“连接已经关闭”的权威快照，单独验证拒绝/中断；不把它计为途中外部关门的调度或连续 replay 证据。
- `tools/run-deepseek-vnext2-authored-probe.mjs` 跟随实际 Activity 阶段取得最终结果；遇到玩家决定点停止，不自动代答。仅用注入响应核验该工具，没有访问真实提供方。

## 实际检查

检查只覆盖本次能力矩阵及 lowering 的直接调用者，没有运行全项目测试。初次直接调用者组 295 项中 152 过、143 失败，分别定位旧形状/即时结算断言和真实的社交时间、重放、纠错、待决调度及源诊断问题。失败记录位于 `/tmp/zhuwei-activity-direct-callers.log`，未将失败记为通过。

最终生产源码下，37 个 Node 文件共 309 项，308 过、1 失败（exit 1）。唯一余项是 `kp-vnext-observe.test.mjs` 仍用原子计划校验器检查 `startActionActivity` 外壳；改为检查其冻结的 `completionInput` 后，单独运行该文件 8/8（exit 0），包括知识校验前禁止掷骰、正常完成和完整 replay。此次只改该断言，没有再改生产源码，也没有合计重复运行的测试数或把首次组结果改写为 309/309。当前定向范围无未解决失败。

Node 组选取 `tests/` 下引用 `lowerVNext2ProposalBundle` 的 35 个 `.test.mjs` 文件，再加入时间推进、长施法的两个直接调度文件。实际 37 文件清单位于 `/tmp/zhuwei-activity-final-node-files.txt`，结果位于 `/tmp/zhuwei-activity-final-node.log`；可按清单复现：

```sh
npx tsx --test $(cat /tmp/zhuwei-activity-final-node-files.txt)
# 308 passed, 1 failed; exit 1，随后仅修正下列文件的检查位置
npx tsx --test tests/kp-vnext-observe.test.mjs
# 8/8; exit 0；/tmp/zhuwei-activity-final-observe.log
```

Room 与类型检查在同一最终生产源码下通过；Room 结果位于 `/tmp/zhuwei-activity-final-room.log`：

```sh
npx vitest run tests/kp-vnext-time-passage-room.test.ts tests/kp-vnext-sustained-casting-room.test.ts -t 'noncombat activity|durable long casting|declining Counterspell'
# 6 passed, 9 skipped; exit 0
npm run typecheck
# exit 0
```

早期代表性 Rules/调度矩阵 18/18、工具注入响应 3/3（均 exit 0）；这些文件也已纳入上面的最终 Node 组，不另计通过总数。没有为该工具调用真实模型：

```sh
npx tsx --test tests/kp-vnext-activity-attention.test.mjs tests/kp-vnext-time-passage-rules.test.mjs tests/kp-vnext-sustained-casting-due.test.mjs
npx tsx --test --test-name-pattern='injected probe|probe persists|probe honors' tests/kp-vnext-authored-context.test.mjs
```

收尾已检查本次修改/新增段落的 27 个本地链接目标、新源码行尾及最终差异，检查脚本和 `git diff --check` 均 exit 0。此前遥测的 17 项证据见[独立回执](vnext-telemetry-validation.md)，不叠加成新活动能力的测试总数。

调试中实际修复：恢复时推进根重复导致不再调度；通知处于完成时刻时旧完成根被挡住、确认后当次请求未 drain；恢复输入未接纳新阶段；冻结依赖删除未直接识别、澄清外层依据需要转交；继续前提失效仍消耗剩余时长；活动结束后的进度误随当前时钟增长。Room 输出的 `interrupted:afterCauseCommitBeforeDueTail` 来自用例明确注入的崩溃，不是未解释的测试错误。

既有 `kp-vnext-sustained-casting-room.test.ts` 首次 2 项失败在开始施法前的 `insufficientResource`。从起点 `e657162` 单独导出的源码运行同文件，得到相同的 2 项失败。原因是 fixture 的战斗记录有法术位而角色资源没有，已只补 fixture 中匹配的 slot1/slot3；生产施法规则未改，随后两项通过。物品用例中的两个 ActivityCompleted 属于不同活动：外层耗时行为与原生物品使用；本次没有删掉原生机械步骤来凑计数。

## 未覆盖与下一步

- 用户已授权本次本地 commit；没有新真实 API 批次、浏览器交互验收、全量测试、build、Lint、push、部署、migration 或旧房退役。历史三句批次成功不能证明本次活动能力已通过真实模型游玩。
- 原生物品使用/换装的内部机械时长保持现有 Rules；本次替代的是普通 adjudication 共享时长，并接入已有休整、通行、长施法活动调度。没有统一重写全部原生动作的时间合同。
- lowering 的直接调用者已按 Activity 阶段迁移并完成上述核对；完整项目回归仍未运行。该范围不等于历史 793 例基线或发布冻结门。
- 新消息的重要性由现有因果信息产生与感知/传递路径提供依据；未实现任意环境变化自动分类或睡眠中的全知通知。旧 vnext-1 无时长入口、承诺 fulfilled/broken 状态衔接、自然语言等待时长解释仍独立保留。
- 下一次真实验证应使用新的活动场景覆盖“途中实际获知 → 决定点 → 用户继续 → 完成”，并逐项核对真实调用费用、虚构时间、消息权限和重复提交；旧三句仍可独立复验 parser/承诺链，不能替代活动场景。
