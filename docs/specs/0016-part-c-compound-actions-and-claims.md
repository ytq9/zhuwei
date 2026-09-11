---
kind: part
part_of: "0016"
title: "SPEC 0016 分册：复合行动与 Typed Claims"
clauses: "7-8"
---
# SPEC 0016 分册：复合行动与 Typed Claims

本文件是 [SPEC 0016](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) 的 §7–§8，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

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

首轮仅以扁平 `requestedCapabilities` 数组选择类型，不填写 decision 或草稿。小表单标识从同一领域 schema 的填写转换派生；服务器保留实际所选小表单身份，只加载所选执行家族与类型依赖。未知标识、重复 ID 和混合草稿继续拒绝，不将缺失裁决的响应改写为类型查询。

2026-09-06 用户批准 [按需 Proposal schema 合同修订](../agent/proposals/schema-retrieval-contract-proposal.md)。2026-09-07 按用户简化填写接口与调整 Goal 验证的决定，首次单一 strict 工具只选择轻量目录中的 schema 类型，第二轮才填写；knowledgeReview、passTime、inWorldRefusal 也经过相同选择，clarification 须先选齐完整 continuation 所需家族。服务端只加载所选家族及类型依赖，全部已注册能力均可召回，不能按物品名、动词或已有对象存在性硬裁玩家的合理行动。schema 选择不得夹带 Proposal 草稿、裁决、风险、成本、结果或世界事实，不产生语义冻结或任何机械、世界、随机、资源与发布副作用。服务端从冻结版本的注册表精确读取选中 schema，并沿类型依赖补齐完整定义；schema 标识不是物化权限或存在证明，后续仍执行完整本地与 Rules 校验。

2026-09-07 用户批准[完整填写边界前移与一次补选](../agent/receipts/vnext-selection-composition-validation.md)，2026-09-09 再次明确允许补选。首轮只选择类型；提案填写轮允许提交，或在已加载类型确实不足以表达完整原意图时按并集补选一次。补选只能新增所需操作或终结表单，不能删减原选择，不夹带草稿、裁决、目标、成本或结果，不改变玩家方法、冻结上下文或重开裁决。补选后的下一轮只允许提交；提交后的重发或窄修订不再开放类型选择。

Room 在外部调用前保存精确请求及 hash，在下一阶段前保存响应；每次选择、补选与提案填写均绑定同一完整冻结上下文。恢复从已保存响应证明是否已补选，不重读新世界或重新选择版本。允许补选与只准提交使用互斥的阶段提示词；同一阶段状态决定实际工具集合，恢复同时验证提示词、工具及正文。通用权威与填写说明不另行授予补选权限。

沿用上述已批准调用额度：未补选时普通小表单最多 2 次，实际含已选执行家族的复杂提案最多 3 次且至多一次窄修订；实际发生补选时分别最多 3 次和 4 次。第四次仅在保存响应证明补选已发生且仍满足原稿重发或窄修订准入时存在；额外选择闲置家族不能为最终纯小表单取得执行家族的修订额度。全部实际调用及 Provider 重试均计入 RootAction 调用、token、费用和延迟预算，原 HTTP 总预算保持。模型采用的统计认证按快速部署决定后置，产品正确性边界不变。未知标识、混合草稿、无新增类型的补选、超出许可的再次补选、不可闭合定义和预算超限是技术失败，不是 clarification、世界内拒绝或成功结果。

2026-09-09 用户明确批准[完整故事创作的独立调用预算](../agent/proposals/story-creation-call-budget-decision.md)。仅在绑定该合同的新开发期 Profile 中，完整故事准备采用独立、版本化作业：初稿与独立审查通常共两次，最多再进行一次必要修订及修订后复审，每份新准备最多四次实际模型调用。解析失败、Provider 重试及其他付费步骤也占用该额度，不能通过换阶段、请求、jobId 或重包装同一机会重置额度。所有调用、token、费用与延迟同时关联来源 RootAction/已提交世界事件的总预算；子额度不解除来源及房间的共同限额，未知 usage 不记为零。结果保存后恢复不再调用，已发出但结果未知不自动重采样。创作修订仅改尚未固化的草稿，不能改玩家意图、锚点、既有事实、叙述承诺或骰前冻结的机械结果。该工作流不是 Proposal 窄修订，也不扩大普通行动现役限额；准备包仍须经正常 Rules 验证、Room 原子接入与 Viewer 投影，额度不足不省略完整材料或独立审查。创作成本不构成世界惩罚，现实等待不推进虚构时间。此补充不改变现役房间解释或授权生产切换。

