# SPEC 0003：权威行动事务与深 Module Interface

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 产品：烛帷
- 适用规则：D&D 5e 2014 / SRD 5.1
- 上位规格：`SPEC 0001：LLM/KP 职责与叙事权威`
- 取代范围：`SPEC 0002` 第 1–7、13、20–23、25–26 节中的通用事务、随机、幂等、投影、回放、更正、恢复与版本条款

## 1. 目的与权威顺序

本规格把 `SPEC 0001` 的标准 KP 循环实现为一条可恢复、可审计、观察者专属的权威行动事务。自由行动、非战斗检定、战斗、NPC/势力行动、Activity、资源、虚构时间、章节与成长只允许以不同提案进入同一事务，不得另建第二条提交、随机、投影或回放路径。

完整顺序固定为：

```text
可信会话 Principal 提交玩家意图或待决回答
  → Room Authority 接受并持久化根行动，签发相关作用域票据和专属投影
  → KP 在 DO 事务外完成可行性、叙事与风险裁决
  → Rules Module 诊断或执行已经冻结的机械提案
  → Room Authority 原子提交叙事事实、机械事件、Receipt、待决状态与作用域版本
  → project(viewer) 生成唯一观察者 Read Model
  → KP 只依据已提交投影叙述并把决定权交还正确主体
```

任何调用模型、网络、D1、外部日志或归档的操作都不在 Room DO 的 SQLite 事务内。D1 归档失败不能改变已经提交的 Room DO 结果。

## 2. 两个深 Module

### 2.1 Rules Module

Rules Module 的外部 Interface 只有：

```ts
step(profile, state, input): StepResult
project(profile, source, viewer, query?): ViewerReadModel
replay(genesis, contiguousEvents): ReplayResult
```

- `step` 是所有机械和世界变化的唯一确定性裁决入口。它不读取身份会话，不调用 I/O、时钟、模型或随机源。
- `project` 是快照、增量、错误、候选项、NPC 决策、KP 上下文和玩家 Read Model 的唯一脱敏器。
- `replay` 只折叠已提交的版本化事件；不重新运行模型、随机源、当前目录或当前编译器。
- fold、事件应用、机械原语、定义编译与状态缓存都是 Implementation；不得从包入口导出，不得成为生产调用或行为测试的第四条路径。
- `step` 返回的状态缓存必须与返回事件经私有 fold 得到的状态哈希一致；持久真相始终是事件。

### 2.2 Room Action Module

Room Action Module 的外部 Interface 只接受服务端已经认证的上下文和玩家可表达输入：

```ts
handleRoomAction(context, input): Promise<RoomActionOutcome>

type RoomActionInput =
  | { kind: "intent"; submissionId: string; characterId: string; text: string; acknowledgementId?: string }
  | { kind: "answer"; submissionId: string; pendingInputId: string; answer: unknown; acknowledgementId?: string }
  | { kind: "retry"; submissionId: string; rootActionId: string }
  | { kind: "acknowledge"; deliveryId: string };

type RoomActionOutcome =
  | { kind: "committed"; receipt: PublicReceipt; readModel: ViewerReadModel; delivery?: DeliveryFrame }
  | { kind: "awaitingInput"; receipt: PublicReceipt; readModel: ViewerReadModel; pending: PublicPendingInput }
  | { kind: "needsKp"; receipt: PublicReceipt; retryAfter?: number }
  | { kind: "retryableFailure"; receipt?: PublicReceipt; code: PublicFailureCode; retryAfter?: number }
  | { kind: "rejected"; receipt?: PublicReceipt; code: PublicRejectionCode; explanation: string }
  | { kind: "concluded"; receipt: PublicReceipt; readModel: ViewerReadModel; delivery?: DeliveryFrame };
```

Interface 不接受 `principalId`、`actorId`、骰面、事件、状态补丁、机械原语、DC 后改值或完整候选状态。`context.principal` 只能由可信登录会话建立；请求体中的同名字段必须忽略或拒绝。

