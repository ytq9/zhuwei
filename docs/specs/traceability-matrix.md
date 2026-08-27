# 全局产品—实现—验收追踪矩阵

- 状态：**持续维护；不是实施完成证明**
- 基线日期：2026-08-27
- 适用分支：`cloudflare`
- 冻结产品准则：`SPEC 0001`（已批准、产品行为冻结）
- 覆盖范围：原十个产品板块 P1–P10、用户追加批准的战术地图板块 P11，以及 `SPEC 0001` 验收场景 A–O

本矩阵把产品来源追踪到玩家可观察行为、权威事件/状态、观察者专属投影、责任 Interface、测试文件与完成门证据。规格中的“验收场景”或本表中的“计划测试”都不等于测试已实现或已通过；只有通过真实责任 Interface 执行并留下命令、退出码和结果的测试，才能回填为有效证据。

## 1. 证据口径

| 标记 | 含义 | 是否计入完成门 |
| --- | --- | --- |
| **实际（有效）** | 测试从可信会话或规定的公开责任 Interface 进入，经权威提交与 `project(viewer)` 观察结果；没有直接改内部状态、喂骰、伪造 Audience/窗口/事件；并有对应源码状态上的通过记录 | 是 |
| **实际（局部）** | 已有测试真实覆盖某个上游或平台子路径，但没有覆盖该行完整产品责任链 | 只计入明确写出的局部回归，不得代替该行验收 |
| **实际（RED；不计）** | 目标测试已由规定 Interface 运行但仍失败；计数表示失败场景数，不表示通过 | 否；只作为已定位的实现缺口 |
| **Legacy（不计）** | 直接调用 `applyEvents`/内部 fold、直接修改 `WorldState`、由测试或请求体提供骰面/actor、直接构造窗口/知识/事件，或只做源码正则/哈希检查 | 否；只可作为迁移证据 |
| **待实现** | 文件尚不存在、尚未接入测试运行器，或场景尚未通过责任 Interface 建立 | 否 |

责任 Interface 的语义边界如下；具体 TypeScript 名称可以按已裁定规格实现，但责任不能被拆成平行路径：

- Room Action Module：接收已认证意图、待决回答、重试或 ACK，协调 KP 提案/修订并返回 `committed`、`awaitingInput`、`needsKp`、`retryableFailure`、`rejected` 或 `concluded`。
- Rules Module：外部只公开 `step / project / replay`；机械、世界变化、所有 Viewer 投影和事件回放分别只有这一条路径。
- Room Authority / Room Durable Object：`prepare / observe / commit / acknowledge / commitCorrection`；唯一保存活跃世界、事件、作用域版本、幂等 Receipt、待决输入与当前投递槽，并提供权威随机。
- 页面/API：只从可信会话提交自然语言意图、待决回答、重试、观察和 ACK；不能自报 principal/actor/viewer、骰面、Audience、投影哈希或机械结果。

### 1.1 当前有回执的证据快照

以下结果来自 `docs/refactor-log.md` 已记录的命令与退出码；“当前声明数”直接取当前测试源码，“已记录绿色”只证明实际运行过的对应切片。二者都不代表生产源码冻结后的最终全量门：

- **当前公开 runner 声明规模**：`authoritative-action` 13、Room Authority 9、Rules/Room multiplayer 各 9、world/campaign 12、observer delivery 8、authoritative table 13、KP Adapter 9、Rules compound 27、telemetry 7、runtime Profile 13、Ability 8、Trigger/Time 15、combat mechanics 45、hostility 2、long casting 8、combat archive 3、archive DO resume 2、privacy G15 1、B53 vertical 1。循环参数化展开后，`randomness-recovery` 12、`combat-room-randomness` 11、contest randomness 1。
- **已记录绿色切片**：Profile registry/Ability/B07/B38/G15 32/32；B19–B22/B20/G14 定向 12/12；Rules compound 27/27；B53 vertical 1/1；最新 Room randomness/recovery/contest 3 files / 24 tests；Room retry 3/3；archive DO resume 2/2；canonical production-validator 31/31。其它 P1–P10/A–O 行保留的较小计数是当时命令的历史通过数，不应被误读为当前文件声明规模。
- **当前 canonical Profile 快照**：Projection Policy `projection-observer-safe-v1` 1.2.0 = `sha256:9312f68960f1c53f79b5c95bfd8c95ab87aec903603796f455a6c1d2d4514d8c`；完整 Runtime manifest = `sha256:2f7af76e9a7262675210c18528ca9c6bead5c676aecc71113304eaf01f42dbe9`；canonical genesis golden = `sha256:7e858e340283252d67779ddb1ae773fb5ac5a98d3859fdcef467c58a34935355`。该 Profile 把 `successorRequired`、恢复候选与普通玩家读取固定到同一 Rules projector。
- **实际（局部）**：`tests/authoritative-kp-adapter.test.mjs`、`structured-telemetry-v2.test.mjs`、`authoritative-table-v2.test.mjs` 都已有局部绿色记录，但分别不等于真实模型线上调用、所有生产日志调用点或生产 HTTP/浏览器冒烟；`getRoomManagement.ruleset_version` 的 HTTP 断言已接入但尚待冻结源码 `npm test`。
- **Legacy（不计）**：上述 Room 组合回归中的 `room-do.test.ts` 9/9 只作为旧版本回归，不抵扣 v2 完成门。
- **当前仍须单列的未完成证据**：生产源码尚未冻结；最终 `module:check`、`typecheck`、`lint`、`npm test`、真实 Workers AI、D1 迁移/写读/恢复、正式部署/流量/冒烟/日志和显式 refspec 推送均未由上述局部测试证明。

### 1.2 `SPEC 0002` B01–B53 当前责任与公开证据映射

下表覆盖 B01–B53 的全部编号且服从 `0002-disposition-matrix.md`；“已实现/局部证据”表示有生产实现和公开责任 Interface 测试，不表示该组已经通过冻结源码全量门。

