# SPEC 0016：粗粒度 Form、冻结裁决上下文与类型化主张

- 状态：**已裁定；阶段三代表性纵切已有开发期回执，Availability/Bundle/真实 Provider 收口实施中；完整 Form 家族尚未全部纵切，且尚未切换生产、删除 V5、执行 migration、部署或发布**
- 裁定日期：2026-09-01
- 收口修订日期：2026-09-02
- 产品：烛帷 V3（当前应用版本仍为 0.4.0）
- 适用规则：D&D 5e 2014 / SRD 5.1
- 上位规格：`SPEC 0001`（最高产品合同）、`SPEC 0003`、`SPEC 0004`、`SPEC 0005`、`SPEC 0006`、`SPEC 0007`、`SPEC 0008`、`SPEC 0009`、`SPEC 0010`、`SPEC 0011`、`SPEC 0012`、`SPEC 0013`、`SPEC 0014`、`SPEC 0015` 的未被本规格取代部分
- ADR：[ADR-0015：按事务边界组织粗粒度 Form，并以冻结上下文和类型化主张闭合裁决](../adr/0015-coarse-forms-frozen-context-and-typed-claims.md)
- 当前边界：本规格定义下一代 Profile 的产品与架构合同；当前 V5 生产 Profile、Registry、房间和恢复路径保持不变，`origin/feature/kp-form-graph-v6` 只作为已审查原型证据，不直接合并或切换为生产默认

## 1. 目的与能力合同

任意获得认证的玩家都可以用自然语言提出合理行动。主 KP 必须得到一份对本次裁决最小充分、权限正确、版本固定且可追溯的 `RequiredContext`，据此理解目标与方法、判断可行性、DC、风险和世界因果，并通过按权威与事务边界划分的粗粒度 Form 提出结果候选。Rules 只验证权限、引用和机械合法性，执行有限机械原语与权威随机；Room Durable Object 仍是唯一活跃状态权威。提交后，`project(viewer, committedRange)` 必须为每个冻结 Viewer 生成充分、准确、有限且可追溯的 Typed Claims，Narration 只能表达这些材料，不能补事实。

本能力必须同时支持：

- 玩家行动的对象、工具、方法、目标、场景关系和结果组合不断变化，而不按动作名称增加 Form；
- 动态 NPC、场景对象、物品、能力、任务与故事连续性进入同一冻结裁决上下文；
- 缺失的决定性世界语义在产生证据、随机或机械影响前，以版本化稀疏定义或事实固化；
- 一个 RootAction 跨越多项类型化提案时仍只产生一个原子 Receipt，不由模型编写执行 DAG；
- Rules 保持机械权威，KP 保持可行性与叙事权威，页面、模型、RAG、编译器和 Narration 都不成为第二权威；
- Viewer 无权知道的事实、关系和依据不进入其 Claims、Prompt、错误、日志、DOM、语音或重试路径。

本规格不修改、缩小或重新解释 `SPEC 0001`。

## 2. 唯一行动与叙述链

下一代实现仍只在两个现役深 Module 的既有 seam 上演进：

```text
authenticated natural-language Intent
→ Room Action prepare
→ frozen RequiredContext { epistemicContext, readSet }
→ KP coarse Form proposal(s)
→ server-private ProposalBundle / derived InteractionPlan
→ Rules step
→ Room DO atomic commit + Receipt + AudienceSnapshot
→ Rules project(viewer, committedRange)
→ FrozenRenderableClaims
→ body-only Narration + Grounding
```

以下 Interface 不变：

1. 玩家只提交自然语言意图、封闭待决回答、重试或 ACK，不提交 Form、图节点、依赖、机械原语、骰面、事件、状态 patch、Audience 或实际区域目标。
2. Rules Module 外部仍只有 `step / project / replay`；上下文合成、稀疏定义合成、ProposalBundle、InteractionPlan 和 Claims builder 都是 Implementation，不是第四条机械或投影路径。
3. Room DO 仍唯一保存活跃 WorldState、连续事件、作用域版本、Pending、权威随机、Receipt、AudienceSnapshot 和逐 Viewer 发布状态。
4. `project(viewer, committedRange)` 是提交结果到 Narration 的唯一交接 Interface；Narration 不再从通用字段 diff、当前 WorldState 或 Prompt 记忆猜材料。
5. 模型、网络、RAG、D1 静态索引与 Narration 位于 Room DO SQLite 原子提交之外；失败不能伪造世界内结果。

`committedRange` 只能由 Room 根据当前 Receipt、活动分支和已提交事件范围派生，不能由模型、页面或 Narration 自报。

## 3. Form 按权威与事务边界划分

### 3.1 粗粒度 Catalog

下表名称是规范 Form 家族，不授权复用既有 `*.v1` ID 的旧含义。阶段一必须为下一代 Catalog 分配新的精确 ID、schema hash、Profile 和 conformance suite；不得原地改变冻结协议。

