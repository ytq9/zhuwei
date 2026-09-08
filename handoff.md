# 交接 — vNext 完整 Goal 续作（2026-09-08）

写给下一个接手的我自己。基线是 **HEAD**（工作树干净）；下面每条状态都注明了来源是我本次核对的，还是抄自既有回执的。

这个文件永远是**当前**交接点。旧检查点仍可用 `git log -- handoff.md` 取回；按主题归档的历史交接在 `docs/agent/`。

---

## 1. 一句话状态

**2026-09-08 下午。HEAD `d374dca`，`cloudflare` 领先 `origin` 40 个提交，未推送。工作树干净。** 本节只写「现在在哪、下一步是什么」；细节在 §5、§7 与各回执。

今天做完并拿到真实证据的三件事：

1. **提案线改成三张平表**（`decision / steps / results`，parser v48→v51）。round91 是它第一次跑完整个场景：社交、一小时等待、observe 单独成根，每句 4 次调用、零修订、全部提交（[回执](docs/agent/vnext-round91-validation.md)）。
2. **承诺合同第 1、2、3 层在真实模型上连成了一条链**（round88，[回执](docs/agent/vnext-round88-validation.md)）：瓦罗承诺一小时内抄好副本 → `promise{due:1h, trace}` → 同根 `PromiseMade → NpcPlanFormed → ActivityStarted` → 玩家等 61 分钟跨过到期点 → 到期决策 execute → `NpcActionCommitted → CanonicalFactDeclared` → 旁白先出「账台上放着一份抄好的备案件副本」。n=1。
3. **传输层的一个事实**：DeepSeek 严格模式对 anyOf 分支内部的约束不校验（round84 多余属性、round85 多余属性、round86 枚举），且会返回空的 `{}`（round87、89）。能靠 schema 封死的槽位必须放在 anyOf 之外；封不死的靠解码器拒或一次重发。

三条设计裁定（时长档位、几小时尺度的承诺、承诺怎么还）全部实现并有真实证据，见 §7「真实证据分账」。

今天 8 批（round84–91）共约 ¥3.5，每批都在 20 次调用 / ¥5 之内，全部正常关停、replay 精确、源码起止相同。

## 2. 接手坐标

| 项 | 值 |
| --- | --- |
| 分支 | `cloudflare`，领先 `origin/cloudflare` 40 个提交，**未推送** |
| HEAD | `d374dca`（docs），运行时最后一次改动是 `da36c87`（parser v51） |
| 测试基线 | `81c3b1e`：node 全套与 vitest 全套的失败名单按名比对，今天每次提交都是 0 新失败（KP 组 + room 套件 793 例，759 过，34 个基线红） |
| parser 合同 | `kp-vnext2-proposal-parser-v51`（`proposal-provider.ts` 的 `VNEXT_PROPOSAL_BUNDLE_PARSER_CONTRACT`） |
| 工作目录 | `/Users/sanmu/Documents/zhuwei-cloudflare`；工作树是否干净以 `git status` 为准 |
| 另有 | `git stash list` 一条 `codex: preserve local changes before GitHub sync 2026-08-31`，不要动 |
| 批次包 | `/tmp/zhuwei-round<N>-npc-preparation/`（N=81…91），私有证据在各自 `evidence/`，不进仓库 |
| 未运行 | 全项目 `npm test`、构建、部署、远端 migration |

源码地图见 [repo-map.md](docs/agent/repo-map.md)。提案线的中心文件：`app/_runtime/lib/kp/vnext/proposal-filling-interface.ts`（三张表的 schema 与 codec）、`proposal-schema.ts`（域 schema、哨兵解码）、`proposal-provider.ts`（合同版本、修订/重发策略）、`proposal-bundle-lowering.ts`（lowering 与引用校验）。

## 3. 先接受这三件事，再动手

**一，commit 已放开，push 没有。** 完成一个切片就自己提交，用仓库的 conventional commit 风格，正文如实写清验证了什么、没验证什么、还有什么是红的；提交尾部 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。这不外推：`git push`、部署、远端 migration、创建远端资源、退役房间/归档仍然每次都要用户在当轮点头。任何时候都不要用 `git reset`、`git stash`、`git checkout --` 或切分支来清理工作树。

