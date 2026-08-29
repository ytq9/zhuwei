# SPEC 0015：私有 Form Proposal、Context Pack/RAG、提交后叙述与动态环境

- 状态：**已裁定（用户本 Goal 明确授权）**
- 裁定日期：2026-08-29
- 产品：烛帷 V3
- 适用规则：D&D 5e 2014 / SRD 5.1
- 上位规格：`SPEC 0001`（最高产品合同）、`SPEC 0003`、`SPEC 0005`、`SPEC 0006`、`SPEC 0007`、`SPEC 0010`、`SPEC 0011`、`SPEC 0012`、`SPEC 0013`、`SPEC 0014`
- ADR：[ADR-0014：私有提案、派生检索与发布状态边界](../adr/0014-private-proposal-derived-retrieval-and-publication-boundary.md)
- 适用边界：只用于启用本规格完整 Profile/manifest 的**新 V3 房间**；不静默迁移、重命名或重解释既有房间

## 1. 目的、权威顺序与不变 Interface

本规格把玩家自然语言意图送入“私有小表 Proposal → 三层 Context Pack → 静态 RAG → 封闭因果程序 → Rules → Room DO → 逐受众 Body-only Narration”管线。它降低超级 Schema 和完整上下文的成本，但不把 KP 降为命令翻译器，不缩小 `SPEC 0001` 赋予 KP 的开放世界创作、可行性、风险、DC、NPC、失败、节奏和叙事裁决权。

以下边界保持不变：

1. 玩家只提交自然语言 `Intent`、待决 `Answer`、`Retry` 或 `Acknowledge`；Form、查询、引用、机械原语、事件、状态 patch、骰面、Audience 与实际区域目标都不进入玩家 Interface。
2. 对外仍只有一个深 Room Action Module。页面、语音、图片和 API 只是输入/呈现 Adapter。
3. Rules Module 外部仍严格只有 `step / project / replay`。Proposal 编译器、检索器、环境定义编译器和 Grounding 校验器都不是第四条机械、投影或回放路径。
4. Room Durable Object 仍是活跃 WorldState、连续事件、作用域版本、Pending、Receipt、权威随机、AudienceSnapshot、逐受众发布状态和恢复 capability 的唯一权威。
5. D1、FTS、Vectorize、本地 embedding、模型缓存、日志、页面、测试 fixture 和 Delivery 文本都不能成为第二状态权威。
6. 叙述文本不是正史；事实、知识、机械、Audience 和可恢复发布依据必须先由 `step`、Room DO 与 `project(viewer)` 固化。

当前机械解释器版本轴与产品代际继续分离。V3 不等于 ruleset v3；仍被房间 manifest 精确固定的 `dnd5e-2014-srd5.1-authoritative-v2` 不因本规格静默改名。只复用既有机械原语的新 Form 可以发布新的 Form/Action Language/Profile；新增机械原语必须发布新的 Rules manifest/interpreter，并保留旧房解释器。

## 2. 固定十二步运行流程

每个新 RootAction 的生产顺序固定为：

1. Room DO `prepare` 重新鉴权，验证控制权、幂等 ID 与相关作用域，固化 `PreparedAction`、原始意图和冻结 Profile 引用。
2. 服务端从 Room Authority 与 `project` 构造不可被 Planner/RAG 删除的 `RequiredContext`。
3. Room 基于可信状态筛选本次允许的 3–6 张私有 Form；可选 Planner 只能排序或补充查询，不能删除必需 Form 或解释/改写玩家意图。
4. 静态检索取得相关 SRD 5.1、模组、Story Bible、Ability、敌人与环境定义引用；服务端按引用重读权威原文。
5. 主 KP 在所给 Form 中选择并填写一张 Proposal；`compound.v1` 作为不确定路径逃生舱。
6. 本地验证 Schema、引用、版本、权限、authority 禁止字段、冻结语义与有界结构。
7. 服务端把合法 Proposal 确定性编译为版本化、封闭、无环、有界的 `CausalActionProgram`。
8. Rules `step` 完成机械诊断、权威随机请求、执行与作用域证明；任何骰面只能来自 Room DO。
9. Room DO 在同一 RootAction 内原子提交事实、机械事件、Receipt、AudienceSnapshot 和逐受众 Narration pending 绑定。
10. `project(viewer)` 为每个冻结 ViewerKey 产生专属 `renderableClaims` 与 `projectionHash`。
11. 主 KP 只依据该受众的已提交投影生成严格 `{ body }`。
12. Grounding 校验后按受众独立发布；某一受众失败不得阻塞、撤销或重算其他受众或已提交行动。

模型、网络、D1、FTS、Planner 和 Narration 均位于 Room DO SQLite 提交事务之外。静态检索失败在 RequiredContext 已足够时只能降级为确定性查询；不得改变主 KP、世界事实或玩家意图。

