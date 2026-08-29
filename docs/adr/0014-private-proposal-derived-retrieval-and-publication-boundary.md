# 私有 Proposal、派生检索与逐受众发布状态保持权威边界

- 状态：已接受（用户本 Goal 明确授权）
- 日期：2026-08-29
- 关联规格：SPEC 0001、SPEC 0003、SPEC 0005、SPEC 0006、SPEC 0010、SPEC 0011、SPEC 0013、SPEC 0014、SPEC 0015
- 实现状态：生产映射、定向证据、远端 migration、既有 Worker 部署、双视口浏览器与 Git 推送已有事实证据；用户豁免的完整门未运行且不计通过，完整线上模型指标仍由用户自行测评

## 背景

现有生产提案把大量开放行动放进一个超级 Schema，并倾向为主 KP 提供较完整上下文。它能证明封闭机械入口，却带来三个新的产品风险：Schema 和 Prompt 成本随能力增长；静态规则/模组资料与活跃 Room 状态容易混成第二事实源；模型叙述失败又可能被模糊的单一成功状态或固定 fallback 掩盖。

烛帷仍必须兑现 `SPEC 0001`：KP 理解自然语言意图、创造开放世界、裁决可行性/风险/NPC/失败并叙述；Rules 只管机械；Room DO 只管活跃权威；每个观察者只取得自己的投影。优化 token、延迟或检索不能把 KP 变成表格路由器，也不能把 RAG、页面或辅助模型变成事实、权限、随机或机械权威。

## 决策

### 1. Proposal 使用私有小表和独立 Action Language

新 V3 房间的主 KP 每次只看到 Room 依可信状态筛出的 3–6 张版本化私有 Form，至少覆盖 clarification、observe、NPC exchange、ordinary/high-risk、in-world refusal、materialization、combat、environmental stunt 和 compound。`compound` 是未预见、多阶段或跨域行动的完整逃生舱，不能被 Planner 删除。

Form 不暴露给玩家，也不接收 principal、actor、Audience、骰面、实际 targets、事件、状态 patch 或 Profile 实值。服务端把合法 Form 确定性编译成独立版本的 closed/acyclic/bounded `CausalActionProgram`，再交给唯一 Rules `step`。它不改变既有 `authoritative-kp-action-plan-v1`，新增 primitive 仍要求新的 Rules manifest/interpreter。

### 2. Context Pack 分三层，RAG 只索引静态资料

RequiredContext 必须来自 Room Authority/`project`，不可被 Planner、RAG 或 token 裁剪器删除。RetrievedContext 只含版本化静态 SRD/模组/Story Bible/Ability/敌人/环境引用；命中后服务端必须按 source/profile/hash/span/权限重读权威原文。OptionalContext 最先裁剪。

D1 FTS、中文别名、结构关系、embedding 和 rerank 都是可重建派生索引。当前战术位置、资源、Pending、角色/NPC 当前知识、Audience、对话与动态事实永不进入索引。NPC 重新按 NPC Viewer 投影，Narration 不接收 Story Bible 或完整 KP Context。

### 3. Proposal 只有一次窄修订

每个 RootAction 允许一次首 Proposal 和最多一次窄修订。修订只看到所选 schema、原草稿、合并诊断、有限引用和冻结语义 hash，只能修字段/引用/机械组合或升级到 compound。goal、method、target、玩家已确认选择和已生成 NPC 回应语义不可改变；骰面出现后不可改变 DC、风险、成本、目标规则或后果。耗尽后显式 `needsKp`/错误，不做第三次完整调用。

### 4. Narration 是 body-only，行动与叙述状态分离

Narration 模型只输出 exact `{ body: non-empty string }`。Audience、Receipt、projectionHash、证据/能动性引用、Policy 和 ModelInvocationReceipt 由服务端派生；TTS 从同一 body 派生。Grounding 不通过显式失败，禁止伪成功正文。

公开结果分别表达 action 与 narration。行动提交以后，任一受众 Narration 超时、Grounding 拒绝或发布失败都不能撤销玩家气泡、世界事件、骰面、资源或虚构时间。发布以 `(rootActionId, ViewerKey, projectionHash, deliveryGeneration)` 独立幂等；一个受众失败不阻塞另一个。重试只用原 Receipt 和冻结投影。