| B 向量 | 唯一责任 | 当前公开测试映射 | 当前状态与边界 |
| --- | --- | --- | --- |
| B01–B06 | 0003–0006、0010；B04–B06 的纯战斗段再进入 0012/0013 | `tests/authoritative-action.test.mjs`、`authoritative-kp-adapter.test.mjs`、`world-campaign-v2.test.mjs`、`module-npc-v2.test.mjs`、`observer-projection-v2.test.mjs`、`ability-profile-v2.test.mjs` | **已实现/局部证据**：自由行动、澄清、直接成功、危险公正、动态定义诊断与隐藏投影有公开 seam；真实 Workers AI/HTTP 待阶段 4/5 |
| B07–B15 | 0012；B08/B09 接 0013 G/T，B13 的私人投影接 0010 | `tests/combat-hostility-v2.test.mjs`、`combat-mechanics-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs`、`privacy-bypass-v2.test.mjs` | **已实现/局部证据**：hostility、Geometry、移动中断、行动授予、Shield/Counterspell/Ready 已映射；冻结整组待重跑 |
| B16 | 0003/0007/0010/0011 通用恢复，战斗层无副本 | `tests/observer-delivery-v2.test.ts`、`multiplayer-room-v2.test.ts`、`randomness-recovery-v2.test.ts`、`combat-vertical-v2.test.ts` | **已实现/局部证据**：等待、重连、同一 Pending/骰面与不自动 pass 有公开 Room seam |
| B17–B22 | 0012；B21 长期任期接 0008，B22 NPC policy 接 0006 | `tests/combat-mechanics-v2.test.mjs`、`rules-compound-action-v2.test.mjs`、`combat-room-randomness-v2.test.ts` | **已实现/局部证据**：2014 施法限制、有效 AC、专注/伤害/临时 HP、0 HP/死亡/稳定恢复与非致命有公开测试 |
| B23–B28 | 0003–0007、0009–0011 通用 NPC/权限/并发/失败责任 | `tests/module-npc-v2.test.mjs`、`observer-projection-v2.test.mjs`、`multiplayer-room-v2.test.ts`、`room-retry-v2.test.ts`、`kp-multiturn-eval.test.ts` | **已实现/局部证据**：有限知识 NPC、无自动选择、私人窗口、作用域并发与有意义失败已映射；线上旁路待证 |
| B29–B30 | 0012/0013 Time + 0007–0009 | `tests/combat-mechanics-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs`、`combat-vertical-v2.test.ts`、`world-campaign-v2.test.mjs` | **已实现/局部证据**：任一拒绝保持 Encounter、全员接受/完成逃离才结束，故事与长期后果分层 |
| B31–B34 | 0003/0005/0008/0009/0011/0013 | `tests/authoritative-action.test.mjs`、`archive-correction-v2.test.ts`、`runtime-profiles-v2.test.mjs`、`world-campaign-v2.test.mjs`、`kp-multiturn-eval.test.ts` | **已实现/局部证据**：模型失败稳定点、回放/更正、版本与故事收束已映射；真实模型和 D1 灾难恢复待阶段 4/5 |
| B35–B40 | 0012/0013，B38 复用 0004 Activity | `tests/combat-mechanics-v2.test.mjs`、`combat-long-casting-v2.test.mjs`、`runtime-profiles-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs` | **已实现/局部证据**：2014 突袭/擒抱/共享伤害、长施法、Geometry 与 2024 污染拒绝均有公开测试 |
| B41–B48 | 0003–0011 通用行动、知识、投影、可靠性与交互责任 | `tests/rules-compound-action-v2.test.mjs`、`authoritative-kp-adapter.test.mjs`、`observer-delivery-v2.test.ts`、`privacy-bypass-v2.test.mjs`、`structured-telemetry-v2.test.mjs`、`kp-multiturn-eval.test.ts` | **已实现/局部证据**：通用 KP 循环、危险、Viewer、更正/安全、聚光灯与提交后叙述有公开 seam；生产日志/媒体旁路待证 |
| B49 | 0012/0013 Trigger + 0003 Pending | `tests/runtime-trigger-time-v2.test.mjs`、`combat-mechanics-v2.test.mjs`、`combat-vertical-v2.test.ts` | **已实现/局部证据**：确定触发批次、私人排序/响应、失效零成本、重连/replay 已映射 |
| B50–B52 | 0003/0005/0007/0011/0013 通用随机、并发、版本回放 | `tests/randomness-recovery-v2.test.ts`、`tests/contest-room-randomness-v2.test.ts`、`tests/runtime-profiles-v2.test.mjs`、`tests/archive-do-resume-v2.test.ts`、`tests/archive-correction-v2.test.ts` | **已实现/局部证据**：最新 randomness/recovery/contest 组合 24/24（含两项 journal 篡改拒绝）、retry 3/3、archive DO resume 2/2；冻结 D1 归档与部署门仍待 |
| B53 | 总追踪矩阵；0012 遭遇段 + 0008 长期后果 | `tests/combat-vertical-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts` | **已实现/局部证据**：已记录 vertical 1/1，贯通自然语言→Room Action→DO→Rules→Viewer、动态敌人/危险、多波伤害/专注、私人反应、驱逐重连、投降与长期状态；冻结全量/线上仍待 |

### 1.3 `SPEC 0013` P/A/G/T/F conformance 映射

| 向量 | 当前真实 runner | 当前状态与证据边界 |
| --- | --- | --- |
| P01–P08 | `tests/runtime-profiles-v2.test.mjs`（当前声明 13） | **已实现/公开 Interface 证据**：JCS/hash、完整 manifest、历史 Adapter、state pin、unknown/Legacy fail-closed；冻结源码重跑和部署前引用扫描仍待 |
| A01–A09 | `tests/ability-profile-v2.test.mjs`（当前声明 8）+ `tests/combat-mechanics-v2.test.mjs` 的 A06 | **已实现/公开 Interface 证据**：编译规范、诊断、复杂度/高数值、控制者选择、旧图、2014 护栏、MechanicOp 拒绝；冻结整组待重跑 |
| G01–G15 | `tests/combat-mechanics-v2.test.mjs` 的 Geometry 场景 + `tests/privacy-bypass-v2.test.mjs` 的 G15 | **已实现/公开 Interface 证据**：整数英寸、三维距离、路径/占位/掩护/区域、移动前缀与空间秘密均映射；当前 combat 文件共声明 45 个综合场景，不把该总数冒充 15 个独立文件 |
| T01–T07 | `tests/runtime-trigger-time-v2.test.mjs` + combat reaction 场景 | **已实现/公开 Interface 证据**：稳定批次/轮转/私人排序/失效/嵌套/断线/非战斗排序；同文件与 F 合计声明 15 个场景 |
| F01–F09 | `tests/runtime-trigger-time-v2.test.mjs` + `combat-long-casting-v2.test.mjs`、multiplayer/vertical 组合 | **已实现/公开 Interface 证据**：六秒轮、现实等待、休整、Activity、Encounter 后锚点、同刻顺序、分支时间、旧 Profile、共享先攻均映射；到期 Activity 使用 canonical 独立根，其随机 journal 只在严格根/事件前缀校验后恢复；阶段 4 冻结整组待重跑 |

### 1.4 `SPEC 0014` 战术地图新增完成标准映射