## 3. 私有 Form Catalog

### 3.1 必备十 Form

Catalog 至少注册下列精确 ID：

| Form ID | 私有用途 | 允许表达的核心语义 |
| --- | --- | --- |
| `clarification.v1` | 重大歧义或玩家选择不足 | 歧义点、为何会实质改变结果、最小问题和有限选项；不提交世界结果 |
| `observe.v1` | 感知、调查、回忆、分析 | 观察焦点、做法、可直接取得的证据、必要检定/代价和隐藏现实边界 |
| `npc-exchange.v1` | 对话、交涉、欺骗、威吓、请求 | 玩家表达、NPC 有限知识/目标、回应、检定/代价和关系后果；不得替玩家选台词 |
| `ordinary-check.v1` | 单一常规不确定行动 | goal/method/target、检定语义、DC/成本/成功/失败后果 |
| `high-risk-action.v1` | 高危险、不可逆或多重代价行动 | 可感知预兆、冻结危险、代价、豁免/检定、失败新局面与 Activity |
| `in-world-refusal.v1` | 缺前提、不可能、违反已固化规律 | 世界内理由、真实尝试成本和仍可行动的信息；不是 Provider 错误 |
| `materialization.v1` | 在合理开放留白中固化动态事实/实体 | 依据、稳定 ID、定义/Profile、可见性、时间点和骰前冻结条件 |
| `combat-action.v1` | Encounter 内封闭战斗行动 | 玩家目标/做法对应的版本化能力、选择、成本、时点与后果；不自报骰面/实际区域集合 |
| `environmental-stunt.v1` | 利用、创造或改变有限环境要素 | feature 复用/形成、材质/尺寸/高度、状态图、触发、区域、对象阈值与残骸后果 |
| `compound.v1` | 未预见、动态、多目标、多阶段或跨作用域行动 | 有界阶段、依赖、条件分支、事实/机械/NPC/Activity/环境组合及原子边界 |

Form 只是模型侧内部 Interface，不是玩家命令菜单。已有结构化 UI 的移动、休息、反应和待决选择由服务端直接确定 Form；自然语言行动由 Room 状态筛选。普通动作只给当前相关的 3–6 张，且在意图不确定、跨域或任何候选可能过窄时必须包含 `compound.v1`。Planner 无权删除 `compound.v1`。

### 3.2 服务器派生字段与封闭字段

以下字段只能由可信服务端、Room Authority 或 Rules 派生，任何 Form 都不得要求模型填写：

- principal、actor、控制权和 ViewerKey；
- Audience、实际区域 target 集合、隐藏对象数量与可见性；
- 骰面、权威随机 ID、事件、状态 patch、scope revision/proof；
- Rules/Event/Geometry/Module/Profile 的实际固定版本；
- Receipt、发布 capability、projectionHash 和恢复游标。

每张 Form 是 `additionalProperties: false` 的版本化 closed schema，明确最大字段数、数组长度、字符串长度、阶段数和引用数。未知字段、脚本、表达式、JSON Patch、任意事件、骰面、authority 字段或未注册 primitive 一律 fail closed。

### 3.3 Form/Profile 发布

`FormCatalogProfile` 至少固定 Catalog ID/version/hash、各 Form schema hash、Action Language/Profile、编译器 hash、primitive vocabulary、兼容 Rules manifest 和 conformance suite。改变 Form 含义不得覆盖旧 hash；新增 Form 只在新 Profile 中出现。

本规格不得静默改变既有 `authoritative-kp-action-plan-v1` 的含义。新 Proposal 必须使用独立 schema/profile ID，并只通过显式 Adapter 编译到新 `CausalActionProgram`；旧房继续由旧提案解释器处理。

## 4. 三层 Context Pack

### 4.1 RequiredContext

`RequiredContext` 直接来自 Room Authority 与 `project`，Planner、RAG 和 token 裁剪器无权删除。它至少包含：

- 玩家原始意图、可信角色、控制权、提交/根行动绑定；
- 当前场景动态状态；Encounter、回合、行动经济、规范位置、HP、资源和状态；
- 相关 NPC 的有限知识、目标、计划与已生成回应；
- 当前 Pending、Activity、虚构时间、因果前沿和聚光灯；
- 相关已固化事实、裁决先例、动态定义和结构依赖；
- 固定 Rules/Geometry/Module/Event/Form/Action Language/Model Profile 引用与 hash；
- 与本次行动相关的最短核心真相约束、内容边界和安全限制；
- 最近 8–12 条与当前角色实际亲历且仍有权使用的相关对话。

RequiredContext 不等于完整 WorldState 或完整历史。它是由同一 projector/Authority 产生的最小充分权威切片；如果无法在不猜测或泄密的情况下构造，返回 `CONTEXT_INSUFFICIENT`，不得让模型补全缺失权威。

