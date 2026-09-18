# 功能验收清单：KP 能力与完整游玩路径

盘点日期：2026-09-14。范围：当前 `cloudflare` 工作树，产品 0.4。用途：逐项安排测试、定位缺口和查找证据；本文件不新增产品规则，不代替 [主 PRD](../specs/0001-llm-kp-responsibility-contract.md)、[规格索引](../specs/README.md) 或实际测试报告。

本清单先完成能力拆分、测试源码核对与验收样例设计，随后按用户决定重组测试目录并执行了定向验证，见[测试重组回执](receipts/test-suite-reorganization-20260914.md)与[运行说明](../../tests/README.md)。09-14 又按用户要求执行了[一轮真实模型验收](receipts/live-functional-acceptance-20260914.md)：行动已提交，但旁白输出截断，动态支线未触发；没有继续采样。**尚未逐项重跑整份功能矩阵**。下列例子是待验收的代表性输入，不能全部当作已通过记录。每项的两个正常例子应经过同一通用路径；不能靠物品名、NPC 名或专用 fixture 分支取得通过。

共 **103 项独立验收条目：91 项 KP 能力及其规则衔接、12 项配套产品功能**。这是功能拆分数量，不是测试用例数或已通过数。

09-14 的[旁白关闭思考对照](receipts/narration-thinking-control-20260914.md)消除了该次空回复症状，但输出仍有非法 JSON 尾部；它是诊断证据，尚未通过生成、审核与发布验收。

当前[严格生成修复回执](receipts/narration-strict-generation-20260914.md)补上了原冻结材料的真实生成/审核，以及新隔离房间中“注入一次失败→真实恢复发布→原提交重复”的证据。恢复不新增机械结算；正文仍有一处明确语病，动态支线仍未触发。该结果只覆盖这次传输修复及恢复样例，不改判前两份失败记录，也不代表旁白十维全部通过。

[日常功能验收回执](receipts/daily-gameplay-acceptance-20260914.md)记录用户随后批准的调查、物品、施法、战斗和多人代表性样例，以及正常、拒绝、重试的实际结果。它保留真实失败和旧测试修正后的新阻塞；整条游玩链尚未通过。

| 功能组 | 编号范围 | 项数 |
| --- | --- | --- |
| 理解行动与裁决 | KP-A01–A09 | 9 |
| 动态生成 NPC、物品、地点与危险 | KP-B01–B10 | 10 |
| 动态支线、场景与故事走向 | KP-C01–C09 | 9 |
| NPC 扮演、关系、计划与承诺 | KP-D01–D11 | 11 |
| 物品取得、取用、装备、转交、制作及毁坏 | KP-E01–E12 | 12 |
| 观察、调查、知识与秘密 | KP-F01–F06 | 6 |
| 时间、活动、多人与长团 | KP-G01–G09 | 9 |
| 旁白的十个独立评价维度 | KP-H01–H10 | 10 |
| 故障恢复、审计更正与玩家安全 | KP-I01–I07 | 7 |
| KP 意图与战斗、能力规则衔接 | KP-J01–J08 | 8 |
| 登录建房、建卡开局、界面与语音等 | APP-01–12 | 12 |

## 1. 如何读这份清单

每个功能单独编号，分别列出可见结果、结构不同的样例、高风险边界、现有测试入口和下一项缺口。即使共用一个测试文件，也不能把“文件通过”直接写成其对应全部功能完成。

证据类型：

- **D**：确定性行为测试，真实调用领域或编排代码，外部模型可能是替身。
- **W**：本地 Worker/Room/SQLite 集成测试；除明确标出的 L，模型仍视为受控替身。
- **H**：真实本地 HTTP、身份、持久化和响应链；不自动包含真实模型。
- **V**：组件挂载或浏览器交互。组件挂载通过不证明真实浏览器整段流程。
- **S**：源码字符串、导出、schema 或文件一致性检查，只证明结构存在。
- **L**：真实模型调用；必须再注明是否进入真实 HTTP/Room、是否发布、原始结果和失败阶段。

下表链接是**已找到并核对标题或断言的测试入口**，不是本次新增的验收门。`E01` 等指向第 2 节的历史回执摘要；`—` 表示本次未定位到足以给这一行定性的专项运行回执，不表示仓库从未测过。测试重组的定向结果不能代替各功能的完整验收，未逐项执行的部分仍为未验收。今后结果引用具体源码状态的回执与工具输出，不在本表手填长期有效的“已通过”。

优先级是测试执行顺序：**P0** 为基本游玩、用户列举能力及最高风险正确性；**P1** 为直接变化维度与长期闭包；**P2** 为扩展体验。优先级不降低规格要求。下一项可以是运行已有用例、修复旧夹具、补行为断言或增加真实质量样例，不默认新建测试文件。

## 2. 已找到的历史证据及适用范围

| 编号 | 日期、来源 | 实际记录 | 不能据此宣称的结果 |
| --- | --- | --- | --- |
| E01 | 09-14 [本地预览建房修复](receipts/local-preview-create-room-20260914.md) | H：迁移前建房连续两次 500；补迁移后建房、列表、桌面和管理读取均 200，匿名建房 401。原数据核对及恢复完成 | 没有开局、真实 KP 或浏览器完整建卡证据；既有 0012 迁移的关联数据问题单列 |
| E02 | 09-12 [分组填写回执](receipts/vnext-grouped-steps-wire-validation.md) | v65：Worker 428 项，209 过、214 失败、5 跳过；Node gate 仍有 82 个已登记失败、无新增。v66 只有增量验证 | gate 无新增不等于全绿；不是当前 HEAD 全量结果，旧失败也不能全部判为产品缺陷 |
| E03 | 09-13 [执行依赖与旁白来源](receipts/grouped-wire-state-and-narration-origin-20260913.md) | D：对象/知识 22/22，Claims 3/3；W：目标 5 过、61 跳过。L：新正文及审核通过，旧坏正文反例审核的报告格式仍失败 | 不证明整套旁白稳定；另有 4 个 schema-retrieval 旧失败，主动 stop 旁白路由有未覆盖范围 |
| E04 | 09-13 [检定播报修复](receipts/kp-preview-check-presentation-20260913.md) | D：旁白/失败消费者 46/46。L：3 次调用，用冻结交谈材料生成、审核及坏正文反例审核 | 没有重跑交谈机械或替换旧消息；只证明该检定播报样例，不能外推所有自然度问题 |
| E05 | 09-09 [故事创作实现](receipts/story-creation-implementation-validation.md) | `2791ceb` 的 W 43/43、D 26/26；另有历史 HTTP 2/2。L：`7b80eae` 的 6 次调用只得到普通 social 回应，故事作业和草稿/评审调用均为 0 | **真实动态支线生成未验收**；还观察到模型添加玩家未表达的方法。回执的工作树/提交范围须保留，不能借用为当前 HEAD 结果 |
| E06 | 09-09 [承诺生命周期](receipts/vnext-promise-lifecycle-validation.md) | D 六文件 60/60；W 初次 15/17，修复后失败两项定向通过；同文另有较早阶段证据 | 文首明确真实验收未完成；后面的旧“尚未实现”只代表旧阶段，不能直接当现状 |
| E07 | 09-07 [round57 四步物品链](receipts/vnext-round57-validation.md) | L+H：放下、拾起、组装、拆解四步均提交并发布；4 次重复零新增调用/结算，8 事件 replay 相等 | parser v27 历史样例；未覆盖当前填写面、耗时/战斗组装、他人取得或长期稳定性 |
| E08 | 09-09 [已有对象补全](receipts/vnext-object-completion-validation.md) | D 最终目标 15/15。L：2 次调用的阀门补全核心合同通过，仍有“活动”等含混状态文案 | 未覆盖正常 HTTP、Room DO、最终旁白和下一次真实操作 |
| E09 | 09-06 [观察与推断](receipts/vnext-observe-validation.md)、[知识闭包](receipts/vnext-knowledge-validation.md) | 提供 observe、来源、持有者、Claims 和恢复的定向历史证据 | 结构化来源合法不证明推断合理、关键线索充分或玩家能理解；具体数量以原回执为准 |
| E10 | 09-06 [社交链](receipts/vnext-social-interaction-validation.md)、[社交后果](receipts/vnext-social-commitments-validation.md) | W social/共享后果 5/5；D 社交后果组 40/40；原稿、NPC 来源与私有 Claims 有局部证据 | 没有真实语义稳定性证据；不同措辞的同目标重试等范围在原回执中明确未闭合 |
| E11 | 09-07 [NPC 到期执行](receipts/vnext-actor-plan-due-validation.md) | D 21/21，W 新矩阵 13 过、38 跳过，直接消费者 3 过；受控模型 | 不证明真实 NPC 自主计划与执行质量；形成计划与执行计划是不同验收项 |
| E12 | 09-05 [叙述承诺与物品](receipts/vnext-narrative-validation.md) | D 叙述承诺、上下文、物品及消费者有局部通过；同文保留真实失败 | 初期真实失败不能改记为通过；后来 E07 只补足其实际四步物品样例 |
| E13 | 09-13 [知识表达与归档重试](receipts/kp-preview-knowledge-and-retry-20260913.md) | 定向归档退避/恢复通过；旧完整归档文件另有 5 项失败；候选 Prompt 的真实反例检查保留失败 | 部分 Prompt 是暂存候选，旧房未迁移，不算已在现役房间生效 |

