Goal: 在 `/home/ubuntu/workspace/zhuwei` 的 `cloudflare` 分支，将烛帷 V3 的“私有小表 Proposal＋三层 Context Pack＋RAG/可选辅助模型＋Body-only Narration＋行动/叙事双状态＋动态战术环境”方案正式规格化、完整实现、量化验证并发布；始终以 SPEC 0001 为最高产品合同，完成 Cloudflare 部署和 GitHub 推送后才结束。

你是本项目的主负责人，可以在下述边界内自主裁定架构与实现细节，不要因普通实现选择停下来询问用户，不要只完成文档、原型或局部切片。遇到失败应定位第一个违反不变量的位置并继续修复，不能用伪成功、吞错、备用跳转、缩小 KP 权限或自动换模型绕过问题。

开始前：
- 完整阅读根目录 `AGENTS.md`、`CONTEXT.md`、`README.md`。
- 完整阅读 `docs/specs/0001-llm-kp-responsibility-contract.md`。
- 阅读直接相关的 `SPEC 0003/0010/0011/0014`、ADR-0013、规格索引、决策记录、追踪矩阵及 `docs/agent/release.md`；如启用并行，先读 `docs/agent/parallel.md`。
- 检查 Git 状态、当前分支、远端和用户已有改动；只在 `cloudflare` 分支工作，保留并绕开无关用户改动。
- 记录远端 `main` SHA，并在整个任务中证明它没有变化；不得 checkout、merge、push、force-push 或提交到 `main`。
- 先测量现有 G0 基线：Proposal Schema 字节数、输入/输出 token、模型调用数、延迟、首次验证通过率和失败分类。

产品与权威不变量：
- `SPEC 0001` 不得修改、缩小或被实现便利取代；LLM/KP 继续拥有开放世界创作、可行性、风险、DC、NPC、失败、节奏和叙事裁决权。
- 玩家始终提交自然语言意图，不暴露 Form、RAG 查询、规则原语、事件、状态补丁、骰面、Audience 或实际区域目标。
- 对外保留一个深 Room Action Module Interface；页面、语音、图片和 API 只形成经过认证的 Intent/Answer/Retry/Acknowledge。
- Rules Module 外部 Interface 仍严格只有 `step / project / replay`；不得建立第四条机械、投影、随机、回放或恢复路径。
- Room Durable Object 继续是活跃 WorldState、连续事件、作用域版本、Pending、Receipt、权威随机、AudienceSnapshot、Delivery 和恢复 capability 的唯一权威。
- D1、RAG、模型缓存、页面、日志、测试 fixture 和 Vectorize 都不能成为第二状态权威。
- 产品代际为 V3，当前机械解释器版本轴仍独立；不得把既有房间、规则、事件或投影静默改名为 v3。
- 所有新协议只用于新 V3 房间；不兼容变化要求重新开房，不猜测迁移旧房状态。

必须实现的运行流程：
1. Room DO `prepare` 完成可信鉴权、控制权、幂等、相关作用域和 PreparedAction 固化。
2. 从 `project`/Room Authority 构造不可由 RAG 删除的 RequiredContext。
3. Room 根据权威状态筛出本次允许的 3–6 张私有小表；可选 Planner 只能排序或补充查询，不能删除 `compound` 或替玩家解释意图。
4. 静态检索取得相关 SRD 5.1、模组和 Story Bible 原文。
5. 主 KP 选择并填写一张表。
6. 本地完成 Schema、引用、authority 字段、权限、版本和有界因果结构验证。
7. 将表格草稿确定性编译成版本化、封闭、无环、有界的 CausalActionProgram。
8. Rules `step` 完成诊断、权威随机请求、机械执行和作用域证明。
9. Room DO 提交同一 RootAction 的事实、机械事件、Receipt 和 AudienceSnapshot。
10. `project(viewer)` 为每个受众产生专属 `renderableClaims`。
11. 主 KP 仅依据该受众已提交投影输出 `{ body }`。
12. Grounding 校验后按受众独立发布；一个受众失败不得阻塞其他受众。

