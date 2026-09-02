# 烛帷规格索引与交叉审查

- 索引状态：**持续维护**
- 审查日期：2026-09-02
- 适用分支：`cloudflare`
- 当前开发版本：`0.4.0`（产品代际仍为 V3）
- 规则边界：D&D 5e 2014 / SRD 5.1；禁止 D&D 2024/5.5e 混入

本目录的产品权威起点是冻结的 `SPEC 0001`。`SPEC 0003–0013` 是既有 Goal 明确授权的产品与技术裁定，`SPEC 0014` 是用户批准的二维战术地图合同，`SPEC 0015` 是 2026-08-29 用户明确授权的私有 Form、Context Pack/RAG、body-only Narration、双状态与动态环境合同。`SPEC 0016` 于 2026-09-01 进一步把未来目标收口为“按事务边界的粗粒度 Form + 冻结 epistemic/read set + 稀疏语义定义 + KP 判断 + Rules 有限原语 + Typed Claims”，并窄取代 `SPEC 0015` 的旧 Form Catalog、model-visible compound/DAG 与详细材料阈值；它不修改 `SPEC 0001`，也不自动切换当前 V5 生产。SPEC 0015 已有的实现与发布事实继续按历史边界保留，但“已裁定/已部署”仍不表示被豁免的完整门或完整线上模型指标已经通过。