初始盘点为 208 个 `.test.mjs`、65 个 `.test.ts` 和两个独立配置的 `.test.mts`，共 275 文件；此前“273”漏计了后两项。重组后由 `npm run test:list` 递归生成当前清单：291 个测试/评测文件，其中 1 个为隔离的真实模型入口。[当前基线](../../.gate-baseline.json)由原 84 个 Node 失败名删除两个已退役的源码哈希检查名，保留其余 82 个；这不是修好了两个产品缺陷，也不是 E02 的 82 个实际失败口径。[CI 配置](../../.github/workflows/gate.yml)与[运行脚本](../../package.json)决定实际收集范围。

## 3. KP 功能逐项验收

### A. 理解行动与裁决

依据：[SPEC 0001 §§5–6、13](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0004 §§2–5、10–11](../specs/0004-kp-and-noncombat-mechanics.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-A01 接受未预写的合理行动 | 用绳索搭过沟通路；改用杠杆抬门，均按实际方法裁决并留下结果 | 未登记 Interaction 不能成为拒绝理由 | W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts)：吊灯、烧绳及原子物化 | P0：当前正常 HTTP 上验证两种自由方法，不能只跑固定领域命令 |
| KP-A02 无风险直接成功 | 推开普通未锁门；拿起手边无争议物品，直接呈现结果 | 没有失败后果仍要求掷骰 | [B/H 判断探针](../../tools/spec-0001-behaviour-probes.mjs)由调用方提供模型；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts) | P0：先核对探针是否适配现役选择/填写链，再做真实语义验收 |
| KP-A03 有意义检定与骰前固定 | 撬危险门锁；识别受干扰声音，技能、DC、成本和分支先冻结 | 看见骰点后改 DC、伤害或成功标准 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)：five feasibility / pre-random freeze；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts) | P0：同次保存公开风险、冻结参数、骰面和实际分支；真实 DC 公正另评 |
| KP-A04 高风险可行 | 冒险跨越断桥；用昂贵工具拆险，预示实际风险并允许选择 | 因等级低直接降危险，或确认后反复阻止 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)、[npc-mechanical-definition](../../tests/kp/npc/npc-mechanical-definition.test.mjs) | P1：模型能否区分“很难”和“不可能”；内核接受高数值只证明后半段 |
| KP-A05 缺前提与不可能的区分 | 缺钥匙时说明可寻钥匙；徒手拆不可破坏石门时明确拒绝 | 用虚假超高 DC 表示不可能，或把技术故障说成世界拒绝 | D [feasibility](../../tests/kp/adjudication/materialization-and-feasibility-rules.test.mjs)；[B 判断探针](../../tools/spec-0001-behaviour-probes.mjs)由调用方提供模型 | P0：两种拒绝的原因、替代方向和零新增效果分别断言 |
| KP-A06 重大歧义澄清 | “处理守卫”可能交谈或攻击；“烧掉它”存在贵重目标，先确认具体意图 | 擅自选危险解释；明确回答后又换意图或重裁决 | D [clarification](../../tests/kp/adjudication/clarification.test.mjs)；W [time-passage-room](../../tests/kp/time/time-passage.room.test.ts)，E03 | P0：用户原话→问题→本人回答→待决恢复的真实链；普通明确动作不强制澄清 |
| KP-A07 准备、工具与裁定先例 | 先侦察再潜入；同条件用同工具再处理相似门，准备有实际作用、同类判断一致 | 没有事实依据白送优势，或相同条件随意改 DC | W ~~adjudication-precedent~~（已删除，ADR 0028）；D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs) | P1：真实模型对准备价值和跨轮先例的判断，不以字段存在代替 |
| KP-A08 失败后不原样刷骰 | 撬锁失败改变局面；换工具或接受实际成本后才重新尝试 | 只换一句话就获得新骰；失败无变化仍反复要求重试 | W [ending-reorientation](../../tests/kp/stories/ending-reorientation.room.test.ts)；D [social-plan](../../tests/kp/npc/social-plan.test.mjs)，E10 | P0：同目标换措辞、实质换方法两组对照，保留合法重新裁决 |
| KP-A09 一句话含多个因果步骤 | 制作物件后交付；观察后谈判并产生条件后果，按依赖原子结算 | 后一步非法却留下前半件物品；互斥分支一起执行 | D [world-fact-memory](../../tests/kp/knowledge/world-fact-memory.test.mjs)、[object-completion](../../tests/kp/world/object-completion.test.mjs)；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts)，E03 | P0：当前 grouped wire 的两种不同结构加失败/恢复，核对单一事件与物品身份 |

### B. 动态生成世界内容

依据：[SPEC 0001 §§3–4、7–8](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0006 §§3–8](../specs/0006-module-npc-and-faction-protocol.md)、[SPEC 0016 §5](../specs/0016-part-b-sparse-semantics-and-primitives.md)及[§§7–8](../specs/0016-part-c-compound-actions-and-claims.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-B01 动态生成普通 NPC | 在合理地点遇到新修理匠；支线生成新证人，身份、目标、顾虑与后续可交互性保存 | 同名替换旧 NPC；凭空获得玩家控制权、秘密知识或既往经历 | D [npc-materialization](../../tests/kp/npc/npc-materialization.test.mjs)、[story-materialization](../../tests/kp/stories/story-materialization.test.mjs)；W [story-action-room](../../tests/kp/stories/story-action.room.test.ts)，E05 | P0：真实生成→再次交谈→重启后仍同一人；零初始知识与有来源授知分开验证 |
| KP-B02 动态生成敌人和机械能力 | 合理强敌进入场景；普通 NPC 后来进入战斗，按已固化能力、装备和 HP 执行 | 高数值自动削弱；非法自创效果被当成功；进入战斗重置伤势 | D [npc-mechanical-definition](../../tests/kp/npc/npc-mechanical-definition.test.mjs) | P0：生成→第一次真实行动/资源变化→恢复；静态定义合法不等于敌人能行动 |
| KP-B03 动态生成普通物品 | 新造木盒；生成一叠有明确数量的凭证，先有定义和实物，再允许取得 | 只在旁白出现就进背包；唯一物品重复生成；场景物品直接归玩家 | D [authored-materialization](../../tests/kp/adjudication/authored-materialization.test.mjs)、[narrative-item](../../tests/kp/narration/narrative-item.test.mjs)，E12 | P0：真实模型生成两类不同物品，验证可见实例、所有权和下一轮拾取 |
| KP-B04 动态生成有机械效果的物品 | 有次数的治疗物品；有持续状态效果的物品，效果按规则编译并可用 | 奖励较强就收回；模型写脚本/状态补丁；定义通过但使用无效果 | D [authored-materialization](../../tests/kp/adjudication/authored-materialization.test.mjs)、[item-materialization](../../tests/kp/items/item-materialization-causal.test.mjs) | P0：真实生成后实际使用，包含消耗、结束效果和非法效果拒绝 |
| KP-B05 动态生成地点 | 从既有线索发现新院落；发现有边界的室内空间，保存地点与可见几何 | 生成即传送、提前看到内部秘密或覆盖现有地点 | D [dynamic-locations](../../tests/kp/world/dynamic-locations.test.mjs)，W [dynamic-locations-room](../../tests/kp/world/dynamic-locations.room.test.ts) | P1：正常输入生成、发现、通行、返回后身份一致 |
| KP-B06 动态生成通路 | 创建连接既有地点的侧门；创建通往新地点的狭道，方向与通行条件明确 | 连接不存在的端点；无成本瞬移；通路变化后仍用陈旧路径 | D/W [dynamic-locations](../../tests/kp/world/dynamic-locations.test.mjs)、[Room](../../tests/kp/world/dynamic-locations.room.test.ts) | P1：生成和走过去必须是可区分的状态转换，并测组队同意 |
| KP-B07 环境描写与叙述承诺 | 描述墙边落地灯；描写门廊外观，后续再看保持一致 | 未存承诺便反复改色/改位置；一句装饰描写直接改变机械 | D [narrative-details](../../tests/kp/narration/narrative-details.test.mjs)、[narrative-context](../../tests/kp/narration/narrative-context.test.mjs)，E12 | P0：真实描写→离开返回→恢复；同时核对存储与最终正文 |
| KP-B08 被引用细节的固化与已有对象补全 | 玩家利用刚描述的灯；调查已有阀门的未定细节，保持原身份再裁决 | 补全等同玩家操作；换新对象逃避旧事实；骰后才决定影响结果的细节 | D [object-completion](../../tests/kp/world/object-completion.test.mjs)、[narrative-item](../../tests/kp/narration/narrative-item.test.mjs)，E08、E03 | P0：现有 L 样例缺 Room 与最终旁白，补同一条完整本地路径 |
| KP-B09 动态生成陷阱和环境危险 | 压力触发陷阱；范围烟雾危险，迹象、解除、触发、豁免与后果完整 | 无迹象/无触发就伤害；模型直接宣告死亡；临时增加第二层机关 | D [authored-materialization](../../tests/kp/adjudication/authored-materialization.test.mjs)、[hazard-actor-death](../../tests/kp/world/hazard-actor-death-fold.test.mjs)；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts) | P0：生成→察觉/解除或触发→规则伤害/死亡；另评真实风险预示与公正 |
| KP-B10 隐藏现实与合法空白 | 未定义门后合理为空；另一个留白有不同合理候选，证据前确定 | 玩家低 HP 后偷偷换空房；每次探索强塞奖励；恢复后重抽 | W ~~hidden-reality-room~~（已删除，ADR 0028）；D [module-npc](../../tests/kp/npc/module-npc.test.mjs) | P1：同条件不同 HP 的模型材料对照与冻结后恢复，不能要求每次必生成内容 |