私有 Form Catalog 至少包含：
- `clarification.v1`
- `observe.v1`
- `npc-exchange.v1`
- `ordinary-check.v1`
- `high-risk-action.v1`
- `in-world-refusal.v1`
- `materialization.v1`
- `combat-action.v1`
- `environmental-stunt.v1`
- `compound.v1`

Form 只属于模型侧内部 Interface：
- 已有结构化 UI 的移动、休息、反应和待决选择由服务器确定表格。
- `compound` 必须始终是未预见、动态、多目标、多阶段和跨作用域行动的完整逃生舱。
- actor、principal、Audience、骰面、实际目标、Profile、状态、事件和作用域版本由服务器/Rules 派生，不能要求模型填写。
- Form Catalog、Action Language、编译器和 primitive vocabulary 必须以 Profile/hash 注册。
- 新 Form 若只复用既有机械原语，可以只发布 Form/Profile；新增机械原语必须发布新的 Rules manifest/interpreter。
- 不得静默改变既有 `authoritative-kp-action-plan-v1` 的含义。

Proposal 首次成功与修订：
- 主 KP普通路径最多一次 Proposal 调用；异常时最多使用一次窄修订预算。
- 修订只携所选 Form Schema、原草稿、合并后的精确错误、有限引用列表和冻结语义 hash。
- 修订可以修复字段、引用、机械组合，或在原表过窄时只升级到 `compound`。
- 修订不得改变玩家 goal、method、target、已确认选择或已生成 NPC 回应的语义。
- 修订不得重新发送完整模组、完整历史或完整 Story Bible。
- 看到任何骰面后不得改变 DC、风险、成本、对象属性、目标选择规则或成功/失败后果。
- 一次修订后仍非法，返回明确 `needsKp` 或稳定技术错误；不得第三次重发完整 Prompt。

三层 Context Pack：
- RequiredContext 必须直接来自 Room Authority/project，至少包含：原始意图、可信角色与控制权、当前场景动态状态、Encounter/回合/行动经济/位置/HP/资源/状态、相关 NPC 有限知识与计划、Pending/Activity/虚构时间、相关已固化事实/先例/动态定义、固定 Rules/Geometry/Module/Event Profile、相关核心真相约束、内容边界及最近 8–12 条相关亲历对话。
- RetrievedContext 只检索静态规则、模组、Story Bible、Ability、敌人和环境定义；每个 chunk 必须携 `sourceRef/sourceHash/sourceSpan/profileRef/sensitivity/dependencyRefs/purpose`。
- OptionalContext 包含声口、主题、次要背景和轻量索引，预算不足时最先裁剪。
- 动态房间状态、当前战术位置和角色/NPC知识不得写入 RAG 索引。
- 模型摘要不能替代权威原文；检索命中只返回 ref，服务器必须重新读取并检查 Profile/hash/权限。
- 模组编译时建立场景、NPC、线索、危险与核心真相的结构依赖；最短相关真相约束进入 RequiredContext，完整秘密原文只在当前行动真正触及时进入 KP-only 检索。
- NPC Context 必须重新按 NPC Viewer 投影，不能继承 KP 全知检索内容。
- Narration 阶段不得接收 Story Bible 或完整 KP Context。

RAG 与实验：
- 首期生产候选采用“结构引用/精确别名 → D1 FTS → 确定性合并与权威原文重取”。
- 为中文生成实体别名、双字词、规则术语和结构关系；D1 FTS 是可重建派生索引，不是事实源。
- 实验组固定为：
  - G0：当前超级 Schema＋完整上下文。
  - G1：小表＋当前完整上下文。
  - G2：小表＋三层 Context Pack＋D1 FTS。
  - G3：G2＋可选 Context Planner。
  - G4：G3＋本地精确 Embedding/Vectorize 对照。
  - G5：只有召回足够但排序明显失败时才测试辅助模型 rerank。