### 4.2 RetrievedContext

RetrievedContext 只允许来自静态、版本化语料：SRD 5.1、模组、Story Bible、Ability、敌人、环境定义和已批准裁决资料。每个 chunk 必须携带：

```ts
type RetrievedChunkRef = {
  sourceRef: string;
  sourceHash: string;
  sourceSpan: { start: number; end: number };
  profileRef: string;
  sensitivity: "public" | "player-known" | "kp-only";
  dependencyRefs: string[];
  purpose: "rule" | "module" | "truth-constraint" | "ability" | "enemy" | "environment";
};
```

检索命中只返回引用和排名依据。服务端必须重新读取权威源，验证 source/profile/hash/span、依赖、房间绑定和 Viewer/KP 权限后才装入上下文。模型摘要、FTS 行、embedding 向量或 reranker 文本都不能替代原文。

模组编译时建立 scene、NPC、线索、危险和核心真相的结构依赖。最短相关真相约束进入 RequiredContext；完整秘密原文只在行动真正触及时进入 KP-only RetrievedContext。NPC 决策必须重新按 NPC Viewer 投影，不能继承主 KP 的全知检索内容。

### 4.3 OptionalContext 与裁剪顺序

OptionalContext 只含声口、主题、次要背景和轻量索引。预算不足时先删除 Optional，再按确定性优先级缩短 RetrievedContext；RequiredContext 不得被删除或用摘要替代。裁剪必须留下输入 token、命中数量桶和选中引用 hash 的脱敏 Receipt，不记录正文。

Narration 阶段不接收 Story Bible、完整 KP Context、完整 WorldState、非当前模组资料、房间协调元数据或完整历史。

## 5. 静态 RAG 与派生索引

首期生产候选固定为：

```text
结构引用 / 精确别名
  → D1 FTS
  → 稳定排序与依赖合并
  → 按 sourceRef/profile/hash/权限重读权威原文
```

静态语料编译必须为中文实体生成规范别名、双字词、规则术语，并保存 scene/NPC/clue/hazard/core-truth/ability/environment 的结构关系。相同语料、Profile 与编译器输入必须产生规范等价 chunk、alias、dependency 和 corpus hash。

D1 FTS 是可从权威静态语料重建的派生索引，不保存活跃房间状态，也不裁定事实。下列内容严禁写入 RAG/FTS/向量索引：当前战术位置、HP/资源/状态、当前 Pending、角色或 NPC 当前知识、私人对话、当前 Audience、骰面、未归档动态事实和任何活跃 DO 快照。

检索失败、FTS 不可用或 Planner 超时时，RequiredContext 足够则回到结构引用/精确别名的确定性查询；RequiredContext 不足则显式失败。不得用“无检索结果”推断世界中不存在某物，也不得自动切换主 KP。

## 6. Proposal 验证、一次窄修订与语义冻结

### 6.1 调用预算

每个 RootAction 普通路径最多一次主 KP Proposal 调用；仅在本地 Schema、引用、版本或 Rules 诊断可被结构修复时，最多追加一次窄修订。一次修订后仍非法即返回 `needsKp` 或稳定 `PROPOSAL_REPAIR_EXHAUSTED`，不得第三次发送完整 Prompt。

### 6.2 冻结语义 hash

首次 Proposal 前对以下语义做规范化 hash：

- 玩家 `goal`、`method`、`target`；
- 已确认 `playerChoices`；
- 已产生并将被采用的 NPC 回应语义；
- PreparedAction、相关 scope baseline 与 Profile refs。

修订只能收到：所选 Form schema、原草稿、合并后的精确诊断、有限引用列表和冻结语义 hash。它可以修字段、引用和机械组合；原 Form 过窄时只能升级到 `compound.v1`。它不得改变上述冻结语义，不得重发完整模组、完整历史或完整 Story Bible。

任何权威骰面出现后，禁止改变 DC、风险、成本、对象属性、目标选择规则、成功/失败后果或环境阈值。语义 hash、引用或骰前参数不一致时 fail closed，不把非法 Proposal 当作世界内失败。

### 6.3 CausalActionProgram

合法 Form 由确定性编译器生成独立版本的 `CausalActionProgram`。它必须 closed、acyclic、bounded，节点和边数量有固定上限，分支条件只引用注册 primitive 和已冻结事实。它可以表达事实固化、NPC 回应、Activity、机械动作、环境状态转换与提交依赖，但不能包含脚本、任意表达式、JSON Patch、WorldEvent、骰面、authority 字段或客户端实际 target list。

编译结果仍只是 Rules Input 候选；只有 `step` 能诊断/执行，只有 Room DO 能提供随机并提交事件。新增 primitive 必须发布新的 Rules manifest/interpreter，而不是在编译器中藏一条机械路径。

## 7. Body-only Narration 与 Grounding

模型 Narration Schema 精确为：