### C. 动态支线、场景与故事走向

依据：[SPEC 0001 §§3–4、11、13、18](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0009 §§1–5、7–9](../specs/0009-failure-pacing-conclusion-and-interaction.md)、[故事准备的补充合同](../specs/0016-part-c-compound-actions-and-claims.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-C01 动态创建支线 | 玩家愿意帮助 NPC 处理具体麻烦；另一次调查旧档案，形成有因果、参与者、线索和收束边界的支线 | 把普通问候强制扩成任务；准备稿等同已发生世界事实；改写主线真相 | D [story-creation](../../tests/kp/stories/README.md)；W [story-action-room](../../tests/kp/stories/story-action.room.test.ts)、[story-world-event-room](../../tests/kp/stories/story-world-event.room.test.ts)，E05 | **P0：L+H 必须实际创建准备作业并接入世界；E05 的普通回应不能抵扣** |
| KP-C02 支线自由解决、失败与放弃 | 谈判代替潜入；玩家明确放弃后保留已付代价，支线能结束 | 只认准备稿预写答案；为创作成本惩罚离开；强行送回主线 | D [story-creation](../../tests/kp/stories/README.md)；W [ending-reorientation](../../tests/kp/stories/ending-reorientation.room.test.ts)，E05 | P0：存在准备材料后，走未预写合法解法与明确放弃两条真实后续 |
| KP-C03 支线多阶段与个人关注 | 地方问题进入不同阶段；由玩家明示背景引出个人牵连，阶段问题确实变化 | 换标题但反复同一任务；擅造玩家过去、债务或动机 | D [story-creation](../../tests/kp/stories/README.md)：long / player context；W [story-action-room](../../tests/kp/stories/story-action.room.test.ts)，E05 | P1：真实长线留到合法自然节点，不把单稿结构完整当多阶段可玩 |
| KP-C04 冗余线索与新调查路线 | 错过证人仍能查账；观察基础痕迹失败后可寻找独立来源 | 唯一骰点封死全部核心结论；多个“线索”其实同源复述 | D [story-creation](../../tests/kp/stories/README.md)：evidence sources；D [observe](../../tests/kp/knowledge/observe.test.mjs)，E05、E09 | P0：实际失去一条线索后继续游玩；人工判断来源独立与答案诚实 |
| KP-C05 玩家停滞时重新定向 | 玩家说不知下一步；分头后忘记当前问题，提示已知线索和可互动方向 | 无因果援军/灾难；替玩家解决；把提示变封闭菜单 | W [ending-reorientation](../../tests/kp/stories/ending-reorientation.room.test.ts) | P0：真实回应能帮助行动，同时允许第三种合理方法 |
| KP-C06 场景结束与节奏切换 | 门已打开后概括无风险路程；谈判已有明确结论后交回决定权 | 跳过仍有资源/危险的过程；NPC 互聊把玩家晾在一边 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)；W [ending-reorientation](../../tests/kp/stories/ending-reorientation.room.test.ts) | P1：需要真实连续对话及人工节奏评价，不能仅断言 scene 字段 |
| KP-C07 故事收束 | 核心冲突成功后结束；不可逆失败或明确放弃也能结束 | 新黑手撤销胜利；只接受唯一 ending 枚举；失败后无限追加任务 | W [ending-reorientation](../../tests/kp/stories/ending-reorientation.room.test.ts) | P1：成功、失败、放弃三种收束各保留状态与实际正文 |
| KP-C08 尾声与长期后果呈现 | 胜利后展现当地变化；失败后保留失去的机会，由玩家选择个人尾声 | 自动替玩家决定余生；牺牲或损失在尾声被无因果抹去 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)：recordEpilogueChoice | P1：实际玩家选择与各 Viewer 的后果呈现，不把 concluded 字段当尾声验收 |
| KP-C09 玩家自选续篇 | 明确继续后进入新冒险；明确结束时停在原结局 | 强制续篇、撤销旧结局、把未同意角色自动带入新章 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)：real sequel boundary | P1：新旧 Story/Chapter 边界、同意及旧后果保存的完整路径 |

### D. NPC 扮演、关系和主动行为

依据：[SPEC 0001 §§9、11、14、16](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0006 §§4–7](../specs/0006-module-npc-and-faction-protocol.md)、[SPEC 0005 §8](../specs/0005-world-facts-and-knowledge.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-D01 NPC 回答、沉默与交涉 | 询问已知事情得到具体回答；同一人拒绝或确实不知，语言与态度符合处境 | 自动迎合、假装知道；沉默生成了一条实际上没说的话 | D [social-plan](../../tests/kp/npc/social-plan.test.mjs)；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts)，E10 | P0：真实回答、拒绝、不知三类；声口质量另外看 KP-H03 |
| KP-D02 NPC 有限知识与势力传播 | 未听到计划的守卫不反制；收到同伴实际通报后才采取针对行动 | 同一模型处理多个 NPC 就共享秘密；同名知识引用串人 | D [npc-decision-context](../../tests/kp/npc/npc-decision-context.test.mjs)、[world-fact-memory](../../tests/kp/knowledge/world-fact-memory.test.mjs)，E03 | P0：保持其余情境相同，仅改变是否获知；同时检查模型输入与实际反应 |
| KP-D03 NPC 谎言、误解与来源 | NPC 为利益说谎；另一 NPC 因过时消息误判，台词保持来源身份 | KP 全知旁白冒充真相；为挽救坏回应事后捏造欺骗动机 | D [social-plan](../../tests/kp/npc/social-plan.test.mjs)、[source-claims](../../tests/kp/narration/source-claims.test.mjs)，E09、E10 | P0：真假台词均合法，但知识与世界真相必须分别断言 |
| KP-D04 动态形成 NPC/势力计划 | 守卫依据动静安排巡逻；商人依据自己的承诺安排送货，保存未来下一步 | 计划刚形成就扣资源、移动、交付或公开未来痕迹 | W [npc-plan-formation-room](../../tests/kp/npc/npc-plan-formation.room.test.ts)，E11 只证明到期执行 | P0：真实形成计划的调用与持久化另留证，不能借到期 fixture 当创作成功 |
| KP-D05 到期行动、改计划与失败 | 虚构时间到期执行送货；途中受阻后延期、取消或改合法目标 | 现实等待就行动；模型失败自动攻击/pass；同一工作重复执行 | W [actor-plan-due-room](../../tests/kp/npc/actor-plan-due.room.test.ts)、[promise-lifecycle-room](../../tests/kp/npc/promise-lifecycle.room.test.ts)，E11、E06 | P0：形成→到期→实际动作→可见后果闭合，失败和恢复复用原工作 |
| KP-D06 关系变化 | 帮助后改变关系；欺骗被揭穿后恶化，关系对象和因果依据不变 | 一次检定强制洗脑；关系变化被写给同名另一人 | D [social-commitments](../../tests/kp/npc/social-commitments.test.mjs)、[social-plan](../../tests/kp/npc/social-plan.test.mjs)，E10 | P1：真实台词与已保存关系一致，拒绝无来源的覆盖 |
| KP-D07 新承诺与玩家同意 | NPC 承诺交付物品；玩家自己明确保证保密，义务主体和条件精确 | NPC 替玩家作承诺；说完就算完成；没有明确义务却凭空登记 | D/W [promise-lifecycle](../../tests/kp/npc/promise-lifecycle.test.mjs)、[Room](../../tests/kp/npc/promise-lifecycle.room.test.ts)，E06 | P0：无承诺普通对话为对照，真实台词/记录/受众三方核对 |
| KP-D08 履约与部分交付 | 分两次交付后完成；保密义务真实持续到期，按证据复核 | 用“已送达”台词代替物品转移；部分完成提前算全部；未来证据提前定案 | D/W [promise-lifecycle](../../tests/kp/npc/promise-lifecycle.test.mjs)、[Room](../../tests/kp/npc/promise-lifecycle.room.test.ts)，E06 | P0：真实交付和持续义务两种结构分别贯穿到期复核与恢复 |
| KP-D09 债务与长期人情后果 | 交易形成明确欠款；救助留下有依据的债务/关系，跨场景仍可追溯 | 凭空给玩家添债；同一债务重复登记；私债公开给不知情者 | D [social-commitments](../../tests/kp/npc/social-commitments.test.mjs)、[promise-subjects](../../tests/kp/npc/promise-subjects.test.mjs)，E10 | P1：实际履行/更正/跨章后的债务状态需独立核验，创建测试不足以覆盖全生命周期 |
| KP-D10 失约与补救历史 | 到期未交付；提前泄露后后来补救，实际违约与原因、责任评价分开 | 技术失败直接算角色失信；补交/原谅抹掉违约历史；秘密复核广播全桌 | D [promise-lifecycle](../../tests/kp/npc/promise-lifecycle.test.mjs)：early disclosure / after breach，E06 | P1：真实期限和世界证据先成立；违约、后续补救及隐私分别断言 |
| KP-D11 延期、改约与解除 | NPC 请求延期获同意；另一请求被拒或部分免除，条款版本与剩余义务明确 | 改内部计划就解除承诺；替玩家编同意；修改过去已发生的违约 | D/W [promise-lifecycle](../../tests/kp/npc/promise-lifecycle.test.mjs)、[Room](../../tests/kp/npc/promise-lifecycle.room.test.ts)，E06 | P1：同意、拒绝、部分解除三种结果；真实措辞与版本化记录核对 |

