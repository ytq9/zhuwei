# 2026-09-09 当前工作区快速发布

用户授权：快速推送、部署目前已有改动。分支 `cloudflare`，修改前本地 HEAD `bec5e28c44f3c815a341c2f1e425cfaaeb65acf9`；包括此前尚未推送的组队修复，以及当前工作区提示词/补选、对象补全、承诺生命周期/NPC 工作、旁白和恢复改动，设计草案继续保留原待确认状态。没有把这些草案当作已实施功能。

当前状态：用户已回复“可以”，确认 2 个旧工作流 vNext 房间无法续玩、记录保留的影响；生产切换已完成。99 文件代码提交为 `8395406db3912cfc3480946f9520982921693a5e`，随后纯文档提交 `5b5fa317b4071c4af8b304a473bf1bef036a9ef7` 是实际部署时的干净、已推送 HEAD。两者之间只有 2 份文档差量，604 个源码/构建输入再次核验一致，复用已成功的 production build。新生产版本 `6f1b038d-d4eb-4636-91e2-39051982f357` 已接收 100% 流量。

## 候选与检查

- 使用 `docs/agent/release.md` 的快速发布例外，运行定向检查与必要 production build，未运行全项目测试/Lint。
- 新发现并修复 strict 路由遗漏：原 `tools.length === 1` 判断会把现役 submit/补选双 strict 工具送往普通接口。按任一 strict 声明选择严格传输，非法混合交给原校验器在 fetch 前拒绝。保留普通生成与旧非 strict Form 行为。新增真实 Provider 接缝测试；初轮失败中另有测试复用已读 Response 的夹具问题，已改为每次返回独立 Response。
- Node 定向 13 文件组 161/162、exit 1；唯一失败是既有公开恢复文案增加操作指引后，旧断言仍要求全文等于短句。更新为核对原因不确定性及重试入口，原文件 8/8、exit 0；162 个不同用例分批通过，未称同一最终全组一次通过。
- Worker 定向四文件组 66/78、exit 1；其中新的实际路由 3/3、承诺/NPC 生命周期与旧队列升级、ActorPlan 组均通过。12 个失败均在 provider-room 原有测试中。用原 HEAD 完整源码及原测试隔离对照，provider-room 为 31/44、13 失败、exit 1：候选的 12 个失败名称全部是原基线失败的子集，Item/Ability 两阶段恢复原失败在候选中通过。未调整 Rules 或放宽恢复断言来制造通过。
- 这些既有失败涉及旧自动骰断言、活动/休整到期和旁白数量、观察后的活动状态、旧交互拒绝/中断预期。对照证明本次没有新增这些失败，不证明它们已经修复；本次不宣称整套 Worker 测试全绿。
- `npm run typecheck` exit 0；目标差量及未跟踪文件空白检查通过。构建、源码冻结、提交与推送的实际结果续记执行日志。

## 远端只读核对与生产切换边界

- Wrangler 4.125.0 已登录现有账号；部署仍指向 Worker `zhuwei`、D1 `DB/zhuwei-dev`、原 Room Durable Object 与 AI/ASSETS 绑定。配置、D1 schema、D1 migrations 与依赖没有本次差量；`wrangler d1 migrations list DB --remote` 显示无待执行项，未执行远端 migration、Secret 或资源修改。
- 切换前线上版本 `c4ef49ba-aa04-4969-aec4-95fde807f5c1`，100% 流量。远端 `cloudflare` 初始为 `649c80105bcc4ee25317427bb99434bbbc6c2c86`；远端 `main` 实测为 `cf7dbddab8cfb36365734fe96c42d82456fa1d0e`，与发布文档的历史基线不同，本次以实测值核验前后不变，不重写 main。
- D1 只读聚合显示 2 个现有 vNext 房间处于 play，绑定旧工作流 SHA256 `dcd38dff093f10dc4d32c440c1c53994e119b14dfef2bed2b88dd634a53b1c6f`。将实际保存的 manifest 传给当前 `roomRuntimeConfiguration().hasWorkflow`，两者均不被新候选接受。直接替换生产会使这两个房间无法继续正常行动；没有修改其记录或隐式重绑旧状态。
- `AGENTS.md` 第 5 行的旧房退役授权明确不含“vNext 后续新建房间”，第 90 行要求按创建时固定的完整 runtime manifest 解释。完成候选构建和推送后，向用户说明上述 2 个房间停止续玩、记录保留的具体影响；用户明确回复“可以”后才执行切换。本次没有删除房间、改绑 manifest 或修改账号资料。

## 实际部署与线上核验

- 部署前 `git ls-remote origin refs/heads/cloudflare refs/heads/main` 确认 cloudflare 与干净 HEAD `5b5fa317b4071c4af8b304a473bf1bef036a9ef7` 一致；604 个构建输入无变化，105 个构建产物记录 SHA256。`DEPLOY_SOURCE_SHA=5b5fa317b4071c4af8b304a473bf1bef036a9ef7 node cloudflare/verify-deploy-config.mjs` exit 0。
- `npx wrangler deploy` exit 0，使用 `.wrangler/deploy/config.json` 指向的 `dist/server/wrangler.json` 与既有构建产物，不重复 build。上传至现有 `zhuwei`；ROOMS、DB、AI、ASSETS 绑定保持原目标，没有执行远端 migration、Secret 修改或新建资源。
- Cloudflare deployment `43799532-d883-44fd-b91a-6f17a59e2acd`，创建于 `2026-09-09T05:24:48.370789Z`（北京时间 13:24:48）；`wrangler deployments list --json` exit 0，确认版本 `6f1b038d-d4eb-4636-91e2-39051982f357` 接收 100% 流量。
- [生产首页](https://zhuwei.yinskyriver.workers.dev/) 的本机默认连接超时（curl exit 28、HTTP 000、约 8 秒）；只切换一次到当前已启用的系统代理复验，首页、`/login` 与登录页引用的 `/_next/static/chunks/index-CFvAdctp.js` 均 HTTP 200、curl exit 0。登录 HTML 含预期产品/登录文字，已下载 JS 的 SHA256 与本次本机构建完全一致。没有修改系统代理或应用代码。
- 上述证据确认生产部署和公开入口可用；没有把它记为登录后游玩、真实模型链或全部语义问题验收通过。部署后的纯文档回执另行提交推送，不触发重复部署。

## 证据与剩余限制

本机证据目录 `/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-quick-deploy-20260909-lfqmka6h/`，保存计划、源码指纹、初始 diff、逐项检查、基线对照、部署清单、D1 migration/房间绑定只读结果及兼容性判断。私有测试请求不进入 Git。

此前对象补全 v19 单样例真实通过，但状态仍有含糊的“活动”；承诺自然语言已许诺却漏登记的 H/I/J 真实失败仍保留，未靠本次路由修复改判。完整游玩、统计稳定性及所有既有测试失败不在本次快速发布中宣称完成。