```ts
type NarrationModelOutput = {
  body: string; // trim 后非空
};
```

Schema 必须 `additionalProperties: false`。模型输出不得包含 `tts`、`decisionPrompt`、`referencedProjectionRefs`、`agencyClaims` 或任何其他字段。下一步提示可以写在 `body` 末句；TTS 只能从同一 `body` 派生或由客户端朗读，不能另写语义不同的文本。

Narration 输入只包含该受众冻结的：当前 Receipt、`actorAction`、`renderableClaims`、pressure、opportunities 和有限 recentDialogue。Audience、Receipt 绑定、projectionHash、derivedEvidenceRefs、derivedAgencyClaims、Narration Policy 与 ModelInvocationReceipt 全由服务端派生。

Grounding 必须证明 body 的每项事实性/能动性主张均由冻结投影允许，不扩大 Audience、不泄露秘密、不代玩家选择、不改写已提交机械。拒绝返回 `NARRATION_GROUNDING_REJECTED`；不得生成固定剧情、伪成功或“没有更多变化”式 fallback。

## 8. 行动与 Narration 双状态

### 8.1 公开状态

新 V3 房间的公开结果禁止顶层模糊 `ok`，并分别表达：

```ts
type PublicActionState =
  | "notCommitted"
  | "awaitingInput"
  | "committed"
  | "resolvedInWorld"
  | "concluded";

type PublicNarrationState =
  | "notApplicable"
  | "pending"
  | "published"
  | "rejected"
  | "retryableFailure";
```

`notCommitted` 表示 Proposal/权限/平台尚未提交；`awaitingInput` 表示稳定等待合法主体；`committed` 表示已提交且仍可有后续机械/待决；`resolvedInWorld` 包含 NPC 拒绝、缺前提、违反世界规律、成功/失败等已经在世界内结算的结果；`concluded` 只用于已固化故事/章节收束。

Narration 只在存在该受众发布任务时进入 `pending`；合法正文发布为 `published`，Grounding/body 永久不合格为 `rejected`，Provider/投递暂时失败为 `retryableFailure`。没有叙述任务时为 `notApplicable`。

合法组合必须满足：`notCommitted|awaitingInput` 只能配 `notApplicable`；`committed|resolvedInWorld|concluded` 可按该 ViewerKey 是否需要叙述配 `notApplicable|pending|published|rejected|retryableFailure`。action 一旦进入 `committed|resolvedInWorld|concluded` 就不能因 Narration 状态回退为 `notCommitted` 或 `awaitingInput`；同一 RootAction 后续机械只通过既有 Pending/continuation 推进，不由 Narration 驱动。

### 8.2 失败与重试语义

- Proposal 未提交：前端保留玩家草稿，可用相同 submission ID 幂等重试；不得显示世界成功。
- 行动已提交但 Narration 失败：保留玩家行动气泡、Receipt 和世界结果；不回填输入框、不撤销事件、不重跑 Proposal、不重掷、不重复资源/虚构时间。
- “重试 KP 回复”只允许使用原 Receipt、原 ViewerKey、冻结投影和原 delivery generation；不能扩大 Audience 或重读当前变化后的全局状态。
- 固定伪成功 fallback 全部删除，包括“刚才的尝试已经结算。眼下没有更多可以确认的新变化。”及任何同义文本。

### 8.3 逐受众独立发布与亲历记录

发布状态以 `(rootActionId, ViewerKey, projectionHash, deliveryGeneration)` 为幂等键，独立经历 pending/retry/publish/supersede。Alice 发布成功不等待 Bob；Bob 失败只改变 Bob 的 Narration 状态。Audience 只能由提交时 `project` 冻结，LLM、页面、房主、队长和投递器无权扩大。

只有提交时在场且具观察资格的 ViewerKey 获得自己的回应和亲历记录。不在场者不能后来补取。ACK、刷新、离场和回场不删除原 ViewerKey 已成功发布的亲历文本；换席、新控制者和其他角色不继承旧记录；不得建立全桌共享旁白历史。其余保留/安全失效语义继续服从 `SPEC 0010`。

## 9. Model Profile Registry 与角色权限

统一 `ModelProfileRegistry` 为每个具体 Profile 固定 provider、model ID/revision、supportedRoles、验证套件版本、structured-output 模式、上下文上限、延迟等级、成本等级和 Profile hash。角色至少区分：

- `kp-proposal`：主 KP 的开放裁决与 Form Proposal；
- `kp-narration`：主 KP 的逐受众 body；
- `context-planner`：Form 排序、实体/代词候选与查询建议；
- `chunk-rerank`：仅重排已授权引用；
- `deterministic-disabled`：关闭辅助模型的确定性 Adapter。

