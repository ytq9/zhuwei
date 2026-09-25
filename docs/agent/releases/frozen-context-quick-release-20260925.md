# 冻结上下文压缩快速部署 — 2026-09-25

用户本轮要求「快速提交部署一下」。按[发布流程](release.md)的快速部署例外，用定向检查、类型检查、规格门和部署命令自带的构建代替全量测试与 Lint。部署后用户另行要求「推送」，推送见下文；没有远端 migration、Secrets 修改或新建资源。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-25 13:43:59，Asia/Shanghai（`2026-09-25T05:43:59.822928Z`） |
| Worker version | `2657dd1c-7d3f-4ead-aad1-b6a20b6cddb0` |
| Deployment | `701d4c51-f4eb-47ea-86d5-349aa5128764` |
| 原线上 version | `59527e60-112a-49bc-af74-1e3f7df3e846`（源码 `4fa3325f1b4bec6a2e39c72b80fd0c2f9678286f`，[09-24 发布](gpt-6-luna-quick-release-20260924.md)） |
| 部署源码 commit | `61003c04a3ef7825a8b87780287a3a393a3731db` |
| 部署源码 tree | `bcc35a7aeef983e3ae87424a6b9ca25d802b4007` |

## 部署源码

主工作区有另一个会话未提交的改动：Luna 空列表约束兼容修复（`app/_runtime/lib/kp/openai.ts`、`app/_runtime/lib/kp/vnext/runtime-policy.ts` 及两份测试）和未跟踪的故障记录 `docs/agent/receipts/incident-muf0q31y-20260924.md`。它们不属于本次提交，没有提交，也没有部署。

部署从本地 `cloudflare` 分支 HEAD 的克隆运行（`.wrangler/quick-deploy-20260925/source`，1,193 个跟踪文件，工作树干净，`node_modules` 链接到主工作区）。主工作区的分支、暂存区和未提交改动都没有动。

`4fa3325..61003c0` 共 31 个提交：检定步骤分组与命名（ADR 0041、0042）、冻结上下文放进 system 消息（ADR 0043、0044）、填写指引去掉审核标准（ADR 0045）、房间在工作流版本变化时保留模型（ADR 0046）、归档按记录接受旧版本的工作（ADR 0047）、上下文压缩（ADR 0048–0053）。`drizzle/`、`db/`、`wrangler.jsonc`、`cloudflare/`、`package.json` 和 lockfile 都没有变化。

## 检查与执行

区间内各提交在开发时跑了各自的定向测试。真实调用证据：[round119](../receipts/vnext-round119-validation.md)、[round120–121](../receipts/vnext-round120-validation.md)、[round122](../receipts/vnext-round122-validation.md)、[round123](../receipts/vnext-round123-validation.md) 覆盖 09-24 的检定和上下文排列改动；[round124](../receipts/vnext-round124-validation.md)（`6c8ce9e`）和 [round125](../receipts/vnext-round125-validation.md)（`66abdbf`，4 次调用通过）覆盖本轮的压缩改动。`61003c0` 只加了 round125 回执。下面是在部署源码上实际运行的命令，均为一次：

| 操作 | 结果 |
| --- | --- |
| `npx wrangler whoami` | exit 0；账号 `Yinskyriver@gmail.com's Account`（`7aca31eae821510ea477022b0c0e0e91`），Wrangler 4.125.0 |
| `npx wrangler deployments list --json`、`versions view 59527e60… --json` | exit 0；部署前 `59527e60` 接收 100% 流量 |
| `npx wrangler d1 execute DB --remote --command 'SELECT name FROM d1_migrations ORDER BY id' --json` | exit 0；已应用 `0000`–`0013` 共 14 个，与本地 `drizzle/` 相同，`rows_written=0`，无待执行 migration |
| 只读房间聚合（D1 `rooms` 按状态、Profile、workflowRef 分组） | exit 0，`rows_written=0`，见下节 |
| 房间绑定输入对照（`4fa3325` 与 `61003c0` 各自用 tsx 打印） | 完全相同，见下节 |
| `npm run typecheck` | exit 0 |
| `npm run gates:check` | exit 0；spec 错误 0、断链 0、模块边界与请求大小（22 项，最高 42,770）均与基线持平；声明的门 60 个测试文件全绿；1 个 HTTP 门需要构建产物、3 个工具门不在此运行 |
| `DEPLOY_SOURCE_SHA=61003c0… npm run cf:deploy -- --message '…; source 61003c0…'` | exit 0；部署保护通过（`cloudflare`、工作树干净、SHA 与 HEAD 相同），production build 一次，上传后生成新版本 |
| 部署后 `deployments list --json`、`versions view 2657dd1c… --json` | exit 0；新版本接收 **100% 流量**，部署消息带完整源码 SHA；绑定（`AI`、`ASSETS`、`DB`、`ROOMS`、两个 `secret_text`）、compatibility 日期与 flags、DO migration tag `room-do-v1` 与部署前完全相同 |
| 部署后部署源码 `git status` 与 HEAD | 仍干净，仍为 `61003c0` |