- G2 是默认发布候选；G3/G4/G5 只有达到量化增益门才纳入。
- Planner、Embedding、Vectorize 必须有 Disabled/确定性测试 Adapter。
- 未经用户另行明确授权，不得创建远端 Vectorize、新 Worker、新 D1、第二 DO、KV、R2、Queue、Workflow 或其他 Cloudflare 资源；G4 先使用本地精确向量对照。
- 如果 G3/G4 未达最小增益，删除未采用的产品接线并诚实停在 G2，不得为了“使用了 AI/RAG”而保留无价值复杂度。

辅助模型：
- 建立角色化、可扩展 Model Profile Registry，记录 provider、model ID/revision、supportedRoles、验证套件版本、structured-output 模式、上下文、延迟和成本等级。
- 辅助模型只允许：表格排序建议、实体/代词候选、规则和模组查询生成、chunk rerank、缺失引用和纯结构错误提示。
- 辅助模型不得决定可行性、DC、危险、失败后果、NPC 台词、世界事实、敌人、实际区域目标、Audience、可见性、骰面、事件或状态补丁。
- 主 KP选择在 UI 中保持主要视觉层级并继续按房间固定。
- Context Planner 放在次要/高级设置中，至少提供“关闭/确定性检索”和一个经过验证的 Planner。
- DeepSeek V4 Flash 可以作为辅助候选，但必须使用独立 Planner Profile/Receipt 并通过该角色的真实验证。
- 可以自行实现其他 Provider Adapter，但只有通过中文、结构化输出、schema/allowlist、秘密 canary、延迟、错误和故障注入验证的具体 Model/Profile 才可出现在 UI。
- 辅助模型可在新 RootAction 边界更换；当前 RootAction 必须固定原 Profile。
- 不允许隐藏自动切换模型；Planner 失败回退确定性查询，不改变主 KP。

动态战术环境：
- 实现新的版本化动态 EnvironmentFeature/DestructibleDefinition/TriggeredHazard/AreaEffect/EnvironmentStateGraph 编译与结算能力。
- `environmental-stunt.v1` 必须支持吊灯、油桶、书架/石柱、吊桥、火盆、闸门、临时掩体、可破坏地板/楼梯和环境阻断等即兴行动。
- KP 决定合理性、开放留白、位置/材质/尺寸/高度、对象 AC/耐久/阈值/免疫、行动方法、触发条件、区域、豁免、伤害、状态和残骸后果。
- 玩家不能凭一句话召唤有利物件；既有对象必须复用稳定 ID/状态，明确不存在时正常世界内拒绝，合理开放留白必须在任何骰面前固化。
- KP/客户端不得提交实际受影响实体集合；Rules 必须从完整权威 Geometry 计算 caster、ally、enemy、hidden entity 和 environment feature 的实际集合。
- 隐藏目标可被机械影响，但不能从公开 preview、错误、DOM、Narration 或列表长度泄漏。
- 动态定义、攻击/检定、对象破坏、区域豁免、伤害、状态、死亡和残骸地形必须属于同一 RootAction/Receipt 和可恢复事件链。
- 不实现通用物理引擎；只实现版本化有限状态和受信任 Rules 原语。
- 合理但高伤害或致命的环境后果不得按队伍等级自动削弱。

吊灯强制因果链：
`materialize/reuse feature → 消耗行动/弹药 → 攻击锁链 → 对象命中与伤害 → 达到阈值后 suspended→falling → Rules 计算区域目标 → 各目标豁免 → 伤害/状态/死亡 → falling→debris → 更新地形/掩护/通行`。
未命中、命中未破坏、成功坠落必须是不同且骰前冻结的合法分支。