### 5. 辅助模型按角色注册，实验后才接生产

所有具体模型以 Profile Registry 固定 provider/model revision、supportedRoles、schema、验证套件、上下文、延迟和成本等级。辅助模型只能建议 Form 排序、实体/代词、查询、rerank、引用和结构错误；不决定 KP 或 Rules 权限。主 KP 选择按房间固定，Planner 失败只回到确定性查询，不隐藏切模型。

G2（小表 + 三层 Context + D1 FTS）是采用配置。120 条同集离线结构报告通过 G2 结构硬门；G3 确定性 Planner 控制和 G4 本地精确向量对照相对 G2 的三项配对质量差值均为 0/120、95% CI `[0, 0]`，输入还增加，故两者拒绝；G5 因 G2 recall 与 MRR 均充分而不适用。生产新房绑定只接受 `context-planner-disabled-v1`，Hall/Table 不出现 Planner 设置。未通过角色验证的模型候选与离线 Adapter 只留实验/测试层。未经用户另行授权不创建远端 Vectorize 或其他 Cloudflare 资源。

### 6. 动态环境复用现有 Room/Rules/Geometry

玩家可以提出任意自然语言环境想法；生产端没有按对象名、关键词、家族或 archetype 派发的目录。KP 决定具体材质、Geometry、耐久、有限状态图、触发和显式机械模式，并在骰前冻结。`state-only` 只改变对象自身状态/耐久以及地形、掩护、视线或通行，`TriggeredHazard`/`AreaEffect` 必须为空且不产生区域 save 或区域目标 damage；`area-hazard` 才要求 KP 定义区域、豁免、目标伤害和残骸，Rules 再从完整 Geometry 决定实际目标。Room DO 在同一 RootAction/Receipt 提交。

`area-hazard` 的通用验收用于证明 materialize/reuse、攻击或检定、对象破坏、触发区域、逐目标豁免/伤害/死亡和残骸地形是一条可恢复链；吊灯只保留为已有 Rules 示例，不是产品模板或发布前置。折叠栅栏一类 `state-only` 自定义定义在合法状态/地形事件后结束，不伪造区域或伤害。两类都不是通用物理引擎或客户端 target list。

## 被否决的方案

- 继续扩张超级 Schema 和完整上下文：成本随能力增长，也模糊当前必要事实与静态资料的边界。
- 把 Form 做成玩家命令菜单：会缩小自然语言能动性，并把内部实现泄漏为产品合同。
- 让 Planner 选择唯一 Form 或删除 compound：会让辅助模型替主 KP解释意图并拒绝未预见行动。
- 把活跃 Room 快照或 NPC 当前知识写入 RAG/Vectorize：会建立延迟、权限不清且不可原子恢复的第二事实源。
- 直接信任检索 chunk/模型摘要：索引过期、版本错配或秘密权限变化会变成不可审计事实污染。
- 允许多轮完整 Prompt 自动修 Proposal：增加成本并使模型有机会逐轮改变玩家语义或骰前裁决。
- 让 Narration 模型自报 Audience、证据、agency 或独立 TTS：会赋予模型权限，并产生不同语义的旁路文本。
- 用单一 `ok` 或固定 fallback 表达行动成功：会掩盖“世界已提交、叙述未发布”的真实恢复点。
- 任一受众失败时回滚整次行动：会重复随机/资源并让观察者故障改变世界。
- 为环境建立客户端物理/区域引擎：会形成第二空间与实际 target 权威。

## 后果

优点：Proposal schema 和 Context 可以独立量化；静态检索可重建而不污染 Room 权威；一次窄修订和语义 hash 限制失控循环；逐受众发布故障不会改变世界；动态环境仍穿过既有 Rules/Geometry/Room/replay。

代价：需要版本化 Form/Action Language/corpus/model/narration/publication Profiles、D1 FTS 构建链、Gold eval、逐受众发布 journal 和更严格的浏览器/故障证据。本轮 G3/G4 已因无增益被拒绝、G5 不适用，产品诚实停在 G2，也不提供空的 Planner UI。

安全影响：Prompt、正文、秘密和 chunk 原文不得进日志；Retrieved ref 使用前重新鉴权；Audience 只在提交时冻结；Planner/RAG/模型失败不能扩大权限或更换主 KP；客户端永远看不到完整 Geometry/targets。

