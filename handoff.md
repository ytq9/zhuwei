# 交接 — vNext 完整 Goal 续作（2026-09-07）

写给下一个接手的我自己。基线是**工作树**，不是 HEAD；下面每条状态都注明了来源是我本次核对的，还是抄自既有回执的。

这个文件永远是**当前**交接点。它替换了 `cee6834` 时期的旧检查点（“vNext 阶段三续作交接：Claims 安全闭环后”），那份内容仍可用 `git show HEAD:handoff.md` 取回。按主题归档的历史交接在 `docs/agent/`，例如 [危害与物品](docs/agent/handoff-hazards-and-items.md)（基线 `0a86fc0`）。

---

## 1. 一句话状态

**阶段性交接，2026-09-07 晚。基线 `81c3b1e` 之上多了一个提交（等待走模型旁白），分支 `cloudflare` 领先 `origin` 未推送。** 本节只写「现在在哪、下一步是什么」；细节在 §7 与各回执。

vNext 能用正常注册 Cookie → `/api/game` 的真实链路让真实 DeepSeek 走完完整行动。round78 是第一个连过第二句的批次；[round80](docs/agent/vnext-round80-validation.md) 是第一个**普通交谈推进了时钟**的批次：模型在共享裁决上填 `durationMicros:"12000000"`，`branch:main` 0 → 12000000，`FictionTimeAdvanced` 是首条事件、落在行动者时间线、旁白看到了时间 Claim；第二句 `passTime` 再 +60 秒。**正常游玩里时间从此会走。**

本次会话与用户达成的三条设计裁定（都还没实现，见 §7）：

1. **时长改档位。** KP 只在 5 分钟 / 10 分钟 / 半小时 / 1 小时 / 半天里选，服务器映射成微秒；微秒仍是时钟内部单位（战斗轮、休整、通行不变）。round79 填 30 秒、round80 填 12 秒是假精度。副产品：「半分钟后敲账台」落在同一个 5 分钟档里，行动结束时已过，KP 该在同一段回应里就地兑现。
2. **不重要的行为不进机械。** 一个承诺只有在**独立于玩家注意力而发生**、**被别处的人看到**、或**改变权威状态**时才进 promise → plan → due；否则留在 `recentDialogue` / `commitNarrativeDetail`，KP 凭时钟自己兑现。半分钟的敲击三条都不沾。**因此五批 `consequences: []` 是模型在做正确判断，不是缺陷**——我此前要加强指引让模型必须记承诺的想法是错的，撤回。第 2、3 层的合同缩到几小时尺度的约定。
3. **承诺怎么还，分三种情况。** 玩家留下等 → 等待的旁白里还；留下做别的 → 下一次回应的背景里还；离开 → 承诺依附于在场，不需要还，但瓦罗的记忆已是机械的（社交交谈产生 `KnowledgeAcquired`）。

由此，**「等待不发布旁白」从独立小缺陷变成主线阻塞**：round78/80 里玩家等了一分钟屏幕上什么也没多出来，承诺没还，是因为纯等待走确定性交付、不建模型旁白（round61 为省调用的决定）。**这一条已在本地做完**（[等待旁白回执](docs/agent/vnext-wait-narration-validation.md)）：活着的 Viewer 的等待现在建模型旁白，旁白上下文给等待冻结前 30 分钟同场景的已听发言，提示词允许按 NPC 原话兑现即时小动作。零真实证据；round81 第三句是它的检验。

## 2. 接手坐标

| 项 | 值 |
| --- | --- |
| 分支 | `cloudflare` |
| 检查点 | `72201ea` `chore: checkpoint the uncommitted vNext working tree` |
| HEAD | 检查点之后还有文档提交，以 `git rev-parse HEAD` 为准 |
| 上一个能力提交 | `258caee404e0814405eb497653ee9f00d647b773`，此前 vNext 全部实现都只在工作树里 |
| 工作目录 | `/Users/sanmu/Documents/zhuwei-cloudflare`；工作树是否干净以 `git status` 为准 |
| 另有 | `git stash list` 一条 `codex: preserve local changes before GitHub sync 2026-08-31`，不要动 |
| 最近一次验证 | 引用槽准入的定向测试组 + `npm run typecheck` exit 0，与 `72201ea` 基线逐名对照零回归 |
| 未运行 | 全量回归、构建、模型探针、部署、远端 migration |

