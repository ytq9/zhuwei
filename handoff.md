# 交接 — vNext 完整 Goal 续作（2026-09-07）

写给下一个接手的我自己。基线是**工作树**，不是 HEAD；下面每条状态都注明了来源是我本次核对的，还是抄自既有回执的。

这个文件永远是**当前**交接点。它替换了 `cee6834` 时期的旧检查点（“vNext 阶段三续作交接：Claims 安全闭环后”），那份内容仍可用 `git show HEAD:handoff.md` 取回。按主题归档的历史交接在 `docs/agent/`，例如 [危害与物品](docs/agent/handoff-hazards-and-items.md)（基线 `0a86fc0`）。

---

## 1. 一句话状态

vNext 已经能用正常注册 Cookie → `/api/game` 的真实链路，让真实 DeepSeek 完成一次施法的选择、填写、Rules/Room 提交和旁白发布（round73 首句）；**连续第二个意图仍然过不去**，最近三次真实批次都停在模型填错引用上。下一件事是把引用候选面收窄到与准入一致，然后释放已经备好的 round74。

## 2. 接手坐标

| 项 | 值 |
| --- | --- |
| 分支 | `cloudflare` |
| HEAD | `258caee404e0814405eb497653ee9f00d647b773`（`docs(agent): hand off the hazard work and the item slice after it`） |
| 工作目录 | `/Users/sanmu/Documents/zhuwei-cloudflare` |
| 工作树 | 137 项已跟踪修改（+14621 / −4294）+ 369 项未跟踪，**全部未提交** |
| 另有 | `git stash list` 一条 `codex: preserve local changes before GitHub sync 2026-08-31`，不要动 |
| 本次核对运行 | `npm run typecheck` → exit 0（整树可编译） |
| 未运行 | 任何代码测试、构建、模型探针、部署、远端 migration、push |

源码地图见 [repo-map.md](docs/agent/repo-map.md)（同日核对）。

## 3. 先接受这三件事，再动手

**一，工作树是产物本身。** vNext 绝大部分实现（72 个源码文件、88 个测试）从没进过 commit。不要 `git commit -a`、不要 `git reset`、不要 `git stash`、不要 `git checkout --` 任何文件来“清理环境”。用户在本轮之前从未授权提交；历次回执都明确记录“不 commit / 不 push / 不部署”。要看 HEAD 与工作树的差别，用 `git diff` 和 `git status`，不要用切换分支的方式。

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

round73 三个必须记住的细节：

1. **窄修订仍未被真实模型触发过。** 四条提案 journal 的 `repair_ticket_json` 全空。不能因为首句成功就说 echo 修复已被真实验证。
2. **遥测指错了地方。** 原始遥测只写 `REFERENCE_UNAVAILABLE / unrecognized`，没有指向模型实际填错的字段位置。
3. **旁白文字质量有缺口未修。** 满血状态说“伤势并未好转”，以及笼统的“可用施法资源剩余 3 次”（3 是一环池，二环还有 2）。gate 判为表达不精确，未认定机械矛盾。

## 6. 下一件事：引用槽的候选面要和准入一致

这是 round74 被 hold 的直接原因，也是 round70 与 round73 第二句的共同形状。

**已确认的事实：**[context/coverage.ts](app/_runtime/lib/kp/vnext/context/coverage.ts) 的 `citationClass` 把每个引用节点按行动者分成 `viewer` / `authority` / `nonCitable`，分类只读权威状态，不从闭包来路推断；[context/index.ts](app/_runtime/lib/kp/vnext/context/index.ts) 汇总，[required-context.ts](app/_runtime/lib/kp/vnext/required-context.ts) 冻结成 `nonCitableRefs` 等集合。别人（NPC）的 knowledge 是 `nonCitable`，自己的 knowledge 是 `viewer`。

**上一轮源码诊断的结论（抄自 [refactor-log.md](docs/refactor-log.md) 最后一批）：** 开放的 basis 字符串候选面比原授权 / read-bound 准入更宽，修复另记 —— 就是留给你的这件事。

**我读码后的推断（标为推断，未验证）：** 两次失败其实是同一件事的两半。round70 是**可引用性**这一维没在候选面里体现（模型看得到一个它不能引的 ref）；round73 是**槽类型**这一维没体现（那个知识记录确实在授权 knowledge 和 `viewerEvidenceRefs` 里、确实可引，但 `target.kind=creatures` 的槽只接受 entity）。也就是说校验器按“类 × 类型”两维拒绝，而模型看到的是一张扁平字符串候选表。落点大概率在 [proposal-reference-slots.ts](app/_runtime/lib/kp/vnext/proposal-reference-slots.ts)（当前只有 188 行、一个 `proposalProspectiveHandles`）与 [proposal-context.ts](app/_runtime/lib/kp/vnext/proposal-context.ts) 给模型的引用目录之间。**动手前先自己复核这个推断**，不要当成已定结论。

