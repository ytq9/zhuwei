# 本 Goal 自主裁定登记册

- 状态：进行中；实现与测试证据在相应检查实际通过后回填。
- 日期：2026-08-26
- 授权来源：用户 Goal 明确授权在不修改、不缩小、不绕过冻结 SPEC 0001 的前提下，自主裁定板块 2–10。
- 约束：不得以“现有代码容易实现”为产品理由；“待实现/待验证”不等同于已通过。

观察者呈现的 OBS-D001–OBS-D005 已完整记录在 `SPEC 0010` 第 16 节，本登记册引用而不重复。

## DEC-001：拆分 SPEC 0002

- 决策 ID：DEC-001
- 日期：2026-08-26
- 问题：是否直接批准包含通用事务与战斗机械的 SPEC 0002。
- 来源类别：Goal 明确决定 + SPEC 0001。
- 关联 SPEC 0001：§1、§2、§19、§22；A–O 全部。
- 候选方案：直接批准；只改状态；拆出通用协议并以纯战斗规格取代。
- 最终选择：原 0002 保持“未曾批准”并标记被 0003–0013 取代；通用事务先于纯战斗裁定。
- 理由：自由、非战斗、战斗、NPC 与 Activity 必须共享一条事务，不能由战斗特例反向定义产品。
- 玩家可观察行为：所有自然语言行动共享相同等待、重试、投影与 Receipt 语义。
- 秘密与权限影响：通用 Viewer/Principal 规则覆盖所有行动，不留战斗旁路。
- 迁移/可逆性：原草案保留审计；替代规格可版本化演进，不改冻结 0001。
- 验收场景：追踪矩阵 A–O、B01–B53 disposition 完整。
- 测试证据：`0002-disposition-matrix.md` 已逐项处置 B01–B53，规格索引、交叉审查与 P1–P10/A–O 追踪矩阵均已建立；最终冻结源码的文档/全量门仍须重跑。

## DEC-002：两个深 Module 与唯一 Interface

- 决策 ID：DEC-002
- 日期：2026-08-26
- 问题：机械与房间编排应公开多少入口。
- 来源类别：Goal 目标架构 + SPEC 0001。
- 关联 SPEC 0001：§2、§19–§22；A、D、N。
- 候选方案：按战斗/休整/法术拆协调器；公开内部 fold；Room Action + Rules 两个深 Module。
- 最终选择：外层 `handleRoomAction`；内层只公开 `step/project/replay`。fold/apply/随机/机械原语为私有 Implementation。
- 理由：小 Interface 能统一所有行为与测试，消除调用者拼装第二权威。
- 玩家可观察行为：不同动作得到一致的结果代数、恢复和投影。
- 秘密与权限影响：所有外发领域内容只走 project；外层必须携可信上下文。
- 迁移/可逆性：旧接口保留于显式 Legacy Adapter；新版本包入口收深。
- 验收场景：模块静态检查、A、B、D、B41、B53。
- 测试证据：`npm run module:check` 已在多个实现切片通过，当前脚本验证 Rules 公开值严格只有 `step/project/replay`、外层无私有 v2 导入/随机/旧活跃状态 SQL，并新增 strict Room proposal/recovery 护栏；最终冻结 SHA 仍须再运行一次。

## DEC-003：根行动与六类外层结果

- 决策 ID：DEC-003
- 日期：2026-08-26
- 问题：模型失败、澄清、待决和结局如何跨请求表达。
- 来源类别：Goal 固定不变量 + SPEC 0001。
- 关联 SPEC 0001：§5、§17–§19；L、N、O。
- 候选方案：HTTP 成败二元；战斗专属状态；持久 RootAction + 判别式结果。
- 最终选择：`committed | awaitingInput | needsKp | retryableFailure | rejected | concluded`；根行动持久保存原意图、状态和 Receipt。
- 理由：技术失败与世界内失败必须分开，掉线/重试不得代玩家行动。
- 玩家可观察行为：玩家能区分等待自己、等待 KP、可重试、被拒绝与已结局。
- 秘密与权限影响：公开结果不暴露 KP 诊断和其他人的待决。
- 迁移/可逆性：新协议仅用于新 ruleset；Legacy 响应经 Adapter 映射但不冒充新 Receipt。
- 验收场景：L、N、O、B02、B16、B31。
- 测试证据：`tests/authoritative-action.test.mjs` 7/7 已覆盖六类 Outcome 与提案修订；记录的 Room 迁移组合 41/41 覆盖幂等、Pending、retry、随机恢复与 committed/rejected 路径；最终冻结组合门仍待。

## DEC-004：作用域版本取代全局 expectedRevision

- 决策 ID：DEC-004
- 日期：2026-08-26
- 问题：如何兼顾同房间强一致与分头并发。
- 来源类别：Goal 固定不变量 + SPEC 0001 多人要求。
- 关联 SPEC 0001：§15、§16、§19；M。
- 候选方案：全房间 revision 锁；Worker 预估命令作用域；Rules 证明实际闭包。
- 最终选择：全局 eventSeq 只审计；Rules `scopeProof` 是读写/新建闭包唯一来源，DO 比较相关 scopeRevision。
- 理由：无关地点不应互相冲突，DO 也不应复制机械依赖算法。
- 玩家可观察行为：无关分支可继续；争夺同一实体/物件时只有合法事务提交。
- 秘密与权限影响：隐藏依据可作为秘密作用域参与证明但不暴露 ID。
- 迁移/可逆性：旧 expectedVersion 留在 Legacy；新事件保存作用域版本。
- 验收场景：M、B26、B51。
- 测试证据：`tests/room-authority-v2.test.ts` 8/8、`tests/rules-multiplayer-v2.test.mjs` 8/8 与 `tests/multiplayer-room-v2.test.ts` 8/8 已覆盖无关作用域并发、相关冲突、分队与分地因果；最终 HTTP 组合仍待。

## DEC-005：DO 两阶段权威随机协议

- 决策 ID：DEC-005
- 日期：2026-08-26
- 问题：骰面如何在崩溃、重试和幂等下保持唯一。
- 来源类别：Goal 固定不变量 + SPEC 0001 §6。
- 关联 SPEC 0001：§6–§8、§10、§17、§19；C、D、G、N。
- 候选方案：页面/模型掷骰；Worker 函数先掷后 commit；DO 先提交请求再提交骰面与后果。
- 最终选择：Rules 请求；DO 先提交 RandomnessRequest，再用 Web Crypto 生成候选并在房间 SQLite 的内部幂等 journal 原子固定，最后在独立事务提交 DiceRolled/后果/Receipt。journal 不进 D1、投影或日志；最终事件提交后，事件流仍是可回放权威。
- 理由：请求、候选和结果三个稳定点可以分别恢复；候选一旦 journal 提交便不因 Worker 驱逐重掷，同时不把未完成骰面变成客户端或 D1 的第二权威。
- 玩家可观察行为：重试/重启不变骰、不重复扣资源；DC/风险骰前冻结。
- 秘密与权限影响：秘密骰只投影允许摘要；候选不进日志/D1 独立表。
- 迁移/可逆性：旧自带骰命令只在 Legacy；新规则拒绝客户端骰面。
- 验收场景：C、G、N、B27、B50。
- 测试证据：当前 `tests/randomness-recovery-v2.test.ts` 12/12、`tests/combat-room-randomness-v2.test.ts` 11/11 与 `tests/contest-room-randomness-v2.test.ts` 1/1 合计 24/24；覆盖单波/多请求/多波、候选首写、旧 journal、不重掷、篡改拒绝和对抗骰，累计多波协议见 DEC-034。

## DEC-006：事实单一、知识按角色取得

- 决策 ID：DEC-006
- 日期：2026-08-26
- 问题：秘密事实和角色知识如何持久且不复制真相。
- 来源类别：SPEC 0001 冻结原则 + Agent 协议裁定。
- 关联 SPEC 0001：§7、§9、§16；E、F、K、M、N。
- 候选方案：房间 flag；每玩家事实副本；单一 CanonicalFact + CharacterKnowledge 关系。
- 最终选择：事实一份、可见性策略一份；每角色以来源链取得证据/主张/推断/知识。
- 理由：同一真相不漂移，同时允许不同主体知道不同内容。
- 玩家可观察行为：个人线索持续、物件毁坏不抹知识、传闻保留来源且可能错误。
- 秘密与权限影响：房主/队长不自动获得；NPC 只看自身知识。
- 迁移/可逆性：旧全局 clue 只能作为公开 Legacy 事实，不能猜测私有所有者。
- 验收场景：E、F、K、M、O01–O06。
- 测试证据：`tests/world-campaign-v2.test.mjs` 7/7、`tests/observer-projection-v2.test.mjs` 5/5 已通过；前者覆盖取得、世界内媒介分享及来源链，后者证明缺席者/继任者不能从投影取得未分享知识或旧叙述。

## DEC-007：故事圣经与 Legacy 防火墙

- 决策 ID：DEC-007
- 日期：2026-08-26
- 问题：如何保留旧模组又不让封闭 DSL 限制自由行动。
- 来源类别：Goal 明确决定 + SPEC 0001。
- 关联 SPEC 0001：§3–§5、§18、§20；A、E、O。
- 候选方案：继续白名单；删除旧模组；旧 DSL 只作锚点/Legacy Adapter。
- 最终选择：新模组是 Story Bible + Open Blanks；DSL 仅供 genesis 锚点和明确旧版本回放。
- 理由：保留既有内容与旧房可回放，同时允许 KP 动态世界创作。
- 玩家可观察行为：合理未登记行动被裁决，路线和结局不被流程图锁死。
- 秘密与权限影响：模组 truth 与开放候选只在 KP/内部投影。
- 迁移/可逆性：未知版本明确拒绝，不自动落入 Legacy；旧房不迁移即保持旧解释器。
- 验收场景：A、E、O、B01、B41。
- 测试证据：`tests/runtime-profiles-v2.test.mjs` 10/10 与 `tests/module-npc-v2.test.mjs` 4/4 已覆盖精确 Profile/Legacy fail-closed、Module hash/open blanks 与合理非目录行动；真实模型/线上模组仍待。

## DEC-008：NPC 只能由 KP 基于有限知识选择

- 决策 ID：DEC-008
- 日期：2026-08-26
- 问题：模型失败或 NPC 回合是否允许默认战术。
- 来源类别：Goal 固定不变量 + SPEC 0001 §14。
- 关联 SPEC 0001：§11、§14、§19；J、K、M。
- 候选方案：第一攻击/最近/最低 HP；战术优化器；KP 用 NPC Viewer 提案。
- 最终选择：删除所有默认选择和自动 pass；KP 只看 NPC 专属投影，提案再走同一 Rules/DO 链。
- 理由：NPC 的错误、恐惧、目标和未知是故事事实，协调器无权替代。
- 玩家可观察行为：NPC 可攻击、误判、撤退、投降或等待；模型失败停在稳定点。
- 秘密与权限影响：NPC 不读 KP 全知或玩家秘密。
- 迁移/可逆性：Legacy 自动战术仅旧版本；新版本没有备用路径。
- 验收场景：J、K、B23、B24、B31。
- 测试证据：`tests/module-npc-v2.test.mjs` 4/4、observer 5/5、Rules compound 18/18 与 production-validator 31/31 评测已覆盖 NPC 有限知识、无秘密计划反制和同事务 NPC 行动；真实 Workers AI 仍待。

## DEC-009：Spotlight Beat 与虚构时间/因果前沿分离

- 决策 ID：DEC-009
- 日期：2026-08-26
- 问题：分头叙述公平与规则时间如何同时成立。
- 来源类别：SPEC 0001 + 已接受 ADR-0002 + Goal 多人要求。
- 关联 SPEC 0001：§11、§15–§16；J、M。
- 候选方案：每拍固定分钟；全房间单一时钟；分支时间线 + 因果前沿。
- 最终选择：Beat 只调度镜头且最多领先三拍；秒/轮/Activity 独立推进；分支经 CausalFrontier 传播/会合。
- 理由：谈话、旅行、战斗和休整不能共享等长拍，现实等待也不能推进。
- 玩家可观察行为：分头公平切镜；不同地点可有不同时间且未来事实不泄漏。
- 秘密与权限影响：未到因果前沿的他处分支结果不可见。
- 迁移/可逆性：新 Profile；旧拍时钟仅 Legacy。
- 验收场景：J、M、B26、B29、B47。
- 测试证据：`tests/rules-multiplayer-v2.test.mjs` 8/8、`tests/multiplayer-room-v2.test.ts` 8/8 与 31/31 连续评测已覆盖分支时间、CausalFrontier、会合和 Spotlight≤3；并发 Encounter 的完整组合仍待。

