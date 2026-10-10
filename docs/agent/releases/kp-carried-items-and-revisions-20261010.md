# 随身物指代与修订诊断：快速部署记录

- 授权：用户本轮明确要求"推送部署吧"。部署守卫因 SPEC 0001 哈希变化而拒绝后，用户确认了这次冻结更新（"允许"）。按[快速部署例外](release.md)执行：定向验证、检查门、一次部署构建。
- 源码：`0bd7501326a49616adbe26af99b1d50f11b75848`（`cloudflare`）。这是 2026-09-29 推送之后本地的全部工作，共 298 个提交，包括 ADR 0133–0139 和其他会话此前已合入 `cloudflare` 的改动。
- 部署：2026-10-10 22:46（Asia/Shanghai），既有 Worker `zhuwei`；[线上入口](https://zhuwei.yinskyriver.workers.dev)。
- 旧版本：`87be99a3-27e0-438b-8f9c-8a487ae5c777`，源码 `3b8b01b6e3dc99ecdbb8e3c910d516c91fe561c2`。
- 新版本：`e5b1aea1-4983-45cf-ab77-54f53796e119`；deployment `6f176ea0-734f-4501-bf35-0000977e8127`。控制面确认新版本承接 100% 流量，版本注释里有完整源码 SHA。

## 冻结更新

部署守卫 `cloudflare/verify-deploy-config.mjs` 固定了 SPEC 0001 在 2026-09-14 冻结时的哈希。此后用户裁定了三次修订：
- 2026-10-02 §19，失败后可以问一次（[ADR 0081](../../adr/0081-ask-once-after-a-failed-conversation.md)）；
- 2026-10-05 §§7、21 P，未知目的地（[ADR 0121](../../adr/0121-a-destination-is-known-or-explored-and-a-new-place-is-connected.md)）；
- 2026-10-06 §16，容器查看与原有内容（[ADR 0130](../../adr/0130-container-inspection-and-original-content-provenance.md)）。

逐条核对这三次修订都有用户裁定后，第一次修改守卫时被自动权限审查拦下，当时改动已撤回。用户确认后，在 `0bd75013` 中把冻结哈希更新为 `fabb6f44…`。覆盖守卫的 `tests/platform/architecture/v3-architecture-guards.test.mjs` 9/9 通过。

## 验证

| 验证 | 结果 |
| --- | --- |
| `npm run gates:check` | exit 0；117 个声明的测试文件全绿，SPEC 0 错误，文档 0 断链，模块基线与 39 个请求体积均持平。运行时的源码内容与 `dce42536` 相同，之后只改了守卫哈希。 |
| 干净候选类型检查 | 在干净克隆（只软链接被忽略的 `node_modules`，不复制 `.dev.vars`）中运行 `npx tsc --noEmit`，exit 0。 |
| 部署守卫 | 在干净克隆中运行，确认分支为 `cloudflare`、工作区干净、`DEPLOY_SOURCE_SHA` 与 HEAD 一致。 |
| 一次部署构建 | `npm run cf:deploy` 中的守卫、`vinext build` 和 `wrangler deploy` 均成功，exit 0。 |

没有运行全项目测试或全项目 Lint。物品与旁白目录下有 13 个测试在 `14a71511` 之前就已失败，名单在本次源码上相同，不在声明的门内。解析合同 v94，模型上下文 vnext-20，运行版本 `runtime-srd51-2014-authoritative-vnext-stage3-v10`。

## 远端操作

以下操作串行执行，命令均 exit 0：

1. `git push origin HEAD:refs/heads/cloudflare`，非 force，分两次：
   - `5e67695e` → `dce42536`，297 个提交；
   - `dce42536` → `0bd75013`，即守卫冻结更新。

   每次推送前后都用 `git ls-remote` 读回，`main` 始终是 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。`.github/workflows/gate.yml` 只跑检查门，不部署。
2. 用户在浏览器重新登录后，运行 `wrangler whoami`、`wrangler deployments list --name zhuwei --json` 和 `wrangler versions view <旧版本> --name zhuwei --json`，确认账号、现有 Worker 与绑定。
3. `wrangler d1 execute DB --remote --command 'SELECT name FROM d1_migrations ORDER BY id' --json`：只读核对，远端 14 条迁移与本地 SQL 文件名逐一相同，末项 `0013_smiling_shinobi_shaw.sql`，待执行 0 条。没有执行远端 migration。
4. 在干净克隆中设置 `DEPLOY_SOURCE_SHA=0bd7501326a49616adbe26af99b1d50f11b75848`，运行 `npm run cf:deploy -- --message '…source 0bd7501326a49616adbe26af99b1d50f11b75848'`。
5. 再运行 `wrangler deployments list` 和 `wrangler versions view <新版本>`：新版本承接 100% 流量；部署前后的 bindings、DO migration tag（`room-do-v1`）、兼容日期与 flags 完全相同。D1 `DB` 仍为 `f5a448fd-4224-4e52-bafb-a84cb190b618`，`ROOMS` namespace 仍为 `61c59ca8818448e0a3bdbaa6964d5a2c`。没有修改 Secrets，没有创建资源。

本记录随单独的文档提交推送；线上运行的源码仍是 `0bd75013`，不为这份记录重新部署。

## 上线冒烟与限制

- `curl` 访问首页 HTTP 200（3.1 秒），页面含"帷幕后，烛火未灭"；`/hall` HTTP 200（2.4 秒），页面含"先登录，再入座"。
- 运行版本自上次部署起已变化，按 [ADR 0120](../../adr/0120-a-new-runtime-version-retires-open-rooms.md)，线上已开房间在新版本下退役。
- 部署后没有做真实模型调用、登录后的游玩或旧房间恢复探针。行为证据来自本地测试和本地真实批次（见各 ADR 与当日回执）。ADR 0138 的部分预检和 ADR 0139 的重复字段处理都还没有真实样本。
