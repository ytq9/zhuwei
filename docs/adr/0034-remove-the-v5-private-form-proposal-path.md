# ADR 0034：删除 V5 私有 Form 提案路径及其离线评测

- 状态：已接受
- 日期：2026-09-20
- 依据：用户于 2026-09-20 裁定「V3 已经被淘汰，跟现役无关的内容应全部归档」。
- 当前规则：[SPEC 0016 当前边界](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)
- 取代范围：[ADR 0028](./0028-abandon-persisted-v5-private-form-rooms.md)「是否删除 V5 提案路径另行决定」这一未决项；SPEC 0015 中把私有 Form 管线描述为现役路径的条款自此只解释历史。沿用 [ADR 0016](./0016-development-reset-of-pre-0.4-rooms.md) 与 ADR 0028 的做法，不为被删路径保留 Adapter、fallback、migration 或测试。

## 背景

ADR 0028 已在 2026-09-18 放弃已持久化的 V5 私有 Form 房间，删除了只能在 V5 房间里成立的 Room 套件，并明确把提案路径本身的去留留作后续决定。

2026-09-20 核实的现役接线：

- `app/_runtime/lib/room/server.ts` 只在房间 profile 等于 vNext 时走 `createVNextKpAdapter`，它自己实现 `propose`，只把 `narrate`、`decideDueActorPlan`、`decidePendingInput` 委托给旧适配器。
- `app/_runtime/lib/table/server.ts` 的 `createRoom` 用 `profileByModelId` 选 profile，而 `app/_runtime/lib/room/runtime-configuration.ts` 的该方法只返回 vNext profile。当前代码创建的每个房间都绑 vNext；V5 分支只有更早代码写下的房间行才解析得到，而那些房间已按 ADR 0028 不再是产品支持面。
- vNext 的降级在 `app/_runtime/lib/kp/vnext/room-bridge.ts` 产出 `applyAtomicWorldInteractionSteps`、`performAbilityOperation`、`materializeNpc` 等 Rules 输入；`executeCausalActionProgram` 这一输入类型只由 V5 的 `compileKpFormDraft` 产生，`app/_runtime/lib/rules/v2/actions.ts` 仍为它保留一条分派。
- `KP_STRUCTURED_OUTPUT_MODES` 为空，因此 V5 的 strict-tool 编码没有任何 profile 启用。

## 决定

1. 删除 V5 私有 Form 提案路径：Form 目录与其草稿 schema、私有 Form 请求策略、strict 双生编码、V5 Context/RAG 准备与 planner、`server.ts` 的 V5 分支，以及 `authoritative.ts` 的提案半边。叙述、到期 ActorPlan 决定与待决输入决定继续由现役 vNext 适配器消费，保留。
2. 删除 `executeCausalActionProgram` 这一 Rules 输入类型及其分派、编译器与专用模型；`rules/v2/causal-model.ts` 中被现役 Rules 共用的导出按导出逐项判断去留，不整体删除。
3. 删除只量 V5 提案请求的离线评测 `tools/run-kp-v3-eval.mjs`、它的门测试与 120 条 gold 夹具，并从 SPEC 0015 的 `gates` 去掉。`tools/run-live-kp-eval.mjs` 打的是真实生产 origin，与提案编码无关，保留。
4. 各 SPEC 的 `gates` 去掉被删文件，不为变绿补登任何未运行或未通过的门。

## 后果