## DEC-010：长团成长 Profile

- 决策 ID：DEC-010
- 日期：2026-08-26
- 问题：无完整 TableContract 编辑器时如何支持长期成长。
- 来源类别：Goal 明确长团方向 + D&D 5e 2014。
- 关联 SPEC 0001：§16、§18；O。
- 候选方案：固定三级；只里程碑；Campaign genesis 选择 SRD XP 或里程碑 Profile。
- 最终选择：新 Campaign 固定 `srdXp2014 | milestone`；资格不自动代玩家选择成长；随机 HP 走 DO。
- 理由：支持不同长团风格而无需当前实现完整桌规编辑器，且选择权归玩家。
- 玩家可观察行为：成长资格与来源可审计，跨重启只应用一次。
- 秘密与权限影响：个人成长选择只向控制者待决；公开结果按 Viewer。
- 迁移/可逆性：策略切换需显式迁移事件；旧三级人物保持 Legacy。
- 验收场景：Campaign 验收 1、章节切换与 20+ 轮评测。
- 测试证据：`tests/world-campaign-v2.test.mjs` 9/9、`tests/rules-compound-action-v2.test.mjs` 19/19 与 `tests/multiplayer-room-v2.test.ts` 8/8 已通过；覆盖 `milestone | srdXp2014` genesis 固定、完整 1–20 级累计阈值、正整数奖励边界、`ExperienceAwarded` 回放/投影/更正、跨多级时逐级等待玩家选择，以及 Room Authority 重试及只应用一次。冻结源码全量门仍单列。

## DEC-011：继任角色默认零自动继承

- 决策 ID：DEC-011
- 日期：2026-08-26
- 问题：同一玩家的新角色能继承旧角色哪些内容。
- 来源类别：Goal 明确要求 + SPEC 0001 连续性/秘密。
- 关联 SPEC 0001：§9、§16–§18；F、K、M、O。
- 候选方案：全部复制；玩家账户知识复制；只通过已提交世界内链路继承。
- 最终选择：物品、知识、关系、债务、承诺、职位、资源默认均不自动继承；遗嘱、交接、实际取得、公开记录等逐项授予。旧角色控制结束后，`successorRequired` 由可信 lifecycle Viewer 经同一 Rules projector 产生，不由 Room 服务或页面拼装第二份生命周期状态。
- 理由：角色是世界实体，同一现实玩家不等于同一世界认知/所有权。
- 玩家可观察行为：死亡或退役后原控制者看到最小、可恢复的继任入口；继任者仍需在世界内取得遗产和介绍，旧角色后果继续存在。
- 秘密与权限影响：旧私人线索不按账户泄漏；安全偏好可在玩家层持续。
- 迁移/可逆性：新增继承事件可补充，不需改旧历史；错误继承走更正。
- 验收场景：O17、Campaign 验收 3–6。
- 测试证据：`tests/world-campaign-v2.test.mjs` 的公开 projector 场景与 `tests/multiplayer-room-v2.test.ts` 的死亡/退役 Room 场景覆盖统一 `successorRequired` lifecycle；既有 observer/world 证据继续证明继任者默认零知识/物件继承并只接受带 provenance 的逐项转移。

## DEC-012：当前回应单槽且不可回看

- 决策 ID：DEC-012（详细记录见 SPEC 0010 OBS-D003–D005）
- 日期：2026-08-26
- 问题：可靠送达是否会变成 KP 聊天历史。
- 来源类别：Goal 明确要求 + Agent 协议裁定。
- 关联 SPEC 0001：§9、§12、§15、§17；M、N。
- 候选方案：永久历史；有界消息队列；每 Viewer 当前单槽。
- 最终选择：Audience 提交时冻结；每 Viewer 一个未确认帧；ACK/覆盖后正文不可取，事实/知识持续；普通角色、`successorRequired` lifecycle 与机械恢复候选均复用同一 Rules projector。
- 理由：同时满足刷新/断线恢复与不为缺席者补看。
- 玩家可观察行为：只能恢复当前回应，不能翻阅完整 KP 旁白。
- 秘密与权限影响：后来入场/入席不回补，语音/转写同样失效。
- 迁移/可逆性：不导入旧消息；扩大历史需修改产品规格并重新授权。
- 验收场景：O01–O18。
- 测试证据：observer delivery/projection 与 authoritative table 的记录切片覆盖单槽/ACK/覆盖/刷新重连、统一查询投影与语音后 ACK；world/campaign、Room multiplayer 及 table 还覆盖统一 lifecycle 与 Rules 派生的 `restRecoveryOptions`。最终线上语音/转写旁路仍由发布冒烟证明。

## DEC-013：更正采用补偿或因果分支

- 决策 ID：DEC-013
- 日期：2026-08-26
- 问题：已提交错误如何纠正而不偷偷改历史。
- 来源类别：SPEC 0001 §17 + Goal 更正要求。
- 关联 SPEC 0001：§17；N。
- 候选方案：编辑旧事件；总是前向补偿；按后继选择决定补偿或分支。
- 最终选择：无后继选择依赖则补偿；死亡/位置/资源/秘密/选择已分歧则开新分支并 supersede 因果闭包。
- 理由：既保持审计又恢复当前一致性，不假装错误从未发生。
- 玩家可观察行为：收到可公开错误说明和正确当前状态；必要时重新选择。
- 秘密与权限影响：只有更正权威执行；秘密依据经 Viewer 隔离。
- 迁移/可逆性：旧分支永久保留；活动分支可再经新更正前进。
- 验收场景：N、B33、B45。
- 测试证据：记录的 Room 恢复迁移组合 16/16 已通过，其中 `tests/archive-correction-v2.test.ts` 5/5 覆盖灾难重建、篡改拒绝、opaque capability、前向补偿与正式 Dice/位置/知识后果触发的因果分支；随后生产源码仍在演进，最终冻结 SHA 必须重跑该套件。

## DEC-014：DO 活跃权威，D1 只作目录/静态卡/可重建归档

- 决策 ID：DEC-014
- 日期：2026-08-26
- 问题：D1 是否保留新规则活跃位置、资源、知识、战斗和待决镜像。
- 来源类别：Goal 固定不变量 + 已接受 ADR-0003。
- 关联 SPEC 0001：§2、§7、§16–§17；E、N。
- 候选方案：双写；D1 主权威；每房 Room DO 主权威且归档可重建。
- 最终选择：新 ruleset 绝不从 `game_states/messages/session_logs` 读写活跃规则事实；D1 `room_event_archive` 只追加副本。
- 理由：双写无法原子并产生漂移；房间是自然协调原子。
- 玩家可观察行为：重试、分头、唯一物件和待决状态一致。
- 秘密与权限影响：D1 玩家查询无原始事件/私人旁白入口。
- 迁移/可逆性：旧 D1 仅 Legacy；归档可从 DO 重建，灾难恢复反向重建需授权。
- 验收场景：E、M、N、归档重建。
- 测试证据：`tests/archive-correction-v2.test.ts` 5/5 已在记录的 Room 恢复迁移组合中通过结构化灾难重建/篡改拒绝；`tests/archive-do-resume-v2.test.ts` 与 `tests/archive-d1-batches-v2.test.mjs` 已建立增量续传/白名单行为门。后两者及最终 D1 远端迁移闭环以冻结源码/阶段 5 实际命令为准，当前没有把 migration 文件存在写成远端已应用。

## DEC-015：版本注册表和未知版本 fail closed

- 决策 ID：DEC-015
- 日期：2026-08-26
- 问题：非当前版本是否自动进入 Legacy 分支。
- 来源类别：Goal 固定不变量 + SPEC 0001 变更规则。
- 关联 SPEC 0001：§1、§16–§17；N。
- 候选方案：当前常量否则 Legacy；部署时迁移全部；明确 Rules Registry。
- 最终选择：只增 Registry 以完整 manifest 精确映射 interpreter；default 只创建新 genesis。既有房的 replay 从 genesis 选解释器，step/project 核对完整 manifest 与 state `runtimeManifestRef`；未知、不匹配或错 hash 明确拒绝，绝不自动 current/Legacy。当前 Projection Policy `projection-observer-safe-v1` 1.2.0 固定为 `sha256:9312f68960f1c53f79b5c95bfd8c95ab87aec903603796f455a6c1d2d4514d8c`，完整 manifest 固定为 `sha256:2f7af76e9a7262675210c18528ca9c6bead5c676aecc71113304eaf01f42dbe9`，canonical genesis golden 固定为 `sha256:7e858e340283252d67779ddb1ae773fb5ac5a98d3859fdcef467c58a34935355`。
- 理由：否则旧房会被错误解释或 D1 第二权威接管。
- 玩家可观察行为：旧房稳定回放；不支持版本显示明确可恢复错误。
- 秘密与权限影响：错误只暴露公开版本码，不输出内部定义。
- 迁移/可逆性：每次新规则新增注册项；旧解释器保留到安全归档/迁移完成。
- 验收场景：B32、B40、B52。
- 测试证据：`tests/runtime-profiles-v2.test.mjs` 当前 13/13，覆盖 canonical Profile/manifest/genesis golden、当前/历史/Legacy/未知/错 hash、state pin 不匹配、2014/2024 护栏，并以隔离合成第二 manifest 证明切换 default 后旧 archive 的 replay/project 不变而仅新 genesis 采用新 default；`getRoomManagement` 已返回 `ruleset_version` 供精确服务路由，冻结源码 HTTP/全量组合仍待最终门。

## DEC-016：公开 DeepSeek 模型与房间固定 Profile

- 决策 ID：DEC-016
- 日期：2026-08-26；2026-08-28 因创建期模型选择补充；2026-08-28 按用户明确要求改回 DeepSeek。
- 问题：新规则默认/可选 KP 模型、房间 Profile 固定和成本失败语义。
- 来源类别：Goal 不自动升级付费要求 + 用户明确要求前端只提供两个 DeepSeek 模型 + DeepSeek 官方 API/模型资料 + 既有生产探针。
- 关联 SPEC 0001：§2、§19–§20；A–O。
- 候选方案：继续公开 GLM/Gemma；公开 DeepSeek 但仍调用 Workers AI；公开并真实调用 DeepSeek、把其他候选仅保留为服务端历史兼容 Profile。
- 最终选择：新 ruleset 默认使用 `deepseek-v4-flash`，创建桌子时还可选择 `deepseek-v4-pro`；公开模型目录严格只包含这两个模型。创建请求同时固定 model id 与 `modelProfileVersion`，创建后不可更换；实际 DeepSeek 调用与 `ModelInvocationReceipt` 必须精确使用该组合。此前已固定的 GLM/Gemma Profile 只在服务端继续解释旧房间，不进入公开目录、不显示真实模型名，也不允许新房间提交其 ID。额度、容量或超时仍返回 retryableFailure；配置/权限错误 fail closed；任何失败均不自动切换模型、不推进世界或降为命令翻译器。
- 理由：用户明确指定产品只公开两个 DeepSeek 模型；现网 GLM、Gemma 与对照 Workers AI 调用均在 45 秒生产 envelope 内超时，而现有 Worker 的 `DEEPSEEK_API_KEY` secret 仍存在。公开选项与实际权威调用必须一致，内部验证候选不得泄漏为产品选项。
- 玩家可观察行为：房主在创建桌子前只看见 DeepSeek V4 Flash / Pro，入桌后只读显示已固定的 DeepSeek 模型；历史房间只显示通用兼容文案。模型暂不可用时行动保持可恢复，不伪造 NPC/玩家选择。
- 秘密与权限影响：只向模型发送 KP Viewer；不记录 Prompt/原文。
- 迁移/可逆性：不新增 schema 或 migration。既有 `rooms.kp_model_profile` 的 GLM 回填值保留为历史绑定，旧房间按精确 model/profile 继续运行；不静默迁移或改写已提交事实。新房间写入 DeepSeek Profile；未知组合 fail closed。
- 验收场景：模型额度、容量、失败恢复、20+ 轮评测。
- 测试证据：DeepSeek 官方 Chat Completions 文档列出 `deepseek-v4-flash`、`deepseek-v4-pro` 与 tool calls。`tests/deepseek-authoritative-provider.test.mjs` 覆盖 tool request、token 参数转换、Abort、402 与缺密钥失败；`tests/rendered-html.test.mjs` 覆盖页面只显示两个 DeepSeek、拒绝隐藏 Workers AI ID、Profile 持久化和创建后不可变；authoritative adapter/table/Room retry 回归覆盖精确 Profile、脱敏分类与失败不提交。这些本地证据不替代部署后的代表性 DeepSeek 真实调用。

