# 归档失败诊断快速部署 — 2026-09-15

用户在 MBDE3S 回复慢、归档失败排查后明确要求“快速部署”，授权将已准备的诊断改动部署到现有 Worker `zhuwei`，并做一次最多 55 秒的只读日志采样。本次部署已完成，控制面确认新版本接收 100% 流量；采样未取得有效归档日志，不能宣布归档或回复性能已经恢复。

## 发布与影响

| 项目 | 实际值 |
| --- | --- |
| 冻结源码 | `1ccab99b32a6a01f2ebea90e06642f51a688cd15` |
| Worker version | `940da199-bc18-4af4-a36e-92ed8be23fdb` |
| Deployment | `889e6002-50bc-41a0-8168-f06015dbd887` |
| 北京时间 | 2026-09-15 01:00:23.492189 |
| 前版本 | `6365d711-2b5f-401a-bb11-dfb0dfdf8f39` |
| 前源码 | `24a897efee9c491772ddfee3b13062777c366c59` |
| 入口 | <https://zhuwei.yinskyriver.workers.dev/table/MBDE3S> |

以[旁白等待窗口部署](narration-timeout-hotfix-20260915.md)的干净源码为基线，在本地独立 `cloudflare` checkout 冻结候选，保留已部署的 180 秒旁白窗口。主工作区存在其他任务的未提交改动；只移植 `flushAuthoritativeD1ArchivePageOnce` 的归档诊断差量，没有带入同期新增的旁白诊断。主工作区 HEAD、暂存区及其他既有差量保留。

本次提交涉及两个运行时文件、两个测试文件和一份[部署前排查回执](../receipts/archive-diagnosis-mbde3s-20260915.md)：

- [Room DO](../../../app/_runtime/lib/room/durable-object.ts)在既有归档失败路径标记 `verifyHostBindings`、`buildEnvelope`、`appendD1`、`saveProgress` 四个阶段。
- [日志序列化](../../../app/_runtime/lib/room/telemetry.ts)仅输出合法阶段和五个固定归档错误码；未知错误输出 `unclassified`，不输出异常正文、堆栈、模型请求或秘密。

没有改变归档时机、重试、持久化内容、模型调用或玩家行为。排查中复现的历史旁白 binding 兼容缺陷尚未修复；当前线上失败的具体阶段仍待证据确认。

## 冻结验证与操作

按本轮快速部署授权执行直接影响检查及必要构建，没有执行全量测试或全项目 Lint。以下命令在冻结 checkout 运行；退出码均为 0，另述的身份检查除外：

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test --test-name-pattern='archive failures identify\|structured telemetry emits\|unknown and sensitive\|all thirteen' tests/platform/telemetry/structured-telemetry.test.mjs` | 4/4 通过，覆盖阶段、错误码精确匹配与脱敏边界 |
| `npx vitest run tests/platform/recovery/archive-do-resume.room.test.ts -t 'backs off'` | 3/3 通过、8 项跳过，覆盖失败阶段、退避、重启与恢复后的检查点 |
| `npm run typecheck` | 通过 |
| `CI=1 DEPLOY_SOURCE_SHA=1ccab99b32a6a01f2ebea90e06642f51a688cd15 node cloudflare/verify-deploy-config.mjs` | 构建前及上传前各通过一次 |
| `npm run build` | 仅运行一次，通过 |
| `node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote` | 无待执行 migration，仅查询 |

部署前完整日志测试文件曾为 9/10；失败项 `party narration emits its own redacted model invocation receipt` 查找旧源码字符串 `const narration = createAuthoritativeKpAdapter`，而前次已部署代码已使用 `createRoomKpAdapter`。本次未修改该文件对应的既有断言，未将此项记为通过；详情保留在部署前排查回执。

`wrangler whoami` 已输出 OAuth 登录成功和账号信息，但进程未正常退出。首次挂起后终止，再使用直接 Node 入口做 35 秒有界检查，包装器退出 124；该结果不记为正常退出，也不归因为认证失败。随后通过现有代理只读调用 Cloudflare 控制面，账号、部署前版本、上传前版本及部署后版本查询均通过。凭据仅在本机内存中使用，没有打印或写入证据文件。

实际部署命令退出 0：

```sh
CI=1 HTTPS_PROXY=http://127.0.0.1:7897 WRANGLER_SEND_METRICS=false \
DEPLOY_SOURCE_SHA=1ccab99b32a6a01f2ebea90e06642f51a688cd15 \
node node_modules/wrangler/bin/wrangler.js deploy \
--message 'Archive failure stage and fixed-code diagnostics; source 1ccab99b32a6a01f2ebea90e06642f51a688cd15'
```

部署后控制面确认上述 version 接收 100% 流量。既有 `DB`（`zhuwei-dev`，`f5a448fd-4224-4e52-bafb-a84cb190b618`）、`ROOMS` / `RoomDurableObject`、`AI`、`ASSETS` 及 Secret 绑定配置与前版本一致，runtime 配置一致。1,153 个源码文件和 112 个构建文件的 SHA256 在上传前后保持一致。没有远端 migration、Secret 修改、新资源、Git push 或远端 `main` 修改。

## 上线冒烟与有界采样

匿名 GET `/table/MBDE3S` 返回 HTTP 200、HTML，耗时 1.298 秒。首次检查器错误地预期重定向至登录页，因此断言退出 1；[页面源码](../../../app/table/[code]/page.tsx)明确在同一 URL 返回“先登录，再入座”，该响应符合现有合同。修正断言后再做一次匿名 GET，退出 0、耗时 1.902 秒，确认 HTTP 200、URL 不变、HTML 类型、登录标题及 `/login?next=%2Ftable%2FMBDE3S` 链接。只保存状态与布尔结果，没有保存响应正文。这只验证匿名入口，不证明登录后的游戏回复恢复。

仅对新 version 和目标房间哈希做一次 55 秒 `wrangler tail` 采样；含结束清理共 58.23 秒，取得 0 个日志 envelope、0 个事件。没有保留能够确认订阅成功的连接状态，因此结论仅为“未取得有效归档日志”，不能推断期间没有发生归档失败。未追加采样、发送玩家行动、点击旁白重试或调用模型。

本地证据位于 `.wrangler/quick-deploy-archive-diagnostics-20260915/`：冻结源码、变更及源码/产物清单、检查/构建/部署日志、部署前后控制面快照、迁移查询、`verification.json`、`archive-tail.json`、`smoke.json` 和 `smoke-corrected.json`。本回执相对链接、空白 diff 与目标内容核对通过；文档收尾不重复运行代码检查或构建。
