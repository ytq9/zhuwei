# SPEC 0011：可靠性、更正、可观测性与多轮评测

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0010`
- 平台：现有 Cloudflare Worker `zhuwei`、D1 `zhuwei-dev`、SQLite Room Durable Object、Workers AI binding `AI`
- 取代范围：`SPEC 0002` 第 13、20–23、25 节及 B16、B27、B31–B33、B44–B46、B48、B50–B52 中的通用可靠性、恢复、更正、日志和评测条款

## 1. 故障分类

所有外层错误必须映射到稳定、脱敏的分类：

| 类别 | 例子 | 世界状态 | 外层结果 |
| --- | --- | --- | --- |
| `authentication` | 会话失效、被请离 | 不变 | `rejected` |
| `authorization` | 伪造控制者、替他人答窗 | 不变 | `rejected` |
| `validation` | 载荷/schema/版本不合法 | 不变 | `rejected` |
| `scopeConflict` | 相关作用域已变化 | 不变，重新投影 | `retryableFailure` 或重新 prepare |
| `mechanicalDiagnostic` | KP 提案不可执行 | 不提交世界结果，保留根行动 | `needsKp` |
| `worldInfeasible` | 缺少前提/违反规律 | 只有真实尝试成本可提交 | `rejected` 或 `committed` |
| `modelTransient` | 超时、容量、429 | 最近稳定点不变 | `retryableFailure` |
| `modelPermanent` | 未配置/模型无权/无效 ID | 最近稳定点不变 | `needsKp`/`rejected` |
| `authorityTransient` | DO 临时错误/响应丢失 | 以 Receipt 重查 | `retryableFailure` |
| `archiveFailure` | D1 追加失败 | DO 已提交结果不回滚 | `committed` + 内部待归档 |
| `projectionIntegrity` | 增量断序/哈希不符 | 不返回原始事件 | `retryableFailure` |
| `correctionRequired` | 已提交机械/事实错误 | 保持旧历史直至授权更正 | `needsKp`/错误报告 Receipt |
| `quotaExhausted` | Workers/AI/D1 免费额度耗尽 | 不自动推进 | `retryableFailure` |

错误响应不得包含 Cookie、Token、Prompt、模组真相、未公开线索、内部 flags、私人叙述、原始模型输出、候选数量或其他 Viewer 数据。

## 2. SLO

以下 SLO 以一个自然月和实际生产遥测计算，计划维护和第三方全域故障单独标注但不从事实中删除：

- Room Authority `prepare/observe/commit/ack`（不含模型）成功率 ≥ 99.9%。
- 已提交 Receipt 的幂等重取正确率 = 100%；不能返回不同机械结果。
- 权威骰重复率错误、重复资源扣除、未授权秘密投影和静默历史改写的允许值 = 0。
- DO 内无模型路径 p95 ≤ 750 ms，p99 ≤ 2 s；超出记录分类，不通过自动降级为第二权威。
- KP 提案单次调用 p95 目标 ≤ 20 s，叙述单次 p95 目标 ≤ 15 s；超过 45 s 由调用方中止并返回可恢复失败，不代玩家行动。
- `observe` 的当前回应/待决重连恢复 p95 ≤ 2 s（网络到达 Worker 后）。
- D1 归档滞后正常目标 ≤ 60 s；超过 10 分钟告警，仍以 DO 为权威。

SLO 未达成时先报告真实分类与恢复条件；不得吞错、伪造成功、改骰或调用不兼容备用规则。

## 3. 免费额度与成本预算

2026-08-26 重新核对官方文档后，Free 方案公开基线为：Workers 100,000 请求/日；D1 5,000,000 行读/日、100,000 行写/日及 5 GB；SQLite Durable Objects 100,000 请求/日、13,000 GB-s/日、5,000,000 行读/日、100,000 行写/日及 5 GB 总存储；Workers AI 10,000 neurons/日。它们是方案上限而非本账户剩余额度，本文没有检查或声称当前账户仍有多少用量余量。限制会变化，正式发布前仍须同时复核官方文档、控制面 entitlement 和实际用量：

- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)

产品预算：

- 不创建新 Worker、D1、KV、R2、Queue、Workflow、Tail Worker 或额外状态权威，不升级方案。
- 每次根行动最多 1 次首提案 + 2 次机械修订 + 每个有权 Viewer 1 次当前回应；不做投机并行、全观察者预生成或后台无玩家触发推理。
- Prompt 只含当前 KP Viewer、相关事实摘要、裁定先例和连续性索引，不发送完整事件/聊天历史；首个 Profile 目标输入 ≤ 16k tokens、提案输出 ≤ 2k、叙述输出 ≤ 800。
- 当前回应每 Viewer 单槽，确认或被新回应覆盖即删除文本，避免长期存储与重生成成本；结构化事实长期保存。
- `observe` 读取当前快照索引和必要增量，不全表扫描；D1 归档按提交事件批量/幂等追加。
- 达到 AI 免费额度、模型付费限制或容量错误时返回 `retryableFailure`；不自动启用付费模型、外部 API 或弱化 KP 职责。

新规则默认模型必须是部署时在现有 Workers Free/当前账号权限内可用的版本化模型 Profile。需要付费或未配置密钥的模型只能用于已经明确绑定且账户当前可用的旧房间，不能成为新房间默认，也不能静默替换。

同日复核的 [`@cf/zai-org/glm-4.7-flash` 模型页](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)列出 function calling 与 131,072 token context；Cloudflare [2026-07-28 模型方案 changelog](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/) 的付费限定清单不包含 GLM 4.7 Flash（清单包括 Kimi 2.6/2.7、GLM 5.2 等模型），因此公开目录仍把它归入 Free 可用范围。这只证明公开产品能力/方案归类，不证明本账户部署时 entitlement、当前 neurons 余量、真实调用延迟或输出质量；这些仍须阶段 5 能力探测和有界真实调用确认。

## 4. 模型版本与调用证据

每次模型任务记录脱敏 `ModelInvocationReceipt`：provider、model id/revision、promptPolicyVersion、schemaVersion、rootActionId、attempt number、started/ended、分类结果、输入/输出计量和响应哈希。不得记录 Prompt、原始输出、私人投影或密钥。

房间绑定 `kpModelProfile`；升级需要明确 Profile 迁移事件，不重写已提交事实。模型只提出 KP/叙述内容，权威结果由 Rules/DO 决定。模型切换、重试和温度变化不能成为重掷或改变骰前冻结参数的理由。

## 5. 结构化运行日志

允许字段白名单：

- 时间、severity、eventName、requestId、roomHash、principalHash；
- rootAction/submission/receipt/event range 的不可逆短哈希；
- ruleset/event/profile/model policy 版本；
- outcome kind、公开错误码、延迟、重试次数、计量；
- archive lag、replay/correction integrity 结果。

禁止字段：Cookie、Authorization、session/token、email、完整 user/room/character ID、请求/响应 body、Prompt、模型原文、模组真相、秘密事实、未公开线索、内部 flags、私人叙述、语音/转写正文、原始 WorldEvent 和骰子候选。

日志序列化使用固定 redaction 函数和 schema；任何 `console.*` 都只能接收其结果。日志不是 Viewer 数据源、事件归档或回放输入。

## 6. 归档与重建

Room DO 提交后产生待归档标记；Worker/D1 Adapter 幂等追加事件副本，键为 room + eventSeq/eventId。归档至少保存规则集、事件 schema、模组/定义/Profile 哈希、活动分支和状态哈希；不保存旁白 Delivery Frame。

重建流程：

1. 从 D1 目录取得房间 genesis 引用和预期版本；
2. 读取连续归档事件，验证序号、哈希链和版本；
3. 通过 Rules `replay` 得到状态；
4. 在目标 Room DO 尚无活跃状态或经过明确灾难恢复授权时写入；
5. `project` 比较代表性 Viewer hash 与归档前审计值；
6. 重建缺片或不匹配时停止，不猜测/补事件。

重建后的待决鉴权索引必须完全派生自 replay 得到的权威状态，并以同一个枚举器同时覆盖通用 `pendingInputs` 与 `combatRuntime.pendingInputs`；不得让归档路径只恢复玩家可见投影却遗漏可继续回答的战斗待决。候选、控制角色与私有选项保持原提交值，恢复不会把短期待决变成聊天历史。

D1 丢失可从 Room DO 重新导出；Room DO 活跃状态不得从 D1 `game_states`、messages 或 session logs 拼装。

随机 continuation 的 Room SQLite 恢复记录同样不是通用 Rules 输入缓存：恢复前必须验证 proposal hash、recovery hash 与载荷 allowlist。authoritative-v2 只允许 ActionPlan v1，或可选内嵌同版本 ActionPlan 的 `answerPendingInput`；compact proposal、任意 Rules command、未知 ActionPlan 版本和多余字段必须返回稳定的完整性/恢复失败，不能借重启进入旧机械路径。

## 7. 更正与审计

普通玩家/模型可提交 `ErrorReport`，只引用公开 Receipt/事件范围和说明。执行更正只通过重新鉴权的 `commitCorrection`：

- Room DO 从完整日志构造 hash-bound `CorrectionContext`；调用者不能提供状态补丁、事件、MechanicOp 或分支图。
- Rules Module 判断前向补偿或因果分支，生成更正事件；DO 不自行算机械。
- 不影响后继选择时使用补偿；影响死亡、位置、资源、秘密获得、关系或玩家选择时打开新分支并 supersede 闭包。
- 旧事件、旧骰面、旧 Receipt、旧 Delivery 审计引用保留；玩家界面不恢复旧旁白历史。
- 输入未变可沿用原骰面；冻结输入变化才在新分支请求新 `randomnessId`。不喜欢结果不是更正理由。
- 所有会改变战斗运行态的事件在 fold 前记录完整、确定性的 `combatRuntime` 恢复快照，至少覆盖遭遇建立、先攻、轮/回合、反应、战斗待决、结论、伤害/资源及战斗随机 continuation；更正按受影响事件逆序应用快照，并同步重建 Room 的待决鉴权索引，不能留下幽灵 encounter、候选或可回答的旧待决。
- 更正不得改变房间的 runtime manifest pin。本 Goal 的 authoritative-v2 尚未首次正式发布，冻结发布源码时可以同步更新其待发布 manifest/hash；首次正式发布后，任何会改变 correction audit 或 replay state hash 的实现都必须发行新 manifest/interpreter 并永久保留旧解释器，禁止在原 pin 下静默替换。

公开说明包含错误、正确规则/事实、受影响结果和采取方式，同时隐藏无权知道的依据。

## 8. 幂等与恢复测试矩阵

必须在公开 Interface 上覆盖：

- 同 `submissionId` 同载荷/换载荷；
- 响应丢失、HTTP 重试、Worker 重启、DO 实例重建；
- 随机请求提交前、请求 journal 提交后、候选 journal 提交后、骰面事件/Receipt 原子提交后但响应前；
- 模型首提案失败、修订失败、叙述失败、到期 NPC 计划已提交后模型失败；
- D1 归档失败/恢复/缺片/重建；
- 私人 Delivery ACK 前刷新/断线、ACK 后重连、新回应覆盖；
- 更正补偿/分支、旧 ID superseded 和完整 replay。

## 9. 20+ 连续交互 KP 评测

至少一条生产 Room Action Interface 上的确定性评测含不少于 20 个连续玩家意图或待决回答，使用受控 KP fixture（不是直接事件脚本），覆盖：

- 2+ 玩家、分头/重组和聚光灯；
- 私人线索取得、保持、世界内分享、跨章节持续；
- 非预写行动、五类裁决、重大澄清和准备收益；
- 动态危险/敌人、可感知预兆、公正骰前冻结；
- NPC 有限知识和势力计划；
- 有意义失败、禁止原样重掷和新的局面；
- 战斗/资源/Activity/虚构时间同一事务；
- 一次模型失败与断线恢复；
- 核心冲突真实解决/失败/放弃之一并收束；
- 成长或章节切换以及合法连续性。

评分维度各 0–2：秘密、连续性、公正、能动性、机械诚实、失败、聚光灯、收束、恢复、叙述。硬门：任何秘密泄漏、替玩家选择、骰后改判、重复随机/资源、第二权威或假收束直接失败；否则总分至少 18/20 且每项 ≥1。

Fixture 只能在 KP/熵/时钟/外部故障 Adapter seam 控制输入；不得直接改 WorldState、事件、骰面、窗口或内部表。

确定性 KP fixture 也必须生成完整 production draft，并逐轮调用与线上 Adapter 相同的 `validateProposal` 与 `assertProposalProjectionBound`；只构造已经归一化的 compact Room proposal 不计入本评测。它证明 schema、Viewer 依据和 Room Action 责任链，但仍不替代真实 Workers AI 模型调用与线上 table/API 冒烟。

## 10. 验收场景

1. 所有故障返回正确代数结果且不推进世界；日志通过禁止字段扫描。
2. 四个随机崩溃点最终只有一份骰面、资源与结果。
3. D1 归档清空后从 DO 重建；新空 DO 从完整归档重建并得到相同 replay/project hash，战斗目标/反应待决的候选与合法回答能力保持一致，伪造候选仍失败。
4. 两类更正都保留旧历史并得到一致活动状态；遭遇/先攻/回合/反应/战斗待决/结论可完整恢复，旧待决不能再通过 Room 鉴权，普通玩家无法调用更正入口。
5. 模型额度耗尽/付费限制不自动切付费或降为命令翻译器。
6. 20+ 轮评测通过硬门与分数阈值。

## 11. 实现映射

- 故障/日志：`app/_runtime/lib/room/telemetry.ts`
- 模型 Adapter：`app/_runtime/lib/rules/ai-adapter.ts`
- 归档/重建：`app/_runtime/lib/room/archive.ts`、`app/_runtime/lib/room/pending-bindings.ts`
- 更正：`app/_runtime/lib/rules/v2/correction.ts` 与 `RoomDurableObject.commitCorrection`
- 评测：`tests/kp-multiturn-eval.test.ts`、`tests/randomness-recovery-v2.test.ts`、`tests/archive-correction-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts`

### 11.1 当前实现映射（2026-08-26）

- `app/_runtime/lib/room/proposal-adapter.ts` 复用 production `validateProposal`；`app/_runtime/lib/room/durable-object.ts` 在恢复分支重新执行 `isCanonicalAuthorityRecoveryInput`，`scripts/check-modules.mjs` 禁止 compact DO 分支和未受限恢复输入。
- `tests/kp-multiturn-eval.test.ts` 的 31 次连续交互已经迁移为完整 production proposal fixture，逐轮执行 `validateProposal` 与 projection-bound 检查；补齐 `resolveNoncombatSave` 冻结成本/后果及角色 canonical loadout/HP/class seed 后，当前源码 1/1 通过并达到全部硬门/评分阈值。它仍是受控模型 fixture，真实 Workers AI/部署另行验收。
- `app/_runtime/lib/room/pending-bindings.ts` 是 live commit、归档恢复与更正后 SQL 索引同步的唯一待决枚举；`app/_runtime/lib/rules/v2/correction.ts` 以 fold 前完整 `combatRuntime` 快照恢复遭遇、先攻/回合、反应、战斗待决与结论。`tests/combat-archive-correction-v2.test.ts` 当前 3/3 通过，覆盖恢复后同候选、伪造拒绝、合法继续、遭遇/待决更正、旧待决失效及更正归档的新 DO 重建；冻结源码仍须重跑全量门。

## 12. 交叉审查

- SPEC 0001：模型失败不退化 KP、不改判；更正公开且可审计。
- 权限：更正、内部恢复、KP/NPC/玩家入口分离；重试重新鉴权。
- 秘密：日志白名单、模型 Receipt 与归档均不保存私人叙述/Prompt。
- 版本：模型、Prompt、规则、事件、定义、Profile 和分支全部可审计。
- 第二权威：日志、D1 归档、模型缓存、Delivery 缓存和测试 fixture 均不能提交世界状态。