## DEC-017：验收 seam 与 Legacy 测试隔离

- 决策 ID：DEC-017
- 日期：2026-08-26
- 问题：现有直接 applyEvents/改状态/喂骰测试能否证明新产品。
- 来源类别：Goal 阶段 2 明确要求 + TDD Interface 原则。
- 关联 SPEC 0001：A–O。
- 候选方案：沿用内部单测；全 E2E；按责任 Interface 的垂直切片。
- 最终选择：Rules 只测 step/project/replay；Room Authority 测公开 RPC/重启；Room Action 从认证意图测试；跨层用真实生产 seam。旧绕路测试只标 Legacy characterization。
- 理由：测试必须能因第二权威或权限绕过而失败，又能定位责任。
- 玩家可观察行为：验收覆盖真实意图、等待、恢复、投影与收束。
- 秘密与权限影响：每个秘密场景至少含一个无权 Viewer 和所有旁路。
- 迁移/可逆性：旧测试可保留在 legacy 套件；新门只计新 Interface 证据。
- 验收场景：A–O、B disposition、O01–O18、20+ 轮评测。
- 测试证据：Rules、Room Action、Room Authority、observer、compound、multiplayer、archive/correction 与 31/31 连续评测均已建立公开责任 seam 证据；Legacy 直接 state/骰面测试仍在追踪矩阵明确不计，最终冻结发布门尚未执行。

## DEC-018：生产 KP 提案采用有类型的复合 Action Plan

- 决策 ID：DEC-018
- 日期：2026-08-26
- 问题：一次玩家行动同时形成动态事实、场景问题、NPC/势力反应与机械结算时，生产 KP 应提交任意开放 JSON、多个独立事务，还是一个有类型的复合语义计划。
- 来源类别：Goal 固定事务链 + SPEC 0001 叙事/机械权威边界 + Agent 协议裁定。
- 关联 SPEC 0001：§§2–10、§§13–15、§19；A、C–G、I、K、M。
- 候选方案：继续接受任意 `mechanicalProposal` 并由 Room 猜测；把每个叙事/机械结果拆成可部分成功的独立提交；以判别式语义操作组成一个 `ActionPlan`，由一次 Rules `step` 整体诊断或执行。
- 最终选择：生产 KP schema 只允许版本化、判别式语义操作；一个计划可包含主行动机械、骰前动态定义、场景问题，以及基于各自有限知识的因果同步 NPC/势力动作。无骰的直接后果使用 `resolveDirectConsequences`，故事/章节生命周期使用 `advanceCampaignLifecycle`，不得靠通用 JSON outcome 或 Room 特判补写。Rules 对完整计划生成一份 scope proof 和零到多条权威随机请求；任何子项非法则整份计划不提交并返回机械诊断。已到期但先于当前意图发生的 NPC/Activity 仍按 SPEC 0003 形成独立、因果关联的内部 Root Action。
- 理由：开放世界要求内容可动态生成，不等于机械协议可以任意；有类型的复合计划既不把 LLM 降为命令白名单，也避免 Room Adapter 丢字段、猜语义或产生部分提交。
- 玩家可观察行为：一次行动的世界变化、NPC 可观察反应、检定结果、时间/资源和新场景问题要么共同提交，要么保持原状态等待 KP 修订；不会出现“骰子成功但动态危险/NPC 反应消失”的半结果。
- 秘密与权限影响：动态定义按 visibility policy 固化；每个 NPC 子动作只能引用该 NPC Viewer 的知识；玩家看不到内部定义、NPC 计划、DC 或诊断。Principal、actor、骰面、Profile、事件和状态补丁永不属于模型 schema。
- 迁移/可逆性：为 production proposal schema、Rules Action Plan 和事件类型分别固定版本；authoritative-v2 Room 不接受紧凑提案，旧紧凑协议只存在于精确命中的 Legacy ruleset/Adapter，不能成为第二生产协议。新增语义操作通过新版本扩展，旧房按原 Profile 回放。
- 验收场景：完整 production proposal 经 Room Action → Rules → DO 随机/原子提交，事件在同一 Root Action 下包含动态定义、有限知识 NPC 计划、场景问题和机械结果；任一伪知识/骰面/actor/未知操作均无部分副作用。
- 测试证据：`tests/authoritative-kp-adapter.test.mjs` 7/7、`tests/rules-compound-action-v2.test.mjs` 18/18、`tests/compound-action-v2.test.ts` 1/1 已通过：schema/normalizer fail closed，动态定义/NPC/场景/双随机/机械结果同一 Root Action 原子提交；多随机崩溃恢复仍由可靠性专项门单独证明。

## DEC-019：新房开场使用模组固定公开文本的在场者单槽投递

- 决策 ID：DEC-019
- 日期：2026-08-26
- 问题：authoritative-v2 新房启动时如何保留上游开场旁白，又不创建 D1 消息历史、自动替玩家行动或泄露给不在场者。
- 来源类别：Goal 保留未涉及上游能力 + SPEC 0001 观察者边界 + SPEC 0010 单槽合同。
- 关联 SPEC 0001：§§3、9、12、15、19；A、M。
- 候选方案：不显示开场；写入 D1 `messages`；把开场伪装成首名玩家行动；从固定 Module Profile 的 `publicOpening` 建立逐在场 Viewer 当前 Delivery。
- 最终选择：初始化完成后只向位于模组开场 scene、且拥有有效控制权的角色分别投递 Module Profile 已钉住的 `publicOpening`；它是当前呈现而非玩家行动或正史消息，不推进虚构时间、不产生完整历史。刷新/DO 重启恢复同槽，ACK/覆盖后正文不可取；从结构化归档灾难重建时不重造已逝开场回应。
- 理由：开场是必要的用户定向体验，但其可靠缓存不能变成缺席者补看的聊天记录，也不能把系统叙述归因给玩家。
- 玩家可观察行为：开场地点的玩家进入桌面即可看到且可听取当前开场；其他地点或后来加入者不会补看；确认后只能依靠持续的结构化事实/知识继续游戏。
- 秘密与权限影响：只使用已审查的公开开场层；KP truth、场景隐藏定义和其他 Viewer 内容不进入帧。语音必须按当前 delivery id 再校验 Viewer 权限。
- 迁移/可逆性：仅新 ruleset 初始化采用；Legacy 继续旧消息路径。更换开场文本必须发布新 Module Profile/hash；移除投递不改权威世界事件。
- 验收场景：两名开场在场者各得独立 delivery id，同文但无互相标识；异地者得到 `none`；刷新/重连相同，ACK 后 history/voice/transcript 均不可取。
- 测试证据：`tests/authoritative-opening-v2.test.ts` 1/1 已通过；初始化、逐 Viewer 单槽、重连与 ACK 后不可回看均经 Room Authority 验证，且归档不含 Delivery。

## DEC-020：直接后果与 Campaign 生命周期是 ActionPlan 的封闭语义操作

- 决策 ID：DEC-020
- 日期：2026-08-26
- 问题：直接成功产生知识/关系/承诺/虚构时间，以及提出结局、真实收束、尾声与续篇时，生产 KP 应如何表达，才能既开放叙事又不把任意状态补丁交给模型或 Room。
- 来源类别：Goal 目标架构与长团/收束明确方向 + SPEC 0001 冻结责任 + Agent 协议裁定。
- 关联 SPEC 0001：§§5–7、9、13、16、18–19；A、F、H、I、O。
- 候选方案：让模型返回开放 `outcome`/事件数组；由 Room 根据叙述关键词补写状态；把每种具体后果拆成多个根行动；在版本化 ActionPlan 中提供有限、判别式 `resolveDirectConsequences` 与 `advanceCampaignLifecycle`。
- 最终选择：`resolveDirectConsequences` 只接受冻结的耗时/成本和有类型 consequence effects，由 Rules 转换为知识、关系、承诺、资源、位置、NPC 警觉及虚构时间等权威事件；空 effects 只允许提交真实虚构时间，不制造通用“成功事实”。`advanceCampaignLifecycle` 只接受登记的 lifecycle action，其中 `raiseEndingCandidate` 必须引用固化依据，`concludeStory` 必须引用已存在候选，`recordEpilogueChoice` 必须来自该玩家角色的明确选择，`startSequel` 必须使用新 Story/Chapter ID 与旧事实/未决威胁锚点。所有变体仍经同一 `step → Room DO commit → project` 事务。
- 理由：这些变化是可回放的产品语义而非任意 JSON；封闭操作让 Rules 可以验证权限、因果与版本，又不限制 KP 在字段内容和世界锚点内作真正叙事裁决。
- 玩家可观察行为：直接成功会真实改变相应知识/关系/承诺/时间；结局候选不会自动代玩家结束故事，收束后明确返回 `concluded`，尾声与续篇只有在玩家选择后发生，续篇与旧故事边界清晰。
- 秘密与权限影响：私人知识和尾声选择按角色 Viewer 投影；KP 不能提交 principal/actor、骰面、事件、状态补丁或替玩家选择尾声/续篇。NPC 影响仍只依据对应 NPC Viewer。
- 迁移/可逆性：操作名、字段和事件 schema 随 ActionPlan/ruleset 版本固定；旧房只用旧 Adapter。新增生命周期变体需新版本；已提交错误走补偿/因果分支，不静默改历史。
- 验收场景：直接后果在一个 Root Action 内产生精确 typed events；纯等待只推进虚构时间；无效/额外字段整笔拒绝；结局依据→收束→玩家尾声→显式续篇保持不同 ID、连续性与 Viewer 边界。
- 测试证据：`tests/rules-compound-action-v2.test.mjs` 18/18 已通过，覆盖直接后果、纯虚构时间、结局候选/收束/尾声、六种队伍动作与全部非检定 operation 注册；`tests/world-campaign-v2.test.mjs` 7/7 已通过，覆盖 `startSequel` 的新 Story/Chapter/锚点边界；`tests/authoritative-kp-adapter.test.mjs` 7/7 与 `tests/compound-action-v2.test.ts` 1/1 证明生产 schema 与 Room Action 复合事务。当前没有把直接 Rules `startSequel` 场景误记为专门的 compound translation 断言。

## DEC-021：Arcane Recovery 使用玩家冻结的多槽位规范选择