| Form 家族 | 独立存在的事务理由 | 允许主 KP 提出的内容 |
| --- | --- | --- |
| `clarification` | 需要玩家补足会实质改变危险、成本、攻击对象或不可逆后果的选择；尚不提交世界结果 | 歧义、最小问题、有限选项和公开风险依据 |
| `in-world-refusal` | 缺少前提或违反世界规律；这是世界内裁决，不是 Provider 错误 | 可公开理由、真实尝试成本和仍可行动的前提/方向 |
| `observe` | 会取得感官证据、角色推断或来源主张，受角色知识与 Viewer 权限约束 | 玩家想知道什么、观察方法、既有事实引用、本次取得的具体证据、角色推断及必要的新事实固化 |
| `social` | NPC 回应受有限知识、目标、关系、承诺和来源主张约束 | 玩家表达、NPC 知识依据、回应/主张、检定或代价、关系和承诺后果 |
| `materialization` | 新世界事实或实体必须在首次证据、引用、随机或机械影响前固化 | 稳定领域身份、来源、可见性、稀疏语义定义、模板/定义引用和固化时点 |
| `world-interaction` | 开放式物理与环境互动需要组合现有对象、工具、状态和关系，但不拥有物品或故事生命周期 | 目标/工具/做法、依据、共同裁决、成功/失败的类型化语义后果候选 |
| `inventory-operation` | 物品所有权、持有、位置、装备、使用、消耗、损坏与销毁有独立权限和生命周期不变量 | 对权威 ItemEntry 的取得、转移、装备、收起、使用、成本和生命周期提案 |
| `objective-continuity` | 主线/支线/承诺/威胁的开启、推进、失败、放弃与完成有长期连续性不变量 | Objective 状态转换、因果依据、参与者、期限、后续机会或威胁 |
| `story-continuity` | 结局候选、故事收束、尾声与续篇不能由普通世界效果暗改 | 收束判断、长期后果、尾声选择、续篇/新冒险边界 |
| `combat` | Encounter 时点、行动经济、目标、反应、专注和多波随机有独立机械协议 | 对已注册能力/选择的战斗提案，不自报骰面、实际隐藏目标或最终机械结果 |

Catalog 不按“射击吊灯、烧绳索、推柜子、扔石头、用水导电”等动作名称或对象家族继续细分。`ordinary-check` 与 `high-risk-action` 不再是独立 Form；它们是所有实际行动 Form 共用的可行性裁决字段：

```text
directSuccess
| check
| highRisk
| missingPrerequisite
| worldLawViolation
```

这五种结果服从 `SPEC 0001` §§5–6。KP 决定是否检定、DC、优势/劣势、风险、时间、前提和骰前分支；Rules 验证所提机械能否执行并产生权威骰面。

### 3.2 Observe 的问题与答案必须分离

`observe` 不能再用一个含糊字段同时表示“玩家想知道什么”和“已经取得的答案”。其语义必须明确区分：

- `inquiry`：玩家本次想知道的问题；
- `focusRefs/method`：观察对象、位置、能力和做法；
- `existingFactRefs`：已经成立且本次相关的事实；
- `sensoryEvidence`：角色本次实际看见、听见、闻到、触及或以能力感知到的具体证据；
- `characterInference`：角色依据证据、知识或检定形成的解释；
- `sourceClaim`：NPC、文献或传闻声称的内容；
- `materializationRef`：开放留白在产生证据前先固化的新事实。

“机关是否仍能触发”只能是 `inquiry`，不能冒充 `sensoryEvidence`。证据必须是具体观察结果；世界真相、角色推断和来源主张继续分别建模。

## 4. RequiredContext 是冻结的认知切片与裁决读取集

### 4.1 双重职责

`RequiredContext` 不是“尽量多的 Prompt 上下文”，而是本次裁决的冻结 Interface，至少包含两种互不替代的引用集合：

```ts
type RequiredContext = {
  binding: {
    rootActionRef: string;
    actorRef: string;
    submissionRef: string;
    stateVersion: string;
    activeBranchRef: string;
    scopeVersions: readonly ScopeVersionRef[];
    profileRefs: readonly ProfileHashRef[];
    projectionHash: string;
  };
  intent: FrozenPlayerIntent;
  epistemicContext: AuthorizedContextSlice;
  epistemicRefs: readonly AuthorityRef[];
  readSetRefs: readonly VersionedAuthorityRef[];
};
```

- `epistemicContext/epistemicRefs` 回答“KP 为本次裁决被授权知道什么”。它可以包含 KP-only 事实；NPC 行动仍必须重新使用 NPC 自身 Viewer 的有限知识切片。
- `readSetRefs` 回答“这项提案实际依赖哪些版本化事实、定义、关系和作用域”。它是提交并发检查、作用域证明、诊断和审计的依据，不等于把整个 Prompt 或整个 WorldState 加锁。
- Proposal 的 `basisRefs` 必须来自已授权的 `epistemicRefs`；会影响裁决或后果的依据还必须进入 `readSetRefs`。仅出现在上下文但未被裁决读取的资料不得虚增 read set。

### 4.2 最小充分内容

上下文构造器必须按当前意图收集实际相关内容，不能只保存 ref 而丢掉模型理解所需的权威正文。至少覆盖：

- 角色属性、熟练、豁免熟练、技能、位置、HP、资源、状态、行动经济与相关 features；
- 被引用 Ability/Spell/Item/Environment/NPC 的完整相关定义，而不是只有 definition ref；
- 当前场景的相关对象、简单材料描述、可见状态、有限 Geometry 与类型化关系；
- 同场相关 NPC 的有限知识、目标、计划、资源及本次已形成的回应；
- 相关隐藏事实及其因果闭包，只进入有权的 KP Context；
- 物品实例及本次操作需要的定义、所有权、位置、装备、数量、charges、durability 和可见性；
- Campaign、Chapter、Objective、Story、unresolved threat、relationship、ending candidate 与先前承诺中本次相关的连续性切片；
- 适用裁决先例的正文、机械参数、适用范围和取代关系，而不是只有 precedent ref；
- 当前行动真正需要的故事锚点、核心真相约束、内容边界、安全限制与有限 recent dialogue。

RequiredContext 仍不是完整 WorldState、完整历史或完整 Story Bible。无法构造最小充分且不泄密的上下文时返回 `CONTEXT_INSUFFICIENT`，不得让模型猜测。

### 4.3 先检索相关内容，再完成决定性闭包

上下文构造不得先收集整个场景或大量定义再依赖总量上限截断。它必须先从玩家意图派生目标、工具、行动范围、背景事实和决定性依赖等检索角色，再按以下顺序构造：