### E. 物品的取得、取用与生命周期

依据：[SPEC 0001 §§8、16](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0004 §6](../specs/0004-kp-and-noncombat-mechanics.md)、[SPEC 0013](../specs/0013-versioned-runtime-profiles.md)。生成定义与实例见 KP-B03/B04；这里验实际物品操作。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-E01 拾取与取得 | 捡地上物品；接收 NPC 真正放下的物品，场景/持有者与背包数量对应变化 | 远程拿走、抢先取得未完成物品、重复请求复制 | D [inventory-operations](../../tests/kp/items/README.md)、[promise-lifecycle](../../tests/kp/npc/promise-lifecycle.test.mjs)，E07 | P0：当前填写链复验普通拾取和 NPC 交付，区分所有权与实际持有 |
| KP-E02 从背包取出、放下与收回 | 取出一根火把放身旁；从一叠物品中放下部分后收回，保存实例与数量 | 原件消失又新造替身；拆分/合并后数量漂移 | D [inventory-operations](../../tests/kp/items/README.md)，E07 | P0：当前真实 HTTP 复验部分堆叠与非堆叠物品 |
| KP-E03 装备与卸下 | 穿戴实际护甲；更换手中工具，槽位和可用能力由真实条目派生 | 用目录 ID 装备不存在的物品；耗时过程尚未结束就生效 | D [item-loadout](../../tests/kp/items/item-loadout-authority.test.mjs)、[inventory-operations](../../tests/kp/items/README.md)；V [inventory-panel](../../tests/product/inventory/inventory-panel.test.mjs) | P0：背包点击/自然语言到装备、AC/能力和可见状态闭环 |
| KP-E04 使用、消耗与效果 | 喝治疗物品；使用有次数和耐久的装置，成本与效果同时正确 | 次数耗尽仍成功；只扣物品没效果；重试双扣或重掷 | D [item-use-costs](../../tests/kp/items/item-use-costs.test.mjs)、[inventory-operations](../../tests/kp/items/README.md)；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts) | P0：两种结构、满血/不足资源边界、失败恢复与旁白一致 |
| KP-E05 转交与交易 | 玩家转交部分箭；NPC 交换物件/费用，双方实际库存与所有权正确 | 只说交易成功没有转移；一方付款而另一方未交付仍报成功 | D [item-materialization](../../tests/kp/items/item-materialization-causal.test.mjs)、[inventory-operations](../../tests/kp/items/README.md)，E06 | P0：已有转交测试不能证明完整双边交易，补实际成本与交付同源证据 |
| KP-E06 抢夺或从他人处取物 | 合法检定成功夺物；失败仍在原持有者处，结果按分支固定 | 客户端伪造授权；失败分支也转移；隐藏库存泄露 | D [inventory-operations](../../tests/kp/items/README.md)：foreign-held transfer | P1：真实意图与授权检定→双方投影，不能把普通转交当抢夺验收 |
| KP-E07 识别与未知物品 | 调查未知物品获得合法细节；未知但已装备物品可按允许操作卸下 | 未鉴定直接显示秘密能力；用静态目录补出隐藏属性 | V [inventory-panel](../../tests/product/inventory/inventory-panel.test.mjs)；D [item-projection-visibility](../../tests/kp/items/item-projection-visibility.test.mjs) | P1：识别的知识授予与原条目身份、后续显示一并验证 |
| KP-E08 组装与制作 | 用绳和餐具组装警铃；用不同组件做临时结构，组件被占用且可操作 | 无材料造物；组装凭空授予未注册魔法；占用组件重复使用 | D [item-assemblies](../../tests/kp/items/item-assemblies.test.mjs)，E07 | P0：普通组装与需独立生成定义的制作分开补证；耗时/战斗不能借组装绕过 |
| KP-E09 拆解与回收 | 拆警铃还原可回收原件；另一组合有耗损部件，按冻结回收规则恢复 | 无损复制组件；把不可恢复材料补回来；他人拆解无权限 | D [item-assemblies](../../tests/kp/items/item-assemblies.test.mjs)，E07 | P1：完整回收、部分回收、无权限三个边界，不能只验证理想拆解 |
| KP-E10 物品损坏与失效 | 工具耐久耗尽破坏；受损装备影响可用能力与槽位 | 耐久归零仍能用；只有旁白称损坏而机械照旧 | D [item-use-costs](../../tests/kp/items/item-use-costs.test.mjs)、[inventory-operations](../../tests/kp/items/README.md) | P1：耗损与直接损坏两种原因，经实际入口到状态、装备及正文 |
| KP-E11 物品修复 | 修复仍存在的破损工具；另种有耐久定义的物品恢复合法状态 | 修复制造新实例；回满已消耗数量/次数；恢复已不可逆毁坏的物品 | D [inventory-operations](../../tests/kp/items/README.md)：lifecycle repair | P1：现有 reducer 例子之外补真实前提、成本和不可修复拒绝，不预设免费维修 |
| KP-E12 物品毁坏与知识保留 | 烧毁已读文书；毁坏已辨明工具，实物不可再用但既得知识保留 | 实物复活；毁物抹掉所有人的记忆；重新物化复制唯一物品 | D [inventory-operations](../../tests/kp/items/README.md)、[narrative-context](../../tests/kp/narration/narrative-context.test.mjs) | P1：物品状态、可见库存和角色知识三方对照及恢复 |

### F. 观察、调查、知识与秘密