- 决策 ID：DEC-021
- 日期：2026-08-26
- 问题：2014 Wizard 的 Arcane Recovery 如何在权威短休中表达多枚 1–5 环法术位选择，同时保留玩家控制并防止 UI 结算第二份机械。
- 来源类别：Goal 玩家控制/唯一权威事务要求 + D&D 5e 2014 / SRD 5.1 机械 + Agent 协议裁定。
- 关联 SPEC 0001：§§2、5–6、10、16、19；H、L、N。
- 候选方案：沿用旧 `arcane: 0|1|2`；由 KP 或系统自动挑最优槽位；只提交总环数由 Rules 任意分配；提交规范 `arcaneRecoverySlotLevels: number[]` 由玩家逐槽选择。
- 最终选择：authoritative-v2 的 `restNow` 与休整 Pending 只使用排序后的 `arcaneRecoverySlotLevels`；每项必须是 1–5 的整数，可重复，数量不得超过对应当前/最大槽位缺口，总环数不得超过 `ceil(characterLevel / 2)`，且角色仍有每日一次 `arcaneRecovery`。非空选择只允许短休。Rules projector 在玩家专属 Read Model 中产出 `restRecoveryOptions` 的生命骰上限、奥术恢复资格、预算和各环最大可选数量；UI 只消费这些候选并冻结玩家选择，Rules 在休整 Activity 达到完成点后再次验证并结算。旧 `arcane?: 0|1|2` 只留精确 Legacy Adapter。
- 理由：2014 机械允许把预算分配给多个槽位；显式数组保留玩家选择并能表达重复低环槽，Rules 仍拥有预算、资源、时间与最终恢复的唯一机械权威。
- 玩家可观察行为：符合资格的法师可在短休时对 1–5 环缺失槽位逐个增减，看到预算/已选总环数；不能超预算、超缺口或在长休选择。提交后休整未完成前不恢复法术位，中断不落地效果。
- 秘密与权限影响：只有控制该角色的可信 principal 能提交/回答其休整选择；其他玩家看不到私人 Pending 或未公开资源细节。客户端不提交角色等级、资源上限、结算结果或骰面。
- 迁移/可逆性：新字段随 authoritative ruleset/event schema 固定；旧 scalar 不转换成新房状态，也不进入新分支。若未来桌规改变预算或允许更高环，必须发布新 Profile/ruleset；当前事件可按原版本回放。
- 验收场景：三级法师在存在一环/二环缺口时可选择 `[1,1]` 或 `[2]`，但不能选择超预算、0/6/小数、超缺口或每日资源已用尽；个人/整队短休均冻结同一规范选择，长休拒绝非空数组；完成一小时 Activity 后才恢复且只消耗一次资源。
- 测试证据：`tests/world-campaign-v2.test.mjs` 覆盖 Rules projector 的 `restRecoveryOptions` 与短休完成结算；`tests/authoritative-table-v2.test.mjs` 覆盖 UI 消费投影的 1–5 环缺口/预算、重复/混合选择、规范 server payload 与 Legacy 隔离；`tests/multiplayer-room-v2.test.ts` 覆盖个人 `[3,1,1]` 规范化、DO 权威短休随机、整队 Pending、长休拒绝、失败/重试不提前结算。

## DEC-022：authoritative-v2 只接受完整生产提案与版本化恢复输入

- 决策 ID：DEC-022
- 日期：2026-08-26
- 问题：Room Authority 是否继续把测试/迁移期 compact proposal 直接解释为 Rules 命令，以及随机崩溃恢复时是否允许反序列化任意历史 `rulesInput`。
- 来源类别：Goal 单一行动事务/清除平行路径/恢复不变量 + SPEC 0001 机械与状态权威边界 + Agent 协议裁定。
- 关联 SPEC 0001：§§2、5–8、17、19；A、D、L、N。
- 候选方案：继续在 DO 内维护 compact 分支；让 normalizer 同时猜测新旧载荷；authoritative-v2 只接收完整 production draft，并把恢复输入限制为当前版本 ActionPlan 或同版本待决续接。
- 最终选择：`normalizeRoomKpProposal` 只接受经 `validateProposal` 完整验证的 `authoritative-kp-proposal-v2` draft，或 Room 自己生成且键集合精确的 `authenticatedPendingAnswer` capability；随后只产生 `authoritative-kp-action-plan-v1` 的 `resolveCompoundActionPlan` 或投影后的 Pending。authoritative-v2 DO 删除所有 compact proposal kind 分支。持久随机恢复只允许 `resolveCompoundActionPlan(actionPlanVersion=v1)`，或 `answerPendingInput`（其可选 proposal 也必须是同一版本 ActionPlan）；完整性 hash 不符或形状越界一律停在可恢复失败。
- 理由：只验证首次模型响应而在 DO/恢复处保留旧语义，会使崩溃重启成为第二条机械协议；同一严格边界必须覆盖首提、待决回答和持久 continuation。
- 玩家可观察行为：自由、非战斗、战斗、NPC、Activity 与队伍动作在首次提交和崩溃恢复后都保持同一结果语义；旧 compact 请求不会悄悄成功或在重启后走不同机械，而是得到稳定拒绝/恢复失败。
- 秘密与权限影响：模型/caller 不能借 `rootActionId`、authority/state/event/profile、骰面或任意 Rules input 注入内部 capability；Pending capability 只能由已认证 Room continuation 形成，错误不回显其内容。
- 迁移/可逆性：旧 compact 行为仅由精确旧 `ruleset_version` 的 Legacy Adapter 承担；若未来 ActionPlan 变更，发布新版本和显式恢复 Adapter，不能放宽 v1 allowlist 或按 latest 猜测。
- 验收场景：production draft 正常归一化；compact kinds、额外 Pending 字段和 schema 注入均拒绝；随机请求 journal 后驱逐再恢复仍只执行同一版本 ActionPlan；源码门禁止 DO 重新出现 compact 分支。
- 测试证据：`tests/authoritative-kp-adapter.test.mjs` 7/7 已通过严格 normalizer/compact 拒绝/精确 Pending capability；`tools/check-modules.mjs` 已加入 compact 分支与恢复 allowlist 静态护栏。最终冻结源码上的 `npm run module:check` 仍须随全量门重跑。

## DEC-023：非战斗豁免复用复合事务、2014 职业熟练与统一后果

- 决策 ID：DEC-023
- 日期：2026-08-26
- 问题：`resolveNoncombatSave` 应只是返回成功布尔值，还是与非战斗检定一样冻结物品/资源成本、耗时、成功/失败后果，并使用角色职业的 2014 豁免熟练。
- 来源类别：Goal 同一权威行动事务 + SPEC 0001 公正骰前冻结/真实后果 + D&D 5e 2014 / SRD 5.1 机械。
- 关联 SPEC 0001：§§2、6、8、10、13、17、19；C、G、I、N。
- 候选方案：独立 save helper 只算 d20；借技能熟练近似；把成本/HP/移动交给 Room 或叙述后补；让 save 与 check 共用 `CompoundResolutionPlan`。
- 最终选择：`resolveNoncombatSave` 必须在骰前冻结 ability、DC、mode、duration、`frozenCosts`、success effects 与 failure effects；Rules 从角色静态卡编译的 class/profile 计算 2014 豁免熟练，而不读取技能熟练。物品成本在随机请求事务中只扣一次，成功/失败分支在权威骰后分别提交 HP、移动、知识或其他 typed effects；伤害/HP 仍复用统一状态与事件管线。
- 理由：豁免是危险强制反应，不是技能检定；把成本或 HP 留到 Room/叙述层会造成骰前参数漂移、恢复重复扣除和非战斗第二伤害路径。
- 玩家可观察行为：玩家在骰前知道可公开风险与成本；战士等角色按实际职业豁免熟练获得修正；无论成功或失败，已冻结的物品、时间、HP 与位置后果只应用一次且可回放。
- 秘密与权限影响：客户端/KP 不提交最终 modifier、骰面或 HP 结算；隐藏 DC/危险依据仍按 Viewer 策略投影，只有 Room DO 生成骰面。
- 迁移/可逆性：首个 authoritative Profile 固定当前支持职业的 2014 save proficiency 映射；新增职业或桌规必须发布 Profile/ruleset 版本，旧房不按新映射重算。Legacy save helper 只服务旧版本。
- 验收场景：战士体质豁免加入 proficiency bonus 而空技能表不影响；优势骰、一次性撬棍成本和失败 HP/移动同一 Root Action；成功只应用成功分支；非法/不可用成本整笔零事件拒绝。
- 测试证据：`tests/rules-compound-action-v2.test.mjs` 18/18 已通过，其中三组 save 场景覆盖物品成本、优势、战士熟练、当前支持的六职业熟练映射、失败 HP/移动及成功分支；最终 Room 崩溃恢复组合仍由全量/可靠性门证明。

## DEC-024：队伍协调的六种语义动作必须显式判别

- 决策 ID：DEC-024
- 日期：2026-08-26
- 问题：`changeParty` 是否可根据 `memberRefs` 有无猜测邀请/离队，或由模型提交明确队伍动作。
- 来源类别：Goal 多人控制权/个人合法行动不经队长批准 + SPEC 0001 玩家能动性 + Agent 协议裁定。
- 关联 SPEC 0001：§§5、15、19；L、M。
- 候选方案：按字段形状推断；拆回六个 Room 特判命令；在 ActionPlan 中冻结 `partyAction` 判别值并映射到同一 multiplayer Rules Module。
- 最终选择：production `changeParty` 必须显式选择 `inviteMember | cancelInvitation | leave | transferLeadership | proposeMove | moveIndividually`。每个变体使用自己的精确字段/控制权/待决规则；Room 不再猜测语义，整队移动仍逐控制者同意，个人离队/移动保持原子自主。
- 理由：字段推断会把重大多人意图变成协调器默认选择；六个判别值让 KP 表达玩家真实目标，同时由 Rules 拥有权限、位置、时间与 Pending 的唯一机械解释。
- 玩家可观察行为：玩家可以邀请/取消、主动离队、转交队长、发起整队移动或个人移动；系统不会因遗漏字段把一个动作静默解释成另一个，也不会让队长代成员移动。
- 秘密与权限影响：邀请/整队同意只投影给正确控制者；房主、队长、模型和请求体不能伪造控制权或回答他人 Pending。
- 迁移/可逆性：六值集合随 ActionPlan v1 固定；新增队伍语义需新版本或兼容扩展。旧 compact Room 命令仅在 Legacy ruleset 可达。
- 验收场景：六个变体全部经 `resolveCompoundActionPlan → step/project/replay`；取消引用投影中的 pending id；整队移动缺同意不提交；个人移动离队且不移动其他成员。
- 测试证据：`tests/rules-compound-action-v2.test.mjs` 18/18 已通过，其中一组连续场景覆盖全部六值、Pending、领导权、整队移动和原子分队；Room/API 的最终冻结源码回归仍须全量门证明。

## DEC-025：房主管理 Read Model 显式返回房间规则版本

- 决策 ID：DEC-025
- 日期：2026-08-26
- 问题：管理/API 调用方如何在不读取活跃 D1 状态的前提下，可靠区分 authoritative-v2 与精确 Legacy 房间并选择正确服务 Adapter。
- 来源类别：Goal 版本固定/Legacy 隔离要求 + SPEC 0001 版本与服务端权威边界 + Agent 技术裁定。
- 关联 SPEC 0001：§§1、16–17、19；N。
- 候选方案：仅返回 `kp_model` 并推断；前端按新功能存在猜测；在房主管理目录 Read Model 中返回 D1 目录已有的 `ruleset_version`。
- 最终选择：`getRoomManagement` 对已重新鉴权的房主返回目录字段 `ruleset_version` 与 `kp_model`；调用方必须先按精确版本路由 authoritative-v2 或 Legacy，未知版本 fail closed。该字段只用于 Adapter 选择/管理呈现，不赋予页面解释事件或读取 DO 秘密状态的权力。
- 理由：模型 ID、房间年龄或字段形状都不能替代版本事实；显式目录版本可阻止新旧服务命令混用，同时不建立活跃状态镜像。
- 玩家可观察行为：房主管理页和服务操作使用房间实际版本，不会把 authoritative-v2 动作落到 Legacy D1 路径；普通成员仍不能调用房主管理接口。
- 秘密与权限影响：规则版本是可公开目录元数据，但接口仍要求可信会话与房主权限；返回值不含 WorldState、事件、Prompt、私密知识或内部 Profile payload。
- 迁移/可逆性：复用既有 `rooms.ruleset_version`，不新增资源或第二状态；旧客户端忽略新增返回字段仍可读取其他管理信息，未知版本必须明确报错。
- 验收场景：authoritative-v2 房主查询得到精确版本与固定模型；普通成员查询被拒；table/server 后续服务分支以该版本先行选择。
- 测试证据：`app/_runtime/lib/table/server.ts` 已从房间目录选择并返回 `ruleset_version`；`tests/rendered-html.test.mjs` 已加入房主成功与普通成员拒绝断言。该 HTTP 测试及最终冻结发布门仍须在同一源码上实际重跑后才计为完成门证据。

## DEC-026：待决玩家选择保存稳定 choice ID，且只由控制者回答