## 版本与迁移

该决定只对绑定完整新 Profile/manifest 的新 V3 房间生效。旧房的提案、Outcome、Delivery 和环境解释器保持原 genesis 行为，不从旧对话、Prompt、距离或事件猜测迁移。Form/Profile-only 变化与新增 Rules primitive 分别发布；所有 hash 都进入房间 manifest。未来迁移旧房需独立规格和用户授权。

历史 hazard-only 环境 Profile 固定为 `environment-feature-fsm-2014-v2`（`sha256:702b2559c821a52e1c7d6a137c6b261cec21d6cc513e3c0301b4b5ab007f7c87`），并只随 `runtime-srd51-2014-authoritative-environment-v2`（`sha256:0021280335296ecfc5b65a221fec7009550fac96db65925e47daef9f9d4f0456`）解释。第一代私有 Form workflow-v1 的双模式 `environment-feature-fsm-2014-v3`（`sha256:1656fd548905d6ea886fd4cf97357a9d67c56422be3a2c6bd281fc93a22b4fe6`）继续绑定 `runtime-srd51-2014-authoritative-environment-v3`（`sha256:4038f09e546eb8a0c925e892634625fe09859d2aeba91f044a8ecae76aa99c57`），保持旧 1×PB/既有豁免解释。当前新房 workflow-v2 固定完整 `runtime-srd51-2014-authoritative-environment-v4`（`sha256:8d0df2563b1e9fca31b1ab7b1678683075fc013b5220ba7b32aa054861203685`），复用同一环境 FSM 并增加 `character-proficiency-srd51-2014-v1`（`sha256:718bf64554e4b032f3bea564797edf67b1695c2335879db4bd3e5332069a1001`）的 2014 Expertise/豁免熟练语义。Registry 同时保留三代完整 manifest/canonical document 和原 hash，Room genesis 必须精确匹配，不能以产品代际、字段存在或共享 helper 静默升级旧事件。

D1 变化只从 `db/schema.ts` 生成只增不改 migration，并先通过本地 migration/写入/查询/重建闭环；D1 FTS 永远是派生索引。`0008`/`0009` 实现静态 corpus/FTS、房间 workflow 绑定和 corpus/profile/hash 加固；`0010` 是一次性逻辑 scrub，只清空三张可重建派生索引表；`0011_low_leo.sql`（SHA-256 `da8aa71c0ac9e909b890d02536c7eb6cc555e1c9b0fdb29808fcf77903863a8e`）只新增灾备 checkpoint 表。checkpoint 仅在随机已结清、完整 event prefix 与 head audit 精确集合物化后的最终 D1 batch 单调推进；reader 只接受精确 room/epoch、重放并核验 checkpoint prefix，并拒绝 checkpoint 之后的 ahead event、genesis 冲突或 prefix 篡改，恢复只允许 service capability 且目标 DO 必须为空。Wrangler local `0000–0011`、SQLite `0010→0011` 写读、archive D1 11/11 与 D1 reader→fresh DO 1/1 已通过；另有无当前受控 viewer 的 D1→fresh DO 1/1。发布阶段已在既有远端 `DB` 串行应用 `0008–0011` 并复核无 pending；临时 checkpoint 写读后已精确清理，没有创建新 D1 或其他资源。

## 当前实现证据边界

当前源码已有私有 Form/Context、一次窄修订、CausalActionProgram Rules interpreter、body-only Narration、action/narration 双状态、逐 ViewerKey 恢复、十个公开错误、静态 D1 FTS、双模式动态环境和 v4 角色熟练的生产映射。定向结果包括 Profile/causal/compound 57/57、workflow/table 25/25、动态环境 Room 6/6、静态 corpus/production context 14/14、public action/table 21/21、Viewer recovery 4/4、Planner Profile 6/6、archive D1 11/11（含 prefix/ahead event/genesis conflict 防线）、真实 D1 reader→fresh DO 1/1、无当前受控 viewer 的 D1→fresh DO 1/1、120 条结构报告 4/4 且 16/16 hard gates，以及 live harness/provisioner 13/13 的确定性 HTTP 生命周期、默认 31 interaction 约束和显式三交互冒烟边界。最后一项不包含真实 Provider 调用。

