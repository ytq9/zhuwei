# 去哈希第二步部署 — 2026-09-25

用户对第二步（[ADR 0055](../../adr/0055-events-state-and-replay-carry-no-hashes.md)：事件、世界状态和重放不再使用哈希）选择「部署并推送」。本次部署现有 Worker `zhuwei`，并推送 `cloudflare`。没有远端 migration、Secrets 修改或新建资源。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-25 19:37:21，Asia/Shanghai（`2026-09-25T11:37:21.114817Z`） |
| Worker version | `05da54e1-8507-4030-b7dc-b82781069965` |
| Deployment | `d0e21cd5-36cb-4d68-98f3-5e71f0a03c6e` |
| 原线上 version | `8dbe6d0b-7fc4-434b-b4bd-ba7b8e177fa6`（源码 `4268344`，[第一步部署](archive-check-hotfix-20260925.md)） |
| 部署源码 commit | `0932e9b6c1f3fd796bf7d77b8d062a65d6e8f4da` |

主工作区仍有另一个会话未提交的改动（Luna 兼容修复及其测试、一份未跟踪的故障记录），没有提交、部署或推送。检查与部署都在 `cloudflare` HEAD 的干净克隆上运行（`.wrangler/quick-deploy-20260925c/source`）。

## 检查与执行

| 操作 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 1；去重后 149 条，与部署基线 `4268344` 的 149 条逐条相同。首次在 `039d61f` 上多出 2 条（测试里一个未用变量、一个 `this` 别名），由 `0932e9b` 修掉后复跑 |
| `npm run build` | exit 0（Node 套件中的页面 HTTP 测试需要构建产物） |
| `node tests/run.mjs --suite node`（`039d61f`） | 1569/1573；4 个失败与部署基线逐名相同（`social-shape` 1 个、`private-lowering-diagnostics` 3 个）。`0932e9b` 只改两个测试文件，这两个文件复跑 24/24 |
| `npm run test:worker`（`039d61f`） | 358/362；4 个失败与部署基线相同（`story-action.room` 3 个、`story-world-event.room` 1 个） |
| `npm run gates:check`（`38a880f`） | exit 0；声明的门 62 个测试文件全绿；模块边界违规 115 → 110，随后 `039d61f` 收紧基线 |
| `node tools/gate.mjs --check`（`0932e9b`） | exit 0 |
| `npm run spec:check` | 0 错误、7 条原有体积警告 |
| 真实 9DCMQN 归档（本地） | 旧头部信封照常读取；40 个旧事件按记录折叠，重放 CPU 1.6 秒 → 约 0.14 秒；新事件不带哈希字段、父事件是最后一条旧事件；旧加新事件重放得到同一状态；续写的归档能再读回 |
| `npx wrangler whoami`、`deployments list --json` | exit 0；部署前 `8dbe6d0b` 接收 100% 流量 |
| `d1 execute DB --remote`（读 `d1_migrations`） | exit 0；14 个，与本地相同，`rows_written=0`；本次无 migration |
| `DEPLOY_SOURCE_SHA=0932e9b… npm run cf:deploy -- --message '…'` | exit 0；部署保护通过，构建一次，上传后生成新版本 |
| 部署后 `deployments list --json`、`versions view 05da54e1… --json` | exit 0；新版本接收 **100% 流量**，部署消息带完整源码 SHA；绑定、compatibility 与 DO migration tag 与第一步版本相同 |
| 冒烟（curl，每项 15 秒超时，不重试） | `GET /` 200、`GET /hall` 200 并显示登录提示、匿名 `POST /api/game` 401 |
| 部署后调用记录（Workers Observability，只读） | 只有冒烟请求产生的 4 条记录；其中 1 条 error 级，与第一步冒烟时的记录形态相同 |

## 推送

- 推送前读回：`cloudflare` 为 `3a3e7b5dbd88e5253282ec38679b65a0cdc1fcb5`，`main` 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
- 可快进；新增行的密钥模式扫描没有命中。
- `git push origin cloudflare`（非 force）：exit 0，`3a3e7b5..0932e9b`。
- 推送后读回：`cloudflare` 与本地 HEAD 相同，`main` 仍为 `cf7dbdd`。本记录随后作为单独的文档提交推送。

## 这间房的状态

9DCMQN 的对象自第一步部署（16:53）起没有任何调用，所以两步在这间房上的线上开销都还没有证据，要等玩家下次操作后看调用记录。

## 交付范围

- **本地代码已验证**：见上表。
- **部署已完成**：控制面确认 `05da54e1` 接收 100% 流量，冒烟通过。
- **线上效果未验证**：9DCMQN 部署后还没有请求；没有对生产环境发起模型调用。
- **已推送**：`cloudflare` 快进到 `0932e9b`，远端 `main` 未变。
- 部署时正在等待骰子的暂存行动会按新基准重排后继续，这是推断，没有线上验证。
- 第三步（冻结上下文、投影、Profile、幂等、骰子承诺、genesis 与归档内容哈希）未开始。

本机证据在 `.wrangler/quick-deploy-20260925c/`：`source/`、`typecheck.log`、`lint.log`、`build.log`、`node-suite.log`、`worker-suite.log`、`gates-check.log`、`gate-check.log`、`deploy.log`、`deployments-*.json`、`version-after.json`、`d1-migrations-before.json`、`remote-*.txt`、`smoke*`。目录不进 Git。
