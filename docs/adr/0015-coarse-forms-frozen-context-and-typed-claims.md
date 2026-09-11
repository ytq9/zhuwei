# 按事务边界组织粗粒度 Form，并以冻结上下文和类型化主张闭合裁决

- 状态：已接受（用户于 2026-09-01 明确裁定）
- 日期：2026-09-01
- 关联规格：SPEC 0001、SPEC 0003–0015、SPEC 0016
- 取代范围：仅对下一代完整 Profile 取代 ADR-0014 中“十张动作型小 Form + model-visible compound + 详细动态环境阈值”的目标方案；ADR-0014 的静态检索、一次窄修订、body-only Narration、双状态、逐受众恢复和 V5 历史事实继续有效
- 实现状态：阶段三代表性纵切已有开发期回执；Availability/Bundle/真实 Provider 收口实施中，其余 Form 产品纵切仍待，当前 V5 生产不变，未直接合并 `feature/kp-form-graph-v6`，未 migration、部署或发布

## 背景

V5 的十张窄 Form 避免了一个超级 Schema，却按观察、普通检定、高风险、环境特技等动作形态切分，并把未预见组合放回 `compound.v1`。`feature/kp-form-graph-v6` 进一步证明了“KP 自选多个 Form、整批由 Rules 核定”在技术上可实现，但它把 Catalog 扩为十五种原子 Form，并要求模型维护 `nodeId/dependsOn/condition` 图；复杂性从 compound 转移到模型编写的 DAG，仍会随效果种类扩张。

同时，当前链条已能从 Room/Rules projector 取得大量角色、场景、NPC、物品、动态事实、连续性和先例信息，但 `RequiredContext` 的实际收集会丢弃其中一部分；提交后的 Narration Implementation 又可能只从 `committedDelta.changes` 生成材料。详细 `EnvironmentFeature` 阈值也不能覆盖现实世界无限组合，且会不必要地把 KP 的可行性判断下沉为材料物理系统。

## 决策

### 1. Form 只按权威与事务生命周期划分

下一代模型可见 Form 家族固定为 clarification、in-world refusal、observe、social、materialization、world interaction、inventory operation、objective continuity、story continuity 和 combat。普通/高风险是每个行动 Form 共用的五类 Ruling，不再是 Form；射吊灯、烧绳子、推柜子、扔石头和类似对象/动作不产生新 Form。

一个 RootAction 跨多个合同的复合能力由服务器私有 `ProposalBundle` 承载。2026-09-07 按用户决定简化模型填写 Interface：模型提交单一 `decision`，表达目标、做法、裁决、后果、各步骤真实依据与新对象局部 handle。直接成功只填 `result`；检定一次填写 DC、风险和成败意义，由唯一检定步骤填写完整 success/failure，其他步骤声明 outcome binding。服务器组装固定外壳、根 basis、producer 声明和静态模板 hash，从明确依据和类型化引用准确导出 consumes，再交现有完整 Bundle validator、graph、lowering 与 Rules。目标引用本身不能推导角色知识或事实依据。`compound` 不再是模型 Form，模型不填写 node ID、依赖或 DAG。依赖不唯一或超出有限原语时显式诊断、澄清或拆为后续 RootAction。

填写 schema 是既有领域 schema 的展示转换，不构成第二套接受规则；当前 parser v37 只接受新填写结构。observe/worldInteraction 等多集合结果由原 schema 派生为必填 entries 列表，各项用 recordKind 标明原集合并保留原 payload；服务器分组还原领域数组，明确空列表才生成全部空集合。缺失列表、混用类型或旧并列数组拒绝，不猜效果或删除额外推断；单集合 Form 不增加包装。修订票据 vnext-5 保存完整原始 arguments，并重新解析、绑定同一草稿和冻结上下文。只允许一次已证明等义的格式修订；缺失裁决、目标、DC、资源代价或后果不能由服务器或 correction 补造。模型按实际效果选择最小 Form；临时物理操作不自动创建 Item/Ability，持久组件关系在 ItemSystem 的 assembly 记录中创建、提交与拆解；模型仅指定原组件引用、数量和可恢复性，不重复写 worldRelation 或自动创建 Item/Ability，不能用描述文本冒充。