| 向量 | 唯一责任 | 计划 / 当前真实 runner | 当前状态与证据边界 |
| --- | --- | --- | --- |
| TM01 真实 scene geometry | Rules state/events/fold + Geometry Profile + Room archive/replay | 待新增真实 Room genesis→action→archive→new DO restore 纵切；既有 G01–G15 仅作算法底座 | **待实现**：不得以空 obstacles 或直接 fixture 冒充 |
| TM02 Viewer Tactical Projection | Rules `project(viewer)` + Room `observe` | 待新增不同 Viewer、隐藏实体/障碍不可区分和规范 schema 测试 | **待实现** |
| TM03 二维地图/文字 Adapter | authoritative table Read Model + `play-table.tsx` | 待新增组件/HTTP/浏览器测试 | **待实现**：静态示意不计 |
| TM04 阻挡/掩护/墙前传播 | Geometry Profile 计算，Tactical Projection 只公开已知结果 | G01–G15 局部 + 待新增真实 Room/页面纵切 | **实际（局部）**：算法有证据，产品投影/地图未证 |
| TM05 路径与区域输入 | 页面只提交 ordered path/origin/direction；Room Action→Rules `step` 重算 | 待新增无实际区域 `targetIds` 的 API/UI/Room 测试 | **待实现** |
| TM06 区域全目标集合 | Rules 使用完整权威空间；project 过滤 | 既有 area helper 局部 + 待新增 caster/ally/enemy/hidden/environment Room 测试 | **实际（局部）**：未证明真实 Room/Viewer |
| TM07 portal 三态 | EnvironmentDefinition/State + `step`/events/project/replay | 待新增 open/closed/destroyed 纵切 | **待实现** |
| TM08 destructible | EnvironmentDefinition/Ability/threshold + 权威随机/事件 | 待新增 intact/damaged/destroyed + rubble/cover/occupancy 纵切 | **待实现** |
| TM09 环境持续 zone | AbilityDefinition/Effect/Time + Room recovery | 待新增创建/持续/到期/中断/重连/replay exactly-once | **待实现** |
| TM10 elevation/height | Geometry Profile + movement/range/cover + projection | G01–G15 局部 + 待新增真实场景和 UI 标记 | **实际（局部）** |
| TM11 单一事务/状态 | Room Action→`step`→Room DO→`project/replay`；module guard | 待扩展 module check 和真实 vertical | **待实现** |
| TM12 隐藏状态不可区分 preview | `project(viewer, tacticalPreviewQuery)` | 待新增成对 WorldState/Room 公开响应规范等价测试 | **待实现** |
| TM13 双视口/无障碍 | in-app browser 或真实浏览器 DOM/视觉；同源 text fallback | 375px/1440px 待执行 | **待实现** |
| TM14 最终门 | 最终冻结 SHA 的行为 + module/type/lint/test/diff | Stage 5 统一执行 | **未满足** |

## 2. 原十个产品板块与新增战术地图板块追踪