`72201ea` 是 2026-09-07 用户授权打的**本地还原点**，一次收进 507 个文件、85087 行，其中 369 个是首次进入版本库。它不是里程碑、不是验收、不代表任何测试跑过 —— 唯一的证据是 typecheck exit 0。对这些文件做 `git log` 或 `git blame` 只会看到这一个提交，历史在此之前不存在。

源码地图见 [repo-map.md](docs/agent/repo-map.md)（同日核对）。

## 3. 先接受这三件事，再动手

**一，commit 已放开，push 没有。** 在 `72201ea` 之前，vNext 绝大部分实现（72 个源码文件、88 个测试）从没进过 commit，一次误操作就会全丢。用户在 2026-09-07 打完那个还原点后说「以后自己提交」—— 所以**完成一个切片就自己提交**，用仓库的 conventional commit 风格，正文如实写清验证了什么、没验证什么、还有什么是红的。这不外推：`git push`、部署、远端 migration、创建远端资源、退役房间/归档仍然每次都要用户在当轮点头（`push到远端` 是单独给过的一次，不构成常设授权）。任何时候都不要用 `git reset`、`git stash`、`git checkout --` 或切分支来“清理环境”；要看差别就用 `git diff` 和 `git status`。

**二，本地绿不等于真实通过。** 这个项目区分得很严：本地 Node/Vitest 测试和 typecheck 只用于定位与防回归；只有 `docs/agent/vnext-round<N>-validation.md` 里、经正常注册 Cookie + 真实 DeepSeek 走完的批次，才算“真的过了”。注入响应、fixture、重采样都不算。失败不改判、不重跑洗成功、不把两类失败合并计数。

**三，执行边界（用户已明确，见 [AGENTS.md](AGENTS.md) 与 [vnext-production-todo.md](docs/agent/vnext-production-todo.md)）。**

- 有界真实 DeepSeek 测试和看服务端日志：已授权，不必逐次再问；但要守预设预算（每批 20 次物理调用 / ¥5 / 每次 HTTP 5 调用 120s）、失败即停、秘密脱敏、结果精确核对。
- 退役 0.4 以前的房间与归档：已授权，不建兼容 Adapter，不做旧房 migration。
- 部署、远端 migration、创建远端资源、Git push、里程碑冻结、完整回归：**每次都要用户在当轮明确授权**。“修好了”“完成了”不构成授权。
- 密钥只从 `.dev.vars` / Worker Secret 读，不写进仓库、不贴进聊天。

## 4. 当前 Goal 与走到哪

完整 vNext Goal 保持 active：按 [SPEC 0001](docs/specs/0001-llm-kp-responsibility-contract.md) 的 A–O 场景，用 vNext-2 替代现役 V3，而不是继续补 V3。分账与顺序在 [vnext-production-todo.md](docs/agent/vnext-production-todo.md)（V01–V13）。

已经站住的（抄自既有回执，本次未复跑）：

- 两轮填表接口（扁平选类型 → 只填 `decision`），服务器生成外壳、根依据并集、producer、类型化依赖。
- 服务端先证明修复计划、模型只确认的一次窄修订；冻结输入回填的等义删除票据（最后一条日志）。
- 能力/资源池同源：`ResourceSpent` 不再新建别名池，core/public/combat 三处同步（round71 的分叉已修，round72/73 复验通过）。
- 危害以冻结 Ability 结算、物品完整生命周期与组件拆装、动态地点/通道、NPC 计划形成、社交承诺、时间流逝与 Activity 到期。
- Claims → DeliveryPlan → 旁白生成 + 一次逐断言审核的防泄漏闭环。

还没站住的：**连续多个意图的稳定性**、多人 20+、真实窄修订被模型触发过、完整叙述质量、生产采用门。

## 5. 最近三次真实批次的准确结论

抄自各自回执，不要在没有新批次的情况下改写这些判断。

