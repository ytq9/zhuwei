# 归档核对热修部署 — 2026-09-25

线上房间 9DCMQN 的归档核对超出 Durable Object 的 CPU 上限，玩家请求返回 500（排查见[本月日志](../../refactor-log/2026-09.md)）。用户裁定去掉哈希，确认分三步做，并对第一步说「可以，按你推荐，推送」。本次部署第一步（[ADR 0054](../../adr/0054-archives-are-copied-without-replay-checks.md)），并推送 `cloudflare`。没有远端 migration、Secrets 修改或新建资源。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-25 16:53:31，Asia/Shanghai（`2026-09-25T08:53:31.504424Z`） |
| Worker version | `8dbe6d0b-7fc4-434b-b4bd-ba7b8e177fa6` |
| Deployment | `700fa66d-b4c0-49a0-a27c-a7eb3ee001f7` |
| 原线上 version | `2657dd1c-7d3f-4ead-aad1-b6a20b6cddb0`（源码 `61003c0`，[当天上午的部署](frozen-context-quick-release-20260925.md)） |
| 部署源码 commit | `4268344e43e98396f99ce785627dc56e9733f41a` |

主工作区仍有另一个会话未提交的改动（Luna 兼容修复及其测试、一份未跟踪的故障记录），没有提交、部署或推送。部署从本地 `cloudflare` HEAD 的干净克隆运行（`.wrangler/quick-deploy-20260925b/source`）。

## 检查与执行

| 操作 | 结果 |
| --- | --- |
| 定向测试（主工作区） | 归档相关 Node 测试 108/108，Worker 测试 6 个文件 26/26；改前的 124 个归档测试里，16 个只测篡改能被发现，随核对删除 |
| 干净克隆上 `npm run typecheck` | exit 0 |
| 干净克隆上 `npm run gates:check` | exit 0；声明的门 62 个测试文件全绿；模块边界违规从 115 降到 112，其余指标持平 |
| 主工作区上的 `gates:check` | 一次 exit 1：界面测试 `delivery-confirmation` 的「a failed new submission does not revive an older cancellation notice」失败；单独跑两次、整文件连跑三次、干净克隆上都通过，不涉及归档代码，按高负载下的偶发记录 |
| `npm run spec:check` | 0 错误、7 条原有警告 |
| `npx wrangler whoami`、`deployments list --json` | exit 0；部署前 `2657dd1c` 接收 100% 流量 |
| `d1 execute DB --remote`（读 `d1_migrations`） | exit 0；14 个，与本地相同，`rows_written=0`；本次无 migration |
| `DEPLOY_SOURCE_SHA=4268344… npm run cf:deploy -- --message '…'` | exit 0；部署保护通过，构建一次，上传后生成新版本 |
| 部署后 `deployments list --json`、`versions view 8dbe6d0b… --json` | exit 0；新版本接收 **100% 流量**，部署消息带完整源码 SHA；绑定、compatibility 与 DO migration tag `room-do-v1` 与部署前相同 |
| 冒烟（curl，每项 15 秒超时，不重试） | `GET /` 200、`GET /hall` 200 并显示登录提示、匿名 `POST /api/game` 401 |

## 推送

- 推送前读回：`cloudflare` 为 `b92c5894bbeba97a13a610f682da355a9a8a4bb6`，`main` 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
- 可快进；新增行的密钥模式扫描没有命中。
- `git push origin cloudflare`（非 force）：exit 0，`b92c589..4268344`。
- 推送后读回：`cloudflare` 与本地 HEAD 相同，`main` 仍为 `cf7dbdd`。本记录随后作为单独的文档提交推送。

## 这间房的状态

按北京时间，归档闹钟在 15:10–15:31 之间每约 35 秒超限一次，15:31:52 有一次在 25.7 秒 CPU 下完成，之后这间房再没有调用。部署后到 16:55 它仍没有调用，所以新版本在这间房上的实际开销还没有线上证据，要等玩家下次操作后看调用记录。

## 交付范围

- **本地代码已验证**：见上表。
- **部署已完成**：控制面确认 `8dbe6d0b` 接收 100% 流量，冒烟通过。
- **线上效果未验证**：9DCMQN 部署后还没有请求；没有对生产环境发起模型调用。
- **已推送**：`cloudflare` 快进到 `4268344`，远端 `main` 未变。
- 规则每一步的世界状态哈希（第二步）还在，房间加载和每次提交的 CPU 仍随世界状态增长。

本机证据在 `.wrangler/quick-deploy-20260925b/`：`source/`、`typecheck.log`、`gates-check.log`、`deploy.log`、`deployments-*.json`、`version-after.json`、`d1-migrations-before.json`、`smoke*`。目录不进 Git。
