# vNext 达标与生产替换 TODO

> 2026-09-08 生产更新：用户已授权并确认新房默认使用 vNext，源码 `ce349be46f4e158ccac7855d34a932598213431e` 已部署为版本 `11a9009d-ed5f-493e-a496-a216395e5ea8`，100% 流量；线上正常开房/建卡/开局、真实治疗及重复返回一致，用户确认线上可用。详见[发布回执](vnext-production-release-20260908.md)。下文历史差量和未完成能力继续保留；主目录并行在途源码不等于生产版本，旧房尚未删除或迁移。

日期：2026-09-05。源码基线：`cloudflare` / `258caee404e0814405eb497653ee9f00d647b773`。本清单回应“按 SPEC 0001，vNext 该做到什么程度，并最终替代目前生产 V3”。

这是实施与验收计划，按现有实现计算增量工作。产品合同来自 [SPEC 0001](../specs/0001-llm-kp-responsibility-contract.md)，技术路线沿用 [SPEC 0016](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)；源码位置见 [repo map](repo-map.md)，历史续作背景见 [Claude 交接](handoff-hazards-and-items.md)。清单持续记录当前工作树的实施进度；已执行有界真实模型验证，没有执行数据删除或生产切换。

## 当前承接任务：完整 vNext Goal 续作（2026-09-06）

完整 vNext Goal 保持 active；本轮按用户最新“诊断与窄修订、真实测试、重点稳定性”的要求继续开发，不部署、不 push。完整游玩与生产替换仍是后续目标，不能以局部验证标记完成。当前继承的未提交工作全部保留。

2026-09-07 用户补充执行决定：本次填写及组装问题修好后继续完整 Goal；允许调整 Goal 的验证，以正常登录/Room入口的真实 API 行动、权威提交、公开结果和后续行动为最终验收依据。本地行为测试和类型检查继续用于定位及防回归，不替代真实通过，不将注入响应计作真实模型成功。真实批次保持预设预算、失败即停、保留原稿和全部失败；实际恢复路径必须真实触发才能算通过。用户所说组装“能恢复/不能恢复”专指原组件拆解可回收性，其他 JSON、字段、引用与修订错误仍需修复。当前开发不部署、不 push 的边界保持。

2026-09-08 当前填写 parser 为 **v51**：首轮只提交扁平 `requestedCapabilities`，第二轮提交 `decision / steps / results` 三张平表，continuation 同形；服务器生成固定外壳、根依据并集、producer、静态模板 hash 和类型化依赖。结果按步骤及成败分支填行，再由同一领域 schema 解码、分组与校验，缺失或混型拒绝，不猜效果。当前修订票据仍为 vnext-5，保存并重证原始 arguments；KP 显式确认服务器已证明的完整修复计划，保持八处总修改、一次 correction 和完整重验，不补裁决、目标、DC、成本或后果。空 `{}` 的一次重发已实现，但 round90/91 没有再出现空对象；裸 `none` 泛化在 round90 失败后实现，round91 未自然触发，均不能记作真实恢复通过。持久组件的创建/拆解仍走同一 ItemSystem 权威与公开 Table 引用，见[组件纵切](vnext-component-assembly-validation.md)。下文各旧 parser 版本和批次“最新”字样保留为当时记录；当前状态以本段及[根交接](../../handoff.md)为准。

2026-09-08 本次接手 `e657162` 后完成[两处遥测窄修复](vnext-telemetry-validation.md)：ActorPlan 实际调用记录 usage，等待每段实际提交后记录时间增量与到期数。两组 Room 6 项及既有遥测/脱敏 11 项通过，随本次活动实现提交到本地，未跑新真实批次；完整游玩和生产采用未完成。用户随后裁定“非战斗状态可以，战斗不可以”：按[活动合同](vnext-activity-attention-contract-proposal.md)接入玩家普通耗时提案 Activity、长休/活动真实期限推进及合法新信息的受控继续/结束，战斗保持原规则。lowering 直接调用者已按阶段迁移并核对：[本地活动回执](vnext-activity-attention-validation.md)记录最终 Node 组 308/309，剩余旧形状断言修正后该文件 8/8；Room 6 过、9 跳过及 typecheck 通过。当前定向范围无未解决失败；NPC 传话仍是受控 fixture，未做新真实模型验收或全项目回归。承诺 fulfilled/broken 合同差异、完整游玩及生产采用继续独立保留。

[填写Interface开发回执](vnext-filling-interface-validation.md)：不同提案家族和terminal直接消费者已适配；初次消费者组231/266，35个旧fixture/断言失败已定向修复，后续36/36、11/11、35/35通过。真实[round54](vnext-round54-validation.md)仍是前两步完整发布、第三步JSON_SYNTAX拒绝；库存10→9→10，7次模型调用，第三步0提交，2条事件replay精确。没有复杂行动稳定性改善证据。round54冻结parser v23；停批后v24只修正模型根字段的诊断来源和非字符串类型分类，27/27通过，未追加真实调用。

[round55](vnext-round55-validation.md)：在不改round54原稿/冻结上下文下，v25只为完整根成员后的冗余结束符生成证据；一次真实correction仅确认、语义字段0修改、全束重验通过，4534输入/60输出、¥0.007071。内部截断、重复键与额外数据不恢复。Node45/45、Room保存恢复4/4、typecheck exit0。此批未提交Room，不能记成组装完成或正常连续游玩通过；组件可恢复性纵切继续实施。

[round57](vnext-round57-validation.md)：v27同源结果列表完成原四句正常HTTP真实链，四步均committed/published；火把10→9→10，组装两件占用，拆解引用上轮公开assemblyRef，完整库存恢复开局。第一步自然JSON根尾错误经一次真实确认修订恢复，原稿/冻结上下文保持，允许语义修改为零。四次duplicate零新增调用/提交，8事件完整replay精确，312源码文件起止一致。13调用/172262输入/3192输出、官方空闲价估算¥0.2178194；所有进程已关闭。本地先63/63，补内部字段碰撞与遥测消费者后26/26，两个阶段typecheck exit0，详见[填写结果列表回执](vnext-result-entry-filling-validation.md)。本批首稿语法失败1/恢复1、Form失败0、Rules拒绝0、观察到已发布叙事矛盾0；不能据此声明统计稳定性提高。继续完整Goal中已有ActorPlan到期决定与结算及双人20+链。

[round56](vnext-round56-validation.md)历史失败保留：组件26文件串行集成、0冲突，主树目标53/53及typecheck通过；正常HTTP前两步再次完整发布，第三步已填写assemble组件，但手动测试worldInteraction混入observe的characterInferences并漏effects，Form拒绝、0新提交。7调用/116913输入/2638输出、¥0.1564309；312文件起止一致、2事件replay精确，第四步未执行。该批没有真实组装/拆解成功或统计稳定性证据；其混表根因随后由v27填写面修复。

最新真实修订结果见 [round44](vnext-round44-validation.md)：环境互动、观察、保存检定后驱逐恢复3/3通过；重复submission无新调用/提交，检定只掷一次。首稿和旁白为替身，不能代表完整游戏或统计成功率提升。此前 [round42](vnext-round42-validation.md) 1通过/1失败/1未尝试保持历史结论，未清洗旧响应。

2026-09-07最新创作边界：普通新经历和环境补白不要求旧引用证明，只检查具体冲突、权限、持久化和机械效果。NPC假话保留来源归属，不等于世界真相。语义绝对无矛盾不可证明是技术局限，不作为无限审核或无限延期理由；以真实游玩错误频率、严重程度和可恢复性验收。

现役review/v11已删除逐assertion×fact证据矩阵，保留一次独立审核、固定检查维度、仅明确错误的结构化诊断；仅本次机械结果每组有一次完整性检查，新创作不填证明表。精确body/冻结材料绑定、完整错误经Adapter私有传播、原两调用及恢复保持。round49真实普通放置已提交/replay一致但旧表漏重复结果；round50前9个固定反例正确，第10个漏药剂消耗被误放；round51同一反例识别了遗漏但报告汇总自相矛盾，最终原响应离线重放保留具体拒绝原因，未把该批称为完整格式通过。**没有统计性稳定结论**；[round52](vnext-round52-validation.md)已回到正常Room连续行动：第一步真实提案、提交、旁白及审核完整发布，重复请求幂等；第二步模型将实例引用误填为物品定义，Rules拒绝且未多扣资源，第三步按预设未执行。原稿/冻结资料和精确replay已封存。随后修改冻结可见ItemEntry填写候选、Rules私有诊断与安全遥测，Room保存/恢复从同一冻结材料重建动态schema。[round53](vnext-round53-validation.md)真实对照前两步完整发布，重复请求无新调用，库存10→9→10；第三步补schema后嵌套JSON在offset3220失败，0提交，按预设停批。现役日志保留JSON_SYNTAX及安全路径；仍未通过复杂行动或连续20+稳定性，不再独立审核反复抽样。[本次实现/验证/局限](vnext-narration-conflict-review-validation.md)。round43–48旧失败均保留在原报告。

直接创作消费者另修复事务内WorldFact→social依赖误判：新定义无须提交前存在，但必须来自本束明确消费的前序always生产者、原完整事件与定义hash。初始旧依赖和接受成本仍严格校验。新经历/传闻/骰点/replay11/11，成本前缀5/5，新增同definition但伪造producer上下文反例1/1；正常Room新经历和Item叙述恢复2/2。目标叙述/知识消费者37/37、typecheck通过；不是全项目回归或真实游戏成功率。

动态地点/通道副本已串行集成31文件（5处三方合并无冲突，旧字节保留），创建、另轮开始通行、原到期Activity移动、纠错撤回与进入者内部可见性沿原Rules/Room。原predicate已补地点/通道嵌套诊断（8/8），修订范围未扩张。最终组合Node先47/48，唯一失败为旧schema测试要求汇总错误；更新精确constraint/path后该目标1/1通过。Room6/6（含地点驱逐/到期中断恢复、私有内部投影与修订恢复）、typecheck exit0。完整命令、合并前后SHA及实际失败见[集成回执](vnext-location-passage-integration.json)。地点真实模型及单人推进时间路径仍未验证，不以隔离93/93或本地Room替身当真实游戏通过。

此前真实结果以 [round33](vnext-round33-validation.md)、[round34](vnext-round34-validation.md) 和 [round35](vnext-round35-validation.md) 为准：round33普通库存只完成机械提交，旁白审核超时，整条行动未通过；round34固定的知识回顾、共享观察检定、作者化物品三类格式错误均由真实DeepSeek一次correction修复，完整束逐字段等于冻结合法预期（3/3）。round34首稿/错误由测试构造，不代表自然错误发生率、前后提升或真实Room连续游玩。round35相同冻结审核请求200ms收到HTTP200，但45,009ms截止仍0正文byte，支持等待正文的阶段定位，不能推断具体服务端/网络根因。上述三批均结束；随后[round36](vnext-round36-validation.md)的单次strict审核候选被HTTP400拒绝，具体错误正文未留，未采用为产品改动。所有批次均不重采样挑选成功；完整主链及稳定性未通过。

旁白审核v6已把每项事实覆盖就近放入assertion.coveredFactKeys，并显式列omittedFactKeys；服务器生成反向覆盖，原文标点、必要事实、同Claim证据、历史/来源主张和Viewer边界保持。目标31/31与typecheck通过；真实审核仍超时，不能将填写面简化称为稳定性改善。

后置 social 前缀证明 B 已集成：六文件核对基线后应用，原“额外第三方伤害被截断而漏验”的阻断已修复；仅使用绑定的原骰面/原答案验证前序，不提交重放或扣第二次资源。隔离最终 atomic 32/32、独立最高风险 2/2，集成后主树 Room 2/2（33 skipped）与 typecheck exit 0。具体文件/日志见本轮 refactor-log 追加记录；不将其算作真实游戏通过。

[round37–40](vnext-round37-40-validation.md)均失败结束，候选未采用：37确认 forced tool choice 与 thinking 不兼容；38快速返回但同 Claim 证据、事实覆盖及“未点燃”依据错误；39/40继续等待正文超时。停止无结论的参数采样。完整游玩、动态地点/通路、连续20+行动及生产替换仍未闭合；120金标/长期SLO继续后置；该批未部署、未push。

[既有ActorPlan到期纵切](vnext-actor-plan-due-validation.md)已集成20文件、0冲突：同源due队列、NPC限知、一次strict调用、原响应journal、Rules/Claims和冻结恢复。共用HTTP调用scope与Viewer恢复捕获，拒绝重复JSON/纯文本回退。主树Node21/21，Worker新12+普通到期移动1、原消费者3通过，typecheck exit0。limit5的第6次旁白审核拒绝后只恢复同一Viewer，不重做机械。本地受控模型证据不替代真实API；下一批验证既有计划到期，不声称新计划创作已闭合。

