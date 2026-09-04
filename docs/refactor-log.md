# 全量版本化重构执行日志

- Goal 状态：进行中；只有完成规格、实现、验证、必要迁移、正式部署与 GitHub 推送后才可结束。
- 执行分支：`cloudflare`
- 创建时间：2026-08-26 04:53:06 +08:00（2026-08-25T20:53:06Z）
- 冻结产品准则：`docs/specs/0001-llm-kp-responsibility-contract.md`
- SPEC 0001 基线 SHA-256：`b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`
- 日志约束：只写实际执行证据与脱敏因果链；不记录 Cookie、Token、Prompt、模组真相、未公开线索或私人叙述。

## 阶段 0：固定基线

### 目标

完整读取代理合同、领域词汇、ADR、冻结 SPEC 0001 与待裁定 SPEC 0002；记录分支、提交、工作树、远端基线与中断残留，并保留全部既有修改。

### 已读取输入

- `AGENTS.md`（97 行）
- `CONTEXT.md`（129 行）
- `docs/adr/0001-rules-own-world-facts.md` 至 `0005-separate-kp-fiction-and-mechanical-authority.md`
- `docs/specs/0001-llm-kp-responsibility-contract.md`（356 行）
- `docs/specs/0002-authoritative-combat-framework.md`（943 行；状态仍为“待审查，未批准”）

### Git 与工作树证据

- 当前分支：`cloudflare`
- 初始 HEAD：`9eb0a6c44b6f22afdc88e710886d1c59b9529313`
- 初始 `origin/cloudflare`：`4bc3c3801f451a83a2491757237d3126ab7987bd`
- 初始关系：本地分支较 `origin/cloudflare` ahead 1。
- 远端 `main`：`29eb06dc009c983ad61b2d862454503e67a7f40a`，与 Goal 预期一致。
- 中断残留检查：未发现正在运行的 Wrangler、Vitest、npm test、tsc 或 tsx 进程。
- package manifest、lockfile、`db/schema.ts`、`drizzle/` 与 `wrangler.jsonc` 在初始工作树中无修改；因此基线阶段不运行 `npm ci`，也不存在已观察到的待生成 schema 迁移。

初始已修改文件及差异行数（新增/删除）：

| 文件 | 差异 |
| --- | ---: |
| `AGENTS.md` | 7 / 3 |
| `CONTEXT.md` | 58 / 6 |
| `app/_runtime/components/character-wizard.tsx` | 8 / 0 |
| `app/_runtime/components/play-table.tsx` | 286 / 6 |
| `app/_runtime/lib/dnd/catalog.ts` | 4 / 4 |
| `app/_runtime/lib/dnd/compute.ts` | 37 / 2 |
| `app/_runtime/lib/room/coordinator.ts` | 7 / 0 |
| `app/_runtime/lib/room/durable-object.ts` | 11 / 1 |
| `app/_runtime/lib/room/server.ts` | 40 / 16 |
| `app/_runtime/lib/room/types.ts` | 8 / 1 |
| `app/_runtime/lib/rules/ai-adapter.ts` | 19 / 1 |
| `app/_runtime/lib/rules/engine.ts` | 810 / 58 |
| `app/_runtime/lib/rules/model.ts` | 90 / 2 |
| `app/_runtime/lib/table/server.ts` | 15 / 1 |
| `docs/adr/0001-rules-own-world-facts.md` | 8 / 6 |
| `tests/room-do.test.ts` | 46 / 0 |
| `tests/upstream-parity.test.mjs` | 5 / 3 |

初始未跟踪文件：

- `app/_runtime/lib/dnd/spell-card.ts`
- `app/_runtime/lib/rules/spell-catalog.ts`
- `app/_runtime/lib/rules/spell-model.ts`
- `app/_runtime/lib/rules/spell-rolls.ts`
- `docs/adr/0004-data-driven-spell-adjudication.md`
- `docs/adr/0005-separate-kp-fiction-and-mechanical-authority.md`
- `docs/specs/0001-llm-kp-responsibility-contract.md`
- `docs/specs/0002-authoritative-combat-framework.md`
- `tests/spells.test.mjs`

这些文件全部视为既有用户工作并保留。未执行 `reset`、`clean`、强制 checkout、强推或删除操作。

### 命令账本

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-25T20:53Z | `git status --short --branch` | 0 | `cloudflare...origin/cloudflare [ahead 1]`，17 个修改、9 个未跟踪 |
| 2026-08-25T20:53Z | `git rev-parse HEAD` | 0 | `9eb0a6c44b6f22afdc88e710886d1c59b9529313` |
| 2026-08-25T20:53Z | `git ls-remote origin refs/heads/main` | 0 | `29eb06dc009c983ad61b2d862454503e67a7f40a` |
| 2026-08-25T20:53Z | `git ls-remote origin refs/heads/cloudflare` | 0 | `4bc3c3801f451a83a2491757237d3126ab7987bd` |
| 2026-08-25T20:53Z | `shasum -a 256 docs/specs/0001-llm-kp-responsibility-contract.md` | 0 | `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be` |
| 2026-08-25T20:53Z | 中断进程只读检查 | 0 | 无遗留工作进程 |

### 阶段结论与剩余条件

事实基线已经固定；阶段 0 仍需在最终交付审计中再次校验 SPEC 0001 内容哈希与远端 `main` SHA。下一阶段必须先完成替代规格、Profile、ADR、十板块/A–O 追踪矩阵和 SPEC 0002 B01–B53 逐项处置，交叉审查后才能把新产品行为作为实施依据。

## 阶段 1：规格收口

- 状态：已完成规格级收口；实现与运行证据不在本阶段计入。

### 已裁定规格与记录

- `docs/specs/0003-authoritative-action-transaction.md`：两个深 Module、Room Authority、随机、幂等、作用域、恢复、回放和更正。
- `0004`–`0011`：非战斗机械、事实/知识、模组/NPC、多人/时间、长团、失败/收束、观察者单槽投递及可靠性/评测。
- `0012-authoritative-combat-mechanics.md`：仅保留 Encounter、空间、先攻、回合、反应、能力、伤害和死亡等 Rules 内部机械。
- `0013-versioned-runtime-profiles.md`：完整 Profile manifest、Ability compiler、Geometry、Trigger 与 Fiction/Combat Time 的确定算法和 48 条 conformance 向量。
- `0002-disposition-matrix.md`：原未批准 SPEC 0002 的章节和 B01–B53 已逐条标为保留、修订、拆往通用规格或否决，并给出替代规格及依据。
- 原 `0002-authoritative-combat-framework.md` 只修改头部状态为“已被替代，未曾批准”，正文作为迁移证据原样保留；没有伪称用户逐条批准。
- `decision-register.md`：记录本轮自主裁定的来源、候选、选择、玩家行为、秘密/权限、迁移和验收。
- `traceability-matrix.md`：P1–P10 与 SPEC 0001 A–O 均已映射到用户行为、权威状态/事件、Viewer 投影、责任 Interface 和待实现测试。
- `README.md`：索引 0001–0013，明确冻结、替代、授权状态和五项审查证据口径。
- `cross-spec-review.md`：对 0003–0013 完成 55 项五维审查，记录 12 个组合问题、正式消解、护栏、测试映射和 10 条跨规格验收切片。
- ADR-0003/0004 已按新协议细化；新增 ADR-0006–0010，固定深模块、单槽投递、版本隔离、长团继任和可审计恢复。
- `CONTEXT.md` 在保留既有内容后追加 Principal、Root Action、Pending Input、Scope Proof、Receipt、Read Model、Audience、Delivery、Campaign/Chapter/Tenure/Successor、Encounter、Ability、Active Branch 与 Correction 领域词汇。

### 实现差距因果链

只读审计确认第一处违反不变量的位置及直接证据如下；这些是后续红测试和重构的目标，不是已修复声明：

1. 自然语言在 `rules/ai-adapter.ts` 被限定为白名单命令翻译，`table/server.ts` 再作事后叙述；根因是没有 Room Action Module 的 KP 提案/修订事务。
2. AI Adapter、页面服务编排和旧命令接收/产生骰面；根因是随机请求没有在参数冻结后由 Room DO 统一满足。
3. 服务端自动选 NPC 首个攻击、首个目标并自动结束回合；根因是 NPC 有限知识提案和控制者待决没有进入统一事务。
4. D1 `game_states`、`messages` 和 Room DO 同时保存活跃玩法或旁白；根因是新规则版本没有与 Legacy 路径、单槽 Delivery 和唯一 DO 状态权威隔离。
5. Rules 包公开 `applyEvents/createWorldState/predicateMatches/rollDie`，外部协调器复制作用域算法；根因是深 Module 边界尚未落实。
6. 单一 `expectedVersion`、无 HTTP 幂等 ID、无归档重建/更正和未知版本回退；根因是根行动、scope proof、Profile manifest 与事件完整性尚未成为权威数据。

### 阶段命令账本

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-25T21:31Z | `git diff --check -- docs/specs docs/adr docs/refactor-log.md CONTEXT.md` | 0 | 截至该源码状态无空白错误 |
| 2026-08-25T21:31Z | `shasum -a 256 docs/specs/0001-llm-kp-responsibility-contract.md` | 0 | 仍为基线 `b420123d…23be` |

### 剩余条件

规格级交叉审查已经完成且未发现需要修改 SPEC 0001 的冲突。五处文档/测试映射差异已登记，其中追踪矩阵的战斗/可靠性旧占位文字已回填；其余在实际 runner 与 manifest 落定时同步。随后以新责任 Interface 的红测试进入阶段 2。规格文本本身不计实现或测试完成证据。

## 阶段 2：验收先行

- 状态：进行中

### 首批 RED 证据

| 时间（UTC） | 命令 | 退出码 | 首个失败与因果 |
| --- | --- | ---: | --- |
| 2026-08-25T21:34Z | `npx tsx --test tests/authoritative-action.test.mjs` | 1（预期 RED） | `ERR_MODULE_NOT_FOUND`：目标 `app/_runtime/lib/room/action.ts` 尚不存在；测试尚未进入断言，证明旧代码没有统一 Room Action 责任 seam |
| 2026-08-25T21:37Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs` | 1（预期 RED；7/7 失败） | `replay` 仍是裸 `applyEvents`，`step` 仍是旧 WorldDefinition/Command，`project` 仍把 Viewer 当旧 viewerId；没有 manifest/hash/Legacy fail-closed、Ability 2014 护栏或版本化 Fiction Time Read Model |
| 2026-08-25T21:47Z | `npm run test:worker -- --reporter=verbose` | 1（预期 RED；17 项） | 既有 Room DO 测试 9/9 通过，新权威事务测试 8/8 失败；首因是 RPC receiver 尚未实现 `initializeAuthoritative`，因此可信控制、幂等、DO 随机、作用域并发、重启恢复和更正均没有被旧实现伪装为成功 |
| 2026-08-25T21:52Z | `npx tsx --test tests/observer-projection-v2.test.mjs` | 1（预期 RED；5/5 失败） | 目标 `RoomGenesis/acquireKnowledge` 被旧 `step` 解释为 legacy 参数并以 `ruleset_mismatch` 拒绝；尚无知识、分享、NPC 有限知识、继任边界或统一旁路投影协议 |
| 2026-08-25T22:10Z | `npx tsx --test tests/observer-projection-v2.test.mjs` | 1（预期 RED；5/5 失败） | 修正测试自身的伪 Profile/hash 与非规范 genesis 后，测试不再直接构造 WorldState：由 `step(...initializeAuthoritativeWorld)` 请求 Rules 自选当前 manifest 并签发 genesis；当前首因是该初始化协议尚未实现，返回 `invalidRuntimeManifest` 而非 `initialized` |
| 2026-08-25T22:18Z | `npm run test:worker -- --reporter=verbose` | 1（预期 RED；21 项） | 扩展 runner 到全部 Worker TS 测试；既有 Legacy Room DO 9/9 仍通过，新权威事务 8/8 与观察者单槽 4/4 失败，统一首因仍是 `initializeAuthoritative` RPC 尚未实现。新增切片锁定提交时 Audience、逐观察者帧、刷新/重连、ACK 后正文不可取、覆盖/迟到响应和七类旁路共用 Read Model |
| 2026-08-25T22:20Z | `npx tsx --test tests/world-campaign-v2.test.mjs` | 1（预期 RED；4/4 失败） | 四条仅经 genesis → `step` events → `replay` → `project` 的长链覆盖五类可行性、随机冻结、非战斗/Activity/危险、事实知识/NPC势力、失败收束与长团继任；首缺口分别是 `resolveFreeAction`、`resolveContest`、`registerDynamicDefinition`、`grantMilestone` 尚无 v2 adapter |
| 2026-08-25T22:24Z | `npx tsx --test tests/combat-mechanics-v2.test.mjs` | 1（预期 RED；4/4 失败） | 四条 `step/project/replay` 战斗链以可回放 genesis 起步，锁定动态 Encounter/敌人、2014先攻与法术限制、2D Geometry、动作/资源/伤害死亡、玩家/NPC待决与触发顺序、六秒轮和非战斗共用 damage pipeline；统一首因是 `startEncounter` 尚无 v2 adapter |
| 2026-08-25T22:28Z | `npx vitest run tests/archive-correction-v2.test.ts` | 1（预期 RED；5/5 失败） | 归档/更正测试固定脱敏 signed genesis+连续事件+最小 Receipt refs、空 DO 灾难重建、四类完整性篡改、opaque capability、更正幂等、前向补偿及因果分支；统一首因是 `initializeAuthoritative` RPC 尚未实现 |
| 2026-08-25T22:20Z | `npx tsx --test tests/structured-telemetry-v2.test.mjs`（实现前） | 1（预期 RED；4/4 失败） | `ERR_MODULE_NOT_FOUND`：尚无固定白名单的 `room/telemetry.ts`；旧运行路径无法证明 Cookie、Prompt、意图、私人投影、语音/转写和未知字段不会进入日志 |
| 2026-08-25T23:21Z | `npx tsx --test tests/module-npc-v2.test.mjs`（实现前） | 1（预期 RED） | `ERR_MODULE_NOT_FOUND`：新房尚无版本化 Module Bible/Legacy Anchor seam，无法固定 `moduleVersion + contentHash` 或为 KP/NPC 分离故事真相与有限知识 |
| 2026-08-25T23:28Z | `npx vitest run tests/multiplayer-room-v2.test.ts --reporter=verbose` | 1（预期 RED；3/3 失败） | 三条 Seat/Control、全员同意原子整队移动/个人原子离队、分地点 FictionTimeline/CausalFrontier/Spotlight 责任链均在初始化后首个断言失败：Room Authority 尚无 service-only `roomAdministration` capability；未回退到 D1 `where/clocks/squad` |
| 2026-08-25T23:32Z | `npx vitest run tests/randomness-recovery-v2.test.ts --reporter=verbose` | 1（预期 RED；4/4 失败） | 四个崩溃点测试均未触发预期 checkpoint，现有 commit 直接一次性返回；证明尚无“请求先持久化 → 候选持久化 → 结果原子提交 → 响应丢失幂等恢复”的可注入恢复边界。测试只注入崩溃，不注入 WorldState、骰面、事件或窗口 |
| 2026-08-25T23:41Z | `npx vitest run tests/authoritative-opening-v2.test.ts --reporter=verbose` | 1（预期 RED；1/1 失败） | authoritative 初始化后 Alice 的合法 observation 没有当前 Delivery frame；新房启动静默丢失上游开场旁白。验收要求从已钉住 Module Profile 的 `publicOpening` 向开场地点在场角色分别建立单槽、可重连、可 ACK 且无历史的投递，不回退到 D1 `messages` |
| 2026-08-25T23:45Z | `npx vitest run tests/compound-action-v2.test.ts --reporter=verbose` | 1（预期 RED；1/1 失败） | 真实 production KP draft（动态危险 + NPC 有限知识计划 + 场景问题 + 非战斗检定）被 Room Authority 拒绝；现有 adapter 只接受测试用紧凑提案并忽略生产 envelope 的复合语义，尚未满足同一 Root Action 同时提交叙事事实、NPC 行动和机械结果 |

该测试只在 `handleRoomAction(context, input)` 外层 Interface 观察 Room Authority 与 KP Adapter 调用，不直接修改 WorldState、骰面、事件或待决窗口。覆盖可信 Principal、提交后叙述、澄清、KP 修订上限、模型失败和六种 Outcome；生产实现完成前不计通过证据。

### 首个 RED → GREEN 切片

| 时间（UTC） | 命令 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-25T21:40Z | `npx tsx --test tests/authoritative-action.test.mjs` | 0 | 7/7；Room Action 严格执行 prepare → KP propose → commit → 提交后 narrate → publish → observe，并覆盖澄清、两次修订上限、模型失败与六种 Outcome |
| 2026-08-25T21:40Z | `npm run typecheck` | 0 | 新增 `app/_runtime/lib/room/action.ts` 与当前源码类型兼容 |
| 2026-08-25T21:50Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs` | 0 | 7/7；Rules 包运行时入口精确为 `step/project/replay`，当前 Profile id/hash 被钉死，缺失、错 hash、历史版本和 Legacy 均 fail closed，2014/2024 护栏与版本化时间投影生效 |
| 2026-08-25T21:50Z | `npm run typecheck` | 0 | 版本化 Profile 注册表、canonical bytes/hash 与 v2 runtime 类型通过；该结果只覆盖空 archive/read model 和结构化拒绝，非空事件 fold 与真实 Ability compiler 仍是显式未实现 |
| 2026-08-25T22:08Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs` | 0 | 10/10；按交叉审查 XR-06 补齐 presentation/projection/delivery 三个强制策略 Profile，逐项缺失、错位、错 hash 均 fail closed；完整 extensions 闭包为 combat、damage/death 与三项观察者策略 |
| 2026-08-25T22:08Z | `npm run typecheck` | 0 | 12 份 canonical Profile 文档与 golden hash 注册表一致；运行 manifest hash 更新为 `sha256:311717…ff5f1`，所有 Profile payload 均记录其决定性语义 |
| 2026-08-25T22:20Z | `npx tsx --test tests/structured-telemetry-v2.test.mjs` | 0 | 4/4；`buildRoomTelemetryEvent` 只构造固定非内容字段，未知/敏感字段无法影响输出或关联哈希，六类故障映射一致，延迟/免费成本/归档滞后仅输出桶 |
| 2026-08-25T22:20Z | `npm run typecheck`、遥测目标 `git diff --check` | 0 | 新增 Worker-safe 纯 telemetry serializer 类型通过且无空白错误；尚未宣称所有生产 `console.*` 调用已接入该 seam |
| 2026-08-25T22:20Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs tests/observer-projection-v2.test.mjs` | 0 | 15/15；Rules 自选 canonical genesis，非空 typed EventEnvelope 可连续 fold/replay 并按哈希/Profile/分支/因果/虚构时间 fail closed；知识、世界内分享、NPC 有限知识、控制转移与继任均只经统一 projector |
| 2026-08-25T22:20Z | `npm run module:check`、`npm run typecheck`、全局 `git diff --check` | 0 | 当前 Rules 事件/回放/观察者核心与现有模组类型通过；公开 runtime 仍只有 `step / project / replay`。世界/长团其余动作、战斗、DO 自动满足随机和归档/更正仍是后续切片 |
| 2026-08-25T22:20Z | `npm run typecheck`、DB adapter 目标 `git diff --check` | 0 | 移除 `db/index.ts` 的模块级初始化 Promise 与 `lib/db.ts` 的共享可变 SQL cache；D1 schema 只由版本化 `drizzle/` migration 管理，缺迁移会在真实查询处失败，不再由请求路径静默补 schema |
| 2026-08-25T22:20Z | `npx tsx --test tests/interaction-contract.test.mjs` | 0 | 8/8；在保留已绑定 legacy DeepSeek 路径的同时，模型目录新增 authoritative 默认 `@cf/zai-org/glm-4.7-flash`；完整 typecheck 待并行 Rules 切片恢复稳定源码后重跑 |
| 2026-08-25T22:20Z | `node cloudflare/verify-deploy-config.mjs`、目标 `git diff --check` | 0 | 部署护栏现在同时固定现有 `zhuwei`、`worker/index.ts`、AI、唯一 `ROOMS` SQLite DO、唯一既有 `DB/zhuwei-dev/f5a448fd…`，并拒绝新增 KV/R2/Queue/Workflow/Vectorize 配置 |
| 2026-08-25T22:20Z | `npm run db:generate` | 0 | 由 `db/schema.ts` 唯一生成新增 `drizzle/0006_nice_iron_lad.sql`；逐行检查确认只新增 v2 genesis/event/projection-audit 归档表及 `rooms.runtime_epoch_id/genesis_hash` 两个目录引用，既有 migration/legacy archive 未改 |
| 2026-08-25T22:20Z | 全部 `drizzle/*.sql` → SQLite `:memory:` + `PRAGMA integrity_check` | 0 | 0000–0006 可按序应用，`authoritative_room_event_archive` 的复合 epoch/eventSeq 主键与三个索引实际建立，完整性结果 `ok`；尚未将 0006 应用于远端 D1 |
| 2026-08-25T22:20Z | `npx tsx --test tests/world-campaign-v2.test.mjs tests/runtime-profiles-v2.test.mjs tests/observer-projection-v2.test.mjs` | 0 | 19/19；五类裁决、冻结随机、非战斗资源/物品/Activity/伤害死亡、事实知识/NPC势力、失败与收束、成长/章节/退休继任全部由 typed event → fold/replay → observer project 完成；未直改 WorldState 或注入骰面 |
| 2026-08-25T22:20Z | `npm run module:check` | 0 | 世界/长团切片后唯一模组检查通过，Rules runtime 实际导出仍仅 `step / project / replay`；combat 仍在下一切片 |
| 2026-08-25T22:20Z | `npx vitest run tests/room-authority-v2.test.ts tests/observer-delivery-v2.test.ts tests/room-do.test.ts`（并行切片回执） | 0 | v2 authority/delivery 12/12 + legacy 9/9，共 21/21；可信控制、payload 幂等、作用域并发、DO 随机复用、Pending 恢复、Audience 冻结、单槽覆盖/ACK/重连与七旁路同 projector 已落 SQLite DO |
| 2026-08-25T22:20Z | `npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/authoritative-action.test.mjs`（并行切片回执） | 0 | 4/4 + 7/7；默认 GLM tool calling、不假设 JSON mode、五类开放裁决/诊断修订、逐观察者提交后叙述及超时/配额/无效输出脱敏均通过；尚未接入 table/API |
| 2026-08-25T23:21Z | `npx tsx --test tests/module-npc-v2.test.mjs` | 0 | 4/4；`black-oak-will@legacy-anchor-v1` 内容哈希固定为 `sha256:198ad1…37f9`，旧 DSL 只转成 Story Anchor/open blanks，核心真相只进 KP 投影，NPC fixture 只含各自有限知识，未知版本 fail closed |
| 2026-08-25T23:21Z | Module Bible 目标 `git diff --check` | 0 | 新 seam、验收与本日志无空白错误；尚未宣称 DO genesis/KP prepare 已接入该 Module Profile |

该切片只证明外层编排责任；Room DO 持久化、Rules 机械、权威随机、专属投影和 API 接线仍待后续测试，不能据此把 A–O 标为完成。

## 阶段 3：从内向外重构

- 状态：进行中；Rules 世界/长团/战斗主链、strict production ActionPlan、Room Action、Room DO 权威链、KP Adapter、观察者单槽、随机崩溃恢复、显式 retry、归档/灾难重建与两类更正已经实现并有局部回执；最终冻结全量门、真实 Workers AI、远端迁移/部署/冒烟/推送仍未完成。

### 已实现切片

- Rules 包公共运行时保持精确为 `step / project / replay`；canonical Profile 注册表、签名 genesis、typed EventEnvelope、fold/replay、观察者 projector 均按未知版本/错 hash fail closed，并拒绝 D&D 2024/5.5e 语义。
- 世界/非战斗/长团机械已经覆盖五类可行性、检定/对抗/豁免、资源/物品、Activity、危险、事实/知识/NPC/势力、失败/收束、成长/章节、退休/死亡与继任边界。
- 战斗机械已经覆盖动态遭遇、二维空间与掩护、2014 先攻/动作/反应/施法限制、资源、攻击/豁免/集中、统一伤害与死亡、显式玩家/NPC 决策、六秒轮、遭遇结论与故事结论分离；非战斗危险复用同一伤害管线。
- Room Action 已实现 prepare → KP proposal/diagnosis revision → commit → committed-state narration → per-audience delivery；Room DO 已实现可信控制、幂等、作用域并发、待决恢复、DO 随机、单槽 Delivery/ACK/重连，以及可重建脱敏归档。
- KP Adapter 固定 authoritative GLM tool-calling 模型，输出五类开放裁决和机械提案；LLM 调用位于 DO 事务外，未知/敏感内容不能进入结构化 telemetry。
- D1 运行时建表副作用已移除；唯一新增 migration `0006_nice_iron_lad.sql` 只承载 v2 可重建归档及房间目录引用，尚未应用到远端 D1。

### 阶段 3 命令账本

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-25T23:10Z | `npx tsx --test tests/combat-mechanics-v2.test.mjs`（并行切片回执） | 0 | 4/4；动态 Encounter、空间/先攻/动作/反应/施法/伤害死亡、显式待决、六秒轮和非战斗共用 damage pipeline 全部经 `step/project/replay` |
| 2026-08-25T23:10Z | runtime + observer + world + combat 组合回归（并行切片回执） | 0 | 23/23；战斗新增事件与既有 Profile、知识投影、世界/长团回放兼容 |
| 2026-08-25T23:10Z | `npm run module:check`、`npm run typecheck`、`npm run lint`、`git diff --check`（并行切片回执） | 0 | Rules 战斗切片后的公共入口、类型、静态规则和空白检查均通过；这不是生产源码冻结后的最终全量门 |
| 2026-08-25T23:37Z | `npx vitest run tests/kp-multiturn-eval.test.ts`（并行切片回执） | 0 | 1/1 场景内 31/31 连续玩家意图或待决回答通过；覆盖同 Root Action 回答、玩家/KP/NPC 专属投影、动态危险与双哈希随机、幂等/模型失败、有意义失败、世界内秘密分享、NPC 有限知识、聚光灯、结局/尾声和安全 Read Model |
| 2026-08-25T23:37Z | Room authority/delivery/legacy、archive 主链、Module Bible/telemetry 与 production KP adapter 组合回归（并行切片回执） | 0 | 分别 21/21、3/3、8/8、4/4；DO genesis 已钉住模组 profile/hash，全部故事地点与 NPC 有限知识 fixture 可回放，归档失败只产生脱敏 telemetry；更正测试不在本行通过范围 |
| 2026-08-25T23:37Z | `node --import tsx --test tests/authoritative-kp-adapter.test.mjs`（keyed `npcViewers` 修改前） | 1（预期 RED；2/4 失败） | Room/KP 生产投影使用按 `npcId` 索引的有限知识 map，而 helper 仅接受旧数组，合法 NPC 提案被错误标为 `modelPermanent` |
| 2026-08-25T23:37Z | `node --import tsx --test tests/authoritative-kp-adapter.test.mjs` | 0 | 4/4；helper 以 keyed map 精确选择 NPC 有限知识投影，并仅为迁移兼容保留旧数组读取；NPC 仍不能引用 KP 私密事实 |
| 2026-08-25T23:45Z | `node --import tsx --test tests/authoritative-table-v2.test.mjs tests/interaction-contract.test.mjs`（并行切片回执） | 0 | 9/9 + 8/8；11 个 v2 按钮均在 Legacy 机械/骰面前返回 Room Action 语义意图，`resolveRoll` 拒绝客户端骰面，模型固定，客户端以 payload 指纹稳定复用 submissionId；当前 Delivery ACK 等语音请求取得音频或 5 秒有界超时，不保存历史 |
| 2026-08-25T23:45Z | table/client/UI 切片 `git diff --check`（并行切片回执） | 0 | 无空白错误；同一时点全局 typecheck 仅被并行 `multiplayer-actions.ts` 的 TS18046 阻塞，本行不把它记为全局通过 |
| 2026-08-25T23:45Z | `npx vitest run tests/randomness-recovery-v2.test.ts --reporter=verbose`（并行切片回执） | 0 | 4/4；请求/冻结哈希 journal、独立 DO 候选 face 与最终 Rules events/state/Receipt/Delivery 三段持久化覆盖四个崩溃点，evict/retry 复用同一骰面且归档各只有一个请求、结算和 Receipt ref |
| 2026-08-25T23:45Z | randomness 后 Room authority/delivery/legacy、archive 主链组合回归（并行切片回执） | 0 | 21/21 + 3/3；相关组合 28/28，archive correction 两项按既有 RED 未计通过。`module:check` 与 `git diff --check` 为 0；全局 typecheck 只被并行 multiplayer Rules 收窄错误阻断 |
| 2026-08-25T23:45Z | 随机恢复/20+ 评测口径文档目标 `git diff --check` | 0 | `SPEC 0003/0011`、DEC-005 与 cross-spec 索引同步实际三段 DO SQLite journal：请求、候选、最终事件；candidate 不进 D1/投影/日志。连续评测最低门与用户 Goal 统一为 20+，canonical 文件修正为实际 `tests/kp-multiturn-eval.test.ts`；SPEC 0001 未改 |
| 2026-08-26T00:19Z | `npx vitest run tests/archive-correction-v2.test.ts -t "forward compensation"`（并行切片回执） | 0 | 1/1；只有 server 持有的 opaque capability 可调用更正；`correctionId` 与载荷幂等，Rules 公开 `step/replay` 生成补偿，旧 Receipt 标记 superseded，旧 Delivery plan/slot 只留无正文 tombstone，事件、状态、新 Receipt、擦除与幂等结果在同一 DO SQLite 事务提交 |
| 2026-08-26T00:19Z | `npx vitest run tests/archive-correction-v2.test.ts`（并行切片回执） | 1（预期 RED；4/5 通过） | 归档、灾难重建、篡改拒绝与前向更正均绿；唯一因果分支场景在更正调用前因没有正式 `DiceRolled(face/faces)` 审计事件而失败。未伪造后果或让 DO 越权选择 causal strategy，等待 compound Rules 提交真实知识/位置/资源影响 |
| 2026-08-26T00:24Z | `npm run module:check`；`git diff --check -- scripts/check-modules.mjs` | 0 | 门禁由仅验证模组扩展为同时检查 Rules 公开值严格只有 `step/project/replay`、外层不得导入 v2 私有 runtime、authoritative KP/Room/Table 外层不得掷骰或接回旧活跃状态 SQL；当前 1 个模组与全部深模块边界通过 |
| 2026-08-26T00:31Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs tests/observer-projection-v2.test.mjs tests/world-campaign-v2.test.mjs tests/combat-mechanics-v2.test.mjs tests/rules-pending-v2.test.mjs tests/rules-multiplayer-v2.test.mjs`（并行切片回执） | 0 | 32/32；service-only Seat/Control/host、Pending suspend/reassign、全员同意 PartyMove、个人移动/休整原子离队、分地点 FictionTimeline/CausalFrontier、世界媒介传播、显式会合和 Spotlight≤3 均经 Rules `step→replay→project`；NPC 投影不含 roomMembers/party/spotlight |
| 2026-08-26T00:31Z | 多人 Rules 切片 `npm run typecheck`、`npm run module:check`、`git diff --check`（并行切片回执） | 0 | 多人/时间新增 typed event、fold、validation 与 projector 兼容现有世界/战斗/更正；未把 DO 或 D1 当作 Rules 第二路径 |
| 2026-08-26T00:34Z | `npx vitest run tests/authoritative-opening-v2.test.ts --reporter=verbose`（并行切片回执） | 0 | 1/1；初始化与逐 Viewer opening 单槽/watermark 同一 DO SQLite 事务，正文来自 pinned Module `publicOpening`，只给开场现场受控角色；不生成世界事件、Receipt 历史、D1 message 或时间推进，重连同帧且 ACK 后不可回看 |
| 2026-08-26T00:34Z | opening 后 observer projection/randomness/Room authority/Legacy + typecheck/module/diff 组合回归（并行切片回执） | 0 | 分别 5/5、4/4、8/8、9/9；灾难归档本身不含 Delivery，因此不会恢复已失效开场正文 |
| 2026-08-26T00:35Z | `node --import tsx --test tests/authoritative-kp-adapter.test.mjs`（typed ActionPlan 实现前/后，并行切片回执） | 1 → 0 | RED 4/5 首因是未知 operation 未拒绝；GREEN 5/5。production/NPC 共用 `authoritative-kp-action-plan-v1` 17 项 operation，机械/cost/effect 额外键、未知 operation、dice/faces 及动态定义中的 authority/state/event/profile 注入均 fail closed；开放 JSON 只留动态世界定义 |
| 2026-08-26T00:35Z | KP ActionPlan 切片 `npm run typecheck`、`npm run module:check`、`git diff --check`（并行切片回执） | 0 | 提案 schema 固定为 `authoritative-kp-proposal-v2`；本行只证明模型边界验证，Rules compound/DO 接入仍单独验收 |
| 2026-08-26T00:39Z | `npx vitest run tests/room-retry-v2.test.ts --reporter=verbose` | 1（预期 RED；0/1） | 显式 retry 在既有 submission payload-hash 分支先被当作“改变原始 intent 载荷”拒绝；首个可区分断言得到 `idempotencyPayloadMismatch` 而非 `retryReferenceMismatch`，尚未恢复同一 prepared/root 或已提交 Receipt。测试只经可信 RPC，不改状态、时间、事件或骰面 |
| 2026-08-26T00:31Z | `npx vitest run tests/multiplayer-room-v2.test.ts --reporter=verbose`（并行切片回执） | 0 | 3/3；Room DO 以 service-only capability 管理 Seat/Control/host，可信 Principal 无法伪造管理权限；多人邀请/回答、全员同意整队移动、个人离队移动、分地点 FictionTimeline/CausalFrontier 与重连后的 Spotlight 均只提交 Rules 结果。Pending owner 由 Rules controller 沿 Control→Seat→Principal 派生，非提交者自报 |
| 2026-08-26T00:31Z | 多人 Room 后 Rules multiplayer/pending/observer 组合回归、`npm run module:check`、`git diff --check`（并行切片回执） | 0 | 14/14；管理命令幂等、state/events/Receipt/索引/Pending/Delivery 擦除在同一 DO SQLite 事务；初始化保留显式 role，Room 不再用 Store 重算 Spotlight。并行 Rules 复合切片一度使全局 typecheck 在其私有事件类型处失败，本行未把 typecheck 记为通过 |
| 2026-08-26T00:32Z | `npx vitest run tests/observer-delivery-v2.test.ts --reporter=verbose` | 0 | 4/4；单槽 current response 的 frozen Audience 只含行动发生地点的角色，且逐观察者 narration projection 删除非虚构观察的全局房间成员、Party 协调与 Spotlight 元数据，异地角色标识不再进入任一 narration plan；刷新/重连、ACK 擦除、迟到覆盖与七类旁路继续共用同一 projector |
| 2026-08-26T00:32Z | observer 修复后 `npm run module:check`、`git diff --check` | 0 | Rules 公共面与 Room/KP/Table 权威边界继续通过；修改只收窄 `project(viewer)` 派生的 narration 目的投影，没有建立第二知识投影或改变玩家 Read Model |

### 未完成条件

- 零到多随机请求的普通、对抗、战斗与复合批次已经进入同一 Room journal/Receipt 恢复链；记录的 Room 迁移组合覆盖单随机四崩溃点、对抗/战斗批次和显式 retry。它们仍须在最终冻结 SHA 作为全量门重跑。
- 可审计更正的授权、幂等、灾难重建、前向补偿、正式位置/知识/骰面后果触发的因果分支、Receipt supersede 与旧 Delivery 擦除已在 `archive-correction-v2` 5/5 转绿；后续源码演进后的最终组合仍待冻结重跑。
- 31 次连续交互已迁移为完整 production draft，逐轮通过 `validateProposal` 与 projection-bound 并达记录阈值；真实 Workers AI 模型调用、生产 HTTP/浏览器、远端迁移、部署与冒烟仍未完成，因此不能把上述回执解释为整站完成。

## 阶段 4：清除平行路径

- 状态：进行中；已把 Rules 公共面、私有实现导入、外层权威随机及 v2 旧活跃表 SQL 加入 `module:check` 硬门。生产 table/API 的全部服务命令、旧骰面路径隔离与 projector 旁路仍需完成动态验收。

### 根因审计的后续处置（不冒充最终冻结门）

- 服务命令：`joinRoom`、`kickMember`、`leaveTable`、`lockCharacter`、装备及组队入口已按精确 `ruleset_version` 先行路由 authoritative-v2/Legacy；记录的 service-routing/Room 迁移组合已转绿。`getRoomManagement` 现返回 `ruleset_version` 与 `kp_model`，但其新增 HTTP 断言仍须随冻结 `npm test` 执行。
- 装备与静态卡：authoritative-v2 已从可信静态卡编译 canonical loadout/资源/HP/class seed，并把运行期消费/穿戴影响交给 Rules/Room；D1 不再充当 v2 活跃库存状态。最终开房—建卡—装备 HTTP 回归仍待全量门。
- retry：`RoomActionInput.retry` 已恢复同 principal 的既有 prepared/root/Receipt，并区分错误 root、越权与幂等载荷；`room-retry-v2` 3/3 已包含在记录的 Room 16/16 恢复组合。
- proposal/delivery：authoritative-v2 DO compact proposal branches 已删除；normalizer 只接完整 production draft/精确 Pending capability，持久随机恢复只接受 ActionPlan v1/同版本待决续接。Legacy delivery/命令只由精确旧 ruleset 可达。
- 归档：DO 持久游标/outbox 已改为有界幂等增量续传，D1 allowlist 只包含 genesis、Rules events 与 projection audit，Delivery/intent/Prompt 不进入归档；专项测试已建立，最终冻结组合仍待重跑。
- 随机：Room journal 已支持零到多请求；对抗、战斗与复合动作在各恢复点复用每个稳定 face，并只产生一个最终 Receipt。相关 25/25 Room 迁移组合已转绿。

## 阶段 5：验证、迁移、发布和推送

- 状态：未开始

### 发布前只读控制面基线（2026-08-26T00:12:58Z）

- 本节只记录发布前事实；本轮没有执行 D1/DO migration apply、Worker deploy/version upload、流量修改、资源创建/删除或 Git push。
- Wrangler CLI 为 `4.125.0`。`whoami` 退出码为 0，确认当前浏览器/OAuth 会话已认证到 1 个账户且返回权限清单；账户名、邮箱、account id 与授权细节在显示和记录前均已脱敏。
- `zhuwei` 最近 10 条 deployment 与最近 10 个 version 均可只读列出。Wrangler 返回的最新既有 deployment 为 `cc1b9c96-a1e6-4e72-b8fd-c5cbef6a3740`，对应 version `3b22748d-9725-406e-b276-429fe99662b0`（version number 16），记录时间 `2026-08-25T16:43:31.100571Z`，该 deployment 条目为 100% 流量。它是核验前已经存在的线上版本，不是本 Goal 的 `DEPLOY_SOURCE_SHA`，也不构成本轮已部署证据。
- 远端 D1 migrations list 只列“尚未应用”的 migration；当前唯一待应用项为 `0006_nice_iron_lad.sql`。本轮未应用它，也未对远端 D1 做测试写入。
- `wrangler.jsonc` 与部署护栏共同确认目标仍为现有 Worker `zhuwei`、入口 `worker/index.ts`、D1 `DB/zhuwei-dev/f5a448fd-4224-4e52-bafb-a84cb190b618`、Durable Object `ROOMS/RoomDurableObject` 和 Workers AI `AI`；另有既有静态资产绑定 `ASSETS`。没有 KV、R2、Queue、Workflow、Vectorize 或第二个 D1/DO 状态权威。

| 时间（UTC） | 命令/检查 | 退出码 | 脱敏证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26T00:12Z | `npx wrangler --version` | 0 | `4.125.0` |
| 2026-08-26T00:12Z | `npx wrangler whoami`（输出先聚合并脱敏） | 0 | 已认证；1 个账户；权限清单存在；未记录账户标识或凭据 |
| 2026-08-26T00:12Z | `npx wrangler deployments list --name zhuwei --json`（身份字段脱敏） | 0 | 返回最近 10 条；最新既有 deployment `cc1b9c96-…-c5cbef6a3740` → version `3b22748d-…-429fe99662b0`，条目流量 100% |
| 2026-08-26T00:12Z | `npx wrangler versions list --name zhuwei --json`（身份字段脱敏） | 0 | 返回最近 10 个；最高 version number 16，id 与最新 deployment 一致 |
| 2026-08-26T00:12Z | `npx wrangler d1 migrations list zhuwei-dev --remote --config wrangler.jsonc` | 0 | `Resource location: remote`；唯一待应用 migration 为 `0006_nice_iron_lad.sql` |
| 2026-08-26T00:12Z | `git ls-remote origin refs/heads/main refs/heads/cloudflare` | 0 | `main=29eb06dc009c983ad61b2d862454503e67a7f40a`；`cloudflare=4bc3c3801f451a83a2491757237d3126ab7987bd` |
| 2026-08-26T00:12Z | `node cloudflare/verify-deploy-config.mjs` | 0 | SPEC 0001 哈希及现有 Worker/入口/AI/ROOMS/DB 资源护栏通过 |

### 迁移恢复前提与剩余发布条件

- 后续发布阶段应用 `0006_nice_iron_lad.sql` 前，必须冻结并提交生产源码，确认它仍是唯一新增 migration、既有 `drizzle/*.sql` 未被修改，并再次记录远端待应用列表。
- D1 schema apply 前必须先建立并记录可实际恢复的迁移前恢复点（例如经验证可用的导出或平台恢复书签）及对应恢复命令；不能把“migration 文件存在”当作自动回滚能力。本次只读核验没有建立恢复点。
- 应用后必须重新运行远端 migrations list，确认无待应用项，再执行可清理的最小写入—读取闭环；这些动作本轮均未执行。
- 正式部署仍须从干净、已提交且完成全量冻结门的源码执行，并另行记录 `DEPLOY_SOURCE_SHA`、Cloudflare version/deployment、线上冒烟、日志检查、`DELIVERY_SHA` 与远端 `cloudflare` SHA；当前只读基线不能替代这些证据。

## 规格、决策与追踪证据回填（2026-08-26）

- 目标：只在 `docs/` 内把已经实现并实际执行的 production typed ActionPlan、权威休整/Activity、Arcane Recovery、有意义失败、世界内分享及生命周期证据映射回已裁定规格；不修改 `SPEC 0001`，不把局部绿色写成最终全量/发布完成。
- 实际修改：新增 DEC-020（`resolveDirectConsequences` / `advanceCampaignLifecycle` 的封闭语义）与 DEC-021（canonical `arcaneRecoverySlotLevels`）；更新 DEC-006/010/011/012/018/019 的实际证据；修正 SPEC 0003/0004/0005/0008/0009 的生产文件和测试映射；同步索引、五项交叉审查和 P1–P10/A–O 追踪矩阵中的旧 RED。
- 权限/秘密结论：直接后果和生命周期事件仍只经 Rules `step` 与 Room DO 原子提交；Arcane Recovery UI 只冻结控制者选择，不能提交角色等级、资源上限或结算；世界内分享只产生带来源的新知识取得，旧 Delivery 不追溯；`startSequel` 使用新 Story/Chapter 与旧事实/威胁锚点。
- 证据边界：`startSequel` 已由直接 Rules 生命周期场景和 KP schema enum 验证；当前没有把它误写成专门的 compound translation 断言。所有命令均使用当前共享工作区源码；并行生产代码仍可能继续变化，最终必须在冻结 SHA 重跑全量门。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26T11:27Z | `node --import tsx --test tests/rules-compound-action-v2.test.mjs tests/authoritative-table-v2.test.mjs tests/world-campaign-v2.test.mjs tests/observer-projection-v2.test.mjs` | 1 | 33/34；唯一失败是纯虚构时间用例仍读取已迁移前的 `timeline.micros`，而权威状态已在 `fictionTimelines[activeBranchId].nowMicros`。这是测试断言与当前版本化时间状态不一致，不是生产规则回退；并行实现随后修正断言，本 docs 切片未改代码。 |
| 2026-08-26T11:28Z | `npx vitest run tests/compound-action-v2.test.ts --reporter=verbose` | 0 | 1/1；production KP draft 经 Room Action/Authority 与两份 DO 随机，在同一 Root Action 提交动态定义、有限知识 NPC 计划、场景问题和两份机械结果；归档无 raw intent。 |
| 2026-08-26T11:29Z | `node --import tsx --test tests/rules-compound-action-v2.test.mjs tests/authoritative-kp-adapter.test.mjs` | 0 | 17/17（Rules compound 12/12 + KP Adapter 5/5）；直接后果/纯虚构时间、结局候选/收束/尾声、全部非检定 operation、schema 注入拒绝及同 Root Action 复合语义已绿。 |
| 2026-08-26T11:30Z | `npx vitest run tests/multiplayer-room-v2.test.ts --reporter=verbose` | 0 | 8/8；个人 canonical 多槽 Arcane Recovery、DO 短休随机/完成点、整队自愿 Pending、长休拒绝、成长/退休/继任、service-only 控制、分队/时间/聚光灯已绿。 |
| 2026-08-26T11:31Z | `node --import tsx --test tests/world-campaign-v2.test.mjs tests/observer-projection-v2.test.mjs tests/rules-multiplayer-v2.test.mjs tests/authoritative-table-v2.test.mjs` | 0 | 30/30（world/campaign 7、observer 5、Rules multiplayer 8、table 10）；休整/Activity、世界内分享、失败/重试、真实 sequel boundary、私人投影和 UI-only Arcane Recovery 选择均绿。 |
| 2026-08-26T11:45Z | `shasum -a 256 docs/specs/0001-llm-kp-responsibility-contract.md`；`git diff -- docs/specs/0001-llm-kp-responsibility-contract.md` | 0 | 冻结文件 SHA-256 仍为 `b420123d…323be`，目标 diff 为空；本切片未修改 SPEC 0001。 |
| 2026-08-26T11:46Z | Markdown 连续表格 pipe-count 检查；映射文件存在性检查；`rg -n '[ \t]+$'`（本切片文档） | 0 | README/追踪矩阵/交叉审查/refactor-log 表格列数一致；所有记录的生产/测试路径存在；未发现行尾空白。 |
| 2026-08-26T11:46Z | `git diff --check` | 0 | 当前共享工作区已跟踪差异无空白错误；`docs/specs/` 与 `docs/refactor-log.md` 仍为待提交新文件，因此另以上述行尾/表格检查覆盖本切片新增文档。 |

## 严格 production 边界与迁移证据同步（2026-08-26）

- 目标：只在 `docs/` 同步当前已实现事实与真实命令回执；不修改 `SPEC 0001`，不把局部测试、公开方案文档或源码接线写成远端 D1 迁移、真实 Workers AI、正式部署或最终推送。
- 实际修改：新增 DEC-022–DEC-025，分别裁定完整 production proposal/恢复 allowlist、复合非战斗豁免、六种 typed `partyAction` 与管理 Read Model 规则版本；同步 SPEC 0003/0004/0007/0011/0013、索引、五项交叉审查及 P1–P10/A–O 追踪矩阵。authoritative-v2 的 compact DO proposal 分支已删除；Legacy 仅由精确旧 `ruleset_version` 可达。
- 非战斗机械：`resolveNoncombatSave` 现在与 check 共用复合事务，骰前冻结 duration、物品/资源成本、成功/失败后果；由 canonical class seed 应用 SRD 5.1/2014 职业豁免熟练，成功/失败的 HP、伤害和位置变化只由 Rules 事件结算。六种队伍语义为 `invite`、`accept`、`decline`、`leave`、`proposeMove`、`answerMove`，不得由可选字段猜测。
- 管理读取：`getRoomManagement` 已在房主鉴权后返回目录 `ruleset_version` 与 `kp_model`，HTTP 验收断言已写入；本节记录时尚未执行包含该断言的冻结 `npm test`，因此不把它列为最终测试通过。
- Cloudflare 公开事实复核：2026-08-26 官方文档列出 Workers Free 100,000 请求/日；D1 Free 5,000,000 行读/日、100,000 行写/日、5 GB；SQLite DO Free 100,000 请求/日、13,000 GB-s/日、5,000,000 行读/日、100,000 行写/日、5 GB 总存储；Workers AI 10,000 neurons/日。GLM 4.7 Flash 模型页确认 function calling 与 131,072 context；2026-07-28 付费限定清单不包含该模型，因此公开目录仍将它归入 Free 可用范围。本次没有读取或声称账户实际用量余量，真实 entitlement/调用仍待发布前验证。

### RED → 根因 → GREEN 与迁移组合回执

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26（记录的迁移切片） | `npx vitest run tests/room-authority-v2.test.ts tests/contest-room-randomness-v2.test.ts tests/combat-room-randomness-v2.test.ts tests/multiplayer-room-v2.test.ts tests/authoritative-service-routing-v2.test.ts` | 0 | 5 files / 25 tests；可信 Room 权威链、对抗/战斗批次随机、多人控制与精确 service routing 通过。 |
| 2026-08-26（记录的迁移切片） | `npx vitest run tests/observer-delivery-v2.test.ts tests/archive-correction-v2.test.ts tests/randomness-recovery-v2.test.ts tests/room-retry-v2.test.ts` | 0 | 4 files / 16 tests；单槽投递、灾难重建/篡改拒绝、前向补偿/正式后果驱动因果分支、四阶段随机恢复和显式 retry 通过；两组 Room 迁移合计 41/41。该命令是在后续删除代理修改前记录，冻结源码仍须重跑；本行正式取代当前状态中的旧 `archive-correction 4/5`。 |
| 2026-08-26（本 docs 切片实跑） | `node --import tsx --test tests/rules-compound-action-v2.test.mjs tests/authoritative-kp-adapter.test.mjs` | 0 | 25/25（Rules compound 18/18 + KP Adapter 7/7）；strict production normalization、save 成本/职业熟练/HP/位置、六种 partyAction 与 schema 注入拒绝通过；取代旧 12/12 + 5/5 的当前证据计数。 |
| 2026-08-26（严格评测首跑） | `npx vitest run tests/kp-multiturn-eval.test.ts --reporter=verbose` | 1 | RED：interaction 12 预期 `committed`，实际 `rejected`。fixture 的 `resolveNoncombatSave` 缺完整冻结 duration/cost/success/failure，又把物品放在 strict Rules 不读取的 legacy `staticCard.inventory`，因此权威校验正确拒绝不可用成本/效果。 |
| 2026-08-26（修正 fixture 后回执） | `npx vitest run tests/kp-multiturn-eval.test.ts` | 0 | GREEN 1/1，约 25.67 s；补齐完整 save 冻结字段、dynamic destination 及 canonical loadout/HP/class seed 后，31/31 连续意图/待决响应逐轮通过真实 `validateProposal` 与 projection-bound，并达到已记录硬门/评分阈值。受控 fixture 不替代真实 Workers AI。 |
| 2026-08-26T13:18Z | `npm run module:check` | 0 | 当前共享源码的 Rules 公共值仍严格为 `step/project/replay`；Room/AI/Table 外层骰源、v2 旧活跃表、compact DO proposal 分支与未受限恢复输入护栏通过。生产源码尚未冻结，阶段 5 仍须重跑。 |
| 2026-08-26T13:20Z | 冻结文件 SHA-256 与目标 diff | 0 | `SPEC 0001` 仍为 `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`，目标 diff 为空；内容与状态未修改。 |
| 2026-08-26T13:20Z | `git diff --check -- docs`；全 docs 行尾空白扫描；README/decision/cross-review/trace/refactor-log 连续表格 pipe-count | 0 | 已跟踪文档差异无空白错误；未跟踪规格/日志另经全文件行尾与表格列数检查，均通过。 |

### 当前未执行项

- 生产源码仍在并行演进；上述局部/迁移回执不是生产源码冻结后的 `module:check`、`typecheck`、`lint`、`npm test` 与全局 diff 最终门。
- 远端 D1 的 `0006_nice_iron_lad.sql` **尚未应用**；尚未建立迁移前恢复点，未执行远端最小写入—读取闭环，也未确认迁移后无待应用项。
- 本 Goal 的 Cloudflare Worker 正式部署、version/流量确认、线上入口冒烟、有界日志检查、`DEPLOY_SOURCE_SHA`/`DELIVERY_SHA` 记录及 GitHub `HEAD:refs/heads/cloudflare` 推送均**尚未执行**。既有线上 version 16 不属于本 Goal 部署证据。

## 长团 XP AdvancementProfile 收口（2026-08-26）

- 目标：落实 DEC-010 / SPEC 0008 已裁定的 `milestone | srdXp2014`，不修改 `SPEC 0001`；所有奖励、资格、玩家选择、回放、投影和更正仍只经 Rules `step/project/replay` 与生产 typed ActionPlan。
- RED 因果链：公开行为测试先证明两处首个不变量违反——XP 档案仍接受 `grantMilestone`，且 `initializeAuthoritativeWorld`/ActionPlan 不认识 XP Profile/奖励字段。失败不是 UI 问题，而是成长 Profile 尚未进入权威 genesis、事件与语义计划。
- 实际修改：Campaign genesis 默认固定 `milestone`，可显式固定 `srdXp2014`；角色保存累计 `experiencePoints`；SRD 2014 的 1–20 级累计阈值固定在 `character-progression.ts`。新增有界 `ExperienceAwarded`，达到阈值只打开 `AdvancementAvailable`；一次奖励跨多级时，每次 `CharacterAdvanced` 后继续打开下一份玩家专属选择，不自动代选。生产 `advanceCampaignLifecycle/awardExperience`、严格 KP schema/normalizer、统一 Read Model 和 correction audit 同步接入。
- 权限/秘密：成长选项继续只投影给控制角色；奖励事件及累计 XP 不从 D1 或页面计算，来源引用必须是已固化事实。档案不允许静默互换；XP 档案拒绝里程碑动作，milestone 档案拒绝 XP 奖励。
- 剩余条件：本切片不声称最终冻结门、远端迁移或部署；共享工作区后续并行 UI 变化一度使全局 typecheck 退出 1，具体只报 `play-table.tsx` 的既有 Button variant 与 `table/authoritative.ts` pending union 推断，XP 目标测试未失败，最终仍须在冻结源码重跑全量门。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26T13:30Z | `npx tsx --test tests/world-campaign-v2.test.mjs tests/rules-compound-action-v2.test.mjs`（实现前） | 1 | 25/27；两项预期 RED 分别证明 XP 档案错误接受里程碑、初始化拒绝 `advancementProfile`。 |
| 2026-08-26T13:43Z | `npx tsx --test tests/world-campaign-v2.test.mjs tests/rules-compound-action-v2.test.mjs tests/authoritative-kp-adapter.test.mjs` | 0 | 36/36（world 9、compound 19、KP Adapter 8）；覆盖默认/显式 Profile、0/超界拒绝、XP 事件/投影/回放、更正、跨两级逐级选择、生产 ActionPlan 与严格 schema enum。 |
| 2026-08-26T13:43Z | `npm run module:check`；`git diff --check` | 0 | Rules 公共面仍仅 `step/project/replay`，未建立 XP 第二裁决/投影路径；当前共享工作区已跟踪差异无空白错误。 |
| 2026-08-26T13:43Z | `npm run typecheck -- --pretty false` | 1 | 并行 UI/投影改动产生 4 个非 XP 错误：3 个 `Button variant="outline"` 与 1 个 pending union `flatMap` 推断；本行不冒充 typecheck 通过，留待冻结源码修复并重跑。 |

## 固定解释器 Registry 收口（2026-08-26）

- 目标：消除“只有 `CURRENT_RUNTIME_PROFILE_MANIFEST`”导致未来部署无法解释旧 authoritative-v2 房间的版本缺口，不修改 `SPEC 0001`，不借测试改变 production default。
- RED 因果链：新增公开 `step/project/replay` 行为测试后，首次运行因尚无隔离 Registry/runtime 构造而在模块加载期失败；既有 `v2-runtime.ts` 的 replay/project/step 又都直接返回或执行 current manifest，证明 genesis pin 未真正选择解释器。实现初版时一次 patch 把 `runtimeManifestRef` 临时误列入 `GENESIS_KEYS`，导致初始化后 replay 返回 `invalidGenesis`；将它移回权威 `STATE_KEYS` 后恢复。
- 实际修改：Registry 现在以完整 manifest 精确映射 interpreter，拷贝并冻结注册表；同一 Profile ID 不允许不同 hash，未知、错 hash、扩展闭包错位、历史无 Adapter 与 2024/5.5e 均 fail closed。production Registry 仍只以当前 manifest 为新 genesis default。权威 state 保存 genesis manifest ref；step/project 必须与 state pin 一致，replay 以 genesis manifest 选择解释器并逐事件核对。测试通过两个隔离 runtime 注册合成第二个 2014 manifest 并切换 default，未把该 manifest 写入生产目录。
- 权限/秘密：ProfileRef 可公开且不含 Prompt、模组 truth 或私人叙述；调用者不能通过请求切换既有房解释器。state pin 是 genesis 的缓存校验，不成为第二版本事实。
- 剩余条件：全局 typecheck 此时仍被并行 table/loadout 编辑的暂态错误阻塞；冻结源码必须重跑 typecheck/full test。本节只记录 Registry 局部证据，不冒充最终门、远端迁移或部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26（Registry RED） | `npx tsx --test tests/runtime-profiles-v2.test.mjs` | 1 | 新测试在 import `createVersionedRulesRuntime` 时失败，直接证明尚无可保留多 manifest/切换新 genesis default 的运行时接缝。 |
| 2026-08-26（Registry GREEN） | `npx tsx --test tests/runtime-profiles-v2.test.mjs` | 0 | 13/13；旧 archive 在隔离 Registry default 切换前后 replay/project 深相等，新 genesis 采用新 default，unknown/mismatch fail closed，2024 输入无事件。 |
| 2026-08-26T14:19Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs tests/world-campaign-v2.test.mjs tests/combat-mechanics-v2.test.mjs tests/rules-pending-v2.test.mjs tests/rules-compound-action-v2.test.mjs` | 0 | 52/52；版本 pin/旧 archive、新旧随机与待决、复合行动、战斗、长团 XP/继任及更正均经公开 `step/project/replay` 通过。 |
| 2026-08-26T14:20Z | `npx vitest run tests/room-authority-v2.test.ts tests/archive-correction-v2.test.ts` | 0 | 2 files / 13 tests；Room 创建/DO 权威随机、重试、归档 replay、篡改拒绝与更正仍可使用 genesis 固定 Profile。 |
| 2026-08-26（当前共享源码） | `npm run module:check`；`git diff --check` | 0 | Rules 包公开值仍只有 `step/project/replay`；Registry 构造留在私有实现，已跟踪差异无空白错误。 |
| 2026-08-26（当前共享源码） | `npm run typecheck -- --pretty false` | 1 | 仅报告并行中的 `table/server.ts` loadout 投影/同步符号错误；Registry/rules 文件无 TypeScript 诊断。本行不计最终 typecheck。 |
| 2026-08-26T14:18Z | `npm run typecheck -- --pretty false` | 0 | 并行 table/playerChoice 收口后当前共享源码全量 TypeScript 检查通过；生产源码仍未冻结，最终阶段仍须重跑。 |

## 单权威评测与 Geometry Profile 收口（2026-08-26）

- 31 轮评测不再用 `secondAuthority: false` 常量自证。评测器现从 DO 单调版本、逐 Root Receipt 事件区间覆盖、连续 archive hash chain、head projection audit，以及 D1 静态人物卡与 DO 活跃投影边界推导单权威信号；任何信号都成为硬失败。只修改 D1 fixture 中同一背包物品数量、保持 DO 版本与 Receipt 头不变时，负向测试稳定报告 `activeCardDivergedFromProjection` 与 `secondAuthority=true`。
- 同一 31 轮证据揭露 `StoryConcluded` 的 Rules Receipt 为 `committed`、Room/Archive 为 `concluded`。根因在 Rules 公共 Receipt union 与事件映射；修复后 actor projection、Room 结果与 archive Receipt ref 对同一 `receiptId/rootActionId/status` 严格一致，没有放宽断言。
- Geometry 首个实现切片以整数英寸/BigInt 实现 measurement core 三维范围、路径 milli-inch、占位、64 点掩护与 65 点区域采样；随后把硬遮挡从多边形 bounding box 近似替换为任意简单多边形棱柱的精确开线段求交，并加入 sphere/cylinder/cube/cone/line、方向基底、clear-path 原点冻结、straight/aroundCorners 传播及连续生物/地形移动分析。上述新增形状与传播仍须接入公开 `step/replay/project` 并完成 G01–G15 全向量后，才可把 SPEC 0013 的 Geometry 标为完成。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26（31 轮严格证据切片） | `npx vitest run tests/kp-multiturn-eval.test.ts` | 0 | 1/1，31 次连续意图/待决响应；严格核对 Receipt id/root/status/branch/scope/range、全部 archive event 被 Receipt refs 覆盖、head projection audits 与两 Viewer projection hash。 |
| 2026-08-26（评测边界切片） | `node --test tests/live-workers-ai-kp-eval-runner.test.mjs tests/live-workers-ai-kp-eval-provisioner.test.mjs` | 0 | 11/11；正常、评测失败与清理不完整路径保持精确清理语义，未执行真实外部 Workers AI。 |
| 2026-08-26（31 轮修复后） | `npx tsx --test tests/world-campaign-v2.test.mjs`；`npm run typecheck`；`npm run module:check`；`node --check scripts/live-kp-eval.mjs` | 0 | world/campaign 9/9；结局 Receipt 状态统一且 Rules 公共面、评测脚本语法通过。 |
| 2026-08-26T15:36Z | `npx tsx --test --test-name-pattern='Geometry measures creature footprints\|Geometry rejects movement' tests/combat-mechanics-v2.test.mjs` | 0 | 2/2；大体型 measurement core 边界、速度超限与重叠终点在公开 `step→replay` 路径保持。 |
| 2026-08-26T15:38Z | `npm run typecheck`；`git diff --check -- app/_runtime/lib/rules/profiles/combat-geometry.ts` | 0 | 任意简单多边形棱柱求交及五种区域形状首批实现通过 TypeScript/空白检查；此时共享 campaign 继承线尚未开始写入其暂态类型。 |
| 2026-08-26T15:45Z | `npm run typecheck` | 1（并行暂态） | 仅报并行长团继承实现的 `campaign-events.ts` 两处 `InheritanceAuthorization` 暂态字段不一致；Geometry 文件无诊断。本行不冒充冻结 typecheck，已通知对应切片收口。 |

### 仍需完成的 Profile 证据

- Ability Compiler A01–A09 尚缺正式 compiled graph/hash、复杂度/循环/未绑定选择诊断及事件内旧图回放证据。
- Geometry G01–G15 尚需把新内部算法接入唯一公开事务，覆盖五种区域、墙前原点、绕角、连续移动/困难地形、挤入和 Viewer 安全错误；不能把内部开发探针列为验收。
- Trigger T01–T07 与 Time F01–F09 必须在当前并行 Ready/Shield/Counterspell、长团及战斗相位实现合并后逐项建立公开 Interface 映射。
- 本节未执行远端迁移、真实 Workers AI、部署、流量修改或 Git push，阶段 5 状态仍为未开始。

## 中断恢复与 Profile 冻结前审计（2026-08-27）

- 当前阶段：继续阶段 3/4 的版本化 Profile 验收收口；阶段 5 仍未开始。本轮先区分“实现已经存在但日志滞后”和真实未覆盖向量，不把局部绿色冒充最终冻结门。
- 工作区恢复：当前仍为 `cloudflare`，`HEAD=9eb0a6c44b6f22afdc88e710886d1c59b9529313`，`origin/cloudflare=4bc3c3801f451a83a2491757237d3126ab7987bd`，本地领先 1；发现 35 个已跟踪变更和 75 个未跟踪入口，全部保留。未执行 reset、clean、强制 checkout、重新克隆、删除、迁移、部署或 push。
- 差异与冻结准则：`git diff --check` 为 0；`SPEC 0001` SHA-256 仍为 `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`，目标 diff 为空。package manifest 与 lockfile 当前无差异，因此没有运行 `npm ci`。
- 当前实现事实：日志末尾所称 A/G/T/F 尚缺证据已部分过时。工作区现有 `tests/ability-profile-v2.test.mjs`、Geometry 公共事务场景与 `tests/runtime-trigger-time-v2.test.mjs`；首次组合运行 48/48 通过。A06、F05/F06/F08 及 G01–G15 的逐向量责任映射仍在只读审计，未因测试名称或相关性先行勾选。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26T18:33Z | 完整读取 `AGENTS.md`、`CONTEXT.md`、Goal、`docs/refactor-log.md`；核对 `git status`、差异摘要与未跟踪清单 | 0 | 从共享工作区原地恢复；分支、HEAD、35 个已跟踪变更与 75 个未跟踪入口已记录，未覆盖既有工作。 |
| 2026-08-26T18:33Z | 完整读取冻结 `SPEC 0001`、全部 `docs/adr/*.md` 与当前直接约束 `SPEC 0013` | 0 | 重新确认叙事/机械/状态边界、两个深 Module、版本隔离以及 P/A/G/T/F 公开 Interface 完成门。 |
| 2026-08-26T18:33Z | `npx tsx --test tests/runtime-profiles-v2.test.mjs tests/ability-profile-v2.test.mjs tests/combat-mechanics-v2.test.mjs tests/runtime-trigger-time-v2.test.mjs` | 0 | 48/48；现有 Ability、Geometry、2014 战斗、Trigger、Activity、分支时间与 Profile Registry 场景均通过，逐向量完备性仍待审计。 |
| 2026-08-26T18:33Z | `npm run typecheck -- --pretty false` | 0 | 当前共享源码 TypeScript 检查通过。 |
| 2026-08-26T18:33Z | `npm run module:check` | 0 | Rules 公共值与 Room/AI/Table 单权威边界护栏通过。 |

### 当前剩余条件与下一步

- 等待 Ability、Geometry、Trigger/Time 三条只读审计逐项报告；只为真实缺口补生产实现或公开 Interface 测试，并同步 `SPEC 0013`、总追踪矩阵、决策登记与本日志中的实际证据。
- Profile 完成门闭合后才冻结生产源码并运行阶段 5 全量门；远端 D1 `0006_nice_iron_lad.sql`、真实 Workers AI、正式部署、流量、冒烟、日志检查和 GitHub 推送仍未执行。

## Profile 矩阵闭包与战斗 grant 根因修复（2026-08-27）

- 当前阶段：阶段 3/4 继续。Ability A04/A06/A07/A09 的真实缺口已在编译器、公开 `NeedsKpRulesResult`、冻结定义图调用与私有字段拒绝边界修复；A01–A09 定向测试现为 8/8。Trigger T01/T03/T07 与 Time F05/F06 的首个不变量违反已修复；F08 使用真正不同的 Time/Trigger 合成默认版本证明旧事件仍由旧 pin 解释，而不是只更换无关 manifest 字段。
- Geometry：G01–G09 的整数英寸、measurement core、路径、挤入与连续占位已通过；本轮补齐 G10 的 31/32/48/64 hard-cover 与 soft-only 上限、G11 的 20 尺边界/外 1 英寸及 caller 集合拒绝、G12 的墙前原点与集合同事件原子冻结、G13 的障碍顺序扰动。G14（分段移动被 Ready/Grapple 降速中断）与 G15（玩家安全错误、隐藏墙/实体、KP service-only 空间证据）已先取得 RED，生产修复仍在收口，故此处不提前标成完成。
- 战斗 grant 根因：旧 `turn.action + attacksRemaining` 在第一次 Attack 后仍保留 `action=1`，导致 Extra Attack 的剩余攻击可被错误泛化为 Cast a Spell；TurnStarted 又没有独立 haste grant，附赠动作法术限制只检查一个顺序。现改为开始 Attack 时立即消耗一个普通动作、只在该 Attack 内维护剩余攻击；haste 使用独立一次受限 grant；Action Surge 只增加普通动作；同回合附赠动作法术与一动作环法术双向约束。B11/B12/B17 的 RED 现 3/3 转绿。
- 当前并行安全：保留全部旧修改；未执行 reset/clean/checkout、远端迁移、部署或 push。生产仍未冻结，下面的定向绿色不是最终全量门。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-26T18:37Z | `npm run typecheck -- --pretty false`；`npm run module:check` | 0 | Ability/Geometry/Trigger/Time 首轮合并后类型与 Rules/Room 单权威边界通过。 |
| 2026-08-26T18:39Z | `npx tsx --test tests/ability-profile-v2.test.mjs tests/runtime-profiles-v2.test.mjs tests/runtime-trigger-time-v2.test.mjs tests/combat-mechanics-v2.test.mjs tests/rules-compound-action-v2.test.mjs tests/authoritative-kp-adapter.test.mjs` | 0 | 94/94；Ability 8、Runtime Profiles 13、Trigger/Time 14 及相关 Geometry/Compound/KP 集成无回归。 |
| 2026-08-26（F08 RED/GREEN） | `npx tsx --test --test-name-pattern='F08' tests/runtime-trigger-time-v2.test.mjs`；随后全文件 | 1 → 0 | RED 证明旧 P07 fixture 没有更换 Time/Trigger；改用独立 refs 后 F08 1/1、全文件 15/15，旧 instant、phase task、Profile pin、state hash 与 projection 在新 default 下保持。 |
| 2026-08-26T19:04Z | `npx tsx --test --test-name-pattern='Geometry G1[0-3]' tests/combat-mechanics-v2.test.mjs` | 0 | 4/4；G10–G13 全部从公开 `step/replay/project` 建立权威场景证据。 |
| 2026-08-26T19:18Z | `npx tsx --test --test-name-pattern='B11|B12|B17' tests/combat-mechanics-v2.test.mjs`（修复前） | 1 | 0/3；分别暴露剩余攻击泛化、缺失 haste grant、反向附赠法术限制缺失。 |
| 2026-08-26T19:24Z | 同一 B11/B12/B17 定向命令（修复后） | 0 | 3/3；Extra Attack 可攻击—移动—换目标—再攻击但不可转施法，haste 不刷新附赠/反应/Extra Attack，Action Surge 可支持两个一动作环法术。 |

### 当前剩余条件与下一步

- 先完成 G14/G15 并重跑整组 Profile 回归；随后继续 SPEC 0012 已确认的 Hostility、伤害/临时 HP/专注、死亡/非致命、全玩家战斗结束同意、长施法/仪式及 B53 Room 垂直段，不以新增测试名称代替真实语义。
- Profile 与替代规格/ADR 的状态、验收场景、实现映射和证据仍需同步；冻结源码后的 `module:check`、`typecheck`、`lint`、`npm test` 尚未执行。
- 阶段 5 仍未开始：远端 D1 恢复点/迁移/写读闭环、真实 Workers AI、正式部署/流量/冒烟/日志、提交推送及远端 `main` 不变核对均仍待完成。

## SPEC 0012 战斗尾项闭包（2026-08-27）

- 当前阶段：阶段 3/4 继续，生产源码尚未冻结。G14/G15 的公开路径修复已合入共享工作区；B29/B30 的首因是结论提案只选择第一名存活玩家且一次接受即结束，现按稳定 ordinal 依次冻结全部存活玩家的私有同意，拒绝保持 Encounter 活跃，逃离结论还必须引用覆盖全部存活玩家的 canonical escape fact。UI 同步提供拒绝按钮。
- B19 根因链：环境扰动没有规则命令；临时 HP 没有定义/事件/fold；伤害结算在确认实际伤害前预取专注骰，导致免疫伤害也消费未使用随机；专注结果缺少审计事件。现由 `testConcentration` 固定环境 DC 10，`ConcentrationTested` 记录每一独立来源，实际伤害提交后才分阶段请求一次专注骰；0 伤害不请求；替换先结束旧专注，主动结束不消耗动作；临时 HP 取较高值、不叠加、不复活也不移除稳定/昏迷。
- B21/B22 根因链：0 HP 状态把 melee 误当 critical，近战伤害在玩家非致命选择前就提交巨量伤害死亡；稳定状态没有 1d4 小时 Activity、Medicine DC 10、治疗/受伤中断。现把 critical 与 melee 分离，在任何死亡事件前打开控制者私有 `knockOut` 窗口；非致命选择覆盖巨量伤害为稳定昏迷，重要 NPC 的 `deathPolicy=deathSaves` 由 Encounter 事前固定。Medicine/第三次成功/非致命均由 Room 权威掷 1d4 并启动 `stableRecovery2014`，到期前不生效，到期后恢复 1 HP；治疗或后续实际伤害显式 `ActivityInterrupted`。自然 1、自然 20、0 HP 受伤、三次成功/失败继续走同一事件链。
- 修改范围：`rules/v2/model.ts`、`combat-events.ts`、`combat-actions.ts`、`campaign-actions.ts`、Ability 编译/人物同步相关文件、`projector.ts`、`room/durable-object.ts`、`play-table.tsx` 与 `tests/combat-mechanics-v2.test.mjs`；没有修改或缩小 `SPEC 0001`/Goal，没有远端写入、部署、提交或 push。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（B29/B30 子切片） | conclusion 定向 4 项、pending/randomness 1 项、`tests/runtime-trigger-time-v2.test.mjs`、UI 定向、`module:check`、`git diff --check` | 0 | 分别 4/4、1/1、15/15、1/1；全部存活玩家依次接受/任一拒绝、逃离事实覆盖、重连与 UI 拒绝入口通过。 |
| 2026-08-27（B19 环境 RED/GREEN） | `--test-name-pattern='B19 environmental disruption'` | 1 → 0 | 首次 `unsupportedOperation`；实现后两个独立环境来源各产生一次冻结 DC 10/Con 修正的 `ConcentrationTested`，先成功后失败，replay 一致。 |
| 2026-08-27（临时 HP RED/GREEN） | `--test-name-pattern='temporary hit points absorb'` | 1 → 0 | 首次目标不可用；实现编译/事件/fold 后 4 点临时 HP 不改变 0 HP、稳定、昏迷或 lifeState，replay 一致。 |
| 2026-08-27（B22 RED/GREEN） | `--test-name-pattern='B22'` | 1 → 0 | 首次巨量伤害先提交死亡；修复后 2/2，致命分支死亡，非致命分支稳定且先启动 1d4 Activity；重要 NPC `deathSaves` 分支保持 0 HP 未死亡。 |
| 2026-08-27（B21 Medicine/Activity RED/GREEN） | Medicine、稳定恢复中断定向测试 | 1 → 0 | 首次缺定义/目标及无 `ActivityInterrupted`；修复后 Medicine DC 10、自然恢复到期 1 HP、治疗/后续伤害中断均通过。 |
| 2026-08-27（B19 伤害随机 RED/GREEN） | `--test-name-pattern='fully negated damage'` | 1 → 0 | 首次免疫后的 0 伤害仍请求专注骰；分阶段后不再消费随机且专注保持。两个真实伤害来源又各自产生恰好一次专注检定。 |
| 2026-08-27T04:34Z | `npx tsx --test --test-name-pattern='action economy derives|B19|B21|B22' tests/combat-mechanics-v2.test.mjs` | 0 | 11/11；B19–B22、B20 混合伤害取整/抗性/免疫/易伤/资源原子性与 replay 组合回归通过。 |
| 2026-08-27T04:30Z | `npm run typecheck`；`npm run module:check` | 0 | 修正 campaign Activity readonly 联合、长施法返回联合及 KP/player 投影类型收窄后，全量 TypeScript 与唯一 `step/project/replay`/Room 权威护栏通过。 |

### 当前剩余条件与下一步

- B07 阵营敌对关系、B38 长施法/仪式和 B53 自然语言 Room 垂直段正在独立公共接缝切片收口；合入后须重算 Event/Ability/manifest Profile hashes，并重跑所有 Profile 与 SPEC 0012 回归。
- 随后同步替代规格、ADR、B01–B53 处置矩阵、交叉审查与追踪证据；只有冻结源码上的 `module:check`、`typecheck`、`lint`、`npm test`、评测、远端迁移/写读、部署/流量/冒烟、提交/push 和远端 `main` 不变全部取得实际证据后才能标记 COMPLETE。

## B07/B38 与 Profile 级联冻结（2026-08-27）

- B07 根因：敌对候选命中第一条定向关系即返回，三个以上阵营时遗漏后续敌对方；同时没有在 Encounter 因果链中改变关系的公开命令/事件。现合并同源的全部定向关系，并由 `changeEncounterHostility → HostilityChanged → fold` 固化新目标集和前值，显式目标与候选、replay/project 一致；非玩家阵营没有被压成单一敌方。
- B38 根因：通用 `interruptActivity` 只中断 Activity，却遗留关联的 `longSpellcasting` 专注；无 campaign 元数据时玩家投影也漏掉自己受控角色的 Activity。现中断在同事务结束专注，受控 Activity 始终投影。8 个场景覆盖逐轮动作投入、完成点才耗位、伤害专注失败、0 HP 失能、漏投动作、主动中断、ritual 额外十分钟不耗位，以及完成后普通 Counterspell 不返位。
- Geometry G14/G15 已从先前 RED 收口：移动只提交触发前/反应后仍合法的前缀；隐藏实体/障碍、猜测目标和 KP 空间证据复用唯一 projector，空间全知只接受 service-only capability。
- Profile 根因：B07 的 Event/Combat hash 先行更新后，B19–B22 的新专注审计、临时 HP、非致命/稳定恢复，B38 的长施法 Activity，以及 G15 的投影语义尚未进入对应 canonical 文档。现将 EventSchema、AbilityCompiler、Combat、DamageDeath、ProjectionPolicy 文档升级并自底向上实算叶子 ref 与总 Manifest；没有把 hash 当常量自证。测试 genesis 随 Manifest 变化后第一次因旧冻结 genesis hash 失败，重算 canonical unsigned genesis 后恢复，运行时 integrity 检查未放宽。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（B07 RED/GREEN） | `node --import tsx --test tests/combat-hostility-v2.test.mjs` | 1 → 0 | 首个 RED 只返回一个敌对阵营；第二个 RED 为 `changeEncounterHostility` 未支持。修复后 2/2，三阵营候选、停战后显式目标拒绝、事件前值、replay/project 通过。 |
| 2026-08-27（B38 RED/GREEN） | `npx tsx --test tests/combat-long-casting-v2.test.mjs` | 1 → 0 | 首次主动中断只有 `ActivityInterrupted` 而无 `ConcentrationEnded`；最终 8/8，未完成效果/槽位保持未发生。 |
| 2026-08-27T04:45Z | G14 与 G15 两条公开 Interface 定向命令 | 0 | G14 1/1；G15 1/1。连续移动中断、重连/回放和 service-only 空间秘密通过。 |
| 2026-08-27T05:05Z | canonical leaf/manifest hash 实算与 `profileRegistryMatchesCanonicalDocuments()` | 0 | 返回 `true`；当前 manifest=`9872dfe9…187a7`、event=`29266fcf…faea6`、ability=`561710d6…25ba3`、combat=`b9e12294…4acc6`、damage/death=`37dbf131…37d7a`、projection=`18786732…374d9`。 |
| 2026-08-27T05:07Z | Profile 组合回归首次运行 | 1 | 29/32；仅 P01/A08/F02 因测试仍固定旧 Manifest 对应 genesis hash 而在 replay 前 fail closed；这是冻结 fixture 未级联，不是生产解释器回退。 |
| 2026-08-27T05:12Z | Registry/Ability/B07/B38/G15 组合；B19–B22/B20/G14 组合 | 0 | 32/32 + 12/12；重算 genesis hash 后 Profile 完整性、旧版本隔离、2014 护栏和全部新增机械共同通过。 |

### 当前剩余条件与下一步

- B53 目前已有自然语言开战/动态危险/多人投影/NPC 投降提案/全员同意/长期状态保留的生产 Room Action→DO→Rules→viewer 场景，但仍须在同一垂直链补齐并证实移动中断、玩家私人反应、实际伤害/专注和断线恢复，不能用独立 Rules 测试替代。
- B53 完整后再做 SPEC 0012 全矩阵和所有替代规格完成门审计；随后才可冻结生产源码并进入阶段 5。

## B53 生产 Room 垂直段恢复（2026-08-27）

- 当前阶段：阶段 3/4 的最后一条战斗垂直验收。测试继续只走 `handleRoomAction → Room Durable Object → Rules step/project/replay`；没有从测试注入骰面、内部状态补丁或第二裁决路径。
- 首个 RED：动态哨兵定义把熟练加值写成 `12`，超过权威动态战斗员校验允许的 2014 范围 `2..9`，生产 ActionPlan 被 `invalidRulesInput: Dynamic combatant is malformed` 正确退回。夹具改为 `9` 后，自然语言开战、动态危险/敌人固化与多人 Viewer 投影进入后续链。
- 第二个夹具边界：`guidance` 在当前 v2 编译图中尚未完整表达 willing-creature 的战斗目标亲和与 modifier 效果，不适合作为 B53 的专注载体；垂直场景改用已完整支持的 Ranger 自身 `ensnaring` 一环专注，仍由静态卡编译、耗位和权威状态启动专注，没有放宽目标校验。
- 当前确认的生产根因：NPC 的保底正伤害先产生一波攻击/豁免与伤害随机；伤害命中正在专注的玩家后，B19 规则正确返回第二个 `awaitingRandomness` 以冻结一次专注豁免。`app/_runtime/lib/room/durable-object.ts` 在首波 fulfillment 后只接受终态，遇到合法第二波便在 `3088–3106` 以 `invalidRulesResult: Rules did not close authoritative randomness` 拒绝。首个违反不变量的位置是 Room 持久化随机数编排，不是战斗规则、KP 或 UI。
- 已写入但尚未转绿的同链验收：NPC 撤离触发 Bob 私有借机反应；Alice 看不到反应详情；在 Pending 时驱逐并重建 DO 后 Bob 必须看到逐字段相同的 Pending，再由认证回答完成反应与剩余移动；最后 NPC 投降仍需两名存活玩家分别同意，并保留 HP、位置、状态与动态危险事实。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T05:19Z | `npx vitest run tests/combat-vertical-v2.test.ts --reporter=verbose` | 1 | RED：开战提案重试两次，诊断为动态战斗员不合法；定位到测试熟练加值 `12` 超界，未修改生产校验。 |
| 2026-08-27T05:20Z | 同一 B53 命令 | 1 | RED：`guidance` 自身目标不在当前敌对候选中；改用已完整编译的自身专注能力，不借此扩大目标集合。 |
| 2026-08-27T05:23Z | 同一 B53 命令 | 1 | 随机先攻同点打开合法 `initiativeTieOrder` Pending；测试改为由实际控制者通过认证 `answer` 处理，不假设随机结果永不相同。 |
| 2026-08-27T05:26Z | 同一 B53 命令 | 1 | 当前关键 RED：伤害首波完成后规则返回专注豁免第二波，Room DO 拒绝 `awaitingRandomness`，结果为 `invalidRulesResult`；多波持久化/恢复闭环尚待修复。 |
| 2026-08-27T05:33Z | `npx tsx --test --test-name-pattern='semantic multiplayer combat start' tests/rules-compound-action-v2.test.mjs`（修复前/后） | 1 → 0 | RED 证明 `startCombat` 只冻结 actor↔target 敌对关系，`memberRefs` 中的 Bob 虽是参与者却不敌对，因而不可能获得借机反应；在 ActionPlan 单一翻译器将全部显式盟友与目标双向分组后 1/1 GREEN。 |
| 2026-08-27T05:35Z | `npx tsx --test --test-name-pattern='finite-knowledge NPC mechanical action' tests/rules-compound-action-v2.test.mjs`（修复前/后） | 1 → 0 | 全文件回归暴露拒绝借机反应后同一移动分段再次向同一角色提供相同 Pending。`continueMovement` 只在当前分段排除已回答反应者后转绿；后续分段仍可按新触发重新评估。 |
| 2026-08-27T05:36Z | `npx tsx --test tests/rules-compound-action-v2.test.mjs` | 0 | 27/27；多人开战敌对冻结、有限知识 NPC 行动、借机反应接受/拒绝与其余 compound 语义组合无回归。 |
| 2026-08-27T05:38Z | `npx vitest run tests/combat-room-randomness-v2.test.ts -t 'durably completes NPC save damage followed by a concentration-save randomness wave' --reporter=verbose` | 1 | focused RED 为 1 failed / 6 skipped；公共 Room prepare/commit/observe/export 已完成首波豁免+伤害，第二波专注检定仍在 DO 返回 `invalidRulesResult`。测试同时冻结预期的三份 commitment/faces、两次 `RandomnessRequested`、单次伤害/专注事件及丢响应同 Receipt 重试。 |
| 2026-08-27T05:47Z | second-wave `afterRandomnessRequestCommit` / `afterRandomnessCandidateCommit` 恢复用例 | 0 | 2/2；现有 batch 行升级为有界累计 multi-wave envelope。每波事件/state/下一请求同事务提交，候选随后固化；在第二波请求提交后或候选提交后模拟崩溃、驱逐 DO，恢复均保留既有波骰面并最终返回同一 Receipt/commitments/faces。 |
| 2026-08-27T05:48Z | `npm run typecheck -- --pretty false` | 0 | 多波 Room 编排与 reaction decline 局部收窄均通过全量 TypeScript；`reactionQueue` 在守卫后缓存为局部常量，未改变运行语义。 |
| 2026-08-27T05:48Z | `npx vitest run tests/combat-vertical-v2.test.ts --reporter=verbose` | 1 | 首次越过多波伤害后触发默认 5 秒测试超时；仅将该真实多 RPC 垂直测试的专用 timeout 提高，不改变产品行为。 |
| 2026-08-27T05:49Z | 同一 B53 命令（提高 timeout 后） | 1 | 生产移动已提交但未打开借机反应。事实显示 Bob 在 `x=60`、哨兵在 `x=180`，标准 5 尺格的中心相距 10 尺，不在 5 尺触及内；这是测试夹具错误，不是几何/敌对规则错误。 |
| 2026-08-27T05:52Z | 同一 B53 命令（相邻夹具修正后） | 0 | 1/1，约 28.7 秒；哨兵起点改为与 Bob 相邻的 `x=120`，完整贯通自然语言开战、动态事实、伤害/专注多波骰、私有反应、Pending 驱逐重连、移动完成、NPC 投降、全部存活玩家逐人同意、故事继续、长期状态及归档事件。 |

### 当前剩余条件与下一步

- 多波与 B53 主链现已转绿；仍须收口同一 prepared/proposal 并发提交时“第一份已持久化候选获胜”的幂等竞争，不能因两个调用在异步 hash 间交错并各自产生本地骰面而让后到调用返回 integrity mismatch。
- 多波 journal 使用现有 `authority_randomness_batches` 行的向后兼容累计 envelope，不新增 schema：每波先原子提交该波事件、下一波请求与权威 state，再生成并持久化下一波候选；恢复必须保留先前骰面且在第二波 request/candidate 两个检查点驱逐后仍得到同一 Receipt/commitments/faces。
- 并发随机恢复收口后重跑 SPEC 0012/Profile 组合并回填替代规格/ADR/矩阵；阶段 5 仍未开始，远端 D1、Workers AI、部署、流量与 push 均未执行。

## B53 多波并发、旧 journal 与归档唤醒硬化（2026-08-27）

- 当前阶段：阶段 3/4 收尾，尚未冻结生产源码。多波随机继续复用现有 `authority_randomness_batches` 单行累计 envelope；没有新增 D1/DO schema，也没有建立第二随机源、第二事件表或第二投影路径。
- 严格并发根因：候选在异步 hash 间交错时，慢调用可能比胜者 journal 落后两波；旧 CAS 只接受精确同波或相邻状态，因此虽不会覆盖已落盘骰面，却可能返回 `randomnessJournalIntegrityMismatch`。现只接受两类可证明前进：同波 candidate 首写，或 requests/waves/requestEvents 同步严格扩展；慢调用重载胜者 journal 后继续由同一 `step` 闭环，最终 Receipt 与全部 faces 相同。
- 向后兼容：旧 plain fulfillment 自动规范为 wave 0；真正旧 `authority_randomness_journal` 的 `candidateCommitted` 行在首次读取时无损提升为 batch，沿用原 candidate faces 并最终标记 finalized。恢复测试直接读取迁移前候选并逐 faces 对比 KP 机械结果和丢响应重试，没有以结果范围替代“不重掷”证据。
- 场景与归档不变量：同一 scene 同时只允许一个未结随机 settlement；不同 scene 仍可推进。每次原子 append request-wave 或 final events 时同步增加 archive pending generation；丢失 alarm 后，cached retry 与 DO constructor 都可重新合并 archive/TTL alarm。
- 完整性复审发现并修复一个 P1：forward-extension 曾把 `request_events_json` 单独增长视为进展，且重载后没有证明事件已存在于 `authority_events`，理论上可把伪事件带入 Receipt/Delivery。现 events-only 不能构成前进，累计 request events 必须是当前 Root 已持久化事件中的精确连续片段，逐项核对 root、eventSeq、eventId 和完整 JSON，并拒绝重复。历史前缀改写与伪造后缀两例均 fail closed。
- 归档测试诊断：`archive-do-resume-v2` 的 43 次逐步增员会让每次完整 replay/索引同步随角色和事件数量超线性增长；分段数据为 init 16ms、10 次 0.61s、20 次 3.94s、30 次 13.94s、40 次 36.26s、43 次 46.35s、export 53.39s、首个 synthetic-failure alarm 60.42s。临时完全禁用 `applyRoomAdministration` 的机会性归档后曲线不变，排除本轮 archive scheduler/mark-pending 为因；测试夹具仍须在不删减 85+ events、48 audits、分页/重试/驱逐/TTL 断言的前提下优化，不能只继续抬 timeout。临时诊断日志已回退。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（并发/兼容切片） | `npx vitest run tests/combat-room-randomness-v2.test.ts tests/randomness-recovery-v2.test.ts tests/contest-room-randomness-v2.test.ts --testTimeout=30000` | 0 | 3 files / 22 tests；两波四崩溃点、严格慢调用落后两波、同 Receipt/三份 faces、同/异 scene settlement、plain fulfillment、旧 journal lazy promotion 与一波恢复通过。后续新增两项 request-event 篡改测试，最终计数须在冻结源码重跑后记录。 |
| 2026-08-27（P1 定向） | contest、room retry frozen、target pending、两项 journal 篡改、严格多波并发的定向组合 | 0 | 4 files / 6 tests；合法 pending/contest/慢并发通过，改写历史前缀和只加未持久化事件后缀均返回 `randomnessJournalIntegrityMismatch`。 |
| 2026-08-27（当前源码） | `npm run typecheck`；目标 ESLint / `git diff --check` | 0 | 多波 journal 类型、并发收敛、旧 journal 提升、scene lock 与 P1 完整性校验通过；最终全量 lint/diff 门仍待源码冻结。 |
| 2026-08-27T06:31Z | `npx vitest run tests/archive-do-resume-v2.test.ts --reporter=verbose --testTimeout=60000` | 1 | 测试尾部局部 `30_000` 覆盖 CLI 预算，31.3s 时超时，并产生 teardown pending RPC；尚未到恢复断言。 |
| 2026-08-27T06:32Z | 局部预算改为 `60_000` 后重跑同文件 | 1 | 62.3s 超时；预期 synthetic D1 outage 日志只在超时边缘出现，分段诊断随后确认瓶颈在造大历史而非 alarm 断言。该失败保留为待修验证基础设施，不冒充归档行为通过。 |
| 2026-08-27（归档夹具等价优化） | `npx vitest run tests/archive-do-resume-v2.test.ts -t "resumes 80\\+ events through bounded alarms" --testTimeout=60000` | 0 | 1/1，约 10.73s；48 个稳定 Viewer + 单个可移除 Seat 的 83 个 seed characters，经一次公开 `removeMember` 产生 85 个合法事件；85+ events、48 audits、每批不超过 40、首次 D1 失败重试、eviction 游标恢复与 TTL 原断言全部保留。 |
| 2026-08-27（最终随机组合） | `npx vitest run tests/combat-room-randomness-v2.test.ts tests/randomness-recovery-v2.test.ts tests/contest-room-randomness-v2.test.ts --testTimeout=30000` | 0 | 3 files / 24 tests；包含新增 request-event prefix/suffix 篡改拒绝，取代本节较早的 22 项切片计数。 |
| 2026-08-27T06:56Z | `npm run typecheck && npx vitest run tests/combat-room-randomness-v2.test.ts tests/randomness-recovery-v2.test.ts tests/contest-room-randomness-v2.test.ts tests/room-retry-v2.test.ts tests/archive-do-resume-v2.test.ts tests/combat-vertical-v2.test.ts --testTimeout=60000 --reporter=verbose` | 0 | TypeScript 退出 0；6 files / 30 tests 全绿，组合覆盖 24 项随机/恢复、3 项 retry、2 项增量归档和 1 项 B53 自然语言 Room 垂直链。预期 synthetic archive outage 只产生脱敏 telemetry，随后同测试成功恢复。 |

### 当前剩余条件与下一步

- Room randomness/retry/archive/B53 最终组合已实际通过；下一步完成 SPEC 0012/Profile 公开组合、替代规格证据终审与阶段 4 平行路径清除审计。
- 复核并同步 SPEC 0012/0013、DEC-034、交叉审查与追踪矩阵中的最终测试计数；`SPEC 0001` SHA/diff 仍必须保持不变。
- 冻结源码后的 `module:check`、`typecheck`、`lint`、`npm test`、受控/真实 Workers AI 评测、远端 D1 恢复点/迁移/写读、部署/流量/冒烟/日志、提交/push 和远端 `main` 不变仍全部待执行。

## Profile 公开组合与阶段 4 单投影边界收口（2026-08-27）

- 当前阶段：阶段 4 最终审计，尚未冻结或部署。完整公开 Profile 组合已经通过；本节记录审计后补出的两个真正单权威缺口和一个 Activity 到期随机恢复缺口，不把文档同步或局部绿色写成阶段 5 完成。
- Geometry/OA 根因链：移动编排曾把内部 ally-occupied waypoint 当作整个自愿终点，合法完整路径因此返回 `occupiedEndpoint`；反应队列的已处理角色又未跨随机 Pending 冻结，拒绝后的同一角色可能被重复询问。现先对完整路径原子预检，只有真正可暂停的合法前缀才持久化；内部占位 waypoint 向前延展到首个合法暂停点；`processedReactionEntityIds` 随请求与 Pending 冻结并严格排除已经处理的队列前缀。G08/G14 组合及 A06 双反应者场景同时通过，未允许任何重叠终点落盘。
- 生命周期投影根因：Room 的 `successorRequired` 分支曾手工拼装 `readModel/projectionHash`，而普通 former controller 仍可投影已退役完整人物。现 `PlayerViewer` 增加仅内部使用的 `purpose: "lifecycle"`，`projectLifecycle` 同时验证可信 principal session、活跃 seat、人物最后控制席和 former tenure；普通 player 授权要求活跃 tenure。Room 统一调用 `projectAuthoritative`，生命周期输出保持原有最小公开字节形状，`module:check` 禁止 Room 手工 projection hash。
- 恢复候选根因：Table/UI 曾按等级、法术槽和职业资源本地推导 Arcane Recovery 与短休生命骰候选，形成第二套机械候选。现 Rules 的 `projectRestRecoveryOptions` 同时服务 canonical rest validator 与 SafeReadModel，投影 `hitDiceMaximumSpend`、生命骰面及 Arcane Recovery 资格/预算/各环最大恢复数；Table/UI 只清洗、展示和提交投影值，Rules 提交时仍重验。Legacy 精确旧 ruleset 的展示 fallback 保留。
- Profile 级联：Projection Policy 升至 `1.2.0`，明确 `successorLifecycle=trusted-active-seat-former-character-minimal-view` 与 `mechanicalCandidates=rest-recovery-options-derived-by-rules-projector`。实算 projection hash=`sha256:9312f68960f1c53f79b5c95bfd8c95ab87aec903603796f455a6c1d2d4514d8c`、manifest hash=`sha256:2f7af76e9a7262675210c18528ca9c6bead5c676aecc71113304eaf01f42dbe9`、unsigned genesis hash=`sha256:7e858e340283252d67779ddb1ae773fb5ac5a98d3859fdcef467c58a34935355`；`profileRegistryMatchesCanonicalDocuments()` 返回 true，旧完整 hash 在 app/tests/docs 已无残留。
- Activity 到期随机恢复根因链：短休生命骰完成由 F04 调度为独立 `activity-due:<activityId>:<completionFictionMicros>` Root，而 journal checker 只从当前 `submission:*:complete` Root 查找请求事件，合法恢复被误报 `randomnessJournalIntegrityMismatch`。现只额外接受从冻结 Activity id/完成时刻精确构造的 canonical due Root，并要求 randomness id 前缀、所有请求同一 Root、在该 Root 的权威事件中构成完整 JSON/eventSeq/eventId 精确连续片段；普通 combat/submission Root 仍按既有绑定，跨 Root、伪造前后缀和重复事件继续 fail closed。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（movement/OA RED→GREEN） | G08/G14 与 A06 定向测试；随后 `tests/combat-mechanics-v2.test.mjs` 全文件 | 1 → 0 | RED 分别定位 ally waypoint 误当终点及 reaction queue 丢 processed prefix；修复后战斗机械 45/45，完整路径、真实终点占位拒绝、敌对阻断、双反应者 use/decline 与 Pending 持久化通过。 |
| 2026-08-27（公开 Profile 组合） | `npx tsx --test tests/runtime-profiles-v2.test.mjs tests/ability-profile-v2.test.mjs tests/runtime-trigger-time-v2.test.mjs tests/combat-mechanics-v2.test.mjs tests/combat-hostility-v2.test.mjs tests/combat-long-casting-v2.test.mjs tests/rules-compound-action-v2.test.mjs tests/privacy-bypass-v2.test.mjs` | 0 | 119/119，约 167.65 秒；Registry/Ability/Trigger/Time/Geometry/Combat/Compound/Privacy 全部通过。 |
| 2026-08-27（lifecycle RED→GREEN） | lifecycle 定向公开 Rules 测试；Room successor integration；`npm run typecheck -- --pretty false`；`npm run module:check` | 1 → 0 | RED 证明 former player 可见退役完整人物；修复后 lifecycle 4/4、Room 2/2、类型和 Room 不得手工 projection hash 护栏通过。 |
| 2026-08-27（rest candidates RED→GREEN） | world/campaign 2014 rest 定向；authoritative Table 定向；Room Arcane Recovery/短休/组队休整四项；`npm run typecheck -- --pretty false` | 1 → 0 | RED 为 `restRecoveryOptions` 缺失；修复后 Rules/Table 2/2、Room 4/4，机械候选只来自 Rules projector。 |
| 2026-08-27（canonical Profile） | canonical 文档实算、`profileRegistryMatchesCanonicalDocuments()`、旧 hash 扫描、`tests/runtime-profiles-v2.test.mjs` | 0 | Registry 完整性 true；新 projection/manifest/genesis 三层 hash 对齐；Runtime Profile 13/13，旧完整 hash 扫描无命中。 |
| 2026-08-27（Activity due Root RED→GREEN） | `npm run typecheck -- --pretty false && npx vitest run tests/randomness-recovery-v2.test.ts tests/combat-room-randomness-v2.test.ts tests/contest-room-randomness-v2.test.ts --testTimeout=30000 --reporter=verbose && npx vitest run tests/multiplayer-room-v2.test.ts -t 'Arcane Recovery|short-rest hit-die|group-rest consent|long-rest consent' --reporter=verbose` | 1 → 0 | RED 为合法短休 journal 查错 Root；修复后 typecheck 通过、随机/恢复 3 files / 24 tests、Room rest 4/4；两项 request-event 篡改拒绝仍绿。 |

### 当前剩余条件与下一步

- 完成派生规格/追踪矩阵/决策登记同步，并把 Room 对 Legacy `applyEvents` 的直接导入隔离为精确旧版本 Adapter；随后运行阶段 4 边界组合，冻结生产源码。
- 阶段 5 仍须在干净提交上运行 `module:check`、`typecheck`、`lint`、`npm test` 和 31 轮受控评测，再按 Goal 授权执行远端 D1 恢复点/迁移/写读、真实 Workers AI、现有 Worker 部署、流量/冒烟/日志、文档回执提交、非强制推送及远端 `main` 不变证明。

## Legacy Facade 与生命周期 fixture 冻结前修正（2026-08-27）

- 阶段 4 的 Legacy 边界已从“DO 内有精确版本条件”收紧为代码接缝：新增 `rules/legacy-adapter.ts`，只有该 rules 内部 facade 可导入旧 `engine`；对外以 `initializeWorld/adjudicate/applyCommittedEvents/projectViewer` 命名，并在取得 adapter、定义、state 及每次 fold/project 前都验证精确旧 `RULESET_VERSION`。authoritative-v2 或未知版本 fail closed，不能触达旧 `applyEvents`。
- Room DO 的旧初始化、入/离席、loadout 同步、prepare/commit/snapshot 全部改经 facade；没有改变 DO SQLite 表、事务、alarm、RPC 或持久化顺序。`module:check` 递归扫描 app/worker/db/cloudflare/scripts 的 static import、dynamic import 与 require，禁止 rules 目录外直接导入 `rules/engine`；tests 的旧内核单元测试保持明确例外。
- 完整 world/campaign 复核唯一 RED 不是生产回归：致死后角色控制已按新生命周期规则移除，旧 fixture 仍以普通 `ALICE_VIEWER` 读取 former character。测试改由同一 Rules `project` 的可信 lifecycle purpose 验证 `successorRequired` 与 `tenureStatus=dead`；未放宽普通 former viewer 的 `viewerUnauthorized`。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（Legacy facade） | `npm run module:check`；`npx tsx --test tests/legacy-rules-adapter.test.mjs`；`npx vitest run tests/room-do.test.ts --reporter=verbose`；`npm run typecheck`；定向 `git diff --check` | 0 | module 边界、facade 2/2、精确 Legacy Room 9/9、TypeScript 与空白检查通过；生产侧 `rules/engine` import 唯一剩余为 facade 自身，另两项只在明确 Legacy 测试。 |
| 2026-08-27（world fixture RED→GREEN） | `npx tsx --test tests/world-campaign-v2.test.mjs` | 1 → 0 | 首次 12/13，唯一失败为 dead former character 的普通 viewer；改用 lifecycle projector 后 13/13，普通 former viewer 拒绝语义未改。 |

### 当前剩余条件与下一步

- 规格终审又发现安全暂停只有裁定、没有生产事件/入口；正在用公开 Room→Rules→project 路径补齐。随机 journal 复审还发现真实跨 Root slice 可替换风险，正在增加三类真实篡改 RED 并把合法 Activity-due Root 绑定到当前 submission。
- 两项都收口并重算 Profile 后，重新执行 Stage 4 结构/隐私组合与派生文档审查，再冻结源码；阶段 5 远端操作仍未开始。

## 全规格完成门终审与 ADR 合同补全（2026-08-27）

- 当前阶段：阶段 4 最终完整性审计，源码尚未冻结。Goal 要求每份替代规格和 ADR 都具有明确状态、验收场景与实现映射；十份 ADR 原来只有状态/决策/后果。本轮逐份加入可证伪的公开行为场景和现有生产/测试路径，没有修改或缩小冻结 `SPEC 0001`。`SPEC 0006` 的三处失效映射也改到真实 v2 model/actions/events、multiplayer implementation 与 `.ts` 评测文件。
- 文档验证：`git diff --check -- docs/adr docs/specs/0006-module-npc-and-faction-protocol.md` 退出 0；逐个映射文件存在性检查无缺失。此证据只证明文档结构和路径，不把仍缺生产语义的场景写成已完成。
- 终审发现的冻结前实现缺口：`SPEC 0004` 裁定先例事件/状态；`SPEC 0005` 隐藏现实完整候选冻结和 DO 选择；`SPEC 0006/0008` 章节级 module ref/version/hash、显式迁移与 Actor/Faction 到期优先结算；`SPEC 0011` D1 归档清空后由已有 DO 重建；`SPEC 0013` 活跃/可恢复归档 Profile 引用部署扫描；以及 `SPEC 0011` prepare/observe/commit/ack 分阶段遥测。另须补 Delivery 控制撤销的 Room 级证据、P03/P04 精确向量及动态 Ability 归档恢复后继续使用。
- 并行中的两个更早缺口仍保持未完成状态：安全暂停的 principal 私有事件/Room 入口/投递失效，以及 randomness recovery 对持久根行动绑定的严格 journal 证明。任何定向绿色都必须在这些实现合并后重算 Profile，并重跑责任 Interface 组合。

### 当前剩余条件与下一步

- 收拢安全暂停、随机 journal 与逐规格审计结果；按正式场景拆分 TDD 切片，先取得每个缺口的真实 RED，再在 Rules→Room→D1/UI 的单一权威位置修复。
- 所有切片闭合后同步规格、追踪矩阵、决策登记与本日志，并运行阶段 4 模块、隐私、投影、Legacy、随机和 Profile 组合。只有冻结提交完成后才进入已授权的远端 D1/Workers AI/部署/push 阶段。

## 安全暂停、随机 Root 绑定、D1 重建与 Profile 部署门（2026-08-27）

- 安全暂停：先前规格只有裁定，没有事件、状态、Room action 或页面入口。现 `requestSafetyPause` 在任何到期 Activity 结算前提交 principal 私有 `SafetyPauseRequested`；全桌后续世界意图/回答/装备和机械动作返回统一 `presentationUnavailable`，不改变虚构时间、HP、资源或 spotlight。只有请求 Principal 可从 `fadeToBlack | reduceDetail | skipSensitiveContent` 闭集调整并恢复；状态随 Principal 经控制撤销、角色退役和继任持续，不跟角色转移。请求 schema 不接受原因或自由文本。
- 投递失效：暂停提交同时 supersede 所有当前受控角色 Delivery；已进入 narrate 但尚未 publish 的 capability 失效，晚到敏感正文不能发布。UI 点击立即隐藏 current frame、清理待 ACK presentation，并停止/失效当前或在途 TTS。API 只从可信会话恢复 principal，经精确 authoritative-v2 路由直达 Room→Rules，不调用 KP propose/narrate。
- 随机恢复 P1：真实另一条 activity-due Root 连续 slice、同 Root 但无 `RandomnessRequested`、事件 request 与 `requests_json` 不同、以及删除 recovery root binding 的旧格式行，修复前均可错误 `committed`。现 `initialRandomnessRootActionId` 进入 recovery 且由 recovery hash 覆盖；缺 binding 只兼容 submission Root。journal 必须至少含一个请求、单一固定 Root、逐波计数与请求 JSON 完全相等，并是该 Root 已持久事件的无重复精确连续片段。
- 概率 fixture：多请求先攻崩溃恢复测试曾把合法同点 `awaitingInput` 写死为 `committed`。测试现保留原 Receipt/faces 重试断言，并在真同点时通过认证 pending answer 完成；四个崩溃点定向 4/4，不再依赖随机不平手。
- D1 清空恢复：归档 writer 原来直接信任 DO caught-up cursor；只清空 D1 事件行后，下一次归档会跳过旧前缀。现每页先用一条只读 probe 核对 genesis hash、前缀 COUNT、首尾 seq 与 cursor event hash；不匹配时先原子持久重置 DO progress，再沿既有 alarm 从 DO 连续事件分页重建。D1 从不提供 WorldState/game_states；每页最多 1 probe + 40 写，批失败、驱逐和再次清空仍 fail/retry safe。
- Profile 正式向量：补齐 P03“同 profileId 两个 hash 的 Registry 构建失败”和 P04“事件缺 ProfileRef/eventTypeVersion/previousEventHash 时 replay 拒绝”精确场景，去掉旧测试对这些编号的误占用。新增 P06 只读部署门：读取同一 D1 snapshot 的 active room 与全部 recoverable genesis，比较完整 manifest closure；引用 Adapter 被移除、active room 缺 genesis、row/genesis 不匹配均退出失败且不改写 genesis。`npm run profile:reference-gate` 从 stdin 消费 Wrangler D1 JSON；当前只用空 fixture 验证 CLI，真实远端扫描留在 Stage 5。
- canonical Profile 因安全语义升级后的当前实算引用：ruleset `sha256:d92de17bae466ff3ca4a58d25323f0a28d3b1269bb8c7201dd1a3089b0153afd`；event `sha256:635b3b47a36de6bd5b8f67923d437ea06d63baba7a148ecd5113335e0cfcd2de`；presentation `sha256:86bfdfebe7062d90f87e4add65d1d109cb14dead7b3d758e452af76c13f7457c`；projection `sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91`；delivery `sha256:cd0d684841bd43f621665dc538db35b81c25421d8b345e444681054bbc894d7e`；manifest `sha256:ccad909e3e273a2354c5a959cabe12e8382daf82cbd3ff65554d077da503ff6d`；genesis `sha256:92337145a729e89063bd94a80da08fd45adf1dfb9c824fc58acb7afc7e078051`。后续先例/隐藏现实等事件变更还会再次级联，故此处不是最终发布 hash。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（Safety RED→GREEN） | Rules safety、Room safety、Table safety 首轮定向；随后 `node --import tsx --test tests/rules-safety-pause-v2.test.mjs tests/runtime-profiles-v2.test.mjs` | 1 → 0 | RED 分别为 unsupported operation/Room action/Table projection；最终 Rules/Profile 18/18。 |
| 2026-08-27（Safety Room/Delivery） | `npx vitest run tests/safety-pause-room-v2.test.ts tests/observer-delivery-v2.test.ts`；Table 单测；`npm run typecheck`；`npm run module:check` | 0 | Room/Delivery 2 files / 10 tests；Table 14/14；类型与模块边界通过，含 in-flight publication 和 UI/TTS 失效。 |
| 2026-08-27（random binding RED→GREEN） | `tests/randomness-recovery-v2.test.ts` 四项真实篡改定向 | 1 → 0 | 四项修复前均错误 committed；修复后 integrity mismatch。randomness recovery 16/16、room retry 3/3。 |
| 2026-08-27（initiative fixture） | `npx vitest run tests/combat-room-randomness-v2.test.ts -t 'recovers a two-request initiative batch' --no-file-parallelism --maxWorkers=1 --testTimeout=30000 --reporter=verbose` | 0 | 4/4；四个随机持久化崩溃点均允许真实同点 pending 并保持原 faces/Receipt。 |
| 2026-08-27（D1 clear RED→GREEN） | `archive-do-resume-v2` 的 `rebuilds every DO event after D1 is cleared behind a caught-up cursor` | 1 → 0 | RED 仅 D1 events 3–4、DO 1–4；GREEN D1 event_json 与 DO export 1–4 逐项一致。 |
| 2026-08-27（archive 回归） | archive DO 全文件；D1 batches；archive/correction 组合；`npm run typecheck`；`npm run module:check` | 0 | 3/3、5/5、8/8；85+ events、40 写上限、原子 retry、wrong epoch、战斗/普通更正无回归。 |
| 2026-08-27（P03/P04） | `npx tsx --test --test-name-pattern='P03|P04 replay' tests/runtime-profiles-v2.test.mjs` | 0 | 2/2；Registry hash 冲突与三种事件封套缺失均 fail closed。 |
| 2026-08-27（P06） | `npx tsx --test tests/runtime-profile-deployment-gate.test.mjs`；`npm run profile:reference-gate <<< '[]'` | 0 | 4/4；CLI 空引用 fixture 输出 ok/0 rooms。真实 D1 scan 尚未执行。 |

### 当前剩余条件与下一步

- 正在并行实现裁定先例、隐藏现实候选协议和玩家叙事能动性 validator。之后仍须补章节模组版本/迁移、到期 NPC/faction plan、causal correction 新帧和分阶段 SLO instrumentation，并按审计清单补最小责任 Interface 组合。
- 新事件/Projection 语义全部完成后再统一重算 Profile、同步替代规格/矩阵/决策登记；阶段 5 的真实 D1 ProfileRef scan、迁移、Workers AI、部署、流量、冒烟、日志和 push 仍未开始。

## Room Authority 分阶段 SLO 遥测（2026-08-27）

- 根因：生产日志原来只在 `handleRoomAction` 外层记录一次 `room.action.completed`，且只保留 `withinBudget/overBudget` 桶；无法区分 `prepare/observe/commit/ack`，也没有可用于自然月 p95/p99 的毫秒样本，因此不能计算 SPEC 0011 的逐操作成功率与时延目标。
- 修改：新增 `room/authority-telemetry.ts`，在 server Adapter 边界包装四个公开 Room Authority 操作；每次调用输出固定白名单中的 operation/result、精确非负 `durationMs`、粗粒度 budget bucket、脱敏 correlation 与稳定 failure class。参数、返回投影、错误 message/stack 均不进入 serializer。返回值、异常和可选 `observe` query 原样透传；遥测 emitter 失败不能改变已经取得的权威结果。
- 生产接线：自然语言/回答/装备/安全 Action 的内部四操作走同一包装；table/voice 的直接轮询 `observeAuthoritativeRoom` 与 Delivery ACK 也走同一包装，不只覆盖测试 helper。KP 模型仍由独立 `ModelInvocationReceipt` 遥测，未被混入“不含模型”的 Authority SLO。
- 修改文件：`app/_runtime/lib/room/authority-telemetry.ts`、`telemetry.ts`、`action.ts`、`server.ts`、`tests/room-authority-telemetry-v2.test.mjs`、`tests/structured-telemetry-v2.test.mjs`。未修改 SPEC 0001、Goal、D1 schema、DO 状态或规则机械。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T09:03Z | `node --import tsx --test tests/room-authority-telemetry-v2.test.mjs`（实现前） | 1 | 2/2 RED，生产分阶段遥测模块不存在；证实不是已有粗粒度日志可满足。 |
| 2026-08-27T09:07Z | `node --import tsx --test tests/room-authority-telemetry-v2.test.mjs tests/structured-telemetry-v2.test.mjs` | 0 | 9/9；四操作各一份精确样本、query 透传、retryable/throw 分类、返回/异常不变及禁止内容扫描全部通过。 |
| 2026-08-27T09:07Z | `npm run typecheck` | 2 | 并行中的裁定先例/隐藏现实切片尚处 GREEN 中间态：`KpProposalDraft.adjudicationPrecedent` builder 未补，hidden randomness union 尚未收窄；错误均位于对应代理当前改动，分阶段遥测文件无 TypeScript 报错。已把逐项诊断发送给两位实现代理，须在其合入后重跑，不能把本次失败写成通过。 |

### 当前剩余条件与下一步

- 等待并复核三条并行 TDD 切片，消除上述中间态类型错误后重跑 typecheck/module check；随后补章节 module ref/migration、到期 Actor/Faction plan 和 causal correction replacement Delivery。
- 此实现只建立可计算真实月度 SLO 的生产样本；尚未部署，当然也没有声称已有自然月生产分位数。Stage 5 部署后须用代表性请求确认四类实际日志进入现有控制面，并在最终回执明确观察窗口边界。

## 多版本 Module Registry 与获批迁移底座（2026-08-27）

- 当前阶段：仍为 Stage 4。保持新房间默认 `black-oak-will@legacy-anchor-v1` 和其既有 hash 不变；新增 `legacy-anchor-v2` 作为同一 Story Bible 的兼容版本化发布，不修改模组真相、中文内容或现有房间 pin。
- Registry 现在同时把每个版本固定到独立 `moduleId + moduleVersion + profileHash`，`verifyAuthoritativeModuleProfile` 既重算 canonical payload，也必须命中内置 pinned hash，不能用任意自算 hash 自证。唯一获批映射为 v1→v2、只允许章节边界、明确列出保持的权威状态集合；反向、未知版本和篡改 from/to/hash 均 fail closed。
- 这只是章节绑定的可信内容底座；`ChapterStarted.moduleRef` 与 `ModuleVersionMigrated` 事件、Room 在 ActionPlan 接缝的 Registry 验证尚未完成，不能把本节写成 SPEC 0006/0008 全部通过。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T09:13Z | `node --import tsx --test tests/module-npc-v2.test.mjs`（实现前） | 1 | RED：缺 `authoritativeModuleMigration` 导出；旧单版本实现不能满足双版本/迁移合同。 |
| 2026-08-27T09:16Z | 同一命令（先固定 v2、再固定 migration canonical hash） | 1 → 0 | 最终 5/5；v1 hash 保持、v2 独立 hash、正向映射可验证、反向和篡改拒绝、Story Bible 秘密边界与 NPC 有限知识回归通过。v2=`sha256:283e0b6d…0a03`，迁移=`sha256:447f943f…7c4d`。 |
| 2026-08-27T09:17Z | 定向 ESLint；定向 `git diff --check` | 0 | ESLint 无错误（3 个生产 `.ts` 因项目 ignore 规则只报 ignored warning）；diff whitespace 检查无输出。冻结源码仍须执行全量 lint。 |

### 当前剩余条件与下一步

- 并行核心事件模型收口后，把 Registry 精确引用接到 chapter start/transition：同版本沿用、跨版本必须携带服务端验证的迁移引用并产生 `ModuleVersionMigrated`，旧章保留旧 ref；再经 replay/project 和真实 Room transaction 验证。

## 裁定先例、隐藏现实候选与玩家能动性合同（2026-08-27）

- 裁定先例：KP 的同一 `ActionPlan` 现在可携带结构化 precedent 注解；Rules 在任何 `CheckFrozen`/随机请求前提交 `AdjudicationPrecedentRecorded` 或 `AdjudicationPrecedentSuperseded`。记录固定 context fingerprint、公开/私有依据引用、能力/技能、DC、耗时、结果、作用域和适用 Profile；supersede 只接受仍活跃先例，必须列出实质差异且 fingerprint 已变化。KP 投影可见完整记录，玩家只见公开部分，归档恢复和 replay 保持一致。
- 隐藏现实候选：KP 必须一次提交完整的互斥候选集、权重和物化效果；直接物化与候选集互斥。Rules 先整体验证全部候选，任一无效即无事件、无随机；合法集合在同一 Root Action 内以 `1d(sum weights)` 冻结选择，记录 `DiceRolled` 与仅内部可见的 `HiddenRealityCandidatesFrozen`，只提交获选候选的权威物化事件。多波 DO journal、崩溃点和驱逐恢复复用既有随机权威链，未选候选不进入五类玩家投影、错误、Delivery 或恢复输出。
- 玩家能动性：所有 KP narration 改为 v3 结构，必须逐条声明 `agencyClaims` 的 subject、claim kind 与 frozen-basis refs。玩家主体只允许 `committedObservableAction` 和 `sensoryConsequence`；思想、情绪、未承诺对白与下一行动等闭集 claim 均在 adapter、Action 和 DO 三处确定性拒绝，依据必须绑定冻结投影。此接缝不做自然语言关键词扫描；若模型故意把文本错误标注为允许种类，属于结构化模型合同违约而非机械层 NLP 猜测，Stage 5 的模型评测仍须覆盖。
- 修改集中在 `app/_runtime/lib/kp/` 的 authoritative schema/policy/helpers、`app/_runtime/lib/room/` 的 proposal/action/DO 接缝，以及 `app/_runtime/lib/rules/v2/` 的 model/events/actions/projector/compound 路径；新增 `tests/adjudication-precedent-v2.test.ts`、`tests/hidden-reality-room-v2.test.ts`，并扩展相应 adapter、Rules、observer、randomness 和 Profile fixtures。没有修改或缩小 SPEC 0001。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（precedent RED→GREEN） | Room precedent、KP adapter、Rules compound 定向测试；随后 `npm run typecheck`、`npm run module:check`、`git diff --check` | 1 → 0 | Room 1/1、KP 3/3、Rules 2/2；事件顺序、私密投影、supersede 约束、归档恢复通过。 |
| 2026-08-27（hidden reality RED→GREEN） | Rules/Room hidden candidate、randomness recovery、KP/Profile/fixture 组合；随后类型与模块边界 | 1 → 0 | Rules 1/1、Room 1/1、随机恢复 16/16、KP/Profile 25/25、fixtures 39/39；坏候选零副作用、崩溃后不重掷、未选候选零泄露。 |
| 2026-08-27（agency validator RED→GREEN） | KP adapter/action、observer DO、structured telemetry 定向组合；随后 `npm run typecheck`、`npm run module:check` | 1 → 0 | adapter/action 24/24、observer 9/9、telemetry 7/7；禁止 claim、伪造 basis 和绕过三道接缝均 fail closed。 |
| 2026-08-27（合并后全量类型） | `npm run typecheck -- --pretty false` | 0 | 先前并行中间态的两个 TypeScript 错误均已消除；三条事件/随机/叙事合同在共享源码状态下通过全量类型检查。 |

### 当前剩余条件与下一步

- 这些语义改变了 Event/Projection/Presentation 等 canonical 文档；当前实算 ruleset=`sha256:7651d581…4af0`、event=`sha256:3f1d9537…a67`、manifest=`sha256:496da17f…8051`、genesis=`sha256:b34ffa38…a71f`，仍不是发布冻结值。章节迁移、ActorPlan 和 correction replacement Delivery 完成后再统一重算并跑完整 Profile 组合。
- 正在以三个互不改生产代码的 RED 测试切片冻结章节版本迁移、到期角色计划和因果纠正替代帧的真实 Room 合同；RED 证据复核后再按共享文件顺序实施，避免并行覆盖。

## 复合行动 NPC fixture 因果修正（2026-08-27）

- 症状：precedent/hidden reality 合并后，`tests/compound-action-v2.test.ts` 的 NPC `resolveNoncombatSave` 提案返回 `needsKp`。诊断首先补齐 canonical save 计划后，Rules 继续明确报告 frozen cost/effect 不可用。
- 根因：该测试初始化的动态 NPC 没有编译后的 2014 ability statistics，却让夹具要求该 NPC 自行执行机械豁免；生产规则正确拒绝不完整/不可冻结的机械计划。这个测试原本只验同一 Root Action 对动态事实、NPC 计划、场景问题与玩家检定的原子提交，不需要发明 NPC 数值或放宽校验。
- 修改：NPC 草稿保留非机械计划并把 `mechanicalProposal` 设为 `null`；随机承诺与检定事件预期由两份改为真实的一份玩家检定，同时移除会在失败输出中展开完整 KP truth 的调试捕获。生产代码未改。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T09:31Z | `npx vitest run tests/compound-action-v2.test.ts --reporter=verbose --testTimeout=30000` | 0 | 1/1；同一生产 KP draft 仍原子提交动态事实、NPC 非机械计划、场景问题与玩家检定，只有可由人物卡冻结的玩家检定消费随机。 |

### 当前剩余条件与下一步

- 该 GREEN 只修正测试前提，不替代 SPEC 0006/0008 的结构化到期 Actor/Faction plan；后者仍须由真实 Room 在受影响玩家意图前结算，并覆盖驱逐恢复、有限知识、alternate target 和不自动攻击/pass。

## Stage 4 三条剩余主干的真实 Room RED（2026-08-27）

- 章节绑定首因：Campaign genesis 已固定 moduleRef，但 opening Chapter 与 `ChapterStarted` 没有绑定；ActionPlan 闭合 schema 也不接受迁移引用，Room 无法校验 Registry 并产生显式迁移事件。独立测试冻结 v1/v2/migration 三个 pinned hash、同版继承、唯一获批 v1→v2、旧章保留与所有篡改零事件。
- ActorPlan 首因：`NpcActionProposal` 的严格 validator 只接受旧五字段，完整 premise/有限知识/next step/resources/Activity/due-or-trigger/trace/alternate target 在进入 Rules 前已 fail closed；现有 `NpcPlanFormed` 事件也只能保存 goal/refs/nextAction/resources。第一条 tracer 先固定真实 Room 能完整固化且玩家不见秘密，GREEN 后再增加“到期计划先于受影响玩家意图”的二阶段 Room 编排、驱逐恢复和禁止自动 attack/pass。
- O16 首因：`commitCorrection` 已在一个 DO transaction 中正确 supersede 旧 Receipt/Delivery，并切换新 active branch；但 correction outcome 没有以更正前状态、新状态、更正事件与目标 actor 冻结 replacement `DeliveryPlan`，所以事务外 KP 没有可重试的新分支专属投影可叙述。测试同时证明旧正文立即不可取、错误分支秘密消失、旧 Receipt superseded，唯一 RED 是 plan 缺失。
- 新增测试仅为 `tests/chapter-module-migration-v2.test.ts`、`tests/actor-plan-room-v2.test.ts`、`tests/correction-delivery-o16-red.test.ts`；三个 RED 代理都未改生产、文档、共享 helper 或提交。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（chapter RED） | `npx vitest run tests/chapter-module-migration-v2.test.ts --reporter=verbose --testTimeout=30000` | 1 | 4/4 按预期 RED：opening chapter `moduleRef=undefined`；获批迁移也被旧 ActionPlan schema 退回 `needsKp`；反向/任意/篡改没有可授权路径。 |
| 2026-08-27（ActorPlan RED） | `npx vitest run tests/actor-plan-room-v2.test.ts --reporter=verbose --testTimeout=30000` | 1 | 真实 `handleRoomAction + ROOMS` 返回 `needsKp` 而非 committed；首个拒绝位于 `npcActions()` 的旧 exactKeys。 |
| 2026-08-27（O16 RED） | `npx vitest run tests/correction-delivery-o16-red.test.ts --reporter=verbose --testTimeout=30000` | 1 | 旧帧/Receipt/秘密失效部分全通过；唯一失败为 `corrected.deliveryPlan` 是 `undefined`，精确定位 replacement freeze 缩口。 |
| 2026-08-27（三个新测试） | 定向 `git diff --check` / no-index whitespace 检查 | 0 | 三个独立测试文件无空白错误；没有借 RED 改生产行为。 |

### 当前剩余条件与下一步

- 章节迁移已进入最小 GREEN；完成并复核后，再串行实现 ActorPlan 固化及其 due preflight，最后实现 O16 replacement Delivery，避免三条主线同时修改 kp/Rules/Room 共享文件。
- 全部 GREEN 后仍需按终审清单补最小责任 Interface 组合并统一冻结 Profile；当前仍未进入 Stage 5，也未进行远端 D1、Workers AI、部署或 push。

## Chapter ModuleRef 与获批版本迁移 GREEN（2026-08-27）

- opening chapter 现在从已验证 genesis 固定精确 `moduleRef`；`ChapterStarted` 必须携带当前 Campaign ref，同版本 transition 继承而不重解释旧章。旧 Rules genesis fixture 的兼容规范化只允许从同一已验证 genesis ref 补齐缺省字段，已存在但不合法/不一致的 ref 仍 fail closed。
- 公共 KP ActionPlan 只可声明 `moduleMigration:{fromModuleRef,toModuleRef,migrationRef}` 三个引用。Room adapter 把它们视为查找主张，独立调用内置 Registry 取得 pinned mapping、重算校验并逐字段比对；随后删除来宾字段，注入不可由公共 schema 提交的内部 `verifiedModuleMigration`。反向、未知、自算、任一 hash/字段篡改均返回 `profileIntegrityMismatch` 且零事件。
- Registry 的 Web Crypto 校验发生在事务外；await 后 DO 重放最新权威 head，Rules 再检查 current Campaign binding，最终 transaction 仍核对 head，因此并发章节变化不会拿旧校验结果提交。
- 唯一获批 v1→v2 在同一 Root Action 中严格生成 `ChapterConcluded → ChapterContinuityRecorded → ModuleVersionMigrated → ChapterStarted`。migration event 只切换 Campaign current ref；旧 chapter 保留旧 ref，新 chapter 固定 v2；KP module projection 随 Campaign 当前绑定读取相应 Registry 版本。
- 修改：KP type/schema/helper、Room proposal-adapter/DO、Rules model/actions/compound/campaign action+event/correction/normalization，以及 `tests/chapter-module-migration-v2.test.ts`。没有修改 SPEC 0001、Goal、远端或持久化 schema。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（Chapter GREEN） | `npx vitest run tests/chapter-module-migration-v2.test.ts tests/compound-action-v2.test.ts --reporter=verbose --testTimeout=30000` | 0 | 5/5；opening/同版/获批迁移/反向或任意/哈希篡改真实 Room 路径通过。 |
| 2026-08-27（相关回归） | module/NPC/world/Profile/Rules compound 组合 | 0 | 61/61；旧 world fixture 首次因缺 ref 失败后，只在规范化 Adapter 从 genesis 精确补齐，最终全绿。 |
| 2026-08-27（KP schema） | authoritative KP adapter 组合 | 0 | 10/10；公共 migration 字段闭合验证、内部字段不可自报及其余提案无回归。 |
| 2026-08-27（结构门） | `npm run typecheck -- --pretty false`；`npm run module:check`；`git diff --check` | 0 | 类型、单一 Rules/Room 接缝和空白检查均通过。 |

### 当前剩余条件与下一步

- ActorPlan 第一切片正在把完整 premise/有限知识/计划步骤/资源/Activity schedule/trace/alternate target 固化为同一 Rules 事件与私有状态；这一步 GREEN 后再实现可驱逐恢复的 due stage 编排，不能把“能保存计划”误写成“已满足到期优先”。
- O16 已有 replacement plan RED 与完整幂等设计，待 ActorPlan 共享文件稳定后串行实现。之后统一重算 canonical Profile 并执行 Stage 4 完整责任 Interface 审计。

## ActorPlan 权威形成与私密持久化 GREEN（2026-08-27）

- KP 提案新增闭合 `ActorPlanProposal`：premise refs、next step、resources、唯一 Activity、且仅一个 fiction-time due 或已提交 trigger、可察觉 trace template 与 alternate target。公共提案不能自报 actor/revision/status/chapter/module；Rules 从当前权威 NPC、Campaign 与 Chapter 派生这些字段。
- Rules 逐项证明 premise/trigger knowledge 由该 NPC 持有，资源来自其自身或已物化且包含该 NPC 的 Faction，alternate target 是已存在或同事务物化的实体/场景；plan/activity/trace ID 在同一 proposal 唯一且不能与既有权威状态冲突。非法值返回 `invalidRulesInput`/`npcKnowledgeInsufficient`，不靠 KP 全知补齐。
- 合法计划在一个 Root Action 内先提交完整私密 `NpcPlanFormed`，再提交绑定 planId 的私密 `ActivityStarted{completion:{kind:'actorPlan'}}`；fold 交叉核对 NPC、Activity kind/duration、chapter/module pin 和 trace 未先物化。玩家 projector 不公开 NPC plan、premise、alternate reason 或 Activity 私密内容。
- 旧六字段 `NpcPlanFormed` 保持显式 legacy union，不被新解释器静默重写；本切片没有实现 due 检测/执行、Faction plan 或阶段 journal，不能据此宣称 SPEC 0006 验收 5–6 已完成。
- 修改：`kp/authoritative-types.ts`、`authoritative-helpers.ts`、`authoritative-policy.ts`、Rules `model.ts`、`campaign-events.ts`、`compound-actions.ts`，以及 `tests/actor-plan-room-v2.test.ts`；未新增 Room/D1 第二状态表。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（formation GREEN） | `npx vitest run tests/actor-plan-room-v2.test.ts --reporter=verbose --testTimeout=30000` | 0 | 1/1；真实 `handleRoomAction → Room DO → Rules → archive/observe` 固化完整 plan/Activity，玩家 surface 不含 knowledge ref、plan id 或 alternate 原因。 |
| 2026-08-27（相关规则回归） | KP adapter + Rules compound + world campaign + module NPC + Runtime Profile | 0 | 71/71；旧 NPC plan、模块绑定、世界连续性与 Profile integrity 无回归。 |
| 2026-08-27（Room/迁移回归） | Room compound + chapter moduleMigration | 0 | 5/5；ActorPlan 改动未覆盖或放宽 `ModuleVersionMigrated` 三个拒绝向量。 |
| 2026-08-27（结构门） | `npm run typecheck`；`npm run module:check`；`npm run profile:reference-gate <<< '[]'`；tracked/untracked diff check | 0 | 类型、唯一权威入口、空远端引用 fixture 和 whitespace 均通过；首次无 stdin gate 的 `invalidGateInput` 是 CLI 正确拒绝，补合同要求的空 JSON 输入后通过。 |

### 当前剩余条件与下一步

- 先修 Chapter 只读复审发现的四项：direct `step` 内部迁移伪造、await 跨 scene 章节竞态、旧章 ref 不一致及 canonical Profile 级联（Profile 最终 hash 待所有事件语义完成统一冻结）。
- 然后给 ActorPlan 增加真实 due tracer：受影响玩家意图前的有限知识 KP 阶段、显式 execute/revise/defer/cancel、同一外层 Root 的恢复 continuation、模型失败零自动 attack/pass/时间推进，以及两个驱逐点 exactly-once。

## ActorPlan 到期优先 Room 编排 RED（2026-08-27）

- 独立测试先通过真实 Room 形成上一节的 scheduled plan，再提交受同一 scene/timeline 影响的玩家 intent。它固定同一 submission/root 的 KP 阶段顺序必须是 `dueActorPlan → playerIntent`；due projection 只能含单一 NPC Viewer 与该 plan 的有限知识，不能复用玩家/全体 NPC/Module truth 的混合 KP 投影。
- KP 必须显式返回 `execute | revise | defer | cancel`；当前 RED 先使用 execute，并要求 `NpcActionCommitted` 与按 trace template 产生的公开事实先于玩家 `FeasibilityRuled`，随后才以更新投影处理原意图。alternate target 只是 KP 可选许可，不允许自动选第一个目标。
- 第二向量让 due KP 模型失败：稳定状态必须不产生 NPC action、Attack、pass、TurnEnded、ActivityCompleted、玩家事件或虚构时间推进，并返回可重试的 `modelTransient`。当前实现既没有 due phase，也把普通 proposal 的两次机械诊断重试误当作两次 player phase。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（due RED） | `npx vitest run tests/actor-plan-due-room-v2.test.ts --reporter=verbose --testTimeout=30000` | 1 | 2/2 精确 RED；阶段实际为 `[playerIntent, playerIntent]` 而非 `[dueActorPlan, playerIntent]`，故障向量得到 `needsKp` 而非 `modelTransient`。 |
| 2026-08-27（formation 前置） | 同文件 formation setup 及 `tests/actor-plan-room-v2.test.ts` | 0 | 完整 plan 仍可真实形成；RED 只定位 Room due orchestration 缺失，不是形成协议回归。 |

### 当前剩余条件与下一步

- Chapter 三项复审修复完成后，按此 RED 增加最小持久 stage/continuation：Rules 决定 eligible plan 与 scope closure；Room 保存外层原意图和 due stage；Action 有界循环。先转绿 execute/模型失败，再补两个驱逐点、显式 alternate、Faction agent 与 trigger/chapter pin。

## Chapter 迁移复审的三个安全闭包（2026-08-27）

- Direct `step`：复审证明公共 Rules Interface 可伪造完整 `verifiedModuleMigration` JSON 并迁往任意 target。现抽出无 I/O 的 `module/migration-registry.ts`，Module authoritative 与 Rules 共享唯一 pinned descriptor；Room 仍额外执行 Web Crypto 内容哈希验证，Rules 则逐字段核对 module/from/to/migration/ruleset/policy/preserved state。完整 JSON 不再能自证。
- Registry await 竞态：迁移提案在异步验证期间，另一 scene 原可先切章；旧调用随后从最新章重新推导 fromChapter 并再次提交。现只对“已绑定 module migration”保存校验前全局 event head；await 后任何变化统一 `scopeConflict`，普通非迁移的跨 scene 并发仍由原 scene scope 允许。
- Genesis normalization：缺失 campaign/chapter ref 可以从已验证 genesis 精确补齐；显式存在的 ref 必须与 genesis 一致。重签名但塞入攻击者 chapter ref 的 genesis 现在 `invalidGenesis`，不会被“格式合法”掩盖。
- Profile/EventSchema 级联没有在中间源码上执行。最终冻结时一次更新 Ruleset/EventSchema/Projection/Delivery/Manifest canonical leaves，并保留旧 manifest/interpreter Adapter；待更新清单已由复审明确记录。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（direct step） | chapter 定向 direct `step` 伪造向量 | 1 → 0 | RED 任意 attacker-v99 target 被 committed；GREEN target、migrationRef、moduleId、hash 四类伪造均拒绝且零事件。 |
| 2026-08-27（await race） | 两 scene Registry-await 竞态真实 Room 测试 | 1 → 0 | RED Bob 先切章后旧迁移仍 committed；GREEN 旧调用 `scopeConflict`，竞争章与事件保持唯一。 |
| 2026-08-27（normalization） | world-campaign 重签 genesis 向量 | 1 → 0 | RED 显式冲突章 ref 被 replay；GREEN 只有缺失值可补齐，显式冲突 `invalidGenesis`。 |
| 2026-08-27（回归/结构） | chapter/module/world/Profile/Rules；chapter/ActorPlan/Room；typecheck/modulecheck/diff | 0 | 62/62、6/6、1/1、9/9；类型、模块边界、普通跨 scene 并发与 whitespace 全通过。 |

### 当前剩余条件与下一步

- Chapter 运行时边界现可冻结；canonical Profile 仍明确待最终事件/投影/Delivery 语义齐备后版本化。当前进入 ActorPlan due GREEN，不把两个已知 RED 写成通过。

## Stage 4 责任 Interface 终审的首批硬缺口（2026-08-27）

- 本轮只读对照 Goal 完成门、SPEC 0002–0013、当前生产入口与既有测试；没有把“已有类型/单元函数”当成真实 Room 证据，也没有提前进入 Cloudflare/Wrangler 阶段。
- Delivery 通用恢复缺口：普通 Room Action 在世界结果已提交、`publishDelivery` 已写入但 RPC 响应丢失后，会从缓存的同一 DeliveryPlan 再次调用 narration；若模型返回不同措辞，DO 正确拒绝不同 publication hash，但外层会永久表现为 `deliveryPending`。O08/O15 与 O16 必须共用一个持久 `open | published | superseded` 状态查询，在叙述前跳过已完成/已失效 plan，不能只给更正做旁路。
- Campaign continuity manifest 仍未覆盖 Actor/Faction plan 状态；precedent 清单也只含旧 meaningful-failure/retry-change，没有新 `adjudicationPrecedents`。最终须把它们纳入章节连续性/迁移的显式 preserved-state 合同，并用真实 chapter transition/restore 证明。
- 当前完整 ActorPlan 只允许 NPC 已持有的 knowledge refs 作为 premise；关系、承诺和债务虽可在 NPC projector 中观察，却还不能成为计划前提。Faction 目前只有一次性 `FactionPlanAdvanced`，没有与 ActorPlan 同等级的形成、修订、取消、到期和行动闭环。
- 归档 alarm 目前只有失败 telemetry；缺少成功样本和可计算 lag 的非内容 measurement，故 SPEC 0011 的 archive lag SLO 尚无生产可观测证据。
- canonical Profile 文档/hash 仍未冻结 ModuleRef/迁移、ActorPlan/due 和 correction replacement/retry 新语义。必须等这些事件与投影稳定后一次版本化 canonical leaves、manifest、genesis 与 Registry/旧 Adapter，不能在中间源码状态反复伪造发布 hash。

### 当前剩余条件与下一步

- 先完成 ActorPlan due 的 Rules selector、有限 NPC 投影与 Room 两阶段恢复 journal；随后接管共享 `authority-store`/DO/Action 文件，以通用 publication-status seam 实现 O08/O15/O16，并为更正生成不含失效分支秘密的专属 delta。
- 终审代理仍在收敛最小垂直测试组合；其完整矩阵返回后再按实现缺口优先级执行，避免补重复源码正则或同义单测。

### 完整只读审计回执

- 已确认不再重复补测的充分证据：统一事务/战斗/触发、DO 随机与崩溃恢复、分页归档与重建、基础多人/成长/章节/生命周期、投影/ACK/覆盖/HTTP 隐私/安全暂停、31 轮离线 KP 评测、Legacy/Profile/服务路由。最终只须在冻结 SHA 上按风险组合重跑。
- 仍需真实实现或责任 Interface 证据：
  - SPEC 0003/0011：真实 Room `forwardCompensation`；十二错误类完整代数；archive success/catch-up/lag telemetry。
  - SPEC 0004/0005/0006/0007：v2 唯一物品并发、长休中断跨驱逐、冻结危险与 hidden candidate 不随 HP 重算、信件阅后销毁/固定接收者、动态能力跨归档新 DO、同事务 passage+scene+move、合法空房、私密槽控制权转移/撤销。
  - SPEC 0005/0006/0008：社会关系/承诺/债务成为 ActorPlan 前提；完整 Faction plan lifecycle；retired→NPC 有限知识行动；continuity manifest 纳入 NPC/Faction plans 与 adjudication precedents。
  - SPEC 0008/0009：成长跨驱逐 exactly-once 及 D1 静态卡写失败不回滚 DO；错误死亡→继任行动→真实 Room correction；胜利/不可逆失败/明确放弃三类结局；卡住时 reorient→existing opportunity、现实等待不惩罚。
  - SPEC 0010：O05/O06/O08/O11/O12/O15 与上述纵切合并；O13/O18 还依赖 Stage 5 真实模型、HTTP、日志和 D1 证据。
  - SPEC 0013：最终事件/continuity/delivery 语义稳定后，统一 canonical profile/manifest/genesis/Registry/Adapter 与动态能力恢复向量。
- 规格冲突待显式决议：SPEC 0005 §12.7 字面要求“同一知识错误同时有前向补偿与因果分支”，但知识影响按 SPEC 0011 必须走因果分支，不能伪造可删除知识的前向修复。最终应以 SPEC 0001 的不秘密改史、有限知识和可审计更正不变量写一份 ADR/替代验收映射，而非放宽 Rules。
- 最小新增测试面：扩展 ActorPlan due 与 observer delivery/O16；新增一个 `stage4-world-campaign-vertical-v2` 合并世界连续性向量；只在 `archive-correction`、`structured-telemetry`、`runtime-profiles` 补各自唯一缺口。已派发世界纵切 RED，只改测试、不改生产。

### 知识更正的规格一致性决议

- 使用 `domain-modeling` Skill 对照根 glossary、SPEC 0001/0005/0010/0011 与现有 correction fold，新增 ADR 0011，并在 `CONTEXT.md` 固定“知识更正”一词。没有修改或缩小任何 SPEC。
- 决议：有权取得、`publiclyObservable` 且没有后继 Root/玩家选择影响的错误知识可用显式前向补偿；活动投影移除错误内容并展示说明，但原取得事件/Receipt/更正永久可审计，也不声称现实玩家遗忘。私人/共享秘密误授、原本无资格取得或已影响后继选择时必须打开因果分支；Room 请求的 `errorKind` 不能自报降低策略。
- 验收映射因此是两个同类不同资格的真实 Room 场景，而不是让同一秘密既“前向删除”又因果分支：公开错误知识产生 `CorrectionApplied`；秘密误授产生 `CorrectionBranchOpened → BranchActivated`，两者都要经过 observe、归档恢复及安全 replacement Delivery。
- 修改文件：`CONTEXT.md`、`docs/adr/0011-public-knowledge-correction-versus-secret-causal-branch.md`、本日志。实现和 RED/GREEN 尚未执行，不能把决议写成行为已通过。

## ActorPlan 到期优先编排第一阶段 GREEN（2026-08-27）

- 根因闭包：通用 `settleDueActivityBeforeInput` 原会把 `completion.kind='actorPlan'` 当普通 Activity 自动完成，玩家请求随后落入普通 KP 诊断；系统既没有有限知识决策阶段，也无法保证 NPC action 在受影响意图前发生。现由专用 Rules selector 选择同 scene/timeline 最早 eligible plan，普通 Activity preflight 跳过该类型。
- Rules 新增内部 `dueActorPlanFor` 投影与确定性 child root。投影只含单一 NPC、该 plan、NPC 自身有限知识及合法目标，不含玩家原始 input、玩家私人知识或全体 NPC/Module truth。execute 产生 `NpcActionCommitted → CanonicalFactDeclared(trace) → ActivityCompleted`，payload 以 `causedByRootActionId` 绑定外层玩家 Root；fold 将 plan 置为 resolved。
- Room 新增 `authority_action_stages(prepared_action_id, submission_id, phase, target_id, child_root_action_id, status, proposal_hash, result_json)`，并在 submission continuation 持久化 canonical original intent。due commit 后同一事务把 prepared/action stage 推进到 `playerIntent`，重新从更新后的权威状态投影；Action 以有界 continuation 继续原意图。
- due decision schema 已闭合为 `execute | revise | defer | cancel`，但本切片只有 execute 有领域效果，其余明确拒绝；不能据此声称生命周期完整。模型异常返回 `retryableFailure/modelTransient`，且无 NPC action、攻击、pass、TurnEnded、ActivityCompleted、玩家事件或 Fiction Time 推进。
- 修改：Rules `actor-plans.ts`、`model.ts`、`projector.ts`、`campaign-actions.ts`、`campaign-events.ts`；Room `authority-types.ts`、`authority-store.ts`、`durable-object.ts`、`action.ts`；`tests/actor-plan-due-room-v2.test.ts`。未提交、未改 Goal/Profile。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（due GREEN） | `npx vitest run tests/actor-plan-due-room-v2.test.ts ...` | 0 | 2/2；execute 先于 player intent，模型失败零事件/零时间。 |
| 2026-08-27（相关回归） | formation/KP/compound/world/chapter/Room Vitest；Node/tsx KP/compound/world | 0 | 6 files / 22 tests 与 52/52 通过。 |
| 2026-08-27（结构门） | `npm run module:check`；`npm run typecheck -- --pretty false`；`git diff --check` | 0 | 单一 Rules/Room 接缝、类型与 whitespace 全通过。 |

### 当前剩余条件与下一步

- ActorPlan 仍须真实实现 revise/defer/cancel、alternate target、trigger due、两个 eviction/retry 点、Faction plan/resource、社会状态 premise、retired→NPC 与 chapter/module pin 向量。
- 共享 Room 文件现已交回主任务；接下来实现通用 publication-status seam，先关闭普通 O08/O15 响应丢失，再在同一机制上冻结/发布 O16 correction replacement plan。

## Stage 4 世界/长团五向量真实责任 Interface 补证（2026-08-27）

- 新增 `tests/stage4-world-campaign-vertical-v2.test.ts`，只经 `handleRoomAction + env.ROOMS` 与公开 observe/archive/retry 接缝；没有直接改 WorldState、事件、Audience 或内部表。五条审计向量在现状源码已全部 GREEN，因此没有为补证修改生产：
  1. 同一 Root 原子注册此前不存在的 location + passage，并立即 `CharacterMoved` 到新 scene；
  2. 合法空房只固化“为空”的结果，不强制生成 Artifact、Knowledge、Encounter、Milestone、XP 或 Resource 奖励；
  3. 两个提案以屏障同时基于争夺前投影竞争同一唯一 Artifact，恰好一个 committed、全日志仅一条 `ArtifactAcquired`；
  4. Alice/Bob 各自阅读同一信件后将 Artifact destroyed，两人的结构化知识仍在；后来移入的 Carol 不回补，归档只有两条对应 `KnowledgeAcquired`；
  5. 在 `afterRandomnessCandidateCommit` 真实 checkpoint 中断后，另一 scene 的 Bob HP 改变；retry 不再调用 propose，HiddenReality frozen/materialized/dice 各唯一一份，选中 Definition 与冻结参数完全相同，不按 HP 重选/缩放。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（world vertical） | `npx vitest run tests/stage4-world-campaign-vertical-v2.test.ts --reporter=verbose --testTimeout=30000` | 0 | 5/5；上述动态通路、空房、唯一物并发、阅后销毁/不回补、HP 改变后的冻结 hidden candidate 全通过。 |
| 2026-08-27（test diff） | `git diff --check -- tests/stage4-world-campaign-vertical-v2.test.ts` | 0 | 新垂直测试无 whitespace 错误；运行中的 checkpoint 日志是故障注入预期，进程 exit 0。 |

### 当前剩余条件与下一步

- 终审先前列出的 SPEC 0004 唯一物争夺/危险冻结、SPEC 0005 信件销毁、SPEC 0006 动态通路/空房、SPEC 0010 O05/O06/O11 对应事实边界，现已有同一真实 Room 垂直证据；冻结 SHA 只需重跑，不再补同义测试。
- 长休中断跨驱逐、动态能力归档新 DO、成长/D1、角色/阵营计划、三类结局与投递恢复仍未由本文件覆盖。

## O08/O15/O16 可恢复投递与更正替代帧 GREEN（2026-08-27）

- 症状与首因：普通行动在 `publishDelivery` 已原子写入、RPC 响应随后丢失时，缓存 outcome 的 retry 会重新调用 narration；更正事务虽能失效旧 Receipt/Delivery 并切换分支，却没有冻结新分支专属 DeliveryPlan，也没有事务外可重试的更正发布入口。另一个真实生产接缝是 `withRoomAuthorityTelemetry` 没有透传新状态查询，测试内的幂等能力在线上代理后会消失。
- 通用修复：Room Authority 增加只接受 `publishCapability` 的 `deliveryPublicationStatus`，持久状态严格为 `open | published | superseded`；较新观众水位会把未发布旧 plan 原子 tombstone。Action 在任何 narration 前查询状态，published/superseded 直接返回；cached committed/concluded outcome 也重新进入同一 publication continuation。零 audience 的 plan 仍须发布空 frames 以完成阶段，不能永久保持 open。
- 更正修复：`PublicReceipt`/archive reference 保存可信 `actorCharacterId`；Rules correction 只绑定该 Receipt 的主体。`commitCorrection` 从更正前重放状态、新 active state、更正事件和目标 actor 冻结 replacement plan，并在同一事务中 supersede 旧 Receipt/Delivery、保存新 Receipt/plan/outcome。因果分支更正的 committed range 可跨 `BranchActivated` 保持同一 correction Root；公共 delta 只描述当前安全字段与显式更正说明，不序列化失效分支的 before 值、旧地点或错误秘密。
- 恢复入口：新增 `handleRoomCorrection`，模型失败、发布响应丢失和再次 retry 都复用同一 correctionId/plan/publication status。`runAuthoritativeRoomCorrection` 是唯一生产 server-only 接缝，能力来自 `roomServiceCapabilities().correction`，未暴露玩家 API；模型与完成结果均走固定字段遥测。普通行动的遥测代理也透传 status/publish，不记录 capability、frame 或投影内容。
- 修改：Rules `model.ts`、`events.ts`、`actions.ts`、`projector.ts`；Room `authority-types.ts`、`archive.ts`、`authority-store.ts`、`durable-object.ts`、`action.ts`、`authority-telemetry.ts`、`server.ts`；新增/扩展 delivery/correction/telemetry 测试。没有修改 SPEC、Goal、远端、D1 schema 或部署配置。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（publication RED） | `npx vitest run tests/delivery-publication-retry-v2.test.ts ...` | 1 | 2/2 按预期 RED：响应丢失 retry 未查询 status；已被新回应取代的旧 plan 仍调用 narration。 |
| 2026-08-27（O16 RED→GREEN） | `npx vitest run tests/correction-delivery-o16-red.test.ts ...` | 1 → 0 | RED 无 replacement plan；GREEN Alice/Bob 获得新分支帧、Carol 无 audience，旧 slot/Receipt 失效，错误秘密和旧正文不进入新帧。 |
| 2026-08-27（correction recovery RED→GREEN） | `npx vitest run tests/correction-delivery-retry-v2.test.ts ...` | 1 → 0 | RED 尚无 handler；GREEN 模型失败后 correction 已提交且 pending，发布成功但响应丢失只写一次，第三次不叙述/不发布，frame 与 archive event 集合不变。 |
| 2026-08-27（通用投递组合） | correction/delivery 三文件 Vitest | 0 | 4/4；普通响应丢失、旧 plan supersede、更正替代帧及更正三段恢复同时通过。 |
| 2026-08-27（遥测代理 RED→GREEN） | `node --import tsx --test tests/room-authority-telemetry-v2.test.mjs` | 1 → 0 | RED status 方法丢失；GREEN 3/3，status/publish 原样透传且零内容日志。 |
| 2026-08-27T11:16Z | correction/archive/observer/delivery Vitest + voice race Node | 0 | 6 files / 21 tests 与 2/2 通过；归档恢复、战斗 correction、observer single-slot、ACK/覆盖/晚到 narration 无回归。 |
| 2026-08-27T11:15Z | `npm run typecheck && npm run check:runtime-module && git diff --check` | 1 | Typecheck 已 exit 0；第二项脚本名写错，npm 明确报 `Missing script: check:runtime-module`，后续项未执行，不计为产品失败。 |
| 2026-08-27T11:16Z | `npm run module:check && git diff --check` | 0 | 正确脚本验证唯一 Rules/Room 权威边界，whitespace 通过。 |

### 当前剩余条件与下一步

- O08/O15/O16 的通用 publication continuation 与 server-only correction 接缝已有责任 Interface 证据；最终冻结 SHA 只需纳入完整门重跑。公开知识 forward-compensation 的 ADR 映射仍须一条真实 Room 向量，不能用本节的秘密因果分支替代。
- 当前并行完成 Actor/Faction plan 生命周期与长休跨驱逐 RED；其后补 continuity manifest、动态能力 archive restore、成长/D1、错误死亡到更正、三类结局、归档成功/lag 遥测和最终 Profile 冻结。

## 公开知识前向补偿的真实 Room 闭环（2026-08-27）

- RED：由 ActionPlan 对一个既存 `visibility:public` canonical fact 执行公开感官读取，知识原被 fold 成 `private`；即使改为 `publiclyObservable`，通用 ActionPlan 自动生成的 action-basis Definition/CanonicalFact 与 SceneQuestion 也让 correction 一律判为 causal branch。`errorKind` 没有参与策略，失败来自 Rules 自身保守闭包。
- 修复：`SensoryEvidenceAcquired` 只在其事实本身是 `visibility:public` 时由 Rules 派生 `publiclyObservable`，KP 不能自报该升级。Correction 仍要求无 downstream Root，且新增知识必须是当前记录、由受影响事件取得、before 为 null；只有存在这种公开知识时，才允许同 Root 自动生成且可精确识别的 `fact:action-basis:<root>` Definition/CanonicalFact、`scene-question:<root>` 和 fiction-time 作为同一前向补偿闭包。私人/共享知识、任一其他世界效果、动态 location/NPC/item/faction/combat 状态或任何后继 Root 仍强制 causal branch。
- 真实闭环：目标知识在更正前投影为 `publiclyObservable`；`handleRoomCorrection` 返回 `forwardCompensation` 且 active branch 不变，目标 Receipt/旧 Delivery 原子 supersede，新安全帧发布；当前 knowledge 投影移除错误转写但保留原公开事实，更正事件为 `CorrectionApplied` 而非 branch；archive 不含 narration，恢复到全新 DO 后 read model 等价、Delivery 为 none、错误内容不回生。
- 修改：`campaign-events.ts`、`correction.ts`、`tests/archive-correction-v2.test.ts`；遵循 ADR 0011，没有修改或缩小 SPEC。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（公开知识 RED） | archive correction 单向量 | 1 | 第一 RED 为 visibility 实际 `private`；派生公开后第二 RED 仍是 `causalBranch`，精确定位自动 action scaffolding 的 correction effect 分类。 |
| 2026-08-27T11:30Z | `npx vitest run tests/archive-correction-v2.test.ts -t 'forward-compensates public acquired knowledge' ...` | 0 | 1/1；公开知识前向补偿、替代帧、归档与新 DO 恢复闭环通过。 |
| 2026-08-27T11:31Z | archive/O16/retry/combat correction Vitest | 0 | 4 files / 11 tests；公开 forward 与秘密/资源/位置/战斗 causal branch 同时通过。 |
| 2026-08-27T11:31Z | `npm run typecheck && npm run module:check && git diff --check` | 2 | correction 测试已绿；typecheck 被并行尚未完成的 ActorPlan `campaign-actions.ts:2080-2081`（`eventRef` narrowing）阻断，已通知责任代理，后两项未执行；不得记为本切片完成门。 |

### 当前剩余条件与下一步

- ADR 0011 的两个策略现在都有真实 Room/投递/归档证据；待 ActorPlan 并行修改稳定后重跑类型与结构门。
- 长休跨驱逐 RED 已独立定位：DO 正确恢复 active rest，但一小时 strenuous travel 的移动事务没有派生 `ActivityInterrupted`，幽灵 activity 随后挡住新休整；下一步在统一 consequence→Activity interruption 位置修复，不放宽 `startRest`。

## 2014 长休中断跨 DO 驱逐 GREEN（2026-08-27）

- RED 因果链：开始八小时长休后真实驱逐 Room DO；新实例正确重放出 active Rest Activity，且一小时旅行没有提前恢复 HP/资源。首个不变量破坏发生在 `compound-actions.ts:consequenceDrafts`：移动只派生 `CharacterMoved`/Fiction Time，没有在同一 Root 检查该角色的 active long rest，因此 Activity 永久 active，后续合法 restart 被 `startRest` 的 `alreadyActive` 正确挡住。
- 修复：当且仅当已冻结移动时长至少一小时、移动实体自身存在 active `restKind:'long'` Activity 时，在同一 Rules 事务内先提交一个确定排序的 `ActivityInterrupted{cause:{kind:'longRestStrenuousTravel2014',durationMicros,destinationSceneId}}`，再提交移动。没有按 wall clock、DO 生命周期或玩家原文判断；纯粹推进八小时休息时间不会被误判为旅行。
- 闭环：驱逐后的一小时 shrine→yard 旅行将旧 Activity 置 interrupted，HP/资源仍未恢复；新 Root 可重新开始长休。完整八小时后再次驱逐，`completeActivity` 恢复至 20 HP 与 2014 资源值；同 prepared retry 返回同 Receipt；archive 恰好一条 ActivityInterrupted、一条 RestCompleted。
- 修改：新增 `tests/rest-activity-eviction-v2.test.ts`；生产只改 `compound-actions.ts` 的统一 consequence draft seam。没有修改 store/DO、`startRest`、SPEC、D1 或部署配置。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（eviction RED） | `npx vitest run tests/rest-activity-eviction-v2.test.ts ...` | 1 | 驱逐后旧 Activity 实际 `active`、restart `needsKp`；未完成恢复值保持不变，证明首因不是提前效果或重建丢失。 |
| 2026-08-27T11:33Z | 同一窄测 | 0 | 1/1；中断、restart、第二次驱逐、完成、同 prepared retry、归档 exactly-once 全绿。 |
| 2026-08-27T11:34Z | rest + multiplayer + randomness recovery Vitest | 0 | 3 files / 26 tests；短休骰源、群体休整私密同意、四个随机 checkpoint/scene lock、驱逐恢复无回归。 |
| 2026-08-27T11:34Z | Rules/time/long-casting Node 组合 | 1 | 49/51 当时通过；两项失败来自 O16 新 actor 字段尚未同步的 direct correction test fixture，不在休整路径。随后已为所有 direct `applyServiceCorrection` fixture 补可信 actor；完整重跑仍等待并行 ActorPlan helper 稳定。 |

### 当前剩余条件与下一步

- 本切片的机械与恢复路径已满足；冻结 SHA 上重跑完整组合。正在并行补动态 AbilityDefinition 的 archive→新 DO→调用纵切。
- ActorPlan 并行改动曾令三个 NPC helper 回归报 `state is not defined`，责任代理已定位并修复 `commonStoryDrafts` 参数，待其窄测完成后统一重跑类型/结构门；不可把并行中间态当成休整回归。

## D1 权威归档成功、追赶与 lag 遥测 GREEN（2026-08-27）

- 症状与 RED：归档 alarm 只有 `room.archive.failed`，成功分页和最终追平没有任何生产样本；现有游标只保存下一次尝试时间，不能区分“刚排队”与“积压十分钟仍在重试”。新增真实 Room/D1 fake 向量首先因 `authority_archive_progress` 不存在 `pending_since_at` 以 `SQLITE_ERROR` 失败，证明旧实现无法计算代次年龄。
- 单一事实源修复：私有 Room DO SQLite 游标新增 nullable `pending_since_at`。同一 pending generation 的 `mark/defer/restart/save-page` 都保留最早时间；只有真正 caught up 才清空，下一代工作重新起钟。DO 构造时用 `PRAGMA table_info` 原位升级旧表，并以旧 `updated_at` 保守回填仍 pending 的代次，重建不会把 SLO 时钟归零。没有修改 D1 schema、公开 archive 格式或活跃 WorldState。
- 生产遥测：每个成功页在持久保存游标后输出固定白名单 `room.archive.page.completed`，明确 `catchingUp | caughtUp`、`replayIntegrity:verified`、非负页时长和由持久起点计算的 lag bucket；失败样本也使用同一 lag 计量并继续原有 retry。事件只含哈希 room correlation 与桶，不含 room id、角色卡、删除原因、事件正文、Delivery/Prompt 或 error message/stack。
- 责任 Interface 证据：一个 42 角色移除生成的多页真实 archive 先遭 synthetic D1 outage，在 650 秒持久积压上得到 failure `alert`，随后分页得到 catching-up `alert` 与 caught-up `alert`；新 pending generation 成功后得到 `withinTarget`。另一个测试把对象表实际降为旧列集合、驱逐并重建，确认新增列和原 `updated_at` 起钟值都被保留。
- 修改：`app/_runtime/lib/room/authority-store.ts`、`durable-object.ts`、`tests/archive-do-resume-v2.test.ts`。未改 Goal、SPEC、远端 D1、Wrangler 或部署状态。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T11:45Z | 归档 telemetry 窄测（实现前） | 1（预期 RED） | `no such column: pending_since_at`；首因固定在持久游标而非 serializer 或测试常量。 |
| 2026-08-27T11:46Z | 同一 telemetry 窄测（实现后） | 0 | 1/1；failure/catching-up/caught-up 与 `alert → withinTarget` 全部来自生产 alarm，敏感哨兵扫描为零。 |
| 2026-08-27T11:47Z | `npx vitest run tests/archive-do-resume-v2.test.ts --testTimeout=60000 --reporter=verbose` | 0 | 5/5；旧表迁移、D1 清空后重建、代际竞态、85+ events 有界分页/失败重试/驱逐/TTL 及新遥测同时通过。 |
| 2026-08-27T11:48Z | `node --import tsx --test tests/structured-telemetry-v2.test.mjs && npm run typecheck && git diff --check -- ...` | 0 | serializer 7/7；当前并行源码类型通过；本切片三文件 whitespace 通过。 |

### 当前剩余条件与下一步

- SPEC 0011 审计指出的 archive success/catch-up/lag 生产可观测缺口已关闭；冻结 SHA 上只需纳入归档与结构化遥测组合，不再补同义测试。
- 等待 ActorPlan 生命周期与动态 Ability 跨新 DO 两个并行切片返回后合并窄门禁；随后继续成长/D1 边界、角色继任更正、三类结局与 continuity manifest 的剩余责任 Interface。

## ActorPlan/FactionPlan 非机械生命周期与社会 premise GREEN（2026-08-27）

- 症状与首因：formation/首个 execute 已存在，但 closed due decision 拒绝 `revise | defer | cancel`，fold 没有版本化修订/取消事实；关系、承诺、债务虽已是权威状态却不能成为有限社会前提；`npcTransitioned` 的退场 PC 被 active-only 谓词排除；Faction 只有一次性 advance，没有 formation/resource snapshot/due lifecycle。实现期间 `commonStoryDrafts` 新增社会 scope 时漏传 `state`，三条复合测试实际抛 `state is not defined`，随后在唯一调用点显式传入并转绿。
- Rules/Room 修复：ActorPlan 可 execute/revise/defer/cancel，修订只能使用当前 NPC 可得 premise、冻结资源、due xor trigger 与显式 alternate target；cancel 中断 Activity，defer 不提前触发，execute 依次提交 NPC action、trace fact 和 Activity completion。关系/承诺/债务/知识统一进入有限 premise 与 scope；退场并经玩家同意转 NPC 的实体可继续形成/执行计划。FactionPlan 同步形成、冻结成员/资源引用并在关联 actor plan 的版本/状态上镜像推进。
- 恢复证据：真实 Room 覆盖知识 trigger、due、alternate target，以及 due commit 前和 due commit 后/player intent 前两处驱逐；child root、NPC 事件与原玩家 intent 都 exactly once，模型失败不推进。玩家 surface 不含私密 premise/plan/resource ref。
- 修改：`actor-plans.ts`、`compound-actions.ts`、`model.ts`、`campaign-events.ts`、`campaign-actions.ts`、`room/durable-object.ts` 与三份 ActorPlan/compound 测试。未改 Action/server、文档/Profile/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（生命周期最终回执） | ActorPlan Room Vitest | 0 | 2 files / 8 tests；四种 decision、trigger/due、alternate target、两处 eviction 与 player-intent resume 全绿。 |
| 2026-08-27（复合最终回执） | `node --import tsx --test tests/rules-compound-action-v2.test.mjs` | 0 | 31/31；offscreen faction、社会 premise、FactionPlan、退场 PC→NPC 与 NPC follow-up 均绿，`state is not defined` 已消失。 |
| 2026-08-27（相邻回归） | world/module Node + stage4/chapter Vitest | 0 | 19/19 + 11/11；世界、模组 pin/迁移和五向量无回归。 |
| 2026-08-27（结构门） | `npm run typecheck`；`npm run module:check`；`git diff --check` | 0 | 类型、单一 Rules/Room 权威入口和 whitespace 全通过。 |

### 当前剩余条件与下一步

- 本节没有冒充机械计划完整：due stage 当时仍明确拒绝非 null `mechanicalProposal`，Faction resource refs 只证明授权/存在/冻结而未臆造尚无模型的数量消耗。已续派同一纵切补 NPC 攻击/检定经 DO 随机 continuation 与驱逐恢复；在其转绿前不把 SPEC 0006 actor/faction 全合同标完成。

## 动态 AbilityDefinition 归档到新 DO 后继续调用 GREEN（2026-08-27）

- RED 因果链：真实 `handleRoomAction` 的动态注册返回 `needsKp`。首个违反点是 KP/Rules 动态 materialization 白名单不接受 `ability`；通用 DefinitionRegistered 仅包装 lore `content`，没有走既有 Ability Compiler，故即使归档也不能恢复成可执行 mechanic graph。
- 修复：正式 KP proposal schema 接受 `ability`；Rules 要求 `definitionId === factRef`，用既有 Compiler 验证并冻结 `definitionHash/compilerProfile/mechanicGraph/compiledHash/referenceClosure`，两条复合行动事件路径复用同一 definition draft。没有在 restore 处特判或建立第二编译器。
- 真实纵切：源 Room 注册定义并导出 archive；全新 DO 恢复返回 `projectionIntegrity:verified`。源/恢复 Room 都经同一 `handleRoomAction` 与相同 submission 调用该能力，`focus 2 → 1`，read model、archive head、definition/compiled hash 及 `ResourceSpent/AbilityInvoked` payload 深相等，各流 exactly once。
- 修改：KP `authoritative-types.ts`、`authoritative-helpers.ts`、`authoritative-policy.ts`；Rules `compound-actions.ts`；新增 `tests/dynamic-ability-archive-restore-v2.test.ts`。未改 DO/correction/campaign-events/ActorPlan/docs/Profile/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（ability RED） | 动态 Ability archive 窄测 | 1（预期 RED） | production normalizer 白名单拒绝 ability，Room 返回 `needsKp` 且零定义提交。 |
| 2026-08-27（ability GREEN） | 同一窄测 | 0 | 1/1；冻结 compiler artifact、归档、新 DO 恢复、源/恢复调用与资源 exactly-once 全绿。 |
| 2026-08-27（相关回归） | Ability Profile Node；dynamic/archive/world Vitest | 0 | 8/8 + 11/11；既有静态编译、分页归档/恢复及世界五向量无回归。 |
| 2026-08-27（结构门） | `npm run typecheck`；`npm run module:check`；目标 `git diff --check` | 0 | 类型、单一权威入口和 whitespace 全通过。 |

### 当前剩余条件与下一步

- 本责任向量选择无需骰的 free activation，充分证明定义/编译/hash/资源/调用跨归档恢复；它不替代正在补的 due ActorPlan 机械随机纵切。最终 Profile 冻结时须把新增 ability materialization/compiled event 语义纳入实算 hash。

## 成长跨驱逐 exactly-once 与 D1 静态卡失败边界 GREEN（2026-08-27）

- RED：新增真实 Room 测试最初因 production sync seam 不存在而 `ERR_MODULE_NOT_FOUND`。现状 Table 在 Room 成长提交后完全没有静态目录更新责任，因而也没有可故障注入并证明“不回滚 DO”的接缝。
- 修复：新增 `table/authoritative-growth.ts`。只在 Room 已返回 `committed | concluded` 后，从可信 observe projection 派生可重建的成长静态摘要；只同步 level、能力值、最大 HP、熟练加值和 feature ids，明确保留 D1 既有 current HP、资源、装备、位置等字段，禁止镜像活跃状态。D1 写、读取或观察失败均返回/记录 rebuildable mirror failure，精确原 Room outcome 不变；同 submission retry 会重试镜像但不会重做成长。
- 生产接线：自然语言与所有 authoritative table button 都走同一 post-commit helper。成功/失败只输出哈希 room/principal、固定 event/outcome/duration，不记录 sheet、投影或 error message。D1 更新是幂等 JSON 单行写；下一次 committed action 可修复先前失败。
- 真实证据：里程碑只打开该玩家 Pending，明确选择后成长到 4 级；synthetic D1 writer 抛错仍返回原 committed outcome。驱逐 DO 后同 submission 直接返回缓存 outcome；投影仍为 level 4/dex 18/HP 7/24，archive 恰好一条 `CharacterAdvanced` 和一条 `CharacterMechanicsSynchronized`。后续成功镜像保留静态哨兵 current HP=999 和原 resources，只更新可重建成长摘要，证明 D1 不成为活跃状态权威。
- 修改：新增 `app/_runtime/lib/table/authoritative-growth.ts`、`tests/growth-d1-boundary-v2.test.ts`，接线 `table/server.ts`。未改 D1 schema、Room 状态、Rules mechanics、SPEC/Profile/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T11:54Z | growth/D1 窄测（实现前） | 1（预期 RED） | `ERR_MODULE_NOT_FOUND: authoritative-growth`，证明没有 post-commit sync 责任接缝。 |
| 2026-08-27T11:55Z | 第一版窄测 | 1 | 驱逐后同 submission 的 `prepare` 正确直接返回 cached committed；测试夹具错误坚持必须再次 prepared。修改 helper 接受缓存终态，未改产品幂等语义。 |
| 2026-08-27T11:56Z | 第二版窄测 | 1 | 产品以带 canonical `choice` 的 `CharacterAdvanced` 保存选择，没有另发测试假设的独立 `AdvancementChoiceRecorded`；改核对实际权威事件 `CharacterAdvanced + CharacterMechanicsSynchronized`，未放宽 exactly-once。 |
| 2026-08-27T11:57Z | growth/D1 窄测 + typecheck | 0 | 1/1；D1 failure、原 outcome、驱逐缓存、投影、后续 mirror repair 与两类事件各一全部通过；类型通过。 |
| 2026-08-27T11:58Z | growth + multiplayer Room Vitest | 0 | 2 files / 10 tests；成长、休整、退休/继任、控制权、组队/时间均无回归。 |
| 2026-08-27T11:58Z | table/service Node 回归首轮 | 1 | 17/18；旧源码护栏只接受 sendAction 分支内字面 `runAuthoritativeRoomAction`，抽取 helper 后虽行为等价仍被拒。恢复分支内可信调用并在其后接 post-commit helper。 |
| 2026-08-27T11:59Z | table/service Node；typecheck；module check；目标 diff check | 0 | 18/18；类型、公开单一权威边界和 whitespace 全通过。 |

### 当前剩余条件与下一步

- SPEC 0008 验收 1 的两项责任现有同一真实 Room 证据；冻结 SHA 只需纳入成长/multiplayer/table 组合。继续处理错误死亡→继任行动→因果更正、三类结局、卡住 reorient 与 continuity manifest 终审。

## Chapter Continuity Manifest v2 与生产 FactionPlan 接缝 GREEN（2026-08-27）

- 审计目标：SPEC 0008 要求裁定先例、到期计划与势力计划跨章持续；旧 `campaign-continuity-manifest/v1` 的 `precedentStates` 实际只哈希 meaningful failure/retry change，`npcPlans`、`factionPlans` 和正式 `adjudicationPrecedents` 都不在清单。
- 首层 RED/因果：真实 Room 的 faction ActorPlan formation 先返回 `needsKp`。拆开裁定和 formation 后定位为 KP `ActorPlanProposal`/strict schema 没有 `factionRef`，Rules 内部虽支持 FactionPlan，模型输出进入生产 normalizer 时却必被拒绝/剥离；此前只有 direct Rules FactionPlan 证据。现将 optional `factionRef` 加入类型、closed validator 与模型 JSON schema，Rules 仍验证 faction 存在、NPC 成员资格及全部冻结 resource refs。
- 测试夹具修正：Rules 要求 fiction-time due 精确等于 NPC 当前虚构时间 + Activity duration；最初使用任意远期 due 的 `needsKp` 属测试非法，改为两秒 Activity/三秒到期，使 formation 后尚余一秒，切章时可合法选择 `continue`。没有放宽 due 机械。
- 第二层 RED/修复：formation 转绿后，真实切章事件仍明确返回 v1 且缺三组状态。新房间现写 `zhuwei.campaign-continuity-manifest/v2`：`precedentStates` 增加正式 adjudication precedents，新增 `actorPlanStates`、`factionPlanStates`；每项仍只保存 ref + canonical state hash。旧 v1 closed shape、hash validator 与按旧 schema 重算函数保留，历史 v1 事件不会因新字段被隐式解释为 v2。
- 真实责任 Interface：Room 先执行一次带公开规则依据的权威检定并记录 AdjudicationPrecedent，再由有限知识 NPC 形成带 faction/resource pin 的未到期计划，随后以 `activityTransitions:[continue]` 原子切章。archive 的 `ChapterContinuityRecorded` v2 同时钉住 precedent/NPC plan/Faction plan/Activity；玩家不获得内部状态正文。
- 修改：KP `authoritative-types/helpers/policy`；Rules `campaign-continuity.ts`、`campaign-events.ts`；新增 `tests/chapter-continuity-manifest-v2.test.ts`。未改 SPEC/Goal/Profile、D1/DO schema、部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（continuity 初始 RED） | 新真实 Room 窄测 | 1 | formation 返回 `needsKp`；拆分裁定/formation 后仍复现，确认不是随机或裁定组合造成。 |
| 2026-08-27（生产 Faction schema RED→GREEN） | 同一窄测迭代 | 1 → 1 | optional `factionRef` 接入 strict KP schema 后通过 proposal 层；下一拒绝来自测试 far-future due 不满足“当前时间 + Activity duration”，修正夹具而非生产。 |
| 2026-08-27T12:09Z | canonical due 后同一窄测 | 1（预期 manifest RED） | formation/transition 已 committed；首个失败精确为实际 schema v1，不是预期 v2。 |
| 2026-08-27T12:12Z | v2 实现后同一窄测 | 0 | 1/1；真实 Room archive 同时含 AdjudicationPrecedentRecorded、NpcPlanFormed、FactionPlanFormed、ChapterContinuityRecorded v2 与四组哈希状态。 |
| 2026-08-27T12:12Z | continuity + ActorPlan + adjudication Room Vitest；world campaign Node | 0 | 3/3 + 14/14；生产 formation、裁定 supersede/新 DO 恢复、成长/切章/更正/继任无回归。 |
| 2026-08-27T12:13Z | KP adapter Node；目标 `git diff --check` | 0 | 10/10；strict proposal/normalizer、诊断修订、失败代数与 whitespace 全通过。全局 typecheck 等 due mechanical 并行切片结束后统一执行。 |

### 当前剩余条件与下一步

- Continuity Manifest 的 actor/faction/adjudication 缺口已闭合；最终 Profile 冻结需纳入 v2 schema 与 KP factionRef 语义。正在等待 due mechanical、错误死亡 Room 更正和三类结局/重定向三个并行纵切回执。

## 错误死亡、独立继任与因果分支更正真实 Room 闭环（2026-08-27）

- 新增 `tests/death-successor-correction-room-v2.test.ts`，只经真实 `env.ROOMS`、`handleRoomAction`、server-held correction capability、公开 observe/archive/retry/restore 接缝；未直接改内部 WorldState、事件、Receipt 或投影。
- 错误分支先由冻结机械将前任 HP 归零并派生死亡，立即撤销控制；继任者用独立人物卡进入，未继承前任私密知识、装备或资源，随后真实花费资源、形成动态事实并取得自己的知识。
- 玩家 principal 直接持有 correction 请求会被 `correctionUnauthorized` 拒绝。可信服务更正因继任者已经行动而选择 `causalBranch`，原死亡 Root、继任引入 Root 与继任行动 Root 全部 supersede；旧事件和 Receipt 仍逐项可审计，没有删除或改写历史。
- 同 correctionId retry 返回完全相同结果，不再调用 narration、不追加事件；同 id 不同 payload 被 `idempotencyPayloadMismatch` 拒绝。新分支恢复前任的原 HP/资源/装备/私密知识，清除失效继任者、其事实和知识；替代 Delivery 只绑定新 branch/Receipt，不泄漏错误正文或任一私密知识。
- 将更正后 archive 恢复到全新 DO，得到 `projectionIntegrity:verified`、零 Delivery slot、read model/事件/Receipt/head 等价，证明错误分支不会经恢复重新成为当前真相。本切片只补强责任 Interface 证据，没有修改生产、SPEC、Goal、D1 或部署配置。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T12:15Z（并行测试回执） | `npx vitest run tests/death-successor-correction-room-v2.test.ts` | 0 | 1/1；死亡撤权、干净继任、后继行动、服务端 causalBranch、更正幂等、秘密安全替代帧及新 DO 恢复全绿。 |
| 2026-08-27T12:16Z（主代理复核） | 同一 Vitest + `git diff --no-index --check /dev/null tests/death-successor-correction-room-v2.test.ts` | 0 | 主代理完整读取测试并独立复跑；测试文件 whitespace clean，无生产修改。 |

### 当前剩余条件与下一步

- SPEC 0008 验收 6 现在已有“错误死亡 → 干净继任 → 继任真实行动 → 服务端因果分支更正 → archive 新 DO 恢复”的单一纵切证据；最终冻结 SHA 只需纳入组合门，不再增加同义测试。
- 继续等待 due ActorPlan 机械 continuation 与三类结局/卡住重定向真实 Room 回执；随后审计错误代数、私密 slot 控制与 Stage 4 余项。

## 到期 ActorPlan 机械随机 continuation 跨驱逐 GREEN（2026-08-27）

- RED 因果链：真实 Room 选中带非空 `mechanicalProposal` 的到期 NPC plan 后，Rules 返回 `invalidMechanicalProposal: The selected due ActorPlan has no frozen mechanical proposal.`。原 due stage 只支持无机械的 execute/revise/defer/cancel，且若直接复用父 submission 的随机 journal，会与随后恢复的玩家意图发生根绑定冲突。
- 修复：due mechanics 仍由 `stepCompoundActionPlan` 进入既有 semantic command / Rules `step`，先提交同事务 ActorPlan 生命周期，再用 plan 的确定 child root 结算 NPC 机械；Room 的 proposal recovery/randomness journal 对 due stage 使用 child root，父 prepared submission 保留给随后玩家意图。没有新增骰源、NPC 默认攻击或第二套检定。
- 权限/有限知识：提交时重新验证 NPC、plan/premise/knowledge、冻结 target/resource 与真实人物卡；未冻结引用、伪造资源、DC 31 越界等拒绝。退场 PC 转 NPC 使用其真实卡面；尚无数量模型的 faction 资源消耗未被猜测实现。
- 故障闭环：`afterRandomnessRequestCommit`、`afterRandomnessCandidateCommit`、`afterOutcomeCommitBeforeResponse` 三处驱逐/丢响应均产生唯一 child Receipt，`RandomnessRequested`、`DiceRolled`、`ImprovisedCheckResolved`、`NpcActionCommitted`、`ActivityCompleted` 各恰好一次；NPC child root 在原玩家 `FeasibilityRuled` 前完成，随后同一玩家意图继续。
- O08/O15/O16 后的过时夹具同步：随机恢复完成世界提交且 DeliveryPlan 仍 open 时，首次 retry 应叙述/发布一次；第二次相同 retry 不再叙述，并保持 frame/Receipt/archive events 不变。只更新 `tests/room-retry-v2.test.ts` 的旧计数，不改 `action.ts`。
- 修改：`compound-actions.ts`、Room `durable-object.ts`、`tests/actor-plan-due-room-v2.test.ts`、`tests/room-retry-v2.test.ts`。未改 SPEC/Profile/D1/部署配置。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（并行 TDD） | ActorPlan due 窄测（实现前） | 1（预期 RED） | 旧 7 项绿；新增机械计划真实 Room 场景被硬拒，首因固定在 due Rules/Room continuation。 |
| 2026-08-27（并行最终回执） | 6 files Room 联合回归；Rules compound；typecheck；module:check；diff check | 0 | 42/42、31/31；类型、唯一 Module 边界与 whitespace 通过。 |
| 2026-08-27T12:29Z（主代理复核） | `npx vitest run tests/ending-reorientation-room-v2.test.ts tests/actor-plan-due-room-v2.test.ts tests/room-retry-v2.test.ts --no-file-parallelism --maxWorkers=1 --testTimeout=30000 --reporter=verbose` | 0 | 本切片 ActorPlan 10/10、retry 3/3；与结局 5 项合计 18/18，主代理在当前共享源码独立复跑。 |

### 当前剩余条件与下一步

- SPEC 0006 Actor/Faction plan 的 formation/lifecycle、有限知识、到期优先、机械随机、三点驱逐和玩家意图续接均有真实 Room 证据；最终冻结 Profile 后纳入完整门。
- 原计划进入 Stage 5 已被用户新增的战术地图硬阻塞取代；不得因本纵切绿色而部署。

## 胜利/不可逆失败/明确放弃与停滞重定向 GREEN（2026-08-27）

- 首个真实 RED：胜利 `StoryConcluded` 已提交、归档并恢复，玩家明确不开始续篇后，普通 KP ActionPlan 仍能追加 `DefinitionRegistered + CanonicalFactDeclared`，以“追溯隐藏反派”改变已结束故事。`StoryConcluded` fold 只标记状态，Rules 复合行动入口缺少 concluded-story gate，是第一个违反点。
- Rules 单点修复：当存在 concluded story 且没有 active story 时，普通 compound ActionPlan 统一拒绝；只允许规范化 `advanceCampaignLifecycle + recordEpilogueChoice | startSequel`。没有自然语言关键词扫描，也没有 Room/UI 特判；显式尾声和续篇仍复用同一事务。
- 新增 `tests/ending-reorientation-room-v2.test.ts` 的五个真实责任 Interface 场景：胜利及长期后果跨 archive/new DO 且不容追溯反派；不可逆失败保留 canonical loss；仅玩家明确放弃后收束；相同重掷被拒并重定向到已经固化的机会、不临时造保底路线/骰面；现实等待与 DO 驱逐不推进虚构时间或施加惩罚。
- 修改：Rules `compound-actions.ts` 与上述新测试。未改 Room/UI、SPEC 0001、D1 或部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实 Room RED） | 结局/重定向新套件首轮 `--bail=1` | 1（预期 RED） | victory/StoryConcluded/archive/restore 均先通过；随后 retroactive hidden villain 实际 committed，定位 Rules gate 缺失。 |
| 2026-08-27（并行最终回执） | 新套件；Rules compound + world/campaign；31 轮 KP eval；typecheck；目标 diff check | 0 | 5/5、45/45、1/1；结局、长团、多轮与类型通过。 |
| 2026-08-27T12:29Z（主代理复核） | 与 ActorPlan/retry 的联合 Vitest | 0 | 本切片 5/5，联合 18/18；当前源码独立复跑。 |

### 当前剩余条件与下一步

- SPEC 0009/O 的三种合法收束、长期后果、明确 continuation gate、停滞 reorient 与现实等待不惩罚现有真实 Room/恢复证据。最终 Profile 与 traceability 仍须在全部语义稳定后重算。
- 用户新增战术地图后，继续按其 TM01–TM14 建立新的权威环境/Viewer/UI 纵切；原 Stage 5 暂不开始。

## 用户追加二维战术地图交付合同与领域边界（2026-08-27）

- 目标变更：用户把 authoritative-v2 简单二维战术地图及 14 项验收标准追加为 `COMPLETE` 硬阻塞。原 Goal、SPEC 0001 和既有交付标准全部保留；不得把 Geometry helper、静态地图、局部 UI 或既有 Stage 4 绿色冒充完成。
- Goal 追加：`docs/goals/0001-cloudflare-program.md` 的产品方向、规格板块、架构不变量、Stage 1–5 和完成标准已逐项加入用户批准的 12 项产品决定与 TM01–TM14；只追加，没有删除或缩写原合同。
- 领域建模：`CONTEXT.md` 新增“权威战术空间、环境要素、环境状态、战术投影、战术预览、地图意图”，明确页面方格/像素、完整 GM 图和客户端 targets 不是域事实。此处使用 `domain-modeling` Skill；它促使 UI Adapter 与权威空间使用不同术语，并记录难以逆转的边界 ADR。
- 规格/决策：新增 `SPEC 0014`（状态为用户 Goal 明确批准）、ADR-0012、DEC-035；同步规格索引和追踪矩阵 P11/TM01–TM14。合同固定真实 scene geometry、有限环境状态、骰前冻结、ordered path、Rules 全目标集合、Viewer Tactical Projection/preview、地图与文字同源、Legacy 不猜迁移及双视口浏览器门。
- 当前事实边界：既有 `SPEC 0012/0013` 和 G01–G15 只证明 Geometry 算法底座；环境状态、真实 Room geometry→projection→archive、UI 输入、地图/文字 Adapter、hidden-state indistinguishability 与浏览器证据仍明确写为待实现。现已按 TDD 分派第一条 Rules/Room tracer RED 与第一条 table/UI tracer RED。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T12:17Z | 首次完整重读当前 `docs/goals/0001-cloudflare-program.md` | 0 | 读取原 201 行合同后才追加用户新决定；未重复输出全文给用户。 |
| 2026-08-27T12:19Z | 首次追加后的 `rg ... authoritative-v2 的 `WorldState`` 核对 | 0（含 shell 诊断） | 搜索双引号中误放反引号，shell 先输出 `WorldState: command not found`；后续 rg/diff 检查仍完成，文件未受影响。该命令失误不作为验证证据。 |
| 2026-08-27T12:28Z | `shasum -a 256 docs/specs/0001-llm-kp-responsibility-contract.md`；tracked diff check；四个 untracked 文档逐个 no-index whitespace check | 0 | SPEC 0001 仍为冻结 hash `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`；新增/修改 Goal、CONTEXT、SPEC/ADR/README/decision/matrix 无 whitespace 诊断。 |

### 当前剩余条件与下一步

- 当前仍为扩展后的 Stage 1/2/3 纵切，不是 Stage 5。先取得 TM01（真实 Room geometry/project/archive）与 TM03/TM05（table/UI 不丢投影且不要求实际 targets）的可证伪 RED，再一条一条转绿。
- SPEC 0014 的完成状态、实现映射与测试证据只能随实际纵切回填；Cloudflare/Workers/Wrangler/浏览器 Skill 在进入相应实现/验证操作前不提前加载。

## Stage 4 错误代数与 Delivery 控制撤销审计（2026-08-27）

- 错误代数首因：Room Action 的 `modelFailure()` 没有读取 KP Adapter 的稳定错误码，导致 `modelPermanent` 与 `quotaExhausted` 都被压成 `modelTransient`；telemetry 虽声明 13 类，却没有覆盖生产实际的 `invalidRulesInput`、`missingPrerequisite/worldLawViolation`、`projectionFailure`、`seatInactive`，`needsKp` 也未标作机械诊断。
- 修复：`modelPermanent` 变为脱敏 `rejected/modelPermanent`，`quotaExhausted` 变为 `retryableFailure/quotaExhausted`，未知异常仍安全落为 transient；生产码分别映射 validation/worldInfeasible/projectionIntegrity/authentication，Authority 与 Room Action 的 `needsKp` 都映射 `mechanicalDiagnostic`。没有记录 error message/stack/Prompt。
- 私密槽审计：生产 `applyRoomAdministration` 原本已在同一事务按 changed-control character 调用 `supersedeCharacterDeliveries`，清除正文并 tombstone plan，但缺真实 Room 责任证据。现补控制转移、`departMember` 主动离席和 `removeMember` 请离：旧 controller/离席者不能 observe/ACK，晚到 narration 不能重新发布，新 controller 只取得角色当前结构化知识而没有旧 DeliveryFrame。
- 尚未清零的严格缺口：普通玩家受限 `ErrorReport/correctionRequired` 入口仍不存在；`sinceEventSeq` 连续增量、起止 hash 验证与坏增量 `projectionIntegrity/retryableFailure` 也不存在。已续派前者的独立 TDD 切片；本节不得写成全错误合同完成。
- 修改：Room `action.ts`、`telemetry.ts`、`authority-telemetry.ts`、`server.ts`；扩展 authoritative action、telemetry 和 observer delivery 测试。未改 SPEC/Goal/D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（错误代数） | authoritative action Node | 0 | 15/15；永久/额度/瞬时模型失败的稳定 Outcome 与脱敏边界通过。 |
| 2026-08-27（私密槽） | observer delivery Vitest | 0 | 10/10；控制转移、离席、请离、ACK/覆盖/晚到 narration/新 controller 知识边界通过。 |
| 2026-08-27（telemetry） | authority + structured telemetry Node | 0 | 11/11；13 类矩阵和实际生产错误码分类通过。 |
| 2026-08-27（旁路回归） | privacy + voice Node；hidden reality Room Vitest | 0 | 3/3 + 1/1；错误/候选/语音/转写与隐藏现实旁路无回归。 |
| 2026-08-27（结构） | typecheck；目标 ESLint | 0 | 类型通过；ESLint 无 error，一个 app 文件只有项目既有 ignore warning。 |

### 当前剩余条件与下一步

- 先完成普通玩家 ErrorReport（只报告、不更正、不扩权）并复用现有 service correction；随后以独立纵切补 `sinceEventSeq` 连续增量完整性。二者全绿前，SPEC 0011 故障/更正与 SPEC 0010 增量投影不能标完成。
- Tactical P11/TM01–TM14 同时按两条 tracer RED 进行，互不改动上述错误/Delivery 文件。

## Tactical Projection 桌面 Adapter 首个封闭透传切片（2026-08-27）

- RED 因果：真实 `projectAuthoritativeTableObservation` 只从 Room read model 白名单提取既有字段；即使 Room 已提供 viewer-filtered `tacticalProjection`，桌面 Adapter 仍将其完全丢弃，TM02 的第一个跨层接缝因此可证伪失败。
- 单点 GREEN：在 `app/_runtime/lib/table/authoritative.ts` 定义封闭、版本化的 `zhuwei.tactical-projection/v1` 防御性验证器；只接受整数英寸、scene/self 一致、稳定唯一实体/feature/zone、封闭 geometry/encounter/preview/readout。合法值只 `structuredClone` 原样返回，不补坐标、不排序、不推断距离或目标；未知字段或非规范结构整份以固定、无秘密内容的 `TypeError` 拒绝。
- 责任边界：本切片尚未把该字段送入 `fetchTable.state.authoritative`，也没有 PlayTable、地图绘制、手势或区域目标改变；Rules/Room 仍须生成相同封闭协议。它只修复 Adapter 丢字段，不冒充 TM02/TM03 完成。
- 修改：`app/_runtime/lib/table/authoritative.ts`、`tests/authoritative-table-v2.test.mjs`。未改 Rules/Room、Legacy、页面、SPEC/Profile、部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（并行 TDD） | 新增两个 table Adapter 测试 | 1（预期 RED） | 首个失败为 `projected.tacticalProjection === undefined`；未知字段负测在实现前亦为 `Missing expected exception`，锁定 allow-list 缺口。 |
| 2026-08-27（并行回执） | `npx tsx --test tests/authoritative-table-v2.test.mjs`；typecheck；diff check | 0 | 16/16；封闭透传、整份 fail-closed 和原 table/client 回归全绿，类型及 whitespace 通过。 |
| 2026-08-27（主代理复核） | 同一 Node 测试 | 0 | 16/16；主代理读取 validator/调用点/负测并在共享源码独立复跑。 |

### 当前剩余条件与下一步

- 以第二个 TDD 纵切把已验证的投影沿真实 `fetchTable` 公共返回结构送到 `state.authoritative`，但仍不在 server 计算任何空间事实；之后再让 PlayTable 的地图与文字读数只消费这一字段。
- Room/Rules tracer 必须输出与此处完全相同的 v1 封闭结构；若 schema 不一致，应统一协议而不是在 Adapter 修补数据。

## 普通玩家受限 ErrorReport → 可信更正责任接缝 GREEN（2026-08-27）

- RED 因果：公开 `RoomActionInput`/`AuthoritativeActionInput` 与 DO `prepare` 没有受限错误报告类型；玩家对自己可见 Receipt 提交报告时实际得到 `validation`，无法形成 SPEC 0011 的 `correctionRequired` 信号。更正能力本身已经存在且正确限于可信服务，因此缺口在公开报告入口，不在 Rules 更正机械。
- 单点修复：新增 closed `{kind:"errorReport", submissionId, receiptId, concern:"rules"|"facts", explanation<=500}`。首层 action 与 Authority 双重拒绝额外 statePatch/events/mechanicOps/branchGraph/correctionCapability；DO 以可信 principal 的 Rules `project` 核对 Receipt 对该 Viewer 可见，再从权威 store 取得目标公开 Receipt。私密和不存在引用统一经内部 `privateOrUnknownReference` 映射为无差异 `referenceUnavailable`。
- 状态边界：报告的 payload hash、concern/explanation 与 `needsKp/correctionRequired` 结果原子保存到 Room SQLite submission journal；相同提交跨 stub 幂等恢复，换 payload 拒绝。报告不调用 KP、不执行 `step`、不追加 World Event、不改 WorldState/branch/scope、不创建 Delivery，成功响应也不回显说明正文。
- 权限闭环：玩家直接 `commitCorrection` 仍为 `correctionUnauthorized`；初始化返回的 server capability 经原 `handleRoomCorrection → commitCorrection` 成功更正，未建立第二更正路径。telemetry 将带 code 的 `needsKp/correctionRequired` 分类为 correctionRequired；普通 `needsKp` 仍是 mechanicalDiagnostic。
- 修改：Room `action.ts`、`authority-types.ts`、`durable-object.ts`、`authority-telemetry.ts`、telemetry 映射；新增 `tests/error-report-room-v2.test.ts` 并扩展 telemetry 测试。未改页面/table、SPEC/Goal、战术文件、D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实 RED） | `npx vitest run tests/error-report-room-v2.test.ts` | 1（预期 RED） | 玩家报告自己的可见 Receipt 实际返回 validation；首因锁定公开 Action/Authority 输入缺口。 |
| 2026-08-27（并行回执） | ErrorReport + archive correction + Room Authority；telemetry；authoritative action；typecheck；module check；diff check | 0 | 16/16、11/11、15/15；幂等、引用不可区分、拒绝注入、可信更正和结构门全绿。 |
| 2026-08-27（主代理复核） | `npx vitest run tests/error-report-room-v2.test.ts tests/archive-correction-v2.test.ts tests/room-authority-v2.test.ts ...`；两个 telemetry Node 套件 | 0 | 16/16 + 11/11；主代理读取真实 Room 测试及 journal/投影核验/公开错误映射后独立复跑。 |

### 当前剩余条件与下一步

- 本切片没有玩家页面按钮，也没有供客服枚举报告的第二读模型；报告 journal 尚不在灾难归档中。若最终产品合同要求 UI 或跨灾备工单保留，应另开公开 API/归档纵切，不能从此 seam 证明。
- SPEC 0010 尚需 `sinceEventSeq` 连续增量、起止 hash 和破坏增量的 `projectionIntegrity/retryableFailure`；复用本代理开始下一独立 TDD 切片。

## Tactical Projection 进入真实 fetchTable state 的第二个切片（2026-08-27）

- 协议冲突与裁定：最初 table tracer 使用 JS number 坐标和独立 entity height，而 Rules 权威 Geometry 使用 canonical integer-string 的 `x/y/elevation` 与三维 `footprint.width/depth/height`。已裁定复用后者，删除 table 内第二套 types/validator；唯一 contract 迁至 `app/_runtime/lib/rules/tactical-projection.ts`，table 只做 viewer self/scene 绑定检查与 `structuredClone`。
- 真实 RED 因果：`projectAuthoritativeTableObservation` 已不再丢投影后，`fetchTable` authoritative 分支仍手写旧 state envelope，未把已验证投影放入公共 `state.authoritative`。因此 adapter unit 绿色但用户真实 fetch 仍看不到地图数据。
- 单点 GREEN：新增 `buildAuthoritativeTableState({rulesetVersion, projected})`，只对 exact authoritative-v2 构造公共 envelope并原样携带 `tacticalProjection`；Legacy 与未知 ruleset 功能性返回 null。真实 `fetchTable` 改用该 builder，`TableSnap` 仅引用共享 type，没有渲染或空间计算。
- 审查中发现共享 v1 仍暂时把 `knownZones` 限为空、`preview` 限为 null 且尚未强制稳定排序；这会阻塞最终 TM06/TM09/TM12，已要求 Rules owner 在首个 Room tracer 完成前把同一 v1 一次性扩成最终 closed union。完成前不得把协议或 TM02 标为冻结。
- 修改：共享 tactical contract、table `authoritative.ts`/`server.ts`/`client.ts`、authoritative table 测试。未改 PlayTable、targetIds、Legacy mechanics、D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（第二切片 RED） | table state builder / fetch source seam | 1（预期 RED） | builder 起初不存在；加入 builder 后真实 fetch 源码仍未调用，锁定内联旧 envelope。 |
| 2026-08-27（并行回执） | authoritative table；interaction + room management；typecheck；module check；diff check | 0 | 17/17 + 10/10；exact v2 透传，Legacy/unknown null，类型/Module/whitespace 通过。 |

### 当前剩余条件与下一步

- 等唯一共享 v1 contract 支持最终 zone/preview 与稳定排序后，主代理复跑本切片；之后才以 TDD 接入 PlayTable 的 SVG/HTML 二维展示和同源文字读数。
- Rules/Room 仍必须生成真实、viewer-filtered、可回放投影；server 只携带数据，不能把本切片作为 TM01/TM03 完成证据。

## 基础二维 TacticalMap 与真实 PlayTable DOM 纵切（2026-08-27）

- 第一轮 RED：共享投影已有 boundary/self/visibleEntities/knownFeatures/readout，但没有生产组件；纯 React SSR seam 无 `TacticalMap` module。新增 `app/_runtime/components/tactical-map.tsx`，只消费 `TacticalProjection|null`，将 canonical integer-string 英寸映射到 SVG `viewBox`/形状，不计算距离、碰撞、掩护、传播或目标。
- 展示内容：场景边界与 60 英寸网格；自身及可见单位的关系、占位、高程/高度；barrier/terrain/interactable/destructible/portal 五类 known feature；`impassable/opaque/cover/propagation` 同时成为公开 data 属性、视觉 class/title 与中文可见标签。同一 `textualReadout` 在页面可见、可聚焦并带 aria label，投影缺失时组件渲染空。
- 第二轮 RED：纯组件绿色后，完整 authoritative `TableSnap` 的真实 `PlayTable` SSR 仍没有 `data-tactical-map`。PlayTable 现只在 `state.authoritative.tacticalProjection` 存在时接入，不读取 Legacy `ruleProjection`；没有手工重组空间事实。
- 主审再发现中心语义 bug：Rules Geometry 规定 entity position 是占位棱柱中心，首版 SVG 却把 x/y 当 rect 左上角。追加 DOM RED 后只在展示层用 `center - footprint/2` 画矩形，label/data 仍保留权威中心；偶数与奇数尺寸分别证明不舍入、不回写权威坐标。
- 新 table adapter import 起初使用 `@/` alias，Cloudflare Vitest 真实 importer 无法 collect；改为相对 import 后 observer Delivery 重新 10/10。修改未触碰 Rules contract、区域/preview、路径输入、targetIds、D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（组件 RED→GREEN） | TacticalMap DOM/SSR | 1 → 0 | module missing 后组件输出 boundary/grid/entity/五类 feature/机械标签/readout；null 输出空。 |
| 2026-08-27（PlayTable RED→GREEN） | 完整 authoritative snap SSR | 1 → 0 | 接线前页面无 map；接线后只从 authoritative tactical projection 出现地图与同源 readout。 |
| 2026-08-27（中心语义 RED→GREEN） | 单一 TacticalMap DOM case | 1 → 0 | 首版实际 rect `(120,180)`/label `(150,210)`；修复后 60×60 为 `(90,150)`/label `(120,180)`，61×59 使用展示用半英寸且不舍入。 |
| 2026-08-27（并行最终回执） | tactical-map + authoritative-table；observer-delivery Vitest；typecheck；module check；diff check | 0 | 20/20 + 10/10；Node SSR、真实 Cloudflare importer、类型、Module 边界和 whitespace 全绿。 |
| 2026-08-27（主代理复核） | 同一 20 项 Node DOM/Adapter + observer-delivery Cloudflare Vitest | 0 | 20/20 + 10/10；主代理读取组件/SSR断言/PlayTable接线并在当前共享源码独立复跑。 |

### 当前剩余条件与下一步

- 这只是 TM03/TM04 的基础展示证据；knownZones/preview、路径与区域输入、环境状态变化、最终 375/1440 浏览器视觉/DOM 均未完成。
- 共享 contract 已预留 zone/preview closed union，但 Rules projector 当前输出空/null。先完成 Room 真实 geometry 与 viewer-safe spatial revision，再从 Rules 垂直实现有限环境状态和区域目标，最后接 UI 控件。

## `sinceEventSeq` 连续观察者增量与完整性失败 GREEN（2026-08-27）

- 初始 RED 因果：`publicProjectionQuery()` 丢弃 `sinceEventSeq`，Rules `ProjectionQuery` 只有提交后叙述使用的内部 `committedRange`；DO `observe` 不会从游标重建 prior state/连续事件片段，也不能把断序/错误 hash 映射为 `retryableFailure/projectionIntegrity`。真实请求因此只返回普通快照，`incrementalDelta` 为 undefined。
- 唯一链路：`Room observe → replay(genesis,prefix) → Rules project(current, viewer, incrementalRange)`。DO 只解析闭合 public cursor、用既有 replay 重建游标状态并传连续 suffix，不生成 changes、不解释事件、不自行脱敏。Rules projector 逐项验证 eventSeq、room/runtime、parent/previous hash、stateBeforeHash、完整 Profiles、fold 后 stateHashAfter/eventHash，且最终 folded state/head/hash 必须等于当前权威状态。
- 投影结果：before/current 均由同一 `projectAuthoritative` 得到；delta anchors 是 `{from,to}.{eventSeq,stateHash,eventHash,projectionHash}`，changes 只返回当前 Viewer 投影的 `current` 或 `removed:true`，不返回历史 before 值。原始 eventType、payload/hash 链和私密正文不离开 DO；增量本身计入最终 projection hash。
- 公开失败：null/missing/future cursor、错误 start state、tampered event/projection hash，以及只有任一 hash 而没有 sinceEventSeq，全部逐字段收敛为 `{kind:"retryableFailure",code:"projectionIntegrity"}`。没有 raw log fallback。
- 主审追加 lifecycle RED：former-character/successorRequired 分支原先在 query 构造前 early-return，合法 cursor 静默得到全 snapshot。现 lifecycle 同样传入 `incrementalRange`；prior 存活时以同一 player viewer 投影，prior 已结束时复用 lifecycle projector，仍验证 anchor 并输出统一 delta。
- 修改：Rules `model.ts`/`projector.ts`、Room `durable-object.ts`、新增 `tests/observer-incremental-room-v2.test.ts`。未改 table/tactical module、SPEC/Goal、D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（首个 RED） | observer incremental Room | 1（预期 RED） | `observe(...,{sinceEventSeq})` 返回普通 snapshot，无 incrementalDelta。 |
| 2026-08-27（首个 GREEN） | 同一真实 Room | 0 | 1/1；合法/完整 anchor、DO eviction、秘密 sentinel 与五类坏增量通过。 |
| 2026-08-27（lifecycle RED→GREEN） | 扩展 incremental Room | 1 → 0 | 1 pass/1 fail 精确复现 lifecycle early-return；修复后 2/2，含死亡后的 successorRequired delta 和三种孤立 hash cursor。 |
| 2026-08-27（并行最终回执） | Delivery/retry/hidden；archive correction/resume；HTTP/projection/privacy；telemetry；typecheck；module/diff | 0 | 14/14、11/11、7/7、11/11；相邻隐私、驱逐、归档、HTTP、遥测与结构门全绿。 |
| 2026-08-27（主代理复核） | incremental + archive correction + bounded D1 archive resume Cloudflare Vitest | 0 | 13/13；主代理读取 Room prefix replay/Rules range验证/delta生成后独立复跑，含 80+ events、失败重试、驱逐、TTL 与更正归档。 |

### 当前剩余条件与下一步

- 已知的 SPEC 0010 连续增量缺口现闭合；最终冻结源码仍需把新 tactical projection 字段纳入同一增量组合并随全量门重跑。
- 增量层不得再为地图建立专项 delta；战术投影作为 SafeReadModel 字段自然由同一投影差异进入 changes。

## TM01 首个 Rules/Room 真实战术场景纵切（2026-08-27）

- 症状/首因：新 authoritative 房的 `combatRuntime.scenes[*].geometry` 由 Rules genesis 统一造 `{unit:"inch",obstacles:[]}` placeholder，人物位置由 ordinal 合成一维横线；Room 没有从版本化 Module/Profile 取得真实场景边界、出生点与要素。真实 Room tracer 在 archive genesis 看到 boundary 缺失、obstacles 为空，玩家 read model 也无 tacticalProjection。
- 模块版本：新增 pinned `black-oak-will@tactical-map-v1`，8 个既有 location 都在 StoryBible 中携带 closed canonical `zhuwei.tactical-geometry/v1`：整数英寸 boundary、至少一个真实 feature、排序的 spawnPoints/obstacles、visibility policy。新房默认该版本；缺任何场景几何即初始化拒绝，不合成通用矩形、不按输入猜 Legacy。旧 `legacy-anchor-v1/v2` 的内容和 hash 原样保留。
- 权威链：Room 只把可信 pinned Module geometry 送入 `initializeAuthoritativeWorld`；Rules closed validator 验证并固化到 genesis/WorldState。初始玩家/NPC 按场景内稳定 spawnPoints 分配，不再使用 ordinal 一维位置。archive 在全新 DO 恢复后得到等价 tactical projection。
- 唯一投影协议：新增共享 `rules/tactical-projection.ts`，以 canonical integer-string 坐标、三维 footprint、known feature、完整 zone/preview union、稳定排序/上限和 SHA-256 spatial revision 定义 closed v1；Rules projector 从权威 scene/entity/encounter 与 visibility policy 构造 self、可见单位、已知要素和同源读数，剥离 `visibilityPolicyId` 与隐藏实体/知识。
- 主审侧信道 RED：首版 `spatialRevision=state.version`，一次带秘密 reason 的 observer 移除使全局 version 0→2，即使公开空间完全不变仍改变 tactical revision。现 revision 对 viewer-safe scene/self/visibleEntities/features/zones/encounter 规范哈希；真实 Room 证明非空间/秘密变化前后 tacticalProjection byte-equal。读数同时修正“高程/实体高度”和中文掩护标签。
- Legacy 纪律：旧 custom/dynamic/bulk 测试夹具显式 pin `legacy-anchor-v1`，不根据场景缺失自动 fallback。新增 hash：tactical Module `sha256:661fb063fa1cf8f2fd84056f8067273fe3b56d619df8ad19660dd1adae87c896`；旧 v1 `sha256:198ad1c122a84abffc881cfb4b0c5f6bcb32cd2411acb07aceb33163694b37f9`、v2 `sha256:283e0b6dfd7bab0a27895e741b9b56a2c536ba02ef922d4a35ebe43227ce0a03` 不变。
- 修改：Module authoritative/profile/migration 与新 black-oak tactical layouts；Rules tactical geometry/projection、genesis/player combat entity/projector/model；Room initialization；新 tactical Room tracer、Module hash tests及若干旧责任 fixture 的显式 Legacy pin。未改 SPEC 0001、D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实 Room RED） | `tests/tactical-scene-room-v2.test.ts` | 1（预期 RED） | archive geometry 只有 empty obstacles，无 boundary；player read model 无 tacticalProjection。 |
| 2026-08-27（并行 GREEN） | tactical Room；module/hash；chapter migration；observer/incremental/error/authority；legacy custom/bulk；type/module/diff | 0 | 1/1、6/6、6/6、22/22、15/15；真实初始化/秘密过滤/archive/fresh DO、旧 hash/显式 Legacy 与结构门通过。 |
| 2026-08-27（TM12 早期侧信道 RED→GREEN） | observer secret-reason removal 同一 tracer | 1 → 0 | 全局 version 改变但 viewer-safe tactical payload/revision 现逐字段相同，revision 为 canonical SHA-256。 |
| 2026-08-27（主代理复核） | tactical Room + module/hash | 0 | 1/1 + 6/6；主代理读取 Module layouts/validator/genesis/projector后独立复跑。 |

### 当前剩余条件与下一步

- TM01 尚不能完整勾选：动态 `join/materialize/successor` 的 `buildPlayerCombatEntity` 调用仍可能走 ordinal×60 fallback；已启动下一真实 Room TDD 切片，要求确定性选择未占 module spawn、用尽即拒绝且 replay 等价。
- Shared TacticalProjection 改变 Projection Policy 语义；尽管 moduleRef 已新 pin，最终首次发布前仍必须把 TacticalProjection/Environment schema Profile 纳入完整 Runtime manifest 并重算 projection/manifest/genesis hashes。不能沿用当前旧 Projection Profile hash；待环境/preview语义稳定后一次冻结。
- 全量探索性回归中 tactical 初始化类失败已清零；`combat-room-randomness-v2` 尚有 3 个既有 5 秒 timeout，当前不作为本切片绿色证据，最终源码冻结门必须解决并全量通过。

## Tactical 新房动态角色权威出生点 GREEN（2026-08-27）

- RED 因果：初始 genesis 已使用 module spawn 后，`grantSeat`、`materializeCharacter` 和 `introduceCampaignSuccessor` 仍调用未传 tactical position 的 `buildPlayerCombatEntity`；真实 tactical Room 新加入角色得到旧 ordinal fallback `{x:"300",y:"0",elevation:"0"}`，而权威 wake geometry 的首个未占 spawn 是 `{x:"180",y:"-240",elevation:"0"}`。
- 单点修复：新增 Rules 私有唯一 `allocateDynamicCombatantSpawn(state, sceneId)`。tactical room 只按 pinned geometry `spawnPoints` 顺序选首个未被该场景 combat entity 占用的位置；缺/坏 geometry 或用尽统一 `spatialCapacityUnavailable`。Legacy 返回显式 `legacy`，继续历史 ordinal 行为；没有 fallback 矩形、随机位置或页面坐标。
- 三个动态入口在构造既有 `CharacterMechanicsSynchronized` 前调用同一 allocator，位置随现有 World Event 冻结并回放。休整/成长仍通过 `synchronizePlayerCombatEntity` 保留原位置，不重复分配。
- 真实 Room tracer 从 archive genesis 的 pinned spawn 列表与初始公开占位推导期望位置，逐一 join 填满并逐角色 observe 核对；溢出明确拒绝，archive→fresh DO 的完整 tactical projection 等价。相邻多人/继任/更正证明 materialize/successor 与旧房未回归。
- 修改：新 `rules/v2/spatial-spawn.ts`，multiplayer/campaign dynamic character callers，新 `tests/tactical-dynamic-character-room-v2.test.ts`。未改 UI/环境状态、SPEC/Profile、D1/部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实 RED） | tactical dynamic-character Room tracer | 1（预期 RED） | grantSeat 实际位置为 ordinal×60 横线，不是 pinned free spawn。 |
| 2026-08-27（并行 GREEN） | dynamic + initial tactical tracer；legacy multiplayer；tactical successor/correction；type/module/diff | 0 | 1/1、2/2、9/9、1/1；分配、容量拒绝、Legacy、继任及恢复通过。 |
| 2026-08-27（主代理复核） | dynamic/initial tactical + multiplayer + death-successor-correction 联合 Vitest | 0 | 12/12；主代理读取 allocator/三个调用点/真实 Room测试后独立复跑。 |

### 当前剩余条件与下一步

- TM01 的“真实 geometry 且不再合成一维位置”现有初始与动态角色证据；最终勾选仍待环境/zone 事件进入同一 WorldState/replay，并随冻结 Profile/全量门复证。
- 进入有限环境状态：先门 open/closed，再毁坏/残骸与持续区域；所有状态转换必须由 Rules 事件更新同一 scene feature。

## TM07 有限环境状态首纵切：Portal open ↔ closed GREEN（2026-08-27）

- 症状/首因：真实 `handleRoomAction` 没有环境交互输入，yard genesis 的门只有静态 `closed` 属性而没有版本化状态图；因此玩家无法通过同一 Room/Rules 权威链改变通路，archive/replay 也没有环境转换事件可恢复。
- 闭合输入：公开 Action 仅接受 `{kind:"environmentInteract",submissionId,featureId,intent:"open"|"close"}`；Action 与 DO 双层 exact-key，拒绝客户端提交 state、props、patch、visibility 或通用 command。DO 只将可信 principal、唯一受控角色和已保存 continuation 转成 Rules `interactEnvironmentFeature`，走 `authorityDirect` 且不调用 KP。
- 状态权威：tactical Module 为 public/hidden portal 固化 definition id、排序的 closed/open semantics 与双向 transition。Rules 验证 controller、同 scene、可见 portal、当前 state/transition 后生成单一 `EnvironmentFeatureStateChanged`；fold 从 genesis 同一 graph 重验 definition/from/intent/to，原地更新 `combatRuntime.scenes[*].geometry` 的 feature。没有第二状态表或专项 projector。
- 投影/隐私：既有 viewer Tactical Projection 自动读取当前 opaque/impassable/cover/propagation；`stateGraph`、definition id 和隐藏通路不进入玩家读模型。hidden、unknown、wrong-scene 与 Legacy 引用在公开 Action 层逐字段等价为 `referenceUnavailable`。重复相同 submission 返回原 Receipt，换 payload 拒绝。
- 版本：`black-oak-will@tactical-map-v1` 因 pinned state graph 更新为 `sha256:0578d10767ab92749547b0de4f9fe1b737a3c5e90a70beeb76498eb3550f1f41`；两个 Legacy Module hash 未改。最终 Projection/Profile/manifest hash 仍等环境、zone、preview schema 稳定后统一冻结。
- 修改：Room `action.ts`/`authority-types.ts`/`durable-object.ts`；Rules `model.ts`/`actions.ts`/`events.ts` 与新 `v2/environment.ts`；tactical geometry validator/Module/migration hash；新增真实 Room portal 测试。未改 SPEC 0001、D1 或部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实 RED） | `npx vitest run tests/environment-portal-room-v2.test.ts` | 1（预期 RED） | 0/2；公开 action algebra 首层 validation，且 genesis 无 state graph/hidden portal。 |
| 2026-08-27（并行 GREEN） | portal Room；Module/privacy/action；相邻 Room；typecheck；module/diff check | 0 | 2/2、27/27、23/23；open/close、事件、幂等、引用等价、archive→fresh DO 与结构门通过。 |
| 2026-08-27（主代理复核） | `npx vitest run tests/environment-portal-room-v2.test.ts tests/tactical-scene-room-v2.test.ts --no-file-parallelism --maxWorkers=1`；`npx tsx --test tests/module-npc-v2.test.mjs` | 0 | 3/3 + 6/6；主代理读取状态图/Rules fold/Room direct mapping/隐私断言并独立复跑。 |

### 当前剩余条件与下一步

- 本切片只证明 portal `open/closed` 和投影语义随权威状态改变；TM07 的完整机械证据仍需同一状态实际改变移动、视线、掩护、传播结果，并补 destructible `intact/damaged/destroyed/rubble` 的伤害路径。不得以公开按钮直接写 `destroyed`。
- 下一纵切先以能力/伤害结果驱动可破坏物状态，再做持续区域创建、到期和中断；所有结果继续进入同一 event/replay/project/archive 链。

## `combat-room-randomness-v2` 随机 5 秒 timeout 根因与夹具确定化（2026-08-27）

- 症状：完整文件在默认 5 秒单测门限下出现 4 个 multi-wave recovery timeout；同一 `beforeRandomnessRequestCommit` case 连续运行会在约 3.7 秒通过或约 5.2 秒超时，无法归因于稳定的功能失败。
- 根因：`preparedConcentrationAttack` 未固定前置 encounter 先攻。NPC 先手时 helper 会额外提交一次“结束 NPC 当前回合”，增加约 10 条事件；Room 在 prepare/observe/commit/recovery/archive 边界反复做完整 `authoritativeReplay`，使 42/43-event 快簇约 3.8 秒、52/53-event 慢簇约 5.9–6.1 秒，后者越过 Vitest 默认 5 秒。TacticalProjection 在显式 `legacy-anchor-v1` 房间 geometry guard 即返回，实测 0–1ms，不是根因；alarm/eviction 也只有 0–1ms。
- 诊断收敛：起初把“新增战术投影成本”和“archive/alarm 等待”列为候选；逐阶段计时和 event-count 分簇排除二者，最终以 `setupEnemyActsFirst=true/false` 四次对照确认未固定先攻是直接触发，重复全量 replay 是既有成本放大器。
- 最小修复：只在测试的 opening encounter commit 所在 DO 回调内临时覆盖 `authorityRoll`，严格要求恰好两枚 d20 并返回 `[20,1]`，由公开 observe 再断言 Alice 先手；`try/finally` 在 opening commit 完成后立即恢复真实函数。删除随机 NPC 先手时的额外 setup 分支。待测 NPC 伤害、专注豁免、三波 commitment/recovery 和 concurrent duplicate 继续使用真实 Room randomness journal；未改生产代码或全局/局部 timeout。
- 后续性能边界：同一 RPC 内重复 full replay 可另开生产优化切片，但本次没有借测试修复改变 archive durability、事件链或缓存语义。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（最小复现） | 单个 `beforeRandomnessRequestCommit` case 连续 3 次，默认 5s | 1/0/1 | 5.250s timeout、3.73s pass、5.191s timeout，确认双峰而非稳定断言失败。 |
| 2026-08-27（诊断 harness） | 临时阶段/replay/event-count 计时，20s 诊断门限 | 0 | 快簇 42/43 events≈3.73–3.82s；慢簇 52/53 events≈5.88–6.08s；Legacy tactical 0–1ms，alarm 0–1ms。所有 `[DEBUG-tactical-randomness-perf]` 随后清除。 |
| 2026-08-27（并行修复验证） | 目标 4 recovery + concurrent 默认 5s，连续 3 轮；完整文件；typecheck；diff check | 0 | 每轮 5/5；完整 11/11；无 instrumentation/临时文件，生产源码未改。 |
| 2026-08-27（主代理复核） | `npx vitest run tests/combat-room-randomness-v2.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 11/11，默认单测 5s 门限，tests 22.67s；主代理读取 scoped override/finally/公开先手断言后独立复跑。 |

### 当前剩余条件与下一步

- 此回归已从最终 `npm test` 的已知随机红点清除；冻结源码上的全量门仍只在所有战术纵切合并后运行一次。
- 若将来 initiative request 顺序、骰子数量或 opening 语义变化，夹具会因 sides/count/公开 active actor 断言 fail closed，而不是静默固定错误对象。

## TM09 持续区域真实 Room tracer 首个 RED（2026-08-27）

- 测试边界：新增 `tests/environment-zone-room-v2.test.ts`，只通过真实 tactical Room 初始化、`observe` 和后续公开 `handleRoomAction` 设计生命周期；没有在 fixture 注入 AbilityDefinition、WorldState、事件、骰面或 zone。archive 只预留作可信服务证据。
- 首个不变量违反点：`fog` 是现有 SRD 2014 catalog 中的 point-origin sphere、120 尺、1 小时专注区域法术，但 v2 `compileSpell` 当前排除 `resolution.mode:"utility"`，因此受控角色投影只有 improvised strike，没有 `spell:fog` AbilityDefinition。`entangle` 未注册；`web` 虽为 area+concentration，当前形状编译又拒绝 cube，不能作为绕过。
- 分阶段 RED：只执行第一项“玩家必须从 observe 取得真实 fog definition”，其余四项以显式 `it.skip` 留作后续转换门：闭合 ability 输入/拒绝客户端 zone fields、viewer-safe zone+restore+幂等、到期 exactly-once、真实专注中断。避免五项都在 action algebra 前产生同义失败并被误写为执行过。
- 目标闭包：公开 area ability 只允许 submissionId、真实受控 abilityRef、areaOrigin、形状需要时的 areaDirection 与 slotLevel；拒绝 targetIds/affectedEntityIds/zone/duration/effect/visibility/geometry/state。Rules 从完整权威空间计算内部集合，zone 生命周期进入同一 event/replay/project/archive 链。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实 RED） | `npx vitest run tests/environment-zone-room-v2.test.ts` | 1（预期 RED） | 1 failed、4 skipped；tactical Room/observe 成功，但 controlled definitions 中 `spell:fog` 为 undefined，首因早于 Room action algebra。 |
| 2026-08-27（主代理复核 RED） | 同一文件，`--no-file-parallelism --maxWorkers=1` | 1（预期 RED） | 主代理复现 exact controlled definitions 仅有 `improvised-strike`；失败仍在真实 fog definition 缺失，未被其他共享改动掩盖。 |

### 当前剩余条件与下一步

- 先最小扩展版本化 spell/Ability compiler，让真实 `fog` 以 SRD target/effect 进入受控 definitions，并以 compiler/profile 测试锁定；不得在 Room 或测试临时造法术定义。
- 其后逐项取消 skip：闭合 `ability` Room 输入 → typed zone created/project/archive → fiction-time 到期 exactly-once → closed concentration end；actual target set/hidden indistinguishability 属于紧接其后的 TM06 区域结算纵切。

## TM07/TM08 真实环境破坏、残骸与传送门 destroyed 纵切 GREEN（2026-08-27）

- 症状/首因：既有环境交互只能在 portal 的 `open/closed` 间转换；公开 Room Action 没有由真实角色能力攻击环境要素的闭合入口，Rules 也没有把攻击、伤害、耐久和 `intact/damaged/destroyed` 写入同一场景几何的 typed event/fold。因此公开状态能显示门，却不能由规则机械摧毁、形成残骸或在 archive/replay 中恢复。
- 闭合入口与唯一机械路径：新增公开 exact-key `{kind:"environmentAbility",submissionId,featureId,abilityRef}`；Room 从可信会话绑定唯一受控角色，不接受客户端 actor、伤害、骰面、目标集合、state/patch/visibility。Rules 只允许受控角色已编译且装备的真实 AbilityDefinition，并复用 attack d20、伤害公式、Room randomness journal、战斗 initiative/action grant 与统一 Geometry 的 range/clear-path 检查；不调用 KP 重建机械，也没有第二状态表。
- 状态与重放：Module 固化 portal 与 destructible 的耐久、AC、阈值、伤害免疫和有限状态图。`EnvironmentFeatureDamaged` 冻结 ability/module definition hash、攻击与伤害事实、`rangeInches`、from/to state 和耐久；fold 重新编译定义、验证 hash/数值，并用同一 `entityCanTargetTacticalFeature` 重验当时 actor→feature 的范围和通路，再原位更新 `combatRuntime.scenes[*].geometry`。closed/open portal 均可真实毁坏；stone seat 经过 damaged 后成为 rubble，投影同步改变 opaque/impassable/cover/propagation/terrain。
- 隐私：含 AC、threshold、immunity、完整 state graph/definition 的 `AbilityInvoked` 与 `EnvironmentFeatureDamaged` 为 `room-authority-only/internal`。玩家 known feature 只含公开 state、terrain、current/maximum durability 与公共几何；hidden/unknown/wrong-scene/Legacy 仍逐字段同形 `referenceUnavailable`。客户端伪造 damage/state/dice/patch/targetIds 被首层 validation 拒绝。
- 模组几何：全部 8 个 tactical scene 的 spawn 使用同一 `entityOccupanciesOverlap` 检查；修复 shrine 与 private-lian 两处既有出生点/不可通行物重叠。最终 `black-oak-will@tactical-map-v1` pin 为 `sha256:3ec138d7af5210a253f7160e9099eed8f3e2c1378f5fd793eb460bea8b3d1f93`；两个 Legacy pin 不变。
- 稳定性因果链：主代理首次三文件串行复跑出现 seat opening 单例 5059ms timeout，而同文件独跑曾绿。对照确认随机 NPC 先手会额外提交一整组结束回合事件并触发多次 full replay；跨完整 authority turn 是第二慢簇。测试只对 opening initiative 两枚 d20 做 scoped player-first 夹具并在 `finally` 恢复；环境 attack/damage 仍由真实 Room randomness 产生。测试职责拆为 opening、每次最多一个 Fighter authority turn、收束/archive/replay，未放宽默认 5 秒。合法 Fighter20/+9 对 AC11 仅 natural 1 miss；portal 四击全 miss 概率 `6.25e-6`，stone seat 在 16 次内少于三次命中的概率上界约 `6.66e-17`。
- 修改：tactical Module/migration；Room action/authority/DO；Ability compiler、共享 attack resolution/Geometry/tactical contract；Rules character ability/combat/environment/model/projector；portal/destruction/module/TacticalMap 测试。未改 Goal、SPEC 0001、D1 或部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（真实破坏 GREEN） | `npx vitest run tests/environment-destruction-room-v2.test.ts tests/environment-portal-room-v2.test.ts`；相邻 creature/loadout/projection/module/Room retry/privacy；type/module/diff | 0 | 真实 warhammer、随机请求、action grant、range/path、状态转换、幂等、隐藏引用、archive→fresh DO 与相邻责任通过。 |
| 2026-08-27（主审稳定性 RED） | destruction + portal + tactical scene，串行单 worker | 1（不可接受 RED） | 其余 10/10 通过；seat opening 5059ms timeout，证明原单文件绿色不足以支持稳定完成。 |
| 2026-08-27（诊断后并行复跑） | 同一精确三文件串行命令连续两轮 | 0 | 两轮均 15/15，11.89s / 11.60s；最慢单例 2149ms，默认 timeout 未改。 |
| 2026-08-27（主代理独立复核） | `npx vitest run tests/environment-destruction-room-v2.test.ts tests/environment-portal-room-v2.test.ts tests/tactical-scene-room-v2.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 15/15，11.57s；真实 Room 状态、portal 与基础 tactical projection 联合通过。 |
| 2026-08-27（主代理结构门） | Module 6 项；SPEC SHA-256；registry pin；`git diff --check`；branch/main baseline | 0 | Module 6/6；SPEC hash 仍为 `b420123...323be`；分支 `cloudflare`；`origin/main` 仍为 `29eb06dc...f40a`。 |

### 当前剩余条件与下一步

- TM07 的 open/closed/destroyed 状态及 TM08 的 destructible/rubble 已进入同一 Room/Rules/event/project/replay 链；完整 TM07 仍需由真实移动、视线、掩护或区域传播结果证明这些状态确实改变机械，不只改变公开标签。
- 本切片的 range/path 证明不是 TM05 移动 outcome。下一步先在最终稳定 pin 上复现 `tactical-movement-room-v2` 的真实 action-algebra RED，再按闭合 movement → 逐段事件/归档 → 隐私阻挡 → 高程路线 → OA pending 顺序实施。

## TM05/TM10 玩家移动真实 Room tracer 首个 RED（2026-08-27）

- 责任边界：新增的 movement tracer 先用真实 tactical Room、两名真实受控角色和 `handleRoomAction → production startCombat` 建立 Encounter；从 Player tactical projection 读取当前 active mover、self position 与 viewer-safe `spatialRevision`，再提交最短 60 英寸 ordered path。测试不注入 actor、encounter、距离、终点 patch、WorldState、事件或骰面。
- 输入闭包：目标公开输入只允许 `{kind:"movement",submissionId,movementMode:"walk",spatialRevision,path}`。同一测试先加入 actor/sourceEntityId/encounterId/distance/positionPatch/target/state，确认首层 exact-key validation 拒绝且不调用 KP。
- 真实 RED：在最终稳定 Module pin 上，初始化、开战、主动角色与投影均成功；合法 movement 仍返回 `{kind:"rejected",code:"validation",explanation:"不支持的行动输入类型。"}`。第一个违反不变量的位置因此是 Room Action algebra 缺少 movement，而不是旧的 module hash mismatch、Rules Geometry 或 encounter 建立。
- 后续四个 tracer 保持显式 skip：逐段 `MovementSegmentCommitted`/fresh DO/duplicate Receipt；速度/公开与隐藏阻挡/坏起点/stale revision 的秘密安全失败；真实 elevation/height 机械；OA/中断只提交已走前缀并把控制权交给正确参与者。待每一前置责任变绿后逐项取消，不制造五个同义 RED。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（主代理真实 RED） | `npx vitest run tests/tactical-movement-room-v2.test.ts --no-file-parallelism --maxWorkers=1` | 1（预期 RED） | 1 failed、4 skipped；真实 Room/Encounter/投影成功，合法闭合 movement 在公开 Action 首层以 unsupported validation 失败。 |

### 当前剩余条件与下一步

- 先把 movement 作为窄 Room adapter 映射到唯一既有 Rules `moveCombatant → analyzeCombatMovement → MovementSegmentCommitted`，由可信 principal/self/encounter 派生内部字段；Room 不重算 Geometry、不调用 KP。
- 幂等 Receipt 必须先于 stale revision 检查；新 submission 在 prepare/commit 前后比较 viewer-safe revision，Rules 始终在最新完整状态重算 path。隐藏 scope 改变但公开 revision 不变时不得泄露 `scopeConflict`。
- TM10 还缺版本化可行走高程路线/支撑面事实；不能以允许任意 elevation 改动冒充上下楼或坠落机械。

## TM09 真实 SRD `fog` AbilityDefinition 编译首切片 GREEN（2026-08-27）

- RED 首因：SRD 2014 catalog 已有 `fog` 的 point-origin sphere、120 尺范围、20 尺半径、1 小时 concentration 和 heavily-obscured area effect，但角色 v2 `compileSpell` 一律排除 `resolution.mode:"utility"`；真实 tactical Room observe 因而看不到 `spell:fog`，失败早于公开 ability action。
- 最小修复：只允许同时满足“非瞬发 duration + compiled target.kind=area + 至少一个 resolution area effect”的 utility 法术进入既有 AbilityDefinition 编译。没有泛化启用其他 utility、没有新定义结构、没有改变 manifest，也没有在测试/Room 注入法术或 WorldState。
- 真实夹具：zone tracer 改为确实能准备 `fog` 的 Ranger/WIS 静态卡，修正文案与 submission 的 web 漂移。Player observe 取得真实 `revision:"1"`、`rulesBasis:"srd5.1-2014"`、1440 英寸 range、240 英寸 sphere、3600000000 微秒 concentration 和 heavily-obscured area effect。
- 修改仅限 `rules/v2/character-abilities.ts` 与 `tests/environment-zone-room-v2.test.ts`；Room action/authority/DO、zone event/fold/projector/lifecycle 未触碰，后四项仍显式 skip。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（并行 RED→GREEN） | zone 首测 | 1 → 0 | 初始 fog undefined；修复后 1 passed / 4 skipped，真实 catalog/角色 compiler/observe 链通过。 |
| 2026-08-27（并行回归） | ability compiler + spells；静态角色 AbilityDefinition；typecheck；diff check | 0 | 15/15 + 1/1；结构未扩张、旧攻击/豁免/专注法术未回归。 |
| 2026-08-27（主代理复核） | zone Room；`ability-profile-v2` + `spells` | 0 | 1 passed / 4 skipped + 15/15；主代理读取准入谓词与 Ranger 夹具后独立复跑。 |

### 当前剩余条件与下一步

- 下一项才是闭合 `ability` Room 输入与服务端 area 求交；当前仅证明真实 fog definition 可用，不能标记 zone 创建、目标集合、持续、到期、中断、重连或 replay 完成。
- `areaTargets()` 当前在 Geometry 前先按 hostile candidate 过滤，尚不能把施法者、盟友、中立、隐藏实体及环境特征按定义正确纳入；修复必须采用 definition-driven candidate applicability 并继续由完整权威状态调用同一 Geometry，不能接受客户端 targetIds。

## TM05 玩家移动前两段真实 Room GREEN（2026-08-27）

- 首段 RED/首因：真实 tactical Room 与随机先攻 Encounter 已成立，Player projection 提供 active mover、self position 和 viewer-safe `spatialRevision`；合法 `{kind:"movement",submissionId,movementMode:"walk",spatialRevision,path}` 仍在 `RoomAction` exact algebra 以“不支持的行动输入类型”拒绝，未进入 Authority/Rules。伪造 actor/source/encounter/distance/positionPatch/target/state 同时被 validation 拒绝。
- 闭合权威链：Room Action 与 DO 均只接受 `walk`、2–64 个 canonical integer-string `TacticalPosition` 和 SHA-256 spatial revision。DO 从可信 principal→Seat→唯一 CharacterControl 派生 actor，从同一 Player Tactical Projection 绑定 self 与包含该角色的 encounter，保存规范 continuation 后以 `authorityDirect` 映射到既有 Rules `moveCombatant`；距离、速度、碰撞、占位、障碍与终点继续只由 Rules/Geometry 计算，KP propose 为 0。
- 并发/幂等：同 submission/payload 的已有 prepared/result 在 stale revision 前返回；新 submission 在 prepare 后与 commit 前分别重投 Player Projection，比较 viewer-safe `spatialRevision` 与 encounter binding。提交事务仍以既有 scene scope 防竞态；本切片未扩展隐藏 scope refresh，后续隐私阻挡 tracer 仍须证明同形失败。
- 第二段 RED/首因：初版测试的三点共线，被既有 `canonicalizeCombatPath` 正确折叠为一段，因此 archive 只有一个 `MovementSegmentCommitted`；测试改成两条 60 英寸直角段后，真实 Room 得到两个按 eventSeq 排序的 typed segment、最终 self 投影、同 Receipt duplicate 且事件不追加，archive→fresh DO projection byte-equal。
- fold 加固：`MovementSegmentCommitted` 现在只接受 canonical path/正距离/同源 entity patch；fold 从提交前权威位置连续验证 path 起点，以同一 Geometry 重算 segment 与困难地形/挤压距离，验证终点、spent 精确增量，并要求 patch 等于“原实体 + position/movement/squeezing”而不能夹带 HP、资源等无关修改。兼容旧 v2 combat entity 仅有 `id` 的合法形状，同时拒绝冲突的可选 `entityId`。
- 投影 encounter：战术 projector 优先选择包含当前 self 的唯一未结束 encounter；没有活跃 encounter 时才显示该 self 的已结束 encounter，不再取同场景任意字典首项。
- 修改：Room `action.ts`、`authority-types.ts`、`durable-object.ts`；Rules shared tactical validator、`v2/projector.ts`、`v2/combat-events.ts`；真实 Room movement tracer。本切片未改 Module pin、TM10 elevation route、机会攻击、zone、UI、Goal/SPEC 或部署。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（首段 RED→GREEN） | `npx vitest run tests/tactical-movement-room-v2.test.ts -t "accepts only the closed movement path intent"` | 1 → 0 | 首因由 unsupported action 收敛；合法 movement committed、伪造字段 validation、KP 0。 |
| 2026-08-27（第二段 RED→GREEN） | `npx vitest run tests/tactical-movement-room-v2.test.ts -t "commits ordered movement segments"` | 1 → 0 | 共线路径只产生 1 event；改成规范直角路径后 2 events、终点、duplicate、archive/fresh DO 全部通过。 |
| 2026-08-27（fold 相邻回归） | `npx tsx --test --test-name-pattern='Geometry rejects movement\|Geometry applies one-size\|dynamic encounter solidification\|movement after a reaction\|Geometry G14' tests/combat-mechanics-v2.test.mjs` | 1 → 0 | 首轮暴露旧合法 fixture 只有 `id`；兼容后 5/5，含困难地形/挤压、阻挡与中断前缀。 |
| 2026-08-27（compound movement） | `npx tsx --test --test-name-pattern='semantic combat start, movement\|Geometry G01' tests/rules-compound-action-v2.test.mjs` | 0 | 2/2；既有 compound→combat kernel 与 feet/inches 路径未回归。 |
| 2026-08-27（最终定向门） | movement Room；typecheck；module:check；diff check | 0 | 2 passed / 3 skipped；类型、Rules/Room import boundary 与 whitespace 门通过。 |
| 2026-08-27（相邻真实 Room） | tactical scene + portal + room retry，串行单 worker | 0 | 6/6；基础投影、环境 direct action、archive 与幂等恢复未回归。 |

### 当前剩余条件与下一步

- TM05 后三项仍是显式 skip，不能标记完整完成：速度/公开与隐藏阻挡/坏起点/stale revision 的秘密安全失败；TM10 的版本化 elevation route/支撑面机械；机会攻击/中断的已走前缀与正确 controller pending。
- 下一切片只取消隐私阻挡 tracer：先固定公开/隐藏两条均在当前 active mover 剩余速度内的 Module 路径，再统一公开失败，不得让隐藏 scene scope 差异通过 `scopeConflict`、停止点或说明文字泄漏。
- 当前 `black-oak-will@tactical-map-v1` pin 保持 `sha256:3ec138d7af5210a253f7160e9099eed8f3e2c1378f5fd793eb460bea8b3d1f93`，本切片未重算或修改 Module/Profile。

## TM09 闭合 `fog` Room ability action 首个真实 RED（2026-08-27）

- 在真实 `fog` AbilityDefinition 已可从 Ranger observe 获得后，取消第二项 skip。测试从 Player tactical projection 取 self position、从 controlled definitions 取真实 abilityRef，只提交 abilityRef、areaOrigin 与 slotLevel；没有注入 definition、targetIds、zone、WorldState、事件或骰面。
- 同一测试先提交含 `targetIds/affectedEntityIds/zone/duration/effect/visibility/geometry/state` 的 forged 输入：首层 validation 拒绝，KP propose 计数仍为 0。合法闭合 fog 输入也保持 KP 0，却得到 `{kind:"rejected",code:"validation",explanation:"不支持的行动输入类型。"}`。
- 因此首个违反不变量的位置已从 compiler 前移到公开 Room Action algebra 缺少 `ability`；不是 fog catalog、真实 abilityRef/self position、伪造字段防线或 KP 绕行。其余 zone create/replay、expiry、concentration-end 三项继续显式 skip。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27（并行真实 RED） | zone 第二 tracer name pattern | 1（预期 RED） | forged fields validation + KP 0；合法闭合 ability 在 RoomAction unsupported kind 失败。 |
| 2026-08-27（主代理复核 RED） | `npx vitest run tests/environment-zone-room-v2.test.ts -t "rejects client-computed zone fields and commits the closed fog ability without calling KP" --no-file-parallelism --maxWorkers=1` | 1（预期 RED） | 1 failed / 4 skipped；同一首因，未被 movement 共享改动掩盖。 |

### 当前剩余条件与下一步

- 待 movement 共享 Room 文件停止修改后，实现闭合 ability direct route；Room 只绑定 principal/source/scene，Rules 依据 AbilityDefinition 和完整权威几何派生 area affected set、slot/concentration/zone event，不调用 KP。
- 本 RED 尚不证明 area candidates、hidden indistinguishability 或 zone lifecycle；不得仅让 action 返回 committed 就一次性取消后三项 skip。

## 产品决定：本轮改为可上线体验的最小战术地图 Milestone 1（2026-08-27）

- 用户明确取代了此前“全部详细战术地图/环境机械阻塞本轮”的终止条件，但保持 SPEC 0001 不变。当前交付目标改为：authoritative-v2 实际游戏桌中的 Viewer-only 简单二维地图、当前角色/可见参战者/行动者/基础距离、已知 feature/zone 状态、诚实 unknown 与“后续支持”、375/1440 浏览器证据、最终全量门、现有 `zhuwei` Worker 部署和非 force 推送。最终状态只能写 `MILESTONE_1_COMPLETE`，不能宣称原完整计划 COMPLETE。
- 已立即 interrupt 正在扩展第三移动 tracer/Geometry 的代理与只读三维几何审计；未 reset、clean、回退、删除或覆盖任何文件。中断时工作区已经包含 movementMode/fold、hidden wake barriers 与连续障碍求交的部分完成修改，故先按原样运行稳定性检查，不丢弃成果。
- 中断后事实：`tactical-movement-room-v2` 在当前源码为 3 passed / 2 skipped，Module hash 6/6；第三项超速/公开与隐藏障碍/坏起点/stale revision 已实际绿色，TM10 高程与 OA 仍 skip。当前 tactical pin 为 `sha256:df49e12260b590d339961c2a19b3ddc5f59741d2a8521d4d97dbf151d9177947`。这些成果保留，但不再继续扩大到完整移动/高程/OA。
- zone 第二 tracer 在决定前刚建立为真实 RED：forged fields 安全拒绝且 KP 0，合法 fog ability 因 RoomAction unsupported kind 失败；后三项仍 skip。新里程碑不要求地图点选施法或完整 zone lifecycle，该 RED 及恢复入口转入 Goal 0002；当前里程碑仍必须以新产品决定测试“后续支持/无虚假成功”，并让最终默认测试集真实全绿，不能隐藏失败。
- 正在创建 `docs/goals/0002-advanced-tactical-combat.md`，按每项延期能力记录已完成/部分/未实现、已有测试、已知 RED、恢复文件与机器完成标准。Goal 0002 不修改、不复制缩小 SPEC 0001；Milestone 1 部署后立即停止。

### 当前里程碑恢复入口

1. 先审计 `tactical-map.tsx → PlayTable → fetchTable authoritative state` 的实际桌接线，只补展示合同：active actor、viewer-safe 距离、feature/zone 状态、feet 高度、unknown/后续支持与响应式。
2. 新增/更新 DOM 责任测试后做 375/1440 真实浏览器验收；浏览器前不加载相关大型 Skill。
3. 冻结 Profile/hash，运行 `module:check/typecheck/lint/npm test/diff` 一次；任何 active RED 必须按新产品决定真实修复，不能 skip/delete。
4. 只读核对 Cloudflare，再部署现有 Worker/D1，线上冒烟/有界日志、提交与非 force push；remote main 必须仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。

## Milestone 1：高级区域操作安全延期并清除默认测试 RED（2026-08-28）

- 症状 → 根因：默认 `environment-zone-room-v2` 第二项仍要求合法 `kind:"ability"` 直接提交持续区域，和用户刚确定的“本轮不实现地图点选施法/完整区域生命周期”冲突；生产首层仅给通用“不支持的行动输入类型”，既不构成可体验的明确延期提示，也使默认测试保持 RED。
- 修改：`RoomAction` 在调用 Authority/KP 前识别这一窄输入。顶层只接受 `abilityRef/kind/parameters/submissionId`，参数只接受规范 `areaOrigin` 与正整数 `slotLevel`；客户端提交 targetIds、affectedEntityIds、zone、duration、effect、visibility、geometry 或 state 仍以 `validation` 拒绝。合法闭合输入明确返回 `tacticalMapAbilityDeferred` 与“地图点选区域施法后续支持”，不伪造 committed。
- 非扩张证明：没有给 `RoomActionInput`、DO、Rules、事件、zone fold/projector 或客户端新增区域执行路径；KP propose 为 0，前后 Room observation 逐值相等，`knownZones` 仍为空。原始真实 RED、后三项 lifecycle skip 与恢复入口完整保存在 Goal 0002，未写成已验证。
- 修改文件：`app/_runtime/lib/room/action.ts`、`tests/environment-zone-room-v2.test.ts`。未改 SPEC 0001、Goal 0001、Module/Profile、D1 或部署配置。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `npx vitest run tests/environment-zone-room-v2.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 2 passed / 3 skipped；真实 fog definition 仍可见，伪造字段 validation，合法高级操作明确延期，KP 0 且权威状态未改变。 |

### 当前剩余条件与下一步

- 默认 zone 文件已不再含 active RED；三个明确 skip 是 Goal 0002 的创建/到期/专注中断恢复入口，不属于当前里程碑已完成项。
- 等待实际游戏桌地图展示补丁后，主代理审阅并运行 DOM/authoritative projection 定向测试；随后才进入 Playwright 375/1440 浏览器阶段。

## Milestone 1：实际游戏桌 Viewer-only 二维地图展示 GREEN（2026-08-28）

- 接线：authoritative-v2 `fetchTable → projectAuthoritativeTableObservation → PlayTable → TacticalMap` 继续只传观察者专属 `tacticalProjection`。若 authoritative read model 存在但投影暂缺，实际桌仍挂载诚实 unknown 面板；Legacy 桌不挂载新地图，原有 CombatStrip、文本行动与战斗按钮顺序/入口未改。
- 服务端距离：`project(viewer)` 对 self 与每个 Viewer-visible entity 复用同一 Geometry Profile 的 `pathLengthMilliInches`，在同源文字读数输出“中心直线约距 N 尺”；客户端只显示该读数，不计算范围、碰撞、掩护、目标或成功结果。
- 地图展示：SVG 显示场景边界/5 尺格、自身、可见参战者、权威 x/y 占位、当前行动者、地面或 `+N 尺` 高程、实体高度，以及仅来自 `knownFeatures/knownZones` 的障碍、地形、可互动物、门、可破坏物、区域状态、耐久和已投影机械标签。当前行动者若不在 Viewer-visible entities 中显示 unknown，不输出原始隐藏 id。
- 诚实降级：投影缺失、无 encounter、无已知 feature、无已知 zone 均有独立 unknown 文案；界面明确标注“地图交互后续支持”，不提供拖拽移动、点选施法或精确预览。移动端容器只纵向滚动，SVG/列表/长文本均有 `min-w-0/max-w-full/overflow-wrap` 约束；真实 375/1440 视觉证据仍待下一阶段浏览器执行。
- 旧夹具漂移：viewer-only 回归首次为 16/17；生产 `TacticalKnownFeature` validator 已正确要求 `terrain`，旧 portal fixture 缺该字段而被 fail closed。只给 fixture 补 `terrain:"normal"`，未放宽 validator；随后 17/17 GREEN。
- 修改：`app/_runtime/lib/rules/v2/projector.ts`、`app/_runtime/components/tactical-map.tsx`、`app/_runtime/components/play-table.tsx`、`tests/tactical-map-v2.test.mjs`、`tests/authoritative-table-v2.test.mjs`。未实现 Goal 0002 的 movement/area action/preview，未改 SPEC 0001、Goal 0001、Profile、D1 或部署配置。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（TDD RED） | `npx tsx --test tests/tactical-map-v2.test.mjs` | 1（预期 RED） | 0/4；距离、完整地图 DOM、unknown 和实际 PlayTable 接线四项分别命中新增验收缺口。 |
| 2026-08-28（并行 GREEN） | 四项 name-pattern 后完整 tactical-map；authoritative-table；typecheck；diff | 0 | 地图 4/4、Viewer-only 17/17、类型与 whitespace 通过。 |
| 2026-08-28（主代理联合复核） | `npx tsx --test tests/tactical-map-v2.test.mjs tests/authoritative-table-v2.test.mjs tests/observer-projection-v2.test.mjs tests/privacy-bypass-v2.test.mjs` | 0 | 27/27；真实 table adapter、投影校验、个人/NPC/继任隐私、隐藏空间 G15 与地图 DOM 联合通过。 |
| 2026-08-28（Room Action 相邻复核） | `npx tsx --test tests/authoritative-action.test.mjs` | 0 | 15/15；区域安全延期未改变既有六类 outcome、直接战斗/待决/发布/失败行为。 |

### 当前剩余条件与下一步

- 进入真实浏览器阶段：在实际 `/table/<code>` authoritative-v2 游戏桌分别以 375×812 与 1440×900 验证 `scrollWidth === innerWidth`、地图/人物/当前位置/feature/+N 尺/当前行动者可辨认，并保存截图与 DOM 证据。
- 浏览器通过后才冻结源码并运行同一源码的五项完整门；本阶段的 typecheck 是定向证据，不冒充最终冻结门。

## Milestone 1：实际 authoritative-v2 桌 375/1440 浏览器验收 GREEN（2026-08-28）

- 环境：按 Playwright Skill 先确认 `npx` 可用；Wrangler 4.125.0 对空的本地 Miniflare D1 应用既有 0000–0006 七个 migration，全部成功，仅改变 `.wrangler` 本地状态，不创建/修改任何远程资源。随后通过真实 `/register → /hall → 创建桌 → 九步建卡 → 锁卡 → 开始守灵 → /table/R5CZPW` 产品路径建立 authoritative-v2 桌；不是测试页或独立原型。
- 实际投影：真实桌 `守灵夜` 显示 self 阿莱莎、Viewer 可见的莉安/奈斯/瓦罗、四个权威当前位置、10/20/30 尺中心约距、三项已知 feature（石砌炉台/拼起长桌/带泥湿地）、状态 `intact/wet`、移动/视线/掩护/传播标签、地面与 1 英寸/3 尺/5 尺高度。没有 encounter/zone 时分别诚实显示“当前遭遇信息未知”“尚无已知区域效果”；原自由行动输入与安全暂停仍在，地图明确标注交互后续支持。
- 视觉 RED 因果链：首次两档 DOM 均满足 `scrollWidth===clientWidth`，但截图显示 SVG 只剩细横带。测量发现 SVG 自身 972×288，而 `overflow-hidden` frame 因 bounded CSS grid 被压成 988×16，人物/障碍实际被裁剪。测试新增 intrinsic width/height 与非收缩 frame 合同；地图容器改为纵向 flex+滚动，frame `shrink-0`，复测 frame 为桌面 988×304、移动端 315×178。
- 可读性 RED 因果链：展开后完整姓名在相邻单位占位上叠字。SVG 内改为 self“我”与其他单位两字短标，完整姓名仍只从同一投影保留于 `<title>`、实体列表和文字读数；最终标签为 `我/莉安/奈斯/书记`，四个 entity 与三个 feature 的浏览器 bounding box 均为非零且在地图内。
- 响应式证据：375×812 下 document/body 均 375/375、map 349px 宽且位于 x=13…362，frame 315×178；1440×900 下 document 1440/1440、map 1022px 宽且位于 x=25…1047，frame 988×304。两档均无横向溢出，`data-map-label`、feature state、deferred 文案与原行动输入真实存在。
- 截图：`output/playwright/milestone1-table-375.png`（375×812，SHA-256 `896c0086623991766257b9dd1110f6f7c038b0abed0f427c96eab12df40e2fce`）；`output/playwright/milestone1-table-1440.png`（1440×900，SHA-256 `51c47204f14e3ccc18693808693574e5c9e0cf6ca5a1e963696748815b7345a9`）。主代理已用原始分辨率逐张目视复核；浏览器 console 有界搜索无 error/warning。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `npx wrangler d1 migrations apply DB --local` | 0 | 0000–0006 本地七项 migration 全部应用；远程未触碰。 |
| 2026-08-28（浏览器首轮） | Playwright 真实注册/开桌/建卡/开始；375 与 1440 DOM + screenshot | 0，但视觉 RED | 两档无横向 overflow、数据齐全；截图揭示 SVG frame 16px 裁剪，未接受为完成。 |
| 2026-08-28（TDD 修复） | tactical map name-pattern RED→GREEN；完整 `tests/tactical-map-v2.test.mjs` | 1 → 0 | frame 布局与短标分别先 RED；最终 4/4，未改变 Projection 或机械。 |
| 2026-08-28（浏览器最终） | 375×812、1440×900 DOM 测量、截图、原图目视；console 有界搜索；`git diff --check` | 0 | 两档 documentFits=true、实体/feature bbox 非零、地图可见、短标不叠字、原行动入口在场；console 无 error/warning。 |

### 当前剩余条件与下一步

- 浏览器阶段完成；关闭 Playwright session 并停止本地 dev server，避免影响冻结检查。
- 进入最终源码冻结门：运行 `module:check`、`typecheck`、`lint`、`npm test`、`git diff --check`；若修改任何可能影响结果的源码，必须重跑受影响门。

## Milestone 1：首次全量冻结门与五项测试夹具回归收口（2026-08-28）

- 首次冻结检查：`module:check`、`typecheck` 通过；`lint` 暴露 23 项仅位于新增测试的静态规则问题，均以等价的 const、显式删除未用字段和正则清理机械修复，未删除/跳过/弱化测试。精确 ESLint 批次与随后完整 `npm run lint` 均通过。
- 首次 `npm test` 的构建通过，Node 套件为 314/319；五个失败分成三个既有测试夹具漂移，没有产品实现回归：
  1. `rendered-html` 创建但未启动 authoritative runtime 的房间，生产删除结果现会诚实返回 `authorityCleanup:"notApplicable"`，旧精确对象断言漏掉该已被删除编排测试要求的字段。补齐断言后目标路径 1/1、相邻删除编排 2/2 通过。
  2. `combat-mechanics-v2` 的合成半掩护平面跨过初始 60 英寸生物占位，却误标 `impassable:true`；连续配置空间验证正确发现 1 英寸正体积重叠，三条原本测试穿越/反应语义的用例在到达该语义前统一拒绝。只将此仅用于 cover ray 的平面标为 `impassable:false` 并保留 `opaque:true`；原失败 3/3 与相邻 G02/G03/G14 3/3 通过。
  3. `runtime-trigger-time-v2` T04 的旧 Ready 路径从 `(0,0)` 到 `(300,0)` 穿过另外两个 PC 与 hostile 占位，新的事件 fold 几何重校验正确拒绝。只给 T04 设置 y=60 的无占位平行通道，保留两个响应竞争同一终点的核心语义；T04 1/1、T01–T05 5/5 通过。
- 修改仅涉及测试期望/夹具和 lint 等价清理；没有改生产 Geometry、规则结果、断言、skip 或 timeout。主代理将原五项与相邻几何/时间批次合并复核为 11/11，精确 ESLint 通过。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（首次冻结） | `npm run module:check`; `npm run typecheck`; `npm run lint` | 0; 0; 1 | 前两项通过；lint 仅 23 项新增测试静态规则问题。 |
| 2026-08-28（lint 收口） | 精确 ESLint 批次；`npm run lint` | 0 | 全部测试逻辑与断言保留，完整 lint 通过。 |
| 2026-08-28（首次全量） | `npm test` | 1 | build 通过；Node 314/319，五项失败均定位到上述旧夹具/精确期望；Worker suite 因 Node 门失败尚未启动。 |
| 2026-08-28（删除路径） | rendered-html 精确 name-pattern；room deletion orchestration | 0 | 1/1 + 2/2。 |
| 2026-08-28（主代理合并复核） | 六项 Geometry；T01–T05；三个修复文件精确 ESLint | 0 | 6/6 + 5/5；无生产逻辑修改。 |

### 当前剩余条件与下一步

- 在当前已收口源码上重新运行全部五项最终门；首次失败结果只作因果链证据，不能作为交付通过证据。
- 全套通过后冻结并提交部署源码；随后才读取部署阶段直接需要的 Cloudflare 指令，核对现有 Worker/D1、应用待处理 migration、部署、线上冒烟与有界日志。

## Milestone 1：Cloudflare Worker 测试并行资源争用收口（2026-08-28）

- 第二次完整 `npm test` 中 build 与 Node 319/319 已通过；Worker/Vitest 为 154 passed / 5 skipped / 4 failed。四个失败全部来自 `combat-room-randomness-v2` 的 multi-wave recovery cases，均以原 5000ms 测试门槛 timeout；没有断言差异或某个特定 recovery checkpoint 的功能失败。
- 因果证据：该文件独占单 Worker 时 11/11 通过，四个 recovery case 分别约 3648/3652/3658/3738ms；精确四项独占复核也为 4/4，约 3605–3750ms。与完整 42 文件并行时同四项一起约 5.0–5.45s 越线形成对照。分段时序显示初始化/开战/专注/交班/prepare 约 1425ms、故障注入到 crash 约 433ms、恢复 commit 约 1004ms、retry 约 254ms、archive export 约 506ms，未发现挂死或 checkpoint 特异异常。
- 复现实验：再次全量并行时前两项分别约 5433/5160ms timeout，而同一轮后两项随并发重文件退出而降至约 4152/3885ms；运行时间跟随全局负载而非 checkpoint，确认首因是 Cloudflare Miniflare/DO 测试文件并行资源争用。
- 修复：`vitest.config.ts` 只增加 `fileParallelism:false`，使 Cloudflare Worker 测试文件串行。没有提高 `testTimeout`、删除/skip/弱化断言，也没有改生产代码或随机恢复逻辑；每个 case 仍必须在原 5 秒门槛内完整通过。代价仅是最终 Worker 套件墙钟时间增加。
- 同轮出现的 `stage4-hazard-freeze-response-loss` 输出来自另一个房间 DO 实例的同步故障注入：room id、实例属性和闭包均不同，未建立跨测试全局状态/异步 listener，与四项 timeout 仅同处并行输出，不构成因果。

### 当前剩余条件与下一步

- 配置改变后重新运行 `typecheck`、`lint`、完整 `npm test` 与 `git diff --check`；只有串行 Worker 全套真实通过才接受冻结门。

## Milestone 1：最终冻结源码门 GREEN（2026-08-28）

- 最终冻结源码上的静态门全部通过：`module:check` 验证 1 个模组及 Rules/Room 权威边界；`typecheck` 与完整 `lint` 均退出 0。
- 最终完整 `npm test` 退出 0：Vinext 五阶段 build 成功；Node 为 319/319；Cloudflare Worker/Vitest 为 42/42 文件、158 passed、5 skipped。5 个 skip 均是 Goal 0002 明列的高级 tactical movement/elevation/OA/zone lifecycle 恢复入口，不属于本里程碑虚报完成项。
- Worker 串行套件仍输出一次测试专用 `stage4-hazard-freeze-response-loss` 故障注入 reporter 行，但对应测试与全套均通过；该 hook 是实例级同步 throw，随后 recovery/retry/archive 均 await 并断言，没有跨房间状态泄漏或线上代码吞错。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（最终静态门） | `npm run module:check`; `npm run typecheck`; `npm run lint` | 0; 0; 0 | 当前配置/源码通过。 |
| 2026-08-28（最终完整门） | `npm test` | 0 | build；Node 319/319；Worker 42/42 files，158 passed / 5 deferred skipped，耗时 218.73s（Worker 段）。 |

### 当前剩余条件与下一步

- 运行最终 `git diff --check`、SPEC 0001 哈希与工作区提交边界复核；严格排除 `.playwright-cli`、`.wrangler`、构建产物和本地数据库状态，保留两张一次性本地 QA 截图作为验收证据。
- 进入部署阶段：只读核对身份、现有 `zhuwei` Worker/DB、远端 migration 与版本；从提交 SHA 部署，做线上冒烟和有界日志，再写部署证据的 docs-only 交付提交并非 force 推送。

## Milestone 1：部署前 Cloudflare 只读核对与远端 D1 migration（2026-08-28）

- Cloudflare Skill 在部署阶段才加载。`npx wrangler whoami` 确认 OAuth 登录账号 `yinskyriver@gmail.com`、Account `7aca31eae821510ea477022b0c0e0e91`，具备现有 Workers/D1 写权限；缺少的 websearch/agent-memory/challenge-widget scope 与本部署无关，未重新登录、未索取 token。
- `wrangler.jsonc` 与部署配置门确认唯一目标仍是 Worker `zhuwei`、D1 binding `DB`、数据库 `zhuwei-dev` / `f5a448fd-4224-4e52-bafb-a84cb190b618`、ROOMS Durable Object；没有 Sites/Vercel、新 Worker 或新持久化资源。
- 部署前当前 100% 流量版本为 `3b22748d-9725-406e-b276-429fe99662b0`（2026-08-25T16:43:31.100Z）。远端 Git `main` 为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`，远端 `cloudflare` 为 `4bc3c3801f451a83a2491757237d3126ab7987bd`。
- 远端 D1 migration list 只列 `0006_nice_iron_lad.sql`。逐行核对为三张 authoritative 可重建归档表、索引及 `rooms.runtime_epoch_id/genesis_hash` 两个 nullable 列，无删除或数据改写。
- 用户已明确授权本里程碑部署现有 Worker；执行 `npx wrangler d1 migrations apply DB --remote`，退出 0，在现有数据库执行 11 条命令，`0006_nice_iron_lad.sql` 状态为成功。未创建任何新资源。

### 当前剩余条件与下一步

- 复查 remote migration list 为空并查询 schema；线上注册/登录/建桌路径将提供现有 D1 的最小写入—读取闭环。
- 排除本地浏览器 raw DOM 与 Wrangler 状态后提交冻结部署源码，记录 `DEPLOY_SOURCE_SHA`，只从该 commit 发布。

## Milestone 1：现有 `zhuwei` Worker 正式部署与有界线上检查（2026-08-28）

- 冻结部署源码提交：`9e3c13df6ef5ae5771d8a54468845a6ea7b477a6`。提交前索引/工作树相对 HEAD 无差异，唯一未跟踪内容为明确排除的 `.playwright-cli/` 本地 raw DOM；部署只从该 commit 运行。
- `npm run cf:deploy` 退出 0：配置门通过、Vinext 五阶段 production build 通过、11 个变更资产上传成功；仍部署到既有 `zhuwei`，URL `https://zhuwei.yinskyriver.workers.dev`，Cloudflare Version `1b9d282e-45ba-4839-bf72-3acea30eaa34`。
- `wrangler deployments status` 显示该版本自 2026-08-27T17:19:58.458Z 起获得 100% 流量；`versions view` 确认 fetch handler、compatibility date `2026-05-22`、`nodejs_compat`，以及既有 ROOMS/DB/AI/ASSETS bindings。Secret 只由控制面列出名称，未读取或记录值。
- migration 后复查：remote list 为 `No migrations to apply`；远端 schema 实际读到三张归档表、五个索引与 `rooms.runtime_epoch_id/genesis_hash` 两列。

### 线上冒烟与日志的传输层边界

- 代表性脚本计划执行根页面、匿名 401、注册/安全 cookie、开桌、锁卡、启动、`fetchTable` tactical projection、table HTML、删除房间与登出；首个 `GET /` 尚未到 Worker 即在本地 Node HTTPS 连接 10 秒超时，故没有执行任何后续写操作。
- 按合同只换一次独立浏览器通道；Chrome 在文档加载前同样超时。两个独立通道都在建立 HTTPS 连接前失败，不能支持“应用返回错误”的判断，因此没有修改业务代码，也停止继续重试。
- 有界 `wrangler tail zhuwei --format json --version-id 1b9d282e-45ba-4839-bf72-3acea30eaa34` 会话本身以 `connect ETIMEDOUT 199.16.158.8:443` 结束，未建立日志流；不能声称观察到线上请求或“零错误日志”。控制面 deploy/status/version/D1 API 同期可用，边界限定为本机到 Worker/tail 流通道。
- 远端 D1 精确查询该计划冒烟邮箱得到 `smoke_users=0`，确认未注册账号、未创建房间、无需清理。当前 D1 写入—读取证据限定为成功应用 migration 后立即读取真实 schema；没有虚报产品注册闭环。
- 本里程碑可体验证据仍包括部署前同一冻结实现的真实本地 authoritative-v2 `/table/R5CZPW` 浏览器闭环与两张 375/1440 截图；线上控制面证明版本已发布并路由 100%，但代表性 HTTP 冒烟与 tail 内容受上述外部传输层限制，最终回执必须显式列为限制。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-27T17:19Z | `npm run cf:deploy` | 0 | URL `https://zhuwei.yinskyriver.workers.dev`；Version `1b9d282e-45ba-4839-bf72-3acea30eaa34`。 |
| 2026-08-27T17:20Z | `npx wrangler deployments status`; `versions view` | 0; 0 | 新版本 100% 流量；handler/bindings/compatibility 与配置一致。 |
| 2026-08-27T17:22Z | Node 代表性线上脚本；独立 Chrome | 1; timeout | 均在首个页面连接前超时；未到 Worker、零产品写入。 |
| 2026-08-27T17:23Z | bounded `wrangler tail` | 1 | tail 连接 `ETIMEDOUT 199.16.158.8:443`，无日志内容可审计。 |
| 2026-08-27T17:24Z | remote D1 smoke-user count | 0 | `smoke_users=0`；没有残留账号/房间。 |

### 当前剩余条件与下一步

- 创建 docs-only 交付提交并以非 force 方式推送 `cloudflare`；随后用 `git ls-remote` 证明远端 `cloudflare` 等于交付 SHA、远端 `main` 仍为冻结基线。
- 推送证明完成后立即停止；延期能力保持 Goal 0002 `PENDING`，最终只标 `MILESTONE_1_COMPLETE`，不得宣称原完整计划 COMPLETE。

## 代理合同：执行日志与并行协调（2026-08-28）

- 需求：后续每次代码、测试、文档、配置、迁移、部署或 Git 交付修改都必须进入现有执行日志；测试期间新发现的问题应能在不干扰在途修复的前提下并行派工，并由主任务统一收回。
- 决策：`docs/refactor-log.md` 保持唯一执行日志，采用协调代理单写模型。独立 Fork/Worktree Worker 不并发编辑共享日志，而是返回带基线、文件、命令/退出码、commit、冲突和剩余限制的结构化回执；协调代理在集成或判定不集成时逐项登记。
- 分流：独立且文件所有权不重叠的问题进入隔离 Worktree；重叠文件/公共接口的问题先只读诊断或排队；依赖在途修改的问题等待 checkpoint；共享 D1、Durable Object、Worker、端口、migration、部署和 push 的操作串行。
- 修改：只在根 `AGENTS.md` 新增“执行日志与并行协调”全局合同，并在本日志记录该合同变更；未触碰工作区既有的 `play-table.tsx`、`tactical-map.tsx`、`tactical-map-v2.test.mjs` 或 `.playwright-cli/` 修改。
- 集成状态：本次为当前 `cloudflare` 工作区的文档规则修改，尚未提交、部署或推送；没有外部状态变更。

| 时间（UTC） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `git diff --check -- AGENTS.md` | 0 | 新增合同无 whitespace 错误；目标 diff 只增加日志门与并行分流/回收规则。 |
| 2026-08-28 | `git diff --check -- AGENTS.md docs/refactor-log.md`、目标最终 diff/status 复核 | 0 | 两个文档共新增 25 行；既有页面、测试和 `.playwright-cli/` 工作保持原状且未纳入本次修改。 |

## 建桌模型、战术地图、Delivery 与行动提交诊断（2026-08-28）

- 基线：`cloudflare` / `805bb582cc7e371d7aad94b074eb5dda35b00885`；远端 `main` 仍为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`。任务开始时 `.playwright-cli/` 已未跟踪；任务进行中另一个本地任务新增了上方代理合同与日志条目，本次保留并在其后单写集成记录。
- 症状：创建桌子没有模型选择；非战斗战术地图长期占据主界面；当前 KP 回应一闪即逝且对话区为空；所有行动统一显示“没有提交，请稍后再试”；用户同时询问安全暂停语义。
- 根因：Hall 创建请求未携带模型且服务端固定 GLM，创建后的 setter 又按设计拒绝 authoritative 房变更；战术投影每约 1.6 秒刷新但地图没有 disclosure；页面在两帧后自动 ACK 当前 Delivery，Room Authority 按隐私合同正确销毁已确认正文；本地行动原本排在当前 Delivery 后，且模糊响应丢失后的同 ID 重试会丢失首次排序锚点。行动失败的首个违反点位于当前 Cloudflare 账号/AI binding 的模型推理调用：权限、座位、DO prepare 和投影均正常，GLM、Gemma 与对照模型的 trivial/tool 调用仍停滞，生产 envelope 在 45 秒返回 `modelTransient`，世界状态未提交。现有证据只能把边界定位到账号配额、账户级路由或 Cloudflare 后端之一，不能继续区分。
- 修改：
  - `app/_runtime/lib/kp/{models,authoritative-policy,authoritative-types,authoritative}.ts`、`app/_runtime/lib/{room/server,table/server,table/client}.ts`、Hall/Table 页面与相关测试：创建期提供 GLM 4.7 Flash / Gemma 4 26B A4B，并把 model id 与版本化 Profile 一同固定到房间；action、party、correction、AI 调用及 Receipt 使用同一精确组合，未知组合 fail closed；Legacy 仍只接受原 DeepSeek 项。
  - `db/schema.ts` 与仅新增迁移 `drizzle/0007_free_black_bolt.sql`：增加非空 `rooms.kp_model_profile`，默认值只回填此前唯一合法的 authoritative GLM Profile；未修改既有迁移。
  - `app/_runtime/components/tactical-map.tsx` 与 `play-table.tsx`：地图保留实时观察者投影，探索态默认收起、战斗态默认展开，始终可手动折叠；同场景轮询保留手动状态，模式/场景切换重置默认值。
  - `play-table.tsx`、`table/authoritative.ts` 与 Delivery/HTTP 测试：删除自动 ACK，改为明确“确认当前回应”；轮询与重连保留当前单份回应，确认后仍按隐私合同不可回看。普通行动以首次 `submissionId` 同时固定本地消息 ID 与 Delivery 排序锚点，保证响应丢失后的幂等重试不重复、不倒序。模型、额度与 Room Authority 暂态错误改为稳定公开原因，仍明确“行动未提交”。
  - `tests/authoritative-service-routing-v2.test.mjs`：两条源码契约测试改为识别新的 party 包装接缝与真正的 authoritative 初始化分支；生产语义未因此改变。
  - `package.json` / `package-lock.json`：加入与 React 版本一致的 `react-test-renderer@19.2.6`，用于真实 mount/click/update 交互回归。测试运行会输出该包官方弃用警告，但不影响结果。
- 决策与秘密边界：地图只消费 `project(viewer)` 的公开投影；Delivery 继续采用单槽、显式确认后的不可恢复销毁，不建立永久叙述历史；模型调用失败不自动换模型、不延长等待伪造成功，也不把 Prompt、正文或内部错误写入遥测。安全暂停仅作只读解释，没有修改其既有权威语义。
- 并行集成：三个 Worker 分别诊断模型/Profile、地图 disclosure、Delivery/行动提交；协调代理审查合并 diff，并由只读复核补出普通顺序与模糊重试顺序两个高风险边界。后续复核清零。Worker 未修改共享日志；没有 remote migration、部署、Git commit 或 push。
- 结果：改动保留在当前未提交工作区；`0007` 必须先于对应应用代码部署。当前账号的 Workers AI 推理通路恢复前，真实模型行动仍会安全地返回 retryableFailure，不能宣称行动提交已恢复。`npm ci` 同时报告依赖图现有 12 项 audit 提示（1 low、4 moderate、7 high），本任务未执行破坏性或可能升级主版本的自动修复。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `npm ci` | 0 | 依据锁文件重装 506 个包；新增测试依赖版本与 React 对齐。 |
| 2026-08-28 | `npm run db:generate` 与本地旧 GLM 行迁移读回 | 0 | 生成并逐行检查 `0007_free_black_bolt.sql`；迁移后旧 authoritative 行得到精确默认 Profile。 |
| 2026-08-28 | 模型/Profile 定向单元与本地 Worker+D1 HTTP 回归 | 0 | 定向 49/49、HTTP 7/7；非法模型拒绝，Gemma 创建/读回成功，创建后变更拒绝，未知 Profile 返回稳定公开错误。 |
| 2026-08-28 | Delivery/地图定向组件、SSR 与 HTTP 回归 | 0 | 当前 Delivery 经轮询/重连保持到显式 ACK；地图 5/5；新增真实组件交互通过。远程 AI 探针单独复现 45 秒 `modelTransient`，未误记为成功路径。 |
| 2026-08-28 | 首次 `npm test` | 1 | 324/326 unit；两条旧源码结构断言没有识别新 party helper/Profile 前置校验。修正测试观察边界后定向 4/4。 |
| 2026-08-28 | 对话因果顺序与模糊重试测试（先红后绿） | 1 → 0 | 先复现 `[Delivery, local action]`；固定首次提交锚点后，普通响应与“响应丢失→轮询→同 ID 重试”均为 `[local action, Delivery]`。 |
| 2026-08-28 | 最终 `npm run typecheck`、`npm run lint` | 0、0 | 最终业务源码与测试通过类型和静态检查。 |
| 2026-08-28 | 最终 `npm test` | 0 | Vinext 构建通过；unit 327/327；Vitest 42/42 文件、158 通过、5 按既有条件跳过。 |

## 移除玩家安全暂停按钮（2026-08-28）

- 需求：用户明确表示不需要“立即安全暂停”按钮。
- 决策：只移除玩家主动触发入口及其未使用的浏览器 client 包装，不删除服务端 `requestSafetyPause`、Rules/Room 事件或既有暂停状态的恢复投影；因此旧房间、历史事件和已经暂停的玩家仍能选择最小呈现调整后恢复。
- 修改：`app/_runtime/components/play-table.tsx` 删除按钮、本地乐观暂停状态和请求函数；`app/_runtime/lib/table/client.ts` 删除未使用的 `requestSafetyPause` 导出；`tests/authoritative-table-v2.test.mjs` 固定“无主动按钮、保留服务端兼容与恢复 UI”的新合同。
- 集成状态：保留在当前未提交工作区；未迁移、部署、提交或推送。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 新 UI 合同定向测试（修改实现前） | 1 | 正确复现 client 导出和按钮仍存在。 |
| 2026-08-28 | `npm run typecheck` | 0 | 删除前端入口后类型检查通过。 |
| 2026-08-28 | `npx tsx --test tests/authoritative-table-v2.test.mjs tests/delivery-confirmation-v2.test.mjs tests/interaction-contract.test.mjs` | 0 | 相邻交互 29/29；确认按钮消失，Delivery 与既有恢复路径未回归。 |
| 2026-08-28 | `npm run lint` | 0 | 最终静态检查通过。 |

## 建桌、对话、地图与安全暂停修复正式发布（2026-08-28）

- 用户已明确授权提交、推送并部署。冻结部署源码为 `0a8f5817284fb421ccc78f69ce4a3bce1ac5c1f8`（`feat: improve table model and conversation flows`），已非 force 推送到远端 `cloudflare`；远端 `main` 复核仍为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- 发布前身份与资源核对通过：Wrangler `4.125.0` 使用现有 OAuth 会话，目标保持现有 Worker `zhuwei`、D1 binding `DB`、数据库 `zhuwei-dev` / `f5a448fd-4224-4e52-bafb-a84cb190b618`、ROOMS Durable Object 与 AI/ASSETS bindings；未创建新 Worker、数据库或其他资源。
- 正式冻结门通过：`npm run typecheck`、`npm run lint`、`npm test` 均退出 0；完整测试包含 production build、Node 327/327，以及 Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip。测试中的故障注入 reporter 输出为预期用例，未造成失败。
- 远端仅有 migration `0007_free_black_bolt.sql` 待应用；在现有 D1 执行 2 条命令后成功。复查为 `No migrations to apply`，并从 `pragma_table_info('rooms')` 读回非空 `TEXT` 列 `kp_model_profile`，默认值为 `authoritative-kp-profile-v1`。
- `npm run cf:deploy` 退出 0：配置门与 Vinext production build 通过，上传 11 个变更静态资产，更新现有 `zhuwei`；新 Cloudflare Version 为 `5ee177c8-8f1c-4d8d-8b9e-679178b4d629`。控制面 deployment `28ea04fb-0248-42a0-b8f2-9254e4b32c65` 显示该版本自 `2026-08-27T19:36:47.640245Z` 起承接 100% 流量。
- 代表性 `GET https://zhuwei.yinskyriver.workers.dev/` 在本机解析到 `104.16.252.55`，但 HTTPS 建连 15 秒超时、HTTP status 为 `000`，未到达 Worker；独立远程抓取通道受 URL 安全门拒绝发起请求，转用不同代理主机也在本机 TCP 建连前超时。按既有同域 Node/Chrome 双通道证据停止重试，未据此修改业务代码，也不宣称本次线上页面冒烟成功。
- Workers AI 的生产形态探针在本次发布前仍于 45 秒返回 `modelTransient`；本次发布修复了模型选择、Delivery 保留/确认、错误呈现、重试顺序、地图收起与安全暂停按钮，但不能宣称外部推理能力已恢复。恢复条件仍是当前 Cloudflare 账号的 AI binding 推理链路能在生产超时内返回。
- 发布时应用、数据库、Worker、部署配置与测试路径相对部署 SHA 无差异。发布后另一本地任务开始编辑 `AGENTS.md` 及其日志条目；这些并发文档改动和既有 `.playwright-cli/` 均未进入本次部署源码或源码提交。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `git commit`；`git push origin cloudflare`；`git ls-remote origin refs/heads/{cloudflare,main}` | 0 | 源码提交 `0a8f5817284f` 已推送；远端 `main` 未变。 |
| 2026-08-28 | `npx --no-install wrangler d1 migrations apply zhuwei-dev --remote` | 0 | `0007_free_black_bolt.sql` 执行成功；随后无待处理 migration，目标列读回正确。 |
| 2026-08-28 | `npm run cf:deploy` | 0 | 更新现有 `zhuwei`；Version `5ee177c8-8f1c-4d8d-8b9e-679178b4d629`。 |
| 2026-08-28 | `npx --no-install wrangler deployments list --json` | 0 | 新版本承接 100% 流量。 |
| 2026-08-28 | production root `curl`；独立远程抓取/代理复核 | 28；受安全门拒绝/28 | DNS 正常，连接在 HTTP 前超时；记录传输层限制，未虚报应用响应。 |

## 角色侧栏冗余入口与动作换行修复正式发布（2026-08-28）

- 基线：远端 `cloudflare` / `98ffd1d402e5ba2c5d4bdbe8fede6ecabb9f2ff6`，远端 `main` / `29eb06dc009c983ad61b2d862454503e67a7f40a`。任务开始时本地另有 DeepSeek/KP、`AGENTS.md`、本日志及 `.playwright-cli/` 等在途改动；本次通过隔离 checkpoint 与选择性暂存，只集成、提交和部署下述侧栏组件与测试，未覆盖、提交或发布其他任务的改动。
- 症状：角色侧栏重复显示“所在 · 黑橡居酒屋大厅”，提供不需要的“点火把”按钮；展开“动作”后，长动作说明的最小内容宽度把整条右栏撑宽，部分内容被横向裁掉。
- 根因：`CharacterDetail` 重复渲染了外层角色摘要已有的地点；`ResourcePanel` 直接暴露火把规则按钮；`FeatureLine` 摘要使用 `truncate`（强制单行），且外层 grid/flex/aside 滚动链缺少 `min-w-0`、横向裁剪和任意长词换行约束，浏览器按 min-content 宽度扩张侧栏。
- 修改：`app/_runtime/components/play-table.tsx` 仅移除 `CharacterDetail` 的重复地点段落和 `ResourcePanel` 的“点火把”按钮，保留摘要地点徽标、火把资源/规则及服务端能力；在 PlayTable、aside、列表、折叠栏与动作摘要链补充 `min-w-0`、`overflow-x-hidden`、`flex-wrap`、`break-words` 与 `[overflow-wrap:anywhere]`，让长文本在既有右栏宽度内换行。`tests/room-management-and-action-copy.test.mjs` 新增精确源码合同，验证冗余入口不存在、位置摘要仍保留、动作链可收缩且不再使用单行截断。
- 集成与发布：隔离 checkpoint `f93021576c3ae255e0d1a37e75b3db512a151127` 与本地 `cloudflare` 提交 `69e494e5088f1c400ff5cdc3909017c1e66e7cfa` 的 tree 均为 `0dd31105db170051750e85f7ad035d5ed4dc4c0a`；该提交已非 force 推送。部署仍使用现有 Worker `zhuwei`、现有 `DB`/ROOMS/AI/ASSETS bindings，无 schema 或 migration 修改，远端复查为 `No migrations to apply`。
- 部署结果：`npm run cf:deploy` 退出 0，配置门和 Vinext production build 通过，更新现有 `zhuwei`；Cloudflare Version `d5dd869b-7dda-4b81-877d-d997d9346fb0` 已由 deployment status 确认承接 100% 流量。远端 `cloudflare` 已等于 `69e494e`，远端 `main` 保持不变。
- 线上限制：部署后 `GET /table/H5KJNS` 的 `curl` 在 HTTPS 建连 8 秒后退出 28、status `000`；独立 Chrome 通道也在页面加载阶段超时。两个通道都未取得 HTTP/DOM 响应，按止损线停止重试；本地代码和控制面部署已验证，但不能据此宣称代表性线上页面冒烟或外部可达性已恢复。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（TDD RED → GREEN） | `npx --no-install tsx --test tests/room-management-and-action-copy.test.mjs` | 1 → 0 | 先复现重复地点；修改后 2/2，通过无火把按钮、摘要保留与动作换行合同。 |
| 2026-08-28 | `npm ci` | 0 | 隔离 worktree 依赖缺失时按 lockfile 安装 506 个包；audit 报告既有 12 项提示（1 low、4 moderate、7 high），未执行自动修复且 manifest/lockfile 无变化。 |
| 2026-08-28 | 目标 ESLint；`npm run typecheck` | 0；0 | 测试文件静态检查和类型检查通过；强制绕过项目 ignore 检查整份历史组件时另见 6 项非本次 hunks 的既有告警，未扩大修复范围。 |
| 2026-08-28（冻结门） | `npm run typecheck`；`npm run lint`；`npm test` | 0；0；0 | production build 通过；Node 327/327；Worker/Vitest 42/42 文件，158 passed / 5 个既有条件 skip。故障注入 reporter 文本未造成测试失败。 |
| 2026-08-28 | `wrangler whoami`；部署配置门；远端 migration list | 0；0；0 | 既有 OAuth 会话可用，目标仍为现有 Worker/资源；无待应用 migration。 |
| 2026-08-28 | `git push origin HEAD:refs/heads/cloudflare`；远端分支复核 | 0；0 | 只推送 `69e494e`；远端 `main` 仍为冻结基线。 |
| 2026-08-28 | `npm run cf:deploy`；`wrangler deployments status --json` | 0；0 | Version `d5dd869b-7dda-4b81-877d-d997d9346fb0` 发布并承接 100% 流量。 |
| 2026-08-28 | production table `curl`；独立 Chrome | 28；timeout | 均在得到 HTTP/DOM 前超时；记录传输层限制，不虚报应用响应。 |

## 代理合同：最小充分验证与外部探针止损（2026-08-28）

- 基线：`cloudflare` / `0a8f5817284f`；工作区已有业务代码、测试、`AGENTS.md` 与本日志的在途修改，本次只增量编辑验证合同及对应日志，没有覆盖或收回其他修改。
- 需求：开发期测试与 Workers AI 多组合超时探针累计耗时过长，需要只在关键位置验证，同时保留正式发布前的完整质量门。
- 根因与决策：原合同把所有跨层改造直接升级为 `typecheck`、Lint 与全量测试，且外部推理故障没有模型/参数/调用方式的探针止损线。验证现分为开发闭环与冻结门：开发期默认不超过三类定向检查，跨层本身不触发全量；审查和定向修复收口后，仅在发布、里程碑或影响面无法界定等条件下对同一冻结候选运行一次完整门。外部真实探针使用生产默认组合一次，只有边界仍不清时再追加一次对照。
- 修改：`AGENTS.md` 收窄并行组合回归范围，替换根因驱动的外部故障处理条款，将“适度验证”改为“最小充分验证”，增加检查失效范围、命令包含关系去重和冻结门，并把本地代码、部署与外部能力拆分报告。
- 集成状态：修改保留在当前工作区；未运行代码测试、migration、部署、提交或推送。文档规则变更按合同只执行目标段落、whitespace 与最终 diff 检查。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 目标段落复核；`git diff --check -- AGENTS.md`；`git diff --stat -- AGENTS.md`；目标 diff 复核 | 0 | 验证合同仅调整测试选择、冻结门、外部探针和完成状态表达；无 whitespace 错误，未触碰业务实现。 |

## KP 公开模型恢复为 DeepSeek 与失败边界收口（2026-08-28）

- 基线：`cloudflare` / `98ffd1d402e5ba2c5d4bdbe8fede6ecabb9f2ff6`。任务开始前工作区已有用户在途的 `AGENTS.md`、本日志修改及未跟踪 `.playwright-cli/`，本次均保留；三个 Worker 仅做模型后端、公开前端和失败重试的只读诊断/终审，没有并发写日志或源码。
- 需求与症状：用户看到“KP 模型暂时不可用或响应超时，行动未提交”，要求解释原因、恢复原 DeepSeek，只在前端提供 DeepSeek V4 Flash / Pro，并询问“确认当前回应”是否需要。
- 根因：此前 authoritative-v2 新房已从 DeepSeek 改为公开 GLM/Gemma Workers AI Profile；既有生产 envelope 中 GLM、Gemma 与对照 Workers AI 调用均在 45 秒超时，因此前端收到统一 `modelTransient` 文案。失败发生在 DO prepare 后、世界 commit 前，所以行动、虚构时间和资源均未提交。DeepSeek secret 与 legacy 接缝没有被删除，只是被排除在新规则公开目录和权威调用之外；本次只读 `wrangler secret list` 仍确认现有 Worker 存在 `DEEPSEEK_API_KEY` 名称，未读取值。
- 决策：公开目录严格只保留 `deepseek-v4-flash`、`deepseek-v4-pro`，新房精确固定对应 DeepSeek Profile 并通过同一 authoritative Adapter 调用；不自动换模型。此前已固定的 GLM/Gemma 房间仍按原精确 Profile 在服务端兼容，不允许用于新房，也不把真实 ID、Profile 或 Provider 暴露给浏览器。历史房公开投影只返回 `kp_model:null` 和通用兼容文案。`SPEC 0010` 明确要求展示后的显式 ACK，因此保留“确认当前回应”：它只销毁当前 Viewer 的单槽旁白，不确认行动、不推进世界；曾临时改成无 ACK 的测试尝试在完整复核规格后全部撤回，未进入最终 diff。
- 修改：
  - `app/_runtime/lib/kp/{models,authoritative-policy,authoritative-types,authoritative-helpers,authoritative,deepseek,provider,engine}.ts`：新增 DeepSeek authoritative Chat Completions binding；转发 AbortSignal，转换 token 参数，保留 required tool call；402、429、5xx、422、缺密钥及 HTTP 200 `insufficient_system_resource` 进入稳定脱敏分类。公开两个 DeepSeek Profile，历史 Workers AI Profile 独立冻结并仅作服务端兼容。
  - `app/_runtime/lib/{room/server,table/server,table/client}.ts`、`app/_runtime/components/play-table.tsx`、Hall/Table 页面：Room action、party 与 correction 按房间 Profile 选择真实 Provider；新建只接受两个 DeepSeek；公开 Room DTO 不返回 `kp_model_profile`，历史模型 ID 投影为 `null`；数据库行保持 `string` 并在 authoritative/legacy 分支显式收窄。页面只渲染两个 DeepSeek 选项或“历史兼容模型”。
  - `tests/{deepseek-authoritative-provider,authoritative-kp-adapter,authoritative-table-v2,interaction-contract,rendered-html}.test.mjs`：覆盖 DeepSeek 请求协议、状态/容量/超时分类、缺密钥、四个精确 Profile、公开目录/DTO、非法隐藏模型拒绝和本地 Worker+D1 创建读回。`docs/specs/decision-register.md` 与 `SPEC 0011` 同步用户的新模型决策；无 schema/migration 变化。
- 失败与收口：模型目录 RED 探针两次退出 1，实际仍为 GLM/Gemma；首轮定向实现为 42/43，仅旧源码正则不匹配新 binding，修正观察点后通过。首轮 typecheck 因隐藏历史 model 被错误收窄为公开 union 退出 2；公开 DTO 收口后又暴露五个 Legacy 调用缺少显式 model guard，均在真实分支加 fail-closed 收窄后通过。`eslint --no-ignore` 首次发现新 `deepseek.ts` 一个未用解构字段及被项目配置长期忽略的九项既有 runtime 告警；只修正本次字段，最终对新增/直接相关 KP 文件的显式 lint 与项目 lint 均通过。
- 集成状态：本地代码与安全失败路径已验证，改动仍在未提交工作区；未运行真实 DeepSeek 外部调用，不能宣称线上 KP 能力已恢复。未执行 D1 migration、部署、流量变更、Git commit 或 push；远端现有 Worker 仍运行此前版本。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（TDD RED） | DeepSeek 公开目录精确断言 | 1（预期 RED） | 实际为 GLM/Gemma，复现“DeepSeek 从新房公开目录消失”。 |
| 2026-08-28 | `npx tsx --test tests/deepseek-authoritative-provider.test.mjs tests/interaction-contract.test.mjs tests/authoritative-kp-adapter.test.mjs tests/delivery-confirmation-v2.test.mjs tests/authoritative-table-v2.test.mjs` | 0 | 47/47；DeepSeek tool/错误/Abort、Profile、公开目录、Delivery ACK 与 authoritative table 合并通过。 |
| 2026-08-28 | `npm run build && npx tsx --test tests/rendered-html.test.mjs` | 0 | Vinext production build 通过；本地 Worker+D1 HTTP 7/7，大厅只渲染 DeepSeek 两项，隐藏模型 ID 被拒绝，公开 room 不含 Profile。 |
| 2026-08-28 | authoritative action + Room retry 两条失败不推进定向测试 | 0 | 1/1 + 1/1；模型暂态失败保留原 prepared action，不提交 WorldEvent、不推进状态。 |
| 2026-08-28 | `npm run typecheck && npm run lint`；新增/相关 KP runtime 显式 ESLint | 0 | 最终类型、项目静态检查和 DeepSeek/models/policy/provider 显式 lint 通过。 |
| 2026-08-28 | `npx --no-install wrangler secret list` | 0 | 只读确认现有 Worker 有 `DEEPSEEK_API_KEY` secret 名称；未读取值、未调用模型、未修改控制面。 |
| 2026-08-28（并行只读复核） | rendered-html 目标筛选探针；同 checkpoint 含 Worker warm-up 重跑 | 1 → 0 | 首次因共享测试 Worker 初始化竞态出现临时 `SQLITE_BUSY` 并中止；按夹具顺序重跑 3/3，通过建房/桌面快照与管理 DTO。Worker 未改文件，主代理独占完整 HTTP 套件另为 7/7。 |

## DeepSeek 发布前冻结与远端引用门（2026-08-28）

- 用户已明确授权提交、推送并部署。冻结基线为当前 `cloudflare` / `982bcf095572a256248736980c853b4e621480e2`；任务期间并行完成的侧栏提交 `69e494e5088f1c400ff5cdc3909017c1e66e7cfa` 及其日志提交 `982bcf0` 已进入该基线，本次最终完整门在两者之后运行。远端 `main` 仍为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- 首轮完整门在 Node 332/333 失败：`observer-http-privacy-v2` 的本地 `unstable_dev` 夹具未注入 DeepSeek 测试密钥，建房提前返回“DeepSeek V4 Flash 尚未配置 API 密钥”，没有进入该用例要验证的观察者隐私路径。只在该本地夹具加入假值 `DEEPSEEK_API_KEY=local-observer-test-key`，不写入生产 Secret；定向用例随后 1/1，通过完整门为 Node 333/333、Worker/Vitest 158 passed / 5 个既有条件 skip。
- 远端 ProfileRef 只读门首次返回 `invalidGateInput`；Wrangler 的 D1 错误码 7500 明确指出复合 `UNION ALL` 查询的第二个 `ORDER BY` 项不匹配结果列。根因是发布门 SQL 用源表列名排序复合结果；改为按输出列序号 `ORDER BY 2, 4, 1`，并新增 SQL 形态回归。定向门 5/5，通过后同一远端只读查询确认 2 个现有房间只引用已打包的 `runtime-srd51-2014-authoritative-v2` 清单，未发现未知 ProfileRef。
- Cloudflare 只读发布检查通过：Wrangler `4.125.0` 使用现有 OAuth 会话；`wrangler.jsonc` 仍只指向现有 Worker `zhuwei`、现有 D1 `zhuwei-dev` / `f5a448fd-4224-4e52-bafb-a84cb190b618`、`DB`、`ROOMS`、`AI` 与 `ASSETS` bindings；Secret 列表仅确认已有 `DEEPSEEK_API_KEY` 名称，不读取值；远端为 `No migrations to apply`。当前线上仍为侧栏版本 `d5dd869b-7dda-4b81-877d-d997d9346fb0`，100% 流量，本节记录时尚未执行本次 Git push 或 Worker 部署。
- 最终冻结候选在上述两个修正后执行一次完整门：模块边界、typecheck、项目 lint、Vinext production build 均退出 0；Node 334/334；Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip。故障注入 reporter 文本为预期覆盖，未造成测试失败。后续只允许增加部署事实日志，不再修改已验证的生产源码或测试。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 首轮 `npm run module:check && npm run typecheck && npm run lint && npm test` | 1 | 模块、类型、lint、build 通过；Node 332/333，唯一失败为观察者 HTTP 夹具缺少本地假 DeepSeek secret。 |
| 2026-08-28 | `npx tsx --test tests/observer-http-privacy-v2.test.mjs` | 0 | 修正夹具后 1/1，进入并通过原定隐私路径。 |
| 2026-08-28 | 第二轮 `npm run typecheck && npm run lint && npm test` | 0 | Node 333/333；Worker/Vitest 42/42 文件、158 passed / 5 skipped。 |
| 2026-08-28 | 初次远端 ProfileRef SQL → SQL 形态回归 → 修正后远端门 | 1 → 0 → 0 | 首次为 D1 code 7500；定向门 5/5；远端 2 个房间引用均在部署清单中。 |
| 2026-08-28 | 最终 `npm run module:check && npm run typecheck && npm run lint && npm test` | 0 | 最终冻结候选：Node 334/334；Worker/Vitest 158 passed / 5 skipped，production build 通过。 |
| 2026-08-28 | `wrangler whoami`；部署配置门；Secret/migration/deployment 只读检查 | 0 | 现有账号、Worker、绑定和 D1 配置一致；无 migration；部署前线上 Version `d5dd869b` 为 100%。 |

## DeepSeek KP 模型恢复正式发布（2026-08-28）

- 用户明确授权“推送部署”。冻结源码提交 `d817e88f111d3ba9a64766b345af8a185cf4bac7`（`fix: restore DeepSeek KP models`）已非 force 推送到远端 `cloudflare`；推送后 `git ls-remote` 证明远端分支等于该 SHA，远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- `npm run cf:deploy` 依次通过现有部署配置门和 Vinext production build，上传 10 个新增或变化静态资产，只更新现有 Worker `zhuwei`。Cloudflare Version `80d665fe-01e5-4f2b-b608-4454cf903b75` 已由 deployment `a3af697d-1516-42bb-ba2b-d5483de5568a` 确认承接 100% 流量。
- `wrangler versions view` 复核新版本仍为 `fetch` handler、compatibility date `2026-05-22`、`nodejs_compat`；绑定仍为现有 `ROOMS`、D1 `DB` / `f5a448fd-4224-4e52-bafb-a84cb190b618`、`AI`、`ASSETS`，Secret 名称仍为 `DEEPSEEK_API_KEY`。没有创建资源、修改 Secret、执行 D1 migration 或改变 `main`。
- 代表性生产根入口 `curl` 在 HTTPS 建连 8 秒后退出 28，HTTP status `000`，没有到达 Worker；独立远程抓取通道因 URL 安全门拒绝发起请求。按既有同域多次本地/Chrome 传输层超时证据和探针止损线停止重试，未为此修改业务代码。
- 结论分层：本地冻结源码、失败不提交、公开只显示两个 DeepSeek、历史模型后台兼容及部署控制面均已验证；部署完成。由于本次无法从生产入口提交代表性真实行动，也未读取 Secret 值或绕过产品入口直连模型，外部 DeepSeek 推理能力仍未被生产探针证明，不能宣称“线上 KP 能力已恢复”。恢复确认条件是生产房间使用任一 DeepSeek 选项在既定超时内产生并提交一次真实 KP 回应。
- 本地未跟踪 `.playwright-cli/` 始终未纳入源码或日志提交。部署后只增加本节事实记录，不修改已冻结和部署的生产源码、测试或配置，因此不使已通过的完整门失效。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `git commit`；`git push origin HEAD:refs/heads/cloudflare` | 0；0 | 源码提交 `d817e88` 已非 force 推送。 |
| 2026-08-28 | `git ls-remote origin refs/heads/{cloudflare,main}` | 0 | `cloudflare=d817e88`；`main=29eb06d`，冻结基线未变。 |
| 2026-08-28 | `npm run cf:deploy` | 0 | 配置门、production build 与上传通过；新 Version `80d665fe-01e5-4f2b-b608-4454cf903b75`。 |
| 2026-08-28 | `wrangler deployments status --json`；`wrangler versions view 80d665fe-…` | 0；0 | 新版本 100% 流量；handler、compatibility、Secret 名称与原绑定一致。 |
| 2026-08-28 | production root `curl`；独立远程抓取 | 28；受安全门拒绝 | 首个通道在 HTTP 前超时，第二通道未发起请求；记录外部传输限制并停止重试。 |

## 简洁战术地图布局、响应式焦点修复与发布前冻结（2026-08-28）

- 基线与范围：从最新远端 `cloudflare` / `388b527dc9e91346b4dfd1eb603b8b5b4178074a` 建立隔离集成 Worktree；远端 `main` 为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`。原工作区同时存在 KP、文档、侧栏与浏览器产物等其他在途改动，本次只收回 `app/_runtime/components/tactical-map.tsx`、`tests/fixtures/tactical-map-v2.mjs`、`tests/tactical-map-interaction-v2.test.mjs`、`tests/tactical-map-v2.test.mjs` 四个文件。两个只读范围审计确认 `388b527` 相对原地图 checkpoint 的远端提交未修改这些文件或 TacticalMap 接口；没有合入旧工作区整份日志、KP/Room/Table 改动或浏览器原始状态。
- 需求与决策：桌面战斗态默认展开一块约 314px 高的内联地图，探索态默认收起；移动端只显示紧凑入口，打开后使用全屏 dialog。地图与文字版互斥；实体、环境要素与已知区域均可点选/键盘选中。移动、视线、区域传播与掩护除颜色外分别使用实线/虚线、斜线纹理、点状纹理和 `½`/`¾`/`全` 标记；高程、尺寸、状态、地形、遮挡和传播均使用中文详情。选择与展开只保存在客户端，不写入 Room、Rules 或 D1；组件只消费观察者公开 `TacticalProjection`，没有建立第二机械/状态权威或暴露隐藏几何。
- 集成复审根因与修复：首轮复审发现移动 dialog 打开后跨入桌面 `lg` 断点时，`lg:hidden` 只隐藏 DOM，原 effect 仍可能锁定 `body` 并把 Tab 困在不可见 dialog。组件现监听与 Tailwind v4 `lg` 同源的 `(min-width: 64rem)`；跨断点时关闭 dialog，cleanup 移除键盘和 MediaQuery 监听、恢复原 `body.overflow`，并将焦点交给可见桌面入口；Escape/普通关闭仍还焦移动入口。初稿使用 effect 内同步 `setState`，目标 ESLint 以 `react-hooks/set-state-in-effect` 退出 1；改为仅在“effect 建立时已处于桌面”这一竞态下用 `requestAnimationFrame` 收口，随后显式 ESLint 通过。复审另指出 `1024px` 与 `64rem` 在用户默认字号下不等价，修正为 `64rem` 后阻断清零。
- 浏览器验收：一次性本地预览路由通过 Playwright 启动真实 PlayTable，验收后已删除，未进入提交。1440×900 下地图盒为 `1022×314`、页面 `scrollWidth=1440`，最新侧栏保持独立收缩/滚动，三种 SVG pattern 与铁门中文详情可见；375×812 下入口保持紧凑，dialog 为 `375×812`、`body.overflow=hidden`，初始焦点在关闭按钮，Shift+Tab 到图例 summary、Tab 回到关闭按钮，Escape 后 dialog 消失、滚动解锁并还焦入口。最终断点探针在 1023px 确认移动入口可见且 `64rem` 查询为 false；打开后调整到 1024px，CSS 与 JS 同时切换、dialog 消失、滚动解锁、焦点落到可见桌面入口，下一次 Tab 进入桌面地图页签。控制台均为 0 error / 0 warning。一次详情探针因未限定可见实例同时匹配隐藏桌面与移动详情而 strict-mode 失败，改为 dialog-scoped locator 后通过；这是自动化定位问题，不是产品错误。两张最终预览图保存于工作区外的 Codex visualization 目录；仓库内截图与 `.playwright-cli` 原始状态已移到废纸篓，可恢复且未提交。
- 冻结与外部状态：最终生产源码提交候选为 `9ecc6f93b5bf4e8d2d28995f3d5e5b2b7b912991`。隔离 Worktree 首次缺少依赖，`npm ci` 按锁文件安装 506 个包并退出 0，报告既有 12 项 audit 提示（1 low、4 moderate、7 high）；未自动修复，manifest/lockfile 无变化。首次完整门在 `1024px` 候选上通过，但因复审要求改为 `64rem` 而失效；最终候选重新运行完整冻结门并通过。发布前 Wrangler `4.125.0` 的现有 OAuth 会话、部署配置门、Secret 名称、远端 migration 与当前 deployment 均只读核对成功：目标仍为现有 `zhuwei`、`DB` / `zhuwei-dev`、ROOMS/AI/ASSETS，`DEEPSEEK_API_KEY` 值未读取，远端为 `No migrations to apply`，当前版本 `80d665fe-01e5-4f2b-b608-4454cf903b75` 承接 100% 流量。本节记录时尚未 push、migration apply 或 deploy，未创建资源。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `npm ci` | 0 | 安装 506 个锁定依赖；12 项既有 audit 提示，未改 manifest/lockfile。 |
| 2026-08-28 | 目标 ESLint；地图组件定向测试 | 1 → 0；0 | 首稿同步 effect state 被静态门拒绝并修正；最终地图 5/5。 |
| 2026-08-28 | Playwright 1440/375 视觉与键盘验收；1023→1024 断点恢复 | 0 | 无溢出；焦点 trap/Escape/还焦/滚动锁清理与 `64rem` 跨断点均通过，控制台 0 error / 0 warning。 |
| 2026-08-28 | 最终 `npm run module:check && npm run typecheck && npm run lint && npm test` | 0 | production build；Node 334/334；Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip。故障注入 reporter 文本未造成失败。 |
| 2026-08-28 | `wrangler --version`；`whoami`；部署配置门；Secret/migration/deployment 只读检查 | 0 | 现有账号、Worker、绑定和 D1 一致；无待处理 migration；发布前版本为 100% 流量。 |

## 简洁战术地图正式发布（2026-08-28）

- 用户明确授权“修好后尝试合并，无错后推送部署”。功能提交 `9ecc6f93b5bf4e8d2d28995f3d5e5b2b7b912991` 与发布前日志提交 `81f5fdaaf301813109796518f18edc91844e15f9` 已从 `388b527` 非 force 快进推送到远端 `cloudflare`；推送后 `git ls-remote` 证明 `cloudflare=81f5fda`，`main` 仍为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- `npm run cf:deploy` 退出 0：部署配置门与 Vinext 五阶段 production build 通过，上传 10 个新增或变化静态资产，只更新现有 Worker `zhuwei`。新 Cloudflare Version `4a0666e7-87cb-4bf5-8af3-794159ad7efe` 已由 deployment `a7d86980-0742-4b94-96c9-e8587f3647be` 确认自 `2026-08-27T21:59:20.734388Z` 起承接 100% 流量。
- `wrangler versions view` 复核 handler 为 `fetch`、compatibility date `2026-05-22`、flag 为 `nodejs_compat`；绑定仍为现有 ROOMS、D1 `DB` / `f5a448fd-4224-4e52-bafb-a84cb190b618`、AI、ASSETS，Secret 名称仍为 `DEEPSEEK_API_KEY`。没有创建资源、修改 Secret 或执行 migration。
- 代表性生产根入口 `curl` 在 0.21 秒内退出 7，HTTP status `000`，没有取得远端 IP 或 HTTP 响应；独立远程抓取通道因 URL 安全门以 non-retryable 拒绝，未发出请求。按同域既有多轮传输层证据与探针止损线停止重试，未据此修改业务代码。结论分层：本地源码与浏览器交互已验证，Cloudflare 部署完成且控制面为 100% 流量；本次未取得生产页面响应，不能宣称外部页面可达性已恢复。
- 部署后只增加本节事实记录，没有修改已冻结和已部署的生产源码、测试、依赖、配置或 fixture，因此完整门仍有效。后续交付提交为 docs-only，不要求再次部署；其远端分支状态将在提交后复核。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `git push origin HEAD:refs/heads/cloudflare`；`git ls-remote origin refs/heads/{cloudflare,main}` | 0；0 | `cloudflare=81f5fda`；`main=29eb06d`，非 force 快进且冻结基线未变。 |
| 2026-08-28 | `npm run cf:deploy` | 0 | 配置门、production build、10 个变化资产上传通过；Version `4a0666e7-87cb-4bf5-8af3-794159ad7efe`。 |
| 2026-08-28 | `wrangler deployments status --json`；`versions view 4a0666e7-…` | 0；0 | 新 deployment 为 100% 流量；handler、兼容性、Secret 名称与既有绑定一致。 |
| 2026-08-28 | production root `curl`；独立远程抓取 | 7；受安全门拒绝 | 未获得远端 IP/HTTP；记录传输层限制并停止重试，不虚报应用响应。 |

## DeepSeek KP Proposal 引用绑定修复（2026-08-28）

- 基线与诊断发布：从远端 `cloudflare` / `ff115990e6cf92d1f1575425a05cb0268374b8c8` 开始；分层诊断提交 `42672a90834fc5c3dd2c85724b7646836e5da229` 已非 force 推送并更新现有 Worker `zhuwei`。Cloudflare Version `f7b4987e-cfe9-4d01-81ec-6439eb64a934`、deployment `f4d8d833-e356-49cd-9b9a-a07ee2d25560` 已确认承接 100% 流量；既有 `ROOMS`、`DB`、`AI`、`ASSETS` 与 `DEEPSEEK_API_KEY` Secret 绑定不变，无 migration 或新资源。
- 精确生产证据：在一次性测试房 `8BTWKL` 使用公开默认 `deepseek-v4-flash` 提交“我站在原地环顾大厅，寻找明显可见的出口，不触碰任何物品。”。脱敏 Cloudflare Tail 返回 Proposal `modelResult=modelPermanent`、`errorCode=projectionBinding`、耗时 `7650ms`、输入/输出/总 token `48745/667/49412` 且响应哈希存在；这证明模型 HTTP 调用和 Proposal schema 均成功，首个违反不变量的位置是模型引用没有逐字命中 KP 投影。Room 未 commit，页面未得到内部阶段、Prompt、投影或原始输出。临时 Tail 会话随后删除成功。
- 根因：`assertProposalProjectionBound` 正确地对 basis、动态因果、旧先例与 NPC 有限知识引用执行精确字符串绑定，但 system prompt 与工具 schema 只声明了字符串数组，没有告诉 DeepSeek“引用必须从 `kpProjection` 对应范围逐字复制、不能使用 JSON 路径/释义/新造 ID、无依据时用空数组”。因此模型产生 schema-valid Proposal 后仍会在 Adapter 后处理被拒绝。
- 修复决策：不放宽 validator、不猜测映射、不自动切换模型、不伪造成功。`app/_runtime/lib/kp/authoritative-policy.ts` 在 system prompt 和具体 ref schema 中补齐逐字引用合同，并为首轮 `projectionBinding` 提供同一固定模型的内部纠错载荷；`app/_runtime/lib/kp/authoritative-helpers.ts` 把 causal 引用收窄为投影中已固化事实的 ID，与生产 Rules 的 `state.canonicalFacts` 要求一致；`app/_runtime/lib/kp/authoritative.ts` 只允许一次纠错，与首调用共享原 45 秒总预算。纠错只能删除已证明非法的数组引用或 NPC 行动；合法引用、合法 NPC 行动和先例 ID 必须原样保留，禁止添加替代引用、改派 NPC、改指先例或改变目标、做法、裁决、风险、机械方案、动态定义与场景。第二次仍错、超时或改判立即使用原稳定错误失败，绝不进行第三次内部调用或世界提交。Room 的后续 Rules 机械修订仍只有原一次调用，因此每根行动最多三次 Proposal 调用。
- 版本处置：模型 ID、温度、Proposal 验证形态与叙事语义均未改变；Prompt、Tool 描述与纠错策略已显式升级为 `authoritative-kp-prompt-policy-v5`，DeepSeek 与仍调用同一 Adapter 的历史服务端 Profile Receipt 均记录 v5，从而可与修复前 v4 调用区分。房间仍按原模型 Profile 固定，不做 D1 数据迁移；实际代码提交、部署版本和每次调用 Receipt 共同保留审计链。
- 当前集成状态：实现、定向测试、独立复审与同一候选的正式冻结门已完成；尚未形成根因修复提交、推送或部署。本节后续会补记发布版本、真实 Proposal→commit→Narration→Delivery 与测试房清理结果。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 分层诊断 `git push`、`npm run cf:deploy`、deployment status | 0 | `42672a9` 已推送；Version `f7b4987e-…` / deployment `f4d8d833-…` 为 100% 流量，远端 `main` 未变。 |
| 2026-08-28 | 生产 V4 Flash 行动 + 脱敏 Cloudflare Tail | 应用拒绝 / Tail 成功 | 精确定位 `projectionBinding`；模型 2xx/schema-valid，世界状态未提交。 |
| 2026-08-28（TDD RED → GREEN） | `npx tsx --test tests/authoritative-kp-adapter.test.mjs` | 1 → 0 | RED 精确缺少逐字引用合同与内部纠错；GREEN 13/13，覆盖 basis、Rules-compatible 动态因果、NPC 知识、合法 NPC 保留、禁止改派/改指先例、持续失败、改判拒绝、无第三次调用和共享总超时。 |
| 2026-08-28 | authoritative Adapter/Room/DeepSeek/遥测/交互/Rules 定向组合 | 0 | 81/81；成功与失败不提交、脱敏 Receipt、公开模型目录、Provider Abort/错误分类及 causal Rules 合法性均未回归。 |
| 2026-08-28 | `npm run typecheck`；`git diff --check` | 0；0 | 当前生产 TypeScript 与补充测试类型正确，无 whitespace 错误。 |
| 2026-08-28 | 独立只读修复复审 | HIGH 3 → 0 | 首轮发现合法 NPC/先例可被改写、causal 合同宽于 Rules、Prompt 版本未升级；逐项修正并补测试后复审确认无新 blocker。 |
| 2026-08-28（最终冻结门） | `npm run typecheck && npm run lint && npm test` | 0 | Prompt v5 与收紧保真门的同一候选：production build 通过；Node 335/335；Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip。故障注入 reporter 文本未造成失败。 |

## DeepSeek V4 Flash 真实回话失败的 Proposal 分层诊断（2026-08-28）

- 基线与范围：从最新远端 `cloudflare` / `ff115990e6cf92d1f1575425a05cb0268374b8c8` 新建干净克隆；远端 `main` 只读复核仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。原目录的 `AGENTS.md`、`docs/refactor-log.md` 与 `.playwright-cli/` 在途文件未被覆盖或纳入。三个 Worker 只读审计 DeepSeek 协议、Proposal→Narration 管线与生产观测入口，没有编辑文件、日志、控制面或远端。
- 症状与安全不变量：生产测试房 `8BTWKL` 使用 `deepseek-v4-flash`；提交“我站在原地环顾大厅，寻找明显可见的出口，不触碰任何物品。”后，输入恢复、当前 Delivery 与世界投影不变，前端保持稳定文案“权威 KP 模型配置或输出无效。”，没有伪造成功或提交世界、时间、资源变化。
- 生产证据：现有 `room.model.invocation.completed` 脱敏遥测记录 `modelTask=proposal`、`modelResult=modelPermanent`、调用耗时 `6845ms`、输入/输出/总 token 为 `48751/706/49457`、`modelResponseHash` 存在。由此确定 DeepSeek HTTP 2xx 已返回，排除缺密钥、401/400/422 与 2000-token 截断；失败发生在 Proposal 响应提取、Proposal schema 校验或 KP 投影引用绑定之一，且在 Room commit 前。
- 观测通道处置：本机 `wrangler tail` 到 Cloudflare Tail WebSocket 发生 TCP 超时；Workers Observability 历史查询 API 因当前 OAuth 缺少该权限返回 403，Cloudflare Dashboard 当前 Chrome 会话未登录。随后只用现有 Wrangler OAuth 创建临时 Tail，让 Chrome 连接 `tail.developers.workers.dev`，过滤 `room.model.invocation.completed` 并在本地页面仅保留任务、模型、耗时、token 数及响应哈希是否存在；未读取或输出 Cookie、Secret、Authorization、Prompt、投影、工具参数或模型正文，Tail 用后删除。
- 决策与修改：不放宽权威 Proposal validator，也不自动换模型。`app/_runtime/lib/kp/authoritative-types.ts` 为内容无关的模型 Receipt 增加共享、固定的三值 `failureStage` 枚举；`app/_runtime/lib/kp/authoritative.ts` 只将已由生产证据锁定的 Proposal 结构提取、schema 校验和投影绑定三个后处理边界分开归因，并只捕获协议校验异常，其他程序异常继续抛出；`app/_runtime/lib/room/telemetry.ts` 把这三个固定值映射到既有 `errorCode` 白名单。`tests/authoritative-kp-adapter.test.mjs`、`tests/structured-telemetry-v2.test.mjs` 先红后绿覆盖三个阶段及脱敏遥测，`tests/authoritative-action.test.mjs` 证明内部阶段不会进入公开 Room 结果；前端公开文案与结果结构不变。
- 当前集成状态：本节记录时已完成本地分层实现、双轴复审收口和最终发布冻结门，复审没有代码或规格阻断；尚未提交、推送或部署该诊断版本，没有 schema/migration、Secret 或 Cloudflare 资源变化。下一步部署同一现有 Worker，用同一 Flash 行动取得精确 `errorCode`，再在首个违反不变量的位置修复并完成真实 Proposal→commit→Narration→Delivery。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `npm ci` | 0 | 新克隆安装锁定的 506 个包；报告既有 12 项 audit 提示（1 low、4 moderate、7 high），未自动修复，manifest/lockfile 未变。 |
| 2026-08-28 | 生产 Chrome 提交 + Cloudflare 脱敏 Tail | 应用拒绝 / Tail 成功 | 取得上述 Proposal 2xx 后失败证据；世界与当前 Delivery 未变化。 |
| 2026-08-28 | `npx wrangler tail zhuwei --format=json`；Observability query API | TCP `ETIMEDOUT`；HTTP 403 | 两条读取限制均记录；改走浏览器 Tail，没有误判为 Worker 故障。 |
| 2026-08-28（RED） | `npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/structured-telemetry-v2.test.mjs` | 1 | 18/20；失败精确证明旧 Receipt 无阶段且遥测只能返回 `modelUnavailable`。 |
| 2026-08-28（GREEN） | `npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/authoritative-action.test.mjs tests/structured-telemetry-v2.test.mjs` | 0 | 35/35；三个 Proposal 后处理阶段、固定遥测映射、公开结果不携带内部阶段均通过。 |
| 2026-08-28 | `npm run typecheck` | 2 → 0 | 首次发现 Narration 草稿误标为完整 Delivery 类型；改用 `CurrentNarrationDraft` 后通过。 |
| 2026-08-28（收窄前冻结候选） | `npm run typecheck && npm run lint && npm test` | 0 | production build 通过，Node 334/334，Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip；随后按复审意见收窄生产诊断分支并补测试，因此该结果不作为最终发布门。 |
| 2026-08-28（最终冻结门） | `npm run typecheck && npm run lint && npm test` | 0 | 对复审收口后的最终生产代码和测试重跑：production build 通过，Node 334/334，Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip；故障注入 reporter 文本未造成测试失败。 |
| 2026-08-28 | 部署配置门；Secret/migration/deployment/远端 refs 只读检查 | 0 | 目标仍为现有 `zhuwei`、`DB` / `zhuwei-dev`、ROOMS/AI/ASSETS；仅确认 `DEEPSEEK_API_KEY` 名称，无 migration；发布前 Version `4a0666e7` 为 100%，远端 `main` 未变。 |

## DeepSeek KP Projection 确定性引用归一化（2026-08-28）

- 基线与上一轮发布：引用提示与单次同模型纠错修复已形成提交 `11a8113d0809e5d40ce793391c2b1cafe3e3695d`，非 force 推送到远端 `cloudflare`，并只更新现有 Worker `zhuwei`。Cloudflare Version `a52c65b2-44d6-43ba-809d-0940352a7817` / deployment `8467b66b-57a3-4084-a883-ee1ec4fa636e` 已确认承接 100% 流量；既有 ROOMS、DB、AI、ASSETS 与 Secret 名称不变，无 schema、migration 或新资源。
- 上一轮生产结果：在一次性房间 `8BTWKL` 清除初始 Delivery 后，多次通过真实产品入口提交同一 V4 Flash 行动，输入最终均完整恢复、发送按钮恢复、没有新 Delivery，也没有行动进入对话投影，证明仍为 commit 前安全失败。此前已取得的精确 Tail 证据仍是 schema-valid Proposal 在 `projectionBinding` 被拒绝；新增的第二次随机模型纠错未让真实路径达到可用状态，并显著增加等待时间，因此不能保留为生产恢复方案。
- Cloudflare 日志边界：Workers Logs/Live Tail 可以读取；本轮浏览器 Tail WebSocket 以 `1006` 断开，另一次无过滤 Tail 也未收到 frame；Workers Observability 历史查询 API 对现有 Wrangler OAuth 返回 HTTP 403 / code 10000，Dashboard Chrome 会话未登录。没有申请新 token，也没有输出 Prompt、正文、Cookie、Secret 或 Authorization。最后一次本地 Tail collector 已停止；其删除请求因进程持有的 OAuth 已失效返回 401，未把“删除成功”写入证据。
- 根因与决策：DeepSeek 已能形成 schema-valid 的完整裁决，失败只来自四类投影引用字段中的臆造或释义引用；让模型再次猜测这些引用既不确定，也会重新消耗一次完整生成。Adapter 现在只调用模型一次，随后在服务端对已通过 Proposal schema 的对象做确定性归一化：public/private basis 只保留投影中逐字存在的字符串，动态与隐藏候选 causal refs 只保留 canonical/visible fact ID，未知 NPC 或越过该 NPC 有限知识边界的整项 NPC action 直接省略。有效值及顺序、有效 NPC 整项和所有其他 Proposal 语义必须原样保留；旧先例或其他不可归一化错误继续以 `modelPermanent/projectionBinding` fail closed。
- 修改：`app/_runtime/lib/kp/authoritative.ts` 删除第二次 Proposal 模型纠错和第二个超时窗口，加入上述确定性过滤并复用完整结构保真门与最终严格绑定验证；`app/_runtime/lib/kp/authoritative-policy.ts` 删除失效的 repair payload/提示，保留逐字复制合同并把 DeepSeek 与历史服务端 Profile 的 Prompt policy 统一升级为 `authoritative-kp-prompt-policy-v6`；`tests/authoritative-kp-adapter.test.mjs` 固定一次模型调用、一次 Receipt、合法引用/NPC 保留、非法引用/NPC 省略及非法先例继续拒绝。
- 前端与产品边界：未修改公开模型目录、Hall/Table 页面或 Room DTO；前端仍只可选择 DeepSeek V4 Flash / Pro，其他历史 Profile 仅服务端兼容。没有自动换模型、伪造引用、吞掉不可归一化错误或建立第二套机械/状态权威。
- 集成状态：确定性 v6 候选已完成定向测试、类型检查、whitespace 检查和独立只读复审，复审未发现 blocker/HIGH；本节记录时尚未运行发布冻结门、提交、推送或部署，也尚未取得真实 Proposal→commit→Narration→Delivery。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | v5 `git push`、`npm run cf:deploy`、deployment status | 0 | `11a8113` 已推送；Version `a52c65b2-…` / deployment `8467b66b-…` 为 100% 流量，远端 `main` 未变。 |
| 2026-08-28 | 生产 V4 Flash 同一行动复测 | 应用拒绝 | 多次均无行动或 Delivery commit；输入恢复，状态保持，不能宣称 v5 恢复。 |
| 2026-08-28 | Live Tail；Observability query；Tail cleanup | WebSocket `1006` / 0 frame；HTTP 403；HTTP 401 | 记录读取和清理限制；本地 collector 已停止，没有取得或泄露内容型数据。 |
| 2026-08-28（TDD RED → GREEN） | `npx --no-install tsx --test tests/authoritative-kp-adapter.test.mjs` | 1 → 0 | RED 复现旧实现请求第二次模型 fixture；GREEN 13/13，一次模型调用后确定性收窄引用。 |
| 2026-08-28 | Adapter/Room/DeepSeek/遥测/交互/Rules 定向组合 | 0 | 85/85；成功与安全失败、Receipt、Provider、交互及 Rules 接缝未回归。 |
| 2026-08-28 | `npm run typecheck`；`git diff --check`；独立只读复审 | 0；0；无 blocker/HIGH | v6 候选类型与 whitespace 正确；复审确认只过滤四类可归一化字段，其他语义严格保真。 |

- 冻结结果：在独立复审收口后的同一 v6 候选上完成正式发布门，类型、Lint、production build、335 项 Node 测试及 158 项 Worker/Vitest 测试均通过；5 项按既有条件跳过。故障注入 reporter 的 `stage4-hazard-freeze-response-loss` 文本为通过用例的预期输出，没有造成失败。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（最终冻结门） | `npm run typecheck && npm run lint && npm test` | 0 | production build；Node 335/335；Worker/Vitest 42/42 文件、158 passed / 5 skipped。 |

## DeepSeek KP ActionPlan 与当前回话合同修复（2026-08-28）

- 基线与 v6 发布事实：本次从干净 `cloudflare` / `5579801a961f96f06d247e02f47c3fc3d2081856` 继续；该提交已非 force 推送，远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。v6 已只更新现有 Worker `zhuwei`，Cloudflare Version `c35ce2c4-e9f6-49c9-8519-d7560c30297a` / deployment `137addbb-ef70-4580-abe3-5ac108d448c9` 承接 100% 流量；现有 ROOMS、DB、AI、ASSETS 与 Secret 名称不变，无 migration 或新资源。
- v6 生产症状：在一次性房间 `8BTWKL`、公开 `deepseek-v4-flash` 中再次提交精确行动“我站在原地环顾大厅，寻找明显可见的出口，不触碰任何物品。”，输入仍恢复、没有行动或新 Delivery，证明失败仍在 commit 前的 Proposal/Rules 路径；v6 的投影引用归一化不足以恢复回话。`wrangler tail` 仍在 TCP 边界超时，Observability 历史查询因既有 OAuth 缺少 scope 返回 403；用户明确要求停止继续等待日志后不再重试。临时本地脱敏脚本已删除，最后创建的 Tail 会话随后返回 `TAIL_DELETED`，没有残留采集进程或内容型日志。
- 首个代码根因：模型工具 schema 与 semantic validator 只要求 `mechanicalProposal.operation`，并允许 Rules 从未实现的 `sensoryEvidence` 等 effect；Rules 对 `resolveDirectConsequences` 实际要求正整数 duration、`frozenCosts=[]`、合法 success、`failure=[]`。因此 DeepSeek 可返回“模型边界合法、Rules 必拒”的观察计划，Room 随后进入第二次完整 Proposal 或最终安全失败。修复把 direct/check/save/retry 的字段形状、成本、效果、安全整数、玩家/NPC operation 范围与 Rules 对齐；观察类无不确定行动固定使用 direct、复制 estimated time、没有结构化状态变化时 `success=[]`。`retryFailedAction` 同步保留 Rules 的两种闭合形状：原样重试只带 operation/precedentRef 并由既有失败先例直接拒绝，可能执行的重试必须完整冻结检定。玩家不得提交只属于 NPC 的 `advanceFactionPlan`；NPC 不得提交 contest、retry 或替其他实体 save；Activity completion 不得再次推进其 duration 已拥有的虚构时间；显式 null 知识值在进入 Rules 前拒绝，避免静默改写。
- 当前回话根因：Narration schema 没表达本地 agency validator 的交叉约束；合法 `basisRefs` 若未重复填写在 `referencedProjectionRefs`，或 world/player 字段组合错误，会在行动已提交后得到统一 `modelPermanent` 而没有 Delivery。修复将 player/NPC/world agency claim 分支闭合，拒绝纯空白和重复数组；所有越界引用继续 fail closed，只把已经逐项验证属于该 audienceProjection 的 basis 确定性并入顶层引用，避免让模型重复填写同一事实成为单点失败。独立复审补出的 `subjectRef` 类型冒用也已闭合：Room 只把权威 `state.entities` 中、其 ID 已经出现在 observer-safe 投影里的实体加入 `agencySubjects`，Narration 必须逐字使用该类型目录；不再从无类型的 `committedDelta.actorCharacterId` 猜玩家/NPC，隐藏实体也不会因目录生成而泄露。
- 模型输入体积与 Provider 兼容：首轮严格分支内联让 `PROPOSAL_TOOL` 从约 33 KB 增至 `99,469` bytes，可能反向增加 V4 Flash 超时/无效输出风险；最终使用 DeepSeek 当前工具调用文档明确展示的 `$def/#/$def` 共享同一 cost/effect 与玩家/NPC ActionPlan 定义，工具为 `33,213` bytes，并新增 `<60,000` bytes 回归门。模型仍是非 strict 调用，真实可用性必须由发布后的默认 V4 Flash 产品探针证明，不能由 scripted fixture 替代。
- 修改范围：`app/_runtime/lib/kp/authoritative-types.ts`、`app/_runtime/lib/kp/authoritative-policy.ts`、`app/_runtime/lib/kp/authoritative-helpers.ts`、`app/_runtime/lib/room/proposal-adapter.ts`、`app/_runtime/lib/room/durable-object.ts`、`tests/authoritative-kp-adapter.test.mjs`；本节日志由协调代理单写。没有前端目录、模型目录、D1 schema、Secret、Worker 配置或受保护房间修改；前端仍只显示 DeepSeek V4 Flash / Pro，“确认当前回应”语义不变。
- 已知限制：结构化 agency claim 已 fail closed，但 validator 无法从任意自然语言正文证明模型没有漏报 claim；例如正文自行声称玩家下一行动而同时给出空数组，仍依赖 Prompt 合同。未用脆弱关键词扫描伪装解决该自然语言完备性问题；这不属于本次观察行动无法进入 Rules/Delivery 的根因，后续若要机械证明需把正文重构为受控叙事子句。
- 当前状态：三条 RED、ActionPlan/Rules 与 Narration 定向 GREEN、类型与相关 lint 已完成；独立复审先后发现的玩家/NPC operation 分裂、schema 膨胀、null 知识、安全整数、Activity 重复时间、agency 主体类型冒用与非战斗 NPC 类型来源缺口均已逐项修正并补回归。第二个冻结候选已通过正式冻结门，根因修复提交已推送并部署；但发布后的本机 curl 与独立 Chrome 控制通道均在传输/控制边界超时，依停止条件不再重试，因此只能写“本地代码已验证、部署已完成、外部能力未实证恢复”。一次性测试房 `8BTWKL` 暂时保留，未触碰受保护房间。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28（ActionPlan RED） | `npx tsx --test --test-name-pattern='model boundary rejects direct consequences' tests/authoritative-kp-adapter.test.mjs` | 1 | operation-only direct 报 `Missing expected rejection`，复现模型边界放行而 Rules 必拒。 |
| 2026-08-28（Narration RED → GREEN） | 观察回话引用归一化定向测试 | 1 → 0 | 合法 basis 漏填顶层引用从统一 `modelPermanent` 改为确定性补齐；越界 basis 仍拒绝。 |
| 2026-08-28（schema 体积 RED → GREEN） | ActionPlan schema 定向测试 | 1 → 0 | 内联版本为 `99,469` bytes；共享定义后 `PROPOSAL_TOOL=32,955` bytes。 |
| 2026-08-28 | `npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/rules-compound-action-v2.test.mjs` | 0 | 最终为 49/49；含观察 draft→Room normalization→真实 Rules `step` committed、两种闭合 retry、ActionPlan 边界、Narration 与完整 compound Rules 套件。 |
| 2026-08-28 | `$def` 兼容性与 schema 体积复核；Adapter 定向回归 | 0 | 所有共享引用均指向根 `$def`；最终 `PROPOSAL_TOOL=33,213` bytes；Adapter 18/18。 |
| 2026-08-28 | 非战斗 `agencySubjects` 回归；`npm run typecheck` | 0；0 | Adapter 18/18；NPC actor 可按权威类型叙述、不能冒充玩家，目录不要求 combat `entities`，未出现在 observer-safe 投影的隐藏 NPC 不进入模型输入。 |
| 2026-08-28 | `npm run typecheck`；四文件显式 ESLint；`git diff --check` | 0；0（3 个 TS 文件按仓库配置忽略、无 error）；0 | 当前 TypeScript 与 whitespace 正确；最终仓库级 Lint 由正式冻结门覆盖。 |
| 2026-08-28 | 独立只读首轮复审 | blocker 2 / HIGH 2 / MEDIUM 3 | 所列 operation 分型、schema 体积、null、安全整数与 Activity 缺口均已修正；save/retry 的跨 adapter→Rules 专项仍由两侧既有测试分别覆盖，本次用户观察路径已有真实 direct seam。 |
| 2026-08-28（首个冻结候选） | `npm run typecheck && npm run lint && npm test` | 1 | typecheck、Lint、production build、Node 340/340 通过；Worker/Vitest 41/42 文件、157 passed / 1 failed / 5 skipped。唯一失败为多轮评估第 23 步的 Rules 合法最小 retry 被模型边界拒绝后映射成 `modelTransient`；该失败使候选失效，未提交或发布。 |
| 2026-08-28（冻结失败定向修复） | Adapter + compound Rules；`npx vitest run tests/kp-multiturn-eval.test.ts`；`npm run typecheck` | 0；0；0 | 49/49；多轮评估 1/1；边界只增加 Rules 已支持的原样重试最小闭合分支，可能执行的 retry 仍要求完整冻结。 |
| 2026-08-28（最终冻结门） | `git diff --check && npm run typecheck && npm run lint && npm test` | 0 | 同一最终候选：production build；Node 340/340；Worker/Vitest 42/42 文件、158 passed / 5 skipped。故障注入 reporter 的 `stage4-hazard-freeze-response-loss` 文本为通过用例的预期输出。 |
| 2026-08-28 | `git commit`；`git push origin cloudflare`；远端 refs 复核 | 0；0；0 | 根因修复提交 `aa538603b75dad97acfd1861121c9cbbcdaec2ad` 已非 force 推送；远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。 |
| 2026-08-28 | `wrangler whoami`；配置/Secret/migration 门 | 0；0；0 | 现有账号登录；目标仍为 `zhuwei`、`DB`/`zhuwei-dev`、ROOMS/AI/ASSETS；仅确认 `DEEPSEEK_API_KEY` 名称；远端无待执行 migration。 |
| 2026-08-28 | `npm run cf:deploy`；`wrangler deployments status --json` | 0；0 | 只更新现有 Worker；Version `9f0e2a54-bcfb-4ef5-ada6-4336e5146d63` / deployment `126c27d9-ab6d-4b83-b888-601efa9509ae` 承接 100% 流量，无新资源。 |
| 2026-08-28 | 发布后根入口 curl；独立 Chrome 产品探针 | TCP 超时；控制通道超时 | 两个独立通道均未取得应用响应，按用户要求与传输层停止条件不再追日志或重试；不能宣称真实 V4 Flash Proposal→commit→Narration→Delivery 已恢复，`8BTWKL` 未清理。 |
## 代理合同：冻结后有界增量验证与单次构建（2026-08-28）

- 基线：`cloudflare` / `388b527dc9e2`；任务开始时目标文件无未提交修改。
- 需求：冻结门通过后的局部小修仍可能触发整套验证，正式部署路径还会分别由 `npm test` 和 `npm run cf:deploy` 重复 production build，需要在影响可界定时复用完整门证据。
- 决策：有界增量补丁必须同时限定在单个叶子模块及直接测试、保持公共与权威边界不变，并通过改动行为、相邻路径和相关文件 ESLint；满足时由“此前完整门 + 增量证据”构成最终发布证据，任一条件不满足则形成新冻结候选。非部署完整门仍用 `npm test` 构建一次；正式部署完整门拆为 typecheck、Lint、unit、Worker 测试，再由获授权的 `npm run cf:deploy` 执行唯一一次构建和部署。
- 修改：仅修改 `AGENTS.md` 的“最小充分验证”段落，并记录本条执行事实；未修改 `package.json`、业务源码、测试或部署配置。
- 集成状态：修改保留在当前工作区；未运行代码测试、migration、部署、提交或推送。文档变更只执行目标段落、whitespace 与最终 diff 检查。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 目标段落复核；`git diff --check -- AGENTS.md`；`git diff --stat -- AGENTS.md`；目标 diff 复核 | 0 | `AGENTS.md` 仅新增有界增量补丁判定，并把正式部署完整门改为单次构建路径。 |

## 代理合同：症状即输入（2026-08-28）

- 基线：`cloudflare` / `388b527dc9e2`；本次在尚未提交的验证合同修改上继续增量编辑。
- 需求：用户通常只描述观察到的问题，不希望每次重复期望、复现、测试或停止条件模板。
- 决策：症状本身足以启动开发修复。代理负责从产品基线、规格、测试和上下文推断期望行为；只有多个合理解释会产生实质不同产品结果时才提出一个最小澄清问题。截图、错误文案、复现步骤和期望结果保留为可选线索。
- 修改：在 `AGENTS.md` 项目介绍后新增“用户输入默认”，没有改变业务逻辑、现有测试证据、部署状态或远端资源。
- 影响：本任务后续修复按新输入规则执行；已经完成的修改和验证不被追溯重做，其他任务正在执行的一轮不会因此重启，后续轮次以重新读取到的项目规则为准。
- 集成状态：修改保留在当前工作区；未运行代码测试、migration、部署、提交或推送。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 目标段落复核；`git diff --check -- AGENTS.md`；`git diff --stat -- AGENTS.md` | 0 | “用户输入默认”位于全局执行规则之前；文档无 whitespace 错误。 |

## 代理合同：开发快修默认与按需加载（2026-08-28）

- 基线：`cloudflare` / `388b527dc9e2`；用户确认其他任务均已完成并授权直接修改代理文档。工作区原有未提交的 `AGENTS.md`、本日志修改和未跟踪 `.playwright-cli/` 均按现状保留。
- 需求：开发阶段只需用自然语言描述症状，代理应快速定位并修复 Bug、检查直接连带错误；普通跨层修改、审查后的末尾小修和“任务完成”不得自动触发全量验证。
- 根因与决策：原根合同同时常驻开发、冻结发布和并行协调细则，普通修复容易沿保守条款升级。根合同现只保留开发期高频不变量、定向验证和停止条件；完整回归/发布与并行协议分别移至按显式触发读取的文档。只有用户在当前任务明确要求完整回归、发布、部署、远端 migration、Git push 或里程碑冻结，才切换对应流程。
- 修改：重写 `AGENTS.md` 为“症状即输入、根因修复、直接连带检查、证据满足即停止”的开发默认，并保留写操作权限验证与文档专用验证规则；新增 `docs/agent/release.md` 和 `docs/agent/parallel.md`，分别承载冻结/发布门与隔离 Worker 规则。发布/部署只授权更新既有 Worker，Git push 仍需单独授权。没有创建强制 Prompt 模板。
- 集成状态：仅修改代理说明与执行日志；未修改业务源码、测试、依赖或部署配置，未运行代码测试、build、migration、部署、commit 或 push。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | 三份目标文档逐段复核；路径/触发词检查；tracked `git diff --check`；四份文档 trailing-whitespace 扫描；最终 diff 与状态复核 | 0 | 开发默认、显式升级与授权边界、按需读取链接和文档格式一致；未执行代码验证。 |

## V3 项目主管审计、旧实现归档与单工作区收口（2026-08-28）

- 基线与授权：任务从远端 `cloudflare` / `4f2abee4cdf53a430d7df66e4644069e35dc09d9` 收口；用户要求主管级目录审计、把新产品标为 V3、将旧实现上传 GitHub 分支后删除本地、完成验证并推送，但明确不得改动 `main`。远端 `main` 在本节记录时仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。本任务未获新的 Cloudflare 部署授权，因而不部署、不迁移、不修改 Secret 或远端资源。
- 目录审计：`/Users/sanmu/Documents` 原有当前 Cloudflare 仓库、同版本修复克隆、独立 Sites 迁移仓库、Vercel/Nitro 诊断产物及三个 Codex worktree。审计后只保留 `/Users/sanmu/Documents/zhuwei-cloudflare`；`git worktree list` 只剩当前工作树。重复克隆、诊断产物、旧源码、已收口 worktree、`.playwright-cli` 和旧截图原始状态均移入 macOS 废纸篓，未永久擦除。首次批量移动命令因误用 zsh 保留变量 `path` 而在任何移动发生前失败；随后改用任务专用变量与绝对 `/bin/mv` 完成全部可恢复移动。
- 私有本地数据：独立 Sites 仓库的 ignored `.wrangler` 内含 3 个本地房间及角色、消息、游戏状态和剧情秘密。该目录未进入任何 Git 对象，随原仓库保留在废纸篓可恢复副本；除非用户以后明确要求，不永久销毁。归档前对三提交 Sites 源码及 detached 源码/测试执行高置信 Secret 扫描，没有发现私钥、token 或 `.env`；该结论不代表废纸篓中的本地 D1 可以公开。
- 远端恢复点：以非 force push 建立 `codex/archive/pre-v3-authoritative-v2-20260828` → `4f2abee4cdf53a430d7df66e4644069e35dc09d9`（414 个跟踪文件）、`codex/archive/sites-migration-20260825` → `932c39f4b006b2a7bce845ff8d4d74cfececc17d`（独立三提交历史、143 个跟踪文件）、`codex/archive/detached-85aa-pre-v3-20260828` → `21ca594cac3b2cad3ee1c6cff5b96fd41d1a9030`（414 个跟踪文件）。三条 ref 均在全新临时仓库独立 fetch，SHA、文件数与 `git fsck` 通过后才清理本地副本；验证仓库随后也移入废纸篓。detached 档案未加入其未跟踪的 `.playwright-cli` 和三张战术截图，但继承 pre-v3 基线中两张已跟踪的里程碑截图，ADR 如实记录。
- 并行工作收口：`f930215` 的补丁与已集成 `69e494e` patch-id 相同；`ff11599` 已是当前基线祖先；85aa 的独立在途源码已进入上述 detached 档案。注册 worktree 已 prune，内容已集成的临时 stash、已合并本地战术分支及上传核验后的本地 archive 分支均已删除；本地只保留当前 `cloudflare` 分支，远端 archive refs 仍可恢复。三个只读 Worker 分别审计外部目录、V3 项目布局和版本/回放边界，没有并发修改业务文件；终审均为无 Blocker/High。
- V3 决策：`package.json`/lockfile 升为 `0.3.0`，README、`AGENTS.md` 与新接受的 `ADR 0013` 把产品和仓库代际标为 V3。V3 不复制 `app-v3`/`src-v3`，也不机械改名已持久化协议；现有房间继续固定 `dnd5e-2014-srd5.1-authoritative-v2`。任何持久化规则、事件、投影、模组或 Profile 语义变化都必须新增完整 runtime manifest 和 Adapter，解释语义变化时再新增 interpreter；SPEC 0001 继续是 LLM/KP 行为最高准则。
- V3 主树：保留 `app/`、`worker/`、`db/`、`drizzle/`、实际 `public/`、`tests/`、`tools/`、`cloudflare/`、规格/ADR/代理文档与根构建配置。删除只供旧平台考据的 `src/`、`server/`、`migrations/`、Sites/PWA/PGlite/preview 旧脚本、`public/__grok/`、`startup.sh`、`AGENTS.project.md` 和仓内旧截图；四个仍被调用的模块/Profile/评测工具迁到 `tools/` 并更新全部调用方。`.gitignore` 明确忽略根 `.playwright-cli` 与 `output`，新增项目布局回归防止旧入口回流。
- 评测收口：live KP 评测从遗留 Workers AI/GLM 命名更新为当前 DeepSeek V3 工具，并把 schema 固定为 v2。独立复审发现 provisioner 只验证报告存在；最终门强制 `modelId=deepseek-v4-flash`、`modelProvider=deepseek`、`execution.mode=live`，新增历史模型伪通过负例。此处只修改有界评测工具和确定性测试，没有发出真实模型请求。
- 验证与失败处置：首次完整 `npm test` 的 production build 通过，Node 仅有 2 个旧项目布局/代理文案断言失败；这些断言仍要求已裁定删除的 `src` 与旧“等价迁移”表述。更新为 V3 单生产树合同后，定向 22/22 通过。最终同一冻结候选上，`git diff --check`、`npm run module:check`、`npm run typecheck`、`npm run lint` 均退出 0；`npm test` 退出 0，production build 通过，Node 343/343，Worker/Vitest 42/42 文件、158 passed / 5 个既有条件 skip。故障注入 reporter 的 `stage4-hazard-freeze-response-loss` 文本属于通过用例预期输出。
- 当前状态：目录、远端归档、V3 文档与冻结门均已完成；本节记录时 V3 候选尚未提交到远端 `cloudflare`。没有 D1 schema/migration 变化，没有 Cloudflare deploy、流量变更、Secret 读取/修改或新资源。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | Documents/Git/worktree/ignored 数据只读审计；高置信 Secret 扫描 | 0 | 识别四类外部目录、三个 worktree 与 Sites 私有 `.wrangler` D1；未把本地数据纳入 Git。 |
| 2026-08-28 | 三条 archive ref 非 force push；全新仓库 fetch、SHA/文件数、`git fsck` | 0 | 三个远端恢复点均可独立取回；远端 `main` 未变。 |
| 2026-08-28 | `/bin/mv` 到 macOS 废纸篓；`git worktree prune`；本地 stash/已合并分支清理 | 0 | Documents 只剩当前仓库，Git 只剩一个注册工作树；私有 D1 仍可恢复。 |
| 2026-08-28 | V3 layout、interaction、live eval 定向测试 | 0 | 最终 22/22；旧平台入口不回流，规则版本不被 V3 产品代际改名，评测模型身份精确固定。 |
| 2026-08-28（首次完整门） | `npm test` | 1 | production build 通过；2 个遗留项目布局/代理文案断言暴露并修正，候选未发布。 |
| 2026-08-28（最终冻结门） | `git diff --check`；`npm run module:check`；`npm run typecheck`；`npm run lint`；`npm test` | 0 | production build；Node 343/343；Worker/Vitest 42/42 文件、158 passed / 5 skipped。 |

## V3 仓库边界 Git 交付（2026-08-28）

- 冻结候选以提交 `c292c9e6ac9e59050f2e8893bd8eeebc17811680`（`chore: establish V3 project boundary`）落地，并从 `4f2abee` 非 force 快进推送到远端 `cloudflare`。该提交包含上述已验证的 V3 边界、旧平台目录移除、工具迁移、回归测试、ADR 与发布/并行代理文档；没有 `app/`、`worker/`、`db/`、`drizzle/`、`wrangler.jsonc` 或 SPEC 0001 diff。
- 推送后 `git ls-remote` 证明 `cloudflare=c292c9e6ac9e59050f2e8893bd8eeebc17811680`；三个 archive ref 仍分别为 `4f2abee4cdf53a430d7df66e4644069e35dc09d9`、`932c39f4b006b2a7bce845ff8d4d74cfececc17d`、`21ca594cac3b2cad3ee1c6cff5b96fd41d1a9030`；`main` 仍为冻结基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- 本节是推送后的 docs-only 事实记录，不改变已冻结源码、测试、依赖或构建配置，因此不使完整门失效。没有执行 Cloudflare deploy、D1 migration、Secret 或流量操作。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-28 | `git commit -m 'chore: establish V3 project boundary'` | 0 | 冻结候选提交 `c292c9e6ac9e59050f2e8893bd8eeebc17811680`。 |
| 2026-08-28 | `git push origin HEAD:refs/heads/cloudflare` | 0 | 非 force 快进 `4f2abee..c292c9e`，只更新 `cloudflare`。 |
| 2026-08-28 | `git ls-remote` 复核 cloudflare/main/三条 archive refs | 0 | V3 与三个恢复点均可达；`main=29eb06dc009c983ad61b2d862454503e67a7f40a` 未变。 |

## 移除桌面手动确认当前回应（2026-08-28）

- 症状与根因：桌面在当前 KP 回应下方额外要求玩家点击“确认当前回应”；该手动操作不是下一轮投递的前置条件，Room DO 已保证新回应原子覆盖旧回应，因此按钮只增加无必要的交互步骤。
- 修改：`app/_runtime/components/play-table.tsx` 移除确认按钮、提示、请求状态和 ACK 调用；当前回应仍在刷新与轮询中保留，直到同一 ViewerKey 收到新回应。服务端鉴权 ACK 协议、单槽投递和不可回看边界不变。同步更新 `tests/delivery-confirmation-v2.test.mjs` 与 `tests/authoritative-table-v2.test.mjs` 的直接交互合同。
- 定向验证：`npx tsx --test tests/delivery-confirmation-v2.test.mjs tests/authoritative-table-v2.test.mjs` 退出 0，21/21 通过；覆盖无手动确认控件、轮询不隐式 ACK、行动与回应顺序、语音不 ACK，以及服务端 ACK 权限接缝保留。
- 剩余限制：未运行全量测试、production build、浏览器 QA、部署或 Git push；后端 ACK 仍保留给现有协议消费者。

## 修复自由行动被模型 Schema 拒绝后无声退回（2026-08-28）

- 生产诊断：在不接触用户房间或数据的临时账号/房间中连续提交两条简单观察行动；两次请求均为 HTTP 200，Room Authority 的 prepare 均成功，但 DeepSeek `deepseek-v4-flash` 的 proposal 调用分别在约 4.4 秒和 7.3 秒后以 `modelPermanent/proposalSchema` 结束，动作未提交且当前 Delivery 未变化。排除鉴权、网络、ACK、房间状态、超时、限流和额度故障；临时房间随后删除。
- 根因：普通 DeepSeek tool call 返回的 arguments 能被提取为 JSON，但不保证自动满足本地封闭 Schema；短期、仅对随机验收提交 ID 生效的结构形状诊断进一步确认，实际失败输出交替把工具参数包成 `{kpProjection: ...}` 或 `{proposal: ...}`，而适配器只接受顶层直接 Proposal。桌面会恢复草稿，却只显示瞬时 toast，因此玩家容易感知为“直接退回、没有报错”。结构诊断不记录文本、Prompt、投影或任意值，定位后已从最终版本删除。
- 修复：provider 参数顶层恰好只有 `proposal` 一个键且值为对象时，先移除这一层冗余 envelope，再把内部对象交给完全相同的封闭 Proposal 校验；任何兄弟字段、`kpProjection` 包装或内部无效仍拒绝。首次且仅首次 `proposalSchema` 失败时，丢弃未提交提案，以同一房间固定 Profile、同一 action/Rules diagnostics/KP projection、零温度和完整合法结构样例请求一个替代提案；不把无效模型输出回填 Prompt。第二次调用只能使用原 45 秒调用窗口的剩余预算，并继续通过相同的投影边界与 Rules/Room 提交流程。解析失败、投影越界、超时、额度或其他 provider 故障不走该路径；连续 Schema 无效仍稳定拒绝。两次脱敏 invocation receipt 均保留可观测性。
- 桌面反馈：行动被拒绝或传输抛错时，除 toast 外在输入框下方保留 `role=alert` 的公开错误，同时恢复草稿；玩家开始编辑或再次提交后清除旧错误。
- 定向验证：`npm run typecheck` 退出 0；`npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/rules-compound-action-v2.test.mjs tests/delivery-confirmation-v2.test.mjs tests/authoritative-table-v2.test.mjs` 退出 0，74/74 通过。覆盖精确单键 provider envelope、带兄弟字段的 envelope 仍拒绝、Schema 无效后一次同模型替代、替代成功、连续无效仍 fail-closed、无效输出不进入新 Prompt、共享总超时窗口、公开错误固定显示与草稿恢复，以及真实 Rules compound seam。
- 发布与故障处置：首个候选 `257e6b2f-bdfe-4191-90f7-35f86515c644` 和仅强化 Prompt 的候选 `4a1888a4-9c19-4d83-a2fe-c33055f009a6` 均在真实两行动探针中继续失败，因此没有宣告完成；短期结构诊断版本 `b443a369-1db1-4798-829b-a0f92ca0bd07` 定位 envelope 后被立即替换。最终版本 `2e0199f7-48e6-4525-8d96-bf5438437514` 已由 Cloudflare 确认为 100% 流量。最终同房间连续两条简单观察均为 HTTP 200、`committed` 且各自推进新 Delivery；第二条先产生一次 `proposalSchema` receipt，随后同 Profile 替代提案成功、叙述成功并提交，精确覆盖原故障路径。
- 清理与剩余限制：所有临时房间均返回 `deleted:finalized`，会话均注销；本轮真实探针在 D1 留下 5 个无房间、无角色、无有效会话的空测试用户记录，另有首次诊断留下的 1 个空测试用户，应用暂无删除账号接口且本轮未扩权修改 D1。未运行全量 `npm test` 或真实浏览器 QA；没有 D1 migration、Secret 修改、Git commit 或 Git push。production build 在每次候选发布前均成功。

## 恢复亲历对话、连续发送与叙述事实边界（2026-08-29）

- 症状：玩家曾亲历的玩家发言与 KP 回应在 Delivery 被确认、被下一条覆盖、离开后返回或刷新后消失；连续发送可能只把输入退回且没有固定错误；KP 会把战术地图标签和坐标扩写成脚下泥迹、一路靴印、白布、目光/身后、火苗声、姿态、气味、左右方位和十/二十/三十尺等未经当前投影支持的文学细节。
- 历史语义：Room DO SQLite 新增按 `(viewer_key, message_id)` 唯一的 `authority_experienced_messages`。只有冻结 Audience 中实际收到内容的 ViewerKey 才追加亲历记录；玩家自己的原始输入只进入该玩家记录。ACK、下一条 Delivery 覆盖、离开后返回、刷新和 DO 重启都从同一权威记录恢复；当时缺席者后来到场不补历史，控制权转移不继承前控制者记录。普通更正保留原 Audience 当时听到的旧话并追加替代回应；安全失效不保存有风险正文。D1 archive 仍不存正文，没有新增 D1 migration。
- 发送恢复：浏览器在请求前把完整可重试 payload 与稳定 `submissionId` 写入 `sessionStorage`；传输失败、Room 可重试失败或 `committed + deliveryPending` 都保留同一提交身份和固定错误，刷新后可恢复/重试，已经提交的行动只重试回应发布而不会再次执行。成功或不可重试结果才清除恢复记录；浏览器禁用 session storage 时降级为当前请求内的稳定 ID。
- KP 边界：Prompt 把 `experiencedTranscript` 限定为对话连续性而非当前事实，并禁止从坐标、feature 标签或 NPC 可见性推导方位、目光、姿态、声音、气味和陈设。发布前确定性 grounding guard 同时检查正文与 TTS；历史、目标、方法、问题和机会字段不作为当前感官证据，未明确询问距离时也禁止逐项输出多个精确尺数。单层 provider envelope 只有在内部对象仍通过原封闭 Proposal/Narration Schema 时才可去除；带兄弟字段或无效内部对象仍拒绝。当前玩家原文可作为刚提交行动的 actor-only 引用，旧 transcript 仍不能充当当前状态依据。
- 无声回应根因与降级：最终线上诊断证明 Proposal 已提交成功，Narration 两次均是字段、引用和 agency claims 合法但正文 grounding 不合格；旧路径因此永久停在 `deliveryPending`。现在第一次 grounding 失败仍以同一 Profile、同一总超时窗口请求一次不含旧正文的替代；替代仍越界时丢弃模型正文，以已 committed 状态发布简短确定性回应。只有 `narrationGrounding` 走该安全降级；Schema、权限、投影、超时、额度和其他模型故障继续 fail-closed。短期诊断只记录字段类型、计数和四项验证布尔值，不记录正文、Prompt、ID 或引用值，并已从最终版本删除。
- 定向验证：历史/更正/安全 Worker 用例 10/10、返回与控制转移补充用例 2/2；最终 KP 适配器与 grounding 24/24、结构化脱敏遥测 8/8；`npm run typecheck`、`npm run lint`、`git diff --check` 均通过。此前同任务 Node 定向/合同集为 355/355；用户要求后续只测修改范围，因此最终增量没有再跑无关 Worker 全量套件。每次发布前 production build 均成功。
- 线上验收与发布：最终 Worker 版本 `2c10b854-5fc3-445e-8e4c-32f7ab8e3f79` 发布到 `https://zhuwei.yinskyriver.workers.dev`。受控同房间连续两条观察行动均第一次请求成功，分别产生新玩家原文与新 KP 回应；第一组在第二条之后仍在，四条记录在模拟刷新及两次 ACK 后正文和 ID 均稳定；新 KP 回应未命中上述无依据细节。探针房间均 `finalized` 删除、会话均注销。
- 剩余限制：部署前已经被旧单槽覆盖且没有保存的正文无法逆向恢复，只能从本版本之后可靠保留；观察接口当前返回有界的最近 120 条与当前场景最多 120 条，没有历史分页。本次追加诊断/验收产生 7 个无房间、无角色、无有效会话的空测试用户记录；应用没有删除账号接口，当前 Cloudflare 授权也不含 D1 写权限，未扩权清理。没有新 Cloudflare 资源、Secret/config 修改、D1 migration、Git commit 或 Git push。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-29 | 历史/更正/安全与返回/控制转移定向 Worker 用例 | 0 | 10/10 + 2/2；亲历保留、缺席隔离、普通更正与安全失效语义通过。 |
| 2026-08-29 | `npx tsx --test tests/authoritative-kp-adapter.test.mjs`；`npx tsx --test tests/structured-telemetry-v2.test.mjs` | 0 | 24/24 + 8/8；单层 envelope、grounding、距离询问例外、安全降级与无内容遥测通过。 |
| 2026-08-29 | `npm run typecheck`；`npm run lint`；production build | 0 | 最终增量类型、lint 与 Cloudflare 构建通过。 |
| 2026-08-29 | `npm run cf:deploy`；Cloudflare deployment status | 0 | `2c10b854-5fc3-445e-8e4c-32f7ab8e3f79` 接收 100% 流量。 |
| 2026-08-29 | 两行动生产探针；ACK、重复 fetch、模拟刷新、grounding 与清理断言 | 0 | 2 条行动一次成功；4 条亲历记录稳定；无目标越界细节；房间 finalized、会话 revoked。 |

## 当前权威对话交付状态 Git 快照（2026-08-29）

- 交付范围：应用户要求，将上述已部署但尚未入库的亲历对话、连续发送、手动 ACK 移除、KP 结构恢复和叙述边界改动作为当前状态快照提交。基线为 `d63b4b83670ea60c1fa9f1ef4d98523cab2085fa`，源码快照提交为 `737e0a90929638a2804f96ba2d913dc21c4fec23`（`chore: snapshot authoritative dialogue delivery`）。本次仅做 Git 交付，没有再次部署 Cloudflare、执行 migration、修改 Secret/config 或变更流量。
- 定向验证：按本批实际修改范围运行 Node 合同/交互用例 54/54、Worker 亲历投递/开场/更正/安全用例 15/15，并运行 `npm run typecheck`；全部退出 0。`git diff --check` 通过。未运行全仓 `npm test`、build 或全量 lint。
- 推送审计：未发现凭据、个人路径、冲突标记、调试残留、构建产物或异常二进制；两个新增文件均为普通测试。提交以非 force 快进从 `d63b4b8` 推送到远端 `cloudflare`，推送后远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- 范围声明：这是现有部署状态的可恢复快照，不表示随后讨论的 body-only Narration 或表单化 Proposal 已实现。快照仍保留完整结构字段、受限的二次模型 correction，以及两次 `narrationGrounding` 失败后的硬编码确定性回应；该回应可能把权威拒绝呈现成成功，必须在后续设计修复中移除或改成显式失败。完整待重试行动会暂存于同源 `sessionStorage`，ViewerKey 专属亲历正文会持久化于 Room DO SQLite，属于当前恢复/留存设计边界。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-29 | Node 定向测试；Worker 定向测试；`npm run typecheck`；`git diff --check` | 0 | 54/54；15/15；类型与 whitespace 通过。 |
| 2026-08-29 | `git commit -m 'chore: snapshot authoritative dialogue delivery'`；`git push origin HEAD:refs/heads/cloudflare` | 0 | 快照提交 `737e0a90929638a2804f96ba2d913dc21c4fec23` 已非 force 推送。 |
| 2026-08-29 | `git ls-remote origin refs/heads/cloudflare refs/heads/main` | 0 | `cloudflare=737e0a90929638a2804f96ba2d913dc21c4fec23`；`main=29eb06dc009c983ad61b2d862454503e67a7f40a` 未变。 |

## Causal 根路径 Profile 隔离矩阵（2026-08-29）

- 症状与根因：原测试只覆盖普通随机 continuation 的 Profile 隔离，未逐一证明普通 direct、动态事实、世界内拒绝、澄清和战斗五条 causal 根路径都固化精确 V3 marker，也未覆盖两个 legacy manifest 的事件改绑与 genesis marker 注入。
- 修改文件：`tests/causal-action-rules-v3.test.mjs`；新增共享 marker/genesis helper 和五路径 × 两 legacy manifest 矩阵，生产代码无需修改。
- 定向检查：`npx tsx --test tests/causal-action-rules-v3.test.mjs` 退出 0，19/19 通过；覆盖正确 V3 事件流回放、legacy 改绑事件校验/回放 fail-closed，以及 legacy genesis 注入 marker 返回 `profileIntegrityMismatch`。首轮测试构造因注入 fact 缺少状态元数据而退出 1，补齐 canonical state metadata 后通过。
- 剩余限制：未运行全量测试、typecheck、build 或浏览器 QA；未提交、推送、部署或修改 migration。

## Static RAG 依赖闭包与预算原子性（2026-08-29）

- 症状与根因：静态检索先按命中上限截断单个 chunk，Context Pack 又按单 chunk 逐个裁剪；命中的规则、模块或线索可能在其 source/profile 依赖未同时进入上下文时继续使用，权威回读也只校验命中自身而未拒绝未解析依赖。
- 修改文件：`app/_runtime/lib/kp/static-retrieval.ts`、`app/_runtime/lib/kp/context-pack.ts`、`tests/kp-form-context-v3.test.mjs`、`tests/kp-static-corpus-d1-v3.test.mjs`。检索在最终 limit 前展开有界传递依赖闭包，逐 chunk 回读校验 source/profile/hash/span/sensitivity，并要求每个依赖解析到已授权的 pinned profile 或已完整纳入的静态 source/chunk；超预算时按依赖连通组整体淘汰。
- 定向检查：`npx tsx --test tests/kp-form-context-v3.test.mjs tests/kp-static-corpus-d1-v3.test.mjs` 退出 0，13/13 通过；`git diff --check -- app/_runtime/lib/kp/static-retrieval.ts app/_runtime/lib/kp/context-pack.ts tests/kp-form-context-v3.test.mjs tests/kp-static-corpus-d1-v3.test.mjs` 退出 0。`npm run typecheck` 退出 2，仅报告授权范围外共享改动 `app/_runtime/lib/rules/v2/environment.ts:752-753` 的 `TS18046`，目标文件无类型错误。
- 剩余限制：未运行全量测试、build、lint 或浏览器 QA；未修改 Durable Object、rules、migration，未提交、推送或部署。全仓 typecheck 仍由上述范围外类型错误阻塞。

## V3 私有 Form、Context/RAG、逐受众叙述与 KP 自定义环境冻结前审计（2026-08-29）

- 基线与授权：只在 `cloudflare` 工作；本批开始时本地 HEAD 为 `33c9a9ba693f501c9853d3e6ef9429f174dc92af`，远端 `cloudflare=1685981378cc08521560251305b6d81d19d89eba`，远端 `main=29eb06dc009c983ad61b2d862454503e67a7f40a`。用户明确授权现有 D1 的远端 migration、现有 Worker `zhuwei` 的部署和非 force `cloudflare` push；没有授权新 Worker/D1/Vectorize/Secret。未跟踪的 `docs/goals/v3-kp-rag-refactor.md` 只作输入，未修改且不得纳入提交。
- 症状与首个根因：旧生产管线把大型 Proposal Schema、完整上下文、模型自报叙述元数据和单一成功/失败结果绑在一起；静态检索缺少可验证的依赖闭包；叙述失败会模糊已提交世界状态；动态环境能力又容易被误解为按吊灯等对象名派发。首个违反不变量的位置分别位于模型私有输入边界、Room Action/Publication 稳定点、D1 派生索引重读边界和 Rules 环境定义/Profile，而不是页面文案。
- 规格裁定：新增/修订 SPEC 0015、ADR-0014、DEC-036–044、规格索引和追踪矩阵；`SPEC 0001` 工作树 diff 为空，SHA-256 仍为 `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`。2026-08-29 用户后续裁定两次收窄验收：动态环境由 KP 依据玩家任意自然语言自定义，机械只显式选择 `state-only | area-hazard`，不再补具体吊灯 Room 专项；完整线上测评由用户自行执行，本代理部署后只运行一次精确三交互冒烟。
- 主要修改：十个 exact private Forms、3–6 allowlist 与 `compound` escape hatch；三层 Context Pack、D1 FTS/中文别名/结构依赖与 authority rehydrate；1+1 窄修订及冻结语义 hash；版本化 CausalActionProgram 经唯一 Rules `step/project/replay`；body-only `{body}` Narration、服务器派生 Audience/Receipt/evidence、action/narration 双状态和逐 ViewerKey publication/recovery；十个稳定公开错误与无正文 telemetry；新房 workflow/profile 固定；KP 自定义 EnvironmentDefinition/StateGraph 的 `state-only`/`area-hazard` 编译、权威 Geometry targets、Room DO 原子事件、archive/replay；旧 environment v2 manifest/profile 保留原义。
- G0 预改造生产基线（未重跑）：31/31 交互、32 请求，质量总分 4 且 hard gates fail；延迟 min/p50/p95/max = 7090.64/12015.28/20094.78/21314.31 ms。30 个 RootAction 产生 45 次 Proposal 调用，平均 1.50；首次成功 26/30（86.67%，Wilson 95% `[0.7032,0.9469]`），repair 30%；Proposal input p50/p95 = 56668/57075 tokens，output p50/p95 = 558/875；Narration 14 次中 7 成功/7 grounding failure。临时房间、会话和账号已按该轮记录精确清理，报告不保留正文或标识符。
- G2/G3/G4 离线同集结果：120 条结构报告 exit 0、4/4，16/16 hard gates。G2 critical refs 240/240（Wilson low 0.984246）、required refs 360/360（Wilson low 0.989442）、MRR 1；简单首次合法 86/88、compound 31/32、最终合法与 route 120/120、complex→simple 0/32。Schema median 13182 bytes，相对 G0 下降 60.07%；输入估算 p50/p95 4918/5812，相对 G0 median 下降 77.22%，口径为 UTF-8 bytes/4 而非 Provider tokenizer。隔离 `node:sqlite` FTS5 通过生产 D1 Adapter contract 写 public rows 13/13、G2 SQL MATCH 120/120（G2–G4 合计 360）、权威非空重读 174，D1 KP-only/body 为 0，本地正常 RAG fallback 0/120。G3 没有真实 supported candidate，标记 `unvalidated`/不可泛化/production disabled；G4 只在评测器以 Unicode-scalar TF-IDF Float64 + brute-force exact cosine 执行 120 searches/1920 comparisons，56 个案例实际重排但三项配对质量差均 0/120、输入退化，故 G3/G4 都不采用；G5 因 G2 MRR=1 不适用。五类故障注入 5/5 安全回退。完整 Provider tokenizer/端到端 p95/调用率/首次合法率均未测，按用户裁定留给后续自行测评。
- D1：`db/schema.ts` 是源；`npm run db:generate` exit 0。新增连续只增 migration `0008`（static corpus/FTS + nullable room workflow fields，SHA-256 `cdcfd1d021de6ef4227bb78bd8372385f5cbb1af4041bfd511ecbbaed3555733`）、`0009`（nullable corpus/profile/hash metadata，`16794c67e03f8808122b9c1fd4259fa8805ffcb34dc2ce2986e7b0718fe85688`）、`0010`（只逻辑清空三张可重建派生索引表，`bb3968cb26c9a797b9ae03503845b764a1180b59d193f587927f4ee8f3257e04`）和 `0011`（settled archive checkpoint，`da8aa71c0ac9e909b890d02536c7eb6cc555e1c9b0fdb29808fcf77903863a8e`）。隔离 Wrangler local D1 顺序应用 `0000–0011` 后无 pending，空 body public row 的写入→FTS MATCH→authority read→清理和 checkpoint 写读闭环通过；独立 `node:sqlite` 的 `0010→0011` 升级/写读也通过。`0010` 不修改权威 Room/身份/归档，也不宣称 SQLite 空闲页或 Time Travel 的物理擦除；`0011` 只增加单调 checkpoint。远端执行前必须重新取得当下恢复书签，旧书签 `0000008b-00000000-000050d6-867f6e9fd3b20df3d2d7953511b31b02` 仅作历史记录。
- 关键定向证据：Profile/causal/compound 57/57；workflow/table 25/25；campaign 2/2；concentration 1/1；控制/继任 1/1；dynamic environment Room 6/6；静态 corpus/production context 14/14；public action/table 21/21；Viewer recovery 4/4；archive D1 11/11（含 checkpoint prefix、ahead event 与 genesis conflict 防线）；80+ events/48 audits 的 D1 reader→fresh DO 1/1；无当前受控 viewer 的 D1→fresh DO 1/1；Planner 6/6；live harness/provisioner 13/13；V3 long track 1/1（202.03 s），经生产 Form allowlist、Context、validator/compiler、Room/Rules/projector 完成 15 Intent + 15 ACK + 1 Bob retry，覆盖任意 `state-only` 与 `area-hazard`、无重复 Proposal/随机/资源及 archive→fresh DO 的 state/project hash 一致。Viewer/dynamic Room 连带合计 10/10。`npm run typecheck` 与 `git diff --check` 在当前源码上 exit 0；早先 Static RAG 子任务记录的 exit 2 已由同一共享树后续修复消除。
- 评测/测试中的有效失败：live runner/provisioner 首次把默认 32-step（其中 duplicate 不计 interaction）的场景截为 31 个数组项，实际只计 30；修复为默认不切片、仅显式 smoke 取前三项后，两文件 13/13。Causal legacy 注入 fixture 首次缺 canonical state metadata，补齐测试输入后 19/19。未吞错或放宽断言。
- 冻结前剩余：只读安全/完整性审查、最终 `git diff --check/module:check/typecheck/lint/test:unit/test:worker`、远端 migration、唯一一次 deploy build、375/1440 浏览器五路径、三交互生产冒烟、日志/清理、docs-only 发布事实提交和非 force push 仍待；这些结果将在本节后的发布审计中按实际值回填。

## V3 新房角色专精与豁免熟练（2026-08-30）

- 症状与根因：Room 静态人物卡已有 `expertise`，旧 Rules 状态却只保留技能熟练，战役/战斗/环境豁免又分别忽略或按职业旁路推导；若直接修改现有 manifest，会静默重解释旧 env-v3/default 回放。修复新增 exact-hash `environment-v4` manifest 与 character-proficiency extension，仅新建 V3 workflow 选择 v4；旧 workflow/env-v3/default 常量、hash、状态 shape 和既有分路径修正值保持不变。
- 修改：staticCard 同时接受 canonical `expertiseSkills` 与 CharacterSheet `expertise`，并贯通 `proficientSaves`、初始化、事件、控制/继任、combat entity、同步和投影；Table 的开局与 play 中锁卡/继任共用 manifest-gated seed builder，只有 exact env-v4 补 canonical aliases 与职业豁免，旧 current/env-v2/env-v3 的 `static_card_json` 保留原 `skills`/`expertise` sheet shape。统一 profile 必填的 skill/save helper 覆盖 causal、compound、campaign、combat、environment，校验 Expertise 是技能熟练子集且豁免只含六项能力。旧 compound 职业豁免与 grapple/shove 历史特例只在非 v4 保留。
- 定向检查：profile/causal/compound Node 组合 57/57、workflow/table 25/25（其中最新 Table seed Profile 矩阵 21/21）、campaign 2/2、combat concentration save 1/1、V4 control/successor Worker 1/1、dynamic Room 6/6，均退出 0；dynamic Room 首轮因两个长用例超过默认 5 秒退出 1，给这两个既有长边界显式 15 秒预算后普通目标命令退出 0。`npm run typecheck` 与 `git diff --check` 均退出 0。
- 剩余限制：未运行全量测试、build、lint、浏览器 QA、远端操作或部署；未提交、推送。完整发布门由当前冻结流程统一执行。

## V3 权限竞态与 Context 秘密边界（2026-08-30）

- 症状与根因：准备阶段曾可能在跨 principal 重试时复用另一玩家投影；自由文本点名还会把不同 scene NPC 的 `knowledge/plans` 注入主 KP；控制权转移与已经排队的普通/到期 ActorPlan 之间缺少最终权限重验，并可能留下旧作用域 prepared stage。另有部分 V3 workflow 绑定可降级到旧解释器。首个违规点分别在 Room prepare/projection cache、`relevantNpcViews`、管理事务后的提交边界与 exact binding 校验。
- 修改：投影复用绑定 authenticated principal/session/seat/control 与 projection hash；NPC Context 只纳入当前 scene；V3 workflow/runtime/module/profile 必须完整精确匹配；控制转移原子更新所有受影响 scope version、删除对应 prepared stage，并在普通与 due ActorPlan 最终提交前重新鉴权；未结清 combat randomness 时拒绝转移。
- 定向检查：Room authority 10/10、production context 11/11、V3 binding 4/4、multiplayer control 2/2、due former-controller 1/1、combat randomness transfer 1/1，均退出 0。只读安全复核随后未发现新的 P0/P1；telemetry、API、Rules projector、环境 exact basis/target discovery 与 archive allowlist 均保持服务端权威。
- 剩余限制：`unresolvedThreats/stories` 与玩家公共投影字段相同，仅记为未证实泄漏的 P2 观察；冻结全量、真实 HTTP/浏览器与线上日志仍由发布门验证。

## D1 settled archive checkpoint 与真实恢复（2026-08-30）

- 症状与根因：D1 归档原先只有分页 append，没有声明“完整可恢复前缀”的单调 checkpoint，也没有 D1 rows→完整 archive→空 DO 的真实入口；旧完成判断还可能相信伪造 `auditCursor`，恢复端按 character id 与 D1 `viewer_hash` 的不同顺序比较审计，并会把已经移除的历史成员重新授权。
- 修改文件：`db/schema.ts`、`drizzle/0011_low_leo.sql`、`app/_runtime/lib/room/archive.ts`、`app/_runtime/lib/room/durable-object.ts`、`tests/archive-d1-batches-v2.test.mjs`、`tests/archive-do-resume-v2.test.ts`。最终分页批次先核对已写与本页 audit 的精确 `viewerHash+projectionHash` 集合，再原子单调推进 checkpoint；probe/reader 核验 genesis、event/state/branch 与 checkpoint prefix replay。只有 service capability 可从 D1 恢复到空 DO；恢复审计按 event/viewer/projection canonical 排序，成员/控制索引只从当前活跃状态重建，历史实体仍留 Rules state 但不复权；archive 在导出及 replay 后都拒绝未结清随机。
- 定向检查：`npx tsx --test tests/archive-d1-batches-v2.test.mjs` 退出 0，11/11（含旧 checkpoint 的 D1 `event_json` 前缀篡改、ahead event 与 genesis conflict 拒绝）；`npx vitest run tests/archive-do-resume-v2.test.ts -t 'resumes 80'` 退出 0，1/1（80+ events、48 audits、真实 D1 reader→fresh DO，73.73 s）；同文件无当前受控 viewer 的 D1→fresh DO 退出 0，1/1；combat archive/randomness 与 recovery 定向各 1/1；`npm run typecheck`、`git diff --check` 退出 0。Wrangler local `0000–0011` 与独立 SQLite `0010→0011` 的 migration/checkpoint 写读均退出 0。
- 剩余限制：本地证据不替代冻结全量和远端 D1。发布时仍须先取得新的 Time Travel bookmark，再串行应用 `0008–0011`、验证无 pending，然后才部署现有 Worker。

## 冻结候选 Lint 快修（2026-08-30）

- 症状与根因：冻结提交 `162b61c` 的前三项正式门通过后，首次 `npm run lint` 退出 1；三项均为本批新增代码中的静态错误：测试重算 genesis hash 时留下未用解构变量，module scanner 的字符类含多余转义，离线评测环境草稿重复声明 `basisRefs`。
- 修改文件：`tests/chandelier-environment-rules-v3.test.mjs`、`tools/check-modules.mjs`、`tools/run-kp-v3-eval.mjs`。改为复制后删除旧 genesis hash、用等价十六进制字符类表示左方括号，并保留调用者传入的唯一 `basisRefs`；没有改变产品规则、断言或评测范围。
- 定向检查：`npx eslint tests/chandelier-environment-rules-v3.test.mjs tools/check-modules.mjs tools/run-kp-v3-eval.mjs` 退出 0。修复将形成新的冻结提交，随后从 `git diff --check` 起完整重跑全部正式门；首次失败结果不作为发布通过证据。
- Node 门连带修复：`015aebf` 上的首次 `npm run test:unit` 退出 1，477/479 通过；两个失败都是旧测试合同未同步既有产品语义：Profile 枚举漏掉两项 private-forms Profile，HTTP 隐私测试仍假定 ACK 会删除 ViewerKey 已亲历的开场叙述。只更新 `tests/interaction-contract.test.mjs` 与 `tests/observer-http-privacy-v2.test.mjs`，继续断言 ACK 后当前 Delivery/TTS 失效、重连保留亲历正文且跨玩家内容不可见；两文件定向复核退出 0，9/9。新冻结提交仍须完整重跑六项门。

## Worker 拒绝合同与同头 replay 定向收口（2026-08-30）

- 症状与根因：`dd2d7a6` 上 Node 门为 479/479，但首次完整 Worker 门出现 35 项失败；其中五个拒绝用例仍按旧 DTO 精确比较，漏掉生产合同早已统一要求的 `action:notCommitted` / `narration:notApplicable`，chapter migration 测试钩子仍转发旧三参数签名，dynamic ability 恢复用例又把全局登记但未授予角色的 AbilityDefinition 当成可调用能力。其余大量 5 秒 timeout 的共同成本是同一持久事件头在 prepare、commit、publication 和 observe 间被完整 replay 6–8 次；关闭 archive scheduler 的隔离 A/B 无改善，旧/新事件序列与单次 replay 成本一致，排除 D1 checkpoint 和 Profile 穿透。
- 修改：五个拒绝测试补齐双轴结果；chapter 钩子按当前五参数原样转发；dynamic ability 改为验证源 Room 与 fresh restore 都一致拒绝 ownerless 定义、资源与 archive head 不推进。Room 新增只读派生 replay cache：key 精确包含 room/module/profile/genesis/state 原始持久值及 event count、末事件 seq/id/完整 JSON；miss 保存克隆，hit 返回克隆，因此调用者不能污染缓存，提交、更正、恢复或重建会因持久 key 改变自动 miss，跨 `await` 的 archive 二次检查仍重新读取 key。生产事件表仍只追加；热实例绕过 Store 直接改写非末尾事件但同时保持 count/head/state 不变属于未暴露内部写能力的 P2 信任假设，冷实例仍完整 replay 并拒绝。
- 定向证据：原 60 秒超时的 `combat-vertical-v2` 在默认预算下 1/1、49.91 秒；environment destruction 12/12；cache + combat correction + multi-wave randomness 16/16（四崩溃点、并发同 Receipt/faces，命令级 30 秒预算）；D1→fresh DO 的零当前 Viewer 与 80+ events/48 audits 两条恢复 2/2（命令级 60 秒预算）；chapter/dynamic 7/7；portal/zone/error-report 5 passed/3 skipped，tactical 精确拒绝 1 passed/4 skipped。`npm run typecheck`、目标测试 ESLint 与 `git diff --check` 均退出 0。
- 范围裁定：用户在本轮明确要求小改只跑需要的定向测试，因此没有在当前源码上重跑完整 `module:check`、unit、Worker、build 或六项冻结门；一次扩展 Worker 组合在确认剩余红点均为既有 5 秒预算后按该指令中止，不能作为通过证据。远端 migration、部署、浏览器与三交互生产验证仍按已授权发布范围继续。

## V3 Cloudflare 发布与定向线上收口（2026-08-30）

- 发布源码与验证裁定：现有 Worker 实际部署源码为 `4822d2b62d40d922758e77762f378495398958f8`。用户随后明确要求这批小改只运行实际需要的定向测试，不再重跑完整门；因此最终证据由前述类型、目标 Lint、Node/Worker 因果切片与本节新增定向检查组成，不能把中止的扩展 Worker 组合、未重跑的 `module:check`、全量 unit/Worker、全量 Lint 或第二次 build 写成通过。部署后的 `9cc5e3cd97143ac1f6ad2e26513a91e82e617f3e` 只修改 live evaluator 与其测试，不进入 Worker runtime。
- 远端 D1：远端操作前取得 Time Travel bookmark `0000008e-00000000-000050d6-4b4a70c3f3791c37bb1531a7ce61dfc0`；随后只对既有 `DB` 串行应用 `0008_clumsy_lady_vermin.sql`、`0009_huge_red_wolf.sql`、`0010_scrub_kp_static_derived_index.sql`、`0011_low_leo.sql`，全部成功并复查为无 pending。`0011` 以唯一临时 room/checkpoint 完成写入→读取→精确删除，最终两表对应计数均为 0。脱敏 Profile reference gate 只得到 4 个可恢复房间引用同一受支持 manifest `runtime-srd51-2014-authoritative-v2` / `sha256:496da17f16d52cbe5dfa3e97facfa8ed7dcf3f4bbb7a882fc0e384d464898051`；没有记录房间正文、genesis 私密字段或用户数据。
- 部署：第一次 `npm run cf:deploy` 因未传 `DEPLOY_SOURCE_SHA` 在 preflight 退出，发生在 build、Wrangler 和任何远端写入之前。随后从干净临时 clone、精确源码 `4822d2b62d40d922758e77762f378495398958f8` 传入源码 SHA 与脱敏 Profile gate，唯一一次实际 build/deploy 成功更新既有 Worker `zhuwei`。当前 deployment `834c2b79-c24f-4d7c-9aca-ef523b4e7eea` / Version `97291f34-67cf-47a4-a9f6-899db6ee975a` 承接 100% 流量，入口仍为 `https://zhuwei.yinskyriver.workers.dev`；compatibility date `2026-05-22`、flag 仅 `nodejs_compat`、DO migration tag `room-do-v1`，绑定仍只有既有 `AI`、`ASSETS`、`DB`、`ROOMS` 与 `DEEPSEEK_API_KEY` Secret 名称，没有创建新资源或读取 Secret 值。
- 浏览器：在真实已部署前端上以 375×812 与 1440×900 各执行观察、NPC 对话、Proposal 失败、Narration 重试和动态环境入口，共 10/10 通过。每条路径的 document/body 宽度都精确等于 viewport、可见元素无横向越界，console/page error 与 failed request 均为 0，秘密 canary 未进入 DOM、ARIA、URL 或网络正文。Proposal 失败保留草稿且没有 committed bubble；Narration 失败后玩家行动只保留一条，`sendAction=1`、`retryNarration=1`，Receipt/settlement 仍为单一；动态输入只提交自然语言与稳定 submission id，公开呈现 KP 可自定义的“风摆布幕” `state-only` 与“蒸汽漫流区” `area-hazard`，没有吊灯专项。五条浏览器路径都在页面 `/api/game` 边界拦截确定性的公开 DTO；Proposal 失败、Narration 重试和动态环境三路再分别注入故障或自定义动态状态，Provider action 为 0。该证据只验证已部署前端壳的视觉、DOM 与公开状态处理，不是五条真实 API 流程；真实 HTTP/auth/Room/Provider 接缝由独立三交互 smoke 验证。QA 临时会话已注销、唯一 auth 用户已精确删除并验证，未创建房间。脱敏报告 SHA-256 为 `7dc4761dbac219d49b2762bde06a598bbf7062ba1b0bb1a08d25c5e98ff71994`。
- 唯一生产三交互：严格且只执行一次 `node tools/run-live-kp-eval.mjs --interactions=3`，没有调用默认 31 轮。真实 HTTP/auth/Room/Provider 完成 3/3 interactions，`liveModelVerified=true`，使用 `deepseek-v4-flash` 与 `dnd5e-2014-srd5.1-authoritative-v2`；秘密泄漏、替玩家选择、骰后改判、重复随机/资源和伪收束五个硬门均为 false，全部脱敏断言通过。原命令退出 1 / `LIVE_EVAL_STATUS_FAILED`，唯一布尔红门是 `secondAuthority=true`；已确定至少有一个足以单独置红的 evaluator 误判：旧 assessor 仍要求内部 `eventRange/scopeVersions`，而 V3 为隐藏目标固定公开基数，response receipt 合法地只有五个身份/状态字段，Table receipt 又只投影三字段。这条 `versionAdvancedWithoutDoReceipt` 信号本身不是生产第二权威证据；纯结构复现可稳定重现。`9cc5e3c` 现让 compact receipt 以五字段自证并与 actor 三字段投影匹配，每个 identity 只可覆盖一次单调 mutation，完整 receipt 的精确 range 校验及所有 forbidden/projection/card/version 检查保持不变。定向 runner 8/8、目标 ESLint、公共 V3 outcome 7/7 与 diff-check 均退出 0；按用户三交互上限没有再次调用生产 Provider。原报告裁剪没有保留 `authorityEvidence.signals`，因此不能声称已排除同一布尔门内的其他共现信号，这一点保留为诚实限制。
- 清理与日志：三交互房间返回 `deleteRoomConfirmed/finalized`，host/player 会话均 revoked；runner 的账号确认步骤返回 unconfirmed，但独立远端 D1 复核本次 15 分钟窗口的专用临时邮箱前缀计数为 0，证明两账号实际已删除。对精确新 Version 开启的 15 秒 `status=error` Live Tail 捕获 0 error、0 敏感标记并已停止，这只是短实时窗口；随后唯一一次历史 Observability 查询因当前 OAuth 缺少相应权限返回 403，没有历史日志证据，也没有重试或扩权。
- 终审与 Git：冻结前安全/版本/归档复审均未发现生产可达 P0/P1；replay cache 仍记录一个 P2 信任假设：热 DO 内若绕过唯一 Store 同时篡改非末事件并保持 count、tail 和 state 不变，缓存会到 head 改变或冷启动才重新完整验证，现有 API/生产写路径没有该能力。功能、测试及 evaluator 修复提交 `9cc5e3cd97143ac1f6ad2e26513a91e82e617f3e` 已经非 force 快进进入 `origin/cloudflare` 提交历史；该次源码推送复核时远端 `main` 仍为基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`，未 checkout、merge、提交或推送 main。本节所在 docs-only 发布事实提交随后也通过显式 refspec 非 force 推送；提交后精确 ref 复核确认 `origin/cloudflare` 与本地 `HEAD` 相等，远端 `main` 仍保持上述基线。本节只记录已发生事实；完整线上模型指标与 31 轮质量评测仍按用户裁定留给用户自行执行。

| 时间（Asia/Shanghai） | 命令/检查 | 退出码 | 证据摘要 |
| --- | --- | ---: | --- |
| 2026-08-30 | `npx wrangler d1 migrations apply DB --remote`；pending 复核；`0011` 远端写读清理；脱敏 Profile reference gate | 0 | 0008–0011 串行成功、无 pending；临时 checkpoint/room 最终均为 0；4/4 引用均为受支持 manifest。 |
| 2026-08-30 | 首次 `npm run cf:deploy` preflight；随后带 exact source/profile gate 的实际 `npm run cf:deploy` | 1；0 | 首次在 build/远端写前拒绝缺失 SHA；唯一实际部署更新现有 Worker，Version `97291f34-67cf-47a4-a9f6-899db6ee975a`。 |
| 2026-08-30 | `wrangler deployments status` / `versions view`；15 秒 exact-version error Tail | 0；0 | deployment `834c2b79-c24f-4d7c-9aca-ef523b4e7eea` 为 100%；绑定/compatibility 不变；短窗 0 error/0 敏感标记。 |
| 2026-08-30 | 真实生产前端 Playwright，375/1440 × 五路径 | 0 | 10/10；无横向溢出、console/page error、失败请求或秘密 DOM/ARIA/网络旁路；Provider action 0；账号清理通过。 |
| 2026-08-30 | `node tools/run-live-kp-eval.mjs --interactions=3` | 1 | 3/3、live model verified；仅旧 evaluator 的 compact-receipt 单权威误判置红，其余五硬门与脱敏通过；房间/会话/账号均已清理，未重跑。 |
| 2026-08-30 | `npx tsx --test tests/live-kp-eval-runner.test.mjs`；目标 ESLint；`npx tsx --test tests/table-server-outcome-v2.test.mjs`；`git diff --check` | 0 | 8/8；Lint 0；7/7；V3 compact receipt 误判修复及完整 receipt fail-closed 连带路径通过。 |
| 2026-08-30 | `git push origin HEAD:refs/heads/cloudflare`；远端 refs 复核 | 0；0 | 源码/evaluator 非 force 快进至 `9cc5e3c`；本节 docs-only 发布事实也以同一显式 refspec 非 force 快进，提交后 `origin/cloudflare` 与本地 `HEAD` 相等；远端 `main=29eb06dc009c983ad61b2d862454503e67a7f40a` 未变。 |

## KP 回复快速失败原因澄清（2026-08-30）

- 症状与根因：叙述可能在数秒内立即进入“重试 KP 回复”，但未分类异常仍被 `narrationFailure` 默认记为 `NARRATION_PROVIDER_TIMEOUT`；页面又只说明“尚未送达”，没有区分模型/格式/事实校验/发布故障。首个违规点是错误分类把“可重试”误当作“确实超时”，而恢复按钮本身只表示叙述未完成。
- 修改：`app/_runtime/lib/room/action.ts` 只把明确的兼容模型瞬时/额度错误保留为 Provider timeout 类，未知异常改为通用 publication failure；`table/authoritative.ts` 新增安全的失败原因与恢复状态文案；`table/server.ts` 在不暴露私密错误的前提下返回对应原因；`play-table.tsx` 明示行动已结算，并分别解释处理中、格式/事实拒绝与服务/发布失败，强调快速失败不等于超时且重试不会重新裁定、掷骰或消耗资源。生产公开错误码集合与持久化 Profile 均未改变。
- 定向验证：新增 RED 先稳定复现未知异常实际得到 `NARRATION_PROVIDER_TIMEOUT`；修复后该用例 1/1、`tests/table-server-outcome-v2.test.mjs` 8/8、`tests/viewer-narration-recovery-v3.test.ts` 4/4、`npm run typecheck` 与 `git diff --check` 均退出 0。既有 `vinext dev --hostname 127.0.0.1 --port 3000` 来自当前工作树并由 HMR 接收改动，`http://127.0.0.1:3000/` 返回 200。首次真实本地注册因 local D1 尚未应用 migration 返回 500；顺序应用既有 `0000–0011` 后复核无 pending，通过真实 `/api/auth/register` 创建专用本地测试身份，认证 cookie 访问 `/hall` 返回 200 且页面含该身份称呼。
- 剩余限制：本轮按用户要求只送到 localhost，专用账号只存在本地 D1；未加入假身份或鉴权旁路，也未提交、推送或重新部署生产 Worker；没有为该纯文案/分类快修扩大完整测试门或线上 Provider 调用。

## KP 回复澄清增量发布（2026-08-30）

- 授权与源码：用户随后明确要求“推送部署”，并继续要求小改不跑完整门。上节 7 个文件以 `25c05ec7315808331f43026cd2ff0aafced922c2`（`fix: clarify kp narration recovery`）冻结；独立复审未见 P0/P1，并把 `NARRATION_BODY_INVALID` 公开文案收宽为“服务配置或返回内容未通过有效性检查”，避免把权限/配置永久错误也误说成回复格式错误。
- 验证裁定：复用前述冻结证据，本增量实际通过原 RED 修复路径 1/1、`tests/table-server-outcome-v2.test.mjs` 8/8、`tests/viewer-narration-recovery-v3.test.ts` 4/4、`npm run typecheck` 与 `git diff --check`；文案收宽后只重跑直接的 table outcome 8/8。未把未运行的全量 module/Lint/unit/Worker 门写成通过。
- 远端前置：`wrangler.jsonc`、schema、migration、依赖与 lockfile 均无本次改动；既有 `DB` 复核为无 pending migration，脱敏 Profile reference gate 验证 6 条引用全部对应已注册的 authoritative-v2/environment-v4 manifest。只确认既有 Worker 含 `DEEPSEEK_API_KEY` Secret 名称，未读取或改写其值；localhost 不会继承该远端 Secret，需由用户在被 Git 忽略的本地 `.env` 单独配置。
- 部署：干净临时 clone 精确检出 `25c05ec`；`npm ci` 按 lockfile 安装 511 个包，报告既有 12 项 audit 提示而未自动修改。首次命令因把未裁剪 genesis 证据放入环境变量而在本机以 `Argument list too long` / 126 退出，发生在 build 和远端写入前；改用同一 D1 查询中只保留 gate 实际验证的 room/epoch/Profile 字段后，唯一一次实际 `npm run cf:deploy` 成功。新 deployment `2c1f5d25-e1ab-4209-94e2-480f04193bdf` / Version `6de01858-453a-4c4a-a91c-415c74f7f3e8` 承接 100% 流量，`https://zhuwei.yinskyriver.workers.dev/` 公开入口返回 HTTP 200。
- Git 与剩余限制：源码提交已以显式 refspec 非 force 推送到 `origin/cloudflare`，当时精确为 `25c05ec`；远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。本节 docs-only 事实提交将再以同一非 force refspec 推送并复核两个 ref。发布后只执行控制面与公开 HTTP 冒烟，没有创建生产账号/房间、提交行动、诱发故障或再次调用 DeepSeek；因此证明了新版本已上线，不另行声称外部 Provider 能力的新一轮验收。

## KP 事实拒绝、线索呈现与对话顺序快修（2026-08-30）

- 症状与根因：本地房间中玩家三次输入都已提交，被拒绝的是提交后 KP 正文；历史开场旁白只用于语气却被模型重用为当前事实，grounding 拒绝后又没有窄重写路径。Rules 已结算的 `KnowledgeAcquired` 随即被 Table 映射为线索，因而出现“无 KP 回复却先有线索”。前端在 Delivery id 未前进时又把新的本地行动插到旧 Delivery 之后、已持久的上一句之前，并一直呈现旧恢复警告。
- 修改：V3 正文首次仅因事实依据不足被拒时，在同一总时限内自动重写一次；重写不带历史对话或被拒正文，也不把玩家 `actorAction` 里的世界断言当成既成事实。未被粗分类器识别的自由输入不再因缩到三张 Form 而失去观察/动态事实路径；它们统一将 `ordinary-check` / `environmental-stunt` / `observe` / `materialization` / `compound` 五种小型结构交给 KP 按语义选择，没有为“看看/怎么死”等复现措辞新增关键词特判。同时明示玩家话语不是 NPC 台词、死因或新物证的事实依据。Room 在叙述恢复期只标记本次未投递结果之后新增的 knowledge ref，Table 暂不展示对应线索；权威状态和 Receipt 不回滚，正文投递后线索正常出现。对话合并改为已持久历史在前、新行动在后；提交新句子后旧恢复警告立即从当前界面消失。
- 定向验证：Node 组合目标 6/6（grounding 单次重写、玩家断言非事实、正常/失败 Delivery 对话顺序、Form 候选结构、三条真实话语的通用 Form 候选）退出 0；Worker 真实 Room 的“提交线索→正文拒绝→线索暂藏→恢复投递→线索显示” 1/1 退出 0；`npm run typecheck` 和 `git diff --check` 退出 0。本地 `127.0.0.1:3000` 保持运行并已热更新。
- 剩余限制：本次按快修边界未设计通用的 NPC 台词分句级 knowledge-ref 标注；开放留白中的新事实仍由 KP 在当前 Context/Form 内决定。未运行全量门、浏览器全站 QA、真实外部模型探针；未提交、推送或部署。

## V3 玩家亲自掷骰与 NPC 自动骰快修（2026-08-30）

- 症状与根因：V3 Rules 虽已在骰前冻结角色属性、熟练、DC、优势/劣势和骰式，Room 却会立即生成玩家与 NPC 的全部骰面，Table 又固定丢弃权威待掷列表并拒绝权威掷骰按钮；因此玩家没有亲自触发自己的检定。另一个直接边界是同批攻击/豁免不能按“整条行动由谁发起”归属，否则会把玩家造成的 NPC 豁免或 NPC 对玩家的攻击错误交给玩家。
- 修改：V3 Room 对每颗随机请求按实际掷骰者归属；玩家角色的属性/技能检定、攻击、伤害、先攻、豁免、死亡豁免与恢复骰先持久化为待掷，只向当前控制者投影按钮。按钮只授权该冻结请求，浏览器不能提供骰面、加值或改 DC，最终骰面仍由 DO 的加密随机源生成；NPC、环境和隐藏现实骰不显示按钮并由系统自动生成。多人或 due NPC 阶段中，玩家点击自己的豁免后以 Room 认证的原行动/原 principal 续接，不会把点击误作新行动或让代点者接管原行动。Table 现消费权威待掷投影并在点击后刷新。
- 定向验证：`contest-room-randomness-v2` 的 V3 用例 1/1，证明点击前 0 次随机、非控制者不可点、玩家点击后 Room 生成玩家 17 与 NPC 6 两颗骰，并覆盖玩家/NPC 攻击与豁免归属对偶；`authoritative-action` 玩家点击续接 1/1，覆盖另一玩家负责豁免时仍以原 principal 提交原 intent；`authoritative-table-v2` 21/21；due ActorPlan 随机恢复 1/1；`npx tsc --noEmit` 退出 0。localhost 已热更新，`http://127.0.0.1:3000/` 返回 200。
- 剩余限制：按开发期快修要求未跑全量门、build、浏览器全站 QA 或真实外部模型探针；未提交、推送或部署。旧非 V3 delivery profile 保留既有冻结回放语义。

## V3 Narration 亲历对话形状快修（2026-08-30）

- 症状与根因：Room 冻结的 `experiencedTranscript` 使用版本化 `{schema, sceneId, messages}`，body-only Narration 的 `recentDialogue` 适配器却只接受裸数组，导致真实 Viewer Narration Context 静默丢失全部亲历对话；首个违规点在 Narration 输入适配层。
- 修改文件：`app/_runtime/lib/kp/narration-v3.ts`、`tests/authoritative-kp-adapter.test.mjs`、`tests/viewer-narration-recovery-v3.test.ts`。适配器现在读取 exact `zhuwei.experienced-transcript/v1.messages`，同时保留裸数组兼容；目标 Node fixture 改用生产形状，真实 Room 测试证明行动者收到自己的当前对话而其他 Viewer 不会收到该原文，grounding 替代仍不携带历史。
- 定向检查：生产形状 RED 用例修复前退出 1（`recentDialogue 0 !== 1`），修复后目标用例 1/1；`npx tsx --test tests/authoritative-kp-adapter.test.mjs` 退出 0，27/27；`npx vitest run tests/viewer-narration-recovery-v3.test.ts` 退出 0，5/5。
- 剩余限制：未运行全量门、typecheck、build、浏览器 QA 或真实外部模型探针；未提交、推送或部署。该修复只恢复逐 Viewer 的措辞连续性，不扩大 Narration 的事实依据或秘密可见范围。

## V5 泛化角色前提与社交周旋（2026-08-30）

- 症状与根因：角色来由和玩家自述仍可能经 KP 自由文本越过来源边界，已有 `dynamic:npc` / `dynamic:opportunity` 只完成定义登记而没有统一进入 NPC 运行态；社交检定又缺少 NPC 属性、关系、共同证据、差值分档和骰前退出/改口状态机。首个违规点分别是 Form→Rules 的无类型事实接缝、Definition→Entity 激活接缝、社交 Rules 计划，以及 Room 的玩家掷骰恢复边界；不是药剂师、信使、猎魔人或其他名称关键词缺失。
- 修改文件：新增 `module/black-oak-will-social.ts`、`rules/profiles/social-resolution.ts`、`rules/v2/social-actions.ts`、`rules/v2/social-model.ts`，并修改 KP Form/Context/Narration、Module/Profile registry、Rules event/state/project/replay、Room/Authority/Table/UI 直接消费者。新房专用 V5 把前提固化为带 policy/archetype/source refs 的类型化事实，沿原有通用动态定义协议登记 NPC/机会，再用 `DynamicEntityMaterialized` 激活实体并只授予显式知识；玩家陈述保持 unresolved SourceClaim。社交边界由 NPC 洞悉/熟练、关系、双方共有类型化证据和利害共同派生，骰面相对最终边界按差值分档；玩家可坚持、接受现状或用自由文本降级/转开旧线程。玩家骰候选在 DO 持久化，支持崩溃、精确控制权转移和丢响应同 Receipt 恢复，不重提案、不重掷。V3/V4 manifest/hash/旧随机转移门保持原义。
- 定向检查：`tests/social-resolution-v5.test.mjs` 退出 0，4/4（两组任意别名、既有 generic definition 激活、NPC/关系/证据/差值、接受现状与改口）；相关历史 KP/因果组合最终目标均通过。公共 action/table/delivery/context 组合首轮 54/58，修正一个 V3 `socialCapabilities:null` 兼容漂移及三个测试合同后复核为 57/58，仅剩候选顺序断言，目标 context 再跑 12/12。`tests/social-room-randomness-v5.test.ts` 首轮发现并修复 social pending answer 未进入直接 Rules 分支，第二轮仅修正旧控制者应被拒绝而非收到空列表的断言，最终 1/1；V4 combat transfer gate 1/1、V3 Viewer Narration recovery 5/5。`npm run typecheck` 与 `git diff --check` 退出 0。
- 剩余限制：未运行全量测试、build、全项目 lint、浏览器 QA、真实 DeepSeek 长局或外部 RAG/免费模型探针；没有 migration、提交、推送或部署。能力只由 V5 新房选择，旧房不会静默升级；本轮也未新增或更换免费模型、向量库或静态 RAG 实现。

## V5 动态 NPC 机械定义与装备一致性（2026-08-30）

- 症状与根因：通用动态 NPC 可以形成叙事/社交实体，但首次进入战斗时仍需提交一次性平铺数值，既没有“KP 提议完整定义→Rules 校验冻结→多个实例复用”的稳定接缝，也没有让库存转交、NPC 换装和战斗能力按事件保持一致；V5 当前 Private Form 又无法容纳完整生物定义，KP 私有 Context 也缺少权威背包。首个违规点是 V5 Form/causal ingress 与 Rules 定义/实例边界，而不是缺少某个名称关键词或要求每个敌人预制模板。
- 修改文件：新增 `rules/profiles/npc-mechanics.ts`、`rules/v2/npc-mechanics.ts`、`tests/npc-mechanical-definition-v5.test.mjs`；修改 V5 manifest/Profile registry、KP Form/提示/私有 Context、ability compiler、combat/campaign/multiplayer/compound/causal action 与对应 event/model/correction/projector/runtime invariant。新 Profile 允许 KP 为真正新类型提交一份闭合的 2014 生物与 AbilityDefinition，Rules 在先攻随机前校验、编译和冻结；普通同类个体复用 definition ref，已有 NPC 只允许一次保持身份/场景/位置及既有 HP/资源的机械化。HP、资源、位置、状态和装备保留为实例运行态；库存转交不自动装备，穿戴/收起仅从权威背包、冻结属性与 pinned 标准装备派生 AC/武器能力，保留固有能力且不会抹掉其他移动模式。V5 Private Form 使用三种 exact typed drafts，经 continued-root 进入同一 `step`；可信 actor、场景、实体、物品、模板和可见因果依据均由 Rules 闭合。玩家与同场 NPC 的 loadout 只进入 exact Profile 的 KP 私有 Context，V3/V4 不新增该字段。
- 定向检查：`npx tsx --test tests/npc-mechanical-definition-v5.test.mjs` 退出 0，8/8；覆盖真实 `compileKpFormDraft→step→awaitingRandomness→权威续跑/replay`、V4 零事件隔离、共享模板/独立实例、旧 NPC 首次机械化、既有状态保存、非法重配与非法 AC model fail-closed，以及 causal 转交/换装后的库存、AC、固有/装备能力和移动模式。`npx tsx --test tests/kp-form-context-v3.test.mjs tests/social-resolution-v5.test.mjs` 退出 0，14/14；V4 Form 上限保持 2,000、V5 仅 materialization proposedFact 扩至 8,000，角色前提与社交相邻路径保持通过。Profile canonical registry 返回 `true`；`npm run typecheck` 与 `git diff --check` 退出 0。
- 剩余限制：装备派生目前只覆盖 pinned 标准 gear catalog；首次模板中的 ability 视为固有能力，尚未为任意动态物品建立独立 ItemDefinition 来源关系；活跃 encounter 内的转交/换装因尚无行动经济协议而 fail-closed。未运行全量测试、build、lint、浏览器 QA 或真实 DeepSeek 探针；没有 migration、提交、推送或部署。

## 代理合同的主 PRD 权威与实现取舍（2026-08-30）

- 症状与根因：原 `AGENTS.md` 只在部分叙事主题中要求完整读取 `SPEC 0001`，同时把上游概括为规则与视觉权威，没有明确主 PRD、已裁定补充 SPEC、ADR、领域语言和实现证据之间的优先级；也缺少已确认的兼容清理、最小纵切、组件职责、依赖选择、长期架构和成熟交互模式原则。
- 修改文件：`AGENTS.md`、`docs/refactor-log.md`。`SPEC 0001` 现被明确为主 PRD；其他已裁定 SPEC 默认不修改，只有用户明确需求与具体条款实质冲突并经用户确认后才能修改。文档读取路由同步改为主 PRD 优先、直接补充 SPEC 限定读取；新增八项实现取舍，并将无兼容层、fallback 或 migration 的清理规则限定为无持久化、公开或版本化消费者的未发布实现。
- 定向检查：读取新增权威、实现取舍与文档路由全文，核对 `SPEC 0001`、规格索引、`CONTEXT.md` 与 ADR 0013 链接均存在；`git diff --check -- AGENTS.md docs/refactor-log.md` 退出 0。
- 剩余限制：本次只修改代理合同与执行日志，没有修改任何 SPEC、ADR、源码、测试或运行时行为；未运行代码测试、Lint、typecheck、build、远端操作、部署或 Git push。

## iOS Tailscale 本地预览常驻快修（2026-08-31）

- 症状与根因：iPhone 打开 tailnet HTTPS 地址后长期白屏；Tailscale Serve 仍代理 `127.0.0.1:3000`，但 `vinext dev` 随代理临时终端回收而退出，端口无监听且本地请求直接连接失败。首个违规点是预览进程生命周期，不是页面渲染或产品源码。
- 修改：未改产品源码；以用户级 transient systemd 单元 `zhuwei-ios-preview.service` 托管现有 `npm run dev`，保留 exact Tailscale Host 白名单并设置 `Restart=always` / `RestartSec=2s`。既有 tailnet-only HTTPS Serve 继续代理本机 3000 端口，没有开放公网端口、部署或远端 Worker 写入。
- 定向检查：Tailscale Host 本地首页返回 HTTP 200 / `text/html`；受控终止 service 主进程后 `NRestarts=1` 且首页恢复 200；`tailscale serve status` 显示 tailnet-only HTTPS→`127.0.0.1:3000`，服务器到 `iphone172` ping 成功。相关命令均退出 0。
- 剩余限制：该 transient user service 可跨代理回合并在异常退出后恢复，但主机重启后需要重新创建；未运行产品测试、build、全站浏览器 QA、部署或 Git push。

## iOS 本地预览登录账号（2026-08-31）

- 症状与根因：本地 D1 已有一个预览用户，但密码只保存 PBKDF2-SHA256 盐化摘要，没有可恢复或可安全转告的明文开发密码。
- 修改：通过现役 `/api/auth/register` 真实注册路径在本地 D1 新建 `ios-preview-20260831@zhuwei.test`，未修改旧用户、认证实现、远端 D1 或生产 Worker；明文密码只在本次用户回执中交付，不写入仓库或日志。
- 定向检查：注册返回 HTTP 201；同账号正确密码登录返回 200；错误密码对偶路径返回 401，命令均退出 0。
- 剩余限制：该账号仅存在当前本地 Miniflare D1；未执行线上登录、部署、Git push 或其他产品测试。

## V5 动态 NPC 独立物品来源与生命周期闭环（2026-08-31）

- 症状与根因：上一轮已能冻结 NPC 模板并从标准装备派生能力，但模板固有能力与物品能力仍没有独立来源；标准装备转交沿用裸目录 id，多个同类物品会碰撞；首次机械化不会规范化既有装备，动态武器也没有携带者重绑定与耗尽重放闭环。物品损坏、遗失等变化还可由不相关的可见事实授权。首个违规点是 NPC 模板、物品定义、物品实例和当前 loadout 没有形成同一套 Rules 权威身份及生命周期。
- 修改：在 `rules/v2/npc-mechanics.ts` 建立冻结的 NPC Template、独立 ItemDefinition、每个 NPC 唯一的 ItemInstance 和显式 loadout；初始装备及后来转入的标准装备均生成 canonical hash 身份，同类物品不再堆叠或共用 id。固有能力保留在模板，装备 AC/动作只由当前可用且已装备的实例派生；动态武器冻结骰式、伤害类型、使用属性与范围，Rules 按当前携带者属性重新编译。转交、穿戴、收起、损坏、修复、销毁、遗失与弹药耗尽会原子同步库存、槽位、资源、AC 和动作，并能逐事件重放；重甲不再错误叠加负敏捷。动态机械物品暂只允许在机械 NPC 间转移，进入玩家装备路径 fail-closed。KP 发起的物品状态变化必须引用与 NPC、物品及动作精确绑定的类型化原因事实，普通可见事实不能授权改状态。
- 直接消费者：combat materialization/event fold、campaign transfer/use、causal action、runtime invariant、correction、projector、V5 私有 Context/Profile 与 KP Form 合同已同步；V3/V4 在缺少 exact Profile 时保持原行为。标准弹药继续使用 pinned 目录堆叠模型，动态 `wear:ammo` 定义被拒绝，最后一发消耗会同时清除 selector、背包数量和运行态资源。
- 定向检查：`npx tsx --test tests/kp-form-context-v3.test.mjs tests/npc-mechanical-definition-v5.test.mjs` 退出 0，21/21；覆盖独立初始实例、两个同类盾牌转入、既有装备首次规范化、重甲负敏捷、动态武器跨 NPC 重绑定、损坏/修复/销毁/遗失、无关事实拒绝、类型化原因接受、标准弹药转交/使用归零和真实最后一发 combat replay。`npm run typecheck`、Profile canonical registry（NPC、V5 manifest 及全部注册文档均为 `true`）和 `git diff --check` 均退出 0。
- 剩余限制：物品状态目前为可用/损坏/销毁/遗失，没有数值耐久或任意 charges；动态物品尚不能成为玩家机械装备，也不支持自定义动态弹药，只允许引用 pinned 标准弹药；KP 物品状态 Form 需要先存在类型化原因事实，通用战斗中的“直接攻击装备”尚未建立该事实。未运行全量测试、build、lint、浏览器 QA 或真实 DeepSeek 探针；没有 migration、提交、推送或部署。

## 装备与背包前端职责收敛（2026-08-31）

- 症状与根因：角色侧栏把装备与背包展示、静态目录解析和两套独立换装 busy 状态都堆在 `play-table.tsx`；未知装备会被误报为空，未知背包物品会暴露内部 ref，数量汇总又把箭矢、金币等所有单位称为“件”。首个违规点是库存展示组件仍把静态目录命中当成“物品存在”的事实，并分别创建可并发的换装控制器。
- 修改：新增 `components/inventory-panel.tsx`，让身上与背包共用一个带同步 in-flight 门的换装控制器，成功后仍刷新 Room DO 投影；未知物品统一安全显示“物品资料不可用”，已装备但资料未知的物品仍可请求收纳，不再伪装成空槽或把内部 ref 当名称。汇总改为装备槽数量及“种类/总数量”，展开区补齐 `aria-expanded`、`aria-controls`、受标注 region、触控高度和明确处理中反馈；`play-table.tsx` 只负责装配该独立组件，没有新增使用、交易、丢弃按钮或客户端机械规则。同步调整直接源码消费者测试并新增库存展示定向测试。
- 定向检查：`npx tsx --test tests/inventory-panel.test.mjs tests/authoritative-service-routing-v2.test.mjs tests/room-management-and-action-copy.test.mjs` 退出 0，9/9；覆盖未知物品安全显示、槽位/种类/总数汇总、展开可访问状态、共享单次提交门、权威换装刷新及不恢复“点火把”旧入口。`npm run typecheck` 与 `git diff --check` 均退出 0。
- 剩余限制：公开投影仍只有旧 `itemId/quantity` 并在页面边界转换为 `qty`，尚不能展示动态定义、实例状态、charges、耐久或 Rules 投影的可用操作；本次按并行边界没有设计 DTO，也没有增加消费品行为。未运行全量测试、build、全项目 lint、浏览器 QA、部署或 Git push。

## 0.4 开发重置与前版本房间退役（2026-08-31）

- 症状与根因：产品仍同时携带 Legacy rules、旧 runtime/KP workflow/model Profile、旧 Room/D1 活跃状态路径及其恢复测试；即使新房已固定当前闭包，旧目录行仍可能进入多版本分派。用户明确确认开发期放弃全部已有房间、以后再裁定兼容，并把当前应用版本定义为 0.4；首个违规点是生产 Registry、Room 路由和持久化仍把无现役消费者的历史合同当成当前能力。
- 修改：包版本改为 `0.4.0`，保持产品代际 V3 与 rules/runtime/event/profile 的独立版本轴；Registry、KP 目录/工作流、模组、API/Table/Room/DO 和测试只保留当前精确 Ruleset、V5 runtime 及 hash 闭包，旧绑定显式退役且只允许房主删除可见目录行，不 fallback。删除 Legacy Adapter、旧规则/Room/KP 入口、旧 D1 状态表和直接历史测试；`0012` 删除旧状态表，正式登记的 custom migration `0013` 在实际执行时单向清空迁移前房间、成员、角色及权威归档。README、ADR 0013、SPEC 0013/0015、规格索引/追踪/交叉审查、DEC-045、CONTEXT 与代理合同同步记录该经确认的窄取代范围。
- 连带检查与证据：`npm run db:generate`、`npx drizzle-kit generate --custom --name=reset_pre_0_4_rooms` 均退出 0；隔离本地 D1 从 `0000` 至 `0013` 全部迁移退出 0，迁移后房间/事件归档为 0，随后 0.4 房间默认 Ruleset/当前 KP Profile 写入—读取退出 0。Node 当前版本/绑定/KP/交互组合退出 0（86/86）；Worker 删除、V5 随机、Viewer 恢复与发布恢复组合退出 0（12/12），类型收口后两条直接恢复路径复核 7/7。`npm run typecheck` 首轮暴露并修复一个不可能的聚合 `superseded` 分支和一个缺失类型导入，复核退出 0；最终 `git diff --check` 退出 0。
- 剩余限制：未运行全量 `npm test`、全项目 Lint、production build、浏览器全站 QA 或真实模型探针；没有执行远端 D1 migration、删除远端房间、部署、提交、Git push 或修改远端 `main`。仓内 `0013` 只有在之后获得明确远端 migration/发布授权并实际执行时才会删除远端数据。

## KP 窄 Form 工具协议与并行集成（2026-08-31）

- 症状与根因：主 KP 原先通过单一 `submit_private_kp_form` 填写 `{formId,draft}` 大 envelope；工具选择、Form 选择和大联合 Schema 同时集中在一处，模型一旦产生无工具、多工具、错误 Form、坏 JSON 或字段漂移，就难以在不改变玩家语义的前提下安全恢复。首个违规点是模型传输层把“选择哪张表”和“填写表内容”重复编码，而 Room action、旁白重试、更正和组队入口又没有全部复用完整 runtime/module/workflow 绑定校验。
- 隔离实现与合并：在独立 worktree 分支 `kp-narrow-tools-worktree` 从 `f66307d` 建立 checkpoint `a89606f`，完成 `c0f9631`、`290cdb3`、`4c9cd86` 三个候选提交；两个只读并行审查分别枚举直接消费者及复核失败/语义冻结边界。由于主 `cloudflare` 工作树同时含 0.4 退役和 V5 物品修改，最终没有用整树 merge 覆盖它们，而是逐文件三方整合：保留 V5 Form/物品语义，采用 0.4 current-only Profile，并解决 workflow 常量、Room binding 与 migration 顺序冲突。
- 修改：十张 Form 各有一个稳定私有工具名，服务端每次只暴露 allowlist 中的 3–6 个 direct-draft closed schema，并要求恰好一个、禁止并行的工具调用。合法工具的 JSON/schema/reference/semantic 错误只获一次同工具修订；原始坏 JSON 最多保留 4,000 字符，只有完整直接顶层且不重复的成员能证明冻结语义；无/多/未知/未授权工具不进入修订，第二次非法不产生第三次调用。普通/高风险 Form 只有在 Rules 返回精确过窄诊断时，才由服务端授权 `compound.v1` 升级。删除旧 envelope 和通用 Proposal/Narration 超级 Schema 公共入口；成功候选仍只经确定性 compiler→Rules→Room DO→project，模型不获得随机、事件、状态或提交能力。四个 Room 入口统一在模型构造前验证 D1 模型/Profile、精确 workflow、disabled planner、DO V5 runtime 与 pinned module。新房和 D1 默认值固定 private-tools Profile；迁移顺序保持 `0012` 结构清理、`0013` 0.4 数据重置、`0014` 窄工具默认值。
- 连带检查与证据：窄工具选择/坏 JSON/嵌套与重复键/同工具修订/无第三次/服务端 compound 升级 10/10；完整绑定 4/4；Form/Context/repair/eval/Table/telemetry/页面与 migration 合同组合 71/71；真实 Room/Rules/project/archive 长轨迹 1/1（68.18 秒）。`npm run typecheck` 首轮定位并修正工具名反向 Map 的窄字面量类型，复核退出 0；`git diff --check` 退出 0。`npm run db:generate`、custom reset migration 与 private-tools default migration 均退出 0；隔离本地 D1 从 `0000` 至 `0014` 全部应用，重置复核 rooms/members/characters 为 0，随后新房写读得到 Ruleset `dnd5e-2014-srd5.1-authoritative-v2` 和 Profile `authoritative-kp-deepseek-v4-flash-private-tools-v1`。一次含页面的早期组合为 20/21，唯一失败是并行 0.4 测试漏导入 `AUTHORITATIVE_KP_MODEL`，补回后已由上述 71/71 正常路径覆盖。
- 剩余限制：未运行全量 `npm test`、全项目 Lint、production build、浏览器全站 QA 或真实 DeepSeek 探针；没有执行远端 migration、删除远端房间、部署或 Git push。Provider 网络/超时/额度错误继续走既有脱敏 Invocation Receipt 和可重试结果，不消耗 Form 结构修订预算；本轮只以故障注入验证该边界，没有声称外部 Provider 可用性。

## 0.4 部署门与模组迁移残留删除（2026-08-31）

- 症状与根因：部署脚本仍扫描全部历史 genesis 并因“缺少 referenced Adapter”阻塞当前源码，当前模组 Profile 又携带无消费者的 `legacyAdapter` 元数据；KP Proposal、Room、Rules、事件 fold 和 correction 还保留一条没有第二个现役模组版本的 migration 纵切。三者都把已由 DEC-045 退役的前 0.4 数据或预防性未来兼容当成当前生产合同。
- 修改：删除历史 Profile reference deployment gate、CLI、测试和部署串联；把唯一 pinned Module 表移至 current-only `module/registry.ts`。删除 `legacyAdapter`、module migration Proposal/绑定/Rules input/事件/回放/更正及其正向测试，章节切换只沿用当前 Campaign `moduleRef`。Event schema 明确固定 single pinned module/no migration，并按 canonical runner 逐层更新 event、runtime manifest、module 与 workflow hash；SPEC 0006/0013、DEC-045、traceability/cross-spec 同步当前边界。
- 定向检查：`npm run typecheck` 退出 0；module 5/5、runtime profile 6/6、V3 workflow binding 4/4、project layout 2/2、architecture/deploy guard 9/9、Rules compound 32/32 均退出 0；`git diff --check` 退出 0。
- 剩余限制：未扩展清理 generic ActionPlan v1、CampaignContinuity v1、legacy NPC plan payload 或缺失 Profile 时的旧语义分支；这些已作为后续只读审计结果单列。未运行全量测试、build、浏览器 QA、远端 migration、部署、提交、push。

## 0.4 统一物品权威与当前行动入口收口（2026-08-31）

- 症状与根因：玩家装备、背包、NPC 模板物品、动态实例和消耗成本分属多套事实源，公开 DTO 不能表达定义、实例、charges、耐久与可用操作；同时生产仍残留旧玩家 ActionPlan/Proposal 类型、恢复 validator、旧 Rules/Room/KP 入口以及只服务前版本房间的 migration/Adapter，当前文档与 canonical hash 也没有随最终闭包同步。首个违规点分别是 Item 定义/实例/所有权/使用转换没有统一进入 Rules，以及退役 transport 仍能成为生产类型与恢复候选。
- 修改：新增统一 `ItemDefinitionV1` / `ItemEntryV1`、pinned 标准装备目录及玩家/NPC 共用转换；堆叠性显式定义，非堆叠物逐件实例化，数量、charges、耐久、损坏收纳、所有权转移、穿戴/收起与使用前后态由同一 `step` 原子裁决，并经 `project` 按 Viewer 裁剪。Table DTO 与独立 Inventory Panel 直接展示权威名称、状态、计数和合法操作，共用单一提交锁；未知条目安全失效，不增加伪造使用、交易或丢弃。当前私有窄 Form、精确 party/campaign capability 与 Due ActorPlan 保留，删除旧玩家 `KpProposalDraft` / `AuthoritativeKpProposal` / `SemanticActionPlan`、旧 validator、Legacy Rules/Room/Module 入口、旧 profile gate 及未发布 migration；NPC ActorPlan 只保留 NPC-only 机械定义。同步 0.4 current-only SPEC/ADR/索引、Profile 文档、事件 schema、Form/workflow/module hash 和旧休整 `arcane` shorthand。
- 连带检查：Due ActorPlan eviction 用例中两条 `ImprovisedActionResolved` 分别是 internal program-freeze 与 public terminal event，并非重试重复；测试改为比较重试前后完整事件流并分别断言各一次。Room retry 的旧“已提交动作仍返回 Receipt”及带 `agencyClaims` 旁白也按当前 ViewerKey recovery 与 exact `{body}` 合同更正；相同机械 proposal 的 commit 仍幂等返回同一结果，归档和骰面不变。生产 `app/` / `tools/` 的旧玩家 proposal 精确符号已清零，仅保留 `tools/check-modules.mjs` 的禁止回流门禁。
- 定向证据：统一物品/背包 Node 组 11 文件 41/41；ActorPlan Room 13/13；Room retry 6/6；当前 KP/adapter/ability/telemetry/runtime/binding/causal 组中 49 个未受更正用例通过，runtime Profile 更正后 4/4，最终直接覆盖 53 个用例无剩余失败。`npm run module:check`、`npm run typecheck` 均退出 0；Profile registry 与 Form catalog canonical check 都为 `true`；`git diff --check` 退出 0。
- 剩余限制：用户明确取消冻结门，因此未运行 `npm test`、全项目 Lint、production build 或浏览器全站 QA。`tests/helpers/authoritative-proposal.ts` 仍是明确标注退役的 test-only fixture，26 个当前行为旧 suite 尚未逐项迁移；代表性旧 contest suite 因生产正确拒绝该 helper 而 0/1，不能作为 0.4 证据，也不构成生产兼容层。本轮没有执行 migration、部署或远端资源写入；集成基线为 `90fbc44bdcc9230b070bd09d528c68e9ae805060`，提交与非强制 push 另记审计。

## 0.4 统一物品版本提交与推送审计（2026-08-31）

- 基线与集成：工作分支 `cloudflare`，本轮起点 `90fbc44bdcc9230b070bd09d528c68e9ae805060`；共享工作树中的前端库存、统一 Item、current-only transport、规格/hash 与定向测试修改逐文件保留，没有用另一 worktree 整树覆盖，也没有未解决冲突。
- 提交与外部操作：代码/规格/测试提交为 `225c6b2`（`feat: unify item authority and current action ingress`）。推送前 `origin/cloudflare` 为 `ae3a41e65383da807cad02a519b80782f3004a9a`，确认未并发前移后执行非强制 `git push origin HEAD:refs/heads/cloudflare`，退出 0，远端前移至 `225c6b2`。
- 边界：推送前确认 `origin/main` 仍为产品基线 `29eb06dc009c983ad61b2d862454503e67a7f40a`；未修改或推送 `main`，未执行远端 migration、部署、远端资源创建或 grok.me 操作。用户明确取消冻结门，验证范围与已知 test-only 旧 fixture 限制见上一条执行记录。

## 代理合同区分能力开发与 Bug 修复（2026-08-31）

- 症状与根因：`AGENTS.md` 原先把所有普通开发任务默认路由为 Bug 快修，只有“最窄复现—最小修复—直接连带”一套完整闭环；当用户用具体实例说明一类新能力时，实例容易被误判为全部交付范围。首个违规点是任务路由和停止条件未区分能力开发与既有行为修复。
- 修改：将开发期入口拆成能力开发、Bug 修复和混合任务三种路由，明确“能力 + 示例”中的能力才是交付对象；新增能力合同、变化维度、代表性验收矩阵、通用事实源和端到端闭包要求，保留最窄复现与最小修复仅约束 Bug 路径。同步区分两条路径的定向验证、文档读取、执行回执和并行边界。
- 定向检查：核对任务路由、两个闭环、实现取舍、开发期验证、文档读取与执行日志条款之间无相反要求；`git diff --check -- AGENTS.md docs/refactor-log.md` 退出 0。
- 剩余限制：本次只修改代理合同与执行日志，没有修改 SPEC、ADR、源码、测试或运行时行为；未运行代码测试、Lint、typecheck、build、远端操作、部署或 Git push。新路由的实际效果仍需在后续能力开发任务中以代表性样例观察。

## KP Agent 系统与组合行动问题审计（2026-08-31）

- 目标：把当前 KP Agent 的核心能力、支撑系统、主要复杂度热点，以及“扔石头探查门上陷阱”暴露的组合行动问题集中记录为探索性审计；该文档不升级为 SPEC/ADR，也不修改现有产品合同。
- 修改：新增 `docs/kp-agent-system-audit.md`，区分已确认问题、静态代码推断和待裁定事项；记录隐藏现实固化、环境触发、观察/知识投影无法在现有单 Form/RootAction 中明确异构组合的核心缺口，并列出措辞敏感路由、普通道具权威层级、有限状态环境、候选公平性、DO/Rules 巨型文件、分散验证和 DTO 适配等问题。
- 定向检查：只检查文档结构、相关 SPEC/源码链接、目标 diff 与 `git diff --check`；未运行代码测试。
- 剩余限制：精确样例尚未经过真实模型与 Room/Rules 端到端探针；收敛方向和五项产品问题仍是建议，不构成实施授权；未修改源码、测试、SPEC 或 ADR，未执行 build、部署、migration 或 Git push。

## 通用组合行动纵切与 0.4 发布前收口（2026-08-31）

- 症状与根因：`compound.v1` 虽能升级过窄 Form，却没有一份可冻结、可回放的异构组合合同来同时表达动态事实、有限知识 NPC 计划、场景问题、Activity、环境转换和世界后果；实现因此容易退化为按信件、对象名或方法哨兵分派。首个违规点是 Form/compiler 到 Rules `step` 之间缺少通用 composition 事实，而不是某个“信件”案例缺少专用分支。ActorPlan 继续只表示 NPC/势力基于有限知识形成的未来意图与到期 Activity，不恢复为玩家行动 transport。
- 修改：新增闭合的 `zhuwei.compound-composition-draft/v1`，以 `before`、`onSuccess`、`onFailure` 三相承载六类类型化 Operation；服务端冻结 canonical `compositionJson`，在随机前验证两个结果分支，提交时只执行命中分支。动态事实、ActorPlan、场景问题、玩家 Activity、环境开闭和世界后果全部复用现役 Rules/事件/投影/replay 事实源；世界后果与默认时间推进只记一次，模型不能提交 actor、Audience、骰面、事件或权威状态。同步 Form catalog、causal language、interpreter、runtime manifest 及 Proposal/workflow hash，并更新当前 SPEC 快照、README 与房间绑定断言；删除冲突的重复临时环境授权 fixture，修正 archive 压测 fixture 的场景容量而不降低生产不变量。
- 连带检查与证据：`tests/kp-form-context-v3.test.mjs`、`private-form-repair-v3.test.mjs`、`causal-action-rules-v3.test.mjs` 首轮 40/41，唯一失败为拒绝结果事件数组的测试断言，修正后该命名用例 1/1；`tests/runtime-profiles-v2.test.mjs` 首轮 3/4，唯一失败为测试仍期待 manifest `5.4.0`，修正后该命名用例 1/1。`tests/compound-action-v2.test.ts` 1/1、`archive-do-resume-v2.test.ts` 5/5、`dynamic-environment-room-lowering-v3.test.ts` 5/5、`v3-room-binding-v3.test.mjs` 4/4 均退出 0；`npm run typecheck` 退出 0。覆盖空组合、六类代表操作、成功/失败隔离、未选分支预检拒绝、单次随机/时间、重放、权限字段注入拒绝、Room archive 恢复及 exact Profile 绑定。
- 发布边界：用户要求只验证修改处并继续推送部署，因此不运行完整冻结门、全量 Node/Worker、Lint 或独立 production build；发布脚本自身的单次构建不计额外冻结门。`0012` 只清理已退役表和旧房间默认值，未获远端 migration 授权，本轮不会应用远端 D1，也不会修改 `main`、grok.me 或创建新 Worker/资源。提交、非强制 push、既有 Worker 部署和最小线上回执另记发布审计。

## 通用组合行动发布与同场权限修复审计（2026-08-31）

- 基线与提交：工作分支 `cloudflare`，发布起点及 `origin/cloudflare` 均为 `2d1485e5c2edc5e024d472b22071db763ce5d14a`。通用 0.4 权威行动提交为 `1fa33f02152757f99ff78cba3297b92b59f730df`（`feat: generalize 0.4 authoritative action runtime`），非强制推送退出 0。迟到的只读权限审查随后指出 compound `formActorPlan` 未复用旧路径的 actor/NPC 同场约束；最短复现修复前确实错误提交异地 NPC 计划，退出 1。`causal-actions.ts` 在形成计划前增加同场拒绝，修复提交为 `411357b14c21963f15572e28a939017f0160bf22`（`fix: enforce compound actor plan scene authority`），异地拒绝 1/1 与原同场真实 Room 纵切 1/1 均退出 0，再次非强制推送退出 0。
- 部署与处置：`DEPLOY_SOURCE_SHA=1fa33f0… npm run cf:deploy` 首次退出 0，产生 Version `23fbf3d4-841b-41ea-8a22-fab7d8b7c490`；因上述权限缺口在初次部署后才返回，该版本立即由修复部署取代。`DEPLOY_SOURCE_SHA=411357b… npm run cf:deploy` 退出 0，既有 Worker `zhuwei` 的最终 Version 为 `b0ff1fc6-419b-4335-9552-40d80ca4e8ce`；`wrangler deployments status` 退出 0，并确认该 Version 承接 100% 流量。两次命令中的 build 都是部署脚本必经步骤，没有另跑完整冻结门。
- 最小线上回执：`https://zhuwei.yinskyriver.workers.dev/` 返回 HTTP 200，耗时约 0.366 秒；没有执行真实外部模型探针、浏览器整站 QA 或扩大线上状态写入。两个隔离本地 D1 临时目录已清理。
- 远端边界与未覆盖范围：最终代码 push 后 `origin/cloudflare` 精确为 `411357b14c21963f15572e28a939017f0160bf22`，`origin/main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`；未修改 grok.me、未创建 Worker/D1/其他资源，也未执行 `0012` 远端 migration。按用户要求未运行 `npm test`、完整 Node/Worker、全项目 Lint 或完整冻结门；发布结论只由上一条列出的定向证据、部署脚本构建、控制面 100% 流量和首页冒烟支持。

## 远端 D1 `0012` 更新审计（2026-08-31）

- 授权与目标：用户在获知 D1 migration 会改变远端数据库结构并可能删除旧数据后明确要求“更新”；目标解析为现有 `wrangler.jsonc` 的 `DB` binding，即账号 `7aca31eae821510ea477022b0c0e0e91` 下数据库 `zhuwei-dev` / `f5a448fd-4224-4e52-bafb-a84cb190b618`。执行前 `cloudflare` 工作树干净，HEAD 与 `origin/cloudflare` 均为 `a68ba8415a754ecd115546deb688301ae620a9a4`，`origin/main` 为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
- 只读预检：`wrangler d1 migrations list zhuwei-dev --remote` 退出 0，唯一待执行项为 `0012_soft_ghost_rider.sql`；远端存在 `game_states`、`messages`、`room_event_archive`、`session_logs`、`rooms` 与现役 `authoritative_room_event_archive`，`rooms` 有 4 行。逐行复核 migration：删除四张退役表，复制并重建 `rooms`、更新当前 0.4 默认值并重建两个索引；它不会删除这 4 条房间目录行。
- 执行与写读闭环：`CI=1 npx wrangler d1 migrations apply zhuwei-dev --remote` 退出 0，13 条命令原子应用成功。随后 migration 列表返回 `No migrations to apply`；从远端 `d1_migrations` 读回 id `13`、名称 `0012_soft_ghost_rider.sql`、应用时间 `2026-08-31 15:48:23`。`sqlite_master` 复核四张退役表均不存在，现役 archive、`rooms`、`idx_rooms_code` 与 `idx_rooms_host` 保留；`PRAGMA table_info('rooms')` 的 Ruleset、KP 模型/Profile 和 lobby 默认值与 migration 一致，房间目录仍为 4 行。
- 线上与边界：migration 后 `https://zhuwei.yinskyriver.workers.dev/` 返回 HTTP 200，约 0.547 秒。未重新部署 Worker、未修改应用源码、未删除保留的房间目录行或现役权威归档、未创建新资源，也未触碰 `main` 或 grok.me；本轮外部变更仅为现有 D1 的已登记 `0012`。

## 游戏桌加载反馈与按需桌边册（2026-09-01）

- 目标与能力合同：让玩家在首次进桌、较慢后台同步、提交行动、KP 处理和语音转写期间都能看见与真实状态一致的进行中反馈；桌面常态优先保留对话，并显示当前阶段、地点及玩家生命/护甲，人物、在场、线索和日志改为按需查看。反馈不改变行动提交、机械裁决、权限或持久化事实。
- 代表性矩阵：冷启动显示“正在点亮桌面”；后台同步超过 700ms 才显示原位同步反馈，避免短请求闪烁；玩家行动等待与同步状态均在对话末尾出现可访问状态卡。桌边册默认关闭，四栏可在抽屉内切换并通过按钮、遮罩或 Escape 关闭；桌面宽屏限制 KP 正文行长，375px 手机布局隐藏次要生命/护甲摘要且无横向溢出。
- 实现与直接消费者：`table-client.tsx` 增加初始与延迟同步状态；`play-table.tsx` 增加统一工作指示器、常态上下文条和按需桌边册，并补齐 `aria-busy`、status/dialog/tab 语义。更新房间动作文案测试并新增真实组件交互测试；测试用 Provider key 仅写入权限为 600 的本地 `.dev.vars`，`.gitignore` 明确排除该文件。
- 定向检查：`npx tsx --test tests/play-table-workspace-ui.test.mjs tests/room-management-and-action-copy.test.mjs` 退出 0，4/4；`npm run typecheck` 与 `git diff --check` 均退出 0。浏览器定向 QA 覆盖 1440×900 与 375×812，无横向溢出，抽屉四栏可用；一次真实行动提交约 5.9 秒内持续显示等待卡，随后既有 Provider proposal repair 失败进入现役恢复界面，因此只证明加载反馈链路，不声称 Provider 行动成功。
- 未覆盖范围：没有修改四栏内容本身、机械规则、服务端接口或 Provider 恢复策略；未运行全量测试、Lint、production build 或全站浏览器 QA，也未执行远端 migration、部署、提交、Git push 或任何远端配置写入。

## KP 自然回应与社交线索投影修复（2026-09-01）

- 症状与根因：角色前提回应直接暴露 `requester/objective` 槽位，普通寒暄复读玩家原话并显示 `SourceClaim/CanonicalFact` 审计摘要；同一社交行动写入的每句 `sourceClaim` 知识又被 Table 无差别映射为线索卡。首个违规点分别是 `narration-v3.ts` 的确定性 V5 渲染直接透传协议字段，以及 `authoritative.ts` 的 knowledge→clues 投影没有区分普通社交逐字记录与可持续查看的个人线索。
- 修改与连带：前提按六类已注册 predicate/slot 生成自然中文且不回显标识符；社交回应只渲染本轮 `responseClaimRef` 指向的 NPC 台词或一次自然沉默，不复读玩家气泡，不渲染 direct 社交审计结果，并把控制字符、换行和嵌套中文引号收进单一服务端归因段。线索投影仅排除 `claim:social:` / `claim:social-npc:` 的普通对话 SourceClaim；感官证据及非社交文献/传闻 SourceClaim 仍保留，底层角色知识与亲历记录未删除。
- 验证证据：`npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/authoritative-table-v2.test.mjs` 修复前退出 1，稳定捕获协议泄漏和两张多余寒暄线索卡；修复后退出 0，26/26。补充另一类前提、自然沉默、非行动者 Viewer 与换行伪造边界后，`npx tsx --test tests/authoritative-kp-adapter.test.mjs` 退出 0，6/6；`npx vitest run tests/viewer-narration-recovery-v3.test.ts` 退出 0，5/5；`git diff --check` 退出 0。
- 未覆盖范围：截图中的偶发 `needsKp` 只能确认发生于 Rules diagnostic 后的提案修订耗尽；现有本地 Room journal 为空，旧 observability 数据不含对应 code，无法建立与该次截图同一故障的 RED，因此未放宽 Rules、增加无界重试、吞错、fallback 或自动换模型。后续需要一次不含玩家正文/Prompt/秘密引用的 `formId + repairUsed + diagnostic code/path` 有界证据；未运行全量测试、typecheck、build、Lint、浏览器 QA、真实模型探针、部署或 Git push。

## 代理合同解耦产品不变量与当前架构（2026-09-01）

- 目标与合同：让代理继续严格保护产品行为、安全、单一状态权威和持久化语义，同时把 Cloudflare 资源拓扑、Room DO、`step / project / replay`、目录、表名、认证算法与具体 Profile 区分为可取代架构基线或信息性实现导航；当前基线阻碍用户明确能力时允许内部演进，实质改变产品、数据兼容、安全、远端资源或成本时仍先取得确认。
- 代表性边界：现役 Worker/D1/DO 与两个深 Module 默认不变；路径、schema、KDF 和 Registry 值改从仓库事实源读取；新 Worker 或持久化资源不再被永久排除，但创建或接入仍要求影响说明、用户授权和 ADR。最高风险的第二裁决路径、秘密泄漏、未授权远端写入及持久化标识原地改义继续作为硬拒绝。
- 修改与直接消费者：`AGENTS.md` 将规格权威补充为“只冻结明示行为”，重写“产品与权威边界”为产品不变量、可取代架构基线、信息性实现导航三层，并明确 ADR 取代、实现型测试同步和现役 Rules Interface 更换流程；`docs/refactor-log.md` 仅追加本记录。没有修改 SPEC、ADR、源码、测试或运行时行为。
- 定向检查与未覆盖范围：核对主 SPEC、ADR 0013、`CONTEXT.md`、D1 schema 和 Wrangler 配置引用均存在，`git diff --check -- AGENTS.md docs/refactor-log.md` 退出 0。纯代理文档修改未运行代码测试、typecheck、Lint、build 或浏览器 QA；未执行远端 migration、部署、资源创建、提交或 Git push。现有实现型测试仍描述当前基线，只有未来实际取代相应 ADR 时才随直接消费者调整。

## 当前开发状态同步至 GitHub `cloudflare`（2026-09-01）

- 授权与远端基线：用户明确要求同步当前状态，并在获知 GitHub `main` 已由外部提交从产品基线 `29eb06d` 前移后再次确认“只推送 `cloudflare`”。推送前远端 `cloudflare` 为 `bb19e7c9bcdd3a195e8846d67b46d4bbb0123589`，远端 `main` 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`；本轮不修改或回退 `main`。
- 提交与验证：同步包含既有本地提交 `2029f8d`（游戏桌加载反馈与桌边册）、新提交 `08448cc`（自然社交回应与线索投影）和 `d14ec66`（代理合同区分产品不变量与架构基线）。最终源码状态上 `npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/authoritative-table-v2.test.mjs` 退出 0，26/26；`npx vitest run tests/viewer-narration-recovery-v3.test.ts` 退出 0，5/5；`git diff --check` 退出 0。
- 外部操作与边界：执行非强制 `git push origin HEAD:refs/heads/cloudflare`，退出 0，远端 `cloudflare` 从 `bb19e7c` 前移至 `d14ec66`。本轮没有修改或推送 `main`，没有执行 Worker 部署、远端 D1 migration、Secret/资源变更、真实模型探针或 grok.me 操作；本条同步审计随后作为说明性文档提交到同一分支。

## 快速开发模式部署（2026-09-01）

- 授权与源码：用户明确要求“快速开发模式不测试进行部署”，因此本轮豁免 typecheck、Lint、Node/Worker 测试、完整回归和独立预部署 build；部署源码为已推送且工作树干净的 `cloudflare` 提交 `84bf7353a299b2417c2cc178e2bde9f32806ca15`。部署脚本内唯一 production build 属于生成 Worker/静态资产的必需步骤，不记为测试门。
- 只读预检：Wrangler `4.125.0` 的 OAuth 会话属于账号 `7aca31eae821510ea477022b0c0e0e91`；部署守卫确认目标仍为既有 Worker `zhuwei`、入口 `worker/index.ts`、D1 `DB/zhuwei-dev/f5a448fd-4224-4e52-bafb-a84cb190b618`、SQLite Durable Object `ROOMS/RoomDurableObject`、Workers AI `AI` 与静态资产 `ASSETS`。部署前版本为 `b0ff1fc6-419b-4335-9552-40d80ca4e8ce`，远端 D1 migration 列表返回 `No migrations to apply`。
- 部署与控制面：`DEPLOY_SOURCE_SHA=84bf7353a299b2417c2cc178e2bde9f32806ca15 npm run cf:deploy` 退出 0，配置守卫和 production build 通过，既有 Worker 生成 Version `fa013755-6202-4209-a32c-17a534f954d0`；`npx wrangler deployments status` 退出 0，确认该版本承接 100% 流量。
- 冒烟与边界：终端 HTTPS 冒烟在到达 Worker 前发生 TCP 超时，限定 5 秒重试退出 28 / HTTP `000`；按发布规则改用一个独立浏览器通道复核，首页成功加载 `https://zhuwei.yinskyriver.workers.dev/`，标题为“烛帷｜AI 主持的多人 D&D 跑团”，并读到产品主标题。本轮没有调用真实模型，不声明外部 AI 能力已验证；没有执行 migration、Secret/资源变更、Git push、修改 `main` 或 grok.me 操作。

## 桌面后台同步提示防跳动（2026-09-01）

- 症状与根因：桌面每 1.6 秒后台刷新；单次请求超过 700ms 时，`syncing` 被复用为对话工作状态，在消息末尾插入大卡片并触发平滑滚动，因偶发延迟而短暂跳动。最短组件 RED 同时捕获大卡片仍存在和轮询仍为 1.6 秒，退出 1（0/2）。
- 修改：后台轮询改为 3 秒；慢同步只在桌面顶栏的轻量状态胶囊显示，不再令对话区进入 busy、插入同步卡或触发滚动。行动、KP 和语音仍使用原对话工作提示，且与同步同时发生时优先显示真实前台工作。
- 连带检查与证据：`npx tsx --test tests/play-table-workspace-ui.test.mjs` 退出 0，2/2；覆盖正常行动提示、行动与同步并发优先级、同步仅位于顶栏及对话区不 busy。`git diff --check` 另行在最终源码状态检查。
- 未覆盖范围：未修改首次加载和同步失败警告，没有改变服务端、行动幂等或 Room 状态；未运行全量测试、typecheck、Lint、build、浏览器全站 QA、部署或 Git push。

## `needsKp` 未提交后交流解锁（2026-09-01）

- 症状与根因：玩家行动在 KP Proposal 修订耗尽后返回 `action:notCommitted + needsKp`，页面却把它和“运输中断、是否已提交未知”共用一个强制恢复锁；新文本与旧 fingerprint 不同时直接被拦截，连第二次 HTTP 都没有发出，刷新后还会从 sessionStorage 恢复该锁。精确组件 RED 为 4/5，同样的第二句发送仅观察到 1 次请求。
- 修改与直接消费者：`play-table.tsx` 将恢复记录区分为 `transportUnknown` 与 `confirmedNotCommitted`；前者仍强制使用原 submission，后者保留“重试原行动”但允许玩家改说别的并建立新 submission，同时把误导性的“结果还没有确认”改为“这项行动没有提交到世界”。`authoritative-client.ts` 在收到明确 `notCommitted` 响应时释放该 fingerprint 的运输缓存，但异常抛出时仍保留原 ID。
- 连带检查与证据：`npx tsx --test tests/send-action-recovery-v2.test.mjs` 在最终源码状态退出 0，6/6；同组玩家情景证明 `needsKp` 原句重试仍复用原 ID、改成新句会真正发送且使用新 ID，并保留运输中断必须原样恢复的对偶路径。
- 未覆盖范围：截图对应的某次 `needsKp` 只能确认为未提交 Proposal；现有脱敏遥测没有 `formId + repairUsed + Rules diagnostic code/path`，因此不宣称已判定是 schema、引用还是机械字段失败，也没有放宽 Rules、增加无界重试或伪造成功。现有开场钩子已审查；“玩家初始知识”是另一个需要新 Module Profile 版本与知识投影验收的能力，不作为本次锁死 Bug 的文案 fallback。

## 桌面同步提示修复快速推送与部署（2026-09-01）

- 授权与源码：用户明确要求“快速开发部署推送”，并确认不纳入随后出现的其他更新。本轮修复提交为 `1ef4c1bd8aa6a65a8c0242bd6e2267b144ca3205`；`npx tsx --test tests/play-table-workspace-ui.test.mjs` 在该源码状态退出 0（2/2），`git diff --cached --check` 退出 0，按快速开发授权未追加 typecheck、Lint 或完整回归。
- 推送：执行非强制 `git push origin HEAD:refs/heads/cloudflare`，退出 0，远端 `cloudflare` 从 `84bf7353a299b2417c2cc178e2bde9f32806ca15` 前移至 `1ef4c1bd8aa6a65a8c0242bd6e2267b144ca3205`；远端 `main` 保持 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，未修改或推送。
- 部署与控制面：原工作区在提交后出现不属于本轮的 `tests/send-action-recovery-v2.test.mjs` 未提交修改，部署守卫按预期拒绝且未产生版本；随后从已推送提交建立临时干净 `cloudflare` 检出，`DEPLOY_SOURCE_SHA=1ef4c1bd8aa6a65a8c0242bd6e2267b144ca3205 npm run cf:deploy` 退出 0，配置守卫和唯一 production build 通过，既有 Worker `zhuwei` 生成版本 `aec929b5-0f0e-448f-abf1-f4ccb0dc1937`。`npx wrangler deployments status` 退出 0，确认该版本承接 100% 流量；原工作区的后续修改未被纳入、覆盖或丢弃。
- 冒烟与边界：终端 HTTPS 冒烟限定 10 秒后在到达 Worker 前超时，退出 28 / HTTP `000`；改用一个独立浏览器通道复核一次，线上首页成功加载，标题为“烛帷｜AI 主持的多人 D&D 跑团”，主标题为“帷幕后，烛火未灭”。本轮没有调用真实模型，不声明外部 AI 行为已验证；没有执行 D1 migration、Secret/资源变更、修改 `main` 或 grok.me 操作。本条审计随后作为说明性文档提交推送，不改变已部署源码。

## Archify 结构化 JSON 编译链调研（2026-09-01）

- 目标与调研合同：确认近期热门 `tt-a1i/archify` 怎样让外部 Agent 把自然语言问题编译为 Typed JSON IR，以及该 IR 如何经确定性校验、修复和渲染成为自包含交互式 HTML。所有本体实现判断固定到官方仓库提交 `199360cc6687a7857b54dd188d4922b09e466a4b`，优先使用 Skill、Schema、CLI、renderer、template 与官方 benchmark 一手证据。
- 修改与结论：新增 `docs/research/archify-structured-json-pipeline.md`。报告证明 Archify 本体不调用模型 Provider 或 `response_format`；外部 Agent 按 `SKILL.md` 只读一个 mode schema、common schema 与一个同型示例，先写候选文件，再由 AJV strict validator、跨集合/几何/artifact 门和结构化 repair receipt 驱动有界局部修复，最终由代码生成 inline SVG 并注入统一 Viewer template。官方当前 verifier 下仅 8/15 first-pass usable，因此没有把可靠性归因于 Prompt 文案。
- 定向检查：逐段复核 Prompt、Schema、validator、CLI validate/deliver、Architecture renderer、HTML template 和 ordinary-model benchmark 引用；本体源码链接均使用固定 40 位提交，另一个同名 WebUI 的消歧引用也固定提交。对报告和当前执行日志运行隔离临时索引的 `git diff --cached --check`，退出 0。
- 未覆盖范围：未运行真实模型生成、HTML 浏览器交互或外部 WebUI；没有修改产品源码、SPEC、ADR、依赖、测试或配置，也未运行代码测试、typecheck、Lint、build、部署、migration、Git commit 或 push。工作区中既有的游戏桌、客户端与测试修改属于其他任务，本调研未触碰。

## `needsKp` 解锁快速推送与部署（2026-09-01）

- 授权与源码：用户明确要求“快速开发形式推送部署”；修复提交为 `487ea0a3e0adbc06215ba27c428ef7c2ab4487dd`。`npx tsx --test tests/send-action-recovery-v2.test.mjs` 退出 0（6/6），`git diff --cached --check` 退出 0；按快速开发授权未追加 typecheck、Lint 或完整回归，部署脚本内唯一 production build 保留。
- 推送与远端边界：非强制 `git push origin HEAD:refs/heads/cloudflare` 退出 0，远端 `cloudflare` 从 `e0f2a7220806209d0235488760a68a56a5687cac` 前移至修复提交；远端 `main` 在推送前后均为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，未修改或推送。既有 D1 `zhuwei-dev` 返回 `No migrations to apply`，未执行 migration、Secret 或资源变更。
- 部署与控制面：从已推送提交建立独立干净 `cloudflare` 检出，`DEPLOY_SOURCE_SHA=487ea0a3e0adbc06215ba27c428ef7c2ab4487dd npm run cf:deploy` 退出 0，配置守卫及 production build 通过，既有 Worker `zhuwei` 生成版本 `c0a06ce0-95c7-4233-81c6-bf98c2a54ec4`；`npx wrangler deployments status` 退出 0，确认该版本承接 100% 流量。原工作区的 Archify 调研未纳入源码提交或部署。
- 冒烟与边界：终端 HTTPS 冒烟限定 15 秒后在到达 Worker 前超时，退出 28 / HTTP `000`；换用独立浏览器通道后首页成功加载，标题为“烛帷｜AI 主持的多人 D&D 跑团”，主标题为“帷幕后，烛火未灭”，页面未捕获 Console error。本轮未进入登录房间或调用真实模型，因此只声明部署与公开入口正常，不声明线上 `needsKp` 外部模型路径已经实测恢复。

## Rules / Projector / Room 大文件职责拆分（2026-09-01）

- 目标与合同：在不改变产品行为、协议标识、Profile/hash、持久化或现役 `step / project / replay` Interface 的前提下，按职责与变化原因建立三条可独立开发的内部接缝；Draft 解码不读取世界状态或生成事件，Observer 区间投影不反向依赖基础 projector，动态环境 lowering 不拥有随机、存储或提交权。
- 代表性矩阵：Causal 覆盖 direct/check/compound、物品 materialization、NPC 机械定义与 campaign 生命周期；Observer 覆盖 committed/incremental、生命周期、隐私拒绝与 Room delivery；动态环境覆盖复用既有特征、开放留白、攻击/检定/直接激活及无效或不可见引用。所有样例继续通过原 Rules 与 Room 权威路径，不增加名称特判或第二裁决入口。
- 实现与直接消费者：`causal-actions.ts` 把类型化 Draft、严格 parser 和纯校验 helper 移至 `causal-action-drafts.ts`；`projector.ts` 把 committed/incremental/lifecycle range overlay 移至 `observer-delta.ts`，以基础 projector 回调重建 prior projection；`durable-object.ts` 把动态环境 Proposal lowering 移至 `environment-proposal-lowering.ts`，可信身份、事务和提交仍留在 Room Authority，并同步扩展 `tools/check-modules.mjs` 的静态边界覆盖。三个隔离提交依次为 `783f111`、`639a796`、`6b1a858`。
- 验证证据：合并后的同一源码状态上，六个 Node 目标文件退出 0（60/60），三个 Worker/Vitest 目标文件退出 0（18/18）；`npm run typecheck`、`npm run module:check`、提交范围与工作树 `git diff --check` 均退出 0。最终行数为 `causal-actions.ts` 5,065、`projector.ts` 1,303、`durable-object.ts` 9,091；新增职责模块分别为 1,999、1,063、244 行。
- 未覆盖范围：本轮没有实现 `world-interaction.v1`、类型化环境属性/关系、动态 Item/NPC/Objective 或 `renderableClaims`，也没有继续机械拆分 `model.ts`、`events.ts`、projector 当前快照或 Room 其他领域分支。未运行全量 `npm test`、全项目 Lint、production build、浏览器 QA、真实模型探针、部署、migration 或 Git push。

## vNext 阶段三开放互动泛化闭包（2026-09-02）

- 目标与能力合同：任意获得认证的玩家可以用自然语言提出开放式环境行动；KP 基于冻结 RequiredContext 判断可行性、DC、风险与世界因果，Rules 只执行有限机械并由 Room DO 原子提交。玩家直接目标必须是当前场景中 Viewer 可操作的类型化空间对象；完整 `targetRefs/basisRefs` 仍可保留获授权的隐藏因果供 Rules 结算，但无权 Viewer 与 Narration 不得取得这些引用。`world-interaction` 只拥有当前场景环境对象/关系的事务边界，不能改写 NPC、Item、Objective/Story/continuity 或 foreign-scene 事实。
- 代表性矩阵：可见且同场的 opaque `entity / itemEntry / sceneFeature` 可作为直接目标；隐藏语义对象、隐藏 Tactical Feature、非空间 semantic kind、缺场景绑定和 foreign-scene 对象均在随机与成本前拒绝。当前场景 sceneFeature revision、同场关系及注册 Hazard 正常执行；NPC definition revision、跨场景 relation/definition/Hazard source/zone 拒绝。隐藏 contains/relation 与真实区域目标仍由 Rules 解析，且 Viewer Claims、basis、数量和 Narration 不泄漏；结构不同的环境互动样例与 opaque ID 共用同一通用路径，没有动作、对象、材料词或测试数值分派。
- 实现与直接消费者：能力由 `authority-bindings.ts` 的类型化空间/可见性解释、`required-context-runtime.ts` 的 Viewer/authority 引用分离、`proposals.ts` 的早期 lowering、`world-interaction-mechanics.ts` 与 `world-interactions.ts` 的 Rules 最终重验共同闭合；直接消费者仍是 vNext Room prepare/commit bridge、Rules `step/project/replay`、Typed Claims 与 Claims-only Narration。同步更新 `docs/specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md` §14、`docs/specs/README.md`、`docs/specs/traceability-matrix.md` 和 DEC-047 的实现证据与边界；未修改 `docs/research`。
- 定向检查：`npx tsx --test tests/kp-vnext-core.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-world-interaction-rules.test.mjs tests/kp-vnext-hazard-actor-death-fold.test.mjs` 退出 0，24/24；`npx vitest run tests/kp-vnext-stage3-room.test.ts` 退出 0，5/5；`npm run typecheck` 与目标文档 `git diff --check` 均退出 0。
- 未覆盖范围：阶段三只证明动态 NPC 修订与通用 `world-interaction` 两条代表性纵切及上述泛化/安全边界。clarification、in-world refusal、独立 observe/social、完整 materialization create、inventory/objective/story/combat、跨合同完整 ProposalBundle、持续燃烧 Activity、完整地图/浏览器/真实 Provider、生产 Registry 采用、V5 删除、migration、部署与 Git push 均未执行；未运行 `npm test`、全项目 Lint、production build 或完整回归。

## vNext Claims-only Narration recovery 合同边界修复（2026-09-02）

- 症状与根因：阶段三自然语言枪击纵切已完成机械提交，但 Claims-only Narration recovery 返回 `committed + retryableFailure + NARRATION_PUBLICATION_FAILED`。首个违规点在 `handleViewerNarrationRecovery`：冻结 `renderableClaims` 的请求仍附带旧投影恢复专用的 `narrationPurpose`，严格 KP fixture 因多出一个字段拒绝；不是重复 Rules、随机数或 Room 状态提交。
- 修改与直接消费者：`app/_runtime/lib/room/action.ts` 仅从 Claims-only recovery 请求移除 `narrationPurpose`，保持无 Claims 的旧 projection recovery 分支不变；`tests/kp-vnext-stage3-room.test.ts` 删除本轮临时调试输出，既有严格键集合断言继续锁定该请求合同。机械提交、冻结 Claims、Room publication 与幂等/eviction 路径未旁路或重写。
- 定向检查：`npx vitest run tests/kp-vnext-stage3-room.test.ts` 退出 0（5/5）；vNext Node 目标集合退出 0（77/77），同次 strict-tool Provider 合同目标退出 0（6/6，合计 83/83）；`npm run typecheck` 与 `git diff --check` 均退出 0。未发现 `DEBUG` 调试残留。
- 未覆盖范围：未运行 `npm test`、全项目 Lint、production build、浏览器 QA、真实 Provider/生产 Registry 探针、migration、部署、Git commit 或 push；完整阶段三范围之外的 clarification、in-world refusal、其他 Form 纵切和生产采用仍未验证。

## vNext 阶段三收口暂停检查点（2026-09-03）

- 目标与边界：按用户决定停止继续扩展阶段三，将当前成果保存为可编译的开发检查点；不把它标记为阶段三完成或生产可采用。已停止 ProposalBundle、Rules prospective/refusal 与 RequiredContext 审查三条并发实现，不继续集成 Claude `96341f2`、补 Room 纵切或执行真实 Provider 调用。
- 当前成果：保留冻结 RequiredContext/五态骨架、动态 NPC 稀疏修订、通用 `world-interaction`、Typed Claims/Narration 代表性纵切，以及当前 ProposalBundle 的五类 Ruling、clarification/refusal terminal 合同和 prospective 依赖校验。仅补齐被中止增量遗留的 TypeScript 类型/局部校验 helper，使工作树恢复可编译；没有借收尾继续实现 materialization create、refusal Rules 事件、multi-entry 原子 lowering 或 Room 消费端。
- 定向检查：推送候选源码状态下 `npm run typecheck` 退出 0；全部现有 vNext Node 目标与本地 strict-tool Provider 合同目标退出 0（89/89）；`npx vitest run tests/kp-vnext-stage3-room.test.ts` 退出 0（5/5）；`git diff --cached --check` 退出 0。推送前另将 `obligation-closure.ts` 中作为元组分隔符的字面 NUL 改为源码转义 `\u0000`，运行值不变且文件恢复为 UTF-8 文本。缺少独立 `kp-vnext-context-availability.test.mjs`，因此不把 Claude Availability 返工作为已集成或已验收成果。
- 后续任务：分别完成（1）RequiredContext 返工选择性集成与权限/selector/read-set 审计，（2）Bundle strict schema、一次窄修复及真实 DeepSeek handshake，（3）Rules materialization create、prospective preflight 与 typed refusal 原子事件，（4）Room Pending/Receipt/Claims/恢复端到端接线并删除旧 vNext 双入口，（5）阶段三纵切矩阵与 SPEC 0001 §21 生产采用门。未运行完整测试、Lint、build、浏览器 QA、真实 Provider、migration 或部署。

## vNext 阶段三检查点 feature 推送（2026-09-03）

- 分支策略与基线：为避免把未完成收口写入生产基线或覆盖既有稳定快照，新建 `feature/kp-agent-vnext-stage3-checkpoint`；它基于本地 `cloudflare` 的三个职责拆分提交并包含 ProposalBundle 提交 `cb7038f`，检查点源码提交为 `dde61465fe38b26e2f69d31a4d998f14fa154eb8`。既有 `feature/kp-coarse-forms-vnext-stage3` 保持 `0ec8c4eae5862af1c3a43aef86a17889e17955e7`。
- 推送与远端边界：执行非强制 `git push -u origin feature/kp-agent-vnext-stage3-checkpoint`，退出 0；远端新分支指向 `dde61465fe38b26e2f69d31a4d998f14fa154eb8`。推送后只读复核 `origin/cloudflare` 仍为 `0569b517ee0e101e32c38897812821a76d755aa6`，`origin/main` 仍为推送前已经存在的 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，均未修改。
- 验证与排除：推送源码的 `npm run typecheck`、89/89 vNext/strict-tool Node 目标、5/5 Room Worker 目标与 staged diff 检查均已通过；这是未完成能力的开发检查点，不是生产冻结或发布。独立未跟踪的 `docs/research/archify-structured-json-pipeline.md` 未纳入提交；未运行完整回归、Lint、build、真实 Provider、migration、部署或外部资源写入。

## vNext ProposalBundle、Claims 与严格 Provider 合同收口（2026-09-03）

- 目标与能力合同：KP 首次调用必须返回可由本地确定性校验闭合的完整 ProposalBundle；需要澄清时，每个公开选项冻结一个完整、非递归且引用空间隔离的继续分支，玩家选择后不再调用 KP。Provider 只允许在持久化 repair ticket 之后执行一次窄修复；权威提交后的叙事只能消费 Viewer 对应的冻结 Typed Claims，不得从隐藏状态或旧投影补写事实。
- 代表性矩阵：同一通用路径覆盖单项环境互动、结构不同的 materialize 后消费原子 Bundle、clarification 全兄弟分支与全局 16 项预算、高风险选项的公开风险绑定，以及重复 JSON member、未知引用、依赖错误和 attribution/agency 不一致的拒绝；另覆盖首次候选无效后一次局部 correction 成功与再次无效终止。没有按动作名称、对象名称或测试值分派。
- 实现与直接消费者：`kp/vnext` 增加 strict Bundle/continuation validator、canonical JSON、correction ticket 与 Provider 编排，Registry/握手定义按 submit/correct 两份合同分别绑定 schema hash；Rules Claims/observer delta、KP authoritative adapter 与 Room publication 统一收紧 frozen Claims 和 result-event 映射，直接消费者仍为现役 Room Action、Rules `step/project/replay` 与 Claims-only Narration。候选模型保持 `validationStatus: pending`，没有接入生产 Registry。
- 验证证据：最终源码状态上六个 Node 目标文件命令退出 0（102/102），`npx vitest run tests/kp-vnext-stage3-room.test.ts` 退出 0（7/7），`npm run typecheck` 与 `git diff --check` 均退出 0。
- 未覆盖范围：当前环境没有 `DEEPSEEK_API_KEY`，因此没有运行会决定 Provider 方言冻结的四次真实握手；按 SPEC 0016 的采用门，完整 clarification Room/Rules 消费端与生产模型切换尚未实施。未运行全量测试、Lint、build、浏览器 QA、migration、部署或 Git push。

## vNext 随机落账后 Claims 投影失败恢复（2026-09-03）

- 症状与根因：随机行动已经持久化 `RandomnessRequested` 与固定骰面后，若 Claims 投影失败，首次响应正确地未提交最终事件，但同一原始意图重试无法恢复。首个违规点是权威恢复输入识别只覆盖旧形状，未识别 vNext materialize/revise/world-interaction；恢复成功后，Room publication 又只从 prepare 响应取 rootActionId，无法接受恢复函数直接返回的 committed Receipt。
- 修改与连带检查：Room DO 用共享恢复入口复用原 Proposal 与骰面，并通过 Rules 导出的原子 world-interaction 编译判定作为单一事实源；随机日志后的投影失败标为可重试，非随机投影失败仍是硬拒绝。Room Action 以 Receipt root 绑定恢复后直接提交结果并沿 delivery root 发布叙事。检查覆盖原失败路径在 DO 驱逐后以同一原始意图完成、Proposal/骰面不变且无重复随机，以及自然 20/1 正常路径与非随机失败对偶路径。
- 验证证据：`npx vitest run tests/kp-vnext-stage3-room.test.ts` 退出 0（7/7）；包含 Room Action/Provider/Claims/Rules 的六个 Node 目标文件命令退出 0（102/102）；共享类型与公共签名变化后的 `npm run typecheck`、`git diff --check` 均退出 0。
- 未覆盖范围：没有改变随机算法、跨请求权威状态或幂等合同，也没有为测试引入生产旁路；未运行完整回归、Lint、build、外部 Provider、migration、部署或 Git push。

## vNext 阶段三续作 feature 救援推送（2026-09-03）

- 授权、基线与目标：Claude 停止工作后，用户明确要求把其当前成果推送到 `cloudflare` 之外的 feature 分支。协调代理核对本地主成果为干净分支 `feature/kp-agent-vnext-stage3-continue`，交接说明提交为 `05e7497a2c89fb00213cf5b124a912e334386440`，相对 `cloudflare@0569b517ee0e101e32c38897812821a76d755aa6` 领先 23 个提交；远端同名分支在操作前不存在。
- 取舍与未集成工作：`.claude/worktrees/t3-bundle` 的两项未提交修改时间早于主成果，四个新增测试名称及对应行为已由主分支 `11cf36b` 的更完整实现覆盖，因此未把该旧工作树反向覆盖到主成果，也未清理或丢弃其文件。顶层 `cloudflare` 工作树中的 KP 测试治理改动属于更早的独立任务，保持未提交原状；其他验证 worktree 同样未修改。
- 推送与远端边界：`git push -u origin HEAD:refs/heads/feature/kp-agent-vnext-stage3-continue` 退出 0，以非强制方式创建远端 feature ref 并指向 `05e7497a2c89fb00213cf5b124a912e334386440`。随后只读复核 `origin/cloudflare` 仍为 `0569b517ee0e101e32c38897812821a76d755aa6`，`origin/main` 仍为操作前已存在的 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`；本条说明性审计提交随后只前移同一 feature ref。
- 验证与未覆盖范围：推送对象是交接文档已明确标注“不是阶段三完成、不可生产采用”的开发检查点；沿用该文档记录的定向证据，不把保存动作扩张成完整回归或发布资格。本次未运行新的代码测试、全量 Node/Worker、Lint、build、浏览器、真实 Provider、migration 或部署，也未修改 Secret、Cloudflare 资源、`cloudflare`、`main` 或 grok.me。

## vNext 阶段三续作至 Provider 门（2026-09-03）

- 目标与合同：从 Claude 检查点继续完成 strict-tool 方言、repair 失败边界、Room ProposalBundle 单入口以及 Claims / Viewer / Grounding 保密闭环；所有公开叙事只能消费 hash 绑定的原子事实：committed range 先派生 Authority Claims，再经 SafeReadModel-derived grants / display names 投影为 Viewer `narrationFacts`，任何 raw 文本、未授权 Authority 名称或隐藏 ref 都不得铸造可见 grant。按用户要求在下一阶段即真实 DeepSeek 握手前停止，不提前接 vNext-2 Room consumer。
- 代表性矩阵与 RED：覆盖 strict union、畸形 raw arguments、旧粗粒度 Room ingress、SourceClaim/CharacterInference 多句归因、俄语/阿拉伯语/emoji 附加事实、感官前缀、opaque item/ability 名称、Authority ID fallback，以及“可见自由文本包含隐藏 ref”最高风险 canary。后者在修复前 `89697c4` 上退出 1并错误放行，修复后进入目标绿组。
- 修改与直接消费者：本地集成提交依次为 `9f74bab`（flatten nested strict-tool union）、`89697c4`（unproven raw repairs fail closed）、`5b25555`（retire coarse Room proposal ingress）和 `cee6834`（bind narration claims to viewer grants）。Claims 修复让 Authority Claims 经 SafeReadModel-derived grants / display names 确定性投影为纳入 hash 的 `narrationFacts`，按 SafeReadModel 路径派生 grants，并移除未授权 Authority 标识 fallback；直接消费者为 authoritative KP adapter、Claims validator、world-interaction Rules、Room publication 与 Claims-only Narration。
- 定向验证：`npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/kp-vnext-claims.test.mjs` 退出 0（T1，24/24）；`npx tsx --test tests/kp-vnext-world-interaction-rules.test.mjs tests/kp-vnext-materialization-and-feasibility-rules.test.mjs tests/kp-vnext-hazard-actor-death-fold.test.mjs` 退出 0（T2，43/43）；`npx vitest run tests/kp-vnext-stage3-room.test.ts` 退出 0（T2，8/8）；共享类型变化后的 `npm run typecheck` 与 `git diff --check` 均退出 0。独立审计未发现剩余明显 P0/P1。
- 归属与未覆盖范围：曾运行一次不绿的 664 项完整 Node 归属调查，其中 15 项失败，12 项在 `0b4c7ad` 亦失败，3 项合并态回归已由 `89697c4` 修复；不引用已被截断且不可恢复的旧“624/18”输出。最终 `cee6834` 未重跑完整 Node，完整 Worker 与 `npm test` 未运行。环境缺少 `DEEPSEEK_API_KEY`，因此模型可见 Claims prompt 与 schema 修复的 T4 四调用握手未执行；`highRiskConfirmed`、fictionTime/resource cost、`openBlank` 和 vNext-2 Room 纵切仍失败关闭或未接线。未运行 Lint、build、浏览器、migration、部署或 Git push，未修改 `cloudflare`、`main` 或远端资源。

## vNext strict-tool 真实 Provider 方言闭包（2026-09-03）

- 症状、RED 与根因：测试凭证经无回显 stdin 临时注入后，首轮四调用握手中 correction 与非法 schema 拒绝通过，但两个 submit 均被 DeepSeek 400 永久拒绝；一次脱敏单调用诊断得到 `Invalid tool parameters schema: field anyOf: missing field type`。首个违规点是本地方言校验把仅含 `$ref` 的 `anyOf` branch 当作已有字面 `type`，完整 submit schema 有 48 个此类 branch，而通过的 correction 两个 branch 都直接声明类型。后续真实对照又证明旧 `minItems` 负向探针曾被前置 anyOf 错误顺带拒绝，并未独立证明该 keyword；materialize 输出则先后暴露空 `abilityRef` 和把 prospective handle 写成 existing consume，均被本地域 validator 正确失败关闭。
- 修改与能力边界：`deepseek-strict-tool.ts` 现在要求每个 anyOf branch 与每个 `$def` definition 有字面 `type`，并将观察到的方言版本前移至 `deepseek-strict-tool-beta-2026-09-03`。按 SPEC 0016 的可丢弃最小候选要求，submit transport 只暴露本阶段会消费的 `directSuccess + worldInteraction + sceneFeature materializeObject`，prospective consume、`abilityRef=none`、scene-observers 和 always outcome 均由闭合 schema 固定；完整 ProposalBundle 领域 parser/validator 未缩小。握手 Prompt 与 suite version 同步前移至 v3，负向样例改为官方明确拒绝的开放根对象，未把 Provider strict 当作权限、依赖或 Rules 验证的替代。
- 代表性矩阵与 T4 证据：最终预注册四调用矩阵全部通过：world interaction、materialize + interact、summary-only correction 三个合法工具调用均经现役 parser 接受，开放根对象收到 HTTP 400 且 `rejectedBeforeGeneration=true`；报告 `registrationAccepted=true`。证据绑定 `promptHash=fnv1a64:1b0107f45469d9f1`、`schemaHash=fnv1a64:21de1826b8444cb9`、`parserHash=fnv1a64:bcf27127eff0e91f`、`validationSuiteHash=fnv1a64:b1bda00061d5da40` 与 `evidenceHash=fnv1a64:ad3f9a0c1e52e2f4`，时间为 `2026-09-03T14:52:22.980Z`。包括失败诊断与中间对照在内，本任务共执行 19 次真实测试 Provider 调用；最终可注册证据只计其最后四次。
- 定向验证与外部边界：新增本地方言 RED 在修复前退出 1（ref-only anyOf branch 未抛错），修复后 `npx tsx --test tests/kp-vnext-proposal-schema.test.mjs tests/deepseek-strict-tool-provider.test.mjs` 退出 0（T1，30/30）；共享方言校验器的直接既有消费者 `npx tsx --test tests/kp-form-strict-tool-v3.test.mjs` 退出 0（T1，9/9）；最终源码上的 `npm run typecheck` 与 `git diff --check` 均退出 0。测试 key 没有写入文件、命令参数、日志或提交，进程结束即丢弃；用户已说明它是测试 API。尚未接入 vNext-2 Room、写入生产 Registry 或执行完整 Node/Worker、`npm test`、Lint、build、浏览器、migration、部署、Git push 和任何 Cloudflare 写操作。

## vNext-2 共享检定接入 Room 纵切（2026-09-04）

- 目标与能力合同：让一次机械检定决定整束 vnext-2 ProposalBundle。此前 `lowerVNext2ProposalBundle` 对任何非 `directSuccess` 裁决一律以 `bundle2:shared-check-not-supported` 关闭，因此跑团最常见的掷骰动作根本无法经 vnext-2 到达 Rules；而 Rules（单步与原子双分支预演、随机请求、continuation、结算）、`proposal-graph.ts` 的共享检定所有权与依赖定序、`proposal-validator.ts` 的 check 形状规则、vnext-1 coarse-Form lowering 四层此前均已支持 check。本次只补上 vnext-2 lowering 与严格工具传输面这两处缺口：一束一次掷骰，唯一 `outcomeBinding=always` 的 worldInteraction 拥有该检定，绑定到结果的条目成功即执行、失败即跳过，绝不半执行。`highRisk` 继续失败关闭——它按构造处于 pending，必须先由 Room 提供携带 acceptedCosts 的可信确认，本模块没有索取确认的接缝。
- 代表性矩阵与 RED：新增三例 Room 纵切。原子三步（无条件固化壁龛 + 拥有检定的撬石板 + `onSuccess` 固化暗格）在骰面 18 下三步全 applied、两个定义都落账，在骰面 3 下交互提交真实失败分支、无条件固化仍 applied、成功绑定条目 skipped 且暗格从不进入状态或玩家可见叙述；单步检定以 wis/DC 15/advantage 掷两颗取大，证明 check 参数本身（而不只是裁决类型）进入 Rules，并断言不产生原子事件。失败关闭一例覆盖 highRisk 与"可失败却没有失败分支"的 check。首轮 RED 暴露一个真实缺陷：`dependsOnFor` 只从 `consumes` 派生依赖，漏掉共享检定所有者这条边，Rules 以"The server-derived atomic dependencies do not match typed consumes."拒绝整束；proposal-graph.ts 排序时已加该边，只有发出的 `dependsOn` 与两侧不一致。
- 修改与直接消费者：`kp/vnext/proposal-bundle-lowering.ts` 把共享裁决按字段投影到复用的 vnext-1 envelope（check 逐字段透传、失败分支为模型自撰的真实分支，directSuccess 保留原有两处结构性占位并保持不可达），`sharedRuling` 与每步 `ruling` 改为携带裁决类型，`dependsOnFor` 补上共享检定所有者边，并新增两处双向一致性断言：`plan.sharedCheckEntryRef` 非空当且仅当裁决为 check，且实际下沉出 check 计划的步骤必须恰好是图选出的所有者，任一不符以 `BUNDLE_DEPENDENCY_INVALID` 具名拒绝而不是留给 Rules 报"not canonical"。`kp/vnext/proposal-schema.ts` 的 `adjudication` 改为 directSuccess 与 check 的两分支 union，`outcomeBinding` 放宽为 `always|onSuccess|onFailure`；线上只暴露 `checkKind=abilityCheck`，因为 `attack` 需要非空 abilityRef 而本传输面把 abilityRef 钉死为 `none` sentinel，暴露它只会造成一条模型可写、服务器必拒的死分支。直接消费者为 Room 的 vnext-2 ingress、Rules `applyAtomicWorldInteractionSteps` 与 `resolveWorldInteraction`。领域 parser/validator 未放宽。
- 真实 Provider 证据：传输 schema 改变即 `schemaHash` 改变，离线方言校验器历史上出现过假阴性（ref-only anyOf branch），因此重跑握手。握手定义前移至 `kp-vnext2-proposal-handshake-prompts-v4` 并新增 `shared-ability-check` 正例（模型须自行给出 check 参数、真实失败分支与 `onSuccess` 绑定条目），runner 的能力门 `DEEPSEEK_STRICT_TOOL_HANDSHAKE_CAPABILITIES` 同步要求该能力，因此该例不通过则整个握手不通过。`tools/run-deepseek-strict-tool-handshake.mjs` 对真实 DeepSeek 执行 5 次调用后 `status=passed`、`registrationAccepted=true`：四个正例全部经现役 parser 接受，开放根对象在生成前被 HTTP 400 拒绝。证据绑定 `promptHash=fnv1a64:df136171b8deefa1`、`schemaHash=fnv1a64:8f4f5fdfdcac243e`、`parserHash=fnv1a64:bcf27127eff0e91f`、`validationSuiteHash=fnv1a64:c0a9d704476cba3e`、`evidenceHash=fnv1a64:5f017e968a8feed6`，时间 `2026-09-04T03:34:00.749Z`；submit 合同的 `schemaHash` 为 `fnv1a64:ddd8f252bc02f9c6`、`promptHash` 为 `fnv1a64:1f55f8f6fee463ee`。本任务只执行这一轮 5 次真实调用。
- 验证证据：`npx vitest run tests/kp-vnext-stage3-room.test.ts --testTimeout=60000` 退出 0（17/17，其中 3 例为本次新增）；`npx tsx --test` 六个 schema/Provider/transport 目标文件退出 0（63/63），八个 Claims/adapter/Rules/context 目标文件退出 0（89/89）；`npm run typecheck` 退出 0。离线握手夹具同步补齐 `shared-ability-check` 的模拟输出与计数，`tests/kp-vnext-proposal-schema.test.mjs` 与 `tests/deepseek-strict-tool-provider.test.mjs` 的相应断言由 3 调用改为 4/5 调用。
- 归属与未覆盖范围：`npx vitest run --testTimeout=60000` 完整 Worker 套件为 45 个文件、193 项、187 通过、1 失败、5 跳过；唯一失败是 `tests/stage4-world-campaign-vertical-v2.test.ts` 的 \“keeps two readers knowledge after the letter is destroyed\” 以 `PROPOSAL_PROVIDER_TIMEOUT` 未提交。该项单独复跑仍失败（非负载抖动），再把本次改动的两个源文件临时换回 `025590c` 版本复跑，失败完全相同，故为既有问题而非本次回归。排除 `tests/combat-mechanics-v2.test.mjs` 后的 89 个 Node 文件为 625 项、613 通过、12 失败；该 12 项分布于 `rendered-html`(7)、`observer-http-privacy-v2`(2)、`private-form-narrow-tools-v3`(2)、`kp-v3-eval`(1)，均不 import 本次改动的任何文件，与既有基线记录的 12 项一致。被排除的 `combat-mechanics-v2.test.mjs` 在 import 阶段挂死、一项未发出即无限等待（120s timeout 退出 124），它只 import `rules/index.ts` 与 `rules/profiles/manifests.ts`，而 rules 树只反向依赖 `kp/causal-action-program` 与 `kp/compound-composition`，都不在本次 diff 内，故与本改动无关；该挂死本身未定位。`npx eslint` 退出 1，两条错误分别在 `app/table/[code]/table-client.tsx:130` 与 `tests/kp-vnext-stage3-room.test.ts` 的未使用夹具 `materializeAlcoveAloneBundleV2`；以 HEAD 版本文件副本单独 lint 复核，后者在 `025590c` 上同样报错，两条均为既有问题，本次未修。`attack` 检定、`highRisk` 与 `highRiskConfirmed`、fictionTime/resource attempt cost、`openBlank` 重校验、clarification 选择续跑与 `reviseSemanticDefinition` 仍失败关闭或未接线；SPEC 0001 A–O 生产采用门未运行。未运行 build、浏览器 QA、migration、部署，未修改 Secret、Cloudflare 资源、`cloudflare`、`main` 或 grok.me。

## vNext-2 共享检定合并 cloudflare 与快速开发部署（2026-09-04）

- 授权与基线：用户本轮依次明确要求“最终合并到 cloudflare”“部署”“这次也是快速开发部署”“从 cloudflare 部署”。合并前 `origin/cloudflare` 为 `0569b517ee0e101e32c38897812821a76d755aa6`，共享检定提交为 `7e1a8d182e37a9799983f9df688e61d76457f42a`，后者以 `0569b51` 为祖先，故 `git push origin HEAD:cloudflare` 为非强制快进、未产生合并提交，`origin/cloudflare` 前移 35 个提交至 `7e1a8d1`。`origin/main` 在全过程前后均为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，未修改或推送；`main` 是 `src/` 的 V3 之前代际树，与 `app/` 树不同源，两者提交不互相缺失。
- 分支处置：按用户选定档位删除 5 个远端分支——`feature/kp-agent-vnext-stage3-checkpoint`(`0b4c7ad`，0 独有提交)、`fix/restore-strict-tool-provider-gate`(`9d60a94`，0 独有提交)、`feature/kp-coarse-forms-vnext-stage3`(`0ec8c4e`，2 独有提交)、`feature/kp-form-graph-v6`(`653e1b1`，2 独有提交)、`fix/kp-human-speech-and-send-retry`(`ee314e3`，1 独有提交，属 `src/` 旧代际)。后三者的独有提交随删除从远端消失，SHA 已在此记录以保留取回路径。`feature/vnext2-room-vertical` 与 `feature/kp-agent-vnext-stage3-continue` 的删除被本地权限门拒绝，未执行，两者内容均已全部包含在 `cloudflare` 中。`codex/archive/*` 三个归档与 `fix/kp-player-facing-speech` 按判断保留：后者是 V3 树修复但落后 43 个提交、相关文件已被大幅重写，是否仍需要未经复核，不作为“已合并”处置。
- 部署源码与守卫：按 `release.md` 从已推送提交建立独立干净检出（`git clone --branch cloudflare --single-branch`），分支 `cloudflare`、HEAD `7e1a8d182e37a9799983f9df688e61d76457f42a`、`git status --porcelain --untracked-files=all` 为空，`npm ci` 退出 0。独立运行 `node cloudflare/verify-deploy-config.mjs` 退出 0，输出 `{"ok":true,"branch":"cloudflare","sourceSha":"7e1a8d18…"}`；`docs/specs/0001-llm-kp-responsibility-contract.md` 的 SHA256 为 `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`，与守卫冻结值吻合。
- 快速开发授权下的验证边界：按用户明确的快速开发授权，未运行正式部署冻结门的 `npm run lint`、`npm run test:unit`、`npm run test:worker`，部署脚本内唯一一次 production build 保留。同一提交上实际通过的定向证据为：`npm run typecheck` 退出 0；`npx vitest run tests/kp-vnext-stage3-room.test.ts --testTimeout=60000` 退出 0（17/17）；`npx tsx --test` 六个 schema/Provider/transport 目标退出 0（63/63）、八个 Claims/adapter/Rules/context 目标退出 0（89/89）；真实 DeepSeek strict-tool 握手 5 次调用 `status=passed`、`registrationAccepted=true`。需要说明的是，正式冻结门当前也无法完成：`npm run test:unit` 在 `tests/combat-mechanics-v2.test.mjs` 的 import 阶段挂死、一项测试未发出即无限等待（120s timeout 退出 124），该挂死未定位且与本次改动无 import 路径相连。
- 登录与外部操作：`npx wrangler login --device`（OAuth 2.0 设备授权流，RFC 8628）用于无头远程会话；前三个设备码因 5 分钟窗口超时作废（超时仍返回退出码 0，故每次以 `npx wrangler whoami` 复核而非采信退出码），第四次 `Successfully logged in.`。未索取、未记录、未写入任何 API Token。远端只读确认：账号 `Yinskyriver@gmail.com's Account`(`7aca31eae821510ea477022b0c0e0e91`)；部署前 `npx wrangler deployments status` 为版本 `c0a06ce0-95c7-4233-81c6-bf98c2a54ec4`（2026-09-01T06:01:21Z）承接 100% 流量；`npx wrangler d1 migrations list DB --remote` 返回 `No migrations to apply`。未执行远端 migration、Secret 变更或任何资源创建。
- 部署与控制面判定：`DEPLOY_SOURCE_SHA=7e1a8d182e37a9799983f9df688e61d76457f42a npm run cf:deploy` 退出 1。build 与 Worker 上传均成功（资产 9 个上传完成、`Uploaded zhuwei (7.30 sec)`、绑定 `ROOMS`/`DB`(zhuwei-dev)/`AI`/`ASSETS` 全部列出），失败发生在上传完成之后的 `GET /accounts/…/workers/scripts/zhuwei/subdomain` 返回 503 的瞬时 API 故障（Ray ID `a35a9b675d0bd757-NRT`）。因此不以退出码判定结果：`npx wrangler deployments status` 显示新版本 `7f34fa5c-6a90-4eaa-bbf1-afb17854c024`（2026-09-04T05:31:14.458Z）承接 100% 流量，据此判定部署成功。
- 发布后检查与未声明范围：`curl --max-time 15 https://zhuwei.yinskyriver.workers.dev/` 退出 0、HTTP 200、0.557s、25134 字节；标题为「烛帷｜AI 主持的多人 D&D 跑团」，主标题为「帷幕后，烛火未灭」；对错误页特征的匹配经复核为 CSS `"fontWeight":500` 的假阳性。本轮未登录进入房间、未调用真实生产模型，因此只声明部署完成与公开入口正常，不声明线上外部 AI 能力已实测恢复。本条执行日志的 Git push 需用户单独授权，未获授权前记为未执行，不影响已完成的部署。

## SPEC 0001 A–O 机械半补齐与判断半分离（2026-09-04）

- 目标与能力合同：把 §21 十五条验收场景从“十覆盖五部分”推进到“十五条机械半全部有具名断言”，并把此前混为一谈的两类缺口分开。逐条回到 SPEC 原文核对后发现，此前记为 partial 的五条里有两条并非内核职责：G 的“不追加第二层机关”与 M 的“在自然决定点切换聚光灯”，主语都是 KP——一个地牢本来就可以有两个陷阱，“自然决定点”在何处是对虚构的读解，内核去拦截反而会拒绝正确内容。因此 `tests/spec-0001-acceptance.test.mjs` 的语义改为：`covers` 记机械半（内核无论模型说什么都强制的部分），`judgement` 记模型判断半，且每个判断半必须要么以 `probe` 指向 `tools/spec-0001-behaviour-probes.mjs` 里一个真实存在的探针，要么以 `probePending` 写明为什么还没有探针，二者恰居其一由门断言。计数门从 10/5/0 改为 15/0/0，并新增“判断半七条（A、B、C、G、H、I、M）、已被探针衡量两条（B、H）、其余五条写明未探针原因”的断言。

- 症状与根因（唯一的真实产品缺口）：SPEC 21.I 要求失败产生“相称的世界变化”，实现两层都未强制非空增量。KP 实际走的降级路径 `rules/v2/causal-action-drafts.ts` 的 `campaignLifecycleCausalDraft` 对 `commitMeaningfulFailure` 只要求 `basisRefs` 与 `newOptions` 非空，`consequenceRefs` 仅做 `boundedTextList`，空数组放行，随后在 `causal-actions.ts:2231` 降为 `committedConsequences: []`；内核 `rules/v2/campaign-actions.ts` 的同名动作只检查 `isRecord(consequences)`，`{}` 同样放行。于是一次失败可以提交、推进虚构时间、给出新选项，而世界状态零变化。需要说明 I 的另外两个子句此前已被强制且并非缺口：`newOptions.length >= 1` 即“产生新的应对局面”，`unchangedRetry` 拒绝即“不得原样返回并要求重复同一检定”。

- 修改文件与直接消费者：`rules/v2/causal-action-drafts.ts` 增 `consequenceRefs.length === 0` 拒绝，直接消费者为 `causal-actions.ts` 的两处 `campaignLifecycleCausalDraft` 调用与 `compound-actions.ts`；`rules/v2/campaign-actions.ts` 的 `commitMeaningfulFailure` 增空记录拒绝，直接消费者为 Room 的 `stepCampaignWorld` 与直接 Rules 输入。该守卫位于共享内核，今天也管着生产 V3，故 `kp/private-form-policy.ts` 的 V3 私有 Form 政策同步把“已兑现 consequenceRefs”改写为“非空且已兑现的 consequenceRefs”，让模型被告知规则而不是靠撞修复循环发现；此改动不触动任何被冻结的 promptHash（见验证）。此外 `docs/specs/traceability-matrix.md` 的 A–O 追踪表补上五行的新证据与判断半说明，并在节首指明可运行门与两半读法。

- 代表性矩阵：C——`tests/npc-mechanical-definition-v5.test.mjs` 新增一例，把六项属性 30、AC 30、熟练 +9、HP 1,000,000 与伤害 `100d100+1000` 五轴同时顶到校验器真实天花板，断言 `startEncounter` 不拒绝且极值原样冻结进 runtime，证明拒绝跟随结构而非量级；过程中修正一处认识：真正的公式天花板是 `combat-actions.ts:359-364` 的 `count ≤ 100 / sides ≤ 100 / |modifier| ≤ 1000` 与 `parseFormula` 的单项 `NdM(+/-K)` 正则，`ability-compiler.ts` 的 `MAX_DICE_COUNT = 1000` 在这条路径上不可达。F——`tests/world-campaign-v2.test.mjs` 新增两例：`SourceClaimCreated` 缺 `sourceBasis`/`formedAtFictionMicros`/`motive` 任一项即不通过 `validateCampaignEventPayload`（传闻可假但永不匿名），`SensoryEvidenceAcquired` 引用未冻结 `factId` 时 `applyCampaignEvent` 抛 `fact unavailable`；这两条此前已被强制、只是从未被断言。G——同文件新增一例：目标 7 点生命、冻结 `fixedDamage` 30，断言 `DamagePacketResolved.amount` 仍为 30、`CreatureDied` 触发；`rules/v2/damage.ts:26` 把生命值钳在 0，故“不降低伤害”必须断言伤害量而不是生命值差。I——`tests/ending-reorientation-room-v2.test.ts` 新增一例：空 `consequenceRefs` 的有意义失败得到 `needsKp`（玩家保留回合可改说法）而非提交，同一束换成非空即 `committed` 且 receipt 带 `meaningfulFailure: true`。M——登记表补上 `tests/rules-multiplayer-v2.test.mjs` 的聚光灯账本断言。

- 定向验证与退出码：`npx tsx --test tests/spec-0001-acceptance.test.mjs` 退出 0（4/4，含新增探针门）；把某条 `probeId` 改成不存在值后该门报 `scenario H: no probe named "H-does-not-exist"`，证明它承重，随后还原。`npx tsx --test tests/world-campaign-v2.test.mjs` 退出 0（20/20，17→20）；`npx tsx --test tests/npc-mechanical-definition-v5.test.mjs` 退出 0（10/10，9→10）；`npx vitest run tests/ending-reorientation-room-v2.test.ts --testTimeout=120000` 退出 0（6/6，5→6）。`npx tsx --test` 四个与 promptHash 相关的文件（`kp-strict-tool-transport-v3`、`kp-form-context-v3`、`v3-room-binding-v3`、`deepseek-strict-tool-provider`）退出 0（30/30），证明 V3 政策文案改动未破坏冻结哈希。`npm run typecheck` 退出 0；改动文件 `npx eslint` 退出 0（其中 `world-campaign-v2.test.mjs` 首版用解构弃值触发三条 `no-unused-vars`，改为遍历三个键后清零）。`npm run build` 退出 0（Worker 套件所需）。需要记录的一处环境事实：本机上这些重型 Room 用例超过 vitest 默认 5000ms，必须显式 `--testTimeout`，否则整文件假红。

- 归属与未覆盖范围：Node 套件（排除既有 import 阶段挂死的 `tests/combat-mechanics-v2.test.mjs`）为 642 项、640 通过、2 失败，失败为 `kp-v3-eval` 的“KP V3 runner invokes production seams…”与 `rendered-html` 的“email session opens the hall…”；把本次改动的三个源文件临时换回 HEAD 版本复跑这两个文件，失败完全相同（11 项中 2 失败），故为既有问题（基线记录的 12 项已降至 2 项）。Worker 套件 `npx vitest run --testTimeout=120000` 为 45 文件、195 项、187 通过、3 失败、5 跳过：`stage4-world-campaign-vertical-v2` 是基线已记录的既有失败；`combat-room-randomness-v2` 的“recovers NPC save damage followed by a concentration-save wave”单独复跑通过（12/12），全量下该文件耗时 168s 并伴随 `SQLite alarm handler canceled`，判为重负载时序抖动；`combat-vertical-v2` 的“enters one multiplayer Encounter through Room Action”单独复跑仍失败（`expected undefined to be 'initiativeTieOrder'`：receipt 为 `awaitingInput` 且带 `pendingInputId … initiative-tie-order`，而 Read Model 的 `pendingInputs` 为空数组），把三个源文件换回 HEAD 复跑失败完全相同，故非本次回归；该项在上一条日志的 Worker 基线（193 项、1 失败）中未出现，说明它是本条目之前、7e1a8d1 之后的某次改动引入的既有破损，本次只定位与记录，未修。G 与 M 的判断半无法用现有 vnext-2 wire 表达（危害作者化属 Phase 3、聚光灯属 Phase 4），A、C、I 的判断半缺可判定题面，五者均在登记表内写明而非静默。`kp/clock.ts` 的 `spotlightSkew`/`spotlightRefuseSpeech` 与 `rules/ruleset.ts` 的 `MAX_SPOTLIGHT_SKEW` 经全树 grep 确认无任何调用者，该规则今天只作为提示词文本存在，本次只记录未接线也未删除。未运行浏览器 QA、migration、部署，未修改 Secret、Cloudflare 资源、`main` 或 grok.me。

## vNext-2 尝试代价补齐三种，拒绝不再必然免费（2026-09-04）

- 目标与能力合同：让被世界拒绝的尝试能扣掉它真正烧掉的东西。此前 `attemptCosts` 只有 `item` 一种可用：领域类型 `VNextAttemptCost` 早已建模 `fictionTime` 与 `resource`，领域校验 `isAttemptCosts` 也早已接受三种，但 `lowerAttemptCosts` 对非 item 一律返回 undefined、整束以 `BUNDLE_LOWERING_UNSUPPORTED` 失败关闭，wire 上也只暴露 item 一种。失败关闭本身是对的——注释写明“真实付出的代价绝不能凭空消失”——真正的缺口在 Rules：`applyItemCosts` 是这一族唯一的代价转换路径，另两种没有转换可走。于是一次“花了十分钟撬门、门纹丝不动”的裁决只能被定价成零成本。本次给另两种各接上它们本就存在的转换（`FictionTimeAdvanced` 与 `ResourceUsed` 都是基线 v2 事件，vNext 事件 schema 的 additions 无需改动），并把 wire 放宽到三个闭合变体。

- 关键设计判断：不去拓宽 `WorldInteractionCost`，而是另立 `WorldInteractionAttemptCost`。执行路径的代价必须与冻结 Ability 逐字节对账（`canonicalSha256(plan.costs) !== canonicalSha256(authority.costs)`），而 Ability 只冻结 item 形状的代价；若把三分支塞进同一个类型，那条对账路径就会拿到它无法对账的形状。两个类型是让被对账的一侧在类型上就不可能表示不可对账之物。同理，wire 用三个各自闭合的 anyOf 变体而不是一个带可选字段的形状：item 代价无法携带时长，时间代价也无法携带条目。

- 重放不变量：`WorldInteractionFeasibilityRuled` 的 fold 不施加代价，它**校验**代价已被前序事件提交（既有的 item 分支比对条目计数）。两种新代价必须有同等强度的校验，否则汇总事件可以声称一笔无人支付的代价。资源直接比对 `state.entities[actor].resources[resourceId] === amountAfter`；虚构时间的载荷原本只有 duration、无从校验，故在已施加效果中补上 `nowMicrosAfter`，fold 比对 `state.fictionTimelines[event.fictionTimelineId].nowMicros`。另外资源不足必须在裁决时拒（`insufficientResource`），因为 `ResourceUsed` 的 fold 在资源不足时抛 TypeError——那会表现为崩溃，而不是它本该是的那个拒绝。

- 修改文件与直接消费者：`rules/v2/world-interaction-model.ts` 新增 `WorldInteractionAttemptCost`、`isAttemptCost`、`attemptCostIdentity`（按“物”而非按条目去重，避免同一笔支出被拆成两条各自合法的记录）与两个已施加效果变体，并放宽裁决计划与已提交载荷的类型和校验；`rules/v2/world-interactions.ts` 新增 `applyAttemptCosts`，item 仍逐条委派给原有唯一的物件转换以保住“只有一处会改物件条目”与声明顺序；`rules/v2/events.ts` 的 fold 三种分别校验；`kp/vnext/room-bridge.ts` 的 `lowerAttemptCosts` 改为按种类重发而不是收窄，未知种类仍返回 undefined 失败关闭；`kp/vnext/proposal-schema.ts` 的 `attemptCost` 改为三个闭合变体的 anyOf。直接消费者为 Room 的 vnext-2 ingress 与 Rules `ruleWorldInteractionFeasibility`。

- 代表性矩阵：`tests/kp-vnext-materialization-and-feasibility-rules.test.mjs` 新增四例——十分钟的时间代价推进时间线并在 `appliedCosts` 中带 `nowMicrosAfter`、重放状态哈希一致；一格法术位的资源代价发出 `ResourceUsed`、实体资源归零、重放一致；付不起的资源代价得到 `insufficientResource` 而非崩溃；三种混合的代价按声明顺序产出 `FictionTimeAdvanced → ItemUsed → ResourceUsed → WorldInteractionFeasibilityRuled`。两条原本钉住旧限制的守卫测试同步改写：wire 那条从“只提供 item”改为断言三个变体及其各自的 required 字段集并逐种走完解码与领域校验；降级那条保留“未知种类必须整束失败关闭”的意图，反例改为真正未知的种类（原例 `resource` 现已受支持），并补上三种真实代价成功下沉的正面断言。夹具 `player()` 增加可选 resources 参数，默认空表使既有 genesis 逐字节不变。

- 定向验证与退出码：`npx tsx --test` 七个目标文件（proposal-schema、materialization-and-feasibility-rules、world-interaction-rules、hazard-actor-death-fold、claims、strict-tool-provider、world-campaign-v2）退出 0，117/117；`npx vitest run tests/kp-vnext-stage3-room.test.ts --testTimeout=120000` 退出 0（18/18）；`npm run typecheck` 退出 0；改动测试文件 `npx eslint` 退出 0。类型检查在中途主动指出了 `events.ts` 的 fold 仍按 item 形状消费 `appliedCosts`，那正是新代价必须真正生效的地方。

- 未覆盖范围：`item` 语义类的物化（vNext 目前只能固化 sceneFeature/worldFact/npc/worldRelation，拿起并带走一件物品仍需 v3 的物件系统入口）与可作者化危害仍未接线，因此 SPEC 0001 G 的判断探针仍无法构造。传输 schema 改变即 `schemaHash` 改变，本次未重跑真实 DeepSeek 握手，故不声明该 schema 已获注册证据。vNext 在生产仍是休眠的：Workers 运行时只以 `new RoomDurableObject(ctx, env)` 构造，第三、四个构造参数（vNext runtime 与裁决桥）结构上无法注入，`WORLD_INTERACTION_PROFILE` 也不在生产注册表内；`tests/room-worker.ts` 的子类是接线模板，但那条路要动 DO namespace 绑定与迁移，本次未做。未运行完整 Node/Worker 套件、浏览器 QA、migration、部署，未修改 Secret、Cloudflare 资源、`main` 或 grok.me。

## SPEC 0001 §8 自创危害的结构契约（2026-09-04）

- 目标与能力合同：SPEC 0001 §8 允许 KP 动态创造陷阱与环境危险，但要求“必须确定触发条件、可感知迹象、调查或解除方法、攻击或豁免、影响范围、伤害、状态、持续时间和环境后果”九项。调查发现这九项**一项都没有被强制**：`registerDefinition` 只校验 `definitionId`/`revision`/`definitionKind` 非空，`environmentHazard` 这个词在整个 `app/` 里从未出现，今天所谓的危害定义其实因为带 `effect` 键而落进 `isAbilityDefinitionCandidate`、被当作能力定义编译，`triggerHazard` 再经 `frozenRegisteredAbilityOperation(definition, "Effect")` 取出效果。也就是说，一处危险可以在没有任何可感知迹象、没有任何解除方法的情况下被冻结。本次把 §8 的九项立成一个受校验的定义形状 `zhuwei.environment-hazard-definition/v1`。

- 可达性调查（结论先于设计）：KP 在生产里根本无法自创危害。`registerDynamicDefinition` 的两处降级只注册 `compoundDynamicFact` 与势力/能力定义，`triggerHazard` 只有测试到达；`app/_runtime/lib/kp/` 内不存在发出这两个动作的表单。因此现在立契约的代价最低——没有任何生产路径依赖那个松散形状。另需记录内核里同时存在**三套互不相通的危害概念**：`campaign-actions.triggerHazard` 配 `hazard:*` 定义、vNext `world-interactions` 的 `registeredHazard` 配写死的 `WORLD_DAMAGE_PROFILE_REGISTRY`（全表只有一条“落物 6 点钝击”）、以及 `rules/v2/environment.ts` 环境要素 FSM 的 `triggerHazard`/`resolveHazard` 意图。三者未统一，本次未合并。

- 校验只看结构不看量级：§8 明确“高 AC、高 HP、高攻击或高伤害本身不能作为拒绝理由”，§10 补“世界危险不围绕玩家等级自动平衡”，故所有上界都取可表示性而非平衡性——豁免 DC 1..30、攻击调整值 -30..30、固定伤害 1..1,000,000、骰式沿用 `combat-actions.canonicalFormula` 的 count ≤ 100 / sides ≤ 100 / |modifier| ≤ 1000、爆发半径 1..100,000 英寸、持续时间 0..86,400,000,000 微秒。`perceptibleSigns` 与 `disableMethods` 要求非空而非仅存在：§10 要求有可察觉依据的风险必须以痕迹、传闻、环境或 NPC 反应预示，一处既无迹象又无应对方法的危险是构造性的不公平，而这正是“不怜悯”不许可的那一种。`conditions` 与 `environmentalConsequences` 允许为空数组——飞镖陷阱两者皆无是合理的——但字段必须存在，空数组即“已确定为无”。

- 契约以 schema 而非 kind 绑定：`environmentHazard` 在本契约之前是自由文本，既有定义带着这个 kind 却是能力形状且仍可触发。若按 kind 路由，那些定义会立刻失效。故 `isEnvironmentHazardDefinitionCandidate` 要求 `content.schema` 精确等于本 schema，使契约恰好绑定按它书写的定义，旧形状既不被打断也不被默认为合规。首轮按 kind 路由时 `tests/world-campaign-v2.test.mjs` 的两例危害用例确实转红，改为按 schema 绑定后恢复。

- 修改文件与直接消费者：新增 `rules/v2/environment-hazards.ts`；`rules/v2/campaign-actions.ts` 的 `registerDefinition` 在能力编译**之前**分流危害（陷阱有迹象、解除方法与遗留后果，能力没有，让能力编译先认领它正是九项从未被要求的原因）；`rules/v2/campaign-events.ts` 的 `DefinitionRegistered` fold 按 NPC 模板同样的方式校验危害。

- 代表性矩阵与定向验证：`tests/world-campaign-v2.test.mjs` 新增两例——九项逐一删除各得一次 `invalidRulesInput`，`perceptibleSigns`/`disableMethods` 置空数组同样被拒；以及“绝不因过于危险而拒绝”，把豁免 DC 30、`100d100+1000`、半径 100,000 同时顶格的危害原样注册并断言冻结内容逐字段一致。反转自检：把 `perceptibleSigns` 的最小长度由 1 放宽为 0，该用例立刻转红，证明规则承重，随后还原。`npx tsx --test tests/world-campaign-v2.test.mjs` 退出 0（22/22，20→22）；`npm run typecheck` 退出 0；`npx eslint` 该文件退出 0。

- 未覆盖范围（本阶段有意止步）：按本契约书写的危害**尚不能被触发**。§8 要求“致命危险必须通过规则结算”，而 `resolution` 无论豁免还是攻击都需要一次投骰；内核的非战斗豁免路径 `savingThrow` 只冻结豁免并请求权威随机，其 `SaveFrozen` 的 success/failure 记录 fold 从不执行，通用随机结算只产出 `ImprovisedCheckResolved` 的成败与叙述结果、不施加机械效果，而 `randomness()` 的续跑描述符只带身份、没有承载“结算后施加何种伤害”的位置。因此让危害按豁免结算需要新增续跑种类或改动权威随机的结算路径——那是回执、作用域证明与重放最吃安全性的地方，另立增量再做，本次不半途改动。同理 vNext 的 wire 仍只能引用那条写死的注册表 profile，KP 可达的危害作者化路径未打通，SPEC 0001 G 的判断探针仍无法构造。未运行完整 Node/Worker 套件、浏览器 QA、migration、部署，未修改 Secret、Cloudflare 资源、`main` 或 grok.me。
