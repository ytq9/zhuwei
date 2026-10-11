# 法术效果执行与运行版本 v11：快速部署记录

- 授权：用户本轮要求"合并到 cloudflare 并推送部署"。第一次部署后发现运行版本清单没有升，问用户后，用户选择"现在升版本再部署"。按[快速部署例外](release.md)执行：定向验证、检查门、部署构建。
- 源码：`803db9189aa1c5ef7b42532c588322302f2bd3be`（`cloudflare`）。2026-10-10 推送之后的全部本地工作：
  - 本地 `cloudflare` 上原有的 6 个提交（`f0fe8d43`…`758f8a4f`）；
  - `claude/ui-layout-functionality-02acbc` 截至 `0021b07d` 的 16 个提交，包括角色栏、行动列表、地图分层，以及锁定前的建卡检查（ADR 0146–0149、0156）；
  - `claude/unexecutable-spell-controls` 的 12 个提交，法术效果由 Rules 执行（ADR 0150–0155、0157–0160）；
  - 升运行版本的 1 个提交。
  - 不含 ui-layout 分支之后新加的 `e79a91d0`。
- 旧版本：`e5b1aea1-4983-45cf-ab77-54f53796e119`，源码 `0bd7501326a49616adbe26af99b1d50f11b75848`。
- 第一次部署：2026-10-12 00:02（Asia/Shanghai），源码 `70618396b61d3d4150186dd67af2225bb7b1601c`，版本 `4221f52e-c99d-4863-8f20-dc00e416ce9c`，deployment `9f43187d-ebd7-4aaf-b5df-04353c926d5c`。
- 第二次部署：2026-10-12 00:15，源码 `803db918`，版本 `0ae3b1a9-082a-4a1d-b2e7-c2bda3a7b8e6`，deployment `4f960da9-43bd-4a71-8aac-cd0b71aab46a`。控制面确认这个版本承接 100% 流量，版本注释里有完整源码 SHA。[线上入口](https://zhuwei.yinskyriver.workers.dev)。

## 运行版本

法术执行器改变了施法的结算方式，还新增了三种事件（`EffectSaveRepeated`、`EffectZoneMoved`、`EffectRetargeted`），但 `70618396` 仍是 `runtime-srd51-2014-authoritative-vnext-stage3-v10`。比对两份源码的清单，各个 profile 的哈希完全相同，所以第一次部署后，v10 下开的房间会在新规则下继续运行。

按 [SPEC 0013 §2.3](../../specs/0013-versioned-runtime-profiles.md)（[ADR 0120](../../adr/0120-a-new-runtime-version-retires-open-rooms.md)），`803db918` 改成：
- 运行版本 `stage3-v11`；
- 事件 schema `room-world-events-vnext-stage3-v9`，在 additions 里列出这三种事件。

第二次部署后，v10 下开的房间退役。在 00:02 到 00:15 之间，v10 房间是在新规则下运行的。

## 验证

| 验证 | 结果 |
| --- | --- |
| `npm run gates:check`（`70618396`） | exit 0：132 个声明的测试文件全绿，SPEC 0 错误，文档 0 断链，模块基线和 39 个请求体积都持平。 |
| `npm run gates:check`（`803db918`） | exit 0：132 个全绿，SPEC 0 错误，请求体积持平，最高 52165。 |
| 定向测试 | `combat-controls-read-model` 与 `combat-mechanics` 共 91/91；法术相关测试 44/44。 |
| 干净候选类型检查 | 在干净克隆中运行 `npx tsc --noEmit`，两次都 exit 0。克隆只软链接被忽略的 `node_modules`，不复制 `.dev.vars`。 |
| 部署守卫 | 两次都输出 `{"ok":true,"branch":"cloudflare"}`，`sourceSha` 与 `DEPLOY_SOURCE_SHA` 一致。SPEC 0001 自上次冻结后没有改动。 |
| 部署构建 | 两次 `npm run cf:deploy` 中的守卫、`vinext build`、`wrangler deploy` 都 exit 0。 |

没有运行全项目测试或全项目 Lint。`tests/kp/npc/npc-mechanical-definition.test.mjs` 有 2 个用例在合并前的 `cloudflare` 上就已失败，不在声明的门内，另有会话在修。

## 远端操作

以下操作串行执行，命令都 exit 0：

1. `wrangler whoami`，OAuth 有效。只读运行 `wrangler deployments list --name zhuwei --json` 和 `wrangler versions view e5b1aea1… --name zhuwei --json`，记录旧版本和它的绑定。
2. `wrangler d1 execute DB --remote --command 'SELECT name FROM d1_migrations ORDER BY id' --json`：远端 14 条，与本地 `drizzle/` 相同，末项是 `0013_smiling_shinobi_shaw.sql`，没有待执行的迁移。本次没有执行远端 migration，源码也没有改 schema、`wrangler.jsonc` 和 `package.json`。
3. `git push origin <sha>:refs/heads/cloudflare`，非 force，分两次：
   - `07119839` → `70618396`；
   - `70618396` → `803db918`。

   每次推送前后都用 `git ls-remote` 读回，`main` 始终是 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
4. 在干净克隆中设置 `DEPLOY_SOURCE_SHA`，运行 `npm run cf:deploy -- --message '…source <sha>'`，先 `70618396`，再 `803db918`。
5. 读回 `wrangler deployments list` 和 `wrangler versions view 0ae3b1a9…`：
   - 新版本承接 100% 流量；
   - 与旧版本相比，bindings、DO migration tag（`room-do-v1`）、兼容日期（`2026-05-22`）和 flags（`nodejs_compat`）完全相同；
   - D1 `DB` 仍是 `f5a448fd-4224-4e52-bafb-a84cb190b618`，`ROOMS` namespace 仍是 `61c59ca8818448e0a3bdbaa6964d5a2c`。

   没有修改 Secrets，也没有创建资源。

本记录随单独的文档提交推送。线上运行的源码仍是 `803db918`，不为这份记录重新部署。

## 上线冒烟与限制

- `curl` 访问首页返回 HTTP 200，页面含"帷幕后，烛火未灭"；访问 `/hall` 返回 HTTP 200，页面含"先登录，再入座"。两次部署后都检查过。
- 部署后没有做真实模型调用、登录后的游玩或战斗内施法探针。法术行为的证据来自本地 Rules 测试：真实目录法术、权威随机、事件重放和叙述材料覆盖。
- 法术部分未覆盖的范围写在 [ADR 0150](../../adr/0150-spell-conditions-run-by-rules-with-concentration-and-repeat-saves.md)–[0160](../../adr/0160-hunters-mark-moves-to-a-new-creature.md) 各条的"影响"里，主要有：KP 裁定的检定和环境危害不用加值骰；命令术不检查不死生物、语言和"直接有害"；"需要看得见目标"的选目标限制仍未执行。