1. 精确读取 actor、当前场景、明确对象、持有物、已选能力与直接引用；
2. 沿本次行动相关的类型化关系、生命周期与 Geometry 依赖扩展；
3. 以结构签名和取代链检索适用裁决先例，再以语义相似度排序长尾候选；
4. 对静态规则、模板和模组片段按 exact source/profile/hash/span/权限重读；
5. 对会改变可行性、风险、目标或结果的依赖完成不可截断的决定性闭包；
6. 最后才裁未采用的 RetrievedContext 与 Optional 内容。

普通行动的 RequiredContext 以约 8k units 为正常目标，所有行动以 16k units 为硬门。若决定性闭包自身超过硬门，返回 `CONTEXT_BUDGET_EXCEEDED`；不得随机裁掉闭包的一部分继续裁决。实现中的大对象数量只可作为异常防爆保护，不能代表正常可接受规模，也不能掩盖相关性检索失败。

### 4.4 五态 Availability 语义

每个决定性检索角色必须由同一个 Context Availability Module 解析为以下一种状态；不得另建 `sceneObjectCoverage`、场景枚举完备性或其他并行覆盖标记：

- `known`：当前 Room Authority 中已有、版本确定且本次获授权使用的对象、事实、定义或关系。模板存在不能产生 `known`，必须已有具体实例或事实。
- `knownAbsent`：存在本次获授权的权威否定依据。允许依据仅包括模组明确否定、封闭集合的完整成员资格、已提交的移除/销毁/耗尽生命周期事实、当前活动分支上的更正，以及 KP 已通过正常权威链固化的局部否定事实。检索零命中绝不等于 `knownAbsent`。
- `openBlank`：当前既没有匹配事实也没有有效否定依据，且决定所需场景约束已完整加载，并有版本固定的开放留白授权允许 KP 在该范围决定相应种类“存在或不存在”。它必须携带 `allowedKinds` 和可追溯 `basisRefs`；开放留白授权是权限而非存在证明。
- `ambiguous`：存在多个当前合法候选，且候选对本次行动的危险、显著资源、攻击对象、可达性、相关能力/状态/关系或不可逆后果具有实质差异。候选数量本身不构成歧义。
- `unavailable`：决定性内容未加载、被截断、失效、投影非法或不能安全读取。这是技术状态，不能包装成世界内“不存在”。`critical` 的 `unavailable` 必须 fail closed。

局部否定事实至少绑定 `scopeRef`、对象种类/模板族/精确引用条件、`basisRefs`、scope revision 和 visibility policy；它只证明当前版本的所声明范围内不存在匹配对象。相关范围后来新增匹配对象时，Rules 必须在同一提交中结束或取代旧否定事实。正面对象与仍声称有效的否定事实同时出现属于上下文冲突，不得解释为 `ambiguous`。

第一次面对 `openBlank` 时，KP 可以根据故事锚点和场景语义选择：固化一个新对象/事实并继续行动；或者固化局部否定事实并给出观察结果或世界内拒绝。它不得等待骰面或后续选择后再改变存在性裁定。

多个候选若在本次行动相关的定义版本、可见状态、所有权/生命周期、位置/可达性、affordance/mechanics 与关系上相同，则为可互换候选。服务端可以按玩家明确描述、自然显著性与稳定引用顺序选择一个真实实例，并把选择依据绑定进冻结上下文；不得为了纯身份差异向玩家提问。候选确有差异但不越过 `SPEC 0001` 的重大澄清门时，KP 可以合理选择并记录依据；只有差异会改变重大危险、显著消耗、攻击对象或不可逆结果时才请求 clarification。隐藏对象或 Viewer 无法区分的秘密差异不得进入玩家可见选项。

`knownAbsent.basisRefs`、开放留白授权与候选决定性属性必须进入实际 read set。否定依据过期、候选集合被截断或决定性属性未加载时必须重新 prepare 或返回明确 Context 错误，不能从残缺集合选择。

### 4.5 权威来源与冻结

动态上下文只来自 Room Authority 与同一 Rules `project`；静态规则、模组和模板可以经 RAG 定位，但使用前必须按 exact source/profile/hash/span/权限重读权威原文，并把实际采用的版本加入 read set。D1 FTS、embedding、模型摘要或缓存不参与活跃裁决。

Room `prepare` 必须持久冻结 RequiredContext 或其可验证完整快照，相同 submission 重试复用原快照。提交前若 read set 中相关作用域或定义版本改变，必须产生明确冲突或重新 prepare，不能把新旧世界片段混成一次裁决。

## 5. 稀疏语义定义与有限关系

### 5.1 不建设材料物理系统

动态场景对象和 NPC 只需要足够支持游戏裁决的稀疏语义，不需要把现实物理预编码成完整数值系统。一个相关对象切片可以包含：

```ts
type SparseSemanticDefinition = {
  definitionRef: string;
  revisionRef: string;
  kind: "npc" | "object" | "hazard" | "location" | "item" | "other";
  label: string;
  description: string;
  materialDescription?: string;
  observableState?: readonly SemanticState[];
  affordances?: readonly SemanticAffordance[];
  mechanicDefinitionRefs?: readonly string[];
};

type TypedRelation = {
  relationRef: string;
  kind: "supports" | "attachedTo" | "contains" | "blocks" | "triggers";
  subjectRef: string;
  objectRef: string;
  state: "active" | "ended";
  visibilityRef: string;
};
```

`materialDescription` 可以表达“铁制链条”“干燥麻绳”“薄木板”等语义事实；它不要求结构强度、燃点、载荷阈值或每种伤害类型的物理参数。关系只在游戏实际需要时建立，不要求为场景构建完整知识图谱。

KP 根据这些已固化语义、角色做法、工具、Geometry、自然规律和先例判断“枪能否打断铁链”“火能否烧断麻绳”“石头是否足以触发压板”。Rules 不用缺失的材料阈值替 KP 决定现实可行性，也不因没有对象模板拒绝合理行动。

### 5.2 决定性缺失事实必须先固化

若已有语义不足以区分结果，而且该差异将产生直接证据、随机或机械后果，KP 必须在这些后果出现前：