[round58](vnext-round58-validation.md)真实首句知识回顾已提交，时间/库存/知识/未来计划不变、NPC调用0；但后续审核请求服务错误被误报NARRATION_BODY_INVALID，发布失败，第二、三句停批未执行。scope计数3，成功响应31665输入/256输出，已知费用¥0.0302751，失败审核usage未知。316文件起止一致、3事件replay精确；NPC到期真实链仍待。正在用冻结原审核请求定位供应商拒绝原因，不把空resultChecks对象的本地发现直接写成真实原因。

[round59](vnext-round59-validation.md)仅一次冻结原审核诊断请求，真实HTTP400明确为“An object with no properties is not allowed.”；唯一空对象是无机械结果时的resultChecks。本地strict校验错误地允许了该请求。0Room提交/发布，原审核input SHA保持，错误响应无usage。正在分别修同源schema空分组表示和Provider拒绝的公开误报；不增加审核、占位表或重试次数。

2026-09-07：round59 定位后的两处修复已串行集成13文件、0冲突。无机械结果时，同一冻结材料决定省去 resultChecks；非空仍完整逐组验证。单一 vendor validator 在外呼前拒绝空 properties，保留精确 path/reason 的私有 cause。服务拒绝现明确为 NARRATION_PROVIDER_REJECTED，正文格式与 grounding 分别保持真实原因，Room、Viewer恢复、Table与telemetry同步。review v11/policy v9；主树六份定向Node共70/70、typecheck与diff-check exit0。原round58/59仍失败；接下来round60按原三句、最多20调用/20分钟/¥5验证，不把本地通过记作模型稳定性提升。详见[修复与验证](vnext-narration-schema-provider-validation.md)。

[round60](vnext-round60-validation.md)真实第一句知识回顾完整通过，重复请求零新增；空/非空审核schema均被DeepSeek接受。第二句等待一分钟虽committed/published但权威time仍0，模型只填即时observe并把时长写进自然语言；未来NPC计划未执行，正文提前出现相近trace。立即停批，第三句/恢复未调用。现役填写面缺普通耗时/Activity输入，只有refusal时间成本；下一步补可执行耗时纵切，不能凭旁白或窄修订补时长。6调用、73323输入/2029输出、¥0.069003，8事件replay精确，316源码起止一致。格式失败0、Rules拒绝0、行为矛盾1；不称稳定性通过。

[被动时间纵切](vnext-passive-time-validation.md)已完成主树集成：模型只填passTime时长，服务器建立冻结Activity，Rules按真实deadline分段推进；未知NPC响应技术停止，死亡或移动按实际时间中断。本人Activity确定性显示完成/中断，NPC及混合机械结果保留旁白，普通等待1调用、有一次可见NPC4调用，保持HTTP5预算。原数字token为正十进制安全整数时，可一次确认同值转string；舍入小数、指数、无原稿与改裁决拒绝。主树KP80/80、Rules/UI9/9、Worker9/9、typecheck退出0；四份SHA清单共33次文件应用（31个不同文件）、0冲突。round61真实原三句前两句通过：等待精确60秒、NPC到期真实execute/旁白；第三句因服务器知识依据别名与readSet表示不一致被Rules拒绝。统一冻结引用映射后，原失败稿离线重放可提交，定向25/25及typecheck通过；round62原三句前两句再次真实通过，第三句把knowledgeRef填入focusRefs，被lowering拒绝且0新提交；原上下文候选与精确诊断继续修复，见[round62](vnext-round62-validation.md)。复杂Activity/NPC新计划/双人20+与完整Goal仍未完成。

[round63](vnext-round63-validation.md)原三句前两句再次committed/published，60秒精确完成；第三句正确使用可见主体，但已提交并展示在factConstraints中的NPC痕迹漏了known/citation/read binding，lowering拒绝且0新事件。8调用/133062输入/2204输出、¥0.1644102，320源码起止一致、全replay精确；这次属于服务器事实闭包缺口，不是模型编造。随后同源frame.facts已增加不可扩展的sourceRecord冻结义务，根/分支依据错误保留原字段精确路径，不能安全替换依据或造hash时明确拒绝。主树依据诊断8/8、事实/直接消费者33/33、typecheck退出0；[修复回执](vnext-fact-source-context-validation.md)。原三句下一批真实复验尚待，不提前勾选稳定性或完整Goal。

首轮接口已收敛并集成 parser v32：knowledgeReview/passTime/inWorldRefusal 可直接填，其余行动及 clarification 先一次选择实际家族，expanded 只闭合所选类型依赖。未增加阶段或修订预算，也未修补未闭合字符串。首轮 schema 离线由49,775降至4,904字节；这不代表真实 tokens 或稳定性改善。直接消费者与最终真实原三句证据持续记录在[接口验收](vnext-selected-schema-validation.md)，[round65](vnext-round65-validation.md)原三句3/3已真实提交发布，11调用/¥0.1618405，事实后续引用与60秒等待通过；仍不代表统计稳定性。

最新[round65](vnext-round65-validation.md)补齐原三句连续链：首轮知识回顾与等待各自走小表单，第三句一次选择observe后完整填写，成功引用round65已提交NPC痕迹；18事件全replay、0资源/时间重复、三次duplicate均0调用，全部实际audience发布。11调用/114197输入/4498输出，¥0.1618405，320源码起止一致，本批已关闭。NPC未来计划仍是既有fixture；下一步无fixture交谈形成新计划与完整Goal差量继续，修订/恢复在本批未触发不计通过。

[round66](vnext-round66-validation.md)无fixture新房首个schema选择把已提供passTime与social一起请求，触发VALUE_INVALID并停批；1调用/¥0.0251703，0事件/资源/时间/计划变化，replay与源码起止一致。它未进入Proposal裁决，不是NPC合法不形成或Rules拒绝。后续只收敛纯schema选择对已加载类型的幂等处理，未知标识仍拒绝，保留原失败与调用上限。

### 已完成的诊断任务记录

最新真实结果：[round64](vnext-round64-validation.md)第一句knowledgeReview已发布且幂等；第二句返回未闭合感官字符串，JSON_SYNTAX准确定位offset1408与原evidence字段，不可安全补全，第三句停批。原稿另有仅在observe文字写一分钟的未执行路由问题。4调用/76141输入/1149输出、¥0.095254；3事件完整replay、320源码起止一致，所有本批服务已关闭。来源闭包修复仍仅有原稿新context离线因果证据，不能提前称连续稳定通过。下一接口调整将复用已有schemaRequest阶段，只展开实际选择家族；保留现有预算和一次修订，不再增加同义提示或清洗未闭合字符串。

用户本轮要求完成[通用提案诊断与窄修订](vnext-proposal-diagnostics-validation.md)，并明确不部署、不 push。本次接通稳定诊断、服务端固定修复计划、票据/保存响应核对和私有错误传播；保留普通 2 阶段、schema 补取时 3 阶段及仅一次修订。既定机械结果与冻结上下文不可借修订改变。当前工作树收束又补齐 correction 缺字段/canonical 原因、顶层类型与数组约束诊断，防止遥测 hash 将表单错误误报超时，并在 Room 首次保存前核对唯一修订正文；parser v13，最终 Node 120/120、Room 9/9、类型检查通过。没有真实模型前后对照，不声称成功率提高。下列完整 Goal 与 round30/V05 保留为历史交接，本次不继续其开发或发布，也不改变历史批次结论。

最新增量复核修复重复引用的相反指令：成员路径的原诊断现在关联服务端已证明的父数组整体替换，保留原位置、固定值及允许路径；parser v14。四种引用位置共用同一 Provider 行为矩阵，最终 Node 121/121、Room 9/9、typecheck 通过。继承 V05 的 refusal 成本结果先收窄为 committed 再取事件，定向成本/重放用例通过；未开放 clarification，V05 完整执行仍未完成。本次无真实模型调用、部署或 push。

交接后 Rules 公共运行时另有继承修改，因此仅复核诊断直接消费者的同一 9 项 Room 用例及类型检查，均 exit 0（`/tmp/zhuwei-diagnostics-handoff-room.log`、`/tmp/zhuwei-diagnostics-handoff-types.log`）；未改动诊断源码、未重复 Node 121 项矩阵，也不将重复执行累计为新增覆盖。此证据不代表 V05 完整能力通过。

交接中已执行的 [round29](vnext-round29-validation.md) 使用新房、新捕获目录与源码清单，预设最多 2 行动、10 次调用、580,000 输入、81,920 输出、10 分钟与最高费用 ¥2.50，每 HTTP 请求最多 5 次。实际仅 1 次 Proposal，旧知识引用错填为本束新事实来源，Rules 拒绝后停批；0 事件、Receipt、Claims，状态与 genesis/replay 精确一致，费用 ¥0.05394。源码已补字段说明和同源提前诊断，原未改响应本地得到 3 个精确路径；不自动换来源，不追加模型调用，不改判真实成功。定向 Node/Room 和类型检查已通过，证据见报告。

历史交接记录：上一轮按用户要求完成诊断开发、直接消费者和定向验证，未部署、不 push，属于实质进展；其后交接记录恢复完整 Goal：真实主链 → 完整游玩能力 → 定向稳定性 → 既有 Worker 部署与生产替换，push、远端 migration、Secrets 和新增资源仍分别授权。该记录不替代上段当前任务范围；保留全部未提交工作，不重做已经验证的机制。

新批 round30 从修复后的源码、新房及独立捕获目录开始；预设最多 2 行动、10 次实际模型调用、580,000 输入、81,920 输出、10 分钟及最高费用 ¥2.50，每 HTTP 请求最多 5 次。先验证同类正常 NPC 意图，再根据已公开结果进入后续行动或复杂 schema 补取；首个明确失败停批定位，不复用 round29 草稿或 session，不重复采样挑选成功。真实调用期间生产源码冻结，只读 V05 继续方案可并行准备。私有归档合同仍等待原有答复，独立工作继续。

[round30](vnext-round30-validation.md)现已失败停批：首个strict工具响应为嵌套JSON闭合错误，check缺完整failure执行分支，精确诊断offset1683；原稿拒绝，无修订/提交。1调用、31,796输入/895输出、¥0.0489375，0事件/Receipt/Claims，state/genesis/replay精确一致。下一步核验官方strict API合同与实际endpoint/参数；不再抽样猜原因。V05首条冻结clarification执行方案已只读细化，可在源码冻结解除后继续；完整Goal未完成。

## 用户已确认的执行边界（2026-09-05）

- [x] 本次替换中的既有 0.4 房间及可恢复归档允许退役删除。旧房保留/迁移不再是待决选择，不为这些数据建设兼容 Adapter、双写或迁移到 vNext 的机制。准备完成后核验删除范围再执行；实际删除尚未发生。
- [x] 授权自主进行有界 DeepSeek 真实 API 链路测试、模拟交互并查看服务端日志；不局限离线检查，也不需要每次调用前重新请示。
- [x] TODO 按“已实现保留、复用接入、重构、新增、验证”分账；已有实现不重复开发，复用前检查是否满足当前 vNext 合同。

退役范围限于旧房间及其关联归档/状态，不包含账号、无关数据或 vNext 后续新建房间。部署、新资源、Secrets、push 等未被本次直接授权的操作，仍在具体准备完成后按对应权限执行。

## 本次快速开发部署决定（2026-09-06）

本次 Goal 明确授权部署到既有 Worker `zhuwei` 及既有绑定；Git push、远端 migration、Secrets 和新增资源继续单独授权。优先级为真实主链、完整游玩、定向稳定性验收、快速部署与生产核对。保留当前未提交工作，部署前记录可追溯源码状态与保护 vNext 新数据的恢复方案。

- 暂不运行全项目测试、全项目 Lint 或完整冻结门；发布证据采用实际影响面的定向检查、代码审查及必要的一次部署构建。
- 120 条金标全量采用报告与统计性发布认证、长期 SLO 后置，状态保持未完成。以下旧采用表是后置认证口径，不阻止本次功能开发与快速部署；行为正确性、权限、秘密、事实一致性和机械正确性不豁免。
- 原 8k/16k 输入及百分比压缩指标作为优化参考，不作为本次阻断门；必要上下文完整保留，可配置调用/token/费用/时间异常上限继续执行，超限诚实失败。
- `deepseek-v4-flash` 四到五小时整桌费用争取人民币 20–30 元，是可放宽软目标，不是每名玩家额度或强制停团线。按实时官方价格和真实缓存命中/其他输入/输出 usage 估算，开发与模拟玩家费用单列；不足样本不声称实测整局。
- 补齐角色开场初始知识与非行动检查边界：已有知识、状态/裁决询问不自动消耗虚构时间或触发危险；真实调查按玩家方法和世界条件裁决，不按“我知道些什么”等文本建专用分支。
- 当前开始承接 round9，源码仍 `cloudflare/258caee` 的未提交开发树；进程核验无遗留服务。普通完整提交与旁白、复杂主动补取后的提交为下一批真实验证优先项。