**二，本地绿不等于真实通过。** 本地 Node/Vitest 测试和 typecheck 只用于定位与防回归；只有 `docs/agent/vnext-round<N>-validation.md` 里、经正常注册 Cookie + 真实 DeepSeek 走完的批次，才算「真的过了」。注入响应、fixture、重采样都不算。失败不改判、不重跑洗成功、不把两类失败合并计数。**批次脚本不得改玩家句子**——三句话是用户批准的。

**三，执行边界（用户已明确，见 [AGENTS.md](AGENTS.md)）。**

- 有界真实 DeepSeek 批次：已授权，不必逐次再问；预算每批 20 次物理调用 / ¥5 / 20 分钟，每次 HTTP **7** 次调用（用户 2026-09-08 裁定「先确保功能正确，预算之后再考虑」；round88 证明等待跨到期正好要 7）、120 s；首个技术失败停止新行动；秘密脱敏；结果精确核对。
- 退役 0.4 以前的房间与归档：已授权。
- 部署、远端 migration、创建远端资源、Git push、里程碑冻结、完整回归：**每次都要用户在当轮明确授权**。「修好了」「完成了」不构成授权。
- 密钥只从 `.dev.vars` / Worker Secret 读，不写进仓库、不贴进聊天。

## 4. 当前 Goal 与走到哪

完整 vNext Goal 保持 active：按 [SPEC 0001](docs/specs/0001-llm-kp-responsibility-contract.md) 的 A–O 场景，用 vNext-2 替代现役 V3。分账与顺序在 [vnext-production-todo.md](docs/agent/vnext-production-todo.md)（V01–V13）。

站住了、且有真实证据的：

- 两轮填表接口：offer 选类型 → 填三张平表；服务器生成外壳、根依据并集、producer、类型化依赖（round85–91）。
- 服务端先证明修复计划、模型只确认的一次窄修订（round83 结尾多一个 `}`）；未解析重发（round88 未转义引号）。
- 虚构时间：普通行动按档位推进时钟（round80/81 起每批）；等待走模型旁白（round81 起）；到期优先结算与 Activity 中断（本地）。
- 承诺 → 计划 → 到期执行 → 痕迹入正史 → 旁白（round88，n=1）。
- observe 单独成根入正史（round91）。
- Claims → DeliveryPlan → 旁白 + 逐断言审核（每批）。

还没站住的：**连续多个意图的稳定性**（连过三句的只有 round81、round91 两批）、承诺链只有一例、多人 20+、完整叙述质量、生产采用门（V12/V13 未动，生产仍是 V3）。

## 5. 真实批次的准确结论（新到旧）

抄自各自回执，不要在没有新批次的情况下改写这些判断。round82 起场景固定为三句：「一小时内抄一份副本送到账台」/「等上一个多小时」/「到账台前看副本在不在」。