2026-08-31，用户明确确认开发期 0.4 重置：放弃全部 0.4 以前的房间及可恢复房间归档，当前代码不保留其 Adapter、fallback 或 migration。该决定只取代各 SPEC/ADR 中要求保留、迁移或恢复前 0.4 房间的条款；机械、权限、秘密、单一权威与 fail-closed 合同不变。精确取代清单和当前 Profile 闭包见 [SPEC 0013 的 0.4 修订](./0013-versioned-runtime-profiles.md#04-开发重置的取代范围)。下文中关于历史 Adapter/旧房回放的旧证据只保留审计意义，不再是当前 0.4 验收目标。

## 导航

- [冻结产品准则：SPEC 0001](./0001-llm-kp-responsibility-contract.md)
- [原 SPEC 0002 的 B01–B53 逐项处置](./0002-disposition-matrix.md)
- [本 Goal 自主裁定登记册](./decision-register.md)
- [十三板块、专项向量与 SPEC 0001 A–O 追踪矩阵](./traceability-matrix.md)
- [ADR-0014：私有提案、派生检索与发布边界](../adr/0014-private-proposal-derived-retrieval-and-publication-boundary.md)
- [ADR-0015：粗粒度 Form、冻结上下文与类型化主张](../adr/0015-coarse-forms-frozen-context-and-typed-claims.md)
- [执行、命令与证据日志](../refactor-log.md)

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
| [0015：私有 Form Proposal、Context Pack/RAG、提交后叙述与动态环境](./0015-private-form-context-rag-and-narration.md) | **已裁定；V5 历史/当前实现边界保留，未来目标部分由 0016 窄取代** | 定义 V5 十 Form、三层 Context、静态 D1 FTS/权威重读、一次窄修订、CausalActionProgram、body-only Narration、双状态与逐受众恢复；旧 Catalog、compound 和详细动态环境模型只解释 V5 | `SPEC 0001` 最高；复用 0003 Room/Rules/DO、0010 Viewer/Audience、0013 Profile、0014 Geometry；未来粗粒度 Form、RequiredContext 和 Typed Claims 服从 0016，当前 V5 不因此自动切换 |
| [0016：粗粒度 Form、冻结裁决上下文与类型化主张](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) | **已裁定；阶段三代表性纵切已完成，未切生产** | 以权威/事务边界定义粗粒度 Form；冻结 `epistemicRefs/readSetRefs`；以类型化空间角色区分 Viewer 可操作直接目标与 KP-only 因果；由 KP 判断可行性、Rules 执行有限原语；以 Typed Claims 作为提交后唯一叙述材料 | `SPEC 0001` 最高；复用 0003/0010 的 Room/Viewer、0013 的版本/Profile、0014 的 Geometry 和 0015 未被取代的 RAG/1+1/body-only/双状态；阶段三完成动态 NPC 修订与通用 `world-interaction`，并拒绝跨场景及越过 NPC/Item/continuity Form 的写入；其余 Form 纵切仍待，当前不删 V5、不部署 |

## 当前实现证据索引（2026-08-31）

本节把**当前存在的公开测试映射**、定向绿色与已发生的发布事实分开陈述。测试文件、已部署版本或局部命令不等于最终源码已经通过完整门；本轮完整门依用户明确豁免未运行，也不得由其他证据拼接成通过。

| 产品语义 | 生产实现映射 | 当前有效证据 | 证据边界 |
| --- | --- | --- | --- |
| 0.4 当前行动接缝、非战斗、长团与投影 | 普通 KP 提案经 `executeCausalActionProgram` + 精确 `actionLanguageRef`；多人管理经服务端生成的 `authenticatedPartyAction`；NPC 计划、退休与 Activity 经精确 `authenticatedCampaignAction`；Rules/Room 仍只有 `step/project/replay` 与权威提交链 | 当前公开映射为 `tests/causal-action-rules-v3.test.mjs`、`tests/world-campaign-v2.test.mjs`、`tests/item-materialization-causal-v5.test.mjs`、`tests/combat-mechanics-v2.test.mjs`、`tests/rules-multiplayer-v2.test.mjs`、`tests/multiplayer-room-v2.test.ts`、`tests/actor-plan-kp-boundary-v3.test.mjs`、`tests/actor-plan-room-v2.test.ts`、`tests/actor-plan-due-room-v2.test.ts` 及 observer/delivery runner | 只证明各 runner 明示的因果、世界、物品、战斗、多人、ActorPlan 与投影切片；真实 Workers AI、HTTP/浏览器和最终全量门另计 |
| `SPEC 0012` 战斗机械 B07–B15、B17–B22、B29–B30、B35–B40、B49 | `rules/v2/combat-*`、`combat/*`、`campaign-actions.ts`、`projector.ts` | `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`；日志已记录 B07 2/2、B38 8/8、Trigger/Time 15/15 及 B19–B22/B20/G14 定向 12/12 | 当前文件分别声明 45、2、8、15、1 个场景；声明规模不是冻结源码全文件通过证明 |
| B16/B27/B50 通用恢复与 B53 生产垂直链 | Room DO 随机 journal、D1 checkpoint/归档恢复、Room Action → Rules → Viewer | `tests/randomness-recovery-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/archive-d1-batches-v2.test.mjs`、`tests/archive-do-resume-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts`、`tests/combat-vertical-v2.test.ts`；archive D1 11/11、80+ events/48 audits 的 reader→fresh DO 1/1、无当前受控 viewer 的 D1→fresh DO 1/1 | 结清随机、单调 checkpoint、prefix/audit、ahead event/genesis conflict 校验、移除成员不复权已有局部证据；不得把它扩张为冻结源码或远端 D1 生产恢复完成 |
| `SPEC 0013` P/A/G/T/F Profile conformance | `rules/profiles/*`、`rules/compiler/*`、`rules/combat/*`、`rules/timeline.ts` | P：`tests/runtime-profiles-v2.test.mjs`；A：`tests/ability-profile-v2.test.mjs` + combat A06；G：`tests/combat-mechanics-v2.test.mjs` + `tests/privacy-bypass-v2.test.mjs`；T/F：`tests/runtime-trigger-time-v2.test.mjs` | 当前文件分别声明 13、8、45+1、15 个场景；日志已记录 Profile 组合和逐向量定向绿色，生产源码冻结后仍须整组重跑 |
| 精确版本管理读取 | `table/server.ts#getRoomManagement` | 源码与 `tests/rendered-html.test.mjs` 的 HTTP 验收断言已接入 | 房主 Read Model 返回 `ruleset_version`/`kp_model`，普通成员拒绝；冻结源码 Node/Worker 发布门尚未执行，故不计最终门 |
| `SPEC 0014` 战术空间与二维地图 | 当前 V5 Geometry/Environment Profile + Builder/Rules/Room + 待完成的 Tactical Projection/preview 与 `play-table.tsx` Adapter | 当前 runner 映射为 Geometry G01–G15、`tests/chandelier-environment-rules-v3.test.mjs`、`tests/dynamic-environment-room-lowering-v3.test.ts` 及环境 Room 测试；不沿用 env-v4 长轨迹作为 0.4 当前证据 | **部分实现，仍阻塞**：环境 FSM、破坏/区域、隐藏 target、archive→fresh DO 与 replay 有定向映射；当前源码回执、完整地图/preview、路径输入和双视口仍待 |
| `SPEC 0015` Form/Context/RAG/Narration/双状态/动态环境 | `kp/{form-catalog,context-pack,v3-context-runtime,static-retrieval,static-corpus,private-form-policy,causal-action-program,model-registry,context-planner-policy,narration-v3}.ts` + `room/v3-binding.ts` + 既有 Room/Rules/Geometry/DO/D1/UI；0.4 精确绑定 V5 runtime、workflow-v2 与 causal v5 | 0.4 当前映射为 `tests/runtime-profiles-v2.test.mjs`、`tests/kp-form-context-v3.test.mjs`、`tests/causal-action-rules-v3.test.mjs`、`tests/dynamic-environment-room-lowering-v3.test.ts`、`tests/viewer-narration-recovery-v3.test.ts` 及当前 item/ActorPlan runner；不从旧 workflow/env 组合推算通过数 | **当前实现与历史发布分账**：0.4 只认精确 `executeCausalActionProgram`/`actionLanguageRef`、Room 生成的 party/campaign capability 与 V5 闭包。此前 workflow-v2/env-v4 的定向、部署和线上数字仅作发布审计，不证明当前 0.4 源码门 |
| `SPEC 0016` 粗粒度 Form/冻结 Context/稀疏定义/Typed Claims | 隔离 vNext Stage3 Profile 接入 Room prepare/commit、Rules `step/project/replay` 与 Claims-only Narration；生产 Registry 仍为 V5 | `tests/kp-vnext-core.test.mjs`、`kp-vnext-claims.test.mjs`、`kp-vnext-world-interaction-rules.test.mjs`、`kp-vnext-hazard-actor-death-fold.test.mjs` 共 24/24；`kp-vnext-stage3-room.test.ts` 5/5；typecheck/diff-check 见执行日志 | **阶段三代表性纵切已完成、未切生产**：NPC 稀疏修订和通用 `world-interaction` 已闭环；opaque-ID 行为覆盖 Viewer 可操作直接目标、类型化空间角色、跨场景/跨 Form 拒绝，以及隐藏因果可由 Rules 使用但不进入无权 Claims。烧绳/试压板仍只验证泛化与观察边界；其余粗粒度 Form、生产采用、V5 删除、migration、部署与发布仍待 |

当前相关自主裁定为 DEC-035–047；其中 DEC-018/022 的 production ActionPlan/normalization 仅作历史审计，并由 DEC-046 在 0.4 current-only 范围内取代；DEC-047 冻结未来目标但不改变当前生产 Registry。

## 五项交叉审查摘要

本节记录的是**规格层审查结论**，不是代码或运行验证。所有“未发现冲突”都只表示当前规格文字已经明确责任归属；其成立仍必须由追踪矩阵所列真实责任 Interface 测试、架构检查、迁移与发布证据证明。

| 审查项 | 规格层结论 | 仍待实现 / 验证的证据 |
| --- | --- | --- |
| 跨规格矛盾 | 未发现需要修改 `SPEC 0001` 的冲突。0003 统一事务，0010 统一 Viewer/Audience，0013 固定 Profile，0014 拥有 Geometry；0015 保留当前 V5 与 RAG/发布语义，0016 只窄取代未来 Catalog、compound/环境模型并深化 Context/Claims seam | 阶段三两条代表性纵切已经取得开发期证据；当前生产仍以 V5 causal/world/item/combat/multiplayer/ActorPlan runner 映射。其余 Form、完整地图与最终门尚未取得证据 |
| 权限 | principal 仍来自可信会话；Form/LLM 不决定 actor、Audience、骰面、事件或 targets。0016 额外区分 KP 获准知道的 epistemic refs 与实际裁决 read set，NPC 继续按自身 Viewer；Claims 只输出获 grant 的 viewer refs | 阶段三已验证精确 read-set 冲突、NPC 知识隔离、隐藏 relation 整项裁剪与 FrozenRenderableClaims 重试；其余 Form 和真实 Provider/浏览器路径仍待 |
| 秘密 | 世界事实仍只有一份；动态 Room 状态不入静态 RAG；authority refs 可在 KP-only Claim basis 中使用但永不外发，Narration 只收目标 Viewer 冻结 Claims | 阶段三已验证隐藏 definition/relation/target 不进入无权 Claims 或 Narration，并验证恢复复用冻结材料；DOM、语音与生产 Provider 仍未覆盖 |
| 版本 | 当前 V5 genesis/Profile/hash 不变；0016 的 Catalog、Context、Definition、Relation、Bundle、Rules primitive 与 Claim vocabulary 必须发布新完整 manifest，未知组合 fail closed | 隔离 vNext Stage3 manifest/conformance 已建立但未进入生产 Registry；不迁移房间，完整 Catalog/Profile 仍待后续审查 |
| 第二权威 | Rules 外部仍只有 `step/project/replay`；Room DO 保存活跃状态和提交。Sparse revision 由服务器合成完整 next definition，模型 patch 不入 state；ProposalBundle/InteractionPlan/Claims 都是私有派生 Implementation | 阶段三已证明无 model DAG、JSON Patch、自由 damage/targets、committed-delta Narration 或第二随机路径；完整多合同 ProposalBundle 仍待，且阶段三不授权生产切换 |

## 审查结论与证据状态

1. 规格体系已经把 0002 的通用责任与纯战斗机械分配到 0003–0013，以 0014 固定战术空间/地图合同，以 0015 建立 V5 私有 Proposal/Context/RAG/叙述双状态，并由 0016 为未来 Profile 窄取代 Catalog、compound/DAG 和详细材料阈值；两次取代都不修改 0001。B01–B53 的每项处置仍以 [0002 逐项处置矩阵](./0002-disposition-matrix.md) 为准。
2. 自主产品/技术选择及其来源、玩家行为、权限/秘密、迁移和验收场景记录在 [决策登记册](./decision-register.md) 以及各规格的内嵌决策章节；状态“已裁定（本 Goal 授权）”不等于测试通过。
3. [总追踪矩阵](./traceability-matrix.md) 已为 P1–P13、A–O、B01–B53、P/A/G/T/F、TM01–TM14、KR01–KR16 与 FC01–FC09 标出责任 Interface、测试路径和完成门。KR/P12 保留 V5 实现与历史发布账本；FC/P13 的阶段三代表性纵切已有独立回执，但完整 Form 家族仍在实现中，不能借 feature 原型或 V5 证据抵扣。
4. 本索引只把已有实际命令/退出码的测试和已发生的远端事实写成证据；远端 D1 `0008–0011`、双视口五路径、既有 Worker 部署和非 force `cloudflare` 推送已经回填。完整门依用户豁免未运行；唯一三交互虽实际 3/3 live verified，原命令仍因已修复但未生产重跑的 evaluator 误判退出 1，不能写成绿色。
5. 当前不能把上述 V5 发布事实或阶段三开发期绿色扩张为完整线上质量 `COMPLETE`。Provider 指标、语音/TTS、完整战术地图、完整历史日志及其余 Form 纵切仍未覆盖；0016 当前明确不切生产、不删 V5、不 migration、不部署或发布。