| 批次 | 场景 | 结果 | 停在哪 |
| --- | --- | --- | --- |
| [round70](docs/agent/vnext-round70-validation.md) | 原 NPC 三句 | 两次调用，第二次 `response.basis` 选对了本人来源，但 `decision.steps[0].basisRefs[2]` 填了 `nonCitable` 的 npc-decision 目录包装 | `PROPOSAL_REFERENCE_INVALID`，0 提交，后两句未发 |
| [round72](docs/agent/vnext-round72-validation.md) | 三句固定施法 | 首句 committed/published，资源 4→3 正确；第二句多填了与冻结 context 逐值相同的 `decision.intent` | `VALUE_INVALID` 在 `terminal.intent` 提前拒绝，未修订，第三句未发 |
| [round73](docs/agent/vnext-round73-validation.md) | 同上，在冻结输入回填修订落地之后 | 首句 4 次调用、无修订、完整通过（真骰 d8=5，满血所以 applied=0，一环 4→3）；第二句 `operation.abilityRef` 又选了上一句的 cure 而不是 healing-word，`target.kind=creatures` 的 `refs[0]` 填了自己的开场知识记录 | `PROPOSAL_REFERENCE_INVALID`，0 提交，第三句未发 |
| [round74](docs/agent/vnext-round74-validation.md) | 原 NPC 三句，在引用槽准入落地之后 | 第一句第 2 次调用返回的 tool arguments 不是合法 JSON：`decision.risk` 里有未转义 ASCII 双引号（模型把玩家用中文引号写的名字改成了 ASCII 引号）。无窄修订可用——草稿未解析则 bundle 不存在 | `PROPOSAL_FORM_INVALID` / `JSON_SYNTAX`，0 提交，stateVersion 保持 0，第二三句未发 |
| [round75](docs/agent/vnext-round75-validation.md) | 同一 NPC 场景，在 v39 + v40 落地之后 | 首句 4 次调用完整 committed/published，无修订无重发，公开结果合法连贯（瓦罗答应半分钟后敲三下）。但 `npcPlans`/`activities` 为空、无 `NpcPlanFormed`/`ActivityStarted`，提案降级为 `worldInteraction` | `legalNoPlan` 停止（**非技术失败**），第二三句未发 |
| [round76](docs/agent/vnext-round76-validation.md) | 同上，在 v41 落地之后 | ordinal 2 **从未发出 HTTP**：本地传输断言要求恰好一个工具，而提案调用带了两个。日志里的 `providerStatus:422` 是本地常量，不是供应商响应 | `transportFailure`，我方缺陷，非模型失败 |
| [round77](docs/agent/vnext-round77-validation.md) | 同上，传输放宽之后 | 首句 4 次调用完整 committed/published。双工具 surface 真的到达模型（传输修复有真实证据）；选择组合变为 `["social","passTime"]`（round75 是 `["social","commitNarrativeDetail"]`）。但 `passTime` 未被使用，`formActorPlan` 未选，计划/活动/承诺仍为 0 | `legalNoPlan` —— **但这个 gate 可能考错了东西，见 §7** |

round73 三个必须记住的细节：

1. **窄修订仍未被真实模型触发过。** 四条提案 journal 的 `repair_ticket_json` 全空。不能因为首句成功就说 echo 修复已被真实验证。
2. **遥测指错了地方。** 原始遥测只写 `REFERENCE_UNAVAILABLE / unrecognized`，没有指向模型实际填错的字段位置。
3. **旁白文字质量有缺口未修。** 满血状态说“伤势并未好转”，以及笼统的“可用施法资源剩余 3 次”（3 是一环池，二环还有 2）。gate 判为表达不精确，未认定机械矛盾。

## 6. 引用槽准入：已完成，等真实验证

2026-09-07 落地，完整回执见 [vnext-reference-slot-admission-validation.md](docs/agent/vnext-reference-slot-admission-validation.md)。

交接上一版把落点推断为 `proposal-reference-slots.ts` —— **那是错的**，那个文件只负责抽取 `prospective:` 句柄给依赖图用。真正的落点是 schema 构造：候选面以枚举形式下发给模型。

修好的两半：

- round70 的 basis 半边**在本次之前就已经修好**（`tests/kp-vnext-basis-reference-surface.test.mjs` 独立跑过 exit 0）。`nonCitable` 的 NPC 包装既不在枚举里，也被 lowerer 拒绝。
- round73 的槽类型半边是本次修的。`abilityOperation.operation.target.refs` 与 `worldInteraction.targetRefs` / `directTargetRefs` 此前是自由字符串，只有 prose 让模型“从 viewerEvidenceRefs 选”。现在由 `proposalSubjectRefs(context, class)` 按对象类别（生物 / 物理主体 / 物品条目）从同一冻结上下文投影候选面，作为枚举下发。

parser 合同升到 `kp-vnext2-proposal-parser-v39`，`referenceSelection` 升到 `frozen-authorized-read-bound-basis-and-classed-visible-subjects-v3`。