门检查另提示 2 项尚无基线记录；它们当前是绿的，本次没有更新基线。开发时定向运行见到的既有失败（social-shape 1 例、private-lowering-diagnostics 3 例、story-action.room 3 例、story-world-event.room 1 例）在本轮改动前后相同，不在声明的门里，本次没有处理。

## 已有房间

房间绑定核对的输入在 `4fa3325` 和 `61003c0` 完全相同：运行时 Profile 清单、规则集版本 `dnd5e-2014-srd5.1-authoritative-v2`、模组版本 `social-resolution-v1`，以及两套配置（`deepseek-v4-flash`、`gpt-6-luna`）各自的 workflowRef、KP Profile 和旁白 Profile。所以现在能绑定的房间部署后仍能绑定；ADR 0046 之后，只差版本字段的旧房间也能绑定。

只读聚合（`rows_written=0`）：

| 状态 | Profile | 数量 | 创建时间（UTC） |
| --- | --- | --- | --- |
| play | `authoritative-kp-profile-v1` | 2 | 08-25 |
| play | `authoritative-kp-deepseek-v4-pro-v1` | 1 | 08-27 |
| play | `authoritative-kp-deepseek-v4-flash-private-tools-v2` | 1 | 08-31 |
| play | `authoritative-kp-deepseek-vnext-local-v1` | 1 | 09-08 |
| play | `authoritative-kp-gpt-6-luna-vnext-v1` | 1 | 09-24 04:12 |
| lobby | `authoritative-kp-deepseek-vnext-local-v1` | 1 | 09-24 13:44 |

前四间是已退役的旧代房间（ADR 0028）。09-08 那间是 [09-10 回执](vnext-recall-release-20260910.md)里用户已接受不能再玩的旧绑定。09-24 的 Luna 房间就是故障 `ZW-muf0q31y` 那一桌：它的修复在另一个会话的未提交改动里，本次没有带上。按故障原因推断，这桌再做同类行动时第二阶段仍会失败；线上没有验证。

已提交事件的重放：NPC 决策视图按事件里存的版本重建（ADR 0050），旧事件的 vnext-1 视图输出不变；旧的冻结上下文和完整投影照样可用（ADR 0051、0052）。线上房间在新版本下的实际加载没有验证。

## 冒烟

对入口做一次有界请求（curl，每项 15 秒超时，不重试），三项都带 Cloudflare Ray 标识：

| 请求 | 结果 |
| --- | --- |
| `GET /` | 200，25,225 字节，标题「烛帷｜AI 主持的多人 D&D 跑团」 |
| `GET /hall`（匿名） | 200，15,580 字节，显示「先登录，再入座」 |
| `POST /api/game`，`listMyRooms`（匿名） | 401，`{"error":"请先登录。"}` |

## 推送

部署完成后用户要求「推送」。

- 推送前 `git ls-remote origin refs/heads/main refs/heads/cloudflare`：exit 0；`cloudflare` 为 `22a010c3cd6797da3025c1693d4bf9d250ddbe48`，`main` 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`。
- `22a010c` 是本地 HEAD 的祖先，可快进；31 个待推送提交的新增行做了密钥模式扫描，没有命中，也没有 `.dev.vars`、`.env` 一类文件。
- `git push origin cloudflare`（非 force）：exit 0，`22a010c..60878c9`。
- 推送后读回：`cloudflare` 为 `60878c996024720a7150ec9e5b6e066fb1eae985`，与本地 HEAD 相同；`main` 仍为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，与推送前相同。
- 另一个会话未提交的改动不在任何提交里，没有被推送。本记录的这次更新随后作为单独的文档提交推送。

## 交付范围

- **本地代码已验证**：部署源码上 typecheck 和 gates:check 实际通过；各提交的定向测试和 round124、round125 两批真实调用在开发时通过。未跑全量测试和 Lint。
- **部署已完成**：控制面确认 `2657dd1c` 接收 100% 流量，绑定与部署前相同，代表性入口冒烟通过。
- **外部能力未声明**：没有对生产环境发起模型调用，没有在线上房间游玩。按编号调取、超过六轮的长对话在真实调用里都还没有触发（见 round125 回执）。
- **已推送**：`cloudflare` 已快进到 `60878c9`，远端 `main` 未变，见上节。

本机证据在 `.wrangler/quick-deploy-20260925/`：`source/` 是部署用的克隆，`typecheck.log`、`gates-check.log`、`deploy.log`、`deployments-*.json`、`version-*.json`、`d1-migrations-before.json`、`rooms-before.json`、`manifest-*.json`、`smoke*` 保存实际结果。目录不进 Git，没有复制任何密钥。