1. 引用已有事实推导；或
2. 在开放留白中提出新事实/稀疏定义；或
3. 为同样合理候选请求可信随机固化。

不得在看到骰面、玩家剩余资源或后续选择后再补“链条其实更脆”“石头其实足够重”等决定性事实。

### 5.3 模板只提供创建时默认语义

对象/NPC 模板属于版本化静态语料，只提供默认语义和出处，不拥有场景存在性、写权限或活跃状态。允许覆盖的字段由 runtime manifest/Profile 按 semantic kind 固定，不能由模板文档自行扩大。实例创建时将 exact `templateRef/templateHash` 与稀疏 override 一次合成为完整定义；模板后续发布不回溯改变已有实例。

常见对象可以在场景物化时创建，也可以在首次相关的开放留白中按需创建，但两条路径都必须产生具有稳定身份的真实实例。多个可互动对象不能用一个复数 `sceneFeature` 代表并允许无限抽取；多个真实但可互换实例由 §4.4 的候选规则消除无意义选择。数量、所有权、耐久与资源等机械字段仍由相应 Item/Rules 生命周期表达，不能塞入稀疏语义定义。

### 5.4 稀疏修订由服务器合成完整下一版本

对已有动态定义的修订必须绑定 exact `baseDefinitionRef/baseHash` 与 `templateRef/templateHash`。KP 只提出允许字段的稀疏领域变化与 `basisRefs`；服务端从权威 base/template 合成完整、规范、不可变的 `nextDefinition`，验证引用、字段、权限和机械定义后交给 Rules。只有完整下一版本及其事件进入权威状态：

```text
sparse revision proposal
+ exact base definition/hash
+ exact template/hash
→ server canonical synthesis
→ Rules validation
→ immutable next definition + revision event
```

模型 patch、JSON Patch、部分对象和合并指令都不得作为状态、事件或第二事实源保存。旧事件继续引用原 definition revision；新修订不得原地改写历史。若修订引入机械能力，只能引用/生成 Rules 能验证的版本化 Ability/Item/Mechanic 定义，不能把自然语言效果直接当机械。

## 6. KP 判断与 Rules 有限原语

### 6.1 权威分工

主 KP 负责：

- 理解玩家的目标、方法、对象和重大歧义；
- 依据冻结上下文判断五类可行性；
- 设定 DC、优势/劣势、风险、时间、前提及成功/失败的世界意义；
- 选择相关对象、工具、事实和关系，提出因果候选；
- 在开放留白中提出必要的新事实、稀疏定义、NPC 回应、目标/故事连续性变化；
- 区分世界真相、感官证据、角色推断与来源主张。

Rules 负责：

- 重新验证 principal、actor、控制权、地点、回合、作用域、引用和 Profile/hash；
- 验证行动经济、能力、资源、距离、目标、时间、状态和生命周期不变量；
- 请求并执行 Room DO 权威随机，选择实际冻结分支并计算数值结果；
- 原子提交类型化事实、机械、关系、知识、物品、Objective/Story 和时间事件；
- 通过同一 `project/replay` 生成 Viewer 投影与确定性回放。

KP 不能填写权威骰面、最终伤害、实际隐藏目标集合、任意事件、JSON Patch 或“已经成功”；Rules 也不能把“数值高”“队伍等级低”或“缺少材料阈值”当作否决 KP 合理世界裁决的理由。

### 6.2 有限原语家族

下一代 Rules Profile 只注册游戏实际需要的有限、类型化原语家族：

- Ability invoke、check/save/attack、资源/行动成本和结果绑定；
- 世界事实、感官证据、来源主张与角色推断的固化；
- 语义定义 create/revise，以及类型化 relation/state transition；
- Item acquire/transfer/equip/stow/use/consume/damage/repair/destroy；
- Objective open/advance/fail/abandon/complete 与 threat/commitment 连续性；
- Story candidate/conclude/epilogue/sequel 连续性；
- Activity schedule/interrupt/complete 与虚构时间；
- 已注册 Ability/Hazard/Geometry 所需的区域、目标、伤害、状态、死亡与地形后果。

原语是 Rules Module 的私有 Implementation vocabulary，不是玩家菜单或 LLM 的自由脚本。不得提供任意 `worldEffects`、任意字段赋值、通用物理求解、按对象名派发或绕过 `step` 的直接事件入口。新增机械原语仍要求新 Rules manifest/interpreter 和 conformance suite。

## 7. 复合行动不使用模型编写的 DAG

`compound` 不再是模型可见 Form，也不再允许 KP 填写 `nodeId`、`dependsOn`、执行顺序、任意条件图或通用效果节点。一个 RootAction 需要多个粗粒度合同共同表达时，模型只提交类型化子提案、现有 `basis/consumes` 引用、拟产生的语义引用，以及绑定到同一冻结裁决结果的 `always/onSuccess/onFailure` 语义条件。

服务端把这些内容放入私有 `ProposalBundle`，并根据以下事实确定性导出内部 `InteractionPlan`：

- 现有引用与新产生引用的 produces/consumes 关系；
- Rules 已知的所有权、生命周期和时点不变量；
- 同一冻结 check/save/attack 的结果绑定；
- 事实/定义必须先于引用它们的机械，机械结果必须先于依赖结果的连续性变化。

内部计划即使使用图，也只是服务器从类型化语义推导的 Implementation，不是模型 Interface。依赖无法唯一导出、形成循环、越过原语闭包或需要多个尚未结算且互相影响的随机时，必须诊断、澄清、拆成后续 RootAction 或由已注册专用机械处理；不能退回万能 `compound`、执行已合法部分或让 Narration 补齐。

整个 ProposalBundle 只绑定一个 RootAction、一次语义冻结和一个最终 Receipt。任一子提案在首份权威随机前无法通过引用、权限或机械预检时，整束不产生公开事件、资源消耗、随机或 Narration。专用多波机械可以使用 Room 私有恢复 journal，但不得形成部分公开提交或重复结算。