**证据只有本地。** 代表性矩阵 4/4、直接消费者与基线 `72201ea` 逐名对照零回归、typecheck exit 0。零 API 调用，所以不能声称模型真的会填对了 —— 那要靠 round74。

顺带修好了两项**基线上就红**的既有测试（它们正是这次要依赖的守卫，都是过时夹具，生产路径无碍）；另有 10 项 schema 测试和 4 项 Room 测试在基线上就红，本次零引入零改判，清单在回执里。

还没做的：`worldInteraction.instrumentRefs` 仍是自由字符串（准入带持有人作用域，要另立合同）；遥测仍只报 `REFERENCE_UNAVAILABLE / unrecognized`，没指向模型填错的字段位置；round73 选错能力（cure 而非 healing-word）是模型判断问题，不是准入问题。

## 7. 下一步，按这个顺序

### 1. 等待走模型旁白（上下文路线的前提）—— 已做，本地验证

[回执](docs/agent/vnext-wait-narration-validation.md)。三处改动：Room 只对 lifecycle 受众跳过等待旁白；`roomNarrationContext` 给等待冻结 `[开始 − 30 分钟, 结束]` 内同场景已听发言与本人最近发言；生成/审核提示词各加一条「NPC 原话约定在经过时间内兑现的即时小动作可按原话写成已发生」（review schema v12、policy v10）。代价：纯等待 2 → 4 次调用，等待 + 可见 NPC 行动 5 → 7——**round81 若场景里有到期 NPC 行动，per-HTTP 限额要设 7**（round81 现有场景 npcPlans 为 0，4 次够）。闹钟路径完成的等待落成 `narrationRecovery`，未真实验证。

### 2. 时长改档位

`decision.durationMicros`（pattern 字符串）→ 枚举 `duration`：`5min | 10min | 30min | 1h | halfDay`，lowering 映射成微秒后仍走现有 `executionCosts.fictionTime` 路径（[实现回执](docs/agent/vnext-fiction-time-validation.md)）。纯创作束仍不花时间（现在是 `"0"`，改成不填或 `none`，二选一时保持「零必须显式」）。指引里的锚点表换成枚举说明。parser 升版。夹具：`tests/fixtures/vnext-action-duration.mjs` 的 `actDuration` / `withActDuration` 改返回档位即可，24 处 `soleStep` 读取不受影响。

### 3. round81：三句发完，看第三句

准备包从 `/tmp/zhuwei-round80-npc-preparation` 复制（round79 起 gate 已双向核对每句的虚构增量）。等待有了旁白之后 gate2 才有公开结果可复核，第三句才发得出去。**第三句的问题只有一个：KP 有没有把那两下敲击还给玩家。** 这是上下文路线成立与否的直接证据。

### 4. 第 2、3 层只管几小时尺度

「明早卯时把文书送来」这一类才需要 `consequences.promise` → `formActorPlan` → due。`formActorPlan` 只认行动前 `state` 里的依据（[actor-plans.ts:20](app/_runtime/lib/rules/v2/actor-plans.ts:20)），所以最短闭合是 promise 自带 `dueMicros`、Rules 在同根内 `PromiseMade` fold 之后派生计划——那时依据已在累加状态里。另立合同，不动现有 `consequences` 指引。场景要换成几小时尺度的，round70 那句半分钟不再用来验这层。

### 已完成、真实证据分账

| 改动 | 真实证据 |
| --- | --- |
| 虚构时长合同（v42，`759393d`） | **round80：声明 12 秒、时钟推进 12 秒、事件首条、行动者时间线、旁白见 Claim** |
| 裸 `"none"` 统一解码（v43，`fee45ef`） | 未触发（round80 模型写对了 `{kind:"none"}`）；round79 是它的用例 |
| gate 记录而非要求计划（round78 起） | round78/80 走到第二句 |
| 传输接受双工具 | round77/78/80 capture 均见两个工具到达模型 |
| parser v39 引用槽准入 | round75 验到「不误伤」；未验到「挡得住」 |
| parser v40 未解析重发 | **无** |
| parser v41 一次补选 | **无**，六次 ordinal 2 都带着工具、一次未用 |

### 已知缺口（各自独立）