## 前一批承接点（2026-09-06，round28 已停批）

[round28](vnext-round28-validation.md)真实正常NPC请求1次、31,536输入/953输出、¥0.0515925，JSON接受但本人裸knowledgeRef被social入口当作foreign拒绝，实际0事件/Receipt/Claims，原源码replay精确等于state/genesis。已补同一完整本人快照内knowledgeRef/entryRef规范解析，外来holder/缺正文仍拒绝；原未改响应离线lowering接受，未执行Rules/提交Room。Node33/34后去掉错误前缀假设仅失败项1/1、正常Room1/1、typecheck/diff-check exit0。原台词舞台说明、未显式固化的新亲历及模型真假/语义判断仍未通过，不改判真实成功。累计55尝试/52已知usage，548,899输入/53,386输出，已知¥0.78463595–0.8987727另3未知。server/capture已退出130；无新生产操作。

**用户纠正：KP可以按人物上下文填补未记载经历，新创作不要求同内容已有引用；应检查与既有年龄、时间、经历、锚点和承诺是否冲突。** 已撤回round26“没有旧引用就是杜撰失败”的判法，修正Prompt过度限制，并补NPC本人identity漏掉的既有背景。[新经历与记忆本地纵切](vnext-world-fact-memory-validation.md)现已接通通用worldFact→正史版本指针→主体记忆→同束social→下轮与驱逐恢复，最终Node106/106、正常Room1/1。部分感官证据不解锁隐藏全文；骰后重建及提前完成标记不能替换历史。提交前当前只有同次KP语义自检，任意文本矛盾与隐含秘密借用识别、历史消息源完整实体化及真实Provider验证仍待；V06保持未完成。见[实施计划](vnext-social-implementation-plan.md)。

普通Room的下轮prepare暴露旧16k artifact硬门；按已核验Goal执行决定改为160,000 canonical units异常上限，必要闭包不截断，独立完整Provider请求继续58,000估算输入预算。此处本地恢复已验证，不代表当前新schema/上下文已通过真实Provider。

SPEC0001 §9同时保留NPC撒谎、误记、夸张及转述假消息：正史一致性不得扩张成台词必须真实。现役SourceClaim保存说话者/依据/动机/时间，听者只取得主张；新增故意欺骗和误信传播两用例通过，旁白Prompt明确审核引语归属。真实Provider语义判断仍待，不能事故后补造撒谎动机改判。后续[NPC自身来源记忆与本人知识alias](vnext-npc-source-memory-validation.md)已修：本人NPC在驱逐后的prepare可取回原motive/sourceBasis/时点，公开听者不泄露；本人裸知识alias与规范ref共用精确绑定，目录无正文或外来holder不能补足。Node直接组45/46、同步旧JSON窄修订断言后失败项1/1；Room3/3及typecheck exit0。round27原非法JSON仍拒绝，离线诊断副本lowering已接受，未提交或追加API。

[NPC引用/初始化与Activity投影修复](vnext-social-npc-initialization-validation.md)已有定向证据：实际holder目录→social同源验证，正常模块NPC目标/行为边界/明确未知进入genesis及本人Context；Activity未完成结果不外发；最新背景补全Node45/45、正常Room初始化1/1，先前初始化/social/revision Room5/5。公开背景可见不等于玩家获得NPC私有目标或作者备注。

[round26](vnext-round26-validation.md)1次真实调用因目录裸ref/holder合同冲突未提交；[round27](vnext-round27-validation.md)1次正式Proposal缺闭合符未提交，唯一thinking对照HTTP400、无usage或原因正文，不再次采样。两批机械状态均等于genesis、replay精确，0Claims。round27离线补闭合符后parser接受、basisFactRefs合法，lowering另报read-bound错误待定位，副本未提交。round6–27累计54次尝试、51次已知usage，已知空闲标价¥0.73304345–0.8471802，另3次未知费用，全部开发验收。无部署或生产退役，V06及完整Goal保持未完成。

[独立 social Form 与原子恢复](vnext-social-interaction-validation.md)已接通 strict schema→NPC本人冻结Context→Rules发言/知识/关系/承诺→私有Claims→真实本地Room。直接、成功、失败及共享检定后果、第三人/沉默/感官条件、类型与骰面篡改、更正、社交前缀后的玩家选择/恢复骰均有证据；正式provenance绑定真实提交eventId。Node主组102/103，补齐旧schema清单后失败项1/1，旧消费者3/3；Room5/5、typecheck/diff-check通过。完整语义重试、Activity/时间/成本、玩家主动承诺/交易、其他通信及真实模型判断仍待；本批API/部署0，V06与Goal不勾选。以下段落保留各前置批次当时的边界。

[关系/承诺/债务领域与Claims](vnext-social-commitments-validation.md)已共用闭合payload、真实参与者/依据和唯一ID校验；Receipt从typed参与者生成，修复合法提交无法projection的缺口。双方得到有方向/条件且尚未履行的承诺事实，同场第三人无记录，隐藏依据不进入基础投影或Claims grants，承诺不提前改变物理状态。公共Rules Node40/40、旧直接消费者3/3、typecheck/diff-check通过，replay/correction一致。当前仅共享领域闭合，独立social Form/计划/实际发言/本子步骤fold/对话恢复与真实Room纵切仍待；没有API/部署，V06保持未完成。

[NPC 决策快照与共享检定](vnext-npc-context-validation.md)已消费 Room 的独立 NPC Viewer，与同 state/profiles 的 Rules 投影核对；绑定完整本人知识目录、namespaced 正文、身份/可见事实/安全连续性，缺材料不等于空知识。已补 conversationThreads 版本绑定。NPC Node28/28、Room实际prepare 1/1、typecheck exit0。共享检定按唯一完整失败分支选owner，其他direct后果按outcomeBinding执行；Node54/54、Room成功/失败2/2，保存/驱逐/duplicate不重骰或重复世界变化。只读审查随后发现失败后果被称为直接成功，已依据同根真实结算ledger改成applied后果并补Claims/旁白断言，修复后Node27/27、Room2/2。无API/部署；social Form、回应/承诺/fold/Claims/对话恢复仍待，V06继续未完成。


[完整语义 JSON/schema 窄修订](vnext-json-repair-validation.md)已支持全部根成员完整时的外层闭合/尾逗号错误，以及机械语义完整时的缺失/非法摘要；持久证据→唯一稀疏correction→全束重验。纯语法必须显式changes:[]，不会自动提交。Node38/38、Room7/7、typecheck exit0；普通2调用与补取3调用的两次保存后驱逐恢复均无重采或重复世界变化。本轮无API。重复键/截断子提案/未知字段与机械改判继续拒绝；round25仍不可恢复。该批之后的NPC切片进度见上段；social Form与机械/引用诊断修订继续列为差量。

[来源主张与知识分享](vnext-source-claims-validation.md)已修复持有记录回填原全文/私有依据、分享层级伪造及来源身份扩大一般Claims权限；单条/batch知识取得保留真实正文、来源、层级与推断confidence，未证实主张和转述明确呈现。最终Node57/57、Room直接恢复消费者3/3、typecheck exit0，无新增API。NPC独立冻结切片的后续本地进度见上段；新social、文献Form与分享HTTP纵切尚待，V06继续未完成。

SPEC0015 §§6.1–6.2与SPEC0016 §§7.2、12允许冻结语义内的稀疏修订；已从summary-only补齐上段有证据的结构修复，不能外推为所有schema/Rules错误可修。损坏JSON必须由完整、直接、顶层且无重复键的原成员证明冻结语义；round25的proposals不完整，不能恢复或重发整束，原失败结论保留。

[round25](vnext-round25-validation.md)在当前 observe 源码下发出1次真实 Proposal，原工具参数缺一个 `}`，诊断副本补齐后另有未知 `adjudication.pressureLabel`；实际请求与当前 strict schema/指导完全相同，无旧指导污染证据。原响应未清洗、未提交：0事件/Receipt/Claims，完整state等于genesis，replay精确一致。20,555输入/1,541输出、¥0.0373958，首失败即停且本地服务已关闭。草稿的感知/解释分类仍未过，不能以本地80/80或结构诊断改判。下一步继续来源主张/social及已复现的Viewer私有动机/依据泄漏修复，同时保留Provider strict违规与真实复杂链为待解决项。

[独立 observe 与推断](vnext-observe-validation.md)已接通 strict Form→冻结本人知识／分支局部感知索引→同一 Rules 原子提交→私有推断、confidence、Claims／知识回顾／桌面；纯思考无感官／时间／资源变化，所有分支及后续原子步骤在随机前校验。Node80/80、Room5/5、typecheck exit0。真实模型分类与旁白尚待新批验证，来源主张／social／NPC 等完整V06仍未完成。以下round24是旧源码真实失败，不用本地结构证据改判其语义结果。

[round24](vnext-round24-validation.md)仅完成1个正常Cookie HTTP炉台观察的机械提交，3次调用中审核在本地剩余41,621ms截止；旁白未发布，批次已停。2次已知用量22,182输入/1,273输出、¥0.0247103，另1次费用未知。5事件/1Receipt与实际replay精确一致，但原Proposal把历史原因/时间推测放进full感官证据，属于未修复的V06语义缺口；底层独立推断机制已有，vNext模型入口尚缺。炉台是已有战术对象，未补取schema不算路由Bug，复杂补取仍未通过。本轮只读诊断与定向恢复1/1通过，没有修改生产源码。下一步补齐知识类别的通用可达接口与拒绝边界，再继续真实复杂链；私有恢复合同仍待答复，总Goal保持active。

[round23](vnext-round23-validation.md)新房正常Cookie HTTP知识回顾已完成真实Proposal→Rules/Room→Claims→生成/review-v5→发布，3调用24,126输入/3,177输出，标价¥0.0449175；重复submission新增调用0、同Receipt/Delivery，实际SQLite replay精确一致且机械状态不变。正文等同单条本人开场知识，不能外推多条整理或连续叙述质量。普通玩家/NPC due本地Room/Store25/25，稳定恢复Medicine与Claims组41/41，最终typecheck exit0；更多Room恢复/ActorPlan/归档仍待。私有恢复合同对SPEC0011的窄修改已请求用户确认，暂不执行依赖批准的归档。以下旧round段落保留历史证据，不能当成当前源码验证或把其失败覆盖。总Goal保持active。

随后已实现 [review/v5 固定覆盖键](vnext-review-v5-validation.md)：从全部冻结 facts 生成必填 f0…fN 对象，每格保留 covered/omitted，拒绝漏键、旧数组和身份混用；动态工具先计入完整 12k 预算，Policy 进入 Workflow hash。当前源码 Node40/40、Room11/11、typecheck exit0，独立只读审查未发现问题。没有新增 API 调用，普通非 strict 传输保持，真实 v5 旁白仍待验证。到期方案须先协调非行动查询与到期工作归属，不能在查询识别前无条件 drain；新阶段表的持久版本门和旧房退役通道亦未实现。总 Goal 保持 active。

审核已改为冻结证据目录 review/v4，并修复精确 fact 身份、最终 Provider 请求预算边界；最终 Node48/48、Room10/10、typecheck通过。round18同材料单次审核通过；round19新房机械提交/replay一致，但审核思考截断，round20用完整8192额度得到工具后仍漏必要coverage，**完整可用旁白未通过**。6次实际调用37109输入/14362输出，全部失败保留；参见[round20验收](vnext-round20-validation.md)与[脱敏证据](vnext-round20-live-evidence.json)。

已完成[非行动知识回顾本地纵切](vnext-knowledge-validation.md)：完整本人知识目录、全选/相关选择的 strict terminal、Rules 私有 KnowledgeReviewed、按 Viewer 冻结 Claims、旁白恢复与后续正常操作；前序 Node38/38、Room11/11、typecheck通过。[round21/22 实测](vnext-round22-validation.md)共4调用：round21因根basisRefs多填拒绝、未提交；补填写指导后round22真实知识回顾提交1事件、replay精确一致且无机械变化，但review/v4因双破折号间隙拒绝，旁白未发布。后续完整分隔span修复只有39/39合成证据，没有重判旧失败或追加API。累计成本账为44尝试、已知399,115输入/44,263输出，见[脱敏证据](vnext-round22-live-evidence.json)与[成本账](vnext-cost-estimate.md)。[到期 Activity 接缝](vnext-knowledge-and-due-plan.md)仍待闭合。没有部署、push、migration或生产退役。下文各“最新round”均为对应批次的历史证据，不代表当前已经闭合。

## 最终完成的含义

vNext 应支持多人从开团、自由探索、NPC 互动、风险与战斗，一直玩到后果持续、故事收束和自选续篇。KP 在故事锚点内判断与创作，Rules 执行机械，Room 保存唯一权威事实，各玩家看到自己有权知道的结果。全部承诺能力必须能从实际模型提案到达玩家界面。