- 决策 ID：DEC-026
- 日期：2026-08-26
- 问题：开放叙事产生多个合法、后果不同的选择时，是否允许客户端回传自由文本或数组位置。
- 来源类别：Goal 待决/恢复/玩家控制要求 + SPEC 0001 玩家能动性 + Agent 协议裁定。
- 关联 SPEC 0001：§§5、12、15、17、19；A、L、M、N。
- 候选方案：自由文本重解释；数组序号；冻结 `choiceId + label + consequence` 并精确回答。
- 最终选择：`playerChoice` 在提交时冻结稳定 choice ID、公开标签和已承诺后果；只有该角色当前可信控制者可提交精确 `choiceId`，伪造/过期回答拒绝且不关闭窗口。
- 理由：数组顺序和再次调用模型都会改变选择语义；稳定 ID 才能在断线、恢复和幂等重试中保持玩家原选择。
- 玩家可观察行为：页面显示当前仍有效的封闭选择；刷新后选择相同，错误答案不会替玩家选择或让窗口消失。
- 秘密与权限影响：候选只经控制者 Viewer；无权者不知道选项数量、内容或答复，principal 不从请求体自报。
- 迁移/可逆性：只用于 authoritative-v2；Legacy 自由文本响应留在旧 Adapter。未来改变选择 schema 需新事件版本。
- 验收场景：待决精确回答、伪造 ID、错误控制者、断线恢复、幂等重复及更正恢复。
- 测试证据：`tests/rules-pending-v2.test.mjs` 5/5、`tests/authoritative-table-v2.test.mjs` 10/10、`tests/room-authority-v2.test.ts` 9/9 的记录切片通过；冻结源码仍须全量重跑。

## DEC-027：已提交增量先按事件前后在场事实冻结 Audience，再统一投影

- 决策 ID：DEC-027
- 日期：2026-08-26
- 问题：移动、分队或同一事务改变在场关系时，当前回应增量应按提交前还是提交后在场者投递。
- 来源类别：Goal 观察者专属呈现 + SPEC 0001 知识/多人/连续性 + SPEC 0010。
- 关联 SPEC 0001：§§7、9、12、15–17；E、F、M、N。
- 候选方案：只看事务前；只看事务后；按事件语义冻结前/后 Audience 候选并由同一 projector 过滤。
- 最终选择：离开/出发事件的现场回应使用提交前 Audience，抵达/进入事件使用提交后 Audience；其他事件按其固化场景。增量、Receipt、KP 后续叙述和 Delivery 都消费同一观察者安全投影。
- 理由：只看一侧会让离开者漏掉自身离场或让原地点缺席者看到抵达；事件语义边界能同时保留因果和秘密。
- 玩家可观察行为：在场角色可靠收到自己亲历的离开/抵达；不在场者不会从轮询、重连或历史增量补看另一地点叙述。
- 秘密与权限影响：个人知识不放入 room-wide committed delta；Audience 变化不能追溯授予旧 Delivery。
- 迁移/可逆性：authoritative-v2 projector 行为；更改需新 Projection/Presentation Profile，旧事件不重投为历史聊天。
- 验收场景：个人移动、整队移动、分头、线索取得、realtime/history/reconnect、KP committed-result prompt。
- 测试证据：observer projection/delivery、KP adapter 与 31-turn 评测的记录切片通过；语音、错误与日志旁路仍由 SPEC 0010 专项冻结证据补齐。

## DEC-028：角色装备语义只改 Room DO 权威卡，D1 静态卡不得回写活跃结果

- 决策 ID：DEC-028
- 日期：2026-08-26
- 问题：穿戴、收纳和战斗消耗物品后，D1 静态人物卡是否同步成为第二份活跃装备状态。
- 来源类别：Goal 单一状态权威 + SPEC 0001 资源公正/连续性 + ADR-0003。
- 关联 SPEC 0001：§§2、6、16–17；C、G、N。
- 候选方案：DO/D1 双写；D1 覆盖 DO；Room 事件保存活跃 loadout，D1 只作静态建卡种子。
- 最终选择：装备、loadout 同步与物品消耗只经 Rules 事件改变 DO 权威角色；D1 卡仅供 genesis/目录用途，不能覆盖同版本活跃投影。
- 理由：跨 DO/D1 不能原子双写，漂移会产生第二 HP/资源/装备真相；语义事件又能回放和更正。
- 玩家可观察行为：穿戴、收纳、数量消耗、AC 与重连视图一致，幂等重试不重复消耗。
- 秘密与权限影响：只有可信控制者可改变自己的装备；Viewer 只显示有权角色的活跃投影，D1 查询不泄漏房间状态。
- 迁移/可逆性：旧房继续 Legacy；新房初始化后不再读旧 `game_states` 活跃装备。错误变更经 correction 恢复事件前 loadout。
- 验收场景：穿戴/收纳、战斗物品消耗、D1 漂移注入、归档恢复、更正及双 Viewer 版本一致。
- 测试证据：Rules loadout、Room loadout 与 combat/table 组合已记录通过；最终冻结全量门仍须重跑。

## DEC-029：动态物品与离屏 NPC/势力推进复用同一复合行动事务

- 决策 ID：DEC-029
- 日期：2026-08-26
- 问题：KP 动态形成的物品，以及玩家不在场时 NPC/势力计划，是否可以只存在 Prompt 或由独立后台写状态。
- 来源类别：Goal 明确单一行动事务 + SPEC 0001 动态世界/NPC 有限知识 + SPEC 0005/0006。
- 关联 SPEC 0001：§§7–11、14、16、19；D、E、G、J、K、N。
- 候选方案：Prompt-only lore；后台直接 patch；`ActionPlan` 的 typed artifact/faction operations。
- 最终选择：首次机械影响前用 `ArtifactMaterialized` 固化；取得、使用、同场转移与 `FactionPlanAdvanced` 都进入同一 Root Action/Rules/DO 原子提交。离屏行动必须引用 acting NPC 的有限知识和已固化因果事实。
- 理由：Prompt-only 无法恢复或纠错，后台 patch 会成为第二裁决路径；typed operation 同时保留开放世界和机械边界。
- 玩家可观察行为：新物品可取得、使用、转交并跨章持续；离屏计划只在世界内产生证据后影响玩家，不按最低 HP/最近目标自动行动。
- 秘密与权限影响：未观察的物品/计划按 Viewer 隐藏；物理交互验证同场，NPC 不能引用自己不知道的事实。
- 迁移/可逆性：Lore-only 定义仍合法但不伪造物件实例；所有变更有 correction effect，可从归档重放。
- 验收场景：动态物品完整生命周期、跨场景伪造拒绝、离屏推进、有限知识失败、回放/更正及秘密隔离。
- 测试证据：Rules compound 24/24，world/campaign 与 KP adapter 合计 18/18 的记录切片通过；冻结评测证据另记。

## DEC-030：动态战斗定义先经封闭 2014 护栏，再形成 Encounter 事实

- 决策 ID：DEC-030
- 日期：2026-08-26
- 问题：KP 创建动态敌人/危险时，如何防止任意字段、客户端骰面和 2024 语义进入已提交机械，同时不按队伍强弱自动缩放。
- 来源类别：Goal 动态定义/权威随机/2014 固定要求 + SPEC 0001 公正/危险 + SPEC 0012/0013。
- 关联 SPEC 0001：§§6–8、10、14、17；C、D、G、K、N。
- 候选方案：接受任意 JSON；只允许预写怪物白名单；先做封闭 schema/Profile 校验并原子固化定义、实体与 Encounter。
- 最终选择：动态实体、AbilityDefinition、参战者、共享先攻组、敌对关系和场景引用在任何骰面前完整校验；未知字段、非法属性/公式/规则来源、重复 ID、缺席先攻项与伪造关系无事件拒绝。合法高 HP/AC/伤害不因队伍状态被削弱。
- 理由：开放世界需要新定义，机械安全和确定回放又要求有限表达；强弱是 KP 的故事裁决，不是编译器平衡器。
- 玩家可观察行为：合理新敌人与危险可立即进入同一 Encounter；非法提案要求 KP 修订，不消耗资源或骰面。
- 秘密与权限影响：内部诊断与隐藏定义只给 KP/Internal；玩家错误使用不可区分的安全引用错误。
- 迁移/可逆性：首个 authoritative manifest 尚未正式发布，当前实现可在首次 pin 前收口；首次发布后任何改变 replay hash 的语义必须发行新 manifest/interpreter并保留旧 pin。
- 验收场景：动态高数值接受、未知字段/骰面注入/重复定义拒绝、唯一参战/先攻/敌对闭包、Geometry 占位射程/区域及 replay。
- 测试证据：`tests/ability-profile-v2.test.mjs` 8/8、`tests/combat-hostility-v2.test.mjs` 2/2、`tests/combat-mechanics-v2.test.mjs` 45/45 与 `tests/rules-compound-action-v2.test.mjs` 27/27 的当前记录共同覆盖封闭编译、动态高数值定义、多人敌对闭包、占位/区域、逐实体突袭、2014 Grapple/Shove 及 replay。冻结全量门仍待执行，不能据此宣称 SPEC 0012/0013 完成。

## DEC-031：归档恢复与更正从同一权威状态枚举全部通用/战斗 Pending

- 决策 ID：DEC-031
- 日期：2026-08-26
- 问题：战斗 pending 在 DO 重启、归档恢复或更正后，是否允许由独立 SQL 索引保留旧候选。
- 来源类别：Goal 恢复/更正/DO 唯一权威 + SPEC 0001 连续性/纠错 + SPEC 0011。
- 关联 SPEC 0001：§§16–17、19；L、N。
- 候选方案：只恢复通用 pending；保留旧索引；从更正/恢复后的完整权威状态统一派生索引。
- 最终选择：live commit、archive restore 和 correction 使用同一 pending 枚举器，覆盖通用与 `combatRuntime.pendingInputs`；更正先 suspend 旧派生索引，再按恢复后的完整 `combatRuntime` 精确建立当前项。
- 理由：派生索引只能服务鉴权，不能比权威状态多活或少活；完整前态恢复避免零散字段遗留先攻、回合或敌人。
- 玩家可观察行为：重启后可继续同一待决；更正撤销的旧 pending 不能再回答，合法候选、控制者和 Profile pin 不漂移。
- 秘密与权限影响：索引保存最小可信绑定；候选仍只经 projector，旧 pending ID 不能成为探测旁路。
- 迁移/可逆性：首次 authoritative-v2 发布前纳入当前 manifest；发布后改变 fold/hash 需新 manifest，不能在旧 pin 下静默替换。
- 验收场景：战斗目标/反应 pending 归档恢复、Encounter/pending correction、旧回答拒绝、runtimeProfiles 恒等。
- 测试证据：combat archive/correction 3/3，combat + 通用 archive/correction 8/8，runtime/pending/combat mechanics 24/24 的记录切片通过；最终冻结组合仍须重跑。

## DEC-032：单权威评测必须由事件、Receipt、投影与 D1 边界共同证明

- 决策 ID：DEC-032
- 日期：2026-08-26
- 问题：多轮评测能否用固定布尔值声称“没有第二权威”，以及如何在不读取 Prompt/秘密正文的情况下证明 DO、D1、Receipt 和 Viewer 没有分叉。
- 来源类别：Goal 单一机械/状态/投影/回放路径与 20+ 轮评测硬门 + SPEC 0001 公正、连续性、纠错 + SPEC 0011。
- 关联 SPEC 0001：§§2、6–7、12、16–17、19；C、E、L、N、O。
- 候选方案：评测配置常量；仅比较最终状态 hash；从完整 archive hash chain、逐 Root Receipt 覆盖、单调 DO 版本、head projection audits 和 D1 静态卡边界推导硬信号。
- 最终选择：删除 `secondAuthority:false` 常量。每轮核对两个 Viewer 的同一 DO `stateVersion`、projection hash 与 Receipt event range；结束时验证 genesis/Profile、连续事件 hash、每个变更的 Room Receipt、全部事件被 Receipt refs 覆盖、最终投影审计位于归档 head，并验证 D1 静态人物卡不能覆盖 DO 活跃 HP/资源/loadout。任一漂移信号使评测失败并标记 `secondAuthority=true`。
- 理由：最终 hash 相同不能证明中间没有 D1/Room/UI 旁路，固定布尔值更不是证据；多层一致性约束能在真实连续事务中让第二权威变成可证伪失败。
- 玩家可观察行为：31 次连续行动在重试、待决、收束和双 Viewer 下保持一个版本与一个 Receipt 结果；静态卡漂移不会悄悄改写活跃背包或结局状态。
- 秘密与权限影响：评测只读取短 hash、公开 Receipt 引用和允许的静态卡边界，不记录 Prompt、Cookie、模组 truth、私人叙述或未公开线索；Viewer 间不比较正文以免产生秘密旁路。
- 迁移/可逆性：只加强评测/观测门，不改历史事件；新增权威集合必须同时扩展允许边界与负向漂移 fixture，不能恢复常量豁免。
- 验收场景：31 轮真实事务全绿；只伪造 D1 物品数量而 DO/Receipt 不变时确定失败；`StoryConcluded` 在 Rules、Room、Archive 和 actor projection 的同一 Receipt status 均为 `concluded`。
- 测试证据：`tests/kp-multiturn-eval.test.ts` 1/1（31 turns）、live runner/provisioner 11/11、world/campaign 9/9、`npm run typecheck`、`npm run module:check` 与评测脚本语法检查的记录切片均通过；真实 Workers AI 仍待发布阶段单独执行。