| ID | 来源 | 用户可观察行为 | 权威事件 / 状态 | Viewer 投影 | 责任 Interface | 计划 / 实际测试文件 | 完成门证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 冻结 KP 责任 | Goal §二；`SPEC 0001` §§2–20、A–O | 玩家可提出任何世界内合理自然语言行动；KP 理解目标与做法、创造开放内容、扮演有限知识 NPC、推动并真实收束故事，而不是白名单翻译器或事后旁白；玩家始终控制自己的角色 | `RootAction`、KP 提案/修订、已固化事实、机械结果、NPC/势力计划、聚光灯与结局状态；Prompt 或封闭 DSL 不能成为正史 | 每名观察者只看其角色有权感知/知道的 `ViewerReadModel` 与当前回应；回应明确变化、可行动信息并交还决定权 | 已认证 API → Room Action → Room Authority → Rules `step` → 原子 `commit` → `project` → 提交后叙述 | **实际（有效）**：`authoritative-action` 7/7、Rules compound 18/18、production compound 1/1、`kp-multiturn-eval` production-validator 31/31。**实际（局部）**：KP Adapter 7/7 | **部分满足**：strict production typed ActionPlan 已把动态事实、有限知识 NPC、场景问题、随机和机械结果合并到同一 Root Action，compact DO 分支已清除；真实 Workers AI 与线上 table 闭环尚未验证 |
| P2 权威行动事务 | Goal §三.1、§四；`SPEC 0003` | 同一自由行动可澄清、等待玩家选择、等待 KP 修订、可靠重试；骰前参数冻结，刷新/重试不重复骰、扣资源或提交；冲突只影响相关作用域；错误可公开更正 | `RootAction`、`PreparedAction`、`PendingInput`、冻结提案、`RandomnessRequested` / `DiceRolled`、连续事件、scope heads、幂等 `PublicReceipt`、活动分支与更正记录 | 六种外层 Outcome、公开 Receipt、公开待决输入和专属 Read Model；错误/候选项不泄密 | Room Action；Rules `step/project/replay`；Room Authority `prepare/observe/commit/acknowledge/commitCorrection` | **实际（有效）**：Room Action 7/7；Rules compound 18/18；production compound 1/1；production-validator 31/31；记录的 Room 迁移组合 41/41（含随机恢复、retry、archive/correction 5/5） | **部分满足**：可信控制、严格提案/恢复 allowlist、幂等、作用域并发、零到多权威随机、Pending/重连、更正/灾难重建和六种 Outcome 已有证据；冻结 SHA 全量门仍待 |
| P3 KP 与非战斗机械 | Goal §三.2；`SPEC 0004`；`SPEC 0001` §§5–6、8、10、13、17、19 | 五类可行性裁决可区分；不可能与无意义行动不掷骰；检定、对抗、豁免、物品、资源、休整、Activity 和非战斗危险均先冻结风险/成本再结算；同情境裁定一致，原样失败不能无限重掷 | `FeasibilityRuled`、`ClarificationRequested/Answered`、`Check/Contest/SaveFrozen`、`RandomnessRequested`、`DiceRolled`、`CheckResolved`、物品/资源/Activity/Rest/Hazard/AdjudicationPrecedent 事件 | 骰前显示角色理应知道的风险与成本，不公开隐藏 DC/真相；Rules projector 同时给控制者 `restRecoveryOptions` 的合法上限、资格与预算；提交后显示真实资源、时间、状态和新局面 | Room Action 的 KP 可行性提案；Rules `step` 机械诊断/执行；Room DO 权威随机与提交；`project` | **实际（有效）**：world/campaign 7/7、Rules compound 18/18、Rules multiplayer 8/8、Room multiplayer 8/8、Room Action 7/7、combat mechanics 4/4。**实际（局部）**：table 10/10 | **部分满足**：五类裁决、资源/物件、Activity、个人/整队休整、有意义失败、非战斗危险及 production compound 已绿；save 的物品成本、2014 职业豁免熟练、HP/移动分支均在同一复合事务，Arcane Recovery UI 消费 Rules projector 的恢复候选并只冻结选择。完整裁定先例与线上浏览器仍待 |
| P4 世界事实与知识 | Goal §三.3；`SPEC 0005`；`SPEC 0001` §§3–4、7、9、16–17 | 动态现实在首次证据/引用/机械影响前固化；玩家能区分感官证据、角色推断和有来源主张；关系、承诺、债务、传闻与知识跨时间持续；分支/更正不静默改写历史 | `CanonicalFact`、`WorldEvent`、因果/来源/可见性；`FactDeclared/Changed/Ended`、`HiddenRealityCandidatesFrozen/Materialized`、`SensoryEvidenceAcquired`、`SourceClaimCreated`、`CharacterInferenceFormed`、`KnowledgeAcquired/Shared`、关系/承诺/债务与更正分支事件 | `project(viewer)` 只给该角色的事实、证据、主张、推断和知识；隐藏真相、来源内部依据和其他角色私密知识不可见 | Rules `step/project/replay`；Room Authority 原子提交/更正；Room Action 只以专属投影调用 KP | **实际（有效）**：world/campaign 7/7、observer projection 5/5、Rules compound 18/18、production compound 1/1、production-validator 31/31、archive/correction 5/5 | **部分满足**：生产动态事实、typed 知识/关系/承诺后果、世界内分享、非追溯、NPC/继任、跨章持续及审计更正已绿；冻结源码归档组合仍须重跑 |
| P5 模组、NPC 与势力 | Goal §三.4；`SPEC 0006`；`SPEC 0001` §§3–4、8、11、14、18 | 模组提供故事圣经、核心真相与开放留白，不是流程图；KP 可动态形成地点/实体/危险；NPC/势力只凭有限知识、目标和资源行动，能投降、逃跑、改变计划；封闭 DSL 不拒绝合理自由行动 | `ModuleBound/ModuleVersionMigrated`、`DefinitionRegistered`、`DynamicEntity/LocationMaterialized`、`NpcKnowledgeAcquired`、`NpcInferenceFormed`、NPC/势力计划与行动、敌对/投降/逃跑状态；Legacy Adapter 仅绑定旧版本 | 玩家只见已观察到的 NPC 行为和因果痕迹；NPC Viewer 不得收到玩家未暴露计划；KP 私密投影不向玩家泄露 | Room Action KP 提案/修订；Rules `step/project` 验证动态定义和 NPC 机械；Room Authority 提交；版本化 Module Adapter | **实际（有效）**：module/NPC 4/4、world/campaign 7/7、observer 5/5、opening 1/1、Rules compound 18/18、production compound 1/1、production-validator 31/31 | **部分满足**：Module hash/open blanks、开场单槽、真相隔离、有限知识 NPC 和生产动态定义/NPC 计划复合提交已绿；完整模组迁移与线上真实 KP 仍待 |
| P6 多人房间与虚构时间 | Goal §三.5；`SPEC 0007`；`SPEC 0001` §§11、15、19 | principal 来自可信会话；席位和角色控制权可授予、撤销、转移；掉线不自动 pass/推进时间；个人合法行动无需队长批准；分队和跨地点行动原子协调，聚光灯在自然决定点切换 | Member/Seat/CharacterControl/Host 事件、`ConnectionObserved`、`PendingInputReassigned/Suspended`、分队状态、地点时间线、`CausalFrontier`、`SpotlightLedger` 与相关 scope heads | 每个成员只见其位置、控制角色、私人窗口和可观察结果；掉线/换席/请离立即改变读取资格但不回补旧回应 | 已认证 room API；Room Action；Room Authority `prepare/observe/commit`；Rules `step/project` | **实际（有效）**：Rules/Room multiplayer 各 8/8、Rules compound 18/18 的六种 typed partyAction、observer 5/5、production-validator 31/31；记录的 Room 迁移组合 41/41。Legacy 9/9 只作旧房回归 | **部分满足**：service-only 房管、控制权/Pending、显式邀请/取消/离队/转领导/整队或个人移动、分地时间/因果前沿和 Spotlight 已绿；最终生产 HTTP/断线浏览器回归仍待 |
| P7 长团生命周期 | Goal §三.6；`SPEC 0008`；`SPEC 0001` §16、§18 | 成长选择由玩家确认；章节切换后物品、伤势、知识、关系、债务、承诺和威胁持续；死亡/退役不被自动复活；继任角色只获得合法世界内继承 | Campaign/Chapter/Downtime、XP/里程碑/成长、CharacterTenure、`CharacterDied/Retired/BecameNpc`、`SuccessorIntroduced`、`InheritanceTransferred/Rejected` 事件与版本清单 | 原角色、继任者和其他观察者分别看到其合法状态与知识；控制结束时 `successorRequired` 由可信 lifecycle Viewer 经同一 Rules projector 生成，继任者默认看不到前任知识 | Room Action 处理成长/继任待决选择；Rules `step/project/replay`；Room Authority 提交与恢复 | **实际（有效）**：world/campaign 9/9、Rules compound 19/19、Room multiplayer 8/8、observer 5/5、archive/correction 5/5 | **部分满足**：`milestone | srdXp2014`、完整累计阈值、生产 `awardExperience`、跨多级逐级玩家选择、回放/统一 lifecycle 投影/更正、章节/死亡/退役/继任、provenance、Room Authority 控制及灾难重建均已有证据；冻结源码全量/部署组合仍待 |
| P8 失败、节奏、收束与交互 | Goal §三.7；`SPEC 0009`；`SPEC 0001` §§11–13、15、17–19 | 失败造成相称状态变化和新局面；原样重掷被拒绝；现实等待不推进虚构时间；场景问题回答后切换；结局不被新幕后黑手撤销；玩家可选择尾声/续篇；所有结果使用统一 Read Model/Receipt | `SceneQuestionOpened/Answered/Transitioned`、`MeaningfulFailureCommitted`、`RetryConditionChanged`、`FactionPlanAdvanced`、`EndingCandidateRaised/Dismissed`、`StoryConcluded`、`EpilogueChoiceRecorded`、`SequelStarted`、安全暂停事件 | 公开后果、当前压力/机会、决定权、Receipt 与当前回应；私人代价/线索仍按 Viewer 投影；`concluded` 与续篇入口可区分 | Room Action/KP；Rules `step/project`；Room Authority；统一 `ViewerReadModel`、`PublicReceipt`、当前 DeliveryFrame | **实际（有效）**：world/campaign 7/7、Rules compound 18/18、production compound 1/1、runtime 10/10、production-validator 31/31 | **部分满足**：typed 有意义失败/重试门、势力推进、生产复合 SceneQuestion/机械、结局候选/收束/尾声/续篇已绿；真实 Workers AI 与线上 table 收束仍待 |
| P9 观察者专属呈现 | Goal §三.8；`SPEC 0010`；`SPEC 0001` §§9、12、14–17、19 | 个人线索默认私有；只能通过世界内行动分享，范围在提交时冻结且不追溯旧回应；每个 ViewerKey 最多一个当前帧；刷新/轮询/断线/重启恢复同一帧；ACK/覆盖/失权后正文不可回看；不存在完整 KP 旁白历史 | `AudienceSnapshot`、角色知识与 `KnowledgeShared`、每 ViewerKey 单槽 `DeliveryFrame`、ACK/superseded tombstone、投递幂等 Receipt、投影/呈现/协议版本 | 所有快照、增量、错误、候选、lifecycle `successorRequired`、休整恢复候选、重连、日志摘要、语音和转写复用同一 `project(viewer)`；缺席者与无权者得到 indistinguishable 的脱敏结果 | Rules `project`；Room Authority `observe/acknowledge` 与内部发布 capability；Room Action 提交后叙述；已认证 observe/ACK API | **实际（有效）**：observer projection 5/5、delivery 4/4、opening 1/1、Room multiplayer 8/8、Room Action 7/7、31/31 连续评测。**实际（局部）**：table 10/10 | **部分满足**：个人线索、世界内分享、统一 query/lifecycle/机械候选、单槽/ACK/覆盖/重连、开场与控制转移已绿；生产 HTTP/语音/转写和日志旁路仍待线上冒烟 |
| P10 可靠性、纠错、可观测性与评测 | Goal §三.9、§五、§六；`SPEC 0003` §§7–11；`SPEC 0005` §13；`SPEC 0011`；`SPEC 0013` | 同一请求可靠重试且不重复后果；模型/网络/Worker 故障停在稳定点；重启或归档重建后权威状态一致；更正公开且可审计；性能/成本在免费额度预算内；日志不含秘密；多轮 KP 行为达到阈值 | 故障分类、SLO/预算、幂等键与 Receipt、随机承诺及 canonical due-root journal、连续事件/哈希、版本清单、归档游标、活动分支/更正、白名单 telemetry 元数据、评测运行/评分记录 | 玩家只见稳定的公开失败、重试、当前状态和有权知道的更正；运维只见脱敏关联 ID、分类、耗时桶、版本与哈希 | Room Action 重试/模型恢复；Room Authority 恢复/幂等/更正；Rules `replay/project`；归档重建器；结构化 telemetry；多轮 eval runner | **实际（有效）**：runtime 10/10、production-validator 31/31、记录的 Room 迁移组合 41/41（含四阶段随机 4/4、archive/correction 5/5、retry 3/3）。**实际（局部）**：telemetry 4/4、table 10/10 | **未满足**：严格恢复/更正/归档主链已绿，到期 Activity 随机恢复须先验证 canonical 根与持久事件前缀；全生产日志调用点、增量归档最终重跑、真实 Workers AI、冻结 SHA 全量门、迁移/部署/推送仍须单独证明 |
| P11 权威战术空间与二维地图 | 用户追加 Goal 产品决定/完成标准；`SPEC 0014`；ADR-0012；协作 `SPEC 0003/0005/0010/0012/0013` | 玩家在简单二维图和同源文字读数中看到自身、可见单位、已知障碍/门/地形/持续区/占位/高度/掩护，提交有序路径或区域原点/方向；隐藏实体/障碍不从 preview/DOM/错误泄漏；地图不可用仍可操作 | scene geometry、实体 position/footprint/elevation/height、EnvironmentDefinition/State、portal/destructible/terrain/zone、实际通过路径、Ability/Effect、内部全目标集合、版本/Profile/branch 与连续 WorldEvent | `TacticalProjection` 由 `project(viewer)` 生成并同时供地图、文字、ARIA、preview；只含 Viewer 已知子集，GM geometry/实际隐藏 targets 留在 Rules/Internal | 地图/自然语言 → Room Action → Rules `step` → Room DO 原子提交/权威随机 → `project/replay`；preview 作为同一 projector query；页面只作 Adapter | **实际（局部）**：G01–G15 的 Geometry 算法底座。**待实现**：TM01–TM14 的真实 Room/UI/浏览器 runner | **未满足（新增硬阻塞）**：需完成环境状态、Tactical Projection/preview、路径/区域页面输入、门/破坏物/持续区/高度、隐藏不可区分、archive/replay、双视口及最终门 |

