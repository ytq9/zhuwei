# 烛帷 Cloudflare Worker 代理合同

本分支是私有 GitHub 项目 `ytq9/zhuwei` 的 **等价 Cloudflare 迁移**。产品基线为 `main` 提交 `29eb06dc009c983ad61b2d862454503e67a7f40a`；GitHub 上游是行为、中文文案、规则和视觉的唯一权威。只在 `cloudflare` 分支工作，保持 `main` 与 grok.me 部署不变。

## 通用规则 v2

用户已批准在 `cloudflare` 分支演进通用规则与房间协调架构。上游仍是未涉及能力和中文文案的基线；`app/_runtime/lib/rules/`、模组结构化世界定义、虚构时间、AI 意图/叙述接缝及 Room Durable Object 是本分支的权威扩展，不得为追求逐行等价而移除。规则机械只采用 SRD 5.1 / D&D 5e 2014；房间通过 `ruleset_version` 固定版本，禁止混入 2024/5.5e。保持远端 `main` 不变，新规则只通过版本化房间启用。

修改通用规则前先读根目录 `CONTEXT.md` 与 `docs/adr/`。规则测试统一穿过 `step` / `project` 接口；生产编排不得建立第二套裁决路径。新增 Durable Object 代码和本地 Wrangler migration 属于开发范围，远程创建、迁移或发布仍须用户明确确认。

## 平台边界

迁移只替换平台接缝：

- TanStack/Vercel Node 入口 → Vinext App Router 与 Cloudflare ESM Worker；
- Better Auth/GPT Sites 身份 → D1 + Web Crypto 邮箱密码会话；
- PGLite/Postgres → 现有 Cloudflare D1，绑定名 `DB`；
- Node 运行时 API → Worker Web API。

目标是现有 Worker `zhuwei` 和 `https://zhuwei.yinskyriver.workers.dev`。`wrangler.jsonc` 是唯一部署配置。Sites、Vercel、`.vercel/output`、新 Worker 和新持久化资源不属于交付路径。

## 运行入口

- 页面、API、当前规则与服务端实现：`app/`；部署运行时副本集中在 `app/_runtime/`。
- D1：`db/schema.ts`、`db/index.ts`、`drizzle/` 与 `app/_runtime/lib/db.ts`。
- Worker：`worker/index.ts`，默认导出 `fetch(request, env, ctx): Promise<Response>`。
- `src/`、`server/`、`scripts/`、`migrations/` 是原 Grok/TanStack 实现，仅供上游考据，不进入生产构建或线上入口。

模块全局作用域只允许声明、纯常量和纯函数。随机数、fetch、数据库初始化、定时器、密钥读取后的副作用和其他 I/O 必须发生在请求处理期间。产物不得包含 Better Auth、PGlite、pg 或 Vercel运行入口。

## 产品与权威边界

保留上游完整能力：开房/入席/离席/请离/房主转移、9 步三级建卡、语音、线索与日志、装备和职业资源、分头地点/时钟、组队、休整投票、战斗和逐地点并发协调。通用规则 v2 中个人合法行动不经队长审批；个人移动或休整可原子离队，队长只组织整队移动。

- **规则权威**：`app/_runtime/lib/rules` 的 TypeScript 内核决定 5e 数值、资源、骰子、战斗、时间和权限；每房间 SQLite Durable Object 原子保存活跃状态与事件，D1 只保留身份、目录、静态人物卡和可重建归档。AI 只解释候选命令并叙述已提交事件。
- **服务端权威**：客户端提交意图并轮询公开投影；写操作从可信登录取得 user id，再验证成员、房主、队长、地点与回合权限。
- **秘密边界**：模组 `truth`、未公开线索、内部 flags 和模型上下文只留在 Worker。

所有 v2 裁决都必须穿过 `step(module, state, command)`，所有玩家快照都必须穿过 `project(module, state, viewer)`；不得把 v2 资源、物品、战斗、休整或位置另写回旧 D1 `game_states` 作为第二权威。D1 `room_event_archive` 只追加保存已提交事件，丢失后可从房间 DO 重建。

模组只能用封闭 DSL 声明场景、Portal、唯一物品、交互、分层线索、NPC 初始知识、NPC 能力、NPC Plan、ScheduledEvent 和结局谓词。耗时动作先成为 Activity，效果只在虚构时间完成后落地；中断必须保留未发生的效果。拍只调度镜头且最多相差三拍，不代替轮、分钟、小时、短休一小时或长休八小时。

## 身份与资源

