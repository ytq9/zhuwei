# 发布、完整回归与远端操作

本文件只在用户本轮明确要求完整回归、发布、部署、远端 migration、Git push 或里程碑冻结时读取。`AGENTS.md` 的产品、权威、秘密与分支边界始终优先；普通开发交付不进入本流程。

## 协调与授权

协调代理是冻结候选、migration、部署、推送和执行日志的唯一负责人。远端 D1、Durable Object、Worker、Secrets 与 Git push 操作必须串行。

- 完整回归不授权部署、远端 migration 或 push。
- “发布”或“部署”只授权在冻结门通过后更新现有 Worker `zhuwei` 及其既有绑定，不授权创建新 Worker、D1、KV、R2、队列或其他资源。
- 远端 migration、Secret 变更和 Git push 分别需要用户在当前任务中明确授权；不得从“完成”或“发布准备”推断。
- 登录通过 `npx wrangler whoami` 与用户浏览器完成，不索取或记录 API Token。Secret 只通过 `wrangler secret` 管理，不读取或写入仓库。

## 冻结候选

先完成代码审查、影响分析和全部定向修复，再形成冻结候选。冻结门按包含关系去重：

- 非部署的完整回归或里程碑冻结：运行一次 `npm run typecheck`、`npm run lint`、`npm test`；`npm test` 已包含 production build。
- 正式部署：运行一次 `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run test:worker`，再由获授权的 `npm run cf:deploy` 完成唯一一次 production build 和部署。
- 正式部署尚未获授权但需要冻结证据：用一次 `npm run build` 代替部署命令。
- 仅在依赖未安装或 lockfile/manifest 变化时运行 `npm ci`。

全量检查失败后，定向复现失败用例，集中完成本轮实现、审查和修复，再统一重跑最终门；不在每个小修后重复整套检查。

冻结门通过后的补丁先做失效分析。只有影响能限定在一个可界定因果切片、公共与权威边界均未变化，并且改动行为、直接消费者及最高风险相邻路径通过时，才能用“此前冻结门 + 增量证据”构成最终发布证据。依赖、构建/测试配置、公共 API、规则权威、身份权限、秘密、状态持久化或 schema/migration 变化，或影响无法界定时，形成新冻结候选并重跑冻结门。仅执行日志或说明性文档变化不使代码验证失效。

## D1 与部署前检查

- schema 以 `db/schema.ts` 为源；运行 `npm run db:generate` 并逐行检查新增 SQL，已生成 migration 只增不改。
- 远端操作前只读确认账号、现有 Worker、`wrangler.jsonc`、既有 D1 `DB`、Durable Object migration 与当前部署版本。
- `wrangler.jsonc` 必须仍指向现有 Worker `zhuwei` 和现有数据库；不得引入 Sites、Vercel、`.vercel/output`、新 Worker 或新持久化资源。
- 获得远端 migration 授权后，只对现有 `DB` 应用待处理 migration，并复查状态；用最小写入—读取闭环证明目标环境。
- 部署只从已记录的冻结源码状态运行。推送使用非 force 方式，并证明远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`。

## 发布后检查

用一个代表性入口做最小冒烟，并通过 Cloudflare deployment/version 状态确认新版本接收预期流量。

若请求在到达 Worker 前发生 DNS、TCP 或本地网络超时，只换一个独立通道复核一次；仍不可达时停止，记录传输层限制，不修改业务代码。外部 AI 只使用生产默认组合做一次代表性探针；边界仍不清时追加一次对照，随后停止。

## 完成与回执

分别报告：

- **本地代码已验证**：冻结或增量证据实际通过。
- **部署已完成**：控制面确认目标版本已接收预期流量。
- **外部能力已恢复**：只有代表性生产探针成功时才能声明；失败时写“安全失败路径已验证，外部能力未恢复”及恢复条件。

正式发布还必须满足：

- 源码与部署源码一致，相关检查通过；
- D1 migration 状态清楚，Worker 与绑定仍是既有目标；
- Git push 只在已获单独授权时执行；若执行，使用非 force 方式并证明远端 `main` SHA 不变；未获授权时记录未执行，不阻碍已授权部署的完成；
- 执行日志记录实际命令/退出码、冻结或部署版本、migration、commit、外部操作和剩余限制，不把未执行项写成已验证。
