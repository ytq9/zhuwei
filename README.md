# 烛帷

朋友围坐，你开口，骰子落地。帷幕后，烛火未灭。

烛帷是中文多人 D&D 5e 网页跑团：2–5 名玩家围坐一桌，创建角色，由 LLM/KP 主持开放世界冒险。本 `cloudflare` 分支是产品 **V3** 的唯一工作树，运行在现有 Cloudflare Worker `zhuwei`；远端 `main` 固定在 `29eb06dc009c983ad61b2d862454503e67a7f40a`，不会影响 grok.me MVP。

V3 表示产品与仓库架构代际，不等于把持久化协议改名。现有房间仍由其 genesis 固定的 `dnd5e-2014-srd5.1-authoritative-v2` 或明确 Legacy Adapter 解释；任何持久化规则、事件、投影、模组或 Profile 语义变化都必须新增完整 runtime manifest 和相应 Adapter，解释语义变化还必须新增 interpreter。

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

TanStack/Grok、PGLite/Postgres、Sites/Vercel 的旧入口已从 V3 工作树移除，由私有 GitHub archive 分支保存。生产依赖中没有 Better Auth、PGLite、Postgres 驱动、Sites 插件或 Vercel 产物。目录裁定、归档 SHA 和恢复门见 [ADR 0013](docs/adr/0013-v3-product-generation-and-repository-boundary.md)。

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