## DEC-033：Geometry 使用精确多边形棱柱、五种闭合体与连续移动，而非点目标或包围盒近似

- 决策 ID：DEC-033
- 日期：2026-08-26
- 问题：首个 Geometry Profile 如何实现任意简单多边形屏障、区域、清晰路径与穿越生物空间，才能符合已裁定 G01–G15，而不让页面/AI 提交目标集合或使用 bounding box 猜测。
- 来源类别：Goal 单一机械权威 + SPEC 0001 公正/动态危险 + SPEC 0012/0013 已授权算法。
- 关联 SPEC 0001：§§6–8、10、17、19；C、D、G、N。
- 候选方案：实体降为点；墙只取包围盒；只支持 sphere；按网格/浮点近似；以整数英寸、BigInt/有理数、简单多边形棱柱和固定采样完整实现 Profile。
- 最终选择：范围使用三维 measurement core 平方比较；路径使用 milli-inch 向上取整；掩护对 64 点做精确开线段与简单多边形棱柱求交；区域对 65 点支持 sphere/cylinder/cube/cone/line，方向整数约分，straight 传播与 12 英寸六邻接 `aroundCorners`；墙后原点冻结在首次精确交点来源侧。连续移动检查地形/终点占位、敌对体型穿越和生物空间困难成本，调用者不提交受影响集合。
- 理由：包围盒会让凹形墙虚构阻挡，浮点/页面方格会改变边界，sphere-only 无法承载动态能力；固定整数/有理数算法使重试、回放与不同部署保持同一集合。
- 玩家可观察行为：大体型、斜向、高度、边界、掩护、墙前爆点、绕角和穿越空间在刷新/重试中一致；隐藏障碍导致非法时只返回安全原因，不泄漏障碍形状。
- 秘密与权限影响：完整坐标、屏障、采样和内部碰撞证据仍只在 Rules/KP/Internal；玩家和模型只能提交自己有权选择的原点、方向、路径与封闭参数，不能提交 `targetIds` 或空间事实。
- 迁移/可逆性：首个 authoritative-v2 尚未正式发布，当前实现可在首次 pin 前完成；发布后任何采样、voxel、碰撞或边界语义变化必须新 Geometry/manifest 与旧 interpreter 并存。
- 验收场景：G01–G15、B08–B10/B39；凹多边形不按包围盒误挡、五种区域集合稳定、墙后原点冻结、绕角开放/封闭对照、敌对/盟友/体型穿越和移动中断。
- 测试证据：`tests/combat-mechanics-v2.test.mjs` 当前 45/45、`tests/rules-compound-action-v2.test.mjs` 27/27 及 `tests/privacy-bypass-v2.test.mjs` 的 G15 定向场景已经从公开 `step/project/replay` 覆盖 G01–G15，包括五种区域、墙前原点、绕角、连续穿越/中断和 Viewer 安全错误。冻结全量门仍待执行，因此本记录只确认定向证据闭合，不宣称最终交付完成。

## DEC-034：Room 用累计多波随机 journal 和场景结算锁保证崩溃后同一结果

- 决策 ID：DEC-034
- 日期：2026-08-27
- 问题：同一 Root Action 在首波伤害后合法请求第二波专注骰，或同场景出现并发提交与任意 append 后崩溃时，如何保证事件、状态、候选骰面、Pending 归档和 Receipt 不分叉。
- 来源类别：Goal 权威随机/崩溃恢复/单一状态要求 + SPEC 0001 公正/连续性 + SPEC 0003/0011 + B53 实际故障因果链。
- 关联 SPEC 0001：§§6–7、12、16–17、19；C、E、L、N。
- 候选方案：只允许一波随机并拒绝后续请求；把后续波或候选留在内存；每波建立互不关联的独立记录；在现有 prepared/proposal journal 行中保存有界累计 envelope，并把同场景提交串行化。
- 最终选择：`authority_randomness_batches` 的一行保存向后兼容的累计 `requests/candidates/requestEvents`，并以 `multiWave.waves[]` 的 `requestCount + fulfillment` 恢复波边界；旧 plain fulfillment 规范化为第一波。每波和总请求数设上限，跨波 randomness ID 必须唯一。每波先在一个 DO SQLite 事务中追加该波事件、更新权威 state、推进下一波 request journal；事务提交后才生成候选，并以 first-writer-wins 固化和重读获胜骰面。场景级 settlement lock 阻止同场景另一 Root Action 越过未结算随机；每次权威事件 append 都在同一事务推进 archive pending generation 与恢复闹钟依据。到期 Activity 需要随机时，恢复逻辑从冻结的 `activityId + completionFictionMicros` 重建 `activity-due:<activityId>:<completionFictionMicros>`，并只接受同根、randomness ID 绑定且与持久事件连续前缀逐字节相同的 request events。journal 只留在 Room DO，D1 仍只追加归档已提交事件，不成为骰面或活跃状态权威。
- 理由：伤害与专注是合法的多波机械链；若先掷后记、内存续波、候选后写覆盖或允许同场景插队，崩溃/并发会重掷或改变因果顺序。累计 envelope 保留已完成波，场景锁和逐次原子推进让恢复从唯一持久点继续。
- 玩家可观察行为：刷新、丢响应、DO 驱逐或并发重复提交后仍得到同一 Receipt、commitments 和 faces；其他场景不被无关锁阻塞，同场景新行动等待旧结算恢复完成。
- 秘密与权限影响：候选骰面、完整 journal、内部检查点和锁只在 DO/KP 权限边界内；玩家仅看到经 projector 允许的结果，D1 归档不暴露未提交候选或 Pending 私密内容。
- 迁移/可逆性：复用现有 SQLite 表和旧 fulfillment 兼容读取，不新增 D1/DO schema。改变波界、上限、候选竞争或锁粒度需新的持久化协议裁定；已提交事件仍按原 Profile replay。
- 验收场景：伤害→专注至少两波；第二波 request/candidate/outcome 各检查点崩溃；同 proposal 并发重复；同场景阻塞与跨场景独立；到期 Activity 的随机批次按 canonical due root 恢复且不占用原调用者 root；每次 append 后 archive pending generation 可恢复；丢响应重试返回同一 Receipt/骰面；改写根、randomness ID、request-event 历史或只追加未持久化事件均 fail closed。
- 测试证据：`tests/randomness-recovery-v2.test.ts` 当前 12/12、`tests/combat-room-randomness-v2.test.ts` 11/11、`tests/contest-room-randomness-v2.test.ts` 1/1、`tests/room-retry-v2.test.ts` 3/3、`tests/archive-do-resume-v2.test.ts` 2/2、`tests/combat-vertical-v2.test.ts` 1/1 与 `tests/combat-archive-correction-v2.test.ts` 3/3 的记录切片覆盖多波、检查点恢复、场景锁、候选 first-writer、request-event 篡改拒绝、B53 垂直段及 archive/correction；F04 另覆盖到期 Activity 独立根与原意图重试。冻结全量门仍待执行；本决策不修改或缩小 SPEC 0001。

## DEC-035：战术地图只适配 Viewer Tactical Projection，不拥有空间事实

- 决策 ID：DEC-035
- 日期：2026-08-27
- 问题：如何把 authoritative-v2 的完整 Geometry 变成玩家可操作的二维战术地图，同时不建立客户端第二空间、不遗漏隐藏区域目标或泄露 GM geometry。
- 来源类别：用户 Goal 明确追加批准 + SPEC 0001 叙事/机械/状态权威与秘密边界 + SPEC 0010/0012/0013。
- 关联 SPEC 0001：§§2–10、12、14–17、19–22；A、C、D、E、G、J、K、M、N。
- 候选方案：页面网格/像素成为机械坐标；下发 GM 全图后前端隐藏；客户端按可见 token 提交完整区域 targets；只保留一维距离；Room 权威 Geometry + Viewer Tactical Projection + 纯展示 Adapter。
- 最终选择：WorldState/Geometry Profile 保存唯一 `x/y/elevation/height/footprint/path/barrier/cover/area` 事实；环境用版本化定义的有限状态，不做通用物理模拟。地图手势只提交 ordered path、area origin/direction 或定义允许的封闭选择；Rules 在同一 `step` 基于完整状态决定实际路径前缀和所有目标。`project(viewer)` 产生同供地图、文字、无障碍与 preview 使用的秘密安全 Tactical Projection；提交按最新完整状态重算。
- 理由：像素/网格会随视口和舍入漂移，GM payload 会从网络/DOM 泄露，客户端目标集合会漏掉隐藏实体或被删改；反之只保存一维距离无法兑现已经裁定的 Geometry。单一投影 Adapter 同时保留公正、回放、秘密和简单 UI。
- 玩家可观察行为：玩家在简化俯视图看到自己、可见单位、已知障碍/门/地形/区域/占位/高度/掩护，并可提交路径与区域选择；看不到隐藏目标数量或障碍，地图不可用时同源文字读数仍可操作。
- 秘密与权限影响：完整 geometry、实际区域集合、隐藏实体/屏障和内部采样留在 Rules/Internal；两个只有隐藏状态不同但 Player Projection 相同的房间，对同一 preview 返回规范不可区分公开结果。客户端 body、DOM、ARIA、错误、日志和语音不得成为旁路。
- 迁移/可逆性：旧一维/页面坐标只留 Legacy，不猜 authoritative-v2 geometry。Geometry、环境状态图、projection schema 或采样/传播变化需要新 Profile/Adapter 并保留旧房解释器；地图视觉可替换但不得改变域合同。
- 验收场景：SPEC 0014 场景 1–14，包括真实 scene geometry、Viewer projection、门三态、可破坏物、环境持续 zone、高度、区域 hidden target、不可区分 preview、Room/replay 和 375px/1440px 浏览器证据。
- 测试证据：决策与 [ADR-0012](../adr/0012-tactical-map-is-a-viewer-projection-adapter.md)、SPEC 0014、Goal 和追踪矩阵已落盘；现有 G01–G15 只证明 Geometry 算法底座。环境/Tactical Projection/Room/UI/浏览器纵切尚待实现，明确不能写成已满足。

## DEC-036：主 KP 使用私有小表，compound 保留开放行动逃生舱

- 决策 ID：DEC-036
- 日期：2026-08-29
- 问题：如何缩小超级 Schema，而不把玩家自然语言或 `SPEC 0001` 的开放世界 KP 裁决降成命令白名单。
- 来源类别：用户本 Goal 明确授权 + SPEC 0001 冻结 KP 权威 + SPEC 0003 单一 Room Action/Rules Interface。
- 关联 SPEC 0001：§§2–8、11–14、17–19；A、B、C、D、G、H、J、O。
- 候选方案：继续单一超级 Schema；向玩家公开 Form 菜单；由 Planner 选择唯一 Form；服务端每次给 3–6 张私有小表并在不确定路径保留 compound。
- 最终选择：注册 SPEC 0015 的十个精确 Form；Room 从可信状态筛 3–6 张，已有结构化 UI 由服务端直接定 Form，其他不确定/跨域路径必须含 `compound.v1`。Form 只属模型内部，authority/骰面/事件/targets/Profile 均由服务端派生；合法草稿确定性编译为独立版本的 closed/acyclic/bounded `CausalActionProgram`。
- 理由：小表降低 Schema/token，compound 仍能承载未预见、动态、多目标和跨作用域行动；服务端派生权限字段阻止模型或玩家自报权威。
- 玩家可观察行为：玩家继续用自然语言提出合理行动，不需要理解或选择 Form；复杂行动不会仅因没有专用表而被拒绝。
- 秘密与权限影响：Form 不扩大 KP Viewer 内容；principal、actor、Audience、实际 target 与骰面不进入模型字段或客户端。
- 迁移/可逆性：新 Form/Action Language/Profile 只进新 V3 房间；不改 `authoritative-kp-action-plan-v1`。只增 Form 可发布新 Profile，新增 primitive 必须发布新 Rules manifest/interpreter。
- 验收场景：十 Form 注册；普通动作只收 3–6 张；不确定路径永含 compound；未知字段/脚本/JSON Patch/事件/骰面/authority 注入 fail closed；复杂动作误入简单 Form 为 0。
- 测试证据：Form/Profile/Builder 定向组合 14/14，Causal/环境 Rules 8/8；十 Form、3–6 allowlist、compound、closed/bounded DAG 与 authority 字段拒绝已有责任 seam。真实 Provider、冻结全量与浏览器仍待，局部绿色不等于发布完成。