辅助模型只允许 Form 排序建议、实体/代词候选、规则/模组查询生成、chunk rerank、缺失引用和纯结构错误提示。它不得决定可行性、DC、危险、失败后果、NPC 台词、世界事实、敌人、实际区域目标、Audience、可见性、骰面、事件或状态 patch。

UI 中主 KP 选择保持主要视觉层级并按房间固定；Context Planner 位于次要/高级设置，至少提供“关闭/确定性检索”和一个真实通过角色验证的 Planner。DeepSeek V4 Flash 可以是辅助候选，但必须拥有独立 Planner Profile/Receipt，并通过中文、structured output、schema/allowlist、秘密 canary、延迟、错误和故障注入验证后才可出现。

辅助 Profile 只能在新 RootAction 边界更换；当前 RootAction 固定原 Profile。Planner 失败回退确定性查询且不改变主 KP；禁止隐藏自动切换 provider/model。未通过验证的 Adapter 可以留在测试/实验层，但不得出现在生产 UI。

## 10. G0–G5 实验与采用门

实验组固定为：

| 组 | 配置 | 产品资格 |
| --- | --- | --- |
| G0 | 当前超级 Schema + 完整上下文 | 改造前基线，只用于同集比较 |
| G1 | 小表 + 当前完整上下文 | 分离 Form 收益，不是默认候选 |
| G2 | 小表 + 三层 Context Pack + D1 FTS | 默认发布候选 |
| G3 | G2 + 可选 Context Planner | 只有量化增益达门才采用 |
| G4 | G3 + 本地精确 Embedding/Vectorize 对照 | 只做本地对照；无另行授权不创建远端 Vectorize |
| G5 | 仅当召回足够但排序明显失败时，加辅助模型 rerank | 条件实验；达门才采用 |

所有组使用同一 120 条金标、相同语料/Profile、相同主 KP Profile、预注册随机种子/重复策略和统一评分器。先记录 G0 的 Schema 字节、输入/输出 token、调用数、延迟、首次合法率和失败分类，再实现/选择候选。

G2 只在 §13 全部硬门通过后发布。G3/G4/G5 还必须相对当前已采用前驱，在同一数据集至少满足一个预注册增益：关键/全部引用召回或首次合法率的**配对差值** 95% 置信区间下界为正，或 Proposal 输入 token/端到端 p95 至少下降 10%；同时安全零容忍项不变、最终合法率/可执行路由不退化、平均调用数与回退率仍达门。G5 还要求基线已达到召回门且能证明主要误差来自排序。

未达门的 Planner/Embedding/Vectorize/rerank 产品接线必须删除；只保留可复现实验记录、Disabled/确定性测试 Adapter 和诚实结论。不得为“使用 AI/RAG”保留无价值复杂度。

## 11. 动态战术环境与吊灯纵切

### 11.1 版本化对象

在 `SPEC 0014` 的同一权威 Geometry/事件/投影链上实现：

- `EnvironmentFeature`：稳定 ID、scene、geometry、材质/尺寸/高度、可见性、definition/profile 引用；
- `DestructibleDefinition`：AC、耐久/阈值、伤害类型、免疫、允许状态和残骸语义；
- `TriggeredHazard`：冻结触发条件、区域、豁免、伤害、状态、时点和结束条件；
- `AreaEffect`：来源、完整权威 Geometry 计算、持续/中断/到期；
- `EnvironmentStateGraph`：版本化有限状态、允许转换与每态移动/视线/掩护/通行语义。

`environmental-stunt.v1` 至少支持吊灯、油桶、书架/石柱、吊桥、火盆、闸门、临时掩体、可破坏地板/楼梯和环境阻断。KP 决定合理性、开放留白、位置/材质/尺寸/高度、对象 AC/耐久/阈值/免疫、做法、触发、区域、豁免、伤害、状态与残骸后果；这些会影响机械的参数必须在任何骰面前固化。

玩家一句话不能召唤有利物件。既有对象复用稳定 ID/状态；已明确不存在时正常 `resolvedInWorld` 拒绝；合理开放留白必须先用 `materialization.v1` 在骰前固化。Rules 从完整权威 Geometry 计算 caster、ally、enemy、hidden entity 和 environment feature 的实际集合；KP/客户端不能提交该集合。隐藏对象可被影响，但不得从 preview、错误、DOM、Narration 或列表长度泄漏。

不实现通用物理引擎，只执行版本化有限状态和 Rules primitive。合理但高伤害或致命的环境后果不得按队伍等级自动削弱。

### 11.2 吊灯强制因果链

```text
materialize/reuse feature
→ 消耗行动/弹药
→ 攻击锁链
→ 对象命中与伤害
→ 达到阈值后 suspended→falling
→ Rules 计算区域目标
→ 各目标豁免
→ 伤害/状态/死亡
→ falling→debris
→ 更新地形/掩护/通行
```