- `mechanicalResult.fictionTime`（含 `crossedDeadlines`）没进 Room 返回和遥测，只在 Rules 结果上（round80 确认）。档位化之后再接。
- 第二句选中 `observe` 后填写阶段丢弃，玩家明写的「留意动静」随之消失，不留痕（round78/80 均如此）。
- 闹钟路径（玩家不在线时到期）完成的等待：audience 建好但当时无人旁白，靠 `narrationRecovery` 在下次 observe 发布——链路是旧的，等待这一用法没跑过。
- 旧线 vnext-1（`atomicRulesSteps`）没有时长字段，Rules 只裁「纯创作不能花时间」这一半；「角色行动必须声明」是 vnext-2 lowering 的规则。

## 8. 已知缺口（各自建合同，别塞进同一个补丁）

- **连续意图稳定性**：从来没有一个批次连过三句。这是当前最大的未知，不是某个单点 bug。
- **真实窄修订**：机制齐了，模型没触发过一次。
- **旁白文字精确度**：满血说“伤势”、笼统说“资源剩 3 次”（未区分环级）。
- **`highRiskConfirmed`**：仍无消费者，继续失败关闭；启用前要把私有 pending continuation 与 bundle/plan/context/ruling hash 一起持久化并在提交时重验。
- **`openBlank`**：休眠中；启用前要先建权威授权事实源并进入提交时读取集。
- **`reviseSemanticDefinition`**：类型存在，但 `lowerExecutableEntry` 返回 `BUNDLE_LOWERING_UNSUPPORTED`，模型入口够不到。
- **规模**：3 整卡容量、20+ 多人、完整战斗、发布数据恢复都没验证过。
- **生产采用门**：V12/V13 一步未动，生产仍是 V3。

## 9. 怎么跑

```bash
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/vnext/state
npm run dev:vnext
```

可选 `ZHUWEI_VNEXT_LOCAL_CALL_LIMIT=3`（限单次 HTTP 的提案+修订+旁白调用）与 `ZHUWEI_VNEXT_LOCAL_CAPTURE_URL`（镜像请求响应）。游戏与捕获服务占 4320 / 4321。

定向验证（AGENTS 的开发期门，默认最多三类直接证据，同一源码状态每项跑一次）：

```bash
npx tsx --test tests/<target>.test.mjs
npx vitest run tests/<target>.test.ts
npm run typecheck
```

引用这条线相关的目标测试：`tests/kp-vnext-reference-slot-admission.test.mjs`（本次新增的代表性矩阵）、`tests/kp-vnext-basis-reference-surface.test.mjs`、`tests/kp-vnext-observation-reference-surface.test.mjs`、`tests/kp-vnext-item-reference-surface.test.mjs`、`tests/kp-vnext-proposal-reference-slots.test.mjs`、`tests/kp-vnext-npc-decision-context.test.mjs`、`tests/kp-vnext-stage3-room.test.ts`。

判断某个失败是不是自己造成的，先取基线，别猜：

```bash
git worktree add --detach /tmp/zhuwei-baseline 72201ea && ln -s "$PWD/node_modules" /tmp/zhuwei-baseline/node_modules
```

## 10. 不要做的事

- 不要提交、stash、reset 或还原工作树。
- 不要跑 `npm test`、全项目 lint、production build、远端 migration、`cf:deploy` 或 push —— 除非用户在当轮明确要求。
- 不要为了让某个真实批次过去而改测试、加 fallback、换模型、自动重试或放宽校验。
- 不要把 round70/72/73 的失败重新分类或合并计数。
- 不要把 `/tmp` 里的私有证据（原稿、Cookie、冻结上下文正文）搬进仓库或聊天。
- 不要把这份交接或 repo map 当架构权威 —— 权威是 SPEC 0001、已裁定补充 SPEC 和源码。

## 11. 你结束时要更新什么

按 [AGENTS.md](AGENTS.md) 的执行日志要求：在 [refactor-log.md](docs/refactor-log.md) 追加一条紧凑记录（能力开发写目标/合同/矩阵/改动/直接消费者/实际命令与退出码/未覆盖范围；Bug 修复写症状/根因/改动/连带检查/证据/未覆盖）。真实批次另出 `vnext-round<N>-validation.md` + `-live-evidence.json`，能力开发另出 `vnext-<主题>-validation.md`（必要时加 `-integration.json`）。同步 [vnext-production-todo.md](docs/agent/vnext-production-todo.md) 的分账，源码位置变了就改 [repo-map.md](docs/agent/repo-map.md)，接手点变了就改这份交接。
