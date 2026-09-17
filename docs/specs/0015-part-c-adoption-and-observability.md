---
kind: part
part_of: "0015"
title: "SPEC 0015 分册：采用门、动态环境与可观测性"
clauses: "10-13"
---
# SPEC 0015 分册：采用门、动态环境与可观测性

本文件是 [SPEC 0015](./0015-private-form-context-rag-and-narration.md) 的 §10–§13，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 10. G0–G5 实验与采用门

实验组固定为：

| 组 | 配置 | 产品资格 |
| --- | --- | --- |
| G0 | 当前超级 Schema + 完整上下文 | 改造前基线，只用于同集比较 |
| G1 | 小表 + 当前完整上下文 | 分离 Form 收益，不是默认候选 |
| G2 | 小表 + 三层 Context Pack + D1 FTS | 本轮采用配置；仍须通过发布硬门 |
| G3 | G2 + 可选 Context Planner | 只有量化增益达门才采用 |
| G4 | G3 + 本地精确 Embedding/Vectorize 对照 | 只做本地对照；无另行授权不创建远端 Vectorize |
| G5 | 仅当召回足够但排序明显失败时，加辅助模型 rerank | 条件实验；达门才采用 |

所有组使用同一 120 条金标、相同语料/Profile、相同主 KP Profile、预注册随机种子/重复策略和统一评分器。先记录 G0 的 Schema 字节、输入/输出 token、调用数、延迟、首次合法率和失败分类，再实现/选择候选。

G2 只在 §13 全部硬门通过后发布。G3/G4/G5 还必须相对当前已采用前驱，在同一数据集至少满足一个预注册增益：关键/全部引用召回或首次合法率的**配对差值** 95% 置信区间下界为正，或 Proposal 输入 token/端到端 p95 至少下降 10%；同时安全零容忍项不变、最终合法率/可执行路由不退化、平均调用数与回退率仍达门。G5 还要求基线已达到召回门且能证明主要误差来自排序。

未达门的 Planner/Embedding/Vectorize/rerank 产品接线必须删除；只保留可复现实验记录、Disabled/确定性测试 Adapter 和诚实结论。不得为“使用 AI/RAG”保留无价值复杂度。

### 10.1 本轮采用结论与证据边界

同一 120 条中文金标的离线结构报告通过全部 16 项结构硬门，故采用 G2 作为当前产品配置：关键引用 240/240、全部 required refs 360/360；简单 Form 首次合法 86/88、compound 首次合法 31/32；一次窄修订后最终合法 120/120、可执行路由 120/120、32 个复杂案例误入简单 Form 为 0。相对 G0，Form Schema 字节中位数下降 60.07%，Proposal 输入估算中位数下降 77.22%；G2 输入估算 p50/p95 为 4918/5812。该 token 口径是 UTF-8 请求字节除以四，不是 Provider tokenizer 计数。

G2 通过生产 D1 Adapter 合同在隔离 `node:sqlite` FTS5 中写入 13/13 条 public projection、执行 120/120 次 SQL `MATCH` 并完成 174 次非空权威原文重读；D1 中 KP-only 行与正文 body 都是 0。G3 与 G4 相对 G2 的 required recall、critical recall 和首次合法率三项配对差值均为 0/120，95% CI 均为 `[0, 0]`，且输入中位数和 p95 都变差，故两组 `passed=false`、`adopted=false`。G3 没有真实模型角色验证，明确为 `unvalidated`、不可泛化并在生产禁用。G4 只在评测器中使用 Unicode-scalar TF-IDF `Float64Array` 和 brute-force exact cosine，120 次搜索/1920 次比较中有 56 个案例发生真实重排，但没有质量增益，也不接入生产。G2 的 MRR 为 1，故 G5 的“召回足够但排序明显失败”前提不成立，`applicable=false`。Planner/RAG/Embedding/Vector/rerank 五类故障注入为 5/5 安全回退且冻结语义不变。

以上离线结果只证明结构实现和采用选择，本身不是线上模型或发布证据。2026-08-29 用户后续明确取消本代理的完整线上测评并自行执行；因此本次发布只允许一次精确三交互生产冒烟，且不得把它写成 31 轮质量评测或用它填充 Provider tokenizer、Proposal 端到端 p95、平均调用数、正常 fallback、真实首次合法率与配对重复等完整线上指标。这些指标在本次代理回执中继续保持“未测/由用户后续测评”。§§14–15 的远端 migration、部署、浏览器与唯一三交互已按下文回填实际结果；完整冻结门由用户明确豁免，未在最终源码上重跑且不得记为通过。

## 11. KP 自定义动态战术环境与 `area-hazard` 纵切

### 11.1 版本化对象

在 `SPEC 0014` 的同一权威 Geometry/事件/投影链上实现：