依据：[SPEC 0001 §9](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0005 §§5–9](../specs/0005-world-facts-and-knowledge.md)、[SPEC 0010](../specs/0010-observer-specific-presentation.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-F01 感官观察与具体回答 | 查看桌面刻痕；听门后声音，只获得当次实际感官证据 | 问了问题就当已经看见；明显事实无故藏在检定后；越感官直接给真相 | D [observe](../../tests/kp/knowledge/observe.test.mjs)，E09 | P0：正常观察和受阻感官的真实问答、实际知识差量 |
| KP-F02 有依据的角色推断 | 根据脚印和经验推测人数；回顾已有证据形成解释，不伪造新的观察 | 把推断当事实或强制玩家相信；没有依据却给精确结论 | D [observe](../../tests/kp/knowledge/observe.test.mjs)，E09、E13 | P0：对原始证据人工判定解释范围；失败候选 Prompt 不能算现役修复 |
| KP-F03 传闻和文献来源 | NPC 转述旧消息；文书有作者与时点，内容真假和“某人说过”分开 | 来源丢失、过时消息被写成当前真相、凭空创建假线索 | D [source-claims](../../tests/kp/narration/source-claims.test.mjs)、[world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)，E09、E10 | P1：跨轮交叉验证和证伪，不能只测 ref 合法 |
| KP-F04 不同观察者的信息隔离 | 同场不同技能获得不同额外信息；分处两地互不可见 | 偷换 Viewer、猜引用、重连或错误返回泄露另一人的秘密 | H [observer-http-privacy](../../tests/product/identity/observer-http-privacy.http.test.mjs)；D [claims](../../tests/kp/narration/claims.test.mjs) | P0：成对账户输入/响应对照，含正文、知识、地图与错误旁路 |
| KP-F05 世界内分享知识 | 玩家实际告诉同伴发现；NPC 有效通信后对方才获知 | 同队自动共享秘密；未听见的台词自动传播；消息提及物品即转交 | D [world-fact-memory](../../tests/kp/knowledge/world-fact-memory.test.mjs)、[social-plan](../../tests/kp/npc/social-plan.test.mjs) | P1：说出前/后、能听见/听不见及后来 NPC 行为的同链对照 |
| KP-F06 知识记录与再次查阅 | 同一对象的看见、触摸与推断可辨认归组；不同来源同文案保持来源 | 同文案不同物件合并、隐藏依据进入卡片、恢复后知识丢失 | D [knowledge-notebook](../../tests/product/knowledge/knowledge-notebook.test.mjs)、[narrative-context](../../tests/kp/narration/narrative-context.test.mjs)，E13 | P1：真实桌面阅读、刷新/恢复后显示与权限；归组测试不证明整个 UI |

### G. 时间、活动、多人与长团

依据：[SPEC 0001 §§11、15–16](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0007](../specs/0007-multiplayer-room-and-fiction-time.md)、[SPEC 0008](../specs/0008-long-campaign-lifecycle.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-G01 等待与虚构时间 | 等待明确时长；被动观察到真实期限，按到期顺序推进 | 页面闲置/掉线自动罚时；提前执行另时间线未来行动 | D [time-passage-rules](../../tests/kp/time/time-passage-rules.test.mjs)；W [ending-reorientation](../../tests/kp/stories/ending-reorientation.room.test.ts) | P0：等待前后时间、资源、知识及到期队列，浏览器闲置作零变化对照 |
| KP-G02 耗时活动、中断与继续 | 调查进行中出现合法新消息；长施法继续或取消，保留已耗时间和原意图 | 中断后白得结果；条件变了仍结算旧成果；战斗借此绕过行动经济 | D [activity-attention](../../tests/kp/time/activity-attention.test.mjs)；W [time-passage-room](../../tests/kp/time/time-passage.room.test.ts)，E03 | P0：活动开始→选择/玩家骰→实际完成→恢复，主动 stop 旁白另补 |
| KP-G03 短休与恢复资源选择 | 个人短休花生命骰；另一职业按其规则选择恢复资源，耗时足够才生效 | 未选择自动花骰；无资格仍恢复；重复请求再次恢复 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)、[authoritative-table](../../tests/product/characters/authoritative-table.test.mjs) | P0：实际时间、本人选择、随机与资源上限及重复请求 |
| KP-G04 分头行动、组队与因果前沿 | 两组在不同地点行动；同意后一起穿过通路，各自信息与时间正确 | 队长替成员选个人行动；未来事件提前泄露；移动拆成半队成功 | D [rules-multiplayer](../../tests/product/multiplayer/rules-multiplayer.test.mjs)、[dynamic-locations](../../tests/kp/world/dynamic-locations.test.mjs)；W [multiplayer-room](../../tests/product/multiplayer/multiplayer.room.test.ts) | P1：双用户正常 API 的组队、分离、重会合，不限内核 fixture |
| KP-G05 多人聚光灯与安静玩家 | 活跃玩家连续发言后在自然决定点交给另一人；分头调查各有决定机会 | 字段记了轮转但实际没人得到行动权；强迫沉默玩家表演 | D/W [rules-multiplayer](../../tests/product/multiplayer/rules-multiplayer.test.mjs)、[multiplayer-room](../../tests/product/multiplayer/multiplayer.room.test.ts)；[A–O 登记](../../tests/platform/architecture/spec-0001-acceptance.structure.test.mjs) | P1：真实多人轨迹人工标注决定点/邀请/自主权；账本测试不证明 KP 调度质量 |
| KP-G06 章节转换与长期后果 | 带着伤势、物品、关系进入下一章；旧承诺和未解决威胁按因果延续 | 换章清空债务/伤势；章节回顾泄露秘密；强把小伏笔升级大阴谋 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)；W [chapter-continuity](../../tests/kp/campaign/chapter-continuity-manifest.room.test.ts) | P1：跨章串联物品、知识、承诺，真实叙事回响与长期记忆另评 |
| KP-G07 死亡、退役与继任 | 角色依法死亡后新角色入团；明确同意的退役转 NPC，继承有合法来源 | 同账号继任自动获得旧角色秘密；为保剧情恢复死者或撤销损失 | W ~~death-successor-correction~~（已删除，ADR 0028）、[viewer-narration-recovery](../../tests/platform/recovery/viewer-narration-recovery.room.test.ts)；D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs) | P1：旧 Viewer 的待恢复正文与新角色信息严格分开，保留更正路径 |
| KP-G08 长休、同意与中断 | 个人满足长休条件后恢复；多人分别选择，某人中断后只有合格者完成 | 未同意者被休息；中断仍满恢复；重启绕过期限或战斗限制 | W ~~rest-activity-eviction~~（已删除，ADR 0028）；D [rules-multiplayer](../../tests/product/multiplayer/rules-multiplayer.test.mjs) | P0：时长、同意、通知、中断/重启、到期和重复结算分别核对 |
| KP-G09 成长与能力选择 | XP 跨阈值后由玩家选成长；里程碑按绑定规则授予，恢复不重复升级 | KP 替玩家选能力；D1 同步失败抹掉 DO 成长；缺定义伪造能力 | D [world-campaign](../../tests/kp/campaign/world-campaign.test.mjs)；W [growth-d1-boundary](../../tests/kp/campaign/growth-d1-boundary.room.test.ts) | P1：资格→待选→本人确认→能力可用→恢复的实际链 |

### H. 旁白自然、通顺、不出戏

依据：[SPEC 0001 §12、§20](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0009 §6](../specs/0009-failure-pacing-conclusion-and-interaction.md)、[SPEC 0016 §8.3](../specs/0016-part-c-compound-actions-and-claims.md)。**这十项分别评分；JSON 合法、提示词含规则和模型自评通过均不能替代真实正文验收。**

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-H01 中文通顺与自然衔接 | 交谈回答接上玩家问题；动作结果接上前一句，主语、代词、时态和因果可读 | 生硬翻译腔、断句、逻辑跳跃、每轮同一套模板 | D [narration](../../tests/kp/narration/README.md)：natural paraphrase，E03/E04 为局部 L | **P0：真人按第 5 节独立评价实际正文；现有 mock 不能证明自然度** |
| KP-H02 具体、简洁、可行动 | 场景给有功能的感官细节；困惑时给可互动对象与方向 | 长篇修辞没有信息；信息堆积掩盖当前问题；强制固定五段 | D [narration](../../tests/kp/narration/README.md)、[claims](../../tests/kp/narration/claims.test.mjs)只支持材料边界 | P0：真实开场、调查、失败后三种正文的可行动性人工评价 |
| KP-H03 NPC 声口与角色一致 | 两个不同身份的人说话可辨；同一 NPC 跨轮态度变化有原因 | 所有人同一口吻；突然知道秘密、性格反转；NPC 长时间互聊 | D [narration](../../tests/kp/narration/README.md)：same-name identity / expression context；E10 | P0：同人三轮与两人对照，声口不靠姓名标签或固定口头禅判断 |
| KP-H04 不替玩家决定内心和行动 | 描述威胁和身体状态后交回选择；按玩家原方法润色动作 | 擅写“你决定”“你相信”、额外拿物品、未表达的避开某话题 | D [narration](../../tests/kp/narration/README.md)、[world-fact-memory](../../tests/kp/knowledge/world-fact-memory.test.mjs)，E03、E05 | P0：保留原意图逐项比对，允许不改变后果的普通润色；另设合法控制效果样例 |
| KP-H05 世界内表达、不播技术说明 | NPC 用实际台词表现交谈结果；观察描述看见/未听清的东西 | 附加“交涉成功、总值、DC”结算播报；暴露表单、内部 ID 或系统解释 | D [narration](../../tests/kp/narration/README.md)，E04 | P0：同义技术播报反例与不同检定结构，不做生成后关键词删除；骰子 UI 另验 |
| KP-H06 忠实且完整表达实际后果 | 治疗同时消耗药剂；行动失败仍有真实资源损耗，正文不改结果 | 只报成功漏代价；没发生的伤害/物品/潜行成功被说成事实 | D [claims](../../tests/kp/narration/claims.test.mjs)、[narration](../../tests/kp/narration/README.md)；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts)，E03/E04 | P0：真实事件、Viewer 材料、正文逐组核对；自然表达不要求机械术语逐字复述 |
| KP-H07 跨轮连续性与不重复旧动作 | 上轮已拿物，本轮只交谈；耗尽/损坏后再次描述状态正确 | 旧玩家请求当已听台词或新结果；物品死而复生、身份漂移 | D [narration](../../tests/kp/narration/README.md)、[narrative-context](../../tests/kp/narration/narrative-context.test.mjs)，E03 | P0：连续取物→交谈→等待→回看状态，原重复正文作固定坏例保留 |
| KP-H08 延时完成仍归属原行动 | 调查后来完成；被 NPC 插入动作打断后续办，讲对谁做了什么 | 把调度触发者当行动者；用最近一句聊天代替原目标；澄清答案覆盖起始意图 | D [narration](../../tests/kp/narration/README.md)；W [time-passage-room](../../tests/kp/time/time-passage.room.test.ts)，E03 | P0：普通完成、澄清后完成、主动停止各自核对，不能用一个 child root 例子全包 |
| KP-H09 旁白失败重试与冻结表达 | 提交后模型故障，再恢复同一行动结果；另一受众已成功时只恢复失败者 | 重试重裁决/重掷/再扣物品；新世界信息改变旧回应；已发内容重复结算 | D [narration-provider-failure](../../tests/kp/narration/narration-provider-failure.test.mjs)；W [viewer-narration-recovery](../../tests/platform/recovery/viewer-narration-recovery.room.test.ts)，E13 | P0：真实失败/恢复入口，区分已冻结事实与允许的重新表达，核对调用与事件数 |
| KP-H10 视角、秘密与受众 | 同一事件给两个角色不同合法叙述；同名 NPC 仍不串身份 | 好听但泄露幕后动机、未见物品、私人认知或其他角色原意图 | H [observer-http-privacy](../../tests/product/identity/observer-http-privacy.http.test.mjs)；D [narration](../../tests/kp/narration/README.md) | P0：成对真实正文及请求材料检查；公开相同、隐藏不同的对照不泄漏差异 |

