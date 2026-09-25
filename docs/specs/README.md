---
kind: annex
role: index
title: "规格索引与交叉审查"
---
# 烛帷规格索引

- 索引状态：**持续维护**
- 适用分支：`cloudflare`
- 当前开发版本：`0.4.0`（产品代际仍为 V3）
- 规则边界：D&D 5e 2014 / SRD 5.1；禁止 D&D 2024/5.5e 混入
- 上次交叉审查：2026-09-02

产品权威起点是冻结的 `SPEC 0001`；其余 SPEC 是它的补充合同，不得覆盖它。

每份规格的状态、裁定日期、上位规格、取代关系与验收门写在该文件自己的 frontmatter 里，本索引不再重述——重述会和原件分岔，而分岔时读者信的是先读到的那一份。当前追踪状况由 frontmatter 和代码中的 `SPEC NNNN` 引用生成：

```bash
npm run spec:trace
```

## 导航

- [冻结产品准则：SPEC 0001](./0001-llm-kp-responsibility-contract.md)
- [原 SPEC 0002 的 B01–B53 逐项处置](./0002-disposition-matrix.md)
- [本 Goal 自主裁定登记册](./decision-register.md)
- [十三板块、专项向量与 SPEC 0001 A–O 追踪矩阵](./traceability-matrix.md)
- [执行、命令与证据日志](../refactor-log.md)

## 决定记录

每一项产品裁定有一份 ADR，记录何时、为什么、取代了什么。**规则本身写在它指向的 SPEC 条款里**，ADR 与本索引都不重述规则文本。