最终替换同时满足：

1. SPEC 0001 §§4–19 的行为闭环与 §21 A–O 的最低验收均有证据，明确区分机械执行和模型判断质量。
2. SPEC 0016 的十个 Form 家族各有必要的真实纵切，并可在一个根行动中合法协作；已有 Rules/Room/Ability/Item/战斗/归档机制按实际职责复用。
3. 新事实、状态、时间、知识、物品、叙述承诺和结局能提交、恢复、投影与重放；环境细节按原叙述在引用/因果影响前固化，重试不重复副作用或改写描写。
4. 开房、入席、建卡、桌面、语音、地图、队伍、休整、战斗和恢复等现役玩家功能完成 vNext 接入验收。
5. 生产默认采用完整 vNext 绑定；当前房间/归档按明确策略处置；旧 V3 专用路径在依赖清零后退役。替换 KP 路线不自动更改产品代际或既有协议的名字。

## 每项待办共用的完成门

- 能力合同明确使用者、对象类别、变化维度、权限/失败边界、持久化归属和可见结果。样例用于验收同一通用机制，不能成为生产名称判断或专用 schema。
- 每项至少验证一个代表性样例、一个结构不同的样例，以及最高风险的拒绝/边界/恢复路径；已有测试能证明的部分直接复用。
- 涉及 KP 的能力必须贯穿：`自然语言/待决回答 → 可信身份与冻结上下文 → 当前模型 wire → 校验/降级 → Rules → Room 原子提交 → Viewer Claims → 叙述/下一次行动`。
- 类型存在、工具 schema 可表达、Room 可执行和生产可使用分别记账。未闭合的一层不能算能力交付；缺失的基础机械列为实现任务。
- Rules 继续仅以 `step / project / replay` 对外，活动房间继续只有 Room Authority。自创效果不合法时返回具体诊断，受限修订仍失败就诚实结束该提案。
- 日常实施遵循 AGENTS 的定向验证；本次快速部署按上文限定决定执行，完整统计认证后置。真实 Provider 在会影响设计或验收结论时运行有界探针，不能用大量重试挑选成功记录。

## 实现状态与剩余工作分账

“已实现”表示当前源码中存在并有对应实现/测试证据；2026-09-05 已进入危害/物品实施，下面保留未完成的整体交付门。验证状态独立记录为历史证据、本轮确定性验证、本轮真实调用、本轮生产验证，彼此不代替。后文未勾选的项目是剩余整体验收，不表示其所有子机制都要从零实现。

| 能力切片 | 当前可以保留的实现 | 剩余工作的性质 |
| --- | --- | --- |
| Rules/Room 权威与事件 | `step/project/replay`、DO SQLite、submission/随机/Pending/Delivery journal、归档与 Viewer 权限 | **复用接入 + 验证**：使用完整 vNext manifest 验证调用、恢复和公开入口 |
| vNext-2 Bundle | schema/parser、服务端计划、prospective 引用、物化+交互原子束、共享检定与 Room 测试链 | **已实现保留**：不重写已闭合的束机制；**复用/扩展**其他家族 |
| vNext 冻结上下文 | 引用目录、义务闭包、五态解析、先例解析、hash/冻结及 read-set 复核；真实模组/场景 requirements、open-blank grants 和 structured precedents 已接入 | **本地接入已完成 + 产品验证**：创建范围与因果依赖通过定向矩阵；真实模型对冻结依据的正确使用仍须验收 |
| 模型 Provider/预算 | 正常本地 API 的 vNext Adapter、最终请求预算、DO 请求/响应 journal、一次 summary correction 票据与真实 handshake | **本地接入已完成 + 产品验证**：round6 一项真实库存操作及自然旁白发布通过，旁白生成/审核共 3,493 输入 tokens；Proposal 为 28,367 输入，未达到 V11 采用门；完整真实矩阵仍待 |
| vNext 危害机械 | Ability 引用、混合伤害骰/固定伤害、逐目标 save、attack、区域 Geometry、条件/专注/死亡与 replay 已接通 | **已实现保留**；**定向验证已过**有序反应与范围/可见目标；后续接完整生产入口 |
| 旧环境/战斗机械 | `combat-actions.ts` 的 `beginEnvironmentHazardRandomness/resolveEnvironmentHazardRandomness` 已有区域目标、伤害骰、逐目标 save、部分状态/地形；通用伤害防御、临时 HP 与 deathPolicy 已存在 | **提取复用**到作者化 Ability 危害；不重做 Geometry/伤害内核，不照搬旧环境大 schema |
| 危害作者化与生命周期 | wire/lowering 已接通 Ability/hazard，directSuccess/atomic 独立随机、持续/解除及权威 triggers 关系已实现 | **组合验证已过**同束反应暂停、恢复和持久解除；后续验证完整产品链 |
| 物品权威 | vNext 已接入 ItemDefinition/ItemEntry、物化/取得/转移/装备/使用、能力冻结、Viewer inventory 和生命周期 | **已实现保留**；原子反应/恢复已验收，NPC 完整库存行为随现役功能接入继续验收 |
| 物品位置与强制转移 | held→scene 释放、整量/部分转移、损坏/修复/毁坏已接通；强制转移由同根真实成功裁决签发资格 | **已实现保留 + 验证**；名称或模型自称成功均不能授权夺取他人物品 |
| 动态 NPC | 机械模板、独立实例、既有 NPC 获得机械、装备与状态同步、极值用例 | **复用 + 扩展**vNext 创建入口和 §8 缺失表达；**重构**不合理强度限额及机械诊断/受限修订 |
| 直接成功/检定/拒绝 | vNext-2 directSuccess/check、inWorldRefusal、物品/资源/虚构时间尝试成本 | **已实现保留 + 真实验证**；高风险/澄清仍有新增接线 |
| 重大澄清 | domain 类型、Pending 基础、公开问题/选项 lowering | **重构 + 新增**：当前 vNext-2 lowering 没有完整携带 typed continuation；需同时补 wire、冻结继续、持久化与恢复 |
| 观察/社交/知识 | 已有事实/证据/来源主张/推断、社交结算、Viewer 与 NPC 知识边界 | **复用接入**独立 observe/social；**新增/验证**当前模型的角色知识使用与完整互动 |
| 时间/NPC 计划/连续性 | Activity、ActorPlan、虚构时间、承诺/任务/结局、更正等规则已有 | **复用 + 重构编排**：让 vNext 调用先结算真实到期事件，接 objective/story 家族及因果上下文；验证自由收束 |
| Activity 完成效果 | `canonicalActivityEffects` 已覆盖证据/知识、资源、NPC alert 和移动 | **扩展**冻结完成计划以表达延迟关系变化/危害触发，复用既有时钟与调度 |
| 多人/战斗/桌面 | 现役席位、组队、空间、Encounter、法术/反应/状态、地图、语音与恢复 | **复用接入 + 行为验证**；只有具体违反共用不变量的地方做修复 |
| Claims/叙述/重试 | committed-range Claims、Viewer grants、DeliveryPlan、独立冻结表达材料、自然生成/一次审核、逐受众重试 | **本轮重构已实现**：保留原 Claims hash，按身份和来源组织材料，审核语义/可读性/人物/连续性；**验证**完整真实游戏矩阵及审核误报/漏报 |
| 测试与遥测 | A–O 登记、B/H 行为 probe、现有 Room/Rules 用例、handshake、V3 live runner、日志汇总 | **复用/改造**vNext 真实 runner与结果对照；**新增**不足的判断题面，**执行验证**当前精确源码 |

主要证据入口已列在 repo map；补充复用重点为 `rules/v2/{combat-actions,damage,items,item-transitions,npc-mechanics,actor-plans,campaign-actions}.ts`。先检查公开行为与直接消费者，避免为复用引入第二权威或复制另一套算法。

## 交接实施进度（当前工作树）

- **2026-09-06 round21/22：** 知识回顾已获得真实 Proposal→Rules/Room→私有 Claims→replay 证据；round21未提交、round22提交但旁白审核失败均保留。根basisRefs填写说明后wire目标组28/28；round22后完整双破折号间隙修复39/39仅为合成验证，真实完整旁白仍待通过。[完整记录](vnext-round22-validation.md)。
- **2026-09-06 round12–16：** vNext 旁白显式 low thinking，固定 JSON generation + tool review、唯一 JSON 成员与完整结束校验，review/v3 逐 fact 覆盖。44 Node/10 Worker/typecheck通过。round14 同冻结材料的完整 Adapter 通过；round15新房正常HTTP已合法提交库存及叙述承诺/replay精确相等，审核漏标点/覆盖而拒绝；round16补完整coverage后仍有模型引用错误，不能称真实旁白完成。所有批次已停，复杂动作尚未开始。[完整记录](vnext-round16-validation.md)。
- **2026-09-06 round10/11 收口：** 现役 authorityDirect 输入恢复，Activity 回执从权威关系取得角色，开场 publicOpening 写入实际在场初始角色的私有知识。Node 32/32、Worker 13/13、typecheck exit 0；[记录](vnext-round10-validation.md) / [成本情景](vnext-cost-estimate.md)。两批真实库存提交及 replay 精确核对通过，但旁白均未通过人工验收：round10 旧审核误放行，round11 新审核拒绝无依据描写。逐断言审核及后续标量/payload/容量修复不代表模型语义判断已经稳定。自然语言既知回顾、澄清/高风险续接、独立 observe/social/objective/story/combat、动态人物/地点/通路、到期 Activity 调度及 RootAction 累计预算仍是实现差量；构建/部署/退役未执行。16k context artifact 异常限额与最新软目标的关系仍待核对。
- 已接通模型作者化 Ability/hazard/ItemDefinition/ItemEntry 和库存操作；复用同一 Ability 编译、Item authority、Rules 事件与 Viewer Claims。
- **hazards / items handoff 的实现与定向验收完成。** 混合伤害骰、逐目标 save/attack、Geometry、独立危险、持续/解除/到期、物品完整操作与多次使用已接通；单条/原子束共享有序执行器。前序状态的施加/解除、反应失能和可见性变化都影响后续结算，潜在目标/条件骰提前冻结。
- 最终受影响 Node 组覆盖 86 项；旧骰面 fixture 修正后其 25 项消费者复跑通过。Room 10 项最终通过：作者化 hazard/Item、捕获真实输出、原子玩家待选、原子 NPC 有限知识、两次反应、模型失败/eviction、重复/越权和一条既有正常路径；其中两项因旧骰面数量/不匹配场景的射程 fixture 修正后复跑。typecheck/diff-check 通过。早前稳定作者化/库存/条件/Claims/UI/NPC schema 组 119/119。各组存在重叠，不相加。
- 玩家可在同束装备新物品后使用新授予反应；只公开控制者的合法答案，不提前公开候选 Item、定义或 HP。NPC 则按唯一候选的自身状态作选择，服务端持久答案与能力凭据保证恢复。
- V02/V03 的实现差量已经大幅完成；下列未勾选的长期/完整产品门仍须与 V01/V08/V11 的实际入口、模型判断和生产采用共同验收，不能把本次局部交接等同于 vNext 已可替换生产。
- DeepSeek 实际请求累计 **9/12**；包含失败尝试。第 8 次 Item 请求经过 parser/lowering/Rules/replay/project/下一上下文成功；第 7 次 strict 输出不合法，不能把单次成功解释为稳定合法率。第 9 次验证新增 NPC 待选 Adapter 的真实工具调用成功，585 输入 / 68 输出 token，合法反应答案且服务端 capability 未进入模型。它是合成有限知识请求，不是生产或实时 Room 证据。捕获响应的离线回放不增加调用计数。
- 界面与 Room pending 白名单定向验证 7/7；禁止内部候选状态/预留骰面泄漏，界面只转发合法答案。生产依然 V3；未 push、部署、远端 migration 或删除。

## 有界在线测试与结果核对

V01–V03 本批进度见 [验收记录](vnext-v01-v03-validation.md) 和 [脱敏真实证据](vnext-v01-v03-live-evidence.json)：V02/V03 通用功能及定向生命周期矩阵通过；V01 本地认证入口、Provider、预算/恢复/归档已接通，真实游戏成功提交尚未通过。共使用 **10/12** 次 DeepSeek 请求；两次普通 HTTP 提案分别为空执行束和不存在的对象引用，均安全拒绝，最终 stateVersion=0、receipt=0。首次失败后只做一次诊断对照，停止本批；未消耗剩余额度。上节 9/12 是前序 handoff 批次，不能混为本批成功率。

后续独立 round2 为 2 次调用、61,840 输入 / 2,092 输出 tokens；最新 round3 为 2 次、53,131 输入 / 1,725 输出 tokens，均未完成成功提交。已批准的叙述承诺、明确引用时强制固化、物品堆叠后继与库存资源权威机制通过定向验证，在线详情及准确边界见 [最新验收](vnext-narrative-validation.md) 和 [独立批次证据](vnext-narrative-live-evidence.json)。不得将捕获响应的离线修改重放算作在线通过。

