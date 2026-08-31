# 烛帷

朋友围坐，你开口，骰子落地。帷幕后，烛火未灭。

烛帷是中文多人 D&D 5e 网页跑团：2–5 名玩家围坐一桌，创建角色，由 LLM/KP 主持开放世界冒险。本 `cloudflare` 分支是产品 **V3** 的唯一工作树，当前开发版本为 **0.4.0**，运行目标仍是现有 Cloudflare Worker `zhuwei`；远端 `main` 固定在 `29eb06dc009c983ad61b2d862454503e67a7f40a`，不会影响 grok.me MVP。

V3 表示产品与仓库架构代际，0.4 表示当前应用版本；两者都不把机械协议静默改名。0.4 是一次开发期重置：所有 0.4 以前的房间和可恢复房间归档都已明确退役，生产代码不再携带它们的 Adapter、fallback 或 migration。0.4 新房只接受精确的 `dnd5e-2014-srd5.1-authoritative-v2` Ruleset、`runtime-srd51-2014-authoritative-environment-v5` runtime manifest 及其完整 hash 闭包；名称中的 `v2`/`v5` 是独立协议版本轴，不改名为 0.4 或 V3。以后若要兼容旧版本，必须另作明确产品决定。

当前 KP 闭包精确绑定 `authoritative-kp-private-form-narrow-tools-workflow-v2` 与 `causal-action-program-v5`：普通提案以 `executeCausalActionProgram` 和匹配的 `actionLanguageRef` 进入 Rules，多人管理只接受服务端生成的 `authenticatedPartyAction`；NPC 计划、退休和 Activity 只接受服务端生成且字段精确的 `authenticatedCampaignAction`。

## 功能范围

- 开房、凭房间码入席、最多 5 人、移交房主、离桌与请离后重新入席。
- 九步 3 级人物卡：种族、职业、属性、背景、技能、法术、装备、身份、总览。
- AI KP 叙事、检定、资源扣减、线索板、场景日志和模组秘密隔离。
- 同一时间线的地点分流、最多 3 拍时差、短休/长休投票与结算。
- 小队邀请、队长移交、队员行动缓冲与场景迁移。
- 战斗先攻、回合、生命、反应和同场景可见性。
- 语音转写、发送前确认和 KP 旁白语音。

玩家可以用自然语言自由提出行动；LLM/KP 按 [SPEC 0001](docs/specs/0001-llm-kp-responsibility-contract.md) 创作和裁决故事，TypeScript Rules 内核诚实执行机械，Room Durable Object 原子保存权威状态。模组真相、其他观察者的秘密和内部状态不进入玩家响应或普通日志。

## Cloudflare 架构

- 页面和 API：`app/`
- 迁移后的完整规则、桌面、KP 与语音运行时：`app/_runtime/`
- D1 访问与 schema：`db/`
- Worker ESM 入口：`worker/index.ts`
- D1 迁移：`drizzle/`
- 模块/Profile 门与有界评测：`tools/`
- 唯一部署配置：`wrangler.jsonc`

TanStack/Grok、PGLite/Postgres、Sites/Vercel 的旧入口已从 V3 工作树移除，由私有 GitHub archive 分支保存。生产依赖中没有 Better Auth、PGLite、Postgres 驱动、Sites 插件或 Vercel 产物。0.4 不提供旧房 migration，也不清空远端 D1；旧目录行只会被当前路由显式拒绝，房主仍可删除。新房在写入时固定当前 Ruleset、KP Profile 与完整 workflow，不依赖数据库默认值。目录与 0.4 边界见 [ADR 0013](docs/adr/0013-v3-product-generation-and-repository-boundary.md)。

## 本地验证

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

`npm test` 会先生成 Worker 生产构建，再验证服务端 HTML、匿名鉴权响应、D1 契约、完整命令面和上游规则文件哈希。

本地开发：

```bash
npm run dev
```

development 环境使用固定本地用户；该用户绝不会成为生产身份。

## 身份与密钥

独立 Worker 使用邮箱/密码注册登录：PBKDF2-SHA256 派生值和随机盐存于 D1，30 天会话只在 D1 保存 token 摘要，浏览器收到 `HttpOnly`、`Secure`、`SameSite=Lax` cookie。匿名访问 `/hall` 会看到登录入口，受保护 API 返回 401；没有生产假用户。

Google/X OAuth 仍需各自的客户端配置和 Wrangler secrets，未配置时界面明确禁用。模型密钥也只能通过 `wrangler secret` 管理，不能写入源码或配置。D1 只能绑定现有数据库；未经确认不得创建新 D1 或其他 Cloudflare 资源。

## 部署保护

目标只有现有 Worker：`https://zhuwei.yinskyriver.workers.dev`。

```bash
npx wrangler whoami
npm run cf:deploy
```

`cf:deploy` 会先验证 Worker 名称和已授权的 `zhuwei-dev` D1 UUID，再构建并部署，防止误发到别的 Worker 或数据库。

## 许可与说明

私人仓库。模组文本与 KP 提示词是项目的一部分；不得把玩家不该知道的 `truth` 写入玩家可见界面、API 响应或日志。