| 批次 | 场景 | 结果 | 停在哪 |
| --- | --- | --- | --- |
| [round91](docs/agent/vnext-round91-validation.md) | 同上，裸 none 泛化之后 | **三句零修订全部提交**：社交（瓦罗要名分，不承诺）、一小时等待、observe 单独成根（sensoryEvidence + characterInferences 入正史） | 三句 `committed`，12 次调用 ¥0.52，3 提交 |
| [round90](docs/agent/vnext-round90-validation.md) | 同上，空对象重发之后 | 完整草稿带承诺（due 1h + trace），但 `retryChange` 写成裸 `"none"`——裸 none 规则只覆盖可空引用字段 | `PROPOSAL_FORM_INVALID`（`retryChange` TYPE_MISMATCH），2 次调用 ¥0.15，0 提交 |
| [round89](docs/agent/vnext-round89-validation.md) | 同上，脚本上限修好 | 前两句零修订（`playerExpression` 枚举成员被真实使用；瓦罗当场抄、不承诺）；第三句 observe 填写又回空 `{}` | 前两句 `committed`；第三句 `PROPOSAL_FORM_INVALID`（`decision` FIELD_MISSING），10 次调用 ¥0.48，2 提交 |
| [round88](docs/agent/vnext-round88-validation.md) | 同上，同源第二样本 | **承诺 due 1h + trace → NpcPlanFormed → 等待跨到期 → 到期决策 execute → NpcActionCommitted → 痕迹入正史 → 旁白见痕迹**；未解析重发第一次真实触发 | 前两句 `committed`（5 + 7 次调用）；第三句没发（脚本把每 HTTP 上限写死成 5），12 次调用 ¥0.67，2 提交 |
| [round87](docs/agent/vnext-round87-validation.md) | 同上，responseBasis 平枚举之后 | 填写调用返回 `{}`（25 token）；beta 严格端点、strict true、根上 required 都在 | `PROPOSAL_FORM_INVALID`（`decision` FIELD_MISSING），2 次调用 ¥0.14，0 提交；同源再跑一批分辨 |
| [round86](docs/agent/vnext-round86-validation.md) | 同上，裁决 basisRefs 丢弃之后 | 首句三张表干净，但 `responseBasis` 引了社交判定规则档案（schema 枚举在 anyOf 内，严格模式没拦） | `PROPOSAL_REFERENCE_INVALID`（`social:foreign-npc-basis`，按设计不可修订），2 次调用 ¥0.15，0 提交 |
| [round85](docs/agent/vnext-round85-validation.md) | 同上，continuation 拆表之后 | 前两句提交并发布（各 4 次调用，零修订）；等待有旁白、时钟走了一个半小时；第三句 observe 的裁决上多了一行 `basisRefs`（与步骤相同） | 前两句 `committed`；第三句 `PROPOSAL_FORM_INVALID`（`filling:server-owned-field`），10 次调用 ¥0.50，2 提交 |
| [round84](docs/agent/vnext-round84-validation.md) | 同上，三张表 v48 之后 | JSON 合法、三张表都对；但步骤里又塞了旧写法 `result`（摘要不同），`retryChange` 是带空字段的 none 混合体 | `PROPOSAL_FORM_INVALID`（`filling:result-duplicate-row`），2 次调用 ¥0.16，0 提交 |
| [round83](docs/agent/vnext-round83-validation.md) | 同上，v47 之后 | 首句 5 次调用 committed/published。裁成魅力检定 DC 13，真实 d20 = 3，失败分支：瓦罗拒绝。成功分支里的承诺**填全了**（own ref、`due:"1h"`、trace）；结尾多一个 `}`，**服务器语法证据修法第一次真实触发**，一次 correct 调用确认 | `legalRefusal` 停止，后两句未发 |
| [round82](docs/agent/vnext-round82-validation.md) | **新场景**：一小时内抄副本 / 等一个多小时 / 看账台，承诺档位 v46 之后 | 首句填写是 1208 token 的双分支 check，结尾多一个 `]`，重发逐字节相同。同一草稿里模型**第一次就填了 `due:"1h"` 和 trace**，但 `authorityRefs: []` | `PROPOSAL_FORM_INVALID`（JSON 语法），3 次调用 ¥0.20，0 提交，后两句未发 |
| [round81](docs/agent/vnext-round81-validation.md) | 同上，等待旁白 + 档位 v44 之后 | **三句全部 committed/published**，12 次调用 ¥0.62。首句 `duration:5min`、时钟 0→300000000、裸 `"none"` 被接受；等待第一次有旁白（上下文正确、无编造）；第三句接续真实线程引用。瓦罗拒绝敲击，`consequences: []` 第六批 | 没停：`waited-without-confirmable-reminder` → noReminder 分支走完 |
| [round77](docs/agent/vnext-round77-validation.md) | 同上，传输放宽之后 | 首句 4 次调用完整 committed/published。双工具 surface 真的到达模型（传输修复有真实证据）；选择组合变为 `["social","passTime"]`（round75 是 `["social","commitNarrativeDetail"]`）。但 `passTime` 未被使用，`formActorPlan` 未选，计划/活动/承诺仍为 0 | `legalNoPlan` —— **但这个 gate 可能考错了东西，见 §7** |
| [round76](docs/agent/vnext-round76-validation.md) | 同上，在 v41 落地之后 | ordinal 2 **从未发出 HTTP**：本地传输断言要求恰好一个工具，而提案调用带了两个。日志里的 `providerStatus:422` 是本地常量，不是供应商响应 | `transportFailure`，我方缺陷，非模型失败 |
| [round75](docs/agent/vnext-round75-validation.md) | 同一 NPC 场景，在 v39 + v40 落地之后 | 首句 4 次调用完整 committed/published，无修订无重发，公开结果合法连贯（瓦罗答应半分钟后敲三下）。但 `npcPlans`/`activities` 为空、无 `NpcPlanFormed`/`ActivityStarted`，提案降级为 `worldInteraction` | `legalNoPlan` 停止（**非技术失败**），第二三句未发 |
| [round74](docs/agent/vnext-round74-validation.md) | 原 NPC 三句，在引用槽准入落地之后 | 第一句第 2 次调用返回的 tool arguments 不是合法 JSON：`decision.risk` 里有未转义 ASCII 双引号（模型把玩家用中文引号写的名字改成了 ASCII 引号）。无窄修订可用——草稿未解析则 bundle 不存在 | `PROPOSAL_FORM_INVALID` / `JSON_SYNTAX`，0 提交，stateVersion 保持 0，第二三句未发 |
| [round73](docs/agent/vnext-round73-validation.md) | 同上，在冻结输入回填修订落地之后 | 首句 4 次调用、无修订、完整通过（真骰 d8=5，满血所以 applied=0，一环 4→3）；第二句 `operation.abilityRef` 又选了上一句的 cure 而不是 healing-word，`target.kind=creatures` 的 `refs[0]` 填了自己的开场知识记录 | `PROPOSAL_REFERENCE_INVALID`，0 提交，第三句未发 |
| [round72](docs/agent/vnext-round72-validation.md) | 三句固定施法 | 首句 committed/published，资源 4→3 正确；第二句多填了与冻结 context 逐值相同的 `decision.intent` | `VALUE_INVALID` 在 `terminal.intent` 提前拒绝，未修订，第三句未发 |
| [round70](docs/agent/vnext-round70-validation.md) | 原 NPC 三句 | 两次调用，第二次 `response.basis` 选对了本人来源，但 `decision.steps[0].basisRefs[2]` 填了 `nonCitable` 的 npc-decision 目录包装 | `PROPOSAL_REFERENCE_INVALID`，0 提交，后两句未发 |