2026-09-09 用户明确裁定并要求修改修补机制：缺失必填字段可以补齐；KP 根据具体错误重新判断尚未生效的裁决也属合理修订。该决定取代本节此前“首份草稿即语义冻结、服务器先证明等价修改、模型仅确认固定修复/补摘要”的限制。此变更沿用本节普通 Proposal 的一次修订及所选类型调用额度，不增加反复采样循环。

2026-09-09 用户进一步批准差量修补与开销优化，并明确“不改变当前一次修订的额度”。以下协议取代此前发送原始输出与内部转换稿、仅完整返回提案的要求；三轮修订、¥0.30、60 秒及总调用 5/6 次等草案数值未获本次批准，不启用。

可解析时，模型只读取一份原始填写表示 `decision / steps / results`；请求带上其明确源版本、同一完整冻结 RequiredContext、原玩家意图与当前具体诊断（错误码、填写字段路径、预期合同及实际错误值）。原始字节、内部转换稿和校验器原路径只保存在 Room 私有审计中，不重复放进模型请求。派生容器的错误定位到其真实填写来源或所属对象，不虚构内部字段对应的填写路径；大型实际值引用唯一草稿中的位置，不能裁剪决定性上下文。

KP 可以返回 `mode: "patch"` 与 JSON Patch `add / replace / remove` 操作，也可以返回 `mode: "replaceDraft"` 与完整 `draft`。补丁不限于最初报错字段，允许替换对象、数组、增删步骤与结果分支；步骤序号变化须自行配套修改结果对应关系。原始 JSON 无法严格解析时，唯一草稿为 `null`，仅准完整替换，不清洗、猜补原稿。重复 JSON 成员继续拒绝，不通过清洗非法结果制造成功。

修订权限保持：可以补齐必填字段，也可以调整尚未生效的属性、DC、风险、成本、成败后果和操作组合；必须保留玩家真实目标与做法，遵守授权范围、故事锚点和已固化事实，只能使用已加载类型。模型返回明确的源草稿版本。服务器在副本上顺序、确定性地应用补丁；任一操作不能应用则整份拒绝，不保留已应用前缀，不产生游戏效果。身份、冻结上下文、权限和服务端绑定不在可修改文档内。

为避免严格工具 schema 为任意 JSON 值重复展开全部子树，当前 Provider 传输使用封闭外层 `sourceDraftVersion / revisionJson`，后者是上述修订文档的 JSON 字符串。内外层都严格解析且拒绝重复成员。系统说明、所选表单和完整冻结上下文位于稳定前缀，变化的草稿与诊断靠后；记录 Provider 实际缓存命中与输出用量，未经真实测量不承诺节省比例。

合成成功不等于行动合法。服务器从头重跑整份修订稿的 closed-schema、引用、权限、跨字段、produces/consumes、条件支配、循环/规模、lowering 和 Rules 预检。字段补丁、完整替换及非法 JSON 的替换共用现有一次修订额度。第一份通过完整校验的方案结束修订；源版本错误、非法补丁、重复草稿或再次校验失败返回 `PROPOSAL_REPAIR_EXHAUSTED`，不再修订、掷骰或部分提交。最终合法方案在交付玩家确认、请求随机或开始执行前冻结，资格由 Room 持久状态决定；后续确认、掷骰、Activity 完成与恢复复用该方案，不重开裁决。

Room 在外部调用前保存源版本、原稿、诊断、所选类型、上下文绑定和精确请求；响应、确定性合成结果、内部转换稿、验证结果及逐次调用/累计用量另外保存。运输重试复用同一请求和修订资格，实际尝试、耗时和 Provider 用量进入审计，缺失用量与费用保持未知而非零。恢复复用已保存的请求和响应，不重建模型上下文、不替换源草稿、不刷新修订额度，也不重复骰子、资源、事件或提交。