独立 Worker 的身份来源是 `auth_users` 与 `auth_sessions`。密码通过 Web Crypto PBKDF2-SHA256 加随机盐派生；会话 cookie 是 `HttpOnly`、`Secure`、`SameSite=Lax`，D1 只保存 token 摘要。随机盐和 token 只能在注册或登录请求内生成。`app/chatgpt-auth.ts` 从可信会话取得 user id；GPT Sites 身份头和 development 假用户都不是身份来源。

Google/X OAuth 只有在回调、客户端配置和 Wrangler secrets 全部存在并验证后才可启用；缺少配置时界面明确标为待配置。身份变更必须覆盖注册、错误密码、会话恢复、登出撤销、匿名 401 与登录后开房闭环。

部署前先运行 `npx wrangler whoami`。登录由用户在浏览器完成，不索取或记录 API Token。读取现有 Worker/D1 配置后，把已存在数据库的真实 id 写入 `wrangler.jsonc`；未获用户确认时不创建 D1、KV、R2、队列或其他资源。密钥只通过 `wrangler secret` 配置。

## 根因驱动

故障修复先建立因果链，再动代码：

1. 用最窄路径复现症状，保留能定位层级的事实，例如失败请求、状态快照、错误堆栈、数据库结果或相关 diff。
2. 沿“输入 → 权限/状态 → 服务端编排 → 持久化/外部依赖 → 返回投影”追到第一个违反不变量的位置，用一句话写明根因及证据。
3. 在该位置的单一事实源修复。确定性规则改规则层，权限改服务端，持久化改 D1 层，平台故障改平台接缝；界面只负责呈现真实状态与错误。
4. 修复范围只覆盖根因及其直接影响。保留无关代码和上游行为，不顺手重构，不用吞错、伪造成功、备用跳转、硬编码返回或自动换模型掩盖问题。
5. 外部网络、浏览器会话或平台控制面是根因时，保持产品代码不变，记录已确认的边界与仍需外部恢复的条件。

修复回执按“症状 → 根因 → 修改 → 证据 → 剩余限制”组织。若证据只能支持相关性而不能确认因果，明确标为推断。

## 修改顺序

1. 先读相关入口及其直接依赖，列出本次涉及的规则、身份、权限、数据与秘密不变量。
2. 从权威内核向外修改：`app/_runtime/lib/dnd|kp|module` → 服务编排 → D1/API → 页面。
3. schema 变更以 `db/schema.ts` 为源，运行 `npm run db:generate` 并逐行检查新迁移；已生成迁移只增不改。
4. Cloudflare 变更先只读核对账号、现有 Worker、绑定与迁移状态。发布只更新现有 `zhuwei` 及其现有 `DB`，并保持密钥位于 Worker Secret。
5. 按下述风险等级取得最小充分证据；证据达到停止条件后交付或发布。

## 适度验证

验证与改动风险匹配，以能证伪本次根因和证明用户路径恢复为准：

- 文档、注释或 `AGENTS.md`：检查目标段落、`git diff --check` 和最终 diff 即完成。
- 纯规则或局部 TypeScript：运行最相关测试及类型检查；只有改动触及格式/静态规则时补 Lint。
- API、权限或交互：复现原失败路径，再验证一个成功路径和一个与本次风险直接相关的错误或越权路径。
- D1 schema/持久化：检查生成 SQL，在目标环境确认迁移状态，并做一次最小写入—读取闭环；不重复创建数据库或测试资源。
- 跨层改造、依赖升级或正式整站发布：运行 `npm run typecheck`、`npm run lint`、`npm test`。仅在依赖未安装或 lockfile/manifest 变化时运行 `npm ci`。

同一源码状态下，每项检查运行一次。只有后续修改可能影响该结果时才重跑；已有行为测试覆盖验收条件时不再增加同义源码正则、重复截图或第二套端到端测试。浏览器截图/DOM QA 仅在用户明确要求时执行。

发布后用一个代表性入口做冒烟检查，并用 Cloudflare 部署状态确认版本。若请求在到达 Worker 前发生 DNS、TCP 或本地网络超时，换一个独立通道复核一次；仍不可达时停止重试，报告传输层限制，不把它误判为应用回归，也不为此修改业务代码。

## 完成门

任务满足其对应风险等级的证据即可完成。正式发布还必须满足：

- 本次相关检查通过，已验证源码与部署源码一致；
- `wrangler.jsonc` 仍指向现有 Worker `zhuwei` 和现有 `DB`，D1 迁移状态清楚；
- Cloudflare 控制面显示新版本已接收预期流量，代表性入口成功或已明确记录传输层限制；
- `cloudflare` 分支提交并推送，远端 `main` SHA 不变；
- 回执只列本次实际执行的检查、版本、迁移和未解决限制，不把未执行项写成已验证。