同一句请求，瓦罗给过五种回答（还价、直接拒绝、承诺、当场抄、要名分）——这是 KP 的世界选择，不是格式问题；`consequences: []` 不是缺陷。

## 6. 引用槽准入

2026-09-07 落地（[回执](docs/agent/vnext-reference-slot-admission-validation.md)），候选面以枚举下发。真实证据：round75 起「不误伤」；round86 证明枚举放在 anyOf 里**挡不住**，放到平的数组项上后 round88/89/91 都填在集合内。`worldInteraction.instrumentRefs` 仍是自由字符串；lowering 对跨 NPC 引用的精确匹配仍不可修订（按设计）。

## 7. 下一步

### 已完成（本地 + 真实）

1. 等待走模型旁白 —— [回执](docs/agent/vnext-wait-narration-validation.md)；round81 起每批的等待都有旁白，从未编造 NPC 行动。
2. 时长改档位 —— [合同 §10](docs/agent/vnext-fiction-time-contract-proposal.md)；线上 `decision.duration` 六档，战斗中为 `none`；每批 5min。
3. 几小时尺度的承诺（乙案）—— [合同](docs/agent/vnext-hours-scale-promise-contract-proposal.md) §7 实现、§8 真实证据（round88）。
4. 三张平表 —— [回执](docs/agent/vnext-three-table-wire-validation.md)，含 continuation 拆表与 anyOf 事实。

### 真实证据分账

| 改动 | 真实证据 |
| --- | --- |
| 承诺第 2/3 层（v46） | **round88** 全链 |
| 虚构时长合同（v42）与档位（v44） | round80 起每批 |
| 三张平表（v48）+ continuation 拆表 | round85 前两句、round88 前两句、round89 前两句、**round91 三句** |
| 裁决重复 `basisRefs` 丢弃（`373e377`） | **无**（round85 之后再没出现） |
| responseBasis 平枚举 + `playerExpression` 成员（v49） | round88/89/91 全在集合内、字符串成员被真实使用 |
| 空对象 `{}` 一次重发（v50） | **无**（round90/91 没再出现空对象） |
| 裸 `"none"` 泛化到 retryChange/trace（v51） | **无**（round91 写的是 `{kind:"none"}`） |
| 未解析重发（v40） | **round88** |
| 服务器语法证据的窄修订（v47） | **round83** |
| observe 单独成根 | **round91** |
| parser v41 一次补选 | **无** |

### 接下来按这个顺序

