# 烛帷规格索引与交叉审查

- 索引状态：**持续维护**
- 审查日期：2026-08-27
- 适用分支：`cloudflare`
- 规则边界：D&D 5e 2014 / SRD 5.1；禁止 D&D 2024/5.5e 混入

本目录的产品权威起点是冻结的 `SPEC 0001`。`SPEC 0003–0013` 是在本 Goal 明确授权下作出的后续产品与技术裁定，`SPEC 0014` 是用户在同一 Goal 中明确追加批准的二维战术地图合同；这不表示实现、测试、迁移或部署已经完成。任何后续规格都不能修改、缩小或绕过 `SPEC 0001`。

## 导航

- [冻结产品准则：SPEC 0001](./0001-llm-kp-responsibility-contract.md)
- [原 SPEC 0002 的 B01–B53 逐项处置](./0002-disposition-matrix.md)
- [本 Goal 自主裁定登记册](./decision-register.md)
- [十板块与 SPEC 0001 A–O 追踪矩阵](./traceability-matrix.md)
- [执行、命令与证据日志](../refactor-log.md)

## 规格清单

| SPEC | 状态 | 单一职责 | 依赖与协作边界 |
| --- | --- | --- | --- |
| [0001：LLM/KP 职责与叙事权威](./0001-llm-kp-responsibility-contract.md) | **已批准，产品行为冻结** | 固定玩家意图、KP 叙事、Rules 机械与权威状态的权力分配；定义开放世界、公正、知识、NPC、失败、聚光灯、连续性、更正、收束及 A–O 验收 | 事实优先级仅次于用户在本 Goal 的明确决定；不依赖后续规格，后续规格全部服从它 |
| [0002：权威战斗框架](./0002-authoritative-combat-framework.md) | **已被替代，未曾批准** | 只作为原始草案与迁移证据保留，不是新规则实现依据 | 上位仅为 0001；通用责任与纯战斗机械已拆往 0003–0013；逐条结果见 [处置矩阵](./0002-disposition-matrix.md) |
| [0003：权威行动事务与深 Module Interface](./0003-authoritative-action-transaction.md) | **已裁定（本 Goal 授权）** | 定义 Room Action Module、Rules Module `step/project/replay`、Room Authority、根行动、待决、权威随机、幂等、作用域版本、恢复、回放、更正与统一 Outcome | 上位：0001；是 0004–0014 共用的事务、提交、投影与回放底座 |
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

## 当前实现证据索引（2026-08-27）

本节把**当前存在的公开测试映射**与 `docs/refactor-log.md` 已记录的局部绿色分开陈述。测试文件存在或声明了多少场景，不等于当前未冻结源码已经全量通过；最终仍以同一冻结 SHA 的完整门为准。