- `EnvironmentFeature`：稳定 ID、scene、geometry、材质/尺寸/高度、可见性、definition/profile 引用；
- `DestructibleDefinition`：AC、耐久/阈值、伤害类型、免疫、允许状态和残骸语义；
- `TriggeredHazard`：只属于 `area-hazard`，冻结触发条件、区域、豁免、伤害、状态、时点和结束条件；
- `AreaEffect`：只属于 `area-hazard`，记录来源、完整权威 Geometry 计算、持续/中断/到期；`state-only` 中必须为 `null`；
- `EnvironmentStateGraph`：版本化有限状态、允许转换与每态移动/视线/掩护/通行语义。

`environmental-stunt.v1` 必须承接玩家的任意自然语言想法；吊灯、油桶、书架/石柱、吊桥、火盆、闸门、临时掩体、可破坏地板/楼梯和环境阻断只是验收覆盖，不是对象族、关键词模板或预设内容。KP 决定具体对象内容、合理性、开放留白、位置/材质/尺寸/高度、对象 AC/耐久/阈值/免疫、做法、状态图和机械效果模式；这些会影响机械的参数必须在任何骰面前固化。

机械效果模式由 KP 明确冻结为 `state-only` 或 `area-hazard`，不得按对象名称、关键词或家族推断。`state-only` 只结算对象自身的状态/耐久以及地形、掩护、视线或通行变化，定义中不得伪造 Hazard、Area、区域豁免或对区域目标的伤害；只有 `area-hazard` 才要求 KP 继续定义触发、区域、豁免、目标伤害、状态和残骸后果，并由 Rules 计算实际受影响实体。

玩家一句话不能召唤有利物件。既有对象复用稳定 ID/状态；已明确不存在时正常 `resolvedInWorld` 拒绝；合理开放留白必须先用 `materialization.v1` 在骰前固化。Rules 从完整权威 Geometry 计算 caster、ally、enemy、hidden entity 和 environment feature 的实际集合；KP/客户端不能提交该集合。隐藏对象可被影响，但不得从 preview、错误、DOM、Narration 或列表长度泄漏。

不实现通用物理引擎，只执行版本化有限状态和 Rules primitive。合理但高伤害或致命的环境后果不得按队伍等级自动削弱。

### 11.2 `area-hazard` 的通用因果链

下列链说明 `area-hazard` 可以表达的完整因果上限，不绑定吊灯或任何具体物件，也不能据此把玩家想法按名称或类别派发。`state-only` 在合法对象/状态转换与地形/掩护/视线/通行事件提交后结束，不请求区域目标、区域豁免或对区域目标的伤害随机。

```text
materialize/reuse feature
→ 消耗行动/弹药
→ 攻击锁链
→ 对象命中与伤害
→ 达到阈值后进入触发态
→ Rules 计算区域目标
→ 各目标豁免
→ 伤害/状态/死亡
→ 进入残骸/已结算态
→ 更新地形/掩护/通行
```

动态定义、攻击/检定、对象破坏、区域豁免、伤害、状态、死亡和残骸地形必须属于同一 RootAction/Receipt 和可恢复事件链。未命中、命中未破坏和成功触发是三个骰前冻结且可回放的合法分支。

发布验收采用通用动态场景，不要求再为吊灯或任何具体名词建立专项 Room 套件。吊灯只保留为已有 Rules 回归示例，不是完成前置。通用场景必须证明：KP 可创建任意非预设 `state-only` 与 `area-hazard` 定义；既有对象只按稳定 ID 复用；合理留白在骰前固化且明确不存在时世界内拒绝；Rules 从完整 Geometry 结算多目标及隐藏目标而不侧漏；合理致死不按等级缩放；残骸能改变地形/掩护/通行；逐受众失败与恢复不重复机械；archive→fresh DO 后 state/project hash 一致；同 submission 幂等重试不重复 feature、事件、随机、资源或 Delivery。

## 12. 稳定错误、降级与日志

### 12.1 公开错误码

新管线至少稳定实现以下精确代码：

- `PROPOSAL_PROVIDER_TIMEOUT`
- `PROPOSAL_FORM_INVALID`
- `PROPOSAL_REFERENCE_INVALID`
- `PROPOSAL_RULES_DIAGNOSTIC`
- `PROPOSAL_REPAIR_EXHAUSTED`
- `CONTEXT_INSUFFICIENT`
- `NARRATION_PROVIDER_TIMEOUT`
- `NARRATION_BODY_INVALID`
- `NARRATION_GROUNDING_REJECTED`
- `NARRATION_PUBLICATION_FAILED`

错误响应只返回该 Viewer 有权知道的状态、稳定代码、公开 Receipt/重试提示。Planner、FTS、Embedding、Vectorize 和辅助模型失败只记录降级阶段；RequiredContext 足够时不得让行动失败。世界内拒绝、NPC 拒绝和缺前提不是 Provider 技术错误。