Room Action Module 内部协调 Room Authority、KP Adapter 与 Rules Module；页面、API、语音转写和图片输入只负责形成 `intent` 或 `answer`，不计算机械或保存第二状态。

## 3. Room Authority Interface

每房间一个 SQLite Room Durable Object，公开以下服务端 RPC 语义：

```ts
prepare(authenticatedContext, actionInput): PreparedAction
observe(authenticatedContext, query?): ViewerReadModel
commit(authenticatedContext, preparedActionId, rulesInput): CommitOutcome
acknowledge(authenticatedContext, deliveryId): AcknowledgementOutcome
commitCorrection(correctionAuthority, request): CorrectionOutcome
```

- `prepare` 原子接受根行动或待决回答、验证 Principal/席位/控制权、记录规范载荷哈希，生成相关作用域基线与 KP/玩家各自投影；它不调用 LLM。
- `observe` 不签发新行动票据，只返回 `project` 生成的当前 Read Model 与该观察者仍未确认的当前 Delivery Frame。
- `commit` 只接受由服务端 Adapter 产生、绑定 `preparedActionId` 的 Rules Input。DO 在事务内调用 `step`、验证 `scopeProof` 并提交事件、Receipt、待决、作用域版本和缓存。
- `acknowledge` 幂等确认当前观察者 Delivery Frame；确认后玩家接口不再返回该文本。
- `commitCorrection` 只能由重新鉴权的更正权威或确定性审计器使用；普通玩家、模型、Room Action Module 的普通提交和页面无权构造更正输入。

Room DO 是活跃 `WorldState`、连续事件、作用域版本、幂等 Receipt、根行动、待决输入、当前 Delivery Frame 和内部 continuation capability 的唯一权威。D1 只保存身份、房间目录、静态人物卡、模组/规则版本与可重建事件归档。

0.4 authoritative-v2 的提案边界不提供 compact 命令或旧 ActionPlan 兼容。普通 KP 提案必须是经当前私有 Form schema 验证、确定性编译并绑定当前 Action Language 的 `executeCausalActionProgram`；专用环境动作、认证队伍/战役动作和待决回答只接受 Room 生成的字段精确 capability。DO 不按 `kind` 猜测旧命令，也不把任意 Rules command 当成已认证提案。

随机结算恢复还必须重新验证持久 `rulesInput` 和 recovery envelope 的 hash 及 exact allowlist。当前只允许：当前 `executeCausalActionProgram`；绑定同一 Causal Program 的精确 `invokeEnvironmentalStunt`；仅执行决定的 `resolveDueActorPlan` wrapper（其机械提案仍由后续 Rules 完整验证）；字段精确的 `answerSocialResolution`；以及 combat answer 或内嵌当前 Causal Program 的两种精确 `answerPendingInput`。未知形状、额外字段、旧 ActionPlan 或完整性 hash 不符一律停止恢复，不调用 Rules。

## 4. 根行动与状态机

一个 `RootAction` 至少包含：

- `rootActionId`、`submissionId`、规范载荷哈希和输入种类；
- 可信 `principalId`、当时受控 `characterId` 与权限证据摘要；
- 原始目标和做法；语音输入还保存脱敏转写来源类型，不保存运行时音频或秘密 Prompt；
- `rulesetVersion`、`eventSchemaVersion`、活动分支、相关作用域基线；
- 状态：`accepted | awaitingClarification | awaitingKp | awaitingMechanics | awaitingAuthority | committed | rejected | concluded | superseded`；
- 唯一当前 `PendingInput` 或空；
- 已发生的提案尝试与公开诊断摘要；
- 最终 Receipt 引用。

状态转换只能由权威事件或 Room DO 的原子事务完成。现实超时、页面关闭、断线、Worker 重启、模型失败、TurnTicket 过期或 UX 租约过期不产生 `pass`，不结束回合，不推进虚构时间，也不代替玩家选择。

