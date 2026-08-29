# 烛帷规格索引与交叉审查

- 索引状态：**持续维护**
- 审查日期：2026-08-29
- 适用分支：`cloudflare`
- 规则边界：D&D 5e 2014 / SRD 5.1；禁止 D&D 2024/5.5e 混入

本目录的产品权威起点是冻结的 `SPEC 0001`。`SPEC 0003–0013` 是既有 Goal 明确授权的产品与技术裁定，`SPEC 0014` 是用户批准的二维战术地图合同，`SPEC 0015` 是 2026-08-29 用户明确授权的私有 Form、Context Pack/RAG、body-only Narration、双状态与动态环境合同；这些状态不表示实现、测试、迁移或部署已经完成。任何后续规格都不能修改、缩小或绕过 `SPEC 0001`。

## 导航

- [冻结产品准则：SPEC 0001](./0001-llm-kp-responsibility-contract.md)
- [原 SPEC 0002 的 B01–B53 逐项处置](./0002-disposition-matrix.md)
- [本 Goal 自主裁定登记册](./decision-register.md)
- [十二板块、专项向量与 SPEC 0001 A–O 追踪矩阵](./traceability-matrix.md)
- [ADR-0014：私有提案、派生检索与发布边界](../adr/0014-private-proposal-derived-retrieval-and-publication-boundary.md)
- [执行、命令与证据日志](../refactor-log.md)

## 规格清单

