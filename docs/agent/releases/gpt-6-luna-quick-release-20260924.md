# GPT‑6 Luna 快速发布执行记录

2026-09-24，用户在本任务中明确要求「提交推送快速部署」。本次按该指令采用现有定向验证、规格门、类型检查及必要构建，不重跑全量测试或 Lint。接入实现及真实 OpenAI 调用证据见[接入验收](../receipts/gpt-6-luna-integration-20260924.md)。

## 冻结与推送

- 分支：`cloudflare`。
- 功能提交及已构建源码：`2591285e01fdf7120d82757d63513e231af4f21b`（`feat(kp): add GPT-6 Luna with persistent room model binding`）。
- 本任务提交 43 个文件；提交前工作区差量已核对。本次推送同时包含该分支先前未推送的 26 个提交，没有改写它们。
- `git push origin cloudflare`：退出 0，远端从 `38b9fa41d766be18c07380afa8230af5dd4953da` 前进到上述功能提交，非 force。
- 推送前后均用 `git ls-remote origin refs/heads/main refs/heads/cloudflare` 读回；远端 `main` 均为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，没有改动。
- 首次发布记录提交为 `4fa3325f1b4bec6a2e39c72b80fd0c2f9678286f`，随后以该干净 HEAD 执行正式部署；它与功能提交的产品源码相同。本记录的最终更新仍仅改变文档。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 接入阶段 `npm run typecheck` | 退出 0 |
| 接入阶段 `npm run spec:check` | 0 错误、7 条既有警告 |
| 接入阶段 `gates:check` | 61 个测试文件全部绿，具体命令及范围见接入验收 |
| `git diff --check` 及提交前密钥扫描 | 通过，密钥不在版本控制或非忽略文件中 |
| `node cloudflare/verify-deploy-config.mjs` | 退出 0；冻结 SHA 与干净工作树相符 |
| `npm run build` | 退出 0 |
| `npx tsx --test tests/product/identity/rendered-html.http.test.mjs` | 退出 0，7/7；使用上述新构建及隔离本地 D1/DO，包含大厅两个模型选项和分别建房、模型绑定读取、身份与房主权限边界 |
| 构建后绑定与密钥检查 | 仍为 `zhuwei`、既有 `DB` 和 `ROOMS`；客户端资产、Worker 源码、source map 与配置不含实际 OpenAI 密钥 |

构建工具会为本地预览复制 `.dev.vars` 到 `dist/server/.dev.vars`；该文件不是客户端资产或 Worker 源码。根目录及该本地副本的权限均为 `0600`，实际值没有写入本记录。

## 账号恢复

首次 `npx wrangler whoami` 退出 1，报告 OAuth 登录已过期且无法刷新。随后普通 localhost 回调登录两次超时，设备登录也在 5 分钟后超时；浏览器授权表单未能稳定显示。期间一次手动指定 `offline_access` 被 Wrangler 判为无效参数；去掉后正常进入登录流程（Wrangler 自动附加它）。

保存首次受阻记录后，再次 `npx wrangler whoami` 返回退出 0，确认现有账号 `Yinskyriver@gmail.com's Account`，账号 ID `7aca31eae821510ea477022b0c0e0e91`。据该实际结果继续已授权发布，没有把前述超时当成登录成功。

## 部署前核对与 Secrets

- `npx wrangler deployments list --json` 与 `versions view b9ce76c3-a11e-4481-a3cc-f64901362ce9 --json`：退出 0。发布前版本为 `b9ce76c3-a11e-4481-a3cc-f64901362ce9`，100% 流量。
- `npx wrangler d1 execute DB --remote --command 'SELECT name FROM d1_migrations ORDER BY id' --json`：退出 0；已有 `0000` 至 `0013` 的全部 14 个迁移记录，与本地一致，`rows_written=0`。
- D1 仍为 `zhuwei-dev`（`f5a448fd-4224-4e52-bafb-a84cb190b618`），DO 命名空间仍为 `61c59ca8818448e0a3bdbaa6964d5a2c`，migration tag 仍为 `room-do-v1`。本次无新 migration，没有执行远端迁移或创建资源。
- `npx wrangler secret list`：退出 0，写入前已有 `DEEPSEEK_API_KEY`。
- 使用 Python 从本地忽略文件在内存提取用户提供的 OpenAI 密钥，通过子进程标准输入交给 `wrangler secret put OPENAI_API_KEY --name zhuwei`：退出 0。实际密钥未作为命令参数、日志或 Git 内容；未修改既有 DeepSeek 密钥。

## 部署与线上检查

发布时工作树干净，执行以下命令，退出 0：

```sh
DEPLOY_SOURCE_SHA=4fa3325f1b4bec6a2e39c72b80fd0c2f9678286f npm run cf:deploy -- --message 'Add GPT-6 Luna; source 4fa3325f1b4bec6a2e39c72b80fd0c2f9678286f'
```

该命令实际完成部署保护检查、production build 和部署。首次独立构建用于产物 HTTP 验证；此处为发布脚本自带构建，源码没有变化。新版本 `59527e60-112a-49bc-af74-1e3f7df3e846`，deployment ID `fb4fcffb-148d-411f-95af-dc65abb69c19`，部署时间 `2026-09-24T03:41:28.562882Z`。后续 `deployments list --json` 与 `versions view 59527e60-112a-49bc-af74-1e3f7df3e846 --json` 均退出 0，控制面确认：

- 新版本接收 **100% 流量**，部署消息携带完整冻结源码 SHA。
- 既有 `DB`、`ROOMS` 命名空间及 DO migration tag 均未变化。
- `DEEPSEEK_API_KEY` 与 `OPENAI_API_KEY` 均为新版本的 `secret_text` 绑定。

对 `https://zhuwei.yinskyriver.workers.dev` 做一次有界线上冒烟（请求各有 15 秒超时，未重试）：

| 请求 | 结果 |
| --- | --- |
| `GET /` | 200，标题包含「烛帷」 |
| `GET /hall`（匿名） | 200，显示「先登录，再入座」 |
| `POST /api/game`，`listMyRooms`（匿名） | 401，明确要求登录 |

三项均返回 Cloudflare Ray 标识并通过预期内容检查。所有远端写操作串行，Git 推送均为非 force、仅针对 `cloudflare`。

## 交付范围

**本地代码已验证，提交已推送，部署已完成。** 两模型建房与模型绑定通过新构建的真实本地 HTTP 验证；线上入口、活动版本及密钥绑定已核对。未运行全量测试/Lint，未额外执行生产房间完整游玩或生产模型探针；接入验收的真实 OpenAI 调用是本地适配器的外部接口证据，不称为生产 Worker 全链调用成功。
