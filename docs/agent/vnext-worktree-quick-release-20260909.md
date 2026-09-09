# Worktree 合并与快速发布候选（2026-09-09）

本次授权是“合并worktree文件，提交推送快速部署”。发布采用定向检查和必要构建；没有全量回归或新的真实模型质量验收。远端 migration 与新增受影响的现役 vNext 房间仍需独立确认，当前生产未切换。

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
- 提交推送、生产构建及后续部署结果在执行后补记。