| SPEC | 状态 | 单一职责 | 依赖与协作边界 |
| --- | --- | --- | --- |
| [0001：LLM/KP 职责与叙事权威](./0001-llm-kp-responsibility-contract.md) | **已批准，产品行为冻结** | 固定玩家意图、KP 叙事、Rules 机械与权威状态的权力分配；定义开放世界、公正、知识、NPC、失败、聚光灯、连续性、更正、收束及 A–O 验收 | 事实优先级仅次于用户在本 Goal 的明确决定；不依赖后续规格，后续规格全部服从它 |
| [0002：权威战斗框架](./0002-authoritative-combat-framework.md) | **已被替代，未曾批准** | 只作为原始草案与迁移证据保留，不是新规则实现依据 | 上位仅为 0001；通用责任与纯战斗机械已拆往 0003–0013；逐条结果见 [处置矩阵](./0002-disposition-matrix.md) |
| [0003：权威行动事务与深 Module Interface](./0003-authoritative-action-transaction.md) | **已裁定（本 Goal 授权）** | 定义 Room Action Module、Rules Module `step/project/replay`、Room Authority、根行动、待决、权威随机、幂等、作用域版本、恢复、回放、更正与统一 Outcome | 上位：0001；是 0004–0015 共用的事务、提交、投影与回放底座；新房公开双状态和 1+1 修订由 0015 窄取代 |
| [0004：KP 裁决与非战斗机械](./0004-kp-and-noncombat-mechanics.md) | **已裁定（本 Goal 授权）** | 五类可行性、检定/对抗/豁免、物品、资源、休整、Activity、非战斗危险、骰前冻结与裁定先例 | 上位：0001、0003；事实/知识交给 0005，战斗机械交给 0012，版本化定义交给 0013 |
| [0005：世界事实、因果与角色知识](./0005-world-facts-and-knowledge.md) | **已裁定（本 Goal 授权）** | `CanonicalFact`、`WorldEvent`、来源/因果/可见性、隐藏现实、证据/主张/推断、知识传播、关系/承诺/债务、分支与更正 | 上位：0001、0003、0004；观察者交付由 0010，可靠更正/归档由 0011 |
| [0006：模组、动态实体、NPC 与势力协议](./0006-module-npc-and-faction-protocol.md) | **已裁定（本 Goal 授权）** | 故事圣经、核心真相、开放留白、动态定义、NPC 有限知识、NPC/势力计划、模组版本与 Legacy Adapter | 上位：0001、0003、0005；控制权/时间依赖 0007，NPC 战斗提案进入 0012 而不另建战术权威 |
| [0007：多人房间、控制权、虚构时间与聚光灯](./0007-multiplayer-room-and-fiction-time.md) | **已裁定（本 Goal 授权）** | 可信 Principal、席位、角色控制、换席/请离/掉线、并发意图、原子分队、跨地点虚构时间、因果前沿与聚光灯账本 | 上位：0001、0003、0005；私人投影/投递由 0010，长团任期由 0008 |
| [0008：长团成长、章节连续性与继任角色](./0008-long-campaign-lifecycle.md) | **已裁定（本 Goal 授权）** | Campaign/Chapter、成长、跨章物品/伤势/知识/关系/债务/承诺/威胁、死亡/退役、继任与合法继承 | 上位：0001、0003、0005、0007；故事收束由 0009，私人知识/旧叙述边界由 0010 |
| [0009：失败、节奏、收束与交互协议](./0009-failure-pacing-conclusion-and-interaction.md) | **已裁定（本 Goal 授权）** | 场景问题、有意义失败、重复检定门、玩家停滞、势力推进、叙述/Receipt 交互、结局候选、尾声/续篇与现实玩家安全 | 上位：0001、0003、0004、0006、0007、0008；当前回应和秘密呈现服从 0010 |
| [0010：观察者专属呈现与当前回应投递](./0010-observer-specific-presentation.md) | **已裁定（本 Goal 授权）** | 观察资格、个人线索、世界内分享、Audience 冻结、统一 projector、每 Viewer 单槽 DeliveryFrame、ACK、不可回看及语音/转写/错误/日志旁路 | 声明上位为 0001；协议上复用 0003、0005、0007–0009 的事务、知识、控制权、连续性与收束状态 |
| [0011：可靠性、更正、可观测性与多轮评测](./0011-reliability-correction-observability-and-evaluation.md) | **已裁定（本 Goal 授权）** | 故障分类、SLO、免费额度预算、模型调用 Receipt、脱敏日志、归档重建、可审计更正、恢复矩阵及 20+ 轮 KP 评测阈值 | 上位：0001、0003、0010；引用 0005 的因果分支与 0013 的版本/Profile 清单 |
| [0012：权威战斗机械](./0012-authoritative-combat-mechanics.md) | **已裁定（本 Goal 授权）** | 仅定义 Encounter、空间、先攻/突袭、轮/回合/行动授予、移动/反应、能力/施法、效果/伤害/专注、0 HP/死亡及非歼灭结束；战斗只是 Rules Module 内部实现 | 上位：0001、0003、0006–0011；Profile/确定排序/几何与能力定义引用 0013；不得出现 CombatCoordinator 或战斗专属状态/骰源/projector |
| [0013：版本化运行时 Profiles 与确定性 Conformance](./0013-versioned-runtime-profiles.md) | **已裁定（本 Goal 授权）** | 固定 Ruleset/EventSchema、AbilityDefinition 与受限 MechanicOp 编译器、BattlefieldGeometry、TriggerOrdering、Fiction/Combat Time 等 Profile 及 hash/conformance/fail-closed 规则 | 上位：0001、0003–0007、0010–0012；为 0012 的战斗 Profile、0011 的恢复/审计和所有旧房回放提供确定版本解释 |
| [0014：观察者战术地图、权威环境与空间意图](./0014-observer-tactical-map-and-environment.md) | **已裁定（用户 Goal 明确批准）** | 把真实 scene geometry、环境有限状态、移动/区域地图意图、秘密安全 Tactical Projection/preview、二维地图和同源文字读数接入唯一事务 | 上位：0001、0003、0005、0007、0010、0012、0013；不重写 Geometry 算法，不建立 UI/GM 第二空间 |
| [0015：私有 Form Proposal、Context Pack/RAG、提交后叙述与动态环境](./0015-private-form-context-rag-and-narration.md) | **已裁定（用户本 Goal 明确授权）** | 定义十 Form、三层 Context、静态 D1 FTS/权威重读、一次窄修订、CausalActionProgram、body-only Narration、action/narration 双状态、模型角色/实验门和吊灯纵切 | `SPEC 0001` 最高；复用 0003 Room/Rules/DO、0010 Viewer/Audience、0013 Profile、0014 Geometry；仅窄取代 0003/0010/0011/0014 的明示冲突条款且只进新 V3 房间 |

## 当前实现证据索引（2026-08-29）

本节把**当前存在的公开测试映射**与 `docs/refactor-log.md` 已记录的局部绿色分开陈述。测试文件存在或声明了多少场景，不等于当前未冻结源码已经全量通过；最终仍以同一冻结 SHA 的完整门为准。