1. **两处遥测缺口**（代码活，各自一个小切片，本地测试即可，下一批顺带验）：ActorPlanTransport 的调用（到期计划决策）没有 invocation 遥测行，meter 只能按上限计成未知 usage（round88 ¥0.67 而不是约 ¥0.45）；等待跨到期的结算事件走时间推进路径，`room.authority.commit.completed` 对那一根的 `fictionTimeMicros` / `crossedDeadlineCount` 是 null，非零 `crossedDeadlineCount` 至今无真实证据。
2. **observe 与 passTime 同选后被丢弃，七次。** 选择阶段要 `["passTime","observe"]`，填写只能出 passTime 终结形（`steps: []`），observe 没有落点。这是合同问题，要用户裁定：等待时的观察该是等待旁白的一部分（现状，无机械）、还是等待完成后的一个 observe 根、还是 passTime 允许带 observe 步骤。别自己选。
3. **再跑同三句**：每批约 ¥0.5，每批都是承诺链、v50/v51/裁决 basisRefs 的一次机会；跑前把上一批的包克隆成新包（§9）。
4. **连续意图稳定性**仍是最大的未知：n=2。
5. push 要用户的话。

### 已知缺口（各自独立）

- 闹钟路径（玩家不在线时到期）完成的等待：audience 建好但当时无人旁白，靠 `narrationRecovery` 在下次 observe 发布——链路是旧的，等待这一用法没跑过。
- 旧线 vnext-1（`atomicRulesSteps`）没有时长字段。
- DeepSeek 严格模式：anyOf 分支内不校验、可能返回 `{}`（2/11）。凡靠 schema 封死的字段，约束要放在 anyOf 之外；裁决/步骤变体本身就是 anyOf，其内部只能靠解码器拒。

## 8. 已知缺口（各自建合同，别塞进同一个补丁）

- **真实窄修订**：语义级修订仍未触发过（round83 只是语法级）。
- **旁白文字精确度**：满血说「伤势」、笼统说「资源剩 3 次」（round73）。
- **`highRiskConfirmed`**：仍无消费者，继续失败关闭。
- **`openBlank`**：休眠中。
- **`reviseSemanticDefinition`**：类型存在，`lowerExecutableEntry` 返回 `BUNDLE_LOWERING_UNSUPPORTED`。
- **规模**：3 整卡容量、20+ 多人、完整战斗、发布数据恢复都没验证过。
- **生产采用门**：V12/V13 一步未动，生产仍是 V3。
- 基线上就红的测试（combat-mechanics-v2、context-discovery/closure/index 等 34 项）与本线无关，未看。

## 9. 怎么跑

```bash
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/vnext/state
npm run dev:vnext
```

可选 `ZHUWEI_VNEXT_LOCAL_CALL_LIMIT=7`（限单次 HTTP 的提案+修订+旁白调用；等待跨到期那一句正好要 7）与 `ZHUWEI_VNEXT_LOCAL_CAPTURE_URL`（镜像请求响应）。游戏与捕获服务占 4320 / 4321。

定向验证（AGENTS 的开发期门，默认最多三类直接证据，同一源码状态每项跑一次）：

```bash
npx tsx --test tests/<target>.test.mjs
npx vitest run tests/<target>.test.ts
npm run typecheck
```

引用这条线相关的目标测试：`tests/kp-vnext-reference-slot-admission.test.mjs`（本次新增的代表性矩阵）、`tests/kp-vnext-basis-reference-surface.test.mjs`、`tests/kp-vnext-observation-reference-surface.test.mjs`、`tests/kp-vnext-item-reference-surface.test.mjs`、`tests/kp-vnext-proposal-reference-slots.test.mjs`、`tests/kp-vnext-npc-decision-context.test.mjs`、`tests/kp-vnext-stage3-room.test.ts`。

判断某个失败是不是自己造成的，先取基线，别猜：

```bash
git worktree add --detach /tmp/zhuwei-baseline 81c3b1e && ln -s "$PWD/node_modules" /tmp/zhuwei-baseline/node_modules
```


### 跑一个真实批次

包在 `/tmp/zhuwei-round<N>-npc-preparation/`。新批次 = 复制上一批的包、把文件里的 `round<N-1>` 全部换成 `round<N>`、清空 `evidence/` `closeout/`、重置 `plan.json`（`executionProhibited: true`、`sourceFrozen: false`、`sourceUnderTest.commit` 钉住 HEAD）、跑三项离线预检：