### 7.1 Existing 与 Prospective 引用

模型只能从冻结引用目录选择已有引用，或在当前 Bundle 中声明局部 prospective handle；模型不生成权威对象 ID。服务端将 handle 规范化为本束唯一 prospective ref，并确定性证明：

- 只有一个合法 producer，且没有循环或重复声明；
- producer 的 `always/onSuccess/onFailure` 条件支配每个 consumer；
- prospective ref 不伪装成 `epistemicRefs`、`viewerEvidenceRefs` 或已存在 read-set 成员；
- producer 在对应分支中产生可由正式 Rules 原语表达的定义、事实或对象；
- consumer 所需的地点、可见性、可寻址性、所有权、生命周期和机械资格均能在该分支候选状态中成立。

Prospective 可寻址性只能在 `Rules.step` 内部验证。Rules 必须复用正式事件转换/reducer 构造分支局部、不可观察且可丢弃的候选状态，并复用与正式 Viewer 投影相同的权威空间绑定与可见性解释器；不得让 Bundle compiler、Room 或 Claims builder 手工修改 WorldState，也不得新增 speculative projector 或对候选状态调用一条独立的完整 `project` 路径。

所有可能到达的成功/失败分支必须在首份权威随机前完成引用、权限和机械预检。候选状态与临时转换不产生公开事件、Receipt、Audience、Claims、Narration、projection hash 或活跃世界状态；随机等待只允许 Room 私有 journal 保存冻结完整计划。最终分支确定后，其中的物化与消费通过同一 RootAction 原子提交，之后才运行正式 `project(viewer, committedRange)`。

### 7.2 Bundle 语义冻结与一次窄修复

首份 ProposalBundle 形成一个 bundle-level 语义冻结。修复模型只接收唯一工具 schema、拒绝草稿、合并后的精确诊断、相关有限引用、冻结 hash 和允许修改的字段路径，并只返回这些路径的稀疏 correction；它不重发或重选整个 Bundle。

服务器合并 correction 后必须从头重跑完整 closed-schema、引用、权限、跨字段、produces/consumes、条件支配、循环/规模、lowering 和 Rules 预检。局部修复限制模型填写面，不缩小服务器重验面。修复不得改变玩家 goal/method、已确认重大目标、Ruling、风险、成本或 outcome binding；一次修复仍非法时返回 `PROPOSAL_REPAIR_EXHAUSTED`，整束保持未提交。Context 缺失/超预算、Provider schema 配置、网络、限流和超时不消耗模型语义修复机会，也不能改走 clarification。

## 8. Typed Claims 是提交后的唯一可叙述材料

### 8.1 两阶段 Claim

Rules 在提交事件范围上先产生内部 `AuthorityClaim`，再由同一 Viewer projector 裁剪为 `FrozenRenderableClaim`：

```ts
type AuthorityClaim = {
  claimRef: string;
  kind: ClaimKind;
  payload: unknown;
  basis: {
    authorityRefs: readonly string[];
    viewerRefs: readonly string[];
  };
};

type ProjectedTypedClaim = {
  claimRef: string;
  kind: ClaimKind;
  payload: unknown;
  basisRefs: readonly string[];
};

type FrozenRenderableClaims = {
  rootActionRef: string;
  receiptRef: string;
  viewerKey: string;
  projectionHash: string;
  claimsHash: string;
  claims: readonly ProjectedTypedClaim[];
};
```

内部 `authorityRefs` 可以指向秘密事实、隐藏关系、完整 Geometry 或内部目标集合，永不输出给 Viewer 或 Narration。`viewerRefs` 必须逐项验证该 Viewer 已获得 grant；投影后的 `basisRefs` 只包含获授权的 viewer refs。若一项 relation claim 本身会泄露隐藏关系，则整项 relation claim 丢弃，不能只删 ref 后保留泄密 payload。可见后果应另以该 Viewer 真正观察到的机械结果或感官证据 Claim 表达。Claims 以稳定顺序规范化并计算 `claimsHash`，与 Receipt/Viewer/projection 绑定冻结；Room 可以保存该派生快照供发布恢复，但它不参与后续世界裁决。

### 8.2 Claim 类型覆盖

Claim vocabulary 至少覆盖：

- `mechanicalOutcome`：检定、攻击、豁免、伤害、资源、状态、位置、时间与死亡；
- `abilityEffectApplied`：能力名称、目标、实际效果、持续时间、专注与依据；
- `sensoryEvidence`：角色本次真正看到、听到或以能力感知到的具体内容；
- `sceneFeature` / `relationChanged`：相关场景对象、可见状态、关系变化与可互动性；
- `sourceClaim` / `characterInference`：NPC/文献声称与角色解释，不能冒充世界真相；
- `inventoryOutcome`：所有权、装备、数量、charges、durability 和物品状态变化；
- `objectiveContinuity` / `storyContinuity`：任务、威胁、承诺、收束、尾声或续篇的实际变化；
- `pressure` / `opportunity`：必须有已提交事实或可见状态依据；
- `actionCommitted`：只作最低事务事实，不能在存在更多可叙述事实时替代其他 Claims。

Claim 必须充分覆盖真实机械结果、直接感知、与行动相关的既有场景事实、压力和机会；“有限”表示只包含当前回应所需内容，不表示只叙述 `committedDelta.changes`。

### 8.3 Narration、Grounding 与重试

Narration 输入严格只有当前 `PublicReceipt + ViewerKey + FrozenRenderableClaims` 及冻结的 Narration Policy；不读取新 WorldState、通用 committed delta、Story Bible、完整 KP Context 或未冻结 recent dialogue。Narration 只输出 body，不能补 Claim 之外的事实、机械、Audience、情绪或玩家选择。

