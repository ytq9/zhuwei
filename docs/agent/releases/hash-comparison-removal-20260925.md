# 去哈希第三步（3a）部署 — 2026-09-25

用户确认保留其余哈希、不做 3b，并对部署推送 3a（[ADR 0056](../../adr/0056-comparisons-and-self-hashes-without-hashing.md)：比较不再经过哈希，自带哈希的对象不再重算核对）回答「可以」。本次部署现有 Worker `zhuwei`，并推送 `cloudflare`。没有远端 migration、Secrets 修改或新建资源。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-25 23:44:03，Asia/Shanghai（`2026-09-25T15:44:03.014586Z`） |
| Worker version | `caca5af2-d8a0-4a9f-828c-56ada5530081` |
| Deployment | `945e449b-9a54-4999-b8d5-8af558aa9676` |
| 原线上 version | `05da54e1-8507-4030-b7dc-b82781069965`（源码 `0932e9b`，[第二步部署](event-hash-removal-20260925.md)） |
| 部署源码 commit | `f73716db8eb591d99fd6fc485b73034fa600eb7c` |

主工作区仍有另一个会话未提交的改动（Luna 兼容修复及其测试、一份未跟踪的故障记录），没有提交、部署或推送。检查与部署都在 `cloudflare` HEAD 的干净克隆上运行（`.wrangler/quick-deploy-20260925d/source`）。

## 检查与执行

| 操作 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 1；按文件、规则和消息去重后与上次部署的 lint 日志逐条相同，没有新增。出现次数 217 → 216，少的一次是 `story-archive.test.mjs` 里原有的未用变量 `_old` |
| `npm run build` | exit 0（Node 套件中的页面 HTTP 测试需要构建产物） |
| `node tests/run.mjs --suite node` | 1570/1575；4 个失败与上次部署逐名相同（`social-shape` 1 个、`private-lowering-diagnostics` 3 个）。第 5 个是 `delivery-confirmation` 的「a failed new submission does not revive an older cancellation notice」，全量套件中偶发，单独重跑该文件 11/11 |
| 同上，`rendered-html.http` | 该文件起的本地 `wrangler d1 migrations apply` 在迁移写入后，与 registry.npmjs.org 的连接一直没有响应，停了约 13 分钟。手动结束这个子进程后套件继续，该文件 7 项全部通过（包括需要 D1 的建桌用例） |
| `node tests/run.mjs --suite worker` | 358/362；4 个失败与上次部署逐名相同（`story-action.room` 3 个、`story-world-event.room` 1 个） |
| `npm run gates:check`（`f2d84bf`） | exit 0；声明的门 62 个测试文件全绿。`f73716d` 只改 ADR 0056 正文 |
| `node tools/gate.mjs --check` | exit 0 |
| `npm run spec:check` | 0 错误、7 条原有体积警告 |
| 真实 9DCMQN 归档（本地，提交前） | 从创世重放一次约 136 → 118 毫秒 CPU，读取校验归档约 46 → 11 毫秒 |
| `npx wrangler whoami`、`deployments list --json` | exit 0；部署前 `05da54e1` 接收 100% 流量 |
| `d1 execute DB --remote`（读 `d1_migrations`） | exit 0；14 个，与本地相同，`rows_written=0`；本次无 migration |
| `DEPLOY_SOURCE_SHA=f73716d… npm run cf:deploy -- --message '…'` | exit 0；部署保护通过，构建一次，上传后生成新版本 |
| 部署后 `deployments list --json`、`versions view caca5af2… --json` | exit 0；新版本接收 **100% 流量**，部署消息带完整源码 SHA；6 个绑定、compatibility 日期与标志、DO migration tag `room-do-v1` 与上一版本相同 |
| 冒烟（curl，每项 15 秒超时，不重试） | `GET /` 200、`GET /hall` 200 并显示登录提示、匿名 `POST /api/game` 401 |
| `npm run diagnose -- --at 2026-09-25T23:47:00+08:00 --minutes 6`（只读） | exit 0；部署后到 23:46 只有 1 条记录，是冒烟的匿名 401（warn 级，`HTTP_AUTHENTICATION_REQUIRED`） |

## 推送

- 推送前读回：`cloudflare` 为 `2a9918649d9ca738c74d37adbf4a665816be0e73`，`main` 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
- 可快进；新增行的密钥模式扫描没有命中。
- `git push origin cloudflare`（非 force）：exit 0，`2a99186..f73716d`。
- 推送后读回：`cloudflare` 与本地 HEAD 相同，`main` 仍为 `cf7dbdd`。本记录随后作为单独的文档提交推送。

## 交付范围

- **本地代码已验证**：见上表。
- **部署已完成**：控制面确认 `caca5af2` 接收 100% 流量，冒烟通过。
- **线上效果未验证**：部署后没有玩家请求；没有对生产环境发起模型调用。
- **已推送**：`cloudflare` 快进到 `f73716d`，远端 `main` 未变。
- 其余哈希按用户决定保留，3b 取消（ADR 0056 决定 4）。

本机证据在 `.wrangler/quick-deploy-20260925d/`：`source/`、`typecheck.log`、`lint.log`、`build.log`、`node-suite.log`、`delivery-confirmation-rerun.log`、`worker-suite.log`、`gate-check.log`、`spec-check.log`、`deploy.log`、`deployments-*.json`、`version-after.json`、`d1-migrations-before.json`、`remote-*.txt`、`smoke*`、`observability-after.*`。目录不进 Git。