按 [AGENTS.md](AGENTS.md) 的能力开发闭环走：先写一句能力合同（哪个槽、接受哪些节点种类、哪些类、拒绝时给什么诊断），再建代表性矩阵（round70 的 nonCitable NPC 包装、round73 的自己知识记录填生物目标、一个合法正例、一个最高风险越权），在单一事实源实现，不要为这两个样例加名称判断。

改动会牵到 parser 合同版本（现为 `kp-vnext2-proposal-parser-v38`）与 `referenceSelection`（现为 `frozen-authorized-read-bound-basis-and-visible-subjects-v2`），进而牵动 workflow hash 和 Room 绑定的直接消费者 —— 这些必须一起改，见 repo map 的“vNext 当前冻结的标识”。

顺带把 round73 的第二个观察一起处理：遥测要能指向模型实际填错的字段位置，而不是只给 `REFERENCE_UNAVAILABLE / unrecognized`。

## 7. round74 已经备好，但被 hold

`/tmp/zhuwei-round74-npc-preparation/`（从 `/tmp/zhuwei-round70-npc-preparation` 迁移而来），`plan.json` 现在是：

- `status = "preparation-only-awaiting-source-integration"`，`executionProhibited = true`，`sourceFrozen = false`，`apiCalls = 0`
- `executionHoldReason`：*Root must finish the same-source basis reference candidate interface repair and directed validation, then complete current source/schema import checks and explicitly release. Round70 failed at `decision.steps[0].basisRefs[2]` by citing a nonCitable NPC wrapper; response.basis was locally valid. Do not force a plan or change the scenario.*
- 场景是 round70 的 NPC 三意图逐字复制（瓦罗、半分钟提醒、等待、追问），正常新房新注册，无 fixture
- 预算：3 意图 / 20 次物理调用 / ¥5 / 20 分钟 / 每次 HTTP 5 调用 120s；`priceRequiresReverification = true`
- `stateDirectory` 与主线共用 `.wrangler/vnext/state`，靠新注册 UUID、服务器创建的房间 ID 与精确快照做逻辑隔离

释放流程照 `RUNBOOK.md`：先跑 preflight（纯导入、0 网络），确认 `abilitySurfaceReady=true` 且 strict schema issues 为空，才由你显式把 `executionProhibited` 翻成 false，然后 `freeze.py` + `verify-source.py` 冻结源码 SHA。**freeze 只跑一次，不覆盖旧 session 与证据。**

⚠️ **这些编排在 `/tmp`，重启就没了。** 目录里有 `RUNBOOK.md` / `runner.mjs` / `capture.mjs` / `services.py` / `replay.mjs` / `scenario.mjs` / `freeze.py`，仓库里没有副本。接手时第一件事是确认它还在（`ls /tmp/zhuwei-round74-npc-preparation`）；如果没了，得照 round73 的 RUNBOOK 结构重建，公开回执与机器证据在 `docs/agent/` 里是全的。

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

引用这条线相关的目标测试：`tests/kp-vnext-proposal-reference-slots.test.mjs`、`tests/kp-vnext-basis-reference-surface.test.mjs`、`tests/kp-vnext-observation-reference-surface.test.mjs`、`tests/kp-vnext-item-reference-surface.test.mjs`、`tests/kp-vnext-npc-decision-context.test.mjs`、`tests/kp-vnext-stage3-room.test.ts`。

## 10. 不要做的事

- 不要提交、stash、reset 或还原工作树。
- 不要跑 `npm test`、全项目 lint、production build、远端 migration、`cf:deploy` 或 push —— 除非用户在当轮明确要求。
- 不要为了让某个真实批次过去而改测试、加 fallback、换模型、自动重试或放宽校验。
- 不要把 round70/72/73 的失败重新分类或合并计数。
- 不要把 `/tmp` 里的私有证据（原稿、Cookie、冻结上下文正文）搬进仓库或聊天。
- 不要把这份交接或 repo map 当架构权威 —— 权威是 SPEC 0001、已裁定补充 SPEC 和源码。

## 11. 你结束时要更新什么

按 [AGENTS.md](AGENTS.md) 的执行日志要求：在 [refactor-log.md](docs/refactor-log.md) 追加一条紧凑记录（能力开发写目标/合同/矩阵/改动/直接消费者/实际命令与退出码/未覆盖范围；Bug 修复写症状/根因/改动/连带检查/证据/未覆盖）。真实批次另出 `vnext-round<N>-validation.md` + `-live-evidence.json`，能力开发另出 `vnext-<主题>-validation.md`（必要时加 `-integration.json`）。同步 [vnext-production-todo.md](docs/agent/vnext-production-todo.md) 的分账，源码位置变了就改 [repo-map.md](docs/agent/repo-map.md)，接手点变了就改这份交接。
