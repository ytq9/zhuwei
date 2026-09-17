# 当前工作区快速部署 — 2026-09-14

用户明确要求“快速部署一下”。现有 Worker `zhuwei` 已部署，控制面确认新版本接收 **100% 流量**；公开页面冒烟受本机连接重置阻塞，未证明线上完整游玩或外部模型恢复。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-14 22:46:22，Asia/Shanghai |
| Worker version | `f7fb2037-6684-4b6f-a87c-ce9e78e5af8c` |
| Deployment | `7c2b9ac8-282c-4617-8e39-a9a057f05ecd` |
| 原线上 version | `7df883a0-4fc7-4770-9fda-8be296ed99dc` |
| 冻结快照 commit | `a53c09f68ddc39039bea99ea3ed7a737df8062f1` |
| 冻结 tree | `b2227773038bf43b8d239654b50b502a82c57018` |
| 主工作区 HEAD | `ff78223102950adb4605d8fee9b8c837a34d55fa`，保持不变 |

原工作区的未提交测试重组、旁白修复和文档被保存为独立本地 Git 快照，在快照的 `cloudflare` 分支构建/部署。未修改原工作区分支或暂存区，未 Git push。快照不是远端提交。

部署保护仍要求干净的 `cloudflare` 候选、准确 `DEPLOY_SOURCE_SHA`、既有 Worker 与资源绑定。主 PRD 相比 HEAD 仅移动一个测试 gate 路径，经逐字还原验证正文完全相同后，把部署保护中的全文 SHA 更新为 `d1ab636b9b30827b7da94bd5bcf2db7ebdc5ce4cc38f82390a999ac3d9f22c8d`；未放宽保护条件或修改产品条款。

## 检查与执行

依据[快速部署流程](release.md)及[vNext 已授权执行边界](../vnext-production-todo.md#用户已确认的执行边界2026-09-05)，复用同日已完成的[旁白修复验证](../receipts/narration-strict-generation-20260914.md)和[日常功能验收](../receipts/daily-gameplay-acceptance-20260914.md)，不重新执行全项目测试或 Lint。

| 操作 | 结果 |
| --- | --- |
| Wrangler 版本、`whoami`、部署/版本读取 | Wrangler 4.125.0；现有账号可用，exit 0 |
| 部署保护定向测试 | 3/3，通过正常候选、错误分支/来源/资源拒绝及 Git 检查 |
| `npm run typecheck` | exit 0 |
| `d1 migrations list DB --remote` | exit 0，无待执行迁移 |
| D1 只读房间绑定/创建日期聚合 | exit 0，范围见下节 |
| 指定冻结 SHA 的 `node cloudflare/verify-deploy-config.mjs` | 构建前与上传前均 exit 0 |
| `npm run build` | exit 0，仅一次 production build |
| `CI=1 DEPLOY_SOURCE_SHA=… npx wrangler deploy --message …` | exit 0，复用该构建，不重复 build |
| 发布后 `deployments list`、`versions view` | exit 0，新版本 100%；绑定、Secret 名称、compatibility 与 DO migration tag 与部署前一致 |
| 源码与产物指纹 | 1,146 个冻结文件、112 个构建产物在部署前后均不变 |
| `git diff --check` | 通过 |

资源仍为 `ROOMS/RoomDurableObject`、现有 `DB/zhuwei-dev`（`f5a448fd-4224-4e52-bafb-a84cb190b618`）、`AI`、`ASSETS`，DO migration 保持 `room-do-v1`。未执行远端 migration、Secrets 修改、新建资源或房间/归档删除。

## 现有房间与恢复边界

只读聚合发现 5 个 `play` 目录，均不匹配本候选当前工作流：

- 4 个旧代房间创建于 2026-08-25、08-27、08-31，属于上述 09-05 已明确允许退役的旧 0.4 范围；本次只保留记录，没有删除。
- 1 个 vNext 房间创建于 2026-09-08，workflow 字符串 SHA 为 `dcd38dff093f10dc4d32c440c1c53994e119b14dfef2bed2b88dd634a53b1c6f`。它正是[09-10 发布回执](vnext-recall-release-20260910.md)中已单独确认“接受这桌不能玩”的 ctx-v6 旧绑定，不能当作这次新获得的数据退役权限外推。

没有发现未获处置决定的新增 vNext 绑定房间。旧房没有被迁移成新工作流。新房将绑定候选的精确协议；若后续出现问题，应保留该协议与新数据进行前向修复，不能盲目回滚到不认识新数据的旧 Worker。

## 冒烟与限制

首次 Node 请求 `/`、`/login`、`/api/game` 均在取得 HTTP 响应前遇到 `ECONNRESET`。按流程换用 curl 复核 `/` 和 `/login` 一次，仍为连接重置（curl exit 35 / HTTP 000），随后停止。没有把传输层失败当作服务器 500，也未为此修改业务代码。

本次确认的是**部署完成、控制面流量生效**。页面可达性、登录建房、真实模型和连续游玩没有发布后成功证据。药水上下文、战斗提案、私人回忆引用、角色加入 `SQLITE_TOOBIG`、旁白出戏等已知限制仍按日常验收回执保留，没有因部署而改判已修复。

完整本机证据在 `.wrangler/quick-deploy-20260914/`：`source/` 为冻结 checkout，`source-manifest.json`、`build-manifest.json` 为指纹，`build.log`、`deploy.log`、`deployments-*.json`、`version-*.json`、`room-*.json`、`migrations-before.log`、`smoke*.json` 保存实际结果。目录不进入 Git，密钥未复制进快照或公开记录。
