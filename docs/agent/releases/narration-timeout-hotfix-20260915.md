# 冻结旁白等待窗口快速部署 — 2026-09-15

用户在 MBDE3S 的线上超时排查中明确要求“先把超时窗口改宽，确保玩家至少能正常游玩”，承接本任务已授权的现有 `zhuwei` 快速部署。新版本已接收 100% 流量；本地慢回复可完成，但该房间旧回复的单次线上恢复仍失败，不能声称游玩已经完全恢复。

## 发布与影响

| 项目 | 实际值 |
| --- | --- |
| 冻结源码 | `24a897efee9c491772ddfee3b13062777c366c59` |
| Worker version | `6365d711-2b5f-401a-bb11-dfb0dfdf8f39` |
| Deployment | `dad53993-49a8-480e-8537-e87cacb9855f` |
| 北京时间 | 2026-09-15 00:39:57.536658 |
| 前版本 | `65ce7151-8b30-4f5a-938e-a33a20099f90` |
| 前源码 | `fd9788ef5e95007ba1090ebdde1cf724c67fae7b` |

[SPEC 0011 §2](../../specs/0011-reliability-correction-observability-and-evaluation.md#2-slo) 和 [ADR 0023](../../adr/0023-narration-timeout-window.md) 记录本次窄调整。冻结旁白生成与审核合计 45 秒改为 180 秒，首次与恢复共用同一路径。剩余时限通过 Adapter → Room RPC → 实际模型传输传递，审核不能重置总窗口。发布有效期为 240 秒。其他模型阶段保留原截止，调用数、模型、Prompt、token 上限与冻结物理调用身份保持。

以[前一次部署](narration-recovery-hotfix-20260915.md)的干净源码为基线，在独立 `cloudflare` checkout 冻结。只增加本次九个运行时文件的差量（包含一个超时常量文件）、两项直接测试文件和三项规格/ADR 文件。主工作区对应生产文件逐字一致，其他生产源码与原部署一致；主工作区 HEAD、暂存区和既有差量保留，没有 Git push。

持久化预算及其哈希不改写，原响应仍按原 invocation/generation 恢复。旧账本的 50 秒预留不是强制取消计时器，实际完成按真实耗时入账；原来源累计预算继续约束后续调用。没有 schema 变更、远端 migration、Secret 修改、新资源或房间数据清理。

## 验证与操作

原失败命令 `npx tsx --test tests/kp/narration/recovery.test.mjs`：生成模拟耗时 60 秒后，旧代码在审核前抛 `modelTransient`，1 通过 / 1 失败。修复后同一冻结请求生成与审核分别获得 180 秒和剩余 120 秒。

最终定向证据：

- Node 9/9：`npx tsx --test tests/kp/narration/recovery.test.mjs tests/kp/provider/deepseek-authoritative-provider.test.mjs`。覆盖慢回复、审核不能重置截止、正常 Provider 参数、错误分类及实际 AbortSignal。
- Worker 10/10：`npx vitest run tests/kp/narration/interrupted-publication.room.test.ts tests/kp/narration/multiplayer-publication.room.test.ts`。真实 Room/action/journal 的 130 秒模拟回复发布成功；原事件不变，待发布状态有效，模型调用恰为生成加审核两次；原中断恢复、未知响应禁止重采样、迟到响应及多人正常发布保持。物理传输计时器在收到的剩余时限中止，默认 NPC 计时器仍为 45 秒。
- `npm run typecheck` exit 0；`npm run spec:check` exit 0、0 错误，保留既有 7 项警告；diff 空白与本回执相对链接检查通过。
- `wrangler whoami`、部署前后 deployment/version 读取、`wrangler d1 migrations list DB --remote` 均 exit 0，无待处理 migration。
- 冻结 guard 在构建前及上传前通过；一次 `npm run build` exit 0；`CI=1 HTTPS_PROXY=… DEPLOY_SOURCE_SHA=… npx wrangler deploy --message …` exit 0。
- 1,152 个源码文件与 112 个构建文件的 SHA256 在上传前后相同；生产源码与已测主工作区相同，因此没有重复执行同源码检查。控制面验证新版本 100%；既有 bindings、runtime 配置均与原版相同。

## 单次线上恢复与限制

部署后刷新 MBDE3S，点击其本人“重试 KP 回复”一次，未发送新的玩家行动或进行第二次恢复。调用前记录有界计划：一个恢复请求、最多两次物理旁白调用、总旁白等待 180 秒、最多 230 秒只读日志观察；成功或明确失败即结束模型尝试。未扩大为真实游戏多轮认证。

00:42:25 的同房间日志中，`room.model.invocation.completed` 的旁白调用段耗时 **116 ms**、结果 `modelTransient`；随后 `room.viewerNarrationRecovery.completed` 保持 `committed`，页面仍显示回复未送达。平台对整次请求记录 **wallTime 16,241 ms / cpuTime 42 ms**；116 ms 不是整次请求耗时，也不是实际 Provider 独立耗时。

该调用段未耗尽新窗口，旧任务另有恢复阻塞。现有脱敏日志不能区分未知原调用、入账预算拒绝或其他 Room 调用拒绝，也不能计算真实物理调用数；不能因此把失败归因于 Provider 慢。没有重采样未知调用、删除原回复或把失败记为恢复成功。同步观测到 archiveFailure，但不据此认定因果关系。

本机证据位于 `.wrangler/quick-deploy-narration-timeout-20260915/`：独立源码、变更与源码/产物清单、构建/部署日志、控制面快照、迁移状态、验证摘要及脱敏线上日志。日志只保留匹配房间哈希的白名单字段，未保存原始请求、模型正文或密钥。