```bash
npx tsx --test /tmp/zhuwei-round<N>-npc-preparation/scenario-preflight.test.mjs /tmp/zhuwei-round<N>-npc-preparation/setup-preflight.test.mjs
npx tsx /tmp/zhuwei-round<N>-npc-preparation/runner.mjs preflight
npx tsx /tmp/zhuwei-round<N>-npc-preparation/budget-preflight.mjs
```

释放前核三样：树干净且测试组相对 `81c3b1e` 0 新失败、价格页 sha256（`https://api-docs.deepseek.com/zh-cn/quick_start/pricing`，保存值 `899affbd…`）、4320/4321 无监听；把 `releaseReason`、`pricingApplicability`、`priorBatchClosure`、`sourceSchemaCheckEvidence` 写进 `plan.json`，再把 `executionProhibited` 置 false。然后：

```bash
python3 /tmp/zhuwei-round<N>-npc-preparation/freeze.py
python3 /tmp/zhuwei-round<N>-npc-preparation/services.py start capture
python3 /tmp/zhuwei-round<N>-npc-preparation/services.py start game
npx tsx /tmp/zhuwei-round<N>-npc-preparation/runner.mjs setup
npx tsx /tmp/zhuwei-round<N>-npc-preparation/runner.mjs action
```

每句之后从 `evidence/` 里读真实结果，手写 `evidence/gate<k>.json`（`afterAction`、`next`、`category`、`interpretation`、`reason`、`publicEvidence` 引用旁白原文、`observed.fictionTimeMicros` 是**这一句的增量**；gate1 还要 `planIds`/`promiseIds`），`runner.mjs decide evidence/gate<k>.json` 通过后再发下一句。gate2 的 `next` 是 `executed`（gate1 记的计划有 `NpcActionCommitted`）或 `pending`。收尾：

```bash
npx tsx /tmp/zhuwei-round<N>-npc-preparation/runner.mjs meter > /tmp/zhuwei-round<N>-npc-preparation/closeout/final-meter.json
python3 /tmp/zhuwei-round<N>-npc-preparation/services.py shutdown
python3 /tmp/zhuwei-round<N>-npc-preparation/extract.py
npx tsx /tmp/zhuwei-round<N>-npc-preparation/replay.mjs
python3 /tmp/zhuwei-round<N>-npc-preparation/source-end.py
```

然后写 `docs/agent/vnext-round<N>-validation.md` + `-live-evidence.json`（照 round91 的样子），更新本文 §5 表与 §7 分账，提交。`runner.mjs` 里 `perHttp` 的字面量是 7（round89 起）；`services.py` 给服务端的 `ZHUWEI_VNEXT_LOCAL_CALL_LIMIT` 也是 7。

## 10. 不要做的事

- 不要 stash、reset、`checkout --` 或还原工作树；提交可以，push 不行。
- 不要跑 `npm test`、全项目 lint、production build、远端 migration、`cf:deploy` 或 push —— 除非用户在当轮明确要求。
- 不要为了让某个真实批次过去而改测试、加 fallback、换模型、自动重试、放宽校验，或改玩家的句子。
- 不要把任何一批的失败重新分类或合并计数；不要把「模型的世界选择」（拒绝、还价）算作失败。
- 不要接受带信息的重复或歧义写法——今天接受的三种归一（带空字段的 none、与推导列表相同的裁决 basisRefs、裸 none）都是不携带信息的重复；有歧义的一律拒。
- 不要把 `/tmp` 里的私有证据（原稿、Cookie、冻结上下文正文）搬进仓库或聊天。
- 不要把这份交接或 repo map 当架构权威 —— 权威是 SPEC 0001、已裁定补充 SPEC 和源码。

## 11. 你结束时要更新什么

按 [AGENTS.md](AGENTS.md) 的执行日志要求：在 [refactor-log.md](docs/refactor-log.md) 追加一条紧凑记录（能力开发写目标/合同/矩阵/改动/直接消费者/实际命令与退出码/未覆盖范围；Bug 修复写症状/根因/改动/连带检查/证据/未覆盖）。真实批次另出 `vnext-round<N>-validation.md` + `-live-evidence.json`，能力开发另出 `vnext-<主题>-validation.md`（必要时加 `-integration.json`）。同步 [vnext-production-todo.md](docs/agent/vnext-production-todo.md) 的分账，源码位置变了就改 [repo-map.md](docs/agent/repo-map.md)，接手点变了就改这份交接。
