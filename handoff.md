# 交接 — vNext 完整 Goal 续作（2026-09-07）

写给下一个接手的我自己。基线是**工作树**，不是 HEAD；下面每条状态都注明了来源是我本次核对的，还是抄自既有回执的。

这个文件永远是**当前**交接点。它替换了 `cee6834` 时期的旧检查点（“vNext 阶段三续作交接：Claims 安全闭环后”），那份内容仍可用 `git show HEAD:handoff.md` 取回。按主题归档的历史交接在 `docs/agent/`，例如 [危害与物品](docs/agent/handoff-hazards-and-items.md)（基线 `0a86fc0`）。

---

## 1. 一句话状态

vNext 能用正常注册 Cookie → `/api/game` 的真实链路让真实 DeepSeek 走完一次完整行动。[round78](docs/agent/vnext-round78-validation.md) 是**第一个连过第二个意图**的批次——之前 77 批都停在第一句，因为 gate 要求首句就形成 NPC 计划。

那条要求是错的，而且不是代码：`formActorPlan` 的依据只从**本次行动之前**的 `state` 读（[actor-plans.ts:20](app/_runtime/lib/rules/v2/actor-plans.ts:20)），所以同束里引不到本束刚创建的承诺。首句能做的只有**记下承诺**，第二句才谈得上形成计划。gate 改成声明并双向核对世界的实际新增之后，链条第一次走通。

round78 一次看到两件事：

- **承诺只存在于散文里。** 瓦罗公开说「过半刻，我敲一记账台」，同一 step 的 `goal` 也写着「并在半分钟后敲账台提醒」，而 `consequences: []`。promise 槽位在 schema 里，指引也写着「NPC只能作出自己的承诺或债务」。第三批连着如此（75/77/78）。
- **时间真的走了，到期什么也没有。** 第二句 `passTime` 推进 `nowMicros` 0 → 60000000，三条事件齐全，机械侧完全正确；但 0 条 `NpcActionCommitted`、0 条痕迹、`npcPlans`/`promises` 仍是 0。**关于时长阈值的怀疑到此可以放下：玩家显式等了一分钟，时钟诚实推进，承诺的动作依然不存在。问题与时长无关。**

还有一条：第二句选中 `observe` 后在填写阶段丢弃，玩家明写的「留意瓦罗和周围的动静」随之消失，而且 `narration: notApplicable`——**等了一分钟的玩家屏幕上什么也没多出来**。选中后丢弃不留痕，这次有了具体代价。

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

## 7. 下一件事：先让普通行动消耗虚构时间，再问 `consequences` 为什么是空的

round78 之后用户指出：这是虚构时间，剧本里做的任何事都应该有一个合理的虚构时长。对照源码：成功的 `social` / `observe` / `worldInteraction` / `inventoryOperation` **没有任何时长字段**，只有 `passTime`、通行、长施法、拒绝的 `attemptCosts` 能推进时钟。能力目录甚至写着「当前表单支持即时口头交谈」。这是三层缺口里最底下的一层——它不通，`formActorPlan` 的到期时刻只在玩家显式等待时才会到来。

能力合同已写：[vnext-fiction-time-contract-proposal.md](docs/agent/vnext-fiction-time-contract-proposal.md)。**待用户裁定，未实现。** 核心：`decision.durationMicros` 落在共享裁决上，角色行动必须 > 0、纯创作必须 = 0；即时推进、到期尾随（乙），记录 `crossedDeadlines` 作为日后是否改成 Activity（甲）的数据。执行的另一半（`FictionTimeAdvanced` 的发出、fold、Claim、Room 尾随清算）都已存在。

裁定之后再谈下面这条。

### 第 2 层：为什么 `consequences` 是空的

round78 把这条从推测变成了三次真实观察（75/77/78）。NPC 在公开旁白里承诺一个未来动作，而 `social` step 的 `consequences` 是空数组。

不缺任何前提条件：

- 槽位在 —— `socialConsequence` 的 promise 变体（[proposal-schema.ts:1018](app/_runtime/lib/kp/vnext/proposal-schema.ts:1018)），字段是 `content` / `condition` / `authorityRefs`。
- 指引在 —— social 的填写指引写着「NPC只能作出自己的承诺或债务，不替玩家承诺」，还写着「需要时间或额外成本的行动必须有独立可执行计划，不能只写在risk/summary中」。
- 依据不需要预先存在 —— promise 由这一束创建，不受 `actorPlanPremiseIsAvailable` 的 pre-state 限制。

而模型把承诺写进了 `goal` 和 `response.text`，机械槽位留空。**这是要改的地方**，也是唯一还没被真实证据排除的解释：指引把 promise 说成「允许」而不是「当 NPC 承诺未来行为时必须记录」。

改完之后才谈得上第二句的 `formActorPlan`：有了 active promise，它才有合法依据。

### 同批发现的另外两条（各自独立，别塞进同一个补丁）

- **等待不发布任何旁白。** 第二句 `passTime` 提交成功、时钟推进 60 秒、事件齐全，但 `narration: "notApplicable"`，公开记录止于玩家自己那句 say。等了一分钟的玩家什么也没看到。这是产品缺陷，与计划形成无关。
- **选中后丢弃不留痕。** 第二句选了 `["passTime","observe"]`，填写只出 `passTime`，玩家明写的「留意瓦罗和周围的动静」随 `observe` 一起消失。两次响应都已按 ordinal 持久化，delta = 选中集 ∖（已用 step kinds ∪ terminal kind）可以直接算出来，零额外调用、零新字段。

### 已完成、真实证据分账

| 改动 | 真实证据 |
| --- | --- |
| parser v39 引用槽准入 | round75 验到「不误伤」；未验到「挡得住」 |
| parser v40 未解析重发 | **无**，从未触发 |
| parser v41 边界前移 | round77 选择组合变了（一个样本，不是因果证明） |
| parser v41 一次补选 | **无**，四次 ordinal 2 请求都带着该工具，一次未用 |
| 传输接受双工具 | round77/78 都有真实证据：capture 记录两个工具确实到达模型 |
| gate 允许无计划继续 | round78 首次走到第二句，链条打通 |

另注意：terminal-only 选择（如 `abilityOperation`）没有第三次调用预算，一次语法失败仍即停批。供应商侧事实见 [round76 回执](docs/agent/vnext-round76-validation.md)：strict 声明了仍会返回非法 JSON，32 份草稿里 3 份如此。

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
