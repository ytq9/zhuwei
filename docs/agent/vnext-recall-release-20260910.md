# 选择阶段召回的生产发布（2026-09-10）

本次授权是「下一步推送部署」，并在确认影响后由用户明确「继续部署，接受这桌不能玩」——保留记录，不删除房间。

## 发布对象

- 源码 `3131fefc4c2465232a2c30b85671b073ba405a3b`（`add92b1` 选择阶段召回 + `3131fef` round101–103 回执），父提交为另一会话审查后的 `229993a`。
- `git push origin HEAD:cloudflare` exit 0，快进；读回远端 `cloudflare` = `3131fef…`，`main` 仍为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，未改动。
- 部署前工作树干净（0 项待提交）。

## 前置核对

| 项 | 结果 |
| --- | --- |
| `DEPLOY_SOURCE_SHA=3131fef… node cloudflare/verify-deploy-config.mjs` | exit 0，`{"ok":true,"branch":"cloudflare"}` |
| `npm run build` | exit 0 |
| 远端 D1 待执行迁移 | 无：已应用到 id=14 / `0013_smiling_shinobi_shaw.sql`，仓库最后一份迁移也是 0013 |
| 新增资源 / Secrets | 无 |

## 现役房间影响（部署前只读核对）

线上跑的是 `0c26a3d`，其工作流清单 `contextRepresentation` 为 `zhuwei.proposal-context/vnext-6`；候选为 `vnext-8`，因此 `VNEXT_KP_WORKFLOW_MANIFEST_JSON` 改变。房间在建桌时冻结清单字符串，`roomRuntimeConfiguration().hasWorkflow` 只接受与当前完全一致的清单。

部署前 `rooms` 表（只读查询，status=play）：

| 冻结清单 | 数量 | 部署后 |
| --- | --- | --- |
| V3 工作流（`other`） | 4 | 不受影响，V3 注册未改 |
| 无清单（`none`） | 3 | 部署前就已不可玩 |
| vNext `ctx-v6` | 1 | **不可继续游玩**，提示「本桌的 V3 工作流或 Context Planner Profile 已不可用」 |

AGENTS.md 的旧房退役授权明确不包括 vNext 之后新建的房间，因此这 1 个桌单独征询并获得用户批准。**没有执行任何删除**：部署后读回 `rooms`，三类分布与部署前完全一致（4 / 3 / 1），房间与记录均保留。

## 部署与冒烟

- `CI=1 DEPLOY_SOURCE_SHA=3131fef… npx wrangler deploy` exit 0。绑定不变：ROOMS(RoomDurableObject)、DB(zhuwei-dev)、AI、ASSETS。上传 4,572.32 KiB / gzip 1,253.54 KiB，Worker 启动 246 ms。
- 控制面：version `78efe99f-dfb2-4245-b821-1b93786aa7a9`，创建于 `2026-09-10T04:26:26Z`，deployment `2026-09-10T04:26:29Z` 承接 100% 流量。上一版本为 `27afcd14-fa83-494f-b84c-0516e89cc8b2`（源码 `0c26a3d`）。
- 最小冒烟：`https://zhuwei.yinskyriver.workers.dev/` 与 `/login` 均 HTTP 200（1.3 秒），首页返回 `<title>烛帷｜AI 主持的多人 D&D 跑团</title>`。

## 未覆盖

- 未做真实游玩验收：新版本的召回改动在生产上没有跑过任何一句玩家意图。本地证据见 [round102 回执](vnext-round102-validation.md)，其中第三句「去账台看副本」在真实批次上仍未覆盖。
- 未跑全量回归、lint、浏览器验收；既有基线红（provider-room 13 等）未变，见 [执行日志](../refactor-log.md) 同日条目。
- 未执行迁移（无待执行项）、未改 Secrets、未新增资源、未删除任何房间或归档、未改动 `main`。