当 KP 在处理原意图前发现已经在虚构时间到期的 NPC/势力计划或 Activity，必须先形成独立但因果关联的内部行动，经同一 `step → commit → project` 链提交，再重新投影处理原意图。若新事实实质改变重大风险、资源成本或不可逆含义，原行动转为玩家澄清，不得在旧情境自动执行。

## 5. 待决输入

一个房间可以存在多个互不冲突作用域的待决输入，但每个 RootAction/Resolution 同时至多一个当前输入。判别式类型至少包括：

- `clarification`：只由原玩家回答的重大歧义；
- `playerChoice`：目标、反应、资源、升级、继任或其他玩家控制选择；
- `kpRevision`：机械诊断后由 KP 修订；
- `kpDecision`：NPC/势力基于有限知识的选择；
- `authoritativeRandomness`：只由 Room DO 满足；
- `automaticContinuation`：只由 DO 从已提交事件恢复；
- `safetyPause`：保持最近稳定点，原因只向请求者和安全处理器投影。

每个 Pending Input 绑定稳定 ID、控制主体、唯一 continuation、相关作用域、合法输入 schema、可见性和打开事件。没有权限的观察者不得从是否存在、候选数量、错误文本或轮询形状推断它。

## 6. 机械诊断与 KP 修订

Rules Module 对非法提案返回结构化 `RuleViolation[]`，包含稳定代码、公开安全路径、规则依据、可执行修订方向和秘密级别。它不得返回半提交事件或先掷骰再修补。

Room Action Module 将只适合 KP 的诊断投影给 KP，保留玩家可见的诚实等待状态；KP 在 DO 事务外修订后以同一 `rootActionId`、新 `proposalAttemptId` 重提。默认最多两次自动修订；仍不可执行时返回 `needsKp`，根行动保持可恢复，不伪造成功。这个上限是模型成本与失控循环护栏，不改变玩家意图，也不把非法提案当世界内失败。

## 7. 权威随机数与骰前冻结

Rules Module 只能生成 `RandomnessRequest`，Room DO 是生产骰源。请求必须在骰面出现前冻结：

- 用途、骰式、目标、DC、修正、优势/劣势；
- 风险、成功/失败候选、资源成本、范围和可见性；
- `randomnessId`、`resolutionId`、继续点、规范载荷哈希和相关作用域基线。

协议固定为：

1. `step` 产生随机请求事件与稳定继续点；DO 先原子提交。
2. DO 使用 Web Crypto 无偏骰源生成候选骰面，并以 `randomnessId + requestHash + frozenParametersHash` 在该房间 SQLite 的内部幂等 journal 中原子固定；该 journal 不进入 D1、投影、日志或普通 RPC。
3. DO 以内部 continuation 再次调用 `step`，在一个事务中提交 `DiceRolled`、机械后果、Receipt 和下一状态；成功后 journal 只作同 Room 的恢复/幂等依据，事件流仍是可回放权威。
4. 候选 journal 提交前崩溃可以重新生成；journal 提交后、最终事件提交前崩溃必须复用同一候选；最终提交后重试必须从幂等结果、事件和 Receipt 复用同一骰面。

客户端、LLM、页面、D1、Worker 普通函数与测试命令均不能提供生产骰面。测试只能通过 Room Authority 的确定性骰源 Adapter 或公开动作链控制测试随机性。

## 8. 幂等 ID 与 Receipt

ID 语义分离：

- `submissionId`：一次外部写请求；
- `rootActionId`：原始行动及其澄清/修订链；
- `resolutionId`：跨请求机械结算；
- `pendingInputId`：唯一等待项；
- `responseId`：一次回答；
- `randomnessId`：一次权威随机请求；
- `deliveryId`：一次观察者专属当前回应；
- `correctionId`：一次更正事务。

