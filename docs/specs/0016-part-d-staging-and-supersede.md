---
kind: part
part_of: "0016"
title: "SPEC 0016 分册：分阶段实施、纵切验收与窄 supersede"
clauses: "9-13"
---
# SPEC 0016 分册：分阶段实施、纵切验收与窄 supersede

本文件是 [SPEC 0016](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) 的 §9–§13，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 9. 权限、版本与失败边界

1. Principal、actor、ViewerKey、Audience、实际区域目标、scope proof、Profile/hash、Receipt 和 Claim freeze metadata 均由服务端派生。
2. 主 KP 可取得本次相关 KP-only 事实，但 NPC 行动只能依据单独的 NPC Viewer Context；Narration 只能取得目标 Viewer 的 Claims 及上节获授权的冻结表达上下文。
3. 所有新 Form、RequiredContext、Sparse Semantic Definition、Relation、ProposalBundle、Rules primitive 和 Claim vocabulary 都必须进入新的完整 runtime manifest；未知或错 hash fail closed。
4. 当前 V5 ID/hash 不原地改义。阶段一至三期间，新 Profile 不进入生产默认 Registry，不删除 V5，不建立静默 Adapter、fallback、双写或 migration。
5. 上下文不足、定义 base/hash 冲突、引用越权、依赖无法导出、Rules 诊断或 Claims 不充分都必须显式停在相应稳定点；不能用世界内拒绝、固定旁白或自动换模型掩盖技术/合同失败。
6. 已提交行动不能因 Claims/Narration 故障回滚；未提交的非法 Proposal 不能留下部分事实、随机或成本。
7. `structuredOutputMode: strict-tool` 只有在实际 Adapter 使用登记的严格端点/参数、工具声明启用 strict、候选 schema 通过该 Provider dialect 验证，且 live evidence 绑定 provider、model/revision、endpoint protocol、prompt/schema/parser/validation suite hash 时才成立；Room 或 Registry 元数据不得自行声称真实约束解码。
8. Provider 在生成前拒绝 schema 属于配置/协议永久错误；网络、限流和超时属于 Provider 故障并保持 `notCommitted`；只有 Provider 已返回合法工具调用而本地引用、语义或 Rules 诊断可修时，才进入 §7.2 的一次窄修复。strict output 永不替代本地权限、引用、跨字段、lowering 和 Rules 验证。

## 10. 分阶段实施与停止条件

### 阶段一：无行为变化地提取接缝并拆分大文件

先按变化原因把当前大文件中的独立 Implementation 提取为可单测 Module，同时保持 V5 生产行为、公开 Interface、Profile/hash 和测试结果不变。优先提取：

- RequiredContext 的 actor/scene/NPC/item/continuity/precedent 收集器；
- 稀疏定义与关系的纯合成/规范化 helper；
- Rules projector 中的 Typed Claims builder；
- vNext Narration 的冻结 Claims 消费器；
- Room prepare/commit 中只负责快照绑定和持久化的 orchestration helper。

阶段一不得借“拆文件”修改 V5 Form 含义、注册新生产 Profile、移动状态权威或改变投影可见性。完成门是拆分前后同一 V5 定向行为等价、模块依赖仍服从 `step/project/replay`，且没有新生产接线。

### 阶段二：实现新合同的纯 Interface 与 conformance

在未切生产的 vNext Profile 下实现：粗粒度 Catalog、RequiredContext `epistemic/readSet`、稀疏定义合成、有限关系、服务器私有 ProposalBundle、Rules 有限原语和 Typed Claims。测试从各自公开 seam 验证 closed schema、hash、权限、隐藏关系整项裁剪、read-set 冲突、定义版本合成、replay 与冻结重试。

阶段二不要求真实 Provider 或浏览器，也不得以直接构造最终状态/Claim 替代 `step/project/replay` 的行为证据。

### 阶段三：两条真实纵切

阶段三只包含 §11 的两条端到端纵切。它们都必须从真实自然语言或现役内部 NPC 入口，经 Room prepare、真实 RequiredContext、KP Proposal validator、服务器 bundle、Rules `step`、Room DO commit、`project(viewer, committedRange)`、Typed Claims 和 Narration seam，并证明 replay、幂等与秘密边界。

阶段三完成也不自动授权切换生产、删除 V5、部署、远端 migration 或 Git push。是否采用新 Profile、如何处理当时房间和是否删除原型/V5 路径必须另行裁定。

### 阶段三收口：Availability、Bundle 与真实 Provider 门