Proposal 的 Provider 网络错误、超时、限流或不可用与 Form 修订严格分离：它们记录脱敏 `ModelInvocationReceipt`、稳定 Provider 错误和适用的 `retryAfter`，不消耗“同工具结构修订”机会，也不把残缺响应送进 Rules。系统不得自动换模型、伪造成功或生成世界内拒绝来掩盖平台故障；在没有权威提交时行动保持 `notCommitted`，由相同 submission ID 走幂等平台重试。新旁白结果按 §8.2 先准备回复再原子提交，终局失败取消整个未提交候选；旧流程已提交结果的 Narration Provider 失败继续按 §8.2 的独立发布恢复处理，绝不重跑 Proposal、随机或机械。

### 12.2 新管线日志白名单

对本规格的新 Proposal/Context/RAG/Narration 管线，日志字段只允许：阶段、Form/Profile、模型 ID/revision、输入/输出 token、耗时、公开错误码、fallback 类别、不可逆 hash 和命中数量桶。不得记录 Prompt、玩家正文、NPC 秘密、模组真相、chunk 原文、模型原始输出、Cookie、Authorization、Session/Token、密钥、完整 ID、WorldEvent、骰面候选或任何受众正文。

所有日志必须经过固定 schema/redaction serializer；`console.*` 只能接收该序列化结果。Telemetry、ModelInvocationReceipt 和实验报告都不是事件、Viewer 数据源或检索语料。

## 13. 量化验证与硬门

2026-09-06 用户为本次 vNext 替换明确批准有限调整：§10、§13 的 120 条金标全量报告和统计性发布认证后置，保持未完成；8k/16k 输入与百分比压缩指标作为优化参考，不阻断本次开发部署。定向行为验证、权限、秘密、事实/资源/随机一致性与机械正确性继续生效，普通最多两阶段、schema 补取最多三阶段及一次窄修订不变。此决定不改写历史 G2 的采用结论，也不豁免其他规格。见 [本次执行决定](../agent/vnext-production-todo.md#本次快速开发部署决定2026-09-06)。

### 13.1 数据集与报告口径

金标集至少 120 条，覆盖观察、NPC、重大歧义、高风险、缺前提、动态事实、隐藏现实、个人知识、NPC 有限知识、有意义失败、Activity、战斗、资源和故事收束。每例固定关键/全部 required refs、允许 Form、复杂性、权威边界、预期错误/行动状态和秘密 canary。

所有比例报告分子/分母；token/延迟报告 p50/p95；随机/模型指标给适当置信区间和重复策略；失败按稳定代码、Form、Profile、阶段和 fallback 分类。样本不足、未运行或只靠源码检查不得写成通过。

### 13.2 质量、成本与延迟门

- 关键 Context ref recall = 100%；全部 required ref `Recall@8 ≥ 98%`。
- 简单 Form 首次合法率 ≥ 97%；`compound.v1` 首次合法率 ≥ 95%。
- 一次窄修订后最终合法率 ≥ 99%；可执行路由覆盖率 ≥ 99.5%；复杂行动误入简单 Form = 0。
- 简单 Proposal 输入 p95 ≤ 8k tokens；全体 Proposal 输入 p95 ≤ 16k；Narration 输入 p95 ≤ 5k。
- 相对 G0，Proposal 输入 token 中位数下降 ≥ 50%，Form Schema 字节中位数下降 ≥ 60%。
- Proposal 端到端 p95 ≤ 20 秒；主 Proposal 平均调用数 ≤ 1.10/RootAction；正常 Planner/RAG fallback 率 ≤ 5%。

### 13.3 零容忍与故障注入

Planner、RAG、Embedding、Vectorize 和辅助模型分别故障注入时，安全回退率必须 100%，且世界事实、骰面、资源、虚构时间和玩家意图变化均为 0。

秘密泄漏、第二权威、模型/客户端骰面、客户端实际 target list、任意状态 patch、重复随机/资源/事件、自动换主 KP、骰后改判和叙述失败回滚已提交行动均必须为 0。

前一代 31 轮 KP 评测只作历史审计，不计入 0.4 当前证据。当前长轨迹必须覆盖动态环境和逐受众 Narration 失败/恢复；确定性 fixture 必须走与生产相同的窄工具 allowlist、Form、Context、validator、compiler、Room、Rules 和 projector seam，不能直接构造归一化成功结果。

前一代 workflow-v2/environment-v4 长轨迹曾以 exit 0 定向通过 1/1；它只保留历史审计意义，不能证明当前 0.4 V5/runtime、窄工具或物品闭包。当前长轨迹及其 Viewer recovery、动态环境、archive→fresh DO 组合必须在当前精确闭包上重新运行后才能计数。
