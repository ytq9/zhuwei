# 故障编号与日志关联快速部署

2026-09-16，用户明确要求“部署”，在获知完整门禁未通过、本次 20 项定向验收通过后，进一步明确要求“快速部署”。本次按该授权采用定向验收、类型检查、构建与部署保护作为发布依据；完整门禁失败继续如实保留。目标仅为现有 Worker `zhuwei` 及既有绑定；没有 Git push、远端 migration、新资源或 Secret 修改授权。

## 候选与范围

部署前控制面 version 为 `007fa66b-afaf-4517-9224-ebafde0c970c`，100% 流量，对应已部署源码 `3a767304768b4edaf86a8b64192297db6312f5c1`。从该干净源码建立独立 `cloudflare` checkout，只纳入 19 个本次任务文件；10 个修改前快照与线上源码逐字一致，另一个已有测试文件只改变诊断后缀断言。主工作区 HEAD 和其他任务差量保留。

最终候选：`c23b11e155847cb7d3cfd5cc70bb96bae8fdd722`。增加请求故障编号、桌面复制按钮、HTTP 与既有行动哈希的日志关联，以及历史/实时查询工具；补全公开 STORY 错误提示与日志分类。不改变恢复资格、模型调用、权威状态或持久化结构。

日志查询专用 Token 仅保存在主工作区已忽略的 `.wrangler/diagnostics.env`，权限 `0600`，不进入候选、构建或 Worker Secret。独立候选继续使用原有 Wrangler 部署登录。

## 验证事实

| 命令或证据 | 实际结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0；112 个构建文件 |
| 诊断、公开错误日志、玩家错误提示、发送恢复四个 Node 文件 | 18/18；exit 0 |
| `vitest run --config tests/config/history-http.config.mjs tests/platform/telemetry/game-diagnostics.http.test.mts` | 2/2；exit 0，真实认证路由、D1、拒绝、成功与伪造编号 |
| 本次受 ESLint 覆盖的两个 API、两个查询工具、三个测试及 HTTP 配置文件 | exit 0；`app/_runtime` 被现有 ESLint 配置排除，不记为已检 |
| 部署 guard、干净候选状态、`git diff --check` | exit 0 |
| `wrangler whoami --json`、既有 version 查询 | exit 0；账户与目标 Worker 已确认 |
| `wrangler d1 migrations list DB --remote` | exit 0；无待执行 migration，仅查询 |
| `npm run lint` | 初次 172 错误；本次新增 HTTP 测试的冗余 triple-slash 声明已移除，并经定向 Lint/HTTP 验证。其余 171 错误所在文件及 Lint 配置与已部署源码逐字一致；未改配置、规则或 allowlist |
| `npm test` | Node 部分 1661 项：1583 通过、78 失败，约 213 秒。后续 Worker 部分出现失败，整次运行在约 312 秒停止，exit 143，不记为完整通过 |
| `npm run test:http` | exit 1；页面 7/8，独立路由 4/4。页面断言仍要求 `DeepSeek V4 Pro`；未修改该断言或页面来掩盖失败 |
| 独立 `npm run test:worker` | 出现多项失败及 `EnvironmentTeardownError`，停止时未取得完整统计，不记为通过。与上述 Worker 部分曾短暂重叠，不能把结果视为隔离完整回归 |

全量 Node 的 `materialization-and-feasibility-rules.test.mjs` 中 `applyAtomicWorldInteractionSteps materializes and consumes one prospective ref atomically` 已在部署基线定向复现相同 `missingPrerequisite` 失败（期望 committed，实际 rejected）。其余 77 项尚未逐项基线归因，不概括为全部历史问题。首次基线选择错误文件而未命中，不计为通过；纠正后的实际用例失败证据已保存。

页面基线对照在本地 Worker 启动时遇到 `SQLITE_READONLY` 并挂起，约 189 秒后停止，不能用于证明页面失败的历史归属。上述问题均不在本次诊断能力的直接修改范围内，未扩大实现范围修复。

## 部署与线上验收

用户明确选择快速部署后，上传前复查原线上 version 未变，1166 个源码及原先 112 个构建文件的 SHA256 未漂移，独立候选保持干净。实际部署命令如下，exit 0；按脚本重新执行 guard 和 production build 后上传：

```sh
CI=1 HTTPS_PROXY=http://127.0.0.1:7897 WRANGLER_SEND_METRICS=false \
DEPLOY_SOURCE_SHA=c23b11e155847cb7d3cfd5cc70bb96bae8fdd722 \
npm run cf:deploy -- --message \
'Game diagnostic references, safe log correlation and copy feedback; source c23b11e155847cb7d3cfd5cc70bb96bae8fdd722'
```

- Worker version：`c4fad104-31f0-43b5-a952-2276c54f093f`。
- Deployment：`3710e621-d832-4aaa-a858-8b535122e23f`。
- 生效时间：北京时间 2026-09-16 14:03:39.619809，控制面确认 100% 流量。
- `AI`、`ASSETS`、`DB` / `zhuwei-dev`、`ROOMS` 与既有 Secret 绑定逐项与前版本相同。部署后源码清单与冻结清单一致，最终构建的 112 文件清单另存，未把重新构建前后的不同产物误记为相同。

一次代表性安全失败探针：匿名 `POST /api/game`，指令 `getCatalog`，返回 HTTP 401、`no-store` 和原请求故障编号。该请求在认证边界被拒绝，不触发游戏状态变更或模型调用。随后使用本机专用日志凭据按该编号查询历史接口，返回 `found`，唯一对应事件为 `http.request.failed` / `HTTP_AUTHENTICATION_REQUIRED`，状态 401、阶段 `httpRequest`。编号 → 服务端日志 → 查询报告的线上链路闭合。

匿名桌面入口 `/table/A48CY8` 返回 HTTP 200 和“先登录，再入座”。线上 `table-client-B0raPNVu.js`（含“复制故障信息”）及 `game-client-C2NPZmls.js` 的 SHA256 与最终构建逐字一致。复制交互由本地定向测试验证，未在生产制造游戏错误或点击玩家重试，也不据此宣称旧的生成、归档或回复故障已恢复。

## 证据与剩余限制

脱敏命令输出、基线对照、19 文件范围清单、1166 个源码文件及 112 个构建文件的 SHA256 清单位于 `.wrangler/diagnostics-release-20260916/`。源码 checkout 位于该目录下的 `source/`；`verification.json`、`smoke.json`、`history-smoke.json` 保存控制面、线上入口与按编号查询结果，`deployed-build-manifest.json` 保存最终构建清单。

本次按用户明确授权的定向验收快速部署已完成，完整门禁未通过的事实和归因限制继续保留。没有执行远端 migration、Git push、Secret 修改或新建部署资源；远端 `main` 未被本次操作修改。普通历史日志查询和本次诊断链路可用，不代表全部游戏故障已经修复。
