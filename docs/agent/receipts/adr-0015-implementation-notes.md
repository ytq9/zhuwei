# ADR 0015 的实现记录（2026-09-02 至 2026-09-09）

这些条目原本追加在 [ADR 0015](../../adr/0015-coarse-forms-frozen-context-and-typed-claims.md) 的正文里。
它们记录的是按该决定实施时做了什么、用哪个 parser/context 版本、供应商约束怎么处理，属于回执而不是裁定。
ADR 记录一次决定，决定之后的实施过程记在这里。

- 2026-09-07 真实供应商约束修正：round59 的冻结审核请求收到 HTTP400 “An object with no properties is not allowed.”。review v11/policy v9 由同一冻结 mechanicalResults 决定 schema、Prompt 与解码形状：零组不生成 resultChecks 字段，非零组仍全部必填。单一 vendor validator 提前拒绝空 properties，绑定保留准确私有 cause；Provider 拒绝请求不能推断正文无效，Room/Table 使用 NARRATION_PROVIDER_REJECTED。不增加占位表、审核或恢复重试。见[实施回执](./vnext-narration-schema-provider-validation.md)。

- 2026-09-02 已完成动态 NPC 修订与通用 `world-interaction` 的隔离纵切，并以烧绳、试压板和 opaque-ID 行为测试证明样例不是生产分派键；具体回执见 `SPEC 0016` §14。该回执不等于完整 Form 家族已经全部纵切，也不等于生产切换或发布完成。

- 2026-09-07 NPC定时计划形成：`formActorPlan`平铺填写NPC、本人已有依据、目标/下一步、时长及未来痕迹；服务器派生身份/trigger/Activity与冻结依赖，单步骤也沿原atomic。形成只保存私有意图，未来痕迹由到期实际execute后提交；不预扣资源、不推进时间。self/identity支持空Knowledge；同束新社会依据和未知future trigger仍拒绝。原始数字表示修订共用一次固定确认，Room从同一原稿来源重证。

- 2026-09-07 观察引用填写：当前Viewer可见主体作为不可扩展的上下文义务读取，公开主体目录从其冻结实体/物理记录派生，不附加旁观NPC私有决策闭包。模型focusRefs与sensoryEvidence.subjectRef只从该目录或本束prospective主体选择，已有知识及Profile仍是依据；Provider和Room按同一冻结上下文重建schema。Rules继续是唯一目标/可见性/依赖验证权威。目标错误携带原draft字段位置与授权候选，禁止借修订换目标；普通创作继续检查具体冲突，不要求旧同内容引用。

- 2026-09-07 事实依据闭包：`worldFactConstraints`只计算一次，其已展示的typed `facts`记录沿原index/reread/hash/citation分类独立冻结为不可扩展的`sourceRecord`义务。Profile hash不替代动态事实版本，不扫描叙事字符串或尚未发生的未来trace ID，不因事实主体展开NPC私有决策。依据校验在原授权/read-binding predicate失败点生成诊断；服务器聚合字段仅在能追溯真实来源槽时回映原稿路径，不造位置、不开放换依据或补hash修订。

- 2026-09-07 parser v33 的纯选择从实际 schema 派生已加载小表单标识，幂等复用已有填写面，不增加查询或修订次数；[验证](./vnext-terminal-selection-validation.md)。持续施法另补共享 Ability 编译、同源 due 分段与原施法者 Receipt/答复者权限分离，仍有 KP 及目录执行器缺口；[范围与证据](./vnext-sustained-casting-validation.md)。

- 2026-09-07 已注册能力使用 native abilityOperation 填写面：仅选本人能力、目标/模式或本人施法 Activity，固定费用、骰子和效果来自原注册定义与 Rules；无重新裁决字段。它经现有 atomic native driver 和完整 clarification 冻结继续，遵守 SPEC 0016 §7.2 的执行家族调用额度及一次窄修订。正常角色初始化共用原能力注册编译事实源；详见[实现回执](./vnext-native-ability-validation.md)。

- 2026-09-07 NPC 来源填写替代为 parser v36/context v4/guidance v7：已有来源从冻结 `references.npcSourceChoices` 中按回应 NPC 选 exact ref，当前玩家发言填 playerExpression；新来源仅填 worldFactRef，并须已有显式同束 always worldFact producer 及本人 initialKnowledge。服务器从 step.npcRef 推导类型/holder，复用原 npcDecisionContext/npcDecisionEvidenceRef 和 lowerer/Rules 核验，不新增候选读取或语义规则。schema 的已加载并集不扩大回应者的知识权限，expected 只列其获授权引用且无私有正文。旧对象 wire 无 fallback，codec 不接受不匹配 holder。

- 2026-09-07 parser v37/ticket vnext5 补齐固定输入回填的删除证明：仅原校验器确认决策层 intent 为额外字段、codec 证明对应模型原位置、且其 actorRef/submissionRef/text 与服务器冻结输入精确相等时，原修订计划可包含固定 remove；完整提案重验与原调用预算保持。模型只确认，不提供删除操作；错值、额外语义或缺失裁决不能清洗。Provider 和 Room 使用同一冻结 context 重证原稿、票据及范围；详见[实施证据](./vnext-frozen-intent-repair-validation.md)。

- 来源诊断共用映射回真实填写路径，Provider、private lowering、修订票据和 Room 从同一冻结上下文核对；两轮 user 正文保持逐字一致。仅允许已有票据证明等义的修订，不换 NPC/来源/目标/DC/成本/后果，不补缺 producer；原稿、调用预算及完整重验保持。NPC 可以说谎或转述误信，新创作无需旧同内容引用，台词不自动改写正史或本人认知。主树定向 Node138/Room55/typecheck 通过，只证明这些确定性边界；round68 原失败与真实模型改善证据缺口保留，详见[来源选择回执](./vnext-social-source-validation.md)。

- 2026-09-08 承诺生命周期第二步：social 分别记录原承诺、私有初始条款/期限及可选 NPC 下一步，不再以承诺期限生成假工期和未来痕迹。NPC 限知决定复用同一 ProposalBundle、物化/库存与真实 Activity；主持复核读取独立冻结证据，通过私有 Rules 输入产生裁定及隐藏结果 fact。持续义务没有虚构 Activity，期间否定依据须先由原 worldFact 路径固化。Room 扩展原队列的工作类别并保存全部已有待办/重试状态，沿原调用日志恢复；Rules 仍通过 step/project/replay 独占机械与投影，Room 仍是唯一正史写入者。生命周期结果按真实 Knowledge 投影，完整重复返回从既存因果工作与发布日志重建。

- 以上为 2026-09-08 第二步 A/B/C/D 的历史范围。2026-09-09 后续实现补入版本化改约、条件/尝试/部分义务、合并复核、按 Knowledge 取得的已知版本、通知/战斗边界与章节/继任/更正连续性。NPC 行动承诺无具体做法时也安排本人决定；选择、唯一表单填写及已保存空响应的一次补发分别入原 journal，预算耗尽的未发阶段可续办，未知响应不重发。没有新增系统级服务、D1 活跃事实表或远端资源；[当前回执](./vnext-promise-lifecycle-validation.md)记录本地代表性证据与全部失败批次。真实模型台词承诺遗漏仍未解决，[提交前一致性检查](../proposals/vnext-promise-spoken-consistency-decision.md)涉及新增调用，待用户确认，尚未纳入现役实现或改变已批准规格。