## 3. `SPEC 0001` A–O 验收追踪

下表按 §1 口径同时列出有效、局部与 RED 证据；“文件存在”本身不计通过。原 `SPEC 0002` 未曾批准且已被替代，不能作为 C、D、G 的实施或验收依据；相应机械以 `SPEC 0012` 和 `SPEC 0013` 为准。

| ID | 来源 | 用户可观察行为 | 权威事件 / 状态 | Viewer 投影 | 责任 Interface | 计划 / 实际测试文件 | 完成门证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A 非预写合理行动 | `SPEC 0001` §21.A；§§4–5、19；`SPEC 0003/0004/0006` | 模组未登记但合理的方法被理解；KP 直接成功或提出合法检定，不以缺少 Interaction 拒绝；结果持续存在 | `RootAction`、`FeasibilityRuled`、必要的动态定义/事实、冻结检定、提交事件与 Receipt | 行动者及现场观察者看到真实变化和后续选择；不出现命令白名单错误或内部候选 | 已认证意图 → Room Action → Rules `step` → Room Authority `commit` → `project` | **实际（有效）**：Room Action 7/7、world/campaign 7/7、module/NPC 4/4、Rules compound 18/18、production compound 1/1、production-validator 31/31 | **部分满足**：自由意图、直接成功/检定、开放留白与 production 复合语义已通过同一 Root Action；线上真实模型闭环未验证 |
| B 当前不可能行动 | `SPEC 0001` §21.B；§5；`SPEC 0004` | 徒手破坏既有事实中不可破坏结构时明确拒绝当前方法，并给出寻找工具/弱点/别路的可行动空间；不掷虚假高 DC | `FeasibilityRuled(worldLawViolation)`；可选澄清/前提说明；不得产生 `RandomnessRequested` | 只显示可公开世界依据和可行动方向，不泄露隐藏弱点 | Room Action KP 可行性裁决；Rules `step` 验证；`project` | **实际（有效）**：world/campaign 7/7 的五类裁决；Room Action 7/7 的无半提交；31/31 连续评测 | **部分满足**：Rules 已断言不可能行动不产生骰面/机械副作用；仍需生产 table 同场景冒烟 |
| C 激进风险路径 | `SPEC 0001` §21.C；§§3.4、8、10；`SPEC 0004/0012/0013` | 玩家无视可感知警告后可遇到远超队伍能力但合乎世界的危险；不按等级削弱；规则完整执行包括死亡 | 已固化警告/危险、`HazardDefined` 或动态敌人定义、冻结机械、DO 骰面、伤害/状态/死亡事件 | 骰前给出角色理应察觉的预兆而不公开隐藏数值；骰后给各观察者真实结果 | Room Action → Rules `step` 风险诊断/战斗机械 → Room Authority 随机/提交 → `project` | **实际（有效）**：world/campaign 7/7、combat 4/4、Rules/production compound 18/18 + 1/1、randomness recovery 4/4、production-validator 31/31 | **部分满足**：动态危险、警告、完整伤害/死亡、production compound 与崩溃随机恢复已有证据；“远超队伍且不按等级缩放”的专用线上场景仍待 |
| D 动态敌人不可执行 | `SPEC 0001` §21.D；§8；`SPEC 0003/0006/0012/0013` | 无效引用/行动经济/不可表达效果得到具体机械诊断，KP 修订后重提；仅数值高不能拒绝；玩家不看到虚假成功/非法结果 | `DefinitionRegistered` 前的诊断结果、`PendingInput(kpRevision)`、修订提案、合法动态实体和最终 Receipt；非法提案不提交世界后果 | 玩家仅见稳定等待或最终合法结果；内部错误、候选和秘密属性不泄露 | Room Action KP 修订循环；Rules `step` 诊断；Room Authority `prepare/commit`；`project` | **实际（有效/局部）**：`tests/ability-profile-v2.test.mjs` + combat A06 已映射 A01–A09；Room Action/module/compound 覆盖诊断→修订→无半提交 | **部分满足**：合法高数值不按队伍缩放已有 A05 公开向量；真实 Workers AI/线上修订闭环仍待 |
| E 门后多种可能 | `SPEC 0001` §21.E；§7；`SPEC 0003/0005` | 多种同样合理结果在开门/证据前由可信过程秘密固化；之后不随玩家 HP、选择或 KP 偏好更换 | `HiddenRealityCandidatesFrozen`、DO `RandomnessRequested/DiceRolled`、`HiddenRealityMaterialized`、动态定义/事实与固化时点 | 开门前看不到候选/选择；开门后只看到自己有权观察的已固化结果 | Room Action KP 候选；Rules `step`；Room Authority 权威随机/提交；`project` | **实际（有效）**：world/campaign 7/7、Room Authority 8/8、observer 5/5、randomness recovery 4/4 | **部分满足**：冻结、秘密投影、重试/崩溃同骰已有证据；专用 HP/后续选择变化不改已固化结果向量仍待 |
| F 感官证据与假传闻 | `SPEC 0001` §21.F；§9；`SPEC 0005/0010` | 敏锐角色得到真实火药味证据；NPC 的宝藏说法被标为有来源主张且可为假；允许调查/交叉验证 | `SensoryEvidenceAcquired`、原因 `CanonicalFact`、`SourceClaimCreated`（说话者/时间/动机/依据）、`KnowledgeAcquired` 及后续验证事件 | 有资格角色分别看证据和来源主张；其他角色、实时流与历史看不到其私人信息 | Room Action → Rules `step` 提交知识 → `project(viewer)` → observer delivery | **实际（有效）**：world/campaign 7/7、observer projection 5/5、delivery 4/4、31/31 连续评测 | **部分满足**：证据/主张、个人知识、世界内分享与多旁路隔离已有核心证据；生产 table/语音/转写 HTTP 旁路和更正后的来源链仍待验证 |
| G 致命陷阱 | `SPEC 0001` §21.G；§§8、10；`SPEC 0004/0012/0013` | 在已有危险和合理感知机会后触发炸药；按冻结触发、豁免、范围和伤害结算，允许死亡；不降伤害、不加第二层机关 | `HazardDefined/Triggered`、`SaveFrozen`、`RandomnessRequested/DiceRolled`、伤害/状态/死亡、环境后果 | 骰前显示角色理应知道的预兆和公开风险；骰后只投影现场结果与合法角色状态 | Room Action → Rules `step` hazard/save/damage → Room Authority 随机/提交 → `project` | **实际（有效）**：world/campaign 7/7、combat 4/4、randomness recovery 4/4、31/31 连续评测 | **部分满足**：预兆、冻结、豁免/伤害/死亡与崩溃随机恢复已有证据；专用炸药场景的完整 production Room 复合事务仍待 |
| H 无意义检定 | `SPEC 0001` §21.H；§§5–6；`SPEC 0004` | 普通未锁门且无风险时直接成功并推进场景，不要求骰点 | `FeasibilityRuled(directSuccess)`、必要的门/位置/场景事实；不得产生随机请求 | 显示门已打开及新的感官/可行动信息 | Room Action KP 裁决；Rules `step` 提交直接结果；`project` | **实际（有效）**：Room Action 7/7、world/campaign 7/7、Rules compound 18/18 的 `resolveDirectConsequences`、Room Authority 8/8 | **部分满足**：无随机、typed 后果、一次提交与提交后叙述已有 Interface 证据；具体未锁门浏览器场景尚未冒烟 |
| I 有意义失败 | `SPEC 0001` §21.I；§13；`SPEC 0004/0009` | 失败造成相称状态变化并形成新路线/选择；不能原状返回并要求同骰，也不保证原目标仍可达成 | `CheckResolved(failure)`、`MeaningfulFailureCommitted`、时间/资源/关系/危险等变化、`RetryConditionChanged` | 显示真实损失/变化和当前可行动局面，不伪造保底成功 | Room Action → Rules `step` → Room Authority `commit` → `project`; 后续相同意图查询 Receipt/先例 | **实际（有效）**：world/campaign 7/7、Rules compound 18/18、production compound 1/1、production-validator 31/31、Room retry 3/3 | **部分满足**：typed 相称失败、原样重试门与 production consequences 已绿；真实模型/线上场景仍待 |
| J 玩家停滞 | `SPEC 0001` §21.J；§11；`SPEC 0006/0007/0009` | 玩家不知道下一步时先重新定向，再给既有事实支持的机会/预兆；现实思考/离线不推进虚构时间，不传送回主线 | 当前 `SceneQuestion`、线索/威胁 Read Model、合法 NPC/势力计划；只有到期条件满足才有 `FactionPlanAdvanced` 等世界事件 | 当前处境、已知线索、逼近事项和可互动对象按 Viewer 呈现；未到期威胁不被伪造 | Room Action/KP；Room Authority `observe`（无世界推进）；到期行动才经 Rules `step/commit`；`project` | **实际（有效）**：runtime 10/10、world/campaign 7/7、31/31 连续评测 | **部分满足**：停滞不推进与多轮重新定向已有证据；专用“先重定向再施压”评分项及 production table 离线场景仍待冒烟 |
| K NPC 知识边界 | `SPEC 0001` §21.K；§14；`SPEC 0005/0006/0010` | 未发现玩家计划的敌人不能针对性反制；获得世界内信息后才可响应 | `NpcKnowledgeAcquired`、`NpcInferenceFormed`、NPC 计划/行动及其来源；玩家秘密知识保持独立 | NPC Viewer 只含其感官/知识/推断；玩家只见 NPC 已采取行动和可观察痕迹，不见内部计划 | Room Action KP 使用 NPC 专属 `project`；NPC 行动经 Rules `step` 和 Room Authority `commit` | **实际（有效）**：module/NPC 4/4、observer 5/5、world/campaign 7/7、Rules/production compound 18/18 + 1/1、production-validator 31/31；**局部** KP Adapter 7/7 | **部分满足**：NPC 专属 Viewer、有限知识行为和 production NPC/动态事实/机械同事务已绿；真实模型线上行为仍待 |
| L 含糊的重大意图 | `SPEC 0001` §21.L；§5；`SPEC 0003/0004/0007` | 重大危险、显著成本、攻击同伴或不可逆歧义先向原玩家澄清；确认后不反复劝阻并按规则执行；系统不代答 | `RootAction(awaitingClarification)`、`ClarificationRequested/Answered`、只属于原玩家的 `PendingInput`、确认后冻结/提交 | 只有控制该角色的可信 principal 看到问题和选项；他人、错误和重连不泄露；重复回答幂等 | 已认证 intent/answer → Room Action → Room Authority `prepare/commit` → Rules `step/project` | **实际（有效）**：Room Action 7/7、Room Authority 8/8、Room multiplayer 8/8、observer 5/5、31/31 连续评测 | **部分满足**：重大歧义不代答、同 RootAction 回答、重连与多人换席 Pending 重分配/暂停已绿；最终 HTTP 回归仍待 |
| M 多人聚光灯 | `SPEC 0001` §21.M；§15；`SPEC 0007/0010` | 分头行动时在自然决定点切镜头；长期未获决定权者被邀请；每名玩家自行决定角色；私人回应只给现场有权者 | `SpotlightLedger`、地点时间线、`CausalFrontier`、控制权、`AudienceSnapshot`、每 ViewerKey DeliveryFrame | 各玩家只见其地点、角色知识和当前回应；缺席者不能从实时/历史/重连/候选/语音补看 | Room Action 调度；Room Authority 作用域提交/observe；Rules `step/project`；observer delivery/ACK | **实际（有效）**：31/31 连续评测、Rules multiplayer 8/8、Room multiplayer 8/8、observer 5/5、delivery 4/4 | **部分满足**：真实 Seat/Control、原子分队、独立 FictionTimeline/CausalFrontier、Spotlight≤3 与私人 Audience 已绿；线上断线/浏览器仍待 |
| N 规则或事实错误 | `SPEC 0001` §21.N；§17；`SPEC 0003/0005/0010` | 未提交错误被废弃重做；已提交错误公开说明可公开部分，以前向补偿或审计分支更正；不静默重写，不借说明泄密 | `CorrectionApplied` 或 `CorrectionBranchOpened/BranchActivated`、`correctionId`、superseded 闭包、旧事件/骰面/Receipt、失效/替换 DeliveryFrame | 有权玩家看到错误、正确规则、影响与更正结果；秘密依据仍不可见；无权 Viewer 看不到秘密更正 | 授权 `commitCorrection`；Rules `replay/project`；Room Authority 原子更正；Room Action 生成更正后回应 | **实际（有效）**：记录的 `tests/archive-correction-v2.test.ts` 5/5 覆盖灾难重建/篡改拒绝、opaque capability、前向补偿及正式 Dice/位置/知识后果触发因果分支 | **部分满足**：核心更正/审计责任已转绿；随后源码仍在演进，最终冻结 SHA 和线上更正呈现仍须重跑/冒烟 |
| O 故事已经结束 | `SPEC 0001` §21.O；§18；`SPEC 0008/0009` | 核心冲突真实解决后展示长期后果并收束，不追加幕后黑手撤销胜利；玩家可选尾声、续篇或新冒险 | `EndingCandidateRaised`、`StoryConcluded`、`Chapter/CampaignConcluded`、长期后果事实、`EpilogueChoiceRecorded`、`SequelStarted` | 各角色看其合法长期后果、尾声选择和明确 `concluded` 状态；续篇与旧故事边界可辨 | Room Action 结局协调；Rules `step/project`；Room Authority `commit`；成长/章节待决选择 | **实际（有效）**：world/campaign 7/7、Rules compound 18/18、production-validator 31/31 连续评测，Room Action 覆盖 `concluded` Outcome | **部分满足**：typed `raiseEndingCandidate/concludeStory/recordEpilogueChoice` 与直接 `startSequel` 边界已绿；真实 Workers AI/table 生产团收束仍待线上验证 |