Body-only Narration：
- 模型 Narration Schema 必须严格只允许 `{ body: non-empty string }`。
- 删除模型输出的 `tts`、`decisionPrompt`、`referencedProjectionRefs` 和 `agencyClaims`。
- Audience、Receipt、projectionHash、derivedEvidenceRefs、derivedAgencyClaims、Narration Policy 和 ModelInvocationReceipt 由服务器派生并绑定。
- Narration 输入只包含当前 Receipt、actorAction、renderableClaims、pressure、opportunities 和有限 recentDialogue；不得重复完整 WorldState、Story Bible、非当前资料、房间协调元数据或完整历史。
- 下一步提示可写在 body 末句；TTS 必须由同一 body 派生或客户端朗读，不能让模型另写语义不同的文本。
- Grounding 拒绝必须显式失败，不能生成固定剧情兜底。

行动与 Narration 双状态：
- 删除模糊顶层 `ok`，公开结果必须分别表达：
  - action：`notCommitted | awaitingInput | committed | resolvedInWorld | concluded`
  - narration：`notApplicable | pending | published | rejected | retryableFailure`
- Proposal 未提交时前端保留草稿并允许相同 submission ID 重试。
- 行动已提交但 Narration 失败时保留玩家行动气泡，不回填输入框、不撤销世界结果、不重复 Proposal/骰子/资源。
- “重试 KP 回复”只使用原 Receipt 和该受众冻结投影。
- NPC 拒绝、缺前提和违反世界规律属于正常 `resolvedInWorld`，不是 Provider 技术错误。
- 删除包括“刚才的尝试已经结算。眼下没有更多可以确认的新变化。”在内的全部伪成功 fallback。
- 多受众按 `(rootActionId, ViewerKey, projectionHash, deliveryGeneration)` 独立 pending/retry/publish/supersede；一个受众失败不阻止其他受众。
- Audience 只能由提交时的 `project` 冻结；LLM、页面、房主、队长和投递器无权扩大。
- 在场且有观察资格的 ViewerKey 获得自己的回应和亲历记录；不在场者不能获得或后来补取。ACK、刷新、离场和回场不删除原 ViewerKey 已成功发布的亲历文本；换席、新控制者和其他角色不继承旧记录；不得建立全桌共享旁白历史。

公开错误与日志：
- 至少稳定实现：
  `PROPOSAL_PROVIDER_TIMEOUT`
  `PROPOSAL_FORM_INVALID`
  `PROPOSAL_REFERENCE_INVALID`
  `PROPOSAL_RULES_DIAGNOSTIC`
  `PROPOSAL_REPAIR_EXHAUSTED`
  `CONTEXT_INSUFFICIENT`
  `NARRATION_PROVIDER_TIMEOUT`
  `NARRATION_BODY_INVALID`
  `NARRATION_GROUNDING_REJECTED`
  `NARRATION_PUBLICATION_FAILED`
- Planner、FTS、Embedding、Vectorize 和辅助模型失败只记录降级阶段；RequiredContext 足够时不得让行动失败。
- 日志只允许阶段、Form/Profile、模型、token、耗时、错误码、fallback、hash 和命中数量桶；不得记录 Prompt、玩家正文、NPC秘密、模组真相、chunk 原文、模型原始输出、Cookie、Token 或密钥。