幂等键至少包含房间、可信 Principal、输入种类、ID 与规范载荷哈希。同一 ID/同一载荷返回原 Receipt；同一 ID/不同载荷拒绝。重试必须重新鉴权并重新 `project`，不得直接返回缓存的私人投影。

`PublicReceipt` 至少包含提交状态、根行动、活动分支、事件范围、规则/事件版本、作用域版本摘要、随机承诺摘要、待决/更正引用和观察者投影哈希；不包含秘密事实、原始事件、Prompt 或其他观察者的数据。

## 9. 作用域版本与并发

全局 `expectedRevision` 只可作为审计游标，不能成为并发锁。Rules Module 根据实际读取、写入和新建闭包返回 `scopeProof`；Room DO 只验证证明，不复制依赖算法。

外部行动基线来自 `prepare`；内部随机和 continuation 基线随结算事件保存；更正基线来自完整日志构造的 `CorrectionContext`。无关作用域推进不得使原行动失败。相关既有作用域未绑定或版本变化时整笔不提交：外部行动重新投影重提，内部结算停在稳定点重新裁决。Rules Module 明确声明为新建且不存在冲突的作用域可以原子加入。

作用域至少区分实体、控制权、场景/空间、物件、知识、关系/承诺、资源、Activity/时间线、遭遇/结算、NPC/势力计划、章节/成长、投影交付与分支。

## 10. 恢复、回放与更正

- Room DO 重启后从 genesis、连续事件、Receipt 和待决记录恢复；进程内 Promise、模型响应或页面状态不参与恢复。
- `replay` 验证规则集、事件 schema、定义/编译器/Profile 哈希、连续 `eventSeq`、分支图与状态哈希；不匹配显式拒绝。
- 尚未提交的错误提案废弃重做；已提交错误只能追加更正。
- 不影响后继选择的错误使用前向补偿；已经改变死亡、位置、资源选择、秘密获得或其他因果的错误打开审计可见的新分支，保留旧事件/骰面/Receipt，并明确 supersede 受影响闭包。
- 普通用户可报告错误，但不能提供状态补丁、事件、机械原语或分支图。

## 11. 统一 Read Model

所有外层 Outcome 均只携带 `project` 生成的 Read Model、公开 Receipt、公开 Pending Input 和观察者专属 Delivery Frame。快照、增量、重连、错误、候选项、日志摘要、语音/转写结果和 KP 叙述不能使用独立脱敏逻辑。

增量请求需要 Room DO 提供从游标后一项到头部的连续事件片段及起止哈希；`project` 验证后才生成脱敏增量。缺片、断序或哈希不符显式拒绝，不回退到原始日志或页面拼接。

## 12. 故障语义

- `committed`：世界变化与 Receipt 已提交；叙述失败不回滚。
- `awaitingInput`：稳定等待指定主体，现实超时不代答。
- `needsKp`：提案需要新的 KP 判断或修订，未伪造机械结果。
- `retryableFailure`：模型、网络、归档或平台暂时失败；最近稳定事实保持。
- `rejected`：权限、载荷、不可行或规则版本明确拒绝；是否产生世界成本由已提交事件决定。
- `concluded`：当前故事或章节已按已固化事实收束；继续必须建立续篇/新章节。

## 13. 验收场景

1. 同一自由行动可以直接成功、请求检定、产生 Activity、开始战斗或触发 NPC 计划，所有变化都来自同一 `step`。
2. 伪造 Principal/actor、替他人答窗、复用 ID 换载荷均被拒绝，无秘密侧漏。
3. 无关地点推进后旧票据仍可提交；相关作用域变化时整笔重提。
4. 随机请求提交前、候选生成后、骰面提交后和响应丢失后分别重启，最终只有一份骰面与后果。
5. 模型两次修订仍非法时返回 `needsKp`，世界没有虚假成功或半提交。
6. D1 归档失败时 Room DO 已提交结果仍返回 committed，并可稍后从 DO 重建归档。
7. 已提交错误分别走前向补偿和因果分支，`replay` 得到同一活动状态。
8. 页面、语音和战斗入口只提交 Intent/Answer，无法提交事件、骰面或状态补丁。

