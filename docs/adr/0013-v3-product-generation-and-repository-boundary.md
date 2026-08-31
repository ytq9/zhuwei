# V3 产品代际与仓库边界

- 状态：已接受（项目主管裁定）
- 日期：2026-08-28
- 0.4 修订：2026-08-31（用户明确确认放弃既有房间）
- 关联：SPEC 0001、ADR 0006、ADR 0008、ADR 0010

## 背景

开发过程中同时留下了 Cloudflare 主工作区、同版本修复克隆、独立 Sites 迁移仓库、Vercel/Nitro 诊断产物和多个 Codex worktree。主仓库内部也同时保存生产 `app/` 与不再进入构建的 TanStack/Grok、PGLite/Postgres、Vercel 迁移证据。它们模糊了生产事实源，也增加了代理误改旧入口、泄露浏览器捕获或从旧数据库建立第二权威的风险。

项目需要把下一阶段明确标为 **烛帷 V3**，但房间的规则、事件、投影和模组版本已经是持久化协议。把现有 `authoritative-v2` 字符串机械改名为 v3，会让旧房间无法按原解释器恢复，并违反版本注册表只增不改的约束。

## 决策

### 1. 产品代际与规则版本分离

`package.json` 的 `0.4.0` 表示当前应用开发版本，文档中的“V3”表示产品与仓库架构代际。两者都不自动改变 D&D 规则语义，也不要求重命名协议 ID。

0.4 新房仍精确使用 `dnd5e-2014-srd5.1-authoritative-v2`，并绑定 `runtime-srd51-2014-authoritative-environment-v5` 及其完整事件、投影、模组和扩展 hash 闭包。名称中的 `v2`、`v5` 等是独立协议版本轴，不改名为 0.4 或 V3。

用户已明确确认这是开发阶段并放弃全部 0.4 以前的房间和可恢复房间归档。因此，0.4 生产 Registry 只保留当前完整 manifest；旧 ruleset/runtime/model/workflow/module Adapter、fallback、双写及房间 migration 全部删除。未知或旧引用只能稳定拒绝，不能由当前解释器猜测执行。此前“保留旧 Adapter 直到逐房迁移”的条款在前 0.4 房间范围内由本修订窄取代；未来是否兼容 0.4 之后的版本必须另行裁定。

V3 不复制第二套 `app`、不新建 `src-v3`，也不为了目录观感把稳定的 `rules/v2` 改名。它沿用两个深 Module：Room Action 负责意图、KP 提案与提交编排；Rules 只公开 `step / project / replay`。SPEC 0001 继续是 KP 行为最高产品准则。

### 2. 唯一工作区与保留目录

本机唯一开发工作区是 `/Users/sanmu/Documents/zhuwei-cloudflare`，继续使用 `cloudflare` 分支；远端 `main` 保持冻结。

V3 主树只保留以下职责：

- `app/`：页面、API、UI，以及 `_runtime` 下的 KP、Rules、Room、Table、Module 和平台 Adapter；
- `worker/`：现有 Cloudflare Worker 与 Durable Object 导出；
- `db/`、`drizzle/`：D1 schema、访问和只增迁移；
- `public/`：实际产品静态资产；
- `tests/`：行为、恢复、隐私、规则和项目边界验收；
- `tools/`、`cloudflare/`：仍被使用的模块门、Profile 门、评测与部署保护；
- `docs/`、`CONTEXT.md`、`AGENTS.md`、`README.md`：规格、ADR、领域模型、代理合同和执行审计；
- 根部构建、类型、测试、包和 Wrangler 配置。

### 3. 归档和移除

以下内容已经由 GitHub 私有归档分支覆盖，因此从 V3 主树移除：

- `src/`、`server/`、`migrations/`：TanStack/Grok、PGLite/Postgres 旧入口；
- 旧 `scripts/` 中的 Sites、PWA、preview、PGlite、浏览器模板工具及其自测；
- `public/__grok/`、`startup.sh`、`AGENTS.project.md`；
- `output/` 中仅用于旧里程碑的仓内截图。

仍有效的四个工具迁到 `tools/`，调用方和文档引用必须同步更新。`.playwright-cli/`、`.wrangler/`、构建产物、依赖目录和本地数据库不进入 Git。

建立的恢复点如下：

- `codex/archive/pre-v3-authoritative-v2-20260828` → `4f2abee4cdf53a430d7df66e4644069e35dc09d9`；
- `codex/archive/sites-migration-20260825` → `932c39f4b006b2a7bce845ff8d4d74cfececc17d`；
- `codex/archive/detached-85aa-pre-v3-20260828` → `21ca594cac3b2cad3ee1c6cff5b96fd41d1a9030`，保存未验证源码工作态；没有额外纳入该 worktree 未跟踪的 `.playwright-cli` 和三张战术截图，但仍继承 pre-v3 基线中已跟踪的两张里程碑审计截图。

这些分支是恢复档案，不合并回 `cloudflare`，也不发起面向 `main` 的 PR。

### 4. 本地数据与删除策略

重复克隆、旧源码仓库、诊断产物和已收口 worktree 只在远端 ref、提交数和独立取回校验一致后移入 macOS 废纸篓。旧 Sites 仓库的 `.wrangler` 含本地房间、角色、消息与秘密状态，不能上传 GitHub；它随原目录留在废纸篓的可恢复副本中，除非用户以后明确要求永久销毁。

0.4 的 `db/schema.ts` 不再声明旧 `game_states`、`messages`、`session_logs` 与 `room_event_archive`，但本次开发重置不生成或执行 D1 migration，也不清空现有目录与归档。旧房只由当前路由按精确绑定显式拒绝，房主仍可删除目录行；新房写入时显式固定当前 Ruleset、KP Profile 与 workflow，不依赖旧数据库默认值。

## 后果

- “V3”与“0.4”各有单一含义，均不混入规则/Profile 协议命名。
- 代理和开发者不再需要判断两套应用入口哪套有效，旧平台依赖也不会被误带入构建。
- Git 历史承担旧源码审计职责；0.4 工作树只承担当前房间职责，不承诺从历史源码恢复旧房间数据。
- 当前 Registry、路由、模型目录、工作流与 UI 都只有 0.4 路径；旧引用显式拒绝而不 fallback。
- 以后增加新版本时，是否保留 0.4 Adapter、提供 migration 或再次退役数据，必须由新的明确决定处理。

## 验收

1. 包版本为 `0.4.0`，README 和本 ADR 明确区分产品 V3、应用 0.4 与规则/runtime 协议 ID。
2. V3 主树不存在已裁定的旧入口；四个现役工具位于 `tools/`，所有调用与文档引用已迁移。
3. 定向 Profile/Room/删除测试与类型检查不依赖已删除路径或新增 migration；完整 Lint、全量测试和 production build 仍服从发布阶段授权。
4. 三个远端归档 ref 可由独立仓库取回并匹配上述 SHA；远端 `main` 始终保持 `29eb06dc009c983ad61b2d862454503e67a7f40a`。
