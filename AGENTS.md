# 烛帷 Cloudflare Worker 代理合同

本分支是私有 GitHub 项目 `ytq9/zhuwei` 的 **等价 Cloudflare 迁移**。产品基线为 `main` 提交 `29eb06dc009c983ad61b2d862454503e67a7f40a`；GitHub 上游是行为、中文文案、规则和视觉的唯一权威。只在 `cloudflare` 分支工作，保持 `main` 与 grok.me 部署不变。

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

保留上游完整能力：开房/入席/离席/请离/房主转移、9 步三级建卡、语音、线索与日志、装备和职业资源、分头地点/时钟、组队与队长审批、休整投票、战斗和逐地点并发 KP。

- **规则权威**：TypeScript 与 D1 决定数值、资源、骰子、战斗和权限；AI 只返回受约束叙事。
- **服务端权威**：客户端提交意图并轮询公开投影；写操作从可信登录取得 user id，再验证成员、房主、队长、地点与回合权限。
- **秘密边界**：模组 `truth`、未公开线索、内部 flags 和模型上下文只留在 Worker。

## 身份与资源

独立 Worker 的身份来源是 `auth_users` 与 `auth_sessions`。密码通过 Web Crypto PBKDF2-SHA256 加随机盐派生；会话 cookie 是 `HttpOnly`、`Secure`、`SameSite=Lax`，D1 只保存 token 摘要。随机盐和 token 只能在注册或登录请求内生成。`app/chatgpt-auth.ts` 从可信会话取得 user id；GPT Sites 身份头和 development 假用户都不是身份来源。

Google/X OAuth 只有在回调、客户端配置和 Wrangler secrets 全部存在并验证后才可启用；缺少配置时界面明确标为待配置。身份变更必须覆盖注册、错误密码、会话恢复、登出撤销、匿名 401 与登录后开房闭环。

部署前先运行 `npx wrangler whoami`。登录由用户在浏览器完成，不索取或记录 API Token。读取现有 Worker/D1 配置后，把已存在数据库的真实 id 写入 `wrangler.jsonc`；未获用户确认时不创建 D1、KV、R2、队列或其他资源。密钥只通过 `wrangler secret` 配置。

## 执行顺序

1. 用本地 Wrangler 请求回归复现当前 500；修复完成标准是同一检查对 `/` 返回 200、对 `/hall` 返回非 500。
2. 从确定性内核向外修改：`app/_runtime/lib/dnd|kp|module` → 服务编排 → API → 页面。
3. 变更 schema 时修改 `db/schema.ts`，运行 `npm run db:generate`，检查新迁移；迁移只增不改。
4. 登录 Cloudflare 后只读取现有 Worker/D1 状态；确认绑定后再补全配置和迁移计划。
5. 部署前依次运行 `npm ci`、`npm run typecheck`、`npm run lint`、`npm test`。任一失败即停止部署。
6. 使用 Wrangler 直接部署现有 `zhuwei`，随后验证 `/`、`/hall` 和实时日志；build/upload 成功不是完成。

## 完成门

以下证据全部存在才可交付：

- `cloudflare` 分支已提交并推送，远端 `main` SHA 未变化；
- 四项检查全绿，本地 Worker 回归由 500 变为首页 200；
- `wrangler.jsonc` 指向现有 Worker 和现有 `DB`，无占位符；D1 迁移状态已核对；
- 线上首页 200 且显示烛帷，`/hall` 为正确页面或明确登录响应；
- 首页请求后的实时日志没有未捕获异常；
- 回执列明分支/提交、Worker 版本、URL、检查结果、HTTP 状态、D1 状态及未配置密钥/功能。
