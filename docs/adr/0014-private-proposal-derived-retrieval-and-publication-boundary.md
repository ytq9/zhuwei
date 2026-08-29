# 私有 Proposal、派生检索与逐受众发布状态保持权威边界

- 状态：已接受（用户本 Goal 明确授权）
- 日期：2026-08-29
- 关联规格：SPEC 0001、SPEC 0003、SPEC 0005、SPEC 0006、SPEC 0010、SPEC 0011、SPEC 0013、SPEC 0014、SPEC 0015

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

G2（小表 + 三层 Context + D1 FTS）是默认发布候选。G3/G4/G5 只有在同一 120 条金标上满足 SPEC 0015 的质量、安全、token/延迟与增益门才进入产品；未达门的产品接线删除。未经用户另行授权不创建远端 Vectorize 或其他 Cloudflare 资源。

### 6. 动态环境复用现有 Room/Rules/Geometry

EnvironmentFeature、DestructibleDefinition、TriggeredHazard、AreaEffect 和 EnvironmentStateGraph 是版本化有限状态。KP 决定合理性和骰前定义，Rules 从完整 Geometry 决定实际目标并执行状态转换，Room DO 在同一 RootAction/Receipt 提交。吊灯纵切用于证明 materialize/reuse、攻击锁链、对象破坏、坠落区域、逐目标豁免/伤害/死亡和残骸地形是一条可恢复链，而不是通用物理引擎或客户端 target list。

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

代价：需要版本化 Form/Action Language/corpus/model/narration/publication Profiles、D1 FTS 构建链、Gold eval、逐受众发布 journal 和更严格的浏览器/故障证据。G3–G5 可能全部被拒绝，产品仍应诚实停在 G2。

安全影响：Prompt、正文、秘密和 chunk 原文不得进日志；Retrieved ref 使用前重新鉴权；Audience 只在提交时冻结；Planner/RAG/模型失败不能扩大权限或更换主 KP；客户端永远看不到完整 Geometry/targets。

## 版本与迁移

该决定只对绑定完整新 Profile/manifest 的新 V3 房间生效。旧房的提案、Outcome、Delivery 和环境解释器保持原 genesis 行为，不从旧对话、Prompt、距离或事件猜测迁移。Form/Profile-only 变化与新增 Rules primitive 分别发布；所有 hash 都进入房间 manifest。未来迁移旧房需独立规格和用户授权。

D1 变化只从 `db/schema.ts` 生成只增不改 migration，并先通过本地 migration/写入/查询/重建闭环；D1 FTS 永远是派生索引。远端 migration、部署、清理和 push 按发布流程串行。

## 验收

1. SPEC 0015 的十 Form、三层 Context、静态重读、1+1 修订、body-only、双状态、逐受众恢复、模型角色、G0–G5 门和十错误有真实公开责任 Interface 证据。
2. 120 条金标、Recall/Form/token/延迟/调用/回退指标及置信区间达门；故障注入与零容忍项全部通过。
3. 吊灯 14 场景经真实 Room Action → Rules → Room DO → project/replay，通过隐藏目标、断线、幂等和逐受众失败验证。
4. 若有 D1 migration，本地与远端证据完整；375px/1440px 五条浏览器路径、全量门、现有 Worker 部署、线上冒烟、临时数据清理与 Git/`main` SHA 证明齐全。
5. 以上证据缺一项时，ADR/SPEC 已接受不等于实现或发布完成。