## DEC-037：Required/ Retrieved/ Optional 分层，D1 FTS 只作静态派生索引

- 决策 ID：DEC-037
- 日期：2026-08-29
- 问题：如何减少完整上下文并提高规则/模组召回，同时避免索引成为活跃状态、秘密或版本的第二事实源。
- 来源类别：用户本 Goal 明确授权 + SPEC 0001 世界/知识权威 + SPEC 0005/0006 事实/模组/NPC + SPEC 0003 Room DO 唯一权威。
- 关联 SPEC 0001：§§3–4、7–9、11、14–19；A、D、F、G、K、M、N。
- 候选方案：每次发送完整 WorldState/Story Bible；把动态 Room 快照写入向量库；信任检索摘要；RequiredContext 直取 Authority、静态引用检索后按 hash/权限重读。
- 最终选择：RequiredContext 来自 Room Authority/`project` 且不可裁剪；Retrieved 仅为 SRD/模组/Story Bible/Ability/敌人/环境的静态版本化 ref；Optional 最先裁剪。D1 FTS 只保存可重建中文别名、双字词、术语和结构关系；命中后按 sourceRef/hash/span/profile/sensitivity/dependencies 重读权威原文。NPC 必须重投影，Narration 不接收 Story Bible/完整 KP Context。
- 理由：权威动态切片与静态资料分层后，缺失/过期索引不能改写世界，仍可度量召回和 token；重新读取解决版本、权限和秘密变化。
- 玩家可观察行为：相关规则和模组依据更稳定，FTS/Planner 故障在 RequiredContext 足够时只降级检索；权威上下文不足则诚实失败，不由模型猜测。
- 秘密与权限影响：当前位置、资源、Pending、角色/NPC 当前知识、Audience、私人对话和动态事实禁止入索引；KP-only chunk 仍逐次鉴权。
- 迁移/可逆性：D1 FTS 可从权威静态语料删除并重建；若改 schema，从 `db/schema.ts` 生成只增不改 migration，先本地闭环再远端。无需 schema 变化时明确记录无 migration。
- 验收场景：Required 不可删；中文别名/FTS/依赖召回；篡改 source/profile/hash/span 拒绝；删除索引后规范重建；NPC 无全知继承；动态状态索引扫描为 0。
- 测试证据：静态 corpus + production context 定向组合 14/14，覆盖 Required/Optional、动态源拒绝、中文别名/FTS、ref/hash/Profile/权限重读、全新 corpus schema、`0008→0010` 与无请求时 DDL；`0010` 只逻辑清空三张可重建派生索引表，不改权威 Room/身份/归档。`0011` 灾备 checkpoint 及其独立恢复证据见 DEC-044；远端 migration、真实 Provider 与浏览器仍待。

## DEC-038：Proposal 采用一次首调用加一次窄修订并冻结玩家语义

- 决策 ID：DEC-038
- 日期：2026-08-29
- 问题：Schema、引用或 Rules 诊断失败时，如何恢复可执行 Proposal，又不允许多轮完整 Prompt 改变玩家意图、骰前裁决或成本。
- 来源类别：用户本 Goal 明确授权 + SPEC 0001 玩家能动性/骰前公正 + SPEC 0003/0011 诊断、恢复与模型预算。
- 关联 SPEC 0001：§§5–7、10、12–13、17–19；B、C、D、E、G、L、N。
- 候选方案：失败即终止；无限自动重提；现有两次完整机械修订；一次窄修订并冻结语义 hash。
- 最终选择：每 RootAction 最多一次首 Proposal 和一次窄修订。修订只携所选 schema、原草稿、合并诊断、有限引用与 goal/method/target/playerChoices/NPC 回应的冻结语义 hash；只修字段/引用/机械组合或升级 compound。修订耗尽返回 `needsKp`/`PROPOSAL_REPAIR_EXHAUSTED`，无第三次完整调用。
- 理由：一次窄修订覆盖结构性可恢复错误，同时限制 token、循环和逐轮语义漂移；冻结 hash 与骰后禁改维持玩家控制和公正。
- 玩家可观察行为：可修复的结构错误通常自动恢复；不能修时显示诚实稳定失败/等待，不伪造世界成功，不重复提交输入。
- 秘密与权限影响：修订不重发完整模组、历史或 Story Bible；诊断按 KP Viewer 投影，不向玩家泄漏秘密引用。
- 迁移/可逆性：只对新 Proposal Profile 生效；旧房保持原修订预算。改变预算/语义字段需新 Profile 和明确裁定。
- 验收场景：字段/引用修复、升级 compound、语义 hash 篡改、骰后改变 DC/后果、修订 Provider 超时、耗尽后无第三调用。
- 测试证据：`tests/private-form-repair-v3.test.mjs` 定向 5/5，覆盖语义冻结、无隐式 compound、有限引用修复、scope/Profile 漂移拒绝与显式升级；Causal/环境 Rules 8/8 覆盖合法编译/执行。真实 Provider 调用计数、骰后线上故障和冻结全量仍待。

## DEC-039：Narration 只输出 body，行动和逐受众发布分别建模

- 决策 ID：DEC-039
- 日期：2026-08-29
- 问题：如何区分“世界已经提交”和“某位观察者叙述尚未发布”，并消除模型自报权限/证据与伪成功 fallback。
- 来源类别：用户本 Goal 明确授权 + SPEC 0001 事实/叙事/秘密边界 + SPEC 0010 Audience/亲历/Delivery + SPEC 0003 提交稳定点。
- 关联 SPEC 0001：§§2–4、8–10、12、14–19；E、F、J、K、M、N、O。
- 候选方案：继续单一 `ok`/Outcome kind；Narration 失败回滚行动；固定成功文案；body-only + 服务端元数据 + action/narration 双状态。
- 最终选择：模型 schema exact `{body}`，删除 `tts/decisionPrompt/referencedProjectionRefs/agencyClaims`；服务端派生 Audience/Receipt/projectionHash/evidence/agency/Policy/InvocationReceipt。公开 action 为 `notCommitted|awaitingInput|committed|resolvedInWorld|concluded`，narration 为 `notApplicable|pending|published|rejected|retryableFailure`。发布按 `(rootActionId, ViewerKey, projectionHash, deliveryGeneration)` 独立；Grounding 拒绝显式失败。
- 理由：提交和呈现是不同稳定点。分离后 Provider 故障不能重复骰/资源，一个受众故障也不能改变其他受众；body-only 去掉模型权限字段和语义不同的 TTS。
- 玩家可观察行为：行动已提交时气泡与世界结果保留；“重试 KP 回复”只重用原 Receipt/冻结投影。Alice 可看到成功回应，Bob 的失败只在 Bob 侧重试；NPC 世界内拒绝仍是 resolvedInWorld。
- 秘密与权限影响：Audience 提交时冻结；不在场者不能补取；换席/新控制者不继承旧亲历。Narration 不接收完整 KP Context，错误/DOM/TTS/日志不泄漏。
- 迁移/可逆性：只对新 publication/narration Profile 生效；旧 Outcome/Delivery Adapter 按 genesis 保留。改变状态或保留语义需新协议版本。
- 验收场景：exact body schema；额外字段拒绝；Grounding 拒绝无 fallback；提交后 timeout 不回滚；Alice/Bob 独立；刷新/离场/换席/重试/幂等；固定伪成功文本不存在。
- 测试证据：public action/table 定向 21/21，Viewer recovery 4/4；覆盖 body-only 公开裁剪、action/narration 双状态、Alice/Bob 独立、驱逐/刷新、死亡/退役及 transfer/revoke 后原 ViewerKey 恢复、继任者拒绝、恢复态不读取当前世界，以及不重提案/重掷/扣资源。375/1440 浏览器、语音/TTS/日志旁路与冻结全量仍待。

## DEC-040：G2 是采用配置，辅助模型未达增益门即移除接线

- 决策 ID：DEC-040
- 日期：2026-08-29
- 问题：何时值得引入 Planner、embedding/Vectorize 或 rerank，以及如何避免辅助模型取得 KP 权威或隐藏切换主模型。
- 来源类别：用户本 Goal 明确授权 + SPEC 0001 KP 权威 + SPEC 0011 Model Receipt/无隐藏切换 + Cloudflare 既有资源约束。
- 关联 SPEC 0001：§§2–8、11–14、17–19；A、B、D、G、H、J、N、O。
- 候选方案：默认启用全部 AI/RAG；完全不做检索实验；固定 G0–G5 并按质量/安全/token/延迟增益门采用。
- 最终选择：Model Profile Registry 固定 provider/model revision、roles、schema、验证套件、上下文/延迟/成本；主 KP Profile 按房间固定。G2（小表+三层 Context+D1 FTS）是本轮采用配置。G3 Planner 与 G4 本地精确向量在同一 120 条 gold 上无预注册增益，均拒绝；G5 因 G2 召回充分且排序未明显失败而不适用。生产新房绑定只允许 `context-planner-disabled-v1`，不接 Planner 产品/UI；失败回退确定性查询，不自动换主 KP。
- 理由：辅助能力只有带来可量化净收益才值得承担版本、延迟、秘密和故障面。G3/G4 相对 G2 的 required recall、critical recall 和首次合法率配对差值均为 0/120、95% CI `[0, 0]`，输入还增加；角色 allowlist 继续阻止实验候选决定 DC/NPC/世界/targets/Audience/骰面。
- 玩家可观察行为：主 KP 仍是唯一模型设置；当前没有无增益或待验证的 Planner 高级选项。确定性静态检索在服务端透明工作，辅助故障不改变行动语义；未验证模型不会出现在 UI。
- 秘密与权限影响：辅助模型只做 Form 排序、实体/代词、查询、rerank、引用/结构提示；秘密 canary、allowlist 和脱敏 Receipt 是上线硬门。
- 迁移/可逆性：辅助 Profile 只在新 RootAction 边界切换；未达门接线删除。未经另行授权不创建远端 Vectorize、新 Worker/D1/DO/KV/R2/Queue/Workflow。
- 验收场景：G0–G5 同集报告；生产 Planner disabled；实验候选有独立 Receipt 且无产品接线；故障注入 100% 安全回退；无隐藏切换；拒绝待验证 Profile 的扫描。
- 测试证据：`tests/context-planner-profile-v3.test.mjs` 定向 6/6；120 条离线结构报告 4/4 且 16/16 hard gates，G2 以真实本地 SQLite FTS5/D1 Adapter 合同完成 120/120 MATCH，G3 `unvalidated`/production disabled，G4 完成 120 次 exact-cosine 搜索与 1920 次比较并在 56 个案例实际重排，但两者仍为 `adopted=false`，G5 `applicable=false`，五类故障 5/5 安全回退。该报告没有网络调用；完整 Provider 指标不在本轮代理测评范围。

## DEC-041：动态环境由 KP 自定义并以显式效果模式进入同一事务