§14 的既有回执继续证明动态 NPC 修订与单合同 `world-interaction` 代表性纵切，不被改写为失败；但它不证明五态运行时、跨合同 ProposalBundle、prospective ref、完整 materialization create 或真实 Provider。继续扩展完整 Form 家族前必须完成以下收口：

1. 先冻结本修订的权威合同与模型填写面，再建立一个可丢弃的最小 `submit_kp_proposal_bundle` strict schema；
2. 用该候选 schema 做真实 Provider dialect handshake，至少覆盖单 `worldInteraction`、`materializeObject + worldInteraction` 和一个应被 Provider 在生成前拒绝的非法 schema；
3. 探针通过后才冻结 transport/schema 并实现其完整 consumer；不能先完成大规模 Bundle lowering 再发现真实 Provider 不支持该 schema，也不能在没有候选 schema 时空测 Provider；
4. 五态 Availability、候选 Bundle 协议、本地 validator/repair 与脱敏遥测可以在文件所有权不重叠时并行；真实 Provider 探针依赖候选 schema；Room/Rules 集成依赖 schema 与 Availability Interface 稳定；
5. 最终新增一条 `materialization + world-interaction` 跨合同纵切，证明同束创建并消费新对象、所有分支随机前预检、原子提交、逐 Viewer Claims、幂等与 replay。

schema 选择与补选按 §7.2 验证：知识回顾、主动等待、库存操作、场景交互和独立观察均先选类型再填写；无 steps 的澄清也不能绕过首轮准入；Item 创作召回后闭合 Ability 依赖并在同一原子 Bundle 物化、使用，Hazard 创作覆盖另一依赖结构。必须覆盖无需补选直接提交、缺少类型时一次并集补选、补选后只准提交、无新增类型或再次补选拒绝；操作与终结表单均须验证提示词和实际工具权限一致。选择或补选响应保存后恢复，须拒绝使用旧类型集合、错误阶段提示词或再次提供选择工具的请求，冻结上下文保持不变。最终 Proposal 恢复、唯一窄 correction、429 与预算阻断继续保留精确请求、阶段及实际次数证据。未加载类型、未知能力和混合草稿在任何副作用前拒绝，本地校验不能因领域 parser 更宽而接受未加载类型。真实 Provider 分别验证首轮纯选择、填写轮提交或补选、补选后最终提交；schema 字节、真实 tokens、调用与端到端延迟分别报告，不以本地提示词与协议检查代替真实模型验收。

修订验收同时覆盖必填检定属性为空/缺失、结果表缺失和 Rules 预检错误。具体诊断与唯一填写草稿进入修订请求，KP 可通过补丁补属性并修改首稿 DC，也可完整替换；增删步骤须配套调整结果序号，遗漏对应关系拒绝；无法解析的原稿只准完整替换。补丁原子性、源版本绑定、越权路径和重复草稿均须验收；修订通过后仍由玩家掷骰。再次非法、篡改诊断、伪造拒绝、越权引用或调用额度耗尽均无新增随机、资源或部分事件。保存修订响应后驱逐恢复与重复提交复用同一方案，已进入确认/随机/执行的方案不能重新取得修订资格。

阶段三收口的模型工具顶层不得包含 rootAction、actor、context/profile hash、权威 proposal/receipt/event ID、骰面、最终伤害或实际隐藏 targets。每层 object 必须 closed；Provider dialect 不支持的字符串、数组和 Bundle 大小限制仍由本地 validator 执行。真实探针只证明 transport 可行，不证明 KP 判断质量；正式采用仍服从 `SPEC 0015` 的金标、首次合法率、调用、延迟与安全门。

## 11. 阶段三的两条真实纵切验收

### 11.1 已有动态 NPC 的稀疏语义修订

前提：权威状态中已经存在一个动态 NPC，绑定不可变 definition revision、template ref/hash、有限知识、当前物品/能力和 Viewer 可见性。

行动：NPC 因新的已固化事实需要修订其动态定义。KP 只能基于本次 NPC/KP 获授权上下文提出允许字段的稀疏修订与引用；服务器以 exact base/template 合成完整下一版本，Rules 验证并原子提交。

必须证明：