本地表单错误与 Rules 预检错误共用一次修订额度；后者须由 Room 对保存的首稿执行同一 lowering/Rules 预检证明，调用方的诊断不能单独授予修订。Context 缺失/过期/超预算、Provider schema 配置、网络、限流和超时保留原技术失败路径，不包装成玩家 clarification 或世界内拒绝。修补失败时保持未提交，保留玩家输入与最终具体原因。

### 7.3 模型只提交一份 decision

模型对一个 RootAction 只提交一份 `decision`，表达目标、做法、裁决、后果、各步骤的真实依据，以及新对象的局部 handle。直接成功只填 `result`；需要检定时只填写一次 DC、风险与成败意义，由唯一的检定步骤填写完整 success/failure，其余步骤声明 outcome binding。

服务端组装固定外壳、根 basis、producer 声明与静态模板 hash，并从明确依据和类型化引用导出 consumes，再交完整 Bundle validator、graph、lowering 与 Rules。模型不填写 `nodeId`、依赖或执行顺序。

目标引用本身不推导角色知识或事实依据。依赖不唯一或超出有限原语时，显式诊断、转为澄清，或拆为后续 RootAction；服务器不猜测补全。

## 8. Typed Claims、叙述承诺与发布

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
- 非机械环境叙述承诺：发布前保存原描述及其场景、受众和来源，作为连续性材料投影；它不证明新的机械结果或对象已经物化；
- `pressure` / `opportunity`：必须有已提交事实或可见状态依据；
- `actionCommitted`：只作最低事务事实，不能在存在更多可叙述事实时替代其他 Claims。

Claim 必须充分覆盖真实机械结果、直接感知、与行动相关的既有场景事实、压力和机会；“有限”表示只包含当前回应所需内容，不表示只叙述 `committedDelta.changes`。

### 8.3 Narration、Grounding 与重试

Narration 输入只有当前 `PublicReceipt + ViewerKey + FrozenRenderableClaims`、本次获授权且冻结的表达上下文及 Narration Policy。表达上下文包含可信 Viewer/行动者关系、仅行动者本人可见的原意图、相关 NPC 公开声口与已表现的态度、相关已听对话、场景基调和叙述承诺；它约束表达与连续性，不证明新的世界或机械事实。2026-09-05 用户批准该 Narration 重构，并明确不改变意图或后果的普通动作润色可以接受；润色不能推出额外行动、规则状态、潜行成功、无人察觉等效果。

Narration 不读取新 WorldState、通用 committed delta、Story Bible、完整 KP Context 或未冻结 recent dialogue。非机械环境创作必须在发布前保存为 Room 权威中的叙述承诺，并沿相同 Viewer 投影交接；可以在 Proposal 阶段提出承诺，再经 Claims seam 交给 body-only Narration 表达，不要求额外模型调用。Narration 不能凭自由文本增加机械后果、改写承诺、决定 Audience 或替玩家选择。

Grounding 对 Claim payload、叙述承诺、Viewer grant 和 agency 逐项校验。Narration 失败后的重试必须复用相同 receipt、ViewerKey、projectionHash、claimsHash、claims 和完整冻结表达上下文，不重新 project 当前世界、不重跑 KP Proposal、Rules、随机或资源结算，不重新创造环境。原已发布或已冻结文本及承诺是恢复依据；相关决定性材料不为 token 预算任意截断。

普通新创作不要求已有内容引用。连续性审核报告与既有事实相悖的具体条目，不生成逐片段逐事实的正证据矩阵；来源主张保留归属，程序严格约束机械与权限。现役审核使用绑定精确 body 与冻结材料的异常报告，只对已提交机械结果分组检查完整性。沿用一次独立审核与冻结恢复，不因此增加提交前的审查调用。

模型语义不提供绝对正确性证明。可靠性以真实游玩中的错误频率、严重程度与恢复情况评估；该局限不作为持续加审或无限延期的理由。
