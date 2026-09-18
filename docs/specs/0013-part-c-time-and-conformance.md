---
kind: part
part_of: "0013"
title: "SPEC 0013 分册：时间 Profile、护栏与 Conformance"
clauses: "7-13"
---
# SPEC 0013 分册：时间 Profile、护栏与 Conformance

本文件是 [SPEC 0013](./0013-versioned-runtime-profiles.md) 的 §7–§13，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 7. Fiction/Combat Time Profile

### 7.1 表示与分支

`combat-round-six-seconds-2014-v1` 同时拥有非战斗虚构时间与战斗相位。权威单位为整数微秒，事件中以十进制字符串 `fictionInstantMicros` 保存：

- 1 秒 = 1,000,000 微秒；1 分钟 = 60 秒；1 小时 = 3,600 秒；1 日 = 86,400 秒；
- 短休最少 3,600 秒，长休最少 28,800 秒并遵守 2014 的中断与每 24 小时限制；
- 每个分头地点/因果分支拥有自己的 `FictionTimeline`；不存在房间单一最大时间自动覆盖所有分支；
- 普通动作、旅行、谈话、调查、施法和危险耗时由 KP/定义在结果前冻结，再由 Rules 验证；
- Spotlight Beat、现实时间、HTTP/DO/模型延迟、掉线、刷新、ACK、票据/租约 TTL 和部署时间均没有虚构时长。

同一虚构时刻的事件仍按因果依赖、Trigger Profile 和连续 `eventSeq` 排序；不能用现实毫秒打破平手。

### 7.2 Activity 与到期

Activity 保存 start、冻结 duration、due instant、投入资源、可中断条件和完成效果。时间线尚未到 due 时，完成效果不能提前写入；中断只保留已经真实发生的成本和迹象。处理一个开始时刻不早于 due 的新行动前，先把已经到期的 Activity/NPC 计划作为独立根行动经同一 `step → commit → project` 提交，再重新投影原意图。Activity 的推进或提醒阶段是尚待经过的一段时间，不是已到达的 due：同一瞬间开始的新行动先执行，可以打断该 Activity，其推进在新行动提交后再由到期尾部结算；完成瞬间已到达的 Activity、已排定的 NPC 计划与内部决定仍先提交。

到期 Activity 的根必须从冻结的 `activityId + completionFictionMicros` 唯一规范化为 `activity-due:<activityId>:<completionFictionMicros>`。若完成效果需要权威随机，Room randomness journal 恢复时只能从冻结参数重新导出该根，并验证 request events 全属同一根、randomness ID 绑定该根、以及事件序列和字节与权威存储中的连续前缀完全一致；任一项不符即 fail closed。恢复只继续这一 canonical due root，原调用者 root 保持未提交并在重新投影后重试。

仅“等待”或其他明确玩家/KP 世界行动可以合法推进时间；现实沉默不会生成等待。跨分支传播还要满足 `SPEC 0007` 的因果前沿和世界内媒介速度。

### 7.3 六秒轮与 CombatMoment

一个战斗轮是固定 6,000,000 微秒窗口。Encounter 开始记录 `roundWindowStartMicros`；单个回合、攻击、反应或模型调用不分别推进分支时间。最后一个有效先攻条目结清，或 Encounter 在轮中合法结束时，当前轮只关闭一次并把该分支时间推进 6,000,000 微秒。

`CombatMoment` 保存 `roundIndex`、冻结 initiative order hash、`slotIndex` 和 `turnStart/turnEnd` edge。若有 `N` 个先攻条目，`N` 最大为 4096；更多同类实体必须使用共享先攻条目。用于相位到期的确定偏移为：

```text
turnStartOffset(i, N) = floor(6_000_000 * i / N)
turnEndOffset(i, N)   = floor(6_000_000 * (i + 1) / N)
```

这些偏移只定位相位，不表示各角色行动真的依次占用等长现实时间，也不在回合之间推进 `FictionTimeline`。

### 7.4 相位锚点与 Encounter 中途结束

“直到自身下回合开始”“目标回合结束”等持续保存目标 entity、edge、目标 round、initiative order hash 和创建因果点，而不是预先换成粗略秒数。

Encounter 中途结束时：

1. 先结清强制伤害、移动、死亡和已经打开的 Pending Input；未结清时结束提案拒绝。
2. 关闭当前六秒轮并把分支时间推进一次 6,000,000 微秒。
3. 目标相位原本位于已关闭轮剩余部分的，在关闭提交内按原 initiative 顺序到期。
4. 位于未来轮的，使用保存的 `N/slotIndex/edge` 映射到关闭后连续的假想六秒窗口；多轮持续再加整轮 6,000,000 微秒。
5. 相同绝对微秒的残余相位使用保存的 initiative order、edge ordinal 和 effect id 排序。
6. 到期任务只触发/终止 Effect，不授予动作、移动、反应恢复或新的战斗回合，并且幂等发生一次。