## 4. Legacy 与无效替代证据

以下测试可帮助理解旧实现，但不能证明新规则版本满足本矩阵。重构后可以保留在明确的 Legacy Adapter 套件中，不能用其绿色结果抵扣 P1–P11 或 A–O。

| 现有证据 | 静态位置 | 不计入原因 |
| --- | --- | --- |
| `tests/rules-kernel.test.mjs` | 8–13、34–36 | 对外导入并直接调用 `applyEvents`；绕过 Room Authority 原子提交、幂等 Receipt 与真实恢复路径 |
| `tests/rules-kernel.test.mjs` | 63、367、401、452（以及同类位置） | 直接修改 `WorldState`/portal/ruleset 等内部状态来建立前提，不能证明前提由权威事件产生 |
| `tests/rules-kernel.test.mjs` | 85–92（以及同类 `resolveRoll` 用例） | 测试直接提供骰面，不能证明 Room DO 的权威随机、冻结、重试复用或审计承诺 |
| `tests/spells.test.mjs` | 15–19、66–68，以及后续直接 roll 用例 | 直接 `applyEvents` 且由测试提供机械随机；只可作为旧规则原语迁移证据 |
| `tests/room-do.test.ts` | 223–233（以及同类命令） | 旧接口允许调用方提供 `actorId`、全局 `expectedVersion` 和 `initiativeRolls`；不能证明可信 principal、作用域并发或 DO 权威骰源 |
| `tests/action-ruling.test.mjs` | 4–7、51–64 | 直接调用旧 `resolveActionRuling` helper；没有经过已认证意图、KP 提案、Rules、Room DO 提交和 Viewer 投影 |
| `tests/location-clue-projection.test.mjs` | 10–39 | 明确期望玩家可查看曾到访地点的 KP 旁白历史，与 `SPEC 0010` 的单槽和不可回看合同冲突 |
| `tests/interaction-contract.test.mjs` | 7–9、19–55（及同类断言） | 读取源码并匹配字符串/导出；能发现代码表面漂移，不能证明产品运行行为、权限或秘密边界 |
| `tests/upstream-parity.test.mjs` | 40–53 | 文件哈希能证明选定文件未漂移，不能证明开房、建卡、语音、线索、资源、分头、休整、战斗等用户路径无回归 |