- 现役 vNext runtime manifest 不带 `causal-action-interpreter-2014-v5` 与 `environment-feature-fsm-2014-v3` 两个扩展，所以 `executeCausalActionProgram` 与 `invokeEnvironmentalStunt` 在生产上本就不可达；删除它们不改变现役房间能做什么。
- KP 自定义动态环境（`environmental-stunt.v1` → `resolveDynamicEnvironmentStunt` → `invokeEnvironmentalStunt`）的唯一生产者是被删的 Form，该能力随本决定退役。这与 SPEC 0016 `supersedes` 里已写明的 `environmental-stunt` 取代范围一致；vNext 以 `worldInteraction` 表达环境交互。
- 随之删除的验收套件与各 SPEC 的门：`tests/platform/authority/causal-action-rules.test.mjs`（SPEC 0003、0004、0005 的门）与 `tests/kp/world/chandelier-environment-rules.test.mjs`（SPEC 0012 的门）。前者测因果程序本身，后者测环境特征状态机，两者的被测扩展都不在现役 manifest 里。`tests/kp/items/item-materialization-causal.test.mjs` 的三个用例已由 vNext 物品套件承接，第四个（满血守卫只挡消耗品治疗）迁入 `tests/kp/items/use.test.mjs`；`tests/kp/campaign/world-campaign.test.mjs` 的势力计划段迁入 `tests/kp/npc/npc-plan-formation-rules.test.mjs`；`tests/kp/npc/npc-mechanical-definition.test.mjs` 的四处改用 `startEncounter`、`transferItem`、`changeNpcGear` 直接输入，只失去 V5 的阶段断言（活动完成先于效果）与 Form 字段长度上限。
- 角色前提（`establishCharacterPremise` → `zhuwei.character-premise/v2`）与环境特技一样只有 V5 生产者，随本决定退役；`tests/kp/npc/social-resolution.test.mjs` 三个用例全部经 `privateFormProposal` 驱动，一并删除。社交结算本身由 vNext 的 `social-plan`、`social-shape`、`social-commitments`、`social-source-selection` 四个套件的 27 个用例覆盖，NPC 物化由 `npc-materialization.test.mjs` 覆盖。
- V3 的 Context Planner 随之退役：`kp/context-planner-policy.ts`、model-registry 里的 planner 适配器与角色验证证据只有被删的 V5 分支消费。现役房间绑定固定写 `context-planner-disabled-v1`，该常量保留。`model-registry` 的 strict-tool 证据部分保留：它守的是 strict 输出准入，而现役提案绑定就是 strict。
- `kpProposalFailureTelemetry` 原先用 V5 的 `KP_FORM_IDS` 过滤 formId，V5 删除后该白名单不再匹配任何东西，会把每个 form id 静默丢掉。改用现役的 `VNEXT_BUNDLE_FORM_IDS`；诊断字段脱敏的白名单同样不再收集 V5 表单字段名，相关用例改用 vNext 的字段路径。
- V5 的社交结算子系统随之退役：`stepSocialCausalAction` 是唯一创建 `socialResolution` 待决的地方，删除后 `answerSocialResolution` 与 `fulfillSocialResolutionRandomness` 只能延续一个不再产生的待决。玩家的「press / acceptStatusQuo」选择面一并消失；vNext 以冻结玩家选择（`openFrozenPlayerChoice`）表达行动前的选择，社交结算走 `resolveWorldInteraction`。
- 五个 V5 事件类型随之退役:`SocialResolutionOffered`、`SocialDirectResolved`、`DynamicEntityMaterialized`、`HiddenRealityCandidatesFrozen`、`HiddenRealityMaterialized`。全仓库只有折叠、投影与更正处理器提到它们,没有任何生产者。它们的 payload 类型、事件折叠、Viewer 投影与更正分支一并删除,`characterPremise` / `dynamicEntityKnowledgeGrant` / `typedAssertionFact` 这一族事实的 profile 校验也随之消失。**代价**:归档里带这些事件的流从此不能 replay;已持久化的 V5 房间按 ADR 0028 本就不承诺回放。
- `causal-action-program`、`form-catalog`、`compound-composition`、`rules/v2/causal-model` 四个模块删除。`CAUSAL_ACTION_LANGUAGE_PROFILE` 的标识被两处消费:`authoritative-policy` 的 V5 profile 判定与 `causal-action-interpreter` 的 runtime profile 文档;两处都改成字面量,因为 V5 runtime manifest 注册着这个 profile 且已持久化,值不能动。通用的 `stableStructuralHash` 移入其唯一消费者 `model-registry`,编码不变——注册的 profile hash 带着它。
- SPEC 0015 §§2–6 描述的「私有小表 Proposal → 三层 Context Pack → 静态 RAG → 封闭因果程序」管线不再有实现，连同 §10 的 G0–G5 采用门、§13 的量化硬门与 §9 的 `context-planner` 角色自此只解释历史。**退役范围到此为止**：SPEC 0016 §12 明示不整篇替代 SPEC 0015，§7–§9 的 body-only Narration、行动/Narration 双状态、逐受众发布与主 KP 角色边界，以及 §12 的公开错误码与日志白名单仍是现役规则，继续由 SPEC 0015 承载——本规格剩下的六道门守的正是这些条款，现役 `narrate` 路径实现它们。
- 失去的验收证据：`tools/run-kp-v3-eval.mjs` 的 16 项结构硬门（120 条 gold 的引用召回、表单合法性、路由覆盖、故障回退与四项体积门）。这些门量的是 V5 请求的构成，在 vNext 上没有对应对象；vNext 的请求体积没有等价的离线门，属于已知缺口。
- 基线里以「KP V3 runner invokes production seams and passes local evaluation hard gates」登记的那条单测失败随文件一并消失，不是修好，是被删路径的门不再存在。
- 追踪矩阵 KR11、KR14 两行的证据来源被删，改为记录该门已随本决定退役。
- 已持久化的 V5 房间行此后在绑定校验处被拒，与 0.4 对待 0.4 以前房间的处理一致；D1 数据保留，产品不承诺回放或继续游玩。
- [ADR 0019](./0019-on-demand-proposal-schema-contract.md) 的按需 schema 合同只约束 vNext 的 Bundle 选择面，不因本决定改变。
