# ADR 0027：更正审计只记录改变的记录、只保留执行中的根，房间状态分块持久化

- 状态：已接受
- 日期：2026-09-18
- 依据：用户于 2026-09-18 要求“不用管旧房间的情况下，完整的修复这一类错误”，并批准本方案（“可以，准许”）。
- 当前规则：[SPEC 0011 §7](../specs/0011-reliability-correction-observability-and-evaluation.md)
- 取代范围：SPEC 0011 §7 中“所有会改变战斗运行态的事件在 fold 前记录完整的 `combatRuntime` 恢复快照”及“改变 correction audit 必须发行新 manifest”的表述。沿用 [ADR 0016](./0016-development-reset-of-pre-0.4-rooms.md) 的先例：不为旧事件 schema 的房间保留第二套解释器。

## 背景

2026-09-18 在 workers 测试环境测得：把一张完整角色卡实体化进游玩中的房间会追加 47 个事件，每个事件的更正审计都保存整个 `combatRuntime` 和整个物品集合的克隆，持久化状态从 126 KB 涨到 1.9 MB；`AuthoritativeRoomStore.updateState` 把整份状态写进一个 SQLite 值，第二名玩家锁定完整角色卡时写入失败（`SQLITE_TOOBIG`）。审计当时进入 `hashWorldState`，任何改动都会改变每个事件的 `stateHashAfter`，因此不能在原 schema 下修剪。

## 决定

1. 审计按记录记差异。折叠前后比较战斗运行态各集合与物品系统各集合，只为改变的条目记录改变前的值；事件解释器显式命名的记录（角色、知识、事实、场景、时间线、定义、Campaign 条目）沿用显式效果，但未改变的显式效果不记录；按需创建的物品集合记录其此前不存在（`removeItemSystemCollection`）。
2. 审计移出状态哈希。`stateHashSource` 去掉 `correctionRuntime.audit`；`corrections` 与 `branches` 仍在哈希内。
3. 新根开始时修剪。仍在执行的根（等待输入或随机数的 Receipt、内部 continuation、冻结选择、待决输入含挂起的、暂停的原子交互、Activity 仍在进行的行动）中最早事件之前的记录全部丢弃；候选折叠没有 Receipt，因此以“该根尚无审计记录”判断根的开始。
4. 更正由 Room 协助。`commitCorrection` 先以 `retainCorrectionAudit` 回放完整日志，再执行 `applyServiceCorrection`；更正事件的 payload 携带恢复效果，回放只应用 payload，不查审计。
5. 持久化分块。`authority_json_blobs` 以 256K 字符为一块保存房间状态和候选机械的基线/候选状态，块边界不拆代理对；`authority_rooms.state_json` 与候选行的状态列写空串，读取端仍拿到整份文本。每次提交记录 `room.authority.state.persisted`（字符数、块数、审计记录数，1 MiB 预算桶）。
6. 事件 schema 升版。`room-world-events-vnext-stage3-v2`（2.0.0，`correctionAudit: entry-level-differences-outside-state-hash`），vNext manifest hash 随之改变；此前 manifest 下创建的房间不回放、不迁移。

## 后果

- 同一场景实测：126 KB → 319 KB → 494 KB（两名玩家先后锁卡，活状态只含当前根的 251 KB 审计）。
- 被 supersede 的根在后续根开始后不再留在活审计里；其证据是事件日志和更正事件本身，`world-campaign` 测试据此改为核对 `BranchActivated` payload。
- 更正更早 Receipt 的单测改为在 `retainCorrectionAudit` 回放上执行（`frozen-choice`、`dynamic-locations`、`world-campaign`、`rules-pending`）。
- 手工拼装 genesis 哈希的测试改用 `hashWorldState`。
- 每次折叠都做一次结构比较，代价是遍历，不做序列化或哈希。
- 未处理：本地 dev 房间需重建；`stage3`、`archive-correction`、`multiplayer.room` 等套件在本次修改前后同样失败，属于工作区里正在进行的其他改动，不在本决定范围内。
