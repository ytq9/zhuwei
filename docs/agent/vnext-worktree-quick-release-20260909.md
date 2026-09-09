# Worktree 合并与快速发布候选（2026-09-09）

本次授权是“合并worktree文件，提交推送快速部署”，用户随后明确“不保留记录，继续部署”，批准迁移并改为删除前述 1 个受影响房间及其记录。现已部署：版本 `27afcd14-fa83-494f-b84c-0516e89cc8b2` 接收 100% 流量，migration 0013 已应用，首页/登录和静态文件核验通过。实际部署源码是 `0c26a3db9e59fccd08238240a92df35b9e615380`，与构建源码 `461dba2` 仅差两份发布文档。以下保留准备阶段证据，最新执行结果见末节。

## 来源与合并

- 起点：本地与远端 `cloudflare/79a84d47ad0b9a40178019bc252b7378a85766d3`。
- 当前工作区差量修订及开场准备保存为 `221dff9a63b13233289872e0494639d4b08e12cb`。
- 合入故事 MVP `77f4e1827627a6044068a43ccac4caba886e9bbf`；已包含 creation/2807ffa、history/30766e4、journal/9ba2c97 的回收提交或等价补丁。历史已集成/停止的 worktree 不反向覆盖，也未删除。
- 9 个冲突文件逐块解决：KP adapter/guidance/provider、Room authority-store/durable-object/vnext-proposal-invocation、provider-room 测试、SPEC 0016 和执行日志。
- 物理调用、响应和预算由 StoryCreationStore 统一负责；Room 保存不可变阶段证明和修订审计。未知已发调用不重采样，保存响应的重复提交不重记调用或产生第二次游戏效果。
- Proposal 仍最多一次修订，支持 JSON Patch 与完整替换、具体诊断及完整重验；故事草稿/独立评审的最多四次作业额度保持独立合同，并受同来源和房间共同预算约束。

## 合并接缝修复

1. 修订归档恢复从原冻结世界重做 lowering/Rules 拒绝证明，不凭修订 ticket 自行授予新裁决；恢复使用同一请求与保存响应。
2. 共享 journal 原先用语义 NFC 校验哈希保存原始模型响应，导致非法字符串在进入修补诊断前丢失。原始运输证据现按未归一化的规范 JSON 字节哈希，保存时保留对象成员顺序；非法 JSON 成员、非 NFC 和错误字段仍由原语义校验拒绝。新增驱逐、补记与归档往返证据。
3. 完整开场材料使故事上下文达到 51,756 units；故事 artifact 上限统一为 64,000，并写入预算 binding。故事准备及已冻结可复用目录的 Proposal 输入使用已有故事运输的 96,000 token 准入，普通请求仍保持 58,000 输入上限。未删减决定性上下文，未增加调用次数、故事成本或 token 预留总额度。
4. 更新两项落后的 schema 变体断言。历史 HTTP 测试显式覆盖空 Provider 凭据，避免继承本机 `.dev.vars`；全局 outbound 拦截及零请求断言保留，未发生真实外部调用。
5. SPEC 的普通 Proposal 一次修订引用与新故事预算条款消除歧义，不把故事四次作业额度用于普通 Proposal。

## 定向证据

证据目录：`/tmp/zhuwei-release-20260909/`。表中均为实际退出码 0；最终运行时修改后仅追加了历史测试配置与文档，不影响已通过的运行时检查。早期定位失败保留在同目录，未计为通过。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | 507 packages 安装完成 | npm-ci.log |
| `npm run db:generate` | 与现有生成 migration 一致，无额外 schema 变化 | db-generate.log |
| Node 18 个修补/表单/创作/开场直接消费者目标文件 | 162/162 | node-final.log |
| Worker provider-room / ability-operation / npc-plan-formation 修订目标组 | 33/33，25 项非目标未运行 | room-revision-final2.log |
| Worker story-action / story-world-event / story-creation-store / external-invocation-journal / archive-d1 | 59/59 | story-room-final3.log |
| 真实认证历史 HTTP：成功、新身份行动、幂等、权限拒绝 | 2/2 | history-http-final2.log |
| opening / normal module initialization preserves | 4/4，35 项非目标未运行 | opening-final.log |
| `npm run typecheck` | 通过 | typecheck-final2.log |
| `git diff --check` 与冲突标记检查 | 通过 | Git 工作树检查 |

Node 组早于最后的故事预算接线；随后 59 项故事 Worker 组覆盖该接线及恢复。总计 260 个不同定向用例通过，不代表全项目或持续真实游玩已通过。修订 Worker 的 `interrupted:afterRandomnessCandidateCommit` 是主动注入的恢复故障。

## 远端前置状态与需要的决定

- 既有 Worker：`zhuwei`；DB：`zhuwei-dev`；ROOMS/AI/ASSETS、DO migration `room-do-v1` 不变。
- 当前线上版本：`6f1b038d-d4eb-4636-91e2-39051982f357`，100%；来源 `5b5fa317b4071c4af8b304a473bf1bef036a9ef7`。本轮没有切流。
- 唯一待执行 D1 migration：[0013_smiling_shinobi_shaw.sql](../../drizzle/0013_smiling_shinobi_shaw.sql)。新增 story_room_archive_part 表、为 authoritative_room_archive_checkpoint 增加 story_generation 与 story_content_hash 两列。无 DROP、DELETE、账号或房间改写；本地真实 migration 和归档写读已通过，远端尚未执行。
- 只读房间聚合与线上源码/候选源码的同一 hasWorkflow 比较证明：另有 **1 个**当前线上接受的 vNext play 房间会被候选拒绝（原 parserHash `f95e0ee…`）。此前获准不能续玩的 2 个旧 vNext 房间已被线上拒绝；本次新增影响不是那两个。记录将保留，不静默改绑、迁移或删除。
- 远端 main 实测 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，保持不变；旧文档中的产品基线 SHA 不作为覆盖远端的理由。