Grounding 对 Claim payload、Viewer grant 和 agency 逐项校验。Narration 失败后的重试必须复用相同 receipt、ViewerKey、projectionHash、claimsHash 和 claims，不重新 project 当前世界、不重跑 KP Proposal、Rules、随机或资源结算。

## 9. 权限、版本与失败边界

1. Principal、actor、ViewerKey、Audience、实际区域目标、scope proof、Profile/hash、Receipt 和 Claim freeze metadata 均由服务端派生。
2. 主 KP 可取得本次相关 KP-only 事实，但 NPC 行动只能依据单独的 NPC Viewer Context；Narration 只能取得目标 Viewer 的 Claims。
3. 所有新 Form、RequiredContext、Sparse Semantic Definition、Relation、ProposalBundle、Rules primitive 和 Claim vocabulary 都必须进入新的完整 runtime manifest；未知或错 hash fail closed。
4. 当前 V5 ID/hash 不原地改义。阶段一至三期间，新 Profile 不进入生产默认 Registry，不删除 V5，不建立静默 Adapter、fallback、双写或 migration。
5. 上下文不足、定义 base/hash 冲突、引用越权、依赖无法导出、Rules 诊断或 Claims 不充分都必须显式停在相应稳定点；不能用世界内拒绝、固定旁白或自动换模型掩盖技术/合同失败。
6. 已提交行动不能因 Claims/Narration 故障回滚；未提交的非法 Proposal 不能留下部分事实、随机或成本。
7. `structuredOutputMode: strict-tool` 只有在实际 Adapter 使用登记的严格端点/参数、工具声明启用 strict、候选 schema 通过该 Provider dialect 验证，且 live evidence 绑定 provider、model/revision、endpoint protocol、prompt/schema/parser/validation suite hash 时才成立；Room 或 Registry 元数据不得自行声称真实约束解码。
8. Provider 在生成前拒绝 schema 属于配置/协议永久错误；网络、限流和超时属于 Provider 故障并保持 `notCommitted`；只有 Provider 已返回合法工具调用而本地引用、语义或 Rules 诊断可修时，才进入 §7.2 的一次窄修复。strict output 永不替代本地权限、引用、跨字段、lowering 和 Rules 验证。

## 10. 分阶段实施与停止条件

### 阶段一：无行为变化地提取接缝并拆分大文件

先按变化原因把当前大文件中的独立 Implementation 提取为可单测 Module，同时保持 V5 生产行为、公开 Interface、Profile/hash 和测试结果不变。优先提取：

- RequiredContext 的 actor/scene/NPC/item/continuity/precedent 收集器；
- 稀疏定义与关系的纯合成/规范化 helper；
- Rules projector 中的 Typed Claims builder；
- vNext Narration 的冻结 Claims 消费器；
- Room prepare/commit 中只负责快照绑定和持久化的 orchestration helper。

阶段一不得借“拆文件”修改 V5 Form 含义、注册新生产 Profile、移动状态权威或改变投影可见性。完成门是拆分前后同一 V5 定向行为等价、模块依赖仍服从 `step/project/replay`，且没有新生产接线。

### 阶段二：实现新合同的纯 Interface 与 conformance

在未切生产的 vNext Profile 下实现：粗粒度 Catalog、RequiredContext `epistemic/readSet`、稀疏定义合成、有限关系、服务器私有 ProposalBundle、Rules 有限原语和 Typed Claims。测试从各自公开 seam 验证 closed schema、hash、权限、隐藏关系整项裁剪、read-set 冲突、定义版本合成、replay 与冻结重试。

阶段二不要求真实 Provider 或浏览器，也不得以直接构造最终状态/Claim 替代 `step/project/replay` 的行为证据。

### 阶段三：两条真实纵切

阶段三只包含 §11 的两条端到端纵切。它们都必须从真实自然语言或现役内部 NPC 入口，经 Room prepare、真实 RequiredContext、KP Proposal validator、服务器 bundle、Rules `step`、Room DO commit、`project(viewer, committedRange)`、Typed Claims 和 Narration seam，并证明 replay、幂等与秘密边界。

阶段三完成也不自动授权切换生产、删除 V5、部署、远端 migration 或 Git push。是否采用新 Profile、如何处理当时房间和是否删除原型/V5 路径必须另行裁定。

### 阶段三收口：Availability、Bundle 与真实 Provider 门

§14 的既有回执继续证明动态 NPC 修订与单合同 `world-interaction` 代表性纵切，不被改写为失败；但它不证明五态运行时、跨合同 ProposalBundle、prospective ref、完整 materialization create 或真实 Provider。继续扩展完整 Form 家族前必须完成以下收口：

1. 先冻结本修订的权威合同与模型填写面，再建立一个可丢弃的最小 `submit_kp_proposal_bundle` strict schema；
2. 用该候选 schema 做真实 Provider dialect handshake，至少覆盖单 `worldInteraction`、`materializeObject + worldInteraction` 和一个应被 Provider 在生成前拒绝的非法 schema；
3. 探针通过后才冻结 transport/schema 并实现其完整 consumer；不能先完成大规模 Bundle lowering 再发现真实 Provider 不支持该 schema，也不能在没有候选 schema 时空测 Provider；
4. 五态 Availability、候选 Bundle 协议、本地 validator/repair 与脱敏遥测可以在文件所有权不重叠时并行；真实 Provider 探针依赖候选 schema；Room/Rules 集成依赖 schema 与 Availability Interface 稳定；
5. 最终新增一条 `materialization + world-interaction` 跨合同纵切，证明同束创建并消费新对象、所有分支随机前预检、原子提交、逐 Viewer Claims、幂等与 replay。

阶段三收口的模型工具顶层不得包含 rootAction、actor、context/profile hash、权威 proposal/receipt/event ID、骰面、最终伤害或实际隐藏 targets。每层 object 必须 closed；Provider dialect 不支持的字符串、数组和 Bundle 大小限制仍由本地 validator 执行。真实探针只证明 transport 可行，不证明 KP 判断质量；正式采用仍服从 `SPEC 0015` 的金标、首次合法率、调用、延迟与安全门。