动态定义、攻击/检定、对象破坏、区域豁免、伤害、状态、死亡和残骸地形必须属于同一 RootAction/Receipt 和可恢复事件链。未命中、命中未破坏、成功坠落是三个骰前冻结且可回放的合法分支。

吊灯专项必须逐项证明 14 个场景：

1. 既有吊灯按稳定 ID/状态复用；
2. 合理开放留白在骰前固化；
3. 明确无吊灯时正常世界内拒绝；
4. 攻击失手；
5. 命中但未达到破坏阈值；
6. 成功坠落；
7. 多目标分别豁免；
8. 隐藏目标被正确结算且无侧漏；
9. 合理致死结果不被等级缩放；
10. 残骸改变地形、掩护或通行；
11. 某受众 Narration 失败不阻塞其他受众；
12. 断线/DO 驱逐后不重掷或重复消耗；
13. archive/replay 得到一致状态与投影；
14. 幂等重试不重复生成 feature、事件、随机或 Delivery。

## 12. 稳定错误、降级与日志

### 12.1 公开错误码

新管线至少稳定实现以下精确代码：

- `PROPOSAL_PROVIDER_TIMEOUT`
- `PROPOSAL_FORM_INVALID`
- `PROPOSAL_REFERENCE_INVALID`
- `PROPOSAL_RULES_DIAGNOSTIC`
- `PROPOSAL_REPAIR_EXHAUSTED`
- `CONTEXT_INSUFFICIENT`
- `NARRATION_PROVIDER_TIMEOUT`
- `NARRATION_BODY_INVALID`
- `NARRATION_GROUNDING_REJECTED`
- `NARRATION_PUBLICATION_FAILED`

错误响应只返回该 Viewer 有权知道的状态、稳定代码、公开 Receipt/重试提示。Planner、FTS、Embedding、Vectorize 和辅助模型失败只记录降级阶段；RequiredContext 足够时不得让行动失败。世界内拒绝、NPC 拒绝和缺前提不是 Provider 技术错误。

### 12.2 新管线日志白名单

对本规格的新 Proposal/Context/RAG/Narration 管线，日志字段只允许：阶段、Form/Profile、模型 ID/revision、输入/输出 token、耗时、公开错误码、fallback 类别、不可逆 hash 和命中数量桶。不得记录 Prompt、玩家正文、NPC 秘密、模组真相、chunk 原文、模型原始输出、Cookie、Authorization、Session/Token、密钥、完整 ID、WorldEvent、骰面候选或任何受众正文。

所有日志必须经过固定 schema/redaction serializer；`console.*` 只能接收该序列化结果。Telemetry、ModelInvocationReceipt 和实验报告都不是事件、Viewer 数据源或检索语料。

## 13. 量化验证与硬门

### 13.1 数据集与报告口径

金标集至少 120 条，覆盖观察、NPC、重大歧义、高风险、缺前提、动态事实、隐藏现实、个人知识、NPC 有限知识、有意义失败、Activity、战斗、资源和故事收束。每例固定关键/全部 required refs、允许 Form、复杂性、权威边界、预期错误/行动状态和秘密 canary。

所有比例报告分子/分母；token/延迟报告 p50/p95；随机/模型指标给适当置信区间和重复策略；失败按稳定代码、Form、Profile、阶段和 fallback 分类。样本不足、未运行或只靠源码检查不得写成通过。

### 13.2 质量、成本与延迟门

- 关键 Context ref recall = 100%；全部 required ref `Recall@8 ≥ 98%`。
- 简单 Form 首次合法率 ≥ 97%；`compound.v1` 首次合法率 ≥ 95%。
- 一次窄修订后最终合法率 ≥ 99%；可执行路由覆盖率 ≥ 99.5%；复杂行动误入简单 Form = 0。
- 简单 Proposal 输入 p95 ≤ 8k tokens；全体 Proposal 输入 p95 ≤ 16k；Narration 输入 p95 ≤ 5k。
- 相对 G0，Proposal 输入 token 中位数下降 ≥ 50%，Form Schema 字节中位数下降 ≥ 60%。
- Proposal 端到端 p95 ≤ 20 秒；主 Proposal 平均调用数 ≤ 1.10/RootAction；正常 Planner/RAG fallback 率 ≤ 5%。

### 13.3 零容忍与故障注入

Planner、RAG、Embedding、Vectorize 和辅助模型分别故障注入时，安全回退率必须 100%，且世界事实、骰面、资源、虚构时间和玩家意图变化均为 0。

秘密泄漏、第二权威、模型/客户端骰面、客户端实际 target list、任意状态 patch、重复随机/资源/事件、自动换主 KP、骰后改判和叙述失败回滚已提交行动均必须为 0。

既有 31 轮 KP 评测及全部硬门继续通过；新增至少一条长轨迹覆盖动态环境和逐受众 Narration 失败/恢复。确定性 fixture 必须走与生产相同的 Form、Context、validator、compiler、Room、Rules 和 projector seam，不能直接构造归一化成功结果。