### I. 可靠性、错误、更正与玩家安全

依据：[SPEC 0001 §§17、19](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0003](../specs/0003-authoritative-action-transaction.md)、[SPEC 0011](../specs/0011-reliability-correction-observability-and-evaluation.md)。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-I01 选能力、填写与有界修订 | 新 NPC 要选对应类型；复合造物要补全依赖，具体错误进入适用修订流程 | 为凑通过补假字段、换玩家方法、无限重采；错误类型借到额外调用 | D [schema-retrieval](../../tests/kp/protocol/schema-retrieval.test.mjs)、[proposal-revision](../../tests/kp/protocol/proposal-revision.test.mjs)；W [provider-room](../../tests/kp/provider/provider.room.test.ts)，E02、E03 | P0：已知旧失败逐名核对；现役实现和已裁定修订额度若冲突，保留冲突，不能随代码改表变绿 |
| KP-I02 幂等、权威随机与重复提交 | 同一次行动断网重试；检定保存后服务恢复，保留同骰/同结算 | 新造 submission 冒充重试；重复成本或多抽候选 | W ~~randomness-recovery~~（已删除，ADR 0028）、[stage3-room](../../tests/kp/adjudication/stage3.room.test.ts)，E07 | P0：原 submission 的完整返回、事件、随机与资源对照，UI 保留原重试入口 |
| KP-I03 Provider 故障与未知结果 | 明确未发出可继续；已发出但响应未知保持待恢复，公开错误真实且脱敏 | 超时就伪造成功/空世界；偷偷换模型；未知调用当零成本 | D [model-call-scope](../../tests/kp/provider/model-call-scope.test.mjs)、[narration-provider-failure](../../tests/kp/narration/narration-provider-failure.test.mjs)；W [story-preparation-host](../../tests/kp/stories/story-preparation-host.room.test.ts)，E11 | P0：零发送、已完成、未知三态；用本地故障注入，不靠无界真实重试 |
| KP-I04 归档、重启与重建 | 服务驱逐后继续原待决；从完整归档恢复并核对状态和故事材料 | 丢稿当空历史重新生成；恢复跳过权限；秘密投影变化 | W [archive-do-resume](../../tests/platform/recovery/archive-do-resume.room.test.ts)、[story-creation-store](../../tests/kp/stories/story-creation-store.room.test.ts)，E05、E13 | P0：先处理对应旧 fixture 失败，现役完整链及损坏归档拒绝分别验 |
| KP-I05 已提交错误的审计更正 | 错扣资源后合法补偿；影响后续事实时走审计分支，玩家知道可公开更正 | 静默改数据库/骰面；更正撤销他人秘密隔离；旧错误结果复活 | W ~~archive-correction~~（已删除，ADR 0028）、~~combat-archive-correction~~（已删除，ADR 0028） | P0：输入授权、正确状态、历史保留与更正后旁白的本地闭环 |
| KP-I06 内容边界与现实玩家安全 | 玩家要求降低某类描写强度；提出暂停/更正说明，按有效入口处理 | 以游戏危险拒绝现实内容边界；把呈现调整当免伤或改骰 | W ~~error-report-room~~（已删除，ADR 0028）；D/S [authoritative-table](../../tests/product/characters/authoritative-table.test.mjs) | P1：先核对现役公开入口，不能假设旧按钮还存在；分别验表达变化与机械不变 |
| KP-I07 版本绑定、预算与安全诊断 | 当前房间按精确规则/模型绑定运行；预算不足明确停止，日志可诊断且不含私密正文 | 旧工作流静默重解释；借新 job 重置预算；错误泄露 Prompt/密钥/秘密 | D [runtime-profiles](../../tests/platform/profiles/runtime-profiles.test.mjs)、[kp-diagnostic-telemetry](../../tests/platform/telemetry/kp-diagnostic-telemetry.test.mjs)；W [story-creation-store](../../tests/kp/stories/story-creation-store.room.test.ts)，E01、E05、E13 | P0：版本不符与调用余额不足分别断言，账单未知不能计零；沿已有 serializer 查日志 |

### J. KP 意图与战斗、能力规则的衔接

依据：[SPEC 0001 §§2、6、8、10、14](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0012](../specs/0012-authoritative-combat-mechanics.md)、[SPEC 0013](../specs/0013-versioned-runtime-profiles.md)。KP 决定意图和叙事情境，Rules 执行机械；这些不能只归入“动态敌人生成”就算已覆盖。[已知战斗失败任务](task-combat-mechanics-failures.md)是历史诊断，数量以实际当前定向结果为准。

| ID / 功能 | 正常样例与结构变化，应看到什么 | 高风险反例 / 边界 | 已有入口 / 历史证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| KP-J01 调用已注册法术或职业能力 | 治疗法术实际扣槽和治疗；职业能力按本人资源生效 | 模型重写能力效果/DC；有定义无执行器却返回成功 | D [registered-spell-boundary](../../tests/kp/combat/registered-spell-execution-boundary.test.mjs)、[ability-operation](../../tests/kp/combat/ability-operation.test.mjs)；W [ability-operation-room](../../tests/kp/combat/ability-operation.room.test.ts) | P0：正常输入→选择既有能力→实际效果；缺执行器必须零伪成功 |
| KP-J02 攻击、命中、暴击与伤害 | 近战命中；消耗弹药的远程未命中，骰和成本按规则 | 把攻击当普通 DC 算术；看骰后补伤害；未命中返还不该返还的弹药 | D [combat-mechanics](../../tests/kp/combat/combat-mechanics.test.mjs)；W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts) | P0：先定位现役失败，普通/自然 1/自然 20、资源与正文同源 |
| KP-J03 范围、目标与豁免 | 范围伤害各目标独立豁免；方向区域影响实际范围内对象 | 忽略环境实体导致整次失败；把隐藏目标交给玩家枚举；越界命中 | D [combat-mechanics](../../tests/kp/combat/combat-mechanics.test.mjs)、[inventory-operations](../../tests/kp/items/README.md) | P0：带环境实体、部分遮挡、隐藏观察者的直接矩阵；不删除失败断言迎合实现 |
| KP-J04 回合、移动与行动经济 | 角色移动后攻击；另一角色选择撤退/帮助，行动资源合法 | 回合外行动、免费重复移动/附赠动作、KP 自动替玩家结束回合 | D [combat-mechanics](../../tests/kp/combat/combat-mechanics.test.mjs)；W ~~combat-vertical~~（已删除，ADR 0028） | P0：正常桌面或语义入口到 turn/position/cost，反复提交不多行动 |
| KP-J05 反应与 NPC 战术选择 | 合法触发后本人选择反应；NPC 按自己知识选择反制或保留反应 | 自动选最近/最低 HP 目标；无资格反应；失败重试重新掷骰 | W ~~combat-room-randomness~~（已删除，ADR 0028）；D [npc-pending-boundary](../../tests/kp/npc/npc-pending-kp-boundary.test.mjs) | P0：玩家/NPC 分别核对触发、资格、决定与恢复，真实战术合理性另外评分 |
| KP-J06 状态、专注与持续效果 | 伤害触发专注检定；状态在真实期限结束，适用加减值准确 | 永久保留已结束效果；新效果无规则授权；驱逐丢专注或重复 save | D [condition-mechanics](../../tests/kp/combat/condition-mechanics.test.mjs)、[combat-mechanics](../../tests/kp/combat/combat-mechanics.test.mjs) | P1：进入、影响、解除/到期和恢复，表中状态与实际规则效果都断言 |
| KP-J07 长施法、仪式与取消 | 合法仪式等待完成；长施法跨战斗轮投入行动，取消保留已发生代价 | 一次请求瞬间完成；仪式绕过定义限制；等待免费跨回合 | D [combat-long-casting](../../tests/kp/combat/combat-long-casting.test.mjs)；W [ability-operation-room](../../tests/kp/combat/ability-operation.room.test.ts) | P1：非战斗与战斗结构、开始/继续/取消/恢复分别核对 |
| KP-J08 0 HP、稳定、死亡与非歼灭结束 | 角色倒地后按死亡/稳定规则处理；NPC 投降或逃离后玩家仍决定下一步 | 旁白直接判死或复活；投降自动替玩家接受；必须杀光才允许停止 | D [combat-mechanics](../../tests/kp/combat/combat-mechanics.test.mjs)、[combat-hostility](../../tests/kp/combat/combat-hostility.test.mjs)；W ~~combat-vertical~~（已删除，ADR 0028） | P0：医治/稳定、合法致死及投降/逃跑的不同事实链，角色继任另见 KP-G07 |

