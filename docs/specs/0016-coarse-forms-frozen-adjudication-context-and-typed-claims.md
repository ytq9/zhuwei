---
spec: "0016"
kind: spec
title: "粗粒度 Form、冻结裁决上下文与类型化主张"
status: ruled
authority: user
ruled_on: 2026-09-01
production_switched: false
status_detail: "已裁定；阶段三代表性纵切已有开发期回执，Availability/Bundle/真实 Provider 收口实施中；完整 Form 家族尚未全部纵切。V5 提案路径已于 2026-09-20 按 ADR 0034 删除，vNext 是唯一提案路径；尚未执行 migration、部署或发布"
depends_on: ["0001", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015"]
adr: ["0015", "0024", "0025", "0026", "0034"]
supersedes:
  - spec: "0015"
    scope: "旧 Form Catalog、environmental-stunt/详细材料阈值、model-visible compound/DAG"
revisions:
  - date: 2026-09-20
    scope: "当前边界：V5 提案路径已删除，vNext 是唯一提案路径"
  - date: 2026-09-18
    scope: "当前边界：放弃已持久化的 V5 私有 Form 房间，只保留 vNext 生产路径"
  - date: 2026-09-17
    scope: "§8.3：自然语言生成、简短实质审核与未交付结果的原子提交/取消"
  - date: 2026-09-16
    scope: "§7.2：未冻结提案的一次显式未知调用恢复，隔离晚到旧响应并保留预算与归档证据"
  - date: 2026-09-15
    scope: "§8.3：纯表达意见不阻断，实质错误允许一次修稿与复审，按账本显示恢复入口"
  - date: 2026-09-02
    scope: "收口修订"
  - date: 2026-09-05
    scope: "环境叙述修订；对应 SPEC 0001 §§3.3、7、12"
  - date: 2026-09-07
    scope: "schema 选择：完整填写边界前移与一次补选"
  - date: 2026-09-09
    scope: "再次明确可以补选，同步 §7.2 的阶段、恢复及调用边界"
  - date: 2026-09-11
    scope: "把 ADR 0015 正文承载的三条产品行为收进条款：§7.3 单一 decision 填写面、§8.3 连续性审核只报相悖、§9.1 到期 ActorPlan 的执行与恢复"
parts:
  - "0016-part-b-sparse-semantics-and-primitives.md"
  - "0016-part-c-compound-actions-and-claims.md"
  - "0016-part-d-staging-and-supersede.md"
gates:
  - "tests/kp/narration/text-protocol.test.mjs"
  - "tests/kp/narration/provisional-reply.room.test.ts"
  - "tests/kp/stories/story-external-invocation-journal.room.test.ts"
  - "tests/platform/recovery/send-action-recovery.test.mjs"
  - "tests/kp/narration/publication-repair.test.mjs"
  - "tests/kp/narration/interrupted-publication.room.test.ts"
  - "tests/kp/protocol/core.test.mjs"
  - "tests/kp/narration/claims.test.mjs"
  - "tests/kp/adjudication/stage3.room.test.ts"
  - "tests/kp/adjudication/world-interaction-rules.test.mjs"
  - "tests/kp/protocol/proposal-schema.test.mjs"
  - "tests/kp/protocol/selection-amendment.test.mjs"
  - "tests/kp/narration/generation.test.mjs"
  - "tests/kp/narration/social-context.test.mjs"
  - "tests/kp/narration/frozen-input.test.mjs"
  - "tests/kp/narration/review.test.mjs"
  - "tests/kp/narration/continuity.test.mjs"
  - "tests/kp/narration/presentation.test.mjs"
  - "tests/kp/narration/recovery.test.mjs"
  - "tests/kp/narration/actor-plan-due-claims.test.mjs"
  - "tests/kp/provider/model-call-scope.test.mjs"
---
# SPEC 0016：粗粒度 Form、冻结裁决上下文与类型化主张

- 产品：烛帷 V3（当前应用版本仍为 0.4.0）
- 适用规则：D&D 5e 2014 / SRD 5.1
- 当前边界：本规格定义当前生产 Profile 的产品与架构合同。新房自 2026-09-08 起只创建 vNext 房间；已持久化的 V5 私有 Form 房间自 2026-09-18 起放弃（ADR 0028），产品不再为其保留解释器、恢复路径或验收测试。`origin/feature/kp-form-graph-v6` 只作为已审查原型证据

## 1. 目的与能力合同

任意获得认证的玩家都可以用自然语言提出合理行动。主 KP 必须得到一份对本次裁决最小充分、权限正确、版本固定且可追溯的 `RequiredContext`，据此理解目标与方法、判断可行性、DC、风险和世界因果，并通过按权威与事务边界划分的粗粒度 Form 提出结果候选。Rules 只验证权限、引用和机械合法性，执行有限机械原语与权威随机；Room Durable Object 仍是唯一活跃状态权威。提交后，`project(viewer, committedRange)` 必须为每个冻结 Viewer 生成充分、准确、有限且可追溯的 Typed Claims。已提交结果、机械后果和角色知识由 Typed Claims 唯一证明；KP 也可按 SPEC 0001 §§3.3、7、12 创作非机械环境细节，将其保存为叙述承诺后发布。叙述承诺只约束连续性，不能直接成为机械对象或裁决结果。

本能力必须同时支持：

- 玩家行动的对象、工具、方法、目标、场景关系和结果组合不断变化，而不按动作名称增加 Form；
- 动态 NPC、场景对象、物品、能力、任务与故事连续性进入同一冻结裁决上下文；
- 缺失的决定性世界语义在玩家引用、产生因果证据、随机或机械影响前，以版本化稀疏定义或事实固化；非机械环境描写可以先保存叙述承诺；
- 一个 RootAction 跨越多项类型化提案时仍只产生一个原子 Receipt，不由模型编写执行 DAG；
- Rules 保持机械权威，KP 保持可行性与叙事权威，页面、模型、RAG、编译器和 Narration 都不成为第二权威；
- Viewer 无权知道的事实、关系和依据不进入其 Claims、Prompt、错误、日志、DOM、语音或重试路径。

本规格服从 `SPEC 0001`；2026-09-05 的环境描写调整与主规格的同日用户批准修订同步，不缩小其行为边界。

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
| `materialization` | 新世界事实或实体必须在首次因果证据、玩家引用、随机或机械影响前固化；先前环境描写按叙述承诺固化 | 稳定领域身份、来源、可见性、稀疏语义定义、模板/定义引用、原叙述承诺和固化时点 |
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
- 当前场景、被提及对象和意图相关的叙述承诺及其适用场景、受众、来源和固化绑定；它们必须保留原描述，不以模型摘要、最近 N 条窗口或检索零命中消除连续性约束；
- 适用裁决先例的正文、机械参数、适用范围和取代关系，而不是只有 precedent ref；
- 当前行动真正需要的故事锚点、核心真相约束、内容边界、安全限制与有限 recent dialogue。

RequiredContext 仍不是完整 WorldState、完整历史或完整 Story Bible。无法构造最小充分且不泄密的上下文时返回 `CONTEXT_INSUFFICIENT`，不得让模型猜测。

叙述承诺与机械对象必须明确区分：前者可约束“之前已经如何描写”，不能仅凭出现于上下文就取得 Item、Ability、Geometry 或其他可机械操作实例的资格。玩家引用或利用尚未固化的细节时，先沿相同 Proposal、Rules、Room 提交链固化；所需原承诺进入本次冻结读取集，存在、外观、位置和关系不得借此重写。后续权威事件产生的真实变化可以改变现状，但必须保留原承诺及其因果变更记录。

### 4.3 先检索相关内容，再完成决定性闭包

上下文构造不得先收集整个场景或大量定义再依赖总量上限截断。它必须先从玩家意图派生目标、工具、行动范围、背景事实和决定性依赖等检索角色，再按以下顺序构造：

1. 精确读取 actor、当前场景、明确对象、持有物、已选能力与直接引用；
2. 沿本次行动相关的类型化关系、生命周期与 Geometry 依赖扩展；
3. 以结构签名和取代链检索适用裁决先例，再以语义相似度排序长尾候选；
4. 对静态规则、模板和模组片段按 exact source/profile/hash/span/权限重读；
5. 对会改变可行性、风险、目标或结果的依赖完成不可截断的决定性闭包；
6. 最后才裁未采用的 RetrievedContext 与 Optional 内容。

2026-09-06 用户为本次 vNext 快速开发部署明确将原普通 8k / 全体 16k 输入与百分比压缩指标改为优化参考，不作为本次阻断门；统计采用认证后置，详见 [执行决定](../agent/vnext-production-todo.md#本次快速开发部署决定2026-09-06)。运行时仍须执行可配置的异常预算；决定性闭包超过实际预算时返回 `CONTEXT_BUDGET_EXCEEDED`，不得随机裁掉闭包的一部分继续裁决。实现中的大对象数量只可作为异常防爆保护，不能代表正常可接受规模，也不能掩盖相关性检索失败。

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

## 分册

本规格的其余条款在以下分册，编号连续：

- [§5–§6 稀疏语义定义与 Rules 有限原语](./0016-part-b-sparse-semantics-and-primitives.md)
- [§7–§8 复合行动与 Typed Claims](./0016-part-c-compound-actions-and-claims.md)
- [§9–§13 分阶段实施、纵切验收与窄 supersede](./0016-part-d-staging-and-supersede.md)
