# 2026-09-20 V5 归档推送

## 授权与范围

用户于 2026-09-20 明确授权推送 110 个提交到 `origin/cloudflare`。只推送，不部署、不做远端 migration、不改 Secrets、不创建远端资源。

## Git 处置

| | |
| --- | --- |
| 推送前 `origin/cloudflare` | `9fa76d8d027754f3b1770be2ac4b91a52506d6b7` |
| 推送后 `origin/cloudflare` | `e0706d1` |
| 提交数 | 110 |
| 方式 | `git push origin cloudflare`，非 force，快进（`git merge-base --is-ancestor origin/cloudflare HEAD` 通过） |
| 推送前 `origin/main` | `cf7dbddab8cfb36365734fe96c42d82456fa1d0e` |
| 推送后 `origin/main` | `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`（未变） |

远端 `main` 不等于 [发布流程](./release.md) 原先写的 `29eb06dc009c983ad61b2d862454503e67a7f40a`。核实结果：`29eb06dc` 是 `cf7dbdd` 的祖先，两者相差一个提交——`cf7dbdd「Fix: KP 说人话，发言不再每拍报错」`，作者 `ytq9`，日期 2026-09-01。该差异 [2026-09-10 的推送记录](./push-review-20260910.md)已经记过一次；本次同样不追溯或改写 main，并把发布流程里那个过期常量改成当前事实，以免第三次重新发现。

## 推送内容

主体是 [ADR 0034](../../adr/0034-remove-the-v5-private-form-proposal-path.md) 的 V5 私有 Form 提案路径归档，以及此前累积的未推送工作。归档部分 102 文件、489 增、37,402 删。

## 验证

推送前在同一源码状态（`e0706d1`）下运行：

- 完整 Worker 套件 `npm run test:worker`：**45/45 文件、341/341 用例通过**，exit 0，474s。这是本轮最重要的一项——归档动了 Durable Object、Rules 分派链、`answerPendingInput`、事件折叠、Viewer 投影、更正效果与 telemetry，而 45 个 Worker 文件里只有 24 个是声明的门，另外 21 个 CI 从不跑。
- `node tools/gate.mjs --check --with-gates`：八项指标全部持平，**54 个声明的门全绿**，exit 0。
- `node tools/gate.mjs --check --with-tests`：八项指标持平，`tests.unitFailures 0 = 0`，exit 0。
- `npm run typecheck`：exit 0。
- `npm run spec:check`：0 错误、7 警告（全部为既有的单份字数超预算）。
- `node tools/check-doc-links.mjs`：断链 0，扫描 303 份 Markdown。

## 未执行与剩余限制

- 未运行 `npm test`、全项目 Lint、production build、`npm run test:http`。本次授权只有推送，不是发布冻结，因此不适用[发布流程](./release.md)的冻结门。
- 未部署、未做远端 migration、未改 Secrets、未创建远端资源。
- **未跑真实 DeepSeek 批次。** 本地绿证明的是类型与已声明行为，不是真实模型路径。归档改了现役 telemetry 的两处行为（`formId` 白名单换成 vNext 词汇、诊断字段脱敏白名单收缩），这类改动只有真实批次能证明。用户已于同日批准一次有界批次，尚未执行。
- 深 Module 边界 148 处违规仍在棘轮里，用户已裁定走方案 (b)，尚未实施。
- vNext 提案请求体积仍无离线门，用户已裁定进棘轮只降不升，尚未实施。