## 4. 配套产品功能清单

这些是 KP 可用的前提和交互出口；不能用 KP 单测替代，也不能用页面 200 代替游戏结果。

| ID / 功能 | 正常样例与结构变化 | 失败 / 边界 | 已有入口 / 证据 | 下一项补证 |
| --- | --- | --- | --- | --- |
| APP-01 本地首次启动与已有库升级 | 空库启动前准备；已有数据升级后建房可用 | 漏迁移报 500；重建表级联丢数据 | H [rendered-html](../../tests/product/identity/rendered-html.http.test.mjs)仅测已迁移临时库；E01 | P0：缺迁移检测及**带数据**迁移保全回归均待补，不能再只验首页 |
| APP-02 注册、登录、会话与登出 | 新注册和已有账号登录；刷新仍保持可信会话 | 错密码、重复注册、过期/撤销会话、跨站写请求 | H [rendered-html](../../tests/product/identity/rendered-html.http.test.mjs)，E01 | P0：当前本地用户链与匿名拒绝；测试账号独立清理 |
| APP-03 建房、加入和房主模型绑定 | 正常建房；另一账号按码入席，模型/规则随房间固定 | 无效码、满员、非法模型、不同版本房间 | H [rendered-html](../../tests/product/identity/rendered-html.http.test.mjs)；D [authoritative-table](../../tests/product/characters/authoritative-table.test.mjs)，E01 | P0：E01 只验建房，加入和满员仍需单列结果 |
| APP-04 成员管理、房主转移与删除 | 离席再加入；房主转移后按新权限管理 | 玩家越权删房/踢人；删除残留当前可访问数据 | H [rendered-html](../../tests/product/identity/rendered-html.http.test.mjs)；W [multiplayer-room](../../tests/product/multiplayer/multiplayer.room.test.ts) | P1：可信新旧身份各走管理接口，核对离席的 pending 失效 |
| APP-05 九步建卡与锁定 | 不同种族/职业完成合法 3 级卡；法术职业与非施法职业各一张 | 点购、技能、装备或法术选择非法；重复锁卡 | S [interaction-contract](../../tests/product/characters/interaction-contract.structure.test.mjs)只查九步；D [authoritative-table](../../tests/product/characters/authoritative-table.test.mjs)查卡数据接入 | P0：浏览器从第一步至锁卡的行为验收待补，不能以步骤名称存在抵扣 |
| APP-06 开局与初始知识 | 多名角色锁卡后房主开局；开场资料按角色分别呈现 | 非房主开局、未就绪、重复开局、初始秘密串人 | W [authoritative-opening](../../tests/product/opening/authoritative-opening.room.test.ts)；D [module-preparation](../../tests/product/opening/module-preparation.test.mjs) | P0：正常 HTTP 开局、初始物品与知识、实际开场正文 |
| APP-07 行动输入、玩家掷骰与待决 | 发送自然语言；本人确认共享检定中的自己部分，结果可见 | 重复点击、他人回答、刷新丢 submission、自动替玩家掷骰 | W [stage3-room](../../tests/kp/adjudication/stage3.room.test.ts)；D/S [authoritative-table](../../tests/product/characters/authoritative-table.test.mjs) | P0：真实按钮→API→结果/恢复；组件源码检查不能证明交互 |
| APP-08 背包、装备与知识面板 | 部分堆叠、未知物品、知识卡片显示正确；小屏可展开操作 | 重复操作、显示隐藏能力、数量/占用文案混淆 | V [inventory-panel](../../tests/product/inventory/inventory-panel.test.mjs)；D [knowledge-notebook](../../tests/product/knowledge/knowledge-notebook.test.mjs) | P1：浏览器目标流程联动 KP-E 与 KP-F，不重复做第二套领域测试 |
| APP-09 战术地图与空间意图 | 桌面/移动端展开、选择可见目标；移动后地图与文字一致 | 隐藏目标泄露、陈旧坐标、不可达路径、键盘无法操作 | V [tactical-map-interaction](../../tests/product/map/tactical-map-interaction.test.mjs)；W ~~tactical-movement-room~~（已删除，ADR 0028） | P1：两个视口和可访问性按实际目标路径验，组件挂载不是完整浏览器 QA |
| APP-10 语音输入与发送前确认 | 转写后可编辑再发送；取消录音不提交行动 | 识别错误自动发出；未授权输入或失败被当空动作 | H [observer-http-privacy](../../tests/product/identity/observer-http-privacy.http.test.mjs)涉及语音命令；S [interaction-contract](../../tests/product/characters/interaction-contract.structure.test.mjs) | P1：真实麦克风/转写质量与确认交互缺独立证据，使用工具时遵守授权范围 |
| APP-11 旁白语音播放与失效 | 当前回应可播；回应被覆盖、确认或权限撤销后音频失效 | 迟到 TTS 播旧秘密；自动确认改变游戏语义 | D [voice-delivery-race](../../tests/product/voice/voice-delivery-race.test.mjs) | P1：真实音频质量和浏览器竞态单列；字节竞态测试不证明听感 |
| APP-12 历史导出与历史起点 | 导出本人有权读取的完整经历；合法历史时点以新角色开团 | 导出遗漏分页、泄露系统材料、新身份继承全部旧秘密 | W [story-history-server](../../tests/product/history/story-history-server.room.test.ts)；H [story-history-http](../../tests/product/history/story-history-http.http.test.mts)，E05 | P2：用独立配置执行，默认 Vitest glob 不包含该 `.mts`；浏览器入口与导出内容另核 |

## 5. 真实旁白和故事质量如何评分

这一节是验收方法，不增加固定文风、字数、必说句式或新的产品规则。对每段正文分别记录：**满足 / 有明确缺陷 / 材料不足无法判断**。不能把“没有发现错误”写成绝对正确，也不把多个维度平均后冲掉严重错误。

| 评价项 | 判定方法 | 必须保留的坏例 |
| --- | --- | --- |
| 通顺自然（KP-H01） | 连着前一轮读正文，能明确谁在做什么、句子如何承接；避免无意义重复和生硬模板 | 代词指向错、前后因果断裂、同句反复换词复述 |
| 可行动（KP-H02） | 玩家能指出刚发生什么、哪些事可感知、当前有哪些对象或问题；不要求封闭选项 | 只有气氛渲染，读完不知道什么改变或能做什么 |
| 人物声口（KP-H03） | 同一 NPC 跨轮保持身份/目标/知识一致，不同 NPC 的表达可辨且不过度标签化 | 普通店员突然用全知术语解释幕后；两人长期互聊不给玩家机会 |
| 玩家决定权（KP-H04） | 对照原始目标、方法和已确认选择，逐项检查是否添加行动/信念 | E05 的额外避开话题；未经选择就拿物、相信谎言或接受交易 |
| 不出戏（KP-H05） | 情境中的回应与后果自然表达；内部状态不冒充叙述，正常骰子 UI 仍可显示 | E04 的交谈检定结算播报及其语义相同的改写；暴露 Proposal/Claim 等内部词 |
| 结果一致与完整（KP-H06） | 以真实事件和该 Viewer 可见材料为依据，核对数量、资源、位置、伤势、成功/失败 | 漏扣药剂、重复取得物品、未成功却写“无人察觉” |
| 连续性与归属（KP-H07/H08） | 检查先前已发布文本、持久化细节、原行动者与活动起点 | E03 的上轮拿物被重复叙述；等待触发者替代原调查者 |
| 秘密与恢复（KP-H09/H10） | 成对 Viewer 比较；重试前后比较冻结来源和机械/调用证据 | 他人私密意图出现在正文；重试后创造新环境或重复结算 |
| 支线可主持性（KP-C01/C04） | 实际生成稿件有当前世界因果、可互动人物、独立线索与可成立收束；进入世界后可继续行动 | 只有任务标题，没有可执行人物/物件；两条线索指向同一唯一骰点 |
| 开放性与节奏（KP-C02/C03/C06/C07） | 合理非预写方法能影响结果；失败/放弃能结束；长篇阶段确实不同 | 无论玩家做什么都回到同一段；不断追加新敌人撤销结局 |