## 14. D1、migration 与派生语料闭环

如静态语料/FTS 需要 D1 schema 变化，`db/schema.ts` 是唯一 schema 源；运行 `npm run db:generate` 后逐行审查只增不改的新 migration。已生成 migration 禁止修改。必须先在全新和已迁移本地 D1 各完成 migration，并通过最小“编译静态语料 → 写入 → FTS/别名查询 → sourceRef/hash 重读 → 删除索引 → 从权威语料重建”的闭环。

远端 migration 只在用户授权的发布串行阶段应用于现有 D1，并先核对目标 database/binding、待应用清单与备份/恢复边界；不得创建新 D1。若实现不需要 schema 变化，执行日志必须明确记录“不需要 migration”，不能生成空 migration。

D1 FTS、别名表、实验结果和静态 chunk 可重建且不持有活跃 Room 状态。临时语料、测试用户、房间和实验数据必须带唯一前缀/清单，由创建者在证明不是真实用户数据后走既有精确清理路径；禁止广泛删除。

## 15. 浏览器、发布与远端证据

### 15.1 定向与完整验证

实现阶段先跑相关 Form/Context/RAG/Room/Rules/Environment/Narration/telemetry 定向测试。最终冻结 SHA 必须依次通过：

```text
git diff --check
npm run typecheck
npm run lint
npm run module:check
npm test
npm run build
```

真实浏览器必须在 375px 与 1440px 各完成观察、NPC 对话、Proposal 失败、Narration 重试和动态环境入口五条路径；要求无横向溢出、console error、秘密 DOM/ARIA/网络旁路，且已提交行动在 Narration 失败时保持可见、不被重复结算。

### 15.2 串行发布顺序

1. 冻结交付 SHA，确认工作树、`cloudflare` 分支、Profile/hash、迁移状态和所有门；记录远端 `main` 初始 SHA。
2. 若有 migration，先完成本地闭环，再在明确目标上应用现有远端 D1 migration 并证明无 pending。
3. 用现有 `npm run cf:deploy` 部署现有 Worker `zhuwei`；不得创建新 Worker、D1、DO、KV、R2、Queue、Workflow 或未经授权的 Vectorize。
4. 对部署版本执行有界线上 HTTP、认证、建房、普通 KP、Narration 失败恢复、权威状态读取与动态环境冒烟，并核对脱敏日志。
5. 按精确清单清理本次临时账号、房间和实验数据，不删除真实用户数据；清理失败必须阻塞发布完成声明。
6. 仅以非 force 显式 refspec 推送 `HEAD:refs/heads/cloudflare`，证明远端 `cloudflare` 等于交付 SHA，且远端 `main` 等于任务开始记录值。

部署、远端 migration、线上冒烟、清理和 Git push 必须串行，不能由隔离 Worker 并发执行。部署保护必须绑定交付 SHA、SPEC/Profile/hash、既有 bindings 与环境；分支不净、SHA/Profile 不匹配、迁移不明确或全量门缺证时 fail closed。

## 16. 新房、版本与迁移边界

本规格的 Form Catalog、Action Language、Context Pack、corpus/retrieval、Model Registry、Narration schema、publication protocol、Environment state graph 和相关 compiler 全部进入房间完整 runtime manifest。创建新房时固定精确 ID/hash，不接受 `latest`。

既有房间、旧 `authoritative-kp-action-plan-v1`、旧 Outcome/Delivery Adapter 和旧环境状态继续由 genesis 指定的解释器回放。不得从旧 Prompt、Delivery、聊天、抽象距离或 D1 数据猜测新 Form/Context/Environment 状态。不兼容变化要求重新开房；将来若要迁移，必须另写显式迁移规格、验证旧事件可重放并取得用户授权。

## 17. 对下位规格的窄 supersede

本规格不修改 `SPEC 0001`，也不整篇替代既有规格。仅以下冲突条款对启用本规格的新 V3 房间由本规格取代：

