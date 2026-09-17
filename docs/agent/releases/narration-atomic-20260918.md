# 自然语言旁白与未交付结果取消：快速部署

2026-09-18，用户明确要求“快速部署”。按项目快速发布流程，以本轮定向验收、审查、类型检查和一次生产构建更新既有 Worker `zhuwei`。实现和测试证据见[开发验收](../receipts/narration-atomic-20260917.md)，产品决定见 [ADR 0026](../../adr/0026-provisional-results-and-natural-narration.md)。

## 发布对象与源码

| 项目 | 实际值 |
| --- | --- |
| 入口 | https://zhuwei.yinskyriver.workers.dev |
| 生效时间 | 2026-09-18 00:46:39，Asia/Shanghai |
| 原线上版本 | `86045f87-30d1-4e7f-b0e3-5ea5528b9806` |
| 新 Worker version | `44da10f4-8bea-4fa7-92d5-cb9fb5550252` |
| Deployment | `ec026495-104b-48b8-ab8a-1dcf695877f8` |
| 冻结源码 | `07418f91d97af0daf84ed272946b2b67d1526f4c` |
| 冻结 tree | `86c6d6c85797d7dadd706a22ac96a23838dc4750` |
| 流量 | 控制面确认新版本 100% |

以上次实际部署源码 `6534f7ccc440eaee4cba7bd7dec17d9b8f514cb5` 为父提交建立独立、干净的本地 `cloudflare` checkout。差量为本轮实现、测试、规格和历史回执，共 35 个文件；其余源码保持原线上内容，包括已上线提案显式恢复。1193 个源码文件逐字匹配主工作区，112 个构建文件在上传前后 SHA256 一致。主工作区 HEAD 和 index 未变化，本地快照未 push。

新 vNext 冻结 Claims 回复采用自然语言正文和简短实质审核，至多一次修稿与复审。候选机械结果、因果相连的 Activity 开始和自动时间推进在所有受众回复就绪后一起提交；终止失败或恢复截止会取消未交付候选，保留已固定骰面和调用证据。旧已提交回复及 observer-projection 兼容协议继续按原恢复合同解释，历史故障已提交数据未自动更正。

## 实际检查与命令

- 复用本轮同一生产源码的 38 项 Room、16 项 Node、`npm run typecheck` 通过证据；晚到响应夹具修正后的单项通过与原 37 项通过合并记账，未称整组重跑通过。SPEC 检查 0 错误、8 个既有警告；7 条既有文档失效链接未新增。证据文件 SHA256 随发布保存。
- 候选 `git diff --cached --check`、构建前与上传前部署 guard 均 exit 0。
- `npm run build` 一次，exit 0；没有重复运行完整测试或全项目 Lint。
- `wrangler whoami --json` 确认既有账户；两次上传前 `deployments status` 均为原线上版本。
- `wrangler d1 migrations list DB --remote` exit 0，无待处理迁移，只读查询。
- guard、构建、上传串行执行；上传命令 exit 0：

```sh
CI=1 DEPLOY_SOURCE_SHA=07418f91d97af0daf84ed272946b2b67d1526f4c \
node cloudflare/verify-deploy-config.mjs

CI=1 HTTPS_PROXY=http://127.0.0.1:7897 WRANGLER_SEND_METRICS=false \
DEPLOY_SOURCE_SHA=07418f91d97af0daf84ed272946b2b67d1526f4c \
npx wrangler deploy --message \
'Natural narration and atomic outcome cancellation; source 07418f91d97af0daf84ed272946b2b67d1526f4c'
```

部署后 `deployments status` / `versions view` 均 exit 0，确认新版本 100% 流量。`AI`、`ASSETS`、`DB`、`ROOMS` 和既有 Secret 绑定与前版本逐项相等，DO namespace 与 `room-do-v1` migration tag 保持。没有 D1 migration、Secret 修改或新建资源。Room 构造器中的 SQLite 增表和 CHECK 扩展随新版按需执行，本地旧表恢复写读已验收；本次匿名页面冒烟没有声称验证线上房间升级。

## 线上冒烟与恢复边界

匿名 `GET /table/A48CY8` 返回 HTTP 200 与“先登录，再入座”；`table-client-anTncd1U.js` 返回 HTTP 200，SHA256 `ca2b594f4af778c0177f94a30e30ef439d30b4ca972107f856d38abc8550b722` 与冻结构建一致，包含原提案恢复标志及新的行动取消提示。没有重放玩家行动或触发模型调用；真实模型审核准确性、速度及完整行动成功仍未在线复验。

新候选状态和归档宿主版本不能交给旧代码解释。出现发布问题时优先在本冻结源码上前向修复；只有确认旧版本不会接触新候选或新宿主数据并验证解释/恢复兼容后，才可选择代码回退。保留本地新旧源码及控制面版本供核对，不通过删除候选、调用账本或历史事件恢复服务。

只读检查发现远端 `main` 实际为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，与文档历史保护值 `29eb06dc009c983ad61b2d862454503e67a7f40a` 不同。发布前后实际 SHA 一致，本次未 push、未修改远端分支，也未将文档历史值记为已匹配。

冻结 checkout、源码/构建清单、证据清单、构建和部署日志、控制面结果及 HTTP 冒烟保存在本地忽略目录 `.wrangler/narration-atomic-release-20260918/`。只在主工作区新增本发布记录，未改写原事故证据。