最新 **round4 已首次经正常 Cookie HTTP → real DeepSeek → Rules/Room 提交**：单项库存释放，以及修复后的库存＋原地观察组合均提交，库存20→19、地面新增1，两个实际事件流 replay 与存储精确一致。首项旁白缺结果，唯一修复对照的旁白初次/替换均 grounding 拒绝，故 V01 可用输出门仍未完成。当前已补库存双端 Claims、场景观察范围、叙述物化义务依赖与安全旁白原因码；共6调用、61,518输入/1,807输出 tokens，未追加碰运气。完整边界见 [round4 验收](vnext-round4-validation.md) 和 [脱敏证据](vnext-round4-live-evidence.json)；前述批次均为历史分账。

真实调用已获授权。原默认开发批次为 **1–3 个根行动、最多 12 次 DeepSeek 请求**；2026-09-08 当前 NPC 三句批次按[根交接](../../handoff.md)及其冻结 `plan.json` 的专项上限执行：**20 次物理调用 / ¥5 / 20 分钟，每 HTTP 7 次调用 / 120 秒**，优先于本段旧默认值。其他新场景另按明确的批次计划定界，不把专项上限自动外推。所有模拟玩家、KP 提案、修订、NPC 与叙述调用都计入；先记录预算与停止条件，再启动批次。首次明确失败即停批定位，只有能区分原因时做一次对照，并计入同一预算；不循环重跑碰运气。

- 可用 DeepSeek 生成模拟玩家的输入或待决回答，但模拟玩家只读取自己的 Viewer 内容；产品 KP 仍通过真实 Provider 与正常 Room Action 路径处理。测试模型不得直接编造已归一化 Rules 结果、骰面或权威状态。
- 未切生产时使用本地/已批准测试宿主的真实 HTTP → vNext → 在线 DeepSeek 路线；当前远端 V3 的成功只能证明 V3。生产切换后再验证精确的 vNext 部署版本。
- 测试前后读取玩家可见结果、Receipt/根行动的安全关联、当前投影和后续状态；按时间窗口与可用关联标记检查服务器日志的模型调用、错误、修复、延迟。HTTP 200、模型文本、日志“成功”均不能单独证明效果提交。
- 查看服务端日志不扩大日志字段：沿用脱敏遥测白名单，不记录密钥、Cookie、完整 Prompt、秘密正文或模型原文。Viewer 内容在获授权测试会话中检查，报告只保留必要结果与不可逆标识。
- 确定性测试负责精确骰面、权限、重放与竞态；在线真实链路负责模型选择、实际传输和玩家可见闭环。二者按风险互补，已有证据充分时不重复同义测试。
- `tools/run-deepseek-strict-tool-handshake.mjs` 配合当前 vNext2 definition 是 5 个正例加 1 个非法 schema，共 6 次调用，只证明传输/parser；不得当作完整游戏测试。`tools/run-live-kp-eval.mjs` 当前固定 V3 生产路线，复用前改造/核验 vNext binding 与调用凭证；日志汇总也须关联本次测试，不能把历史日志计入。
- 20+ 交互集中在候选稳定后；120 条金标采用评测后置，两者分别，预先记录独立的总回合、调用/token/费用预算与停止条件，分批执行并在批间核对价值，复用离线预检筛掉结构错误，不在日常小改后整套调用；已授权测试不逐条/逐次重新请示，未测指标不伪装通过。

最新 **round5** 专项定位 Narration：同一已提交行动经正常 HTTP 恢复，始终未重跑 Proposal/机械或扣库存；单次独立诊断取得事实合并和“角色→你”改写原文。Provider 输入改为无损分组事实后，两次输入由约 2.3k 降为 995/880 tokens，但仍因不支持分句/遗漏事实失败。之后补 typed actor/recipient/operation 与完整环境互动事实，仅本地定向验证。共 **5 次、8,814 输入/776 输出 tokens**；未继续采样。见 [round5 验收](vnext-round5-validation.md) 与 [证据](vnext-round5-live-evidence.json)。此前“最新”段落为各自批次的历史结论，V01 仍未通过可用旁白门。

最新 **round6** 已实现 [Narration 重构](narration-grounding-redesign.md)：冻结获授权的表达材料、自然正文生成、一次独立语义/质量审核及同材料恢复。一项普通 HTTP 真实库存操作已提交并发布可用自然旁白，库存 20→19/地面1，重复请求零调用，实际事件 replay 与存储一致。允许无独立后果的动作润色，不授权新机械效果或玩家决定。共 **7 调用、92,593 输入/2,956 输出 tokens，3 个根行动额度已用完**；原始响应从同一次调用私有捕获。最终边界措辞调整未再次在线采样。完整矩阵和生产采用仍待，见 [round6 验收](vnext-round6-validation.md) 与 [脱敏证据](vnext-round6-live-evidence.json)；上文 round4/5 的“最新”仅是各自历史结论。

最新 **round7** 完成 Proposal 成本拆解、服务端 binding 与模型事实表示分离、schema 共享引用短名称压缩。相同历史冻结材料的真实对照输入 **28,367→26,689（-5.9%）**，仍未达到采用门；该历史对照还包含前批无消费者 wire 删除，不全部归因本轮。新房一次库存释放以 **27,816 Proposal 输入 tokens** 提交，库存20→19/地面1、实际replay一致；旁白因必需事实覆盖失败被拒，人工另发现无依据细节，连续采样已停止。本批 **4调用、58,060输入/1,165输出**（含一次不提交的成本诊断）。见 [round7 验收](vnext-round7-validation.md) 与 [脱敏证据](vnext-round7-live-evidence.json)。后续重点是通用工具填写面/相关性检索及旁白审核质量，不能靠调高上限或截断必要上下文达标。

最新 **round8** 完成通用能力目录、按需 strict schema 装配、一次纯 schema 补取及 Room 持久阶段门。用户已批准普通最多2阶段、补取最多3阶段；仍只有一份 Proposal 和一次窄 correction。初始 schema **47,346→21,199 字节（-55.2%）**，含目录工具体积 **-48.4%**；41项 Node、8项 Room 和 typecheck 通过，覆盖 Item→Ability 依赖、同束创建/使用、两处驱逐恢复及重复补取拒绝。真实正常 HTTP 因首版嵌套工具输出非法 JSON 拒绝，世界状态未变；同冻结材料改为平坦根格式的唯一对照通过本地解析，**20,217输入 tokens**，未提交 Room。本批 **2调用、40,483输入/1,028输出**，已停测。真实补取完整提交、文本 Grounding、8k/16k采用门及 RootAction 累计成本硬限额仍待，见 [round8验收](vnext-round8-validation.md) 与 [脱敏证据](vnext-round8-live-evidence.json)。


最新 **round9** 保留完整能力目录和字段约束，将详细填写指导按 schema 闭包装配，补齐区域 use、共享检定、Ability 配对及生产者句柄说明；正常 Adapter 与直接探针复用同一装配，Room 冻结指导及 schema 呈现顺序。最终 68 项 Node、8 项 Room、typecheck 通过。真实模型正确选择库存操作并填写数量/引用，但重复 JSON 成员导致正常 HTTP 拒绝；同快照只改字段顺序的唯一对照解析通过，未提交或生成旁白。实际 **2 调用、38,232 输入/1,126 输出**，库存/资源/时间未变。相同 round8 上下文总请求仅下降 **2.25% 字节**，不代表实际 token 降幅；真实输入 19,116 仍超采用门。下一批先验证正常提交与旁白，再验收主动补取；见 [round9验收](vnext-round9-validation.md) 与 [脱敏证据](vnext-round9-live-evidence.json)。

## 建议实施顺序

### V01 — 接通本地完整 vNext 调用链

**实施差量：复用已有 Bundle/Room 纵切与 Provider 模块；新增上下文运行时参数编排，重构真实调用接线，补在线验证。**

- [x] 将上下文装配、完整请求预算、Proposal Provider、修订票据与 Room bridge 接到正常本地 Cookie 认证入口；`npm run dev:vnext` 使用独立本地状态目录。
- [x] 同一模型/Profile/schema/parser/prompt 绑定贯穿首提案、一次窄修订、完整重验和提交接线；DO journal、预算、429、驱逐/重试定向矩阵通过，真实传输参数与证据已登记。此项不代表真实游戏成功提交。
- [x] 完成当前阶段三候选的五态 Availability/创建授权接线及 schema handshake：单 `worldInteraction`、`materializeObject + worldInteraction`、生成前非法 schema 拒绝；当前 v8 schema/hash 与端点/参数证据见本批验收记录。整体模型采用门仍在 V11。
- [x] 普通 HTTP 的真实模型直接成功：单项库存释放、库存＋当前场景观察原子提交，库存/证据/Claims/完整 replay 核对通过；这不是旁白质量通过。
- [x] [Narration 方案与矩阵](narration-grounding-redesign.md) 的基础接缝已实现：保留 typed 事实与分组，按 Viewer 冻结身份/公开人物表达/相关对话/历史承诺，生成后最多审核一次；恢复不重跑机械。一项真实库存操作的自然旁白、重复请求及 replay 通过，详见 round6；这不代表整个矩阵通过。
- [ ] 完成 NPC 来源主张与不同声口、失败/成本、多 Viewer 角色归属、连续环境承诺、物化场景对象并交互及世界内拒绝的真实 API → 可用 Viewer 输出；衡量语义审核误报/漏报。内部 NPC publicExpression 修订已有 Rules/Room 证据，完整真实 Provider NPC 创建/修订入口仍待。
- [x] 修复已选装备缺少已有 Ability 的冻结上下文接缝，补注册法术/职业名称和独立中文简称检索；候选限实际持有 refs，保留原权限与类型化因果闭包。23 项 Context/直接消费者及 7 项 Room 定向通过，含弹药、成功/失败、自然20/1及恢复幂等，见 [Ability 上下文验收](vnext-ability-context-validation.md)。
- [ ] 完成自由指代/同义和复合动作表述的通用召回验收；当前注册名称与可分词单字检索并非完整语义理解。真实法术/职业动作资源、连续游戏及 token 采用门仍未过。round7 已完成输入拆解与安全序列化压缩；下一项审视通用工具填写面和候选相关性，再继续有界真实矩阵。

**完成条件：**受控 KP fixture 也必须生成当前模型同形工具调用，不能直接塞 Rules command。真实 Provider 能在同一 Adapter 路径接受当前 schema 并产出可解析提案；请求预算和修订计数确实被该路径执行。

### V02 — 完成通用危害结算与 KP 作者化

**实施差量：伤害骰、攻击/逐目标 save、区域与防御机械、通用持续机制、KP 创建、原子随机及持久停用已完成本地实现；触发/迹象/调查/解除/环境后果的受控产品矩阵通过。真实连续链验收依赖 V01 成功链与 V11，尚未完成。**

依据 SPEC 0001 §§6–8、10。沿交接建议细分，但补齐整个能力：

- [x] 复用 Ability 伤害机制，支持多个合法骰式/伤害分量与固定伤害；正确处理适用的抗性、免疫、减免、临时 HP、专注和 0 HP/濒死/死亡规则。
- [x] 支持攻击命中或逐目标豁免，以及真实 Geometry/范围/目标资格；不能把当前 active `contains` 样例当成全部区域能力。
- [x] 状态施加、叠加/替换规则、持续时间、解除与到期可持久、可投影、可恢复；战斗内外采用同一机械语义。
- [x] 触发条件、迹象、调查/解除方法、持久停用与环境后果真正影响裁决和状态；受控矩阵覆盖调查、开放方法解除、再次经过、持久环境改变及旧提案拒绝。
- [x] 原子束在骰前冻结所有可达分支的依赖与所需随机，正确分发共享检定、攻击/豁免与伤害骰；多波机械复用 Room journal，禁止部分公开提交。
- [x] 玩家动作直接成功时，危险仍可独立要求攻击/豁免/伤害随机；不为获得骰源给无风险玩家动作硬加检定。
- [x] 结算范围闭合后，接通 KP 创建 hazard 与 mechanics Ability、冻结、引用、触发和后续解除的完整链。机械继续由 `mechanicsRef` 复用 Ability。

**代表性矩阵：**逐目标豁免的区域掷骰伤害；攻击命中后施加有期限状态；无检定动作触发独立危险；调查并解除后再次经过；原子束、行动者受伤/濒死、驱逐续接。目标、伤害、死亡结果由机械决定，强度不能按队伍等级暗调。

**完成条件：**九项危害合同均有执行消费者、状态或明确的 KP 判定职责；模型能够作者化并实际兑现合法组合。骰后不改危险，不凭空追加惩罚，状态/随机/成本经 replay 保持一致。

### V03 — 完成物品创建与完整生命周期