| 产品语义 | 生产实现映射 | 当前有效证据 | 证据边界 |
| --- | --- | --- | --- |
| 通用 ActionPlan、非战斗、长团与投影 | KP `authoritative-*`；Rules `rules/v2/*`；Room `room/action.ts`、`durable-object.ts` | 公开 runner 已存在：`tests/authoritative-action.test.mjs`、`tests/rules-compound-action-v2.test.mjs`、`tests/world-campaign-v2.test.mjs`、`tests/observer-projection-v2.test.mjs`、`tests/observer-delivery-v2.test.ts`、`tests/kp-multiturn-eval.test.ts`；日志已记录 production validator 31/31 等局部绿色 | 只证明各 runner 明示的事务、知识、多人、收束与投影切片；真实 Workers AI、HTTP/浏览器和最终全量门另计 |
| `SPEC 0012` 战斗机械 B07–B15、B17–B22、B29–B30、B35–B40、B49 | `rules/v2/combat-*`、`combat/*`、`campaign-actions.ts`、`projector.ts` | `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`；日志已记录 B07 2/2、B38 8/8、Trigger/Time 15/15 及 B19–B22/B20/G14 定向 12/12 | 当前文件分别声明 45、2、8、15、1 个场景；声明规模不是冻结源码全文件通过证明 |
| B16/B27/B50 通用恢复与 B53 生产垂直链 | Room DO 随机 journal、归档/恢复、Room Action → Rules → Viewer | `tests/randomness-recovery-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts`、`tests/combat-vertical-v2.test.ts`；最新 randomness/recovery/contest 3 files / 24 tests、retry 3/3、archive resume 2/2、B53 vertical 1/1 | 并发、多波、旧 journal、篡改拒绝与归档恢复局部证据已绿；不得把它扩张为冻结源码或远端 D1 生产恢复完成 |
| `SPEC 0013` P/A/G/T/F Profile conformance | `rules/profiles/*`、`rules/compiler/*`、`rules/combat/*`、`rules/timeline.ts` | P：`tests/runtime-profiles-v2.test.mjs`；A：`tests/ability-profile-v2.test.mjs` + combat A06；G：`tests/combat-mechanics-v2.test.mjs` + `tests/privacy-bypass-v2.test.mjs`；T/F：`tests/runtime-trigger-time-v2.test.mjs` | 当前文件分别声明 13、8、45+1、15 个场景；日志已记录 Profile 组合和逐向量定向绿色，生产源码冻结后仍须整组重跑 |
| 精确版本管理读取 | `table/server.ts#getRoomManagement` | 源码与 `tests/rendered-html.test.mjs` 的 HTTP 验收断言已接入 | 房主 Read Model 返回 `ruleset_version`/`kp_model`，普通成员拒绝；冻结源码 `npm test` 尚未执行，故不计最终门 |
| `SPEC 0014` 战术空间与二维地图 | 既有 Geometry/Profile + 待实现的环境状态、Tactical Projection/preview、Room Action 输入与 `play-table.tsx` Adapter | G01–G15 只提供算法底座；SPEC 0014 场景 1–14 的真实 Room/UI/浏览器证据尚待建立 | 明确为新增硬阻塞；不得以现有 helper 测试、空 obstacles、静态示意或直接 WorldState fixture 冒充完成 |
| `SPEC 0015` Form/Context/RAG/Narration/双状态/动态环境 | 计划中的 `kp/{form-catalog,context-pack,static-retrieval,causal-action-program,model-registry}.ts` + 既有 Room/Rules/Geometry/DO/D1/UI | 当前只有本规格、ADR、决策与追踪映射；十 Form、120 gold、吊灯 14 场景、迁移/浏览器/部署均无运行证据 | **待实现，硬阻塞**：不得用旧 ActionPlan/Delivery/Geometry 局部绿色冒充新 Profile 或发布完成 |

