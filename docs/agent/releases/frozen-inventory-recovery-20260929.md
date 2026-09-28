# 冻结库存策略恢复修复：快速部署记录

- 授权：用户本轮明确要求“提交，推送快速部署”。按[快速部署例外](release.md)执行定向验证、审查和一次部署构建。
- 源码：`3b8b01b6e3dc99ecdbb8e3c910d516c91fe561c2`（`cloudflare`，39 个文件）。修复依据及历史夹具来源见 [ADR 0068](../../adr/0068-freeze-inventory-admission-policy-with-the-plan.md)。
- 部署：2026-09-29 00:59:57（Asia/Shanghai），既有 Worker `zhuwei`；[线上入口](https://zhuwei.yinskyriver.workers.dev)。
- 旧版本：`725f58b2-ee21-4e26-825c-3f611c250f33`，源码 `8239c42902aa20d89413c8b5c2d4ea3c48fa01ad`。
- 新版本：`87be99a3-27e0-438b-8f9c-8a487ae5c777`；deployment `2bca8ef6-8e8c-485a-a0a4-016e176fdebd`，控制面确认 100% 流量，版本注释记录完整源码 SHA。

## 源码边界与验证

另一会话的 `openai.ts`、`runtime-policy.ts`、`openai-authoritative-provider.test.mjs`、`provider.room.test.ts` 及未跟踪的 `incident-muf0q31y-20260924.md` 均未纳入提交。提交前后逐文件 SHA-256 相同。

从本地仓库创建独立干净克隆，切于 `cloudflare` 的上述源码提交；仅软链接忽略的 `node_modules`，不复制 `.dev.vars`。部署守卫确认工作区干净、分支正确且 `DEPLOY_SOURCE_SHA` 匹配。该克隆的 `origin` 是本地工作区；GitHub 推送从主工作区执行。

| 验证 | 结果 |
| --- | --- |
| 修复后的 `npm run gates:check` | exit 0；71 个声明的测试文件全绿，SPEC 0 错误、文档 0 断链；原有模块基线未放宽。此项在开发工作区执行，含另一会话的未提交改动，因此另做下列干净候选检查。 |
| Room 库存恢复专项 | `tests/platform/recovery/frozen-inventory.room.test.ts`，5/5；旧原稿在随机事件前后中断及驱逐后恢复，身份与历史输出保持。 |
| 干净候选 Node 直接消费者 | `node --import tsx --test tests/kp/narration/publication-repair.test.mjs tests/kp/protocol/prompt-contract.test.mjs tests/kp/provider/openai-authoritative-provider.test.mjs`，42/42，exit 0。 |
| 干净候选 Worker 版本恢复 | `npx vitest run tests/kp/provider/provider.room.test.ts -t 'version change\|earlier workflow version'`，3/3，60 项未选，exit 0。 |
| 干净候选类型检查 | `npm run typecheck`，exit 0。 |
| 一次部署构建 | `npm run cf:deploy` 内的部署守卫、`vinext build` 和 `wrangler deploy` 均成功，exit 0。 |

没有运行全项目测试或全项目 Lint。guidance v66、parser v75；工作流 hash 为 `sha256:20ee605470e8b771cbddbaed48d595e34f5aba2fe70746f30c0609f0e8301cbc`。全量请求估算 43,884 token，较 `c885793` 减少 25；`.gate-baseline.json` 只更新请求体积。

## 远端操作

以下远端操作串行执行，命令均 exit 0：

1. `wrangler whoami`、`wrangler deployments list --name zhuwei --json`、`wrangler versions view <旧版本> --name zhuwei --json`：确认现有账号、Worker 与绑定。
2. `wrangler d1 execute DB --remote --command 'SELECT name FROM d1_migrations ORDER BY id' --json`：只读核对 14 条迁移，与本地 SQL 名称逐一相同；末项 `0013_smiling_shinobi_shaw.sql`，待执行 0。未执行远端 migration。
3. `git push origin HEAD:refs/heads/cloudflare`：非 force；从 `7d7a5b4dd4a12693942befcf2744f9425d13a939` 快进到源码提交 `3b8b01b6e3dc99ecdbb8e3c910d516c91fe561c2`，共 10 个此前未推送提交。随后 `git ls-remote` 读回，`cloudflare` 匹配，`main` 仍为推送前实读的 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
4. 在干净克隆中设置 `DEPLOY_SOURCE_SHA=3b8b01b6e3dc99ecdbb8e3c910d516c91fe561c2` 后，运行 `npm run cf:deploy -- --message 'Preserve frozen inventory policy through replay and Room recovery; correct proposal diagnostics and concealment guidance; source 3b8b01b6e3dc99ecdbb8e3c910d516c91fe561c2'`。
5. 再运行 `wrangler deployments list` 和 `wrangler versions view <新版本>`：确认新版本 100% 流量，部署前后 bindings 完全相同；D1 `DB` 仍为 `f5a448fd-4224-4e52-bafb-a84cb190b618`，`ROOMS` namespace 仍为 `61c59ca8818448e0a3bdbaa6964d5a2c`，DO migration tag 仍为 `room-do-v1`。未修改 Secrets、创建资源或改变运行兼容配置。

本记录随单独文档提交推送；线上运行源码仍为 `3b8b01b`，不为审计文档重复部署。

## 上线冒烟与限制

命令行访问首页在获得 HTTP 响应前遇到 `curl (35): Recv failure: Connection reset by peer`，状态 `000`。依发布规则，只切换一次独立通道，以 Codex 浏览器复核：首页正常显示“帷幕后，烛火未灭”及进入酒馆入口；`/hall` 正常显示“先登录，再入座”和登录、注册链接。浏览器检查通过，但没有采集 HTTP 状态码。

原计划的匿名 `POST /api/game` 在命令行传输失败后未执行，不计为通过。本次没有真实模型调用、登录后的游玩或旧线上房间恢复探针；历史恢复结论来自本地真实历史夹具和 Room 测试。库存嵌套与公开见证合同仍属于待裁定草案，不属于本次部署。
