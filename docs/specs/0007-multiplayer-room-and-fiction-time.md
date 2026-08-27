# SPEC 0007：多人房间、控制权、虚构时间与聚光灯

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0005`
- 取代范围：`SPEC 0002` 第 3、5、7、10、12、20 节及 B02、B16、B25–B27、B30、B47、B49、B51 中的多人、权限、并发、时间与聚光灯条款

## 1. 可信 Principal 与席位

`Principal` 只能来自有效 `auth_sessions` 会话，包含服务端确定的 user id、会话版本和权限上下文。客户端、语音转写、模型和 DO RPC 请求体中的 `userId`/`actorId` 均不构成身份。

`Seat` 是一个 Principal 在房间中的参与资格；`CharacterControl` 是 Seat 对具体玩家角色的权威控制关系。房主、队长、KP、其他玩家和活跃发言者不能因此获得他人角色控制权。

一个玩家角色在同一时点至多有一个主动控制 Seat。NPC 由 KP 控制，但每次决策必须使用 NPC 有限知识投影。

## 2. 房间成员与控制事件

加入、入席、离席、掉线、重连、换席、请离、房主转移、角色交接和观察者身份分别建模：

- `MemberJoined` / `MemberDeparted`
- `SeatGranted` / `SeatVacated`
- `CharacterControlGranted` / `CharacterControlRevoked` / `CharacterControlTransferred`
- `MemberRemoved`
- `HostTransferred`
- `ConnectionObserved`（UX，不推进世界）

请离和控制权撤销立即阻止新写入；已提交事件不回滚。待决玩家输入在控制权变更时原子 `PendingInputReassigned` 或 `PendingInputSuspended`，不得由新主体自动代答。换席必须重新鉴权并显式接受；旧票据和未确认私人 Delivery Frame 不转移给新 Principal。

掉线只影响送达状态，不撤销 Seat/控制权、不产生 pass、不完成 Activity、不结束回合或推进虚构时间。重连后重新鉴权并按当前 Principal/角色投影恢复。

## 3. 私人窗口

所有澄清、反应、角色选择、升级和安全暂停都绑定唯一控制主体与 Visibility Policy。只有该主体能看到窗口是否存在、选项、时点和响应结果。

无权观察者的 Read Model、增量、错误、候选数量、日志和语音不得泄漏窗口。窗口跨 Worker/DO 重启保持；现实超时不自动回答。未来自动策略必须由控制者事先明确配置为版本化权威事实，本规则版本不启用自动策略。

## 4. 并发意图

Room DO 串行原子提交同一房间事件，但通过 Rules `scopeProof` 允许无关作用域意图在同一审计序列中独立成功：

- 同一实体、控制权、物件、空间、待决、关系、知识或时间因果冲突时整笔重提；
- 不同地点、不同实体且没有共同因果依赖时，无关全局 `eventSeq` 变化不会使旧票据失效；
- 客户端先到不获得额外世界权限；唯一物件、位置和跨地点事件由作用域/因果验证裁定；
- 一个实体不能同时参与两个 Activity/Encounter 中互斥的行动。

每个外部提交保留独立 `submissionId`；同一 Principal 也不能通过并发请求绕过一次性资源或待决窗口。

## 5. 分队与重组

`PartyGroup` 只描述当前共同协调/移动关系，不授予队长替成员行动的权力。

- 邀请、接受、拒绝、离队、队长转移和解散均为权威事件；
- 个人移动、休整或其他合法行动可以原子离队，不需队长批准；
- 整队移动是每个受控角色明确同意的原子多主体提案；任一控制权/位置/前提变化时整笔不提交；
- 跨地点重组要求角色实际到达兼容地点和因果时刻，不能仅改 UI 分组；
- 队长只组织整队提案、管理公开队伍标签，不替任何成员回答私人窗口。

production ActionPlan 的队伍语义必须显式选择六个 `partyAction` 之一：`inviteMember`、`cancelInvitation`、`leave`、`transferLeadership`、`proposeMove`、`moveIndividually`。Rules 分别验证目标成员、投影中的 Pending 引用、当前领导权、目的地、冻结耗时和逐控制者同意；Room/模型不得依据 `memberRefs` 是否为空猜测邀请或离队，也不得保留六条 DO compact 命令旁路。

## 6. 虚构时间分支

每个分头地点/行动分支保存 `FictionTimeline`：当前虚构秒、活动、到期事件和因果父项。Spotlight Beat 与虚构秒完全分离：

- Beat 只记录叙事决定权与镜头公平；
- 战斗轮固定六秒；短休一小时、长休八小时；Activity 使用实际 Profile；
- 一次谈话、撬锁、旅行和休整具有各自冻结耗时，不按一拍等长；
- 现实时间、网络/模型延迟、断线、票据/租约 TTL 不推进虚构时间。

虚构时间只通过行动/Activity/轮结束等经 `step` 提交的事件推进。

## 7. 因果前沿

`CausalFrontier` 是分头时间线中已经确定并可安全传播到指定分支的最晚世界时刻与事件头。全局/跨地点事件只有在其因果条件对目标分支成立时才能影响它。

- 一个分支不能看到其虚构时刻尚未发生的他处分支结果；
- 传播需要世界内速度/媒介或全局物理效果；
- 会合时对比位置、时间、事件依赖和共同事实，必要时等待、概括 Activity 或明确发生时间同步；
- 因果冲突不能靠把所有分支强行改到房间最大时间解决；
- 更正分支必须重新计算受影响前沿，沿用无关作用域。

## 8. 聚光灯账本

Room DO 保存 `SpotlightLedger`：每个 Seat 最近获得决定权、重要发现、个人时刻、被邀请时间、连续跳过（仅显式）和当前分支 Beat。

KP 在自然决定点、危险显现、短场景完成或领先达到上限时切换。版本化规则：同一分头分支相对最少获光分支最多领先三 Beat；这是调度护栏，不改变回合、窗口时点、DC、敌人、事实或虚构时间。

安静玩家应被主动邀请，但不强迫表演；未响应保持等待或让镜头暂时切换，不能替其角色行动。场景中的强制效果只由规则决定，不被误当成玩家选择。

## 9. 世界内角色冲突与桌外分歧

攻击同伴、抢夺、投降、交易等角色冲突需要相应玩家明确意图和规则提案；重大歧义先澄清。房主或多数票不能代替个人角色选择。

桌外内容边界、安全暂停、成员管理和行为纠纷属于房间协调，不伪装为角色事件。安全请求可立即暂停呈现，原因保持私密；机械状态停在最近稳定点。

## 10. Read Model

玩家 Read Model 只包含：其控制关系、角色所在因果分支可见事实、自己精确资源/待决、公开成员/席位信息、允许知道的队伍/聚光灯摘要和当前 Delivery Frame。

它不包含其他角色的私人知识/窗口、完整位置历史、KP 旁白历史、未来分支事实、模组真相或 KP Viewer。房主也不因管理权限获得这些秘密。

## 11. 验收场景

1. 请求体伪造 actor、替他人回答、被请离后重用票据和换席后读取旧私人回应均失败。
2. 玩家断线于反应/澄清窗口，重启和重连后仍由原控制者回答；时间未推进。
3. 不同地点无关意图都成功；争夺同一物件只有一个提交，失败方重新投影。
4. 整队移动缺一名成员确认不自动移动该成员；个人可原子离队移动/休整。
5. 两条分支虚构时间不同，未来事件不会泄漏；会合后按因果前沿同步。
6. 活跃玩家/队长/房主不能代答安静玩家；聚光灯在三 Beat 前切回而不改机械时间。
7. 三方角色冲突中每个玩家决定自己的角色，NPC 由 KP 有限知识提案。
8. 安全暂停立即生效且原因不向其他玩家投影，不被记为角色 pass。

## 12. 实现映射

- Principal/席位 Adapter：`app/chatgpt-auth.ts`、`app/_runtime/lib/table/server.ts`
- Room Authority：`app/_runtime/lib/room/durable-object.ts`
- 多人/时间 Implementation：`app/_runtime/lib/rules/v2/multiplayer-actions.ts`、`multiplayer-events.ts`、`compound-actions.ts`
- 聚光灯：`app/_runtime/lib/room/action.ts`
- 验收：`tests/rules-compound-action-v2.test.mjs`、`tests/rules-multiplayer-v2.test.mjs`、`tests/multiplayer-room-v2.test.ts`、`tests/observer-projection-v2.test.mjs`

### 12.1 当前实现证据（2026-08-26）

- `tests/rules-compound-action-v2.test.mjs` 18/18 已通过，其中连续队伍场景把六个 typed `partyAction` 全部驱动到同一 `step/replay/project` seam，覆盖取消邀请、领导权转移、逐人同意整队移动、个人原子离队移动与普通离队。
- `tests/rules-multiplayer-v2.test.mjs` 8/8 与 `tests/multiplayer-room-v2.test.ts` 8/8 已通过，证明 service-only Seat/Control/host、Pending owner、分队、时间线/因果前沿与 Spotlight 的 Rules/Room 权威链；冻结源码的最终 HTTP/浏览器多人回归仍待全量/发布门。

## 13. 交叉审查

- SPEC 0001：个人能动性、分头聚光灯、现实等待不惩罚和 NPC 有限知识完整保留。
- 权限：Principal、Seat、CharacterControl、Host 与 KP 权限明确分离。
- 秘密：管理权限不扩大叙事权限；私人窗口与分支事实统一投影。
- 版本：时间、聚光灯、控制权和因果 Profile 随房间版本固定。
- 第二权威：客户端组队状态、D1 `where/clocks/squad`、UX 在线状态和模型不能成为活跃事实。