最小真实质量样例组应覆盖：**普通交谈、观察与推断、一次有真实成本的物品操作、活动延时完成、不同 NPC 交谈、支线生成后走另一种合法解法**。它们可复用各自功能的实际轨迹；每个轨迹按所有适用维度分别评分，避免为同一结果重复付费采样。单步样例不能证明长团稳定性，长团另按已有规格的连续评测要求执行。

反例审核应使用保存的坏正文或有明确依据的定点变体，不事后改原稿再冒充原模型结果。记录生成与审核各自的错误：审核漏错、报告格式失败、正文失真是三个不同结果。自动判定负责权限、精确机械与协议不变量；自然度、声口、相称代价和支线质量需基于真实材料的人读评价，不能只相信生成模型或审核模型的自评。

## 6. 下一轮执行顺序与停止条件

本清单不自动授权全量回归、真实付费批次或修复所有历史失败；真实批次按当次用户授权和预先固定的预算执行，具体结果见关联回执。以下是从清单导出的可独立验收工作项，后续按现有开发期流程逐项执行。

| 顺序 | 目标与关联 ID | 先复用的定向入口 | 何时算该项闭合 |
| --- | --- | --- | --- |
| 1 | 本地可玩前提：APP-01–07 | 已有身份/开房 HTTP 用例；针对旧库补一次带数据迁移回归，建卡用真实 UI | 注册→建房→两种角色建卡→开局可达；故障和数据保全有独立证据。现存 0012 风险不能用空库测试覆盖 |
| 2 | 动态 NPC：KP-B01、D01–03、H03 | `npx tsx --test tests/kp/npc/npc-materialization.test.mjs tests/kp/stories/story-materialization.test.mjs tests/kp/npc/npc-decision-context.test.mjs`；随后复用 story/Room 入口 | 生成两种 NPC、合法知识、交谈、持久化/恢复；真实生成及声口另有结果，不能仅用 mock 完成 |
| 3 | 物品生成与取用：KP-B03/B04、E01–04、H06/H07 | `npx tsx --test tests/kp/adjudication/authored-materialization.test.mjs tests/kp/items/acquire-release.test.mjs tests/kp/items/equipment.test.mjs tests/kp/items/transfer.test.mjs tests/kp/items/use.test.mjs tests/kp/items/lifecycle.test.mjs tests/kp/items/projection.test.mjs tests/kp/items/item-use-costs.test.mjs` | 普通物与有效果物各走定义→实例→取得→使用/放回；拒绝、重复请求及正文一致 |
| 4 | 支线：KP-C01–04、H04 | `npx tsx --test tests/kp/stories/creation.test.mjs tests/kp/stories/preparation-review.test.mjs tests/kp/stories/preparation-context.test.mjs tests/kp/stories/prepared-content.test.mjs tests/kp/stories/preparation-transport.test.mjs tests/kp/stories/preparation-recovery.test.mjs tests/kp/stories/story-materialization.test.mjs`；W `tests/kp/stories/story-action.room.test.ts` | 地方问题与新 NPC 调查两种结构；真实批次实际创建准备及接入，并能换方法/放弃；普通回应记“未触发” |
| 5 | 旁白十维：KP-H01–10 | `npx tsx --test tests/kp/narration/generation.test.mjs tests/kp/narration/social-context.test.mjs tests/kp/narration/frozen-input.test.mjs tests/kp/narration/review.test.mjs tests/kp/narration/continuity.test.mjs tests/kp/narration/presentation.test.mjs tests/kp/narration/recovery.test.mjs tests/kp/narration/narration-provider-failure.test.mjs`；复用第 2–4 项真实材料 | 输入边界通过、坏例仍拒绝、实际正文逐维评分；严重失真/泄密不能由“文笔好”抵扣 |
| 6 | NPC 主动行为与时间：KP-D04–11、G01–03/G08、I02–04 | W `tests/kp/npc/npc-plan-formation.room.test.ts`、`tests/kp/npc/promise-lifecycle.room.test.ts`，按目标标题过滤 | 形成→到期→真实动作→履约/失约→恢复；玩家未同意、其他时间线和未知调用不推进 |
| 7 | 战斗与能力：KP-J01–08 | 从现役能力和一个正常遭遇纵切起步，定向核对 `tests/kp/combat/combat-mechanics.test.mjs` 的原失败与调用者 | 原失败、直接成功、高风险连带成立；真实 NPC 决定与用户交互证据独立，不与 fixture 修复混算 |
| 8 | 多人长团与其余 P1/P2 | 在已经验证的纵切上串联 KP-F04/F05、G04–09、C07–09 和 APP-08–12 | 按适用规格完成连续轨迹，保留每次失败和暂停原因；完整回归另按发布流程的授权路由 |

命令是入口建议，**不是已执行结果或一次运行所有列出文件的要求**。先核对目标用例是否适配现役接口，再选最多三类直接证据。已有用例充分时不新写同义测试；缺口涉及旧夹具，先确定是 fixture 失配还是产品违反 SPEC，不能删断言或扩基线变绿。

真实批次开始前再读取 [专项授权与预算](vnext-production-todo.md) 中确实适用于当前对象的条款，固定源码、Profile、模型、样例、调用/token/费用/时间上限和停止条件；本清单不继承历史批次额度。未触发目标、结果未知、预算耗尽和完整行动失败都如实记录，不改词重采挑成功。与第 1 项有关的本地状态操作遵循 [迁移审计](receipts/local-preview-create-room-20260914.md)，不复制旧 migration 的数据破坏行为。

## 7. 与主 PRD 验收场景的交叉核对

| SPEC 0001 §21 | 本清单中的对应功能 |
| --- | --- |
| A 非预写合理行动 | KP-A01、A09、C02 |
| B 当前不可能行动 | KP-A05 |
| C 激进风险路径 | KP-A04、B02、B09 |
| D 动态敌人不可执行 | KP-B02、I01 |
| E 门后多种可能 | KP-B10 |
| F 感官证据与假传闻、叙述承诺 | KP-B07/B08、D03、F01–03 |
| G 致命陷阱 | KP-B09、G07 |
| H 无意义检定 | KP-A02 |
| I 有意义失败 | KP-A08、C02/C04 |
| J 玩家停滞 | KP-C05、G01 |
| K NPC 知识边界 | KP-D02 |
| L 重大歧义 | KP-A06、H04 |
| M 多人聚光灯 | KP-F04/F05、G04/G05 |
| N 规则或事实错误 | KP-I05 |
| O 故事结束 | KP-C07–09 |

A–O 是最低场景，不覆盖全部细分功能。[原 A–O 测试登记](../../tests/platform/architecture/spec-0001-acceptance.structure.test.mjs)只检查引用的断言是否存在；其中真实判断探针目前仅有 B、H。这里补上动态支线、物品各操作、旁白十维、长期关系及完整产品入口的独立验收项，但不把本文件本身登记为行为测试。

## 8. 后续结果怎样落地

每次实际执行后在对应任务回执记录下面这些字段，本表只链接回执：

```text
功能 ID / 样例编号 / 正常、变体或反例
源码 SHA + 未提交差量指纹 / 规则、workflow、模型绑定
证据层级 D/W/H/V/S/L / 是否真实模型 / 是否经过正常 HTTP
前提、原始输入、实际步骤、权限主体、预期与实际可见结果
准确命令、目标用例、退出码、通过/失败/跳过数
状态、事件、随机、物品、知识、Receipt/发布差量与恢复核对
质量维度逐项结论及具体错误片段（脱敏、按受众范围保存）
实际调用、token、耗时、成本；未知值明确未知
判定：通过 / 失败 / 未触发目标 / 被前置条件阻断 / 未运行
未覆盖变化、根因证据与下一项最窄检查
```

秘密正文、身份凭据和私有世界状态只进授权的本地私有证据目录；回执仅保留必要脱敏结果。相同样例的不同阶段、不同源码或重叠用例不累计成一个“总通过率”。只有矩阵中的对象变化、关键状态转换、拒绝/恢复及用户可见结果都取得相应证据，才把该功能称为已验收。
