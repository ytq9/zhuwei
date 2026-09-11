---
spec: "0015"
kind: spec
title: "私有 Form Proposal、Context Pack/RAG、提交后叙述与动态环境"
status: ruled
authority: user
ruled_on: 2026-08-29
status_detail: "已裁定；实现、远端 migration、部署、双视口浏览器与 Git 发布事实已建立；完整门依用户豁免未运行，完整线上指标仍待用户自测"
depends_on: ["0001", "0003", "0005", "0006", "0007", "0010", "0011", "0012", "0013", "0014"]
adr: ["0014"]
superseded_by:
  - spec: "0016"
    scope: "旧 Form Catalog、environmental-stunt/详细材料阈值、model-visible compound/DAG"
revisions:
  - date: 2026-08-31
    scope: "0.4：只用于当前 V5 Profile/manifest；旧 Adapter/迁移/恢复条款由 SPEC 0013 窄取代"
parts:
  - "0015-part-b-proposal-and-narration.md"
  - "0015-part-c-adoption-and-observability.md"
  - "0015-part-d-release-and-boundaries.md"
gates:
  - "tools/run-kp-v3-eval.mjs"
  - "tools/run-live-kp-eval.mjs"
  - "tests/kp-strict-tool-transport-v3.test.mjs"
  - "tests/private-form-repair-v3.test.mjs"
  - "tests/kp-vnext-selection-amendment.test.mjs"
---
# SPEC 0015：私有 Form Proposal、Context Pack/RAG、提交后叙述与动态环境

- 产品：烛帷 V3
- 适用规则：D&D 5e 2014 / SRD 5.1
- 适用边界：只用于启用本规格当前完整 Profile/manifest 的 **0.4 新房**；退役绑定显式拒绝，不静默重命名或重解释

> 2026-09-01 后续裁定：未来 Profile 的粗粒度 Form、RequiredContext `epistemic/readSet`、稀疏语义定义、服务器私有复合计划、Rules 有限原语与 Typed Claims 服从 [SPEC 0016](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)。SPEC 0016 只窄取代本规格的旧 Form Catalog、`environmental-stunt`/详细材料阈值与 model-visible compound/DAG，并深化 RequiredContext 和 Claims 交接；本规格的 V5 解释、RAG、1+1、body-only、双状态、逐受众恢复与历史发布事实继续有效。当前不因此切换生产或删除 V5。

## 1. 目的、权威顺序与不变 Interface

本规格把玩家自然语言意图送入“私有小表 Proposal → 三层 Context Pack → 静态 RAG → 封闭因果程序 → Rules → Room DO → 逐受众 Body-only Narration”管线。它降低超级 Schema 和完整上下文的成本，但不把 KP 降为命令翻译器，不缩小 `SPEC 0001` 赋予 KP 的开放世界创作、可行性、风险、DC、NPC、失败、节奏和叙事裁决权。

以下边界保持不变：

1. 玩家只提交自然语言 `Intent`、待决 `Answer`、`Retry` 或 `Acknowledge`；Form、查询、引用、机械原语、事件、状态 patch、骰面、Audience 与实际区域目标都不进入玩家 Interface。
2. 对外仍只有一个深 Room Action Module。页面、语音、图片和 API 只是输入/呈现 Adapter。
3. Rules Module 外部仍严格只有 `step / project / replay`。Proposal 编译器、检索器、环境定义编译器和 Grounding 校验器都不是第四条机械、投影或回放路径。
4. Room Durable Object 仍是活跃 WorldState、连续事件、作用域版本、Pending、Receipt、权威随机、AudienceSnapshot、逐受众发布状态和恢复 capability 的唯一权威。
5. D1、FTS、Vectorize、本地 embedding、模型缓存、日志、页面、测试 fixture 和 Delivery 文本都不能成为第二状态权威。
6. 叙述文本不是正史；事实、知识、机械、Audience 和可恢复发布依据必须先由 `step`、Room DO 与 `project(viewer)` 固化。

当前机械解释器版本轴、产品代际与应用版本继续分离。V3 不等于 ruleset v3，0.4 也不等于 runtime v4；房间 manifest 精确固定的 `dnd5e-2014-srd5.1-authoritative-v2` 不因本规格静默改名。只复用既有机械原语的新 Form 可以发布新的 Form/Action Language/Profile；新增机械原语必须发布新的 Rules manifest/interpreter，并在当时先明确裁定现役房间的兼容、迁移或退役策略。0.4 当前不预留旧解释器。

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
| `environmental-stunt.v1` | 利用、创造或改变有限环境要素 | feature 复用/形成、材质/尺寸/高度、状态图、显式 `state-only` / `area-hazard` 效果模式，以及该模式实际需要的对象阈值、触发、区域或残骸后果 |
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

### 3.2.1 窄工具传输合同

0.4 当前 Proposal protocol 为每个 Catalog Form 固定一个稳定私有工具名：`submit_kp_clarification_v1`、`submit_kp_observe_v1`、`submit_kp_npc_exchange_v1`、`submit_kp_ordinary_check_v1`、`submit_kp_high_risk_action_v1`、`submit_kp_in_world_refusal_v1`、`submit_kp_materialization_v1`、`submit_kp_combat_action_v1`、`submit_kp_environmental_stunt_v1`、`submit_kp_compound_v1`。服务端每次只暴露本次 allowlist 中的 3–6 个工具；工具名选择既有 Form，`arguments` 直接是该 Form 的 draft，不再嵌套 `{ formId, draft }` envelope，也不暴露统一超级 Schema。

主 KP 每次 Proposal 响应必须且只能调用一个已暴露工具；Provider 请求固定要求工具调用并关闭并行工具。这里的“工具调用”只是声明式 Proposal 传输，不授权模型执行数据库、网络、随机、事件、状态 patch 或任何机械副作用。服务端只有在解析、closed-schema、引用、冻结语义、确定性编译和 Rules 诊断全部通过后，才把候选交给 Room DO；真实 actor/target/Audience、骰面、事件、资源与状态仍由可信服务端、Rules 和 Room DO 派生。

### 3.3 Form/Profile 发布

`FormCatalogProfile` 至少固定 Catalog ID/version/hash、各 Form schema hash、Action Language/Profile、编译器 hash、primitive vocabulary、兼容 Rules manifest 和 conformance suite。改变 Form 含义不得覆盖旧 hash；新增 Form 只在新 Profile 中出现。

本规格不得把既有 `authoritative-kp-action-plan-v1` 的含义原地改名。0.4 当前 Proposal 使用独立的窄工具 protocol/profile，并只通过显式编译器进入 `CausalActionProgram`；前 0.4 提案和房间已经退役，进入当前入口时稳定拒绝，不注册旧提案解释器或 fallback。

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

## 分册

本规格的其余条款在以下分册，编号连续：

- [§6–§9 Proposal 验证、Narration 与双状态](./0015-part-b-proposal-and-narration.md)
- [§10–§13 采用门、动态环境与可观测性](./0015-part-c-adoption-and-observability.md)
- [§14–§19 D1、发布证据与版本边界](./0015-part-d-release-and-boundaries.md)