2026-09-07 首轮填写收敛及同日批准的（决定记录见 [ADR 0020](./0020-flat-selection-and-one-supplementary-pick.md)）[一次补选](../agent/receipts/vnext-selection-composition-validation.md)：首轮只填扁平 requestedCapabilities，第二轮才填所选小表单或执行家族；若缺少必要类型，可按并集补选一次，补选后只准提交。类型从同一领域 schema/注册表派生，expanded 仅装配所选表单和类型依赖。Room 保存精确响应证明阶段，原意图与完整冻结上下文不变；空执行集合不生成无效 direct/check/clarification，未加载种类不能借修订换裁决。2026-09-09 用户重申允许补选；阶段提示词按实际 amendable 状态互斥生成并纳入 prompt hash，与工具集合及 Room 恢复校验一致，通用说明不再另行授予补选权限。调用额度统一见 SPEC 0016 §7.2，闲置选择不增加修订预算，HTTP 上限保持。本地检查不证明真实模型稳定性；[扁平选择验收](../agent/receipts/vnext-flat-selection-validation.md)与更早回执保留历史证据。

同束新对象使用模型局部 handle 和服务器生成的 prospective ref。Rules `step` 通过正式 reducer 构造不可观察的分支候选状态，并复用唯一空间/可见性解释器验证后续 consumer；不新增 speculative projector。所有可达分支在随机前预检，最终物化与消费原子提交，候选状态不产生 Claims、Receipt 或公开事实。

Bundle 只有一次整体语义冻结和最多一次窄 correction；合并 correction 后服务器重新校验完整 Bundle。Context/Provider 故障不消耗模型修复机会，修复再失败显式 `PROPOSAL_REPAIR_EXHAUSTED`。

### 2. RequiredContext 同时冻结认知权限与实际读取集

Room prepare 从 Authority 与同一 `project` 构造最小充分的 `epistemicContext/epistemicRefs`，并单列本次裁决真正依赖的版本化 `readSetRefs`。前者限制 KP 被授权知道的事实；后者参与 scope/version 冲突、诊断和审计。角色 mechanics、动态定义正文、场景对象/关系、NPC 有限知识、物品定义、Objective/Story 连续性和先例正文不能只留无法理解的 ref。

静态 RAG 仍只负责定位版本化资料，使用前按 exact source/profile/hash/权限重读。缺少决定性事实时必须先 materialize/revise；上下文不足时 fail closed，不能让模型猜。

RequiredContext 以同一个五态 Availability Interface 区分 `known / knownAbsent / openBlank / ambiguous / unavailable`，不新增场景覆盖标记。零命中不表示不存在；`knownAbsent` 只来自权威、带范围和版本的否定依据；`openBlank` 表示 KP 在已加载约束和版本化授权内仍可决定存在或不存在。多候选先按本次行动相关语义判定是否可互换，纯身份差异不触发澄清，只有会改变重大危险、成本、攻击对象或不可逆结果的差异才询问玩家。