## 11. 阶段三的两条真实纵切验收

### 11.1 已有动态 NPC 的稀疏语义修订

前提：权威状态中已经存在一个动态 NPC，绑定不可变 definition revision、template ref/hash、有限知识、当前物品/能力和 Viewer 可见性。

行动：NPC 因新的已固化事实需要修订其动态定义。KP 只能基于本次 NPC/KP 获授权上下文提出允许字段的稀疏修订与引用；服务器以 exact base/template 合成完整下一版本，Rules 验证并原子提交。

必须证明：

1. 不把部分 patch、Prompt 文本或 NPC sidecar 保存为第二定义；旧 revision 仍可 replay，新实体状态只指向已提交 next revision。
2. 若修订引用能力或物品，其 definition/instance 已在 read set，Rules 验证机械与生命周期；自然语言不能直接变成任意机械。
3. NPC 未获知的玩家秘密不能作为修订或计划依据；隐藏 definition 字段和 relation 不进入无权 Viewer Claims。
4. 有权 Viewer 收到具体的可见 NPC 变化或行动后果 Claim，而不是只有 `actionCommitted`；Narration 重试复用同一 claimsHash。
5. base/template hash 过期、未知字段、越权 ref 或并发修订全部 fail closed，且不留下新 revision、随机、Receipt 成功态或旁白。

### 11.2 自然语言“用枪打吊灯”

前提：角色持有可用枪械和弹药；场景有吊灯、支撑对象及 `supports/attachedTo` 关系，相关对象只有简单材料描述、可见状态和必要 Geometry；场景中可以存在公开或隐藏实体。

行动：“我用枪打断吊灯的支撑，让它砸向下面的敌人。”

必须证明：

1. 只选择 `world-interaction` 粗粒度合同；不会因“枪”“吊灯”“锁链”等名称分派专项 Form、archetype 或硬编码结果。
2. RequiredContext 同时含角色枪械 Ability/资源、相关场景对象、简单材料描述、关系、Geometry、适用先例和连续性 read set；无权 Viewer 看不到隐藏实体或隐藏关系。
3. KP 判断可行性并在骰前冻结攻击/检定、DC 或目标规则、风险及成功/失败语义；Rules 验证枪械、距离、行动经济、弹药和有限原语，Room DO 提供唯一骰面并选择实际分支。
4. 成功分支可以结束支撑关系、改变对象状态并在已有 Geometry/Hazard 原语支持时结算坠落区域、伤害、状态、死亡和残骸；失败分支至少诚实结算已冻结的行动/弹药成本且不伪造断裂。模型不填写最终骰面、伤害或实际隐藏 targets。
5. 所有后果属于一个 RootAction/Receipt；幂等重试、驱逐恢复和 replay 不重复弹药、随机、对象、事件或 Delivery。
6. 每个 Viewer 的 Claims 具体覆盖其可见的射击、资源变化、支撑/吊灯变化、实际伤害、场景细节、压力与机会；隐藏目标可被 Rules 影响，但不因 Claim 数量、basis、错误或 Narration 泄漏。

同一测试组还必须包含一个非名称特判样例：“烧断绳索使重物坠落”，证明它复用相同 `world-interaction + relation transition + finite Rules primitive` 路径；以及一个边界样例：“扔石头试陷阱”，证明玩家的问题、石头/压板语义、隐藏触发关系和本次取得的具体感官证据被正确区分。后二者是通用性/边界检查，不是第三条完整纵切。

## 12. 对 SPEC 0015 的窄 supersede 与 Interface 深化

本规格不整篇替代 `SPEC 0015`。其静态 RAG 权威重读、1+1 调用预算与语义冻结、body-only Narration、action/narration 双状态、逐受众发布、Model Profile、日志白名单、D1 派生索引和 V5 历史发布事实继续有效。仅旧 Catalog、compound/DAG 与详细环境模型由本规格窄取代；RequiredContext 与 Claims 行是对既有原则的深化，不否定其原约束。全部处理只适用于未来绑定本规格完整 Profile 的房间：

| 处理 | SPEC 0015 原条款 | 原合同的目标/缺口 | 本规格裁定 | 仍保留内容 |
| --- | --- | --- | --- | --- |
| **窄取代** | §2 步骤 3、5–8；§3.1–3.2.1 | 每次筛 3–6 张、从十张窄 Form 选一张；`ordinary-check/high-risk/environmental-stunt/compound` 作为动作类别或逃生舱 | §3 的粗粒度 Form 家族；五类 Ruling 为共享字段；一个 RootAction 可有多项类型化子提案，但没有模型可见 compound | 玩家只说自然语言、Form 私有且 closed、authority 字段服务端派生 |
| **窄取代** | §6.2 的 compound 升级；§6.3 `CausalActionProgram` 复合拓扑 | 模型通过 compound stages/conditions 表达复合依赖 | §7 的服务器私有 ProposalBundle；依赖从 produces/consumes、生命周期和 outcome binding 确定性导出，模型不填 DAG | 一次首 Proposal + 最多一次窄修订、语义冻结、整束预检、单 RootAction/Receipt |
| **深化** | §4.1 RequiredContext 最小权威切片 | 已要求包含相关 mechanics、动态定义、continuity 与先例，但未把认知权限和事务读取显式分开 | §4 的 `epistemicRefs/readSetRefs`、冻结元数据和最小充分正文 | Planner/RAG 不可删除 Required、Context 不等于完整 WorldState |
| **窄取代** | §11 与 §19.11–12 | `environmental-stunt`、详细材质/尺寸/高度、对象 AC/耐久/阈值、有限状态图及统一 `state-only/area-hazard` 模式作为开放环境的主要表达 | §5–7 的简单 `materialDescription`、少量类型化关系、KP 可行性判断和有限 Rules 原语；真实 Hazard/Area 只在游戏后果确实需要且已有原语时使用 | 不按对象名/archetype 派发；实际区域目标仍只由 Rules/Geometry 计算；不按队伍等级削弱危险 |
| **深化** | §7 的 `renderableClaims` 输入约定 | 已要求 Narration 只依据冻结 claims，但 Claim vocabulary 与唯一生成 seam 尚未充分固定 | §8 将 `project(viewer, committedRange) → FrozenRenderableClaims` 冻结为唯一交接 Interface | body-only、Grounding、Audience 与 Narration 失败不回滚行动 |