| 产品语义 | 生产实现映射 | 当前有效证据 | 证据边界 |
| --- | --- | --- | --- |
| 通用 ActionPlan、非战斗、长团与投影 | KP `authoritative-*`；Rules `rules/v2/*`；Room `room/action.ts`、`durable-object.ts` | 公开 runner 已存在：`tests/authoritative-action.test.mjs`、`tests/rules-compound-action-v2.test.mjs`、`tests/world-campaign-v2.test.mjs`、`tests/observer-projection-v2.test.mjs`、`tests/observer-delivery-v2.test.ts`、`tests/kp-multiturn-eval.test.ts`；日志已记录 production validator 31/31 等局部绿色 | 只证明各 runner 明示的事务、知识、多人、收束与投影切片；真实 Workers AI、HTTP/浏览器和最终全量门另计 |
| `SPEC 0012` 战斗机械 B07–B15、B17–B22、B29–B30、B35–B40、B49 | `rules/v2/combat-*`、`combat/*`、`campaign-actions.ts`、`projector.ts` | `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`；日志已记录 B07 2/2、B38 8/8、Trigger/Time 15/15 及 B19–B22/B20/G14 定向 12/12 | 当前文件分别声明 45、2、8、15、1 个场景；声明规模不是冻结源码全文件通过证明 |
| B16/B27/B50 通用恢复与 B53 生产垂直链 | Room DO 随机 journal、归档/恢复、Room Action → Rules → Viewer | `tests/randomness-recovery-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts`、`tests/combat-vertical-v2.test.ts`；最新 randomness/recovery/contest 3 files / 24 tests、retry 3/3、archive resume 2/2、B53 vertical 1/1 | 并发、多波、旧 journal、篡改拒绝与归档恢复局部证据已绿；不得把它扩张为冻结源码或远端 D1 生产恢复完成 |
| `SPEC 0013` P/A/G/T/F Profile conformance | `rules/profiles/*`、`rules/compiler/*`、`rules/combat/*`、`rules/timeline.ts` | P：`tests/runtime-profiles-v2.test.mjs`；A：`tests/ability-profile-v2.test.mjs` + combat A06；G：`tests/combat-mechanics-v2.test.mjs` + `tests/privacy-bypass-v2.test.mjs`；T/F：`tests/runtime-trigger-time-v2.test.mjs` | 当前文件分别声明 13、8、45+1、15 个场景；日志已记录 Profile 组合和逐向量定向绿色，生产源码冻结后仍须整组重跑 |
| 精确版本管理读取 | `table/server.ts#getRoomManagement` | 源码与 `tests/rendered-html.test.mjs` 的 HTTP 验收断言已接入 | 房主 Read Model 返回 `ruleset_version`/`kp_model`，普通成员拒绝；冻结源码 `npm test` 尚未执行，故不计最终门 |
| `SPEC 0014` 战术空间与二维地图 | 既有 Geometry/Profile + 待实现的环境状态、Tactical Projection/preview、Room Action 输入与 `play-table.tsx` Adapter | G01–G15 只提供算法底座；SPEC 0014 场景 1–14 的真实 Room/UI/浏览器证据尚待建立 | 明确为新增硬阻塞；不得以现有 helper 测试、空 obstacles、静态示意或直接 WorldState fixture 冒充完成 |