可保留的局部候选证据：`tests/rendered-html.test.mjs` 55–169 从实际 Worker HTTP 路径验证匿名 401、邮箱会话、开房、错误密码和登出撤销；176 行以后还有部分房主权限场景。它仍未进入新 Room Action/Rules/Viewer 事务，所以只可在相同源码状态实际运行通过后计入身份与房间管理回归，不能证明任何 P1–P10 核心玩法行完成。

## 5. 测试运行器与当前证据门

当前 `package.json` 定义 `npm test = build + test:unit + test:worker`；`test:unit` 收集 `tests/**/*.test.mjs`，`vitest.config.ts` 收集 `tests/*.test.ts`。本节只记录已有回执；生产源码继续变化后，必须由最终 `npm test` 在同一冻结 SHA 上重跑，不能拼接不同源码时点的局部绿色结果冒充最终全量门。

| 顺序 | 当前证据 | 状态与下一实现门 |
| ---: | --- | --- |
| 1 | Room Action 7/7；记录的 Room 迁移组合 41/41 | 外层编排、SQLite DO 权威链、service routing、四阶段随机、retry、Delivery、archive/correction 与恢复 allowlist 已绿；最终冻结 SHA 仍须组合重跑 |
| 2 | runtime 10/10；world/campaign 7/7；Rules compound 18/18；production compound 1/1；combat 4/4 | `step/project/replay` 主链和 strict production typed ActionPlan 已绿；直接后果、复合 save、六种 partyAction、Activity、休整、失败与生命周期不再是旧 RED，真实模型/线上链另计 |
| 3 | observer projection 5/5；delivery 4/4；opening 1/1；table 10/10 局部 | 单槽、ACK、覆盖、统一 query、开场与 UI 语音后 ACK 已有证据；生产 HTTP/浏览器/语音/转写旁路仍待最终冒烟 |
| 4 | module 4/4；KP Adapter 7/7；production-validator 31/31 连续交互 | Module/NPC 有限知识、strict production schema/normalizer 和 20+ 评测数量/阈值已绿；真实模型线上调用未由脚本评测替代 |
| 5 | Rules multiplayer 8/8；Room multiplayer 8/8 | service-only 管理、Seat/Control、原子整队/离队/休整、分地 FictionTimeline/CausalFrontier/Spotlight 已绿；最终 HTTP/断线浏览器回归仍待 |
| 6 | archive/correction 5/5（记录的 Room 迁移回执） | 导出、灾难重建、篡改拒绝、前向补偿与正式后果驱动的因果分支均绿；后续源码演进后仍须在冻结 SHA 重跑 |
| 7 | telemetry 4/4 局部 | 固定白名单 serializer 已绿；仍需审计所有生产日志调用点并在冒烟日志中证明无 Cookie/Token/Prompt/真相/私人内容泄漏 |

