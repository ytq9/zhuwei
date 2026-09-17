# 未知提案显式恢复快速部署

2026-09-16，用户在恢复修复完成后明确要求“快速部署”。本次按定向验收、类型检查、必要 production build 和部署保护更新现有 Worker `zhuwei`；保留完整回归未通过的事实。产品决定见 [ADR 0025](../../adr/0025-explicit-proposal-invocation-recovery.md)，实现与定向证据见[修复验收](../receipts/incident-mu3qdzkw-recovery-20260916.md)。

## 发布对象与源码

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 生效时间 | 2026-09-16 15:51:44，Asia/Shanghai |
| 原线上版本 | `c4fad104-31f0-43b5-a952-2276c54f093f` |
| 新 Worker version | `86045f87-30d1-4e7f-b0e3-5ea5528b9806` |
| Deployment | `90e042f2-de4c-499f-8790-0a651def93c9` |
| 冻结源码 | `6534f7ccc440eaee4cba7bd7dec17d9b8f514cb5` |
| 冻结 tree | `3b6ad607edc79a68452158ee3cf51144857442f5` |
| 流量 | 控制面确认新版本 100% |

以上次实际部署源码 `c23b11e155847cb7d3cfd5cc70bb96bae8fdd722` 为父提交建立独立、干净的本地 `cloudflare` checkout。与主工作区逐文件对照，差量共 43 个文件：本次恢复与诊断查询修复、测试、规格、导航及已存在的历史回执。其余源码与原线上一致。1184 个源码文件逐字匹配主工作区，构建产物 112 个；上传前后源码及构建 SHA256 清单均未漂移。主工作区 HEAD 和 index 的 SHA256 保持不变，本地快照没有 push。

本次保留已上线诊断功能，并加入原来源根行动至多一次的显式提案恢复、旧响应隔离、并发去重、预算保留及明确终止状态。保持模型、Prompt、45 秒时限与既有数据库结构。归档宿主 v2 支持替补关系并继续读取 v1；不执行远端 migration。

## 实际检查与命令

- 复用同一源码的恢复 Worker 定向 16 项、终止分类补充 1 项、UI/诊断 Node 19 项及既有归档 Node 9 项通过证据；最终类型检查通过。SPEC 检查 0 错误、8 个已记录警告。证据文件的 SHA256 清单随部署保存。
- 候选 `git diff HEAD^ HEAD --check`、构建前与上传前的部署 guard 均 exit 0。
- `npm run build` 一次，exit 0；未重复构建或重新运行全量测试/Lint。
- `wrangler whoami --json` 确认既有账户和部署身份；上传前两次控制面状态均为上述原线上版本。
- `wrangler d1 migrations list DB --remote` exit 0，无待处理迁移，仅查询。
- 部署命令 exit 0：

```sh
CI=1 DEPLOY_SOURCE_SHA=6534f7ccc440eaee4cba7bd7dec17d9b8f514cb5 \
node cloudflare/verify-deploy-config.mjs

CI=1 HTTPS_PROXY=http://127.0.0.1:7897 WRANGLER_SEND_METRICS=false \
DEPLOY_SOURCE_SHA=6534f7ccc440eaee4cba7bd7dec17d9b8f514cb5 \
npx wrangler deploy --message \
'Bounded explicit proposal recovery; source 6534f7ccc440eaee4cba7bd7dec17d9b8f514cb5'
```

部署后 `deployments status` / `versions view` 确认新版本接收全部流量。`AI`、`ASSETS`、`DB`、`ROOMS` 及既有 Secret 绑定与前版本逐项相等，DO migration 仍为 `room-do-v1`。

## 线上验收与限制

一次代表性页面冒烟：匿名 `GET /table/A48CY8` 返回 HTTP 200 与“先登录，再入座”；页面对应 `table-client-BQrNMYqy.js` 返回 HTTP 200，SHA256 与冻结构建逐字一致，包含新的显式恢复标志。未触发真实模型调用或重放玩家行动。A48CY8 的实际恢复仍需玩家刷新并点击重试，由 Room 根据当前资格判定；本次不声称 Provider 速度或真实行动完成已验证。

完整两个 Worker 文件此前为 55 通过、12 失败；12 项均在修复前源码独立对照复现，新增失败集合为空，详见修复验收。全仓文档另有 6 处既有失效 `handoff.md` 引用。本次没有运行完整项目回归，也没有把这些问题记为通过。

没有 Git push、远端 migration、Secret 修改或新建资源，远端 `main` 未被本次操作修改。冻结 checkout、源码/构建清单、命令输出、控制面核对与页面冒烟证据保存在本地忽略目录 `.wrangler/proposal-recovery-release-20260916/`；只将本回执加入主工作区，不改写既有事故回执。