| 日期 | 决定 | 规则所在 |
| --- | --- | --- |
| 2026-09-25 | [ADR 0049：NPC 决策视图有自己的大小上限](../adr/0049-an-npc-decision-view-has-its-own-ceiling.md) | [SPEC 0016 §4.3](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-25 | [ADR 0048：每个角色带最近六轮全文，每句话只发一次](../adr/0048-each-character-carries-its-latest-six-rounds.md) | [SPEC 0016 §4.2](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-25 | [ADR 0047：归档按记录接受早先版本的工作](../adr/0047-archives-take-earlier-version-work-as-recorded.md) | [SPEC 0011 §3](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-25 | [ADR 0046：房间固定所用模型，工作流版本随部署更新](../adr/0046-a-room-keeps-its-model-while-the-workflow-version-follows-the-deploy.md) | [SPEC 0011 §3](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-24 | [ADR 0045：提案只带中文写作要求，不带审核标准](../adr/0045-the-proposal-gets-writing-guidance-without-review-criteria.md) | [SPEC 0016 §8.3](./0016-part-c-compound-actions-and-claims.md) |
| 2026-09-24 | [ADR 0044：选择阶段加载的条目排在上下文最后](../adr/0044-what-the-selection-loads-goes-last-in-the-context.md) | [SPEC 0016 §7.2](./0016-part-c-compound-actions-and-claims.md) |
| 2026-09-24 | [ADR 0043：冻结上下文放进系统消息，排在工具之前](../adr/0043-the-frozen-context-goes-in-the-system-message.md) | [SPEC 0016 §7.2](./0016-part-c-compound-actions-and-claims.md) |
| 2026-09-24 | [ADR 0042：检定裁决写明它决定哪一步](../adr/0042-a-check-names-the-step-it-decides.md) | [SPEC 0016 §7.3](./0016-part-c-compound-actions-and-claims.md) |
| 2026-09-24 | [ADR 0041：检定决定的那一步单独成组，成功和失败同样必填](../adr/0041-the-check-step-gets-its-own-group.md) | [SPEC 0016 §7.3](./0016-part-c-compound-actions-and-claims.md) |
| 2026-09-23 | [ADR 0040：为 GPT‑6 Luna 注册独立调用与房间绑定](../adr/0040-gpt-6-luna-provider-and-room-binding.md) | [SPEC 0011 §§3–4](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-20 | [ADR 0034：删除 V5 私有 Form 提案路径及其离线评测](../adr/0034-remove-the-v5-private-form-proposal-path.md) | [SPEC 0016 当前边界](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-20 | [ADR 0035：vNext 提案请求体积进棘轮，只降不升](../adr/0035-ratchet-the-vnext-proposal-request-size.md) | [SPEC 0016 §7.2](./0016-part-c-compound-actions-and-claims.md) |
| 2026-09-20 | [ADR 0036：把 Rules 形状词汇发布为第二个受认可 Interface](../adr/0036-publish-the-rules-shape-vocabulary.md) | [SPEC 0003 §2.1](./0003-authoritative-action-transaction.md) |
| 2026-09-23 | [ADR 0037：检定分支不越过自己的摘要，NPC 台词用直接引语](../adr/0037-branch-bound-outcomes-and-quoted-npc-lines.md) | [SPEC 0009 §2](./0009-failure-pacing-conclusion-and-interaction.md) |
| 2026-09-23 | [ADR 0039：撤回 NPC 台词的句式要求](../adr/0039-withdraw-the-npc-line-wording-rule.md) | [SPEC 0009 §6](./0009-failure-pacing-conclusion-and-interaction.md) |
| 2026-09-23 | [ADR 0038：部署换版本后，未完成的模型工作重问一轮](../adr/0038-reask-unfinished-work-after-a-version-change.md) | [SPEC 0016 §9.2](./0016-part-d-staging-and-supersede.md) |
| 2026-09-19 | [ADR 0033：链内内部决定失败时保留已完成的进度](../adr/0033-internal-decision-failure-keeps-chain-progress.md) | [SPEC 0003 §1](./0003-authoritative-action-transaction.md) |
| 2026-09-19 | [ADR 0032：内容安全暂停移出产品](../adr/0032-remove-content-safety-pause.md) | [SPEC 0007 §9](./0007-multiplayer-room-and-fiction-time.md)、[SPEC 0009 §12](./0009-failure-pacing-conclusion-and-interaction.md)、[SPEC 0010 §1.1](./0010-observer-specific-presentation.md) |
| 2026-09-19 | [ADR 0031：公开模型目录只保留 DeepSeek V4 Flash](../adr/0031-public-model-catalog-flash-only.md) | [SPEC 0011 §3](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-18 | [ADR 0030：Activity 的推进阶段不是已到达的 due](../adr/0030-activity-stages-are-not-due-instants.md) | [SPEC 0013 §7.2](./0013-part-c-time-and-conformance.md) |
| 2026-09-18 | [ADR 0029：`72201ea` 检查点后战斗门的修复与裁定](../adr/0029-combat-checkpoint-drift-repairs-and-rulings.md) | [SPEC 0012 §4.2](./0012-authoritative-combat-mechanics.md)、[SPEC 0012 §10.2](./0012-part-b-abilities-damage-and-conclusion.md) |
| 2026-09-18 | [ADR 0028：放弃已持久化的 V5 私有 Form 房间及其验收套件](../adr/0028-abandon-persisted-v5-private-form-rooms.md) | [SPEC 0016 当前边界](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-18 | [ADR 0027：更正审计只记录改变的记录、只保留执行中的根，房间状态分块持久化](../adr/0027-entry-level-correction-audit-and-chunked-room-state.md) | [SPEC 0011 §7](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-15 | [ADR 0024：旁白发布分级与一次有界修稿](../adr/0024-narration-publication-and-bounded-repair.md) | [SPEC 0016 §8.3](./0016-part-c-compound-actions-and-claims.md)、[SPEC 0015 §7–8](./0015-part-b-proposal-and-narration.md)、[SPEC 0011 §2–3](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-17 | [ADR 0026：先准备自然语言回复，再提交行动结果](../adr/0026-provisional-results-and-natural-narration.md) | SPEC 0003 §1、7、11；SPEC 0010 §8.2；SPEC 0011 §2；SPEC 0015 §7–8；SPEC 0016 §8.3 |
| 2026-09-16 | [ADR 0025：未冻结提案的显式未知调用恢复](../adr/0025-explicit-proposal-invocation-recovery.md) | [SPEC 0016 §7.2](./0016-part-c-compound-actions-and-claims.md)、[SPEC 0011 §2–3](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-09-15 | [ADR 0023：放宽旁白等待窗口，保留冻结恢复身份](../adr/0023-narration-timeout-window.md) | [SPEC 0011 §2](./0011-reliability-correction-observability-and-evaluation.md) |
| 2026-08-31 | [ADR 0016：0.4 开发重置，放弃更早房间与归档](../adr/0016-development-reset-of-pre-0.4-rooms.md) | [SPEC 0013 §0.4](./0013-versioned-runtime-profiles.md) |
| 2026-09-05 | [ADR 0017：环境描写先成为叙述承诺，按需固化](../adr/0017-environment-narration-and-on-demand-materialization.md) | [SPEC 0001 §§3.3、7、12](./0001-llm-kp-responsibility-contract.md)、[SPEC 0016 §8](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-05 | [ADR 0018：Narration 自然表达与人物一致性](../adr/0018-narration-expression-and-character-consistency.md) | [SPEC 0016 §8.3](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-06 | [ADR 0019：按需 Proposal schema，首轮可只请求能力标识](../adr/0019-on-demand-proposal-schema-contract.md) | [SPEC 0015 §6.1](./0015-private-form-context-rag-and-narration.md)、[SPEC 0016 §7.2](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-07 | [ADR 0020：填写边界前移，允许一次并集补选](../adr/0020-flat-selection-and-one-supplementary-pick.md) | [SPEC 0015 §6.1](./0015-private-form-context-rag-and-narration.md)、[SPEC 0016 §§7.2、10、12](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-09 | [ADR 0021：一次窄修订可补齐字段或重判未生效裁决](../adr/0021-one-narrow-proposal-revision-may-rejudge.md) | [SPEC 0016 §7.2](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |
| 2026-09-09 | [ADR 0022：完整故事准备使用独立调用预算](../adr/0022-story-preparation-independent-call-budget.md) | [SPEC 0015 §§6.1、17](./0015-private-form-context-rag-and-narration.md)、[SPEC 0016 §§7.2、12](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) |

更早的技术决策见 [`docs/adr/` 0001–0015](../adr/)。

## 规格清单

| SPEC | 状态 | 单一职责 | 依赖与协作边界 |
| --- | --- | --- | --- |
| [0001：LLM/KP 职责与叙事权威](./0001-llm-kp-responsibility-contract.md) | **已批准，产品行为冻结** | 固定玩家意图、KP 叙事、Rules 机械与权威状态的权力分配；定义开放世界、公正、知识、NPC、失败、聚光灯、连续性、更正、收束及 A–O 验收 | 事实优先级仅次于用户在本 Goal 的明确决定；不依赖后续规格，后续规格全部服从它 |
| [0002：权威战斗框架](./0002-authoritative-combat-framework.md) | **已被替代，未曾批准** | 只作为原始草案与迁移证据保留，不是新规则实现依据 | 上位仅为 0001；通用责任与纯战斗机械已拆往 0003–0013；逐条结果见 [处置矩阵](./0002-disposition-matrix.md) |
| [0003：权威行动事务与深 Module Interface](./0003-authoritative-action-transaction.md) | **已裁定（本 Goal 授权）** | 定义 Room Action Module、Rules Module `step/project/replay`、Room Authority、根行动、待决、权威随机、幂等、作用域版本、恢复、回放、更正与统一 Outcome | 上位：0001；是 0004–0016 共用的事务、提交、投影与回放底座；公开双状态和 1+1 修订由 0015 窄取代，未来上下文/主张 seam 由 0016 深化 |
| [0004：KP 裁决与非战斗机械](./0004-kp-and-noncombat-mechanics.md) | **已裁定（本 Goal 授权）** | 五类可行性、检定/对抗/豁免、物品、资源、休整、Activity、非战斗危险、骰前冻结与裁定先例 | 上位：0001、0003；事实/知识交给 0005，战斗机械交给 0012，版本化定义交给 0013 |
| [0005：世界事实、因果与角色知识](./0005-world-facts-and-knowledge.md) | **已裁定（本 Goal 授权）** | `CanonicalFact`、`WorldEvent`、来源/因果/可见性、隐藏现实、证据/主张/推断、知识传播、关系/承诺/债务、分支与更正 | 上位：0001、0003、0004；观察者交付由 0010，可靠更正/归档由 0011 |
| [0006：模组、动态实体、NPC 与势力协议](./0006-module-npc-and-faction-protocol.md) | **已裁定；旧房保留段由 0013 的 0.4 修订窄取代** | 故事圣经、核心真相、开放留白、动态定义、NPC 有限知识、NPC/势力计划与当前模组版本 | 上位：0001、0003、0005；控制权/时间依赖 0007，NPC 战斗提案进入 0012 而不另建战术权威 |
| [0007：多人房间、控制权、虚构时间与聚光灯](./0007-multiplayer-room-and-fiction-time.md) | **已裁定（本 Goal 授权）** | 可信 Principal、席位、角色控制、换席/请离/掉线、并发意图、原子分队、跨地点虚构时间、因果前沿与聚光灯账本 | 上位：0001、0003、0005；私人投影/投递由 0010，长团任期由 0008 |
| [0008：长团成长、章节连续性与继任角色](./0008-long-campaign-lifecycle.md) | **已裁定（本 Goal 授权）** | Campaign/Chapter、成长、跨章物品/伤势/知识/关系/债务/承诺/威胁、死亡/退役、继任与合法继承 | 上位：0001、0003、0005、0007；故事收束由 0009，私人知识/旧叙述边界由 0010 |
| [0009：失败、节奏、收束与交互协议](./0009-failure-pacing-conclusion-and-interaction.md) | **已裁定（本 Goal 授权）** | 场景问题、有意义失败、重复检定门、玩家停滞、势力推进、叙述/Receipt 交互、结局候选、尾声/续篇与现实玩家安全 | 上位：0001、0003、0004、0006、0007、0008；当前回应和秘密呈现服从 0010 |
| [0010：观察者专属呈现与当前回应投递](./0010-observer-specific-presentation.md) | **已裁定（本 Goal 授权）** | 观察资格、个人线索、世界内分享、Audience 冻结、统一 projector、每 Viewer 单槽 DeliveryFrame、ACK、不可回看及语音/转写/错误/日志旁路 | 声明上位为 0001；协议上复用 0003、0005、0007–0009 的事务、知识、控制权、连续性与收束状态 |
| [0011：可靠性、更正、可观测性与多轮评测](./0011-reliability-correction-observability-and-evaluation.md) | **已裁定（本 Goal 授权）** | 故障分类、SLO、免费额度预算、模型调用 Receipt、脱敏日志、归档重建、可审计更正、恢复矩阵及 20+ 轮 KP 评测阈值 | 上位：0001、0003、0010；引用 0005 的因果分支与 0013 的版本/Profile 清单 |
| [0012：权威战斗机械](./0012-authoritative-combat-mechanics.md) | **已裁定（本 Goal 授权）** | 仅定义 Encounter、空间、先攻/突袭、轮/回合/行动授予、移动/反应、能力/施法、效果/伤害/专注、0 HP/死亡及非歼灭结束；战斗只是 Rules Module 内部实现 | 上位：0001、0003、0006–0011；Profile/确定排序/几何与能力定义引用 0013；不得出现 CombatCoordinator 或战斗专属状态/骰源/projector |
| [0013：版本化运行时 Profiles 与确定性 Conformance](./0013-versioned-runtime-profiles.md) | **已裁定；0.4 开发重置修订已确认** | 固定当前 Ruleset/EventSchema、AbilityDefinition 与受限 MechanicOp 编译器、BattlefieldGeometry、TriggerOrdering、Fiction/Combat Time 等 Profile 及 hash/conformance/fail-closed 规则 | 上位：0001、0003–0007、0010–0012；0.4 只注册当前 V5 runtime 闭包，前 0.4 房间/归档退役且无兼容承诺 |
| [0014：观察者战术地图、权威环境与空间意图](./0014-observer-tactical-map-and-environment.md) | **已裁定（用户 Goal 明确批准）** | 把真实 scene geometry、环境有限状态、移动/区域地图意图、秘密安全 Tactical Projection/preview、二维地图和同源文字读数接入唯一事务 | 上位：0001、0003、0005、0007、0010、0012、0013；不重写 Geometry 算法，不建立 UI/GM 第二空间 |
| [0015：私有 Form Proposal、Context Pack/RAG、提交后叙述与动态环境](./0015-private-form-context-rag-and-narration.md) | **已裁定；2026-09-20 起 §§2–6、§10、§13 与 §9 的 Planner 角色只解释历史（ADR 0034）；§7–§9 与 §12 仍是现役规则，按 0016 §12 继续由本规格承载** | 定义 V5 十 Form、三层 Context、静态 D1 FTS/权威重读、一次窄修订、CausalActionProgram、body-only Narration、双状态与逐受众恢复；旧 Catalog、compound 和详细动态环境模型只解释 V5 | `SPEC 0001` 最高；复用 0003 Room/Rules/DO、0010 Viewer/Audience、0013 Profile、0014 Geometry；未来粗粒度 Form、RequiredContext 和 Typed Claims 服从 0016，当前 V5 不因此自动切换 |
| [0016：粗粒度 Form、冻结裁决上下文与类型化主张](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) | **已裁定；阶段三代表性纵切已完成，未切生产** | 以权威/事务边界定义粗粒度 Form；冻结 `epistemicRefs/readSetRefs`；以类型化空间角色区分 Viewer 可操作直接目标与 KP-only 因果；由 KP 判断可行性、Rules 执行有限原语；以 Typed Claims 证明提交结果，非机械环境描写先保存叙述承诺并按需固化 | `SPEC 0001` 最高；复用 0003/0010 的 Room/Viewer、0013 的版本/Profile、0014 的 Geometry 和 0015 未被取代的 RAG、一次窄修订、body-only 与双状态；§7.2 已批准先选择及一次并集补选，补选后只准提交，阶段与调用预算以该节为准；阶段三完成动态 NPC 修订与通用 `world-interaction`，并拒绝跨场景及越过 NPC/Item/continuity Form 的写入；其余 Form 纵切仍待，V5 提案路径已按 ADR 0034 删除，当前不部署 |

## 证据与审查

实现映射与验收状态由工具生成，不在本索引手工维护：

```bash
npm run spec:trace
```

2026-08-31 的证据边界判断（本地绿 / 真实模型 / 未验收）保留在 [实现证据与交叉审查快照](./evidence-and-review-snapshot.md)，该文件不随代码更新。