- 决策 ID：DEC-041
- 日期：2026-08-29
- 问题：如何让玩家提出任意环境即兴想法，由 KP 自定义内容与机械，而不是只支持吊灯等预设对象，同时避免通用物理、客户端 targets 或模型 patch 成为第二机械。
- 来源类别：用户本 Goal 明确授权 + SPEC 0001 动态世界/公正危险 + SPEC 0014 Geometry/Tactical Projection + SPEC 0012/0013 Rules/Profile。
- 关联 SPEC 0001：§§3–8、10–14、17–19；A、B、C、D、E、G、H、J、N。
- 候选方案：仅做叙述动画；按吊灯/油桶等对象名或 archetype 派发模板；客户端物理/区域目标；通用物理引擎；KP 自定义的版本化 EnvironmentFeature/Definition/StateGraph 经现有 Rules/Room，并按显式机械模式有条件携带 Hazard/Area。
- 最终选择：玩家继续输入任意自然语言；KP 在骰前定义/复用稳定环境要素、材质/Geometry/耐久/有限状态图，并显式冻结 `state-only | area-hazard`，不得按对象名称、关键词、家族或 archetype 推断。`state-only` 只提交对象自身状态/耐久以及地形、掩护、视线或通行变化，Hazard/Area/区域 save/区域目标 damage 必须为空；`area-hazard` 才由 Rules 从完整 Geometry 计算实际集合并结算区域/逐目标豁免/伤害。通用动态场景是发布纵切，吊灯仅为已有 Rules 示例且不再是完成前置。隐藏目标可被影响但不公开；高伤害/致死不按队伍等级削弱。
- 理由：KP 自定义有限状态覆盖开放玩家想法并可版本化回放；显式效果模式避免把所有环境动作强行改成陷阱。通用场景检验动态事实、对象破坏、区域、死亡、残骸、随机、秘密和恢复，折叠栅栏等 `state-only` 案例证明无虚构 save/damage；不需要为某个物件名重复建立 Room 套件，也不引入平行物理引擎。
- 玩家可观察行为：既有物件稳定复用，合理开放留白在骰前形成，明确不存在时世界内拒绝；自定义栅栏可以只改变遮挡/通行，具有真实区域危险的自定义对象才结算 targets/save/damage；吊灯失手、未破坏和坠落仍有不同真实后果，残骸改变战场。
- 秘密与权限影响：玩家/KP/客户端不提交实际目标集合；隐藏目标、完整 Geometry、内部采样不从 preview、错误、DOM、Narration 或长度泄漏。
- 迁移/可逆性：历史 hazard-only `environment-feature-fsm-2014-v2`（`sha256:702b2559c821a52e1c7d6a137c6b261cec21d6cc513e3c0301b4b5ab007f7c87`）及 `runtime-srd51-2014-authoritative-environment-v2`（`sha256:0021280335296ecfc5b65a221fec7009550fac96db65925e47daef9f9d4f0456`）按原义保留；显式双模式 `environment-feature-fsm-2014-v3`（`sha256:1656fd548905d6ea886fd4cf97357a9d67c56422be3a2c6bd281fc93a22b4fe6`）先由 workflow-v1/env-v3 固定，当前新房 workflow-v2/env-v4 仍复用该 FSM 并增加独立人物熟练 Profile。三代完整 manifest/canonical document 同时注册、按 genesis 精确匹配；旧抽象距离/空 obstacles 不猜迁移，也不把旧状态静默改名。新增 primitive 或持久化机械语义发布新完整 Rules manifest/interpreter。
- 验收场景：任意 KP 自定义内容不按名称派发；`state-only` 无 Hazard/Area/区域 save/区域目标 damage；通用 `area-hazard` 覆盖创建/复用、对象破坏、完整 Geometry、多/隐藏目标、逐目标豁免/伤害/死亡、残骸、恢复、回放和幂等；两态都服从 SPEC 0014 的 Geometry/Tactical Projection/双视口门。2026-08-29 用户后续裁定取消具体吊灯专项完成门。
- 测试证据：动态环境 Room 6/6；已覆盖自定义非吊灯对象、`state-only`、完整 `area-hazard`、隐藏目标、replay/correction/duplicate root 和 legacy/new Profile 隔离。新增 workflow-v2/env-v4 生产 seam 长轨迹 1/1 以 31 次真实 Room 接口交互覆盖真实 Form allowlist/三层 Context/validator/compiler、双模式、2 实体 hazard、Bob viewer-local retry、无重复 Proposal/随机/资源，以及 archive→fresh DO 后 state/project hash 一致；Viewer recovery + 动态环境两文件 10/10。最终冻结全量与 375/1440 浏览器仍待。

## DEC-042：本次发布只做三交互线上冒烟，完整线上测评由用户执行

- 决策 ID：DEC-042
- 日期：2026-08-29
- 问题：完成实现和部署后，本代理是否还应执行 31 轮线上质量测评。
- 来源类别：用户在本轮的后续明确指令 + 发布最小外部探针边界。
- 关联 SPEC 0001：不改变产品合同；只收窄本次代理的外部验证范围。
- 候选方案：运行完整 31 轮线上测评；完全不做生产探针；只做一次精确三交互生产冒烟并把完整测评留给用户。
- 最终选择：本代理不得调用默认 31 轮线上 runner；部署后只以显式 `--interactions=3` 运行一次三交互冒烟。三次交互覆盖普通观察、NPC 对话和分头观察的真实 HTTP/auth/Room/Provider 接缝，随后必须删除房间、注销会话并按精确 ID/email 清除临时账号。浏览器 Proposal 失败、Narration 重试与任意动态环境输入使用确定性网络故障/公开 DTO 注入，不增加 Provider 行动。
- 理由：用户明确表示完整线上测评由自己完成，同时允许一个三轮检查；三交互足以证明部署接缝可达，但样本不足以证明质量、延迟、调用率或置信区间门。
- 玩家可观察行为：不改变产品行为。发布回执只声明“三交互冒烟通过/失败”，不得写“31 轮线上评测通过”。
- 秘密与权限影响：线上报告继续只保留哈希、计数和脱敏指标，不保存正文、Prompt、凭据、canary 或原始 ID；浏览器注入不能接触真实用户房间。
- 迁移/可逆性：不改变 schema、Profile、Worker 资源或默认 31 轮 runner；用户可在发布后自行运行完整评测。
- 验收场景：CLI 只接受无参 31 轮或精确 `--interactions=3`；本次实际命令必须是后者，`evaluationScope=three-interaction-smoke`、`qualityThresholdsApplied=false`、`interactionsCompleted=3`，并证明房间/会话/账号清理完成。
- 测试证据：`tests/live-kp-eval-runner.test.mjs` 与 `tests/live-kp-eval-provisioner.test.mjs` 定向 13/13；真实三交互结果只在部署后回填执行日志。

## DEC-043：2014 Expertise/豁免熟练只随新完整 manifest 发布

- 决策 ID：DEC-043
- 日期：2026-08-30
- 问题：人物卡已携带 `expertise`，但现有 environment-v3 Rules 状态与冻结检定只解释 1×PB，多个 save 路径又没有统一的显式职业豁免熟练；能否在旧 manifest 同 hash 下直接改成 2×PB/新 save 语义。
- 来源类别：SPEC 0004 的 2014 检定/专精合同 + ADR-0013 的持久化规则/Profile 版本边界 + 本轮直接数据链审计。
- 关联 SPEC 0001：§§5–7、10、12–13、17–19；B、C、D、E、N。
- 候选方案：在共享 helper 看到字段就启用；静默修改 environment-v3；新增字段但仍沿用旧 manifest；新增完整 manifest 和 exact character-proficiency extension。
- 最终选择：当前新房固定 workflow-v2、`runtime-srd51-2014-authoritative-environment-v4`（`sha256:8d0df2563b1e9fca31b1ab7b1678683075fc013b5220ba7b32aa054861203685`）及 `character-proficiency-srd51-2014-v1`（`sha256:718bf64554e4b032f3bea564797edf67b1695c2335879db4bd3e5332069a1001`）。canonical 字段为 `proficientSkills/expertiseSkills/proficientSaves`，Room 输入兼容 CharacterSheet 的 `expertise` 别名；Expertise 必须是 proficient 子集并计算 2×PB，六项显式熟练豁免计算 1×PB。
- 理由：冻结 modifier、事件/state shape 与 replay 都是持久化规则语义，不能在原 hash 下改变。exact manifest gate 让 causal、compound、campaign、combat 和 environment 共用一套公式，同时保留旧回放。
- 玩家可观察行为：新房的技能专精和职业熟练豁免按 2014 规则结算；旧房不会因部署新版 helper 而改变历史结果。非遭遇环境行动只在 exact v4 当前 RootAction 获得临时行动，不把耗尽 turn 状态带到下一次自由行动。
- 秘密与权限影响：人物熟练仍由可信 staticCard→Rules state 固化，模型、页面和 DTO 不能自报 modifier；字段随 `project(viewer)` 的既有角色可见性边界输出。
- 迁移/可逆性：default、environment-v2、environment-v3 的 ID/hash/state/results 保持不变；旧 genesis/events 不补字段。只有新建 workflow-v2 房间选择 v4；未来变更需再发完整 manifest。
- 验收场景：v4 Expertise=2×PB、显式 save proficiency=1×PB、expertise⊆proficient、别名适配、初始/同步/升级/继任/战斗实体保持字段、旧三 manifest 精确 1×PB/旧 save 回放。
- 测试证据：Profile/causal/compound 57/57、workflow/table 25/25、campaign 2/2、concentration save 1/1、V4 控制/继任 1/1、动态 Room 6/6、workflow-v2/env-v4 31 交互长轨迹 1/1；`npm run typecheck` 与 `git diff --check` 退出 0。最终冻结全量仍待。

## DEC-044：D1 灾备恢复只信任已结清、可重放的单调 checkpoint

- 决策 ID：DEC-044
- 日期：2026-08-30
- 问题：D1 归档按页追加时，怎样区分已完整结清、可安全恢复的 prefix 与部分写入的新行，并防止旧游标、缺失 projection audits 或未结清随机被误当作灾备快照。
- 来源类别：SPEC 0003 单一 Room/Rules 权威与恢复 capability + SPEC 0011 archive/replay/fail-closed + 本轮 D1 reader 缺口审计。
- 关联 SPEC 0001：§§3–7、9–10、14–19；D、F、J、K、M、N、O。
- 候选方案：从三张 D1 表猜最新行；仅检查 DO 本地游标；加未调用 assembler；用 checkpoint 固定唯一 settled prefix 并让真实灾备入口调用。
- 最终选择：`0011` 新增 `(room_id,runtime_epoch_id)` checkpoint。归档前后同时确认 `internalContinuations` 与 `combatRuntime.randomnessResolutions` 已结清；每批最多 40 statements，只有包含完整 head audit 集合的最终 batch 原子、单调推进 checkpoint。reader 只读 `event_seq <= settled_event_seq`，核对 genesis/event/state/branch/hash 与 prefix replay，再构造 archive；DO 只向 service `disasterRecovery` capability 暴露 exact-locator restore，且目标必须为空。
- 理由：event/audit 表可有领先于 settled head 的分页行，单看 MAX 或持久化 cursor 会恢复半个快照。checkpoint + replay + audit set 把可恢复边界变成可证明事实，同时 D1 仍只是 Room DO 的追加灾备副本，不是活跃状态权威。
- 玩家可观察行为：灾备恢复保持同一 Rules state/projection hash；已移除成员与无控制历史实体不会被恢复成活跃权限，当前 host/player/session/seat/control 索引从恢复 state 的活跃关系重建。
- 秘密与权限影响：D1 allowlist 仍只有 genesis、Rules events、projection hashes 和 checkpoint hashes/branch；没有 Prompt、模型原始输出、Cookie、正文、Delivery 或 KP-only projection。无 capability、非空目标、缺审计、篡改/回退 checkpoint 都 fail closed。
- 迁移/可逆性：`0011_low_leo.sql` 只增 checkpoint 表，SHA-256 `da8aa71c0ac9e909b890d02536c7eb6cc555e1c9b0fdb29808fcf77903863a8e`；旧无 checkpoint 归档在下一次完整 caught-up batch 回填，不修改旧 events/audits。远端只在发布串行阶段应用。
- 验收场景：80+ events 分页、最终原子 checkpoint、无回退/同序冲突、伪造 audit cursor 缺行拒绝、seq0/prefix replay、未结清多波随机拒绝、D1 reader→fresh DO、移除成员不复权、旧归档 backfill。
- 测试证据：`archive-d1-batches-v2` 11/11（含旧 checkpoint 的 D1 前缀篡改、ahead event/genesis conflict 拒绝）；`archive-do-resume-v2 -t 'resumes 80'` 1/1（80+ events、48 audits、真实 reader→fresh DO、活跃索引），无当前受控 viewer 的 D1→fresh DO 1/1；相关 randomness settlement 定向 1/1；Wrangler local `0000–0011` 与 checkpoint 写读、SQLite `0010→0011` 写读均退出 0。远端 migration 与最终冻结全量仍待。