实施顺序：
1. 将本 Goal 的产品裁定写成新的正式 SPEC/必要 ADR/决策记录，并更新 specs README、追踪矩阵和实现映射；不得修改 SPEC 0001。若与下位已批准规格冲突，以本 Goal 的新增窄裁定修订对应条款并记录 supersede 原因。
2. 修复交付语义：删除伪成功，拆分 action/narration 状态，保证已提交行动不撤回。
3. 实现 Body-only Narration、服务器派生元数据和缩小后的 Narration Context。
4. 深化 Room Action Module，落地私有小表目录、`compound` 和新的 Action Language/Profile。
5. 实现三层 Context Pack、静态语料编译、中文别名和 D1 FTS。
6. 实现动态环境编译器、环境有限状态和完整吊灯纵切。
7. 实现一次窄修订和冻结语义校验。
8. 实现 Model Profile Registry、次要 Planner 选择和至少一个经过验证的 Planner。
9. 实现逐受众独立 Narration 发布、失败恢复和亲历记录一致性。
10. 运行 G0–G5 适用实验；只保留达到门槛的 G2/G3/G4/G5 组合。
11. 完成定向测试、120 条金标评测、31 轮连续评测、故障注入、浏览器验收和完整发布门。
12. 必要时生成并审查只增不改的 D1 migration，先本地写入—读取闭环，再对现有远端 D1 应用。
13. 构建、部署现有 Cloudflare Worker、执行线上有界冒烟、非 force 推送 `cloudflare` 分支，并证明远端 `main` 未变化。
14. 在 `docs/refactor-log.md` 写入清晰完整的规格、实现、实验、测试、migration、部署、commit、push、外部调用和剩余限制审计。