1. 不把部分 patch、Prompt 文本或 NPC sidecar 保存为第二定义；旧 revision 仍可 replay，新实体状态只指向已提交 next revision。
2. 若修订引用能力或物品，其 definition/instance 已在 read set，Rules 验证机械与生命周期；自然语言不能直接变成任意机械。
3. NPC 未获知的玩家秘密不能作为修订或计划依据；隐藏 definition 字段和 relation 不进入无权 Viewer Claims。
4. 有权 Viewer 收到具体的可见 NPC 变化或行动后果 Claim，而不是只有 `actionCommitted`；Narration 重试复用同一 claimsHash。
5. base/template hash 过期、未知字段、越权 ref 或并发修订全部 fail closed，且不留下新 revision、随机、Receipt 成功态或旁白。

### 11.2 自然语言“用枪打吊灯”

前提：角色持有可用枪械和弹药；场景有吊灯、支撑对象及 `supports/attachedTo` 关系，相关对象只有简单材料描述、可见状态和必要 Geometry；场景中可以存在公开或隐藏实体。

行动：“我用枪打断吊灯的支撑，让它砸向下面的敌人。”

必须证明：

1. 只选择 `world-interaction` 粗粒度合同；不会因“枪”“吊灯”“锁链”等名称分派专项 Form、archetype 或硬编码结果。
2. RequiredContext 同时含角色枪械 Ability/资源、相关场景对象、简单材料描述、关系、Geometry、适用先例和连续性 read set；无权 Viewer 看不到隐藏实体或隐藏关系。
3. KP 判断可行性并在骰前冻结攻击/检定、DC 或目标规则、风险及成功/失败语义；Rules 验证枪械、距离、行动经济、弹药和有限原语，Room DO 提供唯一骰面并选择实际分支。
4. 成功分支可以结束支撑关系、改变对象状态并在已有 Geometry/Hazard 原语支持时结算坠落区域、伤害、状态、死亡和残骸；失败分支至少诚实结算已冻结的行动/弹药成本且不伪造断裂。模型不填写最终骰面、伤害或实际隐藏 targets。
5. 所有后果属于一个 RootAction/Receipt；幂等重试、驱逐恢复和 replay 不重复弹药、随机、对象、事件或 Delivery。
6. 每个 Viewer 的 Claims 具体覆盖其可见的射击、资源变化、支撑/吊灯变化、实际伤害、场景细节、压力与机会；隐藏目标可被 Rules 影响，但不因 Claim 数量、basis、错误或 Narration 泄漏。

同一测试组还必须包含一个非名称特判样例：“烧断绳索使重物坠落”，证明它复用相同 `world-interaction + relation transition + finite Rules primitive` 路径；以及一个边界样例：“扔石头试陷阱”，证明玩家的问题、石头/压板语义、隐藏触发关系和本次取得的具体感官证据被正确区分。后二者是通用性/边界检查，不是第三条完整纵切。

## 12. 对 SPEC 0015 的窄 supersede 与 Interface 深化

本规格不整篇替代 `SPEC 0015`。其静态 RAG 权威重读、body-only Narration、action/narration 双状态、逐受众发布、Model Profile、日志白名单、D1 派生索引和 V5 历史发布事实继续有效。首份 Proposal + 最多一次修订仍有界，修订范围与最终执行方案的冻结时点按 2026-09-09 用户决定由 §7.2 取代。2026-09-06 的纯 schema 选择例外及 2026-09-07 用户批准、2026-09-09 重申的一次补选，统一服从 §7.2 的阶段、恢复与实际调用额度；补选不形成裁决。旧 Catalog、compound/DAG 与详细环境模型仍按原范围窄取代；RequiredContext 与 Claims 行是对既有原则的深化，不否定其原约束。全部处理只适用于未来绑定本规格完整 Profile 的房间：