上下文构造先按意图、直接对象、工具、关系和适用先例精选，再补齐不可截断的决定性闭包。2026-09-06 用户为本次快速开发部署明确将普通 8k / 全体 16k 改为优化参考，详见[执行决定](../agent/vnext-production-todo.md#本次快速开发部署决定2026-09-06)。冻结 artifact 的异常上限现为 160,000 canonical units（UTF-8 字节/4），独立完整 Provider 请求仍执行当前预算 Profile 的 58,000 估算输入额度（64,000 减 4,000 输出预留及 2,000 余量）；两种计量不混称模型实际 tokens。决定性闭包超实际预算时显式失败，不截断必要内容；提高 artifact 上限不证明最终模型请求已适配，大对象数量也不能替代相关性检索。

### 3. 对象使用稀疏语义，不建设详细材料物理

动态对象/NPC 只保存稳定身份、简短描述、可选 `materialDescription`、可见状态、相关 mechanics refs 和少量类型化关系，如 supports、attachedTo、contains、blocks、triggers。KP 根据冻结语义、工具、Geometry、自然规律和先例判断可行性、DC 与因果；Rules 只验证可执行机械。

已有动态定义的修订绑定 exact base/template hash。KP 提交允许字段的稀疏领域变化，服务器合成完整不可变 next definition，再由 Rules 验证与提交；模型 patch 不进入状态，不双写旧/新定义。结构强度、燃点、载荷阈值等只有在某项实际游戏机械明确需要时才由专用版本化定义表达，不成为所有环境对象的通用必填模型。

模板只作为版本化静态语料和创建时默认值，不能声明 allowed overrides、证明场景中存在实例或成为实时继承层；写入字段由 Profile 固定，实例在创建时绑定 exact template hash 并一次合成。场景中的可互动对象保持独立稳定身份；同质实例的无意义选择由行动相关的可互换候选规则处理，不用复数对象无限抽取个体。

2026-09-06 新经历纵切复用 `materializeObject/worldFact`：定义保存唯一正文及发生时间、初始知情依据和 KP 一致性自检；CanonicalFact 保存精确 definition/revision/hash 指针，Knowledge 保存持有人。Rules 按同一 RootAction 原子生成三者，NPC 同束回应仅可显式消费已声明的初始知识，旧 NPC 快照保持冻结；来源主张不把内容变成世界真相。创作约束 frame 包含主体既有事实、因果父事实、相关定义与连续性，集合变化参与读锁；frame 不授予 NPC 知识。正文、知识、回应与动机在骰前固定，恢复完成标记须在全部新事实和初始知识写完之后释放计划。没有新资源、第二权威或额外 Provider 调用。

该一致性字段是同一次 KP 创作调用的语义自检；Rules/hash 只执行其结构、来源权限、状态绑定及原子边界，不能证明模型识别任意年龄/经历矛盾，也不能识别未声明来源的隐含秘密借用。提交后旁白审核不替代提交前正史检查。自然语言判断与真实模型验收保持待验证，见[新经历与记忆验证](../agent/receipts/vnext-world-fact-memory-validation.md)。

### 4. Rules 只执行有限原语，KP 不提交最终结果

Rules 私有原语覆盖 Ability/check/cost、事实/知识、definition create/revise、relation/state transition、inventory lifecycle、objective/story lifecycle、Activity/time 及已注册 Hazard/Geometry 后果。不存在自由 `worldEffects`、JSON Patch、任意事件、按对象名派发或通用物理求解。

KP 决定五类可行性、DC、风险和骰前成功/失败意义；Rules 重新验证权限、引用、行动经济与生命周期，使用 Room DO 唯一随机并计算最终数值。模型不能填写骰面、最终伤害、实际隐藏 targets 或“已经成功”。

### 5. `project(viewer, committedRange) → FrozenRenderableClaims` 是唯一叙述 seam

Rules 从提交事件范围生成内部 Typed Claims，再按 Viewer grant 投影为冻结材料。内部 basis 分为 `authorityRefs` 与 `viewerRefs`；authority refs 永不外发，隐藏关系 Claim 整体删除。有权 Viewer 的材料覆盖真实机械、能力效果、具体感官证据、场景事实、来源主张/推断、物品/Objective/Story 连续性、压力和机会。

Narration 接收 Receipt、ViewerKey、FrozenRenderableClaims，以及随 Delivery 原子保存的 FrozenNarrationContext（2026-09-05 用户批准的表达重构）（决定记录见 [ADR 0018](./0018-narration-expression-and-character-consistency.md)）。Rules 仍独占 Claims 派生；外层 contextHash 绑定 Claims、身份与获授权表达材料，不成为世界事实写口。Narration 不读取当前 WorldState 或从通用 delta 猜事实；恢复复用同一 projection/claims/context hash，不重提案、重投影、重掷或重复资源。vNext 采用自然正文生成后一次独立审核，替代第二次改写；两次调用共享 45 秒上限。审核检查事实、玩家意图、可读性及人物一致性；不改变意图、机械或因果结果的普通动作润色合法。

2026-09-07 用户进一步明确：普通新创作无须已有内容引用；连续性审核应指出具体相悖事实，来源主张保留归属，程序严格约束机械和权限。现役审核采用精确body/冻结材料绑定的异常报告，删除逐片段逐事实正证据矩阵；仅已提交机械结果分组检查完整性。沿用一次独立审核与冻结恢复，不增加提交前审查调用。模型语义不提供绝对正确性证明，可靠性以真实游玩错误频率、严重程度和恢复评估，不把该局限作为持续加审或无限延期的理由。见[实现与反例证据](../agent/receipts/vnext-narration-conflict-review-validation.md)。


2026-09-05 用户批准的环境描写补充（决定记录见 [ADR 0017](./0017-environment-narration-and-on-demand-materialization.md)）：KP 可以在提案阶段创作非机械环境细节，由同一 Room 权威保存为轻量叙述承诺，再沿 Viewer/Claims seam 发布；首次描写不要求创建完整物理对象或机械定义。RequiredContext 按场景、对象与意图读取相关原承诺，玩家引用或产生因果/机械影响前通过正常 materialization 固化并绑定原描述。承诺本身不获得 Item/Ability/Geometry 操作资格，不改写既有事实；恢复复用冻结承诺，错误走审计更正。此补充落实 SPEC 0001 §§3.3、7、12 与 SPEC 0016 §8 的同日修订，保留单一提交与投影路径，无需新增持久化资源或额外模型调用。

2026-09-07 既有ActorPlan到期沿同一Activity队列与独立child root，真实原因提交后冻结NPC限知请求，以原schema/validator完成一次strict决定。原请求/响应沿既有journal持久化，服务器RPC capability复用当前HTTP的模型绑定、预算及捕获；alarm无transport时不调用模型。已发送响应未知不重采样，已保存响应/骰子/资源恢复复用。公开trace只取提交结果，私有计划字段不进入Claims。见[实现与定向证据](../agent/receipts/vnext-actor-plan-due-validation.md)。

2026-09-07 被动时间经过：`passTime`只接受时长，服务器派生原意图、身份、Activity与冻结read-set；Rules复用Activity/due权威，逐段推进至真实deadline并先处理到期义务。未知响应不重采、不越过期限；技术阻塞不生成世界中断。本人Activity显示源clock实际时间，纯时间终结Claims保留审计并确定性交付，NPC及混合机械结果仍走原旁白，以遵守每HTTP5调用。parser v29/ticket v4保留原数字token证据，只对等值正十进制安全整数允许一次表示修复，不补时长、目标或后果。见[实现与验证边界](../agent/receipts/vnext-passive-time-validation.md)。

### 6. 先拆接缝，再做两条纵切；当前不切生产

阶段一只做无行为变化的大文件拆分和 seam 提取；阶段二实现新 Profile 的 Context、稀疏定义、有限原语、ProposalBundle 与 Claims conformance；阶段三只完成两条真实纵切：已有动态 NPC 的稀疏语义修订，以及自然语言“用枪打吊灯”。烧绳索使重物坠落和扔石头试陷阱只验证非名称特判与观察边界。

三个阶段均不自动注册生产默认、不删除 V5、不迁移房间、不部署。采用或替换需要后续独立决定。

阶段三既有回执只证明两条代表性纵切。继续扩展 Form 前，先以“权威合同 → 可丢弃最小 Bundle schema → 真实 strict Provider 探针 → schema 冻结 → 完整 consumer”的顺序完成收口，并增加 `materialization + world-interaction` prospective ref 纵切。Provider 的 strict 能力必须由实际 Adapter 参数、Provider dialect 和绑定 profile/schema/parser 的 live evidence 证明，不能由 Registry 元数据自报。

## 被否决的方案

- 直接合并 `feature/kp-form-graph-v6`：其中版本化 closed schema、整批预检、单 RootAction/Receipt 和提交后 Narration 可作为实现证据；十五原子 Form、模型 node/dependency DAG、V6 默认切换和大面积当前代码替换不是目标架构。
- 继续细分动作型 Form：无法穷举自然语言物理互动，并持续增加模型和测试 Interface。
- 保留万能 `compound`：把所有未预见能力重新集中到一个浅而复杂的模型合同。
- 新增 `sceneObjectCoverage`：与既有五态重复，并把 KP 对开放留白的存在性判断误降为场景枚举问题。
- 对 speculative overlay 运行完整 `project()`：计算并暴露候选世界不需要的正式投影语义；采用 Rules 内部候选状态与共享可见性解释器。
- 用复数 `sceneFeature` 无限抽取个体：会让集合与实例同时声称存在并破坏稳定身份；真实可互动对象保持独立实例，可互换性由 Context 选择规则处理。
- 只有自由标签的对象：`易碎/可燃` 缺少具体语义和关系，无法提供可追溯因果；采用简单描述、可见状态与有限关系。
- 建完整材料/物理引擎：成本和错误面远超游戏需要，也会侵占 KP 对世界可行性的判断。
- 让 LLM 直接决定最终成功、伤害或状态 patch：会把模型变成第二机械与状态权威。
- 只改 Narration Prompt：Grounding 正确禁止补事实；材料缺口必须在 Context、Rules projector 和 Typed Claims seam 修复。

## 后果

优点：Form Interface 随权威边界而不是动作数量增长；上下文权限、并发读取和证据链可审计；对象语义足以支持开放互动而无需模拟现实；复合事务保持原子且模型不写程序图；Narration 能表达真实结果又不补事实。

代价：需要新的 Catalog/Context/Definition/Claim Profiles、服务器 bundle 编译与 conformance；projector 必须生成更丰富的 Viewer-safe Claims；一些无法由有限原语表达的机械仍需诊断或后续发布新解释器。

安全影响：KP-only facts 可参与裁决但不进入 NPC/Viewer/Narration；read set 防止混用新旧世界；隐藏 relation claim 整体裁剪；模型 patch、DAG、targets、骰面和任意事件均不成为旁路。

## 验收

以 `SPEC 0016` 的 FC01–FC09 和阶段三两条纵切为准。

实施过程中的 12 条记录（2026-09-02 至 2026-09-09：纵切完成、parser v33/v36/v37、承诺生命周期、供应商约束修正）见 [ADR 0015 实现记录](../agent/receipts/adr-0015-implementation-notes.md)。