新增生产 seam 长轨迹也已在 workflow-v2/environment-v4 上通过 1/1：31 次真实 Room 接口交互由 15 次 Intent/RootAction/Proposal、15 次 ACK 与 1 次 Bob viewer-local retry 组成；每个 Intent 都经过生产 Form allowlist、三层 Context、validator、compiler、Room、Rules 与 projector，同轨迹结算 `area-hazard` 对 2 个实体的完整 trigger/resolve/debris，并结算 KP 自定义竹骨声屏 `state-only` 且保持 `hazard/areaEffect=null`。没有重复 Proposal、随机或资源；archive 恢复到 fresh DO 后最终 state hash 与每位 Viewer 的 projection hash 均一致。Viewer recovery 与动态环境 Room 分别为 4/4 和 6/6。

发布源码 `4822d2b62d40d922758e77762f378495398958f8` 已更新既有 Worker `zhuwei`；Cloudflare Version `97291f34-67cf-47a4-a9f6-899db6ee975a` / deployment `834c2b79-c24f-4d7c-9aca-ef523b4e7eea` 承接 100% 流量。已部署前端壳在 375×812 与 1440×900 各完成观察、NPC 对话、Proposal 失败、Narration 重试和动态环境入口的前端视觉/DOM 验收，共 10/10。五条路径的页面数据均由公开 DTO 注入；其中本规格明示允许的 Proposal 失败、Narration 重试与动态环境三路使用确定性故障/动态注入，增加的 Provider action 为 0。两档无横向溢出、console/page error、失败请求或秘密 DOM/ARIA/网络正文旁路；Narration 失败后已提交行动保持单一可见，重试没有重复 settlement。该证据只验收已部署前端的视觉/DOM 边界，不声称五路浏览器流程穿过真实 `/api/game`/auth/Room/Provider；后者由下述独立三交互 smoke 提供。浏览器 QA 的临时会话与账号已精确清理，语音/TTS 和完整战术地图纵切仍未覆盖。

唯一一次 `--interactions=3` 生产运行实际完成 3/3 HTTP/auth/Room/Provider 交互且 `liveModelVerified=true`；原命令因旧 evaluator 把合法 compact V3 receipt 误判为第二权威而退出 1。`9cc5e3cd97143ac1f6ad2e26513a91e82e617f3e` 已修正该纯评测器判断并通过定向检查，但依据三交互上限没有重跑生产 Provider，因此不能把原命令记成绿色，也不能据此填写 Provider tokenizer、端到端 p95、平均调用数、正常 fallback、真实首次合法率或完整质量阈值。用户已明确豁免本轮完整门；这些门没有在最终源码上重跑，不能改写为通过。功能源码与 evaluator 提交 `9cc5e3cd97143ac1f6ad2e26513a91e82e617f3e` 已非 force 进入 `origin/cloudflare` 提交历史，复核时远端 `main` 仍为 `29eb06dc009c983ad61b2d862454503e67a7f40a`；其后的发布事实只追加 docs-only 提交。ADR 的“已接受”、定向绿色和已部署事实都不等于完整线上质量评测完成。

## 验收

1. SPEC 0015 的十 Form、三层 Context、静态重读、1+1 修订、body-only、双状态、逐受众恢复、模型角色、G0–G5 门和十错误有真实公开责任 Interface 证据。
2. 120 条金标、Recall/Form/token/延迟/调用/回退指标及置信区间达门；故障注入与零容忍项全部通过。
3. 任意 KP 自定义环境不经对象名/archetype 派发；`state-only` 无伪造 Hazard/Area/区域 save/区域目标 damage；通用 `area-hazard` 场景经真实 Form/Context/validator/compiler → Room Action → Rules → Room DO → project/replay，覆盖完整 Geometry、多/隐藏目标、致死、残骸、断线、幂等和逐受众失败。具体吊灯专项不再是完成前置。
4. 若有 D1 migration，本地与远端证据完整；375px/1440px 五条浏览器路径、全量门、现有 Worker 部署、线上冒烟、临时数据清理与 Git/`main` SHA 证明齐全。
5. 以上证据缺一项时，ADR/SPEC 已接受不等于实现或发布完成。