多轮评测最低门统一为 Goal 要求的 **20+**。当前 `kp-multiturn-eval.test.ts` 已有 31/31 连续已认证意图或待决回答并达到其记录阈值；每轮 fixture 先通过 production `validateProposal` 与 projection-bound。production compound 1/1 也已转绿，但两者仍不替代最终真实模型、table/API 与部署冒烟。

## 6. Goal 完成门证据账本

该账本只描述还必须回填的证据，不替代 `docs/refactor-log.md` 的命令、退出码、部署和推送记录。

| 完成门 | 所需证据 | 当前状态（2026-08-27 证据更新时） |
| --- | --- | --- |
| `SPEC 0001` 不变 | 冻结文件内容/状态与基线哈希或 diff 核对 | **当前切片已核对**：SHA-256 仍为 `b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be`，目标文件 diff 为空；最终冻结 SHA 前仍须再核对一次 |
| 原十板块、追加战术地图与 A–O 无未归属项 | 本矩阵 P1–P11、TM01–TM14 和 A–O 每行均有来源、状态、投影、Interface 与测试映射 | **结构映射已列出；P11/TM01–TM14 明确为新增未满足硬阻塞，不能被既有 Geometry helper 抵扣** |
| `SPEC 0002` B01–B53 有明确处置 | 单独的逐条处置记录、替代规格交叉审查与实现映射 | **规格与公开测试映射已建立**：`0002-disposition-matrix.md` 逐条处置，本矩阵 §1.2 无编号缺口地映射生产责任与真实 runner；冻结全量/线上门仍须按实际结果清零 |
| 单一权威事务/机械/投影/回放 | 架构检查 + A–O/各规格行为测试，且无外部 fold/骰子/D1 第二状态 | **部分证据**：Rules、Room Action、Room Authority、strict compound、multiplayer、randomness/recovery、archive/correction、observer 与 B53 vertical 已有公开 seam 证据；compact DO 分支已清除，最终生产接线仍须冻结门证明 |
| 长团、继任与个人知识 | P7、P9、O17 的跨章节、死亡/退役/继任、合法继承测试 | **部分证据**：world/campaign 9/9、Rules compound 19/19、Room multiplayer 8/8、observer 5/5 与结构化灾难重建/更正 5/5 已绿；两种成长 Profile 与 XP 完整阈值已覆盖，冻结源码/部署组合仍待 |
| 私人信息完整旁路 | `SPEC 0010` O01–O18 与实时/历史/重连/错误/候选/日志/语音/转写矩阵 | **部分证据**：projection 5/5、delivery 4/4、opening 1/1、Room multiplayer 8/8、table 10/10 局部与 31 轮评测已绿；生产 HTTP/语音/转写/日志冒烟仍缺 |
| 随机、幂等、故障、恢复、回放、更正 | P2/P10/N 的 DO、归档、分支和模型失败测试 | **部分证据**：最新 randomness/recovery/contest 3 files / 24 tests、Room retry 3/3 与 archive DO resume 2/2 已覆盖并发首写、多波、旧 journal、journal 篡改拒绝、scene settlement lock、幂等 Receipt 和归档续传；既有 correction 证据仍须在冻结源码重跑，远端 D1 及线上检查仍待 |
| 20+ 多轮 KP 评测 | 单一连续评测轨迹、验收阈值、逐轮 Receipt/Viewer 证据和评分 | **数量、production validator 与已记录阈值满足**：单场景 31/31，逐轮 `validateProposal`/projection-bound，production compound 1/1；仍不能据此宣称真实 Workers AI/整站完成 |
| 未涉及上游能力无回归 | 开房、席位、建卡、语音、线索、装备、职业资源、分头、组队、休整、战斗的真实用户路径 | **局部证据**：authoritative table 10/10、Room multiplayer 8/8、opening 1/1 与 Legacy Room 9/9；仍缺冻结源码上的完整用户路径/浏览器回归 |
| 战术地图 TM01–TM14 | SPEC 0014 场景 1–14、真实 Room/archive/replay、Viewer indistinguishability、地图/文字/ARIA、375px/1440px、最终冻结门 | **未满足**：现有 G01–G15 只计 Geometry 算法底座；环境状态、投影、UI 和浏览器纵切尚未实现 |
| 本地验证命令 | `module:check`、`typecheck`、`lint`、`npm test`、`git diff --check` 的源码 SHA、命令、退出码 | **未满足**：局部切片命令已有回执；生产源码冻结后的同一 SHA 全量门尚未运行/通过 |
| 迁移、部署、冒烟、日志、推送 | 必要迁移状态与闭环、Cloudflare version/流量/URL/冒烟/日志、`DEPLOY_SOURCE_SHA`、`DELIVERY_SHA`、远端 `cloudflare` SHA、远端 `main` 前后 SHA | **未满足**：尚未完成必要远端迁移、正式部署、流量确认、生产冒烟/日志检查与显式 refspec 推送 |

在上述状态全部转为有实际证据的“满足”之前，本矩阵不得被用于宣告 `COMPLETE`。