相关自主裁定为 [DEC-018](./decision-register.md#dec-018生产-kp-提案采用有类型的复合-action-plan)、[DEC-020](./decision-register.md#dec-020直接后果与-campaign-生命周期是-actionplan-的封闭语义操作)、[DEC-021](./decision-register.md#dec-021arcane-recovery-使用玩家冻结的多槽位规范选择)、[DEC-022](./decision-register.md#dec-022authoritative-v2-只接受完整生产提案与版本化恢复输入)、[DEC-023](./decision-register.md#dec-023非战斗豁免复用复合事务2014-职业熟练与统一后果)、[DEC-024](./decision-register.md#dec-024队伍协调的六种语义动作必须显式判别)、[DEC-025](./decision-register.md#dec-025房主管理-read-model-显式返回房间规则版本) 与 [DEC-035](./decision-register.md#dec-035战术地图只适配-viewer-tactical-projection不拥有空间事实)。

## 五项交叉审查摘要

本节记录的是**规格层审查结论**，不是代码或运行验证。所有“未发现冲突”都只表示当前规格文字已经明确责任归属；其成立仍必须由追踪矩阵所列真实责任 Interface 测试、架构检查、迁移与发布证据证明。

| 审查项 | 规格层结论 | 仍待实现 / 验证的证据 |
| --- | --- | --- |
| 跨规格矛盾 | 未发现需要修改 `SPEC 0001` 的规格冲突。0003 统一所有行动事务；0004/0005/0006/0007/0008/0009 分别拥有非战斗、事实知识、模组 NPC、多人时间、长团和故事交互；0010 统一呈现；0011 统一可靠性；0012 只保留纯战斗机械；0013 只固定版本化确定解释；0014 只把真实环境与地图 Adapter 接到同一 Geometry/Viewer 链。Encounter 结束不等于故事收束，叙述文本不等于正史，聚光灯不等于虚构时间，地图像素不等于空间事实。0002 不再拥有任何新实现责任 | 既有 Action/Rules 证据仍须清零原组合门；新增 SPEC 0014 的环境状态、Tactical Projection、Room/UI 纵切和双视口浏览器证据尚未建立，明确阻塞冻结 |
| 权限 | principal 只能来自可信会话；Seat/CharacterControl 决定玩家控制权；玩家只决定自己的角色，KP 只为 NPC/世界提案且使用有限知识；房主/队长/页面/模型不扩大控制或观察权；更正、恢复、内部 continuation 和投递发布均是独立内部 capability | Room multiplayer 8/8 已覆盖 service-only 管理、休整 Pending 与成长/继任控制；仍需最终 HTTP/浏览器路径、全部战斗封闭选择与发布态越权回归 |
| 秘密 | 世界事实只保存一份，知识按角色及来源取得；所有玩家/NPC/KP/内部输出复用 `project(viewer)`；Audience 提交时冻结，分享不追溯；DeliveryFrame 不入正史或归档；地图/preview/文字读数只消费 Viewer Tactical Projection，不下发后隐藏 GM geometry；日志只允许白名单元数据；语音、转写、错误、候选、重连和历史不得成为旁路 | 原 projection/delivery/world/table 局部证据保留；新增隐藏实体/障碍不可区分 preview、DOM/ARIA 无泄漏及生产日志/HTTP/语音/转写线上旁路仍待实际证明 |
| 版本 | 房间 genesis 固定 ruleset、事件 schema、模组、定义/编译器、投影/呈现、模型/Prompt 与各 Profile 的 ID/hash；未知或不兼容组合 fail closed；旧房只按原解释器/Legacy Adapter 回放，不因部署静默重算；所有新机械只采用 2014/SRD 5.1 | 当前 Profile/registry 局部证据与 `getRoomManagement.ruleset_version` 路由已接入；2026-08-26 已复核公开 Free 方案与 GLM 4.7 Flash 的 function calling/131,072 context/Free 归类，但未检查或声称账户用量余量；冻结源码 conformance/旧房 replay、真实模型能力探测、版本迁移与归档重建组合仍待 |
| 第二权威 | Rules 外部机械/投影/回放只有 `step/project/replay`；Room DO 是活跃世界、事件、Receipt、待决、随机结果、投递槽与 geometry 唯一权威；LLM 永远在 DO 事务外；D1 只保存身份/目录/静态人物卡/可重建结构化归档。页面格子/像素、AI/NPC/语音 Adapter、日志、Profile 目录和测试 fixture 均不得写第二状态、另算结果或自报区域 targets | 原 module 护栏需在冻结 SHA 重跑；还须新增页面无 Geometry 运算/无 GM payload/无区域 targetIds、Tactical Projection 单源、环境/移动/区域 Room vertical 与 archive/replay 的可证伪检查 |

## 审查结论与证据状态

1. 规格体系已经把 0002 的通用责任与纯战斗机械分配到 0003–0013，并以 0014 追加用户批准的战术空间/地图呈现合同；B01–B53 的每项处置以 [0002 逐项处置矩阵](./0002-disposition-matrix.md) 为准。这里的“被替代”不等于 0002 曾被批准。
2. 自主产品/技术选择及其来源、玩家行为、权限/秘密、迁移和验收场景记录在 [决策登记册](./decision-register.md) 以及各规格的内嵌决策章节；状态“已裁定（本 Goal 授权）”不等于测试通过。
3. [总追踪矩阵](./traceability-matrix.md) 已为 P1–P10、A–O、B01–B53 与 P/A/G/T/F 标出责任 Interface、真实测试路径和完成门；其中标为“待实现”“未满足”、仅声明规模或 Legacy 的内容不能作为完成证据。
4. 本索引只把已在 `refactor-log.md` 留下命令/退出码的测试写成已验证；局部绿色不能拼接成生产源码冻结门。仍须完成全量验证、必要迁移、Cloudflare 正式部署与 GitHub `cloudflare` 推送。
5. 最终只有实际命令、退出码、测试报告、迁移状态、部署 version/源码 SHA、线上冒烟/日志、远端分支 SHA 和远端 `main` 不变证据全部回填后，才能宣告 `COMPLETE`。