| 原规格 | 被窄取代的条款 | 新裁定 | 未改变部分 |
| --- | --- | --- | --- |
| `SPEC 0003` §§2.2、11–12 | 单一 `RoomActionOutcome.kind` 同时表达行动与交付结果 | 公开结果分别携带 §8 的 action/narration 状态；不再以顶层 `ok` 或六种 kind 混合提交与叙述 | Room Action 仍只接收认证输入；`step/project/replay`、prepare/commit、随机、Receipt、scope 与更正不变 |
| `SPEC 0003` §6、场景 5 | 默认最多两次自动修订 | 一次首 Proposal + 最多一次窄修订；耗尽后无第三次完整 Prompt | Rules 诊断、未提交稳定点和 `needsKp` 语义不变 |
| `SPEC 0010` §§8、10–12 | 当前帧发布未区分逐受众 Narration 状态，且未固定模型 body-only schema | §7–8 的 `{body}`、服务器派生元数据、逐受众独立状态/重试优先 | Audience 提交冻结、projector、ViewerKey 亲历、ACK/覆盖、秘密与语音同正文边界不变 |
| `SPEC 0011` §§1、3–5、8–10 | 1+2 修订预算、旧模型调用/日志与笼统故障分类 | §6 的 1+1、§9–10 角色化 Profile/实验门、§12 精确错误和更窄日志、§13 新指标 | 恢复、更正、D1 archive、无隐藏主 KP 切换和既有 31 轮硬门不变 |
| `SPEC 0014` §§2–5、9、11–12 | 通用环境有限状态和破坏/区域验收 | §11 增补五类版本化对象、`environmental-stunt.v1`、吊灯因果链与 14 场景 | Geometry/Tactical Projection/preview、客户端不提交 targets、地图 Adapter 与旧房隔离不变 |

若本表之外出现解释差异，优先保持 `SPEC 0001`、单一 Room/Rules/DO 权威和秘密边界；不能用本规格扩大模型、页面、D1 或辅助模型权限。

## 18. 实现映射与当前证据状态

| 责任 | 计划中的唯一生产映射 | 验收映射 | 当前状态 |
| --- | --- | --- | --- |
| Form Catalog/筛选/Profile | `app/_runtime/lib/kp/form-catalog.ts` + Room `prepare`/action | 十 Form、3–6 张、compound、注入拒绝 | **待实现** |
| Context Pack | `app/_runtime/lib/kp/context-pack.ts` + Rules `project` + Room Authority | Required 不可删、NPC 重投影、Narration 缩小 | **待实现** |
| 静态 RAG/FTS | `app/_runtime/lib/kp/static-retrieval.ts` + `db/schema.ts`/D1 Adapter | 中文别名、ref/hash 重读、重建、本地写读 | **待实现** |
| Proposal/一次修订 | Form validator + Room Action proposal journal | 语义 hash、1+1、无第三次、骰后冻结 | **待实现** |
| CausalActionProgram | `app/_runtime/lib/kp/causal-action-program.ts` + Rules `step` | closed/acyclic/bounded、无脚本/patch/事件/骰面 | **待实现** |
| 模型角色/Profile | `app/_runtime/lib/kp/model-registry.ts` + server/table settings | 主 KP 固定、Planner off/verified、无隐藏切换 | **待实现** |
| Body-only Narration/Grounding | Room Action + narration/grounding Adapter + Room DO delivery | exact `{body}`、服务器元数据、显式拒绝 | **待实现** |
| 双状态/逐受众恢复 | Room Action/DO `action.ts`、`durable-object.ts`、Rules projector、table API/UI | Alice/Bob 独立、提交不回滚、冻结重试 | **待实现** |
| 动态环境/吊灯 | 既有 Rules v2/Geometry/Profile/Room/archive/replay + 环境编译器 | §11 的 14 场景 | **待实现**；既有 Geometry 只算底座 |
| Telemetry/错误 | `app/_runtime/lib/room/telemetry.ts` 与公开 API DTO | 十错误、白名单、故障注入 | **待实现** |
| 实验/发布 | 计划中的 gold/eval runner、浏览器 QA、现有 deploy/smoke guard | §10、§13–15 | **待实现** |

“待实现”是硬阻塞，不因本规格、ADR 或计划文件存在而转绿。完成证据必须来自同一冻结源码的实际命令、退出码、指标报告、必要 migration、双视口浏览器、部署版本/冒烟/清理和远端 SHA 证明。

## 19. 固定不变量

1. `SPEC 0001` 始终最高；KP 权威不因小表/RAG/辅助模型缩小。
2. 玩家永远只提交自然语言与封闭待决回答；内部 Form/RAG/primitive 不成为 UI 命令语言。
3. RequiredContext 不可由 Planner/RAG 删除，动态房间状态永不进入静态索引。
4. 检索命中只是 ref；使用前必须按 source/profile/hash/权限重读权威原文。
5. 每 RootAction 最多一次首 Proposal 和一次窄修订；骰后不改判。
6. `CausalActionProgram` 不拥有状态、随机、事件、权限或投影。
7. Narration 模型只输出 `{body}`；所有元数据由服务端派生。
8. 已提交行动不因任何受众 Narration 失败而回滚、重提案、重掷或重复消耗。
9. Audience 与逐受众发布键在提交时冻结；一个受众失败不影响另一个。
10. 辅助模型只建议检索/结构，不决定 KP、Rules 或 Audience 权限；失败不自动换主 KP。
11. 环境使用版本化有限状态，不是通用物理；实际区域集合只由 Rules 从完整 Geometry 计算。
12. 新协议只进新 V3 房间；旧房无猜测迁移。
