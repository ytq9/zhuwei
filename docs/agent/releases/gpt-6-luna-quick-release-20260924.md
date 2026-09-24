# GPT‑6 Luna 快速发布执行记录

2026-09-24，用户在本任务中明确要求「提交推送快速部署」。本次按该指令采用现有定向验证、规格门、类型检查及必要构建，不重跑全量测试或 Lint。接入实现及真实 OpenAI 调用证据见[接入验收](../receipts/gpt-6-luna-integration-20260924.md)。

## 冻结与推送

- 分支：`cloudflare`。
- 功能提交及已构建源码：`2591285e01fdf7120d82757d63513e231af4f21b`（`feat(kp): add GPT-6 Luna with persistent room model binding`）。
- 本任务提交 43 个文件；提交前工作区差量已核对。本次推送同时包含该分支先前未推送的 26 个提交，没有改写它们。
- `git push origin cloudflare`：退出 0，远端从 `38b9fa41d766be18c07380afa8230af5dd4953da` 前进到上述功能提交，非 force。
- 推送前后均用 `git ls-remote origin refs/heads/main refs/heads/cloudflare` 读回；远端 `main` 均为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，没有改动。
- 本记录为后续文档提交；不改变已构建、已验证的产品源码。

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

## 部署受阻

`npx wrangler whoami` 退出 1：已有 OAuth 登录已过期且无法刷新。随后使用官方 Wrangler 登录流程：普通 localhost 回调登录两次超时；设备登录也在 5 分钟后超时。浏览器已进入 Cloudflare 的授权页面，但授权表单未能稳定显示，未获得有效的 Wrangler 登录。期间一次手动指定 `offline_access` 被 Wrangler 判为无效参数；去掉该参数后正常进入登录流程（Wrangler 自动附加它）。

截至本记录：

- **本地代码已验证，功能提交已推送。**
- **新版本未部署。** `npm run cf:deploy` 尚未执行，没有取得新版本或流量切换证据。
- **远端 Secret 未写入。** `OPENAI_API_KEY` 仍仅在本地 Git 忽略文件中；既有远端 Secrets 未改动。
- **远端 D1 migration 未执行。** 本次没有新增 schema 或 migration；目标仍为 `zhuwei-dev`（`f5a448fd-4224-4e52-bafb-a84cb190b618`），DO migration 仍为 `room-do-v1`。因登录受阻，尚未读取当前远端 migration、Worker 版本和 Secrets 名称。
- 未创建任何远端资源；未执行新版本线上冒烟或生产模型探针。接入验收中的真实 OpenAI 调用不能当作生产 Worker 调用成功。

## 恢复条件

完成现有账号的 Wrangler 登录后，沿用用户已给出的部署授权：先只读核对账号、现有版本、D1 和 Secrets，再以标准输入写入现有 `zhuwei` 的 `OPENAI_API_KEY`，记录干净 HEAD 并运行带 `DEPLOY_SOURCE_SHA` 的发布命令，最后核对版本流量和代表性线上入口。所有远端写操作串行，不修改 `main`。本次无需再次提交功能代码或重跑已通过的定向检查；后续源码有变化时按实际影响重新判定。