**实施差量：主体是复用 Item 系统并接入 vNext；仅补经过直接消费者核对后仍缺失的生命周期，不重建库存权威。**

依据 SPEC 0001 §§4、8、16。复用 ItemDefinition、ItemEntry 和物品权威状态。

KP 自主创作合理合法的新物品及能力，不限预置物品清单。KP 根据锚点、既有事实和因果判断故事合理性；Rules 验证执行结构、引用、行动经济、成本及持久性，不能以推荐等级替代合法性。无法执行时报告缺少的具体字段/机制，不将实现缺口包装成世界内不可能。物品定义正文通过验证后由服务端计算 hash；登记模板的来源 hash 与新物品内容 hash 是不同职责。

- [x] vNext materialization 能创建普通/魔法物品及合法能力，并通过 inventory-operation 取得、携带、转移/交易、装备/收起、使用、消耗、遗失/抢夺、损坏/修复与毁坏。
- [x] 数量、唯一性、所有权、位置、识别状态、charges、durability、资源与行动成本保持一致；同束创建和取得走确定性 prospective 引用；唯一来源销毁后仍保留防重复记录。
- [x] 新增当前缺少的通用 held→scene 放置/遗失路径；抢夺/缴械复用物品转移并连接正确裁决与权限。保留已有拾取、持有者间转移、堆叠和生命周期实现。
- [x] 物品在后续行动、战斗、休整、NPC 持有、章节变化与恢复后仍可用；识别知识按角色与精确定义版本保存，未知物品、能力、资源、待选和 Claims 共用 Viewer 知识边界。证据为定向 Rules/Room 矩阵，真实连续游戏门仍待 V01/V11。
- [x] 自创定义的不可执行项以具体字段路径和安全原因贯穿当前 wire/parser、validator/lowering 与单条/原子 Rules 拒绝；保留 Item 跨字段检查和 Ability 编译器诊断。错误不产生事件，不回显私有内容，也不扩充 summary-only 修订权限。
- [ ] 补齐作者化物品仍缺少的通用效果原语及消费者，例如移动能力/位移、被动防御和装备加值。当前支持的攻击、伤害、治疗、状态等可自由组合，不等于任意魔法效果已经可执行；缺失机制是实现差量，不能改写成产品禁止范围。新增原语沿同一 Ability/Item/Rules/Viewer 路径闭合。

**代表性矩阵：**消耗品创建→取得→使用→耗尽；可重复使用物品转移→装备→损坏/修复；唯一物重复创建、越权取物和传输重试。

**完成条件：**从模型创造到玩家实际操作全部可达；同一物品与成本只提交一次，超出推荐等级的奖励不自动回收或降级。

### V04 — 补齐动态世界、隐藏现实与敌人

**实施差量：复用动态定义、NPC 实例/装备和隐藏现实机制；扩展模型入口与缺失机械表达，重构不合理上限和诊断修订。**

依据 SPEC 0001 §§3–4、7–10、16。

- [ ] 通用 materialization 覆盖地点/通路、对象/关系、人物/敌人、事实及局部否定事实；物品和危害复用 V02/V03，按对应生命周期交接。
- [ ] 内容选择遵循因果→合理性/合法隐藏权重→同等合理的有意义选择→可信随机；允许空房、过时传闻和无奖励结果。
- [ ] 第一次感知、引用或机械影响前冻结隐藏现实；同束生产者/消费者、唯一身份、作用域与可见性全部预检，HP、骰点或后续选择不能重选已固化内容。
- [ ] 动态敌人机械覆盖 SPEC §8 的属性、AC/HP、速度/感官、豁免/技能、攻击/法术/资源、状态免疫和动作/附赠动作/反应/特殊能力；从既有 NPC/Ability 机制补齐表达与执行。
- [ ] 审核现有数值校验：区分 2014 规则派生约束与任意强度上限；不得仅因数值高拒绝。现有极值 fixture 不能代替这一审计。
- [ ] 不可执行定义返回具体项，KP 在允许修订范围内修正并完整重验；当前 summary correction 不算动态敌人机械修订已完成。涉及冻结目标、风险、成本等变化时走明确失败/重新裁定，不能由 repair 偷换。

**代表性矩阵：**尚未定义的地点产生空白结果；生成合法但压倒性敌人并保留其逃跑后的伤势/资源；无效能力得到诊断、修订与真实提交；证据出现后尝试改写秘密被拒。

### V05 — 五类裁决、重大澄清与裁决先例全部可达

**实施差量：directSuccess/check/refusal 和尝试成本已实现；高风险/重大澄清补 wire，重构 continuation 的降级、持久化与继续；先例复用并补运行时选择。**

依据 SPEC 0001 §§5–6、13、17。

2026-09-06 [冻结选择验证](vnext-frozen-choice-validation.md)：clarification 已接通真实本地 Provider/Room 的执行、观察、取消、首随机恢复与 authored Item 原生待决/后续随机。修复首次随机遗漏外层 readSet、失效计划不能取消、持久恢复输入集合遗漏三项问题；Node 61/61、Room 7/7、typecheck 通过。高风险与 Activity 完整可达性仍待，故下列总能力项不勾全完成。[官方 strict/价格复核](vnext-provider-contract-check.md)未发现 round30 端点/参数差异，真实批次仍为失败，本轮模型调用 0。

- [ ] 当前 vNext-2 wire、lowering 和 Room 覆盖直接成功、检定、高风险可行、缺前提、违反规律；补齐 clarification 的提问、回答、取消与冻结 continuation。
- [ ] 只有会改变重大危险、显著消耗、攻击对象或不可逆后果的歧义才问；普通可互换候选不打断玩家，明确意图不重复劝阻。
- [ ] 准备、工具、位置、情报真实改变 DC、优势/劣势、成本或是否检定；骰前冻结裁决与成功/失败意义，适用先例可追溯并识别取代关系。
- [ ] 失败产生相称状态变化和新局面；只有方法/条件/成本/局势实质变化后才重检；拒绝可以结算真实尝试成本，技术故障不冒充世界内拒绝。

**完成条件：**相同工具形状下由模型依据事实选择裁决；无意义动作不掷骰，不可能动作不用虚假高 DC。重大回答继续已冻结行动，重试不多扣资源或增加随机。

### V06 — 独立观察、社交与 NPC 有限知识

round24新增实际反例：Proposal把历史原因/熄火时间推测混入感官证据，Rules按该字段保存为full知识；Narration审核只能看到已冻结Claims，不能代替提交前类别边界。随后已接通独立observe、同分支感知→推断及本人已有知识思考，保留confidence和Viewer隔离；本地Node80/80、Room5/5与typecheck通过，见[实现证据](vnext-observe-validation.md)。真实模型分类与其余V06尚待，不能将类型校验宣称为自然语言蕴含证明；[原诊断](vnext-round24-validation.md)保留。

round25当前模型草稿选了observe并填写分支感知依据的推断，但原JSON缺括号且有额外字段，提交前拒绝；感官文字仍混有解释。实际0事件/知识/Claims，见[真实诊断](vnext-round25-validation.md)。随后已修复来源主张投影复制私有sourceBasis/motive、partial回填全文和分享层级篡改，补单条/batch知识取得Claims，见[来源权限证据](vnext-source-claims-validation.md)。后续已补[NPC独立冻结切片与共享检定接缝](vnext-npc-context-validation.md)及[关系/承诺/债务领域与Claims](vnext-social-commitments-validation.md)；新social回应/广播与真实模型有限知识验证仍待，不从旧实现推定闭合。

**实施差量：复用证据、知识、社交和 Viewer 机制；新增独立 vNext 家族接线，验证真实模型的知识使用。**

依据 SPEC 0001 §§9、12、14。

- [x] 已持有知识的非行动总览/相关回顾，本人完整目录与冻结记录校验、私有 Claims、恢复与无时间/资源/危险/聚光灯副作用；本地矩阵及round22真实总览提交/replay见[知识回顾验收](vnext-knowledge-validation.md)。真实完整旁白及相关选择的连续模型表现仍待核验。
- [ ] 独立 observe 路线区分玩家问题与本次答案；明显证据直接给，角色能力/背景/位置影响额外信息；基础线索不变成单次检定墙。
- [ ] 隐藏真相、感官证据、角色推断、来源主张分别固化和呈现；传闻有来源、时间、动机、知识依据与可交叉验证痕迹。
- [ ] social 能让 NPC 依据自己的知识、目标、顾虑、资源回应；关系、承诺、交易和代价进入权威状态，不把玩家陈述或 NPC 谎言变成真相。即时口头回应/沉默、NPC关系和有条件义务已通过[Form/Room验证](vnext-social-interaction-validation.md)；完整重试、时间/成本、交易和真实模型判断仍待。
- [ ] KP能填补尚未记载但与正史一致的NPC经历，无须旧同内容引用；新经历按通用创作接缝固化，主体记忆与同束回应合法衔接，跨轮/恢复持续。[本地通路与边界](vnext-world-fact-memory-validation.md)已验证；已有年龄/历史冲突识别与隐含秘密借用仍待真实模型行为证据，同调用自检/hash不能当独立语义证明，完整能力保持未完成。
- [ ] NPC 独立 Viewer Context 与主 KP 全知范围分离；角色知识只经合法感知/交流增长，主 KP 知道玩家计划不能让敌人自动反制。

**完成条件：**同场不同角色收到不同合法信息；NPC 无知识与获知之后表现不同；世界内分享可追溯，隐私同时通过投影断言和模型行为审查。

### V07 — 自主世界、虚构时间、任务与故事连续性

2026-09-06：先修复ActorPlan修订后同类trigger撞child root的确定缺陷，共享root派生纳入revision；两个Room反例原UNIQUE失败，修复后直接Room15/15、Faction Rules1/1、战斗纵切1/1通过。尚未接入vNext持久队列/strict模型决策，不标为V07闭合。用户随后优先要求通用提案诊断与窄修订，后续接线按该优先级继续。

2026-09-06只读接缝审查：ActorPlan已有Room.prepare→dueActorPlan决策→commitDueActorPlan→Rules→playerIntent路径，但vNext prepare把NPC限知投影交给只收KP空间投影的context bridge，先返回requiredContextUnavailable；到期后三个playerIntent重建点（普通完成、机械完成、pending继续）也未保存新的requiredContext。下一纵切须在到期子阶段完成的新权威状态上重新冻结并持久化玩家Context，并验证提交子阶段后驱逐不会重跑NPC决定/trace/ActivityCompleted。不得为修复它恢复每次intent先执行NPC计划，否则未分类的knowledgeReview会触发世界行动；应接现有真实原因提交的持久尾阶段。新ActorPlan创作及其strict决策/journal、longSpellcasting仍各有独立缺口，未从只读定位标为实现或Room验收通过。

**实施差量：复用 Activity、ActorPlan、任务/结局与时间规则；重构到期优先编排，新增家族接线并验证模型主动行为。**

2026-09-06 部分定向验收通过：[普通到期持久尾阶段验收](vnext-due-activity-validation.md)。玩家/NPC 普通 due 的同源查询、独立任务历史、原因提交同事务入队、控制移交/驱逐恢复、NPC 内部授权与零受众、逐 Viewer 发布顺序、refusal 读取集及跨 root 骰子恢复投影已通过本地矩阵；最终 Claims38/38、Room+Store25/25、typecheck exit0。ActorPlan/longSpellcasting、stableRecovery、归档未结任务恢复及后台旁白仍待接入；[私有归档合同提案](vnext-recovery-contract-proposal.md)的 SPEC0011 窄修改等待用户确认。以下 V07 项保持未勾选，不把本地纵切作为整个能力或真实模型验收。

依据 SPEC 0001 §§11、13–16、18–19。

- [ ] 标准 KP 循环先处理真实到期/触发的幕后行动，再理解当前意图；NPC/势力能提出新计划、改变计划或有依据推迟，行动留下可观察的因果痕迹。
- [ ] 耗时行为进入 Activity，支持开始、打断、完成和到期效果；现实思考/阅读/离线时间不自动推进虚构时间。
- [ ] 复用已有 Activity 调度，扩展冻结完成效果以支持延迟关系变化和危害触发；核对 vNext 分发是否绕过 `settleDueActivityBeforeInput`，以同一调度保证到期优先。
- [ ] objective-continuity 支持开启、推进、失败、放弃、完成及威胁/承诺/债务/关系/个人目标；跨场景、章节和角色继任保持适用后果。
- [ ] 玩家停滞时依次重新定向、给有依据的机会/预兆、兑现已满足条件的后果；允许原任务彻底失败，保留继续游戏的其他选择。
- [ ] story-continuity 能识别胜利、失败、放弃后的真实收束，包含没有预写结局标签的情况；尾声或明确选择的续篇保留既成后果，不追加黑手撤销胜利。

**完成条件：**在无人干预、玩家制造变化、时间推进和停滞四种场景下世界有因果地运转；承诺、伤势、唯一物、知识和结局经长链与恢复持续。