## 14. 实现映射

- Rules Module Interface：`app/_runtime/lib/rules/index.ts`
- Rules Module Implementation：`app/_runtime/lib/rules/v2/`；当前普通提案解释位于 `causal-actions.ts`，战役、战斗、多人和 ActorPlan 机械分别由其单一职责模块处理；`compound-model.ts` 只保留内部冻结结算值，不是旧生产 ActionPlan transport。包入口不得导出 fold、applyEvents 或生产骰源
- 生产 KP 私有 Form schema/编译：`app/_runtime/lib/kp/form-catalog.ts`、`private-form-policy.ts`、`causal-action-program.ts`、`authoritative.ts`
- 当前 Form 与 Room capability 的严格归一化及初始化 fixture：`app/_runtime/lib/room/proposal-adapter.ts`
- Room Authority：`app/_runtime/lib/room/durable-object.ts`
- Room Action Module：`app/_runtime/lib/room/action.ts`
- 服务端可信身份 Adapter：`app/_runtime/lib/room/server.ts` 与 `app/chatgpt-auth.ts`
- 页面/API Adapter：`app/_runtime/lib/table/server.ts` 与 `app/_runtime/components/play-table.tsx`
- 行为测试：`tests/kp-form-context-v3.test.mjs`、`tests/authoritative-kp-adapter.test.mjs`、`tests/causal-action-rules-v3.test.mjs`、`tests/world-campaign-v2.test.mjs`、`tests/rules-multiplayer-v2.test.mjs`、`tests/multiplayer-room-v2.test.ts`、`tests/item-materialization-causal-v5.test.mjs`、`tests/randomness-recovery-v2.test.ts`、`tests/room-retry-v2.test.ts`

### 14.1 当前实现证据（2026-08-31）

- `tests/kp-form-context-v3.test.mjs` 与 `tests/authoritative-kp-adapter.test.mjs` 覆盖当前私有 Form、Causal Program 编译、语言/Profile 绑定、Room normalizer 和 authority 字段注入拒绝；模型或客户端不能提交 actor、root、骰面、事件或状态补丁。
- `tests/causal-action-rules-v3.test.mjs` 覆盖当前因果程序的直接/检定阶段、冻结成本、分支、同 Root continuation、篡改拒绝和 replay；世界/休整/失败、队伍与物品的直接切片分别由 `world-campaign-v2`、multiplayer 和 Item V5 runner 覆盖。
- 当前测试尚未重新证明退役 `compound-action-v2.test.ts` 曾表达的“动态事实、NPC 计划、场景问题与多份机械结果在同一 Root Action”完整纵切；该旧 draft runner 不计 0.4 证据，缺口必须由当前 Form/Causal 协议的真实 Room 纵切补齐，不能借旧测试绿色推断。
- `tools/check-modules.mjs` 保持 authoritative-v2 无 compact/旧 ActionPlan 分支，并要求恢复输入经过 current exact allowlist；最终冻结源码仍须运行 `npm run module:check`。
- 上述是局部冻结源码的行为证据；最终全量门、真实模型、迁移、部署与线上冒烟仍须以 `refactor-log.md` 后续记录为准。

## 15. 交叉审查结论

- 与 SPEC 0001：保留玩家意图、KP 叙事、规则机械与权威状态四权分离；无缩小。
- 权限：Principal 永不来自请求体；玩家/NPC/更正/内部 continuation 权限分离。
- 秘密：所有外发数据经 `project`；原始事件和 KP Viewer 不离开可信服务端。
- 版本：0.4 行为只由精确的当前 ruleset/runtime 完整绑定启用；前 0.4 房间显式退役并拒绝，不注册 Legacy 回放或兼容分派。
- 第二权威：D1、页面、模型、Adapter 和测试均不能提交状态、掷骰或独立投影。