本 supersede 只决定未来 Profile 的目标，不原地重解释当前 V5 房间，也不把 `feature/kp-form-graph-v6` 注册为新默认。出现本表之外的解释差异时，优先保持 `SPEC 0001`、单一 Room/Rules/DO 权威、秘密安全与冻结版本语义。

## 13. 固定不变量与非目标

1. Form 数量不随玩家动作组合、对象名称或样例数量增长；新增 Form 只因出现新的权威或事务生命周期边界。
2. 稀疏语义不是自由标签堆，也不是通用物理引擎；简单材料描述与少量关系只提供 KP 可追溯判断所需语义。
3. KP 拥有可行性、DC、风险和世界因果判断；Rules 拥有机械合法性、随机、数值执行和类型化提交。
4. ProposalBundle、InteractionPlan、definition synthesis 和 Claim builder 都不拥有状态、权限、随机或独立投影。
5. 所有进入因果链的新事实、定义、关系和连续性变化都经同一 `step`、Room commit、`project/replay`。
6. Typed Claims 是纯派生投影，不是第二正史；Narration 文本也不是正史。
7. Hidden authority refs 永不进入 Viewer Claims；无权关系 Claim 整体丢弃，不能靠删 ref 掩盖泄漏 payload。
8. 当前任务不切生产、不删 V5、不迁移房间、不部署、不创建 Cloudflare 资源，也不授权 Git push。

## 14. 阶段三开发期实现回执（2026-09-02）

阶段三已经在隔离的 `runtime-srd51-2014-authoritative-vnext-stage3` Profile 下完成两条代表性纵切。生产默认 Registry、当前 V5 房间与恢复路径均未改变。

- 动态 NPC 修订从现役自然语言行动入口冻结 RequiredContext，经严格 Proposal 校验、exact base/template 合成、Rules `step`、Room DO 原子提交、`project`、Typed Claims、Claims-only Narration 与 `replay` 闭环；旧字段保留，过期 base/hash、越权知识与未知字段 fail closed。
- `world-interaction` 从自然语言“用枪打吊灯”闭合 Ability、Geometry、行动经济、弹药、权威随机、关系修订、注册 Hazard、Rules 解析的真实区域目标、伤害、死亡、感官知识、逐 Viewer Claims、失败分支、幂等、驱逐恢复与 replay。
- “烧断绳索使重物坠落”和“扔石头试陷阱”只作为结构不同的通用性与观察边界样例；另以完全不透明 ID 穿过 `step → project → replay`，证明生产路径不识别样例名称、对象 ID、材料词或测试数值。InteractionPlan 只保存注册 Hazard 引用，不保存最终 targets/amount；行动者若真实位于权威区域内也由同一关系解析成为目标。
- 直接目标与完整因果引用已经分离：`directTargetRefs` 必须同时属于冻结 Viewer evidence、具有 `entity / itemEntry / sceneFeature` 之一的权威空间角色、位于行动者当前场景并通过相同 Viewer 可见性解释器；KP-only 对象、隐藏 Tactical Feature、无场景绑定或跨场景对象不能成为玩家直接目标。`targetRefs/basisRefs` 仍可引用获授权的隐藏关系和真实区域因果，Rules 可以据此影响隐藏实体，但这些引用和由其派生的 Claim 不得进入无权 Viewer。
- `world-interaction` 的写入边界由 Proposal lowering 与 Rules 双重重验：definition revision 只能修改当前场景的 `sceneFeature` 稀疏语义，relation transition 的两个端点必须都是当前场景的类型化空间节点，registered Hazard 的 source/zone 也必须是当前场景空间对象。NPC 定义、Item 生命周期、Objective/Story/continuity 和跨场景事实不能借 `world-interaction` 改写，继续由各自 Form 与生命周期合同负责。
- RequiredContext 在 prepare 时保留完整授权正文而保持空事务 read set；Proposal lowering 只从实际 actor、scene、Ability、物品、basis、关系、效果与区域依赖生成精确 read set。角色持有物、同场 NPC 持有物及直接位于场景中的物品都进入相应权威切片；无关同场变化不冲突，真实依赖变化在首次 step 与随机结算前 fail closed。
- `project(viewer, committedRange)` 是 vNext 结果到 Narration 的唯一材料 seam；独立 `SensoryEvidenceAcquired` 事件避免嵌入证据重复，隐藏 relation/target/authority basis 不进入无权 Viewer，Narration 重试复用同一 Receipt、projectionHash、claimsHash 与 Claims。

开发期定向证据：

- `npx tsx --test tests/kp-vnext-core.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-world-interaction-rules.test.mjs tests/kp-vnext-hazard-actor-death-fold.test.mjs`：24/24，退出 0；
- `npx vitest run tests/kp-vnext-stage3-room.test.ts`：5/5，退出 0；
- `npm run typecheck`：退出 0；`git diff --check` 见最终执行日志。

本回执只证明阶段三代表性能力纵切及其直接边界。clarification、in-world refusal、独立 observe/social、完整 materialization create、inventory/objective/story/combat 等其余粗粒度 Form 的完整产品纵切，开放世界全部物品生命周期、持续燃烧 Activity、完整地图/浏览器/真实 Provider、生产采用、V5 删除、migration、部署与 Git push 均不在本次完成范围。