### V08 — 多人参与、完整战斗与现役功能接入

**实施差量：复用现役多人/战斗/桌面/语音；接入 vNext，针对公开路径验证和修复具体回归，不另造战斗或 UI。**

依据 SPEC 0001 §§8、14–16、19 及 AGENTS 的现役能力基线。

- [ ] 最近决定权、发现与个人时刻进入 KP 上下文；分队在自然决定点切换聚光灯，邀请安静玩家而不替其决定；个人合法行动不经队长许可。
- [ ] 独立 combat 家族接通玩家与动态 NPC 的进入/离开战斗、先攻、回合、移动、动作/附赠动作/反应、法术/资源、专注、状态、0 HP/死亡及合法结束；world-interaction 的 attack check 不等于完整 combat。
- [ ] 逐项验收开房、席位/房主、建卡、线索/日志、职业资源、库存、地点/时钟、组队、个人/整队移动、休整、战斗、逐地点协调、地图、语音和重连。
- [ ] 自由文本、按钮、待决回答和地图意图共用 Room Action；身份仍来自 Cookie 会话，DO 核验活动席位、角色、地点和回合；地图/语音只消费获授权投影。

**完成条件：**至少两名玩家分头→互动/战斗→重组→休整能完整进行；动态敌人与玩家走相同机械，跨地点私密信息和个人选择不被高活跃玩家/队长覆盖。

### V09 — 充分叙述、玩家安全与可审计更正

**实施差量：保留现有 Claims、Grounding、逐 Viewer 重试和更正机制；扩展新结果材料，验证叙述质量与呈现。**

依据 SPEC 0001 §§12、17–18；SPEC 0016 §8。

- [ ] 各能力结果都有足够的 Typed Claims：真实机械、能力效果、具体感知、场景与关系、来源主张/推断、物品/任务/故事、压力与机会。
- [ ] 叙述自然表达实际变化、关键感官细节、角色额外信息与新的可行动局面，然后把决定权交回玩家；NPC 声口可辨认，避免独角戏。
- [x] 按 2026-09-05 批准条款实现叙述承诺持久化、原文/场景/受众绑定、完整相关检索、明确引用时的服务端固化义务、物品/语义对象绑定和 Claims；通过定向 Rules/Room/Viewer/replay 矩阵。此项仅为机制实现。
- [ ] 真实 KP 稳定选择该机制，按原描述固化并完成连续交互；Grounding 保护机械事实、承诺连续性、Viewer grant 和玩家能动性，不替角色决定思想、台词和选择。round4 当前场景观察已真实提交感官证据，旁白仍被拒；尚无“新承诺 → 后续引用固化”的在线连续成功证据。
- [ ] 内容边界、安全暂停和呈现调整生效；裁决解释只用可公开依据。已提交错误明确说明并通过更正审计恢复一致性，未提交错误不留事实。
- [ ] 每 Viewer 的叙述重试复用同一 Receipt、projectionHash、claimsHash 和材料；失败不回滚已提交行动，不重掷、不重复执行。

**完成条件：**输出既准确又足以继续玩；可见后果不因秘密引用被删就一并消失，事实不足则在正确稳定点明确失败，不能用固定空话伪造完成。

### V10 — 上下文、并发、故障与恢复闭环

**实施差量：复用冻结/read-set/journal/归档；重构未接通的参数编排与真实调用预算，验证跨家族恢复和线上故障。**

依据 SPEC 0001 §§9、16–17、19；SPEC 0016 §§4、7–9；SPEC 0011。

- [ ] 按意图、目标、工具、关系、适用先例选择内容，再补齐决定性闭包；相关锚点、定义正文、NPC 知识、物品、连续性、时间和聚光灯都可读取。
- [ ] known / knownAbsent / openBlank / ambiguous / unavailable 五态不混淆；零命中不等于不存在，技术加载失败不能让 KP 猜或假装世界拒绝。
- [ ] 冻结输入与实际事务 read set 分开，相关依赖改变时明确冲突/重新 prepare；相同提交复用快照，不能拼接新旧世界。决定性内容不截断，预算超限有准确原因与安全恢复条件。
- [ ] Provider 配置错误、限流/网络/超时、上下文错误、非法提案、窄修订耗尽、已提交但叙述失败分别呈现和恢复；本轮首提案加最多一次窄修订的计数受持久化约束。
- [ ] 验证重发、断线、DO 驱逐、随机等待、Pending、归档重建、分支更正、Viewer 撤权/ACK 竞态；随机、成本、物化和 Delivery 不重复。
- [ ] 结构化遥测可定位调用阶段、Profile/版本、修复与错误分类，并对照 SPEC 0011 监测延迟/成功率；月度 SLO 由实际生产窗口证明，单次本地探针不替代。

**完成条件：**故障停在已知稳定状态，用户知道能否重试及需要什么条件；技术故障不制造游戏内失败，所有已提交后果可恢复。

### V11 — 完成真正的产品验收

**实施差量：复用既有行为测试与探针；改造真实 vNext 测试入口，新增缺失判断场景，执行有界真实链路并关联日志/Receipt/投影。**