相关自主裁定为 [DEC-018](./decision-register.md#dec-018生产-kp-提案采用有类型的复合-action-plan)、[DEC-035](./decision-register.md#dec-035战术地图只适配-viewer-tactical-projection不拥有空间事实)、[DEC-036](./decision-register.md#dec-036主-kp-使用私有小表compound-保留开放行动逃生舱)、[DEC-037](./decision-register.md#dec-037required-retrieved-optional-分层d1-fts-只作静态派生索引)、[DEC-038](./decision-register.md#dec-038proposal-采用一次首调用加一次窄修订并冻结玩家语义)、[DEC-039](./decision-register.md#dec-039narration-只输出-body行动和逐受众发布分别建模)、[DEC-040](./decision-register.md#dec-040g2-是默认候选辅助模型必须角色化验证且未达门即移除接线) 与 [DEC-041](./decision-register.md#dec-041动态环境以版本化有限状态和吊灯因果链进入同一事务)。

## 五项交叉审查摘要

本节记录的是**规格层审查结论**，不是代码或运行验证。所有“未发现冲突”都只表示当前规格文字已经明确责任归属；其成立仍必须由追踪矩阵所列真实责任 Interface 测试、架构检查、迁移与发布证据证明。

| 审查项 | 规格层结论 | 仍待实现 / 验证的证据 |
| --- | --- | --- |
| 跨规格矛盾 | 未发现需要修改 `SPEC 0001` 的规格冲突。0003 统一事务，0010 统一 Viewer/Audience，0013 固定 Profile，0014 拥有 Geometry/地图；0015 只给新房增加私有 Proposal/Context/RAG/逐受众叙述和动态环境纵切，并在 §17 精确列出对 0003/0010/0011/0014 的窄 supersede。Encounter 结束不等于故事收束，叙述文本不等于正史，产品 V3 不等于 ruleset v3，检索命中不等于世界事实 | 既有 Action/Rules 组合门仍须冻结重跑；SPEC 0014/0015 的 Room/UI/环境、Form/RAG、120 gold、双状态和发布证据均未建立，明确阻塞冻结 |
| 权限 | principal 只能来自可信会话；Seat/CharacterControl 决定玩家控制权；玩家只决定自己的角色；Form/Planner/RAG/LLM 不接收或决定 actor、Audience、骰面、事件、实际 targets；NPC Context 重新按有限知识投影；发布 capability 按 ViewerKey 冻结 | 既有 Room multiplayer 权限证据只算底座；仍需 Form 注入拒绝、NPC 重投影、Planner allowlist、逐受众重试、HTTP/浏览器越权回归 |
| 秘密 | 世界事实只保存一份，知识按角色取得；动态 Room 状态不入 RAG；静态 ref 按 hash/Profile/权限重读；Narration 只收逐受众投影；Audience 提交时冻结；日志仅含 SPEC 0015 的阶段/Form/Profile/model/token/耗时/错误/fallback/hash/命中桶；地图/DOM/TTS/错误/历史无旁路 | 原 projection/delivery/world/table 局部证据保留；还需 RAG 静态性/秘密 canary、NPC 重投影、body Grounding、隐藏目标不可区分和生产日志/浏览器扫描 |
| 版本 | 房间 genesis 固定 ruleset/event/module/definition/projection 以及 Form/Action Language/Context/corpus/retrieval/model/narration/publication/environment Profile 的精确 ID/hash；未知组合 fail closed；产品 V3 与机械版本轴分离，旧房不猜迁移 | 既有 Profile registry 只算底座；新完整 manifest、旧 `authoritative-kp-action-plan-v1` 隔离、模型角色验证、旧房 replay/引用扫描和部署 hash guard 均待 |
| 第二权威 | Rules 外部只有 `step/project/replay`；Room DO 保存活跃世界、事件、Receipt、随机、Audience 与发布状态；Form/compiler 只产 Rules Input，D1 FTS/Vectorize/缓存/日志/页面只作派生 Adapter；实际环境 targets 只由 Rules 从完整 Geometry 算出 | 原 module 护栏需冻结重跑；还须新增 Form/compiler 无第四机械、索引无动态状态、页面无 targets/GM payload、双状态不回滚与环境 archive/replay 检查 |

## 审查结论与证据状态

1. 规格体系已经把 0002 的通用责任与纯战斗机械分配到 0003–0013，以 0014 固定战术空间/地图合同，并以 0015 新增私有 Proposal/Context/RAG/叙述双状态与动态环境；0015 §17 只窄取代明示冲突，不修改 0001 或旧房解释器。B01–B53 的每项处置仍以 [0002 逐项处置矩阵](./0002-disposition-matrix.md) 为准。
2. 自主产品/技术选择及其来源、玩家行为、权限/秘密、迁移和验收场景记录在 [决策登记册](./decision-register.md) 以及各规格的内嵌决策章节；状态“已裁定（本 Goal 授权）”不等于测试通过。
3. [总追踪矩阵](./traceability-matrix.md) 已为 P1–P12、A–O、B01–B53、P/A/G/T/F、TM01–TM14 与 KR01–KR16 标出责任 Interface、测试路径和完成门；“待实现”“未满足”、仅声明规模或 Legacy 的内容不能作为完成证据。
4. 本索引只把已在 `refactor-log.md` 留下命令/退出码的测试写成已验证；局部绿色不能拼接成生产源码冻结门。仍须完成全量验证、必要迁移、Cloudflare 正式部署与 GitHub `cloudflare` 推送。
5. 最终只有实际命令、退出码、测试报告、迁移状态、部署 version/源码 SHA、线上冒烟/日志、远端分支 SHA 和远端 `main` 不变证据全部回填后，才能宣告 `COMPLETE`。
