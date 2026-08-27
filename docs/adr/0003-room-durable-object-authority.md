# 每个房间使用一个 Durable Object

- 状态：部分被 ADR-0006、ADR-0007 与 ADR-0010 细化
- 平台：现有 Cloudflare Worker `zhuwei`

## 背景

同一房间的位置、唯一物品、队伍、休息与时间线需要共同原子提交。按地点加分布式锁无法覆盖跨地点因果，也不能防止两个地点同时取得同一件唯一物品。

## 决策

每个房间使用一个 SQLite Durable Object 保存活跃 WorldState、WorldEvent、幂等结果、待决输入、相关作用域头和当前投递槽。AI 调用永远位于 DO 事务之外：DO `prepare` 固化已认证意图并返回观察者专属投影，Room Action Module 调用 KP，DO 再由 `commit` 重验、产生权威随机并原子提交。

D1 保存身份、房间目录、静态人物卡、模组/规则版本，以及 `room_event_archive` 中已提交事件的不可变副本。D1 归档可从 DO 重建，不参与活跃裁决。

## 后果

根行动、客户端重试、提案尝试、待决回答和 Receipt 使用不同且有父子关系的 ID；同一幂等 ID 的同载荷只产生一次结果，异载荷重用必须拒绝。相关作用域冲突会要求重新取得投影，无关地点仍可并发。现实 TTL、断线与 AI 失败都不推进虚构时间，也不替玩家行动。部署需要 Wrangler SQLite DO migration 与 `ROOMS` binding；远程发布权限由具体 Goal 另行授予。

## 验收场景

1. 两个针对同一权威作用域的并发行动只能有一个按原读取证明提交；无关作用域仍可独立提交。
2. 同一幂等 ID 与同一载荷在重试、DO 驱逐和恢复后返回同一 Receipt；异载荷重用被拒绝且不产生第二次后果。
3. AI 调用发生在事务外，提案冻结后才由 DO 产生随机并提交；故障恢复复用已持久化阶段、提案与随机日志。
4. D1 事件归档可重建 DO 状态，但 D1 `game_states` 不参与新规则房间的活跃裁决。

## 实现映射

- Room Authority：`app/_runtime/lib/room/durable-object.ts`、`app/_runtime/lib/room/authority-store.ts`
- 行动编排：`app/_runtime/lib/room/action.ts`、`app/_runtime/lib/room/coordinator.ts`
- 归档：`app/_runtime/lib/room/archive.ts`
- 验收：`tests/room-authority-v2.test.ts`、`tests/room-retry-v2.test.ts`、`tests/randomness-recovery-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`
