# SPEC 0009：失败、节奏、收束与交互协议

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0004`、`SPEC 0006`、`SPEC 0007`、`SPEC 0008`
- 取代范围：`SPEC 0002` 第 18、21–22 节及 B28–B34、B41、B46–B48、B53 中的失败、叙述、交互与故事收束条款

## 1. 场景问题

每个展开演出的 `SceneFrame` 必须有一个尚未回答、可由玩家行动改变的问题，例如“能否在守卫赶来前打开金库”或“谈判会以何种关系结束”。问题不是预定答案或唯一任务路线。

当问题已经回答、过程没有重要风险/资源/分歧或结果已由事实确定时，KP 应结束或概括场景。仍有重要选择、危险、资源、时间或私人决定时不得为赶剧情跳过。

`SceneQuestionOpened`、`SceneQuestionAnswered` 和 `SceneTransitioned` 只记录结构化事实；KP 叙述由已提交投影产生。

## 2. 有意义失败

任务、机会、关系和角色可以彻底失败；系统不保证“成功但有代价”。一次合法检定失败必须产生相称的世界变化或信息边界，且新的局面仍有可作出的决定：

- 路线关闭或目标不可再达；
- 时间/资源/位置/隐蔽性改变；
- 伤害、状态、关系、债务或承诺改变；
- NPC/势力计划推进；
- 只取得基础/部分信息或必须寻找另一来源；
- 产生新的风险、交易或选择。

失败不能只返回原状并要求同骰重试，也不能凭空从低风险升级为致命惩罚。核心结论具有不同来源的冗余证据；一次失败可以永久失去某条线索/机会，但不能让整场只剩等待同一骰点成功。

## 3. 重复检定与先例

Room Action Module 在建立新检定前查询上一次相同目标/方法/事实的 Receipt 和裁定先例。没有 `methodChanged | factsChanged | costAccepted | positionChanged | materialAssistance | situationAdvanced` 的权威证据时，KP 应说明现状并拒绝原样重掷。

实质变化后可以重新裁定；新 DC/方式/风险在骰前冻结并说明公开差异。不能为给玩家更多机会而无事实依据反复掷骰。

## 4. 玩家停滞

玩家暂时不知道下一步时，KP 固定顺序：

1. 重新定向：当前处境、已掌握线索、逼近事件和可互动对象；
2. 提供机会或代价：NPC 交易、时间窗口、可见预兆或有成本的帮助；
3. 兑现既有后果：只有虚构时间、失败、忽略预兆、NPC/势力计划或其他事实满足条件时发生。

重新定向可以给两个明显方向并明确接受其他方法，但不能变成封闭菜单。现实思考时间不推进世界；KP 不传送玩家回主线、不替玩家解决或选择。

## 5. 势力推进与节奏

势力推进必须引用 SPEC 0006 的计划、有限知识、资源、Activity 与触发条件。推进产生可观察痕迹、改变世界或形成机会；不因“需要高潮”或玩家偏航凭空发生。

KP 可以概括低风险、重复过程，但每次概括必须冻结虚构耗时、资源、风险和结果范围，并经 `step` 提交。Spotlight Beat 只调度决定权，不改变这些事实。

## 6. 叙述协议

每次已提交行动的 KP 回应自然覆盖：

1. 上次行动实际造成的变化；
2. 当前 Viewer 能直接感知的两三个关键细节；
3. 该角色因能力、背景、知识或位置获得的额外信息；
4. 当前压力、机会或可互动对象；
5. 把决定权交还正确玩家。

这是质量检查表，不要求固定段落。叙述不得：

- 改写命中、DC、骰面、伤害、资源、位置、死亡或其他已提交事实；
- 添加新的因果事实而不另走提案；
- 替玩家角色决定未受控制效果影响的台词、信念、情绪、意图或下一步；
- 泄露其他 Viewer 的秘密、窗口或未来分支；
- 用长篇独白、NPC 互聊或重复检定占用决定权。

叙述失败不回滚机械；重试幂等键绑定事件范围、活动分支、Viewer/Principal、projectionHash 与 narrationPolicyVersion。不同观察者、分支或投影不得复用文本。

## 7. 统一 Read Model 与 Receipt 交互

所有 UI/API 成功、等待、拒绝和结束状态使用 SPEC 0003/0010 的统一 Read Model、Public Receipt 与当前 Delivery Frame。玩家看到的最小交互包括：

- 自己的当前可感知场景、角色状态、资源和知识；
- 当前行动 Receipt 与公开后果；
- 只属于自己的 Pending Input；
- 当前 KP 回应及确认控件；
- 可以自由输入的自然语言框，而非封闭命令菜单；
- 两个明显方向只能作为提示，必须允许其他方法。

页面不得自己根据响应拼状态、预测机械结果或保存完整 KP 历史。

## 8. Ending Candidate 与故事收束

结构化 `EndingPredicate` 只产生 `EndingCandidate`，提供事实信号，不自动宣布故事结束。KP 依据以下事实判断真实收束：

- 核心冲突已经解决；
- 核心目标已经不可逆失败；
- 玩家明确放弃当前冲突/冒险；
- 当前场景/机械冲突已无继续意义，且没有必须回答的待决。

结束提案必须引用已固化事实、未结事项、各主体意图和长期后果。玩家分别决定自己的角色是否接受投降、停止追击、离开或继续；KP 决定 NPC/世界意图。

Rules Module 验证没有未结伤害、移动、强制效果、Activity 完成点或私人窗口，并提交 `StoryConcluded`/`ChapterConcluded`。收束不清除伤势、资源、物件、关系、承诺、俘虏、尸体、知识或持续效果。

KP 不得为延长内容追加幕后黑手、撤销胜利、让牺牲无意义或把失败偷偷改成成功。尚有独立冲突存在不妨碍当前故事收束；它们可以成为尾声事实或未来续篇候选。

## 9. 尾声、续篇与新冒险

收束后为每位 Viewer 投影其有权知道的长期后果与个人尾声选择。玩家可以：

- 结束角色/章节/Campaign；
- 选择简短尾声；
- 明确开启续篇；
- 建立新章节/新冒险。

续篇必须有新的 Chapter/Story ID、锚点和场景问题，并引用旧后果；不能在同一结局后暗中生成新敌人假装故事没结束。没有玩家明确继续时系统停在 concluded。

## 10. 内容安全与现实玩家边界

内容安全与角色安全分离。玩家请求暂停、淡化或避开现实敏感内容时：

- 立即停在最近已提交稳定点，无需房主/全桌批准；
- 原因和个人边界只向请求者和可信安全处理器可见；
- 只有请求者明确选择时才持久化最小化、脱敏的后续边界；
- 不解释为角色 pass、机械失败、重掷、资源回滚或虚构时间推进；
- 调整呈现不暗改已提交骰面与事实；必要内容变更走明确更正/世界事件。

## 11. 主要事件

- `SceneQuestionOpened` / `SceneQuestionAnswered` / `SceneTransitioned`
- `MeaningfulFailureCommitted`
- `RetryConditionChanged`
- `FactionPlanAdvanced`
- `EndingCandidateRaised` / `EndingCandidateDismissed`
- `StoryConcluded` / `EpilogueChoiceRecorded`
- `SequelStarted`
- `SafetyPauseRequested` / `SafetyPresentationAdjusted`

## 12. 验收场景

1. 失败关闭原路线并推进时间/势力，玩家获得新选择；原样重掷被拒。
2. 玩家停滞时先重新定向和展示已有机会；现实等待不触发惩罚。
3. 模型叙述严格遵守已提交投影，不替玩家决定情绪/台词，失败重试不重复机械。
4. 核心冲突胜利、不可逆失败和明确放弃三条路径都能真实收束并展示后果。
5. 玩家拒绝接受 NPC 投降时继续按新意图处理，系统不代停。
6. 已收束故事不会自动冒出新幕后黑手；玩家明确继续后建立新章节。
7. 安全暂停立即私密生效，机械与虚构时间保持。

## 13. 实现映射

- 场景/失败/结局模型：`app/_runtime/lib/rules/v2/campaign-actions.ts`、`campaign-events.ts`、`compound-actions.ts`
- Room Action/KP 循环：`app/_runtime/lib/room/action.ts`
- Read Model/UI：`app/_runtime/components/play-table.tsx`
- 验收：`tests/world-campaign-v2.test.mjs`、`tests/rules-compound-action-v2.test.mjs`、`tests/compound-action-v2.test.ts`、`tests/kp-multiturn-eval.test.ts`

### 13.1 当前实现证据（2026-08-26）

- `tests/world-campaign-v2.test.mjs` 7/7：`MeaningfulFailureCommitted` 改变路线/时间/势力并提供新选择，原样重试以 `unchangedRetry` 拒绝，实质改变方法/成本后才允许新裁决；同一文件验证结局候选、真实收束、玩家尾声与显式续篇。
- `tests/rules-compound-action-v2.test.mjs` 18/18：生产 ActionPlan 用 `resolveDirectConsequences` 提交 typed consequences，用 `advanceCampaignLifecycle` 提交结局/尾声，并以 `commitMeaningfulFailure` / `retryFailedAction` 固定有意义失败与原样重试门；不得由叙述、UI 或 Room 拼装状态。
- `tests/kp-multiturn-eval.test.ts` 的单场景 31/31 连续意图/待决回答已通过，覆盖有意义失败、NPC/势力推进、聚光灯、真实收束和尾声；它是确定性系统评测，不替代真实 Workers AI 与线上冒烟。

## 14. 交叉审查

- SPEC 0001：失败、公正、停滞、场景叙述、玩家能动性和真实收束完整保留。
- 权限：玩家决定其角色继续/接受/尾声；KP 决定 NPC/世界，不由系统代选。
- 秘密：叙述和尾声按 Viewer 隔离；安全原因最小化私密。
- 版本：叙述政策、结局 Profile、章节和分支固定；模型升级不改历史。
- 第二权威：结局谓词、UI、聊天文本、模型和势力调度器都不能直接改状态。