- [ ] 为下表 A–O 逐项建立 vNext 证据：实际输入、关键模型选择、Rules 结果、Receipt、Viewer 输出、后续/恢复断言及适用源码版本。
- [ ] 修正现有登记映射中的不足：D 的 summary correction 不能证明动态敌人机械修复；G 关于新建 hazard wire 的文字须与实际可达性一致。先补行为证据再更新登记，不能只把计数改绿。
- [ ] 补足模型判断的场景与评分依据；当前 B/H 两个 probe 只是起点。区分题面存在、离线 fixture 通过、真实模型调用通过；不要把正确裁决写进 Prompt 后再当判断能力验证。
- [ ] 对 G 的“不得惩罚性追加机关”、M 的自然聚光灯、K 的 NPC 知识使用、O 的真实收束进行行为审查；不写“全世界最多一个机关”之类误限规则。
- [ ] 按 [SPEC 0011 §9](../specs/0011-reliability-correction-observability-and-evaluation.md#9-20-连续交互-kp-评测) 做至少一条 20+ 连续意图/待决回答的 Room Action 评测，使用当前 vNext 同形模型工具调用，覆盖两名以上玩家、分队、秘密、风险、NPC、战斗/Activity、失败、恢复、成长/章节与收束。
- [ ] 延用其评分门：十维各 0–2，总分至少 18/20 且每维至少 1；秘密泄漏、替玩家选择、骰后改判、重复随机/资源、第二权威或假收束直接失败。真实 Provider 与真实桌面/API 冒烟分别验证，不能由受控 fixture 代替。
- [ ] 完成 SPEC 0016 §10 保留的 [SPEC 0015 §13 模型采用门](../specs/0015-private-form-context-rag-and-narration.md#131-数据集与报告口径)：至少 120 条中文金标，报告引用召回、首次/最终合法率、路由、token、延迟、调用次数及故障注入。本次用户已明确将其后置，保持未完成，不冒称通过。

该模型采用报告至少保留以下门槛；旧 `compound.v1` 的复杂案例按新的跨合同 Bundle 对应验证，不恢复已取代的旧 Form。新机制若使旧指标不可直接比较，先形成具体口径差异与裁定，不能静默删门或沿用旧结果。

| 指标 | 采用门 |
| --- | --- |
| 引用召回 | 关键 ref 100%；全部 required ref `Recall@8 ≥ 98%` |
| 首次合法 | 简单案例 ≥97%；复杂案例 ≥95% |
| 最终合法与路由 | 一次窄修订后 ≥99%；可执行路由 ≥99.5%；复杂行动误入简单路径为 0 |
| 输入规模 | 简单 Proposal p95 ≤8k tokens；全体 ≤16k；Narration ≤5k；模型 token 与字节估算分开 |
| 对照 G0 | Proposal token 中位数下降 ≥50%；schema 字节中位数下降 ≥60%，保留可比较的基线口径 |
| 调用与延迟 | Proposal 端到端 p95 ≤20 秒；主 Proposal 平均调用数 ≤1.10/RootAction；正常 Planner/RAG fallback ≤5% |
| 故障注入 | 对适用的 Planner/RAG/Embedding/Vectorize/辅助模型，安全回退 100%，事实、骰面、资源、虚构时间、玩家意图被技术故障改变的次数为 0；未采用的可选模块标为不适用并给依据 |
| 零容忍 | 秘密泄漏、第二权威、模型/客户端骰面、客户端实际目标、任意 patch、重复随机/资源/事件、自动换主 KP、骰后改判、叙述失败回滚均为 0 |

报告给出分子/分母、p50/p95、适当置信区间和重复策略，失败按稳定代码与阶段分类；不足样本或未测指标保持未通过，不以一次线上冒烟填充质量指标。

- [x] 通用 schema 目录与类型依赖闭包、首轮直接提交/一次补取、所选能力校验及持久恢复已接入本地 vNext；普通2/补取3是请求阶段上限，不等于实际重试次数或累计费用上限。
- [ ] 新格式通过有界真实 schema 请求→完整 Proposal→Rules/Room 提交；扩大样本前解决明确失败，主 Proposal 调用均值保留为后置统计指标，token 采用门本次作为优化参考。
- [ ] 持久记录并执行 RootAction 累计 token、费用及 Provider 重试硬限额；当前只有单请求窗口、阶段门、逐调用遥测和外部测试批次预算，不能用 ordinal 行数冒充实际调用总数。

**完成条件：**A–O 对应行为与持续世界均有证据。`tests/spec-0001-acceptance.test.mjs` 当前读取测试源码核对名称，15/15 登记不是这些测试已运行，更不是 vNext 全部产品行为通过。

### V12 — 形成可执行的生产采用与数据方案

**实施差量：旧房退役决策已完成；剩余是范围盘点、vNext 绑定/新数据恢复和执行准备，删除旧房迁移/兼容工作。**

- [ ] 只读清点当前生产绑定、当前 0.4 房间及可恢复归档所引用的 manifest、事件、genesis/checkpoint 和解释器。
- [x] 用户已选择允许退役删除既有 0.4 房间及可恢复归档；不再建设旧房保留、旧 manifest 兼容或旧数据迁入 vNext 的机制。
- [ ] 在切换准备完成后按核验清单执行已授权退役：限制旧房/关联归档/状态范围，隔离账号及 vNext 新数据，验证旧恢复入口不会重新激活已退役房间，并记录实际删除结果。
- [ ] 定义完整生产 vNext manifest、Profile/hash、模型与 parser/schema 绑定，形成生产采用 ADR 和迁移/恢复说明；不把未完成的 stage3 manifest 简单标为生产默认。
- [ ] 在现有宿主优先接通 `worker → /api/game → table/server → room/server → RoomDurableObject`；新房、开团、行动、按钮、observe、ACK 和重试使用一致绑定。
- [ ] 若需要 schema/class/binding 变化，写清 DO namespace 身份、数据责任与迁移顺序；D1 migration 由 schema 生成且只增，并在本地验证写入—读取及归档/随机/Pending 恢复。
- [ ] 准备准确的切换与回退步骤：回退候选须认识需要保留的 vNext 数据；退役删除不承诺恢复旧房。旧 Worker 不认识 vNext 事件/manifest 时，仅回滚代码不能恢复服务。

**完成条件：**发布候选、已授权旧房删除范围、切换次序和新数据恢复方案具体可审查；不再为同一范围的退役重复请求确认。确需新资源或改变未授权的成本/数据责任时，再按实际方案处理。

### V13 — 发布、验证采用并退役旧专用路径

**实施差量：复用发布校验与可用探针；切换新默认、执行已授权旧房退役并删除旧专用实现。实际发布尚未发生。**

- [ ] 本地产品验收、审查和定向修复完成后，按 [发布流程](release.md) 形成源码可定位且与验证/部署一致的冻结候选；本次采用定向证据、审查和必要构建，完整冻结门后置。
- [ ] 在实际操作得到对应授权后串行执行必要的 migration、部署、Secrets 或 push；只使用批准的目标与绑定，保持远端 main/grok.me 边界。清单本身不执行这些操作。
- [ ] 验证新房默认采用完整 vNext；已有房间按 V12 策略处理。控制面流量、代表性真实 API/桌面及生产默认模型分别提供证据。
- [ ] 按已验证的回退策略经过观察并清点依赖，退役旧 V3 专用 Form、Adapter、lowering、Registry 及无消费者测试/文档；同步 README、repo map、规格实施状态和执行日志。
- [ ] 共享实现按实际消费者保留；例如 `narration-v3.ts` 已承载 frozen Claims，不能仅按文件名删除。没有持久化/现役消费者的过时开发路径在替代闭合时及时删除。

**完成条件：**vNext 成为实际生产 KP 路线，所有保留数据都有合法解释与恢复路径，旧 V3 专用依赖清零；分别报告“代码验收通过”“生产部署完成”“真实外部链成功”和仍需持续观察的 SLO。

本次已选择退役旧房，验收以旧恢复依赖和旧 V3 专用链清零为准；不保留没有消费者的兼容/fallback。Push 单独授权，未授权时不把它增加为已授权部署的隐含前置门。

## 十个 Form 家族的交付归属

**旧 V3 的十张窄 Form 不作为 vNext 长期依赖保留。** 下列是 SPEC 0016 的权威/事务家族，数目相同但划分不同；它们保护知识、物品、战斗、连续性等各自不变量，不要求十个独立模型工具或每次发送十份 schema。可以继续使用一个 `submit_kp_proposal_bundle` 入口承载类型化子提案，服务器校验各自职责；普通/高风险继续作为共享裁决。

| 旧 V3 Form | vNext 处置 |
| --- | --- |
| `clarification.v1` / `in-world-refusal.v1` / `observe.v1` | 对应新家族；复用有效基础，删除旧 ID/schema/Adapter 入口 |
| `npc-exchange.v1` | 转到 social，NPC 定义/计划变化按各自生命周期处理 |
| `ordinary-check.v1` / `high-risk-action.v1` | 删除独立动作型 Form，变为各行动家族共用 Ruling |
| `materialization.v1` | 新 materialization 冻结内容，物品取得/使用等交给 inventory-operation |
| `environmental-stunt.v1` | 转到通用 world-interaction，复用 Ability/Geometry 与有限后果 |
| `combat-action.v1` | 新 combat 家族复用既有战斗规则 |
| `compound.v1` | 删除万能 Form 和模型执行图；跨合同需求由类型化提案束及服务器派生计划承载 |

新增清楚的 inventory-operation、objective-continuity、story-continuity 职责，复用已有物品和连续性实现。清理按消费者执行：`narration-v3.ts` 等仍承载新链功能的实现按职责保留或重构，不按名字批量删除。

| Form | 主要待办 | 必须可达的行为 |
| --- | --- | --- |
| clarification | V05、V10 | 重大歧义确认、冻结继续、取消 |
| in-world-refusal | V05 | 真实不可行、缺前提、替代方向与已发生尝试成本 |
| observe | V06 | 具体问题、感知、来源主张/推断、角色额外信息 |
| social | V06、V07 | 有限知识回应、关系、承诺与代价 |
| materialization | V02–V04 | 在证据前创建或修订合法世界内容、固化局部不存在 |
| world-interaction | V02、V04–V05 | 目标/工具/关系、共享裁决、合法机械后果 |
| inventory-operation | V03 | Item 完整权限与生命周期 |
| objective-continuity | V07 | 任务/威胁/承诺的开启、变化、失败、放弃和完成 |
| story-continuity | V07、V09 | 收束判断、结局、尾声和自选续篇 |
| combat | V08 | 玩家/NPC 的完整战斗机械与恢复 |

每个家族都受 V01、V09、V10 的真实接线、Viewer 和恢复完成门约束；以上归属不是彼此隔离的独立实现。

## A–O 最低产品验收矩阵

| 场景 | 必须观察到的结果 | 主要待办 |
| --- | --- | --- |
| A 非预写合理行动 | 接受合理新方法并真实落地，不依赖预写 Interaction | V01、V04–V05 |
| B 当前不可能行动 | 拒绝当前做法并说明真实前提/方向，不伪造高 DC | V05 |
| C 激进风险路径 | 合理的压倒性危险成立；不按等级缩放，依法兑现后果 | V02、V04、V08 |
| D 动态敌人不可执行 | 具体机械诊断→受限修订→重验；高数值本身不拒绝 | V04、V10 |
| E 门后多种可能 | 空房/宝藏/敌人/危险等按因果选择，证据前冻结且之后不重选 | V02–V04 |
| F 感官与假传闻 | 有原因的感知与有来源的主张分开，能够进一步调查 | V06 |
| G 致命危险 | 触发、攻击/豁免、范围、伤害与适用死亡规则兑现，KP 不临时加罚 | V02、V04 |
| H 无意义检定 | 无风险且可行的动作直接成功并推进 | V05 |
| I 有意义失败 | 相称状态改变，原任务可以失败，重复同法不刷骰 | V05、V07 |
| J 玩家停滞 | 先定向/机会/预兆，再兑现有因果的威胁，现实等待不处罚 | V07 |
| K NPC 知识边界 | 未获知计划不反制，合法获知后才可反应 | V06–V08 |
| L 含糊重大意图 | 提交前最小确认，确认后合法执行且不重复阻拦 | V05 |
| M 多人聚光灯 | 自然决定点轮转，秘密隔离，每人控制自己 | V08 |
| N 错误更正 | 解释可公开错误、影响和更正，通过审计恢复一致 | V09–V10 |
| O 故事结束 | 识别并保存真实收束，不用新黑手撤销胜利；玩家可选择续篇 | V07、V09 |

A–O 是最低验收集合，仍需覆盖主文中的长期持续、内容边界、任意合理方法和标准 KP 循环。每次实施记录实际运行的定向检查与退出码；只有验收成立才勾选对应待办。

2026-09-07 最新集成：parser v33 已支持纯 schema 查询幂等复用已加载小表单，未知/重复/混合草稿仍拒绝；round66原稿离线可解析，原真实失败不改判，round67原话复验准备。持续施法Rules/Room 17文件亦已集成，KP调用、完整目录法术及跨入遭遇仍未闭合。主树Node55/55、Room11/11+6/6、typecheck通过，独立只读review无P1/P2阻塞。详见vnext-terminal-selection-validation.md、vnext-sustained-casting-validation.md；完整Goal保持active。

[round67](vnext-round67-validation.md)与66相同NPC话术在首轮失败：直接填decision.kind=social而非先选schema，且无裁决/结果；VALUE_INVALID，不能安全补造或转成查询。1call/¥0.0296154，0事件/状态差量，replay和320源码起止一致，服务已关。随后未发现旧协议或strict降级，阶段竞争描述是线索而非已证明原因，原失败保留。

2026-09-07 当前 [扁平选择 v34](vnext-flat-selection-validation.md) 已按SHA集成16文件，主树Node97/Room50/typecheck exit0。首轮仅选类型、第二轮填所选表单；两轮完整冻结正文一致，普通小表单最多2次、真实执行家族最多3次且只窄修订一次，闲置选择不增加预算。旧 time-passage-room mock 的直接消费者迁移随 Ability 集成继续，不扩大成全量回归。

最新 [round68](vnext-round68-validation.md) 同原NPC话术：首轮social+passTime选择通过，第二轮在response内出现JSON_SYNTAX，offset1210；2calls/¥0.0642114，0事件和状态差量、replay与320源码起止一致，服务已关。独立标点诊断副本仍有不存在的知识producer及不可引用的NPC目录包装项；原schema已有playerExpression，不是缺少对话来源类型。原响应不改，不补生产者、不重采。完整填表稳定性仍未解决，下一步简化已有来源的选择与服务端类型推导；普通行动65及局部选择成功不外推复杂提案。持续施法KP/native操作独立闭合中，真实目录空效果假成功已复现并在隔离修复，尚待集成与真实API。

2026-09-07 [已注册能力入口 v35](vnext-native-ability-validation.md) 已集成28文件、0冲突，主树Node89/原子消费者2/Worker60/typecheck exit0。正常建卡与后续角色加入共用注册编译；非战斗turn、部分效果假成功和单步随机续接残留直接修复。真实目录长施法仍未证明；三张整卡因更正快照膨胀发生SQLITE_TOOBIG，已独立保留复现并继续诊断。round69正常新房固定连续施法待真实API，不将本地通过算稳定性或完整Goal完成。

2026-09-07 [NPC 来源选择 v36](vnext-social-source-validation.md) 已集成13文件、0冲突，主树Node138/Room55/typecheck均exit0。KP从冻结的本人来源目录选完整ref，服务器复用原本人解析器推导类型/holder；当前玩家发言用playerExpression，新来源须显式同束always worldFact及本人initialKnowledge。缺失/畸形来源与派生消费错误共用真实wire路径诊断，私有正文不进入候选；缺来源/producer及改NPC/来源不能借窄修订补造。正常模组NPC说谎的本地Room证明台词归属、真相/认知不变及驱逐重复请求幂等；这不是新一轮真实模型通过。round68原始失败保留，尚无来源选择或修复成功率改善证据。更正审计膨胀及完整Goal仍待，无部署/push/退役。

2026-09-07 [round69](vnext-round69-validation.md) 正常注册/锁卡后的 startGame 初始化被拒绝，尚无真实模型调用（0 calls/¥0），三句施法全部未发送。房间停在大厅、无已初始化权威房间；源码321项起止一致，服务已关。具体初始化原因继续离线还原，不算提案格式失败或通过；source v36真实模型改善仍未证明。

2026-09-07 [UUID 骰式误判修复](vnext-ability-identity-validation.md) 定向通过：原初始化输入中的能力ID被 validateDice 全字符串扫描误当超限骰式，现仅递归扫描 formula，恢复 SPEC0013 文字/机械边界，原上限/diagnostics/Profile/hash算法保持。主树Node22/Room5、私有原输入四组合4/4、diff-check exit0；无类型/DTO修改故未重跑typecheck。opaque ID/ref/prose通过，深层resolution、healing、temporaryHitPoints的1001骰及terms超限仍拒绝。原round69初始化失败不改判，汇总错误传播链仍待，不能称全链诊断或模型稳定性已解决。round71已正常注册/锁卡/开始且初态自动校验通过，施法结果另记；321源码冻结，无部署/push/commit。

2026-09-07 [round71](vnext-round71-validation.md) 正常Cookie建卡/开房恢复；首cure真实选择+填写两次通过，连同旁白/审核共4calls，¥0.1755528，无窄修订。第3事件ResourceSpent把combat ID写成新的core别名，core/public slot1仍4而combat为3，按mechanicalMismatch停批，后两句未发；9事件在本批原冻结源码下replay精确、321源码一致、服务已关。原模型填表局部成功不代表状态或整体稳定性；资源映射修复中，round70/72保持held。

2026-09-07 [资源同步修复](vnext-resource-pool-validation.md) 主树3生产+2测试完成，Node19/Room5/typecheck通过，独立审查无本次delta阻断。正常/反应施法与fold同源验证并更新唯一原池，同pool多成本、职业资源及core/public/长休max均有定向证据；原round71失败不改。round72真实复验已开始，不能预判结果。

2026-09-07 [round72](vnext-round72-validation.md) 保持原三句真实复验：第一句完整 committed/published，core/public/combat 一环槽4→3、max4一致；原 submission 重复0新调用且 state/events/randomness/Receipt/delivery 均不变，ACK通过。第二句真实选择正确，但填写多带与冻结原意相同的 decision.intent，当前以 VALUE_INVALID/terminal.intent 提前拒绝且未进入窄修订；按 formatFailure 停批，第三句未发，第二步无新事件/骰/资源。共6calls，101506输入/885输出，分缓存峰价¥0.2890974；9事件replay精确、321源码起止一致、服务已关。原失败保留，不能称三步或整体稳定通过；正在原validator/repair中补严格等义的服务器字段删除证明与wire路径映射。round70在初始化及资源修复、准备包SHA核对后独立执行原NPC话术，首句引用不可引用目录被拒，已停批收尾；其独立回执另记。

2026-09-07 [round70](vnext-round70-validation.md) 正常Cookie开房及初态通过；原NPC首句选择social/passTime，response.basis使用当前正确来源，但step.basisRefs混入已加载却明确nonCitable的NPC目录包装项，PROPOSAL_REFERENCE_INVALID在Rules前拒绝，无窄修订、0事件/计划/Activity/资源/时间变化。固定后两句未发，原submission重复0新调用且全部状态一致；2calls/44025输入/548输出、峰价¥0.1299542，capture与journal逐项相等，replay精确、321源码一致、服务已关。原稿不删引用或补计划，未发布台词不计叙事成功或矛盾。只读定位现有basis填写仍是开放string，校验器已有授权与read-bound双条件；下一步让候选与原判断共用同一事实源。完整NPC计划/等待/续谈及统计稳定性仍未通过。

2026-09-07 [冻结输入回填修订](vnext-frozen-intent-repair-validation.md) 已完成6生产+2测试：原validator诊断驱动、精确匹配服务器冻结三字段、完整提案证明后固定remove，模型只确认；Provider/Room重证原稿和同一冻结context，诊断/范围回到decision.intent。parser v37/ticket vnext5，原八处/一次修订/调用预算保持；错值、多字段、缺目标/DC/后果及非明确JSON继续拒绝。Node36、Room6和最终恢复目标1、typecheck/diff-check通过，独立review无阻断；root用round72原真实响应+原Room context离线生成唯一remove票据，0 API、0提交，原失败不改判。round73正常HTTP原三句真实复验正在执行，真实修订和连续稳定性结果另记，不能以本地通过代替。