授权依据分别为 [AGENTS.md](../../AGENTS.md) 的远端 migration 单独授权、vNext 后续新房保护，以及 [发布路由](release.md)。须确认执行上述增量 migration，并接受这 1 个现役房间不能继续游玩，之后才能切换现有 Worker。

## 未覆盖

- 三轮修订、¥0.30、60 秒和普通调用 5/6 次未启用。
- 原任务中普通大型 Item+Ability / NPC 来源扩展的前置输入预算缺口没有完整复验，未宣称解决。
- 本轮未新增真实 DeepSeek 调用、连续游玩、浏览器质量验收、完整测试/Lint 或统计认证；历史受控模型证据不代表真实故事质量。
- 生产 migration、Worker 切流和发布后冒烟尚未执行。

## 已完成的提交、推送与构建

- 合并提交：`461dba2bf82747192a94a254ea7a365499e0dc42`；两个父提交为 `221dff9a63b13233289872e0494639d4b08e12cb` 和 `77f4e1827627a6044068a43ccac4caba886e9bbf`。工作树干净。
- `git push origin HEAD:cloudflare` exit 0；随后 `git ls-remote` 确认远端 cloudflare 为合并提交、main 仍为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
- `DEPLOY_SOURCE_SHA=461dba2bf82747192a94a254ea7a365499e0dc42 node cloudflare/verify-deploy-config.mjs` exit 0；`npm run build` exit 0。403 个跟踪源码/构建输入前后 SHA256 一致，113 个构建产物指纹已保存。
- 生成配置仍为 Worker zhuwei、既有 DB/ROOMS/AI/ASSETS 与 room-do-v1，没有新增资源。历史页面 `/table/:code/history` 已进入构建路由；Vinext 对登录/注册的静态路由分类提示不是构建失败。
- 证据：`build-final.log`、`source-before-build.json`、`build-artifacts.json`、`build-proof.json`。本节及执行日志是构建后的纯文档回执，不改变已验证源码或要求重复构建。
- 当前停止点仅为远端 migration 与新受影响房间的具体授权；取得决定后按 migration → 版本部署 → 控制面与代表性 HTTP 冒烟串行推进。尚未执行这些操作，也未新增模型采样。

## 批准后生产执行（2026-09-09）

- 用户明确“不保留记录，继续部署”，取代上述保留记录决定；授权对象为此前核验的 1 个新受影响 vNext 房间及相关记录，不扩展为删除其他桌或账号。
- 再次只读查询时，该 parserHash 对应房间已为 0，房间目录总数从此前 8 变为 7；genesis/events/checkpoints/projection 四类 D1 归档的孤立记录均为 0。浏览器酒馆仅剩此前两个旧 vNext 桌。本轮没有执行删除请求或删除其他房间，也没有取得已消失房间的 Room 清理回执，因此不把既有删除归功于本次操作或宣称独立验证了 DO 物理清理。
- `CI=1 npx wrangler d1 migrations apply DB --remote` exit 0，仅应用 `0013_smiling_shinobi_shaw.sql`。读回 d1_migrations id=14、applied_at=`2026-09-09 09:56:12`；新表 7 列存在，3 个既有 checkpoint 的新增字段均保持默认 0/null，新故事归档表无记录；再次 migrations list 显示无待执行项。新归档的业务写读已由前述本地真实 D1 用例验证，本轮未在生产植入测试游戏记录。
- 部署前源码干净、403 个源码/构建输入及113个产物指纹匹配；精确 DEPLOY_SOURCE_SHA=0c26a3db9e59fccd08238240a92df35b9e615380 的 guard exit 0。复用此前成功构建，`CI=1 DEPLOY_SOURCE_SHA=… npx wrangler deploy` exit 0；Worker/DB/ROOMS/AI/ASSETS 与 room-do-v1 不变，无 Secrets 或新资源修改。
- 控制面：deployment `4311a415-91cd-4bde-ad25-bff913aeadf9`，创建于 `2026-09-09T09:57:54.378531Z`，version `27afcd14-fa83-494f-b84c-0516e89cc8b2` 为 100%。Wrangler 报告 gzip 1,246.68 KiB、startup 224 ms。
- 最小线上冒烟：通过已启用的本机 HTTP 代理访问 `/`、`/login`、`/_next/static/chunks/index-DSh8mEk1.js`，全部 HTTP 200 / curl exit 0；首页和登录包含对应内容，JS SHA256 与已部署构建产物一致。未改代理、未新增模型调用，未声称完整游戏流程或真实故事质量已验证。
- 私有证据：`approved-room-target-rows.json`、`approved-cleanup-state.json`、`migrations-apply-approved.log`、`migration-readback.json`、`migrations-after-apply.log`、`deploy-approved.log`、`deployments-after-approved.json`、`smoke-approved.json`，均在原证据目录。
- 部署后共享工作区出现其他在途测试修改；它们未参与本次部署或回执提交。本次只补记两份发布文档，实际生产源码仍以上述完整 SHA 为准。
