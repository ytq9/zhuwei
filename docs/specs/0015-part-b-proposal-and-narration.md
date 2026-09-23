---
kind: part
part_of: "0015"
title: "SPEC 0015 分册：Proposal 验证、Narration 与双状态"
clauses: "6-9"
---
# SPEC 0015 分册：Proposal 验证、Narration 与双状态

本文件是 [SPEC 0015](./0015-private-form-context-rag-and-narration.md) 的 §6–§9，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 6. Proposal 验证、一次窄修订与语义冻结

### 6.1 调用预算

每个 RootAction 普通路径最多一次主 KP Proposal 调用。无工具、多个工具、未知工具或未在本次 allowlist 中的工具属于选择协议错误，立即返回稳定 `PROPOSAL_FORM_INVALID`，不得借修订让模型重新选择 Form。只有模型已经选择一个合法且获准的工具，但其 arguments 存在 JSON/schema、引用、版本、冻结语义或可结构修复的 Rules 诊断时，才最多追加一次同工具窄修订。一次修订后仍非法、修订改用别的工具或再次违反语义即返回 `PROPOSAL_REPAIR_EXHAUSTED`；总调用数最多两次，不得第三次发送完整 Prompt。

2026-09-06 用户批准 [按需 Proposal schema 合同修订](../agent/proposals/schema-retrieval-contract-proposal.md)，仅为绑定新合同的 vNext Profile 增加 Proposal 前的 schema 选择例外。2026-09-07 按用户决定改为首轮扁平类型选择，并批准[填写时一次并集补选](../agent/receipts/vnext-selection-composition-validation.md)；2026-09-09 用户再次明确允许补选。首轮不填写提案，填写时可提交或补选一次，补选后只准提交。所有类型来自同一 schema/注册表，clarification 仍须选齐完整 continuation 所需家族；只加载所选表单及类型依赖，不并入未选家族。选择与补选不包含裁决、草稿、目标、成本、结果或世界副作用，不改变玩家原意图与完整冻结上下文；未知、重复 ID 及混合草稿拒绝。Room 从保存响应证明阶段，提示词与工具权限一致；恢复、重发与窄修订不得重新开放补选。当前 vNext 调用额度、重试记账及恢复准入统一服从 [SPEC 0016 §7.2](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md#72-bundle-语义冻结与一次窄修复)，不以闲置类型提高修订预算；真实模型验收独立记账。

schema 标识只选择已注册填写面，不证明世界存在性、物化权限或机械合法性。未知标识、混合草稿、无新增类型或超出许可的再次补选、不可闭合定义和预算超限均明确技术失败，不得改成玩家 clarification、世界内拒绝或假成功。每次外部调用前 Room 保存精确请求及 hash，并在进入下一阶段前保存响应；恢复复用同一请求与已保存响应，不重新选择能力、版本或世界事实；部署换版本后尚未冻结的方案按 [SPEC 0016 §9.2](./0016-part-d-staging-and-supersede.md) 重问。Provider schema 配置、网络、限流和超时继续服从 §12 的技术故障边界，不消耗语义修订机会。该例外不改变既有 V5 Profile 的两次调用上限。

2026-09-09 用户明确批准[完整故事创作的独立调用预算](../agent/proposals/story-creation-call-budget-decision.md)。仅在绑定该合同的新开发期 Profile 中，完整故事准备采用独立、版本化作业：初稿与独立审查通常共两次，最多再进行一次必要修订及修订后复审，每份新准备最多四次实际模型调用。解析失败、Provider 重试及其他付费步骤也占用该额度，不能通过换阶段、请求、jobId 或重包装同一机会重置额度。所有调用、token、费用与延迟同时关联来源 RootAction/已提交世界事件的总预算；子额度不解除来源及房间的共同限额，未知 usage 不记为零。结果保存后恢复不再调用，已发出但结果未知不自动重采样。创作修订仅改尚未固化的草稿，不能改玩家意图、锚点、既有事实、叙述承诺或骰前冻结的机械结果。该工作流不是 Proposal 窄修订，也不扩大普通行动现役限额；准备包仍须经正常 Rules 验证、Room 原子接入与 Viewer 投影，额度不足不省略完整材料或独立审查。创作成本不构成世界惩罚，现实等待不推进虚构时间。此补充不改变现役房间解释或授权生产切换。

### 6.2 冻结语义 hash

首次 Proposal 前对以下语义做规范化 hash：

- 玩家 `goal`、`method`、`target`；
- 已确认 `playerChoices`；
- 已产生并将被采用的 NPC 回应语义；
- PreparedAction、相关 scope baseline 与 Profile refs。

修订只能收到：唯一所选工具及其 Form schema、经过长度限制的原始 arguments/可解析草稿、合并后的精确诊断、有限引用列表和冻结语义 hash。它可以修字段、引用和机械组合，但必须调用同一个工具，不能自行换 Form。arguments 语法损坏时，只有完整、直接、顶层且键不重复的已解析成员可以证明冻结语义；嵌套同名键、重复键、截断值或无法证明的字段不能被猜测。普通或高风险 Form 被 Rules 证明表达力过窄时，只有服务端可以在冻结语义不变、总调用预算仍为两次的前提下授权升级到 `compound.v1`。修订不得重发完整模组、完整历史或完整 Story Bible。

任何权威骰面出现后，禁止改变 DC、风险、成本、对象属性、目标选择规则、成功/失败后果或环境阈值。语义 hash、引用或骰前参数不一致时 fail closed，不把非法 Proposal 当作世界内失败。

### 6.3 CausalActionProgram

合法 Form 由确定性编译器生成独立版本的 `CausalActionProgram`。它必须 closed、acyclic、bounded，节点和边数量有固定上限，分支条件只引用注册 primitive 和已冻结事实。它可以表达事实固化、NPC 回应、Activity、机械动作、环境状态转换与提交依赖，但不能包含脚本、任意表达式、JSON Patch、WorldEvent、骰面、authority 字段或客户端实际 target list。

编译结果仍只是 Rules Input 候选；只有 `step` 能诊断/执行，只有 Room DO 能提供随机并提交事件。新增 primitive 必须发布新的 Rules manifest/interpreter，而不是在编译器中藏一条机械路径。

## 7. Body-only Narration 与 Grounding

新旁白策略的生成与修稿直接返回自然语言正文，不使用 JSON 包装或工具调用。服务端只接受唯一完整响应、正常结束标识和非空、有界正文；截断、空输出、多个候选或工具混入均明确失败。正文最多 6,000 字符。服务端内部仍以 `{ body }` 交接已验证文本；这是内部 DTO，不是模型输出格式。

独立审核只返回封闭结构 `{ status: "pass" | "revise" | "uncertain", issues: [{ reason: string }] }`。`pass` 必须没有问题；`revise` 必须给出可修正的具体实质问题；`uncertain` 表示实质判断不足。服务端从保存的精确请求绑定候选正文、冻结材料、受众、策略及调用身份，不要求模型复述 hash、引用定位、五维检查表或机械覆盖矩阵。旧策略已经发出的请求、响应与身份保持不变，恢复仍使用原协议。

下一步提示可以写在正文末句；TTS 只能从同一正文派生，不能另写语义不同的文本。
Narration 输入只包含该受众冻结的：当前 Receipt、`actorAction`、`renderableClaims`、pressure、opportunities 和有限 recentDialogue。Audience、Receipt 绑定、projectionHash、derivedEvidenceRefs、derivedAgencyClaims、Narration Policy 与 ModelInvocationReceipt 全由服务端派生。

Grounding 必须证明 body 的每项事实性/能动性主张均由冻结投影允许，不扩大 Audience、不泄露秘密、不代玩家选择、不改写已提交机械。按 [SPEC 0016 §8.3](./0016-part-c-compound-actions-and-claims.md#83-narrationgrounding-与重试) 区分纯表达意见、实质拒绝与一次有界修稿；实质拒绝返回 `NARRATION_GROUNDING_REJECTED`，无法判定或输出损坏保留各自分类；不得生成固定剧情、伪成功或“没有更多变化”式 fallback。

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

Narration 只在存在该受众发布任务时进入 `pending`；合法正文发布为 `published`，按适用 Narration Policy 完成允许的修稿后仍不合格、实质审核无法判定或 body 损坏为 `rejected`，Provider/投递暂时失败为 `retryableFailure`。没有叙述任务时为 `notApplicable`。

合法组合必须满足：`awaitingInput` 配 `notApplicable`；`notCommitted` 在未产生旁白任务时配 `notApplicable`，候选回复准备中配 `pending|retryableFailure`，终局取消配 `rejected`；`committed|resolvedInWorld|concluded` 可按该 ViewerKey 是否需要叙述配 `notApplicable|pending|published|rejected|retryableFailure`。action 一旦进入 `committed|resolvedInWorld|concluded` 就不能因 Narration 状态回退为 `notCommitted` 或 `awaitingInput`；同一 RootAction 后续机械只通过既有 Pending/continuation 推进，不由 Narration 驱动。

### 8.2 失败与重试语义

- Proposal 未提交：前端保留玩家草稿，可用相同 submission ID 幂等重试；不得显示世界成功。
- 新结果先准备回复：同次未交付结算中的资源、物品、知识和虚构时间变化均暂存；审核通过后与回复原子提交。尚可恢复时复用保存的精确阶段；终局失败或 180 秒窗口结束仍无完整合格回复时取消未提交候选，明确告知玩家“本次没有生效，可以重新描述行动”，释放占用，不要求玩家靠换说法修复旧请求。
- 所有合格回复已保存而发布者中断时，可由持久化恢复直接提交，不追加模型调用。部署换版本后尚未发布的回复按 [SPEC 0016 §9.2](./0016-part-d-staging-and-supersede.md) 重写。提交后仅网络送达失败时保留结果和正文，重复请求返回同一结果。取消必须围栏旧发布者；晚到物理响应仍记账，但不能使已取消的行动生效。
- 行动在旧流程已经提交但 Narration 失败：保留玩家行动气泡、Receipt 和世界结果；不回填输入框、不撤销事件、不重跑 Proposal、不重掷、不重复资源/虚构时间。
- “重试 KP 回复”只允许使用原 Receipt、原 ViewerKey、冻结投影和原 delivery generation；不能扩大 Audience 或重读当前变化后的全局状态。
- 只有权威账本证明原流程仍能推进才显示恢复按钮；已保存的表达意见按当前发布规则处理，允许的修稿与复审复用已完成物理响应。终局拒绝或结果未知不以重复点击重新采样。
- 固定伪成功 fallback 全部删除，包括“刚才的尝试已经结算。眼下没有更多可以确认的新变化。”及任何同义文本。

### 8.3 逐受众隔离、原子发布与亲历记录

发布状态以 `(rootActionId, ViewerKey, projectionHash, deliveryGeneration)` 为幂等键。新未提交结果的 Alice/Bob 回复分别生成和审核，在全部就绪后与世界一起原子保存，不允许先发布一部分再撤销行动。每个 Viewer 只能读取自己的材料和正文。旧已提交结果保持逐受众独立恢复，Bob 的故障不撤销 Alice 的已发布回复。Audience 只能由服务端对候选结果调用 `project` 冻结，提交时复核原权限，LLM、页面、房主、队长和投递器无权扩大。

只有提交时在场且具观察资格的 ViewerKey 获得自己的回应和亲历记录。不在场者不能后来补取。ACK、刷新、离场和回场不删除原 ViewerKey 已成功发布的亲历文本；换席、新控制者和其他角色不继承旧记录；不得建立全桌共享旁白历史。其余保留/安全失效语义继续服从 `SPEC 0010`。

## 9. Model Profile Registry 与角色权限

统一 `ModelProfileRegistry` 为每个具体 Profile 固定 provider、model ID/revision、supportedRoles、验证套件版本、structured-output 模式、上下文上限、延迟等级、成本等级和 Profile hash。角色至少区分：

- `kp-proposal`：主 KP 的开放裁决与 Form Proposal；
- `kp-narration`：主 KP 的逐受众 body；
- `context-planner`：Form 排序、实体/代词候选与查询建议；
- `chunk-rerank`：仅重排已授权引用；
- `deterministic-disabled`：关闭辅助模型的确定性 Adapter。

辅助模型只允许 Form 排序建议、实体/代词候选、规则/模组查询生成、chunk rerank、缺失引用和纯结构错误提示。它不得决定可行性、DC、危险、失败后果、NPC 台词、世界事实、敌人、实际区域目标、Audience、可见性、骰面、事件或状态 patch。

UI 中主 KP 选择保持主要视觉层级并按房间固定。只有 G3 先达到 §10 的量化增益门时，Context Planner 才进入次要/高级设置，并至少提供“关闭/确定性检索”和一个真实通过角色验证的 Planner；G3 未达门时按 §10 删除 Planner 产品接线，不以空的、待验证的或无增益的选项冒充完成。DeepSeek V4 Flash 可以是辅助候选，但必须拥有独立 Planner Profile/Receipt，并通过中文、structured output、schema/allowlist、秘密 canary、延迟、错误和故障注入验证后才可出现。

辅助 Profile 只能在新 RootAction 边界更换；当前 RootAction 固定原 Profile。Planner 失败回退确定性查询且不改变主 KP；禁止隐藏自动切换 provider/model。未通过验证的 Adapter 可以留在测试/实验层，但不得出现在生产 UI。

本轮 120 条同集结构评测已经裁定产品停在 G2：G3 的离线确定性 Planner 控制与 G4 的评测器本地精确向量对照均未产生预注册增益，G5 因 G2 召回与排序都充分而不适用。因此当前新房绑定明确固定 `context-planner-disabled-v1`，Hall/Table 不提供 Planner 产品设置；待验证候选、离线 Adapter 和角色验证 runner 只保留在实验/测试层，不构成可选产品能力。
