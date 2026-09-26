# 隐蔽动作、旁观者反应与补选工具部署 — 2026-09-27

用户要求「跑一批真实批次验证一下补选信号，通过则推送并快速部署」。round144–145 两次运行通过后，推送 `cloudflare` 并部署现有 Worker `zhuwei`。没有远端 migration、Secrets 修改或新资源。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-27 02:19:35，Asia/Shanghai（`2026-09-26T18:19:35.209Z`） |
| Worker version | `725f58b2-ee21-4e26-825c-3f611c250f33` |
| Deployment | `5c19f369-8df6-4b8f-9bc8-92647beca818` |
| 原线上 version | `a9180f10-b83a-4cdd-9e39-fb29061feb75`（源码 `05c5009`，[上次部署](check-frequency-dc-budget-20260926.md)） |
| 部署源码 commit | `8239c42902aa20d89413c8b5c2d4ea3c48fa01ad` |

主工作区仍有另一个会话未提交的改动（OpenAI 提供方及其测试、一份未跟踪的故障记录），没有提交、部署或推送。检查与部署都在 `cloudflare` HEAD 的干净克隆上运行（`.wrangler/quick-deploy-20260927/source`，`npm ci` 后工作树 0 行差异）。

## 本次包含

自上次部署以来 `cloudflare` 上的 33 个提交（`05c5009..8239c42`）：

- 隐蔽动作与旁观者察觉（SPEC 0005 §6.2、SPEC 0016 §7.3；[ADR 0059](../../adr/0059-bystanders-notice-by-passive-perception-and-react-by-their-own-view.md)）：`concealedCheck` 裁决不填 DC，Rules 取主要对象的被动察觉定 DC，对其他在场 NPC 逐人比较；察觉者拿到私有感官证据；行动者的主张不说察觉结果。
- NPC 当场反应（SPEC 0006 §7；[ADR 0060](../../adr/0060-bystander-reactions-run-on-the-spot-and-lapse-on-failure.md)）：察觉者一次模型调用决定是否反应与如何反应，反应在同一请求内结算。
- NPC 按本人决定移动场景，桌面显示看得见的人的在场与状态（[ADR 0061](../../adr/0061-npcs-move-by-their-own-decision-and-the-table-shows-who-is-present.md)；另一会话的分支合并）。
- 注意档位由 Rules 按权威状态给默认，KP 只改有记录依据的例外（[ADR 0062](../../adr/0062-attention-tiers-default-from-state-and-change-only-with-a-cited-record.md)）；被动察觉只判定 NPC、只列能感知这一举动的人（[ADR 0063](../../adr/0063-passive-perception-compares-only-npcs-who-can-sense-the-act.md)）。
- 隐蔽动作后同一提案里对察觉者说话仍能提交；分支 `effects` 形状错误按下标报 `world-effect-contract`（`2933832`）。
- 裁决种类写进补选时按未选处理，读不出的补选按本次调用的表单失败结束，不再伪装成提供方超时（[ADR 0064](../../adr/0064-ruling-kinds-are-decision-values-and-a-selection-naming-one-is-read-without-it.md)）。
- 可补选轮的选择工具按补选呈现：写明已加载项、只枚举还能新增的 ID（`4ea651c`）；§7.2 与 2026-09-11 起的再发表单实现对齐（[ADR 0065](../../adr/0065-a-selection-repeated-without-addition-refills-the-form-instead-of-ending-the-action.md)，只改文档）。
- 提示词 v55–v62。工作流哈希变化，部署后尚未完成的行动按 ADR 0038 重新询问模型。

## 检查与执行

| 操作 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 1；219 处，比上次多 3 处，全在测试文件（`npc-movement.room.test.ts` 与 `npc-reaction.room.test.ts` 的 `no-explicit-any` 各 1、后者未用的 `Stub` 类型 1），其余 216 处与上次逐条相同；已另立后续任务 |
| `npm run build` | exit 0 |
| `node tests/run.mjs --suite node` | 1600/1604；4 个失败与上次部署逐名相同（`social-shape` 1 个、`private-lowering-diagnostics` 3 个）；上次偶发的 `delivery-confirmation` 这次通过 |
| `node tests/run.mjs --suite worker` | 361/365；4 个失败与上次部署逐名相同（`story-action.room` 3 个、`story-world-event.room` 1 个） |
| `node tools/gate.mjs --check` | exit 0；22 项请求体积持平（最高 `*all` 43,888） |
| `npm run spec:check` | 0 错误、7 条原有体积警告 |
| 真实 DeepSeek 批次 | round134–145，见各回执；本次部署前的 [round144–145](../receipts/vnext-round144-validation.md)：两次运行 17 次调用全部通过，唯一一次补选只列了新增项 |
| `npx wrangler whoami`、`deployments list --json` | exit 0；部署前 `a9180f10` 接收 100% 流量 |
| `d1 execute DB --remote`（读 `d1_migrations`） | exit 0；14 个，与本地 `drizzle/` 相同，`rows_written=0`；本次无 schema 或 migration 改动 |
| `DEPLOY_SOURCE_SHA=8239c42… npm run cf:deploy -- --message '…'` | exit 0；部署保护通过，构建一次，上传后生成新版本 |
| 部署后 `deployments list --json`、`versions view 725f58b2… --json` | exit 0；新版本接收 **100% 流量**，部署消息带完整源码 SHA；6 个绑定、compatibility 日期与标志、usage model、DO migration tag `room-do-v1` 与上一版本相同 |
| 冒烟（curl，每项 15 秒超时，不重试） | `GET /` 200、`GET /hall` 200 并显示登录提示、匿名 `POST /api/game` 401 |
| `npm run diagnose -- --at 2026-09-27T02:19:00+08:00 --minutes 6`（只读） | exit 0；只有 1 条记录，是冒烟的匿名 401（warn 级，`HTTP_AUTHENTICATION_REQUIRED`） |

## 推送

- 推送前读回：`cloudflare` 为 `2d7e39a9c4f2050414c50ae5ee03b64b52b2bcd0`，`main` 为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`；本地 HEAD `8239c42`，可快进。
- 3,544 行新增内容的密钥模式扫描没有命中。
- `git push origin cloudflare`（非 force）：exit 0，`2d7e39a..8239c42`。
- 推送后读回：`cloudflare` 与本地 HEAD 相同，`main` 仍为 `cf7dbdd`。本记录随后作为单独的文档提交推送。

## 交付范围

- **本地代码已验证**：见上表。
- **部署已完成**：控制面确认 `725f58b2` 接收 100% 流量，冒烟通过。
- **已推送**：`cloudflare` 快进到 `8239c42`，远端 `main` 未变。
- **线上效果未验证**：没有对生产环境发起模型调用；补选信号、隐蔽动作与反应的线上效果要等玩家下次在线上行动后看调用记录。
- **未解决**：补选与首轮多选用不上的类型（round144 的 `materializeItem`、145 的三项）；检定成功但缺库存操作（145）；无路径的诊断 `passage:authorized-open-connection-required`（145 第一稿）；测试文件里 3 处新增 lint。

本机证据在 `.wrangler/quick-deploy-20260927/`：`clone.log`、`npm-ci.log`、`typecheck.log`、`lint.log`、`build.log`、`node-suite.log`、`worker-suite.log`、`gate-check.log`、`spec-check.log`、`deployments-before.json`、`d1-migrations-before.json`、`push.log`、`deploy.log`、`deployments-after.json`、`version-725f58b2.json`、`version-a9180f10.json`、`smoke.log`、`diagnose.log`。