更正改变 initiative 或结束因果时，按 `SPEC 0011` 打开分支并在新分支重建相位任务；旧分支任务保留审计但不在活动分支执行。

## 8. 2014 与非 2024 护栏

Ruleset 与 Compiler conformance 必须同时拒绝：

- 以先攻劣势取代 2014 的逐实体突袭首回合限制；
- “每回合只能消耗一个法术位”，从而错误阻止没有附赠动作法术时的 Action Surge 双一动作法术；
- 把 Counterspell 改成目标体质豁免，或返还已承诺的法术位/动作；
- 把 Grapple/Shove 改成徒手命中后的力量/敏捷豁免；
- Weapon Mastery、每次攻击自由装备/卸下武器、2024 Magic/Utilize/Influence/Study 动作；
- 固定 DC 15 Hide 后授予 Invisible 状态；
- 没有能力明文的通用自愿失败豁免；
- 2024 每级 D20 Test -2 的 Exhaustion 或通用 Bloodied 状态。

定义目录必须标注规则来源；发现禁用词只是初筛，最终 conformance 检查机械图语义，不能通过改名把 2024 行为混入。Geometry 的欧氏量距、64/65 点采样、around-corner voxel，Trigger 的跨控制者排序，以及 Time 的微秒/相位映射均是版本化产品规则，不声称来自 SRD。

## 9. Conformance 与验收向量

所有向量都从公开责任 Interface 驱动：Rules 行为经 `step/project/replay`，Room 版本和恢复经 Room Authority；测试不得直接调用 fold、注入事件、改坐标缓存或指定生产骰面。以下是最低集合，不限制增加边界测试。

### 9.1 Manifest 与 EventSchema

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| P01 | 同一规范对象仅交换 JSON key 顺序 | JCS 字节和 hash 相同 |
| P02 | 交换声明为有序的 op 节点 | hash 不同；旧引用不能接受 |
| P03 | 同一 `profileId` 注册不同 hash | Registry 构建失败或 `profileIntegrityMismatch` |
| P04 | 事件缺少一个 ProfileRef、event type version 或前一事件 hash | `replay` 显式拒绝，不尝试退役/latest 路径 |
| P05 | 当前 0.4 genesis/event archive 在实例重启后回放 | 精确选择唯一当前 Adapter，状态与原 state hash 相同 |
| P06 | 旧 manifest、未知 manifest 或当前 ID/错 hash 进入 Registry | 分别稳定拒绝；不注册兼容项、不回退当前默认值 |
| P07 | D1 归档事件顺序交换、断序或 payload 被改一字节 | hash 链/连续序号失败，不能重建快照 |
| P08 | 前 0.4/Legacy 房间进入 0.4 页面、API 或 Room 服务 | 显式标记已退役/不支持；房主只能删除可见目录行，绝不落入当前 authoritative-v2 |

### 9.2 Ability compiler

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| A01 | 同一定义只交换声明为集合的 tag/alias 顺序 | definition/compiled hash 相同 |
| A02 | 交换“先扣资源、后伤害”的有序节点 | compiled hash 不同，不能视为等价 |
| A03 | 定义含 `setPath`、JSON Patch、脚本、回调或任意事件 | `unsupportedMechanicPrimitive`，无半注册事件 |
| A04 | 触发图有环、choice 未绑定或超复杂度上限 | 逐项诊断，返回 `needsKp`，不掷骰、不削弱定义 |
| A05 | 合法动态敌人具有极高 AC/HP/伤害但在复杂度内 | 接受并注册，不按队伍/当前 HP 缩放 |
| A06 | 能力有多个合法目标且控制者未选择 | `awaitingInput`；不选第一项、最近或最低 HP |
| A07 | 0.4 房间注册动态能力后更新部署目录/Compiler | 该房间继续使用事件中的 compiled graph/hash，不重新编译 |
| A08 | 目录以改名字段表达 Weapon Mastery 或每回合法术位上限 | 语义护栏拒绝，不只做词面检查 |
| A09 | 普通客户端、LLM 或 Room Action 提交 `MechanicOp[]` | Interface/schema 拒绝，且错误不泄漏私有 op |