| 处理 | SPEC 0015 原条款 | 原合同的目标/缺口 | 本规格裁定 | 仍保留内容 |
| --- | --- | --- | --- | --- |
| **窄取代** | §2 步骤 3、5–8；§3.1–3.2.1 | 每次筛 3–6 张、从十张窄 Form 选一张；`ordinary-check/high-risk/environmental-stunt/compound` 作为动作类别或逃生舱 | §3 的粗粒度 Form 家族；五类 Ruling 为共享字段；一个 RootAction 可有多项类型化子提案，但没有模型可见 compound | 玩家只说自然语言、Form 私有且 closed、authority 字段服务端派生 |
| **窄取代** | §6.2 的 compound 升级；§6.3 `CausalActionProgram` 复合拓扑 | 模型通过 compound stages/conditions 表达复合依赖 | §7 的服务器私有 ProposalBundle；依赖从 produces/consumes、生命周期和 outcome binding 确定性导出，模型不填 DAG | 一次首 Proposal + 最多一次窄修订、语义冻结、整束预检、单 RootAction/Receipt |
| **用户批准的窄修订** | §6.1 的总调用两次上限 | 完整 schema 每次发送；无纯选择或补选阶段 | §7.2：先选择，填写时可按并集补选一次，补选后只准提交；由保存响应证明阶段 | 调用额度及 HTTP 预算见 §7.2；仅一份 Proposal 与一次窄修订；选择与补选无裁决、草稿或副作用；同请求恢复、技术失败不变成世界内拒绝 |
| **用户批准的取代** | §6.1 的首稿语义冻结与窄修订范围 | 缺失机械字段因无法证明等价补值而不能修复 | §7.2：具体诊断驱动一次差量或完整修订，最终方案在玩家确认、随机或执行前冻结 | 玩家意图、授权上下文、既成事实、完整重验、调用预算与 Room 权威不变 |
| **深化** | §4.1 RequiredContext 最小权威切片 | 已要求包含相关 mechanics、动态定义、continuity 与先例，但未把认知权限和事务读取显式分开 | §4 的 `epistemicRefs/readSetRefs`、冻结元数据和最小充分正文 | Planner/RAG 不可删除 Required、Context 不等于完整 WorldState |
| **用户批准的独立例外** | §6.1 普通 Proposal 限额的适用范围 | 完整故事草稿与独立评审不能作为机械窄修订 | 2026-09-09 批准 §7.2 的版本化故事作业：通常两次，最多四次实际调用 | 普通行动调用额度与最终执行方案冻结边界不变；全部关联来源总预算；已存复用、未知不重采样；正常 Rules/Room/Viewer 接入 |
| **窄取代** | §11 与 §19.11–12 | `environmental-stunt`、详细材质/尺寸/高度、对象 AC/耐久/阈值、有限状态图及统一 `state-only/area-hazard` 模式作为开放环境的主要表达 | §5–7 的简单 `materialDescription`、少量类型化关系、KP 可行性判断和有限 Rules 原语；真实 Hazard/Area 只在游戏后果确实需要且已有原语时使用 | 不按对象名/archetype 派发；实际区域目标仍只由 Rules/Geometry 计算；不按队伍等级削弱危险 |
| **深化及用户批准的窄修订** | §7 的 `renderableClaims` 输入约定 | 已要求 Narration 只依据冻结 claims，但 Claim vocabulary 与唯一生成 seam 尚未充分固定；旧限制不允许尚未机械固化的环境创作 | §8 固定 `project(viewer, committedRange) → FrozenRenderableClaims` 交接；2026-09-05 随 SPEC 0001 批准非机械环境叙述承诺，发布前持久保存，玩家引用或产生因果影响前再固化 | 机械结果唯一权威、body-only、Grounding、Audience、连续性和 Narration 失败不回滚行动 |

本 supersede 只决定未来 Profile 的目标，不原地重解释当前 V5 房间，也不把 `feature/kp-form-graph-v6` 注册为新默认。出现本表之外的解释差异时，优先保持 `SPEC 0001`、单一 Room/Rules/DO 权威、秘密安全与冻结版本语义。

## 13. 固定不变量与非目标

1. Form 数量不随玩家动作组合、对象名称或样例数量增长；新增 Form 只因出现新的权威或事务生命周期边界。
2. 稀疏语义不是自由标签堆，也不是通用物理引擎；简单材料描述与少量关系只提供 KP 可追溯判断所需语义。
3. KP 拥有可行性、DC、风险和世界因果判断；Rules 拥有机械合法性、随机、数值执行和类型化提交。
4. ProposalBundle、InteractionPlan、definition synthesis 和 Claim builder 都不拥有状态、权限、随机或独立投影。
5. 所有进入因果链的新事实、定义、关系和连续性变化都经同一 `step`、Room commit、`project/replay`。
6. Typed Claims 是纯派生投影，不是第二正史；Narration 文本不能直接改写世界。非机械环境叙述的原始承诺由 Room 持久保存并约束后续创作，其物化与后果仍经同一权威链。
7. Hidden authority refs 永不进入 Viewer Claims；无权关系 Claim 整体丢弃，不能靠删 ref 掩盖泄漏 payload。
8. 当前任务不切生产、不删 V5、不迁移房间、不部署、不创建 Cloudflare 资源，也不授权 Git push。

## 14. 阶段三开发期实现回执（2026-09-02）

本节为非规范附录，已移至 [SPEC 0016 附录](./0016-appendix-stage-three-receipt.md#14)。