Completion criteria:
- [ ] 新正式 SPEC、必要 ADR、decision register、specs README 和 traceability matrix 已完整表达本 Goal，且 `SPEC 0001` 字节未改。
- [ ] 外部 Room Action Interface 仍只接受认证后的玩家输入，Rules 包入口仍只有 `step/project/replay`，结构护栏能自动拒绝第二机械/投影/随机/回放路径。
- [ ] Form Catalog 至少覆盖十类指定 Form；普通调用只收到当前允许的 3–6 张，`compound` 在不确定路径始终存在。
- [ ] 新 Action Language/Profile 与旧 `authoritative-kp-action-plan-v1` 显式分离，Form 编译结果有限、无环、有界，不能包含脚本、JSON Patch、事件、骰面或 authority 字段。
- [ ] 一次窄修订冻结 goal/method/target/playerChoices；测试证明不会重发完整模组/历史，修订耗尽后不会第三次完整调用。
- [ ] Required/Retrieved/Optional 三层上下文已实现；动态房间状态不进入索引，检索结果必须按 source/profile/hash 重取。
- [ ] D1 FTS、中文别名、结构引用和确定性回退有真实本地写入—查询测试；索引可从权威静态语料重建。
- [ ] 辅助模型 UI 提供关闭选项和至少一个经过真实验证的 Planner；只有通过角色验证套件的具体 Profile 可见，失败不自动切换主 KP。
- [ ] Narration 模型 Schema 只接受 `{body}`；旧四个模型字段及固定伪成功 fallback 已从生产路径和同义测试中删除。
- [ ] action/narration 双状态贯穿类型、Room、API、页面、恢复和错误；已提交但 Narration 失败时不会撤回玩家气泡、重提案、重掷或重复消耗。
- [ ] 多受众独立发布通过：Alice 成功可发布，Bob 失败只进入 Bob 的 retry；不在场者不能补取，原 ViewerKey 可查看自己的成功亲历记录。
- [ ] 动态环境支持新建或复用 EnvironmentFeature、对象破坏、触发 Hazard、Rules 几何目标、逐目标豁免/伤害/死亡和残骸状态，全部可 archive/replay/correction。
- [ ] 吊灯专项 14 个场景全部通过：既有复用、合理留白骰前固化、明确无吊灯拒绝、失手、命中未破坏、成功坠落、多目标豁免、隐藏目标、致死、残骸改变地形、受众独立失败、断线/驱逐不重掷、回放一致、幂等不重复生成。
- [ ] 120 条金标样例覆盖观察、NPC、重大歧义、高风险、缺前提、动态事实、隐藏现实、个人知识、NPC有限知识、有意义失败、Activity、战斗/资源/收束。
- [ ] 关键 Context ref recall = 100%，全部 required ref Recall@8 ≥ 98%。
- [ ] 简单 Form 首次合法率 ≥ 97%，`compound` 首次合法率 ≥ 95%，一次窄修订后最终合法率 ≥ 99%，可执行路由覆盖率 ≥ 99.5%，复杂行动误入简单表为 0。
- [ ] 简单 Proposal 输入 p95 ≤ 8k tokens，全体 p95 ≤ 16k，Narration p95 ≤ 5k；相对 G0 输入 token 中位数下降 ≥ 50%，小表 Schema 中位数下降 ≥ 60%。
- [ ] Proposal 端到端 p95 ≤ 20 秒，主 Proposal 平均调用数 ≤ 1.10/RootAction，正常 Planner/RAG 回退率 ≤ 5%；报告分子/分母、p50/p95 和适当置信区间。
- [ ] Planner/RAG/Embedding/Vectorize/辅助模型分别故障注入时安全回退率 100%，世界事实、骰面、资源、虚构时间和玩家意图变化均为 0。
- [ ] 秘密泄漏、第二权威、模型/客户端骰面、客户端实际 target list、任意状态 patch、重复随机/资源/事件、自动换主 KP 均为 0。
- [ ] 现有 31 轮 KP 评测及其全部硬门通过；新增长轨迹覆盖动态环境和逐受众 Narration 恢复。
- [ ] `git diff --check`、目标定向测试、`npm run typecheck`、`npm run lint`、`npm run module:check`、`npm test`、`npm run build` 全部退出 0。
- [ ] 真实浏览器在 375px 与 1440px 完成观察、NPC 对话、Proposal 失败、Narration 重试和动态环境入口验收，无横向溢出、console error 或秘密 DOM 旁路。
- [ ] 若有 D1 schema 变化，`db/schema.ts` 为源、生成 migration 只增不改、本地 migration 与写入—读取闭环通过，远端现有 D1 migration 成功且无 pending；若无变化，日志明确记录不需要 migration。
- [ ] `npm run cf:deploy` 成功部署现有 Worker；线上 HTTP、认证、建房、一次普通 KP 行动、Narration 失败恢复及权威状态读取冒烟通过，不创建新 Cloudflare 资源。
- [ ] 所有临时账号、房间、实验数据和未采用的本地原型均按既有安全流程清理；不删除真实用户数据。
- [ ] 功能与发布提交已非 force 推送到 `origin/cloudflare`，远端 `cloudflare` 等于交付 SHA，远端 `main` 仍等于任务开始记录的 SHA。
- [ ] `docs/refactor-log.md` 包含清晰的基线、根因、规格裁定、实现文件、实验结果、测试命令/退出码、migration、外部调用、部署版本、commit/push、主分支证明和诚实剩余限制。
- [ ] 最终回执列出：最终架构、采用的实验组、被拒绝的实验及理由、所有指标、测试证据、migration、部署 URL/版本、Git SHA、远端分支证明和未覆盖范围；没有把未运行、失败或样本不足写成通过。

Constraints:
- 只在 `cloudflare` 分支和现有 V3 工作树实施；不得改动、合并或推送 `main`。
- 保持现有 Worker `zhuwei`、入口 `worker/index.ts`、D1 binding `DB`、Durable Object `ROOMS`、Workers AI binding `AI` 和现有部署路径；不得用 Sites、Vercel、新 Worker 或第二状态资源替代。
- 只允许必要的增量 D1 migration；已生成 migration 只增不改。
- 不得自动购买额度、启用收费资源或消费 Codex/ChatGPT usage reset；外部验证使用已有授权与可用免费额度。额度不足时减少非必要实验并如实记录，不能伪造通过。
- Vectorize 是条件实验，不是完成前置；未经另行授权不得创建远端索引。
- 不得隐藏自动切换主 KP、按玩家等级平衡危险、在骰后改判、建立第二权威、记录 Prompt/正文/秘密，或以 Legacy/伪成功兜底绕开错误。
- 保留开房、席位、建卡、语音、线索、日志、装备、资源、地点/时钟、组队、休整、战斗、地图、长团成长和跨章节连续性等既有能力。
- 遵守仓库 AGENTS 的分层、验证、日志、并行、迁移和发布要求；完成前不要停在“建议下一步”。