### 9.3 Geometry

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| G01 | 输入 5 尺与 60 英寸 | 规范坐标相同；非整数英寸输入不静默舍入 |
| G02 | 两个 Medium 占位边界相接 | measurement core 距离 60 英寸，5 尺 reach 合法 |
| G03 | 两个 Medium 中间隔完整 5 尺 | 距离 120 英寸；5 尺非法、10 尺边界合法 |
| G04 | 水平 core 重叠、垂直 core 相隔 60 英寸 | 三维距离 5 尺，高度不能被二维距离忽略 |
| G05 | 斜向 measurement core 分别相隔 120/120 英寸 | 10 尺范围非法；欧氏边界而非页面格数决定 |
| G06 | 点/实体恰好在射程边界与边界外 1 英寸 | 前者合法、后者非法；显示舍入不影响 |
| G07 | waypoint 差为 36/48/0 英寸 | 段长恰为 60 英寸；分片重试结果相同 |
| G08 | 同体型敌对实体空间、相差两个体型敌对空间、盟友空间 | 依次为不可穿、可穿但困难、可穿但困难；均不可自愿停留重叠 |
| G09 | 净空只容纳小一体型 | 允许挤入、移动成本加一倍并应用 2014 攻防；更窄则拒绝 |
| G10 | 同一墙分别 hard-block 31/32/48/64 个 cover samples | 依次为无、半、四分之三、全掩护；soft-only 最高半掩护 |
| G11 | 20 尺 sphere 的一个 area sample 恰在边界/外 1 英寸 | 前者在集合、后者不在；调用者删改 `targetIds` 不改变集合 |
| G12 | 区域请求点在墙后 | 原点冻结为首次交点来源侧；不能在见到集合后换点 |
| G13 | `straight` 被墙阻挡；`aroundCorners` 有开放 voxel 通路/完全封闭 | 依次阻挡、可绕、不可穿透；遍历顺序不改变集合 |
| G14 | 移动在中段打开反应并被降为速度 0 | 只提交已通过路径，后续 waypoint 不提前落地 |
| G15 | 隐藏墙或实体导致目标非法 | 玩家错误只给公开安全原因；KP/internal projection 保留空间证据 |

### 9.4 Trigger ordering

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| T01 | 同一批次交换 map 插入、请求到达和模型完成顺序 | `TriggerBatch` hash、窗口顺序和事件结果相同 |
| T02 | 同一玩家有两个不交换的同时触发 | 只向该玩家打开排序 Pending Input；其他人看不到数量 |
| T03 | 三个不同控制者同时合资格 | 从当前先攻条目按冻结顺序轮转，断线不改变顺位 |
| T04 | 第一项响应使第二项失效 | 第二项 `TriggerInvalidated`，零资源消耗、无自动换目标 |
| T05 | 第一项产生新的合法触发 | 建立子批次，完成后恢复父 continuation，不插队父剩余项 |
| T06 | 当前窗口控制者掉线/现实超时 | 保持等待，不 pass、不推进回合或时间 |
| T07 | 非战斗两个实体与一个环境项同时触发 | 因果行动者优先，其余按 entity ordinal，环境最后；replay 相同 |

### 9.5 Fiction/combat time

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| F01 | 一轮含 1、4 或共享组先攻条目 | 每轮都只推进 6,000,000 微秒一次，单回合不另加时间 |
| F02 | 页面关闭、模型 45 秒超时、掉线一天、ACK/租约到期 | 虚构时间和 CombatMoment 均不变，无自动 pass |
| F03 | 短休 3,599/3,600 秒，长休 28,799/28,800 秒 | 只有达到最低时长且其他 2014 条件满足者完成 |
| F04 | Activity 到期前中断/到期后处理下一意图，且到期完成需要权威随机 | 前者不落完成效果；后者先按 canonical due root 提交并可从严格校验的 randomness journal 恢复，再重投影原意图 |
| F05 | Encounter 中途结束，Effect 锚定后续 turn start/end | 按保存 initiative 映射为一次残余到期，不授予新战斗动作 |
| F06 | 多个残余 Effect 同一微秒到期 | 按 initiative、edge、effect id 固定顺序，不按对象遍历 |
| F07 | 两个地点分支时间不同，另一处分支到期 | 未跨因果前沿前不影响本分支，会合不粗暴取全房最大值 |
| F08 | Time Profile 部署新实现后回放旧事件 | 旧 ProfileRef 得到相同 instant、phase task 和 state hash |
| F09 | 超过 4096 个个体需加入同一 Encounter | 使用有机械依据的共享先攻条目或返回可修订诊断，不截断数组 |

## 10. 自主裁定记录

本节为非规范附录，已移至 [SPEC 0013 附录](./0013-appendix-decisions-mapping-and-review.md#10)。

## 11. 实现映射

本节为非规范附录，已移至 [SPEC 0013 附录](./0013-appendix-decisions-mapping-and-review.md#11)。

## 12. 五项交叉审查

本节为非规范附录，已移至 [SPEC 0013 附录](./0013-appendix-decisions-mapping-and-review.md#12)。

## 13. 实施完成门

本节为非规范附录，已移至 [SPEC 0013 附录](./0013-appendix-decisions-mapping-and-review.md#13)。
