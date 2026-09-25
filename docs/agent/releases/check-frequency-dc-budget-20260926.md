# 检定频率、DC 区间与输入上限部署 — 2026-09-26

用户对「上限改为 96,000 窗口」回答「可以，两个问题都改吧，改完上线」。本次部署现有 Worker `zhuwei`。用户这次只说了上线，没有授权推送，所以没有执行 Git push。没有远端 migration、Secrets 修改或新建资源。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 部署时间 | 2026-09-26 02:28:49，Asia/Shanghai（`2026-09-25T18:28:49.375194Z`） |
| Worker version | `a9180f10-b83a-4cdd-9e39-fb29061feb75` |
| Deployment | `1cf42703-d0cf-4d6e-bf58-67e18ba22665` |
| 原线上 version | `caca5af2-d8a0-4a9f-828c-56ada5530081`（源码 `f73716d`，[上次部署](hash-comparison-removal-20260925.md)） |
| 部署源码 commit | `05c5009fc5374f7235dfa2cab2ecd3145047b721` |

主工作区仍有另一个会话未提交的改动（Luna 兼容修复及其测试、一份未跟踪的故障记录），没有提交、部署或推送。检查与部署都在 `cloudflare` HEAD 的干净克隆上运行（`.wrangler/quick-deploy-20260925d/source`）。

## 本次包含

运行时代码只改两个文件：提示词（`proposal-guidance.ts`）和预算配置（`runtime-policy.ts`）。

- 提示词 v49–v54：结果确实不定且失败有意义才检定，问话和寻常交谈不掷骰；瞒着旁人的举动或话要检定；DC 按 5e 区间取值（很容易 1-5 … 几乎不可能 26-30），具体数值看行动本身和当前情境；补选只加原意图某一步必须用的类型。验证见 [round126](../receipts/vnext-round126-validation.md)、[round127–130](../receipts/vnext-round127-validation.md)、[round131](../receipts/vnext-round131-validation.md)、[round132–133](../receipts/vnext-round132-validation.md)。
- [ADR 0058](../../adr/0058-proposal-input-allowance-is-90000.md)：房间模型调用的输入上限从 58,000 调到 90,000（估算）。
- [ADR 0057](../../adr/0057-request-size-may-grow-for-a-feature-the-user-was-told-about.md)：提示词可以为告知过的功能增长；`tools/gate.mjs --accept-request-size`。
- 探针在比较重试前先等房间定时器上没有排着的到期任务（只改测试工具）。

提示词与预算哈希都进了工作流哈希，部署后尚未完成的行动按 ADR 0038 重新询问模型。

## 检查与执行

| 操作 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 1；216 处、去重 151 条，与上次部署逐条相同，出现次数也相同 |
| `npm run build` | exit 0 |
| `node tests/run.mjs --suite node` | 1572/1577；5 个失败与上次部署逐名相同（`social-shape` 1 个、`private-lowering-diagnostics` 3 个、全量中偶发的 `delivery-confirmation` 1 个，后者单独重跑 11/11） |
| `node tests/run.mjs --suite worker` | 358/362；4 个失败与上次部署逐名相同（`story-action.room` 3 个、`story-world-event.room` 1 个） |
| `node tools/gate.mjs --check` | exit 0；22 项请求体积持平（最高 `*all` 42,815） |
| `npm run spec:check` | 0 错误、7 条原有体积警告 |
| 真实 DeepSeek 批次 | round126–133 共 79 次调用，结果与失败见各回执 |
| `npx wrangler whoami`、`deployments list --json` | exit 0；部署前 `caca5af2` 接收 100% 流量 |
| `d1 execute DB --remote`（读 `d1_migrations`） | exit 0；14 个，与本地相同，`rows_written=0`；本次无 schema 或 migration 改动 |
| `DEPLOY_SOURCE_SHA=05c5009… npm run cf:deploy -- --message '…'` | exit 0；部署保护通过，构建一次，上传后生成新版本 |
| 部署后 `deployments list --json`、`versions view a9180f10… --json` | exit 0；新版本接收 **100% 流量**，部署消息带完整源码 SHA；6 个绑定、compatibility 日期与标志、DO migration tag `room-do-v1` 与上一版本相同 |
| 冒烟（curl，每项 15 秒超时，不重试） | `GET /` 200、`GET /hall` 200 并显示登录提示、匿名 `POST /api/game` 401 |
| `npm run diagnose -- --at 2026-09-26T02:30:00+08:00 --minutes 6`（只读） | exit 0；第一次查询时日志尚未入库；约一分钟后复查只有 1 条记录，是冒烟的匿名 401（warn 级，`HTTP_AUTHENTICATION_REQUIRED`） |

## 推送

未执行：用户本轮只授权上线。本地 `cloudflare` 比远端 `2d7e39a` 多 15 个提交，可快进；远端 `main` 为 `cf7dbdd`，未改动。

## 交付范围

- **本地代码已验证**：见上表。
- **部署已完成**：控制面确认 `a9180f10` 接收 100% 流量，冒烟通过。
- **线上效果未验证**：没有对生产环境发起模型调用；检定频率、DC 与上限的效果要等玩家下次在线上行动后看调用记录。
- **未解决**：补选仍可能加入用不上的表单和旁观 NPC 视图（round133 一次），上限提高后不再因此被拒，但会多花约 13k token，一次还出现了不可修订的重复 JSON 键。已另立后续任务。

本机证据在 `.wrangler/quick-deploy-20260926/`：`typecheck.log`、`lint.log`、`build.log`、`node-suite.log`、`delivery-confirmation-rerun.log`、`worker-suite.log`、`gate-check.log`、`spec-check.log`、`deploy.log`、`deployments-*.json`、`version-after.json`、`d1-migrations-before.json`、`remote-heads.txt`、`smoke*`、`observability-after.*`。目录不进 Git。
